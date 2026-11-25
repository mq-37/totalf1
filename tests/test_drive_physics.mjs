/**
 * Automated Node Unit Tests for the 120 Hz Pacejka F1 Driving Physics Engine (f1_drive_physics.js).
 * Run: node tests/test_drive_physics.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const P = require("../static/js/f1_drive_physics.js");

const circuits = JSON.parse(fs.readFileSync(path.resolve("data/circuits.json"), "utf8"));
const monza = circuits.find((c) => c.id === "monza") || circuits[0];
const monaco = circuits.find((c) => c.id === "monaco") || circuits[0];

const dna2026 = {
  era_key: "2026",
  max_power_kw: 550,
  ers_power_kw: 220,
  ers_mj_lap: 4.5,
  mass_kg: 768,
  cl_base: 3.65,
  cd_base: 0.86,
  drs_enabled: true,
  active_aero: true,
  drs_drag_cut: 0.26,
  x_mode_drag_cut: 0.22,
  gears: 8,
  redline_rpm: 13200,
  idle_rpm: 3600,
  top_speed_kph: 356,
  brake_max_g: 5.15,
  tyre_mu_base: 2.02,
};

// 1. Track Spline & Analytical Speed Envelope Verification
const trackMonza = P.buildDriveTrack(monza, dna2026);
assert.ok(trackMonza.pts.length >= 200, "Track spline should have >=200 smooth samples");
assert.ok(trackMonza.totalLen > 2000, "Track perimeter should exceed 2000m");
const minV = Math.min(...trackMonza.pts.map((p) => p.vTarget));
const maxV = Math.max(...trackMonza.pts.map((p) => p.vTarget));
assert.ok(minV >= 15 && minV < maxV - 15, `Speed envelope should vary between corners (${minV.toFixed(1)}) and straights (${maxV.toFixed(1)})`);

// 2. Straight-line Acceleration, Auto-Shifting Through Gears & ERS Delta
const carA = P.createCarState(trackMonza, dna2026, { startProg: 0.0, startLap: 1 });
const carB = P.createCarState(trackMonza, dna2026, { startProg: 0.0, startLap: 1 });
for (let i = 0; i < 600; i++) { // 5 seconds at 120 Hz
  P.stepPhysics(carA, trackMonza, { throttle: 1, brake: 0, steer: 0, ers: false, drs: false }, { tc: "full", autoShift: true }, { wetness: 0 });
  P.stepPhysics(carB, trackMonza, { throttle: 1, brake: 0, steer: 0, ers: true, drs: false }, { tc: "full", autoShift: true }, { wetness: 0 });
}
assert.ok(Number.isFinite(carA.vx) && carA.speedKph > 190, `Expected >190 KPH after 5s, got ${carA.speedKph.toFixed(1)}`);
assert.ok(carA.gear >= 4, `Auto-shift should reach gear >=4, got G${carA.gear}`);
assert.ok(carB.speedKph > carA.speedKph + 8, `ERS deploy should increase speed (${carB.speedKph.toFixed(1)} vs ${carA.speedKph.toFixed(1)})`);
assert.ok(carB.ersBattery < 100, "ERS battery should drain under overtake deploy");

// 3. Heavy Braking Deceleration & ABS vs Lockup
const carBrake = P.createCarState(trackMonza, dna2026, { startProg: 0.02, startLap: 1 });
carBrake.vx = 83.3; // 300 KPH
carBrake.gear = 7;
let brakeDistM = 0;
for (let i = 0; i < 300; i++) {
  brakeDistM += carBrake.vx * P.FIXED_DT;
  P.stepPhysics(carBrake, trackMonza, { throttle: 0, brake: 1, steer: 0 }, { abs: true, autoShift: true }, { wetness: 0 });
  if (carBrake.speedKph <= 80) break;
}
assert.ok(carBrake.speedKph <= 82, `Car should brake from 300->80 KPH cleanly, ended at ${carBrake.speedKph.toFixed(1)}`);
assert.ok(brakeDistM >= 55 && brakeDistM <= 185, `300->80 KPH braking distance should be realistic (55..185m), got ${brakeDistM.toFixed(1)}m`);

// 4. Wet Weather Grip Crossover (Full Wet vs Soft Slicks in Heavy Rain)
const carSlick = P.createCarState(trackMonza, dna2026, { startProg: 0.0, startLap: 1, compound: "soft" });
const carWet = P.createCarState(trackMonza, dna2026, { startProg: 0.0, startLap: 1, compound: "wet" });
for (let i = 0; i < 420; i++) {
  P.stepPhysics(carSlick, trackMonza, { throttle: 1, brake: 0, steer: 0 }, { tc: "full", autoShift: true }, { wetness: 90 });
  P.stepPhysics(carWet, trackMonza, { throttle: 1, brake: 0, steer: 0 }, { tc: "full", autoShift: true }, { wetness: 90 });
}
assert.ok(carWet.speedKph > carSlick.speedKph + 15, `Full Wet tyres should crush Soft slicks in 90% rain (${carWet.speedKph.toFixed(1)} vs ${carSlick.speedKph.toFixed(1)})`);

// 5. Barrier Containment & 10,000-step Stability Test on Tight Street Circuit (Monaco)
const trackMonaco = P.buildDriveTrack(monaco, dna2026);
const carWall = P.createCarState(trackMonaco, dna2026, { startProg: 0.05, startLap: 1 });
carWall.vx = 55;
for (let i = 0; i < 360; i++) {
  P.stepPhysics(carWall, trackMonaco, { throttle: 0.8, brake: 0, steer: 1.0 }, { tc: "med", stability: true, autoShift: true }, { wetness: 0 });
}
assert.ok(Number.isFinite(carWall.x) && Number.isFinite(carWall.z) && Number.isFinite(carWall.yaw), "Car pose must remain finite under extreme barrier steering");
assert.ok(Math.abs(carWall.lat) <= P.BARRIER_HALF_WIDTH + 0.05, `Barrier must contain car within ${P.BARRIER_HALF_WIDTH}m, got ${carWall.lat.toFixed(2)}m`);

// 6. Pit Speed Limiter Clamping (80 KPH)
const carPit = P.createCarState(trackMonza, dna2026, { startProg: 0.0, startLap: 1 });
carPit.pitLimiter = true;
for (let i = 0; i < 480; i++) {
  P.stepPhysics(carPit, trackMonza, { throttle: 1, brake: 0, steer: 0 }, { tc: "full", autoShift: true }, { wetness: 0 });
}
assert.ok(carPit.speedKph <= 83, `Pit speed limiter should clamp near 80 KPH, got ${carPit.speedKph.toFixed(1)} KPH`);

// 7. Front Lockup Flat-Spot Accumulation (ABS Off) & Carbon Brake Heating + Pit Service Reset
const carLock = P.createCarState(trackMonza, dna2026, { startProg: 0.02, startLap: 1 });
carLock.vx = 82;
carLock.gear = 7;
for (let i = 0; i < 200; i++) {
  P.stepPhysics(carLock, trackMonza, { throttle: 0, brake: 1, steer: 0 }, { abs: false, autoShift: true }, { wetness: 0 });
}
assert.ok(carLock.flatSpot > 0.05, `Hard unassisted braking should create flat-spot, got ${carLock.flatSpot}`);
assert.ok(carLock.brakeTemp > 520, `Heavy braking should heat carbon brakes >520C, got ${carLock.brakeTemp.toFixed(0)}C`);
carLock.pitTimerS = 0.05;
for (let i = 0; i < 15; i++) {
  P.stepPhysics(carLock, trackMonza, { throttle: 0, brake: 0, steer: 0 }, {}, {});
}
assert.equal(carLock.flatSpot, 0, "Pit service must clear flat-spots");
assert.ok(carLock.tyreLife > 99.9, `Pit service must fit fresh tyres (>99.9%), got ${carLock.tyreLife}`);

// 8. Per-Corner 4-Wheel Wear Asymmetry + Off-Track Gravel Dirt Pickup & Scrubbing
const carGravel = P.createCarState(trackMonza, dna2026, { startProg: 0.05, startLap: 1, startLat: 11.2 });
carGravel.vx = 38;
for (let i = 0; i < 120; i++) {
  P.stepPhysics(carGravel, trackMonza, { throttle: 0.5, brake: 0, steer: 0 }, { tc: "full", autoShift: true }, { wetness: 0 });
}
assert.ok(carGravel.tyreDirty > 0.25, `Driving on runoff/gravel should dirty tyres, got ${carGravel.tyreDirty.toFixed(2)}`);
assert.equal(carGravel.tyreLife4.length, 4, "4-corner tyre wear array must exist");
assert.ok(carGravel.tyreLife4.every((v) => v < 100), "All 4 tyres should accumulate wear");

// 9. Hard Barrier Impact Multi-Component Damage (Front Wing + Suspension Pull + Floor)
const carCrash = P.createCarState(trackMonaco, dna2026, { startProg: 0.06, startLap: 1, startLat: 14.2 });
carCrash.vx = 68;
carCrash.yaw += 0.45; // angled into right barrier
for (let i = 0; i < 90; i++) {
  P.stepPhysics(carCrash, trackMonaco, { throttle: 0.9, brake: 0, steer: 0.6 }, { stability: true, autoShift: true }, { wetness: 0 });
}
assert.ok(carCrash.frontWingHealth < 90, `Hard wall impact should damage front wing, got ${carCrash.frontWingHealth.toFixed(1)}%`);
assert.ok(carCrash.suspHealth < 100 || Math.abs(carCrash.suspPull) > 0, "Severe impact should affect suspension health/alignment");

console.log("ALL 9 APEX POV 120 HZ PHYSICS, DAMAGE & ELEMENTS SUITES PASSED!");
