"""
Shared F1 Card Game Engine (single source of truth for Game Edition PDFs and /play Web Arena).

Computes balanced 0-99 battle attributes, inverted DNF rate callouts, salary-cap draft costs,
badge-derived Pit Wall Abilities, and the 12-card Circuit & Weather Track Deck.
"""
from __future__ import annotations

import math
import re
from typing import Any


# ---------------------------------------------------------------------------
# Circuit & Weather Track Deck (12 iconic GP cards)
# ---------------------------------------------------------------------------
TRACK_DECK: list[dict[str, Any]] = [
    {
        "id": "monza",
        "name": "Monza",
        "subtitle": "Italian Grand Prix · Temple of Speed",
        "country": "Italy",
        "nat3": "ITA",
        "weather": "DRY",
        "weather_label": "HIGH SPEED · DRY",
        "accent": "#dc2626",
        "boost_stat": "pace",
        "boost_delta": 10,
        "underdog_bonus": 0,
        "rule": "PACE calls gain +10 bonus. Pure one-lap velocity rules the straights.",
        "flavour": "Full throttle for 80% of the lap — slipstream and top speed decide everything.",
    },
    {
        "id": "monaco",
        "name": "Monaco",
        "subtitle": "Monte Carlo · Street Circuit",
        "country": "Monaco",
        "nat3": "MON",
        "weather": "STREET",
        "weather_label": "STREET · PRECISION",
        "accent": "#d97706",
        "boost_stat": "reliability",
        "boost_delta": 10,
        "underdog_bonus": 8,
        "rule": "RELIABILITY +10. Underdogs (OVR < 78) gain +8 Street Precision on any call.",
        "flavour": "Millimetres from the barriers — keeping it out of the wall beats raw horsepower.",
    },
    {
        "id": "spa",
        "name": "Spa-Francorchamps",
        "subtitle": "Belgian Grand Prix · Ardennes Storm",
        "country": "Belgium",
        "nat3": "BEL",
        "weather": "WET",
        "weather_label": "WET RACE · RAIN",
        "accent": "#0284c7",
        "boost_stat": "racecraft",
        "boost_delta": 10,
        "underdog_bonus": 10,
        "rule": "RACECRAFT +10. Wet Weather Equaliser: OVR < 78 drivers gain +10 Chaos Bonus!",
        "flavour": "Eau Rouge in heavy spray — bravery and car control level the machinery gap.",
    },
    {
        "id": "interlagos",
        "name": "Interlagos",
        "subtitle": "Sao Paulo Grand Prix · Storm Chaos",
        "country": "Brazil",
        "nat3": "BRA",
        "weather": "WET",
        "weather_label": "WET · CHAOS",
        "accent": "#16a34a",
        "boost_stat": "clutch",
        "boost_delta": 10,
        "underdog_bonus": 10,
        "rule": "CLUTCH +10. Tropical downpour gives OVR < 78 underdogs +10 Chaos Bonus!",
        "flavour": "Championship deciders, late Safety Cars, and iconic wet-weather charges.",
    },
    {
        "id": "silverstone",
        "name": "Silverstone",
        "subtitle": "British Grand Prix · High-Speed Aero",
        "country": "Great Britain",
        "nat3": "GBR",
        "weather": "DRY",
        "weather_label": "HIGH DOWNFORCE",
        "accent": "#2563eb",
        "boost_stat": "racecraft",
        "boost_delta": 8,
        "underdog_bonus": 0,
        "rule": "RACECRAFT +8. Maggotts-Becketts rewards committed wheel-to-wheel speed.",
        "flavour": "The birthplace of Formula 1 — flat-out sweeps and fearless overtaking.",
    },
    {
        "id": "suzuka",
        "name": "Suzuka",
        "subtitle": "Japanese Grand Prix · Figure-Eight",
        "country": "Japan",
        "nat3": "JPN",
        "weather": "DRY",
        "weather_label": "TECHNICAL · DRY",
        "accent": "#e11d48",
        "boost_stat": "duels",
        "boost_delta": 10,
        "underdog_bonus": 0,
        "rule": "DUELS +10. The ultimate driver's track exposes teammate gaps immediately.",
        "flavour": "Esses, Spoon, and 130R — where driver skill outshines everything else.",
    },
    {
        "id": "singapore",
        "name": "Marina Bay",
        "subtitle": "Singapore Grand Prix · Night Heat",
        "country": "Singapore",
        "nat3": "SGP",
        "weather": "NIGHT",
        "weather_label": "NIGHT · ENDURANCE",
        "accent": "#7c3aed",
        "boost_stat": "dnf_rate",
        "boost_delta": 0,
        "underdog_bonus": 6,
        "rule": "RELIABILITY +8 & low DNF shines. Underdogs (OVR < 78) gain +6 Night Grit.",
        "flavour": "Two hours under floodlights in 80% humidity — survival is half the battle.",
    },
    {
        "id": "baku",
        "name": "Baku City Circuit",
        "subtitle": "Azerbaijan Grand Prix · Safety Car Havoc",
        "country": "Azerbaijan",
        "nat3": "AZE",
        "weather": "CHAOS",
        "weather_label": "STREET · CHAOS",
        "accent": "#0891b2",
        "boost_stat": "pace",
        "boost_delta": 8,
        "underdog_bonus": 12,
        "rule": "PACE +8. Red-Flag Chaos: OVR < 78 drivers gain +12 Wildcard Bonus!",
        "flavour": "Castle section tightness meets a 2.2 km slipstream straight — anything happens.",
    },
    {
        "id": "montreal",
        "name": "Gilles Villeneuve",
        "subtitle": "Canadian Grand Prix · Wall of Champions",
        "country": "Canada",
        "nat3": "CAN",
        "weather": "CHAOS",
        "weather_label": "BRAKING · CHAOS",
        "accent": "#ef4444",
        "boost_stat": "clutch",
        "boost_delta": 8,
        "underdog_bonus": 6,
        "rule": "CLUTCH +8. Heavy braking zones reward late brakers (+6 for OVR < 78).",
        "flavour": "Chicanes, kerbs, and the Wall of Champions waiting on the final exit.",
    },
    {
        "id": "spielberg",
        "name": "Red Bull Ring",
        "subtitle": "Austrian Grand Prix · Sprint Shootout",
        "country": "Austria",
        "nat3": "AUT",
        "weather": "DRY",
        "weather_label": "SHORT LAP · SPRINT",
        "accent": "#b91c1c",
        "boost_stat": "duels",
        "boost_delta": 8,
        "underdog_bonus": 4,
        "rule": "DUELS +8. Three DRS zones turn every lap into a wheel-to-wheel scrap.",
        "flavour": "Ten corners in the Styrian hills — lap times measured in thousandths.",
    },
    {
        "id": "austin",
        "name": "Circuit of the Americas",
        "subtitle": "United States Grand Prix · Turn 1 Climb",
        "country": "United States",
        "nat3": "USA",
        "weather": "DRY",
        "weather_label": "ALL-ROUND · DRY",
        "accent": "#1d4ed8",
        "boost_stat": "racecraft",
        "boost_delta": 8,
        "underdog_bonus": 4,
        "rule": "RACECRAFT +8. Multi-line hairpins reward daring dive-bombs (+4 OVR < 78).",
        "flavour": "Inspired by the best corners in F1 — wide apexes built for overtakes.",
    },
    {
        "id": "abudhabi",
        "name": "Yas Marina",
        "subtitle": "Abu Dhabi Grand Prix · Season Finale",
        "country": "UAE",
        "nat3": "UAE",
        "weather": "NIGHT",
        "weather_label": "TWILIGHT · FINALE",
        "accent": "#ca8a04",
        "boost_stat": "clutch",
        "boost_delta": 12,
        "underdog_bonus": 0,
        "rule": "CLUTCH +12. Championship Finale doubles down on big-moment nerves.",
        "flavour": "Sunset to floodlights — titles won and lost under the desert sky.",
    },
]


