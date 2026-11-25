/**
 * Apex POV (/drive) — Interactive 3D Carbon-Weave Halo Cockpit, Visible Wing Damage,
 * Glowing Front Carbon Brake Discs, 60 Hz OLED Steering Wheel & 4-Camera Rig.
 */
(function (global) {
  "use strict";

  const COMPOUND_COLORS = {
    soft: 0xef4444, medium: 0xfacc15, hard: 0xf8fafc, inter: 0x22c55e, wet: 0x3b82f6,
  };

  function makeCarbonWeaveTex() {
    const cv = document.createElement("canvas");
    cv.width = 128; cv.height = 128;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#111620";
    ctx.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 8) {
      for (let x = 0; x < 128; x += 8) {
        const diag = ((x + y) / 8) % 2 === 0;
        ctx.fillStyle = diag ? "#1e2534" : "#141a25";
        ctx.fillRect(x, y, 4, 8);
        ctx.fillStyle = diag ? "#141a25" : "#263042";
        ctx.fillRect(x + 4, y, 4, 4);
      }
    }
    const tex = new global.THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = global.THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
    tex.colorSpace = global.THREE.SRGBColorSpace;
    return tex;
  }

  function tempToHex(t, opt) {
    if (t < opt - 14) return "#38bdf8";
    if (t > opt + 14) return "#ef4444";
    if (t > opt + 6) return "#f97316";
    return "#22c55e";
  }

  function createCockpitAndCamera(scene, teamColorHex, physicsDna) {
    const THREE = global.THREE;
    const root = new THREE.Group();
    scene.add(root);

    const carbonTex = makeCarbonWeaveTex();
    const teamCol = new THREE.Color(teamColorHex || "#e10600");
    const paintMat = new THREE.MeshStandardMaterial({ color: teamCol, roughness: 0.24, metalness: 0.44 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.30, metalness: 0.25 });
    const carbonMat = new THREE.MeshStandardMaterial({ map: carbonTex, roughness: 0.38, metalness: 0.36 });
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.85, metalness: 0.05 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x2b3342, roughness: 0.32, metalness: 0.78 });
    const ringMat = new THREE.MeshBasicMaterial({ color: COMPOUND_COLORS.soft });
    const brakeGlowMat = new THREE.MeshBasicMaterial({ color: 0x2a140c, transparent: true, opacity: 0.88 });
    const haloPillarMat = new THREE.MeshStandardMaterial({
      map: carbonTex, roughness: 0.35, metalness: 0.45, transparent: true, opacity: 1.0,
    });
    const mirrorLeftLed = new THREE.MeshBasicMaterial({ color: 0x0f172a });
    const mirrorRightLed = new THREE.MeshBasicMaterial({ color: 0x0f172a });

    // --- 1. First-Person Cockpit Assembly ---
    const fpGroup = new THREE.Group();
    root.add(fpGroup);

    const tub = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.46, 2.38), paintMat);
    tub.position.set(0, 0.38, 0.35);
    fpGroup.add(tub);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.24, 2.18), paintMat);
    nose.position.set(0, 0.36, 2.32);
    nose.rotation.x = 0.08;
    fpGroup.add(nose);

    const noseStripe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 2.05), accentMat);
    noseStripe.position.set(0, 0.485, 2.28);
    noseStripe.rotation.x = 0.08;
    fpGroup.add(noseStripe);

    const noseTip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.65), carbonMat);
    noseTip.position.set(0, 0.25, 3.45);
    fpGroup.add(noseTip);

    // Front wing mainplane + damageable left/right endplate flaps!
    const fWing = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.06, 0.46), carbonMat);
    fWing.position.set(0, 0.15, 3.45);
    fpGroup.add(fWing);
    const fFlapL = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.04, 0.24), paintMat);
    fFlapL.position.set(0.48, 0.21, 3.28);
    fFlapL.rotation.x = -0.22;
    fpGroup.add(fFlapL);
    const fFlapR = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.04, 0.24), paintMat);
    fFlapR.position.set(-0.48, 0.21, 3.28);
    fFlapR.rotation.x = -0.22;
    fpGroup.add(fFlapR);
    const endplateL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.56), paintMat);
    endplateL.position.set(0.98, 0.28, 3.38);
    fpGroup.add(endplateL);
    const endplateR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.56), paintMat);
    endplateR.position.set(-0.98, 0.28, 3.38);
    fpGroup.add(endplateR);

    // Carbon cockpit rim / headrest padding
    const leftCoaming = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.24, 1.38), carbonMat);
    leftCoaming.position.set(0.46, 0.64, 0.12);
    fpGroup.add(leftCoaming);
    const rightCoaming = leftCoaming.clone();
    rightCoaming.position.x = -0.46;
    fpGroup.add(rightCoaming);

    // Aerodynamic Side Mirrors with Proximity Blind-Spot LEDs
    [-1, 1].forEach((side) => {
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.06), carbonMat);
      stalk.position.set(side * 0.58, 0.72, 0.68);
      fpGroup.add(stalk);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.095, 0.12), paintMat);
      housing.position.set(side * 0.72, 0.75, 0.68);
      fpGroup.add(housing);
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.055, 0.02), side > 0 ? mirrorLeftLed : mirrorRightLed);
      led.position.set(side * 0.72, 0.75, 0.618);
      fpGroup.add(led);
    });

    // Steerable Front Wheels, Twin Wishbones & Glowing Carbon Brake Discs!
    const frontSteerPivots = [];
    const spinMeshes = [];
    [-1, 1].forEach((side) => {
      const wishU = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.035, 0.09), carbonMat);
      wishU.position.set(side * 0.56, 0.45, 1.85);
      fpGroup.add(wishU);
      const wishL = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.035, 0.09), carbonMat);
      wishL.position.set(side * 0.58, 0.24, 1.88);
      fpGroup.add(wishL);
      const pushrod = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.028, 0.03), carbonMat);
      pushrod.position.set(side * 0.55, 0.36, 1.72);
      pushrod.rotation.z = side * 0.32;
      fpGroup.add(pushrod);

      const pivot = new THREE.Group();
      pivot.position.set(side * 0.94, 0.36, 1.86);
      fpGroup.add(pivot);
      frontSteerPivots.push(pivot);

      const wheelGrp = new THREE.Group();
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.34, 22), tyreMat);
      tyre.rotation.z = Math.PI * 0.5;
      wheelGrp.add(tyre);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.35, 14), rimMat);
      rim.rotation.z = Math.PI * 0.5;
      wheelGrp.add(rim);
      // Inner Glowing Carbon Brake Disc visible to the driver on heavy braking!
      const brakeDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.185, 0.06, 16), brakeGlowMat);
      brakeDisc.rotation.z = Math.PI * 0.5;
      brakeDisc.position.x = -side * 0.16;
      wheelGrp.add(brakeDisc);

      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.022, 6, 22), ringMat);
      ring.rotation.y = Math.PI * 0.5;
      ring.position.x = -side * 0.176;
      wheelGrp.add(ring);
      const ringOut = ring.clone();
      ringOut.position.x = side * 0.176;
      wheelGrp.add(ringOut);

      pivot.add(wheelGrp);
      spinMeshes.push(wheelGrp);
    });

    // Authentic Carbon Halo
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
    [-1, 1].forEach((s) => {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.17, 10), tyreMat);
      grip.position.set(s * 0.145, 0, 0.008);
      wheelPivot.add(grip);
    });
    [
      [-0.085, -0.045, 0xef4444], [0, -0.052, 0xfacc15], [0.085, -0.045, 0x38bdf8],
      [-0.095, 0.045, 0x22c55e], [0.095, 0.045, 0xf97316],
    ].forEach(([kx, ky, col]) => {
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.018, 8), new THREE.MeshBasicMaterial({ color: col }));
      knob.rotation.x = Math.PI * 0.5;
      knob.position.set(kx, ky, -0.018);
      wheelPivot.add(knob);
    });
    const screenPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.188, 0.118),
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
    let haloGhost = true;
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

      // DRS / ERS / WARN badges
      oledCtx.font = "900 12px monospace";
      oledCtx.fillStyle = car.drsOpen ? "#22c55e" : (car.drsAvailable ? "#facc15" : "#334155");
      oledCtx.fillRect(10, 25, 50, 19);
      oledCtx.fillStyle = "#040811";
      oledCtx.textAlign = "center";
      oledCtx.fillText(car.xModeActive ? "X-MD" : "DRS", 35, 38);

      const warnLabel = car.puOverheat ? "PU HOT" : (car.frontWingHealth < 70 ? "WING!" : (car.pitLimiter ? "PIT" : "ERS"));
      oledCtx.fillStyle = (car.puOverheat || car.frontWingHealth < 70) ? "#ef4444" : (car.ersActive ? "#38bdf8" : "#1e293b");
      oledCtx.fillRect(194, 25, 52, 19);
      oledCtx.fillStyle = (car.ersActive || car.puOverheat || car.frontWingHealth < 70) ? "#040811" : "#94a3b8";
      oledCtx.fillText(warnLabel, 220, 38);

      // Giant Center Gear
      oledCtx.fillStyle = "#f8fafc";
      oledCtx.font = "900 60px sans-serif";
      oledCtx.fillText(String(car.gear || 1), 128, 90);

      // Speed KPH
      oledCtx.font = "800 18px monospace";
      oledCtx.fillStyle = "#38bdf8";
      oledCtx.textAlign = "left";
      oledCtx.fillText(`${Math.round(car.speedKph || 0)}`, 12, 82);
      oledCtx.font = "700 9px monospace";
      oledCtx.fillStyle = "#94a3b8";
      oledCtx.fillText("KPH", 12, 94);

      // Live Delta
      const dVal = Number(deltaS || 0);
      oledCtx.textAlign = "right";
      oledCtx.font = "800 15px monospace";
      oledCtx.fillStyle = dVal <= 0 ? "#4ade80" : "#f87171";
      oledCtx.fillText(`${dVal <= 0 ? "" : "+"}${dVal.toFixed(2)}`, 244, 82);
      oledCtx.font = "700 9px monospace";
      oledCtx.fillStyle = "#94a3b8";
      oledCtx.fillText("DELTA", 244, 94);

      // 4-Corner Tyre Thermal Blocks (miniature FL/FR/RL/RR indicators!)
      const c4 = car.tyreCore4 || [90, 90, 90, 90];
      const opt = 96;
      const boxCoords = [[12, 102], [28, 102], [12, 114], [28, 114]];
      for (let i = 0; i < 4; i++) {
        oledCtx.fillStyle = tempToHex(c4[i], opt);
        oledCtx.fillRect(boxCoords[i][0], boxCoords[i][1], 13, 9);
      }

      // ERS Battery Bar
      oledCtx.fillStyle = "#1e293b";
      oledCtx.fillRect(50, 110, 194, 10);
      oledCtx.fillStyle = car.ersActive ? "#38bdf8" : "#facc15";
      oledCtx.fillRect(50, 110, Math.round(194 * Math.max(0, Math.min(1, (car.ersBattery || 0) / 100))), 10);

      // Footer: Tyre, Brakes, Brake Bias
      oledCtx.textAlign = "left";
      oledCtx.font = "700 11px monospace";
      oledCtx.fillStyle = car.thermalCliff ? "#f87171" : "#cbd5e1";
      oledCtx.fillText(`TYR ${Math.round(car.tyreLife || 100)}% · BRK ${Math.round(car.brakeTemp || 350)}°`, 12, 146);
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

      // Dynamic Carbon Brake Disc Thermal Glow (500 C -> 1100 C crimson to incandescent orange!)
      const bNorm = Math.max(0, Math.min(1, ((car.brakeTemp || 300) - 460) / 560));
      if (bNorm > 0.04) {
        brakeGlowMat.color.setRGB(0.28 + bNorm * 0.72, bNorm * bNorm * 0.56, bNorm * bNorm * 0.14);
      } else {
        brakeGlowMat.color.setHex(0x1f242e);
      }

      // Visual Front-Wing Endplate Damage!
      const fwH = Number(car.frontWingHealth ?? 100);
      endplateR.visible = fwH > 45;
      endplateR.rotation.z = fwH < 78 ? (78 - fwH) * 0.012 : 0;
      fFlapR.rotation.z = fwH < 65 ? 0.14 : 0;
      endplateL.visible = fwH > 25;
      endplateL.rotation.z = fwH < 52 ? -(52 - fwH) * 0.011 : 0;

      // Blind-spot mirror LEDs
      mirrorLeftLed.color.setHex(proxLeft ? 0xf97316 : 0x0f172a);
      mirrorRightLed.color.setHex(proxRight ? 0xf97316 : 0x0f172a);

      // Position player chassis with 4-DOF pitch/roll/heave
      root.position.set(car.x, car.y + (car.heaveY || 0.04), car.z);
      root.rotation.order = "YXZ";
      root.rotation.y = car.yaw;
      root.rotation.x = car.pitchRad || 0;
      root.rotation.z = car.rollRad || 0;

      // Animate steering wheel & front wheels (incl. flat-spot micro-shudder!)
      const flatVib = (car.flatSpot || 0) * Math.sin((car.wheelSpin || 0) * 1.0) * Math.min(1, (car.speedKph || 0) / 140) * 0.055;
      wheelPivot.rotation.z = -(car.steerWheelRad || 0) + flatVib;
      for (let i = 0; i < frontSteerPivots.length; i++) {
        frontSteerPivots[i].rotation.y = -(car.frontSteerRad || 0);
        spinMeshes[i].rotation.x = car.wheelSpin || 0;
      }

      oledTick += (dt || 0.016);
      if (oledTick >= 0.045) {
        oledTick = 0;
        drawOled(car, deltaS);
      }

      const isChase = camMode === "chase";
      fpGroup.visible = !isChase;
      extGroup.visible = isChase;

      // Camera rig with kerb, gravel, flat-spot & impact vibration!
      const sinY = Math.sin(car.yaw);
      const cosY = Math.cos(car.yaw);
      const rx = -cosY;
      const rz = sinY;
      const kph = car.speedKph || 0;
      const vibAmp = (car.kerbIntensity || 0) * 0.045 + (car.gravelIntensity || 0) * 0.065 + Math.abs(flatVib) * 0.42 + (car.impactStrength || 0) * 0.14;
      const shakeY = (Math.random() - 0.5) * vibAmp;
      const shakeX = (Math.random() - 0.5) * vibAmp * 0.65;
      const apexLook = (car.frontSteerRad || 0) * 6.5;

      const desPos = new THREE.Vector3();
      const desLook = new THREE.Vector3();
      let desFov = 68;

      if (camMode === "cockpit") {
        desPos.set(car.x + rx * shakeX, car.y + 0.85 + shakeY, car.z + rz * shakeX);
        desPos.x += sinY * (-0.06);
        desPos.z += cosY * (-0.06);
        desLook.set(
          car.x + sinY * 38 + rx * apexLook,
          car.y + 0.72 - (car.pitchRad || 0) * 14,
          car.z + cosY * 38 + rz * apexLook
        );
        desFov = 68 + Math.min(13, Math.max(0, kph - 160) * 0.07);
        camera.position.copy(desPos);
        camera.lookAt(desLook);
        camera.rotateZ((car.rollRad || 0) * 0.45);
      } else if (camMode === "tcam") {
        desPos.set(car.x - sinY * 0.48, car.y + 1.38 + shakeY, car.z - cosY * 0.48);
        desLook.set(car.x + sinY * 40 + rx * apexLook * 0.6, car.y + 0.92 - (car.pitchRad || 0) * 10, car.z + cosY * 40 + rz * apexLook * 0.6);
        desFov = 66 + Math.min(12, Math.max(0, kph - 160) * 0.065);
        camera.position.copy(desPos);
        camera.lookAt(desLook);
      } else if (camMode === "nose") {
        desPos.set(car.x + sinY * 2.45, car.y + 0.56 + shakeY, car.z + cosY * 2.45);
        desLook.set(car.x + sinY * 46, car.y + 0.46, car.z + cosY * 46);
        desFov = 74 + Math.min(12, Math.max(0, kph - 150) * 0.065);
        camera.position.copy(desPos);
        camera.lookAt(desLook);
      } else {
        desPos.set(car.x - sinY * 8.4, car.y + 2.85 + shakeY * 0.5, car.z - cosY * 8.4);
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
      carbonTex.dispose();
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
