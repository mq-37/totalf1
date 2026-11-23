"""
Historical Formula 1 Regulation Eras Engine (1950s -> 2026).

Single source of truth for era-authentic sporting & technical rules used by:
  - /sim (Full CPU Broadcast Sim & Championships)
  - /career (Team Principal Career & Custom Seasons)
  - Shared JS physics/AI engine (f1_race_engine.js)
"""
from __future__ import annotations

from typing import Any


ERA_RULES: dict[str, dict[str, Any]] = {
    "1950s": {
        "key": "1950s",
        "label": "1950s Front-Engine Classic",
        "years": [1950, 1959],
        "chassis_era": "1950s",
        "points": [8, 6, 4, 3, 2],
        "fastest_lap_point": 1,
        "fastest_lap_top_n": 99,
        "sprint_enabled": False,
        "sprint_points": [],
        "refuelling": True,
        "refuel_sec_per_kg": 0.24,
        "start_fuel_kg": 95.0,
        "fuel_burn_per_lap_kg": 2.6,
        "overtake_aid": "none",  # Slipstream only
        "drs_enabled": False,
        "override_mode": False,
        "ers_enabled": False,
        "turbo_boost": False,
        "two_compound_rule": False,
        "tyre_change_allowed": True,
        "mandatory_pit_stop": False,
        "pit_base_s": 28.0,
        "pit_error_chance": 0.14,
        "reliability_dnf_mult": 2.45,
        "sc_chance_mult": 0.25,  # No formal Safety Car in 1950s
        "vsc_enabled": False,
        "dirty_air_mult": 0.25,
        "slipstream_bonus": 1.15,
        "cost_cap_m": None,
        "summary": "Top-5 scoring (8-6-4-3-2 +1 FL), heavy mechanical attrition, endurance tyres, no DRS/ERS, manual churn pit stops.",
    },
    "1960s": {
        "key": "1960s",
        "label": "1960s Cigar & DFV Revolution",
        "years": [1960, 1969],
        "chassis_era": "1960s",
        "points": [9, 6, 4, 3, 2, 1],
        "fastest_lap_point": 0,
        "fastest_lap_top_n": 0,
        "sprint_enabled": False,
        "sprint_points": [],
        "refuelling": False,
        "refuel_sec_per_kg": 0.0,
        "start_fuel_kg": 115.0,
        "fuel_burn_per_lap_kg": 2.2,
        "overtake_aid": "none",
        "drs_enabled": False,
        "override_mode": False,
        "ers_enabled": False,
        "turbo_boost": False,
        "two_compound_rule": False,
        "tyre_change_allowed": True,
        "mandatory_pit_stop": False,
        "pit_base_s": 18.0,
        "pit_error_chance": 0.11,
        "reliability_dnf_mult": 2.05,
        "sc_chance_mult": 0.35,
        "vsc_enabled": False,
        "dirty_air_mult": 0.35,
        "slipstream_bonus": 1.22,
        "cost_cap_m": None,
        "summary": "Top-6 scoring (9-6-4-3-2-1), rear-engine cigar cars, fierce Monza-style slipstreaming, high mechanical DNF rate.",
    },
    "1970s": {
        "key": "1970s",
        "label": "1970s Slicks & Ground Effect",
        "years": [1970, 1979],
        "chassis_era": "1970s",
        "points": [9, 6, 4, 3, 2, 1],
        "fastest_lap_point": 0,
        "fastest_lap_top_n": 0,
        "sprint_enabled": False,
        "sprint_points": [],
        "refuelling": False,
        "refuel_sec_per_kg": 0.0,
        "start_fuel_kg": 130.0,
        "fuel_burn_per_lap_kg": 2.3,
        "overtake_aid": "none",
        "drs_enabled": False,
        "override_mode": False,
        "ers_enabled": False,
        "turbo_boost": False,
        "two_compound_rule": False,
        "tyre_change_allowed": True,
        "mandatory_pit_stop": False,
        "pit_base_s": 12.5,
        "pit_error_chance": 0.09,
        "reliability_dnf_mult": 1.75,
        "sc_chance_mult": 0.55,
        "vsc_enabled": False,
        "dirty_air_mult": 0.62,
        "slipstream_bonus": 1.12,
        "cost_cap_m": None,
        "summary": "Wide slick tyres & venturi ground effect, 9-6-4-3-2-1 scoring, dramatic mechanical failures & wet chaos.",
    },
    "1980s": {
        "key": "1980s",
        "label": "1980s Turbo Monsters",
        "years": [1980, 1989],
        "chassis_era": "1980s",
        "points": [9, 6, 4, 3, 2, 1],
        "fastest_lap_point": 0,
        "fastest_lap_top_n": 0,
        "sprint_enabled": False,
        "sprint_points": [],
        "refuelling": False,
        "refuel_sec_per_kg": 0.0,
        "start_fuel_kg": 145.0,
        "fuel_burn_per_lap_kg": 2.5,
        "overtake_aid": "turbo_boost",  # Driver-adjustable boost dial (pace vs reliability/fuel)
        "drs_enabled": False,
        "override_mode": False,
        "ers_enabled": False,
        "turbo_boost": True,
        "two_compound_rule": False,
        "tyre_change_allowed": True,
        "mandatory_pit_stop": False,
        "pit_base_s": 7.8,
        "pit_error_chance": 0.08,
        "reliability_dnf_mult": 1.68,
        "sc_chance_mult": 0.65,
        "vsc_enabled": False,
        "dirty_air_mult": 0.85,
        "slipstream_bonus": 1.08,
        "cost_cap_m": None,
        "summary": "1000+ HP Turbo Boost dial (huge push speed at heavy fuel/DNF risk), 9-6-4-3-2-1 scoring, strategic tyre stops.",
    },
    "1990s": {
        "key": "1990s",
        "label": "1990s Refuelling & V10 Screamers",
        "years": [1990, 1999],
        "chassis_era": "1990s",
        "points": [10, 6, 4, 3, 2, 1],
        "fastest_lap_point": 0,
        "fastest_lap_top_n": 0,
        "sprint_enabled": False,
        "sprint_points": [],
        "refuelling": True,
        "refuel_sec_per_kg": 0.11,
        "start_fuel_kg": 62.0,
        "fuel_burn_per_lap_kg": 2.4,
        "overtake_aid": "none",
        "drs_enabled": False,
        "override_mode": False,
        "ers_enabled": False,
        "turbo_boost": False,
        "two_compound_rule": False,
        "tyre_change_allowed": True,
        "mandatory_pit_stop": True,
        "pit_base_s": 7.2,
        "pit_error_chance": 0.07,
        "reliability_dnf_mult": 1.38,
        "sc_chance_mult": 0.90,
        "vsc_enabled": False,
        "dirty_air_mult": 1.15,
        "slipstream_bonus": 0.96,
        "cost_cap_m": None,
        "summary": "10-6-4-3-2-1 scoring, strategic mid-race refuelling sprints (light-fuel 2/3-stop vs 1-stop overcut), grooved tyres late era.",
    },
    "2000s": {
        "key": "2000s",
        "label": "2000s V10/V8 Refuelling & Tyre War",
        "years": [2000, 2009],
        "chassis_era": "2000s",
        "points": [10, 8, 6, 5, 4, 3, 2, 1],
        "fastest_lap_point": 0,
        "fastest_lap_top_n": 0,
        "sprint_enabled": False,
        "sprint_points": [],
        "refuelling": True,
        "refuel_sec_per_kg": 0.10,
        "start_fuel_kg": 58.0,
        "fuel_burn_per_lap_kg": 2.3,
        "overtake_aid": "kers",
        "drs_enabled": False,
        "override_mode": False,
        "ers_enabled": True,
        "turbo_boost": False,
        "two_compound_rule": False,
        "tyre_change_allowed": True,
        "mandatory_pit_stop": True,
        "pit_base_s": 6.8,
        "pit_error_chance": 0.055,
        "reliability_dnf_mult": 1.12,
        "sc_chance_mult": 1.0,
        "vsc_enabled": False,
        "dirty_air_mult": 1.28,
        "slipstream_bonus": 0.94,
        "cost_cap_m": None,
        "summary": "Top-8 scoring (10-8-6-5-4-3-2-1), light-fuel refuelling sprints, heavy aero wake, overcut/undercut pit battles.",
    },
    "2010s": {
        "key": "2010s",
        "label": "2010s DRS & Turbo-Hybrid Era",
        "years": [2010, 2021],
        "chassis_era": "2010s",
        "points": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
        "fastest_lap_point": 1,
        "fastest_lap_top_n": 10,
        "sprint_enabled": False,
        "sprint_points": [],
        "refuelling": False,
        "refuel_sec_per_kg": 0.0,
        "start_fuel_kg": 105.0,
        "fuel_burn_per_lap_kg": 1.85,
        "overtake_aid": "drs",
        "drs_enabled": True,
        "override_mode": False,
        "ers_enabled": True,
        "turbo_boost": False,
        "two_compound_rule": True,
        "tyre_change_allowed": True,
        "mandatory_pit_stop": True,
        "pit_base_s": 2.6,
        "pit_error_chance": 0.04,
        "reliability_dnf_mult": 0.85,
        "sc_chance_mult": 1.0,
        "vsc_enabled": True,
        "dirty_air_mult": 1.18,
        "slipstream_bonus": 1.0,
        "cost_cap_m": 145.0,
        "summary": "Refuelling banned, DRS (<1.0s) + V6 Hybrid ERS, 2-Compound Dry Rule, 25-18-15…1 (+1 FL in Top 10), VSC introduced.",
    },
    "2022_25": {
        "key": "2022_25",
        "label": "2022–2025 Ground Effect & Sprint Era",
        "years": [2022, 2025],
        "chassis_era": "2020s",
        "points": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
        "fastest_lap_point": 1,
        "fastest_lap_top_n": 10,
        "sprint_enabled": True,
        "sprint_points": [8, 7, 6, 5, 4, 3, 2, 1],
        "refuelling": False,
        "refuel_sec_per_kg": 0.0,
        "start_fuel_kg": 105.0,
        "fuel_burn_per_lap_kg": 1.75,
        "overtake_aid": "drs",
        "drs_enabled": True,
        "override_mode": False,
        "ers_enabled": True,
        "turbo_boost": False,
        "two_compound_rule": True,
        "tyre_change_allowed": True,
        "mandatory_pit_stop": True,
        "pit_base_s": 2.35,
        "pit_error_chance": 0.032,
        "reliability_dnf_mult": 0.68,
        "sc_chance_mult": 1.0,
        "vsc_enabled": True,
        "dirty_air_mult": 0.88,
        "slipstream_bonus": 1.02,
        "cost_cap_m": 135.0,
        "summary": "Ground-effect closer following, 18\" Pirelli tyres, DRS + ERS, Sprint weekends, $135M FIA Cost Cap, 2.3s stops.",
    },
    "2026": {
        "key": "2026",
        "label": "2026 Active Aero & Manual Override",
        "years": [2026, 2030],
        "chassis_era": "2020s",
        "points": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
        "fastest_lap_point": 0,  # Removed from 2025+
        "fastest_lap_top_n": 0,
        "sprint_enabled": True,
        "sprint_points": [8, 7, 6, 5, 4, 3, 2, 1],
        "refuelling": False,
        "refuel_sec_per_kg": 0.0,
        "start_fuel_kg": 100.0,
        "fuel_burn_per_lap_kg": 1.65,
        "overtake_aid": "override",  # Active Aero X/Z + Manual Override (+0.5MJ ERS <1.0s)
        "drs_enabled": False,
        "override_mode": True,
        "ers_enabled": True,
        "turbo_boost": False,
        "two_compound_rule": True,
        "tyre_change_allowed": True,
        "mandatory_pit_stop": True,
        "pit_base_s": 2.25,
        "pit_error_chance": 0.03,
        "reliability_dnf_mult": 0.74,
        "sc_chance_mult": 1.0,
        "vsc_enabled": True,
        "dirty_air_mult": 0.78,
        "slipstream_bonus": 1.05,
        "cost_cap_m": 135.0,
        "summary": "50/50 350kW MGU-K hybrid, Active Aero (X/Z Mode), Manual Override (+0.5MJ <1.0s replacing DRS), nimble 1900mm cars.",
    },
}

