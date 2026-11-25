/**
 * APEX GRID (/drive) — Unified Keyboard + Customizable HTML5 Gamepad API Input & Rumble Controller.
 *
 * Connected to window.F1GamepadStudio so custom deadzones, steering linearity curves,
 * click-to-rebind keyboard/gamepad mappings, PlayStation/Xbox glyph hints, look-back,
 * D-pad brake bias & box requests, and rumble strength all work seamlessly.
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
    let gamepadFamily = "keyboard";
    let prevPadBtns = [];
    let lastRumbleMs = 0;

    const oneShot = {
      shiftUp: false,
      shiftDown: false,
      togglePitLimiter: false,
    };

    function getBinds() {
      const S = global.F1GamepadStudio;
      if (S && S.getDriveBinds) return S.getDriveBinds();
      return {
        ers: { key: "Space", pad: 0 },
        drs: { key: "KeyR", pad: 2 },
        shiftUp: { key: "KeyE", pad: 5 },
        shiftDown: { key: "KeyQ", pad: 4 },
        cycleCam: { key: "KeyC", pad: 3 },
        toggleHalo: { key: "KeyH", pad: 8 },
        toggleLine: { key: "KeyT", pad: 12 },
        boxRequest: { key: "KeyF", pad: 13 },
        pitLimiter: { key: "KeyL", pad: 1 },
        brakeBiasDown: { key: "KeyB", pad: 14 },
        brakeBiasUp: { key: "KeyN", pad: 15 },
        lookBack: { key: "KeyX", pad: 10 },
        pause: { key: "KeyP", pad: 9 },
      };
    }

    function onKeyDown(e) {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA")) return;
      const code = e.code;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(code)) {
        e.preventDefault();
      }
      if (global.F1GamepadStudio) global.F1GamepadStudio.setLastDevice("keyboard");
      const b = getBinds();
      if (!keys.has(code)) {
        if (code === b.shiftUp.key || code === "ShiftRight") oneShot.shiftUp = true;
        if (code === b.shiftDown.key || code === "ControlRight") oneShot.shiftDown = true;
        if (code === b.pitLimiter.key) oneShot.togglePitLimiter = true;
        if (code === b.cycleCam.key && cb.onCycleCamera) cb.onCycleCamera();
        if (code === b.toggleHalo.key && cb.onToggleHalo) cb.onToggleHalo();
        if (code === b.toggleLine.key && cb.onToggleRacingLine) cb.onToggleRacingLine();
        if ((code === "Escape" || code === b.pause.key) && cb.onTogglePause) cb.onTogglePause();
        if (code === b.brakeBiasDown.key && cb.onBrakeBias) cb.onBrakeBias(-1);
        if (code === b.brakeBiasUp.key && cb.onBrakeBias) cb.onBrakeBias(+1);
        if (code === b.boxRequest.key && cb.onBoxRequest) cb.onBoxRequest();
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
      const b = getBinds();
      const S = global.F1GamepadStudio;

      let kbThrottle = (keys.has("KeyW") || keys.has("ArrowUp")) ? 1 : 0;
      let kbBrake = (keys.has("KeyS") || keys.has("ArrowDown")) ? 1 : 0;
      let kbSteer = 0;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) kbSteer -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) kbSteer += 1;

      let ers = keys.has(b.ers.key);
      let drs = keys.has(b.drs.key);
      let lookBack = keys.has(b.lookBack.key);

      let shiftUp = oneShot.shiftUp;
      let shiftDown = oneShot.shiftDown;
      let togglePitLimiter = oneShot.togglePitLimiter;
      oneShot.shiftUp = false;
      oneShot.shiftDown = false;
      oneShot.togglePitLimiter = false;

      // Poll HTML5 Gamepad API with custom deadzones, linearity curves & remapped buttons
      let padThrottle = 0, padBrake = 0, padSteer = 0, padActive = false;
      gamepadName = "";
      gamepadFamily = "keyboard";
      try {
        const pad = S ? S.getConnectedGamepad() : (Array.from((navigator.getGamepads && navigator.getGamepads()) || []).find((p) => p && p.connected) || null);
        if (pad) {
          gamepadName = pad.id || "Gamepad";
          gamepadFamily = S ? S.detectFamily(pad) : "xbox";
          const rawX = Number(pad.axes[0] || 0);
          padSteer = S ? S.applyStickCurve(rawX) : (Math.abs(rawX) > 0.08 ? rawX : 0);
          if (Math.abs(padSteer) > 0.01) padActive = true;

          const rtRaw = pad.buttons[7] ? pad.buttons[7].value : 0;
          const ltRaw = pad.buttons[6] ? pad.buttons[6].value : 0;
          padThrottle = S ? S.applyTriggerCurve(rtRaw) : (rtRaw > 0.03 ? rtRaw : 0);
          padBrake = S ? S.applyTriggerCurve(ltRaw) : (ltRaw > 0.03 ? ltRaw : 0);
          if (padThrottle > 0.01 || padBrake > 0.01) padActive = true;

          const pressed = (idx) => idx != null && Boolean(pad.buttons[idx] && pad.buttons[idx].pressed);
          const edge = (idx) => pressed(idx) && !prevPadBtns[idx];
          const anyPressed = pad.buttons.some((bt) => bt && bt.pressed);
          if (padActive || anyPressed) {
            if (S) S.setLastDevice("gamepad");
          }

          if (pressed(b.ers.pad)) ers = true;
          if (pressed(b.drs.pad)) drs = true;
          if (pressed(b.lookBack.pad)) lookBack = true;
          if (edge(b.shiftUp.pad)) shiftUp = true;
          if (edge(b.shiftDown.pad)) shiftDown = true;
          if (edge(b.pitLimiter.pad)) togglePitLimiter = true;
          if (edge(b.cycleCam.pad) && cb.onCycleCamera) cb.onCycleCamera();
          if (edge(b.toggleHalo.pad) && cb.onToggleHalo) cb.onToggleHalo();
          if (edge(b.toggleLine.pad) && cb.onToggleRacingLine) cb.onToggleRacingLine();
          if (edge(b.boxRequest.pad) && cb.onBoxRequest) cb.onBoxRequest();
          if (edge(b.brakeBiasDown.pad) && cb.onBrakeBias) cb.onBrakeBias(-1);
          if (edge(b.brakeBiasUp.pad) && cb.onBrakeBias) cb.onBrakeBias(+1);
          if (edge(b.pause.pad) && cb.onTogglePause) cb.onTogglePause();

          prevPadBtns = pad.buttons.map((bt) => Boolean(bt && bt.pressed));
        }
      } catch (_) {}

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
        lookBack,
        shiftUp,
        shiftDown,
        togglePitLimiter,
        gamepadName,
        gamepadFamily,
      };
    }

    function rumble(weakMag, strongMag, durationMs) {
      const now = performance.now();
      if (now - lastRumbleMs < 75) return;
      lastRumbleMs = now;
      if (global.F1GamepadStudio && global.F1GamepadStudio.rumble) {
        global.F1GamepadStudio.rumble(weakMag, strongMag, durationMs);
      }
    }

    function destroy() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    }

    return { poll, rumble, destroy };
  }

  global.F1DriveInput = { createDriveInput };
})(window);
