"""
F1 Team Principal Season & Career Manager Engine.

Single source of truth for /career and /api/career/*.
Leverages real historical & 2026 F1 data from f1.sqlite (drivers, portraits,
team liveries, stats, Pit Wall abilities) and all 24 real GPS circuits from
f1data/circuits.py.

Persists active career state in data/career_state.json (leaving f1.sqlite
strictly read-only for historical F1 records).
"""
from __future__ import annotations

import json
import math
import random
import time
import zlib
from pathlib import Path
from typing import Any

from .circuits import CIRCUITS
from . import career_db

FIA_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1]
PU_ALLOCATION = {"ice": 4, "ers": 3, "gearbox": 4}

DEV_FOCUSES: dict[str, dict[str, str]] = {
    "balanced":    {"label": "Balanced (+1 Pace, +1 Race)", "stat": "balanced"},
    "pace":        {"label": "Quali Pace (+2 Pace)", "stat": "pace"},
    "racecraft":   {"label": "Racecraft (+2 Race)", "stat": "racecraft"},
    "wet":         {"label": "Wet Weather (+2 Wet)", "stat": "wet"},
    "reliability": {"label": "Consistency (+2 Rel)", "stat": "reliability"},
}

STAFF_ROLES: list[dict[str, str]] = [
    {"id": "tech_director", "name": "Technical Director", "icon": "fa-drafting-compass", "bonus_desc": "Boosts R&D part gains & Next-Gen Research"},
    {"id": "head_aero", "name": "Head of Aerodynamics", "icon": "fa-wind", "bonus_desc": "Direct Aero pace & Wind Tunnel multiplier"},
    {"id": "race_engineer", "name": "Chief Race Engineer", "icon": "fa-headset", "bonus_desc": "Higher FP Car Setup accuracy & lower tyre overheat"},
    {"id": "sporting_dir", "name": "Sporting Director", "icon": "fa-stopwatch", "bonus_desc": "Faster pit stops & fewer pit-crew mistakes"},
]

STAFF_CANDIDATES: list[dict[str, Any]] = [
    {"id": "st_newey",   "role": "tech_director", "name": "Adrian Sterling",   "nat": "GBR", "rating": 95, "salary_m": 6.2, "hire_m": 5.5, "trait": "Ground-Effect Genius (+18% R&D)"},
    {"id": "st_allison", "role": "tech_director", "name": "James Holloway",    "nat": "GBR", "rating": 89, "salary_m": 4.4, "hire_m": 3.6, "trait": "Chassis Correlation (+12% R&D)"},
    {"id": "st_key",     "role": "tech_director", "name": "Marco Bellini",     "nat": "ITA", "rating": 82, "salary_m": 2.9, "hire_m": 2.1, "trait": "Cost-Cap Specialist (+8% R&D)"},
    {"id": "st_fallows", "role": "head_aero",     "name": "Dan Vance",         "nat": "GBR", "rating": 92, "salary_m": 4.8, "hire_m": 4.2, "trait": "High-Downforce Guru (+2.4 Car OVR)"},
    {"id": "st_sanchez", "role": "head_aero",     "name": "David Moreau",      "nat": "FRA", "rating": 86, "salary_m": 3.4, "hire_m": 2.8, "trait": "Sidepod Undercut (+1.7 Car OVR)"},
    {"id": "st_todi",    "role": "head_aero",     "name": "Kenji Takahashi",   "nat": "JPN", "rating": 79, "salary_m": 2.1, "hire_m": 1.5, "trait": "CFD Efficiency (+0.8 Car OVR)"},
    {"id": "st_gp",      "role": "race_engineer", "name": "Gianpiero Rossi",   "nat": "ITA", "rating": 94, "salary_m": 3.8, "hire_m": 3.2, "trait": "Ice-Cold Pit Wall (+92% Auto-Setup)"},
    {"id": "st_bono",    "role": "race_engineer", "name": "Peter Brooks",      "nat": "GBR", "rating": 90, "salary_m": 3.1, "hire_m": 2.5, "trait": "Tyre Whisperer (-10% Overheat)"},
    {"id": "st_bryan",   "role": "race_engineer", "name": "Liam Lindholm",     "nat": "SWE", "rating": 81, "salary_m": 1.9, "hire_m": 1.4, "trait": "Telemetry Analyst (+84% Auto-Setup)"},
    {"id": "st_wheat",   "role": "sporting_dir",  "name": "Jonathan Mercer",   "nat": "GBR", "rating": 94, "salary_m": 3.9, "hire_m": 3.4, "trait": "2.1s Pit Crew Drill (-0.65s Pit)"},
    {"id": "st_schmitz", "role": "sporting_dir",  "name": "Hannah Lindner",    "nat": "GBR", "rating": 91, "salary_m": 3.3, "hire_m": 2.7, "trait": "Strategy Mastermind (-0.50s Pit)"},
    {"id": "st_mekies",  "role": "sporting_dir",  "name": "Laurent Delacroix", "nat": "FRA", "rating": 83, "salary_m": 2.2, "hire_m": 1.6, "trait": "FIA Rules Expert (-0.30s Pit)"},
]

DILEMMA_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "flex_wing_td",
        "tag": "FIA DIRECTIVE",
        "title": "FIA Technical Directive on Flexible Front Wings",
        "body": "Rival team principals have protested your front wing aero-elasticity ahead of the next Grand Prix. How will you respond?",
        "choices": [
            {"label": "Urgent Carbon Redesign (-$3.2M, +1.5 Aero, +4 Board)", "cash": -3.2, "rd": {"aero": 1.5}, "board": 4, "morale": 2},
            {"label": "Comply With Stiffened Spec (Free, -0.8 Aero, +2 Board)", "cash": 0.0, "rd": {"aero": -0.8}, "board": 2, "morale": 0},
            {"label": "Lobby FIA Stewards (-$0.8M, Keep Spec, -3 Board)", "cash": -0.8, "rd": {}, "board": -3, "morale": 3},
        ],
    },
    {
        "id": "sponsor_shoot",
        "tag": "COMMERCIAL",
        "title": "Title Sponsor Global Filming Day Request",
        "body": "Your Title Sponsor wants both race drivers for a 2-day commercial shoot before the Grand Prix weekend.",
        "choices": [
            {"label": "Approve Full Shoot (+$3.6M Cash, -4% Driver Morale)", "cash": 3.6, "rd": {}, "board": 4, "morale": -4},
            {"label": "Send Reserve Driver Instead (+$1.4M Cash, +20 Reserve XP)", "cash": 1.4, "rd": {}, "board": 1, "morale": 1, "reserve_xp": 20},
            {"label": "Decline — Simulator Focus (+3% Morale, +15 Driver XP)", "cash": 0.0, "rd": {}, "board": -2, "morale": 3, "driver_xp": 15},
        ],
    },
    {
        "id": "poach_aero",
        "tag": "PADDOCK RUMOUR",
        "title": "Rival Constructor Poaching Senior Aero Lead",
        "body": "A top rival has tabled a lucrative offer to headhunt your lead CFD aerodynamicist mid-season.",
        "choices": [
            {"label": "Match Contract & Promote (-$2.4M, +1.2 Aero & +1.0 Next-Gen)", "cash": -2.4, "rd": {"aero": 1.2}, "nextgen": {"aero": 1.0}, "board": 2, "morale": 3},
            {"label": "Let Them Walk, Promote Junior (Free, -0.6 Aero, +$1.2M Saving)", "cash": 1.2, "rd": {"aero": -0.6}, "board": -2, "morale": -1},
        ],
    },
    {
        "id": "young_fp1",
        "tag": "FIA MANDATE",
        "title": "FIA Rookie FP1 Track Session Opportunity",
        "body": "Give your Reserve/Academy driver track mileage during Friday practice to collect FIA youth incentive funding.",
        "choices": [
            {"label": "Run Reserve in FP1 (+$1.8M Grant, +38 Reserve XP, +3 Board)", "cash": 1.8, "rd": {}, "board": 3, "morale": 0, "reserve_xp": 38},
            {"label": "Keep Both Race Drivers (+12 Race Driver XP, +3% Morale)", "cash": 0.0, "rd": {}, "board": 0, "morale": 3, "driver_xp": 12},
        ],
    },
    {
        "id": "wind_breakthrough",
        "tag": "FACTORY LAB",
        "title": "Wind Tunnel Floor Venturi Breakthrough",
        "body": "Your CFD team discovered a potent floor-edge vortex gain — apply it to this year's car or bank it for next year's regulations?",
        "choices": [
            {"label": "Fast-Track Current Floor (-$3.8M, +2.0 Chassis immediately)", "cash": -3.8, "rd": {"chassis": 2.0}, "board": 3, "morale": 4},
            {"label": "Bank Into Next-Season Spec (-$1.8M, +2.6 Next-Gen Chassis)", "cash": -1.8, "nextgen": {"chassis": 2.6}, "board": 2, "morale": 1},
            {"label": "Share Data With Tyre Group (Free, +0.9 Tyre Care)", "cash": 0.0, "rd": {"tyre_care": 0.9}, "board": 1, "morale": 1},
        ],
    },
    {
        "id": "pirelli_test",
        "tag": "TYRE TEST",
        "title": "Pirelli Private Compound Development Test",
        "body": "Pirelli invited your team to stay an extra day after the GP to test next-generation slick constructions.",
        "choices": [
            {"label": "Accept Full Tyre Test (-$1.5M, +1.8 Tyre Care, +1.5 Next-Gen)", "cash": -1.5, "rd": {"tyre_care": 1.8}, "nextgen": {"tyre_care": 1.5}, "board": 2, "morale": 2},
            {"label": "Skip Test & Refresh Crew (+$0.5M Saved, +4% Morale)", "cash": 0.5, "rd": {}, "board": 0, "morale": 4},
        ],
    },
    {
        "id": "ers_mapping",
        "tag": "POWERTRAIN",
        "title": "Experimental ERS MGU-K Software Mapping",
        "body": "Your powertrain engineers compiled an aggressive deployment map that adds straight-line punch at a slight reliability cost.",
        "choices": [
            {"label": "Deploy Aggressive Map (-$1.2M, +1.8 Power, -5% PU Health)", "cash": -1.2, "rd": {"power": 1.8}, "pu_wear": 5, "board": 2, "morale": 3},
            {"label": "Conservative Reliability Mode (Free, +8% PU Health All Units)", "cash": 0.0, "rd": {}, "pu_wear": -8, "board": 1, "morale": 1},
        ],
    },
    {
        "id": "pit_bootcamp",
        "tag": "OPERATIONS",
        "title": "Pit Crew High-Pressure Wheel-Gun Bootcamp",
        "body": "Your Sporting Director proposes an intensive pit-stop simulation week to shave tenths in the pit lane.",
        "choices": [
            {"label": "Fund Bootcamp (-$2.0M, +3 Sporting Dir Rating, +3% Morale)", "cash": -2.0, "staff_boost": ("sporting_dir", 3), "board": 2, "morale": 3},
            {"label": "Standard Drill Schedule (Free, +1% Morale)", "cash": 0.0, "board": 0, "morale": 1},
        ],
    },
]

FACILITY_DEFS: list[dict[str, Any]] = [
    {
        "id": "wind_tunnel",
        "name": "Wind Tunnel",
        "icon": "fa-wind",
        "category": "Aero",
        "desc": "Boosts High/Medium-downforce cornering pace and speeds up Aero R&D gains.",
        "base_cost": 9.0,
        "upkeep_per_lvl": 0.45,
        "bonus_label": "+{v} Aero Rating",
        "bonus_per_lvl": 3,
    },
    {
        "id": "cfd_factory",
        "name": "CFD & Chassis Factory",
        "icon": "fa-industry",
        "category": "Chassis",
        "desc": "Improves top-speed efficiency, chassis balance, and concurrent R&D throughput.",
        "base_cost": 8.5,
        "upkeep_per_lvl": 0.40,
        "bonus_label": "+{v} Chassis Pace",
        "bonus_per_lvl": 3,
    },
    {
        "id": "powertrain_lab",
        "name": "Powertrain & ERS Lab",
        "icon": "fa-bolt",
        "category": "Power",
        "desc": "Increases ERS recharge rate, Overtake deployment punch, and cuts mechanical DNF risk.",
        "base_cost": 9.5,
        "upkeep_per_lvl": 0.50,
        "bonus_label": "-{v}% DNF · +{e}% ERS",
        "bonus_per_lvl": 8,
    },
    {
        "id": "pit_sim",
        "name": "Pit Crew & Race Sim",
        "icon": "fa-stopwatch",
        "category": "Operations",
        "desc": "Shaves real seconds off pit-stop loss during live GPs and accelerates driver XP growth.",
        "base_cost": 6.5,
        "upkeep_per_lvl": 0.30,
        "bonus_label": "-{v}s Pit Loss",
        "bonus_per_lvl": 0.65,
    },
    {
        "id": "scouting_hub",
        "name": "Scouting & Telemetry Hub",
        "icon": "fa-binoculars",
        "category": "Scouting",
        "desc": "Unlocks extra Scout Slots (Lvl 1: 1, Lvl 3: 2, Lvl 5: 3) and halves scouting report time.",
        "base_cost": 5.5,
        "upkeep_per_lvl": 0.25,
        "bonus_label": "{v} Scout Slots",
        "bonus_per_lvl": 1,
    },
    {
        "id": "hospitality",
        "name": "Hospitality & Sponsors",
        "icon": "fa-handshake",
        "category": "Commercial",
        "desc": "Increases per-race sponsor revenue, driver morale, and transfer negotiation pull.",
        "base_cost": 6.0,
        "upkeep_per_lvl": 0.25,
        "bonus_label": "+{v}% Sponsor Income",
        "bonus_per_lvl": 12,
    },
]

RD_PARTS: list[dict[str, Any]] = [
    {"id": "aero", "name": "Front & Rear Wings", "icon": "fa-feather-alt", "desc": "High-speed cornering & downforce grip"},
    {"id": "chassis", "name": "Floor & Diffuser", "icon": "fa-layer-group", "desc": "Ground-effect stability & straightline efficiency"},
    {"id": "power", "name": "Power Unit & MGU-K", "icon": "fa-fire", "desc": "Top speed, acceleration & reliability"},
    {"id": "tyre_care", "name": "Suspension & Cooling", "icon": "fa-dharmachakra", "desc": "Reduces tyre degradation & extends stint cliff"},
]

# Authentic 6-Component F1 Car Blueprint Tree (Design -> Wind-Tunnel ATR -> Manufacture Spares -> Track Correlation!)
CAR_BLUEPRINTS: list[dict[str, Any]] = [
    {"id": "front_wing",     "name": "Front Wing & Endplates",    "icon": "fa-fighter-jet",     "primary": "aero",      "secondary": "tyre_care", "base_cost": 3.6, "spare_cost": 0.9, "base_gain": 2.6, "desc": "Low/medium-speed turn-in balance & front tyre bite"},
    {"id": "floor_diffuser", "name": "Venturi Floor & Diffuser",  "icon": "fa-layer-group",     "primary": "aero",      "secondary": "chassis",   "base_cost": 5.4, "spare_cost": 1.5, "base_gain": 3.8, "desc": "Peak ground-effect downforce & anti-porpoising stability"},
    {"id": "rear_wing",      "name": "Rear Wing & Active Aero",   "icon": "fa-wind",            "primary": "power",     "secondary": "aero",      "base_cost": 3.8, "spare_cost": 1.0, "base_gain": 2.8, "desc": "DRS/X-Mode drag shedding & straightline efficiency"},
    {"id": "sidepods",       "name": "Sidepods & Cooling Louvres","icon": "fa-fire",            "primary": "power",     "secondary": "chassis",   "base_cost": 4.4, "spare_cost": 1.2, "base_gain": 3.1, "desc": "Undercut airflow & ICE/ERS thermal reliability"},
    {"id": "chassis_tub",    "name": "Monocoque & Weight Save",   "icon": "fa-shield-alt",      "primary": "chassis",   "secondary": "tyre_care", "base_cost": 5.2, "spare_cost": 1.6, "base_gain": 3.5, "desc": "Minimum-weight carbon tub & kerb compliance"},
    {"id": "suspension",     "name": "Push/Pull-Rod Suspension",  "icon": "fa-dharmachakra",    "primary": "tyre_care", "secondary": "chassis",   "base_cost": 4.0, "spare_cost": 1.1, "base_gain": 2.9, "desc": "Anti-dive platform control & extended tyre stint life"},
]

# Official FIA Aerodynamic Testing Restrictions (ATR) Sliding Scale by WCC Position (1st=70% .. 10th=115%)
ATR_BASE_WT_HRS = 32.0
ATR_BASE_CFD_ITEMS = 1600


def _atr_pct_for_wcc_pos(pos: int) -> int:
    return int(_clamp(70 + (max(1, pos) - 1) * 5, 70, 115))


def _compute_wcc_pos(state: dict[str, Any], team_id: str) -> int:
    teams = sorted(state.get("teams") or [], key=lambda x: (-x.get("points", 0), -x.get("wins", 0), -x.get("car_overall", 0)))
    return next((i + 1 for i, t in enumerate(teams) if t.get("id") == team_id), len(teams) or 10)


def _refresh_atr_period(state: dict[str, Any], period_num: int) -> dict[str, Any]:
    pt = get_player_team(state)
    wcc_pos = _compute_wcc_pos(state, pt["id"])
    pct = _atr_pct_for_wcc_pos(wcc_pos)
    wt_max = round(ATR_BASE_WT_HRS * (pct / 100.0), 1)
    cfd_max = int(round(ATR_BASE_CFD_ITEMS * (pct / 100.0)))
    rnd = int(state.get("current_round") or 1)
    atr = {
        "period": period_num,
        "wcc_rank": wcc_pos,
        "atr_pct": pct,
        "wt_hrs_max": wt_max,
        "wt_hrs_rem": wt_max,
        "cfd_max": cfd_max,
        "cfd_rem": cfd_max,
        "next_reset_round": rnd + 4,
    }
    state["atr"] = atr
    return atr


def _ensure_rd_v3(state: dict[str, Any]) -> None:
    if not isinstance(state.get("atr"), dict) or "wt_hrs_max" not in state["atr"]:
        _refresh_atr_period(state, 1)
    inv = state.get("parts_inventory")
    if not isinstance(inv, dict):
        inv = {}
        state["parts_inventory"] = inv
    for bp in CAR_BLUEPRINTS:
        cid = bp["id"]
        if cid not in inv or not isinstance(inv[cid], dict):
            inv[cid] = {"spec": 1, "spares": 2, "last_corr": "Nominal"}
    if not isinstance(state.get("rd_history"), list):
        state["rd_history"] = []

