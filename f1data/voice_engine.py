"""
Hybrid F1 Broadcast & Team Radio Neural Voice Engine — Authentic European, British, Irish
& Real Driver/Engineer Nationality Accents (1950-2026).

Priority tiers (engine="auto"):
  1. Gemini TTS (gemini-2.5-flash-preview-tts or GEMINI_TTS_MODEL) when GEMINI_API_KEY
     is configured in environment or `traf1/.env`. Uses rich accent & acting direction
     grounded in each driver's actual nationality from `data/f1.sqlite` (`drivers_standings`),
     regional British/Scottish/Irish overrides, and team engineer nationalities.
  2. Free Microsoft Neural Edge-TTS (local `edge-tts` CLI) — zero API key required,
     defaulting to British/Irish/Australian/European neural voices (never generic US unless USA).
  3. SHA-256 disk cache under `data/tts_cache/` (250-file LRU cap) for ~2ms repeat playback.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
import re
import shutil
import sqlite3
import struct
import subprocess
import tempfile
import threading
import time
import unicodedata
from pathlib import Path
from typing import Any

import requests

LOGGER = logging.getLogger("f1data.voice")
_BASE_DIR = Path(__file__).resolve().parent.parent
_ENV_FILE = _BASE_DIR / ".env"
_DATA_DB = _BASE_DIR / "data" / "f1.sqlite"
_CACHE_DIR = _BASE_DIR / "data" / "tts_cache"
_CACHE_LOCK = threading.Lock()
_NAT_LOCK = threading.Lock()
_NAT_CACHE: dict[str, str] | None = None
_GEMINI_COOLDOWN_UNTIL: float = 0.0
_MAX_CACHE_FILES = 250

DEFAULT_GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts"
_GEMINI_ENDPOINT_TMPL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# All 36 FIA Nationality Codes in f1.sqlite -> Authentic English Accent Direction + Edge-TTS Neural Voice
NATIONALITY_PROFILES: dict[str, dict[str, str]] = {
    "GBR": {
        "label": "British",
        "accent_prompt": "an unmistakable British English accent (crisp non-rhotic English vowels, never American)",
        "edge_voice": "en-GB-RyanNeural",
        "gemini_voice": "Fenrir",
    },
    "SCO": {
        "label": "Scottish",
        "accent_prompt": "a crisp, warm Scottish English accent (never American)",
        "edge_voice": "en-GB-ThomasNeural",
        "gemini_voice": "Charon",
    },
    "IRL": {
        "label": "Irish",
        "accent_prompt": "a warm, unmistakable Irish English accent (never American)",
        "edge_voice": "en-IE-ConnorNeural",
        "gemini_voice": "Orus",
    },
    "NED": {
        "label": "Dutch",
        "accent_prompt": "English spoken with a natural, direct Dutch accent (like a Dutch F1 driver from the Netherlands, never American)",
        "edge_voice": "en-GB-RyanNeural",
        "gemini_voice": "Puck",
    },
    "MON": {
        "label": "Monégasque",
        "accent_prompt": "English spoken with a refined French-Monégasque accent (like a driver from Monaco, never American)",
        "edge_voice": "fr-FR-RemyMultilingualNeural",
        "gemini_voice": "Aoede",
    },
    "FRA": {
        "label": "French",
        "accent_prompt": "English spoken with a natural French accent (never American)",
        "edge_voice": "fr-FR-RemyMultilingualNeural",
        "gemini_voice": "Aoede",
    },
    "ITA": {
        "label": "Italian",
        "accent_prompt": "English spoken with an authentic, expressive Italian accent (never American)",
        "edge_voice": "it-IT-GiuseppeMultilingualNeural",
        "gemini_voice": "Schedar",
    },
    "ESP": {
        "label": "Spanish",
        "accent_prompt": "English spoken with a crisp, authentic Spanish accent (never American)",
        "edge_voice": "it-IT-GiuseppeMultilingualNeural",
        "gemini_voice": "Schedar",
    },
    "GER": {
        "label": "German",
        "accent_prompt": "English spoken with a crisp, articulate German accent (never American)",
        "edge_voice": "en-GB-ThomasNeural",
        "gemini_voice": "Algenib",
    },
    "AUT": {
        "label": "Austrian",
        "accent_prompt": "English spoken with a calm, clipped Austrian-German accent (never American)",
        "edge_voice": "en-GB-ThomasNeural",
        "gemini_voice": "Charon",
    },
    "FIN": {
        "label": "Finnish",
        "accent_prompt": "English spoken with a dry, calm, deadpan Finnish accent (never American)",
        "edge_voice": "en-GB-ThomasNeural",
        "gemini_voice": "Enceladus",
    },
    "AUS": {
        "label": "Australian",
        "accent_prompt": "a relaxed, unmistakable Australian English accent (never American)",
        "edge_voice": "en-AU-WilliamMultilingualNeural",
        "gemini_voice": "Enceladus",
    },
    "NZL": {
        "label": "New Zealand",
        "accent_prompt": "a crisp New Zealand Kiwi English accent (never American)",
        "edge_voice": "en-NZ-MitchellNeural",
        "gemini_voice": "Umbriel",
    },
    "BEL": {
        "label": "Belgian",
        "accent_prompt": "English spoken with a smooth Belgian European accent (never American)",
        "edge_voice": "fr-FR-RemyMultilingualNeural",
        "gemini_voice": "Umbriel",
    },
    "DEN": {
        "label": "Danish",
        "accent_prompt": "English spoken with a natural Danish Scandinavian accent (never American)",
        "edge_voice": "en-GB-RyanNeural",
        "gemini_voice": "Algenib",
    },
    "SWE": {
        "label": "Swedish",
        "accent_prompt": "English spoken with a clean Swedish Scandinavian accent (never American)",
        "edge_voice": "en-GB-ThomasNeural",
        "gemini_voice": "Enceladus",
    },
    "SUI": {
        "label": "Swiss",
        "accent_prompt": "English spoken with a calm Swiss-European accent (never American)",
        "edge_voice": "en-GB-ThomasNeural",
        "gemini_voice": "Charon",
    },
    "POL": {
        "label": "Polish",
        "accent_prompt": "English spoken with an authentic Polish Eastern European accent (never American)",
        "edge_voice": "en-GB-ThomasNeural",
        "gemini_voice": "Orus",
    },
    "POR": {
        "label": "Portuguese",
        "accent_prompt": "English spoken with a natural Portuguese European accent (never American)",
        "edge_voice": "en-GB-RyanNeural",
        "gemini_voice": "Schedar",
    },
    "HUN": {
        "label": "Hungarian",
        "accent_prompt": "English spoken with a Central European Hungarian accent (never American)",
        "edge_voice": "en-GB-ThomasNeural",
        "gemini_voice": "Orus",
    },
    "BRA": {
        "label": "Brazilian",
        "accent_prompt": "English spoken with a warm, rhythmic Brazilian Portuguese accent (never American)",
        "edge_voice": "en-GB-RyanNeural",
        "gemini_voice": "Puck",
    },
    "ARG": {
        "label": "Argentine",
        "accent_prompt": "English spoken with a smooth Argentine Spanish accent (never American)",
        "edge_voice": "en-GB-ThomasNeural",
        "gemini_voice": "Charon",
    },
    "MEX": {
        "label": "Mexican",
        "accent_prompt": "English spoken with a natural Mexican Spanish accent",
        "edge_voice": "en-GB-RyanNeural",
        "gemini_voice": "Achird",
    },
    "COL": {
        "label": "Colombian",
        "accent_prompt": "English spoken with an energetic Colombian Spanish accent",
        "edge_voice": "en-GB-RyanNeural",
        "gemini_voice": "Puck",
    },
    "VEN": {
        "label": "Venezuelan",
        "accent_prompt": "English spoken with a Venezuelan Spanish accent",
        "edge_voice": "en-GB-RyanNeural",
        "gemini_voice": "Puck",
    },
    "CHI": {
        "label": "Chilean",
        "accent_prompt": "English spoken with a Chilean Spanish accent",
        "edge_voice": "en-GB-ThomasNeural",
        "gemini_voice": "Umbriel",
    },
    "JPN": {
        "label": "Japanese",
        "accent_prompt": "English spoken with an authentic, energetic Japanese accent (never American)",
        "edge_voice": "en-GB-RyanNeural",
        "gemini_voice": "Aoede",
    },
    "THA": {
        "label": "British-Thai",
        "accent_prompt": "a natural London British English accent (like Alex Albon, never American)",
        "edge_voice": "en-GB-RyanNeural",
        "gemini_voice": "Achird",
    },
    "CHN": {
        "label": "Chinese",
        "accent_prompt": "English spoken with a fluent British-educated Chinese accent (never American)",
        "edge_voice": "en-GB-ThomasNeural",
        "gemini_voice": "Umbriel",
    },
    "IND": {
        "label": "Indian",
        "accent_prompt": "English spoken with a crisp Indian English accent (never American)",
        "edge_voice": "en-IN-PrabhatNeural",
        "gemini_voice": "Orus",
    },
    "MAS": {
        "label": "Malaysian",
        "accent_prompt": "English spoken with a Commonwealth Malaysian accent (never American)",
        "edge_voice": "en-GB-RyanNeural",
        "gemini_voice": "Umbriel",
    },
    "INA": {
        "label": "Indonesian",
        "accent_prompt": "English spoken with a natural Indonesian accent (never American)",
        "edge_voice": "en-GB-ThomasNeural",
        "gemini_voice": "Umbriel",
    },
    "RSA": {
        "label": "South African",
        "accent_prompt": "a crisp South African English accent (never American)",
        "edge_voice": "en-ZA-LukeNeural",
        "gemini_voice": "Charon",
    },
    "CAN": {
        "label": "Canadian",
        "accent_prompt": "a natural Canadian English accent",
        "edge_voice": "en-CA-LiamNeural",
        "gemini_voice": "Umbriel",
    },
    "RUS": {
        "label": "Russian",
        "accent_prompt": "English spoken with a natural Russian accent (never American)",
        "edge_voice": "en-GB-ThomasNeural",
        "gemini_voice": "Algenib",
    },
    "RAF": {
        "label": "Eastern European",
        "accent_prompt": "English spoken with a natural Eastern European accent (never American)",
        "edge_voice": "en-GB-ThomasNeural",
        "gemini_voice": "Algenib",
    },
    "USA": {
        "label": "American",
        "accent_prompt": "a natural American motorsport driver accent",
        "edge_voice": "en-US-AndrewMultilingualNeural",
        "gemini_voice": "Puck",
    },
}

# Regional Scottish / Irish / Modern 2026 overrides
REGIONAL_DRIVER_OVERRIDES: dict[str, str] = {
    "jim clark": "SCO",
    "jackie stewart": "SCO",
    "david coulthard": "SCO",
    "paul di resta": "SCO",
    "allan mcnish": "SCO",
    "eddie irvine": "IRL",
    "john watson": "IRL",
    "martin donnelly": "IRL",
    "ralph firman": "IRL",
    "derek daly": "IRL",
    "tommy byrne": "IRL",
    "kimi antonelli": "ITA",
    "andrea kimi antonelli": "ITA",
    "oliver bearman": "GBR",
    "arvid lindblad": "GBR",
    "isack hadjar": "FRA",
    "gabriel bortoleto": "BRA",
    "jack doohan": "AUS",
    "liam lawson": "NZL",
    "franco colapinto": "ARG",
    "ryo hirakawa": "JPN",
    "max verstappen": "NED",
    "charles leclerc": "MON",
    "oscar piastri": "AUS",
    "lando norris": "GBR",
    "lewis hamilton": "GBR",
    "george russell": "GBR",
    "fernando alonso": "ESP",
    "carlos sainz": "ESP",
    "pierre gasly": "FRA",
    "esteban ocon": "FRA",
    "nico hulkenberg": "GER",
    "yuki tsunoda": "JPN",
    "alex albon": "THA",
    "alexander albon": "THA",
    "lance stroll": "CAN",
    "valtteri bottas": "FIN",
    "sergio perez": "MEX",
    "ayrton senna": "BRA",
    "alain prost": "FRA",
    "michael schumacher": "GER",
    "niki lauda": "AUT",
    "juan manuel fangio": "ARG",
    "mika hakkinen": "FIN",
    "kimi raikkonen": "FIN",
    "sebastian vettel": "GER",
    "jenson button": "GBR",
    "nigel mansell": "GBR",
    "damon hill": "GBR",
    "graham hill": "GBR",
    "james hunt": "GBR",
    "stirling moss": "GBR",
    "jack brabham": "AUS",
    "daniel ricciardo": "AUS",
    "gilles villeneuve": "CAN",
    "mario andretti": "USA",
}

# Authentic Race Engineer Nationalities (British, Irish, Italian, French, German, Japanese!)
ENGINEER_NATIONALITIES: dict[str, str] = {
    "bonnington": "GBR", "bono": "GBR",
    "dudley": "GBR",
    "lambiase": "GBR", "gp": "GBR",
    "bird": "GBR",
    "bozzi": "ITA",
    "adami": "ITA",
    "joseph": "GBR",
    "stallard": "GBR",
    "vizard": "GBR",
    "gannon": "IRL",
    "howard": "GBR",
    "peckett": "GBR",
    "jego": "FRA",
    "urwin": "GBR",
    "o'hare": "IRL", "ohare": "IRL",
    "mueller": "GER",
    "petrik": "AUT",
    "lopez": "ESP",
    "weber": "GER",
    "spini": "ITA",
    "hamelin": "FRA",
    "mitchell": "GBR",
    "rossi": "ITA",
    "chapman": "GBR",
    "warr": "GBR",
    "symonds": "GBR",
    "villadelprat": "ESP",
    "permane": "GBR",
    "nelson": "GBR",
    "bellini": "ITA",
    "bennett": "GBR",
    "kowalski": "POL",
    "lindqvist": "SWE",
    "tanaka": "JPN",
    "moreau": "FRA",
}

# Core Broadcast Role Casting (Strongly British & European!)
ROLE_CASTING: dict[str, dict[str, Any]] = {
    "crofty": {
        "gemini_voice": "Fenrir",
        "gemini_style": (
            "Speak in a strong, unmistakable British English accent (Sky Sports F1 London lead commentator — "
            "crisp non-rhotic British vowels, never American). Deliver with breathless live Formula 1 excitement"
        ),
        "edge_voice": "en-GB-RyanNeural",
        "edge_rate": "+10%",
        "edge_pitch": "+3Hz",
    },
    "brundle": {
        "gemini_voice": "Charon",
        "gemini_style": (
            "Speak in a warm, classic British English accent (experienced English former F1 driver doing "
            "live TV co-commentary — unmistakable British cadence, never American). Sound sharp and insightful"
        ),
        "edge_voice": "en-GB-ThomasNeural",
        "edge_rate": "+5%",
        "edge_pitch": "-2Hz",
    },
    "stewards": {
        "gemini_voice": "Orus",
        "gemini_style": (
            "Speak in a crisp, formal British-European English accent (official FIA Race Control announcer "
            "from London/Geneva, never American). Sound calm and authoritative"
        ),
        "edge_voice": "en-GB-SoniaNeural",
        "edge_rate": "+3%",
        "edge_pitch": "+0Hz",
    },
    "engineer": {
        "gemini_voice": "Umbriel",
        "gemini_style": (
            "Speak in an authentic British English accent (never American), calmly and concisely like a "
            "Formula 1 race engineer speaking over pit-wall headset radio"
        ),
        "edge_voice": "en-GB-ThomasNeural",
        "edge_rate": "+7%",
        "edge_pitch": "-1Hz",
    },
    "driver": {
        "gemini_voice": "Puck",
        "gemini_style": (
            "Speak in a European English accent (never American), urgently and tersely like a Formula 1 "
            "driver speaking at 300 kph over cockpit team radio"
        ),
        "edge_voice": "en-GB-RyanNeural",
        "edge_rate": "+8%",
        "edge_pitch": "+0Hz",
    },
}

ARCHETYPE_DELIVERY: dict[str, str] = {
    "clinical_perfectionist": "tersely, intensely, and with laser-sharp technical focus over cockpit team radio",
    "rhythmic_strategist": "smoothly, calmly, and thoughtfully like a seasoned world champion over cockpit team radio",
    "tactical_chessmaster": "sharply and shrewdly while negotiating pit strategy over cockpit team radio",
    "expressive_telemetry": "with high adrenaline, passion, and urgency at 300 kph over cockpit team radio",
    "stoic_minimalist": "ultra-calmly, flatly, and deadpan with zero panic over cockpit team radio",
}


def _norm_key(raw: str) -> str:
    s = unicodedata.normalize("NFKD", str(raw or "")).encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"\s+[a-z]{3}$", "", s.strip())
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def _ensure_nat_cache() -> dict[str, str]:
    global _NAT_CACHE
    if _NAT_CACHE is not None:
        return _NAT_CACHE
    with _NAT_LOCK:
        if _NAT_CACHE is not None:
            return _NAT_CACHE
        mapping: dict[str, str] = {}
        if _DATA_DB.is_file():
            try:
                conn = sqlite3.connect(f"file:{_DATA_DB}?mode=ro", uri=True)
                try:
                    rows = conn.execute(
                        "SELECT driver, nationality FROM drivers_standings WHERE driver IS NOT NULL AND nationality IS NOT NULL"
                    ).fetchall()
                    for drv, nat in rows:
                        dk = _norm_key(drv)
                        nc = str(nat or "").strip().upper()
                        if dk and nc:
                            mapping[dk] = nc
                finally:
                    conn.close()
            except Exception:
                pass
        mapping.update(REGIONAL_DRIVER_OVERRIDES)
        _NAT_CACHE = mapping
        return _NAT_CACHE


def lookup_nationality(driver_name: str = "", engineer_name: str = "", explicit_nat: str = "") -> str:
    if explicit_nat:
        ec = explicit_nat.strip().upper()
        if ec in NATIONALITY_PROFILES:
            return ec
    if engineer_name:
        en = engineer_name.lower()
        for k, nat in ENGINEER_NATIONALITIES.items():
            if k in en:
                return nat
    if driver_name:
        dk = _norm_key(driver_name)
        if dk in REGIONAL_DRIVER_OVERRIDES:
            return REGIONAL_DRIVER_OVERRIDES[dk]
        nc = _ensure_nat_cache().get(dk)
        if nc:
            return nc
        # Surname match fallback against regional overrides
        parts = dk.split()
        if parts:
            last = parts[-1]
            for k, nat in REGIONAL_DRIVER_OVERRIDES.items():
                if k.endswith(" " + last) or k == last:
                    return nat
    return "GBR"


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
    s = re.sub(r"^(?:[^\w]*(?:CROFTY|BRUNDLE|FIA STEWARDS|FIA RACE CONTROL|PIT BOARD|MARSHAL OBS)\s*[:·—-]\s*)", "", s, flags=re.IGNORECASE)
    s = re.sub(r"[^\w\s.,!?'’:+%/°()-]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
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
        1,
        channels,
        sample_rate,
        byte_rate,
        block_align,
        16,
        b"data",
        data_size,
    )
    return header + pcm_bytes


def _resolve_cast(
    role: str,
    archetype: str = "",
    driver_name: str = "",
    tone: str = "",
    engineer_name: str = "",
    nationality: str = "",
) -> dict[str, str]:
    r_key = (role or "crofty").strip().lower()
    base = dict(ROLE_CASTING.get(r_key, ROLE_CASTING["crofty"]))
    nat_code = "GBR"

    if r_key == "driver":
        nat_code = lookup_nationality(driver_name=driver_name, explicit_nat=nationality)
        prof = NATIONALITY_PROFILES.get(nat_code, NATIONALITY_PROFILES["GBR"])
        delivery = ARCHETYPE_DELIVERY.get(archetype, "urgently and crisply over cockpit team radio")
        base["gemini_voice"] = prof["gemini_voice"]
        base["edge_voice"] = prof["edge_voice"]
        base["gemini_style"] = f"Speak in {prof['accent_prompt']}. Deliver {delivery}"
        base["edge_rate"] = "+2%" if archetype == "stoic_minimalist" else ("+10%" if archetype == "expressive_telemetry" else "+7%")
        base["edge_pitch"] = "-2Hz" if archetype == "stoic_minimalist" else "+0Hz"
    elif r_key == "engineer":
        nat_code = lookup_nationality(engineer_name=engineer_name, explicit_nat=nationality)
        prof = NATIONALITY_PROFILES.get(nat_code, NATIONALITY_PROFILES["GBR"])
        base["gemini_voice"] = "Umbriel" if nat_code in ("GBR", "IRL", "SCO") else prof["gemini_voice"]
        base["edge_voice"] = prof["edge_voice"] if nat_code in ("IRL", "ITA", "FRA", "MON", "AUS", "NZL") else ("en-GB-ThomasNeural" if nat_code != "USA" else "en-US-AndrewMultilingualNeural")
        base["gemini_style"] = (
            f"Speak in {prof['accent_prompt']}. Deliver calmly, concisely, and decisively like a "
            f"Formula 1 race engineer speaking over pit-wall headset radio"
        )

    if tone == "warn" and r_key == "driver":
        base["gemini_style"] = base["gemini_style"] + " with urgent tension"
    elif tone == "win" and r_key in ("crofty", "brundle"):
        base["gemini_style"] = base["gemini_style"] + ", building to an exciting crescendo"

    base["nationality"] = nat_code
    base["accent_label"] = NATIONALITY_PROFILES.get(nat_code, NATIONALITY_PROFILES["GBR"])["label"]
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
            f"{cast['gemini_style']}. Read this short Formula 1 team radio exchange naturally "
            f"(Engineer speaks in a calm British/European accent):\n"
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
        "nationalities_supported": len(NATIONALITY_PROFILES),
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
    engineer_name: str = "",
    nationality: str = "",
) -> dict[str, Any]:
    clean = clean_speech_text(text)
    if not clean:
        raise ValueError("Empty speech text")
    clean_reply = clean_speech_text(reply_text, max_len=140) if reply_text else ""
    cast = _resolve_cast(
        role,
        archetype=archetype,
        driver_name=driver_name,
        tone=tone,
        engineer_name=engineer_name,
        nationality=nationality,
    )

    global _GEMINI_COOLDOWN_UNTIL
    req_eng = (engine or "auto").strip().lower()
    gem_ok = bool(get_gemini_api_key())
    gem_ready = gem_ok and (time.time() >= _GEMINI_COOLDOWN_UNTIL)
    edge_ok = bool(find_edge_tts_bin())

    order: list[str] = []
    if req_eng == "gemini":
        order = ["gemini"] + (["edge"] if edge_ok else [])
    elif req_eng == "edge":
        order = ["edge"]
    else:
        if gem_ready:
            order.append("gemini")
        if edge_ok:
            order.append("edge")
        if not order and gem_ok:
            order.append("gemini")

    if not order:
        raise RuntimeError("No server TTS backend available (configure GEMINI_API_KEY or install edge-tts)")

    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    last_err = ""
    for eng in order:
        voice_id = cast["gemini_voice"] if eng == "gemini" else cast["edge_voice"]
        ext = "wav" if eng == "gemini" else "mp3"
        mime = "audio/wav" if eng == "gemini" else "audio/mpeg"
        key_src = f"v2|{eng}|{voice_id}|{cast.get('nationality','')}|{cast.get('gemini_style','') if eng == 'gemini' else cast.get('edge_rate','')}|{clean}|{clean_reply if eng == 'gemini' else ''}"
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
                "accent": cast.get("accent_label", "British"),
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
                "accent": cast.get("accent_label", "British"),
                "cached": False,
            }
        except Exception as exc:
            last_err = str(exc)
            if eng == "gemini" and "HTTP 429" in last_err:
                _GEMINI_COOLDOWN_UNTIL = time.time() + 90.0
                LOGGER.warning("Gemini TTS quota/rate limit (429) — cooling down 90s and using European/British Edge-TTS.")
            else:
                LOGGER.warning("TTS backend '%s' failed (%s); trying fallback if available.", eng, exc)
            continue

    raise RuntimeError(last_err or "TTS synthesis failed")
