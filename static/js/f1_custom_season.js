/**
 * Shared Custom Season Builder Modal (/sim & /career).
 * Full control of:
 *   - Season Name & Era Technical Rules (1950s..2026 + Refuelling/DRS/Override/2-Compound toggles)
 *   - Custom Calendar picked from all 79 F1 circuits (+ 1-click era calendar presets!)
 *   - Custom Teams, Liveries, Car Eras, Drivers & Race Engineers
 *   - Market & Silly Season Rules
 * Persisted in SQLite via /api/custom-seasons so your custom seasons work in BOTH /sim and /career!
 */
(function (global) {
  "use strict";

  const ENG = global.F1RaceEngine;
  const esc = ENG ? ENG.esc : (s) => String(s == null ? "" : s);

  let modalEl = null;
  let presets = null;
  let savedList = [];
  let selectedCalendar = [];
  let customTeams = [];
  let onLaunchCb = null;

  async function loadMeta() {
    if (!presets) {
      const r = await fetch("/api/custom-seasons/presets");
      if (r.ok) presets = await r.json();
    }
    const sr = await fetch("/api/custom-seasons");
    if (sr.ok) {
      const d = await sr.json();
      savedList = d.seasons || [];
    }
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement("div");
    modalEl.id = "f1-custom-season-modal";
    modalEl.className = "ras-backdrop hidden";
    modalEl.setAttribute("role", "dialog");
    modalEl.setAttribute("aria-modal", "true");
    modalEl.innerHTML = `
      <div class="ras-shell" style="max-width:1120px;">
        <div class="ras-head">
          <div class="ras-title-wrap">
            <span class="ras-badge"><i class="fas fa-sliders-h"></i> CUSTOM SEASON BUILDER</span>
            <strong>Full Control: Era Rules · All 79 Circuits · Teams · Drivers · Engineers</strong>
          </div>
          <button type="button" id="csb-close" class="ras-close">&times;</button>
        </div>
        <div class="ras-body" style="overflow-y:auto;gap:12px;">
          <div class="csb-saved-strip" id="csb-saved-strip"></div>

          <div class="csb-grid">
            <div class="ras-card">
              <div class="ras-card-head"><span>1. SEASON IDENTITY &amp; ERA RULES</span></div>
              <div class="csb-form-row">
                <label>Season Name <input type="text" id="csb-name" value="2026 World Championship Custom" maxlength="44"></label>
                <label>Base Regulation Era <select id="csb-era"></select></label>
                <label>Race Distance
                  <select id="csb-laps">
                    <option value="10">10 Laps</option>
                    <option value="15" selected>15 Laps</option>
                    <option value="25">25 Laps</option>
                    <option value="full">Full Real GP Laps</option>
                  </select>
                </label>
              </div>
              <div class="csb-checks">
                <label><input type="checkbox" id="csb-refuel"> In-Race Refuelling</label>
                <label><input type="checkbox" id="csb-drs"> DRS Wing</label>
                <label><input type="checkbox" id="csb-override" checked> 2026 Manual Override</label>
                <label><input type="checkbox" id="csb-ers" checked> Hybrid ERS</label>
                <label><input type="checkbox" id="csb-twocomp" checked> 2-Compound Dry Rule</label>
              </div>
              <div class="csb-form-row" style="margin-top:8px;">
                <label>Transfer Market Mode
                  <select id="csb-mkt-mode">
                    <option value="normal" selected>Realistic Silly Season</option>
                    <option value="chaotic">Chaotic Silly Season</option>
                    <option value="locked">Locked Rosters</option>
                  </select>
                </label>
                <label>Budget Cap ($M) <input type="number" id="csb-cap" value="135" min="60" max="300"></label>
              </div>
            </div>

            <div class="ras-card">
              <div class="ras-card-head">
                <span>2. CUSTOM CALENDAR (<b id="csb-cal-cnt">0</b> ROUNDS · ALL 79 TRACKS)</span>
                <div style="display:flex;gap:4px;">
                  <button type="button" class="car-btn-xs" data-csb-preset="modern_24">2026 (24)</button>
                  <button type="button" class="car-btn-xs" data-csb-preset="golden_80s">1980s (14)</button>
                  <button type="button" class="car-btn-xs" data-csb-preset="classic_legends">Legends (12)</button>
                </div>
              </div>
              <input type="text" id="csb-cir-search" placeholder="Filter all 79 circuits (e.g. Imola, Nordschleife, Adelaide, Monaco)…" style="margin-bottom:6px;padding:5px 8px;border-radius:6px;background:#0f172a;color:#fff;border:1px solid rgba(148,163,184,0.3);">
              <div id="csb-cir-list" class="csb-cir-list"></div>
            </div>
          </div>

          <div class="ras-card">
            <div class="ras-card-head">
              <span>3. CUSTOM TEAMS, CARS, DRIVERS &amp; RACE ENGINEERS (OPTIONAL — EMPTY USES ERA GRID)</span>
              <button type="button" id="csb-add-team" class="car-btn-xs car-btn-gold"><i class="fas fa-plus"></i> Add Custom Team</button>
            </div>
            <div id="csb-teams-list" class="csb-teams-list"></div>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;padding-top:4px;">
            <button type="button" id="csb-save-btn" class="sim-dir-btn"><i class="fas fa-save"></i> Save Custom Season</button>
            <button type="button" id="csb-launch-btn" class="btn-racing"><i class="fas fa-flag-checkered"></i> Save &amp; Launch Championship</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    modalEl.querySelector("#csb-close").addEventListener("click", close);
    modalEl.addEventListener("click", (ev) => { if (ev.target === modalEl) close(); });
    modalEl.querySelector("#csb-era").addEventListener("change", syncEraChecks);
    modalEl.querySelector("#csb-cir-search").addEventListener("input", renderCircuits);
    modalEl.querySelectorAll("[data-csb-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.csbPreset;
        if (presets && presets.calendar_presets && presets.calendar_presets[key]) {
          selectedCalendar = presets.calendar_presets[key].slice();
          renderCircuits();
        }
      });
    });
    modalEl.querySelector("#csb-add-team").addEventListener("click", () => {
      const idx = customTeams.length + 1;
      const cols = ["#e10600", "#0284c7", "#22c55e", "#f59e0b", "#a855f7", "#ec4899"];
      customTeams.push({
        name: `Custom GP #${idx}`,
        color: cols[idx % cols.length],
        car_era: "2020s",
        car_overall: 84,
        drivers: [
          { name: `Driver ${idx}A`, code3: `D${idx}A`, overall: 85, engineer: "Marco Bellini" },
          { name: `Driver ${idx}B`, code3: `D${idx}B`, overall: 82, engineer: "Claire Bennett" },
        ],
      });
      renderTeams();
    });
    modalEl.querySelector("#csb-save-btn").addEventListener("click", () => saveSeason(false));
    modalEl.querySelector("#csb-launch-btn").addEventListener("click", () => saveSeason(true));
    return modalEl;
  }

  function syncEraChecks() {
    if (!presets || !modalEl) return;
    const key = modalEl.querySelector("#csb-era").value;
    const er = (presets.eras || []).find((e) => e.key === key);
    if (!er) return;
    modalEl.querySelector("#csb-refuel").checked = !!er.refuelling;
    modalEl.querySelector("#csb-drs").checked = !!er.drs_enabled;
    modalEl.querySelector("#csb-override").checked = !!er.override_mode;
    modalEl.querySelector("#csb-ers").checked = !!er.ers_enabled;
    modalEl.querySelector("#csb-twocomp").checked = !!er.two_compound_rule;
  }

  function renderSavedStrip() {
    const box = modalEl.querySelector("#csb-saved-strip");
    if (!savedList.length) {
      box.innerHTML = `<span class="muted small">No saved Custom Seasons yet — configure below &amp; save to reuse in both /sim and /career!</span>`;
      return;
    }
    box.innerHTML = `<span class="muted small">Saved Seasons:</span> ` + savedList.map((s) => `
      <span class="csb-saved-pill">
        <button type="button" data-csb-load="${esc(s.season_id)}"><b>${esc(s.name)}</b> (${(s.config.calendar || []).length}R · ${esc(s.config.era_key)})</button>
        <button type="button" data-csb-del="${esc(s.season_id)}" title="Delete">&times;</button>
      </span>
    `).join("");
    box.querySelectorAll("[data-csb-load]").forEach((b) => {
      b.addEventListener("click", () => {
        const s = savedList.find((x) => x.season_id === b.dataset.csbLoad);
        if (!s) return;
        const c = s.config || {};
        modalEl.querySelector("#csb-name").value = s.name || "Custom Season";
        modalEl.querySelector("#csb-era").value = c.era_key || "2026";
        syncEraChecks();
        if (c.era_rules) {
          modalEl.querySelector("#csb-refuel").checked = !!c.era_rules.refuelling;
          modalEl.querySelector("#csb-drs").checked = !!c.era_rules.drs_enabled;
          modalEl.querySelector("#csb-override").checked = !!c.era_rules.override_mode;
          modalEl.querySelector("#csb-ers").checked = !!c.era_rules.ers_enabled;
          modalEl.querySelector("#csb-twocomp").checked = !!c.era_rules.two_compound_rule;
        }
        selectedCalendar = (c.calendar || []).slice();
        customTeams = (c.teams || []).map((t) => JSON.parse(JSON.stringify(t)));
        renderCircuits();
        renderTeams();
      });
    });
    box.querySelectorAll("[data-csb-del]").forEach((b) => {
      b.addEventListener("click", async () => {
        await fetch(`/api/custom-seasons/${encodeURIComponent(b.dataset.csbDel)}`, { method: "DELETE" });
        await loadMeta();
        renderSavedStrip();
      });
    });
  }

  function renderCircuits() {
    if (!presets || !modalEl) return;
    const q = (modalEl.querySelector("#csb-cir-search").value || "").trim().toLowerCase();
    const list = (presets.circuits || []).filter((c) => !q || `${c.name} ${c.country} ${c.gp} ${c.era_years || ""}`.toLowerCase().includes(q));
    modalEl.querySelector("#csb-cal-cnt").textContent = String(selectedCalendar.length);
    const box = modalEl.querySelector("#csb-cir-list");
    box.innerHTML = list.map((c) => {
      const idx = selectedCalendar.indexOf(c.id);
      const on = idx >= 0;
      return `
        <button type="button" class="csb-cir-chip${on ? " is-on" : ""}" data-csb-cid="${esc(c.id)}">
          <span>${on ? `<b>R${idx + 1}</b> ` : ""}${esc(c.name)}</span>
          <small>${esc(c.country)} ${c.category === "classic" ? "★" : ""}</small>
        </button>
      `;
    }).join("");
    box.querySelectorAll("[data-csb-cid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cid = btn.dataset.csbCid;
        const i = selectedCalendar.indexOf(cid);
        if (i >= 0) selectedCalendar.splice(i, 1);
        else selectedCalendar.push(cid);
        renderCircuits();
      });
    });
  }

  function renderTeams() {
    const box = modalEl.querySelector("#csb-teams-list");
    if (!customTeams.length) {
      box.innerHTML = `<div class="muted small">Using authentic grid for selected Era. Click <b>Add Custom Team</b> above to create custom constructors, drivers &amp; engineers!</div>`;
      return;
    }
    box.innerHTML = customTeams.map((t, ti) => `
      <div class="csb-team-row">
        <input type="color" value="${esc(t.color)}" data-ct-i="${ti}" data-ct-f="color">
        <input type="text" value="${esc(t.name)}" data-ct-i="${ti}" data-ct-f="name" placeholder="Team Name">
        <input type="number" value="${t.car_overall}" min="60" max="99" data-ct-i="${ti}" data-ct-f="car_overall" title="Car OVR" style="width:58px;">
        <input type="text" value="${esc(t.drivers[0].name)}" data-ct-i="${ti}" data-ct-d="0" data-ct-f="name" placeholder="Driver #1">
        <input type="text" value="${esc(t.drivers[0].engineer)}" data-ct-i="${ti}" data-ct-d="0" data-ct-f="engineer" placeholder="Eng #1">
        <input type="text" value="${esc(t.drivers[1].name)}" data-ct-i="${ti}" data-ct-d="1" data-ct-f="name" placeholder="Driver #2">
        <input type="text" value="${esc(t.drivers[1].engineer)}" data-ct-i="${ti}" data-ct-d="1" data-ct-f="engineer" placeholder="Eng #2">
        <button type="button" class="car-btn-xs" data-ct-rm="${ti}">✕</button>
      </div>
    `).join("");
    box.querySelectorAll("input[data-ct-i]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const ti = Number(inp.dataset.ctI);
        const f = inp.dataset.ctF;
        if (inp.dataset.ctD != null) {
          const di = Number(inp.dataset.ctD);
          customTeams[ti].drivers[di][f] = inp.value;
          if (f === "name") customTeams[ti].drivers[di].code3 = inp.value.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "DRV";
        } else {
          customTeams[ti][f] = f === "car_overall" ? Number(inp.value) : inp.value;
        }
      });
    });
    box.querySelectorAll("[data-ct-rm]").forEach((b) => {
      b.addEventListener("click", () => { customTeams.splice(Number(b.dataset.ctRm), 1); renderTeams(); });
    });
  }

  async function saveSeason(andLaunch) {
    const payload = {
      name: modalEl.querySelector("#csb-name").value.trim() || "Custom F1 Season",
      era_key: modalEl.querySelector("#csb-era").value,
      race_laps: modalEl.querySelector("#csb-laps").value,
      rule_overrides: {
        refuelling: modalEl.querySelector("#csb-refuel").checked,
        drs_enabled: modalEl.querySelector("#csb-drs").checked,
        override_mode: modalEl.querySelector("#csb-override").checked,
        ers_enabled: modalEl.querySelector("#csb-ers").checked,
        two_compound_rule: modalEl.querySelector("#csb-twocomp").checked,
      },
      calendar: selectedCalendar.slice(),
      teams: customTeams,
      market_rules: {
        transfer_mode: modalEl.querySelector("#csb-mkt-mode").value,
        budget_cap_m: Number(modalEl.querySelector("#csb-cap").value) || 135,
        feeder_promotions: true,
      },
    };
    const res = await fetch("/api/custom-seasons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    await loadMeta();
    renderSavedStrip();
    if (andLaunch && typeof onLaunchCb === "function") {
      close();
      onLaunchCb(data.config || payload);
    }
  }

  async function open(opts) {
    const o = opts || {};
    onLaunchCb = o.onLaunch || null;
    ensureModal();
    await loadMeta();

    const eraSel = modalEl.querySelector("#csb-era");
    eraSel.innerHTML = ((presets && presets.eras) || []).map((e) => `<option value="${esc(e.key)}">${esc(e.label)}</option>`).join("");
    eraSel.value = "2026";
    syncEraChecks();

    if (!selectedCalendar.length && presets && presets.calendar_presets) {
      selectedCalendar = presets.calendar_presets.classic_legends.slice();
    }
    renderSavedStrip();
    renderCircuits();
    renderTeams();
    modalEl.classList.remove("hidden");
  }

  function close() {
    if (modalEl) modalEl.classList.add("hidden");
  }

  global.F1CustomSeason = { open, close };
})(window);
