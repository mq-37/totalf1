"""
FIA Regulation Architect, Car Dimensions Physics Engine & Custom Car Tools Builder.

Allows Team Principals (in /career) and Race Directors (in /sim) to:
  1. Tune car dimensions (wheelbase, width, min weight, front/rear wing spans, ride height, rim size),
     powertrain split (ERS kW, ICE %, refuelling), and governance (cost cap, points format).
  2. Vote iconic F1 "Car Tools" in or out (DRS, Active Aero, Manual Override, KERS, Ground Effect,
     Fan Car, F-Duct, DAS, Blown Diffuser, 6-Wheeler).
  3. Invent and name brand-new custom Car Tools combining trigger, aero/power effects & side-effects.
  4. Evaluate live racing physics impacts for both 2D CAD / 3D car scaling and the race simulator.
  5. Persist custom voted formulas in data/custom_formulas.json grouped cleanly alongside Official Eras.
"""
from __future__ import annotations

import copy
import json
import re
import time
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent.parent
CUSTOM_FORMULAS_PATH = BASE_DIR / "data" / "custom_formulas.json"


CAR_TOOLS_CATALOG: dict[str, dict[str, Any]] = {
    "drs": {
        "id": "drs",
        "name": "Drag Reduction System (DRS)",
        "short": "DRS",
        "category": "aero",
        "era_origin": "2011–2025",
        "desc": "Rear wing upper flap opens within 1.0s at detection zones for straight-line slipstream gains.",
        "effects": {
            "cornering": 0.0,
            "top_speed_kph": 14.0,
            "dirty_air": 0.02,
            "overtake_s": 0.42,
            "tyre_deg": 0.0,
            "dnf_mult": 0.02,
            "agility": 0.0,
            "cost_m": 2.0,
        },
    },
    "active_aero": {
        "id": "active_aero",
        "name": "Active Aero (X-Mode / Z-Mode)",
        "short": "ACT-AERO",
        "category": "aero",
        "era_origin": "2026+",
        "desc": "Synchronized movable front and rear wings flatten on every straight and snap shut for braking.",
        "effects": {
            "cornering": 5.5,
            "top_speed_kph": 18.0,
            "dirty_air": -0.10,
            "overtake_s": 0.28,
            "tyre_deg": -0.04,
            "dnf_mult": 0.06,
            "agility": 4.0,
            "cost_m": 6.5,
        },
    },
    "manual_override": {
        "id": "manual_override",
        "name": "Manual Override Mode (MOM)",
        "short": "OVERRIDE",
        "category": "power",
        "era_origin": "2026+",
        "desc": "Chasing car within 1.0s unlocks extra 350kW electrical deployment up to 337 km/h.",
        "effects": {
            "cornering": 0.0,
            "top_speed_kph": 12.0,
            "dirty_air": 0.0,
            "overtake_s": 0.36,
            "tyre_deg": 0.02,
            "dnf_mult": 0.04,
            "agility": 0.0,
            "cost_m": 4.0,
        },
    },
    "kers": {
        "id": "kers",
        "name": "Kinetic Energy Push-to-Pass (KERS)",
        "short": "KERS",
        "category": "power",
        "era_origin": "2009–2013",
        "desc": "Driver-triggered 6.7-second battery surge per lap for tactical defence or corner-exit attack.",
        "effects": {
            "cornering": 1.0,
            "top_speed_kph": 8.0,
            "dirty_air": 0.0,
            "overtake_s": 0.24,
            "tyre_deg": 0.03,
            "dnf_mult": 0.05,
            "agility": -1.5,
            "cost_m": 3.5,
        },
    },
    "ground_effect": {
        "id": "ground_effect",
        "name": "Venturi Ground-Effect Tunnels",
        "short": "VENTURI",
        "category": "chassis",
        "era_origin": "1978–82 / 2022–25",
        "desc": "Deep sculpted underfloor tunnels generate high downforce with lower turbulent wake behind the car.",
        "effects": {
            "cornering": 9.0,
            "top_speed_kph": 3.0,
            "dirty_air": -0.18,
            "overtake_s": 0.16,
            "tyre_deg": 0.05,
            "dnf_mult": 0.03,
            "agility": 2.0,
            "cost_m": 5.0,
        },
    },
    "fan_car": {
        "id": "fan_car",
        "name": "Rear Suction Fan (BT46B Spec)",
        "short": "FAN-CAR",
        "category": "chassis",
        "era_origin": "1978 Banned",
        "desc": "Gearbox-driven rear turbine extracts air from beneath the floor for speed-independent grip.",
        "effects": {
            "cornering": 14.0,
            "top_speed_kph": -4.0,
            "dirty_air": 0.22,
            "overtake_s": -0.10,
            "tyre_deg": 0.14,
            "dnf_mult": 0.18,
            "agility": 8.0,
            "cost_m": 9.0,
        },
    },
    "f_duct": {
        "id": "f_duct",
        "name": "Cockpit Aero Stall (F-Duct)",
        "short": "F-DUCT",
        "category": "aero",
        "era_origin": "2010",
        "desc": "Internal snorkel channels airflow to stall the rear wing on straights without mechanical actuators.",
        "effects": {
            "cornering": 0.5,
            "top_speed_kph": 10.5,
            "dirty_air": 0.04,
            "overtake_s": 0.14,
            "tyre_deg": 0.0,
            "dnf_mult": 0.03,
            "agility": -1.0,
            "cost_m": 2.5,
        },
    },
    "das": {
        "id": "das",
        "name": "Dual-Axis Steering (DAS)",
        "short": "DAS",
        "category": "chassis",
        "era_origin": "2020",
        "desc": "Pulling the steering column adjusts front toe angle on straights for rapid tyre warm-up & low wear.",
        "effects": {
            "cornering": 3.0,
            "top_speed_kph": 2.0,
            "dirty_air": 0.0,
            "overtake_s": 0.05,
            "tyre_deg": -0.14,
            "dnf_mult": 0.04,
            "agility": 3.0,
            "cost_m": 4.5,
        },
    },
    "blown_diffuser": {
        "id": "blown_diffuser",
        "name": "Exhaust-Blown Diffuser",
        "short": "BLOWN-DF",
        "category": "aero",
        "era_origin": "2010–2013",
        "desc": "Off-throttle exhaust gases seal the rear diffuser for planted mid-corner traction.",
        "effects": {
            "cornering": 8.5,
            "top_speed_kph": -2.0,
            "dirty_air": 0.12,
            "overtake_s": -0.05,
            "tyre_deg": 0.04,
            "dnf_mult": 0.07,
            "agility": 4.5,
            "cost_m": 5.5,
        },
    },
    "six_wheeler": {
        "id": "six_wheeler",
        "name": "Tandem Front Axle (6-Wheeler)",
        "short": "6-WHEEL",
        "category": "chassis",
        "era_origin": "1976–77 P34",
        "desc": "Four compact front tyres reduce frontal drag and boost turn-in braking bite at the cost of complexity.",
        "effects": {
            "cornering": 6.5,
            "top_speed_kph": 6.0,
            "dirty_air": -0.05,
            "overtake_s": 0.10,
            "tyre_deg": 0.12,
            "dnf_mult": 0.14,
            "agility": 7.0,
            "cost_m": 8.5,
        },
    },
}


