"""
Real 24-circuit F1 GPS Track Simulator database loader.

Coordinates and circuit specifications live in `data/circuits.json` (single source of truth)
so Python imports stay fast and static data stays cleanly separated from application code.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_CIRCUITS_PATH = Path(__file__).resolve().parent.parent / "data" / "circuits.json"


def _load_circuits() -> list[dict[str, Any]]:
    return json.loads(_CIRCUITS_PATH.read_text(encoding="utf-8"))


CIRCUITS: list[dict[str, Any]] = _load_circuits()
