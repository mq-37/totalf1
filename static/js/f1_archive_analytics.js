/**
 * Archive Analytics charts — standardized graphs for /analytics* pages.
 * Reads page context from <script type="application/json" id="archive-page-data">
 * and draws into [data-chart="..."] placeholders via the shared F1Charts module.
 * Also wires F1DB/FIA driver dossier triggers on every /driver/ link.
 */
(function (global) {
  "use strict";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PALETTE = ["#38bdf8", "#f472b6", "#4ade80", "#facc15", "#c084fc", "#fb923c", "#22d3ee", "#f87171"];

  function pageData() {
    const tag = document.getElementById("archive-page-data");
    if (!tag) return null;
    try { return JSON.parse(tag.textContent); } catch (e) { return null; }
  }

  function ensureCanvas(host, id, height) {
    host.innerHTML = `<canvas id="${id}" style="width:100%;height:${height || 260}px"></canvas>`;
    return document.getElementById(id);
  }

  function chartHost() {
    let host = document.querySelector(".analytics-grid");
    if (!host) {
      host = document.createElement("div");
      host.className = "analytics-grid";
      const main = document.querySelector("main") || document.querySelector(".page-header")?.parentElement || document.body;
      main.appendChild(host);
    }
    return host;
  }

  function chartCard(host, title, tagLabel, canvasId, height) {
    host.insertAdjacentHTML("beforeend", `
      <section class="card mb-24" data-chart-card="${canvasId}">
        <h2>${esc(title)} ${tagLabel ? `<span class="analytics-tag">${esc(tagLabel)}</span>` : ""}</h2>
        <canvas id="${esc(canvasId)}" style="width:100%;height:${height || 260}px"></canvas>
      </section>`);
    return document.getElementById(canvasId);
  }

  const RENDER = {
    /* /analytics (landing): champion-points timeline + top totals + year wins */
    home(data) {
      const host = chartHost();
      const champs = data.driver_champions || [];
      if (champs.length >= 3) {
        const cv = chartCard(host, "Championship-Winning Points by Year", "HISTORY", "an-champ-line", 240);
        F1Charts.line(cv, {
          series: [{ label: "Champion points", color: "#facc15", bold: true, values: champs.map((c) => Number(c.points) || 0), area: true }],
          xLabels: champs.map((c) => c.year),
          yZeroBase: true,
          fmtPt: (v) => `${Math.round(v)} pts`,
          emptyText: "Championship history loading…",
        });
      }
      const totals = (data.driver_totals || []).slice(0, 15);
      if (totals.length) {
        const cv = chartCard(host, "All-Time Points Leaders (Top 15)", "F1DB CAREER TOTALS", "an-totals-bars", 320);
        F1Charts.bars(cv, {
          items: totals.map((t, i) => ({ label: t.driver_name, value: Number(t.total_points) || 0, color: PALETTE[i % PALETTE.length] })),
          fmtV: (v) => Math.round(v).toLocaleString("en-US"),
          emptyText: "No totals.",
        });
      }
      if ((data.wins || []).length) {
        const cv = chartCard(host, `Race Wins · ${data.year || ""}`, "SEASON", "an-wins-bars", 240);
        F1Charts.bars(cv, {
          items: (data.wins || []).slice(0, 12).map((w, i) => ({ label: w.driver_name || w.driver, value: Number(w.wins) || 0, color: PALETTE[i % PALETTE.length] })),
          fmtV: (v) => `${v}W`,
          emptyText: "No wins yet this season.",
        });
      }
    },

    /* /analytics/overall */
    overall(data) {
      const host = chartHost();
      const champs = data.driver_champions || [];
      if (champs.length >= 3) {
        const cv = chartCard(host, "Championship-Winning Points by Year", "HISTORY", "ov-champ-line", 240);
        F1Charts.line(cv, {
          series: [{ label: "Champion points", color: "#facc15", bold: true, values: champs.map((c) => Number(c.points) || 0), area: true }],
          xLabels: champs.map((c) => c.year),
          yZeroBase: true,
          emptyText: "Championship history loading…",
        });
      }
      const totals = (data.driver_totals || []).slice(0, 20);
      if (totals.length) {
        const cv = chartCard(host, "All-Time Points Leaders (Top 20)", "F1DB CAREER TOTALS", "ov-totals-bars", 380);
        F1Charts.bars(cv, {
          items: totals.map((t, i) => ({ label: t.driver_name, value: Number(t.total_points) || 0, color: PALETTE[i % PALETTE.length] })),
          fmtV: (v) => Math.round(v).toLocaleString("en-US"),
          emptyText: "No totals.",
        });
      }
      const teams = data.team_totals || [];
      if (teams.length) {
        const cv = chartCard(host, "Constructor All-Time Points (Top 15)", "F1DB CAREER TOTALS", "ov-team-bars", 340);
        F1Charts.bars(cv, {
          items: teams.slice(0, 15).map((t, i) => ({ label: t.team || "?", value: Number(t.total_points) || 0, color: PALETTE[i % PALETTE.length] })),
          fmtV: (v) => Math.round(v).toLocaleString("en-US"),
          emptyText: "No totals.",
        });
      }
    },

    /* /analytics/season */
    season(data, page) {
      const host = chartHost();
      if (!host) return;
      const stds = (data.driver_standings || []).slice(0, 12);
      if (stds.length) {
        const cv = chartCard(host, `Final Standings Points · ${data.year}`, "SEASON", "sn-std-bars", 300);
        F1Charts.bars(cv, {
          items: stds.map((s, i) => ({ label: s.driver || s.name, value: Number(s.points) || 0, color: PALETTE[i % PALETTE.length] })),
          fmtV: (v) => Math.round(v),
          emptyText: "Season standings loading…",
        });
      }
      const wins = data.wins || [];
      if (wins.length) {
        const cv = chartCard(host, `Race Wins Distribution · ${data.year}`, "SEASON", "sn-wins-bars", 240);
        F1Charts.bars(cv, {
          items: wins.slice(0, 12).map((w, i) => ({ label: w.driver, value: Number(w.wins) || 0, color: PALETTE[i % PALETTE.length] })),
          fmtV: (v) => `${v}W`,
          emptyText: "No wins yet this season.",
        });
      }
      const teamPts = data.team_points || [];
      if (teamPts.length) {
        const cv = chartCard(host, `Constructor Points · ${data.year}`, "SEASON", "sn-team-bars", 300);
        F1Charts.bars(cv, {
          items: teamPts.slice(0, 12).map((t, i) => ({ label: t.team, value: Number(t.total_points) || Number(t.points) || 0, color: PALETTE[i % PALETTE.length] })),
          fmtV: (v) => Math.round(v),
          emptyText: "No constructor points yet.",
        });
      }
      /* Champion trajectory from real F1DB race standings */
      const champ = stds[0]?.driver;
      if (champ) {
        const cv = chartCard(host, `${champ} — Career Season Trajectory`, "F1DB RACE STANDINGS", "sn-prog-line", 260);
        fetch(`/api/analytics/driver-progression/${encodeURIComponent(champ)}`)
          .then((r) => r.json())
          .then((pj) => {
            if (!pj.ok) { F1Charts.line(cv, { series: [], emptyText: "No F1DB progression found." }); return; }
            const seasons = pj.seasons || [];
            F1Charts.line(cv, {
              series: [{ label: `${pj.driver.name} season points`, color: "#38bdf8", bold: true, values: seasons.map((s) => s.points), area: true }],
              xLabels: seasons.map((s) => s.year),
              yZeroBase: true,
              tooltipHead: (x) => `${pj.driver.name} — ${Math.round(x)}`,
              tooltipRows: (x) => {
                const y = seasons[Math.max(0, Math.min(seasons.length - 1, Math.round(x)))];
                return y ? [`<b>${y.year}</b> ${Math.round(y.points)} pts · best P${y.best_pos} · ${y.races} races · ${y.gained >= 0 ? "+" : ""}${y.gained} gained`] : [];
              },
              emptyText: "No progression.",
            });
          })
          .catch(() => F1Charts.line(cv, { series: [], emptyText: "No F1DB progression found." }));
      }
    },

    /* /analytics/team */
    team(data) {
      const host = chartHost();
      if (!host) return;
      const seasons = data.seasons || [];
      if (seasons.length >= 2) {
        const cv = chartCard(host, `${data.team || "Team"} — Points per Season`, "F1DB STANDINGS", "tm-pts-line", 260);
        F1Charts.line(cv, {
          series: [{ label: `${data.team} points`, color: "#38bdf8", bold: true, values: seasons.map((s) => Number(s.points) || 0), area: true }],
          xLabels: seasons.map((s) => s.year),
          yZeroBase: true,
          tooltipHead: (x) => `${data.team} — ${Math.round(x)}`,
          tooltipRows: (x) => {
            const y = seasons[Math.max(0, Math.min(seasons.length - 1, Math.round(x)))];
            return y ? [`<b>${y.year}</b> ${Math.round(y.points)} pts (driver points total)`] : [];
          },
          emptyText: "Pick a team to plot its points history.",
        });
      }
      /* Rival comparison: fetch 3 famous teams' histories for context lines. */
      const cv2 = chartCard(host, "Big-Team Benchmarks", "F1DB HISTORY", "tm-bench-line", 260);
      const rivals = ["ferrari", "mclaren", "williams", "mercedes", "red-bull"];
      Promise.all(rivals.map((t) =>
        fetch(`/api/analytics/team-points-history/${t}`).then((r) => r.json()).catch(() => null)
      )).then((results) => {
        const series = [];
        results.forEach((pj, i) => {
          if (!pj || !pj.ok) return;
          const seasons2 = pj.seasons || [];
          if (seasons2.length < 2) return;
          series.push({
            label: pj.team.name, color: PALETTE[i % PALETTE.length], bold: i === 0,
            values: seasons2.map((s) => s.points),
            xs: seasons2.map((s) => s.year),
            noDots: true,
          });
        });
        F1Charts.line(cv2, {
          series,
          yZeroBase: true,
          fmtX: (x) => String(Math.round(x)),
          tooltipHead: (x) => `Season ${Math.round(x)}`,
          tooltipRows: (x) => series.map((s) => {
            const xs = s.xs || [];
            const i = xs.indexOf(Math.round(x));
            return i >= 0 ? `<span style="color:${esc(s.color)}">●</span> <b>${esc(s.label)}</b> ${Math.round(s.values[i])} pts` : null;
          }).filter(Boolean),
          emptyText: "Benchmark histories loading…",
        });
      });
    },

    /* /analytics/tracks */
    tracks(data) {
      const host = chartHost();
      if (!host) return;
      const counts = data.track_championship_counts || {};
      const entries = Object.entries(counts).slice(0, 12);
      if (entries.length) {
        const cv = chartCard(host, "Track Championship Titles per Driver", "CIRCUIT SPECIALISTS", "tr-counts-bars", 260);
        F1Charts.bars(cv, {
          items: entries.map(([driver, n], i) => ({ label: driver, value: n, color: PALETTE[i % PALETTE.length] })),
          fmtV: (v) => `${v}×`,
          emptyText: "No track champions yet.",
        });
      }
      const cv2 = chartCard(host, "All-Time Winningest Circuits & Their Kings", "F1DB RACE RESULTS", "tr-kings", 320);
      fetch("/api/analytics/track-wins?limit=16")
        .then((r) => r.json())
        .then((tw) => {
          const tracks = tw.tracks || [];
          F1Charts.bars(cv2, {
            items: tracks.map((t, i) => ({
              label: `${t.name} — ${t.top_driver} (${t.top_wins}W)`,
              value: Number(t.totalRacesHeld) || 0,
              color: PALETTE[i % PALETTE.length],
            })),
            fmtV: (v) => `${v} GPs`,
            emptyText: "Track history loading…",
          });
        })
        .catch(() => F1Charts.bars(cv2, { items: [], emptyText: "Track history loading…" }));
    },
  };

  function boot() {
    const data = pageData();
    const page = global.__ARCHIVE_PAGE__ || document.body.dataset.archivePage || "home";
    if (data && RENDER[page]) {
      try { RENDER[page](data, page); } catch (e) { console.warn("analytics chart failed:", e); }
    }
    if (global.F1DriverDossier) global.F1DriverDossier.wireDossierTriggers(document);
    /* F1DB/FIA enrichment: ⓘ trigger beside every driver link in analytics tables. */
    document.querySelectorAll('a[href^="/driver/"]').forEach((a) => {
      if (a.dataset.dossierWired) return;
      a.dataset.dossierWired = "1";
      const name = decodeURIComponent(a.getAttribute("href").replace("/driver/", "")).replace(/-/g, " ");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "ⓘ";
      btn.title = `F1DB dossier + FIA record — ${name}`;
      btn.style.cssText = "margin-left:5px;background:none;border:1px solid rgba(148,163,184,0.35);border-radius:4px;color:#94a3b8;cursor:pointer;font-size:0.68rem;padding:1px 4px;line-height:1.2;";
      btn.dataset.dossier = name;
      a.insertAdjacentElement("afterend", btn);
    });
    if (global.F1DriverDossier) global.F1DriverDossier.wireDossierTriggers(document);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
