/* Pit Wall: The Ladder — Main Command Center UI Controller */
(function () {
  "use strict";

  let currentSaveId = null;
  let currentView = null;
  let selectedStartTier = "karting";
  let worldViewTier = null;
  let liveSim = null;
  let radarWidget = null;
  let fpRunner = null;
  let pendingMidrace = null;
  let selectedLobbyTps = new Set();

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const fmtMoney = (k) => {
    const v = Number(k || 0);
    if (Math.abs(v) >= 1000) return `${v < 0 ? "-" : ""}$${(Math.abs(v) / 1000).toFixed(2)}M`;
    return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(0)}k`;
  };

  function toast(msg, isErr) {
    const el = document.getElementById("ld-toast");
    if (!el) return;
    el.textContent = msg;
    el.className = `ld-toast${isErr ? " is-err" : ""}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add("hidden"), 4500);
  }

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

  function switchTab(tabId) {
    document.querySelectorAll(".ld-tab").forEach((b) => b.classList.toggle("active", b.dataset.ldTab === tabId));
    document.querySelectorAll(".ld-panel").forEach((p) => p.classList.toggle("active", p.dataset.ldPanel === tabId));
  }

  async function refreshSavesDropdown() {
    const sel = document.getElementById("sel-saves");
    if (!sel) return;
    const res = await api("/api/ladder/saves");
    const saves = res.saves || [];
    sel.innerHTML = `<option value="">Load Saved Career (${saves.length})...</option>` + saves.map((s) =>
      `<option value="${esc(s.save_id)}"${s.save_id === currentSaveId ? " selected" : ""}>${esc(s.team_name)} · ${esc(s.tier.toUpperCase())} S${s.season} R${s.round}</option>`
    ).join("");
  }

  async function refreshMidraceAutosave(saveId) {
    pendingMidrace = null;
    if (!saveId || !currentView) return;
    try {
      const res = await api(`/api/ladder/${encodeURIComponent(saveId)}/race/autosave`);
      const mr = res.midrace;
      const st = currentView.state;
      if (
        mr &&
        mr.snapshot &&
        Array.isArray(mr.snapshot.cars) &&
        mr.snapshot.cars.length &&
        st.weekend.phase !== "season_end" &&
        Number(mr.season) === Number(st.season) &&
        Number(mr.round) === Number(st.round) &&
        String(mr.tier) === String(st.tier)
      ) {
        pendingMidrace = mr.snapshot;
      }
    } catch (_) {
      pendingMidrace = null;
    }
  }

  async function loadSave(saveId) {
    if (!saveId) return;
    const res = await api(`/api/ladder/state/${encodeURIComponent(saveId)}`);
    currentSaveId = saveId;
    currentView = res.view;
    worldViewTier = currentView.state.tier;
    selectedLobbyTps.clear();
    localStorage.setItem("traf1_ladder_save", saveId);
    await refreshMidraceAutosave(saveId);
    renderAll();
    refreshSavesDropdown();
  }

  async function openReportsModal() {
    if (!currentSaveId || !currentView) return;
    const modal = document.getElementById("reports-modal");
    const body = document.getElementById("reports-modal-body");
    if (!modal || !body) return;
    modal.classList.remove("hidden");
    body.innerHTML = `<div class="ld-item"><p>Loading archived race reports...</p></div>`;
    try {
      const res = await api(`/api/ladder/${encodeURIComponent(currentSaveId)}/reports?limit=50`);
      const reports = res.reports || [];
      const hist = (currentView.state && currentView.state.season_history) || [];
      const histHtml = hist.length ? `
        <h4 class="ld-subhead" style="margin-top:0">Completed Seasons (${hist.length})</h4>
        ${hist.map((h) => `
          <div class="ld-item">
            <div class="ld-item-top">
              <strong>Season ${h.season} · ${esc((h.tier || "").toUpperCase())} — ${esc(h.team_name)}</strong>
              <span class="ld-tag ld-tag-ok">P${h.team_pos} · ${h.points} pts</span>
            </div>
            <p>Champion: <b>${esc(h.champion_driver || "—")}</b> · Path: ${esc(h.career_path || "owner_ladder")}</p>
          </div>
        `).join("")}
      ` : "";
      const repHtml = reports.length ? `
        <h4 class="ld-subhead">Race Reports (${reports.length})</h4>
        ${reports.map((r) => {
          const deb = (r.report && r.report.debrief) || {};
          const prs = deb.player_results || [];
          return `
            <div class="ld-item">
              <div class="ld-item-top">
                <strong>S${r.season} R${r.round} · ${esc((r.tier || "").toUpperCase())} · ${esc(deb.circuit_name || r.circuit_id)}</strong>
                <span class="ld-tag">${esc(r.weather_summary || "Dry")}${r.sc_count ? ` · ${r.sc_count} SC` : ""}</span>
              </div>
              <p>Winner: <b>${esc(r.winner_name || deb.winner || "—")}</b>${r.winner_team ? ` (${esc(r.winner_team)})` : ""}${deb.income_k != null ? ` · Net ${fmtMoney((deb.income_k || 0) - (deb.expenses_k || 0))}` : ""}${deb.crash_bill_k > 0 ? ` · <span style="color:#f87171">Repairs ${fmtMoney(deb.crash_bill_k)}</span>` : ""}</p>
              ${prs.length ? `<p>${prs.map((p) => `${esc(p.name)}: <b>${p.dnf ? "DNF" : "P" + p.pos}</b> (+${p.pts} pts)`).join(" · ")}</p>` : ""}
            </div>
          `;
        }).join("")}
      ` : `<div class="ld-item"><p>No races completed yet in this save. Finish your first race to populate the SQLite archive!</p></div>`;
      body.innerHTML = histHtml + repHtml;
    } catch (e) {
      body.innerHTML = `<div class="ld-item"><p style="color:#fca5a5">${esc(e.message)}</p></div>`;
    }
  }

  function openDebriefModal(debrief, seasonComplete) {
    if (!debrief) return;
    const modal = document.getElementById("debrief-modal");
    const body = document.getElementById("debrief-modal-body");
    const titleEl = document.getElementById("debrief-title");
    const kickerEl = document.getElementById("debrief-kicker");
    const contBtn = document.getElementById("btn-debrief-continue");
    if (!modal || !body) return;
    const netK = Number(debrief.income_k || 0) - Number(debrief.expenses_k || 0);
    if (kickerEl) kickerEl.textContent = seasonComplete ? "SEASON FINALE COMPLETE" : `ROUND ${debrief.round} CHEQUERED FLAG`;
    if (titleEl) titleEl.textContent = `${debrief.circuit_name || "Race"} — Winner: ${debrief.winner || "—"}`;
    const prs = debrief.player_results || [];
    const partsUsed = prs.flatMap((r) => r.parts_consumed || []);
    const emergParts = prs.flatMap((r) => r.emergency_parts || []);
    body.innerHTML = `
      <div class="ld-debrief-grid">
        <div class="ld-debrief-stat"><span>NET CASH</span><b style="color:${netK >= 0 ? "#4ade80" : "#f87171"}">${netK >= 0 ? "+" : ""}${fmtMoney(netK)}</b></div>
        <div class="ld-debrief-stat"><span>INCOME</span><b>${fmtMoney(debrief.income_k || 0)}</b></div>
        <div class="ld-debrief-stat"><span>CRASH BILL</span><b style="color:${debrief.crash_bill_k > 0 ? "#f87171" : "#94a3b8"}">${fmtMoney(debrief.crash_bill_k || 0)}</b></div>
        <div class="ld-debrief-stat"><span>REPUTATION</span><b style="color:${debrief.rep_delta >= 0 ? "#38bdf8" : "#f87171"}">${debrief.rep_delta >= 0 ? "+" : ""}${debrief.rep_delta}</b></div>
      </div>
      <div class="ld-item">
        <div class="ld-item-top"><strong>Your Drivers</strong><span class="ld-tag">${esc(debrief.weather || "Dry")}${debrief.safety_cars ? ` · ${debrief.safety_cars} SC` : ""}</span></div>
        ${prs.map((r) => `
          <p><b>${esc(r.name)}</b>: ${r.dnf ? `<span style="color:#f87171">DNF</span>` : `<b>P${r.pos}</b>`} (+${r.pts} pts)${r.crash_bill_k > 0 ? ` · <span style="color:#fca5a5">Crash ${fmtMoney(r.crash_bill_k)}</span>` : ""}${r.obeyed_orders === false ? ` · <span style="color:#fbbf24">Ignored Team Orders</span>` : ""}</p>
        `).join("")}
        ${partsUsed.length ? `<p style="color:#fbbf24"><b>Spare Parts Consumed:</b> ${partsUsed.map(esc).join(", ")}</p>` : ""}
        ${emergParts.length ? `<p style="color:#f87171"><b>Emergency Overnight Builds (1.45×):</b> ${emergParts.map(esc).join(", ")}</p>` : ""}
      </div>
      ${(debrief.world_headlines || []).length ? `
        <div class="ld-item">
          <div class="ld-item-top"><strong>5-Tier Paddock Headlines</strong><span class="ld-tag ld-tag-ok">LIVING WORLD</span></div>
          ${debrief.world_headlines.slice(0, 5).map((h) => `<p>• ${esc(h)}</p>`).join("")}
        </div>
      ` : ""}
      <div class="ld-item" id="debrief-voices">
        <div class="ld-item-top"><strong>Paddock Voices</strong><span class="ld-tag">AI MEDIA PEN</span></div>
        <p style="color:#94a3b8"><i class="fas fa-microphone-alt"></i> Quotes are being composed from the race radio…</p>
      </div>
    `;
    if (contBtn) {
      contBtn.textContent = seasonComplete ? "Open Promotion & Career Fork →" : "Continue to Next Round →";
      contBtn.dataset.seasonComplete = seasonComplete ? "1" : "0";
    }
    modal.classList.remove("hidden");
    loadDebriefVoices(debrief);
  }

  // Fetch + render AI driver quotes & TP reaction (Paddock Voices) for this debrief.
  async function loadDebriefVoices(debrief) {
    const box = document.getElementById("debrief-voices");
    if (!box) return;
    let payload = null;
    try {
      const res = await fetch(`/api/ladder/${encodeURIComponent(currentSaveId)}/debrief-quotes?season=${encodeURIComponent(currentView?.state?.season || 0)}&round_num=${encodeURIComponent(debrief.round || 0)}`);
      payload = await res.json();
    } catch (e) { payload = null; }
    if (!box) return; // modal may have been closed mid-fetch
    if (!payload || !payload.ok || !payload.quotes?.length) {
      box.innerHTML = `
        <div class="ld-item-top"><strong>Paddock Voices</strong><span class="ld-tag">AI MEDIA PEN</span></div>
        <p style="color:#94a3b8">The media pen had a quiet afternoon — no quotes for this round.</p>`;
      return;
    }
    const moodColor = { elated: "#4ade80", confident: "#38bdf8", mixed: "#94a3b8", frustrated: "#fbbf24", shaken: "#f87171" };
    const quoteHtml = payload.quotes.map((q) => `
      <p style="margin-bottom:8px">
        <b>${esc(q.name)}</b> <span style="color:${moodColor[q.mood] || "#94a3b8"}">· ${esc(String(q.mood || "").toUpperCase())} · ${esc(String(q.conf_band || "").toUpperCase())}</span>
        ${q.finish_pos ? `· P${q.finish_pos}` : ""}
        <br>“${esc(q.quote)}”${q.radio ? `<br><span style="color:#64748b;font-style:italic">📻 “${esc(q.radio)}”</span>` : ""}
      </p>
    `).join("");
    const tp = payload.tp_reaction || {};
    const tpHtml = tp.quote ? `
      <div style="border-top:1px solid #1e293b;margin-top:8px;padding-top:8px">
        <p><b>${esc(tp.name || "Team Principal")}</b> <span style="color:${moodColor[tp.mood] || "#94a3b8"}">· TP REACTION</span>
        <br>“${esc(tp.quote)}”${tp.radio ? `<br><span style="color:#64748b;font-style:italic">📻 “${esc(tp.radio)}”</span>` : ""}</p>
      </div>` : "";
    box.innerHTML = `
      <div class="ld-item-top"><strong>Paddock Voices</strong><span class="ld-tag">AI MEDIA PEN · ${esc(String(payload.circuit || ""))}</span></div>
      ${quoteHtml}${tpHtml}
    `;
  }

  function renderAll() {
    if (!currentView) return;
    const st = currentView.state;
    const tcfg = currentView.tier_config;
    const u = tcfg.unlocks;

    // 1. Left Rail 5-Rung Ladder
    document.getElementById("lr-team-subtitle").textContent = `${st.player.team_name} · ${st.player.principal_name}`;
    const carPrev = document.getElementById("lr-car-preview");
    if (carPrev) {
      if (currentView.player_car_icon) {
        carPrev.innerHTML = `<img src="${esc(currentView.player_car_icon)}" alt="${esc(st.player.team_name)} car" loading="lazy">`;
        carPrev.classList.remove("hidden");
      } else {
        carPrev.innerHTML = "";
        carPrev.classList.add("hidden");
      }
    }
    const order = ["karting", "f4", "f3", "f2", "f1"];
    const curIdx = order.indexOf(st.tier);
    document.querySelectorAll(".lr-rung").forEach((el) => {
      const idx = order.indexOf(el.dataset.rung);
      el.classList.toggle("is-active", idx === curIdx);
      el.classList.toggle("is-passed", idx < curIdx);
    });

    document.getElementById("kpi-cash").textContent = fmtMoney(st.economy.cash_k);
    document.getElementById("kpi-rep").textContent = `${st.player.reputation} / 100`;
    document.getElementById("kpi-season").textContent = `S${st.season} (${st.year}) · R${st.round}/${tcfg.rounds}`;
    const pathLabels = { owner_ladder: "Owner-Ladder", poached_tp: "Path A: Poached TP", constructor_bid: "Path B: Constructor Bid", mercenary: "Path C: Mercenary" };
    document.getElementById("kpi-path").textContent = pathLabels[st.player.career_path] || st.player.career_path;

    const capWrap = document.getElementById("kpi-cap-wrap");
    if (u.cost_cap) {
      capWrap.style.display = "";
      document.getElementById("kpi-cap").textContent = `${fmtMoney(st.economy.cost_cap_spent_k)} / ${fmtMoney(st.economy.cost_cap_limit_k)}`;
    } else {
      capWrap.style.display = "none";
    }

    const tierPill = document.getElementById("ld-tier-pill");
    tierPill.textContent = tcfg.short;
    tierPill.style.borderColor = tcfg.color;
    tierPill.style.color = tcfg.color;
    document.getElementById("ld-next-gp").textContent = st.weekend.phase === "season_end"
      ? `Season ${st.season} Complete — Open Politics & Fork!`
      : `R${st.round}: ${st.weekend.circuit_name} (${st.weekend.weather_mode.toUpperCase()})`;

    renderCommandTab();
    renderWeekendTab();
    renderFactoryTab();
    renderRosterTab();
    renderWorldTab();
    renderPoliticsTab();
  }

  function renderCommandTab() {
    const st = currentView.state;
    const tcfg = currentView.tier_config;
    const u = tcfg.unlocks;

    const unlockLabels = [
      ["kart_tuning", "Kart Chassis Flex, Gear Ratio & Tyre PSI"],
      ["practice_session", "Practice Sessions & Wing Setup (F4+)"],
      ["live_radio", "Live Pit-Wall Radio & Engineer Calls (F4+)"],
      ["pit_stops", "Live Pit Stops & Rejoin Ghost Predictor (F4+)"],
      ["crash_damage_economy", "Crash-Damage Repair Economy (F4+)"],
      ["drs", "DRS & 30-Car Qualifying Traffic (F3+)"],
      ["reverse_grid_sprint", "Reverse-Grid Sprint Races (F3/F2)"],
      ["academy_affiliates", "F1 Academy Affiliate KPI Deals (F3/F2)"],
      ["mandatory_pit", "Mandatory Prime/Option Stops & Pit Crew Drills (F2+)"],
      ["driver_ego_trust", "Driver Ego vs Trust Matrix (F2+)"],
      ["ers_engine_modes", "ERS Battery, Engine Mapping & Team Orders (F1)"],
      ["custom_rd_correlation", "Custom R&D & Wind-Tunnel Correlation Risk (F1)"],
      ["cost_cap", "FIA Dual-Ledger Cost Cap & Gardening Leave (F1)"],
      ["fia_voting", "FIA Regulation Commission Voting (F1)"],
    ];
    document.getElementById("cmd-unlocks").innerHTML = `
      <div class="ld-item">
        <div class="ld-item-top"><strong>${esc(tcfg.name)}</strong><span class="ld-tag ld-tag-ok">TIER ${tcfg.rank}</span></div>
        <p>${esc(tcfg.headline)}</p>
      </div>
      ${unlockLabels.map(([k, lbl]) => `
        <div class="ld-item" style="padding:5px 8px;opacity:${u[k] ? 1 : 0.45}">
          <div class="ld-item-top" style="margin:0">
            <span style="font-size:0.71rem">${u[k] ? "✅" : "🔒"} ${esc(lbl)}</span>
            <span class="ld-tag ${u[k] ? "ld-tag-ok" : ""}">${u[k] ? "ACTIVE" : "LOCKED"}</span>
          </div>
        </div>
      `).join("")}
    `;

    const activeDilemmas = (st.dilemmas || []).filter((d) => !d.resolved);
    const dilemmaHtml = activeDilemmas.length ? activeDilemmas.map((d) => `
      <div class="ld-item ld-dilemma">
        <div class="ld-item-top"><strong>⚡ ${esc(d.title)}</strong><span class="ld-tag ld-tag-warn">${esc(d.tag)} · ACTION</span></div>
        <p><b style="color:#fde047">${esc(d.sender)}:</b> ${esc(d.body)}</p>
        <div class="ld-ctrl-row">
          ${(d.choices || []).map((c) => `<button type="button" class="ld-btn ld-btn-sm btn-dilemma" data-did="${esc(d.id)}" data-cid="${esc(c.id)}">${esc(c.label)}</button>`).join("")}
        </div>
      </div>
    `).join("") : "";

    const inboxEl = document.getElementById("cmd-inbox");
    inboxEl.innerHTML = dilemmaHtml + (st.inbox || []).map((m) => `
      <div class="ld-item">
        <div class="ld-item-top"><strong>${esc(m.title)}</strong><span class="ld-tag">${esc(m.tag)} · R${m.round}</span></div>
        <p><b style="color:#cbd5e1">${esc(m.sender)}:</b> ${esc(m.body)}</p>
      </div>
    `).join("") + ((st.silly_season_log || []).length ? `<h4 class="ld-subhead">Silly Season Wire</h4>` + st.silly_season_log.slice(0, 5).map((s) => `<div class="ld-ev">${esc(s.text)}</div>`).join("") : "");
    inboxEl.querySelectorAll(".btn-dilemma").forEach((b) => b.addEventListener("click", async () => {
      try {
        const res = await api(`/api/ladder/${currentSaveId}/dilemma/resolve`, "POST", { dilemma_id: b.dataset.did, choice_id: b.dataset.cid });
        currentView = res.view;
        toast(res.message, !res.ok);
        renderAll();
      } catch (e) { toast(e.message, true); }
    }));

    const cal = st.tiers[st.tier].calendar;
    const deb = st.weekend.last_race_debrief;
    const resumeQuickHtml = pendingMidrace ? `
      <div class="ld-item ld-resume-card">
        <div class="ld-item-top"><strong>⏸ Interrupted Race Saved</strong><span class="ld-tag ld-tag-ok">LAP ${pendingMidrace.lap}/${pendingMidrace.total_laps || st.weekend.laps}</span></div>
        <p>Mid-race autosave ready for <b>${esc(st.weekend.circuit_name)}</b>.</p>
        <div class="ld-ctrl-row"><button type="button" id="btn-cmd-resume" class="ld-btn ld-btn-sm ld-btn-primary">Resume Live Pit Wall →</button></div>
      </div>
    ` : "";
    document.getElementById("cmd-calendar").innerHTML = `
      ${resumeQuickHtml}
      ${deb ? `
        <div class="ld-item" style="border-color:rgba(56,189,248,0.45)">
          <div class="ld-item-top"><strong>Last Debrief: R${deb.round} ${esc(deb.circuit_name)}</strong><span class="ld-tag ld-tag-ok">Rep ${deb.rep_delta >= 0 ? "+" : ""}${deb.rep_delta}</span></div>
          <p>Winner: <b>${esc(deb.winner)}</b> · Income ${fmtMoney(deb.income_k)} · Expenses ${fmtMoney(deb.expenses_k)}${deb.crash_bill_k > 0 ? ` · <span style="color:#f87171">Crash Repairs ${fmtMoney(deb.crash_bill_k)}</span>` : ""}</p>
          <p>${(deb.player_results || []).map((r) => `${esc(r.name)}: ${r.dnf ? "DNF" : "P" + r.pos} (+${r.pts} pts)`).join(" · ")}</p>
          ${(deb.world_headlines || []).length ? `<p style="color:#38bdf8;font-size:0.66rem">${deb.world_headlines.slice(0, 3).map(esc).join(" | ")}</p>` : ""}
        </div>
      ` : ""}
      ${cal.map((c) => `
        <div class="ld-item" style="padding:5px 8px;${c.round === st.round && !c.completed ? "border-color:#f97316" : ""}">
          <div class="ld-item-top" style="margin:0">
            <strong>R${c.round} · ${esc(c.circuit_name)}</strong>
            <span class="ld-tag ${c.completed ? "ld-tag-ok" : "ld-tag-warn"}">${c.completed ? `W: ${esc(c.winner)}` : `${c.laps}L · ${esc(c.weather_forecast)}`}</span>
          </div>
        </div>
      `).join("")}
    `;
    document.getElementById("btn-cmd-resume")?.addEventListener("click", () => {
      switchTab("weekend");
      if (pendingMidrace) startLivePitWall(pendingMidrace);
    });
  }

  function renderWeekendTab() {
    const st = currentView.state;
    const wk = st.weekend;
    const u = currentView.tier_config.unlocks;
    document.getElementById("pw-circuit-title").textContent = `R${wk.round} ${wk.circuit_name} (${wk.laps}L · ${wk.weather_mode.toUpperCase()})`;
    document.getElementById("pw-phase-badge").textContent = wk.phase.toUpperCase();

    const prepBox = document.getElementById("pw-prep-box");
    const liveWrap = document.getElementById("pw-live-wrap");

    if (liveSim && liveSim.running && !liveSim.finished) {
      prepBox.classList.add("hidden");
      liveWrap.classList.remove("hidden");
      return;
    }

    liveWrap.classList.add("hidden");
    prepBox.classList.remove("hidden");

    if (wk.phase === "season_end") {
      prepBox.innerHTML = `
        <div class="ld-item" style="border-color:#22c55e">
          <div class="ld-item-top"><strong>Season ${st.season} Complete!</strong><span class="ld-tag ld-tag-ok">END OF SEASON</span></div>
          <p>Head to the <b>Politics &amp; Fork</b> tab to review rolling 3-year Super License updates, accept promotion, or choose your F2 → F1 Hybrid Career Fork!</p>
          <div class="ld-ctrl-row"><button type="button" class="ld-btn ld-btn-red" id="btn-jump-fork">Open Promotion &amp; Career Fork →</button></div>
        </div>
      `;
      document.getElementById("btn-jump-fork")?.addEventListener("click", () => switchTab("politics"));
      return;
    }

    const s = wk.setup;
    const setupControls = u.kart_tuning ? `
      <div class="ld-item">
        <div class="ld-item-top"><strong>Karting Pre-Race Setup (Zero Live Radio · Zero Pit Stops)</strong><span class="ld-tag ld-tag-warn">Balance ${wk.setup_confidence}%</span></div>
        <div class="ld-form-grid" style="margin:6px 0">
          <label>Chassis Flex (${s.chassis_flex}) <input type="range" id="st-flex" min="15" max="90" value="${s.chassis_flex}"></label>
          <label>Gear Ratio (${s.gear_ratio}) <input type="range" id="st-gear" min="15" max="90" value="${s.gear_ratio}"></label>
          <label>Tyre PSI (${s.tyre_pressure}) <input type="range" id="st-psi" min="15" max="90" value="${s.tyre_pressure}"></label>
        </div>
        <label style="font-size:0.7rem;color:#cbd5e1">Pre-Race Driver Coaching Directive:
          <select id="st-coach" class="ld-select" style="margin-top:4px">
            <option value="balanced"${s.coaching === "balanced" ? " selected" : ""}>Balanced Pace &amp; Clean Lines</option>
            <option value="slipstream"${s.coaching === "slipstream" ? " selected" : ""}>Hunt Slipstream &amp; Draft Pack</option>
            <option value="smooth"${s.coaching === "smooth" ? " selected" : ""}>Smooth Kerbs &amp; Save Tyres</option>
            <option value="aggressive"${s.coaching === "aggressive" ? " selected" : ""}>Late-Brake Send Every Corner</option>
          </select>
        </label>
        <div class="ld-ctrl-row"><button type="button" id="btn-run-setup" class="ld-btn ld-btn-primary">Lock Kart Setup</button></div>
      </div>
    ` : `
      <div class="ld-item">
        <div class="ld-item-top"><strong>Practice Session &amp; Aero Setup</strong><span class="ld-tag ${wk.practice_done ? "ld-tag-ok" : "ld-tag-warn"}">Balance ${wk.setup_confidence}%</span></div>
        <div class="ld-form-grid" style="margin:6px 0">
          <label>Front Wing (${s.front_wing}) <input type="range" id="st-fw" min="15" max="90" value="${s.front_wing}"></label>
          <label>Rear Wing (${s.rear_wing}) <input type="range" id="st-rw" min="15" max="90" value="${s.rear_wing}"></label>
          <label>Ride Height (${s.ride_height}) <input type="range" id="st-rh" min="15" max="90" value="${s.ride_height}"></label>
        </div>
        <div class="ld-ctrl-row">
          <button type="button" id="btn-run-setup" class="ld-btn ld-btn-primary"><i class="fas fa-flask"></i> Run Practice &amp; Validate Setup${u.custom_rd_correlation && st.rd.pending_upgrades.length ? ` (${st.rd.pending_upgrades.length} F1 Upgrade Correlation!)` : ""}</button>
        </div>
      </div>
    `;

    const sprintCard = wk.sprint_result ? `
      <div class="ld-item" style="border-color:rgba(250,204,21,0.45)">
        <div class="ld-item-top">
          <strong>Reverse-Grid Sprint Result (Top ${wk.sprint_result.reversed_count || 10} Reversed)</strong>
          <span class="ld-tag ld-tag-warn">SPRINT PTS AWARDED</span>
        </div>
        <div class="ld-sprint-grid">
          ${(wk.sprint_result.top10 || []).slice(0, 6).map((sr) => {
            const isMine = (st.player.driver_ids || []).includes(sr.driver_id);
            return `<div class="ld-sprint-row${isMine ? " is-me" : ""}"><span>P${sr.pos} ${esc(sr.name)}</span><span>+${sr.pts}</span></div>`;
          }).join("")}
        </div>
      </div>
    ` : "";

    const qualiBlock = `
      <div class="ld-item">
        <div class="ld-item-top"><strong>Qualifying Release Window</strong><span class="ld-tag ${wk.quali_done ? "ld-tag-ok" : ""}">${wk.quali_done ? "GRID SET" : "READY"}</span></div>
        <p>Balance track evolution against ${st.tier === "f3" ? "30-car F3 traffic risk" : "traffic impedance"}.</p>
        <div class="ld-ctrl-row">
          <button type="button" class="ld-btn ld-btn-sm btn-quali" data-tactic="clean_air">Clean Air Release (Safe)</button>
          <button type="button" class="ld-btn ld-btn-sm btn-quali" data-tactic="late_evolution">Late Track Evolution (-0.34s · Med Risk)</button>
          <button type="button" class="ld-btn ld-btn-sm btn-quali" data-tactic="tow_gamble">Slipstream Tow Gamble (-0.48s · High Risk)</button>
        </div>
      </div>
      ${sprintCard}
    `;

    const resumeBlock = pendingMidrace ? `
      <div class="ld-item ld-resume-card">
        <div class="ld-item-top">
          <strong>⏸ Resume Mid-Race Autosave (Lap ${pendingMidrace.lap}/${pendingMidrace.total_laps || wk.laps})</strong>
          <span class="ld-tag ld-tag-ok">WAL SNAPSHOT</span>
        </div>
        <p>An active Pit Wall race at <b>${esc(wk.circuit_name)}</b> was autosaved (Wetness ${pendingMidrace.wetness || 0}%${pendingMidrace.safety_car_laps ? " · SC Active" : ""}).</p>
        <div class="ld-ctrl-row">
          <button type="button" id="btn-resume-live" class="ld-btn ld-btn-primary"><i class="fas fa-play-circle"></i> Resume From Lap ${pendingMidrace.lap}</button>
          <button type="button" id="btn-discard-autosave" class="ld-btn ld-btn-sm ld-btn-danger">Discard Autosave</button>
        </div>
      </div>
    ` : "";

    const launchBlock = wk.quali_done ? `
      <div class="ld-item" style="border-color:#ef4444">
        <div class="ld-item-top"><strong>Race Day — Pit Wall Command</strong><span class="ld-tag ld-tag-ok">LIGHTS READY</span></div>
        <p>Launch the live 2D Pit Wall track map, jump straight into the 3D cockpit in Apex POV, or Quick Sim to debrief.</p>
        <div class="ld-ctrl-row">
          <button type="button" id="btn-launch-live" class="ld-btn ld-btn-red"><i class="fas fa-play"></i> Launch Live Pit Wall</button>
          <a href="/drive?source=ladder&amp;ref_id=${encodeURIComponent(currentSaveId || "")}" class="ld-btn ld-btn-primary" style="text-decoration:none"><i class="fas fa-tachometer-alt"></i> Take the Wheel (3D POV)</a>
          <button type="button" id="btn-quick-sim" class="ld-btn">Quick Sim Race</button>
        </div>
      </div>
    ` : "";

    const prules = currentView.practice_rules || { sessions: [], programmes: [] };
    const doneFp = wk.completed_fp_sessions || [];
    const nextFp = (prules.sessions || []).find((sx) => !doneFp.includes(sx));
    const fpProgBlock = (!u.kart_tuning && prules.sessions && prules.sessions.length) ? `
      <div class="ld-item" style="border-color:rgba(56,189,248,0.4)">
        <div class="ld-item-top">
          <strong>Practice Programmes (${esc(prules.label || "")})</strong>
          <span class="ld-tag ld-tag-ok">Know ${wk.car_knowledge_pct || 20}% · Intel ${wk.strategy_intel_pct || 35}%</span>
        </div>
        <p>Completed: ${doneFp.length ? doneFp.map((x) => x.toUpperCase()).join(", ") : "None"} ${nextFp ? `· Next: <b>${nextFp.toUpperCase()}</b>` : "· All FP sessions complete!"}</p>
        ${nextFp ? `
          <div class="ld-form-grid" style="grid-template-columns:1fr 1fr;margin:6px 0">
            <label>Car #1 Programme
              <select id="fp-prog-1" class="ld-select">${prules.programmes.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select>
            </label>
            <label>Car #2 Programme
              <select id="fp-prog-2" class="ld-select">${prules.programmes.map((p, idx) => `<option value="${esc(p.id)}"${idx === 1 ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
            </label>
          </div>
          <div class="ld-ctrl-row">
            <button type="button" id="btn-run-fp" class="ld-btn ld-btn-primary" data-sess="${esc(nextFp)}"><i class="fas fa-flask"></i> Run ${nextFp.toUpperCase()} Programmes</button>
          </div>
        ` : ""}
      </div>
    ` : "";

    prepBox.innerHTML = resumeBlock + setupControls + fpProgBlock + qualiBlock + launchBlock;

    // Render qualifying grid in timing tower if set
    if (wk.quali_grid && wk.quali_grid.length) {
      document.getElementById("pw-lap-counter").textContent = "QUALI GRID";
      document.getElementById("pw-timing-tower").innerHTML = wk.quali_grid.map((g) => `
        <div class="ld-tower-row${g.is_player ? " is-me" : ""}">
          <span>P${g.pos}</span>
          <span style="color:${esc(g.color)};font-weight:800">${esc(g.code3)}</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.name)}</span>
          <span>${g.impeded ? "🚧" : ""}</span>
          <span>${g.pos === 1 ? g.lap_s.toFixed(2) : "+" + g.gap_s.toFixed(2)}</span>
        </div>
      `).join("");
    }

    document.getElementById("btn-run-setup")?.addEventListener("click", async () => {
      try {
        const body = u.kart_tuning
          ? { chassis_flex: document.getElementById("st-flex").value, gear_ratio: document.getElementById("st-gear").value, tyre_pressure: document.getElementById("st-psi").value, coaching: document.getElementById("st-coach").value }
          : { front_wing: document.getElementById("st-fw").value, rear_wing: document.getElementById("st-rw").value, ride_height: document.getElementById("st-rh").value };
        const res = await api(`/api/ladder/${currentSaveId}/setup`, "POST", body);
        currentView = res.view;
        toast(res.note || "Setup applied!");
        renderAll();
      } catch (e) { toast(e.message, true); }
    });

    document.getElementById("btn-run-fp")?.addEventListener("click", async (e) => {
      try {
        const sess = e.currentTarget.dataset.sess || "fp1";
        const p1 = document.getElementById("fp-prog-1")?.value || "track_acclim";
        const p2 = document.getElementById("fp-prog-2")?.value || "tyre_mgmt";
        const res = await api(`/api/ladder/${currentSaveId}/weekend/practice`, "POST", { session: sess, prog_d1: p1, prog_d2: p2 });
        currentView = res.view;
        toast(res.message, !res.ok);
        renderAll();
      } catch (err) { toast(err.message, true); }
    });

    prepBox.querySelectorAll(".btn-quali").forEach((b) => {
      b.addEventListener("click", async () => {
        try {
          const res = await api(`/api/ladder/${currentSaveId}/qualify`, "POST", { tactic: b.dataset.tactic });
          currentView = res.view;
          toast(`Qualifying complete! Grid locked for ${currentView.state.weekend.circuit_name}.`);
          renderAll();
        } catch (e) { toast(e.message, true); }
      });
    });

    document.getElementById("btn-quick-sim")?.addEventListener("click", async () => {
      try {
        const res = await api(`/api/ladder/${currentSaveId}/race/quick`, "POST", {});
        currentView = res.view;
        pendingMidrace = null;
        toast(`Race complete! Winner: ${res.debrief.winner}.`);
        renderAll();
        openDebriefModal(res.debrief, res.season_complete);
      } catch (e) { toast(e.message, true); }
    });

    document.getElementById("btn-launch-live")?.addEventListener("click", () => startLivePitWall(null));
    document.getElementById("btn-resume-live")?.addEventListener("click", () => startLivePitWall(pendingMidrace));
    document.getElementById("btn-discard-autosave")?.addEventListener("click", async () => {
      try {
        await api(`/api/ladder/${encodeURIComponent(currentSaveId)}/race/autosave`, "DELETE");
        pendingMidrace = null;
        toast("Mid-race autosave discarded.");
        renderAll();
      } catch (e) { toast(e.message, true); }
    });
  }

  function startLivePitWall(resumeSnap) {
    const prepBox = document.getElementById("pw-prep-box");
    const liveWrap = document.getElementById("pw-live-wrap");
    prepBox.classList.add("hidden");
    liveWrap.classList.remove("hidden");

    const canvas = document.getElementById("ladder-track-canvas");
    const radioBox = document.getElementById("pw-radio-banner");
    const radarBox = document.getElementById("pw-radar-widget");
    const u = currentView.tier_config.unlocks;

    if (radioBox) {
      radioBox.innerHTML = "";
      radioBox.classList.toggle("hidden", !u.live_radio);
    }
    if (radarBox) {
      radarBox.classList.toggle("hidden", !u.pit_stops);
      if (u.pit_stops && window.F1WeatherRadarUI) {
        if (radarWidget && radarWidget.destroy) radarWidget.destroy();
        radarWidget = window.F1WeatherRadarUI.create(radarBox);
        if (currentView.state.weekend.weather_radar && radarWidget) {
          radarWidget.renderData(currentView.state.weekend.weather_radar, currentView.circuit);
        }
      }
    }

    liveSim = new window.LadderRaceSim(canvas, {
      radioContainer: u.live_radio ? radioBox : null,
      onTick: renderLiveHud,
      onAutosave: (snap) => {
        if (!currentSaveId) return;
        fetch(`/api/ladder/${encodeURIComponent(currentSaveId)}/race/autosave`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snap),
        }).catch(() => {});
      },
      onFinish: async (standings, telemetry) => {
        try {
          const res = await api(`/api/ladder/${currentSaveId}/race/commit`, "POST", { standings, telemetry });
          currentView = res.view;
          pendingMidrace = null;
          toast(`Chequered Flag! Winner: ${res.debrief.winner} · Cash ${fmtMoney(currentView.state.economy.cash_k)}`);
          setTimeout(() => {
            if (liveSim) liveSim.stop();
            renderAll();
            openDebriefModal(res.debrief, res.season_complete);
          }, 900);
        } catch (e) { toast(e.message, true); }
      },
    });
    if (resumeSnap) {
      liveSim.restoreFromSnapshot(currentView, resumeSnap);
    } else {
      liveSim.initRace(currentView);
    }
  }

  function renderLiveHud(hud) {
    const u = currentView.tier_config.unlocks;
    document.getElementById("pw-lap-counter").textContent = `LAP ${hud.leadLap}/${hud.totalLaps}${hud.safetyCarLaps ? " · SC" : ""}`;
    document.getElementById("pw-pause-btn").textContent = hud.paused ? "Resume" : "Pause";
    const apBtn = document.getElementById("pw-autopause-btn");
    apBtn.textContent = `Auto-Pause: ${hud.autoPause ? "ON" : "OFF"}`;
    apBtn.classList.toggle("active", hud.autoPause);
    document.querySelectorAll(".ld-spd").forEach((b) => b.classList.toggle("active", Number(b.dataset.spd) === hud.speed));

    const pb = document.getElementById("pw-pause-banner");
    if (hud.pauseBanner) {
      pb.classList.remove("hidden");
      pb.innerHTML = `<strong>⚠ ${esc(hud.pauseBanner.title)}</strong><div>${esc(hud.pauseBanner.text)}</div><button type="button" id="pw-banner-resume" class="ld-btn ld-btn-sm ld-btn-red" style="margin-top:6px">Acknowledge &amp; Resume</button>`;
      document.getElementById("pw-banner-resume")?.addEventListener("click", () => liveSim && liveSim.togglePause(false));
    } else {
      pb.classList.add("hidden");
    }

    document.getElementById("pw-radar-strip").innerHTML = `
      <span>🌧 <b>Rain Radar:</b> Track Wetness ${hud.wetness}% (Forecast ${hud.targetWetness}% ±${hud.rainUncertainty}%)</span>
      <span>${hud.safetyCarLaps > 0 ? "<b style='color:#facc15'>🟡 SAFETY CAR ACTIVE (Pit Loss -44%)</b>" : "🟢 GREEN TRACK"}</span>
      ${u.team_orders ? `<span style="display:inline-flex;gap:4px"><button type="button" class="ld-btn ld-btn-sm" id="btn-order-swap">Swap Cars</button><button type="button" class="ld-btn ld-btn-sm" id="btn-order-hold">Hold Pos</button></span>` : `<span>${u.live_radio ? "📻 Live Pit Radio Active" : "🔇 Karting: Zero Radio / Zero Pit Stops"}</span>`}
    `;
    document.getElementById("btn-order-swap")?.addEventListener("click", () => liveSim && liveSim.issueTeamOrder("swap"));
    document.getElementById("btn-order-hold")?.addEventListener("click", () => liveSim && liveSim.issueTeamOrder("hold"));

    // Dual Player Driver Strategy Cards
    document.getElementById("pw-drivers-deck").innerHTML = hud.playerCars.map((c) => {
      const comp = hud.compounds[c.compound] || { code: "M", color: "#facc15" };
      const pitBtns = u.pit_stops ? `
        <div class="ld-ctrl-row">
          <span style="font-size:0.64rem;color:#22d3ee;font-weight:800">BOX→Rejoin P${c.rejoin.rejoinPos} (${c.rejoin.trafficGapS}s gap):</span>
          ${["soft", "medium", "hard", "inter", "wet"].map((ck) => `<button type="button" class="ld-btn ld-btn-sm btn-box" data-did="${esc(c.driver_id)}" data-comp="${ck}" style="${c.boxPending === ck ? "border-color:#22c55e;background:rgba(34,197,94,0.25)" : ""}">${ck[0].toUpperCase()}</button>`).join("")}
        </div>
      ` : "";
      const engBtns = u.ers_engine_modes ? `
        <div class="ld-ctrl-row">
          <span style="font-size:0.62rem;color:#94a3b8;font-weight:800">PU MAP:</span>
          ${[["lean", "LEAN"], ["standard", "STD"], ["rich", "RICH"]].map(([em, lbl]) => `<button type="button" class="ld-btn ld-btn-sm btn-eng${c.engineMode === em ? " active" : ""}" data-did="${esc(c.driver_id)}" data-eng="${em}">${lbl}</button>`).join("")}
        </div>
      ` : "";
      const paceBtns = u.live_radio ? `
        <div class="ld-ctrl-row">
          ${["conserve", "neutral", "push"].map((pm) => `<button type="button" class="ld-btn ld-btn-sm btn-pace${c.paceMode === pm ? " active" : ""}" data-did="${esc(c.driver_id)}" data-mode="${pm}">${pm.toUpperCase()}</button>`).join("")}
          ${u.ers_engine_modes ? `
            <button type="button" class="ld-btn ld-btn-sm btn-ers${c.ersMode === "overtake" ? " active" : ""}" data-did="${esc(c.driver_id)}" data-ers="${c.ersMode === "overtake" ? "harvest" : "overtake"}">⚡ ERS ${Math.round(c.ers)}%</button>
          ` : ""}
        </div>
        ${engBtns}
      ` : `<p style="font-size:0.65rem;color:#94a3b8;margin-top:4px">Pre-race coaching active (no radio in Karting).</p>`;

      return `
        <div class="ld-drv-ctrl">
          <div class="ld-item-top" style="margin:0">
            <strong>P${c.pos} · ${esc(c.name)}</strong>
            <span class="ld-tag" style="color:${comp.color}">${comp.code} ${Math.round(c.tyreLife)}%</span>
          </div>
          <div style="font-size:0.66rem;color:#94a3b8;display:flex;gap:8px;flex-wrap:wrap;margin-top:2px">
            <span>Surf ${Math.round(c.surfTemp)}°C / Core ${Math.round(c.coreTemp)}°C</span>
            ${c.trait ? `<span style="color:#a5f3fc">${esc(c.trait)}</span>` : ""}
            ${c.thermalCliff ? `<b style="color:#f87171">🔥 THERMAL CLIFF</b>` : ""}
            ${c.inDirtyAir ? `<b style="color:#fbbf24">💨 DIRTY AIR</b>` : ""}
          </div>
          ${paceBtns}
          ${pitBtns}
        </div>
      `;
    }).join("");

    document.querySelectorAll(".btn-pace").forEach((b) => b.addEventListener("click", () => liveSim && liveSim.setDriverPace(b.dataset.did, b.dataset.mode)));
    document.querySelectorAll(".btn-ers").forEach((b) => b.addEventListener("click", () => liveSim && liveSim.setDriverErs(b.dataset.did, b.dataset.ers)));
    document.querySelectorAll(".btn-eng").forEach((b) => b.addEventListener("click", () => liveSim && liveSim.setDriverEngine(b.dataset.did, b.dataset.eng)));
    document.querySelectorAll(".btn-box").forEach((b) => b.addEventListener("click", () => liveSim && liveSim.callPitBox(b.dataset.did, b.dataset.comp)));

    document.getElementById("pw-timing-tower").innerHTML = hud.standings.slice(0, 22).map((c) => {
      const comp = hud.compounds[c.compound] || { code: "M", color: "#facc15" };
      return `
        <div class="ld-tower-row${c.is_player ? " is-me" : ""}">
          <span>${c.dnf ? "OUT" : "P" + c.pos}</span>
          <span style="color:${esc(c.color)};font-weight:800">${esc(c.code3)}</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</span>
          <span style="color:${comp.color};font-weight:800">${comp.code}</span>
          <span>${c.dnf ? "DNF" : (c.pos === 1 ? "LEAD" : "+" + c.gapLeaderS.toFixed(1))}</span>
        </div>
      `;
    }).join("");

    document.getElementById("pw-event-feed").innerHTML = hud.events.map((ev) => `
      <div class="ld-ev ev-${esc(ev.kind)}"><b>L${ev.lap} ${esc(ev.title)}:</b> ${esc(ev.text)}</div>
    `).join("");
  }

  function renderFactoryTab() {
    const st = currentView.state;
    const tcfg = currentView.tier_config;
    const u = tcfg.unlocks;

    document.getElementById("fac-list").innerHTML = tcfg.facilities.map((f) => {
      const lv = Number(st.facilities[f.id] || 1);
      const costK = +(f.base_cost_k * Math.pow(1.45, lv - 1)).toFixed(1);
      return `
        <div class="ld-item">
          <div class="ld-item-top"><strong>${esc(f.name)}</strong><span class="ld-tag ld-tag-ok">Lv ${lv} / ${f.max_lv}</span></div>
          <p>${esc(f.effect)}</p>
          <div class="ld-bar"><span style="width:${(lv / f.max_lv) * 100}%"></span></div>
          <div class="ld-ctrl-row">
            <button type="button" class="ld-btn ld-btn-sm btn-up-fac" data-fid="${esc(f.id)}" ${lv >= f.max_lv ? "disabled" : ""}>${lv >= f.max_lv ? "MAXED" : `Upgrade (${fmtMoney(costK)})`}</button>
          </div>
        </div>
      `;
    }).join("");
    document.querySelectorAll(".btn-up-fac").forEach((b) => b.addEventListener("click", async () => {
      try {
        const res = await api(`/api/ladder/${currentSaveId}/facility/upgrade`, "POST", { facility_id: b.dataset.fid });
        currentView = res.view;
        toast(res.message, !res.ok);
        renderAll();
      } catch (e) { toast(e.message, true); }
    }));

    // F1 Car Philosophy & Wind Tunnel Correlation
    const rdEl = document.getElementById("rd-panel");
    if (!u.custom_rd_correlation) {
      rdEl.innerHTML = `<div class="ld-item"><div class="ld-item-top"><strong>Spec Machinery Tier (${esc(tcfg.short)})</strong><span class="ld-tag">LOCKED</span></div><p>Custom Car Philosophy Vectors (Low-Speed Downforce, High-Speed Efficiency, Drag, Tire Preservation, Cooling) &amp; Wind-Tunnel-to-Track Correlation unlock in <b>Tier 5: Formula 1</b>.</p></div>`;
    } else {
      const ph = st.rd.philosophy;
      const vecMeta = [
        ["low_speed_df", "Low-Speed Downforce"],
        ["high_speed_eff", "High-Speed Efficiency"],
        ["drag", "Low-Drag Slipstream"],
        ["tyre_pres", "Tire Preservation"],
        ["cooling", "PU & Brake Cooling"],
      ];
      rdEl.innerHTML = `
        <div class="ld-item">
          <div class="ld-item-top"><strong>Wind-Tunnel Correlation Accuracy</strong><span class="ld-tag ld-tag-ok">${st.rd.correlation_accuracy.toFixed(1)}%</span></div>
          <p>CFD Hours: <b>${st.rd.cfd_hours}h</b> · Wind Tunnel Runs: <b>${st.rd.wind_tunnel_runs}</b> · Pending Track Validation: <b>${st.rd.pending_upgrades.length}</b></p>
        </div>
        ${vecMeta.map(([vk, lbl]) => `
          <div class="ld-item" style="padding:6px 8px">
            <div class="ld-item-top"><strong>${lbl}</strong><span class="ld-mono">${ph[vk]}</span></div>
            <div class="ld-bar"><span style="width:${ph[vk]}%"></span></div>
            <div class="ld-ctrl-row"><button type="button" class="ld-btn ld-btn-sm btn-dev-rd" data-vec="${vk}">Manufacture Package (15h CFD · Counts vs Cost Cap)</button></div>
          </div>
        `).join("")}
        ${(st.rd.upgrade_log || []).slice(0, 4).map((l) => `<div class="ld-ev"><b>R${l.round} ${esc(l.name)}:</b> Pred +${l.predicted} → Track ${l.realized >= 0 ? "+" : ""}${l.realized} (${esc(l.status)})</div>`).join("")}
      `;
      rdEl.querySelectorAll(".btn-dev-rd").forEach((b) => b.addEventListener("click", async () => {
        try {
          const res = await api(`/api/ladder/${currentSaveId}/rd/develop`, "POST", { vector: b.dataset.vec });
          currentView = res.view;
          toast(res.message, !res.ok);
          renderAll();
        } catch (e) { toast(e.message, true); }
      }));
    }

    // Dual-Ledger Accounting, Spare Parts Stock & Cost Cap
    const eco = st.economy;
    const parts = currentView.spare_parts || [];
    const partsHtml = parts.length ? `
      <div class="ld-item" style="border-color:rgba(249,115,22,0.45)">
        <div class="ld-item-top"><strong>Spare Parts Stock${u.cost_cap ? " (Counts vs Cost Cap)" : ""}</strong><span class="ld-tag ld-tag-warn">CRASH BUFFER</span></div>
        <div class="ld-parts-grid">
          ${parts.map((p) => `
            <div class="ld-part-pill${p.stock === 0 ? " is-empty" : ""}">
              <div class="ld-part-top"><b>${esc(p.short)}</b><span class="ld-mono">${p.stock}×</span></div>
              <button type="button" class="ld-btn ld-btn-sm btn-build-part" data-pid="${esc(p.id)}" title="${esc(p.name)} (Emergency if 0: ${fmtMoney(p.emergency_cost_k)})">+1 (${fmtMoney(p.unit_cost_k)})</button>
            </div>
          `).join("")}
        </div>
      </div>
    ` : "";

    const ecoEl = document.getElementById("eco-ledger");
    ecoEl.innerHTML = `
      <div class="ld-item">
        <div class="ld-item-top"><strong>Cash On Hand</strong><span class="ld-mono">${fmtMoney(eco.cash_k)}</span></div>
        <p>Sponsor/Rd: <b>${fmtMoney(eco.sponsor_per_round_k)}</b> · Crash Repairs YTD: <b style="color:#f87171">${fmtMoney(eco.repair_bills_ytd_k)}</b></p>
        ${u.cost_cap ? `<p><b>FIA Cost Cap:</b> ${fmtMoney(eco.cost_cap_spent_k)} / ${fmtMoney(eco.cost_cap_limit_k)} · Exempt Salaries: ${fmtMoney(eco.exempt_spent_k)}</p>` : ""}
      </div>
      ${partsHtml}
      ${(eco.ledger || []).slice(0, 12).map((row) => `
        <div class="ld-item" style="padding:5px 8px">
          <div class="ld-item-top" style="margin:0">
            <span style="font-size:0.7rem">R${row.round} · ${esc(row.label)}</span>
            <b style="color:${row.delta_k >= 0 ? "#4ade80" : "#f87171"}">${row.delta_k >= 0 ? "+" : ""}${fmtMoney(row.delta_k)}</b>
          </div>
        </div>
      `).join("")}
    `;
    ecoEl.querySelectorAll(".btn-build-part").forEach((b) => b.addEventListener("click", async () => {
      try {
        const res = await api(`/api/ladder/${currentSaveId}/parts/manufacture`, "POST", { part_id: b.dataset.pid });
        currentView = res.view;
        toast(res.message, !res.ok);
        renderAll();
      } catch (e) { toast(e.message, true); }
    }));
  }

  function renderRosterTab() {
    const st = currentView.state;
    const pDrvs = currentView.player_drivers || [];
    document.getElementById("roster-active").innerHTML = pDrvs.map((d, idx) => `
      <div class="ld-item">
        <div class="ld-item-top"><strong>Seat #${idx + 1}: ${esc(d.name)} (${d.nationality}, ${d.age}y)</strong><span class="ld-tag ld-tag-ok">OVR ${d.overall} / POT ${d.potential}</span></div>
        <p>Trait: <b>${esc(d.trait)}</b> · Salary: ${fmtMoney(d.salary_k)}/yr${d.pay_driver_k > 0 ? ` · <span style="color:#4ade80">Pay Driver +${fmtMoney(d.pay_driver_k)}/yr</span>` : ""}</p>
        <p>PAC ${d.stats.pace} · RC ${d.stats.racecraft} · TYR ${d.stats.tyre_care} · WET ${d.stats.wet} · CON ${d.stats.consistency}</p>
        <p><b>Ego ${d.ego}</b> vs <b>Trust ${d.trust}</b> · <b>FIA Super License:</b> <span style="color:${d.sl_eligible ? "#4ade80" : "#fbbf24"}">${d.sl_points}/40 pts</span> [${(d.sl_history || []).join(", ")}]</p>
      </div>
    `).join("");

    document.getElementById("roster-market").innerHTML = (currentView.market_drivers || []).map((d) => `
      <div class="ld-item">
        <div class="ld-item-top"><strong>${esc(d.name)} (${d.age}y · ${d.tier.toUpperCase()})</strong><span class="ld-tag">OVR ${d.overall} · POT ${esc(d.pot_display)}</span></div>
        <p>${esc(d.trait)} · SL: <b style="color:${d.sl_eligible ? "#4ade80" : "#fbbf24"}">${d.sl_points}/40</b> · ${d.pay_driver_k > 0 ? `Pay +${fmtMoney(d.pay_driver_k)}` : `Sal ${fmtMoney(d.salary_k)}`}</p>
        <div class="ld-ctrl-row">
          ${!d.scouted ? `<button type="button" class="ld-btn ld-btn-sm btn-scout" data-did="${esc(d.id)}">Dispatch Scout</button>` : ""}
          <button type="button" class="ld-btn ld-btn-sm btn-sign" data-did="${esc(d.id)}" data-seat="0">Sign Seat #1</button>
          <button type="button" class="ld-btn ld-btn-sm btn-sign" data-did="${esc(d.id)}" data-seat="1">Sign Seat #2</button>
        </div>
      </div>
    `).join("");

    document.querySelectorAll(".btn-scout").forEach((b) => b.addEventListener("click", async () => {
      try {
        const res = await api(`/api/ladder/${currentSaveId}/scout`, "POST", { driver_id: b.dataset.did });
        currentView = res.view; toast(res.message, !res.ok); renderAll();
      } catch (e) { toast(e.message, true); }
    }));
    document.querySelectorAll(".btn-sign").forEach((b) => b.addEventListener("click", async () => {
      try {
        const res = await api(`/api/ladder/${currentSaveId}/driver/sign`, "POST", { driver_id: b.dataset.did, seat_idx: Number(b.dataset.seat) });
        currentView = res.view; toast(res.message, !res.ok); renderAll();
      } catch (e) { toast(e.message, true); }
    }));

    document.getElementById("roster-staff").innerHTML = `
      <h4 class="ld-subhead" style="margin-top:0">Your Pit Wall Staff</h4>
      ${(st.staff || []).map((s) => `
        <div class="ld-item">
          <div class="ld-item-top"><strong>${esc(s.name)}</strong><span class="ld-tag ${s.gardening_rounds_left > 0 ? "ld-tag-warn" : "ld-tag-ok"}">${s.gardening_rounds_left > 0 ? `GARDENING LEAVE (${s.gardening_rounds_left}R)` : `RTG ${s.rating}`}</span></div>
          <p>${esc(s.role)} · ${fmtMoney(s.salary_k)}/yr${s.exempt_top3 ? " · Cap Exempt" : ""}</p>
        </div>
      `).join("")}
      <h4 class="ld-subhead">Poachable Rival Staff</h4>
      ${(st.staff_market || []).map((s) => `
        <div class="ld-item">
          <div class="ld-item-top"><strong>${esc(s.name)} (${esc(s.from_team)})</strong><span class="ld-tag">RTG ${s.rating}</span></div>
          <p>${esc(s.role)} · Buyout ${fmtMoney(s.buyout_k)} · Gardening Leave: <b>${s.gardening_rounds}R</b> (Min ${s.tier_min.toUpperCase()})</p>
          <div class="ld-ctrl-row"><button type="button" class="ld-btn ld-btn-sm btn-poach" data-sid="${esc(s.id)}">Poach Staff</button></div>
        </div>
      `).join("")}
    `;
    document.querySelectorAll(".btn-poach").forEach((b) => b.addEventListener("click", async () => {
      try {
        const res = await api(`/api/ladder/${currentSaveId}/staff/poach`, "POST", { staff_id: b.dataset.sid });
        currentView = res.view; toast(res.message, !res.ok); renderAll();
      } catch (e) { toast(e.message, true); }
    }));
  }

  function renderWorldTab() {
    const ts = currentView.tier_standings;
    const activeTid = worldViewTier || currentView.state.tier;
    document.getElementById("world-tier-btns").innerHTML = currentView.all_tiers_meta.map((tm) => `
      <button type="button" class="ld-btn ld-btn-sm btn-w-tier${tm.id === activeTid ? " active" : ""}" data-wt="${tm.id}" style="border-color:${tm.color}">
        ${tm.rank}. ${tm.short} (R${ts[tm.id].round}/${ts[tm.id].total_rounds})
      </button>
    `).join("");
    document.querySelectorAll(".btn-w-tier").forEach((b) => b.addEventListener("click", () => { worldViewTier = b.dataset.wt; renderWorldTab(); }));

    const cur = ts[activeTid];
    document.getElementById("world-teams-title").innerHTML = `<i class="fas fa-trophy"></i> ${esc(cur.name)} — Teams`;
    document.getElementById("world-drivers-title").innerHTML = `<i class="fas fa-id-badge"></i> ${esc(cur.short)} Drivers &amp; Rolling 3-Yr Super License`;

    document.getElementById("world-teams").innerHTML = cur.teams.map((t, i) => `
      <div class="ld-item" style="${t.is_player ? "border-color:#fde047" : ""}">
        <div class="ld-item-top">
          <span class="ld-team-row-left">
            ${t.car_icon_url ? `<img class="ld-car-thumb" src="${esc(t.car_icon_url)}" alt="${esc(t.name)}" loading="lazy">` : ""}
            <strong>#${i + 1} <span style="color:${esc(t.color)}">●</span> ${esc(t.name)}</strong>
          </span>
          <span class="ld-mono">${t.points} pts</span>
        </div>
        <p>Principal: ${esc(t.principal)} · Car Rating ${t.car_rating}</p>
      </div>
    `).join("");

    document.getElementById("world-drivers").innerHTML = cur.drivers.map((d, i) => `
      <div class="ld-item" style="padding:6px 8px">
        <div class="ld-item-top" style="margin:0">
          <strong>#${i + 1} ${esc(d.name)} (${d.age}y · ${esc(d.team)})</strong>
          <span class="ld-mono">${d.points} pts</span>
        </div>
        <p style="margin:2px 0 0">OVR ${d.overall} · POT ${esc(d.pot_display)} · SL: <b style="color:${d.sl_eligible ? "#4ade80" : "#fbbf24"}">${d.sl_points}/40</b> [${(d.sl_history || []).join(",")}] · ${esc(d.trait)}</p>
      </div>
    `).join("");
  }

  function renderPoliticsTab() {
    const st = currentView.state;
    const tcfg = currentView.tier_config;
    const u = tcfg.unlocks;

    const f1Icons = currentView.f1_car_icons || {};

    // 1. Promotion & Hybrid Career Fork
    const forkEl = document.getElementById("pol-fork");
    const isSeasonEnd = st.weekend.phase === "season_end";
    if (st.tier === "f2" || st.tier === "f1") {
      const offers = (st.player.poach_offers && st.player.poach_offers.length)
        ? st.player.poach_offers
        : st.tiers.f1.teams.filter((t) => !t.is_player).slice(0, 3).map((t) => ({ f1_team: t.name, color: t.color, car_rating: t.car_rating, budget_k: 132000 }));
      forkEl.innerHTML = `
        <div class="ld-item" style="border-color:#e10600">
          <div class="ld-item-top"><strong>THE HYBRID CAREER FORK (${st.tier === "f2" ? "F2 → F1" : "F1 Mercenary"})</strong><span class="ld-tag ld-tag-warn">${isSeasonEnd ? "DECISION READY" : "PREVIEW"}</span></div>
          <p>Choose your path into or across Formula 1:</p>
        </div>
        <div class="ld-item">
          <div class="ld-item-top"><strong>Path A / C — ${st.tier === "f2" ? "The Poach (F1 TP Offer)" : "The Mercenary Move"}</strong></div>
          <p>Accept a Team Principal offer from an F1 constructor. Your original feeder team (${esc(st.player.original_feeder_team)}) continues as a living AI rival!</p>
          <div class="ld-ctrl-row">
            ${offers.map((o) => `<button type="button" class="ld-btn ld-btn-sm btn-fork" data-act="${st.tier === "f2" ? "poach" : "mercenary"}" data-team="${esc(o.f1_team)}" style="display:inline-flex;align-items:center;gap:5px">${f1Icons[o.f1_team] ? `<img class="ld-car-thumb" style="height:16px" src="${esc(f1Icons[o.f1_team])}" alt="" loading="lazy">` : ""}Join ${esc(o.f1_team)} (Car ${o.car_rating})</button>`).join("")}
          </div>
        </div>
        ${st.tier === "f2" ? `
        <div class="ld-item">
          <div class="ld-item-top"><strong>Path B — The Constructor Bid (Stay Owner!)</strong></div>
          <p>Reject poaching offers, secure title sponsors, buy out a backmarker slot &amp; bring <b>${esc(st.player.team_name)}</b> into Formula 1 as your own Constructor!</p>
          <div class="ld-ctrl-row"><button type="button" class="ld-btn ld-btn-red btn-fork" data-act="constructor_bid">Submit Own F1 Constructor Bid</button></div>
        </div>
        ` : ""}
        ${isSeasonEnd ? `<button type="button" class="ld-btn btn-fork" data-act="stay">Stay &amp; Start Season ${st.season + 1}</button>` : ""}
      `;
    } else {
      forkEl.innerHTML = `
        <div class="ld-item">
          <div class="ld-item-top"><strong>Next Rung: ${(currentView.next_tier || "").toUpperCase()}</strong><span class="ld-tag ${currentView.can_promote ? "ld-tag-ok" : "ld-tag-warn"}">${currentView.can_promote ? "ELIGIBLE" : "IN PROGRESS"}</span></div>
          <p>Requirements at Season End: Reputation ≥ <b>${tcfg.promotion_rep}</b> OR Cash ≥ <b>${fmtMoney(tcfg.promotion_cash_k)}</b>.</p>
          <div class="ld-ctrl-row">
            <button type="button" class="ld-btn ld-btn-red btn-fork" data-act="promote">Promote to ${(currentView.next_tier || "").toUpperCase()} Now</button>
            ${isSeasonEnd ? `<button type="button" class="ld-btn btn-fork" data-act="stay">Stay in ${tcfg.short} for S${st.season + 1}</button>` : ""}
          </div>
        </div>
      `;
    }
    forkEl.querySelectorAll(".btn-fork").forEach((b) => b.addEventListener("click", async () => {
      try {
        const res = await api(`/api/ladder/${currentSaveId}/fork/choose`, "POST", { action: b.dataset.act, target_f1_team: b.dataset.team || null });
        currentView = res.view; worldViewTier = currentView.state.tier;
        toast(res.message, !res.ok); renderAll();
      } catch (e) { toast(e.message, true); }
    }));

    // 2. F1 Academy Affiliate Contracts (F3/F2)
    const acadEl = document.getElementById("pol-academy");
    if (!u.academy_affiliates) {
      acadEl.innerHTML = `<div class="ld-item"><p>F1 Academy Affiliate deals unlock in <b>Tier 3 (Formula 3)</b> &amp; <b>Tier 4 (Formula 2)</b> — providing major funding and an F1 junior seat with strict KPI targets.</p></div>`;
    } else if (st.academy_deal) {
      const ad = st.academy_deal;
      acadEl.innerHTML = `<div class="ld-item" style="border-color:${esc(ad.color)}"><div class="ld-item-top"><strong>Active: ${esc(ad.f1_team)}</strong><span class="ld-tag ld-tag-ok">+${fmtMoney(ad.funding_k)}/yr</span></div><p>Junior: <b>${esc(ad.junior_name)}</b> · KPI Target: Finish P${ad.kpi_min_pos} or better (Penalty: ${fmtMoney(ad.penalty_k)}).</p></div>`;
    } else {
      acadEl.innerHTML = (st.academy_offers || []).map((o) => `
        <div class="ld-item">
          <div class="ld-item-top">
            <span class="ld-team-row-left">
              ${f1Icons[o.f1_team] ? `<img class="ld-car-thumb" src="${esc(f1Icons[o.f1_team])}" alt="" loading="lazy">` : ""}
              <strong>${esc(o.f1_team)}</strong>
            </span>
            <span class="ld-tag ld-tag-ok">+${fmtMoney(o.funding_k)}/yr</span>
          </div>
          <p>Places Junior <b>${esc(o.junior_name)}</b> (OVR ${o.junior_ovr}, POT ${o.junior_pot}) in Seat #2 · KPI: Top P${o.kpi_min_pos}.</p>
          <div class="ld-ctrl-row"><button type="button" class="ld-btn ld-btn-sm btn-acad" data-oid="${esc(o.id)}">Sign Affiliate Contract</button></div>
        </div>
      `).join("");
      acadEl.querySelectorAll(".btn-acad").forEach((b) => b.addEventListener("click", async () => {
        try {
          const res = await api(`/api/ladder/${currentSaveId}/academy/deal`, "POST", { offer_id: b.dataset.oid });
          currentView = res.view; toast(res.message, !res.ok); renderAll();
        } catch (e) { toast(e.message, true); }
      }));
    }

    // 3. FIA Governance Voting (F1 — Paddock Profiles + Regulation Architect + FIA Docs Precedent)
    const fiaEl = document.getElementById("pol-fia");
    if (!u.fia_voting) {
      fiaEl.innerHTML = `<div class="ld-item"><p>FIA Regulation Commission voting unlocks in <b>Tier 5 (Formula 1)</b>, where real Team Principals vote by leadership style, car strengths &amp; job stress.</p></div>`;
    } else {
      const gov = st.fia_governance;
      const p = gov.active_proposal;
      const tally = gov.last_tally;
      const prec = (tally && tally.fia_precedent) || currentView.fia_precedent;
      const tpVotes = (tally && tally.votes) ? tally.votes : [];
      const playerTeamLow = String(st.player.team_name || "").toLowerCase();
      const lobbyCandidates = (!gov.voted ? (gov.tp_roster || []) : [])
        .filter((tp) => String(tp.team || "").toLowerCase() !== playerTeamLow)
        .slice(0, 8);
      const lobbyHtml = lobbyCandidates.length ? `
        <div style="margin-top:6px">
          <span style="font-size:0.64rem;color:#94a3b8;font-weight:800;text-transform:uppercase">Backroom Lobbying (select up to 3 rival TPs):</span>
          <div class="ld-lobby-grid">
            ${lobbyCandidates.map((tp) => {
              const checked = selectedLobbyTps.has(tp.id);
              return `
                <label class="ld-lobby-chip">
                  <input type="checkbox" class="chk-lobby-tp" value="${esc(tp.id)}"${checked ? " checked" : ""}>
                  <span><b>${esc(tp.name)}</b> · ${esc(tp.team)} (${tp.job_stress || 40}% stress)</span>
                </label>
              `;
            }).join("")}
          </div>
        </div>
      ` : "";
      fiaEl.innerHTML = `
        <div class="ld-item">
          <div class="ld-item-top"><strong>${esc(p.title)}</strong><span class="ld-tag">${esc(p.category)}</span></div>
          <p>${esc(p.desc)}</p>
          ${prec ? `<p class="ld-fia-prec"><b>FIA Precedent (${prec.year} ${esc(prec.event_name)}):</b> ${esc(prec.title)} — <i>${esc(prec.excerpt)}</i></p>` : ""}
          ${lobbyHtml}
          <div class="ld-ctrl-row">
            <button type="button" class="ld-btn ld-btn-sm btn-fia-vote" data-v="yes" ${gov.voted ? "disabled" : ""}>Vote YES</button>
            <button type="button" class="ld-btn ld-btn-sm btn-fia-vote" data-v="no" ${gov.voted ? "disabled" : ""}>Vote NO</button>
          </div>
          ${tally ? `<p style="margin-top:6px;color:#38bdf8"><b>Commission Tally:</b> ${tally.yes} YES – ${tally.no} NO (Needed ${tally.needed || 7} · FIA: ${esc(tally.fia_vote || "YES")} · <b>${tally.passed ? "PASSED" : "REJECTED"}</b>)</p>` : ""}
        </div>
        ${tpVotes.length ? `<div class="ld-tp-votes">${tpVotes.map((v) => `
          <div class="ld-item" style="padding:5px 8px">
            <div class="ld-item-top" style="margin:0">
              <span style="font-size:0.69rem"><b>${esc(v.name)}</b> (${esc(v.team)})</span>
              <span class="ld-tag ${v.vote === "YES" ? "ld-tag-ok" : "ld-tag-warn"}">${esc(v.vote)}</span>
            </div>
            <p style="margin:2px 0 0;font-size:0.64rem">${esc(v.leadership_label)} · Stress ${v.job_stress}% · ${esc(v.reason)}</p>
          </div>
        `).join("")}</div>` : ""}
      `;
      fiaEl.querySelectorAll(".chk-lobby-tp").forEach((chk) => chk.addEventListener("change", () => {
        if (chk.checked) {
          if (selectedLobbyTps.size >= 3) {
            chk.checked = false;
            toast("You can lobby at most 3 Team Principals per Commission vote.", true);
            return;
          }
          selectedLobbyTps.add(chk.value);
        } else {
          selectedLobbyTps.delete(chk.value);
        }
      }));
      fiaEl.querySelectorAll(".btn-fia-vote").forEach((b) => b.addEventListener("click", async () => {
        try {
          const res = await api(`/api/ladder/${currentSaveId}/fia/vote`, "POST", {
            vote: b.dataset.v,
            lobbied_tp_ids: Array.from(selectedLobbyTps),
          });
          selectedLobbyTps.clear();
          currentView = res.view; toast(res.message, !res.ok); renderAll();
        } catch (e) { toast(e.message, true); }
      }));
    }
  }

  // Wire Static Controls
  document.querySelectorAll(".ld-tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.ldTab)));
  document.getElementById("btn-go-weekend")?.addEventListener("click", () => switchTab("weekend"));
  document.getElementById("btn-open-new")?.addEventListener("click", () => document.getElementById("new-ladder-modal").classList.remove("hidden"));
  document.getElementById("btn-close-modal")?.addEventListener("click", () => document.getElementById("new-ladder-modal").classList.add("hidden"));
  document.getElementById("btn-open-reports")?.addEventListener("click", openReportsModal);
  document.getElementById("btn-close-reports")?.addEventListener("click", () => document.getElementById("reports-modal").classList.add("hidden"));
  document.getElementById("btn-close-debrief")?.addEventListener("click", () => document.getElementById("debrief-modal").classList.add("hidden"));
  document.getElementById("btn-debrief-continue")?.addEventListener("click", (e) => {
    document.getElementById("debrief-modal").classList.add("hidden");
    if (e.currentTarget.dataset.seasonComplete === "1") switchTab("politics");
  });
  document.getElementById("sel-saves")?.addEventListener("change", (e) => { if (e.target.value) loadSave(e.target.value); });
  document.getElementById("btn-delete-save")?.addEventListener("click", async () => {
    if (!currentSaveId || !currentView) return;
    const tName = currentView.state.player.team_name || "this career";
    if (!window.confirm(`Delete Ladder save "${tName}" permanently?`)) return;
    try {
      await api(`/api/ladder/state/${encodeURIComponent(currentSaveId)}`, "DELETE");
      localStorage.removeItem("traf1_ladder_save");
      pendingMidrace = null;
      const listRes = await api("/api/ladder/saves");
      const remaining = listRes.saves || [];
      toast(`Deleted "${tName}".`);
      if (remaining.length > 0) {
        await loadSave(remaining[0].save_id);
      } else {
        currentSaveId = null;
        currentView = null;
        await refreshSavesDropdown();
        document.getElementById("new-ladder-modal").classList.remove("hidden");
      }
    } catch (e) { toast(e.message, true); }
  });

  document.querySelectorAll(".ld-tier-opt").forEach((b) => b.addEventListener("click", () => {
    selectedStartTier = b.dataset.startTier;
    document.querySelectorAll(".ld-tier-opt").forEach((x) => x.classList.toggle("active", x === b));
  }));

  document.getElementById("btn-create-ladder")?.addEventListener("click", async () => {
    try {
      const res = await api("/api/ladder/new", "POST", {
        team_name: document.getElementById("in-team-name").value,
        principal_name: document.getElementById("in-principal-name").value,
        color: document.getElementById("in-color").value,
        start_tier: selectedStartTier,
      });
      currentSaveId = res.save_id;
      currentView = res.view;
      worldViewTier = currentView.state.tier;
      localStorage.setItem("traf1_ladder_save", currentSaveId);
      document.getElementById("new-ladder-modal").classList.add("hidden");
      renderAll();
      refreshSavesDropdown();
      toast(`Launched ${currentView.state.player.team_name} in ${currentView.tier_config.name}!`);
    } catch (e) { toast(e.message, true); }
  });

  // Live Pit Wall time buttons
  document.querySelectorAll(".ld-spd").forEach((b) => b.addEventListener("click", () => liveSim && liveSim.setSpeed(Number(b.dataset.spd))));
  document.getElementById("pw-pause-btn")?.addEventListener("click", () => liveSim && liveSim.togglePause());
  document.getElementById("pw-autopause-btn")?.addEventListener("click", () => liveSim && liveSim.toggleAutoPause());
  document.getElementById("pw-simend-btn")?.addEventListener("click", () => liveSim && liveSim.simToEnd());

  // Boot: load last save or auto-create a starter Karting career if none exist
  (async function boot() {
    try {
      await refreshSavesDropdown();
      const saves = window.__LADDER_SAVES__ || [];
      const lastId = localStorage.getItem("traf1_ladder_save");
      if (lastId && saves.some((s) => s.save_id === lastId)) {
        await loadSave(lastId);
      } else if (saves.length > 0) {
        await loadSave(saves[0].save_id);
      } else {
        const res = await api("/api/ladder/new", "POST", { team_name: "Apex Motorsport", principal_name: "Alex Vance", start_tier: "karting", color: "#e10600" });
        currentSaveId = res.save_id;
        currentView = res.view;
        worldViewTier = currentView.state.tier;
        localStorage.setItem("traf1_ladder_save", currentSaveId);
        renderAll();
        refreshSavesDropdown();
      }
    } catch (e) {
      toast(e.message, true);
    }
  })();
})();
