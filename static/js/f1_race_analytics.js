/**
 * Scrubbable Race Data Analysis Studio & Post-Race Interview Viewer (/sim & /career).
 *
 * Interactive Timeline Scrubber (Lap 0..N + Play/Pause + clickable Event Pins) driving 6 tabs:
 *   1. Overview & Live Classification at Scrubbed Lap
 *   2. Lap & Position Trajectory Chart (Canvas + SC/Rain bands)
 *   3. Gap to Leader & Pace Curve + Sector Dominance
 *   4. Tyre Strategy Stint Gantt + Weather Overlay
 *   5. Driver Confidence & Momentum Curve (0..100 & -100..+100)
 *   6. Driver Reports & Context-Aware Post-Race Interviews ("Why They Feel This Way")
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

  let modalEl = null;
  let state = {
    payload: null,
    interviews: null,
    activeTab: "overview",
    scrubIdx: 0,
    playing: false,
    playTimer: null,
    focusDrvIdx: -1,
    selectedInterviewIdx: 0,
  };

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
            <span class="ras-badge"><i class="fas fa-chart-area"></i> RACE DATA ANALYSIS STUDIO</span>
            <strong id="ras-circuit-title">Grand Prix Telemetry</strong>
            <small id="ras-era-sub" class="muted"></small>
          </div>
          <div class="ras-tabs" role="tablist">
            <button type="button" class="ras-tab active" data-ras-tab="overview"><i class="fas fa-list-ol"></i> Overview</button>
            <button type="button" class="ras-tab" data-ras-tab="positions"><i class="fas fa-project-diagram"></i> Position Chart</button>
            <button type="button" class="ras-tab" data-ras-tab="pace"><i class="fas fa-tachometer-alt"></i> Gap &amp; Pace</button>
            <button type="button" class="ras-tab" data-ras-tab="tyres"><i class="fas fa-dharmachakra"></i> Tyre Stints</button>
            <button type="button" class="ras-tab" data-ras-tab="psych"><i class="fas fa-brain"></i> Confidence &amp; Momentum</button>
            <button type="button" class="ras-tab" data-ras-tab="interviews"><i class="fas fa-microphone-alt"></i> Driver Interviews</button>
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
          <select id="ras-drv-filter" class="ras-drv-filter" title="Highlight Driver in Charts">
            <option value="-1">Highlight: Top Contenders</option>
          </select>
        </div>

        <div class="ras-body">
          <div id="ras-pane-overview" class="ras-pane active"></div>
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
    modalEl.querySelector("#ras-env-read").textContent = `${w >= 60 ? "🌧️ WET" : (w >= 22 ? "🌦️ DAMP" : "☀️ DRY")} ${w}%${scTag}`;
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
    const evsUpTo = (p.events || []).filter((e) => e.lap <= Math.max(1, fr.lap)).slice(-18).reverse();

    const rows = (fr.cars || []).map((c) => {
      const d = drvMap.get(c.idx) || { code3: "DRV", name: "Driver", team: "", color: "#64748b", gridPos: c.pos };
      const gain = (d.gridPos || c.pos) - c.pos;
      const gHtml = gain > 0 ? `<span class="tt-up">+${gain}</span>` : (gain < 0 ? `<span class="tt-dn">${gain}</span>` : `<span class="tt-muted">0</span>`);
      const comp = COMPOUNDS[c.comp] || COMPOUNDS.medium;
      const tier = ENG ? ENG.confidenceTier(c.conf) : { color: "#cbd5e1", label: "STD" };
      return `
        <tr class="${c.idx === state.focusDrvIdx ? "is-focus" : (d.isPlayer ? "is-player" : "")}">
          <td class="tt-pos">${c.dnf ? "DNF" : "P" + c.pos}</td>
          <td class="tt-drv"><i class="tt-bar" style="background:${esc(d.color)}"></i><b>${esc(d.code3)}</b> <span class="muted">${esc(d.name)}</span></td>
          <td>${gHtml}</td>
          <td class="tt-mono">${c.dnf ? "OUT" : (c.pos === 1 ? "LEADER" : `+${Number(c.gap || 0).toFixed(1)}s`)}</td>
          <td class="tt-mono">${c.lapTime ? fmtLap(c.lapTime) : "--.-"}</td>
          <td><span class="sim-tbadge t-${esc(c.comp)}">${comp.code}</span> <small>${c.tyreLife}%</small></td>
          <td style="color:${tier.color};font-weight:800;">${c.conf} <small>(${c.mom >= 0 ? "+" : ""}${c.mom})</small></td>
          <td>${c.stops}</td>
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
            <thead><tr><th>Pos</th><th>Driver</th><th>Δ</th><th>Gap</th><th>Lap</th><th>Tyre</th><th>Conf (Mom)</th><th>Stops</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="ras-card ras-scroll">
          <div class="ras-card-head"><span>KEY RACE STORYLINE (UP TO L${fr.lap})</span><small>${(p.events || []).length} Total</small></div>
          <div class="ras-ev-list">${evHtml}</div>
        </div>
      </div>
    `;
  }

  function setupCanvas(id) {
    const cv = modalEl.querySelector(`#${id}`);
    if (!cv) return null;
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 860;
    const h = cv.clientHeight || 390;
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

    // Background
    ctx.fillStyle = "#0b1120";
    ctx.fillRect(0, 0, w, h);

    // SC & Rain vertical bands
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

    // Horizontal gridlines
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

    // Lap X-axis ticks
    const step = Math.max(1, Math.ceil(frames.length / 10));
    ctx.textAlign = "center";
    for (let i = 0; i < frames.length; i += step) {
      const x = pad.l + (i / maxF) * pw;
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(`L${frames[i].lap}`, x, h - 10);
    }

    // Active Scrubber vertical cursor line
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

    // Zone bands: IN ZONE (>=82 green), SHAKEN (<=28 red)
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

  async function renderInterviews() {
    const box = modalEl.querySelector("#ras-pane-interviews");
    if (!state.interviews) {
      box.innerHTML = `<div class="muted" style="padding:20px;">Generating context-aware Post-Race Driver Interviews…</div>`;
      try {
        const res = await fetch("/api/sim/interviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telemetry: state.payload }),
        });
        const data = await res.json();
        state.interviews = data.interviews || [];
      } catch (err) {
        box.innerHTML = `<div class="muted" style="padding:20px;">Could not load interviews: ${esc(err.message)}</div>`;
        return;
      }
    }
    const list = state.interviews || [];
    if (!list.length) {
      box.innerHTML = `<div class="muted" style="padding:20px;">Finish a race to unlock full post-race driver interviews!</div>`;
      return;
    }
    const sel = list[state.selectedInterviewIdx] || list[0];
    const moodColors = { elated: "#22c55e", confident: "#38bdf8", mixed: "#cbd5e1", frustrated: "#f59e0b", shaken: "#ef4444" };

    box.innerHTML = `
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
                <span>CONF ${r.endConf}</span>
              </div>
            </button>
          `).join("")}
        </div>
        <div class="ras-int-detail ras-scroll">
          <div class="ras-id-head" style="border-left:4px solid ${esc(sel.color)}">
            <div>
              <h3>${esc(sel.name)} <small class="muted">(${esc(sel.team)})</small></h3>
              <div class="muted small">${esc(sel.personaLabel)} · Engineer: <b>${esc(sel.engineerName)}</b></div>
            </div>
            <div class="ras-id-score">
              <strong>${Number(sel.rating).toFixed(1)}<small>/10</small></strong>
              <span>${sel.dnf ? "DNF" : `P${sel.gridPos} → P${sel.finishPos}`}</span>
            </div>
          </div>
          <div class="ras-reasons">
            <span class="ras-r-lbl"><i class="fas fa-brain"></i> WHY THEY FEEL THIS WAY:</span>
            ${(sel.perspectiveReasons || []).map((t) => `<span class="ras-r-chip">${esc(t)}</span>`).join("")}
          </div>
          <div class="ras-qas">
            ${(sel.qas || []).map((qa) => `
              <div class="ras-qa-item">
                <div class="ras-qa-topic">${esc(qa.topic)}</div>
                <div class="ras-qa-q"><i class="fas fa-microphone"></i> "${esc(qa.q)}"</div>
                <div class="ras-qa-a">"${esc(qa.a)}"</div>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;
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
    state.activeTab = o.initialTab || "overview";
    state.scrubIdx = Math.max(0, payload.frames.length - 1);
    state.focusDrvIdx = o.focusDrvIdx != null ? o.focusDrvIdx : -1;
    state.selectedInterviewIdx = 0;

    modalEl.querySelector("#ras-circuit-title").textContent = `${payload.circuitName || "Grand Prix"} — ${payload.totalLaps || 15} Laps`;
    modalEl.querySelector("#ras-era-sub").textContent = payload.eraLabel || "";

    const slider = modalEl.querySelector("#ras-slider");
    slider.max = String(Math.max(0, payload.frames.length - 1));
    slider.value = String(state.scrubIdx);

    // Event Pins along scrubber bar
    const pinsBox = modalEl.querySelector("#ras-event-pins");
    const maxLap = Math.max(1, payload.totalLaps || payload.frames.length);
    const keyEvents = (payload.events || []).filter((e) => ["sc", "rain", "dnf", "mistake", "incident"].includes(e.type)).slice(0, 24);
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

    // Driver highlight dropdown
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
