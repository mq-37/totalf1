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
    }

    return delta;
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
      })),
      frames: [],   // Per-lap full-grid telemetry snapshots for smooth scrubbing
      events: [],   // Key race story pins: overtake, pit, sc, mistake, rain, dnf, radio
      lastRecordedLap: -1,

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
          cars: sortedCars.map((c, rank) => ({
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
          })),
        };
        this.frames.push(snap);
      },

      addEvent(lap, type, title, detail, carIdx) {
        if (this.events.length > 260) return;
        this.events.push({ lap: Math.max(1, Math.round(lap || 1)), type, title, detail: detail || "", carIdx: carIdx ?? -1 });
      },

      exportPayload(finalSorted) {
        return {
          circuitId: this.circuitId,
          circuitName: this.circuitName,
          eraKey: this.eraKey,
          eraLabel: this.eraLabel,
          totalLaps: this.totalLaps,
          drivers: this.drivers,
          frames: this.frames,
          events: this.events,
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

  global.F1RaceEngine = {
    COMPOUNDS,
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
    createTelemetryRecorder,
    drawDeoverlappedLabels,
  };
})(window);
