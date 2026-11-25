/**
 * Apex POV (/drive) — Unified Keyboard + HTML5 Gamepad API Input & Rumble Controller.
 *
 * Features:
 *   - Keyboard (WASD / Arrows) with speed-sensitive steering smoothing so high-speed corners
 *     feel razor-sharp without twitchiness
 *   - HTML5 Gamepad API (Xbox / PlayStation / Racing Wheels): analog triggers, cubic stick
 *     curve with deadzone, paddle shifters, DRS/ERS/Camera/Pit buttons & dual-rumble haptics
 *   - Edge-triggered discrete actions (shiftUp, shiftDown, cycleCam, toggleHalo, toggleLine, pause)
 */
(function (global) {
  "use strict";

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function createDriveInput(callbacks) {
    const cb = callbacks || {};
    const keys = new Set();
    let steerSmooth = 0;
    let throttleSmooth = 0;
    let brakeSmooth = 0;
    let gamepadName = "";
    let prevPadBtns = [];
    let lastRumbleMs = 0;

    const oneShot = {
      shiftUp: false,
      shiftDown: false,
      togglePitLimiter: false,
    };

    function onKeyDown(e) {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA")) return;
      const code = e.code;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(code)) {
        e.preventDefault();
      }
      if (!keys.has(code)) {
        if (code === "KeyE" || code === "ShiftRight") oneShot.shiftUp = true;
        if (code === "KeyQ" || code === "ControlRight") oneShot.shiftDown = true;
        if (code === "KeyL") oneShot.togglePitLimiter = true;
        if (code === "KeyC" && cb.onCycleCamera) cb.onCycleCamera();
        if (code === "KeyH" && cb.onToggleHalo) cb.onToggleHalo();
        if (code === "KeyT" && cb.onToggleRacingLine) cb.onToggleRacingLine();
        if ((code === "Escape" || code === "KeyP") && cb.onTogglePause) cb.onTogglePause();
        if (code === "KeyB" && cb.onBrakeBias) cb.onBrakeBias(-1);
        if (code === "KeyN" && cb.onBrakeBias) cb.onBrakeBias(+1);
        if (code === "KeyF" && cb.onBoxRequest) cb.onBoxRequest();
      }
      keys.add(code);
    }

    function onKeyUp(e) {
      keys.delete(e.code);
    }

    function onBlur() {
      keys.clear();
    }

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    function poll(dt, speedKph) {
      const stepDt = Math.max(0.001, Math.min(0.05, dt || 0.016));
      let kbThrottle = (keys.has("KeyW") || keys.has("ArrowUp")) ? 1 : 0;
      let kbBrake = (keys.has("KeyS") || keys.has("ArrowDown")) ? 1 : 0;
      let kbSteer = 0;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) kbSteer -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) kbSteer += 1;

      let ers = keys.has("Space");
      let drs = keys.has("KeyR");

      let shiftUp = oneShot.shiftUp;
      let shiftDown = oneShot.shiftDown;
      let togglePitLimiter = oneShot.togglePitLimiter;
      oneShot.shiftUp = false;
      oneShot.shiftDown = false;
      oneShot.togglePitLimiter = false;

      // Poll HTML5 Gamepad API
      let padThrottle = 0, padBrake = 0, padSteer = 0, padActive = false;
      gamepadName = "";
      try {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const pad = Array.from(pads || []).find((p) => p && p.connected);
        if (pad) {
          gamepadName = pad.id || "Gamepad";
          const rawX = Number(pad.axes[0] || 0);
          const dz = 0.08;
          if (Math.abs(rawX) > dz) {
            const norm = (Math.abs(rawX) - dz) / (1 - dz);
            padSteer = Math.sign(rawX) * (0.58 * norm + 0.42 * norm * norm * norm);
            padActive = true;
          }
          const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
          const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
          if (rt > 0.03) { padThrottle = rt; padActive = true; }
          if (lt > 0.03) { padBrake = lt; padActive = true; }

          const pressed = (idx) => Boolean(pad.buttons[idx] && pad.buttons[idx].pressed);
          const edge = (idx) => pressed(idx) && !prevPadBtns[idx];
          if (pressed(0)) ers = true;            // A / Cross = ERS Overtake
          if (pressed(2)) drs = true;            // X / Square = DRS
          if (edge(5)) shiftUp = true;           // RB = Upshift
          if (edge(4)) shiftDown = true;         // LB = Downshift
          if (edge(1)) togglePitLimiter = true;  // B / Circle = Pit Limiter
          if (edge(3) && cb.onCycleCamera) cb.onCycleCamera(); // Y / Triangle = Camera
          if (edge(9) && cb.onTogglePause) cb.onTogglePause(); // Start = Pause
          prevPadBtns = pad.buttons.map((b) => Boolean(b && b.pressed));
        }
      } catch (_) {}

      // Smooth keyboard inputs (instant analog pass-through when gamepad is active)
      if (padActive && kbSteer === 0 && kbThrottle === 0 && kbBrake === 0) {
        steerSmooth = padSteer;
        throttleSmooth = padThrottle;
        brakeSmooth = padBrake;
      } else {
        const spdFactor = clamp((speedKph || 0) / 300, 0, 1);
        const steerRate = kbSteer !== 0 ? (9.5 - spdFactor * 4.2) : 13.0;
        steerSmooth += (kbSteer - steerSmooth) * Math.min(1, stepDt * steerRate);
        if (Math.abs(steerSmooth) < 0.01 && kbSteer === 0) steerSmooth = 0;
        throttleSmooth += (kbThrottle - throttleSmooth) * Math.min(1, stepDt * 14);
        brakeSmooth += (kbBrake - brakeSmooth) * Math.min(1, stepDt * 16);
      }

      return {
        throttle: clamp(Math.max(throttleSmooth, padThrottle), 0, 1),
        brake: clamp(Math.max(brakeSmooth, padBrake), 0, 1),
        steer: clamp(padActive && kbSteer === 0 ? padSteer : steerSmooth, -1, 1),
        ers,
        drs,
        shiftUp,
        shiftDown,
        togglePitLimiter,
        gamepadName,
      };
    }

    function rumble(weakMag, strongMag, durationMs) {
      const now = performance.now();
      if (now - lastRumbleMs < 75) return;
      lastRumbleMs = now;
      try {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const pad = Array.from(pads || []).find((p) => p && p.connected && p.vibrationActuator);
        if (pad && pad.vibrationActuator && pad.vibrationActuator.playEffect) {
          pad.vibrationActuator.playEffect("dual-rumble", {
            startDelay: 0,
            duration: durationMs || 90,
            weakMagnitude: clamp(weakMag || 0, 0, 1),
            strongMagnitude: clamp(strongMag || 0, 0, 1),
          }).catch(() => {});
        }
      } catch (_) {}
    }

    function dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    }

    return { poll, rumble, getGamepadName: () => gamepadName, dispose };
  }

  global.F1DriveInput = { createDriveInput };
})(window);
