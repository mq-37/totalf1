"""APEX GRID (/drive) — Full Paddock Experience: Driver & Team Principal Stories,
Breaking News, Social Media Buzz, Pre-Race Commitments, Driver Cards Showcase & F1 Lore Vault.

Directly integrates existing APEX GRID data engines:
  - f1data.paddock_profiles (real 2026 & historic Team Principals, leadership styles, quotes)
  - f1data.paddock_dialogue (40+ real F1 driver speech signatures & classic tropes)
  - f1data.driver_dna (cornering styles V-Line vs U-Line, wet mastery, overtaking craft)
  - f1data.rating_engine (real F1DB-backed OVR & 6-stat Driver Cards)
  - f1data.circuits & f1data.f1db (79 GPS circuits, all-time records, era heritage)
  - f1data.fia_docs (real FIA stewarding precedents & sporting articles)
"""
from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path
from typing import Any

from .circuits import CIRCUITS_META, get_circuit
from .drive_engine import (
    DEFAULT_2026_TEAMS,
    DRIVE_PHYSICS_DNA,
    _build_default_2026_grid,
    _resolve_car_icon,
)
from .paddock_dialogue import DRIVER_VOICE_PROFILES
from .paddock_profiles import LEADERSHIP_STYLES, TEAM_PRINCIPALS_2026


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else (hi if v > hi else v)


def _seed_int(text: str) -> int:
    return int(hashlib.md5(text.encode("utf-8")).hexdigest()[:8], 16)


def _find_tp_for_team(team_name: str) -> dict[str, Any]:
    t_low = str(team_name or "").lower()
    for tp in TEAM_PRINCIPALS_2026:
        if tp["team"].lower() in t_low or t_low in tp["team"].lower():
            return tp
    return TEAM_PRINCIPALS_2026[0]


def _driver_trope(name: str) -> str:
    low = str(name or "").strip().lower()
    prof = DRIVER_VOICE_PROFILES.get(low)
    if prof and prof.get("trope"):
        return str(prof["trope"])
    return "Keep pushing — head down, hammer time."


ALL_TIME_LEGENDS_SHOWCASE: list[dict[str, Any]] = [
    {
        "driver_id": "leg_senna",
        "name": "Ayrton Senna",
        "code3": "SEN",
        "number": 12,
        "team": "McLaren",
        "era_key": "1990s",
        "era_label": "1988–1993 Icon",
        "color": "#ff3b30",
        "overall": 99,
        "pace": 99,
        "racecraft": 97,
        "wet": 99,
        "tyre_care": 91,
        "consistency": 93,
        "dna_tag": "V-Line Apex Hunter · Rain Master",
        "quote": "If you no longer go for a gap that exists, you are no longer a racing driver.",
        "rarity": "ICON",
    },
    {
        "driver_id": "leg_schumacher",
        "name": "Michael Schumacher",
        "code3": "MSC",
        "number": 1,
        "team": "Ferrari",
        "era_key": "2000s",
        "era_label": "2000–2004 V10 Era",
        "color": "#dc0000",
        "overall": 99,
        "pace": 98,
        "racecraft": 98,
        "wet": 98,
        "tyre_care": 96,
        "consistency": 99,
        "dna_tag": "Relentless Qualifying-Pace Stints",
        "quote": "Every lap is a qualifying lap when the pit wall calls for an overcut.",
        "rarity": "ICON",
    },
    {
        "driver_id": "leg_hamilton",
        "name": "Lewis Hamilton",
        "code3": "HAM",
        "number": 44,
        "team": "Ferrari",
        "era_key": "2026",
        "era_label": "7× World Champion",
        "color": "#e8002d",
        "overall": 97,
        "pace": 96,
        "racecraft": 97,
        "wet": 98,
        "tyre_care": 98,
        "consistency": 96,
        "dna_tag": "Late-Braking Tyre Whisperer",
        "quote": "Still we rise — my tyres are gone (immediately sets purple Sector 2).",
        "rarity": "LEGEND",
    },
    {
        "driver_id": "leg_verstappen",
        "name": "Max Verstappen",
        "code3": "VER",
        "number": 1,
        "team": "Red Bull Racing",
        "era_key": "2026",
        "era_label": "4× World Champion",
        "color": "#3671c6",
        "overall": 98,
        "pace": 99,
        "racecraft": 97,
        "wet": 98,
        "tyre_care": 95,
        "consistency": 98,
        "dna_tag": "Pointy Front-End V-Line Precision",
        "quote": "Simply lovely, guys — let's pull ten seconds and manage the gap.",
        "rarity": "LEGEND",
    },
    {
        "driver_id": "leg_fangio",
        "name": "Juan Manuel Fangio",
        "code3": "FAN",
        "number": 2,
        "team": "Mercedes",
        "era_key": "1950s",
        "era_label": "1950s 5× Champion",
        "color": "#c0c7d0",
        "overall": 98,
        "pace": 97,
        "racecraft": 99,
        "wet": 95,
        "tyre_care": 97,
        "consistency": 98,
        "dna_tag": "4-Wheel Drift Momentum Master",
        "quote": "You must always strive to be the best, but never believe you have arrived.",
        "rarity": "ICON",
    },
    {
        "driver_id": "leg_lauda",
        "name": "Niki Lauda",
        "code3": "LAU",
        "number": 12,
        "team": "Ferrari",
        "era_key": "1970s",
        "era_label": "1975–1984 Tactician",
        "color": "#d91e18",
        "overall": 96,
        "pace": 94,
        "racecraft": 96,
        "wet": 91,
        "tyre_care": 97,
        "consistency": 99,
        "dna_tag": "Computer-Smooth Engineering Feedback",
        "quote": "A wise man gets more from his enemies than a fool from his friends.",
        "rarity": "LEGEND",
    },
]


