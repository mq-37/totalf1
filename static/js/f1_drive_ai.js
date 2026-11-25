/**
 * Apex POV (/drive) — 19-Car Spatial F1DB-Calibrated AI Director, Collision Resolver & Ghost Engine.
 *
 * Features:
 *   - Drives up to 19 AI cars calibrated from F1DB/rating_engine Pace, Racecraft, Wet & Car Rating
 *   - Spatial lateral overtaking & defensive lane selection + smooth bounding-capsule anti-clipping
 *   - Player-vs-AI glancing side-by-side contact & proximity blind-spot detection
 *   - FIA 5-Red-Lights Standing Start sequence (with jump-start penalty detection)
 *   - Time Trial Ghost playback (Personal Best SQLite polyline OR synthetic F1DB pole-pace ghost)
 */
(function (global) {
  "use strict";

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function createAiAndGhostController(track, config) {
    const grid = (config && config.grid) || [];
    const totalLaps = Number((config && config.laps) || 5);
    const f1dbTargetMs = Number((config && config.f1db_target_lap_ms) || 82000);
    const pb = (config && config.personal_best) || null;

    // Initialize AI cars from non-player grid slots
    const aiCars = grid.filter((g) => !g.is_player).map((g) => {
      const gridPos = Number(g.grid_pos || 1);
      // Staggered FIA 2x2 grid behind S/F line (8m longitudinal spacing per slot)
      const startDistBack = 10 + (gridPos - 1) * 7.8;
      const startProg = (((1 - startDistBack / Math.max(1000, track.totalLen)) % 1) + 1) % 1;
      const startLat = (gridPos % 2 === 1) ? -2.4 : 2.4;
      const sp = track.sample(startProg);

      // Skill multiplier calibrated to F1DB rating_engine attributes
      const skillScore = (Number(g.car_rating || 82) * 0.52 + Number(g.pace || 82) * 0.34 + Number(g.racecraft || 82) * 0.14);
      const paceFactor = clamp(0.86 + (skillScore - 76) * 0.0072, 0.84, 1.035);
      return {
        driver_id: g.driver_id,
        name: g.name,
        code3: g.code3,
        team: g.team,
        color: g.color || "#38bdf8",
        grid_pos: gridPos,
        car_rating: Number(g.car_rating || 82),
        pace: Number(g.pace || 82),
        wet: Number(g.wet || 80),
        tyre_care: Number(g.tyre_care || 80),
        paceFactor,
        prog: startProg,
        prevProg: startProg,
        lap: 0,
        totalProg: startProg - 1,
        lat: startLat,
        targetLat: startLat,
        vx: 0,
        x: sp.x + sp.rx * startLat,
        y: sp.y,
        z: sp.z + sp.rz * startLat,
        yaw: Math.atan2(sp.tx, sp.tz),
        compound: "soft",
        tyreLife: 100,
        drsOpen: false,
        inPitS: 0,
        pits: 0,
        dnf: false,
        finished: false,
        finishTimeS: 0,
        bestLapMs: Math.round(f1dbTargetMs / Math.max(0.82, paceFactor)),
      };
    });

    // FIA 5-Red-Lights Standing Start state
    const isStandingStart = (config && config.mode !== "timetrial");
    const startSeq = {
      active: isStandingStart,
      elapsed: 0,
      litCount: 0,
      holdAfterFive: 0.55 + Math.random() * 0.65,
      lightsOut: !isStandingStart,
      lastBeepCount: 0,
    };

    // Ghost playback helper (PB polyline if available, else synthetic F1DB pole ghost!)
    const ghostSamples = (pb && Array.isArray(pb.ghost) && pb.ghost.length >= 10) ? pb.ghost : null;
    const ghostTargetMs = (pb && pb.best_lap_ms) ? Number(pb.best_lap_ms) : f1dbTargetMs;
    const ghostLabel = ghostSamples ? `PB Ghost (${(pb.best_lap_ms / 1000).toFixed(3)}s)` : `F1DB Record Ghost (${(f1dbTargetMs / 1000).toFixed(3)}s)`;

    function computeGhostPose(playerCar) {
      if (!playerCar || playerCar.lap < 1) return null;
      const lapSec = (playerCar.lapTimeMs || 0) / 1000;
      if (ghostSamples) {
        // Interpolate along recorded 10Hz PB ghost
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
      // Synthetic F1DB Pole-Pace Ghost moving along optimal racing line at exact target lap time
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

    function stepAi(dt, playerCar, wetness, raceTimeS) {
      if (!startSeq.lightsOut) {
        return { proxLeft: false, proxRight: false, standings: buildStandings(playerCar) };
      }

      const wetFrac = clamp((wetness || 0) / 100, 0, 1);
      let proxLeft = false;
      let proxRight = false;

      for (let i = 0; i < aiCars.length; i++) {
        const a = aiCars[i];
        if (a.dnf) continue;
        if (a.inPitS > 0) {
          a.inPitS = Math.max(0, a.inPitS - dt);
          a.vx = 18;
          if (a.inPitS <= 0) {
            a.tyreLife = 100;
            a.compound = wetness >= 55 ? "wet" : (wetness >= 25 ? "inter" : (a.compound === "soft" ? "medium" : "hard"));
          }
          continue;
        }

        const sp = track.sample(a.prog);
        const wetSkill = 1.0 - wetFrac * (0.14 - (a.wet - 75) * 0.0018);
        const tyreMult = a.tyreLife > 28 ? 1.0 : 0.91;
        a.drsOpen = Boolean(sp.drsZone && a.lap >= 2 && wetness < 25);
        const drsBoost = a.drsOpen ? 1.035 : 1.0;

        let targetVx = sp.vTarget * a.paceFactor * wetSkill * tyreMult * drsBoost;
        // Look ahead for slower AI car or player car -> pull out to overtake!
        let desiredLat = sp.optLat || 0;
        for (let j = 0; j < aiCars.length; j++) {
          if (i === j || aiCars[j].dnf) continue;
          const b = aiCars[j];
          let dp = b.prog - a.prog;
          if (dp < -0.5) dp += 1;
          if (dp > 0 && dp < 0.008) {
            const dLat = Math.abs(b.lat - a.lat);
            if (dLat < 2.3) {
              desiredLat = clamp(b.lat + (b.lat >= 0 ? -3.1 : 3.1), -5.8, 5.8);
              if (dp < 0.0028) targetVx = Math.min(targetVx, b.vx * 0.98);
            }
          }
        }
        // Check proximity & smooth spatial separation vs Player car
        if (playerCar) {
          const dx = a.x - playerCar.x;
          const dz = a.z - playerCar.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 11.0) {
            const sideDot = dx * (-Math.cos(playerCar.yaw)) + dz * Math.sin(playerCar.yaw);
            if (sideDot < -0.4) proxLeft = true;
            if (sideDot > 0.4) proxRight = true;
          }
          if (dist < 2.6 && dist > 0.01) {
            // Smooth glancing bump separation so cars never clip inside each other!
            const push = (2.6 - dist) * 0.55;
            const nx = dx / dist;
            const nz = dz / dist;
            a.lat = clamp(a.lat + (nx * sp.rx + nz * sp.rz) * push, -6.4, 6.4);
            playerCar.x -= nx * push * 0.45;
            playerCar.z -= nz * push * 0.45;
            playerCar.impactStrength = Math.max(playerCar.impactStrength || 0, 0.28);
            if (Math.abs(a.vx - playerCar.vx) > 8) {
              playerCar.frontWingHealth = Math.max(25, playerCar.frontWingHealth - 4);
            }
          }
        }

        const accelRate = targetVx > a.vx ? 14.5 : 22.0;
        a.vx += clamp(targetVx - a.vx, -accelRate * dt, accelRate * dt);
        a.vx = Math.max(10, a.vx);
        a.targetLat = desiredLat;
        a.lat += (a.targetLat - a.lat) * Math.min(1, dt * 3.2);

        a.prevProg = a.prog;
        a.prog = (a.prog + (a.vx * dt) / Math.max(500, track.totalLen)) % 1;
        if (a.prog < a.prevProg - 0.5) {
          a.lap += 1;
          if (a.lap > totalLaps && !a.finished) {
            a.finished = true;
            a.finishTimeS = raceTimeS;
          }
          // Smart AI mid-race pit stop for longer races or wet crossover
          const needWet = wetness >= 30 && (a.compound === "soft" || a.compound === "medium" || a.compound === "hard");
          if (!a.finished && a.pits === 0 && (needWet || (totalLaps >= 6 && a.lap === Math.floor(totalLaps * 0.5)))) {
            a.inPitS = 14.0;
            a.pits += 1;
          }
        }
        a.totalProg = Math.max(0, a.lap - 1) + a.prog;
        a.tyreLife = Math.max(12, a.tyreLife - dt * 0.25 * (1.15 - (a.tyre_care - 75) * 0.008));

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
        const pd = (config && config.player_driver) || {};
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
      ghostLabel,
      ghostTargetMs,
      stepStartSequence,
      stepAi,
      computeGhostPose,
      computeLapDeltaS,
      buildStandings,
    };
  }

  global.F1DriveAI = { createAiAndGhostController };
})(window);
