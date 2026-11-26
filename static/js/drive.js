/**
 * Apex POV (/drive) — Main Controller: Session Lifecycle, 120 Hz Fixed-Timestep Loop,
 * Broadcast HUD, Minimap, Post-Lap Telemetry Trace Analyzer, Driver Career & Career/Ladder Bridge.
 */
(function () {
  "use strict";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const fmtLap = (ms) => {
    const v = Math.max(0, Math.round(Number(ms || 0)));
    if (!v) return "--:--.---";
    const m = Math.floor(v / 60000);
    const s = Math.floor((v % 60000) / 1000);
    const rem = v % 1000;
    return `${m}:${String(s).padStart(2, "0")}.${String(rem).padStart(3, "0")}`;
  };

  async function api(url, method, body) {
    const opts = { method: method || "GET", headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || data.message || "Request failed");
    return data;
  }

  const canvasEl = document.getElementById("drive-canvas");
  const visorEl = document.getElementById("drive-visor-fx");
  const visorCtx = visorEl ? visorEl.getContext("2d") : null;
  const minimapEl = document.getElementById("dh-minimap");
  const minimapCtx = minimapEl ? minimapEl.getContext("2d") : null;

  let impactFlash = 0;
  const visorDrops = Array.from({ length: 48 }, () => ({
    x: Math.random(), y: Math.random(), r: 1.8 + Math.random() * 2.8, vy: 0.15 + Math.random() * 0.4,
  }));

  let world3d = null;
  let cockpit3d = null;
  let inputCtrl = null;
  let audioCtrl = null;
  let track = null;
  let car = null;
  let aiCtrl = null;
  let sessionCfg = null;
  let activeMode = "timetrial"; // timetrial | gp | weekend | career | bridge
  let weekendStage = "race";    // practice | quali | race
  let activeCareerId = null;
  let activeCareerView = null;
  let paddockData = null;
  let quickBuffs = [];
  let quickCompletedCommitments = new Set();
  let loreFilter = "grid";
  let gpStudioUnmount = null;
  let bridgeInfo = null;

  let running = false;
  let paused = true;
  let finished = false;
  let raceTimeS = 0;
  let wetness = 0;
  let targetWetness = 0;
  let accumDt = 0;
  let lastTs = 0;
  let rafId = null;
  let bannerTimer = null;
  let lastLapCount = 0;
  let pbSubmittedMs = 0;
  let bestRecordedSamples = [];

  const assists = { tc: "med", abs: true, autoShift: true, brakeAssist: false, stability: true };

  function showBanner(text, ms) {
    const el = document.getElementById("dh-banner");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("hidden");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.add("hidden"), ms || 3200);
  }

  function readAssistsFromUI() {
    assists.tc = document.getElementById("as-tc")?.value || "med";
    assists.abs = document.getElementById("as-abs")?.value !== "0";
    assists.autoShift = document.getElementById("as-gear")?.value !== "0";
    assists.brakeAssist = document.getElementById("as-brk")?.value === "1";
    assists.stability = assists.tc !== "off";
  }

  function applyAssistPreset(preset) {
    document.querySelectorAll(".dl-preset").forEach((b) => b.classList.toggle("active", b.dataset.preset === preset));
    const setV = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    if (preset === "rookie") {
      setV("as-tc", "full"); setV("as-abs", "1"); setV("as-gear", "1"); setV("as-brk", "1"); setV("as-line", "full"); setV("as-ai-diff", "60");
    } else if (preset === "pro") {
      setV("as-tc", "off"); setV("as-abs", "0"); setV("as-gear", "0"); setV("as-brk", "0"); setV("as-line", "corners"); setV("as-ai-diff", "90");
    } else {
      setV("as-tc", "med"); setV("as-abs", "1"); setV("as-gear", "1"); setV("as-brk", "0"); setV("as-line", "full"); setV("as-ai-diff", "78");
    }
    readAssistsFromUI();
  }

  function ensureEngines() {
    if (!world3d && window.THREE && window.F1DriveWorld3D) {
      world3d = window.F1DriveWorld3D.createDriveWorld(canvasEl);
      world3d.resize();
      window.addEventListener("resize", () => world3d && world3d.resize());
    }
    if (!audioCtrl && window.F1DriveAudio) {
      audioCtrl = window.F1DriveAudio.createDriveAudio();
    }
    if (!inputCtrl && window.F1DriveInput) {
      inputCtrl = window.F1DriveInput.createDriveInput({
        onCycleCamera: () => {
          if (!cockpit3d) return;
          const m = cockpit3d.cycleCamera();
          const btn = document.getElementById("btn-hud-cam");
          if (btn) btn.textContent = `${m.toUpperCase()} [C]`;
        },
        onToggleHalo: () => {
          if (!cockpit3d) return;
          const g = cockpit3d.toggleHaloGhost();
          const btn = document.getElementById("btn-hud-halo");
          if (btn) btn.textContent = `HALO: ${g ? "GHOST" : "SOLID"}`;
        },
        onToggleRacingLine: () => {
          if (!world3d) return;
          const m = world3d.cycleRacingLine();
          const btn = document.getElementById("btn-hud-line");
          if (btn) btn.textContent = `LINE: ${m.toUpperCase()}`;
        },
        onTogglePause: () => {
          if (!running || finished) return;
          if (paused) resumeSession();
          else openPauseModal();
        },
        onBrakeBias: (delta) => {
          if (!car) return;
          car.brakeBias = Math.max(50, Math.min(64, (car.brakeBias || 56) + delta));
          showBanner(`Brake Bias: ${car.brakeBias}% Front`, 1400);
        },
        onBoxRequest: triggerPitStop,
      });
    }
  }

  function triggerPitStop() {
    if (!car || !running || paused || finished) return;
    const nextComp = wetness >= 55 ? "wet" : (wetness >= 24 ? "inter" : (car.compound === "soft" ? "medium" : "soft"));
    const needWing = (car.frontWingHealth || 100) < 82;
    const stopDur = needWing ? 5.8 : 2.6;
    car.compound = nextComp;
    car.inPit = true;
    car.pitTimerS = stopDur;
    showBanner(`BOXING — ${nextComp.toUpperCase()} tyres${needWing ? " + Front Wing Swap" : ""} (${stopDur.toFixed(1)}s)`, 3000);
  }

  async function launchSession(cfg, stageOverride) {
    ensureEngines();
    readAssistsFromUI();
    sessionCfg = cfg;
    bridgeInfo = cfg.bridge || null;
    weekendStage = stageOverride || (cfg.mode === "weekend" ? "practice" : "race");
    const effectiveMode = (cfg.mode === "weekend" && weekendStage !== "race") ? "timetrial" : cfg.mode;
    const runCfg = Object.assign({}, cfg, {
      mode: effectiveMode,
      laps: (cfg.mode === "weekend" && weekendStage === "practice") ? 2 : ((cfg.mode === "weekend" && weekendStage === "quali") ? 1 : cfg.laps),
      physics_dna: Object.assign({}, cfg.physics_dna || {}),
    });
    // Apply active Paddock Story / Commitment weekend buffs into live driving physics!
    const allBuffs = (activeCareerView && activeCareerView.state && activeCareerView.state.active_buffs)
      ? activeCareerView.state.active_buffs
      : quickBuffs;
    allBuffs.forEach((bf) => {
      if (bf && bf.grip_mult) runCfg.physics_dna.grip_mult = (runCfg.physics_dna.grip_mult || 1.0) * Number(bf.grip_mult);
      if (bf && bf.power_mult) runCfg.physics_dna.top_speed_kph = Math.round((runCfg.physics_dna.top_speed_kph || 335) * Number(bf.power_mult));
    });

    const archFn = window.F1TrackArchitect && window.F1TrackArchitect.getCircuitElevationAndBank;
    track = window.F1DrivePhysics.buildDriveTrack(runCfg.circuit, runCfg.physics_dna, archFn);
    if (world3d) world3d.buildCircuit(runCfg.circuit, track);

    const pDrv = runCfg.player_driver || { color: "#ff8000", grid_pos: 1 };
    const startGridPos = effectiveMode === "timetrial" ? 1 : Number(pDrv.grid_pos || 10);
    const slotBase = (window.F1DriveAI && window.F1DriveAI.GRID_BASE_OFFSET_M) || 12.0;
    const slotStep = (window.F1DriveAI && window.F1DriveAI.GRID_SLOT_STEP_M) || 9.2;
    const startDistBack = effectiveMode === "timetrial" ? 45 : (slotBase + (startGridPos - 1) * slotStep);
    const startProg = (((1 - startDistBack / Math.max(1000, track.totalLen)) % 1) + 1) % 1;
    const startLat = effectiveMode === "timetrial" ? 0 : ((startGridPos % 2 === 1) ? -2.45 : 2.45);

    wetness = runCfg.weather_mode === "rain" ? 72 : (runCfg.weather_mode === "dynamic" ? 12 : 0);
    targetWetness = runCfg.weather_mode === "rain" ? 78 : (runCfg.weather_mode === "dynamic" ? 56 : 0);
    const startComp = wetness >= 55 ? "wet" : (wetness >= 25 ? "inter" : "soft");

    car = window.F1DrivePhysics.createCarState(track, runCfg.physics_dna, {
      startProg,
      startLat,
      startLap: 0,
      compound: startComp,
    });
    if (effectiveMode === "timetrial") {
      // Rolling flying approach in Time Trial / Practice / Quali!
      car.vx = 52;
      car.gear = 4;
    }


    if (cockpit3d) cockpit3d.dispose();
    if (world3d && window.F1DriveCockpit3D) {
      cockpit3d = window.F1DriveCockpit3D.createCockpitAndCamera(world3d.scene, pDrv.color, runCfg.physics_dna, pDrv);
      const startCam = document.getElementById("as-cam")?.value || "cockpit";
      cockpit3d.setCameraMode(startCam);
      document.getElementById("btn-hud-cam").textContent = `${startCam.toUpperCase()} [C]`;
    }

    if (world3d) {
      const wantLine = document.getElementById("as-line")?.value || "full";
      while (world3d.getRacingLineMode() !== wantLine) world3d.cycleRacingLine();
      document.getElementById("btn-hud-line").textContent = `LINE: ${wantLine.toUpperCase()}`;
    }

    aiCtrl = window.F1DriveAI.createAiAndGhostController(track, runCfg);
    // Track-temperature grip physics: mean radar-timeline tarmac temp feeds the AI + physics.
    const wtl = ((runCfg.weather_radar || {}).radar || {}).timeline || [];
    const temps = wtl.map((b) => b.track_temp_c).filter((v) => v != null);
    const meanTrackTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : 28;
    if (aiCtrl && aiCtrl.setTrackTempC) aiCtrl.setTrackTempC(meanTrackTemp);
    if (audioCtrl) audioCtrl.init(runCfg.physics_dna.audio_profile);

    document.getElementById("drive-launcher").classList.add("hidden");
    document.getElementById("drive-modal").classList.add("hidden");
    document.getElementById("drive-hud").classList.remove("hidden");

    const modeTitle = cfg.mode === "weekend"
      ? `WEEKEND · ${weekendStage.toUpperCase()}`
      : (cfg.mode === "bridge" ? "TAKE THE WHEEL" : (cfg.mode === "career" ? "DRIVER CAREER" : cfg.mode.toUpperCase()));
    document.getElementById("dh-mode-pill").textContent = modeTitle;
    document.getElementById("dh-circuit-mini").textContent = runCfg.circuit.name;
    document.getElementById("dh-best-lap").textContent = `TARGET ${fmtLap(aiCtrl.ghostTargetMs)}`;

    running = true;
    paused = false;
    finished = false;
    raceTimeS = 0;
    accumDt = 0;
    lastLapCount = 0;
    pbSubmittedMs = (runCfg.personal_best && runCfg.personal_best.best_lap_ms) || 0;
    bestRecordedSamples = [];
    lastTs = performance.now();

    showBanner(
      effectiveMode === "timetrial"
        ? `${runCfg.circuit.name} · Chase ${aiCtrl.ghostLabel}`
        : `${runCfg.circuit.name} · Starting P${startGridPos} — Hold throttle for Lights Out!`,
      3600
    );

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function loop(ts) {
    if (!running) return;
    const rawDt = Math.min(0.05, Math.max(0.001, (ts - lastTs) / 1000));
    lastTs = ts;

    const inp = inputCtrl ? inputCtrl.poll(rawDt, car ? car.speedKph : 0) : { throttle: 0, brake: 0, steer: 0 };
    if (inp.gamepadName) {
      const gb = document.getElementById("dl-gamepad-badge");
      if (gb) gb.textContent = `🎮 ${inp.gamepadFamily ? inp.gamepadFamily.toUpperCase() + " · " : ""}${inp.gamepadName.slice(0, 18)}`;
    }
    if (window.F1GamepadStudio) {
      const hintEl = document.getElementById("dh-input-hint");
      if (hintEl) {
        let dynLine = window.F1GamepadStudio.buildDynamicHintLine("drive");
        if (car && car.drsAvailable && !car.drsOpen) {
          dynLine = `⚡ DRS AVAILABLE — PRESS [${window.F1GamepadStudio.formatActionText("drive", "drs")}] · ` + dynLine;
        } else if (car && (car.tyreLife < 26 || car.frontWingHealth < 65) && !car.inPit) {
          dynLine = `🔧 BOX RECOMMENDED — PRESS [${window.F1GamepadStudio.formatActionText("drive", "boxRequest")}] · ` + dynLine;
        }
        hintEl.textContent = dynLine;
      }
    }

    let proxLeft = false, proxRight = false;
    let standings = [];
    let ghostPose = null;
    let deltaS = 0;

    if (!paused && !finished && car && track && aiCtrl) {
      raceTimeS += rawDt;

      // Dynamic showers progression
      if (targetWetness > wetness && raceTimeS > 18) {
        wetness = Math.min(targetWetness, wetness + rawDt * 0.85);
      }

      // Standing start 5-red-lights sequence
      const stSeq = aiCtrl.stepStartSequence(rawDt, audioCtrl);
      if (world3d) world3d.setStartLights(stSeq.litCount, stSeq.lightsOut);
      updateStartLightsHud(stSeq);

      // Fixed 120 Hz Physics Substeps
      accumDt += rawDt;
      const FIXED = window.F1DrivePhysics.FIXED_DT;
      let steps = 0;
      while (accumDt >= FIXED && steps < 6) {
        window.F1DrivePhysics.stepPhysics(car, track, inp, assists, {
          wetness,
          raceTimeS,
          carsAhead: aiCtrl.aiCars,
          holdOnGrid: stSeq.active,
          drsAllowed: (sessionCfg.mode === "timetrial" || car.lap >= 2),
        }, FIXED);
        if (car.impactStrength > 0.16) impactFlash = Math.min(1.0, Math.max(impactFlash, car.impactStrength));
        accumDt -= FIXED;
        steps++;
      }

      // Step 19 AI cars & spatial collision
      const aiRes = aiCtrl.stepAi(rawDt, car, wetness, raceTimeS);
      proxLeft = aiRes.proxLeft;
      proxRight = aiRes.proxRight;
      standings = aiRes.standings;

      // Rumble haptics on Gamepad
      if (inputCtrl && (car.kerbIntensity > 0.2 || car.impactStrength > 0.15 || car.lockingFront)) {
        inputCtrl.rumble(Math.max(car.kerbIntensity * 0.5, car.lockingFront ? 0.6 : 0), car.impactStrength || 0, 80);
      }

      // Ghost & Delta
      if (sessionCfg.mode === "timetrial" || weekendStage !== "race") {
        ghostPose = aiCtrl.computeGhostPose(car);
        deltaS = aiCtrl.computeLapDeltaS(car);
      } else {
        const myRow = standings.find((r) => r.is_player);
        deltaS = myRow ? myRow.gapLeaderS : 0;
      }

      // Detect newly completed lap -> save PB in Time Trial or finish Race/Weekend!
      if (car.completedLaps.length > lastLapCount) {
        lastLapCount = car.completedLaps.length;
        const cl = car.completedLaps[car.completedLaps.length - 1];
        if (cl.valid && (!bestRecordedSamples.length || cl.lapMs <= car.bestLapMs)) {
          bestRecordedSamples = cl.samples || [];
        }
        if (sessionCfg.mode === "timetrial" && cl.valid) {
          handleTimeTrialLapComplete(cl);
        } else if (sessionCfg.mode === "weekend" && weekendStage === "practice" && car.completedLaps.length >= 2) {
          finishSession(standings, "PRACTICE COMPLETE");
        } else if (sessionCfg.mode === "weekend" && weekendStage === "quali" && car.completedLaps.length >= 1) {
          finishSession(standings, "QUALIFYING COMPLETE");
        } else if (sessionCfg.mode !== "timetrial" && car.lap > Number(sessionCfg.laps || 5)) {
          finishSession(standings, "CHEQUERED FLAG");
        } else if (cl.valid) {
          showBanner(`Lap ${cl.lap}: ${fmtLap(cl.lapMs)} (S1 ${(cl.s1Ms / 1000).toFixed(2)} · S2 ${(cl.s2Ms / 1000).toFixed(2)} · S3 ${(cl.s3Ms / 1000).toFixed(2)})`, 3400);
        } else {
          showBanner(`Lap ${cl.lap}: ${fmtLap(cl.lapMs)} — INVALID (Track Limits)`, 3000);
        }
      }
    } else if (aiCtrl && car) {
      standings = aiCtrl.buildStandings(car);
    }

    if (audioCtrl) audioCtrl.update(car, inp.throttle, paused || finished, wetness);
    if (world3d && car) {
      world3d.updateRacingLine(car);
      world3d.syncAiCars(aiCtrl ? aiCtrl.aiCars : [], ghostPose, wetness, car, (sessionCfg && sessionCfg.year) || 2026);
      world3d.updateWeather(car, wetness, rawDt);
      if (cockpit3d) cockpit3d.update(car, world3d.camera, rawDt, deltaS, proxLeft, proxRight);
      world3d.render();
    }
    if (car) {
      updateHud(car, inp, standings, deltaS);
      drawMinimap(car, aiCtrl ? aiCtrl.aiCars : [], ghostPose);
      drawVisorFX(car, wetness, rawDt);
    }

    rafId = requestAnimationFrame(loop);
  }

  function updateStartLightsHud(stSeq) {
    const el = document.getElementById("dh-start-lights");
    if (!el) return;
    if (!stSeq.active && stSeq.lightsOut) {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    const pods = el.querySelectorAll(".dh-pod");
    pods.forEach((p, idx) => {
      p.classList.toggle("is-red", !stSeq.lightsOut && idx < stSeq.litCount);
      p.classList.toggle("is-green", stSeq.lightsOut);
    });
  }

  function updateHud(c, inp, standings, deltaS) {
    const isTT = sessionCfg && (sessionCfg.mode === "timetrial" || weekendStage !== "race");
    document.getElementById("dh-lap-text").textContent = isTT
      ? `LAP ${Math.max(1, c.lap)}`
      : `LAP ${Math.min(sessionCfg.laps, Math.max(1, c.lap))}/${sessionCfg.laps}`;

    const myRow = standings.find((r) => r.is_player);
    document.getElementById("dh-pos-text").textContent = isTT
      ? `S${c.sector}`
      : `P${myRow ? myRow.pos : 1}/${standings.length}`;

    document.getElementById("dh-cur-lap").textContent = fmtLap(c.lapTimeMs);
    const dp = document.getElementById("dh-delta-pill");
    dp.textContent = `${deltaS <= 0 ? "" : "+"}${deltaS.toFixed(3)}s`;
    dp.classList.toggle("is-slow", deltaS > 0);
    if (c.bestLapMs > 0) document.getElementById("dh-best-lap").textContent = `BEST ${fmtLap(c.bestLapMs)}`;

    // Compact Timing Tower
    const tower = document.getElementById("dh-timing-tower");
    if (tower) {
      const rows = isTT ? standings : standings.slice(0, 8);
      tower.innerHTML = rows.map((r) => `
        <div class="dh-trow${r.is_player ? " is-me" : ""}">
          <span>P${r.pos}</span>
          <span style="color:${esc(r.color)};font-weight:900">${esc(r.code3)}</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name)}</span>
          <span>${(r.compound || "s")[0].toUpperCase()}</span>
          <span>${r.pos === 1 ? "LEAD" : "+" + r.gapLeaderS.toFixed(1)}</span>
        </div>
      `).join("");
    }

    // Telemetry Pod
    const rpmFrac = Math.max(0, Math.min(1, ((c.rpm || 3600) - c.dna.idle_rpm) / Math.max(1000, c.dna.redline_rpm - c.dna.idle_rpm)));
    document.getElementById("dh-rpm-fill").style.width = `${Math.round(rpmFrac * 100)}%`;
    document.getElementById("dh-thr-fill").style.height = `${Math.round((inp.throttle || 0) * 100)}%`;
    document.getElementById("dh-brk-fill").style.height = `${Math.round((inp.brake || 0) * 100)}%`;
    document.getElementById("dh-gear").textContent = String(c.gear || 1);
    document.getElementById("dh-kph").textContent = String(Math.round(c.speedKph || 0));
    document.getElementById("dh-rpm-num").textContent = String(Math.round(c.rpm || 0));

    const drsEl = document.getElementById("dh-drs-tag");
    drsEl.className = `dh-badge${c.drsOpen ? " is-on" : (c.drsAvailable ? " is-ready" : "")}`;
    drsEl.textContent = c.xModeActive ? "X-MODE" : "DRS";

    const ersEl = document.getElementById("dh-ers-tag");
    ersEl.className = `dh-badge${c.ersActive ? " is-ers" : ""}`;
    ersEl.textContent = `ERS ${Math.round(c.ersBattery || 0)}%`;
    document.getElementById("dh-ers-fill").style.width = `${Math.round(c.ersBattery || 0)}%`;

    const pitEl = document.getElementById("dh-pit-tag");
    pitEl.className = `dh-badge${c.pitLimiter ? " is-ready" : ""}`;

    // 4-Corner Tyre Wear/Temp + Component Damage Schematic
    const life4 = c.tyreLife4 || [c.tyreLife, c.tyreLife, c.tyreLife, c.tyreLife];
    const core4 = c.tyreCore4 || [c.coreTemp, c.coreTemp, c.coreTemp, c.coreTemp];
    const ids4 = [["dh-t-fl", "FL"], ["dh-t-fr", "FR"], ["dh-t-rl", "RL"], ["dh-t-rr", "RR"]];
    ids4.forEach(([eid, lbl], idx) => {
      const el = document.getElementById(eid);
      if (!el) return;
      const lf = Math.round(life4[idx]);
      const tp = Math.round(core4[idx]);
      el.textContent = `${lbl} ${lf}% ${tp}°`;
      el.className = "dh-t4" + (lf < 26 || tp > 112 ? " is-crit" : (tp > 104 || lf < 45 ? " is-hot" : (tp < 78 ? " is-cold" : "")));
    });

    const setComp = (id, txt, val, warnLo, badLo, invert) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = txt;
      const isBad = invert ? (val >= badLo) : (val <= badLo);
      const isWarn = invert ? (val >= warnLo) : (val <= warnLo);
      el.className = isBad ? "is-bad" : (isWarn ? "is-warn" : "");
    };
    setComp("dh-c-fw", `FW ${Math.round(c.frontWingHealth)}%`, c.frontWingHealth, 80, 55, false);
    setComp("dh-c-flr", `FLR ${Math.round(c.floorHealth ?? 100)}%`, c.floorHealth ?? 100, 82, 62, false);
    setComp("dh-c-susp", `SUS ${Math.round(c.suspHealth ?? 100)}%`, c.suspHealth ?? 100, 85, 65, false);
    setComp("dh-c-pu", `PU ${Math.round(c.puTemp ?? 96)}°C`, c.puTemp ?? 96, 112, 118, true);

    document.getElementById("dh-tyre-stat").textContent = `${(c.compound || "s")[0].toUpperCase()} · BRK ${Math.round(c.brakeTemp || 350)}°C${c.brakeFade > 0.12 ? " FADE!" : ""}`;
    const envEl = document.getElementById("dh-env-stat");
    if (envEl) envEl.textContent = `RUB ${Math.round((c.trackRubber || 0.35) * 100)}% · WND ${c.windKph || 10}`;
    document.getElementById("dh-bb-stat").textContent = `BB ${c.brakeBias}%`;
    document.getElementById("dh-weather-mini").textContent = wetness >= 45 ? `RAIN ${Math.round(wetness)}%` : (wetness >= 15 ? `DAMP ${Math.round(wetness)}%` : "DRY 0%");

    const alRow = document.getElementById("dh-alerts-row");
    if (alRow) {
      const chips = [];
      if (c.flatSpot > 0.18) chips.push(`<span class="dh-al-chip">FLAT-SPOT ${Math.round(c.flatSpot * 100)}%</span>`);
      if (c.tyreDirty > 0.15) chips.push(`<span class="dh-al-chip">DIRTY TYRES</span>`);
      if (c.inPuddle) chips.push(`<span class="dh-al-chip is-info">AQUAPLANE!</span>`);
      if (c.puOverheat) chips.push(`<span class="dh-al-chip">PU DERATE</span>`);
      if (Math.abs(c.suspPull || 0) > 0.006) chips.push(`<span class="dh-al-chip">STEER PULL</span>`);
      if (c.penaltySec > 0) chips.push(`<span class="dh-al-chip">+${c.penaltySec}s PEN</span>`);
      if (c.inSlipstream) chips.push(`<span class="dh-al-chip is-info">SLIPSTREAM</span>`);
      alRow.innerHTML = chips.join("");
    }
  }

  function drawVisorFX(c, wet, dt) {
    if (!visorCtx || !visorEl) return;
    const rect = visorEl.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect.width || window.innerWidth));
    const h = Math.max(200, Math.round(rect.height || window.innerHeight));
    if (visorEl.width !== w || visorEl.height !== h) { visorEl.width = w; visorEl.height = h; }
    visorCtx.clearRect(0, 0, w, h);

    // 1. High-Speed Peripheral Motion Lines (>285 KPH)
    const kph = c.speedKph || 0;
    if (kph > 285 && !paused) {
      const alpha = Math.min(0.28, ((kph - 285) / 80) * 0.28);
      visorCtx.strokeStyle = `rgba(226, 232, 240, ${alpha.toFixed(3)})`;
      visorCtx.lineWidth = 1.3;
      const cx = w * 0.5, cy = h * 0.48;
      for (let i = 0; i < 18; i++) {
        const ang = (i / 18) * Math.PI * 2 + (performance.now() * 0.002);
        const r1 = Math.min(w, h) * (0.36 + (i % 3) * 0.04);
        const r2 = Math.max(w, h) * 0.65;
        visorCtx.beginPath();
        visorCtx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
        visorCtx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
        visorCtx.stroke();
      }
    }

    // 2. Dynamic Visor Raindrops & Wind-Swept Streaks in Wet Weather
    if ((wet || 0) >= 20) {
      const wf = Math.min(1, wet / 100);
      const count = Math.floor(visorDrops.length * wf);
      const spdPush = 0.25 + (kph / 240) * 1.4;
      visorCtx.strokeStyle = `rgba(186, 230, 253, ${(0.22 + wf * 0.28).toFixed(2)})`;
      visorCtx.fillStyle = `rgba(224, 242, 254, ${(0.28 + wf * 0.26).toFixed(2)})`;
      for (let i = 0; i < count; i++) {
        const d = visorDrops[i];
        d.y += d.vy * spdPush * (dt || 0.016);
        d.x += (d.x - 0.5) * spdPush * 0.35 * (dt || 0.016);
        if (d.y > 1.05 || d.x < -0.05 || d.x > 1.05) {
          d.x = Math.random(); d.y = Math.random() * 0.4;
        }
        const px = d.x * w, py = d.y * h;
        visorCtx.beginPath();
        visorCtx.arc(px, py, d.r, 0, Math.PI * 2);
        visorCtx.fill();
        if (kph > 90) {
          visorCtx.lineWidth = d.r * 0.65;
          visorCtx.beginPath();
          visorCtx.moveTo(px, py);
          visorCtx.lineTo(px - (d.x - 0.5) * 14, py - 10 * spdPush);
          visorCtx.stroke();
        }
      }
    }

    // 3. Red Impact / Heavy Damage Vignette Flash
    if (impactFlash > 0.02) {
      const g = visorCtx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.28, w * 0.5, h * 0.5, Math.max(w, h) * 0.65);
      g.addColorStop(0, "rgba(239, 68, 68, 0)");
      g.addColorStop(1, `rgba(220, 38, 38, ${(impactFlash * 0.55).toFixed(3)})`);
      visorCtx.fillStyle = g;
      visorCtx.fillRect(0, 0, w, h);
      impactFlash = Math.max(0, impactFlash - (dt || 0.016) * 2.2);
    }
  }

  function drawMinimap(c, aiCars, ghostPose) {
    if (!minimapCtx || !track) return;
    const ctx = minimapCtx;
    const w = minimapEl.width, h = minimapEl.height;
    ctx.clearRect(0, 0, w, h);
    const pts = track.pts;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < pts.length; i += 4) {
      if (pts[i].x < minX) minX = pts[i].x;
      if (pts[i].x > maxX) maxX = pts[i].x;
      if (pts[i].z < minZ) minZ = pts[i].z;
      if (pts[i].z > maxZ) maxZ = pts[i].z;
    }
    const pad = 12;
    const sc = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxZ - minZ));
    const ox = (w - (maxX - minX) * sc) * 0.5;
    const oz = (h - (maxZ - minZ) * sc) * 0.5;
    const mx = (x) => ox + (x - minX) * sc;
    const mz = (z) => oz + (z - minZ) * sc;

    ctx.strokeStyle = "rgba(148, 163, 184, 0.55)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 4) {
      const px = mx(pts[i].x), pz = mz(pts[i].z);
      if (i === 0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz);
    }
    ctx.closePath();
    ctx.stroke();

    // AI cars
    for (let i = 0; i < aiCars.length; i++) {
      const a = aiCars[i];
      if (a.dnf) continue;
      ctx.fillStyle = a.color || "#38bdf8";
      ctx.beginPath(); ctx.arc(mx(a.x), mz(a.z), 2.8, 0, Math.PI * 2); ctx.fill();
    }
    // Ghost
    if (ghostPose) {
      ctx.fillStyle = "#22d3ee";
      ctx.beginPath(); ctx.arc(mx(ghostPose.x), mz(ghostPose.z), 3.4, 0, Math.PI * 2); ctx.fill();
    }
    // Player
    ctx.fillStyle = "#fde047";
    ctx.beginPath(); ctx.arc(mx(c.x), mz(c.z), 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 1.2; ctx.stroke();
  }

  function drawTelemetryGraph(samples) {
    const cv = document.getElementById("dm-telem-canvas");
    const wrap = document.getElementById("dm-telem-wrap");
    if (!cv || !wrap || !samples || samples.length < 4) {
      if (wrap) wrap.classList.add("hidden");
      return;
    }
    wrap.classList.remove("hidden");
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#060b16";
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = "rgba(148,163,184,0.14)";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const y = (h / 4) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const plotLine = (getVal, maxV, col) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      samples.forEach((s, i) => {
        const x = (i / (samples.length - 1)) * w;
        const y = h - 8 - (Math.max(0, Math.min(maxV, getVal(s))) / maxV) * (h - 18);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    plotLine((s) => s.th || 0, 100, "#22c55e");
    plotLine((s) => s.br || 0, 100, "#ef4444");
    plotLine((s) => s.k || 0, 360, "#38bdf8");
  }

  async function handleTimeTrialLapComplete(cl) {
    if (pbSubmittedMs === 0 || cl.lapMs < pbSubmittedMs) {
      pbSubmittedMs = cl.lapMs;
      showBanner(`🔥 NEW PERSONAL BEST: ${fmtLap(cl.lapMs)} — Saved Ghost to SQLite!`, 4500);
      try {
        await api("/api/drive/timetrial/commit", "POST", {
          circuit_id: sessionCfg.circuit.id,
          era_key: sessionCfg.era_key,
          driver_name: sessionCfg.player_driver.name,
          team_name: sessionCfg.player_driver.team,
          best_lap_ms: cl.lapMs,
          s1_ms: cl.s1Ms,
          s2_ms: cl.s2Ms,
          s3_ms: cl.s3Ms,
          assists,
          ghost: cl.samples || [],
          telemetry: { samples: (cl.samples || []).slice(0, 450) },
        });
      } catch (_) {}
    } else {
      showBanner(`Lap ${cl.lap}: ${fmtLap(cl.lapMs)} (+${((cl.lapMs - pbSubmittedMs) / 1000).toFixed(3)}s off PB)`, 3200);
    }
  }

  function openPauseModal() {
    paused = true;
    document.getElementById("dm-kicker").textContent = "SESSION PAUSED";
    document.getElementById("dm-title").textContent = `${sessionCfg.circuit.name} · ${sessionCfg.era_key.toUpperCase()}`;
    const samples = bestRecordedSamples.length ? bestRecordedSamples : (car ? car.lapSamples : []);
    document.getElementById("dm-body").innerHTML = `
      <div class="dl-rec-row"><span>Best Lap</span><b>${fmtLap(car.bestLapMs)}</b></div>
      <div class="dl-rec-row"><span>F1DB Reference Target</span><b>${fmtLap(aiCtrl.ghostTargetMs)}</b></div>
      <div class="dl-rec-row"><span>Tyre Life / Front Wing</span><b>${Math.round(car.tyreLife)}% / ${Math.round(car.frontWingHealth)}%</b></div>
    `;
    drawTelemetryGraph(samples);
    const acts = document.getElementById("dm-actions");
    acts.innerHTML = `
      <button type="button" id="dm-resume" class="dh-btn dh-btn-red">Resume Cockpit</button>
      <button type="button" id="dm-controls" class="dh-btn"><i class="fas fa-gamepad"></i> Controller Setup</button>
      <button type="button" id="dm-restart" class="dh-btn">Restart Session</button>
      <button type="button" id="dm-paddock" class="dh-btn">Exit to Paddock</button>
    `;
    document.getElementById("dm-resume").addEventListener("click", resumeSession);
    document.getElementById("dm-controls").addEventListener("click", () => {
      if (!window.F1GamepadStudio) return;
      document.getElementById("dm-telem-wrap")?.classList.add("hidden");
      if (gpStudioUnmount) gpStudioUnmount();
      gpStudioUnmount = window.F1GamepadStudio.mountStudio(document.getElementById("dm-body"), { context: "drive" });
    });
    document.getElementById("dm-restart").addEventListener("click", () => launchSession(sessionCfg, weekendStage));
    document.getElementById("dm-paddock").addEventListener("click", exitToLauncher);
    document.getElementById("drive-modal").classList.remove("hidden");
  }

  function resumeSession() {
    if (gpStudioUnmount) { gpStudioUnmount(); gpStudioUnmount = null; }
    paused = false;
    lastTs = performance.now();
    document.getElementById("drive-modal").classList.add("hidden");
  }

  function exitToLauncher() {
    if (gpStudioUnmount) { gpStudioUnmount(); gpStudioUnmount = null; }
    running = false;
    paused = true;
    if (rafId) cancelAnimationFrame(rafId);
    if (audioCtrl) audioCtrl.update(null, 0, true);
    document.getElementById("drive-modal").classList.add("hidden");
    document.getElementById("drive-hud").classList.add("hidden");
    document.getElementById("drive-launcher").classList.remove("hidden");
    refreshLeaderboards();
    if (activeCareerId) loadDriverCareer(activeCareerId);
    refreshPaddockHub();
  }

  async function finishSession(standings, titleText) {
    finished = true;
    paused = true;
    const myRow = standings.find((r) => r.is_player) || { pos: 1 };
    const samples = bestRecordedSamples.length ? bestRecordedSamples : (car ? car.lapSamples : []);
    document.getElementById("dm-kicker").textContent = titleText;
    document.getElementById("dm-title").textContent = `${sessionCfg.circuit.name} — Finished P${myRow.pos}`;

    let extraHtml = "";
    // Auto-commit Driver Career race!
    if (sessionCfg.mode === "career" && activeCareerId) {
      try {
        const res = await api(`/api/drive/career/${encodeURIComponent(activeCareerId)}/race/commit`, "POST", {
          standings: standings.map((r) => ({ driver_id: r.driver_id, name: r.name, pos: r.pos, dnf: r.dnf })),
          player_grid_pos: sessionCfg.player_driver.grid_pos || 10,
          best_lap_ms: car.bestLapMs || 0,
        });
        activeCareerView = res.view;
        extraHtml = `<div class="dl-rec-row" style="border-color:#22c55e"><span>Driver Career Saved</span><b>+${res.points_scored} pts · Acclaim ${res.acclaim_delta >= 0 ? "+" : ""}${res.acclaim_delta} · ${res.beat_teammate ? "Beat Teammate!" : "Trailed Teammate"}</b></div>`;
      } catch (e) {
        extraHtml = `<div class="dl-rec-row"><span>Career Commit Error</span><b>${esc(e.message)}</b></div>`;
      }
    }

    // Auto-commit Ladder Take-the-Wheel bridge!
    if (bridgeInfo && bridgeInfo.source === "ladder" && bridgeInfo.commit_url) {
      try {
        await api(bridgeInfo.commit_url, "POST", {
          standings: standings.map((r) => ({
            driver_id: r.driver_id,
            name: r.name,
            pos: r.pos,
            dnf: r.dnf,
            crash_damage: r.is_player && car.frontWingHealth < 70,
          })),
          telemetry: { weather_summary: wetness >= 25 ? "Wet / Mixed" : "Dry", safety_cars: 0, driven_pov: true },
        });
        extraHtml = `<div class="dl-rec-row" style="border-color:#22c55e"><span>Ladder Pit Wall Synced!</span><b>P${myRow.pos} committed to your Ladder save!</b></div>`;
      } catch (e) {
        extraHtml = `<div class="dl-rec-row"><span>Ladder Sync Error</span><b>${esc(e.message)}</b></div>`;
      }
    }

    const clsRows = standings.slice(0, 12).map((r) => `
      <div class="dl-rec-row" style="${r.is_player ? "border-color:#fde047;color:#fef08a" : ""}">
        <span><b>P${r.pos}</b> · ${esc(r.name)} (${esc(r.team)})</span>
        <span>${r.pos === 1 ? "WINNER" : "+" + r.gapLeaderS.toFixed(1) + "s"}</span>
      </div>
    `).join("");

    document.getElementById("dm-body").innerHTML = `
      ${extraHtml}
      <div class="dl-rec-row"><span>Best Lap / Target</span><b>${fmtLap(car.bestLapMs)} vs ${fmtLap(aiCtrl.ghostTargetMs)}</b></div>
      ${clsRows}
    `;
    drawTelemetryGraph(samples);

    const acts = document.getElementById("dm-actions");
    if (sessionCfg.mode === "weekend" && weekendStage === "practice") {
      acts.innerHTML = `<button type="button" id="dm-next-stage" class="dh-btn dh-btn-red">Advance to Qualifying Shootout →</button><button type="button" id="dm-paddock" class="dh-btn">Exit</button>`;
      document.getElementById("dm-next-stage").addEventListener("click", () => launchSession(sessionCfg, "quali"));
    } else if (sessionCfg.mode === "weekend" && weekendStage === "quali") {
      // Set player's grid position based on quali lap vs F1DB target!
      const ratio = (car.bestLapMs || aiCtrl.ghostTargetMs * 1.06) / aiCtrl.ghostTargetMs;
      const qPos = Math.max(1, Math.min(20, Math.round(1 + (ratio - 0.99) * 140)));
      sessionCfg.player_driver.grid_pos = qPos;
      acts.innerHTML = `<button type="button" id="dm-next-stage" class="dh-btn dh-btn-red">Start Grand Prix from P${qPos} →</button><button type="button" id="dm-paddock" class="dh-btn">Exit</button>`;
      document.getElementById("dm-next-stage").addEventListener("click", () => launchSession(sessionCfg, "race"));
    } else if (bridgeInfo && bridgeInfo.return_url) {
      acts.innerHTML = `<a href="${esc(bridgeInfo.return_url)}" class="dh-btn dh-btn-red" style="text-decoration:none">Return to ${bridgeInfo.source.toUpperCase()} Pit Wall →</a><button type="button" id="dm-paddock" class="dh-btn">Stay in /drive</button>`;
    } else {
      acts.innerHTML = `<button type="button" id="dm-restart" class="dh-btn dh-btn-primary">Race Again</button><button type="button" id="dm-paddock" class="dh-btn dh-btn-red">Back to Paddock</button>`;
      document.getElementById("dm-restart")?.addEventListener("click", () => launchSession(sessionCfg, weekendStage));
    }
    document.getElementById("dm-paddock")?.addEventListener("click", exitToLauncher);
    document.getElementById("drive-modal").classList.remove("hidden");
  }

  // --- Launcher & Driver Career UI ---
  async function refreshLeaderboards() {
    const box = document.getElementById("dl-tt-records");
    if (!box) return;
    const cid = document.getElementById("in-circuit")?.value || "melbourne";
    try {
      const res = await api(`/api/drive/leaderboards?circuit=${encodeURIComponent(cid)}&limit=5`);
      const recs = res.records || [];
      box.innerHTML = recs.length
        ? `<div style="font-size:0.64rem;color:#38bdf8;font-weight:800">YOUR TIME TRIAL RECORDS (${cid.toUpperCase()})</div>` + recs.map((r) => `
            <div class="dl-rec-row"><span>${esc(r.era_key.toUpperCase())} · ${esc(r.driver_name)} (${esc(r.team_name)})</span><b>${fmtLap(r.best_lap_ms)}</b></div>
          `).join("")
        : `<div class="dl-rec-row"><span>No personal best on ${esc(cid)} yet — set a lap to save your Ghost!</span></div>`;
    } catch (_) {}
  }

  async function refreshCareerSaves() {
    const sel = document.getElementById("dc-save-sel");
    if (!sel) return;
    const res = await api("/api/drive/careers");
    const list = res.careers || [];
    sel.innerHTML = `<option value="">Select Driver Career (${list.length})...</option>` + list.map((c) =>
      `<option value="${esc(c.save_id)}"${c.save_id === activeCareerId ? " selected" : ""}>#${c.driver_number} ${esc(c.driver_name)} · ${esc(c.team_name)} S${c.season} R${c.round}</option>`
    ).join("");
    if (!activeCareerId && list.length) {
      await loadDriverCareer(list[0].save_id);
    }
  }

  async function loadDriverCareer(saveId) {
    if (!saveId) return;
    const res = await api(`/api/drive/career/${encodeURIComponent(saveId)}`);
    activeCareerId = saveId;
    activeCareerView = res.view;
    localStorage.setItem("traf1_drive_career", saveId);
    renderDriverCareer();
    refreshPaddockHub();
  }

  // --- Full Paddock HQ: Stories, News, Social Buzz, Commitments, Driver Cards & F1 Lore ---
  async function refreshPaddockHub() {
    try {
      const q = new URLSearchParams({
        circuit: document.getElementById("in-circuit")?.value || "melbourne",
        era: document.getElementById("in-era")?.value || "2026",
        team: document.getElementById("in-team")?.value || "McLaren",
        driver: document.getElementById("in-drv-name")?.value || "Alex Vance",
      });
      if (activeCareerId) q.set("save_id", activeCareerId);
      paddockData = await api(`/api/drive/paddock?${q.toString()}`);
      renderPaddockMetrics();
      renderPaddockStoriesAndBuzz();
      renderCardsAndLore();
    } catch (_) {}
  }

  function renderPaddockMetrics() {
    const bar = document.getElementById("dl-paddock-metrics");
    const dot = document.getElementById("dl-story-dot");
    if (!paddockData) return;
    const m = paddockData.metrics || {};
    const buffs = (paddockData.active_buffs || []).concat(m.career_active ? [] : quickBuffs);
    if (dot) {
      const cnt = (paddockData.stories || []).length;
      dot.textContent = String(cnt);
      dot.classList.toggle("hidden", cnt === 0);
    }
    if (!bar) return;
    bar.innerHTML = `
      <span class="dl-metric-pill">⭐ Acclaim <b>${m.acclaim ?? 42}</b></span>
      <span class="dl-metric-pill">🤝 TP Trust <b>${m.tp_trust ?? 70}</b></span>
      <span class="dl-metric-pill">🔧 Morale <b>${m.team_morale ?? 74}</b></span>
      <span class="dl-metric-pill">🎙 Media <b>${m.media_rep ?? 58}</b></span>
      <span class="dl-metric-pill">🧠 Focus <b>${m.focus ?? 90}</b></span>
      <span class="dl-metric-pill">🔥 Rival (${esc(m.rival_name || "Rival")}) <b>${m.rivalry_heat ?? 28}</b></span>
      ${buffs.map((bf) => `<span class="dl-metric-pill is-buff"><i class="fas fa-bolt"></i> ${esc(bf.label)}</span>`).join("")}
    `;
  }

  function renderPaddockStoriesAndBuzz() {
    if (!paddockData) return;
    const sList = document.getElementById("dp-stories-list");
    const cList = document.getElementById("dp-commitments-list");
    const nList = document.getElementById("dp-news-list");
    const socList = document.getElementById("dp-social-list");

    if (sList) {
      const stories = paddockData.stories || [];
      const hist = paddockData.story_history || [];
      sList.innerHTML = stories.length
        ? stories.map((st) => `
            <div class="dp-story-card" style="border-left-color:${esc(st.accent || "#e10600")}">
              <div class="dp-story-head">
                <span class="dp-story-badge${st.kind === "driver_story" ? " is-drv" : ""}">${esc(st.badge)}</span>
                <span class="dp-story-actor">${esc(st.actor)} · ${esc(st.role)}</span>
              </div>
              <h4 class="dp-story-title">${esc(st.title)}</h4>
              <p class="dp-story-body">${esc(st.body)}</p>
              <div class="dp-choices-row">
                ${(st.choices || []).map((ch) => `
                  <button type="button" class="dp-choice-btn" data-story-id="${esc(st.id)}" data-choice-id="${esc(ch.id)}">
                    <strong>${esc(ch.label)}</strong>
                    <small>${esc(ch.hint)}</small>
                  </button>
                `).join("")}
              </div>
            </div>
          `).join("")
        : `<div class="dl-rec-row"><span>All paddock story chapters resolved for this Grand Prix weekend! Drive the race to unlock the next chapter.</span></div>`
          + hist.slice(0, 3).map((h) => `<div class="dp-news-item"><div class="dp-news-meta"><span>RESOLVED · ${esc(h.badge)}</span><span>R${h.round}</span></div><b>${esc(h.actor)} — ${esc(h.chosen)}</b><p>${esc(h.outcome)}</p></div>`).join("");

      sList.querySelectorAll(".dp-choice-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const sid = btn.dataset.storyId;
          const cid = btn.dataset.choiceId;
          if (activeCareerId) {
            const res = await api(`/api/drive/career/${encodeURIComponent(activeCareerId)}/story/choose`, "POST", { story_id: sid, choice_id: cid });
            activeCareerView = res.view;
            paddockData = res.paddock;
            renderDriverCareer();
            renderPaddockMetrics();
            renderPaddockStoriesAndBuzz();
            showBanner(res.message, 3800);
          } else {
            // Standalone Quick Drive interactive resolution!
            const idx = (paddockData.stories || []).findIndex((x) => x.id === sid);
            if (idx >= 0) {
              const stObj = paddockData.stories[idx];
              const chObj = (stObj.choices || []).find((x) => x.id === cid);
              if (chObj) {
                if (chObj.buff) quickBuffs.push(chObj.buff);
                if (chObj.social) {
                  paddockData.social_feed.unshift({ handle: "@PaddockBuzz", author: "Paddock Buzz Live", verified: true, text: chObj.social, likes: 5400, reposts: 1120 });
                }
                paddockData.news_feed.unshift({ tag: "STORYLINE", source: stObj.badge, title: `${stObj.actor}: ${chObj.label}`, body: chObj.outcome, round: 1 });
                Object.entries(chObj.deltas || {}).forEach(([k, dv]) => {
                  if (paddockData.metrics && paddockData.metrics[k] != null) {
                    paddockData.metrics[k] = Math.max(5, Math.min(100, paddockData.metrics[k] + dv));
                  }
                });
                paddockData.stories.splice(idx, 1);
                renderPaddockMetrics();
                renderPaddockStoriesAndBuzz();
                showBanner(chObj.outcome, 3800);
              }
            }
          }
        });
      });
    }

    if (cList) {
      const comms = paddockData.commitments || [];
      cList.innerHTML = comms.map((c) => {
        const done = c.completed || quickCompletedCommitments.has(c.id);
        return `
          <div class="dp-commit-card${done ? " is-done" : ""}">
            <span class="dp-commit-cat"><i class="fas ${esc(c.icon || "fa-calendar")}"></i> ${esc(c.category)}</span>
            <b>${esc(c.title)}</b>
            <small>${esc(c.desc)}</small>
            <span class="dp-commit-fx">${esc(c.effects_text)}</span>
            <button type="button" class="dh-btn${done ? "" : " dh-btn-primary"} dp-commit-btn" data-commit-id="${esc(c.id)}" ${done ? "disabled" : ""}>${done ? "✓ Completed" : "Attend Event"}</button>
          </div>
        `;
      }).join("");
      cList.querySelectorAll(".dp-commit-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const cid = btn.dataset.commitId;
          if (activeCareerId) {
            try {
              const res = await api(`/api/drive/career/${encodeURIComponent(activeCareerId)}/commitment`, "POST", { commitment_id: cid });
              activeCareerView = res.view;
              paddockData = res.paddock;
              renderDriverCareer();
              renderPaddockMetrics();
              renderPaddockStoriesAndBuzz();
              showBanner(res.message, 3400);
            } catch (e) { showBanner(e.message, 3000); }
          } else {
            if (quickCompletedCommitments.size >= 3) { showBanner("Max 3 commitments per GP — hit Lights Out!", 2800); return; }
            const tpl = (paddockData.commitments || []).find((x) => x.id === cid);
            if (!tpl) return;
            quickCompletedCommitments.add(cid);
            if (tpl.buff) quickBuffs.push(tpl.buff);
            Object.entries(tpl.deltas || {}).forEach(([k, dv]) => {
              if (paddockData.metrics && paddockData.metrics[k] != null) {
                paddockData.metrics[k] = Math.max(5, Math.min(100, paddockData.metrics[k] + dv));
              }
            });
            paddockData.social_feed.unshift({ handle: "@ApexGridDaily", author: "APEX GRID Daily", verified: true, text: `📅 Completed ${tpl.title}! ${tpl.buff ? tpl.buff.label : ""}`, likes: 2450, reposts: 390 });
            renderPaddockMetrics();
            renderPaddockStoriesAndBuzz();
            showBanner(`Completed: ${tpl.title}!`, 3000);
          }
        });
      });
    }

    if (nList) {
      nList.innerHTML = (paddockData.news_feed || []).map((n) => `
        <div class="dp-news-item">
          <div class="dp-news-meta"><span>${esc(n.tag || "NEWS")}</span><span>${esc(n.source || "APEX GRID")}</span></div>
          <b>${esc(n.title)}</b>
          <p>${esc(n.body)}</p>
        </div>
      `).join("");
    }

    if (socList) {
      socList.innerHTML = (paddockData.social_feed || []).map((s) => `
        <div class="dp-social-card">
          <div class="dp-social-head">
            <strong>${esc(s.author)}</strong>
            ${s.verified ? `<i class="fas fa-check-circle dp-verified"></i>` : ""}
            <span>${esc(s.handle)}</span>
          </div>
          <p class="dp-social-text">${esc(s.text)}</p>
          <div class="dp-social-stats">
            <span><i class="fas fa-heart"></i> ${Number(s.likes || 0).toLocaleString()}</span>
            <span><i class="fas fa-retweet"></i> ${Number(s.reposts || 0).toLocaleString()}</span>
          </div>
        </div>
      `).join("");
    }
  }

  function renderCardHtml(c, isPlayer, actionLabel) {
    const carImg = c.car_icon_url ? `<img src="${esc(c.car_icon_url)}" alt="${esc(c.team)}" class="dp-dcard-car" loading="lazy">` : "";
    return `
      <div class="dp-dcard${isPlayer ? " is-player" : ""}" style="--card-col:${esc(c.color || "#e10600")}">
        <div class="dp-dcard-top">
          <div>
            <span class="dp-dcard-rarity">${esc(c.rarity || "GRID")}${c.era_label ? " · " + esc(c.era_label) : ""}</span>
            <div class="dp-dcard-name">#${c.number || 1} ${esc(c.name)}</div>
            <div class="dp-dcard-team">${esc(c.team)}</div>
          </div>
          <div class="dp-dcard-ovr">${c.overall || 85}</div>
        </div>
        ${carImg}
        <div class="dp-dcard-stats">
          <div class="dp-dstat">PAC<b>${c.pace || 82}</b></div>
          <div class="dp-dstat">RAC<b>${c.racecraft || 82}</b></div>
          <div class="dp-dstat">WET<b>${c.wet || 80}</b></div>
          <div class="dp-dstat">TYR<b>${c.tyre_care || 80}</b></div>
          <div class="dp-dstat">CON<b>${c.consistency || 82}</b></div>
        </div>
        <div class="dp-dcard-dna">${esc(c.dna_tag || "")}</div>
        <div class="dp-dcard-quote">“${esc(c.quote || "")}”</div>
        ${actionLabel ? `<button type="button" class="dh-btn dh-btn-primary dp-card-launch" data-card-team="${esc(c.team)}" data-card-era="${esc(c.era_key || "2026")}" data-card-name="${esc(c.name)}">${esc(actionLabel)}</button>` : ""}
      </div>
    `;
  }

  function renderCardsAndLore() {
    const host = document.getElementById("dp-lore-host");
    if (!host || !paddockData) return;

    if (loreFilter === "grid") {
      const pCard = paddockData.player_card ? renderCardHtml(paddockData.player_card, true, "") : "";
      const gCards = (paddockData.grid_cards || []).map((c) => renderCardHtml(c, false, "Race Seat / Duel")).join("");
      host.innerHTML = `<div class="dp-cards-grid">${pCard}${gCards}</div>`;
    } else if (loreFilter === "legends") {
      host.innerHTML = `<div class="dp-cards-grid">${(paddockData.legend_cards || []).map((c) => renderCardHtml(c, false, `Drive ${c.era_key} Era`)).join("")}</div>`;
    } else if (loreFilter === "tp") {
      const tps = (paddockData.lore && paddockData.lore.tp_dossiers) || [];
      host.innerHTML = `<div class="dp-lore-grid">${tps.map((tp) => `
        <div class="dp-lore-box" style="${tp.is_player_tp ? "border-color:#facc15" : ""}">
          <h4><i class="fas fa-user-tie"></i> ${esc(tp.name)} · ${esc(tp.team)}</h4>
          <div style="font-size:0.68rem;color:#94a3b8;font-weight:700">${esc(tp.style)} · FIA Clout ${tp.clout}/100 · ${esc(tp.nationality)}</div>
          <div style="font-size:0.73rem;color:#cbd5e1">${esc(tp.voice)}</div>
          <div class="dp-dcard-quote">“${esc(tp.quote)}”</div>
        </div>
      `).join("")}</div>`;
    } else {
      const l = paddockData.lore || {};
      const cir = l.circuit || {};
      const f1db = cir.f1db || {};
      const era = l.era || {};
      const fia = l.fia_precedents || [];
      const eco = l.ecosystem || [];
      host.innerHTML = `
        <div class="dp-lore-grid">
          <div class="dp-lore-box">
            <h4><i class="fas fa-road"></i> Circuit Lore · ${esc(cir.name)}</h4>
            <div class="dl-rec-row"><span>Length / Turns / DRS</span><b>${cir.length_km || "5.2"} km · ${cir.turns || 14}T · ${cir.drs_zones || 2} DRS</b></div>
            <div class="dl-rec-row"><span>Lap Record / Top Speed</span><b>${esc(cir.lap_record)} · ${cir.top_speed_kph || 330} KPH</b></div>
            <div class="dl-rec-row"><span>F1DB Heritage</span><b>${f1db.races_held || "Historic"} GPs ${f1db.first_year ? `(${f1db.first_year}–${f1db.last_year})` : ""}</b></div>
            ${(f1db.winners || []).length ? `<div style="font-size:0.7rem;color:#cbd5e1"><b>Most Wins:</b> ${f1db.winners.map((w) => `${esc(w.driver)} (${w.wins})`).join(" · ")}</div>` : ""}
            ${(cir.corners || []).length ? `<div style="font-size:0.68rem;color:#94a3b8"><b>Iconic Corners:</b> ${cir.corners.map((cn) => esc(cn)).join(" · ")}</div>` : ""}
            ${cir.blurb ? `<div style="font-size:0.7rem;color:#e2e8f0;margin-top:6px;line-height:1.45;border-top:1px solid #1e293b;padding-top:6px"><b style="color:#facc15">Paddock Lore:</b> ${esc(cir.blurb)}</div>` : ""}
          </div>
          <div class="dp-lore-box">
            <h4><i class="fas fa-cogs"></i> Era Technical DNA · ${esc(era.label)}</h4>
            <div class="dl-rec-row"><span>Top Speed / Gears / Mass</span><b>${era.top_speed_kph || 340} KPH · ${era.gears || 8}G · ${era.mass_kg || 768} kg</b></div>
            <div class="dl-rec-row"><span>Safety &amp; Aero Tech</span><b>${era.has_halo ? "Halo" : "Open Cockpit"} · ${era.has_drs ? "DRS/X-Mode" : "Mechanical"} · ${era.has_ers ? "Hybrid ERS" : "Pure ICE"}</b></div>
            <div class="dl-rec-row"><span>Powertrain Acoustic Profile</span><b>${esc(String(era.audio_profile || "v6_hybrid").toUpperCase())}</b></div>
            ${fia.length ? `<div style="font-size:0.68rem;color:#94a3b8;margin-top:4px"><b>FIA Stewarding Precedents:</b><br>${fia.slice(0, 3).map((d) => `• [${esc(d.season)} ${esc(d.gp)}] ${esc(d.title)}`).join("<br>")}</div>` : ""}
          </div>
        </div>
        <div class="dp-lore-box" style="margin-top:10px;">
          <h4><i class="fas fa-layer-group"></i> Explore the Full APEX GRID Ecosystem</h4>
          <div class="dp-eco-grid">
            ${eco.map((e) => `<a href="${esc(e.href)}" class="dp-eco-link"><b><i class="fas ${esc(e.icon)}"></i> ${esc(e.title)}</b><small>${esc(e.stat)}</small></a>`).join("")}
          </div>
        </div>
      `;
    }

    host.querySelectorAll(".dp-card-launch").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tm = btn.dataset.cardTeam;
        const era = btn.dataset.cardEra;
        const teamSel = document.getElementById("in-team");
        const eraSel = document.getElementById("in-era");
        if (teamSel && [...teamSel.options].some((o) => o.value.toLowerCase() === tm.toLowerCase())) {
          teamSel.value = [...teamSel.options].find((o) => o.value.toLowerCase() === tm.toLowerCase()).value;
        }
        if (eraSel && [...eraSel.options].some((o) => o.value === era)) {
          eraSel.value = era;
        }
        document.querySelector('.dl-mtab[data-dmode="gp"]')?.click();
        showBanner(`Loaded ${btn.dataset.cardName}'s ${tm} (${era.toUpperCase()}) seat — hit Lights Out!`, 3200);
      });
    });
  }

  function renderDriverCareer() {
    const ov = document.getElementById("dc-overview");
    const stBox = document.getElementById("dc-standings");
    const driveBtn = document.getElementById("dc-btn-drive-round");
    if (!activeCareerView || !ov || !stBox) return;
    const st = activeCareerView.state;
    const p = st.player;
    const ev = activeCareerView.current_event;

    ov.innerHTML = `
      <div class="dl-rec-row" style="border-color:${esc(p.color)}"><span><b>#${p.number} ${esc(p.name)}</b> (${esc(p.team)})</span><b>S${st.season} · R${st.round}/${st.calendar.length}</b></div>
      <div class="dl-rec-row"><span>Acclaim / Teammate H2H</span><b>${p.acclaim}/100 · ${p.h2h_wins}–${p.h2h_losses} vs ${esc(p.teammate_name)}</b></div>
      <div class="dl-rec-row"><span>Next Event</span><b>${st.phase === "season_end" ? "Season Finale Complete — Sign Contract!" : `${esc(ev.circuit_name)} (${ev.weather_mode.toUpperCase()})`}</b></div>
      ${(st.inbox || []).slice(0, 3).map((m) => `<div class="dl-rec-row" style="flex-direction:column;gap:2px"><b>${esc(m.title)}</b><span style="color:#94a3b8">${esc(m.body)}</span></div>`).join("")}
    `;

    const offersHtml = (st.phase === "season_end" && (st.contract_offers || []).length)
      ? `<div style="font-size:0.66rem;color:#fde047;font-weight:800">OFF-SEASON CONTRACT OFFERS</div>` + st.contract_offers.map((o) => `
          <div class="dl-rec-row">
            <span><b style="color:${esc(o.color)}">● ${esc(o.team)}</b> (Car ${o.car_rating} · $${o.salary_m}M/yr)</span>
            <button type="button" class="dh-btn dh-btn-primary btn-dc-sign" data-team="${esc(o.team)}">Sign Seat</button>
          </div>
        `).join("")
      : "";

    stBox.innerHTML = offersHtml + (activeCareerView.wdc || []).slice(0, 12).map((d, idx) => `
      <div class="dl-rec-row" style="${d.is_player ? "border-color:#fde047;color:#fef08a" : ""}">
        <span><b>#${idx + 1}</b> ${esc(d.name)} (${esc(d.team)})</span>
        <b>${d.points} pts</b>
      </div>
    `).join("");

    stBox.querySelectorAll(".btn-dc-sign").forEach((b) => b.addEventListener("click", async () => {
      const res = await api(`/api/drive/career/${encodeURIComponent(activeCareerId)}/contract/sign`, "POST", { team_name: b.dataset.team });
      activeCareerView = res.view;
      renderDriverCareer();
      refreshCareerSaves();
    }));
    if (driveBtn) driveBtn.disabled = st.phase === "season_end";
  }

  // Wire UI Events (All 7 Paddock HQ Tabs + Lore Filters + Controller Studio!)
  function showLauncherPane(modeKey) {
    activeMode = modeKey;
    document.querySelectorAll(".dl-mtab").forEach((x) => x.classList.toggle("active", x.dataset.dmode === modeKey));
    const isSetup = ["timetrial", "gp", "weekend", "bridge"].includes(modeKey);
    document.getElementById("dl-setup-pane")?.classList.toggle("hidden", !isSetup);
    document.getElementById("dl-career-pane")?.classList.toggle("hidden", modeKey !== "career");
    document.getElementById("dl-stories-pane")?.classList.toggle("hidden", modeKey !== "stories");
    document.getElementById("dl-lore-pane")?.classList.toggle("hidden", modeKey !== "lore");
    document.getElementById("dl-controls-pane")?.classList.toggle("hidden", modeKey !== "controls");
    const lapsWrap = document.getElementById("wrap-laps");
    if (lapsWrap) lapsWrap.style.opacity = modeKey === "timetrial" ? "0.4" : "1";

    if (modeKey === "controls" && window.F1GamepadStudio && document.getElementById("dp-gamepad-studio-host")) {
      if (gpStudioUnmount) gpStudioUnmount();
      gpStudioUnmount = window.F1GamepadStudio.mountStudio(document.getElementById("dp-gamepad-studio-host"), { context: "drive" });
    } else if (gpStudioUnmount) {
      gpStudioUnmount();
      gpStudioUnmount = null;
    }

    if (modeKey === "career") refreshCareerSaves();
    if (modeKey === "stories" || modeKey === "lore") refreshPaddockHub();
  }

  document.querySelectorAll(".dl-mtab").forEach((b) => b.addEventListener("click", () => showLauncherPane(b.dataset.dmode)));
  document.getElementById("dl-gamepad-badge")?.addEventListener("click", () => showLauncherPane("controls"));
  document.querySelectorAll("[data-lore-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      loreFilter = btn.dataset.loreFilter || "grid";
      document.querySelectorAll("[data-lore-filter]").forEach((x) => x.classList.toggle("active", x === btn));
      renderCardsAndLore();
    });
  });

  document.querySelectorAll(".dl-preset").forEach((b) => b.addEventListener("click", () => applyAssistPreset(b.dataset.preset)));
  document.getElementById("in-circuit")?.addEventListener("change", () => { refreshLeaderboards(); refreshPaddockHub(); });
  document.getElementById("in-era")?.addEventListener("change", refreshPaddockHub);
  document.getElementById("in-team")?.addEventListener("change", refreshPaddockHub);

  document.getElementById("btn-start-drive")?.addEventListener("click", async () => {
    try {
      const boot = window.__DRIVE_BOOT__ || {};
      let url;
      if (boot.source && boot.ref_id && activeMode === "bridge") {
        url = `/api/drive/config?source=${encodeURIComponent(boot.source)}&ref_id=${encodeURIComponent(boot.ref_id)}`;
      } else {
        const q = new URLSearchParams({
          circuit: document.getElementById("in-circuit").value,
          era: document.getElementById("in-era").value,
          team: document.getElementById("in-team").value,
          driver: document.getElementById("in-drv-name").value || "Alex Vance",
          mode: activeMode,
          weather: document.getElementById("in-weather").value,
          laps: document.getElementById("in-laps").value,
          ai_difficulty: document.getElementById("as-ai-diff")?.value || "78",
        });
        url = `/api/drive/config?${q.toString()}`;
      }
      const cfg = await api(url);
      await launchSession(cfg);
    } catch (e) {
      alert(e.message);
    }
  });

  document.getElementById("dc-btn-create")?.addEventListener("click", async () => {
    const res = await api("/api/drive/career/new", "POST", {
      driver_name: document.getElementById("dc-in-name").value,
      driver_number: Number(document.getElementById("dc-in-num").value || 27),
      team_name: document.getElementById("dc-in-team").value,
    });
    activeCareerId = res.save_id;
    activeCareerView = res.view;
    renderDriverCareer();
    refreshCareerSaves();
  });
  document.getElementById("dc-save-sel")?.addEventListener("change", (e) => { if (e.target.value) loadDriverCareer(e.target.value); });
  document.getElementById("dc-btn-del")?.addEventListener("click", async () => {
    if (!activeCareerId || !confirm("Delete this Driver Career?")) return;
    await api(`/api/drive/career/${encodeURIComponent(activeCareerId)}`, "DELETE");
    activeCareerId = null; activeCareerView = null;
    refreshCareerSaves();
  });
  document.getElementById("dc-btn-drive-round")?.addEventListener("click", async () => {
    if (!activeCareerView) return;
    const st = activeCareerView.state;
    const ev = activeCareerView.current_event;
    const q = new URLSearchParams({
      circuit: ev.circuit_id,
      era: st.era_key,
      team: st.player.team,
      driver: st.player.name,
      code3: st.player.code3,
      number: String(st.player.number),
      mode: "gp",
      weather: ev.weather_mode,
      laps: String(ev.laps || 5),
      ai_difficulty: document.getElementById("as-ai-diff")?.value || "78",
    });
    const cfg = await api(`/api/drive/config?${q.toString()}`);
    cfg.mode = "career";
    await launchSession(cfg, "race");
  });

  // Live HUD Quick Buttons
  document.getElementById("btn-hud-cam")?.addEventListener("click", () => {
    if (!cockpit3d) return;
    document.getElementById("btn-hud-cam").textContent = `${cockpit3d.cycleCamera().toUpperCase()} [C]`;
  });
  document.getElementById("btn-hud-halo")?.addEventListener("click", () => {
    if (!cockpit3d) return;
    document.getElementById("btn-hud-halo").textContent = `HALO: ${cockpit3d.toggleHaloGhost() ? "GHOST" : "SOLID"}`;
  });
  document.getElementById("btn-hud-line")?.addEventListener("click", () => {
    if (!world3d) return;
    document.getElementById("btn-hud-line").textContent = `LINE: ${world3d.cycleRacingLine().toUpperCase()}`;
  });
  document.getElementById("btn-hud-box")?.addEventListener("click", triggerPitStop);
  document.getElementById("btn-hud-mute")?.addEventListener("click", (e) => {
    if (!audioCtrl) return;
    audioCtrl.setMuted(!audioCtrl.isMuted());
    e.currentTarget.innerHTML = audioCtrl.isMuted() ? `<i class="fas fa-volume-mute"></i>` : `<i class="fas fa-volume-up"></i>`;
  });
  document.getElementById("btn-hud-pause")?.addEventListener("click", openPauseModal);
  document.getElementById("dm-btn-close")?.addEventListener("click", () => {
    if (!finished) resumeSession();
    else exitToLauncher();
  });

  // Boot: render background preview circuit & handle Bridge / URL params
  (async function boot() {
    ensureEngines();
    refreshLeaderboards();
    const boot = window.__DRIVE_BOOT__ || {};
    if (boot.weather && document.getElementById("in-weather")) {
      const ws = document.getElementById("in-weather");
      if ([...ws.options].some((o) => o.value === boot.weather)) ws.value = boot.weather;
    }
    if (boot.team && document.getElementById("in-team")) {
      const ts = document.getElementById("in-team");
      const mOpt = [...ts.options].find((o) => o.value.toLowerCase() === boot.team.toLowerCase());
      if (mOpt) ts.value = mOpt.value;
    }
    if (boot.source && boot.ref_id) {
      activeMode = "bridge";
      try {
        const cfg = await api(`/api/drive/config?source=${encodeURIComponent(boot.source)}&ref_id=${encodeURIComponent(boot.ref_id)}`);
        const bb = document.getElementById("dl-bridge-banner");
        if (bb && cfg.bridge) {
          bb.innerHTML = `<span>🏎️ TAKE THE WHEEL ACTIVE: <b>${esc(cfg.bridge.label)}</b> · ${esc(cfg.circuit.name)} · Starting P${cfg.player_driver.grid_pos}</span><a href="${esc(cfg.bridge.return_url)}" class="dh-btn" style="text-decoration:none">← Back</a>`;
          bb.classList.remove("hidden");
        }
        document.getElementById("btn-start-drive").innerHTML = `<i class="fas fa-flag-checkered"></i> TAKE THE WHEEL — LIGHTS OUT!`;
      } catch (_) {}
    } else if (boot.mode && ["timetrial", "gp", "weekend", "career", "stories", "lore", "controls"].includes(boot.mode)) {
      showLauncherPane(boot.mode);
    }
    refreshPaddockHub();
    // Render a crisp idle circuit preview behind the launcher
    try {
      const prevCfg = await api(`/api/drive/config?circuit=${encodeURIComponent(boot.circuit || "melbourne")}&era=${encodeURIComponent(boot.era || "2026")}&mode=timetrial`);
      const archFn = window.F1TrackArchitect && window.F1TrackArchitect.getCircuitElevationAndBank;
      const prevTrack = window.F1DrivePhysics.buildDriveTrack(prevCfg.circuit, prevCfg.physics_dna, archFn);
      if (world3d) {
        world3d.buildCircuit(prevCfg.circuit, prevTrack);
        const sp = prevTrack.sample(0.02);
        world3d.camera.position.set(sp.x - sp.tx * 16 + sp.rx * 8, sp.y + 7.5, sp.z - sp.tz * 16 + sp.rz * 8);
        world3d.camera.lookAt(sp.x + sp.tx * 28, sp.y + 1.5, sp.z + sp.tz * 28);
        world3d.render();
      }
    } catch (_) {}
  })();
})();