COMMITMENT_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "sim_cal",
        "category": "Factory Engineering",
        "icon": "fa-microchip",
        "title": "Driver-in-Loop Simulator Calibration",
        "desc": "Run 120 virtual laps testing kerb ride-height and differential maps for the upcoming circuit.",
        "effects_text": "+2.0% Cornering Grip next race · +4 TP Trust · -8 Focus",
        "deltas": {"tp_trust": 4, "team_morale": 3, "focus": -8},
        "buff": {"key": "grip_boost", "label": "+2% Sim Setup Grip", "grip_mult": 1.02},
    },
    {
        "id": "aero_debrief",
        "category": "Technical Briefing",
        "icon": "fa-wind",
        "title": "Wind-Tunnel Floor & X-Mode Debrief",
        "desc": "Work directly with the Chief Aerodynamicist to trim straight-line drag and refine active-aero deployment.",
        "effects_text": "+1.5% Top Speed / ERS Efficiency · +6 TP Trust · -6 Focus",
        "deltas": {"tp_trust": 6, "team_morale": 4, "focus": -6},
        "buff": {"key": "aero_trim", "label": "+1.5% Low-Drag Aero", "power_mult": 1.015},
    },
    {
        "id": "sponsor_gala",
        "category": "Commercial Commitment",
        "icon": "fa-champagne-glasses",
        "title": "Title Sponsor Paddock Gala",
        "desc": "Headline the title partner's VIP night in the harbour hospitality suite alongside the Team Principal.",
        "effects_text": "+6 Acclaim · +10 Media Rep · +3 TP Trust · -10 Focus",
        "deltas": {"acclaim": 6, "media_rep": 10, "tp_trust": 3, "focus": -10},
        "buff": {"key": "sponsor_hype", "label": "VIP Sponsor Momentum", "acclaim_bonus": 2},
    },
    {
        "id": "press_pen",
        "category": "FIA Media Duty",
        "icon": "fa-microphone-alt",
        "title": "Thursday FIA Press Conference",
        "desc": "Take centre stage with international journalists to frame the narrative ahead of Qualifying.",
        "effects_text": "+8 Media Rep · +4 Acclaim · +4 Rivalry Heat",
        "deltas": {"media_rep": 8, "acclaim": 4, "rivalry_heat": 4, "focus": -4},
        "buff": {"key": "media_spotlight", "label": "Headliner Buzz (+Media)", "acclaim_bonus": 1},
    },
    {
        "id": "physio_reset",
        "category": "Performance Prep",
        "icon": "fa-heart-pulse",
        "title": "Physio Ice Bath & Neck-Load Recovery",
        "desc": "Skip non-essential paddock appearances to sharpen reaction times and restore full race-day focus.",
        "effects_text": "+22 Focus · +5 Team Morale · -2 Media Rep",
        "deltas": {"focus": 22, "team_morale": 5, "media_rep": -2},
        "buff": {"key": "laser_focus", "label": "Laser Focus (Braking Stability)", "grip_mult": 1.012},
    },
    {
        "id": "kart_charity",
        "category": "Driver Community",
        "icon": "fa-trophy",
        "title": "Wet-Track Charity Karting Shootout",
        "desc": "Join rival F1 drivers for a soaked floodlit karting showcase that goes viral across social feeds.",
        "effects_text": "+5 Acclaim · +7 Media Rep · +2% Wet Confidence",
        "deltas": {"acclaim": 5, "media_rep": 7, "team_morale": 4, "focus": -5},
        "buff": {"key": "wet_instinct", "label": "+2% Wet Reflexes", "grip_mult": 1.015},
    },
]


def ensure_paddock_state(state: dict[str, Any]) -> dict[str, Any]:
    """Backwards-compatibly hydrate a POV Driver Career save with full Paddock HQ fields."""
    p = state.setdefault("player", {})
    p.setdefault("tp_trust", 64)
    p.setdefault("team_morale", 70)
    p.setdefault("media_rep", 52)
    p.setdefault("focus", 86)
    p.setdefault("rivalry_heat", 28)

    if not state.get("active_buffs"):
        state["active_buffs"] = []
    if not state.get("completed_commitments"):
        state["completed_commitments"] = []
    if not state.get("story_history"):
        state["story_history"] = []
    if not state.get("pending_stories"):
        state["pending_stories"] = _build_round_stories(state)
    if not state.get("news_feed"):
        state["news_feed"] = _build_initial_news(state)
    if not state.get("social_feed"):
        state["social_feed"] = _build_initial_social(state)
    return state


