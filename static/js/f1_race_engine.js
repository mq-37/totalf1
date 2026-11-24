/**
 * Shared F1 Race Simulation Physics, Era Rules, Driver Psychology (Momentum & Confidence),
 * Fixed-Timestep Substepper, Lazy Circuit Loader, Telemetry Recorder & HUD Utilities.
 *
 * Single source of truth for /play Track Sim, /sim Full CPU Broadcast, and /career Pit Wall.
 */
(function (global) {
  "use strict";

  const COMPOUNDS = {
    soft:   { code: "S", name: "Soft",   color: "#ef4444", pace: -0.95, wear: 1.48, wet: 0, optTemp: 102 },
    medium: { code: "M", name: "Medium", color: "#facc15", pace: -0.30, wear: 0.96, wet: 0, optTemp: 99  },
    hard:   { code: "H", name: "Hard",   color: "#f8fafc", pace:  0.25, wear: 0.60, wet: 0, optTemp: 95  },
    inter:  { code: "I", name: "Inter",  color: "#22c55e", pace:  1.35, wear: 0.88, wet: 1, optTemp: 88  },
    wet:    { code: "W", name: "Wet",    color: "#3b82f6", pace:  2.55, wear: 0.72, wet: 2, optTemp: 80  },
  };

  const DEFAULT_ERA_RULES = {
    key: "2026",
    label: "2026 Active Aero & Manual Override",
    points: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
    fastest_lap_point: 0,
    fastest_lap_top_n: 0,
    refuelling: false,
    refuel_sec_per_kg: 0.0,
    start_fuel_kg: 100.0,
    fuel_burn_per_lap_kg: 1.65,
    overtake_aid: "override",
    drs_enabled: false,
    override_mode: true,
    ers_enabled: true,
    turbo_boost: false,
    two_compound_rule: true,
    mandatory_pit_stop: true,
    pit_base_s: 2.25,
    pit_error_chance: 0.03,
    reliability_dnf_mult: 0.74,
    sc_chance_mult: 1.0,
    vsc_enabled: true,
    dirty_air_mult: 0.78,
    slipstream_bonus: 1.05,
  };

  const RISK_PROFILES = {
    low:      { label: "Low Risk",  short: "SAFE", paceDelta: +0.28, overtakeMult: 0.72, mistakeMult: 0.45, tyreWearMult: 0.88 },
    standard: { label: "Standard",  short: "STD",  paceDelta:  0.00, overtakeMult: 1.00, mistakeMult: 1.00, tyreWearMult: 1.00 },
    high:     { label: "High Risk", short: "ATK",  paceDelta: -0.34, overtakeMult: 1.38, mistakeMult: 1.85, tyreWearMult: 1.18 },
  };

  const _circuitFullCache = new Map();

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function fmtLapTime(sec) {
    if (!Number.isFinite(sec) || sec <= 0 || sec > 500) return "--.-s";
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
  }

  function fmtSectorTime(sec) {
    if (!Number.isFinite(sec) || sec <= 0 || sec > 200) return "--.-";
    return sec.toFixed(1);
  }

  /**
   * Cache & lazy-load full circuit geometry (points, corners, pit building) from /api/game/circuits/{id}.
   * Supports inline circuits already containing `.points` without any network call.
   */
  function registerCircuit(c) {
    if (c && c.id && Array.isArray(c.points) && c.points.length >= 3) {
      _circuitFullCache.set(c.id, c);
    }
  }

  async function fetchCircuit(circuitOrId) {
    if (circuitOrId && typeof circuitOrId === "object") {
      if (Array.isArray(circuitOrId.points) && circuitOrId.points.length >= 3) {
        _circuitFullCache.set(circuitOrId.id, circuitOrId);
        return circuitOrId;
      }
      circuitOrId = circuitOrId.id;
    }
    const id = String(circuitOrId || "melbourne").trim().toLowerCase();
    if (_circuitFullCache.has(id)) return _circuitFullCache.get(id);
    const res = await fetch(`/api/game/circuits/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`Circuit ${id} not found (${res.status})`);
    const full = await res.json();
    _circuitFullCache.set(id, full);
    return full;
  }

  function isInDrsZone(circuit, prog) {
    const p = ((prog % 1) + 1) % 1;
    return ((circuit && circuit.drs_ranges) || []).some(([a, b]) => p >= a && p <= b);
  }

  function hasSatisfiedTwoCompoundRule(car, eraRules) {
    if (eraRules && eraRules.two_compound_rule === false) return true;
    if (!car) return false;
    return Boolean(car.usedWet || (car.dryCompoundsUsed && car.dryCompoundsUsed.size >= 2));
  }

  function computePitRejoin(cars, car, circuit, pitLossS) {
    const rejoinProg = car.totalProg - (pitLossS / circuit.base_lap_s);
    const active = cars.filter((c) => !c.dnf && c.idx !== car.idx);
    let aheadCount = 0;
    let closestAhead = null;
    let closestGap = Infinity;
    for (let i = 0; i < active.length; i++) {
      const other = active[i];
      if (other.totalProg > rejoinProg) {
        aheadCount += 1;
        const g = (other.totalProg - rejoinProg) * circuit.base_lap_s;
        if (g < closestGap) {
          closestGap = g;
          closestAhead = other;
        }
      }
    }
    return {
      pos: aheadCount + 1,
      rejoinProg,
      pitLossS,
      cleanAir: !closestAhead || closestGap > 1.6,
      trafficCar: closestAhead,
      trafficGap: closestGap,
    };
  }

  /**
   * Deterministic fixed-timestep substepper for 0.25x .. 32x speeds with zero tunneling.
   */
  function runFixedSubsteps(rawDt, speedMult, maxStepDt, stepFn) {
    const mult = Number(speedMult || 0);
    if (mult <= 0) return;
    const totalSimDt = Math.min(0.05, Math.max(0.001, rawDt)) * mult;
    const cap = Math.max(0.02, maxStepDt || 0.08);
    const steps = Math.max(1, Math.min(40, Math.ceil(totalSimDt / cap)));
    const subDt = totalSimDt / steps;
    for (let i = 0; i < steps; i++) {
      if (stepFn(subDt) === false) break;
    }
  }

  // ---------------------------------------------------------------------------
  // Per-Driver, Per-Race Momentum, Confidence & Risk Engine (F1 Manager-inspired)
  // ---------------------------------------------------------------------------
  function initDriverPsychology(car, psych, trackAffinity, setupConf) {
    const p = psych || {};
    car.composure = Number(p.composure ?? 70);
    car.aggression = Number(p.aggression ?? 68);
    car.wetConfidence = Number(p.wet_confidence ?? 68);
    car.recovery = Number(p.recovery ?? 68);
    car.persona = p.persona || "team_player";
    car.trackAffinity = Number(trackAffinity || 0);
    car.riskMode = car.riskMode || "standard";

    // Seed initial race confidence (48..84) from historical composure + setup comfort + track affinity
    const setupBonus = setupConf != null ? (Number(setupConf) - 65) * 0.24 : 0;
    const affBonus = car.trackAffinity * 2.5;
    car.confidence = clamp(Math.round(58 + (car.composure - 68) * 0.35 + setupBonus + affBonus), 38, 88);
    car.momentum = clamp(Math.round(car.trackAffinity * 6), -25, 25);
    car.peakConfidence = car.confidence;
    car.minConfidence = car.confidence;
    car.overtakesMade = 0;
    car.timesOvertaken = 0;
    car.mistakesCount = 0;
    car.dirtyAirLaps = 0;
    car.totalPitDelayS = 0;
    car.stintHistory = car.stintHistory || [];
    car.sectorTimes = car.sectorTimes || [0, 0, 0];
    car.bestSectors = car.bestSectors || [999, 999, 999];
    car.bestLapS = car.bestLapS || 999;
    car.pitPhase = car.pitPhase || "none";
    car.pitErrorReason = "";
    return car;
  }

  function confidenceTier(conf) {
    const c = Number(conf ?? 60);
    if (c >= 82) return { id: "zone",    label: "IN ZONE",  color: "#22c55e" };
    if (c >= 66) return { id: "high",    label: "HIGH",     color: "#38bdf8" };
    if (c >= 46) return { id: "neutral", label: "STEADY",   color: "#cbd5e1" };
    if (c >= 28) return { id: "low",     label: "LOW",      color: "#f59e0b" };
    return             { id: "shaken",   label: "SHAKEN",   color: "#ef4444" };
  }

  function applyPsychologyEvent(car, eventType, customDelta) {
    if (!car) return;
    const recScale = 0.75 + ((car.recovery || 68) / 100) * 0.5;
    const engChem = car.engineer ? (car.engineer.chemistry || 65) : 65;
    const chemScale = 0.85 + (engChem / 100) * 0.3;

    let dConf = 0;
    let dMom = 0;
    switch (eventType) {
      case "overtake":
        dConf = 5.5 * chemScale; dMom = 18; car.overtakesMade = (car.overtakesMade || 0) + 1; break;
      case "overtaken":
        dConf = -4.5 / recScale; dMom = -14; car.timesOvertaken = (car.timesOvertaken || 0) + 1; break;
      case "pb_sector":
        dConf = 2.0; dMom = 7; break;
      case "purple_sector":
        dConf = 4.2; dMom = 14; break;
      case "clean_lap":
        dConf = 1.6 * recScale; dMom = 5; break;
      case "dirty_air":
        dConf = -2.2 / recScale; dMom = -8; break;
      case "mistake":
        dConf = -9.0 / recScale; dMom = -26; car.mistakesCount = (car.mistakesCount || 0) + 1; break;
      case "slow_pit":
        dConf = -7.5 / recScale; dMom = -20; break;
      case "fast_pit":
        dConf = 3.5 * chemScale; dMom = 10; break;
      case "defend_hold":
        dConf = 2.8; dMom = 9; break;
      case "radio_calm":
        dConf = 4.5 * chemScale; dMom = 8; break;
      default:
        dConf = Number(customDelta || 0);
        dMom = dConf * 2.2;
    }

    car.confidence = clamp((car.confidence ?? 60) + dConf, 8, 99);
    car.momentum = clamp((car.momentum ?? 0) * 0.88 + dMom, -100, 100);
    car.peakConfidence = Math.max(car.peakConfidence ?? car.confidence, car.confidence);
    car.minConfidence = Math.min(car.minConfidence ?? car.confidence, car.confidence);
  }

  /**
   * Compute psychology + risk driving modifiers for a car in real time.
   */
  function getDriverBehaviorModifiers(car, wetness) {
    const conf = car.confidence ?? 60;
    const mom = car.momentum ?? 0;
    const risk = RISK_PROFILES[car.riskMode || "standard"] || RISK_PROFILES.standard;
    const agg = (car.aggression ?? 68) / 100;
    const comp = (car.composure ?? 70) / 100;

    // Pace delta in seconds/lap: High confidence + hot momentum = up to -0.45s/lap; Shaken = up to +0.55s/lap
    const confDelta = -((conf - 58) / 42) * 0.34;
    const momDelta = -(mom / 100) * 0.16;
    const trackAffDelta = -(Number(car.trackAffinity || 0)) * 0.085;
    const wetEdge = (wetness > 25) ? -(((car.wetConfidence ?? 68) - 68) / 32) * 0.32 : 0;

    // Overtake boldness multiplier (affects AI passing willingness & dive-bomb range)
    const overtakeMult = risk.overtakeMult * (0.78 + agg * 0.38) * (0.82 + (conf / 100) * 0.32) * (1 + mom * 0.0018);

    // Unforced lock-up / wide-run mistake hazard multiplier
    const lowConfRisk = conf < 42 ? 1 + ((42 - conf) / 42) * 1.15 : 0.85;
    const mistakeMult = risk.mistakeMult * lowConfRisk * (1.25 - comp * 0.55) * (0.85 + agg * 0.3);

    return {
      paceDelta: confDelta + momDelta + trackAffDelta + wetEdge + risk.paceDelta,
      overtakeMult: clamp(overtakeMult, 0.45, 1.95),
      mistakeMult: clamp(mistakeMult, 0.3, 3.2),
      tyreWearMult: risk.tyreWearMult,
      riskProfile: risk,
    };
  }

  /**
   * Compute canonical tyre wear, thermal window, weather crossover, fuel burn,
   * track rubber grip, pace mode, era rules, psychology & wing damage delta (sec/lap).
   */
  function computeLapModifiers(opts) {
    const comp = COMPOUNDS[opts.compound] || COMPOUNDS.medium;
    const era = opts.eraRules || DEFAULT_ERA_RULES;

    // Fuel effect: Refuelling eras (1990s/2000s) use live fuelKg so short-stint light cars fly!
    let fuelDelta;
    if (era.refuelling && Number.isFinite(opts.fuelKg)) {
      fuelDelta = (opts.fuelKg / 105.0) * 2.35;
    } else {
      const fuelFrac = Math.max(0, 1 - (opts.lap || 0) / Math.max(1, opts.totalLaps || 15));
      fuelDelta = fuelFrac * 1.85;
    }

    let delta = fuelDelta - (((opts.gripPct || 38) - 35) / 65) * 0.65 + comp.pace;

    // Tyre degradation & 22% cliff
    const life = Number(opts.tyreLife ?? 100);
    delta += (100 - life) * 0.018;
    if (life < 22) delta += (22 - life) * 0.16;

    // Pirelli thermal window (84-114°C optimal)
    const temp = Number(opts.tyreTemp ?? 96);
    if (temp > 114) delta += (temp - 114) * 0.08;
    else if (temp < 84) delta += (84 - temp) * 0.06;

    // Weather crossover penalty/bonus
    const wetness = Number(opts.wetness || 0);
    if (wetness >= 60) {
      delta += comp.wet === 0 ? 7.5 : (comp.wet === 1 ? 1.4 : -0.4);
    } else if (wetness >= 22) {
      delta += comp.wet === 0 ? 3.2 : (comp.wet === 1 ? -0.6 : 1.6);
    } else if (comp.wet > 0) {
      delta += comp.wet === 1 ? 2.6 : 4.8;
    }

    // Pace mode, Turbo boost (1980s), & damage
    if (opts.paceMode === "push") delta -= (era.turbo_boost ? 1.05 : 0.72);
    else if (opts.paceMode === "conserve") delta += 0.55;
    if (opts.wingDamaged) delta += 0.55;

    // Psychology, Momentum, Track Affinity & Risk Modifiers
    if (opts.car) {
      const beh = getDriverBehaviorModifiers(opts.car, wetness);
      delta += beh.paceDelta;
      // Live 6-Component Car Wear & Setup Convergence pace impact!
      if (opts.car.compPaceLossS) delta += opts.car.compPaceLossS;
      if (opts.car.eng && Number.isFinite(opts.car.eng.setupPaceDeltaS)) delta += opts.car.eng.setupPaceDeltaS;
    }

    return delta;
  }

  // ---------------------------------------------------------------------------
  // 6-Component Car Health, Era-Authentic Subsystems & F1 Race Engineer Setup Science
  // ---------------------------------------------------------------------------
  const ERA_COMPONENT_SETS = {
    classic: {
      tier: "classic",
      eraBadge: "1950s–1960s CLASSIC",
      ice:        { key: "ice",        label: "Naturally Aspirated Engine", short: "ICE",  area: "Powertrain",  color: "#ef4444", baseTemp: 96  },
      ers:        { key: "ers",        label: "Carburettors / Mech. Fuel",  short: "FUEL", area: "Fuel Feed",   color: "#22c55e", baseTemp: 62  },
      gearbox:    { key: "gearbox",    label: "5-Speed Dogleg Gearbox",     short: "GBX",  area: "Drivetrain",  color: "#f59e0b", baseTemp: 88  },
      brakes:     { key: "brakes",     label: "Drum / Early Disc Brakes",   short: "BRK",  area: "Braking",     color: "#f97316", baseTemp: 290 },
      floor:      { key: "floor",      label: "Spaceframe / Monocoque",     short: "CHAS", area: "Structure",   color: "#38bdf8", baseTemp: 46  },
      suspension: { key: "suspension", label: "Coil & Wishbone Susp.",      short: "SUSP", area: "Chassis",     color: "#a855f7", baseTemp: 48  },
    },
    turbo: {
      tier: "turbo",
      eraBadge: "1970s–1980s TURBO / GE",
      ice:        { key: "ice",        label: "DFV / V6 Turbo Engine",      short: "ICE",  area: "Powertrain",  color: "#ef4444", baseTemp: 106 },
      ers:        { key: "ers",        label: "Turbocharger / Wastegate",   short: "TURB", area: "Forced Ind.", color: "#22c55e", baseTemp: 145 },
      gearbox:    { key: "gearbox",    label: "Manual H-Pattern Gearbox",   short: "GBX",  area: "Drivetrain",  color: "#f59e0b", baseTemp: 95  },
      brakes:     { key: "brakes",     label: "Ventilated Brakes",          short: "BRK",  area: "Braking",     color: "#f97316", baseTemp: 370 },
      floor:      { key: "floor",      label: "Ground-Effect Skirts / Wing",short: "AERO", area: "Aerodynamics",color: "#38bdf8", baseTemp: 55  },
      suspension: { key: "suspension", label: "Rocker-Arm Suspension",      short: "SUSP", area: "Chassis",     color: "#a855f7", baseTemp: 54  },
    },
    v10: {
      tier: "v10",
      eraBadge: "1990s–2008 V10 / V8",
      ice:        { key: "ice",        label: "V10 / V8 Engine",            short: "ICE",  area: "Powertrain",  color: "#ef4444", baseTemp: 112 },
      ers:        { key: "ers",        label: "Hydraulics & ECU",           short: "HYD",  area: "Electronics", color: "#22c55e", baseTemp: 82  },
      gearbox:    { key: "gearbox",    label: "Semi-Auto Paddle Gearbox",   short: "GBX",  area: "Drivetrain",  color: "#f59e0b", baseTemp: 102 },
      brakes:     { key: "brakes",     label: "Carbon Brakes",              short: "BRK",  area: "Braking",     color: "#f97316", baseTemp: 440 },
      floor:      { key: "floor",      label: "Multi-Element Aero",         short: "AERO", area: "Aerodynamics",color: "#38bdf8", baseTemp: 60  },
      suspension: { key: "suspension", label: "Torsion-Bar Suspension",     short: "SUSP", area: "Chassis",     color: "#a855f7", baseTemp: 56  },
    },
    hybrid: {
      tier: "hybrid",
      eraBadge: "2009–2026 HYBRID",
      ice:        { key: "ice",        label: "Hybrid ICE Power Unit",      short: "ICE",  area: "Powertrain",  color: "#ef4444", baseTemp: 108 },
      ers:        { key: "ers",        label: "KERS / ERS MGU-K",           short: "ERS",  area: "Hybrid",      color: "#22c55e", baseTemp: 72  },
      gearbox:    { key: "gearbox",    label: "8-Speed Seamless Gearbox",   short: "GBX",  area: "Drivetrain",  color: "#f59e0b", baseTemp: 98  },
      brakes:     { key: "brakes",     label: "Carbon Brakes & Ducts",      short: "BRK",  area: "Braking",     color: "#f97316", baseTemp: 460 },
      floor:      { key: "floor",      label: "Venturi Floor & Edge",       short: "FLR",  area: "Aerodynamics",color: "#38bdf8", baseTemp: 62  },
      suspension: { key: "suspension", label: "Push / Pull-Rod Susp.",      short: "SUSP", area: "Chassis",     color: "#a855f7", baseTemp: 58  },
    },
  };

  const CAR_COMPONENTS = ERA_COMPONENT_SETS.hybrid;
  const COMP_KEYS = ["ice", "ers", "gearbox", "brakes", "floor", "suspension"];

  function resolveEraTier(eraOrKey) {
    const raw = typeof eraOrKey === "string"
      ? eraOrKey
      : ((eraOrKey && (eraOrKey.key || eraOrKey.label || eraOrKey.eraKey)) || "2026");
    const s = String(raw || "2026").toLowerCase();
    const yrMatch = s.match(/(19\d{2}|20\d{2})/);
    if (yrMatch) {
      const y = Number(yrMatch[1]);
      if (y < 1970) return "classic";
      if (y < 1990) return "turbo";
      if (y <= 2008) return "v10";
      return "hybrid";
    }
    if (s.includes("1950") || s.includes("1960") || s.includes("classic") || s.includes("50s") || s.includes("60s")) return "classic";
    if (s.includes("1970") || s.includes("1980") || s.includes("turbo") || s.includes("70s") || s.includes("80s")) return "turbo";
    if (s.includes("1990") || s.includes("2000") || s.includes("v10") || s.includes("v8") || s.includes("90s")) return "v10";
    return "hybrid";
  }

  function getEraComponents(eraOrKey) {
    return ERA_COMPONENT_SETS[resolveEraTier(eraOrKey)] || ERA_COMPONENT_SETS.hybrid;
  }

  function _circuitSetupTargets(circuit) {
    const aeroStr = String((circuit && circuit.aero) || "MED").toUpperCase();
    const isHighAero = aeroStr.includes("HIGH") || (circuit && (circuit.turns || 14) >= 16);
    const isLowAero = aeroStr.includes("LOW") || (circuit && (circuit.top_speed_kph || 320) >= 338);
    const isStreet = Boolean(circuit && (circuit.biome === "street" || circuit.biome === "night_street" || circuit.biome === "harbour"));
    const wearLvl = Number((circuit && circuit.tyre_wear) || 3);
    return {
      aeroBalance:  isHighAero ? 78 : (isLowAero ? 34 : 58),   // Front/Rear Wing CoP %
      rideHeight:   isStreet ? 72 : (isLowAero ? 38 : 54),     // Kerb compliance vs floor seal
      diffLock:     isHighAero ? 68 : (isLowAero ? 46 : 58),   // On/off-throttle rotation
      brakeBias:    isLowAero ? 74 : (isStreet ? 62 : 66),     // Heavy stop stability
      camberWindow: clamp(42 + wearLvl * 11, 40, 88),          // Apex grip vs thermal deg
    };
  }

  function computeFeedbackQuality(car) {
    const exp = clamp(Number((car && car.experienceScore) ?? 68), 35, 99);
    const engR = clamp(Number((car && car.engineer && car.engineer.rating) ?? 82), 55, 99);
    const chem = clamp(Number((car && car.engineer && car.engineer.chemistry) ?? 72), 40, 99);
    const engEff = engR * 0.65 + chem * 0.35;
    const ovr = clamp(Number((car && car.overallQuality) ?? 76), 55, 99);
    const conf = clamp(Number((car && car.confidence) ?? 62), 10, 99);
    const momNorm = clamp(50 + Number((car && car.momentum) ?? 0) * 0.5, 5, 99);

    // Weighted Engineering Signal Formula: Experience 28% · Engineer 24% · Quality 18% · Confidence 18% · Momentum 12%
    const wExp  = +(exp * 0.28).toFixed(1);
    const wEng  = +(engEff * 0.24).toFixed(1);
    const wQual = +(ovr * 0.18).toFixed(1);
    const wConf = +(conf * 0.18).toFixed(1);
    const wMom  = +(momNorm * 0.12).toFixed(1);
    const score = clamp(Math.round(wExp + wEng + wQual + wConf + wMom), 28, 99);
    const noiseBand = +clamp(18.5 - (score - 30) * 0.23, 2.0, 17.5).toFixed(1);
    const tier = score >= 84 ? "RAZOR-SHARP" : (score >= 70 ? "CLEAR" : (score >= 54 ? "MODERATE" : "NOISY"));

    return {
      score,
      tier,
      noiseBand,
      weights: {
        experience: { pct: 28, raw: Math.round(exp), contrib: wExp, color: "#38bdf8" },
        engineer:   { pct: 24, raw: Math.round(engEff), contrib: wEng, color: "#a855f7" },
        quality:    { pct: 18, raw: Math.round(ovr), contrib: wQual, color: "#facc15" },
        confidence: { pct: 18, raw: Math.round(conf), contrib: wConf, color: "#22c55e" },
        momentum:   { pct: 12, raw: Math.round(momNorm), contrib: wMom, color: "#f97316" },
      },
    };
  }

  function initCarEngineering(car, circuit, meta) {
    const m = meta || {};
    car.experienceScore = clamp(Number(m.experience ?? (58 + (m.seasons || 3) * 3.4)), 40, 99);
    car.overallQuality = clamp(Number(m.overall ?? 76), 55, 99);
    const fb = computeFeedbackQuality(car);
    const targets = _circuitSetupTargets(circuit);

    // Setup convergence depends directly on Feedback Quality + small realistic weekend variance
    const actual = {};
    let errSum = 0;
    Object.keys(targets).forEach((k) => {
      const spread = fb.noiseBand * 1.15;
      const offset = (Math.random() - 0.5) * 2 * spread;
      actual[k] = Math.round(clamp(targets[k] + offset, 12, 95));
      errSum += Math.abs(actual[k] - targets[k]);
    });
    const avgErr = errSum / 5;
    const setupAccuracy = Math.round(clamp(100 - avgErr * 1.85, 48, 99));
    // Understeer (-100) <-> Oversteer (+100) balance signature
    const balanceBias = Math.round(clamp((actual.aeroBalance - targets.aeroBalance) * 1.4 - (actual.diffLock - targets.diffLock) * 0.9, -85, 85));
    const setupPaceDeltaS = +((78 - setupAccuracy) * 0.011).toFixed(3); // ~ -0.23s elite setup .. +0.33s poor setup

    // 6-Component initial race health (87..100% — reflects season pool wear & era thermal baselines!)
    const poolBase = Number(m.poolHealth ?? 95);
    const eraDefs = getEraComponents(m.eraKey || m.era);
    const components = {};
    COMP_KEYS.forEach((ck) => {
      const def = eraDefs[ck];
      const h = clamp(Math.round(poolBase - 4 + Math.random() * 9), 78, 100);
      components[ck] = {
        health: h,
        temp: def.baseTemp + Math.round((Math.random() - 0.5) * 8),
        warned: false,
        criticalWarned: false,
        paceLossS: 0,
      };
    });

    car.components = components;
    car.compPaceLossS = 0;
    car.compKphLoss = 0;
    car.compMistakeMult = 1.0;
    car.compIssues = [];
    car.eng = {
      targets,
      actual,
      setupAccuracy,
      balanceBias,
      setupPaceDeltaS,
      feedback: fb,
      ggPoints: [], // Dynamic G-G Friction Circle telemetry samples
    };
    return car;
  }

  function stepComponentWear(car, circuit, era, opts) {
    if (!car || !car.components || car.dnf || car.finishedRace) return [];
    const o = opts || {};
    const totalLaps = Math.max(8, Number(o.totalLaps || 15));
    const scalePerLap = 18.0 / totalLaps; // Normalized wear so 15-lap & 50-lap races both reveal meaningful degradation arcs!
    const isPush = car.paceMode === "push";
    const isConserve = car.paceMode === "conserve";
    const isDirty = (car.dirtyAirLaps || 0) >= 2;
    const isStreet = Boolean(circuit && (circuit.biome === "street" || circuit.biome === "night_street" || circuit.biome === "harbour"));
    const isHighSpeed = Boolean(circuit && (circuit.top_speed_kph || 320) >= 332);
    const eraRel = Number((era && era.reliability_dnf_mult) || 1.0);
    const qualProtect = 1.18 - ((car.overallQuality || 76) / 100) * 0.34;
    const lapNum = (car.lap || 0) + 1;

    // Refresh live weighted feedback quality from updated confidence & momentum!
    const fb = computeFeedbackQuality(car);
    if (car.eng) car.eng.feedback = fb;

    const wearRates = {
      ice:        (0.75 + (isHighSpeed ? 0.55 : 0.15) + (isPush ? 0.65 : (isConserve ? -0.25 : 0)) + (isDirty ? 0.48 : 0)) * eraRel,
      ers:        (0.68 + (car.ersMode === "overtake" ? 0.72 : 0.10) + (isDirty ? 0.35 : 0)) * eraRel,
      gearbox:    (0.60 + (isStreet ? 0.52 : 0.18) + (isPush ? 0.32 : 0)) * eraRel,
      brakes:     (0.72 + (isStreet || isHighSpeed ? 0.45 : 0.18) + (isDirty ? 0.52 : 0) + (isPush ? 0.38 : 0)),
      floor:      (0.45 + (isStreet ? 0.35 : 0.15) + (car.mistakesCount > 0 ? 0.40 : 0)),
      suspension: (0.48 + (isStreet ? 0.48 : 0.14) + (car.mistakesCount > 0 ? 0.38 : 0)),
    };

    const alerts = [];
    let totalPaceLoss = 0;
    let totalKphLoss = 0;
    let mistakeMult = 1.0;

    // Feedback quality determines how early a driver + engineer detect subtle wear!
    const warnThresh = fb.score >= 82 ? 68 : (fb.score >= 65 ? 62 : 55);
    const critThresh = fb.score >= 82 ? 44 : 38;
    const eraDefs = getEraComponents(era);
    const mechSympathy = (car.dna && car.dna.mech_sympathy != null) ? (1.16 - (car.dna.mech_sympathy / 100) * 0.34) : 1.0;

    COMP_KEYS.forEach((ck) => {
      const cState = car.components[ck];
      const def = eraDefs[ck];
      const jitter = 0.65 + Math.random() * 0.85;
      const drop = wearRates[ck] * scalePerLap * qualProtect * mechSympathy * jitter;
      cState.health = +clamp(cState.health - drop, 8, 100).toFixed(1);

      // Dynamic component operating temperature (°C)
      const heatBoost = (isPush ? 8 : 0) + (isDirty ? 11 : 0) + Math.max(0, (70 - cState.health) * 0.45);
      const targetTemp = def.baseTemp + heatBoost * (ck === "brakes" ? 4.2 : 1.0) - ((o.wetness || 0) * (ck === "brakes" ? 0.9 : 0.12));
      cState.temp = Math.round(cState.temp + (targetTemp - cState.temp) * 0.42);

      // Calculate authentic physical performance penalty once wear crosses 68%
      let pLoss = 0;
      if (cState.health < 68) {
        const sev = (68 - cState.health) / 60; // 0..1
        if (ck === "ice") {
          pLoss = sev * 0.68;
          totalKphLoss += Math.round(sev * 16);
        } else if (ck === "ers") {
          pLoss = sev * 0.48;
          totalKphLoss += Math.round(sev * 9);
        } else if (ck === "gearbox") {
          pLoss = sev * 0.52;
        } else if (ck === "brakes") {
          pLoss = sev * 0.44;
          mistakeMult += sev * 0.55;
        } else if (ck === "floor") {
          pLoss = sev * 0.58;
        } else if (ck === "suspension") {
          pLoss = sev * 0.42;
          mistakeMult += sev * 0.35;
        }
      }
      cState.paceLossS = +pLoss.toFixed(2);
      totalPaceLoss += pLoss;

      if (!cState.warned && cState.health <= warnThresh) {
        cState.warned = true;
        const issue = { lap: lapNum, comp: ck, label: def.label, severity: "warn", health: Math.round(cState.health), temp: cState.temp, kphLoss: ck === "ice" || ck === "ers" ? Math.max(4, Math.round((68 - cState.health) * 0.35)) : 0, paceLossS: cState.paceLossS, earlyDetect: fb.score >= 82 };
        car.compIssues.push(issue);
        alerts.push(issue);
      } else if (!cState.criticalWarned && cState.health <= critThresh) {
        cState.criticalWarned = true;
        const issue = { lap: lapNum, comp: ck, label: def.label, severity: "critical", health: Math.round(cState.health), temp: cState.temp, kphLoss: ck === "ice" || ck === "ers" ? Math.max(9, Math.round((68 - cState.health) * 0.5)) : 0, paceLossS: cState.paceLossS, earlyDetect: fb.score >= 82 };
        car.compIssues.push(issue);
        alerts.push(issue);
      }
    });

    car.compPaceLossS = +totalPaceLoss.toFixed(3);
    car.compKphLoss = totalKphLoss;
    car.compMistakeMult = +mistakeMult.toFixed(2);

    // Record G-G Friction Circle sample for unique Engineer Lab telemetry plot
    if (car.eng && car.eng.ggPoints.length < 48) {
      const gripMod = (car.tyreLife / 100) * 0.4 + ((car.components.floor.health || 90) / 100) * 0.6;
      const latMax = 3.8 + gripMod * 1.4 - ((o.wetness || 0) / 100) * 1.4;
      const brkMax = 4.2 + ((car.components.brakes.health || 90) / 100) * 1.1;
      const angle = (lapNum * 1.17 + (car.idx || 0) * 0.7) % (Math.PI * 2);
      const rad = 0.55 + Math.random() * 0.44;
      const gx = +(Math.cos(angle) * latMax * rad).toFixed(2);
      const gy = +(Math.sin(angle) * (Math.sin(angle) < 0 ? brkMax : 1.75) * rad).toFixed(2);
      car.eng.ggPoints.push({ lap: lapNum, gx, gy, tyreTemp: Math.round(car.tyreTemp || 96) });
    }

    return alerts;
  }

  /**
   * Compact Race Telemetry & Scrubbable Buffer Recorder shared by /sim and /career.
   */
  function createTelemetryRecorder(circuit, cars, totalLaps, eraRules) {
    const rec = {
      circuitId: circuit ? circuit.id : "",
      circuitName: circuit ? circuit.name : "Grand Prix",
      eraKey: (eraRules && eraRules.key) || "2026",
      eraLabel: (eraRules && eraRules.label) || "2026 Rules",
      totalLaps: totalLaps || 15,
      raceFinished: false,
      drivers: (cars || []).map((c, i) => ({
        idx: c.idx != null ? c.idx : i,
        code3: c.code3,
        name: c.name,
        team: c.team,
        color: c.color,
        gridPos: i + 1,
        isPlayer: Boolean(c.isPlayer || c.isTeam),
        persona: c.persona || "team_player",
        trackAffinity: Number(c.trackAffinity || 0),
        engineerName: c.engineer ? c.engineer.name : "Race Engineer",
        engineerShort: c.engineer ? c.engineer.short : "ENG",
        engineerRating: c.engineer ? (c.engineer.rating || 84) : 84,
      })),
      frames: [],   // Per-lap full-grid telemetry snapshots for smooth scrubbing
      events: [],   // Key race story pins: overtake, pit, sc, mistake, rain, dnf, component
      radioLog: [], // Complete in-race Driver <-> Engineer radio transcript
      lastRecordedLap: -1,

      setFinished(val) {
        this.raceFinished = Boolean(val);
      },

      recordLapSnapshot(lapNum, sortedCars, env) {
        if (lapNum <= this.lastRecordedLap) return;
        this.lastRecordedLap = lapNum;
        const leader = sortedCars[0];
        const baseLapS = (circuit && circuit.base_lap_s) || 85;
        const snap = {
          lap: lapNum,
          wetness: Math.round((env && env.wetness) || 0),
          sc: Boolean(env && env.scActive),
          vsc: Boolean(env && env.vscActive),
          cars: sortedCars.map((c, rank) => {
            const compSnap = {};
            if (c.components) {
              Object.keys(c.components).forEach((k) => {
                compSnap[k] = { h: Math.round(c.components[k].health), t: Math.round(c.components[k].temp), loss: c.components[k].paceLossS || 0 };
              });
            }
            return {
              idx: c.idx,
              pos: rank + 1,
              gap: rank === 0 ? 0 : +Math.max(0, (leader.totalProg - c.totalProg) * baseLapS).toFixed(2),
              lapTime: Number.isFinite(c.lastLapTime) && c.lastLapTime < 400 ? +c.lastLapTime.toFixed(2) : null,
              s1: c.sectorTimes ? +Number(c.sectorTimes[0] || 0).toFixed(2) : 0,
              s2: c.sectorTimes ? +Number(c.sectorTimes[1] || 0).toFixed(2) : 0,
              s3: c.sectorTimes ? +Number(c.sectorTimes[2] || 0).toFixed(2) : 0,
              comp: c.compound,
              tyreLife: Math.round(c.tyreLife ?? 100),
              ers: Math.round(c.ers ?? 50),
              conf: Math.round(c.confidence ?? 60),
              mom: Math.round(c.momentum ?? 0),
              stops: c.stops || 0,
              dnf: Boolean(c.dnf),
              components: compSnap,
              fbScore: c.eng && c.eng.feedback ? c.eng.feedback.score : 70,
              compLossS: +(c.compPaceLossS || 0).toFixed(2),
            };
          }),
        };
        this.frames.push(snap);
      },

      addEvent(lap, type, title, detail, carIdx) {
        if (this.events.length > 320) return;
        this.events.push({ lap: Math.max(1, Math.round(lap || 1)), type, title, detail: detail || "", carIdx: carIdx ?? -1 });
      },

      addRadio(entry) {
        if (!entry || this.radioLog.length > 260) return;
        this.radioLog.push({
          lap: Math.max(1, Math.round(entry.lap || 1)),
          carIdx: entry.carIdx ?? -1,
          code3: entry.code3 || "DRV",
          speaker: entry.speaker || "DRV",
          to: entry.to || "ENG",
          color: entry.color || "#38bdf8",
          category: entry.category || "race", // mechanical | setup | strategy | race
          component: entry.component || "",
          severity: entry.severity || "info", // info | warn | critical | win
          text: entry.text || "",
          engReply: entry.engReply || "",
          feedbackQuality: entry.feedbackQuality ?? null,
        });
      },

      exportPayload(finalSorted, extraOpts) {
        const eo = extraOpts || {};
        const isFin = eo.raceFinished != null ? Boolean(eo.raceFinished) : this.raceFinished;
        return {
          circuitId: this.circuitId,
          circuitName: this.circuitName,
          eraKey: this.eraKey,
          eraLabel: this.eraLabel,
          totalLaps: this.totalLaps,
          raceFinished: isFin,
          drivers: this.drivers,
          frames: this.frames,
          events: this.events,
          radioLog: this.radioLog.slice(),
          stints: (finalSorted || []).map((c) => ({
            idx: c.idx,
            code3: c.code3,
            name: c.name,
            team: c.team,
            color: c.color,
            finishPos: c.finishPos || 99,
            dnf: Boolean(c.dnf),
            dnfReason: c.dnfReason || "",
            stints: c.stintHistory || [],
            endConf: Math.round(c.confidence ?? 60),
            peakConf: Math.round(c.peakConfidence ?? 60),
            minConf: Math.round(c.minConfidence ?? 60),
            endMom: Math.round(c.momentum ?? 0),
            overtakes: c.overtakesMade || 0,
            mistakes: c.mistakesCount || 0,
            pitDelayS: +(c.totalPitDelayS || 0).toFixed(1),
            bestLapS: Number.isFinite(c.bestLapS) && c.bestLapS < 400 ? +c.bestLapS.toFixed(2) : null,
            components: c.components || null,
            compIssues: c.compIssues || [],
            compPaceLossS: +(c.compPaceLossS || 0).toFixed(2),
            compKphLoss: c.compKphLoss || 0,
            engineering: c.eng || null,
          })),
        };
      },
    };
    return rec;
  }

  /**
   * De-overlap and draw crisp screen-space telemetry driver pills on top of the 2D canvas.
   */
  function drawDeoverlappedLabels(ctx, labels, cssW, cssH, opts) {
    const o = opts || {};
    const minDx = o.minDx || 30;
    const minDy = o.minDy || 12;
    const pushFactor = o.pushFactor || 0.5;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i], b = labels[j];
          if (Math.abs(b.x - a.x) < minDx && Math.abs(b.y - a.y) < minDy) {
            const push = (minDy - Math.abs(b.y - a.y)) * pushFactor;
            if (b.y >= a.y) { a.y -= push; b.y += push; } else { a.y += push; b.y -= push; }
          }
        }
      }
    }
    ctx.font = o.font || "800 8.5px 'Source Sans 3', sans-serif";
    const padX = o.padX || 4;
    const h = o.pillH || 12;
    labels.forEach((lb) => {
      const posPrefix = lb.pos ? `${lb.pos} ` : "";
      const txt = lb.inPit ? `${posPrefix}${lb.code} PIT` : `${posPrefix}${lb.code}`;
      const extraDot = lb.compColor ? 7 : 0;
      const extraDrs = lb.drsOpen ? 5 : 0;
      const tw = ctx.measureText(txt).width + 8 + extraDot + extraDrs;
      const lx = Math.max(padX, Math.min(cssW - tw - padX, lb.x));
      const ly = Math.max(h + 2, Math.min(cssH - 8, lb.y));
      const highlight = lb.isPlayer || lb.isFocused;
      ctx.fillStyle = highlight
        ? "rgba(250,204,21,0.95)"
        : (lb.isTeam ? "rgba(56,189,248,0.92)" : "rgba(9,14,26,0.88)");
      ctx.fillRect(lx, ly - (h - 3), tw, h);
      ctx.fillStyle = lb.color || "#e10600";
      ctx.fillRect(lx, ly - (h - 3), 2.5, h);
      if (lb.isInspected && !highlight) {
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1;
        ctx.strokeRect(lx, ly - (h - 3), tw, h);
      }
      ctx.fillStyle = (highlight || lb.isTeam) ? "#0f172a" : "#f1f5f9";
      ctx.fillText(txt, lx + 4.5, ly - 0.5);
      let rx = lx + tw - 4.5;
      if (lb.drsOpen) {
        ctx.fillStyle = "#22c55e";
        ctx.fillRect(rx - 2, ly - (h - 5), 3, h - 4);
        rx -= 5.5;
      }
      if (lb.compColor) {
        ctx.fillStyle = lb.compColor;
        ctx.beginPath();
        ctx.arc(rx, ly - (h * 0.5) + 3, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // True FIA Sporting Regs Art. 59 Classification & Chequered Flag Completion
  // ---------------------------------------------------------------------------
  function sortRaceStandings(cars, applyPenalties) {
    return (cars || []).slice().sort((a, b) => {
      if (!!a.dnf !== !!b.dnf) return a.dnf ? 1 : -1;
      if (a.dnf && b.dnf) return (b.totalProg || 0) - (a.totalProg || 0);

      const aFin = !!a.finishedRace;
      const bFin = !!b.finishedRace;
      if (aFin && bFin) {
        const lapDiff = (b.finishLaps || 0) - (a.finishLaps || 0);
        if (lapDiff !== 0) return lapDiff;
        const aTime = (a.finishTimeS || 0) + (applyPenalties ? (a.timePenaltyS || 0) : 0);
        const bTime = (b.finishTimeS || 0) + (applyPenalties ? (b.timePenaltyS || 0) : 0);
        if (Math.abs(aTime - bTime) > 1e-4) return aTime - bTime;
        return (b.totalProg || 0) - (a.totalProg || 0);
      }
      if (aFin !== bFin) {
        const finCar = aFin ? a : b;
        const runCar = aFin ? b : a;
        // A finished car on Lap N beats any running car still on Lap < N;
        // a running car on Lap N-1 racing toward Lap N beats a lapped car that finished on Lap <= N-1!
        const runLapFloor = Math.floor(runCar.totalProg || 0);
        const finWins = (finCar.finishLaps || 0) > runLapFloor;
        return aFin ? (finWins ? -1 : 1) : (finWins ? 1 : -1);
      }
      return (b.totalProg || 0) - (a.totalProg || 0);
    });
  }

  function evaluateChequeredCompletion(cars, totalLaps, raceClock, chequeredStartS, allUnlappedDoneAt, baseLapS) {
    const running = (cars || []).filter((c) => !c.dnf);
    const finished = running.filter((c) => c.finishedRace);
    const unfinished = running.filter((c) => !c.finishedRace);
    // Unlapped cars still completing the final lap (lap >= totalLaps - 1, or pit-window boundary)
    const activeUnlapped = unfinished.filter((c) => (c.lap || 0) >= totalLaps - 1);
    const elapsedSinceFlag = Math.max(0, (raceClock || 0) - (chequeredStartS || 0));
    const maxGraceCap = Math.max(90, (baseLapS || 85) * 1.25);

    let nextAllUnlappedAt = allUnlappedDoneAt;
    if (activeUnlapped.length === 0 && nextAllUnlappedAt == null) {
      nextAllUnlappedAt = raceClock || 0;
    }

    const done = (
      unfinished.length === 0
      || (activeUnlapped.length === 0 && nextAllUnlappedAt != null && ((raceClock || 0) - nextAllUnlappedAt) >= 4.0)
      || elapsedSinceFlag >= maxGraceCap
    );

    return {
      done,
      finishedCount: finished.length,
      runningCount: running.length,
      activeUnlappedCount: activeUnlapped.length,
      allUnlappedDoneAt: nextAllUnlappedAt,
    };
  }

  global.F1RaceEngine = {
    COMPOUNDS,
    CAR_COMPONENTS,
    ERA_COMPONENT_SETS,
    COMP_KEYS,
    resolveEraTier,
    getEraComponents,
    DEFAULT_ERA_RULES,
    RISK_PROFILES,
    esc,
    clamp,
    fmtLapTime,
    fmtSectorTime,
    registerCircuit,
    fetchCircuit,
    isInDrsZone,
    hasSatisfiedTwoCompoundRule,
    computePitRejoin,
    runFixedSubsteps,
    initDriverPsychology,
    confidenceTier,
    applyPsychologyEvent,
    getDriverBehaviorModifiers,
    computeLapModifiers,
    computeFeedbackQuality,
    initCarEngineering,
    stepComponentWear,
    createTelemetryRecorder,
    drawDeoverlappedLabels,
    sortRaceStandings,
    evaluateChequeredCompletion,
  };
})(window);
