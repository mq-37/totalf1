/**
 * Automated Node regression tests for /drive AI speed calibration,
 * standing-start launch discipline, player-aware IDM spacing, and 2D OBB anti-clipping.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const phys = require("../static/js/f1_drive_physics.js");
const aiMod = require("../static/js/f1_drive_ai.js");

const MONZA_PTS = [];
for (let i = 0; i < 40; i++) {
  const a = (i / 40) * Math.PI * 2;
  MONZA_PTS.push([Math.cos(a) * 180 + Math.cos(a * 2) * 35, Math.sin(a) * 115]);
}
const CIRCUIT = {
  id: "monza",
  name: "Autodromo Nazionale Monza",
  length_km: 5.793,
  base_lap_s: 81.2,
  drs_ranges: [[0.85, 0.99], [0.42, 0.54]],
  points: MONZA_PTS,
};
const DNA_2026 = {
  era_key: "2026",
  top_speed_kph: 348,
  max_power_kw: 620,
  ers_power_kw: 350,
  ers_mj_lap: 4.0,
  mass_kg: 768,
  cl_base: 3.45,
  cd_base: 0.90,
  tyre_mu_base: 2.02,
  brake_max_g: 4.85,
  gears: 8,
  idle_rpm: 3800,
  redline_rpm: 13400,
  drs_enabled: true,
  active_aero: true,
  halo: true,
};

function makeGrid(playerSlot = 10) {
  const out = [];
  for (let i = 1; i <= 20; i++) {
    out.push({
      driver_id: i === playerSlot ? "player" : `ai_${i}`,
      name: i === playerSlot ? "Alex Vance" : `AI Driver ${i}`,
      code3: i === playerSlot ? "VAN" : `A${String(i).padStart(2, "0")}`,
      team: i % 2 === 0 ? "Ferrari" : "McLaren",
      color: i % 2 === 0 ? "#dc0000" : "#ff8000",
      grid_pos: i,
      car_rating: 92 - Math.floor(i / 2),
      pace: 92 - Math.floor(i / 2),
      racecraft: 86,
      wet: 84,
      tyre_care: 84,
      is_player: i === playerSlot,
    });
  }
  return out;
}

const track = phys.buildDriveTrack(CIRCUIT, DNA_2026);

// 1. Standing Start Test: No instant 10 m/s teleport AND ZERO rear-end collisions with stationary player at P10!
{
  const grid = makeGrid(10);
  const cfg = {
    mode: "gp",
    laps: 5,
    ai_difficulty: 78,
    physics_dna: DNA_2026,
    f1db_target_lap_ms: 81200,
    grid,
    player_driver: grid.find((g) => g.is_player),
  };
  const aiCtrl = aiMod.createAiAndGhostController(track, cfg);
  const startDistBack = aiMod.GRID_BASE_OFFSET_M + (10 - 1) * aiMod.GRID_SLOT_STEP_M;
  const startProg = (((1 - startDistBack / Math.max(1000, track.totalLen)) % 1) + 1) % 1;
  const startLat = 2.45;
  const playerCar = phys.createCarState(track, DNA_2026, { startProg, startLat, startLap: 0, compound: "soft" });

  // Force Lights Out immediately
  aiCtrl.startSeq.active = false;
  aiCtrl.startSeq.lightsOut = true;

  let t = 0;
  const dt = 1 / 60;
  let maxVxAt50ms = 0;
  let wingDamagedDuringStart = false;
  let maxPlayerImpact = 0;
  let obbOverlapsWithPlayer = 0;

  // Player sits completely stationary on the P10 grid slot for 4 full seconds (worst-case stall test!)
  for (let step = 0; step < 240; step++) {
    t += dt;
    aiCtrl.stepAi(dt, playerCar, 0, t);
    if (step === 3) {
      maxVxAt50ms = Math.max(...aiCtrl.aiCars.map((a) => a.vx));
    }
    if (playerCar.frontWingHealth < 100) wingDamagedDuringStart = true;
    maxPlayerImpact = Math.max(maxPlayerImpact, playerCar.impactStrength || 0);
    // Verify no AI car clips inside player OBB
    const pj = track.project(playerCar.x, playerCar.z, playerCar.trackIdx);
    for (const a of aiCtrl.aiCars) {
      let dp = a.prog - pj.prog;
      if (dp > 0.5) dp -= 1;
      if (dp < -0.5) dp += 1;
      const alongM = dp * track.totalLen;
      const acrossM = a.lat - pj.lat;
      if (Math.abs(alongM) < 5.2 && Math.abs(acrossM) < 2.05) {
        obbOverlapsWithPlayer += 1;
      }
    }
  }

  assert.ok(maxVxAt50ms < 2.5, `AI teleported on frame 3 of Lights Out: maxVxAt50ms=${maxVxAt50ms.toFixed(2)} m/s`);
  assert.equal(wingDamagedDuringStart, false, "Stationary player took front-wing damage at Lights Out!");
  assert.equal(obbOverlapsWithPlayer, 0, `AI cars clipped inside stationary player ${obbOverlapsWithPlayer} times!`);
  assert.ok(maxPlayerImpact < 0.25, `Stationary player suffered hard ramming impact=${maxPlayerImpact.toFixed(3)}`);
  console.log(`PASS 1 (Standing Start Safety): maxVx@50ms=${maxVxAt50ms.toFixed(2)} m/s, playerOverlaps=0, wingHealth=${playerCar.frontWingHealth}%`);
}

// 2. Realistic Acceleration & Speed Parity vs Real Player Physics (NO 4x rocket AI!)
{
  const grid = makeGrid(20);
  const cfg78 = { mode: "gp", laps: 5, ai_difficulty: 78, physics_dna: DNA_2026, f1db_target_lap_ms: 81200, grid };
  const cfg100 = { mode: "gp", laps: 5, ai_difficulty: 100, physics_dna: DNA_2026, f1db_target_lap_ms: 81200, grid };
  const cfg60 = { mode: "gp", laps: 5, ai_difficulty: 60, physics_dna: DNA_2026, f1db_target_lap_ms: 81200, grid };

  const runFor = (cfg, secs) => {
    const ctrl = aiMod.createAiAndGhostController(track, cfg);
    ctrl.startSeq.active = false;
    ctrl.startSeq.lightsOut = true;
    const dt = 1 / 60;
    let t = 0;
    let tTo200 = null;
    for (let s = 0; s < secs * 60; s++) {
      t += dt;
      ctrl.stepAi(dt, null, 0, t);
      const lead = ctrl.aiCars[0];
      if (tTo200 == null && lead.vx * 3.6 >= 200) tTo200 = t;
    }
    const lead = ctrl.aiCars[0];
    const distM = (lead.lap > 0 ? ((lead.lap - 1) + lead.prog + (1 - 0.996)) : Math.max(0, lead.prog - 0.996)) * track.totalLen;
    return { tTo200, avgKph: (distM / secs) * 3.6, endVxKph: lead.vx * 3.6 };
  };

  // Measure real player car 0-200 KPH on straight from rest
  const pCar = phys.createCarState(track, DNA_2026, { startProg: 0.90, startLat: 0, startLap: 0, compound: "soft" });
  let pTo200 = null;
  for (let s = 0; s < 120 * 10; s++) {
    phys.stepPhysics(pCar, track, { throttle: 1, brake: 0, steer: 0, ers: false, drs: false }, { tc: "med", abs: true, autoShift: true }, { wetness: 0, holdOnGrid: false }, 1 / 120);
    if (pTo200 == null && pCar.speedKph >= 200) pTo200 = (s + 1) / 120;
  }

  const r60 = runFor(cfg60, 25);
  const r78 = runFor(cfg78, 25);
  const r100 = runFor(cfg100, 25);

  assert.ok(r78.tTo200 != null && r78.tTo200 >= pTo200 * 0.85, `AI 78% accelerated unrealistically faster than player: AI=${r78.tTo200?.toFixed(2)}s vs Player=${pTo200?.toFixed(2)}s`);
  assert.ok(r60.avgKph < r78.avgKph && r78.avgKph < r100.avgKph, `Difficulty ladder broken: 60%=${r60.avgKph.toFixed(1)}, 78%=${r78.avgKph.toFixed(1)}, 100%=${r100.avgKph.toFixed(1)}`);
  console.log(`PASS 2 (Physics Speed Parity): Player 0-200=${pTo200.toFixed(2)}s | AI78 0-200=${r78.tTo200.toFixed(2)}s | Avg KPH 60%/78%/100% = ${r60.avgKph.toFixed(0)}/${r78.avgKph.toFixed(0)}/${r100.avgKph.toFixed(0)}`);
}

// 3. 35-Second Full 19-Car Pack Race: Zero AI-vs-AI OBB Overlaps!
{
  const grid = makeGrid(20);
  const ctrl = aiMod.createAiAndGhostController(track, { mode: "gp", laps: 5, ai_difficulty: 85, physics_dna: DNA_2026, f1db_target_lap_ms: 81200, grid });
  ctrl.startSeq.active = false;
  ctrl.startSeq.lightsOut = true;
  const dt = 1 / 60;
  let t = 0;
  let aiOverlaps = 0;
  for (let s = 0; s < 35 * 60; s++) {
    t += dt;
    ctrl.stepAi(dt, null, 0, t);
    if (s % 5 === 0) {
      for (let i = 0; i < ctrl.aiCars.length; i++) {
        const a = ctrl.aiCars[i];
        for (let j = i + 1; j < ctrl.aiCars.length; j++) {
          const b = ctrl.aiCars[j];
          let dp = b.prog - a.prog;
          if (dp > 0.5) dp -= 1;
          if (dp < -0.5) dp += 1;
          if (Math.abs(dp * track.totalLen) < 5.0 && Math.abs(b.lat - a.lat) < 2.0) {
            aiOverlaps += 1;
          }
        }
      }
    }
  }
  assert.equal(aiOverlaps, 0, `Detected ${aiOverlaps} AI-vs-AI OBB overlaps during 35s pack race!`);
  console.log("PASS 3 (Pack Anti-Clipping): 0 AI-vs-AI overlaps over 35s 19-car race!");
}

console.log("ALL 3 /drive AI LAUNCH, SPEED PARITY & ANTI-COLLISION SUITES PASSED!");
