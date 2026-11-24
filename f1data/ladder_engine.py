"""
Pit Wall: The Ladder — Persistent 5-Tier Motorsport Management Simulation Engine.

Spans Karting -> Formula 4 -> Formula 3 -> Formula 2 -> Formula 1 with:
  - Strict Tier Progression & Unlock Matrix (mechanics, facilities, contracts, politics)
  - Living 5-Tier Concurrent World AI (all 5 championships simulate simultaneously)
  - Fog-of-War Driver Scouting, Traits & Relationship/Ego Matrix
  - Rolling 3-Year 40-Point FIA Super License Ledger
  - Dual-Ledger Cash + F1 Cost Cap Accounting (exempting driver salaries & top-3 staff)
  - F1 Car Philosophy Vectors + Wind-Tunnel-to-Track Correlation Variance
  - Gardening Leave Staff Poaching, F1 Academy Affiliate Deals & FIA Regulation Voting
  - Hybrid Career Fork (F2 -> F1): Path A (The Poach), Path B (The Constructor Bid), Path C (The Mercenary)
"""
from __future__ import annotations

import copy
import math
import random
import re
import sqlite3
from pathlib import Path
from typing import Any

from .circuits import CIRCUITS, get_circuit
from .feeders import FEEDER_ROSTER_SEED
from . import ladder_world_ai as _world_ai
from .rating_engine import compute_fair_attributes
from .weather_radar import build_weather_radar_and_pit_plan

_BASE_DIR = Path(__file__).resolve().parent.parent
_F1_SQLITE = _BASE_DIR / "data" / "f1.sqlite"

# =============================================================================
# 1. TIER PROGRESSION & UNLOCK MATRIX (Section 3 of Concept Document)
# =============================================================================

TIER_ORDER = ("karting", "f4", "f3", "f2", "f1")

TIER_CONFIG: dict[str, dict[str, Any]] = {
    "karting": {
        "id": "karting",
        "rank": 1,
        "name": "World Karting (OK / KZ)",
        "short": "KART",
        "color": "#22c55e",
        "machinery": "Open Chassis / 125cc Engine",
        "grid_size": 18,
        "rounds": 6,
        "race_laps": 12,
        "base_budget_k": 180.0,
        "entry_fee_k": 18.0,
        "prize_pool_k": 120.0,
        "repair_scale_k": 4.5,
        "promotion_rep": 28,
        "promotion_cash_k": 220.0,
        "points_table": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
        "sl_points": [],  # Karting awards 0 FIA Super License points
        "unlocks": {
            "live_radio": False,
            "pit_stops": False,
            "wet_pit_stops": False,
            "mandatory_pit": False,
            "practice_session": False,
            "wing_setup": False,
            "kart_tuning": True,
            "pre_race_coaching": True,
            "crash_damage_economy": False,
            "drs": False,
            "reverse_grid_sprint": False,
            "academy_affiliates": False,
            "prime_option_tyres": False,
            "pit_crew_drills": False,
            "driver_ego_trust": False,
            "ers_engine_modes": False,
            "team_orders": False,
            "custom_rd_correlation": False,
            "cost_cap": False,
            "fia_voting": False,
            "gardening_leave": False,
        },
        "facilities": [
            {"id": "garage_bays", "name": "2-Bay Kart Garage", "max_lv": 3, "base_cost_k": 45.0, "effect": "Improves chassis flex & engine prep (+2 Pace/lv)"},
            {"id": "race_trailer", "name": "Paddock Race Trailer", "max_lv": 3, "base_cost_k": 38.0, "effect": "Boosts sponsor income & scouting reach (+12% sponsor/lv)"},
        ],
        "circuits": ["monaco", "zandvoort", "imola", "hungaroring", "barcelona", "redbullring"],
        "headline": "Hands-on chassis flex, gear ratios, tyre pressure & slipstream — zero live radio, zero pit stops.",
    },
    "f4": {
        "id": "f4",
        "rank": 2,
        "name": "FIA Formula 4 Regional",
        "short": "F4",
        "color": "#eab308",
        "machinery": "Spec Tatuus F4-T421 (Identical Cars)",
        "grid_size": 22,
        "rounds": 7,
        "race_laps": 15,
        "base_budget_k": 650.0,
        "entry_fee_k": 95.0,
        "prize_pool_k": 480.0,
        "repair_scale_k": 28.0,
        "promotion_rep": 46,
        "promotion_cash_k": 900.0,
        "points_table": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
        "sl_points": [12, 10, 7, 5, 3, 2, 1],
        "unlocks": {
            "live_radio": True,
            "pit_stops": True,
            "wet_pit_stops": True,
            "mandatory_pit": False,
            "practice_session": True,
            "wing_setup": True,
            "kart_tuning": False,
            "pre_race_coaching": True,
            "crash_damage_economy": True,
            "drs": False,
            "reverse_grid_sprint": False,
            "academy_affiliates": False,
            "prime_option_tyres": False,
            "pit_crew_drills": False,
            "driver_ego_trust": False,
            "ers_engine_modes": False,
            "team_orders": False,
            "custom_rd_correlation": False,
            "cost_cap": False,
            "fia_voting": False,
            "gardening_leave": False,
        },
        "facilities": [
            {"id": "regional_workshop", "name": "Regional Workshop", "max_lv": 4, "base_cost_k": 140.0, "effect": "Cuts crash-damage repair bills (-12%/lv) & speeds spare builds"},
            {"id": "telemetry_rig", "name": "Basic Telemetry Rig", "max_lv": 4, "base_cost_k": 120.0, "effect": "Improves Practice wing-setup accuracy & wet strategy"},
        ],
        "circuits": ["imola", "monza", "barcelona", "redbullring", "spa", "silverstone", "zandvoort"],
        "headline": "Spec single-seaters, Practice wing setups, wet-weather pit calls & real crash-damage repair bills.",
    },
    "f3": {
        "id": "f3",
        "rank": 3,
        "name": "FIA Formula 3 Championship",
        "short": "F3",
        "color": "#f97316",
        "machinery": "Spec Dallara F3 (30-Car Grids)",
        "grid_size": 30,
        "rounds": 8,
        "race_laps": 18,
        "base_budget_k": 2400.0,
        "entry_fee_k": 420.0,
        "prize_pool_k": 1800.0,
        "repair_scale_k": 75.0,
        "promotion_rep": 64,
        "promotion_cash_k": 3200.0,
        "points_table": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
        "sl_points": [30, 25, 20, 15, 12, 10, 7, 5, 3, 2],
        "unlocks": {
            "live_radio": True,
            "pit_stops": True,
            "wet_pit_stops": True,
            "mandatory_pit": False,
            "practice_session": True,
            "wing_setup": True,
            "kart_tuning": False,
            "pre_race_coaching": False,
            "crash_damage_economy": True,
            "drs": True,
            "reverse_grid_sprint": True,
            "academy_affiliates": True,
            "prime_option_tyres": False,
            "pit_crew_drills": False,
            "driver_ego_trust": False,
            "ers_engine_modes": False,
            "team_orders": False,
            "custom_rd_correlation": False,
            "cost_cap": False,
            "fia_voting": False,
            "gardening_leave": False,
        },
        "facilities": [
            {"id": "dil_sim", "name": "Driver-in-the-Loop Sim", "max_lv": 4, "base_cost_k": 480.0, "effect": "Boosts qualifying traffic timing & driver skill growth"},
            {"id": "scouting_net", "name": "Junior Scouting Network", "max_lv": 4, "base_cost_k": 360.0, "effect": "Narrows Fog-of-War potential range & uncovers traits faster"},
            {"id": "regional_workshop", "name": "Carbon Repair Bay", "max_lv": 4, "base_cost_k": 320.0, "effect": "Cuts 30-car pack crash-damage costs (-10%/lv)"},
        ],
        "circuits": ["bahrain", "melbourne", "imola", "monaco", "barcelona", "silverstone", "spa", "monza"],
        "headline": "30-car chaos, DRS trains, Reverse-Grid Sprints, qualifying traffic & F1 Academy Affiliate KPI deals.",
    },
    "f2": {
        "id": "f2",
        "rank": 4,
        "name": "FIA Formula 2 Championship",
        "short": "F2",
        "color": "#38bdf8",
        "machinery": "Spec Dallara F2 2024 (620hp Turbo)",
        "grid_size": 22,
        "rounds": 10,
        "race_laps": 22,
        "base_budget_k": 6800.0,
        "entry_fee_k": 1100.0,
        "prize_pool_k": 5200.0,
        "repair_scale_k": 140.0,
        "promotion_rep": 78,
        "promotion_cash_k": 25000.0,
        "points_table": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
        "sl_points": [40, 40, 40, 30, 20, 10, 8, 6, 4, 3],
        "unlocks": {
            "live_radio": True,
            "pit_stops": True,
            "wet_pit_stops": True,
            "mandatory_pit": True,
            "practice_session": True,
            "wing_setup": True,
            "kart_tuning": False,
            "pre_race_coaching": False,
            "crash_damage_economy": True,
            "drs": True,
            "reverse_grid_sprint": True,
            "academy_affiliates": True,
            "prime_option_tyres": True,
            "pit_crew_drills": True,
            "driver_ego_trust": True,
            "ers_engine_modes": False,
            "team_orders": False,
            "custom_rd_correlation": False,
            "cost_cap": False,
            "fia_voting": False,
            "gardening_leave": False,
        },
        "facilities": [
            {"id": "pit_rig", "name": "Pit Stop Practice Rig", "max_lv": 5, "base_cost_k": 950.0, "effect": "Shaves pit stop time (-0.22s/lv) & cuts wheel-gun error risk"},
            {"id": "adv_sim", "name": "Advanced Motion Sim", "max_lv": 5, "base_cost_k": 1200.0, "effect": "Boosts Prime/Option tyre window mastery & racecraft"},
            {"id": "sports_science", "name": "Sports Science Lab", "max_lv": 5, "base_cost_k": 850.0, "effect": "Raises driver stamina, consistency & Ego/Trust stability"},
        ],
        "circuits": ["bahrain", "jeddah", "melbourne", "imola", "monaco", "barcelona", "silverstone", "spa", "monza", "abudhabi"],
        "headline": "Mandatory pit stops, Prime/Option tyre cliffs, pit-crew errors, Driver Ego & F1 Poaching Offers!",
    },
    "f1": {
        "id": "f1",
        "rank": 5,
        "name": "FIA Formula 1 World Championship",
        "short": "F1",
        "color": "#e10600",
        "machinery": "Bespoke Constructor (Aero + Hybrid PU)",
        "grid_size": 20,
        "rounds": 12,
        "race_laps": 28,
        "base_budget_k": 145000.0,
        "entry_fee_k": 12000.0,
        "prize_pool_k": 98000.0,
        "repair_scale_k": 680.0,
        "cost_cap_k": 135000.0,  # $135M FIA Cost Cap (exempts driver salaries + top-3 staff!)
        "promotion_rep": 100,
        "promotion_cash_k": 0.0,
        "points_table": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
        "sl_points": [],
        "unlocks": {
            "live_radio": True,
            "pit_stops": True,
            "wet_pit_stops": True,
            "mandatory_pit": True,
            "practice_session": True,
            "wing_setup": True,
            "kart_tuning": False,
            "pre_race_coaching": False,
            "crash_damage_economy": True,
            "drs": True,
            "reverse_grid_sprint": False,
            "academy_affiliates": False,
            "prime_option_tyres": True,
            "pit_crew_drills": True,
            "driver_ego_trust": True,
            "ers_engine_modes": True,
            "team_orders": True,
            "custom_rd_correlation": True,
            "cost_cap": True,
            "fia_voting": True,
            "gardening_leave": True,
        },
        "facilities": [
            {"id": "wind_tunnel", "name": "60% Scale Wind Tunnel", "max_lv": 5, "base_cost_k": 14000.0, "effect": "Narrows CFD-to-Track correlation variance & unlocks Aero gains"},
            {"id": "composite_factory", "name": "Composite Autoclave Factory", "max_lv": 5, "base_cost_k": 12500.0, "effect": "Lowers upgrade manufacture cost & crash-damage lead time"},
            {"id": "factory_campus", "name": "F1 Operations Campus", "max_lv": 5, "base_cost_k": 16000.0, "effect": "Boosts sponsor value, pit crew speed & top-staff attraction"},
            {"id": "pit_rig", "name": "Robotic Pit Stop Gantry", "max_lv": 5, "base_cost_k": 7500.0, "effect": "Delivers sub-2.2s stops & cuts unsafe-release errors"},
        ],
        "circuits": ["bahrain", "melbourne", "suzuka", "imola", "monaco", "montreal", "silverstone", "spa", "monza", "singapore", "interlagos", "abudhabi"],
        "headline": "Aerospace R&D correlation, Dual-Ledger Cost Cap, ERS, Team Orders, Gardening Leave & FIA Politics.",
    },
}

