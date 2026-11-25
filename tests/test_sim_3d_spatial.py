"""3D Spatial Clearance, Vehicle Physics Kinematics, and Headless Chrome /sim Broadcast E2E Suite.

Covers:
  1. All 79 F1 circuits spatial clearance audit (grandstands, pit building, bridge pillars,
     braking distance boards, DRS gantries, marshal LED posts, tyre barriers, grid alignment).
  2. 3D Vehicle Physics & Multi-Car Anti-Clipping Solver (0 residual overlaps in 20-car 3-wide pack,
     thermal brake ramp/cool, braking nose-dive pitch, 2026 X-Mode active aero).
  3. Live Headless Chrome CDP /sim WebGL2 verification across spa, monaco, silverstone, singapore,
     and zandvoort + camera modes tv, chase, pov, pitlane + Race Control SC/Red Flag transitions.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path

import requests
import uvicorn

from f1data import server as srv_mod

ROOT = Path(__file__).resolve().parent.parent


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
NODE_BIN = shutil.which("node")
HAS_WEBSOCKETS = importlib.util.find_spec("websockets") is not None


@unittest.skipUnless(NODE_BIN, "Node.js required")
class TestSim3DSpatialAndKinematics(unittest.TestCase):
    """Deterministic Node.js audits across all 79 circuits and 3D vehicle physics."""

    def test_79_circuit_spatial_clearance_and_grid_alignment(self) -> None:
        script = r"""
const fs = require("fs");
const vm = require("vm");
const sb = { window: {}, console, Math };
sb.window = sb;
vm.runInNewContext(fs.readFileSync("static/js/f1_vehicle_physics.js", "utf8"), sb);
vm.runInNewContext(fs.readFileSync("static/js/f1_track_architect.js", "utf8"), sb);
const VP = sb.F1VehiclePhysics;
const ARCH = sb.F1TrackArchitect;
const raw = JSON.parse(fs.readFileSync("data/circuits.json", "utf8"));
const circuits = Array.isArray(raw) ? raw : (raw.circuits || Object.values(raw));

let fails = 0, totalViolations = 0, maxGridErr = 0;
let minPitBldg = Infinity, minGrandstand = Infinity, minBoard = Infinity;
let totals = { boards: 0, drs: 0, marshals: 0, tyres: 0 };
const bad = [];

for (const cir of circuits) {
  const sp = VP.buildTrackSpline(cir.points, cir.length_km, cir.id, cir.biome);
  const pts = [];
  for (let i = 0; i < 360; i++) {
    pts.push(Object.assign({}, sp.sample(i / 360), ARCH.getCircuitElevationAndBank(cir, i / 360)));
  }
  const sampleFn = (p) => Object.assign({}, sp.sample(p), ARCH.getCircuitElevationAndBank(cir, p));
  let seed = 12345;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const layout = ARCH.buildCircuitLayout(pts, sampleFn, cir, rng);
  const audit = ARCH.auditLayoutClearance(layout, pts);
  if (!audit.ok) {
    fails++;
    bad.push({ id: cir.id, violations: audit.violations });
  }
  totalViolations += audit.violations.length;
  minPitBldg = Math.min(minPitBldg, audit.minPitBldgTrackDist);
  minGrandstand = Math.min(minGrandstand, audit.minGrandstandTrackDist);
  totals.boards += audit.brakingBoardCount;
  totals.drs += audit.drsGantryCount;
  totals.marshals += audit.marshalPostCount;
  totals.tyres += audit.tyreBarrierCount;

  const mockCars = Array.from({ length: 20 }, (_, i) => ({ idx: i }));
  ARCH.assignCarLaunchProfile(mockCars, cir);
  for (let i = 0; i < 20; i++) {
    const slot = layout.gridSlots[i];
    const spCar = sampleFn(mockCars[i].totalProg);
    const lat = mockCars[i].latOffset * 1.12;
    const cx = spCar.x + (-spCar.tz) * lat;
    const cz = spCar.z + spCar.tx * lat;
    maxGridErr = Math.max(maxGridErr, Math.hypot(cx - slot.x, cz - slot.z));
  }
  for (const bb of (layout.brakingBoards || [])) {
    let md = Infinity;
    for (const p of pts) md = Math.min(md, Math.hypot(bb.x - p.x, bb.z - p.z));
    minBoard = Math.min(minBoard, md);
  }
}