ERA_ORDER: list[str] = ["2026", "2022_25", "2010s", "2000s", "1990s", "1980s", "1970s", "1960s", "1950s"]


def era_key_for_year(year: int | str | None) -> str:
    if isinstance(year, str):
        s = year.strip().lower()
        if s in ERA_RULES:
            return s
        if s == "legends":
            return "2026"
        try:
            y = int(s[:4])
        except ValueError:
            return "2026"
    elif isinstance(year, int):
        y = year
    else:
        return "2026"

    if y >= 2026:
        return "2026"
    if y >= 2022:
        return "2022_25"
    if y >= 2010:
        return "2010s"
    if y >= 2000:
        return "2000s"
    if y >= 1990:
        return "1990s"
    if y >= 1980:
        return "1980s"
    if y >= 1970:
        return "1970s"
    if y >= 1960:
        return "1960s"
    return "1950s"


def get_era_rules(era_or_year: int | str | None, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    key = era_key_for_year(era_or_year)
    rules = dict(ERA_RULES[key])
    rules["points"] = list(rules["points"])
    rules["sprint_points"] = list(rules["sprint_points"])
    if overrides:
        for k, v in overrides.items():
            if k in rules and v is not None:
                rules[k] = v
    return rules


def list_era_rules() -> list[dict[str, Any]]:
    return [get_era_rules(k) for k in ERA_ORDER]


def points_for_position(rules: dict[str, Any] | str, pos: int, *, is_fastest_lap: bool = False, is_sprint: bool = False) -> int:
    if isinstance(rules, str):
        rules = get_era_rules(rules)
    if pos < 1:
        return 0
    table = rules.get("sprint_points") if is_sprint else rules.get("points")
    pts = int(table[pos - 1]) if table and pos <= len(table) else 0
    if not is_sprint and is_fastest_lap:
        fl_pt = int(rules.get("fastest_lap_point") or 0)
        fl_top = int(rules.get("fastest_lap_top_n") or 10)
        if fl_pt > 0 and pos <= fl_top:
            pts += fl_pt
    return pts
