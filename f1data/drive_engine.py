"""Apex POV (/drive) — Physics Calibration, F1DB Grid/Ghost Builder, Driver Career & Career/Ladder Bridge.

Single source of truth for:
  1. Per-era & per-tier vehicle physics DNA (power, mass, Cl/Cd, ERS, DRS, X-Mode, gears, RPM, tyres)
  2. Real F1DB + rating_engine calibrated 20-car grids across 1950–2026 & all 79 GPS circuits
  3. F1DB Reference Ghost target lap time & sector split calibration
  4. Persistent POV Driver Career (WDC/WCC standings, Teammate H2H, Acclaim, Rivals & Contracts)
  5. Bidirectional "Take the Wheel" bridge for /career and /ladder saves
"""
from __future__ import annotations

import random
import re
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

from .circuits import CIRCUITS, get_circuit
from .era_rules import ERA_RULES, era_key_for_year
from .f1_car_palettes import CAR_PNG_DIR, find_car_png_slug, load_png_manifest
from .rating_engine import compute_fair_attributes
from .weather_radar import build_weather_radar_and_pit_plan

_BASE_DIR = Path(__file__).resolve().parent.parent
_F1_SQLITE = _BASE_DIR / "data" / "f1.sqlite"

# =============================================================================
# 1. ERA & TIER VEHICLE PHYSICS DNA (Calibrated for 120 Hz Pacejka Engine)
# =============================================================================