def _build_round_stories(state: dict[str, Any]) -> list[dict[str, Any]]:
    p = state["player"]
    rd = int(state.get("round") or 1)
    cal = state.get("calendar") or []
    cur_ev = cal[min(len(cal) - 1, max(0, rd - 1))] if cal else {"circuit_name": "Albert Park", "circuit_id": "melbourne"}
    cir_name = cur_ev.get("circuit_name") or "Albert Park"
    tp = _find_tp_for_team(p.get("team") or "Williams")
    style_meta = LEADERSHIP_STYLES.get(tp.get("leadership_style", ""), {})
    tm_name = p.get("teammate_name") or "Teammate"
    rival_name = p.get("rival_name") or tm_name
    seed = _seed_int(f"{state.get('save_id', 's')}-{state.get('season', 1)}-{rd}")

    # 1. Team Principal Story Arc
    tp_story = {
        "id": f"tp_r{rd}_{seed % 997}",
        "kind": "tp_story",
        "badge": "TEAM PRINCIPAL STORY",
        "actor": tp["name"],
        "role": f"Team Principal · {p.get('team')} ({style_meta.get('label', 'Leadership')})",
        "accent": p.get("color") or "#e10600",
        "title": f"{tp['name']} Calls a Closed-Door Motorhome Briefing",
        "body": (
            f"Ahead of {cir_name}, {tp['name']} lays two telemetry printouts on the desk. "
            f"\"{tp['quotes'].get('stress', 'We need sharper execution this weekend.')}\" "
            f"Only ONE revised floor specification arrived from the factory overnight — you or {tm_name} gets it first."
        ),
        "choices": [
            {
                "id": "claim_upgrade",
                "label": "Demand the New Floor",
                "hint": "+1.5% Aero Buff · +8 Rivalry · -4 Morale",
                "deltas": {"tp_trust": 2, "team_morale": -4, "rivalry_heat": 8, "acclaim": 3},
                "buff": {"key": "spec_floor", "label": "Spec-B Venturi Floor (+1.5% Grip)", "grip_mult": 1.015},
                "outcome": f"{tp['name']} nods sharply and signs off the Spec-B floor for your chassis. {tm_name}'s side of the garage goes frosty.",
                "social": f"🔥 RUMOUR: {p['name']} claimed the sole Spec-B floor at {p['team']} for {cir_name}! Garage tension already boiling before FP1. #ApexGrid",
            },
            {
                "id": "share_data",
                "label": "Split Testing & Share Setup Data",
                "hint": "+8 TP Trust · +9 Team Morale",
                "deltas": {"tp_trust": 8, "team_morale": 9, "rivalry_heat": -4, "focus": 5},
                "outcome": f"{tp['name']} praises your team-first maturity. Both engineering crews merge setup sheets for {cir_name}.",
                "social": f"👏 Class act from {p['name']} — sharing simulator correlation data across both {p['team']} garages ahead of {cir_name}. #TeamFirst",
            },
            {
                "id": "quali_shootout",
                "label": "Propose a Friday Pace Shootout",
                "hint": "+6 Acclaim · +6 Media Rep · +5 TP Trust",
                "deltas": {"acclaim": 6, "media_rep": 6, "tp_trust": 5, "rivalry_heat": 4},
                "outcome": f"Word leaks to the paddock press: fastest {p['team']} car in FP2 earns the upgrade. Fans love the pure racing meritocracy.",
                "social": f"⚡ LOVE THIS! {p['name']} challenged {tm_name} to an on-track shootout for {p['team']}'s upgrade package at {cir_name}! #F1",
            },
        ],
    }

    # 2. Driver Story Arc (Rival / Teammate / Paddock Flashpoint)
    tm_trope = _driver_trope(tm_name)
    driver_story = {
        "id": f"drv_r{rd}_{(seed // 7) % 997}",
        "kind": "driver_story",
        "badge": "DRIVER STORY",
        "actor": rival_name,
        "role": f"Grid Rival & Teammate Benchmark · {p.get('team')}",
        "accent": "#38bdf8",
        "title": f"Paddock Confrontation Over Slipstream Tow & Braking Line",
        "body": (
            f"Walking out of the {cir_name} drivers' briefing, {rival_name} catches your eye in front of the TV cameras: "
            f"\"{tm_trope}\" — then challenges your aggressive Turn 1 apex positioning and asks whether you'll honour the team's slipstream rotation in Qualifying."
        ),
        "choices": [
            {
                "id": "fire_back",
                "label": "Stand Ground on Live TV",
                "hint": "+7 Acclaim · +10 Media Rep · +10 Rivalry",
                "deltas": {"acclaim": 7, "media_rep": 10, "rivalry_heat": 10, "tp_trust": -3},
                "outcome": f"Your sharp comeback trends #1 worldwide within ten minutes. {rival_name} stalks back to the hospitality unit.",
                "social": f"🍿 BOX OFFICE! {p['name']} just told {rival_name} 'catch me at the apex if you want the tow' on live broadcast! #ApexGrid",
            },
            {
                "id": "ice_cold",
                "label": "Give an Iceman One-Liner",
                "hint": "+5 Focus · +4 Acclaim · +4 TP Trust",
                "deltas": {"focus": 5, "acclaim": 4, "tp_trust": 4, "media_rep": 4},
                "outcome": "A deadpan shrug and 'the stopwatch does the talking' wins instant respect from paddock veterans.",
                "social": f"🧊 Pure Iceman energy from {p['name']} in the {cir_name} paddock today. Zero drama, all stopwatch. #F1",
            },
            {
                "id": "ally_up",
                "label": "Shake Hands & Coordinate Strategy",
                "hint": "+8 Team Morale · -6 Rivalry · +4 TP Trust",
                "deltas": {"team_morale": 8, "rivalry_heat": -6, "tp_trust": 4},
                "outcome": f"You and {rival_name} agree on clean DRS-train cooperation to jump the midfield rivals on Sunday.",
                "social": f"🤝 {p['team']} look united at {cir_name} — {p['name']} and {rival_name} locked in on a joint qualifying tow plan!",
            },
        ],
    }

    return [tp_story, driver_story]


