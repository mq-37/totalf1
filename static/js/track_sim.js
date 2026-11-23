/**
 * Interactive F1 Grand Prix Track Simulator — F1-World Faithful Pit Wall Cockpit.
 *
 * Uses shared window.F1TrackRenderer (12-layer biome/water/floodlight/grandstand/
 * banking/tunnel/speed-trap GPS map) + real FIA Sporting & Technical Physics:
 *  - Live Speed (km/h), Gear (G2–G8) & Braking LEDs from local GPS curvature
 *  - Pirelli Tyre Surface Temp (80–122°C thermal window) + 22% degradation cliff
 *  - Fuel Load burn-off (~1.8s faster late in race!) + Track Grip Rubbering-In (35% → 100%)
 *  - Mandatory 2-Compound Dry Rule (✓ 2-COMP vs ⚠ 1-COMP +20s FIA penalty!)
 *  - FIA Race Control: DRS Enabled on Lap 2, Virtual Safety Car (VSC), Full Safety Car (SC),
 *    flashing Sector Yellow Flags, and Purple/Green/Yellow Mini-Sectors (S1/S2/S3)!
 */
(function () {
  "use strict";

  const BOOT = window.F1_ARENA_BOOT || {};
  const CIRCUITS = BOOT.circuits || [];
  const deckCache = new Map();

  const ENG = window.F1RaceEngine;
  const COMPOUNDS = ENG.COMPOUNDS;
  const esc = ENG.esc;
  const fmtLapTime = ENG.fmtLapTime;
  const isInDrsZone = ENG.isInDrsZone;
  const hasSatisfiedTwoCompoundRule = ENG.hasSatisfiedTwoCompoundRule;

  function playSfx(fn) {
    const sfx = window.F1_SFX;
    if (sfx && typeof sfx[fn] === "function") sfx[fn]();
  }

  function getEl(id) { return document.getElementById(id); }

  async function loadDeck(spec) {
    if (spec === "career:active") {
      const r = await fetch("/api/career/state");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const cdata = await r.json();
      if (!cdata.has_career || !cdata.state) {
        return loadDeck(`season:${BOOT.latestYear || 2026}`);
      }
      const st = cdata.state;
      const tMap = Object.fromEntries((st.teams || []).map((t) => [t.id, t]));
      const cards = [];
      let rk = 1;
      // Put player team drivers first so they are #1 & #2 in dropdown!
      const orderedTeams = (st.teams || []).slice().sort((a, b) => (b.is_player ? 1 : 0) - (a.is_player ? 1 : 0) || b.car_overall - a.car_overall);
      orderedTeams.forEach((t) => {
        (t.driver_ids || []).forEach((did) => {
          const d = st.drivers[did];
          if (!d) return;
          const ovr = Math.round((t.car_overall * 0.55 + d.overall * 0.45) * 10) / 10;
          cards.push({
            rank: rk++,
            driver: d.driver,
            clean_name: d.clean_name,
            code3: d.code3,
            overall: ovr,
            hero_team: t.name,
            hero_color: t.color || "#64748b",
            game: { stats: d.stats, ability: d.ability || { name: "Career Spec", desc: t.name } },
          });
        });
      });
      return { source: "career", title: `${cdata.player_team.name} Career Grid`, cards };
    }
    if (deckCache.has(spec)) return deckCache.get(spec);
    const [src, val] = spec.split(":");
    let url = `/api/game/deck?source=${encodeURIComponent(src)}`;
    if (src === "season" && val) url += `&year=${encodeURIComponent(val)}`;
    if (src === "decade" && val) url += `&decade=${encodeURIComponent(val)}`;
    if (src === "alltime" && val && Number(val) > 0) url += `&limit=${encodeURIComponent(val)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    deckCache.set(spec, data);
    return data;
  }

  const sim = {
    booted: false,
    visible: false,
    running: false,
    paused: false,
    finished: false,
    speedMult: 1,
    gapMode: "int",
    circuit: CIRCUITS[0] || null,
    geom: null,
    staticCanvas: null,
    staticKey: "",
    layers: { corners: true, sectors: true, ghost: false, hud: true, line: true, ai: true },
    boxHover: false,
    cars: [],
    carScreenPos: [],
    playerIdx: 0,
    inspectedIdx: null,
    totalLaps: 15,
    weatherMode: "dynamic",
    wetness: 0,
    targetWetness: 0,
    drying: false,
    rainTimer: 0,
    gripPct: 38,          // Evolves 38% -> 100% as rubber lays down!
    drsEnabled: false,    // FIA rule: enabled from Lap 2 in dry green conditions!
    drsAnnounced: false,
    vscLaps: 0,
    safetyCarLaps: 0,
    yellowSector: 0,
    yellowTimer: 0,
    bestSectors: [999, 999, 999],
    raceClock: 0,
    radioCount: 0,
    fastestLap: { time: 999, driver: "" },
    toastTimer: null,
    paceMode: "balanced",
    ersMode: "auto",
    boxNextLap: false,
    boxCompound: "medium",
    lastTs: 0,
    rafId: null,
    lastUiSync: 0,
  };

  function showToast(text, kind) {
    const el = getEl("sim-alert-toast");
    if (!el) return;
    el.textContent = text;
    el.className = `sim-alert-toast ${kind ? "toast-" + kind : ""}`;
    clearTimeout(sim.toastTimer);
    sim.toastTimer = setTimeout(() => el.classList.add("hidden"), 3400);
  }

  function addRadio(lap, text, kind) {
    sim.radioCount += 1;
    const ul = getEl("sim-radio-log");
    if (ul) {
      const li = document.createElement("li");
      li.className = `sim-radio-item radio-${kind || "info"}`;
      li.innerHTML = `<span class="log-lap">L${lap}</span> ${esc(text)}`;
      ul.prepend(li);
      while (ul.children.length > 36) ul.removeChild(ul.lastChild);
    }
    const latest = getEl("sim-radio-latest");
    if (latest) {
      latest.className = `sim-radio-latest radio-${kind || "info"}`;
      latest.innerHTML = `<span class="log-lap">L${lap}</span> ${esc(text)}`;
    }
    const cnt = getEl("sim-radio-count");
    if (cnt) cnt.textContent = `Log (${sim.radioCount})`;
  }

  // isInDrsZone & hasSatisfiedTwoCompoundRule provided by window.F1RaceEngine

  // =========================================================================
  // LIVE 60FPS RENDER USING SHARED 12-LAYER F1TrackRenderer
  // =========================================================================
  function drawTrackCanvas() {
    const R = window.F1TrackRenderer;
    const cv = getEl("sim-track-canvas");
    if (!R || !cv || !sim.circuit) return;
    if (!sim.cam) sim.cam = R.createCamera();
    if (!sim.fx) sim.fx = R.createFxState();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = cv.clientWidth || 720;
    const cssH = cv.clientHeight || 520;
    if (cssW < 40 || cssH < 40) return;

    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
    }

    const cacheKey = `${sim.circuit.id}|${cssW}x${cssH}|${dpr}|${sim.layers.corners}|${sim.layers.sectors}`;
    if (sim.staticKey !== cacheKey || !sim.geom) {
      sim.geom = R.buildGeometry(sim.circuit, cssW, cssH);
      if (!sim.staticCanvas) sim.staticCanvas = document.createElement("canvas");
      R.buildStaticCache(sim.staticCanvas, sim.circuit, sim.geom, dpr, sim.layers);
      sim.staticKey = cacheKey;
    }

    // Update smooth broadcast Follow-Cam / Battle Zoom with lookahead + 2-car battle midpoint framing!
    const camCar = (sim.inspectedIdx != null && sim.cars[sim.inspectedIdx] && !sim.cars[sim.inspectedIdx].dnf)
      ? sim.cars[sim.inspectedIdx]
      : (sim.cars[sim.playerIdx] || sim.cars.find((c) => !c.dnf));
    const camTarget = (camCar && sim.geom && R.computeBattleCameraTarget)
      ? R.computeBattleCameraTarget(camCar, sim.cars, sim.geom, sim.circuit, sim.cam.zoom)
      : null;
    R.updateCamera(sim.cam, camTarget, cssW, cssH, sim.lastDt || 0.016);

    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Begin World-Space Camera Transform (Full 1.0x -> Follow 2.2x -> Battle 3.4x!)
    ctx.save();
    R.applyCameraTransform(ctx, sim.cam, cssW, cssH);
    ctx.drawImage(sim.staticCanvas, 0, 0, cssW, cssH);

    // Dynamic track state (rubbered groove, DRS active/disabled, wet/drying line, sector yellow, VSC/SC)
    R.drawDynamicTrackState(ctx, sim.circuit, sim.geom, {
      gripPct: sim.gripPct,
      drsEnabled: sim.drsEnabled,
      wetness: sim.wetness,
      targetWetness: sim.targetWetness,
      drying: sim.drying,
      raceClock: sim.raceClock,
      yellowSector: sim.yellowSector,
      scActive: sim.safetyCarLaps > 0,
      vscActive: sim.vscLaps > 0,
      showBestLine: sim.layers.line !== false,
    });
    if (R.drawSkidmarks) R.drawSkidmarks(ctx, sim.fx);
    if (R.drawBattleVortices) R.drawBattleVortices(ctx, sim.cars, sim.geom, sim.circuit, sim.cam.zoom);
    if (sim.layers.ai !== false && R.drawAiObservations) R.drawAiObservations(ctx, sim.cars, sim.geom, sim.circuit, sim.cam.zoom, camCar);

    // Safety Car physical pace car ahead of leader (with flashing amber/green FIA roof lightbar!)
    if (sim.safetyCarLaps > 0) {
      const leader = sim.cars.find((c) => !c.dnf && c.pos === 1);
      if (leader) {
        const scPos = R.sampleTrack(sim.geom, leader.totalProg + 0.032);
        R.drawMiniF1Car(ctx, scPos.x, scPos.y, Math.atan2(scPos.ty, scPos.tx), "#005a3c", "#facc15", {
          isPlayer: false,
          isSafetyCar: true,
          zoom: sim.cam.zoom,
          teamName: "Safety Car",
        });
        ctx.font = "800 8.5px Orbitron, sans-serif";
        ctx.fillStyle = "#fde047";
        ctx.fillText("SC", scPos.x + 10, scPos.y - 6);
      }
    }

    // Pit-Rejoin Ghost Marker
    const pCar = sim.cars[sim.playerIdx];
    if (pCar && !pCar.dnf && (sim.boxNextLap || sim.boxHover || sim.layers.ghost)) {
      const pred = computePitRejoin(pCar);
      const gp = R.sampleTrack(sim.geom, pred.rejoinProg);
      ctx.save();
      ctx.beginPath(); ctx.arc(gp.x, gp.y, 10, 0, Math.PI * 2);
      ctx.strokeStyle = pred.cleanAir ? "#22c55e" : "#f59e0b";
      ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = pred.cleanAir ? "rgba(34,197,94,0.2)" : "rgba(245,158,11,0.22)"; ctx.fill();
      const lbl = `REJOIN ~P${pred.pos}`;
      ctx.font = "800 9px Orbitron, sans-serif";
      const tw = ctx.measureText(lbl).width;
      ctx.fillStyle = "rgba(9,14,26,0.92)"; ctx.fillRect(gp.x - tw * 0.5 - 5, gp.y - 24, tw + 10, 14);
      ctx.strokeStyle = pred.cleanAir ? "#22c55e" : "#f59e0b"; ctx.lineWidth = 1; ctx.strokeRect(gp.x - tw * 0.5 - 5, gp.y - 24, tw + 10, 14);
      ctx.fillStyle = pred.cleanAir ? "#86efac" : "#fde68a"; ctx.fillText(lbl, gp.x - tw * 0.5, gp.y - 14);
      ctx.restore();
    }

    // Oriented miniature F1 cars + lateral wheel-to-wheel fighting + spins + braking/ERS/DRS FX
    sim.carScreenPos = [];
    const labels = [];
    const drawOrder = sim.cars.slice().sort((a, b) => {
      const wa = a.idx === sim.playerIdx ? 2 : (a.idx === sim.inspectedIdx ? 1 : 0);
      const wb = b.idx === sim.playerIdx ? 2 : (b.idx === sim.inspectedIdx ? 1 : 0);
      return wa - wb;
    });

    let focusHudInfo = null;
    drawOrder.forEach((car) => {
      if (car.dnf) return;
      const inPit = car.inPit > 0 && car.pitDuration > 0;
      const pitProgress = inPit ? (1 - Math.max(0, Math.min(1, car.inPit / car.pitDuration))) : null;
      const pose = inPit
        ? R.samplePitLane(sim.geom, pitProgress)
        : R.sampleTrack(sim.geom, car.totalProg);
      const lat = inPit ? 0 : (car.latOffset || 0);
      const wx = pose.x + (pose.nx || 0) * lat;
      const wy = pose.y + (pose.ny || 0) * lat;
      const ang = Math.atan2(pose.ty, pose.tx);
      const isPlayer = car.idx === sim.playerIdx;
      const isInspected = car.idx === sim.inspectedIdx;
      const comp = COMPOUNDS[car.compound] || COMPOUNDS.medium;
      const drsOpen = !inPit && sim.drsEnabled && car.inDrsRange && isInDrsZone(sim.circuit, car.totalProg);
      const ersHot = !inPit && car.ersMode === "overtake" && car.ers > 6;
      const harvesting = !inPit && car.ersMode === "harvest";

      const telemRaw = R.computeCarTelemetry(sim.geom, sim.circuit, car.totalProg, {
        car,
        inPit,
        drsOpen,
        ersHot,
        wetness: sim.wetness,
        vscActive: sim.vscLaps > 0,
        scActive: sim.safetyCarLaps > 0,
      });
      const motion = R.computeSmoothCarMotion(car, pose, telemRaw, sim.lastDt || 0.016, inPit);
      const telem = motion.telem;
      car.liveKph = telem.kph;
      car.liveGear = telem.gear;

      const carEra = car.card.hero_era || ((window.F1Car3D && window.F1Car3D.eraForYear && car.card.year)
        ? window.F1Car3D.eraForYear(car.card.year)
        : "2020s");
      const carLiv = car.card.hero_palette
        ? { palette: car.card.hero_palette, style: car.card.hero_livery_style || "two-tone", era: carEra }
        : null;
      R.drawMiniF1Car(ctx, wx, wy, motion.angle, car.card.hero_color || "#e10600", comp.color, {
        isPlayer,
        isInspected,
        ersHot,
        harvesting,
        drsOpen,
        braking: telem.braking,
        brake: telem.brake,
        steerAngle: motion.steerAngle,
        yawSlip: 0,
        tcamYellow: (car.idx % 2 === 1),
        pitProgress,
        wetness: sim.wetness,
        spinAngle: car.spinAngle || 0,
        wingDamaged: !!car.wingDamaged,
        inPit,
        zoom: sim.cam.zoom,
        teamName: car.card.hero_team || "",
        livery: carLiv,
        era: carEra,
      });

      if (camCar && car.idx === camCar.idx) {
        focusHudInfo = {
          code: car.card.code3 || car.card.clean_name.slice(0, 3).toUpperCase(),
          color: car.card.hero_color || "#e10600",
          pos: car.pos || 1,
          compColor: comp.color,
          tyreTemp: car.tyreTemp || 96,
          drsOpen,
          ersHot,
          telem,
          aiObs: car.aiObs || null,
        };
      }

      const sp = R.worldToScreen(sim.cam, wx, wy, cssW, cssH);
      sim.carScreenPos.push({ idx: car.idx, x: sp.x, y: sp.y });
      if (sp.x > -30 && sp.x < cssW + 30 && sp.y > -20 && sp.y < cssH + 20) {
        const lblOff = sim.cam.zoom >= 4.0 ? 22 : (sim.cam.zoom > 1.5 ? 17 : 12);
        labels.push({
          idx: car.idx,
          x: sp.x + lblOff,
          y: sp.y - 5,
          pos: car.pos,
          code: car.card.code3 || car.card.clean_name.slice(0, 3).toUpperCase(),
          color: car.card.hero_color || "#e10600",
          compColor: comp.color,
          drsOpen,
          isPlayer,
          isInspected,
          inPit,
        });
      }
    });

    // Collision Sparks, Carbon Debris, Tyre Smoke & Shockwave FX (in world space!)
    R.stepAndDrawFx(ctx, sim.fx, sim.paused ? 0 : (sim.lastDt || 0.016), sim.cam.zoom);
    ctx.restore();

    // Screen-Space De-overlapped telemetry driver pills (shared F1RaceEngine helper)
    ENG.drawDeoverlappedLabels(ctx, labels, cssW, cssH, {
      minDx: 34, minDy: 14, pushFactor: 0.55,
      font: "800 9px 'Source Sans 3', sans-serif", padX: 6, pillH: 13,
    });

    // F1 TV Broadcast Telemetry Halo & 5-Red-Lights-Out Start Gantry
    if (sim.layers.hud !== false && focusHudInfo && R.drawBroadcastTelemetryHud) {
      R.drawBroadcastTelemetryHud(ctx, focusHudInfo, cssW, cssH);
    }
    if (R.drawStartLightsOverlay) {
      R.drawStartLightsOverlay(ctx, sim.raceClock, cssW, cssH);
    }

    // Picture-in-Picture Full Circuit Radar when zoomed into a battle!
    if (sim.cam.zoom > 1.15) {
      R.drawMiniMapPiP(ctx, sim.geom, sim.cars, (c) => c.idx === sim.playerIdx, cssW, cssH);
    }
  }

  // =========================================================================
  // F1-WORLD PHYSICS, TYRE THERMALS, FUEL BURN & STRATEGY CALCULATORS
  // =========================================================================
  function getRecommendedCompound() {
    if (sim.wetness >= 58 || sim.targetWetness >= 62) return "wet";
    if (sim.wetness >= 22 || sim.targetWetness >= 28) return "inter";
    const p = sim.cars[sim.playerIdx];
    const rem = Math.max(1, sim.totalLaps - (p ? p.lap : 0));
    const pref = rem <= 5 ? "soft" : (rem <= 11 ? "medium" : "hard");
    // Respect mandatory 2-compound dry rule!
    if (p && !p.usedWet && p.dryCompoundsUsed.size === 1 && p.dryCompoundsUsed.has(pref)) {
      return pref === "medium" ? "hard" : "medium";
    }
    return pref;
  }

  function computePitRejoin(car) {
    const scFactor = sim.safetyCarLaps > 0 ? 0.58 : (sim.vscLaps > 0 ? 0.68 : 1.0);
    return ENG.computePitRejoin(sim.cars, car, sim.circuit, sim.circuit.pit_loss_s * scFactor);
  }

  function computeCarLapTime(car, circuit, wetness) {
    const st = car.card.game.stats;
    const comp = COMPOUNDS[car.compound] || COMPOUNDS.medium;
    const wPace = circuit.aero === "LOW" ? 0.42 : (circuit.aero === "HIGH" ? 0.28 : 0.35);
    const wRace = circuit.aero === "HIGH" ? 0.34 : 0.28;
    const skill = st.pace * wPace + st.racecraft * wRace + st.reliability * 0.16 + st.duels * 0.12 + st.clutch * 0.09;

    // Fuel load burn-off (~1.9s faster from Lap 1 heavy fuel to final lap low fuel!) + Track Grip rubber evolution
    const fuelFrac = Math.max(0, 1 - car.lap / Math.max(1, sim.totalLaps));
    const fuelPenalty = fuelFrac * 1.85;
    const gripBonus = ((sim.gripPct - 35) / 65) * 0.65;

    let lapS = circuit.base_lap_s + fuelPenalty - gripBonus - ((skill - 75) * 0.055) + comp.pace;

    // Tyre wear & 22% cliff
    lapS += (100 - car.tyreLife) * 0.018;
    if (car.tyreLife < 22) lapS += (22 - car.tyreLife) * 0.16;

    // Tyre thermal window penalty (Cold < 84°C or Overheating > 114°C)
    if (car.tyreTemp > 114) lapS += (car.tyreTemp - 114) * 0.08;
    else if (car.tyreTemp < 84) lapS += (84 - car.tyreTemp) * 0.06;

    // Weather crossover
    if (wetness >= 60) {
      lapS += comp.wet === 0 ? 7.5 : (comp.wet === 1 ? 1.4 : -0.4);
      lapS -= ((st.racecraft + st.clutch) - 140) * 0.012;
    } else if (wetness >= 22) {
      lapS += comp.wet === 0 ? 3.2 : (comp.wet === 1 ? -0.6 : 1.6);
    } else if (comp.wet > 0) {
      lapS += comp.wet === 1 ? 2.6 : 4.8;
    }

    if (car.paceMode === "push") lapS -= 0.72;
    else if (car.paceMode === "conserve") lapS += 0.55;
    if (car.ersMode === "overtake" && car.ers > 6) lapS -= 0.95;
    else if (car.ersMode === "harvest") lapS += 0.35;
    if (car.inDrsRange && sim.drsEnabled) lapS -= 0.28 * Math.min(3, circuit.drs_zones || 2) * 0.45;
    if (car.wingDamaged) lapS += 0.55;

    const ab = car.card.game.ability && car.card.game.ability.key;
    if (ab === "drs_overtake" && circuit.drs_zones >= 3) lapS -= 0.25;
    if (ab === "tyre_whisperer" && circuit.tyre_wear >= 4) lapS -= 0.25;
    if (ab === "championship_aura" && car.lap >= sim.totalLaps - 3) lapS -= 0.35;
    if (ab === "giant_killer" && car.pos > 3) lapS -= 0.22;

    if (sim.safetyCarLaps > 0) lapS = circuit.base_lap_s * 1.32;
    else if (sim.vscLaps > 0) lapS = circuit.base_lap_s * 1.22;

    lapS += (Math.random() - 0.5) * 0.40;
    return Math.max(circuit.base_lap_s * 0.84, lapS);
  }

  function renderCircuitMeta() {
    const c = sim.circuit;
    if (!c) return;
    sim.staticKey = "";
    const dirName = getEl("sim-dir-name");
    if (dirName) dirName.textContent = c.name;
    const dirSpecs = getEl("sim-dir-specs");
    if (dirSpecs) {
      dirSpecs.textContent = `${c.length_km}km · ${c.turns}T · ${c.drs_zones} DRS · ${c.aero} AERO · Track ${c.track_temp_c || 32}°C · Grip ${Math.round(sim.gripPct)}%`;
    }
    const meta = getEl("sim-circuit-specs");
    if (meta) {
      meta.innerHTML = `
        <span><b>${esc(c.gp)}</b> (${esc(c.country)}) · Top <b>${c.top_speed_kph} km/h</b> · Rain <b>${c.rain_chance}%</b> · Pit <b>${c.pit_loss_s}s</b>${c.lap_record ? ` · Rec <b>${esc(c.lap_record)}</b>` : ""}</span>
        <span>S1: ${esc(c.sectors[0])} · S2: ${esc(c.sectors[1])} · S3: ${esc(c.sectors[2])}</span>
      `;
    }
    drawTrackCanvas();
  }

  function updateDirectorBar() {
    const flagEl = getEl("sim-flag-pill");
    if (flagEl) {
      if (sim.finished) {
        flagEl.className = "sim-flag-pill flag-fin";
        flagEl.innerHTML = `<i class="fas fa-flag-checkered"></i> CHEQUERED`;
      } else if (sim.safetyCarLaps > 0) {
        flagEl.className = "sim-flag-pill flag-sc";
        flagEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> SAFETY CAR (${sim.safetyCarLaps}L)`;
      } else if (sim.vscLaps > 0) {
        flagEl.className = "sim-flag-pill flag-sc";
        flagEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> VSC DEPLOYED`;
      } else if (sim.yellowSector > 0) {
        flagEl.className = "sim-flag-pill flag-sc";
        flagEl.innerHTML = `<i class="fas fa-flag"></i> YELLOW S${sim.yellowSector}`;
      } else {
        flagEl.className = "sim-flag-pill flag-green";
        flagEl.innerHTML = `<i class="fas fa-flag"></i> ${sim.drsEnabled ? "GREEN · DRS ON" : "GREEN FLAG"}`;
      }
    }

    const c = sim.circuit;
    const dirSpecs = getEl("sim-dir-specs");
    if (c && dirSpecs) {
      dirSpecs.textContent = `${c.length_km}km · ${c.turns}T · ${c.aero} AERO · Track ${Math.max(12, Math.round((c.track_temp_c || 32) - sim.wetness * 0.14))}°C · Grip ${Math.round(sim.gripPct)}%`;
    }

    const leaderLap = sim.cars.length ? Math.max(...sim.cars.map((x) => x.lap)) : 0;
    const lapEl = getEl("sim-dir-lap");
    if (lapEl) lapEl.textContent = `${String(Math.min(sim.totalLaps, leaderLap + 1)).padStart(2, "0")} / ${sim.totalLaps}`;

    const wPill = getEl("sim-weather-pill"), wTxt = getEl("sim-weather-text"), wFill = getEl("sim-wet-fill");
    if (wPill && wTxt) {
      const pct = Math.round(sim.wetness);
      let label = `☀️ DRY ${pct}%`, cls = "w-dry";
      if (sim.wetness >= 60) { label = `🌧️ WET ${pct}%`; cls = "w-wet"; }
      else if (sim.wetness >= 22) { label = `🌦️ DAMP ${pct}%`; cls = "w-damp"; }
      else if (sim.targetWetness >= 25) { label = `⛅ RAIN SOON`; cls = "w-warn"; }
      wPill.className = `sim-weather-pill ${cls}`;
      wTxt.textContent = label;
      if (wFill) wFill.style.width = `${Math.min(100, pct)}%`;
    }
  }

  function renderTimingTower() {
    const tbody = getEl("sim-timing-body");
    if (!tbody) return;
    const now = performance.now();
    const sorted = sim.cars.slice().sort((a, b) => (a.dnf !== b.dnf ? (a.dnf ? 1 : -1) : b.totalProg - a.totalProg));
    const leader = sorted[0];

    sorted.forEach((c, idx) => {
      const newPos = idx + 1;
      if (c.pos && c.pos !== newPos && sim.raceClock > 3) {
        c.lastPosDelta = c.pos - newPos;
        c.lastPosChangeTs = now;
      }
      c.pos = newPos;
      if (idx > 0 && !c.dnf && !sorted[idx - 1].dnf) {
        const intS = Math.max(0.05, (sorted[idx - 1].totalProg - c.totalProg) * sim.circuit.base_lap_s);
        c.intervalS = intS;
        c.inDrsRange = intS <= 1.05 && c.inPit === 0;
      } else {
        c.intervalS = 0; c.inDrsRange = false;
      }
    });

    tbody.innerHTML = sorted.map((c, idx) => {
      const isPlayer = c.idx === sim.playerIdx;
      const isInsp = c.idx === sim.inspectedIdx;
      const comp = COMPOUNDS[c.compound] || COMPOUNDS.medium;
      let gapTxt = "LDR", gapCls = "";
      if (c.dnf) gapTxt = "OUT";
      else if (c.inPit > 0) { gapTxt = "PIT"; gapCls = " is-pit"; }
      else if (idx > 0) {
        const diffS = sim.gapMode === "int" ? c.intervalS : Math.max(0.1, (leader.totalProg - c.totalProg) * sim.circuit.base_lap_s);
        gapTxt = diffS >= sim.circuit.base_lap_s ? `+${Math.floor(diffS / sim.circuit.base_lap_s)}L` : `+${diffS.toFixed(1)}`;
        if (sim.gapMode === "int" && c.inDrsRange && sim.drsEnabled) gapCls = " is-drs-range";
      }
      const showDelta = c.lastPosChangeTs && (now - c.lastPosChangeTs) < 2600 && c.lastPosDelta;
      const deltaHtml = showDelta ? (c.lastPosDelta > 0 ? `<span class="st-delta-up">▲</span>` : `<span class="st-delta-dn">▼</span>`) : "";
      const flMark = sim.fastestLap.driver === c.card.clean_name ? `<span class="sim-fl-pill">FL</span>` : "";
      const drsMark = (c.inDrsRange && sim.drsEnabled && !c.dnf) ? `<span class="sim-drs-pill">DRS</span>` : "";
      const penMark = c.penaltyS > 0 ? `<span class="sim-pen-pill">+${c.penaltyS}s</span>` : "";
      const lifePct = Math.max(0, Math.round(c.tyreLife));
      const wearCol = lifePct < 25 ? "#ef4444" : (lifePct < 50 ? "#f59e0b" : "#22c55e");

      return `
        <tr data-car-idx="${c.idx}" class="${isPlayer ? "is-player-row" : ""}${isInsp ? " is-inspected-row" : ""}${c.dnf ? " is-dnf-row" : ""}" title="${esc(c.card.clean_name)} — Click to inspect">
          <td class="st-pos${c.pos <= 3 ? " p" + c.pos : ""}">${c.pos}${deltaHtml}</td>
          <td class="st-drv">
            <span class="st-bar" style="background:${esc(c.card.hero_color)}"></span>
            <span class="st-code">${esc(c.card.code3 || c.card.clean_name.slice(0, 3).toUpperCase())}</span>
            <span class="st-name-full">${esc(c.card.clean_name)}</span>
            ${flMark}${drsMark}${penMark}
          </td>
          <td class="st-gap${gapCls}">${gapTxt}</td>
          <td>
            <div class="st-tyre-cell">
              <span class="sim-tbadge t-${c.compound}">${comp.code}</span>
              <div class="st-wear-col"><small>${lifePct}%</small><span class="st-wear-bar"><i style="width:${lifePct}%;background:${wearCol}"></i></span></div>
            </div>
          </td>
          <td class="st-stops">
            ${c.stops}
            <div class="st-ers-sliver"><i style="width:${Math.round(c.ers)}%"></i></div>
          </td>
        </tr>
      `;
    }).join("");
  }

  function renderPlayerDashboard() {
    const p = sim.cars[sim.playerIdx];
    if (!p) return;
    const comp = COMPOUNDS[p.compound] || COMPOUNDS.medium;
    const life = Math.max(0, Math.round(p.tyreLife));
    const sorted = sim.cars.slice().sort((a, b) => a.pos - b.pos);
    const myRankIdx = sorted.findIndex((c) => c.idx === p.idx);
    const aheadCar = myRankIdx > 0 ? sorted[myRankIdx - 1] : null;
    const behindCar = myRankIdx >= 0 && myRankIdx < sorted.length - 1 ? sorted[myRankIdx + 1] : null;

    const drvCard = getEl("sim-driver-card");
    if (drvCard) drvCard.style.setProperty("--drv-col", p.card.hero_color || "#e10600");
    getEl("sim-p-code").textContent = p.card.code3 || p.card.clean_name.slice(0, 3).toUpperCase();
    getEl("sim-p-name").textContent = p.card.clean_name;
    const abName = p.card.game.ability ? p.card.game.ability.name : "Driver";
    getEl("sim-p-team").textContent = `${p.card.hero_team} · ${abName}`;
    getEl("sim-p-pos").textContent = p.dnf ? "DNF" : `P${p.pos}`;
    getEl("sim-p-lap-time").textContent = p.inPit > 0 ? "IN PIT" : fmtLapTime(p.currentLapS);

    getEl("sim-p-ahead").textContent = !aheadCar || p.dnf ? "▲ RACE LEADER" : `▲ -${Math.max(0.1, (aheadCar.totalProg - p.totalProg) * sim.circuit.base_lap_s).toFixed(1)}s ${aheadCar.card.code3 || aheadCar.card.clean_name.slice(0, 3)}`;
    getEl("sim-p-behind").textContent = !behindCar || behindCar.dnf || p.dnf ? "▼ CLEAR" : `▼ +${Math.max(0.1, (p.totalProg - behindCar.totalProg) * sim.circuit.base_lap_s).toFixed(1)}s ${behindCar.card.code3 || behindCar.card.clean_name.slice(0, 3)}`;

    // Live Speed, Gear, Mini-Sectors (Purple / Green / Yellow) & Mandatory 2-Compound FIA Rule!
    const kphEl = getEl("sim-p-kph");
    if (kphEl) kphEl.textContent = p.dnf ? "0" : String(p.liveKph || 0);
    const gearEl = getEl("sim-p-gear");
    if (gearEl) gearEl.textContent = p.dnf ? "N" : `G${p.liveGear || 5}`;
    const secEl = getEl("sim-p-sectors");
    if (secEl) {
      secEl.innerHTML = [0, 1, 2].map((s) => `<i class="sd-${p.sectorColors[s] || "none"}">S${s + 1}</i>`).join("");
    }
    const ruleEl = getEl("sim-p-rule");
    if (ruleEl) {
      const ok = hasSatisfiedTwoCompoundRule(p);
      ruleEl.textContent = ok ? "✓ 2-COMP" : "⚠ 1-COMP";
      ruleEl.className = `sim-rule-pill ${ok ? "rule-ok" : "rule-warn"}`;
    }

    // Tyre Life, Surface Temp & Cliff
    getEl("sim-p-tyre").innerHTML = `<span class="sim-tbadge t-${p.compound}">${comp.code}</span> ${life}%`;
    const tempEl = getEl("sim-p-temp");
    if (tempEl) {
      const t = Math.round(p.tyreTemp);
      tempEl.textContent = `${t}°C`;
      tempEl.className = `sim-temp-tag ${t > 114 ? "temp-hot" : (t < 84 ? "temp-cold" : "temp-opt")}`;
    }
    const tBar = getEl("sim-p-tyre-bar");
    tBar.style.width = `${life}%`;
    tBar.style.background = life < 25 ? "#ef4444" : (life < 50 ? "#f59e0b" : "#22c55e");

    const baseWear = Math.min(9.2, 165 / Math.max(12, sim.totalLaps));
    const wearMult = (0.65 + sim.circuit.tyre_wear * 0.16) * comp.wear * (p.paceMode === "push" ? 1.28 : (p.paceMode === "conserve" ? 0.72 : 1.0));
    const lapsToCliff = Math.max(0, (p.tyreLife - 22) / (wearMult * baseWear));
    const cliffEl = getEl("sim-p-cliff");
    if (cliffEl) {
      cliffEl.textContent = p.tyreLife < 22 ? "CLIFF! LOSING PACE" : `~${lapsToCliff.toFixed(1)}L to cliff`;
      cliffEl.classList.toggle("is-cliff", p.tyreLife < 22);
    }

    const crossEl = getEl("sim-crossover-alert");
    if (crossEl) {
      let msg = "";
      if (sim.wetness >= 60 && comp.wet < 2) msg = "⚠️ HEAVY RAIN! Box for FULL WETS (W) — losing up to 7.5s/lap!";
      else if (sim.wetness >= 22 && sim.wetness < 60 && comp.wet === 0) msg = "🌦️ TRACK DAMP! Slicks losing +3.2s/L — Box for INTERS (I)!";
      else if (sim.wetness < 22 && comp.wet > 0) msg = "☀️ TRACK DRY! Wet tyres overheating — Box for SLICKS!";
      else if (p.wingDamaged) msg = "🔧 FRONT WING DAMAGED (+0.55s/L)! Box for nose cone swap!";
      else if (p.tyreTemp > 115) msg = "🔥 TYRES OVERHEATING (>115°C)! Switch to Bal/Save to avoid graining!";
      crossEl.textContent = msg;
      crossEl.classList.toggle("hidden", !msg);
    }

    getEl("sim-p-ers").textContent = `${Math.round(p.ers)}%`;
    getEl("sim-p-ers-bar").style.width = `${Math.round(p.ers)}%`;
    getEl("sim-p-ers-flow").textContent = sim.ersMode === "overtake" ? (p.ers > 6 ? "-34%/L OVT" : "LOW BATTERY") : (sim.ersMode === "harvest" ? "+28%/L HARV" : "+6%/L AUTO");
    document.querySelectorAll("[data-sim-ers]").forEach((btn) => btn.classList.toggle("is-ers-hot", btn.dataset.simErs === "overtake" && sim.ersMode === "overtake" && p.ers > 6));
    getEl("sim-pace-delta").textContent = sim.paceMode === "push" ? "-0.72s/L · +Heat" : (sim.paceMode === "conserve" ? "+0.55s/L · Cool" : "Balanced");
    getEl("sim-ers-delta").textContent = sim.ersMode === "overtake" ? "-0.95s/L deploy" : (sim.ersMode === "harvest" ? "+0.35s/L recharge" : "Auto balance");

    const recComp = getRecommendedCompound();
    document.querySelectorAll("[data-sim-box-comp]").forEach((btn) => btn.classList.toggle("is-rec", btn.dataset.simBoxComp === recComp));

    const pred = computePitRejoin(p);
    getEl("sim-pit-loss-tag").textContent = sim.safetyCarLaps > 0 ? `⚡ SC Pit ${pred.pitLossS.toFixed(1)}s (-42%)` : (sim.vscLaps > 0 ? `⚡ VSC Pit ${pred.pitLossS.toFixed(1)}s (-32%)` : `Loss ${pred.pitLossS.toFixed(1)}s`);
    const rejEl = getEl("sim-rejoin-pred");
    if (rejEl) {
      rejEl.className = `sim-rejoin-pred${(sim.safetyCarLaps > 0 || sim.vscLaps > 0) ? " is-sc-cheap" : (pred.cleanAir ? "" : " is-traffic")}`;
      if (sim.safetyCarLaps > 0 || sim.vscLaps > 0) rejEl.textContent = `⚡ CHEAP ${sim.safetyCarLaps > 0 ? "SC" : "VSC"} STOP → REJOIN ~P${pred.pos}`;
      else if (pred.cleanAir) rejEl.textContent = `REJOIN ~P${pred.pos} · CLEAR AIR`;
      else rejEl.textContent = `REJOIN ~P${pred.pos} · TRAFFIC (+${pred.trafficGap.toFixed(1)}s ${pred.trafficCar.card.code3 || "CAR"})`;
    }

    const boxBtn = getEl("sim-box-btn");
    if (boxBtn) {
      boxBtn.classList.toggle("is-armed", sim.boxNextLap);
      boxBtn.innerHTML = sim.boxNextLap
        ? `<i class="fas fa-wrench"></i> BOX CONFIRMED (${COMPOUNDS[sim.boxCompound].code}) — CANCEL <kbd>B</kbd>`
        : `<i class="fas fa-wrench"></i> BOX THIS LAP → ${COMPOUNDS[sim.boxCompound].name.toUpperCase()} <kbd>B</kbd>`;
    }

    renderInspectorCard();
  }

  function renderInspectorCard() {
    const cardEl = getEl("sim-inspector-card");
    if (!cardEl) return;
    if (sim.inspectedIdx == null || !sim.cars[sim.inspectedIdx]) { cardEl.classList.add("hidden"); return; }
    const c = sim.cars[sim.inspectedIdx], p = sim.cars[sim.playerIdx];
    const comp = COMPOUNDS[c.compound] || COMPOUNDS.medium, st = c.card.game.stats;
    const relS = p ? (c.totalProg - p.totalProg) * sim.circuit.base_lap_s : 0;
    const relTxt = c.idx === sim.playerIdx ? "YOUR CAR" : (relS >= 0 ? `${relS.toFixed(1)}s AHEAD` : `${Math.abs(relS).toFixed(1)}s BEHIND`);
    cardEl.classList.remove("hidden");
    getEl("sim-insp-name").textContent = `P${c.pos} · ${c.card.clean_name}`;
    getEl("sim-insp-body").innerHTML = `
      <div><b>${esc(c.card.hero_team)}</b> · <span style="color:#fde047">${esc(relTxt)}</span></div>
      <div>Tyre: <span class="sim-tbadge t-${c.compound}">${comp.code}</span> <b>${Math.round(c.tyreLife)}%</b> (${Math.round(c.tyreTemp)}°C) · <b>${c.liveKph || 0} kph</b></div>
      <div class="sim-insp-grid">
        <div><small>PACE</small><b>${Math.round(st.pace)}</b></div>
        <div><small>RACE</small><b>${Math.round(st.racecraft)}</b></div>
        <div><small>CLUTCH</small><b>${Math.round(st.clutch)}</b></div>
      </div>
    `;
  }

  // =========================================================================
  // SIMULATION STEP (FIA RULES, SECTORS, THERMAL TYRES, VSC/SC)
  // =========================================================================
  function stepSimulation(dt) {
    if (!sim.running || sim.paused || sim.finished) return;
    const lapScale = (sim.circuit.base_lap_s / 22.0) * sim.speedMult;
    const simDt = dt * lapScale;
    sim.raceClock += simDt;

    // Track rubber evolution (38% -> 100%)
    const leaderLap = Math.max(...sim.cars.map((c) => c.lap), 0);
    sim.gripPct = Math.min(100, 38 + (leaderLap / Math.max(1, sim.totalLaps)) * 62);
    if (sim.yellowTimer > 0) {
      sim.yellowTimer -= dt;
      if (sim.yellowTimer <= 0) sim.yellowSector = 0;
    }

    // FIA DRS Enablement Logic (Lap 2+, Dry <20%, Green Flag)
    const shouldDrs = leaderLap >= 1 && sim.wetness < 20 && sim.safetyCarLaps === 0 && sim.vscLaps === 0;
    if (shouldDrs && !sim.drsEnabled && !sim.drsAnnounced && leaderLap >= 1) {
      sim.drsAnnounced = true;
      showToast("🟢 RACE CONTROL: DRS ENABLED!", "win");
      addRadio(leaderLap + 1, "🟢 FIA Race Control: DRS is now ENABLED!", "win");
    }
    sim.drsEnabled = shouldDrs;

    // Realistic lap-based weather fronts (1-2 realistic storms per GP, zero rapid ping-pong!)
    if (sim.weatherMode === "dynamic" || sim.weatherMode === "showers") {
      const curLap = Math.max(1, leaderLap + 1);
      if (sim.nextWeatherLap == null) sim.nextWeatherLap = Math.max(3, Math.round(sim.totalLaps * 0.25));
      if (curLap >= sim.nextWeatherLap) {
        sim.nextWeatherLap = curLap + Math.max(4, Math.round(sim.totalLaps * (0.22 + Math.random() * 0.24)));
        const chance = sim.weatherMode === "showers" ? 0.58 : Math.min(0.65, (sim.circuit.rain_chance || 20) / 100);
        if (Math.random() < chance && sim.targetWetness < 20) {
          sim.targetWetness = Math.random() < 0.35 ? 80 : 46;
          const msg = `🌧️ Weather Radar: ${sim.targetWetness >= 70 ? "Heavy storm" : "Rain shower"} incoming at ${sim.circuit.name}!`;
          addRadio(curLap, msg, "warn"); showToast(msg, "warn"); playSfx("radioAlert");
        } else if (sim.targetWetness >= 20) {
          sim.targetWetness = 0;
          const msg = `☀️ Track drying at ${sim.circuit.name} — dry racing line emerging!`;
          addRadio(curLap, msg, "info"); showToast(msg, "win");
        }
      }
      const prevW = sim.wetness;
      const lapFrac = simDt / sim.circuit.base_lap_s;
      const maxDelta = lapFrac * (sim.targetWetness > sim.wetness ? 14 : 10);
      const diffW = sim.targetWetness - sim.wetness;
      sim.wetness += Math.sign(diffW) * Math.min(Math.abs(diffW), maxDelta);
      sim.drying = sim.wetness < prevW - 0.01;
    }

    const prevLeaderLap = leaderLap;
    const baseWearPerLap = Math.min(9.2, 165 / Math.max(12, sim.totalLaps));

    sim.cars.forEach((car) => {
      if (car.dnf) return;
      const isPlayer = car.idx === sim.playerIdx;
      car.isPlayer = isPlayer;
      if (isPlayer) { car.paceMode = sim.paceMode; car.ersMode = sim.ersMode; }
      else {
        car.paceMode = (car.tyreLife < 26 || car.tyreTemp > 113) ? "conserve" : (car.pos > 1 && car.pos <= 4 ? "push" : "balanced");
        car.ersMode = (car.ers > 60 && car.pos > 1) ? "overtake" : (car.ers < 25 ? "harvest" : "auto");
      }
      car._prevLap = car.lap;
      car._prevSec = Math.floor((((car.totalProg % 1) + 1) % 1) * 3);
      if (car.inPit > 0) {
        car.inPit -= simDt;
        if (car.inPit <= 0) {
          car.inPit = 0; car.pitDuration = 0;
          car.compound = car.nextCompound;
          car.tyreLife = 100;
          car.tyreTemp = 82;
          const fixedWing = !!car.wingDamaged;
          car.wingDamaged = false;
          car.stops += 1;
          car.lastPitLap = car.lap;
          if (COMPOUNDS[car.compound].wet > 0) car.usedWet = true;
          else car.dryCompoundsUsed.add(car.compound);
          addRadio(car.lap + 1, `${car.card.clean_name} exits pits on fresh ${COMPOUNDS[car.compound].name} tyres${fixedWing ? " + fresh front wing!" : "!"}`, isPlayer ? "win" : "info");
        }
      }
    });

    const R = window.F1TrackRenderer;
    let incidents = [];
    if (R && sim.geom) {
      if (!sim.fx) sim.fx = R.createFxState();
      incidents = R.stepBattlePhysics(sim.cars, sim.geom, sim.circuit, sim.fx, {
        dt,
        simDt,
        raceClock: sim.raceClock,
        speedMult: sim.speedMult,
        wetness: sim.wetness,
        leaderLap,
        totalLaps: sim.totalLaps,
        scActive: sim.safetyCarLaps > 0,
        vscActive: sim.vscLaps > 0,
        yellowSector: sim.yellowSector,
        drsEnabled: sim.drsEnabled,
      });
    }

    sim.cars.forEach((car) => {
      if (car.dnf || car.inPit > 0) return;
      const isPlayer = car.idx === sim.playerIdx;

      const prevLap = car._prevLap != null ? car._prevLap : car.lap;
      const prevSec = car._prevSec != null ? car._prevSec : Math.floor((((car.totalProg % 1) + 1) % 1) * 3);
      if (!R || !sim.geom) {
        car.totalProg += (1.0 / car.currentLapS) * simDt;
      }
      car.lap = Math.floor(car.totalProg);
      const curSec = Math.floor((((car.totalProg % 1) + 1) % 1) * 3);

      // Update live Purple / Green / Yellow Mini-Sector indicator!
      if (curSec !== prevSec && car.lap >= 1) {
        const sTime = (car.currentLapS / 3) * (0.97 + Math.random() * 0.06);
        if (sTime < sim.bestSectors[prevSec] && sim.safetyCarLaps === 0 && sim.vscLaps === 0) {
          sim.bestSectors[prevSec] = sTime;
          car.bestSectors[prevSec] = sTime;
          car.sectorColors[prevSec] = "purple";
        } else if (sTime < car.bestSectors[prevSec]) {
          car.bestSectors[prevSec] = sTime;
          car.sectorColors[prevSec] = "green";
        } else {
          car.sectorColors[prevSec] = "yellow";
        }
      }

      // Tyre wear & real thermal physics (Push heats, Conserve cools, SC cools!)
      const comp = COMPOUNDS[car.compound] || COMPOUNDS.medium;
      const targetTemp = sim.safetyCarLaps > 0 ? 78 : (comp.optTemp + (car.paceMode === "push" ? 16 : (car.paceMode === "conserve" ? -12 : 0)) - sim.wetness * 0.12);
      car.tyreTemp += (targetTemp - car.tyreTemp) * Math.min(1, dt * 0.22);

      const thermalWear = car.tyreTemp > 114 ? 1.25 : 1.0;
      const wearMult = (0.65 + sim.circuit.tyre_wear * 0.16) * comp.wear * thermalWear * (car.paceMode === "push" ? 1.28 : (car.paceMode === "conserve" ? 0.72 : 1.0));
      car.tyreLife = Math.max(5, car.tyreLife - (wearMult * (simDt / sim.circuit.base_lap_s) * baseWearPerLap));

      if (car.ersMode === "overtake") car.ers = Math.max(0, car.ers - (simDt / sim.circuit.base_lap_s) * 34);
      else if (car.ersMode === "harvest") car.ers = Math.min(100, car.ers + (simDt / sim.circuit.base_lap_s) * 28);
      else car.ers = Math.min(100, car.ers + (simDt / sim.circuit.base_lap_s) * 6);

      if (car.lap > prevLap) {
        if (car.currentLapS < sim.fastestLap.time && sim.safetyCarLaps === 0 && sim.vscLaps === 0 && car.lap >= 2) {
          sim.fastestLap = { time: car.currentLapS, driver: car.card.clean_name };
        }

        if (car.lap >= sim.totalLaps) {
          // Apply FIA +20s penalty if driver ignored Mandatory 2-Compound Dry Rule!
          if (!hasSatisfiedTwoCompoundRule(car)) {
            car.penaltyS += 20;
            car.totalProg -= 20 / sim.circuit.base_lap_s;
            addRadio(sim.totalLaps, `⚖️ FIA STEWARDS: +20s penalty to ${car.card.clean_name} (Mandatory 2-Compound Rule breached)!`, "warn");
          }
          if (!sim.finished) {
            sim.finished = true; sim.running = false;
            renderTimingTower(); updateDirectorBar();
            const sorted = sim.cars.slice().sort((a, b) => a.pos - b.pos);
            const pCar = sim.cars[sim.playerIdx];
            const podium = sorted.slice(0, 3).map((x, i) => `P${i + 1} ${x.card.clean_name}`).join(" · ");
            addRadio(sim.totalLaps, `🏁 CHEQUERED FLAG! ${podium} | FL: ${sim.fastestLap.driver} (${fmtLapTime(sim.fastestLap.time)})`, "win");
            if (!pCar.dnf && pCar.pos <= 3) playSfx("winLap");
            if (window.F1Profile) {
              window.F1Profile.recordEvent("track_sim", {
                pos: pCar.dnf ? 99 : pCar.pos,
                is_wet: sim.wetness >= 22 || pCar.usedWet,
              });
            }
            const finEl = getEl("sim-finish-banner");
            if (finEl) {
              finEl.classList.remove("hidden");
              finEl.innerHTML = `
                <div>
                  <strong>🏁 CHEQUERED FLAG — ${esc(sim.circuit.name)}!</strong>
                  <div style="font-size:0.82rem;color:#cbd5e1;margin-top:3px;">
                    Your Finish: <b style="color:#fde047">${pCar.dnf ? "DNF" : "P" + pCar.pos}</b> (${esc(pCar.card.clean_name)}) · Podium: ${esc(podium)}
                  </div>
                </div>
                <div style="display:flex;gap:8px;">
                  <button type="button" id="sim-fin-rematch" class="btn-racing"><i class="fas fa-redo"></i> Race Again</button>
                  <button type="button" id="sim-fin-setup" class="sim-dir-btn"><i class="fas fa-sliders-h"></i> Change Track</button>
                </div>
              `;
              getEl("sim-fin-rematch")?.addEventListener("click", startSimulatedGP);
              getEl("sim-fin-setup")?.addEventListener("click", () => toggleSetupDrawer(true));
            }
          }
          return;
        }

        // Mechanical DNF -> Sector Yellow Flag + VSC or Full Safety Car!
        const baseDnfPerLap = (car.card.game.stats.dnf_rate / 100) / Math.max(12, sim.totalLaps * 1.4);
        const pushRisk = car.paceMode === "push" ? 1.45 : (car.paceMode === "conserve" ? 0.55 : 1.0);
        if (car.lap >= 2 && Math.random() < baseDnfPerLap * pushRisk * 0.45) {
          car.dnf = true;
          const secNum = Math.floor((((car.totalProg % 1) + 1) % 1) * 3) + 1;
          sim.yellowSector = secNum;
          sim.yellowTimer = 5.5;
          const corner = sim.circuit.corners[Math.floor(Math.random() * sim.circuit.corners.length)] || `Sector ${secNum}`;
          addRadio(car.lap + 1, `💥 DNF in Sector ${secNum}! ${car.card.clean_name} pulls off at ${corner}!`, "warn");
          if (sim.safetyCarLaps === 0 && sim.vscLaps === 0) {
            const roll = Math.random();
            if (roll < 0.42) {
              sim.safetyCarLaps = 2;
              const scMsg = `⚠️ SAFETY CAR DEPLOYED! Cheap pit window open (-42% loss)!`;
              addRadio(car.lap + 1, scMsg, "warn"); showToast(scMsg, "warn"); playSfx("radioAlert");
            } else if (roll < 0.78) {
              sim.vscLaps = 1;
              const vscMsg = `⚠️ VIRTUAL SAFETY CAR (VSC)! Reduced pit loss (-32%)!`;
              addRadio(car.lap + 1, vscMsg, "warn"); showToast(vscMsg, "warn"); playSfx("radioAlert");
            }
          }
          return;
        }

        // Pit stop trigger (player manual BOX or smart AI with weather hysteresis & realistic 1-3 stops!)
        const scFactor = sim.safetyCarLaps > 0 ? 0.58 : (sim.vscLaps > 0 ? 0.68 : 1.0);
        const effPit = sim.circuit.pit_loss_s * scFactor;
        const lapsLeft = sim.totalLaps - car.lap;
        const lapsSincePit = car.lap - (car.lastPitLap == null ? -99 : car.lastPitLap);
        const minStint = Math.max(3, Math.round(sim.totalLaps * 0.12));
        if (isPlayer && sim.boxNextLap) {
          car.inPit = effPit; car.pitDuration = effPit; car.nextCompound = sim.boxCompound; sim.boxNextLap = false;
        } else if (!isPlayer) {
          let wTarget = null;
          if (comp.wet === 0 && sim.wetness >= 28 && lapsLeft >= 3) wTarget = sim.wetness >= 72 ? "wet" : "inter";
          else if (comp.wet === 1 && sim.wetness >= 76 && lapsLeft >= 5 && lapsSincePit >= 3) wTarget = "wet";
          else if (comp.wet === 2 && sim.wetness <= 40 && lapsLeft >= 5 && lapsSincePit >= 3) wTarget = sim.wetness <= 16 ? "slick" : "inter";
          else if (comp.wet > 0 && sim.wetness <= 16 && lapsLeft >= 3 && lapsSincePit >= 3) wTarget = "slick";

          const mustFulfillRule = !car.usedWet && car.dryCompoundsUsed.size < 2 && lapsLeft <= Math.max(3, Math.round(sim.totalLaps * 0.14)) && lapsLeft >= 2;
          const scOpp = (sim.safetyCarLaps > 0 || sim.vscLaps > 0) && car.tyreLife < 56 && lapsSincePit >= minStint && lapsLeft >= 4;
          const cliff = car.tyreLife < 22 && lapsLeft >= 3 && lapsSincePit >= minStint;
          if (wTarget || mustFulfillRule || scOpp || cliff) {
            car.inPit = effPit; car.pitDuration = effPit;
            if (wTarget === "wet" || wTarget === "inter") car.nextCompound = wTarget;
            else if (sim.wetness >= 24) car.nextCompound = sim.wetness >= 72 ? "wet" : "inter";
            else {
              const remFrac = lapsLeft / Math.max(1, sim.totalLaps);
              let pref = remFrac <= 0.24 ? "soft" : (remFrac <= 0.44 ? "medium" : "hard");
              if (!car.usedWet && car.dryCompoundsUsed.size === 1 && car.dryCompoundsUsed.has(pref)) {
                pref = pref === "medium" ? (remFrac > 0.32 ? "hard" : "soft") : "medium";
              }
              car.nextCompound = pref;
            }
          }
        }

        car.currentLapS = computeCarLapTime(car, sim.circuit, sim.wetness);
      }
    });

    // Process FIA Stewards & Incident Events returned by Physics v2
    if (R && sim.geom) {
      incidents.forEach((ev) => {
        const aName = ev.chaser.card.clean_name, bName = ev.target.card.clean_name;
        const corner = sim.circuit.corners[Math.floor(Math.random() * sim.circuit.corners.length)] || `Sector ${ev.sector}`;
        if (ev.type === "fia_breach") {
          const msg = `⚖️ FIA STEWARDS: ${ev.culprit.card.clean_name} — ${ev.fiaRule} (${ev.verdict})!`;
          addRadio(leaderLap + 1, msg, "warn");
          showToast(msg, "warn");
        } else if (ev.type === "contact") {
          const msg = `💥 WHEEL-TO-WHEEL CONTACT! ${aName} & ${bName} bang wheels at ${corner} — sparks flying!`;
          addRadio(leaderLap + 1, msg, "warn");
          if (ev.chaser.isPlayer || ev.target.isPlayer) showToast(msg, "warn");
        } else if (ev.type === "spin") {
          sim.yellowSector = ev.sector; sim.yellowTimer = 5.0;
          const penTxt = ev.penaltyS ? ` (+${ev.penaltyS}s FIA Penalty!)` : "";
          const msg = `🌀 SPIN & WING DAMAGE at ${corner}! Contact between ${aName} & ${bName}${penTxt}`;
          addRadio(leaderLap + 1, msg, "warn"); showToast(msg, "warn"); playSfx("radioAlert");
        } else if (ev.type === "crash") {
          sim.yellowSector = ev.sector; sim.yellowTimer = 7.0;
          const msg = `🚨 HEAVY COLLISION at ${corner}! ${aName} & ${bName} tangle — SAFETY CAR DEPLOYED!`;
          if (sim.safetyCarLaps === 0) sim.safetyCarLaps = 2;
          addRadio(leaderLap + 1, msg, "warn"); showToast(msg, "warn"); playSfx("radioAlert");
        }
      });
    }

    const newLeaderLap = Math.max(...sim.cars.map((c) => c.lap));
    if (newLeaderLap > prevLeaderLap) {
      if (sim.safetyCarLaps > 0) {
        sim.safetyCarLaps -= 1;
        if (sim.safetyCarLaps === 0) {
          const msg = `🟢 SAFETY CAR IN THIS LAP — GREEN FLAG RACING!`;
          addRadio(newLeaderLap + 1, msg, "win"); showToast(msg, "win");
        }
      }
      if (sim.vscLaps > 0) {
        sim.vscLaps -= 1;
        if (sim.vscLaps === 0) {
          const msg = `🟢 VSC ENDING — GREEN FLAG!`;
          addRadio(newLeaderLap + 1, msg, "win"); showToast(msg, "win");
        }
      }
    }

    const now = performance.now();
    if (now - sim.lastUiSync > 160) {
      sim.lastUiSync = now;
      const oldPos = sim.cars.map((c) => c.pos);
      renderTimingTower();
      sim.cars.forEach((c, idx) => {
        if (!c.dnf && c.pos < oldPos[idx] && oldPos[idx] <= 6 && c.inPit === 0 && Math.random() < 0.5) {
          const corner = sim.circuit.corners[Math.floor(Math.random() * sim.circuit.corners.length)] || "Turn 1";
          addRadio(c.lap + 1, `⚡ ${c.card.clean_name} dives into ${corner} to claim P${c.pos}!`, c.idx === sim.playerIdx ? "win" : "info");
        }
      });
      updateDirectorBar();
      renderPlayerDashboard();
    }
  }

  function loop(ts) {
    sim.rafId = requestAnimationFrame(loop);
    if (!sim.visible) { sim.lastTs = ts; return; }
    if (!sim.lastTs) sim.lastTs = ts;
    const dt = Math.min(0.06, Math.max(0.001, (ts - sim.lastTs) / 1000));
    sim.lastTs = ts;
    sim.lastDt = dt;
    if (sim.running && !sim.paused) stepSimulation(dt);
    drawTrackCanvas();
  }

  // =========================================================================
  // DRAWERS, CONTROLS & SHORTCUTS
  // =========================================================================
  function toggleSetupDrawer(forceState) {
    const dr = getEl("sim-setup-drawer"), btn = getEl("sim-setup-toggle");
    if (!dr || !btn) return;
    const open = typeof forceState === "boolean" ? forceState : dr.classList.contains("hidden");
    dr.classList.toggle("hidden", !open);
    btn.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function toggleRadioDrawer(forceState) {
    const dr = getEl("sim-radio-drawer"), btn = getEl("sim-radio-toggle");
    if (!dr || !btn) return;
    const open = typeof forceState === "boolean" ? forceState : dr.classList.contains("hidden");
    dr.classList.toggle("hidden", !open);
    btn.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  function setSpeed(sp) {
    document.querySelectorAll("[data-sim-speed]").forEach((b) => b.classList.toggle("active", Number(b.dataset.simSpeed) === sp));
    sim.paused = sp === 0;
    if (sp > 0) sim.speedMult = sp;
  }
  function setPace(mode) {
    sim.paceMode = mode;
    document.querySelectorAll("[data-sim-pace]").forEach((b) => b.classList.toggle("active", b.dataset.simPace === mode));
    renderPlayerDashboard();
  }
  function setErs(mode) {
    sim.ersMode = mode;
    document.querySelectorAll("[data-sim-ers]").forEach((b) => b.classList.toggle("active", b.dataset.simErs === mode));
    if (mode === "overtake") playSfx("ersArm");
    renderPlayerDashboard();
  }
  function setBoxCompound(comp) {
    sim.boxCompound = comp;
    document.querySelectorAll("[data-sim-box-comp]").forEach((b) => b.classList.toggle("active", b.dataset.simBoxComp === comp));
    renderPlayerDashboard();
  }
  function toggleBoxCall() {
    if (!sim.running || sim.finished) return;
    sim.boxNextLap = !sim.boxNextLap;
    if (sim.boxNextLap) {
      playSfx("ersArm");
      addRadio((sim.cars[sim.playerIdx]?.lap || 0) + 1, `📻 Pit Wall: Copy, box this lap for ${COMPOUNDS[sim.boxCompound].name} tyres!`, "info");
    }
    renderPlayerDashboard();
  }

  async function populateDriverSelect() {
    const spec = getEl("sim-deck-sel").value;
    const data = await loadDeck(spec);
    const cards = (data.cards || []).slice(0, 20);
    const drvSel = getEl("sim-driver-sel");
    const prev = Number(drvSel.value) || 0;
    drvSel.innerHTML = cards.map((c, i) => `<option value="${i}">#${c.rank} ${esc(c.clean_name)} (${esc(c.hero_team)} · OVR ${Math.round(c.overall)})</option>`).join("");
    if (prev < cards.length) drvSel.value = String(prev);
    return cards;
  }

  async function startSimulatedGP() {
    const cards = await populateDriverSelect();
    const selCir = CIRCUITS.find((c) => c.id === getEl("sim-circuit-sel").value) || CIRCUITS[0];
    sim.circuit = selCir;
    sim.playerIdx = Math.min(cards.length - 1, Number(getEl("sim-driver-sel").value) || 0);
    sim.inspectedIdx = null;
    const dist = getEl("sim-laps-sel").value;
    sim.totalLaps = dist === "full" ? selCir.laps : (parseInt(dist, 10) || 15);
    sim.weatherMode = getEl("sim-weather-sel").value;
    sim.wetness = sim.weatherMode === "rain" ? 78 : (sim.weatherMode === "showers" ? 28 : 0);
    sim.targetWetness = sim.wetness;
    sim.drying = false;
    sim.nextWeatherLap = Math.max(3, Math.round(sim.totalLaps * (0.18 + Math.random() * 0.22)));
    sim.gripPct = 38;
    sim.drsEnabled = false;
    sim.drsAnnounced = false;
    sim.vscLaps = 0;
    sim.safetyCarLaps = 0;
    sim.yellowSector = 0;
    sim.yellowTimer = 0;
    sim.bestSectors = [999, 999, 999];
    sim.raceClock = 0;
    sim.radioCount = 0;
    sim.fastestLap = { time: 999, driver: "" };
    sim.boxNextLap = false;
    sim.boxCompound = sim.wetness >= 60 ? "wet" : (sim.wetness >= 22 ? "inter" : "medium");
    sim.finished = false;
    sim.paused = false;
    sim.running = true;
    if (window.F1TrackRenderer) sim.fx = window.F1TrackRenderer.createFxState();

    setPace("balanced");
    setErs("auto");
    setBoxCompound(sim.boxCompound);
    setSpeed(sim.speedMult || 1);
    toggleSetupDrawer(false);

    const startComp = sim.wetness >= 60 ? "wet" : (sim.wetness >= 22 ? "inter" : "medium");
    sim.cars = cards.map((card, i) => {
      const comp = i < 4 && startComp === "medium" ? "soft" : startComp;
      const isWetStart = COMPOUNDS[comp].wet > 0;
      return {
        idx: i,
        card,
        pos: i + 1,
        lap: 0,
        totalProg: -0.006 * i,
        latOffset: (i % 2 === 0 ? -2.4 : 2.4),
        compound: comp,
        nextCompound: comp,
        dryCompoundsUsed: new Set(isWetStart ? [] : [comp]),
        usedWet: isWetStart,
        tyreLife: 100,
        tyreTemp: COMPOUNDS[comp].optTemp - 4,
        ers: 65,
        stops: 0,
        inPit: 0,
        pitDuration: 0,
        penaltyS: 0,
        dnf: false,
        inDrsRange: false,
        intervalS: 0,
        liveKph: 180,
        liveGear: 4,
        bestSectors: [999, 999, 999],
        sectorColors: ["none", "none", "none"],
        lastPosDelta: 0,
        lastPosChangeTs: 0,
        paceMode: "balanced",
        ersMode: "auto",
        currentLapS: selCir.base_lap_s,
      };
    });
    sim.cars.forEach((c) => { c.currentLapS = computeCarLapTime(c, selCir, sim.wetness); });

    const ul = getEl("sim-radio-log");
    if (ul) ul.innerHTML = "";
    getEl("sim-finish-banner")?.classList.add("hidden");
    renderCircuitMeta();
    renderTimingTower();
    updateDirectorBar();
    renderPlayerDashboard();
    playSfx("lightsOut");
    const startMsg = `🟢 LIGHTS OUT at ${selCir.name} (${selCir.gp})! DRS opens on Lap 2 — remember the 2-compound dry rule!`;
    addRadio(1, startMsg, "win");
    showToast(`🏁 LIGHTS OUT — ${selCir.name.toUpperCase()}`, "win");
  }

  async function initTrackSimulator() {
    if (sim.booted) return;
    sim.booted = true;
    sim.visible = true;

    const cirSel = getEl("sim-circuit-sel");
    if (cirSel && CIRCUITS.length) {
      cirSel.innerHTML = CIRCUITS.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.country)} · ${c.length_km}km${c.is_night ? " 🌙" : ""})</option>`).join("");
      sim.circuit = CIRCUITS[0];
    }

    await populateDriverSelect();
    renderCircuitMeta();

    cirSel.addEventListener("change", () => { sim.circuit = CIRCUITS.find((c) => c.id === cirSel.value) || CIRCUITS[0]; renderCircuitMeta(); });
    getEl("sim-deck-sel").addEventListener("change", populateDriverSelect);
    getEl("sim-start-btn").addEventListener("click", startSimulatedGP);
    getEl("sim-restart-btn")?.addEventListener("click", startSimulatedGP);

    getEl("sim-setup-toggle")?.addEventListener("click", () => toggleSetupDrawer());
    getEl("sim-setup-close")?.addEventListener("click", () => toggleSetupDrawer(false));
    getEl("sim-focus-btn")?.addEventListener("click", () => {
      const on = document.body.classList.toggle("sim-focus-mode");
      const btn = getEl("sim-focus-btn");
      if (btn) { btn.classList.toggle("is-open", on); btn.innerHTML = `<i class="fas fa-${on ? "compress" : "expand"}"></i>`; }
      sim.staticKey = "";
      requestAnimationFrame(() => drawTrackCanvas());
    });
    const simGridEl = getEl("sim-cockpit-grid");
    simGridEl?.querySelectorAll(".sim-dock-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        simGridEl.dataset.dockPane = btn.dataset.dockTarget || "strategy";
        simGridEl.querySelectorAll(".sim-dock-tab").forEach((b) => b.classList.toggle("active", b === btn));
        sim.staticKey = "";
        requestAnimationFrame(() => drawTrackCanvas());
      });
    });
    getEl("sim-radio-toggle")?.addEventListener("click", () => toggleRadioDrawer());
    getEl("sim-radio-close")?.addEventListener("click", () => toggleRadioDrawer(false));
    getEl("sim-insp-close")?.addEventListener("click", () => { sim.inspectedIdx = null; renderInspectorCard(); renderTimingTower(); });

    document.querySelectorAll("[data-sim-speed]").forEach((btn) => btn.addEventListener("click", () => setSpeed(Number(btn.dataset.simSpeed))));
    document.querySelectorAll("[data-sim-pace]").forEach((btn) => btn.addEventListener("click", () => setPace(btn.dataset.simPace)));
    document.querySelectorAll("[data-sim-ers]").forEach((btn) => btn.addEventListener("click", () => setErs(btn.dataset.simErs)));
    document.querySelectorAll("[data-sim-box-comp]").forEach((btn) => btn.addEventListener("click", () => setBoxCompound(btn.dataset.simBoxComp)));
    const boxBtn = getEl("sim-box-btn");
    boxBtn.addEventListener("click", toggleBoxCall);
    boxBtn.addEventListener("mouseenter", () => { sim.boxHover = true; });
    boxBtn.addEventListener("mouseleave", () => { sim.boxHover = false; });

    document.querySelectorAll("[data-sim-gap]").forEach((btn) => {
      btn.addEventListener("click", () => {
        sim.gapMode = btn.dataset.simGap;
        document.querySelectorAll("[data-sim-gap]").forEach((b) => b.classList.toggle("active", b === btn));
        const hd = getEl("sim-gap-col-head");
        if (hd) hd.textContent = sim.gapMode.toUpperCase();
        renderTimingTower();
      });
    });
    document.querySelectorAll("[data-sim-layer]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.simLayer;
        sim.layers[key] = !sim.layers[key];
        btn.classList.toggle("active", sim.layers[key]);
        sim.staticKey = "";
        drawTrackCanvas();
      });
    });

    function setSimCam(mode) {
      const R = window.F1TrackRenderer;
      if (!R) return;
      if (!sim.cam) sim.cam = R.createCamera();
      R.setCameraMode(sim.cam, mode);
      document.querySelectorAll("[data-sim-cam]").forEach((b) => b.classList.toggle("active", b.dataset.simCam === sim.cam.mode));
      drawTrackCanvas();
    }
    document.querySelectorAll("[data-sim-cam]").forEach((btn) => {
      btn.addEventListener("click", () => setSimCam(btn.dataset.simCam));
    });
    getEl("sim-track-canvas")?.addEventListener("wheel", (ev) => {
      const R = window.F1TrackRenderer;
      if (!R) return;
      ev.preventDefault();
      if (!sim.cam) sim.cam = R.createCamera();
      R.zoomCameraBy(sim.cam, ev.deltaY < 0 ? 0.35 : -0.35);
      document.querySelectorAll("[data-sim-cam]").forEach((b) => b.classList.toggle("active", b.dataset.simCam === sim.cam.mode));
      drawTrackCanvas();
    }, { passive: false });

    getEl("sim-timing-body").addEventListener("pointerdown", (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      const tr = ev.target.closest("tr[data-car-idx]");
      if (!tr) return;
      ev.preventDefault();
      const idx = Number(tr.dataset.carIdx);
      sim.inspectedIdx = sim.inspectedIdx === idx ? null : idx;
      renderInspectorCard(); renderTimingTower(); drawTrackCanvas();
    });
    getEl("sim-track-canvas").addEventListener("pointerdown", (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      let hit = null, bestD = 28;
      sim.carScreenPos.forEach((p) => { const d = Math.hypot(p.x - mx, p.y - my); if (d < bestD) { bestD = d; hit = p.idx; } });
      if (hit != null) { sim.inspectedIdx = sim.inspectedIdx === hit ? null : hit; renderInspectorCard(); renderTimingTower(); drawTrackCanvas(); }
    });

    if (window.ResizeObserver) {
      new ResizeObserver(() => { if (sim.visible) drawTrackCanvas(); }).observe(getEl("sim-track-canvas"));
    }

    document.addEventListener("keydown", (ev) => {
      if (!sim.visible) return;
      const tag = (ev.target && ev.target.tagName) || "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const k = ev.key.toLowerCase();
      if (ev.code === "Space") { ev.preventDefault(); setSpeed(sim.paused ? (sim.speedMult || 1) : 0); }
      else if (k === "0") setSpeed(0);
      else if (k === "`" || k === "-") setSpeed(0.5);
      else if (k === "1" && !ev.shiftKey) setSpeed(1);
      else if (k === "2" && !ev.shiftKey) setSpeed(2);
      else if (k === "3" && !ev.shiftKey) setSpeed(4);
      else if (k === "z") {
        const cur = (sim.cam && sim.cam.mode) || "full";
        const order = ["full", "follow", "battle", "close", "heli"];
        const nxt = order[(order.indexOf(cur) + 1) % order.length];
        document.querySelector(`[data-sim-cam="${nxt}"]`)?.click();
      }
      else if (k === "q") setPace("conserve");
      else if (k === "w") setPace("balanced");
      else if (k === "e") setPace("push");
      else if (k === "a") setErs("harvest");
      else if (k === "s") setErs("auto");
      else if (k === "d") setErs("overtake");
      else if (k === "b") toggleBoxCall();
      else if (k === "g") document.querySelector('[data-sim-layer="ghost"]')?.click();
      else if (k === "f") getEl("sim-focus-btn")?.click();
      else if (k === "r") toggleRadioDrawer();
      else if (ev.key === "Escape") { toggleSetupDrawer(false); toggleRadioDrawer(false); sim.inspectedIdx = null; renderInspectorCard(); renderTimingTower(); }
      else if (ev.shiftKey) {
        const map = { "!": "soft", "@": "medium", "#": "hard", "$": "inter", "%": "wet", "1": "soft", "2": "medium", "3": "hard", "4": "inter", "5": "wet" };
        if (map[ev.key]) setBoxCompound(map[ev.key]);
      }
    });

    sim.rafId = requestAnimationFrame(loop);
    startSimulatedGP();
  }

  window.setTrackSimVisible = function (vis) {
    sim.visible = !!vis;
    if (vis && sim.booted) { sim.staticKey = ""; requestAnimationFrame(() => drawTrackCanvas()); }
  };
  window.initTrackSimulator = initTrackSimulator;
})();
