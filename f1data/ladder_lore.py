"""Ladder Debrief Quotes — AI driver & TP voice for the Pit Wall Ladder game mode.

Composes post-race driver quotes and team-principal reactions for the ladder's
Post-Race Debrief modal and Paddock Inbox, using the shared interview composer
(persona × mood × confidence-banded segments) and the radio voice pack so every
game mode draws from the same personality model.

Everything is deterministic: the same debrief state yields the same quotes.
"""
from __future__ import annotations

from typing import Any

from .interviews import _persona_voice, _conf_band
from .paddock_dialogue import get_radio_line


def _mood_for(finish_pos: int, grid_pos: int, end_conf: int, dnf: bool) -> str:
    """Same mood ladder the /sim interviews use, expressed from ladder race data."""
    gain = grid_pos - finish_pos if not dnf else -(grid_pos)
    if dnf:
        return "shaken" if end_conf < 42 else "frustrated"
    if finish_pos == 1 or (finish_pos <= 3 and end_conf >= 70) or gain >= 5:
        return "elated"
    if end_conf >= 68 or gain >= 2:
        return "confident"
    if end_conf <= 35 or gain <= -5:
        return "shaken"
    if end_conf < 48 or gain <= -3:
        return "frustrated"
    return "mixed"


def _persona_for(name: str) -> str:
    """Stable persona per driver, from their DNA radio archetype (curated legends sound like themselves)."""
    try:
        from .driver_dna import get_driver_dna, _dna_default_db, RADIO_STYLE_LABELS
        db = _dna_default_db()
        d = get_driver_dna(name, ensure_cache(db)) if db else None
        arch = str((d or {}).get("radio_archetype") or "")
        return {
            "clinical_perfectionist": "perfectionist",
            "stoic_minimalist": "iceman",
            "tactical_chessmaster": "veteran_statesman",
            "expressive_telemetry": "fiery_racer",
            "rhythmic_strategist": "team_player",
        }.get(arch, "team_player")
    except Exception:
        return "team_player"


def ensure_cache(db):
    from .driver_dna import ensure_dna_cache
    return ensure_dna_cache(db)


def _inferred_conf(name: str, fin: int, dnf: bool) -> int:
    """Ladder rows don't carry confidence — infer from result with per-driver seeded jitter."""
    import hashlib
    if dnf:
        base = 34
    elif fin == 1:
        base = 84
    elif fin <= 3:
        base = 78
    elif fin <= 10:
        base = 64
    else:
        base = 48
    h = int(hashlib.md5(name.encode("utf-8")).hexdigest()[:6], 16)
    return max(20, min(95, base + (h % 9) - 4))


def _quote_ctx(debrief: dict[str, Any], row: dict[str, Any], circuit: str, weather: str, safety_cars: bool) -> dict[str, Any]:
    fin = int(row.get("finish_pos") or row.get("finishPos") or row.get("pos") or 1)
    grid = int(row.get("grid_pos") or row.get("gridPos") or fin)
    conf = int(float(row.get("end_conf") or row.get("endConf") or 60))
    return {
        "circuit": circuit,
        "finish_pos": fin,
        "grid_pos": grid,
        "gain": grid - fin,
        "overtakes": int(row.get("overtakes") or max(0, grid - fin)),
        "mistakes": int(row.get("mistakes") or (1 if float(row.get("crash_bill_k") or 0) > 20 else 0)),
        "pit_delay": float(row.get("pit_delay") or 0.0),
        "end_conf": conf,
        "peak_conf": conf,
        "end_mom": int(row.get("momentum") or 0),
        "had_wet": "wet" in str(weather or "").lower() or "rain" in str(weather or "").lower(),
        "had_sc": bool(safety_cars),
        "dnf": bool(row.get("dnf")),
        "aff": 0.0,
        "eng_name": str(row.get("engineer") or "Race Engineer"),
        "era_label": str(debrief.get("era_label") or ""),
        "is_street": any(
            m in str(circuit or "").lower()
            for m in ("monaco", "monte carlo", "baku", "singapore", "jeddah", "vegas", "miami", "melbourne", "adelaide", "montreal")
        ),
    }