DRIVE_PHYSICS_DNA: dict[str, dict[str, Any]] = {
    "1950s": {
        "era_key": "1950s", "label": "1950s Front-Engine Classic", "chassis_era": "1950s",
        "max_power_kw": 215, "ers_power_kw": 0, "ers_mj_lap": 0.0, "mass_kg": 660,
        "cl_base": 0.35, "cd_base": 0.62, "drs_enabled": False, "active_aero": False,
        "drs_drag_cut": 0.0, "x_mode_drag_cut": 0.0, "halo": False,
        "gears": 5, "redline_rpm": 8200, "idle_rpm": 2200, "top_speed_kph": 275,
        "brake_max_g": 1.65, "tyre_mu_base": 1.25, "audio_profile": "classic_na",
        "pace_mult": 1.24,
    },
    "1960s": {
        "era_key": "1960s", "label": "1960s Cigar & DFV", "chassis_era": "1960s",
        "max_power_kw": 305, "ers_power_kw": 0, "ers_mj_lap": 0.0, "mass_kg": 540,
        "cl_base": 0.75, "cd_base": 0.68, "drs_enabled": False, "active_aero": False,
        "drs_drag_cut": 0.0, "x_mode_drag_cut": 0.0, "halo": False,
        "gears": 5, "redline_rpm": 10200, "idle_rpm": 2600, "top_speed_kph": 295,
        "brake_max_g": 2.15, "tyre_mu_base": 1.42, "audio_profile": "dfv_v8",
        "pace_mult": 1.18,
    },
    "1970s": {
        "era_key": "1970s", "label": "1970s Slicks & Ground Effect", "chassis_era": "1970s",
        "max_power_kw": 365, "ers_power_kw": 0, "ers_mj_lap": 0.0, "mass_kg": 590,
        "cl_base": 1.95, "cd_base": 0.84, "drs_enabled": False, "active_aero": False,
        "drs_drag_cut": 0.0, "x_mode_drag_cut": 0.0, "halo": False,
        "gears": 6, "redline_rpm": 11500, "idle_rpm": 3000, "top_speed_kph": 308,
        "brake_max_g": 2.85, "tyre_mu_base": 1.62, "audio_profile": "dfv_v8",
        "pace_mult": 1.12,
    },
    "1980s": {
        "era_key": "1980s", "label": "1980s Turbo Monsters", "chassis_era": "1980s",
        "max_power_kw": 620, "ers_power_kw": 110, "ers_mj_lap": 3.0, "mass_kg": 560,
        "cl_base": 2.75, "cd_base": 0.92, "drs_enabled": False, "active_aero": False,
        "drs_drag_cut": 0.0, "x_mode_drag_cut": 0.0, "halo": False, "turbo_boost": True,
        "gears": 6, "redline_rpm": 12800, "idle_rpm": 3400, "top_speed_kph": 340,
        "brake_max_g": 3.65, "tyre_mu_base": 1.75, "audio_profile": "turbo_v6",
        "pace_mult": 1.07,
    },
    "1990s": {
        "era_key": "1990s", "label": "1990s V10 Screamers", "chassis_era": "1990s",
        "max_power_kw": 595, "ers_power_kw": 0, "ers_mj_lap": 0.0, "mass_kg": 600,
        "cl_base": 3.15, "cd_base": 0.95, "drs_enabled": False, "active_aero": False,
        "drs_drag_cut": 0.0, "x_mode_drag_cut": 0.0, "halo": False,
        "gears": 6, "redline_rpm": 17500, "idle_rpm": 4200, "top_speed_kph": 338,
        "brake_max_g": 4.25, "tyre_mu_base": 1.86, "audio_profile": "v10_scream",
        "pace_mult": 1.04,
    },
    "2000s": {
        "era_key": "2000s", "label": "2000s 19,000 RPM V10 Peak", "chassis_era": "2000s",
        "max_power_kw": 685, "ers_power_kw": 0, "ers_mj_lap": 0.0, "mass_kg": 605,
        "cl_base": 3.55, "cd_base": 0.98, "drs_enabled": False, "active_aero": False,
        "drs_drag_cut": 0.0, "x_mode_drag_cut": 0.0, "halo": False,
        "gears": 7, "redline_rpm": 19000, "idle_rpm": 4500, "top_speed_kph": 352,
        "brake_max_g": 4.75, "tyre_mu_base": 1.92, "audio_profile": "v10_scream",
        "pace_mult": 1.01,
    },
    "2010s": {
        "era_key": "2010s", "label": "2010s DRS & Hybrid V6", "chassis_era": "2010s",
        "max_power_kw": 635, "ers_power_kw": 120, "ers_mj_lap": 4.0, "mass_kg": 740,
        "cl_base": 3.70, "cd_base": 0.96, "drs_enabled": True, "active_aero": False,
        "drs_drag_cut": 0.24, "x_mode_drag_cut": 0.0, "halo": True,
        "gears": 8, "redline_rpm": 13200, "idle_rpm": 3600, "top_speed_kph": 344,
        "brake_max_g": 4.95, "tyre_mu_base": 1.98, "audio_profile": "hybrid_v6",
        "pace_mult": 1.01,
    },
    "2020s": {
        "era_key": "2020s", "label": "2022–25 Ground-Effect F1", "chassis_era": "2020s",
        "max_power_kw": 650, "ers_power_kw": 120, "ers_mj_lap": 4.0, "mass_kg": 798,
        "cl_base": 4.10, "cd_base": 0.94, "drs_enabled": True, "active_aero": False,
        "drs_drag_cut": 0.25, "x_mode_drag_cut": 0.0, "halo": True,
        "gears": 8, "redline_rpm": 13000, "idle_rpm": 3600, "top_speed_kph": 348,
        "brake_max_g": 5.20, "tyre_mu_base": 2.04, "audio_profile": "hybrid_v6",
        "pace_mult": 1.00,
    },
    "2026": {
        "era_key": "2026", "label": "2026 Active Aero & 350kW Hybrid", "chassis_era": "2020s",
        "max_power_kw": 550, "ers_power_kw": 220, "ers_mj_lap": 4.5, "mass_kg": 768,
        "cl_base": 3.65, "cd_base": 0.86, "drs_enabled": True, "active_aero": True,
        "drs_drag_cut": 0.26, "x_mode_drag_cut": 0.22, "halo": True,
        "gears": 8, "redline_rpm": 13200, "idle_rpm": 3600, "top_speed_kph": 356,
        "brake_max_g": 5.15, "tyre_mu_base": 2.02, "audio_profile": "hybrid_v6",
        "pace_mult": 1.00,
    },
    # Ladder Feeder Tier Specs (for "Take the Wheel" from /ladder!)
    "karting": {
        "era_key": "karting", "label": "World Karting KZ 125cc", "chassis_era": "1960s",
        "max_power_kw": 38, "ers_power_kw": 0, "ers_mj_lap": 0.0, "mass_kg": 175,
        "cl_base": 0.12, "cd_base": 0.55, "drs_enabled": False, "active_aero": False,
        "drs_drag_cut": 0.0, "x_mode_drag_cut": 0.0, "halo": False,
        "gears": 6, "redline_rpm": 14500, "idle_rpm": 3500, "top_speed_kph": 165,
        "brake_max_g": 1.95, "tyre_mu_base": 1.65, "audio_profile": "kart_2stroke",
        "pace_mult": 1.48,
    },
    "f4": {
        "era_key": "f4", "label": "FIA Formula 4 Tatuus", "chassis_era": "2020s",
        "max_power_kw": 132, "ers_power_kw": 0, "ers_mj_lap": 0.0, "mass_kg": 570,
        "cl_base": 1.45, "cd_base": 0.76, "drs_enabled": False, "active_aero": False,
        "drs_drag_cut": 0.0, "x_mode_drag_cut": 0.0, "halo": True,
        "gears": 6, "redline_rpm": 7400, "idle_rpm": 2000, "top_speed_kph": 238,
        "brake_max_g": 2.65, "tyre_mu_base": 1.62, "audio_profile": "classic_na",
        "pace_mult": 1.24,
    },
    "f3": {
        "era_key": "f3", "label": "FIA Formula 3 Dallara", "chassis_era": "2020s",
        "max_power_kw": 285, "ers_power_kw": 0, "ers_mj_lap": 0.0, "mass_kg": 673,
        "cl_base": 2.35, "cd_base": 0.84, "drs_enabled": True, "active_aero": False,
        "drs_drag_cut": 0.18, "x_mode_drag_cut": 0.0, "halo": True,
        "gears": 6, "redline_rpm": 8800, "idle_rpm": 2400, "top_speed_kph": 292,
        "brake_max_g": 3.45, "tyre_mu_base": 1.78, "audio_profile": "dfv_v8",
        "pace_mult": 1.14,
    },
    "f2": {
        "era_key": "f2", "label": "FIA Formula 2 620hp Turbo", "chassis_era": "2020s",
        "max_power_kw": 462, "ers_power_kw": 0, "ers_mj_lap": 0.0, "mass_kg": 755,
        "cl_base": 3.10, "cd_base": 0.88, "drs_enabled": True, "active_aero": False,
        "drs_drag_cut": 0.21, "x_mode_drag_cut": 0.0, "halo": True,
        "gears": 6, "redline_rpm": 9200, "idle_rpm": 2600, "top_speed_kph": 326,
        "brake_max_g": 4.20, "tyre_mu_base": 1.88, "audio_profile": "turbo_v6",
        "pace_mult": 1.07,
    },
}

