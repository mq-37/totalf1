/**
 * Shared Unified Player Profile & 20-Achievement Trophy Cabinet (/career & /play).
 * Backed by data/career_saves.sqlite via GET /api/profile & POST /api/profile/event.
 */
(function () {
  "use strict";

  let profileData = null;
  let modalInjected = false;

  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureModal() {
    if (modalInjected) return;
    modalInjected = true;
    const wrap = document.createElement("div");
    wrap.id = "f1-trophy-modal";
    wrap.className = "tut-backdrop hidden";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.innerHTML = `
      <div class="tut-dialog f1-prof-dialog">
        <div class="tut-head">
          <span class="tut-step-badge"><i class="fas fa-trophy"></i> F1 PLAYER PROFILE &amp; TROPHY CABINET</span>
          <button type="button" id="f1-trophy-close" class="tut-close">&times;</button>
        </div>
        <div id="f1-trophy-body" class="f1-prof-body"></div>
        <div class="tut-foot">
          <span id="f1-trophy-rank-foot" class="muted small"></span>
          <button type="button" id="f1-trophy-ok" class="btn-racing">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    document.getElementById("f1-trophy-close").addEventListener("click", () => wrap.classList.add("hidden"));
    document.getElementById("f1-trophy-ok").addEventListener("click", () => wrap.classList.add("hidden"));
    wrap.addEventListener("click", (e) => { if (e.target === wrap) wrap.classList.add("hidden"); });

    // Global achievement unlock toast
    const toast = document.createElement("div");
    toast.id = "f1-ach-toast";
    toast.className = "f1-ach-toast hidden";
    document.body.appendChild(toast);
  }

  let achTimer = null;
  function showUnlockToasts(newlyUnlocked) {
    if (!Array.isArray(newlyUnlocked) || !newlyUnlocked.length) return;
    ensureModal();
    const el = document.getElementById("f1-ach-toast");
    if (!el) return;
    const a = newlyUnlocked[0];
    const extra = newlyUnlocked.length > 1 ? ` (+${newlyUnlocked.length - 1} more!)` : "";
    el.innerHTML = `
      <span class="f1-ach-ico"><i class="fas ${esc(a.icon || "fa-trophy")}"></i></span>
      <div>
        <small>🏆 TROPHY UNLOCKED${extra}</small>
        <strong>${esc(a.name)}</strong>
        <span>${esc(a.desc)}</span>
      </div>
    `;
    el.classList.remove("hidden");
    clearTimeout(achTimer);
    achTimer = setTimeout(() => el.classList.add("hidden"), 4800);
  }

  function updatePills(data) {
    if (!data) return;
    document.querySelectorAll("[data-f1-trophy-pill]").forEach((btn) => {
      btn.innerHTML = `<i class="fas fa-trophy"></i> <span>${data.unlocked_count || 0}/${data.total_count || 20}</span>`;
      btn.title = `${data.rank || "Pit Wall Rookie"} — Open Profile & Trophy Cabinet`;
    });
  }

  function renderModal(data) {
    ensureModal();
    const st = data.stats || {};
    const body = document.getElementById("f1-trophy-body");
    const foot = document.getElementById("f1-trophy-rank-foot");
    if (foot) foot.textContent = `Rank: ${data.rank || "Pit Wall Rookie"} · ${data.unlocked_count || 0} / ${data.total_count || 20} Trophies Unlocked`;
    if (!body) return;

    const kpis = [
      ["CAREER GPs", `${st.career_races || 0} (${st.career_wins || 0}W)`],
      ["CAREER TITLES", `${st.career_wcc_titles || 0} WCC · ${st.career_wdc_titles || 0} WDC`],
      ["CARD BATTLES", `${st.card_battles_won || 0}/${st.card_battles_played || 0} (Best ${st.card_best_streak || 0}🔥)`],
      ["TRACK SIM", `${st.track_sim_wins || 0}W · ${st.track_sim_podiums || 0}P (${st.track_sim_races || 0})`],
      ["MYSTERY DRIVER", `${st.mystery_solved || 0} Solved`],
      ["3D DUELS WON", `${st.duels_won || 0}`],
    ];

    body.innerHTML = `
      <div class="f1-prof-rank-bar">
        <div>
          <small class="muted">CAREER &amp; PADDOCK RANK</small>
          <h3>${esc(data.rank || "Pit Wall Rookie")}</h3>
        </div>
        <div class="f1-prof-prog">
          <b>${data.unlocked_count || 0} / ${data.total_count || 20}</b>
          <div class="sim-bar-track"><div class="sim-bar-fill" style="width:${Math.round(((data.unlocked_count || 0) / Math.max(1, data.total_count || 20)) * 100)}%;background:#facc15"></div></div>
        </div>
      </div>
      <div class="f1-prof-kpis">
        ${kpis.map(([lbl, val]) => `<div class="f1-prof-kpi"><small>${lbl}</small><b>${esc(val)}</b></div>`).join("")}
      </div>
      <div class="f1-ach-grid">
        ${(data.achievements || []).map((a) => `
          <div class="f1-ach-card ${a.unlocked ? "is-unlocked" : "is-locked"}">
            <span class="f1-ach-badge"><i class="fas ${esc(a.icon || "fa-trophy")}"></i></span>
            <div class="f1-ach-info">
              <div class="f1-ach-top"><b>${esc(a.name)}</b><small>${esc(a.cat)}</small></div>
              <p>${esc(a.desc)}</p>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  async function refresh() {
    try {
      const r = await fetch("/api/profile");
      if (!r.ok) return null;
      profileData = await r.json();
      updatePills(profileData);
      return profileData;
    } catch (e) {
      return null;
    }
  }

  async function open() {
    ensureModal();
    const d = await refresh();
    if (d) renderModal(d);
    document.getElementById("f1-trophy-modal").classList.remove("hidden");
  }

  async function recordEvent(eventType, payload) {
    try {
      const r = await fetch("/api/profile/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_type: eventType, payload: payload || {} }),
      });
      if (!r.ok) return null;
      const d = await r.json();
      profileData = d;
      updatePills(d);
      if (d.newly_unlocked && d.newly_unlocked.length) showUnlockToasts(d.newly_unlocked);
      return d;
    } catch (e) {
      return null;
    }
  }

  function applyBoot(prof) {
    if (!prof) return;
    profileData = prof;
    updatePills(prof);
  }

  document.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-f1-trophy-pill]")) {
      open();
    }
  });

  window.F1Profile = { refresh, open, recordEvent, showUnlockToasts, applyBoot };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refresh);
  } else {
    refresh();
  }
})();
