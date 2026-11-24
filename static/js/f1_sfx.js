/**
 * Local F1 Broadcast Audio Studio & Peaceful Motorsport Soundtrack (/sim, /career, /play & Site-Wide).
 *
 * Zero-dependency WebAudio engine with:
 *   - 3 Calm, Peaceful, Theme-Fitting Generative Music Moods (default OFF until user toggles on):
 *       1. "paddock" : Paddock Horizon (warm Rhodes electric piano + soft analog pads + stereo hall reverb)
 *       2. "monaco"  : Monaco Dusk (felt-piano lo-fi chill arpeggios + warm vinyl air + soft pulse)
 *       3. "zen"     : Telemetry Zen (ultra-calm meditative harmonic drones + glass marimba chimes)
 *   - Broadcast Auto-Ducking (-4.5 dB smooth duck during radio, safety car, lights out & chequered flag)
 *   - Layered Spatial Trackside Audio (soft era-matched engine bed w/ TV Doppler + rain + stadium crowd)
 *   - Refined Broadcast SFX (pneumatic wheel-guns, F1 TV bandpass radio squelch, warm harmonic cues)
 *   - Floating Audio Studio Mixer Popover persisted in localStorage ("traf1_audio_studio_v2")
 *
 * Backwards-compatible API: exposed as both window.F1Sfx and window.F1_SFX.
 */