BATTLE_STATS: list[dict[str, Any]] = [
    {"key": "pace", "label": "PACE", "dir": "high", "color": "#7c3aed", "desc": "Qualifying speed, poles & teammate Q-H2H"},
    {"key": "racecraft", "label": "RACECRAFT", "dir": "high", "color": "#e10600", "desc": "Positions gained, race H2H & conversion"},
    {"key": "reliability", "label": "CONSISTENCY", "dir": "high", "color": "#0284c7", "desc": "Fault-adjusted cleanliness (excludes mech DNFs)"},
    {"key": "duels", "label": "DUELS", "dir": "high", "color": "#0d9488", "desc": "Quali + race teammate head-to-head dominance"},
    {"key": "clutch", "label": "CLUTCH", "dir": "high", "color": "#d97706", "desc": "Titles, Grand Slams, DOTD & big-moment wins"},
    {"key": "wet", "label": "WET", "dir": "high", "color": "#0ea5e9", "desc": "Wet-weather & street-circuit overperformance"},
    {"key": "tyre_care", "label": "TYRE CARE", "dir": "high", "color": "#10b981", "desc": "Stint pace retention & mechanical sympathy"},
    {"key": "dnf_rate", "label": "FAULT DNF", "dir": "low", "color": "#475569", "desc": "Driver-fault crash % only (lower wins!)"},
]


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def clean_driver_name(raw: str) -> tuple[str, str]:
    s = (raw or "").strip()
    m = re.search(r"\s+([A-Z]{3})$", s)
    if m:
        return s[: m.start()].strip(), m.group(1)
    return s, ""


