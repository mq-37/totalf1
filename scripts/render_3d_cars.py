#!/usr/bin/env python3
"""Batch-render studio-lit transparent 3D F1 car PNGs for every team livery.

Uses the exact same Three.js 3D car model (static/js/f1_car_3d.js) rendered
once in headless Chrome via CDP, swapping palettes in-memory so all 201 teams
render in a few seconds. Outputs feed Cards, Teams, Car Liveries, and ReportLab PDFs.

Usage (from traf1/):
    .venv/bin/python scripts/render_3d_cars.py                     # render all 201 teams -> static/cars/png/
    .venv/bin/python scripts/render_3d_cars.py --team Ferrari      # single team
    .venv/bin/python scripts/render_3d_cars.py --preset front      # custom angle
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import requests
import uvicorn

TRAF1_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TRAF1_DIR))

from f1data.f1_car_palettes import load_palettes, slugify, find_slug, infer_livery_style, infer_team_era, era_for_year  # noqa: E402
from f1data.livery_registry import resolve_team_livery  # noqa: E402
from f1data import server as srv_mod  # noqa: E402


def _chassis_bucket(era_or_year: int | str) -> str:
    s = str(era_or_year).strip()
    if s.isdigit() and len(s) == 4:
        y = int(s)
        if y <= 1960: return "1955"
        if y <= 1967: return "1965"
        if y <= 1970: return "1968"
        if y <= 1972: return "1971"
        if y <= 1979: return "1975"
        if y <= 1988: return "1988"
        if y <= 1993: return "1991"
        if y <= 1997: return "1995"
        if y <= 2005: return "2004"
        if y <= 2008: return "2008"
        if y <= 2013: return "2012"
        if y <= 2016: return "2014"
        if y == 2017: return "2017"
        if y <= 2021: return "2020"
        if y <= 2025: return "2024"
        return "2026"
    return s or "2020s"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _find_chrome() -> str:
    for name in ("google-chrome", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    raise RuntimeError("Chrome/Chromium binary not found on PATH")


async def _batch_render(
    base_url: str,
    teams: list[tuple[str, str, dict[str, str], str, int | str, str]],
    out_dir: Path,
    preset: str,
    width: int,
    height: int,
    suffix: str = "",
) -> tuple[int, int]:
    import websockets

    chrome = _find_chrome()
    cdp_port = _free_port()
    out_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as profile_dir:
        proc = subprocess.Popen(
            [
                chrome,
                "--headless=new",
                f"--remote-debugging-port={cdp_port}",
                f"--user-data-dir={profile_dir}",
                "--no-sandbox",
                "--disable-gpu-sandbox",
                "--use-gl=angle",
                "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader",
                "--disable-dev-shm-usage",
                f"--window-size={width},{height}",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            ws_url = None
            for _ in range(40):
                try:
                    tabs = requests.get(f"http://127.0.0.1:{cdp_port}/json/list", timeout=1).json()
                    tab = next((t for t in tabs if t.get("type") == "page"), None)
                    if tab and tab.get("webSocketDebuggerUrl"):
                        ws_url = tab["webSocketDebuggerUrl"]
                        break
                except Exception:
                    pass
                time.sleep(0.25)
            if not ws_url:
                raise RuntimeError("Chrome CDP did not start")

            msg_id = 0
            async with websockets.connect(ws_url, max_size=25 * 1024 * 1024) as ws:
                pending: dict[int, asyncio.Future] = {}

                async def reader() -> None:
                    try:
                        async for raw in ws:
                            data = json.loads(raw)
                            if "id" in data and data["id"] in pending:
                                pending.pop(data["id"]).set_result(data)
                    except Exception:
                        pass

                reader_task = asyncio.create_task(reader())

                async def send(method: str, params: dict | None = None) -> dict:
                    nonlocal msg_id
                    msg_id += 1
                    cid = msg_id
                    fut = asyncio.get_event_loop().create_future()
                    pending[cid] = fut
                    await ws.send(json.dumps({"id": cid, "method": method, "params": params or {}}))
                    res = await asyncio.wait_for(fut, timeout=30)
                    return res.get("result", {})

                await send("Page.enable")
                await send("Runtime.enable")
                await send("Page.navigate", {"url": f"{base_url}/dev/car-render-harness"})

                # Wait until Three.js scene + harness is ready
                for _ in range(80):
                    r = await send("Runtime.evaluate", {"expression": "Boolean(window.__HARNESS_READY__)", "returnByValue": True})
                    if (r.get("result") or {}).get("value") is True:
                        break
                    await asyncio.sleep(0.15)
                else:
                    raise RuntimeError("3D render harness failed to initialize")

                written = 0
                rendered_unique = 0
                render_cache: dict[str, str] = {}
                manifest: dict[str, str] = {}
                presets = [p.strip() for p in preset.split(",") if p.strip()]
                multi = len(presets) > 1
                for name, slug, pal, style_name, era_or_year, finish_name in teams:
                    bucket = _chassis_bucket(era_or_year)
                    for pr in presets:
                        sfx = f"-{pr}" if multi else suffix
                        target_slug = f"{slug}{sfx}"
                        cache_key = json.dumps(
                            [bucket, pr, width, height, style_name, finish_name, pal],
                            sort_keys=True,
                        )
                        canon_slug = render_cache.get(cache_key)
                        if canon_slug is None:
                            expr = (
                                f"window.renderLiveryPng({json.dumps(pal)}, {json.dumps(pr)}, "
                                f"{width}, {height}, {json.dumps(style_name)}, {json.dumps(era_or_year)}, {json.dumps(finish_name)})"
                            )
                            r = await send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
                            val = (r.get("result") or {}).get("value")
                            if not isinstance(val, str) or not val.startswith("data:image/png;base64,"):
                                raise RuntimeError(f"Failed rendering {name} ({pr}, {era_or_year}): {r}")
                            png_bytes = base64.b64decode(val.split(",", 1)[1])
                            (out_dir / f"{target_slug}.png").write_bytes(png_bytes)
                            render_cache[cache_key] = target_slug
                            canon_slug = target_slug
                            rendered_unique += 1
                        manifest[target_slug] = canon_slug
                        written += 1

                if not multi and not suffix:
                    # Merge into existing manifest if --team filtered, else write fresh
                    mpath = out_dir / "manifest.json"
                    existing = json.loads(mpath.read_text(encoding="utf-8")) if mpath.exists() else {}
                    existing.update(manifest)
                    mpath.write_text(json.dumps(dict(sorted(existing.items())), indent=2), encoding="utf-8")

                reader_task.cancel()
                return written, rendered_unique
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()


def main() -> None:
    ap = argparse.ArgumentParser(description="Batch-render 3D F1 car livery PNGs via headless Chrome.")
    ap.add_argument("--out", default=str(TRAF1_DIR / "static" / "cars" / "png"), help="Output directory")
    ap.add_argument("--team", default=None, help="Filter substring for team name (optional)")
    ap.add_argument("--era", default=None, help="Force a specific era (1950s..2020s); defaults to team's historical era")
    ap.add_argument("--preset", default="card", help="Camera preset: card, hero, side, front, top, rear")
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=320)
    ap.add_argument("--suffix", default="", help="Optional filename suffix (e.g. -front)")
    args = ap.parse_args()

    palettes = load_palettes()
    db = srv_mod.get_db()
    year_map = srv_mod._team_peak_years_map(db)
    pal_by_slug = {slugify(name): (name, pal) for name, pal in palettes.items()}

    # 1. Default per-team PNG (<slug>.png) using team's peak/latest year + year-accurate livery registry!
    jobs: list[tuple[str, str, dict[str, str], str, int | str, str]] = []
    seen_targets: set[str] = set()
    for name, pal in palettes.items():
        if args.team and args.team.lower() not in name.lower():
            continue
        sl = slugify(name)
        peak_yr = year_map.get(name)
        if not peak_yr:
            era_fb = infer_team_era(name, team_years_map=year_map)
            peak_yr = int(era_fb[:4]) + 5 if era_fb[:4].isdigit() else 2026
        spec = resolve_team_livery(name, peak_yr)
        era_or_yr: int | str = args.era if args.era else int(peak_yr)
        jobs.append((name, sl, spec["palette"], spec["style"], era_or_yr, spec["finish"]))
        seen_targets.add(sl)

    # 2. Exact-year PNG (<slug>--<year>.png) AND decade PNG (<slug>--<era>.png) for EVERY (team, year) in F1 history!
    if not args.era:
        hist_exact: dict[tuple[str, int], str] = {}
        hist_decades: dict[tuple[str, str], tuple[int, str]] = {}
        for tbl in ("drivers_standings", "team_standings"):
            try:
                for row in db._conn.execute(f"SELECT DISTINCT team, year FROM {tbl} WHERE team IS NOT NULL AND team != ''").fetchall():
                    t_raw = str(row["team"])
                    y_int = int(row["year"])
                    sl = find_slug(t_raw)
                    if sl and sl in pal_by_slug:
                        hist_exact[(sl, y_int)] = t_raw
                        er = era_for_year(y_int)
                        prev = hist_decades.get((sl, er))
                        if prev is None or y_int > prev[0]:
                            hist_decades[(sl, er)] = (y_int, t_raw)
            except Exception:
                pass

        for (sl, er), (rep_yr, t_raw) in sorted(hist_decades.items()):
            tname, _ = pal_by_slug[sl]
            if args.team and args.team.lower() not in tname.lower() and args.team.lower() not in t_raw.lower():
                continue
            target_slug = f"{sl}--{er}"
            if target_slug not in seen_targets:
                spec = resolve_team_livery(t_raw, rep_yr)
                jobs.append((t_raw, target_slug, spec["palette"], spec["style"], rep_yr, spec["finish"]))
                seen_targets.add(target_slug)

        for (sl, y_int), t_raw in sorted(hist_exact.items()):
            tname, _ = pal_by_slug[sl]
            if args.team and args.team.lower() not in tname.lower() and args.team.lower() not in t_raw.lower():
                continue
            target_slug = f"{sl}--{y_int}"
            if target_slug not in seen_targets:
                spec = resolve_team_livery(t_raw, y_int)
                jobs.append((t_raw, target_slug, spec["palette"], spec["style"], y_int, spec["finish"]))
                seen_targets.add(target_slug)

    teams = jobs

    if not teams:
        print("No matching teams found.", file=sys.stderr)
        sys.exit(1)

    port = _free_port()
    base_url = f"http://127.0.0.1:{port}"
    config = uvicorn.Config(srv_mod.app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.time() + 15.0
        while time.time() < deadline:
            try:
                if requests.get(f"{base_url}/dev/car-render-harness", timeout=2).status_code == 200:
                    break
            except Exception:
                pass
            time.sleep(0.1)

        t0 = time.perf_counter()
        n, uniq = asyncio.run(_batch_render(base_url, teams, Path(args.out), args.preset, args.width, args.height, args.suffix))
        dt = time.perf_counter() - t0
        print(f"Rendered {n} 3D car PNGs ({uniq} unique WebGL renders) to {args.out} in {dt:.2f}s ({args.width}x{args.height}, preset={args.preset})")
    finally:
        server.should_exit = True
        thread.join(timeout=5)


if __name__ == "__main__":
    main()