DEFAULT_2026_TEAMS: list[tuple[str, str, int, list[tuple[str, str, int]]]] = [
    ("McLaren", "#ff8000", 95, [("Lando Norris", "NOR", 4), ("Oscar Piastri", "PIA", 81)]),
    ("Ferrari", "#e10600", 93, [("Charles Leclerc", "LEC", 16), ("Lewis Hamilton", "HAM", 44)]),
    ("Red Bull Racing", "#1e41ff", 92, [("Max Verstappen", "VER", 1), ("Liam Lawson", "LAW", 30)]),
    ("Mercedes", "#00d2be", 91, [("George Russell", "RUS", 63), ("Kimi Antonelli", "ANT", 12)]),
    ("Aston Martin", "#006f62", 86, [("Fernando Alonso", "ALO", 14), ("Lance Stroll", "STR", 18)]),
    ("Williams", "#005aff", 85, [("Carlos Sainz", "SAI", 55), ("Alex Albon", "ALB", 23)]),
    ("Alpine", "#ff87bc", 83, [("Pierre Gasly", "GAS", 10), ("Jack Doohan", "DOO", 7)]),
    ("Haas", "#cbd5e1", 82, [("Esteban Ocon", "OCO", 31), ("Oliver Bearman", "BEA", 87)]),
    ("Racing Bulls", "#3b82f6", 82, [("Yuki Tsunoda", "TSU", 22), ("Isack Hadjar", "HAD", 6)]),
    ("Audi", "#dc2626", 81, [("Nico Hulkenberg", "HUL", 27), ("Gabriel Bortoleto", "BOR", 5)]),
]

TYRE_COMPOUNDS = {
    "soft":   {"code": "S", "name": "Soft",         "color": "#ef4444", "grip": 1.045, "wear_rate": 1.45, "opt_temp": 100, "wet_grip": 0.42},
    "medium": {"code": "M", "name": "Medium",       "color": "#facc15", "grip": 1.000, "wear_rate": 1.00, "opt_temp": 96,  "wet_grip": 0.44},
    "hard":   {"code": "H", "name": "Hard",         "color": "#f8fafc", "grip": 0.965, "wear_rate": 0.66, "opt_temp": 92,  "wet_grip": 0.45},
    "inter":  {"code": "I", "name": "Intermediate", "color": "#22c55e", "grip": 0.910, "wear_rate": 0.95, "opt_temp": 84,  "wet_grip": 0.88},
    "wet":    {"code": "W", "name": "Full Wet",     "color": "#3b82f6", "grip": 0.855, "wear_rate": 0.78, "opt_temp": 76,  "wet_grip": 0.96},
}

DRIVER_CAREER_CALENDAR = [
    "melbourne", "bahrain", "suzuka", "imola", "monaco",
    "montreal", "silverstone", "spa", "monza", "singapore", "interlagos", "abudhabi",
]

FIA_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else (hi if v > hi else v)


def _resolve_car_icon(team_name: str, year: int = 2026) -> str | None:
    slug = find_car_png_slug(team_name, year=year)
    if not slug:
        return None
    manifest = load_png_manifest()
    canon = manifest.get(slug, slug)
    if (CAR_PNG_DIR / f"{canon}.png").is_file():
        return f"/static/cars/png/{slug}.png"
    return None


def _parse_lap_record_ms(lap_rec: str | None, fallback_s: float) -> int:
    """Parse '1:19.813 (Leclerc, 2024)' -> 79813 ms."""
    if lap_rec:
        m = re.search(r"(\d+):(\d{2})\.(\d{2,3})", str(lap_rec))
        if m:
            mins = int(m.group(1))
            secs = int(m.group(2))
            ms_str = m.group(3).ljust(3, "0")[:3]
            return (mins * 60 + secs) * 1000 + int(ms_str)
    return int(round(max(45.0, float(fallback_s or 82.0)) * 1000))


def _resolve_era_dna(era_key: str | None, year: int | None = None) -> dict[str, Any]:
    if era_key and era_key in DRIVE_PHYSICS_DNA:
        return dict(DRIVE_PHYSICS_DNA[era_key])
    if year is not None:
        ek = era_key_for_year(int(year))
        if ek in DRIVE_PHYSICS_DNA:
            return dict(DRIVE_PHYSICS_DNA[ek])
    return dict(DRIVE_PHYSICS_DNA["2026"])


def _era_default_year(era_key: str) -> int:
    mapping = {
        "1950s": 1955, "1960s": 1967, "1970s": 1976, "1980s": 1988,
        "1990s": 1998, "2000s": 2004, "2010s": 2018, "2020s": 2024, "2026": 2026,
    }
    return mapping.get(era_key, 2026)