def _build_initial_news(state: dict[str, Any]) -> list[dict[str, Any]]:
    p = state["player"]
    rd = int(state.get("round") or 1)
    cal = state.get("calendar") or []
    ev = cal[min(len(cal) - 1, max(0, rd - 1))] if cal else {"circuit_name": "Albert Park", "weather_mode": "dry"}
    tp = _find_tp_for_team(p.get("team") or "Williams")
    return [
        {
            "tag": "BREAKING",
            "source": "APEX GRID GAZETTE",
            "title": f"{p['team']} Pin Season Hopes on #{p['number']} {p['name']} Ahead of {ev['circuit_name']}",
            "body": f"{tp['name']} confirmed full engineering backing for {p['name']} as {p['team']} targets points in {ev['weather_mode'].upper()} conditions.",
            "round": rd,
        },
        {
            "tag": "TECH WATCH",
            "source": "FIA TECHNICAL DIRECTIVE",
            "title": "2026 Active Aero X-Mode Flap Deflection Checks Tightened",
            "body": "Scrutineers installed laser load sensors on front-wing endplates; kerbs and late-braking lock-ups will test wing durability.",
            "round": rd,
        },
        {
            "tag": "SILLY SEASON",
            "source": "PADDOCK WHISPERS",
            "title": "Works Seats Watching Rookie & Midfield Telemetry Closely",
            "body": "Consistent teammate H2H dominance and high Acclaim ratings are already triggering multi-million works contract inquiries.",
            "round": rd,
        },
    ]


def _build_initial_social(state: dict[str, Any]) -> list[dict[str, Any]]:
    p = state["player"]
    rd = int(state.get("round") or 1)
    cal = state.get("calendar") or []
    ev = cal[min(len(cal) - 1, max(0, rd - 1))] if cal else {"circuit_name": "Albert Park"}
    return [
        {
            "handle": "@GridPulseF1",
            "author": "Grid Pulse Official",
            "verified": True,
            "text": f"🚨 Lights out soon at {ev['circuit_name']}! Eyes on #{p['number']} {p['name']} ({p['team']}) — can they outqualify {p['teammate_name']}? #ApexGrid #F1",
            "likes": 4820,
            "reposts": 912,
            "round": rd,
        },
        {
            "handle": "@TelemetryNerd",
            "author": "Sector 2 Telemetry",
            "verified": True,
            "text": f"Look at the braking trace for {ev['circuit_name']}: trail-braking cleanly off the kerbs saves 0.28s per lap and prevents front-left flat-spots! 📊",
            "likes": 2190,
            "reposts": 415,
            "round": rd,
        },
        {
            "handle": "@PaddockInsider",
            "author": "Paddock Insider",
            "verified": False,
            "text": f"Word in the motorhome is {p['team']} have an aggressive undercut window planned if tyres drop below 40%.",
            "likes": 1340,
            "reposts": 228,
            "round": rd,
        },
    ]


def append_post_race_paddock_buzz(state: dict[str, Any], race_res: dict[str, Any]) -> None:
    """Called right after a Driver Career race finishes to generate reactive news, social buzz & fresh stories."""
    ensure_paddock_state(state)
    p = state["player"]
    pos = int(race_res.get("player_pos") or 10)
    pts = float(race_res.get("points_scored") or 0)
    cir = str(race_res.get("circuit_name") or "Grand Prix")
    rd = int(race_res.get("round") or state.get("round") or 1)
    beat_tm = bool(race_res.get("beat_teammate"))
    tp = _find_tp_for_team(p.get("team") or "Williams")

    # Apply race outcome to TP Trust, Team Morale, Media Rep & Focus
    trust_d = (8 if pos == 1 else (5 if pos <= 3 else (2 if pos <= 10 else -4))) + (3 if beat_tm else -2)
    morale_d = (7 if pos <= 3 else (3 if pos <= 10 else -3))
    media_d = (10 if pos == 1 else (6 if pos <= 3 else (2 if beat_tm else -2)))
    p["tp_trust"] = int(_clamp(p["tp_trust"] + trust_d, 10, 100))
    p["team_morale"] = int(_clamp(p["team_morale"] + morale_d, 10, 100))
    p["media_rep"] = int(_clamp(p["media_rep"] + media_d, 10, 100))
    p["focus"] = int(_clamp(p["focus"] - 10 + (8 if pos <= 5 else 0), 25, 100))

    # Consume one-race buffs and reset round commitments
    state["active_buffs"] = []
    state["completed_commitments"] = []

    # Generate Breaking News
    headline = (
        f"MASTERCLASS! {p['name']} Storms to Victory at {cir}!"
        if pos == 1
        else (
            f"PODIUM STATEMENT: {p['name']} Delivers P{pos} for {p['team']} at {cir}"
            if pos <= 3
            else (
                f"Solid Points Haul: {p['name']} Brings {p['team']} Home P{pos} (+{pts:.0f} pts)"
                if pos <= 10
                else f"Tough Afternoon at {cir} as {p['name']} Finishes P{pos}"
            )
        )
    )
    state["news_feed"].insert(0, {
        "tag": "RACE REPORT",
        "source": "APEX GRID GAZETTE",
        "title": headline,
        "body": (
            f"{tp['name']}: \"{'Outstanding drive — everyone in the factory will celebrate this one.' if pos <= 3 else 'We take the telemetry, sharpen our pit windows, and push harder next round.'}\" "
            f"{'Outperformed' if beat_tm else 'Finished behind'} teammate {p['teammate_name']} (P{race_res.get('teammate_pos', 12)})."
        ),
        "round": rd,
    })
    state["news_feed"] = state["news_feed"][:12]

    # Generate Reactive Social Media Buzz
    buzz_txt = (
        f"🏆 WHAT A DRIVE!! #{p['number']} {p['name']} wins the {cir} Grand Prix in a {p['team']}! Driver of the Day locked in! #ApexGrid #F1"
        if pos == 1
        else (
            f"🥂 Champagne for {p['name']}! P{pos} at {cir} and another H2H tick over {p['teammate_name']}. Stock rising fast! 📈 #ApexGrid"
            if pos <= 3
            else (
                f"💪 Strong racecraft from {p['name']} to bank P{pos} at {cir} (+{pts:.0f} pts). {p['team']} pit wall nailed the strategy! #F1"
                if pos <= 10
                else f"😬 Brutal weekend for {p['team']} at {cir} (P{pos}). Expect intense debriefs with {tp['name']} before next round. #F1"
            )
        )
    )
    state["social_feed"].insert(0, {
        "handle": "@GridPulseF1",
        "author": "Grid Pulse Official",
        "verified": True,
        "text": buzz_txt,
        "likes": 14800 if pos == 1 else (7900 if pos <= 3 else 3100),
        "reposts": 3900 if pos == 1 else (1600 if pos <= 3 else 520),
        "round": rd,
    })
    state["social_feed"] = state["social_feed"][:14]

    # Refresh interactive Driver & TP Stories for the next round
    if state.get("phase") != "season_end":
        state["pending_stories"] = _build_round_stories(state)


