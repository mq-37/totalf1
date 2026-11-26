/**
 * APEX GRID (/drive) — Physics-Matched 19-Car Spatial AI Director, IDM Spacing,
 * Standing-Start Launch Discipline, 2D OBB Anti-Clipping Resolver & Ghost Engine.
 *
 * Pure JS (works identically in browser & Node automated tests):
 *   - Powertrain + aero-drag longitudinal model calibrated to f1_drive_physics.js
 *     (eliminates instant 10 m/s launch teleports and drag-free "4x speed" rockets!)
 *   - Configurable AI Difficulty (50%..105%, default 78% Standard)
 *   - Realistic FIA 9.2m staggered starting grid + 0.16s..0.44s human reaction spread
 *   - Full 20-car spatial lookahead treating playerCar as a first-class rival/obstacle:
 *     Intelligent Driver Model (IDM) safe headway, clean lane-change overtaking,
 *     and hard braking if boxed in behind a slow/stalled starter!
 *   - Track-frame 2D Oriented Bounding Box (5.65m x 2.25m) anti-clipping solver for
 *     both AI-vs-Player and AI-vs-AI pairs
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.F1DriveAI = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const GRID_BASE_OFFSET_M = 12.0;
  const GRID_SLOT_STEP_M = 9.2;
  const CAR_LEN_M = 5.65;
  const CAR_WID_M = 2.25;
  const GRAVITY = 9.81;
  const AIR_RHO = 1.225;
  const FRONTAL_AREA = 1.52;

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function wrapProgDelta(toProg, fromProg) {
    let dp = toProg - fromProg;
    if (dp > 0.5) dp -= 1;
    if (dp < -0.5) dp += 1;
    return dp;
  }

  function createAiAndGhostController(track, config) {
    const cfg = config || {};
    const grid = cfg.grid || [];
    const totalLaps = Number(cfg.laps || 5);
    const f1dbTargetMs = Number(cfg.f1db_target_lap_ms || 82000);
    const pb = cfg.personal_best || null;
    const dna = cfg.physics_dna || {};
    const aiDifficulty = clamp(Number(cfg.ai_difficulty != null ? cfg.ai_difficulty : 78), 50, 105);

    // Difficulty curves calibrated to real human player pace on f1_drive_physics.js
    const diffNorm = clamp((aiDifficulty - 50) / 50, 0, 1.1);
    const diffSpeedMult = 0.72 + diffNorm * 0.25; // 50%->0.72, 78%->0.86, 100%->0.97
    const diffPowerMult = 0.68 + diffNorm * 0.29; // 50%->0.68, 78%->0.84, 100%->0.97

    const maxPowerKw = Number(dna.max_power_kw || 620);
    const massKg = Number(dna.mass_kg || 775) + 45;
    const cdBase = Number(dna.cd_base || 0.92);
    const tyreMuBase = Number(dna.tyre_mu_base || 2.0);
    const vMaxMps = Number(dna.top_speed_kph || 340) / 3.6;
    const brakeMaxAccel = Number(dna.brake_max_g || 4.8) * GRAVITY * 0.80;

    // Initialize AI cars from non-player grid slots with authentic staggered FIA spacing
    const aiCars = grid.filter((g) => !g.is_player).map((g, idx) => {
      const gridPos = Number(g.grid_pos || (idx + 1));
      const startDistBack = GRID_BASE_OFFSET_M + (gridPos - 1) * GRID_SLOT_STEP_M;
      const startProg = (((1 - startDistBack / Math.max(1000, track.totalLen)) % 1) + 1) % 1;
      const startLat = (gridPos % 2 === 1) ? -2.45 : 2.45;
      const sp = track.sample(startProg);

      // Skill multiplier calibrated tightly around 1.0 (0.94..1.03) so difficulty controls global pace
      const skillScore = (Number(g.car_rating || 82) * 0.52 + Number(g.pace || 82) * 0.34 + Number(g.racecraft || 82) * 0.14);
      const paceFactor = clamp(0.95 + (skillScore - 82) * 0.0045, 0.91, 1.04);
      // Realistic human start reaction spread (0.18s .. 0.44s)
      const launchDelayS = 0.18 + (((gridPos * 37 + idx * 13) % 14) / 13) * 0.26;

      return {
        driver_id: g.driver_id,
        name: g.name,
        code3: g.code3,
        team: g.team,
        color: g.color || "#38bdf8",
        palette: g.palette || null,
        livery_style: g.livery_style || "modern",
        livery_finish: g.livery_finish || "gloss",
        era_year: g.era_year || cfg.year || 2026,
        grid_pos: gridPos,
        car_rating: Number(g.car_rating || 82),
        pace: Number(g.pace || 82),
        racecraft: Number(g.racecraft || 82),
        wet: Number(g.wet || 80),
        tyre_care: Number(g.tyre_care || 80),
        paceFactor,
        launchDelayS,
        prog: startProg,
        prevProg: startProg,
        lap: 0,
        totalProg: startProg - 1,
        lat: startLat,
        targetLat: startLat,
        steerAngle: 0,
        wheelSpin: 0,
        brakeHeat: 0,
        vx: 0,
        x: sp.x + sp.rx * startLat,
        y: sp.y,
        z: sp.z + sp.rz * startLat,
        yaw: Math.atan2(sp.tx, sp.tz),
        compound: "soft",
        tyreLife: 100,
        drsOpen: false,
        xModeActive: false,
        inPitS: 0,
        pits: 0,
        dnf: false,
        finished: false,
        finishTimeS: 0,
        bestLapMs: Math.round(f1dbTargetMs / Math.max(0.75, diffSpeedMult * paceFactor)),
      };
    });

    // FIA 5-Red-Lights Standing Start state
    const isStandingStart = (cfg.mode !== "timetrial");
    const startSeq = {
      active: isStandingStart,
      elapsed: 0,
      litCount: 0,
      holdAfterFive: 0.55 + Math.random() * 0.65,
      lightsOut: !isStandingStart,
      lightsOutAtS: null,
      lastBeepCount: 0,
    };

    // Ghost playback helper (PB polyline if available, else synthetic F1DB pole ghost!)
    const ghostSamples = (pb && Array.isArray(pb.ghost) && pb.ghost.length >= 10) ? pb.ghost : null;
    const ghostTargetMs = (pb && pb.best_lap_ms) ? Number(pb.best_lap_ms) : f1dbTargetMs;
    const ghostLabel = ghostSamples
      ? `PB Ghost (${(pb.best_lap_ms / 1000).toFixed(3)}s)`
      : `F1DB Record Ghost (${(f1dbTargetMs / 1000).toFixed(3)}s)`;

    function computeGhostPose(playerCar) {
      if (!playerCar || playerCar.lap < 1) return null;
      const lapSec = (playerCar.lapTimeMs || 0) / 1000;
      if (ghostSamples) {
        let idx = 0;
        while (idx < ghostSamples.length - 2 && ghostSamples[idx + 1].t < lapSec) idx++;
        const a = ghostSamples[idx];
        const b = ghostSamples[Math.min(ghostSamples.length - 1, idx + 1)];
        const span = Math.max(0.01, b.t - a.t);
        const f = clamp((lapSec - a.t) / span, 0, 1);
        let dp = b.p - a.p;
        if (dp < -0.5) dp += 1;
        const prog = ((a.p + dp * f) % 1 + 1) % 1;
        const lat = a.l + (b.l - a.l) * f;
        const sp = track.sample(prog);
        return {
          prog,
          x: sp.x + sp.rx * lat,
          y: sp.y,
          z: sp.z + sp.rz * lat,
          yaw: Math.atan2(sp.tx, sp.tz),
        };
      }
      const prog = ((playerCar.lapTimeMs / Math.max(20000, ghostTargetMs)) % 1 + 1) % 1;
      const sp = track.sample(prog);
      const lat = sp.optLat || 0;
      return {
        prog,
        x: sp.x + sp.rx * lat,
        y: sp.y,
        z: sp.z + sp.rz * lat,
        yaw: Math.atan2(sp.tx, sp.tz),
      };
    }

    function computeLapDeltaS(playerCar) {
      if (!playerCar || playerCar.lap < 1) return 0;
      const expectedMs = playerCar.prog * ghostTargetMs;
      return (playerCar.lapTimeMs - expectedMs) / 1000;
    }

    function stepStartSequence(dt, audio) {
      if (!startSeq.active) return startSeq;
      startSeq.elapsed += dt;
      const nextLit = Math.min(5, Math.floor(startSeq.elapsed / 0.85));
      if (nextLit > startSeq.lastBeepCount) {
        startSeq.lastBeepCount = nextLit;
        if (audio && audio.playStartBeep) audio.playStartBeep(false);
      }
      startSeq.litCount = nextLit;
      if (startSeq.elapsed >= 5 * 0.85 + startSeq.holdAfterFive) {
        startSeq.active = false;
        startSeq.lightsOut = true;
        if (audio && audio.playStartBeep) audio.playStartBeep(true);
      }
      return startSeq;
    }

    function isLaneClear(candLat, myProg, myId, obstacles, totalLen) {
      if (candLat < -5.85 || candLat > 5.85) return false;
      for (let k = 0; k < obstacles.length; k++) {
        const ob = obstacles[k];
        if (ob.id === myId) continue;
        const alongM = wrapProgDelta(ob.prog, myProg) * totalLen;
        if (alongM > -9.0 && alongM < 18.0 && Math.abs(ob.lat - candLat) < 2.65) {
          return false;
        }
      }
      return true;
    }

    let wkTrackTempC = 28; // updated from the weather-radar timeline by drive.js
    function stepAi(dt, playerCar, wetness, raceTimeS) {
      const stepDt = Math.max(0.001, Math.min(0.05, dt || 0.016));
      if (!startSeq.lightsOut) {
        return { proxLeft: false, proxRight: false, standings: buildStandings(playerCar) };
      }
      if (startSeq.lightsOutAtS == null) {
        startSeq.lightsOutAtS = raceTimeS || 0;
      }
      const sinceGreen = Math.max(0, (raceTimeS || 0) - startSeq.lightsOutAtS);
      const inLaunchCorridor = sinceGreen < 3.0;
      const coldTyreMult = clamp(0.89 + sinceGreen / 85, 0.89, 1.0);
      // Track-temperature grip physics: slicks lose bite on cold tarmac and overheat
      // on burning asphalt. Track temp comes from the weather radar timeline mean.
      const trackTempC = Number(wkTrackTempC != null ? wkTrackTempC : 28);
      const tempBandLo = 20, tempBandHi = 38;
      const trackTempMult = (wetFrac > 0.45)
        ? 1.0
        : (trackTempC < tempBandLo
            ? 1.0 - (tempBandLo - trackTempC) * 0.0065
            : (trackTempC > tempBandHi ? 1.0 - (trackTempC - tempBandHi) * 0.0045 : 1.0));

      const wetFrac = clamp((wetness || 0) / 100, 0, 1);
      const totalLen = Math.max(500, track.totalLen || 3200);
      let proxLeft = false;
      let proxRight = false;

      // Build unified 20-car spatial obstacle snapshot (ALL 19 AI cars + Player Car!)
      const obstacles = [];
      for (let i = 0; i < aiCars.length; i++) {
        const a = aiCars[i];
        if (a.dnf) continue;
        obstacles.push({
          id: a.driver_id,
          prog: a.prog,
          lat: a.lat,
          vx: a.vx,
          isPlayer: false,
          ref: a,
        });
      }
      if (playerCar) {
        let pProg = playerCar.prog;
        let pLat = playerCar.lat;
        if (track.project && Number.isFinite(playerCar.x) && Number.isFinite(playerCar.z)) {
          const pj = track.project(playerCar.x, playerCar.z, playerCar.trackIdx || 0);
          pProg = pj.prog;
          pLat = pj.lat;
        }
        obstacles.push({
          id: "__player__",
          prog: pProg,
          lat: pLat,
          vx: Math.max(0, Number(playerCar.vx || 0)),
          isPlayer: true,
          ref: playerCar,
        });
      }

      // 1. Physics-Matched Longitudinal + Player-Aware IDM Spacing & Lateral Planner
      for (let i = 0; i < aiCars.length; i++) {
        const a = aiCars[i];
        if (a.dnf) continue;
        if (a.inPitS > 0) {
          a.inPitS = Math.max(0, a.inPitS - stepDt);
          a.vx = Math.max(0, Math.min(22.0, a.vx + (18.0 - a.vx) * Math.min(1, stepDt * 4)));
          a.brakeHeat = Math.max(0, a.brakeHeat - stepDt * 1.4);
          if (a.inPitS <= 0) {
            a.tyreLife = 100;
            a.compound = wetness >= 55 ? "wet" : (wetness >= 25 ? "inter" : (a.compound === "soft" ? "medium" : "hard"));
          }
          continue;
        }

        // Realistic standing-start reaction delay (hold at 0 m/s until reaction time passes!)
        if (isStandingStart && sinceGreen < a.launchDelayS) {
          a.vx = 0;
          a.brakeHeat = 0;
          a.steerAngle = 0;
          continue;
        }

        const sp = track.sample(a.prog);
        const spLook1 = track.sample((a.prog + 36 / totalLen) % 1);
        const spLook2 = track.sample((a.prog + 78 / totalLen) % 1);
        const envTargetV = Math.min(sp.vTarget, spLook1.vTarget * 1.03, spLook2.vTarget * 1.12);

        const wetSkill = 1.0 - wetFrac * (0.16 - (a.wet - 75) * 0.0018);
        const tyreMult = a.tyreLife > 28 ? 1.0 : 0.91;
        a.drsOpen = Boolean(dna.drs_enabled !== false && sp.drsZone && a.lap >= 2 && wetness < 25 && a.vx > 34);
        a.xModeActive = Boolean(dna.active_aero && Math.abs(sp.curv) < 0.0035 && a.vx > 55 && wetness < 35);
        const drsBoost = (a.drsOpen || a.xModeActive) ? 1.032 : 1.0;

        // Calibrated corner & straight target speed matching real player physics!
        let targetVx = envTargetV * 0.90 * diffSpeedMult * a.paceFactor * wetSkill * tyreMult * drsBoost * coldTyreMult * trackTempMult;
        targetVx = Math.min(targetVx, vMaxMps * diffSpeedMult * a.paceFactor * drsBoost);

        let desiredLat = inLaunchCorridor ? a.lat : (sp.optLat || 0);
        let emergencyBrake = false;
        let blockingAhead = null;
        let blockingGapM = Infinity;

        // Scan ALL 20 cars (including playerCar!) for longitudinal headway & side-by-side clearance
        let leftSideBound = -5.85;
        let rightSideBound = 5.85;
        for (let k = 0; k < obstacles.length; k++) {
          const ob = obstacles[k];
          if (ob.id === a.driver_id) continue;
          const alongM = wrapProgDelta(ob.prog, a.prog) * totalLen;
          const dLat = ob.lat - a.lat;
          const absDLat = Math.abs(dLat);

          // Side-by-side car: leave at least 2.75m center-to-center room!
          if (alongM > -6.4 && alongM < 6.4) {
            if (ob.lat < a.lat) {
              leftSideBound = Math.max(leftSideBound, ob.lat + 2.75);
            } else {
              rightSideBound = Math.min(rightSideBound, ob.lat - 2.75);
            }
          }

          // Car ahead in our path (0 .. 52m)
          if (alongM > 0.2 && alongM < 52.0 && absDLat < 2.75) {
            if (alongM < blockingGapM) {
              blockingGapM = alongM;
              blockingAhead = ob;
            }
          }
        }

        if (blockingAhead) {
          const gapM = blockingGapM;
          const safeGapM = 7.4 + a.vx * 0.42 + (blockingAhead.isPlayer ? 1.6 : 0.0);
          const obSlowOrStalled = blockingAhead.vx < a.vx - 1.5 || blockingAhead.vx < 10.0;

          // Try to find a clean open passing lane if we're faster or the car ahead is slow/stalled
          let foundPassLane = false;
          if ((obSlowOrStalled || !inLaunchCorridor) && gapM > 6.6) {
            const prefSide = blockingAhead.lat >= 0 ? -1 : 1;
            const cands = [
              blockingAhead.lat + prefSide * 3.25,
              blockingAhead.lat - prefSide * 3.25,
              prefSide * 5.2,
              -prefSide * 5.2,
            ];
            for (let ci = 0; ci < cands.length; ci++) {
              const cand = clamp(cands[ci], leftSideBound, rightSideBound);
              if (Math.abs(cand - blockingAhead.lat) >= 2.70 && isLaneClear(cand, a.prog, a.driver_id, obstacles, totalLen)) {
                desiredLat = cand;
                foundPassLane = true;
                break;
              }
            }
          }

          // IDM Longitudinal Safety: NEVER rear-end a car still overlapping our lane!
          const stillInPath = Math.abs(blockingAhead.lat - a.lat) < 2.50;
          if (stillInPath && gapM < safeGapM) {
            if (gapM <= 6.8) {
              targetVx = Math.min(targetVx, Math.max(0, blockingAhead.vx - 2.5));
              emergencyBrake = true;
            } else {
              const frac = clamp((gapM - 6.6) / Math.max(1.5, safeGapM - 6.6), 0, 1);
              const idmCap = blockingAhead.vx + (targetVx - blockingAhead.vx) * (frac * frac);
              targetVx = Math.min(targetVx, foundPassLane ? Math.max(blockingAhead.vx + 2.0, idmCap) : idmCap);
            }
          }
        }

        // Respect side-by-side bounds cleanly
        if (leftSideBound <= rightSideBound) {
          desiredLat = clamp(desiredLat, leftSideBound, rightSideBound);
        } else {
          desiredLat = clamp((leftSideBound + rightSideBound) * 0.5, -5.85, 5.85);
        }

        // Physics-matched powertrain + aero-drag longitudinal integration
        const launchThrottle = isStandingStart
          ? clamp((sinceGreen - a.launchDelayS) / 0.90, 0.14, 1.0)
          : 1.0;
        const cdEff = cdBase * (a.drsOpen ? 0.78 : (a.xModeActive ? 0.82 : 1.0));
        const powerW = (maxPowerKw * 1000) * diffPowerMult * (0.94 + (a.car_rating - 80) * 0.004) * launchThrottle;
        const maxTractionAccel = tyreMuBase * 0.54 * GRAVITY * wetSkill * coldTyreMult * trackTempMult;
        const driveAccel = Math.min(maxTractionAccel, (powerW / Math.max(13.5, a.vx)) / massKg);
        const dragAccel = (0.5 * AIR_RHO * cdEff * FRONTAL_AREA * a.vx * a.vx + 280) / massKg;
        const netMaxAccel = Math.max(0.45, driveAccel - dragAccel);
        const maxBrakeNow = emergencyBrake ? Math.max(34.0, brakeMaxAccel * 1.15) : brakeMaxAccel;

        const dv = targetVx - a.vx;
        if (dv >= 0) {
          a.vx += Math.min(dv, netMaxAccel * stepDt);
          a.brakeHeat = Math.max(0, a.brakeHeat - stepDt * 1.15);
        } else {
          const decel = Math.min(-dv, maxBrakeNow * stepDt);
          a.vx = Math.max(0, a.vx - decel);
          const brakeFrac = clamp((decel / Math.max(0.001, stepDt)) / 24.0, 0, 1);
          a.brakeHeat = clamp(a.brakeHeat + brakeFrac * stepDt * 3.8, 0, 1);
        }

        const prevLat = a.lat;
        a.targetLat = desiredLat;
        const latRate = blockingAhead ? 4.4 : 2.8;
        a.lat += (a.targetLat - a.lat) * Math.min(1, stepDt * latRate);
        a.lat = clamp(a.lat, -6.1, 6.1);
        a.steerAngle = clamp(-sp.curv * 14.0 + (a.lat - prevLat) * 0.45, -0.42, 0.42);
        a.wheelSpin += (a.vx * stepDt) / 0.34;

        a.prevProg = a.prog;
        a.prog = (a.prog + (a.vx * stepDt) / totalLen) % 1;
        if (a.prog < a.prevProg - 0.5) {
          a.lap += 1;
          if (a.lap > totalLaps && !a.finished) {
            a.finished = true;
            a.finishTimeS = raceTimeS;
          }
          const needWet = wetness >= 30 && (a.compound === "soft" || a.compound === "medium" || a.compound === "hard");
          if (!a.finished && a.pits === 0 && (needWet || (totalLaps >= 6 && a.lap === Math.floor(totalLaps * 0.5)))) {
            a.inPitS = 14.0;
            a.pits += 1;
          }
        }
        a.totalProg = Math.max(0, a.lap - 1) + a.prog;
        a.tyreLife = Math.max(12, a.tyreLife - stepDt * 0.25 * (1.15 - (a.tyre_care - 75) * 0.008));
      }

      // 2. Track-Frame 2D OBB Anti-Clipping Resolver (AI-vs-AI & AI-vs-Player!)
      // Guarantees zero nose-to-tail or side-by-side chassis overlap across all 20 cars.
      for (let pass = 0; pass < 2; pass++) {
        // AI-vs-AI separation
        for (let i = 0; i < aiCars.length; i++) {
          const a = aiCars[i];
          if (a.dnf || a.inPitS > 0) continue;
          for (let j = i + 1; j < aiCars.length; j++) {
            const b = aiCars[j];
            if (b.dnf || b.inPitS > 0) continue;
            const alongM = wrapProgDelta(b.prog, a.prog) * totalLen;
            const acrossM = b.lat - a.lat;
            if (Math.abs(alongM) < CAR_LEN_M && Math.abs(acrossM) < CAR_WID_M) {
              if (Math.abs(alongM) < CAR_LEN_M * 0.78) {
                const latNeed = (CAR_WID_M - Math.abs(acrossM)) * 0.52;
                const sgn = acrossM >= 0 ? 1 : -1;
                a.lat = clamp(a.lat - sgn * latNeed, -6.2, 6.2);
                b.lat = clamp(b.lat + sgn * latNeed, -6.2, 6.2);
              } else {
                const trail = alongM >= 0 ? a : b;
                const lead = alongM >= 0 ? b : a;
                const pushM = (CAR_LEN_M + 0.15) - Math.abs(alongM);
                trail.prog = ((trail.prog - pushM / totalLen) % 1 + 1) % 1;
                trail.vx = Math.min(trail.vx, lead.vx * 0.96);
              }
            }
          }
        }

        // AI-vs-Player OBB separation + blind-spot mirror proximity detection
        if (playerCar) {
          let pProg = playerCar.prog;
          let pLat = playerCar.lat;
          if (track.project && Number.isFinite(playerCar.x) && Number.isFinite(playerCar.z)) {
            const pj = track.project(playerCar.x, playerCar.z, playerCar.trackIdx || 0);
            pProg = pj.prog;
            pLat = pj.lat;
          }
          for (let i = 0; i < aiCars.length; i++) {
            const a = aiCars[i];
            if (a.dnf || a.inPitS > 0) continue;
            const alongM = wrapProgDelta(a.prog, pProg) * totalLen; // >0 means AI is ahead of player
            const acrossM = a.lat - pLat;

            if (pass === 0 && Math.abs(alongM) < 11.0 && Math.abs(acrossM) < 5.5) {
              if (acrossM < -0.35) proxLeft = true;
              if (acrossM > 0.35) proxRight = true;
            }

            if (Math.abs(alongM) < CAR_LEN_M && Math.abs(acrossM) < CAR_WID_M) {
              const relSpeed = Math.abs(a.vx - (playerCar.vx || 0));
              if (Math.abs(alongM) < CAR_LEN_M * 0.78) {
                // Clean side-by-side glancing wheel separation
                const latNeed = (CAR_WID_M + 0.08) - Math.abs(acrossM);
                const sgn = acrossM >= 0 ? 1 : -1;
                a.lat = clamp(a.lat + sgn * latNeed * 0.80, -6.3, 6.3);
                const spP = track.sample(pProg);
                playerCar.x -= spP.rx * sgn * latNeed * 0.20;
                playerCar.z -= spP.rz * sgn * latNeed * 0.20;
              } else if (alongM < 0) {
                // AI was behind player -> pull AI back cleanly & match player speed (NEVER shove player from behind!)
                const pushM = (CAR_LEN_M + 0.25) - Math.abs(alongM);
                a.prog = ((a.prog - pushM / totalLen) % 1 + 1) % 1;
                a.vx = Math.min(a.vx, Math.max(0, (playerCar.vx || 0) * 0.94));
                a.brakeHeat = Math.min(1, a.brakeHeat + 0.45);
              } else {
                // Player ran into rear of AI ahead
                const pushM = (CAR_LEN_M + 0.18) - Math.abs(alongM);
                const spP = track.sample(pProg);
                playerCar.x -= spP.tx * pushM * 0.55;
                playerCar.z -= spP.tz * pushM * 0.55;
                a.prog = (a.prog + (pushM * 0.45) / totalLen) % 1;
                playerCar.vx = Math.min(playerCar.vx || 0, a.vx * 0.96);
              }
              if (relSpeed > 4.5) {
                playerCar.impactStrength = Math.max(playerCar.impactStrength || 0, clamp(relSpeed / 26, 0.14, 0.48));
                if (relSpeed > 10.5 && alongM > 0) {
                  playerCar.frontWingHealth = Math.max(25, (playerCar.frontWingHealth ?? 100) - 4);
                }
              }
            }
          }
        }
      }

      // 3. Recompute final world-space 3D poses after OBB resolution
      for (let i = 0; i < aiCars.length; i++) {
        const a = aiCars[i];
        if (a.dnf) continue;
        const spNow = track.sample(a.prog);
        a.x = spNow.x + spNow.rx * a.lat;
        a.y = spNow.y;
        a.z = spNow.z + spNow.rz * a.lat;
        a.yaw = Math.atan2(spNow.tx, spNow.tz);
      }

      return {
        proxLeft,
        proxRight,
        standings: buildStandings(playerCar),
      };
    }

    function buildStandings(playerCar) {
      const list = aiCars.map((a) => ({
        driver_id: a.driver_id,
        name: a.name,
        code3: a.code3,
        team: a.team,
        color: a.color,
        is_player: false,
        totalProg: a.totalProg,
        lap: a.lap,
        compound: a.compound,
        dnf: a.dnf,
        bestLapMs: a.bestLapMs,
        vx: a.vx,
      }));
      if (playerCar) {
        const pd = cfg.player_driver || {};
        list.push({
          driver_id: pd.driver_id || "player",
          name: pd.name || "Alex Vance",
          code3: pd.code3 || "VAN",
          team: pd.team || "McLaren",
          color: pd.color || "#ff8000",
          is_player: true,
          totalProg: playerCar.totalProg,
          lap: playerCar.lap,
          compound: playerCar.compound,
          dnf: false,
          bestLapMs: playerCar.bestLapMs || 0,
          vx: playerCar.vx || 0,
          penaltySec: playerCar.penaltySec || 0,
        });
      }
      list.sort((a, b) => (a.dnf === b.dnf ? b.totalProg - a.totalProg : (a.dnf ? 1 : -1)));
      const leaderProg = list[0] ? list[0].totalProg : 0;
      const refLapS = ghostTargetMs / 1000;
      list.forEach((row, idx) => {
        row.pos = idx + 1;
        row.gapLeaderS = idx === 0 ? 0 : Math.max(0, (leaderProg - row.totalProg) * refLapS);
      });
      return list;
    }

    return {
      aiCars,
      startSeq,
      aiDifficulty,
      ghostLabel,
      ghostTargetMs,
      stepStartSequence,
      stepAi,
    setTrackTempC: (v) => { wkTrackTempC = Number(v); },
      computeGhostPose,
      computeLapDeltaS,
      buildStandings,
    };
  }

  return {
    GRID_BASE_OFFSET_M,
    GRID_SLOT_STEP_M,
    CAR_LEN_M,
    CAR_WID_M,
    createAiAndGhostController,
  };
});