def _load_season_grid_from_db(year: int) -> list[dict[str, Any]]:
    """Build up to 20 real F1 drivers for a given season from f1.sqlite + rating_engine."""
    if not _F1_SQLITE.exists():
        return []
    try:
        con = sqlite3.connect(str(_F1_SQLITE))
        con.row_factory = sqlite3.Row
        rows = con.execute(
            """
            SELECT driver, team, points, position
            FROM drivers_standings
            WHERE year = ?
            ORDER BY CASE WHEN position GLOB '[0-9]*' THEN CAST(position AS INTEGER) ELSE 99 END ASC,
                     points DESC
            LIMIT 20
            """,
            (int(year),),
        ).fetchall()
        con.close()
    except Exception:
        return []
    if len(rows) < 6:
        return []

    palette_fallback = [
        "#ff8000", "#e10600", "#1e41ff", "#00d2be", "#006f62",
        "#005aff", "#ff87bc", "#cbd5e1", "#3b82f6", "#22c55e",
    ]
    team_colors: dict[str, str] = {}
    out: list[dict[str, Any]] = []
    for idx, r in enumerate(rows):
        raw_name = str(r["driver"] or "").strip()
        parts = raw_name.split()
        code3 = parts[-1].upper() if len(parts) >= 2 and len(parts[-1]) == 3 and parts[-1].isupper() else (parts[-1][:3].upper() if parts else f"D{idx+1:02d}")
        clean_name = " ".join(parts[:-1]) if len(parts) >= 2 and len(parts[-1]) == 3 and parts[-1].isupper() else raw_name
        team = str(r["team"] or "Privateer").strip()
        if team not in team_colors:
            team_colors[team] = palette_fallback[len(team_colors) % len(palette_fallback)]
        try:
            rat = compute_fair_attributes({"driver": raw_name, "clean_name": clean_name}, year=year)
            st = rat.get("stats") or {}
            car_rtg = int(round(_clamp(float(rat.get("car_strength_est") or 82.0), 68, 98)))
            pace = int(round(_clamp(float(st.get("pace") or 80), 62, 99)))
            racecraft = int(round(_clamp(float(st.get("racecraft") or 80), 62, 99)))
            wet = int(round(_clamp(float(st.get("wet") or 78), 60, 99)))
            tyre_care = int(round(_clamp(float(st.get("tyre_care") or 78), 60, 99)))
            consistency = int(round(_clamp(float(st.get("reliability") or 80), 60, 99)))
            ovr = int(round(_clamp(float(rat.get("fair_overall") or 82), 65, 99)))
        except Exception:
            car_rtg = max(72, 94 - idx)
            pace = racecraft = wet = tyre_care = consistency = ovr = max(72, 92 - idx)

        out.append({
            "driver_id": f"drv_{idx+1}_{code3.lower()}",
            "name": clean_name or raw_name,
            "code3": code3,
            "number": (idx + 1) * 3 % 98 + 1,
            "team": team,
            "color": team_colors[team],
            "car_rating": car_rtg,
            "overall": ovr,
            "pace": pace,
            "racecraft": racecraft,
            "wet": wet,
            "tyre_care": tyre_care,
            "consistency": consistency,
            "is_player": False,
            "car_icon_url": _resolve_car_icon(team, year=year),
        })
    # Pad classic 1950s/1960s seasons (where only Top 5 scored points) up to a full 20-car grid
    if len(out) < 20:
        fallback = _build_default_2026_grid()
        used_codes = {g["code3"] for g in out}
        for fb in fallback:
            if len(out) >= 20:
                break
            if fb["code3"] in used_codes:
                continue
            used_codes.add(fb["code3"])
            out.append({
                **fb,
                "driver_id": f"classic_res_{len(out)+1}",
                "car_rating": max(68, fb["car_rating"] - 10),
                "pace": max(68, fb["pace"] - 8),
            })
    return out


def _build_default_2026_grid() -> list[dict[str, Any]]:
    grid: list[dict[str, Any]] = []
    for t_idx, (team, col, car_rtg, drivers) in enumerate(DEFAULT_2026_TEAMS):
        icon = _resolve_car_icon(team, year=2026)
        for d_idx, (name, code3, num) in enumerate(drivers):
            try:
                rat = compute_fair_attributes({"driver": name, "clean_name": name}, year=2026)
                st = rat.get("stats") or {}
                pace = int(round(_clamp(float(st.get("pace") or 82), 68, 99)))
                racecraft = int(round(_clamp(float(st.get("racecraft") or 82), 68, 99)))
                wet = int(round(_clamp(float(st.get("wet") or 80), 65, 99)))
                tyre_care = int(round(_clamp(float(st.get("tyre_care") or 80), 65, 99)))
                consistency = int(round(_clamp(float(st.get("reliability") or 82), 65, 99)))
                ovr = int(round(_clamp(float(rat.get("fair_overall") or 84), 70, 99)))
            except Exception:
                base = max(76, 94 - t_idx * 2 - d_idx)
                pace = racecraft = wet = tyre_care = consistency = ovr = base
            grid.append({
                "driver_id": f"f1_{code3.lower()}",
                "name": name,
                "code3": code3,
                "number": num,
                "team": team,
                "color": col,
                "car_rating": car_rtg,
                "overall": ovr,
                "pace": pace,
                "racecraft": racecraft,
                "wet": wet,
                "tyre_care": tyre_care,
                "consistency": consistency,
                "is_player": False,
                "car_icon_url": icon,
            })
    return grid