DEFAULT_2026_FORMULA: dict[str, Any] = {
    "id": "fia_2026_official",
    "name": "2026 FIA Active-Aero Formula",
    "year": 2026,
    "group": "official_eras",
    "dimensions": {
        "wheelbase_mm": 3400,
        "width_mm": 1900,
        "min_weight_kg": 768,
        "front_wing_mm": 1800,
        "rear_wing_mm": 1000,
        "ride_height_mm": 32,
        "tyre_rim_in": 18,
    },
    "powertrain": {
        "ers_kw": 350,
        "ice_share_pct": 50,
        "refuelling": False,
    },
    "governance": {
        "cost_cap_m": 135,
        "points_system": "25_18_15",
    },
    "active_tools": ["active_aero", "manual_override", "ground_effect"],
    "custom_tools": [],
}


FORMULA_PRESETS: dict[str, dict[str, Any]] = {
    "2026_nimble": copy.deepcopy(DEFAULT_2026_FORMULA),
    "2004_v10_screamer": {
        "id": "preset_2004_v10",
        "name": "V10 Lightweight Refuelling Formula",
        "year": 2004,
        "group": "official_eras",
        "dimensions": {
            "wheelbase_mm": 3080,
            "width_mm": 1800,
            "min_weight_kg": 605,
            "front_wing_mm": 1400,
            "rear_wing_mm": 1000,
            "ride_height_mm": 40,
            "tyre_rim_in": 13,
        },
        "powertrain": {"ers_kw": 0, "ice_share_pct": 100, "refuelling": True},
        "governance": {"cost_cap_m": 220, "points_system": "10_8_6"},
        "active_tools": [],
        "custom_tools": [],
    },
    "2022_ground_effect": {
        "id": "preset_2022_ge",
        "name": "2022–2025 Ground Effect + DRS",
        "year": 2024,
        "group": "official_eras",
        "dimensions": {
            "wheelbase_mm": 3600,
            "width_mm": 2000,
            "min_weight_kg": 798,
            "front_wing_mm": 2000,
            "rear_wing_mm": 1050,
            "ride_height_mm": 26,
            "tyre_rim_in": 18,
        },
        "powertrain": {"ers_kw": 120, "ice_share_pct": 80, "refuelling": False},
        "governance": {"cost_cap_m": 135, "points_system": "25_18_15"},
        "active_tools": ["drs", "ground_effect"],
        "custom_tools": [],
    },
    "unlimited_prototype": {
        "id": "preset_unlimited_x",
        "name": "Formula Libre (Fan Car + Active Aero)",
        "year": 2028,
        "group": "custom_voted_formulas",
        "dimensions": {
            "wheelbase_mm": 3250,
            "width_mm": 2050,
            "min_weight_kg": 680,
            "front_wing_mm": 1950,
            "rear_wing_mm": 1100,
            "ride_height_mm": 24,
            "tyre_rim_in": 18,
        },
        "powertrain": {"ers_kw": 450, "ice_share_pct": 55, "refuelling": False},
        "governance": {"cost_cap_m": 185, "points_system": "25_18_15"},
        "active_tools": ["active_aero", "fan_car", "manual_override", "das"],
        "custom_tools": [],
    },
}


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(v)))