def resolve_story_choice(state: dict[str, Any], story_id: str, choice_id: str) -> tuple[bool, str, dict[str, Any]]:
    ensure_paddock_state(state)
    stories = state.get("pending_stories") or []
    idx = next((i for i, s in enumerate(stories) if s["id"] == story_id), -1)
    if idx < 0:
        return False, "Story chapter already resolved or not found.", {}
    story = stories[idx]
    choice = next((c for c in (story.get("choices") or []) if c["id"] == choice_id), None)
    if not choice:
        return False, "Invalid story choice.", {}

    p = state["player"]
    deltas = choice.get("deltas") or {}
    for k, dv in deltas.items():
        if k in p:
            lo = 5 if k == "acclaim" else 0
            hi = 99 if k == "acclaim" else 100
            p[k] = int(_clamp(float(p[k]) + float(dv), lo, hi))

    if choice.get("buff"):
        state["active_buffs"].append(choice["buff"])
        state["active_buffs"] = state["active_buffs"][-4:]

    rd = int(state.get("round") or 1)
    if choice.get("social"):
        state["social_feed"].insert(0, {
            "handle": "@PaddockBuzz",
            "author": "Paddock Buzz Live",
            "verified": True,
            "text": choice["social"],
            "likes": 6240,
            "reposts": 1340,
            "round": rd,
        })
        state["social_feed"] = state["social_feed"][:14]

    state["news_feed"].insert(0, {
        "tag": "STORYLINE",
        "source": story["badge"],
        "title": f"{story['actor']}: {choice['label']}",
        "body": choice["outcome"],
        "round": rd,
    })
    state["news_feed"] = state["news_feed"][:12]

    state["story_history"].insert(0, {
        "round": rd,
        "badge": story["badge"],
        "actor": story["actor"],
        "title": story["title"],
        "chosen": choice["label"],
        "outcome": choice["outcome"],
    })
    state["story_history"] = state["story_history"][:20]
    stories.pop(idx)
    state["pending_stories"] = stories
    return True, choice["outcome"], {"deltas": deltas, "buff": choice.get("buff")}


def execute_commitment(state: dict[str, Any], commitment_id: str) -> tuple[bool, str, dict[str, Any]]:
    ensure_paddock_state(state)
    done = state.get("completed_commitments") or []
    if commitment_id in done:
        return False, "You already completed this commitment for the current Grand Prix weekend.", {}
    if len(done) >= 3:
        return False, "Weekend schedule full (max 3 commitments per Grand Prix — hit Lights Out!).", {}
    tpl = next((c for c in COMMITMENT_TEMPLATES if c["id"] == commitment_id), None)
    if not tpl:
        return False, "Commitment not found.", {}

    p = state["player"]
    for k, dv in (tpl.get("deltas") or {}).items():
        if k in p:
            lo = 5 if k == "acclaim" else 0
            hi = 99 if k == "acclaim" else 100
            p[k] = int(_clamp(float(p[k]) + float(dv), lo, hi))

    if tpl.get("buff"):
        state["active_buffs"].append(tpl["buff"])
        state["active_buffs"] = state["active_buffs"][-4:]

    done.append(commitment_id)
    state["completed_commitments"] = done
    rd = int(state.get("round") or 1)
    state["social_feed"].insert(0, {
        "handle": "@ApexGridDaily",
        "author": "APEX GRID Daily",
        "verified": True,
        "text": f"📅 {p['name']} ({p['team']}) completed: {tpl['title']}! ({tpl['buff']['label'] if tpl.get('buff') else 'Ready for Lights Out'}) #ApexGrid",
        "likes": 2950,
        "reposts": 480,
        "round": rd,
    })
    state["social_feed"] = state["social_feed"][:14]
    return True, f"Completed {tpl['title']}! {tpl['effects_text']}", {"buff": tpl.get("buff")}