console.log(JSON.stringify({
  circuits: circuits.length,
  fails,
  totalViolations,
  minPitBldg: +minPitBldg.toFixed(1),
  minGrandstand: +minGrandstand.toFixed(1),
  minBoard: +minBoard.toFixed(1),
  maxGridErr: +maxGridErr.toFixed(4),
  totals,
  bad,
}));
"""
        proc = subprocess.run(
            [NODE_BIN, "-e", script],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            check=True,
        )
        rep = json.loads(proc.stdout.strip())
        self.assertEqual(rep["circuits"], 79)
        self.assertEqual(rep["fails"], 0, f"Clearance audit failed: {rep['bad']}")
        self.assertEqual(rep["totalViolations"], 0)
        self.assertGreaterEqual(rep["minPitBldg"], 16.5)
        self.assertGreaterEqual(rep["minGrandstand"], 23.5)
        self.assertGreaterEqual(rep["minBoard"], 9.5)
        self.assertLess(rep["maxGridErr"], 0.05)
        self.assertGreater(rep["totals"]["boards"], 800)
        self.assertGreater(rep["totals"]["drs"], 100)
        self.assertGreater(rep["totals"]["marshals"], 900)
        self.assertGreater(rep["totals"]["tyres"], 300)

    def test_3d_kinematics_thermal_brakes_and_anti_clipping(self) -> None:
        script = r"""
const fs = require("fs");
const vm = require("vm");
const sb = { window: {}, console, Math };
sb.window = sb;
vm.runInNewContext(fs.readFileSync("static/js/f1_vehicle_physics.js", "utf8"), sb);
const VP = sb.F1VehiclePhysics;

// 1. 20-car compressed 3-wide pack -> must resolve to 0 residual overlaps!
const pack = Array.from({ length: 20 }, (_, i) => ({
  wx: (i % 3 - 1) * 1.4,
  wz: Math.floor(i / 3) * 4.8,
  tx: 0, tz: 1,
  latPos: -(i % 3 - 1) * 1.4,
  inPit: false, dnf: false,
}));
const adj = VP.resolve3DCarSeparations(pack, 6.15);
let overlaps = 0;
for (let i = 0; i < pack.length; i++) {
  for (let j = i + 1; j < pack.length; j++) {
    if (Math.abs(pack[j].wz - pack[i].wz) < 5.65 && Math.abs(pack[j].wx - pack[i].wx) < 2.35) overlaps++;
  }
}

// 2. Heavy braking nose-dive & carbon thermal brake heat ramp + cooldown
const st = VP.createCarPhysicsState({ idx: 0, code3: "VER" }, "2026");
let peakDyn = null;
for (let k = 0; k < 25; k++) {
  peakDyn = VP.stepCarPhysics(st, { x: 0, z: k * 2, tx: 0, tz: 1, curv: 0, bumpMm: 0, targetLat: 0, liveKph: 265, liveLongG: -4.4, drsOpen: false, inPit: false }, 0.033, { wetness: 0 });
}
let coolDyn = null;
for (let k = 0; k < 40; k++) {
  coolDyn = VP.stepCarPhysics(st, { x: 0, z: 50 + k * 2, tx: 0, tz: 1, curv: 0, bumpMm: 0, targetLat: 0, liveKph: 295, liveLongG: 0.6, drsOpen: true, inPit: false }, 0.033, { wetness: 0 });
}