SPONSOR_CATALOG: list[dict[str, Any]] = [
    {
        "id": "apex_cloud",
        "name": "ApexCloud Telemetry",
        "tier": "Title",
        "per_race_m": 2.4,
        "bonus_m": 1.8,
        "goal_type": "top10",
        "goal_text": "Finish in the Points (Top 10) with either car",
    },
    {
        "id": "veloce_watch",
        "name": "Veloce Chronographs",
        "tier": "Title",
        "per_race_m": 2.9,
        "bonus_m": 3.2,
        "goal_type": "top6",
        "goal_text": "Finish Top 6 with at least one car",
    },
    {
        "id": "hyperion_energy",
        "name": "Hyperion Energy",
        "tier": "Title",
        "per_race_m": 3.5,
        "bonus_m": 4.5,
        "goal_type": "podium",
        "goal_text": "Score a Podium (Top 3) finish",
    },
    {
        "id": "nordic_air",
        "name": "Nordic Air Cargo",
        "tier": "Secondary",
        "per_race_m": 1.3,
        "bonus_m": 1.4,
        "goal_type": "both_finish",
        "goal_text": "Bring both cars home (Zero DNFs)",
    },
    {
        "id": "carbon_forge",
        "name": "CarbonForge Aero",
        "tier": "Secondary",
        "per_race_m": 1.5,
        "bonus_m": 2.2,
        "goal_type": "double_points",
        "goal_text": "Score Double Points (both cars Top 10)",
    },
    {
        "id": "quantum_fuel",
        "name": "Quantum eFuels",
        "tier": "Secondary",
        "per_race_m": 1.7,
        "bonus_m": 2.6,
        "goal_type": "fastest_lap",
        "goal_text": "Set the Race Fastest Lap or Win",
    },
]

HIDDEN_TRAITS = [
    "Rain Whisperer (+4 Wet Pace)",
    "Tyre Saver (-12% Wear)",
    "Quali Rocket (+3 Grid Pace)",
    "Late Braker (+4 Overtake)",
    "Iron Nerve (+5 Final 5 Laps)",
    "Sponsor Magnet (+$0.4M/Race)",
    "Simulator Ace (+30% XP Gain)",
    "Clean Racer (-25% DNF Risk)",
]

CALENDAR_PRESETS = {
    "8": ["melbourne", "monaco", "silverstone", "spa", "monza", "madrid", "suzuka", "abudhabi"],
    "12": [
        "melbourne", "bahrain", "suzuka", "miami", "monaco", "montreal",
        "silverstone", "spa", "monza", "madrid", "interlagos", "abudhabi",
    ],
    "24": [c["id"] for c in CIRCUITS],
}


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def _save_path(base_dir: Path) -> Path:
    return base_dir / "data" / "career_state.json"


def load_career(base_dir: Path) -> dict[str, Any] | None:
    st = career_db.load_active_career(base_dir)
    return _ensure_career_v2(st) if isinstance(st, dict) else None


def save_career(
    base_dir: Path,
    state: dict[str, Any],
    checkpoint_label: str | None = None,
    expected_version: int | None = None,
) -> int:
    return career_db.save_active_career(
        base_dir,
        state,
        checkpoint_label=checkpoint_label,
        expected_version=expected_version,
    )


def delete_career(base_dir: Path) -> None:
    sid = career_db.get_active_slot_id(base_dir)
    if sid:
        career_db.delete_slot(base_dir, sid)


def _circuit_by_id(cid: str) -> dict[str, Any]:
    for c in CIRCUITS:
        if c["id"] == cid:
            return c
    return CIRCUITS[0]


def _scout_slots_for_level(lvl: int) -> int:
    if lvl >= 5:
        return 3
    if lvl >= 3:
        return 2
    return 1


def _facility_upgrade_cost(fac_id: str, current_lvl: int) -> float:
    fdef = next((f for f in FACILITY_DEFS if f["id"] == fac_id), None)
    if not fdef:
        return 10.0
    return round(fdef["base_cost"] * (1.38 ** (current_lvl - 1)), 1)


def _compute_car_overall(team: dict[str, Any], staff: dict[str, Any] | None = None) -> float:
    rd = team["rd"]
    fac = team.get("facilities") or {}
    wt_bonus = (fac.get("wind_tunnel", 1) - 1) * 1.6
    cfd_bonus = (fac.get("cfd_factory", 1) - 1) * 1.5
    pu_bonus = (fac.get("powertrain_lab", 1) - 1) * 1.4
    staff_aero = 0.0
    if staff and team.get("is_player"):
        ha = staff.get("head_aero") or {}
        staff_aero = max(0.0, (float(ha.get("rating", 72)) - 72.0) * 0.12)
    base = rd["aero"] * 0.28 + rd["chassis"] * 0.27 + rd["power"] * 0.26 + rd["tyre_care"] * 0.19
    return round(_clamp(base + wt_bonus + cfd_bonus + pu_bonus + staff_aero, 40.0, 99.0), 1)


