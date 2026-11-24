/**
 * Career Mode Telemetry & Analytics War Room + FIA Stewards / PU / Commission Renderer.
 * Zero external chart dependencies — crisp HiDPI HTML5 Canvas charts & interactive widgets.
 */
(function (global) {
  "use strict";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function setupCanvas(canvas) {
    if (!canvas) return null;
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    const w = Math.max(240, canvas.clientWidth || 420);
    const h = Math.max(120, canvas.clientHeight || 175);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function drawLineChart(canvas, seriesList, opts) {
    const info = setupCanvas(canvas);
    if (!info) return;
    const { ctx, w, h } = info;
    const o = opts || {};
    ctx.fillStyle = "#060c18";
    ctx.fillRect(0, 0, w, h);

    const padL = 38, padR = 14, padT = 18, padB = 24;
    const plotW = Math.max(40, w - padL - padR);
    const plotH = Math.max(40, h - padT - padB);

    const allVals = [];
    let maxLen = 1;
    (seriesList || []).forEach((s) => {
      maxLen = Math.max(maxLen, (s.values || []).length);
      (s.values || []).forEach((v) => { if (Number.isFinite(v)) allVals.push(v); });
    });
    if (o.refLine != null) allVals.push(o.refLine);
    if (!allVals.length) {
      ctx.fillStyle = "#64748b";
      ctx.font = "600 11px 'Source Sans 3', sans-serif";
      ctx.fillText(o.emptyText || "Complete at least 1 race to populate live career telemetry.", padL, h * 0.5);
      return;
    }

    const minV = o.minY != null ? o.minY : Math.min(0, ...allVals);
    const maxV = Math.max(minV + 1, o.maxY != null ? o.maxY : Math.max(...allVals) * 1.12);
    const toX = (i, len) => padL + (len <= 1 ? plotW * 0.5 : (i / (len - 1)) * plotW);
    const toY = (v) => padT + plotH - ((v - minV) / (maxV - minV)) * plotH;

    // Gridlines
    ctx.strokeStyle = "rgba(148,163,184,0.14)";
    ctx.lineWidth = 1;
    ctx.font = "600 9.5px ui-monospace, monospace";
    ctx.fillStyle = "#94a3b8";
    for (let g = 0; g <= 3; g++) {
      const val = minV + ((maxV - minV) * g) / 3;
      const y = toY(val);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillText(o.fmtY ? o.fmtY(val) : String(Math.round(val)), 4, y + 3);
    }

    // Optional reference line (e.g. $135M Cost Cap)
    if (o.refLine != null) {
      const ry = toY(o.refLine);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(padL, ry); ctx.lineTo(w - padR, ry); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#fca5a5";
      ctx.fillText(o.refLabel || `CAP ${o.refLine}`, w - padR - 72, Math.max(12, ry - 4));
    }

    // Draw series
    (seriesList || []).forEach((s) => {
      const vals = s.values || [];
      if (!vals.length) return;
      ctx.strokeStyle = s.color || "#38bdf8";
      ctx.lineWidth = s.bold ? 2.6 : 1.7;
      ctx.beginPath();
      vals.forEach((v, i) => {
        const x = toX(i, maxLen);
        const y = toY(v);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      vals.forEach((v, i) => {
        ctx.fillStyle = s.color || "#38bdf8";
        ctx.beginPath();
        ctx.arc(toX(i, maxLen), toY(v), s.bold ? 3.2 : 2.2, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    // Legend
    let lx = padL;
    ctx.font = "700 9.5px 'Source Sans 3', sans-serif";
    (seriesList || []).slice(0, 4).forEach((s) => {
      ctx.fillStyle = s.color || "#38bdf8";
      ctx.fillRect(lx, 5, 9, 4);
      ctx.fillStyle = "#e2e8f0";
      ctx.fillText(s.label || "", lx + 12, 10);
      lx += ctx.measureText(s.label || "").width + 24;
    });

    // X-axis round labels
    if (Array.isArray(o.labels) && o.labels.length) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "600 9px ui-monospace, monospace";
      const step = Math.max(1, Math.ceil(o.labels.length / 7));
      o.labels.forEach((lb, i) => {
        if (i % step === 0 || i === o.labels.length - 1) {
          ctx.fillText(String(lb), toX(i, o.labels.length) - 10, h - 6);
        }
      });
    }
  }

  function renderAnalyticsWarRoom(anData, opts) {
    if (!anData) return;
    const rounds = anData.rounds || [];
    const labels = rounds.map((r) => `R${r.round}`);

    // 1. Season WCC Points & Car OVR Trajectory Chart
    const ptsCanvas = document.getElementById("car-an-pts-canvas");
    if (ptsCanvas) {
      drawLineChart(ptsCanvas, [
        { label: "WCC Points", color: "#facc15", bold: true, values: rounds.map((r) => r.wcc_pts) },
        { label: "Board Conf %", color: "#38bdf8", values: rounds.map((r) => r.board_confidence) },
      ], { labels, emptyText: "Complete Round 1 to track WCC Points & Board Confidence!" });
    }

    // 2. Cost Cap Burn vs $135M Ceiling + Car OVR Growth
    const capCanvas = document.getElementById("car-an-cap-canvas");
    if (capCanvas) {
      drawLineChart(capCanvas, [
        { label: "Cost Cap Burn ($M)", color: "#22c55e", bold: true, values: rounds.map((r) => r.cost_cap_spent_m) },
        { label: "Car OVR", color: "#e10600", values: rounds.map((r) => r.car_overall) },
      ], {
        labels,
        refLine: anData.costCapLimitM || 135,
        refLabel: `FIA CAP $${anData.costCapLimitM || 135}M`,
        fmtY: (v) => `$${Math.round(v)}`,
        emptyText: "Cost Cap burn curve populates after Round 1.",
      });
    }

    // 3. Teammate H2H Split Telemetry
    const h2hEl = document.getElementById("car-an-h2h");
    if (h2hEl) {
      const hs = anData.teammateH2H || [];
      if (hs.length >= 2) {
        const [a, b] = hs;
        h2hEl.innerHTML = `
          <div class="car-h2h-head">
            <div><strong style="color:#fde047;">${esc(a.code3)}</strong> <small class="muted">${esc(a.name)}</small></div>
            <span class="car-h2h-vs">VS</span>
            <div style="text-align:right;"><small class="muted">${esc(b.name)}</small> <strong style="color:#38bdf8;">${esc(b.code3)}</strong></div>
          </div>
          ${[
            ["Quali H2H", a.quali_h2h_wins, b.quali_h2h_wins],
            ["Race H2H", a.race_h2h_wins, b.race_h2h_wins],
            ["Season Points", a.points, b.points],
            ["Pts / $1M Salary", a.pts_per_m, b.pts_per_m],
            ["Morale", a.morale + "%", b.morale + "%"],
            ["Penalty Pts (/12)", a.penalty_points, b.penalty_points],
          ].map(([lbl, va, vb]) => `
            <div class="car-h2h-row"><b>${esc(va)}</b><span>${esc(lbl)}</span><b>${esc(vb)}</b></div>
          `).join("")}
        `;
      } else {
        h2hEl.innerHTML = '<div class="muted small">Sign 2 race drivers to unlock Teammate H2H telemetry.</div>';
      }
    }

    // 4. R&D Wind-Tunnel Correlation ROI Card
    const roiEl = document.getElementById("car-an-roi");
    if (roiEl) {
      const rc = anData.rdCorrelation || {};
      const cnt = rc.counts || {};
      const capPct = Math.min(100, Math.round(((anData.costCapSpentM || 0) / Math.max(1, anData.costCapLimitM || 135)) * 100));
      roiEl.innerHTML = `
        <div class="car-roi-kpis">
          <div><small>CORRELATION HIT</small><b style="color:#4ade80;">${esc(rc.hitRatePct ?? 100)}%</b></div>
          <div><small>BREAKTHROUGHS</small><b style="color:#38bdf8;">${esc(cnt.breakthrough || 0)}</b></div>
          <div><small>MISMATCHES</small><b style="color:#f87171;">${esc(cnt.mismatch || 0)}</b></div>
          <div><small>CAP USED</small><b style="color:#fde047;">${capPct}%</b></div>
        </div>
        <div class="muted small" style="margin-top:6px;">
          Cost Cap: <b>$${esc(anData.costCapSpentM)}M / $${esc(anData.costCapLimitM)}M</b> ·
          PU Supplier: <b>${esc(anData.puContract?.name || "Mercedes-AMG HPP")}</b> (${esc(anData.puContract?.annual_fee_m || 15)}M/yr)
        </div>
      `;
    }

    // 5. Next GP Real F1DB Strategy Curve (1-Stop vs 2-Stop vs 3-Stop)
    renderStrategyCurve(anData.nextGp, document.getElementById("car-an-strat-canvas"), document.getElementById("car-an-strat-list"));
    renderStrategyCurve(anData.nextGp, document.getElementById("car-q-strat-canvas"), document.getElementById("car-q-strat-list"));

    // 6. FIA Stewards' Room, 12-Point Super Licence Grid, PU Contracts & F1 Commission
    renderStewardsRoom(anData, opts);
  }

  function renderStrategyCurve(ng, canvasEl, listEl) {
    if (!ng || !Array.isArray(ng.strategies)) return;
    const cols = ["#22c55e", "#facc15", "#ef4444"];
    if (canvasEl) {
      const series = ng.strategies.map((s, i) => ({
        label: s.label,
        color: cols[i % cols.length],
        bold: Boolean(s.recommended),
        values: (s.curve || []).map((p) => p.cumS),
      }));
      const labels = ((ng.strategies[0] && ng.strategies[0].curve) || []).map((p) => `L${p.lap}`);
      drawLineChart(canvasEl, series, {
        labels,
        fmtY: (v) => `${v >= 0 ? "+" : ""}${Math.round(v)}s`,
        emptyText: "F1DB Strategy Curve loading...",
      });
    }
    if (listEl) {
      const inc = ng.incidents || {};
      const td = ng.tyreDegradation || {};
      listEl.innerHTML = `
        <div class="car-strat-meta">
          <span><b>${esc(ng.gp)}</b> (${esc(ng.laps)}L)</span>
          <span>Deg: <b>${esc(ng.tyreDegSecPerLap)}s/L</b> (${esc(td.degSeverity || "MED")})</span>
          <span>Pit Loss: <b>${esc(ng.medianPitLaneSec)}s</b></span>
          <span>SC Prob: <b>${inc.safetyCarProbability != null ? Math.round(inc.safetyCarProbability * 100) + "%" : "—"}</b></span>
        </div>
        ${ng.strategies.map((s) => `
          <div class="car-strat-row ${s.recommended ? "is-best" : ""}">
            <strong>${esc(s.label)} ${s.recommended ? '<span class="car-signed-tag">★ OPTIMAL</span>' : ""}</strong>
            <span>Box Laps: <b>${(s.pitLaps || []).map((l) => "L" + l).join(", ") || "None"}</b></span>
            <span>${s.gapToOptimal === 0 ? "FASTEST" : `+${s.gapToOptimal}s`}</span>
          </div>
        `).join("")}
      `;
    }
  }

  function renderStewardsRoom(anData, opts) {
    const o = opts || {};
    // Pending Stewards' Summons card
    const pendEl = document.getElementById("car-stewards-pending");
    const h = anData.pendingStewards;
    if (pendEl) {
      if (h) {
        pendEl.innerHTML = `
          <div class="car-steward-doc">
            <div class="car-sd-head">
              <strong>⚖️ OFFICIAL FIA DOCUMENT #${esc(h.doc_number)} — SUMMONS &amp; RULING</strong>
              <span class="car-sd-badge">${esc(h.gp)}</span>
            </div>
            <div class="car-sd-body">
              <div><b>Driver / Car:</b> ${esc(h.driver_name)} (Car #${esc(h.car_number)})</div>
              <div><b>Fact:</b> ${esc(h.fact)}</div>
              <div><b>Offence:</b> ${esc(h.offence)}</div>
              <div><b>Proposed Decision:</b> <span style="color:#fca5a5;">${esc(h.decision)}</span></div>
              <p class="muted small" style="margin:4px 0 0;"><b>Stewards' Reasoning:</b> ${esc(h.reason)}</p>
            </div>
            <div class="car-sd-actions">
              <button type="button" class="car-btn-xs" data-steward-act="accept">Accept Ruling</button>
              <button type="button" class="car-btn-xs car-btn-gold" data-steward-act="appeal">⚖️ Right of Review (-$0.2M)</button>
              <button type="button" class="car-btn-xs car-btn-red" data-steward-act="protest_rival">🔍 Counter-Protest Rival (-$0.3M)</button>
            </div>
          </div>
        `;
        pendEl.querySelectorAll("[data-steward-act]").forEach((btn) => {
          btn.addEventListener("click", () => o.onStewardAction && o.onStewardAction(btn.dataset.stewardAct));
        });
      } else {
        pendEl.innerHTML = '<div class="muted small" style="padding:8px;">✅ Clean Race Sheet — No active FIA Stewards summons awaiting your response.</div>';
      }
    }

    // 12-Point Super Licence Grid Table
    const licTbody = document.getElementById("car-licence-tbody");
    if (licTbody) {
      licTbody.innerHTML = (anData.superLicenceGrid || []).map((d) => `
        <tr class="${d.is_player ? "is-me" : ""}">
          <td><b>${esc(d.code3)}</b> ${esc(d.name)}</td>
          <td>${esc(d.team)}</td>
          <td>
            <div class="car-lic-bar"><i style="width:${Math.min(100, (d.penalty_points / 12) * 100)}%;background:${d.penalty_points >= 9 ? "#ef4444" : (d.penalty_points >= 6 ? "#f59e0b" : "#22c55e")}"></i></div>
            <b>${esc(d.penalty_points)}/12</b>
          </td>
          <td><span class="car-lic-pill risk-${esc(d.risk).toLowerCase()}">${d.race_ban_rounds > 0 ? "1-RACE BAN" : esc(d.risk)}</span></td>
        </tr>
      `).join("");
    }

    // Power Unit Supplier Contracts
    const puEl = document.getElementById("car-pu-contracts-grid");
    if (puEl) {
      const curId = anData.puContract?.supplier_id || "";
      puEl.innerHTML = (anData.puSuppliers || []).map((s) => {
        const isCur = s.id === curId;
        return `
          <div class="car-fac-card ${isCur ? "is-active-pu" : ""}">
            <div class="car-fac-head"><b>${esc(s.name)}</b><span class="car-fac-lvl">$${esc(s.annual_fee_m)}M/yr</span></div>
            <small class="muted">${esc(s.origin)} · ${esc(s.tier)}</small>
            <div class="car-fac-bonus">Power +${esc(s.power_bonus)} · Rel +${esc(s.reliability_bonus)} · Cool +${esc(s.cooling_bonus)}</div>
            <small class="muted">${esc(s.desc)}</small>
            ${isCur
              ? '<span class="car-signed-tag">✓ ACTIVE SUPPLIER</span>'
              : `<button type="button" class="car-btn-xs car-btn-gold" data-pu-sign="${esc(s.id)}">Sign 2-Yr Deal (-$2.5M Switch)</button>`}
          </div>
        `;
      }).join("");
      puEl.querySelectorAll("[data-pu-sign]").forEach((btn) => {
        btn.addEventListener("click", () => o.onSignPu && o.onSignPu(btn.dataset.puSign));
      });
    }

    // F1 Commission Regulation Votes
    const commEl = document.getElementById("car-commission-list");
    if (commEl) {
      const comm = anData.f1Commission || {};
      const voted = comm.voted_ids || {};
      commEl.innerHTML = (comm.proposals || []).map((p) => {
        const v = voted[p.id];
        return `
          <div class="car-rd-card">
            <div class="car-rd-head"><b>🏛️ ${esc(p.title)}</b><span class="car-spec-pill">${esc(p.category)}</span></div>
            <small class="muted">${esc(p.summary)}</small>
            <div class="car-fac-bonus">${esc(p.impact)}</div>
            ${v
              ? `<span class="${v.passed ? "car-signed-tag" : "muted small"}">${v.passed ? `✅ PASSED (${v.yes_votes}/10)` : `❌ REJECTED (${v.yes_votes}/10)`}</span>`
              : `<div class="car-rd-btns">
                   <button type="button" class="car-btn-xs car-btn-red" data-comm-id="${esc(p.id)}" data-comm-yes="1">Vote YES</button>
                   <button type="button" class="car-btn-xs" data-comm-id="${esc(p.id)}" data-comm-yes="0">Vote NO</button>
                 </div>`}
          </div>
        `;
      }).join("");
      commEl.querySelectorAll("[data-comm-id]").forEach((btn) => {
        btn.addEventListener("click", () => o.onCommissionVote && o.onCommissionVote(btn.dataset.commId, btn.dataset.commYes === "1"));
      });
    }
  }

  global.CareerAnalytics = {
    drawLineChart,
    renderAnalyticsWarRoom,
    renderStrategyCurve,
    renderStewardsRoom,
  };
})(window);
