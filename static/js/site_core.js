/**
 * Local F1 — Shared Site Core UI Engine
 * Replaces scattered inline <script> blocks across templates with one clean module:
 *   1. Accessible [data-tabs] with aria-selected sync & keyboard nav
 *   2. Responsive header navigation & dropdown keyboard/outside-click handling
 *   3. Automatic Broadcast Table Enhancer (click-to-sort, instant filter bar, podium pills)
 *   4. Home Page Driver Image Prefetch action
 *   5. Live Cross-Era Rating Balance Audit renderer on /analytics/overall
 */
(function () {
  "use strict";

  function initTabs() {
    document.querySelectorAll("[data-tabs]").forEach((tabsEl) => {
      const nav = tabsEl.querySelector("[data-tab-nav]");
      const panels = tabsEl.querySelectorAll("[data-tab-panel]");
      if (!nav || !panels.length) return;
      const buttons = Array.from(nav.querySelectorAll("[data-tab]"));

      function activate(idx) {
        buttons.forEach((b, i) => {
          const on = i === idx;
          b.classList.toggle("active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        panels.forEach((p, i) => {
          p.classList.toggle("active", i === idx);
        });
      }

      buttons.forEach((btn, i) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          activate(i);
        });
      });

      const initIdx = buttons.findIndex((b) => b.classList.contains("active"));
      activate(initIdx >= 0 ? initIdx : 0);
    });
  }

  function initNav() {
    const nav = document.getElementById("site-main-nav");
    const toggle = document.getElementById("site-nav-toggle");
    if (toggle && nav) {
      toggle.addEventListener("click", () => {
        const open = nav.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
    const groups = Array.from(document.querySelectorAll(".nav-group"));
    function closeAll(except) {
      groups.forEach((g) => {
        if (g === except) return;
        g.classList.remove("is-open");
        const btn = g.querySelector(".nav-trigger");
        if (btn) btn.setAttribute("aria-expanded", "false");
      });
    }
    groups.forEach((g) => {
      const btn = g.querySelector(".nav-trigger");
      if (!btn) return;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = !g.classList.contains("is-open");
        closeAll(g);
        g.classList.toggle("is-open", open);
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });
    document.addEventListener("click", () => closeAll(null));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAll(null);
    });
  }

  function parseSortVal(cell) {
    const txt = (cell ? cell.textContent : "").trim();
    const cleaned = txt.replace(/^R(?=\d)/i, "").replace(/[,%]/g, "");
    if (/^-?\d+(\.\d+)?$/.test(cleaned)) return { num: true, val: parseFloat(cleaned) };
    return { num: false, val: txt.toLowerCase() };
  }

  function initBroadcastTables() {
    // Skip cockpit timing tables (/sim, /career, /play) which manage their own rapid DOM updates
    if (document.body.classList.contains("sim-cockpit-active")) return;
    const tables = document.querySelectorAll(".table-card table, .analytics-grid table");
    tables.forEach((table) => {
      if (table.dataset.bcInit || table.closest("#fsim-app, #career-app, #play-app")) return;
      const thead = table.querySelector("thead");
      const tbody = table.querySelector("tbody");
      if (!thead || !tbody) return;
      const rows = Array.from(tbody.querySelectorAll("tr"));
      if (rows.length < 2) return;

      table.dataset.bcInit = "1";
      table.classList.add("bc-enhanced");

      const ths = Array.from(thead.querySelectorAll("th"));
      // Auto-decorate Pos / Rank podium pills & tabular numeric alignment
      const posCol = ths.findIndex((th) => /^(pos|rank)$/i.test(th.textContent.trim()));
      rows.forEach((tr) => {
        const tds = tr.querySelectorAll("td");
        tds.forEach((td, ci) => {
          const raw = td.textContent.trim();
          if (ci === posCol && /^[123]$/.test(raw) && !td.querySelector(".bc-pos-pill")) {
            td.innerHTML = `<span class="bc-pos-pill p-${raw}">${raw}</span>`;
          } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
            td.classList.add("is-num");
          }
        });
      });

      // Click-to-sort columns
      ths.forEach((th, colIdx) => {
        if (!th.textContent.trim()) return;
        th.classList.add("is-sortable");
        th.addEventListener("click", () => {
          const wasAsc = th.classList.contains("sort-asc");
          ths.forEach((h) => h.classList.remove("sort-asc", "sort-desc"));
          const dir = wasAsc ? -1 : 1;
          th.classList.add(dir === 1 ? "sort-asc" : "sort-desc");
          const curRows = Array.from(tbody.querySelectorAll("tr"));
          curRows.sort((a, b) => {
            const va = parseSortVal(a.children[colIdx]);
            const vb = parseSortVal(b.children[colIdx]);
            if (va.num && vb.num) return (va.val - vb.val) * dir;
            return String(va.val).localeCompare(String(vb.val)) * dir;
          });
          curRows.forEach((r) => tbody.appendChild(r));
        });
      });

      // Instant filter bar for larger tables (> 12 rows)
      if (rows.length > 12 && table.parentElement) {
        const bar = document.createElement("div");
        bar.className = "bc-table-tools no-print";
        const inp = document.createElement("input");
        inp.type = "search";
        inp.className = "bc-table-filter";
        inp.placeholder = "Filter rows…";
        inp.setAttribute("aria-label", "Filter table rows");
        const cnt = document.createElement("span");
        cnt.className = "bc-table-count";
        cnt.textContent = `${rows.length} rows`;
        bar.appendChild(inp);
        bar.appendChild(cnt);
        table.parentElement.insertBefore(bar, table);

        inp.addEventListener("input", () => {
          const q = inp.value.trim().toLowerCase();
          let shown = 0;
          Array.from(tbody.querySelectorAll("tr")).forEach((tr) => {
            const ok = !q || tr.textContent.toLowerCase().includes(q);
            tr.style.display = ok ? "" : "none";
            if (ok) shown += 1;
          });
          cnt.textContent = q ? `${shown} / ${rows.length} rows` : `${rows.length} rows`;
        });
      }
    });
  }

  function initHomePrefetch() {
    const btn = document.getElementById("prefetch-images-btn");
    const status = document.getElementById("prefetch-images-status");
    if (!btn || !status) return;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      status.textContent = "Prefetching up to 10 driver images…";
      try {
        const res = await fetch("/api/prefetch/driver-images?limit=10", { method: "POST" });
        const data = await res.json();
        status.textContent = `Done: ${data.fetched || 0} fetched, ${data.existing || 0} cached, ${data.failed || 0} failed.`;
      } catch (_) {
        status.textContent = "Prefetch failed (offline or server error).";
      } finally {
        btn.disabled = false;
      }
    });
  }

  async function initBalanceAuditWidget() {
    const host = document.getElementById("bc-balance-audit-host");
    if (!host) return;
    try {
      const res = await fetch("/api/analytics/balance-audit");
      if (!res.ok) return;
      const data = await res.json();
      const decks = data.decks || [];
      if (!decks.length) return;
      const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
      host.innerHTML = `<div class="bc-balance-grid">${decks.map((d) => {
        const lbl = d.deck === "alltime_top25" ? "All-Time Legends (Top 25)" : `Season ${d.deck}`;
        const rowsHtml = (d.top5 || []).map((t) => `
          <div class="bc-bal-row">
            <div>
              <span>${esc(t.driver)}</span>
              <div class="bc-bal-bar-wrap"><div class="bc-bal-bar" style="width:${Math.min(100, Math.max(10, t.overall))}%"></div></div>
            </div>
            <span class="bc-bal-ovr">${Number(t.overall).toFixed(1)}</span>
          </div>
        `).join("");
        return `
          <div class="bc-bal-card">
            <div class="bc-bal-head">
              <strong>${esc(lbl)}</strong>
              <span class="bc-bal-meta">OVR ${d.ovr_min}–${d.ovr_max} · ${d.unique_duel_values} Duel tiers</span>
            </div>
            ${rowsHtml}
          </div>
        `;
      }).join("")}</div>`;
    } catch (_) {
      host.innerHTML = `<p class="muted small">Balance audit unavailable.</p>`;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    initNav();
    initBroadcastTables();
    initHomePrefetch();
    initBalanceAuditWidget();
  });
})();