def build_debrief_quotes(
    debrief: dict[str, Any],
    *,
    tier: str = "f1",
    player_tp: str = "",
    player_team: str = "",
    season: int = 1,
    round_num: int = 1,
    max_quotes: int = 4,
) -> dict[str, Any]:
    """Compose the debrief voice payload: 2-4 driver quotes + one TP reaction.

    `debrief` is the ladder debrief dict (winner, player_results, weather, safety_cars...).
    Rows may carry persona/confidence; anything missing is inferred from the finish.
    """
    circuit = str(debrief.get("circuit_name") or "the circuit")
    weather = str(debrief.get("weather") or "Dry")
    sc = int(debrief.get("safety_cars") or 0)
    results = list(debrief.get("player_results") or [])
    seed_base = f"{tier}|{season}|{round_num}|{circuit}|{debrief.get('winner', '')}"

    quotes: list[dict[str, Any]] = []
    for row in results[: max(1, int(max_quotes))]:
        name = str(row.get("name") or row.get("driver") or "Driver")
        fin = int(row.get("finish_pos") or row.get("finishPos") or row.get("pos") or 1)
        grid = int(row.get("grid_pos") or row.get("gridPos") or fin)
        conf = int(float(row.get("end_conf") or row.get("endConf") or _inferred_conf(name, fin, bool(row.get("dnf")))))
        persona = str(row.get("persona") or _persona_for(name))
        mood = _mood_for(fin, grid, conf, bool(row.get("dnf")))
        ctx = _quote_ctx(debrief, row, circuit, weather, sc > 0)
        seed = f"{seed_base}|{name}"
        try:
            from .driver_dna import flavour_tags
            flavour = flavour_tags(name)
        except Exception:
            flavour = []

        quote = _persona_voice(persona, mood, ctx, seed, flavour)
        radio = get_radio_line(persona, "praise" if mood == "elated" else ("retire" if row.get("dnf") else "tyre"),
                               mood=mood, conf=conf, seed=seed + "|radio")
        quotes.append({
            "name": name,
            "team": str(row.get("team") or ""),
            "finish_pos": fin,
            "grid_pos": grid,
            "persona": persona,
            "mood": mood,
            "conf_band": _conf_band(conf),
            "end_conf": conf,
            "quote": quote,
            "radio": radio or "",
        })

    # TP reaction: shaped by the player team's relative result (points day vs damage day).
    tp_name = str(player_tp or "Team Principal")
    best_fin = min((int(r.get("finish_pos") or r.get("finishPos") or 99) for r in results), default=99)
    rep = float(debrief.get("rep_delta") or 0.0)
    crash = float(debrief.get("crash_bill_k") or 0.0)
    mood = "elated" if best_fin <= 3 and rep >= 0 else ("confident" if best_fin <= 8 else ("frustrated" if rep < -1 else "mixed"))
    tp_ctx = {
        "circuit": circuit, "finish_pos": best_fin, "grid_pos": best_fin, "gain": 0,
        "overtakes": 0, "mistakes": 1 if crash > 25 else 0, "pit_delay": 0.0,
        "end_conf": 90 if mood == "elated" else 60, "had_wet": "wet" in weather.lower(),
        "had_sc": sc > 0, "dnf": False, "aff": 0.0, "eng_name": tp_name,
        "era_label": "", "is_street": False,
    }
    tp_seed = f"{seed_base}|TP|{mood}"
    tp_voice = _persona_voice(
        "perfectionist" if crash > 25 else ("team_player" if mood != "frustrated" else "veteran_statesman"),
        mood, tp_ctx, tp_seed,
    )
    tp_reaction = {
        "name": tp_name,
        "team": str(player_team or ""),
        "mood": mood,
        "quote": f"{tp_voice}",
        "radio": get_radio_line("team_player" if mood != "frustrated" else "veteran_statesman",
                                "praise" if mood == "elated" else "tyre",
                                mood=mood, conf=70, seed=tp_seed + "|radio") or "",
    }

    return {
        "ok": True,
        "circuit": circuit,
        "tier": tier,
        "season": season,
        "round": round_num,
        "quotes": quotes,
        "tp_reaction": tp_reaction,
    }
