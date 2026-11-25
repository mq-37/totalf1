/**
 * APEX GRID — Unified Gamepad Customization, Button Remapping, Calibration & Dynamic Glyph Hints.
 * Shared across /drive (Apex POV Driver) and /sim (Full Broadcast Sim).
 * Persists custom profiles cleanly in localStorage under "apexgrid_controls_v1".
 */
(function (global) {
  "use strict";

  const STORAGE_KEY = "apexgrid_controls_v1";

  const DEFAULT_CALIBRATION = {
    steerDeadzone: 0.08,
    steerLinearity: 1.65,
    steerSensitivity: 1.0,
    triggerDeadzone: 0.03,
    rumbleStrength: 0.85,
    glyphOverride: "auto", // auto | xbox | playstation | keyboard
  };

  const DEFAULT_DRIVE_BINDS = {
    ers: { key: "Space", pad: 0, label: "ERS Overtake (Hold)" },
    drs: { key: "KeyR", pad: 2, label: "DRS / Active Aero" },
    shiftUp: { key: "KeyE", pad: 5, label: "Upshift Gear" },
    shiftDown: { key: "KeyQ", pad: 4, label: "Downshift Gear" },
    cycleCam: { key: "KeyC", pad: 3, label: "Cycle Camera View" },
    toggleHalo: { key: "KeyH", pad: 8, label: "Toggle Halo Ghost" },
    toggleLine: { key: "KeyT", pad: 12, label: "3D Braking Line" },
    boxRequest: { key: "KeyF", pad: 13, label: "Box / Pit Stop" },
    pitLimiter: { key: "KeyL", pad: 1, label: "Pit Lane Limiter" },
    brakeBiasDown: { key: "KeyB", pad: 14, label: "Brake Bias -" },
    brakeBiasUp: { key: "KeyN", pad: 15, label: "Brake Bias +" },
    lookBack: { key: "KeyX", pad: 10, label: "Look Back (Hold)" },
    pause: { key: "KeyP", pad: 9, label: "Pause / Menu" },
  };

  const DEFAULT_SIM_BINDS = {
    povToggle: { key: "KeyO", pad: 2, label: "Instant POV Toggle" },
    povSub: { key: "KeyC", pad: 11, label: "Cycle POV Angle" },
    cycleView: { key: "KeyV", pad: 3, label: "Cycle Broadcast View" },
    haloGhost: { key: "KeyH", pad: 8, label: "Toggle Halo Ghost" },
    playPause: { key: "Space", pad: 0, label: "Play / Pause Sim" },
    nextBattle: { key: "KeyN", pad: 1, label: "Jump to Closest Battle" },
    prevCar: { key: "ArrowUp", pad: 12, label: "Previous Car (P-1)" },
    nextCar: { key: "ArrowDown", pad: 13, label: "Next Car (P+1)" },
    speedDown: { key: "Comma", pad: 14, label: "Sim Speed Down" },
    speedUp: { key: "Period", pad: 15, label: "Sim Speed Up" },
    lookLeft: { key: "KeyQ", pad: 4, label: "POV Look Left (Hold)" },
    lookRight: { key: "KeyE", pad: 5, label: "POV Look Right (Hold)" },
    lookBack: { key: "KeyB", pad: 10, label: "POV Look Back (Hold)" },
    autoTv: { key: "KeyT", pad: 9, label: "Auto TV Director" },
  };

  const DRIVE_PRESETS = {
    ea_standard: {
      name: "EA F1 Standard",
      binds: DEFAULT_DRIVE_BINDS,
      cal: { steerDeadzone: 0.08, steerLinearity: 1.65, steerSensitivity: 1.0, triggerDeadzone: 0.03 },
    },
    face_shift: {
      name: "Face-Button Shift",
      binds: {
        ...DEFAULT_DRIVE_BINDS,
        shiftUp: { key: "KeyE", pad: 1, label: "Upshift Gear" },
        shiftDown: { key: "KeyQ", pad: 2, label: "Downshift Gear" },
        drs: { key: "KeyR", pad: 5, label: "DRS / Active Aero" },
        pitLimiter: { key: "KeyL", pad: 4, label: "Pit Lane Limiter" },
      },
      cal: { steerDeadzone: 0.09, steerLinearity: 1.5, steerSensitivity: 1.0, triggerDeadzone: 0.04 },
    },
    wheel_pro: {
      name: "Wheel / Pro Sim",
      binds: {
        ...DEFAULT_DRIVE_BINDS,
        ers: { key: "Space", pad: 0, label: "ERS Overtake (Hold)" },
        drs: { key: "KeyR", pad: 3, label: "DRS / Active Aero" },
        cycleCam: { key: "KeyC", pad: 2, label: "Cycle Camera View" },
      },
      cal: { steerDeadzone: 0.02, steerLinearity: 1.05, steerSensitivity: 1.15, triggerDeadzone: 0.02 },
    },
  };

  const SIM_PRESETS = {
    director_std: {
      name: "Broadcast Director",
      binds: DEFAULT_SIM_BINDS,
    },
    pov_focused: {
      name: "POV Spectator",
      binds: {
        ...DEFAULT_SIM_BINDS,
        povToggle: { key: "KeyO", pad: 0, label: "Instant POV Toggle" },
        playPause: { key: "Space", pad: 9, label: "Play / Pause Sim" },
        autoTv: { key: "KeyT", pad: 8, label: "Auto TV Director" },
      },
    },
  };

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function loadProfile() {
    const base = {
      calibration: clone(DEFAULT_CALIBRATION),
      drive: clone(DEFAULT_DRIVE_BINDS),
      sim: clone(DEFAULT_SIM_BINDS),
      drivePreset: "ea_standard",
      simPreset: "director_std",
    };
    try {
      const raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (parsed.calibration) Object.assign(base.calibration, parsed.calibration);
        if (parsed.drive) {
          Object.keys(base.drive).forEach((k) => {
            if (parsed.drive[k]) Object.assign(base.drive[k], parsed.drive[k]);
          });
        }
        if (parsed.sim) {
          Object.keys(base.sim).forEach((k) => {
            if (parsed.sim[k]) Object.assign(base.sim[k], parsed.sim[k]);
          });
        }
        if (parsed.drivePreset) base.drivePreset = parsed.drivePreset;
        if (parsed.simPreset) base.simPreset = parsed.simPreset;
      }
    } catch (_) {}
    return base;
  }

  let profile = loadProfile();
  let lastDevice = "keyboard"; // keyboard | gamepad
  const listeners = new Set();

  function saveProfile() {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
      }
    } catch (_) {}
    listeners.forEach((fn) => {
      try { fn(profile); } catch (_) {}
    });
  }

  function getConnectedGamepad() {
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      return Array.from(pads || []).find((p) => p && p.connected) || null;
    } catch (_) {
      return null;
    }
  }

  function detectFamily(pad) {
    const ov = profile.calibration.glyphOverride || "auto";
    if (ov === "xbox" || ov === "playstation" || ov === "keyboard") return ov;
    const p = pad || getConnectedGamepad();
    if (!p) return "keyboard";
    const id = String(p.id || "").toLowerCase();
    if (/dualsense|dualshock|sony|054c|ps4|ps5|wireless controller/.test(id)) return "playstation";
    if (/g29|g920|g923|thrustmaster|fanatec|moza|wheel|racing/.test(id)) return "wheel";
    return "xbox";
  }

  function padButtonGlyph(btnIdx, family) {
    const fam = family || detectFamily();
    const ps = {
      0: { t: "✕", c: "ps-cross" },
      1: { t: "○", c: "ps-circle" },
      2: { t: "□", c: "ps-square" },
      3: { t: "△", c: "ps-tri" },
      4: { t: "L1", c: "" },
      5: { t: "R1", c: "" },
      6: { t: "L2", c: "" },
      7: { t: "R2", c: "" },
      8: { t: "Share", c: "" },
      9: { t: "Opts", c: "" },
      10: { t: "L3", c: "" },
      11: { t: "R3", c: "" },
      12: { t: "D-↑", c: "" },
      13: { t: "D-↓", c: "" },
      14: { t: "D-←", c: "" },
      15: { t: "D-→", c: "" },
    };
    const xb = {
      0: { t: "A", c: "xb-a" },
      1: { t: "B", c: "xb-b" },
      2: { t: "X", c: "xb-x" },
      3: { t: "Y", c: "xb-y" },
      4: { t: "LB", c: "" },
      5: { t: "RB", c: "" },
      6: { t: "LT", c: "" },
      7: { t: "RT", c: "" },
      8: { t: "View", c: "" },
      9: { t: "Menu", c: "" },
      10: { t: "LS", c: "" },
      11: { t: "RS", c: "" },
      12: { t: "D-↑", c: "" },
      13: { t: "D-↓", c: "" },
      14: { t: "D-←", c: "" },
      15: { t: "D-→", c: "" },
    };
    const wh = {
      ...xb,
      4: { t: "Pad L", c: "" },
      5: { t: "Pad R", c: "" },
      6: { t: "Brake", c: "" },
      7: { t: "Gas", c: "" },
    };
    const map = fam === "playstation" ? ps : (fam === "wheel" ? wh : xb);
    return map[btnIdx] || { t: `B${btnIdx}`, c: "" };
  }

  function keyCodeLabel(code) {
    if (!code) return "—";
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    const special = {
      Space: "Space",
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
      Comma: ",",
      Period: ".",
      BracketLeft: "[",
      BracketRight: "]",
      ShiftRight: "R-Shift",
      ShiftLeft: "L-Shift",
      ControlRight: "R-Ctrl",
      Escape: "Esc",
    };
    return special[code] || code;
  }

  function applyStickCurve(rawVal) {
    const cal = profile.calibration;
    const dz = clamp(Number(cal.steerDeadzone ?? 0.08), 0.01, 0.35);
    const lin = clamp(Number(cal.steerLinearity ?? 1.65), 1.0, 3.0);
    const sens = clamp(Number(cal.steerSensitivity ?? 1.0), 0.5, 1.6);
    if (Math.abs(rawVal) <= dz) return 0;
    const norm = (Math.abs(rawVal) - dz) / (1 - dz);
    const curved = Math.pow(norm, lin) * sens;
    return clamp(Math.sign(rawVal) * curved, -1, 1);
  }

  function applyTriggerCurve(rawVal) {
    const dz = clamp(Number(profile.calibration.triggerDeadzone ?? 0.03), 0.0, 0.25);
    if (rawVal <= dz) return 0;
    return clamp((rawVal - dz) / (1 - dz), 0, 1);
  }

  function rumble(weakMag, strongMag, durationMs) {
    const strength = clamp(Number(profile.calibration.rumbleStrength ?? 0.85), 0, 1);
    if (strength <= 0.01) return;
    const pad = getConnectedGamepad();
    if (!pad || !pad.vibrationActuator || !pad.vibrationActuator.playEffect) return;
    try {
      pad.vibrationActuator.playEffect("dual-rumble", {
        startDelay: 0,
        duration: durationMs || 100,
        weakMagnitude: clamp((weakMag || 0) * strength, 0, 1),
        strongMagnitude: clamp((strongMag || 0) * strength, 0, 1),
      }).catch(() => {});
    } catch (_) {}
  }

  function formatActionGlyphHtml(context, actionKey, forceDevice) {
    const map = context === "sim" ? profile.sim : profile.drive;
    const b = map[actionKey];
    if (!b) return "";
    const pad = getConnectedGamepad();
    const ov = profile.calibration.glyphOverride || "auto";
    const usePad = forceDevice === "gamepad"
      || (ov === "xbox" || ov === "playstation")
      || (forceDevice !== "keyboard" && pad && lastDevice === "gamepad");
    if (usePad && b.pad != null) {
      const g = padButtonGlyph(b.pad, detectFamily(pad));
      return `<span class="gp-glyph ${g.c}">${g.t}</span>`;
    }
    return `<span class="gp-glyph">${keyCodeLabel(b.key)}</span>`;
  }

  function formatActionText(context, actionKey, preferPad) {
    const map = context === "sim" ? profile.sim : profile.drive;
    const b = map[actionKey];
    if (!b) return "";
    const pad = getConnectedGamepad();
    const ov = profile.calibration.glyphOverride || "auto";
    const usePad = preferPad || ov === "xbox" || ov === "playstation" || (pad && lastDevice === "gamepad");
    if (usePad && b.pad != null) {
      return padButtonGlyph(b.pad, detectFamily(pad)).t;
    }
    return keyCodeLabel(b.key);
  }

  function buildDynamicHintLine(context) {
    const pad = getConnectedGamepad();
    const ov = profile.calibration.glyphOverride || "auto";
    const usePad = ov === "xbox" || ov === "playstation" || (pad && lastDevice === "gamepad");
    const fam = detectFamily(pad);
    if (context === "sim") {
      if (usePad) {
        return `🎮 ${fam.toUpperCase()}: [${formatActionText("sim", "povToggle", true)}] POV · [${formatActionText("sim", "cycleView", true)}] Cam · [D-↑/↓] Driver · [D-←/→] Speed · [${formatActionText("sim", "lookLeft", true)}/${formatActionText("sim", "lookRight", true)}] Look · [${formatActionText("sim", "playPause", true)}] Pause`;
      }
      return `⌨️ [${formatActionText("sim", "povToggle", false)}] POV · [${formatActionText("sim", "povSub", false)}] Cockpit/T-Cam · [${formatActionText("sim", "haloGhost", false)}] Halo · [↑/↓] Driver · [←/→] Battle · [Q/E/B] Look · [W] Drive · [?] Controls`;
    }
    if (usePad) {
      const gas = fam === "playstation" ? "R2" : "RT";
      const brk = fam === "playstation" ? "L2" : "LT";
      return `🎮 ${fam.toUpperCase()}: L-Stick Steer · ${gas}/${brk} Gas/Brake · [${formatActionText("drive", "ers", true)}] ERS · [${formatActionText("drive", "drs", true)}] DRS · [${formatActionText("drive", "shiftDown", true)}/${formatActionText("drive", "shiftUp", true)}] Gear · [${formatActionText("drive", "cycleCam", true)}] Cam · [${formatActionText("drive", "boxRequest", true)}] Box`;
    }
    return `⌨️ WASD/Arrows Steer · [${formatActionText("drive", "ers", false)}] ERS · [${formatActionText("drive", "drs", false)}] DRS · [${formatActionText("drive", "shiftDown", false)}/${formatActionText("drive", "shiftUp", false)}] Gear · [${formatActionText("drive", "cycleCam", false)}] Cam · [${formatActionText("drive", "toggleHalo", false)}] Halo · [${formatActionText("drive", "boxRequest", false)}] Box`;
  }

  function applyPreset(context, presetKey) {
    if (context === "drive" && DRIVE_PRESETS[presetKey]) {
      profile.drive = clone(DRIVE_PRESETS[presetKey].binds);
      if (DRIVE_PRESETS[presetKey].cal) Object.assign(profile.calibration, DRIVE_PRESETS[presetKey].cal);
      profile.drivePreset = presetKey;
      saveProfile();
    } else if (context === "sim" && SIM_PRESETS[presetKey]) {
      profile.sim = clone(SIM_PRESETS[presetKey].binds);
      profile.simPreset = presetKey;
      saveProfile();
    }
  }

  function resetContext(context) {
    if (context === "drive") {
      profile.drive = clone(DEFAULT_DRIVE_BINDS);
      profile.calibration = clone(DEFAULT_CALIBRATION);
      profile.drivePreset = "ea_standard";
    } else {
      profile.sim = clone(DEFAULT_SIM_BINDS);
      profile.simPreset = "director_std";
    }
    saveProfile();
  }

  /**
   * Render interactive Gamepad & Keyboard Customizer Studio into containerEl.
   * Returns a cleanup function to stop the live calibration RAF loop when closed.
   */
  function mountStudio(containerEl, opts) {
    if (!containerEl) return () => {};
    const context = (opts && opts.context) === "sim" ? "sim" : "drive";
    const presets = context === "sim" ? SIM_PRESETS : DRIVE_PRESETS;
    const activePresetKey = () => (context === "sim" ? profile.simPreset : profile.drivePreset);
    const bindsObj = () => (context === "sim" ? profile.sim : profile.drive);

    let listenTarget = null; // { action, kind: "key" | "pad", btnEl }
    let rafId = 0;
    let disposed = false;

    function stopListen() {
      if (listenTarget && listenTarget.btnEl) {
        listenTarget.btnEl.classList.remove("is-listening");
      }
      listenTarget = null;
    }

    function onKeyCapture(ev) {
      if (!listenTarget || listenTarget.kind !== "key") return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.code !== "Escape") {
        bindsObj()[listenTarget.action].key = ev.code;
        saveProfile();
      }
      stopListen();
      render();
    }

    function render() {
      const pad = getConnectedGamepad();
      const fam = detectFamily(pad);
      const cal = profile.calibration;
      const binds = bindsObj();
      const presetButtons = Object.keys(presets).map((pk) => (
        `<button type="button" class="gp-btn${activePresetKey() === pk ? " active" : ""}" data-gp-preset="${pk}">${presets[pk].name}</button>`
      )).join("");

      const glyphModes = ["auto", "xbox", "playstation", "keyboard"].map((gm) => (
        `<button type="button" class="gp-btn${(cal.glyphOverride || "auto") === gm ? " active" : ""}" data-gp-glyph="${gm}">${gm.toUpperCase()}</button>`
      )).join("");

      const rows = Object.keys(binds).map((act) => {
        const b = binds[act];
        const g = padButtonGlyph(b.pad, fam === "keyboard" ? "xbox" : fam);
        return `
          <tr>
            <td><strong>${b.label}</strong></td>
            <td><button type="button" class="gp-btn" data-rebind-key="${act}"><span class="gp-glyph">${keyCodeLabel(b.key)}</span></button></td>
            <td><button type="button" class="gp-btn" data-rebind-pad="${act}"><span class="gp-glyph ${g.c}">${g.t}</span></button></td>
          </tr>`;
      }).join("");

      containerEl.innerHTML = `
        <div class="gp-studio">
          <div class="gp-top-bar">
            <span class="gp-status-pill${pad ? " is-connected" : ""}" data-gp-conn>
              ${pad ? `🎮 Connected: ${pad.id.slice(0, 38)} (${fam.toUpperCase()})` : "⌨️ No Gamepad Detected — Press any button on Xbox/PlayStation controller to wake"}
            </span>
            <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;">
              <span style="font-size:0.68rem;color:#94a3b8;font-weight:700;">HINT GLYPHS:</span>
              ${glyphModes}
              <button type="button" class="gp-btn" data-gp-reset>Reset Defaults</button>
            </div>
          </div>

          <div class="gp-grid-2">
            <div class="gp-card">
              <h4><i class="fas fa-sliders-h"></i> Presets &amp; Analog Calibration</h4>
              <div class="gp-presets">${presetButtons}</div>

              <div class="gp-live-bars">
                <div class="gp-bar-line">
                  <span>STEER L/R</span>
                  <div class="gp-bar-track"><div class="gp-bar-fill" data-gp-bar="steer" style="width:50%"></div></div>
                  <span data-gp-val="steer">0.00</span>
                </div>
                <div class="gp-bar-line">
                  <span>THROTTLE</span>
                  <div class="gp-bar-track"><div class="gp-bar-fill thr" data-gp-bar="thr" style="width:0%"></div></div>
                  <span data-gp-val="thr">0%</span>
                </div>
                <div class="gp-bar-line">
                  <span>BRAKE</span>
                  <div class="gp-bar-track"><div class="gp-bar-fill brk" data-gp-bar="brk" style="width:0%"></div></div>
                  <span data-gp-val="brk">0%</span>
                </div>
              </div>

              <div class="gp-slider-row">
                <label>Steering Deadzone</label><span data-cal-out="steerDeadzone">${Math.round(cal.steerDeadzone * 100)}%</span>
                <input type="range" min="0.02" max="0.25" step="0.01" value="${cal.steerDeadzone}" data-cal="steerDeadzone">
              </div>
              <div class="gp-slider-row">
                <label>Steering Linearity Curve</label><span data-cal-out="steerLinearity">${Number(cal.steerLinearity).toFixed(2)}</span>
                <input type="range" min="1.0" max="2.8" step="0.05" value="${cal.steerLinearity}" data-cal="steerLinearity">
              </div>
              <div class="gp-slider-row">
                <label>Steering Sensitivity</label><span data-cal-out="steerSensitivity">${Math.round(cal.steerSensitivity * 100)}%</span>
                <input type="range" min="0.6" max="1.5" step="0.05" value="${cal.steerSensitivity}" data-cal="steerSensitivity">
              </div>
              <div class="gp-slider-row">
                <label>Trigger Deadzone</label><span data-cal-out="triggerDeadzone">${Math.round(cal.triggerDeadzone * 100)}%</span>
                <input type="range" min="0.01" max="0.15" step="0.01" value="${cal.triggerDeadzone}" data-cal="triggerDeadzone">
              </div>
              <div class="gp-slider-row">
                <label>Haptic Rumble Intensity</label><span data-cal-out="rumbleStrength">${Math.round(cal.rumbleStrength * 100)}%</span>
                <input type="range" min="0" max="1" step="0.05" value="${cal.rumbleStrength}" data-cal="rumbleStrength">
              </div>
              <div style="display:flex;gap:6px;margin-top:2px;">
                <button type="button" class="gp-btn" data-gp-rumble><i class="fas fa-wave-square"></i> Test Dual-Rumble</button>
              </div>
            </div>

            <div class="gp-card" style="max-height:360px;overflow-y:auto;">
              <h4><i class="fas fa-gamepad"></i> Click-to-Rebind (${context === "sim" ? "Broadcast Director" : "Apex POV Driver"})</h4>
              <div style="font-size:0.69rem;color:#94a3b8;">Click any Key or Gamepad button badge below, then press your new key or controller button (Esc cancels).</div>
              <table class="gp-bind-table">
                <thead><tr><th>Action</th><th>Keyboard</th><th>Gamepad</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        </div>
      `;

      containerEl.querySelectorAll("[data-gp-preset]").forEach((btn) => {
        btn.addEventListener("click", () => {
          applyPreset(context, btn.getAttribute("data-gp-preset"));
          render();
        });
      });
      containerEl.querySelectorAll("[data-gp-glyph]").forEach((btn) => {
        btn.addEventListener("click", () => {
          profile.calibration.glyphOverride = btn.getAttribute("data-gp-glyph");
          saveProfile();
          render();
        });
      });
      containerEl.querySelector("[data-gp-reset]")?.addEventListener("click", () => {
        resetContext(context);
        render();
      });
      containerEl.querySelector("[data-gp-rumble]")?.addEventListener("click", () => {
        rumble(0.75, 0.9, 240);
      });
      containerEl.querySelectorAll("[data-cal]").forEach((inp) => {
        inp.addEventListener("input", () => {
          const k = inp.getAttribute("data-cal");
          const v = parseFloat(inp.value);
          profile.calibration[k] = v;
          const out = containerEl.querySelector(`[data-cal-out="${k}"]`);
          if (out) {
            out.textContent = k === "steerLinearity" ? v.toFixed(2) : `${Math.round(v * 100)}%`;
          }
          saveProfile();
        });
      });
      containerEl.querySelectorAll("[data-rebind-key]").forEach((btn) => {
        btn.addEventListener("click", () => {
          stopListen();
          listenTarget = { action: btn.getAttribute("data-rebind-key"), kind: "key", btnEl: btn };
          btn.classList.add("is-listening");
          btn.textContent = "Press Key…";
        });
      });
      containerEl.querySelectorAll("[data-rebind-pad]").forEach((btn) => {
        btn.addEventListener("click", () => {
          stopListen();
          listenTarget = { action: btn.getAttribute("data-rebind-pad"), kind: "pad", btnEl: btn };
          btn.classList.add("is-listening");
          btn.textContent = "Press Button…";
        });
      });
    }

    function pollLive() {
      if (disposed) return;
      rafId = requestAnimationFrame(pollLive);
      const pad = getConnectedGamepad();
      if (!pad) return;
      const steer = applyStickCurve(Number(pad.axes[0] || 0));
      const thr = applyTriggerCurve(pad.buttons[7] ? pad.buttons[7].value : 0);
      const brk = applyTriggerCurve(pad.buttons[6] ? pad.buttons[6].value : 0);

      const sBar = containerEl.querySelector('[data-gp-bar="steer"]');
      const sVal = containerEl.querySelector('[data-gp-val="steer"]');
      const tBar = containerEl.querySelector('[data-gp-bar="thr"]');
      const tVal = containerEl.querySelector('[data-gp-val="thr"]');
      const bBar = containerEl.querySelector('[data-gp-bar="brk"]');
      const bVal = containerEl.querySelector('[data-gp-val="brk"]');
      if (sBar) sBar.style.width = `${Math.round((steer * 0.5 + 0.5) * 100)}%`;
      if (sVal) sVal.textContent = steer.toFixed(2);
      if (tBar) tBar.style.width = `${Math.round(thr * 100)}%`;
      if (tVal) tVal.textContent = `${Math.round(thr * 100)}%`;
      if (bBar) bBar.style.width = `${Math.round(brk * 100)}%`;
      if (bVal) bVal.textContent = `${Math.round(brk * 100)}%`;

      if (listenTarget && listenTarget.kind === "pad") {
        for (let i = 0; i < pad.buttons.length; i++) {
          if (i === 6 || i === 7) continue; // reserve analog triggers for brake/gas
          if (pad.buttons[i] && pad.buttons[i].pressed) {
            bindsObj()[listenTarget.action].pad = i;
            saveProfile();
            stopListen();
            render();
            break;
          }
        }
      }
    }

    window.addEventListener("keydown", onKeyCapture, true);
    render();
    rafId = requestAnimationFrame(pollLive);

    return function unmount() {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKeyCapture, true);
    };
  }

  global.F1GamepadStudio = {
    getProfile: () => profile,
    getCalibration: () => profile.calibration,
    getDriveBinds: () => profile.drive,
    getSimBinds: () => profile.sim,
    getConnectedGamepad,
    detectFamily,
    padButtonGlyph,
    keyCodeLabel,
    applyStickCurve,
    applyTriggerCurve,
    rumble,
    setLastDevice: (dev) => { if (dev === "keyboard" || dev === "gamepad") lastDevice = dev; },
    getLastDevice: () => lastDevice,
    formatActionGlyphHtml,
    formatActionText,
    buildDynamicHintLine,
    applyPreset,
    resetContext,
    mountStudio,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
})(window);
