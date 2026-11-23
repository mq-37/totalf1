/**
 * Live 3D Broadcast Camera Engine (/sim & /career).
 * Extrudes ANY of the 79 historical/modern F1 circuits into a 3D Three.js environment
 * with per-track 3D Pit Buildings, animated 3D Pit Crew, biome lighting, and 5 TV cameras:
 *   - pov      : Onboard Halo T-Cam POV
 *   - chase    : 3rd Person Chase Cam
 *   - tv       : Off-Side Trackside TV Broadcast Cameras (auto-panning & sector cuts)
 *   - pitlane  : Pitlane & Pit Crew Broadcast Cam
 *   - director : Auto 3D Broadcast Director
 */
(function (global) {
  "use strict";

  const BIOME_THEMES = {
    parkland:     { sky: 0x3b82c4, fog: 0x5c94c8, ground: 0x244627, sun: 0xfff4d6, amb: 0x7ca2c9, sunInt: 1.55, isNight: false },
    harbour:      { sky: 0x2f7ec4, fog: 0x5897cf, ground: 0x2a3b47, sun: 0xfff2d2, amb: 0x7ba4cc, sunInt: 1.60, isNight: false, water: 0x0c4a6e },
    coastal:      { sky: 0x3988cc, fog: 0x62a0d6, ground: 0x3b4d37, sun: 0xfff5db, amb: 0x82a8cf, sunInt: 1.65, isNight: false, water: 0x0369a1 },
    street:       { sky: 0x366ea6, fog: 0x4f7ca8, ground: 0x292f3a, sun: 0xfff0cc, amb: 0x788da8, sunInt: 1.45, isNight: false },
    desert:       { sky: 0x6aa3d8, fog: 0xb89e7d, ground: 0x9c7b54, sun: 0xffe8b8, amb: 0xa6947c, sunInt: 1.75, isNight: false },
    night_desert: { sky: 0x070d1c, fog: 0x0c162c, ground: 0x1e1d26, sun: 0x93c5fd, amb: 0x334155, sunInt: 0.95, isNight: true },
    night_street: { sky: 0x060b18, fog: 0x0b1529, ground: 0x161c28, sun: 0xbfdbfe, amb: 0x334155, sunInt: 0.95, isNight: true },
  };

  function getTheme(circuit) {
    if (circuit && circuit.is_night) {
      return circuit.biome && circuit.biome.includes("desert") ? BIOME_THEMES.night_desert : BIOME_THEMES.night_street;
    }
    const b = (circuit && circuit.biome) || "parkland";
    return BIOME_THEMES[b] || BIOME_THEMES.parkland;
  }

  /**
   * Build a Three.js upward-facing (+Y) ribbon BufferGeometry from sampled 3D centerline points.
   * Uses verified upward winding (b, b+1, b+2, b+1, b+3, b+2) with DoubleSide safety.
   */
  function buildRibbonGeo(pts, leftOff, rightOff, yElev, closed) {
    const n = pts.length;
    const count = closed ? n + 1 : n;
    const positions = new Float32Array(count * 2 * 3);
    const uvs = new Float32Array(count * 2 * 2);
    const indices = [];

    let dist = 0;
    for (let i = 0; i < count; i++) {
      const p = pts[i % n];
      if (i > 0) {
        const prev = pts[(i - 1) % n];
        dist += Math.hypot(p.x - prev.x, p.z - prev.z);
      }
      // Right vector = cross(tan, up) = (-tz, 0, tx) when tan=(tx, 0, tz) and up=(0,1,0)
      const rx = -p.tz;
      const rz = p.tx;
      const lx = p.x + rx * leftOff;
      const lz = p.z + rz * leftOff;
      const rxp = p.x + rx * rightOff;
      const rzp = p.z + rz * rightOff;

      const vi = i * 6;
      positions[vi]     = lx;  positions[vi + 1] = yElev; positions[vi + 2] = lz;
      positions[vi + 3] = rxp; positions[vi + 4] = yElev; positions[vi + 5] = rzp;

      const ui = i * 4;
      uvs[ui]     = 0; uvs[ui + 1] = dist * 0.08;
      uvs[ui + 2] = 1; uvs[ui + 3] = dist * 0.08;

      if (i < count - 1) {
        const b = i * 2;
        indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  function makeAsphaltTexture() {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 256;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#262b34";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3200; i++) {
      const v = 30 + Math.floor(Math.random() * 24);
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    // Crisp white track edge lines
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(10, 0, 5, 256);
    ctx.fillRect(241, 0, 5, 256);
    // Subtle dark rubbered racing groove
    ctx.fillStyle = "rgba(10,12,18,0.22)";
    ctx.fillRect(72, 0, 32, 256);
    ctx.fillRect(152, 0, 32, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 24);
    return tex;
  }

  function makeKerbTexture() {
    const cv = document.createElement("canvas");
    cv.width = 64; cv.height = 128;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#dc2626"; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#f8fafc"; ctx.fillRect(0, 64, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 45);
    return tex;
  }

  function makeLiteCarMesh(colorHex) {
    const grp = new THREE.Group();
    const col = new THREE.Color(colorHex || "#e10600");
    const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.45 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x141923, roughness: 0.6, metalness: 0.2 });

    // Main chassis & nose
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.52, 4.7), bodyMat);
    body.position.set(0, 0.42, 0);
    grp.add(body);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.28, 1.35), bodyMat);
    nose.position.set(0, 0.34, 2.75);
    grp.add(nose);

    // Front & Rear Wings
    const fw = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.14, 0.55), bodyMat);
    fw.position.set(0, 0.22, 3.25);
    grp.add(fw);

    const rw = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.48, 0.42), darkMat);
    rw.position.set(0, 0.92, -2.15);
    grp.add(rw);

    // 4 tyres
    const wGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.40, 12);
    wGeo.rotateZ(Math.PI * 0.5);
    [[-0.95, 0.36, 1.85], [0.95, 0.36, 1.85], [-0.98, 0.36, -1.55], [0.98, 0.36, -1.55]].forEach(([x, y, z]) => {
      const w = new THREE.Mesh(wGeo, darkMat);
      w.position.set(x, y, z);
      grp.add(w);
    });

    // Cockpit halo hoop
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.055, 6, 14, Math.PI), darkMat);
    halo.rotation.x = Math.PI * 0.5;
    halo.position.set(0, 0.78, 0.35);
    grp.add(halo);
    return grp;
  }

  function createBroadcast3D(canvasEl, hudEl) {
    if (!global.THREE || !canvasEl) return null;
    const THREE = global.THREE;

    const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.25, 4500);

    const state = {
      active: false,
      mode: "tv",        // pov | chase | tv | pitlane | director
      directorSub: "tv",
      directorTimer: 0,
      circuitId: "",
      trackPts: [],
      pitPts: [],
      pitSide: 1,
      tvCams: [],
      activeTvIdx: 0,
      worldGroup: null,
      carMeshes: new Map(), // carIdx -> { group, isHero, color }
      pitCrewGroup: null,
      camPosSmooth: new THREE.Vector3(),
      camLookSmooth: new THREE.Vector3(),
      camInit: false,
      asphaltTex: makeAsphaltTexture(),
      kerbTex: makeKerbTexture(),
      lastCars: [],
    };

    function disposeWorld() {
      if (state.worldGroup) {
        state.worldGroup.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
            else obj.material.dispose();
          }
        });
        scene.remove(state.worldGroup);
        state.worldGroup = null;
      }
      state.carMeshes.forEach((entry) => {
        if (global.F1Car3D && global.F1Car3D.disposeObject) global.F1Car3D.disposeObject(entry.group);
        scene.remove(entry.group);
      });
      state.carMeshes.clear();
      state.camInit = false;
    }

    function buildCircuit3D(circuit) {
      if (!circuit || !Array.isArray(circuit.points) || circuit.points.length < 10) return;
      if (state.circuitId === circuit.id && state.worldGroup) return;
      disposeWorld();
      state.circuitId = circuit.id;

      const theme = getTheme(circuit);
      scene.background = new THREE.Color(theme.sky);
      scene.fog = new THREE.FogExp2(theme.fog, theme.isNight ? 0.00075 : 0.00042);

      const grp = new THREE.Group();
      state.worldGroup = grp;
      scene.add(grp);

      // Lighting
      const amb = new THREE.HemisphereLight(theme.sky, theme.ground, theme.isNight ? 0.85 : 1.05);
      grp.add(amb);
      const sun = new THREE.DirectionalLight(theme.sun, theme.sunInt);
      sun.position.set(180, 320, 140);
      grp.add(sun);

      // Build 3D centerline scaled cleanly to real track length (clamped for visual majesty)
      const raw = circuit.points;
      let perim = 0;
      for (let i = 0; i < raw.length; i++) {
        const a = raw[i], b = raw[(i + 1) % raw.length];
        perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      const targetPerimM = Math.max(2400, Math.min(5800, (circuit.length_km || 5.0) * 680));
      const scale = targetPerimM / Math.max(10, perim);

      let cx = 0, cz = 0;
      raw.forEach(([x, y]) => { cx += x; cz += y; });
      cx /= raw.length; cz /= raw.length;

      // Densify 120 -> 240 points for butter-smooth 3D asphalt curves
      const pts = [];
      const nRaw = raw.length;
      for (let i = 0; i < nRaw; i++) {
        const a = raw[i], b = raw[(i + 1) % nRaw];
        for (let k = 0; k < 2; k++) {
          const t = k * 0.5;
          pts.push({
            x: ((a[0] + (b[0] - a[0]) * t) - cx) * scale,
            z: ((a[1] + (b[1] - a[1]) * t) - cz) * scale,
            tx: 1, tz: 0,
          });
        }
      }
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const prev = pts[(i - 1 + n) % n];
        const next = pts[(i + 1) % n];
        const dx = next.x - prev.x, dz = next.z - prev.z;
        const len = Math.max(1e-5, Math.hypot(dx, dz));
        pts[i].tx = dx / len;
        pts[i].tz = dz / len;
      }
      state.trackPts = pts;

      // Ground & Water planes
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(9000, 9000),
        new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 0.96, metalness: 0.02 })
      );
      ground.rotation.x = -Math.PI * 0.5;
      ground.position.y = -0.25;
      grp.add(ground);

      if (theme.water) {
        const water = new THREE.Mesh(
          new THREE.PlaneGeometry(5500, 5500),
          new THREE.MeshStandardMaterial({ color: theme.water, roughness: 0.18, metalness: 0.55 })
        );
        water.rotation.x = -Math.PI * 0.5;
        water.position.set(1600, -0.18, 1200);
        grp.add(water);
      }

      // Track Asphalt, Red/White Apex Kerbs, Runoff & Safety Barriers
      const roadMesh = new THREE.Mesh(
        buildRibbonGeo(pts, -7.2, 7.2, 0.04, true),
        new THREE.MeshStandardMaterial({ map: state.asphaltTex, roughness: 0.78, metalness: 0.08, side: THREE.DoubleSide })
      );
      grp.add(roadMesh);

      const kerbMat = new THREE.MeshStandardMaterial({ map: state.kerbTex, roughness: 0.65, side: THREE.DoubleSide });
      grp.add(new THREE.Mesh(buildRibbonGeo(pts, -8.5, -7.1, 0.06, true), kerbMat));
      grp.add(new THREE.Mesh(buildRibbonGeo(pts, 7.1, 8.5, 0.06, true), kerbMat));

      const wallMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide });
      // Low barrier strip left & right
      const buildWall = (offset) => {
        const count = n + 1;
        const pos = new Float32Array(count * 2 * 3);
        const idx = [];
        for (let i = 0; i < count; i++) {
          const p = pts[i % n];
          const rx = -p.tz, rz = p.tx;
          const wx = p.x + rx * offset, wz = p.z + rz * offset;
          const vi = i * 6;
          pos[vi] = wx; pos[vi + 1] = 0.0; pos[vi + 2] = wz;
          pos[vi + 3] = wx; pos[vi + 4] = 1.25; pos[vi + 5] = wz;
          if (i < count - 1) {
            const b = i * 2;
            idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        return new THREE.Mesh(g, wallMat);
      };
      grp.add(buildWall(-14.5));
      grp.add(buildWall(14.5));

      // Pit Lane Bypass + Per-Track 3D Pit Building & Animated Pit Crew!
      const p0 = pts[0];
      const rx0 = -p0.tz, rz0 = p0.tx;
      const toCenter = (-p0.x) * rx0 + (-p0.z) * rz0;
      const pitSide = toCenter >= 0 ? 1 : -1;
      state.pitSide = pitSide;

      const pitPts = [];
      const pitSpan = 0.085;
      for (let i = 0; i <= 44; i++) {
        const u = i / 44;
        const prog = ((1 - pitSpan + u * pitSpan * 2) % 1 + 1) % 1;
        const sp = sample3DTrack(prog);
        const off = pitSide * (19.5 * Math.pow(Math.sin(u * Math.PI), 0.65));
        const rvx = -sp.tz, rvz = sp.tx;
        pitPts.push({ x: sp.x + rvx * off, z: sp.z + rvz * off, tx: sp.tx, tz: sp.tz });
      }
      state.pitPts = pitPts;

      const pitRoad = new THREE.Mesh(
        buildRibbonGeo(pitPts, -4.2, 4.2, 0.05, false),
        new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.72, side: THREE.DoubleSide })
      );
      grp.add(pitRoad);

      // Start/Finish Gantry + Per-Track Pit Building + Main Grandstand aligned to S/F straight
      const sfGroup = new THREE.Group();
      sfGroup.position.set(p0.x, 0, p0.z);
      sfGroup.rotation.y = Math.atan2(p0.tx, p0.tz);
      grp.add(sfGroup);

      // FIA Overhead Start Gantry
      const gantryMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.6 });
      const legL = new THREE.Mesh(new THREE.BoxGeometry(0.9, 8.5, 0.9), gantryMat); legL.position.set(-9.5, 4.25, 0); sfGroup.add(legL);
      const legR = new THREE.Mesh(new THREE.BoxGeometry(0.9, 8.5, 0.9), gantryMat); legR.position.set(9.5, 4.25, 0); sfGroup.add(legR);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(20.2, 1.4, 1.6), gantryMat); beam.position.set(0, 8.0, 0); sfGroup.add(beam);
      const redGlow = new THREE.MeshBasicMaterial({ color: 0xef4444 });
      for (let li = -2; li <= 2; li++) {
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), redGlow);
        bulb.position.set(li * 1.4, 7.6, -0.85);
        sfGroup.add(bulb);
      }

      // Architectural 3D Pit Building (varies by circuit.pit_building!)
      const pStyle = circuit.pit_building || "modern_glass";
      const pitX = -pitSide * 30;
      const bldgColor = pStyle === "vintage_wood" ? 0x5c3d24
        : (pStyle === "classic_brick" ? 0x6b2f2f
          : (pStyle === "desert_wing" ? 0xe2e8f0
            : (pStyle === "street_canopy" ? 0x1e293b : 0x162033)));
      const bldgH = pStyle === "vintage_wood" ? 5.5 : (pStyle === "desert_wing" ? 11.5 : 9.8);
      const bldg = new THREE.Mesh(
        new THREE.BoxGeometry(11, bldgH, 130),
        new THREE.MeshStandardMaterial({ color: bldgColor, roughness: pStyle === "modern_glass" ? 0.25 : 0.72, metalness: pStyle === "modern_glass" ? 0.6 : 0.15 })
      );
      bldg.position.set(pitX, bldgH * 0.5, 0);
      sfGroup.add(bldg);

      // Paddock Club Glass Roof Ribbon / Canopy
      const canopyCol = pStyle === "desert_wing" ? 0xf8fafc : (pStyle === "vintage_wood" ? 0x92400e : 0x38bdf8);
      const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(15.5, 0.7, 136),
        new THREE.MeshStandardMaterial({ color: canopyCol, roughness: 0.25, metalness: 0.45 })
      );
      canopy.position.set(pitX + pitSide * 2.2, bldgH + 0.35, 0);
      sfGroup.add(canopy);

      // 10 Illuminated Team Garage Bays along the Pit Building front
      const bayCols = [0xe10600, 0xff8700, 0x00d2be, 0x1e41ff, 0x006f62, 0x0090ff, 0x6692ff, 0xb6babd, 0x52e252, 0xffffff];
      for (let b = 0; b < 10; b++) {
        const bz = -54 + b * 12;
        const bayDoor = new THREE.Mesh(
          new THREE.BoxGeometry(0.4, 3.6, 8.2),
          new THREE.MeshBasicMaterial({ color: 0x0a0f1d })
        );
        bayDoor.position.set(pitX + pitSide * 5.6, 1.9, bz);
        sfGroup.add(bayDoor);
        const fascia = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 0.9, 9.6),
          new THREE.MeshBasicMaterial({ color: bayCols[b] })
        );
        fascia.position.set(pitX + pitSide * 5.7, 4.3, bz);
        sfGroup.add(fascia);
      }

      // Main Grandstand opposite Pit Building
      const gsX = pitSide * 26;
      const gsBase = new THREE.Mesh(
        new THREE.BoxGeometry(14, 11, 124),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.75 })
      );
      gsBase.position.set(gsX, 5.5, 0);
      sfGroup.add(gsBase);
      const gsRoof = new THREE.Mesh(
        new THREE.BoxGeometry(18, 0.8, 128),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.35, metalness: 0.5 })
      );
      gsRoof.position.set(gsX - pitSide * 2, 12.2, 0);
      sfGroup.add(gsRoof);

      // 3D Pit Crew figures ready along the pit wall
      const crewGrp = new THREE.Group();
      const suitMat = new THREE.MeshStandardMaterial({ color: 0xe10600, roughness: 0.6 });
      const helmMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 });
      for (let c = 0; c < 10; c++) {
        const czOff = -36 + c * 8;
        const fig = new THREE.Group();
        const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 1.35, 8), suitMat);
        torso.position.y = 0.7;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 8), helmMat);
        head.position.y = 1.55;
        fig.add(torso); fig.add(head);
        fig.position.set(pitX + pitSide * 8.2, 0, czOff);
        crewGrp.add(fig);
      }
      sfGroup.add(crewGrp);
      state.pitCrewGroup = crewGrp;

      // Trees / Floodlight towers around the circuit perimeter
      const propCount = 42;
      for (let i = 0; i < propCount; i++) {
        const p = pts[Math.floor((i / propCount) * n)];
        const side = i % 2 === 0 ? 1 : -1;
        const rx = -p.tz, rz = p.tx;
        const px = p.x + rx * side * (24 + (i % 4) * 7);
        const pz = p.z + rz * side * (24 + (i % 4) * 7);
        if (theme.isNight) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 18, 6), gantryMat);
          pole.position.set(px, 9, pz);
          grp.add(pole);
          const head = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, 0.8), new THREE.MeshBasicMaterial({ color: 0xe0f2fe }));
          head.position.set(px, 18, pz);
          grp.add(head);
        } else if (circuit.biome === "street") {
          const h = 14 + (i % 5) * 8;
          const tower = new THREE.Mesh(new THREE.BoxGeometry(10, h, 10), new THREE.MeshStandardMaterial({ color: 0x334155 + (i % 3) * 0x0a0d12, roughness: 0.7 }));
          tower.position.set(px, h * 0.5, pz);
          grp.add(tower);
        } else {
          const tree = new THREE.Mesh(new THREE.ConeGeometry(4.2, 12, 7), new THREE.MeshStandardMaterial({ color: 0x16532d, roughness: 0.9 }));
          tree.position.set(px, 6, pz);
          grp.add(tree);
        }
      }

      // Place 12 elevated Off-Side Trackside TV Broadcast Cameras around the circuit!
      state.tvCams = [];
      for (let i = 0; i < 12; i++) {
        const prog = (i + 0.35) / 12;
        const sp = sample3DTrack(prog);
        const side = i % 2 === 0 ? 1 : -1;
        const rx = -sp.tz, rz = sp.tx;
        state.tvCams.push({
          prog,
          pos: new THREE.Vector3(sp.x + rx * side * 26, 8.5 + (i % 3) * 3.5, sp.z + rz * side * 26),
        });
      }
    }

    function sample3DTrack(prog) {
      const pts = state.trackPts;
      if (!pts.length) return { x: 0, z: 0, tx: 1, tz: 0 };
      const n = pts.length;
      const p = (((prog % 1) + 1) % 1) * n;
      const i0 = Math.floor(p) % n;
      const i1 = (i0 + 1) % n;
      const f = p - Math.floor(p);
      const a = pts[i0], b = pts[i1];
      const tx = a.tx + (b.tx - a.tx) * f;
      const tz = a.tz + (b.tz - a.tz) * f;
      const tl = Math.max(1e-5, Math.hypot(tx, tz));
      return {
        x: a.x + (b.x - a.x) * f,
        z: a.z + (b.z - a.z) * f,
        tx: tx / tl,
        tz: tz / tl,
      };
    }

    function sample3DPit(u) {
      const pts = state.pitPts;
      if (!pts.length) return sample3DTrack(0);
      const clamped = Math.max(0, Math.min(1, u));
      const p = clamped * (pts.length - 1);
      const i0 = Math.floor(p);
      const i1 = Math.min(pts.length - 1, i0 + 1);
      const f = p - i0;
      const a = pts[i0], b = pts[i1];
      return {
        x: a.x + (b.x - a.x) * f,
        z: a.z + (b.z - a.z) * f,
        tx: a.tx,
        tz: a.tz,
      };
    }

    function ensureCarMesh(car, wantHero) {
      const existing = state.carMeshes.get(car.idx);
      if (existing && existing.isHero === wantHero) return existing.group;
      if (existing) {
        if (global.F1Car3D && global.F1Car3D.disposeObject) global.F1Car3D.disposeObject(existing.group);
        scene.remove(existing.group);
      }
      let grp;
      if (wantHero && global.F1Car3D && global.F1Car3D.createCar) {
        const pal = car.palette || { main: car.color || "#e10600", secondary: "#111622", accent: "#facc15", pop: "#ffffff", detail: "#262c36" };
        grp = global.F1Car3D.createCar(pal, car.liveryStyle || "two-tone", car.era || "2020s");
        grp.scale.setScalar(1.02);
      } else {
        grp = makeLiteCarMesh(car.color);
      }
      scene.add(grp);
      state.carMeshes.set(car.idx, { group: grp, isHero: wantHero, color: car.color });
      return grp;
    }

    function updateAndRender(opts) {
      if (!state.active) return;
      const { circuit, cars, focusIdx, dt, paused } = opts;
      if (!circuit || !cars || !cars.length) return;
      buildCircuit3D(circuit);

      const cssW = canvasEl.clientWidth || 720;
      const cssH = canvasEl.clientHeight || 480;
      if (cssW < 30 || cssH < 30) return;
      if (canvasEl.width !== Math.round(cssW * renderer.getPixelRatio()) || canvasEl.height !== Math.round(cssH * renderer.getPixelRatio())) {
        renderer.setSize(cssW, cssH, false);
        camera.aspect = cssW / cssH;
        camera.updateProjectionMatrix();
      }

      const focCar = cars.find((c) => c.idx === focusIdx && !c.dnf) || cars.find((c) => !c.dnf) || cars[0];
      // Pick up to 6 closest cars to focus for high-detail F1Car3D LOD
      const nearestIds = new Set();
      if (focCar) {
        nearestIds.add(focCar.idx);
        cars
          .filter((c) => !c.dnf && c.idx !== focCar.idx)
          .sort((a, b) => Math.abs(a.totalProg - focCar.totalProg) - Math.abs(b.totalProg - focCar.totalProg))
          .slice(0, 5)
          .forEach((c) => nearestIds.add(c.idx));
      }

      let focPos = new THREE.Vector3();
      let focFwd = new THREE.Vector3(0, 0, 1);
      let pittingCarPos = null;

      cars.forEach((car) => {
        const entry = state.carMeshes.get(car.idx);
        if (car.dnf) {
          if (entry) entry.group.visible = false;
          return;
        }
        const mesh = ensureCarMesh(car, nearestIds.has(car.idx));
        mesh.visible = true;
        const inPit = car.inPit > 0 && car.pitDuration > 0;
        const pose = inPit
          ? sample3DPit(1 - Math.max(0, Math.min(1, car.inPit / car.pitDuration)))
          : sample3DTrack(car.totalProg);
        const rx = -pose.tz, rz = pose.tx;
        const latM = inPit ? 0 : Math.max(-5.8, Math.min(5.8, (car.latOffset || 0) * 1.15));
        const wx = pose.x + rx * latM;
        const wz = pose.z + rz * latM;

        mesh.position.set(wx, 0.06, wz);
        mesh.rotation.y = Math.atan2(pose.tx, pose.tz);

        if (inPit && !pittingCarPos) {
          pittingCarPos = new THREE.Vector3(wx, 0.8, wz);
        }
        if (focCar && car.idx === focCar.idx) {
          focPos.set(wx, 0.06, wz);
          focFwd.set(pose.tx, 0, pose.tz).normalize();
        }
      });

      // Resolve Auto 3D Director mode
      let effMode = state.mode;
      if (state.mode === "director") {
        if (!paused) state.directorTimer += (dt || 0.016);
        if (focCar && focCar.inPit > 0) {
          effMode = "pitlane";
        } else if (state.directorTimer > 7.5) {
          state.directorTimer = 0;
          const seq = ["tv", "chase", "pov", "tv"];
          state.directorSub = seq[(seq.indexOf(state.directorSub) + 1) % seq.length];
        }
        if (effMode === "director") effMode = state.directorSub;
      }

      const desiredPos = new THREE.Vector3();
      const desiredLook = new THREE.Vector3();
      let desiredFov = 54;

      if (effMode === "pov") {
        // Onboard Halo T-Cam POV perched behind helmet looking down nose cone!
        desiredPos.copy(focPos).addScaledVector(focFwd, -0.55);
        desiredPos.y = 1.48;
        desiredLook.copy(focPos).addScaledVector(focFwd, 28);
        desiredLook.y = 1.05;
        desiredFov = 68 + Math.min(10, ((focCar?.liveKph || 220) - 180) * 0.06);
        state.camPosSmooth.copy(desiredPos);
        state.camLookSmooth.copy(desiredLook);
      } else if (effMode === "chase") {
        // 3rd Person Chase Cam
        desiredPos.copy(focPos).addScaledVector(focFwd, -10.5);
        desiredPos.y = 3.9;
        desiredLook.copy(focPos).addScaledVector(focFwd, 14);
        desiredLook.y = 1.25;
        desiredFov = 54 + Math.min(12, ((focCar?.liveKph || 220) - 180) * 0.07);
        const lerpF = state.camInit ? Math.min(1, (dt || 0.016) * 8.5) : 1;
        state.camPosSmooth.lerp(desiredPos, lerpF);
        state.camLookSmooth.lerp(desiredLook, lerpF);
      } else if (effMode === "pitlane") {
        // Pitlane & Pit Crew Broadcast Cam
        const pMid = state.pitPts[Math.floor(state.pitPts.length * 0.25)] || sample3DTrack(0);
        const pEnd = state.pitPts[Math.floor(state.pitPts.length * 0.65)] || sample3DTrack(0.02);
        desiredPos.set(pMid.x, 4.4, pMid.z);
        if (pittingCarPos) desiredLook.copy(pittingCarPos);
        else desiredLook.set(pEnd.x, 1.3, pEnd.z);
        desiredFov = 46;
        const lerpF = state.camInit ? Math.min(1, (dt || 0.016) * 5.0) : 1;
        state.camPosSmooth.lerp(desiredPos, lerpF);
        state.camLookSmooth.lerp(desiredLook, lerpF);
      } else {
        // Off-Side Trackside TV Broadcast Cameras (auto-cut to nearest camera ahead of focused car!)
        let bestIdx = 0;
        let bestDist = Infinity;
        state.tvCams.forEach((tc, i) => {
          const d = tc.pos.distanceTo(focPos);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        });
        const camSpot = state.tvCams[bestIdx] || { pos: new THREE.Vector3(focPos.x + 25, 10, focPos.z + 25) };
        desiredPos.copy(camSpot.pos);
        desiredLook.copy(focPos).addScaledVector(focFwd, 4.5);
        desiredLook.y = 1.05;
        // Broadcast telephoto zoom lens tightens as car gets further away!
        desiredFov = Math.max(24, Math.min(48, 56 - bestDist * 0.12));
        state.camPosSmooth.copy(desiredPos);
        const lerpL = state.camInit ? Math.min(1, (dt || 0.016) * 9.5) : 1;
        state.camLookSmooth.lerp(desiredLook, lerpL);
      }

      state.camInit = true;
      camera.position.copy(state.camPosSmooth);
      camera.lookAt(state.camLookSmooth);
      if (Math.abs(camera.fov - desiredFov) > 0.2) {
        camera.fov += (desiredFov - camera.fov) * 0.22;
        camera.updateProjectionMatrix();
      }

      renderer.render(scene, camera);

      // Update optional 3D Onboard / Broadcast HUD overlay
      if (hudEl && focCar) {
        const camLabel = effMode === "pov" ? "ONBOARD T-CAM POV"
          : (effMode === "chase" ? "3RD PERSON CHASE"
            : (effMode === "pitlane" ? "PITLANE CAM" : "TRACKSIDE TV CAM"));
        hudEl.innerHTML = `
          <span class="b3d-cam-tag"><i class="fas fa-video"></i> ${camLabel}${state.mode === "director" ? " · AUTO" : ""}</span>
          <span class="b3d-drv-tag"><i style="background:${focCar.color || "#e10600"}"></i>P${focCar.pos || 1} <b>${focCar.code3 || "DRV"}</b></span>
          <span class="b3d-speed-tag"><b>${focCar.liveKph || 260}</b> KPH · G${focCar.liveGear || 6}</span>
        `;
      }
    }

    return {
      setActive(on) {
        state.active = !!on;
        canvasEl.classList.toggle("hidden", !state.active);
        if (hudEl) hudEl.classList.toggle("hidden", !state.active);
        if (state.active) state.camInit = false;
      },
      isActive() { return state.active; },
      setMode(mode) {
        state.mode = mode || "tv";
        state.camInit = false;
      },
      getMode() { return state.mode; },
      updateAndRender,
      dispose() {
        disposeWorld();
        state.asphaltTex.dispose();
        state.kerbTex.dispose();
        renderer.dispose();
      },
    };
  }

  global.F1Broadcast3D = {
    createBroadcast3D,
  };
})(window);
