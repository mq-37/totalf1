#!/usr/bin/env python3
"""Helper CLI for the traf1-livery-audit skill.

Subcommands:
  list           List (team, year) entries from data/f1.sqlite with resolved livery specs.
  snapshot       Copy current studio PNGs into a before/ directory.
  fetch-refs     Politely fetch real Wikimedia Commons track photos for target (team, year).
  render-angles  Render multi-angle 3D PNGs (card,side,front,rear,top) via headless Chrome.
  compare        Build a Real Photo | Before | After visual comparison sheet PNG.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

TRAF1_DIR = Path(__file__).resolve().parents[4]
if str(TRAF1_DIR) not in sys.path:
    sys.path.insert(0, str(TRAF1_DIR))

UA = {"User-Agent": "TRAF1LiveryAudit/1.0 (https://github.com/traf1; local-audit)"}


def _query_db_pairs(year: int | None, team_sub: str | None) -> list[tuple[str, int]]:
    con = sqlite3.connect(TRAF1_DIR / "data" / "f1.sqlite")
    con.row_factory = sqlite3.Row
    pairs: set[tuple[str, int]] = set()
    for tbl in ("team_standings", "drivers_standings"):
        try:
            q = f"SELECT DISTINCT team, year FROM {tbl} WHERE team IS NOT NULL AND team != ''"
            params: list = []
            if year is not None:
                q += " AND year = ?"
                params.append(year)
            for r in con.execute(q, params).fetchall():
                t, y = str(r["team"]), int(r["year"])
                if team_sub and team_sub.lower() not in t.lower():
                    continue
                pairs.add((t, y))
        except Exception:
            pass
    con.close()
    return sorted(pairs, key=lambda x: (x[1], x[0]))


def cmd_list(args: argparse.Namespace) -> None:
    from f1data.livery_registry import resolve_team_livery
    from f1data.f1_car_palettes import find_car_png_slug

    pairs = _query_db_pairs(args.year, args.team)
    if not pairs:
        print("No matching (team, year) entries found.")
        return
    print(f"Found {len(pairs)} (team, year) entries:")
    for team, yr in pairs:
        spec = resolve_team_livery(team, yr)
        png = find_car_png_slug(team, year=yr) or "-"
        pal = spec["palette"]
        print(
            f"  {yr} | {team:30s} | style={spec['style']:18s} | finish={spec['finish']:8s} | "
            f"main={pal['main']} sec={pal['secondary']} acc={pal['accent']} | png={png}"
        )


def cmd_snapshot(args: argparse.Namespace) -> None:
    from f1data.f1_car_palettes import find_car_png_slug, slugify

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    png_dir = TRAF1_DIR / "static" / "cars" / "png"
    pairs = _query_db_pairs(args.year, args.team)
    if args.teams:
        wanted = [t.strip() for t in args.teams.split(",") if t.strip()]
        yr = args.year or 2026
        pairs = [(t, yr) for t in wanted]
    copied = 0
    for team, yr in pairs:
        canon = find_car_png_slug(team, year=yr)
        if not canon:
            continue
        src = png_dir / f"{canon}.png"
        if src.exists():
            dst = out / f"{slugify(team)}--{yr}_before.png"
            shutil.copy2(src, dst)
            copied += 1
            print(f"  saved {dst.name} <- {src.name}")
    print(f"Snapshotted {copied} before PNGs -> {out}")


def _wiki_search_images(query: str, limit: int = 4) -> list[tuple[str, str]]:
    url = (
        "https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch="
        + urllib.parse.quote(query)
        + f"&srnamespace=6&format=json&srlimit={limit + 3}"
    )
    data = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15).read())
    titles = [
        x["title"]
        for x in data.get("query", {}).get("search", [])
        if x["title"].lower().endswith((".jpg", ".jpeg"))
    ][:limit]
    if not titles:
        return []
    time.sleep(0.5)
    url2 = (
        "https://commons.wikimedia.org/w/api.php?action=query&titles="
        + urllib.parse.quote("|".join(titles))
        + "&prop=imageinfo&iiprop=url&iiurlwidth=960&format=json"
    )
    d2 = json.loads(urllib.request.urlopen(urllib.request.Request(url2, headers=UA), timeout=15).read())
    out = []
    for p in d2.get("query", {}).get("pages", {}).values():
        ii = p.get("imageinfo", [{}])[0]
        u = ii.get("thumburl") or ii.get("url")
        if u:
            u = u.replace("https://thumb.wikimedia.org/", "https://upload.wikimedia.org/").split("?")[0]
            out.append((p.get("title", ""), u))
    return out


def cmd_fetch_refs(args: argparse.Namespace) -> None:
    from f1data.f1_car_palettes import slugify

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    teams = [t.strip() for t in args.teams.split(",") if t.strip()]
    for team in teams:
        query = f"F1 {args.year} {team}" if not args.query_suffix else f"{args.query_suffix} {args.year} {team}"
        print(f"=== {team} ({args.year}) :: query='{query}' ===")
        time.sleep(args.delay)
        try:
            hits = _wiki_search_images(query, limit=args.per_team)
        except Exception as e:
            print(f"  search failed: {e}")
            continue
        for idx, (title, url) in enumerate(hits[: args.per_team]):
            time.sleep(args.delay)
            fn = f"{slugify(team)}_{args.year}_{idx}.jpg"
            try:
                raw = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20).read()
                (out / fn).write_bytes(raw)
                print(f"  OK {fn} ({len(raw)} bytes) <- {title}")
            except Exception as e:
                print(f"  FAIL {fn}: {e}")


def cmd_render_angles(args: argparse.Namespace) -> None:
    import requests
    import uvicorn
    from f1data import server as srv_mod
    from f1data.f1_car_palettes import slugify
    from f1data.livery_registry import resolve_team_livery
    from scripts.render_3d_cars import _batch_render, _free_port

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    if args.teams:
        pairs = [(t.strip(), args.year) for t in args.teams.split(",") if t.strip()]
    else:
        pairs = _query_db_pairs(args.year, args.team)

    jobs = []
    for team, yr in pairs:
        spec = resolve_team_livery(team, yr)
        jobs.append((team, f"{slugify(team)}--{yr}", spec["palette"], spec["style"], yr, spec["finish"]))

    if not jobs:
        print("No jobs to render.")
        return

    port = _free_port()
    base_url = f"http://127.0.0.1:{port}"
    server = uvicorn.Server(uvicorn.Config(srv_mod.app, host="127.0.0.1", port=port, log_level="error"))
    th = threading.Thread(target=server.run, daemon=True)
    th.start()
    try:
        for _ in range(60):
            try:
                if requests.get(f"{base_url}/dev/car-render-harness", timeout=1).status_code == 200:
                    break
            except Exception:
                time.sleep(0.1)
        try:
            n, uniq = asyncio.run(_batch_render(base_url, jobs, out, args.presets, args.width, args.height))
            print(f"Rendered {n} multi-angle PNGs ({uniq} unique) -> {out}")
        except OSError as e:
            # Ignore occasional Chrome temp profile dir cleanup race after PNGs are written
            if e.errno == 39:
                print(f"Rendered multi-angle PNGs -> {out} (ignored Chrome tmpdir cleanup race)")
            else:
                raise
    finally:
        server.should_exit = True
        th.join(timeout=3)


def cmd_compare(args: argparse.Namespace) -> None:
    from PIL import Image, ImageDraw

    rows = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    if not rows:
        print("Empty comparison manifest.")
        return

    def fit_tile(path: str, w: int, h: int, bg=(22, 26, 34)):
        im = Image.open(path).convert("RGBA")
        tile = Image.new("RGBA", (w, h), bg + (255,))
        im.thumbnail((w - 14, h - 14), Image.Resampling.LANCZOS)
        tile.alpha_composite(im, ((w - im.width) // 2, (h - im.height) // 2))
        return tile.convert("RGB")

    W, H, PAD, HEADER = 520, 270, 14, 40
    canvas = Image.new("RGB", (W * 3 + PAD * 4, (H + HEADER) * len(rows) + PAD * (len(rows) + 1)), (12, 15, 22))
    draw = ImageDraw.Draw(canvas)
    for r_idx, row in enumerate(rows):
        y0 = PAD + r_idx * (H + HEADER + PAD)
        draw.text((PAD, y0 + 3), str(row["title"]), fill=(240, 244, 250))
        cols = [
            (row.get("ref_label", "REAL PHOTO"), row["ref"]),
            (row.get("before_label", "TRAF1 BEFORE"), row["before"]),
            (row.get("after_label", "TRAF1 AFTER"), row["after"]),
        ]
        for c_idx, (lbl, path) in enumerate(cols):
            x0 = PAD + c_idx * (W + PAD)
            draw.text((x0 + 4, y0 + 21), lbl, fill=(148, 163, 184))
            canvas.paste(fit_tile(path, W, H), (x0, y0 + HEADER))

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)
    print(f"Saved comparison sheet ({len(rows)} rows) -> {out_path}")


def main() -> None:
    ap = argparse.ArgumentParser(description="TRAF1 Per-Year Livery Audit Helper CLI")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", help="List (team, year) entries and resolved liveries")
    p_list.add_argument("--year", type=int, default=None)
    p_list.add_argument("--team", type=str, default=None)
    p_list.set_defaults(func=cmd_list)

    p_snap = sub.add_parser("snapshot", help="Copy current studio PNGs to a before/ directory")
    p_snap.add_argument("--year", type=int, default=None)
    p_snap.add_argument("--team", type=str, default=None)
    p_snap.add_argument("--teams", type=str, default=None, help="Comma-separated team names")
    p_snap.add_argument("--out", required=True)
    p_snap.set_defaults(func=cmd_snapshot)

    p_ref = sub.add_parser("fetch-refs", help="Fetch real Wikimedia Commons photos for target teams")
    p_ref.add_argument("--year", type=int, required=True)
    p_ref.add_argument("--teams", type=str, required=True, help="Comma-separated team names")
    p_ref.add_argument("--out", required=True)
    p_ref.add_argument("--per-team", type=int, default=2)
    p_ref.add_argument("--delay", type=float, default=1.2)
    p_ref.add_argument("--query-suffix", type=str, default="")
    p_ref.set_defaults(func=cmd_fetch_refs)

    p_ren = sub.add_parser("render-angles", help="Render multi-angle 3D PNGs via headless Chrome")
    p_ren.add_argument("--year", type=int, required=True)
    p_ren.add_argument("--team", type=str, default=None)
    p_ren.add_argument("--teams", type=str, default=None, help="Comma-separated team names")
    p_ren.add_argument("--presets", type=str, default="card,side,front,rear")
    p_ren.add_argument("--width", type=int, default=800)
    p_ren.add_argument("--height", type=int, default=400)
    p_ren.add_argument("--out", required=True)
    p_ren.set_defaults(func=cmd_render_angles)

    p_cmp = sub.add_parser("compare", help="Generate Real Photo | Before | After visual comparison sheet")
    p_cmp.add_argument("--manifest", required=True, help="JSON list of {title, ref, before, after}")
    p_cmp.add_argument("--out", required=True)
    p_cmp.set_defaults(func=cmd_compare)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