DRIVER_TRAITS = [
    "Wet Weather Specialist",
    "Fragile Confidence",
    "Tire Whisperer",
    "Late Braker",
    "Sponsor Magnet",
    "Quali Rocket",
    "Iron Nerve",
    "Crash-Prone Charger",
    "Smooth Operator",
    "Street Fighter",
]

KARTING_TEAMS = [
    ("Tony Kart Racing", "#16a34a"), ("Birel ART", "#dc2626"), ("KR Motorsport", "#2563eb"),
    ("Sodi Racing", "#f97316"), ("CRG Factory", "#111827"), ("Parolin Motorsport", "#eab308"),
    ("Energy Corse", "#0ea5e9"), ("Forza Racing", "#a855f7"),
]
F4_TEAMS = [
    ("PREMA F4", "#dc2626"), ("Van Amersfoort F4", "#f97316"), ("US Racing", "#1d4ed8"),
    ("Campos F4", "#eab308"), ("MP Motorsport F4", "#ef4444"), ("PHM AIX F4", "#64748b"),
    ("Rodin Carlin F4", "#0f172a"), ("Hitech Pulse F4", "#94a3b8"), ("R-ace GP", "#38bdf8"), ("AKM Motorsport", "#10b981"),
]
F3_TEAMS = [
    ("Trident F3", "#2563eb"), ("PREMA F3", "#dc2626"), ("ART Grand Prix F3", "#94a3b8"),
    ("MP Motorsport F3", "#f97316"), ("Campos Racing F3", "#eab308"), ("Hitech TGR F3", "#1e293b"),
    ("Rodin Motorsport F3", "#111827"), ("Van Amersfoort F3", "#ea580c"), ("DAMS F3", "#38bdf8"), ("AIX Racing F3", "#16a34a"),
]
F2_TEAMS = [
    ("Invicta Racing", "#eab308"), ("PREMA Racing", "#dc2626"), ("ART Grand Prix", "#cbd5e1"),
    ("Hitech TGR", "#334155"), ("Campos Racing", "#f59e0b"), ("MP Motorsport", "#f97316"),
    ("Rodin Motorsport", "#111827"), ("DAMS Lucas Oil", "#0284c7"), ("Trident", "#1d4ed8"), ("AIX Racing", "#22c55e"),
]
F1_TEAMS = [
    ("McLaren", "#ff8000", "Mercedes", 89, "Andrea Stella"),
    ("Ferrari", "#dc0000", "Ferrari", 88, "Frederic Vasseur"),
    ("Red Bull Racing", "#1e3a8a", "Red Bull Ford", 88, "Laurent Mekies"),
    ("Mercedes", "#27f4d2", "Mercedes", 87, "Toto Wolff"),
    ("Aston Martin", "#006f62", "Honda", 83, "Andy Cowell"),
    ("Williams", "#005aff", "Mercedes", 81, "James Vowles"),
    ("Alpine", "#0090ff", "Mercedes", 79, "Flavio Briatore"),
    ("Haas", "#b6babd", "Ferrari", 78, "Ayao Komatsu"),
    ("Racing Bulls", "#6692ff", "Red Bull Ford", 79, "Alan Permane"),
    ("Audi", "#f50537", "Audi", 77, "Jonathan Wheatley"),
]

ACADEMY_OFFERS = [
    {"id": "acad_ferrari", "f1_team": "Ferrari Driver Academy", "color": "#dc0000", "funding_k": 620.0, "kpi_min_pos": 5, "penalty_k": 220.0, "junior_name": "Marco Bellini", "junior_nat": "ITA", "junior_ovr": 71, "junior_pot": 90},
    {"id": "acad_redbull", "f1_team": "Red Bull Junior Team", "color": "#1e3a8a", "funding_k": 740.0, "kpi_min_pos": 3, "penalty_k": 320.0, "junior_name": "Lukas Lindner", "junior_nat": "AUT", "junior_ovr": 73, "junior_pot": 92},
    {"id": "acad_mclaren", "f1_team": "McLaren Driver Development", "color": "#ff8000", "funding_k": 560.0, "kpi_min_pos": 6, "penalty_k": 180.0, "junior_name": "Callum Brooks", "junior_nat": "GBR", "junior_ovr": 70, "junior_pot": 89},
    {"id": "acad_mercedes", "f1_team": "Mercedes Junior Programme", "color": "#27f4d2", "funding_k": 650.0, "kpi_min_pos": 4, "penalty_k": 240.0, "junior_name": "Emil Lindholm", "junior_nat": "FIN", "junior_ovr": 72, "junior_pot": 91},
    {"id": "acad_williams", "f1_team": "Williams Racing Academy", "color": "#005aff", "funding_k": 440.0, "kpi_min_pos": 8, "penalty_k": 120.0, "junior_name": "Theo Gallagher", "junior_nat": "IRL", "junior_ovr": 68, "junior_pot": 86},
]

FIRST_NAMES = [
    "Luca", "Mateo", "Oliver", "Noah", "Liam", "Enzo", "Kaito", "Hugo", "Oscar", "Theo",
    "Soren", "Emil", "Carlos", "Maxime", "Rory", "Aiden", "Nico", "Matteo", "Jules", "Diego",
    "Viktor", "Arjun", "Zane", "Lando", "Caleb", "Milo", "Rafael", "Seb", "Toby", "Felix",
]
LAST_NAMES = [
    "Moretti", "Keller", "Sato", "Delgado", "Bianchi", "Lindqvist", "O'Connor", "Dupont",
    "Vermeer", "Novak", "Richter", "Alvarez", "Mercer", "Haddad", "Tanaka", "Varga",
    "Fontana", "Sorensen", "Kowalski", "Pinto", "Rossi", "Jensen", "Silva", "Mancini",
    "Bauer", "Vidal", "Halvorsen", "Costa", "Nolan", "Ferraro",
]
NATS = ["GBR", "ITA", "FRA", "NED", "ESP", "GER", "BRA", "USA", "JPN", "AUS", "FIN", "IRL", "DEN", "AUT", "MEX"]

F1_PROPOSALS = [
    {
        "id": "prop_aero_reset",
        "title": "2028 Ground-Effect Floor Narrowing (-12% Downforce)",
        "category": "Aero",
        "desc": "Cuts low-speed downforce across the grid while rewarding low-drag aero concepts.",
        "impact": {"low_speed_df": -4, "drag": +3},
        "beneficiary_vec": "high_speed_eff",
    },
    {
        "id": "prop_cost_cap_cut",
        "title": "Tighten FIA Cost Cap by $10M ($125M Limit)",
        "category": "Finance",
        "desc": "Squeezes heavyweight factory teams while helping lean independent constructors.",
        "impact": {"cost_cap_delta_k": -10000.0},
        "beneficiary_vec": "cooling",
    },
    {
        "id": "prop_tyre_thermal",
        "title": "High-Degradation Pirelli Thermal Compounds",
        "category": "Tyres",
        "desc": "Enforces two-stop races and magnifies Tire Preservation car philosophy.",
        "impact": {"tyre_pres": +4},
        "beneficiary_vec": "tyre_pres",
    },
    {
        "id": "prop_sprint_reverse",
        "title": "Reverse Top-8 Sprint Grid Format",
        "category": "Sporting",
        "desc": "Increases overtaking value and rewards aggressive midfield constructors.",
        "impact": {"overtake_boost": 1},
        "beneficiary_vec": "low_speed_df",
    },
    {
        "id": "prop_pu_freeze",
        "title": "Extend Power Unit Freeze + Expand ERS Harvest (+15%)",
        "category": "Power Unit",
        "desc": "Freezes ICE development and places greater strategic weight on ERS deployment.",
        "impact": {"high_speed_eff": +3},
        "beneficiary_vec": "high_speed_eff",
    },
]


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def _apply_junior_fog_of_war(drv: dict[str, Any], rng: random.Random) -> dict[str, Any]:
    """Lightweight Fog-of-War wrapper for junior tiers (Karting–F3) hiding true potential & traits until scouted."""
    pot = int(drv.get("potential") or drv.get("overall") or 75)
    ovr = int(drv.get("overall") or 65)
    drv["potential_ceiling"] = pot
    if drv.get("scouted"):
        drv["pot_lo"] = pot
        drv["pot_hi"] = pot
        drv["trait_revealed"] = True
        return drv
    err = rng.randint(5, 11)
    drv["pot_lo"] = int(_clamp(pot - err, ovr, 99))
    drv["pot_hi"] = int(_clamp(pot + rng.randint(4, 10), pot, 99))
    drv["trait_revealed"] = False
    return drv


