/**
 * Apex POV (/drive) — Interactive 3D Halo Cockpit, Animated Steering Wheel w/ Live 60 Hz OLED Dash
 * & 4-Camera Rig (Cockpit Halo POV, T-Cam Onboard, Nose Cam, Chase Cam).
 */
(function (global) {
  "use strict";

  const COMPOUND_COLORS = {
    soft: 0xef4444, medium: 0xfacc15, hard: 0xf8fafc, inter: 0x22c55e, wet: 0x3b82f6,
  };

  function createCockpitAndCamera(scene, teamColorHex, physicsDna) {
    const THREE = global.THREE;
    const root = new THREE.Group();
    scene.add(root);

    const teamCol = new THREE.Color(teamColorHex || "#e10600");
    const paintMat = new THREE.MeshStandardMaterial({ color: teamCol, roughness: 0.28, metalness: 0.35 });
    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x161b24, roughness: 0.45, metalness: 0.28 });
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.85, metalness: 0.05 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x2b3342, roughness: 0.35, metalness: 0.72 });
    const ringMat = new THREE.MeshBasicMaterial({ color: COMPOUND_COLORS.soft });
    const haloPillarMat = new THREE.MeshStandardMaterial({
      color: 0x181d26, roughness: 0.35, metalness: 0.45, transparent: true, opacity: 1.0,
    });
    const mirrorLeftLed = new THREE.MeshBasicMaterial({ color: 0x0f172a });
    const mirrorRightLed = new THREE.MeshBasicMaterial({ color: 0x0f172a });

    // --- 1. First-Person Cockpit Assembly (visible in cockpit / tcam / nose) ---
    const fpGroup = new THREE.Group();
    root.add(fpGroup);

    // Nosecone & chassis tub extending forward (+Z is forward)
    const tub = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.46, 2.35), paintMat);
    tub.position.set(0, 0.38, 0.35);
    fpGroup.add(tub);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.24, 2.15), paintMat);
    nose.position.set(0, 0.36, 2.30);
    nose.rotation.x = 0.08;
    fpGroup.add(nose);

    const noseTip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.65), carbonMat);
    noseTip.position.set(0, 0.25, 3.45);
    fpGroup.add(noseTip);

    // Front wing mainplane & endplates visible at lower edges
    const fWing = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.06, 0.46), carbonMat);
    fWing.position.set(0, 0.15, 3.45);
    fpGroup.add(fWing);
    const fFlap = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.04, 0.24), paintMat);
    fFlap.position.set(0, 0.21, 3.28);
    fFlap.rotation.x = -0.22;
    fpGroup.add(fFlap);

    // Carbon cockpit rim / headrest padding
    const leftCoaming = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.24, 1.35), carbonMat);
    leftCoaming.position.set(0.45, 0.64, 0.12);
    fpGroup.add(leftCoaming);
    const rightCoaming = leftCoaming.clone();
    rightCoaming.position.x = -0.45;
    fpGroup.add(rightCoaming);

    // Side Mirrors with Proximity Blind-Spot LEDs
    [-1, 1].forEach((side) => {
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.06), carbonMat);
      stalk.position.set(side * 0.58, 0.72, 0.68);
      fpGroup.add(stalk);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.09, 0.11), paintMat);
      housing.position.set(side * 0.72, 0.75, 0.68);
      fpGroup.add(housing);
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.02), side > 0 ? mirrorLeftLed : mirrorRightLed);
      led.position.set(side * 0.72, 0.75, 0.62);
      fpGroup.add(led);
    });

    // Steerable Front Wheels & Twin Wishbone Suspension Arms
    const frontSteerPivots = [];
    const spinMeshes = [];
    [-1, 1].forEach((side) => {
      // Upper & lower wishbones
      const wishU = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.035, 0.09), carbonMat);
      wishU.position.set(side * 0.56, 0.45, 1.85);
      fpGroup.add(wishU);
      const wishL = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.035, 0.09), carbonMat);
      wishL.position.set(side * 0.58, 0.24, 1.88);
      fpGroup.add(wishL);

      const pivot = new THREE.Group();
      pivot.position.set(side * 0.94, 0.36, 1.86);
      fpGroup.add(pivot);
      frontSteerPivots.push(pivot);

      const wheelGrp = new THREE.Group();
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.34, 20), tyreMat);
      tyre.rotation.z = Math.PI * 0.5;
      wheelGrp.add(tyre);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.35, 14), rimMat);
      rim.rotation.z = Math.PI * 0.5;
      wheelGrp.add(rim);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.022, 6, 20), ringMat);
      ring.rotation.y = Math.PI * 0.5;
      ring.position.x = -side * 0.176; // inner sidewall visible to driver!
      wheelGrp.add(ring);
      const ringOut = ring.clone();
      ringOut.position.x = side * 0.176;
      wheelGrp.add(ringOut);

      pivot.add(wheelGrp);
      spinMeshes.push(wheelGrp);
    });

    // Authentic FIA Halo (toggled off in classic pre-2018 eras; center pillar supports Ghost opacity)
    const haloGroup = new THREE.Group();
    const haloHoop = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.044, 10, 24, Math.PI), carbonMat);
    haloHoop.rotation.x = Math.PI * 0.5;
    haloHoop.position.set(0, 0.89, 0.22);
    haloGroup.add(haloHoop);
    const haloPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.044, 0.44, 10), haloPillarMat);
    haloPillar.position.set(0, 0.71, 0.72);
    haloPillar.rotation.x = 0.46;
    haloGroup.add(haloPillar);
    haloGroup.visible = Boolean(!physicsDna || physicsDna.halo !== false);
    fpGroup.add(haloGroup);

    // --- 2. Animated Carbon Steering Wheel + Live 60 Hz OLED Display ---
    const oledCanvas = document.createElement("canvas");
    oledCanvas.width = 256;
    oledCanvas.height = 160;
    const oledCtx = oledCanvas.getContext("2d");
    const oledTex = new THREE.CanvasTexture(oledCanvas);
    oledTex.colorSpace = THREE.SRGBColorSpace;

    const wheelPivot = new THREE.Group();
    wheelPivot.position.set(0, 0.62, 0.44);
    wheelPivot.rotation.x = -0.32;
    fpGroup.add(wheelPivot);

    const wheelBody = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.17, 0.028), carbonMat);
    wheelPivot.add(wheelBody);
    // Ergonomic side grips
    [-1, 1].forEach((s) => {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.17, 10), tyreMat);
      grip.position.set(s * 0.145, 0, 0.008);
      wheelPivot.add(grip);
    });
    // Rotary dial knobs (colorful F1 wheel accents)
    [
      [-0.085, -0.045, 0xef4444], [0, -0.052, 0xfacc15], [0.085, -0.045, 0x38bdf8],
      [-0.095, 0.045, 0x22c55e], [0.095, 0.045, 0xf97316],
    ].forEach(([kx, ky, col]) => {
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.018, 8), new THREE.MeshBasicMaterial({ color: col }));
      knob.rotation.x = Math.PI * 0.5;
      knob.position.set(kx, ky, -0.018);
      wheelPivot.add(knob);
    });
    // Live OLED screen facing driver (-Z faces driver in cockpit!)
    const screenPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.185, 0.115),
      new THREE.MeshBasicMaterial({ map: oledTex })
    );
    screenPlane.rotation.y = Math.PI;
    screenPlane.position.set(0, 0.008, -0.016);
    wheelPivot.add(screenPlane);

    // --- 3. External Full Car Mesh (for Chase Cam!) ---
    const extGroup = new THREE.Group();
    let builtExt = false;
    try {
      if (global.F1Car3D && global.F1Car3D.buildF1Car) {
        const pal = { main: teamColorHex || "#e10600", secondary: "#0f172a", accent: "#f8fafc", pop: "#facc15", detail: "#1e293b" };
        const built = global.F1Car3D.buildF1Car(pal, { era: (physicsDna && physicsDna.chassis_era) || "2020s" });
        if (built && built.root) {
          built.root.scale.setScalar(1.06);
          extGroup.add(built.root);
          builtExt = true;
        }
      }
    } catch (_) {}
    if (!builtExt) {
      const extBody = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 4.6), paintMat);
      extBody.position.y = 0.42;
      extGroup.add(extBody);
      const extWing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.45), carbonMat);
      extWing.position.set(0, 0.92, -2.05);
      extGroup.add(extWing);
    }
    extGroup.visible = false;
    root.add(extGroup);

    // --- 4. Camera Rig State ---
    const CAM_MODES = ["cockpit", "tcam", "nose", "chase"];
    let camMode = "cockpit";
    let haloGhost = true; // default translucent center pillar so track apexes stay crystal clear!
    haloPillarMat.opacity = 0.28;

    const camPosSmooth = new THREE.Vector3();
    const camLookSmooth = new THREE.Vector3();
    let camInit = false;
    let oledTick = 0;

    function drawOled(car, deltaS) {
      oledCtx.fillStyle = "#040811";
      oledCtx.fillRect(0, 0, 256, 160);

      // 15-LED RGB Shift Light Bar
      const rpmFrac = Math.max(0, Math.min(1, ((car.rpm || 3600) - (car.dna.idle_rpm || 3600)) / Math.max(1000, (car.dna.redline_rpm || 13200) - (car.dna.idle_rpm || 3600))));
      const lit = Math.round(rpmFrac * 15);
      const flash = rpmFrac > 0.95 && (Math.floor(performance.now() / 80) % 2 === 0);
      for (let i = 0; i < 15; i++) {
        const col = i < 5 ? "#22c55e" : (i < 10 ? "#ef4444" : "#38bdf8");
        oledCtx.fillStyle = (i < lit && !flash) ? col : "#1e293b";
        oledCtx.beginPath();
        oledCtx.arc(16 + i * 16, 13, 5.2, 0, Math.PI * 2);
        oledCtx.fill();
      }

      // DRS / ERS / PIT status badges
      oledCtx.font = "900 13px monospace";
      oledCtx.fillStyle = car.drsOpen ? "#22c55e" : (car.drsAvailable ? "#facc15" : "#334155");
      oledCtx.fillRect(10, 26, 52, 20);
      oledCtx.fillStyle = "#040811";
      oledCtx.textAlign = "center";
      oledCtx.fillText("DRS", 36, 40);

      oledCtx.fillStyle = car.ersActive ? "#38bdf8" : "#1e293b";
      oledCtx.fillRect(194, 26, 52, 20);
      oledCtx.fillStyle = car.ersActive ? "#040811" : "#94a3b8";
      oledCtx.fillText(car.pitLimiter ? "PIT" : "ERS", 220, 40);

      // Giant Center Gear
      oledCtx.fillStyle = "#f8fafc";
      oledCtx.font = "900 64px sans-serif";
      oledCtx.fillText(String(car.gear || 1), 128, 92);

      // Speed KPH & Live Delta
      oledCtx.font = "800 18px monospace";
      oledCtx.fillStyle = "#38bdf8";
      oledCtx.textAlign = "left";
      oledCtx.fillText(`${Math.round(car.speedKph || 0)}`, 14, 86);
      oledCtx.font = "700 10px monospace";
      oledCtx.fillStyle = "#94a3b8";
      oledCtx.fillText("KPH", 14, 98);

      const dVal = Number(deltaS || 0);
      oledCtx.textAlign = "right";
      oledCtx.font = "800 15px monospace";
      oledCtx.fillStyle = dVal <= 0 ? "#4ade80" : "#f87171";
      oledCtx.fillText(`${dVal <= 0 ? "" : "+"}${dVal.toFixed(2)}`, 244, 86);
      oledCtx.font = "700 10px monospace";
      oledCtx.fillStyle = "#94a3b8";
      oledCtx.fillText("DELTA", 244, 98);

      // ERS Battery Bar
      oledCtx.fillStyle = "#1e293b";
      oledCtx.fillRect(12, 114, 232, 10);
      oledCtx.fillStyle = car.ersActive ? "#38bdf8" : "#facc15";
      oledCtx.fillRect(12, 114, Math.round(232 * Math.max(0, Math.min(1, (car.ersBattery || 0) / 100))), 10);

      // Footer: Tyre Temp, Life, Brake Bias
      oledCtx.textAlign = "left";
      oledCtx.font = "700 12px monospace";
      oledCtx.fillStyle = car.thermalCliff ? "#f87171" : "#cbd5e1";
      oledCtx.fillText(`TYR ${Math.round(car.tyreLife || 100)}% ${Math.round(car.coreTemp || 90)}°C`, 12, 146);
      oledCtx.textAlign = "right";
      oledCtx.fillStyle = "#94a3b8";
      oledCtx.fillText(`BB ${car.brakeBias || 56}%`, 244, 146);

      oledTex.needsUpdate = true;
    }

    function update(car, camera, dt, deltaS, proxLeft, proxRight) {
      if (!car) return;

      // Sync compound ring color
      const compHex = COMPOUND_COLORS[car.compound] || COMPOUND_COLORS.soft;
      if (ringMat.color.getHex() !== compHex) ringMat.color.setHex(compHex);

      // Update blind-spot mirror LEDs
      mirrorLeftLed.color.setHex(proxLeft ? 0xf97316 : 0x0f172a);
      mirrorRightLed.color.setHex(proxRight ? 0xf97316 : 0x0f172a);

      // Position player chassis with 4-DOF pitch/roll/heave
      root.position.set(car.x, car.y + (car.heaveY || 0.04), car.z);
      root.rotation.order = "YXZ";
      root.rotation.y = car.yaw;
      root.rotation.x = car.pitchRad || 0;
      root.rotation.z = car.rollRad || 0;

      // Animate steering wheel & front wheels
      wheelPivot.rotation.z = -(car.steerWheelRad || 0);
      for (let i = 0; i < frontSteerPivots.length; i++) {
        frontSteerPivots[i].rotation.y = -(car.frontSteerRad || 0);
        spinMeshes[i].rotation.x = car.wheelSpin || 0;
      }

      // Update 60 Hz OLED dash (throttled to ~20 Hz for crisp zero-GC perf)
      oledTick += (dt || 0.016);
      if (oledTick >= 0.045) {
        oledTick = 0;
        drawOled(car, deltaS);
      }

      // Toggle first-person cockpit vs external car mesh
      const isChase = camMode === "chase";
      fpGroup.visible = !isChase;
      extGroup.visible = isChase;

      // Camera rig computation
      const sinY = Math.sin(car.yaw);
      const cosY = Math.cos(car.yaw);
      const rx = -cosY;
      const rz = sinY;
      const kph = car.speedKph || 0;
      const kerbShake = (car.kerbIntensity || 0) * (Math.random() - 0.5) * 0.045;
      const apexLook = (car.frontSteerRad || 0) * 6.5;

      const desPos = new THREE.Vector3();
      const desLook = new THREE.Vector3();
      let desFov = 68;

      if (camMode === "cockpit") {
        // Driver eye-line behind steering wheel, looking through Halo
        desPos.set(car.x, car.y + 0.85 + kerbShake, car.z);
        desPos.x += sinY * (-0.06);
        desPos.z += cosY * (-0.06);
        desLook.set(
          car.x + sinY * 38 + rx * apexLook,
          car.y + 0.72 - (car.pitchRad || 0) * 14,
          car.z + cosY * 38 + rz * apexLook
        );
        desFov = 68 + Math.min(12, Math.max(0, kph - 160) * 0.065);
        camera.position.copy(desPos);
        camera.lookAt(desLook);
        camera.rotateZ((car.rollRad || 0) * 0.45);
      } else if (camMode === "tcam") {
        desPos.set(car.x - sinY * 0.48, car.y + 1.38 + kerbShake, car.z - cosY * 0.48);
        desLook.set(car.x + sinY * 40 + rx * apexLook * 0.6, car.y + 0.92 - (car.pitchRad || 0) * 10, car.z + cosY * 40 + rz * apexLook * 0.6);
        desFov = 66 + Math.min(11, Math.max(0, kph - 160) * 0.06);
        camera.position.copy(desPos);
        camera.lookAt(desLook);
      } else if (camMode === "nose") {
        desPos.set(car.x + sinY * 2.45, car.y + 0.56 + kerbShake, car.z + cosY * 2.45);
        desLook.set(car.x + sinY * 46, car.y + 0.46, car.z + cosY * 46);
        desFov = 74 + Math.min(12, Math.max(0, kph - 150) * 0.065);
        camera.position.copy(desPos);
        camera.lookAt(desLook);
      } else {
        // Smooth damped 3rd-person Chase Cam
        desPos.set(car.x - sinY * 8.4, car.y + 2.85, car.z - cosY * 8.4);
        desLook.set(car.x + sinY * 14, car.y + 1.05, car.z + cosY * 14);
        desFov = 58 + Math.min(12, Math.max(0, kph - 160) * 0.065);
        const alpha = camInit ? Math.min(1, (dt || 0.016) * 10.5) : 1;
        camPosSmooth.lerp(desPos, alpha);
        camLookSmooth.lerp(desLook, alpha);
        camera.position.copy(camPosSmooth);
        camera.lookAt(camLookSmooth);
      }

      camInit = true;
      if (Math.abs(camera.fov - desFov) > 0.15) {
        camera.fov += (desFov - camera.fov) * 0.18;
        camera.updateProjectionMatrix();
      }
    }

    function setCameraMode(mode) {
      if (CAM_MODES.includes(mode)) {
        camMode = mode;
        camInit = false;
      }
      return camMode;
    }

    function cycleCamera() {
      const next = CAM_MODES[(CAM_MODES.indexOf(camMode) + 1) % CAM_MODES.length];
      return setCameraMode(next);
    }

    function toggleHaloGhost() {
      haloGhost = !haloGhost;
      haloPillarMat.opacity = haloGhost ? 0.28 : 1.0;
      return haloGhost;
    }

    function setTeamColor(hex, hasHalo) {
      paintMat.color.set(hex || "#e10600");
      haloGroup.visible = Boolean(hasHalo);
    }

    function dispose() {
      scene.remove(root);
      oledTex.dispose();
    }

    return {
      root,
      update,
      setCameraMode,
      cycleCamera,
      getCameraMode: () => camMode,
      toggleHaloGhost,
      isHaloGhost: () => haloGhost,
      setTeamColor,
      dispose,
    };
  }

  global.F1DriveCockpit3D = { createCockpitAndCamera };
})(window);
