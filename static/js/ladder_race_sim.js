/* Pit Wall: The Ladder — Tick-Based Live 2D Track Map & Strategy Race Engine
 * Features:
 *   - Clean 2D live track map (F1TrackRenderer integration + smooth circuit fallback)
 *   - Pit-Window Rejoin Ghost Predictor (exact predicted rejoin pos & traffic gap)
 *   - Surface vs. Core Tyre Temperature + Thermal Degradation Cliff + Dirty-Air Loss (<1.5s)
 *   - Dynamic Rain Radar + Forecast Uncertainty Band
 *   - Smart Time Controls (1x / 2x / 4x / 8x / 16x) + Auto-Pause on Critical Events
 *   - Strictly Tier-Gated Controls (Karting -> F4 -> F3 -> F2 -> F1)
 */
(function () {
  "use strict";

  const COMPOUNDS = {
    soft:   { code: "S", name: "Soft (Option)", color: "#ef4444", pace: -0.95, wear: 1.48, optCore: 102, wet: 0 },
    medium: { code: "M", name: "Medium",        color: "#facc15", pace: -0.30, wear: 0.96, optCore: 98,  wet: 0 },
    hard:   { code: "H", name: "Hard (Prime)",  color: "#f8fafc", pace:  0.22, wear: 0.62, optCore: 94,  wet: 0 },
    inter:  { code: "I", name: "Intermediate",  color: "#22c55e", pace:  1.20, wear: 0.85, optCore: 86,  wet: 1 },
    wet:    { code: "W", name: "Full Wet",      color: "#3b82f6", pace:  2.40, wear: 0.72, optCore: 78,  wet: 2 },
  };
  const STREET_CIRCUITS = new Set([
    "monaco", "jeddah", "singapore", "baku", "melbourne", "lasvegas", "miami", "montreal",
  ]);

  class LadderRaceSim {
    constructor(canvas, callbacks) {
      this.canvas = canvas;
      this.ctx = canvas ? canvas.getContext("2d") : null;
      this.cb = callbacks || {};
      this.raf = null;
      this.lastTs = 0;
      this.running = false;
      this.paused = true;
      this.finished = false;
      this.speed = 4; // 1, 2, 4, 8, 16
      this.autoPause = true;
      this.geom = null;
      this.staticCache = null;
      this.resetState();
    }

    resetState() {
      this.tier = "karting";
      this.unlocks = {};
      this.facilities = {};
      this.isStreetCircuit = false;
      this.circuit = null;
      this.totalLaps = 15;
      this.pitLossS = 20.5;
      this.cars = [];
      this.raceTimeS = 0;
      this.wetness = 0; // 0..100
      this.targetWetness = 0;
      this.rainUncertainty = 18;
      this.safetyCarLaps = 0;
      this.vscLaps = 0;
      this.safetyCarsTotal = 0;
      this.rubberGrip = 0;
      this.events = [];
      this.pauseBanner = null;
      this.pitWindowNotified = false;
      this.rainNotified = false;
      this.radio = null;
      this.lastAutosaveLap = 0;
    }

    initRace(view, snapshot) {
      this.stop();
      this.resetState();
      const st = view.state;
      const wk = st.weekend;
      this.tier = st.tier;
      this.season = Number(st.season || 1);
      this.roundNum = Number(st.round || 1);
      this.unlocks = (view.tier_config && view.tier_config.unlocks) || {};
      this.facilities = Object.assign({}, st.facilities || {});
      // Strictly gate live team radio by tier unlock (Karting = ZERO radio!)
      if (this.unlocks.live_radio && window.F1RadioEngine && this.cb.radioContainer) {
        this.radio = window.F1RadioEngine.createRadioController(this.cb.radioContainer, {
          sfxEnabled: () => false,
          ttsEnabled: () => false,
        });
      } else {
        this.radio = null;
      }
      this.circuit = view.circuit || { id: "monza", name: wk.circuit_name, base_lap_s: 82, pit_loss_s: 21, pts: [] };
      this.isStreetCircuit = STREET_CIRCUITS.has(String(this.circuit.id || "").toLowerCase());
      this.totalLaps = Number(wk.laps || 15);
      this.pitLossS = Number(this.circuit.pit_loss_s || 20.5);
      this.baseLapS = Number(this.circuit.base_lap_s || 82.0) * (this.tier === "karting" ? 1.24 : (this.tier === "f4" ? 1.16 : (this.tier === "f3" ? 1.10 : (this.tier === "f2" ? 1.05 : 1.0))));
      this.wetness = wk.weather_mode === "rain" ? 68 : (wk.weather_mode === "showers" ? 14 : 0);
      this.targetWetness = wk.weather_mode === "rain" ? 75 : (wk.weather_mode === "showers" ? 58 : 0);
      this.rainUncertainty = this.tier === "f1" ? 8 : (this.tier === "f2" ? 14 : 24);
      this.rainNotified = this.wetness >= 30;

      const grid = (wk.quali_grid && wk.quali_grid.length) ? wk.quali_grid : [];
      const startComp = this.wetness >= 50 ? "wet" : (this.wetness >= 25 ? "inter" : (this.unlocks.prime_option_tyres ? "soft" : "medium"));

      this.cars = grid.map((g, i) => ({
        driver_id: g.driver_id,
        name: g.name,
        code3: g.code3,
        team: g.team,
        color: g.color || "#38bdf8",
        is_player: Boolean(g.is_player),
        car_rating: Number(g.car_rating || 70),
        overall: Number(g.overall || 70),
        stats: g.stats || { pace: 70, racecraft: 70, tyre_care: 70, wet: 70, consistency: 70 },
        trait: g.trait || "",
        ego: Number(g.ego || 55),
        trust: Number(g.trust || 68),
        pos: i + 1,
        lap: 0,
        prog: Math.max(-0.18, -i * 0.0085),
        compound: startComp,
        usedCompounds: new Set([startComp]),
        tyreLife: 100,
        surfTemp: 92,
        coreTemp: 90,
        thermalCliff: false,
        inDirtyAir: false,
        dirtyAirTimer: 0,
        paceMode: "neutral", // conserve | neutral | push
        ersMode: "balanced", // harvest | balanced | overtake
        ers: 68,
        engineMode: "standard", // lean | standard | rich
        boxPending: null, // compound string if scheduled
        inPitS: 0,
        pits: 0,
        dnf: false,
        crash_damage: false,
        obeyed_orders: true,
        lastLapS: this.baseLapS,
        gapAheadS: i === 0 ? 0 : 0.45,
        gapLeaderS: i * 0.45,
      }));

      this._buildTrackCache();
      this.running = true;
      this.finished = false;
      this.lastTs = performance.now();

      if (snapshot && Array.isArray(snapshot.cars) && snapshot.cars.length) {
        this._applySnapshot(snapshot);
        this.paused = true;
        const resumeLap = Number(snapshot.lap || 1);
        this.pauseBanner = {
          title: `RACE RESUMED — LAP ${resumeLap}/${this.totalLaps}`,
          text: "Mid-race autosave restored from SQLite WAL. Review tyre life, gaps & strategy, then click Acknowledge & Resume.",
        };
        this.pushEvent("AUTOSAVE RESTORED", `Resumed ${this.circuit.name} at Lap ${resumeLap}/${this.totalLaps}.`, "info");
      } else {
        this.paused = false;
        this.pushEvent("LIGHTS OUT!", `Green flag at ${this.circuit.name} (${this.totalLaps} laps · ${this.tier.toUpperCase()})`, "info");
      }
      this._emitHud();
      this._loop(this.lastTs);
    }

    restoreFromSnapshot(view, snapshot) {
      this.initRace(view, snapshot);
    }

    _applySnapshot(snap) {
      if (snap.race_time_s != null) this.raceTimeS = Number(snap.race_time_s);
      if (snap.wetness != null) this.wetness = Number(snap.wetness);
      if (snap.target_wetness != null) this.targetWetness = Number(snap.target_wetness);
      if (snap.safety_car_laps != null) this.safetyCarLaps = Number(snap.safety_car_laps);
      if (snap.vsc_laps != null) this.vscLaps = Number(snap.vsc_laps);
      if (snap.safety_cars_total != null) this.safetyCarsTotal = Number(snap.safety_cars_total);
      if (snap.rubber_grip != null) this.rubberGrip = Number(snap.rubber_grip);
      if (snap.rain_notified != null) this.rainNotified = Boolean(snap.rain_notified);
      if (snap.pit_window_notified != null) this.pitWindowNotified = Boolean(snap.pit_window_notified);
      this.lastAutosaveLap = Number(snap.lap || 0);
      if (Array.isArray(snap.events)) this.events = snap.events.slice(0, 26);

      const byId = new Map(snap.cars.map((sc) => [sc.driver_id, sc]));
      for (const c of this.cars) {
        const sc = byId.get(c.driver_id);
        if (!sc) continue;
        if (sc.pos != null) c.pos = Number(sc.pos);
        if (sc.prog != null) {
          c.prog = Number(sc.prog);
          c.lap = Math.max(0, Math.floor(c.prog));
        }
        if (sc.compound && COMPOUNDS[sc.compound]) c.compound = sc.compound;
        if (Array.isArray(sc.usedCompounds) && sc.usedCompounds.length) {
          c.usedCompounds = new Set(sc.usedCompounds);
        } else {
          c.usedCompounds = new Set([c.compound]);
        }
        if (sc.tyreLife != null) c.tyreLife = Number(sc.tyreLife);
        if (sc.surfTemp != null) c.surfTemp = Number(sc.surfTemp);
        if (sc.coreTemp != null) c.coreTemp = Number(sc.coreTemp);
        if (sc.thermalCliff != null) c.thermalCliff = Boolean(sc.thermalCliff);
        if (sc.paceMode) c.paceMode = sc.paceMode;
        if (sc.ersMode) c.ersMode = sc.ersMode;
        if (sc.ers != null) c.ers = Number(sc.ers);
        if (sc.engineMode) c.engineMode = sc.engineMode;
        c.boxPending = sc.boxPending || null;
        if (sc.inPitS != null) c.inPitS = Number(sc.inPitS);
        if (sc.pits != null) c.pits = Number(sc.pits);
        if (sc.dnf != null) c.dnf = Boolean(sc.dnf);
        if (sc.crash_damage != null) c.crash_damage = Boolean(sc.crash_damage);
        if (sc.obeyed_orders != null) c.obeyed_orders = Boolean(sc.obeyed_orders);
      }
      const active = this.cars.filter((c) => !c.dnf).sort((a, b) => b.prog - a.prog);
      active.forEach((c, idx) => {
        c.pos = idx + 1;
        c.gapAheadS = idx === 0 ? 0 : Math.max(0.05, (active[idx - 1].prog - c.prog) * this.baseLapS);
        c.gapLeaderS = idx === 0 ? 0 : Math.max(0.05, (active[0].prog - c.prog) * this.baseLapS);
      });
    }

    _buildTrackCache() {
      if (!this.canvas || !this.ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(320, Math.round(rect.width || 620));
      const h = Math.max(220, Math.round(rect.height || 340));
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.w = w;
      this.h = h;
      this.dpr = dpr;

      if (window.F1TrackRenderer && this.circuit && this.circuit.points && this.circuit.points.length >= 6) {
        this.geom = window.F1TrackRenderer.buildGeometry(this.circuit, w, h);
        const off = document.createElement("canvas");
        off.width = w * dpr;
        off.height = h * dpr;
        window.F1TrackRenderer.buildStaticCache(off, this.circuit, this.geom, dpr, { showKerbs: true, showSectors: true, showStartLine: true });
        this.staticCache = off;
      } else {
        this.geom = null;
        this.staticCache = null;
      }
    }

    _pointAt(frac) {
      const f = ((frac % 1) + 1) % 1;
      if (this.geom && window.F1TrackRenderer && window.F1TrackRenderer.sampleTrack) {
        return window.F1TrackRenderer.sampleTrack(this.geom, f);
      }
      // Clean stadium circuit fallback
      const ang = f * Math.PI * 2 - Math.PI / 2;
      const rx = this.w * 0.38;
      const ry = this.h * 0.34;
      return { x: this.w * 0.5 + Math.cos(ang) * rx, y: this.h * 0.5 + Math.sin(ang) * ry };
    }

    setSpeed(mult) {
      this.speed = mult;
      this._emitHud();
    }

    togglePause(forceVal) {
      if (this.finished) return;
      this.paused = typeof forceVal === "boolean" ? forceVal : !this.paused;
      if (this.paused) {
        this._emitAutosave();
      } else {
        this.pauseBanner = null;
        this.lastTs = performance.now();
      }
      this._emitHud();
    }

    _emitAutosave() {
      if (!this.cb.onAutosave || this.finished) return;
      const ordered = [...this.cars].sort((a, b) => (a.dnf === b.dnf ? b.prog - a.prog : (a.dnf ? 1 : -1)));
      const leadLap = Math.min(this.totalLaps, Math.max(1, Math.floor((ordered[0]?.prog || 0) + 1)));
      this.cb.onAutosave({
        season: this.season || 1,
        round: this.roundNum || 1,
        tier: this.tier,
        circuit_id: this.circuit ? this.circuit.id : "",
        lap: leadLap,
        total_laps: this.totalLaps,
        race_time_s: +this.raceTimeS.toFixed(1),
        wetness: Math.round(this.wetness),
        target_wetness: Math.round(this.targetWetness),
        safety_car_laps: this.safetyCarLaps,
        vsc_laps: this.vscLaps,
        safety_cars_total: this.safetyCarsTotal,
        rubber_grip: +this.rubberGrip.toFixed(4),
        rain_notified: this.rainNotified,
        pit_window_notified: this.pitWindowNotified,
        events: this.events.slice(0, 12),
        cars: this.cars.map((c) => ({
          driver_id: c.driver_id,
          code3: c.code3,
          pos: c.pos,
          prog: +c.prog.toFixed(4),
          compound: c.compound,
          usedCompounds: Array.from(c.usedCompounds || [c.compound]),
          tyreLife: +c.tyreLife.toFixed(1),
          surfTemp: +c.surfTemp.toFixed(1),
          coreTemp: +c.coreTemp.toFixed(1),
          thermalCliff: c.thermalCliff,
          paceMode: c.paceMode,
          ersMode: c.ersMode,
          ers: +c.ers.toFixed(1),
          engineMode: c.engineMode,
          boxPending: c.boxPending,
          inPitS: +c.inPitS.toFixed(2),
          pits: c.pits,
          dnf: c.dnf,
          crash_damage: c.crash_damage,
          obeyed_orders: c.obeyed_orders,
        })),
      });
    }

    _emitRadio(evType, car, ctx) {
      if (!this.unlocks.live_radio || !this.radio || !car) return;
      try {
        this.radio.emit(evType, {
          idx: 0, code3: car.code3, name: car.name, color: car.color,
          team: car.team, confidence: car.trust || 72, lap: car.lap || 1,
        }, ctx || {});
      } catch (_) {}
    }

    toggleAutoPause() {
      this.autoPause = !this.autoPause;
      this._emitHud();
    }

    setDriverPace(driverId, mode) {
      const c = this.cars.find((x) => x.driver_id === driverId);
      if (!c || c.dnf) return;
      c.paceMode = mode;
      this._emitHud();
    }

    setDriverErs(driverId, mode) {
      if (!this.unlocks.ers_engine_modes) return;
      const c = this.cars.find((x) => x.driver_id === driverId);
      if (!c || c.dnf) return;
      c.ersMode = mode;
      this._emitHud();
    }

    setDriverEngine(driverId, mode) {
      if (!this.unlocks.ers_engine_modes) return;
      const c = this.cars.find((x) => x.driver_id === driverId);
      if (!c || c.dnf) return;
      c.engineMode = mode;
      this._emitHud();
    }

    callPitBox(driverId, compound) {
      if (!this.unlocks.pit_stops) return;
      if (!this.unlocks.mandatory_pit && !this.unlocks.prime_option_tyres && compound !== "inter" && compound !== "wet" && this.wetness < 20) {
        // F4 wet-only strategic pit stops allowed anytime, dry optional
      }
      const c = this.cars.find((x) => x.driver_id === driverId);
      if (!c || c.dnf) return;
      c.boxPending = compound;
      this.pushEvent("BOX THIS LAP", `${c.code3} scheduled for ${COMPOUNDS[compound].name} tyres.`, "pit");
      this._emitHud();
    }

    issueTeamOrder(orderType) {
      if (!this.unlocks.team_orders) return;
      const mine = this.cars.filter((c) => c.is_player && !c.dnf).sort((a, b) => a.pos - b.pos);
      if (mine.length < 2) return;
      const front = mine[0], back = mine[1];
      if (orderType === "swap") {
        // Relationship & Ego Matrix Check! (Iron Nerve lowers pushback risk)
        const nerveAdj = front.trait === "Iron Nerve" ? -15 : 0;
        const disobeyProb = Math.max(0.05, ((front.ego - front.trust) + 12 + nerveAdj) / 100);
        if (Math.random() < disobeyProb) {
          front.obeyed_orders = false;
          this._triggerCriticalPause("RADIO PUSHBACK!", `${front.name}: "Negative! I have the pace — tell ${back.code3} to race me on track!" (Ego ${front.ego} vs Trust ${front.trust})`);
        } else {
          const tmpProg = front.prog;
          front.prog = Math.max(0, back.prog - 0.004);
          back.prog = tmpProg + 0.002;
          this.pushEvent("TEAM ORDER OBEYED", `${front.code3} yields position cleanly to ${back.code3} on the main straight.`, "info");
        }
      } else if (orderType === "hold") {
        back.paceMode = "conserve";
        this.pushEvent("HOLD POSITION", `Pit wall orders ${back.code3} to hold formation behind ${front.code3} and save tyres.`, "info");
      }
      this._emitHud();
    }

    predictPitRejoin(car) {
      if (!car || car.dnf) return { rejoinPos: car ? car.pos : 1, trafficGapS: 0, ghostProg: 0 };
      const effectiveLoss = (this.safetyCarLaps > 0 || this.vscLaps > 0) ? this.pitLossS * 0.56 : this.pitLossS;
      const lossLaps = effectiveLoss / this.baseLapS;
      const projectedProg = car.prog - lossLaps;
      let ahead = 0;
      let closestGapS = 99;
      for (const other of this.cars) {
        if (other.dnf || other.driver_id === car.driver_id) continue;
        if (other.prog > projectedProg) {
          ahead++;
          const g = (other.prog - projectedProg) * this.baseLapS;
          if (g < closestGapS) closestGapS = g;
        }
      }
      return {
        rejoinPos: ahead + 1,
        trafficGapS: closestGapS < 90 ? +closestGapS.toFixed(1) : 9.9,
        ghostProg: ((projectedProg % 1) + 1) % 1,
      };
    }

    pushEvent(title, text, kind) {
      const leadLap = Math.min(this.totalLaps, Math.max(1, Math.floor((this.cars[0]?.prog || 0) + 1)));
      this.events.unshift({ lap: leadLap, title, text, kind: kind || "info" });
      if (this.events.length > 26) this.events.pop();
    }

    _triggerCriticalPause(title, text) {
      this.pushEvent(title, text, "alert");
      if (this.autoPause) {
        this.paused = true;
        this.pauseBanner = { title, text };
      }
    }

    simToEnd() {
      if (this.finished) return;
      this.paused = false;
      this.pauseBanner = null;
      const prevAuto = this.autoPause;
      this.autoPause = false;
      let guard = 0;
      while (!this.finished && guard < 12000) {
        this._stepSim(0.25);
        guard++;
      }
      this.autoPause = prevAuto;
      this._render();
      this._emitHud();
    }

    _stepSim(simDtS) {
      if (this.finished) return;
      this.raceTimeS += simDtS;
      this.rubberGrip = Math.min(0.45, this.rubberGrip + simDtS * 0.00025);

      // Dynamic weather evolution + rain onset critical pause
      const leadProg = Math.max(...this.cars.map((c) => (c.dnf ? 0 : c.prog)), 0);
      const raceFrac = leadProg / Math.max(1, this.totalLaps);
      if (this.targetWetness > 0 && raceFrac > 0.25) {
        this.wetness = Math.min(this.targetWetness, this.wetness + simDtS * 0.11);
      } else if (this.wetness > 0 && this.targetWetness === 0) {
        this.wetness = Math.max(0, this.wetness - simDtS * 0.08);
      }
      if (!this.rainNotified && this.wetness >= 26) {
        this.rainNotified = true;
        const pCar = this.cars.find((c) => c.is_player && !c.dnf);
        this._emitRadio("rain", pCar, { lap: Math.floor(leadProg) + 1 });
        this._triggerCriticalPause("RAIN ONSET!", `Track wetness crossed ${Math.round(this.wetness)}% — crossover to Intermediates approaching!`);
      }

      // Pit window opening notification for mandatory pit tiers (F2/F1)
      if (this.unlocks.mandatory_pit && !this.pitWindowNotified && raceFrac >= 0.34) {
        this.pitWindowNotified = true;
        this._triggerCriticalPause("PIT WINDOW OPEN", "Optimal undercut / overcut window is now open — check Rejoin Ghosts on the track map!");
      }

      // Sort current running order to compute gaps & dirty air (<1.5s!)
      const active = this.cars.filter((c) => !c.dnf).sort((a, b) => b.prog - a.prog);
      active.forEach((c, idx) => {
        c.pos = idx + 1;
        if (idx === 0) {
          c.gapAheadS = 0;
          c.gapLeaderS = 0;
          c.inDirtyAir = false;
        } else {
          const ahead = active[idx - 1];
          c.gapAheadS = Math.max(0.05, (ahead.prog - c.prog) * this.baseLapS);
          c.gapLeaderS = Math.max(0.05, (active[0].prog - c.prog) * this.baseLapS);
          c.inDirtyAir = c.gapAheadS <= 1.5 && this.safetyCarLaps === 0;
        }
      });

      const prevLeadLap = Math.floor(leadProg);

      for (const c of this.cars) {
        if (c.dnf) continue;
        if (c.inPitS > 0) {
          c.inPitS = Math.max(0, c.inPitS - simDtS);
          continue;
        }

        const comp = COMPOUNDS[c.compound] || COMPOUNDS.medium;
        // Surface vs Core Tyre Thermal Model! (Tire Whisperer tolerates +4°C core heat)
        const pushHeat = c.paceMode === "push" ? 9.0 : (c.paceMode === "conserve" ? -6.5 : 0.0);
        const dirtyHeat = c.inDirtyAir ? 4.8 : 0.0;
        const wetCool = this.wetness >= 25 && comp.wet === 0 ? -14.0 : (this.wetness < 12 && comp.wet > 0 ? 16.0 : 0.0);
        const targetSurf = comp.optCore + pushHeat + dirtyHeat + wetCool;
        c.surfTemp += (targetSurf - c.surfTemp) * Math.min(1, simDtS * 0.09);
        c.coreTemp += (c.surfTemp - c.coreTemp) * Math.min(1, simDtS * 0.032);
        const cliffOffset = c.trait === "Tire Whisperer" ? 14.5 : 10.5;
        c.thermalCliff = c.coreTemp > comp.optCore + cliffOffset || c.tyreLife < 24;

        // Tyre wear scaled by thermal cliff, facilities (adv_sim) & traits
        const advSimLv = c.is_player ? Math.max(1, Number(this.facilities.adv_sim || 1)) : 1;
        const traitWearMult = c.trait === "Tire Whisperer" ? 0.85 : (c.trait === "Smooth Operator" ? 0.95 : 1.0);
        const wearRate = (comp.wear * (100 / Math.max(10, this.totalLaps * 1.15)))
          * (c.paceMode === "push" ? 1.32 : (c.paceMode === "conserve" ? 0.72 : 1.0))
          * (c.thermalCliff ? 1.48 : 1.0)
          * (1.0 - (c.stats.tyre_care - 72) * 0.008)
          * traitWearMult
          * (1.0 - (advSimLv - 1) * 0.03);
        const lapFrac = simDtS / this.baseLapS;
        c.tyreLife = Math.max(4, c.tyreLife - wearRate * lapFrac);

        // ERS battery update (F1 only)
        if (this.unlocks.ers_engine_modes) {
          if (c.ersMode === "overtake") c.ers = Math.max(0, c.ers - lapFrac * 36);
          else if (c.ersMode === "harvest") c.ers = Math.min(100, c.ers + lapFrac * 30);
          else c.ers = Math.min(100, c.ers + lapFrac * 5);
        }

        // Compute realistic lap time!
        let lapS = this.baseLapS;
        const perf = c.car_rating * (this.tier === "f1" ? 0.50 : 0.26) + c.stats.racecraft * 0.28 + c.stats.pace * (this.tier === "f1" ? 0.22 : 0.46);
        lapS -= (perf - 70) * 0.078;
        lapS -= this.rubberGrip;
        lapS += comp.pace;
        // Karting garage bays facility bonus for player
        if (c.is_player && this.tier === "karting") {
          const garageLv = Math.max(1, Number(this.facilities.garage_bays || 1));
          lapS -= (garageLv - 1) * 0.12;
        }
        // Trait pace bonuses (Street Fighter, Crash-Prone Charger)
        if (c.trait === "Street Fighter" && this.isStreetCircuit) lapS -= 0.26;
        if (c.trait === "Crash-Prone Charger" && c.paceMode === "push") lapS -= 0.16;
        // Tyre degradation & thermal cliff penalty
        if (c.tyreLife < 40) lapS += (40 - c.tyreLife) * 0.045;
        if (c.thermalCliff) lapS += 1.15;
        // Dirty air downforce loss (<1.5s) vs DRS / Slipstream / Late Braker gain
        if (c.inDirtyAir) {
          lapS += this.tier === "karting" ? -0.22 : (this.unlocks.drs && c.gapAheadS < 1.0 ? -0.18 : 0.34);
          if (c.trait === "Late Braker") lapS -= 0.18;
        }
        // Wet weather & wrong-tyre crossover penalty! (Wet Weather Specialist shines)
        if (this.wetness >= 22) {
          if (comp.wet === 0) lapS += (this.wetness - 18) * 0.14;
          else if (comp.wet === 1 && this.wetness >= 68) lapS += (this.wetness - 64) * 0.08;
          lapS -= (c.stats.wet - 70) * 0.028;
          if (c.trait === "Wet Weather Specialist") lapS -= 0.35;
        } else if (comp.wet > 0) {
          lapS += 2.6;
        }
        // Pace / ERS / Engine mode modifiers
        if (c.paceMode === "push") lapS -= 0.42;
        else if (c.paceMode === "conserve") lapS += 0.38;
        if (this.unlocks.ers_engine_modes) {
          if (c.ersMode === "overtake" && c.ers > 6) lapS -= 0.55;
          else if (c.ersMode === "harvest") lapS += 0.35;
          if (c.engineMode === "rich") lapS -= 0.28;
          else if (c.engineMode === "lean") lapS += 0.24;
        }
        if (this.safetyCarLaps > 0) lapS *= 1.32;
        else if (this.vscLaps > 0) lapS *= 1.18;

        c.lastLapS = lapS;
        const oldLap = Math.floor(c.prog);
        c.prog += simDtS / Math.max(45, lapS);
        const newLap = Math.floor(c.prog);

        // Lap crossing checks: Pit Stop execution, AI Pit Strategy & Incidents!
        if (newLap > oldLap && newLap < this.totalLaps) {
          c.lap = newLap;
          // Player scheduled box
          if (c.boxPending && this.unlocks.pit_stops) {
            this._executePitStop(c, c.boxPending);
            c.boxPending = null;
          } else if (!c.is_player && this.unlocks.pit_stops) {
            // Smart AI pit decisions (wet crossover OR mandatory tyre cliff)
            const needWet = this.wetness >= 58 && comp.wet < 2;
            const needInter = this.wetness >= 26 && this.wetness < 58 && comp.wet !== 1;
            const needDry = this.wetness < 14 && comp.wet > 0;
            const needLife = this.unlocks.mandatory_pit && (c.tyreLife < 28 || (c.usedCompounds.size < 2 && newLap >= Math.floor(this.totalLaps * 0.62)));
            if (needWet) this._executePitStop(c, "wet");
            else if (needInter) this._executePitStop(c, "inter");
            else if (needDry) this._executePitStop(c, "medium");
            else if (needLife) this._executePitStop(c, c.compound === "soft" ? "hard" : "medium");
          }

          // Incident & Safety Car check (scaled by traits & Sports Science Lab)!
          const sportSciLv = c.is_player ? Math.max(1, Number(this.facilities.sports_science || 1)) : 1;
          let traitIncMult = 1.0;
          if (c.trait === "Iron Nerve") traitIncMult *= 0.70;
          else if (c.trait === "Smooth Operator") traitIncMult *= 0.80;
          else if (c.trait === "Wet Weather Specialist" && this.wetness >= 22) traitIncMult *= 0.78;
          else if (c.trait === "Crash-Prone Charger") traitIncMult *= 1.45;
          else if (c.trait === "Fragile Confidence" && (c.thermalCliff || c.paceMode === "push")) traitIncMult *= 1.35;
          const incProb = (0.0042 - (c.stats.consistency - 70) * 0.00009)
            * (this.tier === "f3" ? 1.45 : 1.0)
            * (c.paceMode === "push" ? 1.35 : 1.0)
            * (c.thermalCliff ? 1.5 : 1.0)
            * traitIncMult
            * Math.max(0.65, 1.0 - (sportSciLv - 1) * 0.08);
          if (newLap >= 2 && this.safetyCarLaps === 0 && Math.random() < Math.max(0.001, incProb)) {
            c.dnf = true;
            c.crash_damage = true;
            if (Math.random() < 0.55) {
              this.safetyCarLaps = 2;
              this.safetyCarsTotal++;
              this._triggerCriticalPause("SAFETY CAR DEPLOYED!", `${c.name} (${c.team}) crashed at Turn ${Math.floor(Math.random() * 12) + 1}! Pit loss halved during SC!`);
            } else {
              this.pushEvent("RETIREMENT", `${c.name} (${c.team}) is out with crash damage.`, "warn");
            }
          }
        }
      }

      const newLeadLap = Math.floor(Math.max(...this.cars.map((c) => (c.dnf ? 0 : c.prog)), 0));
      if (newLeadLap > prevLeadLap) {
        if (this.safetyCarLaps > 0) this.safetyCarLaps--;
        if (this.vscLaps > 0) this.vscLaps--;
        if (newLeadLap >= 2 && newLeadLap - this.lastAutosaveLap >= 2) {
          this.lastAutosaveLap = newLeadLap;
          this._emitAutosave();
        }
      }

      // Check Chequered Flag
      const leader = this.cars.filter((c) => !c.dnf).sort((a, b) => b.prog - a.prog)[0];
      if (!leader || leader.prog >= this.totalLaps) {
        this.finished = true;
        this.paused = true;
        const finalOrder = [...this.cars].sort((a, b) => (a.dnf === b.dnf ? b.prog - a.prog : (a.dnf ? 1 : -1)));
        finalOrder.forEach((c, idx) => { c.pos = idx + 1; });
        this.pushEvent("CHEQUERED FLAG!", `${finalOrder[0]?.name || "Leader"} wins at ${this.circuit.name}!`, "info");
        if (this.cb.onFinish) {
          this.cb.onFinish(
            finalOrder.map((c) => ({
              driver_id: c.driver_id,
              name: c.name,
              pos: c.pos,
              dnf: c.dnf,
              crash_damage: c.crash_damage,
              obeyed_orders: c.obeyed_orders,
            })),
            { weather_summary: this.wetness >= 25 ? "Wet / Mixed" : "Dry", safety_cars: this.safetyCarsTotal }
          );
        }
      }
    }

    _executePitStop(car, newComp) {
      const pitRigLv = car.is_player ? Math.max(1, Number(this.facilities.pit_rig || 1)) : 1;
      const campusLv = car.is_player ? Math.max(1, Number(this.facilities.factory_campus || 1)) : 1;
      const rigGainS = (pitRigLv - 1) * 0.22 + (campusLv - 1) * 0.08;
      const rawLoss = Math.max(12.0, this.pitLossS - rigGainS);
      const baseLoss = (this.safetyCarLaps > 0 || this.vscLaps > 0) ? rawLoss * 0.56 : rawLoss;
      const errProb = Math.max(0.015, 0.10 - (pitRigLv - 1) * 0.02);
      const crewError = this.unlocks.pit_crew_drills && Math.random() < errProb ? 2.8 : 0.0;
      car.inPitS = baseLoss + crewError;
      car.compound = newComp;
      car.usedCompounds.add(newComp);
      car.tyreLife = 100;
      car.surfTemp = COMPOUNDS[newComp].optCore - 8;
      car.coreTemp = COMPOUNDS[newComp].optCore - 10;
      car.thermalCliff = false;
      car.pits++;
      if (car.is_player) {
        const stationaryS = Math.max(1.9, 2.6 - rigGainS + crewError);
        this.pushEvent(
          crewError > 0 ? "SLOW PIT STOP!" : "PIT STOP CLEAN",
          `${car.code3} boxed for ${COMPOUNDS[newComp].name} (${stationaryS.toFixed(1)}s stationary${pitRigLv > 1 ? ` · Rig Lv${pitRigLv}` : ""}).`,
          crewError > 0 ? "warn" : "pit"
        );
      }
    }

    _render() {
      if (!this.ctx || !this.canvas) return;
      const ctx = this.ctx;
      const dpr = this.dpr || 1;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, this.w, this.h);

      // Background dark tarmac canvas
      const bg = ctx.createRadialGradient(this.w * 0.5, this.h * 0.5, 20, this.w * 0.5, this.h * 0.5, this.w * 0.65);
      bg.addColorStop(0, this.wetness >= 25 ? "#0c1b2a" : "#111827");
      bg.addColorStop(1, "#060911");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, this.w, this.h);

      if (this.staticCache) {
        ctx.drawImage(this.staticCache, 0, 0, this.w, this.h);
      } else {
        // Clean stadium loop fallback
        ctx.strokeStyle = "#334155";
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.ellipse(this.w * 0.5, this.h * 0.5, this.w * 0.38, this.h * 0.34, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw Pit-Window Rejoin Ghost Markers for Player Cars (when pit stops unlocked!)
      if (this.unlocks.pit_stops) {
        for (const pc of this.cars.filter((c) => c.is_player && !c.dnf)) {
          const pred = this.predictPitRejoin(pc);
          const gp = this._pointAt(pred.ghostProg);
          ctx.save();
          ctx.strokeStyle = "#22d3ee";
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(gp.x, gp.y, 9, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "#22d3ee";
          ctx.font = "700 9px monospace";
          ctx.fillText(`REJOIN P${pred.rejoinPos}`, gp.x + 11, gp.y + 3);
          ctx.restore();
        }
      }

      // Draw AI Cars first, then Player Cars on top
      const sortedDraw = [...this.cars].sort((a, b) => (a.is_player === b.is_player ? 0 : (a.is_player ? 1 : -1)));
      for (const c of sortedDraw) {
        if (c.dnf) continue;
        const p = this._pointAt(c.prog);
        const r = c.is_player ? 6.5 : 4.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = c.color;
        ctx.fill();
        ctx.lineWidth = c.is_player ? 2 : 1;
        ctx.strokeStyle = c.is_player ? "#ffffff" : "#0f172a";
        ctx.stroke();
        if (c.is_player || c.pos <= 3) {
          ctx.fillStyle = c.is_player ? "#fde047" : "#cbd5e1";
          ctx.font = c.is_player ? "800 10px monospace" : "700 9px monospace";
          ctx.fillText(c.code3, p.x + 8, p.y - 5);
        }
      }

      // Dynamic Rain Overlay
      if (this.wetness >= 20) {
        ctx.fillStyle = `rgba(56, 189, 248, ${Math.min(0.16, this.wetness / 500)})`;
        ctx.fillRect(0, 0, this.w, this.h);
      }

      ctx.restore();
    }

    _emitHud() {
      if (!this.cb.onTick) return;
      const ordered = [...this.cars].sort((a, b) => (a.dnf === b.dnf ? b.prog - a.prog : (a.dnf ? 1 : -1)));
      const leadLap = Math.min(this.totalLaps, Math.max(1, Math.floor((ordered[0]?.prog || 0) + 1)));
      const playerCars = ordered.filter((c) => c.is_player).map((c) => ({
        ...c,
        rejoin: this.predictPitRejoin(c),
      }));
      this.cb.onTick({
        leadLap,
        totalLaps: this.totalLaps,
        paused: this.paused,
        finished: this.finished,
        speed: this.speed,
        autoPause: this.autoPause,
        wetness: Math.round(this.wetness),
        targetWetness: Math.round(this.targetWetness),
        rainUncertainty: this.rainUncertainty,
        safetyCarLaps: this.safetyCarLaps,
        vscLaps: this.vscLaps,
        pauseBanner: this.pauseBanner,
        standings: ordered,
        playerCars,
        events: this.events.slice(0, 10),
        compounds: COMPOUNDS,
      });
    }

    _loop(ts) {
      if (!this.running) return;
      const dt = Math.min(0.08, Math.max(0.001, (ts - this.lastTs) / 1000));
      this.lastTs = ts;
      if (!this.paused && !this.finished) {
        // 1x = 12s real per lap-ish scaled smoothly up to 16x!
        this._stepSim(dt * this.speed * 2.2);
        this._emitHud();
      }
      this._render();
      this.raf = requestAnimationFrame((t) => this._loop(t));
    }

    stop() {
      this.running = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  window.LadderRaceSim = LadderRaceSim;
})();
