/**
 * Shared F1 Race Simulation Physics & HUD Utilities (/play Track Sim, /sim Full CPU, /career Pit Wall).
 *
 * Single source of truth for Pirelli tyre compound specs, FIA Sporting Regulations
 * (DRS zones, 2-compound dry rule), tyre thermal/wear/weather lap-time modifiers,
 * pit-rejoin prediction, and de-overlapped screen-space driver telemetry pills.
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

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtLapTime(sec) {
    if (!Number.isFinite(sec) || sec <= 0 || sec > 500) return "--.-s";
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
  }

  function isInDrsZone(circuit, prog) {
    const p = ((prog % 1) + 1) % 1;
    return ((circuit && circuit.drs_ranges) || []).some(([a, b]) => p >= a && p <= b);
  }

  function hasSatisfiedTwoCompoundRule(car) {
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
   * Compute canonical tyre wear, thermal window, weather crossover, fuel burn,
   * track rubber grip, pace mode, and wing damage delta (in seconds/lap).
   */
  function computeLapModifiers(opts) {
    const comp = COMPOUNDS[opts.compound] || COMPOUNDS.medium;
    const fuelFrac = Math.max(0, 1 - (opts.lap || 0) / Math.max(1, opts.totalLaps || 15));
    let delta = fuelFrac * 1.85 - (((opts.gripPct || 38) - 35) / 65) * 0.65 + comp.pace;

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

    // Pace mode & damage
    if (opts.paceMode === "push") delta -= 0.72;
    else if (opts.paceMode === "conserve") delta += 0.55;
    if (opts.wingDamaged) delta += 0.55;

    return delta;
  }

  /**
   * De-overlap and draw crisp screen-space telemetry driver pills on top of the canvas.
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
      // Mini Pirelli compound dot + active DRS green pip
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
    esc,
    fmtLapTime,
    isInDrsZone,
    hasSatisfiedTwoCompoundRule,
    computePitRejoin,
    computeLapModifiers,
    drawDeoverlappedLabels,
  };
})(window);
