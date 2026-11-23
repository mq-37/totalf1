/**
 * Unified Zero-Dependency WebAudio F1 Sound Effects Synthesizer (/play, /sim, /career).
 * Single source of truth exposed as both window.F1Sfx and window.F1_SFX with one
 * shared localStorage mute preference ("traf1_sfx").
 */
(function () {
  "use strict";

  const STORAGE_KEY = "traf1_sfx";
  let ctx = null;

  function _readInitialEnabled() {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "off" || v === "0") return false;
    if (v === "on" || v === "1") return true;
    // Migrate legacy key if present
    const legacy = localStorage.getItem("traf1_pit_sfx");
    if (legacy === "0") return false;
    return true;
  }

  let enabled = _readInitialEnabled();

  function _persist() {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
      localStorage.setItem("traf1_pit_sfx", enabled ? "1" : "0");
    } catch (_) {}
  }

  function ensureCtx() {
    if (!enabled) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (_) { return null; }
    }
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function tone(freq, dur, type, gainVal, delaySec) {
    const ac = ensureCtx();
    if (!ac) return;
    const now = ac.currentTime + (delaySec || 0);
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gainVal || 0.08, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  const F1Sfx = {
    get enabled() { return enabled; },
    set enabled(val) { enabled = !!val; _persist(); },
    isEnabled: () => enabled,
    toggle() {
      enabled = !enabled;
      _persist();
      if (enabled) F1Sfx.radioBeep();
      return enabled;
    },
    beep(freq, dur, vol, type, delay) {
      tone(freq, dur, type || "sine", vol || 0.08, delay || 0);
    },
    click() {
      tone(660, 0.04, "sine", 0.04, 0);
    },
    lightsOut() {
      tone(520, 0.11, "square", 0.055, 0.00);
      tone(520, 0.11, "square", 0.055, 0.18);
      tone(520, 0.11, "square", 0.055, 0.36);
      tone(980, 0.28, "sawtooth", 0.065, 0.56);
    },
    ersArm() {
      tone(420, 0.08, "sawtooth", 0.06, 0);
      tone(780, 0.16, "triangle", 0.07, 0.07);
    },
    engineSurge() {
      const ac = ensureCtx();
      if (!ac) return;
      const t0 = ac.currentTime + 0.55;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(115, t0);
      osc.frequency.exponentialRampToValueAtTime(340, t0 + 0.95);
      osc.frequency.exponentialRampToValueAtTime(460, t0 + 1.4);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.035, t0 + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + 1.55);
    },
    winLap() {
      tone(523.25, 0.11, "triangle", 0.07, 0);
      tone(659.25, 0.11, "triangle", 0.07, 0.09);
      tone(783.99, 0.24, "triangle", 0.08, 0.18);
    },
    loseLap() {
      tone(310, 0.14, "sawtooth", 0.06, 0);
      tone(210, 0.22, "sawtooth", 0.06, 0.12);
    },
    radioBeep() {
      tone(1320, 0.075, "sine", 0.06, 0.00);
      tone(880, 0.095, "sine", 0.06, 0.085);
    },
    radioAlert() {
      tone(880, 0.055, "sine", 0.045, 0);
      tone(1120, 0.075, "sine", 0.05, 0.07);
    },
    alert() {
      tone(740, 0.12, "triangle", 0.075, 0.00);
      tone(587, 0.14, "triangle", 0.075, 0.14);
      tone(740, 0.14, "triangle", 0.075, 0.28);
    },
    pitStop() {
      tone(340, 0.08, "sawtooth", 0.04, 0.00);
      tone(460, 0.09, "sawtooth", 0.04, 0.10);
      tone(660, 0.10, "sine", 0.05, 0.22);
    },
    purpleSector() {
      tone(1046, 0.08, "sine", 0.05, 0.00);
      tone(1568, 0.14, "sine", 0.05, 0.08);
    },
    checkered() {
      tone(523, 0.12, "triangle", 0.07, 0.00);
      tone(659, 0.12, "triangle", 0.07, 0.11);
      tone(784, 0.12, "triangle", 0.07, 0.22);
      tone(1046, 0.34, "triangle", 0.08, 0.33);
    },
  };

  window.F1Sfx = F1Sfx;
  window.F1_SFX = F1Sfx;
})();
