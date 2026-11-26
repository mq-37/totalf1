/* weather_radar_ui.js — F1 Pit-Wall Animated Doppler Weather Radar + R&D Optimal Pit/Crossover Calculator
   Connects to /api/weather/live/{circuit_id} (Open-Meteo live telemetry + radar cells + R&D pit math).
   Shared by /career (Race Weekend OS & Live Pit Wall) and /sim (Broadcast Director). */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function dbzColor(dbz, alpha) {
    if (dbz >= 52) return 'rgba(217, 70, 239,' + alpha + ')'; /* Storm core magenta */
    if (dbz >= 42) return 'rgba(239, 68, 68,' + alpha + ')';  /* Heavy rain red */
    if (dbz >= 32) return 'rgba(234, 179, 8,' + alpha + ')';  /* Moderate yellow */
    return 'rgba(34, 197, 94,' + alpha + ')';                 /* Light rain green */
  }

  function createRadarWidget(containerEl) {
    if (!containerEl) return null;
    containerEl.innerHTML = [
      '<div class="wr-shell">',
        '<div class="wr-scope-wrap">',
          '<canvas class="wr-canvas" width="160" height="145"></canvas>',
          '<span class="wr-live-tag">RADAR</span>',
        '</div>',
        '<div class="wr-info">',
          '<div class="wr-top-row">',
            '<strong class="wr-cond">Loading live weather…</strong>',
            '<span class="wr-tier-pill">CALIBRATING</span>',
          '</div>',
          '<div class="wr-met-strip"></div>',
          '<div class="wr-spark"></div>',
          '<div class="wr-pit-box"></div>',
        '</div>',
      '</div>'
    ].join('');

    var canvas = containerEl.querySelector('.wr-canvas');
    var liveTag = containerEl.querySelector('.wr-live-tag');
    var condEl = containerEl.querySelector('.wr-cond');
    var tierEl = containerEl.querySelector('.wr-tier-pill');
    var metEl = containerEl.querySelector('.wr-met-strip');
    var sparkEl = containerEl.querySelector('.wr-spark');
    var pitEl = containerEl.querySelector('.wr-pit-box');

    var data = null;
    var circuitPts = null;
    var rafId = null;
    var t0 = performance.now();

    function drawRadar(now) {
      rafId = requestAnimationFrame(drawRadar);
      if (!canvas || !canvas.offsetParent) return;
      var w = canvas.width, h = canvas.height;
      var cx = w * 0.5, cy = h * 0.5, rad = Math.min(w, h) * 0.45;
      var g = canvas.getContext('2d');
      var sec = (now - t0) / 1000;

      /* Dark radar scope */
      g.fillStyle = '#040b14';
      g.fillRect(0, 0, w, h);

      /* Concentric range rings (5km, 10km, 20km) */
      g.strokeStyle = 'rgba(56, 189, 248, 0.20)';
      g.lineWidth = 1;
      [0.33, 0.66, 1.0].forEach(function (f) {
        g.beginPath(); g.arc(cx, cy, rad * f, 0, Math.PI * 2); g.stroke();
      });
      g.beginPath();
      g.moveTo(cx - rad, cy); g.lineTo(cx + rad, cy);
      g.moveTo(cx, cy - rad); g.lineTo(cx, cy + rad);
      g.stroke();

      /* Moving Doppler precipitation cells */
      var cells = (data && data.radar && data.radar.cells) || [];
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i];
        var ox = ((c.x + c.vx * sec * 0.14 + 1.4) % 2.8) - 1.4;
        var oy = ((c.y + c.vy * sec * 0.14 + 1.4) % 2.8) - 1.4;
        var px = cx + ox * rad;
        var py = cy + oy * rad;
        var rPx = Math.max(12, (c.radius || 0.24) * rad);
        var gr = g.createRadialGradient(px, py, 2, px, py, rPx);
        gr.addColorStop(0, dbzColor(c.dbz || 35, 0.78));
        gr.addColorStop(0.55, dbzColor(Math.max(24, (c.dbz || 35) - 10), 0.42));
        gr.addColorStop(1, 'rgba(34, 197, 94, 0)');
        g.fillStyle = gr;
        g.beginPath(); g.arc(px, py, rPx, 0, Math.PI * 2); g.fill();
      }

      /* Mini circuit silhouette centered in scope */
      if (Array.isArray(circuitPts) && circuitPts.length > 4) {
        g.save();
        g.strokeStyle = '#f8fafc';
        g.lineWidth = 1.6;
        g.beginPath();
        for (var j = 0; j < circuitPts.length; j++) {
          var pt = circuitPts[j];
          var tx = cx + (pt[0] - 0.5) * rad * 0.62;
          var ty = cy + (pt[1] - 0.5) * rad * 0.62;
          if (j === 0) g.moveTo(tx, ty); else g.lineTo(tx, ty);
        }
        g.closePath();
        g.stroke();
        g.restore();
      } else {
        g.fillStyle = '#f8fafc';
        g.beginPath(); g.arc(cx, cy, 2.8, 0, Math.PI * 2); g.fill();
      }

      /* Rotating radar sweep line */
      var ang = (sec * 1.45) % (Math.PI * 2);
      g.strokeStyle = 'rgba(56, 189, 248, 0.75)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
      g.stroke();

      /* Wind vector text */
      if (data && data.radar) {
        g.fillStyle = '#7dd3fc';
        g.font = '700 9px ui-monospace, monospace';
        g.fillText(data.radar.wind_kph + 'km/h ' + data.radar.wind_dir, 6, h - 5);
      }
    }

    function renderData(d, circuit) {
      data = d;
      circuitPts = (circuit && Array.isArray(circuit.points)) ? circuit.points : circuitPts;
      if (!d || !d.live_weather) return;

      var lw = d.live_weather;
      var op = d.optimal_pit || {};
      var tl = (d.radar && d.radar.timeline) || [];

      liveTag.textContent = lw.live ? 'LIVE OPEN-METEO' : 'RADAR MODEL';
      liveTag.className = 'wr-live-tag' + (lw.live ? ' is-live' : '');
      condEl.textContent = lw.condition + ' · Air ' + lw.air_temp_c + '°C / Trk ' + lw.track_temp_c + '°C';
      tierEl.textContent = (op.tier || 'CALIBRATED') + ' ' + (op.intel_pct || 70) + '%';
      tierEl.className = 'wr-tier-pill ' + (op.intel_pct >= 85 ? 'tier-nailed' : (op.intel_pct >= 62 ? 'tier-cal' : 'tier-rough'));

      metEl.innerHTML =
        '<span>💧 Rain ' + lw.precip_mm_hr + 'mm/h (' + lw.rain_prob_pct + '%)</span>' +
        '<span>💨 ' + lw.wind_kph + ' km/h ' + lw.wind_dir + '</span>' +
        '<span>💦 Hum ' + lw.humidity_pct + '%</span>' +
        (lw.track_temp_c != null ? '<span>🌡️ Track ' + lw.track_temp_c + '°C</span>' : '');

      /* Lap-by-Lap / Minute Precipitation & Wetness Sparkline + track-temp trajectory */
      var alertRow = '';
      var firstWet = null, lastWet = null;
      tl.forEach(function (pt) {
        if (pt.mm_hr > 0.4) { if (firstWet == null) firstWet = pt; lastWet = pt; }
      });
      if (firstWet && firstWet.lap > 1) {
        alertRow = '<div class="wr-alert wr-alert-rain">🌧️ Rain arriving ~L' + firstWet.lap + ' (T+' + firstWet.minute + 'm) — plan crossover to Inter around L' + Math.max(1, firstWet.lap - 1) + '</div>';
      } else if (firstWet) {
        var dryingFrom = lastWet ? lastWet.lap : null;
        alertRow = '<div class="wr-alert wr-alert-wet">☔ Wet race' + (dryingFrom && dryingFrom < tl[tl.length - 1].lap ? ' — drying expected from ~L' + dryingFrom : '') + '</div>';
      } else {
        alertRow = '<div class="wr-alert wr-alert-dry">☀️ Dry race forecast — no crossover expected</div>';
      }

      sparkEl.innerHTML =
        alertRow +
        tl.map(function (pt) {
        var hPct = Math.max(10, Math.min(100, pt.wetness_pct));
        var col = pt.wetness_pct >= 68 ? '#38bdf8' : (pt.wetness_pct >= 28 ? '#22c55e' : '#475569');
        return '<div class="wr-bar-col" title="L' + pt.lap + ' (T+' + pt.minute + 'm): ' + pt.wetness_pct + '% wet · ' + pt.mm_hr + 'mm/h · Ideal ' + pt.ideal_tyre +
          (pt.track_temp_c != null ? ' · Track ' + pt.track_temp_c + '°C' : '') + '">' +
          '<i style="height:' + hPct + '%;background:' + col + '"></i>' +
          '<span>L' + pt.lap + '</span>' +
          '</div>';
      }).join('');

      /* Optimal Pit & Crossover Calculator Callout */
      var stopsHtml = (op.pit_stops || []).map(function (st) {
        var win = st.window_lo === st.window_hi ? ('L' + st.lap) : ('L' + st.window_lo + '–L' + st.window_hi);
        return '<div class="wr-pit-row">' +
          '<span class="wr-pit-badge' + (st.crossover ? ' is-xover' : '') + '">' + (st.crossover ? '☔ CROSSOVER ' : '🔧 OPTIMAL PIT ') + win + ' → ' + esc(st.to_compound) + '</span>' +
          '<span class="wr-pit-txt">' + esc(st.reason) + '</span>' +
          '</div>';
      }).join('');

      pitEl.innerHTML =
        '<div class="wr-pit-head"><span>Optimal Calc (R&amp;D Tyre Care ' + (op.tyre_care_rating || 80) + '): <b>' + esc(op.compound_sequence || 'S → M') + '</b></span><span style="color:#4ade80">Deg ' + (op.effective_deg_s || 0.068) + 's/L</span></div>' +
        stopsHtml;

      if (!rafId) rafId = requestAnimationFrame(drawRadar);
    }

    async function load(circuit, opts) {
      opts = opts || {};
      if (!circuit || !circuit.id) return null;
      var q = new URLSearchParams({
        mode: String(opts.mode || 'dynamic'),
        laps: String(opts.laps || 15),
        intel_pct: String(opts.intelPct != null ? opts.intelPct : 70),
        tyre_care: String(opts.tyreCare != null ? opts.tyreCare : 80)
      });
      try {
        var r = await fetch('/api/weather/live/' + encodeURIComponent(circuit.id) + '?' + q.toString());
        if (r.ok) {
          var d = await r.json();
          renderData(d, circuit);
          return d;
        }
      } catch (_) {}
      return null;
    }

    return {
      load: load,
      renderData: renderData,
      getData: function () { return data; },
      destroy: function () { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    };
  }

  global.F1WeatherRadarUI = { create: createRadarWidget };
})(window);
