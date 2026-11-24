/**
 * F1 Team Principal Career & Season Manager Frontend (/career).
 * Connects HQ Dashboard, Fog-of-War Driver Market, Scouting Hub, Car R&D,
 * HQ Facilities, Sponsors, Standings, Qualifying, and Live 2-Car 1-Screen GPS Pit Wall!
 */
(function () {
  "use strict";

  let DATA = window.F1_CAREER_BOOT || { has_career: false };
  const STATIC_CATALOGS = {
    circuits: DATA.circuits || [],
    facility_defs: DATA.facility_defs || [],
    rd_parts: DATA.rd_parts || [],
    sponsor_catalog: DATA.sponsor_catalog || [],
    staff_roles: DATA.staff_roles || [],
    dev_focuses: DATA.dev_focuses || {},
  };
  let activeTab = "dashboard";
  let offerDriverId = null;

  function mergeStaticCatalogs(resp) {
    if (!resp || typeof resp !== "object") return resp;
    Object.keys(STATIC_CATALOGS).forEach((k) => {
      if (resp[k] && (Array.isArray(resp[k]) ? resp[k].length : Object.keys(resp[k]).length)) {
        STATIC_CATALOGS[k] = resp[k];
      } else if (STATIC_CATALOGS[k]) {
        resp[k] = STATIC_CATALOGS[k];
      }
    });
    return resp;
  }

  const ENG = window.F1RaceEngine;
  const COMPOUNDS = ENG.COMPOUNDS;

  function getEl(id) { return document.getElementById(id); }
  const esc = ENG.esc;
  const fmtLap = ENG.fmtLapTime;

  async function postJson(url, payload) {
    const body = Object.assign({}, payload || {});
    if (
      url.startsWith("/api/career/")
      && !url.startsWith("/api/career/slots")
      && !url.startsWith("/api/career/new")
      && !url.startsWith("/api/career/import")
      && !url.startsWith("/api/career/checkpoint")
      && !url.startsWith("/api/career/race/autosave")
      && DATA && DATA.state && DATA.state._save_version
      && body.expected_version == null
    ) {
      body.expected_version = DATA.state._save_version;
    }
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (r.status === 409) {
      const fresh = await fetch("/api/career/state").then((x) => x.json()).catch(() => null);
      if (fresh) {
        DATA = mergeStaticCatalogs(fresh);
        renderAll();
      }
      showHqToast("Save updated in another tab — refreshed latest state.", false);
      throw new Error(d.detail || "Concurrent save conflict");
    }
    if (!r.ok) throw new Error(d.detail || d.message || `HTTP ${r.status}`);
    mergeStaticCatalogs(d);
    if (d.profile && window.F1Profile) window.F1Profile.applyBoot(d.profile);
    if (d.newly_unlocked && d.newly_unlocked.length && window.F1Profile) window.F1Profile.showUnlockToasts(d.newly_unlocked);
    return d;
  }

  let toastTimer = null;
  function showHqToast(msg, ok = true) {
    const el = getEl("car-toast");
    if (!el) return;
    el.textContent = msg;
    el.className = `car-toast ${ok ? "toast-ok" : "toast-err"}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 3600);
  }

  function renderPortraitMini(drv, color) {
    if (drv.driver_image) {
      return `<img class="car-avatar-img" src="/${esc(drv.driver_image)}" alt="${esc(drv.clean_name)}" loading="lazy">`;
    }
    return `<div class="car-avatar-mono" style="background:${esc(color || drv.hero_color || "#334155")}">${esc(drv.code3 || "F1")}</div>`;
  }

  function circuitById(cid) {
    return (DATA.circuits || []).find((c) => c.id === cid) || (DATA.circuits || [])[0];
  }

  // Draw crisp mini GPS circuit preview on HQ Dashboard!
  function drawMiniGpsPreview(canvasId, circuit) {
    const cv = getEl(canvasId);
    if (!cv || !circuit || !circuit.points) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 260, h = cv.clientHeight || 130;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pts = circuit.points;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(([x, y]) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    });
    const pad = 16;
    const sc = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2) / Math.max(1, maxY - minY));
    const ox = (w - (maxX - minX) * sc) * 0.5 - minX * sc;
    const oy = (h - (maxY - minY) * sc) * 0.5 - minY * sc;

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * sc + ox, y * sc + oy) : ctx.lineTo(x * sc + ox, y * sc + oy)));
    ctx.closePath();
    ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Start/finish red dot
    ctx.beginPath();
    ctx.arc(pts[0][0] * sc + ox, pts[0][1] * sc + oy, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ef4444";
    ctx.fill();
  }

  // =========================================================================
  // HQ RENDERERS
  // =========================================================================
  function renderAll() {
    const wiz = getEl("career-wizard");
    const hq = getEl("career-hq");
    if (!DATA.has_career || !DATA.state) {
      document.body.classList.remove("car-hq-active");
      wiz.classList.remove("hidden");
      hq.classList.add("hidden");
      getEl("wiz-cancel-btn").classList.add("hidden");
      return;
    }

    wiz.classList.add("hidden");
    hq.classList.remove("hidden");
    if (!cr.active && getEl("career-race-view").classList.contains("hidden")) {
      document.body.classList.add("car-hq-active");
    }

    const st = DATA.state;
    const pt = DATA.player_team;
    const wccRow = (DATA.wcc || []).find((t) => t.is_player);
    const totalRnds = st.calendar.length;
    const curRnd = Math.min(st.current_round, totalRnds);
    const nextCal = st.calendar[curRnd - 1];

    // Top bar
    getEl("car-team-swatch").style.background = pt.color || "#e10600";
    getEl("car-team-name").textContent = pt.name;
    getEl("car-season-meta").textContent = st.season_complete
      ? `Season ${st.season_num} (${st.season_year}) · SEASON COMPLETE`
      : `Season ${st.season_num} (${st.season_year}) · Round ${curRnd} / ${totalRnds} · ${nextCal.name}`;

    getEl("car-kpi-cash").textContent = `$${st.cash_m.toFixed(1)}M`;
    const capEl = getEl("car-kpi-cap");
    if (capEl) {
      const spent = Number(st.cost_cap_spent_m || 0);
      const cap = Number(st.cost_cap_m || 135);
      const tier = st.cost_cap_breach_tier || "none";
      const tag = tier === "material" ? " ⚠ MATERIAL" : (tier === "minor" ? " ⚠ MINOR" : "");
      capEl.textContent = `$${spent.toFixed(0)}/$${cap.toFixed(0)}M${tag}`;
      capEl.style.color = tier !== "none" ? "#ef4444" : (spent > cap * 0.9 ? "#f59e0b" : "#38bdf8");
    }
    getEl("car-kpi-car").textContent = `${pt.car_overall}`;
    getEl("car-kpi-wcc").textContent = wccRow ? `P${wccRow.pos} (${wccRow.points}pts)` : "P—";
    getEl("car-kpi-conf").textContent = `${st.board_confidence}%`;
    const penEl = getEl("car-kpi-pen");
    if (penEl) {
      const mxPen = Number(DATA.max_player_penalty_pts || 0);
      penEl.textContent = `${mxPen}/12`;
      penEl.style.color = mxPen >= 9 ? "#ef4444" : (mxPen >= 6 ? "#f59e0b" : "#4ade80");
    }
    getEl("car-kpi-scouts").textContent = `${st.active_scouts.length}/${DATA.scout_slots}`;

    const badgeSc = getEl("car-badge-scouts");
    if (badgeSc) badgeSc.textContent = st.active_scouts.length ? `${st.active_scouts.length}` : "";
    const badgeRd = getEl("car-badge-rd");
    if (badgeRd) badgeRd.textContent = st.active_rd.length ? `${st.active_rd.length}` : "";
    const badgeDil = getEl("car-badge-dilemma");
    if (badgeDil) badgeDil.textContent = st.pending_dilemma ? "!" : "";
    const badgeStew = getEl("car-badge-stewards");
    if (badgeStew) badgeStew.textContent = st.pending_stewards ? "⚖!" : "";

    const advBtn = getEl("car-advance-season-btn");
    const raceBtn = getEl("car-go-race-btn");
    if (st.season_complete) {
      advBtn.classList.remove("hidden");
      raceBtn.classList.add("hidden");
    } else {
      advBtn.classList.add("hidden");
      raceBtn.classList.remove("hidden");
      getEl("car-go-race-label").textContent = `R${curRnd}: ${nextCal.name}`;
    }

    if (DATA.profile && window.F1Profile) window.F1Profile.applyBoot(DATA.profile);
    renderDashboard();
    renderOpsBoard();
    renderMarket();
    renderFeeders();
    renderScouting();
    renderStaff();
    renderRd();
    renderFacilities();
    renderStandingsAndFinance();
    renderDynasty();
    syncTrackHolo3D();
    if (activeTab === "rd") syncRdBlueprint3D();
    if (activeTab === "analytics" || activeTab === "stewards") refreshCareerAnalytics();
  }

  let rdBlueprint3D = null;
  let trackHolo3D = null;

  function syncRdBlueprint3D() {
    const cv = getEl("car-rd-3d-canvas");
    if (!cv || !window.CareerHQ3D || !window.CareerHQ3D.createCarBlueprint3D || !DATA.player_team) return;
    if (!rdBlueprint3D) {
      rdBlueprint3D = window.CareerHQ3D.createCarBlueprint3D(cv, getEl("car-rd-3d-badge"));
    }
    if (rdBlueprint3D) {
      const pt = DATA.player_team;
      rdBlueprint3D.sync({
        palette: pt.palette || { main: pt.color || "#e10600", secondary: "#111622", accent: "#facc15", pop: "#ffffff", detail: "#252c38" },
        style: pt.livery_style || "two-tone",
        era: pt.car_era || "2020s",
      });
    }
  }

  async function syncTrackHolo3D() {
    const cv = getEl("car-next-gp-3d");
    if (!cv || !window.CareerHQ3D || !window.CareerHQ3D.createTrackHologram3D || !DATA.state) return;
    const st = DATA.state;
    const cal = st.calendar || [];
    const nextCal = cal[Math.min(st.current_round, cal.length) - 1];
    if (!nextCal) return;
    if (!trackHolo3D) trackHolo3D = window.CareerHQ3D.createTrackHologram3D(cv);
    if (!trackHolo3D) return;
    let cir = (DATA.circuits || []).find((c) => c.id === nextCal.circuit_id);
    if ((!cir || !Array.isArray(cir.points) || cir.points.length < 4) && ENG && ENG.fetchCircuit) {
      try { cir = await ENG.fetchCircuit(nextCal.circuit_id); } catch (_) {}
    }
    if (cir && Array.isArray(cir.points) && cir.points.length >= 4) {
      trackHolo3D.sync(cir.id, cir.points, (DATA.player_team && DATA.player_team.color) || "#38bdf8");
    }
  }

  let regGrapherInst = null;
  let lastAnalyticsPayload = null;

  function renderPaddockPolitics(an) {
    const host = getEl("car-politics-host");
    if (!host || !an) return;
    const tps = an.tpProfiles || [];
    const clout = Number(an.politicalCapital || 0);
    const lobbied = new Set(an.lobbiedTps || []);
    const bills = an.commissionBillHistory || [];
    const transitions = an.paddockTransitionLog || [];

    const headHtml = `
      <div class="tp-pol-head">
        <div><strong><i class="fas fa-handshake"></i> Political Capital: <span style="color:#4ade80">${clout}/100</span></strong> · Lobbying a rival TP costs 25 Clout (+34% F1 Commission support)</div>
        <div class="muted">Active Formula: <strong style="color:#7dd3fc">${esc((an.regulationFormula && an.regulationFormula.name) || "2026 FIA Formula")}</strong></div>
      </div>
    `;

    const cardsHtml = tps.map((tp) => {
      const isLob = lobbied.has(tp.id);
      const stress = Number(tp.job_stress || 35);
      const conf = Number(tp.board_confidence || 78);
      const sCol = stress >= 70 ? "#ef4444" : (stress >= 48 ? "#f59e0b" : "#22c55e");
      const cCol = conf <= 35 ? "#ef4444" : (conf <= 60 ? "#f59e0b" : "#38bdf8");
      const stLbl = String(tp.leadership_style || "consensus_engineer").replace(/_/g, " ");
      return `
        <div class="tp-card${isLob ? " lobbied" : ""}">
          <div class="tp-card-top">
            <div><div class="tp-card-name">${esc(tp.name)}</div><div class="tp-card-team">${esc(tp.team)} · Target WCC P${tp.target_wcc || 5}</div></div>
            <span class="tp-style-pill">${esc(stLbl)}</span>
          </div>
          <div class="tp-meters">
            <div>Job Stress: <b style="color:${sCol}">${stress}%</b><div class="tp-bar"><i style="width:${stress}%;background:${sCol}"></i></div></div>
            <div>Board Security: <b style="color:${cCol}">${conf}%</b><div class="tp-bar"><i style="width:${conf}%;background:${cCol}"></i></div></div>
          </div>
          <div class="tp-card-foot">
            <span title="${esc(tp.voice_signature || "")}">Aero ${(tp.strengths && tp.strengths.aero) || 80} · PU ${(tp.strengths && tp.strengths.power) || 80} · Budget ${(tp.strengths && tp.strengths.budget) || 80}</span>
            ${isLob
              ? `<span class="car-pill-ok">✓ LOBBIED</span>`
              : `<button type="button" class="car-btn-xs car-btn-gold" data-lobby-tp="${esc(tp.id)}" ${clout < 25 ? "disabled" : ""}>Lobby (25)</button>`}
          </div>
        </div>
      `;
    }).join("");

    let feedHtml = "";
    if (bills.length) {
      const latest = bills[0];
      const roll = (latest.votes || []).slice(0, 6).map((v) =>
        `<div class="tp-vote-row"><span><b>${esc(v.name)}</b> (${esc(v.team)}) — <i>"${esc(v.quote)}"</i></span><b style="color:${v.vote === "YES" ? "#4ade80" : "#f87171"}">${v.vote}</b></div>`
      ).join("");
      feedHtml += `
        <div class="tp-vote-feed">
          <div><strong style="color:${latest.passed ? "#4ade80" : "#f87171"}">${esc(latest.summary)}</strong></div>
          ${roll}
        </div>
      `;
    }
    if (transitions.length) {
      feedHtml += `<div class="tp-vote-feed"><strong>Executive Leadership Transitions</strong>` +
        transitions.slice(0, 3).map((ev) => `<div>• <b>${esc(ev.headline)}</b> <span class="muted">${esc(ev.detail || "")}</span></div>`).join("") +
        `</div>`;
    }

    host.innerHTML = headHtml + `<div class="tp-politics-grid">${cardsHtml}</div>` + feedHtml;
    host.querySelectorAll("[data-lobby-tp]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const res = await postJson("/api/career/politics/lobby", { tp_id: btn.getAttribute("data-lobby-tp") });
        DATA = res;
        renderAll();
        showHqToast(res.message, res.ok);
        refreshCareerAnalytics();
      });
    });
  }

  async function ensureRegArchitectMounted(an) {
    const host = getEl("car-reg-architect-host");
    if (!host || !window.F1RegGrapher) return;
    if (regGrapherInst) {
      regGrapherInst.redraw();
      return;
    }
    try {
      const r = await fetch("/api/regulations/architect");
      const meta = r.ok ? await r.json() : {};
      const pt = DATA && DATA.player_team;
      regGrapherInst = window.F1RegGrapher.create(host, {
        initialFormula: (an && an.regulationFormula) || meta.default_formula,
        toolsCatalog: meta.tools_catalog || [],
        presets: meta.presets || {},
        palette: (pt && pt.palette) || null,
        liveryStyle: (pt && pt.livery_style) || "modern",
        onSubmitBill: async (formula, setMsg) => {
          try {
            const res = await postJson("/api/career/commission/bill", { formula });
            DATA = res;
            renderAll();
            showHqToast(res.message, res.ok);
            if (setMsg) setMsg(res.message);
            refreshCareerAnalytics();
          } catch (err) {
            if (setMsg) setMsg("Bill submission error: " + err);
          }
        },
      });
    } catch (_) {}
  }

  async function refreshCareerAnalytics() {
    if (!window.CareerAnalytics || !DATA.has_career) return;
    try {
      const r = await fetch("/api/career/analytics");
      if (!r.ok) return;
      const an = await r.json();
      lastAnalyticsPayload = an;
      renderPaddockPolitics(an);
      window.CareerAnalytics.renderAnalyticsWarRoom(an, {
        onStewardAction: async (action) => {
          const res = await postJson("/api/career/stewards/respond", { action });
          DATA = res; renderAll(); showHqToast(res.message, res.ok);
          refreshCareerAnalytics();
        },
        onSignPu: async (supplierId) => {
          const res = await postJson("/api/career/pu/contract", { supplier_id: supplierId });
          DATA = res; renderAll(); showHqToast(res.message, res.ok);
          refreshCareerAnalytics();
        },
        onCommissionVote: async (proposalId, support) => {
          const res = await postJson("/api/career/commission/vote", { proposal_id: proposalId, support });
          DATA = res; renderAll(); showHqToast(res.message, res.ok);
          refreshCareerAnalytics();
        },
      });
      if (getEl("car-stew-sub-architect")?.classList.contains("active")) {
        ensureRegArchitectMounted(an);
      }
    } catch (_) {}
  }

  let activeFeederSeries = "f2";
  function renderOpsBoard() {
    const board = DATA.ops_board;
    const el = getEl("car-ops-board");
    const rEl = getEl("car-silly-rumours");
    const goalEl = getEl("car-ops-goal-pill");
    if (!el || !board) return;
    const g = board.season_goal || {};
    if (goalEl && g.target_wcc) {
      goalEl.textContent = `WCC P${g.wcc_pos || "—"} / Target P${g.target_wcc} · ${g.on_track ? "ON TRACK" : "AT RISK"}`;
      goalEl.style.color = g.on_track ? "#4ade80" : "#fbbf24";
    }
    el.innerHTML = (board.departments || []).map((dep) => {
      const ctaAttr = dep.cta && dep.cta.tab
        ? `data-ops-tab="${esc(dep.cta.tab)}"`
        : `data-ops-act="${esc((dep.cta && dep.cta.action) || "")}"`;
      return `
        <div class="car-ops-row ops-${esc(dep.status || "info")}">
          <div class="car-ops-ico"><i class="fas ${esc(dep.icon || "fa-clipboard")}"></i></div>
          <div class="car-ops-txt">
            <strong>${esc(dep.role)}</strong>
            <p>${esc(dep.message)}</p>
          </div>
          ${dep.cta ? `<button type="button" class="car-btn-xs car-btn-gold" ${ctaAttr}>${esc(dep.cta.label)}</button>` : ""}
        </div>
      `;
    }).join("");

    if (rEl) {
      const rum = board.rumours || [];
      rEl.innerHTML = rum.length
        ? rum.map((r) => `<div class="car-rumour-row"><span class="car-rum-tag">${esc(r.tag)}</span><span>${esc(r.text)}</span></div>`).join("")
        : `<div class="muted small">Paddock quiet — rumours heat up as contracts near expiry!</div>`;
    }
  }

  function renderFeeders() {
    const feed = DATA.feeders || (DATA.state && DATA.state.feeders);
    const tbody = getEl("car-feeder-tbody");
    const descEl = getEl("car-feeder-desc");
    if (!tbody || !feed) return;
    const meta = (feed.series_meta && feed.series_meta[activeFeederSeries]) || { name: "Feeder Series", desc: "" };
    if (descEl) descEl.textContent = `${meta.name} (Round ${feed.rounds_completed || 0} completed) — ${meta.desc}`;

    document.querySelectorAll("[data-feeder-ser]").forEach((b) => {
      const on = b.dataset.feederSer === activeFeederSeries;
      b.classList.toggle("active", on);
      b.classList.toggle("car-btn-red", on);
    });

    const list = (feed.drivers || [])
      .filter((d) => d.series === activeFeederSeries)
      .sort((a, b) => (b.season_pts - a.season_pts) || (b.season_wins - a.season_wins) || (b.overall - a.overall));

    tbody.innerHTML = list.map((d, i) => {
      const slPct = Math.min(100, Math.round(((d.sl_points || 0) / 40) * 100));
      const slCol = d.sl_eligible ? "#22c55e" : (slPct >= 65 ? "#facc15" : "#38bdf8");
      const fee = d.series === "f2" ? "$1.2M" : "$0.7M";
      const actBtn = d.recruited
        ? `<span class="car-pill-ok">✓ IN F1 MARKET</span>`
        : `<button type="button" class="car-btn-xs car-btn-gold" data-feeder-recruit="${esc(d.id)}">Sign (${fee})</button>`;
      return `
        <tr>
          <td><b>P${i + 1}</b></td>
          <td><b>${esc(d.name)}</b> <small class="muted">${esc(d.code3)} · ${esc(d.nationality)}</small></td>
          <td>${esc(d.team)} <small class="muted">(${esc(d.academy || "Ind")})</small></td>
          <td>${d.age}</td>
          <td><b>${d.overall}</b> / <span style="color:#38bdf8">${d.potential}</span></td>
          <td><b>${d.season_pts || 0}</b> <small class="muted">(${d.season_wins || 0}W)</small></td>
          <td>
            <div style="display:flex;align-items:center;gap:6px;">
              <div class="sim-bar-track" style="width:74px;height:6px;"><div class="sim-bar-fill" style="width:${slPct}%;background:${slCol}"></div></div>
              <small style="color:${slCol};font-weight:800;">${d.sl_points}/40 ${d.sl_eligible ? "✓" : ""}</small>
            </div>
          </td>
          <td>${actBtn}</td>
        </tr>
      `;
    }).join("");
  }

  function renderDynasty() {
    const st = DATA.state;
    const pt = DATA.player_team;
    if (!st || !pt) return;
    const dyn = st.dynasty || { races: 0, wins: 0, podiums: 0, poles: 0, fastest_laps: 0, points: 0, best_pit_s: null, driver_records: {}, garage_seasons: [] };
    const rivals = st.rivalries || [];

    const badgeR = getEl("car-badge-rivals");
    if (badgeR) badgeR.textContent = rivals.length ? `${rivals.length}` : "";

    const kpiEl = getEl("car-dynasty-kpis");
    if (kpiEl) {
      const kpis = [
        ["RACES", dyn.races || 0, "#38bdf8"],
        ["WINS", dyn.wins || 0, "#fde047"],
        ["PODIUMS", dyn.podiums || 0, "#4ade80"],
        ["POLES", dyn.poles || 0, "#a855f7"],
        ["FASTEST LAPS", dyn.fastest_laps || 0, "#c084fc"],
        ["CAREER PTS", dyn.points || 0, "#f8fafc"],
        ["RECORD PIT", dyn.best_pit_s ? `${Number(dyn.best_pit_s).toFixed(2)}s` : "—", "#22c55e"],
      ];
      kpiEl.innerHTML = kpis.map(([lbl, val, col]) => `
        <div class="car-dyn-kpi"><small>${lbl}</small><b style="color:${col}">${val}</b></div>
      `).join("");
    }

    const drvEl = getEl("car-dynasty-drivers");
    if (drvEl) {
      const recs = Object.values(dyn.driver_records || {}).sort((a, b) => (b.points - a.points) || (b.wins - a.wins));
      drvEl.innerHTML = recs.length
        ? recs.map((r) => `
            <tr>
              <td><b>${esc(r.name)}</b> <small class="muted">${esc(r.code3 || "")}</small></td>
              <td>${r.races}</td>
              <td style="color:#fde047;font-weight:800;">${r.wins}</td>
              <td>${r.podiums}</td>
              <td>${r.poles}</td>
              <td>${r.fl || 0}</td>
              <td><b>${r.points}</b></td>
            </tr>
          `).join("")
        : `<tr><td colspan="7" class="muted">Complete a Grand Prix to start recording your Team Driver Hall of Fame!</td></tr>`;
    }

    const rivEl = getEl("car-dynasty-rivals");
    if (rivEl) {
      rivEl.innerHTML = rivals.length
        ? rivals.map((rv) => `
            <div class="car-rival-card">
              <div class="car-rival-top">
                <span class="car-tchip"><i style="background:${esc(rv.color || "#ef4444")}"></i><strong>${esc(rv.team_name)}</strong></span>
                <span class="car-rival-heat">🔥 HEAT ${rv.heat}/100</span>
              </div>
              <div class="sim-bar-track"><div class="sim-bar-fill" style="width:${Math.min(100, rv.heat)}%;background:linear-gradient(90deg,#f59e0b,#ef4444);"></div></div>
              <small class="muted">${esc(rv.reason || "On-track Constructors battle")} · R${rv.last_round || 1}</small>
            </div>
          `).join("")
        : `<p class="muted">No heated paddock rivalries yet. Answer Post-Race Press Conferences aggressively to ignite rivalries with rival constructors!</p>`;
    }

    const seasEl = getEl("car-dynasty-seasons");
    if (seasEl) {
      const hist = (dyn.garage_seasons && dyn.garage_seasons.length) ? dyn.garage_seasons : (st.champions_history || []);
      seasEl.innerHTML = hist.length
        ? hist.slice().reverse().map((s) => `
            <div class="car-garage-card" style="border-top:3px solid ${esc(s.livery_color || pt.color || "#e10600")}">
              <div class="car-garage-top">
                <strong>S${s.season} (${s.year})</strong>
                <span class="car-ovr-pill">WCC P${s.player_wcc_pos}</span>
              </div>
              <small class="muted">${esc(s.car_era || "2020s")} Spec · OVR ${s.car_overall || pt.car_overall} · ${s.player_pts || 0} pts</small>
              <div class="small" style="margin-top:3px;">🏆 WDC: <b>${esc(s.wdc)}</b> · WCC: <b>${esc(s.wcc)}</b></div>
            </div>
          `).join("")
        : `<p class="muted">Complete Season ${st.season_num} to archive your first Championship Era car &amp; title record here!</p>`;
    }
  }

  // Live Interactive 3D Car Showroom + Live Livery & Era Designer on HQ Dashboard
  const dash3d = { ok: false, renderer: null, scene: null, camera: null, car: null, ringMat: null, lights: null, key: "", theta: 0.92, raf: null, lastW: 0, lastH: 0 };
  function stopDash3DLoop() {
    if (dash3d.raf) {
      cancelAnimationFrame(dash3d.raf);
      dash3d.raf = null;
    }
  }
  function getTeamLiveryCfg(pt) {
    const defEra = (DATA.state && DATA.state.era === "legends") ? "1990s" : "2020s";
    const pal = Object.assign(
      { main: pt.color || "#e10600", secondary: "#111622", accent: "#facc15", pop: "#ffffff", detail: "#252c38" },
      pt.livery_palette || {}
    );
    return {
      palette: pal,
      style: pt.livery_style || "two-tone",
      era: pt.car_era || defEra,
    };
  }
  function syncLiveryInputsFromTeam() {
    if (!DATA.player_team) return;
    const cfg = getTeamLiveryCfg(DATA.player_team);
    if (getEl("liv-main")) getEl("liv-main").value = cfg.palette.main;
    if (getEl("liv-sec")) getEl("liv-sec").value = cfg.palette.secondary;
    if (getEl("liv-acc")) getEl("liv-acc").value = cfg.palette.accent;
    if (getEl("liv-pop")) getEl("liv-pop").value = cfg.palette.pop;
    if (getEl("liv-det")) getEl("liv-det").value = cfg.palette.detail;
    if (getEl("liv-style")) getEl("liv-style").value = cfg.style;
    if (getEl("liv-era")) getEl("liv-era").value = cfg.era;
  }
  let hqCampus3D = null;
  function syncDash3DCar(previewOverride) {
    const cv = getEl("car-dash-3d-canvas");
    if (!cv || !window.THREE || !window.F1Car3D || !DATA.player_team) return;
    const pt = DATA.player_team;
    const cfg = (previewOverride && typeof previewOverride === "object" && previewOverride.palette)
      ? previewOverride
      : getTeamLiveryCfg(pt);
    const pal = cfg.palette, style = cfg.style, era = cfg.era;

    const barsEl = getEl("car-dash-3d-bars");
    if (barsEl && pt.rd) {
      barsEl.innerHTML = [
        ["AERO", pt.rd.aero, "#38bdf8"],
        ["CHAS", pt.rd.chassis, "#a855f7"],
        ["PWR", pt.rd.power, "#ef4444"],
        ["TYRE", pt.rd.tyre_care, "#22c55e"],
      ].map(([lbl, val, col]) => `
        <div class="car-3d-mbar">
          <div>${lbl} <b>${val}</b></div>
          <div class="sim-bar-track"><div class="sim-bar-fill" style="width:${val}%;background:${col}"></div></div>
        </div>
      `).join("");
    }

    // Phase 6: Interactive 3D Team HQ Campus (Garage, Office, Wind Tunnel, Factory!)
    if (window.CareerHQ3D && activeTab === "dashboard" && !cr.active) {
      if (!hqCampus3D) {
        hqCampus3D = window.CareerHQ3D.createHQ3DCampus(cv, getEl("car-3d-spec-tag"));
      }
      if (hqCampus3D) {
        const dyn = (DATA.state && DATA.state.dynasty) || {};
        hqCampus3D.sync({
          palette: pal,
          style,
          era,
          facilities: pt.facilities || {},
          wins: dyn.wins || 0,
          championships: (dyn.garage_seasons || []).filter((s) => s.wcc_pos === 1).length,
          teamName: pt.name || "F1 Team",
        });
        return;
      }
    }
    const specEl = getEl("car-3d-spec-tag");
    if (specEl) specEl.textContent = `${era} Spec · OVR ${pt.car_overall}`;

    const carKey = `${pt.id}|${JSON.stringify(pal)}|${style}|${era}`;
    if (!dash3d.ok) {
      try {
        dash3d.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
        dash3d.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        dash3d.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        dash3d.renderer.toneMappingExposure = 1.22;
        if ("outputColorSpace" in dash3d.renderer && THREE.SRGBColorSpace) dash3d.renderer.outputColorSpace = THREE.SRGBColorSpace;
        dash3d.scene = new THREE.Scene();
        dash3d.scene.environment = F1Car3D.createStudioEnvironment(dash3d.renderer);
        dash3d.lights = F1Car3D.addStudioLights(dash3d.scene, pal.main);
        const plinth = new THREE.Mesh(
          new THREE.CylinderGeometry(3.2, 3.4, 0.14, 48),
          new THREE.MeshStandardMaterial({ color: 0x111722, roughness: 0.45, metalness: 0.35 })
        );
        plinth.position.y = -0.07;
        dash3d.scene.add(plinth);
        dash3d.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(pal.main), transparent: true, opacity: 0.78 });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(3.22, 0.028, 10, 64), dash3d.ringMat);
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002;
        dash3d.scene.add(ring);
        dash3d.scene.add(F1Car3D.createContactShadow());
        dash3d.camera = new THREE.PerspectiveCamera(28, 2.2, 0.1, 60);
        dash3d.ok = true;
      } catch (e) {
        return;
      }
    }
    if (dash3d.key !== carKey) {
      if (dash3d.car) {
        dash3d.scene.remove(dash3d.car);
        if (F1Car3D.disposeObject) F1Car3D.disposeObject(dash3d.car);
      }
      dash3d.car = F1Car3D.createCar(pal, style, era);
      dash3d.scene.add(dash3d.car);
      dash3d.ringMat.color.set(pal.main);
      dash3d.lights.rim.color.set(pal.main);
      dash3d.key = carKey;
    }
    if (!dash3d.raf && activeTab === "dashboard" && !cr.active) {
      const tick3d = () => {
        if (!dash3d.ok || activeTab !== "dashboard" || cr.active) {
          dash3d.raf = null;
          return;
        }
        dash3d.raf = requestAnimationFrame(tick3d);
        const w = cv.clientWidth || 380, h = cv.clientHeight || 182;
        if (w < 20 || h < 20) return;
        if (w !== dash3d.lastW || h !== dash3d.lastH) {
          dash3d.renderer.setSize(w, h, false);
          dash3d.camera.aspect = w / h;
          dash3d.camera.updateProjectionMatrix();
          dash3d.lastW = w;
          dash3d.lastH = h;
        }
        dash3d.theta += 0.0045;
        const rad = 6.2, phi = 0.25, ty = 0.42;
        dash3d.camera.position.set(rad * Math.cos(phi) * Math.sin(dash3d.theta), rad * Math.sin(phi) + ty, rad * Math.cos(phi) * Math.cos(dash3d.theta));
        dash3d.camera.lookAt(0, ty, 0);
        dash3d.renderer.render(dash3d.scene, dash3d.camera);
      };
      dash3d.raf = requestAnimationFrame(tick3d);
    }
  }

  function renderDashboard() {
    const st = DATA.state;
    const pt = DATA.player_team;

    // -2. Board Ultimatum Alert Banner
    const ultEl = getEl("car-ultimatum-banner");
    if (ultEl) {
      const ult = st.board_ultimatum;
      if (ult && ult.races_left > 0) {
        ultEl.classList.remove("hidden");
        ultEl.innerHTML = `
          <div class="car-dil-head">
            <span class="car-dil-tag" style="background:#dc2626;color:#fff;">🚨 BOARD ULTIMATUM</span>
            <strong>Deliver Top ${ult.target_pos} or WCC P${st.board_expect_wcc} within ${ult.races_left} Race(s)!</strong>
          </div>
          <p class="car-dil-body">Board Confidence is critical (${st.board_confidence}%). Meeting the target restores +15% confidence; hitting 0% triggers emergency restructuring.</p>
        `;
      } else {
        ultEl.classList.add("hidden");
        ultEl.innerHTML = "";
      }
    }

    // -1. Mid-Race Resume Banner (crash/refresh-proof per-lap autosave!)
    const resEl = getEl("car-resume-banner");
    if (resEl) {
      const mr = DATA.midrace;
      if (mr && mr.season_num === st.season_num && mr.round_num === st.current_round && !st.season_complete) {
        const cirM = circuitById(mr.circuit_id);
        resEl.classList.remove("hidden");
        resEl.innerHTML = `
          <div>
            <span class="car-dil-tag" style="background:#38bdf8;color:#0f172a;">⚡ LIVE RACE AUTOSAVED</span>
            <strong>Round ${mr.round_num} · ${esc(cirM ? cirM.name : mr.circuit_id)} — Lap ${mr.lap} / ${mr.total_laps}</strong>
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" id="car-resume-race-btn" class="btn-racing"><i class="fas fa-play"></i> Resume Race</button>
            <button type="button" id="car-discard-race-btn" class="btn-util">Discard</button>
          </div>
        `;
      } else {
        resEl.classList.add("hidden");
        resEl.innerHTML = "";
      }
    }

    // 0A. Post-Race Press Conference Media Pen Banner (if unanswered!)
    const medEl = getEl("car-media-banner");
    if (medEl) {
      const pm = st.pending_media;
      if (pm && pm.choices && pm.choices.length) {
        medEl.classList.remove("hidden");
        medEl.innerHTML = `
          <div class="car-dil-head">
            <span class="car-dil-tag" style="background:#38bdf8;color:#0f172a;">🎙 PRESS CONFERENCE</span>
            <strong>${esc(pm.headline)}</strong>
          </div>
          <p class="car-dil-body">${esc(pm.question)}</p>
          <div class="car-dil-choices">
            ${pm.choices.map((ch, idx) => `<button type="button" class="car-dil-btn" data-media-idx="${idx}">${esc(ch.label)}</button>`).join("")}
          </div>
        `;
      } else {
        medEl.classList.add("hidden");
        medEl.innerHTML = "";
      }
    }

    // 0. Interactive Paddock Decision Banner
    const dilEl = getEl("car-dilemma-banner");
    if (dilEl) {
      const dil = st.pending_dilemma;
      if (dil && dil.choices && dil.choices.length) {
        dilEl.classList.remove("hidden");
        dilEl.innerHTML = `
          <div class="car-dil-head">
            <span class="car-dil-tag">⚡ ${esc(dil.tag || "DECISION")}</span>
            <strong>${esc(dil.title)}</strong>
            <small class="muted">Team Principal Decision Required</small>
          </div>
          <p class="car-dil-body">${esc(dil.body)}</p>
          <div class="car-dil-choices">
            ${dil.choices.map((ch, idx) => `<button type="button" class="car-dil-btn" data-dilemma-idx="${idx}">${esc(ch.label)}</button>`).join("")}
          </div>
        `;
      } else {
        dilEl.classList.add("hidden");
        dilEl.innerHTML = "";
      }
    }

    // 1. Lineup Cards (Car #1, Car #2, Reserve) + Driver Development Focus
    const focuses = DATA.dev_focuses || {
      balanced: { label: "Balanced (+1 Pace, +1 Race)" },
      pace: { label: "Quali Pace (+2 Pace)" },
      racecraft: { label: "Racecraft (+2 Race)" },
      wet: { label: "Wet Weather (+2 Wet)" },
      reliability: { label: "Consistency (+2 Rel)" },
    };
    const seats = [
      { label: "CAR #1 · LEAD", id: pt.driver_ids[0] },
      { label: "CAR #2 · RACE", id: pt.driver_ids[1] },
      { label: "RESERVE / ACADEMY", id: pt.reserve_id },
    ];
    getEl("car-dash-lineup").innerHTML = seats.map((seat) => {
      const d = seat.id ? st.drivers[seat.id] : null;
      if (!d) {
        return `<div class="car-seat-card is-empty"><small>${seat.label}</small><p class="muted">Vacant — Sign from Driver Market</p></div>`;
      }
      const curFoc = d.dev_focus || "balanced";
      const focOpts = Object.entries(focuses).map(([k, v]) => `<option value="${esc(k)}" ${k === curFoc ? "selected" : ""}>${esc(v.label)}</option>`).join("");
      return `
        <div class="car-seat-card" style="--team-col:${esc(pt.color)}">
          <div class="car-seat-top">
            <span class="car-seat-tag">${seat.label}</span>
            <span class="car-ovr-pill">OVR ${d.overall} <small>/ ${d.potential}</small></span>
          </div>
          <div class="car-seat-body">
            ${renderPortraitMini(d, pt.color)}
            <div class="car-seat-info">
              <strong>${esc(d.clean_name)}</strong>
              <small>${esc(d.nationality)} · Age ${d.age} · $${d.salary_m}M/yr (${d.contract_years}y${d.contract_years <= 1 ? ' <span style="color:#f87171;font-weight:800;">EXPIRING!</span>' : ""})</small>
              <div class="car-mini-stats">
                <span>PAC <b>${d.stats.pace}</b></span>
                <span>RAC <b>${d.stats.racecraft}</b></span>
                <span>WET <b>${d.stats.wet}</b></span>
                <span>MOR <b>${d.morale}%</b></span>
              </div>
              <div class="car-trait-pill">${esc(d.trait)}</div>
              ${d.contract_years <= 1 ? `<button type="button" class="car-btn-xs car-btn-gold" style="margin-top:4px;width:fit-content;" data-renew-id="${esc(d.id)}"><i class="fas fa-pen-nib"></i> Renew Contract</button>` : ""}
            </div>
          </div>
          <div class="car-focus-row">
            <small>Training</small>
            <select class="car-focus-sel" data-dev-focus="${esc(d.id)}">${focOpts}</select>
          </div>
          <div class="car-xp-row">
            <small>XP ${d.xp}/100</small>
            <div class="sim-bar-track"><div class="sim-bar-fill" style="width:${Math.min(100, d.xp)}%;background:#38bdf8"></div></div>
          </div>
        </div>
      `;
    }).join("");

    // Live 3D Chassis Showroom
    requestAnimationFrame(syncDash3DCar);

    // 2. Next GP Preview + Real GPS Silhouette
    const curRnd = Math.min(st.current_round, st.calendar.length);
    const cal = st.calendar[curRnd - 1];
    const cir = circuitById(cal.circuit_id);
    getEl("car-next-gp-sub").textContent = st.season_complete ? "Season Complete" : `Round ${curRnd} of ${st.calendar.length}`;
    getEl("car-next-gp-card").innerHTML = `
      <div class="car-next-gp-top">
        <div>
          <h3>${esc(cir.name)}</h3>
          <p class="muted">${esc(cir.gp)} · ${esc(cir.country)}</p>
        </div>
        <span class="car-aero-badge">${esc(cir.aero)} AERO</span>
      </div>
      <canvas id="car-dash-gps-mini" class="car-dash-gps-mini"></canvas>
      <div class="car-next-gp-pills">
        <span><b>${cir.length_km}km</b> · ${cir.turns}T</span>
        <span><b>${cir.drs_zones}</b> DRS</span>
        <span>Rain <b>${cir.rain_chance}%</b></span>
        <span>Pit Loss <b>${(cir.pit_loss_s - (pt.facilities.pit_sim - 1) * 0.65).toFixed(1)}s</b></span>
      </div>
    `;
    requestAnimationFrame(() => drawMiniGpsPreview("car-dash-gps-mini", cir));

    // 3. Paddock Inbox
    getEl("car-inbox-list").innerHTML = (st.inbox || []).slice(0, 8).map((item) => `
      <li class="car-inbox-item">
        <div class="car-ib-head"><span class="car-ib-tag tag-${esc(item.tag.toLowerCase())}">${esc(item.tag)}</span><strong>${esc(item.title)}</strong><small>R${item.round}</small></div>
        <p>${esc(item.body)}</p>
      </li>
    `).join("");

    // 4. Sponsors & Board Target
    const hospBonus = Math.round(((pt.facilities.hospitality || 1) - 1) * 12);
    getEl("car-dash-sponsors").innerHTML = `
      <div class="car-board-target">
        <span>Board WCC Expectation: <b>P${st.board_expect_wcc} or better</b></span>
        <span>Hospitality Bonus: <b style="color:#4ade80">+${hospBonus}%</b></span>
      </div>
      ${(st.sponsors || []).map((s) => `
        <div class="car-spon-item">
          <div><b>${esc(s.name)}</b> <small class="muted">(${esc(s.tier)})</small><div class="muted small">${esc(s.goal_text)}</div></div>
          <div class="car-spon-pay"><b>$${s.per_race_m}M</b><small>+$${s.bonus_m}M bonus</small></div>
        </div>
      `).join("")}
    `;
  }

  function renderMarket() {
    const st = DATA.state;
    const pt = DATA.player_team;
    const q = (getEl("car-mkt-search")?.value || "").trim().toLowerCase();
    const filt = getEl("car-mkt-filter")?.value || "all";
    const teamMap = Object.fromEntries(st.teams.map((t) => [t.id, t]));
    const scoutingIds = new Set(st.active_scouts.map((s) => s.driver_id));

    let list = Object.values(st.drivers);
    if (q) {
      list = list.filter((d) => {
        const tname = (teamMap[d.team_id]?.name || "free agent").toLowerCase();
        return d.clean_name.toLowerCase().includes(q) || tname.includes(q) || (d.nationality || "").toLowerCase().includes(q);
      });
    }
    if (filt === "free") list = list.filter((d) => !d.team_id);
    else if (filt === "scouted") list = list.filter((d) => d.scouted);
    else if (filt === "wonderkids") list = list.filter((d) => d.age <= 24);
    else if (filt === "wet") list = list.filter((d) => d.scouted && d.stats.wet >= 78);

    list.sort((a, b) => {
      const aOwn = a.team_id === pt.id ? 1 : 0;
      const bOwn = b.team_id === pt.id ? 1 : 0;
      if (aOwn !== bOwn) return bOwn - aOwn;
      return b.overall - a.overall;
    });

    getEl("car-market-tbody").innerHTML = list.slice(0, 60).map((d) => {
      const tm = d.team_id ? teamMap[d.team_id] : null;
      const isOwnRace = d.team_id === pt.id && d.role === "race";
      const isScouting = scoutingIds.has(d.id);
      const teamBadge = tm
        ? `<span class="car-tchip"><i style="background:${esc(tm.color)}"></i>${esc(tm.name)}${d.role === "reserve" ? " (RES)" : ""}</span>`
        : `<span class="car-fa-chip">FREE AGENT</span>`;

      const ovrCell = d.scouted
        ? `<b>${d.overall}</b> <span class="car-pot-hi">↗ ${d.potential}</span>`
        : `<span class="car-fog">${d.scout_est.ovr_lo}–${d.scout_est.ovr_hi}</span> <small class="muted">POT ?</small>`;

      const statsCell = d.scouted
        ? `<b>${d.stats.pace}</b> / <b>${d.stats.racecraft}</b> / <b style="color:#38bdf8">${d.stats.wet}</b>`
        : `<span class="car-fog">${d.scout_est.pace_lo}–${d.scout_est.pace_hi} / ${d.scout_est.race_lo}–${d.scout_est.race_hi} / ?</span>`;

      const moneyCell = d.scouted
        ? `$${d.salary_m}M/yr${d.buyout_m > 0 && d.team_id !== pt.id ? ` <small class="muted">(+$${d.buyout_m}M)</small>` : ""}`
        : `<span class="car-fog">~$${Math.max(1, Math.round(d.salary_m * 0.8))}–${Math.round(d.salary_m * 1.2)}M</span>`;

      let actions = "";
      if (isOwnRace) {
        actions = `<span class="car-signed-tag">YOUR DRIVER</span>`;
      } else {
        const cmpBtn = d.scouted ? `<button type="button" class="car-btn-xs" data-compare-id="${esc(d.id)}" title="Compare side-by-side against your current drivers">⚖ Compare</button>` : "";
        const scBtn = d.scouted
          ? ""
          : (isScouting
              ? `<span class="car-scouting-tag">Scouting…</span>`
              : `<button type="button" class="car-btn-xs" data-scout-id="${esc(d.id)}">Scout</button>
                 <button type="button" class="car-btn-xs car-btn-gold" data-express-id="${esc(d.id)}" title="Instant full dossier ($1.5M)">⚡ $1.5M</button>`);
        actions = `${cmpBtn}${scBtn} <button type="button" class="car-btn-xs car-btn-red" data-offer-id="${esc(d.id)}">Offer</button>`;
      }

      return `
        <tr class="${d.team_id === pt.id ? "is-player-row" : ""}">
          <td><div class="car-mkt-drv">${renderPortraitMini(d, tm ? tm.color : d.hero_color)}<div><b>${esc(d.clean_name)}</b><small>${esc(d.nationality)}${d.championships ? ` · ★${d.championships}× WDC` : ""}</small></div></div></td>
          <td>${teamBadge}</td>
          <td>${d.age}</td>
          <td>${ovrCell}</td>
          <td>${statsCell}</td>
          <td>${moneyCell}</td>
          <td class="car-act-cell">${actions}</td>
        </tr>
      `;
    }).join("");
  }

  function renderScouting() {
    const st = DATA.state;
    const pt = DATA.player_team;
    getEl("car-scout-slots-label").textContent = `${st.active_scouts.length} / ${DATA.scout_slots} Slots Used`;

    const actEl = getEl("car-active-scouts-list");
    if (!st.active_scouts.length) {
      actEl.innerHTML = `<p class="muted">No scouts currently deployed. Go to <b>Drivers &amp; Market</b> and assign scouts to uncover hidden Potential, Wet Pace &amp; Traits!</p>`;
    } else {
      actEl.innerHTML = st.active_scouts.map((s) => `
        <div class="car-prog-card">
          <div><strong>${esc(s.driver_name)}</strong><small class="muted">Telemetry &amp; Contract Dossier in progress</small></div>
          <span class="car-rnd-pill">${s.rounds_left} Race(s) Left</span>
        </div>
      `).join("");
    }

    const scouted = Object.values(st.drivers)
      .filter((d) => d.scouted && d.team_id !== pt.id)
      .sort((a, b) => b.potential - a.potential);
    const dosEl = getEl("car-scouted-list");
    if (!scouted.length) {
      dosEl.innerHTML = `<p class="muted">No external drivers scouted yet. Use <b>Scout</b> or <b>⚡ $1.5M Express</b> in the Driver Market.</p>`;
    } else {
      dosEl.innerHTML = scouted.map((d) => `
        <div class="car-dossier-card">
          <div class="car-dos-head">
            ${renderPortraitMini(d, d.hero_color)}
            <div><strong>${esc(d.clean_name)}</strong><small>Age ${d.age} · OVR <b>${d.overall}</b> · POT <b style="color:#4ade80">${d.potential}</b></small></div>
          </div>
          <div class="car-mini-stats">
            <span>PAC <b>${d.stats.pace}</b></span>
            <span>RAC <b>${d.stats.racecraft}</b></span>
            <span>REL <b>${d.stats.reliability}</b></span>
            <span>WET <b style="color:#38bdf8">${d.stats.wet}</b></span>
          </div>
          <div class="car-trait-pill">${esc(d.trait)}</div>
          <div class="car-dos-foot">
            <small>Demand: <b>$${d.salary_m}M/yr</b>${d.buyout_m > 0 ? ` (+$${d.buyout_m}M buyout)` : ""}</small>
            <div style="display:flex;gap:4px;">
              <button type="button" class="car-btn-xs" data-compare-id="${esc(d.id)}" title="Compare side-by-side against your current drivers">⚖ Compare</button>
              <button type="button" class="car-btn-xs car-btn-red" data-offer-id="${esc(d.id)}">Negotiate</button>
            </div>
          </div>
        </div>
      `).join("");
    }
  }

  function renderStaff() {
    const st = DATA.state;
    const roles = DATA.staff_roles || [];
    const activeEl = getEl("car-staff-active");
    if (activeEl) {
      activeEl.innerHTML = roles.map((r) => {
        const s = (st.staff || {})[r.id];
        if (!s) return "";
        return `
          <div class="car-staff-card">
            <span class="car-staff-role"><i class="fas ${esc(r.icon)}"></i> ${esc(r.name)}</span>
            <div class="car-staff-top">
              <strong>${esc(s.name)} <small class="muted">(${esc(s.nat)})</small></strong>
              <span class="car-staff-ovr">OVR ${s.rating}</span>
            </div>
            <div class="car-trait-pill">${esc(s.trait || r.bonus_desc)}</div>
            <small class="muted">${esc(r.bonus_desc)} · $${s.salary_m}M/yr</small>
          </div>
        `;
      }).join("");
    }
    const mktEl = getEl("car-staff-market");
    if (mktEl) {
      const roleMap = Object.fromEntries(roles.map((r) => [r.id, r.name]));
      const list = (st.staff_market || []).slice().sort((a, b) => b.rating - a.rating);
      mktEl.innerHTML = list.map((c) => `
        <div class="car-staff-mkt-row">
          <div>
            <span class="car-staff-role">${esc(roleMap[c.role] || c.role)}</span>
            <div><b>${esc(c.name)}</b> <small class="muted">(${esc(c.nat)})</small> · <b style="color:#fde047">OVR ${c.rating}</b></div>
            <small style="color:#38bdf8">${esc(c.trait)}</small>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div class="muted small">$${c.salary_m}M/yr</div>
            <button type="button" class="car-btn-xs car-btn-gold" data-hire-staff="${esc(c.id)}">Hire · $${c.hire_m}M</button>
          </div>
        </div>
      `).join("");
    }
  }

  function updateAtrPreview() {
    if (!DATA || !DATA.state) return;
    const st = DATA.state;
    const pt = DATA.player_team || {};
    const wtEl = getEl("car-atr-wt-slider");
    const cfdEl = getEl("car-atr-cfd-slider");
    const wt = Number(wtEl ? wtEl.value : 0);
    const cfd = Number(cfdEl ? cfdEl.value : 0);
    if (getEl("car-atr-wt-val")) getEl("car-atr-wt-val").textContent = `${wt.toFixed(1)}h`;
    if (getEl("car-atr-cfd-val")) getEl("car-atr-cfd-val").textContent = String(cfd);
    const wtLvl = (pt.facilities && pt.facilities.wind_tunnel) || 1;
    const haRat = Number((((st.staff || {}).head_aero || {}).rating) || 74);
    const atrFrac = Math.min(1.25, (wt / 12.0) * 0.55 + (cfd / 600.0) * 0.45);
    const mult = (1.0 + atrFrac * 0.32).toFixed(2);
    const corr = Math.min(98, Math.max(48, Math.round(68 + wtLvl * 4 + (haRat - 70) * 0.45 + atrFrac * 18)));
    const estEl = getEl("car-atr-est-lbl");
    if (estEl) {
      const col = corr >= 88 ? "#4ade80" : (corr >= 76 ? "#38bdf8" : "#f59e0b");
      estEl.style.color = col;
      estEl.textContent = `Est. Correlation: ${corr}%${corr >= 88 ? " (Breakthrough!)" : ""} · Gain ×${mult}`;
    }
  }

  function renderRd() {
    const st = DATA.state;
    const pt = DATA.player_team;
    const atr = st.atr || { period: 1, wcc_rank: 5, atr_pct: 90, wt_hrs_max: 28.8, wt_hrs_rem: 28.8, cfd_max: 1440, cfd_rem: 1440, next_reset_round: 5 };
    const capLim = Number(st.cost_cap_m || 135.0);
    const capSpent = Number(st.cost_cap_spent_m || 0.0);
    const capPct = Math.min(100, Math.round((capSpent / Math.max(1, capLim)) * 100));
    const capCol = capPct >= 95 ? "#ef4444" : (capPct >= 80 ? "#f59e0b" : "#22c55e");

    // 1. FIA ATR Sliding Scale & Cost Cap Telemetry Strip
    const stripEl = getEl("car-rd-atr-strip");
    if (stripEl) {
      const wtPct = Math.min(100, Math.round((atr.wt_hrs_rem / Math.max(1, atr.wt_hrs_max)) * 100));
      const cfdPct = Math.min(100, Math.round((atr.cfd_rem / Math.max(1, atr.cfd_max)) * 100));
      stripEl.innerHTML = `
        <div class="car-atr-card">
          <div class="car-atr-top">
            <span><i class="fas fa-wind"></i> <b>FIA ATR PERIOD ${atr.period}</b> · P${atr.wcc_rank} WCC (${atr.atr_pct}% Scale)</span>
            <small class="muted">Resets R${atr.next_reset_round}</small>
          </div>
          <div class="car-atr-meters">
            <div>
              <small>Wind Tunnel: <b>${Number(atr.wt_hrs_rem).toFixed(1)} / ${Number(atr.wt_hrs_max).toFixed(1)}h</b></small>
              <div class="sim-bar-track"><div class="sim-bar-fill" style="width:${wtPct}%;background:#38bdf8"></div></div>
            </div>
            <div>
              <small>CFD Items: <b>${atr.cfd_rem} / ${atr.cfd_max}</b></small>
              <div class="sim-bar-track"><div class="sim-bar-fill" style="width:${cfdPct}%;background:#a855f7"></div></div>
            </div>
          </div>
        </div>
        <div class="car-atr-card">
          <div class="car-atr-top">
            <span><i class="fas fa-balance-scale"></i> <b>FIA COST CAP</b> (${capPct}% Used)</span>
            <small style="color:${capCol};font-weight:800;">$${Math.max(0, capLim - capSpent).toFixed(1)}M Left</small>
          </div>
          <div style="margin-top:6px;">
            <small>Cap Spend: <b>$${capSpent.toFixed(1)}M / $${capLim.toFixed(1)}M</b> · Rating: <b>AERO ${pt.rd.aero} · CHS ${pt.rd.chassis} · PWR ${pt.rd.power} · TYR ${pt.rd.tyre_care}</b></small>
            <div class="sim-bar-track" style="margin-top:4px;"><div class="sim-bar-fill" style="width:${capPct}%;background:${capCol}"></div></div>
          </div>
        </div>
      `;
    }

    // Clamp ATR allocation sliders to available remaining ATR hours/CFD
    const wtSlider = getEl("car-atr-wt-slider");
    const cfdSlider = getEl("car-atr-cfd-slider");
    if (wtSlider) {
      wtSlider.max = String(Math.max(0, Number(atr.wt_hrs_rem || 0)));
      if (Number(wtSlider.value) > Number(wtSlider.max)) wtSlider.value = wtSlider.max;
    }
    if (cfdSlider) {
      cfdSlider.max = String(Math.max(0, Number(atr.cfd_rem || 0)));
      if (Number(cfdSlider.value) > Number(cfdSlider.max)) cfdSlider.value = cfdSlider.max;
    }
    updateAtrPreview();

    getEl("car-rd-slots-label").textContent = `${st.active_rd.length} / ${DATA.max_rd_slots} Active Packages`;

    const actEl = getEl("car-rd-active-list");
    actEl.innerHTML = st.active_rd.length
      ? st.active_rd.map((p) => `
          <div class="car-prog-card is-rd">
            <div>
              <strong>${esc(p.label)} (${esc(p.mode.toUpperCase())})</strong>
              <small style="color:#4ade80">Est. +${p.gain} · Corr. ${p.correlation_pct || 82}% · ATR ${p.wt_hrs || 0}h / ${p.cfd_items || 0} CFD</small>
            </div>
            <span class="car-rnd-pill">${p.rounds_left} Race(s)</span>
          </div>
        `).join("")
      : `<div class="car-empty-note">Wind tunnel idle — allocate ATR hours above and commission a car component below!</div>`;

    // 2. Authentic 6-Component F1 Car Blueprints + Spare Parts Warehouse!
    const blueprints = (DATA.car_blueprints && DATA.car_blueprints.length) ? DATA.car_blueprints : (DATA.rd_parts || []);
    const invMap = st.parts_inventory || {};
    getEl("car-rd-parts-grid").innerHTML = blueprints.map((bp) => {
      const pKey = bp.primary || bp.id;
      const val = pt.rd[pKey] || 70;
      const busy = st.active_rd.some((x) => (x.component_id || x.part) === bp.id);
      const inv = invMap[bp.id] || { spec: 1, spares: 2, last_corr: "Nominal" };
      const cNorm = Number(bp.base_cost || 4.2).toFixed(1);
      const cInt = (Number(bp.base_cost || 4.2) * 1.65).toFixed(1);
      const cRush = (Number(bp.base_cost || 4.2) * 2.10).toFixed(1);
      const cSpare = Number(bp.spare_cost || 1.1).toFixed(1);
      const lowSp = (inv.spares || 0) <= 1;
      const tags = bp.secondary ? `${pKey.toUpperCase()} + ${bp.secondary.replace("_", " ").toUpperCase()}` : pKey.toUpperCase();
      return `
        <div class="car-rd-card">
          <div class="car-rd-head">
            <span><i class="fas ${esc(bp.icon)}"></i> <b>${esc(bp.name)}</b></span>
            <span class="car-spec-pill">SPEC ${inv.spec || 1}</span>
          </div>
          <div class="car-rd-submeta">
            <span class="muted">${tags} (${val})</span>
            <span style="color:${lowSp ? "#ef4444" : "#94a3b8"};font-weight:700;">${lowSp ? "⚠ " : ""}${inv.spares ?? 2} Spares</span>
          </div>
          <p class="muted small">${esc(bp.desc)}</p>
          <div class="sim-bar-track"><div class="sim-bar-fill" style="width:${val}%;background:#38bdf8"></div></div>
          <div class="car-rd-btns">
            <button type="button" class="car-btn-xs" data-rd-part="${esc(bp.id)}" data-rd-mode="normal" ${busy ? "disabled" : ""}>Normal · $${cNorm}M (2R)</button>
            <button type="button" class="car-btn-xs car-btn-gold" data-rd-part="${esc(bp.id)}" data-rd-mode="intense" ${busy ? "disabled" : ""}>Intense · $${cInt}M (2R)</button>
            <button type="button" class="car-btn-xs car-btn-red" data-rd-part="${esc(bp.id)}" data-rd-mode="rush" ${busy ? "disabled" : ""}>Rush · $${cRush}M (1R)</button>
            ${bp.spare_cost ? `<button type="button" class="car-btn-xs" style="border-color:rgba(56,189,248,.45);color:#7dd3fc;" data-mfg-comp="${esc(bp.id)}" ${(inv.spares || 0) >= 6 ? "disabled" : ""}>+1 Spare · $${cSpare}M</button>` : ""}
          </div>
        </div>
      `;
    }).join("");

    // Wind-Tunnel Track Correlation History Log
    const histEl = getEl("car-rd-history");
    if (histEl) {
      const hist = st.rd_history || [];
      histEl.innerHTML = hist.length
        ? hist.slice(0, 5).map((h) => {
            const col = h.outcome === "BREAKTHROUGH" ? "#4ade80" : (h.outcome === "MISMATCH" ? "#f59e0b" : "#38bdf8");
            return `<div class="car-prog-card"><div><strong>R${h.round} · ${esc(h.label)}</strong><small style="color:${col}">${esc(h.outcome)} (+${h.actual_gain} vs +${h.est_gain} est.)</small></div></div>`;
          }).join("")
        : `<div class="car-empty-note">No packages fitted yet — track correlation results will appear after your first upgrade arrives.</div>`;
    }

    // Next-Season Regulation Spec Research
    const ngEl = getEl("car-nextgen-grid");
    if (ngEl) {
      const ng = st.next_gen_research || { aero: 0, chassis: 0, power: 0, tyre_care: 0 };
      ngEl.innerHTML = (DATA.rd_parts || []).map((part) => {
        const val = Number(ng[part.id] || 0);
        const pct = Math.min(100, (val / 12.0) * 100);
        return `
          <div class="car-ng-card">
            <div class="car-ng-top">
              <b>${esc(part.name)}</b>
              <span style="color:#4ade80;font-weight:800;">+${val.toFixed(1)} S${st.season_num + 1}</span>
            </div>
            <div class="sim-bar-track"><div class="sim-bar-fill" style="width:${pct}%;background:#a855f7"></div></div>
            <button type="button" class="car-btn-xs car-btn-gold" data-nextgen-part="${esc(part.id)}" ${val >= 12 ? "disabled" : ""}>Research Next Spec · $3.8M</button>
          </div>
        `;
      }).join("");
    }

    // Constructor Grid Ranking Bars
    const sortedTeams = st.teams.slice().sort((a, b) => b.car_overall - a.car_overall);
    getEl("car-rd-comparison").innerHTML = sortedTeams.map((t, idx) => `
      <div class="car-comp-row ${t.is_player ? "is-me" : ""}">
        <span class="car-comp-rank">#${idx + 1}</span>
        <span class="car-comp-name"><i style="background:${esc(t.color)}"></i>${esc(t.name)}</span>
        <div class="sim-bar-track"><div class="sim-bar-fill" style="width:${t.car_overall}%;background:${esc(t.color)}"></div></div>
        <strong class="car-comp-num">${t.car_overall}</strong>
      </div>
    `).join("");

    // FIA Power Unit & Gearbox Component Pool (ICE / ERS / GBX)
    const puEl = getEl("car-pu-pool");
    if (puEl) {
      const pool = st.pu_pool || [
        { car: 1, ice: 100, ers: 100, gearbox: 100, ice_used: 1, ers_used: 1, gearbox_used: 1, grid_penalty: 0 },
        { car: 2, ice: 100, ers: 100, gearbox: 100, ice_used: 1, ers_used: 1, gearbox_used: 1, grid_penalty: 0 },
      ];
      const allocs = { ice: 4, ers: 3, gearbox: 4 };
      puEl.innerHTML = pool.map((pu, idx) => {
        const d = pt.driver_ids[idx] ? st.drivers[pt.driver_ids[idx]] : null;
        const penBadge = pu.grid_penalty > 0 ? `<span class="sim-pen-pill">+${pu.grid_penalty} GRID</span>` : "";
        return `
          <div class="car-pu-card">
            <div class="car-pu-head"><b>CAR #${pu.car} · ${esc(d ? d.code3 : "DRV")}</b>${penBadge}</div>
            ${["ice", "ers", "gearbox"].map((comp) => {
              const hp = Math.round(pu[comp] || 100);
              const used = pu[`${comp}_used`] || 1;
              const col = hp < 40 ? "#ef4444" : (hp < 65 ? "#f59e0b" : "#22c55e");
              const willPen = used >= allocs[comp];
              return `
                <div class="car-pu-row">
                  <span class="car-pu-lbl">${comp.toUpperCase()} <small>${used}/${allocs[comp]}</small></span>
                  <div class="sim-bar-track"><div class="sim-bar-fill" style="width:${hp}%;background:${col}"></div></div>
                  <b class="car-pu-hp">${hp}%</b>
                  <button type="button" class="car-btn-xs ${willPen ? "car-btn-red" : ""}" data-pu-car="${pu.car}" data-pu-comp="${comp}" title="${willPen ? "Over FIA allocation: +5 Grid Penalty & $1.2M" : "Free FIA allocation swap"}">${willPen ? "+5P Swap" : "Swap"}</button>
                </div>
              `;
            }).join("")}
          </div>
        `;
      }).join("");
    }
  }

  function renderFacilities() {
    const facs = DATA.facilities_view || [];
    getEl("car-fac-grid").innerHTML = facs.map((f) => {
      const pips = Array.from({ length: 5 }, (_, i) => `<i class="${i < f.level ? "on" : ""}"></i>`).join("");
      let bonusText = "";
      if (f.id === "scouting_hub") bonusText = `${DATA.scout_slots} Scout Slot(s) · ${f.level >= 2 ? "1-Race Reports" : "2-Race Reports"}`;
      else if (f.id === "powertrain_lab") bonusText = `-${(f.level - 1) * 8}% DNF Risk · +${(f.level - 1) * 10}% ERS Charge`;
      else if (f.id === "pit_sim") bonusText = `-${((f.level - 1) * 0.65).toFixed(2)}s Pit Loss · +${(f.level - 1) * 18}% Driver XP`;
      else bonusText = f.bonus_label.replace("{v}", String(Math.round((f.level - 1) * f.bonus_per_lvl)));

      return `
        <div class="car-fac-card">
          <div class="car-fac-head">
            <span><i class="fas ${esc(f.icon)}"></i> <b>${esc(f.name)}</b></span>
            <span class="car-fac-lvl">LVL ${f.level}/5</span>
          </div>
          <div class="car-fac-pips">${pips}</div>
          <p class="muted small">${esc(f.desc)}</p>
          <div class="car-fac-bonus">Active: <b>${esc(bonusText || "Base Level")}</b> · Upkeep $${f.upkeep_m}M/GP</div>
          ${f.next_cost_m != null
            ? `<button type="button" class="btn-ers" data-fac-upgrade="${esc(f.id)}"><i class="fas fa-arrow-up"></i> Upgrade to Lvl ${f.level + 1} — $${f.next_cost_m}M</button>`
            : `<button type="button" class="btn-ers" disabled>MAX LEVEL REACHED</button>`}
        </div>
      `;
    }).join("");
  }

  function renderStandingsAndFinance() {
    const st = DATA.state;
    getEl("car-wdc-tbody").innerHTML = (DATA.wdc || []).map((r) => `
      <tr class="${r.is_player ? "is-player-row" : ""}">
        <td class="st-pos ${r.pos <= 3 ? "p" + r.pos : ""}">${r.pos}</td>
        <td><span class="car-tchip"><i style="background:${esc(r.color)}"></i><b>${esc(r.code3)}</b> ${esc(r.clean_name)}</span></td>
        <td class="muted small">${esc(r.team_name)}</td>
        <td>${r.wins}</td>
        <td>${r.fl}</td>
        <td><b>${r.points}</b></td>
      </tr>
    `).join("");

    getEl("car-wcc-tbody").innerHTML = (DATA.wcc || []).map((t) => `
      <tr class="${t.is_player ? "is-player-row" : ""}">
        <td class="st-pos ${t.pos <= 3 ? "p" + t.pos : ""}">${t.pos}</td>
        <td><span class="car-tchip"><i style="background:${esc(t.color)}"></i><b>${esc(t.name)}</b></span></td>
        <td>${t.car_overall}</td>
        <td>${t.wins}</td>
        <td><b>${t.points}</b></td>
      </tr>
    `).join("");

    const activeSponIds = new Set((st.sponsors || []).map((s) => s.id));
    getEl("car-sponsor-catalog").innerHTML = (DATA.sponsor_catalog || []).map((s) => {
      const on = activeSponIds.has(s.id);
      return `
        <div class="car-spon-card ${on ? "is-active" : ""}">
          <div><b>${esc(s.name)}</b> <small>(${esc(s.tier)})</small><div class="muted small">${esc(s.goal_text)}</div></div>
          <div class="car-spon-right">
            <span>$${s.per_race_m}M + $${s.bonus_m}M</span>
            ${on ? `<span class="car-signed-tag">ACTIVE</span>` : `<button type="button" class="car-btn-xs car-btn-gold" data-sign-spon="${esc(s.id)}">Sign</button>`}
          </div>
        </div>
      `;
    }).join("");

    const repSet = new Set((DATA.report_rounds || []).map((r) => `${r.season_num}:${r.round_num}`));
    getEl("car-calendar-list").innerHTML = st.calendar.map((c) => {
      const isNext = !st.season_complete && c.round === st.current_round;
      const tags = `${c.is_sprint ? '<span class="car-sprint-tag">⚡SPRINT</span>' : ""}${c.is_night ? " 🌙" : ""}`;
      const hasRep = c.completed && repSet.has(`${st.season_num}:${c.round}`);
      const repBtn = hasRep ? `<button type="button" class="car-btn-xs" data-report-season="${st.season_num}" data-report-round="${c.round}" title="View full Grand Prix Race Report">📊 Report</button>` : "";
      return `
        <div class="car-cal-row ${c.completed ? "is-done" : ""} ${isNext ? "is-next" : ""}">
          <span class="car-cal-rnd">R${String(c.round).padStart(2, "0")}</span>
          <b>${esc(c.name)} ${tags}</b>
          <span class="car-cal-res">${c.completed ? `🏆 ${esc(c.winner)} ${repBtn}` : (isNext ? "NEXT GP" : `${c.aero} · ${c.rain_chance}%☂`)}</span>
        </div>
      `;
    }).join("");

    getEl("car-finance-log").innerHTML = (st.finance_log || []).slice(0, 12).map((f) => `
      <li class="car-fin-row">
        <span><small class="muted">R${f.round}</small> ${esc(f.label)}</span>
        <b class="${f.delta_m >= 0 ? "fin-pos" : "fin-neg"}">${f.delta_m >= 0 ? "+" : ""}$${f.delta_m.toFixed(1)}M</b>
      </li>
    `).join("");

    requestAnimationFrame(drawWccChart);
  }

  function drawWccChart() {
    const cv = getEl("car-wcc-chart");
    if (!cv || !DATA.state) return;
    const hist = DATA.state.wcc_history || [];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 340, h = cv.clientHeight || 150;
    if (w < 30 || h < 30) return;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!hist.length) {
      ctx.fillStyle = "#64748b";
      ctx.font = "600 11px 'Source Sans 3', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Complete Round 1 to track Championship Points Trajectory", w / 2, h / 2 + 4);
      return;
    }

    const topTeams = (DATA.wcc || []).slice(0, 5);
    const playerRow = (DATA.wcc || []).find((t) => t.is_player);
    if (playerRow && !topTeams.some((t) => t.id === playerRow.id)) topTeams.push(playerRow);

    const maxPts = Math.max(25, ...hist.flatMap((hRow) => topTeams.map((t) => Number((hRow.points || {})[t.id] || 0))));
    const padL = 28, padR = 12, padT = 14, padB = 20;
    const plotW = w - padL - padR, plotH = h - padT - padB;

    // Gridlines
    ctx.strokeStyle = "rgba(148, 163, 184, 0.14)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = padT + (plotH * i) / 3;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    }

    topTeams.forEach((t) => {
      ctx.beginPath();
      ctx.strokeStyle = t.color || "#38bdf8";
      ctx.lineWidth = t.is_player ? 2.8 : 1.5;
      hist.forEach((hRow, idx) => {
        const x = padL + (hist.length === 1 ? plotW : (idx / (hist.length - 1)) * plotW);
        const pts = Number((hRow.points || {})[t.id] || 0);
        const y = padT + plotH - (pts / maxPts) * plotH;
        if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    ctx.fillStyle = "#94a3b8";
    ctx.font = "700 9px Orbitron, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`R1`, padL, h - 5);
    ctx.textAlign = "right";
    ctx.fillText(`R${hist[hist.length - 1].round} · ${maxPts}pts`, w - padR, h - 5);
  }

  // =========================================================================
  // CONTRACT NEGOTIATION MODAL
  // =========================================================================
  function openOfferModal(driverId) {
    const st = DATA.state;
    const d = st.drivers[driverId];
    if (!d) return;
    offerDriverId = driverId;
    const pt = DATA.player_team;
    const buyout = d.team_id && d.team_id !== pt.id ? d.buyout_m : 0;

    getEl("car-offer-header").innerHTML = `
      <div class="car-mkt-drv">
        ${renderPortraitMini(d, d.hero_color)}
        <div>
          <strong>${esc(d.clean_name)}</strong>
          <small>${d.scouted ? `OVR ${d.overall} · POT ${d.potential} · Demand ~$${d.salary_m}M/yr` : `Unscouted (Est. OVR ${d.scout_est.ovr_lo}–${d.scout_est.ovr_hi})`} ${buyout > 0 ? `· Buyout $${buyout}M` : "· Free Agent"}</small>
        </div>
      </div>
    `;
    getEl("offer-salary").value = String(d.salary_m);
    getEl("offer-bonus").value = "1.0";
    getEl("offer-seat").value = "seat2";
    getEl("offer-years").value = "2";
    updateOfferPreview();
    getEl("car-offer-modal").classList.remove("hidden");
  }

  function updateOfferPreview() {
    if (!offerDriverId || !DATA.state) return;
    const d = DATA.state.drivers[offerDriverId];
    const pt = DATA.player_team;
    const seat = getEl("offer-seat").value;
    const sal = parseFloat(getEl("offer-salary").value) || 0;
    const bonus = parseFloat(getEl("offer-bonus").value) || 0;
    const yrs = parseInt(getEl("offer-years").value, 10) || 2;
    const buyout = d.team_id && d.team_id !== pt.id ? d.buyout_m : 0;
    const ask = seat === "reserve" ? Math.max(0.5, d.salary_m * 0.45) : d.salary_m;
    const hosp = pt.facilities.hospitality || 1;
    const ratio = ((sal + (bonus / yrs) * 0.75) / Math.max(0.4, ask)) + (pt.car_overall - 72) * 0.012 + (hosp - 1) * 0.04;
    const mood = ratio >= 1.02 ? ["HIGH — Likely to Accept", "#4ade80"] : (ratio >= 0.94 ? ["FAIR — Borderline Deal", "#fde047"] : ["LOW — Likely Rejected", "#f87171"]);
    getEl("car-offer-preview").innerHTML = `
      <div>Upfront Cost: <b>$${(buyout + bonus).toFixed(1)}M</b> (Buyout $${buyout}M + Bonus $${bonus.toFixed(1)}M) · Budget: <b>$${DATA.state.cash_m.toFixed(1)}M</b></div>
      <div style="color:${mood[1]};font-weight:800;margin-top:4px;">Driver Interest: ${mood[0]}</div>
    `;
  }

  // =========================================================================
  // LIVE FULL-GRID 2-CAR RACE WEEKEND (QUALIFYING + 12-LAYER F1-WORLD GPS PIT WALL!)
  // =========================================================================
  const cr = {
    active: false,
    quali: null,
    circuit: null,
    geom: null,
    staticCanvas: null,
    staticKey: "",
    layers: { corners: true, sectors: true, ghost: false, hud: true, line: true, ai: true },
    gapMode: "int",
    running: false,
    paused: false,
    finished: false,
    chequeredFlag: false,
    chequeredStartS: 0,
    allUnlappedDoneAt: null,
    chequeredFinishedCount: 0,
    chequeredRunningCount: 0,
    speedMult: 1,
    totalLaps: 15,
    weatherMode: "dynamic",
    wetness: 0,
    targetWetness: 0,
    drying: false,
    rainTimer: 10,
    gripPct: 38,
    drsEnabled: false,
    drsAnnounced: false,
    vscLaps: 0,
    safetyCarLaps: 0,
    yellowSector: 0,
    yellowTimer: 0,
    bestSectors: [999, 999, 999],
    raceClock: 0,
    fastestLap: { time: 999, driverId: null, name: "" },
    cars: [],
    playerCarIndices: [0, 1],
    focusSlot: 0,
    teamOrder: "free",
    setupConf: 70,
    duelEnabled: true,
    duelUsed: false,
    redFlagUsed: false,
    scCount: 0,
    vscCount: 0,
    redFlagCount: 0,
    hadWet: false,
    radioActionTimer: null,
    inspectedDriverId: null,
    lapHistory: [],
    targetPitPlan: null,   // { lap, nextComp, label }
    boxHover: false,
    lastTs: 0,
    lastUiSync: 0,
    rafId: null,
  };

  let renewDriverId = null;

  function renderSavesModal() {
    const slots = DATA.slots || [];
    const ckpts = DATA.checkpoints || [];
    const slEl = getEl("car-slots-list");
    if (slEl) {
      slEl.innerHTML = slots.length ? slots.map((s) => `
        <div class="car-slot-card ${s.is_active ? "is-active" : ""}">
          <div class="car-slot-head">
            <span class="car-tchip"><i style="background:${esc(s.team_color)}"></i><b>${esc(s.slot_name)}</b></span>
            ${s.is_active ? `<span class="car-signed-tag">ACTIVE</span>` : ""}
          </div>
          <div class="muted small">${esc(s.team_name)} · S${s.season_num} (${s.season_year}) · R${s.current_round}/${s.total_rounds} · WCC P${s.wcc_pos} · $${Number(s.cash_m).toFixed(1)}M · OVR ${s.car_overall}</div>
          <div class="car-slot-acts">
            ${s.is_active ? "" : `<button type="button" class="car-btn-xs car-btn-gold" data-slot-switch="${esc(s.slot_id)}">Load</button>`}
            <button type="button" class="car-btn-xs" data-slot-rename="${esc(s.slot_id)}" data-slot-cur="${esc(s.slot_name)}">Rename</button>
            <button type="button" class="car-btn-xs" data-slot-dup="${esc(s.slot_id)}">Duplicate</button>
            ${slots.length > 1 ? `<button type="button" class="car-btn-xs car-btn-red" data-slot-del="${esc(s.slot_id)}">Delete</button>` : ""}
          </div>
        </div>
      `).join("") : `<p class="muted">No saved careers yet.</p>`;
    }
    const ckEl = getEl("car-ckpt-list");
    if (ckEl) {
      ckEl.innerHTML = ckpts.length ? ckpts.map((c) => {
        const dt = new Date((c.created_at || 0) * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        return `
          <div class="car-slot-card">
            <div class="car-slot-head">
              <b>${esc(c.label)}</b>
              <small class="muted">${esc(dt)}</small>
            </div>
            <div class="car-slot-acts">
              <button type="button" class="car-btn-xs car-btn-gold" data-ckpt-restore="${c.checkpoint_id}"><i class="fas fa-undo"></i> Rollback Here</button>
            </div>
          </div>
        `;
      }).join("") : `<p class="muted">Checkpoints are created automatically before Qualifying &amp; after each GP.</p>`;
    }
  }

  async function openSavesModal() {
    try {
      const r = await fetch("/api/career/slots");
      if (r.ok) {
        const d = await r.json();
        DATA.slots = d.slots; DATA.checkpoints = d.checkpoints; DATA.midrace = d.midrace;
      }
    } catch (e) {}
    renderSavesModal();
    getEl("car-saves-modal")?.classList.remove("hidden");
  }

  async function openRaceReport(seasonNum, roundNum) {
    try {
      const r = await fetch(`/api/career/race/report/${seasonNum}/${roundNum}`);
      if (!r.ok) { showHqToast("Race report not found for this round.", false); return; }
      const { report } = await r.json();
      getEl("car-report-badge").textContent = `S${report.season_num} R${report.round_num} RACE REPORT — ${String(report.gp_name || "").toUpperCase()}`;
      const rows = (report.classification || []).map((c) => {
        const delta = c.start_pos - c.pos;
        const dStr = c.dnf ? "—" : (delta > 0 ? `<span class="fin-pos">▲${delta}</span>` : (delta < 0 ? `<span class="fin-neg">▼${Math.abs(delta)}</span>` : "—"));
        const stintsHtml = (c.stints || []).map((s) => `<span class="sim-tbadge t-${s === "S" ? "soft" : (s === "M" ? "medium" : (s === "H" ? "hard" : (s === "I" ? "inter" : "wet")))}">${esc(s)}</span>`).join("→");
        return `
          <tr class="${c.is_player ? "is-player-row" : ""}">
            <td class="st-pos ${c.pos <= 3 ? "p" + c.pos : ""}">${c.dnf ? "DNF" : "P" + c.pos}</td>
            <td><span class="car-tchip"><i style="background:${esc(c.color)}"></i><b>${esc(c.code3)}</b> ${esc(c.clean_name)}</span>${c.fl ? ' <span class="sim-fl-pill">FL</span>' : ""}</td>
            <td class="muted small">${esc(c.team_name)}</td>
            <td>${dStr}</td>
            <td class="car-stint-cell">${stintsHtml}</td>
            <td><b>${c.pts}</b></td>
            <td><span class="car-rating-pill">${Number(c.rating || 7).toFixed(1)}</span></td>
          </tr>
        `;
      }).join("");
      const hasChart = Array.isArray(report.lap_history) && report.lap_history.length > 0;
      getEl("car-report-body").innerHTML = `
        <div class="car-report-summary">
          <span>🏆 Winner: <b>${esc(report.winner_name)}</b> (${esc(report.winner_team)})</span>
          <span>⚡ FL: <b>${esc(report.fastest_lap_name || "—")}</b></span>
          <span>🌦️ ${esc(report.weather_summary || "Dry")}</span>
          <span>🚨 SC: <b>${report.sc_count || 0}</b> · VSC: <b>${report.vsc_count || 0}</b> · Red Flags: <b>${report.red_flag_count || 0}</b></span>
        </div>
        ${hasChart ? `<canvas id="car-rep-lapchart" class="car-lapchart-canvas" style="height:170px;"></canvas><div id="car-rep-laplegend" class="car-lapchart-legend"></div>` : ""}
        <div class="car-table-scroll car-tall-scroll">
          <table class="car-table">
            <thead><tr><th>POS</th><th>DRIVER</th><th>TEAM</th><th>+/-</th><th>STINTS</th><th>PTS</th><th>RATING</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
      getEl("car-report-modal")?.classList.remove("hidden");
      if (hasChart) {
        const meta = (report.classification || []).map((c) => ({ id: c.driver_id, code3: c.code3, color: c.color, isPlayer: c.is_player }));
        requestAnimationFrame(() => drawLapPositionChart("car-rep-lapchart", "car-rep-laplegend", report.lap_history, meta));
      }
    } catch (err) {
      showHqToast(err.message, false);
    }
  }

  function openCompareModal(driverId) {
    const st = DATA.state, pt = DATA.player_team;
    const target = st && st.drivers[driverId];
    if (!target || !pt) return;
    const c1 = pt.driver_ids[0] ? st.drivers[pt.driver_ids[0]] : null;
    const c2 = pt.driver_ids[1] ? st.drivers[pt.driver_ids[1]] : null;
    const cols = [
      { label: "TARGET", d: target, isTarget: true },
      { label: "YOUR CAR #1", d: c1, isTarget: false },
      { label: "YOUR CAR #2", d: c2, isTarget: false },
    ].filter((x) => x.d);
    const metrics = [
      ["Overall", (d) => d.overall],
      ["Potential", (d) => d.potential],
      ["Pace", (d) => d.stats.pace],
      ["Racecraft", (d) => d.stats.racecraft],
      ["Wet Weather", (d) => d.stats.wet],
      ["Reliability", (d) => d.stats.reliability],
      ["Age", (d) => d.age],
      ["Salary", (d) => `$${d.salary_m}M`],
    ];
    getEl("car-compare-body").innerHTML = `
      <div class="car-cmp-grid">
        ${cols.map((col) => `
          <div class="car-cmp-col ${col.isTarget ? "is-target" : ""}">
            <span class="car-staff-role">${col.label}</span>
            <div class="car-mkt-drv">${renderPortraitMini(col.d, col.isTarget ? col.d.hero_color : pt.color)}<div><b>${esc(col.d.clean_name)}</b><small>${esc(col.d.trait)}</small></div></div>
            ${metrics.map(([lbl, fn]) => `<div class="car-cmp-row"><span class="muted">${lbl}</span><b>${esc(fn(col.d))}</b></div>`).join("")}
          </div>
        `).join("")}
      </div>
    `;
    getEl("car-compare-modal")?.classList.remove("hidden");
  }

  function drawLapPositionChart(canvasId, legendId, history, metaDrivers) {
    const cv = getEl(canvasId);
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 680, h = cv.clientHeight || 240;
    if (w < 40 || h < 40) return;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (!history || !history.length) {
      ctx.fillStyle = "#64748b";
      ctx.font = "600 12px 'Source Sans 3', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Complete Lap 1 to populate live lap-by-lap position telemetry", w / 2, h / 2);
      return;
    }

    const totalCars = Math.max(18, metaDrivers.length);
    const padL = 32, padR = 14, padT = 16, padB = 22;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const xFor = (i) => padL + (history.length === 1 ? plotW * 0.5 : (i / (history.length - 1)) * plotW);
    const yFor = (pos) => padT + ((Math.max(1, Math.min(totalCars, pos)) - 1) / Math.max(1, totalCars - 1)) * plotH;

    // Horizontal position gridlines (P1, P5, P10, P15, P20)
    ctx.font = "700 9px Orbitron, sans-serif";
    [1, 5, 10, 15, 20].forEach((p) => {
      if (p > totalCars) return;
      const y = yFor(p);
      ctx.strokeStyle = "rgba(148,163,184,0.14)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillStyle = "#64748b"; ctx.textAlign = "right";
      ctx.fillText(`P${p}`, padL - 5, y + 3);
    });

    // Highlight Safety Car / Red Flag laps
    history.forEach((snap, i) => {
      if (snap.sc || snap.rf) {
        ctx.fillStyle = snap.rf ? "rgba(220,38,38,0.18)" : "rgba(250,204,21,0.12)";
        ctx.fillRect(xFor(i) - 6, padT, 12, plotH);
      }
    });

    // Plot player cars + top 4 rivals
    const featured = metaDrivers.filter((d) => d.isPlayer).concat(metaDrivers.filter((d) => !d.isPlayer).slice(0, 4));
    featured.forEach((drv) => {
      ctx.beginPath();
      ctx.strokeStyle = drv.color || "#38bdf8";
      ctx.lineWidth = drv.isPlayer ? 3.0 : 1.5;
      ctx.setLineDash(drv.isPlayer ? [] : [4, 3]);
      let started = false;
      history.forEach((snap, i) => {
        const pos = (snap.positions || {})[drv.id];
        if (!pos) return;
        const x = xFor(i), y = yFor(pos);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    });

    ctx.fillStyle = "#94a3b8"; ctx.textAlign = "left";
    ctx.fillText(`L${history[0].lap}`, padL, h - 6);
    ctx.textAlign = "right";
    ctx.fillText(`L${history[history.length - 1].lap}`, w - padR, h - 6);

    const legEl = getEl(legendId);
    if (legEl) {
      legEl.innerHTML = featured.map((d) => `<span class="car-tchip"><i style="background:${esc(d.color)}"></i><b>${esc(d.code3)}</b>${d.isPlayer ? " ★" : ""}</span>`).join("");
    }
  }

  function renderStrategyPlanner() {
    const box = getEl("car-strat-planner");
    if (!box || !cr.circuit) return;
    const laps = parseInt(getEl("car-q-laps")?.value || "15", 10) || 15;
    const wMode = getEl("car-q-weather")?.value || "dynamic";
    const isRain = wMode === "rain" || wMode === "showers";
    const p1Lap = Math.max(3, Math.round(laps * 0.42));
    const p2Lap = Math.max(4, Math.round(laps * 0.56));
    const strats = isRain ? [
      { id: "rain_safe", name: "Wet Weather Safe", c0: "inter", c1: "inter", pitLap: p1Lap, next: "inter", badges: ["I", "I"], note: `Box ~L${p1Lap} fresh Inters` },
      { id: "rain_split", name: "Split Crossover Gamble", c0: "inter", c1: "wet", pitLap: p2Lap, next: "inter", badges: ["I", "W"], note: `Cover heavy rain + drying track` },
      { id: "rain_bold", name: "Slicks Crossover", c0: "inter", c1: "medium", pitLap: p1Lap, next: "medium", badges: ["I", "M"], note: `Box ~L${p1Lap} onto Mediums` },
    ] : [
      { id: "one_undercut", name: "1-Stop Undercut", c0: "soft", c1: "soft", pitLap: p1Lap, next: "medium", badges: ["S", "M"], note: `Aggressive start · Box ~L${p1Lap} → M` },
      { id: "one_overcut", name: "1-Stop Balanced", c0: "medium", c1: "medium", pitLap: p2Lap, next: "hard", badges: ["M", "H"], note: `Long first stint · Box ~L${p2Lap} → H` },
      { id: "split_cover", name: "Split Team Strategy", c0: "soft", c1: "medium", pitLap: p1Lap, next: "hard", badges: ["S/M", "H"], note: `Car #1 Undercut · Car #2 Overcut` },
    ];
    box.innerHTML = strats.map((s) => `
      <button type="button" class="car-strat-card ${cr.targetPitPlan && cr.targetPitPlan.id === s.id ? "is-sel" : ""}" data-strat-json='${esc(JSON.stringify(s))}'>
        <div class="car-strat-top"><span>${esc(s.name)}</span><span style="color:#38bdf8">${s.badges.join(" → ")}</span></div>
        <div class="car-strat-stints">${esc(s.note)}</div>
      </button>
    `).join("");
  }

  function renderSfxBtn() {
    const b = getEl("cr-sfx-toggle");
    if (!b || !window.F1Sfx) return;
    const on = window.F1Sfx.isEnabled();
    b.innerHTML = on ? `<i class="fas fa-volume-up"></i>` : `<i class="fas fa-volume-mute"></i>`;
  }

  function openRenewModal(driverId) {
    const d = DATA.state && DATA.state.drivers[driverId];
    if (!d) return;
    renewDriverId = driverId;
    getEl("car-renew-header").innerHTML = `
      <div class="car-mkt-drv">
        ${renderPortraitMini(d, DATA.player_team.color)}
        <div><strong>${esc(d.clean_name)}</strong><small>OVR ${d.overall} · POT ${d.potential} · Current $${d.salary_m}M/yr · Morale ${d.morale}%</small></div>
      </div>
    `;
    getEl("renew-salary").value = String(d.salary_m);
    getEl("renew-years").value = "2";
    getEl("car-renew-modal").classList.remove("hidden");
  }

  function showSillySeasonModal(recap) {
    getEl("car-silly-badge").textContent = `SEASON ${DATA.state.season_num} (${DATA.state.season_year}) — SILLY SEASON RECAP`;
    getEl("car-silly-body").innerHTML = (recap && recap.length)
      ? recap.map((m) => `
          <div class="car-deb-fin">
            <span class="car-dil-tag" style="margin-right:6px;">${esc(m.type)}</span>
            <strong>${esc(m.headline)}</strong>
            <div class="muted small" style="margin-top:2px;">${esc(m.detail)}</div>
          </div>
        `).join("")
      : `<div class="car-deb-fin">All teams retained their existing lineups into Season ${DATA.state.season_num}.</div>`;
    getEl("car-silly-modal").classList.remove("hidden");
  }

  // ==================== FULL RACE WEEKEND OS (FP1/FP2/FP3 PROGRAMMES + WATCH LIVE + SIM TO END + DOPPLER RADAR) ====================
  const wkCtx = {
    data: null,
    programmes: [],
    roster: [],
    devPoints: 0,
    circuit: null,
    runner: null,
    radar: null,
    radarData: null,
    activeMode: "fp1",
    speed: 4,
  };

  function _wkEnsureWidgets() {
    if (!wkCtx.runner && window.F1WeekendSessionSim && getEl("car-wk-canvas")) {
      wkCtx.runner = window.F1WeekendSessionSim.create(getEl("car-wk-canvas"), {});
    }
    if (!wkCtx.radar && window.F1WeatherRadarUI && getEl("car-wk-radar-host")) {
      wkCtx.radar = window.F1WeatherRadarUI.create(getEl("car-wk-radar-host"));
    }
  }

  async function refreshWeekendRadar() {
    _wkEnsureWidgets();
    if (!wkCtx.radar || !wkCtx.circuit) return;
    const wMode = getEl("car-q-weather")?.value || "dynamic";
    const laps = parseInt(getEl("car-q-laps")?.value || "15", 10) || 15;
    const intel = (wkCtx.data && wkCtx.data.strategy_intel && wkCtx.data.strategy_intel.accuracy_pct) || 35;
    const tCare = (DATA.player_team && DATA.player_team.rd && DATA.player_team.rd.tyre_care) || 80;
    wkCtx.radarData = await wkCtx.radar.load(wkCtx.circuit, { mode: wMode, laps, intelPct: intel, tyreCare: tCare });
    renderStrategyPlanner();
  }

  function renderWeekendTimingTable(rows, mode) {
    const wrap = getEl("car-q-grid-wrap");
    if (!wrap) return;
    const list = rows || [];
    const isQ1 = mode === "q1", isQ2 = mode === "q2";
    const cutoff = isQ1 ? 15 : (isQ2 ? 10 : 99);
    wrap.innerHTML = `<div class="car-q-grid-list">` + list.map((g) => {
      const pos = g.pos || 1;
      const inDrop = pos > cutoff;
      const lapS = g.best_lap_s != null ? g.best_lap_s : g.quali_s;
      const tTag = g.tyre ? `<span class="car-q-out-tag" style="background:rgba(56,189,248,0.16);color:#7dd3fc;">${esc(g.tyre)}</span>` : "";
      const stTag = g.eliminated_in ? `<span class="car-q-out-tag">OUT ${esc(g.eliminated_in)}</span>` : (inDrop ? `<span class="car-q-out-tag">DROP ZONE</span>` : "");
      return `
        <div class="car-q-row ${g.is_player_team ? "is-me" : ""} ${g.eliminated_in || inDrop ? "is-elim" : ""}">
          <span class="car-q-pos">P${pos}</span>
          <span class="st-bar" style="background:${esc(g.color || "#38bdf8")}"></span>
          <b>${esc(g.code3)}</b>
          <span class="car-q-drv">${esc(g.clean_name)}</span>
          ${tTag}${stTag}
          <small class="muted">${esc(g.team_name || "")}</small>
          <span class="car-q-time">${pos === 1 ? fmtLap(lapS) : `+${Number(g.gap_s || 0).toFixed(3)}s`}</span>
        </div>`;
    }).join("") + `</div>`;
  }

  function renderWeekendOS() {
    const wk = wkCtx.data;
    if (!wk || !wkCtx.circuit) return;
    _wkEnsureWidgets();
    cr.circuit = wkCtx.circuit;

    // Header & KPI pills
    getEl("car-q-round-pill").textContent = `SEASON ${DATA.state.season_num} · ROUND ${wk.round}${wk.is_sprint ? " ⚡ SPRINT WEEKEND" : ""} · FULL GP WEEKEND`;
    getEl("car-q-title").textContent = `${wk.gp} — ${wkCtx.circuit.name}`;
    getEl("car-q-meta").textContent = `${wkCtx.circuit.length_km} km · ${wkCtx.circuit.turns} Turns · ${wkCtx.circuit.drs_zones} DRS · ${wkCtx.circuit.aero} Aero · Track ${wkCtx.circuit.track_temp_c || 32}°C`;

    const setup = wk.setup || { wing: 50, susp: 50, diff: 50, confidence: 64, feedback: {} };
    cr.setupConf = Number(setup.confidence || 64);
    const cfEl = getEl("car-fp-conf-pill");
    if (cfEl) cfEl.textContent = `${cr.setupConf}%`;
    const knEl = getEl("car-wk-kn-val");
    if (knEl) knEl.textContent = `${wk.car_knowledge_pct || 12}%`;
    const stInfo = wk.strategy_intel || { accuracy_pct: 35, tier: "ROUGH" };
    const stValEl = getEl("car-wk-strat-val");
    if (stValEl) {
      stValEl.textContent = `${stInfo.accuracy_pct}% ${stInfo.tier === "NAILED" ? "★" : ""}`;
      stValEl.style.color = stInfo.accuracy_pct >= 85 ? "#4ade80" : (stInfo.accuracy_pct >= 62 ? "#7dd3fc" : "#fcd34d");
    }
    const dpEl = getEl("car-wk-dp-val");
    if (dpEl) dpEl.textContent = `${wkCtx.devPoints || 0} DP`;

    // Weekend Stepper
    const doneSet = new Set(wk.completed_sessions || []);
    const order = wk.sessions_order || ["fp1", "fp2", "fp3", "q1", "q2", "q3", "race"];
    const stepEl = getEl("car-wk-stepper");
    if (stepEl) {
      stepEl.innerHTML = order.map((k) => {
        const isDone = doneSet.has(k);
        const isCur = wk.current_phase === k;
        const lbl = k === "race" ? "🏁 GRAND PRIX" : k.toUpperCase();
        return `<button type="button" class="car-wk-step${isDone ? " done" : ""}${isCur ? " active" : ""}" data-wk-step="${k}">${isDone ? "✓ " : ""}${lbl}</button>`;
      }).join("");
      stepEl.querySelectorAll("[data-wk-step]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const sk = btn.getAttribute("data-wk-step");
          if (sk === "race") return;
          wkCtx.activeMode = sk;
          const prevRes = wk.session_results && wk.session_results[sk];
          if (prevRes && prevRes.classification) renderWeekendTimingTable(prevRes.classification, sk);
        });
      });
    }

    // Populate FP Programmes dropdowns & sliders
    const progs = wkCtx.programmes || [];
    const assigned = wk.programmes_assigned || { "0": "track_acclim", "1": "tyre_mgmt" };
    const pt = DATA.player_team;
    [0, 1].forEach((slot) => {
      const drv = pt && pt.driver_ids[slot] ? DATA.state.drivers[pt.driver_ids[slot]] : null;
      const lbl = getEl(`car-wk-p${slot}-lbl`);
      if (lbl && drv) lbl.textContent = `Car #${slot + 1} (${drv.code3}) Programme`;
      const stLbl = getEl(`car-st-lbl-${slot}`);
      if (stLbl && drv) stLbl.textContent = `Car #${slot + 1} (${drv.code3})`;
      const sel = getEl(`car-wk-prog-${slot}`);
      if (sel && progs.length) {
        if (!sel.options.length) {
          sel.innerHTML = progs.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (+${p.dev_points} DP)</option>`).join("");
        }
        sel.value = assigned[String(slot)] || progs[slot % progs.length].id;
        const pObj = progs.find((x) => x.id === sel.value);
        const dEl = getEl(`car-wk-p${slot}-desc`);
        if (dEl && pObj) dEl.textContent = pObj.desc;
      }
    });

    ["wing", "susp", "diff"].forEach((k) => {
      const inp = getEl(`fp-${k}`); if (inp) inp.value = String(setup[k] ?? 50);
      const valEl = getEl(`fp-${k}-val`); if (valEl) valEl.textContent = String(setup[k] ?? 50);
      const fbEl = getEl(`fp-${k}-fb`); if (fbEl) fbEl.textContent = (setup.feedback && setup.feedback[k]) || "UNTESTED";
    });

    const curPhase = wk.current_phase || "fp1";
    const isFpPhase = curPhase.startsWith("fp");
    const fpDoneCount = (wk.completed_sessions || []).filter((x) => x.startsWith("fp")).length;
    const fpMax = wk.is_sprint ? 2 : 3;
    const stEl = getEl("car-fp-stints");
    if (stEl) stEl.textContent = `(${fpDoneCount}/${fpMax} FP Done)`;
    const fpTitle = getEl("car-wk-fp-title");
    if (fpTitle) fpTitle.textContent = isFpPhase ? `${curPhase.toUpperCase()} PROGRAMMES & SETUP` : "PRACTICE COMPLETE (PARC FERMÉ)";
    const liveLbl = getEl("car-wk-live-lbl");
    if (liveLbl) liveLbl.innerHTML = `<i class="fas fa-broadcast-tower"></i> ${curPhase === "race" ? "STARTING GRID LOCKED" : curPhase.toUpperCase() + " LIVE TRACK MONITOR"}`;

    const fpLocked = !isFpPhase || (cr.quali && cr.quali.stage === "done");
    if (getEl("car-fp-run-btn")) getEl("car-fp-run-btn").disabled = fpLocked;
    if (getEl("car-fp-auto-btn")) getEl("car-fp-auto-btn").disabled = fpLocked;
    if (getEl("car-wk-watch-btn")) getEl("car-wk-watch-btn").disabled = (curPhase === "race");
    if (getEl("car-wk-simend-btn")) getEl("car-wk-simend-btn").disabled = (curPhase === "race");

    // Engineer Notes & Driver Skill XP Gains
    const notesEl = getEl("car-wk-eng-notes");
    if (notesEl) {
      const skillTags = Object.values(wk.driver_skill_gains || {}).map((g) => {
        const parts = Object.entries(g.stats || {}).map(([k, v]) => `+${v} ${k.toUpperCase()}`).join(", ");
        return `<span style="color:#4ade80;font-weight:700;">⭐ ${esc(g.code3)}: ${esc(parts)}</span>`;
      }).join(" · ");
      const notes = (wk.engineer_notes || []).slice(0, 4).map((n) => `<div>• ${esc(n)}</div>`).join("");
      notesEl.innerHTML = (skillTags ? `<div>${skillTags}</div>` : "") + notes;
    }

    // Qualifying controls state
    const qStg = (cr.quali && cr.quali.round === wk.round) ? (cr.quali.stage || "done") : "not_started";
    const pill = getEl("car-q-stage-pill");
    const stgBtn = getEl("car-q-stage-btn");
    const simFullBtn = getEl("car-q-simfull-btn");
    const watchQBtn = getEl("car-q-watch-btn");
    const noteEl = getEl("car-q-tyre-note");
    if (qStg === "not_started") {
      if (pill) pill.textContent = isFpPhase ? "QUALIFYING READY (OR RUN FP FIRST)" : "Q1 READY · TOP 15 ADVANCE";
      if (stgBtn) { stgBtn.disabled = false; stgBtn.innerHTML = `<i class="fas fa-stopwatch"></i> Sim Q1`; stgBtn.dataset.nextStage = "q1"; }
      if (watchQBtn) { watchQBtn.disabled = false; watchQBtn.dataset.nextStage = "q1"; watchQBtn.innerHTML = `<i class="fas fa-play"></i> Watch Q1`; }
      if (simFullBtn) simFullBtn.disabled = false;
    } else if (qStg === "q1_done") {
      if (pill) pill.textContent = "Q1 DONE · TOP 15 ADVANCE TO Q2";
      if (stgBtn) { stgBtn.disabled = false; stgBtn.innerHTML = `<i class="fas fa-stopwatch"></i> Sim Q2`; stgBtn.dataset.nextStage = "q2"; }
      if (watchQBtn) { watchQBtn.disabled = false; watchQBtn.dataset.nextStage = "q2"; watchQBtn.innerHTML = `<i class="fas fa-play"></i> Watch Q2`; }
      if (simFullBtn) simFullBtn.disabled = false;
    } else if (qStg === "q2_done") {
      if (pill) pill.textContent = "Q2 DONE · TOP 10 Q3 POLE SHOOTOUT";
      if (stgBtn) { stgBtn.disabled = false; stgBtn.innerHTML = `<i class="fas fa-fire"></i> Sim Q3`; stgBtn.dataset.nextStage = "q3"; }
      if (watchQBtn) { watchQBtn.disabled = false; watchQBtn.dataset.nextStage = "q3"; watchQBtn.innerHTML = `<i class="fas fa-play"></i> Watch Q3`; }
      if (simFullBtn) simFullBtn.disabled = false;
    } else {
      if (pill) pill.textContent = "✓ STARTING GRID LOCKED (PARC FERMÉ)";
      if (stgBtn) { stgBtn.disabled = true; stgBtn.innerHTML = `<i class="fas fa-check"></i> Quali Done`; stgBtn.dataset.nextStage = "done"; }
      if (watchQBtn) { watchQBtn.disabled = true; watchQBtn.dataset.nextStage = "done"; }
      if (simFullBtn) simFullBtn.disabled = true;
      if (noteEl) noteEl.textContent = `Car Knowledge ${wk.car_knowledge_pct}% · Strategy ${stInfo.tier} · Ready for Lights Out!`;
    }

    if (wkCtx.runner && !wkCtx.runner.isActive()) {
      wkCtx.runner.previewTrack(wkCtx.circuit);
    }

    // Show latest classification table (Quali grid if started, else latest FP table, else starter roster)
    if (cr.quali && cr.quali.round === wk.round && cr.quali.grid && cr.quali.grid.length) {
      renderQualiGridUI();
    } else {
      const lastFp = ["fp3", "fp2", "fp1"].find((k) => wk.session_results && wk.session_results[k]);
      if (lastFp) {
        renderWeekendTimingTable(wk.session_results[lastFp].classification, lastFp);
      } else {
        const wrap = getEl("car-q-grid-wrap");
        if (wrap) wrap.innerHTML = `<div class="muted small" style="padding:10px;text-align:center;">Track is green for <b>${curPhase.toUpperCase()}</b>! Pick Car #1 &amp; Car #2 programmes above, then click <b>▶ Watch Session</b> or <b>⏭ Sim to End</b>.</div>`;
      }
    }
    renderStrategyPlanner();
  }

  function _commitPracticeFromResult(sessionKey, result, autoTune) {
    const p0 = getEl("car-wk-prog-0")?.value || "track_acclim";
    const p1 = getEl("car-wk-prog-1")?.value || "tyre_mgmt";
    const times = result && Array.isArray(result.classification) ? result.classification : null;
    const scores = result && result.programmeScores ? result.programmeScores : null;
    return postJson("/api/career/weekend/practice", {
      session: sessionKey,
      car_programmes: { "0": p0, "1": p1 },
      wing: Number(getEl("fp-wing")?.value || 50),
      susp: Number(getEl("fp-susp")?.value || 50),
      diff: Number(getEl("fp-diff")?.value || 50),
      auto_tune: !!autoTune,
      weather_mode: getEl("car-q-weather")?.value || "dynamic",
      programme_scores: scores,
      session_times: times,
    }).then((res) => {
      DATA = res;
      if (res.weekend) wkCtx.data = res.weekend;
      if (res.dev_points != null) wkCtx.devPoints = res.dev_points;
      renderWeekendOS();
      refreshWeekendRadar();
      showHqToast(res.message, res.ok);
    });
  }

  function watchActiveSessionLive(forcedMode) {
    _wkEnsureWidgets();
    if (!wkCtx.runner || !wkCtx.data || !wkCtx.circuit) return;
    const mode = (forcedMode || wkCtx.data.current_phase || "fp1").toLowerCase();
    if (mode === "race") return;

    const isQuali = mode === "q1" || mode === "q2" || mode === "q3";
    let sessionRoster = (wkCtx.roster || []).slice();
    if (isQuali && cr.quali && cr.quali.round === wkCtx.data.round && cr.quali.grid && mode !== "q1") {
      const aliveIds = new Set(cr.quali.grid.filter((g) => !g.eliminated_in).map((g) => g.driver_id));
      sessionRoster = sessionRoster.filter((r) => aliveIds.has(r.driver_id));
    }

    const p0 = (wkCtx.programmes || []).find((p) => p.id === (getEl("car-wk-prog-0")?.value || "track_acclim"));
    const p1 = (wkCtx.programmes || []).find((p) => p.id === (getEl("car-wk-prog-1")?.value || "tyre_mgmt"));
    const tyreMap = { "0": (p0 && p0.tyre ? p0.tyre[0].toUpperCase() : "M"), "1": (p1 && p1.tyre ? p1.tyre[0].toUpperCase() : "H") };
    const progHud = getEl("car-wk-prog-hud");

    wkCtx.runner.start({
      mode: mode,
      speed: wkCtx.speed || 4,
      circuit: wkCtx.circuit,
      roster: sessionRoster,
      setupConf: (wkCtx.data.setup && wkCtx.data.setup.confidence) || 68,
      knowledgePct: wkCtx.data.car_knowledge_pct || 15,
      qualiBonusS: wkCtx.data.quali_pace_bonus_s || 0,
      tyreChoice: getEl("car-q-tyre-choice")?.value || "fresh",
      weather: getEl("car-q-weather")?.value || "dynamic",
      carTyres: tyreMap,
      programmeInfo: { "0": p0, "1": p1 },
      onRadio: (txt) => {
        const rb = getEl("car-wk-radio-bar");
        if (rb) rb.textContent = `📻 Race Engineer: ${txt}`;
      },
      onUpdate: (snap) => {
        renderWeekendTimingTable(snap.classification, mode);
        if (progHud) {
          if (!isQuali) {
            const p0Pct = snap.playerProgress["0"] || 0;
            const p1Pct = snap.playerProgress["1"] || 0;
            progHud.innerHTML =
              `<div class="car-wk-ph-item">Car #1 ${esc((p0 && p0.short) || "PROG")} <b>${p0Pct}%</b><div class="car-wk-ph-bar"><i style="width:${p0Pct}%"></i></div></div>` +
              `<div class="car-wk-ph-item">Car #2 ${esc((p1 && p1.short) || "PROG")} <b>${p1Pct}%</b><div class="car-wk-ph-bar"><i style="width:${p1Pct}%"></i></div></div>`;
          } else {
            progHud.innerHTML = `<div class="car-wk-ph-item"><b>${mode.toUpperCase()} LIVE SHOOTOUT</b> · ${snap.progressPct}% Complete · Clock ${snap.clockText}</div>`;
          }
        }
      },
      onComplete: async (res) => {
        if (progHud) progHud.innerHTML = "";
        if (!isQuali) {
          await _commitPracticeFromResult(mode, res, false);
        } else {
          const liveTimes = {};
          (res.classification || []).forEach((row) => { liveTimes[row.driver_id] = row.best_lap_s; });
          await runCareerQualifying(mode, liveTimes);
        }
      },
    });
  }

  async function simActiveSessionToEnd() {
    if (wkCtx.runner && wkCtx.runner.isActive()) {
      wkCtx.runner.simToEnd();
      return;
    }
    const phase = (wkCtx.data && wkCtx.data.current_phase) || "fp1";
    if (phase.startsWith("fp")) {
      await _commitPracticeFromResult(phase, null, false);
    } else if (phase === "q1" || phase === "q2" || phase === "q3") {
      await runCareerQualifying(phase);
    }
  }

  function syncFpSetupUI() {
    if (wkCtx.data) {
      const ws = wkCtx.data.setup || {};
      cr.setupConf = Number(ws.confidence || 70);
    }
  }

  async function openRaceWeekend() {
    if (!DATA.has_career || DATA.state.season_complete) return;
    getEl("career-hq").classList.add("hidden");
    getEl("career-race-view").classList.remove("hidden");
    getEl("car-quali-panel").classList.remove("hidden");
    getEl("car-live-cockpit").classList.add("hidden");
    document.body.classList.remove("sim-cockpit-active");

    const wMode = getEl("car-q-weather")?.value || "dynamic";
    try {
      const r = await fetch(`/api/career/weekend?weather_mode=${encodeURIComponent(wMode)}`);
      if (r.ok) {
        const d = await r.json();
        wkCtx.data = d.weekend;
        wkCtx.programmes = d.programmes || [];
        wkCtx.roster = d.roster || [];
        wkCtx.devPoints = d.dev_points || 0;
        wkCtx.circuit = d.circuit || circuitById(d.weekend.circuit_id);
        cr.circuit = wkCtx.circuit;
      }
    } catch (_) {}

    const pq = DATA.state.pending_quali;
    if (pq && pq.round === DATA.state.current_round && pq.grid && pq.grid.length) {
      cr.quali = pq;
      cr.circuit = circuitById(pq.circuit_id);
    } else {
      cr.quali = null;
    }
    renderWeekendOS();
    refreshWeekendRadar();
  }

  function renderQualiGridUI() {
    if (!cr.quali) return;
    renderStrategyPlanner();
    const sprintBanner = (cr.quali.sprint_top8 && cr.quali.sprint_top8.length)
      ? `<div class="car-sprint-banner"><strong>⚡ SATURDAY F1 SPRINT POINTS AWARDED:</strong> ${cr.quali.sprint_top8.map((s) => `<span class="${s.is_player_team ? "sp-me" : ""}">P${s.pos} ${esc(s.code3)} (+${s.pts})</span>`).join(" · ")}</div>`
      : "";
    getEl("car-q-grid-wrap").innerHTML = `
      ${sprintBanner}
      <div class="car-q-grid-list">
        ${cr.quali.grid.map((g) => {
          const outTag = g.eliminated_in ? `<span class="car-q-out-tag">OUT ${esc(g.eliminated_in)}</span>` : "";
          return `
            <div class="car-q-row ${g.is_player_team ? "is-me" : ""} ${g.eliminated_in ? "is-elim" : ""}">
              <span class="car-q-pos">P${g.pos}</span>
              <span class="st-bar" style="background:${esc(g.color)}"></span>
              <b>${esc(g.code3)}</b>
              <span class="car-q-drv">${esc(g.clean_name)}</span>
              ${outTag}
              ${g.grid_penalty > 0 ? `<span class="sim-pen-pill">+${g.grid_penalty}P</span>` : ""}
              <small class="muted">${esc(g.team_name)}</small>
              <span class="car-q-time">${g.pos === 1 ? fmtLap(g.quali_s) : `+${g.gap_s.toFixed(3)}s`}</span>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  async function runCareerQualifying(stage, liveTimes) {
    const wMode = getEl("car-q-weather").value || "dynamic";
    const tyreChoice = getEl("car-q-tyre-choice")?.value || "fresh";
    const payload = {
      weather_mode: wMode,
      stage: stage || "full",
      tyre_choice: tyreChoice,
    };
    if (liveTimes && typeof liveTimes === "object") payload.live_times = liveTimes;
    const res = await postJson("/api/career/race/qualify", payload);
    DATA = res;
    cr.quali = res.quali;
    cr.circuit = circuitById(cr.quali.circuit_id);
    if (DATA.state && DATA.state.weekend_state) wkCtx.data = DATA.state.weekend_state;
    renderWeekendOS();
    renderQualiGridUI();
  }

  function showPostRaceDebrief(debrief) {
    document.body.classList.remove("sim-cockpit-active", "sim-focus-mode");
    getEl("career-race-view").classList.add("hidden");
    getEl("career-hq").classList.remove("hidden");
    renderAll();

    getEl("car-debrief-badge").textContent = `ROUND ${debrief.round} DEBRIEF — ${debrief.gp.toUpperCase()}`;
    const finishes = (debrief.player_finishes || []).map((f) => {
      const rBadge = f.rating ? `<span class="car-rating-pill">${Number(f.rating).toFixed(1)}/10</span>` : "";
      return `<div class="car-deb-fin" style="display:flex;justify-content:space-between;align-items:center;"><span><b>${esc(f.code3)}</b> ${esc(f.driver)} → <strong style="color:#fde047">${f.dnf ? "DNF" : "P" + f.pos}</strong> (+${f.pts} pts)</span>${rBadge}</div>`;
    }).join("");
    const rdHtml = (debrief.completed_rd || []).map((p) => `<div style="color:#4ade80">🔧 R&amp;D Complete: ${esc(p.label)} (+${p.gain})</div>`).join("");
    const scHtml = (debrief.completed_scouts || []).map((n) => `<div style="color:#38bdf8">🔭 Scout Dossier Ready: ${esc(n)}</div>`).join("");
    const pm = debrief.media_prompt || (DATA.state && DATA.state.pending_media);
    const mediaHtml = (pm && pm.choices && pm.choices.length)
      ? `<div id="car-deb-media-box" class="car-media-banner" style="margin:6px 0 0;">
          <div class="car-dil-head"><span class="car-dil-tag" style="background:#38bdf8;color:#0f172a;">🎙 MEDIA PEN</span><strong>${esc(pm.headline)}</strong></div>
          <p class="car-dil-body">${esc(pm.question)}</p>
          <div class="car-dil-choices">
            ${pm.choices.map((ch, idx) => `<button type="button" class="car-dil-btn" data-media-idx="${idx}">${esc(ch.label)}</button>`).join("")}
          </div>
        </div>`
      : "";

    const staffPay = Number(debrief.staff_per_race_m || 0);
    const rivalBon = Number(debrief.rival_bonus_m || 0);
    const rivalLine = rivalBon > 0
      ? `<div><span>🔥 Rivalry Bonus (Beat ${esc((debrief.rivals_beaten || []).join(", "))})</span><b class="fin-pos">+$${rivalBon.toFixed(1)}M</b></div>`
      : "";
    const analyticsBtnHtml = window.F1_CAREER_LAST_TELEMETRY
      ? `<div style="margin:8px 0;"><button type="button" id="car-deb-analytics-btn" class="car-btn-xs car-btn-gold" style="width:100%;padding:7px;"><i class="fas fa-chart-area"></i> Open Full Race Telemetry Studio &amp; Post-Race Driver Interviews</button></div>`
      : "";
    getEl("car-debrief-body").innerHTML = `
      <div class="car-deb-section">${finishes}</div>
      ${analyticsBtnHtml}
      <div class="car-deb-finances">
        <div><span>Race Prize Money (+${debrief.race_pts_player} pts)</span><b class="fin-pos">+$${debrief.prize_m.toFixed(1)}M</b></div>
        <div><span>Sponsor Base Income</span><b class="fin-pos">+$${debrief.sponsor_base_m.toFixed(1)}M</b></div>
        <div><span>Sponsor Goal Bonuses ${debrief.goals_hit.length ? "(" + esc(debrief.goals_hit.join(", ")) + ")" : ""}</span><b class="fin-pos">+$${debrief.sponsor_bonus_m.toFixed(1)}M</b></div>
        ${rivalLine}
        <div><span>Driver Salaries + HQ Upkeep</span><b class="fin-neg">-$${(debrief.sal_per_race_m + debrief.upkeep_m).toFixed(1)}M</b></div>
        <div><span>Technical Staff Payroll</span><b class="fin-neg">-$${staffPay.toFixed(1)}M</b></div>
        <div class="car-deb-net"><span>Net Grand Prix Cashflow</span><b class="${debrief.net_m >= 0 ? "fin-pos" : "fin-neg"}">${debrief.net_m >= 0 ? "+" : ""}$${debrief.net_m.toFixed(1)}M</b></div>
      </div>
      ${rdHtml}${scHtml}${mediaHtml}
    `;
    getEl("car-debrief-modal").classList.remove("hidden");
    getEl("car-deb-analytics-btn")?.addEventListener("click", () => {
      if (window.F1RaceAnalytics && window.F1_CAREER_LAST_TELEMETRY) {
        window.F1RaceAnalytics.open(window.F1_CAREER_LAST_TELEMETRY, { initialTab: "interviews" });
      }
    });
  }

  function getFocusedCar() {
    const idx = cr.playerCarIndices[cr.focusSlot] ?? cr.playerCarIndices[0] ?? 0;
    return cr.cars[idx];
  }

  function effectivePitLossForCar(car) {
    const sdRating = Number((((DATA.state || {}).staff || {}).sporting_dir || {}).rating || 74);
    const sdSave = car.isPlayerTeam ? Math.max(0, (sdRating - 70) * 0.025) : 0;
    const f1dbPitSec = Number(cr.circuitF1db?.pitStops?.medianPitLaneSec || 0);
    const cirPit = f1dbPitSec >= 14 && f1dbPitSec <= 38 ? f1dbPitSec : cr.circuit.pit_loss_s;
    const base = cirPit - ((car.facilities.pit_sim || 1) - 1) * 0.65 - sdSave;
    const scFactor = cr.safetyCarLaps > 0 ? 0.58 : (cr.vscLaps > 0 ? 0.68 : 1.0);
    return Math.max(11.5, base * scFactor);
  }

  function crIsInDrsZone(prog) {
    const p = ((prog % 1) + 1) % 1;
    return (cr.circuit.drs_ranges || []).some(([a, b]) => p >= a && p <= b);
  }

  function crHasTwoComp(car) {
    return car.usedWet || car.dryCompoundsUsed.size >= 2;
  }

  function computeCrLapTime(car) {
    const st = car.driver.stats, rd = car.rd, fac = car.facilities, c = cr.circuit;
    const comp = COMPOUNDS[car.compound] || COMPOUNDS.medium;
    const carFit = c.aero === "HIGH" ? (rd.aero * 0.45 + rd.chassis * 0.3 + rd.power * 0.25)
      : (c.aero === "LOW" ? (rd.power * 0.45 + rd.chassis * 0.3 + rd.aero * 0.25) : car.carOverall);
    const drvFit = st.pace * 0.36 + st.racecraft * 0.34 + st.reliability * 0.14 + st.clutch * 0.16;
    const combined = carFit * 0.48 + drvFit * 0.52;

    const fuelPenalty = Math.max(0, 1 - car.lap / Math.max(1, cr.totalLaps)) * 1.85;
    const gripBonus = ((cr.gripPct - 35) / 65) * 0.65;

    let lapS = c.base_lap_s + fuelPenalty - gripBonus - (combined - 75) * 0.068 + comp.pace;
    lapS += (100 - car.tyreLife) * 0.018;
    if (car.tyreLife < 22) lapS += (22 - car.tyreLife) * 0.16;
    if (car.tyreTemp > 114) lapS += (car.tyreTemp - 114) * 0.08;
    else if (car.tyreTemp < 84) lapS += (84 - car.tyreTemp) * 0.06;

    if (cr.wetness >= 60) {
      lapS += comp.wet === 0 ? 7.5 : (comp.wet === 1 ? 1.4 : -0.4);
      lapS -= (st.wet - 75) * 0.03;
    } else if (cr.wetness >= 22) {
      lapS += comp.wet === 0 ? 3.2 : (comp.wet === 1 ? -0.6 : 1.6);
      lapS -= (st.wet - 75) * 0.02;
    } else if (comp.wet > 0) {
      lapS += comp.wet === 1 ? 2.6 : 4.8;
    }

    if (car.paceMode === "push") lapS -= 0.72;
    else if (car.paceMode === "conserve") lapS += 0.55;
    if (car.isPlayerTeam) {
      // FP Setup Confidence pace bonus (up to -0.42s/lap at 100% optimal setup!)
      lapS -= ((cr.setupConf || 70) - 70) * 0.014;
      // Low Fuel forces lift-and-coast penalty!
      if ((car.fuelDelta || 0) < 0) lapS += Math.min(2.2, Math.abs(car.fuelDelta) * 1.35);
      if (car.wingDamaged) lapS += 0.55;
    }
    const ersBoost = 0.95 * (1 + ((fac.powertrain_lab || 1) - 1) * 0.08);
    if (car.ersMode === "overtake" && car.ers > 6) lapS -= ersBoost;
    else if (car.ersMode === "harvest") lapS += 0.35;
    if (car.inDrsRange && cr.drsEnabled) lapS -= 0.34;
    if (ENG && ENG.getDriverBehaviorModifiers) {
      const beh = ENG.getDriverBehaviorModifiers(car, cr.wetness);
      lapS += beh.paceDelta;
    }
    if (cr.safetyCarLaps > 0) {
      // Phase A: True Safety Car pack bunching + leader restart pacing
      const baseSc = c.base_lap_s * 1.38;
      if (car.pos === 1) {
        const progFrac = ((car.totalProg % 1) + 1) % 1;
        if (cr.safetyCarLaps === 1 && progFrac >= 0.72 && progFrac < 0.94) {
          return c.base_lap_s * 1.62;
        }
        if (cr.safetyCarLaps === 1 && progFrac >= 0.94) {
          return c.base_lap_s * 0.96;
        }
        return baseSc;
      }
      const gapAhead = Number(car.intervalS || 0);
      if (gapAhead > 1.8) return c.base_lap_s * 1.04;
      if (gapAhead > 0.7) return c.base_lap_s * 1.18;
      if (gapAhead < 0.35) return c.base_lap_s * 1.46;
      return baseSc;
    }
    else if (cr.vscLaps > 0) lapS = c.base_lap_s * 1.24;
    return Math.max(c.base_lap_s * 0.84, lapS + (Math.random() - 0.5) * 0.40);
  }

  function drawCrCanvas() {
    const R = window.F1TrackRenderer;
    const cv = getEl("cr-track-canvas");
    if (!R || !cv || !cr.circuit) return;
    if (!cr.cam) cr.cam = R.createCamera();
    if (!cr.fx) cr.fx = R.createFxState();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = cv.clientWidth || 720, cssH = cv.clientHeight || 520;
    if (cssW < 40 || cssH < 40) return;
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
      cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    }
    const key = `${cr.circuit.id}|${cssW}x${cssH}|${dpr}|${cr.layers.corners}|${cr.layers.sectors}`;
    if (cr.staticKey !== key || !cr.geom) {
      cr.geom = R.buildGeometry(cr.circuit, cssW, cssH);
      if (!cr.staticCanvas) cr.staticCanvas = document.createElement("canvas");
      R.buildStaticCache(cr.staticCanvas, cr.circuit, cr.geom, dpr, cr.layers);
      cr.staticKey = key;
    }

    const foc = getFocusedCar();
    const camCar = (cr.inspectedDriverId ? cr.cars.find((x) => x.driverId === cr.inspectedDriverId && !x.dnf) : null) || (foc && !foc.dnf ? foc : cr.cars.find((c) => !c.dnf));
    const camTarget = (camCar && cr.geom && R.computeBattleCameraTarget)
      ? R.computeBattleCameraTarget(camCar, cr.cars, cr.geom, cr.circuit, cr.cam.zoom)
      : null;
    R.updateCamera(cr.cam, camTarget, cssW, cssH, cr.lastDt || 0.016);

    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    ctx.save();
    R.applyCameraTransform(ctx, cr.cam, cssW, cssH);
    ctx.drawImage(cr.staticCanvas, 0, 0, cssW, cssH);

    // 12-Layer Dynamic F1 World Track State
    R.drawDynamicTrackState(ctx, cr.circuit, cr.geom, {
      gripPct: cr.gripPct,
      drsEnabled: cr.drsEnabled,
      wetness: cr.wetness,
      targetWetness: cr.targetWetness,
      drying: cr.drying,
      raceClock: cr.raceClock,
      yellowSector: cr.yellowSector,
      scActive: cr.safetyCarLaps > 0,
      vscActive: cr.vscLaps > 0,
      showBestLine: cr.layers.line !== false,
    });

    if (cr.safetyCarLaps > 0) {
      const ldr = cr.cars.find((c) => !c.dnf && c.pos === 1);
      if (ldr) {
        const scP = R.sampleTrack(cr.geom, ldr.totalProg + 0.032);
        R.drawMiniF1Car(ctx, scP.x, scP.y, Math.atan2(scP.ty, scP.tx), "#005a3c", "#facc15", {
          isPlayer: false,
          isSafetyCar: true,
          zoom: cr.cam.zoom,
          teamName: "Safety Car",
        });
        ctx.font = "800 8.5px Orbitron, sans-serif"; ctx.fillStyle = "#fde047"; ctx.fillText("SC", scP.x + 10, scP.y - 6);
      }
    }

    // Pit rejoin ghost for focused car
    if (foc && !foc.dnf && (foc.boxNextLap || cr.boxHover || cr.layers.ghost)) {
      const pitLoss = effectivePitLossForCar(foc);
      const rProg = foc.totalProg - pitLoss / cr.circuit.base_lap_s;
      const gp = R.sampleTrack(cr.geom, rProg);
      const ahead = cr.cars.filter((c) => !c.dnf && c.idx !== foc.idx && c.totalProg > rProg).length;
      ctx.save();
      ctx.beginPath(); ctx.arc(gp.x, gp.y, 10, 0, Math.PI * 2);
      ctx.strokeStyle = "#fde047"; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
      const lbl = `REJOIN ~P${ahead + 1}`;
      ctx.font = "800 9px Orbitron, sans-serif";
      const tw = ctx.measureText(lbl).width;
      ctx.fillStyle = "rgba(9,14,26,0.92)"; ctx.fillRect(gp.x - tw * 0.5 - 5, gp.y - 24, tw + 10, 14);
      ctx.fillStyle = "#fde047"; ctx.fillText(lbl, gp.x - tw * 0.5, gp.y - 14);
      ctx.restore();
    }

    // Draw ALL 20-24 cars with side-by-side wheel-to-wheel offsets, spins & damage FX!
    if (R.drawSkidmarks) R.drawSkidmarks(ctx, cr.fx);
    if (R.drawBattleVortices) R.drawBattleVortices(ctx, cr.cars, cr.geom, cr.circuit, cr.cam.zoom);
    if (cr.layers.ai !== false && R.drawAiObservations) R.drawAiObservations(ctx, cr.cars, cr.geom, cr.circuit, cr.cam.zoom, foc);
    cr.carScreenPos = [];
    const labels = [];
    let focusHudInfo = null;
    const drawOrder = cr.cars.slice().sort((a, b) => {
      const wa = (foc && a.idx === foc.idx) ? 2 : (a.isPlayerTeam ? 1 : 0);
      const wb = (foc && b.idx === foc.idx) ? 2 : (b.isPlayerTeam ? 1 : 0);
      return wa - wb;
    });
    drawOrder.forEach((car) => {
      if (car.dnf) return;
      const inPit = car.inPit > 0 && car.pitDuration > 0;
      const pitProgress = inPit ? (1 - Math.max(0, Math.min(1, car.inPit / car.pitDuration))) : null;
      const pose = inPit
        ? R.samplePitLane(cr.geom, pitProgress, car.pitBoxIdx)
        : R.sampleTrack(cr.geom, car.totalProg);
      const lat = inPit ? 0 : (car.latOffset || 0);
      const wx = pose.x + (pose.nx || 0) * lat;
      const wy = pose.y + (pose.ny || 0) * lat;
      const ang = Math.atan2(pose.ty, pose.tx);
      const isFocused = foc && car.idx === foc.idx;
      const comp = COMPOUNDS[car.compound] || COMPOUNDS.medium;
      const drsOpen = !inPit && cr.drsEnabled && car.inDrsRange && crIsInDrsZone(car.totalProg);
      const ersHot = !inPit && car.ersMode === "overtake" && car.ers > 6;
      const harvesting = !inPit && car.ersMode === "harvest";

      const telemRaw = R.computeCarTelemetry(cr.geom, cr.circuit, car.totalProg, {
        car, inPit, drsOpen, ersHot, wetness: cr.wetness, vscActive: cr.vscLaps > 0, scActive: cr.safetyCarLaps > 0,
      });
      const motion = R.computeSmoothCarMotion(car, pose, telemRaw, cr.lastDt || 0.016, inPit);
      const telem = motion.telem;
      car.liveKph = telem.kph;
      car.liveGear = telem.gear;

      const playerLivery = car.isPlayerTeam && DATA.player_team ? getTeamLiveryCfg(DATA.player_team) : null;
      const defaultEra = (DATA.state && DATA.state.era === "legends") ? "1990s" : "2020s";
      R.drawMiniF1Car(ctx, wx, wy, motion.angle, car.color, comp.color, {
        isPlayer: isFocused,
        isTeammate: car.isPlayerTeam && !isFocused,
        ersHot,
        harvesting,
        drsOpen,
        braking: telem.braking,
        brake: telem.brake,
        steerAngle: motion.steerAngle,
        yawSlip: 0,
        tcamYellow: (car.idx % 2 === 1),
        pitProgress,
        wetness: cr.wetness,
        spinAngle: car.spinAngle || 0,
        wingDamaged: !!car.wingDamaged,
        inPit,
        zoom: cr.cam.zoom,
        teamName: car.teamName || "",
        livery: playerLivery,
        era: playerLivery ? playerLivery.era : defaultEra,
      });

      if (isFocused) {
        focusHudInfo = {
          code: car.code3,
          color: car.color,
          pos: car.pos || 1,
          compColor: comp.color,
          tyreTemp: car.tyreTemp || 96,
          drsOpen,
          ersHot,
          telem,
          aiObs: car.aiObs || null,
        };
      }

      const sp = R.worldToScreen(cr.cam, wx, wy, cssW, cssH);
      cr.carScreenPos.push({ x: sp.x, y: sp.y, driverId: car.driverId });
      if (sp.x > -30 && sp.x < cssW + 30 && sp.y > -20 && sp.y < cssH + 20) {
        const lblOff = cr.cam.zoom >= 4.0 ? 22 : (cr.cam.zoom > 1.5 ? 17 : 11);
        labels.push({
          x: sp.x + lblOff,
          y: sp.y - 4,
          pos: car.pos,
          code: car.code3,
          color: car.color,
          compColor: comp.color,
          drsOpen,
          isFocused,
          isTeam: car.isPlayerTeam,
          inPit,
        });
      }
    });

    // Collision Sparks, Carbon Debris, Tyre Smoke & Shockwave FX!
    R.stepAndDrawFx(ctx, cr.fx, cr.paused ? 0 : (cr.lastDt || 0.016), cr.cam.zoom);
    ctx.restore();

    // Screen-Space De-overlap driver pills (shared F1RaceEngine)
    ENG.drawDeoverlappedLabels(ctx, labels, cssW, cssH);

    // F1 TV Broadcast Telemetry Halo & 5-Red-Lights-Out Start Gantry
    if (cr.layers.hud !== false && focusHudInfo && R.drawBroadcastTelemetryHud) {
      R.drawBroadcastTelemetryHud(ctx, focusHudInfo, cssW, cssH);
    }
    if (R.drawStartLightsOverlay) {
      R.drawStartLightsOverlay(ctx, cr.startSeq || cr.raceClock, cssW, cssH);
    }

    // Picture-in-Picture Full Circuit Radar when zoomed into a wheel-to-wheel fight!
    if (cr.cam.zoom > 1.15) {
      R.drawMiniMapPiP(ctx, cr.geom, cr.cars, (c) => foc && c.idx === foc.idx, cssW, cssH);
    }
  }

  function renderCrHud() {
    const sorted = ENG.sortRaceStandings(cr.cars, cr.finished);
    const leader = sorted[0];
    sorted.forEach((c, i) => {
      c.pos = i + 1;
      c.intervalS = i > 0 && !c.dnf ? Math.max(0.05, (sorted[i - 1].totalProg - c.totalProg) * cr.circuit.base_lap_s) : 0;
      c.inDrsRange = i > 0 && c.intervalS <= 1.05 && c.inPit === 0 && !c.finishedRace;
    });

    // SHOW ALL DRIVERS FROM THE CAREER (F1 Manager Multi-Mode Timing Tower!)
    const cntEl = getEl("cr-grid-count");
    if (cntEl) cntEl.textContent = `(${sorted.length})`;
    const foc = getFocusedCar();
    const TT = window.F1TimingTower;
    if (TT) {
      TT.updateTableHeaders(getEl("cr-timing-table"), cr.gapMode);
      const towerRows = sorted.map((c) => ({
        idx: c.idx,
        code3: c.code3,
        name: c.cleanName,
        color: c.color,
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
        isTeam: c.isPlayerTeam,
        drsOpen: !!(c.inDrsRange && cr.drsEnabled && !c.dnf && !c.finishedRace),
        gridPos: c.gridPos || (c.idx + 1),
        lastLapTime: c.lastLapTime || c.currentLapS,
        bestLapS: c.bestLapS || c.currentLapS,
        sectorTimes: c.sectorTimes || [0, 0, 0],
        bestSectors: c.bestSectors || [999, 999, 999],
        confidence: c.confidence ?? 62,
        momentum: c.momentum ?? 0,
      }));
      getEl("cr-timing-body").innerHTML = TT.renderTimingRows({
        sorted: towerRows,
        mode: cr.gapMode,
        circuit: cr.circuit,
        bestSectors: cr.bestSectors,
        fastestLap: { driver: cr.fastestLap.name },
        focusIdx: foc ? foc.idx : -1,
        playerTeamIndices: cr.playerCarIndices,
        onRowClickAttr: "data-cr-car-idx",
      });
    }

    // Compact Rival Telemetry Inspector & Undercut Intelligence Pill (click tower row OR car on map!)
    const rivEl = getEl("cr-rival-pill");
    if (rivEl) {
      const insp = cr.inspectedDriverId ? cr.cars.find((x) => x.driverId === cr.inspectedDriverId) : null;
      if (insp && !insp.isPlayerTeam) {
        const ic = COMPOUNDS[insp.compound] || COMPOUNDS.medium;
        const gapToFoc = foc ? (insp.totalProg - foc.totalProg) * cr.circuit.base_lap_s : 0;
        const gapTxt = gapToFoc >= 0 ? `Ahead +${gapToFoc.toFixed(1)}s` : `Behind ${gapToFoc.toFixed(1)}s`;
        const freshPaceGain = Math.max(0.2, ((100 - insp.tyreLife) * 0.025) + (insp.tyreLife < 40 ? 0.6 : 0));
        let stratTag = "";
        if (foc && gapToFoc > 0 && gapToFoc < 3.6 && insp.tyreLife < 62) {
          stratTag = `<span class="cr-ucut-tag is-open">⚡ UNDERCUT OPEN (+${freshPaceGain.toFixed(1)}s/L)</span>`;
        } else if (foc && gapToFoc < 0 && Math.abs(gapToFoc) < 2.8 && foc.tyreLife < insp.tyreLife - 10) {
          stratTag = `<span class="cr-ucut-tag is-warn">🛡 COVER UNDERCUT</span>`;
        } else if (foc && gapToFoc > 0 && foc.tyreLife > insp.tyreLife + 12) {
          stratTag = `<span class="cr-ucut-tag">📈 OVERCUT VIABLE</span>`;
        }
        rivEl.classList.remove("hidden");
        rivEl.innerHTML = `
          <span class="car-tchip"><i style="background:${esc(insp.color)}"></i><b>P${insp.pos} ${esc(insp.cleanName)}</b></span>
          <span class="muted">${gapTxt}</span>
          <span><span class="sim-tbadge t-${insp.compound}">${ic.code}</span> ${Math.round(insp.tyreLife)}% (${Math.round(insp.tyreTemp || 96)}°C)</span>
          <span>ERS <b>${Math.round(insp.ers)}%</b></span>
          <span>Stints: <b>${esc((insp.stints || [ic.code]).join("→"))}</b></span>
          ${stratTag}
          <button type="button" class="car-btn-xs" id="cr-rival-close" style="padding:1px 5px;">✕</button>
        `;
      } else {
        rivEl.classList.add("hidden");
      }
    }

    // Dual Car Switcher tabs
    cr.playerCarIndices.forEach((idx, slot) => {
      const pc = cr.cars[idx];
      const tab = getEl(`cr-car-tab-${slot}`);
      if (tab && pc) {
        tab.classList.toggle("active", cr.focusSlot === slot);
        tab.innerHTML = `<span>${esc(pc.code3)} · <b>${pc.dnf ? "DNF" : "P" + pc.pos}</b></span><small>${COMPOUNDS[pc.compound].code} ${Math.round(pc.tyreLife)}%${pc.boxNextLap ? " 🔧" : ""}</small>`;
      }
    });

    // Director bar
    const flagEl = getEl("cr-flag-pill");
    if (flagEl) {
      if (cr.finished) { flagEl.className = "sim-flag-pill flag-finish"; flagEl.innerHTML = `<i class="fas fa-flag-checkered"></i> CHEQUERED`; }
      else if (cr.chequeredFlag) { flagEl.className = "sim-flag-pill flag-finish"; flagEl.innerHTML = `<i class="fas fa-flag-checkered"></i> FINISHING (${cr.chequeredFinishedCount}/${cr.chequeredRunningCount})`; }
      else if (cr.safetyCarLaps > 0) { flagEl.className = "sim-flag-pill flag-sc"; flagEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> SC (${cr.safetyCarLaps}L)`; }
      else if (cr.vscLaps > 0) { flagEl.className = "sim-flag-pill flag-sc"; flagEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> VSC`; }
      else if (cr.yellowSector > 0) { flagEl.className = "sim-flag-pill flag-sc"; flagEl.innerHTML = `<i class="fas fa-flag"></i> YELLOW S${cr.yellowSector}`; }
      else { flagEl.className = "sim-flag-pill flag-green"; flagEl.innerHTML = `<i class="fas fa-flag"></i> ${cr.drsEnabled ? "GREEN · DRS ON" : "GREEN FLAG"}`; }
    }
    const lLap = Math.min(cr.totalLaps, Math.max(...cr.cars.map((c) => c.lap)) + 1);
    getEl("cr-dir-lap").textContent = `${String(lLap).padStart(2, "0")} / ${cr.totalLaps}`;
    const pct = Math.round(cr.wetness);
    getEl("cr-weather-text").textContent = cr.wetness >= 60 ? `🌧️ WET ${pct}%` : (cr.wetness >= 22 ? `🌦️ DAMP ${pct}%` : `☀️ DRY ${pct}%`);
    getEl("cr-wet-fill").style.width = `${pct}%`;
    const radEl = getEl("cr-radar-pill");
    if (radEl) {
      // 5-Lap Weather Forecast Strip (L+1 .. L+5 predicted icons!)
      const icons = [];
      for (let step = 1; step <= 5; step++) {
        const lp = lLap + step;
        if (lp > cr.totalLaps) break;
        const projW = cr.wetness + (cr.targetWetness - cr.wetness) * Math.min(1, step * 0.24);
        const ico = projW >= 58 ? "🌧️" : (projW >= 22 ? "🌦️" : "☀️");
        icons.push(`L${lp}${ico}`);
      }
      const isRainIncoming = cr.targetWetness >= 22 || cr.wetness >= 22;
      radEl.textContent = icons.length ? `5L: ${icons.join(" ")}` : "RADAR: FINAL LAP";
      radEl.className = `cr-radar-pill${isRainIncoming ? " radar-rain" : ""}`;
    }

    // Focused Car Strategy Panel
    if (!foc) return;
    const comp = COMPOUNDS[foc.compound] || COMPOUNDS.medium;
    const life = Math.max(0, Math.round(foc.tyreLife));
    getEl("cr-driver-card").style.setProperty("--drv-col", foc.color);
    getEl("cr-p-code").textContent = foc.code3;
    getEl("cr-p-name").textContent = foc.cleanName;
    getEl("cr-p-team").textContent = `${foc.teamName} · Car OVR ${foc.carOverall}`;
    getEl("cr-p-pos").textContent = foc.dnf ? "DNF" : `P${foc.pos}`;
    getEl("cr-p-lap-time").textContent = foc.inPit > 0 ? "IN PIT" : fmtLap(foc.currentLapS);
    const focRank = sorted.findIndex((c) => c === foc);
    const aheadC = focRank > 0 ? sorted[focRank - 1] : null;
    const behindC = focRank >= 0 && focRank < sorted.length - 1 ? sorted[focRank + 1] : null;
    getEl("cr-p-ahead").textContent = !aheadC || foc.dnf ? "▲ RACE LEADER" : `▲ -${Math.max(0.1, (aheadC.totalProg - foc.totalProg) * cr.circuit.base_lap_s).toFixed(1)}s ${aheadC.code3}`;
    getEl("cr-p-behind").textContent = !behindC || behindC.dnf || foc.dnf ? "▼ CLEAR" : `▼ +${Math.max(0.1, (foc.totalProg - behindC.totalProg) * cr.circuit.base_lap_s).toFixed(1)}s ${behindC.code3}`;

    // Live Telemetry Strip
    const kEl = getEl("cr-p-kph"); if (kEl) kEl.textContent = foc.dnf ? "0" : String(foc.liveKph || 0);
    const gEl = getEl("cr-p-gear"); if (gEl) gEl.textContent = foc.dnf ? "N" : `G${foc.liveGear || 5}`;
    const fEl = getEl("cr-p-fuel");
    if (fEl) {
      const fd = Number(foc.fuelDelta || 0);
      fEl.textContent = `${fd >= 0 ? "+" : ""}${fd.toFixed(1)}L`;
      fEl.className = `cr-fuel-pill${fd < 0 ? " fuel-low" : ""}`;
    }
    const sEl = getEl("cr-p-sectors"); if (sEl) sEl.innerHTML = [0, 1, 2].map((s) => `<i class="sd-${foc.sectorColors[s] || "none"}">S${s + 1}</i>`).join("");
    const rEl = getEl("cr-p-rule");
    if (rEl) { const ok = crHasTwoComp(foc); rEl.textContent = ok ? "✓ 2-COMP" : "⚠ 1-COMP"; rEl.className = `sim-rule-pill ${ok ? "rule-ok" : "rule-warn"}`; }

    // Driver Confidence, Momentum & Track Affinity readout
    if (ENG && ENG.confidenceTier) {
      const tier = ENG.confidenceTier(foc.confidence ?? 62);
      const cp = getEl("cr-p-conf");
      if (cp) cp.innerHTML = `CONF <b style="color:${tier.color}">${Math.round(foc.confidence ?? 62)} ${tier.label}</b>`;
      const mv = Math.round(foc.momentum ?? 0);
      const mp = getEl("cr-p-mom");
      if (mp) {
        const mc = mv >= 10 ? "#4ade80" : (mv <= -10 ? "#f87171" : "#cbd5e1");
        mp.innerHTML = `MOM <b style="color:${mc}">${mv >= 0 ? "+" : ""}${mv}</b>`;
      }
      const af = Number(foc.trackAffinity || 0);
      const ap = getEl("cr-p-aff");
      if (ap) {
        const ac = af > 0.25 ? "#4ade80" : (af < -0.25 ? "#f87171" : "#cbd5e1");
        ap.innerHTML = `TRK <b style="color:${ac}">${af >= 0 ? "+" : ""}${af.toFixed(1)}</b>`;
      }
    }

    // Double-Stack Warning if both team cars are boxed on same lap within 4.5s!
    const dsEl = getEl("cr-dstack-alert");
    if (dsEl) {
      const p0 = cr.cars[cr.playerCarIndices[0]], p1 = cr.cars[cr.playerCarIndices[1]];
      const bothBox = p0 && p1 && !p0.dnf && !p1.dnf && p0.boxNextLap && p1.boxNextLap && Math.abs(p0.totalProg - p1.totalProg) * cr.circuit.base_lap_s < 4.8;
      dsEl.classList.toggle("hidden", !bothBox);
    }

    getEl("cr-p-tyre").innerHTML = `<span class="sim-tbadge t-${foc.compound}">${comp.code}</span> ${life}%`;
    const tmpEl = getEl("cr-p-temp");
    if (tmpEl) {
      const t = Math.round(foc.tyreTemp || 98);
      tmpEl.textContent = `${t}°C`;
      tmpEl.className = `sim-temp-tag ${t > 114 ? "temp-hot" : (t < 84 ? "temp-cold" : "temp-opt")}`;
    }
    const tyreCareM = Math.max(0.72, 1.0 - (foc.rd.tyre_care - 70) * 0.008);
    const wMult = (0.65 + cr.circuit.tyre_wear * 0.18) * comp.wear * tyreCareM * (foc.paceMode === "push" ? 1.38 : (foc.paceMode === "conserve" ? 0.68 : 1.0));
    const lCliff = Math.max(0, (foc.tyreLife - 22) / (wMult * 9.2));
    getEl("cr-p-cliff").textContent = foc.tyreLife < 22 ? "CLIFF!" : `~${lCliff.toFixed(1)}L to cliff`;
    getEl("cr-p-tyre-bar").style.width = `${life}%`;
    getEl("cr-p-tyre-bar").style.background = life < 25 ? "#ef4444" : (life < 50 ? "#f59e0b" : "#22c55e");
    getEl("cr-p-ers").textContent = `${Math.round(foc.ers)}%`;
    getEl("cr-p-ers-flow").textContent = foc.ersMode === "overtake" ? "-34%/L OVT" : (foc.ersMode === "harvest" ? "+28%/L HARV" : "+6%/L AUTO");
    getEl("cr-p-ers-bar").style.width = `${Math.round(foc.ers)}%`;
    getEl("cr-pit-loss-tag").textContent = `Pit Loss ${effectivePitLossForCar(foc).toFixed(1)}s`;

    document.querySelectorAll("[data-cr-pace]").forEach((b) => b.classList.toggle("active", b.dataset.crPace === foc.paceMode));
    document.querySelectorAll("[data-cr-ers]").forEach((b) => b.classList.toggle("active", b.dataset.crErs === foc.ersMode));
    document.querySelectorAll("[data-cr-risk]").forEach((b) => b.classList.toggle("active", b.dataset.crRisk === (foc.riskMode || "standard")));
    document.querySelectorAll("[data-cr-comp]").forEach((b) => b.classList.toggle("active", b.dataset.crComp === foc.boxCompound));

    const pitLoss = effectivePitLossForCar(foc);
    const rProg = foc.totalProg - pitLoss / cr.circuit.base_lap_s;
    const ahead = cr.cars.filter((c) => !c.dnf && c.idx !== foc.idx && c.totalProg > rProg).length;
    getEl("cr-rejoin-pred").textContent = `REJOIN ~P${ahead + 1} (${foc.code3})`;
    const bBtn = getEl("cr-box-btn");
    bBtn.classList.toggle("is-armed", foc.boxNextLap);
    bBtn.innerHTML = foc.boxNextLap
      ? `<i class="fas fa-wrench"></i> BOX CONFIRMED (${COMPOUNDS[foc.boxCompound].code}) — CANCEL`
      : `<i class="fas fa-wrench"></i> BOX ${esc(foc.code3)} → ${COMPOUNDS[foc.boxCompound].name.toUpperCase()}`;
  }

  function stepCrSim(dt) {
    if (!cr.running || cr.paused || cr.finished || cr.simToEndActive) return;
    ENG.runFixedSubsteps(dt, cr.speedMult, 0.08, (subDt) => stepCrCore(subDt, false));
  }

  function runCrSimToEnd() {
    if (!cr.running || cr.finished || cr.simToEndActive) return;
    cr.paused = false;
    cr.simToEndActive = true;
    const ovl = getEl("cr-simtoend-ovl");
    const bar = getEl("cr-ste-bar");
    const sub = getEl("cr-ste-sub");
    if (ovl) ovl.classList.remove("hidden");
    const pump = () => {
      if (!cr.simToEndActive || cr.finished || !cr.running) {
        cr.simToEndActive = false;
        if (ovl) ovl.classList.add("hidden");
        renderCrHud();
        drawCrCanvas();
        return;
      }
      for (let i = 0; i < 80; i++) {
        if (!stepCrCore(0.08, true)) break;
      }
      const lLap = Math.min(cr.totalLaps, Math.max(...cr.cars.map((c) => c.lap), 0) + 1);
      const pct = Math.min(100, Math.round((lLap / Math.max(1, cr.totalLaps)) * 100));
      if (bar) bar.style.width = `${pct}%`;
      if (sub) sub.textContent = `Lap ${lLap} / ${cr.totalLaps} (${pct}%)`;
      if (cr.finished) {
        cr.simToEndActive = false;
        if (ovl) ovl.classList.add("hidden");
      } else {
        requestAnimationFrame(pump);
      }
    };
    requestAnimationFrame(pump);
  }

  function stepCrCore(dt, fastMode) {
    if (!cr.running || cr.finished) return false;
    const simDt = dt * (cr.circuit.base_lap_s / 22.0);

    // FIA 5-Red-Lights Standing Start Sequence (0 kph grid hold -> randomized hold -> LIGHTS OUT!)
    if (cr.startSeq && cr.startSeq.active && window.F1TrackArchitect) {
      const sRes = window.F1TrackArchitect.stepStandingStart(cr.startSeq, cr.cars, dt, fastMode);
      if (sRes.newLight > 0 && !fastMode) {
        if (window.F1Sfx && window.F1Sfx.startLight) window.F1Sfx.startLight(sRes.newLight);
        const rEl = getEl("cr-radio-latest");
        if (rEl) rEl.textContent = `🔴 ${"●".repeat(sRes.newLight)}${"○".repeat(5 - sRes.newLight)} — Hold clutch on the grid at ${cr.circuit.name}…`;
      }
      if (sRes.lightsOutNow) {
        if (!fastMode && window.F1Sfx) window.F1Sfx.lightsOut();
        const rEl = getEl("cr-radio-latest");
        if (rEl) rEl.textContent = `🟢 LIGHTS OUT at ${cr.circuit.name} (${cr.cars.length}-car grid)! Command BOTH ${DATA.player_team.name} cars (Tab to switch)!`;
      }
      if (sRes.holding) {
        return false;
      }
    }

    cr.raceClock += simDt;

    const leaderLap = Math.max(...cr.cars.map((c) => c.lap), 0);
    cr.gripPct = Math.min(100, 38 + (leaderLap / Math.max(1, cr.totalLaps)) * 62);
    if (cr.yellowTimer > 0) { cr.yellowTimer -= dt; if (cr.yellowTimer <= 0) cr.yellowSector = 0; }

    const shouldDrs = leaderLap >= 1 && cr.wetness < 20 && cr.safetyCarLaps === 0 && cr.vscLaps === 0;
    if (shouldDrs && !cr.drsEnabled && !cr.drsAnnounced && leaderLap >= 1) {
      cr.drsAnnounced = true;
      getEl("cr-radio-latest").textContent = "🟢 FIA Race Control: DRS ENABLED!";
    }
    cr.drsEnabled = shouldDrs;

    if (cr.weatherMode === "dynamic" || cr.weatherMode === "showers") {
      cr.rainTimer -= dt;
      if (cr.rainTimer <= 0) {
        cr.rainTimer = 15 + Math.random() * 12;
        const ch = cr.weatherMode === "showers" ? 0.65 : (cr.circuit.rain_chance / 100);
        cr.targetWetness = Math.random() < ch ? (Math.random() < 0.4 ? 76 : 40) : 0;
        if (cr.targetWetness >= 30) getEl("cr-radio-latest").textContent = `🌧️ Weather Radar: Rain showers approaching ${cr.circuit.name}!`;
      }
      const prevW = cr.wetness;
      cr.wetness += (cr.targetWetness - cr.wetness) * Math.min(1, dt * 0.14);
      cr.drying = cr.wetness < prevW - 0.01;
    }

    const prevLeaderLap = leaderLap;
    cr.cars.forEach((car) => {
      if (car.dnf || car.finishedRace) return;
      if (!car.isPlayerTeam) {
        car.paceMode = (car.tyreLife < 26 || car.tyreTemp > 113) ? "conserve" : (car.pos <= 5 ? "push" : "balanced");
        car.ersMode = car.ers > 58 && car.pos > 1 ? "overtake" : (car.ers < 24 ? "harvest" : "auto");
      }
      car._prevLap = car.lap;
      car._prevSec = Math.floor((((car.totalProg % 1) + 1) % 1) * 3);
      if (cr.safetyCarLaps > 0 && !car.dnf && car.inPit <= 0) {
        car.currentLapS = computeCrLapTime(car);
      }
      if (car.inPit > 0) {
        car.inPit -= simDt;
        if (car.inPit <= 0) {
          car.inPit = 0; car.pitDuration = 0;
          car.compound = car.nextCompound; car.tyreLife = 100;
          const exitT = { soft: 74, medium: 66, hard: 56, inter: 64, wet: 58 };
          car.tyreTemp = exitT[car.compound] || 66;
          car.stops += 1;
          car.lastPitLap = car.lap;
          if (!Array.isArray(car.stints)) car.stints = [COMPOUNDS[car.compound].code];
          car.stints.push(COMPOUNDS[car.compound].code);
          if (Array.isArray(car.stintHistory)) {
            const lastSt = car.stintHistory[car.stintHistory.length - 1];
            if (lastSt) lastSt.endLap = Math.max(lastSt.startLap, car.lap);
            car.stintHistory.push({ compound: car.compound, startLap: car.lap + 1, endLap: cr.totalLaps });
          }
          if (COMPOUNDS[car.compound].wet > 0) car.usedWet = true;
          else car.dryCompoundsUsed.add(car.compound);
          if (car.isPlayerTeam && !fastMode) {
            getEl("cr-radio-latest").textContent = `🔧 ${car.cleanName} exits pits on fresh ${COMPOUNDS[car.compound].name} tyres!`;
            if (window.F1Sfx) window.F1Sfx.pitStop();
          }
          if (cr.telemetry) cr.telemetry.addEvent(car.lap + 1, "pit", `${car.code3} Pit Stop`, `Switched to ${COMPOUNDS[car.compound].name}`, car.idx);
        }
      }
    });

    const R = window.F1TrackRenderer;
    let incidents = [];
    if (R && cr.geom) {
      if (!cr.fx) cr.fx = R.createFxState();
      const lNow = Math.max(...cr.cars.map((c) => c.lap), 0);
      incidents = R.stepBattlePhysics(cr.cars, cr.geom, cr.circuit, cr.fx, {
        dt,
        simDt,
        raceClock: cr.raceClock,
        speedMult: cr.speedMult,
        wetness: cr.wetness,
        leaderLap: lNow,
        totalLaps: cr.totalLaps,
        scActive: cr.safetyCarLaps > 0,
        vscActive: cr.vscLaps > 0,
        yellowSector: cr.yellowSector,
        drsEnabled: cr.drsEnabled,
      });
    }

    cr.cars.forEach((car) => {
      if (car.dnf || car.inPit > 0 || car.finishedRace) return;

      const prevLap = car._prevLap != null ? car._prevLap : car.lap;
      const prevSec = car._prevSec != null ? car._prevSec : Math.floor((((car.totalProg % 1) + 1) % 1) * 3);
      if (!R || !cr.geom) {
        car.totalProg += (1.0 / car.currentLapS) * simDt;
      }
      car.lap = Math.floor(car.totalProg);
      const curSec = Math.floor((((car.totalProg % 1) + 1) % 1) * 3);

      if (curSec !== prevSec && car.lap >= 1) {
        const sTime = (car.currentLapS / 3) * (0.97 + Math.random() * 0.06);
        if (!car.sectorTimes) car.sectorTimes = [0, 0, 0];
        car.sectorTimes[prevSec] = sTime;
        if (sTime < cr.bestSectors[prevSec] && cr.safetyCarLaps === 0 && cr.vscLaps === 0) {
          cr.bestSectors[prevSec] = sTime; car.bestSectors[prevSec] = sTime; car.sectorColors[prevSec] = "purple";
          ENG.applyPsychologyEvent(car, "purple_sector");
        } else if (sTime < car.bestSectors[prevSec]) {
          car.bestSectors[prevSec] = sTime; car.sectorColors[prevSec] = "green";
          ENG.applyPsychologyEvent(car, "pb_sector");
        } else {
          car.sectorColors[prevSec] = "yellow";
        }
      }

      const comp = COMPOUNDS[car.compound] || COMPOUNDS.medium;
      const optT = comp.wet === 2 ? 80 : (comp.wet === 1 ? 88 : 100);
      const reRating = Number((((DATA.state || {}).staff || {}).race_engineer || {}).rating || 75);
      const heatMit = car.isPlayerTeam ? Math.max(0.72, 1.0 - (reRating - 72) * 0.01) : 1.0;
      const targetT = cr.safetyCarLaps > 0 ? 78 : (optT + (car.paceMode === "push" ? 16 * heatMit : (car.paceMode === "conserve" ? -12 : 0)) - cr.wetness * 0.12);
      car.tyreTemp += (targetT - car.tyreTemp) * Math.min(1, dt * 0.22);

      const setupWearMult = car.isPlayerTeam ? Math.max(0.88, 1.0 - ((cr.setupConf || 70) - 70) * 0.0035) : 1.0;
      const tyreCareMult = Math.max(0.72, 1.0 - (car.rd.tyre_care - 70) * 0.008) * setupWearMult * (car.isPlayerTeam && cr.teamOrder === "hold" ? 0.93 : 1.0);
      const f1dbDegM = Number(cr.circuitF1db?.tyreDegradation?.tyreDegMultiplier || 1.0);
      const wearMult = (0.65 + cr.circuit.tyre_wear * 0.18) * (0.55 + 0.45 * f1dbDegM) * comp.wear * tyreCareMult * (car.tyreTemp > 114 ? 1.25 : 1.0) * (car.paceMode === "push" ? 1.38 : (car.paceMode === "conserve" ? 0.68 : 1.0));
      car.tyreLife = Math.max(5, car.tyreLife - wearMult * (simDt / cr.circuit.base_lap_s) * 9.2);

      // Live Fuel Delta for player cars
      if (car.isPlayerTeam) {
        const fuelRate = car.paceMode === "push" ? -0.22 : (car.paceMode === "conserve" ? 0.26 : 0.01);
        car.fuelDelta = Math.max(-1.8, Math.min(2.8, (car.fuelDelta ?? 0.4) + fuelRate * (simDt / cr.circuit.base_lap_s)));
      }

      const ersLab = 1.0 + ((car.facilities.powertrain_lab || 1) - 1) * 0.10;
      if (car.ersMode === "overtake") car.ers = Math.max(0, car.ers - (simDt / cr.circuit.base_lap_s) * 34);
      else if (car.ersMode === "harvest") car.ers = Math.min(100, car.ers + (simDt / cr.circuit.base_lap_s) * 28 * ersLab);
      else car.ers = Math.min(100, car.ers + (simDt / cr.circuit.base_lap_s) * 6 * ersLab);

      if (car.lap > prevLap) {
        car.lastLapTime = car.currentLapS;
        if (car.lap >= 2 && car.currentLapS < (car.bestLapS || 999) && cr.safetyCarLaps === 0 && cr.vscLaps === 0) {
          car.bestLapS = car.currentLapS;
        }
        if (car.currentLapS < cr.fastestLap.time && cr.safetyCarLaps === 0 && cr.vscLaps === 0 && car.lap >= 2) {
          cr.fastestLap = { time: car.currentLapS, driverId: car.driverId, name: car.cleanName };
        }
        // Per-lap confidence & risk mistake dynamics
        if (ENG && ENG.getDriverBehaviorModifiers) {
          const beh = ENG.getDriverBehaviorModifiers(car, cr.wetness);
          if (car.inDrsRange && cr.safetyCarLaps === 0) {
            car.dirtyAirLaps = (car.dirtyAirLaps || 0) + 1;
            if (car.dirtyAirLaps >= 3) ENG.applyPsychologyEvent(car, "dirty_air");
          } else {
            car.dirtyAirLaps = 0;
            ENG.applyPsychologyEvent(car, "clean_lap");
          }
          const mProb = 0.01 * beh.mistakeMult * (cr.wetness >= 30 ? 1.35 : 1.0);
          if (car.lap >= 2 && cr.safetyCarLaps === 0 && Math.random() < mProb) {
            const lossS = 0.8 + Math.random() * 1.2;
            car.totalProg -= lossS / cr.circuit.base_lap_s;
            ENG.applyPsychologyEvent(car, "mistake");
            if (car.isPlayerTeam && !fastMode) {
              getEl("cr-radio-latest").textContent = `💨 ${car.cleanName} locked up under braking (-${lossS.toFixed(1)}s, confidence dropped)!`;
              if (cr.radio) {
                cr.radio.emit("mistake", { code3: car.code3, name: car.cleanName, color: car.color, confidence: car.confidence, engineer: car.engineer, lap: car.lap }, {
                  lap: car.lap + 1,
                  actions: [{
                    label: "🎧 Calm Driver (+Conf)",
                    onClick: () => {
                      ENG.applyPsychologyEvent(car, "radio_calm");
                      getEl("cr-radio-latest").textContent = `📻 Pit Wall calmed ${car.cleanName} down — confidence recovering!`;
                      renderCrHud();
                    },
                  }],
                }, true);
              }
            }
            if (cr.telemetry) cr.telemetry.addEvent(car.lap + 1, "mistake", `${car.code3} Lock-up`, `Lost ${lossS.toFixed(1)}s`, car.idx);
          }
        }
        if (ENG && ENG.stepComponentWear) {
          const compAlerts = ENG.stepComponentWear(car, cr.circuit, ENG.DEFAULT_ERA_RULES, { totalLaps: cr.totalLaps, wetness: cr.wetness });
          compAlerts.forEach((al) => {
            const rType = `comp_${al.comp}`;
            const rObj = { idx: car.idx, code3: car.code3, name: car.cleanName, color: car.color, confidence: car.confidence, engineer: car.engineer, eng: car.eng, lap: car.lap };
            const rCtx = { lap: al.lap, health: al.health, temp: al.temp, kphLoss: al.kphLoss, severity: al.severity, component: al.comp, feedbackQuality: car.eng?.feedback?.score || 72 };
            if (cr.telemetry) cr.telemetry.addEvent(al.lap, "component", `${car.code3} ${al.label} (${al.health}%)`, al.kphLoss ? `Losing ~${al.kphLoss} kph on straights (+${al.paceLossS}s/L)` : `Wear alert (+${al.paceLossS}s/L)`, car.idx);
            if (cr.radio) {
              if (!fastMode && (car.isPlayerTeam || car.pos <= 4)) cr.radio.emit(rType, rObj, rCtx, car.isPlayerTeam && al.severity === "critical");
              else if (cr.telemetry && cr.radio.buildMessage) {
                const m = cr.radio.buildMessage(rType, rObj, rCtx);
                cr.telemetry.addRadio({ lap: al.lap, carIdx: car.idx, code3: car.code3, speaker: m.speaker, to: m.to, color: car.color, category: "mechanical", component: al.comp, severity: al.severity, text: m.text, engReply: m.engReply || "", feedbackQuality: rCtx.feedbackQuality });
              }
            }
            if (car.isPlayerTeam && !fastMode) {
              getEl("cr-radio-latest").textContent = `🔧 ${car.code3} RADIO: ${al.label} wear (${al.health}%${al.kphLoss ? `, -${al.kphLoss} kph straight-line` : ""})!`;
            }
          });
        }
        if (car.lap >= cr.totalLaps || cr.chequeredFlag) {
          const completedLaps = Math.min(cr.totalLaps, car.lap);
          if (completedLaps >= cr.totalLaps && !crHasTwoComp(car)) {
            car.timePenaltyS = (car.timePenaltyS || 0) + 20;
          }
          car.finishedRace = true;
          car.finishLaps = completedLaps;
          car.finishTimeS = cr.raceClock;
          car.boxNextLap = false;
          if (!cr.chequeredFlag) {
            cr.chequeredFlag = true;
            cr.chequeredStartS = cr.raceClock;
            cr.allUnlappedDoneAt = null;
            getEl("cr-radio-latest").textContent = `🏁 ${car.cleanName} TAKES THE CHEQUERED FLAG! Remaining cars racing to the line!`;
            if (!fastMode && window.F1Sfx) window.F1Sfx.checkered();
          }
          return;
        }
        // Occasional FIA +5s Track Limits Penalty or Front Wing Endplate Scrape (adds authentic Pit Wall drama!)
        if (car.isPlayerTeam && car.lap >= 3 && car.lap < cr.totalLaps - 2) {
          if (!car.timePenaltyS && car.paceMode === "push" && Math.random() < 0.014) {
            car.timePenaltyS = 5;
            getEl("cr-radio-latest").textContent = `🚩 FIA STEWARDS: +5s Track Limits Penalty for ${car.cleanName} (applied at checkered flag)!`;
            if (window.F1Sfx) window.F1Sfx.alert();
          } else if (!car.wingDamaged && car.inDrsRange && car.paceMode === "push" && Math.random() < 0.016) {
            car.wingDamaged = true;
            showRadioAction(`⚠ ${car.code3} clipped a kerb — Front Wing endplate damaged (+0.55s/L)! Box & Swap Wing (+6s)?`, `Box & Repair ${car.code3}`, () => {
              car.boxNextLap = true; car.fixWingOnPit = true; renderCrHud();
            });
          }
        }
        const dnfScale = Math.max(0.45, 1.0 - ((car.facilities.powertrain_lab || 1) - 1) * 0.08);
        const dnfChance = (car.driver.stats.dnf_rate / 100) / Math.max(14, cr.totalLaps * 1.6) * dnfScale * 0.35;
        if (car.lap >= 2 && Math.random() < dnfChance) {
          car.dnf = true;
          car.breakdownKind = "engine";
          car.parkedProg = ((car.totalProg % 1) + 1) % 1;
          const nearSf = car.parkedProg < 0.12 || car.parkedProg > 0.88;
          const pitSide = (cr.geom && cr.geom.pitSide) || 1;
          car.parkedSide = nearSf ? -pitSide : (car.idx % 2 === 0 ? 1 : -1);
          car.parkedYawOff = car.parkedSide * 0.36;
          car.smokeActive = true;
          car.cleared = false;
          const sec = Math.floor((((car.totalProg % 1) + 1) % 1) * 3) + 1;
          cr.yellowSector = sec; cr.yellowTimer = 6.5;
          getEl("cr-radio-latest").textContent = `💨 YELLOW S${sec} — ${car.cleanName} pulls off smoking with mechanical failure!`;
          if (cr.safetyCarLaps === 0 && cr.vscLaps === 0) {
            const roll = Math.random();
            const cirRfP = Number(cr.circuitF1db?.incidents?.redFlagProbability ?? 0.08);
            const cirScM = Number(cr.circuitF1db?.incidents?.safetyCarMultiplier ?? 1.0);
            const rfThresh = Math.min(0.26, Math.max(0.05, 0.04 + cirRfP * 0.55));
            const scThresh = Math.min(0.82, rfThresh + 0.36 * cirScM);
            if (!cr.redFlagUsed && car.lap >= 3 && car.lap <= cr.totalLaps - 3 && roll < rfThresh) {
              cr.redFlagUsed = true;
              cr.redFlagCount += 1;
              triggerRedFlag(car);
            } else if (roll < scThresh) {
              cr.safetyCarLaps = 2;
              cr.scCount += 1;
              const pCar = getFocusedCar();
              if (pCar && !pCar.dnf && !pCar.boxNextLap && pCar.tyreLife < 72) {
                const rec = cr.wetness >= 22 ? "inter" : (pCar.compound === "soft" ? "medium" : "hard");
                showRadioAction(`📻 Safety Car! Cheap pit stop window for ${pCar.code3} → ${COMPOUNDS[rec].name}?`, `Box ${pCar.code3} (${COMPOUNDS[rec].code})`, () => {
                  pCar.boxCompound = rec; pCar.boxNextLap = true; renderCrHud();
                });
              }
            } else if (roll < 0.78) {
              cr.vscLaps = 1;
              cr.vscCount += 1;
            }
          }
          return;
        }
        const pLoss = effectivePitLossForCar(car);
        if (car.isPlayerTeam && car.boxNextLap) {
          // Authentic Stationary Pit Crew Timer (1.85s purple record -> 4.9s sticky wheel gun!) + Double-Stack + Wing Swap!
          const teammate = cr.cars.find((o) => o.isPlayerTeam && o.idx !== car.idx && !o.dnf);
          const isDstack = teammate && teammate.inPit > 0;
          const sdRating = Number((((DATA.state || {}).staff || {}).sporting_dir || {}).rating || 74);
          const pitLvl = Number((car.facilities && car.facilities.pit_sim) || 1);
          const baseStopS = Math.max(1.88, 2.75 - (pitLvl - 1) * 0.16 - Math.max(0, sdRating - 72) * 0.015 + (Math.random() - 0.5) * 0.35);
          const slowStop = Math.random() < Math.max(0.03, (96 - sdRating) * 0.004) ? (1.4 + Math.random() * 1.4) : 0;
          const wingExtra = car.fixWingOnPit ? 6.0 : 0;
          const stopTimerS = Number((baseStopS + slowStop + wingExtra).toFixed(2));
          if (!wingExtra && (!cr.bestPitS || stopTimerS < cr.bestPitS)) cr.bestPitS = stopTimerS;
          const totalPit = pLoss + (isDstack ? 3.2 : 0) + slowStop + wingExtra;
          car.inPit = totalPit; car.pitDuration = totalPit; car.nextCompound = car.boxCompound; car.boxNextLap = false;
          if (car.fixWingOnPit) { car.wingDamaged = false; car.fixWingOnPit = false; }
          const compNm = (COMPOUNDS[car.nextCompound] || COMPOUNDS.medium).name.toUpperCase();
          if (wingExtra > 0) {
            showCrPitBanner(`🔧 WING SWAP · ${car.code3}`, `${stopTimerS.toFixed(1)}s → ${compNm}`, "warn");
            getEl("cr-radio-latest").textContent = `🔧 ${car.cleanName} boxed for Front Wing replacement + fresh ${compNm} (${stopTimerS.toFixed(1)}s)!`;
          } else if (isDstack) {
            showCrPitBanner(`⚠ DOUBLE STACK · ${car.code3}`, `${stopTimerS.toFixed(2)}s (+3.2s hold) → ${compNm}`, "warn");
            getEl("cr-radio-latest").textContent = `⚠ DOUBLE STACK! ${car.cleanName} held +3.2s behind teammate in pit box!`;
          } else if (slowStop > 0.5) {
            showCrPitBanner(`⚠ STICKY WHEEL NUT · ${car.code3}`, `${stopTimerS.toFixed(2)}s → ${compNm}`, "warn");
            getEl("cr-radio-latest").textContent = `🔧 Slow wheel-gun on ${car.cleanName} (${stopTimerS.toFixed(2)}s stop)!`;
          } else {
            const isPurple = stopTimerS <= 2.25;
            showCrPitBanner(`${isPurple ? "⚡ PURPLE STOP" : "🔧 PIT STOP"} · ${car.code3}`, `${stopTimerS.toFixed(2)}s → ${compNm}`, isPurple ? "purple" : "ok");
          }
        } else if (!car.isPlayerTeam) {
          const wantW = cr.wetness >= 60 ? "wet" : (cr.wetness >= 22 ? "inter" : null);
          const wrong = (wantW && car.compound !== wantW) || (!wantW && (car.compound === "inter" || car.compound === "wet"));
          const mustRule = !car.usedWet && car.dryCompoundsUsed.size < 2 && (cr.totalLaps - car.lap <= 4);
          if (wrong || mustRule || car.tyreLife < 26) {
            car.inPit = pLoss; car.pitDuration = pLoss;
            if (wantW) car.nextCompound = wantW;
            else {
              const pref = cr.totalLaps - car.lap <= 5 ? "soft" : "medium";
              car.nextCompound = (car.dryCompoundsUsed.has(pref) && car.dryCompoundsUsed.size === 1) ? (pref === "medium" ? "hard" : "medium") : pref;
            }
          }
        }
        car.currentLapS = computeCrLapTime(car);
      }
    });

    // Team Order: HOLD POSITIONS discipline
    if (cr.teamOrder === "hold" && cr.playerCarIndices.length >= 2) {
      const a = cr.cars[cr.playerCarIndices[0]], b = cr.cars[cr.playerCarIndices[1]];
      if (a && b && !a.dnf && !b.dnf && a.inPit === 0 && b.inPit === 0) {
        const gap = Math.abs(a.totalProg - b.totalProg) * cr.circuit.base_lap_s;
        if (gap < 0.45) {
          const behind = a.totalProg < b.totalProg ? a : b;
          const ahead = behind === a ? b : a;
          behind.totalProg = Math.min(behind.totalProg, ahead.totalProg - 0.45 / cr.circuit.base_lap_s);
        }
      }
    }

    // Process FIA Stewards & Incident Events returned by Physics v2
    if (R && cr.geom) {
      incidents.forEach((ev) => {
        const a = ev.chaser, b = ev.target;
        const corner = (cr.circuit.corners && cr.circuit.corners.length)
          ? cr.circuit.corners[Math.floor(Math.random() * cr.circuit.corners.length)]
          : `Sector ${ev.sector}`;
        if (ev.type === "fia_breach") {
          getEl("cr-radio-latest").textContent = `⚖️ FIA STEWARDS: ${ev.culprit.cleanName} — ${ev.fiaRule} (${ev.verdict})!`;
        } else if (ev.type === "contact") {
          getEl("cr-radio-latest").textContent = `💥 WHEEL-TO-WHEEL CONTACT! ${a.cleanName} & ${b.cleanName} bang wheels at ${corner}!`;
        } else if (ev.type === "spin") {
          cr.yellowSector = ev.sector; cr.yellowTimer = 5.0;
          const penTxt = ev.penaltyS ? ` (+${ev.penaltyS}s FIA Penalty!)` : "";
          const damagedPlayer = a.isPlayerTeam && a.wingDamaged ? a : (b.isPlayerTeam && b.wingDamaged ? b : null);
          if (damagedPlayer) {
            showRadioAction(`🌀 COLLISION & WING DAMAGE on ${damagedPlayer.code3} at ${corner}${penTxt}! Box & Swap Wing (+6s)?`, `Box & Repair ${damagedPlayer.code3}`, () => {
              damagedPlayer.boxNextLap = true; damagedPlayer.fixWingOnPit = true; renderCrHud();
            });
          } else {
            getEl("cr-radio-latest").textContent = `🌀 SPIN at ${corner}! Contact between ${a.cleanName} & ${b.cleanName}${penTxt}`;
          }
          if (window.F1Sfx) window.F1Sfx.alert();
        } else if (ev.type === "crash") {
          cr.yellowSector = ev.sector; cr.yellowTimer = 7.0;
          if (cr.safetyCarLaps === 0) { cr.safetyCarLaps = 2; cr.scCount += 1; }
          getEl("cr-radio-latest").textContent = `🚨 HEAVY COLLISION at ${corner}! ${a.cleanName} & ${b.cleanName} collide — SAFETY CAR DEPLOYED!`;
          if (window.F1Sfx) window.F1Sfx.alert();
        }
      });
    }

    // Evaluate FIA Chequered Flag Completion (end only once all unlapped cars cross the line!)
    if (cr.chequeredFlag && !cr.finished) {
      const finStatus = ENG.evaluateChequeredCompletion(
        cr.cars,
        cr.totalLaps,
        cr.raceClock,
        cr.chequeredStartS,
        cr.allUnlappedDoneAt,
        cr.circuit.base_lap_s,
      );
      cr.chequeredFinishedCount = finStatus.finishedCount;
      cr.chequeredRunningCount = finStatus.runningCount;
      cr.allUnlappedDoneAt = finStatus.allUnlappedDoneAt;
      if (finStatus.done) {
        cr.finished = true;
        cr.running = false;
        finalizeLiveCareerRace();
        return false;
      }
    }

    const newL = Math.max(...cr.cars.map((c) => c.lap));
    if (cr.wetness >= 22) cr.hadWet = true;
    if (newL > prevLeaderLap) {
      if (cr.safetyCarLaps > 0) cr.safetyCarLaps -= 1;
      if (cr.vscLaps > 0) cr.vscLaps -= 1;
      // Record Lap-by-Lap Position Telemetry Snapshot!
      const sortedSnap = cr.cars.slice().sort((a, b) => (a.dnf !== b.dnf ? (a.dnf ? 1 : -1) : b.totalProg - a.totalProg));
      const snapPos = {};
      sortedSnap.forEach((c, idx) => { snapPos[c.driverId] = idx + 1; });
      cr.lapHistory.push({ lap: newL, positions: snapPos, sc: cr.safetyCarLaps > 0 || cr.vscLaps > 0, rf: false });
      if (cr.telemetry) {
        cr.telemetry.recordLapSnapshot(newL, sortedSnap, {
          wetness: cr.wetness,
          scActive: cr.safetyCarLaps > 0,
          vscActive: cr.vscLaps > 0,
        });
      }

      // Skip interactive popups & autosave spam while fast-forwarding in Sim-to-End
      if (!fastMode) {
        // Planned Strategy Target Pit Window Reminder!
        if (cr.targetPitPlan && newL === cr.targetPitPlan.pitLap) {
          const focPlan = getFocusedCar();
          const nxtC = cr.targetPitPlan.next || "medium";
          if (focPlan && !focPlan.dnf && !focPlan.boxNextLap && focPlan.stops === 0) {
            showRadioAction(`📻 Strategy Window Open (L${newL})! Box ${focPlan.code3} for ${COMPOUNDS[nxtC].name}s as planned?`, `Box ${focPlan.code3} → ${COMPOUNDS[nxtC].code}`, () => {
              focPlan.boxCompound = nxtC; focPlan.boxNextLap = true; renderCrHud();
            });
          }
        }

        // Crash/refresh-proof per-lap autosave to SQLite!
        if (newL < cr.totalLaps) autosaveMidRace();

        // Interactive Race Engineer Rain Crossover Prompt!
        const focCar = getFocusedCar();
        if (focCar && !focCar.dnf && !focCar.boxNextLap) {
          if (cr.wetness >= 25 && COMPOUNDS[focCar.compound].wet === 0) {
            const wantW = cr.wetness >= 60 ? "wet" : "inter";
            showRadioAction(`📻 Track turning wet (${Math.round(cr.wetness)}%)! Box ${focCar.code3} for ${COMPOUNDS[wantW].name}s?`, `Box ${focCar.code3} → ${COMPOUNDS[wantW].code}`, () => {
              focCar.boxCompound = wantW; focCar.boxNextLap = true; renderCrHud();
            });
          } else if (cr.wetness < 14 && COMPOUNDS[focCar.compound].wet > 0) {
            showRadioAction(`📻 Track drying! Switch ${focCar.code3} back to Medium slicks?`, `Box ${focCar.code3} → M`, () => {
              focCar.boxCompound = "medium"; focCar.boxNextLap = true; renderCrHud();
            });
          }
        }

        // Optional High-Stakes 3D Braking-Zone Duel Cut-In (max 1/race, final 3 laps, P1-P3 fight within 0.65s!)
        if (cr.duelEnabled && !cr.duelUsed && newL >= Math.max(2, cr.totalLaps - 3) && newL < cr.totalLaps && cr.safetyCarLaps === 0 && cr.vscLaps === 0) {
          for (let idx = 1; idx <= Math.min(3, sortedSnap.length - 1); idx++) {
            const chaser = sortedSnap[idx], target = sortedSnap[idx - 1];
            const gapS = (target.totalProg - chaser.totalProg) * cr.circuit.base_lap_s;
            if (chaser.isPlayerTeam && !target.isPlayerTeam && !chaser.dnf && !target.dnf && chaser.inPit === 0 && gapS <= 0.68) {
              cr.duelUsed = true;
              launchCareer3DDuel(chaser, target);
              break;
            }
          }
        }
      } else {
        // In Sim-to-End mode, let pit wall auto-box player cars on weather crossover / tyre cliff / 2-compound rule!
        cr.playerCarIndices.forEach((pIdx) => {
          const pc = cr.cars[pIdx];
          if (!pc || pc.dnf || pc.inPit > 0 || pc.boxNextLap) return;
          const wantW = cr.wetness >= 60 ? "wet" : (cr.wetness >= 22 ? "inter" : null);
          const wrong = (wantW && pc.compound !== wantW) || (!wantW && (pc.compound === "inter" || pc.compound === "wet"));
          const mustRule = !pc.usedWet && pc.dryCompoundsUsed.size < 2 && (cr.totalLaps - pc.lap <= 3);
          if (wrong || mustRule || pc.tyreLife < 24) {
            pc.boxNextLap = true;
            if (wantW) pc.boxCompound = wantW;
            else {
              const pref = cr.totalLaps - pc.lap <= 5 ? "soft" : "medium";
              pc.boxCompound = (pc.dryCompoundsUsed.has(pref) && pc.dryCompoundsUsed.size === 1) ? (pref === "medium" ? "hard" : "medium") : pref;
            }
          }
        });
      }
    }

    if (!fastMode) {
      const now = performance.now();
      if (now - cr.lastUiSync > 160) {
        cr.lastUiSync = now;
        renderCrHud();
      }
    }
    return cr.running && !cr.finished;
  }

  function showCrPitBanner(title, sub, kind) {
    const el = getEl("cr-pit-banner");
    if (!el) return;
    el.className = `cr-pit-banner pit-${kind || "ok"}`;
    el.innerHTML = `<strong>${esc(title)}</strong><span>${esc(sub)}</span>`;
    el.classList.remove("hidden");
    if (cr.pitBannerTimer) clearTimeout(cr.pitBannerTimer);
    cr.pitBannerTimer = setTimeout(() => { el.classList.add("hidden"); }, 4200);
  }

  function showRadioAction(msg, btnLabel, onAccept) {
    if (window.F1Sfx) window.F1Sfx.radioBeep();
    getEl("cr-radio-latest").textContent = msg;
    const box = getEl("cr-radio-actions");
    if (!box) return;
    box.innerHTML = `<button type="button" class="car-btn-xs car-btn-gold" id="cr-ra-yes">✓ ${esc(btnLabel)}</button><button type="button" class="car-btn-xs" id="cr-ra-no">✕</button>`;
    box.classList.remove("hidden");
    clearTimeout(cr.radioActionTimer);
    const hide = () => { box.classList.add("hidden"); box.innerHTML = ""; };
    getEl("cr-ra-yes")?.addEventListener("click", () => { onAccept(); hide(); });
    getEl("cr-ra-no")?.addEventListener("click", hide);
    cr.radioActionTimer = setTimeout(hide, 8000);
  }

  function triggerRedFlag(crashedCar) {
    cr.paused = true;
    if (window.F1Sfx) window.F1Sfx.alert();
    if (cr.lapHistory.length) cr.lapHistory[cr.lapHistory.length - 1].rf = true;
    const p0 = cr.cars[cr.playerCarIndices[0]], p1 = cr.cars[cr.playerCarIndices[1]];
    getEl("car-rf-desc").textContent = `Multi-car incident involving ${crashedCar.cleanName} brought out the Red Flag! Pick FREE fresh tyres for both cars before the Standing Restart.`;
    const defComp = cr.wetness >= 60 ? "wet" : (cr.wetness >= 22 ? "inter" : "soft");
    if (p0) { getEl("rf-lbl-0").textContent = `Car #1 (${p0.code3}) Free Tyres`; getEl("rf-tyre-0").value = defComp; }
    if (p1) { getEl("rf-lbl-1").textContent = `Car #2 (${p1.code3}) Free Tyres`; getEl("rf-tyre-1").value = defComp; }
    getEl("car-redflag-modal").classList.remove("hidden");
  }

  let duelTimerInt = null;
  function launchCareer3DDuel(playerCar, rivalCar) {
    cr.paused = true;
    const mod = getEl("car-duel-modal");
    const verEl = getEl("car-duel-verdict");
    const chEl = getEl("car-duel-choices");
    const tEl = getEl("car-duel-timer");
    if (!mod) { cr.paused = false; return; }
    verEl.classList.add("hidden");
    chEl.classList.remove("hidden");
    getEl("car-duel-matchup").innerHTML = `
      <span style="color:${esc(playerCar.color)}"><b>${esc(playerCar.code3)}</b> ${esc(playerCar.cleanName)} (P${playerCar.pos})</span>
      <span class="muted">vs</span>
      <span style="color:${esc(rivalCar.color)}"><b>${esc(rivalCar.code3)}</b> ${esc(rivalCar.cleanName)} (P${rivalCar.pos})</span>
    `;
    mod.classList.remove("hidden");

    // Render quick 3D side-by-side braking-zone duel preview using F1Car3D!
    const cv = getEl("car-duel-3d-canvas");
    let animStop = false;
    if (cv && window.THREE && window.F1Car3D) {
      try {
        const era = (DATA.state && DATA.state.era === "legends") ? "1990s" : "2020s";
        const ren = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
        ren.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        ren.setSize(cv.clientWidth || 520, cv.clientHeight || 200, false);
        const sc = new THREE.Scene();
        sc.environment = F1Car3D.createStudioEnvironment(ren);
        F1Car3D.addStudioLights(sc, playerCar.color);
        const c1 = F1Car3D.createCar({ main: playerCar.color, secondary: "#111622", accent: "#facc15", pop: "#ffffff", detail: "#262c36" }, "two-tone", era);
        const c2 = F1Car3D.createCar({ main: rivalCar.color, secondary: "#111622", accent: "#ffffff", pop: "#ffffff", detail: "#262c36" }, "modern", era);
        c1.position.set(-1.15, 0, -0.35);
        c2.position.set(1.15, 0, 0.35);
        sc.add(c1); sc.add(c2);
        const cam = new THREE.PerspectiveCamera(32, (cv.clientWidth || 520) / (cv.clientHeight || 200), 0.1, 60);
        cam.position.set(0, 2.2, 7.6);
        cam.lookAt(0, 0.4, 0);
        let t = 0;
        const step = () => {
          if (animStop) {
            if (F1Car3D.disposeObject) { F1Car3D.disposeObject(c1); F1Car3D.disposeObject(c2); }
            if (sc.environment && sc.environment.dispose) sc.environment.dispose();
            ren.dispose();
            return;
          }
          t += 0.04;
          c1.position.z = -0.35 + Math.sin(t) * 0.45;
          c2.position.z = 0.35 - Math.sin(t * 0.9) * 0.25;
          ren.render(sc, cam);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      } catch (e) {}
    }

    let resolved = false;
    let secsLeft = 5;
    if (tEl) tEl.textContent = `${secsLeft}s`;
    clearInterval(duelTimerInt);
    const resolveDuel = (call) => {
      if (resolved) return;
      resolved = true;
      clearInterval(duelTimerInt);
      chEl.classList.add("hidden");
      const pStat = call === "brake" ? playerCar.driver.stats.clutch : (call === "switchback" ? playerCar.driver.stats.racecraft : playerCar.rd.power);
      const rStat = call === "brake" ? rivalCar.driver.stats.clutch : (call === "switchback" ? rivalCar.driver.stats.racecraft : rivalCar.rd.power);
      const rHeatBonus = (rivalCar.rivalryHeat || 0) >= 50 ? 2.5 : 0;
      const pScore = pStat + playerCar.carOverall * 0.25 + (Math.random() * 14 - 4);
      const rScore = rStat + rivalCar.carOverall * 0.25 + rHeatBonus + (Math.random() * 14 - 5);
      const won = pScore >= rScore;
      if (won) {
        const leadProg = Math.max(playerCar.totalProg, rivalCar.totalProg);
        playerCar.totalProg = leadProg + 0.55 / cr.circuit.base_lap_s;
        rivalCar.totalProg = leadProg - 0.10 / cr.circuit.base_lap_s;
        verEl.innerHTML = `<strong style="color:#4ade80">🔥 OVERTAKE COMPLETE!</strong> ${esc(playerCar.cleanName)} sweeps past ${esc(rivalCar.cleanName)} into the apex!`;
        getEl("cr-radio-latest").textContent = `🔥 WHAT A MOVE! ${playerCar.cleanName} nails the overtake on ${rivalCar.cleanName}!`;
        if (window.F1Profile) window.F1Profile.recordEvent("career_duel_win", {});
      } else {
        playerCar.totalProg = rivalCar.totalProg - 0.38 / cr.circuit.base_lap_s;
        verEl.innerHTML = `<strong style="color:#f87171">🛡 DEFENDED!</strong> ${esc(rivalCar.cleanName)} closes the door — ${esc(playerCar.cleanName)} tucks back in.`;
        getEl("cr-radio-latest").textContent = `📻 ${rivalCar.cleanName} defended hard — stay in DRS range for the next lap!`;
      }
      verEl.classList.remove("hidden");
      renderCrHud();
      setTimeout(() => {
        animStop = true;
        mod.classList.add("hidden");
        cr.paused = false;
      }, 1700);
    };
    duelTimerInt = setInterval(() => {
      secsLeft -= 1;
      if (tEl) tEl.textContent = `${Math.max(0, secsLeft)}s`;
      if (secsLeft <= 0) resolveDuel("brake");
    }, 1000);
    chEl.querySelectorAll("[data-duel-call]").forEach((btn) => {
      btn.onclick = () => resolveDuel(btn.dataset.duelCall);
    });
  }

  function buildMidRaceSnapshot() {
    const lLap = Math.min(cr.totalLaps, Math.max(...cr.cars.map((c) => c.lap), 0) + 1);
    return {
      season_num: DATA.state.season_num,
      round_num: cr.quali ? cr.quali.round : DATA.state.current_round,
      circuit_id: cr.circuit.id,
      lap: lLap,
      total_laps: cr.totalLaps,
      weather_mode: cr.weatherMode,
      wetness: cr.wetness,
      targetWetness: cr.targetWetness,
      gripPct: cr.gripPct,
      drsEnabled: cr.drsEnabled,
      vscLaps: cr.vscLaps,
      safetyCarLaps: cr.safetyCarLaps,
      scCount: cr.scCount,
      vscCount: cr.vscCount,
      redFlagCount: cr.redFlagCount,
      redFlagUsed: cr.redFlagUsed,
      duelUsed: cr.duelUsed,
      hadWet: cr.hadWet,
      teamOrder: cr.teamOrder,
      setupConf: cr.setupConf,
      fastestLap: cr.fastestLap,
      quali: cr.quali,
      playerCarIndices: cr.playerCarIndices,
      cars: cr.cars.map((c) => ({ ...c, dryCompoundsUsed: Array.from(c.dryCompoundsUsed || []) })),
    };
  }

  function autosaveMidRace() {
    if (!cr.active || !cr.running || cr.finished || !cr.cars.length) return;
    fetch("/api/career/race/autosave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot: buildMidRaceSnapshot() }),
    }).catch(() => {});
  }

  function resumeLiveCareerRace(snap) {
    if (!snap || !snap.cars || !snap.cars.length) return;
    cr.quali = snap.quali;
    cr.circuit = circuitById(snap.circuit_id);
    cr.totalLaps = snap.total_laps || 15;
    cr.weatherMode = snap.weather_mode || "dynamic";
    cr.wetness = Number(snap.wetness || 0);
    cr.targetWetness = Number(snap.targetWetness || 0);
    cr.gripPct = Number(snap.gripPct || 50);
    cr.drsEnabled = !!snap.drsEnabled;
    cr.vscLaps = Number(snap.vscLaps || 0);
    cr.safetyCarLaps = Number(snap.safetyCarLaps || 0);
    cr.scCount = Number(snap.scCount || 0);
    cr.vscCount = Number(snap.vscCount || 0);
    cr.redFlagCount = Number(snap.redFlagCount || 0);
    cr.redFlagUsed = !!snap.redFlagUsed;
    cr.duelUsed = !!snap.duelUsed;
    cr.hadWet = !!snap.hadWet;
    cr.teamOrder = snap.teamOrder || "free";
    cr.setupConf = Number(snap.setupConf || 70);
    cr.fastestLap = snap.fastestLap || { time: 999, driverId: null, name: "" };
    cr.playerCarIndices = snap.playerCarIndices || [0, 1];
    cr.cars = snap.cars.map((c) => ({ ...c, dryCompoundsUsed: new Set(c.dryCompoundsUsed || [c.compound]) }));
    cr.finished = false; cr.paused = false; cr.running = true; cr.active = true; cr.focusSlot = 0; cr.staticKey = "";

    getEl("career-hq").classList.add("hidden");
    getEl("career-race-view").classList.remove("hidden");
    getEl("car-quali-panel").classList.add("hidden");
    getEl("car-live-cockpit").classList.remove("hidden");
    document.body.classList.add("sim-cockpit-active");
    getEl("cr-dir-name").textContent = cr.circuit.name;
    getEl("cr-dir-specs").textContent = `${cr.circuit.length_km}km · ${cr.circuit.turns}T · ${cr.circuit.drs_zones} DRS · ${cr.circuit.aero} AERO`;
    getEl("cr-radio-latest").textContent = `▶ RESUMED Round ${snap.round_num} at ${cr.circuit.name} on Lap ${snap.lap}/${cr.totalLaps}!`;
    renderCrHud();
    if (!cr.rafId) cr.rafId = requestAnimationFrame(crLoop);
  }

  async function finalizeLiveCareerRace() {
    cr.simToEndActive = false;
    getEl("cr-simtoend-ovl")?.classList.add("hidden");
    cr.cars.forEach((c) => {
      if (!c.dnf && !c.finishedRace) {
        c.finishedRace = true;
        c.finishLaps = Math.min(cr.totalLaps - 1, Math.max(0, Math.floor(c.totalProg || 0)));
        c.finishTimeS = cr.raceClock + (1 - ((c.totalProg || 0) % 1)) * cr.circuit.base_lap_s;
      }
    });
    const sorted = ENG.sortRaceStandings(cr.cars, true);
    let recorderPayload = null;
    if (cr.telemetry) {
      cr.telemetry.setFinished(true);
      cr.telemetry.recordLapSnapshot(cr.totalLaps, sorted, { wetness: cr.wetness, scActive: false, vscActive: false });
      const finalMeta = sorted.map((c, i) => ({
        idx: c.idx, code3: c.code3, name: c.cleanName, team: c.teamName, color: c.color,
        finishPos: i + 1, dnf: c.dnf, dnfReason: c.dnfReason || "", stintHistory: c.stintHistory || [],
        confidence: c.confidence, peakConfidence: c.peakConfidence, minConfidence: c.minConfidence,
        momentum: c.momentum, overtakesMade: c.overtakesMade, mistakesCount: c.mistakesCount,
        totalPitDelayS: c.totalPitDelayS, bestLapS: c.bestLapS,
        components: c.components, compIssues: c.compIssues, compPaceLossS: c.compPaceLossS, compKphLoss: c.compKphLoss, eng: c.eng,
      }));
      recorderPayload = cr.telemetry.exportPayload(finalMeta, { raceFinished: true });
      window.F1_CAREER_LAST_TELEMETRY = recorderPayload;
    }
    const standings = sorted.map((c, i) => ({
      driver_id: c.driverId,
      pos: i + 1,
      dnf: c.dnf,
      stops: c.stops || 0,
      stints: Array.isArray(c.stints) && c.stints.length ? c.stints : [COMPOUNDS[c.compound]?.code || "M"],
    }));
    const res = await postJson("/api/career/race/commit", {
      standings,
      fastest_lap_driver_id: cr.fastestLap.driverId,
      telemetry: {
        weather_summary: cr.hadWet ? "Wet / Changing" : "Dry",
        is_wet: cr.hadWet,
        sc_count: cr.scCount,
        vsc_count: cr.vscCount,
        red_flag_count: cr.redFlagCount,
        best_pit_s: cr.bestPitS || null,
        lap_history: cr.lapHistory || [],
        recorder_payload: recorderPayload,
      },
    });
    if (window.F1Sfx) window.F1Sfx.checkered();
    DATA = res;
    cr.active = false;
    showPostRaceDebrief(res.debrief);
  }

  async function startLiveCareerRace() {
    if (!cr.quali) return;
    // If player clicked Lights Out before completing Q3, finalize grid cleanly first!
    if (cr.quali.stage && cr.quali.stage !== "done") {
      await runCareerQualifying("full");
    }
    getEl("car-quali-panel").classList.add("hidden");
    getEl("car-live-cockpit").classList.remove("hidden");
    document.body.classList.remove("car-hq-active");
    document.body.classList.add("sim-cockpit-active");

    cr.totalLaps = parseInt(getEl("car-q-laps").value, 10) || 15;
    cr.weatherMode = getEl("car-q-weather").value || "dynamic";
    cr.wetness = cr.weatherMode === "rain" ? 76 : (cr.weatherMode === "showers" ? 28 : 0);
    cr.targetWetness = cr.wetness;
    cr.drying = false;
    cr.rainTimer = 10;
    cr.gripPct = 38;
    cr.drsEnabled = false;
    cr.drsAnnounced = false;
    cr.vscLaps = 0;
    cr.safetyCarLaps = 0;
    cr.yellowSector = 0;
    cr.yellowTimer = 0;
    cr.scCount = 0;
    cr.vscCount = 0;
    cr.redFlagCount = 0;
    cr.redFlagUsed = false;
    cr.duelUsed = false;
    cr.hadWet = cr.wetness >= 22;
    cr.lapHistory = [];
    cr.inspectedDriverId = null;
    cr.bestPitS = null;
    cr.carScreenPos = [];
    cr.fx = window.F1TrackRenderer ? window.F1TrackRenderer.createFxState() : null;
    getEl("cr-pit-banner")?.classList.add("hidden");
    renderSfxBtn();
    cr.bestSectors = [999, 999, 999];
    cr.raceClock = 0;
    cr.fastestLap = { time: 999, driverId: null, name: "" };
    cr.finished = false;
    cr.chequeredFlag = false;
    cr.chequeredStartS = 0;
    cr.allUnlappedDoneAt = null;
    cr.chequeredFinishedCount = 0;
    cr.chequeredRunningCount = 0;
    cr.paused = false;
    cr.running = true;
    cr.active = true;
    cr.focusSlot = 0;
    cr.staticKey = "";

    // Ensure full circuit geometry is loaded & fetch historical Per-Track × Era balance
    if (cr.circuit && (!Array.isArray(cr.circuit.points) || cr.circuit.points.length < 3)) {
      try { cr.circuit = await ENG.fetchCircuit(cr.circuit.id); } catch (_) {}
    }
    let balData = null;
    try {
      const eraKey = (DATA.state && DATA.state.era === "legends") ? "1990s" : "2026";
      const br = await fetch(`/api/sim/balance?circuit_id=${encodeURIComponent(cr.circuit.id)}&era_key=${encodeURIComponent(eraKey)}`);
      if (br.ok) balData = await br.json();
    } catch (_) {}
    const drvAff = (balData && balData.driver_affinity) || {};
    const teamAff = (balData && balData.team_affinity) || {};
    const drvPsych = (balData && balData.driver_psychology) || {};
    const drvDnaMap = (balData && balData.driver_dna) || {};
    cr.circuitF1db = (balData && balData.circuit_f1db) || null;
    cr.simToEndActive = false;
    getEl("cr-simtoend-ovl")?.classList.add("hidden");

    const liveWet0 = (cr.weatherMode === "real_live" && wkCtx.radarData && wkCtx.radarData.radar && wkCtx.radarData.radar.timeline && wkCtx.radarData.radar.timeline[0])
      ? Number(wkCtx.radarData.radar.timeline[0].wetness_pct || 0) : null;
    if (liveWet0 != null) {
      cr.wetness = liveWet0;
      cr.targetWetness = liveWet0;
    }
    const startComp = cr.wetness >= 60 ? "wet" : (cr.wetness >= 22 ? "inter" : "medium");
    const pStart0 = getEl("car-start-tyre-0")?.value || "auto";
    const pStart1 = getEl("car-start-tyre-1")?.value || "auto";
    const fpTyreBonus = (wkCtx.data && Number(wkCtx.data.tyre_life_bonus_pct || 0)) || 0;
    const freshBonus = (cr.quali.saved_fresh_soft ? 4 : 0) + fpTyreBonus;
    cr.teamOrder = "free";
    document.querySelectorAll("[data-cr-order]").forEach((b) => b.classList.toggle("active", b.dataset.crOrder === "free"));
    cr.playerCarIndices = [];
    let pSlotCounter = 0;
    cr.cars = cr.quali.grid.map((g, i) => {
      let comp = i < 6 && startComp === "medium" ? "soft" : startComp;
      if (g.is_player_team) {
        cr.playerCarIndices.push(i);
        const chosen = pSlotCounter === 0 ? pStart0 : pStart1;
        if (chosen && chosen !== "auto" && COMPOUNDS[chosen]) comp = chosen;
        pSlotCounter += 1;
      }
      const isWet = COMPOUNDS[comp].wet > 0;
      const dKey = String(g.clean_name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const tKey = String(g.team_name || "").toLowerCase();
      const aff = Number(drvAff[dKey] || 0) + Number(teamAff[tKey] || 0) * 0.65;
      const engObj = window.F1RadioEngine ? window.F1RadioEngine.assignEngineer(g.team_name, i % 2) : null;
      const car = {
        idx: i,
        engineer: engObj,
        dna: drvDnaMap[dKey] || null,
        eraKey: (DATA.state && DATA.state.era === "legends") ? "1990s" : "2026",
        driverId: g.driver_id,
        cleanName: g.clean_name,
        code3: g.code3,
        teamName: g.team_name,
        color: g.color,
        isPlayerTeam: g.is_player_team,
        rivalryHeat: Number(g.rivalry_heat || 0),
        carOverall: g.car_overall,
        rd: g.rd,
        facilities: g.facilities,
        driver: g.driver_data,
        pos: i + 1,
        gridPos: i + 1,
        lap: 0,
        totalProg: -0.0055 * i,
        latOffset: (i % 2 === 0 ? -2.4 : 2.4),
        compound: comp,
        nextCompound: comp,
        boxCompound: comp === "soft" ? "medium" : "hard",
        boxNextLap: false,
        dryCompoundsUsed: new Set(isWet ? [] : [comp]),
        stints: [COMPOUNDS[comp].code],
        stintHistory: [{ compound: comp, startLap: 1, endLap: cr.totalLaps }],
        usedWet: isWet,
        tyreLife: Math.min(104, 100 + (g.is_player_team && comp === "soft" ? freshBonus : 0)),
        tyreTemp: 96,
        fuelDelta: 0.4,
        ers: 65,
        stops: 0,
        lastPitLap: 0,
        inPit: 0,
        pitDuration: 0,
        timePenaltyS: 0,
        wingDamaged: false,
        fixWingOnPit: false,
        dnf: false,
        inDrsRange: false,
        intervalS: 0,
        liveKph: 185,
        liveGear: 4,
        lastLapTime: cr.circuit.base_lap_s,
        bestLapS: 999,
        sectorTimes: [0, 0, 0],
        bestSectors: [999, 999, 999],
        sectorColors: ["none", "none", "none"],
        paceMode: "balanced",
        ersMode: "auto",
        riskMode: "standard",
        currentLapS: cr.circuit.base_lap_s,
      };
      ENG.initDriverPsychology(car, drvPsych[dKey], aff, g.is_player_team ? cr.setupConf : 70);
      if (ENG.initCarEngineering) {
        ENG.initCarEngineering(car, cr.circuit, {
          experience: 55 + ((g.driver && g.driver.seasons) || 3) * 4,
          overall: (g.driver && g.driver.overall) || 76,
          poolHealth: g.is_player_team ? 94 : 95,
        });
      }
      car.currentLapS = computeCrLapTime(car);
      return car;
    });

    cr.telemetry = ENG.createTelemetryRecorder(
      cr.circuit,
      cr.cars.map((c) => ({
        idx: c.idx, code3: c.code3, name: c.cleanName, team: c.teamName,
        color: c.color, isTeam: c.isPlayerTeam, persona: c.persona, trackAffinity: c.trackAffinity, engineer: c.engineer, dna: c.dna,
      })),
      cr.totalLaps,
      ENG.DEFAULT_ERA_RULES
    );
    cr.telemetry.recordLapSnapshot(0, cr.cars, { wetness: cr.wetness, scActive: false, vscActive: false });

    // Initialize FIA 5-Red-Lights Standing Start Sequence (0 kph grid + Per-Driver Launch DNA!)
    cr.startSeq = window.F1TrackArchitect
      ? window.F1TrackArchitect.createStandingStartState(cr.cars, cr.circuit)
      : null;

    getEl("cr-dir-name").textContent = cr.circuit.name;
    getEl("cr-dir-specs").textContent = `${cr.circuit.length_km}km · ${cr.circuit.turns}T · ${cr.circuit.drs_zones} DRS · ${cr.circuit.aero} AERO · Track ${cr.circuit.track_temp_c || 32}°C`;
    getEl("cr-radio-latest").textContent = cr.startSeq
      ? `🔴 CARS ON THE GRID at ${cr.circuit.name} (${cr.cars.length}-car grid) — waiting for 5 red lights!`
      : `🟢 LIGHTS OUT at ${cr.circuit.name} (${cr.cars.length}-car grid)! Command BOTH ${DATA.player_team.name} cars (Tab to switch)!`;
    if (!cr.startSeq && window.F1Sfx) window.F1Sfx.lightsOut();
    renderCrHud();
    if (!cr.rafId) cr.rafId = requestAnimationFrame(crLoop);
  }

  function crLoop(ts) {
    cr.rafId = requestAnimationFrame(crLoop);
    if (!cr.active) { cr.lastTs = ts; return; }
    if (!cr.lastTs) cr.lastTs = ts;
    const dt = Math.min(0.06, Math.max(0.001, (ts - cr.lastTs) / 1000));
    cr.lastTs = ts;
    cr.lastDt = dt;
    if (cr.running && !cr.paused) stepCrSim(dt);
    if (cr.b3d && cr.b3d.isActive()) {
      const foc = getFocusedCar();
      const insp = cr.inspectedDriverId ? cr.cars.find((x) => x.driverId === cr.inspectedDriverId && !x.dnf) : null;
      const targetCar = insp || foc || cr.cars[0];
      const sorted3d = ENG.sortRaceStandings(cr.cars, cr.finished);
      cr.b3d.updateAndRender({
        circuit: cr.circuit,
        cars: cr.cars.map((c) => ({
          idx: c.idx, code3: c.code3, team: c.teamName, pos: c.pos, totalProg: c.totalProg, latOffset: c.latOffset,
          inPit: c.inPit, pitDuration: c.pitDuration, pitBoxIdx: c.pitBoxIdx, dnf: c.dnf, color: c.color,
          wingDamaged: !!c.wingDamaged, parkedProg: c.parkedProg, parkedSide: c.parkedSide, parkedYawOff: c.parkedYawOff,
          breakdownKind: c.breakdownKind, smokeActive: c.smokeActive, cleared: !!c.cleared,
          liveKph: c.livePhysKph != null ? c.livePhysKph : c.liveKph, liveGear: c.liveGear, liveLongG: c.liveLongG || 0,
          compound: c.compound, drsOpen: !!(c.inDrsRange && cr.drsEnabled && !c.dnf && !c.finishedRace),
          finishedRace: !!c.finishedRace,
          fuelKg: Math.max(8, (1 - (c.lap / Math.max(1, cr.totalLaps))) * 95),
          setupRideHeight: c.eng && c.eng.actual ? c.eng.actual.rideHeight : null,
          setupAeroBalance: c.eng && c.eng.actual ? c.eng.actual.aeroBalance : null,
          balanceBias: c.eng ? c.eng.balanceBias : 0,
          floorHealth: c.components && c.components.floor ? c.components.floor.health : 95,
          suspHealth: c.components && c.components.suspension ? c.components.suspension.health : 95,
        })),
        raceState: {
          eraKey: (DATA && DATA.state && DATA.state.era === "legends") ? "1990s" : "2026",
          lap: Math.min(cr.totalLaps, Math.max(1, (sorted3d[0]?.lap || 0) + 1)),
          totalLaps: cr.totalLaps,
          wetness: cr.wetness,
          scActive: cr.safetyCarLaps > 0,
          scInThisLap: cr.safetyCarLaps === 1,
          vscActive: cr.vscLaps > 0,
          yellowSector: cr.yellowSector,
          chequered: cr.chequeredFlag || cr.finished,
          startSeq: cr.startSeq,
          top3: sorted3d.slice(0, 3).map((x) => ({ code3: x.code3, color: x.color || "#e10600" })),
        },
        focusIdx: targetCar ? targetCar.idx : 0,
        dt,
        paused: cr.paused,
      });
    } else {
      drawCrCanvas();
    }
    if (window.F1Sfx && window.F1Sfx.updateTelemetry) {
      const fCar = getFocusedCar() || cr.cars[0];
      window.F1Sfx.updateTelemetry({
        active: cr.running && !cr.finished,
        paused: cr.paused,
        speedMult: cr.speedMult,
        speedKph: fCar ? (fCar.livePhysKph || fCar.liveKph || 215) : 210,
        wetness: cr.wetness,
        eraKey: (DATA && DATA.state && DATA.state.era === "legends") ? "1990s" : "2026",
        camMode: (cr.b3d && cr.b3d.isActive()) ? "tv" : "2d",
        inPit: fCar ? fCar.inPit > 0 : false,
        chequered: cr.chequeredFlag,
        battleClose: !!(fCar && fCar.intervalS > 0 && fCar.intervalS < 0.8),
      });
    }
  }

  // =========================================================================
  // EVENT BINDINGS
  // =========================================================================
  getEl("wiz-team").addEventListener("change", (ev) => {
    getEl("wiz-custom-box").classList.toggle("hidden", ev.target.value !== "__custom__");
  });

  getEl("wiz-launch-btn").addEventListener("click", async () => {
    const btn = getEl("wiz-launch-btn");
    btn.disabled = true;
    try {
      DATA = await postJson("/api/career/new", {
        era: getEl("wiz-era").value,
        calendar_len: getEl("wiz-calendar").value,
        team_choice: getEl("wiz-team").value,
        custom_team_name: getEl("wiz-custom-name").value,
        custom_color: getEl("wiz-custom-color").value,
        budget_tier: getEl("wiz-budget-tier").value,
      });
      renderAll();
      showHqToast(`Signed as Team Principal of ${DATA.player_team.name}!`, true);
    } catch (err) {
      showHqToast(err.message, false);
    } finally {
      btn.disabled = false;
    }
  });

  getEl("wiz-custom-season-btn")?.addEventListener("click", () => {
    if (!window.F1CustomSeason) return;
    window.F1CustomSeason.open({
      onLaunch: async (cfg) => {
        try {
          DATA = await postJson("/api/career/new", {
            era: cfg.era_key && ["1950s", "1960s", "1970s", "1980s", "1990s"].includes(cfg.era_key) ? "legends" : "2026",
            calendar_len: String(Math.max(8, Math.min(24, (cfg.calendar || []).length || 12))),
            team_choice: getEl("wiz-team").value,
            custom_team_name: getEl("wiz-custom-name").value,
            custom_color: getEl("wiz-custom-color").value,
            budget_tier: getEl("wiz-budget-tier").value,
            slot_name: cfg.name,
            custom_season: cfg,
          });
          renderAll();
          showHqToast(`Launched Custom Season Career: ${cfg.name} (${DATA.state.calendar.length} Rounds)!`, true);
        } catch (err) {
          showHqToast(err.message, false);
        }
      },
    });
  });

  getEl("wiz-cancel-btn").addEventListener("click", () => {
    if (DATA.has_career) {
      getEl("career-wizard").classList.add("hidden");
      getEl("career-hq").classList.remove("hidden");
      document.body.classList.add("car-hq-active");
    }
  });

  getEl("car-new-btn").addEventListener("click", () => {
    getEl("career-hq").classList.add("hidden");
    document.body.classList.remove("car-hq-active");
    getEl("career-wizard").classList.remove("hidden");
    getEl("wiz-cancel-btn").classList.remove("hidden");
  });

  // Delegated Post-Race Press Conference Media Pen handler (works in both HQ Dashboard & Debrief Modal!)
  document.addEventListener("click", async (ev) => {
    const mBtn = ev.target.closest("[data-media-idx]");
    if (!mBtn) return;
    mBtn.disabled = true;
    const res = await postJson("/api/career/media/respond", { choice_idx: Number(mBtn.dataset.mediaIdx) });
    DATA = res;
    const debBox = getEl("car-deb-media-box");
    if (debBox) debBox.innerHTML = `<div style="color:#86efac;font-weight:700;">🎙 ${esc(res.message)}</div>`;
    renderAll();
    showHqToast(res.message, res.ok);
  });

  // Click any car directly on the GPS Track Map to inspect rival & Undercut Intelligence!
  getEl("cr-track-canvas")?.addEventListener("pointerdown", (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    if (!cr.active || !Array.isArray(cr.carScreenPos)) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    let hit = null, bestD = 28;
    cr.carScreenPos.forEach((p) => {
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < bestD) { bestD = d; hit = p.driverId; }
    });
    if (hit) {
      cr.inspectedDriverId = cr.inspectedDriverId === hit ? null : hit;
      renderCrHud();
      drawCrCanvas();
    }
  });

  // HQ Tab navigation + 3D Lab + Analytics + Sub-tabs + Site Nav & Banter Mode
  document.querySelectorAll("[data-car-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.carTab;
      document.querySelectorAll("[data-car-tab]").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".car-tab-pane").forEach((p) => p.classList.toggle("active", p.id === `car-tab-${activeTab}`));
      if (activeTab === "standings") requestAnimationFrame(drawWccChart);
      if (activeTab === "dashboard") {
        requestAnimationFrame(syncDash3DCar);
        requestAnimationFrame(syncTrackHolo3D);
      } else {
        if (hqCampus3D) hqCampus3D.stop();
        if (trackHolo3D) trackHolo3D.stop();
        stopDash3DLoop();
      }
      if (activeTab === "rd") requestAnimationFrame(syncRdBlueprint3D);
      else if (rdBlueprint3D) rdBlueprint3D.stop();
      if (activeTab === "analytics" || activeTab === "stewards") refreshCareerAnalytics();
    });
  });

  // Sub-tabs inside Dashboard, R&D 3D Lab, and FIA Stewards Room (keeps every room zero-scroll!)
  [
    ["data-dash-sub", "car-dash-sub-"],
    ["data-rd-sub", "car-rd-sub-"],
    ["data-stew-sub", "car-stew-sub-"],
  ].forEach(([attr, prefix]) => {
    document.querySelectorAll(`[${attr}]`).forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute(attr);
        const bar = btn.closest(".car-subtabs");
        if (bar) bar.querySelectorAll(`[${attr}]`).forEach((b) => { b.classList.toggle("active", b === btn); b.classList.toggle("car-btn-red", b === btn); });
        const panel = btn.closest(".car-panel");
        if (panel) panel.querySelectorAll(".car-subpane").forEach((sp) => sp.classList.toggle("active", sp.id === `${prefix}${key}`));
        if (attr === "data-stew-sub" && key === "architect") {
          ensureRegArchitectMounted(lastAnalyticsPayload);
        }
        if (attr === "data-stew-sub" && key === "politics" && lastAnalyticsPayload) {
          renderPaddockPolitics(lastAnalyticsPayload);
        }
      });
    });
  });

  // Hovering or clicking any of the 6 R&D Blueprint cards focuses the 3D X-Ray Car Camera onto that component!
  getEl("car-rd-parts-grid")?.addEventListener("mouseover", (ev) => {
    const btn = ev.target.closest("[data-rd-part], [data-mfg-comp]");
    const compId = btn ? (btn.dataset.rdPart || btn.dataset.mfgComp) : null;
    if (compId && rdBlueprint3D) rdBlueprint3D.focusComponent(compId);
  });
  getEl("car-rd-parts-grid")?.addEventListener("mouseleave", () => {
    if (rdBlueprint3D) rdBlueprint3D.focusComponent(null);
  });

  // Toggle Website Top Navigation Bar in Full-Screen Career Game Mode
  getEl("car-site-nav-toggle")?.addEventListener("click", () => {
    document.body.classList.toggle("car-site-nav-open");
  });

  // Banter Mode selector (Strict | Authentic F1 | Spicy Memes)
  const banterSel = getEl("car-banter-sel");
  if (banterSel && window.F1RadioEngine && window.F1RadioEngine.getBanterMode) {
    banterSel.value = window.F1RadioEngine.getBanterMode();
    banterSel.addEventListener("change", () => {
      window.F1RadioEngine.setBanterMode(banterSel.value);
      showHqToast(`Driver Dialogue Mode: ${banterSel.options[banterSel.selectedIndex].text}`, true);
    });
  }

  // Market search & filters
  getEl("car-mkt-search").addEventListener("input", renderMarket);
  getEl("car-mkt-filter").addEventListener("change", renderMarket);

  // Delegated HQ actions (Scout, Express Scout, Offer, R&D, Facility, Sponsor)
  getEl("career-hq").addEventListener("click", async (ev) => {
    const scBtn = ev.target.closest("[data-scout-id]");
    if (scBtn) {
      const res = await postJson("/api/career/scout/assign", { driver_id: scBtn.dataset.scoutId, express: false });
      DATA = res; renderAll(); showHqToast(res.message, res.ok); return;
    }
    const exBtn = ev.target.closest("[data-express-id]");
    if (exBtn) {
      const res = await postJson("/api/career/scout/assign", { driver_id: exBtn.dataset.expressId, express: true });
      DATA = res; renderAll(); showHqToast(res.message, res.ok); return;
    }
    const ofBtn = ev.target.closest("[data-offer-id]");
    if (ofBtn) { openOfferModal(ofBtn.dataset.offerId); return; }

    const rdBtn = ev.target.closest("[data-rd-part]");
    if (rdBtn) {
      const wtHrs = Number(getEl("car-atr-wt-slider")?.value || 0);
      const cfdItems = Number(getEl("car-atr-cfd-slider")?.value || 0);
      const res = await postJson("/api/career/rd/start", { part_id: rdBtn.dataset.rdPart, mode: rdBtn.dataset.rdMode, wt_hrs: wtHrs, cfd_items: cfdItems });
      DATA = res; renderAll(); showHqToast(res.message, res.ok); return;
    }
    const mfgBtn = ev.target.closest("[data-mfg-comp]");
    if (mfgBtn) {
      const res = await postJson("/api/career/rd/manufacture", { comp_id: mfgBtn.dataset.mfgComp });
      DATA = res; renderAll(); showHqToast(res.message, res.ok); return;
    }
    const facBtn = ev.target.closest("[data-fac-upgrade]");
    if (facBtn) {
      const res = await postJson("/api/career/facility/upgrade", { facility_id: facBtn.dataset.facUpgrade });
      DATA = res; renderAll(); showHqToast(res.message, res.ok); return;
    }
    const spBtn = ev.target.closest("[data-sign-spon]");
    if (spBtn) {
      const res = await postJson("/api/career/sponsor/sign", { sponsor_id: spBtn.dataset.signSpon });
      DATA = res; renderAll(); showHqToast(res.message, res.ok); return;
    }
    const puBtn = ev.target.closest("[data-pu-car]");
    if (puBtn) {
      const res = await postJson("/api/career/pu/swap", { car_num: Number(puBtn.dataset.puCar), component: puBtn.dataset.puComp });
      DATA = res; renderAll(); showHqToast(res.message, res.ok); return;
    }
    const dilBtn = ev.target.closest("[data-dilemma-idx]");
    if (dilBtn) {
      const res = await postJson("/api/career/dilemma/resolve", { choice_idx: Number(dilBtn.dataset.dilemmaIdx) });
      DATA = res; renderAll(); showHqToast(res.message, res.ok); return;
    }
    const stBtn = ev.target.closest("[data-hire-staff]");
    if (stBtn) {
      const res = await postJson("/api/career/staff/hire", { candidate_id: stBtn.dataset.hireStaff });
      DATA = res; renderAll(); showHqToast(res.message, res.ok); return;
    }
    const ngBtn = ev.target.closest("[data-nextgen-part]");
    if (ngBtn) {
      const res = await postJson("/api/career/rd/nextgen", { part_id: ngBtn.dataset.nextgenPart });
      DATA = res; renderAll(); showHqToast(res.message, res.ok); return;
    }
    const renBtn = ev.target.closest("[data-renew-id]");
    if (renBtn) { openRenewModal(renBtn.dataset.renewId); return; }

    const cmpBtn = ev.target.closest("[data-compare-id]");
    if (cmpBtn) { openCompareModal(cmpBtn.dataset.compareId); return; }

    const repBtn = ev.target.closest("[data-report-round]");
    if (repBtn) { openRaceReport(Number(repBtn.dataset.reportSeason), Number(repBtn.dataset.reportRound)); return; }

    if (ev.target.closest("#car-resume-race-btn")) {
      if (DATA.midrace && DATA.midrace.snapshot) resumeLiveCareerRace(DATA.midrace.snapshot);
      return;
    }
    if (ev.target.closest("#car-discard-race-btn")) {
      await fetch("/api/career/race/autosave", { method: "DELETE" });
      DATA.midrace = null; renderDashboard(); showHqToast("Discarded mid-race autosave.", true); return;
    }
    const fSer = ev.target.closest("[data-feeder-ser]");
    if (fSer) {
      activeFeederSeries = fSer.dataset.feederSer;
      renderFeeders();
      return;
    }
    const fRec = ev.target.closest("[data-feeder-recruit]");
    if (fRec) {
      const res = await postJson("/api/career/feeders/recruit", { feeder_id: fRec.dataset.feederRecruit });
      DATA = res; renderAll(); showHqToast(res.message, res.ok); return;
    }
    if (ev.target.closest("#car-feeder-sim-btn")) {
      const res = await postJson("/api/career/feeders/sim-round", {});
      DATA = res; renderAll(); showHqToast(res.message, res.ok); return;
    }
    const opsTab = ev.target.closest("[data-ops-tab]");
    if (opsTab) {
      document.querySelector(`[data-car-tab="${opsTab.dataset.opsTab}"]`)?.click();
      return;
    }
    const opsAct = ev.target.closest("[data-ops-act]");
    if (opsAct && opsAct.dataset.opsAct === "race") {
      getEl("car-go-race-btn")?.click();
      return;
    }
    const hqRm = ev.target.closest("[data-hq-room]");
    if (hqRm) {
      const rm = hqRm.dataset.hqRoom;
      document.querySelectorAll("[data-hq-room]").forEach((b) => {
        const on = b.dataset.hqRoom === rm;
        b.classList.toggle("active", on);
        b.classList.toggle("car-btn-red", on);
      });
      if (hqCampus3D) hqCampus3D.setRoom(rm);
      return;
    }
  });

  // Save Manager Modal bindings
  getEl("car-saves-btn")?.addEventListener("click", openSavesModal);
  getEl("car-saves-close")?.addEventListener("click", () => getEl("car-saves-modal").classList.add("hidden"));
  getEl("car-saves-ok")?.addEventListener("click", () => getEl("car-saves-modal").classList.add("hidden"));
  getEl("car-saves-modal")?.addEventListener("click", async (ev) => {
    const sw = ev.target.closest("[data-slot-switch]");
    if (sw) {
      DATA = await postJson("/api/career/slots/switch", { slot_id: sw.dataset.slotSwitch });
      renderAll(); renderSavesModal(); showHqToast(DATA.message, true); return;
    }
    const rn = ev.target.closest("[data-slot-rename]");
    if (rn) {
      const nm = window.prompt("New Save Slot Name:", rn.dataset.slotCur || "");
      if (nm && nm.trim()) {
        DATA = await postJson("/api/career/slots/rename", { slot_id: rn.dataset.slotRename, slot_name: nm.trim() });
        renderAll(); renderSavesModal(); showHqToast(DATA.message, true);
      }
      return;
    }
    const dup = ev.target.closest("[data-slot-dup]");
    if (dup) {
      DATA = await postJson("/api/career/slots/duplicate", { slot_id: dup.dataset.slotDup });
      renderAll(); renderSavesModal(); showHqToast(DATA.message, true); return;
    }
    const del = ev.target.closest("[data-slot-del]");
    if (del) {
      if (!window.confirm("Delete this career save slot permanently?")) return;
      DATA = await postJson("/api/career/slots/delete", { slot_id: del.dataset.slotDel });
      renderAll(); renderSavesModal(); showHqToast(DATA.message, true); return;
    }
    const ck = ev.target.closest("[data-ckpt-restore]");
    if (ck) {
      if (!window.confirm("Rollback active career to this checkpoint?")) return;
      DATA = await postJson("/api/career/checkpoint/restore", { checkpoint_id: Number(ck.dataset.ckptRestore) });
      renderAll(); renderSavesModal(); showHqToast(DATA.message, true); return;
    }
  });
  getEl("car-import-file")?.addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const parsed = JSON.parse(txt);
      DATA = await postJson("/api/career/import", { backup: parsed });
      renderAll(); renderSavesModal(); showHqToast(DATA.message, true);
    } catch (err) {
      showHqToast("Import failed: " + err.message, false);
    } finally {
      ev.target.value = "";
    }
  });

  // Race Report, Renewal, Silly Season & Red Flag Modals
  getEl("car-report-close")?.addEventListener("click", () => getEl("car-report-modal").classList.add("hidden"));
  getEl("car-report-ok")?.addEventListener("click", () => getEl("car-report-modal").classList.add("hidden"));
  getEl("car-renew-close")?.addEventListener("click", () => getEl("car-renew-modal").classList.add("hidden"));
  getEl("car-renew-cancel")?.addEventListener("click", () => getEl("car-renew-modal").classList.add("hidden"));
  getEl("car-renew-submit")?.addEventListener("click", async () => {
    if (!renewDriverId) return;
    const res = await postJson("/api/career/driver/renew", {
      driver_id: renewDriverId,
      salary_m: parseFloat(getEl("renew-salary").value) || 2.0,
      years: parseInt(getEl("renew-years").value, 10) || 2,
    });
    DATA = res;
    if (res.ok) getEl("car-renew-modal").classList.add("hidden");
    renderAll(); showHqToast(res.message, res.ok);
  });
  getEl("car-silly-close")?.addEventListener("click", () => getEl("car-silly-modal").classList.add("hidden"));
  getEl("car-silly-ok")?.addEventListener("click", () => getEl("car-silly-modal").classList.add("hidden"));

  getEl("car-rf-restart-btn")?.addEventListener("click", () => {
    const sorted = cr.cars.slice().sort((a, b) => (a.dnf !== b.dnf ? (a.dnf ? 1 : -1) : b.totalProg - a.totalProg));
    const leadLap = Math.max(1, Math.floor(sorted[0]?.totalProg || 1));
    const c0 = getEl("rf-tyre-0")?.value || "soft";
    const c1 = getEl("rf-tyre-1")?.value || "soft";
    const running = sorted.filter((c) => !c.dnf);
    sorted.forEach((c) => { if (c.dnf) c.cleared = true; });
    const perim = Math.max(1800, (cr.circuit && cr.circuit.length_km ? cr.circuit.length_km * 1000 : 4800));
    const progStep = Math.max(0.0020, Math.min(0.0052, 16.5 / perim));
    const startOffset = Math.max(0.0020, 9.0 / perim);
    if (window.F1TrackArchitect) {
      cr.startSeq = window.F1TrackArchitect.createStandingStartState(running, cr.circuit, { isRestart: true });
    }
    let pIdx = 0;
    running.forEach((car, i) => {
      car.totalProg = leadLap - (startOffset + i * progStep);
      car.lap = Math.max(0, leadLap - 1);
      car.latOffset = (i % 2 === 0 ? -2.55 : 2.55);
      car.inPit = 0; car.pitDuration = 0; car.boxNextLap = false;
      car.wingDamaged = false; car.fixWingOnPit = false;
      let newComp = cr.wetness >= 60 ? "wet" : (cr.wetness >= 22 ? "inter" : "soft");
      if (car.isPlayerTeam) { newComp = pIdx === 0 ? c0 : c1; pIdx += 1; }
      if (COMPOUNDS[newComp]) {
        car.compound = newComp; car.tyreLife = 100; car.tyreTemp = 92;
        if (!Array.isArray(car.stints)) car.stints = [];
        car.stints.push(COMPOUNDS[newComp].code);
        if (COMPOUNDS[newComp].wet > 0) car.usedWet = true; else car.dryCompoundsUsed.add(newComp);
      }
      car.currentLapS = computeCrLapTime(car);
    });
    getEl("car-redflag-modal").classList.add("hidden");
    getEl("cr-radio-latest").textContent = "🔴 STANDING RESTART! Cars lined up on fresh tyres — waiting for 5 red lights!";
    cr.paused = false;
    renderCrHud();
  });

  // Q1 / Q2 / Q3 Knockout Qualifying buttons + 3D Duel toggle + Livery Editor + Academy + Lap Chart + Rival Inspector
  getEl("car-livery-toggle-btn")?.addEventListener("click", () => {
    const ed = getEl("car-livery-editor");
    if (!ed) return;
    ed.classList.toggle("hidden");
    if (!ed.classList.contains("hidden")) syncLiveryInputsFromTeam();
  });
  ["liv-main", "liv-sec", "liv-acc", "liv-pop", "liv-det", "liv-style", "liv-era"].forEach((id) => {
    getEl(id)?.addEventListener("input", () => {
      syncDash3DCar({
        palette: {
          main: getEl("liv-main").value,
          secondary: getEl("liv-sec").value,
          accent: getEl("liv-acc").value,
          pop: getEl("liv-pop").value,
          detail: getEl("liv-det").value,
        },
        style: getEl("liv-style").value,
        era: getEl("liv-era").value,
      });
    });
  });
  getEl("car-livery-save-btn")?.addEventListener("click", async () => {
    const res = await postJson("/api/career/team/livery", {
      palette: {
        main: getEl("liv-main").value,
        secondary: getEl("liv-sec").value,
        accent: getEl("liv-acc").value,
        pop: getEl("liv-pop").value,
        detail: getEl("liv-det").value,
      },
      livery_style: getEl("liv-style").value,
      car_era: getEl("liv-era").value,
    });
    DATA = res;
    getEl("car-livery-editor")?.classList.add("hidden");
    renderAll();
    showHqToast(res.message, res.ok);
  });

  getEl("car-acad-train-btn")?.addEventListener("click", async () => {
    const res = await postJson("/api/career/academy/train", {});
    DATA = res; renderAll(); showHqToast(res.message, res.ok);
  });
  getEl("car-acad-disc-btn")?.addEventListener("click", async () => {
    const res = await postJson("/api/career/academy/discover", {});
    DATA = res; renderAll(); showHqToast(res.message, res.ok);
  });

  getEl("car-compare-close")?.addEventListener("click", () => getEl("car-compare-modal").classList.add("hidden"));
  getEl("car-compare-ok")?.addEventListener("click", () => getEl("car-compare-modal").classList.add("hidden"));

  getEl("car-strat-planner")?.addEventListener("click", (ev) => {
    const card = ev.target.closest("[data-strat-json]");
    if (!card) return;
    try {
      const s = JSON.parse(card.dataset.stratJson);
      cr.targetPitPlan = s;
      if (getEl("car-start-tyre-0")) getEl("car-start-tyre-0").value = s.c0;
      if (getEl("car-start-tyre-1")) getEl("car-start-tyre-1").value = s.c1;
      renderStrategyPlanner();
      showHqToast(`Strategy Selected: ${s.name} (${s.note})`, true);
    } catch (e) {}
  });
  getEl("car-q-laps")?.addEventListener("change", renderStrategyPlanner);

  // Live Pit Wall: Open Scrubbable Telemetry Studio (falls back to simple Lap Chart if empty)
  getEl("cr-chart-btn")?.addEventListener("click", () => {
    if (window.F1RaceAnalytics && cr.telemetry && cr.telemetry.frames.length) {
      const payload = cr.telemetry.exportPayload(
        cr.cars.slice().sort((a, b) => a.pos - b.pos).map((c, i) => ({
          idx: c.idx, code3: c.code3, name: c.cleanName, team: c.teamName, color: c.color,
          finishPos: i + 1, dnf: c.dnf, stintHistory: c.stintHistory || [],
          confidence: c.confidence, peakConfidence: c.peakConfidence, minConfidence: c.minConfidence,
          momentum: c.momentum, overtakesMade: c.overtakesMade, mistakesCount: c.mistakesCount,
          totalPitDelayS: c.totalPitDelayS, bestLapS: c.bestLapS,
        }))
      );
      window.F1RaceAnalytics.open(payload);
      return;
    }
    getEl("car-lapchart-modal")?.classList.remove("hidden");
    const meta = cr.cars.slice().sort((a, b) => a.pos - b.pos).map((c) => ({ id: c.driverId, code3: c.code3, color: c.color, isPlayer: c.isPlayerTeam }));
    requestAnimationFrame(() => drawLapPositionChart("car-live-lapchart-canvas", "car-lapchart-legend", cr.lapHistory, meta));
  });
  getEl("car-lapchart-close")?.addEventListener("click", () => getEl("car-lapchart-modal").classList.add("hidden"));
  getEl("car-lapchart-ok")?.addEventListener("click", () => getEl("car-lapchart-modal").classList.add("hidden"));
  getEl("cr-sfx-toggle")?.addEventListener("click", () => { if (window.F1Sfx) { window.F1Sfx.toggle(); renderSfxBtn(); } });
  getEl("cr-timing-body")?.addEventListener("pointerdown", (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    const tr = ev.target.closest("tr[data-cr-car-idx], tr[data-inspect-drv]");
    if (!tr) return;
    ev.preventDefault();
    const car = tr.dataset.crCarIdx != null
      ? cr.cars[Number(tr.dataset.crCarIdx)]
      : cr.cars.find((c) => c.driverId === tr.dataset.inspectDrv);
    if (!car) return;
    const did = car.driverId;
    if (car.isPlayerTeam) {
      const slot = cr.playerCarIndices.indexOf(car.idx);
      if (slot >= 0) cr.focusSlot = slot;
      cr.inspectedDriverId = null;
    } else {
      cr.inspectedDriverId = cr.inspectedDriverId === did ? null : did;
    }
    renderCrHud();
    drawCrCanvas();
  });
  getEl("cr-rival-pill")?.addEventListener("click", (ev) => {
    if (ev.target.closest("#cr-rival-close")) { cr.inspectedDriverId = null; renderCrHud(); }
  });

  getEl("car-q-stage-btn")?.addEventListener("click", () => {
    const nxt = getEl("car-q-stage-btn").dataset.nextStage || "q1";
    if (nxt !== "done") runCareerQualifying(nxt);
  });
  getEl("car-q-watch-btn")?.addEventListener("click", () => {
    const nxt = getEl("car-q-watch-btn").dataset.nextStage || "q1";
    if (nxt !== "done") watchActiveSessionLive(nxt);
  });
  getEl("car-q-simfull-btn")?.addEventListener("click", () => runCareerQualifying("full"));
  getEl("car-wk-watch-btn")?.addEventListener("click", () => watchActiveSessionLive());
  getEl("car-wk-simend-btn")?.addEventListener("click", () => simActiveSessionToEnd());
  document.querySelectorAll("[data-wk-spd]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sp = Number(btn.getAttribute("data-wk-spd") || 4);
      wkCtx.speed = sp || wkCtx.speed;
      document.querySelectorAll("[data-wk-spd]").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.classList.toggle("car-btn-red", b === btn);
      });
      if (wkCtx.runner) wkCtx.runner.setSpeed(sp);
    });
  });
  [0, 1].forEach((slot) => {
    getEl(`car-wk-prog-${slot}`)?.addEventListener("change", (ev) => {
      const pid = ev.target.value;
      const pObj = (wkCtx.programmes || []).find((x) => x.id === pid);
      const dEl = getEl(`car-wk-p${slot}-desc`);
      if (dEl && pObj) dEl.textContent = pObj.desc;
    });
  });
  getEl("car-wk-dp-sel")?.addEventListener("change", async (ev) => {
    const tgt = ev.target.value;
    if (!tgt) return;
    ev.target.value = "";
    const res = await postJson("/api/career/weekend/devpoints/spend", { target: tgt });
    DATA = res;
    if (res.dev_points != null) wkCtx.devPoints = res.dev_points;
    renderWeekendOS();
    refreshWeekendRadar();
    showHqToast(res.message, res.ok);
  });
  getEl("cr-duel-toggle")?.addEventListener("click", () => {
    cr.duelEnabled = !cr.duelEnabled;
    const btn = getEl("cr-duel-toggle");
    btn.classList.toggle("is-duel-on", cr.duelEnabled);
    btn.querySelector("span").textContent = cr.duelEnabled ? "3D Duel: ON" : "3D Duel: OFF";
  });

  document.addEventListener("input", (ev) => {
    if (ev.target && (ev.target.id === "car-atr-wt-slider" || ev.target.id === "car-atr-cfd-slider")) {
      updateAtrPreview();
    }
  });

  // Driver Development Focus dropdown change
  getEl("career-hq").addEventListener("change", async (ev) => {
    const focSel = ev.target.closest("[data-dev-focus]");
    if (focSel) {
      const res = await postJson("/api/career/driver/focus", { driver_id: focSel.dataset.devFocus, focus: focSel.value });
      DATA = res; showHqToast(res.message, res.ok);
    }
  });

  // Free Practice Car Setup Sliders + Run FP Stint + Auto-Tune
  ["wing", "susp", "diff"].forEach((k) => {
    const inp = getEl(`fp-${k}`);
    if (inp) inp.addEventListener("input", () => { const v = getEl(`fp-${k}-val`); if (v) v.textContent = inp.value; });
  });
  async function runFpSetup(auto) {
    const phase = (wkCtx.data && wkCtx.data.current_phase && wkCtx.data.current_phase.startsWith("fp"))
      ? wkCtx.data.current_phase
      : "fp1";
    await _commitPracticeFromResult(phase, null, !!auto);
  }
  getEl("car-fp-run-btn")?.addEventListener("click", () => runFpSetup(false));
  getEl("car-fp-auto-btn")?.addEventListener("click", () => runFpSetup(true));

  // Live Pit Wall Team Orders (FREE / HOLD / SWAP)
  document.querySelectorAll("[data-cr-order]").forEach((btn) => {
    btn.addEventListener("click", () => {
      cr.teamOrder = btn.dataset.crOrder;
      document.querySelectorAll("[data-cr-order]").forEach((b) => b.classList.toggle("active", b === btn));
      getEl("cr-radio-latest").textContent = cr.teamOrder === "hold"
        ? `📻 Pit Wall: HOLD POSITIONS — both ${DATA.player_team.name} cars maintain gap & protect tyres!`
        : `📻 Pit Wall: FREE TO RACE — clean wheel-to-wheel racing authorized!`;
    });
  });
  getEl("cr-swap-btn")?.addEventListener("click", () => {
    if (!cr.running || cr.playerCarIndices.length < 2) return;
    const a = cr.cars[cr.playerCarIndices[0]], b = cr.cars[cr.playerCarIndices[1]];
    if (!a || !b || a.dnf || b.dnf || a.inPit > 0 || b.inPit > 0) return;
    const gap = Math.abs(a.totalProg - b.totalProg) * cr.circuit.base_lap_s;
    if (gap > 2.8) {
      getEl("cr-radio-latest").textContent = `📻 Pit Wall: Cars are ${gap.toFixed(1)}s apart — wait until within 2.8s to swap!`;
      return;
    }
    const tmp = a.totalProg;
    a.totalProg = b.totalProg;
    b.totalProg = tmp;
    const newFront = a.totalProg > b.totalProg ? a : b;
    const newBack = newFront === a ? b : a;
    getEl("cr-radio-latest").textContent = `📻 TEAM ORDERS EXECUTED: ${newBack.cleanName} lets ${newFront.cleanName} through cleanly!`;
    renderCrHud();
  });

  // Offer Modal bindings
  ["offer-seat", "offer-salary", "offer-bonus", "offer-years"].forEach((id) => {
    getEl(id).addEventListener("input", updateOfferPreview);
    getEl(id).addEventListener("change", updateOfferPreview);
  });
  getEl("car-offer-close").addEventListener("click", () => getEl("car-offer-modal").classList.add("hidden"));
  getEl("car-offer-cancel").addEventListener("click", () => getEl("car-offer-modal").classList.add("hidden"));
  getEl("car-offer-submit").addEventListener("click", async () => {
    if (!offerDriverId) return;
    const res = await postJson("/api/career/market/offer", {
      driver_id: offerDriverId,
      seat_slot: getEl("offer-seat").value,
      salary_m: parseFloat(getEl("offer-salary").value) || 1.0,
      signing_bonus_m: parseFloat(getEl("offer-bonus").value) || 0.0,
      years: parseInt(getEl("offer-years").value, 10) || 2,
    });
    DATA = res;
    if (res.ok) getEl("car-offer-modal").classList.add("hidden");
    renderAll();
    showHqToast(res.message, res.ok);
  });

  // Race Weekend & Season Rollover bindings
  getEl("car-go-race-btn").addEventListener("click", openRaceWeekend);
  getEl("car-advance-season-btn").addEventListener("click", async () => {
    const res = await postJson("/api/career/season/advance", {});
    DATA = res; renderAll(); showHqToast(res.message, true);
    showSillySeasonModal(res.silly_season_recap || []);
  });
  getEl("car-q-weather").addEventListener("change", () => refreshWeekendRadar());
  getEl("car-q-laps")?.addEventListener("change", () => refreshWeekendRadar());
  getEl("car-q-back-btn").addEventListener("click", () => {
    if (wkCtx.runner) wkCtx.runner.stop();
    getEl("career-race-view").classList.add("hidden");
    getEl("career-hq").classList.remove("hidden");
    document.body.classList.add("car-hq-active");
  });
  getEl("car-q-quicksim-btn").addEventListener("click", async () => {
    if (wkCtx.runner) wkCtx.runner.stop();
    const res = await postJson("/api/career/race/quicksim", { weather_mode: getEl("car-q-weather").value });
    DATA = res;
    showPostRaceDebrief(res.debrief);
  });
  getEl("car-q-lightsout-btn").addEventListener("click", async () => {
    if (wkCtx.runner) wkCtx.runner.stop();
    if (!cr.quali || (cr.quali.stage && cr.quali.stage !== "done")) {
      await runCareerQualifying("full");
    }
    startLiveCareerRace();
  });
  getEl("car-debrief-close").addEventListener("click", () => getEl("car-debrief-modal").classList.add("hidden"));
  getEl("car-debrief-ok").addEventListener("click", () => getEl("car-debrief-modal").classList.add("hidden"));

  // Live 2-Car Cockpit Controls (Save & Exit autosaves mid-race to SQLite!)
  getEl("cr-abort-btn").addEventListener("click", async () => {
    if (cr.running && !cr.finished) {
      const snap = buildMidRaceSnapshot();
      await fetch("/api/career/race/autosave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: snap }),
      }).catch(() => {});
      DATA.midrace = { season_num: snap.season_num, round_num: snap.round_num, circuit_id: snap.circuit_id, lap: snap.lap, total_laps: snap.total_laps, snapshot: snap };
    }
    cr.active = false; cr.running = false;
    document.body.classList.remove("sim-cockpit-active", "sim-focus-mode");
    getEl("career-race-view").classList.add("hidden");
    getEl("career-hq").classList.remove("hidden");
    document.body.classList.add("car-hq-active");
    renderDashboard();
    showHqToast("Race paused & autosaved! Resume anytime from HQ Dashboard.", true);
  });
  function toggleCrFocusMode() {
    const on = document.body.classList.toggle("sim-focus-mode");
    const btn = getEl("cr-focus-btn");
    if (btn) {
      btn.classList.toggle("is-open", on);
      btn.innerHTML = `<i class="fas fa-${on ? "compress" : "expand"}"></i>`;
    }
    cr.staticKey = "";
    requestAnimationFrame(() => { if (cr.active) drawCrCanvas(); });
  }
  getEl("cr-focus-btn")?.addEventListener("click", toggleCrFocusMode);
  const crGridEl = getEl("cr-cockpit-grid");
  crGridEl?.querySelectorAll(".sim-dock-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.dockTarget || "strategy";
      crGridEl.dataset.dockPane = target;
      crGridEl.querySelectorAll(".sim-dock-tab").forEach((b) => b.classList.toggle("active", b === btn));
      cr.staticKey = "";
      requestAnimationFrame(() => { if (cr.active) drawCrCanvas(); });
    });
  });
  if (window.ResizeObserver && getEl("cr-track-canvas")) {
    new ResizeObserver(() => {
      if (cr.active && cr.circuit) { cr.staticKey = ""; drawCrCanvas(); }
    }).observe(getEl("cr-track-canvas"));
  }
  document.querySelectorAll("[data-cr-car]").forEach((btn) => {
    btn.addEventListener("click", () => { cr.focusSlot = Number(btn.dataset.crCar); renderCrHud(); });
  });
  document.querySelectorAll("[data-cr-speed]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-cr-speed]").forEach((b) => b.classList.toggle("active", b === btn));
      const sp = Number(btn.dataset.crSpeed);
      cr.paused = sp === 0;
      if (sp > 0) cr.speedMult = sp;
    });
  });
  getEl("cr-sim-end-btn")?.addEventListener("click", runCrSimToEnd);
  if (window.F1Broadcast3D && getEl("cr-3d-canvas")) {
    cr.b3d = window.F1Broadcast3D.createBroadcast3D(getEl("cr-3d-canvas"), getEl("cr-3d-hud"));
  }
  if (window.F1RadioEngine && getEl("cr-radio-card")) {
    cr.radio = window.F1RadioEngine.createRadioController(getEl("cr-radio-card"), {
      sfxEnabled: () => (window.F1Sfx ? window.F1Sfx.isEnabled() : true),
      voiceEnabled: () => false,
      onEmit: (entry) => { if (cr.telemetry && cr.telemetry.addRadio) cr.telemetry.addRadio(entry); },
    });
  }
  document.querySelectorAll("[data-cr-3d]").forEach((btn) => {
    btn.addEventListener("click", () => {
      cr.b3dMode = btn.getAttribute("data-cr-3d") || "off";
      document.querySelectorAll("[data-cr-3d]").forEach((b) => b.classList.toggle("active", b.getAttribute("data-cr-3d") === cr.b3dMode));
      if (!cr.b3d) return;
      if (cr.b3dMode === "off") { cr.b3d.setActive(false); drawCrCanvas(); }
      else { cr.b3d.setMode(cr.b3dMode); cr.b3d.setActive(true); }
    });
  });
  getEl("cr-tower-wide")?.addEventListener("click", () => {
    cr.towerWide = !cr.towerWide;
    getEl("cr-cockpit-grid")?.classList.toggle("is-tower-wide", cr.towerWide);
    getEl("cr-tower-wide")?.classList.toggle("is-wide", cr.towerWide);
    cr.staticKey = "";
    requestAnimationFrame(() => { if (cr.active) drawCrCanvas(); });
  });
  document.querySelectorAll("[data-cr-gap]").forEach((btn) => {
    btn.addEventListener("click", () => {
      cr.gapMode = btn.dataset.crGap;
      document.querySelectorAll("[data-cr-gap]").forEach((b) => b.classList.toggle("active", b === btn));
      renderCrHud();
    });
  });
  document.querySelectorAll("[data-cr-layer]").forEach((btn) => {
    btn.addEventListener("click", () => {
      cr.layers[btn.dataset.crLayer] = !cr.layers[btn.dataset.crLayer];
      btn.classList.toggle("active", cr.layers[btn.dataset.crLayer]);
      cr.staticKey = "";
    });
  });
  function setCrCam(mode) {
    const R = window.F1TrackRenderer;
    if (!R) return;
    if (!cr.cam) cr.cam = R.createCamera();
    R.setCameraMode(cr.cam, mode);
    document.querySelectorAll("[data-cr-cam]").forEach((b) => b.classList.toggle("active", b.dataset.crCam === cr.cam.mode));
    drawCrCanvas();
  }
  document.querySelectorAll("[data-cr-cam]").forEach((btn) => {
    btn.addEventListener("click", () => setCrCam(btn.dataset.crCam));
  });
  getEl("cr-track-canvas")?.addEventListener("wheel", (ev) => {
    const R = window.F1TrackRenderer;
    if (!R || !cr.active) return;
    ev.preventDefault();
    if (!cr.cam) cr.cam = R.createCamera();
    R.zoomCameraBy(cr.cam, ev.deltaY < 0 ? 0.35 : -0.35);
    document.querySelectorAll("[data-cr-cam]").forEach((b) => b.classList.toggle("active", b.dataset.crCam === cr.cam.mode));
    drawCrCanvas();
  }, { passive: false });
  document.querySelectorAll("[data-cr-pace]").forEach((btn) => {
    btn.addEventListener("click", () => { const c = getFocusedCar(); if (c) { c.paceMode = btn.dataset.crPace; renderCrHud(); } });
  });
  document.querySelectorAll("[data-cr-ers]").forEach((btn) => {
    btn.addEventListener("click", () => { const c = getFocusedCar(); if (c) { c.ersMode = btn.dataset.crErs; renderCrHud(); } });
  });
  document.querySelectorAll("[data-cr-risk]").forEach((btn) => {
    btn.addEventListener("click", () => { const c = getFocusedCar(); if (c) { c.riskMode = btn.dataset.crRisk; renderCrHud(); } });
  });
  document.querySelectorAll("[data-cr-comp]").forEach((btn) => {
    btn.addEventListener("click", () => { const c = getFocusedCar(); if (c) { c.boxCompound = btn.dataset.crComp; renderCrHud(); } });
  });
  const crBoxBtn = getEl("cr-box-btn");
  crBoxBtn.addEventListener("click", () => {
    const c = getFocusedCar();
    if (!c || !cr.running) return;
    c.boxNextLap = !c.boxNextLap;
    if (c.boxNextLap) getEl("cr-radio-latest").textContent = `📻 Pit Wall: Copy ${c.cleanName}, box this lap for ${COMPOUNDS[c.boxCompound].name} tyres!`;
    renderCrHud();
  });
  crBoxBtn.addEventListener("mouseenter", () => { cr.boxHover = true; });
  crBoxBtn.addEventListener("mouseleave", () => { cr.boxHover = false; });

  document.addEventListener("keydown", (ev) => {
    if (!cr.active) return;
    const tag = (ev.target && ev.target.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT") return;
    const foc = getFocusedCar();
    if (ev.key === "Tab") {
      ev.preventDefault();
      cr.focusSlot = cr.focusSlot === 0 ? 1 : 0;
      renderCrHud();
    } else if (ev.code === "Space") {
      ev.preventDefault();
      cr.paused = !cr.paused;
    } else if (foc) {
      const k = ev.key.toLowerCase();
      if (k === "q") { foc.paceMode = "conserve"; renderCrHud(); }
      else if (k === "w") { foc.paceMode = "balanced"; renderCrHud(); }
      else if (k === "e") { foc.paceMode = "push"; renderCrHud(); }
      else if (k === "a") { foc.ersMode = "harvest"; renderCrHud(); }
      else if (k === "s") { foc.ersMode = "auto"; renderCrHud(); }
      else if (k === "d") { foc.ersMode = "overtake"; renderCrHud(); }
      else if (k === "b") { crBoxBtn.click(); }
      else if (k === "f") { toggleCrFocusMode(); }
      else if (k === "z") {
        const cur = (cr.cam && cr.cam.mode) || "full";
        const order = ["full", "follow", "battle", "close", "heli"];
        setCrCam(order[(order.indexOf(cur) + 1) % order.length]);
      }
    }
  });

  // Boot!
  renderAll();
})();
