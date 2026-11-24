#!/usr/bin/env python3
"""Sync all 58 TracingInsights F1DB Parquet tables into data/f1db.sqlite."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from f1data.f1db_sync import sync_f1db


def main() -> None:
    ap = argparse.ArgumentParser(description="Sync TracingInsights F1DB into data/f1db.sqlite")
    ap.add_argument("--force", action="store_true", help="Re-download all Parquet files and rebuild SQLite")
    ap.add_argument("--data-dir", default=str(ROOT / "data"), help="Target data directory")
    args = ap.parse_args()

    res = sync_f1db(args.data_dir, force=args.force)
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
