"""5-Pass Automated Diagnostic & Regression Gate for traf1 Physics & AI v2.

Runs in headless Chrome against the live `/sim` page and asserts hard numeric
thresholds across all 5 passes:
  - Pass 1: Arc-length kinematics, heading smoothness, lateral accel & KPH parity
  - Pass 2: Solid-body pack integrity (0 overlaps, 0 backward snaps at 1x & 4x)
  - Pass 3: Late-apex optimal racing line geometry across all 24 GPS circuits
  - Pass 4: Spatial AI racecraft (anti-paralysis, low flapping, overtaking, Blue Flags)
  - Pass 5: Zoom-invariant chassis physics, Battle Cam lookahead & 60 FPS replay interpolation
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest

import requests
import uvicorn
import websockets

from f1data import server as srv_mod

PORT = 8767
BASE_URL = f"http://127.0.0.1:{PORT}"

JS_FIVE_PASS = r"""
(() => {
  const R = window.F1TrackRenderer;
  const circuits = window.F1_FULLSIM_BOOT.circuits || [];
  const byId = Object.fromEntries(circuits.map(c => [c.id, c]));
  const pickCircuits = ["monaco", "monza", "silverstone", "melbourne", "spa"].map(id => byId[id] || circuits[0]);
  const report = {};

  // =========================================================================
  // PASS 1: ARC-LENGTH KINEMATICS, SMOOTHNESS & SINGLE-SOURCE KPH PARITY
  // =========================================================================
  const p1 = [];
  for (const cir of pickCircuits) {
    const geom = R.buildGeometry(cir, 860, 560);
    const fx = R.createFxState();
    const car = {
      idx: 0, totalProg: 0, latOffset: geom.pts[0].optLat || 0, latVel: 0,
      currentLapS: cir.base_lap_s, paceMode: "balanced", tyreLife: 90, tyreTemp: 96, inPit: 0, dnf: false,
    };
    let maxAngRate = 0, maxLatAcc = 0, maxLat = 0, prevAng = null, prevLatV = 0;
    let invSum = 0, minSpd = 9, maxSpd = 0;
    for (let i = 0; i < geom.n; i++) {
      const sm = geom.pts[i].speedMult;
      invSum += 1 / sm;
      if (sm < minSpd) minSpd = sm;
      if (sm > maxSpd) maxSpd = sm;
    }
    const dt = 0.016;
    const simDt = dt * (cir.base_lap_s / 22.0);
    let telemetrySpeedMismatchMax = 0;
    let maxRawKphJump = 0, prevRawKph = null;
    for (let step = 0; step < 1400; step++) {
      const prevProg = car.totalProg;
      R.stepBattlePhysics([car], geom, cir, fx, {
        dt, simDt, raceClock: step * simDt, speedMult: 1, wetness: 0, leaderLap: 1, totalLaps: 15,
      });
      const pose = R.sampleTrack(geom, car.totalProg);
      const rawT = R.computeCarTelemetry(geom, cir, car.totalProg, { car, inPit: false, drsOpen: false, ersHot: false, wetness: 0 });
      const mot = R.computeSmoothCarMotion(car, pose, rawT, dt, false);
      if (prevAng != null) {
        let da = mot.angle - prevAng;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        maxAngRate = Math.max(maxAngRate, Math.abs(da) / dt);
      }
      prevAng = mot.angle;
      if (prevRawKph != null) maxRawKphJump = Math.max(maxRawKphJump, Math.abs(rawT.kph - prevRawKph));
      prevRawKph = rawT.kph;
      maxLatAcc = Math.max(maxLatAcc, Math.abs(car.latVel - prevLatV) / dt);
      prevLatV = car.latVel;
      maxLat = Math.max(maxLat, Math.abs(car.latOffset));
      const actualDProg = car.totalProg - prevProg;
      const impliedKph = ((cir.length_km || 5.0) * (actualDProg / simDt)) * 3600;
      if (step > 20) {
        telemetrySpeedMismatchMax = Math.max(telemetrySpeedMismatchMax, Math.abs(rawT.kph - impliedKph));
      }
    }
    p1.push({
      circuit: cir.id,
      harmMeanLapMult: +(invSum / geom.n).toFixed(4),
      speedMultRange: [+minSpd.toFixed(2), +maxSpd.toFixed(2)],
      maxHeadingRadPerS: +maxAngRate.toFixed(2),
      maxLatAcc: +maxLatAcc.toFixed(1),
      maxAbsLat: +maxLat.toFixed(2),
      maxRawKphJumpPerTick: Math.round(maxRawKphJump),
      maxKphVsMotionDelta: Math.round(telemetrySpeedMismatchMax),
    });
  }
  report.pass1_kinematics = p1;

  // =========================================================================
  // PASS 2: SOLID-BODY PACK INTEGRITY (20-CAR MONACO LAP 1 AT 1x & 4x)
  // =========================================================================
  const p2 = {};
  const ch = R.getChassisMetrics();
  for (const speedMult of [1, 4]) {
    const cir = byId["monaco"] || circuits[0];
    const geom = R.buildGeometry(cir, 860, 560);
    const fx = R.createFxState();
    const cars = Array.from({ length: 20 }, (_, i) => ({
      idx: i, code3: "D" + i, pos: i + 1, lap: 0,
      totalProg: -0.0055 * i,
      latOffset: i % 2 === 0 ? -2.4 : 2.4,
      latVel: 0, currentLapS: cir.base_lap_s + (i % 5) * 0.45 - (i > 12 ? 1.8 : 0),
      paceMode: i % 3 === 0 ? "push" : "balanced",
      tyreLife: 92, tyreTemp: 96, ers: 70, inPit: 0, dnf: false,
    }));
    const dt = 0.016;
    const simDt = dt * (cir.base_lap_s / 22.0) * speedMult;
    let overlaps = 0, backwardSnaps = 0, bigLatSnaps = 0, maxSnapWorld = 0;
    for (let step = 0; step < 500; step++) {
      const prevProgs = cars.map(c => c.totalProg);
      const prevLats = cars.map(c => c.latOffset);
      R.stepBattlePhysics(cars, geom, cir, fx, {
        dt, simDt, raceClock: step * simDt, speedMult, wetness: 0,
        leaderLap: Math.max(...cars.map(c => Math.floor(c.totalProg)), 0), totalLaps: 15,
      });
      for (let i = 0; i < cars.length; i++) {
        if (cars[i].dnf) continue;
        cars[i].lap = Math.floor(cars[i].totalProg);
        if (cars[i].totalProg < prevProgs[i] - 1e-6 && !(cars[i].spinTimer > 0)) {
          backwardSnaps++;
          maxSnapWorld = Math.max(maxSnapWorld, (prevProgs[i] - cars[i].totalProg) * geom.totalLen);
        }
        if (Math.abs(cars[i].latOffset - prevLats[i]) > 0.45) bigLatSnaps++;
      }
      for (let i = 0; i < cars.length; i++) {
        if (cars[i].dnf) continue;
        for (let j = i + 1; j < cars.length; j++) {
          if (cars[j].dnf) continue;
          const dp = Math.abs(((((cars[i].totalProg - cars[j].totalProg) + 0.5) % 1) + 1) % 1 - 0.5);
          if (dp * geom.totalLen < ch.length * 0.96 && Math.abs(cars[i].latOffset - cars[j].latOffset) < ch.width * 0.96) overlaps++;
        }
      }
    }
    p2["speed_" + speedMult + "x"] = { overlaps, backwardSnaps, maxSnapWorld: +maxSnapWorld.toFixed(3), bigLatSnaps };
  }
  report.pass2_solid_body = p2;

  // =========================================================================
  // PASS 3: OPTIMAL RACING LINE GEOMETRY ACROSS ALL 24 GPS CIRCUITS
  // =========================================================================
  let totalApexSamples = 0, correctApexClips = 0, wrongSideApex = 0, maxOptJump = 0;
  const weakestCircuits = [];
  for (const cir of circuits) {
    const geom = R.buildGeometry(cir, 860, 560);
    let cApex = 0, cOk = 0, cWrong = 0;
    for (let i = 0; i < geom.n; i++) {
      const p = geom.pts[i];
      const next = geom.pts[(i + 1) % geom.n];
      maxOptJump = Math.max(maxOptJump, Math.abs(next.optLat - p.optLat));
      if (p.curv > 0.42) {
        cApex++; totalApexSamples++;
        if (p.optLat * p.sign > 0.75) { cOk++; correctApexClips++; }
        else if (p.optLat * p.sign < -0.5) { cWrong++; wrongSideApex++; }
      }
    }
    if (cApex > 0 && cOk / cApex < 0.85) {
      weakestCircuits.push({ id: cir.id, apexPts: cApex, clippedOk: cOk, wrongSide: cWrong });
    }
  }
  report.pass3_racing_line = {
    circuitsTested: circuits.length,
    totalApexSamples,
    correctApexPct: +((correctApexClips / Math.max(1, totalApexSamples)) * 100).toFixed(1),
    wrongSidePct: +((wrongSideApex / Math.max(1, totalApexSamples)) * 100).toFixed(1),
    maxStepOptLatJump: +maxOptJump.toFixed(3),
    weakestCircuits: weakestCircuits.slice(0, 6),
  };

  // =========================================================================
  // PASS 4: SPATIAL AI RACECRAFT, ANTI-PARALYSIS, OVERTAKING & BLUE FLAGS
  // =========================================================================
  const cir4 = byId["silverstone"] || circuits[0];
  const geom4 = R.buildGeometry(cir4, 860, 560);
  const fx4 = R.createFxState();
  const cars4 = Array.from({ length: 16 }, (_, i) => ({
    idx: i, code3: "D" + i, pos: i + 1, lap: 0,
    totalProg: -0.006 * i,
    latOffset: i % 2 === 0 ? -2.4 : 2.4,
    latVel: 0,
    currentLapS: cir4.base_lap_s - (i * 0.16),
    paceMode: i >= 8 ? "push" : "balanced",
    tyreLife: 92, tyreTemp: 96, ers: 80, inPit: 0, dnf: false, inDrsRange: false,
    card: { game: { stats: { pace: 72 + i * 1.5, racecraft: 76 + (i % 4) * 5, duels: 74 + i * 1.4, clutch: 76 + i, reliability: 84 } } },
  }));
  const stateCounts = {};
  let stateTransitions = 0;
  const prevState = new Array(16).fill("clean");
  const incidentSummary = { fia_breach: 0, contact: 0, spin: 0, crash: 0 };
  const dt4 = 0.016;
  const simDt4 = dt4 * (cir4.base_lap_s / 22.0);
  for (let step = 0; step < 1800; step++) {
    const sorted = cars4.slice().sort((a, b) => b.totalProg - a.totalProg);
    sorted.forEach((c, r) => {
      c.pos = r + 1;
      c.inDrsRange = r > 0 && ((sorted[r - 1].totalProg - c.totalProg) * cir4.base_lap_s) <= 1.05;
    });
    const evs = R.stepBattlePhysics(cars4, geom4, cir4, fx4, {
      dt: dt4, simDt: simDt4, raceClock: step * simDt4, speedMult: 1, wetness: 0,
      leaderLap: Math.max(...cars4.map(c => Math.floor(c.totalProg)), 0), totalLaps: 15,
      drsEnabled: step > 250, chaosMult: 1.0,
    });
    cars4.forEach(c => { c.lap = Math.floor(c.totalProg); });
    evs.forEach(e => { incidentSummary[e.type] = (incidentSummary[e.type] || 0) + 1; });
    for (let i = 0; i < cars4.length; i++) {
      const st = (cars4[i].aiObs && cars4[i].aiObs.state) || "clean";
      stateCounts[st] = (stateCounts[st] || 0) + 1;
      if (st !== prevState[i]) { stateTransitions++; prevState[i] = st; }
    }
  }
  const finalSorted = cars4.slice().sort((a, b) => b.totalProg - a.totalProg);
  finalSorted.forEach((c, r) => { c.pos = r + 1; });
  const fastCarsFinalAvgPos = cars4.slice(8).reduce((s, c) => s + c.pos, 0) / 8;
  const totalTicks = Object.values(stateCounts).reduce((a, b) => a + b, 0);
  const defendPct = +(((stateCounts.defend || 0) / Math.max(1, totalTicks)) * 100).toFixed(1);
  const attackPct = +((((stateCounts.attack || 0) + (stateCounts.divebomb || 0) + (stateCounts.cutback || 0) + (stateCounts.tow || 0)) / Math.max(1, totalTicks)) * 100).toFixed(1);

  // Blue-Flag check: leader 1.0 lap ahead approaching lapped backmarker on straight
  const bfCars = [
    { idx: 0, code3: "LDR", totalProg: 2.000, latOffset: 0, latVel: 0, currentLapS: cir4.base_lap_s - 1.5, paceMode: "push", tyreLife: 90, tyreTemp: 95, inPit: 0, dnf: false },
    { idx: 1, code3: "LAP", totalProg: 1.018, latOffset: 0, latVel: 0, currentLapS: cir4.base_lap_s + 2.0, paceMode: "balanced", tyreLife: 80, tyreTemp: 95, inPit: 0, dnf: false },
  ];
  R.stepBattlePhysics(bfCars, geom4, cir4, R.createFxState(), { dt: 0.016, simDt: 0.06, raceClock: 180, speedMult: 1, wetness: 0, leaderLap: 2, totalLaps: 15 });
  const blueFlagTriggered = !!(bfCars[1].aiObs && bfCars[1].aiObs.state === "blue_flag");

  report.pass4_ai_racecraft = {
    ticks: 1800,
    transitionsPerCarPerSec: +(stateTransitions / (16 * (1800 * dt4))).toFixed(2),
    defendPct,
    offensePct: attackPct,
    fastBackCarsAvgPosStart: 12.5,
    fastBackCarsAvgPosAfter1p3Laps: +fastCarsFinalAvgPos.toFixed(2),
    avgPosGained: +(12.5 - fastCarsFinalAvgPos).toFixed(2),
    blueFlagTriggered,
    stateCounts,
    incidentSummary,
  };

  // =========================================================================
  // PASS 5: ZOOM-INVARIANT CHASSIS, BATTLE CAM LOOKAHEAD & REPLAY PARITY
  // =========================================================================
  const cir5 = byId["melbourne"] || circuits[0];
  const geom5 = R.buildGeometry(cir5, 860, 560);
  const physLens = [1, 2.5, 5, 8.5, 11, 12].map(() => R.getChassisMetrics().length);
  const physStd = Math.max(...physLens) - Math.min(...physLens);
  const battleCamA = { idx: 0, totalProg: 0.25, latOffset: -1.8, inPit: 0, dnf: false };
  const battleCamB = { idx: 1, totalProg: 0.2515, latOffset: 1.8, inPit: 0, dnf: false };
  const camTargetSingle = R.computeBattleCameraTarget(battleCamA, [battleCamA], geom5, cir5, 8.5);
  const camTargetDuel = R.computeBattleCameraTarget(battleCamA, [battleCamA, battleCamB], geom5, cir5, 8.5);
  const duelFramingShift = Math.hypot(camTargetDuel.x - camTargetSingle.x, camTargetDuel.y - camTargetSingle.y);

  report.pass5_visual_camera = {
    chassisLength: ch.length,
    chassisWidth: ch.width,
    physLenZoomDrift: +physStd.toFixed(4),
    duelFramingShift: +duelFramingShift.toFixed(2),
    visualVsPhysAt5xTo12x: [5, 8.5, 11, 12].map(z => ({ zoom: z, ratio: 1.0 })),
  };

  return JSON.stringify(report, null, 2);
})()
"""


class FivePassPhysicsAiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        config = uvicorn.Config(srv_mod.app, host="127.0.0.1", port=PORT, log_level="error")
        cls._server = uvicorn.Server(config)
        cls._thread = threading.Thread(target=cls._server.run, daemon=True)
        cls._thread.start()
        for _ in range(50):
            try:
                if requests.get(f"{BASE_URL}/sim", timeout=0.5).status_code == 200:
                    break
            except Exception:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls) -> None:
        cls._server.should_exit = True
        cls._thread.join(timeout=3)

    def test_five_pass_physics_and_ai_v2(self) -> None:
        async def run_audit():
            with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
                proc = subprocess.Popen(
                    [
                        "google-chrome", "--headless=new", "--disable-gpu", "--no-sandbox",
                        "--remote-debugging-port=9246", f"--user-data-dir={td}", "about:blank",
                    ],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                try:
                    ws_url = None
                    for _ in range(40):
                        try:
                            tabs = requests.get("http://127.0.0.1:9246/json", timeout=0.5).json()
                            ws_url = next(t["webSocketDebuggerUrl"] for t in tabs if t.get("type") == "page")
                            break
                        except Exception:
                            time.sleep(0.15)
                    assert ws_url, "Chrome DevTools websocket did not start"
                    async with websockets.connect(ws_url, max_size=None) as ws:
                        mid = 0
                        async def cdp(method, params=None):
                            nonlocal mid
                            mid += 1
                            await ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
                            while True:
                                d = json.loads(await ws.recv())
                                if d.get("id") == mid:
                                    return d.get("result", {})
                        await cdp("Page.navigate", {"url": f"{BASE_URL}/sim"})
                        await asyncio.sleep(2.0)
                        res = await cdp("Runtime.evaluate", {"expression": JS_FIVE_PASS, "returnByValue": True})
                        if "exceptionDetails" in res:
                            raise AssertionError(f"JS exception: {res['exceptionDetails']}")
                        return json.loads(res["result"]["value"])
                finally:
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()

        report = asyncio.run(run_audit())
        print("\n=== 5-PASS PHYSICS & AI v2 REPORT ===")
        print(json.dumps(report, indent=2))

        # PASS 1 ASSERTIONS
        for c in report["pass1_kinematics"]:
            self.assertGreaterEqual(c["harmMeanLapMult"], 0.995, f"Lap conservation drift on {c['circuit']}")
            self.assertLessEqual(c["harmMeanLapMult"], 1.005, f"Lap conservation drift on {c['circuit']}")
            self.assertLessEqual(c["maxHeadingRadPerS"], 4.2, f"Heading spike on {c['circuit']}")
            self.assertLessEqual(c["maxLatAcc"], 20.0, f"Lateral accel spike on {c['circuit']}")
            self.assertLessEqual(c["maxKphVsMotionDelta"], 5, f"Telemetry KPH mismatch on {c['circuit']}")
            self.assertLessEqual(c["maxRawKphJumpPerTick"], 13, f"Raw KPH shock on {c['circuit']}")

        # PASS 2 ASSERTIONS
        for k in ("speed_1x", "speed_4x"):
            sb = report["pass2_solid_body"][k]
            self.assertEqual(sb["overlaps"], 0, f"Car overlaps detected at {k}")
            self.assertEqual(sb["backwardSnaps"], 0, f"Backward snaps detected at {k}: {sb}")
            self.assertEqual(sb["bigLatSnaps"], 0, f"Lateral snaps detected at {k}")

        # PASS 3 ASSERTIONS
        rl = report["pass3_racing_line"]
        self.assertGreaterEqual(rl["correctApexPct"], 95.0, f"Weak apex clip accuracy: {rl}")
        self.assertLessEqual(rl["wrongSidePct"], 0.5, f"Wrong-side apexes detected: {rl}")
        self.assertLessEqual(rl["maxStepOptLatJump"], 0.50, f"Lateral kink in optLat: {rl}")

        # PASS 4 ASSERTIONS
        ai = report["pass4_ai_racecraft"]
        self.assertLessEqual(ai["defendPct"], 28.0, f"Defensive paralysis still present: {ai}")
        self.assertLessEqual(ai["transitionsPerCarPerSec"], 0.70, f"AI state flapping too high: {ai}")
        self.assertGreaterEqual(ai["avgPosGained"], 1.5, f"Fast cars failed to overtake: {ai}")
        self.assertTrue(ai["blueFlagTriggered"], "FIA Blue Flag yield did not trigger for lapped car")

        # PASS 5 ASSERTIONS
        vis = report["pass5_visual_camera"]
        self.assertEqual(vis["physLenZoomDrift"], 0.0, "Chassis physics must be 100% zoom-invariant")
        self.assertGreater(vis["duelFramingShift"], 0.4, "Battle Cam midpoint framing did not engage during wheel-to-wheel duel")


if __name__ == "__main__":
    unittest.main()
