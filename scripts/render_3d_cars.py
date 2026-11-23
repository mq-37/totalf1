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
from f1data import server as srv_mod  # noqa: E402


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
    teams: list[tuple[str, str, dict[str, str], str]],
    out_dir: Path,
    preset: str,
    width: int,
    height: int,
    suffix: str = "",
) -> int:
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
                presets = [p.strip() for p in preset.split(",") if p.strip()]
                multi = len(presets) > 1
                for name, slug, pal, era_name in teams:
                    style_name = infer_livery_style(name)
                    for pr in presets:
                        expr = f"window.renderLiveryPng({json.dumps(pal)}, {json.dumps(pr)}, {width}, {height}, {json.dumps(style_name)}, {json.dumps(era_name)})"
                        r = await send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
                        val = (r.get("result") or {}).get("value")
                        if not isinstance(val, str) or not val.startswith("data:image/png;base64,"):
                            raise RuntimeError(f"Failed rendering {name} ({pr}): {r}")
                        png_bytes = base64.b64decode(val.split(",", 1)[1])
                        sfx = f"-{pr}" if multi else suffix
                        (out_dir / f"{slug}{sfx}.png").write_bytes(png_bytes)
                        written += 1

                reader_task.cancel()
                return written
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

    # 1. Default per-team PNG (<slug>.png)
    jobs: list[tuple[str, str, dict[str, str], str]] = []
    seen_targets: set[str] = set()
    for name, pal in palettes.items():
        if args.team and args.team.lower() not in name.lower():
            continue
        sl = slugify(name)
        era_name = args.era or infer_team_era(name, team_years_map=year_map)
        jobs.append((name, sl, pal, era_name))
        seen_targets.add(sl)

    # 2. Year/era-specific PNG (<slug>--<era>.png) for EVERY (team, decade) pair in F1 history!
    if not args.era:
        hist_pairs: set[tuple[str, str]] = set()
        for tbl in ("drivers_standings", "team_standings"):
            try:
                for row in db._conn.execute(f"SELECT DISTINCT team, year FROM {tbl} WHERE team IS NOT NULL AND team != ''").fetchall():
                    sl = find_slug(row["team"])
                    if sl and sl in pal_by_slug:
                        hist_pairs.add((sl, era_for_year(row["year"])))
            except Exception:
                pass
        for sl, er in sorted(hist_pairs):
            tname, pal = pal_by_slug[sl]
            if args.team and args.team.lower() not in tname.lower():
                continue
            target_slug = f"{sl}--{er}"
            if target_slug not in seen_targets:
                jobs.append((tname, target_slug, pal, er))
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
        n = asyncio.run(_batch_render(base_url, teams, Path(args.out), args.preset, args.width, args.height, args.suffix))
        dt = time.perf_counter() - t0
        print(f"Rendered {n} 3D car PNGs to {args.out} in {dt:.2f}s ({args.width}x{args.height}, preset={args.preset})")
    finally:
        server.should_exit = True
        thread.join(timeout=5)


if __name__ == "__main__":
    main()
