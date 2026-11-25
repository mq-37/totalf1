/**
 * Apex POV (/drive) — 120 Hz Fixed-Timestep Pacejka-Inspired F1 Vehicle Dynamics Engine.
 *
 * Pure JS (zero DOM/Three.js dependencies) so it runs identically at 120 Hz in the browser
 * and headlessly in Node automated physics tests.
 *
 * Key subsystems:
 *   1. C2 Catmull-Rom Track Spline + Analytical 2-Pass Forward/Backward Optimal Speed Envelope
 *   2. Exact O(1) Track-Frame Projection (s, n, surface, DRS zones, sectors, pit trigger)
 *   3. Multi-Era Powertrain (5..8 gears, torque curve, MGU-K ERS 4 MJ/lap, DRS & 2026 Active Aero)
 *   4. Pacejka Magic Formula Lateral Grip + Combined-Slip Friction Circle + Wet Aquaplaning
 *   5. Surface vs Core Tyre Thermals, Wear Cliff, Fuel Mass & Front-Wing Damage Understeer
 *   6. Tunable EA F1-Style Sim-Cade Assists (TC Full/Med/Off, ABS, Auto-Shift, Braking Assist)
 *   7. 4-DOF Chassis Pitch/Roll/Heave, Plank Bottoming Sparks & Glancing Barrier Collisions
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.F1DrivePhysics = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const FIXED_DT = 1 / 120;
  const GRAVITY = 9.81;
  const AIR_RHO = 1.225;
  const FRONTAL_AREA = 1.52;
  const TRACK_HALF_WIDTH = 7.4;   // meters (FIA ~14.8m wide asphalt)
  const KERB_OUTER = 9.0;         // meters
  const BARRIER_HALF_WIDTH = 15.8;// meters

  const DEFAULT_COMPOUNDS = {
    soft:   { code: "S", name: "Soft",         color: "#ef4444", grip: 1.045, wear_rate: 1.45, opt_temp: 100, wet_grip: 0.42 },
    medium: { code: "M", name: "Medium",       color: "#facc15", grip: 1.000, wear_rate: 1.00, opt_temp: 96,  wet_grip: 0.44 },
    hard:   { code: "H", name: "Hard",         color: "#f8fafc", grip: 0.965, wear_rate: 0.66, opt_temp: 92,  wet_grip: 0.45 },
    inter:  { code: "I", name: "Intermediate", color: "#22c55e", grip: 0.910, wear_rate: 0.95, opt_temp: 84,  wet_grip: 0.88 },
    wet:    { code: "W", name: "Full Wet",     color: "#3b82f6", grip: 0.855, wear_rate: 0.78, opt_temp: 76,  wet_grip: 0.96 },
  };

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
      (2 * p1)
      + (-p0 + p2) * t
      + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
      + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
  }

  // ---------------------------------------------------------------------------
  // 1. Track Spline + Analytical Racing-Line Speed Envelope
  // ---------------------------------------------------------------------------
  function buildDriveTrack(circuit, physicsDna, archElevFn) {
    const raw = (circuit && Array.isArray(circuit.points) && circuit.points.length >= 6)
      ? circuit.points
      : [
          [0, 0], [30, 0], [60, 0], [85, 10], [95, 32],
          [85, 55], [60, 62], [30, 62], [8, 52], [-4, 30],
        ];
    const nRaw = raw.length;
    let perim = 0, cx = 0, cz = 0;
    for (let i = 0; i < nRaw; i++) {
      const a = raw[i], b = raw[(i + 1) % nRaw];
      perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
      cx += a[0]; cz += a[1];
    }
    cx /= nRaw; cz /= nRaw;

    // Match F1VehiclePhysics world scale so 3D world & physics share identical coordinates!
    const lengthKm = Number((circuit && circuit.length_km) || 5.0);
    const targetPerimM = clamp(lengthKm * 660, 2400, 5400);
    const scale = targetPerimM / Math.max(10, perim);

    const subPerSeg = clamp(Math.round(720 / nRaw), 4, 12);
    const pts = [];
    for (let i = 0; i < nRaw; i++) {
      const p0 = raw[(i - 1 + nRaw) % nRaw];
      const p1 = raw[i];
      const p2 = raw[(i + 1) % nRaw];
      const p3 = raw[(i + 2) % nRaw];
      for (let k = 0; k < subPerSeg; k++) {
        const t = k / subPerSeg;
        pts.push({
          x: (catmullRom(p0[0], p1[0], p2[0], p3[0], t) - cx) * scale,
          z: (catmullRom(p0[1], p1[1], p2[1], p3[1], t) - cz) * scale,
          y: 0,
          tx: 1, tz: 0, rx: 0, rz: 1,
          curv: 0,
          s: 0,
          prog: 0,
          slopePitch: 0,
          bankRad: 0,
          vTarget: 90,
          optLat: 0,
          drsZone: false,
        });
      }
    }

    const n = pts.length;
    let totalLen = 0;
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const cur = pts[i];
      const next = pts[(i + 1) % n];
      if (i > 0) totalLen += Math.hypot(cur.x - prev.x, cur.z - prev.z);
      cur.s = totalLen;
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const l = Math.max(1e-5, Math.hypot(dx, dz));
      cur.tx = dx / l;
      cur.tz = dz / l;
    }
    totalLen += Math.hypot(pts[0].x - pts[n - 1].x, pts[0].z - pts[n - 1].z);

    // Smooth tangents (2 passes)
    for (let pass = 0; pass < 2; pass++) {
      const txc = pts.map((p) => p.tx);
      const tzc = pts.map((p) => p.tz);
      for (let i = 0; i < n; i++) {
        const im = (i - 1 + n) % n, ip = (i + 1) % n;
        const tx = txc[im] * 0.25 + txc[i] * 0.5 + txc[ip] * 0.25;
        const tz = tzc[im] * 0.25 + tzc[i] * 0.5 + tzc[ip] * 0.25;
        const l = Math.max(1e-5, Math.hypot(tx, tz));
        pts[i].tx = tx / l;
        pts[i].tz = tz / l;
      }
    }

    const drsRanges = (circuit && Array.isArray(circuit.drs_ranges)) ? circuit.drs_ranges : [[0.88, 0.99]];

    for (let i = 0; i < n; i++) {
      const p = pts[i];
      p.prog = p.s / Math.max(1, totalLen);
      p.rx = -p.tz;
      p.rz = p.tx;
      const prev = pts[(i - 2 + n) % n];
      const next = pts[(i + 2) % n];
      const ds = Math.max(1.0, Math.hypot(next.x - prev.x, next.z - prev.z));
      const cross = prev.tx * next.tz - prev.tz * next.tx;
      p.curv = clamp(cross / ds, -0.048, 0.048);

      if (typeof archElevFn === "function") {
        const topo = archElevFn(circuit, p.prog) || {};
        p.y = Number(topo.y || 0);
        p.slopePitch = Number(topo.slopePitch || 0);
        p.bankRad = Number(topo.bankRad || 0);
      }

      p.drsZone = drsRanges.some(([a, b]) => (a <= b ? (p.prog >= a && p.prog <= b) : (p.prog >= a || p.prog <= b)));
    }

    // Smooth curvature slightly for clean optimal racing line & braking envelope
    const rawCurv = pts.map((p) => p.curv);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) sum += rawCurv[(i + k + n) % n];
      pts[i].curv = sum / 5;
      // Outside-inside-outside racing line offset (apex hugging inside of curve!)
      pts[i].optLat = clamp(-pts[i].curv * 260, -4.6, 4.6);
    }

    // Analytical 2-pass forward/backward optimal speed envelope (m/s)
    const dna = physicsDna || {};
    const vMaxMps = Number(dna.top_speed_kph || 345) / 3.6;
    const muEff = Number(dna.tyre_mu_base || 2.0) * 1.15;
    const clEff = Number(dna.cl_base || 3.6);
    const massKg = Number(dna.mass_kg || 775);
    const aBrake = Number(dna.brake_max_g || 4.8) * GRAVITY * 0.86;
    const aAccel = clamp((Number(dna.max_power_kw || 620) * 1000) / (massKg * 32), 6.5, 16.5);

    for (let i = 0; i < n; i++) {
      const absC = Math.abs(pts[i].curv);
      if (absC < 0.0005) {
        pts[i].vTarget = vMaxMps;
      } else {
        // Solve mu * (m*g + 0.5*rho*Cl*A*v^2) = m * v^2 * |curv|
        const aeroTerm = (0.5 * AIR_RHO * clEff * FRONTAL_AREA * muEff) / massKg;
        const denom = Math.max(0.0004, absC - aeroTerm * 0.72);
        const vCorner = Math.sqrt((muEff * GRAVITY) / denom);
        pts[i].vTarget = clamp(vCorner, 18.0, vMaxMps);
      }
    }
    // Backward braking pass (2 laps wrap-around so S/F line is continuous!)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const next = pts[(i + 1) % n];
        const ds = Math.max(0.5, Math.hypot(next.x - pts[i].x, next.z - pts[i].z));
        const vAllow = Math.sqrt(next.vTarget * next.vTarget + 2 * aBrake * ds);
        if (vAllow < pts[i].vTarget) pts[i].vTarget = vAllow;
      }
      // Forward acceleration pass
      for (let i = 0; i < n; i++) {
        const prev = pts[(i - 1 + n) % n];
        const ds = Math.max(0.5, Math.hypot(pts[i].x - prev.x, pts[i].z - prev.z));
        const vAllow = Math.sqrt(prev.vTarget * prev.vTarget + 2 * aAccel * ds);
        if (vAllow < pts[i].vTarget) pts[i].vTarget = vAllow;
      }
    }

    function sample(prog) {
      const p = (((prog % 1) + 1) % 1) * n;
      const i0 = Math.floor(p) % n;
      const i1 = (i0 + 1) % n;
      const f = p - Math.floor(p);
      const a = pts[i0], b = pts[i1];
      const tx = a.tx + (b.tx - a.tx) * f;
      const tz = a.tz + (b.tz - a.tz) * f;
      const l = Math.max(1e-5, Math.hypot(tx, tz));
      const ntx = tx / l, ntz = tz / l;
      return {
        idx: i0,
        prog: ((prog % 1) + 1) % 1,
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        z: a.z + (b.z - a.z) * f,
        tx: ntx,
        tz: ntz,
        rx: -ntz,
        rz: ntx,
        curv: a.curv + (b.curv - a.curv) * f,
        slopePitch: a.slopePitch + (b.slopePitch - a.slopePitch) * f,
        bankRad: a.bankRad + (b.bankRad - a.bankRad) * f,
        vTarget: a.vTarget + (b.vTarget - a.vTarget) * f,
        optLat: a.optLat + (b.optLat - a.optLat) * f,
        drsZone: a.drsZone,
      };
    }

    function project(x, z, hintIdx) {
      let bestI = 0;
      let bestD2 = Infinity;
      if (hintIdx != null && hintIdx >= 0 && hintIdx < n) {
        const win = 18;
        for (let off = -win; off <= win; off++) {
          const i = (hintIdx + off + n) % n;
          const dx = x - pts[i].x;
          const dz = z - pts[i].z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2) { bestD2 = d2; bestI = i; }
        }
      }
      if (bestD2 > 1800) {
        // Full scan fallback if car jumped/reset
        for (let i = 0; i < n; i++) {
          const dx = x - pts[i].x;
          const dz = z - pts[i].z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2) { bestD2 = d2; bestI = i; }
        }
      }
      const p = pts[bestI];
      const dx = x - p.x;
      const dz = z - p.z;
      const along = dx * p.tx + dz * p.tz;
      const lat = dx * p.rx + dz * p.rz;
      const sEst = (p.s + along + totalLen) % totalLen;
      const prog = sEst / Math.max(1, totalLen);
      const absLat = Math.abs(lat);
      let surface = "asphalt";
      if (absLat > BARRIER_HALF_WIDTH) surface = "barrier";
      else if (absLat > KERB_OUTER) surface = "runoff";
      else if (absLat > TRACK_HALF_WIDTH) surface = "kerb";
      return {
        idx: bestI,
        prog,
        s: sEst,
        lat,
        surface,
        node: p,
      };
    }

    return { pts, n, totalLen, lengthKm, sample, project };
  }

  // ---------------------------------------------------------------------------
  // 2. Pacejka Magic Formula Helper + Gearbox Ratios
  // ---------------------------------------------------------------------------
  function pacejkaFy(alphaRad, fzN, muPeak) {
    // Simplified Magic Formula tuned for crisp sim-cade F1 tyres (peak around ~9-11 deg slip)
    const B = 10.5;
    const C = 1.48;
    const E = 0.25;
    const Bx = B * alphaRad;
    return fzN * muPeak * Math.sin(C * Math.atan(Bx - E * (Bx - Math.atan(Bx))));
  }

  function buildGearTopSpeedsMps(gearsCount, topSpeedKph) {
    const vMax = Number(topSpeedKph || 345) / 3.6;
    const g = clamp(Math.round(gearsCount || 8), 5, 8);
    const out = [0]; // index 0 = neutral
    for (let i = 1; i <= g; i++) {
      // Progressive F1 ratio spacing: 1st ~34% vMax -> top gear 104% vMax
      const frac = 0.31 + 0.73 * Math.pow((i - 1) / (g - 1), 0.88);
      out.push(vMax * frac);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // 3. Create Player Car Physics State
  // ---------------------------------------------------------------------------
  function createCarState(track, physicsDna, opts) {
    const o = opts || {};
    const dna = Object.assign({
      era_key: "2026",
      max_power_kw: 560,
      ers_power_kw: 210,
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
      top_speed_kph: 355,
      brake_max_g: 5.15,
      tyre_mu_base: 2.02,
    }, physicsDna || {});

    const startProg = (((Number(o.startProg ?? 0.992)) % 1) + 1) % 1;
    const startLat = Number(o.startLat || 0);
    const sp = track.sample(startProg);
    const startYaw = Math.atan2(sp.tx, sp.tz);

    const compound = (o.compound && DEFAULT_COMPOUNDS[o.compound]) ? o.compound : "soft";
    const cDef = DEFAULT_COMPOUNDS[compound];
    const gearTops = buildGearTopSpeedsMps(dna.gears, dna.top_speed_kph);

    return {
      dna,
      gearTops,
      // World & local kinematics
      x: sp.x + sp.rx * startLat,
      y: sp.y,
      z: sp.z + sp.rz * startLat,
      yaw: startYaw,
      vx: 0,     // local forward speed (m/s)
      vy: 0,     // local lateral speed (m/s, +right)
      yawRate: 0,
      speedKph: 0,
      steerWheelRad: 0, // visual steering wheel angle
      frontSteerRad: 0, // front tyre steer angle

      // Track frame
      trackIdx: sp.idx,
      prog: startProg,
      prevProg: startProg,
      lat: startLat,
      surface: "asphalt",
      lap: Number(o.startLap ?? 0), // 0 = approaching S/F line on start
      totalProg: Number(o.startLap ?? 0) + (startProg > 0.5 && (o.startLap ?? 0) === 0 ? startProg - 1 : startProg),
      sector: 1,
      lapTimeMs: 0,
      s1Ms: 0,
      s2Ms: 0,
      s3Ms: 0,
      bestLapMs: 0,
      lastLapMs: 0,
      lapInvalid: false,
      trackLimitStrikes: 0,
      penaltySec: 0,

      // Powertrain & Aero
      gear: 1,
      rpm: dna.idle_rpm,
      shiftCooldown: 0,
      ersBattery: 100.0,     // %
      ersLapDeployed: 0.0,   // MJ deployed this lap
      ersActive: false,
      drsAvailable: false,
      drsOpen: false,
      xModeActive: false,
      pitLimiter: false,
      inPit: false,
      pitTimerS: 0,
      fuelKg: Number(o.fuelKg ?? 32.0),

      // Tyres & Brakes
      compound,
      tyreLife: 100.0,
      surfTemp: cDef.opt_temp - 6,
      coreTemp: cDef.opt_temp - 8,
      thermalCliff: false,
      brakeBias: 56,         // % front
      brakeTemp: 320,        // C
      lockingFront: false,
      wheelSpinRear: false,
      slipRatio: 0,
      frontWingHealth: 100,  // 0..100

      // 4-DOF Chassis feel
      pitchRad: 0,
      rollRad: 0,
      heaveY: 0.045,
      longG: 0,
      latG: 0,
      downforceKg: 0,
      bottoming: 0,
      wheelSpin: 0,

      // Telemetry / audio triggers
      justShifted: 0,        // +1 upshift, -1 downshift, 0 none
      impactStrength: 0,
      kerbIntensity: 0,
      tyreScrub: 0,
      inDirtyAir: false,
      inSlipstream: false,
      vTargetKph: Math.round(sp.vTarget * 3.6),

      // Live Lap Telemetry & Ghost capture
      lapSamples: [],
      sampleAccumS: 0,
      completedLaps: [],
    };
  }

  // ---------------------------------------------------------------------------
  // 4. Single 120 Hz Substep Solver
  // ---------------------------------------------------------------------------
  function stepPhysics(car, track, input, assists, env, dt) {
    const stepDt = dt || FIXED_DT;
    const dna = car.dna;
    const a = Object.assign({
      tc: "med",          // off | med | full
      abs: true,
      autoShift: true,
      brakeAssist: false,
      stability: true,
    }, assists || {});
    const e = Object.assign({
      wetness: 0,         // 0..100
      carsAhead: [],      // optional [{prog, lat, vx}] for dirty air / slipstream
      holdOnGrid: false,  // true during 5-red-lights before lights out
      drsAllowed: true,   // true in TT/Quali or when <1s behind in Race
      scLimitKph: 0,      // >0 if VSC/SC active
    }, env || {});

    car.justShifted = 0;
    car.impactStrength = 0;
    if (car.shiftCooldown > 0) car.shiftCooldown = Math.max(0, car.shiftCooldown - stepDt);

    // Pit Service stationary hold
    if (car.pitTimerS > 0) {
      car.pitTimerS = Math.max(0, car.pitTimerS - stepDt);
      car.vx *= Math.max(0, 1 - stepDt * 10);
      car.vy = 0;
      car.yawRate = 0;
      car.speedKph = Math.abs(car.vx) * 3.6;
      car.rpm = dna.idle_rpm + (input.throttle || 0) * 2800;
      if (car.pitTimerS <= 0) {
        car.tyreLife = 100;
        car.frontWingHealth = 100;
        const cDef = DEFAULT_COMPOUNDS[car.compound] || DEFAULT_COMPOUNDS.medium;
        car.surfTemp = cDef.opt_temp - 6;
        car.coreTemp = cDef.opt_temp - 8;
        car.inPit = false;
      }
      return car;
    }

    // Read normalized controls
    let throttle = clamp(Number(input.throttle || 0), 0, 1);
    let brake = clamp(Number(input.brake || 0), 0, 1);
    const steerIn = clamp(Number(input.steer || 0), -1, 1);
    if (input.togglePitLimiter) car.pitLimiter = !car.pitLimiter;

    // Grid Hold (standing start revs allowed, car clamped until lights out!)
    if (e.holdOnGrid) {
      car.vx = 0;
      car.vy = 0;
      car.yawRate = 0;
      car.speedKph = 0;
      car.gear = 1;
      const targetRpm = dna.idle_rpm + throttle * (dna.redline_rpm - dna.idle_rpm) * 0.88;
      car.rpm += (targetRpm - car.rpm) * Math.min(1, stepDt * 18);
      car.steerWheelRad = steerIn * 1.4;
      car.frontSteerRad = steerIn * 0.25;
      return car;
    }

    // Track projection
    const proj = track.project(car.x, car.z, car.trackIdx);
    car.trackIdx = proj.idx;
    car.prevProg = car.prog;
    car.prog = proj.prog;
    car.lat = proj.lat;
    car.surface = proj.surface;
    const node = proj.node;
    car.y = node.y;
    car.vTargetKph = Math.round(node.vTarget * 3.6);

    // Optional light Braking Assist (EA F1 style: trims excess speed approaching hairpins)
    if (a.brakeAssist && car.vx > node.vTarget * 1.07 && brake < 0.4) {
      const excess = clamp((car.vx - node.vTarget * 1.04) / 22.0, 0, 0.85);
      brake = Math.max(brake, excess);
      throttle *= (1 - excess * 0.85);
    }

    // Lap & Sector crossing detection
    const dProg = car.prog - car.prevProg;
    if (dProg < -0.5) {
      // Crossed Start/Finish line forward!
      if (car.lap >= 1 && car.lapTimeMs > 12000) {
        car.s3Ms = Math.max(0, Math.round(car.lapTimeMs - car.s1Ms - car.s2Ms));
        car.lastLapMs = Math.round(car.lapTimeMs);
        const valid = !car.lapInvalid;
        if (valid && (car.bestLapMs === 0 || car.lastLapMs < car.bestLapMs)) {
          car.bestLapMs = car.lastLapMs;
        }
        car.completedLaps.push({
          lap: car.lap,
          lapMs: car.lastLapMs,
          s1Ms: car.s1Ms,
          s2Ms: car.s2Ms,
          s3Ms: car.s3Ms,
          valid,
          samples: car.lapSamples.slice(),
        });
      }
      car.lap += 1;
      car.lapTimeMs = 0;
      car.s1Ms = 0;
      car.s2Ms = 0;
      car.s3Ms = 0;
      car.sector = 1;
      car.lapInvalid = false;
      car.ersLapDeployed = 0;
      car.lapSamples = [];
      car.sampleAccumS = 0;
    } else if (dProg > 0.5) {
      // Reversed across line
      car.lap = Math.max(0, car.lap - 1);
    }

    if (car.lap >= 1) {
      car.lapTimeMs += stepDt * 1000;
      if (car.sector === 1 && car.prog >= 0.333 && car.prog < 0.66) {
        car.s1Ms = Math.round(car.lapTimeMs);
        car.sector = 2;
      } else if (car.sector === 2 && car.prog >= 0.666) {
        car.s2Ms = Math.max(0, Math.round(car.lapTimeMs - car.s1Ms));
        car.sector = 3;
      }
    }
    car.totalProg = Math.max(0, car.lap - 1) + car.prog;

    // Dirty Air & Slipstream from cars immediately ahead
    car.inDirtyAir = false;
    car.inSlipstream = false;
    let nearestGapM = 999;
    if (Array.isArray(e.carsAhead)) {
      for (let i = 0; i < e.carsAhead.length; i++) {
        const oc = e.carsAhead[i];
        let dp = oc.prog - car.prog;
        if (dp < -0.5) dp += 1;
        if (dp > 0.5) dp -= 1;
        if (dp > 0 && dp < 0.03) {
          const distM = dp * track.totalLen;
          if (distM < nearestGapM && Math.abs((oc.lat || 0) - car.lat) < 3.4) {
            nearestGapM = distM;
          }
        }
      }
    }
    if (nearestGapM < 55 && car.vx > 30) {
      car.inDirtyAir = true;
      if (nearestGapM < 42 && Math.abs(node.curv) < 0.005) car.inSlipstream = true;
    }

    // DRS & 2026 Active Aero X-Mode
    car.drsAvailable = Boolean(dna.drs_enabled && node.drsZone && e.drsAllowed && e.wetness < 25 && car.vx > 32);
    if (input.drs && car.drsAvailable && brake < 0.08) {
      car.drsOpen = true;
    } else if (!car.drsAvailable || brake > 0.1 || Math.abs(steerIn) > 0.58) {
      car.drsOpen = false;
    }
    car.xModeActive = Boolean(dna.active_aero && Math.abs(node.curv) < 0.0035 && car.vx > 55 && brake < 0.05 && e.wetness < 35);

    // Manual / Auto Gearbox
    const maxGear = dna.gears || 8;
    if (!a.autoShift) {
      if (input.shiftUp && car.shiftCooldown <= 0 && car.gear < maxGear) {
        car.gear += 1;
        car.shiftCooldown = 0.14;
        car.justShifted = 1;
      } else if (input.shiftDown && car.shiftCooldown <= 0 && car.gear > 1) {
        car.gear -= 1;
        car.shiftCooldown = 0.14;
        car.justShifted = -1;
      }
    } else {
      const gTop = car.gearTops[car.gear] || 95;
      const gPrev = car.gear > 1 ? (car.gearTops[car.gear - 1] || 30) : 0;
      if (car.gear < maxGear && car.vx > gTop * 0.94 && car.shiftCooldown <= 0) {
        car.gear += 1;
        car.shiftCooldown = 0.16;
        car.justShifted = 1;
      } else if (car.gear > 1 && car.vx < gPrev * 0.78 && car.shiftCooldown <= 0) {
        car.gear -= 1;
        car.shiftCooldown = 0.16;
        car.justShifted = -1;
      }
    }

    // RPM calculation
    const curGTop = car.gearTops[car.gear] || 95;
    const prevGTop = car.gear > 1 ? (car.gearTops[car.gear - 1] || 22) * 0.68 : 0;
    const rpmFrac = clamp((car.vx - prevGTop) / Math.max(8, curGTop - prevGTop), 0, 1.04);
    const targetRpm = dna.idle_rpm + rpmFrac * (dna.redline_rpm - dna.idle_rpm);
    car.rpm += (clamp(targetRpm, dna.idle_rpm, dna.redline_rpm * 1.03) - car.rpm) * Math.min(1, stepDt * 30);

    // ERS MGU-K Deployment & Harvesting
    const hasErs = (dna.ers_power_kw || 0) > 0;
    const wantErs = Boolean(hasErs && input.ers && throttle > 0.35 && car.ersBattery > 2 && car.ersLapDeployed < (dna.ers_mj_lap || 4.0));
    car.ersActive = wantErs;
    if (wantErs) {
      const mjStep = ((dna.ers_power_kw * 1000) / 1e6) * stepDt;
      car.ersLapDeployed += mjStep;
      car.ersBattery = Math.max(0, car.ersBattery - mjStep * 22.0);
    } else if (hasErs && brake > 0.15 && car.vx > 18) {
      // MGU-K Braking Regen!
      car.ersBattery = Math.min(100, car.ersBattery + brake * stepDt * 9.5);
    } else if (hasErs && throttle < 0.2 && car.vx > 25) {
      car.ersBattery = Math.min(100, car.ersBattery + stepDt * 2.2);
    }

    // Aerodynamics (Downforce & Drag)
    const wingFactor = 0.65 + 0.35 * (car.frontWingHealth / 100);
    let cl = dna.cl_base * wingFactor;
    let cd = dna.cd_base;
    if (car.drsOpen) {
      cd *= (1 - (dna.drs_drag_cut || 0.24));
      cl *= 0.86;
    }
    if (car.xModeActive) {
      cd *= (1 - (dna.x_mode_drag_cut || 0.20));
      cl *= 0.72;
    }
    if (car.inDirtyAir) cl *= 0.88;
    if (car.inSlipstream) cd *= 0.89;

    const v2 = car.vx * car.vx;
    const downforceN = 0.5 * AIR_RHO * cl * FRONTAL_AREA * v2;
    const dragN = 0.5 * AIR_RHO * cd * FRONTAL_AREA * v2;
    car.downforceKg = Math.round(downforceN / GRAVITY);

    // Effective Tyre Compound Grip (Thermals + Wear + Wetness + Surface)
    const cDef = DEFAULT_COMPOUNDS[car.compound] || DEFAULT_COMPOUNDS.medium;
    const totalMass = dna.mass_kg + car.fuelKg;
    const totalFz = totalMass * GRAVITY + downforceN;

    // Tyre temp evolution
    const workHeat = (Math.abs(car.latG) * 3.8 + brake * 4.5 + throttle * 1.4) * clamp(car.vx / 45, 0, 1.3);
    const coolRate = (e.wetness > 20 ? 3.4 : 1.6) * clamp(car.vx / 55, 0.2, 1.2);
    const targetSurf = clamp(cDef.opt_temp - 14 + workHeat * 2.8 - coolRate * 1.6, 52, 138);
    car.surfTemp += (targetSurf - car.surfTemp) * Math.min(1, stepDt * 0.45);
    car.coreTemp += (car.surfTemp - car.coreTemp) * Math.min(1, stepDt * 0.14);
    car.thermalCliff = car.coreTemp > cDef.opt_temp + 14 || car.tyreLife < 22;

    const tempDiff = Math.abs(car.coreTemp - cDef.opt_temp);
    const tempGripMult = clamp(1.0 - Math.max(0, tempDiff - 10) * 0.0085, 0.72, 1.0);
    const wearGripMult = car.tyreLife > 30 ? (0.94 + (car.tyreLife / 100) * 0.06) : clamp(0.68 + (car.tyreLife / 30) * 0.26, 0.65, 0.94);

    // Wet grip interpolation
    const wetFrac = clamp(e.wetness / 100, 0, 1);
    const weatherGrip = cDef.grip * (1 - wetFrac) + cDef.wet_grip * wetFrac;

    // Surface multiplier
    let surfGrip = 1.0;
    let rollDragN = 280;
    car.kerbIntensity = 0;
    if (car.surface === "kerb") {
      surfGrip = 0.88;
      rollDragN = 520;
      car.kerbIntensity = clamp(car.vx / 55, 0, 1);
    } else if (car.surface === "runoff") {
      surfGrip = 0.52;
      rollDragN = 2600 + car.vx * 85;
      if (car.lap >= 1 && car.vx > 20) {
        if (!car.lapInvalid) {
          car.lapInvalid = true;
          car.trackLimitStrikes += 1;
          if (car.trackLimitStrikes % 3 === 0) car.penaltySec += 5;
        }
      }
    }

    const muPeak = dna.tyre_mu_base * weatherGrip * tempGripMult * wearGripMult * surfGrip;

    // Tyre Wear (scaled cleanly so 5-lap GP shows meaningful wear)
    const wearStep = cDef.wear_rate * (0.012 + Math.abs(car.latG) * 0.0045 + (car.thermalCliff ? 0.015 : 0)) * clamp(car.vx / 60, 0, 1.4) * stepDt;
    car.tyreLife = Math.max(5, car.tyreLife - wearStep);
    car.fuelKg = Math.max(1.5, car.fuelKg - throttle * 0.022 * stepDt);

    // Drive Force & Braking Force
    const powerW = (dna.max_power_kw + (car.ersActive ? dna.ers_power_kw : 0)) * 1000;
    const torqueBand = 0.76 + 0.24 * Math.sin(clamp(rpmFrac, 0.05, 1.0) * Math.PI);
    let driveForceN = throttle * (powerW * torqueBand) / Math.max(12.0, car.vx);
    // Pit Speed Limiter (80 KPH = 22.22 m/s) or SC Delta
    if (car.pitLimiter && car.vx > 22.2) {
      driveForceN = 0;
      brake = Math.max(brake, clamp((car.vx - 22.2) * 0.35, 0, 0.8));
    }
    if (car.vx > (dna.top_speed_kph / 3.6) * (car.drsOpen || car.xModeActive ? 1.045 : 1.0)) {
      driveForceN *= 0.15;
    }

    // Weight transfer (front/rear normal loads)
    const fzFrontBase = totalFz * (0.45 * wingFactor + 0.03);
    const fzRearBase = totalFz - fzFrontBase;
    const transferN = clamp(car.longG * totalMass * 0.28, -totalFz * 0.16, totalFz * 0.16);
    const fzFront = clamp(fzFrontBase - transferN, totalFz * 0.25, totalFz * 0.70);
    const fzRear = clamp(fzRearBase + transferN, totalFz * 0.25, totalFz * 0.75);

    // Traction Control (limits rear drive force to rear friction circle)
    const maxRearTractionN = fzRear * muPeak * 0.98;
    car.wheelSpinRear = false;
    if (driveForceN > maxRearTractionN) {
      if (a.tc === "full") {
        driveForceN = maxRearTractionN * 0.96;
      } else if (a.tc === "med") {
        driveForceN = maxRearTractionN * 0.99;
        car.wheelSpinRear = true;
      } else {
        car.wheelSpinRear = true;
        driveForceN = maxRearTractionN * 0.86; // spinning tyres lose traction!
      }
    }

    // Braking & ABS
    const maxBrakeForceN = totalMass * dna.brake_max_g * GRAVITY;
    let brakeForceN = brake * maxBrakeForceN;
    const maxGripBrakeN = totalFz * muPeak * 1.02;
    car.lockingFront = false;
    if (brakeForceN > maxGripBrakeN && car.vx > 14) {
      if (a.abs) {
        brakeForceN = maxGripBrakeN * 0.97;
      } else {
        car.lockingFront = true;
        brakeForceN = maxGripBrakeN * 0.84; // locked wheels lose grip & smoke!
      }
    }
    if (car.vx <= 0.3 && brake > 0.05) {
      brakeForceN = 0;
      car.vx = 0;
    }

    // Slope gravity component
    const slopeN = -totalMass * GRAVITY * Math.sin(node.slopePitch || 0);

    // Longitudinal acceleration
    const netFx = driveForceN - (car.vx > 0.1 ? brakeForceN : 0) - dragN - rollDragN + slopeN;
    const ax = netFx / totalMass;
    car.vx = Math.max(0, car.vx + ax * stepDt);
    car.longG = clamp(ax / GRAVITY, -6.0, 2.8);

    // Steering & Bicycle + Pacejka Lateral Dynamics
    const speedNorm = clamp(car.vx / 80, 0, 1);
    const maxSteerRad = 0.36 - speedNorm * 0.25; // speed-sensitive max wheel lock
    const targetSteer = steerIn * maxSteerRad;
    car.frontSteerRad += (targetSteer - car.frontSteerRad) * Math.min(1, stepDt * 22);
    car.steerWheelRad += (steerIn * 2.1 - car.steerWheelRad) * Math.min(1, stepDt * 18);

    const lf = 1.65;
    const lr = 1.75;
    const Iz = totalMass * 1.55;
    const vSafe = Math.max(4.5, car.vx);

    // Front & Rear slip angles (rad)
    const alphaF = Math.atan2(car.vy + lf * car.yawRate, vSafe) - car.frontSteerRad;
    const alphaR = Math.atan2(car.vy - lr * car.yawRate, vSafe);

    // Combined-slip lateral grip reduction when braking/accelerating hard
    const frontLatMult = car.lockingFront ? 0.55 : clamp(1.0 - brake * 0.18, 0.72, 1.0);
    const rearLatMult = car.wheelSpinRear ? (a.tc === "off" ? 0.58 : 0.82) : 1.0;

    const fyF = -pacejkaFy(alphaF, fzFront, muPeak * frontLatMult);
    const fyR = -pacejkaFy(alphaR, fzRear, muPeak * rearLatMult);

    const ay = (fyF + fyR) / totalMass - car.vx * car.yawRate;
    let yawAcc = (lf * fyF - lr * fyR) / Iz;
    // Gentle stability damper when assist is ON (prevents uncontrollable snap-spins on keyboard)
    if (a.stability) {
      yawAcc -= car.yawRate * (1.8 + speedNorm * 2.4);
    }

    if (car.vx < 1.2) {
      car.vy = 0;
      car.yawRate = 0;
    } else {
      car.vy = clamp(car.vy + ay * stepDt, -18, 18);
      car.yawRate = clamp(car.yawRate + yawAcc * stepDt, -2.8, 2.8);
      // High-speed lateral damping so car tracks cleanly out of corners
      car.vy *= Math.max(0, 1 - stepDt * (a.stability ? 2.2 : 0.7));
    }

    car.yaw = wrapAngle(car.yaw - car.yawRate * stepDt);
    car.latG = clamp(((fyF + fyR) / totalMass) / GRAVITY, -5.8, 5.8);
    car.tyreScrub = clamp((Math.max(Math.abs(alphaF), Math.abs(alphaR)) - 0.09) * 5.2, 0, 1) * clamp(car.vx / 28, 0, 1);

    // Integrate World Position (Three.js convention: forward = (sin yaw, cos yaw), right = (-cos yaw, sin yaw))
    const sinY = Math.sin(car.yaw);
    const cosY = Math.cos(car.yaw);
    const worldVx = car.vx * sinY - car.vy * cosY;
    const worldVz = car.vx * cosY + car.vy * sinY;
    car.x += worldVx * stepDt;
    car.z += worldVz * stepDt;

    // Barrier Containment & Glancing Elastic Collision!
    const postProj = track.project(car.x, car.z, car.trackIdx);
    if (Math.abs(postProj.lat) > BARRIER_HALF_WIDTH) {
      const sign = postProj.lat >= 0 ? 1 : -1;
      const pNode = postProj.node;
      car.x = pNode.x + pNode.rx * (sign * (BARRIER_HALF_WIDTH - 0.15));
      car.z = pNode.z + pNode.rz * (sign * (BARRIER_HALF_WIDTH - 0.15));

      const trackYaw = Math.atan2(pNode.tx, pNode.tz);
      const impactAngle = Math.abs(wrapAngle(car.yaw - trackYaw));
      const normalSpd = car.vx * Math.sin(impactAngle);
      car.impactStrength = clamp(normalSpd / 28, 0.12, 1.0);
      if (normalSpd > 6.5) {
        car.frontWingHealth = Math.max(20, car.frontWingHealth - normalSpd * 1.45);
      }
      // Deflect cleanly parallel to barrier & bleed speed
      car.vx *= clamp(1.0 - Math.sin(impactAngle) * 0.55, 0.35, 0.92);
      car.vy = -sign * Math.min(3.5, Math.abs(car.vy) * 0.35);
      car.yaw = wrapAngle(car.yaw + wrapAngle(trackYaw - car.yaw) * 0.55);
      car.yawRate *= 0.25;
      car.lat = sign * (BARRIER_HALF_WIDTH - 0.15);
    }

    // 4-DOF Chassis Pitch / Roll / Bottoming Sparks
    const targetPitch = clamp(car.longG * 0.0095, -0.045, 0.045);
    const targetRoll = clamp(-car.latG * 0.0115 + (node.bankRad || 0) * 0.65, -0.09, 0.09);
    car.pitchRad += (targetPitch - car.pitchRad) * Math.min(1, stepDt * 12);
    car.rollRad += (targetRoll - car.rollRad) * Math.min(1, stepDt * 12);
    car.wheelSpin += (car.vx / 0.36) * stepDt;
    car.speedKph = car.vx * 3.6;
    car.bottoming = (car.speedKph > 250 && !car.xModeActive && (car.kerbIntensity > 0.2 || Math.abs(node.curv) > 0.008))
      ? clamp((car.speedKph - 245) / 90, 0.15, 1.0)
      : 0;
    car.brakeTemp += ((brake > 0.2 && car.speedKph > 90 ? 940 : 280) - car.brakeTemp) * Math.min(1, stepDt * (brake > 0.2 ? 3.5 : 0.9));

    // Record 10 Hz lap telemetry & ghost sample
    if (car.lap >= 1) {
      car.sampleAccumS += stepDt;
      if (car.sampleAccumS >= 0.10 && car.lapSamples.length < 900) {
        car.sampleAccumS -= 0.10;
        car.lapSamples.push({
          t: +(car.lapTimeMs / 1000).toFixed(2),
          p: +car.prog.toFixed(4),
          l: +car.lat.toFixed(2),
          y: +car.yaw.toFixed(3),
          k: Math.round(car.speedKph),
          g: car.gear,
          th: Math.round(throttle * 100),
          br: Math.round(brake * 100),
        });
      }
    }
    return car;
  }

  return {
    FIXED_DT,
    TRACK_HALF_WIDTH,
    KERB_OUTER,
    BARRIER_HALF_WIDTH,
    DEFAULT_COMPOUNDS,
    buildDriveTrack,
    createCarState,
    stepPhysics,
    pacejkaFy,
    buildGearTopSpeedsMps,
    wrapAngle,
    clamp,
  };
});
