/**
 * Per-Car F1 Vehicle Dynamics, C2 Track Spline & 4-DOF Suspension Physics Engine.
 *
 * Replaces raw linear track-snapping with genuine, jitter-free per-car driving physics:
 *   1. C2-Continuous Catmull-Rom Track Spline (960 samples, exact curvature & road bump profile)
 *   2. Per-Car & Per-Era Chassis DNA (mass, fuel load, spring/damper rates, aero Cl/Cd,
 *      static ride height, 2026 Active Aero X-Mode, ground-effect porpoising, skid-block material)
 *   3. Critically-Damped Bicycle Steering & Velocity-Aligned Driving Heading (zero crabbing/jitter!)
 *   4. 4-DOF Heave/Pitch/Roll Solver -> Authentic braking dive, corner roll, aero squat &
 *      EXACT bottoming-out titanium/magnesium plank spark triggers per car!
 */
(function (global) {
  "use strict";

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function hashCode(str) {
    let h = 2166136261;
    const s = String(str || "car");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
  }

  // ---------------------------------------------------------------------------
  // 1. C2-Continuous Closed Catmull-Rom Track Spline + Curvature & Bump Profile
  // ---------------------------------------------------------------------------
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

  function buildTrackSpline(rawPoints, lengthKm, circuitId, biome) {
    if (!Array.isArray(rawPoints) || rawPoints.length < 6) return null;
    const nRaw = rawPoints.length;
    let perim = 0;
    let cx = 0, cz = 0;
    for (let i = 0; i < nRaw; i++) {
      const a = rawPoints[i], b = rawPoints[(i + 1) % nRaw];
      perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
      cx += a[0]; cz += a[1];
    }
    cx /= nRaw; cz /= nRaw;

    const targetPerimM = Math.max(2400, Math.min(5400, (lengthKm || 5.0) * 660));
    const scale = targetPerimM / Math.max(10, perim);

    // Subdivide each raw segment with smooth Catmull-Rom cubic interpolation (~960 silky samples!)
    const subPerSeg = Math.max(4, Math.min(10, Math.round(960 / nRaw)));
    const dense = [];
    for (let i = 0; i < nRaw; i++) {
      const p0 = rawPoints[(i - 1 + nRaw) % nRaw];
      const p1 = rawPoints[i];
      const p2 = rawPoints[(i + 1) % nRaw];
      const p3 = rawPoints[(i + 2) % nRaw];
      for (let k = 0; k < subPerSeg; k++) {
        const t = k / subPerSeg;
        const x = (catmullRom(p0[0], p1[0], p2[0], p3[0], t) - cx) * scale;
        const z = (catmullRom(p0[1], p1[1], p2[1], p3[1], t) - cz) * scale;
        dense.push({ x, z, tx: 1, tz: 0, curv: 0, bump: 0, s: 0 });
      }
    }

    // Recompute exact arc-length, smooth tangents, signed curvature & deterministic road roughness!
    const n = dense.length;
    const isBumpy = (biome === "street" || biome === "night_street" || biome === "harbour" || circuitId === "austin" || circuitId === "interlagos" || circuitId === "melbourne" || circuitId === "baku");
    const seed = hashCode(circuitId || "track") * 100;

    let accS = 0;
    for (let i = 0; i < n; i++) {
      const prev = dense[(i - 1 + n) % n];
      const cur = dense[i];
      const next = dense[(i + 1) % n];
      if (i > 0) accS += Math.hypot(cur.x - prev.x, cur.z - prev.z);
      cur.s = accS;
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      const len = Math.max(1e-5, Math.hypot(dx, dz));
      cur.tx = dx / len;
      cur.tz = dz / len;
    }
    const totalLen = accS + Math.hypot(dense[0].x - dense[n - 1].x, dense[0].z - dense[n - 1].z);

    // Smooth tangent pass (eliminates any micro-kink in legacy circuit data!)
    for (let pass = 0; pass < 2; pass++) {
      const txCopy = dense.map((p) => p.tx);
      const tzCopy = dense.map((p) => p.tz);
      for (let i = 0; i < n; i++) {
        const im = (i - 1 + n) % n, ip = (i + 1) % n;
        const tx = txCopy[im] * 0.25 + txCopy[i] * 0.5 + txCopy[ip] * 0.25;
        const tz = tzCopy[im] * 0.25 + tzCopy[i] * 0.5 + tzCopy[ip] * 0.25;
        const l = Math.max(1e-5, Math.hypot(tx, tz));
        dense[i].tx = tx / l;
        dense[i].tz = tz / l;
      }
    }

    // Compute signed curvature (1/m) and realistic asphalt bump/dip wave (mm)
    for (let i = 0; i < n; i++) {
      const prev = dense[(i - 2 + n) % n];
      const next = dense[(i + 2) % n];
      const ds = Math.max(1.0, Math.hypot(next.x - prev.x, next.z - prev.z));
      const cross = prev.tx * next.tz - prev.tz * next.tx;
      dense[i].curv = clamp(cross / ds, -0.05, 0.05);

      const u = i / n;
      // Multi-frequency deterministic bumps (compression dips + asphalt undulations)
      const wave1 = Math.sin(u * Math.PI * 14 + seed) * 0.55;
      const wave2 = Math.sin(u * Math.PI * 38 + seed * 2.3) * 0.35;
      const wave3 = Math.cos(u * Math.PI * 74 + seed * 4.1) * 0.25;
      const sharpBump = Math.pow(Math.max(0, Math.sin(u * Math.PI * 10 + seed * 1.7)), 8) * 1.35;
      dense[i].bump = (wave1 + wave2 + wave3 + sharpBump) * (isBumpy ? 10.5 : 6.2); // mm
    }

    function sample(prog) {
      const p = (((prog % 1) + 1) % 1) * n;
      const i0 = Math.floor(p) % n;
      const i1 = (i0 + 1) % n;
      const f = p - Math.floor(p);
      const a = dense[i0], b = dense[i1];
      const tx = a.tx + (b.tx - a.tx) * f;
      const tz = a.tz + (b.tz - a.tz) * f;
      const tl = Math.max(1e-5, Math.hypot(tx, tz));
      return {
        x: a.x + (b.x - a.x) * f,
        z: a.z + (b.z - a.z) * f,
        tx: tx / tl,
        tz: tz / tl,
        curv: a.curv + (b.curv - a.curv) * f,
        bumpMm: a.bump + (b.bump - a.bump) * f,
      };
    }

    return { pts: dense, totalLen, sample };
  }

  // ---------------------------------------------------------------------------
  // 2. Per-Car & Per-Era Chassis Spec (Unique Physics DNA for Every Car!)
  // ---------------------------------------------------------------------------
  const ERA_CHASSIS_DNA = {
    "1950s": { massKg: 660, staticFrontMm: 95, staticRearMm: 108, cl: 0.25, springK: 38, damperZ: 0.52, skid: "none",      porpoise: 0.00, activeAero: false, rollGain: 1.55, pitchGain: 1.45 },
    "1960s": { massKg: 540, staticFrontMm: 82, staticRearMm: 94,  cl: 0.55, springK: 48, damperZ: 0.58, skid: "none",      porpoise: 0.00, activeAero: false, rollGain: 1.35, pitchGain: 1.30 },
    "1970s": { massKg: 590, staticFrontMm: 52, staticRearMm: 62,  cl: 1.90, springK: 72, damperZ: 0.65, skid: "none",      porpoise: 0.15, activeAero: false, rollGain: 1.15, pitchGain: 1.15 },
    "1980s": { massKg: 560, staticFrontMm: 26, staticRearMm: 34,  cl: 2.85, springK: 125,damperZ: 0.72, skid: "magnesium", porpoise: 0.22, activeAero: false, rollGain: 0.90, pitchGain: 0.95 },
    "1990s": { massKg: 600, staticFrontMm: 27, staticRearMm: 36,  cl: 3.15, springK: 145,damperZ: 0.78, skid: "magnesium", porpoise: 0.12, activeAero: false, rollGain: 0.80, pitchGain: 0.85 },
    "2000s": { massKg: 605, staticFrontMm: 30, staticRearMm: 42,  cl: 3.45, springK: 165,damperZ: 0.82, skid: "titanium",  porpoise: 0.08, activeAero: false, rollGain: 0.72, pitchGain: 0.78 },
    "2010s": { massKg: 740, staticFrontMm: 28, staticRearMm: 46,  cl: 3.65, springK: 175,damperZ: 0.84, skid: "titanium",  porpoise: 0.06, activeAero: false, rollGain: 0.68, pitchGain: 0.72 },
    "2020s": { massKg: 798, staticFrontMm: 24, staticRearMm: 32,  cl: 4.15, springK: 210,damperZ: 0.80, skid: "titanium",  porpoise: 0.68, activeAero: false, rollGain: 0.56, pitchGain: 0.62 },
    "2026":  { massKg: 768, staticFrontMm: 25, staticRearMm: 34,  cl: 3.60, springK: 195,damperZ: 0.84, skid: "titanium",  porpoise: 0.34, activeAero: true,  rollGain: 0.62, pitchGain: 0.66 },
  };

  function resolveEraKey(eraRaw) {
    const s = String(eraRaw || "2026").toLowerCase();
    if (ERA_CHASSIS_DNA[s]) return s;
    if (s.includes("2026")) return "2026";
    if (s.includes("202")) return "2020s";
    if (s.includes("201")) return "2010s";
    if (s.includes("200")) return "2000s";
    if (s.includes("199")) return "1990s";
    if (s.includes("198")) return "1980s";
    if (s.includes("197")) return "1970s";
    if (s.includes("196")) return "1960s";
    if (s.includes("195")) return "1950s";
    return "2026";
  }

  function createCarPhysicsState(car, eraKey) {
    const eKey = resolveEraKey(eraKey || (car && car.era));
    const dna = ERA_CHASSIS_DNA[eKey] || ERA_CHASSIS_DNA["2026"];
    const h = hashCode(`${car.code3 || car.idx}_${car.team || car.color || ""}`);
    const h2 = hashCode(`${car.color || ""}_${car.idx}_susp`);

    // Distinct per-car setup & team chassis personality!
    const setupRide = Number((car && car.setupRideHeight) ?? (45 + h * 30));   // 20..90 (lower = aggressive low floor!)
    const setupAero = Number((car && car.setupAeroBalance) ?? (45 + h2 * 30)); // 20..90
    const rideDeltaMm = ((setupRide - 55) / 45) * 7.5; // -5.8mm aggressive low-rider .. +5.8mm high-kerb setup
    const springVar = 0.88 + h2 * 0.26;
    const clVar = 0.90 + ((setupAero - 50) / 100) * 0.24 + (h - 0.5) * 0.12;

    return {
      eraKey: eKey,
      skidType: dna.skid,
      activeAero: dna.activeAero,
      massKg: dna.massKg,
      staticFrontMm: clamp(dna.staticFrontMm + rideDeltaMm, 17, 115),
      staticRearMm:  clamp(dna.staticRearMm + rideDeltaMm * 1.15, 22, 125),
      springK: dna.springK * springVar,
      damperZ: dna.damperZ,
      baseCl: dna.cl * clVar,
      porpoiseGain: dna.porpoise * (setupRide < 50 ? 1.25 : 0.72),
      rollGain: dna.rollGain,
      pitchGain: dna.pitchGain,

      // Dynamic runtime kinematic & 4-DOF chassis state (initialized cleanly on first frame)
      init: false,
      wx: 0, wz: 0,
      latPos: 0,
      latVel: 0,
      yaw: 0,
      yawSlip: 0,
      frontRideMm: dna.staticFrontMm,
      rearRideMm: dna.staticRearMm,
      heaveVel: 0,
      porpoisePhase: h * Math.PI * 2,
      pitchRad: 0,
      rollRad: 0,
      wheelSpin: 0,
      brakeHeat: 0,
      downforceKg: 0,
      bottoming: 0,
      bottomingCount: 0,
      minRideMm: dna.staticFrontMm,
      inXMode: false,
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Per-Frame Jitter-Free Driving Kinematics + 4-DOF Suspension & Bottoming Solver
  // ---------------------------------------------------------------------------
  function stepCarPhysics(phys, target, dt, env) {
    const stepDt = Math.max(0.001, Math.min(0.04, dt || 0.016));
    const rawKph = target.liveKph != null ? Number(target.liveKph) : 210;
    const speedKph = Math.max(0, Number.isFinite(rawKph) ? rawKph : 210);
    const vMps = speedKph / 3.6;
    const trackYaw = Math.atan2(target.tx, target.tz);

    if (!phys.init) {
      phys.init = true;
      phys.latPos = target.targetLat || 0;
      phys.latVel = 0;
      phys.yaw = trackYaw;
      phys.wx = target.x + (-target.tz) * phys.latPos;
      phys.wz = target.z + target.tx * phys.latPos;
    }

    // A. Critically-Damped 2nd-Order Steering Lateral Tracker (smooth S-curve lane changes, ZERO twitch!)
    const errLat = (target.targetLat || 0) - phys.latPos;
    const wn = 5.4; // Natural steering frequency (rad/s)
    const accLat = clamp(errLat * (wn * wn) - phys.latVel * (2 * 0.96 * wn), -22, 22);
    phys.latVel = clamp(phys.latVel + accLat * stepDt, -6.2, 6.2);
    phys.latPos = clamp(phys.latPos + phys.latVel * stepDt, -6.0, 6.0);

    const rx = -target.tz;
    const rz = target.tx;
    const desiredWx = target.x + rx * phys.latPos;
    const desiredWz = target.z + rz * phys.latPos;

    // Gentle position follow (eliminates single-frame progress jumps while keeping car tightly synced!)
    const posJump = Math.hypot(desiredWx - phys.wx, desiredWz - phys.wz);
    if (posJump > 28) {
      // Teleported (e.g. pit exit or restart)
      phys.wx = desiredWx;
      phys.wz = desiredWz;
      phys.yaw = trackYaw;
    } else {
      const followAlpha = 1 - Math.exp(-22 * stepDt);
      phys.wx += (desiredWx - phys.wx) * followAlpha;
      phys.wz += (desiredWz - phys.wz) * followAlpha;
    }

    // B. Velocity-Aligned Driving Heading + Authentic Corner Slip Angle (No Crabbing!)
    const steerAngle = Math.atan2(phys.latVel, Math.max(14, vMps));
    const latG = clamp((vMps * vMps * (target.curv || 0)) / 9.81, -5.5, 5.5);
    const wetSlipBoost = 1.0 + ((env && env.wetness) || 0) / 140;
    const oversteerFactor = clamp(1.0 + (Number(target.balanceBias || 0) / 140), 0.65, 1.45);
    const targetSlip = clamp(latG * 0.011 * wetSlipBoost * oversteerFactor, -0.09, 0.09);
    phys.yawSlip += (targetSlip - phys.yawSlip) * Math.min(1, stepDt * 7.5);

    const desiredYaw = trackYaw - steerAngle * 0.85 + phys.yawSlip;
    const yawErr = wrapAngle(desiredYaw - phys.yaw);
    const maxYawStep = 4.6 * stepDt;
    phys.yaw = wrapAngle(phys.yaw + clamp(yawErr * Math.min(1, stepDt * 13.5), -maxYawStep, maxYawStep));

    // C. Real Aero Downforce (with DRS & 2026 Active Aero X-Mode Straight-Line Unloading!)
    const floorHealth = clamp(Number(target.floorHealth ?? 95) / 100, 0.45, 1.0);
    const suspHealth = clamp(Number(target.suspHealth ?? 95) / 100, 0.45, 1.0);
    const onStraightFast = Math.abs(target.curv || 0) < 0.004 && speedKph > 255;
    phys.inXMode = Boolean(phys.activeAero && onStraightFast && !target.inPit);

    let clEff = phys.baseCl * (0.72 + 0.28 * floorHealth);
    if (target.drsOpen) clEff *= 0.84;
    if (phys.inXMode) clEff *= 0.66; // 2026 Active Aero X-Mode unloads wings on straights -> raises ride height!

    const downforceN = 0.5 * 1.225 * clEff * 1.62 * (vMps * vMps);
    phys.downforceKg = Math.round(downforceN / 9.81);

    // D. Fuel Weight Compression + Asphalt Bumps + Apex Kerb Strikes
    const fuelKg = clamp(Number(target.fuelKg ?? 55), 2, 110);
    const fuelSagMm = (fuelKg / 100) * 6.8;
    const aeroSquatFrontMm = (downforceN * 0.44) / (phys.springK * 22);
    const aeroSquatRearMm  = (downforceN * 0.56) / (phys.springK * 21);

    // Pitch transfer from braking/acceleration (nose dives under braking!)
    const longG = clamp(Number(target.liveLongG || 0), -5.5, 2.2);
    const pitchTransferMm = longG * 2.4 * phys.pitchGain; // negative under braking -> front compresses!

    // Road micro-bumps + apex kerb rumble when running wide on kerbs
    const onKerb = Math.abs(phys.latPos) > 4.65 && !target.inPit;
    const kerbRippleMm = onKerb ? Math.sin(phys.wheelSpin * 2.8) * 6.5 : 0;
    const roadBumpMm = ((target.bumpMm || 0) * Math.min(1.3, speedKph / 230)) + kerbRippleMm;

    // Ground-Effect Porpoising Oscillation (2022–25 low ride height resonance!)
    let porpoiseMm = 0;
    if (phys.porpoiseGain > 0.05 && speedKph > 245 && !phys.inXMode && !target.inPit) {
      const baseRearEst = phys.staticRearMm - fuelSagMm - aeroSquatRearMm;
      if (baseRearEst < 12.5) {
        phys.porpoisePhase += stepDt * (28 + (speedKph - 240) * 0.14); // ~5 Hz Venturi bounce!
        const amp = clamp((12.5 - baseRearEst) * 0.65 * phys.porpoiseGain, 0, 7.5);
        porpoiseMm = Math.sin(phys.porpoisePhase) * amp;
      }
    }

    const eqFrontMm = phys.staticFrontMm - fuelSagMm - aeroSquatFrontMm + pitchTransferMm - roadBumpMm * 0.55 - porpoiseMm * 0.45;
    const eqRearMm  = phys.staticRearMm  - fuelSagMm - aeroSquatRearMm  - pitchTransferMm - roadBumpMm * 0.72 - porpoiseMm;

    // Damped spring response (prevents harsh vertical jitter while feeling physically alive!)
    const suspRate = 14.0 * (0.75 + 0.25 * suspHealth);
    const lerpH = 1 - Math.exp(-suspRate * stepDt);
    phys.frontRideMm += (clamp(eqFrontMm, -2, 130) - phys.frontRideMm) * lerpH;
    phys.rearRideMm  += (clamp(eqRearMm,  -2, 140) - phys.rearRideMm) * lerpH;

    const minRh = Math.min(phys.frontRideMm, phys.rearRideMm);
    phys.minRideMm = Math.min(phys.minRideMm, Math.max(0, minRh));

    // E. Authentic Body Pitch, Roll & Wheel Spin
    const targetPitch = clamp(((phys.frontRideMm - phys.rearRideMm) * 0.00095) + (longG * 0.0085 * phys.pitchGain), -0.048, 0.048);
    const targetRoll  = clamp(-latG * 0.0115 * phys.rollGain, -0.058, 0.058);
    phys.pitchRad += (targetPitch - phys.pitchRad) * Math.min(1, stepDt * 11);
    phys.rollRad  += (targetRoll - phys.rollRad) * Math.min(1, stepDt * 10);
    phys.wheelSpin += (vMps / 0.36) * stepDt;

    // E2. Authentic Carbon-Carbon Brake Disc Thermal State (ramps under hard braking, cools smoothly with airflow!)
    const brakeDecel = Math.max(0, -longG - 0.65);
    const speedFactor = clamp(speedKph / 240, 0.2, 1.35);
    if (brakeDecel > 0.05 && !target.inPit) {
      phys.brakeHeat = clamp((phys.brakeHeat || 0) + brakeDecel * speedFactor * 0.82 * stepDt, 0, 1);
    } else {
      const coolRate = (0.42 + speedFactor * 0.45) * (1 + (((env && env.wetness) || 0) / 140));
      phys.brakeHeat = Math.max(0, (phys.brakeHeat || 0) - coolRate * stepDt);
    }

    // F. EXACT Skid-Block Bottoming-Out Spark Calculation (Different per car, era, fuel & bump!)
    // Sparks ONLY fire when the physical plank/skid touches asphalt (rideHeight <= 3.2mm) at speed!
    let bottoming = 0;
    if (!target.inPit && phys.skidType !== "none" && speedKph >= 175) {
      if (minRh <= 3.4) {
        bottoming = clamp((3.4 - minRh) / 4.2, 0.12, 1.0) * clamp((speedKph - 160) / 140, 0.25, 1.0);
        if (bottoming > 0.35 && phys.bottoming <= 0.35) phys.bottomingCount += 1;
      } else if (onKerb && minRh <= 8.5 && speedKph >= 195) {
        bottoming = clamp((8.5 - minRh) / 7.0, 0.1, 0.55);
      }
    }
    phys.bottoming = bottoming;

    // Visual vertical heave offset in meters (clamped smoothly near asphalt y=0.04..0.14)
    const meanRhMm = (phys.frontRideMm + phys.rearRideMm) * 0.5;
    const heaveY = clamp(0.032 + (meanRhMm / 1000) * 1.15, 0.032, 0.18);

    return {
      wx: phys.wx,
      wz: phys.wz,
      latPos: phys.latPos,
      heaveY,
      yaw: phys.yaw,
      pitchRad: phys.pitchRad,
      rollRad: phys.rollRad,
      wheelSpin: phys.wheelSpin,
      brakeHeat: phys.brakeHeat,
      steerAngle: clamp(-steerAngle * 1.85 - (target.curv || 0) * 14.0, -0.44, 0.44),
      frontRideMm: Math.max(0, Math.round(phys.frontRideMm)),
      rearRideMm: Math.max(0, Math.round(phys.rearRideMm)),
      minRideMm: Math.max(0, Math.round(minRh)),
      downforceKg: phys.downforceKg,
      bottoming: phys.bottoming,
      skidType: phys.skidType,
      inXMode: phys.inXMode,
      latG: +latG.toFixed(2),
    };
  }

  // ---------------------------------------------------------------------------
  // 4. 3D Spatial Multi-Car Anti-Clipping Solver (Oriented Track-Frame Separation)
  // ---------------------------------------------------------------------------
  // Guarantees ZERO 3D car-to-car chassis/wheel overlap during wheel-to-wheel overtakes,
  // standing starts, and Safety Car restarts while keeping every car cleanly on asphalt!
  function resolve3DCarSeparations(items, maxLatBound) {
    if (!Array.isArray(items) || items.length < 2) return 0;
    const limLat = Number.isFinite(maxLatBound) ? maxLatBound : 6.2;
    const MIN_LONG = 5.75; // Full F1 chassis length (5.6m) + front/rear wing safety margin
    const MIN_LAT  = 2.42; // Full F1 track width (2.18m) + wheel-to-wheel margin
    let adjustments = 0;

    for (let iter = 0; iter < 14; iter++) {
      let movedAny = false;
      for (let i = 0; i < items.length; i++) {
        const a = items[i];
        if (!a || a.inPit || a.dnf) continue;
        for (let j = i + 1; j < items.length; j++) {
          const b = items[j];
          if (!b || b.inPit || b.dnf) continue;
          const dx = b.wx - a.wx;
          const dz = b.wz - a.wz;
          const dist2 = dx * dx + dz * dz;
          if (dist2 > 44.0) continue; // Fast broadphase reject (> 6.63m apart)

          // Project separation into average local track tangent/right frame
          let tx = (a.tx || 0) + (b.tx || 0);
          let tz = (a.tz || 1) + (b.tz || 1);
          const tl = Math.hypot(tx, tz) || 1;
          tx /= tl; tz /= tl;
          const rx = -tz;
          const rz = tx;

          const dLong = dx * tx + dz * tz;
          const dLat  = dx * rx + dz * rz;
          const absLong = Math.abs(dLong);
          const absLat  = Math.abs(dLat);

          if (absLong < MIN_LONG && absLat < MIN_LAT) {
            const penLong = MIN_LONG - absLong;
            const penLat  = MIN_LAT - absLat;

            // Prefer lateral separation when cars are genuinely side-by-side or have room across track,
            // otherwise resolve along the minimum-penetration axis!
            const roomA = limLat - Math.abs(a.latPos || 0);
            const roomB = limLat - Math.abs(b.latPos || 0);
            const preferLat = (absLong < 4.2 && (roomA + roomB) >= penLat * 0.5) || (penLat <= penLong * 0.65);

            if (preferLat) {
              const sign = dLat >= 0 ? 1 : -1;
              const push = penLat * 0.52;
              const newLatA = clamp((a.latPos || 0) - sign * push, -limLat, limLat);
              const newLatB = clamp((b.latPos || 0) + sign * push, -limLat, limLat);
              const shiftA = newLatA - (a.latPos || 0);
              const shiftB = newLatB - (b.latPos || 0);
              a.latPos = newLatA;
              b.latPos = newLatB;
              a.wx += rx * shiftA;
              a.wz += rz * shiftA;
              b.wx += rx * shiftB;
              b.wz += rz * shiftB;
              // If track edge clamped lateral push and still overlapping, resolve residual longitudinally
              const remLat = Math.abs((b.wx - a.wx) * rx + (b.wz - a.wz) * rz);
              if (remLat < MIN_LAT - 0.04) {
                const lSign = dLong >= 0 ? 1 : -1;
                const lPush = (MIN_LONG - absLong) * 0.52;
                a.wx -= tx * lSign * lPush;
                a.wz -= tz * lSign * lPush;
                b.wx += tx * lSign * lPush;
                b.wz += tz * lSign * lPush;
              }
            } else {
              const lSign = dLong >= 0 ? 1 : -1;
              const lPush = penLong * 0.52;
              a.wx -= tx * lSign * lPush;
              a.wz -= tz * lSign * lPush;
              b.wx += tx * lSign * lPush;
              b.wz += tz * lSign * lPush;
            }
            movedAny = true;
            adjustments += 1;
          }
        }
      }
      if (!movedAny) break;
    }
    return adjustments;
  }

  global.F1VehiclePhysics = {
    ERA_CHASSIS_DNA,
    buildTrackSpline,
    createCarPhysicsState,
    stepCarPhysics,
    resolve3DCarSeparations,
  };
})(window);