def build_drive_session_config(
    base_dir: Path,
    *,
    circuit_id: str = "melbourne",
    era_key: str = "2026",
    year: int | None = None,
    player_team: str = "McLaren",
    player_name: str = "Alex Vance",
    player_code3: str = "VAN",
    player_number: int = 27,
    mode: str = "timetrial",
    weather_mode: str = "dry",
    laps: int | None = None,
    source: str | None = None,
    ref_id: str | None = None,
) -> dict[str, Any]:
    """Assemble a complete, F1DB-calibrated POV driving session configuration."""
    from . import drive_db as ddb

    bridge_meta: dict[str, Any] | None = None
    if source in ("ladder", "career") and ref_id:
        bridge = load_bridge_session(base_dir, source=source, ref_id=ref_id)
        if bridge:
            return bridge

    cir = get_circuit(circuit_id) or (CIRCUITS[0] if CIRCUITS else {"id": "melbourne", "name": "Albert Park", "base_lap_s": 79.8, "length_km": 5.278, "points": []})
    dna = _resolve_era_dna(era_key, year=year)
    eff_era = dna["era_key"]
    eff_year = int(year) if year is not None else _era_default_year(eff_era)

    # Build real F1DB/rating_engine grid
    grid = _load_season_grid_from_db(eff_year) if eff_year <= 2025 else []
    if not grid:
        grid = _build_default_2026_grid()

    # Place player in seat #1 of their chosen team (or prepend if custom team)
    player_idx = next((i for i, g in enumerate(grid) if player_team.lower() in g["team"].lower() or g["team"].lower() in player_team.lower()), 0)
    p_slot = dict(grid[player_idx])
    p_slot.update({
        "driver_id": "player",
        "name": player_name[:32] or "Alex Vance",
        "code3": (player_code3[:3] or "VAN").upper(),
        "number": int(player_number or 27),
        "is_player": True,
    })
    grid[player_idx] = p_slot

    # Sort grid cleanly (by car_rating + pace for GP; player starts P10 in Quick GP or pole in Time Trial)
    if mode == "timetrial":
        grid = [p_slot]
    else:
        ai_only = [g for g in grid if not g["is_player"]]
        ai_only.sort(key=lambda x: -(x["car_rating"] * 0.55 + x["pace"] * 0.45))
        insert_pos = min(len(ai_only), 9 if mode == "gp" else max(0, min(len(ai_only), 19 - int((p_slot["car_rating"] - 76) * 0.7))))
        grid = ai_only[:insert_pos] + [p_slot] + ai_only[insert_pos:]
    for pos_i, g in enumerate(grid, start=1):
        g["grid_pos"] = pos_i

    # F1DB Reference Lap Target (adjusted by era pace multiplier)
    base_rec_ms = _parse_lap_record_ms(cir.get("lap_record"), float(cir.get("base_lap_s") or 82.0))
    f1db_target_lap_ms = int(round(base_rec_ms * float(dna.get("pace_mult") or 1.0)))

    # Personal Best & Ghost from SQLite
    pb = ddb.load_time_trial(base_dir, cir["id"], eff_era)

    # Live Weather Radar plan
    race_laps = int(laps) if laps else (5 if mode == "gp" else (8 if mode == "weekend" else 99))
    w_radar = build_weather_radar_and_pit_plan(
        cir,
        mode="rain" if weather_mode == "rain" else ("dynamic" if weather_mode == "dynamic" else "dry"),
        laps=max(3, min(30, race_laps)),
        intel_pct=85,
        tyre_care=82.0,
    )

    return {
        "ok": True,
        "mode": mode,
        "circuit": cir,
        "era_key": eff_era,
        "year": eff_year,
        "physics_dna": dna,
        "tyre_compounds": TYRE_COMPOUNDS,
        "weather_mode": weather_mode,
        "weather_radar": w_radar,
        "laps": race_laps,
        "grid": grid,
        "player_driver": p_slot,
        "f1db_target_lap_ms": f1db_target_lap_ms,
        "personal_best": pb,
        "bridge": bridge_meta,
    }


# =============================================================================
# 2. "TAKE THE WHEEL" BRIDGE (/ladder & /career -> /drive -> commit back!)
# =============================================================================