def _ideal_setup_for_circuit(circuit: dict[str, Any]) -> dict[str, int]:
    """Deterministic real-world ideal car setup sweet spot (0-100) for each of the 24 F1 circuits."""
    aero = str(circuit.get("aero") or "MED").upper()
    turns = int(circuit.get("turns") or 16)
    wear = int(circuit.get("tyre_wear") or 3)
    h = sum(ord(ch) * (i + 3) for i, ch in enumerate(str(circuit.get("id") or "f1")))
    wing_base = 84 if aero == "HIGH" else (28 if aero == "LOW" else 56)
    susp_base = 34 if aero == "HIGH" else (74 if aero == "LOW" else 54)
    diff_base = 72 if turns >= 18 else (40 if aero == "LOW" else 55)
    wing = int(_clamp(wing_base + ((h % 17) - 8), 16, 94))
    susp = int(_clamp(susp_base + (((h // 7) % 17) - 8) + (wear - 3) * 3, 18, 90))
    diff = int(_clamp(diff_base + (((h // 19) % 19) - 9), 20, 90))
    return {"wing": wing, "susp": susp, "diff": diff}


def _default_staff_for_team(car_ovr: float) -> dict[str, dict[str, Any]]:
    base = int(_clamp(round(car_ovr - 3), 68, 84))
    return {
        "tech_director": {"id": "init_td", "role": "tech_director", "name": "Claire Vance", "nat": "GBR", "rating": base, "salary_m": 1.8, "trait": "Factory Systems"},
        "head_aero":     {"id": "init_ha", "role": "head_aero",     "name": "Matteo Conti", "nat": "ITA", "rating": base, "salary_m": 1.6, "trait": "Wind Tunnel Ops"},
        "race_engineer": {"id": "init_re", "role": "race_engineer", "name": "Samir Patel",  "nat": "GBR", "rating": base + 1, "salary_m": 1.4, "trait": "Pit Wall Comms"},
        "sporting_dir":  {"id": "init_sd", "role": "sporting_dir",  "name": "Elena Vogel",  "nat": "GER", "rating": base, "salary_m": 1.5, "trait": "Pit Crew Coord"},
    }


def _spawn_dilemma(state: dict[str, Any]) -> dict[str, Any]:
    try:
        from .paddock_dialogue import TROPE_DILEMMAS
        all_dilemmas = list(DILEMMA_TEMPLATES) + list(TROPE_DILEMMAS)
    except Exception:
        all_dilemmas = list(DILEMMA_TEMPLATES)
    seen = set(state.get("seen_dilemmas") or [])
    pool = [d for d in all_dilemmas if d["id"] not in seen]
    if not pool:
        state["seen_dilemmas"] = []
        pool = list(all_dilemmas)
    picked = random.choice(pool)
    state.setdefault("seen_dilemmas", []).append(picked["id"])
    return dict(picked, round=state.get("current_round", 1))


def _ensure_career_v2(state: dict[str, Any]) -> dict[str, Any]:
    """Backwards-compatibly upgrade any existing career_state.json with Staff, Setup, Dilemmas, Next-Gen Research & Focus."""
    pt = get_player_team(state)
    if not state.get("staff"):
        state["staff"] = _default_staff_for_team(float(pt.get("car_overall", 74.0)))
    if not state.get("staff_market"):
        hired_ids = {s.get("id") for s in state["staff"].values()}
        state["staff_market"] = [dict(c) for c in STAFF_CANDIDATES if c["id"] not in hired_ids]
    if not state.get("next_gen_research"):
        state["next_gen_research"] = {"aero": 0.0, "chassis": 0.0, "power": 0.0, "tyre_care": 0.0}
    if "wcc_history" not in state:
        state["wcc_history"] = []
    if "seen_dilemmas" not in state:
        state["seen_dilemmas"] = []
    if "pending_dilemma" not in state:
        state["pending_dilemma"] = _spawn_dilemma(state)
    if "dynasty" not in state or not isinstance(state.get("dynasty"), dict):
        # Backfill dynasty totals from any already-completed rounds in this season
        done_rounds = [c for c in (state.get("calendar") or []) if c.get("completed")]
        d_wins = sum(1 for c in done_rounds for f in (c.get("player_results") or []) if not f.get("dnf") and int(f.get("pos") or 99) == 1)
        d_pods = sum(1 for c in done_rounds for f in (c.get("player_results") or []) if not f.get("dnf") and int(f.get("pos") or 99) <= 3)
        d_pts = sum(int(f.get("pts") or 0) for c in done_rounds for f in (c.get("player_results") or []))
        drv_recs: dict[str, dict[str, Any]] = {}
        for c in done_rounds:
            for f in (c.get("player_results") or []):
                nm = str(f.get("driver") or "")
                if not nm:
                    continue
                rec = drv_recs.setdefault(nm, {"name": nm, "code3": f.get("code3") or nm[:3].upper(), "races": 0, "wins": 0, "podiums": 0, "poles": 0, "fl": 0, "points": 0})
                rec["races"] += 1
                if not f.get("dnf") and int(f.get("pos") or 99) == 1:
                    rec["wins"] += 1
                if not f.get("dnf") and int(f.get("pos") or 99) <= 3:
                    rec["podiums"] += 1
                if int(f.get("start_pos") or 99) == 1:
                    rec["poles"] += 1
                rec["points"] += int(f.get("pts") or 0)
        state["dynasty"] = {
            "races": len(done_rounds),
            "wins": d_wins,
            "podiums": d_pods,
            "poles": sum(r["poles"] for r in drv_recs.values()),
            "fastest_laps": 0,
            "points": d_pts,
            "best_pit_s": None,
            "driver_records": drv_recs,
            "garage_seasons": [],
        }
    if "rivalries" not in state or not isinstance(state.get("rivalries"), list):
        state["rivalries"] = []
    if "pending_media" not in state:
        state["pending_media"] = None
    if "cost_cap_breach_tier" not in state:
        state["cost_cap_breach_tier"] = "none"
    if "rd_nerf_mult" not in state:
        state["rd_nerf_mult"] = 1.0
    if "next_season_cap_penalty_m" not in state:
        state["next_season_cap_penalty_m"] = 0.0
    if "board_ultimatum" not in state:
        state["board_ultimatum"] = None
    team_colors = {t["id"]: t.get("color") or "#64748b" for t in (state.get("teams") or [])}
    for d in (state.get("drivers") or {}).values():
        if not d.get("dev_focus"):
            d["dev_focus"] = "balanced"
        if not d.get("hero_color"):
            d["hero_color"] = team_colors.get(d.get("team_id")) or "#64748b"
    _ensure_rd_v3(state)
    from .career_extras import ensure_career_extras
    ensure_career_extras(state)
    pt["car_overall"] = _compute_car_overall(pt, state.get("staff"))
    return state


def _driver_market_record(
    card: dict[str, Any],
    rng: random.Random,
    team_id: str | None = None,
    scouted: bool = False,
    career_seasons_override: int | None = None,
) -> dict[str, Any]:
    st = card["game"]["stats"]
    ovr = float(card.get("overall") or 72.0)
    seasons = max(1, int(career_seasons_override or card.get("seasons") or 1))
    # Younger / less-experienced drivers have higher upside potential!
    age_est = int(_clamp(18 + seasons * 1.18 + rng.uniform(0, 2.2), 18, 44))
    upside = max(0, int((28 - age_est) * 0.95 + rng.uniform(0, 4)))
    potential = int(_clamp(round(ovr + upside), int(ovr), 99))
    wet_skill = int(_clamp(round((st["racecraft"] * 0.55 + st["clutch"] * 0.45) + rng.uniform(-6, 8)), 45, 99))
    salary_m = round(_clamp(0.8 + ((ovr - 58.0) ** 1.38) * 0.085, 0.8, 32.0), 1)
    buyout_m = round(salary_m * 0.9, 1) if team_id else 0.0
    trait = HIDDEN_TRAITS[zlib.crc32(card["driver"].encode("utf-8")) % len(HIDDEN_TRAITS)]

    # Fog-of-war noisy estimates (shown until scouted!)
    noise_p = rng.randint(-6, 6)
    noise_r = rng.randint(-6, 6)
    est_ovr = int(_clamp(round(ovr + rng.randint(-5, 5)), 50, 98))

    return {
        "id": card["driver"],
        "driver": card["driver"],
        "clean_name": card["clean_name"],
        "code3": card.get("code3") or card["clean_name"][:3].upper(),
        "nationality": card.get("nationality") or "F1",
        "driver_image": card.get("driver_image"),
        "hero_team": card.get("hero_team") or "",
        "hero_color": card.get("hero_color") or "#64748b",
        "hero_car_slug": card.get("hero_car_slug"),
        "overall": round(ovr, 1),
        "potential": potential,
        "age": age_est,
        "seasons_exp": seasons,
        "wins": int(card.get("wins") or 0),
        "podiums": int(card.get("podiums") or 0),
        "championships": int(card.get("championships") or 0),
        "stats": {
            "pace": int(st["pace"]),
            "racecraft": int(st["racecraft"]),
            "reliability": int(st["reliability"]),
            "duels": int(st["duels"]),
            "clutch": int(st["clutch"]),
            "dnf_rate": float(st["dnf_rate"]),
            "wet": wet_skill,
        },
        "ability": card["game"]["ability"],
        "trait": trait,
        "team_id": team_id,            # None = Free Agent
        "role": "race" if team_id else "free_agent",
        "salary_m": salary_m,
        "buyout_m": buyout_m,
        "contract_years": rng.randint(1, 3) if team_id else 0,
        "morale": 76 if team_id else 70,
        "xp": 0,
        "season_pts": 0,
        "season_wins": 0,
        "season_podiums": 0,
        "season_fl": 0,
        "scouted": scouted,
        "scout_est": {
            "ovr_lo": max(45, est_ovr - 5),
            "ovr_hi": min(99, est_ovr + 5),
            "pace_lo": max(40, int(st["pace"]) + noise_p - 6),
            "pace_hi": min(99, int(st["pace"]) + noise_p + 6),
            "race_lo": max(40, int(st["racecraft"]) + noise_r - 6),
            "race_hi": min(99, int(st["racecraft"]) + noise_r + 6),
        },
    }


def build_new_career(
    season_deck: list[dict[str, Any]],
    alltime_deck: list[dict[str, Any]],
    *,
    era: str = "2026",
    team_choice: str = "Mercedes",
    custom_team_name: str = "",
    custom_color: str = "#e10600",
    budget_tier: str = "midfield",
    calendar_len: str = "12",
) -> dict[str, Any]:
    """Build a complete, data-powered F1 Team Principal Career from real DB decks."""
    rng = random.Random(int(time.time() * 1000) & 0xFFFFFFFF)
    cal_ids = CALENDAR_PRESETS.get(str(calendar_len), CALENDAR_PRESETS["12"])

    # Map true career seasons count from alltime_deck so veterans (Hamilton, Alonso, Verstappen) get accurate F1 ages!
    alltime_seasons_map = {c["driver"]: max(1, int(c.get("seasons") or 1)) for c in alltime_deck}

    # Group real drivers into constructors from the chosen deck
    src_cards = alltime_deck[:80] if era == "legends" else season_deck
    by_team: dict[str, list[dict[str, Any]]] = {}
    for c in src_cards:
        tname = (c.get("hero_team") or "").strip() or "Independent"
        by_team.setdefault(tname, []).append(c)

    # Sort constructors by top-2 driver combined overall
    ranked_teams = sorted(
        [(t, sorted(cs, key=lambda x: -float(x.get("overall") or 0))) for t, cs in by_team.items() if len(cs) >= 2],
        key=lambda kv: -sum(float(x.get("overall") or 0) for x in kv[1][:2]),
    )
    # Keep top 10 constructors (or up to 11 for 2026!)
    selected_teams = ranked_teams[:11] if era != "legends" else ranked_teams[:10]

    teams: list[dict[str, Any]] = []
    drivers: dict[str, dict[str, Any]] = {}
    assigned_ids: set[str] = set()

    for idx, (tname, tcards) in enumerate(selected_teams):
        tid = f"team_{idx + 1}"
        # Leave headroom (top teams ~84-87 OVR) so R&D & facility upgrades feel meaningful!
        base_rating = round(60.0 + (len(selected_teams) - idx) * 2.0 + rng.uniform(-1.2, 1.2), 1)
        base_rating = _clamp(base_rating, 58.0, 81.5)
        col = tcards[0].get("hero_color") or "#64748b"
        slug = tcards[0].get("hero_car_slug")
        fac_base = 3 if idx < 3 else (2 if idx < 7 else 1)

        d_ids = []
        for dc in tcards[:2]:
            drec = _driver_market_record(dc, rng, team_id=tid, scouted=False, career_seasons_override=alltime_seasons_map.get(dc["driver"]))
            drivers[drec["id"]] = drec
            assigned_ids.add(drec["id"])
            d_ids.append(drec["id"])

        t_obj = {
            "id": tid,
            "name": tname,
            "color": col,
            "car_slug": slug,
            "is_player": False,
            "driver_ids": d_ids,
            "reserve_id": None,
            "points": 0,
            "wins": 0,
            "podiums": 0,
            "rd": {
                "aero": round(_clamp(base_rating + rng.uniform(-3, 3), 55, 95), 1),
                "chassis": round(_clamp(base_rating + rng.uniform(-3, 3), 55, 95), 1),
                "power": round(_clamp(base_rating + rng.uniform(-3, 3), 55, 95), 1),
                "tyre_care": round(_clamp(base_rating + rng.uniform(-3, 3), 55, 95), 1),
            },
            "facilities": {f["id"]: fac_base for f in FACILITY_DEFS},
        }
        t_obj["car_overall"] = _compute_car_overall(t_obj)
        teams.append(t_obj)

    # Determine Player Team (existing constructor OR Create Your Own Team!)
    player_team: dict[str, Any] | None = None
    if team_choice == "__custom__":
        cname = (custom_team_name or "Apex Racing GP").strip()[:32]
        tier_cfg = {
            "works":    {"cash": 115.0, "rd": 82.0, "fac": 3, "expect": 3},
            "midfield": {"cash": 82.0,  "rd": 74.0, "fac": 2, "expect": 6},
            "underdog": {"cash": 58.0,  "rd": 66.0, "fac": 1, "expect": 9},
        }.get(budget_tier, {"cash": 82.0, "rd": 74.0, "fac": 2, "expect": 6})
        # Pick 2 best unassigned free agents for the new team!
        pool_unused = [c for c in (season_deck + alltime_deck[:90]) if c["driver"] not in assigned_ids]
        starter_cards = pool_unused[:2]
        tid = "team_custom"
        d_ids = []
        for dc in starter_cards:
            drec = _driver_market_record(dc, rng, team_id=tid, scouted=True, career_seasons_override=alltime_seasons_map.get(dc["driver"]))
            drec["hero_color"] = custom_color or "#e10600"
            drivers[drec["id"]] = drec
            assigned_ids.add(drec["id"])
            d_ids.append(drec["id"])
        player_team = {
            "id": tid,
            "name": cname,
            "color": custom_color or "#e10600",
            "car_slug": None,
            "is_player": True,
            "driver_ids": d_ids,
            "reserve_id": None,
            "points": 0,
            "wins": 0,
            "podiums": 0,
            "rd": {
                "aero": tier_cfg["rd"],
                "chassis": tier_cfg["rd"],
                "power": tier_cfg["rd"],
                "tyre_care": tier_cfg["rd"],
            },
            "facilities": {f["id"]: tier_cfg["fac"] for f in FACILITY_DEFS},
        }
        player_team["car_overall"] = _compute_car_overall(player_team)
        teams.append(player_team)
        start_cash = tier_cfg["cash"]
        board_expect = tier_cfg["expect"]
    else:
        for t in teams:
            if t["name"].lower() == team_choice.lower():
                player_team = t
                break
        if player_team is None and teams:
            player_team = teams[0]
        player_team["is_player"] = True
        rank_i = teams.index(player_team)
        start_cash = round(105.0 - rank_i * 4.5, 1)
        board_expect = min(len(teams), max(1, rank_i + 1))

    # Player's own drivers are 100% scouted from day 1
    for did in player_team["driver_ids"]:
        if did in drivers:
            drivers[did]["scouted"] = True

    # Populate Rich Transfer Market / Free Agent Pool (up to 65 total drivers from real F1 DB!)
    combined_pool = []
    seen_p = set(assigned_ids)
    for c in season_deck + alltime_deck[:90]:
        if c["driver"] not in seen_p:
            seen_p.add(c["driver"])
            combined_pool.append(c)
    for dc in combined_pool[:44]:
        drec = _driver_market_record(dc, rng, team_id=None, scouted=False, career_seasons_override=alltime_seasons_map.get(dc["driver"]))
        drivers[drec["id"]] = drec

    # Give player a starter Reserve/Academy driver if available
    free_agents = [d for d in drivers.values() if d["team_id"] is None]
    free_agents.sort(key=lambda d: (d["age"], -d["potential"]))
    if free_agents:
        res = free_agents[0]
        res["team_id"] = player_team["id"]
        res["role"] = "reserve"
        res["salary_m"] = round(max(0.5, res["salary_m"] * 0.4), 1)
        res["contract_years"] = 2
        res["scouted"] = True
        player_team["reserve_id"] = res["id"]

    # Build Calendar
    calendar = []
    for r_idx, cid in enumerate(cal_ids, start=1):
        cinfo = _circuit_by_id(cid)
        calendar.append({
            "round": r_idx,
            "circuit_id": cid,
            "name": cinfo["name"],
            "gp": cinfo["gp"],
            "country": cinfo["country"],
            "nat3": cinfo["nat3"],
            "length_km": cinfo["length_km"],
            "laps": cinfo["laps"],
            "aero": cinfo["aero"],
            "rain_chance": cinfo["rain_chance"],
            "is_night": bool(cinfo.get("is_night")),
            "is_sprint": bool(cinfo.get("is_sprint_2026")),
            "completed": False,
            "winner": None,
            "winner_team": None,
            "fastest_lap": None,
            "sprint_winner": None,
            "player_results": [],
        })

    # Starter Sponsors (1 Title + 1 Secondary)
    starter_sponsors = [
        dict(SPONSOR_CATALOG[0], races_left=len(calendar)),
        dict(SPONSOR_CATALOG[3], races_left=len(calendar)),
    ]

    state: dict[str, Any] = {
        "version": 1,
        "created_at": int(time.time()),
        "era": era,
        "season_num": 1,
        "season_year": 2026 if era == "2026" else 1990,
        "current_round": 1,
        "season_complete": False,
        "player_team_id": player_team["id"],
        "cash_m": start_cash,
        "cost_cap_m": 135.0,
        "cost_cap_spent_m": 0.0,
        "board_confidence": 78,
        "board_expect_wcc": board_expect,
        "teams": teams,
        "drivers": drivers,
        "calendar": calendar,
        "active_rd": [],          # [{part, label, gain, cost_m, rounds_left, mode}]
        "active_scouts": [],      # [{driver_id, driver_name, rounds_left}]
        "pu_pool": [
            {"car": 1, "ice": 100, "ers": 100, "gearbox": 100, "ice_used": 1, "ers_used": 1, "gearbox_used": 1, "grid_penalty": 0},
            {"car": 2, "ice": 100, "ers": 100, "gearbox": 100, "ice_used": 1, "ers_used": 1, "gearbox_used": 1, "grid_penalty": 0},
        ],
        "sponsors": starter_sponsors,
        "pending_quali": None,    # {round, circuit_id, weather_mode, grid: [{driver_id, team_id, quali_s, pos}]}
        "finance_log": [
            {"round": 0, "label": "Season Board Allocation", "delta_m": start_cash, "balance_m": start_cash}
        ],
        "inbox": [
            {
                "round": 1,
                "tag": "BOARD",
                "title": f"Welcome to {player_team['name']}!",
                "body": f"Target WCC Position: P{board_expect} or better across {len(calendar)} Grands Prix. Invest in HQ facilities, develop new aero parts, scout hidden gems, and lead both cars from the Pit Wall!",
            }
        ],
        "champions_history": [],
    }
    return _ensure_career_v2(state)


def get_player_team(state: dict[str, Any]) -> dict[str, Any]:
    pid = state["player_team_id"]
    for t in state["teams"]:
        if t["id"] == pid:
            return t
    return state["teams"][0]


def _add_inbox(state: dict[str, Any], tag: str, title: str, body: str) -> None:
    state["inbox"].insert(0, {
        "round": state["current_round"],
        "tag": tag,
        "title": title,
        "body": body,
    })
    state["inbox"] = state["inbox"][:28]


def _apply_cost_cap_check(state: dict[str, Any], prev_spent: float) -> None:
    """Enforce authentic FIA Soft Cost Cap penalties (minor 0-5% breach vs material >5% breach)."""
    cap = float(state.get("cost_cap_m") or 135.0)
    spent = float(state.get("cost_cap_spent_m") or 0.0)
    if spent <= cap:
        return
    prev_over = max(0.0, prev_spent - cap)
    cur_over = max(0.0, spent - cap)
    new_over = max(0.0, cur_over - prev_over)
    prev_tier = str(state.get("cost_cap_breach_tier") or "none")
    material_thresh = cap * 0.05
    pt = get_player_team(state)

    if cur_over > material_thresh:
        fine = round(new_over * 2.0, 2)
        if fine > 0:
            state["cash_m"] = round(state["cash_m"] - fine, 2)
            state["finance_log"].insert(0, {
                "round": state["current_round"],
                "label": "FIA Material Cost Cap Fine (2× Overspend)",
                "delta_m": -fine,
                "balance_m": state["cash_m"],
            })
        if prev_tier != "material":
            state["cost_cap_breach_tier"] = "material"
            state["rd_nerf_mult"] = 0.75
            state["next_season_cap_penalty_m"] = 10.0
            pt["points"] = max(0, int(pt.get("points") or 0) - 15)
            state["board_confidence"] = int(_clamp(state["board_confidence"] - 12, 0, 100))
            _add_inbox(
                state,
                "FIA",
                "🚨 MATERIAL COST CAP BREACH (>5% Over Cap)!",
                f"Overspend ${cur_over:.1f}M above ${cap:.0f}M cap! FIA applied -15 WCC points, -25% Wind Tunnel R&D nerf, -$10M next-season cap, and ${fine:.1f}M fine.",
            )
    else:
        fine = round(new_over * 1.5, 2)
        if fine > 0:
            state["cash_m"] = round(state["cash_m"] - fine, 2)
            state["finance_log"].insert(0, {
                "round": state["current_round"],
                "label": "FIA Minor Cost Cap Fine (1.5× Overspend)",
                "delta_m": -fine,
                "balance_m": state["cash_m"],
            })
        if prev_tier == "none":
            state["cost_cap_breach_tier"] = "minor"
            state["rd_nerf_mult"] = 0.85
            state["board_confidence"] = int(_clamp(state["board_confidence"] - 5, 0, 100))
            _add_inbox(
                state,
                "FIA",
                "⚠ Minor FIA Cost Cap Breach (0–5% Over Cap)",
                f"Spent ${spent:.1f}M / ${cap:.0f}M cap. FIA issued a ${fine:.1f}M fine and -15% Wind Tunnel R&D nerf for the rest of the season.",
            )
    state["finance_log"] = state["finance_log"][:30]


def _log_finance(state: dict[str, Any], label: str, delta_m: float, *, cap_eligible: bool = False) -> None:
    prev_spent = float(state.get("cost_cap_spent_m") or 0.0)
    state["cash_m"] = round(state["cash_m"] + delta_m, 2)
    if cap_eligible and delta_m < 0:
        state["cost_cap_spent_m"] = round(prev_spent + abs(delta_m), 2)
    state["finance_log"].insert(0, {
        "round": state["current_round"],
        "label": label,
        "delta_m": round(delta_m, 2),
        "balance_m": state["cash_m"],
    })
    state["finance_log"] = state["finance_log"][:30]
    if cap_eligible and delta_m < 0:
        _apply_cost_cap_check(state, prev_spent)


def upgrade_facility(state: dict[str, Any], fac_id: str) -> tuple[bool, str]:
    pt = get_player_team(state)
    cur = int(pt["facilities"].get(fac_id, 1))
    if cur >= 5:
        return False, "Facility is already at maximum Level 5."
    cost = _facility_upgrade_cost(fac_id, cur)
    if state["cash_m"] < cost:
        return False, f"Insufficient funds (${cost}M needed, ${state['cash_m']}M available)."
    pt["facilities"][fac_id] = cur + 1
    pt["car_overall"] = _compute_car_overall(pt, state.get("staff"))
    fdef = next((f for f in FACILITY_DEFS if f["id"] == fac_id), {"name": fac_id})
    _log_finance(state, f"Upgrade {fdef['name']} → Lvl {cur + 1}", -cost, cap_eligible=True)
    _add_inbox(state, "HQ", f"{fdef['name']} Upgraded to Level {cur + 1}!", f"Your factory upgrade is online immediately for Round {state['current_round']}.")
    return True, f"{fdef['name']} upgraded to Level {cur + 1}!"


def start_rd_project(
    state: dict[str, Any],
    part_id: str,
    mode: str = "normal",
    wt_hrs: float = 0.0,
    cfd_items: int = 0,
) -> tuple[bool, str]:
    _ensure_career_v2(state)
    pt = get_player_team(state)
    bp = next((b for b in CAR_BLUEPRINTS if b["id"] == part_id), None)
    pdef = bp or next((p for p in RD_PARTS if p["id"] == part_id), None)
    if not pdef:
        return False, "Unknown R&D component."
    max_concurrent = 2 if pt["facilities"].get("cfd_factory", 1) >= 3 else 1
    if len(state["active_rd"]) >= max_concurrent:
        return False, f"Max {max_concurrent} concurrent R&D project(s). Upgrade CFD & Chassis Factory to Level 3 for 2 slots!"
    if any(p.get("component_id", p.get("part")) == part_id for p in state["active_rd"]):
        return False, f"{pdef['name']} upgrade is already in wind-tunnel production."

    atr = state["atr"]
    use_wt = round(_clamp(float(wt_hrs or 0.0), 0.0, float(atr.get("wt_hrs_rem") or 0.0)), 1)
    use_cfd = int(_clamp(int(cfd_items or 0), 0, int(atr.get("cfd_rem") or 0)))

    wt_lvl = pt["facilities"].get("wind_tunnel", 1)
    td_rating = float(((state.get("staff") or {}).get("tech_director") or {}).get("rating", 75))
    ha_rating = float(((state.get("staff") or {}).get("head_aero") or {}).get("rating", 74))
    td_mult = (1.0 + max(0.0, (td_rating - 70.0) * 0.008)) * float(state.get("rd_nerf_mult") or 1.0)

    # ATR Wind Tunnel & CFD boost (+0% up to +38% gain AND raises Wind-Tunnel Correlation accuracy!)
    atr_frac = _clamp((use_wt / 12.0) * 0.55 + (use_cfd / 600.0) * 0.45, 0.0, 1.25)
    atr_gain_mult = 1.0 + atr_frac * 0.32
    corr_pct = int(_clamp(
        68 + wt_lvl * 4 + (ha_rating - 70.0) * 0.45 + atr_frac * 18.0 - (14.0 if mode == "rush" else 0.0),
        48,
        98,
    ))

    base_c = float(bp["base_cost"]) if bp else 4.2
    base_g = float(bp["base_gain"]) if bp else 2.6
    cfg = {
        "normal":  {"cost": round(base_c, 1),        "gain": (base_g + wt_lvl * 0.30) * td_mult * atr_gain_mult, "rounds": 2},
        "intense": {"cost": round(base_c * 1.65, 1), "gain": (base_g * 1.48 + wt_lvl * 0.40) * td_mult * atr_gain_mult, "rounds": 2},
        "rush":    {"cost": round(base_c * 2.10, 1), "gain": (base_g * 1.18 + wt_lvl * 0.30) * td_mult * atr_gain_mult, "rounds": 1},
    }.get(mode, {"cost": round(base_c, 1), "gain": base_g * td_mult * atr_gain_mult, "rounds": 2})

    if state["cash_m"] < cfg["cost"]:
        return False, f"Need ${cfg['cost']}M to commission this R&D package."

    # Deduct ATR hours & CFD items
    atr["wt_hrs_rem"] = round(max(0.0, float(atr.get("wt_hrs_rem") or 0.0) - use_wt), 1)
    atr["cfd_rem"] = max(0, int(atr.get("cfd_rem") or 0) - use_cfd)

    cur_spec = int(((state.get("parts_inventory") or {}).get(part_id) or {}).get("spec", 1))
    proj = {
        "part": bp["primary"] if bp else part_id,
        "secondary": bp["secondary"] if bp else None,
        "component_id": part_id if bp else None,
        "target_spec": cur_spec + 1 if bp else None,
        "label": f"{pdef['name']} Spec {cur_spec + 1}" if bp else pdef["name"],
        "mode": mode,
        "gain": round(cfg["gain"], 1),
        "cost_m": cfg["cost"],
        "wt_hrs": use_wt,
        "cfd_items": use_cfd,
        "correlation_pct": corr_pct,
        "rounds_left": cfg["rounds"],
    }
    state["active_rd"].append(proj)
    _log_finance(state, f"R&D {proj['label']} ({mode.title()})", -cfg["cost"], cap_eligible=True)
    _add_inbox(
        state,
        "R&D",
        f"Commissioned: {proj['label']}",
        f"Projected +{proj['gain']} rating in {proj['rounds_left']} race(s) · ATR: {use_wt}h WT / {use_cfd} CFD · Correlation est. {corr_pct}%.",
    )
    return True, f"Started {proj['label']} (+{proj['gain']} est., {corr_pct}% correlation, {proj['rounds_left']}R)!"


def manufacture_spare_part(state: dict[str, Any], comp_id: str) -> tuple[bool, str]:
    _ensure_career_v2(state)
    bp = next((b for b in CAR_BLUEPRINTS if b["id"] == comp_id), None)
    if not bp:
        return False, "Unknown car component."
    cost = float(bp["spare_cost"])
    if state["cash_m"] < cost:
        return False, f"Need ${cost:.1f}M to manufacture a spare {bp['name']}."
    inv = state["parts_inventory"][comp_id]
    if int(inv.get("spares", 0)) >= 6:
        return False, f"Warehouse already full (6 spares) for {bp['name']}."
    inv["spares"] = int(inv.get("spares", 0)) + 1
    _log_finance(state, f"Manufacture Spare: {bp['name']} Spec {inv['spec']}", -cost, cap_eligible=True)
    return True, f"Manufactured +1x {bp['name']} Spec {inv['spec']} (-${cost:.1f}M, now {inv['spares']} spares)!"


def assign_scout(state: dict[str, Any], driver_id: str, express: bool = False) -> tuple[bool, str]:
    drv = state["drivers"].get(driver_id)
    if not drv:
        return False, "Driver not found."
    if drv.get("scouted"):
        return False, f"{drv['clean_name']} is already fully scouted."

    pt = get_player_team(state)
    hub_lvl = pt["facilities"].get("scouting_hub", 1)

    if express:
        cost = 1.5
        if state["cash_m"] < cost:
            return False, f"Need ${cost}M for Express Telemetry Dossier."
        drv["scouted"] = True
        state["active_scouts"] = [s for s in state["active_scouts"] if s["driver_id"] != driver_id]
        _log_finance(state, f"Express Scout: {drv['clean_name']}", -cost, cap_eligible=True)
        _add_inbox(state, "SCOUT", f"Express Report: {drv['clean_name']}", f"OVR {drv['overall']} · Potential {drv['potential']} · Wet {drv['stats']['wet']} · Trait: {drv['trait']} · Demand ${drv['salary_m']}M/yr.")
        return True, f"Express dossier complete for {drv['clean_name']}!"

    slots = _scout_slots_for_level(hub_lvl)
    if len(state["active_scouts"]) >= slots:
        return False, f"All {slots} scout slot(s) busy. Upgrade Scouting Hub or use Express ($1.5M)."
    if any(s["driver_id"] == driver_id for s in state["active_scouts"]):
        return False, f"Already scouting {drv['clean_name']}."

    rounds = 1 if hub_lvl >= 2 else 2
    state["active_scouts"].append({
        "driver_id": driver_id,
        "driver_name": drv["clean_name"],
        "rounds_left": rounds,
    })
    return True, f"Scout assigned to {drv['clean_name']} ({rounds} race week(s))."


def negotiate_contract(
    state: dict[str, Any],
    driver_id: str,
    seat_slot: str,           # "seat1" | "seat2" | "reserve"
    salary_m: float,
    signing_bonus_m: float,
    years: int,
) -> tuple[bool, str]:
    drv = state["drivers"].get(driver_id)
    if not drv:
        return False, "Driver not found."
    pt = get_player_team(state)
    if drv["team_id"] == pt["id"] and drv["role"] != "reserve":
        return False, f"{drv['clean_name']} already drives for {pt['name']}."

    # Calculate acceptance probability & deterministic threshold
    ask = float(drv["salary_m"])
    if seat_slot == "reserve":
        ask = max(0.5, ask * 0.45)
        if drv["overall"] >= 86:
            return False, f"{drv['clean_name']} (OVR {drv['overall']}) refuses a Reserve role — offer Seat #1 or #2!"

    hosp_lvl = pt["facilities"].get("hospitality", 1)
    # Team prestige from car overall
    prestige_bonus = (pt["car_overall"] - 72.0) * 0.012 + (hosp_lvl - 1) * 0.04
    eff_offer = salary_m + (signing_bonus_m / max(1, years)) * 0.75
    ratio = (eff_offer / max(0.4, ask)) + prestige_bonus

    buyout = float(drv["buyout_m"]) if (drv["team_id"] and drv["team_id"] != pt["id"]) else 0.0
    upfront = round(buyout + signing_bonus_m, 2)
    if state["cash_m"] < upfront:
        return False, f"Need ${upfront}M upfront (Buyout ${buyout}M + Bonus ${signing_bonus_m}M)."

    if ratio < 0.94:
        return False, f"{drv['clean_name']} rejected your offer! Increase salary closer to ~${round(ask, 1)}M/yr or add a signing bonus."

    # Accepted! Handle previous team & displaced player driver
    old_tid = drv["team_id"]
    if old_tid and old_tid != pt["id"]:
        for t in state["teams"]:
            if t["id"] == old_tid:
                if driver_id in t["driver_ids"]:
                    t["driver_ids"].remove(driver_id)
                    # Rival team signs best available free agent to backfill seat
                    fas = [d for d in state["drivers"].values() if d["team_id"] is None and d["id"] != driver_id]
                    fas.sort(key=lambda x: -x["overall"])
                    if fas:
                        rep = fas[0]
                        rep["team_id"] = t["id"]
                        rep["role"] = "race"
                        t["driver_ids"].append(rep["id"])
                break

    if seat_slot == "reserve":
        if pt.get("reserve_id") and pt["reserve_id"] in state["drivers"]:
            old_r = state["drivers"][pt["reserve_id"]]
            old_r["team_id"] = None
            old_r["role"] = "free_agent"
        pt["reserve_id"] = driver_id
        drv["role"] = "reserve"
    else:
        idx = 0 if seat_slot == "seat1" else 1
        # If promoting own reserve, clear reserve slot
        if pt.get("reserve_id") == driver_id:
            pt["reserve_id"] = None
        if len(pt["driver_ids"]) > idx:
            replaced_id = pt["driver_ids"][idx]
            if replaced_id != driver_id and replaced_id in state["drivers"]:
                old_d = state["drivers"][replaced_id]
                old_d["team_id"] = None
                old_d["role"] = "free_agent"
            pt["driver_ids"][idx] = driver_id
        else:
            pt["driver_ids"].append(driver_id)
        drv["role"] = "race"

    drv["team_id"] = pt["id"]
    drv["salary_m"] = round(salary_m, 1)
    drv["contract_years"] = max(1, min(3, int(years)))
    drv["buyout_m"] = round(salary_m * 0.9, 1)
    drv["scouted"] = True
    drv["morale"] = 88

    if upfront > 0:
        _log_finance(state, f"Signed {drv['clean_name']} (Buyout + Bonus)", -upfront)
    _add_inbox(
        state,
        "MARKET",
        f"SIGNING CONFIRMED: {drv['clean_name']} joins {pt['name']}!",
        f"Signed on a {drv['contract_years']}-year deal at ${drv['salary_m']}M/yr ({seat_slot.upper()}).",
    )
    return True, f"DONE DEAL! {drv['clean_name']} signed to {pt['name']} ({seat_slot.upper()})!"


def sign_sponsor(state: dict[str, Any], sponsor_id: str) -> tuple[bool, str]:
    sdef = next((s for s in SPONSOR_CATALOG if s["id"] == sponsor_id), None)
    if not sdef:
        return False, "Sponsor not found."
    if any(s["id"] == sponsor_id for s in state["sponsors"]):
        return False, "Sponsor already active."
    # Replace same-tier sponsor
    rem_races = max(1, len(state["calendar"]) - state["current_round"] + 1)
    state["sponsors"] = [s for s in state["sponsors"] if s["tier"] != sdef["tier"]]
    state["sponsors"].append(dict(sdef, races_left=rem_races))
    _add_inbox(state, "SPONSOR", f"New {sdef['tier']} Partner: {sdef['name']}", f"${sdef['per_race_m']}M/race + ${sdef['bonus_m']}M goal bonus ({sdef['goal_text']}).")
    return True, f"Signed {sdef['name']} as {sdef['tier']} Partner!"


def _ensure_pu_pool(state: dict[str, Any]) -> list[dict[str, Any]]:
    if not state.get("pu_pool"):
        state["pu_pool"] = [
            {"car": 1, "ice": 100, "ers": 100, "gearbox": 100, "ice_used": 1, "ers_used": 1, "gearbox_used": 1, "grid_penalty": 0},
            {"car": 2, "ice": 100, "ers": 100, "gearbox": 100, "ice_used": 1, "ers_used": 1, "gearbox_used": 1, "grid_penalty": 0},
        ]
    return state["pu_pool"]


def swap_pu_component(state: dict[str, Any], car_num: int, comp: str) -> tuple[bool, str]:
    """Fit a fresh ICE, ERS, or Gearbox unit; applies real FIA +5 grid penalty if over seasonal allocation."""
    if comp not in PU_ALLOCATION:
        return False, "Unknown Power Unit component."
    pool = _ensure_pu_pool(state)
    entry = next((p for p in pool if p["car"] == int(car_num)), None)
    if not entry:
        return False, "Invalid car number."
    used_key = f"{comp}_used"
    entry[used_key] = int(entry.get(used_key, 1)) + 1
    entry[comp] = 100
    alloc = PU_ALLOCATION[comp]
    over = entry[used_key] > alloc
    if over:
        entry["grid_penalty"] = int(entry.get("grid_penalty", 0)) + 5
        cost = 1.2
        _log_finance(state, f"Car #{car_num} Extra {comp.upper()} Unit", -cost, cap_eligible=True)
        _add_inbox(
            state,
            "FIA",
            f"Car #{car_num} Grid Penalty (+5 Places)",
            f"Fitted {comp.upper()} #{entry[used_key]} (over FIA {alloc}-unit allocation). +5 grid places applied for next GP.",
        )
        return True, f"Fitted fresh {comp.upper()} on Car #{car_num} (Over allocation: +5 grid penalty, -$1.2M)."
    return True, f"Fitted fresh {comp.upper()} #{entry[used_key]}/{alloc} on Car #{car_num} (No FIA penalty)."


def hire_staff(state: dict[str, Any], candidate_id: str) -> tuple[bool, str]:
    """Hire a Key Technical Staff member (Technical Director, Head of Aero, Chief Race Engineer, Sporting Director)."""
    _ensure_career_v2(state)
    cand = next((c for c in state["staff_market"] if c["id"] == candidate_id), None)
    if not cand:
        return False, "Staff candidate not available."
    cost = float(cand.get("hire_m", 2.0))
    if state["cash_m"] < cost:
        return False, f"Need ${cost}M buyout/signing fee to hire {cand['name']}."
    role = cand["role"]
    old = state["staff"].get(role)
    state["staff"][role] = dict(cand)
    state["staff_market"] = [c for c in state["staff_market"] if c["id"] != candidate_id]
    if old and old.get("id") and not str(old["id"]).startswith("init_"):
        state["staff_market"].append(old)
    pt = get_player_team(state)
    pt["car_overall"] = _compute_car_overall(pt, state["staff"])
    _log_finance(state, f"Hired {cand['name']} ({role.replace('_', ' ').title()})", -cost)
    _add_inbox(state, "STAFF", f"New {role.replace('_', ' ').title()}: {cand['name']} (OVR {cand['rating']})", f"{cand['trait']} — active immediately for Round {state['current_round']}!")
    return True, f"Hired {cand['name']} ({cand['rating']} OVR) as {role.replace('_', ' ').title()}!"


def set_driver_focus(state: dict[str, Any], driver_id: str, focus: str) -> tuple[bool, str]:
    """Set training development focus for one of your team's drivers."""
    _ensure_career_v2(state)
    if focus not in DEV_FOCUSES:
        return False, "Unknown training focus."
    drv = state["drivers"].get(driver_id)
    if not drv or drv.get("team_id") != state["player_team_id"]:
        return False, "You can only set training focus for your own drivers."
    drv["dev_focus"] = focus
    return True, f"{drv['clean_name']} training focus set to {DEV_FOCUSES[focus]['label']}."


def renew_driver_contract(
    state: dict[str, Any],
    driver_id: str,
    salary_m: float,
    years: int,
) -> tuple[bool, str]:
    """Renew an expiring contract for one of your team's drivers before Silly Season poaching!"""
    _ensure_career_v2(state)
    pt = get_player_team(state)
    drv = state["drivers"].get(driver_id)
    if not drv or drv.get("team_id") != pt["id"]:
        return False, "Driver is not currently contracted to your team."
    yrs = max(1, min(3, int(years)))
    ask = max(0.5, float(drv["salary_m"]) * (0.45 if drv.get("role") == "reserve" else 1.0))
    hosp_lvl = pt["facilities"].get("hospitality", 1)
    morale_bonus = (float(drv.get("morale", 75)) - 70.0) * 0.004
    prestige = (pt["car_overall"] - 72.0) * 0.01 + (hosp_lvl - 1) * 0.03 + morale_bonus
    ratio = (float(salary_m) / ask) + prestige
    if ratio < 0.92:
        return False, f"{drv['clean_name']} declined the renewal — wants closer to ${round(ask, 1)}M/yr."
    signing_fee = round(max(0.4, salary_m * 0.15), 2)
    if state["cash_m"] < signing_fee:
        return False, f"Need ${signing_fee}M renewal signing fee."
    drv["salary_m"] = round(float(salary_m), 1)
    drv["contract_years"] = yrs + 1  # covers remainder + extension
    drv["buyout_m"] = round(drv["salary_m"] * 0.9, 1)
    drv["morale"] = min(99, int(drv.get("morale", 75)) + 10)
    _log_finance(state, f"Contract Renewal: {drv['clean_name']} ({yrs}y)", -signing_fee)
    _add_inbox(state, "MARKET", f"CONTRACT RENEWED: {drv['clean_name']}!", f"Extended for {yrs} more season(s) at ${drv['salary_m']}M/yr. Rivals locked out!")
    return True, f"{drv['clean_name']} renewed for {yrs} season(s) at ${drv['salary_m']}M/yr!"


def update_team_livery(
    state: dict[str, Any],
    palette: dict[str, str],
    livery_style: str = "two-tone",
    car_era: str = "2020s",
) -> tuple[bool, str]:
    """Customize & persist the player constructor's 5-slot 3D livery, pattern style, and chassis era."""
    _ensure_career_v2(state)
    pt = get_player_team(state)
    from .f1_car_palettes import LIVERY_STYLES
    valid_styles = set(LIVERY_STYLES)
    valid_eras = {"1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"}
    st = livery_style if livery_style in valid_styles else "two-tone"
    er = car_era if car_era in valid_eras else "2020s"
    clean_pal = {
        "main": str(palette.get("main") or pt.get("color") or "#e10600")[:16],
        "secondary": str(palette.get("secondary") or "#111622")[:16],
        "accent": str(palette.get("accent") or "#facc15")[:16],
        "pop": str(palette.get("pop") or "#ffffff")[:16],
        "detail": str(palette.get("detail") or "#252c38")[:16],
    }
    pt["livery_palette"] = clean_pal
    pt["livery_style"] = st
    pt["car_era"] = er
    pt["color"] = clean_pal["main"]
    return True, f"Saved {pt['name']} {er} ({st.replace('-', ' ').title()}) 3D Livery!"


_ACADEMY_FIRST = ["Luca", "Mateo", "Noah", "Theo", "Kaito", "Enzo", "Liam", "Soren", "Rafael", "Hugo", "Callum", "Mika", "Aiden", "Nico"]
_ACADEMY_LAST = ["Moretti", "Kowalski", "Lindqvist", "Bianchi", "Nakamura", "Vargas", "Harrington", "Delgado", "Keller", "Rousseau", "Sato", "Almeida", "Bergman", "Costa"]
_ACADEMY_NATS = ["ITA", "GBR", "JPN", "FRA", "GER", "BRA", "ESP", "NED", "AUS", "SWE", "FIN", "USA", "CAN", "ARG"]


def train_reserve_driver(state: dict[str, Any]) -> tuple[bool, str]:
    """Run a dedicated Simulator & Track Test Camp for your Reserve/Academy driver (once per round)."""
    _ensure_career_v2(state)
    pt = get_player_team(state)
    rid = pt.get("reserve_id")
    if not rid or rid not in state["drivers"]:
        return False, "No Reserve/Academy driver signed — sign a young driver as Reserve first!"
    rnd = int(state.get("current_round") or 1)
    if state.get("last_reserve_camp_round") == rnd:
        return False, f"Simulator camp already completed for Round {rnd}. Available again after next GP!"
    cost = 0.8
    if state["cash_m"] < cost:
        return False, f"Need ${cost}M for Reserve Driver Simulator Camp."
    drv = state["drivers"][rid]
    sim_mult = 1.0 + (pt["facilities"].get("pit_sim", 1) - 1) * 0.15
    xp_gain = int(round(30 * sim_mult))
    drv["xp"] = int(drv.get("xp") or 0) + xp_gain
    leveled = False
    if drv["xp"] >= 100 and drv["overall"] < drv["potential"]:
        drv["xp"] -= 100
        drv["overall"] = round(min(drv["potential"], drv["overall"] + 1.0), 1)
        foc = drv.get("dev_focus") or "balanced"
        if foc in ("pace", "racecraft", "wet", "reliability"):
            drv["stats"][foc] = min(99, drv["stats"][foc] + 2)
        else:
            drv["stats"]["pace"] = min(99, drv["stats"]["pace"] + 1)
            drv["stats"]["racecraft"] = min(99, drv["stats"]["racecraft"] + 1)
        leveled = True
    drv["morale"] = min(99, int(drv.get("morale", 75)) + 5)
    state["last_reserve_camp_round"] = rnd
    _log_finance(state, f"Academy Camp: {drv['clean_name']}", -cost, cap_eligible=True)
    extra = f" LEVEL UP → OVR {drv['overall']}!" if leveled else f" (+{xp_gain} XP, now {drv['xp']}/100)"
    _add_inbox(state, "ACADEMY", f"Reserve Camp Complete: {drv['clean_name']}", f"{drv['clean_name']} completed 400 simulator laps.{extra}")
    return True, f"Trained {drv['clean_name']}!{extra}"


def discover_academy_wonderkid(state: dict[str, Any]) -> tuple[bool, str]:
    """Scout a fresh 18-19yo F2/F3 Junior Wonderkid into the Free Agent Market (fully scouted!)."""
    _ensure_career_v2(state)
    rnd = int(state.get("current_round") or 1)
    last_disc = int(state.get("last_academy_discover_round") or -99)
    if rnd - last_disc < 2:
        return False, "Junior scouting network needs 2 rounds between wonderkid discovery trips."
    cost = 1.4
    if state["cash_m"] < cost:
        return False, f"Need ${cost}M to fund F2/F3 Junior Talent Scouting Trip."
    rng = random.Random(int(time.time() * 1000) ^ rnd)
    hub_lvl = get_player_team(state)["facilities"].get("scouting_hub", 1)
    first = rng.choice(_ACADEMY_FIRST)
    last = rng.choice(_ACADEMY_LAST)
    nat = rng.choice(_ACADEMY_NATS)
    code3 = last[:3].upper()
    full_name = f"{first} {last}"
    did = f"acad_{first.lower()}_{last.lower()}_{rnd}_{rng.randint(10, 99)}"
    ovr = round(_clamp(67.0 + hub_lvl * 1.4 + rng.uniform(-2.0, 3.5), 64.0, 77.0), 1)
    pot = int(_clamp(round(ovr + 14 + hub_lvl * 1.5 + rng.uniform(0, 6)), 84, 97))
    pace = int(_clamp(round(ovr + rng.uniform(-3, 5)), 60, 84))
    racecraft = int(_clamp(round(ovr + rng.uniform(-3, 5)), 60, 84))
    wet = int(_clamp(round(ovr + rng.uniform(-2, 10)), 62, 90))
    rel = int(_clamp(round(ovr + rng.uniform(-4, 4)), 60, 85))
    trait = rng.choice(HIDDEN_TRAITS)
    drv = {
        "id": did,
        "driver": f"{full_name} {code3}",
        "clean_name": full_name,
        "code3": code3,
        "nationality": nat,
        "driver_image": None,
        "hero_team": "F2 Academy",
        "hero_color": "#38bdf8",
        "hero_car_slug": None,
        "overall": ovr,
        "potential": pot,
        "age": rng.choice([18, 19]),
        "seasons_exp": 1,
        "wins": 0,
        "podiums": 0,
        "championships": 0,
        "stats": {"pace": pace, "racecraft": racecraft, "reliability": rel, "duels": racecraft, "clutch": pace, "dnf_rate": 11.0, "wet": wet},
        "ability": {"name": "F2 Graduate", "desc": "High-upside junior academy prodigy"},
        "trait": trait,
        "dev_focus": "balanced",
        "team_id": None,
        "role": "free_agent",
        "salary_m": round(max(0.8, 0.9 + (ovr - 65) * 0.12), 1),
        "buyout_m": 0.0,
        "contract_years": 0,
        "morale": 85,
        "xp": 0,
        "season_pts": 0,
        "season_wins": 0,
        "season_podiums": 0,
        "season_fl": 0,
        "scouted": True,
        "scout_est": {"ovr_lo": int(ovr), "ovr_hi": int(ovr), "pace_lo": pace, "pace_hi": pace, "race_lo": racecraft, "race_hi": racecraft},
    }
    state["drivers"][did] = drv
    state["last_academy_discover_round"] = rnd
    _log_finance(state, f"F2 Wonderkid Scouting: {full_name}", -cost, cap_eligible=True)
    _add_inbox(state, "ACADEMY", f"🌟 Wonderkid Found: {full_name} (Age {drv['age']}, POT {pot})!", f"OVR {ovr} · POT {pot} · Wet {wet} · {trait} · Free Agent (${drv['salary_m']}M/yr)!")
    return True, f"Discovered F2 Wonderkid {full_name} (Age {drv['age']}, OVR {ovr}, POT {pot})!"


def _build_post_race_media(
    state: dict[str, Any],
    cal_item: dict[str, Any],
    player_finishes: list[dict[str, Any]],
    wcc_sorted: list[dict[str, Any]],
    p_wcc_pos: int,
    is_wet: bool,
) -> dict[str, Any]:
    """Generate a contextual 3-choice Paddock Press Conference prompt after each Grand Prix."""
    pt = get_player_team(state)
    best_p = min((f["pos"] for f in player_finishes if not f["dnf"]), default=20)
    any_dnf = any(f.get("dnf") for f in player_finishes)
    rival_idx = max(0, p_wcc_pos - 2) if p_wcc_pos > 1 else min(len(wcc_sorted) - 1, 1)
    rival = wcc_sorted[rival_idx] if wcc_sorted and wcc_sorted[rival_idx]["id"] != pt["id"] else next((t for t in wcc_sorted if t["id"] != pt["id"]), None)
    r_id = rival["id"] if rival else ""
    r_name = rival["name"] if rival else "the paddock"
    r_col = rival["color"] if rival else "#ef4444"
    gp = cal_item.get("gp") or cal_item.get("name") or "Grand Prix"

    if best_p == 1:
        headline = f"Sky F1 Media Pen: Victory at the {gp}!"
        question = f"Incredible triumph for {pt['name']}! Who gets the headline credit in front of the global broadcast?"
    elif best_p <= 3:
        headline = f"Paddock Press Conference: {gp} Podium!"
        question = f"Champagne on the podium at {cal_item['name']} — {r_name} looked rattled on strategy. What is your message?"
    elif is_wet:
        headline = f"Post-Race Media: Wet-Weather Thriller at {cal_item['name']}"
        question = f"Treacherous rain shook up the order today. How do you assess {pt['name']}'s pit wall execution?"
    elif any_dnf:
        headline = f"Media Scrutiny: Tough Break at the {gp}"
        question = f"A costly retirement hurt your haul today while {r_name} capitalized. How do you address the paddock?"
    else:
        headline = f"Media Pen: {gp} Debrief"
        question = f"You're locked in a tight Constructors fight with {r_name} (WCC P{p_wcc_pos}). What's your headline quote?"

    return {
        "round": int(state.get("current_round") or 1),
        "gp": gp,
        "headline": headline,
        "question": question,
        "rival_team_id": r_id,
        "rival_team_name": r_name,
        "rival_color": r_col,
        "choices": [
            {
                "label": f"Praise Drivers & Pit Crew (+8 Morale · +2 Board)",
                "effect": "morale",
            },
            {
                "label": f"Fire Warning Shot at {r_name} (+20 Rivalry Heat · +4 Board · +$0.4M Media Buzz)",
                "effect": "rivalry",
            },
            {
                "label": f"Spotlight Title Sponsors & Factory (+$0.7M Bonus · +3 Board)",
                "effect": "sponsor",
            },
        ],
    }


def respond_media_prompt(state: dict[str, Any], choice_idx: int) -> tuple[bool, str]:
    """Resolve the post-race Press Conference prompt, shifting Morale, Board, Cash & Paddock Rivalries."""
    _ensure_career_v2(state)
    pm = state.get("pending_media")
    if not pm:
        return False, "No active press conference awaiting a response."
    choices = pm.get("choices") or []
    if choice_idx < 0 or choice_idx >= len(choices):
        return False, "Invalid press conference quote."
    ch = choices[choice_idx]
    eff = ch.get("effect")
    pt = get_player_team(state)
    msg = ""
    if eff == "morale":
        for did in pt["driver_ids"]:
            if did in state["drivers"]:
                state["drivers"][did]["morale"] = int(_clamp(state["drivers"][did].get("morale", 75) + 8, 35, 99))
        state["board_confidence"] = int(_clamp(state["board_confidence"] + 2, 15, 100))
        msg = "Drivers & factory energized by your praise (+8 Morale, +2% Board)!"
    elif eff == "rivalry":
        state["board_confidence"] = int(_clamp(state["board_confidence"] + 4, 15, 100))
        _log_finance(state, f"Media Buzz ({pm.get('gp', 'GP')})", 0.4)
        rid = pm.get("rival_team_id")
        rname = pm.get("rival_team_name") or "Rival Team"
        if rid:
            rivals = state.setdefault("rivalries", [])
            existing = next((r for r in rivals if r.get("team_id") == rid), None)
            if existing:
                existing["heat"] = int(_clamp(existing.get("heat", 20) + 22, 0, 100))
                existing["reason"] = f"Media fireworks after {pm.get('gp', 'GP')}"
                existing["last_round"] = pm.get("round", state["current_round"])
            else:
                rivals.append({
                    "team_id": rid,
                    "team_name": rname,
                    "color": pm.get("rival_color") or "#ef4444",
                    "heat": 35,
                    "reason": f"Media fireworks after {pm.get('gp', 'GP')}",
                    "last_round": pm.get("round", state["current_round"]),
                })
            rivals.sort(key=lambda r: -int(r.get("heat", 0)))
        _add_inbox(state, "MEDIA", f"🔥 Rivalry Ignites with {rname}!", f"Your post-race quote went viral across the paddock (+$0.4M media buzz, +4% Board).")
        msg = f"Paddock erupts! Rivalry heat with {rname} surged (+$0.4M, +4% Board)!"
    else:
        state["board_confidence"] = int(_clamp(state["board_confidence"] + 3, 15, 100))
        _log_finance(state, f"Sponsor Media Activation ({pm.get('gp', 'GP')})", 0.7)
        _add_inbox(state, "SPONSOR", "Title Partners Thrilled with Broadcast Shoutout", "Partners wired a +$0.7M media activation bonus after the press conference.")
        msg = "Title sponsors thrilled! +$0.7M media bonus & +3% Board Confidence!"
    state["pending_media"] = None
    return True, msg


def start_nextgen_research(state: dict[str, Any], part_id: str) -> tuple[bool, str]:
    """Invest $3.8M in Next-Season Regulation Spec Research (carries over on Season Advance!)."""
    _ensure_career_v2(state)
    pdef = next((p for p in RD_PARTS if p["id"] == part_id), None)
    if not pdef:
        return False, "Unknown research department."
    cost = 3.8
    if state["cash_m"] < cost:
        return False, f"Need ${cost}M for Next-Season {pdef['name']} Research."
    pt = get_player_team(state)
    wt = pt["facilities"].get("wind_tunnel", 1)
    td = float((state["staff"].get("tech_director") or {}).get("rating", 75))
    nerf = float(state.get("rd_nerf_mult") or 1.0)
    gain = round(_clamp((1.4 + wt * 0.25) * (1.0 + max(0.0, (td - 70.0) * 0.01)) * nerf, 1.0, 3.2), 1)
    cur = float(state["next_gen_research"].get(part_id, 0.0))
    if cur >= 12.0:
        return False, f"Next-Season {pdef['name']} research is already maxed (+12.0)."
    state["next_gen_research"][part_id] = round(min(12.0, cur + gain), 1)
    _log_finance(state, f"Next-Gen Spec Research: {pdef['name']}", -cost, cap_eligible=True)
    _add_inbox(state, "R&D", f"Season {state['season_num'] + 1} Spec Research (+{gain} {part_id.upper()})", f"Banked +{state['next_gen_research'][part_id]} carry-over bonus for next year's regulations!")
    return True, f"Banked +{gain} Next-Season {pdef['name']} research (Total +{state['next_gen_research'][part_id]})!"


def resolve_dilemma(state: dict[str, Any], choice_idx: int) -> tuple[bool, str]:
    """Resolve the active interactive Paddock Decision on the HQ Dashboard."""
    _ensure_career_v2(state)
    dil = state.get("pending_dilemma")
    if not dil:
        return False, "No active paddock decision."
    choices = dil.get("choices") or []
    if choice_idx < 0 or choice_idx >= len(choices):
        return False, "Invalid decision choice."
    ch = choices[choice_idx]
    cash = float(ch.get("cash", 0.0))
    if cash < 0 and state["cash_m"] < abs(cash):
        return False, f"Insufficient funds (${abs(cash):.1f}M needed)."
    pt = get_player_team(state)
    if cash != 0.0:
        _log_finance(state, f"Decision: {dil['title'][:28]}", cash, cap_eligible=(cash < 0))
    for part, delta in (ch.get("rd") or {}).items():
        if part in pt["rd"]:
            pt["rd"][part] = round(_clamp(pt["rd"][part] + float(delta), 45.0, 99.0), 1)
    for part, delta in (ch.get("nextgen") or {}).items():
        if part in state["next_gen_research"]:
            state["next_gen_research"][part] = round(min(12.0, state["next_gen_research"][part] + float(delta)), 1)
    if ch.get("board"):
        state["board_confidence"] = int(_clamp(state["board_confidence"] + int(ch["board"]), 0, 100))
    if ch.get("morale"):
        for did in pt["driver_ids"]:
            if did in state["drivers"]:
                state["drivers"][did]["morale"] = int(_clamp(state["drivers"][did]["morale"] + int(ch["morale"]), 30, 99))
    if ch.get("driver_xp"):
        for did in pt["driver_ids"]:
            if did in state["drivers"]:
                state["drivers"][did]["xp"] = min(99, state["drivers"][did]["xp"] + int(ch["driver_xp"]))
    if ch.get("reserve_xp") and pt.get("reserve_id") and pt["reserve_id"] in state["drivers"]:
        rd = state["drivers"][pt["reserve_id"]]
        rd["xp"] += int(ch["reserve_xp"])
        if rd["xp"] >= 100 and rd["overall"] < rd["potential"]:
            rd["xp"] -= 100
            rd["overall"] = round(min(rd["potential"], rd["overall"] + 1.0), 1)
            rd["stats"]["pace"] = min(99, rd["stats"]["pace"] + 1)
    if ch.get("pu_wear"):
        w = int(ch["pu_wear"])
        for pu in _ensure_pu_pool(state):
            pu["ice"] = int(_clamp(pu["ice"] - w, 20, 100))
            pu["ers"] = int(_clamp(pu["ers"] - w, 20, 100))
    if ch.get("staff_boost"):
        rkey, boost = ch["staff_boost"]
        if rkey in state["staff"]:
            state["staff"][rkey]["rating"] = min(99, int(state["staff"][rkey]["rating"]) + int(boost))

    pt["car_overall"] = _compute_car_overall(pt, state["staff"])
    _add_inbox(state, "DECISION", f"Resolved: {dil['title']}", f"Action taken: {ch['label']}")
    state["pending_dilemma"] = None
    return True, f"Decision executed: {ch['label']}"


def _setup_feedback_tag(val: int, ideal: int) -> str:
    diff = val - ideal
    if abs(diff) <= 5:
        return "OPTIMAL ✓"
    if abs(diff) <= 12:
        return "SLIGHTLY HIGH ↓" if diff > 0 else "SLIGHTLY LOW ↑"
    return "TOO HIGH ↓↓" if diff > 0 else "TOO LOW ↑↑"


def tune_weekend_setup(
    state: dict[str, Any],
    wing: int = 50,
    susp: int = 50,
    diff: int = 50,
    auto: bool = False,
) -> tuple[bool, str, dict[str, Any]]:
    """Run an FP1/FP2/FP3 Practice Stint (up to 3 per GP) to dial in Car Setup Confidence (40-100%)."""
    _ensure_career_v2(state)
    rnd = state["current_round"]
    cal_item = state["calendar"][rnd - 1]
    circuit = _circuit_by_id(cal_item["circuit_id"])
    ideal = _ideal_setup_for_circuit(circuit)
    re_rating = float((state["staff"].get("race_engineer") or {}).get("rating", 75))

    ws = state.get("weekend_setup")
    if not ws or ws.get("round") != rnd or ws.get("circuit_id") != circuit["id"]:
        ws = {
            "round": rnd,
            "circuit_id": circuit["id"],
            "stints_used": 0,
            "max_stints": 3,
            "wing": 50,
            "susp": 50,
            "diff": 50,
            "confidence": 64,
            "feedback": {"wing": "UNTESTED", "susp": "UNTESTED", "diff": "UNTESTED"},
        }

    # Enforce Parc Fermé: lock both manual AND Auto-Setup once FP1-FP3 are used or Qualifying is done!
    pq = state.get("pending_quali") or {}
    if pq.get("round") == rnd and pq.get("stage") == "done":
        state["weekend_setup"] = ws
        return False, "Qualifying complete — Car Setup is locked under FIA Parc Fermé!", ws
    if ws["stints_used"] >= ws["max_stints"]:
        state["weekend_setup"] = ws
        return False, "All 3 Practice sessions (FP1–FP3) complete — setup locked in Parc Fermé!", ws

    if auto:
        # Chief Race Engineer auto-tunes close to sweet spot based on rating!
        spread = max(2, int(round((98 - re_rating) * 0.45)))
        rng = random.Random(rnd * 1009 + int(re_rating))
        wing = int(_clamp(ideal["wing"] + rng.randint(-spread, spread), 5, 95))
        susp = int(_clamp(ideal["susp"] + rng.randint(-spread, spread), 5, 95))
        diff = int(_clamp(ideal["diff"] + rng.randint(-spread, spread), 5, 95))
        ws["stints_used"] += 1
    else:
        wing = int(_clamp(wing, 0, 100))
        susp = int(_clamp(susp, 0, 100))
        diff = int(_clamp(diff, 0, 100))
        ws["stints_used"] += 1

    avg_err = (abs(wing - ideal["wing"]) + abs(susp - ideal["susp"]) + abs(diff - ideal["diff"])) / 3.0
    eng_bonus = max(0.0, (re_rating - 72.0) * 0.35)
    conf = int(_clamp(round(100.0 - avg_err * 1.45 + eng_bonus), 42, 100))
    ws["wing"] = wing
    ws["susp"] = susp
    ws["diff"] = diff
    ws["confidence"] = conf
    ws["feedback"] = {
        "wing": _setup_feedback_tag(wing, ideal["wing"]),
        "susp": _setup_feedback_tag(susp, ideal["susp"]),
        "diff": _setup_feedback_tag(diff, ideal["diff"]),
    }
    state["weekend_setup"] = ws
    label = f"FP{ws['stints_used']}"
    return True, f"{label} Complete — Car Setup Confidence: {conf}%!", ws


def run_qualifying(state: dict[str, Any], weather_mode: str = "dynamic") -> dict[str, Any]:
    """Run realistic Qualifying Shootout (plus FIA Sprint Race on 2026 Sprint venues!)."""
    if state.get("season_complete"):
        raise ValueError("Season is already complete — advance to next season first.")
    _ensure_career_v2(state)
    rnd = state["current_round"]
    cal_item = state["calendar"][rnd - 1]
    circuit = _circuit_by_id(cal_item["circuit_id"])
    rng = random.Random()
    pool = _ensure_pu_pool(state)
    pt = get_player_team(state)
    ws = state.get("weekend_setup") or {}
    setup_conf = int(ws.get("confidence", 70)) if (ws.get("round") == rnd and ws.get("circuit_id") == circuit["id"]) else 70

    rival_heat_map = {str(r.get("team_id")): int(r.get("heat") or 0) for r in (state.get("rivalries") or [])}
    grid = []
    for t in state["teams"]:
        car_ovr = _compute_car_overall(t, state.get("staff"))
        rd = t["rd"]
        r_heat = rival_heat_map.get(t["id"], 0)
        if circuit["aero"] == "HIGH":
            car_fit = rd["aero"] * 0.42 + rd["chassis"] * 0.28 + rd["power"] * 0.16 + rd["tyre_care"] * 0.14
        elif circuit["aero"] == "LOW":
            car_fit = rd["power"] * 0.44 + rd["chassis"] * 0.28 + rd["aero"] * 0.16 + rd["tyre_care"] * 0.12
        else:
            car_fit = car_ovr

        for slot_i, did in enumerate(t["driver_ids"]):
            d = state["drivers"].get(did)
            if not d:
                continue
            pu_pen = 0
            pu_wear_pen = 0.0
            setup_delta = 0.0
            if t["is_player"]:
                setup_delta = (setup_conf - 70.0) * 0.014  # up to -0.42s at 100% optimal setup!
                if slot_i < len(pool):
                    pu = pool[slot_i]
                    pu_pen = int(pu.get("grid_penalty", 0))
                    avg_hp = (pu["ice"] + pu["ers"] + pu["gearbox"]) / 3.0
                    if avg_hp < 55:
                        pu_wear_pen = (55 - avg_hp) * 0.015
            q_bonus = 3.0 if "Quali Rocket" in d["trait"] else 0.0
            wet_bonus = (d["stats"]["wet"] - 75) * 0.04 if weather_mode in ("rain", "showers") else 0.0
            perf = car_fit * 0.54 + (d["stats"]["pace"] + q_bonus) * 0.34 + d["stats"]["clutch"] * 0.12
            lap_s = circuit["base_lap_s"] - (perf - 75.0) * 0.095 - wet_bonus - setup_delta + pu_wear_pen + rng.uniform(-0.38, 0.38)
            grid.append({
                "driver_id": did,
                "clean_name": d["clean_name"],
                "code3": d["code3"],
                "team_id": t["id"],
                "team_name": t["name"],
                "color": t["color"],
                "is_player_team": bool(t["is_player"]),
                "rivalry_heat": r_heat,
                "quali_s": round(lap_s, 3),
                "grid_penalty": pu_pen,
                "car_overall": car_ovr,
                "rd": t["rd"],
                "facilities": t["facilities"],
                "driver_data": d,
            })

    grid.sort(key=lambda g: g["quali_s"])
    pole = grid[0]["quali_s"] if grid else 80.0
    for i, g in enumerate(grid, start=1):
        g["raw_pos"] = i
        g["gap_s"] = round(g["quali_s"] - pole, 3)

    # Apply FIA PU Grid Penalties!
    grid.sort(key=lambda g: (g["raw_pos"] + g["grid_penalty"], g["quali_s"]))
    for i, g in enumerate(grid, start=1):
        g["pos"] = i

    # Official 2026 Sprint Weekend Shootout (awards 8-7-6-5-4-3-2-1 pts once per sprint round!)
    sprint_top8 = []
    if cal_item.get("is_sprint") and not cal_item.get("sprint_winner"):
        team_map = {t["id"]: t for t in state["teams"]}
        s_order = sorted(grid, key=lambda g: g["quali_s"] + rng.uniform(-0.45, 0.45))
        for si, sg in enumerate(s_order[:8]):
            pts = SPRINT_POINTS[si]
            sd = state["drivers"].get(sg["driver_id"])
            if sd:
                sd["season_pts"] += pts
            st = team_map.get(sg["team_id"])
            if st:
                st["points"] += pts
            sprint_top8.append({"pos": si + 1, "code3": sg["code3"], "clean_name": sg["clean_name"], "team_name": sg["team_name"], "pts": pts, "is_player_team": sg["is_player_team"]})
        if sprint_top8:
            cal_item["sprint_winner"] = sprint_top8[0]["clean_name"]
            _add_inbox(state, "SPRINT", f"⚡ {cal_item['name']} F1 Sprint Complete!", f"Sprint Winner: {sprint_top8[0]['clean_name']} (+8 pts). Full GP grid is set!")

    quali = {
        "round": rnd,
        "circuit_id": circuit["id"],
        "circuit_name": circuit["name"],
        "gp": circuit["gp"],
        "is_sprint": bool(cal_item.get("is_sprint")),
        "sprint_top8": sprint_top8,
        "weather_mode": weather_mode,
        "stage": "done",
        "saved_fresh_soft": False,
        "grid": grid,
    }
    state["pending_quali"] = quali
    return quali


def run_qualifying_stage(
    state: dict[str, Any],
    stage: str = "q1",
    tyre_choice: str = "fresh",
    weather_mode: str = "dynamic",
    live_times: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Progressive FIA Q1 -> Q2 -> Q3 Knockout Qualifying with Fresh vs Scrubbed Softs call & live-watched times!"""
    _ensure_career_v2(state)
    if state.get("season_complete"):
        raise ValueError("Season is already complete — advance to next season first.")
    st_low = (stage or "q1").strip().lower()
    if st_low == "full":
        q_full = run_qualifying(state, weather_mode=weather_mode)
        wk = state.get("weekend_state")
        if isinstance(wk, dict) and wk.get("round") == state["current_round"]:
            for k in ("q1", "q2", "q3"):
                if k not in wk["completed_sessions"]:
                    wk["completed_sessions"].append(k)
            wk["current_phase"] = "race"
        return q_full

    rnd = state["current_round"]
    cal_item = state["calendar"][rnd - 1]
    circuit = _circuit_by_id(cal_item["circuit_id"])
    rng = random.Random()
    pool = _ensure_pu_pool(state)
    ws = state.get("weekend_setup") or {}
    setup_conf = int(ws.get("confidence", 70)) if (ws.get("round") == rnd and ws.get("circuit_id") == circuit["id"]) else 70
    wk_st = state.get("weekend_state") if isinstance(state.get("weekend_state"), dict) and state["weekend_state"].get("round") == rnd else {}
    car_kn = float(wk_st.get("car_knowledge_pct", 15))
    fp_q_bonus = float(wk_st.get("quali_pace_bonus_s", 0.0))

    def _lap_for_entry(g: dict[str, Any], is_fresh_soft: bool) -> float:
        if isinstance(live_times, dict) and g["driver_id"] in live_times:
            try:
                lv = float(live_times[g["driver_id"]])
                if 45.0 <= lv <= 220.0:
                    return round(lv, 3)
            except Exception:
                pass
        d = g["driver_data"]
        rd = g["rd"]
        if circuit["aero"] == "HIGH":
            car_fit = rd["aero"] * 0.42 + rd["chassis"] * 0.28 + rd["power"] * 0.16 + rd["tyre_care"] * 0.14
        elif circuit["aero"] == "LOW":
            car_fit = rd["power"] * 0.44 + rd["chassis"] * 0.28 + rd["aero"] * 0.16 + rd["tyre_care"] * 0.12
        else:
            car_fit = g["car_overall"]
        setup_delta = ((setup_conf - 70.0) * 0.014 + (car_kn - 15.0) * 0.002 + fp_q_bonus) if g["is_player_team"] else 0.0
        tyre_delta = 0.34 if is_fresh_soft else 0.0
        q_bonus = 3.0 if "Quali Rocket" in d["trait"] else 0.0
        wet_bonus = (d["stats"]["wet"] - 75) * 0.04 if weather_mode in ("rain", "showers") else 0.0
        perf = car_fit * 0.54 + (d["stats"]["pace"] + q_bonus) * 0.34 + d["stats"]["clutch"] * 0.12
        return round(
            circuit["base_lap_s"] - (perf - 75.0) * 0.095 - wet_bonus - setup_delta - tyre_delta + float(g.get("pu_wear_pen", 0.0)) + rng.uniform(-0.34, 0.34),
            3,
        )

    existing = state.get("pending_quali")
    use_fresh = (tyre_choice or "fresh").lower() != "scrubbed"

    if st_low == "q1" or not existing or existing.get("round") != rnd or existing.get("stage") == "done":
        rival_heat_map = {str(r.get("team_id")): int(r.get("heat") or 0) for r in (state.get("rivalries") or [])}
        entries = []
        for t in state["teams"]:
            car_ovr = _compute_car_overall(t, state.get("staff"))
            r_heat = rival_heat_map.get(t["id"], 0)
            for slot_i, did in enumerate(t["driver_ids"]):
                d = state["drivers"].get(did)
                if not d:
                    continue
                pu_pen = 0
                pu_wear_pen = 0.0
                if t["is_player"] and slot_i < len(pool):
                    pu = pool[slot_i]
                    pu_pen = int(pu.get("grid_penalty", 0))
                    avg_hp = (pu["ice"] + pu["ers"] + pu["gearbox"]) / 3.0
                    if avg_hp < 55:
                        pu_wear_pen = (55 - avg_hp) * 0.015
                e = {
                    "driver_id": did,
                    "clean_name": d["clean_name"],
                    "code3": d["code3"],
                    "team_id": t["id"],
                    "team_name": t["name"],
                    "color": t["color"],
                    "is_player_team": bool(t["is_player"]),
                    "rivalry_heat": r_heat,
                    "grid_penalty": pu_pen,
                    "pu_wear_pen": pu_wear_pen,
                    "car_overall": car_ovr,
                    "rd": t["rd"],
                    "facilities": t["facilities"],
                    "driver_data": d,
                    "eliminated_in": None,
                }
                e["q1_s"] = _lap_for_entry(e, use_fresh if e["is_player_team"] else True)
                e["quali_s"] = e["q1_s"]
                entries.append(e)
        entries.sort(key=lambda g: g["quali_s"])
        pole = entries[0]["quali_s"] if entries else 80.0
        for i, g in enumerate(entries, start=1):
            g["pos"] = i
            g["raw_pos"] = i
            g["gap_s"] = round(g["quali_s"] - pole, 3)
            if i > 15:
                g["eliminated_in"] = "Q1"
        quali = {
            "round": rnd,
            "circuit_id": circuit["id"],
            "circuit_name": circuit["name"],
            "gp": circuit["gp"],
            "is_sprint": bool(cal_item.get("is_sprint")),
            "sprint_top8": [],
            "weather_mode": weather_mode,
            "stage": "q1_done",
            "saved_fresh_soft": not use_fresh,
            "grid": entries,
        }
        state["pending_quali"] = quali
        if isinstance(wk_st, dict) and wk_st.get("round") == rnd:
            if "q1" not in wk_st["completed_sessions"]:
                wk_st["completed_sessions"].append("q1")
            wk_st["current_phase"] = "q2"
        return quali

    entries = existing["grid"]
    saved_fresh = bool(existing.get("saved_fresh_soft")) or (not use_fresh)

    if st_low == "q2" and existing.get("stage") == "q1_done":
        top15 = [g for g in entries if g.get("eliminated_in") is None]
        elim_q1 = [g for g in entries if g.get("eliminated_in") == "Q1"]
        for g in top15:
            g["q2_s"] = _lap_for_entry(g, use_fresh if g["is_player_team"] else True)
            g["quali_s"] = g["q2_s"]
        top15.sort(key=lambda g: g["quali_s"])
        pole = top15[0]["quali_s"] if top15 else 80.0
        for i, g in enumerate(top15, start=1):
            g["pos"] = i
            g["raw_pos"] = i
            g["gap_s"] = round(g["quali_s"] - pole, 3)
            if i > 10:
                g["eliminated_in"] = "Q2"
        combined = top15 + elim_q1
        for i, g in enumerate(combined, start=1):
            g["pos"] = i
            g["raw_pos"] = i
        existing["grid"] = combined
        existing["stage"] = "q2_done"
        existing["saved_fresh_soft"] = saved_fresh
        state["pending_quali"] = existing
        if isinstance(wk_st, dict) and wk_st.get("round") == rnd:
            if "q2" not in wk_st["completed_sessions"]:
                wk_st["completed_sessions"].append("q2")
            wk_st["current_phase"] = "q3"
        return existing

    # Q3 Top-10 Pole Shootout + Final FIA Grid Penalties + Sprint Shootout!
    top10 = [g for g in entries if g.get("eliminated_in") is None]
    elim_rest = [g for g in entries if g.get("eliminated_in") is not None]
    for g in top10:
        g["q3_s"] = _lap_for_entry(g, use_fresh if g["is_player_team"] else True)
        g["quali_s"] = g["q3_s"]
    top10.sort(key=lambda g: g["quali_s"])
    pole = top10[0]["quali_s"] if top10 else 80.0
    combined = top10 + elim_rest
    for i, g in enumerate(combined, start=1):
        g["raw_pos"] = i
        g["gap_s"] = round(max(0.0, g["quali_s"] - pole), 3)

    # Apply FIA PU Grid Penalties after Q3
    combined.sort(key=lambda g: (g["raw_pos"] + g["grid_penalty"], g["quali_s"]))
    for i, g in enumerate(combined, start=1):
        g["pos"] = i

    sprint_top8 = existing.get("sprint_top8") or []
    if cal_item.get("is_sprint") and not cal_item.get("sprint_winner"):
        team_map = {t["id"]: t for t in state["teams"]}
        s_order = sorted(combined, key=lambda g: g["quali_s"] + rng.uniform(-0.45, 0.45))
        for si, sg in enumerate(s_order[:8]):
            pts = SPRINT_POINTS[si]
            sd = state["drivers"].get(sg["driver_id"])
            if sd:
                sd["season_pts"] += pts
            st = team_map.get(sg["team_id"])
            if st:
                st["points"] += pts
            sprint_top8.append({"pos": si + 1, "code3": sg["code3"], "clean_name": sg["clean_name"], "team_name": sg["team_name"], "pts": pts, "is_player_team": sg["is_player_team"]})
        if sprint_top8:
            cal_item["sprint_winner"] = sprint_top8[0]["clean_name"]
            _add_inbox(state, "SPRINT", f"⚡ {cal_item['name']} F1 Sprint Complete!", f"Sprint Winner: {sprint_top8[0]['clean_name']} (+8 pts). Full GP grid is set!")

    existing["grid"] = combined
    existing["sprint_top8"] = sprint_top8
    existing["stage"] = "done"
    existing["saved_fresh_soft"] = saved_fresh
    state["pending_quali"] = existing
    if isinstance(wk_st, dict) and wk_st.get("round") == rnd:
        for k in ("q1", "q2", "q3"):
            if k not in wk_st["completed_sessions"]:
                wk_st["completed_sessions"].append(k)
        wk_st["current_phase"] = "race"
    return existing


def commit_race_result(
    state: dict[str, Any],
    standings: list[dict[str, Any]],     # [{driver_id, pos, dnf, fastest_lap, stints, stops}]
    fastest_lap_driver_id: str | None = None,
    telemetry: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Commit finished GP results (validated, idempotent) + build permanent Race Report & Driver Ratings."""
    _ensure_career_v2(state)
    if state.get("season_complete"):
        raise ValueError("Season already complete.")

    rnd = state["current_round"]
    cal_item = state["calendar"][rnd - 1]
    if cal_item.get("completed"):
        raise ValueError(f"Round {rnd} has already been committed.")

    if not standings:
        raise ValueError("Standings list cannot be empty.")

    pt = get_player_team(state)
    team_map = {t["id"]: t for t in state["teams"]}
    hosp_mult = 1.0 + (pt["facilities"].get("hospitality", 1) - 1) * 0.12
    sim_xp_mult = 1.0 + (pt["facilities"].get("pit_sim", 1) - 1) * 0.18
    telem = telemetry or {}

    # Map starting grid positions from pending_quali for Driver Ratings (1.0 - 10.0) & Pole tracking
    grid_pos_map: dict[str, int] = {}
    pq = state.get("pending_quali") or {}
    if pq.get("round") == rnd:
        for g in pq.get("grid") or []:
            grid_pos_map[g["driver_id"]] = int(g.get("pos") or 12)

    valid_rows = [r for r in standings if isinstance(r, dict) and r.get("driver_id") in state["drivers"]]
    if not valid_rows:
        raise ValueError("No valid career driver IDs in standings.")

    sorted_res = sorted(valid_rows, key=lambda r: (1 if r.get("dnf") else 0, int(r.get("pos") or 99)))
    player_finishes = []
    race_pts_player = 0
    player_fl = False
    player_from_pole = False
    classification = []

    for idx, row in enumerate(sorted_res, start=1):
        did = row["driver_id"]
        d = state["drivers"].get(did)
        if not d:
            continue
        is_dnf = bool(row.get("dnf"))
        pos = idx
        start_pos = grid_pos_map.get(did, pos)
        pts = 0 if is_dnf else (FIA_POINTS[pos - 1] if pos <= len(FIA_POINTS) else 0)
        got_fl = (not is_dnf and pos <= 10 and did == fastest_lap_driver_id)
        if got_fl:
            pts += 1
            d["season_fl"] += 1
            if d["team_id"] == pt["id"]:
                player_fl = True

        # Driver Performance Rating (1.0 - 10.0)
        if is_dnf:
            rating = 4.2
        else:
            gain_delta = (start_pos - pos) * 0.25
            base_r = 9.4 if pos == 1 else (8.7 if pos <= 3 else (7.8 if pos <= 6 else (7.1 if pos <= 10 else 6.1)))
            rating = round(_clamp(base_r + gain_delta + (0.5 if got_fl else 0.0), 3.0, 10.0), 1)

        d["season_pts"] += pts
        if not is_dnf and pos == 1:
            d["season_wins"] += 1
            if d["team_id"] == pt["id"] and start_pos == 1:
                player_from_pole = True
        if not is_dnf and pos <= 3:
            d["season_podiums"] += 1

        t = team_map.get(d["team_id"])
        if t:
            t["points"] += pts
            if not is_dnf and pos == 1:
                t["wins"] += 1
            if not is_dnf and pos <= 3:
                t["podiums"] += 1

        stints = row.get("stints") if isinstance(row.get("stints"), list) else (["M", "H"] if not is_dnf else ["M"])
        classification.append({
            "pos": pos,
            "start_pos": start_pos,
            "driver_id": did,
            "code3": d["code3"],
            "clean_name": d["clean_name"],
            "team_name": t["name"] if t else "",
            "color": t["color"] if t else (d.get("hero_color") or "#64748b"),
            "is_player": d["team_id"] == pt["id"],
            "dnf": is_dnf,
            "pts": pts,
            "fl": got_fl,
            "stints": stints,
            "stops": int(row.get("stops") if row.get("stops") is not None else max(0, len(stints) - 1)),
            "rating": rating,
        })

        # Driver XP & dynamic growth
        if d["team_id"] == pt["id"]:
            race_pts_player += pts
            player_finishes.append({
                "driver": d["clean_name"],
                "code3": d["code3"],
                "pos": pos,
                "start_pos": start_pos,
                "dnf": is_dnf,
                "pts": pts,
                "rating": rating,
                "stints": stints,
            })
            xp_gain = int(((22 - min(20, pos)) * 4 + (15 if pts > 0 else 0)) * sim_xp_mult * (1.3 if "Simulator Ace" in d["trait"] else 1.0))
            d["xp"] += xp_gain
            if d["xp"] >= 100 and d["overall"] < d["potential"]:
                d["xp"] -= 100
                d["overall"] = round(min(d["potential"], d["overall"] + 1.0), 1)
                foc = d.get("dev_focus") or "balanced"
                if foc in ("pace", "racecraft", "wet", "reliability"):
                    d["stats"][foc] = min(99, d["stats"][foc] + 2)
                    foc_note = f"{foc.title()} +2 (Focus Programme)."
                else:
                    d["stats"]["pace"] = min(99, d["stats"]["pace"] + 1)
                    d["stats"]["racecraft"] = min(99, d["stats"]["racecraft"] + 1)
                    foc_note = "Pace +1 & Racecraft +1 (Balanced Programme)."
                _add_inbox(state, "DEV", f"Driver Level Up: {d['clean_name']} → OVR {d['overall']}!", foc_note)
            d["morale"] = int(_clamp(d["morale"] + (6 if pts > 0 else -3), 35, 99))

    # Update calendar round summary
    winner_row = sorted_res[0] if sorted_res else None
    if winner_row and winner_row["driver_id"] in state["drivers"]:
        wd = state["drivers"][winner_row["driver_id"]]
        cal_item["winner"] = wd["clean_name"]
        wt = team_map.get(wd["team_id"])
        cal_item["winner_team"] = wt["name"] if wt else ""
    if fastest_lap_driver_id and fastest_lap_driver_id in state["drivers"]:
        cal_item["fastest_lap"] = state["drivers"][fastest_lap_driver_id]["clean_name"]
    cal_item["completed"] = True
    cal_item["player_results"] = player_finishes

    # Financial settlement for this GP
    prize_m = round(1.6 + race_pts_player * 0.24, 2)
    sponsor_base = round(sum(s["per_race_m"] for s in state["sponsors"]) * hosp_mult, 2)
    sponsor_bonus = 0.0
    goals_hit = []
    for s in state["sponsors"]:
        gt = s["goal_type"]
        hit = False
        best_p = min((f["pos"] for f in player_finishes if not f["dnf"]), default=99)
        if gt == "top10" and best_p <= 10:
            hit = True
        elif gt == "top6" and best_p <= 6:
            hit = True
        elif gt == "podium" and best_p <= 3:
            hit = True
        elif gt == "both_finish" and len(player_finishes) >= 2 and all(not f["dnf"] for f in player_finishes):
            hit = True
        elif gt == "double_points" and sum(1 for f in player_finishes if not f["dnf"] and f["pos"] <= 10) >= 2:
            hit = True
        elif gt == "fastest_lap" and (player_fl or best_p == 1):
            hit = True
        if hit:
            b = round(s["bonus_m"] * hosp_mult, 2)
            sponsor_bonus = round(sponsor_bonus + b, 2)
            goals_hit.append(f"{s['name']} (+${b}M)")

    # Sponsor magnet driver trait
    for did in pt["driver_ids"]:
        d = state["drivers"].get(did)
        if d and "Sponsor Magnet" in d["trait"]:
            sponsor_base = round(sponsor_base + 0.4, 2)

    # Per-race Driver Salaries + Technical Staff Payroll + Facility Upkeep
    num_rounds = max(1, len(state["calendar"]))
    sal_total = sum(state["drivers"][did]["salary_m"] for did in pt["driver_ids"] if did in state["drivers"])
    if pt.get("reserve_id") and pt["reserve_id"] in state["drivers"]:
        sal_total += state["drivers"][pt["reserve_id"]]["salary_m"]
    sal_per_race = round(sal_total / num_rounds, 2)
    staff_sal_total = sum(float(s.get("salary_m") or 0.0) for s in (state.get("staff") or {}).values())
    staff_per_race = round(staff_sal_total / num_rounds, 2)
    upkeep = round(sum(f["upkeep_per_lvl"] * pt["facilities"].get(f["id"], 1) for f in FACILITY_DEFS), 2)

    # Rivalry Heat Bonus: outscoring a heated rival (heat >= 50) yields Sponsor & Board bonus!
    team_race_pts: dict[str, int] = {}
    for cl in classification:
        d_obj = state["drivers"].get(cl["driver_id"])
        if d_obj and d_obj.get("team_id"):
            tid_c = d_obj["team_id"]
            team_race_pts[tid_c] = team_race_pts.get(tid_c, 0) + int(cl["pts"] or 0)
    rivals_beaten: list[str] = []
    rival_bonus_m = 0.0
    for rv in (state.get("rivalries") or []):
        if int(rv.get("heat") or 0) >= 50:
            r_pts = team_race_pts.get(rv.get("team_id"), 0)
            if race_pts_player > r_pts:
                rivals_beaten.append(str(rv.get("team_name") or "Rival"))
                rival_bonus_m = round(rival_bonus_m + 1.0, 2)
    if rivals_beaten:
        state["board_confidence"] = int(_clamp(state["board_confidence"] + 4, 0, 100))
        _add_inbox(
            state,
            "MEDIA",
            f"🔥 Outscored Heated Rival: {', '.join(rivals_beaten)}!",
            f"Beating your paddock rival on track earned a +${rival_bonus_m:.1f}M sponsor rivalry bonus & +4% Board Confidence!",
        )

    net_m = round(prize_m + sponsor_base + sponsor_bonus + rival_bonus_m - sal_per_race - staff_per_race - upkeep, 2)
    _log_finance(state, f"R{rnd} {cal_item['name']} Net (Prize+Spon-Payroll-HQ)", net_m, cap_eligible=False)

    # Degrade Car #1 & Car #2 Power Unit / ERS / Gearbox health & clear served grid penalties
    pu_mit = max(0.65, 1.0 - (pt["facilities"].get("powertrain_lab", 1) - 1) * 0.08)
    for pu in _ensure_pu_pool(state):
        pu["ice"] = max(15, round(pu["ice"] - 11.5 * pu_mit))
        pu["ers"] = max(15, round(pu["ers"] - 10.0 * pu_mit))
        pu["gearbox"] = max(15, round(pu["gearbox"] - 9.5 * pu_mit))
        pu["grid_penalty"] = 0

    # Tick Active R&D Projects with Authentic Wind-Tunnel Correlation Verification!
    rd_rng = random.Random()
    completed_rd = []
    still_rd = []
    for proj in state["active_rd"]:
        proj["rounds_left"] -= 1
        if proj["rounds_left"] <= 0:
            corr_pct = int(proj.get("correlation_pct") or 82)
            roll = rd_rng.random() * 100.0
            base_gain = float(proj["gain"])
            if corr_pct >= 88 and roll < 16.0:
                actual_gain = round(base_gain * 1.30, 1)
                outcome = "BREAKTHROUGH"
                out_note = f"🚀 WIND-TUNNEL BREAKTHROUGH! Track aero load exceeded CFD by +30% (+{actual_gain} actual vs +{base_gain} est.)!"
            elif roll > corr_pct:
                actual_gain = round(base_gain * rd_rng.uniform(0.50, 0.72), 1)
                outcome = "MISMATCH"
                out_note = f"⚠ CORRELATION MISMATCH! On-track flow differed from wind tunnel (+{actual_gain} actual vs +{base_gain} est.)."
            else:
                actual_gain = base_gain
                outcome = "CLEAN"
                out_note = f"✅ Clean wind-tunnel correlation (+{actual_gain} delivered on track)!"

            sec_part = proj.get("secondary")
            if sec_part and sec_part in pt["rd"]:
                p_gain = round(actual_gain * 0.72, 1)
                s_gain = round(actual_gain * 0.28, 1)
                pt["rd"][proj["part"]] = round(_clamp(pt["rd"][proj["part"]] + p_gain, 45.0, 99.0), 1)
                pt["rd"][sec_part] = round(_clamp(pt["rd"][sec_part] + s_gain, 45.0, 99.0), 1)
            else:
                pt["rd"][proj["part"]] = round(_clamp(pt["rd"][proj["part"]] + actual_gain, 45.0, 99.0), 1)

            comp_id = proj.get("component_id")
            if comp_id and comp_id in (state.get("parts_inventory") or {}):
                inv = state["parts_inventory"][comp_id]
                inv["spec"] = int(inv.get("spec", 1)) + 1
                inv["spares"] = min(6, int(inv.get("spares", 0)) + 2)
                inv["last_corr"] = outcome
            state.setdefault("rd_history", []).insert(0, {
                "round": rnd,
                "label": proj["label"],
                "est_gain": base_gain,
                "actual_gain": actual_gain,
                "outcome": outcome,
            })
            state["rd_history"] = state["rd_history"][:12]
            pt["car_overall"] = _compute_car_overall(pt, state.get("staff"))
            proj["actual_gain"] = actual_gain
            proj["outcome"] = outcome
            completed_rd.append(proj)
            _add_inbox(state, "R&D", f"Upgrade Fitted: {proj['label']} ({outcome})", f"{out_note} Car Rating is now {pt['car_overall']}!")
        else:
            still_rd.append(proj)
    state["active_rd"] = still_rd

    # Crash Spare Parts Attrition (DNF consumes 1x Front Wing or Floor spare!)
    player_dnfs = [f for f in player_finishes if f.get("dnf")]
    if player_dnfs and isinstance(state.get("parts_inventory"), dict):
        dmg_comp = rd_rng.choice(["front_wing", "floor_diffuser"])
        inv = state["parts_inventory"].get(dmg_comp)
        if inv:
            inv["spares"] = max(0, int(inv.get("spares", 0)) - 1)
            bp_nm = next((b["name"] for b in CAR_BLUEPRINTS if b["id"] == dmg_comp), dmg_comp)
            _add_inbox(
                state,
                "FACTORY",
                f"⚠ Spare Consumed: {bp_nm} ({inv['spares']} left)",
                f"Race incident for {player_dnfs[0]['driver']} destroyed a {bp_nm}. Manufacture a spare in R&D to protect your latest spec!",
            )

    # Refresh Official FIA ATR Sliding-Scale Allowance every 4 rounds!
    atr = state.get("atr") or {}
    if rnd + 1 >= int(atr.get("next_reset_round") or 5):
        new_atr = _refresh_atr_period(state, int(atr.get("period") or 1) + 1)
        _add_inbox(
            state,
            "FIA ATR",
            f"ATR Testing Period {new_atr['period']} Reset ({new_atr['atr_pct']}% Scale)",
            f"Based on P{new_atr['wcc_rank']} WCC, FIA allocated {new_atr['wt_hrs_max']}h Wind Tunnel & {new_atr['cfd_max']} CFD items for the next 4 rounds!",
        )

    # Tick Active Scouts
    completed_scouts = []
    still_scouts = []
    for sc in state["active_scouts"]:
        sc["rounds_left"] -= 1
        if sc["rounds_left"] <= 0:
            drv = state["drivers"].get(sc["driver_id"])
            if drv:
                drv["scouted"] = True
                completed_scouts.append(drv["clean_name"])
                _add_inbox(
                    state,
                    "SCOUT",
                    f"Scout Dossier Ready: {drv['clean_name']}",
                    f"Revealed: OVR {drv['overall']} · Potential {drv['potential']} · Wet {drv['stats']['wet']} · {drv['trait']} · Demand ${drv['salary_m']}M/yr.",
                )
        else:
            still_scouts.append(sc)
    state["active_scouts"] = still_scouts

    # AI Teams gently develop their cars between rounds so the season stays competitive!
    rng = random.Random()
    for t in state["teams"]:
        if t["is_player"]:
            continue
        if rng.random() < 0.42:
            part = rng.choice(["aero", "chassis", "power", "tyre_care"])
            t["rd"][part] = round(_clamp(t["rd"][part] + rng.uniform(0.4, 1.4), 50.0, 97.0), 1)
            t["car_overall"] = _compute_car_overall(t)

    # Update Board Confidence & enforce Ultimatums / Restructuring stakes
    wcc_sorted = sorted(state["teams"], key=lambda x: (-x["points"], -x["wins"], -x["car_overall"]))
    p_wcc_pos = next((i + 1 for i, t in enumerate(wcc_sorted) if t["id"] == pt["id"]), len(wcc_sorted))
    conf_delta = 3 if p_wcc_pos <= state["board_expect_wcc"] else -3
    state["board_confidence"] = int(_clamp(state["board_confidence"] + conf_delta, 0, 100))

    best_player_p = min((f["pos"] for f in player_finishes if not f["dnf"]), default=20)
    ult = state.get("board_ultimatum")
    if isinstance(ult, dict):
        if best_player_p <= int(ult.get("target_pos", 6)) or p_wcc_pos <= state["board_expect_wcc"]:
            state["board_confidence"] = int(_clamp(state["board_confidence"] + 15, 0, 100))
            state["board_ultimatum"] = None
            _add_inbox(state, "BOARD", "✅ Board Ultimatum Passed!", f"Strong track response restored confidence to {state['board_confidence']}%!")
        else:
            ult["races_left"] = int(ult.get("races_left", 1)) - 1
            if ult["races_left"] <= 0:
                state["board_confidence"] = int(_clamp(state["board_confidence"] - 15, 0, 100))
                state["board_ultimatum"] = None
                _add_inbox(state, "BOARD", "🚨 Board Ultimatum Missed!", f"Board patience is wearing thin — confidence dropped to {state['board_confidence']}%.")
    elif state["board_confidence"] < 35 and state["board_confidence"] > 0:
        tgt = min(10, max(3, int(state["board_expect_wcc"]) + 1))
        state["board_ultimatum"] = {"races_left": 2, "target_pos": tgt}
        _add_inbox(
            state,
            "BOARD",
            "⚠ BOARD ULTIMATUM: 2 Races to Deliver!",
            f"Confidence fell to {state['board_confidence']}%. Score Top {tgt} or reach WCC P{state['board_expect_wcc']} within 2 races to avoid emergency restructuring!",
        )

    if state["board_confidence"] <= 0:
        cut = round(max(0.0, state["cash_m"] * 0.20), 2)
        if cut > 0:
            _log_finance(state, "Board Emergency Restructuring Cut", -cut, cap_eligible=False)
        state["board_confidence"] = 45
        state["board_ultimatum"] = None
        _add_inbox(
            state,
            "BOARD",
            "🚨 Board Restructuring Executed!",
            f"Board confidence hit 0%. Emergency restructuring trimmed ${cut:.1f}M from cash reserves and reset confidence to 45%.",
        )

    state.setdefault("wcc_history", []).append({
        "round": rnd,
        "gp": cal_item["name"],
        "points": {t["id"]: t["points"] for t in state["teams"]},
    })

    # Update Permanent Multi-Season Dynasty & Hall of Fame Totals
    dyn = state["dynasty"]
    dyn["races"] = int(dyn.get("races") or 0) + 1
    dyn["points"] = int(dyn.get("points") or 0) + race_pts_player
    if player_fl:
        dyn["fastest_laps"] = int(dyn.get("fastest_laps") or 0) + 1
    best_pit = telem.get("best_pit_s")
    if isinstance(best_pit, (int, float)) and best_pit > 1.2:
        prev_bp = dyn.get("best_pit_s")
        if prev_bp is None or float(best_pit) < float(prev_bp):
            dyn["best_pit_s"] = round(float(best_pit), 2)
    drv_recs = dyn.setdefault("driver_records", {})
    for pf in player_finishes:
        nm = str(pf.get("driver") or "")
        if not nm:
            continue
        rec = drv_recs.setdefault(nm, {"name": nm, "code3": pf.get("code3") or nm[:3].upper(), "races": 0, "wins": 0, "podiums": 0, "poles": 0, "fl": 0, "points": 0})
        rec["races"] += 1
        rec["points"] += int(pf.get("pts") or 0)
        if not pf.get("dnf") and int(pf.get("pos") or 99) == 1:
            rec["wins"] += 1
            dyn["wins"] = int(dyn.get("wins") or 0) + 1
        if not pf.get("dnf") and int(pf.get("pos") or 99) <= 3:
            rec["podiums"] += 1
            dyn["podiums"] = int(dyn.get("podiums") or 0) + 1
        if int(pf.get("start_pos") or 99) == 1:
            rec["poles"] += 1
            dyn["poles"] = int(dyn.get("poles") or 0) + 1
        if fastest_lap_driver_id and state["drivers"].get(fastest_lap_driver_id, {}).get("clean_name") == nm:
            rec["fl"] += 1

    # Spawn contextual Post-Race Press Conference prompt + Career Analytics + FIA Stewards/Licence!
    state["pending_media"] = _build_post_race_media(state, cal_item, player_finishes, wcc_sorted, p_wcc_pos, bool(telem.get("is_wet")))
    from .career_extras import record_analytics_snapshot, maybe_spawn_stewards_hearing
    prev_quali_grid = (state.get("pending_quali") or {}).get("grid") if isinstance(state.get("pending_quali"), dict) else None
    record_analytics_snapshot(state, cal_item, player_finishes, prev_quali_grid, wcc_sorted, pt, telem)
    maybe_spawn_stewards_hearing(state, cal_item, player_finishes, pt, _add_inbox)
    state["parc_ferme_locked"] = False

    state["weekend_setup"] = None
    state["weekend_state"] = None
    # Spawn a fresh interactive Paddock Decision if none is pending!
    if not state.get("pending_dilemma") and rnd < len(state["calendar"]):
        state["pending_dilemma"] = _spawn_dilemma(state)

    # Advance round or complete season
    state["pending_quali"] = None
    if rnd >= len(state["calendar"]):
        state["season_complete"] = True
        # End-of-season WCC Prize Pool!
        wcc_prize = round(max(12.0, 56.0 - (p_wcc_pos - 1) * 4.2), 1)
        _log_finance(state, f"Season {state['season_num']} WCC P{p_wcc_pos} Prize Pool", wcc_prize)
        wdc_top = sorted(
            [d for d in state["drivers"].values() if d["team_id"] is not None],
            key=lambda d: (-d["season_pts"], -d["season_wins"], -d["overall"]),
        )
        champ_drv = wdc_top[0]["clean_name"] if wdc_top else "—"
        champ_team = wcc_sorted[0]["name"] if wcc_sorted else "—"
        season_rec = {
            "season": state["season_num"],
            "year": state["season_year"],
            "wdc": champ_drv,
            "wcc": champ_team,
            "player_wcc_pos": p_wcc_pos,
            "player_pts": pt["points"],
            "player_wins": pt["wins"],
            "car_overall": pt["car_overall"],
            "car_era": pt.get("car_era") or "2020s",
            "livery_color": pt.get("color") or "#e10600",
            "livery_style": pt.get("livery_style") or "two-tone",
        }
        state["champions_history"].append(season_rec)
        dyn.setdefault("garage_seasons", []).append(season_rec)
        _add_inbox(
            state,
            "CHAMPIONSHIP",
            f"Season {state['season_num']} Complete — WCC P{p_wcc_pos} (+${wcc_prize}M)!",
            f"WDC Champion: {champ_drv} · WCC Champion: {champ_team}. Advance to Season {state['season_num'] + 1} when ready!",
        )
    else:
        state["current_round"] = rnd + 1

    # Mid-season Silly Season Rumour alert for expiring contracts!
    if rnd == max(2, len(state["calendar"]) // 2):
        expiring = [state["drivers"][did]["clean_name"] for did in pt["driver_ids"] if did in state["drivers"] and int(state["drivers"][did].get("contract_years", 2)) <= 1]
        if expiring:
            _add_inbox(
                state,
                "SILLY SEASON",
                f"Rival Interest in {', '.join(expiring)}!",
                "Contracts expiring at season end! Use the 'Renew' button on your HQ Dashboard before rival principals swoop in.",
            )
        else:
            _add_inbox(
                state,
                "SILLY SEASON",
                "Mid-Season Transfer Market Heating Up",
                "Multiple rival constructors are scouting young talent and veteran free agents ahead of next season.",
            )

    race_report = {
        "season_num": state["season_num"],
        "round_num": rnd,
        "circuit_id": cal_item["circuit_id"],
        "gp_name": cal_item["gp"],
        "circuit_name": cal_item["name"],
        "winner_name": cal_item.get("winner") or "",
        "winner_team": cal_item.get("winner_team") or "",
        "fastest_lap_name": cal_item.get("fastest_lap") or "",
        "weather_summary": str(telem.get("weather_summary") or "Dry"),
        "is_wet": bool(telem.get("is_wet")),
        "sc_count": int(telem.get("sc_count") or 0),
        "vsc_count": int(telem.get("vsc_count") or 0),
        "red_flag_count": int(telem.get("red_flag_count") or 0),
        "lap_history": telem.get("lap_history") if isinstance(telem.get("lap_history"), list) else [],
        "classification": classification,
        "player_finishes": player_finishes,
    }

    return {
        "round": rnd,
        "season_num": state["season_num"],
        "gp": cal_item["gp"],
        "player_finishes": player_finishes,
        "race_pts_player": race_pts_player,
        "player_fl": player_fl,
        "player_from_pole": player_from_pole,
        "is_wet": bool(telem.get("is_wet")),
        "red_flag_count": int(telem.get("red_flag_count") or 0),
        "car_overall": pt["car_overall"],
        "prize_m": prize_m,
        "sponsor_base_m": sponsor_base,
        "sponsor_bonus_m": sponsor_bonus,
        "rival_bonus_m": rival_bonus_m,
        "rivals_beaten": rivals_beaten,
        "goals_hit": goals_hit,
        "sal_per_race_m": sal_per_race,
        "staff_per_race_m": staff_per_race,
        "upkeep_m": upkeep,
        "net_m": net_m,
        "completed_rd": completed_rd,
        "completed_scouts": completed_scouts,
        "season_complete": state["season_complete"],
        "won_wcc": bool(state["season_complete"] and p_wcc_pos == 1),
        "won_wdc": bool(state["season_complete"] and state["champions_history"] and any(d["clean_name"] == state["champions_history"][-1]["wdc"] and d["team_id"] == pt["id"] for d in state["drivers"].values())),
        "media_prompt": state.get("pending_media"),
        "race_report": race_report,
    }


def quick_sim_race(state: dict[str, Any], weather_mode: str = "dynamic") -> dict[str, Any]:
    """Fast-simulate the current GP weekend (uses Qualifying grid + full driver/car/facility physics)."""
    quali = state.get("pending_quali") or run_qualifying(state, weather_mode=weather_mode)
    circuit = _circuit_by_id(quali["circuit_id"])
    rng = random.Random()
    is_wet = weather_mode == "rain" or (weather_mode == "showers") or (weather_mode == "dynamic" and rng.random() * 100 < circuit["rain_chance"])

    scored = []
    for g in quali["grid"]:
        d = state["drivers"][g["driver_id"]]
        fac = g["facilities"]
        rd = g["rd"]
        dnf_prob = (d["stats"]["dnf_rate"] / 100.0) * 0.42
        dnf_prob *= max(0.45, 1.0 - (fac.get("powertrain_lab", 1) - 1) * 0.08)
        if "Clean Racer" in d["trait"]:
            dnf_prob *= 0.75
        is_dnf = rng.random() < dnf_prob

        pit_bonus = (fac.get("pit_sim", 1) - 1) * 0.65
        wet_delta = (d["stats"]["wet"] - 74) * 0.16 if is_wet else 0.0
        rival_aggro = 1.1 if (not g.get("is_player_team") and int(g.get("rivalry_heat") or 0) >= 50) else 0.0
        race_score = (
            g["car_overall"] * 0.48
            + d["stats"]["racecraft"] * 0.28
            + d["stats"]["pace"] * 0.14
            + d["stats"]["clutch"] * 0.10
            + (22 - g["pos"]) * 0.35
            + pit_bonus * 0.9
            + wet_delta
            + rival_aggro
            + rng.uniform(-4.5, 4.5)
        )
        scored.append({"driver_id": g["driver_id"], "score": race_score, "dnf": is_dnf})

    scored.sort(key=lambda x: (1 if x["dnf"] else 0, -x["score"]))
    standings = [{"driver_id": x["driver_id"], "pos": i + 1, "dnf": x["dnf"], "stints": (["I", "I"] if is_wet else ["M", "H"])} for i, x in enumerate(scored)]
    finishers = [x for x in standings if not x["dnf"]]
    fl_id = rng.choice(finishers[:6])["driver_id"] if finishers else None
    return commit_race_result(
        state,
        standings,
        fastest_lap_driver_id=fl_id,
        telemetry={"is_wet": is_wet, "weather_summary": "Wet / Showers" if is_wet else "Dry"},
    )


def advance_to_next_season(state: dict[str, Any]) -> dict[str, Any]:
    """Roll over into the next Championship Season (regulation shakeup, contracts tick, reset points)."""
    rng = random.Random()
    state["season_num"] += 1
    state["season_year"] += 1
    state["current_round"] = 1
    state["season_complete"] = False
    state["cost_cap_spent_m"] = 0.0
    cap_pen = float(state.get("next_season_cap_penalty_m") or 0.0)
    state["cost_cap_m"] = round(max(100.0, 135.0 - cap_pen), 1)
    state["cost_cap_breach_tier"] = "none"
    state["rd_nerf_mult"] = 1.0
    state["next_season_cap_penalty_m"] = 0.0
    state["pending_quali"] = None

    _ensure_career_v2(state)
    ng = state.get("next_gen_research") or {}
    for t in state["teams"]:
        t["points"] = 0
        t["wins"] = 0
        t["podiums"] = 0
        # Off-season regulation compression + player's Next-Season Regulation Research carry-over!
        for part in ("aero", "chassis", "power", "tyre_care"):
            mean_pull = (76.0 - t["rd"][part]) * 0.18
            ng_bonus = float(ng.get(part, 0.0)) if t["is_player"] else 0.0
            t["rd"][part] = round(_clamp(t["rd"][part] + mean_pull + ng_bonus + rng.uniform(-2.0, 2.5), 55.0, 98.0), 1)
        t["car_overall"] = _compute_car_overall(t, state.get("staff"))
    state["next_gen_research"] = {"aero": 0.0, "chassis": 0.0, "power": 0.0, "tyre_care": 0.0}
    state["wcc_history"] = []
    state["weekend_setup"] = None
    state["weekend_state"] = None
    state["pending_dilemma"] = _spawn_dilemma(state)

    silly_recap: list[dict[str, str]] = []
    pt = get_player_team(state)
    team_by_id = {t["id"]: t for t in state["teams"]}

    # 1. Reset seasonal stats, age drivers (including gentle decline >=36), tick contracts & handle retirements
    retired_ids: list[str] = []
    for d in list(state["drivers"].values()):
        d["season_pts"] = 0
        d["season_wins"] = 0
        d["season_podiums"] = 0
        d["season_fl"] = 0
        d["age"] += 1
        if d["age"] >= 36 and d.get("role") != "retired":
            d["stats"]["pace"] = max(60, int(d["stats"]["pace"]) - 1)
            d["overall"] = round(max(60.0, float(d["overall"]) - 0.5), 1)
        if d["contract_years"] > 0:
            d["contract_years"] -= 1
        # Player veteran retirement warning at 40, actual retirement at 41+
        if d.get("team_id") == pt["id"] and d.get("role") == "race":
            if d["age"] >= 41 and d.get("retiring_end_of_season"):
                d["team_id"] = None
                d["role"] = "retired"
                d["contract_years"] = 0
                retired_ids.append(d["id"])
                silly_recap.append({
                    "type": "RETIREMENT",
                    "headline": f"{d['clean_name']} (Age {d['age']}) Retires From {pt['name']}!",
                    "detail": "Hangs up the helmet after an iconic F1 career. Promote your Academy Reserve or sign a successor!",
                })
                continue
            if d["age"] >= 40 and not d.get("retiring_end_of_season"):
                d["retiring_end_of_season"] = True
                _add_inbox(
                    state,
                    "MARKET",
                    f"Farewell Tour: {d['clean_name']} (Age {d['age']})",
                    f"{d['clean_name']} informed the paddock this will be their final F1 season before retirement — prepare your Academy succession plan!",
                )
        # AI veterans age >= 41 may retire
        if d["age"] >= 41 and d.get("team_id") != pt["id"] and rng.random() < 0.45:
            old_t = team_by_id.get(d["team_id"])
            if old_t and d["id"] in old_t["driver_ids"]:
                old_t["driver_ids"].remove(d["id"])
            d["team_id"] = None
            d["role"] = "retired"
            retired_ids.append(d["id"])
            silly_recap.append({
                "type": "RETIREMENT",
                "headline": f"{d['clean_name']} (Age {d['age']}) Announces F1 Retirement",
                "detail": f"Steps down from {old_t['name'] if old_t else 'Formula 1'} after a storied career.",
            })

    # 2. Enforce expired player driver contracts (if not renewed -> enter free agency & auto-backfill!)
    for idx, did in enumerate(list(pt["driver_ids"])):
        drv = state["drivers"].get(did)
        if drv and drv["contract_years"] <= 0:
            drv["team_id"] = None
            drv["role"] = "free_agent"
            drv["contract_years"] = 0
            silly_recap.append({
                "type": "DEPARTURE",
                "headline": f"{drv['clean_name']} Leaves {pt['name']} (Contract Expired)",
                "detail": "Entered Free Agency after contract expired without renewal.",
            })
            # Promote Reserve or sign best Free Agent so player always starts with 2 cars!
            rep = None
            if pt.get("reserve_id") and pt["reserve_id"] in state["drivers"]:
                rep = state["drivers"][pt["reserve_id"]]
                pt["reserve_id"] = None
            else:
                fas = [x for x in state["drivers"].values() if x["team_id"] is None and x["role"] == "free_agent" and x["id"] != did]
                fas.sort(key=lambda x: -x["overall"])
                rep = fas[0] if fas else drv
            rep["team_id"] = pt["id"]
            rep["role"] = "race"
            rep["contract_years"] = 2
            rep["scouted"] = True
            pt["driver_ids"][idx] = rep["id"]
            silly_recap.append({
                "type": "PROMOTION",
                "headline": f"{rep['clean_name']} Promoted to {pt['name']} Seat #{idx + 1}",
                "detail": "Steps into the race seat on a 2-year deal for the new season.",
            })

    # 3. Dynamic AI Silly Season Transfers (2–4 rival moves + backfill vacated seats!)
    ai_teams = [t for t in state["teams"] if not t["is_player"]]
    rng.shuffle(ai_teams)
    moves_done = 0
    for t in ai_teams:
        # Backfill any seat vacated by retirement first
        while len(t["driver_ids"]) < 2:
            fas = [x for x in state["drivers"].values() if x["team_id"] is None and x["role"] == "free_agent"]
            fas.sort(key=lambda x: (-x["potential"], -x["overall"]))
            if not fas:
                break
            pick = fas[0]
            pick["team_id"] = t["id"]
            pick["role"] = "race"
            pick["contract_years"] = 2
            t["driver_ids"].append(pick["id"])
            silly_recap.append({
                "type": "ROOKIE CALL-UP",
                "headline": f"{t['name']} Signs {pick['clean_name']} (Age {pick['age']})",
                "detail": f"Promoted from the free-agent pool (POT {pick['potential']}).",
            })
            moves_done += 1

        # Occasional rival upgrade swap if driver contract expired!
        if moves_done < 4:
            exp_slot = next((i for i, did in enumerate(t["driver_ids"]) if did in state["drivers"] and state["drivers"][did]["contract_years"] <= 0), None)
            if exp_slot is not None:
                old_d = state["drivers"][t["driver_ids"][exp_slot]]
                fas = [x for x in state["drivers"].values() if x["team_id"] is None and x["role"] == "free_agent" and x["overall"] >= old_d["overall"] - 2]
                fas.sort(key=lambda x: -x["overall"])
                if fas:
                    new_d = fas[0]
                    old_d["team_id"] = None
                    old_d["role"] = "free_agent"
                    old_d["contract_years"] = 0
                    new_d["team_id"] = t["id"]
                    new_d["role"] = "race"
                    new_d["contract_years"] = 2
                    t["driver_ids"][exp_slot] = new_d["id"]
                    silly_recap.append({
                        "type": "TRANSFER",
                        "headline": f"Silly Season Shock: {new_d['clean_name']} Joins {t['name']}!",
                        "detail": f"Replaces {old_d['clean_name']} ahead of Season {state['season_num']}.",
                    })
                    moves_done += 1
                else:
                    old_d["contract_years"] = 2

    # Ensure all active race drivers have >= 1 year left
    for d in state["drivers"].values():
        if d["team_id"] is not None and d["contract_years"] <= 0:
            d["contract_years"] = 1

    for c in state["calendar"]:
        c["completed"] = False
        c["winner"] = None
        c["winner_team"] = None
        c["fastest_lap"] = None
        c["sprint_winner"] = None
        c["player_results"] = []

    state["last_silly_season"] = silly_recap
    recap_line = f"{len(silly_recap)} major driver market move(s) shook up the grid!" if silly_recap else "Grid lineups locked for the new regulations."
    _add_inbox(
        state,
        "NEW SEASON",
        f"Welcome to Season {state['season_num']} ({state['season_year']})!",
        f"New FIA technical regulations + Next-Gen Research applied! {recap_line}",
    )
    return {"state": state, "silly_season_recap": silly_recap}


def serialize_career_payload(
    state: dict[str, Any] | None,
    base_dir: Path | None = None,
    *,
    include_static: bool = True,
) -> dict[str, Any]:
    """Attach derived standings, facility costs, save slots, checkpoints, mid-race autosave & unified profile."""
    extra_meta: dict[str, Any] = {}
    if base_dir is not None:
        sid = (state or {}).get("_slot_id") or career_db.get_active_slot_id(base_dir)
        extra_meta = {
            "active_slot_id": sid,
            "slots": career_db.list_slots(base_dir),
            "checkpoints": career_db.list_checkpoints(base_dir, sid) if sid else [],
            "midrace": career_db.load_midrace_snapshot(base_dir, sid) if sid else None,
            "report_rounds": career_db.list_race_report_rounds(base_dir, sid) if sid else [],
            "profile": career_db.get_player_profile(base_dir),
        }

    if not state:
        out: dict[str, Any] = {"has_career": False, **extra_meta}
        if include_static:
            out.update({
                "facility_defs": FACILITY_DEFS,
                "rd_parts": RD_PARTS,
                "sponsor_catalog": SPONSOR_CATALOG,
                "staff_roles": STAFF_ROLES,
                "dev_focuses": DEV_FOCUSES,
                "circuits": CIRCUITS,
            })
        return out

    _ensure_career_v2(state)
    pt = get_player_team(state)
    # Compute live WDC & WCC tables
    wcc = sorted(state["teams"], key=lambda t: (-t["points"], -t["wins"], -t["car_overall"]))
    wdc = sorted(
        [d for d in state["drivers"].values() if d["team_id"] is not None and d["role"] == "race"],
        key=lambda d: (-d["season_pts"], -d["season_wins"], -d["overall"]),
    )

    fac_view = []
    for f in FACILITY_DEFS:
        lvl = int(pt["facilities"].get(f["id"], 1))
        fac_view.append({
            **f,
            "level": lvl,
            "max_level": 5,
            "next_cost_m": _facility_upgrade_cost(f["id"], lvl) if lvl < 5 else None,
            "upkeep_m": round(f["upkeep_per_lvl"] * lvl, 2),
        })

    payload: dict[str, Any] = {
        "has_career": True,
        "state": state,
        "player_team": pt,
        "wcc": [
            {
                "pos": i + 1,
                "id": t["id"],
                "name": t["name"],
                "color": t["color"],
                "is_player": t["is_player"],
                "points": t["points"],
                "wins": t["wins"],
                "podiums": t["podiums"],
                "car_overall": t["car_overall"],
                "rd": t["rd"],
            }
            for i, t in enumerate(wcc)
        ],
        "wdc": [
            {
                "pos": i + 1,
                "id": d["id"],
                "clean_name": d["clean_name"],
                "code3": d["code3"],
                "team_id": d["team_id"],
                "team_name": next((t["name"] for t in state["teams"] if t["id"] == d["team_id"]), ""),
                "color": next((t["color"] for t in state["teams"] if t["id"] == d["team_id"]), d.get("hero_color") or "#64748b"),
                "is_player": d["team_id"] == pt["id"],
                "points": d["season_pts"],
                "wins": d["season_wins"],
                "podiums": d["season_podiums"],
                "fl": d["season_fl"],
                "overall": d["overall"],
            }
            for i, d in enumerate(wdc)
        ],
        "facilities_view": fac_view,
        "scout_slots": _scout_slots_for_level(pt["facilities"].get("scouting_hub", 1)),
        "max_rd_slots": 2 if pt["facilities"].get("cfd_factory", 1) >= 3 else 1,
        "car_blueprints": CAR_BLUEPRINTS,
        "rd_parts": RD_PARTS,
        "pu_suppliers": __import__("f1data.career_extras", fromlist=["PU_SUPPLIERS"]).PU_SUPPLIERS,
        "max_player_penalty_pts": max((int(state["drivers"].get(did, {}).get("penalty_points") or 0) for did in pt.get("driver_ids") or []), default=0),
        **extra_meta,
    }
    if include_static:
        payload.update({
            "rd_parts": RD_PARTS,
            "car_blueprints": CAR_BLUEPRINTS,
            "sponsor_catalog": SPONSOR_CATALOG,
            "staff_roles": STAFF_ROLES,
            "dev_focuses": DEV_FOCUSES,
            "circuits": CIRCUITS,
        })
    return payload
