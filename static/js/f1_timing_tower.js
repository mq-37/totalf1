/**
 * Shared F1 Manager-Inspired Multi-Mode Live Timing Tower (/sim & /career).
 *
 * Switchable sidebar views (zero vertical scroll):
 *   - int     : Interval to car ahead + Tyre + Stops
 *   - ldr     : Gap to Leader + Tyre + Stops
 *   - laps    : Last Lap + Best Lap (purple overall fastest!)
 *   - sectors : Live colour-coded S1 · S2 · S3 split boxes (purple/green/yellow)
 *   - tyre    : Compound + Stint Age (Laps) + Wear Bar + ERS %
 *   - form    : Driver Confidence tier + Momentum arrow + Positions Gained (+/-)
 */
(function (global) {
  "use strict";

  const ENG = global.F1RaceEngine;
  const esc = ENG ? ENG.esc : (s) => String(s == null ? "" : s);
  const fmtLap = ENG ? ENG.fmtLapTime : (s) => (s > 0 ? s.toFixed(1) : "--.-");

  const MODES = [
    { id: "int",     label: "INT",  col3: "INT",      col4: "TYRE", col5: "ST" },
    { id: "ldr",     label: "LDR",  col3: "LDR",      col4: "TYRE", col5: "ST" },
    { id: "laps",    label: "LAPS", col3: "LAST",     col4: "BEST", col5: "Δ"  },
    { id: "sectors", label: "SEC",  col3: "S1·S2·S3", col4: "TYRE", col5: "ST" },
    { id: "tyre",    label: "TYRE", col3: "WEAR",     col4: "AGE",  col5: "ERS"},
    { id: "form",    label: "CONF", col3: "CONF",     col4: "MOM",  col5: "+/-"},
  ];

  function getModeMeta(modeId) {
    return MODES.find((m) => m.id === modeId) || MODES[0];
  }

  function renderTimingRows(opts) {
    const {
      sorted,
      mode,
      circuit,
      bestSectors,
      fastestLap,
      focusIdx,
      playerTeamIndices,
      onRowClickAttr,
    } = opts;
    const baseLapS = (circuit && circuit.base_lap_s) || 85;
    const leader = sorted[0];
    const teamSet = new Set(playerTeamIndices || []);
    const bSec = bestSectors || [999, 999, 999];
    const flDriver = fastestLap && fastestLap.driver ? fastestLap.driver : "";

    return sorted.map((c, i) => {
      const pos = i + 1;
      const isFocus = c.idx === focusIdx;
      const isTeam = teamSet.has(c.idx) || Boolean(c.isPlayer || c.isTeam);
      const isFl = flDriver && c.name === flDriver;
      const comp = (ENG && ENG.COMPOUNDS && ENG.COMPOUNDS[c.compound]) || { code: "M", color: "#facc15" };
      const gridPos = c.gridPos || (c.idx + 1);
      const posGain = gridPos - pos;

      let c3 = "", c4 = "", c5 = "";

      if (c.dnf) {
        c3 = `<span class="tt-dnf">OUT</span>`;
        c4 = `<span class="tt-muted">—</span>`;
        c5 = `<span class="tt-muted">${c.stops || 0}</span>`;
      } else if (mode === "laps") {
        const lastTxt = c.lastLapTime && c.lastLapTime < 400 ? fmtLap(c.lastLapTime) : "--.-";
        const bestTxt = c.bestLapS && c.bestLapS < 400 ? fmtLap(c.bestLapS) : lastTxt;
        const delta = posGain > 0 ? `<span class="tt-up">+${posGain}</span>` : (posGain < 0 ? `<span class="tt-dn">${posGain}</span>` : `<span class="tt-muted">0</span>`);
        c3 = `<span class="tt-mono${isFl ? " tt-purp" : ""}">${lastTxt}</span>`;
        c4 = `<span class="tt-mono">${bestTxt}</span>`;
        c5 = delta;
      } else if (mode === "sectors") {
        const sArr = c.sectorTimes || [0, 0, 0];
        const pArr = c.bestSectors || [999, 999, 999];
        const dots = [0, 1, 2].map((si) => {
          const v = Number(sArr[si] || 0);
          if (v <= 0) return `<i class="tt-sec tt-sec-none">—</i>`;
          let cls = "tt-sec-yel";
          if (v <= (bSec[si] || 999) + 0.03) cls = "tt-sec-purp";
          else if (v <= (pArr[si] || 999) + 0.03) cls = "tt-sec-grn";
          return `<i class="tt-sec ${cls}" title="S${si + 1}: ${v.toFixed(2)}s">${v.toFixed(1)}</i>`;
        }).join("");
        c3 = `<span class="tt-sec-strip">${dots}</span>`;
        c4 = `<span class="sim-tbadge t-${esc(c.compound)}">${comp.code}</span>`;
        c5 = `<span>${c.stops || 0}</span>`;
      } else if (mode === "tyre") {
        const life = Math.round(c.tyreLife ?? 100);
        const lCol = life > 55 ? "#22c55e" : (life > 25 ? "#facc15" : "#ef4444");
        const age = Math.max(0, Math.round(c.tyreAge ?? (c.lap - (c.lastPitLap || 0))));
        const ers = Math.round(c.ers ?? 50);
        c3 = `<span class="tt-wear-wrap"><span class="sim-tbadge t-${esc(c.compound)}">${comp.code}</span><i class="tt-wear-bar"><b style="width:${life}%;background:${lCol}"></b></i></span>`;
        c4 = `<span class="tt-mono">${age}L</span>`;
        c5 = `<span class="tt-ers">${ers}%</span>`;
      } else if (mode === "form") {
        const tier = ENG ? ENG.confidenceTier(c.confidence ?? 60) : { label: "STD", color: "#cbd5e1" };
        const mom = Math.round(c.momentum ?? 0);
        const momHtml = mom >= 18 ? `<span class="tt-up">▲▲</span>` : (mom >= 5 ? `<span class="tt-up">▲</span>` : (mom <= -18 ? `<span class="tt-dn">▼▼</span>` : (mom <= -5 ? `<span class="tt-dn">▼</span>` : `<span class="tt-muted">•</span>`)));
        const delta = posGain > 0 ? `<span class="tt-up">+${posGain}</span>` : (posGain < 0 ? `<span class="tt-dn">${posGain}</span>` : `<span class="tt-muted">0</span>`);
        c3 = `<span class="tt-conf-pill" style="color:${tier.color}">${Math.round(c.confidence ?? 60)}</span>`;
        c4 = momHtml;
        c5 = delta;
      } else {
        // INT or LDR (supports locked FIA Chequered Flag finish times + lapped gaps!)
        let gapStr = "LDR";
        if (i > 0 && leader) {
          const ref = mode === "ldr" ? leader : sorted[i - 1];
          if (c.finishedRace && ref.finishedRace) {
            const lDiff = (ref.finishLaps || 0) - (c.finishLaps || 0);
            if (lDiff > 0) {
              gapStr = `+${lDiff}L`;
            } else {
              const dtS = Math.max(0.01, (c.finishTimeS || 0) - (ref.finishTimeS || 0));
              gapStr = `+${dtS.toFixed(2)}`;
            }
          } else {
            const gapS = Math.max(0, (ref.totalProg - c.totalProg) * baseLapS);
            gapStr = gapS >= 60 ? `+${Math.floor(gapS / baseLapS)}L` : `+${gapS.toFixed(1)}`;
          }
        }
        const finBadge = c.finishedRace ? `<span class="tt-fin-flag" title="Finished">🏁</span>` : "";
        const inPitTag = c.inPit > 0 ? `<span class="tt-pit">PIT</span>` : `<span class="tt-mono">${finBadge}${gapStr}</span>`;
        const drsPip = (!c.finishedRace && c.drsOpen) ? `<i class="tt-drs-dot" title="DRS / Override Active"></i>` : "";
        c3 = `${inPitTag}${drsPip}`;
        c4 = `<span class="sim-tbadge t-${esc(c.compound)}">${comp.code}</span>`;
        c5 = `<span>${c.stops || 0}</span>`;
      }

      const rowCls = [
        isFocus ? "is-focus" : "",
        isTeam ? "is-player" : "",
        c.dnf ? "is-dnf" : "",
        isFl ? "is-fl" : "",
      ].filter(Boolean).join(" ");

      const attr = onRowClickAttr || "data-car-idx";
      return `
        <tr class="${rowCls}" ${attr}="${c.idx}">
          <td class="tt-pos">${pos}</td>
          <td class="tt-drv"><i class="tt-bar" style="background:${esc(c.color)}"></i><b>${esc(c.code3)}</b></td>
          <td class="tt-c3">${c3}</td>
          <td class="tt-c4">${c4}</td>
          <td class="tt-c5">${c5}</td>
        </tr>
      `;
    }).join("");
  }

  function updateTableHeaders(tableEl, modeId) {
    if (!tableEl) return;
    const m = getModeMeta(modeId);
    const ths = tableEl.querySelectorAll("thead th");
    if (ths.length >= 5) {
      ths[2].textContent = m.col3;
      ths[3].textContent = m.col4;
      ths[4].textContent = m.col5;
    }
  }

  global.F1TimingTower = {
    MODES,
    getModeMeta,
    renderTimingRows,
    updateTableHeaders,
  };
})(window);