# Hand-written paddock-lore blurbs: the story of each place, in the paddock's own voice.
# Keyed by circuit-id tokens so /drive's Lore Vault gets character text next to the F1DB stats.
CIRCUIT_LORE_COPY: dict[str, str] = {
    "monaco": "Since 1929 the streets of Monte Carlo have been the sport's chessboard. Overtaking here is nearly mythology — you qualify ahead or you suffer. The harbour yachts, the Tabac kerbs, the tunnel at 300 km/h followed by the tightest chicane on the calendar: one mistake is a season's work undone.",
    "monza": "The Temple of Speed. Monza is flat-out heritage — the old banking still stands above the trees where 1955 heroes ran at full throttle. Slipstream, chicanery at the first chicane, and the tifosi only forgive one result: red on the top step.",
    "spa": "Spa-Francorchamps wraps 7 kilometres of Ardennes forest around the greatest corner in motorsport — Eau Rouge, taken flat if you're brave and cremated if you're not. Weather is a micro-climate: it can rain at La Source and be dry at the bus stop.",
    "silverstone": "The birthplace of the World Championship, 1950. Maggotts-Becketts is the finest sequence of corners ever committed to a racing circuit — a full-throttle slalom that judges commitment better than any wind tunnel. The crowd knows its history and its Hailwoods and its Hamiltons.",
    "suzuka": "The figure-of-eight. Suzuka is the driver's championship: the 130R flat-left, the Degner curves, and the S-curves that punish hesitation in tenths of a second. A Honda homecoming, and rain from the Pacific is never more than an hour away.",
    "interlagos": "Autódromo José Carlos Pace — bumpy, tight, and tilted like an amphitheatre. Juncao's long left catches the brave out at the exit. Brazil earned its legends here: the cries for Senna still live in the grandstands, and the weather changes its mind by the lap.",
    "zandvoort": "Dune-lined and old-school, rebuilt with banked corners that let modern cars attack Arie Luyendyk in a way Max Verstappen's crowd adores. The North Sea wind changes the car between laps — setup wisdom here is to trust the driver, not the wind tunnel.",
    "singapore": "Marina Bay invented the night race — 23 corners of humidity and precision under 1600 lights. The wall at turn 18 claimed champions. Two hours of cumulative fatigue makes it the physical championship of the calendar.",
    "baku": "Baku is a 2.2 km flat-out blast down the old Silk Road followed by the narrowest corner on the calendar around the old city wall. Eight years of chaos: magnetic drain covers, red-flag reversals, and winners nobody's model predicted. Expect the unexpected — that's the local rule.",
    "vegas": "The Strip at midnight — 300+ km/h past the fountains and the Sphere. The coldest race on the calendar, the longest lap, and grip that keeps arriving as the night cools. A brand-new cathedral built for spectacle, and the racing has earned it.",
    "imola": "Imola carries weight no brochure mentions. Tamburello's memorial stands quiet outside turn one; Villeneuve's kerbs, the Autodromo's over-under, and the riverside parkland make it a driver favourite that raced its legends and its tragedies.",
    "hungaroring": "The Hungaroring is 'Monaco without the walls' — slow, twisty, and hotter than the paddock suggests. Overtaking comes only through strategy or someone else's mistake. The first race behind the Iron Curtain, 1986, and the paprika-fried crowds remain its soul.",
    "miami": "The Miami International Autodrome wraps a Hard Rock Stadium in a fake marina and real Florida heat. Five years old and already famous: the long straight into turn one produces real racing, and the bumpiest kerbs in America produce real chaos.",
    "melbourne": "Albert Park is racing in a public park — the roads close on Thursday and the world championship races on Sunday. The lake provides the backdrop, the kerbs provide the sparks, and the quick flowing lap makes it a perennial driver favourite despite the sand that blows onto the surface overnight.",
    "bahrain": "Floodlights in the desert. Bahrain's end-of-straight braking zones into slow traction corners make tyre management the whole story, and the desert wind re-sands the racing line between sessions. It launched the night-racing era in 2014 with a floodlit duel under Gulf stars.",
    "montreal": "The Île Notre-Dame circuit is a fast rollercoaster around the Olympic rowing basin — chicanes, walls, and the Champions' Wall that has ended races and egos alike. Part street circuit, part power park, wholly unforgiving; the wall of heroes keeps its name for a reason.",
    "mexico_city": "2,285 metres above the sea. Mexico City's thin air strips aerodynamic downforce and engine power alike, making the low-drag setup a gamble and braking into turn one a spectacle. The Foro Sol baseball stadium section, with the crowd roaring through the inner apse, is unique in all of motorsport.",
}


def _circuit_lore_blurb(circuit_id: str, circuit_name: str) -> str:
    low_id = str(circuit_id or "").lower()
    low_name = str(circuit_name or "").lower()
    for token, text in CIRCUIT_LORE_COPY.items():
        if not text:
            continue
        if token in low_id or token in low_name:
            return text
    return ""


def _query_f1db_circuit_lore(base_dir: Path, circuit_id: str, circuit_name: str) -> dict[str, Any]:
    lore: dict[str, Any] = {"winners": [], "races_held": 0, "first_year": None, "last_year": None}
    db_path = Path(base_dir) / "data" / "f1db.sqlite"
    if not db_path.exists():
        return lore
    try:
        con = sqlite3.connect(str(db_path), timeout=5.0)
        con.row_factory = sqlite3.Row
        key = str(circuit_id or "").lower().replace("_", "-")
        name_tok = str(circuit_name or "").split()[0].lower()
        row = con.execute(
            """
            SELECT id, full_name, total_races_held
            FROM circuit
            WHERE lower(id) LIKE ? OR lower(name) LIKE ? OR lower(full_name) LIKE ?
            LIMIT 1
            """,
            (f"%{key}%", f"%{name_tok}%", f"%{name_tok}%"),
        ).fetchone()
        if row:
            cid = row["id"]
            lore["races_held"] = int(row["total_races_held"] or 0)
            yr_row = con.execute(
                "SELECT MIN(year) AS min_y, MAX(year) AS max_y FROM race WHERE circuit_id=?",
                (cid,),
            ).fetchone()
            if yr_row:
                lore["first_year"] = yr_row["min_y"]
                lore["last_year"] = yr_row["max_y"]
            wins = con.execute(
                """
                SELECT d.name AS driver_name, COUNT(*) AS wins
                FROM race_data rd
                JOIN race r ON r.id = rd.race_id
                JOIN driver d ON d.id = rd.driver_id
                WHERE r.circuit_id = ? AND rd.type = 'RACE_RESULT' AND rd.position_number = 1
                GROUP BY d.id
                ORDER BY wins DESC
                LIMIT 4
                """,
                (cid,),
            ).fetchall()
            lore["winners"] = [{"driver": r["driver_name"], "wins": int(r["wins"])} for r in wins]
        con.close()
    except Exception:
        pass
    return lore


