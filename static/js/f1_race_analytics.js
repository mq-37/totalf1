/**
 * Scrubbable Race Data Analysis, Pit Wall Engineer Lab & Post-Race Media Pen (/sim & /career).
 *
 * Interactive Timeline Scrubber (Lap 0..N + Play/Pause + clickable Event Pins) driving 7 tabs:
 *   1. Overview & Live Classification at Scrubbed Lap
 *   2. Engineer Lab & Car Health (6-Component Thermal X-Ray Blueprint, 5-Axis Setup Radar + Feedback
 *      Uncertainty Cloud, Weighted Feedback Signal Breakdown & G-G Friction Circle Heatmap)
 *   3. Lap & Position Trajectory Chart (Canvas + SC/Rain bands)
 *   4. Gap to Leader & Pace Curve
 *   5. Tyre Strategy Stint Gantt
 *   6. Driver Confidence & Momentum Curve
 *   7. Radio Log & Post-Race Interviews (Strictly In-Race Radio Diagnostics during a live race;
 *      solid, grounded Post-Race Media Pen Interviews unlock ONLY after the Chequered Flag!)
 */
(function (global) {
  "use strict";

  const ENG = global.F1RaceEngine;
  const esc = ENG ? ENG.esc : (s) => String(s == null ? "" : s);
  const fmtLap = ENG ? ENG.fmtLapTime : (s) => (s > 0 ? s.toFixed(1) : "--.-");
  const COMPOUNDS = (ENG && ENG.COMPOUNDS) || {
    soft: { code: "S", color: "#ef4444" },
    medium: { code: "M", color: "#facc15" },
    hard: { code: "H", color: "#f8fafc" },
    inter: { code: "I", color: "#22c55e" },
    wet: { code: "W", color: "#3b82f6" },
  };
  const COMP_META = (ENG && ENG.CAR_COMPONENTS) || {
    ice:        { label: "ICE Power Unit",    short: "ICE",  area: "Powertrain",   color: "#ef4444" },
    ers:        { label: "ERS / MGU-K",       short: "ERS",  area: "Hybrid",       color: "#22c55e" },
    gearbox:    { label: "Gearbox & Hydr.",   short: "GBX",  area: "Drivetrain",   color: "#f59e0b" },
    brakes:     { label: "Carbon Brakes",     short: "BRK",  area: "Braking",      color: "#f97316" },
    floor:      { label: "Aero Floor / Edge", short: "FLR",  area: "Aerodynamics", color: "#38bdf8" },
    suspension: { label: "Suspension & Steer",short: "SUSP", area: "Chassis",      color: "#a855f7" },
  };

  let modalEl = null;
  let state = {
    payload: null,
    interviews: null,
    interviewsLocked: false,
    activeTab: "overview",
    radioSubTab: "interviews", // interviews | radio
    radioFilter: "all",        // all | mechanical | setup | race
    scrubIdx: 0,
    playing: false,
    playTimer: null,
    focusDrvIdx: -1,
    engDrvIdx: -1,
    engSubTab: "xray", // xray | setup | feedback | tactics
    whatIfOverrides: null,
    selectedInterviewIdx: 0,
  };

  function healthColor(h) {
    if (h >= 78) return "#22c55e";
    if (h >= 60) return "#facc15";
    if (h >= 42) return "#f97316";
    return "#ef4444";
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement("div");
    modalEl.id = "f1-analytics-studio-modal";
    modalEl.className = "ras-backdrop hidden";
    modalEl.setAttribute("role", "dialog");
    modalEl.setAttribute("aria-modal", "true");
    modalEl.innerHTML = `
      <div class="ras-shell">
        <div class="ras-head">
          <div class="ras-title-wrap">
            <span class="ras-badge"><i class="fas fa-chart-area"></i> RACE DATA &amp; ENGINEER STUDIO</span>
            <strong id="ras-circuit-title">Grand Prix Telemetry</strong>
            <small id="ras-era-sub" class="muted"></small>
          </div>
          <div class="ras-tabs" role="tablist">
            <button type="button" class="ras-tab active" data-ras-tab="overview"><i class="fas fa-list-ol"></i> Overview</button>
            <button type="button" class="ras-tab" data-ras-tab="engineer"><i class="fas fa-microchip"></i> Engineer Lab</button>
            <button type="button" class="ras-tab" data-ras-tab="positions"><i class="fas fa-project-diagram"></i> Positions</button>
            <button type="button" class="ras-tab" data-ras-tab="pace"><i class="fas fa-tachometer-alt"></i> Gap &amp; Pace</button>
            <button type="button" class="ras-tab" data-ras-tab="tyres"><i class="fas fa-dharmachakra"></i> Tyres</button>
            <button type="button" class="ras-tab" data-ras-tab="psych"><i class="fas fa-brain"></i> Confidence</button>
            <button type="button" class="ras-tab" data-ras-tab="interviews" id="ras-tab-int-btn"><i class="fas fa-microphone-alt"></i> Radio &amp; Interviews</button>
          </div>
          <button type="button" id="ras-close-btn" class="ras-close" aria-label="Close Analytics Studio">&times;</button>
        </div>

        <div class="ras-scrubber-bar">
          <button type="button" id="ras-play-btn" class="ras-play-btn" title="Play / Pause Race Timeline Scrub"><i class="fas fa-play"></i></button>
          <span id="ras-lap-read" class="ras-lap-read">LAP 0 / 15</span>
          <div class="ras-slider-wrap">
            <input type="range" id="ras-slider" min="0" max="15" value="0" step="1">
            <div id="ras-event-pins" class="ras-event-pins"></div>
          </div>
          <span id="ras-env-read" class="ras-env-read">☀️ DRY 0%</span>
          <select id="ras-drv-filter" class="ras-drv-filter" title="Highlight Driver in Charts & Engineer Lab">
            <option value="-1">Highlight: Top Contenders</option>
          </select>
        </div>

        <div class="ras-body">
          <div id="ras-pane-overview" class="ras-pane active"></div>
          <div id="ras-pane-engineer" class="ras-pane"></div>
          <div id="ras-pane-positions" class="ras-pane"><canvas id="ras-cv-positions" class="ras-canvas"></canvas><div id="ras-leg-positions" class="ras-legend"></div></div>
          <div id="ras-pane-pace" class="ras-pane"><canvas id="ras-cv-pace" class="ras-canvas"></canvas><div id="ras-leg-pace" class="ras-legend"></div></div>
          <div id="ras-pane-tyres" class="ras-pane"></div>
          <div id="ras-pane-psych" class="ras-pane"><canvas id="ras-cv-psych" class="ras-canvas"></canvas><div id="ras-leg-psych" class="ras-legend"></div></div>
          <div id="ras-pane-interviews" class="ras-pane"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    modalEl.querySelector("#ras-close-btn").addEventListener("click", close);
    modalEl.addEventListener("click", (ev) => { if (ev.target === modalEl) close(); });
    modalEl.querySelectorAll("[data-ras-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.activeTab = btn.dataset.rasTab;
        modalEl.querySelectorAll("[data-ras-tab]").forEach((b) => b.classList.toggle("active", b === btn));
        modalEl.querySelectorAll(".ras-pane").forEach((p) => p.classList.toggle("active", p.id === `ras-pane-${state.activeTab}`));
        renderActivePane();
      });
    });
    modalEl.querySelector("#ras-slider").addEventListener("input", (ev) => {
      state.scrubIdx = Number(ev.target.value) || 0;
      updateScrubberHeader();
      renderActivePane();
    });
    modalEl.querySelector("#ras-play-btn").addEventListener("click", togglePlay);
    modalEl.querySelector("#ras-drv-filter").addEventListener("change", (ev) => {
      state.focusDrvIdx = Number(ev.target.value);
      if (state.focusDrvIdx >= 0) state.engDrvIdx = state.focusDrvIdx;
      renderActivePane();
    });

    return modalEl;
  }

  function stopPlay() {
    state.playing = false;
    clearInterval(state.playTimer);
    state.playTimer = null;
    const btn = modalEl && modalEl.querySelector("#ras-play-btn");
    if (btn) btn.innerHTML = `<i class="fas fa-play"></i>`;
  }

  function togglePlay() {
    if (state.playing) { stopPlay(); return; }
    const frames = (state.payload && state.payload.frames) || [];
    if (frames.length <= 1) return;
    if (state.scrubIdx >= frames.length - 1) state.scrubIdx = 0;
    state.playing = true;
    const btn = modalEl.querySelector("#ras-play-btn");
    if (btn) btn.innerHTML = `<i class="fas fa-pause"></i>`;
    state.playTimer = setInterval(() => {
      if (state.scrubIdx >= frames.length - 1) { stopPlay(); return; }
      state.scrubIdx += 1;
      modalEl.querySelector("#ras-slider").value = String(state.scrubIdx);
      updateScrubberHeader();
      renderActivePane();
    }, 520);
  }

  function close() {
    stopPlay();
    if (modalEl) modalEl.classList.add("hidden");
  }

  function updateScrubberHeader() {
    const p = state.payload;
    if (!p || !modalEl) return;
    const frames = p.frames || [];
    const fr = frames[state.scrubIdx] || frames[frames.length - 1] || { lap: 0, wetness: 0, sc: false, vsc: false };
    modalEl.querySelector("#ras-lap-read").textContent = `LAP ${fr.lap} / ${p.totalLaps || frames.length}`;
    const w = fr.wetness || 0;
    const scTag = fr.sc ? " · ⚠️ SAFETY CAR" : (fr.vsc ? " · ⚠️ VSC" : "");
    const statusTag = p.raceFinished ? " · 🏁 FINAL" : " · 🔴 LIVE";
    modalEl.querySelector("#ras-env-read").textContent = `${w >= 60 ? "🌧️ WET" : (w >= 22 ? "🌦️ DAMP" : "☀️ DRY")} ${w}%${scTag}${statusTag}`;
  }

  function getSelectedDrivers() {
    const p = state.payload;
    if (!p) return [];
    const drivers = p.drivers || [];
    const frames = p.frames || [];
    const last = frames[frames.length - 1];
    const orderMap = new Map();
    if (last && last.cars) last.cars.forEach((c) => orderMap.set(c.idx, c.pos));
    const sorted = drivers.slice().sort((a, b) => (orderMap.get(a.idx) || 99) - (orderMap.get(b.idx) || 99));
    if (state.focusDrvIdx >= 0) {
      const foc = sorted.find((d) => d.idx === state.focusDrvIdx);
      const rest = sorted.filter((d) => d.idx !== state.focusDrvIdx).slice(0, 5);
      return foc ? [foc, ...rest] : sorted.slice(0, 6);
    }
    const players = sorted.filter((d) => d.isPlayer);
    const top = sorted.filter((d) => !d.isPlayer).slice(0, Math.max(4, 6 - players.length));
    return [...players, ...top];
  }

  function renderOverview() {
    const box = modalEl.querySelector("#ras-pane-overview");
    const p = state.payload;
    const frames = p.frames || [];
    const fr = frames[state.scrubIdx] || frames[frames.length - 1];
    if (!fr) { box.innerHTML = `<div class="muted">No telemetry frames recorded yet.</div>`; return; }
    const drvMap = new Map((p.drivers || []).map((d) => [d.idx, d]));
    const evsUpTo = (p.events || []).filter((e) => e.lap <= Math.max(1, fr.lap)).slice(-20).reverse();

    const rows = (fr.cars || []).map((c) => {
      const d = drvMap.get(c.idx) || { code3: "DRV", name: "Driver", team: "", color: "#64748b", gridPos: c.pos };
      const gain = (d.gridPos || c.pos) - c.pos;
      const gHtml = gain > 0 ? `<span class="tt-up">+${gain}</span>` : (gain < 0 ? `<span class="tt-dn">${gain}</span>` : `<span class="tt-muted">0</span>`);
      const comp = COMPOUNDS[c.comp] || COMPOUNDS.medium;
      const tier = ENG ? ENG.confidenceTier(c.conf) : { color: "#cbd5e1", label: "STD" };
      const wearLoss = Number(c.compLossS || 0);
      const wearPill = wearLoss >= 0.35
        ? `<span class="eng-loss-pill is-crit">+${wearLoss.toFixed(2)}s</span>`
        : (wearLoss >= 0.10 ? `<span class="eng-loss-pill is-warn">+${wearLoss.toFixed(2)}s</span>` : `<span class="eng-loss-pill is-ok">OK</span>`);
      return `
        <tr class="${c.idx === state.focusDrvIdx ? "is-focus" : (d.isPlayer ? "is-player" : "")}">
          <td class="tt-pos">${c.dnf ? "DNF" : "P" + c.pos}</td>
          <td class="tt-drv"><i class="tt-bar" style="background:${esc(d.color)}"></i><b>${esc(d.code3)}</b> <span class="muted">${esc(d.name)}</span></td>
          <td>${gHtml}</td>
          <td class="tt-mono">${c.dnf ? "OUT" : (c.pos === 1 ? "LEADER" : `+${Number(c.gap || 0).toFixed(1)}s`)}</td>
          <td class="tt-mono">${c.lapTime ? fmtLap(c.lapTime) : "--.-"}</td>
          <td><span class="sim-tbadge t-${esc(c.comp)}">${comp.code}</span> <small>${c.tyreLife}%</small></td>
          <td style="color:${tier.color};font-weight:800;">${c.conf} <small>(${c.mom >= 0 ? "+" : ""}${c.mom})</small></td>
          <td>${wearPill}</td>
        </tr>
      `;
    }).join("");

    const evHtml = evsUpTo.length
      ? evsUpTo.map((e) => `<div class="ras-ev-row ras-ev-${esc(e.type)}"><b>L${e.lap}</b><span>${esc(e.title)}</span><small>${esc(e.detail)}</small></div>`).join("")
      : `<div class="muted small">No race incidents recorded up to Lap ${fr.lap}.</div>`;

    box.innerHTML = `
      <div class="ras-overview-grid">
        <div class="ras-card ras-scroll">
          <div class="ras-card-head"><span>CLASSIFICATION AT LAP ${fr.lap}</span><small>${fr.cars.length} Cars</small></div>
          <table class="ras-table">
            <thead><tr><th>Pos</th><th>Driver</th><th>Δ</th><th>Gap</th><th>Lap</th><th>Tyre</th><th>Conf (Mom)</th><th>Car Wear</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="ras-card ras-scroll">
          <div class="ras-card-head"><span>KEY RACE STORYLINE &amp; FAULTS (UP TO L${fr.lap})</span><small>${(p.events || []).length} Total</small></div>
          <div class="ras-ev-list">${evHtml}</div>
        </div>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // TAB 2: ENGINEER LAB & CAR HEALTH (X-Ray Blueprint + Setup Radar + Weights + G-G Circle!)
  // ---------------------------------------------------------------------------
  function buildChassisXraySvg(compMap, eraKey) {
    const eraDefs = (ENG && ENG.getEraComponents) ? ENG.getEraComponents(eraKey) : COMP_META;
    const tier = (ENG && ENG.resolveEraTier) ? ENG.resolveEraTier(eraKey) : "hybrid";
    const c = (k) => {
      const v = compMap && compMap[k];
      const def = eraDefs[k] || COMP_META[k] || { short: k.toUpperCase(), label: k, baseTemp: 85 };
      const h = v ? Number(v.h ?? v.health ?? 95) : 95;
      const t = v ? Number(v.t ?? v.temp ?? def.baseTemp ?? 85) : (def.baseTemp || 85);
      return { h: Math.round(h), t: Math.round(t), col: healthColor(h), crit: h < 45, short: def.short, label: def.label };
    };
    const ice = c("ice"), ers = c("ers"), gbx = c("gearbox"), brk = c("brakes"), flr = c("floor"), sus = c("suspension");

    let silhouette = "";
    if (tier === "classic") {
      // 1950s–1960s Classic Cigar / Torpedo Monocoque Silhouette (NO Wings, Exposed Open Wheels!)
      silhouette = `
        <path d="M 62,102 C 120,82 280,84 374,104 L 378,110 L 374,116 C 280,136 120,138 62,118 Z" fill="url(#chassisGrad)" stroke="${flr.col}" stroke-width="2.6" filter="url(#neonGlow)"/>
        <ellipse cx="222" cy="110" rx="28" ry="11" fill="#090d16" stroke="#64748b" stroke-width="1.4"/>
        <g fill="#090d16" stroke="#475569" stroke-width="1.6">
          <rect x="292" y="34" width="32" height="15" rx="4"/>
          <rect x="292" y="171" width="32" height="15" rx="4"/>
          <rect x="86" y="32" width="36" height="17" rx="4"/>
          <rect x="86" y="171" width="36" height="17" rx="4"/>
        </g>
        <g stroke="${sus.col}" stroke-width="2.6" filter="url(#neonGlow)">
          <line x1="308" y1="49" x2="296" y2="92"/><line x1="308" y1="49" x2="320" y2="94"/>
          <line x1="308" y1="171" x2="296" y2="128"/><line x1="308" y1="171" x2="320" y2="126"/>
          <line x1="104" y1="49" x2="112" y2="94"/><line x1="104" y1="171" x2="112" y2="126"/>
        </g>
        <g fill="${brk.col}" filter="url(#neonGlow)">
          <rect x="301" y="49" width="14" height="7" rx="2"/><rect x="301" y="164" width="14" height="7" rx="2"/>
          <rect x="97" y="49" width="14" height="7" rx="2"/><rect x="97" y="164" width="14" height="7" rx="2"/>
        </g>
      `;
    } else if (tier === "turbo") {
      // 1970s–1980s Wide Ground-Effect Wedge Sidepods + Huge Rear Slicks + Boxy Wings!
      silhouette = `
        <path d="M 88,60 L 244,66 L 266,92 L 266,128 L 244,154 L 88,160 Z" fill="url(#chassisGrad)" stroke="${flr.col}" stroke-width="2.6" filter="url(#neonGlow)"/>
        <path d="M 74,94 L 264,92 L 366,102 L 366,118 L 264,128 L 74,126 Z" fill="#0f172a" stroke="#64748b" stroke-width="1.6"/>
        <rect x="352" y="54" width="22" height="112" rx="3" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
        <rect x="40" y="60" width="28" height="100" rx="3" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
        <g fill="#090d16" stroke="#475569" stroke-width="1.5">
          <rect x="288" y="38" width="34" height="20" rx="4"/>
          <rect x="288" y="162" width="34" height="20" rx="4"/>
          <rect x="74" y="24" width="48" height="32" rx="5"/>
          <rect x="74" y="164" width="48" height="32" rx="5"/>
        </g>
        <g stroke="${sus.col}" stroke-width="2.6" filter="url(#neonGlow)">
          <line x1="305" y1="58" x2="294" y2="96"/><line x1="305" y1="58" x2="318" y2="98"/>
          <line x1="305" y1="162" x2="294" y2="124"/><line x1="305" y1="162" x2="318" y2="122"/>
          <line x1="98" y1="56" x2="112" y2="92"/><line x1="98" y1="164" x2="112" y2="128"/>
        </g>
        <g fill="${brk.col}" filter="url(#neonGlow)">
          <rect x="298" y="56" width="15" height="7" rx="2"/><rect x="298" y="157" width="15" height="7" rx="2"/>
          <rect x="90" y="54" width="16" height="8" rx="2"/><rect x="90" y="158" width="16" height="8" rx="2"/>
        </g>
      `;
    } else if (tier === "v10") {
      // 1990s–2008 Sculpted Narrow-Waisted V10 Silhouette + Grooved Tyres + Bargeboards!
      silhouette = `
        <path d="M 92,72 L 236,64 L 260,84 L 260,136 L 236,156 L 92,148 Z" fill="url(#chassisGrad)" stroke="${flr.col}" stroke-width="2.6" filter="url(#neonGlow)"/>
        <path d="M 70,96 L 262,92 L 372,105 L 372,115 L 262,128 L 70,124 Z" fill="#0f172a" stroke="#64748b" stroke-width="1.6"/>
        <path d="M 350,48 L 376,56 L 382,110 L 376,164 L 350,172 L 344,158 L 352,110 L 344,62 Z" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
        <rect x="44" y="68" width="24" height="84" rx="4" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
        <g fill="#090d16" stroke="#475569" stroke-width="1.5">
          <rect x="288" y="34" width="38" height="22" rx="5"/><rect x="288" y="164" width="38" height="22" rx="5"/>
          <rect x="80" y="30" width="44" height="26" rx="5"/><rect x="80" y="164" width="44" height="26" rx="5"/>
        </g>
        <g stroke="${sus.col}" stroke-width="2.8" filter="url(#neonGlow)">
          <line x1="307" y1="56" x2="294" y2="96"/><line x1="307" y1="56" x2="318" y2="98"/>
          <line x1="307" y1="164" x2="294" y2="124"/><line x1="307" y1="164" x2="318" y2="122"/>
          <line x1="102" y1="56" x2="112" y2="92"/><line x1="102" y1="164" x2="112" y2="128"/>
        </g>
        <g fill="${brk.col}" filter="url(#neonGlow)">
          <rect x="299" y="54" width="16" height="8" rx="2"/><rect x="299" y="158" width="16" height="8" rx="2"/>
          <rect x="94" y="54" width="16" height="8" rx="2"/><rect x="94" y="158" width="16" height="8" rx="2"/>
        </g>
      `;
    } else {
      // 2009–2026 Modern Hybrid Ground-Effect Venturi Silhouette!
      silhouette = `
        <path d="M 88,68 L 240,62 L 265,86 L 265,134 L 240,158 L 88,152 Z" fill="url(#chassisGrad)" stroke="${flr.col}" stroke-width="2.6" filter="url(#neonGlow)"/>
        <path d="M 70,96 L 265,92 L 368,104 L 368,116 L 265,128 L 70,124 Z" fill="#0f172a" stroke="#64748b" stroke-width="1.6"/>
        <path d="M 352,44 L 380,52 L 386,110 L 380,168 L 352,176 L 344,162 L 354,110 L 344,58 Z" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
        <rect x="44" y="66" width="24" height="88" rx="4" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5"/>
        <g fill="#090d16" stroke="#475569" stroke-width="1.5">
          <rect x="288" y="34" width="38" height="22" rx="5"/><rect x="288" y="164" width="38" height="22" rx="5"/>
          <rect x="80" y="30" width="44" height="26" rx="5"/><rect x="80" y="164" width="44" height="26" rx="5"/>
        </g>
        <g stroke="${sus.col}" stroke-width="2.8" filter="url(#neonGlow)">
          <line x1="307" y1="56" x2="294" y2="96"/><line x1="307" y1="56" x2="318" y2="98"/>
          <line x1="307" y1="164" x2="294" y2="124"/><line x1="307" y1="164" x2="318" y2="122"/>
          <line x1="102" y1="56" x2="112" y2="92"/><line x1="102" y1="164" x2="112" y2="128"/>
        </g>
        <g fill="${brk.col}" filter="url(#neonGlow)">
          <rect x="299" y="54" width="16" height="8" rx="2"/><rect x="299" y="158" width="16" height="8" rx="2"/>
          <rect x="94" y="54" width="16" height="8" rx="2"/><rect x="94" y="158" width="16" height="8" rx="2"/>
        </g>
      `;
    }

    return `
      <svg viewBox="0 0 420 220" class="eng-xray-svg" aria-label="Era-Authentic F1 6-Component Thermal X-Ray Blueprint">
        <defs>
          <filter id="neonGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.0" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="chassisGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#1e293b"/>
            <stop offset="50%" stop-color="#334155"/>
            <stop offset="100%" stop-color="#0f172a"/>
          </linearGradient>
        </defs>
        <g stroke="rgba(56,189,248,0.10)" stroke-width="1">
          <line x1="0" y1="55" x2="420" y2="55"/><line x1="0" y1="110" x2="420" y2="110"/><line x1="0" y1="165" x2="420" y2="165"/>
          <line x1="70" y1="0" x2="70" y2="220"/><line x1="140" y1="0" x2="140" y2="220"/><line x1="210" y1="0" x2="210" y2="220"/><line x1="280" y1="0" x2="280" y2="220"/><line x1="350" y1="0" x2="350" y2="220"/>
        </g>
        ${silhouette}
        <!-- Period-Authentic Internal Subsystems -->
        <rect x="200" y="96" width="48" height="28" rx="4" fill="${ers.col}" fill-opacity="0.32" stroke="${ers.col}" stroke-width="2.2" filter="url(#neonGlow)"/>
        <text x="224" y="113" text-anchor="middle" fill="#fff" font-size="8.5" font-weight="800" font-family="monospace">${esc(ers.short)} ${ers.h}%</text>

        <rect x="136" y="92" width="58" height="36" rx="5" fill="${ice.col}" fill-opacity="0.35" stroke="${ice.col}" stroke-width="2.4" filter="url(#neonGlow)"/>
        <text x="165" y="114" text-anchor="middle" fill="#fff" font-size="9.5" font-weight="800" font-family="monospace">${esc(ice.short)} ${ice.h}%</text>

        <rect x="86" y="98" width="44" height="24" rx="4" fill="${gbx.col}" fill-opacity="0.35" stroke="${gbx.col}" stroke-width="2.2" filter="url(#neonGlow)"/>
        <text x="108" y="113" text-anchor="middle" fill="#fff" font-size="8.5" font-weight="800" font-family="monospace">${esc(gbx.short)} ${gbx.h}%</text>

        <g font-family="monospace" font-size="9.5" font-weight="700">
          <text x="16" y="19" fill="${gbx.col}">${esc(gbx.short)} ${gbx.h}% · ${gbx.t}°C</text>
          <text x="150" y="19" fill="${ice.col}">${esc(ice.short)} ${ice.h}% · ${ice.t}°C</text>
          <text x="288" y="19" fill="${brk.col}">${esc(brk.short)} ${brk.h}% · ${brk.t}°C</text>
          <text x="16" y="209" fill="${flr.col}">${esc(flr.short)} ${flr.h}%</text>
          <text x="150" y="209" fill="${ers.col}">${esc(ers.short)} ${ers.h}% · ${ers.t}°C</text>
          <text x="288" y="209" fill="${sus.col}">${esc(sus.short)} ${sus.h}%</text>
        </g>
      </svg>
    `;
  }

  function buildTacticsTrajectorySvg(dna) {
    const vScore = Number((dna && dna.corner_style_v) ?? 50); // 0=Pure U-Line .. 100=Pure V-Line
    const wetMastery = Number((dna && dna.wet_mastery) ?? 75);
    const isV = vScore >= 52;
    return `
      <svg viewBox="0 0 420 215" class="eng-xray-svg" aria-label="V-Line vs U-Line Cornering Trajectory Diagram">
        <!-- Corner Asphalt Ribbon (90-degree heavy braking hairpin) -->
        <path d="M 36,184 L 36,68 Q 36,36 74,36 L 386,36 L 386,104 L 122,104 Q 108,104 108,118 L 108,184 Z" fill="#1e293b" stroke="#475569" stroke-width="2"/>
        <!-- Apex Kerb -->
        <path d="M 104,104 L 126,104 L 126,112 L 112,112 L 112,126 L 104,126 Z" fill="#ef4444"/>
        <!-- Wet Off-Line Anti-Rubber Groove (outer unpolished tarmac) -->
        <path d="M 52,182 L 52,58 Q 52,48 72,48 L 380,48" fill="none" stroke="rgba(56,189,248,0.55)" stroke-width="3" stroke-dasharray="6,4"/>
        <!-- U-Line (Momentum Arc — Prost / Clark / Button) -->
        <path d="M 62,182 C 62,112 78,76 154,70 L 380,72" fill="none" stroke="#22c55e" stroke-width="${isV ? 2.2 : 4.2}" stroke-opacity="${isV ? 0.55 : 0.98}"/>
        <!-- V-Line (Point & Squirt — Verstappen / Senna / Ricciardo) -->
        <path d="M 58,182 L 60,72 Q 66,58 106,96 L 380,82" fill="none" stroke="#f97316" stroke-width="${isV ? 4.2 : 2.2}" stroke-opacity="${isV ? 0.98 : 0.55}"/>
        <!-- Labels -->
        <g font-family="monospace" font-size="9.5" font-weight="700">
          <text x="140" y="138" fill="#f97316">● V-LINE "POINT &amp; SQUIRT" (Late Brake · Sharp Rotation)</text>
          <text x="140" y="156" fill="#22c55e">● U-LINE "MOMENTUM ARC" (High Min-Speed · Tyre Save)</text>
          <text x="140" y="174" fill="#38bdf8">┅ WET ANTI-RUBBER OFF-LINE (${wetMastery}/100 Grip Hunt)</text>
          <text x="140" y="196" fill="#fde047">SIGNATURE: ${isV ? `V-LINE BIAS (${vScore}%)` : `U-LINE BIAS (${100 - vScore}%)`}</text>
        </g>
      </svg>
    `;
  }

  function drawSetupRadar(cvId, engObj) {
    const c = setupCanvas(cvId);
    if (!c || !engObj) return;
    const { ctx, w, h } = c;
    ctx.fillStyle = "#080e1c";
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5, cy = h * 0.52;
    const R = Math.min(w, h) * 0.35;
    const axes = [
      { k: "aeroBalance",  lbl: "AERO CoP" },
      { k: "rideHeight",   lbl: "RIDE HT" },
      { k: "diffLock",     lbl: "DIFF LOCK" },
      { k: "brakeBias",    lbl: "BRAKE BIAS" },
      { k: "camberWindow", lbl: "CAMBER" },
    ];
    const n = axes.length;

    // Concentric rings + radial spokes
    [0.25, 0.5, 0.75, 1.0].forEach((rf) => {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = -Math.PI * 0.5 + (i % n) * (Math.PI * 2 / n);
        const x = cx + Math.cos(a) * R * rf;
        const y = cy + Math.sin(a) * R * rf;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(148,163,184,0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    axes.forEach((ax, i) => {
      const a = -Math.PI * 0.5 + i * (Math.PI * 2 / n);
      const x = cx + Math.cos(a) * R;
      const y = cy + Math.sin(a) * R;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y);
      ctx.strokeStyle = "rgba(148,163,184,0.22)";
      ctx.stroke();
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "700 10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(ax.lbl, cx + Math.cos(a) * (R + 18), cy + Math.sin(a) * (R + 16) + 3);
    });

    const targets = engObj.targets || {};
    const actual = engObj.actual || {};
    const noiseR = ((engObj.feedback && engObj.feedback.noiseBand) || 8) / 100;

    // 1. Feedback Uncertainty Halo around Actual Setup (shrinks dramatically with elite Experience + Confidence + Engineer!)
    ctx.beginPath();
    axes.forEach((ax, i) => {
      const a = -Math.PI * 0.5 + i * (Math.PI * 2 / n);
      const v = Math.min(1, ((actual[ax.k] || 60) / 100) + noiseR);
      const x = cx + Math.cos(a) * R * v;
      const y = cy + Math.sin(a) * R * v;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(236, 72, 153, 0.16)";
    ctx.strokeStyle = "rgba(236, 72, 153, 0.55)";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Circuit Optimal Target Polygon (Glowing Emerald)
    ctx.beginPath();
    axes.forEach((ax, i) => {
      const a = -Math.PI * 0.5 + i * (Math.PI * 2 / n);
      const v = (targets[ax.k] || 60) / 100;
      const x = cx + Math.cos(a) * R * v;
      const y = cy + Math.sin(a) * R * v;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(34, 197, 94, 0.18)";
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2.2;
    ctx.fill();
    ctx.stroke();

    // 3. Actual Car Setup Polygon (Bright Electric Cyan)
    ctx.beginPath();
    axes.forEach((ax, i) => {
      const a = -Math.PI * 0.5 + i * (Math.PI * 2 / n);
      const v = (actual[ax.k] || 60) / 100;
      const x = cx + Math.cos(a) * R * v;
      const y = cy + Math.sin(a) * R * v;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(56, 189, 248, 0.24)";
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.4;
    ctx.fill();
    ctx.stroke();
  }

  function drawGGFrictionCircle(cvId, ggPoints) {
    const c = setupCanvas(cvId);
    if (!c) return;
    const { ctx, w, h } = c;
    ctx.fillStyle = "#080e1c";
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5, cy = h * 0.48;
    const R = Math.min(w, h) * 0.37;

    // 2G, 4G, 5.5G concentric grip rings
    [0.36, 0.72, 1.0].forEach((rf, idx) => {
      ctx.beginPath();
      ctx.arc(cx, cy, R * rf, 0, Math.PI * 2);
      ctx.strokeStyle = idx === 2 ? "rgba(56,189,248,0.28)" : "rgba(148,163,184,0.16)";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    ctx.strokeStyle = "rgba(148,163,184,0.22)";
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();

    ctx.fillStyle = "#94a3b8";
    ctx.font = "700 9.5px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("ACCEL +2G", cx, cy - R - 6);
    ctx.fillText("BRAKING -5G", cx, cy + R + 12);
    ctx.textAlign = "right";
    ctx.fillText("L -5G", cx - R - 5, cy + 3);
    ctx.textAlign = "left";
    ctx.fillText("R +5G", cx + R + 5, cy + 3);

    const pts = (ggPoints && ggPoints.length) ? ggPoints : [
      { gx: -3.6, gy: -1.4, tyreTemp: 98 }, { gx: 3.9, gy: -2.1, tyreTemp: 102 },
      { gx: 0.4, gy: -4.4, tyreTemp: 106 }, { gx: -2.8, gy: 1.2, tyreTemp: 96 },
      { gx: 2.6, gy: 1.4, tyreTemp: 100 }, { gx: -4.2, gy: -0.6, tyreTemp: 112 },
    ];
    pts.forEach((pt) => {
      const px = cx + (pt.gx / 5.5) * R;
      const py = cy - (pt.gy / 5.5) * R;
      const t = pt.tyreTemp || 98;
      const col = t > 112 ? "#ef4444" : (t < 86 ? "#38bdf8" : "#22c55e");
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(px, py, 4.2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1.0;
  }

  function renderEngineerLab() {
    const box = modalEl.querySelector("#ras-pane-engineer");
    const p = state.payload;
    const stints = (p && p.stints) || [];
    const drivers = (p && p.drivers) || [];
    if (!drivers.length) {
      box.innerHTML = `<div class="muted" style="padding:20px;">No driver engineering telemetry available yet.</div>`;
      return;
    }

    const sortedStints = stints.slice().sort((a, b) => (a.dnf !== b.dnf ? (a.dnf ? 1 : -1) : (a.finishPos || 99) - (b.finishPos || 99)));
    if (state.engDrvIdx < 0 || !drivers.some((d) => d.idx === state.engDrvIdx)) {
      state.engDrvIdx = state.focusDrvIdx >= 0 ? state.focusDrvIdx : (sortedStints[0]?.idx ?? drivers[0].idx);
    }

    const drv = drivers.find((d) => d.idx === state.engDrvIdx) || drivers[0];
    const stint = stints.find((s) => s.idx === drv.idx) || sortedStints[0] || {};
    const frames = p.frames || [];
    const fr = frames[state.scrubIdx] || frames[frames.length - 1] || {};
    const frCar = (fr.cars || []).find((c) => c.idx === drv.idx) || {};
    const compSnap = (frCar.components && Object.keys(frCar.components).length) ? frCar.components : (stint.components || {});
    const eraKey = p.eraKey || p.eraLabel || "2026";
    const eraDefs = (ENG && ENG.getEraComponents) ? ENG.getEraComponents(eraKey) : COMP_META;
    const compKeys = (ENG && ENG.COMP_KEYS) || ["ice", "ers", "gearbox", "brakes", "floor", "suspension"];

    const engObj = stint.engineering || {
      setupAccuracy: 82, balanceBias: 0, setupPaceDeltaS: 0,
      targets: { aeroBalance: 60, rideHeight: 55, diffLock: 58, brakeBias: 66, camberWindow: 65 },
      actual: { aeroBalance: 58, rideHeight: 57, diffLock: 60, brakeBias: 65, camberWindow: 62 },
      feedback: {
        score: 78, tier: "CLEAR", noiseBand: 7.4,
        weights: {
          experience: { pct: 28, raw: 74, contrib: 20.7, color: "#38bdf8" },
          engineer:   { pct: 24, raw: 86, contrib: 20.6, color: "#a855f7" },
          quality:    { pct: 18, raw: 80, contrib: 14.4, color: "#facc15" },
          confidence: { pct: 18, raw: 70, contrib: 12.6, color: "#22c55e" },
          momentum:   { pct: 12, raw: 60, contrib: 7.2,  color: "#f97316" },
        },
      },
      ggPoints: [],
    };
    const fb = engObj.feedback || {};
    const weights = fb.weights || {};
    const simActual = Object.assign({}, engObj.actual || {}, state.whatIfOverrides || {});
    const targets = engObj.targets || { aeroBalance: 60, rideHeight: 55, diffLock: 58, brakeBias: 66, camberWindow: 65 };
    const simAvgErr = ["aeroBalance", "rideHeight", "diffLock", "brakeBias", "camberWindow"].reduce(
      (acc, k) => acc + Math.abs((simActual[k] || 60) - (targets[k] || 60)), 0
    ) / 5;
    const simAcc = Math.round(Math.max(48, Math.min(99, 100 - simAvgErr * 1.85)));
    const simDeltaS = +((78 - simAcc) * 0.011).toFixed(3);
    const simBalBias = Math.round(Math.max(-85, Math.min(85, ((simActual.aeroBalance || 60) - (targets.aeroBalance || 60)) * 1.4 - ((simActual.diffLock || 58) - (targets.diffLock || 58)) * 0.9)));
    const balPct = Math.max(4, Math.min(96, 50 + simBalBias * 0.55));
    const balText = simBalBias < -18 ? `UNDERSTEER (${simBalBias})` : (simBalBias > 18 ? `OVERSTEER (+${simBalBias})` : `NEUTRAL SWEET-SPOT (${simBalBias >= 0 ? "+" : ""}${simBalBias})`);
    const issues = stint.compIssues || [];

    const drvPills = sortedStints.slice(0, 14).map((s) => `
      <button type="button" class="eng-drv-pill${s.idx === drv.idx ? " active" : ""}" data-eng-drv="${s.idx}" style="--ec:${esc(s.color)}">
        <i></i><b>${esc(s.code3)}</b><span>P${s.finishPos || "-"}</span>
        ${(s.compIssues && s.compIssues.length) ? `<em class="eng-pill-warn" title="${s.compIssues.length} component alerts">⚠</em>` : ""}
      </button>
    `).join("");

    const subTab = state.engSubTab || "xray";
    let stageHtml = "";

    if (subTab === "xray") {
      const compCards = compKeys.map((ck) => {
        const def = eraDefs[ck] || COMP_META[ck] || { label: ck, short: ck.toUpperCase(), area: "System", baseTemp: 85 };
        const v = compSnap[ck] || {};
        const h = Math.round(Number(v.h ?? v.health ?? 95));
        const t = Math.round(Number(v.t ?? v.temp ?? def.baseTemp ?? 85));
        const col = healthColor(h);
        return `
          <div class="eng-comp-tile" style="--cc:${col}">
            <div class="eng-comp-top"><b>${esc(def.label)}</b><span style="color:${col}">${h}%</span></div>
            <div class="eng-comp-bar"><i style="width:${h}%;background:${col}"></i></div>
            <div class="eng-comp-meta"><span>${esc(def.area)}</span><span>${t}°C</span></div>
          </div>
        `;
      }).join("");
      const issueHtml = issues.length
        ? issues.slice(-4).map((iss) => `
            <div class="eng-iss-row sev-${esc(iss.severity)}">
              <b>L${iss.lap}</b>
              <span>${esc(iss.label)} (${iss.health}% · ${iss.temp}°C)${iss.kphLoss ? ` · -${iss.kphLoss} kph` : ""}</span>
              <small>+${iss.paceLossS}s/L</small>
            </div>
          `).join("")
        : `<div class="eng-iss-ok"><i class="fas fa-check-circle"></i> All 6 ${esc(eraDefs.eraBadge || "F1")} subsystems within nominal envelope.</div>`;

      stageHtml = `
        <div class="ras-card">
          <div class="ras-card-head"><span><i class="fas fa-car"></i> ${esc(eraDefs.eraBadge || "F1")} THERMAL X-RAY (LAP ${fr.lap || 0})</span><small>Era-Authentic Chassis</small></div>
          ${buildChassisXraySvg(compSnap, eraKey)}
          <div class="eng-iss-list">${issueHtml}</div>
        </div>
        <div class="ras-card">
          <div class="ras-card-head"><span><i class="fas fa-microchip"></i> 6 LIVE SUBSYSTEM TELEMETRY CHANNELS</span><small>Wear · Temp °C</small></div>
          <div class="eng-comp-grid">${compCards}</div>
          <p class="muted small" style="margin:8px 0 0;line-height:1.35;">
            Subsystems automatically match the <b>${esc(eraDefs.eraBadge || "2026")}</b> technical regulations — no anachronistic hybrid/ERS telemetry on classic chassis.
          </p>
        </div>
      `;
    } else if (subTab === "setup") {
      const sliders = [
        { k: "aeroBalance",  lbl: "Front Wing / CoP" },
        { k: "rideHeight",   lbl: "Ride Height" },
        { k: "diffLock",     lbl: "Diff Entry Lock" },
        { k: "brakeBias",    lbl: "Brake Migration" },
        { k: "camberWindow", lbl: "Camber Window" },
      ].map((s) => `
        <div class="eng-sim-row">
          <label for="eng-sl-${s.k}">${s.lbl}</label>
          <input id="eng-sl-${s.k}" type="range" min="15" max="95" value="${Math.round(simActual[s.k] || 60)}" data-eng-sim="${s.k}">
          <span id="eng-sv-${s.k}">${Math.round(simActual[s.k] || 60)}</span>
        </div>
      `).join("");
      stageHtml = `
        <div class="ras-card">
          <div class="ras-card-head"><span><i class="fas fa-drafting-compass"></i> 5-AXIS SETUP RADAR &amp; UNCERTAINTY HALO</span><small>Green=Target · Cyan=Car · Pink=Noise</small></div>
          <canvas id="ras-cv-radar" class="eng-sub-canvas"></canvas>
          <div class="eng-bal-meter">
            <div class="eng-bal-labels"><span>◀ UNDERSTEER</span><b id="eng-bal-txt">${balText}</b><span>OVERSTEER ▶</span></div>
            <div class="eng-bal-track"><i id="eng-bal-pin" style="left:${balPct}%"></i></div>
          </div>
        </div>
        <div class="ras-card">
          <div class="ras-card-head">
            <span><i class="fas fa-sliders-h"></i> INTERACTIVE WHAT-IF SETUP SIMULATOR</span>
            <button type="button" id="eng-sim-reset" class="ras-play-btn" style="padding:2px 8px;font-size:.66rem;">Reset</button>
          </div>
          <div class="eng-sim-list">${sliders}</div>
          <div class="eng-sim-readout">
            <span>Predicted Convergence: <b id="eng-sim-acc" style="color:#22c55e">${simAcc}%</b></span>
            <span>Lap Delta: <b id="eng-sim-delta" style="color:${simDeltaS <= 0 ? "#4ade80" : "#facc15"}">${simDeltaS <= 0 ? "" : "+"}${simDeltaS.toFixed(3)}s/L</b></span>
          </div>
        </div>
      `;
    } else if (subTab === "feedback") {
      const weightSegs = Object.keys(weights).map((wk) => {
        const wObj = weights[wk];
        const lbl = wk.slice(0, 4).toUpperCase();
        return `<div class="eng-w-seg" style="width:${wObj.pct}%;background:${wObj.color}" title="${wk}: ${wObj.raw}/100 × ${wObj.pct}% = +${wObj.contrib}">${lbl} ${wObj.pct}%</div>`;
      }).join("");
      const weightRows = Object.keys(weights).map((wk) => {
        const wObj = weights[wk];
        return `
          <div class="eng-w-row">
            <span class="eng-w-name"><i style="background:${wObj.color}"></i>${wk.toUpperCase()} (${wObj.pct}% wt)</span>
            <div class="eng-w-bar"><b style="width:${wObj.raw}%;background:${wObj.color}"></b></div>
            <span class="eng-w-val">${wObj.raw} <small>(+${wObj.contrib})</small></span>
          </div>
        `;
      }).join("");
      stageHtml = `
        <div class="ras-card">
          <div class="ras-card-head"><span><i class="fas fa-wave-square"></i> WEIGHTED FEEDBACK SIGNAL MATRIX</span><small>Exp · Eng · Qual · Conf · Mom</small></div>
          <div class="eng-w-stacked">${weightSegs}</div>
          <div class="eng-w-rows">${weightRows}</div>
          <p class="muted small" style="margin:8px 0 0;line-height:1.35;">
            Signal Quality <b>${fb.score || 75}/100 (${esc(fb.tier || "CLEAR")})</b> narrows the setup uncertainty halo to <b>±${fb.noiseBand || 7}%</b> and flags mechanical wear <b>3–5 laps earlier</b>.
          </p>
        </div>
        <div class="ras-card">
          <div class="ras-card-head"><span><i class="fas fa-bullseye"></i> G-G FRICTION CIRCLE &amp; TYRE THERMAL WINDOW</span><small>Blue=Cold · Green=Sweet · Red=Hot</small></div>
          <canvas id="ras-cv-gg" class="eng-sub-canvas"></canvas>
        </div>
      `;
    } else {
      const dna = drv.dna || stint.dna || {
        corner_style_v: 55, wet_mastery: 78, street_precision: 76,
        launch_reaction_s: 0.21, late_braking: 80, defense_ruthless: 74,
        tyre_preservation: 76, mech_sympathy: 75, archetype: "All-Round Racer",
        radio_style: "Rhythmic Strategist", traits: ["Adaptive Line", "Balanced Traction"],
      };
      const meters = [
        { lbl: "Wet Off-Line Mastery", val: dna.wet_mastery ?? 75, txt: `${Math.round(dna.wet_mastery ?? 75)}`, col: "#38bdf8" },
        { lbl: "Street Precision",     val: dna.street_precision ?? 75, txt: `${Math.round(dna.street_precision ?? 75)}`, col: "#a855f7" },
        { lbl: "Late-Braking Send",    val: dna.late_braking ?? 76, txt: `${Math.round(dna.late_braking ?? 76)}`, col: "#f97316" },
        { lbl: "Defensive Craft",      val: dna.defense_ruthless ?? 74, txt: `${Math.round(dna.defense_ruthless ?? 74)}`, col: "#ef4444" },
        { lbl: "Tyre Preservation",    val: dna.tyre_preservation ?? 76, txt: `${Math.round(dna.tyre_preservation ?? 76)}`, col: "#22c55e" },
        { lbl: "Mechanical Sympathy",  val: dna.mech_sympathy ?? 75, txt: `${Math.round(dna.mech_sympathy ?? 75)}`, col: "#facc15" },
      ].map((m) => `
        <div class="eng-dna-row">
          <span>${m.lbl}</span>
          <div class="eng-w-bar"><b style="width:${Math.max(10, Math.min(100, m.val))}%;background:${m.col}"></b></div>
          <b>${m.txt}</b>
        </div>
      `).join("");
      const traits = (dna.traits || []).map((t) => `<span class="eng-dna-chip">${esc(t)}</span>`).join("");
      stageHtml = `
        <div class="ras-card">
          <div class="ras-card-head"><span><i class="fas fa-route"></i> CORNERING GEOMETRY: V-LINE VS U-LINE</span><small>Wet Off-Line Grip</small></div>
          ${buildTacticsTrajectorySvg(dna)}
        </div>
        <div class="ras-card">
          <div class="ras-card-head"><span><i class="fas fa-dna"></i> DRIVER DNA &amp; TACTICAL SIGNATURE</span><small>Launch ${(dna.launch_reaction_s || 0.22).toFixed(2)}s</small></div>
          <div class="eng-dna-badges">
            <span class="eng-dna-chip" style="background:rgba(250,204,21,.16);border-color:rgba(250,204,21,.45);color:#fde047;">★ ${esc(dna.archetype || "Grand Prix Racer")}</span>
            <span class="eng-dna-chip" style="background:rgba(168,85,247,.16);border-color:rgba(168,85,247,.45);color:#e9d5ff;">🎙 ${esc(dna.radio_style || "Balanced Comms")}</span>
            ${traits}
          </div>
          <div class="eng-dna-meters">${meters}</div>
        </div>
      `;
    }

    box.innerHTML = `
      <div class="eng-lab-wrap">
        <div class="eng-top-row"><div class="eng-drv-strip">${drvPills}</div></div>
        <div class="eng-lab-banner" style="border-left:4px solid ${esc(drv.color)}">
          <div>
            <strong>${esc(drv.name)} <small class="muted">(${esc(drv.team)})</small><span class="eng-era-badge">${esc(eraDefs.eraBadge || "2026")}</span></strong>
            <div class="muted small">Race Engineer: <b>${esc(drv.engineerName || "Race Engineer")}</b> (OVR ${drv.engineerRating || 84}) · Scrubbed Lap ${fr.lap || 0}</div>
          </div>
          <div class="eng-kpis">
            <div class="eng-kpi"><small>SIGNAL QUALITY</small><b style="color:#38bdf8">${fb.score || 75}/100</b><em>${esc(fb.tier || "CLEAR")} (±${fb.noiseBand || 7}%)</em></div>
            <div class="eng-kpi"><small>SETUP TARGET</small><b style="color:#22c55e">${engObj.setupAccuracy || 80}%</b><em>${engObj.setupPaceDeltaS <= 0 ? "" : "+"}${Number(engObj.setupPaceDeltaS || 0).toFixed(2)}s/L</em></div>
            <div class="eng-kpi"><small>WEAR COST</small><b style="color:${(stint.compPaceLossS || 0) > 0.25 ? "#ef4444" : "#facc15"}">+${Number(stint.compPaceLossS || 0).toFixed(2)}s/L</b><em>${stint.compKphLoss ? `-${stint.compKphLoss} kph trap` : "Nominal"}</em></div>
          </div>
        </div>

        <div class="eng-subtabs" role="tablist" aria-label="Engineer Lab Views">
          <button type="button" class="eng-stab${subTab === "xray" ? " active" : ""}" data-eng-stab="xray"><i class="fas fa-car"></i> Chassis X-Ray &amp; Wear</button>
          <button type="button" class="eng-stab${subTab === "setup" ? " active" : ""}" data-eng-stab="setup"><i class="fas fa-drafting-compass"></i> Setup Radar &amp; What-If Sim</button>
          <button type="button" class="eng-stab${subTab === "feedback" ? " active" : ""}" data-eng-stab="feedback"><i class="fas fa-bullseye"></i> Feedback Signal &amp; G-G Lab</button>
          <button type="button" class="eng-stab${subTab === "tactics" ? " active" : ""}" data-eng-stab="tactics"><i class="fas fa-dna"></i> Tactics &amp; Driver DNA</button>
        </div>

        <div class="eng-stage-grid">${stageHtml}</div>
      </div>
    `;

    box.querySelectorAll("[data-eng-drv]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.engDrvIdx = Number(btn.dataset.engDrv);
        state.whatIfOverrides = null;
        renderEngineerLab();
      });
    });
    box.querySelectorAll("[data-eng-stab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.engSubTab = btn.dataset.engStab;
        renderEngineerLab();
      });
    });
    if (subTab === "setup") {
      const simObj = Object.assign({}, engObj, { actual: simActual });
      requestAnimationFrame(() => drawSetupRadar("ras-cv-radar", simObj));
      box.querySelectorAll("[data-eng-sim]").forEach((sl) => {
        sl.addEventListener("input", () => {
          const k = sl.dataset.engSim;
          if (!state.whatIfOverrides) state.whatIfOverrides = Object.assign({}, engObj.actual || {});
          state.whatIfOverrides[k] = Number(sl.value);
          const sv = box.querySelector(`#eng-sv-${k}`);
          if (sv) sv.textContent = sl.value;
          const avgErr = ["aeroBalance", "rideHeight", "diffLock", "brakeBias", "camberWindow"].reduce(
            (acc, key) => acc + Math.abs((state.whatIfOverrides[key] ?? 60) - (targets[key] ?? 60)), 0
          ) / 5;
          const acc = Math.round(Math.max(48, Math.min(99, 100 - avgErr * 1.85)));
          const dS = +((78 - acc) * 0.011).toFixed(3);
          const bBias = Math.round(Math.max(-85, Math.min(85, ((state.whatIfOverrides.aeroBalance ?? 60) - (targets.aeroBalance ?? 60)) * 1.4 - ((state.whatIfOverrides.diffLock ?? 58) - (targets.diffLock ?? 58)) * 0.9)));
          const aEl = box.querySelector("#eng-sim-acc");
          const dEl = box.querySelector("#eng-sim-delta");
          const bTxt = box.querySelector("#eng-bal-txt");
          const bPin = box.querySelector("#eng-bal-pin");
          if (aEl) aEl.textContent = `${acc}%`;
          if (dEl) { dEl.textContent = `${dS <= 0 ? "" : "+"}${dS.toFixed(3)}s/L`; dEl.style.color = dS <= 0 ? "#4ade80" : "#facc15"; }
          if (bTxt) bTxt.textContent = bBias < -18 ? `UNDERSTEER (${bBias})` : (bBias > 18 ? `OVERSTEER (+${bBias})` : `NEUTRAL SWEET-SPOT (${bBias >= 0 ? "+" : ""}${bBias})`);
          if (bPin) bPin.style.left = `${Math.max(4, Math.min(96, 50 + bBias * 0.55))}%`;
          drawSetupRadar("ras-cv-radar", Object.assign({}, engObj, { actual: state.whatIfOverrides }));
        });
      });
      box.querySelector("#eng-sim-reset")?.addEventListener("click", () => {
        state.whatIfOverrides = null;
        renderEngineerLab();
      });
    } else if (subTab === "feedback") {
      requestAnimationFrame(() => drawGGFrictionCircle("ras-cv-gg", engObj.ggPoints || []));
    }
  }

  function setupCanvas(id) {
    const cv = modalEl.querySelector(`#${id}`);
    if (!cv) return null;
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 420;
    const h = cv.clientHeight || 220;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function drawChartBase(ctx, w, h, frames, yTicks, yFmt) {
    const pad = { l: 52, r: 22, t: 22, b: 32 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;
    const maxF = Math.max(1, frames.length - 1);

    ctx.fillStyle = "#0b1120";
    ctx.fillRect(0, 0, w, h);

    frames.forEach((f, i) => {
      const x0 = pad.l + (i / maxF) * pw;
      const bw = Math.max(4, pw / maxF);
      if ((f.wetness || 0) >= 25) {
        ctx.fillStyle = `rgba(56, 189, 248, ${Math.min(0.22, (f.wetness / 100) * 0.22)})`;
        ctx.fillRect(x0 - bw * 0.5, pad.t, bw, ph);
      }
      if (f.sc || f.vsc) {
        ctx.fillStyle = "rgba(250, 204, 21, 0.16)";
        ctx.fillRect(x0 - bw * 0.5, pad.t, bw, ph);
      }
    });

    ctx.font = "600 10px ui-monospace, monospace";
    ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
    ctx.lineWidth = 1;
    yTicks.forEach(({ frac, label }) => {
      const y = pad.t + frac * ph;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke();
      ctx.fillStyle = "#94a3b8";
      ctx.textAlign = "right";
      ctx.fillText(yFmt ? yFmt(label) : String(label), pad.l - 8, y + 3);
    });

    const step = Math.max(1, Math.ceil(frames.length / 10));
    ctx.textAlign = "center";
    for (let i = 0; i < frames.length; i += step) {
      const x = pad.l + (i / maxF) * pw;
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(`L${frames[i].lap}`, x, h - 10);
    }

    const sx = pad.l + (Math.min(state.scrubIdx, maxF) / maxF) * pw;
    ctx.strokeStyle = "rgba(250, 204, 21, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(sx, pad.t); ctx.lineTo(sx, pad.t + ph); ctx.stroke();
    ctx.setLineDash([]);

    return { pad, pw, ph, maxF };
  }

  function renderPositionChart() {
    const frames = (state.payload && state.payload.frames) || [];
    const c = setupCanvas("ras-cv-positions");
    if (!c || !frames.length) return;
    const totalCars = Math.max(2, (state.payload.drivers || []).length || 20);
    const yTicks = [1, 5, 10, 15, totalCars].map((v) => ({ frac: (v - 1) / Math.max(1, totalCars - 1), label: `P${v}` }));
    const { pad, pw, ph, maxF } = drawChartBase(c.ctx, c.w, c.h, frames, yTicks);

    const sel = getSelectedDrivers();
    sel.forEach((drv) => {
      const isHi = drv.idx === state.focusDrvIdx || drv.isPlayer;
      c.ctx.strokeStyle = drv.color || "#38bdf8";
      c.ctx.lineWidth = isHi ? 3.2 : 2.0;
      c.ctx.beginPath();
      let started = false;
      frames.forEach((fr, i) => {
        const entry = (fr.cars || []).find((x) => x.idx === drv.idx);
        if (!entry || entry.dnf) return;
        const x = pad.l + (i / maxF) * pw;
        const y = pad.t + ((entry.pos - 1) / Math.max(1, totalCars - 1)) * ph;
        if (!started) { c.ctx.moveTo(x, y); started = true; } else c.ctx.lineTo(x, y);
      });
      c.ctx.stroke();
    });
    modalEl.querySelector("#ras-leg-positions").innerHTML = sel.map((d) =>
      `<span class="ras-leg-item"><i style="background:${esc(d.color)}"></i><b>${esc(d.code3)}</b> ${esc(d.name)}</span>`
    ).join("");
  }

  function renderPaceChart() {
    const frames = (state.payload && state.payload.frames) || [];
    const c = setupCanvas("ras-cv-pace");
    if (!c || !frames.length) return;
    const sel = getSelectedDrivers();
    let maxGap = 15;
    frames.forEach((fr) => {
      sel.forEach((d) => {
        const e = (fr.cars || []).find((x) => x.idx === d.idx);
        if (e && !e.dnf && e.gap < 180) maxGap = Math.max(maxGap, e.gap);
      });
    });
    maxGap = Math.ceil(maxGap / 5) * 5;
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ frac: f, label: `+${Math.round(f * maxGap)}s` }));
    const { pad, pw, ph, maxF } = drawChartBase(c.ctx, c.w, c.h, frames, yTicks);

    sel.forEach((drv) => {
      c.ctx.strokeStyle = drv.color || "#38bdf8";
      c.ctx.lineWidth = drv.idx === state.focusDrvIdx || drv.isPlayer ? 3.0 : 2.0;
      c.ctx.beginPath();
      let started = false;
      frames.forEach((fr, i) => {
        const e = (fr.cars || []).find((x) => x.idx === drv.idx);
        if (!e || e.dnf) return;
        const x = pad.l + (i / maxF) * pw;
        const y = pad.t + (Math.min(maxGap, e.gap) / Math.max(1, maxGap)) * ph;
        if (!started) { c.ctx.moveTo(x, y); started = true; } else c.ctx.lineTo(x, y);
      });
      c.ctx.stroke();
    });
    modalEl.querySelector("#ras-leg-pace").innerHTML =
      `<span class="muted small">Gap to Leader (seconds) · Shaded Yellow = SC · Shaded Blue = Rain</span>` +
      sel.map((d) => `<span class="ras-leg-item"><i style="background:${esc(d.color)}"></i><b>${esc(d.code3)}</b></span>`).join("");
  }

  function renderTyreStints() {
    const box = modalEl.querySelector("#ras-pane-tyres");
    const p = state.payload;
    const tot = Math.max(1, p.totalLaps || 15);
    const stints = (p.stints || []).slice().sort((a, b) => (a.dnf !== b.dnf ? (a.dnf ? 1 : -1) : a.finishPos - b.finishPos));
    const scrubLap = ((p.frames || [])[state.scrubIdx] || {}).lap || 0;
    const curPct = Math.min(100, Math.round((scrubLap / tot) * 100));

    box.innerHTML = `
      <div class="ras-card ras-scroll">
        <div class="ras-card-head"><span>TYRE STRATEGY &amp; STINT GANTT (${tot} LAPS)</span><small>Yellow line = Scrubbed Lap ${scrubLap}</small></div>
        <div class="ras-gantt">
          ${stints.map((s) => {
            const segs = (s.stints && s.stints.length ? s.stints : [{ compound: "medium", startLap: 1, endLap: tot }]).map((st) => {
              const comp = COMPOUNDS[st.compound] || COMPOUNDS.medium;
              const start = Math.max(1, st.startLap || 1);
              const end = Math.min(tot, Math.max(start, st.endLap || tot));
              const wPct = Math.max(4, ((end - start + 1) / tot) * 100);
              return `<span class="ras-stint-seg" style="width:${wPct.toFixed(1)}%;background:${comp.color};color:${comp.code === "H" || comp.code === "M" ? "#0f172a" : "#fff"}" title="${st.compound.toUpperCase()} L${start}-L${end}">${comp.code} ${end - start + 1}L</span>`;
            }).join("");
            return `
              <div class="ras-gantt-row">
                <span class="ras-g-pos">${s.dnf ? "DNF" : "P" + s.finishPos}</span>
                <span class="ras-g-drv"><i class="tt-bar" style="background:${esc(s.color)}"></i><b>${esc(s.code3)}</b></span>
                <div class="ras-g-track">${segs}<i class="ras-g-cursor" style="left:${curPct}%"></i></div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  function renderPsychChart() {
    const frames = (state.payload && state.payload.frames) || [];
    const c = setupCanvas("ras-cv-psych");
    if (!c || !frames.length) return;
    const yTicks = [100, 82, 60, 40, 28, 0].map((v) => ({ frac: (100 - v) / 100, label: String(v) }));
    const { pad, pw, ph, maxF } = drawChartBase(c.ctx, c.w, c.h, frames, yTicks);

    c.ctx.fillStyle = "rgba(34, 197, 94, 0.08)";
    c.ctx.fillRect(pad.l, pad.t, pw, ph * 0.18);
    c.ctx.fillStyle = "rgba(239, 68, 68, 0.08)";
    c.ctx.fillRect(pad.l, pad.t + ph * 0.72, pw, ph * 0.28);

    const sel = getSelectedDrivers();
    sel.forEach((drv) => {
      c.ctx.strokeStyle = drv.color || "#38bdf8";
      c.ctx.lineWidth = drv.idx === state.focusDrvIdx || drv.isPlayer ? 3.2 : 2.0;
      c.ctx.beginPath();
      let started = false;
      frames.forEach((fr, i) => {
        const e = (fr.cars || []).find((x) => x.idx === drv.idx);
        if (!e) return;
        const x = pad.l + (i / maxF) * pw;
        const y = pad.t + ((100 - (e.conf ?? 60)) / 100) * ph;
        if (!started) { c.ctx.moveTo(x, y); started = true; } else c.ctx.lineTo(x, y);
      });
      c.ctx.stroke();
    });
    modalEl.querySelector("#ras-leg-psych").innerHTML =
      `<span class="muted small">Driver Confidence (0–100) · Green Band = IN THE ZONE (≥82) · Red Band = SHAKEN (≤28)</span>` +
      sel.map((d) => `<span class="ras-leg-item"><i style="background:${esc(d.color)}"></i><b>${esc(d.code3)}</b></span>`).join("");
  }

  // ---------------------------------------------------------------------------
  // TAB 7: STRICT IN-RACE RADIO DIAGNOSTICS vs POST-RACE MEDIA PEN INTERVIEWS
  // ---------------------------------------------------------------------------
  function renderRadioLogMarkup(radioList, isFinished) {
    const filtered = (radioList || []).filter((r) => {
      if (state.radioFilter === "all") return true;
      return r.category === state.radioFilter;
    }).slice().reverse();

    const mechCount = (radioList || []).filter((r) => r.category === "mechanical").length;
    const setupCount = (radioList || []).filter((r) => r.category === "setup").length;

    const lockBanner = !isFinished
      ? `
        <div class="eng-lock-banner">
          <i class="fas fa-lock"></i>
          <div>
            <strong>POST-RACE MEDIA PEN LOCKED WHILE RACING</strong>
            <span>Driver interviews unlock permanently only once the <b>Chequered Flag</b> falls so quotes reflect final results. Live driver-engineer radio &amp; car wear diagnostics stream below.</span>
          </div>
        </div>
      `
      : "";

    const rowsHtml = filtered.length
      ? filtered.map((r) => {
          const cDef = r.component && COMP_META[r.component];
          const compTag = cDef ? `<span class="eng-comp-badge" style="border-color:${cDef.color};color:${cDef.color}">${cDef.short} WEAR</span>` : "";
          const fbTag = r.feedbackQuality ? `<span class="eng-fb-badge">FBQ ${r.feedbackQuality}</span>` : "";
          return `
            <div class="eng-rlog-card cat-${esc(r.category || "race")} sev-${esc(r.severity || "info")}" style="border-left:4px solid ${esc(r.color)}">
              <div class="eng-rlog-top">
                <span class="eng-rlog-lap">L${r.lap}</span>
                <b>${esc(r.speaker)} → ${esc(r.to)}</b>
                ${compTag}
                ${fbTag}
                <span class="eng-cat-pill">${esc((r.category || "race").toUpperCase())}</span>
              </div>
              <div class="eng-rlog-quote">"${esc(r.text)}"</div>
              ${r.engReply ? `<div class="eng-rlog-reply"><i class="fas fa-headset"></i> ${esc(r.engReply)}</div>` : ""}
            </div>
          `;
        }).join("")
      : `<div class="muted" style="padding:18px;">No driver radio messages logged yet in this category — keep the race running to capture live driver &amp; component diagnostics!</div>`;

    return `
      ${lockBanner}
      <div class="eng-rlog-toolbar">
        <div class="eng-rlog-filters">
          <button type="button" class="eng-rf-btn${state.radioFilter === "all" ? " active" : ""}" data-rf="all">All (${(radioList || []).length})</button>
          <button type="button" class="eng-rf-btn${state.radioFilter === "mechanical" ? " active" : ""}" data-rf="mechanical">🔧 Mechanical &amp; Wear (${mechCount})</button>
          <button type="button" class="eng-rf-btn${state.radioFilter === "setup" ? " active" : ""}" data-rf="setup">🎛 Setup &amp; Balance (${setupCount})</button>
          <button type="button" class="eng-rf-btn${state.radioFilter === "race" ? " active" : ""}" data-rf="race">🏁 Race &amp; Strategy</button>
        </div>
      </div>
      <div class="eng-rlog-list ras-scroll">${rowsHtml}</div>
    `;
  }

  async function renderInterviews() {
    const box = modalEl.querySelector("#ras-pane-interviews");
    const p = state.payload;
    const isFinished = Boolean(p && p.raceFinished);
    const radioList = (p && p.radioLog) || [];

    // STRICT RULE: While the race is LIVE, show ONLY In-Race Radio Logs & Component Diagnostics!
    if (!isFinished) {
      box.innerHTML = `<div class="eng-rlog-shell">${renderRadioLogMarkup(radioList, false)}</div>`;
      box.querySelectorAll("[data-rf]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.radioFilter = btn.dataset.rf;
          renderInterviews();
        });
      });
      return;
    }

    // Post-Race: Toggle cleanly between Post-Race Media Pen Interviews & Full In-Race Radio Log
    const subBar = `
      <div class="eng-subbar">
        <button type="button" class="eng-sub-btn${state.radioSubTab === "interviews" ? " active" : ""}" data-rsub="interviews"><i class="fas fa-microphone-alt"></i> Post-Race Media Pen (Final)</button>
        <button type="button" class="eng-sub-btn${state.radioSubTab === "radio" ? " active" : ""}" data-rsub="radio"><i class="fas fa-headset"></i> Full In-Race Radio Log (${radioList.length})</button>
      </div>
    `;

    if (state.radioSubTab === "radio") {
      box.innerHTML = `<div class="eng-rlog-shell">${subBar}${renderRadioLogMarkup(radioList, true)}</div>`;
      box.querySelectorAll("[data-rsub]").forEach((b) => b.addEventListener("click", () => { state.radioSubTab = b.dataset.rsub; renderInterviews(); }));
      box.querySelectorAll("[data-rf]").forEach((b) => b.addEventListener("click", () => { state.radioFilter = b.dataset.rf; renderInterviews(); }));
      return;
    }

    if (!state.interviews) {
      box.innerHTML = `<div class="muted" style="padding:20px;">Generating grounded Post-Race Media Pen Interviews from final telemetry &amp; radio logs…</div>`;
      try {
        const res = await fetch("/api/sim/interviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telemetry: state.payload }),
        });
        const data = await res.json();
        state.interviewsLocked = Boolean(data.locked);
        state.interviews = data.interviews || [];
      } catch (err) {
        box.innerHTML = `<div class="muted" style="padding:20px;">Could not load interviews: ${esc(err.message)}</div>`;
        return;
      }
    }

    const list = state.interviews || [];
    if (!list.length) {
      box.innerHTML = `<div class="eng-rlog-shell">${subBar}<div class="muted" style="padding:20px;">No post-race interviews available.</div></div>`;
      box.querySelectorAll("[data-rsub]").forEach((b) => b.addEventListener("click", () => { state.radioSubTab = b.dataset.rsub; renderInterviews(); }));
      return;
    }
    const sel = list[state.selectedInterviewIdx] || list[0];
    const moodColors = { elated: "#22c55e", confident: "#38bdf8", mixed: "#cbd5e1", frustrated: "#f59e0b", shaken: "#ef4444" };

    // Depth extras: confidence band + parting quote + persona radio sign-off (all AI-composed).
    const bandChips = `
      <span class="ras-r-chip">CONFIDENCE: ${Number(sel.endConf || 0)}/100 (${esc(String(sel.confBand || "").toUpperCase())})</span>
      ${sel.mood ? `<span class="ras-r-chip">MOOD: ${esc(String(sel.mood).toUpperCase())}</span>` : ""}
    `;
    const drvRadioQuotes = (sel.driverRadio || []).length
      ? `
        <div class="eng-int-radios">
          <span class="ras-r-lbl"><i class="fas fa-headset"></i> RECORDED IN-RACE RADIO HIGHLIGHTS:</span>
          ${sel.driverRadio.slice(0, 4).map((rm) => `<div class="eng-int-rquote"><b>L${rm.lap}</b> "${esc(rm.text)}"</div>`).join("")}
        </div>
      `
      : "";
    const partingHtml = sel.partingQuote
      ? `
        <div class="eng-int-radios">
          <span class="ras-r-lbl"><i class="fas fa-microphone-alt"></i> PARTING QUOTE AT THE MEDIA PEN FENCE:</span>
          <div class="eng-int-rquote">"${esc(sel.partingQuote)}"</div>
        </div>
      `
      : "";

    box.innerHTML = `
      <div class="eng-int-shell">
        ${subBar}
        <div class="ras-int-grid">
          <div class="ras-int-list ras-scroll">
            ${list.map((r, i) => `
              <button type="button" class="ras-int-card${i === state.selectedInterviewIdx ? " active" : ""}" data-int-i="${i}" style="border-left:4px solid ${esc(r.color)}">
                <div class="ras-ic-top">
                  <b>${esc(r.code3)} · ${esc(r.name)}</b>
                  <span class="ras-rating">${Number(r.rating).toFixed(1)}/10</span>
                </div>
                <div class="ras-ic-meta">
                  <span>${r.dnf ? "DNF" : "P" + r.finishPos} (${r.posGain >= 0 ? "+" : ""}${r.posGain})</span>
                  <span style="color:${moodColors[r.mood] || "#cbd5e1"};font-weight:800;">${esc(r.mood.toUpperCase())}</span>
                  <span>FBQ ${r.feedbackScore || 75}</span>
                </div>
              </button>
            `).join("")}
          </div>
          <div class="ras-int-detail ras-scroll">
            <div class="ras-id-head" style="border-left:4px solid ${esc(sel.color)}">
              <div>
                <h3>${esc(sel.name)} <small class="muted">(${esc(sel.team)})</small></h3>
                <div class="muted small">${esc(sel.personaLabel)} · Engineer: <b>${esc(sel.engineerName)}</b> · Setup ${sel.setupAccuracy || 80}% · Feedback ${sel.feedbackScore || 75}/100</div>
              </div>
              <div class="ras-id-score">
                <strong>${Number(sel.rating).toFixed(1)}<small>/10</small></strong>
                <span>${sel.dnf ? "DNF" : `P${sel.gridPos} → P${sel.finishPos}`}</span>
              </div>
            </div>
            <div class="ras-reasons">
              <span class="ras-r-lbl"><i class="fas fa-brain"></i> GROUNDED RACE FACTS &amp; PERSPECTIVE:</span>
              ${(sel.perspectiveReasons || []).map((t) => `<span class="ras-r-chip">${esc(t)}</span>`).join("")}
              ${bandChips}
            </div>
            ${drvRadioQuotes}
            <div class="ras-qas">
              ${(sel.qas || []).map((qa) => `
                <div class="ras-qa-item">
                  <div class="ras-qa-topic">${esc(qa.topic)}</div>
                  <div class="ras-qa-q"><i class="fas fa-microphone"></i> "${esc(qa.q)}"</div>
                  <div class="ras-qa-a">"${esc(qa.a)}"</div>
                </div>
              `).join("")}
            </div>
            ${partingHtml}
          </div>
        </div>
      </div>
    `;
    box.querySelectorAll("[data-rsub]").forEach((b) => b.addEventListener("click", () => { state.radioSubTab = b.dataset.rsub; renderInterviews(); }));
    box.querySelectorAll("[data-int-i]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedInterviewIdx = Number(btn.dataset.intI) || 0;
        renderInterviews();
      });
    });
  }

  function renderActivePane() {
    if (!state.payload || !modalEl) return;
    if (state.activeTab === "overview") renderOverview();
    else if (state.activeTab === "engineer") renderEngineerLab();
    else if (state.activeTab === "positions") requestAnimationFrame(renderPositionChart);
    else if (state.activeTab === "pace") requestAnimationFrame(renderPaceChart);
    else if (state.activeTab === "tyres") renderTyreStints();
    else if (state.activeTab === "psych") requestAnimationFrame(renderPsychChart);
    else if (state.activeTab === "interviews") renderInterviews();
  }

  function open(payload, opts) {
    if (!payload || !payload.frames || !payload.frames.length) return;
    const o = opts || {};
    ensureModal();
    stopPlay();
    state.payload = payload;
    state.interviews = o.interviews || null;
    state.interviewsLocked = !payload.raceFinished;
    state.activeTab = o.initialTab || "overview";
    state.radioSubTab = payload.raceFinished ? "interviews" : "radio";
    state.scrubIdx = Math.max(0, payload.frames.length - 1);
    state.focusDrvIdx = o.focusDrvIdx != null ? o.focusDrvIdx : -1;
    state.engDrvIdx = state.focusDrvIdx;
    state.selectedInterviewIdx = 0;

    modalEl.querySelector("#ras-circuit-title").textContent = `${payload.circuitName || "Grand Prix"} — ${payload.totalLaps || 15} Laps`;
    modalEl.querySelector("#ras-era-sub").textContent = `${payload.eraLabel || ""}${payload.raceFinished ? " · FINAL TELEMETRY" : " · LIVE IN-RACE TELEMETRY"}`;

    const tabBtn = modalEl.querySelector("#ras-tab-int-btn");
    if (tabBtn) {
      tabBtn.innerHTML = payload.raceFinished
        ? `<i class="fas fa-microphone-alt"></i> Interviews &amp; Radio`
        : `<i class="fas fa-headset"></i> Live Radio Log`;
    }

    const slider = modalEl.querySelector("#ras-slider");
    slider.max = String(Math.max(0, payload.frames.length - 1));
    slider.value = String(state.scrubIdx);

    const pinsBox = modalEl.querySelector("#ras-event-pins");
    const maxLap = Math.max(1, payload.totalLaps || payload.frames.length);
    const keyEvents = (payload.events || []).filter((e) => ["sc", "rain", "dnf", "mistake", "incident", "component"].includes(e.type)).slice(0, 28);
    pinsBox.innerHTML = keyEvents.map((e) => {
      const pct = Math.min(98, Math.max(2, (e.lap / maxLap) * 100));
      return `<button type="button" class="ras-pin ras-pin-${esc(e.type)}" style="left:${pct.toFixed(1)}%" data-pin-lap="${e.lap}" title="L${e.lap}: ${esc(e.title)}"></button>`;
    }).join("");
    pinsBox.querySelectorAll("[data-pin-lap]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetLap = Number(btn.dataset.pinLap);
        const fIdx = payload.frames.findIndex((f) => f.lap >= targetLap);
        state.scrubIdx = fIdx >= 0 ? fIdx : payload.frames.length - 1;
        slider.value = String(state.scrubIdx);
        updateScrubberHeader();
        renderActivePane();
      });
    });

    const drvSel = modalEl.querySelector("#ras-drv-filter");
    drvSel.innerHTML = `<option value="-1">Highlight: Top Contenders</option>` +
      (payload.drivers || []).map((d) => `<option value="${d.idx}">${esc(d.code3)} — ${esc(d.name)} (${esc(d.team)})</option>`).join("");
    drvSel.value = String(state.focusDrvIdx);

    modalEl.querySelectorAll("[data-ras-tab]").forEach((b) => b.classList.toggle("active", b.dataset.rasTab === state.activeTab));
    modalEl.querySelectorAll(".ras-pane").forEach((p) => p.classList.toggle("active", p.id === `ras-pane-${state.activeTab}`));

    modalEl.classList.remove("hidden");
    updateScrubberHeader();
    renderActivePane();
  }

  global.F1RaceAnalytics = { open, close };
})(window);