def load_bridge_session(base_dir: Path, *, source: str, ref_id: str) -> dict[str, Any] | None:
    """Load an active /ladder or /career race weekend directly into /drive."""
    if source == "ladder":
        from . import ladder_db as ldb
        from . import ladder_engine as leng

        st = ldb.load_save(base_dir, ref_id)
        if not st:
            return None
        wk = st.get("weekend") or {}
        if not wk.get("quali_done"):
            leng.run_qualifying(st, tactic=wk.get("quali_tactic", "clean_air"))
            ldb.save_state(base_dir, st)
            wk = st["weekend"]
        tier = str(st.get("tier") or "f1")
        cir = get_circuit(wk.get("circuit_id") or "monza") or CIRCUITS[0]
        dna = _resolve_era_dna(tier if tier in DRIVE_PHYSICS_DNA else "2026")
        raw_grid = wk.get("quali_grid") or []
        player_assigned = False
        grid = []
        for idx, g in enumerate(raw_grid, start=1):
            is_me = bool(g.get("is_player")) and not player_assigned
            if is_me:
                player_assigned = True
            stats = g.get("stats") or {}
            grid.append({
                "driver_id": g["driver_id"],
                "name": g["name"],
                "code3": g["code3"],
                "number": idx,
                "team": g["team"],
                "color": g.get("color") or "#e10600",
                "car_rating": int(round(float(g.get("car_rating") or 78))),
                "overall": int(round(float(g.get("overall") or 78))),
                "pace": int(round(float(stats.get("pace") or 78))),
                "racecraft": int(round(float(stats.get("racecraft") or 78))),
                "wet": int(round(float(stats.get("wet") or 76))),
                "tyre_care": int(round(float(stats.get("tyre_care") or 76))),
                "consistency": int(round(float(stats.get("consistency") or 76))),
                "is_player": is_me,
                "is_teammate": bool(g.get("is_player")) and not is_me,
                "grid_pos": idx,
                "car_icon_url": _resolve_car_icon(g["team"], year=int(st.get("year") or 2026)) if tier == "f1" else None,
            })
        p_slot = next((x for x in grid if x["is_player"]), grid[0] if grid else None)
        if not p_slot:
            return None
        laps = max(3, min(12, int(wk.get("laps") or 6)))
        w_mode = str(wk.get("weather_mode") or "dry")
        return {
            "ok": True,
            "mode": "bridge",
            "circuit": cir,
            "era_key": dna["era_key"],
            "year": int(st.get("year") or 2026),
            "physics_dna": dna,
            "tyre_compounds": TYRE_COMPOUNDS,
            "weather_mode": w_mode,
            "weather_radar": wk.get("weather_radar") or build_weather_radar_and_pit_plan(cir, mode=w_mode, laps=laps),
            "laps": laps,
            "grid": grid,
            "player_driver": p_slot,
            "f1db_target_lap_ms": int(round(_parse_lap_record_ms(cir.get("lap_record"), float(cir.get("base_lap_s") or 82.0)) * dna["pace_mult"])),
            "personal_best": None,
            "bridge": {
                "source": "ladder",
                "ref_id": ref_id,
                "label": f"Ladder {tier.upper()} S{st.get('season', 1)} R{st.get('round', 1)} · {st['player']['team_name']}",
                "return_url": "/ladder",
                "commit_url": f"/api/ladder/{ref_id}/race/commit",
            },
        }

    if source == "career":
        from . import career_db as cdb
        slot = cdb.load_slot(base_dir, ref_id)
        if not slot:
            return None
        cal = slot.get("calendar") or []
        rd_idx = max(0, min(len(cal) - 1, int(slot.get("current_round") or 1) - 1))
        cal_item = cal[rd_idx] if cal else {"circuit_id": "melbourne"}
        cir = get_circuit(cal_item.get("circuit_id") or "melbourne") or CIRCUITS[0]
        era = str(slot.get("era") or "2026")
        dna = _resolve_era_dna(era)
        team_name = str(slot.get("team_name") or "McLaren")
        drivers_raw = slot.get("drivers") or []
        p_name = str(drivers_raw[0].get("name") if drivers_raw else "Player Driver")
        cfg = build_drive_session_config(
            base_dir,
            circuit_id=cir["id"],
            era_key=dna["era_key"],
            player_team=team_name,
            player_name=p_name,
            player_code3=(p_name.split()[-1][:3].upper() if p_name else "DRV"),
            mode="gp",
            laps=5,
        )
        cfg["mode"] = "bridge"
        cfg["bridge"] = {
            "source": "career",
            "ref_id": ref_id,
            "label": f"Career S{slot.get('season_num', 1)} R{slot.get('current_round', 1)} · {team_name}",
            "return_url": "/career",
            "commit_url": None,  # Career commits via /career weekend screen; result shown with return button
        }
        return cfg
    return None


# =============================================================================
# 3. PERSISTENT POV DRIVER CAREER ENGINE (Phase 3)
# =============================================================================

def build_new_driver_career(
    *,
    driver_name: str = "Alex Vance",
    driver_number: int = 27,
    team_name: str = "Williams",
    era_key: str = "2026",
    helmet_color: str = "#38bdf8",
    season_rounds: int = 10,
) -> dict[str, Any]:
    """Create a fresh persistent POV Driver Career save."""
    dna = _resolve_era_dna(era_key)
    eff_era = dna["era_key"]
    eff_year = _era_default_year(eff_era)
    grid = _build_default_2026_grid()
    code3 = re.sub(r"[^A-Za-z]", "", (driver_name.split()[-1] if driver_name.strip() else "VAN"))[:3].upper() or "VAN"

    # Replace seat #2 of chosen team with the player so seat #1 is their benchmark teammate!
    team_indices = [i for i, g in enumerate(grid) if team_name.lower() in g["team"].lower() or g["team"].lower() in team_name.lower()]
    if not team_indices:
        team_indices = [10, 11]  # Williams default
    replace_idx = team_indices[-1]
    teammate_idx = team_indices[0] if len(team_indices) > 1 else (replace_idx - 1 if replace_idx > 0 else 1)

    tm_slot = grid[replace_idx]
    teammate = grid[teammate_idx]
    grid[replace_idx] = {
        **tm_slot,
        "driver_id": "player",
        "name": driver_name[:32] or "Alex Vance",
        "code3": code3,
        "number": int(driver_number or 27),
        "is_player": True,
        "points": 0.0,
        "wins": 0,
        "podiums": 0,
    }
    for g in grid:
        g.setdefault("points", 0.0)
        g.setdefault("wins", 0)
        g.setdefault("podiums", 0)

    cal_ids = DRIVER_CAREER_CALENDAR[:max(4, min(12, int(season_rounds)))]
    calendar = []
    rng = random.Random(hash((driver_name, team_name, eff_era)) & 0xFFFFFFFF)
    for idx, cid in enumerate(cal_ids, start=1):
        c = get_circuit(cid) or CIRCUITS[0]
        w_roll = rng.random()
        w_mode = "rain" if w_roll < 0.14 else ("dynamic" if w_roll < 0.34 else "dry")
        calendar.append({
            "round": idx,
            "circuit_id": c["id"],
            "circuit_name": c["name"],
            "gp": c.get("gp") or c["name"],
            "laps": 5,
            "weather_mode": w_mode,
            "completed": False,
            "winner": None,
            "player_pos": None,
        })

    return {
        "save_id": uuid.uuid4().hex[:10],
        "created_at": time.time(),
        "era_key": eff_era,
        "year": eff_year,
        "season": 1,
        "round": 1,
        "phase": "race_ready",  # race_ready | season_end
        "player": {
            "name": driver_name[:32] or "Alex Vance",
            "code3": code3,
            "number": int(driver_number or 27),
            "team": tm_slot["team"],
            "color": tm_slot["color"],
            "helmet_color": helmet_color,
            "teammate_id": teammate["driver_id"],
            "teammate_name": teammate["name"],
            "points": 0.0,
            "wins": 0,
            "podiums": 0,
            "poles": 0,
            "fastest_laps": 0,
            "acclaim": 18,
            "h2h_wins": 0,
            "h2h_losses": 0,
            "rival_id": teammate["driver_id"],
            "rival_name": teammate["name"],
            "tp_trust": 64,
            "team_morale": 70,
            "media_rep": 52,
            "focus": 86,
            "rivalry_heat": 28,
        },
        "grid": grid,
        "calendar": calendar,
        "contract_offers": [],
        "season_history": [],
        "active_buffs": [],
        "completed_commitments": [],
        "story_history": [],
        "inbox": [
            {
                "round": 1,
                "sender": f"{tm_slot['team']} Race Engineer",
                "title": f"Welcome to {tm_slot['team']}, {driver_name}!",
                "body": f"You're paired with {teammate['name']}. Beat your teammate in qualifying and race finishes to raise Driver Acclaim and unlock works-team contract offers.",
            }
        ],
    }


