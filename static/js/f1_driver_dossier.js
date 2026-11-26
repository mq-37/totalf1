/**
 * F1DriverDossier — shared driver dossier panel (F1DB bio + photo + FIA stewarding history).
 * Used by the race analytics modal, archive analytics views and anywhere a driver name appears.
 */
(function (global) {
  "use strict";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function show(name, opts) {
    const o = opts || {};
    let panel = document.getElementById("f1-dossier-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "f1-dossier-panel";
      panel.style.cssText = [
        "position:fixed", "right:18px", "top:70px", "width:360px", "max-height:78vh", "overflow:auto",
        "z-index:10060", "background:rgba(6,12,24,0.98)", "border:1px solid #1e3a5f", "border-radius:12px",
        "padding:14px", "box-shadow:0 16px 48px rgba(0,0,0,0.6)", "color:#e2e8f0",
        "font-family:'Source Sans 3',system-ui,sans-serif",
      ].join(";");
      document.body.appendChild(panel);
    }
    panel.style.display = "block";
    panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:1rem;">${esc(name)}</b><button type="button" class="f1-dd-x" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1rem">✕</button></div><p style="color:#94a3b8">Loading F1DB dossier…</p>`;
    panel.querySelector(".f1-dd-x").addEventListener("click", () => { panel.style.display = "none"; });

    let d = null;
    try {
      const res = await fetch(`/api/analytics/driver-card/${encodeURIComponent(name)}`);
      d = await res.json();
    } catch (e) { d = null; }

    const close = () => { panel.style.display = "none"; };
    if (!d || !d.ok) {
      panel.innerHTML = `<div style="display:flex;justify-content:space-between"><b>${esc(name)}</b><button type="button" class="f1-dd-x">✕</button></div><p style="color:#94a3b8">No F1DB dossier found for this driver.</p>`;
      panel.querySelector(".f1-dd-x").addEventListener("click", close);
      return;
    }
    const v = d.driver || {};
    const counters = [
      ["Titles", v.totalChampionshipWins], ["Wins", v.totalRaceWins], ["Podiums", v.totalPodiums],
      ["Poles", v.totalPolePositions], ["Fastest laps", v.totalFastestLaps], ["Grand slams", v.totalGrandSlams],
      ["Starts", v.totalRaceStarts], ["Points", v.totalPoints],
    ];
    const deco = (val, best) => (val != null ? `<b style="color:${val <= (best || 3) ? "#facc15" : "#e2e8f0"};">${esc(String(val))}</b>` : "—");
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div>
          <b style="font-size:1.05rem;">${esc(v.fullName || v.name || name)}</b>
          <div style="color:#94a3b8;font-size:0.8rem;">${esc(v.abbreviation || "")}${v.permanentNumber ? ` · #${esc(v.permanentNumber)}` : ""} · ${esc(v.dateOfBirth || "")}${v.dateOfDeath ? " †" : ""}<br>${esc(v.placeOfBirth || "")}</div>
        </div>
        <button type="button" class="f1-dd-x" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:1rem">✕</button>
      </div>
      ${d.photo ? `<img src="/${esc(d.photo)}" alt="" style="width:100%;border-radius:8px;margin-bottom:8px" onerror="this.style.display='none'"/>` : ""}
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:8px 0;">
        ${counters.map(([k, val]) => `<div style="background:#0b1220;border-radius:6px;padding:5px 4px;text-align:center"><small style="color:#64748b;display:block;font-size:0.62rem;">${esc(k).toUpperCase()}</small><b style="color:#facc15;">${val == null ? "—" : esc(String(val))}</b></div>`).join("")}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;margin-bottom:8px;font-size:0.78rem;">
        <div style="background:#0b1220;border-radius:6px;padding:5px;text-align:center">Best title: ${deco(v.bestChampionshipPosition, 3)}</div>
        <div style="background:#0b1220;border-radius:6px;padding:5px;text-align:center">Best grid: ${deco(v.bestStartingGridPosition, 3)}</div>
        <div style="background:#0b1220;border-radius:6px;padding:5px;text-align:center">Best race: ${deco(v.bestRaceResult, 3)}</div>
      </div>
      <div style="border-top:1px solid #1e293b;margin:8px 0;padding-top:6px;">
        <b style="color:#f87171;font-size:0.85rem;">⚖️ FIA Stewarding History</b>
        ${(d.fia_decisions || []).length
          ? d.fia_decisions.map((x) => `
            <div style="margin-top:6px;background:#0b1220;border-radius:6px;padding:6px 8px;font-size:0.78rem;">
              <span style="color:#64748b;">${esc(String(x.year))} ${esc(String(x.gp || "").replace(/-/g, " "))} · ${esc(x.session || "")}</span><br>
              <b>${esc(x.offence || x.fact || "Infringement")}</b>
              ${x.penalty ? ` — <span style="color:#fca5a5;">${esc(x.penalty)}</span>${x.penalty_points ? ` (+${esc(x.penalty_points)} pts)` : ""}` : ""}
            </div>`).join("")
          : '<p style="color:#94a3b8;font-size:0.8rem;">Clean record in the FIA archive.</p>'}
      </div>
    `;
    panel.querySelector(".f1-dd-x").addEventListener("click", close);
  }

  /* Wire every element carrying data-dossier="<driver name>" inside a root (default: document). */
  function wireDossierTriggers(root) {
    (root || document).querySelectorAll("[data-dossier]").forEach((el) => {
      if (el.dataset.dossierWired) return;
      el.dataset.dossierWired = "1";
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        show(el.dataset.dossier);
      });
    });
  }

  global.F1DriverDossier = { show, wireDossierTriggers };
})(window);
