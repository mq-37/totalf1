/**
 * F1Charts — shared canvas charting module for APEX GRID.
 * One visual language for every analytics surface: race telemetry modal, archive
 * analytics views, career war room. Zero external dependencies.
 *
 * API:
 *   F1Charts.line(canvas,  { series, xLabels?, events?, bands?, fmtY?, fmtX?, yMin?, yMax?, emptyText? })
 *   F1Charts.bars(canvas,  { items:[{label,value,color}], horizontal?, fmtV?, maxValue?, emptyText? })
 *   F1Charts.bands(canvas, { rows:[{label, color, bands:[{start,end,color?}]}], max?, legend? })   // strategy gantt
 *   F1Charts.donut(canvas, { items:[{label,value,color}], centerLabel? })
 * Series: { label, color, bold?, values:[y...], xs?:[x...] }   (xs = numeric lap axis; default = index)
 * Events: { x, label, color?, dash? }  -> vertical marker line
 * Bands:  { x0, x1, color?, label? }   -> shaded region (e.g. safety-car laps)
 */
(function (global) {
  "use strict";

  const THEME = {
    bg: "#060c18",
    grid: "rgba(148,163,184,0.14)",
    axis: "#94a3b8",
    text: "#e2e8f0",
    muted: "#64748b",
    accent: "#38bdf8",
    warn: "#f59e0b",
    bad: "#ef4444",
    good: "#22c55e",
  };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* Shared hover tooltip (one per page, reused by every chart). */
  let tipEl = null;
  function tooltip() {
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.id = "f1chart-tip";
      tipEl.style.cssText = [
        "position:fixed", "z-index:9999", "pointer-events:none", "display:none",
        "background:rgba(8,13,26,0.96)", "border:1px solid #1e3a5f", "border-radius:8px",
        "padding:8px 10px", "font:600 11px 'Source Sans 3',system-ui,sans-serif", "color:#e2e8f0",
        "box-shadow:0 8px 24px rgba(0,0,0,0.55)", "max-width:280px", "line-height:1.45",
      ].join(";");
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function showTip(html, x, y) {
    const t = tooltip();
    t.innerHTML = html;
    t.style.display = "block";
    const r = t.getBoundingClientRect();
    let left = x + 14, top = y + 12;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 12;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 10;
    t.style.left = Math.max(4, left) + "px";
    t.style.top = Math.max(4, top) + "px";
  }
  function hideTip() { if (tipEl) tipEl.style.display = "none"; }

  function setup(canvas) {
    if (!canvas) return null;
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    const w = Math.max(240, canvas.clientWidth || canvas.parentElement?.clientWidth || 420);
    const h = Math.max(120, canvas.clientHeight || canvas.parentElement?.clientHeight || 175);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function clearBg(ctx, w, h) {
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, w, h);
  }

  function drawEmpty(ctx, w, h, msg) {
    ctx.fillStyle = THEME.muted;
    ctx.font = "600 11px 'Source Sans 3',system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(msg || "No data yet.", w * 0.5, h * 0.5);
    ctx.textAlign = "left";
  }

  /* Resolve a series' numeric x positions. Index-based unless xs given. */
  function seriesXs(s) {
    if (Array.isArray(s.xs) && s.xs.length) return s.xs;
    const n = (s.values || []).length;
    return Array.from({ length: n }, (_, i) => i);
  }

  function extent(seriesList) {
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    (seriesList || []).forEach((s) => {
      const xs = seriesXs(s);
      (s.values || []).forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        const x = xs[i];
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      });
    });
    if (!Number.isFinite(xMin)) return null;
    return { xMin, xMax, yMin, yMax };
  }

  function drawFrame(ctx, info, o, ex) {
    const { w, h } = info;
    const padL = o.padL || 44, padR = o.padR || 12, padT = o.padT || 20, padB = o.padB || 26;
    const plotW = Math.max(30, w - padL - padR);
    const plotH = Math.max(30, h - padT - padB);
    let yLo = o.yMin != null ? o.yMin : ex.yMin;
    let yHi = o.yMax != null ? o.yMax : ex.yMax;
    if (o.yPad != null) { yLo -= o.yPad; yHi += o.yPad; }
    if (o.yZeroBase) yLo = Math.min(0, yLo);
    if (yHi <= yLo) yHi = yLo + 1;
    const xPad = o.xPad != null ? o.xPad : 0;
    const xLo = ex.xMin - xPad, xHi = ex.xMax + xPad;
    const toX = (x) => padL + ((x - xLo) / Math.max(1e-9, xHi - xLo)) * plotW;
    const toYraw = (y) => padT + plotH - ((y - yLo) / (yHi - yLo)) * plotH;
    const toY = o.yInvert ? (y) => toYraw(yLo + yHi - y) : toYraw;

    /* Background bands (e.g. safety-car laps) */
    (o.bands || []).forEach((b) => {
      const x0 = toX(b.x0), x1 = toX(b.x1);
      if (x1 < padL || x0 > w - padR) return;
      ctx.fillStyle = b.color || "rgba(148,163,184,0.10)";
      ctx.fillRect(Math.max(padL, x0), padT, Math.min(w - padR, x1) - Math.max(padL, x0), plotH);
      if (b.label) {
        ctx.fillStyle = THEME.axis;
        ctx.font = "700 8.5px ui-monospace,monospace";
        ctx.fillText(b.label, Math.max(padL + 2, x0 + 2), padT + 10);
      }
    });

    /* Grid + Y labels */
    ctx.strokeStyle = THEME.grid;
    ctx.lineWidth = 1;
    ctx.font = "600 9.5px ui-monospace,monospace";
    ctx.fillStyle = THEME.axis;
    const gridN = o.gridLines != null ? o.gridLines : 4;
    for (let g = 0; g <= gridN; g++) {
      const val = yLo + ((yHi - yLo) * g) / gridN;
      const y = toY(val);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillText(o.fmtY ? o.fmtY(val) : String(Math.round(val)), 4, y + 3);
    }

    /* X labels */
    if (Array.isArray(o.xLabels) && o.xLabels.length) {
      ctx.fillStyle = THEME.axis;
      ctx.font = "600 9px ui-monospace,monospace";
      const step = Math.max(1, Math.ceil(o.xLabels.length / Math.max(3, Math.floor(plotW / 60))));
      o.xLabels.forEach((lb, i) => {
        if (i % step === 0 || i === o.xLabels.length - 1) {
          const s = String(lb);
          ctx.fillText(s, toX(i) - ctx.measureText(s).width * 0.5, h - 7);
        }
      });
    } else {
      ctx.fillStyle = THEME.axis;
      ctx.font = "600 9px ui-monospace,monospace";
      const ticks = 6;
      for (let t = 0; t <= ticks; t++) {
        const xv = xLo + ((xHi - xLo) * t) / ticks;
        const s = o.fmtX ? o.fmtX(xv) : String(Math.round(xv));
        ctx.fillText(s, toX(xv) - ctx.measureText(s).width * 0.5, h - 7);
      }
    }

    /* Event markers (vertical lines) */
    (o.events || []).forEach((ev) => {
      const x = toX(ev.x);
      if (x < padL - 1 || x > w - padR + 1) return;
      ctx.save();
      if (ev.dash !== false) ctx.setLineDash([4, 3]);
      ctx.strokeStyle = ev.color || "rgba(250,204,21,0.55)";
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
      ctx.restore();
      if (ev.label) {
        ctx.fillStyle = ev.color || "#facc15";
        ctx.font = "700 8.5px ui-monospace,monospace";
        ctx.save();
        ctx.translate(x + 3, padT + 14);
        ctx.fillText(ev.label, 0, 0);
        ctx.restore();
      }
    });

    /* Reference line */
    if (o.refLine != null) {
      const ry = toY(o.refLine);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = THEME.bad;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(padL, ry); ctx.lineTo(w - padR, ry); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#fca5a5";
      ctx.fillText(o.refLabel || String(o.refLine), w - padR - 74, Math.max(12, ry - 4));
    }

    /* Series */
    const drawList = (o.series || []).filter((s) => (s.values || []).some(Number.isFinite));
    drawList.forEach((s) => {
      const xs = seriesXs(s);
      if (s.area) {
        ctx.beginPath();
        let started = false;
        (s.values || []).forEach((v, i) => {
          if (!Number.isFinite(v)) return;
          const x = toX(xs[i]), y = toY(v);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        });
        const lastI = (s.values || []).length - 1;
        ctx.lineTo(toX(xs[lastI]), toY(yLo));
        ctx.lineTo(toX(xs[0]), toY(yLo));
        ctx.closePath();
        ctx.fillStyle = (s.color || THEME.accent).replace("rgb(", "rgba(").replace(")", ",0.16)");
        if (!s.color.startsWith("#")) ctx.fillStyle = "rgba(56,189,248,0.14)";
        else ctx.fillStyle = hexA(s.color, 0.15);
        ctx.fill();
      }
      ctx.strokeStyle = s.color || THEME.accent;
      ctx.lineWidth = s.bold ? 2.6 : 1.7;
      ctx.beginPath();
      let started = false;
      (s.values || []).forEach((v, i) => {
        if (!Number.isFinite(v)) { started = false; return; }
        const x = toX(xs[i]), y = toY(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
      if (!s.noDots) {
        const r = s.bold ? 2.8 : 1.9;
        ctx.fillStyle = s.color || THEME.accent;
        (s.values || []).forEach((v, i) => {
          if (!Number.isFinite(v)) return;
          ctx.beginPath(); ctx.arc(toX(xs[i]), toY(v), r, 0, Math.PI * 2); ctx.fill();
        });
      }
    });

    /* Legend */
    if (o.legend !== false && drawList.length) {
      let lx = padL;
      ctx.font = "700 9.5px 'Source Sans 3',system-ui,sans-serif";
      drawList.slice(0, 5).forEach((s) => {
        ctx.fillStyle = s.color || THEME.accent;
        ctx.fillRect(lx, 5, 9, 4);
        ctx.fillStyle = THEME.text;
        ctx.fillText(s.label || "", lx + 13, 10);
        lx += ctx.measureText(s.label || "").width + 26;
      });
    }

    return { toX, toY, padL, padR, padT, padB, plotW, plotH, xLo, xHi, yLo, yHi };
  }

  function hexA(hex, a) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
    if (!m) return `rgba(56,189,248,${a})`;
    return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
  }

  /* Attach hover tooltip: nearest series point + optional per-lap extra rows. */
  function attachHover(canvas, meta) {
    if (!canvas || !meta) return;
    canvas.style.cursor = "crosshair";
    canvas.onmousemove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const { toX, xLo, xHi, padL, padR } = meta;
      if (mx < padL - 2 || mx > rect.width - padR + 2) { hideTip(); return; }
      const xVal = xLo + ((mx - padL) / Math.max(1e-9, (rect.width - padL - padR))) * (xHi - xLo);
      const rows = meta.rowsFor ? meta.rowsFor(xVal) : null;
      if (!rows || !rows.length) { hideTip(); return; }
      showTip(rows.map((r) => r).join("<br>"), e.clientX, e.clientY);
    };
    canvas.onmouseleave = hideTip;
  }

  /* ============ Public chart builders ============ */

  function line(canvas, opts) {
    const o = opts || {};
    const info = setup(canvas);
    if (!info) return;
    const { ctx, w, h } = info;
    clearBg(ctx, w, h);
    const ex = extent(o.series);
    if (!ex) { drawEmpty(ctx, w, h, o.emptyText); if (canvas.onmousemove) canvas.onmousemove = null; return; }
    const meta = drawFrame(ctx, info, o, ex);
    attachHover(canvas, {
      toX: meta.toX, xLo: meta.xLo, xHi: meta.xHi, padL: meta.padL, padR: meta.padR,
      rowsFor: o.tooltipRows || ((x) => {
        const rows = [];
        (o.series || []).forEach((s) => {
          const xs = seriesXs(s);
          let bi = -1, bd = Infinity;
          (s.values || []).forEach((v, i) => {
            const d = Math.abs(xs[i] - x);
            if (Number.isFinite(v) && d < bd) { bd = d; bi = i; }
          });
          if (bi >= 0) {
            const vx = xs[bi];
            rows.push(`<span style="color:${esc(s.color || THEME.accent)}">●</span> <b>${esc(s.label || "")}</b> ${o.fmtPt ? esc(o.fmtPt(s.values[bi], s, bi)) : esc(String(Math.round(s.values[bi] * 100) / 100))}`);
          }
        });
        if (o.tooltipHead) rows.unshift(`<b>${esc(o.tooltipHead(x))}</b>`);
        return rows;
      }),
    });
  }

  function bars(canvas, opts) {
    const o = opts || {};
    const info = setup(canvas);
    if (!info) return;
    const { ctx, w, h } = info;
    clearBg(ctx, w, h);
    const items = (o.items || []).filter((it) => Number.isFinite(it.value));
    if (!items.length) { drawEmpty(ctx, w, h, o.emptyText); return; }
    const horizontal = o.horizontal !== false;
    const maxV = o.maxValue != null ? o.maxValue : Math.max(...items.map((i) => i.value)) * 1.06;
    ctx.font = "600 10px 'Source Sans 3',system-ui,sans-serif";
    if (horizontal) {
      const labW = Math.min(150, Math.max(...items.map((i) => ctx.measureText(i.label).width)) + 12);
      const rowH = Math.max(16, Math.min(30, (h - 10) / items.length));
      const barX = labW + 6, barW = w - barX - 44;
      items.forEach((it, i) => {
        const y = 6 + i * rowH + (rowH - 13) / 2;
        ctx.fillStyle = o.labelColor || THEME.text;
        ctx.fillText(String(it.label).slice(0, 26), 4, y + 10);
        const bw = Math.max(2, (it.value / maxV) * barW);
        ctx.fillStyle = it.color || THEME.accent;
        ctx.fillRect(barX, y, bw, 13);
        ctx.fillStyle = THEME.text;
        ctx.fillText(o.fmtV ? o.fmtV(it.value) : String(Math.round(it.value)), barX + bw + 6, y + 10);
      });
    } else {
      const padB = 26;
      const colW = (w - 12) / items.length;
      items.forEach((it, i) => {
        const bh = Math.max(2, (it.value / maxV) * (h - padB - 16));
        const x = 6 + i * colW + colW * 0.14;
        ctx.fillStyle = it.color || THEME.accent;
        ctx.fillRect(x, h - padB - bh, colW * 0.72, bh);
        ctx.fillStyle = o.labelColor || THEME.text;
        const ls = String(it.label).slice(0, 9);
        ctx.fillText(ls, x, h - padB + 12);
        ctx.fillStyle = THEME.axis;
        ctx.fillText(o.fmtV ? o.fmtV(it.value) : String(Math.round(it.value)), x, h - padB - bh - 4);
      });
    }
    canvas.onmousemove = null;
    canvas.onmouseleave = hideTip;
  }

  /* Strategy gantt: one row per driver, compound-colour bands per stint. */
  function bands(canvas, opts) {
    const o = opts || {};
    const info = setup(canvas);
    if (!info) return;
    const { ctx, w, h } = info;
    clearBg(ctx, w, h);
    const rows = o.rows || [];
    const max = o.max || Math.max(1, ...rows.flatMap((r) => (r.bands || []).map((b) => b.end)));
    if (!rows.length) { drawEmpty(ctx, w, h, o.emptyText); return; }
    const labW = o.labelWidth || 92;
    const rowH = Math.max(12, Math.min(22, (h - 18) / rows.length));
    ctx.font = "600 9.5px 'Source Sans 3',system-ui,sans-serif";
    rows.forEach((r, i) => {
      const y = 10 + i * rowH;
      ctx.fillStyle = r.color || THEME.text;
      ctx.fillText(String(r.label).slice(0, 15), 4, y + rowH * 0.66);
      (r.bands || []).forEach((b) => {
        const x0 = labW + ((b.start / max) * (w - labW - 10));
        const x1 = labW + ((b.end / max) * (w - labW - 10));
        ctx.fillStyle = b.color || r.color || THEME.accent;
        ctx.fillRect(x0, y + 2, Math.max(3, x1 - x0), rowH - 5);
        if (rowH >= 17 && x1 - x0 > 26 && b.label) {
          ctx.fillStyle = "#0b1220";
          ctx.font = "700 8px ui-monospace,monospace";
          ctx.fillText(b.label, x0 + 3, y + rowH * 0.68);
          ctx.font = "600 9.5px 'Source Sans 3',system-ui,sans-serif";
        }
      });
    });
    /* Lap axis */
    ctx.fillStyle = THEME.axis;
    ctx.font = "600 8.5px ui-monospace,monospace";
    for (let t = 0; t <= 5; t++) {
      const lv = Math.round((max * t) / 5);
      const x = labW + ((lv / max) * (w - labW - 10));
      ctx.fillText(`L${lv}`, x - 6, h - 2);
    }
    canvas.onmousemove = null;
    canvas.onmouseleave = hideTip;
  }

  function donut(canvas, opts) {
    const o = opts || {};
    const info = setup(canvas);
    if (!info) return;
    const { ctx, w, h } = info;
    clearBg(ctx, w, h);
    const items = (o.items || []).filter((it) => it.value > 0);
    const total = items.reduce((a, b) => a + b.value, 0);
    if (!total) { drawEmpty(ctx, w, h, o.emptyText); return; }
    const cx = w * 0.38, cy = h * 0.52, r = Math.min(w, h) * 0.33;
    let ang = -Math.PI / 2;
    items.forEach((it) => {
      const sw = (it.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, ang, ang + sw);
      ctx.strokeStyle = it.color || THEME.accent;
      ctx.lineWidth = Math.min(22, r * 0.42);
      ctx.stroke();
      ang += sw;
    });
    if (o.centerLabel) {
      ctx.fillStyle = THEME.text;
      ctx.font = "800 13px 'Source Sans 3',system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(o.centerLabel, cx, cy + 4);
      ctx.textAlign = "left";
    }
    let ly = Math.max(14, h * 0.2);
    ctx.font = "600 10px 'Source Sans 3',system-ui,sans-serif";
    items.forEach((it) => {
      ctx.fillStyle = it.color || THEME.accent;
      ctx.fillRect(w * 0.66, ly - 8, 9, 5);
      ctx.fillStyle = THEME.text;
      ctx.fillText(`${it.label} — ${it.value}`, w * 0.66 + 14, ly);
      ly += 15;
    });
    canvas.onmousemove = null;
    canvas.onmouseleave = hideTip;
  }

  global.F1Charts = { theme: THEME, setup, line, bars, bands, donut, tooltip, hideTip, hexA };
})(window);
