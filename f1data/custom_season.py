"""
Custom Season Builder Backend — Shared between /sim (Full CPU Sim) and /career (Team Principal Career).

Allows full customization of:
  - Season name & Era Rules (1950s..2026 + custom rule overrides)
  - Custom Calendar from all 79 historical & modern F1 circuits
  - Custom Teams, Car Eras, Liveries, Drivers & Race Engineers
  - Driver Market / Transfer Rules & Budget Cap
Persisted in data/career_saves.sqlite (`custom_seasons` table).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from . import career_db as cdb
from .circuits import CIRCUITS_BY_ID, CIRCUITS_META
from .era_rules import get_era_rules, list_era_rules


def normalize_custom_season(raw: dict[str, Any]) -> dict[str, Any]:
    name = str(raw.get("name") or "Custom F1 Championship").strip()[:48] or "Custom F1 Championship"
    era_key = str(raw.get("era_key") or "2026").strip()
    base_era = get_era_rules(era_key)

    # Optional granular rule overrides on top of the selected Era preset
    overrides = raw.get("rule_overrides") if isinstance(raw.get("rule_overrides"), dict) else {}
    effective_rules = dict(base_era)
    for bool_key in ("refuelling", "drs_enabled", "override_mode", "ers_enabled", "two_compound_rule", "vsc_enabled"):
        if bool_key in overrides and overrides[bool_key] is not None:
            effective_rules[bool_key] = bool(overrides[bool_key])
    if "reliability_dnf_mult" in overrides:
        try:
            effective_rules["reliability_dnf_mult"] = max(0.2, min(3.0, float(overrides["reliability_dnf_mult"])))
        except (TypeError, ValueError):
            pass

    # Validate calendar circuit IDs against all 79 circuits
    cal_in = raw.get("calendar") or []
    calendar: list[str] = []
    for cid in cal_in:
        c_norm = str(cid or "").strip().lower()
        if c_norm in CIRCUITS_BY_ID and c_norm not in calendar:
            calendar.append(c_norm)
    if not calendar:
        calendar = [c["id"] for c in CIRCUITS_META[:12]]

    # Custom Teams / Cars / Drivers / Engineers (optional; empty means use Era's historical grid)
    teams_out: list[dict[str, Any]] = []
    for i, t in enumerate(raw.get("teams") or []):
        if not isinstance(t, dict):
            continue
        tname = str(t.get("name") or f"Custom Team {i + 1}").strip()[:32]
        color = str(t.get("color") or "#e10600").strip()
        car_era = str(t.get("car_era") or "2020s").strip()
        car_ovr = max(60, min(99, int(t.get("car_overall") or 82)))
        drivers_in = t.get("drivers") or []
        drv_clean = []
        for j in range(2):
            d = drivers_in[j] if j < len(drivers_in) and isinstance(drivers_in[j], dict) else {}
            dname = str(d.get("name") or f"{tname} Driver {j + 1}").strip()[:32]
            code3 = str(d.get("code3") or dname[:3]).upper()[:3]
            eng = str(d.get("engineer") or f"Engineer {j + 1}").strip()[:28]
            ovr = max(60, min(99, int(d.get("overall") or 82)))
            drv_clean.append({"name": dname, "code3": code3, "overall": ovr, "engineer": eng})
        teams_out.append({
            "name": tname,
            "color": color,
            "car_era": car_era,
            "car_overall": car_ovr,
            "drivers": drv_clean,
        })

    market_rules = raw.get("market_rules") if isinstance(raw.get("market_rules"), dict) else {}
    return {
        "name": name,
        "era_key": base_era["key"],
        "era_rules": effective_rules,
        "rule_overrides": overrides,
        "race_laps": str(raw.get("race_laps") or "15"),
        "calendar": calendar,
        "teams": teams_out,
        "market_rules": {
            "transfer_mode": str(market_rules.get("transfer_mode") or "normal"),
            "budget_cap_m": max(60, min(300, int(market_rules.get("budget_cap_m") or 135))),
            "feeder_promotions": bool(market_rules.get("feeder_promotions", True)),
        },
    }


def list_seasons(base_dir: Path) -> list[dict[str, Any]]:
    return cdb.list_custom_seasons(base_dir)


def save_season(base_dir: Path, raw: dict[str, Any], season_id: str | None = None) -> dict[str, Any]:
    cfg = normalize_custom_season(raw)
    return cdb.save_custom_season(base_dir, cfg["name"], cfg["era_key"], cfg, season_id=season_id)


def get_season(base_dir: Path, season_id: str) -> dict[str, Any] | None:
    return cdb.get_custom_season(base_dir, season_id)


def delete_season(base_dir: Path, season_id: str) -> bool:
    return cdb.delete_custom_season(base_dir, season_id)


def builder_presets() -> dict[str, Any]:
    return {
        "eras": list_era_rules(),
        "circuits": CIRCUITS_META,
        "calendar_presets": {
            "modern_24": [c["id"] for c in CIRCUITS_META if c.get("category") != "classic"],
            "golden_80s": ["interlagos", "imola", "monaco", "montreal", "detroit", "paul_ricard", "brands_hatch", "hockenheim", "spielberg", "zandvoort", "monza", "estoril", "jerez", "adelaide"],
            "classic_legends": ["silverstone", "monaco", "spa", "monza", "nordschleife", "watkins_glen", "kyalami", "suzuka", "imola", "interlagos", "adelaide", "reims"],
        },
    }