def _generate_contract_offers(state: dict[str, Any]) -> list[dict[str, Any]]:
    acclaim = int(state["player"]["acclaim"])
    cur_team = state["player"]["team"]
    offers = []
    for team, col, rtg, drivers in DEFAULT_2026_TEAMS:
        min_acc = max(10, (rtg - 78) * 5)
        if team == cur_team or acclaim >= min_acc:
            offers.append({
                "team": team,
                "color": col,
                "car_rating": rtg,
                "teammate": drivers[0][0],
                "role": "Lead Driver" if acclaim >= min_acc + 18 else "Race Seat",
                "salary_m": round(max(1.2, (acclaim / 100.0) * 18.0 + (rtg - 80) * 0.4), 1),
                "is_current": team == cur_team,
                "car_icon_url": _resolve_car_icon(team, year=int(state.get("year") or 2026)),
            })
    offers.sort(key=lambda o: (-o["car_rating"], not o["is_current"]))
    return offers[:5]


def commit_driver_career_race(
    state: dict[str, Any],
    *,
    standings: list[dict[str, Any]],
    player_grid_pos: int = 10,
    best_lap_ms: int = 0,
    fastest_lap_driver_id: str | None = None,
) -> dict[str, Any]:
    """Commit a completed POV race into a persistent Driver Career save."""
    cal = state["calendar"]
    rd = int(state["round"])
    cal_idx = max(0, min(len(cal) - 1, rd - 1))
    cal_item = cal[cal_idx]

    by_id = {g["driver_id"]: g for g in state["grid"]}
    player_pos = 20
    teammate_pos = 20
    player_pts = 0.0
    winner_name = ""

    for row in standings:
        did = str(row.get("driver_id") or "")
        pos = int(row.get("pos") or 20)
        dnf = bool(row.get("dnf"))
        drv = by_id.get(did)
        if pos == 1 and not winner_name:
            winner_name = str(row.get("name") or (drv["name"] if drv else "Winner"))
        if not drv:
            continue
        pts = 0.0
        if not dnf and 1 <= pos <= len(FIA_POINTS):
            pts = float(FIA_POINTS[pos - 1])
            if fastest_lap_driver_id == did and pos <= 10:
                pts += 1.0
        drv["points"] = round(float(drv.get("points") or 0.0) + pts, 1)
        if not dnf and pos == 1:
            drv["wins"] = int(drv.get("wins") or 0) + 1
        if not dnf and pos <= 3:
            drv["podiums"] = int(drv.get("podiums") or 0) + 1
        if did == "player":
            player_pos = pos
            player_pts = pts
        elif did == state["player"]["teammate_id"]:
            teammate_pos = pos

    p = state["player"]
    p["points"] = round(float(p["points"]) + player_pts, 1)
    if player_pos == 1:
        p["wins"] += 1
    if player_pos <= 3:
        p["podiums"] += 1
    if player_grid_pos == 1:
        p["poles"] += 1
    if fastest_lap_driver_id == "player":
        p["fastest_laps"] += 1

    beat_teammate = player_pos < teammate_pos
    if beat_teammate:
        p["h2h_wins"] += 1
    else:
        p["h2h_losses"] += 1

    acclaim_delta = (8 if player_pos == 1 else (5 if player_pos <= 3 else (3 if player_pos <= 10 else 0))) + (2 if beat_teammate else -1)
    p["acclaim"] = int(_clamp(p["acclaim"] + acclaim_delta, 5, 99))

    cal_item["completed"] = True
    cal_item["winner"] = winner_name
    cal_item["player_pos"] = player_pos

    season_complete = rd >= len(cal)
    if season_complete:
        state["phase"] = "season_end"
        state["contract_offers"] = _generate_contract_offers(state)
        ordered = sorted(state["grid"], key=lambda x: (-float(x.get("points") or 0), -int(x.get("wins") or 0)))
        wdc_pos = next((i + 1 for i, x in enumerate(ordered) if x["driver_id"] == "player"), 20)
        state["season_history"].insert(0, {
            "season": state["season"],
            "year": state["year"],
            "team": p["team"],
            "wdc_pos": wdc_pos,
            "points": p["points"],
            "champion": ordered[0]["name"] if ordered else winner_name,
        })
        state["inbox"].insert(0, {
            "round": rd,
            "sender": "Driver Manager",
            "title": f"Season {state['season']} Complete — P{wdc_pos} in WDC!",
            "body": f"Finished with {p['points']} pts (Teammate H2H {p['h2h_wins']}–{p['h2h_losses']}, Acclaim {p['acclaim']}). {len(state['contract_offers'])} contract offers are on the table!",
        })
    else:
        state["round"] = rd + 1
        next_c = cal[rd]
        state["inbox"].insert(0, {
            "round": rd,
            "sender": f"{p['team']} Race Engineer",
            "title": f"R{rd} {cal_item['circuit_name']}: P{player_pos} (+{player_pts:.0f} pts)",
            "body": f"{'Beat' if beat_teammate else 'Trailed'} teammate {p['teammate_name']} (P{teammate_pos}). Acclaim {'+' if acclaim_delta >= 0 else ''}{acclaim_delta}. Next up: {next_c['circuit_name']} ({next_c['weather_mode'].upper()}).",
        })
    state["inbox"] = state["inbox"][:20]

    res_payload = {
        "ok": True,
        "round": rd,
        "circuit_id": cal_item["circuit_id"],
        "circuit_name": cal_item["circuit_name"],
        "winner": winner_name,
        "player_pos": player_pos,
        "teammate_pos": teammate_pos,
        "beat_teammate": beat_teammate,
        "points_scored": player_pts,
        "acclaim_delta": acclaim_delta,
        "best_lap_ms": int(best_lap_ms),
        "season_complete": season_complete,
    }
    try:
        from . import drive_paddock as dp
        dp.append_post_race_paddock_buzz(state, res_payload)
    except Exception:
        pass
    return res_payload