def _query_fia_precedent_spotlight(base_dir: Path) -> list[dict[str, str]]:
    db_path = Path(base_dir) / "data" / "fia_docs.sqlite"
    if not db_path.exists():
        return []
    try:
        con = sqlite3.connect(str(db_path), timeout=5.0)
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "SELECT season, gp_name, doc_title, category FROM fia_documents WHERE doc_title IS NOT NULL ORDER BY id DESC LIMIT 6"
        ).fetchall()
        con.close()
        return [
            {
                "season": str(r["season"] or "2025"),
                "gp": str(r["gp_name"] or "FIA"),
                "title": str(r["doc_title"] or "")[:88],
                "category": str(r["category"] or "Stewards"),
            }
            for r in rows
        ]
    except Exception:
        return []


def build_paddock_payload(
    base_dir: Path,
    *,
    career_state: dict[str, Any] | None = None,
    circuit_id: str = "melbourne",
    era_key: str = "2026",
    team_name: str = "McLaren",
    driver_name: str = "Alex Vance",
) -> dict[str, Any]:
    """Assemble the complete Paddock HQ payload: Stories, News, Social Buzz, Commitments,
    Player & Grid/Legend Driver Cards, Circuit/Era Lore, TP Dossiers & Platform Showcase."""
    if career_state is not None:
        st = ensure_paddock_state(career_state)
        p = st["player"]
        cal = st.get("calendar") or []
        rd = int(st.get("round") or 1)
        cur_ev = cal[min(len(cal) - 1, max(0, rd - 1))] if cal else {}
        eff_circuit = str(cur_ev.get("circuit_id") or circuit_id)
        eff_era = str(st.get("era_key") or era_key)
        eff_team = str(p.get("team") or team_name)
        eff_driver = str(p.get("name") or driver_name)
        grid_cards = st.get("grid") or _build_default_2026_grid()
        stories = list(st.get("pending_stories") or [])
        story_history = list(st.get("story_history") or [])
        news_feed = list(st.get("news_feed") or [])
        social_feed = list(st.get("social_feed") or [])
        completed_c = set(st.get("completed_commitments") or [])
        active_buffs = list(st.get("active_buffs") or [])
        paddock_metrics = {
            "acclaim": p.get("acclaim", 18),
            "tp_trust": p.get("tp_trust", 64),
            "team_morale": p.get("team_morale", 70),
            "media_rep": p.get("media_rep", 52),
            "focus": p.get("focus", 86),
            "rivalry_heat": p.get("rivalry_heat", 28),
            "rival_name": p.get("rival_name") or p.get("teammate_name") or "Rival",
            "career_active": True,
            "save_id": st.get("save_id"),
            "season": st.get("season", 1),
            "round": rd,
        }
    else:
        eff_circuit = circuit_id
        eff_era = era_key
        eff_team = team_name
        eff_driver = driver_name
        grid_cards = _build_default_2026_grid()
        fake_state = {
            "save_id": "quick",
            "season": 1,
            "round": 1,
            "era_key": eff_era,
            "calendar": [{"circuit_id": eff_circuit, "circuit_name": (get_circuit(eff_circuit) or {}).get("name", eff_circuit.title()), "weather_mode": "dynamic"}],
            "player": {
                "name": eff_driver,
                "number": 27,
                "team": eff_team,
                "color": next((t[1] for t in DEFAULT_2026_TEAMS if t[0].lower() == eff_team.lower()), "#ff8000"),
                "teammate_name": next((t[3][0][0] for t in DEFAULT_2026_TEAMS if t[0].lower() == eff_team.lower()), "Lando Norris"),
                "rival_name": "Max Verstappen",
                "acclaim": 42,
                "tp_trust": 70,
                "team_morale": 74,
                "media_rep": 58,
                "focus": 90,
                "rivalry_heat": 35,
            },
        }
        stories = _build_round_stories(fake_state)
        story_history = []
        news_feed = _build_initial_news(fake_state)
        social_feed = _build_initial_social(fake_state)
        completed_c = set()
        active_buffs = []
        paddock_metrics = {
            "acclaim": 42,
            "tp_trust": 70,
            "team_morale": 74,
            "media_rep": 58,
            "focus": 90,
            "rivalry_heat": 35,
            "rival_name": "Max Verstappen",
            "career_active": False,
            "save_id": None,
            "season": 1,
            "round": 1,
        }

    # Build evolving Player Driver Card
    acc = int(paddock_metrics["acclaim"])
    p_ovr = int(_clamp(72 + acc * 0.27, 74, 99))
    p_tier = "ICON" if p_ovr >= 94 else ("LEGEND" if p_ovr >= 88 else ("PRO" if p_ovr >= 81 else "ROOKIE"))
    team_col = next((t[1] for t in DEFAULT_2026_TEAMS if t[0].lower() == eff_team.lower()), "#e10600")
    player_card = {
        "driver_id": "player",
        "name": eff_driver,
        "code3": "".join(ch for ch in eff_driver.upper() if ch.isalpha())[:3] or "DRV",
        "number": int((career_state or {}).get("player", {}).get("number", 27)),
        "team": eff_team,
        "color": team_col,
        "overall": p_ovr,
        "rarity": p_tier,
        "pace": int(_clamp(p_ovr + 1, 72, 99)),
        "racecraft": int(_clamp(p_ovr + (paddock_metrics["rivalry_heat"] // 25), 72, 99)),
        "wet": int(_clamp(p_ovr - 1, 70, 99)),
        "tyre_care": int(_clamp(p_ovr - 2 + (paddock_metrics["tp_trust"] // 25), 70, 99)),
        "consistency": int(_clamp(p_ovr - 1 + (paddock_metrics["focus"] // 25), 70, 99)),
        "car_icon_url": _resolve_car_icon(eff_team, year=2026),
        "quote": "Eyes on the apex — every hundredth counts.",
        "dna_tag": f"{p_tier} POV Contender · Acclaim {acc}/100",
    }

    # Enrich 2026 Grid Driver Cards with quotes & rarity
    showcase_grid = []
    for g in grid_cards:
        if g.get("is_player"):
            continue
        ovr = int(g.get("overall") or 82)
        showcase_grid.append({
            **g,
            "rarity": "ICON" if ovr >= 94 else ("ELITE" if ovr >= 88 else ("CONTENDER" if ovr >= 82 else "GRID")),
            "quote": _driver_trope(g.get("name", "")),
            "dna_tag": "V-Line Late Braker" if int(g.get("pace") or 80) >= int(g.get("tyre_care") or 80) else "Smooth U-Line Tyre Whisperer",
        })

    # Circuit & Era Lore Vault
    cir = get_circuit(eff_circuit) or (CIRCUITS_META[0] if CIRCUITS_META else {"id": "melbourne", "name": "Albert Park"})
    era_dna = DRIVE_PHYSICS_DNA.get(eff_era) or DRIVE_PHYSICS_DNA["2026"]
    f1db_lore = _query_f1db_circuit_lore(base_dir, cir.get("id", eff_circuit), cir.get("name", ""))
    fia_spot = _query_fia_precedent_spotlight(base_dir)
    tp_dossiers = [
        {
            "name": tp["name"],
            "team": tp["team"],
            "nationality": tp["nationality"],
            "style": LEADERSHIP_STYLES.get(tp["leadership_style"], {}).get("label", tp["leadership_style"]),
            "clout": tp["political_clout"],
            "voice": tp["voice_signature"],
            "quote": tp["quotes"].get("yes", ""),
            "is_player_tp": tp["team"].lower() in eff_team.lower() or eff_team.lower() in tp["team"].lower(),
        }
        for tp in TEAM_PRINCIPALS_2026[:8]
    ]

    commitments = [
        {**c, "completed": c["id"] in completed_c}
        for c in COMMITMENT_TEMPLATES
    ]

    legends = [
        {**leg, "car_icon_url": _resolve_car_icon(leg["team"], year=2026)}
        for leg in ALL_TIME_LEGENDS_SHOWCASE
    ]

    return {
        "ok": True,
        "metrics": paddock_metrics,
        "active_buffs": active_buffs,
        "stories": stories,
        "story_history": story_history[:6],
        "news_feed": news_feed,
        "social_feed": social_feed,
        "commitments": commitments,
        "player_card": player_card,
        "grid_cards": showcase_grid[:20],
        "legend_cards": legends,
        "lore": {
            "circuit": {
                "id": cir.get("id"),
                "name": cir.get("name"),
                "gp": cir.get("gp") or cir.get("country"),
                "country": cir.get("country"),
                "length_km": cir.get("length_km"),
                "turns": cir.get("turns"),
                "drs_zones": cir.get("drs_zones"),
                "top_speed_kph": cir.get("top_speed_kph"),
                "lap_record": cir.get("lap_record") or "1:18.0",
                "aero": cir.get("aero") or "MED",
                "corners": (cir.get("corners") or [])[:8],
                "f1db": f1db_lore,
                "blurb": _circuit_lore_blurb(cir.get("id", eff_circuit), cir.get("name", "")),
            },
            "era": {
                "key": eff_era,
                "label": era_dna.get("label", eff_era),
                "top_speed_kph": era_dna.get("top_speed_kph", 340),
                "gears": era_dna.get("gears", 8),
                "mass_kg": era_dna.get("mass_kg", 768),
                "has_halo": bool(era_dna.get("halo", True)),
                "has_drs": bool(era_dna.get("drs", True)),
                "has_ers": bool(era_dna.get("ers", True)),
                "audio_profile": era_dna.get("audio_profile", "v6_hybrid"),
            },
            "tp_dossiers": tp_dossiers,
            "fia_precedents": fia_spot,
            "ecosystem": [
                {"title": "Full 3D Broadcast Sim", "href": "/sim", "icon": "fa-tv", "stat": "20-Car AI · 79 GPS Circuits · Halo POV"},
                {"title": "Pit Wall: The Ladder", "href": "/ladder", "icon": "fa-stairs", "stat": "5-Tier Karting → F1 Career Manager"},
                {"title": "Collectible Driver Cards", "href": "/cards", "icon": "fa-id-card", "stat": "76 Seasons · 1950–2026 F1DB Ratings"},
                {"title": "3D Livery & Car Studio", "href": "/dev/car-3d", "icon": "fa-cube", "stat": "201 Liveries · Era Regulation Aero"},
                {"title": "F1DB & FIA Docs Hub", "href": "/f1db", "icon": "fa-database", "stat": "792 FIA Precedents · Telemetry Archive"},
                {"title": "Team Principal Career", "href": "/career", "icon": "fa-briefcase", "stat": "Boardroom Politics · R&D Wind Tunnel"},
            ],
        },
    }
