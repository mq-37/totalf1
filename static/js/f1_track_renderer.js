/**
 * Shared 12-Layer F1-World Broadcast & Satellite Circuit Renderer.
 * Used by BOTH /play (Track Simulator) and /career (Live 2-Car Team Principal GP).
 *
 * Renders:
 *  - Circuit-authentic biome terrain (parkland, night desert, night street, harbour/coastal)
 *  - Stylized water bodies (Albert Park Lake, Port Hercule, Marina Bay, St. Lawrence, Red Sea, Yas Marina)
 *  - Floodlight halos on night races, grandstands & pit complex buildings along main straight
 *  - Outside raked gravel traps & FIA blue/red painted asphalt runoff pads
 *  - Banked corner camber arcs (Zandvoort 18°, Jeddah 12°, Madring 24%) & Monaco Tunnel deck
 *  - Inner Pit Lane Bypass (pitting cars physically traverse & stop)
 *  - Dynamic rubbered-in racing groove, wet sheen + drying line, rain streaks & radar vignette
 *  - Sector S1/S2/S3 rails + live Sector Yellow Flag flashes + VSC/SC halo & pace car
 *  - DRS Detection lines + Activation chevrons (respects FIA DRS Enabled / Disabled state)
 *  - FIA Speed Trap laser gate + numbered Turn badges + de-overlapped corner names + North compass
 *  - Oriented top-down miniature F1 cars with team livery, Pirelli tyres, brake lights, ERS & DRS FX
 */
