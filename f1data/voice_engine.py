"""
Hybrid F1 Broadcast & Team Radio Neural Voice Engine.

Priority tiers (engine="auto"):
  1. Gemini TTS (gemini-2.5-flash-preview-tts or GEMINI_TTS_MODEL) when GEMINI_API_KEY
     is configured in environment or `traf1/.env`. Supports prompt-directed F1 commentary
     acting, cockpit radio urgency, 30 expressive voices, and 2-speaker driver<->engineer exchanges.
  2. Free Microsoft Neural Edge-TTS (local `edge-tts` CLI) — zero API key required,
     distinct British/Australian/European neural voices for Crofty, Brundle, Stewards,
     Race Engineers, and Drivers.
  3. Clean SHA-256 disk cache under `data/tts_cache/` (250-file LRU cap) so recurring F1
     race calls ("Lights out!", "Safety Car deployed!", "Box this lap") play instantaneously.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
import shutil
import struct
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Any

import requests

LOGGER = logging.getLogger("f1data.voice")
_BASE_DIR = Path(__file__).resolve().parent.parent
_ENV_FILE = _BASE_DIR / ".env"
_CACHE_DIR = _BASE_DIR / "data" / "tts_cache"
_CACHE_LOCK = threading.Lock()
_MAX_CACHE_FILES = 250

DEFAULT_GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts"
_GEMINI_ENDPOINT_TMPL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# Curated F1 Broadcast & Team Radio Voice Casting
ROLE_CASTING: dict[str, dict[str, Any]] = {
    "crofty": {
        "gemini_voice": "Fenrir",
        "gemini_style": "Say with energetic, live British Formula 1 TV lead commentator excitement and punchy broadcast cadence",
        "edge_voice": "en-GB-RyanNeural",
        "edge_rate": "+10%",
        "edge_pitch": "+3Hz",
    },
    "brundle": {
        "gemini_voice": "Charon",
        "gemini_style": "Say like a seasoned, insightful former British Formula 1 driver doing crisp live TV co-commentary",
        "edge_voice": "en-GB-ThomasNeural",
        "edge_rate": "+5%",
        "edge_pitch": "-2Hz",
    },
    "stewards": {
        "gemini_voice": "Orus",
        "gemini_style": "Say formally, calmly, and crisply like an official FIA Race Control broadcast announcement",
        "edge_voice": "en-GB-SoniaNeural",
        "edge_rate": "+3%",
        "edge_pitch": "+0Hz",
    },
    "engineer": {
        "gemini_voice": "Umbriel",
        "gemini_style": "Say calmly, concisely, and crisply like a Formula 1 race engineer speaking over pit-wall headset radio",
        "edge_voice": "en-GB-ThomasNeural",
        "edge_rate": "+7%",
        "edge_pitch": "-1Hz",
    },
    "driver": {
        "gemini_voice": "Puck",
        "gemini_style": "Say urgently and tersely like a Formula 1 driver speaking at 300 kph over cockpit team radio",
        "edge_voice": "en-US-AndrewMultilingualNeural",
        "edge_rate": "+9%",
        "edge_pitch": "+1Hz",
    },
}

ARCHETYPE_VOICE_MAP: dict[str, dict[str, str]] = {
    "clinical_perfectionist": {
        "gemini_voice": "Puck",
        "gemini_style": "Say tersely, directly, and intensely like a perfectionist Formula 1 driver over cockpit team radio",
        "edge_voice": "en-US-EricNeural",
        "edge_rate": "+9%",
        "edge_pitch": "+0Hz",
    },
    "rhythmic_strategist": {
        "gemini_voice": "Achird",
        "gemini_style": "Say smoothly and thoughtfully like a veteran British Formula 1 champion over cockpit team radio",
        "edge_voice": "en-GB-RyanNeural",
        "edge_rate": "+5%",
        "edge_pitch": "-2Hz",
    },
    "tactical_chessmaster": {
        "gemini_voice": "Schedar",
        "gemini_style": "Say sharply and strategically like a cunning Formula 1 veteran negotiating pit strategy over cockpit radio",
        "edge_voice": "en-US-ChristopherNeural",
        "edge_rate": "+7%",
        "edge_pitch": "-1Hz",
    },
    "expressive_telemetry": {
        "gemini_voice": "Aoede",
        "gemini_style": "Say with high adrenaline and emotion like an expressive young Formula 1 driver over cockpit team radio",
        "edge_voice": "en-US-GuyNeural",
        "edge_rate": "+11%",
        "edge_pitch": "+2Hz",
    },
    "stoic_minimalist": {
        "gemini_voice": "Enceladus",
        "gemini_style": "Say ultra-calmly, flatly, and deadpan like an ice-cold Formula 1 driver over cockpit team radio",
        "edge_voice": "en-AU-WilliamMultilingualNeural",
        "edge_rate": "+2%",
        "edge_pitch": "-3Hz",
    },
}

DRIVER_ACCENT_HINTS: dict[str, str] = {
    "piastri": "en-AU-WilliamMultilingualNeural",
    "ricciardo": "en-AU-WilliamMultilingualNeural",
    "brabham": "en-AU-WilliamMultilingualNeural",
    "hamilton": "en-GB-RyanNeural",
    "norris": "en-GB-RyanNeural",
    "russell": "en-GB-ThomasNeural",
    "button": "en-GB-ThomasNeural",
    "clark": "en-GB-ThomasNeural",
    "stewart": "en-GB-ThomasNeural",
    "hill": "en-GB-ThomasNeural",
    "mansell": "en-GB-RyanNeural",
    "hunt": "en-GB-RyanNeural",
    "moss": "en-GB-ThomasNeural",
    "bearman": "en-GB-RyanNeural",
    "irvine": "en-IE-ConnorNeural",
}


def _read_dotenv_var(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if val:
        return val
    if _ENV_FILE.is_file():
        try:
            for line in _ENV_FILE.read_text(encoding="utf-8", errors="ignore").splitlines():
                s = line.strip()
                if not s or s.startswith("#") or "=" not in s:
                    continue
                k, v = s.split("=", 1)
                if k.strip() == name:
                    return v.strip().strip('"').strip("'")
        except Exception:
            pass
    return ""


def get_gemini_api_key() -> str:
    return _read_dotenv_var("GEMINI_API_KEY") or _read_dotenv_var("GOOGLE_API_KEY")


def get_gemini_tts_model() -> str:
    return _read_dotenv_var("GEMINI_TTS_MODEL") or DEFAULT_GEMINI_TTS_MODEL


def find_edge_tts_bin() -> str | None:
    p = shutil.which("edge-tts")
    if p:
        return p
    local_bin = Path.home() / ".local" / "bin" / "edge-tts"
    if local_bin.is_file():
        return str(local_bin)
    return None


def clean_speech_text(raw: str, max_len: int = 240) -> str:
    s = str(raw or "")
    # Strip emojis & decorative icons while keeping punctuation for natural prosody
    s = re.sub(r"^(?:[^\w]*(?:CROFTY|BRUNDLE|FIA STEWARDS|FIA RACE CONTROL|PIT BOARD|MARSHAL OBS)\s*[:·—-]\s*)", "", s, flags=re.IGNORECASE)
    s = re.sub(r"[^\w\s.,!?'’:+%/°()-]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # Expand common F1 abbreviations so voices pronounce them naturally!
    s = re.sub(r"\bDRS\b", "D R S", s)
    s = re.sub(r"\bERS\b", "E R S", s)
    s = re.sub(r"\bVSC\b", "virtual safety car", s)
    s = re.sub(r"\bB-Bal\b", "brake balance", s, flags=re.IGNORECASE)
    s = re.sub(r"\bICE\b", "engine", s)
    s = re.sub(r"\bkph\b", "kilometres per hour", s, flags=re.IGNORECASE)
    s = re.sub(r"\bP(\d{1,2})\b", r"P \1", s)
    return s[:max_len].strip()


def _pcm16_to_wav(pcm_bytes: bytes, sample_rate: int = 24000, channels: int = 1) -> bytes:
    byte_rate = sample_rate * channels * 2
    block_align = channels * 2
    data_size = len(pcm_bytes)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,
        1,  # PCM
        channels,
        sample_rate,
        byte_rate,
        block_align,
        16,  # bits per sample
        b"data",
        data_size,
    )
    return header + pcm_bytes


def _resolve_cast(role: str, archetype: str = "", driver_name: str = "", tone: str = "") -> dict[str, str]:
    r_key = (role or "crofty").strip().lower()
    base = dict(ROLE_CASTING.get(r_key, ROLE_CASTING["crofty"]))
    if r_key == "driver" and archetype and archetype in ARCHETYPE_VOICE_MAP:
        base.update(ARCHETYPE_VOICE_MAP[archetype])
    if driver_name:
        dn = driver_name.lower()
        for hint, voice in DRIVER_ACCENT_HINTS.items():
            if hint in dn:
                base["edge_voice"] = voice
                break
    if tone == "warn" and r_key == "driver":
        base["gemini_style"] = base["gemini_style"] + " with urgent tension"
    elif tone == "win" and r_key in ("crofty", "brundle"):
        base["gemini_style"] = base["gemini_style"] + " building to an exciting crescendo"
    return base


def _prune_cache_if_needed() -> None:
    try:
        files = sorted(_CACHE_DIR.glob("*.*"), key=lambda p: p.stat().st_mtime)
        excess = len(files) - _MAX_CACHE_FILES
        for f in files[: max(0, excess)]:
            f.unlink(missing_ok=True)
    except Exception:
        pass


def _synth_gemini(text: str, cast: dict[str, str], reply_text: str = "") -> tuple[bytes, str]:
    api_key = get_gemini_api_key()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")
    model = get_gemini_tts_model()
    url = _GEMINI_ENDPOINT_TMPL.format(model=model)

    if reply_text:
        prompt = (
            f"{cast['gemini_style']}. Read this short Formula 1 team radio exchange naturally:\n"
            f"Driver: {text}\n"
            f"Engineer: {reply_text}"
        )
        speech_cfg: dict[str, Any] = {
            "multiSpeakerVoiceConfig": {
                "speakerVoiceConfigs": [
                    {"speaker": "Driver", "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": cast["gemini_voice"]}}},
                    {"speaker": "Engineer", "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": "Umbriel"}}},
                ]
            }
        }
    else:
        prompt = f"{cast['gemini_style']}: {text}"
        speech_cfg = {
            "voiceConfig": {
                "prebuiltVoiceConfig": {
                    "voiceName": cast["gemini_voice"],
                }
            }
        }

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": speech_cfg,
        },
    }
    resp = requests.post(
        url,
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        json=payload,
        timeout=14,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini TTS HTTP {resp.status_code}: {resp.text[:180]}")
    body = resp.json()
    parts = (((body.get("candidates") or [{}])[0]).get("content") or {}).get("parts") or []
    inline = None
    for part in parts:
        if "inlineData" in part and part["inlineData"].get("data"):
            inline = part["inlineData"]
            break
    if not inline:
        raise RuntimeError("Gemini TTS returned no inline audio data")

    raw_bytes = base64.b64decode(inline["data"])
    mime = str(inline.get("mimeType") or "audio/L16;codec=pcm;rate=24000")
    if "wav" in mime.lower() or raw_bytes[:4] == b"RIFF":
        return raw_bytes, "audio/wav"
    if "mpeg" in mime.lower() or "mp3" in mime.lower():
        return raw_bytes, "audio/mpeg"
    # Extract sample rate from audio/L16;codec=pcm;rate=24000
    rate_m = re.search(r"rate=(\d+)", mime)
    sr = int(rate_m.group(1)) if rate_m else 24000
    return _pcm16_to_wav(raw_bytes, sample_rate=sr, channels=1), "audio/wav"


def _synth_edge_tts(text: str, cast: dict[str, str]) -> tuple[bytes, str]:
    exe = find_edge_tts_bin()
    if not exe:
        raise RuntimeError("edge-tts binary not found")
    fd, tmp_path = tempfile.mkstemp(prefix="traf1_tts_", suffix=".mp3")
    os.close(fd)
    try:
        cmd = [
            exe,
            "--voice", cast["edge_voice"],
            f"--rate={cast.get('edge_rate', '+6%')}",
            f"--pitch={cast.get('edge_pitch', '+0Hz')}",
            "--text", text,
            "--write-media", tmp_path,
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=12)
        if res.returncode != 0 or not Path(tmp_path).is_file() or Path(tmp_path).stat().st_size < 128:
            raise RuntimeError(f"edge-tts failed: {(res.stderr or res.stdout)[:160]}")
        return Path(tmp_path).read_bytes(), "audio/mpeg"
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def get_voice_status() -> dict[str, Any]:
    gem_ok = bool(get_gemini_api_key())
    edge_ok = bool(find_edge_tts_bin())
    cache_count = len(list(_CACHE_DIR.glob("*.*"))) if _CACHE_DIR.exists() else 0
    active_default = "gemini" if gem_ok else ("edge" if edge_ok else "browser")
    return {
        "ok": True,
        "gemini_available": gem_ok,
        "gemini_model": get_gemini_tts_model(),
        "edge_available": edge_ok,
        "active_default": active_default,
        "cache_count": cache_count,
        "roles": list(ROLE_CASTING.keys()),
    }


def synthesize_speech(
    text: str,
    role: str = "crofty",
    archetype: str = "",
    driver_name: str = "",
    tone: str = "",
    engine: str = "auto",
    reply_text: str = "",
) -> dict[str, Any]:
    clean = clean_speech_text(text)
    if not clean:
        raise ValueError("Empty speech text")
    clean_reply = clean_speech_text(reply_text, max_len=140) if reply_text else ""
    cast = _resolve_cast(role, archetype=archetype, driver_name=driver_name, tone=tone)

    req_eng = (engine or "auto").strip().lower()
    gem_ok = bool(get_gemini_api_key())
    edge_ok = bool(find_edge_tts_bin())

    order: list[str] = []
    if req_eng == "gemini":
        order = ["gemini"] + (["edge"] if edge_ok else [])
    elif req_eng == "edge":
        order = ["edge"]
    else:
        if gem_ok:
            order.append("gemini")
        if edge_ok:
            order.append("edge")

    if not order:
        raise RuntimeError("No server TTS backend available (configure GEMINI_API_KEY or install edge-tts)")

    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    last_err = ""
    for eng in order:
        voice_id = cast["gemini_voice"] if eng == "gemini" else cast["edge_voice"]
        ext = "wav" if eng == "gemini" else "mp3"
        mime = "audio/wav" if eng == "gemini" else "audio/mpeg"
        key_src = f"{eng}|{voice_id}|{cast.get('gemini_style','') if eng == 'gemini' else cast.get('edge_rate','')}|{clean}|{clean_reply if eng == 'gemini' else ''}"
        digest = hashlib.sha256(key_src.encode("utf-8")).hexdigest()[:24]
        cache_path = _CACHE_DIR / f"{eng}_{digest}.{ext}"

        if cache_path.is_file() and cache_path.stat().st_size > 128:
            try:
                cache_path.touch()
            except Exception:
                pass
            return {
                "audio": cache_path.read_bytes(),
                "mime": mime,
                "engine": eng,
                "voice": voice_id,
                "cached": True,
            }

        try:
            if eng == "gemini":
                audio_bytes, out_mime = _synth_gemini(clean, cast, reply_text=clean_reply)
            else:
                audio_bytes, out_mime = _synth_edge_tts(clean, cast)
            with _CACHE_LOCK:
                cache_path.write_bytes(audio_bytes)
                _prune_cache_if_needed()
            return {
                "audio": audio_bytes,
                "mime": out_mime,
                "engine": eng,
                "voice": voice_id,
                "cached": False,
            }
        except Exception as exc:
            last_err = str(exc)
            LOGGER.warning("TTS backend '%s' failed (%s); trying fallback if available.", eng, exc)
            continue

    raise RuntimeError(last_err or "TTS synthesis failed")
