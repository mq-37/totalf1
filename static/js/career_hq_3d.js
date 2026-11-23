/**
 * Interactive 3D Team HQ Campus (/career Dashboard).
 * Replaces the static single-car plinth with 4 switchable, living 3D environments
 * that visibly evolve from Level 1 (Startup) -> Level 5 (Works Campus) as you invest:
 *   1. garage     : Dual-Car Race Garage (both liveried 3D F1 cars + animated mechanics)
 *   2. office     : Team Principal's Office (desk, telemetry wall, real 3D Trophy Cabinet!)
 *   3. windtunnel : R&D Aero Wind Tunnel (3D car on rolling belt + animated airflow streamlines + engineers)
 *   4. factory    : Powertrain & Carbon Factory (pulsing ERS dyno rig + autoclave + technicians)
 */
(function (global) {
  "use strict";

  function makeWorker(suitColor, helmetColor) {
    const g = new THREE.Group();
    const sMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(suitColor || "#1e293b"), roughness: 0.65 });
    const hMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(helmetColor || "#f8fafc"), roughness: 0.35 });
    const legGeo = new THREE.CylinderGeometry(0.09, 0.08, 0.72, 6);
    const lL = new THREE.Mesh(legGeo, sMat); lL.position.set(-0.11, 0.36, 0);
    const lR = new THREE.Mesh(legGeo, sMat); lR.position.set( 0.11, 0.36, 0);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.24), sMat);
    torso.position.set(0, 1.02, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), hMat);
    head.position.set(0, 1.50, 0);
    const armGeo = new THREE.CylinderGeometry(0.06, 0.055, 0.52, 6);
    const aL = new THREE.Mesh(armGeo, sMat); aL.position.set(-0.28, 1.0, 0.06); aL.rotation.x = -0.35;
    const aR = new THREE.Mesh(armGeo, sMat); aR.position.set( 0.28, 1.0, 0.06); aR.rotation.x = -0.35;
    g.add(lL, lR, torso, head, aL, aR);
    g.userData = { armL: aL, armR: aR, phase: Math.random() * Math.PI * 2 };
    return g;
  }

  function makeTrophyCup(isChampionship) {
    const g = new THREE.Group();
    const goldMat = new THREE.MeshStandardMaterial({
      color: isChampionship ? 0xfacc15 : 0xe2e8f0,
      roughness: 0.18,
      metalness: 0.92,
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.09, 10), new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 }));
    base.position.y = 0.045;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.16, 8), goldMat);
    stem.position.y = 0.16;
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.055, 0.22, 12), goldMat);
    cup.position.y = 0.34;
    g.add(base, stem, cup);
    if (isChampionship) g.scale.setScalar(1.35);
    return g;
  }

  function createHQ3DCampus(canvasEl, metaEl) {
    if (!global.THREE || !canvasEl) return null;
    const THREE = global.THREE;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: false });
    } catch (_) {
      return null;
    }
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 2.0, 0.1, 120);

    const st = {
      room: "garage",     // garage | office | windtunnel | factory
      key: "",
      raf: null,
      theta: 0.45,
      drag: false,
      lastX: 0,
      roomGroup: null,
      workers: [],
      streamlines: [],
      dynCore: null,
      t: 0,
      lastW: 0,
      lastH: 0,
      lastOpts: null,
    };

    // Mouse-drag horizontal orbit so the user can inspect every corner of their 3D HQ!
    canvasEl.addEventListener("pointerdown", (ev) => { st.drag = true; st.lastX = ev.clientX; });
    global.addEventListener("pointerup", () => { st.drag = false; });
    canvasEl.addEventListener("pointermove", (ev) => {
      if (!st.drag) return;
      const dx = ev.clientX - st.lastX;
      st.lastX = ev.clientX;
      st.theta += dx * 0.009;
    });

    function disposeRoom() {
      if (!st.roomGroup) return;
      st.roomGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      scene.remove(st.roomGroup);
      st.roomGroup = null;
      st.workers = [];
      st.streamlines = [];
      st.dynCore = null;
    }

    function buildRoom(opts) {
      disposeRoom();
      const { palette, style, era, facilities, wins, championships, teamName } = opts;
      const pal = palette || { main: "#e10600", secondary: "#111622", accent: "#facc15", pop: "#ffffff", detail: "#262c36" };
      const mainCol = new THREE.Color(pal.main || "#e10600");
      const accCol = new THREE.Color(pal.accent || "#38bdf8");
      const facs = facilities || {};
      const wtLvl = facs.wind_tunnel || facs.aero_tunnel || 1;
      const pwrLvl = facs.powertrain_lab || facs.chassis_fac || 1;
      const pitLvl = facs.pit_sim || 1;
      const facVals = Object.values(facs).map((v) => Number(v || 1)).filter((v) => v > 0);
      const avgLvl = Math.max(1, Math.min(5, Math.round(facVals.length ? facVals.reduce((a, b) => a + b, 0) / facVals.length : 1)));
      const roomLvl = st.room === "windtunnel" ? wtLvl
        : (st.room === "factory" ? pwrLvl
          : (st.room === "garage" ? pitLvl : avgLvl));

      const grp = new THREE.Group();
      st.roomGroup = grp;
      scene.add(grp);

      // Facility Level 1 -> Level 5 Architectural Evolution!
      const isElite = roomLvl >= 4;
      const isMid = roomLvl >= 2;
      const bgHex = isElite ? 0x0b1528 : (isMid ? 0x101827 : 0x18171c);
      scene.background = new THREE.Color(bgHex);
      scene.fog = new THREE.FogExp2(bgHex, 0.022);

      // Lighting scales with Facility Level (dim tungsten L1 -> crisp bright LED Works Campus L5!)
      const amb = new THREE.HemisphereLight(isElite ? 0xe0f2fe : 0xdbeafe, 0x1e293b, 0.75 + roomLvl * 0.14);
      grp.add(amb);
      const keyL = new THREE.DirectionalLight(isElite ? 0xffffff : 0xfff1d6, 1.05 + roomLvl * 0.18);
      keyL.position.set(7, 11, 8);
      grp.add(keyL);
      const rimL = new THREE.PointLight(mainCol, 1.4 + roomLvl * 0.25, 24);
      rimL.position.set(-6, 4.5, -4);
      grp.add(rimL);

      // Architectural Floor & Back Wall (concrete L1 -> polished epoxy L3 -> gleaming futuristic white/glass L5!)
      const floorCol = isElite ? 0x1c273b : (isMid ? 0x161f2e : 0x222026);
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(28, 22),
        new THREE.MeshStandardMaterial({ color: floorCol, roughness: isElite ? 0.18 : 0.65, metalness: isElite ? 0.45 : 0.12 })
      );
      floor.rotation.x = -Math.PI * 0.5;
      grp.add(floor);

      const wallCol = isElite ? 0x162238 : (isMid ? 0x1c2536 : 0x2a2730);
      const backWall = new THREE.Mesh(
        new THREE.BoxGeometry(22, 6.5, 0.4),
        new THREE.MeshStandardMaterial({ color: wallCol, roughness: isElite ? 0.35 : 0.8 })
      );
      backWall.position.set(0, 3.25, -6.2);
      grp.add(backWall);

      // Glowing Team Accent LED Strip along back wall (brighter & wider at higher Facility Levels!)
      const ledStrip = new THREE.Mesh(
        new THREE.BoxGeometry(10 + roomLvl * 2.2, 0.18, 0.48),
        new THREE.MeshBasicMaterial({ color: mainCol })
      );
      ledStrip.position.set(0, 4.8, -6.15);
      grp.add(ledStrip);

      // Overhead LED Ceiling Light Bars (Level 2+)
      const barCnt = roomLvl;
      for (let b = 0; b < barCnt; b++) {
        const bx = -5 + (b / Math.max(1, barCnt - 1 || 1)) * 10;
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(1.1, 0.08, 7.5),
          new THREE.MeshBasicMaterial({ color: isElite ? 0xe0f2fe : 0xfef3c7 })
        );
        bar.position.set(barCnt === 1 ? 0 : bx, 5.8, -0.5);
        grp.add(bar);
      }

      const F1C = global.F1Car3D;
      const workerCount = 2 + roomLvl * 2;

      if (st.room === "garage") {
        // Dual-Car Race Garage: BOTH team 3D F1 cars side-by-side + pit gantries + tyre racks + mechanics!
        [-2.35, 2.35].forEach((cx, ci) => {
          const pad = new THREE.Mesh(
            new THREE.BoxGeometry(3.2, 0.06, 6.2),
            new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.4 })
          );
          pad.position.set(cx, 0.03, 0.3);
          grp.add(pad);
          const trim = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.07, 0.12), new THREE.MeshBasicMaterial({ color: ci === 0 ? mainCol : accCol }));
          trim.position.set(cx, 0.04, 3.4);
          grp.add(trim);

          if (F1C && F1C.createCar) {
            const car = F1C.createCar(pal, style || "two-tone", era || "2020s");
            car.position.set(cx, 0.06, 0.3);
            car.scale.setScalar(0.82);
            grp.add(car);
          }
          // Overhead gantry arm
          const gant = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.16, 0.25), new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.6 }));
          gant.position.set(cx, 3.8, 0.8);
          grp.add(gant);
        });
        // Tyre blanket stacks
        const tyreMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 });
        for (let t = 0; t < 4; t++) {
          const ty = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.28, 12), tyreMat);
          ty.position.set(-5.8, 0.14 + t * 0.29, -3.5);
          grp.add(ty);
        }
        // Mechanics working around both cars
        const spots = [[-3.9, 1.2, 1.3], [-0.8, 0.6, -1.4], [0.8, -0.5, 1.5], [3.9, 0.9, -1.3], [-3.8, -1.5, 1.2], [3.8, -1.5, -1.2], [0, -3.2, 0], [-5.2, 0.2, 1.1]];
        for (let w = 0; w < Math.min(workerCount, spots.length); w++) {
          const [wx, wz, rot] = spots[w];
          const mk = makeWorker(pal.main, "#f8fafc");
          mk.position.set(wx, 0, wz);
          mk.rotation.y = rot;
          grp.add(mk);
          st.workers.push({ mesh: mk, baseX: wx, baseZ: wz, radius: 0.18 });
        }
      } else if (st.room === "office") {
        // Principal's Executive Office: Desk, Panoramic Telemetry Wall, Model Car & REAL 3D Trophy Cabinet!
        const desk = new THREE.Mesh(
          new THREE.BoxGeometry(3.6, 0.9, 1.4),
          new THREE.MeshStandardMaterial({ color: isElite ? 0xf8fafc : 0x3b2a1e, roughness: isElite ? 0.2 : 0.65, metalness: isElite ? 0.3 : 0.1 })
        );
        desk.position.set(0, 0.45, 0.8);
        grp.add(desk);
        // Executive chair behind desk
        const chair = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.35, 0.7), new THREE.MeshStandardMaterial({ color: mainCol, roughness: 0.5 }));
        chair.position.set(0, 0.7, -0.35);
        grp.add(chair);
        // Dual desktop monitors
        [-0.7, 0.7].forEach((mx) => {
          const mon = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.52, 0.06), new THREE.MeshBasicMaterial({ color: 0x0ea5e9 }));
          mon.position.set(mx, 1.22, 0.55);
          grp.add(mon);
        });
        // Scale 3D F1 car trophy centerpiece on side table
        if (F1C && F1C.createCar) {
          const mini = F1C.createCar(pal, style || "two-tone", era || "2020s");
          mini.scale.setScalar(0.38);
          mini.position.set(-4.2, 0.85, -1.2);
          mini.rotation.y = 0.55;
          grp.add(mini);
          const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.82, 24), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35 }));
          ped.position.set(-4.2, 0.41, -1.2);
          grp.add(ped);
        }
        // Real 3D Trophy Cabinet populated by won Grand Prix & Championship Trophies!
        const cab = new THREE.Mesh(
          new THREE.BoxGeometry(4.6, 3.2, 0.9),
          new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3, metalness: 0.4 })
        );
        cab.position.set(3.8, 1.6, -5.3);
        grp.add(cab);
        const totalCups = Math.max(1, Math.min(12, Number(wins || 0) + Number(championships || 0) * 2));
        for (let t = 0; t < totalCups; t++) {
          const isChamp = t < Number(championships || 0);
          const cup = makeTrophyCup(isChamp);
          const row = Math.floor(t / 6);
          const col = t % 6;
          cup.position.set(2.0 + col * 0.72, 1.05 + row * 1.1, -4.95);
          grp.add(cup);
        }
        // Strategy Wall Displays
        for (let s = 0; s < Math.min(4, 1 + roomLvl); s++) {
          const scr = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.25, 0.08), new THREE.MeshBasicMaterial({ color: s % 2 === 0 ? 0x0284c7 : 0x1e293b }));
          scr.position.set(-4.6 + s * 2.35, 3.1, -5.92);
          grp.add(scr);
        }
        // Advisors & Principal staff
        for (let w = 0; w < Math.min(5, Math.ceil(workerCount * 0.6)); w++) {
          const wx = -2.4 + w * 1.4;
          const mk = makeWorker(w === 0 ? pal.main : "#334155", "#fde68a");
          mk.position.set(wx, 0, -2.8 - (w % 2) * 0.8);
          grp.add(mk);
          st.workers.push({ mesh: mk, baseX: wx, baseZ: -2.8 - (w % 2) * 0.8, radius: 0.25 });
        }
      } else if (st.room === "windtunnel") {
        // R&D Aero Wind Tunnel: 3D Car on rolling belt + ribbed turbine tunnel + live animated streamlines!
        const belt = new THREE.Mesh(
          new THREE.BoxGeometry(3.4, 0.14, 7.6),
          new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.6 })
        );
        belt.position.set(0, 0.07, 0);
        grp.add(belt);
        if (F1C && F1C.createCar) {
          const car = F1C.createCar(pal, style || "two-tone", era || "2020s");
          car.position.set(0, 0.14, 0);
          car.scale.setScalar(0.95);
          grp.add(car);
        }
        // Ribbed Aero Tunnel Arches
        const archMat = new THREE.MeshStandardMaterial({ color: isElite ? 0x38bdf8 : 0x475569, roughness: 0.35, metalness: 0.7 });
        for (let a = -3; a <= 3; a++) {
          const arch = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.16, 8, 28, Math.PI), archMat);
          arch.position.set(0, 0, a * 1.85);
          grp.add(arch);
        }
        // Animated Laminar Airflow Streamline Ribbons sweeping over the car!
        const lineCount = 5 + roomLvl * 2;
        for (let l = 0; l < lineCount; l++) {
          const lx = -1.35 + (l / Math.max(1, lineCount - 1)) * 2.7;
          const pts = [];
          for (let k = 0; k <= 24; k++) {
            const z = 4.2 - (k / 24) * 8.4;
            const overCar = Math.exp(-(z * z) / 5.5);
            const y = 0.55 + (l % 3) * 0.32 + overCar * 0.95;
            pts.push(new THREE.Vector3(lx, y, z));
          }
          const curve = new THREE.CatmullRomCurve3(pts);
          const tube = new THREE.Mesh(
            new THREE.TubeGeometry(curve, 24, 0.035, 6, false),
            new THREE.MeshBasicMaterial({ color: l % 2 === 0 ? 0x38bdf8 : 0xe879f9, transparent: true, opacity: 0.78 })
          );
          grp.add(tube);
          st.streamlines.push({ mesh: tube, phase: l * 0.6 });
        }
        // Aero Engineers behind observation glass
        for (let w = 0; w < Math.min(6, Math.ceil(workerCount * 0.6)); w++) {
          const wx = 4.8;
          const wz = -2.6 + w * 1.1;
          const mk = makeWorker("#0f172a", "#38bdf8");
          mk.position.set(wx, 0, wz);
          mk.rotation.y = -Math.PI * 0.5;
          grp.add(mk);
          st.workers.push({ mesh: mk, baseX: wx, baseZ: wz, radius: 0.14 });
        }
      } else {
        // Powertrain & Carbon Factory: Glowing ERS Dyno Core + Chassis Autoclave + Technicians!
        const dynoBase = new THREE.Mesh(
          new THREE.CylinderGeometry(1.8, 2.1, 0.6, 20),
          new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.75 })
        );
        dynoBase.position.set(-1.6, 0.3, 0);
        grp.add(dynoBase);
        const core = new THREE.Mesh(
          new THREE.CylinderGeometry(0.95, 0.95, 1.8, 16),
          new THREE.MeshStandardMaterial({ color: 0x0284c7, emissive: 0x0ea5e9, emissiveIntensity: 0.9 + roomLvl * 0.2, roughness: 0.2, metalness: 0.8 })
        );
        core.position.set(-1.6, 1.45, 0);
        grp.add(core);
        st.dynCore = core;

        // Carbon Autoclave Cylinder
        const auto = new THREE.Mesh(
          new THREE.CylinderGeometry(1.15, 1.15, 4.2, 18),
          new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.3, metalness: 0.85 })
        );
        auto.rotation.z = Math.PI * 0.5;
        auto.position.set(2.8, 1.35, -1.4);
        grp.add(auto);

        // Partial Chassis Tub on Assembly Jig
        if (F1C && F1C.createCar) {
          const car = F1C.createCar(pal, style || "two-tone", era || "2020s");
          car.scale.setScalar(0.75);
          car.position.set(2.5, 0.12, 1.8);
          car.rotation.y = -0.35;
          grp.add(car);
        }
        for (let w = 0; w < Math.min(8, workerCount); w++) {
          const ang = (w / Math.min(8, workerCount)) * Math.PI * 2;
          const wx = Math.cos(ang) * 4.1;
          const wz = Math.sin(ang) * 2.8;
          const mk = makeWorker(pal.main, "#facc15");
          mk.position.set(wx, 0, wz);
          mk.rotation.y = Math.atan2(-wx, -wz);
          grp.add(mk);
          st.workers.push({ mesh: mk, baseX: wx, baseZ: wz, radius: 0.22 });
        }
      }

      if (metaEl) {
        const names = { garage: "Race Garage", office: "Principal's Office", windtunnel: "R&D Wind Tunnel", factory: "Powertrain Factory" };
        const tierName = roomLvl >= 5 ? "Works Elite Campus" : (roomLvl >= 3 ? "Championship Facility" : "Startup Wing");
        metaEl.textContent = `${names[st.room]} · Lvl ${roomLvl}/5 (${tierName}) · ${st.workers.length} Staff Active`;
      }
    }

    function startLoop() {
      if (st.raf) return;
      const tick = () => {
        st.raf = requestAnimationFrame(tick);
        const w = canvasEl.clientWidth || 380;
        const h = canvasEl.clientHeight || 200;
        if (w < 20 || h < 20) return;
        if (w !== st.lastW || h !== st.lastH) {
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          st.lastW = w;
          st.lastH = h;
        }
        st.t += 0.016;
        if (!st.drag) st.theta += 0.0028;

        // Animate staff workers, aero streamlines & ERS dyno pulse
        st.workers.forEach((wk) => {
          const ph = wk.mesh.userData.phase + st.t * 2.4;
          wk.mesh.position.x = wk.baseX + Math.sin(ph * 0.5) * wk.radius;
          wk.mesh.position.z = wk.baseZ + Math.cos(ph * 0.4) * wk.radius;
          if (wk.mesh.userData.armL) wk.mesh.userData.armL.rotation.x = -0.35 + Math.sin(ph) * 0.28;
          if (wk.mesh.userData.armR) wk.mesh.userData.armR.rotation.x = -0.35 - Math.sin(ph) * 0.28;
        });
        st.streamlines.forEach((sl) => {
          sl.mesh.material.opacity = 0.45 + 0.4 * Math.sin(st.t * 5.0 + sl.phase);
        });
        if (st.dynCore) {
          st.dynCore.rotation.y += 0.03;
          st.dynCore.material.emissiveIntensity = 0.85 + Math.sin(st.t * 4.5) * 0.35;
        }

        const rad = st.room === "garage" ? 10.2 : (st.room === "office" ? 8.8 : 9.4);
        const camY = st.room === "office" ? 3.2 : 3.8;
        camera.position.set(Math.sin(st.theta) * rad, camY, Math.cos(st.theta) * rad);
        camera.lookAt(0, 1.15, -0.4);
        renderer.render(scene, camera);
      };
      st.raf = requestAnimationFrame(tick);
    }

    function stopLoop() {
      if (st.raf) { cancelAnimationFrame(st.raf); st.raf = null; }
    }

    return {
      setRoom(roomName) {
        if (!["garage", "office", "windtunnel", "factory"].includes(roomName)) return;
        st.room = roomName;
        st.key = "";
        if (st.lastOpts) buildRoom(st.lastOpts);
      },
      getRoom() { return st.room; },
      sync(opts) {
        st.lastOpts = opts;
        const newKey = `${st.room}|${JSON.stringify(opts.palette)}|${opts.style}|${opts.era}|${JSON.stringify(opts.facilities)}|${opts.wins}|${opts.championships}`;
        if (st.key !== newKey) {
          buildRoom(opts);
          st.key = newKey;
        }
        startLoop();
      },
      stop: stopLoop,
      dispose() {
        stopLoop();
        disposeRoom();
        renderer.dispose();
      },
    };
  }

  global.CareerHQ3D = { createHQ3DCampus };
})(window);