(function (global) {
  "use strict";

  const STORAGE_KEY = "traf1_sfx";
  const PREFS_KEY = "traf1_audio_studio_v2";

  const DEFAULT_PREFS = {
    sfxEnabled: true,
    musicEnabled: false,   // Default OFF until explicitly toggled on by user
    ambienceEnabled: true,
    mood: "paddock",       // paddock | monaco | zen
    voiceEngine: "auto",   // auto | gemini | edge | browser
    masterVol: 0.78,
    musicVol: 0.42,
    ambienceVol: 0.34,
    sfxVol: 0.68,
    voiceVol: 0.92,
  };

  function loadPrefs() {
    const out = Object.assign({}, DEFAULT_PREFS);
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        Object.keys(DEFAULT_PREFS).forEach((k) => {
          if (parsed[k] !== undefined) out[k] = parsed[k];
        });
      } else {
        const legacy = localStorage.getItem(STORAGE_KEY);
        if (legacy === "off" || legacy === "0") out.sfxEnabled = false;
      }
    } catch (_) {}
    return out;
  }

  const prefs = loadPrefs();

  function persistPrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      localStorage.setItem(STORAGE_KEY, prefs.sfxEnabled ? "on" : "off");
      localStorage.setItem("traf1_pit_sfx", prefs.sfxEnabled ? "1" : "0");
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // WebAudio Graph (Master -> Compressor -> Destination + Shared Stereo Reverb)
  // ---------------------------------------------------------------------------
  let ctx = null;
  let masterGain = null;
  let musicBus = null;
  let musicDuckGain = null;
  let ambienceBus = null;
  let sfxBus = null;
  let voiceStudioBus = null;
  let voiceRadioBus = null;
  let reverbSend = null;
  let noiseBuffer = null;

  // Neural Voice Engine runtime state (Gemini TTS -> Edge-TTS -> Browser fallback)
  const voiceBufCache = new Map();
  let activeVoiceSrc = null;
  let activeVoiceNoise = null;
  let activeVoiceAbort = null;
  let voiceBusy = false;
  let voiceStatusCache = null;

  function makeRadioDriveCurve(amount) {
    const k = amount || 18;
    const n = 256;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // Live continuous trackside nodes
  let engineOsc1 = null;
  let engineOsc2 = null;
  let engineFilter = null;
  let engineGain = null;
  let crowdNode = null;
  let crowdFilter = null;
  let crowdGain = null;
  let rainNode = null;
  let rainFilter = null;
  let rainGain = null;

  // Generative music scheduler
  let musicTimer = null;
  let musicStep = 0;

  function makeNoiseBuffer(ac, seconds) {
    const len = Math.floor(ac.sampleRate * (seconds || 3));
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      // Pink-ish warm filtered noise (Paul Kellet approximation)
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.06;
        b6 = w * 0.115926;
      }
    }
    return buf;
  }

  function makeWarmReverbIR(ac, durationS, decay) {
    const len = Math.floor(ac.sampleRate * durationS);
    const ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = Math.pow(1 - t, decay);
        const raw = (Math.random() * 2 - 1) * env;
        // Soft lowpass inside the tail for warm hall acoustics
        lp = lp * 0.72 + raw * 0.28;
        data[i] = lp * 0.55;
      }
    }
    return ir;
  }

  function ensureGraph(forceCreate) {
    if (!forceCreate && !prefs.sfxEnabled && !prefs.musicEnabled && !prefs.ambienceEnabled) return null;
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.knee.value = 18;
        comp.ratio.value = 3.5;
        comp.attack.value = 0.012;
        comp.release.value = 0.22;

        masterGain = ctx.createGain();
        musicBus = ctx.createGain();
        musicDuckGain = ctx.createGain();
        musicDuckGain.gain.value = 1.0;
        ambienceBus = ctx.createGain();
        sfxBus = ctx.createGain();

        // Studio Broadcast Voice Chain (warmth + clarity EQ -> master)
        voiceStudioBus = ctx.createGain();
        const vLow = ctx.createBiquadFilter();
        vLow.type = "lowshelf"; vLow.frequency.value = 170; vLow.gain.value = 2.4;
        const vPres = ctx.createBiquadFilter();
        vPres.type = "highshelf"; vPres.frequency.value = 3100; vPres.gain.value = 2.2;
        voiceStudioBus.connect(vLow);
        vLow.connect(vPres);
        vPres.connect(masterGain);

        // Authentic F1 Cockpit Team Radio Chain (380Hz-2950Hz Bandpass + RF Soft-Clip Drive!)
        voiceRadioBus = ctx.createGain();
        const rHp = ctx.createBiquadFilter();
        rHp.type = "highpass"; rHp.frequency.value = 380; rHp.Q.value = 0.85;
        const rLp = ctx.createBiquadFilter();
        rLp.type = "lowpass"; rLp.frequency.value = 2950; rLp.Q.value = 0.9;
        const rMid = ctx.createBiquadFilter();
        rMid.type = "peaking"; rMid.frequency.value = 1450; rMid.Q.value = 1.2; rMid.gain.value = 3.5;
        const rDrive = ctx.createWaveShaper();
        rDrive.curve = makeRadioDriveCurve(14);
        rDrive.oversample = "2x";
        voiceRadioBus.connect(rHp);
        rHp.connect(rLp);
        rLp.connect(rMid);
        rMid.connect(rDrive);
        rDrive.connect(masterGain);

        const conv = ctx.createConvolver();
        conv.buffer = makeWarmReverbIR(ctx, 2.6, 2.8);
        reverbSend = ctx.createGain();
        reverbSend.gain.value = 0.38;

        musicBus.connect(musicDuckGain);
        musicDuckGain.connect(masterGain);
        musicDuckGain.connect(reverbSend);
        reverbSend.connect(conv);
        conv.connect(masterGain);

        ambienceBus.connect(masterGain);
        sfxBus.connect(masterGain);
        sfxBus.connect(reverbSend);

        masterGain.connect(comp);
        comp.connect(ctx.destination);

        noiseBuffer = makeNoiseBuffer(ctx, 4);
        syncGains();
      } catch (_) {
        ctx = null;
        return null;
      }
    }
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function syncGains() {
    if (!ctx || !masterGain) return;
    const now = ctx.currentTime;
    masterGain.gain.setTargetAtTime(prefs.masterVol, now, 0.04);
    musicBus.gain.setTargetAtTime(prefs.musicEnabled ? prefs.musicVol : 0.0001, now, 0.18);
    ambienceBus.gain.setTargetAtTime((prefs.sfxEnabled && prefs.ambienceEnabled) ? prefs.ambienceVol : 0.0001, now, 0.12);
    sfxBus.gain.setTargetAtTime(prefs.sfxEnabled ? prefs.sfxVol : 0.0001, now, 0.03);
    if (voiceStudioBus) voiceStudioBus.gain.setTargetAtTime(prefs.voiceVol ?? 0.92, now, 0.04);
    if (voiceRadioBus) voiceRadioBus.gain.setTargetAtTime((prefs.voiceVol ?? 0.92) * 1.08, now, 0.04);
  }

  function stopVoice() {
    if (activeVoiceAbort) {
      try { activeVoiceAbort.abort(); } catch (_) {}
      activeVoiceAbort = null;
    }
    if (activeVoiceSrc) {
      try { activeVoiceSrc.stop(); } catch (_) {}
      activeVoiceSrc = null;
    }
    if (activeVoiceNoise) {
      try { activeVoiceNoise.stop(); } catch (_) {}
      activeVoiceNoise = null;
    }
    voiceBusy = false;
    try { if (global.speechSynthesis) global.speechSynthesis.cancel(); } catch (_) {}
  }

  function speakBrowserFallback(text, role) {
    if (!global.speechSynthesis || global.speechSynthesis.speaking) return;
    try {
      const clean = String(text || "").replace(/[^\w\s.,!?'’:+%-]/g, " ").replace(/\s+/g, " ").trim();
      if (!clean) return;
      const u = new SpeechSynthesisUtterance(clean.slice(0, 170));
      u.rate = role === "crofty" ? 1.12 : (role === "driver" ? 1.10 : 1.04);
      u.pitch = role === "brundle" ? 0.92 : 1.02;
      global.speechSynthesis.speak(u);
    } catch (_) {}
  }

  async function speak(opts) {
    const o = typeof opts === "string" ? { text: opts } : (opts || {});
    const rawText = String(o.text || "").trim();
    if (!rawText) return false;
    const role = o.role || "crofty";
    const channel = o.channel || (role === "driver" || role === "engineer" ? "radio" : "commentary");
    const engineMode = o.engine || prefs.voiceEngine || "auto";

    if (engineMode === "browser") {
      if (o.priority === "high" && global.speechSynthesis) global.speechSynthesis.cancel();
      speakBrowserFallback(rawText, role);
      return true;
    }

    // Never pile up stale commentary; high-priority radio/test can interrupt normal commentary
    if (voiceBusy) {
      if (o.priority === "high" || o.force) stopVoice();
      else return false;
    }

    const ac = ensureGraph(true);
    if (!ac) {
      speakBrowserFallback(rawText, role);
      return false;
    }
    if (ac.state === "suspended") {
      try { await ac.resume(); } catch (_) {}
    }

    const cacheKey = `${engineMode}|${role}|${o.archetype || ""}|${o.driverName || ""}|${o.engineerName || ""}|${o.nationality || ""}|${o.tone || ""}|${rawText.slice(0, 180)}`;
    voiceBusy = true;

    try {
      let decoded = voiceBufCache.get(cacheKey);
      if (!decoded) {
        const ab = new AbortController();
        activeVoiceAbort = ab;
        const resp = await fetch("/api/tts/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ab.signal,
          body: JSON.stringify({
            text: rawText.slice(0, 230),
            role,
            archetype: o.archetype || "",
            driver_name: o.driverName || "",
            engineer_name: o.engineerName || "",
            nationality: o.nationality || "",
            tone: o.tone || "",
            engine: engineMode,
            reply_text: o.replyText || "",
          }),
        });
        activeVoiceAbort = null;
        if (!resp.ok) throw new Error(`TTS HTTP ${resp.status}`);
        const arrBuf = await resp.arrayBuffer();
        decoded = await ac.decodeAudioData(arrBuf.slice(0));
        if (voiceBufCache.size >= 36) {
          const oldest = voiceBufCache.keys().next().value;
          voiceBufCache.delete(oldest);
        }
        voiceBufCache.set(cacheKey, decoded);
      }

      if (!voiceBusy) return false; // Cancelled while loading

      const src = ac.createBufferSource();
      src.buffer = decoded;
      const targetBus = (channel === "radio" && voiceRadioBus) ? voiceRadioBus : (voiceStudioBus || masterGain);
      src.connect(targetBus);

      // Duck music & engine ambience smoothly during speech!
      const dur = Math.max(0.8, decoded.duration || 2.5);
      duckMusic(dur + 0.5);
      if (ambienceBus && prefs.ambienceEnabled) {
        const now = ac.currentTime;
        ambienceBus.gain.cancelScheduledValues(now);
        ambienceBus.gain.setTargetAtTime(prefs.ambienceVol * 0.42, now, 0.08);
        ambienceBus.gain.setTargetAtTime(prefs.ambienceVol, now + dur + 0.25, 0.35);
      }

      // Add subtle authentic F1 RF static noise floor while cockpit radio is transmitting!
      let radioNoise = null;
      if (channel === "radio" && noiseBuffer && voiceRadioBus) {
        radioNoise = ac.createBufferSource();
        radioNoise.buffer = noiseBuffer;
        radioNoise.loop = true;
        const nG = ac.createGain();
        nG.gain.value = 0.055;
        radioNoise.connect(nG);
        nG.connect(voiceRadioBus);
        radioNoise.start();
        activeVoiceNoise = radioNoise;
      }

      activeVoiceSrc = src;
      src.onended = () => {
        if (activeVoiceSrc === src) activeVoiceSrc = null;
        if (radioNoise) {
          try { radioNoise.stop(); } catch (_) {}
          if (activeVoiceNoise === radioNoise) activeVoiceNoise = null;
          // Crisp F1 radio release click!
          noiseBurst(0.032, 0.0, 2400, 2.5, 0.032);
        }
        voiceBusy = false;
      };
      src.start();
      return true;
    } catch (err) {
      voiceBusy = false;
      activeVoiceAbort = null;
      if (err && err.name === "AbortError") return false;
      speakBrowserFallback(rawText, role);
      return false;
    }
  }

  function duckMusic(holdSec) {
    if (!ctx || !musicDuckGain || !prefs.musicEnabled) return;
    const now = ctx.currentTime;
    musicDuckGain.gain.cancelScheduledValues(now);
    musicDuckGain.gain.setTargetAtTime(0.48, now, 0.08);
    musicDuckGain.gain.setTargetAtTime(1.0, now + (holdSec || 1.2), 0.55);
  }

  // ---------------------------------------------------------------------------
  // Peaceful Generative Motorsport Soundtrack (3 Calm Moods)
  // ---------------------------------------------------------------------------
  const MOOD_DATA = {
    paddock: {
      name: "Paddock Horizon",
      desc: "Warm Rhodes chords & airy sunset pads",
      stepMs: 3600,
      chords: [
        [261.63, 329.63, 392.00, 493.88, 587.33], // Cmaj9
        [220.00, 261.63, 329.63, 392.00, 493.88], // Am9
        [174.61, 220.00, 261.63, 329.63, 392.00], // Fmaj9
        [196.00, 246.94, 293.66, 329.63, 440.00], // G6add9
        [164.81, 196.00, 246.94, 293.66, 369.99], // Em9
        [146.83, 220.00, 261.63, 329.63, 440.00], // Dm9
        [174.61, 220.00, 293.66, 329.63, 392.00], // F6/9
        [196.00, 261.63, 293.66, 392.00, 493.88], // G11sus
      ],
      arp: true,
      padCutoff: 1350,
      softPulse: false,
    },
    monaco: {
      name: "Monaco Dusk",
      desc: "Gentle lo-fi felt piano & twilight pulse",
      stepMs: 3150,
      chords: [
        [293.66, 369.99, 440.00, 554.37, 659.25], // Dmaj9
        [246.94, 293.66, 369.99, 440.00, 554.37], // Bm9
        [196.00, 246.94, 293.66, 369.99, 440.00], // Gmaj9
        [220.00, 277.18, 329.63, 369.99, 493.88], // A6add9
        [246.94, 329.63, 369.99, 493.88, 554.37], // Bm11
        [196.00, 246.94, 329.63, 369.99, 440.00], // Gmaj13
      ],
      arp: true,
      padCutoff: 1100,
      softPulse: true,
    },
    zen: {
      name: "Telemetry Zen",
      desc: "Ultra-calm ambient pads & harmonic bells",
      stepMs: 4800,
      chords: [
        [196.00, 293.66, 392.00, 493.88],         // Gmaj7 open
        [164.81, 246.94, 329.63, 440.00],         // Em11 open
        [130.81, 196.00, 293.66, 392.00],         // Cadd9 open
        [146.83, 220.00, 329.63, 440.00],         // Dsus2 open
      ],
      arp: false,
      padCutoff: 950,
      softPulse: false,
    },
  };

  function playRhodesNote(ac, freq, startT, dur, vol) {
    // Warm electric piano voice: fundamental sine + soft 2nd harmonic tine, lowpass smoothed
    const osc1 = ac.createOscillator();
    const osc2 = ac.createOscillator();
    const flt = ac.createBiquadFilter();
    const g = ac.createGain();
    osc1.type = "sine";
    osc2.type = "triangle";
    osc1.frequency.setValueAtTime(freq, startT);
    osc2.frequency.setValueAtTime(freq * 2.002, startT);
    flt.type = "lowpass";
    flt.frequency.setValueAtTime(1900, startT);
    flt.frequency.exponentialRampToValueAtTime(680, startT + dur);

    const g2 = ac.createGain();
    g2.gain.setValueAtTime(0.14, startT);
    g2.gain.exponentialRampToValueAtTime(0.01, startT + Math.min(0.6, dur * 0.4));

    g.gain.setValueAtTime(0.0001, startT);
    g.gain.linearRampToValueAtTime(vol, startT + 0.035);
    g.gain.exponentialRampToValueAtTime(vol * 0.42, startT + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, startT + dur);

    osc1.connect(flt);
    osc2.connect(g2);
    g2.connect(flt);
    flt.connect(g);
    g.connect(musicBus);

    osc1.start(startT);
    osc2.start(startT);
    osc1.stop(startT + dur + 0.08);
    osc2.stop(startT + dur + 0.08);
  }

  function playWarmPad(ac, freqs, startT, dur, cutoff) {
    const flt = ac.createBiquadFilter();
    flt.type = "lowpass";
    flt.frequency.setValueAtTime(cutoff * 0.65, startT);
    flt.frequency.linearRampToValueAtTime(cutoff, startT + dur * 0.45);
    flt.frequency.linearRampToValueAtTime(cutoff * 0.55, startT + dur);
    flt.Q.value = 0.7;

    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, startT);
    g.gain.linearRampToValueAtTime(0.055, startT + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, startT + dur + 0.35);

    flt.connect(g);
    g.connect(musicBus);

    freqs.slice(0, 3).forEach((f, idx) => {
      const o = ac.createOscillator();
      o.type = idx === 0 ? "sine" : "triangle";
      o.frequency.setValueAtTime(f * (idx === 0 ? 0.5 : 1.0), startT);
      o.detune.setValueAtTime((idx - 1) * 5.5, startT);
      o.connect(flt);
      o.start(startT);
      o.stop(startT + dur + 0.45);
    });
  }

  function playSoftBrush(ac, startT, accent) {
    if (!noiseBuffer) return;
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer;
    const flt = ac.createBiquadFilter();
    flt.type = "bandpass";
    flt.frequency.value = accent ? 2400 : 1600;
    flt.Q.value = 1.4;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, startT);
    g.gain.linearRampToValueAtTime(accent ? 0.022 : 0.012, startT + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, startT + 0.11);
    src.connect(flt);
    flt.connect(g);
    g.connect(musicBus);
    src.start(startT, Math.random() * 2.0, 0.15);
  }

  function scheduleMusicBar() {
    if (!prefs.musicEnabled) return;
    const ac = ensureGraph(true);
    if (!ac) return;
    const mood = MOOD_DATA[prefs.mood] || MOOD_DATA.paddock;
    const chord = mood.chords[musicStep % mood.chords.length];
    const now = ac.currentTime + 0.05;
    const barS = mood.stepMs / 1000;

    // 1. Lush warm pad bed
    playWarmPad(ac, chord, now, barS * 1.08, mood.padCutoff);

    // 2. Soft sub-bass root breath
    playRhodesNote(ac, chord[0] * 0.5, now, barS * 0.92, 0.085);

    // 3. Gentle rolled Rhodes / felt-piano chord voicing
    chord.forEach((f, idx) => {
      const roll = idx * 0.055 + (Math.random() * 0.015);
      playRhodesNote(ac, f, now + roll, barS * 0.86, 0.044);
    });

    // 4. Sparse peaceful melodic shimmer notes
    if (mood.arp) {
      const n1 = chord[(musicStep * 2 + 2) % chord.length];
      const n2 = chord[(musicStep * 3 + 4) % chord.length];
      playRhodesNote(ac, n1 * 2, now + barS * 0.42, barS * 0.48, 0.024);
      if (musicStep % 2 === 0) {
        playRhodesNote(ac, n2 * 2, now + barS * 0.72, barS * 0.42, 0.019);
      }
    } else if (musicStep % 2 === 1) {
      // Zen glass chime overtone
      playRhodesNote(ac, chord[chord.length - 1] * 2, now + barS * 0.35, barS * 0.65, 0.018);
    }

    // 5. Optional ultra-soft lo-fi brushed rhythm (Monaco Dusk only)
    if (mood.softPulse) {
      const beat = barS / 4;
      for (let b = 0; b < 4; b++) {
        playSoftBrush(ac, now + b * beat, b === 1 || b === 3);
      }
    }

    musicStep += 1;
  }

  function startMusicLoop() {
    stopMusicLoop();
    if (!prefs.musicEnabled) return;
    const mood = MOOD_DATA[prefs.mood] || MOOD_DATA.paddock;
    scheduleMusicBar();
    musicTimer = setInterval(scheduleMusicBar, mood.stepMs);
  }

  function stopMusicLoop() {
    if (musicTimer) {
      clearInterval(musicTimer);
      musicTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Continuous Trackside Engine, Crowd & Rain Telemetry Bed
  // ---------------------------------------------------------------------------
  function ensureAmbienceNodes(ac) {
    if (engineOsc1) return;
    // Era-tunable warm dual-oscillator formant engine bed
    engineOsc1 = ac.createOscillator();
    engineOsc2 = ac.createOscillator();
    engineOsc1.type = "sawtooth";
    engineOsc2.type = "triangle";
    engineFilter = ac.createBiquadFilter();
    engineFilter.type = "bandpass";
    engineFilter.frequency.value = 340;
    engineFilter.Q.value = 2.6;
    engineGain = ac.createGain();
    engineGain.gain.value = 0.0001;

    engineOsc1.connect(engineFilter);
    engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(ambienceBus);
    engineOsc1.start();
    engineOsc2.start();

    // Crowd stadium atmosphere bed
    crowdNode = ac.createBufferSource();
    crowdNode.buffer = noiseBuffer;
    crowdNode.loop = true;
    crowdFilter = ac.createBiquadFilter();
    crowdFilter.type = "bandpass";
    crowdFilter.frequency.value = 620;
    crowdFilter.Q.value = 0.85;
    crowdGain = ac.createGain();
    crowdGain.gain.value = 0.0001;
    crowdNode.connect(crowdFilter);
    crowdFilter.connect(crowdGain);
    crowdGain.connect(ambienceBus);
    crowdNode.start();

    // Rain / wet track hiss bed
    rainNode = ac.createBufferSource();
    rainNode.buffer = noiseBuffer;
    rainNode.loop = true;
    rainFilter = ac.createBiquadFilter();
    rainFilter.type = "highpass";
    rainFilter.frequency.value = 1800;
    rainGain = ac.createGain();
    rainGain.gain.value = 0.0001;
    rainNode.connect(rainFilter);
    rainFilter.connect(rainGain);
    rainGain.connect(ambienceBus);
    rainNode.start();
  }

  function updateTelemetry(opts) {
    if (!ctx || !prefs.sfxEnabled || !prefs.ambienceEnabled) {
      if (engineGain && ctx) {
        const now = ctx.currentTime;
        engineGain.gain.setTargetAtTime(0.0001, now, 0.08);
        if (crowdGain) crowdGain.gain.setTargetAtTime(0.0001, now, 0.12);
        if (rainGain) rainGain.gain.setTargetAtTime(0.0001, now, 0.12);
      }
      return;
    }
    ensureAmbienceNodes(ctx);
    const now = ctx.currentTime;
    const active = Boolean(opts && opts.active && !opts.paused && (opts.speedMult || 1) < 8);
    if (!active) {
      engineGain.gain.setTargetAtTime(0.0001, now, 0.1);
      crowdGain.gain.setTargetAtTime(0.0001, now, 0.18);
      rainGain.gain.setTargetAtTime(0.0001, now, 0.18);
      return;
    }

    const kph = Math.max(40, Math.min(360, Number(opts.speedKph || 210)));
    const era = String(opts.eraKey || "2026");
    const eraPitch = (era.includes("1990") || era.includes("2000")) ? 1.48 : (era.includes("1980") ? 1.15 : 1.0);
    const camMode = String(opts.camMode || "2d");
    const doppler = camMode === "tv" ? (0.94 + Math.sin(now * 2.1) * 0.07) : 1.0;

    const baseHz = (68 + (kph / 350) * 165) * eraPitch * doppler;
    engineOsc1.frequency.setTargetAtTime(baseHz, now, 0.06);
    engineOsc2.frequency.setTargetAtTime(baseHz * 1.995, now, 0.06);
    engineFilter.frequency.setTargetAtTime(220 + (kph / 350) * 620, now, 0.08);

    const engVol = (camMode === "pov" ? 0.055 : (camMode === "chase" ? 0.044 : (camMode === "tv" ? 0.036 : 0.020))) * (opts.inPit ? 0.35 : 1.0);
    engineGain.gain.setTargetAtTime(engVol, now, 0.1);

    const crowdTarget = opts.chequered ? 0.16 : (opts.battleClose ? 0.075 : 0.035);
    crowdGain.gain.setTargetAtTime(crowdTarget, now, 0.25);

    const wet = Math.max(0, Math.min(100, Number(opts.wetness || 0)));
    rainGain.gain.setTargetAtTime(wet > 15 ? (wet / 100) * 0.075 : 0.0001, now, 0.25);
  }

  // ---------------------------------------------------------------------------
  // Refined Broadcast SFX (Warm, Filtered, Non-Harsh)
  // ---------------------------------------------------------------------------
  function softTone(freq, dur, type, vol, delaySec, cutoffHz) {
    const ac = ensureGraph(false);
    if (!ac || !prefs.sfxEnabled) return;
    const t0 = ac.currentTime + (delaySec || 0);
    const osc = ac.createOscillator();
    const flt = ac.createBiquadFilter();
    const g = ac.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    flt.type = "lowpass";
    flt.frequency.setValueAtTime(cutoffHz || 2400, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol || 0.06, t0 + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(flt);
    flt.connect(g);
    g.connect(sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.04);
  }

  function noiseBurst(dur, delaySec, bandHz, q, vol) {
    const ac = ensureGraph(false);
    if (!ac || !prefs.sfxEnabled || !noiseBuffer) return;
    const t0 = ac.currentTime + (delaySec || 0);
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer;
    const flt = ac.createBiquadFilter();
    flt.type = "bandpass";
    flt.frequency.setValueAtTime(bandHz || 1400, t0);
    flt.Q.value = q || 1.2;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol || 0.08, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt);
    flt.connect(g);
    g.connect(sfxBus);
    src.start(t0, Math.random() * 1.5, dur + 0.04);
  }

  const F1Sfx = {
    get enabled() { return prefs.sfxEnabled; },
    set enabled(val) { prefs.sfxEnabled = !!val; persistPrefs(); syncGains(); syncAllUi(); },
    get musicEnabled() { return prefs.musicEnabled; },
    get prefs() { return Object.assign({}, prefs); },
    isEnabled: () => prefs.sfxEnabled,
    isMusicEnabled: () => prefs.musicEnabled,

    toggle() {
      prefs.sfxEnabled = !prefs.sfxEnabled;
      persistPrefs();
      syncGains();
      syncAllUi();
      if (prefs.sfxEnabled) F1Sfx.click();
      return prefs.sfxEnabled;
    },

    setMusicEnabled(val) {
      prefs.musicEnabled = !!val;
      persistPrefs();
      if (prefs.musicEnabled) {
        ensureGraph(true);
        syncGains();
        startMusicLoop();
      } else {
        stopMusicLoop();
        syncGains();
      }
      syncAllUi();
      return prefs.musicEnabled;
    },

    toggleMusic() {
      return F1Sfx.setMusicEnabled(!prefs.musicEnabled);
    },

    setMood(moodKey) {
      if (!MOOD_DATA[moodKey]) return;
      prefs.mood = moodKey;
      persistPrefs();
      if (prefs.musicEnabled) startMusicLoop();
      syncAllUi();
    },

    setVolume(bus, val) {
      const v = Math.max(0, Math.min(1, Number(val)));
      if (bus === "master") prefs.masterVol = v;
      else if (bus === "music") prefs.musicVol = v;
      else if (bus === "ambience") prefs.ambienceVol = v;
      else if (bus === "sfx") prefs.sfxVol = v;
      else if (bus === "voice") prefs.voiceVol = v;
      persistPrefs();
      syncGains();
    },

    setVoiceEngine(mode) {
      if (!["auto", "gemini", "edge", "browser"].includes(mode)) return;
      prefs.voiceEngine = mode;
      persistPrefs();
      syncAllUi();
    },

    getVoiceEngine() {
      return prefs.voiceEngine || "auto";
    },

    speak,
    stopVoice,

    setAmbienceEnabled(val) {
      prefs.ambienceEnabled = !!val;
      persistPrefs();
      syncGains();
      syncAllUi();
    },

    updateTelemetry,

    beep(freq, dur, vol, type, delay) {
      softTone(freq || 660, dur || 0.08, type || "sine", vol || 0.05, delay || 0, 2200);
    },
    click() {
      softTone(587.33, 0.045, "sine", 0.032, 0, 1800);
    },
    startLight(n) {
      duckMusic(1.1);
      // Authentic FIA gantry tone for lights 1..5
      const f = n >= 5 ? 440.0 : 392.0;
      softTone(f, 0.14, "triangle", 0.062, 0, 1500);
    },
    lightsOut() {
      duckMusic(1.6);
      // Green release harmonic chord + grid launch roar
      softTone(523.25, 0.32, "triangle", 0.068, 0.0, 2200);
      softTone(659.25, 0.34, "sine", 0.058, 0.02, 2200);
      softTone(783.99, 0.40, "sine", 0.052, 0.04, 2200);
      F1Sfx.engineSurge();
    },
    ersArm() {
      softTone(440, 0.09, "triangle", 0.045, 0, 1800);
      softTone(659.25, 0.16, "sine", 0.055, 0.07, 2400);
    },
    engineSurge() {
      const ac = ensureGraph(false);
      if (!ac || !prefs.sfxEnabled) return;
      const t0 = ac.currentTime + 1.15;
      const osc = ac.createOscillator();
      const flt = ac.createBiquadFilter();
      const g = ac.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(110, t0);
      osc.frequency.exponentialRampToValueAtTime(320, t0 + 0.85);
      osc.frequency.exponentialRampToValueAtTime(420, t0 + 1.3);
      flt.type = "bandpass";
      flt.frequency.setValueAtTime(420, t0);
      flt.frequency.exponentialRampToValueAtTime(1100, t0 + 1.2);
      flt.Q.value = 1.8;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.042, t0 + 0.14);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
      osc.connect(flt);
      flt.connect(g);
      g.connect(sfxBus);
      osc.start(t0);
      osc.stop(t0 + 1.45);
    },
    crowdCheer() {
      noiseBurst(1.6, 0, 780, 0.65, 0.14);
      noiseBurst(1.4, 0.18, 1250, 0.9, 0.09);
    },
    winLap() {
      duckMusic(1.5);
      softTone(523.25, 0.18, "triangle", 0.06, 0, 2200);
      softTone(659.25, 0.18, "triangle", 0.06, 0.11, 2200);
      softTone(783.99, 0.34, "sine", 0.07, 0.22, 2400);
      F1Sfx.crowdCheer();
    },
    loseLap() {
      softTone(293.66, 0.16, "triangle", 0.05, 0, 1200);
      softTone(220.00, 0.24, "triangle", 0.05, 0.13, 1000);
    },
    radioBeep() {
      duckMusic(1.8);
      // Authentic F1 TV dual-tone squelch + soft bandpass radio static click
      noiseBurst(0.055, 0.0, 2100, 2.2, 0.045);
      softTone(1174.66, 0.065, "sine", 0.048, 0.015, 2200);
      softTone(880.00, 0.085, "sine", 0.046, 0.085, 2000);
    },
    radioAlert() {
      duckMusic(1.5);
      noiseBurst(0.045, 0.0, 1900, 2.0, 0.04);
      softTone(880, 0.06, "sine", 0.045, 0.01, 2000);
      softTone(1046.5, 0.08, "sine", 0.05, 0.08, 2200);
    },
    alert() {
      duckMusic(1.5);
      softTone(659.25, 0.12, "triangle", 0.06, 0.00, 1600);
      softTone(523.25, 0.14, "triangle", 0.06, 0.14, 1600);
      softTone(659.25, 0.16, "triangle", 0.06, 0.28, 1600);
    },
    pitStop() {
      // Rhythmic pneumatic wheel-gun bursts + release jack
      noiseBurst(0.09, 0.00, 2600, 3.0, 0.09);
      softTone(310, 0.08, "sawtooth", 0.025, 0.00, 950);
      noiseBurst(0.09, 0.13, 2800, 3.2, 0.09);
      softTone(360, 0.08, "sawtooth", 0.025, 0.13, 1050);
      noiseBurst(0.11, 0.26, 2400, 2.6, 0.08);
      softTone(587.33, 0.14, "sine", 0.045, 0.36, 2000);
    },
    purpleSector() {
      softTone(880.00, 0.10, "sine", 0.045, 0.00, 2600);
      softTone(1318.51, 0.20, "sine", 0.048, 0.09, 2800);
    },
    checkered() {
      duckMusic(2.6);
      // Warm triumphant Cmaj9 broadcast swell + stadium crowd roar
      softTone(523.25, 0.22, "triangle", 0.06, 0.00, 2200);
      softTone(659.25, 0.24, "triangle", 0.06, 0.12, 2200);
      softTone(783.99, 0.26, "triangle", 0.065, 0.24, 2400);
      softTone(987.77, 0.48, "sine", 0.065, 0.36, 2400);
      softTone(1174.66, 0.56, "sine", 0.05, 0.40, 2400);
      F1Sfx.crowdCheer();
    },
    openMixer,
  };

  // ---------------------------------------------------------------------------
  // Global Floating Audio Studio Mixer Popover (Wired on every page!)
  // ---------------------------------------------------------------------------
  let popoverEl = null;

  function syncAllUi() {
    const siteBtn = document.getElementById("site-audio-btn");
    if (siteBtn) {
      siteBtn.classList.toggle("is-music-on", prefs.musicEnabled);
      siteBtn.innerHTML = prefs.musicEnabled
        ? `<i class="fas fa-music"></i><span>Audio</span>`
        : `<i class="fas fa-volume-${prefs.sfxEnabled ? "up" : "mute"}"></i><span>Audio</span>`;
    }
    const simBtn = document.getElementById("fsim-sfx-btn");
    if (simBtn) {
      simBtn.classList.toggle("is-on", prefs.sfxEnabled || prefs.musicEnabled);
      simBtn.innerHTML = `<i class="fas fa-volume-${(prefs.sfxEnabled || prefs.musicEnabled) ? "up" : "mute"}"></i>`;
    }
    if (!popoverEl) return;
    const mChk = popoverEl.querySelector("#aud-music-toggle");
    const sChk = popoverEl.querySelector("#aud-sfx-toggle");
    const aChk = popoverEl.querySelector("#aud-amb-toggle");
    if (mChk) mChk.checked = prefs.musicEnabled;
    if (sChk) sChk.checked = prefs.sfxEnabled;
    if (aChk) aChk.checked = prefs.ambienceEnabled;
    popoverEl.querySelectorAll("[data-aud-mood]").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-aud-mood") === prefs.mood);
    });
    const vSel = popoverEl.querySelector("#aud-voice-engine");
    if (vSel) vSel.value = prefs.voiceEngine || "auto";
    const vStat = popoverEl.querySelector("#aud-voice-status");
    if (vStat && voiceStatusCache) {
      const gOk = voiceStatusCache.gemini_available;
      const eOk = voiceStatusCache.edge_available;
      if (prefs.voiceEngine === "browser") {
        vStat.textContent = "Browser Fallback";
        vStat.className = "f1-aud-vbadge";
      } else if (gOk && (prefs.voiceEngine === "auto" || prefs.voiceEngine === "gemini")) {
        vStat.textContent = `Gemini TTS (${voiceStatusCache.gemini_model})`;
        vStat.className = "f1-aud-vbadge is-gem";
      } else if (eOk) {
        vStat.textContent = gOk ? "Neural Edge-TTS" : "Neural Edge-TTS (add GEMINI_API_KEY for Gemini)";
        vStat.className = "f1-aud-vbadge is-edge";
      } else {
        vStat.textContent = "Browser Fallback";
        vStat.className = "f1-aud-vbadge";
      }
    }
  }

  function refreshVoiceStatus() {
    fetch("/api/tts/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.ok) {
          voiceStatusCache = data;
          syncAllUi();
        }
      })
      .catch(() => {});
  }

  function ensurePopover() {
    if (popoverEl) return popoverEl;
    const div = document.createElement("div");
    div.id = "f1-audio-popover";
    div.className = "f1-audio-popover hidden";
    div.innerHTML = `
      <div class="f1-aud-head">
        <strong><i class="fas fa-headphones"></i> Broadcast Audio Studio</strong>
        <button type="button" class="f1-aud-close" aria-label="Close audio mixer">&times;</button>
      </div>
      <div class="f1-aud-row">
        <label class="f1-aud-switch">
          <input type="checkbox" id="aud-music-toggle" ${prefs.musicEnabled ? "checked" : ""}>
          <span>Peaceful Music</span>
        </label>
        <input type="range" id="aud-music-vol" min="0" max="1" step="0.02" value="${prefs.musicVol}" aria-label="Music volume">
      </div>
      <div class="f1-aud-moods">
        ${Object.keys(MOOD_DATA).map((k) => `<button type="button" class="f1-aud-mood${prefs.mood === k ? " active" : ""}" data-aud-mood="${k}" title="${MOOD_DATA[k].desc}">${MOOD_DATA[k].name}</button>`).join("")}
      </div>
      <div class="f1-aud-row">
        <label class="f1-aud-switch">
          <input type="checkbox" id="aud-amb-toggle" ${prefs.ambienceEnabled ? "checked" : ""}>
          <span>Track &amp; Crowd</span>
        </label>
        <input type="range" id="aud-amb-vol" min="0" max="1" step="0.02" value="${prefs.ambienceVol}" aria-label="Track ambience volume">
      </div>
      <div class="f1-aud-row">
        <label class="f1-aud-switch">
          <input type="checkbox" id="aud-sfx-toggle" ${prefs.sfxEnabled ? "checked" : ""}>
          <span>Race SFX &amp; Radio</span>
        </label>
        <input type="range" id="aud-sfx-vol" min="0" max="1" step="0.02" value="${prefs.sfxVol}" aria-label="SFX volume">
      </div>
      <div class="f1-aud-voice-box">
        <div class="f1-aud-vhead">
          <span><i class="fas fa-microphone-alt"></i> Neural Voices</span>
          <select id="aud-voice-engine" aria-label="Voice synthesis engine">
            <option value="auto">Auto (Gemini → Edge)</option>
            <option value="gemini">Gemini TTS</option>
            <option value="edge">Neural Edge-TTS</option>
            <option value="browser">Browser</option>
          </select>
        </div>
        <div class="f1-aud-row" style="margin-bottom:6px;">
          <span style="color:#cbd5e1;font-size:.76rem;">Voice Level</span>
          <input type="range" id="aud-voice-vol" min="0" max="1" step="0.02" value="${prefs.voiceVol ?? 0.92}" aria-label="Voice volume">
        </div>
        <div class="f1-aud-vtests">
          <button type="button" id="aud-test-crofty" class="f1-aud-mood" title="Preview Studio Broadcast Commentary">🎙 Commentary</button>
          <button type="button" id="aud-test-radio" class="f1-aud-mood" title="Preview F1 Cockpit Bandpass Team Radio">📻 Team Radio</button>
        </div>
        <div id="aud-voice-status" class="f1-aud-vbadge">Checking voice engines…</div>
      </div>
      <div class="f1-aud-row f1-aud-master">
        <span>Master</span>
        <input type="range" id="aud-master-vol" min="0" max="1" step="0.02" value="${prefs.masterVol}" aria-label="Master volume">
      </div>
    `;
    document.body.appendChild(div);
    popoverEl = div;

    div.querySelector(".f1-aud-close").addEventListener("click", () => div.classList.add("hidden"));
    div.querySelector("#aud-music-toggle").addEventListener("change", (e) => F1Sfx.setMusicEnabled(e.target.checked));
    div.querySelector("#aud-amb-toggle").addEventListener("change", (e) => F1Sfx.setAmbienceEnabled(e.target.checked));
    div.querySelector("#aud-sfx-toggle").addEventListener("change", (e) => { F1Sfx.enabled = e.target.checked; });
    div.querySelector("#aud-music-vol").addEventListener("input", (e) => F1Sfx.setVolume("music", e.target.value));
    div.querySelector("#aud-amb-vol").addEventListener("input", (e) => F1Sfx.setVolume("ambience", e.target.value));
    div.querySelector("#aud-sfx-vol").addEventListener("input", (e) => F1Sfx.setVolume("sfx", e.target.value));
    div.querySelector("#aud-voice-vol").addEventListener("input", (e) => F1Sfx.setVolume("voice", e.target.value));
    div.querySelector("#aud-voice-engine").addEventListener("change", (e) => F1Sfx.setVoiceEngine(e.target.value));
    div.querySelector("#aud-test-crofty").addEventListener("click", () => {
      F1Sfx.speak({
        text: "Lights out and away we go at Albert Park! Late on the brakes into Turn 1, wheel to wheel for the lead!",
        role: "crofty",
        tone: "win",
        channel: "commentary",
        force: true,
      });
    });
    div.querySelector("#aud-test-radio").addEventListener("click", () => {
      F1Sfx.radioBeep();
      F1Sfx.speak({
        text: "Copy, box this lap — box opposite Hamilton. Diff entry plus two, brake balance one click forward.",
        role: "engineer",
        engineerName: "Peter Bonnington",
        tone: "warn",
        channel: "radio",
        force: true,
      });
    });
    div.querySelector("#aud-master-vol").addEventListener("input", (e) => F1Sfx.setVolume("master", e.target.value));
    refreshVoiceStatus();
    div.querySelectorAll("[data-aud-mood]").forEach((btn) => {
      btn.addEventListener("click", () => {
        F1Sfx.setMood(btn.getAttribute("data-aud-mood"));
        if (!prefs.musicEnabled) F1Sfx.setMusicEnabled(true);
      });
    });

    document.addEventListener("click", (e) => {
      if (!popoverEl || popoverEl.classList.contains("hidden")) return;
      if (popoverEl.contains(e.target)) return;
      if (e.target.closest("#site-audio-btn")) return;
      popoverEl.classList.add("hidden");
    });

    return div;
  }

  function openMixer(anchorEl) {
    const pop = ensurePopover();
    const willOpen = pop.classList.contains("hidden");
    if (!willOpen) {
      pop.classList.add("hidden");
      return;
    }
    pop.classList.remove("hidden");
    if (anchorEl && anchorEl.getBoundingClientRect) {
      const r = anchorEl.getBoundingClientRect();
      const top = Math.min(window.innerHeight - 250, r.bottom + 8);
      const right = Math.max(12, window.innerWidth - r.right);
      pop.style.top = `${Math.max(10, top)}px`;
      pop.style.right = `${right}px`;
    }
    syncAllUi();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const siteBtn = document.getElementById("site-audio-btn");
    if (siteBtn) {
      siteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openMixer(siteBtn);
      });
    }
    syncAllUi();
  });

  global.F1Sfx = F1Sfx;
  global.F1_SFX = F1Sfx;
})(window);