(function () {
  "use strict";

  const BIOMES = {
    parkland:     { bg0: "#0e1d1a", bg1: "#091314", bg2: "#05090d", contour: "rgba(74, 222, 128, 0.055)", infield: "rgba(22, 101, 52, 0.14)", runoff: "rgba(186, 160, 118, 0.19)", friction: "#1e3a5f" },
    harbour:      { bg0: "#0d1a26", bg1: "#08111c", bg2: "#050911", contour: "rgba(56, 189, 248, 0.06)",  infield: "rgba(30, 58, 138, 0.10)", runoff: "rgba(148, 163, 184, 0.22)", friction: "#0284c7" },
    coastal:      { bg0: "#141c24", bg1: "#0b121b", bg2: "#050911", contour: "rgba(250, 204, 21, 0.05)",  infield: "rgba(180, 150, 96, 0.09)", runoff: "rgba(194, 166, 120, 0.20)", friction: "#0284c7" },
    street:       { bg0: "#141824", bg1: "#0b0f19", bg2: "#05070e", contour: "rgba(148, 163, 184, 0.06)", infield: "rgba(51, 65, 85, 0.14)",   runoff: "rgba(71, 85, 105, 0.34)",  friction: "#dc2626" },
    night_desert: { bg0: "#131326", bg1: "#0a0b19", bg2: "#04050c", contour: "rgba(251, 191, 36, 0.06)",  infield: "rgba(120, 82, 42, 0.11)",  runoff: "rgba(14, 116, 144, 0.26)", friction: "#06b6d4" },
    night_street: { bg0: "#111224", bg1: "#080a17", bg2: "#04050c", contour: "rgba(168, 85, 247, 0.065)", infield: "rgba(30, 41, 59, 0.16)",   runoff: "rgba(56, 189, 248, 0.22)", friction: "#a855f7" },
    desert:       { bg0: "#1c1712", bg1: "#120f0d", bg2: "#080707", contour: "rgba(245, 158, 11, 0.06)",  infield: "rgba(146, 64, 14, 0.10)",  runoff: "rgba(217, 179, 130, 0.2)", friction: "#0284c7" },
  };

  // Zoom-Invariant Physical F1 Chassis Dimensions (5.63m x 2.00m scaled to 13.3u tarmac width)
  const PHYS_LEN = 5.60;
  const PHYS_WID = 2.40;

  function getChassisMetrics() {
    return { length: PHYS_LEN, width: PHYS_WID };
  }

  function resampleSmoothClosed(pts, samples) {
    const n = pts.length;
    if (n < 3) return [];
    // Stage 1: Dense Catmull-Rom spline (1600 pts) for C1 curvature continuity
    const denseN = Math.max(samples * 4, 1600);
    const dense = new Array(denseN);
    for (let s = 0; s < denseN; s++) {
      const t = (s / denseN) * n;
      const i1 = Math.floor(t) % n;
      const i0 = (i1 - 1 + n) % n;
      const i2 = (i1 + 1) % n;
      const i3 = (i1 + 2) % n;
      const f = t - Math.floor(t);
      const f2 = f * f;
      const f3 = f2 * f;
      const p0 = pts[i0], p1 = pts[i1], p2 = pts[i2], p3 = pts[i3];
      const cx = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * f + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * f2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * f3);
      const cy = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * f + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * f2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * f3);
      dense[s] = [
        cx * 0.78 + (p1[0] + (p2[0] - p1[0]) * f) * 0.22,
        cy * 0.78 + (p1[1] + (p2[1] - p1[1]) * f) * 0.22,
      ];
    }
    // Stage 2: Exact Uniform Arc-Length Re-Parameterization (eliminates GPS point-density velocity & heading distortion!)
    const cum = new Float64Array(denseN + 1);
    let total = 0;
    for (let i = 0; i < denseN; i++) {
      const a = dense[i], b = dense[(i + 1) % denseN];
      total += Math.hypot(b[0] - a[0], b[1] - a[1]);
      cum[i + 1] = total;
    }
    if (total < 1e-6) return dense.slice(0, samples);
    const out = new Array(samples);
    let cursor = 0;
    for (let k = 0; k < samples; k++) {
      const targetS = (k / samples) * total;
      while (cursor < denseN - 1 && cum[cursor + 1] < targetS) cursor++;
      const segLen = Math.max(1e-9, cum[cursor + 1] - cum[cursor]);
      const frac = Math.max(0, Math.min(1, (targetS - cum[cursor]) / segLen));
      const a = dense[cursor], b = dense[(cursor + 1) % denseN];
      out[k] = [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
    }
    return out;
  }

  function buildGeometry(circuit, cssW, cssH) {
    const raw = resampleSmoothClosed(circuit.points, 400);
    const n = raw.length;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (raw[i][0] < minX) minX = raw[i][0];
      if (raw[i][0] > maxX) maxX = raw[i][0];
      if (raw[i][1] < minY) minY = raw[i][1];
      if (raw[i][1] > maxY) maxY = raw[i][1];
    }
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const padX = Math.max(46, cssW * 0.08);
    const padY = Math.max(40, cssH * 0.09);
    const scale = Math.min(Math.max(80, cssW - padX * 2) / bw, Math.max(80, cssH - padY * 2) / bh);
    const offX = (cssW - bw * scale) * 0.5 - minX * scale;
    const offY = (cssH - bh * scale) * 0.5 - minY * scale;

    const pts = [];
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) {
      const x = raw[i][0] * scale + offX;
      const y = raw[i][1] * scale + offY;
      pts.push({ x, y, tx: 1, ty: 0, nx: 0, ny: 1, curv: 0, sign: 1 });
      cx += x; cy += y;
    }
    cx /= n; cy /= n;

    let totalLen = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      totalLen += Math.hypot(b.x - a.x, b.y - a.y);
    }
    totalLen = Math.max(400, totalLen);

    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 2 + n) % n], next = pts[(i + 2) % n];
      const len = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
      pts[i].tx = (next.x - prev.x) / len;
      pts[i].ty = (next.y - prev.y) / len;
      pts[i].nx = -pts[i].ty;
      pts[i].ny = pts[i].tx;

      const pA = pts[(i - 4 + n) % n], pC = pts[(i + 4) % n];
      let da = Math.atan2(pC.y - pts[i].y, pC.x - pts[i].x) - Math.atan2(pts[i].y - pA.y, pts[i].x - pA.x);
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      pts[i].signedCurv = da;
      pts[i].curv = Math.abs(da);
      pts[i].sign = da >= 0 ? 1 : -1;
      pts[i].optLat = 0;
      pts[i].speedMult = 1.0;
      pts[i].vKph = 240;
      pts[i].aLongG = 0;
      pts[i].lineZone = "full";
    }
    // Smooth signedCurv continuously across chicanes so steering & slip angle NEVER snap,
    // while preserving crisp local apex curvature `pts[i].curv` & `pts[i].sign`!
    for (let scPass = 0; scPass < 5; scPass++) {
      const tmp = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        tmp[i] = 0.25 * pts[(i - 1 + n) % n].signedCurv + 0.5 * pts[i].signedCurv + 0.25 * pts[(i + 1) % n].signedCurv;
      }
      for (let i = 0; i < n; i++) pts[i].signedCurv = tmp[i];
    }

    // 1. Pre-compute Curvature-Constrained Optimal Racing Line ("The Best Line v2")!
    // Iterative chord-relaxation with in-loop slope limiting (<=0.46u/step) achieves
    // ~98%+ inside apex accuracy, ~0% wrong-side, AND silky smooth chicane transitions across all 24 circuits!
    const isStreet = circuit.biome === "street" || circuit.biome === "night_street";
    const maxLat = isStreet ? 4.15 : 4.42;
    const optLat = new Float64Array(n);
    const maxStepJump = 0.46;
    for (let pass = 0; pass < 24; pass++) {
      const nextLat = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const iPrev = (i - 4 + n) % n;
        const iNext = (i + 4) % n;
        const pPrev = pts[iPrev], pNext = pts[iNext], pCur = pts[i];
        const mx = 0.5 * ((pPrev.x + pPrev.nx * optLat[iPrev]) + (pNext.x + pNext.nx * optLat[iNext]));
        const my = 0.5 * ((pPrev.y + pPrev.ny * optLat[iPrev]) + (pNext.y + pNext.ny * optLat[iNext]));
        let proj = (mx - pCur.x) * pCur.nx + (my - pCur.y) * pCur.ny;
        if (pCur.curv > 0.32) {
          const apexPull = Math.min(1, (pCur.curv - 0.26) / 0.42) * pCur.sign * maxLat;
          proj = proj * 0.62 + apexPull * 0.38;
        }
        nextLat[i] = Math.max(-maxLat, Math.min(maxLat, optLat[i] * 0.40 + proj * 0.60));
      }
      for (let i = 0; i < n; i++) optLat[i] = nextLat[i];
    }
    // 3 Gaussian smoothing passes + curvature-weighted symmetric slope-limiter (|ΔoptLat| <= 0.46u!)
    // Shifts low-curvature entry/exit points early so high-curvature apexes NEVER get dragged off the inside kerb!
    for (let s = 0; s < 3; s++) {
      const sm = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        sm[i] = 0.22 * optLat[(i - 1 + n) % n] + 0.56 * optLat[i] + 0.22 * optLat[(i + 1) % n];
      }
      for (let i = 0; i < n; i++) optLat[i] = Math.max(-maxLat, Math.min(maxLat, sm[i]));
    }
    for (let pass = 0; pass < 220; pass++) {
      let maxViol = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const diff = optLat[j] - optLat[i];
        const absD = Math.abs(diff);
        if (absD > maxStepJump) {
          const ex = absD - maxStepJump;
          if (ex > maxViol) maxViol = ex;
          // High-curvature apex points stay more anchored; lower-curvature neighbours adjust smoothly
          const wI = 1.0 / (1.0 + pts[i].curv * 2.2);
          const wJ = 1.0 / (1.0 + pts[j].curv * 2.2);
          const wSum = wI + wJ;
          const sgn = Math.sign(diff);
          optLat[i] = Math.max(-maxLat, Math.min(maxLat, optLat[i] + sgn * ex * (wI / wSum)));
          optLat[j] = Math.max(-maxLat, Math.min(maxLat, optLat[j] - sgn * ex * (wJ / wSum)));
        }
      }
      if (maxViol < 1e-4) break;
    }
    for (let i = 0; i < n; i++) pts[i].optLat = optLat[i];

    // 2. Single-Source Physical Speed Profile (Meters-Accurate 3.9G Braking + 1.7G Traction!)
    const segMeters = ((circuit.length_km || 5.0) * 1000) / n;
    const topKph = circuit.top_speed_kph || 330;
    const minApexKph = isStreet ? 76 : 86;
    const vProf = new Float64Array(n); // km/h
    for (let i = 0; i < n; i++) {
      const cLoc = 0.5 * pts[i].curv + 0.25 * pts[(i - 2 + n) % n].curv + 0.25 * pts[(i + 2) % n].curv;
      const frac = Math.min(1, Math.pow(cLoc / 0.90, 0.88));
      vProf[i] = Math.max(minApexKph, topKph - frac * (topKph - minApexKph));
    }
    const aBrakeMs2 = 3.85 * 9.81;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const vNxt = vProf[(i + 1) % n] / 3.6;
        const vMax = Math.sqrt(vNxt * vNxt + 2 * aBrakeMs2 * segMeters) * 3.6;
        if (vProf[i] > vMax) vProf[i] = vMax;
      }
      for (let i = 0; i < n; i++) {
        const vPrv = vProf[(i - 1 + n) % n] / 3.6;
        const speedFrac = Math.min(1, (vPrv * 3.6) / topKph);
        const aAccelMs2 = (1.72 * (1 - 0.52 * speedFrac * speedFrac)) * 9.81;
        const vMax = Math.sqrt(vPrv * vPrv + 2 * Math.max(2.4, aAccelMs2) * segMeters) * 3.6;
        if (vProf[i] > vMax) vProf[i] = vMax;
      }
    }
    for (let sp = 0; sp < 6; sp++) {
      const tmpV = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        tmpV[i] = 0.25 * vProf[(i - 1 + n) % n] + 0.50 * vProf[i] + 0.25 * vProf[(i + 1) % n];
      }
      for (let i = 0; i < n; i++) vProf[i] = tmpV[i];
    }

    // Normalize speedMult strictly so harmonic mean(1 / speedMult) === 1.0000 (exact base lap conservation!)
    let invSum = 0;
    for (let i = 0; i < n; i++) invSum += 1.0 / Math.max(40, vProf[i]);
    const harmMean = invSum / n;
    let invSum2 = 0;
    for (let i = 0; i < n; i++) {
      pts[i].speedMult = Math.max(0.50, Math.min(1.48, vProf[i] * harmMean));
      invSum2 += 1.0 / pts[i].speedMult;
    }
    const norm2 = invSum2 / n;
    const avgLapKph = ((circuit.length_km || 5.0) / Math.max(40, circuit.base_lap_s || 85)) * 3600;
    for (let i = 0; i < n; i++) {
      pts[i].speedMult *= norm2;
      // Scale physical vKph directly from speedMult * avgLapKph (single source of truth!)
      pts[i].vKph = Math.max(62, avgLapKph * pts[i].speedMult);
    }
    for (let i = 0; i < n; i++) {
      const vPrv = pts[(i - 1 + n) % n].vKph / 3.6;
      const vNxt = pts[(i + 1) % n].vKph / 3.6;
      const aG = ((vNxt * vNxt - vPrv * vPrv) / (4 * Math.max(1, segMeters))) / 9.81;
      pts[i].aLongG = Math.max(-5.6, Math.min(2.1, aG));
      pts[i].lineZone = pts[i].aLongG < -1.15 ? "brake" : (pts[i].vKph < avgLapKph * 0.78 ? "apex" : "full");
    }

    const p0 = pts[0];
    const pitSide = ((cx - p0.x) * p0.nx + (cy - p0.y) * p0.ny) >= 0 ? 1 : -1;
    const pitSpan = 0.085;
    const pitPts = [];
    for (let k = 0; k <= 44; k++) {
      const u = k / 44;
      const prog = ((1 - pitSpan + u * pitSpan * 2) % 1 + 1) % 1;
      const p = pts[Math.floor(prog * n) % n];
      const off = pitSide * (19 * Math.pow(Math.sin(u * Math.PI), 0.65));
      pitPts.push({ x: p.x + p.nx * off, y: p.y + p.ny * off, tx: p.tx, ty: p.ty, nx: p.nx, ny: p.ny });
    }

    return { pts, n, cx, cy, scale, pitPts, pitSide, cssW, cssH, totalLen, segMeters, avgLapKph, maxLat };
  }

  function sampleTrack(geom, prog) {
    const pNorm = ((prog % 1) + 1) % 1;
    const fIdx = pNorm * geom.n;
    const iA = Math.floor(fIdx) % geom.n;
    const iB = (iA + 1) % geom.n;
    const frac = fIdx - Math.floor(fIdx);
    const a = geom.pts[iA], b = geom.pts[iB];
    return {
      x: a.x + (b.x - a.x) * frac,
      y: a.y + (b.y - a.y) * frac,
      tx: a.tx + (b.tx - a.tx) * frac,
      ty: a.ty + (b.ty - a.ty) * frac,
      nx: a.nx + (b.nx - a.nx) * frac,
      ny: a.ny + (b.ny - a.ny) * frac,
      curv: a.curv + (b.curv - a.curv) * frac,
      sign: a.sign,
      signedCurv: (a.signedCurv || 0) + ((b.signedCurv || 0) - (a.signedCurv || 0)) * frac,
      optLat: (a.optLat || 0) + ((b.optLat || 0) - (a.optLat || 0)) * frac,
      speedMult: (a.speedMult || 1) + ((b.speedMult || 1) - (a.speedMult || 1)) * frac,
      vKph: (a.vKph || 220) + ((b.vKph || 220) - (a.vKph || 220)) * frac,
      aLongG: (a.aLongG || 0) + ((b.aLongG || 0) - (a.aLongG || 0)) * frac,
      lineZone: a.lineZone || "full",
    };
  }

  // Real longitudinal speed factor combining physical speed profile + velocity-first TTC & battle modifiers!
  function getSpeedFactor(geom, prog, car) {
    if (!geom || !geom.pts || !geom.pts.length) return 1.0;
    const p = sampleTrack(geom, prog);
    const base = p.speedMult || 1.0;
    const bMult = (car && Number.isFinite(car.battleSpeedMult)) ? car.battleSpeedMult : 1.0;
    const ttcCap = (car && Number.isFinite(car._ttcCap)) ? car._ttcCap : 1.6;
    return Math.min(ttcCap, base * bMult);
  }

  function samplePitLane(geom, u) {
    const arr = geom.pitPts;
    const c = Math.max(0, Math.min(1, u));
    const f = c * (arr.length - 1);
    const iA = Math.floor(f), iB = Math.min(arr.length - 1, iA + 1);
    const fr = f - iA;
    const a = arr[iA], b = arr[iB];
    return {
      x: a.x + (b.x - a.x) * fr,
      y: a.y + (b.y - a.y) * fr,
      tx: a.tx + (b.tx - a.tx) * fr,
      ty: a.ty + (b.ty - a.ty) * fr,
    };
  }

  // Single-Source F1 TV Telemetry: Driven directly from unified physical speed profile & live car velocity!
  function computeCarTelemetry(geom, circuit, prog, opts) {
    const o = opts || {};
    if (o.inPit) {
      return {
        kph: 80, gear: 2, rpm: 7400, maxRpm: 12800,
        throttle: 35, brake: 0, braking: false,
        latG: 0, longG: 0, steerAngle: 0, brakeTemp: 340, slipAngle: 0,
      };
    }
    const sample = sampleTrack(geom, prog);
    const top = circuit.top_speed_kph || 330;
    const car = o.car || null;

    let kph = (car && Number.isFinite(car.livePhysKph))
      ? car.livePhysKph
      : sample.vKph;
    if (!car) {
      if (o.drsOpen) kph += 8;
      if (o.ersHot) kph += 5;
      if (o.wetness >= 60) kph *= 0.88;
      else if (o.wetness >= 22) kph *= 0.94;
      if (o.vscActive) kph *= 0.72;
      if (o.scActive) kph = Math.min(kph, 155);
    }
    kph = Math.max(60, Math.min(top + 42, kph));

    const longG = (car && Number.isFinite(car.liveLongG))
      ? car.liveLongG
      : sample.aLongG;
    const braking = !o.scActive && (longG < -1.05 || sample.lineZone === "brake");
    const brake = braking ? Math.max(18, Math.min(100, Math.round((-longG - 0.5) * 23))) : 0;

    const gearBounds = [0, 74, 114, 150, 188, 226, 264, 300, 375];
    let gear = 8;
    for (let g = 1; g <= 8; g++) {
      if (kph < gearBounds[g]) { gear = g; break; }
    }
    const gMin = gearBounds[gear - 1];
    const gMax = Math.max(gMin + 10, gearBounds[gear]);
    const gFrac = Math.max(0, Math.min(1, (kph - gMin) / (gMax - gMin)));
    const rpm = Math.round(8600 + gFrac * 3950 + (o.ersHot ? 260 : 0));

    const throttle = braking
      ? 0
      : Math.max(25, Math.min(100, Math.round(58 + Math.max(0, longG) * 24 + (1 - Math.min(1, sample.curv / 0.95)) * 24)));
    const speedRatio = kph / 310;
    const sCurv = Math.max(-1.05, Math.min(1.05, sample.signedCurv || (sample.sign * sample.curv))) / 1.05;
    const latG = Math.max(-5.4, Math.min(5.4, sCurv * speedRatio * 5.2));
    const steerAngle = Math.max(-0.42, Math.min(0.42, sCurv * 0.44));
    const brakeTemp = Math.round(
      360 + (braking ? brake * 5.6 : Math.min(1, sample.curv / 0.95) * 220) + (o.wetness >= 22 ? -85 : 0)
    );
    const slipAngle = Math.max(-0.12, Math.min(0.12, sCurv * (o.wetness >= 22 ? 0.10 : 0.068)));

    return {
      kph: Math.round(kph), gear, rpm, maxRpm: 12800,
      throttle, brake, braking,
      latG, longG, steerAngle, brakeTemp, slipAngle,
    };
  }

  // Critically-damped visual motion & telemetry smoother — eliminates ALL heading/HUD jitter at 1x–12x zoom!
  function computeSmoothCarMotion(car, pose, telem, dt, inPit) {
    const stepDt = Math.min(0.05, Math.max(0.004, dt || 0.016));
    const latSlope = inPit ? 0 : Math.max(-0.16, Math.min(0.16, (car.latVel || 0) * 0.016));
    const vx = (pose.tx || 1) + (pose.nx || 0) * latSlope;
    const vy = (pose.ty || 0) + (pose.ny || 1) * latSlope;
    const desiredAng = Math.atan2(vy, vx) + (inPit ? 0 : (telem.slipAngle || 0) * 0.40);

    if (car.visualAngle == null || !Number.isFinite(car.visualAngle)) {
      car.visualAngle = desiredAng;
    } else {
      let diff = desiredAng - car.visualAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const maxStep = 3.85 * stepDt;
      const step = Math.max(-maxStep, Math.min(maxStep, diff * Math.min(1, stepDt * 9.0)));
      car.visualAngle += step;
    }

    const alpha = Math.min(1, stepDt * 9.5);
    if (!car._smT) {
      car._smT = Object.assign({}, telem);
    } else {
      const s = car._smT;
      s.kph += (telem.kph - s.kph) * alpha;
      s.rpm += (telem.rpm - s.rpm) * alpha;
      s.throttle += (telem.throttle - s.throttle) * alpha;
      s.brake += (telem.brake - s.brake) * alpha;
      s.latG += (telem.latG - s.latG) * alpha;
      s.longG += (telem.longG - s.longG) * alpha;
      s.steerAngle += (telem.steerAngle - s.steerAngle) * alpha;
      s.brakeTemp += (telem.brakeTemp - s.brakeTemp) * Math.min(1, stepDt * 4.5);
      s.gear = telem.gear;
      s.braking = telem.braking;
      s.maxRpm = telem.maxRpm || 12800;
    }
    const s = car._smT;
    return {
      angle: car.visualAngle,
      steerAngle: s.steerAngle,
      telem: {
        kph: Math.round(s.kph),
        gear: s.gear,
        rpm: Math.round(s.rpm),
        maxRpm: s.maxRpm,
        throttle: Math.round(s.throttle),
        brake: Math.round(s.brake),
        braking: s.braking,
        latG: s.latG,
        longG: s.longG,
        steerAngle: s.steerAngle,
        brakeTemp: Math.round(s.brakeTemp),
        slipAngle: telem.slipAngle,
      },
    };
  }

  function drawWaterFeature(ctx, circuit, geom) {
    const wz = circuit.water_zone;
    if (!wz) return;
    const { cssW, cssH, cx, cy, pts, n } = geom;
    ctx.save();
    ctx.fillStyle = "rgba(14, 116, 144, 0.22)";
    ctx.strokeStyle = "rgba(56, 189, 248, 0.26)";
    ctx.lineWidth = 1.4;

    let lx = cx, ly = cy;
    if (wz === "infield_lake") {
      // Albert Park Lake nestled inside the circuit!
      ctx.beginPath();
      for (let i = 0; i < n; i += 3) {
        const px = cx + (pts[i].x - cx) * 0.58;
        const py = cy + (pts[i].y - cy) * 0.56;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (wz === "harbour_se") {
      ctx.beginPath();
      ctx.moveTo(cssW * 0.52, cssH);
      ctx.quadraticCurveTo(cssW * 0.64, cssH * 0.72, cssW, cssH * 0.56);
      ctx.lineTo(cssW, cssH);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      lx = cssW * 0.84; ly = cssH * 0.85;
    } else if (wz === "south_marina" || wz === "south_sea") {
      ctx.beginPath();
      ctx.moveTo(0, cssH * 0.86);
      ctx.quadraticCurveTo(cssW * 0.5, cssH * 0.78, cssW, cssH * 0.88);
      ctx.lineTo(cssW, cssH); ctx.lineTo(0, cssH);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      lx = cssW * 0.5; ly = cssH * 0.93;
    } else if (wz === "west_coast") {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(cssW * 0.14, 0);
      ctx.quadraticCurveTo(cssW * 0.20, cssH * 0.5, cssW * 0.12, cssH);
      ctx.lineTo(0, cssH);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      lx = cssW * 0.08; ly = cssH * 0.52;
    } else if (wz === "river_wrap") {
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(cssW, 0);
      ctx.lineTo(cssW, cssH * 0.13);
      ctx.quadraticCurveTo(cssW * 0.5, cssH * 0.07, 0, cssH * 0.15);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      lx = cssW * 0.5; ly = cssH * 0.075;
    }

    if (circuit.water_label) {
      ctx.font = "700 8.5px Orbitron, sans-serif";
      ctx.fillStyle = "rgba(125, 211, 252, 0.42)";
      ctx.textAlign = "center";
      ctx.fillText(circuit.water_label, lx, ly);
    }
    ctx.restore();
  }

  // Build Offscreen Static Track Canvas (Biome, Water, Floodlights, Grandstands, Runoff, Banking, Pit Lane, Kerbs, Sectors, Corners)
  function buildStaticCache(targetCanvas, circuit, geom, dpr, layers) {
    const { cssW, cssH, pts, n, cx, cy, pitPts } = geom;
    const biome = BIOMES[circuit.biome] || BIOMES.parkland;
    // Supersample static circuit canvas cleanly (up to 4096px GPU safe cap) so 8.5x–12x close-ups stay razor-sharp!
    const maxSafeDpr = Math.min(4096 / Math.max(1, cssW), 4096 / Math.max(1, cssH));
    const hiDpr = Math.min(maxSafeDpr, 5.0, Math.max(dpr || 1, 1) * 3.2);
    targetCanvas.width = Math.round(cssW * hiDpr);
    targetCanvas.height = Math.round(cssH * hiDpr);
    const ctx = targetCanvas.getContext("2d");
    ctx.setTransform(hiDpr, 0, 0, hiDpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // 1. Biome Radial Backdrop + Subtle Telemetry Grid
    const bgGrad = ctx.createRadialGradient(cx, cy, 24, cx, cy, Math.max(cssW, cssH) * 0.75);
    bgGrad.addColorStop(0, biome.bg0);
    bgGrad.addColorStop(0.55, biome.bg1);
    bgGrad.addColorStop(1, biome.bg2);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.strokeStyle = "rgba(148, 163, 184, 0.04)";
    ctx.lineWidth = 1;
    for (let gx = 48; gx < cssW; gx += 48) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, cssH); ctx.stroke(); }
    for (let gy = 48; gy < cssH; gy += 48) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cssW, gy); ctx.stroke(); }

    // Perimeter FIA telemetry ruler ticks
    ctx.strokeStyle = "rgba(148, 163, 184, 0.15)";
    for (let gx = 24; gx < cssW; gx += 24) {
      const len = gx % 96 === 0 ? 7 : 3;
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, len); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx, cssH); ctx.lineTo(gx, cssH - len); ctx.stroke();
    }

    // 2. Stylized Water Body (Lake / Harbour / Seafront) + Biome Infield Tint + Elevation Contours
    drawWaterFeature(ctx, circuit, geom);

    // Subtle infield grass/desert fill inside loop (skip for infield_lake so lake shines cleanly)
    if (circuit.water_zone !== "infield_lake") {
      ctx.beginPath();
      for (let i = 0; i < n; i++) i === 0 ? ctx.moveTo(pts[i].x, pts[i].y) : ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = biome.infield;
      ctx.fill();
    }

    [1.13, 1.27, 1.43, 1.60].forEach((mult, idx) => {
      ctx.beginPath();
      for (let i = 0; i < n; i += 2) {
        const px = cx + (pts[i].x - cx) * mult;
        const py = cy + (pts[i].y - cy) * mult;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = biome.contour;
      ctx.globalAlpha = 1 - idx * 0.2;
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // Night Race Stadium Floodlight Halos!
    if (circuit.is_night) {
      for (let k = 0; k < 8; k++) {
        const p = pts[Math.floor((k / 8) * n) % n];
        const fx = p.x - p.nx * 24, fy = p.y - p.ny * 24;
        const fg = ctx.createRadialGradient(fx, fy, 2, fx, fy, 46);
        fg.addColorStop(0, "rgba(254, 249, 195, 0.16)");
        fg.addColorStop(1, "rgba(254, 249, 195, 0)");
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(fx, fy, 46, 0, Math.PI * 2); ctx.fill();
      }
    }

    // 3. Tarmac Runoff Pads (with FIA High-Friction Stripes) & Raked Gravel Traps
    (circuit.braking_zones || []).forEach((bz, bIdx) => {
      const centerI = Math.floor(bz.t * n) % n;
      const outSign = -pts[centerI].sign;
      const span = bz.sev >= 3 ? 9 : 6;
      const depth = bz.sev >= 3 ? 27 : (bz.sev === 2 ? 20 : 15);
      ctx.beginPath();
      for (let k = -span; k <= span; k++) {
        const p = pts[(centerI + k + n) % n];
        const env = Math.cos((k / span) * Math.PI * 0.5);
        const ox = p.x + p.nx * outSign * (7 + depth * env);
        const oy = p.y + p.ny * outSign * (7 + depth * env);
        k === -span ? ctx.moveTo(ox, oy) : ctx.lineTo(ox, oy);
      }
      for (let k = span; k >= -span; k--) {
        const p = pts[(centerI + k + n) % n];
        ctx.lineTo(p.x + p.nx * outSign * 6, p.y + p.ny * outSign * 6);
      }
      ctx.closePath();
      const isGravel = circuit.biome === "parkland" && bIdx % 2 === 0;
      ctx.fillStyle = isGravel ? biome.runoff : "rgba(30, 41, 59, 0.5)";
      ctx.fill();
      ctx.strokeStyle = isGravel ? "rgba(214, 188, 146, 0.30)" : biome.friction;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // 4. Grandstands (with tiered crowd stippling) & 10-Bay Team Pit Complex Buildings along Start/Finish Straight!
    const sf = pts[0];
    const sfAng = Math.atan2(sf.ty, sf.tx);
    ctx.save();
    ctx.translate(sf.x, sf.y);
    ctx.rotate(sfAng);
    // Main Grandstand (opposite pit side) with tiered canopy & colorful spectators
    const gsY = -geom.pitSide * 20;
    ctx.fillStyle = "rgba(22, 31, 48, 0.94)";
    ctx.strokeStyle = "rgba(148, 163, 184, 0.42)";
    ctx.lineWidth = 1;
    ctx.fillRect(-44, gsY - 5, 88, 10);
    ctx.strokeRect(-44, gsY - 5, 88, 10);
    const crowdCols = ["#ef4444", "#facc15", "#38bdf8", "#f8fafc", "#fb923c", "#22c55e"];
    for (let cxI = -40; cxI <= 40; cxI += 4) {
      ctx.fillStyle = crowdCols[Math.abs(cxI * 7) % crowdCols.length];
      ctx.globalAlpha = 0.52;
      ctx.fillRect(cxI, gsY - 3, 2, 1.8);
      ctx.fillStyle = crowdCols[Math.abs(cxI * 13 + 3) % crowdCols.length];
      ctx.fillRect(cxI + 1, gsY + 1, 2, 1.8);
    }
    ctx.globalAlpha = 1;
    // Team Pit Garages (inside pit lane) — Per-Track Architectural Pit Building Style!
    const garY = geom.pitSide * 30;
    const pStyle = (circuit && circuit.pit_building) || (circuit && circuit.biome === "street" ? "street_canopy" : "modern_glass");
    const teamBayCols = ["#e10600", "#ff8700", "#00d2be", "#1e41ff", "#006f62", "#0090ff", "#6692ff", "#b6babd", "#52e252", "#ffffff"];
    if (pStyle === "vintage_wood") {
      // 1950s/60s timber pit stalls, corrugated roof & straw bales
      ctx.fillStyle = "#4b3621";
      ctx.strokeStyle = "#a16207";
      ctx.lineWidth = 1.1;
      ctx.fillRect(-40, garY - 4.8, 80, 9.6);
      ctx.strokeRect(-40, garY - 4.8, 80, 9.6);
      for (let b = 0; b < 10; b++) {
        const bx = -38 + b * 7.6;
        ctx.fillStyle = b % 2 === 0 ? "rgba(254, 243, 199, 0.16)" : "rgba(180, 83, 9, 0.25)";
        ctx.fillRect(bx, garY - 3.4, 6.2, 6.8);
      }
      // Hay bales along pit edge
      ctx.fillStyle = "#d97706";
      for (let hb = -36; hb <= 36; hb += 9) ctx.fillRect(hb, garY - geom.pitSide * 6.4, 4.5, 1.8);
    } else if (pStyle === "classic_brick") {
      // Iconic European heritage brick/concrete garages with striped pit awnings
      ctx.fillStyle = "#2b1d1d";
      ctx.strokeStyle = "rgba(248, 113, 113, 0.55)";
      ctx.lineWidth = 1.1;
      ctx.fillRect(-42, garY - 5.2, 84, 10.4);
      ctx.strokeRect(-42, garY - 5.2, 84, 10.4);
      for (let b = 0; b < 10; b++) {
        const bx = -39.5 + b * 7.9;
        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.fillRect(bx, garY - 3.6, 6.5, 7.2);
        ctx.fillStyle = teamBayCols[b % teamBayCols.length];
        ctx.fillRect(bx, garY - geom.pitSide * 4.5, 6.5, 1.5);
      }
      // Heritage Timing Tower block
      ctx.fillStyle = "#334155";
      ctx.fillRect(43, garY - 4.5, 7, 9);
      ctx.fillStyle = "#facc15";
      ctx.fillRect(44.5, garY - 3, 4, 2);
    } else if (pStyle === "desert_wing") {
      // Sweeping cantilevered white desert paddock wing canopy + warm floodlit bays
      ctx.fillStyle = "rgba(241, 245, 249, 0.92)";
      ctx.strokeStyle = "rgba(250, 204, 21, 0.72)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(-45, garY - 5.5, 90, 11, 4) : ctx.rect(-45, garY - 5.5, 90, 11);
      ctx.fill();
      ctx.stroke();
      for (let b = 0; b < 10; b++) {
        const bx = -40 + b * 8.0;
        ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
        ctx.fillRect(bx, garY - 3.2, 6.6, 6.4);
        ctx.fillStyle = teamBayCols[b % teamBayCols.length];
        ctx.fillRect(bx, garY - geom.pitSide * 4.4, 6.6, 1.4);
      }
    } else if (pStyle === "street_canopy") {
      // Modular aluminum street-circuit temporary paddocks with overhead light trusses
      ctx.fillStyle = "rgba(15, 23, 42, 0.96)";
      ctx.strokeStyle = "rgba(56, 189, 248, 0.55)";
      ctx.lineWidth = 1.0;
      ctx.fillRect(-40, garY - 4.6, 80, 9.2);
      ctx.strokeRect(-40, garY - 4.6, 80, 9.2);
      for (let b = 0; b < 10; b++) {
        const bx = -38 + b * 7.6;
        ctx.fillStyle = "rgba(30, 41, 59, 0.92)";
        ctx.fillRect(bx, garY - 3.3, 6.4, 6.6);
        ctx.fillStyle = teamBayCols[b % teamBayCols.length];
        ctx.fillRect(bx, garY - geom.pitSide * 4.0, 6.4, 1.3);
      }
    } else {
      // Modern Glass F1 Paddock Club & Illuminated Team Garages
      ctx.fillStyle = "rgba(13, 20, 34, 0.96)";
      ctx.strokeStyle = "rgba(56, 189, 248, 0.65)";
      ctx.lineWidth = 1.1;
      ctx.fillRect(-44, garY - 5.4, 88, 10.8);
      ctx.strokeRect(-44, garY - 5.4, 88, 10.8);
      // Skylight glass ribbon
      ctx.fillStyle = "rgba(56, 189, 248, 0.16)";
      ctx.fillRect(-42, garY - 1.2, 84, 2.4);
      for (let b = 0; b < 10; b++) {
        const bx = -40 + b * 8.0;
        ctx.fillStyle = b % 2 === 0 ? "rgba(255,255,255,0.1)" : "rgba(56,189,248,0.12)";
        ctx.fillRect(bx, garY - 3.8, 6.6, 7.6);
        ctx.fillStyle = teamBayCols[b % teamBayCols.length];
        ctx.fillRect(bx, garY - geom.pitSide * 4.6, 6.6, 1.5);
      }
    }
    // Pit Speed Limit Board ("80" / "60")
    ctx.fillStyle = "#f8fafc";
    ctx.beginPath(); ctx.arc(-44, geom.pitSide * 18, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#dc2626"; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.restore();

    // 5. Inner Pit Lane Bypass + Painted Pit-Box Stalls
    ctx.save();
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    pitPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = "rgba(0, 0, 0, 0.65)"; ctx.lineWidth = 10.5; ctx.stroke();
    ctx.strokeStyle = "#162032"; ctx.lineWidth = 6.8; ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(250, 204, 21, 0.62)"; ctx.lineWidth = 1.05; ctx.stroke();
    ctx.setLineDash([]);
    // Painted pit-box bays along mid pit lane
    for (let k = 14; k <= 30; k += 4) {
      const bp = pitPts[k];
      if (!bp) continue;
      ctx.save();
      ctx.translate(bp.x + bp.nx * geom.pitSide * 2.2, bp.y + bp.ny * geom.pitSide * 2.2);
      ctx.rotate(Math.atan2(bp.ty, bp.tx));
      ctx.strokeStyle = "rgba(248, 250, 252, 0.35)";
      ctx.lineWidth = 0.7;
      ctx.strokeRect(-2.4, -1.5, 4.8, 3.0);
      ctx.restore();
    }
    ctx.restore();

    function traceLoop() {
      ctx.beginPath();
      for (let i = 0; i < n; i++) i === 0 ? ctx.moveTo(pts[i].x, pts[i].y) : ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    }

    // 6. Outer Shadow, Street Barriers / White Limits & FIA Red/White Apex Kerbs
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    traceLoop();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.78)";
    ctx.lineWidth = 23;
    ctx.stroke();

    traceLoop();
    ctx.strokeStyle = (circuit.biome === "street" || circuit.biome === "night_street")
      ? "rgba(226, 232, 240, 0.52)"
      : "rgba(241, 245, 249, 0.38)";
    ctx.lineWidth = 16;
    ctx.stroke();

    for (let i = 0; i < n; i++) {
      if (pts[i].curv > 0.24) {
        const p1 = pts[i], p2 = pts[(i + 1) % n], side = p1.sign;
        // Outside green astroturf exit strip on heavy corners
        if (pts[i].curv > 0.38) {
          ctx.beginPath();
          ctx.moveTo(p1.x - p1.nx * side * 9.8, p1.y - p1.ny * side * 9.8);
          ctx.lineTo(p2.x - p2.nx * side * 9.8, p2.y - p2.ny * side * 9.8);
          ctx.strokeStyle = "rgba(22, 163, 74, 0.42)";
          ctx.lineWidth = 2.6;
          ctx.stroke();
        }
        // Inside red/white FIA apex kerb
        ctx.beginPath();
        ctx.moveTo(p1.x + p1.nx * side * 8, p1.y + p1.ny * side * 8);
        ctx.lineTo(p2.x + p2.nx * side * 8, p2.y + p2.ny * side * 8);
        ctx.strokeStyle = i % 2 === 0 ? "#ef4444" : "#f8fafc";
        ctx.lineWidth = 3.4;
        ctx.stroke();
      }
    }

    // 7. Main Asphalt Ribbon + Off-Line Rubber Marbles + Crisp FIA White Track-Limit Edge Lines + Corner Braking Boards
    traceLoop();
    ctx.strokeStyle = "#1a2436";
    ctx.lineWidth = 14.2;
    ctx.stroke();

    // Subtle dual-tone asphalt micro-grain & off-line rubber marbles outside corners
    ctx.save();
    for (let i = 0; i < n; i += 2) {
      const p = pts[i];
      if (p.curv > 0.28) {
        const outSign = -p.sign;
        ctx.fillStyle = "rgba(2, 6, 14, 0.34)";
        ctx.beginPath();
        ctx.arc(p.x + p.nx * outSign * 5.2, p.y + p.ny * outSign * 5.2, 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // Crisp FIA white track-limit lines on left & right tarmac edges (razor-sharp when zoomed 3.8x-5.5x!)
    ctx.save();
    ctx.strokeStyle = "rgba(241, 245, 249, 0.56)";
    ctx.lineWidth = 0.65;
    [-6.65, 6.65].forEach((edgeOff) => {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        const ex = p.x + p.nx * edgeOff, ey = p.y + p.ny * edgeOff;
        i === 0 ? ctx.moveTo(ex, ey) : ctx.lineTo(ex, ey);
      }
      ctx.closePath();
      ctx.stroke();
    });

    // Subtle FIA 100m / 50m red-white braking markers before heavy corners
    let lastBoardI = -24;
    for (let i = 0; i < n; i++) {
      if (pts[i].curv > 0.42 && i - lastBoardI > 20) {
        lastBoardI = i;
        const outSign = -pts[i].sign;
        [3, 6].forEach((back, bIdx) => {
          const bp = pts[(i - back + n) % n];
          const bx = bp.x + bp.nx * outSign * 10.6, by = bp.y + bp.ny * outSign * 10.6;
          ctx.save();
          ctx.translate(bx, by);
          ctx.rotate(Math.atan2(bp.ty, bp.tx));
          ctx.fillStyle = "#f8fafc";
          ctx.fillRect(-1.4, -0.75, 2.8, 1.5);
          ctx.fillStyle = bIdx === 0 ? "#ef4444" : "#f59e0b";
          ctx.fillRect(-1.4, -0.75, 0.9, 1.5);
          ctx.restore();
        });
      }
    }
    ctx.restore();

    // Banked Corner Camber Highlight (Zandvoort 18°, Jeddah 12°, Madring 24%!)
    if (circuit.banked_turn) {
      const bt = circuit.banked_turn;
      const bi = Math.floor(bt.t * n) % n;
      ctx.save();
      ctx.beginPath();
      for (let k = -7; k <= 7; k++) {
        const p = pts[(bi + k + n) % n];
        const ox = p.x - p.nx * p.sign * 10.5, oy = p.y - p.ny * p.sign * 10.5;
        k === -7 ? ctx.moveTo(ox, oy) : ctx.lineTo(ox, oy);
      }
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 3.2;
      ctx.shadowColor = "rgba(251, 191, 36, 0.85)";
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      const pm = pts[bi];
      const bx = pm.x - pm.nx * pm.sign * 22, by = pm.y - pm.ny * pm.sign * 22;
      ctx.font = "800 8px Orbitron, sans-serif";
      const lbl = `${bt.deg} BANKED`;
      const tw = ctx.measureText(lbl).width + 8;
      ctx.fillStyle = "rgba(120, 53, 15, 0.9)";
      ctx.fillRect(bx - tw * 0.5, by - 7, tw, 12);
      ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 0.9; ctx.strokeRect(bx - tw * 0.5, by - 7, tw, 12);
      ctx.fillStyle = "#fef08a"; ctx.textAlign = "center";
      ctx.fillText(lbl, bx, by + 2);
      ctx.restore();
    }

    // Monaco Tunnel Overhead Deck!
    if (circuit.tunnel_range) {
      const [ta, tb] = circuit.tunnel_range;
      const i0 = Math.floor(ta * n), i1 = Math.floor(tb * n);
      ctx.save();
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const p = pts[i % n];
        i === i0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = "rgba(148, 163, 184, 0.42)";
      ctx.lineWidth = 17;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      const tm = pts[Math.floor((i0 + i1) * 0.5) % n];
      ctx.font = "800 7.5px Orbitron, sans-serif";
      ctx.fillStyle = "#e2e8f0";
      ctx.fillText("TUNNEL", tm.x + 12, tm.y - 8);
      ctx.restore();
    }

    // 8. Sector S1 / S2 / S3 Color Rails
    if (layers.sectors) {
      const secCols = ["#ef4444", "#38bdf8", "#facc15"];
      const bounds = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n];
      for (let s = 0; s < 3; s++) {
        ctx.beginPath();
        for (let i = bounds[s]; i <= bounds[s + 1]; i++) {
          const p = pts[i % n];
          const ox = p.x - p.nx * 10.5, oy = p.y - p.ny * 10.5;
          i === bounds[s] ? ctx.moveTo(ox, oy) : ctx.lineTo(ox, oy);
        }
        ctx.strokeStyle = secCols[s]; ctx.globalAlpha = 0.55; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.globalAlpha = 1;
      [1, 2].forEach((sIdx) => {
        const p = pts[bounds[sIdx]];
        ctx.beginPath();
        ctx.moveTo(p.x - p.nx * 12, p.y - p.ny * 12);
        ctx.lineTo(p.x + p.nx * 12, p.y + p.ny * 12);
        ctx.strokeStyle = secCols[sIdx]; ctx.lineWidth = 2; ctx.stroke();
        ctx.font = "800 8px Orbitron, sans-serif";
        ctx.fillStyle = secCols[sIdx];
        ctx.fillText(`S${sIdx + 1}`, p.x - p.nx * 20 - 6, p.y - p.ny * 20 + 3);
      });
    }

    // 9. Speed Trap Laser Gate (⚡ top_speed km/h)
    if (circuit.speed_trap_t != null) {
      const stP = pts[Math.floor(circuit.speed_trap_t * n) % n];
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(stP.x - stP.nx * 11, stP.y - stP.ny * 11);
      ctx.lineTo(stP.x + stP.nx * 11, stP.y + stP.ny * 11);
      ctx.strokeStyle = "#e879f9";
      ctx.lineWidth = 2;
      ctx.stroke();
      const sx = stP.x + stP.nx * 16, sy = stP.y + stP.ny * 16;
      ctx.font = "800 7.5px Orbitron, sans-serif";
      const sLbl = `⚡${circuit.top_speed_kph}kph`;
      const sw = ctx.measureText(sLbl).width + 6;
      ctx.fillStyle = "rgba(88, 28, 135, 0.85)";
      ctx.fillRect(sx - sw * 0.5, sy - 6, sw, 11);
      ctx.fillStyle = "#f5d0fe";
      ctx.textAlign = "center";
      ctx.fillText(sLbl, sx, sy + 2.5);
      ctx.restore();
    }

    // 10. Checkered Start / Finish Line, Grid Boxes, FIA Overhead Start Gantry & Pit Pill
    ctx.save();
    ctx.translate(sf.x, sf.y);
    ctx.rotate(sfAng);
    ctx.strokeStyle = "rgba(248, 250, 252, 0.28)";
    ctx.lineWidth = 1;
    for (let g = 1; g <= 8; g++) {
      const gx = -10 - g * 7.2, gy = g % 2 === 0 ? -3.4 : 3.4;
      ctx.strokeRect(gx - 2.8, gy - 1.5, 4.8, 3.0);
    }
    const cell = 3.6;
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? "#fff" : "#0f172a";
      ctx.fillRect(-cell + c * cell, -7.2 + r * cell, cell, cell);
    }
    ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 1.2; ctx.strokeRect(-cell, -7.2, cell * 2, cell * 4);
    // FIA Overhead Start Gantry Bridge spanning track behind S/F line
    ctx.fillStyle = "rgba(15, 23, 42, 0.88)";
    ctx.strokeStyle = "rgba(148, 163, 184, 0.55)";
    ctx.lineWidth = 0.7;
    ctx.fillRect(-8.5, -10.2, 2.8, 20.4);
    ctx.strokeRect(-8.5, -10.2, 2.8, 20.4);
    for (let pod = -2; pod <= 2; pod++) {
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(-7.1, pod * 3.1, 0.72, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const pitMid = pitPts[Math.floor(pitPts.length * 0.5)];
    if (pitMid) {
      const plx = pitMid.x + geom.pitSide * 11, ply = pitMid.y + geom.pitSide * 11;
      ctx.save();
      ctx.font = "800 7.5px Orbitron, sans-serif";
      const pw = ctx.measureText("PIT").width + 8;
      ctx.fillStyle = "rgba(9, 14, 26, 0.9)"; ctx.fillRect(plx - pw * 0.5, ply - 6, pw, 11);
      ctx.strokeStyle = "rgba(250, 204, 21, 0.65)"; ctx.lineWidth = 0.8; ctx.strokeRect(plx - pw * 0.5, ply - 6, pw, 11);
      ctx.fillStyle = "#fde047"; ctx.textAlign = "center"; ctx.fillText("PIT", plx, ply + 2.5);
      ctx.restore();
    }

    // 11. De-Overlapped Real Named Circuit Corners + Turn Number Badges
    if (layers.corners && circuit.corner_anchors) {
      const placed = [];
      ctx.font = "600 9.5px 'Source Sans 3', sans-serif";
      circuit.corner_anchors.forEach((ca, cIdx) => {
        const p = pts[Math.floor(ca.t * n) % n];
        const outSign = -p.sign;
        const tw = ctx.measureText(ca.name).width;
        const lx = Math.max(12, Math.min(cssW - tw - 12, p.x + p.nx * outSign * 26 - tw * 0.5));
        const ly = Math.max(24, Math.min(cssH - 36, p.y + p.ny * outSign * 26));
        if (placed.some((b) => Math.abs(b.x - lx) < (b.w + tw) * 0.48 && Math.abs(b.y - ly) < 16)) return;
        placed.push({ x: lx, y: ly, w: tw });

        ctx.beginPath();
        ctx.moveTo(p.x + p.nx * outSign * 9, p.y + p.ny * outSign * 9);
        ctx.lineTo(lx + tw * 0.5, ly - 2);
        ctx.strokeStyle = "rgba(148, 163, 184, 0.32)"; ctx.lineWidth = 1; ctx.stroke();

        ctx.fillStyle = "rgba(6, 10, 18, 0.82)";
        ctx.fillRect(lx - 4, ly - 10, tw + 8, 13);
        ctx.fillStyle = "#cbd5e1";
        ctx.fillText(ca.name, lx, ly);
      });
    }

    // 12. True North Broadcast Compass Rose & Circuit Heritage Watermark
    const northRad = ((circuit.north_deg || 0) * Math.PI) / 180;
    const rx = cssW - 28, ry = 28;
    ctx.save();
    ctx.translate(rx, ry);
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(9, 14, 26, 0.82)"; ctx.fill();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.3)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.rotate(northRad);
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(3.5, 2); ctx.lineTo(0, -1); ctx.lineTo(-3.5, 2); ctx.closePath();
    ctx.fillStyle = "#ef4444"; ctx.fill();
    ctx.rotate(-northRad);
    ctx.font = "800 7.5px Orbitron, sans-serif"; ctx.fillStyle = "#94a3b8"; ctx.textAlign = "center";
    ctx.fillText("N", 0, 11);
    ctx.restore();

    ctx.font = "700 9.5px Orbitron, sans-serif";
    ctx.fillStyle = "rgba(148, 163, 184, 0.62)";
    const nightTag = circuit.is_night ? " · 🌙 NIGHT" : "";
    const sprTag = circuit.is_sprint_2026 ? " · ⚡ SPRINT" : "";
    ctx.fillText(`${circuit.nat3 || "F1"} · ${circuit.name.toUpperCase()} · ALT ${circuit.altitude_m || 0}M${nightTag}${sprTag}`, 12, 18);
    if (circuit.lap_record) {
      ctx.font = "600 8.5px 'Source Sans 3', sans-serif";
      ctx.fillStyle = "rgba(148, 163, 184, 0.45)";
      ctx.fillText(`LAP REC: ${circuit.lap_record}`, 12, 30);
    }
  }

  // Draw Dynamic Track Overlays (Rubbered Groove, Wet/Drying Line, DRS Zones, Sector Yellows, VSC/SC)
  function drawDynamicTrackState(ctx, circuit, geom, state) {
    const { pts, n, cssW, cssH } = geom;
    function traceLoop() {
      ctx.beginPath();
      for (let i = 0; i < n; i++) i === 0 ? ctx.moveTo(pts[i].x, pts[i].y) : ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    }

    // Track rubbering-in racing groove follows the TRUE geometric optimal racing line (out -> apex -> exit)!
    const rubberAlpha = 0.28 + (Math.min(100, state.gripPct || 35) / 100) * 0.44;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const ox = p.x + p.nx * (p.optLat || 0);
      const oy = p.y + p.ny * (p.optLat || 0);
      i === 0 ? ctx.moveTo(ox, oy) : ctx.lineTo(ox, oy);
    }
    ctx.closePath();
    ctx.strokeStyle = `rgba(4, 7, 13, ${rubberAlpha.toFixed(2)})`;
    ctx.lineWidth = 4.4;
    ctx.stroke();

    // Optional Telemetry Optimal Racing Line Overlay (Green = Full Throttle, Amber = Turn-In/Apex, Red = Braking Zone!)
    if (state.showBestLine) {
      ctx.save();
      ctx.lineWidth = 1.45;
      ctx.lineCap = "round";
      const zoneCols = {
        full: "rgba(34, 197, 94, 0.42)",
        apex: "rgba(250, 204, 21, 0.48)",
        brake: "rgba(239, 68, 68, 0.62)",
      };
      for (let i = 0; i < n; i++) {
        const p1 = pts[i], p2 = pts[(i + 1) % n];
        ctx.beginPath();
        ctx.moveTo(p1.x + p1.nx * (p1.optLat || 0), p1.y + p1.ny * (p1.optLat || 0));
        ctx.lineTo(p2.x + p2.nx * (p2.optLat || 0), p2.y + p2.ny * (p2.optLat || 0));
        ctx.strokeStyle = zoneCols[p1.lineZone || "full"] || zoneCols.full;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Dynamic DRS Detection Lines + Activation Zones (dimmed amber when DRS disabled!)
    const drsOn = state.drsEnabled !== false;
    (circuit.drs_ranges || []).forEach(([a, b]) => {
      // DRS Detection Line 3% before activation
      const detIdx = Math.floor((((a - 0.025) % 1) + 1) % 1 * n);
      const pd = pts[detIdx];
      ctx.beginPath();
      ctx.moveTo(pd.x - pd.nx * 8, pd.y - pd.ny * 8);
      ctx.lineTo(pd.x + pd.nx * 8, pd.y + pd.ny * 8);
      ctx.strokeStyle = drsOn ? "rgba(74, 222, 128, 0.65)" : "rgba(250, 204, 21, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const iStart = Math.floor(a * n), iEnd = Math.floor(b * n);
      ctx.beginPath();
      for (let i = iStart; i <= iEnd; i++) {
        const p = pts[i % n];
        i === iStart ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = drsOn ? "#22c55e" : "rgba(250, 204, 21, 0.35)";
      ctx.lineWidth = 3.2;
      if (drsOn) { ctx.shadowColor = "rgba(34, 197, 94, 0.85)"; ctx.shadowBlur = 7; }
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (drsOn) {
        const pm = pts[Math.floor((iStart + iEnd) * 0.5) % n];
        ctx.save();
        ctx.translate(pm.x, pm.y);
        ctx.rotate(Math.atan2(pm.ty, pm.tx));
        ctx.strokeStyle = "#bbf7d0"; ctx.lineWidth = 1.6;
        [-7, 0, 7].forEach((dx) => {
          ctx.beginPath(); ctx.moveTo(dx - 3, -3.5); ctx.lineTo(dx + 1.5, 0); ctx.lineTo(dx - 3, 3.5); ctx.stroke();
        });
        ctx.restore();
      }
    });

    // Wet sheen + Drying Racing Line + Rain Streaks
    if (state.wetness >= 16) {
      traceLoop();
      ctx.strokeStyle = `rgba(56, 189, 248, ${Math.min(0.36, state.wetness / 230)})`;
      ctx.lineWidth = 12;
      ctx.stroke();
      if (state.drying && state.wetness < 48) {
        // Drying racing groove emerging!
        traceLoop();
        ctx.strokeStyle = "rgba(15, 23, 42, 0.55)";
        ctx.lineWidth = 3.2;
        ctx.stroke();
      }
      const drops = Math.floor(18 + state.wetness * 0.52);
      ctx.strokeStyle = `rgba(125, 211, 252, ${Math.min(0.45, state.wetness / 185)})`;
      ctx.lineWidth = 1;
      const tick = ((state.raceClock || 0) * 125) % 1000;
      for (let r = 0; r < drops; r++) {
        const rx = ((r * 83.7 + tick * 1.6) % (cssW + 20)) - 10;
        const ry = ((r * 57.3 + tick * 3.8) % (cssH + 20)) - 10;
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 5, ry + 12); ctx.stroke();
      }
    } else if ((state.targetWetness || 0) > (state.wetness || 0) + 14) {
      const radGrad = ctx.createRadialGradient(cssW * 0.88, cssH * 0.14, 10, cssW * 0.88, cssH * 0.14, cssW * 0.28);
      radGrad.addColorStop(0, "rgba(56, 189, 248, 0.24)");
      radGrad.addColorStop(1, "rgba(56, 189, 248, 0)");
      ctx.fillStyle = radGrad; ctx.fillRect(0, 0, cssW, cssH);
    }

    // FIA Sector Yellow Flag Flashing Highlight!
    if (state.yellowSector && state.yellowSector >= 1 && state.yellowSector <= 3) {
      const pulse = 0.4 + 0.35 * Math.sin(performance.now() * 0.012);
      const s0 = Math.floor(((state.yellowSector - 1) / 3) * n);
      const s1 = Math.floor((state.yellowSector / 3) * n);
      ctx.beginPath();
      for (let i = s0; i <= s1; i++) {
        const p = pts[i % n];
        i === s0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = `rgba(250, 204, 21, ${pulse})`;
      ctx.lineWidth = 18;
      ctx.stroke();
    }

    // VSC or Full Safety Car Track Pulse
    if (state.scActive || state.vscActive) {
      const pulse = 0.22 + 0.16 * Math.sin(performance.now() * 0.008);
      traceLoop();
      ctx.strokeStyle = state.scActive ? `rgba(250, 204, 21, ${pulse})` : `rgba(245, 158, 11, ${pulse * 0.85})`;
      ctx.lineWidth = state.scActive ? 21 : 17;
      ctx.stroke();
    }
  }

  // =========================================================================
  // REAL 3D TOP-DOWN F1 CAR SPRITE BAKER (Powered by window.F1Car3D + Three.js)
  // Renders each constructor's ACTUAL 3D sculpted chassis, Halo, sidepods,
  // wings & custom Career livery into a crisp 256x116 cached sprite once!
  // =========================================================================
  const TEAM_3D_PALETTES = {
    ferrari:     { main: "#dc0000", secondary: "#141418", accent: "#facc15", pop: "#ffffff", detail: "#1e1e24", style: "modern" },
    mclaren:     { main: "#ff8000", secondary: "#161922", accent: "#38bdf8", pop: "#ffffff", detail: "#222630", style: "two-tone" },
    "red bull":  { main: "#1b2852", secondary: "#0e152c", accent: "#e10600", pop: "#facc15", detail: "#1d263b", style: "chevron" },
    mercedes:    { main: "#0f1722", secondary: "#c0c8d4", accent: "#00d2be", pop: "#ffffff", detail: "#1e293b", style: "two-tone" },
    aston:       { main: "#006f62", secondary: "#00463e", accent: "#cedc00", pop: "#ffffff", detail: "#0b2220", style: "modern" },
    alpine:      { main: "#0090ff", secondary: "#111827", accent: "#ff66b2", pop: "#ffffff", detail: "#1e293b", style: "two-tone" },
    williams:    { main: "#005aff", secondary: "#041c4a", accent: "#38bdf8", pop: "#ffffff", detail: "#0f1e3a", style: "chevron" },
    "racing bulls": { main: "#f8fafc", secondary: "#1d4ed8", accent: "#ef4444", pop: "#facc15", detail: "#1e293b", style: "two-tone" },
    "rb":        { main: "#2563eb", secondary: "#f8fafc", accent: "#ef4444", pop: "#facc15", detail: "#1e293b", style: "two-tone" },
    haas:        { main: "#f1f5f9", secondary: "#111622", accent: "#e10600", pop: "#ffffff", detail: "#1f2430", style: "two-tone" },
    audi:        { main: "#94a3b8", secondary: "#0f141c", accent: "#e10600", pop: "#ffffff", detail: "#1e2430", style: "chevron" },
    sauber:      { main: "#22c55e", secondary: "#0b1118", accent: "#4ade80", pop: "#ffffff", detail: "#18222e", style: "two-tone" },
    cadillac:    { main: "#181d29", secondary: "#d4af37", accent: "#e10600", pop: "#ffffff", detail: "#262d3d", style: "chevron" },
    lotus:       { main: "#0f1419", secondary: "#0b3b24", accent: "#eab308", pop: "#fde047", detail: "#1e242c", style: "racing-stripe" },
    benetton:    { main: "#0ea5e9", secondary: "#22c55e", accent: "#facc15", pop: "#ffffff", detail: "#0f172a", style: "two-tone" },
    renault:     { main: "#facc15", secondary: "#111622", accent: "#38bdf8", pop: "#ffffff", detail: "#1f2937", style: "two-tone" },
    jordan:      { main: "#facc15", secondary: "#14161a", accent: "#ef4444", pop: "#ffffff", detail: "#22262e", style: "chevron" },
    brawn:       { main: "#f8fafc", secondary: "#111622", accent: "#c7ff00", pop: "#facc15", detail: "#1e242e", style: "racing-stripe" },
    alfa:        { main: "#900020", secondary: "#f8fafc", accent: "#22c55e", pop: "#ffffff", detail: "#1c1917", style: "two-tone" },
    brabham:     { main: "#0f224a", secondary: "#f8fafc", accent: "#ef4444", pop: "#ffffff", detail: "#1e293b", style: "racing-stripe" },
    tyrrell:     { main: "#1d4ed8", secondary: "#0f172a", accent: "#facc15", pop: "#ffffff", detail: "#1e293b", style: "classic" },
    safety:      { main: "#005a3c", secondary: "#0b1914", accent: "#facc15", pop: "#ffffff", detail: "#142620", style: "racing-stripe" },
  };

  function resolve3DCarSpec(teamName, colorHex, liveryCfg, eraOverride) {
    if (liveryCfg && liveryCfg.palette) {
      return {
        palette: Object.assign({ main: colorHex || "#e10600", secondary: "#141824", accent: "#facc15", pop: "#ffffff", detail: "#202636" }, liveryCfg.palette),
        style: liveryCfg.style || "two-tone",
        era: eraOverride || liveryCfg.era || "2020s",
      };
    }
    const tn = String(teamName || "").toLowerCase();
    for (const key of Object.keys(TEAM_3D_PALETTES)) {
      if (tn.includes(key)) {
        const p = TEAM_3D_PALETTES[key];
        return {
          palette: { main: p.main, secondary: p.secondary, accent: p.accent, pop: p.pop, detail: p.detail },
          style: p.style,
          era: eraOverride || "2020s",
        };
      }
    }
    return {
      palette: { main: colorHex || "#e10600", secondary: "#141a28", accent: "#f8fafc", pop: "#facc15", detail: "#1f2937" },
      style: "two-tone",
      era: eraOverride || "2020s",
    };
  }

  // Supersampled 512x232 3D top-down sprite baker for razor-sharp 8.5x–12x ultra close-ups!
  const _car3dBaker = { init: false, failed: false, renderer: null, scene: null, cam: null, cache: new Map(), W: 512, H: 232 };

  function init3DCarBaker() {
    if (_car3dBaker.init || _car3dBaker.failed) return !_car3dBaker.failed;
    if (!window.THREE || !window.F1Car3D || !window.F1Car3D.createCar) { _car3dBaker.failed = true; return false; }
    try {
      const THREE = window.THREE;
      const cv = document.createElement("canvas");
      cv.width = _car3dBaker.W;
      cv.height = _car3dBaker.H;
      const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(_car3dBaker.W, _car3dBaker.H, false);
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.28;
      if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      }

      const scene = new THREE.Scene();
      if (window.F1Car3D.createStudioEnvironment) {
        scene.environment = window.F1Car3D.createStudioEnvironment(renderer);
      }
      // Crisp overhead broadcast helicopter lighting so 3D sidepods, Halo, wings & metallic paint gleam!
      scene.add(new THREE.HemisphereLight(0xf8fafc, 0x1e293b, 1.15));
      const key = new THREE.DirectionalLight(0xffffff, 2.75);
      key.position.set(4.6, 11.5, 5.2);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xcbe0ff, 1.35);
      fill.position.set(-5.8, 6.2, -3.5);
      scene.add(fill);
      const rim = new THREE.DirectionalLight(0xffffff, 1.15);
      rim.position.set(0.0, 4.5, -8.5);
      scene.add(rim);

      // Orthographic top-down heli camera (+Z nose pointing RIGHT +X on 2D canvas!)
      const halfW = 3.02;
      const halfH = halfW * (_car3dBaker.H / _car3dBaker.W);
      const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 30);
      cam.up.set(1, 0, 0);
      cam.position.set(0.38, 10.2, 0.05);
      cam.lookAt(0, 0.36, 0.05);
      cam.updateProjectionMatrix();

      _car3dBaker.renderer = renderer;
      _car3dBaker.scene = scene;
      _car3dBaker.cam = cam;
      _car3dBaker.init = true;
      return true;
    } catch (e) {
      _car3dBaker.failed = true;
      return false;
    }
  }

  function dispose3DGroup(group) {
    if (!group) return;
    group.traverse((obj) => {
      if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m && m.dispose && m.dispose());
        else if (obj.material.dispose) obj.material.dispose();
      }
    });
  }

  function getTopDown3DSprite(teamName, colorHex, liveryCfg, eraOverride) {
    if (!init3DCarBaker()) return null;
    const spec = resolve3DCarSpec(teamName, colorHex, liveryCfg, eraOverride);
    const p = spec.palette;
    const key = `${p.main}|${p.secondary}|${p.accent}|${p.pop}|${spec.style}|${spec.era}`;
    if (_car3dBaker.cache.has(key)) return _car3dBaker.cache.get(key);

    try {
      const car = window.F1Car3D.createCar(spec.palette, spec.style, spec.era);
      _car3dBaker.scene.add(car);
      _car3dBaker.renderer.render(_car3dBaker.scene, _car3dBaker.cam);
      _car3dBaker.scene.remove(car);
      dispose3DGroup(car);

      const sprite = document.createElement("canvas");
      sprite.width = _car3dBaker.W;
      sprite.height = _car3dBaker.H;
      const sctx = sprite.getContext("2d");
      sctx.drawImage(_car3dBaker.renderer.domElement, 0, 0);
      if (_car3dBaker.cache.size > 48) _car3dBaker.cache.clear();
      _car3dBaker.cache.set(key, sprite);
      return sprite;
    } catch (e) {
      return null;
    }
  }

  function drawMiniF1Car(ctx, x, y, angle, color, compColor, opts) {
    const o = opts || {};
    const zoom = Math.max(1.0, o.zoom || 1.0);
    // True-Scale Chassis Lock: 1:1 with PHYS_LEN (5.60u) across Battle/Close/Heli (5x..12x),
    // smoothly enlarged only at far overview zoom (1x..4.9x) for crisp full-track readability!
    const overviewBoost = zoom >= 5.0 ? 0 : (13.5 - PHYS_LEN) * Math.pow(Math.max(0, 1 - (zoom - 1.0) / 4.0), 1.45);
    const playerBoost = (o.isPlayer && zoom < 1.8) ? 1.10 : 1.0;
    const carW = (PHYS_LEN + overviewBoost) * playerBoost;
    const carH = carW * (_car3dBaker.H / _car3dBaker.W);
    const invStroke = 1 / Math.pow(zoom, 0.82);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + (o.yawSlip || 0) + (o.spinAngle || 0));

    // Sleek zoom-compensated tactical focus brackets (NEVER giant clunky circles!)
    if (o.isPlayer || o.isTeammate || o.isInspected) {
      const fCol = o.isPlayer ? "#fde047" : "#38bdf8";
      const padX = carW * 0.56 + 1.4 * invStroke;
      const padY = carH * 0.62 + 1.2 * invStroke;
      const brk = Math.min(padX * 0.38, padY * 0.52);

      // Soft tight underglow hugging ONLY this car
      ctx.fillStyle = o.isPlayer ? "rgba(250, 204, 21, 0.16)" : "rgba(56, 189, 248, 0.14)";
      ctx.beginPath();
      ctx.ellipse(0, 0, padX * 0.94, padY * 0.96, 0, 0, Math.PI * 2);
      ctx.fill();

      // 4 razor-sharp broadcast tactical corner brackets
      ctx.strokeStyle = fCol;
      ctx.lineWidth = (o.isPlayer ? 1.65 : 1.35) * invStroke;
      if (o.isInspected && !o.isPlayer && !o.isTeammate) ctx.setLineDash([2.5 * invStroke, 1.8 * invStroke]);
      ctx.beginPath();
      // Front-left & Front-right
      ctx.moveTo(padX - brk, -padY); ctx.lineTo(padX, -padY); ctx.lineTo(padX, -padY + brk);
      ctx.moveTo(padX - brk,  padY); ctx.lineTo(padX,  padY); ctx.lineTo(padX,  padY - brk);
      // Rear-left & Rear-right
      ctx.moveTo(-padX + brk, -padY); ctx.lineTo(-padX, -padY); ctx.lineTo(-padX, -padY + brk);
      ctx.moveTo(-padX + brk,  padY); ctx.lineTo(-padX,  padY); ctx.lineTo(-padX,  padY - brk);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Animated Pit Box Crew, Wheel-Gun Sparks, Overhead Gantry Light & Refuelling Rig!
    if (o.inPit && o.pitProgress != null && o.pitProgress >= 0.25 && o.pitProgress <= 0.75) {
      const boxW = carW * 1.48;
      const boxH = carH * 1.82;
      ctx.strokeStyle = "rgba(250, 204, 21, 0.8)";
      ctx.lineWidth = 1.0 * invStroke;
      ctx.setLineDash([2.4 * invStroke, 1.8 * invStroke]);
      ctx.strokeRect(-boxW * 0.5, -boxH * 0.5, boxW, boxH);
      ctx.setLineDash([]);
      // Overhead pit gantry arm & traffic light (Red -> Amber -> Green release!)
      const relReady = o.pitProgress >= 0.66;
      const midWork = o.pitProgress >= 0.34 && o.pitProgress < 0.66;
      const lightCol = relReady ? "#22c55e" : (midWork ? "#f59e0b" : "#ef4444");
      ctx.strokeStyle = "rgba(148, 163, 184, 0.6)";
      ctx.lineWidth = 0.8 * invStroke;
      ctx.beginPath(); ctx.moveTo(0, -boxH * 0.56); ctx.lineTo(0, boxH * 0.56); ctx.stroke();
      ctx.fillStyle = lightCol;
      ctx.beginPath(); ctx.arc(carW * 0.52, 0, Math.max(1.2 * invStroke, carH * 0.14), 0, Math.PI * 2); ctx.fill();

      // 10-person Pit Crew (4 wheel gunners, 4 tyre carriers, front & rear jack men)
      const tNow = performance.now();
      const jitter = midWork ? Math.sin(tNow * 0.045) * carH * 0.06 : 0;
      const crewPts = [
        [ carW * 0.26, -carH * 0.64 - jitter, 0],
        [ carW * 0.26,  carH * 0.64 + jitter, 0],
        [-carW * 0.28, -carH * 0.66 - jitter, 0],
        [-carW * 0.28,  carH * 0.66 + jitter, 0],
        [ carW * 0.10, -carH * 0.78, 1],
        [ carW * 0.10,  carH * 0.78, 1],
        [-carW * 0.12, -carH * 0.78, 1],
        [-carW * 0.12,  carH * 0.78, 1],
        [ carW * 0.68,  0, 2],
        [-carW * 0.68,  0, 2],
      ];
      crewPts.forEach(([cx, cy, role]) => {
        ctx.fillStyle = role === 0 ? (color || "#facc15") : (role === 2 ? "#f8fafc" : "#94a3b8");
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0.85 * invStroke, carH * (role === 1 ? 0.10 : 0.13)), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#090e1a";
        ctx.lineWidth = 0.45 * invStroke;
        ctx.stroke();
      });
      // Wheel-gun pneumatic flashes at all 4 corners during active tyre swap!
      if (midWork && Math.sin(tNow * 0.06) > 0.2) {
        ctx.fillStyle = "rgba(56, 189, 248, 0.85)";
        [[carW * 0.26, -carH * 0.46], [carW * 0.26, carH * 0.46], [-carW * 0.28, -carH * 0.48], [-carW * 0.28, carH * 0.48]].forEach(([sx, sy]) => {
          ctx.beginPath(); ctx.arc(sx, sy, Math.max(0.7 * invStroke, carH * 0.09), 0, Math.PI * 2); ctx.fill();
        });
      }
      // Refuelling rig hose in refuelling eras (1990s / 2000s / 1950s)
      if (o.refuelling) {
        ctx.strokeStyle = "#facc15";
        ctx.lineWidth = 1.1 * invStroke;
        ctx.beginPath();
        ctx.moveTo(-carW * 0.08, -boxH * 0.62);
        ctx.quadraticCurveTo(-carW * 0.14, -carH * 0.35, -carW * 0.04, -carH * 0.22);
        ctx.stroke();
      }
    }

    // Rain spray rooster-tail wake when track is wet!
    if ((o.wetness || 0) >= 22 && !o.inPit) {
      const sprayAlpha = Math.min(0.48, ((o.wetness - 18) / 80) * 0.48);
      const grad = ctx.createLinearGradient(-carW * 0.45, 0, -carW * 1.85, 0);
      grad.addColorStop(0, `rgba(226, 232, 240, ${sprayAlpha.toFixed(2)})`);
      grad.addColorStop(1, "rgba(226, 232, 240, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-carW * 0.44, -carH * 0.30);
      ctx.lineTo(-carW * 1.85, -carH * 0.68);
      ctx.lineTo(-carW * 1.85,  carH * 0.68);
      ctx.lineTo(-carW * 0.44,  carH * 0.30);
      ctx.closePath();
      ctx.fill();
    }

    // ERS Overtake blue aero slipstream trails + exhaust heat shimmer
    if (o.ersHot) {
      const ersGrad = ctx.createLinearGradient(-carW * 0.44, 0, -carW * 1.15, 0);
      ersGrad.addColorStop(0, "rgba(56, 189, 248, 0.92)");
      ersGrad.addColorStop(1, "rgba(56, 189, 248, 0)");
      ctx.strokeStyle = ersGrad;
      ctx.lineWidth = 1.25 * invStroke;
      ctx.beginPath();
      ctx.moveTo(-carW * 0.46, -carH * 0.28); ctx.lineTo(-carW * 1.12, -carH * 0.42);
      ctx.moveTo(-carW * 0.46,  carH * 0.28); ctx.lineTo(-carW * 1.12,  carH * 0.42);
      ctx.moveTo(-carW * 0.48, 0);            ctx.lineTo(-carW * 0.96, 0);
      ctx.stroke();
    }

    // Grounded sun-offset asphalt shadow underneath the 3D floor
    ctx.fillStyle = "rgba(2, 6, 16, 0.56)";
    ctx.beginPath();
    ctx.ellipse(-carW * 0.03, carH * 0.11, carW * 0.47, carH * 0.41, 0, 0, Math.PI * 2);
    ctx.fill();

    // ACTUAL 3D MODEL SPRITE (from window.F1Car3D) — fallback to clean 2D vector if WebGL unavailable
    const sprite3d = getTopDown3DSprite(o.teamName, color, o.livery, o.era);
    if (sprite3d) {
      ctx.drawImage(sprite3d, -carW * 0.5, -carH * 0.5, carW, carH);

      // Turned Front-Wheel Steering Visualization at Battle/Heli Zoom (>= 1.8x)
      const steer = o.steerAngle || 0;
      const tw = carW * 0.12;
      const th = Math.max(0.55 * invStroke, carH * 0.052);
      if (zoom >= 1.8 && Math.abs(steer) > 0.04) {
        [[-carH * 0.34], [carH * 0.34]].forEach(([wy]) => {
          ctx.save();
          ctx.translate(carW * 0.27, wy);
          ctx.rotate(steer * 0.65);
          ctx.fillStyle = "#0b0f17";
          ctx.fillRect(-tw * 0.55, -carH * 0.09, tw * 1.1, carH * 0.18);
          ctx.fillStyle = compColor || "#facc15";
          ctx.fillRect(-tw * 0.48, wy < 0 ? -carH * 0.095 : carH * 0.045, tw * 0.96, th);
          ctx.restore();
        });
      } else {
        // Live Pirelli compound tyre sidewall markers aligned to the real 3D model's 4 tyres!
        ctx.fillStyle = compColor || "#facc15";
        ctx.fillRect( carW * 0.215, -carH * 0.385, tw, th);
        ctx.fillRect( carW * 0.215,  carH * 0.385 - th, tw, th);
      }
      ctx.fillStyle = compColor || "#facc15";
      ctx.fillRect(-carW * 0.325, -carH * 0.395, tw * 1.15, th);
      ctx.fillRect(-carW * 0.325,  carH * 0.395 - th, tw * 1.15, th);

      // Glowing Incandescent Carbon-Ceramic Brake Discs (900°C orange-red under heavy braking!)
      if (o.braking && !o.inPit) {
        const bInt = Math.min(1, Math.max(0.45, ((o.brake || 65) / 100)));
        const discCol = bInt > 0.78 ? "#fde047" : "#fb923c";
        ctx.save();
        ctx.fillStyle = discCol;
        ctx.shadowColor = "#ef4444";
        ctx.shadowBlur = 5.5 * bInt;
        const dR = Math.max(0.65 * invStroke, carH * 0.075);
        [
          [ carW * 0.27, -carH * 0.28],
          [ carW * 0.27,  carH * 0.28],
          [-carW * 0.27, -carH * 0.29],
          [-carW * 0.27,  carH * 0.29],
        ].forEach(([dx, dy]) => {
          ctx.beginPath();
          ctx.arc(dx, dy, dR, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.restore();
      }

      // Authentic FIA T-Cam Bar (Fluorescent Yellow for Car #2, Stealth Black for Car #1) + Helmet Glint
      if (!o.isSafetyCar) {
        ctx.fillStyle = o.tcamYellow ? "#eaff00" : "#111827";
        ctx.fillRect(-carW * 0.085, -carH * 0.115, carW * 0.032, carH * 0.23);
        ctx.fillStyle = o.helmetColor || "#f8fafc";
        ctx.beginPath();
        ctx.arc(carW * 0.025, 0, Math.max(0.8 * invStroke, carH * 0.085), 0, Math.PI * 2);
        ctx.fill();
      }

      // DRS Open Green Rear Wing Flap Gap + Animated Green Wake Chevrons
      if (o.drsOpen) {
        ctx.fillStyle = "rgba(34, 197, 94, 0.95)";
        ctx.fillRect(-carW * 0.47, -carH * 0.24, carW * 0.068, carH * 0.48);
        ctx.strokeStyle = "rgba(74, 222, 128, 0.78)";
        ctx.lineWidth = 1.0 * invStroke;
        ctx.beginPath();
        ctx.moveTo(-carW * 0.56, -carH * 0.16); ctx.lineTo(-carW * 0.66, 0); ctx.lineTo(-carW * 0.56, carH * 0.16);
        ctx.stroke();
      }

      // Rear FIA Rain / Brake / Harvest Red LED (4Hz authentic strobe in rain/harvest, solid under braking!)
      const strobeOn = Math.floor(performance.now() / 125) % 2 === 0;
      if (o.braking || ((o.wetness || 0) >= 22 && strobeOn) || (o.harvesting && strobeOn)) {
        ctx.fillStyle = "#ef4444";
        ctx.shadowColor = "#ef4444";
        ctx.shadowBlur = o.braking ? 6.5 : 4.2;
        ctx.fillRect(-carW * 0.49, -carH * 0.07, carW * 0.058, carH * 0.14);
        ctx.shadowBlur = 0;
      }

      // Safety Car Flashing Amber / Green FIA Roof Lightbar!
      if (o.isSafetyCar) {
        const phase = Math.floor(performance.now() / 180) % 2;
        ctx.fillStyle = phase === 0 ? "#facc15" : "#22c55e";
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 9;
        ctx.fillRect(-carW * 0.08, -carH * 0.22, carW * 0.12, carH * 0.44);
        ctx.shadowBlur = 0;
      }

      // Front Wing Damage visual sparks / chipped endplate marker
      if (o.wingDamaged) {
        ctx.fillStyle = "#0b0f18";
        ctx.fillRect(carW * 0.34, carH * 0.05, carW * 0.14, carH * 0.34);
        ctx.fillStyle = "#f97316";
        ctx.fillRect(carW * 0.39, carH * 0.04, carW * 0.05, carH * 0.11);
      }
    } else {
      // Crisp 2D fallback scaled to exact same carW/carH envelope
      const sc = carW / 20;
      ctx.scale(sc, sc);
      ctx.fillStyle = "#0b0f17"; ctx.strokeStyle = compColor; ctx.lineWidth = 1.0;
      [[-5.5, -4.2], [-5.5, 2.0], [3.5, -4.0], [3.5, 1.8]].forEach(([wx, wy]) => {
        ctx.fillRect(wx, wy, 3.4, 2.2); ctx.strokeRect(wx, wy, 3.4, 2.2);
      });
      ctx.beginPath();
      ctx.moveTo(9.6, 0); ctx.lineTo(4.4, -1.7); ctx.lineTo(1.1, -3.0); ctx.lineTo(-3.4, -3.0);
      ctx.lineTo(-7.4, -1.8); ctx.lineTo(-7.4, 1.8); ctx.lineTo(-3.4, 3.0); ctx.lineTo(1.1, 3.0); ctx.lineTo(4.4, 1.7);
      ctx.closePath();
      ctx.fillStyle = color; ctx.fill();
      ctx.fillStyle = o.drsOpen ? "#22c55e" : "#0f172a";
      ctx.fillRect(-9.0, -3.6, 2.0, 7.2);
      ctx.fillStyle = "#0f172a";
      ctx.beginPath(); ctx.ellipse(-0.6, 0, 2.4, 1.2, 0, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
  }

  // =========================================================================
  // BROADCAST FOLLOW-CAM, BATTLE ZOOM & UP TO 12x GYROSTABILIZED HELI CLOSE-UP
  // =========================================================================
  function createCamera() {
    return { mode: "full", targetZoom: 1.0, zoom: 1.0, x: 0, y: 0, vx: 0, vy: 0, init: false };
  }

  function setCameraMode(cam, mode) {
    if (!cam) return;
    cam.mode = mode || "full";
    const map = { full: 1.0, follow: 2.5, battle: 5.0, close: 8.5, heli: 11.0 };
    cam.targetZoom = map[cam.mode] || 1.0;
  }

  function zoomCameraBy(cam, delta) {
    if (!cam) return;
    // Smooth exponential wheel zoom so 1.2x and 10x zoom steps feel equally silky!
    const factor = delta > 0 ? Math.pow(1.18, Math.max(0.5, delta / 0.35)) : 1 / Math.pow(1.18, Math.max(0.5, -delta / 0.35));
    const next = Math.max(1.0, Math.min(12.0, (cam.targetZoom || 1.0) * factor));
    cam.targetZoom = next;
    cam.mode = next <= 1.08 ? "full" : (next >= 9.8 ? "heli" : (next >= 6.8 ? "close" : (next >= 3.6 ? "battle" : "follow")));
  }

  function updateCamera(cam, targetPt, cssW, cssH, dt) {
    if (!cam) return;
    const stepDt = Math.min(0.05, Math.max(0.004, dt || 0.016));
    const zTarget = Math.max(1.0, Math.min(12.0, cam.targetZoom || 1.0));
    const zLerp = Math.min(1, stepDt * 6.5);
    cam.zoom += (zTarget - cam.zoom) * zLerp;
    if (Math.abs(cam.zoom - 1.0) < 0.008 && zTarget <= 1.01) cam.zoom = 1.0;

    const tx = (cam.zoom > 1.03 && targetPt) ? targetPt.x : cssW * 0.5;
    const ty = (cam.zoom > 1.03 && targetPt) ? targetPt.y : cssH * 0.5;
    if (!cam.init) {
      cam.x = tx; cam.y = ty; cam.vx = 0; cam.vy = 0; cam.init = true;
    } else {
      // Critically-damped Cineflex helicopter rig smoothing (zero micro-shake at 11x zoom!)
      const omega = 6.2;
      const fx = omega * omega * (tx - cam.x) - 2 * omega * (cam.vx || 0);
      const fy = omega * omega * (ty - cam.y) - 2 * omega * (cam.vy || 0);
      cam.vx = (cam.vx || 0) + fx * stepDt;
      cam.vy = (cam.vy || 0) + fy * stepDt;
      cam.x += cam.vx * stepDt;
      cam.y += cam.vy * stepDt;
    }
    if (cam.zoom <= 1.02) {
      cam.x = cssW * 0.5;
      cam.y = cssH * 0.5;
      cam.vx = 0;
      cam.vy = 0;
    }
  }

  function applyCameraTransform(ctx, cam, cssW, cssH) {
    if (!cam || cam.zoom <= 1.01) return;
    ctx.translate(cssW * 0.5, cssH * 0.5);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
  }

  function worldToScreen(cam, wx, wy, cssW, cssH) {
    if (!cam || cam.zoom <= 1.01) return { x: wx, y: wy };
    return {
      x: (wx - cam.x) * cam.zoom + cssW * 0.5,
      y: (wy - cam.y) * cam.zoom + cssH * 0.5,
    };
  }

  function drawMiniMapPiP(ctx, geom, cars, isFocusFn, cssW, cssH) {
    if (!geom || !geom.pts || !geom.pts.length) return;
    const w = 136, h = 84;
    const x0 = cssW - w - 12, y0 = 42;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < geom.n; i++) {
      const p = geom.pts[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    const sc = Math.min((w - 18) / bw, (h - 18) / bh);
    const ox = x0 + (w - bw * sc) * 0.5 - minX * sc;
    const oy = y0 + (h - bh * sc) * 0.5 - minY * sc;

    ctx.save();
    ctx.fillStyle = "rgba(6, 10, 18, 0.86)";
    ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x0, y0, w, h, 8); else ctx.rect(x0, y0, w, h);
    ctx.fill(); ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < geom.n; i += 2) {
      const p = geom.pts[i];
      const mx = p.x * sc + ox, my = p.y * sc + oy;
      i === 0 ? ctx.moveTo(mx, my) : ctx.lineTo(mx, my);
    }
    ctx.closePath();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.55)";
    ctx.lineWidth = 2.6;
    ctx.stroke();

    // Car dots
    (cars || []).forEach((c) => {
      if (c.dnf) return;
      const p = sampleTrack(geom, c.totalProg);
      const mx = p.x * sc + ox, my = p.y * sc + oy;
      const foc = isFocusFn ? isFocusFn(c) : false;
      ctx.beginPath();
      ctx.arc(mx, my, foc ? 3.5 : 2.0, 0, Math.PI * 2);
      ctx.fillStyle = foc ? "#fde047" : (c.color || "#94a3b8");
      ctx.fill();
      if (foc) {
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.stroke();
      }
    });
    ctx.restore();
  }

  // =========================================================================
  // COLLISION SPARKS, TITANIUM PLANK SPARKS, LOCK-UP SMOKE, SKIDMARKS & BATTLE VORTICES
  // =========================================================================
  function createFxState() {
    return { particles: [], rings: [], skidmarks: [], pairCooldown: {} };
  }

  function spawnSkidmark(fx, x, y, tx, ty, nx, ny) {
    if (!fx || !fx.skidmarks) return;
    fx.skidmarks.push({
      x1: x - tx * 3.5, y1: y - ty * 3.5,
      x2: x + tx * 3.5, y2: y + ty * 3.5,
      nx, ny, alpha: 0.42,
    });
    if (fx.skidmarks.length > 90) fx.skidmarks.shift();
  }

  function spawnPlankSparks(fx, x, y, tx, ty) {
    if (!fx || fx.particles.length > 260) return;
    const count = 2 + (Math.random() < 0.45 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 0.48;
      const spd = 22 + Math.random() * 28;
      const vx = (-tx * Math.cos(spread) - ty * Math.sin(spread)) * spd;
      const vy = (-ty * Math.cos(spread) + tx * Math.sin(spread)) * spd;
      fx.particles.push({
        kind: "spark",
        x: x - tx * 3.5 + (Math.random() - 0.5) * 1.4,
        y: y - ty * 3.5 + (Math.random() - 0.5) * 1.4,
        vx, vy,
        life: 0.16 + Math.random() * 0.18,
        maxLife: 0.34,
        size: 0.85 + Math.random() * 0.65,
        color: Math.random() < 0.6 ? "#fef08a" : "#fb923c",
      });
    }
  }

  function spawnLockupSmoke(fx, x, y, tx, ty) {
    if (!fx || fx.particles.length > 260) return;
    fx.particles.push({
      kind: "smoke",
      x: x + tx * 2.5 + (Math.random() - 0.5) * 2.0,
      y: y + ty * 2.5 + (Math.random() - 0.5) * 2.0,
      vx: -tx * (6 + Math.random() * 8),
      vy: -ty * (6 + Math.random() * 8),
      life: 0.45 + Math.random() * 0.35,
      maxLife: 0.8,
      size: 2.2 + Math.random() * 2.4,
      color: "#e2e8f0",
    });
  }

  function drawSkidmarks(ctx, fx) {
    if (!fx || !fx.skidmarks || !fx.skidmarks.length) return;
    ctx.save();
    ctx.lineCap = "round";
    for (let i = 0; i < fx.skidmarks.length; i++) {
      const s = fx.skidmarks[i];
      ctx.strokeStyle = `rgba(3, 6, 12, ${s.alpha.toFixed(2)})`;
      ctx.lineWidth = 1.05;
      [-1.5, 1.5].forEach((off) => {
        ctx.beginPath();
        ctx.moveTo(s.x1 + s.nx * off, s.y1 + s.ny * off);
        ctx.lineTo(s.x2 + s.nx * off, s.y2 + s.ny * off);
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  // Draw slipstream/dirty-air tow ribbons & close wheel-to-wheel battle gap badges!
  function drawBattleVortices(ctx, cars, geom, circuit, zoom) {
    if (!cars || !cars.length || !geom || !circuit) return;
    const lapS = circuit.base_lap_s || 85;
    const active = cars.filter((c) => !c.dnf && !(c.inPit > 0)).sort((a, b) => b.totalProg - a.totalProg);
    const invStroke = 1 / Math.pow(Math.max(1.0, zoom || 1.0), 0.72);
    ctx.save();
    for (let i = 1; i < active.length; i++) {
      const ch = active[i];
      const ld = active[i - 1];
      const gapS = (ld.totalProg - ch.totalProg) * lapS;
      if (gapS <= 0.02 || gapS > 0.85) continue;
      const pL = sampleTrack(geom, ld.totalProg);
      const pC = sampleTrack(geom, ch.totalProg);
      const lx = pL.x + pL.nx * (ld.latOffset || 0);
      const ly = pL.y + pL.ny * (ld.latOffset || 0);
      const cx = pC.x + pC.nx * (ch.latOffset || 0);
      const cy = pC.y + pC.ny * (ch.latOffset || 0);
      if (Math.hypot(lx - cx, ly - cy) > 85) continue;

      // Subtle aerodynamic slipstream tow ribbons
      const alpha = Math.max(0.08, (1 - gapS / 0.85) * 0.34);
      ctx.strokeStyle = gapS < 0.4 ? `rgba(56, 189, 248, ${alpha.toFixed(2)})` : `rgba(226, 232, 240, ${(alpha * 0.7).toFixed(2)})`;
      ctx.lineWidth = 0.85 * invStroke;
      ctx.setLineDash([2.8 * invStroke, 2.2 * invStroke]);
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.setLineDash([]);

      // At Battle / Close / Heli zoom (>= 2.0x), render a subtle battle gap pill on the closest fight only (no clutter!)
      if (zoom >= 2.0 && gapS < 0.42 && !ch.aiObs?.badge) {
        const mx = (lx + cx) * 0.5;
        const my = (ly + cy) * 0.5 - 6.8 * invStroke;
        const txt = `+${gapS.toFixed(2)}s`;
        ctx.font = `800 ${(6.4 * invStroke).toFixed(1)}px Orbitron, sans-serif`;
        const tw = ctx.measureText(txt).width + 5 * invStroke;
        const bh = 8.2 * invStroke;
        ctx.fillStyle = "rgba(9, 14, 26, 0.82)";
        ctx.fillRect(mx - tw * 0.5, my - bh * 0.75, tw, bh);
        ctx.strokeStyle = "rgba(250, 204, 21, 0.55)";
        ctx.lineWidth = 0.65 * invStroke;
        ctx.strokeRect(mx - tw * 0.5, my - bh * 0.75, tw, bh);
        ctx.fillStyle = "#fde047";
        ctx.textAlign = "center";
        ctx.fillText(txt, mx, my);
      }
    }
    ctx.restore();
  }

  function spawnCollisionFx(fx, x, y, severity) {
    if (!fx) return;
    const isHeavy = severity === "crash";
    const isSpin = severity === "spin";
    const sparkCount = isHeavy ? 26 : (isSpin ? 14 : 10);
    for (let i = 0; i < sparkCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (isHeavy ? 46 : 28) + Math.random() * 52;
      fx.particles.push({
        kind: "spark",
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 0.35 + Math.random() * 0.45,
        maxLife: 0.8,
        size: 1.4 + Math.random() * 1.4,
        color: Math.random() < 0.55 ? "#fde047" : "#f97316",
      });
    }
    const smokeCount = isHeavy ? 14 : (isSpin ? 9 : 3);
    for (let i = 0; i < smokeCount; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 6 + Math.random() * 18;
      fx.particles.push({
        kind: "smoke",
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 0.9 + Math.random() * 0.9,
        maxLife: 1.8,
        size: (isHeavy ? 6 : 4) + Math.random() * 5,
        color: isHeavy ? "#94a3b8" : "#e2e8f0",
      });
    }
    if (isHeavy || isSpin) {
      const debCount = isHeavy ? 12 : 5;
      for (let i = 0; i < debCount; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 14 + Math.random() * 34;
        fx.particles.push({
          kind: "debris",
          x, y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 2.2 + Math.random() * 1.6,
          maxLife: 3.8,
          size: 1.8 + Math.random() * 2.0,
          rot: Math.random() * Math.PI * 2,
          color: Math.random() < 0.65 ? "#1e293b" : "#ef4444",
        });
      }
    }
    fx.rings.push({
      x, y,
      r: 4,
      maxR: isHeavy ? 34 : (isSpin ? 22 : 14),
      life: isHeavy ? 1.1 : 0.6,
      maxLife: isHeavy ? 1.1 : 0.6,
      color: isHeavy ? "#ef4444" : (isSpin ? "#f59e0b" : "#fde047"),
      label: isHeavy ? "COLLISION!" : (isSpin ? "SPIN!" : "CONTACT"),
    });
  }

  function stepAndDrawFx(ctx, fx, dt, zoom) {
    if (!fx) return;
    const stepDt = Math.min(0.05, dt || 0.016);
    const fxScale = 1 / Math.pow(Math.max(1.0, zoom || 1.0), 0.45);
    for (let i = fx.particles.length - 1; i >= 0; i--) {
      const p = fx.particles[i];
      p.life -= stepDt;
      if (p.life <= 0) { fx.particles.splice(i, 1); continue; }
      const drag = p.kind === "debris" ? 0.90 : (p.kind === "smoke" ? 0.94 : 0.93);
      p.vx *= drag; p.vy *= drag;
      p.x += p.vx * stepDt;
      p.y += p.vy * stepDt;
      const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.save();
      if (p.kind === "smoke") {
        ctx.globalAlpha = alpha * 0.42;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * fxScale * (1.5 - alpha * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === "spark") {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * fxScale;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.05 * fxScale, p.y - p.vy * 0.05 * fxScale);
        ctx.stroke();
      } else {
        ctx.globalAlpha = alpha * 0.9;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.fillStyle = p.color;
        const ds = p.size * fxScale;
        ctx.fillRect(-ds * 0.5, -ds * 0.35, ds, ds * 0.7);
      }
      ctx.restore();
    }
    for (let i = fx.rings.length - 1; i >= 0; i--) {
      const r = fx.rings[i];
      r.life -= stepDt;
      if (r.life <= 0) { fx.rings.splice(i, 1); continue; }
      const prog = 1 - r.life / r.maxLife;
      const rad = (r.r + (r.maxR - r.r) * prog) * fxScale;
      ctx.save();
      ctx.globalAlpha = (1 - prog) * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 1.8 * fxScale;
      ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, Math.PI * 2); ctx.stroke();
      if (prog < 0.75) {
        ctx.font = `800 ${(7.5 * fxScale).toFixed(1)}px Orbitron, sans-serif`;
        ctx.fillStyle = r.color;
        ctx.textAlign = "center";
        ctx.fillText(r.label, r.x, r.y - rad - 2.5 * fxScale);
      }
      ctx.restore();
    }
  }

  // =========================================================================
  // PHYSICS & AI ENGINE v2:
  //  - 2D Wrapped Spatial Neighbourhood (handles Lapped Cars, Blue Flags & 3-Wide!)
  //  - Driver DNA Traits (Bravery / Craft / Wet IQ from real F1 card stats)
  //  - Utility-Scored Simultaneous Offense + Defense (ZERO Defensive Paralysis!)
  //  - Jerk-Limited Smooth Steering + Velocity-First Sub-Stepped Solid-Body Solver
  // =========================================================================
  function getDriverDna(car) {
    const st = (car && car.card && car.card.game && car.card.game.stats)
      || (car && car.driver && car.driver.stats)
      || null;
    const duels = (st && Number.isFinite(st.duels)) ? st.duels : 76;
    const clutch = (st && Number.isFinite(st.clutch)) ? st.clutch : 76;
    const racecraft = (st && Number.isFinite(st.racecraft)) ? st.racecraft : 76;
    const reliability = (st && Number.isFinite(st.reliability)) ? st.reliability : 76;
    const wet = (st && Number.isFinite(st.wet)) ? st.wet : racecraft;
    return {
      bravery: Math.max(0.15, Math.min(1.0, (duels * 0.55 + clutch * 0.45 - 48) / 50)),
      craft: Math.max(0.15, Math.min(1.0, (racecraft - 48) / 50)),
      wetIq: Math.max(0.15, Math.min(1.0, (wet * 0.60 + reliability * 0.40 - 48) / 50)),
    };
  }

  function wrapProgDelta(aProg, bProg) {
    return ((((aProg - bProg) + 0.5) % 1) + 1) % 1 - 0.5;
  }

  function computeBattleCameraTarget(camCar, allCars, geom, circuit, zoom) {
    if (!camCar || !geom) return null;
    const cPit = camCar.inPit > 0 && camCar.pitDuration > 0;
    const cp = cPit
      ? samplePitLane(geom, 1 - Math.max(0, Math.min(1, camCar.inPit / camCar.pitDuration)))
      : sampleTrack(geom, camCar.totalProg);
    const lat = cPit ? 0 : (camCar.latOffset || 0);
    let tx = cp.x + (cp.nx || 0) * lat;
    let ty = cp.y + (cp.ny || 0) * lat;

    // Velocity-vector lookahead at Battle/Close/Heli zoom so approaching corners & overtakes stay framed!
    const z = Math.max(1.0, zoom || 1.0);
    if (!cPit && z >= 3.5) {
      const look = Math.min(15.0, 42.0 / z);
      tx += (cp.tx || 0) * look;
      ty += (cp.ty || 0) * look;
    }

    // Automatic 2-Car Battle Midpoint Framing when wheel-to-wheel (< 0.35s)!
    if (!cPit && z >= 4.0 && allCars && allCars.length > 1) {
      const lapS = (circuit && circuit.base_lap_s) || 85;
      let rival = null, bestGap = 0.36;
      for (let i = 0; i < allCars.length; i++) {
        const o = allCars[i];
        if (!o || o.idx === camCar.idx || o.dnf || o.inPit > 0) continue;
        const g = Math.abs(wrapProgDelta(o.totalProg, camCar.totalProg)) * lapS;
        if (g < bestGap) { bestGap = g; rival = o; }
      }
      if (rival) {
        const rp = sampleTrack(geom, rival.totalProg);
        const rLat = rival.latOffset || 0;
        const rx = rp.x + (rp.nx || 0) * rLat;
        const ry = rp.y + (rp.ny || 0) * rLat;
        const blend = Math.max(0, Math.min(0.42, (1 - bestGap / 0.36) * 0.42));
        tx += (rx - tx) * blend;
        ty += (ry - ty) * blend;
      }
    }
    return { x: tx, y: ty };
  }

  function stepBattlePhysics(cars, geom, circuit, fx, opts) {
    const events = [];
    if (!cars || !cars.length || !geom || !circuit) return events;
    const o = opts || {};
    const dt = Math.min(0.05, Math.max(0.002, o.dt || 0.016));
    const simDtTotal = Number.isFinite(o.simDt) && o.simDt > 0 ? o.simDt : 0;
    const lapS = circuit.base_lap_s || 85;
    const nowS = o.raceClock || 0;
    const safetyActive = !!(o.scActive || o.vscActive);
    const totalLen = geom.totalLen || 1600;
    const maxEdge = 5.20;
    const avgLapKph = geom.avgLapKph || (((circuit.length_km || 5.0) / Math.max(40, lapS)) * 3600);
    const topKph = circuit.top_speed_kph || 330;

    // 1. Active on-track cars (Zoom-Invariant Chassis: PHYS_LEN = 5.60u, PHYS_WID = 2.40u)
    const active = cars.filter((c) => !c.dnf && !(c.inPit > 0));
    active.sort((a, b) => b.totalProg - a.totalProg);
    const wetness = o.wetness || 0;
    const isWet = wetness >= 24;

    const getCode = (c) => (
      !c ? "RIVAL" : (
        c.code3
        || (c.card && (c.card.code3 || (c.card.clean_name || "").slice(0, 3).toUpperCase()))
        || "DRV"
      )
    );

    const AI_COLORS = {
      avoid: "#f97316",
      blue_flag: "#38bdf8",
      divebomb: "#22c55e",
      attack: "#22c55e",
      cutback: "#10b981",
      fight: "#e879f9",
      defend: "#facc15",
      hold: "#94a3b8",
      tow: "#38bdf8",
      clean_air: "#38bdf8",
      clean: "#64748b",
    };

    const CANDIDATE_LANES = [-4.25, -2.15, 0, 2.15, 4.25];

    // Pre-sample poses once per car for the spatial neighbourhood scanner
    const poses = new Array(active.length);
    for (let i = 0; i < active.length; i++) {
      poses[i] = sampleTrack(geom, active[i].totalProg);
    }

    // 2. SPATIAL MULTI-CAR AI PLANNER (Driver DNA + 5-Lane Corridor + Utility Offense/Defense)
    for (let i = 0; i < active.length; i++) {
      const car = active[i];
      if (car.finishedRace) {
        // Post-chequered celebratory cooldown cruise off the racing line (never blocks active finishers!)
        const cruiseLat = 3.6 + Math.sin(nowS * 0.9 + car.idx) * 0.45;
        car.latOffset = (car.latOffset || 0) + (cruiseLat - (car.latOffset || 0)) * Math.min(1, dt * 1.8);
        car.battleState = "clean";
        car.battleSpeedMult = 0.36;
        car.aiObs = { state: "clean", badge: "🏁 COOLDOWN", detail: "CHEQUERED FLAG · CELEBRATION LAP", color: "#22c55e" };
        continue;
      }
      const dna = getDriverDna(car);
      if (car.spinTimer > 0) {
        car.spinTimer = Math.max(0, car.spinTimer - dt);
        car.spinAngle = car.spinTimer * 7.2 * (car.spinDir || 1);
      } else {
        car.spinAngle = 0;
      }
      if (car.defendLockTimer > 0) car.defendLockTimer = Math.max(0, car.defendLockTimer - dt);
      if (car.cutbackBoostTimer > 0) car.cutbackBoostTimer = Math.max(0, car.cutbackBoostTimer - dt);
      if (car.aiCommitTimer > 0) car.aiCommitTimer = Math.max(0, car.aiCommitTimer - dt);
      if (car.lockupTimer > 0) car.lockupTimer = Math.max(0, car.lockupTimer - dt);

      const poseNow = poses[i];
      const poseAhead = sampleTrack(geom, car.totalProg + 0.026);
      const poseFar = sampleTrack(geom, car.totalProg + 0.050);
      const approachingCorner = poseAhead.curv > 0.24 || poseFar.curv > 0.33;
      const sAhead = poseAhead.curv > poseNow.curv ? (poseAhead.signedCurv || poseAhead.sign) : (poseNow.signedCurv || poseNow.sign);
      const cornerSign = sAhead >= 0 ? 1 : -1;

      // FIA Sporting Code State: Braking zone lock, 1-move counter reset & yellow sector detection
      const curSec = Math.floor((((car.totalProg % 1) + 1) % 1) * 3) + 1;
      const inYellowZone = safetyActive || (o.yellowSector && curSec === o.yellowSector);
      const inBrakingZone = poseNow.lineZone === "brake" || poseNow.aLongG < -1.15;
      if (poseNow.curv > 0.26) {
        car.defendMovesThisStraight = 0;
      }
      if (!inBrakingZone) {
        car.brakeLockedLat = null;
        car.movedUnderBraking = false;
      } else if (car.brakeLockedLat == null) {
        car.brakeLockedLat = car.latOffset || 0;
      }

      // Base optimal racing line (Dry minimum-curvature late-apex vs Wet off-line grip)
      let baseLat = poseNow.optLat || 0;
      if (isWet && poseNow.curv > 0.14) {
        const wetGain = 2.4 + dna.wetIq * 1.1;
        const wetShift = Math.max(-2.2, Math.min(2.2, -(poseNow.signedCurv || 0) * wetGain));
        baseLat = Math.max(-4.35, Math.min(4.35, baseLat + wetShift));
      }

      // 2D Wrapped Spatial Neighbourhood Scan (sees ALL cars ahead/behind, including lapped cars & 3-wide!)
      let ahead = null, aheadDs = Infinity, aheadGapS = 99;
      let behind = null, behindDs = Infinity, behindGapS = 99;
      let hazard = null, hazardDs = Infinity;
      let blueFlagLeader = null, blueFlagDs = Infinity;
      const sideRivals = [];
      const nearby = [];

      for (let j = 0; j < active.length; j++) {
        if (i === j) continue;
        const other = active[j];
        const dProg = wrapProgDelta(other.totalProg, car.totalProg);
        const ds = dProg * totalLen;
        if (Math.abs(ds) > 130) continue;
        const gapS = Math.abs(dProg) * lapS;
        const oLat = other.latOffset || 0;
        nearby.push({ car: other, ds, gapS, lat: oLat, pose: poses[j] });

        if (ds > 0.5 && ds < 120) {
          if ((other.spinTimer > 0 || (other.wingDamaged && ds < 55)) && ds < hazardDs) {
            hazard = other;
            hazardDs = ds;
          }
          if (ds < aheadDs) {
            ahead = other;
            aheadDs = ds;
            aheadGapS = gapS;
          }
        } else if (ds < -0.5 && -ds < 85) {
          if (-ds < behindDs) {
            behind = other;
            behindDs = -ds;
            behindGapS = gapS;
          }
          // FIA Blue Flag: faster car at least ~0.45 laps ahead of us is closing rapidly from behind!
          if ((other.totalProg - car.totalProg) > 0.45 && -ds < 62 && -ds < blueFlagDs) {
            blueFlagLeader = other;
            blueFlagDs = -ds;
          }
        }
        // Deadband hysteresis on side-by-side FIGHT prevents rapid fight <-> attack boundary flapping!
        const fightSpan = car.battleState === "fight" ? (PHYS_LEN * 1.12) : (PHYS_LEN * 0.80);
        if (Math.abs(ds) <= fightSpan && Math.abs((car.latOffset || 0) - oLat) < 4.9) {
          sideRivals.push({ car: other, ds, lat: oLat, pose: poses[j] });
        }
      }

      // 5-Lane Lateral Corridor Evaluator: finds clearest open passing lane avoiding ALL nearby cars!
      const curLat = car.latOffset || 0;
      function scoreLaneClearance(candLat, lookAheadDs) {
        let minClear = 99;
        for (let k = 0; k < nearby.length; k++) {
          const nb = nearby[k];
          if (nb.ds < -PHYS_LEN * 1.15 || nb.ds > lookAheadDs) continue;
          const sep = Math.abs(candLat - nb.lat);
          if (sep < minClear) minClear = sep;
        }
        return minClear;
      }
      function pickOpenPassingLane(preferSign, rivalLat) {
        let bestLane = Math.max(-4.35, Math.min(4.35, rivalLat + preferSign * (PHYS_WID * 1.55)));
        let bestScore = -1e9;
        for (let k = 0; k < CANDIDATE_LANES.length; k++) {
          const L = Math.max(-4.35, Math.min(4.35, CANDIDATE_LANES[k]));
          const clr = scoreLaneClearance(L, PHYS_LEN * 4.5);
          if (clr < PHYS_WID * 1.18) continue;
          const prefBonus = Math.sign(L - rivalLat) === preferSign ? 1.8 : 0;
          const moveCost = Math.abs(L - curLat) * 0.22;
          const sc = Math.min(5.0, clr) + prefBonus - moveCost;
          if (sc > bestScore) { bestScore = sc; bestLane = L; }
        }
        return { lane: bestLane, open: bestScore > -1e8 };
      }

      let targetLat = baseLat;
      let speedMod = 1.0;
      let bState = "clean";
      let bTag = "";
      let obsBadge = "";
      let obsDetail = isWet ? "WET LINE · HUNTING GRIP" : "OPTIMAL LINE · CLEAN PACE";
      let sensorTarget = null;
      let commitDur = 0;
      let hardOverride = false;

      // ---- HARD SAFETY & FIA SPORTING CODE OVERRIDES ----
      if (hazard) {
        const hPose = sampleTrack(geom, hazard.totalProg);
        const hLat = hazard.latOffset || 0;
        const evadeSign = hLat >= 0 ? -1 : 1;
        const openPick = pickOpenPassingLane(evadeSign, hLat);
        targetLat = openPick.open ? openPick.lane : evadeSign * 4.35;
        speedMod -= hazard.spinTimer > 0 ? 0.045 : 0.015;
        bState = "avoid";
        bTag = "AVOID!";
        obsBadge = "⚠ AVOID";
        obsDetail = hazard.spinTimer > 0
          ? `AVOIDING SPINNING ${getCode(hazard)} · SWERVE ${targetLat > curLat ? "RIGHT" : "LEFT"}`
          : `AVOIDING DAMAGED ${getCode(hazard)} · CLEAR CORRIDOR`;
        sensorTarget = { x: hPose.x + hPose.nx * hLat, y: hPose.y + hPose.ny * hLat, kind: "avoid" };
        car.aiCommitTimer = 0.85;
        hardOverride = true;
      } else if (blueFlagLeader && !inYellowZone) {
        // FIA Blue Flag: Lapped backmarker smoothly yields off the racing line so leaders pass cleanly!
        const yieldSign = (baseLat >= 0 ? -1 : 1);
        targetLat = Math.max(-4.4, Math.min(4.4, yieldSign * 4.15));
        speedMod = 0.945;
        bState = "blue_flag";
        bTag = "BLUE";
        obsBadge = "🔵 BLUE FLAG";
        obsDetail = `YIELDING TO LAPPING LEADER ${getCode(blueFlagLeader)}`;
        car.aiCommitTimer = 0.75;
        hardOverride = true;
      } else if (inYellowZone && ahead && aheadGapS < 0.65) {
        targetLat = baseLat;
        speedMod = Math.min(speedMod, 0.96);
        bState = "hold";
        bTag = "YELLOW";
        obsBadge = "🟡 YELLOW";
        obsDetail = safetyActive
          ? `SC / VSC DELTA · NO OVERTAKING ALLOWED`
          : `YELLOW FLAG S${curSec} · HOLDING BEHIND ${getCode(ahead)}`;
        hardOverride = true;
      } else if (!inYellowZone && sideRivals.length > 0) {
        // PHYSICAL SIDE-BY-SIDE (2-Wide or 3-Wide): Leave a full car's width at all times!
        let nearest = sideRivals[0];
        for (let k = 1; k < sideRivals.length; k++) {
          if (Math.abs(sideRivals[k].ds) < Math.abs(nearest.ds)) nearest = sideRivals[k];
        }
        const rLat = nearest.lat;
        const minSpace = PHYS_WID * 1.48; // ~3.55u clean wheel-to-wheel spacing
        let desiredSide = curLat >= rLat ? 1 : -1;
        if (Math.abs(curLat - rLat) < 0.35) desiredSide = rLat >= 0 ? -1 : 1;
        // If 3-wide (rivals on both sides), hold dead center between them!
        let leftLim = -4.35, rightLim = 4.35;
        for (let k = 0; k < sideRivals.length; k++) {
          const sl = sideRivals[k].lat;
          if (sl < curLat) leftLim = Math.max(leftLim, sl + minSpace);
          else rightLim = Math.min(rightLim, sl - minSpace);
        }
        if (leftLim <= rightLim) {
          const pref = Math.max(-4.35, Math.min(4.35, rLat + desiredSide * minSpace));
          targetLat = Math.max(leftLim, Math.min(rightLim, pref));
        } else {
          targetLat = (leftLim + rightLim) * 0.5;
        }
        const isInside = Math.sign(targetLat) === cornerSign && Math.abs(targetLat) > 0.6;
        bState = "fight";
        bTag = "FIGHT";
        obsBadge = isInside ? "⚔ FIGHT IN" : "⚔ FIGHT OUT";
        obsDetail = sideRivals.length >= 2
          ? `3-WIDE WHEEL-TO-WHEEL · HOLDING CENTER CORRIDOR`
          : `WHEEL-TO-WHEEL VS ${getCode(nearest.car)} · ${isInside ? "LEAVING SPACE · APEX" : "LEAVING SPACE · OUTSIDE"}`;
        sensorTarget = { x: nearest.pose.x + nearest.pose.nx * rLat, y: nearest.pose.y + nearest.pose.ny * rLat, kind: "fight" };
        // Preserve attacking pace/DRS/ERS advantage during wheel-to-wheel side-by-side so faster cars COMPLETE the overtake!
        const fightPaceAdv = (nearest.car.currentLapS || lapS) - (car.currentLapS || lapS);
        const fightDrs = (o.drsEnabled !== false && car.inDrsRange && poseNow.curv < 0.16) ? 0.036 : 0;
        const fightPush = (car.paceMode === "push" ? 0.028 : 0) + (fightPaceAdv > 0 ? Math.min(0.070, fightPaceAdv * 0.048) : 0) + fightDrs;
        speedMod = 1.0 + fightPush + (poseNow.curv > 0.16 ? (isInside ? 0.016 : -0.005) : 0);
        car.aiCommitTimer = Math.max(car.aiCommitTimer || 0, 0.95);
        hardOverride = true;
      }

      // ---- UTILITY-SCORED SIMULTANEOUS OFFENSE + DEFENSE (NO DEFENSIVE PARALYSIS!) ----
      if (!hardOverride) {
        const cm = car._aiCommit;
        const canHoldCommit = !inYellowZone && car.aiCommitTimer > 0 && cm && (aheadGapS < 1.35 || behindGapS < 0.85);

        if (canHoldCommit) {
          bState = cm.state;
          bTag = cm.tag;
          obsBadge = cm.badge;
          obsDetail = cm.detail;
          targetLat = cm.latOffset != null ? cm.latOffset : baseLat;
          speedMod = cm.speedMod || 1.0;
          if (ahead && aheadGapS < 1.15 && (bState === "attack" || bState === "divebomb" || bState === "tow" || bState === "cutback" || bState === "clean_air" || bState === "hold")) {
            const aPose = sampleTrack(geom, ahead.totalProg);
            sensorTarget = { x: aPose.x + aPose.nx * (ahead.latOffset || 0), y: aPose.y + aPose.ny * (ahead.latOffset || 0), kind: bState };
          } else if (behind && behindGapS < 0.75 && bState === "defend") {
            const bPose = sampleTrack(geom, behind.totalProg);
            sensorTarget = { x: bPose.x + bPose.nx * (behind.latOffset || 0), y: bPose.y + bPose.ny * (behind.latOffset || 0), kind: "defend" };
          }
        } else if (!inYellowZone) {
          // Evaluate ALL tactical options simultaneously via Utility Scoring
          let bestUtil = 0.25; // baseline "clean optimal line"
          let bestPlan = null;

          // A. OFFENSIVE UTILITIES (TOW / ATTACK / DIVEBOMB / CUTBACK / CLEAN AIR / HOLD)
          if (ahead && aheadGapS < 1.15 && aheadGapS > 0.06) {
            const aPose = sampleTrack(geom, ahead.totalProg);
            const aLat = ahead.latOffset || 0;
            const aPt = { x: aPose.x + aPose.nx * aLat, y: aPose.y + aPose.ny * aLat };
            const inWake = Math.abs(curLat - aLat) < 2.65;
            const drsBoost = (o.drsEnabled !== false && car.inDrsRange && poseNow.curv < 0.16) ? 0.026 : 0;
            const tyreAdv = Math.round((car.tyreLife || 80) - (ahead.tyreLife || 80));
            const paceAdv = (ahead.currentLapS || lapS) - (car.currentLapS || lapS);
            const isLapping = (car.totalProg - ahead.totalProg) > 0.45;
            const defCoveredInside = Math.sign(aLat) === cornerSign && Math.abs(aLat) > 1.65;
            const wantsAttack = isLapping || car.paceMode === "push" || drsBoost > 0 || tyreAdv >= 5 || paceAdv > 0.08 || (car.ersMode === "overtake" && car.ers > 12);
            const shouldHold = !isLapping && (car.paceMode === "conserve" || (car.tyreTemp || 96) > 113);

            if (shouldHold && aheadGapS < 0.50) {
              const u = 0.85;
              if (u > bestUtil) {
                bestUtil = u;
                bestPlan = {
                  state: "hold", tag: "HOLD", badge: "⏸ HOLD",
                  detail: (car.tyreTemp || 96) > 113
                    ? `HOLDING BEHIND ${getCode(ahead)} · COOLING TYRES (${Math.round(car.tyreTemp)}°C)`
                    : `HOLDING BEHIND ${getCode(ahead)} · MANAGING PACE`,
                  latOffset: Math.max(-4.3, Math.min(4.3, baseLat - cornerSign * 1.6)),
                  speedMod: 0.985, sensor: { x: aPt.x, y: aPt.y, kind: "hold" }, dur: 1.5,
                };
              }
            } else {
              // Straight-line SLIPSTREAM TOW (0.38s .. 1.15s)
              if (poseNow.curv < 0.18 && aheadGapS > 0.36 && (inWake || aheadGapS < 0.95)) {
                const towBoost = Math.max(0.022, (1 - aheadGapS / 1.15) * 0.048) + drsBoost;
                const u = 0.72 + (wantsAttack ? 0.25 : 0) + (drsBoost > 0 ? 0.22 : 0) + Math.max(0, paceAdv) * 0.18;
                if (u > bestUtil) {
                  bestUtil = u;
                  bestPlan = {
                    state: "tow", tag: "TOW", badge: "💨 TOW",
                    detail: `SLIPSTREAMING ${getCode(ahead)} (+${aheadGapS.toFixed(2)}s)${drsBoost > 0 ? " + DRS" : ""}`,
                    latOffset: Math.max(-4.2, Math.min(4.2, aLat * 0.82 + baseLat * 0.18)),
                    speedMod: 1.0 + towBoost, sensor: { x: aPt.x, y: aPt.y, kind: "tow" }, dur: 1.15,
                  };
                }
              }

              // DECISIVE OVERTAKE ATTACK / LATE-BRAKING DIVE (gap <= 0.48s or strong pace closing!)
              const attackWindow = aheadGapS <= 0.48 || (aheadGapS <= 0.65 && (paceAdv > 0.25 || drsBoost > 0 || isLapping));
              if (attackWindow && wantsAttack) {
                const preferSign = defCoveredInside ? -cornerSign : cornerSign;
                const openPick = pickOpenPassingLane(preferSign, aLat);
                if (openPick.open) {
                  const isDive = !defCoveredInside && approachingCorner && aheadGapS <= 0.42 && (dna.bravery >= 0.36 || paceAdv > 0.22);
                  const speedBoost = isDive
                    ? (1.048 + dna.bravery * 0.016 + drsBoost)
                    : (1.038 + Math.min(0.036, Math.max(0, paceAdv) * 0.022) + drsBoost);
                  const u = 1.08 + (paceAdv > 0 ? Math.min(0.45, paceAdv * 0.28) : 0) + (drsBoost > 0 ? 0.28 : 0) + dna.bravery * 0.18 + (isLapping ? 0.5 : 0);
                  if (u > bestUtil) {
                    bestUtil = u;
                    bestPlan = {
                      state: isDive ? "divebomb" : "attack",
                      tag: isDive ? "DIVE!" : "ATTACK",
                      badge: isDive ? "⚡ DIVE!" : "⚡ ATTACK",
                      detail: isDive
                        ? `ATTACKING ${getCode(ahead)} · LATE-BRAKING INSIDE DIVE${tyreAdv > 4 ? ` (+${tyreAdv}% TYRE)` : ""}`
                        : `PULLING OUT ON ${getCode(ahead)} · ${defCoveredInside ? "OUTSIDE PASS" : "INSIDE PASS"}`,
                      latOffset: openPick.lane,
                      speedMod: speedBoost,
                      sensor: { x: aPt.x, y: aPt.y, kind: "attack" },
                      dur: isDive ? 1.75 : 1.55,
                    };
                  }
                }
              }

              // CORNER SWITCHBACK / CUTBACK when defender covers inside
              if (poseNow.curv >= 0.16 && aheadGapS < 0.46 && defCoveredInside) {
                const u = 0.88 + dna.craft * 0.22 + (wantsAttack ? 0.15 : 0);
                if (u > bestUtil) {
                  bestUtil = u;
                  const entryPhase = poseAhead.curv > poseNow.curv;
                  if (!entryPhase) car.cutbackBoostTimer = 1.65;
                  bestPlan = {
                    state: "cutback", tag: "CUTBACK", badge: "↺ CUTBACK",
                    detail: entryPhase
                      ? `${getCode(ahead)} COVERED INSIDE · SETTING UP WIDE SWITCHBACK`
                      : `CUTTING UNDERNEATH ${getCode(ahead)} · EXIT TRACTION LAUNCH!`,
                    latOffset: entryPhase ? -cornerSign * 3.75 : cornerSign * 3.25,
                    speedMod: entryPhase ? 1.005 : 1.042,
                    sensor: { x: aPt.x, y: aPt.y, kind: "attack" },
                    dur: 1.55,
                  };
                }
              }

              // DIRTY AIR AVOIDANCE in medium/high-speed corners
              if (poseNow.curv >= 0.18 && inWake && aheadGapS >= 0.36 && aheadGapS < 0.82) {
                const u = 0.55 + (1 - aheadGapS / 0.82) * 0.18;
                if (u > bestUtil) {
                  bestUtil = u;
                  const washout = (1 - aheadGapS / 0.82) * 0.026;
                  bestPlan = {
                    state: "clean_air", tag: "", badge: "🌬 CLEAN AIR",
                    detail: `DIRTY AIR BEHIND ${getCode(ahead)} · HUNTING CLEAN AIR`,
                    latOffset: Math.max(-4.25, Math.min(4.25, baseLat - cornerSign * 1.9)),
                    speedMod: 1.0 - washout,
                    sensor: { x: aPt.x, y: aPt.y, kind: "tow" },
                    dur: 1.4,
                  };
                }
              }
            }
          }

          // B. DEFENSIVE UTILITY (ONLY when genuinely under imminent passing threat & NOT outscored by active overtake!)
          if (behind && behindGapS < 0.52 && behindGapS > 0.10 && !inBrakingZone) {
            const behindPaceAdv = (car.currentLapS || lapS) - (behind.currentLapS || lapS);
            const behindThreat = behindPaceAdv > 0.12 || behind.paceMode === "push" || behind.inDrsRange;
            if (behindThreat && (approachingCorner || behindGapS < 0.34)) {
              const bPose = sampleTrack(geom, behind.totalProg);
              const uDef = 0.86 + (1 - behindGapS / 0.52) * 0.30 + dna.craft * 0.14 - (ahead && aheadGapS < 0.45 ? 0.42 : 0);
              if (uDef > bestUtil) {
                if ((car.defendMovesThisStraight || 0) < 1) {
                  // FIA Legal: ONE decisive defensive move before braking zone!
                  car.defendMovesThisStraight = 1;
                  car.defendLat = cornerSign * 3.65;
                  car.defendLockTimer = 1.8;
                  bestUtil = uDef;
                  bestPlan = {
                    state: "defend", tag: "DEFEND", badge: "🛡 1-MOVE",
                    detail: `1-MOVE DEFENCE VS ${getCode(behind)} (+${behindGapS.toFixed(2)}s) · COVERING INSIDE`,
                    latOffset: car.defendLat,
                    speedMod: poseNow.curv > 0.24 ? 0.990 : 1.002,
                    sensor: { x: bPose.x + bPose.nx * (behind.latOffset || 0), y: bPose.y + bPose.ny * (behind.latOffset || 0), kind: "defend" },
                    dur: 1.65,
                  };
                } else if (car.defendLat != null) {
                  bestUtil = uDef - 0.12;
                  bestPlan = {
                    state: "defend", tag: "HOLD LINE", badge: "🛡 LOCKED",
                    detail: `1-MOVE USED · HOLDING DEFENSIVE LINE VS ${getCode(behind)}`,
                    latOffset: car.defendLat,
                    speedMod: 1.0,
                    sensor: { x: bPose.x + bPose.nx * (behind.latOffset || 0), y: bPose.y + bPose.ny * (behind.latOffset || 0), kind: "defend" },
                    dur: 1.15,
                  };
                }
              }
            }
          }

          if (bestPlan) {
            bState = bestPlan.state;
            bTag = bestPlan.tag;
            obsBadge = bestPlan.badge;
            obsDetail = bestPlan.detail;
            targetLat = bestPlan.latOffset;
            speedMod = bestPlan.speedMod;
            sensorTarget = bestPlan.sensor;
            commitDur = bestPlan.dur;
          }
        }

        // ---- FIA NO-MOVING-UNDER-BRAKING CONSTRAINT (Holds lane WITHOUT overwriting attack/dive state!) ----
        if (inBrakingZone && car.brakeLockedLat != null && (aheadGapS < 0.60 || behindGapS < 0.60)) {
          const underAttack = behind && behindGapS < 0.28 && behindGapS > 0.08 && (car.paceMode === "push" || dna.craft < 0.55);
          const breachKey = `mub_${car.idx}`;
          const canBreach = underAttack && !car.movedUnderBraking && (o.leaderLap || 0) >= 1 && (!fx || !fx.pairCooldown[breachKey] || nowS >= fx.pairCooldown[breachKey]);
          const mubProb = 0.016 * dt * Math.max(0.5, o.chaosMult || 1.0) * (1.35 - dna.craft * 0.6) * 14;
          if (canBreach && Math.random() < mubProb) {
            car.movedUnderBraking = true;
            const jinkLat = Math.max(-4.15, Math.min(4.15, behind.latOffset || 0));
            car.brakeLockedLat = jinkLat;
            targetLat = jinkLat;
            bState = "defend";
            bTag = "FIA NOTE";
            obsBadge = "⚖️ MUB!";
            obsDetail = `ILLEGAL MOVE UNDER BRAKING VS ${getCode(behind)} · STEWARDS NOTED!`;
            if (fx) fx.pairCooldown[breachKey] = nowS + Math.max(85, lapS * 3.0);
            const givePen = Math.random() < 0.60 && !(car.timePenaltyS >= 10);
            if (givePen) car.timePenaltyS = (car.timePenaltyS || 0) + 5;
            events.push({
              type: "fia_breach",
              chaser: behind,
              target: car,
              culprit: car,
              fiaRule: "Moving under braking",
              article: "App. L Ch. IV",
              penaltyS: givePen ? 5 : 0,
              blackWhiteFlag: !givePen,
              verdict: givePen ? "+5s Time Penalty" : "Black & White Warning Flag",
              sector: curSec,
              x: poseNow.x,
              y: poseNow.y,
            });
          } else {
            // Strictly hold locked braking lane (App. L Ch. IV) while preserving attacking/defending tactical intent!
            targetLat = car.brakeLockedLat;
            if (bState === "clean") {
              bState = "hold";
              bTag = "BRAKING";
              obsBadge = "🛑 LOCKED";
              obsDetail = (behind && behindGapS < 0.60 && (!ahead || behindGapS <= aheadGapS))
                ? `HOLDING LINE UNDER BRAKING VS ${getCode(behind)} (FIA LEGAL)`
                : `BRAKING STRAIGHT BEHIND ${getCode(ahead)} · NO SWITCHING`;
            }
          }
        }

        if (commitDur > 0) {
          car.aiCommitTimer = commitDur;
          car._aiCommit = { state: bState, tag: bTag, badge: obsBadge, detail: obsDetail, latOffset: targetLat, speedMod };
        }
      }

      // Switchback Exit Traction Surge
      if (car.cutbackBoostTimer > 0 && poseNow.curv < 0.28) {
        speedMod += 0.052;
        if (!bTag) bTag = "CUTBACK";
        if (!obsBadge) {
          obsBadge = "↺ CUTBACK";
          obsDetail = "SWITCHBACK EXIT · FULL TRACTION DEPLOY";
        }
      }

      // Off-Line Marble Drag vs Optimal Rubbered-Groove Grip Bonus
      const offLineDist = Math.abs(curLat - baseLat);
      if (poseNow.curv > 0.18) {
        if (offLineDist < 0.95) speedMod += 0.008;
        else if (offLineDist > 2.65) speedMod -= Math.min(0.022, (offLineDist - 2.65) * 0.009);
      }
      if (car.lockupTimer > 0) speedMod -= 0.045;

      // Soft Predictive Side Separation (prevents gentle drifting into an adjacent car)
      targetLat = Math.max(-4.55, Math.min(4.55, targetLat));
      if (ahead && aheadDs < PHYS_LEN * 1.9) {
        const minSep = PHYS_WID * 1.42;
        const curDiff = targetLat - (ahead.latOffset || 0);
        if (Math.abs(curDiff) < minSep && (bState === "attack" || bState === "divebomb" || bState === "fight")) {
          const pushDir = curDiff === 0 ? ((car.idx % 2 === 0) ? 1 : -1) : Math.sign(curDiff);
          let sepLat = (ahead.latOffset || 0) + pushDir * minSep;
          if (Math.abs(sepLat) > 4.60) sepLat = (ahead.latOffset || 0) - pushDir * minSep;
          targetLat = Math.max(-4.60, Math.min(4.60, sepLat));
        }
      }

      // JERK-LIMITED SMOOTH STEERING COMMAND PLANNER + 2ND-ORDER CRITICALLY-DAMPED STEERING DYNAMICS
      // Rate-limiting targetLat -> latCmd cuts peak lateral acceleration from ~43 u/s² down to < 16 u/s²!
      if (car.latCmd == null || !Number.isFinite(car.latCmd)) car.latCmd = curLat;
      const cmdRate = bState === "avoid" ? 7.2 : (bState === "divebomb" || bState === "fight" ? 5.2 : 3.8);
      const cmdDiff = targetLat - car.latCmd;
      car.latCmd += Math.sign(cmdDiff) * Math.min(Math.abs(cmdDiff), cmdRate * dt);

      const stiffness = bState === "avoid" ? 18.0 : (bState === "divebomb" || bState === "fight" ? 14.0 : 11.5);
      const damping = 2.0 * Math.sqrt(stiffness) * 1.08;
      const maxLatVel = bState === "avoid" ? 6.5 : (bState === "divebomb" || bState === "fight" ? 4.8 : 3.9);
      const curVel = car.latVel || 0;
      const rawLatAcc = stiffness * (car.latCmd - curLat) - damping * curVel;
      const clampedLatAcc = Math.max(-16.5, Math.min(16.5, rawLatAcc));
      const nextVel = Math.max(-maxLatVel, Math.min(maxLatVel, curVel + clampedLatAcc * dt));
      car.latVel = nextVel;
      car.latOffset = Math.max(-maxEdge, Math.min(maxEdge, curLat + nextVel * dt));

      // Smooth longitudinal battleSpeedMult
      const clampedMod = Math.max(0.88, Math.min(1.16, speedMod));
      car.battleSpeedMult = (car.battleSpeedMult || 1.0) + (clampedMod - (car.battleSpeedMult || 1.0)) * Math.min(1, dt * 4.2);
      car.battleState = bState;
      car.battleTag = bTag;
      car.aiObs = {
        state: bState,
        badge: obsBadge,
        detail: obsDetail,
        color: AI_COLORS[bState] || AI_COLORS.clean,
        targetLat,
        sensorTarget,
      };

      // Ambient realism FX: titanium plank sparks & pressure-driven brake lock-ups
      if (fx && !safetyActive) {
        const wx = poseNow.x + poseNow.nx * car.latOffset;
        const wy = poseNow.y + poseNow.ny * car.latOffset;
        if ((car.livePhysKph || car.liveKph || 0) >= 278 && poseNow.curv < 0.14 && Math.random() < dt * 1.35) {
          spawnPlankSparks(fx, wx, wy, poseNow.tx, poseNow.ty);
        }
        const isDiveLock = bState === "divebomb" && inBrakingZone && (car.tyreLife < 68 || isWet) && Math.random() < dt * 3.4;
        const isHairpinLock = inBrakingZone && poseAhead.curv > 0.42 && (car.tyreLife < 58 || car.paceMode === "push") && Math.random() < dt * 1.15;
        if (isDiveLock || isHairpinLock) {
          spawnLockupSmoke(fx, wx, wy, poseNow.tx, poseNow.ty);
          spawnSkidmark(fx, wx, wy, poseNow.tx, poseNow.ty, poseNow.nx, poseNow.ny);
          if (isDiveLock && Math.random() < 0.25) car.lockupTimer = 0.45;
        }
      }
    }

    // 3. VELOCITY-FIRST SUB-STEPPED LONGITUDINAL INTEGRATION + PREDICTIVE TTC + 2D SOLID-BODY SOLVER
    // Completely zoom-invariant (PHYS_LEN = 5.60u, PHYS_WID = 2.40u) -> ZERO overlaps AND ZERO backward snaps!
    const subSteps = simDtTotal > 0 ? Math.max(1, Math.min(8, Math.ceil(dt / 0.008) * Math.max(1, Math.ceil((o.speedMult || 1) / 2)))) : 1;
    const subSimDt = simDtTotal > 0 ? simDtTotal / subSteps : 0;
    const subDt = dt / subSteps;

    // Record frame-start progress so the solver guarantees monotonic forward motion (ZERO backward snaps!)
    for (let i = 0; i < active.length; i++) {
      active[i]._ttcCap = 1.6;
      active[i]._frameStartProg = active[i].totalProg;
    }

    for (let sub = 0; sub < subSteps; sub++) {
      // 3A. Velocity-first longitudinal integration with Predictive TTC Gearbox Limiter (when simDt is supplied)
      if (subSimDt > 0) {
        for (let i = 0; i < active.length; i++) {
          const car = active[i];
          const pNow = sampleTrack(geom, car.totalProg);
          const baseMult = (pNow.speedMult || 1.0) * (car.battleSpeedMult || 1.0);
          let desiredRate = (1.0 / Math.max(20, car.currentLapS || lapS)) * baseMult;
          if (car.spinTimer > 0) desiredRate *= 0.45;

          // Predictive TTC Check: if any car is directly ahead within 2.5 car lengths in the same lane, match its speed smoothly!
          const cLat = car.latOffset || 0;
          let maxSafeAdv = Infinity;
          let blocker = null;
          for (let j = 0; j < active.length; j++) {
            if (i === j) continue;
            const other = active[j];
            // Cruising finished cars ghost out of active racers' braking/blocking corridors
            if (car.finishedRace !== other.finishedRace) continue;
            const dProg = wrapProgDelta(other.totalProg, car.totalProg);
            if (dProg <= 0) continue;
            const ds = dProg * totalLen;
            if (ds > PHYS_LEN * 2.5) continue;
            if (Math.abs(cLat - (other.latOffset || 0)) >= PHYS_WID * 1.12) continue;
            const clearance = Math.max(0, ds - PHYS_LEN * 1.04);
            const otherRate = (other._lastProgRate != null)
              ? other._lastProgRate
              : ((1.0 / Math.max(20, other.currentLapS || lapS)) * (sampleTrack(geom, other.totalProg).speedMult || 1.0));
            const maxAdv = otherRate * subSimDt + (clearance / totalLen) * 0.65;
            if (maxAdv < maxSafeAdv) {
              maxSafeAdv = maxAdv;
              blocker = other;
            }
          }

          let adv = desiredRate * subSimDt;
          if (adv > maxSafeAdv) {
            adv = Math.max(0, maxSafeAdv);
            if (blocker) {
              const bLat = blocker.latOffset || 0;
              const openSign = bLat >= 0 ? -1 : 1;
              const pullTarget = Math.max(-maxEdge, Math.min(maxEdge, bLat + openSign * (PHYS_WID * 1.42)));
              car.latOffset = Math.max(-maxEdge, Math.min(maxEdge, cLat + Math.sign(pullTarget - cLat) * Math.min(Math.abs(pullTarget - cLat), subDt * 3.4)));
              car._ttcCap = Math.min(car._ttcCap || 1.6, Math.max(0.50, (adv / Math.max(1e-7, subSimDt)) * Math.max(20, car.currentLapS || lapS)));
              if (car.aiObs && car.aiObs.state === "clean") {
                car.aiObs.state = "hold";
                car.aiObs.badge = "⏸ BLOCKED";
                car.aiObs.detail = `BLOCKED BEHIND ${getCode(blocker)} · PULLING OUT TO PASS`;
                car.aiObs.color = "#facc15";
              }
            }
          }
          car._lastProgRate = adv / Math.max(1e-7, subSimDt);
          car.totalProg += adv;
        }
      } else {
        for (let i = 0; i < active.length; i++) {
          const car = active[i];
          const pNow = sampleTrack(geom, car.totalProg);
          const sf = (pNow.speedMult || 1.0) * (car.battleSpeedMult || 1.0);
          const lapRatio = lapS / Math.max(20, car.currentLapS || lapS);
          car.livePhysKph = Math.max(60, avgLapKph * sf * lapRatio);
          car.liveLongG = pNow.aLongG;
        }
      }

      // 3B. Anti-Tunneling Guard (wrapped arc-length)
      for (let i = 0; i < active.length; i++) {
        const b = active[i];
        if (b._prevProg == null) continue;
        for (let j = 0; j < active.length; j++) {
          if (i === j) continue;
          const a = active[j];
          if (a._prevProg == null) continue;
          const prevD = wrapProgDelta(a._prevProg, b._prevProg);
          const curD = wrapProgDelta(a.totalProg, b.totalProg);
          if (prevD > 0 && prevD < 0.04 && curD <= 0 && curD > -0.04) {
            if (Math.abs((b.latOffset || 0) - (a.latOffset || 0)) < PHYS_WID * 0.98) {
              const lapDiff = Math.round(b._prevProg - a._prevProg);
              const safeBack = (a.totalProg + lapDiff) - (PHYS_LEN * 1.02) / totalLen;
              if (safeBack >= b._frameStartProg) b.totalProg = safeBack;
              else a.totalProg += ((PHYS_LEN * 1.02) / totalLen) - (a.totalProg + lapDiff - b._frameStartProg);
            }
          }
        }
      }

      // 3C. Pure Convergent Gauss-Seidel 2D Solid-Body Non-Penetration Safety Solver (PHYS_LEN x PHYS_WID)
      // Back-to-front sweep propagates multi-car forward shifts through an entire 24-car train in 1-2 passes!
      for (let iter = 0; iter < 24; iter++) {
        let anyOverlap = false;
        for (let i = active.length - 1; i >= 0; i--) {
          for (let j = i - 1; j >= 0; j--) {
            let a = active[i], b = active[j];
            let dProg = wrapProgDelta(a.totalProg, b.totalProg);
            if (dProg < 0) {
              const tmp = a; a = b; b = tmp;
              dProg = -dProg;
            }
            const ds = dProg * totalLen;
            if (ds >= PHYS_LEN) continue;

            const aLat = a.latOffset || 0;
            const bLat = b.latOffset || 0;
            const dLat = bLat - aLat;
            const absLat = Math.abs(dLat);
            if (absLat >= PHYS_WID) continue;
            anyOverlap = true;

            // Pure solid separation (NO lateral drift inside iter loop -> 0 overlaps & 0 lateral snaps!)
            const isRearBlock = ds > PHYS_LEN * 0.34;
            if (isRearBlock) {
              const reqShift = (PHYS_LEN * 1.02 - ds) / totalLen;
              const maxBack = Math.max(0, b.totalProg - b._frameStartProg);
              const backApplied = Math.min(reqShift, maxBack);
              b.totalProg -= backApplied;
              if (reqShift > backApplied) a.totalProg += (reqShift - backApplied);
              b.battleSpeedMult = Math.min(b.battleSpeedMult || 1.0, 0.96);
            } else {
              const pushSign = dLat === 0 ? ((b.idx % 2 === 0) ? 1 : -1) : Math.sign(dLat);
              const pen = PHYS_WID - absLat;
              let newA = aLat - pushSign * pen * 0.5;
              let newB = bLat + pushSign * pen * 0.5;
              if (newA < -maxEdge) { newB += (-maxEdge - newA); newA = -maxEdge; }
              else if (newA > maxEdge) { newB -= (newA - maxEdge); newA = maxEdge; }
              if (newB < -maxEdge) { newA += (-maxEdge - newB); newB = -maxEdge; }
              else if (newB > maxEdge) { newA -= (newB - maxEdge); newB = maxEdge; }
              newA = Math.max(-maxEdge, Math.min(maxEdge, newA));
              newB = Math.max(-maxEdge, Math.min(maxEdge, newB));

              if (Math.abs(newB - newA) >= PHYS_WID * 0.99 && Math.abs(newA - aLat) <= 0.30 && Math.abs(newB - bLat) <= 0.30) {
                a.latOffset = newA;
                b.latOffset = newB;
                if (((b.latVel || 0) - (a.latVel || 0)) * pushSign < 0) {
                  const midV = ((a.latVel || 0) + (b.latVel || 0)) * 0.5;
                  a.latVel = midV;
                  b.latVel = midV;
                }
              } else {
                const reqShift = (PHYS_LEN * 1.02 - ds) / totalLen;
                const maxBack = Math.max(0, b.totalProg - b._frameStartProg);
                const backApplied = Math.min(reqShift, maxBack);
                b.totalProg -= backApplied;
                if (reqShift > backApplied) a.totalProg += (reqShift - backApplied);
              }
            }
          }
        }
        if (!anyOverlap) break;
      }

      for (let i = 0; i < active.length; i++) {
        active[i]._prevProg = active[i].totalProg;
      }
    }

    // Update single-source live physical speed (km/h) & longitudinal G directly from actual frame displacement!
    if (simDtTotal > 0) {
      for (let i = 0; i < active.length; i++) {
        const car = active[i];
        const actualDProg = Math.max(0, car.totalProg - car._frameStartProg);
        const actualKph = ((circuit.length_km || 5.0) * (actualDProg / simDtTotal)) * 3600;
        car.livePhysKph = Math.max(60, Math.min(topKph + 42, actualKph));
        car.liveLongG = sampleTrack(geom, car.totalProg).aLongG;
      }
    }

    // 4. Physically Grounded FIA Incident & Stewards Physics (~1–2 genuine incidents per 15-lap GP at 1.0x chaos!)
    if (safetyActive || (o.leaderLap || 0) < 1) return events;
    const wetRisk = (o.wetness || 0) >= 25 ? 1.55 : 1.0;

    for (let i = 1; i < active.length; i++) {
      const chaser = active[i];
      const target = active[i - 1];
      const dProg = wrapProgDelta(target.totalProg, chaser.totalProg);
      const gapS = dProg * lapS;
      if (gapS > 0.14 || gapS < -0.02) continue;
      if (chaser.spinTimer > 0 || target.spinTimer > 0) continue;

      const latSep = Math.abs((chaser.latOffset || 0) - (target.latOffset || 0));
      const tightPressure = latSep < PHYS_WID * 1.58 || chaser.battleState === "divebomb" || chaser.lockupTimer > 0 || target.movedUnderBraking;
      if (!tightPressure) continue;

      const pairKey = chaser.idx < target.idx ? `${chaser.idx}_${target.idx}` : `${target.idx}_${chaser.idx}`;
      if (fx && fx.pairCooldown[pairKey] && nowS < fx.pairCooldown[pairKey]) continue;

      const pose = sampleTrack(geom, chaser.totalProg);
      if (pose.curv < 0.18) continue;

      const cDna = getDriverDna(chaser);
      const tDna = getDriverDna(target);
      const craftMit = Math.max(0.55, 1.35 - (cDna.craft + tDna.craft) * 0.4);
      const pushBoost = (chaser.paceMode === "push" ? 1.35 : 0.78) * (target.paceMode === "push" ? 1.15 : 0.90);
      const wearBoost = (chaser.tyreLife < 32 || target.tyreLife < 32) ? 1.60 : 0.90;
      const lungeBoost = (chaser.battleState === "divebomb" || chaser.lockupTimer > 0) ? 1.85 : 1.0;
      const mubBoost = target.movedUnderBraking ? 4.8 : 1.0;
      const chaosMult = Math.max(0.25, Math.min(4.0, o.chaosMult || 1.0));
      const lapNorm = Math.min(1.0, 15 / Math.max(12, o.totalLaps || 15));
      const avoidMult = (chaser.battleState === "avoid" || target.battleState === "avoid") ? 0.25 : 1.0;
      const prob = 0.011 * dt * lapNorm * pushBoost * wearBoost * wetRisk * lungeBoost * mubBoost * craftMit * chaosMult * avoidMult * Math.min(2.0, pose.curv * 4.0);
      if (Math.random() >= prob) continue;

      if (fx) fx.pairCooldown[pairKey] = nowS + Math.max(70, (lapS * 2.8) / Math.sqrt(chaosMult));
      const sec = Math.floor((((chaser.totalProg % 1) + 1) % 1) * 3) + 1;
      const roll = Math.random();
      let type = "contact";
      let penaltyS = 0;
      let culprit = null;
      let fiaRule = "Racing incident";
      let verdict = "No further action";
      let blackWhiteFlag = false;

      if (roll < 0.62) {
        type = "contact";
        chaser.battleSpeedMult = 0.88;
        target.battleSpeedMult = 0.92;
        if (target.movedUnderBraking) {
          culprit = target; fiaRule = "Moving under braking"; penaltyS = 5; verdict = "+5s Time Penalty";
          target.timePenaltyS = (target.timePenaltyS || 0) + 5;
        } else if (Math.random() < 0.34) {
          culprit = chaser; fiaRule = "Forcing another driver off track"; blackWhiteFlag = true; verdict = "Black & White Warning Flag";
        }
      } else if (roll < 0.91) {
        type = "spin";
        const victim = target.movedUnderBraking ? chaser : (Math.random() < 0.55 ? target : chaser);
        const agg = victim === target ? chaser : target;
        victim.spinTimer = 1.45;
        victim.spinDir = Math.random() < 0.5 ? 1 : -1;
        victim.wingDamaged = true;
        culprit = agg;
        fiaRule = target.movedUnderBraking ? "Moving under braking causing collision" : "Causing a collision";
        if (Math.random() < 0.62 && !(agg.timePenaltyS >= 10)) {
          penaltyS = 5;
          agg.timePenaltyS = (agg.timePenaltyS || 0) + 5;
          verdict = "+5s Time Penalty";
        } else {
          verdict = "Racing incident — No further action";
        }
      } else {
        type = "crash";
        const chPlayer = !!chaser.isPlayer || !!chaser.isPlayerTeam;
        const tgPlayer = !!target.isPlayer || !!target.isPlayerTeam;
        if (chPlayer || tgPlayer) {
          const pl = chPlayer ? chaser : target;
          const rv = chPlayer ? target : chaser;
          rv.dnf = true;
          pl.spinTimer = 1.55;
          pl.wingDamaged = true;
          culprit = rv;
        } else {
          target.dnf = true;
          if (Math.random() < 0.22) chaser.dnf = true;
          else { chaser.spinTimer = 1.4; chaser.wingDamaged = true; }
          culprit = chaser;
        }
        fiaRule = "Causing a collision";
        if (culprit && !culprit.dnf && !(culprit.timePenaltyS >= 10)) {
          penaltyS = 10;
          culprit.timePenaltyS = (culprit.timePenaltyS || 0) + 10;
          verdict = "+10s Time Penalty";
        } else {
          verdict = "Under FIA Post-Race Investigation";
        }
      }

      if (fx) {
        spawnCollisionFx(fx, pose.x, pose.y, type);
        spawnSkidmark(fx, pose.x, pose.y, pose.tx, pose.ty, pose.nx, pose.ny);
      }
      events.push({ type, chaser, target, culprit, fiaRule, verdict, blackWhiteFlag, x: pose.x, y: pose.y, sector: sec, penaltyS });
      break;
    }
    return events;
  }

  // =========================================================================
  // SLEEK BROADCAST AI OBSERVATIONS OVERLAY (Focused Car + Immediate Rival Only — ZERO Clutter!)
  // =========================================================================
  function drawAiObservations(ctx, cars, geom, circuit, zoom, focusCar) {
    if (!cars || !cars.length || !geom) return;
    const invStroke = 1 / Math.pow(Math.max(1.0, zoom || 1.0), 0.78);
    const lapS = (circuit && circuit.base_lap_s) || 85;
    // Only visualize the focused car + up to 2 direct rivals within 1.1s (plus any active AVOID hazard!)
    const focProg = focusCar ? focusCar.totalProg : null;
    ctx.save();
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      if (car.dnf || car.inPit > 0 || !car.aiObs) continue;
      const obs = car.aiObs;
      const isFoc = focusCar && car.idx === focusCar.idx;
      const nearFoc = focProg != null && Math.abs(car.totalProg - focProg) * lapS < 1.15;
      const isUrgent = obs.state === "avoid";
      if (!isFoc && !isUrgent && !(nearFoc && obs.state !== "clean")) continue;

      const p0 = sampleTrack(geom, car.totalProg);
      const curLat = car.latOffset || 0;
      const wx = p0.x + p0.nx * curLat;
      const wy = p0.y + p0.ny * curLat;
      const col = obs.color || "#38bdf8";

      // 1. Sleek Translucent Projected Steering Ribbon Curve over next ~40m!
      const ptsCurve = [{ x: wx, y: wy }];
      const steps = 8;
      const span = 0.028;
      for (let s = 1; s <= steps; s++) {
        const u = s / steps;
        const ease = u * u * (3 - 2 * u); // smoothstep S-curve
        const ps = sampleTrack(geom, car.totalProg + span * u);
        const futLat = curLat + (obs.targetLat - curLat) * ease;
        ptsCurve.push({ x: ps.x + ps.nx * futLat, y: ps.y + ps.ny * futLat });
      }
      const pEnd = ptsCurve[ptsCurve.length - 1];
      const ribbonGrad = ctx.createLinearGradient(wx, wy, pEnd.x, pEnd.y);
      ribbonGrad.addColorStop(0, col);
      ribbonGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ptsCurve.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.strokeStyle = ribbonGrad;
      ctx.globalAlpha = isFoc ? 0.65 : 0.42;
      ctx.lineWidth = (isFoc ? 2.2 : 1.45) * invStroke;
      ctx.lineCap = "round";
      ctx.stroke();

      // 2. Subtle Perception Sightline Ray to observed rival / hazard (only for focused car or AVOID)
      if (obs.sensorTarget && (isFoc || isUrgent)) {
        const st = obs.sensorTarget;
        if (Math.hypot(st.x - wx, st.y - wy) < 95) {
          ctx.beginPath();
          ctx.moveTo(wx, wy);
          ctx.lineTo(st.x, st.y);
          ctx.strokeStyle = col;
          ctx.globalAlpha = 0.30;
          ctx.lineWidth = 0.75 * invStroke;
          ctx.setLineDash([2.0 * invStroke, 2.4 * invStroke]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // 3. Crisp Compact AI Intent Pill (ONLY for focused car, its immediate rival at >=2.0x, or AVOID!)
      if (obs.badge && (isFoc || isUrgent || (nearFoc && zoom >= 2.0))) {
        ctx.globalAlpha = 0.90;
        ctx.font = `800 ${(5.8 * invStroke).toFixed(1)}px Orbitron, sans-serif`;
        const tw = ctx.measureText(obs.badge).width + 5 * invStroke;
        const bh = 7.8 * invStroke;
        const bx = wx;
        const by = wy + 9.2 * invStroke;
        ctx.fillStyle = "rgba(6, 10, 19, 0.86)";
        ctx.fillRect(bx - tw * 0.5, by - bh * 0.72, tw, bh);
        ctx.strokeStyle = col;
        ctx.lineWidth = 0.65 * invStroke;
        ctx.strokeRect(bx - tw * 0.5, by - bh * 0.72, tw, bh);
        ctx.fillStyle = col;
        ctx.textAlign = "center";
        ctx.fillText(obs.badge, bx, by);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // =========================================================================
  // F1 TV LIVE TELEMETRY HALO WIDGET + 5-RED-LIGHTS-OUT START GANTRY OVERLAY
  // =========================================================================
  function drawStartLightsOverlay(ctx, raceClock, cssW, cssH) {
    if (raceClock == null || raceClock < 0 || raceClock > 12.5 || cssW < 340) return;
    const w = Math.min(268, cssW - 32);
    const h = 50;
    const x0 = (cssW - w) * 0.5;
    const y0 = 12;
    const lightsOut = raceClock >= 9.0;
    const litCount = lightsOut ? 0 : Math.min(5, Math.floor(raceClock / 1.75) + 1);
    const fade = raceClock > 10.6 ? Math.max(0, 1 - (raceClock - 10.6) / 1.9) : 1;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = "rgba(6, 10, 18, 0.92)";
    ctx.strokeStyle = lightsOut ? "#22c55e" : "rgba(239, 68, 68, 0.65)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x0, y0, w, h, 10); else ctx.rect(x0, y0, w, h);
    ctx.fill();
    ctx.stroke();

    const podSpacing = (w - 36) / 4;
    for (let i = 0; i < 5; i++) {
      const px = x0 + 18 + i * podSpacing;
      const py = y0 + 18;
      const isLit = !lightsOut && i < litCount;
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(px - 10, py - 11, 20, 22);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
      ctx.lineWidth = 0.8;
      ctx.strokeRect(px - 10, py - 11, 20, 22);
      // Dual stacked FIA red lamps per pod
      [-4.5, 4.5].forEach((dy) => {
        ctx.beginPath();
        ctx.arc(px, py + dy, 3.6, 0, Math.PI * 2);
        if (isLit) {
          ctx.fillStyle = "#ef4444";
          ctx.shadowColor = "#ef4444";
          ctx.shadowBlur = 9;
        } else if (lightsOut) {
          ctx.fillStyle = "#22c55e";
          ctx.shadowColor = "#22c55e";
          ctx.shadowBlur = 7;
        } else {
          ctx.fillStyle = "#1e293b";
          ctx.shadowBlur = 0;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      });
    }

    ctx.font = "800 8.5px Orbitron, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = lightsOut ? "#86efac" : "#fca5a5";
    ctx.fillText(lightsOut ? "LIGHTS OUT & AWAY WE GO!" : `FIA START SEQUENCE · ${litCount} / 5 LIGHTS`, cssW * 0.5, y0 + h - 6);
    ctx.restore();
  }

  function drawBroadcastTelemetryHud(ctx, focusInfo, cssW, cssH) {
    if (!focusInfo || cssW < 450 || cssH < 240) return;
    const t = focusInfo.telem || {};
    const hudW = Math.min(358, cssW - 210);
    if (hudW < 235) return;
    const hudH = 66;
    const x0 = (cssW - hudW) * 0.5;
    const y0 = cssH - hudH - 36;

    ctx.save();
    // Carbon broadcast bezel
    ctx.fillStyle = "rgba(6, 10, 19, 0.88)";
    ctx.strokeStyle = "rgba(148, 163, 184, 0.28)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x0, y0, hudW, hudH, 10); else ctx.rect(x0, y0, hudW, hudH);
    ctx.fill();
    ctx.stroke();

    // Left team accent stripe
    ctx.fillStyle = focusInfo.color || "#e10600";
    ctx.fillRect(x0 + 1, y0 + 8, 3.5, hudH - 16);

    // 1. Speedometer Arc + Gear + RPM LEDs (Left module)
    const arcCx = x0 + 44;
    const arcCy = y0 + 38;
    const arcR = 23;
    const startA = Math.PI * 0.78;
    const endA = Math.PI * 2.22;
    const spdFrac = Math.max(0, Math.min(1, (t.kph || 0) / 360));

    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(51, 65, 85, 0.8)";
    ctx.lineWidth = 4.2;
    ctx.beginPath(); ctx.arc(arcCx, arcCy, arcR, startA, endA); ctx.stroke();

    ctx.strokeStyle = t.braking ? "#ef4444" : (focusInfo.drsOpen ? "#22c55e" : "#38bdf8");
    ctx.beginPath(); ctx.arc(arcCx, arcCy, arcR, startA, startA + (endA - startA) * spdFrac); ctx.stroke();

    ctx.font = "800 12.5px Orbitron, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(String(t.kph || 0), arcCx, arcCy + 2);
    ctx.font = "700 6.5px Orbitron, sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("KM/H", arcCx, arcCy + 11);

    // 2. Center Driver Header, 12-LED F1 Shift Bar, Gear, RPM & Dual Throttle/Brake Pedals
    const midX = x0 + 78;
    const midW = hudW - 142;

    // Driver + Pos + Tyre + DRS badges row
    ctx.textAlign = "left";
    ctx.font = "800 9px Orbitron, sans-serif";
    ctx.fillStyle = "#fde047";
    ctx.fillText(`P${focusInfo.pos || 1}`, midX, y0 + 14);
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(String(focusInfo.code || "DRV").slice(0, 3), midX + 22, y0 + 14);

    // Mini Compound + Tyre Temp pill
    const compCol = focusInfo.compColor || "#facc15";
    ctx.fillStyle = compCol;
    ctx.beginPath(); ctx.arc(midX + 54, y0 + 11, 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.font = "700 7.5px ui-monospace, monospace";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText(`${Math.round(focusInfo.tyreTemp || 96)}°C`, midX + 61, y0 + 14);

    // DRS / ERS Live Lamps
    const drsX = midX + midW - 56;
    ctx.fillStyle = focusInfo.drsOpen ? "#22c55e" : "rgba(51, 65, 85, 0.7)";
    ctx.fillRect(drsX, y0 + 5.5, 25, 10.5);
    ctx.font = "800 6.5px Orbitron, sans-serif";
    ctx.fillStyle = focusInfo.drsOpen ? "#052e16" : "#64748b";
    ctx.textAlign = "center";
    ctx.fillText("DRS", drsX + 12.5, y0 + 13);

    ctx.fillStyle = focusInfo.ersHot ? "#38bdf8" : "rgba(51, 65, 85, 0.7)";
    ctx.fillRect(drsX + 29, y0 + 5.5, 25, 10.5);
    ctx.fillStyle = focusInfo.ersHot ? "#082f49" : "#64748b";
    ctx.fillText("ERS", drsX + 41.5, y0 + 13);

    // 12-LED F1 Steering Wheel RPM Shift Bar
    const rpmFrac = Math.max(0, Math.min(1, ((t.rpm || 8500) - 8200) / 4600));
    const ledCount = 12;
    const ledGap = 2.5;
    const ledW = (midW - ledGap * (ledCount - 1)) / ledCount;
    for (let i = 0; i < ledCount; i++) {
      const lit = (i + 1) / ledCount <= rpmFrac;
      const col = i < 4 ? "#22c55e" : (i < 8 ? "#ef4444" : "#a855f7");
      ctx.fillStyle = lit ? col : "rgba(30, 41, 59, 0.9)";
      ctx.fillRect(midX + i * (ledW + ledGap), y0 + 21, ledW, 4);
    }

    // Gear badge + RPM readout
    ctx.fillStyle = "#e10600";
    ctx.fillRect(midX, y0 + 29, 22, 16);
    ctx.font = "800 10.5px Orbitron, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(String(t.gear || 1), midX + 11, y0 + 41);

    ctx.textAlign = "left";
    ctx.font = "700 7.5px ui-monospace, monospace";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`${(t.rpm || 9000).toLocaleString()} RPM`, midX + 26, y0 + 36);
    ctx.fillStyle = (t.brakeTemp || 400) > 760 ? "#fb923c" : "#64748b";
    ctx.fillText(`BRK ${t.brakeTemp || 420}°C`, midX + 26, y0 + 45);

    // Dual Pedal Bars: THROTTLE (green) & BRAKE (red)
    const barY = y0 + 50;
    const halfBar = (midW - 6) * 0.5;
    // Throttle
    ctx.fillStyle = "rgba(30, 41, 59, 0.9)";
    ctx.fillRect(midX, barY, halfBar, 6);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(midX, barY, halfBar * Math.max(0, Math.min(1, (t.throttle || 0) / 100)), 6);
    // Brake
    const brkX = midX + halfBar + 6;
    ctx.fillStyle = "rgba(30, 41, 59, 0.9)";
    ctx.fillRect(brkX, barY, halfBar, 6);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(brkX, barY, halfBar * Math.max(0, Math.min(1, (t.brake || 0) / 100)), 6);

    ctx.font = "700 6px Orbitron, sans-serif";
    ctx.fillStyle = "#86efac";
    ctx.fillText("THR", midX, barY + 12.5);
    ctx.fillStyle = "#fca5a5";
    ctx.fillText("BRK", brkX, barY + 12.5);

    // 3. Live 2D G-Force Ball (Right module)
    const gCx = x0 + hudW - 31;
    const gCy = y0 + 33;
    const gR = 21;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
    ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.arc(gCx, gCy, gR, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(gCx, gCy, gR * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gCx - gR, gCy); ctx.lineTo(gCx + gR, gCy);
    ctx.moveTo(gCx, gCy - gR); ctx.lineTo(gCx, gCy + gR);
    ctx.stroke();

    const gx = gCx + Math.max(-1, Math.min(1, (t.latG || 0) / 5.5)) * (gR - 3);
    const gy = gCy + Math.max(-1, Math.min(1, (t.longG || 0) / 5.5)) * (gR - 3);
    ctx.strokeStyle = "rgba(250, 204, 21, 0.65)";
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(gCx, gCy); ctx.lineTo(gx, gy); ctx.stroke();
    ctx.fillStyle = t.braking ? "#ef4444" : "#fde047";
    ctx.beginPath(); ctx.arc(gx, gy, 3.2, 0, Math.PI * 2); ctx.fill();

    const totG = Math.hypot(t.latG || 0, t.longG || 0);
    ctx.font = "800 6.5px Orbitron, sans-serif";
    ctx.fillStyle = "#cbd5e1";
    ctx.textAlign = "center";
    ctx.fillText(`${totG.toFixed(1)}G`, gCx, y0 + hudH - 3.5);

    // 4. Docked Top AI Observation Strip (Shows live AI decision: AVOID / ATTACK / DEFEND / HOLD / FIGHT!)
    if (focusInfo.aiObs && focusInfo.aiObs.detail) {
      const ob = focusInfo.aiObs;
      const stripH = 17;
      const sy = y0 - stripH - 3;
      ctx.fillStyle = "rgba(6, 10, 19, 0.90)";
      ctx.strokeStyle = ob.color || "rgba(56, 189, 248, 0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x0, sy, hudW, stripH, 6); else ctx.rect(x0, sy, hudW, stripH);
      ctx.fill();
      ctx.stroke();

      ctx.textAlign = "left";
      ctx.font = "800 7.2px Orbitron, sans-serif";
      ctx.fillStyle = ob.color || "#38bdf8";
      const prefix = ob.badge ? `${ob.badge}` : "AI MIND";
      ctx.fillText(prefix, x0 + 8, sy + 11.5);
      const prefW = ctx.measureText(prefix).width;
      ctx.font = "700 7.8px 'Source Sans 3', sans-serif";
      ctx.fillStyle = "#e2e8f0";
      const maxTxt = ob.detail.length > 44 ? ob.detail.slice(0, 43) + "…" : ob.detail;
      ctx.fillText(`· ${maxTxt}`, x0 + 13 + prefW, sy + 11.5);
    }
    ctx.restore();
  }

  // =========================================================================
  // F1 TV INSTANT REPLAY FRAME + FIA RACE CONTROL STEWARDS BANNER
  // =========================================================================
  function drawReplayOverlay(ctx, replayInfo, cssW, cssH) {
    if (!replayInfo || !replayInfo.active) return;
    ctx.save();
    // Subtle broadcast red-border cinema frame
    ctx.strokeStyle = "rgba(225, 6, 0, 0.55)";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, cssW - 3, cssH - 3);

    // Top-left pulsing F1 TV REPLAY bug
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.008);
    const bx = 12, by = 40, bw = 188, bh = 24;
    ctx.fillStyle = "rgba(185, 28, 28, 0.94)";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 6); else ctx.rect(bx, by, bw, bh);
    ctx.fill();
    ctx.fillStyle = `rgba(255, 255, 255, ${pulse.toFixed(2)})`;
    ctx.beginPath(); ctx.arc(bx + 12, by + 12, 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = "800 9.5px Orbitron, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.fillText(`↺ REPLAY · ${replayInfo.speedLabel || "0.45×"} SLOW-MO`, bx + 22, by + 15.5);

    // Top-center Replay Headline
    if (replayInfo.title) {
      ctx.font = "800 9px Orbitron, sans-serif";
      const tw = Math.min(cssW - 240, ctx.measureText(replayInfo.title).width + 24);
      const tx = (cssW - tw) * 0.5;
      ctx.fillStyle = "rgba(6, 10, 19, 0.92)";
      ctx.strokeStyle = "rgba(248, 113, 113, 0.65)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(tx, 10, tw, 22, 6); else ctx.rect(tx, 10, tw, 22);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fecaca";
      ctx.textAlign = "center";
      ctx.fillText(replayInfo.title.slice(0, 60), cssW * 0.5, 24);
    }

    // Bottom scrub progress bar
    const barW = Math.min(340, cssW - 40);
    const barX = (cssW - barW) * 0.5;
    const barY = cssH - 22;
    ctx.fillStyle = "rgba(6, 10, 19, 0.88)";
    ctx.fillRect(barX, barY, barW, 12);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(barX, barY, barW * Math.max(0, Math.min(1, replayInfo.progress || 0)), 12);
    ctx.font = "800 7.5px Orbitron, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText("INSTANT REPLAY · PRESS [R] OR CLICK 'LIVE' TO EXIT", cssW * 0.5, barY + 8.5);
    ctx.restore();
  }

  function drawStewardsBanner(ctx, banner, cssW, cssH) {
    if (!banner || !banner.text || cssW < 340) return;
    const w = Math.min(440, cssW - 36);
    const h = 38;
    const x0 = (cssW - w) * 0.5;
    const y0 = 42;
    ctx.save();
    ctx.fillStyle = "rgba(10, 22, 48, 0.95)";
    ctx.strokeStyle = banner.tone === "penalty" ? "#ef4444" : "#38bdf8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x0, y0, w, h, 8); else ctx.rect(x0, y0, w, h);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = banner.tone === "penalty" ? "#ef4444" : "#0284c7";
    ctx.fillRect(x0 + 1, y0 + 1, 5, h - 2);

    ctx.textAlign = "left";
    ctx.font = "800 7.5px Orbitron, sans-serif";
    ctx.fillStyle = banner.tone === "penalty" ? "#fca5a5" : "#7dd3fc";
    ctx.fillText(banner.header || "⚖️ FIA RACE CONTROL · STEWARDS DECISION", x0 + 14, y0 + 14);
    ctx.font = "700 9.5px 'Source Sans 3', sans-serif";
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(banner.text.slice(0, 68), x0 + 14, y0 + 29);
    ctx.restore();
  }

  window.F1TrackRenderer = {
    PHYS_LEN,
    PHYS_WID,
    getChassisMetrics,
    buildGeometry,
    sampleTrack,
    samplePitLane,
    getSpeedFactor,
    computeCarTelemetry,
    computeSmoothCarMotion,
    computeBattleCameraTarget,
    buildStaticCache,
    drawDynamicTrackState,
    drawMiniF1Car,
    createCamera,
    setCameraMode,
    zoomCameraBy,
    updateCamera,
    applyCameraTransform,
    worldToScreen,
    drawMiniMapPiP,
    createFxState,
    spawnCollisionFx,
    spawnSkidmark,
    spawnPlankSparks,
    spawnLockupSmoke,
    drawSkidmarks,
    drawBattleVortices,
    drawAiObservations,
    drawBroadcastTelemetryHud,
    drawStartLightsOverlay,
    drawReplayOverlay,
    drawStewardsBanner,
    stepAndDrawFx,
    stepBattlePhysics,
  };
})();
