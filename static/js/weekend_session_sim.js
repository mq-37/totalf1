/* weekend_session_sim.js — Live Watchable On-Track FP1 / FP2 / FP3 & Q1 / Q2 / Q3 Qualifying Simulator
   Shared by BOTH /career (Race Weekend OS) and /sim (Full CPU F1 Weekend Broadcast).
   Renders real GPS circuit geometry via F1TrackRenderer with 20 animated cars, live sector splits,
   practice programme progress bars, race engineer radio hints, playback speed (1x..16x), and instant Sim-to-End! */
(function (global) {
  'use strict';

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function fmtLap(s) {
    if (!Number.isFinite(s) || s <= 0 || s > 400) return '—';
    var m = Math.floor(s / 60);
    var rem = s - m * 60;
    return m + ':' + (rem < 10 ? '0' : '') + rem.toFixed(3);
  }

  var TYRE_COL = { S: '#ef4444', M: '#facc15', H: '#e2e8f0', I: '#22c55e', W: '#38bdf8' };

  function createSessionRunner(canvasEl, opts) {
    opts = opts || {};
    var R = global.F1TrackRenderer;
    var state = {
      active: false,
      paused: false,
      speed: 4,
      mode: 'fp1', /* 'fp1' | 'fp2' | 'fp3' | 'q1' | 'q2' | 'q3' */
      circuit: null,
      geom: null,
      staticCanvas: null,
      durationSim: 36,   /* simulated session seconds at 1x */
      elapsed: 0,
      cars: [],
      purpleS1: 999, purpleS2: 999, purpleS3: 999, purpleLap: 999,
      radioQueue: [],
      lastRadioAt: -5,
      rafId: null,
      lastTs: 0,
      onUpdate: opts.onUpdate || null,
      onRadio: opts.onRadio || null,
      onComplete: opts.onComplete || null,
      programmeInfo: {}
    };

    function buildGeometry(circuit) {
      if (!circuit) return;
      state.circuit = circuit;
      var w = Math.max(420, canvasEl.clientWidth || 640);
      var h = Math.max(220, canvasEl.clientHeight || 300);
      if (R && typeof R.buildGeometry === 'function' && Array.isArray(circuit.points) && circuit.points.length >= 4) {
        state.geom = R.buildGeometry(circuit, w, h, 34);
        if (typeof R.buildStaticCache === 'function') {
          var off = document.createElement('canvas');
          R.buildStaticCache(off, circuit, state.geom, Math.min(window.devicePixelRatio || 1, 2), {
            corners: true, sectors: true, line: true, drs: true
          });
          state.staticCanvas = off;
        }
      } else {
        state.geom = null;
        state.staticCanvas = null;
      }
    }

    function start(cfg) {
      stop();
      cfg = cfg || {};
      state.mode = String(cfg.mode || 'fp1').toLowerCase();
      state.speed = Number(cfg.speed || 4);
      state.paused = false;
      state.elapsed = 0;
      state.purpleS1 = 999; state.purpleS2 = 999; state.purpleS3 = 999; state.purpleLap = 999;
      state.programmeInfo = cfg.programmeInfo || {};
      state.onUpdate = cfg.onUpdate || state.onUpdate;
      state.onRadio = cfg.onRadio || state.onRadio;
      state.onComplete = cfg.onComplete || state.onComplete;

      var isQuali = (state.mode === 'q1' || state.mode === 'q2' || state.mode === 'q3');
      state.durationSim = isQuali ? 32 : 38;
      buildGeometry(cfg.circuit);

      var baseLap = Number((cfg.circuit && cfg.circuit.base_lap_s) || 85.0);
      var setupConf = Number(cfg.setupConf || 70);
      var knowledgePct = Number(cfg.knowledgePct || 15);
      var qualiBonusS = Number(cfg.qualiBonusS || 0);
      var tyreChoice = String(cfg.tyreChoice || 'fresh');
      var weather = String(cfg.weather || 'dynamic');
      var isWet = (weather === 'rain' || weather === 'showers');

      var roster = Array.isArray(cfg.roster) ? cfg.roster : [];
      state.cars = roster.map(function (r, i) {
        var perf = (Number(r.car_fit || r.car_overall || 78) * 0.54) + (Number(r.pace || 78) * 0.34) + (Number(r.clutch || 76) * 0.12);
        var setupDelta = r.is_player_team ? ((setupConf - 70) * 0.014 + knowledgePct * 0.002 + (isQuali ? qualiBonusS : 0)) : 0;
        var freshDelta = (isQuali && (!r.is_player_team || tyreChoice !== 'scrubbed')) ? 0.34 : 0;
        var wetDelta = isWet ? ((Number(r.wet || 75) - 75) * 0.035) : 0;
        var targetLap = baseLap + (isQuali ? 0.0 : 1.05) - (perf - 75) * 0.095 - setupDelta - freshDelta - wetDelta;
        var tyreChar = isWet ? 'I' : (isQuali ? 'S' : (r.is_player_team ? (cfg.carTyres && cfg.carTyres[String(r.slot || 0)] || 'M') : ['S', 'M', 'H'][i % 3]));
        return {
          idx: i,
          driver_id: r.driver_id || ('d' + i),
          slot: r.slot != null ? r.slot : i,
          code3: r.code3 || 'DRV',
          clean_name: r.clean_name || ('Driver ' + (i + 1)),
          team_name: r.team_name || '',
          color: r.color || '#e10600',
          is_player_team: !!r.is_player_team,
          targetLap: targetLap,
          tyre: tyreChar,
          prog: (i * 0.047) % 1.0,
          lapSpeed: (0.145 + (perf - 70) * 0.00055) * (isQuali ? 1.10 : 1.0),
          lat: ((i % 3) - 1) * 0.24,
          inPit: (i % 4 === 0),
          pitTimer: (i % 4) * 1.4,
          laps: 0,
          bestLap: 999,
          lastLap: 999,
          s1: 999, s2: 999, s3: 999,
          progPct: 0,
          status: 'OUT LAP'
        };
      });

      /* Seed realistic Race Engineer radio cues timed through the session */
      var pCars = state.cars.filter(function (c) { return c.is_player_team; });
      var c0 = pCars[0] ? pCars[0].code3 : 'CAR1';
      var c1 = pCars[1] ? pCars[1].code3 : 'CAR2';
      if (isQuali) {
        state.radioQueue = [
          { at: 2, text: state.mode.toUpperCase() + ' Green Light! Sending ' + c0 + ' & ' + c1 + ' into clean track air.' },
          { at: 10, text: 'Track evolving fast (-0.18s rubbering in). First banker laps coming through Sector 3.' },
          { at: 20, text: 'Final flying runs! Watch the red elimination cut-off line — push Mode Quali!' },
          { at: 29, text: 'Chequered flag out — cars on track completing final hot laps!' }
        ];
      } else {
        var p0Name = (state.programmeInfo['0'] && state.programmeInfo['0'].name) || 'Track Acclimatisation';
        var p1Name = (state.programmeInfo['1'] && state.programmeInfo['1'].name) || 'Tyre Management';
        state.radioQueue = [
          { at: 2, text: state.mode.toUpperCase() + ' underway: ' + c0 + ' on ' + p0Name + ', ' + c1 + ' on ' + p1Name + '.' },
          { at: 12, text: 'Telemetry live: checking front-wing balance & floor ride height across high-speed kerbs.' },
          { at: 23, text: 'Tyre surface temps stabilizing — pit wall refining Strategy Degradation Model.' },
          { at: 33, text: 'Final programme validation laps — banking Car Knowledge & Dev Points!' }
        ];
      }

      state.active = true;
      state.lastTs = performance.now();
      emitUpdate();
      drawFrame();
      state.rafId = requestAnimationFrame(loop);
    }

    function advanceCarLap(c) {
      c.laps += 1;
      var evo = (state.elapsed / Math.max(1, state.durationSim)) * 0.32;
      var noise = (Math.random() - 0.5) * 0.62;
      var lap = Math.max(55, c.targetLap - evo + noise);
      c.lastLap = Number(lap.toFixed(3));
      var s1 = Number((lap * 0.305 + (Math.random() - 0.5) * 0.14).toFixed(3));
      var s2 = Number((lap * 0.385 + (Math.random() - 0.5) * 0.16).toFixed(3));
      var s3 = Number(Math.max(12, lap - s1 - s2).toFixed(3));
      c.s1 = Math.min(c.s1, s1);
      c.s2 = Math.min(c.s2, s2);
      c.s3 = Math.min(c.s3, s3);
      if (c.s1 < state.purpleS1) state.purpleS1 = c.s1;
      if (c.s2 < state.purpleS2) state.purpleS2 = c.s2;
      if (c.s3 < state.purpleS3) state.purpleS3 = c.s3;
      if (lap < c.bestLap) {
        c.bestLap = Number(lap.toFixed(3));
        if (c.bestLap < state.purpleLap) state.purpleLap = c.bestLap;
      }
      if (c.is_player_team) {
        c.progPct = clamp(c.progPct + 18 + Math.random() * 10, 0, 100);
      }
      /* Occasional pit-box cooldown turn */
      if (c.laps % 3 === 0 && state.elapsed < state.durationSim * 0.78) {
        c.inPit = true;
        c.pitTimer = 2.6;
        c.status = 'IN PIT';
      } else {
        c.status = (state.mode.charAt(0) === 'q') ? 'HOT LAP' : 'PROG RUN';
      }
    }

    function stepSim(dtSim) {
      state.elapsed = Math.min(state.durationSim, state.elapsed + dtSim);

      while (state.radioQueue.length && state.elapsed >= state.radioQueue[0].at) {
        var msg = state.radioQueue.shift();
        if (typeof state.onRadio === 'function') state.onRadio(msg.text);
      }

      for (var i = 0; i < state.cars.length; i++) {
        var c = state.cars[i];
        if (c.inPit) {
          c.pitTimer -= dtSim;
          if (c.pitTimer <= 0) {
            c.inPit = false;
            c.status = 'OUT LAP';
          }
          continue;
        }
        var prev = c.prog;
        c.prog = (c.prog + c.lapSpeed * dtSim) % 1.0;
        if (c.prog < prev) {
          advanceCarLap(c);
        }
      }
    }

    function getClassification() {
      var sorted = state.cars.slice().sort(function (a, b) {
        var la = a.bestLap < 900 ? a.bestLap : (a.targetLap + 4);
        var lb = b.bestLap < 900 ? b.bestLap : (b.targetLap + 4);
        return la - lb;
      });
      var pole = sorted.length && sorted[0].bestLap < 900 ? sorted[0].bestLap : 85.0;
      return sorted.map(function (c, i) {
        var bl = c.bestLap < 900 ? c.bestLap : Number((c.targetLap + 0.5).toFixed(3));
        return {
          pos: i + 1,
          driver_id: c.driver_id,
          slot: c.slot,
          code3: c.code3,
          clean_name: c.clean_name,
          team_name: c.team_name,
          color: c.color,
          is_player_team: c.is_player_team,
          best_lap_s: bl,
          gap_s: Number(Math.max(0, bl - pole).toFixed(3)),
          laps: Math.max(1, c.laps),
          tyre: c.tyre,
          status: c.status,
          progPct: Math.round(c.progPct),
          purple: bl <= state.purpleLap + 0.001
        };
      });
    }

    function emitUpdate() {
      if (typeof state.onUpdate !== 'function') return;
      var rem = Math.max(0, state.durationSim - state.elapsed);
      var pCars = state.cars.filter(function (c) { return c.is_player_team; });
      state.onUpdate({
        mode: state.mode,
        elapsed: state.elapsed,
        duration: state.durationSim,
        progressPct: Math.round((state.elapsed / Math.max(1, state.durationSim)) * 100),
        clockText: Math.floor(rem) + 's',
        classification: getClassification(),
        playerProgress: {
          '0': pCars[0] ? Math.round(pCars[0].progPct) : 0,
          '1': pCars[1] ? Math.round(pCars[1].progPct) : 0
        }
      });
    }

    function finishSession() {
      /* Guarantee every car has at least 2 timed laps & player programmes reflect full session */
      for (var i = 0; i < state.cars.length; i++) {
        var c = state.cars[i];
        while (c.laps < 3) advanceCarLap(c);
        if (c.is_player_team && c.progPct < 76) {
          c.progPct = clamp(76 + Math.random() * 22, 76, 100);
        }
      }
      state.elapsed = state.durationSim;
      state.active = false;
      if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = null; }
      emitUpdate();
      drawFrame();

      var pCars = state.cars.filter(function (c) { return c.is_player_team; });
      var scores = {
        '0': pCars[0] ? Number((pCars[0].progPct / 100).toFixed(2)) : 0.85,
        '1': pCars[1] ? Number((pCars[1].progPct / 100).toFixed(2)) : 0.85
      };
      if (typeof state.onComplete === 'function') {
        state.onComplete({
          mode: state.mode,
          classification: getClassification(),
          programmeScores: scores
        });
      }
    }

    function drawFrame() {
      if (!canvasEl || !state.geom || !R) return;
      var w = Math.max(420, canvasEl.clientWidth || 640);
      var h = Math.max(220, canvasEl.clientHeight || 300);
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvasEl.width !== Math.floor(w * dpr) || canvasEl.height !== Math.floor(h * dpr)) {
        canvasEl.width = Math.floor(w * dpr);
        canvasEl.height = Math.floor(h * dpr);
        buildGeometry(state.circuit);
      }
      var ctx = canvasEl.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (state.staticCanvas) {
        ctx.drawImage(state.staticCanvas, 0, 0, w, h);
      }

      /* Draw all 20 animated cars on track! */
      for (var i = 0; i < state.cars.length; i++) {
        var c = state.cars[i];
        if (c.inPit) continue;
        var pt = R.sampleTrack(state.geom, c.prog);
        if (!pt) continue;
        var wx = pt.x + (pt.nx || 0) * (c.lat * 8);
        var wy = pt.y + (pt.ny || 0) * (c.lat * 8);
        var tCol = TYRE_COL[c.tyre] || '#facc15';
        if (R.drawMiniF1Car) {
          R.drawMiniF1Car(ctx, wx, wy, pt.angle, c.color, tCol, {
            isPlayer: c.is_player_team,
            drsOpen: state.mode.charAt(0) === 'q',
            zoom: 1.0
          });
        } else {
          ctx.fillStyle = c.color;
          ctx.beginPath();
          ctx.arc(wx, wy, c.is_player_team ? 6 : 4.2, 0, Math.PI * 2);
          ctx.fill();
        }
        if (c.is_player_team || i < 3) {
          ctx.font = '700 9px ui-monospace, SFMono-Regular, monospace';
          ctx.fillStyle = c.is_player_team ? '#fde047' : '#e2e8f0';
          ctx.fillText(c.code3, wx + 8, wy - 6);
        }
      }

      /* Live Session HUD Pill overlay */
      var pct = Math.round((state.elapsed / Math.max(1, state.durationSim)) * 100);
      ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
      ctx.fillRect(10, 10, 210, 26);
      ctx.strokeStyle = state.mode.charAt(0) === 'q' ? '#ef4444' : '#38bdf8';
      ctx.lineWidth = 1;
      ctx.strokeRect(10, 10, 210, 26);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '800 11px ui-monospace, SFMono-Regular, monospace';
      var lbl = state.mode.toUpperCase() + (state.active ? ' LIVE' : ' FINISHED') + ' · ' + pct + '% · ' + (state.paused ? 'PAUSED' : (state.speed + 'x'));
      ctx.fillText(lbl, 18, 27);
    }

    function loop(ts) {
      if (!state.active) return;
      var dt = Math.min(0.08, (ts - state.lastTs) / 1000);
      state.lastTs = ts;
      if (!state.paused) {
        stepSim(dt * state.speed);
        emitUpdate();
      }
      drawFrame();
      if (state.elapsed >= state.durationSim) {
        finishSession();
        return;
      }
      state.rafId = requestAnimationFrame(loop);
    }

    function simToEnd() {
      if (!state.active) return;
      var guard = 0;
      while (state.elapsed < state.durationSim && guard < 400) {
        stepSim(0.35);
        guard++;
      }
      finishSession();
    }

    function stop() {
      state.active = false;
      if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = null; }
    }

    return {
      start: start,
      simToEnd: simToEnd,
      stop: stop,
      previewTrack: function (circuit) {
        buildGeometry(circuit);
        state.cars = [];
        drawFrame();
      },
      setSpeed: function (sp) {
        if (sp === 0) { state.paused = true; }
        else { state.paused = false; state.speed = Number(sp) || 4; }
        drawFrame();
      },
      isActive: function () { return state.active; },
      fmtLap: fmtLap
    };
  }

  global.F1WeekendSessionSim = {
    create: createSessionRunner,
    fmtLap: fmtLap
  };
})(window);
