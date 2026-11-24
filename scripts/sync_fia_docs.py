#!/usr/bin/env python3
"""Sync TracingInsights FIA Documents Archive (2018-2026) & Penalties into data/fia_docs.sqlite."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from f1data.fia_docs_sync import sync_fia_docs


def main() -> None:
    ap = argparse.ArgumentParser(description="Sync TracingInsights FIA Documents into data/fia_docs.sqlite")
    ap.add_argument("--force", action="store_true", help="Force re-fetch all events and sidecars")
    ap.add_argument("--max-sidecars", type=int, default=350, help="Max Steward Decision sidecars to hydrate in batch")
    ap.add_argument("--data-dir", default=str(ROOT / "data"), help="Target data directory")
    args = ap.parse_args()

    res = sync_fia_docs(args.data_dir, max_sidecars=args.max_sidecars, force=args.force)
    print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