def _load_real_f1_grid_seeds() -> list[dict[str, Any]]:
    """Load real modern F1 grid drivers from f1.sqlite and hydrate all 8 calibrated attributes via rating_engine."""
    rows_out: list[dict[str, Any]] = []
    if _F1_SQLITE.exists():
        try:
            con = sqlite3.connect(str(_F1_SQLITE))
            con.row_factory = sqlite3.Row
            # Pick most recent complete/active season with >= 18 drivers
            yr_row = con.execute(
                "SELECT year FROM drivers_standings GROUP BY year HAVING COUNT(*) >= 18 ORDER BY year DESC LIMIT 1"
            ).fetchone()
            target_year = int(yr_row["year"]) if yr_row else 2025
            standings = con.execute(
                "SELECT driver, nationality, team, points, position FROM drivers_standings WHERE year=? ORDER BY position ASC",
                (target_year,),
            ).fetchall()
            # Aggregate career totals from f1.sqlite for fair_overall card context
            totals_map: dict[str, dict[str, Any]] = {}
            for tr in con.execute(
                """
                SELECT driver,
                       COUNT(DISTINCT year) AS seasons,
                       SUM(CASE WHEN position = 1 THEN 1 ELSE 0 END) AS titles
                FROM drivers_standings GROUP BY driver
                """
            ).fetchall():
                totals_map[str(tr["driver"])] = {"seasons": int(tr["seasons"] or 1), "titles": int(tr["titles"] or 0)}
            win_map: dict[str, int] = {}
            for wr in con.execute("SELECT winner, COUNT(*) AS w FROM races GROUP BY winner").fetchall():
                if wr["winner"]:
                    win_map[str(wr["winner"])] = int(wr["w"] or 0)
            con.close()

            seen_clean: set[str] = set()
            for r in standings:
                raw_drv = str(r["driver"] or "").strip()
                clean = re.sub(r"\s+[A-Z]{2,3}$", "", raw_drv).strip()
                if not clean or clean in seen_clean:
                    continue
                seen_clean.add(clean)
                tm_raw = str(r["team"] or "Independent").strip()
                nat = str(r["nationality"] or "F1").strip()[:3].upper()
                tinfo = totals_map.get(raw_drv, {"seasons": 3, "titles": 0})
                wins = win_map.get(raw_drv, win_map.get(clean, 0))
                starts_est = max(18, tinfo["seasons"] * 20)
                card_ctx = {
                    "driver": raw_drv,
                    "clean_name": clean,
                    "wins": wins,
                    "podiums": max(wins, int(wins * 2.1)),
                    "starts": starts_est,
                    "fastest_laps": max(0, wins // 2),
                    "championships": tinfo["titles"],
                    "win_rate": round((wins / max(1, starts_est)) * 100.0, 2),
                    "podium_rate": round((max(wins, int(wins * 2.1)) / max(1, starts_est)) * 100.0, 2),
                    "overall": 78.0 + max(0, 14 - int(r["position"] or 15)),
                    "hero_team": tm_raw,
                }
                fair = compute_fair_attributes(card_ctx, year=None)
                age_est = int(_clamp(18 + tinfo["seasons"] * 1.45, 19, 44))
                ovr = int(round(fair["fair_overall"]))
                pot = int(_clamp(ovr + max(0, (27 - age_est)), ovr, 99))
                rows_out.append({
                    "name": clean,
                    "nationality": nat,
                    "team": tm_raw,
                    "age": age_est,
                    "overall": ovr,
                    "potential": pot,
                    "fair": fair,
                })
                if len(rows_out) >= 24:
                    break
        except Exception:
            rows_out = []

    return rows_out


def _make_driver(
    rng: random.Random,
    did: str,
    name: str,
    nat: str,
    tier: str,
    team_name: str,
    age: int,
    ovr: int,
    pot: int,
    *,
    trait: str | None = None,
    sl_history: list[int] | None = None,
    pay_driver_k: float = 0.0,
    scouted: bool = False,
    academy: str = "Independent",
    calibrated_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    tr = trait or rng.choice(DRIVER_TRAITS)
    if calibrated_profile and isinstance(calibrated_profile.get("stats"), dict):
        cs = calibrated_profile["stats"]
        pace = int(cs.get("pace", ovr))
        racecraft = int(cs.get("racecraft", ovr))
        reliability = int(cs.get("reliability", ovr))
        duels = int(cs.get("duels", ovr))
        clutch = int(cs.get("clutch", ovr))
        wet = int(cs.get("wet", ovr))
        tyre_care = int(cs.get("tyre_care", ovr))
        discipline = int(cs.get("discipline", reliability))
        dnf_rate = float(cs.get("dnf_rate", 7.5))
        consistency = reliability
        ovr = int(round(float(calibrated_profile.get("fair_overall") or ovr)))
        pot = max(ovr, pot)
    else:
        pace = int(_clamp(ovr + rng.randint(-4, 5), 42, 99))
        racecraft = int(_clamp(ovr + rng.randint(-4, 5), 42, 99))
        tyre_care = int(_clamp(ovr + (7 if tr == "Tire Whisperer" else rng.randint(-5, 4)), 40, 99))
        wet = int(_clamp(ovr + (9 if tr == "Wet Weather Specialist" else rng.randint(-6, 5)), 40, 99))
        consistency = int(_clamp(ovr + (-8 if tr == "Crash-Prone Charger" else rng.randint(-4, 5)), 40, 99))
        reliability = consistency
        duels = int(_clamp(round((racecraft + pace) * 0.5 + rng.randint(-3, 3)), 40, 99))
        clutch = int(_clamp(ovr + rng.randint(-4, 5), 40, 99))
        discipline = consistency
        dnf_rate = round(_clamp(14.5 - (consistency - 50) * 0.22, 2.5, 18.0), 1)

    ego = int(_clamp(35 + (ovr - 55) * 1.1 + rng.randint(-12, 18), 20, 95))
    trust = int(_clamp(65 + rng.randint(-8, 12), 40, 90))
    sl_hist = list(sl_history or [0, 0, 0])[-3:]
    while len(sl_hist) < 3:
        sl_hist.insert(0, 0)
    sl_total = sum(sl_hist)

    base_sal = {
        "karting": 8.0,
        "f4": 32.0,
        "f3": 110.0,
        "f2": 320.0,
        "f1": 2800.0,
    }.get(tier, 50.0)
    salary_k = round(max(0.0, base_sal * (0.65 + max(0, ovr - 52) * 0.045) - pay_driver_k * 0.4), 1)
    code3 = "".join(ch for ch in name.split()[-1].upper() if ch.isalpha())[:3] or "DRV"

    drv = {
        "id": did,
        "name": name,
        "code3": code3,
        "nationality": nat,
        "tier": tier,
        "team": team_name,
        "age": age,
        "overall": ovr,
        "potential": pot,
        "potential_ceiling": pot,
        "pot_lo": pot,
        "pot_hi": pot,
        "trait": tr,
        "trait_revealed": scouted,
        "scouted": scouted,
        "academy": academy,
        "pay_driver_k": round(pay_driver_k, 1),
        "salary_k": salary_k,
        "stats": {
            "pace": pace,
            "racecraft": racecraft,
            "reliability": reliability,
            "consistency": consistency,
            "duels": duels,
            "clutch": clutch,
            "wet": wet,
            "tyre_care": tyre_care,
            "discipline": discipline,
            "dnf_rate": dnf_rate,
        },
        "rating_source": (calibrated_profile.get("telemetry", {}).get("source", "F1DB + FIA Docs") if calibrated_profile else "Ladder Procedural"),
        "driver_skill": float(calibrated_profile.get("driver_skill", ovr)) if calibrated_profile else float(ovr),
        "car_strength_est": float(calibrated_profile.get("car_strength_est", ovr)) if calibrated_profile else float(ovr),
        "telemetry": dict(calibrated_profile.get("telemetry") or {}) if calibrated_profile else {},
        "ego": ego,
        "trust": trust,
        "engineer_trust": int(_clamp(trust + rng.randint(-6, 8), 35, 95)),
        "morale": 74,
        "sl_history": sl_hist,  # Rolling 3-year Super License points [y-2, y-1, current]
        "sl_points": sl_total,
        "sl_eligible": sl_total >= 40,
        "season_pts": 0.0,
        "season_wins": 0,
        "season_podiums": 0,
        "season_dnfs": 0,
    }
    if tier in ("karting", "f4", "f3") or not scouted:
        _apply_junior_fog_of_war(drv, rng)
    return drv


def _build_5tier_world(
    rng: random.Random,
    player_tier: str,
    player_team_name: str,
    player_color: str,
    principal_name: str,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], list[str]]:
    """Build all 5 living concurrent championships (Karting -> F1) + full driver & team registries."""
    tiers_state: dict[str, dict[str, Any]] = {}
    drivers: dict[str, dict[str, Any]] = {}
    used_names: set[str] = set()
    player_driver_ids: list[str] = []

    def next_name() -> tuple[str, str]:
        for _ in range(80):
            nm = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
            if nm not in used_names:
                used_names.add(nm)
                return nm, rng.choice(NATS)
        nm = f"Alex Driver {len(used_names) + 1}"
        used_names.add(nm)
        return nm, "GBR"

    # Seed authentic real-world F2/F3/F1A juniors from feeders.py!
    feeder_by_tier: dict[str, list[tuple[Any, ...]]] = {"f2": [], "f3": [], "f4": []}
    for row in FEEDER_ROSTER_SEED:
        ser = row[4]
        if ser == "f2":
            feeder_by_tier["f2"].append(row)
        elif ser == "f3":
            feeder_by_tier["f3"].append(row)
        elif ser == "f1_academy":
            feeder_by_tier["f4"].append(row)

    # Real F1 grid drivers hydrated from f1.sqlite + f1db.sqlite + fia_docs.sqlite via rating_engine!
    f1_real_seeds = _load_real_f1_grid_seeds()
    # Team-matched lookup so real drivers land on their authentic F1 constructors where possible
    f1_assigned_names: set[str] = set()

    def _pop_f1_seed_for_team(team_name: str) -> dict[str, Any] | None:
        tlow = team_name.lower().split()[0]
        for s in f1_real_seeds:
            if s["name"] not in f1_assigned_names and tlow in s["team"].lower():
                f1_assigned_names.add(s["name"])
                return s
        for s in f1_real_seeds:
            if s["name"] not in f1_assigned_names:
                f1_assigned_names.add(s["name"])
                return s
        return None

    tier_team_specs: dict[str, list[dict[str, Any]]] = {
        "karting": [{"name": n, "color": c, "principal": f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}", "car_rating": rng.randint(52, 62)} for n, c in KARTING_TEAMS],
        "f4": [{"name": n, "color": c, "principal": f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}", "car_rating": 64} for n, c in F4_TEAMS],
        "f3": [{"name": n, "color": c, "principal": f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}", "car_rating": 70} for n, c in F3_TEAMS],
        "f2": [{"name": n, "color": c, "principal": f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}", "car_rating": 76} for n, c in F2_TEAMS],
        "f1": [{"name": n, "color": c, "engine": eng, "car_rating": cr, "principal": tp} for n, c, eng, cr, tp in F1_TEAMS],
    }

    for tid in TIER_ORDER:
        tcfg = TIER_CONFIG[tid]
        tlist = copy.deepcopy(tier_team_specs[tid])
        is_player_tier = tid == player_tier
        if is_player_tier:
            # Replace last AI team with the player's team!
            player_entry = {
                "name": player_team_name,
                "color": player_color,
                "principal": principal_name,
                "car_rating": 56 if tid == "karting" else (64 if tid == "f4" else (70 if tid == "f3" else (76 if tid == "f2" else 76))),
                "engine": "Ferrari" if tid == "f1" else tcfg["machinery"],
                "is_player": True,
                "points": 0.0,
                "driver_ids": [],
            }
            tlist[-1] = player_entry

        teams_built = []
        feeder_pool = list(feeder_by_tier.get(tid, []))
        for idx, tspec in enumerate(tlist):
            t_obj = {
                "id": f"{tid}_t{idx}",
                "name": tspec["name"],
                "color": tspec["color"],
                "principal": tspec.get("principal", "AI Principal"),
                "engine": tspec.get("engine", tcfg["machinery"]),
                "car_rating": float(tspec.get("car_rating", 70)),
                "is_player": bool(tspec.get("is_player")),
                "points": 0.0,
                "driver_ids": [],
            }
            seats = 3 if (tid == "f3" and not t_obj["is_player"]) else 2
            for s_i in range(seats):
                did = f"{tid}_d_{idx}_{s_i}"
                f1_seed = _pop_f1_seed_for_team(t_obj["name"]) if (tid == "f1" and not t_obj["is_player"]) else None
                if f1_seed is not None:
                    nm = f1_seed["name"]
                    used_names.add(nm)
                    f_stats = f1_seed["fair"]["stats"]
                    inferred_tr = (
                        "Wet Weather Specialist" if f_stats.get("wet", 0) >= 90
                        else ("Tire Whisperer" if f_stats.get("tyre_care", 0) >= 88
                        else ("Quali Rocket" if f_stats.get("pace", 0) >= 88 else "Smooth Operator"))
                    )
                    drv = _make_driver(
                        rng, did, nm, f1_seed["nationality"], tid, t_obj["name"],
                        f1_seed["age"], f1_seed["overall"], f1_seed["potential"],
                        trait=inferred_tr, sl_history=[20, 20, 0], scouted=True,
                        calibrated_profile=f1_seed["fair"],
                    )
                elif feeder_pool and not t_obj["is_player"]:
                    row = feeder_pool.pop(0)
                    _, nm, _, nat, _, _, age, ovr, pot, sl_pts, acad, tr = row
                    used_names.add(nm)
                    if tid == "f4":
                        ovr = int(_clamp(ovr - 8, 54, 72))
                    drv = _make_driver(
                        rng, did, nm, nat, tid, t_obj["name"], age, ovr, pot,
                        trait=tr if tr in DRIVER_TRAITS else None,
                        sl_history=[sl_pts // 2, sl_pts - sl_pts // 2, 0],
                        scouted=(tid == "f1"),
                        academy=acad,
                    )
                else:
                    nm, nat = next_name()
                    if tid == "karting":
                        age = rng.randint(13, 16)
                        ovr = rng.randint(50, 62)
                        pot = rng.randint(66, 94)
                        pay_k = rng.choice([0.0, 22.0, 38.0]) if (t_obj["is_player"] and s_i == 1) else rng.choice([0.0, 15.0])
                        sl_h = [0, 0, 0]
                    elif tid == "f4":
                        age = rng.randint(15, 18)
                        ovr = rng.randint(57, 68)
                        pot = rng.randint(70, 93)
                        pay_k = rng.choice([0.0, 120.0, 180.0]) if (t_obj["is_player"] and s_i == 1) else 0.0
                        sl_h = [0, rng.randint(0, 5), 0]
                    elif tid == "f3":
                        age = rng.randint(17, 20)
                        ovr = rng.randint(65, 75)
                        pot = rng.randint(76, 94)
                        pay_k = 240.0 if (t_obj["is_player"] and s_i == 1) else 0.0
                        sl_h = [rng.randint(2, 10), rng.randint(4, 12), 0]
                    elif tid == "f2":
                        age = rng.randint(19, 23)
                        ovr = rng.randint(72, 81)
                        pot = rng.randint(80, 94)
                        pay_k = 450.0 if (t_obj["is_player"] and s_i == 1) else 0.0
                        sl_h = [rng.randint(8, 18), rng.randint(10, 22), 0]
                    else:
                        age = rng.randint(21, 29)
                        ovr = rng.randint(77, 86)
                        pot = rng.randint(84, 94)
                        pay_k = 0.0
                        sl_h = [20, 20, 0]
                    drv = _make_driver(
                        rng, did, nm, nat, tid, t_obj["name"], age, ovr, pot,
                        sl_history=sl_h,
                        pay_driver_k=pay_k,
                        scouted=bool(t_obj["is_player"]),
                    )
                drivers[did] = drv
                t_obj["driver_ids"].append(did)
                if t_obj["is_player"]:
                    player_driver_ids.append(did)
            teams_built.append(t_obj)

        # Build circuit calendar for this tier
        cal = []
        for r_i, cid in enumerate(tcfg["circuits"][: tcfg["rounds"]], start=1):
            cir = get_circuit(cid) or CIRCUITS[0]
            cal.append({
                "round": r_i,
                "circuit_id": cir["id"],
                "circuit_name": cir["name"],
                "country": cir.get("country", ""),
                "laps": tcfg["race_laps"],
                "weather_forecast": rng.choices(["dry", "dry", "dry", "showers", "rain"], weights=[55, 15, 10, 14, 6])[0],
                "completed": False,
                "winner": None,
            })

        tiers_state[tid] = {
            "id": tid,
            "name": tcfg["name"],
            "short": tcfg["short"],
            "color": tcfg["color"],
            "teams": teams_built,
            "calendar": cal,
            "round": 1,
        }

    # Build a Scoutable Market Pool of 14 uncontracted junior & senior talents (Fog-of-War masked!)
    for m_i in range(14):
        nm, nat = next_name()
        m_tier = rng.choice(["karting", "f4", "f3", "f2", "f1"])
        age_map = {"karting": (13, 15), "f4": (15, 18), "f3": (17, 20), "f2": (19, 23), "f1": (22, 31)}
        ovr_map = {"karting": (52, 64), "f4": (60, 70), "f3": (68, 76), "f2": (74, 82), "f1": (79, 88)}
        lo_a, hi_a = age_map[m_tier]
        lo_o, hi_o = ovr_map[m_tier]
        ovr = rng.randint(lo_o, hi_o)
        pot = int(_clamp(ovr + rng.randint(6, 22), ovr, 97))
        pay_k = rng.choice([0.0, 0.0, 80.0, 220.0]) if m_tier in ("karting", "f4", "f3", "f2") else 0.0
        sl_h = [20, 20, 0] if m_tier == "f1" else ([15, 15, 0] if m_tier == "f2" else [5, 8, 0])
        did = f"mkt_{m_i}"
        drivers[did] = _make_driver(
            rng, did, nm, nat, m_tier, "Free Agent",
            rng.randint(lo_a, hi_a), ovr, pot,
            sl_history=sl_h, pay_driver_k=pay_k, scouted=False,
        )

    return tiers_state, drivers, player_driver_ids


def build_new_ladder(
    *,
    team_name: str = "Apex Motorsport",
    principal_name: str = "Alex Vance",
    start_tier: str = "karting",
    color: str = "#e10600",
    seed: int | None = None,
) -> dict[str, Any]:
    """Create a fresh persistent Pit Wall: The Ladder career state."""
    tier = start_tier if start_tier in TIER_CONFIG else "karting"
    rng = random.Random(seed if seed is not None else random.randint(1000, 999999))
    tcfg = TIER_CONFIG[tier]

    tiers_state, drivers, player_driver_ids = _build_5tier_world(
        rng, tier, team_name.strip() or "Apex Motorsport", color, principal_name.strip() or "Team Principal"
    )

    facilities = {f["id"]: 1 for f in tcfg["facilities"]}
    # Starting staff depends on tier
    staff = [
        {
            "id": "st_re1",
            "role": "Lead Race Engineer",
            "name": f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}",
            "rating": 58 + tcfg["rank"] * 6,
            "salary_k": round(18.0 * (2.6 ** (tcfg["rank"] - 1)), 1),
            "exempt_top3": True,
            "gardening_rounds_left": 0,
            "former_team": None,
        },
        {
            "id": "st_td1",
            "role": "Chief Mechanic" if tier in ("karting", "f4") else "Technical Director",
            "name": f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}",
            "rating": 56 + tcfg["rank"] * 6,
            "salary_k": round(22.0 * (2.8 ** (tcfg["rank"] - 1)), 1),
            "exempt_top3": True,
            "gardening_rounds_left": 0,
            "former_team": None,
        },
    ]

    # Poachable rival senior staff pool (for Gardening Leave & Poaching!)
    staff_market = [
        {"id": "mkt_st_1", "role": "Head of Aerodynamics", "name": "Dr. Elena Conti", "from_team": "Ferrari", "rating": 90, "salary_k": 3200.0, "buyout_k": 2400.0, "gardening_rounds": 3, "tier_min": "f1"},
        {"id": "mkt_st_2", "role": "Chief Race Strategist", "name": "Hannah Lindstrom", "from_team": "Red Bull Racing", "rating": 92, "salary_k": 2800.0, "buyout_k": 2100.0, "gardening_rounds": 2, "tier_min": "f1"},
        {"id": "mkt_st_3", "role": "Lead Race Engineer", "name": "Marcus Thorne", "from_team": "PREMA Racing", "rating": 82, "salary_k": 280.0, "buyout_k": 180.0, "gardening_rounds": 1, "tier_min": "f3"},
        {"id": "mkt_st_4", "role": "Technical Director", "name": "Kenji Takahashi", "from_team": "McLaren", "rating": 91, "salary_k": 3500.0, "buyout_k": 2800.0, "gardening_rounds": 3, "tier_min": "f1"},
        {"id": "mkt_st_5", "role": "Lead Race Engineer", "name": "Liam Gallagher", "from_team": "Van Amersfoort F4", "rating": 71, "salary_k": 65.0, "buyout_k": 40.0, "gardening_rounds": 0, "tier_min": "f4"},
    ]

    # F1 Car Philosophy Vectors + Wind-Tunnel Correlation Risk
    philosophy = {
        "low_speed_df": 72.0,
        "high_speed_eff": 72.0,
        "drag": 72.0,
        "tyre_pres": 72.0,
        "cooling": 72.0,
    }

    state: dict[str, Any] = {
        "season": 1,
        "year": 2026,
        "tier": tier,
        "round": 1,
        "rng_seed": rng.randint(1, 999999),
        "player": {
            "team_name": team_name.strip() or "Apex Motorsport",
            "original_feeder_team": team_name.strip() or "Apex Motorsport",
            "principal_name": principal_name.strip() or "Team Principal",
            "color": color,
            "reputation": float(12 + (tcfg["rank"] - 1) * 18),
            "career_path": "owner_ladder",  # owner_ladder | poached_tp | constructor_bid | mercenary
            "owns_team": True,
            "driver_ids": player_driver_ids,
            "poach_offers": [],
            "fork_ready": False,
        },
        "facilities": facilities,
        "staff": staff,
        "staff_market": staff_market,
        "academy_deal": None,
        "academy_offers": copy.deepcopy(ACADEMY_OFFERS),
        "economy": {
            "cash_k": float(tcfg["base_budget_k"]),
            "sponsor_per_round_k": round(tcfg["base_budget_k"] * 0.14, 1),
            "cost_cap_limit_k": float(TIER_CONFIG["f1"]["cost_cap_k"]),
            "cost_cap_spent_k": 0.0,
            "exempt_spent_k": 0.0,
            "repair_bills_ytd_k": 0.0,
            "ledger": [
                {"round": 0, "label": f"Opening {tcfg['short']} Season Budget", "delta_k": float(tcfg["base_budget_k"]), "cap_counts": False},
            ],
        },
        "rd": {
            "philosophy": philosophy,
            "cfd_hours": 100,
            "wind_tunnel_runs": 40,
            "correlation_accuracy": 74.0,  # % — rises with Wind Tunnel upgrades!
            "pending_upgrades": [],
            "upgrade_log": [],
        },
        "weekend": _fresh_weekend_state(tier, tiers_state[tier]["calendar"][0]),
        "fia_governance": {
            "active_proposal": copy.deepcopy(rng.choice(F1_PROPOSALS)),
            "voted": False,
            "passed_rules": [],
        },
        "tiers": tiers_state,
        "drivers": drivers,
        "inbox": [
            {
                "id": "msg_welcome",
                "round": 1,
                "sender": "Paddock Briefing",
                "tag": tcfg["short"],
                "title": f"Welcome to {tcfg['name']}!",
                "body": f"{tcfg['headline']} Manage setup, cash flow, scouting, and race-day strategy to climb the 5-tier motorsport ladder.",
                "read": False,
            }
        ],
        "silly_season_log": [],
        "season_history": [],
    }
    return state


def _fresh_weekend_state(tier: str, cal_round: dict[str, Any]) -> dict[str, Any]:
    cir = get_circuit(cal_round["circuit_id"]) or CIRCUITS[0]
    radar = build_weather_radar_and_pit_plan(
        cir, mode=cal_round.get("weather_forecast", "dry"), laps=cal_round["laps"], intel_pct=65, tyre_care=75
    )
    return {
        "round": cal_round["round"],
        "circuit_id": cal_round["circuit_id"],
        "circuit_name": cal_round["circuit_name"],
        "country": cal_round.get("country", ""),
        "laps": cal_round["laps"],
        "phase": "prep",  # prep -> practice -> quali -> race -> debrief
        "setup": {
            # Karting controls
            "chassis_flex": 50,
            "gear_ratio": 50,
            "tyre_pressure": 50,
            "coaching": "balanced",  # balanced | slipstream | smooth | aggressive
            # F4+ controls
            "front_wing": 50,
            "rear_wing": 50,
            "ride_height": 50,
            "tyre_alloc": "balanced",  # soft_heavy | balanced | hard_heavy
        },
        "setup_confidence": 55.0,
        "practice_done": False,
        "quali_done": False,
        "quali_tactic": "clean_air",  # clean_air | late_evolution | tow_gamble
        "quali_grid": [],
        "sprint_result": None,
        "weather_mode": cal_round.get("weather_forecast", "dry"),
        "weather_radar": radar,
        "last_race_debrief": None,
    }


def _add_inbox(state: dict[str, Any], sender: str, tag: str, title: str, body: str) -> None:
    state.setdefault("inbox", []).insert(0, {
        "id": f"m_{state['season']}_{state['round']}_{len(state['inbox']) + 1}",
        "round": state["round"],
        "sender": sender,
        "tag": tag,
        "title": title,
        "body": body,
        "read": False,
    })
    state["inbox"] = state["inbox"][:28]


def _record_ledger(state: dict[str, Any], label: str, delta_k: float, *, cap_counts: bool = False) -> None:
    eco = state["economy"]
    eco["cash_k"] = round(float(eco["cash_k"]) + delta_k, 1)
    if state["tier"] == "f1" and delta_k < 0:
        if cap_counts:
            eco["cost_cap_spent_k"] = round(float(eco["cost_cap_spent_k"]) + abs(delta_k), 1)
        else:
            eco["exempt_spent_k"] = round(float(eco["exempt_spent_k"]) + abs(delta_k), 1)
    eco["ledger"].insert(0, {
        "round": state["round"],
        "label": label,
        "delta_k": round(delta_k, 1),
        "cap_counts": cap_counts,
    })
    eco["ledger"] = eco["ledger"][:30]


def get_player_team(state: dict[str, Any]) -> dict[str, Any]:
    tier_obj = state["tiers"][state["tier"]]
    for t in tier_obj["teams"]:
        if t.get("is_player"):
            return t
    return tier_obj["teams"][0]


def _ideal_setup_for_circuit(circuit_id: str) -> dict[str, int]:
    cir = get_circuit(circuit_id) or CIRCUITS[0]
    aero = str(cir.get("aero") or "MEDIUM").upper()
    if aero == "HIGH":
        return {"front_wing": 76, "rear_wing": 78, "ride_height": 48, "chassis_flex": 68, "gear_ratio": 34, "tyre_pressure": 56}
    if aero == "LOW":
        return {"front_wing": 28, "rear_wing": 26, "ride_height": 42, "chassis_flex": 38, "gear_ratio": 78, "tyre_pressure": 46}
    return {"front_wing": 54, "rear_wing": 56, "ride_height": 50, "chassis_flex": 52, "gear_ratio": 54, "tyre_pressure": 50}


# =============================================================================
# 2. MICRO LOOP: PRACTICE, SETUP, QUALIFYING & RACE COMMIT / QUICK SIM
# =============================================================================

def apply_setup_and_practice(state: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    wk = state["weekend"]
    tcfg = TIER_CONFIG[state["tier"]]
    setup = wk["setup"]
    for k in ("chassis_flex", "gear_ratio", "tyre_pressure", "front_wing", "rear_wing", "ride_height"):
        if k in payload:
            setup[k] = int(_clamp(float(payload[k]), 10, 95))
    if "coaching" in payload:
        setup["coaching"] = str(payload["coaching"])
    if "tyre_alloc" in payload:
        setup["tyre_alloc"] = str(payload["tyre_alloc"])

    ideal = _ideal_setup_for_circuit(wk["circuit_id"])
    if tcfg["unlocks"]["kart_tuning"]:
        err = (
            abs(setup["chassis_flex"] - ideal["chassis_flex"])
            + abs(setup["gear_ratio"] - ideal["gear_ratio"])
            + abs(setup["tyre_pressure"] - ideal["tyre_pressure"])
        ) / 3.0
        gar_lv = int(state["facilities"].get("garage_bays", 1))
        conf = _clamp(96.0 - err * 1.15 + (gar_lv - 1) * 4.0, 42.0, 99.0)
        wk["setup_confidence"] = round(conf, 1)
        wk["practice_done"] = True
        wk["phase"] = "quali"
        return {"ok": True, "setup_confidence": wk["setup_confidence"], "note": f"Kart pre-race bench setup locked ({conf:.0f}% balance · coaching: {setup['coaching']})."}

    # F4+ Practice Session (with F1 Wind-Tunnel Correlation Validation!)
    err = (
        abs(setup["front_wing"] - ideal["front_wing"])
        + abs(setup["rear_wing"] - ideal["rear_wing"])
        + abs(setup["ride_height"] - ideal["ride_height"])
    ) / 3.0
    tel_lv = int(state["facilities"].get("telemetry_rig", state["facilities"].get("dil_sim", state["facilities"].get("adv_sim", state["facilities"].get("wind_tunnel", 1)))))
    eng = next((s for s in state["staff"] if "Engineer" in s["role"] and s["gardening_rounds_left"] == 0), None)
    eng_bonus = ((eng["rating"] - 65) * 0.25) if eng else 0.0
    conf = _clamp(95.0 - err * 1.05 + (tel_lv - 1) * 3.5 + eng_bonus, 45.0, 99.0)
    wk["setup_confidence"] = round(conf, 1)
    wk["practice_done"] = True
    wk["phase"] = "quali"

    # Validate pending F1 wind-tunnel upgrades on track!
    corr_notes = []
    if tcfg["unlocks"]["custom_rd_correlation"] and state["rd"]["pending_upgrades"]:
        rng = random.Random(state["rng_seed"] + state["round"] * 37)
        acc = float(state["rd"]["correlation_accuracy"])
        for up in state["rd"]["pending_upgrades"]:
            spread = max(0.35, (100.0 - acc) * 0.075)
            realized = round(float(up["predicted_gain"]) + rng.uniform(-spread, spread * 0.7), 2)
            vec = up["vector"]
            state["rd"]["philosophy"][vec] = round(_clamp(state["rd"]["philosophy"][vec] + realized, 55.0, 99.0), 1)
            status = "CORRELATED" if realized >= up["predicted_gain"] * 0.7 else ("BOUNCING/DEFICIT" if realized < 0 else "UNDER-CORRELATED")
            state["rd"]["upgrade_log"].insert(0, {
                "round": state["round"],
                "name": up["name"],
                "vector": vec,
                "predicted": up["predicted_gain"],
                "realized": realized,
                "status": status,
            })
            corr_notes.append(f"{up['name']}: predicted +{up['predicted_gain']} → on-track {realized:+.1f} ({status})")
        state["rd"]["pending_upgrades"] = []
        # Update player F1 car rating from philosophy average
        ph = state["rd"]["philosophy"]
        get_player_team(state)["car_rating"] = round(sum(ph.values()) / len(ph), 1)

    return {
        "ok": True,
        "setup_confidence": wk["setup_confidence"],
        "correlation_notes": corr_notes,
        "note": f"Practice completed ({conf:.0f}% setup balance)." + (" " + " | ".join(corr_notes) if corr_notes else ""),
    }


def run_qualifying(state: dict[str, Any], tactic: str = "clean_air") -> dict[str, Any]:
    """Run Qualifying with track evolution, slipstream tow risk, and clean-air release windows."""
    wk = state["weekend"]
    tier = state["tier"]
    tcfg = TIER_CONFIG[tier]
    tier_obj = state["tiers"][tier]
    cir = get_circuit(wk["circuit_id"]) or CIRCUITS[0]
    rng = random.Random(state["rng_seed"] + state["season"] * 997 + state["round"] * 53)

    wk["quali_tactic"] = tactic
    base_lap = float(cir.get("base_lap_s") or 82.0) * (1.26 if tier == "karting" else (1.18 if tier == "f4" else (1.12 if tier == "f3" else (1.06 if tier == "f2" else 1.0))))
    is_wet = wk["weather_mode"] in ("rain", "showers")

    # Tactic modifiers (Track evolution, tow gamble, clean air)
    tactic_delta = 0.0
    traffic_risk = 0.08 if tier != "f3" else 0.24
    if tactic == "late_evolution":
        tactic_delta = -0.34
        traffic_risk += 0.14
    elif tactic == "tow_gamble":
        tactic_delta = -0.48
        traffic_risk += 0.22
    else:  # clean_air
        tactic_delta = -0.05
        traffic_risk *= 0.35

    grid = []
    for team in tier_obj["teams"]:
        is_pl = bool(team.get("is_player"))
        car_r = float(team["car_rating"])
        if is_pl and tier == "f1":
            ph = state["rd"]["philosophy"]
            aero_type = str(cir.get("aero") or "MEDIUM").upper()
            if aero_type == "HIGH":
                car_r = ph["low_speed_df"] * 0.45 + ph["tyre_pres"] * 0.25 + ph["cooling"] * 0.15 + ph["high_speed_eff"] * 0.15
            elif aero_type == "LOW":
                car_r = ph["high_speed_eff"] * 0.42 + ph["drag"] * 0.32 + ph["cooling"] * 0.14 + ph["low_speed_df"] * 0.12
            else:
                car_r = sum(ph.values()) / len(ph)

        for did in team["driver_ids"]:
            d = state["drivers"][did]
            pace = float(d["stats"]["pace"])
            wet_b = (float(d["stats"]["wet"]) - 70.0) * 0.025 if is_wet else 0.0
            setup_b = ((wk["setup_confidence"] - 65.0) * 0.015) if is_pl else rng.uniform(-0.15, 0.22)
            t_mod = tactic_delta if is_pl else rng.uniform(-0.22, 0.12)
            impeded = rng.random() < (traffic_risk if is_pl else 0.10)
            traffic_pen = rng.uniform(0.45, 1.05) if impeded else 0.0
            if d["trait"] == "Quali Rocket":
                pace += 3.0
            perf = car_r * (0.52 if tier == "f1" else 0.28) + pace * (0.48 if tier == "f1" else 0.72)
            lap_s = base_lap - (perf - 70.0) * 0.085 - wet_b - setup_b + t_mod + traffic_pen + rng.uniform(-0.28, 0.28)
            grid.append({
                "driver_id": did,
                "name": d["name"],
                "code3": d["code3"],
                "team": team["name"],
                "color": team["color"],
                "is_player": is_pl,
                "car_rating": round(car_r, 1),
                "overall": d["overall"],
                "stats": d["stats"],
                "trait": d["trait"],
                "ego": d["ego"],
                "trust": d["trust"],
                "lap_s": round(lap_s, 3),
                "impeded": impeded,
            })

    grid.sort(key=lambda g: g["lap_s"])
    pole = grid[0]["lap_s"]
    for i, g in enumerate(grid, start=1):
        g["pos"] = i
        g["gap_s"] = round(g["lap_s"] - pole, 3)

    wk["quali_grid"] = grid
    wk["quali_done"] = True
    wk["phase"] = "race"

    # F3 & F2 Reverse-Grid Sprint Race bonus!
    sprint_summary = None
    if tcfg["unlocks"]["reverse_grid_sprint"]:
        rev_top = 12 if tier == "f3" else 10
        sprint_order = list(reversed(grid[:rev_top])) + grid[rev_top:]
        sprint_scored = []
        for idx_s, g in enumerate(sprint_order):
            d = state["drivers"][g["driver_id"]]
            score = (
                g["car_rating"] * 0.30
                + d["stats"]["racecraft"] * 0.45
                + d["stats"]["pace"] * 0.25
                + (len(sprint_order) - idx_s) * 0.35
                + rng.uniform(-4.0, 4.0)
            )
            sprint_scored.append((score, g))
        sprint_scored.sort(key=lambda x: -x[0])
        sprint_pts = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
        s_top = []
        for sp_pos, (_, sg) in enumerate(sprint_scored[:10], start=1):
            pts = sprint_pts[sp_pos - 1]
            state["drivers"][sg["driver_id"]]["season_pts"] += pts
            for tm in tier_obj["teams"]:
                if tm["name"] == sg["team"]:
                    tm["points"] += pts
                    break
            s_top.append({"pos": sp_pos, "code3": sg["code3"], "name": sg["name"], "team": sg["team"], "pts": pts, "is_player": sg["is_player"]})
        sprint_summary = {"top10": s_top, "reversed_count": rev_top}
        wk["sprint_result"] = sprint_summary

    return {"ok": True, "grid": grid, "sprint_result": sprint_summary}


def _simulate_background_tiers(state: dict[str, Any], rng: random.Random) -> list[str]:
    """Advance all OTHER 4 championships concurrently so the 5-tier ecosystem stays alive!"""
    headlines = []
    player_tier = state["tier"]
    for tid in TIER_ORDER:
        if tid == player_tier:
            continue
        tobj = state["tiers"][tid]
        tcfg = TIER_CONFIG[tid]
        r_idx = tobj["round"] - 1
        if r_idx >= len(tobj["calendar"]):
            continue
        cal_item = tobj["calendar"][r_idx]
        scored = []
        for tm in tobj["teams"]:
            for did in tm["driver_ids"]:
                d = state["drivers"][did]
                dnf = rng.random() < (0.11 if tid in ("karting", "f3") else 0.07)
                sc = tm["car_rating"] * (0.50 if tid == "f1" else 0.28) + d["overall"] * (0.50 if tid == "f1" else 0.72) + rng.uniform(-5.5, 5.5)
                scored.append((dnf, -sc, did, tm))
        scored.sort()
        pts_tbl = tcfg["points_table"]
        winner_name = ""
        for pos, (dnf, _, did, tm) in enumerate(scored, start=1):
            d = state["drivers"][did]
            if dnf:
                d["season_dnfs"] += 1
                continue
            if pos == 1:
                d["season_wins"] += 1
                winner_name = d["name"]
            if pos <= 3:
                d["season_podiums"] += 1
            if pos <= len(pts_tbl):
                p = pts_tbl[pos - 1]
                d["season_pts"] += p
                tm["points"] += p
        cal_item["completed"] = True
        cal_item["winner"] = winner_name
        tobj["round"] += 1
        if winner_name:
            headlines.append(f"{tcfg['short']} R{r_idx + 1} ({cal_item['circuit_name']}): {winner_name} wins!")
    return headlines


def commit_race_results(
    state: dict[str, Any],
    standings: list[dict[str, Any]],
    telemetry: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Commit finished race standings (from Live Pit Wall or Quick Sim), process economy, crash damage, trust, & world AI."""
    tier = state["tier"]
    tcfg = TIER_CONFIG[tier]
    tier_obj = state["tiers"][tier]
    wk = state["weekend"]
    rng = random.Random(state["rng_seed"] + state["season"] * 1013 + state["round"] * 89)
    tel = telemetry or {}

    pts_tbl = tcfg["points_table"]
    team_map = {t["name"]: t for t in tier_obj["teams"]}
    player_results = []
    crash_bill_k = 0.0
    prize_k = 0.0
    rep_delta = 0.0

    for row in standings:
        did = row["driver_id"]
        pos = int(row["pos"])
        dnf = bool(row.get("dnf"))
        crash_dmg = bool(row.get("crash_damage", dnf and rng.random() < 0.65))
        d = state["drivers"].get(did)
        if not d:
            continue
        tm = team_map.get(d["team"])
        pts = 0
        if dnf:
            d["season_dnfs"] += 1
        else:
            if pos == 1:
                d["season_wins"] += 1
            if pos <= 3:
                d["season_podiums"] += 1
            if pos <= len(pts_tbl):
                pts = pts_tbl[pos - 1]
                d["season_pts"] += pts
                if tm:
                    tm["points"] += pts

        if tm and tm.get("is_player"):
            # Prize payout + rep + trust + crash damage economy!
            if not dnf and pos <= 10:
                prize_k += round((tcfg["prize_pool_k"] / tcfg["rounds"]) * (11 - pos) / 14.0, 1)
            if not dnf and pos <= 3:
                rep_delta += 3.2 if pos == 1 else 2.0
                d["trust"] = int(_clamp(d["trust"] + 4, 20, 99))
                d["morale"] = int(_clamp(d["morale"] + 5, 20, 99))
            elif not dnf and pos <= 8:
                rep_delta += 1.0
                d["trust"] = int(_clamp(d["trust"] + 1, 20, 99))
            elif dnf:
                rep_delta -= 1.2
                d["morale"] = int(_clamp(d["morale"] - 5, 20, 99))

            # Driver skill progression from track time
            if d["overall"] < d["potential"] and rng.random() < (0.45 if not dnf else 0.15):
                d["overall"] = min(d["potential"], d["overall"] + 1)
                st_k = rng.choice(["pace", "racecraft", "tyre_care", "consistency"])
                d["stats"][st_k] = min(99, d["stats"][st_k] + 1)

            # Crash-damage repair invoice (F4+)
            dmg_k = 0.0
            if tcfg["unlocks"]["crash_damage_economy"] and crash_dmg:
                ws_lv = int(state["facilities"].get("regional_workshop", state["facilities"].get("composite_factory", 1)))
                disc = max(0.55, 1.0 - (ws_lv - 1) * 0.11)
                dmg_k = round(tcfg["repair_scale_k"] * rng.uniform(0.7, 1.65) * disc, 1)
                crash_bill_k += dmg_k

            player_results.append({
                "driver_id": did,
                "name": d["name"],
                "pos": pos,
                "dnf": dnf,
                "pts": pts,
                "crash_bill_k": dmg_k,
                "obeyed_orders": row.get("obeyed_orders", True),
            })

    # Sponsor & Pay-driver round income + Staff/Driver salaries
    tr_lv = int(state["facilities"].get("race_trailer", state["facilities"].get("factory_campus", 1)))
    sponsor_k = round(state["economy"]["sponsor_per_round_k"] * (1.0 + (tr_lv - 1) * 0.12), 1)
    pay_k = sum(round(state["drivers"][did].get("pay_driver_k", 0.0) / tcfg["rounds"], 1) for did in state["player"]["driver_ids"] if did in state["drivers"])
    acad_k = 0.0
    if state.get("academy_deal"):
        acad_k = round(state["academy_deal"]["funding_k"] / tcfg["rounds"], 1)

    _record_ledger(state, f"R{state['round']} Sponsors + Prize Money", sponsor_k + prize_k + pay_k + acad_k, cap_counts=False)

    # Driver salaries & Top-3 staff salaries are EXEMPT from F1 Cost Cap!
    driver_sal_k = sum(round(state["drivers"][did]["salary_k"] / tcfg["rounds"], 1) for did in state["player"]["driver_ids"] if did in state["drivers"])
    staff_sal_k = sum(round(s["salary_k"] / tcfg["rounds"], 1) for s in state["staff"])
    ops_cost_k = round(tcfg["entry_fee_k"] * 0.45, 1)
    _record_ledger(state, f"R{state['round']} Salaries (Driver + Top Staff · Cap Exempt)", -(driver_sal_k + staff_sal_k), cap_counts=False)
    _record_ledger(state, f"R{state['round']} Race Operations & Travel", -ops_cost_k, cap_counts=True)
    if crash_bill_k > 0:
        state["economy"]["repair_bills_ytd_k"] = round(state["economy"]["repair_bills_ytd_k"] + crash_bill_k, 1)
        _record_ledger(state, f"R{state['round']} Crash-Damage Chassis Repairs", -crash_bill_k, cap_counts=True)

    # Tick down Gardening Leave timers on poached staff!
    for s in state["staff"]:
        if s.get("gardening_rounds_left", 0) > 0:
            s["gardening_rounds_left"] -= 1
            if s["gardening_rounds_left"] == 0:
                _add_inbox(state, "HR & Legal", "STAFF", f"{s['name']} Starts Today!", f"Mandatory gardening leave complete — {s['name']} ({s['role']}, Rating {s['rating']}) is now active on the pit wall!")

    # Academy KPI check (F3/F2)
    if state.get("academy_deal") and player_results:
        best_p = min(r["pos"] for r in player_results if not r["dnf"]) if any(not r["dnf"] for r in player_results) else 20
        kpi = int(state["academy_deal"]["kpi_min_pos"])
        if best_p > kpi + 3:
            pen_k = round(state["academy_deal"]["penalty_k"] / tcfg["rounds"], 1)
            _record_ledger(state, f"Academy KPI Miss Penalty (Target P{kpi})", -pen_k, cap_counts=False)
            _add_inbox(state, state["academy_deal"]["f1_team"], "ACADEMY", "KPI Warning", f"Expected P{kpi} or better at {wk['circuit_name']} (best P{best_p}). Withheld ${pen_k}k installment.")

    # Mark round complete in player's tier + advance other 4 tiers concurrently!
    cal_idx = state["round"] - 1
    if 0 <= cal_idx < len(tier_obj["calendar"]):
        tier_obj["calendar"][cal_idx]["completed"] = True
        tier_obj["calendar"][cal_idx]["winner"] = standings[0]["name"] if standings else ""

    bg_headlines = _simulate_background_tiers(state, rng)

    state["player"]["reputation"] = round(_clamp(state["player"]["reputation"] + rep_delta, 5.0, 99.0), 1)

    debrief = {
        "round": state["round"],
        "circuit_name": wk["circuit_name"],
        "winner": standings[0]["name"] if standings else "",
        "player_results": player_results,
        "income_k": round(sponsor_k + prize_k + pay_k + acad_k, 1),
        "expenses_k": round(driver_sal_k + staff_sal_k + ops_cost_k + crash_bill_k, 1),
        "crash_bill_k": round(crash_bill_k, 1),
        "rep_delta": round(rep_delta, 1),
        "world_headlines": bg_headlines,
        "weather": tel.get("weather_summary", wk["weather_mode"]),
        "safety_cars": tel.get("safety_cars", 0),
    }

    # Check if season is finished or advance to next round
    season_complete = state["round"] >= len(tier_obj["calendar"])
    if not season_complete:
        state["round"] += 1
        tier_obj["round"] = state["round"]
        state["weekend"] = _fresh_weekend_state(tier, tier_obj["calendar"][state["round"] - 1])
        state["weekend"]["last_race_debrief"] = debrief
    else:
        wk["phase"] = "season_end"
        wk["last_race_debrief"] = debrief
        _prepare_season_end_offers(state, rng)

    # Periodic Silly Season AI rumor / movement!
    if rng.random() < 0.45:
        ai_t = rng.choice(state["tiers"]["f1"]["teams"])
        if not ai_t.get("is_player"):
            rumor = f"Paddock Rumour: {ai_t['name']} board reviewing TP {ai_t['principal']} after recent points haul."
            state["silly_season_log"].insert(0, {"season": state["season"], "round": state["round"], "text": rumor})
            state["silly_season_log"] = state["silly_season_log"][:18]

    return {"ok": True, "debrief": debrief, "season_complete": season_complete}


def quick_sim_race(state: dict[str, Any]) -> dict[str, Any]:
    """Server-side fast race simulation when player skips watching the live Pit Wall."""
    wk = state["weekend"]
    if not wk["quali_done"]:
        run_qualifying(state, tactic=wk.get("quali_tactic", "clean_air"))
    rng = random.Random(state["rng_seed"] + state["season"] * 353 + state["round"] * 71)
    tier = state["tier"]
    is_wet = wk["weather_mode"] in ("rain", "showers")

    scored = []
    for g in wk["quali_grid"]:
        d = state["drivers"][g["driver_id"]]
        dnf_p = 0.085 - (d["stats"]["consistency"] - 65) * 0.0012
        if d["trait"] == "Crash-Prone Charger":
            dnf_p += 0.055
        if tier == "f3":
            dnf_p += 0.03
        dnf = rng.random() < _clamp(dnf_p, 0.025, 0.24)
        wet_d = (d["stats"]["wet"] - 72) * 0.14 if is_wet else 0.0
        tyre_d = (d["stats"]["tyre_care"] - 72) * 0.09
        setup_d = (wk["setup_confidence"] - 65) * 0.08 if g["is_player"] else 0.0
        sc = (
            g["car_rating"] * (0.48 if tier == "f1" else 0.26)
            + d["stats"]["racecraft"] * 0.34
            + d["stats"]["pace"] * 0.20
            + (len(wk["quali_grid"]) - g["pos"]) * 0.38
            + wet_d + tyre_d + setup_d
            + rng.uniform(-4.6, 4.6)
        )
        scored.append({"driver_id": g["driver_id"], "name": g["name"], "dnf": dnf, "score": sc})

    scored.sort(key=lambda x: (1 if x["dnf"] else 0, -x["score"]))
    standings = [{"driver_id": x["driver_id"], "name": x["name"], "pos": i + 1, "dnf": x["dnf"], "crash_damage": x["dnf"]} for i, x in enumerate(scored)]
    return commit_race_results(state, standings, telemetry={"weather_summary": wk["weather_mode"], "safety_cars": rng.randint(0, 2)})


# =============================================================================
# 3. MESO LOOP: FACILITIES, FOG-OF-WAR SCOUTING, STAFF GARDENING LEAVE, ACADEMY, R&D, FIA
# =============================================================================

def upgrade_facility(state: dict[str, Any], fac_id: str) -> tuple[bool, str]:
    tcfg = TIER_CONFIG[state["tier"]]
    spec = next((f for f in tcfg["facilities"] if f["id"] == fac_id), None)
    if not spec:
        return False, "Facility not available at this tier."
    cur_lv = int(state["facilities"].get(fac_id, 1))
    if cur_lv >= spec["max_lv"]:
        return False, f"{spec['name']} is already at Max Level {spec['max_lv']}."
    cost_k = round(spec["base_cost_k"] * (1.45 ** (cur_lv - 1)), 1)
    if state["economy"]["cash_k"] < cost_k:
        return False, f"Insufficient cash (${cost_k}k required)."
    _record_ledger(state, f"Upgrade {spec['name']} → Lv {cur_lv + 1}", -cost_k, cap_counts=False)  # CapEx exempt
    state["facilities"][fac_id] = cur_lv + 1
    if fac_id == "wind_tunnel":
        state["rd"]["correlation_accuracy"] = min(97.0, state["rd"]["correlation_accuracy"] + 5.5)
    elif fac_id == "garage_bays":
        get_player_team(state)["car_rating"] = min(68.0, get_player_team(state)["car_rating"] + 2.0)
    return True, f"Upgraded {spec['name']} to Level {cur_lv + 1} (${cost_k}k)."


def scout_driver(state: dict[str, Any], driver_id: str) -> tuple[bool, str]:
    d = state["drivers"].get(driver_id)
    if not d:
        return False, "Driver not found."
    if d.get("scouted"):
        return False, f"{d['name']} is already fully scouted."
    cost_k = round(12.0 * (2.1 ** (TIER_CONFIG[state["tier"]]["rank"] - 1)), 1)
    if state["economy"]["cash_k"] < cost_k:
        return False, f"Need ${cost_k}k to dispatch scouts."
    _record_ledger(state, f"Scout Report: {d['name']}", -cost_k, cap_counts=True)
    d["scouted"] = True
    d["trait_revealed"] = True
    d["pot_lo"] = d["potential"]
    d["pot_hi"] = d["potential"]
    return True, f"Scouted {d['name']}: True Potential {d['potential']} · Trait: {d['trait']} · Super License {d['sl_points']}/40 pts."


def sign_driver(state: dict[str, Any], driver_id: str, replace_idx: int = 0) -> tuple[bool, str]:
    d = state["drivers"].get(driver_id)
    if not d:
        return False, "Driver not found."
    if state["tier"] == "f1" and not d.get("sl_eligible"):
        return False, f"FIA Super License Block: {d['name']} only has {d['sl_points']}/40 rolling 3-year Super License points!"
    player = state["player"]
    if driver_id in player["driver_ids"]:
        return False, f"{d['name']} already drives for your team."
    buyout_k = 0.0 if d["team"] == "Free Agent" else round(d["salary_k"] * 0.75, 1)
    if state["economy"]["cash_k"] < buyout_k:
        return False, f"Need ${buyout_k}k buyout fee."
    if buyout_k > 0:
        _record_ledger(state, f"Driver Buyout: {d['name']}", -buyout_k, cap_counts=False)

    pt = get_player_team(state)
    idx = 0 if replace_idx not in (0, 1) else replace_idx
    old_id = player["driver_ids"][idx]
    if old_id in state["drivers"]:
        state["drivers"][old_id]["team"] = "Free Agent"
    # Remove new driver from old team if contracted
    for tobj in state["tiers"].values():
        for tm in tobj["teams"]:
            if driver_id in tm["driver_ids"]:
                tm["driver_ids"].remove(driver_id)

    player["driver_ids"][idx] = driver_id
    pt["driver_ids"] = list(player["driver_ids"])
    d["team"] = pt["name"]
    d["tier"] = state["tier"]
    d["scouted"] = True
    d["trait_revealed"] = True
    return True, f"Signed {d['name']} (OVR {d['overall']}, SL {d['sl_points']} pts) into Seat #{idx + 1}!"


def poach_staff(state: dict[str, Any], staff_id: str) -> tuple[bool, str]:
    cand = next((s for s in state["staff_market"] if s["id"] == staff_id), None)
    if not cand:
        return False, "Staff candidate not available."
    min_rank = TIER_CONFIG[cand["tier_min"]]["rank"]
    if TIER_CONFIG[state["tier"]]["rank"] < min_rank:
        return False, f"{cand['name']} requires at least {cand['tier_min'].upper()} tier."
    cost_k = float(cand["buyout_k"])
    if state["economy"]["cash_k"] < cost_k:
        return False, f"Need ${cost_k}k poaching buyout."
    _record_ledger(state, f"Staff Poach Buyout: {cand['name']} ({cand['from_team']})", -cost_k, cap_counts=False)
    gl = int(cand["gardening_rounds"]) if TIER_CONFIG[state["tier"]]["unlocks"]["gardening_leave"] else 0
    state["staff_market"] = [s for s in state["staff_market"] if s["id"] != staff_id]
    state["staff"].append({
        "id": cand["id"],
        "role": cand["role"],
        "name": cand["name"],
        "rating": cand["rating"],
        "salary_k": cand["salary_k"],
        "exempt_top3": True,
        "gardening_rounds_left": gl,
        "former_team": cand["from_team"],
    })
    if gl > 0:
        _add_inbox(state, "FIA Legal", "POACH", f"Gardening Leave: {cand['name']}", f"Poached from {cand['from_team']}! Enforced {gl}-round mandatory gardening leave before joining the factory.")
        return True, f"Poached {cand['name']} from {cand['from_team']} ({gl} rounds mandatory gardening leave)."
    return True, f"Hired {cand['name']} ({cand['role']}, Rating {cand['rating']}) immediately!"


def sign_academy_deal(state: dict[str, Any], offer_id: str) -> tuple[bool, str]:
    if not TIER_CONFIG[state["tier"]]["unlocks"]["academy_affiliates"]:
        return False, "F1 Academy Affiliate deals unlock in Formula 3 & Formula 2."
    offer = next((o for o in state["academy_offers"] if o["id"] == offer_id), None)
    if not offer:
        return False, "Academy offer not found."
    state["academy_deal"] = copy.deepcopy(offer)
    # Place academy junior into Seat #2!
    rng = random.Random(state["rng_seed"] + 404)
    jid = f"acad_drv_{offer['id']}"
    jdrv = _make_driver(
        rng, jid, offer["junior_name"], offer["junior_nat"], state["tier"],
        get_player_team(state)["name"], 18, offer["junior_ovr"], offer["junior_pot"],
        sl_history=[8, 12, 0], scouted=True, academy=offer["f1_team"],
    )
    state["drivers"][jid] = jdrv
    old_id = state["player"]["driver_ids"][1]
    if old_id in state["drivers"]:
        state["drivers"][old_id]["team"] = "Free Agent"
    state["player"]["driver_ids"][1] = jid
    get_player_team(state)["driver_ids"] = list(state["player"]["driver_ids"])
    _add_inbox(state, offer["f1_team"], "ACADEMY", "Affiliate Contract Signed!", f"Funding: ${offer['funding_k']}k/yr · Junior {jdrv['name']} (POT {jdrv['potential']}) placed in Seat #2 · KPI: Finish P{offer['kpi_min_pos']} or higher.")
    return True, f"Signed {offer['f1_team']} Affiliate Deal (+${offer['funding_k']}k/season, junior {jdrv['name']} joins Seat #2)!"


def develop_f1_upgrade(state: dict[str, Any], vector: str, name: str = "") -> tuple[bool, str]:
    if not TIER_CONFIG[state["tier"]]["unlocks"]["custom_rd_correlation"]:
        return False, "Custom Aerospace R&D & Wind-Tunnel Correlation unlocks in Formula 1."
    if vector not in state["rd"]["philosophy"]:
        return False, "Invalid car philosophy vector."
    cf_lv = int(state["facilities"].get("composite_factory", 1))
    cost_k = round(max(1800.0, 3600.0 - (cf_lv - 1) * 350.0), 1)
    if state["economy"]["cash_k"] < cost_k:
        return False, f"Insufficient cash (${cost_k}k)."
    if state["economy"]["cost_cap_spent_k"] + cost_k > state["economy"]["cost_cap_limit_k"]:
        return False, f"FIA Cost Cap Breach Blocked! (${state['economy']['cost_cap_spent_k']}k + ${cost_k}k > ${state['economy']['cost_cap_limit_k']}k cap)."
    if state["rd"]["cfd_hours"] < 15 or state["rd"]["wind_tunnel_runs"] < 6:
        return False, "Insufficient CFD Hours (15 req) or Wind Tunnel Runs (6 req)."

    _record_ledger(state, f"F1 R&D Package: {vector.replace('_', ' ').title()}", -cost_k, cap_counts=True)
    state["rd"]["cfd_hours"] -= 15
    state["rd"]["wind_tunnel_runs"] -= 6
    wt_lv = int(state["facilities"].get("wind_tunnel", 1))
    predicted = round(1.8 + (wt_lv - 1) * 0.35, 2)
    pkg_name = name.strip() or f"Spec-{len(state['rd']['upgrade_log']) + len(state['rd']['pending_upgrades']) + 1} {vector.replace('_', ' ').title()}"
    state["rd"]["pending_upgrades"].append({
        "name": pkg_name,
        "vector": vector,
        "predicted_gain": predicted,
        "cost_k": cost_k,
    })
    return True, f"Manufactured {pkg_name} (CFD predicted +{predicted} {vector}) — run Practice to validate Wind-Tunnel correlation!"


def vote_fia_proposal(state: dict[str, Any], vote: str) -> tuple[bool, str]:
    if not TIER_CONFIG[state["tier"]]["unlocks"]["fia_voting"]:
        return False, "FIA Commission Regulation Voting unlocks in Formula 1."
    gov = state["fia_governance"]
    if gov.get("voted"):
        return False, "You already voted on this season's FIA proposal."
    prop = gov["active_proposal"]
    rng = random.Random(state["rng_seed"] + state["season"] * 77)
    yes_votes = 1 if vote == "yes" else 0
    no_votes = 1 if vote != "yes" else 0
    for tm in state["tiers"]["f1"]["teams"]:
        if tm.get("is_player"):
            continue
        # Self-interested AI vote based on car rating & proposal type
        ai_yes = rng.random() < (0.62 if tm["car_rating"] < 85 else 0.42)
        if ai_yes:
            yes_votes += 1
        else:
            no_votes += 1
    passed = yes_votes > no_votes
    gov["voted"] = True
    gov["last_tally"] = {"yes": yes_votes, "no": no_votes, "passed": passed}
    if passed:
        gov["passed_rules"].append({"season": state["season"], "title": prop["title"]})
        imp = prop.get("impact", {})
        if "cost_cap_delta_k" in imp:
            state["economy"]["cost_cap_limit_k"] = max(110000.0, state["economy"]["cost_cap_limit_k"] + imp["cost_cap_delta_k"])
        for vec_k in ("low_speed_df", "high_speed_eff", "drag", "tyre_pres", "cooling"):
            if vec_k in imp:
                state["rd"]["philosophy"][vec_k] = round(_clamp(state["rd"]["philosophy"][vec_k] + imp[vec_k], 55.0, 99.0), 1)
    _add_inbox(state, "FIA Commission", "FIA", f"Vote {'PASSED' if passed else 'REJECTED'}: {prop['title']}", f"Tally: {yes_votes} YES vs {no_votes} NO.")
    return True, f"Proposal {'PASSED' if passed else 'REJECTED'} ({yes_votes}–{no_votes})."


# =============================================================================
# 4. MACRO LOOP: SUPER LICENSE ROLLING 3-YEAR LEDGER & THE HYBRID CAREER FORK
# =============================================================================

def _prepare_season_end_offers(state: dict[str, Any], rng: random.Random) -> None:
    """Evaluate promotions, AI principal firings & generate F2 -> F1 Hybrid Career Fork offers."""
    tier = state["tier"]
    tier_obj = state["tiers"][tier]
    standings = sorted(tier_obj["teams"], key=lambda t: -float(t["points"]))
    player_pos = next((i + 1 for i, t in enumerate(standings) if t.get("is_player")), len(standings))

    # Run AI Principal board evaluation first so organic F1 dismissals create real poaching vacancies!
    ai_eval = _world_ai.evaluate_ai_principals_and_poaching(state, rng)

    offers = list(state["player"].get("poach_offers") or [])
    if tier in ("f2", "f1"):
        existing_f1 = {o["f1_team"] for o in offers}
        f1_teams = [t for t in state["tiers"]["f1"]["teams"] if not t.get("is_player")]
        eligible_f1 = [t for t in f1_teams if t["car_rating"] <= (84 if state["player"]["reputation"] < 80 else 92)]
        for ft in rng.sample(eligible_f1 or f1_teams, min(3, len(eligible_f1 or f1_teams))):
            if ft["name"] not in existing_f1 and len(offers) < 3:
                offers.append({
                    "id": f"poach_{ft['id']}",
                    "f1_team": ft["name"],
                    "color": ft["color"],
                    "car_rating": ft["car_rating"],
                    "budget_k": round(128000.0 + (ft["car_rating"] - 76) * 2800.0, 1),
                    "reputation_req": 68 if ft["car_rating"] < 83 else 82,
                })
                existing_f1.add(ft["name"])
        state["player"]["poach_offers"] = offers
        if tier == "f2" and (player_pos <= 4 or state["player"]["reputation"] >= 70 or ai_eval["qualified_offers"]):
            state["player"]["fork_ready"] = True
            _add_inbox(
                state,
                "Formula 1 Paddock",
                "FORK",
                "THE CAREER FORK: F1 Calls!",
                f"Finished P{player_pos} in F2! Choose Path A (Accept F1 Team Principal Poach Offer) or Path B (Submit Own Constructor Bid to bring {state['player']['team_name']} to Formula 1)!",
            )


def choose_career_fork_or_promote(
    state: dict[str, Any],
    action: str,
    target_f1_team: str | None = None,
) -> tuple[bool, str]:
    """
    Handle tier promotion OR the F2 -> F1 Hybrid Career Fork:
      - action='promote' (Karting -> F4 -> F3 -> F2)
      - action='poach' (Path A: Accept F1 Team Principal job; original feeder team continues as AI rival!)
      - action='constructor_bid' (Path B: Stay as Owner and enter your own Constructor into F1!)
      - action='mercenary' (Path C: Move between F1 teams across seasons!)
      - action='stay' (Stay in current tier for another season)
    """
    cur_tier = state["tier"]
    rng = random.Random(state["rng_seed"] + state["season"] * 509)

    # 1. Award Rolling 3-Year FIA Super License Points across ALL 5 tiers!
    for tid in ("f4", "f3", "f2"):
        sl_tbl = TIER_CONFIG[tid]["sl_points"]
        t_drvs = [d for d in state["drivers"].values() if d["tier"] == tid and d["team"] != "Free Agent"]
        t_drvs.sort(key=lambda d: (-float(d["season_pts"]), -d["season_wins"]))
        for pos, drv in enumerate(t_drvs, start=1):
            earned = sl_tbl[pos - 1] if pos <= len(sl_tbl) else 0
            hist = (drv.get("sl_history") or [0, 0, 0])[-2:] + [earned]
            drv["sl_history"] = hist
            drv["sl_points"] = sum(hist)
            drv["sl_eligible"] = drv["sl_points"] >= 40

    # 1b. Run Living 5-Tier World AI (40-pt SL F1 graduations, inter-tier promotions, Karting regens, AI firings & poaching!)
    world_summary = _world_ai.run_offseason_world_ai(state, rng, _make_driver)
    state["last_offseason_summary"] = world_summary

    # Age all drivers by 1 year & reset season counters
    for d in state["drivers"].values():
        if d["id"] in world_summary.get("regens_spawned", []):
            continue  # Newly spawned 13–15yo Karting regens keep their fresh spawn age
        d["age"] += 1
        d["season_pts"] = 0.0
        d["season_wins"] = 0
        d["season_podiums"] = 0
        d["season_dnfs"] = 0

    # Record season history
    cur_teams = sorted(state["tiers"][cur_tier]["teams"], key=lambda t: -float(t["points"]))
    p_pos = next((i + 1 for i, t in enumerate(cur_teams) if t.get("is_player")), len(cur_teams))
    p_pts = float(get_player_team(state)["points"])
    champ_drv = max(
        [d for d in state["drivers"].values() if d["tier"] == cur_tier],
        key=lambda d: d["overall"],
        default={"name": "Champion"},
    )["name"]
    hist_rec = {
        "season": state["season"],
        "year": state["year"],
        "tier": cur_tier,
        "team_name": state["player"]["team_name"],
        "team_pos": p_pos,
        "points": p_pts,
        "champion_driver": champ_drv,
        "career_path": state["player"]["career_path"],
    }
    state["season_history"].insert(0, hist_rec)

    next_tier = cur_tier
    msg = ""

    if action == "promote":
        idx = TIER_ORDER.index(cur_tier)
        if idx >= 3:
            return False, "Use the Career Fork (Poach or Constructor Bid) to enter Formula 1!"
        next_tier = TIER_ORDER[idx + 1]
        ntcfg = TIER_CONFIG[next_tier]
        # Move player's team up to next_tier!
        state["tier"] = next_tier
        state["player"]["career_path"] = "owner_ladder"
        state["facilities"] = {f["id"]: 1 for f in ntcfg["facilities"]}
        # Inject player's team into next_tier (replacing last AI team)
        old_p = get_player_team(state)
        nt_teams = state["tiers"][next_tier]["teams"]
        # Release old AI slot
        target_slot = nt_teams[-1]
        target_slot["name"] = state["player"]["team_name"]
        target_slot["color"] = state["player"]["color"]
        target_slot["principal"] = state["player"]["principal_name"]
        target_slot["is_player"] = True
        target_slot["car_rating"] = 64 if next_tier == "f4" else (70 if next_tier == "f3" else 76)
        # Keep player's existing drivers & promote them!
        for did in state["player"]["driver_ids"]:
            state["drivers"][did]["tier"] = next_tier
            state["drivers"][did]["team"] = target_slot["name"]
        target_slot["driver_ids"] = list(state["player"]["driver_ids"])
        old_p["is_player"] = False
        state["economy"]["cash_k"] = round(max(state["economy"]["cash_k"], ntcfg["base_budget_k"]), 1)
        state["economy"]["sponsor_per_round_k"] = round(ntcfg["base_budget_k"] * 0.14, 1)
        msg = f"PROMOTED TO {ntcfg['name']}! New mechanics & facilities unlocked!"

    elif action in ("poach", "mercenary"):
        f1_teams = state["tiers"]["f1"]["teams"]
        chosen = next((t for t in f1_teams if t["name"] == target_f1_team), None) or f1_teams[-1]
        # Original feeder team keeps running as an AI rival!
        old_team = get_player_team(state)
        old_team["is_player"] = False
        old_team["principal"] = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)} (AI)"

        # Move player into chosen F1 team
        for ft in f1_teams:
            ft["is_player"] = False
        chosen["is_player"] = True
        chosen["principal"] = state["player"]["principal_name"]
        state["tier"] = "f1"
        state["player"]["team_name"] = chosen["name"]
        state["player"]["color"] = chosen["color"]
        state["player"]["career_path"] = "poached_tp" if action == "poach" else "mercenary"
        state["player"]["owns_team"] = False
        state["player"]["driver_ids"] = list(chosen["driver_ids"][:2])
        state["facilities"] = {f["id"]: 2 for f in TIER_CONFIG["f1"]["facilities"]}
        state["economy"]["cash_k"] = round(128000.0 + (chosen["car_rating"] - 76) * 2800.0, 1)
        state["economy"]["sponsor_per_round_k"] = 14500.0
        state["economy"]["cost_cap_spent_k"] = 0.0
        state["economy"]["exempt_spent_k"] = 0.0
        base_v = float(chosen["car_rating"])
        state["rd"]["philosophy"] = {k: round(base_v + rng.uniform(-3, 3), 1) for k in state["rd"]["philosophy"]}
        msg = f"{'PATH A — THE POACH' if action == 'poach' else 'PATH C — MERCENARY'}: You are now Team Principal of {chosen['name']} in Formula 1! Your former team ({state['player']['original_feeder_team']}) continues as an AI rival."

    elif action == "constructor_bid":
        bid_fee_k = 12000.0
        state["tier"] = "f1"
        state["player"]["career_path"] = "constructor_bid"
        state["player"]["owns_team"] = True
        old_team = get_player_team(state)
        old_team["is_player"] = False
        f1_teams = state["tiers"]["f1"]["teams"]
        for ft in f1_teams:
            ft["is_player"] = False
        # Buy out backmarker slot & enter own Constructor!
        slot = f1_teams[-1]
        slot["name"] = state["player"]["team_name"]
        slot["color"] = state["player"]["color"]
        slot["principal"] = state["player"]["principal_name"]
        slot["is_player"] = True
        slot["car_rating"] = 76.0
        # Ensure both seats have Super-License eligible drivers (promote star junior if >=40 pts!)
        eligible_drvs = []
        for did in state["player"]["driver_ids"]:
            if state["drivers"][did]["sl_points"] >= 40:
                state["drivers"][did]["tier"] = "f1"
                state["drivers"][did]["team"] = slot["name"]
                eligible_drvs.append(did)
        for sd in slot["driver_ids"]:
            if len(eligible_drvs) < 2 and sd not in eligible_drvs:
                state["drivers"][sd]["team"] = slot["name"]
                eligible_drvs.append(sd)
        slot["driver_ids"] = eligible_drvs[:2]
        state["player"]["driver_ids"] = list(slot["driver_ids"])
        state["facilities"] = {f["id"]: 1 for f in TIER_CONFIG["f1"]["facilities"]}
        state["economy"]["cash_k"] = round(max(115000.0, 128000.0 - bid_fee_k + state["economy"]["cash_k"]), 1)
        state["economy"]["sponsor_per_round_k"] = 12200.0
        state["economy"]["cost_cap_spent_k"] = 0.0
        state["economy"]["exempt_spent_k"] = 0.0
        state["rd"]["philosophy"] = {k: 76.0 for k in state["rd"]["philosophy"]}
        msg = f"PATH B — CONSTRUCTOR BID APPROVED! {slot['name']} enters the Formula 1 World Championship as an independent Owner-Constructor!"

    else:
        msg = f"Starting Season {state['season'] + 1} in {TIER_CONFIG[cur_tier]['name']}!"

    # Reset all 5 tiers for new season
    state["season"] += 1
    state["year"] += 1
    state["round"] = 1
    state["player"]["fork_ready"] = False
    state["economy"]["cost_cap_spent_k"] = 0.0
    state["economy"]["exempt_spent_k"] = 0.0
    state["economy"]["repair_bills_ytd_k"] = 0.0
    state["rd"]["cfd_hours"] = 100
    state["rd"]["wind_tunnel_runs"] = 40
    state["fia_governance"]["active_proposal"] = copy.deepcopy(rng.choice(F1_PROPOSALS))
    state["fia_governance"]["voted"] = False

    for tid, tobj in state["tiers"].items():
        tobj["round"] = 1
        for tm in tobj["teams"]:
            tm["points"] = 0.0
        for ci in tobj["calendar"]:
            ci["completed"] = False
            ci["winner"] = None

    state["weekend"] = _fresh_weekend_state(state["tier"], state["tiers"][state["tier"]]["calendar"][0])
    _add_inbox(state, "Motorsport Council", state["tier"].upper(), f"Season {state['season']} ({state['year']}) Underway!", msg)
    return True, msg


def serialize_ladder_view(state: dict[str, Any]) -> dict[str, Any]:
    """Enrich state with computed standings, tier config, unlock matrix, & circuit data for the Pit Wall UI."""
    tier = state["tier"]
    tcfg = TIER_CONFIG[tier]
    tier_obj = state["tiers"][tier]
    cir = get_circuit(state["weekend"]["circuit_id"]) or CIRCUITS[0]

    tier_standings = {}
    for tid in TIER_ORDER:
        tobj = state["tiers"][tid]
        t_sorted = sorted(tobj["teams"], key=lambda t: -float(t["points"]))
        d_list = [d for d in state["drivers"].values() if d["tier"] == tid and d["team"] != "Free Agent"]
        d_sorted = sorted(d_list, key=lambda d: (-float(d["season_pts"]), -d["season_wins"], -d["overall"]))
        tier_standings[tid] = {
            "id": tid,
            "name": tobj["name"],
            "short": tobj["short"],
            "color": tobj["color"],
            "round": tobj["round"],
            "total_rounds": len(tobj["calendar"]),
            "teams": [{"name": t["name"], "color": t["color"], "points": round(float(t["points"]), 1), "is_player": bool(t.get("is_player")), "car_rating": t["car_rating"], "principal": t.get("principal", "")} for t in t_sorted],
            "drivers": [
                {
                    "id": d["id"], "name": d["name"], "code3": d["code3"], "team": d["team"],
                    "age": d["age"], "overall": d["overall"],
                    "pot_display": str(d["potential"]) if d["scouted"] else f"{d['pot_lo']}–{d['pot_hi']}",
                    "trait": d["trait"] if d["trait_revealed"] else "Unscouted (???)",
                    "points": round(float(d["season_pts"]), 1), "wins": d["season_wins"],
                    "sl_points": d["sl_points"], "sl_eligible": d["sl_eligible"], "sl_history": d["sl_history"],
                }
                for d in d_sorted[:15]
            ],
        }

    player_drivers = [state["drivers"][did] for did in state["player"]["driver_ids"] if did in state["drivers"]]
    market_drivers = [
        {
            "id": d["id"], "name": d["name"], "nationality": d["nationality"], "tier": d["tier"],
            "team": d["team"], "age": d["age"], "overall": d["overall"],
            "pot_display": str(d["potential"]) if d["scouted"] else f"{d['pot_lo']}–{d['pot_hi']}",
            "trait": d["trait"] if d["trait_revealed"] else "Hidden Trait (Scout to reveal)",
            "scouted": d["scouted"], "salary_k": d["salary_k"], "pay_driver_k": d["pay_driver_k"],
            "sl_points": d["sl_points"], "sl_eligible": d["sl_eligible"], "academy": d["academy"],
        }
        for d in state["drivers"].values()
        if d["id"] not in state["player"]["driver_ids"] and (d["team"] == "Free Agent" or d["tier"] == tier)
    ]
    market_drivers.sort(key=lambda x: (0 if x["team"] == "Free Agent" else 1, -x["overall"]))

    # Promotion readiness check
    cur_idx = TIER_ORDER.index(tier)
    can_promote = (
        cur_idx < 3
        and state["weekend"]["phase"] == "season_end"
        and (state["player"]["reputation"] >= tcfg["promotion_rep"] or state["economy"]["cash_k"] >= tcfg["promotion_cash_k"])
    )

    from .weekend_engine import get_ladder_practice_rules
    return {
        "state": state,
        "tier_config": tcfg,
        "practice_rules": get_ladder_practice_rules(tier),
        "all_tiers_meta": [
            {
                "id": tid, "rank": TIER_CONFIG[tid]["rank"], "name": TIER_CONFIG[tid]["name"],
                "short": TIER_CONFIG[tid]["short"], "color": TIER_CONFIG[tid]["color"],
                "machinery": TIER_CONFIG[tid]["machinery"], "headline": TIER_CONFIG[tid]["headline"],
            }
            for tid in TIER_ORDER
        ],
        "player_team": get_player_team(state),
        "player_drivers": player_drivers,
        "market_drivers": market_drivers[:24],
        "tier_standings": tier_standings,
        "circuit": cir,
        "ideal_setup_hint": _ideal_setup_for_circuit(state["weekend"]["circuit_id"]) if state["weekend"]["practice_done"] else None,
        "can_promote": can_promote,
        "next_tier": TIER_ORDER[cur_idx + 1] if cur_idx < 4 else None,
    }
