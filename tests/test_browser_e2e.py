"""Headless Chrome (CDP) end-to-end UI, console, responsive, and print-media test suite.

Uses system Chrome/Chromium + websockets (included with uvicorn[standard]) with zero extra deps.
Run from the traf1 directory:
    .venv/bin/python -m unittest tests/test_browser_e2e.py -v

Set TRAF1_SCREENSHOT_DIR=/path/to/dir to save PNG screenshots of key pages.
"""
from __future__ import annotations

import asyncio
import base64
import importlib.util
import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.parse
from pathlib import Path

import requests
import uvicorn

from f1data import server as srv_mod


def _find_chrome() -> str | None:
    for name in ("google-chrome", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    return None


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


CHROME_BIN = _find_chrome()
HAS_WEBSOCKETS = importlib.util.find_spec("websockets") is not None


@unittest.skipUnless(CHROME_BIN and HAS_WEBSOCKETS, "Headless Chrome and websockets required")
class TestBrowserE2E(unittest.TestCase):
    """End-to-end headless Chrome checks across desktop, mobile, tabs, and print media."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.port = _free_port()
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        config = uvicorn.Config(srv_mod.app, host="127.0.0.1", port=cls.port, log_level="error")
        cls._server = uvicorn.Server(config)
        cls._thread = threading.Thread(target=cls._server.run, daemon=True)
        cls._thread.start()
        deadline = time.time() + 15.0
        while time.time() < deadline:
            try:
                if requests.get(f"{cls.base_url}/api/seasons", timeout=2).status_code == 200:
                    break
            except Exception:
                pass
            time.sleep(0.1)
        seasons = requests.get(f"{cls.base_url}/api/seasons", timeout=5).json()
        cls.latest = seasons[-1]
        drivers = requests.get(f"{cls.base_url}/api/drivers/{cls.latest}", timeout=5).json()
        teams = requests.get(f"{cls.base_url}/api/teams/{cls.latest}", timeout=5).json()
        cls.sample_driver_slug = urllib.parse.quote((drivers[0]["driver"] if drivers else "Lewis Hamilton HAM").replace(" ", "-"))
        cls.sample_team_slug = urllib.parse.quote((teams[0]["team"] if teams else "Ferrari").replace(" ", "-"))

    @classmethod
    def tearDownClass(cls) -> None:
        cls._server.should_exit = True
        cls._thread.join(timeout=5)

    def test_desktop_mobile_tabs_and_print(self) -> None:
        shot_dir_env = os.environ.get("TRAF1_SCREENSHOT_DIR")
        shot_dir = Path(shot_dir_env) if shot_dir_env else None
        if shot_dir:
            shot_dir.mkdir(parents=True, exist_ok=True)

        report = asyncio.run(self._run_cdp_checks(shot_dir))

        # 1. Desktop checks across all pages
        for entry in report["desktop"]:
            name = entry["name"]
            with self.subTest(viewport="desktop", page=name):
                self.assertEqual(entry["console_errors"], [], f"Console errors on {name}: {entry['console_errors']}")
                self.assertEqual(entry["exceptions"], [], f"Uncaught JS exceptions on {name}: {entry['exceptions']}")
                self.assertEqual(entry["failed_local"], [], f"Failed local requests on {name}: {entry['failed_local']}")
                m = entry["metrics"]
                self.assertEqual(m["brokenImgs"], [], f"Broken images on {name}: {m['brokenImgs']}")
                self.assertLessEqual(m["overflow"], 1, f"Horizontal overflow on {name}: {m['overflow']}px")
                self.assertEqual(m["stuckReveal"], 0, f"Stuck invisible .reveal elements on {name}")
                if entry["tab_check"] is not None:
                    for tab in entry["tab_check"]:
                        self.assertTrue(tab["active"], f"Tab {tab['tab']} did not activate on {name}")
                        self.assertEqual(
                            tab["hiddenRevealCards"],
                            0,
                            f"Tab '{tab['tab']}' on {name} has invisible .reveal cards",
                        )

        # 2. Card headers must not be sticky
        self.assertFalse(report["card_header_sticky"], "Card .exhibit-head should not inherit position: sticky")

        # 3. Mobile (390x844) checks
        for entry in report["mobile"]:
            name = entry["name"]
            with self.subTest(viewport="mobile", page=name):
                self.assertEqual(entry["console_errors"], [], f"Mobile console errors on {name}")
                self.assertEqual(entry["exceptions"], [], f"Mobile JS exceptions on {name}")
                m = entry["metrics"]
                self.assertEqual(m["brokenImgs"], [], f"Mobile broken images on {name}")
                self.assertLessEqual(m["overflow"], 1, f"Mobile horizontal overflow on {name}: {m['overflow']}px")

        # 4. Print media visibility on /cards
        p = report["print_cards"]
        self.assertGreater(p["totalCards"], 0)
        self.assertEqual(
            p["visibleInPrint"],
            p["totalCards"],
            f"Expected all {p['totalCards']} cards visible in print media, got {p['visibleInPrint']}",
        )

    async def _run_cdp_checks(self, shot_dir: Path | None) -> dict:
        import websockets

        cdp_port = _free_port()
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as profile_dir:
            chrome_cmd = [
                CHROME_BIN,
                "--headless=new",
                f"--remote-debugging-port={cdp_port}",
                f"--user-data-dir={profile_dir}",
                "--no-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--window-size=1440,900",
                "about:blank",
            ]
            proc = subprocess.Popen(chrome_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
                    raise RuntimeError("Chrome CDP did not become ready")

                pages = [
                    ("home", "/"),
                    ("cards", "/cards"),
                    ("cards_decade", "/cards/decade?decade=1980"),
                    ("cards_alltime", "/cards/alltime"),
                    ("race", "/race"),
                    ("driver_search", "/driver?q=Hamilton"),
                    ("driver_profile", f"/driver/{self.sample_driver_slug}"),
                    ("team_profile", f"/team/{self.sample_team_slug}"),
                    ("races_latest", f"/races/{self.latest}"),
                    ("drivers_latest", f"/drivers/{self.latest}"),
                    ("teams_latest", f"/teams/{self.latest}"),
                    ("awards_latest", f"/awards/{self.latest}"),
                    ("analytics_overall", "/analytics/overall"),
                    ("analytics_season", f"/analytics/season?year={self.latest}"),
                    ("analytics_team", "/analytics/team"),
                    ("analytics_tracks", "/analytics/tracks"),
                    ("team_colors", "/admin/teams/colors"),
                    ("car_liveries", "/dev/car-liveries"),
                    ("car_3d", "/dev/car-3d"),
                    ("play_arena", "/play"),
                    ("full_sim", "/sim"),
                    ("career", "/career"),
                    ("car_composition", "/dev/car-composition"),
                    ("car_composition_v2", "/dev/car-composition-v2"),
                ]

                report: dict = {"desktop": [], "mobile": [], "print_cards": {}, "card_header_sticky": False}
                msg_id = 0

                async with websockets.connect(ws_url, max_size=25 * 1024 * 1024) as ws:
                    pending: dict[int, asyncio.Future] = {}
                    events: list[dict] = []

                    async def reader() -> None:
                        try:
                            async for raw in ws:
                                data = json.loads(raw)
                                if "id" in data and data["id"] in pending:
                                    pending.pop(data["id"]).set_result(data)
                                else:
                                    events.append(data)
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
                        res = await asyncio.wait_for(fut, timeout=20)
                        return res.get("result", {})

                    await send("Page.enable")
                    await send("Runtime.enable")
                    await send("Network.enable")

                    async def eval_js(expr: str):
                        res = await send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
                        return (res.get("result") or {}).get("value")

                    async def visit(name: str, path: str, width: int, height: int, mobile: bool = False, save_shot: bool = False) -> dict:
                        events.clear()
                        await send("Emulation.setDeviceMetricsOverride", {
                            "width": width, "height": height, "deviceScaleFactor": 1, "mobile": mobile
                        })
                        await send("Emulation.setEmulatedMedia", {"media": "screen"})
                        await send("Page.navigate", {"url": f"{self.base_url}{path}"})
                        deadline = time.time() + 12
                        while time.time() < deadline:
                            if any(e.get("method") == "Page.loadEventFired" for e in events):
                                break
                            await asyncio.sleep(0.1)
                        await asyncio.sleep(0.4)

                        console_errors = []
                        exceptions = []
                        failed_local = []
                        for e in events:
                            m = e.get("method")
                            p = e.get("params", {})
                            if m == "Runtime.exceptionThrown":
                                exceptions.append(p.get("exceptionDetails", {}).get("text", "exception"))
                            elif m == "Runtime.consoleAPICalled" and p.get("type") == "error":
                                console_errors.append(" ".join(str(a.get("value") or a.get("description") or "") for a in p.get("args", [])))
                            elif m == "Network.responseReceived":
                                resp = p.get("response", {})
                                st = resp.get("status", 200)
                                u = resp.get("url", "")
                                if st >= 400 and u.startswith(self.base_url):
                                    rel = u.replace(self.base_url, "")
                                    if rel != "/favicon.ico":
                                        failed_local.append({"url": rel, "status": st})

                        metrics = await eval_js("""(() => {
                            const imgs = Array.from(document.querySelectorAll('img')).filter(i => i.offsetParent !== null);
                            const brokenImgs = imgs.filter(i => i.complete && i.naturalWidth === 0).map(i => i.getAttribute('src'));
                            const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
                            const stuckReveal = Array.from(document.querySelectorAll('.reveal')).filter(el => {
                                const r = el.getBoundingClientRect();
                                return el.offsetParent !== null && r.top >= 0 && r.top < window.innerHeight && parseFloat(getComputedStyle(el).opacity) < 0.5;
                            }).length;
                            return { overflow, brokenImgs, stuckReveal };
                        })()""")

                        tab_check = None
                        if not mobile and name in ("home", "driver_profile", "team_profile"):
                            tab_check = await eval_js("""(async () => {
                                const tabs = Array.from(document.querySelectorAll('[data-tabs] [data-tab]'));
                                const res = [];
                                for (let i = 0; i < tabs.length; i++) {
                                    tabs[i].click();
                                    await new Promise(r => setTimeout(r, 260));
                                    const panels = document.querySelectorAll('[data-tabs] [data-tab-panel]');
                                    const p = panels[i];
                                    const hiddenCards = p ? Array.from(p.querySelectorAll('.reveal')).filter(el => parseFloat(getComputedStyle(el).opacity) < 0.5).length : 0;
                                    res.push({tab: tabs[i].textContent.trim(), active: p ? p.classList.contains('active') : false, hiddenRevealCards: hiddenCards});
                                }
                                if (tabs[0]) {
                                    tabs[0].click();
                                    await new Promise(r => setTimeout(r, 260));
                                }
                                return res;
                            })()""")

                        if save_shot and shot_dir is not None:
                            shot = await send("Page.captureScreenshot", {"format": "png"})
                            (shot_dir / f"{name}_{'mobile' if mobile else 'desktop'}.png").write_bytes(base64.b64decode(shot["data"]))

                        return {
                            "name": name,
                            "path": path,
                            "metrics": metrics,
                            "tab_check": tab_check,
                            "console_errors": console_errors,
                            "exceptions": exceptions,
                            "failed_local": failed_local,
                        }

                    shot_pages = {"home", "cards", "driver_profile", "team_profile", "race", "analytics_season", "team_colors", "car_3d", "car_liveries"}
                    for name, path in pages:
                        report["desktop"].append(await visit(name, path, 1440, 900, mobile=False, save_shot=(name in shot_pages)))

                    # Verify card header is not sticky
                    await send("Page.navigate", {"url": f"{self.base_url}/cards"})
                    await asyncio.sleep(0.5)
                    report["card_header_sticky"] = await eval_js("""(() => {
                        const h = document.querySelector('.exhibit-head');
                        return h ? getComputedStyle(h).position === 'sticky' : false;
                    })()""")

                    # Print media check on /cards
                    await send("Emulation.setDeviceMetricsOverride", {"width": 1200, "height": 900, "deviceScaleFactor": 1, "mobile": False})
                    await send("Emulation.setEmulatedMedia", {"media": "print"})
                    await asyncio.sleep(0.3)
                    report["print_cards"] = await eval_js("""(() => {
                        const cards = Array.from(document.querySelectorAll('.exhibit'));
                        const visibleCards = cards.filter(c => getComputedStyle(c).visibility === 'visible' && getComputedStyle(c).display !== 'none');
                        return { totalCards: cards.length, visibleInPrint: visibleCards.length };
                    })()""")
                    if shot_dir is not None:
                        shot = await send("Page.captureScreenshot", {"format": "png"})
                        (shot_dir / "cards_print.png").write_bytes(base64.b64decode(shot["data"]))

                    # Mobile checks
                    mobile_pages = [p for p in pages if p[0] in ("home", "cards", "driver_profile", "team_profile", "analytics_season", "team_colors", "full_sim", "career")]
                    for name, path in mobile_pages:
                        report["mobile"].append(await visit(name, path, 390, 844, mobile=True, save_shot=(name in ("home", "cards", "analytics_season"))))

                    reader_task.cancel()
                return report
            finally:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except Exception:
                    proc.kill()


if __name__ == "__main__":
    unittest.main()
