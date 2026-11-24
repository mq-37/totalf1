(function () {
  "use strict";

  const BOOT = window.F1_ARENA_BOOT || { latestYear: 2026, tracks: [], battleStats: [] };
  const BATTLE_STATS = BOOT.battleStats || [];
  const TRACKS = BOOT.tracks || [];
  const deckCache = new Map();

  // Shared synthesized Web Audio F1 SFX engine (static/js/f1_sfx.js)
  const sfx = window.F1Sfx || {
    enabled: false,
    toggle() { return false; },
    lightsOut() {}, ersArm() {}, engineSurge() {}, winLap() {}, loseLap() {}, click() {}, radioAlert() {},
  };

  function updateSfxBtn() {
    const btn = document.getElementById("sfx-toggle-btn");
    if (!btn) return;
    btn.innerHTML = sfx.enabled
      ? `<i class="fas fa-volume-up"></i> <span>SFX On</span>`
      : `<i class="fas fa-volume-mute"></i> <span>SFX Off</span>`;
  }
  updateSfxBtn();
  const sfxBtn = document.getElementById("sfx-toggle-btn");
  if (sfxBtn) {
    sfxBtn.addEventListener("click", () => {
      sfx.toggle();
      updateSfxBtn();
      if (sfx.enabled) sfx.click();
    });
  }

  // =========================================================================
  // HELPERS
  // =========================================================================
  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function fetchDeck(spec) {
    if (deckCache.has(spec)) return deckCache.get(spec);
    const [src, val] = spec.split(":");
    let url = `/api/game/deck?source=${encodeURIComponent(src)}`;
    if (src === "season" && val) url += `&year=${encodeURIComponent(val)}`;
    if (src === "decade" && val) url += `&decade=${encodeURIComponent(val)}`;
    if (src === "alltime" && val && Number(val) > 0) url += `&limit=${encodeURIComponent(val)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load deck (${res.status})`);
    const data = await res.json();
    deckCache.set(spec, data);
    return data;
  }

  function buildSpineGradient(cols) {
    const list = cols && cols.length ? cols : ["#475569"];
    if (list.length === 1) return list[0];
    return `linear-gradient(180deg, ${list.join(", ")})`;
  }

  function driverInitials(name) {
    const parts = (name || "F1").trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return (name || "F1").slice(0, 2).toUpperCase();
  }

  function renderPortrait(card, blurred) {
    const blurCls = blurred ? " is-blurred" : "";
    if (card.driver_image) {
      return `<img class="gc-portrait${blurCls}" src="/${esc(card.driver_image)}" alt="${esc(card.clean_name)}" loading="lazy">`;
    }
    return `<div class="gc-portrait gc-monogram${blurCls}" style="--accent:${esc(card.hero_color)}"><span>${esc(driverInitials(card.clean_name))}</span><small>${esc(card.code3 || card.nationality || "F1")}</small></div>`;
  }

  function renderCarImg(slug, alt) {
    if (!slug) return `<div class="gc-car-empty">No 3D livery</div>`;
    return `<img class="gc-car-img" src="/static/cars/png/${esc(slug)}.png?v=20261124k" alt="${esc(alt)}" loading="lazy">`;
  }

  // =========================================================================
  // THREE.JS LIVE 3D TRACK SHOWDOWN INSTANCE + SCENE / CAMERA / DRAWERS
  // =========================================================================
  const arena3dWrap = document.getElementById("arena-3d-wrap");
  const arena3dCanvas = document.getElementById("arena-3d-canvas");
  const arena3d = window.PlayArena3D ? new window.PlayArena3D(arena3dCanvas) : null;
  if (!arena3d || !arena3d.ok) {
    if (arena3dWrap) arena3dWrap.classList.add("is-fallback");
  }

  let currentMode = "duel";
  let manualSceneOverride = false;
  let battleTelemTimer = null;

  function syncSceneButtons(sceneId) {
    document.querySelectorAll("#arena-3d-wrap .hud-scene").forEach((b) => {
      b.classList.toggle("active", b.dataset.scene === sceneId);
    });
  }

  document.querySelectorAll("#arena-3d-wrap .hud-cam").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#arena-3d-wrap .hud-cam").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (arena3d) arena3d.setCamera(btn.dataset.cam);
      sfx.click();
    });
  });

  document.querySelectorAll("#arena-3d-wrap .hud-scene").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sid = btn.dataset.scene;
      manualSceneOverride = true;
      syncSceneButtons(sid);
      if (arena3d) arena3d.setScene(sid, true);
      const sc = window.PlayArena3D && window.PlayArena3D.SCENES && window.PlayArena3D.SCENES[sid];
      if (sc) showTrackEvent(`📍 3D SCENE: ${sc.label.toUpperCase()} — ${sc.subtitle.toUpperCase()}`, "info");
      sfx.click();
    });
  });

  // Setup & Telemetry Log floating drawers + Cards Toggle + Focus Mode
  const setupDrawer = document.getElementById("duel-setup-drawer");
  const setupToggle = document.getElementById("duel-setup-toggle");
  const logDrawer = document.getElementById("duel-log-drawer");
  const logToggle = document.getElementById("duel-log-toggle");

  function closeDuelDrawers() {
    if (setupDrawer) setupDrawer.classList.add("hidden");
    if (setupToggle) { setupToggle.setAttribute("aria-expanded", "false"); setupToggle.classList.remove("is-active"); }
    if (logDrawer) logDrawer.classList.add("hidden");
    if (logToggle) { logToggle.setAttribute("aria-expanded", "false"); logToggle.classList.remove("is-active"); }
  }

  if (setupToggle && setupDrawer) {
    setupToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = setupDrawer.classList.contains("hidden");
      closeDuelDrawers();
      if (willOpen) {
        setupDrawer.classList.remove("hidden");
        setupToggle.setAttribute("aria-expanded", "true");
        setupToggle.classList.add("is-active");
      }
      sfx.click();
    });
  }
  const setupClose = document.getElementById("duel-setup-close");
  if (setupClose) setupClose.addEventListener("click", closeDuelDrawers);

  if (logToggle && logDrawer) {
    logToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = logDrawer.classList.contains("hidden");
      closeDuelDrawers();
      if (willOpen) {
        logDrawer.classList.remove("hidden");
        logToggle.setAttribute("aria-expanded", "true");
        logToggle.classList.add("is-active");
      }
      sfx.click();
    });
  }
  const logClose = document.getElementById("duel-log-close");
  if (logClose) logClose.addEventListener("click", closeDuelDrawers);

  document.addEventListener("click", (e) => {
    if (setupDrawer && !setupDrawer.classList.contains("hidden") && !setupDrawer.contains(e.target) && e.target !== setupToggle) {
      closeDuelDrawers();
    }
    if (logDrawer && !logDrawer.classList.contains("hidden") && !logDrawer.contains(e.target) && e.target !== logToggle) {
      closeDuelDrawers();
    }
  });

  const cardsToggleBtn = document.getElementById("duel-cards-toggle");
  function toggleCardsDock() {
    if (!arena3dWrap) return;
    const hidden = arena3dWrap.classList.toggle("cards-hidden");
    if (cardsToggleBtn) {
      cardsToggleBtn.setAttribute("aria-pressed", hidden ? "false" : "true");
      cardsToggleBtn.classList.toggle("is-active", hidden);
    }
    sfx.click();
  }
  if (cardsToggleBtn) cardsToggleBtn.addEventListener("click", toggleCardsDock);

  const focusBtn = document.getElementById("duel-focus-btn");
  function toggleDuelFocus() {
    const on = document.body.classList.toggle("duel-focus-mode");
    if (focusBtn) {
      focusBtn.classList.toggle("is-active", on);
      focusBtn.innerHTML = on ? `<i class="fas fa-compress"></i>` : `<i class="fas fa-expand"></i>`;
    }
    if (arena3d) setTimeout(() => arena3d.resize(), 40);
    sfx.click();
  }
  if (focusBtn) focusBtn.addEventListener("click", toggleDuelFocus);

  const quickRestartBtn = document.getElementById("duel-quick-restart");
  if (quickRestartBtn) {
    quickRestartBtn.addEventListener("click", () => {
      closeDuelDrawers();
      sfx.lightsOut();
      startDuelMatch();
    });
  }

  // =========================================================================
  // TAB SWITCHING (automatically pauses 3D GPU loop when off Duel tab!)
  // =========================================================================
  const modeTabs = document.querySelectorAll("[data-arena-mode]");
  const panels = {
    duel: document.getElementById("panel-duel"),
    sim: document.getElementById("panel-sim"),
    spine: document.getElementById("panel-spine"),
    hilo: document.getElementById("panel-hilo"),
  };
  let simBooted = false;
  let spineBooted = false;
  let hiloBooted = false;

  function switchMode(mode) {
    currentMode = mode;
    closeDuelDrawers();
    modeTabs.forEach((btn) => {
      const on = btn.dataset.arenaMode === mode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    Object.entries(panels).forEach(([k, el]) => {
      if (el) el.classList.toggle("active", k === mode);
    });
    document.body.classList.toggle("duel-arena-active", mode === "duel");
    document.body.classList.toggle("sim-cockpit-active", mode === "sim");
    if (mode !== "duel") document.body.classList.remove("duel-focus-mode");
    if (arena3d) {
      arena3d.setPaused(mode !== "duel");
      if (mode === "duel") requestAnimationFrame(() => arena3d.resize());
    }
    if (window.setTrackSimVisible) window.setTrackSimVisible(mode === "sim");
    if (mode === "sim" && !simBooted && window.initTrackSimulator) {
      simBooted = true;
      window.initTrackSimulator();
    }
    if (mode === "spine" && !spineBooted) {
      spineBooted = true;
      initSpinePuzzle();
    }
    if (mode === "hilo" && !hiloBooted) {
      hiloBooted = true;
      initHiLo();
    }
  }

  modeTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      sfx.click();
      switchMode(btn.dataset.arenaMode);
    });
  });

  // =========================================================================
  // MODE 1: TOP TRUMPS GRAND PRIX (3-CARD HAND + TYRES + ERS + SAFETY CAR + 3D)
  // =========================================================================
  const TYRES = {
    soft: { label: "SOFT", hint: "+8 PACE · +5 RACECRAFT · +4% DNF risk" },
    medium: { label: "MEDIUM", hint: "Balanced grip — zero penalties" },
    hard: { label: "HARD", hint: "+8 RELIABILITY · ÷2 DNF% · -4 PACE · +25% ERS harvest" },
  };

  const duelState = {
    p1Draw: [],
    p2Draw: [],
    p1Hand: [], // Active 3-card garage hand!
    p2Hand: [],
    p1SelectedIdx: 0,
    p2SelectedIdx: 0,
    round: 0,
    totalRounds: 7,
    p1Score: 0,
    p2Score: 0,
    turn: "p1",
    opponent: "ai",
    useTracks: true,
    activeTrack: null,
    safetyCarActive: false,
    // Strategy state (Tyres & ERS)
    tyre: "medium",
    tyreStock: { soft: 2, hard: 2 },
    ers: 50,
    ersArmed: false,
    pendingStat: "pace", // Stat currently highlighted on quick-launch bar
    aiCalledStat: null,  // When AI has turn, AI announces its stat and lets player counter-pick!
    battling: false,     // True during live 2.6s 3D battle animation
    revealed: false,
    chosenStat: null,
    finished: false,
  };

  function bestDefaultStatForCard(card) {
    if (!card) return "pace";
    const trk = duelState.useTracks ? duelState.activeTrack : null;
    let bestKey = "pace";
    let bestScore = -999;
    for (const st of BATTLE_STATS) {
      const v = card.game.stats[st.key];
      let sc = st.dir === "low" ? (100 - v * 2.2) : v;
      if (trk && trk.boost_stat === st.key) sc += (trk.boost_delta || 8);
      if (card.game.ability.active_bonus_stat === st.key) sc += card.game.ability.active_bonus_val;
      if (sc > bestScore) { bestScore = sc; bestKey = st.key; }
    }
    return bestKey;
  }

  function getActiveP1() {
    return duelState.p1Hand[duelState.p1SelectedIdx] || duelState.p1Hand[0];
  }
  function getActiveP2() {
    return duelState.p2Hand[duelState.p2SelectedIdx] || duelState.p2Hand[0];
  }

  function computeEffectiveValue(card, opponentCard, statKey, track, trailScoreDiff, stratOpts) {
    const base = Number(card.game.stats[statKey]);
    const isLow = statKey === "dnf_rate";
    let eff = base;
    const bonuses = [];
    const ab = card.game.ability;

    // 1. Track & Weather modifiers
    if (track) {
      if (track.boost_stat === statKey && track.boost_delta > 0 && !isLow) {
        eff += track.boost_delta;
        bonuses.push(`${track.name} +${track.boost_delta}`);
      } else if (track.id === "singapore" && statKey === "reliability") {
        eff += 8;
        bonuses.push(`Marina Bay +8`);
      }
      if (statKey === "wet" && (track.weather === "WET" || track.weather === "CHAOS")) {
        const wBoost = track.weather === "WET" ? 10 : 5;
        eff += wBoost;
        bonuses.push(`${track.weather === "WET" ? "Full Wet" : "Mixed Rain"} +${wBoost}`);
      }
      if (track.underdog_bonus > 0 && Number(card.overall) < 78) {
        if (isLow) {
          eff = Math.max(0, +(eff - track.underdog_bonus * 0.4).toFixed(1));
          bonuses.push(`Wet Underdog -${(track.underdog_bonus * 0.4).toFixed(1)}%`);
        } else {
          eff += track.underdog_bonus;
          bonuses.push(`Chaos Underdog +${track.underdog_bonus}`);
        }
      }
    }

    // 2. Tyre Compound Modifiers
    if (stratOpts && stratOpts.tyre) {
      const ty = stratOpts.tyre;
      if (ty === "soft") {
        if (statKey === "pace") { eff += 8; bonuses.push("Soft Tyre +8"); }
        else if (statKey === "racecraft") { eff += 5; bonuses.push("Soft Tyre +5"); }
        else if (statKey === "tyre_care") { eff = Math.max(20, eff - 3); bonuses.push("Soft Deg -3"); }
        else if (isLow) { eff = +(eff + 4.0).toFixed(1); bonuses.push("Soft Wear +4%"); }
      } else if (ty === "hard") {
        if (statKey === "reliability" || statKey === "tyre_care") { eff += 8; bonuses.push("Hard Tyre +8"); }
        else if (isLow) { eff = +(eff * 0.5).toFixed(1); bonuses.push("Hard Tyre ÷2"); }
        else if (statKey === "pace") { eff = Math.max(20, eff - 4); bonuses.push("Hard Tyre -4"); }
      }
    }

    // 3. ERS Battery Overtake Boost (+10 / -5% DNF)
    if (stratOpts && stratOpts.ersArmed) {
      if (isLow) {
        eff = Math.max(0, +(eff - 5.0).toFixed(1));
        bonuses.push("⚡ ERS -5%");
      } else {
        eff += 10;
        bonuses.push("⚡ ERS Overtake +10");
      }
    }

    // 4. Safety Car Compression (+8 to trailing player!)
    if (duelState.safetyCarActive && trailScoreDiff < 0) {
      if (isLow) {
        eff = Math.max(0, +(eff - 4.0).toFixed(1));
        bonuses.push("Safety Car -4%");
      } else {
        eff += 8;
        bonuses.push("Safety Car +8");
      }
    }

    // 5. Pit Wall Ability triggers
    if (ab) {
      if (ab.key === "giant_killer" && opponentCard.game.is_champion) {
        if (isLow) { eff = Math.max(0, +(eff - 5).toFixed(1)); bonuses.push("Giant Killer -5%"); }
        else { eff += 12; bonuses.push("Giant Killer +12"); }
      } else if (ab.key === "slipstream" && Number(opponentCard.overall) >= 82) {
        if (isLow) { eff = Math.max(0, +(eff - 4).toFixed(1)); bonuses.push("Slipstream -4%"); }
        else { eff += 10; bonuses.push("Slipstream +10"); }
      } else if (ab.key === "drs_overtake" && statKey === "pace") {
        eff += 6; bonuses.push("DRS Overtake +6");
      } else if (ab.key === "undercut" && statKey === "duels") {
        eff += 8; bonuses.push("Undercut +8");
      } else if (ab.key === "championship_aura" && statKey === "clutch") {
        eff += 5; bonuses.push("Champion Aura +5");
      } else if (ab.key === "rain_master") {
        const isRainy = track && (track.weather === "WET" || track.weather === "CHAOS");
        if (statKey === "wet") { eff += isRainy ? 8 : 4; bonuses.push(`Rain Master +${isRainy ? 8 : 4}`); }
        else if (statKey === "racecraft" && isRainy) { eff += 6; bonuses.push("Rain Master +6"); }
      } else if (ab.key === "tyre_whisperer") {
        if (statKey === "tyre_care") { eff += 8; bonuses.push("Tyre Whisperer +8"); }
        else if (statKey === "reliability") { eff += 6; bonuses.push("Tyre Whisperer +6"); }
        else if (isLow) { eff = +(eff * 0.5).toFixed(1); bonuses.push("Tyre Whisperer ÷2"); }
      } else if (ab.key === "late_braker" && statKey === "racecraft" && trailScoreDiff <= 0) {
        eff += 7; bonuses.push("Late Braker +7");
      }
    }

    return { base, eff: isLow ? +eff.toFixed(1) : Math.round(eff), bonuses };
  }

  function showTrackEvent(text, kind) {
    const el = document.getElementById("arena-3d-event");
    if (!el) return;
    if (!text) {
      el.classList.add("hidden");
      return;
    }
    el.className = `arena-3d-event ev-${kind || "info"}`;
    el.innerHTML = text;
  }

  function renderPitWallConsole() {
    const handEl = document.getElementById("duel-hand-picker");
    const isAiDefense = (duelState.opponent === "ai" && duelState.turn === "p2");
    const canPrep = !duelState.revealed && !duelState.battling && !duelState.finished && (duelState.turn === "p1" || isAiDefense);
    const canChooseStat = !duelState.revealed && !duelState.battling && !duelState.finished && !isAiDefense;
    const activeCard = (duelState.opponent === "p2" && duelState.turn === "p2") ? getActiveP2() : getActiveP1();

    handEl.innerHTML = duelState.p1Hand.map((card, i) => {
      const sel = i === duelState.p1SelectedIdx;
      return `
        <button type="button" class="pw-hand-card${sel ? " is-active" : ""}" data-hand-idx="${i}" ${canPrep ? "" : "disabled"} style="--hcol:${esc(card.hero_color)}">
          <span class="pw-hc-top">
            <strong>${esc(card.clean_name)}</strong>
            <span class="pw-hc-ovr">${Math.round(card.overall)}</span>
          </span>
          <span class="pw-hc-sub">${esc(card.hero_team)} · ${esc(card.game.ability.name)}</span>
          <span class="pw-hc-mini">PAC ${card.game.stats.pace} · RC ${card.game.stats.racecraft} · REL ${card.game.stats.reliability}</span>
        </button>
      `;
    }).join("");

    handEl.querySelectorAll(".pw-hand-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!canPrep) return;
        duelState.p1SelectedIdx = Number(btn.dataset.handIdx);
        if (!isAiDefense) duelState.pendingStat = bestDefaultStatForCard(getActiveP1());
        sfx.click();
        updateDuelUI(null, null, null);
      });
    });

    // Tyres
    document.getElementById("tyre-qty-soft").textContent = `×${duelState.tyreStock.soft}`;
    document.getElementById("tyre-qty-hard").textContent = `×${duelState.tyreStock.hard}`;
    document.getElementById("tyre-effect-hint").textContent = TYRES[duelState.tyre].hint;

    document.querySelectorAll(".tyre-btn").forEach((btn) => {
      const ty = btn.dataset.tyre;
      const outOfStock = (ty === "soft" && duelState.tyreStock.soft <= 0) || (ty === "hard" && duelState.tyreStock.hard <= 0);
      btn.classList.toggle("active", duelState.tyre === ty);
      btn.disabled = !canPrep || outOfStock;
    });

    // ERS Battery
    document.getElementById("ers-pct-label").textContent = `${duelState.ers}%`;
    document.getElementById("ers-meter-fill").style.width = `${duelState.ers}%`;
    const ersBtn = document.getElementById("ers-arm-btn");
    ersBtn.disabled = !canPrep || (duelState.ers < 50 && !duelState.ersArmed);
    ersBtn.classList.toggle("is-armed", duelState.ersArmed);
    ersBtn.innerHTML = duelState.ersArmed
      ? `<i class="fas fa-bolt"></i> ERS ARMED (+10 ACTIVE!) — Click to Disarm`
      : `<i class="fas fa-bolt"></i> ARM OVERTAKE (+10 · Costs 50%)`;

    // Quick Stat Selector Pills + Giant LAUNCH BATTLE button
    const pillsEl = document.getElementById("pw-stat-pills");
    const launchBtn = document.getElementById("duel-launch-btn");
    const launchHeading = document.getElementById("pw-launch-heading");
    const launchSub = document.getElementById("pw-launch-sub");

    const activeStat = isAiDefense && duelState.aiCalledStat ? duelState.aiCalledStat : duelState.pendingStat;
    if (isAiDefense && duelState.aiCalledStat) {
      const sdef = BATTLE_STATS.find((s) => s.key === duelState.aiCalledStat) || { label: duelState.aiCalledStat };
      launchHeading.innerHTML = `<i class="fas fa-shield-alt"></i> AI CHALLENGES YOU ON: ${esc(sdef.label)}!`;
      launchSub.textContent = "Counter-pick your best defender, tyres & ERS — then click DEFEND & RACE!";
    } else {
      launchHeading.innerHTML = `<i class="fas fa-flag-checkered"></i> 4. PICK BATTLE STAT &amp; RACE!`;
      launchSub.textContent = "Pick a stat pill & hit LAUNCH BATTLE (or click any stat bar on your card)";
    }

    const STAT_SHORT = { pace: "PAC", racecraft: "RC", reliability: "CON", duels: "DUL", clutch: "CLU", wet: "WET", tyre_care: "TYR", dnf_rate: "DNF" };
    pillsEl.innerHTML = BATTLE_STATS.map((st) => {
      const val = activeCard ? activeCard.game.stats[st.key] : 0;
      const valStr = st.dir === "low" ? `${val.toFixed(0)}%` : `${val}`;
      const picked = activeStat === st.key;
      const shortLbl = STAT_SHORT[st.key] || st.label;
      return `
        <button type="button" class="pw-stat-pill${picked ? " is-picked" : ""}" data-qstat="${esc(st.key)}" title="${esc(st.label)}: ${valStr}" ${canChooseStat ? "" : "disabled"}>
          <span>${st.dir === "low" ? "▼" : "▲"}${esc(shortLbl)}</span>
          <b>${valStr}</b>
        </button>
      `;
    }).join("");

    pillsEl.querySelectorAll(".pw-stat-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!canChooseStat) return;
        duelState.pendingStat = btn.dataset.qstat;
        sfx.click();
        renderPitWallConsole();
      });
    });

    if (duelState.battling) {
      launchBtn.disabled = true;
      launchBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> RACING ON TRACK…`;
    } else if (duelState.revealed) {
      launchBtn.disabled = false;
      launchBtn.innerHTML = duelState.finished
        ? `<i class="fas fa-redo"></i> REMATCH`
        : `<i class="fas fa-arrow-right"></i> NEXT LAP`;
    } else if (isAiDefense) {
      launchBtn.disabled = false;
      launchBtn.innerHTML = `<i class="fas fa-shield-alt"></i> DEFEND &amp; RACE!`;
    } else {
      launchBtn.disabled = false;
      const sdef = BATTLE_STATS.find((s) => s.key === activeStat) || { label: "PACE" };
      launchBtn.innerHTML = `<i class="fas fa-flag-checkered"></i> RACE ON ${esc(sdef.label)}!`;
    }
  }

  document.getElementById("duel-launch-btn").addEventListener("click", () => {
    if (duelState.battling) return;
    if (duelState.revealed) {
      advanceDuelLap();
      return;
    }
    const statToPlay = (duelState.opponent === "ai" && duelState.turn === "p2" && duelState.aiCalledStat)
      ? duelState.aiCalledStat
      : (duelState.pendingStat || "pace");
    resolveDuelLap(statToPlay);
  });

  document.getElementById("bh-next-btn").addEventListener("click", advanceDuelLap);

  document.querySelectorAll(".tyre-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (duelState.revealed || duelState.finished) return;
      duelState.tyre = btn.dataset.tyre;
      if (arena3d) arena3d.setTyreCompound("p1", duelState.tyre);
      sfx.click();
      renderPitWallConsole();
    });
  });

  document.getElementById("ers-arm-btn").addEventListener("click", () => {
    if (duelState.revealed || duelState.finished) return;
    if (!duelState.ersArmed && duelState.ers < 50) return;
    duelState.ersArmed = !duelState.ersArmed;
    if (arena3d) arena3d.setErsArmed(duelState.ersArmed);
    if (duelState.ersArmed) sfx.ersArm();
    else sfx.click();
    renderPitWallConsole();
  });

  function renderTrackBanner(track) {
    const el = document.getElementById("duel-track-banner");
    if (!track || !duelState.useTracks) {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    el.style.setProperty("--track-accent", track.accent);
    el.innerHTML = `
      <div class="tb-left">
        <span class="tb-weather">${esc(track.weather_label)}</span>
        <strong class="tb-name">${esc(track.name)}</strong>
        <span class="tb-sub">${esc(track.subtitle)}</span>
      </div>
      <div class="tb-rule"><i class="fas fa-bolt"></i> ${esc(track.rule)}</div>
    `;
  }

  function renderDuelCard(card, side, opts) {
    const { hiddenFace, canClick, statHighlight, effMap, winnerSide } = opts;
    const isChamp = card.game.is_champion;
    if (hiddenFace) {
      return `
        <div class="gc-card gc-back-face">
          <div class="gc-back-emblem">
            <i class="fas fa-flag-checkered"></i>
            <strong>${side === "p2" && duelState.opponent === "ai" ? "AI ENGINEER" : side.toUpperCase()}</strong>
            <span>${duelState.opponent === "p2" ? "Hidden until stat call" : "Stealth car on track — call a stat to reveal!"}</span>
          </div>
        </div>
      `;
    }

    const winCls = winnerSide === side ? " is-winner" : (winnerSide && winnerSide !== "tie" ? " is-loser" : "");
    const champCls = isChamp ? " is-champ" : "";
    const g = card.game;
    const ab = g.ability;

    const statRows = BATTLE_STATS.map((st) => {
      const val = g.stats[st.key];
      const isLow = st.dir === "low";
      const isSelected = statHighlight === st.key;
      const pct = isLow ? Math.min(100, Math.max(4, (val / 45) * 100)) : Math.min(100, Math.max(6, (val / 99) * 100));
      const barCol = isLow ? (val <= 10 ? "#16a34a" : val <= 24 ? "#d97706" : "#dc2626") : st.color;
      const effInfo = effMap && effMap[st.key];
      const bonusHtml = effInfo && effInfo.bonuses.length
        ? `<span class="gc-bonus-tag">${esc(effInfo.bonuses.join(" · "))} → <b>${isLow ? effInfo.eff + "%" : effInfo.eff}</b></span>`
        : "";
      const clickableCls = canClick ? " is-clickable" : "";
      const selCls = isSelected ? " is-selected" : "";
      return `
        <button type="button" class="gc-stat-row${clickableCls}${selCls}" ${canClick ? "" : "disabled"} data-stat="${esc(st.key)}" data-side="${side}">
          <span class="gc-stat-lbl">
            <em class="gc-dir ${isLow ? "dir-low" : "dir-high"}">${isLow ? "▼" : "▲"}</em>
            ${esc(st.label)}
            ${isLow ? '<span class="gc-low-pill">LOW</span>' : ""}
          </span>
          <span class="gc-stat-bar-wrap">
            <span class="gc-stat-bar" style="width:${pct}%;background:${barCol}"></span>
          </span>
          <span class="gc-stat-val">${isLow ? val.toFixed(1) + "%" : val}</span>
          ${bonusHtml}
        </button>
      `;
    }).join("");

    return `
      <div class="gc-card${champCls}${winCls}" style="--team:${esc(card.hero_color)}">
        <div class="gc-spine" style="background:${buildSpineGradient(card.spine_colors)}">
          <span>#${card.rank}</span>
        </div>
        <div class="gc-body">
          <div class="gc-header">
            <div class="gc-head-left">
              <div class="gc-micro">
                <span class="gc-rank-pill">#${card.rank}</span>
                ${card.code3 ? `<span class="gc-code-pill">${esc(card.code3)}</span>` : ""}
                <span class="gc-meta">${esc(card.nationality)} · ${esc(card.years_active)}</span>
              </div>
              <h3 class="gc-name">${esc(card.clean_name)}</h3>
            </div>
            <div class="gc-head-badges">
              <div class="gc-cost-pill"><small>COST</small><b>$${g.cost_m}M</b></div>
              <div class="gc-ovr-pill"><small>OVR</small><b>${Math.round(card.overall)}</b></div>
            </div>
          </div>

          <div class="gc-stage">
            ${renderPortrait(card, false)}
            <div class="gc-car-stage">
              ${renderCarImg(card.hero_car_slug, card.hero_team)}
              <span class="gc-team-cap"><i style="background:${esc(card.hero_color)}"></i>${esc(card.hero_team || "Constructor")}</span>
            </div>
          </div>

          <div class="gc-mini-kpis">
            <div><b>${card.wins}</b><span>WINS</span></div>
            <div><b>${card.podiums}</b><span>PODIUMS</span></div>
            <div><b>${g.telemetry && g.telemetry.poles != null ? g.telemetry.poles : card.fastest_laps}</b><span>${g.telemetry && g.telemetry.poles != null ? "POLES" : "FASTEST"}</span></div>
            <div><b>${card.starts}</b><span>STARTS</span></div>
          </div>

          ${(() => {
            const tel = g.telemetry || {};
            const pills = [];
            if (tel.quali_h2h_pct != null) pills.push(`<span title="F1DB Qualifying Head-to-Head vs Teammates">Q-H2H <b>${tel.quali_h2h_pct}%</b></span>`);
            if (tel.race_h2h_pct != null) pills.push(`<span title="F1DB Race Finish Head-to-Head vs Teammates (excl. mech DNFs)">R-H2H <b>${tel.race_h2h_pct}%</b></span>`);
            if (tel.avg_pos_gained != null) pills.push(`<span title="Average Grid-to-Finish Positions Gained">ΔPOS <b>${tel.avg_pos_gained >= 0 ? "+" : ""}${tel.avg_pos_gained}</b></span>`);
            if (tel.mech_dnf_pct != null) pills.push(`<span title="Driver-Fault DNF% vs Mechanical DNF% (Mechanical DNFs excluded from driver penalty)">MECH <b>${tel.mech_dnf_pct}%</b></span>`);
            if (g.car_strength_est != null) pills.push(`<span title="Machinery-adjusted Car Strength Estimate vs Pure Driver Skill">CAR <b>${Math.round(g.car_strength_est)}</b></span>`);
            return pills.length ? `<div class="gc-f1db-ev">${pills.join("")}</div>` : "";
          })()}

          <div class="gc-stats-list">${statRows}</div>

          <div class="gc-ability" style="--ab-col:${esc(ab.accent)}">
            <div class="gc-ab-top">
              <strong>PIT WALL: ${esc(ab.name)}</strong>
              <span class="gc-ab-badge">${esc(ab.badge)}</span>
            </div>
            <p>${esc(ab.summary)}</p>
            ${card.championships > 0 ? `<div class="gc-wdc-line">★ ${card.championships}× World Champion (${card.champion_years.join(", ")})</div>` : ""}
          </div>
        </div>
      </div>
    `;
  }

  function updateDuelUI(winnerSide, p1Eff, p2Eff) {
    const p1Card = getActiveP1();
    const p2Card = getActiveP2();
    if (!p1Card || !p2Card) return;

    document.getElementById("duel-p1-score").textContent = duelState.p1Score;
    document.getElementById("duel-p2-score").textContent = duelState.p2Score;
    document.getElementById("duel-p1-name").textContent = duelState.opponent === "p2" ? "PLAYER 1" : "YOU";
    document.getElementById("duel-p2-name").textContent = duelState.opponent === "p2" ? "PLAYER 2" : "AI ENGINEER";
    document.getElementById("duel-round-label").textContent = `LAP ${duelState.round + 1} / ${duelState.totalRounds}`;

    const turnEl = document.getElementById("duel-turn-label");
    if (duelState.finished) {
      turnEl.textContent = "CHEQUERED FLAG!";
    } else if (duelState.battling) {
      turnEl.textContent = "LIGHTS OUT — WHEEL-TO-WHEEL BATTLE IN PROGRESS!";
    } else if (duelState.revealed) {
      turnEl.textContent = "LAP COMPLETE — HIT NEXT LAP TO CONTINUE";
    } else if (duelState.opponent === "ai" && duelState.turn === "p2" && duelState.aiCalledStat) {
      const sdef = BATTLE_STATS.find((s) => s.key === duelState.aiCalledStat) || { label: duelState.aiCalledStat };
      turnEl.textContent = `AI CHALLENGES YOU ON ${sdef.label}! PICK YOUR DEFENDER & HIT DEFEND & RACE!`;
    } else if (duelState.turn === "p1") {
      turnEl.textContent = "PICK DRIVER, TYRES & ERS — THEN CLICK RACE OR ANY STAT!";
    } else {
      turnEl.textContent = "PLAYER 2 CALL — PICK A STAT & LAUNCH BATTLE";
    }

    renderTrackBanner(duelState.activeTrack);
    renderPitWallConsole();

    const p1Hide = !duelState.revealed && !duelState.battling && duelState.opponent === "p2" && duelState.turn === "p2";
    const p2Hide = !duelState.revealed && (duelState.opponent === "ai" || duelState.turn === "p1");
    const p1CanClick = !duelState.revealed && !duelState.battling && duelState.turn === "p1";
    const p2CanClick = !duelState.revealed && !duelState.battling && duelState.opponent === "p2" && duelState.turn === "p2";

    // Sync Live 3D Three.js Track Cars & HUD!
    const p1Tag = document.getElementById("hud-p1-tag");
    const p2Tag = document.getElementById("hud-p2-tag");
    if (p1Tag) p1Tag.textContent = p1Hide ? "STEALTH P1" : `${p1Card.clean_name} · ${p1Card.hero_team}`;
    if (p2Tag) p2Tag.textContent = p2Hide ? "STEALTH RIVAL" : `${p2Card.clean_name} · ${p2Card.hero_team}`;
    if (arena3d && !duelState.battling) {
      arena3d.setCars(p1Card, p2Card, p2Hide);
      arena3d.setTyreCompound("p1", duelState.tyre);
      if (duelState.useTracks && duelState.activeTrack) {
        if (!manualSceneOverride) {
          arena3d.setSceneForTrack(duelState.activeTrack.id, duelState.activeTrack.weather);
          syncSceneButtons(arena3d.sceneId);
        } else {
          arena3d.setWeather(duelState.activeTrack.weather);
        }
      } else {
        arena3d.setWeather("DRY");
      }
      arena3d.setErsArmed(duelState.ersArmed && !duelState.revealed);
    }

    const p1EffMap = duelState.revealed && duelState.chosenStat ? { [duelState.chosenStat]: p1Eff } : null;
    const p2EffMap = duelState.revealed && duelState.chosenStat ? { [duelState.chosenStat]: p2Eff } : null;

    document.getElementById("duel-card-p1").innerHTML = renderDuelCard(p1Card, "p1", {
      hiddenFace: p1Hide,
      canClick: p1CanClick,
      statHighlight: duelState.chosenStat || duelState.aiCalledStat,
      effMap: p1EffMap,
      winnerSide,
    });
    document.getElementById("duel-card-p2").innerHTML = renderDuelCard(p2Card, "p2", {
      hiddenFace: p2Hide,
      canClick: p2CanClick,
      statHighlight: duelState.chosenStat || duelState.aiCalledStat,
      effMap: p2EffMap,
      winnerSide,
    });

    document.querySelectorAll(".gc-stat-row.is-clickable").forEach((btn) => {
      btn.addEventListener("click", () => {
        duelState.pendingStat = btn.dataset.stat;
        resolveDuelLap(btn.dataset.stat);
      });
    });
  }

  const MANEUVER_META = {
    divebomb:     { badge: "LATE DIVE-BOMB",    braking: "🔥 150m → 50m HEAVY BRAKING! LATE DIVE DOWN THE INSIDE!", apex: "CLAIMS THE INSIDE APEX KERB & POWERS OUT!" },
    slipstream:   { badge: "DRS / ERS BLITZ",   braking: "⚡ 340 KPH SLIPSTREAM SLINGSHOT INTO THE BRAKING ZONE!", apex: "BLASTS AROUND THE OUTSIDE & OWNS THE EXIT!" },
    switchback:   { badge: "APEX SWITCHBACK",   braking: "💨 RIVAL OVERSHOOTS WIDE — CUTBACK SWITCHBACK ON THE INSIDE!", apex: "EXECUTES THE OVER-UNDER SWITCHBACK TO PERFECTION!" },
    dnf:          { badge: "RELIABILITY DRAMA", braking: "⚠️ POWER UNIT SMOKE! RIVAL LOSING HYDRAULICS INTO TURN 1!", apex: "CRUISES CLEANLY PAST THE SMOKING RIVAL!" },
    photo_finish: { badge: "PHOTO FINISH",      braking: "🔥 NECK-AND-NECK THROUGH THE BRAKING ZONE — MILLIMETRES APART!", apex: "DEAD HEAT SIDE-BY-SIDE TO THE CHEQUERED FLAG!" },
  };

  function stopBattleTelemLoop() {
    if (battleTelemTimer) {
      clearInterval(battleTelemTimer);
      battleTelemTimer = null;
    }
  }

  function startBattleTelemLoop() {
    stopBattleTelemLoop();
    const kphEl = document.getElementById("bh-kph");
    const gearEl = document.getElementById("bh-gear");
    const gapEl = document.getElementById("bh-gap");
    const drsEl = document.getElementById("bh-drs-pill");
    battleTelemTimer = setInterval(() => {
      if (!arena3d || !duelState.battling) return;
      const t = arena3d.getTelemetry();
      if (!t) return;
      if (kphEl) kphEl.textContent = t.kph;
      if (gearEl) gearEl.textContent = `G${t.gear}`;
      if (gapEl) gapEl.textContent = t.gap;
      if (drsEl) drsEl.classList.toggle("hidden", !t.drs);
    }, 55);
  }

  function resolveDuelLap(statKey) {
    if (duelState.revealed || duelState.battling || duelState.finished) return;
    closeDuelDrawers();
    const p1Card = getActiveP1();
    const p2Card = getActiveP2();
    duelState.chosenStat = statKey;
    duelState.battling = true;
    if (arena3dWrap) arena3dWrap.classList.add("is-battling");

    // Consume finite tyres & ERS if armed
    const p1Tyre = duelState.tyre;
    const p1Ers = duelState.ersArmed;
    if (p1Tyre === "soft" && duelState.tyreStock.soft > 0) duelState.tyreStock.soft -= 1;
    if (p1Tyre === "hard" && duelState.tyreStock.hard > 0) duelState.tyreStock.hard -= 1;
    if (p1Ers) duelState.ers = Math.max(0, duelState.ers - 50);

    const aiTyre = duelState.activeTrack && duelState.activeTrack.boost_stat === "pace" ? "soft"
      : (duelState.activeTrack && duelState.activeTrack.boost_stat === "reliability" ? "hard" : "medium");

    const p1Eff = computeEffectiveValue(p1Card, p2Card, statKey, duelState.useTracks ? duelState.activeTrack : null, duelState.p1Score - duelState.p2Score, { tyre: p1Tyre, ersArmed: p1Ers });
    const p2Eff = computeEffectiveValue(p2Card, p1Card, statKey, duelState.useTracks ? duelState.activeTrack : null, duelState.p2Score - duelState.p1Score, { tyre: aiTyre, ersArmed: false });

    const isLow = statKey === "dnf_rate";
    const statDef = BATTLE_STATS.find((s) => s.key === statKey) || { label: statKey.toUpperCase() };

    let winner = "tie";
    if (isLow) {
      if (p1Eff.eff < p2Eff.eff) winner = "p1";
      else if (p2Eff.eff < p1Eff.eff) winner = "p2";
    } else {
      if (p1Eff.eff > p2Eff.eff) winner = "p1";
      else if (p2Eff.eff > p1Eff.eff) winner = "p2";
    }

    let tieNote = "";
    if (winner === "tie") {
      const p1Tie = ["undercut", "championship_aura"].includes(p1Card.game.ability.key);
      const p2Tie = ["undercut", "championship_aura"].includes(p2Card.game.ability.key);
      if (p1Tie && !p2Tie) { winner = "p1"; tieNote = ` (Tie-break: ${p1Card.game.ability.name})`; }
      else if (p2Tie && !p1Tie) { winner = "p2"; tieNote = ` (Tie-break: ${p2Card.game.ability.name})`; }
    }

    const margin = Math.abs(Number(p1Eff.eff) - Number(p2Eff.eff));

    // Prepare Live On-Track Battle Telemetry HUD!
    const bh = document.getElementById("battle-hud");
    const bhTitle = document.getElementById("bh-stat-title");
    const bhBadge = document.getElementById("bh-maneuver-badge");
    const bhP1Drv = document.getElementById("bh-p1-drv");
    const bhP2Drv = document.getElementById("bh-p2-drv");
    const bhP1Fill = document.getElementById("bh-p1-fill");
    const bhP2Fill = document.getElementById("bh-p2-fill");
    const bhP1Val = document.getElementById("bh-p1-val");
    const bhP2Val = document.getElementById("bh-p2-val");
    const bhP1Bon = document.getElementById("bh-p1-bonuses");
    const bhP2Bon = document.getElementById("bh-p2-bonuses");
    const bhFoot = document.getElementById("bh-footer");
    const bhVerdict = document.getElementById("bh-verdict");
    const bhNext = document.getElementById("bh-next-btn");

    const pctFor = (v) => isLow ? Math.min(100, Math.max(8, (1 - v / 50) * 100)) : Math.min(100, Math.max(8, (v / 125) * 100));
    const fmtV = (v) => isLow ? `${v}%` : `${v}`;

    bhTitle.textContent = `${isLow ? "▼ LOW WINS · " : "▲ "}${statDef.label} SHOWDOWN — LIGHTS OUT!`;
    if (bhBadge) bhBadge.textContent = "LIGHTS OUT";
    bhP1Drv.textContent = p1Card.clean_name;
    bhP2Drv.textContent = "STEALTH RIVAL…";
    bhP1Fill.style.width = `${pctFor(p1Eff.base)}%`;
    bhP2Fill.style.width = "10%";
    bhP1Val.textContent = fmtV(p1Eff.base);
    bhP2Val.textContent = "???";
    bhP1Bon.innerHTML = "";
    bhP2Bon.innerHTML = "";
    bhFoot.classList.add("hidden");
    bh.classList.remove("hidden");

    showTrackEvent("🔴🔴🔴🔴🔴 LIGHTS OUT & WHEEL-TO-WHEEL!", "info");
    sfx.lightsOut();
    sfx.engineSurge();
    renderPitWallConsole();
    startBattleTelemLoop();

    const onRevealPhase = (maneuver) => {
      const mInfo = MANEUVER_META[maneuver] || MANEUVER_META.divebomb;
      if (bhBadge) bhBadge.textContent = mInfo.badge;
      bhTitle.textContent = `${isLow ? "▼ " : "▲ "}${statDef.label} — APPLYING TRACK, TYRE & PIT WALL BONUSES!`;
      bhP2Drv.textContent = p2Card.clean_name;
      const p2Tag = document.getElementById("hud-p2-tag");
      if (p2Tag) p2Tag.textContent = `${p2Card.clean_name} · ${p2Card.hero_team}`;
      bhP1Fill.style.width = `${pctFor(p1Eff.eff)}%`;
      bhP2Fill.style.width = `${pctFor(p2Eff.eff)}%`;
      bhP1Val.textContent = fmtV(p1Eff.eff);
      bhP2Val.textContent = fmtV(p2Eff.eff);
      bhP1Bon.innerHTML = p1Eff.bonuses.map((b) => `<span class="bh-chip">${esc(b)}</span>`).join("");
      bhP2Bon.innerHTML = p2Eff.bonuses.map((b) => `<span class="bh-chip">${esc(b)}</span>`).join("");
    };

    const onFinishPhase = () => {
      stopBattleTelemLoop();
      duelState.battling = false;
      duelState.revealed = true;
      duelState.aiCalledStat = null;
      if (arena3dWrap) arena3dWrap.classList.remove("is-battling");

      if (p1Tyre === "hard") duelState.ers = Math.min(100, duelState.ers + 25);
      if (winner === "p1") {
        duelState.p1Score += 1;
        duelState.turn = "p1";
        sfx.winLap();
      } else if (winner === "p2") {
        duelState.p2Score += 1;
        duelState.turn = "p2";
        duelState.ers = Math.min(100, duelState.ers + 25);
        sfx.loseLap();
      } else {
        duelState.ers = Math.min(100, duelState.ers + 15);
        sfx.click();
      }
      duelState.ersArmed = false;
      duelState.tyre = "medium";

      const p1Label = duelState.opponent === "p2" ? "Player 1" : "You";
      const p2Label = duelState.opponent === "p2" ? "Player 2" : "AI Engineer";
      const v1Txt = fmtV(p1Eff.eff);
      const v2Txt = fmtV(p2Eff.eff);
      const isLast = duelState.round + 1 >= duelState.totalRounds;
      bhTitle.textContent = `${isLow ? "▼ " : "▲ "}${statDef.label} — FINAL TELEMETRY`;

      let msg = "";
      if (winner === "p1") {
        msg = `<strong class="res-win">${p1Label} won Lap ${duelState.round + 1}!</strong> ${esc(p1Card.clean_name)} (${v1Txt}) beat ${esc(p2Card.clean_name)} (${v2Txt}) on <b>${esc(statDef.label)}</b>${esc(tieNote)}.`;
        bhVerdict.innerHTML = `<span class="res-win">🏆 ${esc(p1Card.clean_name.toUpperCase())} WINS LAP ${duelState.round + 1}!</span>`;
        showTrackEvent("", "");
      } else if (winner === "p2") {
        msg = `<strong class="res-lose">${p2Label} won Lap ${duelState.round + 1}!</strong> ${esc(p2Card.clean_name)} (${v2Txt}) beat ${esc(p1Card.clean_name)} (${v1Txt}) on <b>${esc(statDef.label)}</b>${esc(tieNote)}. <em>(+25% ERS harvested!)</em>`;
        bhVerdict.innerHTML = `<span class="res-lose">⚡ ${esc(p2Card.clean_name.toUpperCase())} WINS LAP ${duelState.round + 1} (+25% ERS!)</span>`;
        showTrackEvent("", "");
      } else {
        msg = `<strong class="res-tie">Dead Heat on Lap ${duelState.round + 1}!</strong> Both drivers tied at ${v1Txt} on <b>${esc(statDef.label)}</b>.`;
        bhVerdict.innerHTML = `<span class="res-tie">🤝 PHOTO FINISH DRAW!</span>`;
        showTrackEvent("", "");
      }

      const logEl = document.getElementById("duel-log");
      const li = document.createElement("li");
      const trkTag = duelState.activeTrack && duelState.useTracks ? `[${duelState.activeTrack.name}] ` : "";
      li.innerHTML = `<span class="log-lap">L${duelState.round + 1}</span> ${esc(trkTag)}${msg}`;
      logEl.prepend(li);
      const logCnt = document.getElementById("duel-log-count");
      if (logCnt) logCnt.textContent = String(logEl.children.length);

      if (isLast) {
        duelState.finished = true;
        const p1WonMatch = duelState.p1Score > duelState.p2Score;
        if (window.F1Profile) {
          window.F1Profile.recordEvent("card_battle", { won: p1WonMatch });
        }
        const finalWin = p1WonMatch
          ? `🏆 ${p1Label.toUpperCase()} WINS THE GRAND PRIX (${duelState.p1Score}–${duelState.p2Score})!`
          : duelState.p2Score > duelState.p1Score
            ? `🏁 ${p2Label.toUpperCase()} TAKES THE VICTORY (${duelState.p2Score}–${duelState.p1Score})!`
            : `🤝 PHOTO FINISH DRAW (${duelState.p1Score}–${duelState.p2Score})!`;
        msg = `<div class="res-final">${finalWin}</div>` + msg;
        bhVerdict.innerHTML = `<span class="res-final">${finalWin}</span>`;
      }

      bhNext.innerHTML = isLast ? `<i class="fas fa-redo"></i> Rematch` : `Next Lap <i class="fas fa-arrow-right"></i>`;
      bhFoot.classList.remove("hidden");

      const resBar = document.getElementById("duel-result-bar");
      document.getElementById("duel-result-text").innerHTML = msg;
      document.getElementById("duel-next-btn").innerHTML = bhNext.innerHTML;
      resBar.classList.remove("hidden");

      updateDuelUI(winner, p1Eff, p2Eff);
    };

    const onPhase = (phase, maneuver) => {
      const mInfo = MANEUVER_META[maneuver] || MANEUVER_META.divebomb;
      if (phase === "braking") {
        showTrackEvent(mInfo.braking, "warn");
        sfx.beep(260, 0.16, 0.05, "sawtooth", 0);
        sfx.beep(190, 0.14, 0.045, "sawtooth", 0.14);
      } else if (phase === "apex") {
        const wName = winner === "p1" ? p1Card.clean_name : (winner === "p2" ? p2Card.clean_name : "BOTH DRIVERS");
        showTrackEvent(`🏎️ ${wName.toUpperCase()} ${mInfo.apex}`, winner === "p1" ? "win" : (winner === "p2" ? "lose" : "info"));
        sfx.purpleSector();
      }
    };

    if (arena3d && arena3d.ok) {
      arena3d.setTyreCompound("p1", p1Tyre);
      arena3d.setTyreCompound("p2", aiTyre);
      arena3d.runBattleSequence(p1Card, p2Card, winner, isLow, onRevealPhase, onFinishPhase, onPhase, {
        statKey,
        margin,
        ersArmed: p1Ers,
      });
    } else {
      setTimeout(() => onRevealPhase("divebomb"), 450);
      setTimeout(onFinishPhase, 1200);
    }
  }

  function aiPickBestDriverAndStat() {
    const trk = duelState.useTracks ? duelState.activeTrack : null;
    let bestIdx = 0;
    let bestKey = "pace";
    let bestScore = -999;
    duelState.p2Hand.forEach((card, idx) => {
      for (const st of BATTLE_STATS) {
        const val = card.game.stats[st.key];
        let score = st.dir === "low" ? (100 - val * 2.2) : val;
        if (trk && trk.boost_stat === st.key) score += (trk.boost_delta || 8);
        if (card.game.ability.active_bonus_stat === st.key) score += card.game.ability.active_bonus_val;
        score += (Math.random() * 5 - 2.5);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = idx;
          bestKey = st.key;
        }
      }
    });
    duelState.p2SelectedIdx = bestIdx;
    return bestKey;
  }

  function advanceDuelLap() {
    if (duelState.battling) return;
    if (duelState.finished) {
      startDuelMatch();
      return;
    }
    // Replace played card from each draw pile (keeping 3-card active hand!)
    duelState.p1Hand.splice(duelState.p1SelectedIdx, 1);
    if (duelState.p1Draw.length) duelState.p1Hand.push(duelState.p1Draw.shift());
    duelState.p1SelectedIdx = 0;

    duelState.p2Hand.splice(duelState.p2SelectedIdx, 1);
    if (duelState.p2Draw.length) duelState.p2Hand.push(duelState.p2Draw.shift());
    duelState.p2SelectedIdx = 0;

    duelState.round += 1;
    duelState.revealed = false;
    duelState.battling = false;
    duelState.chosenStat = null;
    duelState.aiCalledStat = null;
    duelState.safetyCarActive = false;
    manualSceneOverride = false;
    duelState.activeTrack = TRACKS.length ? TRACKS[Math.floor(Math.random() * TRACKS.length)] : null;
    if (arena3dWrap) arena3dWrap.classList.remove("is-battling");
    document.getElementById("duel-result-bar").classList.add("hidden");
    document.getElementById("battle-hud").classList.add("hidden");

    // Mid-race Safety Car drama when someone trails around mid-race!
    if (duelState.round === Math.floor(duelState.totalRounds / 2) && duelState.p1Score !== duelState.p2Score) {
      duelState.safetyCarActive = true;
      showTrackEvent("⚠️ SAFETY CAR DEPLOYED! Trailing driver gets +8 Comeback Slipstream!", "warn");
    } else {
      showTrackEvent("", "");
    }

    // If AI has the call, AI announces its stat and lets YOU counter-pick Driver, Tyres & ERS!
    if (duelState.opponent === "ai" && duelState.turn === "p2") {
      duelState.aiCalledStat = aiPickBestDriverAndStat();
      duelState.pendingStat = duelState.aiCalledStat;
      const sdef = BATTLE_STATS.find((s) => s.key === duelState.aiCalledStat) || { label: duelState.aiCalledStat };
      if (!duelState.safetyCarActive) {
        showTrackEvent(`⚠️ AI CALLS ${sdef.label}! PICK YOUR DEFENDER & CLICK DEFEND & RACE!`, "warn");
      }
    } else {
      duelState.pendingStat = bestDefaultStatForCard(getActiveP1());
    }

    if (arena3d) arena3d.triggerStartLights();
    sfx.click();
    updateDuelUI(null, null, null);
  }

  async function startDuelMatch() {
    const deckSpec = document.getElementById("duel-deck").value;
    const reqRounds = parseInt(document.getElementById("duel-rounds").value, 10) || 7;
    duelState.opponent = document.getElementById("duel-opponent").value;
    duelState.useTracks = document.getElementById("duel-tracks-toggle").checked;

    const [src, val] = deckSpec.split(":");
    const pdfLink = document.getElementById("duel-game-pdf-link");
    if (src === "season") pdfLink.href = `/cards.pdf?year=${val}&mode=game`;
    else if (src === "decade") pdfLink.href = `/cards/decade.pdf?decade=${val}&mode=game`;
    else pdfLink.href = `/cards/alltime.pdf?mode=game`;

    closeDuelDrawers();
    stopBattleTelemLoop();
    manualSceneOverride = false;
    if (arena3dWrap) arena3dWrap.classList.remove("is-battling");
    document.getElementById("duel-card-p1").innerHTML = `<div class="gc-card gc-loading">Rolling onto the grid…</div>`;
    document.getElementById("duel-card-p2").innerHTML = `<div class="gc-card gc-loading">Warming tyres…</div>`;
    document.getElementById("duel-result-bar").classList.add("hidden");
    document.getElementById("duel-log").innerHTML = "";
    const logCnt = document.getElementById("duel-log-count");
    if (logCnt) logCnt.textContent = "0";
    showTrackEvent("🔴🔴🔴🔴🔴 LIGHTS OUT & AWAY WE GO!", "info");

    try {
      const data = await fetchDeck(deckSpec);
      const pool = shuffle(data.cards || []);
      const half = Math.floor(pool.length / 2);
      duelState.totalRounds = Math.max(1, Math.min(reqRounds, half));
      const p1All = pool.slice(0, half);
      const p2All = pool.slice(half, half * 2);

      const handSize = Math.min(3, p1All.length);
      duelState.p1Hand = p1All.slice(0, handSize);
      duelState.p1Draw = p1All.slice(handSize);
      duelState.p2Hand = p2All.slice(0, handSize);
      duelState.p2Draw = p2All.slice(handSize);
      duelState.p1SelectedIdx = 0;
      duelState.p2SelectedIdx = 0;

      duelState.round = 0;
      duelState.p1Score = 0;
      duelState.p2Score = 0;
      duelState.turn = "p1";
      duelState.tyre = "medium";
      duelState.tyreStock = { soft: 2, hard: 2 };
      duelState.ers = 50;
      duelState.ersArmed = false;
      duelState.safetyCarActive = false;
      duelState.revealed = false;
      duelState.battling = false;
      duelState.chosenStat = null;
      duelState.aiCalledStat = null;
      duelState.finished = false;
      duelState.activeTrack = TRACKS.length ? TRACKS[Math.floor(Math.random() * TRACKS.length)] : null;
      duelState.pendingStat = bestDefaultStatForCard(getActiveP1());
      document.getElementById("battle-hud").classList.add("hidden");

      if (arena3d) arena3d.triggerStartLights();
      updateDuelUI(null, null, null);
    } catch (err) {
      document.getElementById("duel-card-p1").innerHTML = `<div class="gc-card gc-loading">Error: ${esc(err.message)}</div>`;
    }
  }

  document.getElementById("duel-start-btn").addEventListener("click", () => {
    sfx.lightsOut();
    startDuelMatch();
  });
  document.getElementById("duel-next-btn").addEventListener("click", advanceDuelLap);
  document.getElementById("duel-tracks-toggle").addEventListener("change", (e) => {
    duelState.useTracks = e.target.checked;
    renderTrackBanner(duelState.activeTrack);
    if (arena3d) arena3d.setWeather(duelState.useTracks && duelState.activeTrack ? duelState.activeTrack.weather : "DRY");
  });

  // =========================================================================
  // INTERACTIVE 5-STEP GUIDED TUTORIAL & SPOTLIGHT
  // =========================================================================
  const TUTORIAL_STEPS = [
    {
      title: "1. Live 3D Track & Weather Forecast",
      icon: `<i class="fas fa-cloud-showers-heavy"></i>`,
      target: "#arena-3d-wrap",
      body: `
        <p>Every lap flips a real <strong>Circuit &amp; Weather Card</strong> (Monza, Monaco, Spa, Interlagos…) and transforms the <strong>live Three.js 3D track</strong> above.</p>
        <ul>
          <li><b>Track Boosts:</b> Monza adds <code>+10 PACE</code>; Monaco adds <code>+10 RELIABILITY</code>; Spa adds <code>+10 RACECRAFT</code>.</li>
          <li><b>Wet / Street Chaos:</b> Rain &amp; street circuits grant <b>underdogs (OVR &lt; 78)</b> up to <b>+12 Chaos Bonus</b> so midfield heroes can beat legends!</li>
          <li>Switch 3D camera angles anytime (<b>TV Pod</b>, <b>Chase</b>, <b>Heli</b>).</li>
        </ul>
      `,
    },
    {
      title: "2. Pick Your Driver from Your 3-Card Hand",
      icon: `<i class="fas fa-layer-group"></i>`,
      target: "#pw-hand-sec",
      body: `
        <p>You hold <strong>3 drivers in your Active Garage Hand</strong> each lap instead of being stuck with 1 random card.</p>
        <ul>
          <li>Check the active Circuit first, then click the driver in your hand whose strengths match the track!</li>
          <li>Save high-<b>CLUTCH</b> World Champions for Yas Marina or Interlagos, and deploy low-<b>DNF%</b> specialists at Monaco or Marina Bay.</li>
        </ul>
      `,
    },
    {
      title: "3. Tyre Compounds & ERS Overtake Boost",
      icon: `<i class="fas fa-bolt"></i>`,
      target: "#pw-strategy-sec",
      body: `
        <p>Play real F1 pit-wall strategy before locking in your stat call:</p>
        <ul>
          <li><b style="color:#f87171">🔴 SOFT (×2 sets):</b> <code>+8 PACE</code> &amp; <code>+5 RACECRAFT</code>, but <code>+4% DNF</code> wear risk.</li>
          <li><b style="color:#fbbf24">🟡 MEDIUM (∞):</b> Balanced grip with zero penalties.</li>
          <li><b style="color:#e2e8f0">⚪ HARD (×2 sets):</b> <code>+8 RELIABILITY</code>, halves <b>DNF%</b>, and harvests <b>+25% ERS</b> (at <code>-4 PACE</code>).</li>
          <li><b style="color:#38bdf8">⚡ ERS BATTERY:</b> Spend <b>50% ERS</b> to arm <code>+10 Overtake</code> (lights up cyan sparks on your 3D car!). Losing a lap automatically harvests <b>+25% ERS</b> for a comeback.</li>
        </ul>
      `,
    },
    {
      title: "4. Call High ▲ or Low ▼ Battle Stats",
      icon: `<i class="fas fa-sliders-h"></i>`,
      target: "#duel-stage",
      body: `
        <p>Click any of the <strong>6 Battle Bars</strong> on your card to challenge your rival:</p>
        <ul>
          <li><b>▲ HIGH WINS (0–99):</b> <code>PACE</code>, <code>RACECRAFT</code>, <code>RELIABILITY</code>, <code>DUELS</code>, and <code>CLUTCH</code>.</li>
          <li><b>▼ LOW WINS:</b> <code>DNF RATE %</code> — lower retirement percentage wins! Reliable rookies &amp; modern drivers can snipe fragile legends here.</li>
          <li>Watch your card's <b>Pit Wall Ability</b> (e.g. <i>Giant Killer +12 vs World Champions</i>, <i>Slipstream +10 vs OVR 82+</i>, <i>Undercut wins ties</i>)!</li>
        </ul>
      `,
    },
    {
      title: "5. Four Ways to Play + Printable Decks",
      icon: `<i class="fas fa-trophy"></i>`,
      target: ".arena-tabs",
      body: `
        <p>Explore all four modes in the F1 Card Arena:</p>
        <ul>
          <li><b>Top Trumps GP:</b> Play any Season (including <b>2026</b>!), Decade, or All-Time deck with live 3D braking-zone &amp; apex corner overtakes!</li>
          <li><b>Track Simulator (24 Circuits):</b> Race 12 real driver cards live around Monza, Spa, Monaco, Suzuka, Madring &amp; more with Pace, ERS, Pit Stops, Weather Radar &amp; Safety Cars!</li>
          <li><b>Guess the Legend:</b> Wordle-style mystery puzzle using each driver's vertical <b>career team-colour spine</b>.</li>
          <li><b>Higher / Lower &amp; Printable PDFs:</b> Rapid-fire streaks online, or print any <b>Game Edition PDF</b> + <b>Track Deck PDF</b> for tabletop play!</li>
        </ul>
      `,
    },
  ];

  let tutStep = 0;
  let highlightedEl = null;

  function clearSpotlight() {
    if (highlightedEl) {
      highlightedEl.classList.remove("tut-spotlight");
      highlightedEl = null;
    }
  }

  function renderTutorialStep() {
    const s = TUTORIAL_STEPS[tutStep];
    document.getElementById("tut-step-badge").textContent = `STEP ${tutStep + 1} OF ${TUTORIAL_STEPS.length}`;
    document.getElementById("tut-icon-stage").innerHTML = s.icon;
    document.getElementById("tut-title").textContent = s.title;
    document.getElementById("tut-body").innerHTML = s.body;
    document.getElementById("tut-prev-btn").style.visibility = tutStep === 0 ? "hidden" : "visible";
    document.getElementById("tut-next-btn").innerHTML = tutStep === TUTORIAL_STEPS.length - 1
      ? `<i class="fas fa-flag-checkered"></i> Start Racing!`
      : `Next <i class="fas fa-arrow-right"></i>`;
    document.getElementById("tut-dots").innerHTML = TUTORIAL_STEPS.map((_, i) =>
      `<span class="tut-dot${i === tutStep ? " active" : ""}"></span>`
    ).join("");

    clearSpotlight();
    if (s.target) {
      const targetEl = document.querySelector(s.target);
      if (targetEl) {
        highlightedEl = targetEl;
        targetEl.classList.add("tut-spotlight");
      }
    }
  }

  function openTutorial() {
    switchMode("duel");
    tutStep = 0;
    document.getElementById("tutorial-modal").classList.remove("hidden");
    renderTutorialStep();
    sfx.click();
  }

  function closeTutorial() {
    clearSpotlight();
    document.getElementById("tutorial-modal").classList.add("hidden");
    document.getElementById("tutorial-welcome").classList.add("hidden");
    localStorage.setItem("traf1_tut_done", "1");
  }

  document.getElementById("tutorial-open-btn").addEventListener("click", openTutorial);
  document.getElementById("tut-welcome-start").addEventListener("click", openTutorial);
  document.getElementById("tut-welcome-dismiss").addEventListener("click", () => {
    document.getElementById("tutorial-welcome").classList.add("hidden");
    localStorage.setItem("traf1_tut_done", "1");
  });
  document.getElementById("tut-close-btn").addEventListener("click", closeTutorial);
  document.getElementById("tut-skip-btn").addEventListener("click", closeTutorial);
  document.getElementById("tut-prev-btn").addEventListener("click", () => {
    if (tutStep > 0) { tutStep -= 1; sfx.click(); renderTutorialStep(); }
  });
  document.getElementById("tut-next-btn").addEventListener("click", () => {
    if (tutStep < TUTORIAL_STEPS.length - 1) {
      tutStep += 1;
      sfx.click();
      renderTutorialStep();
    } else {
      sfx.lightsOut();
      closeTutorial();
    }
  });

  if (!localStorage.getItem("traf1_tut_done")) {
    document.getElementById("tutorial-welcome").classList.remove("hidden");
  }

  // =========================================================================
  // MODE 2: GUESS THE LEGEND (CAREER SPINE PUZZLE)
  // =========================================================================
  const spineState = {
    allCards: [],
    pool: [],
    target: null,
    guesses: [],
    maxGuesses: 5,
    over: false,
    streak: Number(localStorage.getItem("traf1_spine_streak") || 0),
    best: Number(localStorage.getItem("traf1_spine_best") || 0),
  };

  function updateSpineCounters() {
    document.getElementById("spine-streak").textContent = spineState.streak;
    document.getElementById("spine-best").textContent = spineState.best;
    localStorage.setItem("traf1_spine_streak", String(spineState.streak));
    localStorage.setItem("traf1_spine_best", String(spineState.best));
  }

  function renderSpineClues() {
    const t = spineState.target;
    if (!t) return;
    const misses = spineState.guesses.filter((g) => g.driver !== t.driver).length;
    const showAll = spineState.over;

    document.getElementById("spine-attempts-label").textContent =
      spineState.over ? "Round Complete" : `Guesses left: ${spineState.maxGuesses - spineState.guesses.length} / ${spineState.maxGuesses}`;

    const barEl = document.getElementById("spine-bar-display");
    const segs = t.cars && t.cars.length ? t.cars : [{ color: t.hero_color, year: "" }];
    barEl.innerHTML = segs.map((c) =>
      `<div class="msb-seg" style="background:${esc(c.color)}" title="${showAll ? esc(c.year + " " + c.name) : "Season " + esc(c.year)}"></div>`
    ).join("");
    document.getElementById("spine-era-tag").textContent = `Era: ${t.years_active} · ${t.unique_teams.length || 1} Constructor${(t.unique_teams.length || 1) === 1 ? "" : "s"}`;

    const c1 = document.getElementById("clue-1");
    if (showAll || misses >= 1) {
      c1.classList.remove("locked");
      c1.querySelector(".clue-body").innerHTML = `<strong>${esc(t.nationality || "—")}</strong> · <b>${t.seasons}</b> Seasons · Rank <b>#${t.rank}</b> All-Time`;
    } else {
      c1.classList.add("locked");
      c1.querySelector(".clue-body").textContent = "Unlocks after 1st miss";
    }

    const c2 = document.getElementById("clue-2");
    if (showAll || misses >= 2) {
      c2.classList.remove("locked");
      const seen = new Set();
      const imgs = (t.cars || []).filter((cc) => cc.car_slug && !seen.has(cc.car_slug) && seen.add(cc.car_slug)).slice(0, 5);
      c2.querySelector(".clue-body").innerHTML = imgs.length
        ? `<div class="clue-cars">${imgs.map((cc) => `<img src="/static/cars/png/${esc(cc.car_slug)}.png?v=20261124k" alt="Team car" title="${showAll ? esc(cc.name) : "Mystery livery"}">`).join("")}</div>`
        : esc(t.unique_teams.join(" · "));
    } else {
      c2.classList.add("locked");
      c2.querySelector(".clue-body").textContent = "Unlocks after 2nd miss";
    }

    const c3 = document.getElementById("clue-3");
    if (showAll || misses >= 3) {
      c3.classList.remove("locked");
      c3.querySelector(".clue-body").innerHTML = `<b>${t.wins}</b> Wins · <b>${t.podiums}</b> Podiums · <b>${t.championships}</b> Titles · <b>${t.starts}</b> Starts`;
    } else {
      c3.classList.add("locked");
      c3.querySelector(".clue-body").textContent = "Unlocks after 3rd miss";
    }

    const c4 = document.getElementById("clue-4");
    if (showAll || misses >= 4) {
      c4.classList.remove("locked");
      c4.querySelector(".clue-body").innerHTML = `<div class="clue-portrait-wrap">${renderPortrait(t, !showAll && misses < 4)}${showAll ? `<div><strong>${esc(t.clean_name)}</strong><br><small>${esc(t.unique_teams.join(" · "))}</small></div>` : `<small>Recognise this face?</small>`}</div>`;
    } else {
      c4.classList.add("locked");
      c4.querySelector(".clue-body").textContent = "Unlocks after 4th miss";
    }

    const histEl = document.getElementById("spine-history");
    histEl.innerHTML = spineState.guesses.map((g, i) => {
      const ok = g.driver === t.driver;
      const sameNat = g.nationality && g.nationality === t.nationality;
      const sharedTeam = (g.unique_teams || []).some((tm) => (t.unique_teams || []).includes(tm));
      const hints = [];
      if (sameNat) hints.push(`✓ ${g.nationality}`);
      if (sharedTeam) hints.push("✓ Shared team");
      if (!ok) hints.push(g.wins < t.wins ? "↑ More wins" : (g.wins > t.wins ? "↓ Fewer wins" : "= Same wins"));
      return `<div class="spine-guess-row ${ok ? "is-correct" : "is-wrong"}"><span>#${i + 1} ${esc(g.clean_name)}</span><small>${ok ? "EXACT MATCH!" : esc(hints.join(" · "))}</small></div>`;
    }).join("");
  }

  function pickNewMysteryDriver() {
    const poolMode = document.getElementById("spine-pool").value;
    let candidates = spineState.allCards;
    if (poolMode === "top80") {
      candidates = spineState.allCards.slice(0, 80);
    } else if (poolMode === "modern") {
      candidates = spineState.allCards.filter((c) => {
        const m = String(c.years_active || "").match(/(\d{4})$/);
        return m && Number(m[1]) >= 2000;
      });
    }
    const rich = candidates.filter((c) => c.seasons >= 2);
    spineState.pool = rich.length >= 10 ? rich : candidates;
    spineState.target = spineState.pool[Math.floor(Math.random() * spineState.pool.length)];
    spineState.guesses = [];
    spineState.over = false;
    document.getElementById("spine-guess-input").value = "";
    document.getElementById("spine-feedback").classList.add("hidden");
    document.getElementById("spine-suggestions").classList.add("hidden");
    renderSpineClues();
  }

  function submitSpineGuess(cardObj) {
    if (spineState.over || !spineState.target) return;
    if (!cardObj) {
      const q = document.getElementById("spine-guess-input").value.trim().toLowerCase();
      if (!q) return;
      cardObj = spineState.allCards.find((c) => c.clean_name.toLowerCase() === q || c.driver.toLowerCase() === q)
        || spineState.allCards.find((c) => c.clean_name.toLowerCase().includes(q));
      if (!cardObj) {
        const fb = document.getElementById("spine-feedback");
        fb.classList.remove("hidden");
        fb.className = "spine-feedback is-warn";
        fb.textContent = "Driver not found — pick a name from the dropdown suggestions.";
        return;
      }
    }
    if (spineState.guesses.some((g) => g.driver === cardObj.driver)) return;

    spineState.guesses.push(cardObj);
    document.getElementById("spine-guess-input").value = "";
    document.getElementById("spine-suggestions").classList.add("hidden");

    const fb = document.getElementById("spine-feedback");
    if (cardObj.driver === spineState.target.driver) {
      spineState.over = true;
      spineState.streak += 1;
      if (spineState.streak > spineState.best) spineState.best = spineState.streak;
      updateSpineCounters();
      if (window.F1Profile) window.F1Profile.recordEvent("mystery_driver", { solved: true });
      sfx.winLap();
      fb.classList.remove("hidden");
      fb.className = "spine-feedback is-win";
      fb.innerHTML = `🏁 <strong>Nailed it in ${spineState.guesses.length}!</strong> It was <b>${esc(spineState.target.clean_name)}</b> (${esc(spineState.target.years_active)}).`;
    } else if (spineState.guesses.length >= spineState.maxGuesses) {
      spineState.over = true;
      spineState.streak = 0;
      updateSpineCounters();
      if (window.F1Profile) window.F1Profile.recordEvent("mystery_driver", { solved: false });
      sfx.loseLap();
      fb.classList.remove("hidden");
      fb.className = "spine-feedback is-lose";
      fb.innerHTML = `Out of guesses! The mystery driver was <strong>${esc(spineState.target.clean_name)}</strong> (${esc(spineState.target.unique_teams.join(" · "))}).`;
    } else {
      sfx.click();
      fb.classList.add("hidden");
    }
    renderSpineClues();
  }

  async function initSpinePuzzle() {
    updateSpineCounters();
    const data = await fetchDeck("alltime:0");
    spineState.allCards = data.cards || [];
    pickNewMysteryDriver();
  }

  const spineInput = document.getElementById("spine-guess-input");
  const spineSug = document.getElementById("spine-suggestions");
  spineInput.addEventListener("input", () => {
    const q = spineInput.value.trim().toLowerCase();
    if (!q || q.length < 2) {
      spineSug.classList.add("hidden");
      return;
    }
    const matches = spineState.allCards
      .filter((c) => c.clean_name.toLowerCase().includes(q) || (c.code3 && c.code3.toLowerCase() === q))
      .slice(0, 8);
    if (!matches.length) {
      spineSug.classList.add("hidden");
      return;
    }
    spineSug.innerHTML = matches.map((c) =>
      `<button type="button" class="spine-sug-item" data-drv="${esc(c.driver)}"><span>${esc(c.clean_name)}</span><small>${esc(c.nationality)} · ${esc(c.years_active)}</small></button>`
    ).join("");
    spineSug.classList.remove("hidden");
    spineSug.querySelectorAll(".spine-sug-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const picked = spineState.allCards.find((c) => c.driver === btn.dataset.drv);
        submitSpineGuess(picked);
      });
    });
  });
  spineInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitSpineGuess(null); }
  });
  document.getElementById("spine-submit-btn").addEventListener("click", () => submitSpineGuess(null));
  document.getElementById("spine-new-btn").addEventListener("click", pickNewMysteryDriver);
  document.getElementById("spine-pool").addEventListener("change", pickNewMysteryDriver);
  document.getElementById("spine-giveup-btn").addEventListener("click", () => {
    if (spineState.over || !spineState.target) return;
    spineState.over = true;
    spineState.streak = 0;
    updateSpineCounters();
    const fb = document.getElementById("spine-feedback");
    fb.classList.remove("hidden");
    fb.className = "spine-feedback is-lose";
    fb.innerHTML = `Revealed: <strong>${esc(spineState.target.clean_name)}</strong> (${esc(spineState.target.unique_teams.join(" · "))}).`;
    renderSpineClues();
  });

  // =========================================================================
  // MODE 3: HIGHER / LOWER STREAK
  // =========================================================================
  const HILO_METRICS = [
    { key: "win_rate", label: "Career Win Rate", fmt: (c) => `${c.win_rate.toFixed(1)}%`, val: (c) => c.win_rate },
    { key: "podiums", label: "Career Podiums", fmt: (c) => `${c.podiums}`, val: (c) => c.podiums },
    { key: "fastest_laps", label: "Fastest Laps", fmt: (c) => `${c.fastest_laps}`, val: (c) => c.fastest_laps },
    { key: "starts", label: "Grand Prix Starts", fmt: (c) => `${c.starts}`, val: (c) => c.starts },
    { key: "overall", label: "Fair Overall Rating", fmt: (c) => `${c.overall.toFixed(1)}`, val: (c) => c.overall },
    { key: "dnf_rate", label: "Driver-Fault DNF %", fmt: (c) => `${c.game.stats.dnf_rate.toFixed(1)}%`, val: (c) => c.game.stats.dnf_rate },
    { key: "wet", label: "Wet Weather Rating", fmt: (c) => `${c.game.stats.wet}`, val: (c) => c.game.stats.wet },
  ];

  const hiloState = {
    pool: [],
    left: null,
    right: null,
    metric: null,
    revealed: false,
    streak: 0,
    best: Number(localStorage.getItem("traf1_hilo_best") || 0),
  };

  function renderHiLoCard(card, metric, showVal, stateCls) {
    return `
      <div class="gc-card hilo-card ${stateCls || ""}" style="--team:${esc(card.hero_color)}">
        <div class="gc-spine" style="background:${buildSpineGradient(card.spine_colors)}"><span>#${card.rank}</span></div>
        <div class="gc-body">
          <div class="gc-header">
            <div class="gc-head-left">
              <div class="gc-micro"><span class="gc-rank-pill">#${card.rank}</span><span class="gc-meta">${esc(card.nationality)} · ${esc(card.years_active)}</span></div>
              <h3 class="gc-name">${esc(card.clean_name)}</h3>
            </div>
          </div>
          <div class="gc-stage">
            ${renderPortrait(card, false)}
            <div class="gc-car-stage">
              ${renderCarImg(card.hero_car_slug, card.hero_team)}
              <span class="gc-team-cap"><i style="background:${esc(card.hero_color)}"></i>${esc(card.hero_team)}</span>
            </div>
          </div>
          <div class="hilo-stat-focus">
            <span class="hilo-stat-name">${esc(metric.label)}</span>
            <strong class="hilo-stat-num">${showVal ? esc(metric.fmt(card)) : "???"}</strong>
          </div>
        </div>
      </div>
    `;
  }

  function nextHiLoPair() {
    if (hiloState.pool.length < 2) return;
    hiloState.revealed = false;
    hiloState.metric = HILO_METRICS[Math.floor(Math.random() * HILO_METRICS.length)];
    let a = hiloState.pool[Math.floor(Math.random() * hiloState.pool.length)];
    let b = a;
    let tries = 0;
    while ((b.driver === a.driver || hiloState.metric.val(b) === hiloState.metric.val(a)) && tries < 30) {
      b = hiloState.pool[Math.floor(Math.random() * hiloState.pool.length)];
      tries++;
    }
    hiloState.left = a;
    hiloState.right = b;
    document.getElementById("hilo-prompt-pill").innerHTML = `Does <b>${esc(b.clean_name)}</b> have a HIGHER or LOWER <b>${esc(hiloState.metric.label)}</b> than ${esc(a.clean_name)}?`;
    document.getElementById("hilo-result-banner").classList.add("hidden");
    document.getElementById("hilo-higher-btn").disabled = false;
    document.getElementById("hilo-lower-btn").disabled = false;
    document.getElementById("hilo-card-left").innerHTML = renderHiLoCard(a, hiloState.metric, true, "");
    document.getElementById("hilo-card-right").innerHTML = renderHiLoCard(b, hiloState.metric, false, "");
  }

  function answerHiLo(dir) {
    if (hiloState.revealed) return;
    hiloState.revealed = true;
    document.getElementById("hilo-higher-btn").disabled = true;
    document.getElementById("hilo-lower-btn").disabled = true;
    const va = hiloState.metric.val(hiloState.left);
    const vb = hiloState.metric.val(hiloState.right);
    const correct = (dir === "higher" && vb >= va) || (dir === "lower" && vb <= va);

    if (correct) {
      hiloState.streak += 1;
      sfx.winLap();
      if (hiloState.streak > hiloState.best) {
        hiloState.best = hiloState.streak;
        localStorage.setItem("traf1_hilo_best", String(hiloState.best));
      }
    } else {
      hiloState.streak = 0;
      sfx.loseLap();
    }
    document.getElementById("hilo-streak").textContent = hiloState.streak;
    document.getElementById("hilo-best").textContent = hiloState.best;

    document.getElementById("hilo-card-right").innerHTML = renderHiLoCard(
      hiloState.right,
      hiloState.metric,
      true,
      correct ? "is-winner" : "is-loser"
    );
    const res = document.getElementById("hilo-result-banner");
    document.getElementById("hilo-result-text").innerHTML = correct
      ? `<strong class="res-win">Spot on!</strong> ${esc(hiloState.right.clean_name)} (${esc(hiloState.metric.fmt(hiloState.right))}) vs ${esc(hiloState.left.clean_name)} (${esc(hiloState.metric.fmt(hiloState.left))}).`
      : `<strong class="res-lose">Streak broken!</strong> ${esc(hiloState.right.clean_name)} has <b>${esc(hiloState.metric.fmt(hiloState.right))}</b> vs ${esc(hiloState.left.clean_name)}'s <b>${esc(hiloState.metric.fmt(hiloState.left))}</b>.`;
    res.classList.remove("hidden");
  }

  async function initHiLo() {
    document.getElementById("hilo-best").textContent = hiloState.best;
    document.getElementById("hilo-streak").textContent = hiloState.streak;
    const data = await fetchDeck("alltime:100");
    hiloState.pool = (data.cards || []).filter((c) => c.starts >= 10);
    nextHiLoPair();
  }

  document.getElementById("hilo-higher-btn").addEventListener("click", () => answerHiLo("higher"));
  document.getElementById("hilo-lower-btn").addEventListener("click", () => answerHiLo("lower"));
  document.getElementById("hilo-next-btn").addEventListener("click", nextHiLoPair);
  document.getElementById("hilo-restart-btn").addEventListener("click", () => {
    hiloState.streak = 0;
    document.getElementById("hilo-streak").textContent = "0";
    nextHiLoPair();
  });

  // =========================================================================
  // FULL-SCREEN DUEL KEYBOARD SHORTCUTS (1-6 Stat · Space Race · C Cam · V Scene · H Cards · F Focus)
  // =========================================================================
  document.addEventListener("keydown", (e) => {
    if (currentMode !== "duel") return;
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "select" || tag === "textarea") return;

    if (e.key === "Escape") {
      closeDuelDrawers();
      return;
    }
    const tutModal = document.getElementById("tutorial-modal");
    if (tutModal && !tutModal.classList.contains("hidden")) return;

    if (e.key >= "1" && e.key <= "8") {
      const st = BATTLE_STATS[Number(e.key) - 1];
      if (st && !duelState.revealed && !duelState.battling && !duelState.finished && !(duelState.opponent === "ai" && duelState.turn === "p2")) {
        duelState.pendingStat = st.key;
        sfx.click();
        renderPitWallConsole();
      }
      return;
    }
    if (e.key === " " || e.key === "Enter") {
      if (tag === "button" || tag === "a") return;
      e.preventDefault();
      if (duelState.battling) return;
      if (duelState.revealed) advanceDuelLap();
      else {
        const statToPlay = (duelState.opponent === "ai" && duelState.turn === "p2" && duelState.aiCalledStat)
          ? duelState.aiCalledStat
          : (duelState.pendingStat || "pace");
        resolveDuelLap(statToPlay);
      }
      return;
    }
    const lk = e.key.toLowerCase();
    if (lk === "c") {
      const cams = [...document.querySelectorAll("#arena-3d-wrap .hud-cam")];
      const idx = cams.findIndex((b) => b.classList.contains("active"));
      const next = cams[(idx + 1) % cams.length];
      if (next) next.click();
    } else if (lk === "v") {
      const scs = [...document.querySelectorAll("#arena-3d-wrap .hud-scene")];
      const idx = scs.findIndex((b) => b.classList.contains("active"));
      const next = scs[(idx + 1) % scs.length];
      if (next) next.click();
    } else if (lk === "h") {
      toggleCardsDock();
    } else if (lk === "f") {
      toggleDuelFocus();
    }
  });

  // =========================================================================
  // BOOT FROM URL PARAMS
  // =========================================================================
  const params = new URLSearchParams(window.location.search);
  const deckParam = params.get("deck");
  const modeParam = params.get("mode");
  if (deckParam) {
    const sel = document.getElementById("duel-deck");
    if ([...sel.options].some((o) => o.value === deckParam)) sel.value = deckParam;
  }
  switchMode(modeParam && panels[modeParam] ? modeParam : "duel");
  if (params.get("tutorial") === "1") {
    openTutorial();
  }
  startDuelMatch();
})();