def sign_driver_career_contract(state: dict[str, Any], team_name: str) -> tuple[bool, str]:
    """Sign a new-season contract at Season End and advance to Season N+1."""
    if state.get("phase") != "season_end":
        return False, "Contracts can only be signed after the season finale."
    offers = state.get("contract_offers") or _generate_contract_offers(state)
    chosen = next((o for o in offers if o["team"].lower() == team_name.lower()), None)
    if not chosen:
        return False, f"No contract offer found from {team_name}."

    p = state["player"]
    state["season"] = int(state["season"]) + 1
    state["year"] = int(state["year"]) + 1
    state["round"] = 1
    state["phase"] = "race_ready"
    p["team"] = chosen["team"]
    p["color"] = chosen["color"]
    p["points"] = 0.0

    # Rebuild fresh grid with player in chosen team
    fresh = _build_default_2026_grid()
    team_indices = [i for i, g in enumerate(fresh) if chosen["team"].lower() in g["team"].lower()]
    replace_idx = team_indices[-1] if team_indices else 0
    teammate_idx = team_indices[0] if len(team_indices) > 1 else (1 if replace_idx == 0 else 0)
    teammate = fresh[teammate_idx]
    fresh[replace_idx] = {
        **fresh[replace_idx],
        "driver_id": "player",
        "name": p["name"],
        "code3": p["code3"],
        "number": p["number"],
        "is_player": True,
        "points": 0.0, "wins": 0, "podiums": 0,
    }
    for g in fresh:
        g["points"] = 0.0
        g["wins"] = 0
        g["podiums"] = 0
    state["grid"] = fresh
    p["teammate_id"] = teammate["driver_id"]
    p["teammate_name"] = teammate["name"]
    state["contract_offers"] = []
    for c in state["calendar"]:
        c["completed"] = False
        c["winner"] = None
        c["player_pos"] = None

    state["inbox"].insert(0, {
        "round": 1,
        "sender": f"{chosen['team']} Team Principal",
        "title": f"Season {state['season']} Contract Signed: {chosen['team']}!",
        "body": f"Signed as {chosen['role']} (${chosen['salary_m']}M/yr) alongside {teammate['name']}. Lights out for Season {state['season']}!",
    })
    return True, f"Signed with {chosen['team']} for Season {state['season']}!"


def serialize_career_view(state: dict[str, Any]) -> dict[str, Any]:
    wdc = sorted(state["grid"], key=lambda x: (-float(x.get("points") or 0), -int(x.get("wins") or 0), -int(x.get("car_rating") or 80)))
    wcc_map: dict[str, dict[str, Any]] = {}
    for g in state["grid"]:
        tm = g["team"]
        rec = wcc_map.setdefault(tm, {"team": tm, "color": g["color"], "points": 0.0, "car_rating": g["car_rating"], "is_player": False})
        rec["points"] = round(rec["points"] + float(g.get("points") or 0.0), 1)
        if g.get("is_player"):
            rec["is_player"] = True
    wcc = sorted(wcc_map.values(), key=lambda x: (-x["points"], -x["car_rating"]))
    cal = state["calendar"]
    cur_cal = cal[min(len(cal) - 1, max(0, int(state["round"]) - 1))]
    return {
        "state": state,
        "wdc": wdc,
        "wcc": wcc,
        "current_event": cur_cal,
        "player_car_icon": _resolve_car_icon(state["player"]["team"], year=int(state.get("year") or 2026)),
    }