def normalize_formula(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Safely merge any partial formula payload onto DEFAULT_2026_FORMULA with engineering bounds."""
    base = copy.deepcopy(DEFAULT_2026_FORMULA)
    if not isinstance(raw, dict):
        return base

    if raw.get("id"):
        base["id"] = re.sub(r"[^a-z0-9_-]+", "_", str(raw["id"]).lower()).strip("_") or base["id"]
    if raw.get("name"):
        base["name"] = str(raw["name"]).strip()[:64]
    if raw.get("year") is not None:
        try:
            base["year"] = int(_clamp(int(raw["year"]), 1950, 2050))
        except Exception:
            pass
    if raw.get("group") in ("official_eras", "custom_voted_formulas"):
        base["group"] = raw["group"]

    d_in = raw.get("dimensions") if isinstance(raw.get("dimensions"), dict) else {}
    dims = base["dimensions"]
    dims["wheelbase_mm"] = int(_clamp(d_in.get("wheelbase_mm", dims["wheelbase_mm"]), 2800, 3800))
    dims["width_mm"] = int(_clamp(d_in.get("width_mm", dims["width_mm"]), 1650, 2150))
    dims["min_weight_kg"] = int(_clamp(d_in.get("min_weight_kg", dims["min_weight_kg"]), 580, 860))
    dims["front_wing_mm"] = int(_clamp(d_in.get("front_wing_mm", dims["front_wing_mm"]), 1300, 2100))
    dims["rear_wing_mm"] = int(_clamp(d_in.get("rear_wing_mm", dims["rear_wing_mm"]), 750, 1200))
    dims["ride_height_mm"] = int(_clamp(d_in.get("ride_height_mm", dims["ride_height_mm"]), 18, 65))
    dims["tyre_rim_in"] = 13 if int(d_in.get("tyre_rim_in", dims["tyre_rim_in"])) <= 15 else 18

    p_in = raw.get("powertrain") if isinstance(raw.get("powertrain"), dict) else {}
    pt = base["powertrain"]
    pt["ers_kw"] = int(_clamp(p_in.get("ers_kw", pt["ers_kw"]), 0, 500))
    pt["ice_share_pct"] = int(_clamp(p_in.get("ice_share_pct", pt["ice_share_pct"]), 30, 100))
    pt["refuelling"] = bool(p_in.get("refuelling", pt["refuelling"]))

    g_in = raw.get("governance") if isinstance(raw.get("governance"), dict) else {}
    gov = base["governance"]
    gov["cost_cap_m"] = int(_clamp(g_in.get("cost_cap_m", gov["cost_cap_m"]), 85, 250))
    if g_in.get("points_system") in ("25_18_15", "10_8_6", "top12_expanded", "double_finale"):
        gov["points_system"] = g_in["points_system"]

    customs: list[dict[str, Any]] = []
    if isinstance(raw.get("custom_tools"), list):
        for ct in raw["custom_tools"]:
            if isinstance(ct, dict) and ct.get("id") and ct.get("name"):
                customs.append(ct)
    base["custom_tools"] = customs

    valid_ids = set(CAR_TOOLS_CATALOG.keys()) | {c["id"] for c in customs}
    if isinstance(raw.get("active_tools"), list):
        base["active_tools"] = [str(t) for t in raw["active_tools"] if str(t) in valid_ids]

    return base


def create_custom_tool(
    name: str,
    short_code: str = "",
    trigger: str = "within_1s",
    aero_mode: str = "drag_cut",
    power_mode: str = "none",
    intensity: float = 1.0,
    side_effect: str = "tyre_wear",
) -> dict[str, Any]:
    """Create a balanced custom Car Tool (named by the user, like a custom replacement for DRS)."""
    clean_name = str(name or "").strip()[:48] or "Custom Aero Boost"
    slug = re.sub(r"[^a-z0-9]+", "_", clean_name.lower()).strip("_")[:24] or "custom_tool"
    tid = f"custom_{slug}_{int(time.time()) % 10000}"
    badge = re.sub(r"[^A-Z0-9-]", "", str(short_code or "").upper())[:8]
    if not badge:
        words = [w for w in re.split(r"[^A-Za-z0-9]+", clean_name) if w]
        badge = ("".join(w[0] for w in words[:4]).upper() or "TOOL")[:6]

    scale = _clamp(intensity, 0.5, 1.8)
    effects = {
        "cornering": 0.0,
        "top_speed_kph": 0.0,
        "dirty_air": 0.0,
        "overtake_s": 0.0,
        "tyre_deg": 0.0,
        "dnf_mult": 0.03 * scale,
        "agility": 0.0,
        "cost_m": round(3.0 * scale, 1),
    }

    # Aero mode contribution
    if aero_mode == "drag_cut":
        effects["top_speed_kph"] += round(13.0 * scale, 1)
        effects["overtake_s"] += round(0.30 * scale, 2)
    elif aero_mode == "downforce_surge":
        effects["cornering"] += round(8.5 * scale, 1)
        effects["agility"] += round(4.0 * scale, 1)
        effects["top_speed_kph"] -= round(3.0 * scale, 1)
    elif aero_mode == "wake_cleaner":
        effects["dirty_air"] -= round(0.16 * scale, 2)
        effects["overtake_s"] += round(0.24 * scale, 2)
        effects["cornering"] += round(2.5 * scale, 1)
    elif aero_mode == "adaptive_dual":
        effects["cornering"] += round(5.0 * scale, 1)
        effects["top_speed_kph"] += round(11.0 * scale, 1)
        effects["overtake_s"] += round(0.22 * scale, 2)
        effects["cost_m"] = round(effects["cost_m"] + 3.0 * scale, 1)

    # Power mode contribution
    if power_mode == "ers_overboost":
        effects["top_speed_kph"] += round(9.5 * scale, 1)
        effects["overtake_s"] += round(0.26 * scale, 2)
    elif power_mode == "regen_harvest":
        effects["tyre_deg"] -= round(0.06 * scale, 2)
        effects["cornering"] += round(2.0 * scale, 1)
    elif power_mode == "torque_vector":
        effects["cornering"] += round(6.0 * scale, 1)
        effects["agility"] += round(5.0 * scale, 1)

    # Trigger modifiers
    if trigger == "within_1s":
        effects["overtake_s"] = round(effects["overtake_s"] + 0.14 * scale, 2)
    elif trigger == "driver_push":
        effects["top_speed_kph"] = round(effects["top_speed_kph"] + 3.0 * scale, 1)
    elif trigger == "automatic_corner":
        effects["cornering"] = round(effects["cornering"] + 2.5 * scale, 1)

    # Trade-off / side effect (keeps engineering balance authentic!)
    if side_effect == "tyre_wear":
        effects["tyre_deg"] = round(effects["tyre_deg"] + 0.10 * scale, 2)
    elif side_effect == "reliability_risk":
        effects["dnf_mult"] = round(effects["dnf_mult"] + 0.12 * scale, 2)
    elif side_effect == "dirty_wake":
        effects["dirty_air"] = round(effects["dirty_air"] + 0.14 * scale, 2)
    elif side_effect == "budget_heavy":
        effects["cost_m"] = round(effects["cost_m"] + 5.5 * scale, 1)

    return {
        "id": tid,
        "name": clean_name,
        "short": badge,
        "category": "custom",
        "era_origin": "Custom FIA Vote",
        "trigger": trigger,
        "aero_mode": aero_mode,
        "power_mode": power_mode,
        "intensity": round(scale, 2),
        "side_effect": side_effect,
        "desc": f"Custom Car Tool ({trigger.replace('_', ' ')} | {aero_mode.replace('_', ' ')} + {power_mode.replace('_', ' ')}).",
        "effects": effects,
    }


def evaluate_formula_physics(formula_raw: dict[str, Any] | None) -> dict[str, Any]:
    """Compute comprehensive racing physics metrics & simulator patch from a Regulation Formula."""
    f = normalize_formula(formula_raw)
    dims = f["dimensions"]
    pt = f["powertrain"]
    gov = f["governance"]

    wb = dims["wheelbase_mm"]
    wd = dims["width_mm"]
    wt = dims["min_weight_kg"]
    fw = dims["front_wing_mm"]
    rw = dims["rear_wing_mm"]
    rh = dims["ride_height_mm"]
    rim = dims["tyre_rim_in"]

    # Baseline 2026 physical indices
    cornering = 72.0 + (wd - 1900) * 0.032 + (fw - 1800) * 0.018 + (rw - 1000) * 0.025 - (wt - 768) * 0.075 - (rh - 32) * 0.35
    top_speed = 332.0 - (wd - 1900) * 0.028 - (rw - 1000) * 0.038 + (pt["ers_kw"] - 350) * 0.048 - (wt - 768) * 0.025
    agility = 76.0 - (wb - 3400) * 0.045 - (wt - 768) * 0.095 - (wd - 1900) * 0.020 + (3.5 if rim == 13 else 0.0)
    dirty_air = 1.00 + (fw - 1800) * 0.00055 + (rw - 1000) * 0.00060 + (wd - 1900) * 0.00045
    overtake_s = 0.38 - (dirty_air - 1.0) * 0.35 + (0.08 if wb < 3300 else 0.0)
    tyre_deg = 1.00 + (wt - 768) * 0.0014 + (0.06 if rim == 13 else 0.0)
    dnf_mult = 1.00 + max(0, pt["ers_kw"] - 350) * 0.0008 + (0.08 if pt["refuelling"] else 0.0)
    tool_cost = 0.0

    tool_lookup = dict(CAR_TOOLS_CATALOG)
    for ct in f["custom_tools"]:
        tool_lookup[ct["id"]] = ct

    active_names: list[str] = []
    active_badges: list[str] = []
    for tid in f["active_tools"]:
        t = tool_lookup.get(tid)
        if not t:
            continue
        active_names.append(t["name"])
        active_badges.append(t.get("short") or tid.upper()[:8])
        ef = t.get("effects") or {}
        cornering += float(ef.get("cornering", 0.0))
        top_speed += float(ef.get("top_speed_kph", 0.0))
        dirty_air += float(ef.get("dirty_air", 0.0))
        overtake_s += float(ef.get("overtake_s", 0.0))
        tyre_deg += float(ef.get("tyre_deg", 0.0))
        dnf_mult += float(ef.get("dnf_mult", 0.0))
        agility += float(ef.get("agility", 0.0))
        tool_cost += float(ef.get("cost_m", 0.0))

    if pt["refuelling"]:
        agility += 5.5
        tyre_deg -= 0.08
        cornering += 3.0

    cornering = round(_clamp(cornering, 35.0, 99.0), 1)
    top_speed = round(_clamp(top_speed, 298.0, 388.0), 1)
    agility = round(_clamp(agility, 30.0, 99.0), 1)
    dirty_air = round(_clamp(dirty_air, 0.52, 1.65), 2)
    overtake_s = round(_clamp(overtake_s, 0.12, 1.45), 2)
    tyre_deg = round(_clamp(tyre_deg, 0.70, 1.55), 2)
    dnf_mult = round(_clamp(dnf_mult, 0.65, 1.85), 2)

    # Lap time delta relative to 2026 baseline (negative = faster)
    lap_delta = round(
        -((cornering - 78.0) * 0.095) - ((top_speed - 348.0) * 0.042) - ((agility - 78.0) * 0.035),
        2,
    )
    clean_air_score = round(_clamp((1.65 - dirty_air) / 1.13 * 100.0, 15.0, 99.0), 1)
    overtake_score = round(_clamp((overtake_s / 1.15) * 100.0, 18.0, 99.0), 1)
    tyre_life_score = round(_clamp((1.55 - tyre_deg) / 0.85 * 100.0, 15.0, 99.0), 1)
    top_speed_score = round(_clamp((top_speed - 298.0) / 90.0 * 100.0, 15.0, 99.0), 1)
    estimated_budget_m = round(105.0 + tool_cost + (pt["ers_kw"] * 0.045) + (12.0 if pt["refuelling"] else 0.0), 1)

    return {
        "formula": f,
        "metrics": {
            "cornering_index": cornering,
            "top_speed_kph": top_speed,
            "top_speed_score": top_speed_score,
            "agility_index": agility,
            "dirty_air_mult": dirty_air,
            "clean_air_score": clean_air_score,
            "overtake_delta_s": overtake_s,
            "overtake_score": overtake_score,
            "tyre_deg_mult": tyre_deg,
            "tyre_life_score": tyre_life_score,
            "reliability_dnf_mult": dnf_mult,
            "lap_time_delta_s": lap_delta,
            "estimated_budget_m": estimated_budget_m,
            "cost_cap_pressure": round(estimated_budget_m - gov["cost_cap_m"], 1),
        },
        "active_tool_names": active_names,
        "active_tool_badges": active_badges,
        "era_rules_patch": {
            "key": f["id"],
            "label": f["name"],
            "group": f["group"],
            "drs_enabled": ("drs" in f["active_tools"] or "active_aero" in f["active_tools"]),
            "active_aero": ("active_aero" in f["active_tools"]),
            "ers_enabled": pt["ers_kw"] > 0,
            "ers_kw": pt["ers_kw"],
            "refuelling": pt["refuelling"],
            "dirty_air_mult": dirty_air,
            "overtake_delta_s": overtake_s,
            "tyre_deg_mult": tyre_deg,
            "dnf_mult": dnf_mult,
            "lap_time_delta_s": lap_delta,
            "cost_cap_m": gov["cost_cap_m"],
            "dimensions": dims,
            "active_tools": f["active_tools"],
            "custom_tools": f["custom_tools"],
            "active_tool_badges": active_badges,
        },
    }


def load_custom_formulas() -> list[dict[str, Any]]:
    """Load saved custom voted formulas from data/custom_formulas.json."""
    if not CUSTOM_FORMULAS_PATH.exists():
        return []
    try:
        data = json.loads(CUSTOM_FORMULAS_PATH.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return [normalize_formula(x) for x in data if isinstance(x, dict)]
    except Exception:
        pass
    return []


def save_custom_formula(formula_raw: dict[str, Any]) -> dict[str, Any]:
    """Save or update a custom formula in data/custom_formulas.json (shared between /career & /sim)."""
    f = normalize_formula(formula_raw)
    f["group"] = "custom_voted_formulas"
    if not f["id"] or f["id"].startswith("fia_2026_official"):
        slug = re.sub(r"[^a-z0-9]+", "_", f["name"].lower()).strip("_")[:28] or "custom_formula"
        f["id"] = f"custom_{slug}_{int(time.time()) % 10000}"
    existing = load_custom_formulas()
    updated = [x for x in existing if x.get("id") != f["id"]]
    updated.insert(0, f)
    CUSTOM_FORMULAS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CUSTOM_FORMULAS_PATH.write_text(json.dumps(updated[:30], indent=2), encoding="utf-8")
    return evaluate_formula_physics(f)


def get_grouped_formulas() -> dict[str, Any]:
    """Return Official FIA Eras and Custom Voted Formulas grouped cleanly for /sim and /career."""
    from .era_rules import list_era_rules
    official = list_era_rules()
    customs = [evaluate_formula_physics(f)["era_rules_patch"] for f in load_custom_formulas()]
    return {
        "official_eras": official,
        "custom_voted_formulas": customs,
        "presets": {k: evaluate_formula_physics(v) for k, v in FORMULA_PRESETS.items()},
        "tools_catalog": list(CAR_TOOLS_CATALOG.values()),
    }
