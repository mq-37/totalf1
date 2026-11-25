/**
 * Apex POV (/drive) — Multi-Era RPM-Coupled Web Audio Driving & Elements Synthesizer.
 *
 * Channels:
 *   - Era-specific continuous engine voice (Hybrid V6 + MGU-K whine, 19k RPM V10, 80s Turbo, DFV V8, Classic NA, 2-Stroke Kart)
 *   - Upshift ignition-cut pop & downshift throttle blip + DRS flap click
 *   - Slip-proportional tyre scrub/screech + kerb bass rumble + 300 KPH wind rush
 *   - Off-track gravel/runoff crunch + wet rain cockpit patter + flat-spot rhythmic thump
 *   - Carbon-fiber impact crunch + sub-bass barrier thud + FIA 5-red-lights beeps
 */
(function (global) {
  "use strict";

  const ERA_ACOUSTICS = {
    hybrid_v6:    { baseMult: 0.0155, harmRatio: 1.50, subRatio: 0.50, type1: "sawtooth", type2: "triangle", whineHz: 0.24, filterBase: 360, filterSpan: 1550 },
    v10_scream:   { baseMult: 0.0255, harmRatio: 2.00, subRatio: 0.50, type1: "sawtooth", type2: "sawtooth", whineHz: 0.0,  filterBase: 520, filterSpan: 2800 },
    turbo_v6:     { baseMult: 0.0175, harmRatio: 1.50, subRatio: 0.50, type1: "sawtooth", type2: "square",   whineHz: 0.32, filterBase: 320, filterSpan: 1700 },
    dfv_v8:       { baseMult: 0.0210, harmRatio: 2.00, subRatio: 0.50, type1: "sawtooth", type2: "triangle", whineHz: 0.0,  filterBase: 400, filterSpan: 1950 },
    classic_na:   { baseMult: 0.0145, harmRatio: 1.50, subRatio: 0.50, type1: "triangle", type2: "sawtooth", whineHz: 0.0,  filterBase: 260, filterSpan: 1100 },
    kart_2stroke: { baseMult: 0.0220, harmRatio: 2.00, subRatio: 1.00, type1: "square",   type2: "sawtooth", whineHz: 0.0,  filterBase: 480, filterSpan: 2200 },
  };

  function createDriveAudio() {
    let ac = null;
    let master = null;
    let osc1 = null, osc2 = null, oscSub = null, oscWhine = null;
    let engFilter = null, engGain = null, whineGain = null;
    let noiseBuf = null;
    let scrubSrc = null, scrubFilter = null, scrubGain = null;
    let windSrc = null, windFilter = null, windGain = null;
    let gravelSrc = null, gravelFilter = null, gravelGain = null;
    let rainSrc = null, rainFilter = null, rainGain = null;
    let kerbOsc = null, kerbGain = null;
    let activeProfile = ERA_ACOUSTICS.hybrid_v6;
    let prevDrsOpen = false;
    let muted = false;
    let started = false;

    function buildNoise(ctx) {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    function init(profileKey) {
      activeProfile = ERA_ACOUSTICS[profileKey] || ERA_ACOUSTICS.hybrid_v6;
      if (started && ac) {
        if (ac.state === "suspended") ac.resume().catch(() => {});
        if (osc1) osc1.type = activeProfile.type1;
        if (osc2) osc2.type = activeProfile.type2;
        return;
      }
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      try {
        ac = new AC();
        master = ac.createGain();
        master.gain.value = muted ? 0.0001 : 0.42;
        const comp = ac.createDynamicsCompressor();
        master.connect(comp);
        comp.connect(ac.destination);

        // Engine stack
        engFilter = ac.createBiquadFilter();
        engFilter.type = "lowpass";
        engFilter.frequency.value = 600;
        engFilter.Q.value = 2.4;

        engGain = ac.createGain();
        engGain.gain.value = 0.0001;
        engFilter.connect(engGain);
        engGain.connect(master);

        osc1 = ac.createOscillator();
        osc2 = ac.createOscillator();
        oscSub = ac.createOscillator();
        osc1.type = activeProfile.type1;
        osc2.type = activeProfile.type2;
        oscSub.type = "triangle";

        const g1 = ac.createGain(); g1.gain.value = 0.52;
        const g2 = ac.createGain(); g2.gain.value = 0.30;
        const gSub = ac.createGain(); gSub.gain.value = 0.28;
        osc1.connect(g1); g1.connect(engFilter);
        osc2.connect(g2); g2.connect(engFilter);
        oscSub.connect(gSub); gSub.connect(engFilter);

        // Turbo / MGU-K whine
        oscWhine = ac.createOscillator();
        oscWhine.type = "sine";
        whineGain = ac.createGain();
        whineGain.gain.value = 0.0001;
        oscWhine.connect(whineGain);
        whineGain.connect(master);

        // Shared noise buffer for Tyre Scrub, Wind, Gravel Crunch & Rain Patter
        noiseBuf = buildNoise(ac);

        scrubSrc = ac.createBufferSource();
        scrubSrc.buffer = noiseBuf; scrubSrc.loop = true;
        scrubFilter = ac.createBiquadFilter();
        scrubFilter.type = "bandpass"; scrubFilter.frequency.value = 1350; scrubFilter.Q.value = 4.5;
        scrubGain = ac.createGain(); scrubGain.gain.value = 0.0001;
        scrubSrc.connect(scrubFilter); scrubFilter.connect(scrubGain); scrubGain.connect(master);

        windSrc = ac.createBufferSource();
        windSrc.buffer = noiseBuf; windSrc.loop = true;
        windFilter = ac.createBiquadFilter();
        windFilter.type = "bandpass"; windFilter.frequency.value = 460; windFilter.Q.value = 0.8;
        windGain = ac.createGain(); windGain.gain.value = 0.0001;
        windSrc.connect(windFilter); windFilter.connect(windGain); windGain.connect(master);

        gravelSrc = ac.createBufferSource();
        gravelSrc.buffer = noiseBuf; gravelSrc.loop = true;
        gravelFilter = ac.createBiquadFilter();
        gravelFilter.type = "bandpass"; gravelFilter.frequency.value = 2600; gravelFilter.Q.value = 1.4;
        gravelGain = ac.createGain(); gravelGain.gain.value = 0.0001;
        gravelSrc.connect(gravelFilter); gravelFilter.connect(gravelGain); gravelGain.connect(master);

        rainSrc = ac.createBufferSource();
        rainSrc.buffer = noiseBuf; rainSrc.loop = true;
        rainFilter = ac.createBiquadFilter();
        rainFilter.type = "highpass"; rainFilter.frequency.value = 1900;
        rainGain = ac.createGain(); rainGain.gain.value = 0.0001;
        rainSrc.connect(rainFilter); rainFilter.connect(rainGain); rainGain.connect(master);

        // Kerb & Flat-spot low-frequency rumble
        kerbOsc = ac.createOscillator();
        kerbOsc.type = "triangle"; kerbOsc.frequency.value = 42;
        kerbGain = ac.createGain(); kerbGain.gain.value = 0.0001;
        kerbOsc.connect(kerbGain); kerbGain.connect(master);

        osc1.start(); osc2.start(); oscSub.start(); oscWhine.start();
        scrubSrc.start(); windSrc.start(); gravelSrc.start(); rainSrc.start(); kerbOsc.start();
        started = true;
      } catch (_) {}
    }

    function update(car, throttle, paused, wetness) {
      if (!started || !ac) return;
      const now = ac.currentTime;
      if (paused || muted || !car) {
        engGain.gain.setTargetAtTime(0.0001, now, 0.06);
        whineGain.gain.setTargetAtTime(0.0001, now, 0.06);
        scrubGain.gain.setTargetAtTime(0.0001, now, 0.06);
        windGain.gain.setTargetAtTime(0.0001, now, 0.06);
        gravelGain.gain.setTargetAtTime(0.0001, now, 0.04);
        rainGain.gain.setTargetAtTime(0.0001, now, 0.08);
        kerbGain.gain.setTargetAtTime(0.0001, now, 0.04);
        return;
      }

      const rpm = Math.max(1800, Number(car.rpm || 4000));
      const p = activeProfile;
      const f0 = Math.max(48, rpm * p.baseMult);
      osc1.frequency.setTargetAtTime(f0, now, 0.025);
      osc2.frequency.setTargetAtTime(f0 * p.harmRatio, now, 0.025);
      oscSub.frequency.setTargetAtTime(f0 * p.subRatio, now, 0.03);

      const load = 0.35 + 0.65 * Math.max(0, Math.min(1, throttle || 0));
      const cut = p.filterBase + (rpm / (car.dna.redline_rpm || 13200)) * p.filterSpan * load;
      engFilter.frequency.setTargetAtTime(cut, now, 0.03);
      engGain.gain.setTargetAtTime(0.16 + load * 0.14, now, 0.04);

      if (p.whineHz > 0) {
        oscWhine.frequency.setTargetAtTime(rpm * p.whineHz + (car.ersActive ? 420 : 0), now, 0.03);
        whineGain.gain.setTargetAtTime(car.ersActive ? 0.065 : 0.022 * load, now, 0.05);
      } else {
        whineGain.gain.setTargetAtTime(0.0001, now, 0.05);
      }

      // Tyre scrub / lockup screech
      const scrub = Math.max(car.tyreScrub || 0, car.lockingFront ? 0.85 : 0);
      scrubGain.gain.setTargetAtTime(scrub > 0.04 ? scrub * 0.15 : 0.0001, now, 0.03);

      // Aerodynamic wind rush (includes headwind!)
      const kphFrac = Math.max(0, Math.min(1.15, ((car.speedKph || 0) + (car.headwindMps || 0) * 3.6) / 340));
      windFilter.frequency.setTargetAtTime(300 + kphFrac * 920, now, 0.08);
      windGain.gain.setTargetAtTime(kphFrac * kphFrac * 0.12, now, 0.08);

      // Gravel/runoff crunch & puddle splash
      const grav = Math.max(car.gravelIntensity || 0, (car.aquaplane || 0) * 0.85);
      gravelFilter.frequency.setTargetAtTime(car.inPuddle ? 1400 : 2700, now, 0.04);
      gravelGain.gain.setTargetAtTime(grav > 0.04 ? grav * 0.19 : 0.0001, now, 0.03);

      // Rain patter on cockpit/visor
      const wet = Math.max(0, Math.min(1, Number(wetness || 0) / 100));
      rainGain.gain.setTargetAtTime(wet > 0.18 ? wet * 0.065 : 0.0001, now, 0.15);

      // Kerb rumble + flat-spot rhythmic thump
      const flatThump = (car.flatSpot || 0) > 0.15 && (car.speedKph || 0) > 40
        ? (0.5 + 0.5 * Math.sin((car.wheelSpin || 0))) * (car.flatSpot || 0) * 0.55
        : 0;
      const rumble = Math.max(car.kerbIntensity || 0, flatThump);
      kerbOsc.frequency.setTargetAtTime(34 + kphFrac * 38, now, 0.02);
      kerbGain.gain.setTargetAtTime(rumble > 0.05 ? rumble * 0.24 : 0.0001, now, 0.02);

      // DRS flap actuator click
      const drsNow = Boolean(car.drsOpen);
      if (drsNow !== prevDrsOpen) {
        prevDrsOpen = drsNow;
        playDrsClick(drsNow);
      }

      if (car.justShifted !== 0) playShiftCue(car.justShifted > 0);
      if ((car.impactStrength || 0) > 0.14) playImpact(car.impactStrength);
    }

    function playDrsClick(opening) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(opening ? 640 : 420, t);
      o.frequency.exponentialRampToValueAtTime(opening ? 1020 : 280, t + 0.055);
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.065);
    }

    function playShiftCue(isUp) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(isUp ? 190 : 320, t);
      o.frequency.exponentialRampToValueAtTime(isUp ? 95 : 180, t + 0.06);
      g.gain.setValueAtTime(0.11, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.065);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.07);
    }

    function playImpact(strength) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      // Sub-bass barrier thud
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(115, t);
      o.frequency.exponentialRampToValueAtTime(28, t + 0.18);
      g.gain.setValueAtTime(Math.min(0.45, strength * 0.42), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.22);
      // Carbon-fiber crackle burst
      if (noiseBuf && strength > 0.28) {
        const src = ac.createBufferSource();
        src.buffer = noiseBuf;
        const flt = ac.createBiquadFilter();
        flt.type = "bandpass"; flt.frequency.value = 1850; flt.Q.value = 1.6;
        const ng = ac.createGain();
        ng.gain.setValueAtTime(Math.min(0.28, strength * 0.28), t);
        ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        src.connect(flt); flt.connect(ng); ng.connect(master);
        src.start(t, Math.random() * 1.2, 0.18);
      }
    }

    function playStartBeep(isGo) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(isGo ? 880 : 440, t);
      g.gain.setValueAtTime(0.16, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (isGo ? 0.35 : 0.14));
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + (isGo ? 0.36 : 0.16));
    }

    function setMuted(val) {
      muted = Boolean(val);
      if (master && ac) master.gain.setTargetAtTime(muted ? 0.0001 : 0.42, ac.currentTime, 0.05);
    }

    function dispose() {
      try { if (ac) ac.close(); } catch (_) {}
      ac = null;
      started = false;
    }

    return { init, update, playStartBeep, setMuted, isMuted: () => muted, dispose };
  }

  global.F1DriveAudio = { createDriveAudio };
})(window);
