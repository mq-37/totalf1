/* Full CPU Broadcast Simulator (/sim) — 100% Autonomous AI Grid + F1 TV Auto Director
   Uses F1TrackRenderer + actual 3D F1Car3D models + Wheel-to-Wheel Battle & Collision Physics. */
(function () {
  "use strict";

  const BOOT = window.F1_FULLSIM_BOOT || { latestYear: 2026, circuits: [], defaultCircuit: null, eraRules: [] };
  const CIRCUITS = BOOT.circuits || [];
  const ERA_RULES = BOOT.eraRules || [];
  const F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

  const ENG = window.F1RaceEngine;
  const COMPOUNDS = ENG.COMPOUNDS;
  if (BOOT.defaultCircuit && ENG && ENG.registerCircuit) {
    ENG.registerCircuit(BOOT.defaultCircuit);
  }

  function eraKeyFromDeckSpec(deckSpec) {
    const parts = String(deckSpec || "").split(":");
    const src = parts[0], val = parseInt(parts[1], 10);
    if (src === "season" && Number.isFinite(val)) {
      if (val <= 1959) return "1950s";
      if (val <= 1969) return "1960s";
      if (val <= 1979) return "1970s";
      if (val <= 1989) return "1980s";
      if (val <= 1999) return "1990s";
      if (val <= 2009) return "2000s";
      if (val <= 2021) return "2010s";
      if (val <= 2025) return "2022_25";
      return "2026";
    }
    if (src === "decade" && Number.isFinite(val)) {
      if (val <= 1950) return "1950s";
      if (val <= 1960) return "1960s";
      if (val <= 1970) return "1970s";
      if (val <= 1980) return "1980s";
      if (val <= 1990) return "1990s";
      if (val <= 2000) return "2000s";
      if (val <= 2010) return "2010s";
      return "2026";
    }
    return "2026";
  }

  function resolveEraRule(deckSpec) {
    const selVal = getEl("fsim-era-sel")?.value || "auto";
    const key = selVal === "auto" ? eraKeyFromDeckSpec(deckSpec) : selVal;
    const found = ERA_RULES.find((e) => e.key === key);
    return found || ENG.DEFAULT_ERA_RULES;
  }

  const fs = {
    deckCache: {},
    balanceCache: {},
    circuit: BOOT.defaultCircuit || CIRCUITS[0] || null,
    eraRule: ENG.DEFAULT_ERA_RULES,
    telemetry: null,
    simToEndActive: false,
    towerWide: false,
    b3d: null,
    b3dMode: "off",
    radio: null,
    geom: null,
    staticCanvas: null,
    staticKey: "",
    cam: null,
    fx: null,
    layers: { corners: true, sectors: true, hud: true, line: true, ai: true },
    gapMode: "int",
    speedMult: 1,
    paused: false,
    running: false,
    finished: false,
    chequeredFlag: false,
    chequeredStartS: 0,
    allUnlappedDoneAt: null,
    chequeredFinishedCount: 0,
    chequeredRunningCount: 0,
    sfxOn: true,
    voiceOn: false,
    autoReplay: true,
    chaosMult: 1.0,
    autoTv: true,
    userZoomLocked: false,
    focusIdx: 0,
    battlePair: null,
    lastCamCutClock: -99,
    lastAutoReplayTs: 0,
    lastAmbientCallTs: 0,
    replayBuf: [],
    replayRecAccum: 0,
    replayClips: [],
    replay: { active: false, frames: [], playPos: 0, speed: 0.45, focusIdx: 0, title: "", savedCamMode: "battle" },
    stewardsBanner: null,
    stewardsTimer: 0,
    totalLaps: 15,
    weatherMode: "dynamic",
    wetness: 0,
    targetWetness: 0,
    drying: false,
    nextWeatherLap: 5,
    forecast: [],
    gripPct: 38,
    drsEnabled: false,
    drsAnnounced: false,
    vscLaps: 0,
    safetyCarLaps: 0,
    scUnlapped: false,
    redFlag: null,
    redFlagUsed: false,
    formationLap: null,
    weekendFormat: "direct",
    sprintPhase: null, // null | "sprint" | "gp"
    qualiOrderedCards: null,
    qualiAbort: null,
    debrisZones: [],
    nextDebrisId: 1,
    yellowSector: 0,
    yellowLevel: 1, // 1 = Single Yellow, 2 = Double Waved Yellow (ISC App. H)
    yellowTimer: 0,
    bestSectors: [999, 999, 999],
    fastestLap: { time: 999, driver: "", code3: "" },
    raceClock: 0,
    stats: { overtakes: 0, pits: 0, incidents: 0, dnfs: 0, scs: 0, leadChanges: 0 },
    overtakeCooldown: {},
    prevOnTrackOrder: [],
    prevLeaderIdx: -1,
    radioCount: 0,
    miniFeed: [],
    cars: [],
    carScreenPos: [],
    rafId: null,
    lastTs: 0,
    lastDt: 0.016,
    lastUiSync: 0,
    toastTimer: null,
    autoAdvTimer: null,
    // Full CPU Season Championship State
    season: {
      active: false,
      rounds: [],
      roundIdx: 0,
      wdc: {},
      wcc: {},
      racesRun: 0,
    },
  };

  function getEl(id) { return document.getElementById(id); }
  const esc = ENG.esc;
  const fmtLapTime = ENG.fmtLapTime;
  const isInDrsZone = ENG.isInDrsZone;
  const hasSatisfiedTwoCompoundRule = ENG.hasSatisfiedTwoCompoundRule;
  function playSfx(name, ...args) {
    if (!fs.sfxOn || !window.F1Sfx) return;
    try {
      if (typeof window.F1Sfx[name] === "function") window.F1Sfx[name](...args);
      else if (window.F1Sfx.play) window.F1Sfx.play(name);
    } catch (_) {}
  }

  // Phase 2 Helpers: Trackside Smoking Breakdown Parking, Carbon Debris, Physical SC & Red Flag Standing Restarts!
  function parkBreakdownCar(car, reason, kind) {
    if (!car) return;
    car.dnf = true;
    car.dnfReason = reason || "Mechanical";
    car.breakdownKind = kind || "engine";
    car.parkedProg = ((car.totalProg % 1) + 1) % 1;
    const nearSf = car.parkedProg < 0.12 || car.parkedProg > 0.88;
    const pitSide = (fs.geom && fs.geom.pitSide) || 1;
    car.parkedSide = nearSf ? -pitSide : (car.idx % 2 === 0 ? 1 : -1);
    car.parkedYawOff = car.parkedSide * (kind === "crash" ? 0.78 : 0.34);
    car.smokeActive = true;
    car.cleared = false;
    car.liveKph = 0;
    car.livePhysKph = 0;
    car.liveGear = 1;
  }

  function spawnDebrisZone(prog, lat, curLap) {
    if (fs.debrisZones.length >= 6) fs.debrisZones.shift();
    fs.debrisZones.push({
      id: fs.nextDebrisId++,
      prog: ((prog % 1) + 1) % 1,
      lat: Math.max(-5, Math.min(5, lat || 0)),
      lapAdded: curLap || 1,
      clearAtLap: (curLap || 1) + 2,
    });
  }

  function deploySafetyCar(reason, laps, fastMode) {
    if (fs.finished || (fs.redFlag && fs.redFlag.active)) return;
    fs.safetyCarLaps = Math.max(fs.safetyCarLaps || 0, laps || 2);
    fs.scUnlapped = false;
    fs.stats.scs += 1;
    const leaderLap = Math.max(...fs.cars.map((c) => c.lap), 0) + 1;
    if (!fastMode) {
      showToast(`⚠️ SAFETY CAR DEPLOYED — ${reason}`, "warn");
      showStewardsBanner("⚠ FIA RACE CONTROL · SAFETY CAR DEPLOYED", reason, "info");
      playSfx("radioAlert");
      updateChyron(`⚠ FIA SAFETY CAR DEPLOYED · ${reason.toUpperCase()}`);
    }
    addCommentary(leaderLap, `⚠️ FIA SAFETY CAR DEPLOYED! ${reason} — pack bunching behind the Aston Martin GT Safety Car!`, "warn");
    if (fs.telemetry) fs.telemetry.addEvent(leaderLap, "sc", "Safety Car", reason, -1);
  }

  function triggerRedFlag(reason, fastMode) {
    if (fs.finished || (fs.redFlag && fs.redFlag.active)) return;
    const sorted = ENG.sortRaceStandings(fs.cars, false);
    const leadLap = Math.max(1, Math.floor((sorted[0] && sorted[0].totalProg) || 1));
    fs.redFlagUsed = true;
    fs.safetyCarLaps = 0;
    fs.vscLaps = 0;
    fs.yellowSector = 0;
    fs.redFlag = {
      active: true,
      timer: fastMode ? 0.1 : 4.5,
      maxTimer: 4.5,
      reason: reason || "Severe track obstruction",
      leadLap,
    };
    if (!fastMode) {
      showToast(`🚩 RED FLAG — SESSION SUSPENDED (${fs.redFlag.reason})`, "warn");
      showStewardsBanner("🚩 FIA RED FLAG · SESSION SUSPENDED", `${fs.redFlag.reason} — Free tyre change & wing repairs in Pit Lane before Standing Restart!`, "penalty");
      playSfx("radioAlert");
      updateChyron(`🚩 RED FLAG · PIT LANE REPAIRS & FREE TYRES`);
    }
    addCommentary(leadLap, `🚩 RED FLAG! Session suspended (${fs.redFlag.reason}). Cars enter Pit Lane for free tyre swaps & wing repairs ahead of a Standing Restart!`, "warn");
    if (fs.telemetry) fs.telemetry.addEvent(leadLap, "incident", "RED FLAG", fs.redFlag.reason, -1);
  }

  function executeRedFlagStandingRestart(fastMode) {
    if (!fs.redFlag) return;
    const leadLap = fs.redFlag.leadLap || 1;
    fs.redFlag = null;
    fs.debrisZones = [];
    fs.cars.forEach((c) => { if (c.dnf) c.cleared = true; });
    const running = ENG.sortRaceStandings(fs.cars, false).filter((c) => !c.dnf && !c.finishedRace);
    const wantComp = fs.wetness >= 60 ? "wet" : (fs.wetness >= 22 ? "inter" : (fs.totalLaps - leadLap <= 6 ? "soft" : "medium"));
    const perim = Math.max(1800, (fs.circuit && fs.circuit.length_km ? fs.circuit.length_km * 1000 : 4800));
    const progStep = Math.max(0.0020, Math.min(0.0052, 16.5 / perim));
    const startOffset = Math.max(0.0020, 9.0 / perim);

    if (window.F1TrackArchitect) {
      fs.startSeq = window.F1TrackArchitect.createStandingStartState(running, fs.circuit, { isRestart: true, skip: !!fastMode });
    }
    running.forEach((car, i) => {
      car.totalProg = leadLap - (startOffset + i * progStep);
      car.lap = Math.max(0, leadLap - 1);
      car.latOffset = (i % 2 === 0 ? -2.55 : 2.55);
      car.inPit = 0;
      car.pitDuration = 0;
      car.wingDamaged = false;
      car.compound = wantComp;
      car.nextCompound = wantComp;
      car.tyreLife = 100;
      car.tyreTemp = (COMPOUNDS[wantComp] || COMPOUNDS.medium).optTemp - 2;
      if (COMPOUNDS[wantComp] && COMPOUNDS[wantComp].wet > 0) car.usedWet = true;
      else car.dryCompoundsUsed.add(wantComp);
      if (Array.isArray(car.stintHistory)) {
        const lastSt = car.stintHistory[car.stintHistory.length - 1];
        if (lastSt) lastSt.endLap = Math.max(lastSt.startLap, leadLap);
        car.stintHistory.push({ compound: wantComp, startLap: leadLap, endLap: fs.totalLaps });
      }
      car.currentLapS = computeCarLapTime(car, fs.circuit, fs.wetness);
    });
    if (running[0]) fs.focusIdx = running[0].idx;
    if (fs.cam && fs.geom && window.F1TrackRenderer && running[0]) {
      const p0 = window.F1TrackRenderer.sampleTrack(fs.geom, running[0].totalProg);
      fs.cam.x = p0.x; fs.cam.y = p0.y;
    }
    addCommentary(leadLap, `🔴 STANDING RESTART! ${running.length} cars grid up on fresh ${(COMPOUNDS[wantComp] || COMPOUNDS.medium).name}s — waiting for 5 red lights!`, "win");
    if (!fastMode) {
      showToast(`🔴 STANDING RESTART — ${running.length} CARS ON THE GRID!`, "warn");
      updateChyron(`🔴 STANDING RESTART · POLE: ${running[0] ? running[0].card.code3 : "P1"}`);
    }
  }

  function showToast(msg, tone) {
    const el = getEl("fsim-alert-toast");
    if (!el) return;
    el.textContent = msg;
    el.className = `sim-alert-toast is-${tone || "info"}`;
    clearTimeout(fs.toastTimer);
    fs.toastTimer = setTimeout(() => el.classList.add("hidden"), 3600);
  }

  function speakCommentary(text) {
    if (!fs.voiceOn) return;
    const raw = String(text || "").trim();
    if (!raw) return;
    let role = "crofty";
    let tone = "info";
    if (/BRUNDLE/i.test(raw)) role = "brundle";
    else if (/STEWARDS|RACE CONTROL|SAFETY CAR|RED FLAG|PENALTY|BLACK & WHITE/i.test(raw)) { role = "stewards"; tone = "warn"; }
    if (/LIGHTS OUT|WINS|CHEQUERED|SWITCHBACK|LATE ON THE BRAKES|MONSTER/i.test(raw)) tone = "win";

    if (window.F1Sfx && window.F1Sfx.speak) {
      window.F1Sfx.speak({
        text: raw.slice(0, 210),
        role,
        tone,
        channel: role === "stewards" ? "stewards" : "commentary",
        priority: role === "stewards" ? "high" : "normal",
      });
      return;
    }
    if (!window.speechSynthesis) return;
    try {
      const clean = raw.replace(/[^\w\s.,!?'’:+%-]/g, "").trim();
      if (!clean || window.speechSynthesis.speaking) return;
      const utt = new SpeechSynthesisUtterance(clean.slice(0, 160));
      utt.rate = 1.08;
      utt.pitch = 1.02;
      window.speechSynthesis.speak(utt);
    } catch (_) {}
  }

  function showStewardsBanner(header, text, tone) {
    fs.stewardsBanner = { header, text, tone: tone || "info" };
    fs.stewardsTimer = 5.5;
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function emitBroadcastCall(kind, d) {
    const lap = (d && d.lap) || (Math.max(...fs.cars.map((c) => c.lap), 0) + 1);
    const cName = d && d.corner ? d.corner : "the apex";
    let msg = "";
    let tone = "info";
    if (kind === "overtake_dive") {
      msg = pick([
        `🎙 CROFTY: LATE ON THE BRAKES! ${d.passer} sends it down the inside of ${d.victim} into ${cName} for P${d.pos} — clean, bold, wheel-to-wheel perfection!`,
        `🎙 BRUNDLE: Textbook inside lunge by ${d.passer} on ${d.victim} at ${cName}! ${d.victim} left a car's width and ${d.passer} claimed the apex cleanly for P${d.pos}!`,
      ]);
      tone = d.pos <= 3 ? "win" : "info";
    } else if (kind === "overtake_cutback") {
      msg = `🎙 BRUNDLE: OH, WHAT A SWITCHBACK! ${d.victim} covered the inside at ${cName}, so ${d.passer} cut right underneath on the exit and launched past for P${d.pos}!`;
      tone = "win";
    } else if (kind === "overtake_drs") {
      msg = `🎙 CROFTY: DRS wide open! ${d.passer} gets a monster slipstream tow past ${d.victim} and breezes into P${d.pos} before the braking zone!`;
      tone = d.pos === 1 ? "win" : "info";
    } else if (kind === "fia_mub") {
      msg = `⚖️ FIA STEWARDS: ${d.culprit} moved under braking defending ${d.victim} (${d.article}) — ${d.verdict}!`;
      tone = "warn";
    } else if (kind === "battle_clean") {
      msg = pick([
        `🎙 BRUNDLE: Brilliant hard racing between ${d.a} and ${d.b}! Both drivers holding their lines under braking and leaving a full car's width!`,
        `🎙 CROFTY: ${d.a} right in the gearbox of ${d.b} — one legal defensive move to the inside, waiting for the traction zone!`,
      ]);
      tone = "info";
    } else if (kind === "avoid") {
      msg = `🎙 CROFTY: Lightning reflexes from ${d.driver}! Spots the hazard ahead and threads the needle cleanly without contact!`;
      tone = "info";
    }
    if (msg) addCommentary(lap, msg, tone, d && d.clipId);
  }

  function recordReplayFrame() {
    if (!fs.cars.length) return;
    const snap = {
      raceClock: fs.raceClock,
      wetness: fs.wetness,
      targetWetness: fs.targetWetness,
      drying: fs.drying,
      gripPct: fs.gripPct,
      drsEnabled: fs.drsEnabled,
      yellowSector: fs.yellowSector,
      scActive: fs.safetyCarLaps > 0,
      vscActive: fs.vscLaps > 0,
      cars: fs.cars.map((c) => ({
        idx: c.idx,
        totalProg: c.totalProg,
        latOffset: c.latOffset || 0,
        visualAngle: c.visualAngle,
        compound: c.compound,
        inPit: c.inPit,
        pitDuration: c.pitDuration,
        drsOpen: !!(fs.drsEnabled && c.inDrsRange && c.inPit === 0),
        ersHot: !!(c.ersMode === "overtake" && c.ers > 6),
        harvesting: c.ersMode === "harvest",
        braking: !!(c._smT && c._smT.braking),
        brake: c._smT ? Math.round(c._smT.brake) : 0,
        steerAngle: c._smT ? c._smT.steerAngle : 0,
        spinAngle: c.spinAngle || 0,
        wingDamaged: !!c.wingDamaged,
        dnf: !!c.dnf,
        pos: c.pos || 1,
        tyreTemp: c.tyreTemp || 96,
        telem: c._smT ? Object.assign({}, c._smT) : null,
        aiObs: c.aiObs ? Object.assign({}, c.aiObs) : null,
      })),
    };
    fs.replayBuf.push(snap);
    if (fs.replayBuf.length > 150) fs.replayBuf.shift();
  }

  function saveReplayClip(title, focusIdx) {
    if (fs.replayBuf.length < 16) return null;
    const id = `clip_${Date.now()}_${Math.floor(Math.random() * 999)}`;
    const frames = fs.replayBuf.slice(-115);
    fs.replayClips.unshift({ id, title, focusIdx, frames });
    if (fs.replayClips.length > 10) fs.replayClips.pop();
    return id;
  }

  function startInstantReplay(opts) {
    const o = opts || {};
    const frames = o.frames || fs.replayBuf.slice(-115);
    if (!frames || frames.length < 10) {
      showToast("Wait a few seconds for replay buffer to fill!", "info");
      return;
    }
    const R = window.F1TrackRenderer;
    fs.replay.savedCamMode = (fs.cam && fs.cam.mode) || "battle";
    fs.replay.active = true;
    fs.replay.frames = frames;
    fs.replay.playPos = 0;
    fs.replay.speed = o.speed || 0.45;
    fs.replay.focusIdx = o.focusIdx != null ? o.focusIdx : fs.focusIdx;
    fs.replay.title = o.title || `F1 TV INSTANT REPLAY · ${fs.circuit ? fs.circuit.name.toUpperCase() : "GP"}`;
    if (R && fs.cam) R.setCameraMode(fs.cam, "close");
    const btn = getEl("fsim-replay-btn");
    if (btn) { btn.classList.add("is-replaying"); btn.innerHTML = `<i class="fas fa-broadcast-tower"></i> LIVE`; }
  }

  function stopInstantReplay() {
    if (!fs.replay.active) return;
    fs.replay.active = false;
    fs.replay.frames = [];
    const R = window.F1TrackRenderer;
    if (R && fs.cam) R.setCameraMode(fs.cam, fs.replay.savedCamMode || "battle");
    const btn = getEl("fsim-replay-btn");
    if (btn) { btn.classList.remove("is-replaying"); btn.innerHTML = `<i class="fas fa-history"></i> <span class="sim-lbl-md">Replay</span>`; }
  }

  function addCommentary(lap, msg, tone, clipId) {
    fs.radioCount += 1;
    const latest = getEl("fsim-radio-latest");
    const lapEl = getEl("fsim-radio-lap");
    const cntEl = getEl("fsim-radio-count");
    if (latest) { latest.textContent = msg; latest.className = `sim-radio-latest tone-${tone || "info"}`; }
    if (lapEl) lapEl.textContent = `L${Math.max(1, lap)}`;
    if (cntEl) cntEl.textContent = String(fs.radioCount);

    const ul = getEl("fsim-radio-log");
    if (ul) {
      const li = document.createElement("li");
      li.className = `sim-rlog-item tone-${tone || "info"}`;
      li.innerHTML = `<span class="sim-rlog-lap">L${Math.max(1, lap)}</span><span>${esc(msg)}</span>`;
      ul.prepend(li);
      while (ul.children.length > 60) ul.removeChild(ul.lastChild);
    }

    fs.miniFeed.unshift({ lap: Math.max(1, lap), msg, tone: tone || "info", clipId: clipId || null });
    if (fs.miniFeed.length > 6) fs.miniFeed.pop();
    renderMiniFeed();
    if (tone === "warn" || tone === "win") speakCommentary(msg);
  }

  function renderMiniFeed() {
    const box = getEl("fsim-mini-feed");
    if (!box) return;
    box.innerHTML = fs.miniFeed.map((f) => {
      const rBtn = f.clipId ? `<button type="button" class="fsim-clip-btn" data-replay-clip="${esc(f.clipId)}" title="Watch Slow-Mo Instant Replay">↺</button>` : "";
      return `<div class="fsim-mf-row tone-${f.tone}"><span>L${f.lap}</span><p>${esc(f.msg)}</p>${rBtn}</div>`;
    }).join("");
    box.querySelectorAll("[data-replay-clip]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const clip = fs.replayClips.find((c) => c.id === btn.dataset.replayClip);
        if (clip) startInstantReplay({ frames: clip.frames, focusIdx: clip.focusIdx, title: clip.title });
      });
    });
  }

  // isInDrsZone & hasSatisfiedTwoCompoundRule provided by window.F1RaceEngine

  // =========================================================================
  // DECK LOADING (1950–2026 Seasons, Decades & All-Time Legends!)
  // =========================================================================
  async function loadDeck(spec, maxCars) {
    const key = `${spec}|${maxCars}`;
    if (fs.deckCache[key]) return fs.deckCache[key];
    const [src, val] = spec.split(":");
    let url = `/api/game/deck?source=${encodeURIComponent(src)}`;
    if (src === "season") url += `&year=${encodeURIComponent(val)}`;
    else if (src === "decade") url += `&decade=${encodeURIComponent(val)}`;
    else url += `&limit=${encodeURIComponent(val === "80" ? "80" : String(maxCars))}`;

    const res = await fetch(url);
    const data = await res.json();
    let cards = (data.cards || []).slice();
    if (src === "alltime" && val === "80") {
      // Shuffle top 80 legends for a fresh dream grid!
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
    }
    cards = cards.slice(0, maxCars);
    fs.deckCache[key] = cards;
    return cards;
  }

  // =========================================================================
  // AUTONOMOUS CPU LAP TIME & STRATEGY AI ENGINE (Era Rules + Psychology!)
  // =========================================================================
  function computeCarLapTime(car, circuit, wetness) {
    const st = car.card.game.stats;
    const era = fs.eraRule || ENG.DEFAULT_ERA_RULES;
    const wPace = circuit.aero === "LOW" ? 0.42 : (circuit.aero === "HIGH" ? 0.28 : 0.35);
    const wRace = circuit.aero === "HIGH" ? 0.34 : 0.28;
    const skill = st.pace * wPace + st.racecraft * wRace + st.reliability * 0.16 + st.duels * 0.12 + st.clutch * 0.09;

    let lapS = circuit.base_lap_s - ((skill - 75) * 0.052);
    lapS += ENG.computeLapModifiers({
      compound: car.compound,
      eraRules: era,
      fuelKg: car.fuelKg,
      lap: car.lap,
      totalLaps: fs.totalLaps,
      gripPct: fs.gripPct,
      tyreLife: car.tyreLife,
      tyreTemp: car.tyreTemp,
      wetness,
      paceMode: car.paceMode,
      wingDamaged: car.wingDamaged,
      car,
    });

    if (wetness >= 60) {
      lapS -= ((st.racecraft + st.clutch) - 140) * 0.012;
    }

    // Era-aware ERS / Override / DRS / Slipstream boost
    if (era.ers_enabled) {
      if (car.ersMode === "overtake" && car.ers > 6) lapS -= 0.95;
      else if (car.ersMode === "harvest") lapS += 0.35;
    }
    if (car.inDrsRange && fs.drsEnabled) {
      if (era.drs_enabled) {
        lapS -= 0.32 * Math.min(3, circuit.drs_zones || 2) * 0.45;
      } else if (era.override_mode && car.ers > 12) {
        lapS -= 0.48; // 2026 Manual Override electrical deploy boost <1.0s!
      } else {
        lapS -= 0.16 * (era.slipstream_bonus || 1.0);
      }
    }

    const ab = car.card.game.ability && car.card.game.ability.key;
    if (ab === "drs_overtake" && circuit.drs_zones >= 3) lapS -= 0.25;
    if (ab === "tyre_whisperer" && circuit.tyre_wear >= 4) lapS -= 0.25;
    if (ab === "championship_aura" && car.lap >= fs.totalLaps - 3) lapS -= 0.35;
    if (ab === "giant_killer" && car.pos > 3) lapS -= 0.22;

    // True Safety Car Pack Bunching + Leader Restart Control (P1 backs up pack in S3 on final SC lap!)
    if (fs.safetyCarLaps > 0) {
      const pFrac = (((car.totalProg || 0) % 1) + 1) % 1;
      if (car.pos === 1) {
        if (fs.safetyCarLaps === 1 && pFrac >= 0.94) {
          lapS = circuit.base_lap_s * 0.95; // P1 FLOORS IT before the control line!
          car.aiStatus = "🟢 RESTART JUMP!";
        } else if (fs.safetyCarLaps === 1 && pFrac >= 0.72) {
          lapS = circuit.base_lap_s * 1.62; // P1 backs up pack before restart!
          car.aiStatus = "⚠ BACKING UP PACK";
        } else {
          lapS = circuit.base_lap_s * 1.38;
        }
      } else {
        // Trailing cars catch the nose-to-tail Safety Car queue smoothly!
        const intS = Number(car.intervalS || 0);
        if (intS > 1.8) lapS = circuit.base_lap_s * 1.03;
        else if (intS > 0.65) lapS = circuit.base_lap_s * 1.16;
        else if (fs.safetyCarLaps === 1 && pFrac >= 0.72 && pFrac < 0.94) lapS = circuit.base_lap_s * 1.56;
        else lapS = circuit.base_lap_s * 1.38;
      }
    } else if (fs.vscLaps > 0) {
      lapS = circuit.base_lap_s * 1.24;
    }

    lapS += (Math.random() - 0.5) * 0.42;
    return Math.max(circuit.base_lap_s * 0.84, lapS);
  }

  function updateCpuStrategy(car, sorted) {
    const era = fs.eraRule || ENG.DEFAULT_ERA_RULES;
    const rankIdx = sorted.findIndex((x) => x.idx === car.idx);
    const ahead = rankIdx > 0 ? sorted[rankIdx - 1] : null;
    const behind = rankIdx >= 0 && rankIdx < sorted.length - 1 ? sorted[rankIdx + 1] : null;
    const gapAhead = ahead ? (ahead.totalProg - car.totalProg) * fs.circuit.base_lap_s : 99;
    const gapBehind = behind && !behind.dnf ? (car.totalProg - behind.totalProg) * fs.circuit.base_lap_s : 99;
    const lapsLeft = Math.max(0, fs.totalLaps - car.lap);
    const beh = ENG.getDriverBehaviorModifiers(car, fs.wetness);

    // Driver risk posture adapts to live confidence, momentum & battle gap
    if (car.confidence >= 76 && (gapAhead < 1.2 || lapsLeft <= 4) && car.tyreLife > 38) {
      car.riskMode = "high";
    } else if (car.confidence < 36 || car.tyreLife < 26 || car.wingDamaged) {
      car.riskMode = "low";
    } else {
      car.riskMode = "standard";
    }

    // Dynamic Pace AI (weighted by confidence/overtake boldness)
    const atkThresh = 1.25 * Math.min(1.45, Math.max(0.75, beh.overtakeMult));
    if (fs.safetyCarLaps > 0 || fs.vscLaps > 0) {
      car.paceMode = "conserve";
      car.aiStatus = "SC DELTA";
    } else if (car.tyreLife < 26 || car.tyreTemp > 113) {
      car.paceMode = "conserve";
      car.aiStatus = car.tyreTemp > 113 ? "COOLING TYRES" : "SAVING TYRES";
    } else if ((gapAhead < atkThresh || gapBehind < 0.9 || lapsLeft <= 3) && car.tyreLife > 34) {
      car.paceMode = "push";
      car.aiStatus = era.turbo_boost
        ? "🔥 TURBO BOOST"
        : (gapAhead < atkThresh ? "ATTACKING" : (gapBehind < 0.9 ? "DEFENDING" : "FINAL PUSH"));
    } else if (car.aiPlan === "aggressive" && car.tyreLife > 50) {
      car.paceMode = "push";
      car.aiStatus = era.refuelling ? "LIGHT FUEL SPRINT" : "UNDERCUT PACE";
    } else {
      car.paceMode = "balanced";
      car.aiStatus = "MANAGING GAP";
    }

    // Dynamic ERS / 2026 Manual Override AI (disabled in classic non-ERS eras!)
    if (!era.ers_enabled) {
      car.ersMode = "auto";
    } else if (car.ers < 18) {
      car.ersMode = "harvest";
    } else if ((gapAhead < 0.98 || gapBehind < 0.75) && car.ers > 26 && fs.safetyCarLaps === 0) {
      car.ersMode = "overtake";
      car.aiStatus = era.override_mode
        ? (gapAhead < 0.98 ? "⚡ MANUAL OVERRIDE" : "🛡 ERS DEFEND")
        : (gapAhead < 0.98 ? "⚡ ERS OVERTAKE" : "🛡 ERS DEFEND");
    } else if (car.ers > 82 && car.pos > 1) {
      car.ersMode = "overtake";
    } else if (gapAhead > 2.6 && gapBehind > 2.2 && car.ers < 72) {
      car.ersMode = "harvest";
    } else {
      car.ersMode = "auto";
    }

    if (car.inPit > 0) car.aiStatus = era.refuelling ? "⛽ REFUELLING PIT" : "🔧 IN PIT LANE";
    else if (car.wingDamaged) car.aiStatus = "⚠️ WING DAMAGE";
  }

  // =========================================================================
  // F1 TV AUTO DIRECTOR (Picks Hottest Battles, Crashes, Pit Exits & Finishes!)
  // =========================================================================
  function getActiveBattles(sorted) {
    const battles = [];
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      if (a.dnf || b.dnf || a.inPit > 0 || b.inPit > 0) continue;
      const gap = Math.max(0.02, (a.totalProg - b.totalProg) * fs.circuit.base_lap_s);
      if (gap <= 1.25) {
        // Higher score for closer fights & higher podium/points positions
        const posWeight = Math.max(0.35, 1.35 - (a.pos - 1) * 0.05);
        const drsBoost = (b.inDrsRange && fs.drsEnabled) ? 1.15 : 1.0;
        const score = ((1.35 - gap) * 100) * posWeight * drsBoost;
        battles.push({ ahead: a, chaser: b, gap, pos: a.pos, score });
      }
    }
    battles.sort((x, y) => y.score - x.score);
    return battles;
  }

  function runAutoTvDirector(sorted, emergencyCarIdx, reasonText) {
    if (!fs.autoTv) return;
    const now = fs.raceClock;
    const minHoldS = 14; // ~5-7 real seconds at 2x speed so camera never jitters!

    if (emergencyCarIdx != null && fs.cars[emergencyCarIdx]) {
      fs.focusIdx = emergencyCarIdx;
      fs.lastCamCutClock = now;
      fs.battlePair = null;
      if (!fs.userZoomLocked) setCamMode("battle", true);
      updateChyron(reasonText || `🚨 INCIDENT · ${fs.cars[emergencyCarIdx].card.code3}`);
      return;
    }

    if (now - fs.lastCamCutClock < minHoldS && fs.cars[fs.focusIdx] && !fs.cars[fs.focusIdx].dnf && !(fs.chequeredFlag && fs.cars[fs.focusIdx].finishedRace && (now - (fs.cars[fs.focusIdx].finishTimeS || 0)) > 2.2)) {
      // Refresh chyron text for current target
      const cur = fs.cars[fs.focusIdx];
      const rank = sorted.findIndex((c) => c.idx === cur.idx);
      const ahead = rank > 0 ? sorted[rank - 1] : null;
      const behind = rank >= 0 && rank < sorted.length - 1 ? sorted[rank + 1] : null;
      const gA = ahead ? (ahead.totalProg - cur.totalProg) * fs.circuit.base_lap_s : 99;
      const gB = behind && !behind.dnf ? (cur.totalProg - behind.totalProg) * fs.circuit.base_lap_s : 99;
      if (gA < 0.9 && !cur.finishedRace) updateChyron(`⚔️ BATTLE FOR P${ahead.pos} · ${ahead.card.code3} vs ${cur.card.code3} (+${gA.toFixed(2)}s)`);
      else if (gB < 0.9 && !cur.finishedRace) updateChyron(`⚔️ BATTLE FOR P${cur.pos} · ${cur.card.code3} vs ${behind.card.code3} (+${gB.toFixed(2)}s)`);
      else updateChyron(cur.finishedRace ? `🏁 FINISHED P${cur.pos} · ${cur.card.clean_name.toUpperCase()}` : `🎥 FOLLOWING P${cur.pos} · ${cur.card.clean_name.toUpperCase()}`);
      return;
    }

    const leader = sorted.find((c) => !c.dnf);
    if (!leader) return;
    const leaderLap = leader.lap;

    // Chequered flag out: follow the closest STILL-RACING battle to the line!
    if (fs.chequeredFlag && !fs.finished) {
      const stillRacing = sorted.filter((c) => !c.dnf && !c.finishedRace);
      const liveBattles = getActiveBattles(stillRacing);
      if (liveBattles.length) {
        const pick = liveBattles[0];
        fs.focusIdx = pick.chaser.idx;
        fs.battlePair = pick;
        fs.lastCamCutClock = now;
        if (!fs.userZoomLocked) setCamMode(pick.gap < 0.45 ? "close" : "battle", true);
        updateChyron(`🏁 SPRINT TO LINE FOR P${pick.ahead.pos} · ${pick.ahead.card.code3} vs ${pick.chaser.card.code3} (+${pick.gap.toFixed(2)}s)`);
        return;
      }
      if (stillRacing.length) {
        fs.focusIdx = stillRacing[0].idx;
        fs.battlePair = null;
        fs.lastCamCutClock = now;
        if (!fs.userZoomLocked) setCamMode("battle", true);
        updateChyron(`🏁 FINAL DASH · P${stillRacing[0].pos} ${stillRacing[0].card.clean_name.toUpperCase()} APPROACHING LINE`);
        return;
      }
    }

    // Final lap (pre-chequered)? Lock onto the Lead Battle!
    if (leaderLap >= fs.totalLaps - 1 && !leader.finishedRace) {
      fs.focusIdx = leader.idx;
      fs.lastCamCutClock = now;
      if (!fs.userZoomLocked) setCamMode("battle", true);
      updateChyron(`🏁 FINAL LAP · LEADER ${leader.card.clean_name.toUpperCase()}`);
      return;
    }

    // Safety car? Follow the packed leader train!
    if (fs.safetyCarLaps > 0) {
      fs.focusIdx = leader.idx;
      fs.lastCamCutClock = now;
      if (!fs.userZoomLocked) setCamMode("follow", true);
      updateChyron(`⚠️ SAFETY CAR TRAIN · LED BY ${leader.card.code3}`);
      return;
    }

    const battles = getActiveBattles(sorted);
    if (battles.length) {
      // Prefer top battle, occasionally rotate to #2 if we've already been watching #1
      const pick = (battles.length > 1 && battles[0].chaser.idx === fs.focusIdx && Math.random() < 0.45)
        ? battles[1]
        : battles[0];
      fs.focusIdx = pick.chaser.idx;
      fs.battlePair = pick;
      fs.lastCamCutClock = now;
      if (!fs.userZoomLocked) {
        setCamMode(pick.gap < 0.35 ? "close" : "battle", true);
      }
      updateChyron(`⚔️ BATTLE FOR P${pick.pos} · ${pick.ahead.card.code3} vs ${pick.chaser.card.code3} (+${pick.gap.toFixed(2)}s)`);
    } else {
      fs.focusIdx = leader.idx;
      fs.battlePair = null;
      fs.lastCamCutClock = now;
      if (!fs.userZoomLocked) setCamMode("follow", true);
      updateChyron(`👑 RACE LEADER · ${leader.card.clean_name.toUpperCase()} (P1)`);
    }
  }

  function updateChyron(text) {
    const el = getEl("fsim-chyron-txt");
    if (el) el.textContent = text;
  }

  // =========================================================================
  // CANVAS RENDERING (Real 3D F1Car3D Models + True-Scale Heli Zoom + PiP)
  // =========================================================================
  function drawCanvas() {
    const R = window.F1TrackRenderer;
    const cv = getEl("fsim-track-canvas");
    if (!R || !cv || !fs.circuit) return;
    if (!fs.cam) { fs.cam = R.createCamera(); R.setCameraMode(fs.cam, "battle"); }
    if (!fs.fx) fs.fx = R.createFxState();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = cv.clientWidth || 720;
    const cssH = cv.clientHeight || 520;
    if (cssW < 40 || cssH < 40) return;

    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);
    }

    const cacheKey = `${fs.circuit.id}|${cssW}x${cssH}|${dpr}|${fs.layers.corners}|${fs.layers.sectors}`;
    if (fs.staticKey !== cacheKey || !fs.geom) {
      fs.geom = R.buildGeometry(fs.circuit, cssW, cssH);
      if (!fs.staticCanvas) fs.staticCanvas = document.createElement("canvas");
      R.buildStaticCache(fs.staticCanvas, fs.circuit, fs.geom, dpr, fs.layers);
      fs.staticKey = cacheKey;
    }

    // 60 FPS Interpolated Instant Replay Frame Override (smoothly lerps 20 Hz keyframes in 0.45x Slow-Mo!)
    const isReplaying = fs.replay && fs.replay.active && fs.replay.frames.length > 0;
    let repFrame = null;
    let renderCars = fs.cars;
    if (isReplaying) {
      const fArr = fs.replay.frames;
      const i0 = Math.min(fArr.length - 1, Math.max(0, Math.floor(fs.replay.playPos)));
      const i1 = Math.min(fArr.length - 1, i0 + 1);
      const frac = Math.max(0, Math.min(1, fs.replay.playPos - i0));
      const f0 = fArr[i0], f1 = fArr[i1];
      repFrame = Object.assign({}, f0, {
        raceClock: f0.raceClock + ((f1.raceClock || f0.raceClock) - f0.raceClock) * frac,
        wetness: f0.wetness + ((f1.wetness || f0.wetness) - f0.wetness) * frac,
      });
      const c1Map = new Map();
      (f1.cars || []).forEach((c) => c1Map.set(c.idx, c));
      renderCars = f0.cars.map((rc0) => {
        const rc1 = c1Map.get(rc0.idx) || rc0;
        const base = fs.cars[rc0.idx] || {};
        // Shortest-arc angle interpolation so heading never wraps backward!
        let ang = rc0.visualAngle;
        if (rc0.visualAngle != null && rc1.visualAngle != null) {
          let da = rc1.visualAngle - rc0.visualAngle;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          ang = rc0.visualAngle + da * frac;
        }
        let interpTelem = rc0.telem;
        if (rc0.telem && rc1.telem) {
          const t0 = rc0.telem, t1 = rc1.telem;
          interpTelem = Object.assign({}, t0, {
            kph: Math.round(t0.kph + (t1.kph - t0.kph) * frac),
            rpm: Math.round(t0.rpm + (t1.rpm - t0.rpm) * frac),
            throttle: Math.round(t0.throttle + (t1.throttle - t0.throttle) * frac),
            brake: Math.round(t0.brake + (t1.brake - t0.brake) * frac),
            latG: t0.latG + (t1.latG - t0.latG) * frac,
            longG: t0.longG + (t1.longG - t0.longG) * frac,
            steerAngle: t0.steerAngle + (t1.steerAngle - t0.steerAngle) * frac,
            brakeTemp: Math.round(t0.brakeTemp + (t1.brakeTemp - t0.brakeTemp) * frac),
          });
        }
        return Object.assign({}, base, rc0, {
          totalProg: rc0.totalProg + (rc1.totalProg - rc0.totalProg) * frac,
          latOffset: (rc0.latOffset || 0) + ((rc1.latOffset || 0) - (rc0.latOffset || 0)) * frac,
          visualAngle: ang,
          steerAngle: (rc0.steerAngle || 0) + ((rc1.steerAngle || 0) - (rc0.steerAngle || 0)) * frac,
          spinAngle: (rc0.spinAngle || 0) + ((rc1.spinAngle || 0) - (rc0.spinAngle || 0)) * frac,
          inPit: (rc0.inPit || 0) + ((rc1.inPit || 0) - (rc0.inPit || 0)) * frac,
          telem: interpTelem,
        });
      });
    }
    const activeFocusIdx = isReplaying ? fs.replay.focusIdx : fs.focusIdx;

    const camCar = (renderCars[activeFocusIdx] && !renderCars[activeFocusIdx].dnf)
      ? renderCars[activeFocusIdx]
      : renderCars.find((c) => !c.dnf);

    const camTarget = (camCar && fs.geom && R.computeBattleCameraTarget)
      ? R.computeBattleCameraTarget(camCar, renderCars, fs.geom, fs.circuit, fs.cam.zoom)
      : null;
    R.updateCamera(fs.cam, camTarget, cssW, cssH, fs.lastDt || 0.016);

    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    ctx.save();
    R.applyCameraTransform(ctx, fs.cam, cssW, cssH);
    ctx.drawImage(fs.staticCanvas, 0, 0, cssW, cssH);

    R.drawDynamicTrackState(ctx, fs.circuit, fs.geom, {
      gripPct: isReplaying ? repFrame.gripPct : fs.gripPct,
      drsEnabled: isReplaying ? repFrame.drsEnabled : fs.drsEnabled,
      wetness: isReplaying ? repFrame.wetness : fs.wetness,
      targetWetness: isReplaying ? repFrame.targetWetness : fs.targetWetness,
      drying: isReplaying ? repFrame.drying : fs.drying,
      raceClock: isReplaying ? repFrame.raceClock : fs.raceClock,
      yellowSector: isReplaying ? repFrame.yellowSector : fs.yellowSector,
      scActive: isReplaying ? repFrame.scActive : fs.safetyCarLaps > 0,
      vscActive: isReplaying ? repFrame.vscActive : fs.vscLaps > 0,
      showBestLine: fs.layers.line !== false,
    });
    if (R.drawSkidmarks) R.drawSkidmarks(ctx, fs.fx);
    if (R.drawBattleVortices) R.drawBattleVortices(ctx, renderCars, fs.geom, fs.circuit, fs.cam.zoom);
    if (fs.layers.ai !== false && R.drawAiObservations) R.drawAiObservations(ctx, renderCars, fs.geom, fs.circuit, fs.cam.zoom, camCar);

    // Physical Safety Car ahead of P1 (with alternating amber/green FIA roof lightbar!)
    if ((isReplaying ? repFrame.scActive : fs.safetyCarLaps > 0)) {
      const ldr = renderCars.find((c) => !c.dnf && c.pos === 1);
      if (ldr) {
        const scP = R.sampleTrack(fs.geom, ldr.totalProg + 0.032);
        R.drawMiniF1Car(ctx, scP.x, scP.y, Math.atan2(scP.ty, scP.tx), "#005a3c", "#facc15", {
          isPlayer: false,
          isSafetyCar: true,
          zoom: fs.cam.zoom,
          teamName: "Safety Car",
        });
      }
    }

    // Draw scattered track Carbon-Fibre Debris Shards in 2D!
    if (fs.debrisZones && fs.debrisZones.length) {
      fs.debrisZones.forEach((dz) => {
        const dp = R.sampleTrack(fs.geom, dz.prog);
        ctx.save();
        ctx.translate(dp.x + (dp.nx || 0) * (dz.lat || 0), dp.y + (dp.ny || 0) * (dz.lat || 0));
        for (let k = 0; k < 7; k++) {
          const ang = k * 1.9 + dz.id;
          const r = 1.2 + (k % 3) * 1.4;
          ctx.fillStyle = k % 3 === 0 ? "#f97316" : "#1e293b";
          ctx.fillRect(Math.cos(ang) * r - 0.9, Math.sin(ang) * r - 0.6, 1.8, 1.2);
        }
        ctx.restore();
      });
    }

    // Draw all 20-24 real 3D CPU cars (plus visibly parked smoking trackside breakdowns!)
    fs.carScreenPos = [];
    const labels = [];
    const drawOrder = renderCars.slice().sort((a, b) => (a.idx === activeFocusIdx ? 1 : 0) - (b.idx === activeFocusIdx ? 1 : 0));
    let focusHudInfo = null;

    drawOrder.forEach((car) => {
      if (car.dnf) {
        if (car.cleared) return;
        const bPose = R.sampleTrack(fs.geom, car.parkedProg != null ? car.parkedProg : car.totalProg);
        const bSide = car.parkedSide != null ? car.parkedSide : (car.idx % 2 === 0 ? 1 : -1);
        const bx = bPose.x + (bPose.nx || 0) * (bSide * 10.5);
        const by = bPose.y + (bPose.ny || 0) * (bSide * 10.5);
        const bAng = Math.atan2(bPose.ty, bPose.tx) + (car.parkedYawOff || (bSide * 0.4));
        const comp = COMPOUNDS[car.compound] || COMPOUNDS.medium;
        R.drawMiniF1Car(ctx, bx, by, bAng, (car.card && car.card.hero_color) || "#64748b", comp.color, {
          isPlayer: false, wingDamaged: true, zoom: fs.cam.zoom, era: (car.card && car.card.hero_era) || "2020s",
        });
        // Rising breakdown smoke wisps on the 2D runoff verge!
        const tNow = performance.now() * 0.002;
        ctx.save();
        for (let s = 0; s < 3; s++) {
          const cyc = ((tNow + s * 0.33 + car.idx * 0.17) % 1);
          ctx.fillStyle = `rgba(148,163,184,${(Math.sin(cyc * Math.PI) * 0.55).toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(bx + cyc * 6, by - cyc * 8, 1.8 + cyc * 3.8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        const bsp = R.worldToScreen(fs.cam, bx, by, cssW, cssH);
        if (bsp.x > -20 && bsp.x < cssW + 20 && bsp.y > -20 && bsp.y < cssH + 20) {
          labels.push({
            x: bsp.x + 12, y: bsp.y - 4, pos: "OUT",
            code: `${(car.card && car.card.code3) || "DNF"}💨`,
            color: "#ef4444", compColor: "#ef4444", drsOpen: false, isFocused: false, inPit: false,
          });
        }
        return;
      }
      const inPit = car.inPit > 0 && car.pitDuration > 0;
      const pitProgress = inPit ? (1 - Math.max(0, Math.min(1, car.inPit / car.pitDuration))) : null;
      const pose = inPit
        ? R.samplePitLane(fs.geom, pitProgress, car.pitBoxIdx)
        : R.sampleTrack(fs.geom, car.totalProg);
      const lat = inPit ? 0 : (car.latOffset || 0);
      const wx = pose.x + (pose.nx || 0) * lat;
      const wy = pose.y + (pose.ny || 0) * lat;
      const ang = Math.atan2(pose.ty, pose.tx);
      const isFocused = car.idx === activeFocusIdx;
      const comp = COMPOUNDS[car.compound] || COMPOUNDS.medium;
      const drsOpen = isReplaying ? !!car.drsOpen : (!inPit && fs.drsEnabled && car.inDrsRange && isInDrsZone(fs.circuit, car.totalProg));
      const ersHot = isReplaying ? !!car.ersHot : (!inPit && car.ersMode === "overtake" && car.ers > 6);
      const harvesting = isReplaying ? !!car.harvesting : (!inPit && car.ersMode === "harvest");

      let telem, drawAngle, drawSteer;
      if (isReplaying && car.telem) {
        telem = car.telem;
        drawAngle = car.visualAngle != null ? car.visualAngle : ang;
        drawSteer = car.steerAngle || 0;
      } else {
        const telemRaw = R.computeCarTelemetry(fs.geom, fs.circuit, car.totalProg, {
          car, inPit, drsOpen, ersHot, wetness: fs.wetness, vscActive: fs.vscLaps > 0, scActive: fs.safetyCarLaps > 0,
        });
        const motion = R.computeSmoothCarMotion(car, pose, telemRaw, fs.lastDt || 0.016, inPit);
        telem = motion.telem;
        drawAngle = motion.angle;
        drawSteer = motion.steerAngle;
        car.liveKph = telem.kph;
        car.liveGear = telem.gear;
      }

      const carEra = (car.card && car.card.hero_era) || "2020s";
      const carLiv = (car.card && car.card.hero_palette)
        ? { palette: car.card.hero_palette, style: car.card.hero_livery_style || "two-tone", era: carEra }
        : null;

      R.drawMiniF1Car(ctx, wx, wy, drawAngle, (car.card && car.card.hero_color) || "#e10600", comp.color, {
        isPlayer: isFocused,
        ersHot,
        harvesting,
        drsOpen,
        braking: telem.braking,
        brake: telem.brake,
        steerAngle: drawSteer,
        yawSlip: 0,
        tcamYellow: (car.idx % 2 === 1),
        pitProgress,
        wetness: isReplaying ? repFrame.wetness : fs.wetness,
        spinAngle: car.spinAngle || 0,
        wingDamaged: !!car.wingDamaged,
        inPit,
        refuelling: !!(fs.eraRule && fs.eraRule.refuelling),
        zoom: fs.cam.zoom,
        teamName: (car.card && car.card.hero_team) || "",
        livery: carLiv,
        era: carEra,
      });

      if (isFocused || (!focusHudInfo && camCar && car.idx === camCar.idx)) {
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

      const sp = R.worldToScreen(fs.cam, wx, wy, cssW, cssH);
      fs.carScreenPos.push({ idx: car.idx, x: sp.x, y: sp.y });
      if (sp.x > -30 && sp.x < cssW + 30 && sp.y > -20 && sp.y < cssH + 20) {
        const lblOff = fs.cam.zoom >= 4.0 ? 22 : (fs.cam.zoom > 1.5 ? 17 : 11);
        labels.push({
          x: sp.x + lblOff,
          y: sp.y - 4,
          pos: car.pos,
          code: car.card.code3 || car.card.clean_name.slice(0, 3).toUpperCase(),
          color: car.card.hero_color || "#e10600",
          compColor: comp.color,
          drsOpen,
          isFocused,
          inPit,
        });
      }
    });

    R.stepAndDrawFx(ctx, fs.fx, fs.paused ? 0 : (fs.lastDt || 0.016), fs.cam.zoom);

    // Phase C: Live Pit-Window "Rejoin Ghost" Marker on 2D Track Map for the Focused Car!
    const focCarGhost = !isReplaying && fs.running && !fs.finished && (!fs.formationLap || !fs.formationLap.active)
      ? fs.cars.find((c) => c.idx === fs.focusIdx && !c.dnf && c.inPit <= 0 && c.lap >= 1)
      : null;
    if (focCarGhost && fs.circuit) {
      const pj = computePitRejoin(focCarGhost);
      if (pj) {
        const gPose = R.sampleTrack(fs.geom, pj.rejoinProg);
        const pulse = 0.65 + 0.35 * Math.sin(performance.now() * 0.007);
        const rad = Math.max(3.6, 8.2 / Math.sqrt(Math.max(1, fs.cam.zoom)));
        ctx.save();
        ctx.translate(gPose.x, gPose.y);
        ctx.strokeStyle = pj.trafficCode ? `rgba(250, 204, 21, ${pulse.toFixed(2)})` : `rgba(34, 211, 238, ${pulse.toFixed(2)})`;
        ctx.fillStyle = pj.trafficCode ? "rgba(250, 204, 21, 0.18)" : "rgba(34, 211, 238, 0.22)";
        ctx.lineWidth = Math.max(0.9, 1.8 / Math.sqrt(Math.max(1, fs.cam.zoom)));
        ctx.setLineDash([3.2 / Math.sqrt(Math.max(1, fs.cam.zoom)), 2.2 / Math.sqrt(Math.max(1, fs.cam.zoom))]);
        ctx.beginPath();
        ctx.arc(0, 0, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        const gSp = R.worldToScreen(fs.cam, gPose.x, gPose.y, cssW, cssH);
        if (gSp.x > 10 && gSp.x < cssW - 10 && gSp.y > 10 && gSp.y < cssH - 10) {
          fs._pitGhostScreen = { x: gSp.x, y: gSp.y, pj };
        } else {
          fs._pitGhostScreen = null;
        }
      } else {
        fs._pitGhostScreen = null;
      }
    } else {
      fs._pitGhostScreen = null;
    }

    ctx.restore();

    // Draw crisp screen-space PIT REJOIN P# tag above the ghost marker!
    if (fs._pitGhostScreen) {
      const { x: gx, y: gy, pj } = fs._pitGhostScreen;
      const lbl = pj.trafficCode ? `PIT→P${pj.rejoinPos} (${pj.trafficCode})` : `PIT→P${pj.rejoinPos} CLEAN`;
      ctx.save();
      ctx.font = "800 8px Orbitron, sans-serif";
      const tw = ctx.measureText(lbl).width + 10;
      const bx = Math.max(8, Math.min(cssW - tw - 8, gx - tw * 0.5));
      const by = Math.max(36, gy - 22);
      ctx.fillStyle = "rgba(6, 12, 24, 0.90)";
      ctx.strokeStyle = pj.trafficCode ? "#facc15" : "#22d3ee";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, tw, 15, 4); else ctx.rect(bx, by, tw, 15);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = pj.trafficCode ? "#fde047" : "#67e8f9";
      ctx.textAlign = "center";
      ctx.fillText(lbl, bx + tw * 0.5, by + 10.5);
      ctx.restore();
    }

    // Screen-Space De-Overlapped Driver Broadcast Pills (shared F1RaceEngine)
    ENG.drawDeoverlappedLabels(ctx, labels, cssW, cssH);

    // F1 TV Broadcast Telemetry Halo, FIA Race Control Banner, Instant Replay Frame & 5-Red-Lights-Out Start Gantry
    if (fs.layers.hud !== false && focusHudInfo && R.drawBroadcastTelemetryHud) {
      R.drawBroadcastTelemetryHud(ctx, focusHudInfo, cssW, cssH);
    }
    if (fs.stewardsBanner && fs.stewardsTimer > 0 && R.drawStewardsBanner) {
      R.drawStewardsBanner(ctx, fs.stewardsBanner, cssW, cssH);
    }
    if (isReplaying && R.drawReplayOverlay) {
      R.drawReplayOverlay(ctx, {
        active: true,
        title: fs.replay.title,
        speedLabel: `${fs.replay.speed.toFixed(2)}×`,
        progress: fs.replay.playPos / Math.max(1, fs.replay.frames.length - 1),
      }, cssW, cssH);
    } else if (R.drawStartLightsOverlay) {
      R.drawStartLightsOverlay(ctx, fs.startSeq || fs.raceClock, cssW, cssH);
    }

    if (fs.cam.zoom > 1.15) {
      R.drawMiniMapPiP(ctx, fs.geom, fs.cars.map((c) => ({
        idx: c.idx, totalProg: c.totalProg, dnf: c.dnf, color: c.card.hero_color || "#94a3b8",
      })), (c) => c.idx === fs.focusIdx, cssW, cssH);
    }
  }

  // =========================================================================
  // HUD RENDERING (Timing Tower, Director Console, Battles, Standings)
  // =========================================================================
  function renderHud() {
    const sorted = ENG.sortRaceStandings(fs.cars, fs.finished);
    const leader = sorted[0];
    if (!leader) return;

    sorted.forEach((c, i) => {
      c.pos = i + 1;
      c.intervalS = i > 0 && !c.dnf ? Math.max(0.03, (sorted[i - 1].totalProg - c.totalProg) * fs.circuit.base_lap_s) : 0;
      c.inDrsRange = i > 0 && c.intervalS <= 1.05 && c.inPit === 0 && !c.finishedRace;
    });

    // Update top director bar
    const curLap = Math.min(fs.totalLaps, Math.max(1, leader.lap + 1));
    getEl("fsim-lap-num").textContent = String(curLap).padStart(2, "0");
    getEl("fsim-lap-tot").textContent = String(fs.totalLaps);

    const flagEl = getEl("fsim-flag-pill");
    if (flagEl) {
      if (fs.finished) { flagEl.style.cssText = ""; flagEl.className = "sim-flag-pill flag-finish"; flagEl.innerHTML = `<i class="fas fa-flag-checkered"></i> ${fs.sprintPhase === "sprint" ? "SPRINT FINISH" : "CHEQUERED"}`; }
      else if (fs.formationLap && fs.formationLap.active) { flagEl.style.cssText = ""; flagEl.className = "sim-flag-pill flag-yellow"; flagEl.innerHTML = `<i class="fas fa-sync-alt"></i> FORMATION LAP`; }
      else if (fs.redFlag && fs.redFlag.active) { flagEl.className = "sim-flag-pill flag-yellow"; flagEl.style.background = "rgba(220,38,38,.36)"; flagEl.style.borderColor = "#ef4444"; flagEl.style.color = "#fecaca"; flagEl.innerHTML = `<i class="fas fa-flag"></i> RED FLAG (${Math.ceil(fs.redFlag.timer)}s)`; }
      else if (fs.startSeq && fs.startSeq.active && !fs.startSeq.lightsOut) { flagEl.className = "sim-flag-pill flag-yellow"; flagEl.style.background = "rgba(239,68,68,.24)"; flagEl.style.borderColor = "rgba(239,68,68,.65)"; flagEl.style.color = "#fca5a5"; flagEl.innerHTML = `<i class="fas fa-traffic-light"></i> GRID ${fs.startSeq.litCount || 0}/5`; }
      else if (fs.chequeredFlag) { flagEl.style.cssText = ""; flagEl.className = "sim-flag-pill flag-finish"; flagEl.innerHTML = `<i class="fas fa-flag-checkered"></i> FINISHING (${fs.chequeredFinishedCount}/${fs.chequeredRunningCount})`; }
      else if (fs.safetyCarLaps > 0) { flagEl.style.cssText = ""; flagEl.className = "sim-flag-pill flag-sc"; flagEl.innerHTML = `<i class="fas fa-car-side"></i> SAFETY CAR`; }
      else if (fs.vscLaps > 0) { flagEl.style.cssText = ""; flagEl.className = "sim-flag-pill flag-sc"; flagEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> VSC`; }
      else if (fs.yellowSector > 0) { flagEl.style.cssText = ""; flagEl.className = "sim-flag-pill flag-yellow"; flagEl.innerHTML = fs.yellowLevel === 2 ? `<i class="fas fa-exclamation-triangle"></i> DBL YELLOW S${fs.yellowSector}` : `<i class="fas fa-exclamation"></i> YELLOW S${fs.yellowSector}`; }
      else if (fs.cars.some((c) => !c.dnf && (c.meatballFlag || c.wingDamaged))) { flagEl.className = "sim-flag-pill"; flagEl.style.background = "rgba(248,250,252,.22)"; flagEl.style.borderColor = "#f8fafc"; flagEl.style.color = "#f8fafc"; flagEl.innerHTML = `<i class="fas fa-flag"></i> WHITE FLAG · SLOW CAR`; }
      else if ((fs.debrisZones && fs.debrisZones.length > 0) || (fs.wetness >= 18 && fs.wetness <= 45)) { flagEl.className = "sim-flag-pill"; flagEl.style.background = "repeating-linear-gradient(90deg, rgba(250,204,21,.28) 0 8px, rgba(239,68,68,.28) 8px 16px)"; flagEl.style.borderColor = "#facc15"; flagEl.style.color = "#fef08a"; flagEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> SLIPPERY SURFACE`; }
      else if (fs.drsEnabled) { flagEl.style.cssText = ""; flagEl.className = "sim-flag-pill flag-green"; flagEl.innerHTML = `<i class="fas fa-flag"></i> GREEN · DRS ON`; }
      else { flagEl.style.cssText = ""; flagEl.className = "sim-flag-pill flag-green"; flagEl.innerHTML = `<i class="fas fa-flag"></i> GREEN FLAG`; }
    }

    const wetPct = Math.round(fs.wetness);
    const wPill = getEl("fsim-weather-pill");
    if (wPill) {
      wPill.className = `sim-weather-pill ${wetPct >= 60 ? "w-wet" : (wetPct >= 22 ? "w-damp" : "w-dry")}`;
      wPill.querySelector("i").className = wetPct >= 60 ? "fas fa-cloud-showers-heavy" : (wetPct >= 22 ? "fas fa-cloud-rain" : "fas fa-sun");
      getEl("fsim-weather-txt").textContent = wetPct >= 60 ? `RAIN ${wetPct}%` : (wetPct >= 22 ? `DAMP ${wetPct}%` : `DRY ${wetPct}%`);
      getEl("fsim-wet-fill").style.width = `${wetPct}%`;
    }

    // Timing Tower (F1 Manager Multi-Mode: INT / LDR / LAPS / SEC / TYRE / CONF)
    const cntEl = getEl("fsim-grid-count");
    if (cntEl) cntEl.textContent = `(${sorted.length})`;
    const TT = window.F1TimingTower;
    if (TT) {
      TT.updateTableHeaders(getEl("fsim-timing-table"), fs.gapMode);
      const towerRows = sorted.map((c) => ({
        idx: c.idx,
        code3: c.card.code3,
        name: c.card.clean_name,
        color: c.card.hero_color || "#e10600",
        compound: c.compound,
        tyreLife: c.tyreLife,
        tyreAge: Math.max(0, c.lap - (c.lastPitLap || 0)),
        ers: c.ers,
        stops: c.stops,
        lap: c.lap,
        lastPitLap: c.lastPitLap || 0,
        totalProg: c.totalProg,
        inPit: c.inPit,
        dnf: c.dnf,
        finishedRace: !!c.finishedRace,
        finishLaps: c.finishLaps || 0,
        finishTimeS: c.finishTimeS || 0,
        drsOpen: !!(c.inDrsRange && fs.drsEnabled && !c.dnf && !c.finishedRace),
        gridPos: c.gridPos || (c.idx + 1),
        lastLapTime: c.lastLapTime || c.currentLapS,
        bestLapS: c.bestLapS || c.currentLapS,
        sectorTimes: c.sectorTimes || [0, 0, 0],
        bestSectors: c.bestSectors || [999, 999, 999],
        confidence: c.confidence ?? 60,
        momentum: c.momentum ?? 0,
      }));
      getEl("fsim-timing-body").innerHTML = TT.renderTimingRows({
        sorted: towerRows,
        mode: fs.gapMode,
        circuit: fs.circuit,
        bestSectors: fs.bestSectors,
        fastestLap: fs.fastestLap,
        focusIdx: fs.focusIdx,
        onRowClickAttr: "data-fsim-idx",
      });
    }

    // Focused Car Telemetry Card
    const foc = fs.cars[fs.focusIdx] || leader;
    if (foc) {
      const fRank = sorted.findIndex((x) => x.idx === foc.idx);
      const ahead = fRank > 0 ? sorted[fRank - 1] : null;
      const behind = fRank >= 0 && fRank < sorted.length - 1 ? sorted[fRank + 1] : null;
      const fComp = COMPOUNDS[foc.compound] || COMPOUNDS.medium;
      const life = Math.max(0, Math.round(foc.tyreLife));

      const cardEl = getEl("fsim-focus-card");
      if (cardEl) cardEl.style.setProperty("--drv-col", foc.card.hero_color || "#e10600");
      getEl("fsim-f-code").textContent = foc.card.code3;
      getEl("fsim-f-name").textContent = foc.card.clean_name;
      getEl("fsim-f-team").textContent = `${foc.card.hero_team} · OVR ${Math.round(foc.card.overall)}${foc.engineer ? " · 🎧 " + foc.engineer.short : ""}`;
      getEl("fsim-f-pos").textContent = foc.dnf ? "DNF" : `P${foc.pos}`;
      getEl("fsim-f-lap").textContent = foc.inPit > 0 ? "IN PIT" : fmtLapTime(foc.currentLapS);

      const ahBtn = getEl("fsim-f-ahead");
      if (ahBtn) {
        ahBtn.dataset.jumpIdx = ahead ? String(ahead.idx) : "";
        ahBtn.textContent = (!ahead || foc.dnf) ? "▲ RACE LEADER" : `▲ -${Math.max(0.05, (ahead.totalProg - foc.totalProg) * fs.circuit.base_lap_s).toFixed(2)}s ${ahead.card.code3}`;
      }
      const bhBtn = getEl("fsim-f-behind");
      if (bhBtn) {
        bhBtn.dataset.jumpIdx = (behind && !behind.dnf) ? String(behind.idx) : "";
        bhBtn.textContent = (!behind || behind.dnf || foc.dnf) ? "▼ CLEAR" : `▼ +${Math.max(0.05, (foc.totalProg - behind.totalProg) * fs.circuit.base_lap_s).toFixed(2)}s ${behind.card.code3}`;
      }

      getEl("fsim-f-kph").textContent = foc.dnf ? "0" : String(foc.liveKph || 0);
      getEl("fsim-f-gear").textContent = foc.dnf ? "N" : `G${foc.liveGear || 5}`;
      getEl("fsim-f-sectors").innerHTML = [0, 1, 2].map((s) => `<i class="sd-${foc.sectorColors[s] || "none"}">S${s + 1}</i>`).join("");
      getEl("fsim-f-ai").textContent = foc.aiStatus || "CPU AI";

      // Confidence, Momentum, Track Affinity & Active Era Pills
      const tier = ENG.confidenceTier(foc.confidence ?? 60);
      const cPill = getEl("fsim-f-conf");
      if (cPill) cPill.innerHTML = `CONF <b style="color:${tier.color}">${Math.round(foc.confidence ?? 60)} ${tier.label}</b>`;
      const mVal = Math.round(foc.momentum ?? 0);
      const mPill = getEl("fsim-f-mom");
      if (mPill) {
        const mCol = mVal >= 10 ? "#4ade80" : (mVal <= -10 ? "#f87171" : "#cbd5e1");
        mPill.innerHTML = `MOM <b style="color:${mCol}">${mVal >= 0 ? "+" : ""}${mVal}</b>`;
      }
      const aff = Number(foc.trackAffinity || 0);
      const aPill = getEl("fsim-f-aff");
      if (aPill) {
        const aCol = aff > 0.25 ? "#4ade80" : (aff < -0.25 ? "#f87171" : "#cbd5e1");
        aPill.innerHTML = `TRK <b style="color:${aCol}">${aff >= 0 ? "+" : ""}${aff.toFixed(1)}</b>`;
      }
      const ePill = getEl("fsim-f-era");
      if (ePill) ePill.textContent = (fs.eraRule && fs.eraRule.key ? fs.eraRule.key.toUpperCase() : "2026");

      const pwPill = getEl("fsim-f-pitwin");
      if (pwPill) {
        const pj = (!foc.dnf && foc.inPit <= 0 && foc.lap >= 1 && !fs.finished) ? computePitRejoin(foc) : null;
        if (pj) {
          const pCol = pj.trafficCode ? "#facc15" : "#22d3ee";
          pwPill.innerHTML = `PIT <b style="color:${pCol}">P${pj.rejoinPos}${pj.trafficCode ? "·" + pj.trafficCode : ""}</b>`;
          pwPill.title = pj.trafficCode
            ? `Pit now -> rejoins P${pj.rejoinPos} right behind ${pj.trafficCode} (+${pj.trafficGapS.toFixed(1)}s traffic)`
            : `Pit now -> rejoins P${pj.rejoinPos} in clean air!`;
        } else {
          pwPill.innerHTML = `PIT <b>—</b>`;
        }
      }

      getEl("fsim-f-tyre").innerHTML = `<span class="sim-tbadge t-${foc.compound}">${fComp.code}</span> ${life}%`;
      const tempEl = getEl("fsim-f-temp");
      const t = Math.round(foc.tyreTemp);
      tempEl.textContent = `${t}°C`;
      tempEl.className = `sim-temp-tag ${t > 114 ? "temp-hot" : (t < 84 ? "temp-cold" : "temp-opt")}`;
      const tBar = getEl("fsim-f-tyre-bar");
      tBar.style.width = `${life}%`;
      tBar.style.background = life < 25 ? "#ef4444" : (life < 50 ? "#f59e0b" : "#22c55e");

      getEl("fsim-f-ers").textContent = `${Math.round(foc.ers)}%`;
      getEl("fsim-f-ers-bar").style.width = `${Math.round(foc.ers)}%`;
      getEl("fsim-f-ers-mode").textContent = foc.ersMode.toUpperCase();
    }

    // Hottest On-Track Battles Radar
    const battles = getActiveBattles(sorted).slice(0, 4);
    const bList = getEl("fsim-battles-list");
    if (bList) {
      bList.innerHTML = battles.length
        ? battles.map((b) => {
            const isSel = b.chaser.idx === fs.focusIdx || b.ahead.idx === fs.focusIdx;
            const drs = (b.chaser.inDrsRange && fs.drsEnabled) ? `<span class="sim-drs-pill">DRS</span>` : "";
            return `
              <button type="button" class="fsim-battle-row${isSel ? " is-watching" : ""}" data-watch-idx="${b.chaser.idx}">
                <span class="fsim-b-pos">P${b.pos}</span>
                <span class="fsim-b-pair">
                  <i style="background:${esc(b.ahead.card.hero_color)}"></i><b>${esc(b.ahead.card.code3)}</b>
                  <small>vs</small>
                  <i style="background:${esc(b.chaser.card.hero_color)}"></i><b>${esc(b.chaser.card.code3)}</b>
                </span>
                ${drs}
                <span class="fsim-b-gap">+${b.gap.toFixed(2)}s</span>
              </button>
            `;
          }).join("")
        : `<div class="muted small" style="padding:4px 0;">Field spread out — watching for next DRS train…</div>`;
    }

    // Broadcast Race Stats & Fastest Lap
    getEl("fsim-st-ovt").textContent = String(fs.stats.overtakes);
    getEl("fsim-st-pits").textContent = String(fs.stats.pits);
    getEl("fsim-st-inc").textContent = String(fs.stats.incidents);
    getEl("fsim-st-dnf").textContent = String(fs.stats.dnfs);
    const flEl = getEl("fsim-fl-badge");
    if (flEl) flEl.textContent = fs.fastestLap.code3 ? `FL ${fs.fastestLap.code3} ${fmtLapTime(fs.fastestLap.time)}` : "FL —";

    renderWeatherForecast(curLap);
    if (fs.season.active) renderSeasonStandings();
  }

  function renderWeatherForecast(curLap) {
    const strip = getEl("fsim-forecast-strip");
    if (!strip) return;
    const slots = [0, 2, 4, 6].map((off) => {
      const lap = Math.min(fs.totalLaps, curLap + off);
      const w = off === 0 ? fs.wetness : (fs.weatherMode === "dry" ? 0 : (fs.weatherMode === "rain" ? 78 : Math.max(0, Math.min(95, fs.targetWetness + (off * 2 - 3)))));
      const ic = w >= 55 ? "🌧" : (w >= 22 ? "🌦" : "☀");
      return `<div class="fsim-fc-cell"><small>L${lap}</small><span>${ic} ${Math.round(w)}%</span></div>`;
    });
    strip.innerHTML = slots.join("");
  }

  function renderSeasonStandings() {
    const wdcEl = getEl("fsim-wdc-list");
    const wccEl = getEl("fsim-wcc-list");
    const wdcArr = Object.values(fs.season.wdc).sort((a, b) => (b.pts - a.pts) || (b.wins - a.wins));
    const wccArr = Object.values(fs.season.wcc).sort((a, b) => (b.pts - a.pts) || (b.wins - a.wins));

    if (wdcEl) {
      wdcEl.innerHTML = wdcArr.length
        ? wdcArr.slice(0, 12).map((d, i) => `
            <div class="fsim-st-row">
              <span class="fsim-st-p">${i + 1}</span>
              <span class="st-bar" style="background:${esc(d.color)}"></span>
              <strong class="fsim-st-n">${esc(d.code3)}</strong>
              <small class="muted">${esc(d.team)}</small>
              <span class="fsim-st-pts">${d.pts}</span>
            </div>
          `).join("")
        : `<div class="muted small">Start a CPU Championship in Setup to track season WDC standings!</div>`;
    }
    if (wccEl) {
      wccEl.innerHTML = wccArr.length
        ? wccArr.slice(0, 12).map((t, i) => `
            <div class="fsim-st-row">
              <span class="fsim-st-p">${i + 1}</span>
              <span class="st-bar" style="background:${esc(t.color)}"></span>
              <strong class="fsim-st-n">${esc(t.team)}</strong>
              <small class="muted">${t.wins}W</small>
              <span class="fsim-st-pts">${t.pts}</span>
            </div>
          `).join("")
        : `<div class="muted small">Start a CPU Championship in Setup to track WCC standings!</div>`;
    }
  }

  // =========================================================================
  // PHASE C: PIT-WINDOW REJOIN GHOST + LIVE Q1/Q2/Q3 KNOCKOUT QUALIFYING
  // =========================================================================
  function computePitRejoin(car) {
    if (!car || !fs.circuit || car.dnf || car.inPit > 0) return null;
    const baseLap = Math.max(55, car.currentLapS || fs.circuit.base_lap_s || 84);
    const scMult = fs.safetyCarLaps > 0 ? 0.56 : (fs.vscLaps > 0 ? 0.68 : 1.0);
    const effPitLoss = (fs.circuit.pit_loss_s || 21.5) * scMult;
    const rejoinProg = car.totalProg - (effPitLoss / baseLap);
    let aheadCount = 0;
    let nearestAhead = null;
    let minGapS = 999;
    for (let i = 0; i < fs.cars.length; i++) {
      const o = fs.cars[i];
      if (o.idx === car.idx || o.dnf) continue;
      if (o.totalProg > rejoinProg) {
        aheadCount += 1;
        const gS = (o.totalProg - rejoinProg) * baseLap;
        if (gS < minGapS) {
          minGapS = gS;
          nearestAhead = o;
        }
      }
    }
    return {
      rejoinProg,
      rejoinPos: aheadCount + 1,
      trafficCode: (nearestAhead && minGapS < 1.55) ? nearestAhead.card.code3 : "",
      trafficGapS: minGapS,
    };
  }

  function runLiveQualifyingShootout(cardsRaw, circuit, isSprintShootout) {
    return new Promise((resolve) => {
      const modal = getEl("fsim-quali-modal");
      const badge = getEl("fsim-quali-badge");
      const title = getEl("fsim-quali-title");
      const sub = getEl("fsim-quali-sub");
      const clock = getEl("fsim-quali-clock");
      const tbody = getEl("fsim-quali-tbody");
      const skipBtn = getEl("fsim-quali-skip-btn");
      const goBtn = getEl("fsim-quali-go-btn");
      if (!modal || !tbody) { resolve(cardsRaw.slice()); return; }

      if (typeof fs.qualiAbort === "function") fs.qualiAbort();
      let cancelled = false;
      let timerId = null;

      const baseLap = Math.max(62, Number(circuit.base_lap_s || 84));
      const entries = cardsRaw.map((card, i) => ({
        card,
        id: i,
        eliminatedIn: 0, // 1=Q1, 2=Q2
        bestLap: 999,
        sectors: ["none", "none", "none"],
        status: "OUT LAP",
      }));

      const stages = [
        { num: 1, code: isSprintShootout ? "SQ1" : "Q1", label: isSprintShootout ? "SPRINT QUALIFYING 1" : "Q1 · KNOCKOUT", keep: Math.min(15, Math.max(10, entries.length - 5)), mins: isSprintShootout ? 12 : 18 },
        { num: 2, code: isSprintShootout ? "SQ2" : "Q2", label: isSprintShootout ? "SPRINT QUALIFYING 2" : "Q2 · KNOCKOUT", keep: Math.min(10, Math.max(6, entries.length - 10)), mins: isSprintShootout ? 10 : 15 },
        { num: 3, code: isSprintShootout ? "SQ3" : "Q3", label: isSprintShootout ? "SPRINT POLE SHOOTOUT" : "Q3 · POLE SHOOTOUT", keep: 10, mins: isSprintShootout ? 8 : 12 },
      ];

      let stageIdx = 0;
      let tick = 0;
      const TICKS_PER_STAGE = 7;

      const simLapFor = (ent, stgNum, improvementBias) => {
        const pace = Number((ent.card.game && ent.card.game.stats && ent.card.game.stats.pace) || ent.card.overall || 78);
        const ovr = Number(ent.card.overall || 78);
        const skill = (pace * 0.68 + ovr * 0.32 - 80) * 0.085;
        const gripBoost = (stgNum - 1) * 0.35 + improvementBias * 0.22;
        const noise = (Math.random() - 0.5) * 0.88;
        return Math.max(baseLap * 0.88, baseLap - 1.4 - skill - gripBoost + noise);
      };

      const renderStage = (finishedAll) => {
        const stg = stages[Math.min(stageIdx, stages.length - 1)];
        const active = entries.filter((e) => !e.eliminatedIn).sort((a, b) => a.bestLap - b.bestLap);
        const elimQ2 = entries.filter((e) => e.eliminatedIn === 2).sort((a, b) => a.bestLap - b.bestLap);
        const elimQ1 = entries.filter((e) => e.eliminatedIn === 1).sort((a, b) => a.bestLap - b.bestLap);
        const ordered = [...active, ...elimQ2, ...elimQ1];
        const poleLap = active[0] && active[0].bestLap < 900 ? active[0].bestLap : baseLap;

        if (badge) badge.textContent = finishedAll ? (isSprintShootout ? "SPRINT GRID SET" : "STARTING GRID SET") : stg.label;
        if (title) title.textContent = `${circuit.name.toUpperCase()} — ${isSprintShootout ? "2026 SPRINT SHOOTOUT" : "FIA QUALIFYING"}`;
        if (sub) sub.textContent = finishedAll
          ? `Pole Position: ${ordered[0]?.card.clean_name || "—"} (${fmtLapTime(poleLap)})`
          : (stg.num < 3 ? `Top ${stg.keep} advance · Bottom ${Math.max(0, active.length - stg.keep)} eliminated` : "Top 10 fighting for Pole Position!");

        if (clock) {
          const remFrac = finishedAll ? 0 : Math.max(0, 1 - tick / TICKS_PER_STAGE);
          const remSec = Math.round(stg.mins * 60 * remFrac);
          const mm = String(Math.floor(remSec / 60)).padStart(2, "0");
          const ss = String(remSec % 60).padStart(2, "0");
          clock.textContent = finishedAll ? "00:00" : `${mm}:${ss}`;
        }

        tbody.innerHTML = ordered.map((e, idx) => {
          const pos = idx + 1;
          const isCutoff = !finishedAll && stg.num < 3 && pos === stg.keep;
          const isElim = e.eliminatedIn > 0 || (!finishedAll && stg.num < 3 && pos > stg.keep);
          const isPole = pos === 1 && e.bestLap < 900;
          const gapTxt = e.bestLap >= 900 ? "NO TIME" : (pos === 1 ? "POLE" : `+${(e.bestLap - poleLap).toFixed(3)}`);
          const stTxt = e.eliminatedIn === 1 ? "OUT Q1" : (e.eliminatedIn === 2 ? "OUT Q2" : (finishedAll ? (pos === 1 ? "🏆 POLE" : `GRID P${pos}`) : e.status));
          const secHtml = e.sectors.map((s) => `<td><span class="q-sec-dot ${s}"></span></td>`).join("");
          return `<tr class="${isCutoff ? "q-cutoff " : ""}${isElim ? "q-elim " : ""}${isPole ? "q-pole" : ""}">
            <td><strong>${pos}</strong></td>
            <td><span class="st-bar" style="background:${esc(e.card.hero_color || "#e10600")};display:inline-block;width:3px;height:11px;margin-right:5px;vertical-align:middle;"></span><strong>${esc(e.card.code3)}</strong> ${esc(e.card.clean_name)}</td>
            <td class="muted">${esc(e.card.hero_team || "")}</td>
            ${secHtml}
            <td><strong>${e.bestLap < 900 ? fmtLapTime(e.bestLap) : "—"}</strong></td>
            <td>${gapTxt}</td>
            <td><span style="color:${isPole ? "#c084fc" : (isElim ? "#f87171" : "#4ade80")};font-weight:700;">${stTxt}</span></td>
          </tr>`;
        }).join("");
        return ordered;
      };

      const finalizeStage = () => {
        const stg = stages[stageIdx];
        const active = entries.filter((e) => !e.eliminatedIn);
        active.forEach((e) => {
          const t = simLapFor(e, stg.num, 1.0);
          if (t < e.bestLap) e.bestLap = t;
          e.sectors = [Math.random() < 0.25 ? "purple" : "green", Math.random() < 0.25 ? "purple" : "green", "green"];
        });
        active.sort((a, b) => a.bestLap - b.bestLap);
        if (stg.num < 3) {
          active.slice(stg.keep).forEach((e) => {
            e.eliminatedIn = stg.num;
            e.status = `OUT ${stg.code}`;
          });
          active.slice(0, stg.keep).forEach((e) => {
            e.bestLap = 999; // Reset clock for next qualifying segment!
            e.sectors = ["none", "none", "none"];
            e.status = "ADVANCES";
          });
          stageIdx += 1;
          tick = 0;
          renderStage(false);
        } else {
          // Q3 complete!
          clearInterval(timerId);
          timerId = null;
          const finalOrder = renderStage(true);
          skipBtn?.classList.add("hidden");
          goBtn?.classList.remove("hidden");
          goBtn.onclick = () => {
            modal.classList.add("hidden");
            resolve(finalOrder.map((e) => e.card));
          };
          // Auto-proceed after 2.6s so broadcast flows naturally!
          timerId = setTimeout(() => {
            if (!cancelled && !modal.classList.contains("hidden")) {
              modal.classList.add("hidden");
              resolve(finalOrder.map((e) => e.card));
            }
          }, 2600);
        }
      };

      const stepTick = () => {
        if (cancelled) return;
        const stg = stages[stageIdx];
        tick += 1;
        const active = entries.filter((e) => !e.eliminatedIn);
        let bestSoFar = Math.min(...active.map((x) => x.bestLap), 999);
        active.forEach((e) => {
          if (tick === 1 || Math.random() < 0.58) {
            // Authentic FIA Double-Yellow Qualifying Lap Deletion (~3.5% mid-session hazard!)
            if (tick >= 3 && Math.random() < 0.035 && e.bestLap < 900) {
              e.sectors = ["yellow", "yellow", "yellow"];
              e.status = "DEL · DBL YEL";
              return;
            }
            const t = simLapFor(e, stg.num, tick / TICKS_PER_STAGE);
            if (t < e.bestLap) {
              const isPurp = t < bestSoFar;
              if (isPurp) bestSoFar = t;
              e.bestLap = t;
              e.sectors = [
                isPurp ? "purple" : (Math.random() < 0.65 ? "green" : "yellow"),
                isPurp ? "purple" : (Math.random() < 0.7 ? "green" : "yellow"),
                isPurp ? "purple" : "green",
              ];
              e.status = isPurp ? "PURPLE!" : "PB LAP";
            } else {
              e.sectors = ["green", "yellow", "yellow"];
              e.status = "IN PIT";
            }
          }
        });
        renderStage(false);
        if (tick >= TICKS_PER_STAGE) finalizeStage();
      };

      modal.classList.remove("hidden");
      skipBtn?.classList.remove("hidden");
      goBtn?.classList.add("hidden");
      skipBtn.onclick = () => {
        if (cancelled) return;
        finalizeStage();
      };
      fs.qualiAbort = () => {
        cancelled = true;
        clearInterval(timerId);
        clearTimeout(timerId);
        modal.classList.add("hidden");
      };

      renderStage(false);
      timerId = setInterval(stepTick, 460);
    });
  }

  // =========================================================================
  // SIMULATION TICK (Fixed-Timestep Substepped: Era Rules + Psychology + Telemetry)
  // =========================================================================
  function stepSimCore(effDt, fastMode) {
    if (!fs.running || fs.finished) return false;
    const era = fs.eraRule || ENG.DEFAULT_ERA_RULES;
    const dt = effDt;
    const lapScale = (fs.circuit.base_lap_s / 22.0);
    const simDt = dt * lapScale;

    // Phase C: Optional FIA Formation Lap (Tyre-Warming Weave -> Staggered Grid -> 5 Red Lights!)
    if (fs.formationLap && fs.formationLap.active) {
      if (fastMode) {
        fs.formationLap.active = false;
        fs.cars.forEach((c) => {
          const opt = (COMPOUNDS[c.compound] || COMPOUNDS.medium).optTemp;
          c.tyreTemp = opt - 2;
        });
        fs.startSeq = window.F1TrackArchitect
          ? window.F1TrackArchitect.createStandingStartState(fs.cars, fs.circuit, { skip: true })
          : null;
      } else {
        fs.formationLap.elapsed += dt;
        const frac = Math.min(1, fs.formationLap.elapsed / fs.formationLap.duration);
        fs.cars.forEach((c, idx) => {
          const baseP = 0.02 + frac * 0.96 - idx * 0.0045;
          c.totalProg = baseP;
          const pose = fs.geom && window.F1TrackRenderer ? window.F1TrackRenderer.sampleTrack(fs.geom, baseP) : { curv: 0 };
          // Authentic F1 formation-lap tyre-warming weaves on straights, settling into grid slots past 90%!
          const weaveAmp = frac > 0.88 ? 0 : (Math.abs(pose.curv || 0) < 0.14 ? 3.2 : 0.7);
          const gridLat = (idx % 2 === 0 ? -2.55 : 2.55);
          c.latOffset = frac > 0.88 ? gridLat : Math.sin(fs.formationLap.elapsed * 4.6 + idx * 0.65) * weaveAmp;
          const optT = (COMPOUNDS[c.compound] || COMPOUNDS.medium).optTemp;
          c.tyreTemp = Math.min(optT, (c.tyreTemp || 68) + dt * 3.4);
          c.liveKph = frac > 0.92 ? Math.max(40, Math.round((1 - (frac - 0.92) / 0.08) * 140)) : 148;
          c.livePhysKph = c.liveKph;
          c.liveGear = c.liveKph > 110 ? 4 : 2;
          c.liveLongG = 0;
          c.aiStatus = frac > 0.88 ? "GRID SLOT" : "WARMING TYRES";
        });
        if (fs.formationLap.elapsed >= fs.formationLap.duration) {
          fs.formationLap.active = false;
          fs.startSeq = window.F1TrackArchitect
            ? window.F1TrackArchitect.createStandingStartState(fs.cars, fs.circuit)
            : null;
          addCommentary(1, `🔴 Formation lap complete — tyres warmed to ~${Math.round(fs.cars[0]?.tyreTemp || 96)}°C, cars locking into FIA grid boxes!`, "info");
          showToast("🔴 CARS ON GRID — 5 RED LIGHTS IMMINENT!", "info");
          updateChyron(`🔴 STANDING START · POLE: ${fs.cars[0]?.card.code3 || "P1"}`);
          renderHud();
        } else if (performance.now() - fs.lastUiSync > 220) {
          fs.lastUiSync = performance.now();
          renderHud();
        }
        return true;
      }
    }

    // FIA Red Flag Suspension Countdown (Pit-Lane Repairs + Free Tyre Change -> 5-Red-Lights Standing Restart!)
    if (fs.redFlag && fs.redFlag.active) {
      fs.redFlag.timer -= dt;
      fs.cars.forEach((c) => {
        if (!c.dnf) { c.liveKph = 0; c.livePhysKph = 0; c.liveGear = 1; c.aiStatus = "🚩 RED FLAG · PIT REPAIR"; }
      });
      if (fs.redFlag.timer <= 0) {
        executeRedFlagStandingRestart(fastMode);
      }
      if (!fastMode && (performance.now() - fs.lastUiSync > 220)) { fs.lastUiSync = performance.now(); renderHud(); }
      return !fastMode ? false : true;
    }

    // FIA 5-Red-Lights Standing Start Sequence (0 kph grid hold -> randomized hold -> LIGHTS OUT!)
    if (fs.startSeq && fs.startSeq.active && window.F1TrackArchitect) {
      const sRes = window.F1TrackArchitect.stepStandingStart(fs.startSeq, fs.cars, dt, fastMode);
      // Official FIA Jump Start / False Start Grid-Sensor Detection (+5s unserved time penalty!)
      if (Array.isArray(sRes.jumpStarters) && sRes.jumpStarters.length) {
        sRes.jumpStarters.forEach((jc) => {
          jc.unservedPenaltyS = (jc.unservedPenaltyS || 0) + 5;
          jc.timePenaltyS = (jc.timePenaltyS || 0) + 5;
          addCommentary(1, `⚖️ FIA FALSE START! Grid sensors detect ${jc.card.clean_name} moving before Lights Out — +5s Time Penalty!`, "warn");
          if (!fastMode) {
            showStewardsBanner("⚖️ FIA STEWARDS · FALSE START (+5s)", `${jc.card.clean_name} — Moved prior to start signal (Art. 48.1)`, "penalty");
            playSfx("radioAlert");
          }
          if (fs.telemetry) fs.telemetry.addEvent(1, "penalty", `${jc.card.code3} Jump Start`, "+5s False Start Penalty", jc.idx);
        });
      }
      if (sRes.newLight > 0 && !fastMode) {
        playSfx("startLight", sRes.newLight);
        updateChyron(`🔴 ${"●".repeat(sRes.newLight)}${"○".repeat(5 - sRes.newLight)} · ${fs.startSeq.bannerLabel || "FIA STANDING START"}`);
        renderHud();
      }
      if (sRes.lightsOutNow) {
        const pole = fs.cars[0];
        if (!fastMode) {
          playSfx("lightsOut");
          showToast(`🟢 LIGHTS OUT — ${fs.circuit.name.toUpperCase()}!`, "win");
        }
        const fastest = fs.cars.slice().sort((a, b) => (a.launchReactionS || 0.3) - (b.launchReactionS || 0.3))[0];
        const stalled = fs.cars.find((c) => c.launchAntiStall);
        let msg = `🟢 LIGHTS OUT at ${fs.circuit.name}! ${pole ? pole.card.clean_name : "Pole"} leads the pack away!`;
        if (fastest && !fastMode) msg += ` Lightning ${(fastest.launchReactionS || 0.18).toFixed(2)}s reaction from ${fastest.card.code3}!`;
        if (stalled && !fastMode) msg += ` ⚠️ ${stalled.card.code3} triggers anti-stall off the line!`;
        addCommentary(1, msg, "win");
        updateChyron(`🟢 LIGHTS OUT · POLE: ${pole ? pole.card.code3 : "P1"}`);
        if (!fastMode) renderHud();
      }
      if (sRes.holding) {
        return false;
      }
    }

    fs.raceClock += simDt;

    const leaderLap = Math.max(...fs.cars.map((c) => c.lap), 0);
    fs.gripPct = Math.min(100, 38 + (leaderLap / Math.max(1, fs.totalLaps)) * 62);
    if (fs.yellowTimer > 0) {
      fs.yellowTimer -= dt;
      if (fs.yellowTimer <= 0) { fs.yellowSector = 0; fs.yellowLevel = 1; }
    }

    const canOvertakeAid = Boolean(era.drs_enabled || era.override_mode);
    const shouldDrs = canOvertakeAid && leaderLap >= 1 && fs.wetness < 20 && fs.safetyCarLaps === 0 && fs.vscLaps === 0;
    if (shouldDrs && !fs.drsEnabled && !fs.drsAnnounced && leaderLap >= 1) {
      fs.drsAnnounced = true;
      const aidLbl = era.override_mode ? "2026 MANUAL OVERRIDE MODE ENABLED!" : "DRS ENABLED!";
      if (!fastMode) showToast(`🟢 RACE CONTROL: ${aidLbl}`, "win");
      addCommentary(leaderLap + 1, `🟢 FIA Race Control: ${aidLbl}`, "win");
    }
    fs.drsEnabled = shouldDrs;

    // Realistic Lap-Based Dynamic Weather Fronts
    if (fs.weatherMode === "dynamic" || fs.weatherMode === "showers") {
      const curLap = Math.max(1, leaderLap + 1);
      if (curLap >= fs.nextWeatherLap) {
        const frontDur = Math.max(4, Math.round(fs.totalLaps * (0.22 + Math.random() * 0.24)));
        fs.nextWeatherLap = curLap + frontDur;
        const chance = fs.weatherMode === "showers" ? 0.58 : Math.min(0.65, (fs.circuit.rain_chance || 20) / 100);
        if (Math.random() < chance && fs.targetWetness < 20) {
          fs.targetWetness = Math.random() < 0.35 ? 80 : 46;
          const msg = `🌧️ Weather Radar: ${fs.targetWetness >= 70 ? "Heavy storm" : "Rain shower"} rolling over ${fs.circuit.name}!`;
          addCommentary(curLap, msg, "warn");
          if (!fastMode) { showToast(msg, "warn"); playSfx("radioAlert"); }
          if (fs.telemetry) fs.telemetry.addEvent(curLap, "rain", "Rain Front", msg, -1);
        } else if (fs.targetWetness >= 20) {
          fs.targetWetness = 0;
          const msg = `☀️ Rain easing at ${fs.circuit.name} — dry racing line emerging!`;
          addCommentary(curLap, msg, "info");
          if (!fastMode) showToast(msg, "win");
        }
      }
      const prevW = fs.wetness;
      const lapFrac = simDt / fs.circuit.base_lap_s;
      const maxDelta = lapFrac * (fs.targetWetness > fs.wetness ? 14 : 10);
      const diffW = fs.targetWetness - fs.wetness;
      fs.wetness += Math.sign(diffW) * Math.min(Math.abs(diffW), maxDelta);
      fs.drying = fs.wetness < prevW - 0.01;
    }

    const sortedNow = ENG.sortRaceStandings(fs.cars, false);
    const prevLeaderLap = leaderLap;
    const baseWearPerLap = Math.min(9.2, 165 / Math.max(12, fs.totalLaps));

    // Pre-step: update CPU strategies, pit lane timers & record pre-step lap/sector
    fs.cars.forEach((car) => {
      if (car.dnf || car.finishedRace) return;
      updateCpuStrategy(car, sortedNow);
      car._prevLap = car.lap;
      car._prevSec = Math.floor((((car.totalProg % 1) + 1) % 1) * 3);
      if (car.inPit > 0) {
        car.inPit -= simDt;
        if (car.inPit <= 0) {
          // Clear any served pit-box time penalty + Meatball repair flag on pit exit!
          if (car.servingPenaltyS > 0) {
            car.unservedPenaltyS = Math.max(0, (car.unservedPenaltyS || 0) - car.servingPenaltyS);
            car.timePenaltyS = Math.max(0, (car.timePenaltyS || 0) - car.servingPenaltyS);
            if (!fastMode && car.pos <= 12) addCommentary(car.lap + 1, `⏱️ ${car.card.clean_name} cleanly serves +${car.servingPenaltyS}s FIA penalty motionless in pit box before tyre swap!`, "info");
            car.servingPenaltyS = 0;
            car.pitPenaltyHoldFrac = 0;
          }
          if (car.meatballFlag) {
            car.meatballFlag = false;
            car.wingDamaged = false;
            if (!fastMode) addCommentary(car.lap + 1, `🔧 ${car.card.clean_name} replaces damaged nose cone — Black & Orange Meatball Flag cleared!`, "info");
          }
          // Authentic FIA Unsafe Pit Release Check: exiting pit box within 1.2s of another car in fast lane!
          const otherInPit = fs.cars.find((o) => o.idx !== car.idx && !o.dnf && o.inPit > 0 && o.inPit < 2.2);
          if (otherInPit && Math.random() < 0.32) {
            car.unservedPenaltyS = (car.unservedPenaltyS || 0) + 5;
            car.timePenaltyS = (car.timePenaltyS || 0) + 5;
            addCommentary(car.lap + 1, `⚖️ FIA UNSAFE RELEASE! ${car.card.clean_name} released into the path of ${otherInPit.card.clean_name} in the fast lane — +5s Penalty!`, "warn");
            if (!fastMode) {
              showStewardsBanner("⚖️ FIA STEWARDS · UNSAFE RELEASE (+5s)", `${car.card.clean_name} released into path of ${otherInPit.card.code3} (Art. 34.14)`, "penalty");
              if (fs.radio) fs.radio.emit("unsafe_release", { idx: car.idx, code3: car.card.code3, name: car.card.clean_name, color: car.card.hero_color, engineer: car.engineer, dna: car.dna, eraKey: (fs.eraRule && fs.eraRule.key) || "2026", lap: car.lap }, { lap: car.lap + 1 });
            }
          }
          car.inPit = 0; car.pitDuration = 0;
          car.compound = car.nextCompound;
          car.tyreLife = 100;
          // Authentic compound blanket exit temps (Softs fire up fast -> undercut; Hards start cold -> overcut risk!)
          const exitTempMap = { soft: 74, medium: 66, hard: 56, inter: 64, wet: 58 };
          car.tyreTemp = exitTempMap[car.compound] || 66;
          car.tyreGraining = 0;
          car.tyreBlistering = 0;
          car.outLapTimer = 1.0;
          if (era.refuelling) {
            const lapsRem = Math.max(2, fs.totalLaps - car.lap);
            car.fuelKg = Math.min(era.start_fuel_kg || 65, lapsRem * (era.fuel_burn_per_lap_kg || 2.3) * 1.15);
          }
          const fixedWing = !!car.wingDamaged;
          car.wingDamaged = false;
          car.stops += 1;
          car.lastPitLap = car.lap;
          if (Array.isArray(car.stintHistory)) {
            const lastSt = car.stintHistory[car.stintHistory.length - 1];
            if (lastSt) lastSt.endLap = Math.max(lastSt.startLap, car.lap);
            car.stintHistory.push({ compound: car.compound, startLap: car.lap + 1, endLap: fs.totalLaps });
          }
          fs.stats.pits += 1;
          if (COMPOUNDS[car.compound].wet > 0) car.usedWet = true;
          else car.dryCompoundsUsed.add(car.compound);
          if (car.pos <= 8 || fixedWing) {
            addCommentary(car.lap + 1, `🔧 ${car.card.clean_name} exits pits on fresh ${COMPOUNDS[car.compound].name}s${era.refuelling ? " + fuel" : ""}${fixedWing ? " + new front wing" : ""}!`, "info");
          }
          if (fs.telemetry) {
            fs.telemetry.addEvent(car.lap + 1, "pit", `${car.card.code3} Pit Stop`, `Switched to ${COMPOUNDS[car.compound].name}${car.pitErrorReason ? " (" + car.pitErrorReason + ")" : ""}`, car.idx);
          }
          car.pitErrorReason = "";
        }
      }
    });

    // Velocity-First Sub-Stepped Longitudinal Integration + Spatial AI + 2D Solid-Body Physics
    const R = window.F1TrackRenderer;
    let incidents = [];
    if (R && fs.geom) {
      if (!fs.fx) fs.fx = R.createFxState();
      incidents = R.stepBattlePhysics(fs.cars, fs.geom, fs.circuit, fs.fx, {
        dt,
        simDt,
        raceClock: fs.raceClock,
        speedMult: fastMode ? 4 : Math.min(4, fs.speedMult),
        wetness: fs.wetness,
        leaderLap,
        totalLaps: fs.totalLaps,
        scActive: fs.safetyCarLaps > 0,
        vscActive: fs.vscLaps > 0,
        yellowSector: fs.yellowSector,
        yellowLevel: fs.yellowLevel || 1,
        drsEnabled: fs.drsEnabled,
        chaosMult: fs.chaosMult,
      });
    }

    fs.cars.forEach((car) => {
      if (car.dnf || car.inPit > 0 || car.finishedRace) return;

      const prevLap = car._prevLap != null ? car._prevLap : car.lap;
      const prevSec = car._prevSec != null ? car._prevSec : Math.floor((((car.totalProg % 1) + 1) % 1) * 3);
      if (!R || !fs.geom) {
        car.totalProg += (1.0 / car.currentLapS) * simDt;
      }
      car.lap = Math.floor(car.totalProg);
      if (car.lockupSmokeTimer > 0) car.lockupSmokeTimer = Math.max(0, car.lockupSmokeTimer - simDt);
      const curSec = Math.floor((((car.totalProg % 1) + 1) % 1) * 3);

      if (curSec !== prevSec && car.lap >= 1) {
        const sTime = (car.currentLapS / 3) * (0.97 + Math.random() * 0.06);
        if (!car.sectorTimes) car.sectorTimes = [0, 0, 0];
        car.sectorTimes[prevSec] = sTime;
        if (sTime < fs.bestSectors[prevSec] && fs.safetyCarLaps === 0 && fs.vscLaps === 0) {
          fs.bestSectors[prevSec] = sTime;
          car.bestSectors[prevSec] = sTime;
          car.sectorColors[prevSec] = "purple";
          ENG.applyPsychologyEvent(car, "purple_sector");
        } else if (sTime < car.bestSectors[prevSec]) {
          car.bestSectors[prevSec] = sTime;
          car.sectorColors[prevSec] = "green";
          ENG.applyPsychologyEvent(car, "pb_sector");
        } else {
          car.sectorColors[prevSec] = "yellow";
        }
      }

      const comp = COMPOUNDS[car.compound] || COMPOUNDS.medium;
      const beh = ENG.getDriverBehaviorModifiers(car, fs.wetness);
      const lapFrac = simDt / fs.circuit.base_lap_s;
      const targetTemp = fs.safetyCarLaps > 0 ? 74 : (comp.optTemp + (car.paceMode === "push" ? 16 : (car.paceMode === "conserve" ? -12 : 0)) - fs.wetness * 0.12);
      // Compound-authentic thermal warm-up rate (Softs warm 2x faster than Hards!)
      const warmRate = car.tyreTemp < targetTemp
        ? (car.compound === "soft" ? 0.34 : (car.compound === "medium" ? 0.21 : 0.12))
        : 0.22;
      car.tyreTemp += (targetTemp - car.tyreTemp) * Math.min(1, dt * warmRate);
      // Live Graining (pushing hard on cold rubber) & Blistering (running overheated > 115°C)!
      if (car.tyreTemp < 78 && car.paceMode === "push" && fs.safetyCarLaps === 0) {
        car.tyreGraining = Math.min(100, (car.tyreGraining || 0) + lapFrac * 42);
      } else if ((car.tyreGraining || 0) > 0) {
        car.tyreGraining = Math.max(0, car.tyreGraining - lapFrac * 24); // Drives through graining phase!
      }
      if (car.tyreTemp > 115 && fs.safetyCarLaps === 0) {
        car.tyreBlistering = Math.min(100, (car.tyreBlistering || 0) + lapFrac * (car.tyreTemp - 114) * 4.5);
      } else if ((car.tyreBlistering || 0) > 0) {
        car.tyreBlistering = Math.max(0, car.tyreBlistering - lapFrac * 8);
      }
      const thermalWear = (car.tyreTemp > 114 ? 1.25 : 1.0) * (1 + ((car.tyreBlistering || 0) / 100) * 0.35);
      const f1dbDegMult = Number(fs.circuitF1db?.tyreDegradation?.tyreDegMultiplier || 1.0);
      const wearMult = (0.65 + (fs.circuit.tyre_wear || 3) * 0.16) * (0.55 + 0.45 * f1dbDegMult) * comp.wear * thermalWear * beh.tyreWearMult * (car.paceMode === "push" ? 1.28 : (car.paceMode === "conserve" ? 0.72 : 1.0));
      car.tyreLife = Math.max(5, car.tyreLife - (wearMult * lapFrac * baseWearPerLap));

      // Keep Safety Car bunching responsive every tick (not just on lap crossing!)
      if (fs.safetyCarLaps > 0) {
        car.currentLapS = computeCarLapTime(car, fs.circuit, fs.wetness);
      }

      if (era.refuelling && Number.isFinite(car.fuelKg)) {
        const burn = (era.fuel_burn_per_lap_kg || 2.3) * (car.paceMode === "push" ? 1.12 : (car.paceMode === "conserve" ? 0.90 : 1.0));
        car.fuelKg = Math.max(0.5, car.fuelKg - burn * lapFrac);
      }

      if (era.ers_enabled) {
        if (car.ersMode === "overtake") car.ers = Math.max(0, car.ers - lapFrac * 34);
        else if (car.ersMode === "harvest") car.ers = Math.min(100, car.ers + lapFrac * 28);
        else car.ers = Math.min(100, car.ers + lapFrac * 6);
      }

      if (car.lap > prevLap) {
        car.lastLapTime = car.currentLapS;
        if (car.lap >= 2 && car.currentLapS < (car.bestLapS || 999) && fs.safetyCarLaps === 0 && fs.vscLaps === 0) {
          car.bestLapS = car.currentLapS;
        }
        if (car.currentLapS < fs.fastestLap.time && fs.safetyCarLaps === 0 && fs.vscLaps === 0 && car.lap >= 2) {
          fs.fastestLap = { time: car.currentLapS, driver: car.card.clean_name, code3: car.card.code3 };
        }

        // Psychology: Clean lap vs Dirty Air vs Driver Lock-Up / Mistake
        if (car.inDrsRange && fs.safetyCarLaps === 0) {
          car.dirtyAirLaps = (car.dirtyAirLaps || 0) + 1;
          if (car.dirtyAirLaps >= 3) ENG.applyPsychologyEvent(car, "dirty_air");
        } else {
          car.dirtyAirLaps = 0;
          ENG.applyPsychologyEvent(car, "clean_lap");
        }
        const mistakeProb = 0.011 * beh.mistakeMult * (car.compMistakeMult || 1.0) * (fs.wetness >= 30 ? 1.4 : 1.0);
        if (car.lap >= 2 && fs.safetyCarLaps === 0 && Math.random() < mistakeProb) {
          const lossS = 0.9 + Math.random() * 1.4;
          car.totalProg -= lossS / fs.circuit.base_lap_s;
          car.lockupSmokeTimer = 1.65;
          ENG.applyPsychologyEvent(car, "mistake");
          if (car.pos <= 8) {
            const corner = (fs.circuit.corners && fs.circuit.corners[Math.floor(Math.random() * fs.circuit.corners.length)]) || "a heavy braking zone";
            addCommentary(car.lap + 1, `💨 LOCK-UP! ${car.card.clean_name} runs wide at ${corner} (-${lossS.toFixed(1)}s, confidence rattled)!`, "warn");
            if (fs.radio && (car.idx === fs.focusIdx || car.pos <= 6)) {
              const rObj = { idx: car.idx, code3: car.card.code3, name: car.card.clean_name, color: car.card.hero_color, confidence: car.confidence, engineer: car.engineer, eng: car.eng, lap: car.lap };
              if (!fastMode) fs.radio.emit("mistake", rObj, { lap: car.lap + 1 });
              else if (fs.telemetry && fs.radio.buildMessage) {
                const m = fs.radio.buildMessage("mistake", rObj, { lap: car.lap + 1 });
                fs.telemetry.addRadio({ lap: car.lap + 1, carIdx: car.idx, code3: car.card.code3, speaker: m.speaker, to: m.to, color: car.card.hero_color, category: "race", severity: "warn", text: m.text });
              }
            }
          }
          if (fs.telemetry) fs.telemetry.addEvent(car.lap + 1, "mistake", `${car.card.code3} Lock-up`, `Lost ${lossS.toFixed(1)}s`, car.idx);
        }

        // 6-Component Car Wear & Live Diagnostic Driver <-> Engineer Radio Calls!
        if (ENG.stepComponentWear) {
          const compAlerts = ENG.stepComponentWear(car, fs.circuit, era, { totalLaps: fs.totalLaps, wetness: fs.wetness });
          compAlerts.forEach((al) => {
            const rType = `comp_${al.comp}`;
            const rObj = { idx: car.idx, code3: car.card.code3, name: car.card.clean_name, color: car.card.hero_color, confidence: car.confidence, engineer: car.engineer, eng: car.eng, lap: car.lap, eraKey: (fs.eraRule && fs.eraRule.key) || "2026" };
            const rCtx = { lap: al.lap, health: al.health, temp: al.temp, kphLoss: al.kphLoss, severity: al.severity, component: al.comp, eraKey: (fs.eraRule && fs.eraRule.key) || "2026", feedbackQuality: car.eng?.feedback?.score || 72 };
            if (fs.telemetry) {
              fs.telemetry.addEvent(al.lap, "component", `${car.card.code3} ${al.label} (${al.health}%)`, al.kphLoss ? `Losing ~${al.kphLoss} kph on straights (+${al.paceLossS}s/L)` : `Wear alert (+${al.paceLossS}s/L)`, car.idx);
            }
            if (fs.radio) {
              if (!fastMode && (car.idx === fs.focusIdx || car.pos <= 8 || al.severity === "critical")) {
                fs.radio.emit(rType, rObj, rCtx, al.severity === "critical" && car.idx === fs.focusIdx);
              } else if (fs.telemetry && fs.radio.buildMessage) {
                const m = fs.radio.buildMessage(rType, rObj, rCtx);
                fs.telemetry.addRadio({ lap: al.lap, carIdx: car.idx, code3: car.card.code3, speaker: m.speaker, to: m.to, color: car.card.hero_color, category: "mechanical", component: al.comp, severity: al.severity, text: m.text, engReply: m.engReply || "", feedbackQuality: rCtx.feedbackQuality });
              }
            }
            if (car.pos <= 6 || car.idx === fs.focusIdx) {
              addCommentary(al.lap, `🔧 RADIO DIAGNOSIS: ${car.card.clean_name} flags ${al.label} wear (${al.health}%${al.kphLoss ? `, -${al.kphLoss} kph straight-line` : ""})!`, "warn");
            }
          });
          // Periodic Engineer Setup Feedback check-ins (Lap 3 & Mid-Race) for rich radio transcript
          if ((car.lap === 3 || car.lap === Math.max(6, Math.round(fs.totalLaps * 0.55))) && (car.idx === fs.focusIdx || car.pos <= 5)) {
            if (fs.radio && fs.radio.buildMessage && fs.telemetry) {
              const rObj = { idx: car.idx, code3: car.card.code3, name: car.card.clean_name, color: car.card.hero_color, confidence: car.confidence, engineer: car.engineer, eng: car.eng, lap: car.lap };
              const rCtx = { lap: car.lap + 1, balanceBias: car.eng?.balanceBias || 0, feedbackQuality: car.eng?.feedback?.score || 72 };
              if (!fastMode && car.idx === fs.focusIdx) {
                fs.radio.emit("setup_feedback", rObj, rCtx);
              } else {
                const m = fs.radio.buildMessage("setup_feedback", rObj, rCtx);
                fs.telemetry.addRadio({ lap: car.lap + 1, carIdx: car.idx, code3: car.card.code3, speaker: m.speaker, to: m.to, color: car.card.hero_color, category: "setup", severity: m.tone, text: m.text, engReply: m.engReply || "", feedbackQuality: rCtx.feedbackQuality });
              }
            }
          }
        }

        if (car.lap >= fs.totalLaps || fs.chequeredFlag) {
          const completedLaps = Math.min(fs.totalLaps, car.lap);
          if (completedLaps >= fs.totalLaps && !hasSatisfiedTwoCompoundRule(car, era) && !fs.redFlagUsed) {
            // Authentic FIA Sporting Regs Art. 30.5m: Failure to use 2 dry compounds in a dry GP = DSQ!
            car.dsq = true;
            car.dnf = true;
            car.dnfReason = "DSQ (2-Compound Rule Art. 30.5m)";
            addCommentary(fs.totalLaps, `⬛ FIA DSQ: ${car.card.clean_name} disqualified for failing to use 2 dry tyre compounds (Art. 30.5m)!`, "warn");
            if (!fastMode) showStewardsBanner("⬛ FIA BLACK FLAG · DSQ (ART. 30.5m)", `${car.card.clean_name} — Failed to run 2 dry compounds!`, "penalty");
          }
          car.finishedRace = true;
          car.finishLaps = completedLaps;
          car.finishTimeS = fs.raceClock;
          car.boxNextLap = false;
          if (!fs.chequeredFlag) {
            fs.chequeredFlag = true;
            fs.chequeredStartS = fs.raceClock;
            fs.allUnlappedDoneAt = null;
            addCommentary(fs.totalLaps, `🏁 ${car.card.clean_name} TAKES THE CHEQUERED FLAG! Field still battling to the line!`, "win");
            if (!fastMode) {
              showToast(`🏁 ${car.card.clean_name} WINS! Cars still racing to the line…`, "win");
              playSfx("checkered");
            }
          }
          return;
        }

        // Era-Scaled Mechanical DNF (car parks visibly trackside with rising engine smoke!)
        const raceMechChance = Math.min(0.28, (car.card.game.stats.dnf_rate / 100) * 0.42 * (era.reliability_dnf_mult || 1.0)) * Math.sqrt(fs.chaosMult);
        const perLapDnf = raceMechChance / Math.max(10, fs.totalLaps);
        const pushRisk = car.paceMode === "push" ? 1.25 : 0.85;
        if (car.lap >= 2 && fs.stats.dnfs < 8 && Math.random() < perLapDnf * pushRisk) {
          parkBreakdownCar(car, "Mechanical", "engine");
          fs.stats.dnfs += 1;
          fs.stats.incidents += 1;
          const secNum = Math.floor((((car.totalProg % 1) + 1) % 1) * 3) + 1;
          fs.yellowSector = secNum; fs.yellowLevel = 2; fs.yellowTimer = 6.5;
          const corner = (fs.circuit.corners && fs.circuit.corners[Math.floor(Math.random() * fs.circuit.corners.length)]) || `Sector ${secNum}`;
          addCommentary(car.lap + 1, `💨 MECHANICAL DNF! ${car.card.clean_name} pulls off smoking at ${corner} — Yellow Flag S${secNum}!`, "warn");
          if (fs.telemetry) fs.telemetry.addEvent(car.lap + 1, "dnf", `${car.card.code3} DNF`, `Smoking mechanical retirement at ${corner}`, car.idx);
          if (fs.safetyCarLaps === 0 && fs.vscLaps === 0) {
            const roll = Math.random();
            const cirScMult = Number(fs.circuitF1db?.incidents?.safetyCarMultiplier || 1.0);
            const cirVscProb = Number(fs.circuitF1db?.incidents?.vscProbability ?? 0.30);
            const scThresh = Math.min(0.85, 0.36 * (era.sc_chance_mult || 1.0) * cirScMult);
            if (roll < scThresh) {
              deploySafetyCar(`${car.card.code3} stopped smoking at ${corner}`, 2, fastMode);
            } else if (era.vsc_enabled && roll < Math.min(0.95, scThresh + Math.max(0.22, cirVscProb * 0.9))) {
              fs.vscLaps = 1;
              if (!fastMode) { showToast("⚠️ VIRTUAL SAFETY CAR (VSC)!", "warn"); playSfx("radioAlert"); }
              addCommentary(car.lap + 1, "⚠️ VIRTUAL SAFETY CAR (VSC) deployed while marshals recover stranded car!", "warn");
            }
          }
          return;
        }

        // FIA Track Limits Strike Counter (Art. 33.3 / ISC App L Ch IV Art 2c: 3 strikes -> Black & White Flag; 4th -> +5s Penalty!)
        if (car.lap >= 2 && fs.safetyCarLaps === 0 && fs.vscLaps === 0 && (car.paceMode === "push" || car.inDrsRange)) {
          if (Math.random() < 0.022 * (fs.chaosMult || 1)) {
            car.trackLimitStrikes = (car.trackLimitStrikes || 0) + 1;
            const tlArt = (fs.fiaPrecedents?.categories?.track_limits?.topArticles?.[0]) || "Art. 33.3";
            if (car.trackLimitStrikes === 3) {
              if (!fastMode && (car.pos <= 8 || car.idx === fs.focusIdx)) {
                showStewardsBanner(`🏁 FIA BLACK & WHITE FLAG · ${tlArt}`, `${car.card.clean_name} — 3 Track Limits Strikes (Final Warning)`, "info");
              }
              addCommentary(car.lap + 1, `🏁 BLACK & WHITE FLAG: ${car.card.clean_name} warned for track limits (${tlArt}, Strike 3/3)!`, "info");
            } else if (car.trackLimitStrikes >= 4 && (car.trackLimitStrikes - 4) % 2 === 0) {
              car.unservedPenaltyS = (car.unservedPenaltyS || 0) + 5;
              car.timePenaltyS = (car.timePenaltyS || 0) + 5;
              if (!fastMode) {
                showStewardsBanner(`⚖️ FIA STEWARDS · +5s PENALTY (${tlArt})`, `${car.card.clean_name} — Exceeding Track Limits (Strike ${car.trackLimitStrikes})`, "penalty");
                playSfx("radioAlert");
              }
              addCommentary(car.lap + 1, `⚖️ FIA PENALTY: +5s for ${car.card.clean_name} (Track Limits — ${tlArt})!`, "warn");
              if (fs.telemetry) fs.telemetry.addEvent(car.lap + 1, "incident", `${car.card.code3} +5s Pen`, `Track Limits (${tlArt})`, car.idx);
            }
          }
        }

        // Era-Aware CPU Pit Strategy (Refuelling, Weather Hysteresis, 2-Compound Rule, F1DB Pit-Lane Loss!)
        const scFactor = fs.safetyCarLaps > 0 ? 0.58 : (fs.vscLaps > 0 ? 0.68 : 1.0);
        const f1dbPitSec = Number(fs.circuitF1db?.pitStops?.medianPitLaneSec || 0);
        const basePitLoss = f1dbPitSec >= 14 && f1dbPitSec <= 38 ? f1dbPitSec : (fs.circuit.pit_loss_s || 21.5);
        const effPit = (basePitLoss + Math.max(0, (era.pit_base_s || 2.3) - 2.3)) * scFactor;
        const lapsLeft = fs.totalLaps - car.lap;
        const lapsSincePit = car.lap - (car.lastPitLap == null ? -99 : car.lastPitLap);
        const minStint = Math.max(3, Math.round(fs.totalLaps * 0.12));

        let weatherTarget = null;
        if (comp.wet === 0 && fs.wetness >= 28 && lapsLeft >= 3) {
          weatherTarget = fs.wetness >= 72 ? "wet" : "inter";
        } else if (comp.wet === 1 && fs.wetness >= 76 && lapsLeft >= 5 && lapsSincePit >= 3) {
          weatherTarget = "wet";
        } else if (comp.wet === 2 && fs.wetness <= 40 && lapsLeft >= 5 && lapsSincePit >= 3) {
          weatherTarget = fs.wetness <= 16 ? "slick" : "inter";
        } else if (comp.wet > 0 && fs.wetness <= 16 && lapsLeft >= 3 && lapsSincePit >= 3) {
          weatherTarget = "slick";
        }

        // FIA Blue Flag 3.0s Radio Pre-Warning!
        if (!fastMode && car.blueFlagPreWarn && car.blueFlagPreTarget && (!car._bfWarnAt || fs.raceClock - car._bfWarnAt > 50)) {
          car._bfWarnAt = fs.raceClock;
          if (fs.radio && (car.idx === fs.focusIdx || car.blueFlagPreTarget.pos <= 3)) {
            fs.radio.emit("blue_flag", { idx: car.idx, code3: car.card.code3, name: car.card.clean_name, color: car.card.hero_color, engineer: car.engineer, dna: car.dna, eraKey: (fs.eraRule && fs.eraRule.key) || "2026", lap: car.lap }, { rival: car.blueFlagPreTarget.card.code3, gapS: car.blueFlagPreGapS || 2.2, lap: car.lap + 1 });
          }
        }

        // FIA Black & Orange Disc ("Meatball") Flag for dangerous dragging front-wing damage!
        if (car.wingDamaged && !car.meatballFlag && lapsLeft >= 3 && Math.random() < 0.55) {
          car.meatballFlag = true;
          car.meatballDeadlineLap = car.lap + 2;
          addCommentary(car.lap + 1, `⚫🟠 FIA MEATBALL FLAG! ${car.card.clean_name}'s front wing endplate is dragging dangerously — mandatory pit stop for nose repair!`, "warn");
          if (!fastMode) {
            showStewardsBanner("⚫🟠 FIA BLACK & ORANGE (MEATBALL) FLAG", `${car.card.clean_name} — Dangerous damage, MUST box within 2 laps (ISC App. H)`, "penalty");
            if (fs.radio) fs.radio.emit("meatball", { idx: car.idx, code3: car.card.code3, name: car.card.clean_name, color: car.card.hero_color, engineer: car.engineer, dna: car.dna, eraKey: (fs.eraRule && fs.eraRule.key) || "2026", lap: car.lap }, { lap: car.lap + 1 });
          }
        }
        // FIA Black Flag (DSQ) if a car ignores a mandatory Meatball Flag past the deadline!
        if (car.meatballFlag && car.lap > (car.meatballDeadlineLap || 999)) {
          car.dsq = true;
          car.dnf = true;
          car.dnfReason = "DSQ (Black Flag)";
          car.cleared = true;
          fs.stats.dnfs += 1;
          addCommentary(car.lap + 1, `⬛ FIA BLACK FLAG (DSQ)! ${car.card.clean_name} disqualified for ignoring mandatory Meatball repair flag!`, "warn");
          if (!fastMode) showStewardsBanner("⬛ FIA BLACK FLAG · DISQUALIFIED", `${car.card.clean_name} — Failed to pit under Black & Orange Flag`, "penalty");
          return;
        }

        const mustFulfillRule = era.two_compound_rule !== false && !car.usedWet && car.dryCompoundsUsed.size < 2 && lapsLeft <= Math.max(3, Math.round(fs.totalLaps * 0.14)) && lapsLeft >= 2;
        const fuelPit = era.refuelling && Number.isFinite(car.fuelKg) && car.fuelKg <= (era.fuel_burn_per_lap_kg || 2.3) * 1.8 && lapsLeft >= 2;
        const scOpportunistic = (fs.safetyCarLaps > 0 || fs.vscLaps > 0) && car.tyreLife < 58 && lapsSincePit >= minStint && lapsLeft >= 4;
        const cliffPit = car.tyreLife < (car.aiPlan === "aggressive" ? 27 : 22) && lapsLeft >= 3 && lapsSincePit >= minStint;
        const wingPit = (car.meatballFlag && lapsLeft >= 2) || (car.wingDamaged && lapsLeft >= 4 && lapsSincePit >= 2);
        // Real Undercut Strategy: Stuck within 2.4s behind a rival in pit window -> box 1 lap early on fresh rubber!
        const rivalAhead = sortedNow[Math.max(0, (car.pos || 2) - 2)];
        const gapToRival = (rivalAhead && rivalAhead.idx !== car.idx && !rivalAhead.dnf) ? (rivalAhead.totalProg - car.totalProg) * fs.circuit.base_lap_s : 99;
        const undercutPit = fs.safetyCarLaps === 0 && fs.wetness < 22 && gapToRival > 0.4 && gapToRival <= 2.4 && car.tyreLife < 44 && car.tyreLife >= 26 && lapsSincePit >= minStint && lapsLeft >= 5 && Math.random() < 0.28;

        if (weatherTarget || mustFulfillRule || fuelPit || scOpportunistic || cliffPit || wingPit || undercutPit) {
          // Real Teammate Double-Stacking in Shared Pit Box (+3.2s hold!)
          const teammate = fs.cars.find((o) => o.idx !== car.idx && !o.dnf && o.card.hero_team === car.card.hero_team && o.inPit > 0);
          const isDoubleStack = Boolean(teammate);
          // Official FIA Rule: Unserved +5s / +10s Time Penalties MUST be served motionless in pit box before crew touches car!
          const servePenS = Math.min(10, Math.round(car.unservedPenaltyS || 0));
          let extraPit = (car.wingDamaged ? 4.5 : 0) + (isDoubleStack ? 3.2 : 0) + servePenS;
          car.servingPenaltyS = servePenS;
          if (servePenS > 0) {
            car.pitPenaltyHoldFrac = Math.min(0.54, servePenS / Math.max(10, (effPit + extraPit) * 0.42));
            if (!fastMode && fs.radio && (car.idx === fs.focusIdx || car.pos <= 8)) {
              fs.radio.emit("penalty_serve", { idx: car.idx, code3: car.card.code3, name: car.card.clean_name, color: car.card.hero_color, engineer: car.engineer, dna: car.dna, eraKey: (fs.eraRule && fs.eraRule.key) || "2026", lap: car.lap }, { penS: servePenS, lap: car.lap + 1 });
            }
          } else {
            car.pitPenaltyHoldFrac = 0;
          }
          if (isDoubleStack) {
            car.pitErrorReason = "Double-Stack +3.2s";
            if (!fastMode && car.pos <= 10) addCommentary(car.lap + 1, `⚠ DOUBLE STACK! ${car.card.clean_name} queues +3.2s behind teammate ${teammate.card.code3} in the ${car.card.hero_team} pit box!`, "warn");
          } else if (undercutPit && !fastMode && car.pos <= 10) {
            addCommentary(car.lap + 1, `⚡ UNDERCUT ATTEMPT! ${car.card.clean_name} boxes early to undercut ${rivalAhead.card.clean_name} (+${gapToRival.toFixed(1)}s)!`, "info");
          }
          if (era.refuelling) {
            const needKg = Math.min(era.start_fuel_kg || 65, Math.max(8, lapsLeft * (era.fuel_burn_per_lap_kg || 2.3)));
            extraPit += needKg * (era.refuel_sec_per_kg || 0.14);
          }
          if (Math.random() < (era.pit_error_chance || 0.035)) {
            const errS = 1.6 + Math.random() * 2.8;
            extraPit += errS;
            car.totalPitDelayS = (car.totalPitDelayS || 0) + errS;
            car.pitErrorReason = `Slow stop +${errS.toFixed(1)}s`;
            ENG.applyPsychologyEvent(car, "slow_pit");
          } else {
            ENG.applyPsychologyEvent(car, "fast_pit");
          }
          // Official FIA Pit-Lane Speed Limit (60 kph tight street circuits vs 80 kph standard) & Tiered Penalties!
          if (car.paceMode === "push" && Math.random() < 0.018) {
            const street60 = ["monaco", "singapore", "zandvoort", "melbourne", "miami", "baku"].includes(fs.circuit.id);
            const lim = street60 ? 60 : 80;
            const overKph = 1.4 + Math.random() * 8.5;
            const penTier = overKph >= 6.0 ? 10 : 5;
            const penLbl = overKph >= 6.0 ? "+10s Stop-Go" : "+5s Penalty";
            car.unservedPenaltyS = (car.unservedPenaltyS || 0) + penTier;
            car.timePenaltyS = (car.timePenaltyS || 0) + penTier;
            if (!fastMode) showStewardsBanner(`⚖️ FIA STEWARDS · ${penLbl.toUpperCase()}`, `${car.card.clean_name} — Speeding in Pit Lane (${(lim + overKph).toFixed(1)} in ${lim} kph zone)`, "penalty");
            addCommentary(car.lap + 1, `⚖️ FIA PENALTY: ${penLbl} for ${car.card.clean_name} — Pit-Lane Speeding (${(lim + overKph).toFixed(1)}/${lim} kph)!`, "warn");
          }
          car.inPit = effPit + extraPit;
          car.pitDuration = car.inPit;
          if (weatherTarget === "wet" || weatherTarget === "inter") {
            car.nextCompound = weatherTarget;
          } else if (fs.wetness >= 24) {
            car.nextCompound = fs.wetness >= 72 ? "wet" : "inter";
          } else {
            const remFrac = lapsLeft / Math.max(1, fs.totalLaps);
            let pref = remFrac <= 0.24 ? "soft" : (remFrac <= 0.44 ? "medium" : "hard");
            if (era.two_compound_rule !== false && !car.usedWet && car.dryCompoundsUsed.size === 1 && car.dryCompoundsUsed.has(pref)) {
              pref = pref === "medium" ? (remFrac > 0.32 ? "hard" : "soft") : "medium";
            }
            car.nextCompound = pref;
          }
        }

        car.currentLapS = computeCarLapTime(car, fs.circuit, fs.wetness);
      }
    });

    // Dynamic CPU Team Orders: Faster teammate on fresher tyres within 0.85s -> clean Pit-Wall swap!
    if (fs.safetyCarLaps === 0 && fs.vscLaps === 0 && !fs.chequeredFlag && leaderLap >= 2 && leaderLap < fs.totalLaps - 1) {
      for (let i = 1; i < sortedNow.length; i++) {
        const front = sortedNow[i - 1], back = sortedNow[i];
        if (front.dnf || back.dnf || front.inPit > 0 || back.inPit > 0) continue;
        if (front.card.hero_team !== back.card.hero_team) continue;
        const gapS = (front.totalProg - back.totalProg) * fs.circuit.base_lap_s;
        if (gapS > 0.15 && gapS <= 0.85 && ((back.tyreLife - front.tyreLife) >= 18 || (front.currentLapS - back.currentLapS) >= 0.75)) {
          const toKey = `to_${front.idx}_${back.idx}`;
          if (!fs.overtakeCooldown[toKey] || fs.raceClock >= fs.overtakeCooldown[toKey]) {
            fs.overtakeCooldown[toKey] = fs.raceClock + 95;
            const swapDelta = (gapS + 0.25) / fs.circuit.base_lap_s;
            back.totalProg += swapDelta * 0.55;
            front.totalProg -= swapDelta * 0.45;
            addCommentary(leaderLap + 1, `📻 TEAM ORDERS (${front.card.hero_team}): ${front.card.clean_name} yields cleanly to faster teammate ${back.card.clean_name} on fresher rubber!`, "info");
            if (fs.radio && !fastMode && front.pos <= 10) {
              fs.radio.emit("team_order", { idx: front.idx, code3: front.card.code3, name: front.card.clean_name, color: front.card.hero_color, engineer: front.engineer, dna: front.dna, eraKey: (fs.eraRule && fs.eraRule.key) || "2026", lap: front.lap }, { lap: leaderLap + 1, rival: back.card.clean_name });
            }
          }
        }
      }
    }

    // FIA Art. 33.3: Leaving the Track & Gaining a Lasting Advantage (Voluntary Give-Back vs +5s Penalty!)
    if (fs.safetyCarLaps === 0 && fs.vscLaps === 0 && !fs.chequeredFlag && leaderLap >= 2 && leaderLap < fs.totalLaps - 1 && Math.random() < 0.0022 * (fs.chaosMult || 1)) {
      const candIdx = 1 + Math.floor(Math.random() * Math.min(9, Math.max(1, sortedNow.length - 1)));
      const passer = sortedNow[candIdx - 1], victim = sortedNow[candIdx];
      if (passer && victim && !passer.dnf && !victim.dnf && passer.inPit <= 0 && victim.inPit <= 0) {
        const gS = (passer.totalProg - victim.totalProg) * fs.circuit.base_lap_s;
        if (gS > 0.05 && gS < 0.65) {
          const willYield = (passer.composure || 70) >= (passer.aggression || 68) - 4;
          if (willYield) {
            passer.totalProg -= (gS + 0.18) / fs.circuit.base_lap_s;
            addCommentary(leaderLap + 1, `⚖️ FIA ART. 33.3: ${passer.card.clean_name} ran off-track overtaking ${victim.card.clean_name} — voluntarily hands the place back!`, "info");
            if (fs.radio && !fastMode) {
              fs.radio.emit("give_place_back", { idx: passer.idx, code3: passer.card.code3, name: passer.card.clean_name, color: passer.card.hero_color, engineer: passer.engineer, dna: passer.dna, lap: passer.lap }, { lap: leaderLap + 1, rival: victim.card.clean_name });
            }
          } else {
            passer.unservedPenaltyS = (passer.unservedPenaltyS || 0) + 5;
            passer.timePenaltyS = (passer.timePenaltyS || 0) + 5;
            if (!fastMode) {
              showStewardsBanner("⚖️ FIA STEWARDS · +5s (ART. 33.3)", `${passer.card.clean_name} — Leaving Track & Gaining Advantage vs ${victim.card.code3}`, "penalty");
              playSfx("radioAlert");
            }
            addCommentary(leaderLap + 1, `⚖️ FIA PENALTY: +5s for ${passer.card.clean_name} — Leaving the track & gaining an advantage over ${victim.card.clean_name}!`, "warn");
          }
        }
      }
    }

    // Proactive Accented Race Engineer Undercut Radio Call (when clean-air pit window opens!)
    if (!fastMode && fs.radio && fs.safetyCarLaps === 0 && leaderLap >= 4 && leaderLap < fs.totalLaps - 3 && Math.random() < 0.003) {
      const foc = fs.cars[fs.focusIdx];
      const rankFoc = sortedNow.findIndex((c) => c === foc);
      if (foc && !foc.dnf && foc.inPit <= 0 && foc.tyreLife < 58 && rankFoc > 0 && rankFoc <= 8) {
        const target = sortedNow[rankFoc - 1];
        const gapT = (target.totalProg - foc.totalProg) * fs.circuit.base_lap_s;
        if (gapT < 2.2 && ENG && ENG.computePitRejoin) {
          const rejoin = ENG.computePitRejoin(fs.cars, foc, fs.circuit, fs.circuit.pit_loss_s || 22);
          if (rejoin.cleanAir) {
            fs.radio.emit("proactive_undercut", { idx: foc.idx, code3: foc.card.code3, name: foc.card.clean_name, color: foc.card.hero_color, engineer: foc.engineer, dna: foc.dna, lap: foc.lap }, { lap: leaderLap + 1, rival: target.card.clean_name });
          }
        }
      }
    }

    // Process FIA Stewards & Incident Events
    if (R && fs.geom) {
      incidents.forEach((ev) => {
        const aName = ev.chaser.card.clean_name, bName = ev.target.card.clean_name;
        const corner = (fs.circuit.corners && fs.circuit.corners[Math.floor(Math.random() * fs.circuit.corners.length)]) || `Sector ${ev.sector}`;
        const clipTitle = ev.type === "fia_breach"
          ? `FIA STEWARDS · ${ev.culprit.card.code3} MOVING UNDER BRAKING AT ${corner.toUpperCase()}`
          : `${ev.type.toUpperCase()} AT ${corner.toUpperCase()} · ${ev.chaser.card.code3} & ${ev.target.card.code3}`;
        const clipId = fastMode ? null : saveReplayClip(clipTitle, (ev.culprit || ev.target).idx);

        if (ev.type === "fia_breach" || ev.type === "blue_flag_ignore") {
          if (ev.penaltyS && ev.culprit) {
            ev.culprit.unservedPenaltyS = (ev.culprit.unservedPenaltyS || 0) + ev.penaltyS;
            ev.culprit.timePenaltyS = (ev.culprit.timePenaltyS || 0) + ev.penaltyS;
          }
          if (!fastMode) {
            showStewardsBanner(`⚖️ FIA RACE CONTROL · ${ev.article || "APP. L CH. IV"}`, `${ev.culprit.card.clean_name} — ${ev.fiaRule} (${ev.verdict})`, ev.penaltyS ? "penalty" : "info");
            playSfx("radioAlert");
          }
          if (ev.type === "blue_flag_ignore") {
            addCommentary(leaderLap + 1, `🔵⚖️ FIA PENALTY: +5s for ${ev.culprit.card.clean_name} — Ignoring Blue Flags (3 marshal posts impeding ${ev.chaser.card.code3})!`, "warn", clipId);
          } else {
            emitBroadcastCall("fia_mub", { lap: leaderLap + 1, culprit: ev.culprit.card.clean_name, victim: ev.chaser.card.clean_name, article: ev.article, verdict: ev.verdict, clipId });
          }
          return;
        }

        fs.stats.incidents += 1;
        if (ev.penaltyS && ev.culprit) {
          ev.culprit.unservedPenaltyS = (ev.culprit.unservedPenaltyS || 0) + ev.penaltyS;
          ev.culprit.timePenaltyS = (ev.culprit.timePenaltyS || 0) + ev.penaltyS;
        }
        ENG.applyPsychologyEvent(ev.chaser, "mistake");
        ENG.applyPsychologyEvent(ev.target, "mistake");
        if (ev.type === "contact") {
          addCommentary(leaderLap + 1, `💥 WHEEL-TO-WHEEL! ${aName} & ${bName} bang wheels at ${corner} — ${ev.verdict}!`, "warn", clipId);
          if (!fastMode) runAutoTvDirector(sortedNow, ev.chaser.idx, `💥 CONTACT · ${ev.chaser.card.code3} & ${ev.target.card.code3}`);
        } else if (ev.type === "spin") {
          fs.yellowSector = ev.sector; fs.yellowLevel = 1; fs.yellowTimer = 5.5;
          const penTxt = ev.penaltyS ? ` (${ev.fiaRule}: +${ev.penaltyS}s)` : ` (${ev.verdict})`;
          const msg = `🎙 CROFTY: SPIN AT ${corner.toUpperCase()}! ${aName} & ${bName} make contact${penTxt}!`;
          addCommentary(leaderLap + 1, msg, "warn", clipId);
          if (!fastMode) { showToast(msg, "warn"); playSfx("radioAlert"); runAutoTvDirector(sortedNow, ev.target.idx, `🌀 SPIN AT ${corner.toUpperCase()}!`); }
          if (fs.telemetry) fs.telemetry.addEvent(leaderLap + 1, "incident", `Spin at ${corner}`, `${ev.chaser.card.code3} & ${ev.target.card.code3}`, ev.target.idx);
        } else if (ev.type === "crash") {
          fs.yellowSector = ev.sector; fs.yellowLevel = 2; fs.yellowTimer = 8.5;
          spawnDebrisZone(ev.target.totalProg, ev.target.latOffset, leaderLap + 1);
          let crashDnfs = 0;
          if (ev.target.dnf) { parkBreakdownCar(ev.target, "Collision", "crash"); fs.stats.dnfs += 1; crashDnfs += 1; }
          if (ev.chaser.dnf) { parkBreakdownCar(ev.chaser, "Collision", "crash"); fs.stats.dnfs += 1; crashDnfs += 1; }
          const msg = `🚨 CROFTY: HUGE INCIDENT AT ${corner.toUpperCase()}! ${aName} & ${bName} tangle — carbon debris across the circuit!`;
          addCommentary(leaderLap + 1, msg, "warn", clipId);
          if (!fastMode) { showToast(msg, "warn"); playSfx("radioAlert"); runAutoTvDirector(sortedNow, ev.chaser.idx, `🚨 CRASH AT ${corner.toUpperCase()}!`); }
          if (fs.telemetry) fs.telemetry.addEvent(leaderLap + 1, "sc", `Crash & Debris at ${corner}`, `${aName} & ${bName}`, ev.chaser.idx);
          // Realistic Red Flag calibrated by F1DB historical circuit red-flag probability!
          const cirRfProb = Number(fs.circuitF1db?.incidents?.redFlagProbability ?? 0.08);
          const rfChance = Math.min(0.45, Math.max(0.05, 0.05 + cirRfProb * 0.65)) * (fs.chaosMult || 1);
          if (!fs.redFlagUsed && leaderLap >= 2 && leaderLap <= fs.totalLaps - 3 && (crashDnfs >= 2 || Math.random() < rfChance)) {
            triggerRedFlag(`Heavy collision & barrier debris at ${corner}`, fastMode);
          } else if (fs.safetyCarLaps === 0) {
            deploySafetyCar(`Collision & debris at ${corner}`, 2, fastMode);
          }
        }
      });

      if (!fastMode) {
        fs.replayRecAccum += dt;
        if (fs.replayRecAccum >= 0.05) {
          fs.replayRecAccum = 0;
          recordReplayFrame();
        }
        if (fs.stewardsTimer > 0) {
          fs.stewardsTimer = Math.max(0, fs.stewardsTimer - dt);
          if (fs.stewardsTimer <= 0) fs.stewardsBanner = null;
        }
      }
    }

    const newLeaderLap = Math.max(...fs.cars.map((c) => c.lap), 0);
    if (newLeaderLap > prevLeaderLap) {
      // Clear marshaled track debris zones once cleared
      if (fs.debrisZones.length) {
        fs.debrisZones = fs.debrisZones.filter((dz) => newLeaderLap < dz.clearAtLap);
      }
      // Torrential Monsoon Red Flag check (wetness >= 88%, rare & realistic!)
      if (!fs.redFlagUsed && fs.wetness >= 88 && newLeaderLap >= 2 && newLeaderLap <= fs.totalLaps - 3 && Math.random() < 0.25) {
        triggerRedFlag(`Torrential standing water (${Math.round(fs.wetness)}%)`, fastMode);
      }
      if (fs.safetyCarLaps > 0) {
        // FIA Art. 55.13: Lapped Cars May Now Overtake the Safety Car before final SC lap!
        if (fs.safetyCarLaps === 2 && !fs.scUnlapped) {
          fs.scUnlapped = true;
          const leaderProg = Math.max(...fs.cars.filter((c) => !c.dnf).map((c) => c.totalProg), 0);
          const lapped = fs.cars.filter((c) => !c.dnf && !c.finishedRace && (leaderProg - c.totalProg) >= 0.92);
          if (lapped.length) {
            lapped.forEach((lc) => { lc.totalProg += 1.0; lc.lap = Math.floor(lc.totalProg); });
            addCommentary(newLeaderLap + 1, `🟡 FIA ART. 55.13: Lapped cars (${lapped.map((x) => x.card.code3).join(", ")}) overtake the Safety Car to unlap themselves!`, "info");
            if (!fastMode) showStewardsBanner("⚠ FIA ART. 55.13 · UNLAPPING", `Lapped cars may now overtake the Safety Car (${lapped.length} unlapped)`, "info");
          }
        }
        fs.safetyCarLaps -= 1;
        if (fs.safetyCarLaps === 1) {
          addCommentary(newLeaderLap + 1, "🟡 SAFETY CAR IN THIS LAP — roof lights extinguished, pack preparing for restart!", "warn");
        } else if (fs.safetyCarLaps === 0) {
          fs.scUnlapped = false;
          fs.debrisZones = [];
          addCommentary(newLeaderLap + 1, "🟢 SAFETY CAR IN — GREEN FLAG RESTART!", "win");
          if (!fastMode) showToast("🟢 SAFETY CAR IN — RACING RESUMES!", "win");
        }
      }
      if (fs.vscLaps > 0) {
        fs.vscLaps -= 1;
        if (fs.vscLaps === 0) {
          addCommentary(newLeaderLap + 1, "🟢 VSC ENDING — GREEN FLAG!", "win");
          if (!fastMode) showToast("🟢 VSC ENDING — GREEN FLAG!", "win");
        }
      }
      // Record scrubbable full-grid lap telemetry frame!
      if (fs.telemetry) {
        const snapSorted = fs.cars.slice().sort((a, b) => (a.dnf !== b.dnf ? (a.dnf ? 1 : -1) : b.totalProg - a.totalProg));
        fs.telemetry.recordLapSnapshot(newLeaderLap, snapSorted, {
          wetness: fs.wetness,
          scActive: fs.safetyCarLaps > 0,
          vscActive: fs.vscLaps > 0,
        });
      }
    }

    // Evaluate FIA Chequered Flag Completion (end only once all unlapped cars cross the line!)
    if (fs.chequeredFlag && !fs.finished) {
      const finStatus = ENG.evaluateChequeredCompletion(
        fs.cars,
        fs.totalLaps,
        fs.raceClock,
        fs.chequeredStartS,
        fs.allUnlappedDoneAt,
        fs.circuit.base_lap_s,
      );
      fs.chequeredFinishedCount = finStatus.finishedCount;
      fs.chequeredRunningCount = finStatus.runningCount;
      fs.allUnlappedDoneAt = finStatus.allUnlappedDoneAt;
      if (finStatus.done) {
        finishGrandPrix();
        return false;
      }
    }

    // Track genuine on-track overtakes + psychology swings
    const sortedAfter = ENG.sortRaceStandings(fs.cars, false);
    const onTrack = sortedAfter.filter((c) => !c.dnf && !c.finishedRace && c.inPit === 0).map((c) => c.idx);
    if (fs.prevOnTrackOrder.length && fs.safetyCarLaps === 0 && fs.vscLaps === 0) {
      const prevIdxMap = new Map();
      fs.prevOnTrackOrder.forEach((id, r) => prevIdxMap.set(id, r));
      for (let r = 0; r < onTrack.length; r++) {
        const passerId = onTrack[r];
        const prevR = prevIdxMap.get(passerId);
        if (prevR == null || r >= prevR) continue;
        const victimId = onTrack[r + 1];
        const victimPrevR = victimId != null ? prevIdxMap.get(victimId) : null;
        if (victimId != null && victimPrevR != null && victimPrevR < prevR) {
          const pk = passerId < victimId ? `${passerId}_${victimId}` : `${victimId}_${passerId}`;
          if (!fs.overtakeCooldown[pk] || fs.raceClock >= fs.overtakeCooldown[pk]) {
            fs.overtakeCooldown[pk] = fs.raceClock + 18;
            fs.stats.overtakes += 1;
            const passer = fs.cars[passerId];
            const victim = fs.cars[victimId];
            if (passer) ENG.applyPsychologyEvent(passer, "overtake");
            if (victim) ENG.applyPsychologyEvent(victim, "overtaken");
            if (passer && victim && passer.pos <= 6) {
              const corner = (fs.circuit.corners && fs.circuit.corners[Math.floor(Math.random() * fs.circuit.corners.length)]) || "Turn 1";
              const clipId = fastMode ? null : saveReplayClip(`OVERTAKE FOR P${passer.pos} · ${passer.card.code3} PASSES ${victim.card.code3}`, passer.idx);
              const kind = passer.battleState === "cutback"
                ? "overtake_cutback"
                : (passer.battleState === "tow" || passer.inDrsRange ? "overtake_drs" : "overtake_dive");
              emitBroadcastCall(kind, { lap: passer.lap + 1, passer: passer.card.clean_name, victim: victim.card.clean_name, pos: passer.pos, corner, clipId });
              if (fs.telemetry) fs.telemetry.addEvent(passer.lap + 1, "overtake", `${passer.card.code3} passes ${victim.card.code3}`, `For P${passer.pos} at ${corner}`, passer.idx);
              if (!fastMode && fs.radio && (passer.idx === fs.focusIdx || passer.pos <= 3)) {
                fs.radio.emit("overtake", { code3: passer.card.code3, name: passer.card.clean_name, color: passer.card.hero_color, confidence: passer.confidence, engineer: passer.engineer, lap: passer.lap }, { rival: victim.card.code3, lap: passer.lap + 1 });
              }
              // FIA Art. 33.3: Leaving the track & gaining a lasting advantage -> voluntary give-back OR +5s Stewards Penalty!
              if (passer.lap >= 2 && fs.wetness < 20 && Math.random() < 0.042) {
                const givesBack = Math.random() < 0.58;
                if (givesBack) {
                  const tmpP = passer.totalProg;
                  passer.totalProg = Math.min(passer.totalProg, victim.totalProg - 0.0012);
                  victim.totalProg = Math.max(victim.totalProg, tmpP);
                  addCommentary(passer.lap + 1, `⚖️ FIA RACE CONTROL: ${passer.card.clean_name} ran off-track at ${corner} — voluntarily gives P${passer.pos} back to ${victim.card.clean_name} to avoid a penalty!`, "info");
                  if (!fastMode && fs.radio) fs.radio.emit("give_place_back", { idx: passer.idx, code3: passer.card.code3, name: passer.card.clean_name, color: passer.card.hero_color, engineer: passer.engineer, dna: passer.dna, eraKey: (fs.eraRule && fs.eraRule.key) || "2026", lap: passer.lap }, { rival: victim.card.code3, lap: passer.lap + 1 });
                } else {
                  passer.unservedPenaltyS = (passer.unservedPenaltyS || 0) + 5;
                  passer.timePenaltyS = (passer.timePenaltyS || 0) + 5;
                  addCommentary(passer.lap + 1, `⚖️ FIA STEWARDS: +5s for ${passer.card.clean_name} — Leaving track & gaining a lasting advantage on ${victim.card.clean_name} at ${corner}!`, "warn");
                  if (!fastMode) showStewardsBanner("⚖️ FIA STEWARDS · +5s PENALTY", `${passer.card.clean_name} — Leaving track & gaining an advantage (Art. 33.3)`, "penalty");
                }
              }
            }
          }
        }
      }
    }
    fs.prevOnTrackOrder = onTrack;
    if (onTrack.length && fs.prevLeaderIdx !== -1 && onTrack[0] !== fs.prevLeaderIdx) {
      fs.stats.leadChanges += 1;
    }
    if (onTrack.length) fs.prevLeaderIdx = onTrack[0];

    if (!fastMode) {
      const now = performance.now();
      if (now - fs.lastUiSync > 160) {
        fs.lastUiSync = now;
        renderHud();
        runAutoTvDirector(sortedAfter, null, null);
      }
    }
    return fs.running && !fs.finished;
  }

  function stepSimulation(dt) {
    if (!fs.running || fs.paused || fs.finished || fs.simToEndActive) return;
    ENG.runFixedSubsteps(dt, fs.speedMult, 0.08, (subDt) => stepSimCore(subDt, false));
  }

  function runSimToEnd() {
    if (!fs.running || fs.finished || fs.simToEndActive) return;
    stopInstantReplay();
    fs.paused = false;
    fs.simToEndActive = true;
    const ovl = getEl("fsim-simtoend-ovl");
    const bar = getEl("fsim-ste-bar");
    const sub = getEl("fsim-ste-sub");
    if (ovl) ovl.classList.remove("hidden");

    const pump = () => {
      if (!fs.simToEndActive || fs.finished || !fs.running) {
        fs.simToEndActive = false;
        if (ovl) ovl.classList.add("hidden");
        renderHud();
        drawCanvas();
        return;
      }
      // Run 90 substeps per animation frame (~6-8 laps/sec while keeping browser responsive!)
      for (let i = 0; i < 90; i++) {
        if (!stepSimCore(0.08, true)) break;
      }
      const lLap = Math.min(fs.totalLaps, Math.max(...fs.cars.map((c) => c.lap), 0) + 1);
      const pct = Math.min(100, Math.round((lLap / Math.max(1, fs.totalLaps)) * 100));
      if (bar) bar.style.width = `${pct}%`;
      if (sub) sub.textContent = `Lap ${lLap} / ${fs.totalLaps} (${pct}%)`;
      if (fs.finished) {
        fs.simToEndActive = false;
        if (ovl) ovl.classList.add("hidden");
        renderHud();
        drawCanvas();
      } else {
        requestAnimationFrame(pump);
      }
    };
    requestAnimationFrame(pump);
  }

  function finishGrandPrix() {
    fs.finished = true;
    fs.running = false;
    // Classify any remaining far-back lapped cars at race conclusion + FIA Two Dry Tyre Compounds DSQ check!
    const eraFin = fs.eraRule || ENG.DEFAULT_ERA_RULES;
    const enforceTwoDry = eraFin.two_compound_rule !== false && fs.sprintPhase !== "sprint" && fs.totalLaps >= 8;
    fs.cars.forEach((c) => {
      if (!c.dnf && enforceTwoDry && !c.usedWet && c.dryCompoundsUsed && c.dryCompoundsUsed.size < 2) {
        c.dsq = true;
        c.dnf = true;
        c.dnfReason = "DSQ (1 Dry Compound)";
        addCommentary(fs.totalLaps, `⬛ FIA POST-RACE DSQ: ${c.card.clean_name} disqualified — failed to run two distinct dry tyre specifications!`, "warn");
      }
      if (!c.dnf && !c.finishedRace) {
        c.finishedRace = true;
        c.finishLaps = Math.min(fs.totalLaps - 1, Math.max(0, Math.floor(c.totalProg || 0)));
        c.finishTimeS = fs.raceClock + (1 - ((c.totalProg || 0) % 1)) * fs.circuit.base_lap_s;
      }
    });
    renderHud();

    const sorted = ENG.sortRaceStandings(fs.cars, true);
    const podium = sorted.slice(0, 3);
    const podTxt = podium.map((x, i) => `P${i + 1} ${x.card.clean_name}`).join(" · ");
    addCommentary(fs.totalLaps, `🏁 CHEQUERED FLAG at ${fs.circuit.name}! ${podTxt}`, "win");
    playSfx("winLap");

    // Export full telemetry buffer for Race Data Analysis Studio & Post-Race Interviews (raceFinished = TRUE!)
    if (fs.telemetry) {
      fs.telemetry.setFinished(true);
      fs.telemetry.recordLapSnapshot(fs.totalLaps, sorted, { wetness: fs.wetness, scActive: false, vscActive: false });
      const finalMeta = sorted.map((c, i) => ({
        idx: c.idx, code3: c.card.code3, name: c.card.clean_name, team: c.card.hero_team, color: c.card.hero_color,
        finishPos: i + 1, dnf: c.dnf, dnfReason: c.dnfReason || "", stintHistory: c.stintHistory || [],
        confidence: c.confidence, peakConfidence: c.peakConfidence, minConfidence: c.minConfidence,
        momentum: c.momentum, overtakesMade: c.overtakesMade, mistakesCount: c.mistakesCount,
        totalPitDelayS: c.totalPitDelayS, bestLapS: c.bestLapS,
        components: c.components, compIssues: c.compIssues, compPaceLossS: c.compPaceLossS, compKphLoss: c.compKphLoss, eng: c.eng,
      }));
      window.F1_FULLSIM_LAST_TELEMETRY = fs.telemetry.exportPayload(finalMeta, { raceFinished: true });
    }

    // Award Era-Authentic Championship Points (or 2026 8-7-6-5-4-3-2-1 Sprint Points!)
    const isSprintFinish = fs.sprintPhase === "sprint";
    const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];
    const era = fs.eraRule || ENG.DEFAULT_ERA_RULES;
    const ptsTable = isSprintFinish ? SPRINT_POINTS : (Array.isArray(era.points) && era.points.length ? era.points : F1_POINTS);
    const flPt = isSprintFinish ? 0 : Number(era.fastest_lap_point || 0);
    const flTopN = Number(era.fastest_lap_top_n || 0);
    let seasonDone = false;
    if (fs.season.active) {
      if (!isSprintFinish) fs.season.racesRun += 1;
      sorted.forEach((c, i) => {
        const key = c.card.clean_name;
        if (!fs.season.wdc[key]) {
          fs.season.wdc[key] = { name: key, code3: c.card.code3, team: c.card.hero_team, color: c.card.hero_color, pts: 0, wins: 0 };
        }
        const tKey = c.card.hero_team || "Independent";
        if (!fs.season.wcc[tKey]) {
          fs.season.wcc[tKey] = { team: tKey, color: c.card.hero_color, pts: 0, wins: 0 };
        }
        if (!c.dnf) {
          let pts = i < ptsTable.length ? ptsTable[i] : 0;
          if (flPt > 0 && fs.fastestLap.driver === key && (flTopN === 0 || (i + 1) <= flTopN)) pts += flPt;
          fs.season.wdc[key].pts += pts;
          fs.season.wcc[tKey].pts += pts;
          if (i === 0 && !isSprintFinish) { fs.season.wdc[key].wins += 1; fs.season.wcc[tKey].wins += 1; }
        }
      });
      renderSeasonStandings();
      seasonDone = !isSprintFinish && (fs.season.roundIdx >= fs.season.rounds.length - 1);
    }

    const finEl = getEl("fsim-finish-banner");
    if (finEl) {
      finEl.classList.remove("hidden");
      const wdcLeader = fs.season.active
        ? Object.values(fs.season.wdc).sort((a, b) => b.pts - a.pts)[0]
        : null;
      const sprintPtsLine = isSprintFinish
        ? `<div style="margin-top:4px;color:#38bdf8;font-weight:700;">⚡ SPRINT POINTS: ${sorted.slice(0, 8).map((c, idx) => `${c.card.code3} +${SPRINT_POINTS[idx]}`).join(" · ")}</div>`
        : "";
      const seasonLine = isSprintFinish
        ? sprintPtsLine
        : (fs.season.active
          ? (seasonDone
              ? `<div style="margin-top:4px;color:#4ade80;font-weight:800;">🏆 WORLD CHAMPION: ${esc(wdcLeader ? wdcLeader.name : "")} (${wdcLeader ? wdcLeader.pts : 0} pts)!</div>`
              : `<div style="margin-top:4px;color:#38bdf8;">Round ${fs.season.roundIdx + 1}/${fs.season.rounds.length} Complete · WDC Leader: <b>${esc(wdcLeader ? wdcLeader.name : "")}</b> (${wdcLeader ? wdcLeader.pts : 0} pts)</div>`)
          : "");

      const nextBtn = isSprintFinish
        ? `<button type="button" id="fsim-start-feature-gp" class="btn-racing"><i class="fas fa-flag-checkered"></i> Start Feature Grand Prix →</button>`
        : ((fs.season.active && !seasonDone)
          ? `<button type="button" id="fsim-next-gp-btn" class="btn-racing"><i class="fas fa-forward"></i> Next GP: ${esc(fs.season.rounds[fs.season.roundIdx + 1].name)}</button>`
          : `<button type="button" id="fsim-rematch-btn" class="btn-racing"><i class="fas fa-redo"></i> ${seasonDone ? "New Championship" : "Watch Again"}</button>`);

      const avgStops = (fs.stats.pits / Math.max(1, fs.cars.length)).toFixed(1);
      finEl.innerHTML = `
        <div>
          <strong>${isSprintFinish ? "⚡ 2026 SPRINT FINISH" : "🏁 CHEQUERED FLAG"} — ${esc(fs.circuit.name.toUpperCase())}!</strong>
          <div style="font-size:0.82rem;color:#fde047;margin-top:3px;">🏆 ${esc(podTxt)}</div>
          <div style="font-size:0.75rem;color:#cbd5e1;margin-top:2px;">
            FL: <b>${esc(fs.fastestLap.driver || "—")}</b> (${fmtLapTime(fs.fastestLap.time)}) · ${fs.stats.overtakes} Overtakes · ${fs.stats.pits} Pit Stops (${avgStops}/car) · ${fs.stats.incidents} Incidents · ${fs.stats.leadChanges} Lead Changes
          </div>
          ${seasonLine}
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button type="button" id="fsim-fin-analytics" class="sim-dir-btn" style="border-color:#38bdf8;color:#7dd3fc;"><i class="fas fa-chart-area"></i> Telemetry &amp; Interviews</button>
          ${nextBtn}
          <button type="button" id="fsim-fin-setup" class="sim-dir-btn"><i class="fas fa-sliders-h"></i> Setup</button>
        </div>
      `;
      getEl("fsim-start-feature-gp")?.addEventListener("click", () => {
        clearTimeout(fs.autoAdvTimer);
        launchCurrentRound({ afterSprint: true, qualiGrid: fs.qualiOrderedCards });
      });
      getEl("fsim-fin-analytics")?.addEventListener("click", () => {
        clearTimeout(fs.autoAdvTimer);
        if (window.F1RaceAnalytics && window.F1_FULLSIM_LAST_TELEMETRY) {
          window.F1RaceAnalytics.open(window.F1_FULLSIM_LAST_TELEMETRY, { initialTab: "interviews" });
        }
      });
      getEl("fsim-next-gp-btn")?.addEventListener("click", () => {
        clearTimeout(fs.autoAdvTimer);
        fs.season.roundIdx += 1;
        launchCurrentRound();
      });
      getEl("fsim-rematch-btn")?.addEventListener("click", startNewBroadcast);
      getEl("fsim-fin-setup")?.addEventListener("click", () => toggleSetupDrawer(true));

      // Auto-advance to next round in Championship mode if checked!
      clearTimeout(fs.autoAdvTimer);
      if (fs.season.active && !seasonDone && getEl("fsim-autoadv-chk")?.checked) {
        fs.autoAdvTimer = setTimeout(() => {
          if (fs.finished && fs.season.active && fs.season.roundIdx < fs.season.rounds.length - 1) {
            fs.season.roundIdx += 1;
            launchCurrentRound();
          }
        }, 6000);
      }
    }
  }

  // =========================================================================
  // RACE & CHAMPIONSHIP LAUNCHER
  // =========================================================================
  async function startNewBroadcast() {
    clearTimeout(fs.autoAdvTimer);
    const mode = getEl("fsim-mode-sel")?.value || "single";
    if (mode.startsWith("season")) {
      const count = mode === "season8" ? 8 : (mode === "season12" ? 12 : CIRCUITS.length);
      fs.season = {
        active: true,
        rounds: CIRCUITS.slice(0, Math.min(count, CIRCUITS.length)),
        roundIdx: 0,
        wdc: {},
        wcc: {},
        racesRun: 0,
      };
    } else {
      fs.season = { active: false, rounds: [], roundIdx: 0, wdc: {}, wcc: {}, racesRun: 0 };
    }
    await launchCurrentRound();
  }

  async function launchCurrentRound(opts) {
    const launchOpts = opts || {};
    clearTimeout(fs.autoAdvTimer);
    if (typeof fs.qualiAbort === "function") { fs.qualiAbort(); fs.qualiAbort = null; }
    stopInstantReplay();
    fs.replayBuf = [];
    fs.replayClips = [];
    fs.stewardsBanner = null;
    fs.stewardsTimer = 0;
    fs.formationLap = null;
    const deckSpec = getEl("fsim-deck-sel")?.value || `season:${BOOT.latestYear}`;
    const maxCars = parseInt(getEl("fsim-grid-size")?.value || "20", 10) || 20;
    const gridOrder = getEl("fsim-grid-order")?.value || "quali";
    const weekendFmt = getEl("fsim-weekend-sel")?.value || "direct";
    fs.weekendFormat = weekendFmt;
    fs.sprintPhase = (weekendFmt === "sprint" && !launchOpts.afterSprint) ? "sprint" : (launchOpts.afterSprint ? "gp" : null);
    const cardsRaw = await loadDeck(deckSpec, maxCars);
    if (!cardsRaw.length) return;

    const selCirMeta = fs.season.active
      ? fs.season.rounds[fs.season.roundIdx]
      : (CIRCUITS.find((c) => c.id === getEl("fsim-circuit-sel")?.value) || CIRCUITS[0]);
    const selCir = await ENG.fetchCircuit(selCirMeta.id);
    fs.circuit = selCir;
    fs.eraRule = resolveEraRule(deckSpec);
    fs.simToEndActive = false;
    window.F1_FULLSIM_LAST_TELEMETRY = null;
    getEl("fsim-simtoend-ovl")?.classList.add("hidden");
    toggleSetupDrawer(false);

    // Phase C: Run Live Q1 / Q2 / Q3 Knockout Qualifying Shootout when weekendFmt is 'quali' or 'sprint'!
    let preSortedQualiCards = Array.isArray(launchOpts.qualiGrid) && launchOpts.qualiGrid.length ? launchOpts.qualiGrid.slice() : null;
    if (!preSortedQualiCards && (weekendFmt === "quali" || (weekendFmt === "sprint" && !launchOpts.afterSprint))) {
      fs.running = false;
      fs.paused = true;
      preSortedQualiCards = await runLiveQualifyingShootout(cardsRaw, selCir, weekendFmt === "sprint");
      fs.qualiOrderedCards = preSortedQualiCards.slice();
    }

    // Fetch historical Per-Track × Per-Era × Per-Team × Per-Driver balancing & psychology profiles
    const balKey = `${selCir.id}|${fs.eraRule.key}`;
    let balData = fs.balanceCache[balKey];
    if (!balData) {
      try {
        const r = await fetch(`/api/sim/balance?circuit_id=${encodeURIComponent(selCir.id)}&era_key=${encodeURIComponent(fs.eraRule.key)}`);
        if (r.ok) {
          balData = await r.json();
          fs.balanceCache[balKey] = balData;
        }
      } catch (_) {}
    }
    const drvAff = (balData && balData.driver_affinity) || {};
    const teamAff = (balData && balData.team_affinity) || {};
    const drvPsych = (balData && balData.driver_psychology) || {};
    const drvDnaMap = (balData && balData.driver_dna) || {};
    fs.circuitF1db = (balData && balData.circuit_f1db) || null;
    if (!fs.fiaPrecedents) {
      try {
        const pr = await fetch("/api/fia-docs/precedents");
        if (pr.ok) fs.fiaPrecedents = await pr.json();
      } catch (_) {}
    }

    const dist = getEl("fsim-laps-sel")?.value || "15";
    fs.totalLaps = fs.sprintPhase === "sprint" ? 5 : (dist === "full" ? (selCir.laps || 55) : (parseInt(dist, 10) || 15));
    fs.weatherMode = getEl("fsim-weather-sel")?.value || "dynamic";
    fs.chaosMult = parseFloat(getEl("fsim-chaos-sel")?.value || "1.0") || 1.0;
    fs.wetness = fs.weatherMode === "rain" ? 78 : (fs.weatherMode === "showers" ? 28 : 0);
    fs.targetWetness = fs.wetness;
    fs.drying = false;
    fs.nextWeatherLap = Math.max(3, Math.round(fs.totalLaps * (0.18 + Math.random() * 0.22)));
    fs.gripPct = 38;
    fs.drsEnabled = false;
    fs.drsAnnounced = false;
    fs.vscLaps = 0;
    fs.safetyCarLaps = 0;
    fs.scUnlapped = false;
    fs.redFlag = null;
    fs.redFlagUsed = false;
    fs.debrisZones = [];
    fs.yellowSector = 0;
    fs.yellowTimer = 0;
    fs.bestSectors = [999, 999, 999];
    fs.fastestLap = { time: 999, driver: "", code3: "" };
    fs.raceClock = 0;
    fs.lastCamCutClock = -99;
    fs.stats = { overtakes: 0, pits: 0, incidents: 0, dnfs: 0, scs: 0, leadChanges: 0 };
    fs.overtakeCooldown = {};
    fs.prevOnTrackOrder = [];
    fs.prevLeaderIdx = -1;
    fs.radioCount = 0;
    fs.miniFeed = [];
    fs.finished = false;
    fs.chequeredFlag = false;
    fs.chequeredStartS = 0;
    fs.allUnlappedDoneAt = null;
    fs.chequeredFinishedCount = 0;
    fs.chequeredRunningCount = 0;
    fs.paused = false;
    fs.running = true;
    fs.staticKey = "";
    if (window.F1TrackRenderer) fs.fx = window.F1TrackRenderer.createFxState();

    // Order starting grid (Live Q1/Q2/Q3 Shootout, Simulated Qualifying, Reverse Grid, or Random Shuffle)
    let cards = preSortedQualiCards ? preSortedQualiCards.slice() : cardsRaw.slice();
    if (!preSortedQualiCards) {
      if (gridOrder === "quali") {
        cards.sort((a, b) => ((b.game.stats.pace * 0.65 + b.overall * 0.35) + (Math.random() - 0.5) * 9)
                           - ((a.game.stats.pace * 0.65 + a.overall * 0.35) + (Math.random() - 0.5) * 9));
      } else if (gridOrder === "reverse") {
        cards.reverse();
      } else {
        for (let i = cards.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [cards[i], cards[j]] = [cards[j], cards[i]];
        }
      }
    }

    const startComp = fs.wetness >= 60 ? "wet" : (fs.wetness >= 22 ? "inter" : "medium");
    const teamSeatMap = {};
    fs.cars = cards.map((card, i) => {
      // Realistic strategy split across the grid (Soft / Medium / Hard)
      let comp = startComp;
      if (startComp === "medium") {
        comp = i < 5 ? "soft" : (i % 5 === 4 ? "hard" : "medium");
      }
      const isWetStart = COMPOUNDS[comp].wet > 0;
      const dKey = String(card.clean_name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const tKey = String(card.hero_team || "").toLowerCase();
      const seatNum = teamSeatMap[tKey] || 0;
      teamSeatMap[tKey] = seatNum + 1;
      const engObj = window.F1RadioEngine ? window.F1RadioEngine.assignEngineer(card.hero_team, seatNum) : null;
      const combinedAff = Number(drvAff[dKey] || 0) + Number(teamAff[tKey] || 0) * 0.65;
      const dnaObj = drvDnaMap[dKey] || null;
      const car = {
        idx: i,
        card,
        engineer: engObj,
        dna: dnaObj,
        eraKey: (fs.eraRule && fs.eraRule.key) || "2026",
        pos: i + 1,
        gridPos: i + 1,
        lap: 0,
        totalProg: -0.0055 * i,
        latOffset: (i % 2 === 0 ? -2.4 : 2.4),
        compound: comp,
        nextCompound: comp,
        dryCompoundsUsed: new Set(isWetStart ? [] : [comp]),
        stintHistory: [{ compound: comp, startLap: 1, endLap: fs.totalLaps }],
        usedWet: isWetStart,
        tyreLife: 100,
        tyreTemp: COMPOUNDS[comp].optTemp - 3,
        fuelKg: fs.eraRule.refuelling ? (fs.eraRule.start_fuel_kg || 58) * (0.75 + Math.random() * 0.25) : (fs.eraRule.start_fuel_kg || 100),
        ers: fs.eraRule.ers_enabled ? 68 : 0,
        stops: 0,
        inPit: 0,
        pitDuration: 0,
        timePenaltyS: 0,
        wingDamaged: false,
        dnf: false,
        inDrsRange: false,
        intervalS: 0,
        liveKph: 190,
        liveGear: 4,
        lastLapTime: selCir.base_lap_s,
        bestLapS: 999,
        sectorTimes: [0, 0, 0],
        bestSectors: [999, 999, 999],
        sectorColors: ["none", "none", "none"],
        paceMode: "balanced",
        ersMode: "auto",
        aiPlan: i % 3 === 0 ? "aggressive" : "balanced",
        aiStatus: "RACE START",
        currentLapS: selCir.base_lap_s,
      };
      ENG.initDriverPsychology(car, drvPsych[dKey], combinedAff, null);
      if (ENG.initCarEngineering) {
        ENG.initCarEngineering(car, selCir, {
          experience: card.experience,
          seasons: card.experience_seasons || 4,
          overall: card.overall,
          eraKey: (fs.eraRule && fs.eraRule.key) || "2026",
        });
      }
      car.currentLapS = computeCarLapTime(car, selCir, fs.wetness);
      return car;
    });

    // Initialize Scrubbable Telemetry Buffer Recorder
    fs.telemetry = ENG.createTelemetryRecorder(
      selCir,
      fs.cars.map((c) => ({
        idx: c.idx, code3: c.card.code3, name: c.card.clean_name, team: c.card.hero_team,
        color: c.card.hero_color, persona: c.persona, trackAffinity: c.trackAffinity, engineer: c.engineer, dna: c.dna,
      })),
      fs.totalLaps,
      fs.eraRule
    );
    fs.telemetry.recordLapSnapshot(0, fs.cars, { wetness: fs.wetness, scActive: false, vscActive: false });

    fs.focusIdx = 0;
    const ul = getEl("fsim-radio-log");
    if (ul) ul.innerHTML = "";
    getEl("fsim-finish-banner")?.classList.add("hidden");
    toggleSetupDrawer(false);

    // Update circuit header & championship round pill
    getEl("fsim-dir-name").textContent = selCir.name;
    getEl("fsim-dir-specs").textContent = `${selCir.length_km}km · ${selCir.turns}T · ${selCir.drs_zones} DRS · ${fs.cars.length} CPU Cars`;
    const rPill = getEl("fsim-round-pill");
    if (rPill) {
      const showPill = fs.season.active || fs.sprintPhase === "sprint";
      rPill.classList.toggle("hidden", !showPill);
      if (fs.sprintPhase === "sprint") rPill.textContent = "⚡ SPRINT · 5L";
      else if (fs.season.active) rPill.textContent = `R${fs.season.roundIdx + 1}/${fs.season.rounds.length}`;
    }

    // Initialize Optional Formation Lap OR Direct FIA 5-Red-Lights Standing Start!
    if (weekendFmt === "formation") {
      fs.formationLap = { active: true, elapsed: 0, duration: 9.5 };
      fs.cars.forEach((c, idx) => {
        c.totalProg = 0.02 - idx * 0.0045;
        c.tyreTemp = 68;
        c.liveKph = 140;
        c.aiStatus = "WARMING TYRES";
      });
      fs.startSeq = null;
    } else {
      fs.formationLap = null;
      fs.startSeq = window.F1TrackArchitect
        ? window.F1TrackArchitect.createStandingStartState(fs.cars, selCir)
        : null;
    }

    if (fs.cam && fs.geom && window.F1TrackRenderer && fs.cars[0]) {
      const p0 = window.F1TrackRenderer.sampleTrack(fs.geom, fs.cars[0].totalProg);
      fs.cam.x = p0.x;
      fs.cam.y = p0.y;
    }

    renderHud();
    renderSeasonStandings();
    const pole = fs.cars[0];
    if (fs.formationLap && fs.formationLap.active) {
      addCommentary(1, `🟡 FORMATION LAP underway at ${selCir.name} — cars weaving to bring tyres & brakes into window! Pole: ${pole.card.clean_name}.`, "info");
      showToast(`🟡 FORMATION LAP — WARMING TYRES`, "info");
      updateChyron(`🟡 FORMATION LAP · WARMING TYRES · POLE: ${pole.card.code3}`);
    } else if (fs.startSeq) {
      const sessTag = fs.sprintPhase === "sprint" ? "2026 SPRINT" : "FIA STANDING START";
      addCommentary(1, `🔴 Formation complete at ${selCir.name} (${selCir.gp}) — ${fs.cars.length} cars locked on the staggered grid! Pole: ${pole.card.clean_name}.`, "info");
      showToast(`🔴 ${sessTag} — ${selCir.name.toUpperCase()}`, "info");
      updateChyron(`🔴 ${sessTag} · POLE: ${pole.card.code3}`);
    } else {
      playSfx("lightsOut");
      const startMsg = `🟢 LIGHTS OUT at ${selCir.name} (${selCir.gp})! ${pole.card.clean_name} leads ${fs.cars.length} CPU cars away from Pole!`;
      addCommentary(1, startMsg, "win");
      showToast(`📺 LIVE — ${selCir.name.toUpperCase()}`, "win");
      updateChyron(`🟢 LIGHTS OUT · POLE: ${pole.card.code3}`);
    }
  }

  // =========================================================================
  // CONTROLS, HOTKEYS & BOOT
  // =========================================================================
  function setSpeed(mult) {
    if (mult === 0) {
      fs.paused = true;
    } else {
      fs.paused = false;
      fs.speedMult = mult;
    }
    document.querySelectorAll("[data-fsim-speed]").forEach((b) => {
      const v = Number(b.dataset.fsimSpeed);
      b.classList.toggle("active", fs.paused ? v === 0 : v === fs.speedMult);
    });
  }

  function setCamMode(mode, fromAuto) {
    const R = window.F1TrackRenderer;
    if (!R) return;
    if (!fs.cam) fs.cam = R.createCamera();
    if (!fromAuto) fs.userZoomLocked = true;
    R.setCameraMode(fs.cam, mode);
    document.querySelectorAll("[data-fsim-cam]").forEach((b) => b.classList.toggle("active", b.dataset.fsimCam === fs.cam.mode));
    drawCanvas();
  }

  function setAutoTv(on) {
    fs.autoTv = !!on;
    if (fs.autoTv) {
      fs.userZoomLocked = false;
      fs.lastCamCutClock = -99;
    }
    const btn = getEl("fsim-autotv-btn");
    if (btn) btn.classList.toggle("is-on", fs.autoTv);
  }

  function toggleSetupDrawer(force) {
    const dr = getEl("fsim-setup-drawer"), btn = getEl("fsim-setup-toggle");
    if (!dr || !btn) return;
    const open = typeof force === "boolean" ? force : dr.classList.contains("hidden");
    dr.classList.toggle("hidden", !open);
    btn.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function toggleRadioDrawer(force) {
    const dr = getEl("fsim-radio-drawer");
    if (!dr) return;
    const open = typeof force === "boolean" ? force : dr.classList.contains("hidden");
    dr.classList.toggle("hidden", !open);
  }

  function loop(ts) {
    fs.rafId = requestAnimationFrame(loop);
    if (!fs.lastTs) fs.lastTs = ts;
    const dt = Math.min(0.06, Math.max(0.001, (ts - fs.lastTs) / 1000));
    fs.lastTs = ts;
    fs.lastDt = dt;
    if (fs.replay && fs.replay.active) {
      fs.replay.playPos += dt * 20 * (fs.replay.speed || 0.45);
      if (fs.replay.playPos >= fs.replay.frames.length - 1) {
        stopInstantReplay();
      }
    } else if (fs.running && !fs.paused) {
      stepSimulation(dt);
    }
    if (fs.b3d && fs.b3d.isActive()) {
      const sorted3d = ENG.sortRaceStandings(fs.cars, fs.finished);
      fs.b3d.updateAndRender({
        circuit: fs.circuit,
        cars: fs.cars.map((c) => ({
          idx: c.idx, code3: c.card.code3, team: c.card.hero_team, pos: c.pos, totalProg: c.totalProg, latOffset: c.latOffset,
          inPit: c.inPit, pitDuration: c.pitDuration, pitBoxIdx: c.pitBoxIdx, pitPenaltyHoldFrac: c.pitPenaltyHoldFrac || 0, dnf: c.dnf, color: c.card.hero_color,
          wingDamaged: !!c.wingDamaged, parkedProg: c.parkedProg, parkedSide: c.parkedSide, parkedYawOff: c.parkedYawOff,
          breakdownKind: c.breakdownKind, smokeActive: c.smokeActive, cleared: !!c.cleared,
          liveKph: c.livePhysKph != null ? c.livePhysKph : c.liveKph, liveGear: c.liveGear, liveLongG: c.liveLongG || 0,
          lockupSmokeTimer: c.lockupSmokeTimer || 0,
          compound: c.compound, drsOpen: !!(c.inDrsRange && fs.drsEnabled && !c.dnf && !c.finishedRace),
          finishedRace: !!c.finishedRace,
          fuelKg: c.fuelKg,
          setupRideHeight: c.eng && c.eng.actual ? c.eng.actual.rideHeight : null,
          setupAeroBalance: c.eng && c.eng.actual ? c.eng.actual.aeroBalance : null,
          balanceBias: c.eng ? c.eng.balanceBias : 0,
          floorHealth: c.components && c.components.floor ? c.components.floor.health : 95,
          suspHealth: c.components && c.components.suspension ? c.components.suspension.health : 95,
          palette: c.card.hero_palette, liveryStyle: c.card.hero_livery_style, era: c.card.hero_era,
        })),
        raceState: {
          eraKey: (fs.eraRule && fs.eraRule.key) || "2026",
          lap: Math.min(fs.totalLaps, Math.max(1, (sorted3d[0]?.lap || 0) + 1)),
          totalLaps: fs.totalLaps,
          wetness: fs.wetness,
          trackGrip: Math.min(1, 0.35 + ((sorted3d[0]?.lap || 0) / Math.max(8, fs.totalLaps)) * 0.65),
          scActive: fs.safetyCarLaps > 0,
          scInThisLap: fs.safetyCarLaps === 1,
          vscActive: fs.vscLaps > 0,
          redFlag: !!(fs.redFlag && fs.redFlag.active),
          debrisZones: fs.debrisZones,
          yellowSector: fs.yellowSector,
          yellowLevel: fs.yellowLevel || 1,
          blueFlagSectors: fs.cars.filter((c) => !c.dnf && c.blueFlagActive).map((c) => c.blueFlagSector || 1),
          whiteFlagSectors: fs.cars.filter((c) => !c.dnf && (c.wingDamaged || c.meatballFlag)).map((c) => Math.floor((((c.totalProg % 1) + 1) % 1) * 3) + 1),
          chequered: fs.chequeredFlag || fs.finished,
          startSeq: fs.startSeq,
          top3: sorted3d.slice(0, 3).map((x) => ({ code3: x.card.code3, color: x.card.hero_color || "#e10600" })),
        },
        focusIdx: fs.focusIdx,
        dt,
        paused: fs.paused,
      });
    } else {
      drawCanvas();
    }
    if (window.F1Sfx && window.F1Sfx.updateTelemetry) {
      const fCar = fs.cars[fs.focusIdx] || fs.cars[0];
      window.F1Sfx.updateTelemetry({
        active: fs.running && !fs.finished,
        paused: fs.paused,
        speedMult: fs.speedMult,
        speedKph: fCar ? (fCar.livePhysKph || fCar.liveKph || 215) : 210,
        wetness: fs.wetness,
        eraKey: (fs.eraRule && fs.eraRule.key) || "2026",
        camMode: (fs.b3d && fs.b3d.isActive()) ? fs.b3dMode : "2d",
        inPit: fCar ? fCar.inPit > 0 : false,
        chequered: fs.chequeredFlag,
        battleClose: !!(fCar && fCar.intervalS > 0 && fCar.intervalS < 0.8),
      });
    }
  }

  function init() {
    document.body.classList.add("sim-cockpit-active");

    const cirSel = getEl("fsim-circuit-sel");
    if (cirSel && CIRCUITS.length) {
      const modern = CIRCUITS.filter((c) => c.category !== "classic");
      const classic = CIRCUITS.filter((c) => c.category === "classic");
      const optHtml = (c) => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.country)} · ${c.length_km}km${c.era_years ? " · " + esc(c.era_years) : ""}${c.is_night ? " 🌙" : ""})</option>`;
      cirSel.innerHTML = classic.length
        ? `<optgroup label="2026 FIA Calendar (${modern.length})">${modern.map(optHtml).join("")}</optgroup><optgroup label="Classic &amp; Historic F1 Circuits (${classic.length})">${classic.map(optHtml).join("")}</optgroup>`
        : CIRCUITS.map(optHtml).join("");
    }

    getEl("fsim-start-btn")?.addEventListener("click", startNewBroadcast);
    getEl("fsim-rc-sc-btn")?.addEventListener("click", () => {
      if (!fs.running || fs.finished) return;
      toggleSetupDrawer(false);
      deploySafetyCar("Race Control Manual SC Deployment", 2, false);
      renderHud();
    });
    getEl("fsim-rc-rf-btn")?.addEventListener("click", () => {
      if (!fs.running || fs.finished) return;
      toggleSetupDrawer(false);
      triggerRedFlag("Race Control Manual Red Flag", false);
      renderHud();
    });
    getEl("fsim-rc-brk-btn")?.addEventListener("click", () => {
      if (!fs.running || fs.finished) return;
      toggleSetupDrawer(false);
      const cand = fs.cars.find((c) => !c.dnf && !c.finishedRace && c.pos >= 4) || fs.cars.find((c) => !c.dnf && !c.finishedRace);
      if (!cand) return;
      parkBreakdownCar(cand, "Engine Failure", "engine");
      fs.stats.dnfs += 1;
      fs.stats.incidents += 1;
      const curLap = Math.max(1, (cand.lap || 0) + 1);
      const secNum = Math.floor((((cand.totalProg % 1) + 1) % 1) * 3) + 1;
      fs.yellowSector = secNum; fs.yellowLevel = 2; fs.yellowTimer = 8.0;
      spawnDebrisZone(cand.totalProg, cand.latOffset, curLap);
      const victim = fs.cars.find((c) => !c.dnf && c.idx !== cand.idx);
      if (victim) victim.wingDamaged = true;
      addCommentary(curLap, `💨 BREAKDOWN! ${cand.card.clean_name} pulls off smoking in Sector ${secNum} with carbon debris on track!`, "warn");
      showStewardsBanner("⚠ YELLOW FLAG · TRACKSIDE BREAKDOWN", `${cand.card.clean_name} parked smoking off-track — Marshals clearing debris`, "info");
      playSfx("radioAlert");
      renderHud();
    });
    getEl("fsim-custom-season-btn")?.addEventListener("click", () => {
      if (!window.F1CustomSeason) return;
      window.F1CustomSeason.open({
        onLaunch: async (cfg) => {
          clearTimeout(fs.autoAdvTimer);
          const rounds = (cfg.calendar || []).map((cid) => CIRCUITS.find((c) => c.id === cid)).filter(Boolean);
          fs.season = {
            active: rounds.length > 0,
            rounds: rounds.length ? rounds : CIRCUITS.slice(0, 10),
            roundIdx: 0,
            wdc: {},
            wcc: {},
            racesRun: 0,
            customConfig: cfg,
          };
          if (cfg.era_rules) fs.eraRule = cfg.era_rules;
          if (cfg.race_laps && getEl("fsim-laps-sel")) getEl("fsim-laps-sel").value = cfg.race_laps;
          if (cfg.era_key && getEl("fsim-era-sel")) getEl("fsim-era-sel").value = cfg.era_key;
          toggleSetupDrawer(false);
          await launchCurrentRound();
          if (cfg.era_rules) fs.eraRule = cfg.era_rules;
          showToast(`🏆 Launched Custom Season: ${cfg.name} (${fs.season.rounds.length} Rounds)!`, "win");
        },
      });
    });
    getEl("fsim-restart-btn")?.addEventListener("click", launchCurrentRound);
    getEl("fsim-setup-toggle")?.addEventListener("click", () => toggleSetupDrawer());
    getEl("fsim-setup-close")?.addEventListener("click", () => toggleSetupDrawer(false));
    getEl("fsim-radio-toggle")?.addEventListener("click", () => toggleRadioDrawer());
    getEl("fsim-radio-close")?.addEventListener("click", () => toggleRadioDrawer(false));
    getEl("fsim-autotv-btn")?.addEventListener("click", () => setAutoTv(!fs.autoTv));
    getEl("fsim-replay-btn")?.addEventListener("click", () => {
      if (fs.replay.active) stopInstantReplay();
      else startInstantReplay({ focusIdx: fs.focusIdx, title: `F1 TV INSTANT REPLAY · ${fs.cars[fs.focusIdx]?.card.clean_name || "LIVE ACTION"}` });
    });
    getEl("fsim-analytics-btn")?.addEventListener("click", () => {
      if (!window.F1RaceAnalytics) {
        showToast("Telemetry Studio module is still loading — please reload.", "warn");
        return;
      }
      if (!fs.cars.length) {
        showToast("Wait a second for the grid to load before opening Telemetry!", "info");
        return;
      }
      let payload = window.F1_FULLSIM_LAST_TELEMETRY;
      if (!payload) {
        const sortedNow = fs.cars.slice().sort((a, b) => (a.dnf !== b.dnf ? (a.dnf ? 1 : -1) : b.totalProg - a.totalProg));
        const meta = sortedNow.map((c, i) => ({
          idx: c.idx, code3: c.card.code3, name: c.card.clean_name, team: c.card.hero_team, color: c.card.hero_color,
          finishPos: i + 1, dnf: c.dnf, dnfReason: c.dnfReason || "", stintHistory: c.stintHistory || [],
          confidence: c.confidence, peakConfidence: c.peakConfidence, minConfidence: c.minConfidence,
          momentum: c.momentum, overtakesMade: c.overtakesMade, mistakesCount: c.mistakesCount,
          totalPitDelayS: c.totalPitDelayS, bestLapS: c.bestLapS,
          components: c.components, compIssues: c.compIssues, compPaceLossS: c.compPaceLossS, compKphLoss: c.compKphLoss, eng: c.eng,
        }));
        if (fs.telemetry) {
          payload = fs.telemetry.exportPayload(meta, { raceFinished: fs.finished });
          // Append live in-progress snapshot so opening Telemetry on Lap 1 shows live data immediately!
          const curLap = Math.max(1, Math.max(...sortedNow.map((c) => c.lap), 0) + 1);
          const lastFr = payload.frames[payload.frames.length - 1];
          if (!lastFr || lastFr.lap < curLap) {
            const ldr = sortedNow[0];
            const baseLapS = (fs.circuit && fs.circuit.base_lap_s) || 85;
            payload.frames = payload.frames.concat([{
              lap: curLap,
              wetness: Math.round(fs.wetness || 0),
              sc: fs.safetyCarLaps > 0,
              vsc: fs.vscLaps > 0,
              cars: sortedNow.map((c, r) => ({
                idx: c.idx, pos: r + 1,
                gap: r === 0 ? 0 : +Math.max(0, (ldr.totalProg - c.totalProg) * baseLapS).toFixed(2),
                lapTime: Number.isFinite(c.lastLapTime) && c.lastLapTime < 400 ? +c.lastLapTime.toFixed(2) : null,
                comp: c.compound, tyreLife: Math.round(c.tyreLife ?? 100), ers: Math.round(c.ers ?? 50),
                conf: Math.round(c.confidence ?? 60), mom: Math.round(c.momentum ?? 0), stops: c.stops || 0, dnf: !!c.dnf,
              })),
            }]);
          }
        }
      }
      if (payload && payload.frames && payload.frames.length) {
        window.F1RaceAnalytics.open(payload, { focusDrvIdx: fs.focusIdx });
      } else {
        showToast("No telemetry recorded yet — let the race run a moment!", "info");
      }
    });
    getEl("fsim-voice-btn")?.addEventListener("click", () => {
      fs.voiceOn = !fs.voiceOn;
      const vb = getEl("fsim-voice-btn");
      if (vb) vb.classList.toggle("is-on", fs.voiceOn);
      if (!fs.voiceOn) {
        if (window.F1Sfx && window.F1Sfx.stopVoice) window.F1Sfx.stopVoice();
        if (window.speechSynthesis) window.speechSynthesis.cancel();
      }
      showToast(fs.voiceOn ? "🎙 Live Voice Commentary ON" : "🎙 Voice Commentary OFF", "info");
    });

    getEl("fsim-sfx-btn")?.addEventListener("click", () => {
      fs.sfxOn = !fs.sfxOn;
      const b = getEl("fsim-sfx-btn");
      if (b) b.innerHTML = `<i class="fas fa-volume-${fs.sfxOn ? "up" : "mute"}"></i>`;
    });

    getEl("fsim-focus-btn")?.addEventListener("click", () => {
      const on = document.body.classList.toggle("sim-focus-mode");
      const btn = getEl("fsim-focus-btn");
      if (btn) { btn.classList.toggle("is-open", on); btn.innerHTML = `<i class="fas fa-${on ? "compress" : "expand"}"></i>`; }
      fs.staticKey = "";
      requestAnimationFrame(() => drawCanvas());
    });

    document.querySelectorAll("[data-fsim-speed]").forEach((btn) => {
      btn.addEventListener("click", () => setSpeed(Number(btn.dataset.fsimSpeed)));
    });
    getEl("fsim-sim-end-btn")?.addEventListener("click", runSimToEnd);

    // Phase 3: Live 3D Broadcast Camera Engine & Team Radio Controller
    if (window.F1Broadcast3D && getEl("fsim-3d-canvas")) {
      fs.b3d = window.F1Broadcast3D.createBroadcast3D(getEl("fsim-3d-canvas"), getEl("fsim-3d-hud"));
    }
    if (window.F1RadioEngine && getEl("fsim-radio-card")) {
      fs.radio = window.F1RadioEngine.createRadioController(getEl("fsim-radio-card"), {
        sfxEnabled: () => fs.sfxOn,
        voiceEnabled: () => fs.voiceOn,
        onEmit: (entry) => { if (fs.telemetry && fs.telemetry.addRadio) fs.telemetry.addRadio(entry); },
      });
    }
    function setBroadcast3DMode(mode) {
      fs.b3dMode = mode || "off";
      document.querySelectorAll("[data-fsim-3d]").forEach((b) => b.classList.toggle("active", b.getAttribute("data-fsim-3d") === fs.b3dMode));
      if (!fs.b3d && window.F1Broadcast3D && getEl("fsim-3d-canvas")) {
        fs.b3d = window.F1Broadcast3D.createBroadcast3D(getEl("fsim-3d-canvas"), getEl("fsim-3d-hud"));
      }
      if (!fs.b3d) {
        showToast("3D Broadcast requires WebGL / Three.js!", "warn");
        return;
      }
      if (fs.b3dMode === "off") {
        fs.b3d.setActive(false);
        drawCanvas();
      } else {
        fs.b3d.setMode(fs.b3dMode);
        const ok = fs.b3d.setActive(true);
        if (!ok) {
          fs.b3dMode = "off";
          document.querySelectorAll("[data-fsim-3d]").forEach((b) => b.classList.toggle("active", b.getAttribute("data-fsim-3d") === "off"));
          showToast("WebGL 3D context unavailable in this browser window.", "warn");
          return;
        }
        // Render 1 frame immediately even if paused!
        fs.b3d.updateAndRender({
          circuit: fs.circuit,
          cars: fs.cars.map((c) => ({
            idx: c.idx, code3: c.card.code3, pos: c.pos, totalProg: c.totalProg, latOffset: c.latOffset,
            inPit: c.inPit, pitDuration: c.pitDuration, pitBoxIdx: c.pitBoxIdx, dnf: c.dnf, color: c.card.hero_color,
            liveKph: c.livePhysKph != null ? c.livePhysKph : c.liveKph, liveGear: c.liveGear,
            palette: c.card.hero_palette, liveryStyle: c.card.hero_livery_style, era: c.card.hero_era,
          })),
          raceState: {
            eraKey: (fs.eraRule && fs.eraRule.key) || "2026",
            wetness: fs.wetness,
            startSeq: fs.startSeq,
          },
          focusIdx: fs.focusIdx,
          dt: 0.016,
          paused: fs.paused,
        });
      }
    }
    document.querySelectorAll("[data-fsim-3d]").forEach((btn) => {
      btn.addEventListener("click", () => setBroadcast3DMode(btn.getAttribute("data-fsim-3d")));
    });
    getEl("fsim-tower-wide")?.addEventListener("click", () => {
      fs.towerWide = !fs.towerWide;
      getEl("fsim-cockpit-grid")?.classList.toggle("is-tower-wide", fs.towerWide);
      getEl("fsim-tower-wide")?.classList.toggle("is-wide", fs.towerWide);
      fs.staticKey = "";
      requestAnimationFrame(() => drawCanvas());
    });
    document.querySelectorAll("[data-fsim-cam]").forEach((btn) => {
      btn.addEventListener("click", () => setCamMode(btn.dataset.fsimCam, false));
    });
    document.querySelectorAll("[data-fsim-gap]").forEach((btn) => {
      btn.addEventListener("click", () => {
        fs.gapMode = btn.dataset.fsimGap;
        document.querySelectorAll("[data-fsim-gap]").forEach((b) => b.classList.toggle("active", b === btn));
        renderHud();
      });
    });
    document.querySelectorAll("[data-fsim-layer]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.fsimLayer;
        fs.layers[key] = !fs.layers[key];
        btn.classList.toggle("active", fs.layers[key]);
        fs.staticKey = "";
        drawCanvas();
      });
    });
    document.querySelectorAll("[data-fsim-itab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.fsimItab;
        document.querySelectorAll("[data-fsim-itab]").forEach((b) => b.classList.toggle("active", b === btn));
        ["stats", "wdc", "wcc"].forEach((p) => getEl(`fsim-pane-${p}`)?.classList.toggle("active", p === t));
      });
    });

    const gridEl = getEl("fsim-cockpit-grid");
    gridEl?.querySelectorAll(".sim-dock-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        gridEl.dataset.dockPane = btn.dataset.dockTarget || "strategy";
        gridEl.querySelectorAll(".sim-dock-tab").forEach((b) => b.classList.toggle("active", b === btn));
        fs.staticKey = "";
        requestAnimationFrame(() => drawCanvas());
      });
    });

    function selectFocusCar(idx, labelPrefix, camModeOverride) {
      if (!Number.isInteger(idx) || !fs.cars[idx]) return;
      fs.focusIdx = idx;
      setAutoTv(false);
      if (camModeOverride) setCamMode(camModeOverride, true);
      updateChyron(`${labelPrefix || "🎯 LOCKED ON"} · ${fs.cars[idx].card.clean_name.toUpperCase()}`);
      renderHud();
      drawCanvas();
    }

    // Use pointerdown (fires BEFORE any 160ms innerHTML re-render can destroy the row!)
    getEl("fsim-timing-body")?.addEventListener("pointerdown", (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      const tr = ev.target.closest("tr[data-fsim-idx]");
      if (!tr) return;
      ev.preventDefault();
      selectFocusCar(Number(tr.dataset.fsimIdx), "🎯 LOCKED ON");
    });

    // Click any Battle card in Hottest Battles -> Cut camera straight to that fight!
    getEl("fsim-battles-list")?.addEventListener("pointerdown", (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      const btn = ev.target.closest("[data-watch-idx]");
      if (!btn) return;
      ev.preventDefault();
      selectFocusCar(Number(btn.dataset.watchIdx), "⚔️ LIVE DUEL", "heli");
    });

    // Quick Leader / Closest Battle buttons + Ahead/Behind jump buttons
    getEl("fsim-cam-leader")?.addEventListener("click", () => {
      const ldr = fs.cars.find((c) => !c.dnf && c.pos === 1);
      if (ldr) selectFocusCar(ldr.idx, "👑 LEADER CAM");
    });
    getEl("fsim-cam-battle")?.addEventListener("click", () => {
      const sorted = fs.cars.slice().sort((a, b) => (a.dnf !== b.dnf ? (a.dnf ? 1 : -1) : b.totalProg - a.totalProg));
      const battles = getActiveBattles(sorted);
      if (battles.length) {
        selectFocusCar(battles[0].chaser.idx, `⚔️ BATTLE · ${battles[0].ahead.card.code3} vs ${battles[0].chaser.card.code3}`, "heli");
      }
    });
    ["fsim-f-ahead", "fsim-f-behind"].forEach((id) => {
      getEl(id)?.addEventListener("pointerdown", (ev) => {
        if (ev.button != null && ev.button !== 0) return;
        const j = ev.currentTarget.dataset.jumpIdx;
        if (j !== "" && j != null) {
          ev.preventDefault();
          selectFocusCar(Number(j), "🎯 LOCKED ON");
        }
      });
    });

    // Click car directly on track + mouse wheel zoom (pointerdown so moving cars never slip away!)
    const cv = getEl("fsim-track-canvas");
    cv?.addEventListener("pointerdown", (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      let hit = null, bestD = 30;
      fs.carScreenPos.forEach((p) => { const d = Math.hypot(p.x - mx, p.y - my); if (d < bestD) { bestD = d; hit = p.idx; } });
      if (hit != null) selectFocusCar(hit, "🎯 LOCKED ON");
    });
    cv?.addEventListener("wheel", (ev) => {
      const R = window.F1TrackRenderer;
      if (!R) return;
      ev.preventDefault();
      if (!fs.cam) fs.cam = R.createCamera();
      fs.userZoomLocked = true;
      R.zoomCameraBy(fs.cam, ev.deltaY < 0 ? 0.35 : -0.35);
      document.querySelectorAll("[data-fsim-cam]").forEach((b) => b.classList.toggle("active", b.dataset.fsimCam === fs.cam.mode));
      drawCanvas();
    }, { passive: false });

    if (window.ResizeObserver && cv) {
      new ResizeObserver(() => drawCanvas()).observe(cv);
    }

    // Broadcast Director Hotkeys
    document.addEventListener("keydown", (ev) => {
      const tag = (ev.target && ev.target.tagName) || "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const k = ev.key.toLowerCase();
      if (ev.code === "Space") { ev.preventDefault(); setSpeed(fs.paused ? (fs.speedMult || 1) : 0); }
      else if (k === "-" || k === "`") setSpeed(0.5);
      else if (k === "1") setSpeed(1);
      else if (k === "2") setSpeed(2);
      else if (k === "3") setSpeed(4);
      else if (k === "4") setSpeed(8);
      else if (k === "5") setSpeed(16);
      else if (k === "6") setSpeed(32);
      else if (k === "r") {
        if (fs.replay.active) stopInstantReplay();
        else startInstantReplay({ focusIdx: fs.focusIdx });
      }
      else if (k === "escape" && fs.replay.active) stopInstantReplay();
      else if (k === "t") setAutoTv(!fs.autoTv);
      else if (k === "v") {
        const order = ["off", "tv", "pov", "chase", "pitlane", "director"];
        const nxt = order[(order.indexOf(fs.b3dMode || "off") + 1) % order.length];
        document.querySelector(`[data-fsim-3d="${nxt}"]`)?.click();
      }
      else if (k === "l") getEl("fsim-cam-leader")?.click();
      else if (k === "n") getEl("fsim-cam-battle")?.click();
      else if (k === "f") getEl("fsim-focus-btn")?.click();
      else if (k === "z") {
        const cur = (fs.cam && fs.cam.mode) || "full";
        const order = ["full", "follow", "battle", "close", "heli"];
        setCamMode(order[(order.indexOf(cur) + 1) % order.length], false);
      } else if (ev.key === "Escape") {
        toggleSetupDrawer(false);
        toggleRadioDrawer(false);
      }
    });

    // Historical "What-If" Real F1DB Grand Prix Launcher (1950-2026)
    getEl("fsim-whatif-launch")?.addEventListener("click", async () => {
      const val = getEl("fsim-whatif-sel")?.value || "";
      if (!val.includes(":")) { showToast("Select a Historical Grand Prix first!", "warn"); return; }
      const [yr, rnd] = val.split(":");
      try {
        const res = await fetch(`/api/f1db/what-if/${encodeURIComponent(yr)}/${encodeURIComponent(rnd)}`);
        if (!res.ok) { showToast("Historical GP not found in F1DB", "warn"); return; }
        const pkt = await res.json();
        const deckSel = getEl("fsim-deck-sel");
        if (deckSel) {
          const optVal = `season:${pkt.year}`;
          if ([...deckSel.options].some((o) => o.value === optVal)) deckSel.value = optVal;
        }
        const cirSel = getEl("fsim-circuit-sel");
        if (cirSel && [...cirSel.options].some((o) => o.value === pkt.circuitId)) cirSel.value = pkt.circuitId;
        const eraSel = getEl("fsim-era-sel");
        if (eraSel && [...eraSel.options].some((o) => o.value === pkt.eraKey)) eraSel.value = pkt.eraKey;
        const modeSel = getEl("fsim-mode-sel");
        if (modeSel) modeSel.value = "single";
        toggleSetupDrawer(false);
        showToast(`🕰️ Loaded ${pkt.officialName} (${pkt.grid.length} real drivers · ${pkt.eraKey} rules)!`, "win");
        startNewBroadcast();
      } catch (e) {
        showToast("What-If GP load error: " + e.message, "warn");
      }
    });

    fs.rafId = requestAnimationFrame(loop);
    startNewBroadcast();
  }

  init();
})();
