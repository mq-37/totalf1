"""
All-Time Formula 1 Circuit Catalog loader (24 Modern 2026 + Historic World Championship Circuits).

Coordinates and circuit specifications live in `data/circuits.json` (single source of truth).
Exposes:
  - CIRCUITS       : full circuit dicts (including spline points & corner anchors)
  - CIRCUITS_META  : lightweight metadata catalog (no heavy coordinate arrays) for instant page boots
  - CIRCUITS_BY_ID : fast O(1) lookup by circuit id
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_CIRCUITS_PATH = Path(__file__).resolve().parent.parent / "data" / "circuits.json"

_HEAVY_KEYS = frozenset({"points", "corner_anchors", "braking_zones", "water_zone"})


def _load_circuits() -> list[dict[str, Any]]:
    return json.loads(_CIRCUITS_PATH.read_text(encoding="utf-8"))


def _build_meta(circuits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    meta = []
    for c in circuits:
        m = {k: v for k, v in c.items() if k not in _HEAVY_KEYS}
        meta.append(m)
    return meta


CIRCUITS: list[dict[str, Any]] = _load_circuits()
CIRCUITS_META: list[dict[str, Any]] = _build_meta(CIRCUITS)
CIRCUITS_BY_ID: dict[str, dict[str, Any]] = {c["id"]: c for c in CIRCUITS}


def get_circuit(circuit_id: str) -> dict[str, Any] | None:
    return CIRCUITS_BY_ID.get((circuit_id or "").strip().lower())


def reload_circuits() -> list[dict[str, Any]]:
    global CIRCUITS, CIRCUITS_META, CIRCUITS_BY_ID
    CIRCUITS = _load_circuits()
    CIRCUITS_META = _build_meta(CIRCUITS)
    CIRCUITS_BY_ID = {c["id"]: c for c in CIRCUITS}
    return CIRCUITS
