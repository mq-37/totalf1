/* Full CPU Broadcast Simulator (/sim) — 100% Autonomous AI Grid + F1 TV Auto Director
   Uses F1TrackRenderer + actual 3D F1Car3D models + Wheel-to-Wheel Battle & Collision Physics. */
(function () {
  "use strict";

  const BOOT = window.F1_FULLSIM_BOOT || { latestYear: 2026, circuits: [] };
  const CIRCUITS = BOOT.circuits || [];
  const F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

  const ENG = window.F1RaceEngine;
  const COMPOUNDS = ENG.COMPOUNDS;

  const fs = {
    deckCache: {},
    circuit: CIRCUITS[0] || null,
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
    yellowSector: 0,
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
  function playSfx(name) {
    if (!fs.sfxOn || !window.F1Sfx) return;
    try {
      if (typeof window.F1Sfx[name] === "function") window.F1Sfx[name]();
      else if (window.F1Sfx.play) window.F1Sfx.play(name);
    } catch (_) {}
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
    if (!fs.voiceOn || !window.speechSynthesis) return;
    try {
      const clean = String(text || "").replace(/[^\w\s.,!?'’:+%-]/g, "").trim();
      if (!clean) return;
      if (window.speechSynthesis.speaking) return; // never queue stale backlog
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
  // AUTONOMOUS CPU LAP TIME & STRATEGY AI ENGINE
  // =========================================================================
  function computeCarLapTime(car, circuit, wetness) {
    const st = car.card.game.stats;
    const comp = COMPOUNDS[car.compound] || COMPOUNDS.medium;
    const wPace = circuit.aero === "LOW" ? 0.42 : (circuit.aero === "HIGH" ? 0.28 : 0.35);
    const wRace = circuit.aero === "HIGH" ? 0.34 : 0.28;
    const skill = st.pace * wPace + st.racecraft * wRace + st.reliability * 0.16 + st.duels * 0.12 + st.clutch * 0.09;

    const fuelFrac = Math.max(0, 1 - car.lap / Math.max(1, fs.totalLaps));
    const fuelPenalty = fuelFrac * 1.85;
    const gripBonus = ((fs.gripPct - 35) / 65) * 0.65;

    let lapS = circuit.base_lap_s + fuelPenalty - gripBonus - ((skill - 75) * 0.052) + comp.pace;
    lapS += (100 - car.tyreLife) * 0.018;
    if (car.tyreLife < 22) lapS += (22 - car.tyreLife) * 0.16;
    if (car.tyreTemp > 114) lapS += (car.tyreTemp - 114) * 0.08;
    else if (car.tyreTemp < 84) lapS += (84 - car.tyreTemp) * 0.06;

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
    if (car.inDrsRange && fs.drsEnabled) lapS -= 0.32 * Math.min(3, circuit.drs_zones || 2) * 0.45;
    if (car.wingDamaged) lapS += 0.55;

    const ab = car.card.game.ability && car.card.game.ability.key;
    if (ab === "drs_overtake" && circuit.drs_zones >= 3) lapS -= 0.25;
    if (ab === "tyre_whisperer" && circuit.tyre_wear >= 4) lapS -= 0.25;
    if (ab === "championship_aura" && car.lap >= fs.totalLaps - 3) lapS -= 0.35;
    if (ab === "giant_killer" && car.pos > 3) lapS -= 0.22;

    if (fs.safetyCarLaps > 0) lapS = circuit.base_lap_s * 1.32;
    else if (fs.vscLaps > 0) lapS = circuit.base_lap_s * 1.22;

    lapS += (Math.random() - 0.5) * 0.42;
    return Math.max(circuit.base_lap_s * 0.84, lapS);
  }

  function updateCpuStrategy(car, sorted) {
    const rankIdx = sorted.findIndex((x) => x.idx === car.idx);
    const ahead = rankIdx > 0 ? sorted[rankIdx - 1] : null;
    const behind = rankIdx >= 0 && rankIdx < sorted.length - 1 ? sorted[rankIdx + 1] : null;
    const gapAhead = ahead ? (ahead.totalProg - car.totalProg) * fs.circuit.base_lap_s : 99;
    const gapBehind = behind && !behind.dnf ? (car.totalProg - behind.totalProg) * fs.circuit.base_lap_s : 99;
    const lapsLeft = Math.max(0, fs.totalLaps - car.lap);

    // Dynamic Pace AI
    if (fs.safetyCarLaps > 0 || fs.vscLaps > 0) {
      car.paceMode = "conserve";
      car.aiStatus = "SC DELTA";
    } else if (car.tyreLife < 26 || car.tyreTemp > 113) {
      car.paceMode = "conserve";
      car.aiStatus = car.tyreTemp > 113 ? "COOLING TYRES" : "SAVING TYRES";
    } else if ((gapAhead < 1.35 || gapBehind < 0.9 || lapsLeft <= 3) && car.tyreLife > 34) {
      car.paceMode = "push";
      car.aiStatus = gapAhead < 1.35 ? "ATTACKING" : (gapBehind < 0.9 ? "DEFENDING" : "FINAL PUSH");
    } else if (car.aiPlan === "aggressive" && car.tyreLife > 50) {
      car.paceMode = "push";
      car.aiStatus = "UNDERCUT PACE";
    } else {
      car.paceMode = "balanced";
      car.aiStatus = "MANAGING GAP";
    }

    // Dynamic ERS AI
    if (car.ers < 18) {
      car.ersMode = "harvest";
    } else if ((gapAhead < 0.95 || gapBehind < 0.75) && car.ers > 28 && fs.safetyCarLaps === 0) {
      car.ersMode = "overtake";
      car.aiStatus = gapAhead < 0.95 ? "⚡ ERS OVERTAKE" : "🛡 ERS DEFEND";
    } else if (car.ers > 82 && car.pos > 1) {
      car.ersMode = "overtake";
    } else if (gapAhead > 2.6 && gapBehind > 2.2 && car.ers < 72) {
      car.ersMode = "harvest";
    } else {
      car.ersMode = "auto";
    }

    if (car.inPit > 0) car.aiStatus = "🔧 IN PIT LANE";
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

    if (now - fs.lastCamCutClock < minHoldS && fs.cars[fs.focusIdx] && !fs.cars[fs.focusIdx].dnf) {
      // Refresh chyron text for current target
      const cur = fs.cars[fs.focusIdx];
      const rank = sorted.findIndex((c) => c.idx === cur.idx);
      const ahead = rank > 0 ? sorted[rank - 1] : null;
      const behind = rank >= 0 && rank < sorted.length - 1 ? sorted[rank + 1] : null;
      const gA = ahead ? (ahead.totalProg - cur.totalProg) * fs.circuit.base_lap_s : 99;
      const gB = behind && !behind.dnf ? (cur.totalProg - behind.totalProg) * fs.circuit.base_lap_s : 99;
      if (gA < 0.9) updateChyron(`⚔️ BATTLE FOR P${ahead.pos} · ${ahead.card.code3} vs ${cur.card.code3} (+${gA.toFixed(2)}s)`);
      else if (gB < 0.9) updateChyron(`⚔️ BATTLE FOR P${cur.pos} · ${cur.card.code3} vs ${behind.card.code3} (+${gB.toFixed(2)}s)`);
      else updateChyron(`🎥 FOLLOWING P${cur.pos} · ${cur.card.clean_name.toUpperCase()}`);
      return;
    }

    const leader = sorted.find((c) => !c.dnf);
    if (!leader) return;
    const leaderLap = leader.lap;

    // Final lap? Lock onto the Lead Battle!
    if (leaderLap >= fs.totalLaps - 1) {
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

    // Draw all 20-24 real 3D CPU cars!
    fs.carScreenPos = [];
    const labels = [];
    const drawOrder = renderCars.slice().sort((a, b) => (a.idx === activeFocusIdx ? 1 : 0) - (b.idx === activeFocusIdx ? 1 : 0));
    let focusHudInfo = null;

    drawOrder.forEach((car) => {
      if (car.dnf) return;
      const inPit = car.inPit > 0 && car.pitDuration > 0;
      const pitProgress = inPit ? (1 - Math.max(0, Math.min(1, car.inPit / car.pitDuration))) : null;
      const pose = inPit
        ? R.samplePitLane(fs.geom, pitProgress)
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
    ctx.restore();

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
      R.drawStartLightsOverlay(ctx, fs.raceClock, cssW, cssH);
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
    const sorted = fs.cars.slice().sort((a, b) => (a.dnf !== b.dnf ? (a.dnf ? 1 : -1) : b.totalProg - a.totalProg));
    const leader = sorted[0];
    if (!leader) return;

    sorted.forEach((c, i) => {
      c.pos = i + 1;
      c.intervalS = i > 0 && !c.dnf ? Math.max(0.03, (sorted[i - 1].totalProg - c.totalProg) * fs.circuit.base_lap_s) : 0;
      c.inDrsRange = i > 0 && c.intervalS <= 1.05 && c.inPit === 0;
    });

    // Update top director bar
    const curLap = Math.min(fs.totalLaps, Math.max(1, leader.lap + 1));
    getEl("fsim-lap-num").textContent = String(curLap).padStart(2, "0");
    getEl("fsim-lap-tot").textContent = String(fs.totalLaps);

    const flagEl = getEl("fsim-flag-pill");
    if (flagEl) {
      if (fs.finished) { flagEl.className = "sim-flag-pill flag-finish"; flagEl.innerHTML = `<i class="fas fa-flag-checkered"></i> CHEQUERED`; }
      else if (fs.safetyCarLaps > 0) { flagEl.className = "sim-flag-pill flag-sc"; flagEl.innerHTML = `<i class="fas fa-car-side"></i> SAFETY CAR`; }
      else if (fs.vscLaps > 0) { flagEl.className = "sim-flag-pill flag-sc"; flagEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> VSC`; }
      else if (fs.yellowSector > 0) { flagEl.className = "sim-flag-pill flag-yellow"; flagEl.innerHTML = `<i class="fas fa-exclamation"></i> YELLOW S${fs.yellowSector}`; }
      else if (fs.drsEnabled) { flagEl.className = "sim-flag-pill flag-green"; flagEl.innerHTML = `<i class="fas fa-flag"></i> GREEN · DRS ON`; }
      else { flagEl.className = "sim-flag-pill flag-green"; flagEl.innerHTML = `<i class="fas fa-flag"></i> GREEN FLAG`; }
    }

    const wetPct = Math.round(fs.wetness);
    const wPill = getEl("fsim-weather-pill");
    if (wPill) {
      wPill.className = `sim-weather-pill ${wetPct >= 60 ? "w-wet" : (wetPct >= 22 ? "w-damp" : "w-dry")}`;
      wPill.querySelector("i").className = wetPct >= 60 ? "fas fa-cloud-showers-heavy" : (wetPct >= 22 ? "fas fa-cloud-rain" : "fas fa-sun");
      getEl("fsim-weather-txt").textContent = wetPct >= 60 ? `RAIN ${wetPct}%` : (wetPct >= 22 ? `DAMP ${wetPct}%` : `DRY ${wetPct}%`);
      getEl("fsim-wet-fill").style.width = `${wetPct}%`;
    }

    // Timing Tower (All 20-24 CPU cars)
    const cntEl = getEl("fsim-grid-count");
    if (cntEl) cntEl.textContent = `(${sorted.length})`;
    getEl("fsim-timing-body").innerHTML = sorted.map((c) => {
      const comp = COMPOUNDS[c.compound] || COMPOUNDS.medium;
      const gap = c.dnf ? "OUT" : (c.inPit > 0 ? "PIT" : (c === leader ? "LDR" : `+${(fs.gapMode === "int" ? c.intervalS : (leader.totalProg - c.totalProg) * fs.circuit.base_lap_s).toFixed(1)}`));
      const life = Math.max(0, Math.round(c.tyreLife));
      const wCol = life < 25 ? "#ef4444" : (life < 50 ? "#f59e0b" : "#22c55e");
      const drsMark = (c.inDrsRange && fs.drsEnabled && !c.dnf) ? `<span class="sim-drs-pill">DRS</span>` : "";
      const flMark = fs.fastestLap.driver === c.card.clean_name ? `<span class="sim-fl-pill">FL</span>` : "";
      const penMark = (c.timePenaltyS && c.timePenaltyS > 0) ? `<span class="sim-pen-pill">+${c.timePenaltyS}s</span>` : "";
      const dmgMark = c.wingDamaged ? `<span class="sim-pen-pill">WNG</span>` : "";
      const isFoc = c.idx === fs.focusIdx;
      return `
        <tr data-fsim-idx="${c.idx}" class="${isFoc ? "is-player-row" : ""}${c.dnf ? " is-dnf-row" : ""}">
          <td class="st-pos ${c.pos <= 3 ? "p" + c.pos : ""}">${c.pos}</td>
          <td class="st-drv"><span class="st-bar" style="background:${esc(c.card.hero_color)}"></span><span class="st-code">${esc(c.card.code3)}</span>${flMark}${drsMark}${penMark}${dmgMark}</td>
          <td class="st-gap${c.inDrsRange && fs.drsEnabled && fs.gapMode === "int" ? " is-drs-range" : ""}">${gap}</td>
          <td><div class="st-tyre-cell"><span class="sim-tbadge t-${c.compound}">${comp.code}</span><div class="st-wear-col"><small>${life}%</small><span class="st-wear-bar"><i style="width:${life}%;background:${wCol}"></i></span></div></div></td>
          <td class="st-stops">${c.stops}<div class="st-ers-sliver"><i style="width:${Math.round(c.ers)}%"></i></div></td>
        </tr>
      `;
    }).join("");

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
      getEl("fsim-f-team").textContent = `${foc.card.hero_team} · OVR ${Math.round(foc.card.overall)}`;
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
  // SIMULATION TICK (100% CPU RACING, PIT STOPS, WEATHER, COLLISIONS, SEASON)
  // =========================================================================
  function stepSimulation(dt) {
    if (!fs.running || fs.paused || fs.finished) return;
    const lapScale = (fs.circuit.base_lap_s / 22.0) * fs.speedMult;
    const simDt = dt * lapScale;
    fs.raceClock += simDt;

    const leaderLap = Math.max(...fs.cars.map((c) => c.lap), 0);
    fs.gripPct = Math.min(100, 38 + (leaderLap / Math.max(1, fs.totalLaps)) * 62);
    if (fs.yellowTimer > 0) {
      fs.yellowTimer -= dt;
      if (fs.yellowTimer <= 0) fs.yellowSector = 0;
    }

    const shouldDrs = leaderLap >= 1 && fs.wetness < 20 && fs.safetyCarLaps === 0 && fs.vscLaps === 0;
    if (shouldDrs && !fs.drsEnabled && !fs.drsAnnounced && leaderLap >= 1) {
      fs.drsAnnounced = true;
      showToast("🟢 RACE CONTROL: DRS ENABLED!", "win");
      addCommentary(leaderLap + 1, "🟢 FIA Race Control: DRS is now ENABLED!", "win");
    }
    fs.drsEnabled = shouldDrs;

    // Realistic Lap-Based Dynamic Weather Fronts (1-2 realistic storms per GP, NEVER rapid ping-pong!)
    if (fs.weatherMode === "dynamic" || fs.weatherMode === "showers") {
      const curLap = Math.max(1, leaderLap + 1);
      if (curLap >= fs.nextWeatherLap) {
        const frontDur = Math.max(4, Math.round(fs.totalLaps * (0.22 + Math.random() * 0.24)));
        fs.nextWeatherLap = curLap + frontDur;
        const chance = fs.weatherMode === "showers" ? 0.58 : Math.min(0.65, (fs.circuit.rain_chance || 20) / 100);
        if (Math.random() < chance && fs.targetWetness < 20) {
          fs.targetWetness = Math.random() < 0.35 ? 80 : 46;
          const msg = `🌧️ Weather Radar: ${fs.targetWetness >= 70 ? "Heavy storm" : "Rain shower"} rolling over ${fs.circuit.name}!`;
          addCommentary(curLap, msg, "warn"); showToast(msg, "warn"); playSfx("radioAlert");
        } else if (fs.targetWetness >= 20) {
          fs.targetWetness = 0;
          const msg = `☀️ Rain easing at ${fs.circuit.name} — dry racing line will emerge over the next few laps!`;
          addCommentary(curLap, msg, "info"); showToast(msg, "win");
        }
      }
      const prevW = fs.wetness;
      const lapFrac = simDt / fs.circuit.base_lap_s;
      const maxDelta = lapFrac * (fs.targetWetness > fs.wetness ? 14 : 10); // ~10-14% wetness shift per lap
      const diffW = fs.targetWetness - fs.wetness;
      fs.wetness += Math.sign(diffW) * Math.min(Math.abs(diffW), maxDelta);
      fs.drying = fs.wetness < prevW - 0.01;
    }

    const sortedNow = fs.cars.slice().sort((a, b) => (a.dnf !== b.dnf ? (a.dnf ? 1 : -1) : b.totalProg - a.totalProg));
    const prevLeaderLap = leaderLap;
    // Distance-scaled tyre wear: realistic 1-2 dry stops (or 2-3 wet stops) whether 15 laps OR full 71-lap GP!
    const baseWearPerLap = Math.min(9.2, 165 / Math.max(12, fs.totalLaps));

    // Pre-step: update CPU strategies, pit lane timers & record pre-step lap/sector for crossings
    fs.cars.forEach((car) => {
      if (car.dnf) return;
      updateCpuStrategy(car, sortedNow);
      car._prevLap = car.lap;
      car._prevSec = Math.floor((((car.totalProg % 1) + 1) % 1) * 3);
      if (car.inPit > 0) {
        car.inPit -= simDt;
        if (car.inPit <= 0) {
          car.inPit = 0; car.pitDuration = 0;
          car.compound = car.nextCompound;
          car.tyreLife = 100;
          car.tyreTemp = 84;
          const fixedWing = !!car.wingDamaged;
          car.wingDamaged = false;
          car.stops += 1;
          car.lastPitLap = car.lap;
          fs.stats.pits += 1;
          if (COMPOUNDS[car.compound].wet > 0) car.usedWet = true;
          else car.dryCompoundsUsed.add(car.compound);
          if (car.pos <= 8 || fixedWing) {
            addCommentary(car.lap + 1, `🔧 ${car.card.clean_name} exits pits on fresh ${COMPOUNDS[car.compound].name}s${fixedWing ? " + new front wing" : ""}!`, "info");
          }
        }
      }
    });

    // Velocity-First Sub-Stepped Longitudinal Integration + Spatial AI + 2D Solid-Body Physics!
    const R = window.F1TrackRenderer;
    let incidents = [];
    if (R && fs.geom) {
      if (!fs.fx) fs.fx = R.createFxState();
      incidents = R.stepBattlePhysics(fs.cars, fs.geom, fs.circuit, fs.fx, {
        dt,
        simDt,
        raceClock: fs.raceClock,
        speedMult: fs.speedMult,
        wetness: fs.wetness,
        leaderLap,
        totalLaps: fs.totalLaps,
        scActive: fs.safetyCarLaps > 0,
        vscActive: fs.vscLaps > 0,
        yellowSector: fs.yellowSector,
        drsEnabled: fs.drsEnabled,
        chaosMult: fs.chaosMult,
      });
    }

    fs.cars.forEach((car) => {
      if (car.dnf || car.inPit > 0) return;

      const prevLap = car._prevLap != null ? car._prevLap : car.lap;
      const prevSec = car._prevSec != null ? car._prevSec : Math.floor((((car.totalProg % 1) + 1) % 1) * 3);
      if (!R || !fs.geom) {
        car.totalProg += (1.0 / car.currentLapS) * simDt;
      }
      car.lap = Math.floor(car.totalProg);
      const curSec = Math.floor((((car.totalProg % 1) + 1) % 1) * 3);

      if (curSec !== prevSec && car.lap >= 1) {
        const sTime = (car.currentLapS / 3) * (0.97 + Math.random() * 0.06);
        if (sTime < fs.bestSectors[prevSec] && fs.safetyCarLaps === 0 && fs.vscLaps === 0) {
          fs.bestSectors[prevSec] = sTime;
          car.bestSectors[prevSec] = sTime;
          car.sectorColors[prevSec] = "purple";
        } else if (sTime < car.bestSectors[prevSec]) {
          car.bestSectors[prevSec] = sTime;
          car.sectorColors[prevSec] = "green";
        } else {
          car.sectorColors[prevSec] = "yellow";
        }
      }

      const comp = COMPOUNDS[car.compound] || COMPOUNDS.medium;
      const targetTemp = fs.safetyCarLaps > 0 ? 78 : (comp.optTemp + (car.paceMode === "push" ? 16 : (car.paceMode === "conserve" ? -12 : 0)) - fs.wetness * 0.12);
      car.tyreTemp += (targetTemp - car.tyreTemp) * Math.min(1, dt * 0.22);
      const thermalWear = car.tyreTemp > 114 ? 1.25 : 1.0;
      const wearMult = (0.65 + (fs.circuit.tyre_wear || 3) * 0.16) * comp.wear * thermalWear * (car.paceMode === "push" ? 1.28 : (car.paceMode === "conserve" ? 0.72 : 1.0));
      car.tyreLife = Math.max(5, car.tyreLife - (wearMult * (simDt / fs.circuit.base_lap_s) * baseWearPerLap));

      if (car.ersMode === "overtake") car.ers = Math.max(0, car.ers - (simDt / fs.circuit.base_lap_s) * 34);
      else if (car.ersMode === "harvest") car.ers = Math.min(100, car.ers + (simDt / fs.circuit.base_lap_s) * 28);
      else car.ers = Math.min(100, car.ers + (simDt / fs.circuit.base_lap_s) * 6);

      if (car.lap > prevLap) {
        if (car.currentLapS < fs.fastestLap.time && fs.safetyCarLaps === 0 && fs.vscLaps === 0 && car.lap >= 2) {
          fs.fastestLap = { time: car.currentLapS, driver: car.card.clean_name, code3: car.card.code3 };
        }

        if (car.lap >= fs.totalLaps) {
          if (!hasSatisfiedTwoCompoundRule(car)) {
            car.timePenaltyS = (car.timePenaltyS || 0) + 20;
            car.totalProg -= 20 / fs.circuit.base_lap_s;
          }
          if (!fs.finished) {
            finishGrandPrix();
          }
          return;
        }

        // Realistic Mechanical DNF (~1.5-2.5 mechanical DNFs across a full 20-car Grand Prix!)
        const raceMechChance = Math.min(0.16, (car.card.game.stats.dnf_rate / 100) * 0.42) * Math.sqrt(fs.chaosMult);
        const perLapDnf = raceMechChance / Math.max(10, fs.totalLaps);
        const pushRisk = car.paceMode === "push" ? 1.25 : 0.85;
        if (car.lap >= 2 && fs.stats.dnfs < 6 && Math.random() < perLapDnf * pushRisk) {
          car.dnf = true;
          fs.stats.dnfs += 1;
          fs.stats.incidents += 1;
          const secNum = Math.floor((((car.totalProg % 1) + 1) % 1) * 3) + 1;
          fs.yellowSector = secNum; fs.yellowTimer = 5.5;
          const corner = (fs.circuit.corners && fs.circuit.corners[Math.floor(Math.random() * fs.circuit.corners.length)]) || `Sector ${secNum}`;
          addCommentary(car.lap + 1, `💥 MECHANICAL DNF! ${car.card.clean_name} parks it at ${corner}!`, "warn");
          if (fs.safetyCarLaps === 0 && fs.vscLaps === 0) {
            const roll = Math.random();
            if (roll < 0.34) {
              fs.safetyCarLaps = 2; fs.stats.scs += 1;
              showToast("⚠️ SAFETY CAR DEPLOYED!", "warn");
              addCommentary(car.lap + 1, "⚠️ SAFETY CAR DEPLOYED! Pack bunching up & cheap pit window open!", "warn");
              playSfx("radioAlert");
            } else if (roll < 0.65) {
              fs.vscLaps = 1;
              showToast("⚠️ VIRTUAL SAFETY CAR (VSC)!", "warn");
              addCommentary(car.lap + 1, "⚠️ VIRTUAL SAFETY CAR (VSC) deployed!", "warn");
              playSfx("radioAlert");
            }
          }
          return;
        }

        // Realistic CPU Pit Strategy with Weather Hysteresis & Stint Cooldown (1-3 stops per car!)
        const scFactor = fs.safetyCarLaps > 0 ? 0.58 : (fs.vscLaps > 0 ? 0.68 : 1.0);
        const effPit = fs.circuit.pit_loss_s * scFactor;
        const lapsLeft = fs.totalLaps - car.lap;
        const lapsSincePit = car.lap - (car.lastPitLap == null ? -99 : car.lastPitLap);
        const minStint = Math.max(3, Math.round(fs.totalLaps * 0.12));

        // Weather crossover with generous hysteresis so cars NEVER ping-pong Inter <-> Wet!
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

        const mustFulfillRule = !car.usedWet && car.dryCompoundsUsed.size < 2 && lapsLeft <= Math.max(3, Math.round(fs.totalLaps * 0.14)) && lapsLeft >= 2;
        const scOpportunistic = (fs.safetyCarLaps > 0 || fs.vscLaps > 0) && car.tyreLife < 56 && lapsSincePit >= minStint && lapsLeft >= 4;
        const cliffPit = car.tyreLife < (car.aiPlan === "aggressive" ? 26 : 21) && lapsLeft >= 3 && lapsSincePit >= minStint;
        const wingPit = car.wingDamaged && lapsLeft >= 4 && lapsSincePit >= 2;

        if (weatherTarget || mustFulfillRule || scOpportunistic || cliffPit || wingPit) {
          car.inPit = effPit + (car.wingDamaged ? 4.5 : 0);
          car.pitDuration = car.inPit;
          if (weatherTarget === "wet" || weatherTarget === "inter") {
            car.nextCompound = weatherTarget;
          } else if (fs.wetness >= 24) {
            car.nextCompound = fs.wetness >= 72 ? "wet" : "inter";
          } else {
            const remFrac = lapsLeft / Math.max(1, fs.totalLaps);
            let pref = remFrac <= 0.24 ? "soft" : (remFrac <= 0.44 ? "medium" : "hard");
            if (!car.usedWet && car.dryCompoundsUsed.size === 1 && car.dryCompoundsUsed.has(pref)) {
              pref = pref === "medium" ? (remFrac > 0.32 ? "hard" : "soft") : "medium";
            }
            car.nextCompound = pref;
          }
        }

        car.currentLapS = computeCarLapTime(car, fs.circuit, fs.wetness);
      }
    });

    // Process FIA Stewards & Incident Events returned by Physics v2 + Record Replay Ring Buffer
    if (R && fs.geom) {
      incidents.forEach((ev) => {
        const aName = ev.chaser.card.clean_name, bName = ev.target.card.clean_name;
        const corner = (fs.circuit.corners && fs.circuit.corners[Math.floor(Math.random() * fs.circuit.corners.length)]) || `Sector ${ev.sector}`;
        const clipTitle = ev.type === "fia_breach"
          ? `FIA STEWARDS · ${ev.culprit.card.code3} MOVING UNDER BRAKING AT ${corner.toUpperCase()}`
          : `${ev.type.toUpperCase()} AT ${corner.toUpperCase()} · ${ev.chaser.card.code3} & ${ev.target.card.code3}`;
        const clipId = saveReplayClip(clipTitle, (ev.culprit || ev.target).idx);

        if (ev.type === "fia_breach") {
          showStewardsBanner(
            `⚖️ FIA RACE CONTROL · ${ev.article || "APP. L CH. IV"}`,
            `${ev.culprit.card.clean_name} — ${ev.fiaRule} (${ev.verdict})`,
            ev.penaltyS ? "penalty" : "info"
          );
          emitBroadcastCall("fia_mub", {
            lap: leaderLap + 1,
            culprit: ev.culprit.card.clean_name,
            victim: ev.chaser.card.clean_name,
            article: ev.article,
            verdict: ev.verdict,
            clipId,
          });
          playSfx("radioAlert");
          if (fs.autoReplay && performance.now() - fs.lastAutoReplayTs > 26000) {
            fs.lastAutoReplayTs = performance.now();
            setTimeout(() => {
              const clip = fs.replayClips.find((c) => c.id === clipId);
              if (clip && fs.running && !fs.replay.active) startInstantReplay({ frames: clip.frames, focusIdx: clip.focusIdx, title: clip.title });
            }, 900);
          }
          return;
        }

        fs.stats.incidents += 1;
        if (ev.type === "contact") {
          const msg = `💥 WHEEL-TO-WHEEL! ${aName} & ${bName} bang wheels at ${corner} — ${ev.verdict}!`;
          addCommentary(leaderLap + 1, msg, "warn", clipId);
          if (ev.penaltyS || ev.blackWhiteFlag) {
            showStewardsBanner("⚖️ FIA STEWARDS VERDICT", `${(ev.culprit || ev.chaser).card.clean_name} — ${ev.fiaRule} (${ev.verdict})`, ev.penaltyS ? "penalty" : "info");
          }
          runAutoTvDirector(sortedNow, ev.chaser.idx, `💥 CONTACT · ${ev.chaser.card.code3} & ${ev.target.card.code3}`);
        } else if (ev.type === "spin") {
          fs.yellowSector = ev.sector; fs.yellowTimer = 5.5;
          const penTxt = ev.penaltyS ? ` (${ev.fiaRule}: +${ev.penaltyS}s)` : ` (${ev.verdict})`;
          const msg = `🎙 CROFTY: SPIN AT ${corner.toUpperCase()}! ${aName} & ${bName} make contact${penTxt}!`;
          addCommentary(leaderLap + 1, msg, "warn", clipId); showToast(msg, "warn"); playSfx("radioAlert");
          showStewardsBanner("⚖️ FIA STEWARDS INVESTIGATION", `${ev.culprit ? ev.culprit.card.clean_name + " — " : ""}${ev.fiaRule}: ${ev.verdict}`, ev.penaltyS ? "penalty" : "info");
          runAutoTvDirector(sortedNow, ev.target.idx, `🌀 SPIN AT ${corner.toUpperCase()}!`);
          if (fs.autoReplay && performance.now() - fs.lastAutoReplayTs > 26000) {
            fs.lastAutoReplayTs = performance.now();
            setTimeout(() => {
              const clip = fs.replayClips.find((c) => c.id === clipId);
              if (clip && fs.running && !fs.replay.active) startInstantReplay({ frames: clip.frames, focusIdx: clip.focusIdx, title: clip.title });
            }, 1100);
          }
        } else if (ev.type === "crash") {
          fs.yellowSector = ev.sector; fs.yellowTimer = 7.5;
          if (ev.target.dnf) fs.stats.dnfs += 1;
          if (ev.chaser.dnf) fs.stats.dnfs += 1;
          const msg = `🚨 CROFTY: HUGE INCIDENT AT ${corner.toUpperCase()}! ${aName} & ${bName} tangle — SAFETY CAR DEPLOYED!`;
          if (fs.safetyCarLaps === 0) { fs.safetyCarLaps = 2; fs.stats.scs += 1; }
          addCommentary(leaderLap + 1, msg, "warn", clipId); showToast(msg, "warn"); playSfx("radioAlert");
          showStewardsBanner("⚖️ FIA RACE CONTROL · SAFETY CAR", `${ev.fiaRule} (${ev.verdict}) — No Overtaking!`, "penalty");
          runAutoTvDirector(sortedNow, ev.chaser.idx, `🚨 CRASH AT ${corner.toUpperCase()}!`);
          if (fs.autoReplay && performance.now() - fs.lastAutoReplayTs > 20000) {
            fs.lastAutoReplayTs = performance.now();
            setTimeout(() => {
              const clip = fs.replayClips.find((c) => c.id === clipId);
              if (clip && fs.running && !fs.replay.active) startInstantReplay({ frames: clip.frames, focusIdx: clip.focusIdx, title: clip.title });
            }, 1200);
          }
        }
      });

      // Record live 20 Hz Replay Ring Buffer + decay Stewards Banner
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

    const newLeaderLap = Math.max(...fs.cars.map((c) => c.lap), 0);
    if (newLeaderLap > prevLeaderLap) {
      if (fs.safetyCarLaps > 0) {
        fs.safetyCarLaps -= 1;
        if (fs.safetyCarLaps === 0) {
          addCommentary(newLeaderLap + 1, "🟢 SAFETY CAR IN THIS LAP — GREEN FLAG RESTART!", "win");
          showToast("🟢 SAFETY CAR IN — RACING RESUMES!", "win");
        }
      }
      if (fs.vscLaps > 0) {
        fs.vscLaps -= 1;
        if (fs.vscLaps === 0) {
          addCommentary(newLeaderLap + 1, "🟢 VSC ENDING — GREEN FLAG!", "win");
          showToast("🟢 VSC ENDING — GREEN FLAG!", "win");
        }
      }
    }

    const now = performance.now();
    if (now - fs.lastUiSync > 160) {
      fs.lastUiSync = now;
      renderHud();
      const sortedAfter = fs.cars.slice().sort((a, b) => (a.dnf !== b.dnf ? (a.dnf ? 1 : -1) : b.totalProg - a.totalProg));

      // Count ONLY genuine on-track overtakes (neither car in pits/DNF, green flag, debounced per pair!)
      const onTrack = sortedAfter.filter((c) => !c.dnf && c.inPit === 0).map((c) => c.idx);
      if (fs.prevOnTrackOrder.length && fs.safetyCarLaps === 0 && fs.vscLaps === 0) {
        const prevIdxMap = new Map();
        fs.prevOnTrackOrder.forEach((id, r) => prevIdxMap.set(id, r));
        for (let r = 0; r < onTrack.length; r++) {
          const passerId = onTrack[r];
          const prevR = prevIdxMap.get(passerId);
          if (prevR == null || r >= prevR) continue;
          // Check who was immediately passed on track
          const victimId = onTrack[r + 1];
          const victimPrevR = victimId != null ? prevIdxMap.get(victimId) : null;
          if (victimId != null && victimPrevR != null && victimPrevR < prevR) {
            const pk = passerId < victimId ? `${passerId}_${victimId}` : `${victimId}_${passerId}`;
            if (!fs.overtakeCooldown[pk] || fs.raceClock >= fs.overtakeCooldown[pk]) {
              fs.overtakeCooldown[pk] = fs.raceClock + 18;
              fs.stats.overtakes += 1;
              const passer = fs.cars[passerId];
              const victim = fs.cars[victimId];
              if (passer && victim && passer.pos <= 6) {
                const corner = (fs.circuit.corners && fs.circuit.corners[Math.floor(Math.random() * fs.circuit.corners.length)]) || "Turn 1";
                const clipTitle = `OVERTAKE FOR P${passer.pos} · ${passer.card.code3} PASSES ${victim.card.code3} AT ${corner.toUpperCase()}`;
                const clipId = saveReplayClip(clipTitle, passer.idx);
                const kind = passer.battleState === "cutback"
                  ? "overtake_cutback"
                  : (passer.battleState === "tow" || passer.inDrsRange ? "overtake_drs" : "overtake_dive");
                emitBroadcastCall(kind, {
                  lap: passer.lap + 1,
                  passer: passer.card.clean_name,
                  victim: victim.card.clean_name,
                  pos: passer.pos,
                  corner,
                  clipId,
                });
                // Auto Instant Replay on P1 Lead Change!
                if (passer.pos === 1 && fs.autoReplay && performance.now() - fs.lastAutoReplayTs > 28000) {
                  fs.lastAutoReplayTs = performance.now();
                  setTimeout(() => {
                    const clip = fs.replayClips.find((c) => c.id === clipId);
                    if (clip && fs.running && !fs.replay.active) startInstantReplay({ frames: clip.frames, focusIdx: clip.focusIdx, title: clip.title });
                  }, 1000);
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

      runAutoTvDirector(sortedAfter, null, null);

      // Ambient Brundle/Crofty color commentary during intense clean battles (every ~14s)
      if (now - fs.lastAmbientCallTs > 14000 && fs.safetyCarLaps === 0 && fs.vscLaps === 0) {
        const focCar = fs.cars[fs.focusIdx];
        if (focCar && !focCar.dnf && focCar.aiObs) {
          if (focCar.aiObs.state === "avoid") {
            fs.lastAmbientCallTs = now;
            emitBroadcastCall("avoid", { lap: focCar.lap + 1, driver: focCar.card.clean_name });
          } else if (focCar.aiObs.state === "fight" || focCar.aiObs.state === "defend") {
            const rival = sortedAfter.find((c) => c.idx !== focCar.idx && !c.dnf && Math.abs(c.totalProg - focCar.totalProg) * fs.circuit.base_lap_s < 0.45);
            if (rival) {
              fs.lastAmbientCallTs = now;
              emitBroadcastCall("battle_clean", { lap: focCar.lap + 1, a: focCar.card.clean_name, b: rival.card.clean_name });
            }
          }
        }
      }
    }
  }

  function finishGrandPrix() {
    fs.finished = true;
    fs.running = false;
    // Apply FIA time penalties to final order
    fs.cars.forEach((c) => {
      if (!c.dnf && c.timePenaltyS > 0) c.totalProg -= c.timePenaltyS / fs.circuit.base_lap_s;
    });
    renderHud();

    const sorted = fs.cars.slice().sort((a, b) => (a.dnf !== b.dnf ? (a.dnf ? 1 : -1) : b.totalProg - a.totalProg));
    const podium = sorted.slice(0, 3);
    const podTxt = podium.map((x, i) => `P${i + 1} ${x.card.clean_name}`).join(" · ");
    addCommentary(fs.totalLaps, `🏁 CHEQUERED FLAG at ${fs.circuit.name}! ${podTxt}`, "win");
    playSfx("winLap");

    // Award Championship Points if in Season Mode
    let seasonDone = false;
    if (fs.season.active) {
      fs.season.racesRun += 1;
      sorted.forEach((c, i) => {
        const key = c.card.clean_name;
        if (!fs.season.wdc[key]) {
          fs.season.wdc[key] = { name: key, code3: c.card.code3, team: c.card.hero_team, color: c.card.hero_color, pts: 0, wins: 0 };
        }
        const tKey = c.card.hero_team || "Independent";
        if (!fs.season.wcc[tKey]) {
          fs.season.wcc[tKey] = { team: tKey, color: c.card.hero_color, pts: 0, wins: 0 };
        }
        if (!c.dnf && i < F1_POINTS.length) {
          let pts = F1_POINTS[i];
          if (fs.fastestLap.driver === key) pts += 1;
          fs.season.wdc[key].pts += pts;
          fs.season.wcc[tKey].pts += pts;
          if (i === 0) { fs.season.wdc[key].wins += 1; fs.season.wcc[tKey].wins += 1; }
        }
      });
      renderSeasonStandings();
      seasonDone = fs.season.roundIdx >= fs.season.rounds.length - 1;
    }

    const finEl = getEl("fsim-finish-banner");
    if (finEl) {
      finEl.classList.remove("hidden");
      const wdcLeader = fs.season.active
        ? Object.values(fs.season.wdc).sort((a, b) => b.pts - a.pts)[0]
        : null;
      const seasonLine = fs.season.active
        ? (seasonDone
            ? `<div style="margin-top:4px;color:#4ade80;font-weight:800;">🏆 WORLD CHAMPION: ${esc(wdcLeader ? wdcLeader.name : "")} (${wdcLeader ? wdcLeader.pts : 0} pts)!</div>`
            : `<div style="margin-top:4px;color:#38bdf8;">Round ${fs.season.roundIdx + 1}/${fs.season.rounds.length} Complete · WDC Leader: <b>${esc(wdcLeader ? wdcLeader.name : "")}</b> (${wdcLeader ? wdcLeader.pts : 0} pts)</div>`)
        : "";

      const nextBtn = (fs.season.active && !seasonDone)
        ? `<button type="button" id="fsim-next-gp-btn" class="btn-racing"><i class="fas fa-forward"></i> Next GP: ${esc(fs.season.rounds[fs.season.roundIdx + 1].name)}</button>`
        : `<button type="button" id="fsim-rematch-btn" class="btn-racing"><i class="fas fa-redo"></i> ${seasonDone ? "New Championship" : "Watch Again"}</button>`;

      const avgStops = (fs.stats.pits / Math.max(1, fs.cars.length)).toFixed(1);
      finEl.innerHTML = `
        <div>
          <strong>🏁 CHEQUERED FLAG — ${esc(fs.circuit.name.toUpperCase())}!</strong>
          <div style="font-size:0.82rem;color:#fde047;margin-top:3px;">🏆 ${esc(podTxt)}</div>
          <div style="font-size:0.75rem;color:#cbd5e1;margin-top:2px;">
            FL: <b>${esc(fs.fastestLap.driver || "—")}</b> (${fmtLapTime(fs.fastestLap.time)}) · ${fs.stats.overtakes} Overtakes · ${fs.stats.pits} Pit Stops (${avgStops}/car) · ${fs.stats.incidents} Incidents · ${fs.stats.leadChanges} Lead Changes
          </div>
          ${seasonLine}
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          ${nextBtn}
          <button type="button" id="fsim-fin-setup" class="sim-dir-btn"><i class="fas fa-sliders-h"></i> Setup</button>
        </div>
      `;
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

  async function launchCurrentRound() {
    clearTimeout(fs.autoAdvTimer);
    stopInstantReplay();
    fs.replayBuf = [];
    fs.replayClips = [];
    fs.stewardsBanner = null;
    fs.stewardsTimer = 0;
    const deckSpec = getEl("fsim-deck-sel")?.value || `season:${BOOT.latestYear}`;
    const maxCars = parseInt(getEl("fsim-grid-size")?.value || "20", 10) || 20;
    const gridOrder = getEl("fsim-grid-order")?.value || "quali";
    const cardsRaw = await loadDeck(deckSpec, maxCars);
    if (!cardsRaw.length) return;

    const selCir = fs.season.active
      ? fs.season.rounds[fs.season.roundIdx]
      : (CIRCUITS.find((c) => c.id === getEl("fsim-circuit-sel")?.value) || CIRCUITS[0]);
    fs.circuit = selCir;

    const dist = getEl("fsim-laps-sel")?.value || "15";
    fs.totalLaps = dist === "full" ? (selCir.laps || 55) : (parseInt(dist, 10) || 15);
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
    fs.paused = false;
    fs.running = true;
    fs.staticKey = "";
    if (window.F1TrackRenderer) fs.fx = window.F1TrackRenderer.createFxState();

    // Order starting grid (Qualifying Sim, Reverse Grid, or Random Shuffle)
    let cards = cardsRaw.slice();
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

    const startComp = fs.wetness >= 60 ? "wet" : (fs.wetness >= 22 ? "inter" : "medium");
    fs.cars = cards.map((card, i) => {
      // Realistic strategy split across the grid (Soft / Medium / Hard)
      let comp = startComp;
      if (startComp === "medium") {
        comp = i < 5 ? "soft" : (i % 5 === 4 ? "hard" : "medium");
      }
      const isWetStart = COMPOUNDS[comp].wet > 0;
      const car = {
        idx: i,
        card,
        pos: i + 1,
        lap: 0,
        totalProg: -0.0055 * i,
        latOffset: (i % 2 === 0 ? -2.4 : 2.4),
        compound: comp,
        nextCompound: comp,
        dryCompoundsUsed: new Set(isWetStart ? [] : [comp]),
        usedWet: isWetStart,
        tyreLife: 100,
        tyreTemp: COMPOUNDS[comp].optTemp - 3,
        ers: 68,
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
        bestSectors: [999, 999, 999],
        sectorColors: ["none", "none", "none"],
        paceMode: "balanced",
        ersMode: "auto",
        aiPlan: i % 3 === 0 ? "aggressive" : "balanced",
        aiStatus: "RACE START",
        currentLapS: selCir.base_lap_s,
      };
      car.currentLapS = computeCarLapTime(car, selCir, fs.wetness);
      return car;
    });

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
      rPill.classList.toggle("hidden", !fs.season.active);
      if (fs.season.active) rPill.textContent = `R${fs.season.roundIdx + 1}/${fs.season.rounds.length}`;
    }

    renderHud();
    renderSeasonStandings();
    playSfx("lightsOut");
    const pole = fs.cars[0];
    const startMsg = `🟢 LIGHTS OUT at ${selCir.name} (${selCir.gp})! ${pole.card.clean_name} leads ${fs.cars.length} CPU cars away from Pole!`;
    addCommentary(1, startMsg, "win");
    showToast(`📺 LIVE — ${selCir.name.toUpperCase()}`, "win");
    updateChyron(`🟢 LIGHTS OUT · POLE: ${pole.card.code3}`);
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
    drawCanvas();
  }

  function init() {
    document.body.classList.add("sim-cockpit-active");

    const cirSel = getEl("fsim-circuit-sel");
    if (cirSel && CIRCUITS.length) {
      cirSel.innerHTML = CIRCUITS.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.country)} · ${c.length_km}km${c.is_night ? " 🌙" : ""})</option>`).join("");
    }

    getEl("fsim-start-btn")?.addEventListener("click", startNewBroadcast);
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
    getEl("fsim-voice-btn")?.addEventListener("click", () => {
      fs.voiceOn = !fs.voiceOn;
      const vb = getEl("fsim-voice-btn");
      if (vb) vb.classList.toggle("is-on", fs.voiceOn);
      if (!fs.voiceOn && window.speechSynthesis) window.speechSynthesis.cancel();
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
    document.querySelectorAll("[data-fsim-cam]").forEach((btn) => {
      btn.addEventListener("click", () => setCamMode(btn.dataset.fsimCam, false));
    });
    document.querySelectorAll("[data-fsim-gap]").forEach((btn) => {
      btn.addEventListener("click", () => {
        fs.gapMode = btn.dataset.fsimGap;
        document.querySelectorAll("[data-fsim-gap]").forEach((b) => b.classList.toggle("active", b === btn));
        const hd = getEl("fsim-gap-head");
        if (hd) hd.textContent = fs.gapMode.toUpperCase();
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
      else if (k === "r") {
        if (fs.replay.active) stopInstantReplay();
        else startInstantReplay({ focusIdx: fs.focusIdx });
      }
      else if (k === "escape" && fs.replay.active) stopInstantReplay();
      else if (k === "t") setAutoTv(!fs.autoTv);
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

    fs.rafId = requestAnimationFrame(loop);
    startNewBroadcast();
  }

  init();
})();