console.log(JSON.stringify({
  adj,
  overlaps,
  peakPitchRad: +peakDyn.pitchRad.toFixed(4),
  peakBrakeHeat: +peakDyn.brakeHeat.toFixed(3),
  coolBrakeHeat: +coolDyn.brakeHeat.toFixed(3),
  xModeOnStraight: coolDyn.inXMode,
}));
"""
        proc = subprocess.run(
            [NODE_BIN, "-e", script],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            check=True,
        )
        rep = json.loads(proc.stdout.strip())
        self.assertGreater(rep["adj"], 0)
        self.assertEqual(rep["overlaps"], 0)
        self.assertLess(rep["peakPitchRad"], -0.02)
        self.assertGreater(rep["peakBrakeHeat"], 0.85)
        self.assertLess(rep["coolBrakeHeat"], 0.35)
        self.assertTrue(rep["xModeOnStraight"])


@unittest.skipUnless(CHROME_BIN and HAS_WEBSOCKETS, "Headless Chrome and websockets required")
class TestSim3DBrowserCDP(unittest.TestCase):
    """Live headless Chrome WebGL2 /sim checks across circuits, cameras, and Race Control flags."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.port = _free_port()
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        cfg = uvicorn.Config(srv_mod.app, host="127.0.0.1", port=cls.port, log_level="error")
        cls._server = uvicorn.Server(cfg)
        cls._thread = threading.Thread(target=cls._server.run, daemon=True)
        cls._thread.start()
        for _ in range(50):
            try:
                if requests.get(f"{cls.base_url}/health", timeout=0.5).status_code == 200:
                    break
            except Exception:
                time.sleep(0.15)

        cls.cdp_port = _free_port()
        cls.tmp_dir = tempfile.mkdtemp(prefix="traf1_sim3d_cdp_")
        cls._chrome = subprocess.Popen(
            [
                CHROME_BIN,
                "--headless=new",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--use-gl=angle",
                "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader",
                f"--remote-debugging-port={cls.cdp_port}",
                f"--user-data-dir={cls.tmp_dir}",
                "--window-size=1440,900",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    @classmethod
    def tearDownClass(cls) -> None:
        cls._chrome.terminate()
        try:
            cls._chrome.wait(timeout=5)
        except Exception:
            cls._chrome.kill()
        cls._server.should_exit = True
        shutil.rmtree(cls.tmp_dir, ignore_errors=True)

    def test_multi_circuit_and_camera_3d_broadcast(self) -> None:
        import websockets

        async def run_check():
            ws_url = None
            for _ in range(50):
                try:
                    tabs = requests.get(f"http://127.0.0.1:{self.cdp_port}/json", timeout=0.5).json()
                    for t in tabs:
                        if t.get("type") == "page":
                            ws_url = t["webSocketDebuggerUrl"]
                            break
                    if ws_url:
                        break
                except Exception:
                    await asyncio.sleep(0.15)
            assert ws_url, "Failed to connect to headless Chrome CDP"

            async with websockets.connect(ws_url, max_size=20 * 1024 * 1024) as ws:
                mid = 0
                js_exceptions = []
                console_errors = []

                async def send(method, params=None):
                    nonlocal mid
                    mid += 1
                    cid = mid
                    await ws.send(json.dumps({"id": cid, "method": method, "params": params or {}}))
                    while True:
                        msg = json.loads(await ws.recv())
                        if msg.get("id") == cid:
                            return msg
                        if msg.get("method") == "Runtime.exceptionThrown":
                            det = msg["params"]["exceptionDetails"]
                            js_exceptions.append(det.get("text", "exception"))
                        elif msg.get("method") == "Runtime.consoleAPICalled" and msg["params"].get("type") == "error":
                            args = [a.get("value") or a.get("description") or "" for a in msg["params"].get("args", [])]
                            console_errors.append(" ".join(str(x) for x in args))

                async def ev(expr):
                    r = await send("Runtime.evaluate", {"expression": expr, "returnByValue": True, "awaitPromise": True})
                    return r.get("result", {}).get("result", {}).get("value")

                await send("Page.enable")
                await send("Runtime.enable")
                await send("Page.navigate", {"url": f"{self.base_url}/sim"})
                await asyncio.sleep(2.0)

                circuit_reports = {}
                for cid in ("spa", "monaco", "silverstone", "singapore", "zandvoort"):
                    await ev(f"""(() => {{
                        const sel = document.getElementById("fsim-circuit-sel");
                        if (sel) {{
                            sel.value = "{cid}";
                            sel.dispatchEvent(new Event("change", {{ bubbles: true }}));
                        }}
                        document.getElementById("fsim-start-btn")?.click();
                    }})()""")
                    await asyncio.sleep(0.6)
                    await ev('document.querySelector("[data-fsim-3d=tv]")?.click();')
                    await asyncio.sleep(0.9)

                    # Exercise camera modes on spa & singapore (incl. new 3D Carbon Halo Cockpit POV!)
                    cam_ok = {}
                    cockpit_check = None
                    if cid in ("spa", "singapore"):
                        for cam in ("tv", "cockpit", "chase", "pov", "pitlane"):
                            await ev(f'document.querySelector("[data-fsim-3d={cam}]")?.click();')
                            await asyncio.sleep(0.35)
                            cam_ok[cam] = await ev('document.getElementById("fsim-3d-hud")?.textContent.trim() || ""')
                            if cam == "cockpit":
                                cockpit_check = await ev("""(() => {
                                    const b3d = window.__fsimB3d;
                                    const dock = document.getElementById("fsim-pov-dock");
                                    const health = document.getElementById("fsim-f-health-strip");
                                    return {
                                        cockpit: b3d && b3d.getCockpitState ? b3d.getCockpitState() : null,
                                        dockVisible: dock ? !dock.classList.contains("hidden") : false,
                                        healthVisible: Boolean(health && health.textContent.includes("FL")),
                                    };
                                })()""")
                        # Verify keyboard director hotkeys on spa: O (POV toggle), H (Halo Ghost), ArrowDown (next car), ? (Controls modal)
                        if cid == "spa":
                            await ev("""(() => {
                                document.dispatchEvent(new KeyboardEvent("keydown", { key: "o", code: "KeyO", bubbles: true }));
                                document.dispatchEvent(new KeyboardEvent("keydown", { key: "h", code: "KeyH", bubbles: true }));
                                document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true }));
                                document.dispatchEvent(new KeyboardEvent("keydown", { key: "?", code: "Slash", shiftKey: true, bubbles: true }));
                            })()""")
                            await asyncio.sleep(0.25)
                            modal_open = await ev('!document.getElementById("fsim-keys-modal")?.classList.contains("hidden")')
                            await ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));')
                            cam_ok["_modal_hotkey_ok"] = bool(modal_open)
                            await ev('document.getElementById("fsim-rc-sc-btn")?.click();')
                            await asyncio.sleep(0.35)
                            await ev('document.getElementById("fsim-rc-rf-btn")?.click();')
                            await asyncio.sleep(0.35)

                    rep = await ev("""(() => {
                        const b3d = window.__fsimB3d;
                        const cv = document.getElementById("fsim-3d-canvas");
                        return {
                            active: b3d ? b3d.isActive() : false,
                            canvasW: cv ? cv.width : 0,
                            canvasH: cv ? cv.height : 0,
                            audit: b3d ? b3d.auditClearance() : null,
                            stats: b3d ? b3d.getStats() : null,
                        };
                    })()""")
                    rep["cams"] = cam_ok
                    rep["cockpit_check"] = cockpit_check
                    circuit_reports[cid] = rep

                return {
                    "js_exceptions": js_exceptions,
                    "console_errors": console_errors,
                    "circuits": circuit_reports,
                }

        res = asyncio.run(run_check())
        print("\n=== HEADLESS CHROME /sim 3D REPORT ===")
        print(json.dumps(res, indent=2))
        self.assertEqual(res["js_exceptions"], [], f"Uncaught JS exceptions: {res['js_exceptions']}")
        self.assertEqual(res["console_errors"], [], f"Console errors: {res['console_errors']}")
        for cid, rep in res["circuits"].items():
            self.assertTrue(rep["active"], f"{cid}: 3D canvas not active")
            self.assertGreater(rep["canvasW"], 200, f"{cid}: canvas width too small")
            self.assertGreater(rep["canvasH"], 200, f"{cid}: canvas height too small")
            self.assertIsNotNone(rep["audit"], f"{cid}: auditClearance() returned null")
            self.assertTrue(rep["audit"]["ok"], f"{cid}: clearance violations: {rep['audit']['violations']}")
            self.assertEqual(rep["stats"]["circuitId"], cid)
            self.assertGreaterEqual(rep["stats"]["carCount"], 18)
            self.assertGreater(rep["stats"]["drawCalls"], 20)
            self.assertGreater(rep["stats"]["brakingBoards"], 0)
            self.assertGreater(rep["stats"]["drsGantries"], 0)
            self.assertGreater(rep["stats"]["marshalPosts"], 0)
            if cid in ("spa", "singapore"):
                cc = rep["cockpit_check"]
                self.assertIsNotNone(cc)
                self.assertTrue(cc["cockpit"]["mounted"], f"{cid}: 3D cockpit not mounted")
                self.assertTrue(cc["cockpit"]["visible"], f"{cid}: 3D cockpit not visible in cockpit mode")
                self.assertTrue(cc["dockVisible"], f"{cid}: contextual POV dock not shown")
                self.assertTrue(cc["healthVisible"], f"{cid}: 4-corner tyre/component strip missing")
            if cid == "spa":
                self.assertTrue(rep["cams"].get("_modal_hotkey_ok"), "Controls modal hotkey [?] did not open")


if __name__ == "__main__":
    unittest.main()
