#!/usr/bin/env python3
import argparse
import json
import sys
import pathlib
from typing import List

import requests


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Prefetch and cache F1 driver images into data/driver_images via the local API.")
    p.add_argument("--server", default="http://127.0.0.1:8000", help="Base URL for the running server")
    p.add_argument("--names", help="Comma-separated list of driver names or slugs (e.g. 'Alain Prost PRO,Aguri-Suzuki-SUZ')")
    p.add_argument("--from-file", dest="from_file", help="Path to a file with one driver name or slug per line")
    p.add_argument("--fetch-missing", type=int, default=0, help="Fetch this many currently-missing images using the API's missing list")
    p.add_argument("--year-start", type=int, help="Start year for bulk prefetch (inclusive)")
    p.add_argument("--year-end", type=int, help="End year for bulk prefetch (inclusive)")
    p.add_argument("--limit", type=int, default=0, help="Limit count for bulk prefetch or number of names to process")
    return p.parse_args()


def prefetch_single(base: str, driver: str) -> dict:
    url = f"{base}/api/prefetch/driver-image"
    r = requests.get(url, params={"driver": driver}, timeout=30)
    r.raise_for_status()
    return r.json()


def prefetch_missing(base: str, count: int) -> List[dict]:
    url_miss = f"{base}/api/missing/driver-images"
    miss = requests.get(url_miss, params={"limit": count}, timeout=30)
    miss.raise_for_status()
    data = miss.json()
    results = []
    for name in data.get("missing", []):
        res = prefetch_single(base, name)
        results.append(res)
        print(json.dumps(res, ensure_ascii=False))
    return results


def prefetch_bulk(base: str, year_start: int | None, year_end: int | None, limit: int) -> dict:
    url = f"{base}/api/prefetch/driver-images"
    params = {}
    if year_start is not None and year_end is not None:
        params.update({"year_start": year_start, "year_end": year_end})
    if limit:
        params["limit"] = limit
    r = requests.get(url, params=params, timeout=120)
    r.raise_for_status()
    return r.json()


def main() -> int:
    args = parse_args()
    base = args.server.rstrip("/")

    # Mode 1: explicit names (comma list and/or file)
    explicit_names: List[str] = []
    if args.names:
        explicit_names.extend([n.strip() for n in args.names.split(",") if n.strip()])
    if args.from_file:
        path = pathlib.Path(args.from_file)
        if not path.exists():
            print(f"File not found: {path}", file=sys.stderr)
            return 2
        for line in path.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if s:
                explicit_names.append(s)

    if explicit_names:
        count = 0
        for name in explicit_names:
            if args.limit and count >= args.limit:
                break
            res = prefetch_single(base, name)
            count += 1
            print(json.dumps(res, ensure_ascii=False))
        return 0

    # Mode 2: fetch N missing via API list
    if args.fetch_missing:
        prefetch_missing(base, args.fetch_missing)
        return 0

    # Mode 3: bulk by year range or all
    out = prefetch_bulk(base, args.year_start, args.year_end, args.limit)
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