def compute_game_profile(card: dict[str, Any], year: int | None = None) -> dict[str, Any]:
    """
    Compute fair, era-normalized, machinery-adjusted game attributes (F1DB + FIA Docs + Driver DNA),
    driver-fault DNF rate, draft salary cost, tier, and Pit Wall Ability from any card dict.
    """
    from .rating_engine import compute_fair_attributes

    fair = compute_fair_attributes(card, year=year)
    st = fair["stats"]
    tel = fair["telemetry"]

    pace = int(st["pace"])
    racecraft = int(st["racecraft"])
    reliability = int(st["reliability"])
    duels = int(st["duels"])
    clutch = int(st["clutch"])
    wet = int(st["wet"])
    tyre_care = int(st["tyre_care"])
    discipline = int(st["discipline"])
    dnf_rate = float(st["dnf_rate"])

    starts = max(0, int(card.get("starts") or 0))
    podiums = max(0, int(card.get("podiums") or 0))
    fl = max(0, int(card.get("fastest_laps") or 0))
    seasons = max(
        1,
        int(
            card.get("seasons")
            or card.get("experience_seasons")
            or card.get("career_seasons")
            or len(card.get("cars") or [])
            or 1
        ),
    )
    career_seasons = max(
        seasons,
        int(
            card.get("career_seasons")
            or (card.get("legacy") or {}).get("years")
            or card.get("experience_seasons")
            or seasons
        ),
    )
    overall = float(fair["fair_overall"])
    champ_years = card.get("champion_years") or []
    championships = max(
        int(card.get("championships") or 0),
        len(champ_years) if isinstance(champ_years, (list, tuple)) else 0,
    )
    titles_period = int(card.get("titles_decade") or 0)
    fl_rate = (fl / max(1, starts)) * 100.0 if starts > 0 else float(card.get("fl_rate") or 0.0)
    pod_rate = (podiums / max(1, starts)) * 100.0 if starts > 0 else float(card.get("podium_rate") or 0.0)
    q_h2h = float(tel.get("quali_h2h_pct") or 50.0)
    r_h2h = float(tel.get("race_h2h_pct") or 50.0)

    # ------------------------------------------------------------------
    # Fair Draft Salary Cost ($5M – $30M) & Collector/Game Tier
    # ------------------------------------------------------------------
    power_score = (pace + racecraft + reliability + duels + clutch + wet + tyre_care) / 7.0
    cost_raw = 5.0 + max(0.0, (overall - 63.0) * 0.56) + min(5.5, championships * 1.0)
    cost_m = int(round(_clamp(cost_raw, 5.0, 30.0)))

    if championships >= 2 or overall >= 92.0:
        tier = "ICON"
    elif championships >= 1 or overall >= 84.0:
        tier = "ELITE"
    elif overall >= 76.0:
        tier = "CONTENDER"
    elif career_seasons <= 2:
        tier = "ROOKIE"
    else:
        tier = "CHALLENGER"

    # ------------------------------------------------------------------
    # Signature Pit Wall Ability (every single card gets a real tactic!)
    # ------------------------------------------------------------------
    badges_lower = [str(b).lower() for b in (card.get("badges") or [])]

    if any("rookie" in b for b in badges_lower) or (career_seasons <= 2 and overall >= 72.0):
        ability = {
            "key": "giant_killer",
            "name": "GIANT KILLER",
            "badge": "ROOKIE",
            "summary": "+12 to any stat when facing a World Champion.",
            "accent": "#0284c7",
            "active_bonus_stat": "any_vs_champ",
            "active_bonus_val": 12,
        }
    elif wet >= 93:
        ability = {
            "key": "rain_master",
            "name": "RAIN MASTER",
            "badge": "WET",
            "summary": "+8 WET & +6 RACECRAFT on Wet or Chaos circuits.",
            "accent": "#0ea5e9",
            "active_bonus_stat": "wet",
            "active_bonus_val": 8,
        }
    elif any("fastest" in b for b in badges_lower) or pace >= 91 or fl_rate >= 16.0:
        ability = {
            "key": "drs_overtake",
            "name": "DRS OVERTAKE",
            "badge": "SPEED",
            "summary": "+6 PACE on attack; once/match switch opponent call to PACE.",
            "accent": "#7c3aed",
            "active_bonus_stat": "pace",
            "active_bonus_val": 6,
        }
    elif (q_h2h >= 66.0 and r_h2h >= 64.0) or duels >= 85:
        ability = {
            "key": "undercut",
            "name": "UNDERCUT",
            "badge": "DUELS",
            "summary": "+8 DUELS; wins stat ties automatically.",
            "accent": "#0d9488",
            "active_bonus_stat": "duels",
            "active_bonus_val": 8,
        }
    elif championships >= 1 or any("champion" in b or "goat" in b for b in badges_lower):
        ability = {
            "key": "championship_aura",
            "name": "CHAMPIONSHIP AURA",
            "badge": "CHAMPION",
            "summary": "+5 CLUTCH; wins ties & blocks opponent DRS steals.",
            "accent": "#d97706",
            "active_bonus_stat": "clutch",
            "active_bonus_val": 5,
        }
    elif tyre_care >= 87 or any("veteran" in b for b in badges_lower) or career_seasons >= 12:
        ability = {
            "key": "tyre_whisperer",
            "name": "TYRE WHISPERER",
            "badge": "TYRE",
            "summary": "+7 TYRE CARE & CONSISTENCY; halves Fault DNF% on consistency calls.",
            "accent": "#10b981",
            "active_bonus_stat": "tyre_care",
            "active_bonus_val": 7,
        }
    elif pod_rate >= 22.0 or float(tel.get("avg_pos_gained") or 0.0) >= 1.2:
        ability = {
            "key": "late_braker",
            "name": "LATE BRAKER",
            "badge": "RACER",
            "summary": "+7 RACECRAFT when trailing or tied in the match.",
            "accent": "#dc2626",
            "active_bonus_stat": "racecraft",
            "active_bonus_val": 7,
        }
    else:
        ability = {
            "key": "slipstream",
            "name": "SLIPSTREAM",
            "badge": "UNDERDOG",
            "summary": "+10 to any stat when facing an OVR 84+ rival!",
            "accent": "#16a34a",
            "active_bonus_stat": "any_vs_elite",
            "active_bonus_val": 10,
        }

    return {
        "stats": {
            "pace": pace,
            "racecraft": racecraft,
            "reliability": reliability,
            "duels": duels,
            "clutch": clutch,
            "wet": wet,
            "tyre_care": tyre_care,
            "discipline": discipline,
            "dnf_rate": dnf_rate,
        },
        "fair_overall": overall,
        "driver_skill": fair["driver_skill"],
        "car_strength_est": fair["car_strength_est"],
        "telemetry": tel,
        "power_avg": round(power_score, 1),
        "cost_m": cost_m,
        "tier": tier,
        "ability": ability,
        "is_champion": championships > 0 or titles_period > 0,
    }
