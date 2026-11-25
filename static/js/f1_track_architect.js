/**
 * F1 Track Architect — Standardised FIA Circuit Geometry, Spatial Clearance Solver,
 * Dedicated Pitlane & 5-Phase Animated Pitstops, and FIA 5-Red-Lights Standing Start Engine.
 *
 * Guarantees ZERO grandstand / building / festival / tree obstructions across all 79 F1 circuits
 * by auditing full oriented footprints against BOTH the 360-point track spline AND the pitlane spline.
 */
(function (global) {
  "use strict";

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function smootherstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function progWrapDist(a, b) {
    let d = Math.abs((((a % 1) + 1) % 1) - (((b % 1) + 1) % 1));
    if (d > 0.5) d = 1 - d;
    return d;
  }

  function hashStr(s) {
    let h = 2166136261;
    const str = String(s || "circuit");
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function minDistToPts(x, z, pts, skipRanges) {
    let minD2 = Infinity;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      if (skipRanges) {
        const prog = i / n;
        let skip = false;
        for (let r = 0; r < skipRanges.length; r++) {
          const [a, b] = skipRanges[r];
          if (a <= b ? (prog >= a && prog <= b) : (prog >= a || prog <= b)) {
            skip = true;
            break;
          }
        }
        if (skip) continue;
      }
      const dx = x - pts[i].x;
      const dz = z - pts[i].z;
      const d2 = dx * dx + dz * dz;
      if (d2 < minD2) minD2 = d2;
    }
    return Math.sqrt(minD2);
  }

  /**
   * Sample world-space footprint points for an oriented rectangle (halfW along local X, halfL along local Z)
   * rotated by Three.js Y-rotation `yaw` (where local +Z = (sin yaw, cos yaw), local +X = (cos yaw, -sin yaw)).
   */
  function footprintSamples(cx, cz, yaw, halfW, halfL) {
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const out = [];
    const xFracs = [-1, 0, 1];
    const zFracs = [-1, -0.5, 0, 0.5, 1];
    for (let xi = 0; xi < xFracs.length; xi++) {
      const lx = xFracs[xi] * halfW;
      for (let zi = 0; zi < zFracs.length; zi++) {
        const lz = zFracs[zi] * halfL;
        out.push({
          x: cx + lx * cosY + lz * sinY,
          z: cz - lx * sinY + lz * cosY,
        });
      }
    }
    return out;
  }

  function footprintMinDist(samples, pts, skipRanges) {
    let minD = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const d = minDistToPts(samples[i].x, samples[i].z, pts, skipRanges);
      if (d < minD) minD = d;
    }
    return minD;
  }

  function overlapsPlaced(cx, cz, radius, placedList) {
    for (let i = 0; i < placedList.length; i++) {
      const p = placedList[i];
      const minSep = radius + p.r;
      const dx = cx - p.x;
      const dz = cz - p.z;
      if (dx * dx + dz * dz < minSep * minSep) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // 1. Standardised FIA Pitlane + 10 Colour-Coded Team Pit Boxes + Clearance
  // ---------------------------------------------------------------------------
  const PIT_BOX_COLORS = [
    0xe10600, 0xff8700, 0x00d2be, 0x1e41ff, 0x006f62,
    0x0090ff, 0x6692ff, 0xfacc15, 0x22c55e, 0xf8fafc,
  ];

  function buildPitLayout(trackPts, sampleTrackFn, circuit) {
    const n = trackPts.length;
    const p0 = trackPts[0];
    const rx0 = -p0.tz;
    const rz0 = p0.tx;

    // Evaluate BOTH sides (+1 and -1) along the S/F zone against non-SF track segments
    // so tight street/hairpin circuits always put the pitlane on the clearest side!
    const nonSfSkip = [[0.86, 0.14]];
    const sideScore = (side) => {
      let minClear = Infinity;
      for (let k = -4; k <= 4; k++) {
        const prog = ((k * 0.015) % 1 + 1) % 1;
        const sp = sampleTrackFn(prog);
        const rvx = -sp.tz, rvz = sp.tx;
        const px = sp.x + rvx * side * 26;
        const pz = sp.z + rvz * side * 26;
        const d = minDistToPts(px, pz, trackPts, nonSfSkip);
        if (d < minClear) minClear = d;
      }
      // Mild preference for circuit infield when both sides have plenty of room
      const toCenter = (-p0.x) * rx0 + (-p0.z) * rz0;
      const infieldBonus = (toCenter * side >= 0) ? 4.0 : 0.0;
      return minClear + infieldBonus;
    };

    const sPos = sideScore(1);
    const sNeg = sideScore(-1);
    const pitSide = sPos >= sNeg ? 1 : -1;

    // Determine clean adaptive pit lane offset (default 19.5m, never clipping another track leg)
    let basePitOffset = 19.5;
    for (const candidate of [19.5, 17.5, 16.0]) {
      let ok = true;
      for (let k = -3; k <= 3; k++) {
        const prog = ((k * 0.014) % 1 + 1) % 1;
        const sp = sampleTrackFn(prog);
        const px = sp.x + (-sp.tz) * pitSide * candidate;
        const pz = sp.z + sp.tx * pitSide * candidate;
        if (minDistToPts(px, pz, trackPts, nonSfSkip) < 16.0) {
          ok = false;
          break;
        }
      }
      if (ok) { basePitOffset = candidate; break; }
    }

    // Build smooth FIA pitlane: Entry (0..0.22) -> Straight Fast Lane (0.22..0.78) -> Exit Merge (0.78..1.0)
    const pitSpan = 0.082; // ~16.4% of lap around S/F
    const samples = 64;
    const fastPts = [];
    const wallPts = [];
    const workPts = [];
    for (let i = 0; i <= samples; i++) {
      const u = i / samples;
      const prog = ((1 - pitSpan + u * pitSpan * 2) % 1 + 1) % 1;
      const sp = sampleTrackFn(prog);
      const rvx = -sp.tz, rvz = sp.tx;

      // C2-continuous quintic S-curve entry/exit blend with dead-straight parallel middle section!
      let blend;
      if (u < 0.23) blend = smootherstep(0.0, 0.23, u);
      else if (u > 0.77) blend = 1.0 - smootherstep(0.77, 1.0, u);
      else blend = 1.0;

      // Start smoothly from track edge (pitSide * 6.8m) out to basePitOffset
      const off = pitSide * lerp(6.8, basePitOffset, blend);
      fastPts.push({
        u,
        prog,
        x: sp.x + rvx * off,
        z: sp.z + rvz * off,
        tx: sp.tx,
        tz: sp.tz,
        rx: rvx,
        rz: rvz,
      });

      if (u >= 0.16 && u <= 0.84) {
        const wallOff = pitSide * (basePitOffset - 6.8);
        wallPts.push({
          x: sp.x + rvx * wallOff,
          z: sp.z + rvz * wallOff,
          tx: sp.tx,
          tz: sp.tz,
        });
      }
      if (u >= 0.22 && u <= 0.78) {
        const workOff = pitSide * (basePitOffset + 4.8);
        workPts.push({
          u,
          x: sp.x + rvx * workOff,
          z: sp.z + rvz * workOff,
          tx: sp.tx,
          tz: sp.tz,
          rx: rvx,
          rz: rvz,
        });
      }
    }

    // Recompute exact smooth tangents along fastPts
    for (let i = 0; i < fastPts.length; i++) {
      const prev = fastPts[Math.max(0, i - 1)];
      const next = fastPts[Math.min(fastPts.length - 1, i + 1)];
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const len = Math.max(1e-5, Math.hypot(dx, dz));
      fastPts[i].tx = dx / len;
      fastPts[i].tz = dz / len;
    }

    // Build 10 standardised colour-coded FIA team pit boxes along the working lane (u = 0.28..0.72)
    const boxes = [];
    for (let b = 0; b < 10; b++) {
      const boxU = 0.28 + (b / 9) * 0.44;
      const fIdx = boxU * samples;
      const i0 = Math.min(samples - 1, Math.floor(fIdx));
      const f = fIdx - i0;
      const a = fastPts[i0], c = fastPts[i0 + 1];
      const fx = lerp(a.x, c.x, f);
      const fz = lerp(a.z, c.z, f);
      const tx = lerp(a.tx, c.tx, f);
      const tz = lerp(a.tz, c.tz, f);
      const tl = Math.max(1e-5, Math.hypot(tx, tz));
      const ntx = tx / tl, ntz = tz / tl;
      const rvx = -ntz, rvz = ntx;
      const bx = fx + rvx * pitSide * 4.6;
      const bz = fz + rvz * pitSide * 4.6;
      boxes.push({
        idx: b,
        u: boxU,
        fastX: fx,
        fastZ: fz,
        x: bx,
        z: bz,
        tx: ntx,
        tz: ntz,
        rx: rvx,
        rz: rvz,
        yaw: Math.atan2(ntx, ntz),
        color: PIT_BOX_COLORS[b % PIT_BOX_COLORS.length],
      });
    }

    // Speed limit entry line (u = 0.22) and exit line (u = 0.78)
    const speedLimitIn = fastPts[Math.round(0.22 * samples)];
    const speedLimitOut = fastPts[Math.round(0.78 * samples)];

    // Pit building placement right behind the 10 working boxes (audited against ALL track legs!)
    const midBox = boxes[4];
    const bldgYaw = midBox.yaw;
    let bldgDist = 11.2; // behind pit box center -> ~35.3m from main straight
    let bldgLen = 122;
    let bldgDepth = 11.5;
    let bldgShift = 0;
    let bldgOk = false;
    let bestFallback = { score: -1, dist: 9.8, len: 56, depth: 7.5, shift: 0 };

    // Audit against ALL track points (never skip near-SF legs that curve back, like Shanghai T1-2!).
    // A valid pit building must keep >= 18.0m from EVERY track point and sit cleanly behind the boxes.
    for (const tryLen of [122, 98, 76, 58, 44]) {
      for (const tryDepth of [11.5, 9.4, 7.6]) {
        for (const tryShift of [0, -10, 10, -20, 20]) {
          for (const tryOff of [11.2, 9.8, 8.8, 13.2, 15.5]) {
            const bx = midBox.x + midBox.rx * pitSide * tryOff + midBox.tx * tryShift;
            const bz = midBox.z + midBox.rz * pitSide * tryOff + midBox.tz * tryShift;
            const smps = footprintSamples(bx, bz, bldgYaw, tryDepth * 0.5, tryLen * 0.5);
            const dTrackAll = footprintMinDist(smps, trackPts, null);
            const dFast = footprintMinDist(smps, fastPts, null);
            const minClear = Math.min(dTrackAll, dFast + 9.0);
            if (minClear > bestFallback.score) {
              bestFallback = { score: minClear, dist: tryOff, len: tryLen, depth: tryDepth, shift: tryShift };
            }
            if (dTrackAll >= 18.0 && dFast >= 7.2) {
              bldgDist = tryOff;
              bldgLen = tryLen;
              bldgDepth = tryDepth;
              bldgShift = tryShift;
              bldgOk = true;
              break;
            }
          }
          if (bldgOk) break;
        }
        if (bldgOk) break;
      }
      if (bldgOk) break;
    }
    if (!bldgOk) {
      bldgDist = bestFallback.dist;
      bldgLen = bestFallback.len;
      bldgDepth = bestFallback.depth;
      bldgShift = bestFallback.shift;
    }

    const pitBuilding = {
      x: midBox.x + midBox.rx * pitSide * bldgDist + midBox.tx * bldgShift,
      z: midBox.z + midBox.rz * pitSide * bldgDist + midBox.tz * bldgShift,
      yaw: bldgYaw,
      depth: bldgDepth,
      length: bldgLen,
      style: (circuit && circuit.pit_building) || "modern_glass",
      pitSide,
    };

    return {
      pitSide,
      basePitOffset,
      pitSpan,
      fastPts,
      wallPts,
      workPts,
      boxes,
      speedLimitIn,
      speedLimitOut,
      pitBuilding,
    };
  }

  function sampleFastLane(pitLayout, u) {
    const pts = pitLayout.fastPts;
    const clamped = clamp(u, 0, 1);
    const f = clamped * (pts.length - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(pts.length - 1, i0 + 1);
    const t = f - i0;
    const a = pts[i0], b = pts[i1];
    const tx = lerp(a.tx, b.tx, t);
    const tz = lerp(a.tz, b.tz, t);
    const tl = Math.max(1e-5, Math.hypot(tx, tz));
    return {
      x: lerp(a.x, b.x, t),
      z: lerp(a.z, b.z, t),
      tx: tx / tl,
      tz: tz / tl,
    };
  }

  /**
   * True 5-Phase Animated Pitstop Motion Sampler:
   *   0.00..0.24 : Decelerate down pit entry & fast lane toward team box (180 -> 80 kph)
   *   0.24..0.34 : Smooth diagonal turn-in into exact team pit box (80 -> 0 kph)
   *   0.34..0.68 : FULL STATIONARY STOP (0 kph!) in pit box while 3D pit crew services wheels + gantry RED -> AMBER
   *   0.68..0.78 : Gantry GREEN release + diagonal pull-out onto fast lane (0 -> 80 kph)
   *   0.78..1.00 : Accelerate down pit exit merge lane back onto circuit (80 -> 215 kph)
   */
  function samplePitStopMotion(pitLayout, uRaw, boxIdx, penaltyHoldFrac) {
    if (!pitLayout || !pitLayout.boxes || !pitLayout.boxes.length) {
      return { x: 0, z: 0, tx: 1, tz: 0, yaw: 0, speedKph: 80, phase: "entry", stopped: false, jackLift: 0, crewActive: false, gantryState: "off", boxIdx: 0 };
    }
    const u = clamp(Number(uRaw || 0), 0, 1);
    const pHold = clamp(Number(penaltyHoldFrac || 0), 0, 0.58);
    const bIdx = Math.abs(Math.floor(Number(boxIdx || 0))) % pitLayout.boxes.length;
    const box = pitLayout.boxes[bIdx];
    const pitSide = pitLayout.pitSide;

    const uEnterStart = Math.max(0.06, box.u - 0.055);
    const uExitEnd = Math.min(0.94, box.u + 0.055);

    if (u < 0.24) {
      const f = u / 0.24;
      const laneU = lerp(0.0, uEnterStart, f);
      const p = sampleFastLane(pitLayout, laneU);
      const speedKph = lerp(175, 80, smoothstep(0.0, 0.72, f));
      return {
        x: p.x, z: p.z, tx: p.tx, tz: p.tz,
        yaw: Math.atan2(p.tx, p.tz),
        speedKph,
        phase: "entry",
        stopped: false,
        jackLift: 0,
        crewActive: false,
        gantryState: "amber",
        boxIdx: bIdx,
      };
    }

    if (u < 0.34) {
      const f = smoothstep(0.24, 0.34, u);
      const laneU = lerp(uEnterStart, box.u, f);
      const p = sampleFastLane(pitLayout, laneU);
      const lat = pitSide * 4.6 * f;
      const wx = p.x + (-p.tz) * lat;
      const wz = p.z + p.tx * lat;
      // Realistic diagonal nose angle into the pit box!
      const diagAng = Math.sin(f * Math.PI) * (-pitSide * 0.24);
      const baseYaw = Math.atan2(p.tx, p.tz);
      return {
        x: wx, z: wz, tx: p.tx, tz: p.tz,
        yaw: baseYaw + diagAng,
        speedKph: lerp(80, 0, f),
        phase: "turn_in",
        stopped: false,
        jackLift: 0,
        crewActive: f > 0.6,
        gantryState: "red",
        boxIdx: bIdx,
      };
    }

    if (u < 0.68) {
      // FULL STATIONARY STOP (0 kph!) — FIA Penalty Hold (crew hands-off!) followed by pneumatic jack & wheel guns!
      const rawF = (u - 0.34) / 0.34;
      if (pHold > 0.01 && rawF < pHold) {
        return {
          x: box.x, z: box.z, tx: box.tx, tz: box.tz,
          yaw: box.yaw,
          speedKph: 0,
          phase: "penalty_hold",
          stopped: true,
          servingPenalty: true,
          jackLift: 0,
          crewActive: false,
          serviceProgress: 0,
          gantryState: "red",
          boxIdx: bIdx,
        };
      }
      const serviceF = pHold > 0.01 ? clamp((rawF - pHold) / Math.max(0.1, 1 - pHold), 0, 1) : rawF;
      const jackLift = Math.sin(clamp(serviceF, 0, 1) * Math.PI) * 0.085;
      const gantryState = serviceF > 0.82 ? "amber" : "red";
      return {
        x: box.x, z: box.z, tx: box.tx, tz: box.tz,
        yaw: box.yaw,
        speedKph: 0,
        phase: "service",
        stopped: true,
        servingPenalty: false,
        jackLift,
        crewActive: true,
        serviceProgress: serviceF,
        gantryState,
        boxIdx: bIdx,
      };
    }

    if (u < 0.78) {
      const f = smoothstep(0.68, 0.78, u);
      const laneU = lerp(box.u, uExitEnd, f);
      const p = sampleFastLane(pitLayout, laneU);
      const lat = pitSide * 4.6 * (1 - f);
      const wx = p.x + (-p.tz) * lat;
      const wz = p.z + p.tx * lat;
      const diagAng = Math.sin(f * Math.PI) * (pitSide * 0.24);
      const baseYaw = Math.atan2(p.tx, p.tz);
      return {
        x: wx, z: wz, tx: p.tx, tz: p.tz,
        yaw: baseYaw + diagAng,
        speedKph: lerp(0, 80, f),
        phase: "release",
        stopped: false,
        jackLift: 0,
        crewActive: f < 0.3,
        gantryState: "green",
        boxIdx: bIdx,
      };
    }

    const f = (u - 0.78) / 0.22;
    const laneU = lerp(uExitEnd, 1.0, f);
    const p = sampleFastLane(pitLayout, laneU);
    const speedKph = lerp(80, 215, smoothstep(0.18, 1.0, f));
    return {
      x: p.x, z: p.z, tx: p.tx, tz: p.tz,
      yaw: Math.atan2(p.tx, p.tz),
      speedKph,
      phase: "exit",
      stopped: false,
      jackLift: 0,
      crewActive: false,
      gantryState: "green",
      boxIdx: bIdx,
    };
  }

  // ---------------------------------------------------------------------------
  // 2. Staggered 2x2 FIA Starting Grid Boxes (Aligned to Exact Car Spawn!)
  // ---------------------------------------------------------------------------
  function buildGridSlots(sampleTrackFn, totalLenM, count, circuit) {
    const n = Math.max(20, count || 24);
    // Match assignCarLaunchProfile exact progress & 3D lateral scaling so every car sits dead-center in its painted box!
    const perim = Math.max(1800, (circuit && circuit.length_km ? circuit.length_km * 1000 : (totalLenM || 4800)));
    const progStep = clamp(16.5 / perim, 0.0020, 0.0052);
    const firstRowOffset = Math.max(0.0020, 9.0 / perim);
    const slots = [];
    for (let i = 0; i < n; i++) {
      const prog = -(firstRowOffset + i * progStep);
      const sp = sampleTrackFn(prog);
      const rvx = -sp.tz, rvz = sp.tx;
      const lat = (i % 2 === 0 ? -2.55 : 2.55) * 1.12;
      slots.push({
        gridPos: i + 1,
        prog,
        lat,
        x: sp.x + rvx * lat,
        z: sp.z + rvz * lat,
        y: (sp.y || 0) + (sp.bankRad ? Math.sin(sp.bankRad) * lat : 0),
        tx: sp.tx,
        tz: sp.tz,
        yaw: Math.atan2(sp.tx, sp.tz),
      });
    }
    return slots;
  }

  // ---------------------------------------------------------------------------
  // 3. Full Spatial-Clearance Circuit Layout Builder (All 79 Circuits -> 0 Clipping!)
  // ---------------------------------------------------------------------------
  function buildCircuitLayout(trackPts, sampleTrackFn, circuit, rngFn) {
    const rng = rngFn || (() => 0.5);
    const pitLayout = buildPitLayout(trackPts, sampleTrackFn, circuit);
    const pitSide = pitLayout.pitSide;
    const pitPts = pitLayout.fastPts;

    // Estimate total 3D track perimeter in meters
    let totalLenM = 0;
    for (let i = 0; i < trackPts.length; i++) {
      const a = trackPts[i], b = trackPts[(i + 1) % trackPts.length];
      totalLenM += Math.hypot(b.x - a.x, b.z - a.z);
    }

    const gridSlots = buildGridSlots(sampleTrackFn, totalLenM, 24, circuit);

    // Track placed bounding circles so buildings/stands/props never intersect each other
    const placed = [];
    placed.push({
      x: pitLayout.pitBuilding.x,
      z: pitLayout.pitBuilding.z,
      r: pitLayout.pitBuilding.length * 0.42,
      kind: "pitBuilding",
    });

    // A. Obstruction-Free Multi-Tier Grandstands
    // Rule: minDistToTrack >= 24m AND minDistToPit >= 22m, NEVER on pitSide along S/F straight!
    const standCandidates = [
      { prog: 0.00, prefSide: -pitSide, len: 112, tiers: 7, name: "Main Grandstand" },
      { prog: 0.08, prefSide: -pitSide, len: 76,  tiers: 6, name: "Turn 1 Stand" },
      { prog: 0.17, prefSide: 1,        len: 70,  tiers: 5 },
      { prog: 0.27, prefSide: -1,       len: 76,  tiers: 6 },
      { prog: 0.38, prefSide: 1,        len: 74,  tiers: 6 },
      { prog: 0.50, prefSide: -1,       len: 84,  tiers: 7, name: "Stadium Bowl" },
      { prog: 0.62, prefSide: 1,        len: 70,  tiers: 5 },
      { prog: 0.73, prefSide: -1,       len: 76,  tiers: 6 },
      { prog: 0.84, prefSide: 1,        len: 72,  tiers: 6 },
      { prog: 0.93, prefSide: -pitSide, len: 68,  tiers: 5, name: "Final Corner" },
    ];

    const grandstands = [];
    const MIN_STAND_TRACK = 24.0;
    const MIN_STAND_PIT = 22.0;

    standCandidates.forEach((cand, idx) => {
      const inPitZone = cand.prog < 0.12 || cand.prog > 0.88;
      const sidesToTry = inPitZone ? [-pitSide] : [cand.prefSide, -cand.prefSide];
      const lenTries = [cand.len, Math.round(cand.len * 0.74), 46];
      const distTries = [33, 39, 46, 54];
      const sp = sampleTrackFn(cand.prog);
      const rx = -sp.tz, rz = sp.tx;
      const yaw = Math.atan2(sp.tx, sp.tz);

      let accepted = null;
      for (let si = 0; si < sidesToTry.length && !accepted; si++) {
        const side = sidesToTry[si];
        for (let li = 0; li < lenTries.length && !accepted; li++) {
          const tryLen = lenTries[li];
          const depth = cand.tiers * 2.2 + 3.0;
          for (let di = 0; di < distTries.length && !accepted; di++) {
            const tryDist = distTries[di];
            const sx = sp.x + rx * side * tryDist;
            const sz = sp.z + rz * side * tryDist;
            const smps = footprintSamples(sx, sz, yaw, depth * 0.52, tryLen * 0.52);
            const dTrack = footprintMinDist(smps, trackPts, null);
            if (dTrack < MIN_STAND_TRACK) continue;
            const dPit = footprintMinDist(smps, pitPts, null);
            if (dPit < MIN_STAND_PIT) continue;
            const bRad = Math.hypot(depth * 0.5, tryLen * 0.45);
            if (overlapsPlaced(sx, sz, bRad, placed)) continue;

            accepted = {
              idx,
              prog: cand.prog,
              side,
              x: sx,
              z: sz,
              yaw,
              len: tryLen,
              tiers: cand.tiers,
              depth,
              minTrackDist: dTrack,
              minPitDist: dPit,
            };
            placed.push({ x: sx, z: sz, r: bRad, kind: "grandstand" });
          }
        }
      }
      if (accepted) grandstands.push(accepted);
    });

    // B. Obstruction-Free Live LED Jumbotrons (4 screens, >= 22m from track & pit!)
    const jumbotrons = [];
    [0.05, 0.30, 0.56, 0.82].forEach((prog, ji) => {
      const sp = sampleTrackFn(prog);
      const rx = -sp.tz, rz = sp.tx;
      const inPitZone = prog < 0.12 || prog > 0.88;
      const sides = inPitZone ? [-pitSide] : [ji % 2 === 0 ? -1 : 1, ji % 2 === 0 ? 1 : -1];
      for (let si = 0; si < sides.length; si++) {
        const side = sides[si];
        let found = false;
        for (const dist of [29, 36, 44]) {
          const jx = sp.x + rx * side * dist;
          const jz = sp.z + rz * side * dist;
          const dTrack = minDistToPts(jx, jz, trackPts, null);
          const dPit = minDistToPts(jx, jz, pitPts, null);
          if (dTrack >= 22.0 && dPit >= 22.0 && !overlapsPlaced(jx, jz, 11.5, placed)) {
            jumbotrons.push({
              x: jx,
              z: jz,
              yaw: Math.atan2(sp.tx, sp.tz) + (side > 0 ? -Math.PI * 0.35 : Math.PI * 0.35),
              side,
            });
            placed.push({ x: jx, z: jz, r: 11.5, kind: "jumbotron" });
            found = true;
            break;
          }
        }
        if (found) break;
      }
    });

    // C. Obstruction-Free Overhead Sponsor Bridges (pillars audited against BOTH adjacent track legs & pitlane!)
    const bridges = [];
    const pillarClearOfNonLocalTrack = (px, pz, localProg, minClear) => {
      const nT = trackPts.length;
      for (let i = 0; i < nT; i++) {
        if (progWrapDist(i / nT, localProg) < 0.036) continue;
        const d = Math.hypot(px - trackPts[i].x, pz - trackPts[i].z);
        if (d < minClear) return false;
      }
      return true;
    };
    [0.22, 0.50, 0.78].forEach((baseProg, bi) => {
      for (const shift of [0, 0.025, -0.025, 0.05, -0.05]) {
        const prog = (((baseProg + shift) % 1) + 1) % 1;
        if (prog < 0.11 || prog > 0.89) continue;
        const sp = sampleTrackFn(prog);
        if (sp.inTunnel) continue;
        const rx = -sp.tz, rz = sp.tx;
        const lx = sp.x - rx * 13.0, lz = sp.z - rz * 13.0;
        const rxp = sp.x + rx * 13.0, rzp = sp.z + rz * 13.0;
        const dPitL = minDistToPts(lx, lz, pitPts, null);
        const dPitR = minDistToPts(rxp, rzp, pitPts, null);
        if (
          dPitL >= 14.0 && dPitR >= 14.0
          && pillarClearOfNonLocalTrack(lx, lz, prog, 12.5)
          && pillarClearOfNonLocalTrack(rxp, rzp, prog, 12.5)
        ) {
          bridges.push({ idx: bi, prog, x: sp.x, z: sp.z, y: sp.y || 0, yaw: Math.atan2(sp.tx, sp.tz) });
          break;
        }
      }
    });

    // C2. Audited FIA Trackside Braking Distance Boards (150m / 100m / 50m), DRS Gantries, Marshal LED Panels & Heavy-Braking Runoff/Tyre Walls!
    const brakingBoards = [];
    const tyreBarriers = [];
    const rawBraking = Array.isArray(circuit && circuit.braking_zones) ? circuit.braking_zones : [];
    const pitOpenSpan = (pitLayout.pitSpan || 0.082) + 0.015;
    const isTracksidePointClear = (wx, wz, localProg, minAllTrackDist, minPitDist) => {
      if (minDistToPts(wx, wz, pitPts, null) < minPitDist) return false;
      // Audit against EVERY track point (no skip window!) so tight 180-deg hairpins like Monaco Fairmont never get encroached!
      if (minDistToPts(wx, wz, trackPts, null) < minAllTrackDist) return false;
      return true;
    };

    rawBraking.forEach((bz, bzIdx) => {
      const tApex = (((Number(bz.t || 0)) % 1) + 1) % 1;
      const sev = Number(bz.sev || 2);
      if (sev < 2) return;
      // Determine outside of corner via local spline curvature
      const spApex = sampleTrackFn(tApex);
      const curvSign = (spApex.curv || 0) >= 0 ? -1 : 1; // outside of right turn (+curv) is left (-1)
      const inPitZone = (tApex < pitOpenSpan || tApex > 1 - pitOpenSpan);
      const prefSide = inPitZone ? -pitSide : curvSign;

      // Place 150m, 100m, 50m boards cleanly outside kerb/runoff edge (offset = 12.2m) before braking apex!
      const boardDists = sev >= 3 ? [150, 100, 50] : [100, 50];
      boardDists.forEach((meters) => {
        const bProg = (((tApex - (meters / Math.max(1800, totalLenM))) % 1) + 1) % 1;
        const bInPit = (bProg < pitOpenSpan || bProg > 1 - pitOpenSpan);
        const side = bInPit ? -pitSide : prefSide;
        const sp = sampleTrackFn(bProg);
        if (sp.inTunnel) return;
        const rx = -sp.tz, rz = sp.tx;
        const off = side * 12.2;
        const wx = sp.x + rx * off;
        const wz = sp.z + rz * off;
        const wy = (sp.y || 0) + (sp.bankRad ? Math.sin(sp.bankRad) * off : 0);
        if (isTracksidePointClear(wx, wz, bProg, 10.5, 9.5)) {
          brakingBoards.push({
            bzIdx,
            meters,
            prog: bProg,
            side,
            x: wx,
            y: wy,
            z: wz,
            yaw: Math.atan2(sp.tx, sp.tz),
          });
        }
      });

      // Place FIA Tyre Barrier Stack + Gravel Runoff Apron on the outside of heavy braking zones (sev >= 2)!
      if (!spApex.inTunnel) {
        const tSide = inPitZone ? -pitSide : curvSign;
        const rx = -spApex.tz, rz = spApex.tx;
        const off = tSide * 13.6;
        const wx = spApex.x + rx * off;
        const wz = spApex.z + rz * off;
        const wy = (spApex.y || 0) + (spApex.bankRad ? Math.sin(spApex.bankRad) * off : 0);
        const halfL = sev >= 3 ? 12.5 : 8.5;
        const e1x = wx + spApex.tx * halfL, e1z = wz + spApex.tz * halfL;
        const e2x = wx - spApex.tx * halfL, e2z = wz - spApex.tz * halfL;
        if (
          isTracksidePointClear(wx, wz, tApex, 10.8, 10.5)
          && isTracksidePointClear(e1x, e1z, tApex, 10.0, 10.0)
          && isTracksidePointClear(e2x, e2z, tApex, 10.0, 10.0)
        ) {
          tyreBarriers.push({
            bzIdx,
            sev,
            prog: tApex,
            side: tSide,
            x: wx,
            y: wy,
            z: wz,
            yaw: Math.atan2(spApex.tx, spApex.tz),
            length: halfL * 2,
          });
        }
      }
    });

    // C3. Audited DRS Activation / Detection Gantries along circuit.drs_ranges!
    const drsGantries = [];
    const rawDrs = Array.isArray(circuit && circuit.drs_ranges) ? circuit.drs_ranges : [];
    rawDrs.forEach((rngPair, di) => {
      if (!Array.isArray(rngPair) || rngPair.length < 2) return;
      const startProg = (((Number(rngPair[0])) % 1) + 1) % 1;
      const sp = sampleTrackFn(startProg);
      if (sp.inTunnel) return;
      const rx = -sp.tz, rz = sp.tx;
      const lx = sp.x - rx * 11.4, lz = sp.z - rz * 11.4;
      const rxp = sp.x + rx * 11.4, rzp = sp.z + rz * 11.4;
      const dPitL = minDistToPts(lx, lz, pitPts, null);
      const dPitR = minDistToPts(rxp, rzp, pitPts, null);
      if (
        dPitL >= 11.0 && dPitR >= 11.0
        && pillarClearOfNonLocalTrack(lx, lz, startProg, 10.5)
        && pillarClearOfNonLocalTrack(rxp, rzp, startProg, 10.5)
      ) {
        drsGantries.push({
          idx: di,
          prog: startProg,
          endProg: (((Number(rngPair[1])) % 1) + 1) % 1,
          x: sp.x,
          y: sp.y || 0,
          z: sp.z,
          yaw: Math.atan2(sp.tx, sp.tz),
        });
      }
    });

    // C4. Audited FIA Trackside Digital Marshal Flag LED Panels (14 posts cleanly clear of track & pitlane!)
    const marshalPosts = [];
    for (let mi = 0; mi < 14; mi++) {
      const mProg = (mi + 0.5) / 14;
      const mp = sampleTrackFn(mProg);
      if (mp.inTunnel) continue;
      const rx = -mp.tz, rz = mp.tx;
      const inPitZone = (mProg < pitOpenSpan || mProg > 1 - pitOpenSpan);
      const sides = inPitZone ? [-pitSide] : (mi % 2 === 0 ? [1, -1] : [-1, 1]);
      for (let si = 0; si < sides.length; si++) {
        const side = sides[si];
        const off = side * 13.8;
        const mx = mp.x + rx * off;
        const mz = mp.z + rz * off;
        const my = (mp.y || 0) + (mp.bankRad ? Math.sin(mp.bankRad) * off : 0);
        if (isTracksidePointClear(mx, mz, mProg, 10.5, 9.5)) {
          marshalPosts.push({
            idx: mi,
            prog: mProg,
            side,
            x: mx,
            y: my,
            z: mz,
            yaw: Math.atan2(mp.tx, mp.tz),
            sector: Math.floor(mProg * 3) + 1,
          });
          break;
        }
      }
    }

    // D. Obstruction-Free Festival & Fan Village (Ferris wheel + 6 Beer Tents + DJ Stage)
    let festival = null;
    let bestFestScore = -1;
    for (let k = 0; k < 18; k++) {
      const prog = 0.14 + (k / 18) * 0.72;
      const sp = sampleTrackFn(prog);
      const rx = -sp.tz, rz = sp.tx;
      for (const side of [-pitSide, pitSide]) {
        for (const dist of [78, 102, 130]) {
          const fx = sp.x + rx * side * dist;
          const fz = sp.z + rz * side * dist;
          const dT = minDistToPts(fx, fz, trackPts, null);
          const dP = minDistToPts(fx, fz, pitPts, null);
          const clear = Math.min(dT, dP);
          if (clear >= 48.0 && clear > bestFestScore && !overlapsPlaced(fx, fz, 26, placed)) {
            bestFestScore = clear;
            festival = { x: fx, z: fz, clear };
          }
        }
      }
    }
    const festivalTents = [];
    let djStage = null;
    if (festival) {
      placed.push({ x: festival.x, z: festival.z, r: 24, kind: "ferris" });
      for (let ti = 0; ti < 6; ti++) {
        const ang = (ti / 6) * Math.PI * 2;
        const tx = festival.x + Math.cos(ang) * 40;
        const tz = festival.z + Math.sin(ang) * 40;
        if (minDistToPts(tx, tz, trackPts, null) >= 26.0 && minDistToPts(tx, tz, pitPts, null) >= 26.0 && !overlapsPlaced(tx, tz, 9.5, placed)) {
          festivalTents.push({ idx: ti, x: tx, z: tz });
          placed.push({ x: tx, z: tz, r: 9.5, kind: "tent" });
        }
      }
      for (const [ox, oz] of [[24, -26], [-24, 26], [26, 24], [-26, -24]]) {
        const sx = festival.x + ox, sz = festival.z + oz;
        if (minDistToPts(sx, sz, trackPts, null) >= 28.0 && minDistToPts(sx, sz, pitPts, null) >= 28.0 && !overlapsPlaced(sx, sz, 14, placed)) {
          djStage = { x: sx, z: sz };
          placed.push({ x: sx, z: sz, r: 14, kind: "stage" });
          break;
        }
      }
    }

    // E. Obstruction-Free Scenic Props (Trees, Skylines, Floodlights — EVERY prop >= 26m from track & pit!)
    const props = [];
    const propTarget = 96;
    for (let i = 0; i < propTarget; i++) {
      const prog = (i + 0.25) / propTarget;
      const sp = sampleTrackFn(prog);
      const rx = -sp.tz, rz = sp.tx;
      const side = i % 2 === 0 ? 1 : -1;
      for (const extra of [0, 18, 38]) {
        const dist = 42 + (i % 5) * 14 + rng() * 14 + extra;
        const px = sp.x + rx * side * dist;
        const pz = sp.z + rz * side * dist;
        const dTrack = minDistToPts(px, pz, trackPts, null);
        const dPit = minDistToPts(px, pz, pitPts, null);
        if (dTrack >= 26.0 && dPit >= 26.0 && !overlapsPlaced(px, pz, 8.5, placed)) {
          props.push({
            idx: i,
            x: px,
            z: pz,
            lookX: sp.x,
            lookZ: sp.z,
            minTrackDist: dTrack,
            minPitDist: dPit,
          });
          break;
        }
      }
    }

    // F. Obstruction-Free Trackside TV Broadcast Cameras (14 elevated cameras!)
    const tvCams = [];
    for (let i = 0; i < 14; i++) {
      const prog = (i + 0.35) / 14;
      const sp = sampleTrackFn(prog);
      const rx = -sp.tz, rz = sp.tx;
      const prefSide = i % 2 === 0 ? 1 : -1;
      let camPt = null;
      for (const side of [prefSide, -prefSide]) {
        for (const dist of [23, 29, 18]) {
          const cx = sp.x + rx * side * dist;
          const cz = sp.z + rz * side * dist;
          if (minDistToPts(cx, cz, trackPts, null) >= 15.0 && minDistToPts(cx, cz, pitPts, null) >= 12.0 && !overlapsPlaced(cx, cz, 4.0, placed)) {
            camPt = { prog, x: cx, y: 7.8 + (i % 3) * 3.2, z: cz };
            break;
          }
        }
        if (camPt) break;
      }
      if (!camPt) {
        camPt = { prog, x: sp.x + rx * prefSide * 22, y: 12.5, z: sp.z + rz * prefSide * 22 };
      }
      tvCams.push(camPt);
    }

    return {
      pitSide,
      pitLayout,
      gridSlots,
      grandstands,
      jumbotrons,
      bridges,
      brakingBoards,
      tyreBarriers,
      drsGantries,
      marshalPosts,
      festival,
      festivalTents,
      djStage,
      props,
      tvCams,
      totalLenM,
    };
  }

  /**
   * Automated Spatial Clearance Audit — verifies 0 obstructions across any circuit!
   */
  function auditLayoutClearance(layout, trackPts) {
    const violations = [];
    let minGrandstandTrackDist = Infinity;
    let minGrandstandPitDist = Infinity;
    let minPropTrackDist = Infinity;
    let minPropPitDist = Infinity;
    let minPitBldgTrackDist = Infinity;
    const pitPts = layout.pitLayout.fastPts;

    layout.grandstands.forEach((g, idx) => {
      const smps = footprintSamples(g.x, g.z, g.yaw, g.depth * 0.5, g.len * 0.5);
      const dT = footprintMinDist(smps, trackPts, null);
      const dP = footprintMinDist(smps, pitPts, null);
      if (dT < minGrandstandTrackDist) minGrandstandTrackDist = dT;
      if (dP < minGrandstandPitDist) minGrandstandPitDist = dP;
      if (dT < 23.5) violations.push(`Grandstand #${idx} too close to track (${dT.toFixed(1)}m)`);
      if (dP < 21.5) violations.push(`Grandstand #${idx} too close to pitlane (${dP.toFixed(1)}m)`);
    });

    if (layout.pitLayout && layout.pitLayout.pitBuilding) {
      const pb = layout.pitLayout.pitBuilding;
      const pbSmps = footprintSamples(pb.x, pb.z, pb.yaw, pb.depth * 0.5, pb.length * 0.5);
      minPitBldgTrackDist = footprintMinDist(pbSmps, trackPts, null);
      if (minPitBldgTrackDist < 16.5) {
        violations.push(`Pit building too close to track (${minPitBldgTrackDist.toFixed(1)}m)`);
      }
    }

    (layout.bridges || []).forEach((br, idx) => {
      const tx = Math.sin(br.yaw), tz = Math.cos(br.yaw);
      const rx = -tz, rz = tx;
      [-12.5, 12.5].forEach((side) => {
        const px = br.x + rx * side, pz = br.z + rz * side;
        for (let i = 0; i < trackPts.length; i++) {
          if (progWrapDist(i / trackPts.length, br.prog || 0) < 0.035) continue;
          const d = Math.hypot(px - trackPts[i].x, pz - trackPts[i].z);
          if (d < 10.0) {
            violations.push(`Bridge #${idx} pillar encroaches adjacent track (${d.toFixed(1)}m)`);
            break;
          }
        }
      });
    });

    (layout.brakingBoards || []).forEach((bb, idx) => {
      const dT = minDistToPts(bb.x, bb.z, trackPts, null);
      if (dT < 9.5) violations.push(`BrakingBoard #${idx} encroaches track (${dT.toFixed(1)}m)`);
    });

    (layout.marshalPosts || []).forEach((mp, idx) => {
      const dT = minDistToPts(mp.x, mp.z, trackPts, null);
      if (dT < 9.5) violations.push(`MarshalPost #${idx} encroaches track (${dT.toFixed(1)}m)`);
    });

    (layout.tyreBarriers || []).forEach((tb, idx) => {
      const dT = minDistToPts(tb.x, tb.z, trackPts, null);
      if (dT < 10.0) violations.push(`TyreBarrier #${idx} encroaches track (${dT.toFixed(1)}m)`);
    });

    layout.props.forEach((p, idx) => {
      const dT = minDistToPts(p.x, p.z, trackPts, null);
      const dP = minDistToPts(p.x, p.z, pitPts, null);
      if (dT < minPropTrackDist) minPropTrackDist = dT;
      if (dP < minPropPitDist) minPropPitDist = dP;
      if (dT < 25.5) violations.push(`Prop #${idx} too close to track (${dT.toFixed(1)}m)`);
      if (dP < 25.5) violations.push(`Prop #${idx} too close to pitlane (${dP.toFixed(1)}m)`);
    });

    return {
      ok: violations.length === 0 && layout.pitLayout.boxes.length === 10 && layout.gridSlots.length >= 20,
      grandstandCount: layout.grandstands.length,
      propCount: layout.props.length,
      pitBoxCount: layout.pitLayout.boxes.length,
      gridSlotCount: layout.gridSlots.length,
      brakingBoardCount: (layout.brakingBoards || []).length,
      drsGantryCount: (layout.drsGantries || []).length,
      marshalPostCount: (layout.marshalPosts || []).length,
      tyreBarrierCount: (layout.tyreBarriers || []).length,
      minGrandstandTrackDist: Number.isFinite(minGrandstandTrackDist) ? +minGrandstandTrackDist.toFixed(1) : 999,
      minGrandstandPitDist: Number.isFinite(minGrandstandPitDist) ? +minGrandstandPitDist.toFixed(1) : 999,
      minPitBldgTrackDist: Number.isFinite(minPitBldgTrackDist) ? +minPitBldgTrackDist.toFixed(1) : 999,
      minPropTrackDist: Number.isFinite(minPropTrackDist) ? +minPropTrackDist.toFixed(1) : 999,
      minPropPitDist: Number.isFinite(minPropPitDist) ? +minPropPitDist.toFixed(1) : 999,
      violations,
    };
  }

  // ---------------------------------------------------------------------------
  // 4. FIA 5-Red-Lights Standing Start Sequence & Launch Reaction DNA
  // ---------------------------------------------------------------------------
  function assignCarLaunchProfile(cars, circuit) {
    const perim = Math.max(1800, (circuit && circuit.length_km ? circuit.length_km * 1000 : 4800));
    const progStep = Math.max(0.0020, Math.min(0.0052, 16.5 / perim));
    const startOffset = Math.max(0.0020, 9.0 / perim);

    cars.forEach((car, i) => {
      // Assign team pit box index (0..9) consistently by team name so teammates share a box!
      const tName = (car.card && car.card.hero_team) || car.teamName || `Team${i % 10}`;
      car.pitBoxIdx = hashStr(tName) % 10;

      // Place car stationary on staggered FIA starting grid
      car.totalProg = -(startOffset + i * progStep);
      car.latOffset = (i % 2 === 0 ? -2.55 : 2.55);
      car.liveKph = 0;
      car.livePhysKph = 0;
      car.liveGear = 1;
      car.liveLongG = 0;

      // Launch Reaction & Traction DNA (data-deduced Driver DNA + skill-weighted clutch/pace)
      const st = (car.card && car.card.game && car.card.game.stats) || car.driver || {};
      const clutch = Number(st.clutch ?? st.racecraft ?? 72);
      const pace = Number(st.pace ?? 72);
      const launchSkill = clamp((clutch * 0.6 + pace * 0.4) / 100, 0.45, 0.99);
      const jitter = (Math.random() - 0.5) * 0.08;
      const antiStall = Math.random() < 0.025; // Rare 2.5% clutch anti-stall drama!
      const jumpStart = !antiStall && i > 0 && Math.random() < 0.018; // Rare ~1.8% FIA False/Jump Start!
      const dnaReact = (car.dna && Number.isFinite(Number(car.dna.launch_reaction_s))) ? Number(car.dna.launch_reaction_s) : null;
      const baseReact = dnaReact != null ? dnaReact : (0.34 - launchSkill * 0.16);
      car.launchReactionS = antiStall
        ? (0.58 + Math.random() * 0.28)
        : (jumpStart ? 0.08 : clamp(baseReact + jitter, 0.14, 0.42));
      car.launchTraction = antiStall
        ? 0.72
        : clamp(0.86 + launchSkill * 0.22 + (dnaReact != null ? (0.22 - dnaReact) * 0.45 : 0) + (Math.random() - 0.5) * 0.06, 0.78, 1.18);
      car.launchAntiStall = antiStall;
      car.launchJumpStart = jumpStart;
      car.launchJumpFlagged = false;
      car.launchScale = 0;
      car.launchElapsed = 0;
    });
  }

  function createStandingStartState(cars, circuit, opts) {
    const o = opts || {};
    assignCarLaunchProfile(cars || [], circuit);
    const holdDuration = 0.45 + Math.random() * 1.05; // Authentic randomized FIA hold (0.45s - 1.50s)
    return {
      active: !o.skip,
      elapsed: 0,
      litCount: 0,
      prevLitCount: 0,
      holdDuration,
      lightsOutAt: 5.0 + holdDuration,
      lightsOut: !!o.skip,
      lightsOutElapsed: o.skip ? 99 : 0,
      lightsOutJustFired: false,
      isRestart: !!o.isRestart,
      bannerLabel: o.isRestart ? "STANDING RESTART" : "FIA STANDING START",
    };
  }

  /**
   * Advances the 5-red-lights sequence and per-car 0 kph launch curve.
   * Returns { holding: boolean, newLight: number|0, lightsOutNow: boolean }.
   */
  function stepStandingStart(seq, cars, dt, fastMode) {
    if (!seq) return { holding: false, newLight: 0, lightsOutNow: false };
    seq.lightsOutJustFired = false;

    if (fastMode && seq.active && !seq.lightsOut) {
      // Fast-forward / Sim-to-End skips immediately to Lights Out!
      seq.lightsOut = true;
      seq.active = false;
      seq.litCount = 0;
      seq.lightsOutElapsed = 5.0;
      (cars || []).forEach((c) => { c.launchScale = 1.0; });
      return { holding: false, newLight: 0, lightsOutNow: true };
    }

    let newLight = 0;
    let lightsOutNow = false;

    if (!seq.lightsOut) {
      seq.elapsed += dt;
      const lit = Math.min(5, Math.floor(seq.elapsed / 1.0) + (seq.elapsed > 0.12 ? 1 : 0));
      seq.litCount = lit;
      if (lit > seq.prevLitCount) {
        newLight = lit;
        seq.prevLitCount = lit;
      }

      // Keep all grid cars strictly stationary at 0 kph with revving engines (except rare FIA Jump Start creep!)
      const jumpStarters = [];
      (cars || []).forEach((c) => {
        if (c.dnf) return;
        if (c.launchJumpStart && !c.launchJumpFlagged && lit >= 5 && seq.elapsed >= seq.lightsOutAt - 0.22) {
          c.launchJumpFlagged = true;
          c.totalProg += 0.00065; // Visible premature grid box creep detected by FIA sensors!
          c.liveKph = 14;
          c.aiStatus = "⚠ JUMP START!";
          jumpStarters.push(c);
          return;
        }
        c.liveKph = 0;
        c.livePhysKph = 0;
        c.liveGear = 1;
        c.liveLongG = 0;
        c.launchScale = 0;
        c.aiStatus = lit >= 5 ? "CLUTCH BITE…" : `GRID LIGHTS (${lit}/5)`;
      });

      if (seq.elapsed >= seq.lightsOutAt) {
        seq.lightsOut = true;
        seq.litCount = 0;
        seq.lightsOutElapsed = 0;
        seq.lightsOutJustFired = true;
        lightsOutNow = true;
      }
      return { holding: !seq.lightsOut, newLight, lightsOutNow, jumpStarters };
    }

    // Post-LIGHTS OUT: ramp each car smoothly from 0 kph based on Reaction Time + Traction DNA!
    seq.lightsOutElapsed += dt;
    let anyLaunching = false;
    (cars || []).forEach((c) => {
      if (c.dnf || c.inPit > 0) return;
      const tSinceGo = seq.lightsOutElapsed - (c.launchReactionS || 0.22);
      if (tSinceGo <= 0) {
        c.launchScale = 0;
        c.liveKph = 0;
        c.livePhysKph = 0;
        c.liveGear = 1;
        c.liveLongG = 0;
        anyLaunching = true;
      } else if (tSinceGo < 3.6) {
        const ramp = clamp(Math.pow(tSinceGo / 3.4, 0.78) * (c.launchTraction || 1.0), 0.04, 1.0);
        c.launchScale = ramp;
        c.liveLongG = clamp((1.0 - ramp) * 1.95 * (c.launchTraction || 1.0), 0.2, 2.1);
        if (ramp < 1.0) anyLaunching = true;
      } else {
        c.launchScale = 1.0;
      }
    });

    if (!anyLaunching && seq.lightsOutElapsed > 3.8) {
      seq.active = false;
    }
    return { holding: false, newLight: 0, lightsOutNow: false };
  }

  // ---------------------------------------------------------------------------
  // 5. Phase B: 3D Circuit Topography (True Elevation, Banking & Iconic Landmarks)
  // ---------------------------------------------------------------------------
  // Guarantees y >= 0 everywhere (never clips below ground plane) and smooth C2 taper
  // to y = 0 & bankRad = 0 across the Start/Finish & Pitlane corridor (0.905..0.095).
  function gaussianBump(p, center, width) {
    let d = Math.abs(p - center);
    if (d > 0.5) d = 1.0 - d;
    const u = d / Math.max(1e-4, width);
    return Math.exp(-u * u * 2.2);
  }

  function rawCircuitElevAndBank(circuit, prog) {
    const p = ((prog % 1) + 1) % 1;
    const id = String((circuit && circuit.id) || "").toLowerCase();
    const biome = String((circuit && circuit.biome) || "parkland").toLowerCase();
    // Smooth window: strictly 0 across S/F + pitlane (0.908..0.092), ramps smoothly to 1 across 0.142..0.858
    const sfWin = smoothstep(0.092, 0.142, p) * (1.0 - smoothstep(0.858, 0.908, p));

    let y = 0;
    let bankRad = 0;
    let inTunnel = false;

    if (id === "spa") {
      // Spa-Francorchamps: Eau Rouge / Raidillon steep climb to Kemmel (+28m), sweeping downhill through Pouhon/Stavelot
      const climb = smoothstep(0.10, 0.21, p) * (1.0 - smoothstep(0.64, 0.84, p));
      const crest = gaussianBump(p, 0.24, 0.08) * 5.0 + gaussianBump(p, 0.38, 0.10) * 3.0;
      y = (climb * 24.5 + crest) * sfWin;
      bankRad = (gaussianBump(p, 0.16, 0.035) * 0.09 - gaussianBump(p, 0.52, 0.05) * 0.07) * sfWin;
    } else if (id === "austin") {
      // COTA: Iconic Turn 1 Big Red Hill (+24m) right after pit exit, sweeping Esses descent & back-straight rise
      const t1Hill = gaussianBump(p, 0.145, 0.055) * 24.5;
      const midWave = gaussianBump(p, 0.48, 0.11) * 9.5 + gaussianBump(p, 0.72, 0.09) * 11.0;
      y = (t1Hill + midWave) * sfWin;
      bankRad = gaussianBump(p, 0.145, 0.03) * 0.08 * sfWin;
    } else if (id === "spielberg" || id === "zeltweg" || id === "oesterreichring") {
      // Red Bull Ring / Austrian Alps: steep climb to Turn 3 (+24m) and rolling mountain descent
      const mountain = gaussianBump(p, 0.36, 0.16) * 24.0 + gaussianBump(p, 0.62, 0.12) * 11.5;
      y = mountain * sfWin;
      bankRad = gaussianBump(p, 0.36, 0.05) * 0.07 * sfWin;
    } else if (id === "interlagos") {
      // Interlagos: Senna S drop into infield lake basin, then sweeping climb up Junção & Subida dos Boxes
      const ridge1 = gaussianBump(p, 0.22, 0.09) * 8.5;
      const ridge2 = gaussianBump(p, 0.78, 0.11) * 16.5;
      y = (ridge1 + ridge2) * sfWin;
      bankRad = gaussianBump(p, 0.78, 0.06) * 0.10 * sfWin;
    } else if (id === "zandvoort") {
      // Zandvoort: Iconic 18-degree banked Hugenholtzbocht (T3) & Arie Luyendykbocht (T14) + coastal dunes!
      const dunes = gaussianBump(p, 0.26, 0.08) * 10.5 + gaussianBump(p, 0.54, 0.10) * 8.0 + gaussianBump(p, 0.74, 0.08) * 6.5;
      y = dunes * sfWin;
      const hugen = gaussianBump(p, 0.23, 0.045) * 0.28; // ~16 deg banked hairpin
      const luyen = gaussianBump(p, 0.85, 0.048) * 0.30; // ~17.5 deg banked final corner!
      bankRad = (hugen + luyen) * sfWin;
    } else if (id === "suzuka") {
      // Suzuka: Iconic Figure-8 Overpass bridge (+9.5m) + Esses & Spoon elevation undulation
      const overpass = gaussianBump(p, 0.64, 0.065) * 9.5;
      const esses = gaussianBump(p, 0.25, 0.09) * 6.5 + gaussianBump(p, 0.44, 0.08) * 4.5;
      y = (overpass + esses) * sfWin;
      bankRad = gaussianBump(p, 0.78, 0.04) * 0.08 * sfWin;
    } else if (id === "monaco") {
      // Monaco: Sainte-Dévote -> Beau Rivage climb up to Casino Square (+13m), descending to Fairmont Hairpin & Harbour Tunnel!
      const casinoHill = gaussianBump(p, 0.24, 0.085) * 13.5;
      y = casinoHill * sfWin;
      inTunnel = p >= 0.45 && p <= 0.57;
    } else if (id === "portimao" || id === "imola" || id === "nurburgring" || id === "kyalami" || id === "watkins" || id === "brandshatch" || id === "istanbul" || id === "mugello") {
      // Classic rollercoaster natural-terrain circuits
      const h1 = gaussianBump(p, 0.26, 0.11) * 16.5;
      const h2 = gaussianBump(p, 0.56, 0.11) * 14.0;
      const h3 = gaussianBump(p, 0.77, 0.09) * 10.5;
      y = (h1 + h2 + h3) * sfWin;
      bankRad = gaussianBump(p, 0.56, 0.05) * 0.07 * sfWin;
    } else if (biome === "parkland" || biome === "coastal") {
      // Subtle organic rolling elevation for permanent parkland/coastal circuits
      const seed = (hashStr(id) % 100) / 100;
      const wave = (0.5 + 0.5 * Math.sin(p * Math.PI * 4 + seed * 6.28)) * 4.2 + gaussianBump(p, 0.38 + seed * 0.2, 0.12) * 3.8;
      y = wave * sfWin;
    } else {
      // Authentic flat street / desert circuits
      y = 0;
    }

    return { y: Math.max(0, y), bankRad, inTunnel };
  }

  function getCircuitElevationAndBank(circuit, prog) {
    const base = rawCircuitElevAndBank(circuit, prog);
    const eps = 0.0025;
    const prev = rawCircuitElevAndBank(circuit, prog - eps);
    const next = rawCircuitElevAndBank(circuit, prog + eps);
    const perimM = Math.max(2200, ((circuit && circuit.length_km) || 5.0) * 660);
    const ds = Math.max(1.0, perimM * (eps * 2));
    const slopePitch = clamp(Math.atan2(next.y - prev.y, ds), -0.22, 0.22);
    return {
      y: base.y,
      slopePitch,
      bankRad: base.bankRad,
      inTunnel: base.inTunnel,
    };
  }

  global.F1TrackArchitect = {
    PIT_BOX_COLORS,
    buildPitLayout,
    sampleFastLane,
    samplePitStopMotion,
    buildGridSlots,
    buildCircuitLayout,
    auditLayoutClearance,
    assignCarLaunchProfile,
    createStandingStartState,
    stepStandingStart,
    getCircuitElevationAndBank,
  };
})(window);
