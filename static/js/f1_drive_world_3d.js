/**
 * Apex POV (/drive) — 3D Circuit World, Dynamic 3D Braking/Racing Line, Start Gantry,
 * 19 AI Cars, Holographic Ghost Car & Dynamic Weather Engine.
 */
(function (global) {
  "use strict";

  const BIOME_THEMES = {
    parkland:     { skyTop: 0x1d6fd6, skyHor: 0xaad8ff, sunCol: 0xfff5d6, ground: 0x3b7a38, fog: 0x9bc9ef, sunInt: 2.1, isNight: false },
    harbour:      { skyTop: 0x1565c8, skyHor: 0x9ed6ff, sunCol: 0xfff4d4, ground: 0x475569, fog: 0x8ec5ea, sunInt: 2.2, isNight: false },
    coastal:      { skyTop: 0x1874d2, skyHor: 0xa8ddff, sunCol: 0xfff7dd, ground: 0x4b7f44, fog: 0x99cef0, sunInt: 2.2, isNight: false },
    street:       { skyTop: 0x2563b8, skyHor: 0xa6cbe8, sunCol: 0xfff1cc, ground: 0x475060, fog: 0x8db6da, sunInt: 2.0, isNight: false },
    desert:       { skyTop: 0x2574d0, skyHor: 0xf6d19c, sunCol: 0xffe4a8, ground: 0xd9a76a, fog: 0xe6c89d, sunInt: 2.3, isNight: false },
    night_desert: { skyTop: 0x071024, skyHor: 0x1d2948, sunCol: 0xdbeafe, ground: 0x2a2530, fog: 0x121b33, sunInt: 1.4, isNight: true },
    night_street: { skyTop: 0x060c1f, skyHor: 0x1b2646, sunCol: 0xe0f2fe, ground: 0x212938, fog: 0x111a30, sunInt: 1.4, isNight: true },
  };

  function getTheme(circuit) {
    if (circuit && circuit.is_night) {
      return circuit.biome && circuit.biome.includes("desert") ? BIOME_THEMES.night_desert : BIOME_THEMES.night_street;
    }
    return BIOME_THEMES[(circuit && circuit.biome) || "parkland"] || BIOME_THEMES.parkland;
  }

  function makeAsphaltTex() {
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 512;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#2d333d";
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 8000; i++) {
      const v = 36 + Math.floor(Math.random() * 28);
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    const g = ctx.createLinearGradient(0, 0, 512, 0);
    g.addColorStop(0.0, "rgba(0,0,0,0)");
    g.addColorStop(0.25, "rgba(8,10,14,0.34)");
    g.addColorStop(0.50, "rgba(8,10,14,0.06)");
    g.addColorStop(0.75, "rgba(8,10,14,0.34)");
    g.addColorStop(1.0, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    // FIA white track-limit lines
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(14, 0, 10, 512);
    ctx.fillRect(488, 0, 10, 512);
    const tex = new global.THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = global.THREE.RepeatWrapping;
    tex.anisotropy = 8;
    tex.colorSpace = global.THREE.SRGBColorSpace;
    return tex;
  }

  function makeKerbTex() {
    const cv = document.createElement("canvas");
    cv.width = 64; cv.height = 128;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#dc2626"; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#f8fafc"; ctx.fillRect(0, 64, 64, 64);
    const tex = new global.THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = global.THREE.RepeatWrapping;
    tex.colorSpace = global.THREE.SRGBColorSpace;
    return tex;
  }

  function makeBarrierTex() {
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 64;
    const ctx = cv.getContext("2d");
    const panels = [
      ["#e10600", "#fff", "APEX POV · F1"],
      ["#0f172a", "#facc15", "PIRELLI P-ZERO"],
      ["#0284c7", "#fff", "F1DB TELEMETRY"],
      ["#1e1b4b", "#38bdf8", "DRS ZONE"],
    ];
    const pw = 512 / panels.length;
    panels.forEach(([bg, fg, txt], i) => {
      ctx.fillStyle = bg; ctx.fillRect(i * pw, 0, pw, 64);
      ctx.fillStyle = fg; ctx.font = "900 13px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(txt, i * pw + pw * 0.5, 34, pw - 8);
    });
    const tex = new global.THREE.CanvasTexture(cv);
    tex.wrapS = global.THREE.RepeatWrapping;
    tex.wrapT = global.THREE.ClampToEdgeWrapping;
    tex.colorSpace = global.THREE.SRGBColorSpace;
    return tex;
  }

  function makeBoardTex(label) {
    const cv = document.createElement("canvas");
    cv.width = 128; cv.height = 96;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#f8fafc"; ctx.fillRect(0, 0, 128, 96);
    ctx.strokeStyle = "#e10600"; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 120, 88);
    ctx.fillStyle = "#0f172a"; ctx.font = "900 44px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, 64, 52);
    const tex = new global.THREE.CanvasTexture(cv);
    tex.colorSpace = global.THREE.SRGBColorSpace;
    return tex;
  }

  function buildRibbon(pts, leftOff, rightOff, yOff, uvScale) {
    const THREE = global.THREE;
    const n = pts.length;
    const count = n + 1;
    const pos = new Float32Array(count * 6);
    const uvs = new Float32Array(count * 4);
    const idx = [];
    let dist = 0;
    for (let i = 0; i < count; i++) {
      const p = pts[i % n];
      if (i > 0) {
        const prev = pts[(i - 1) % n];
        dist += Math.hypot(p.x - prev.x, p.z - prev.z);
      }
      const bSin = p.bankRad ? Math.sin(p.bankRad) : 0;
      const vi = i * 6;
      pos[vi]     = p.x + p.rx * leftOff;  pos[vi + 1] = p.y + yOff + bSin * leftOff;  pos[vi + 2] = p.z + p.rz * leftOff;
      pos[vi + 3] = p.x + p.rx * rightOff; pos[vi + 4] = p.y + yOff + bSin * rightOff; pos[vi + 5] = p.z + p.rz * rightOff;
      const ui = i * 4;
      uvs[ui] = 0; uvs[ui + 1] = dist * (uvScale || 0.08);
      uvs[ui + 2] = 1; uvs[ui + 3] = dist * (uvScale || 0.08);
      if (i < count - 1) {
        const b = i * 2;
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  function buildWall(pts, offset, height) {
    const THREE = global.THREE;
    const n = pts.length;
    const count = n + 1;
    const pos = new Float32Array(count * 6);
    const uvs = new Float32Array(count * 4);
    const idx = [];
    let dist = 0;
    for (let i = 0; i < count; i++) {
      const p = pts[i % n];
      if (i > 0) {
        const prev = pts[(i - 1) % n];
        dist += Math.hypot(p.x - prev.x, p.z - prev.z);
      }
      const wx = p.x + p.rx * offset;
      const wz = p.z + p.rz * offset;
      const vi = i * 6;
      pos[vi] = wx; pos[vi + 1] = p.y; pos[vi + 2] = wz;
      pos[vi + 3] = wx; pos[vi + 4] = p.y + height; pos[vi + 5] = wz;
      const ui = i * 4;
      uvs[ui] = dist * 0.04; uvs[ui + 1] = 0;
      uvs[ui + 2] = dist * 0.04; uvs[ui + 3] = 1;
      if (i < count - 1) {
        const b = i * 2;
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  function makeAiCarMesh(colorHex, isGhost) {
    const THREE = global.THREE;
    const g = new THREE.Group();
    const mat = isGhost
      ? new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.42, wireframe: false })
      : new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex || "#38bdf8"), roughness: 0.30, metalness: 0.38 });
    const dark = isGhost
      ? new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.30 })
      : new THREE.MeshStandardMaterial({ color: 0x151922, roughness: 0.55, metalness: 0.25 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.42, 3.8), mat);
    body.position.set(0, 0.38, 0.1);
    g.add(body);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.22, 1.5), mat);
    nose.position.set(0, 0.30, 2.35);
    g.add(nose);
    const fw = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.07, 0.42), dark);
    fw.position.set(0, 0.14, 2.95);
    g.add(fw);
    const rw = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.28, 0.34), mat);
    rw.position.set(0, 0.88, -1.85);
    g.add(rw);
    const airbox = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.44, 1.15), mat);
    airbox.position.set(0, 0.72, -0.35);
    g.add(airbox);
    const rainLight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.06), new THREE.MeshBasicMaterial({ color: isGhost ? 0x22d3ee : 0xef4444 }));
    rainLight.position.set(0, 0.36, -2.02);
    g.add(rainLight);

    const wGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.32, 12);
    [[-0.86, 1.55], [0.86, 1.55], [-0.90, -1.45], [0.90, -1.45]].forEach(([wx, wz]) => {
      const wm = new THREE.Mesh(wGeo, dark);
      wm.rotation.z = Math.PI * 0.5;
      wm.position.set(wx, 0.34, wz);
      g.add(wm);
    });
    g.userData.rearWing = rw;
    g.userData.rainLight = rainLight;
    return g;
  }

  function createDriveWorld(canvasEl) {
    const THREE = global.THREE;
    const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.12, 4200);

    const asphaltTex = makeAsphaltTex();
    const kerbTex = makeKerbTex();
    const barrierTex = makeBarrierTex();
    const board100Tex = makeBoardTex("100");
    const board50Tex = makeBoardTex("50");

    let worldGroup = null;
    let sunLight = null;
    let roadMat = null;
    let racingLineMesh = null;
    let racingLineColors = null;
    let racingLineMode = "full"; // off | corners | full
    let startLightMats = [];
    let aiMeshes = new Map();
    let ghostMesh = null;
    let rainPoints = null;
    let currentTrack = null;

    function resize() {
      const rect = canvasEl.getBoundingClientRect();
      const w = Math.max(320, Math.round(rect.width || window.innerWidth));
      const h = Math.max(240, Math.round(rect.height || window.innerHeight));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function clearWorld() {
      if (worldGroup) {
        scene.remove(worldGroup);
        worldGroup = null;
      }
      aiMeshes.clear();
      ghostMesh = null;
      racingLineMesh = null;
      startLightMats = [];
      rainPoints = null;
    }

    function buildCircuit(circuit, track) {
      clearWorld();
      currentTrack = track;
      const theme = getTheme(circuit);
      scene.background = new THREE.Color(theme.skyHor);
      scene.fog = new THREE.FogExp2(theme.fog, theme.isNight ? 0.00075 : 0.00032);

      worldGroup = new THREE.Group();
      scene.add(worldGroup);

      // Lighting
      const hemi = new THREE.HemisphereLight(theme.skyTop, theme.ground, theme.isNight ? 0.95 : 1.35);
      worldGroup.add(hemi);
      sunLight = new THREE.DirectionalLight(theme.sunCol, theme.sunInt);
      sunLight.position.set(140, 220, 100);
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(1024, 1024);
      sunLight.shadow.camera.near = 15;
      sunLight.shadow.camera.far = 600;
      const sb = 110;
      sunLight.shadow.camera.left = -sb; sunLight.shadow.camera.right = sb;
      sunLight.shadow.camera.top = sb; sunLight.shadow.camera.bottom = -sb;
      worldGroup.add(sunLight);
      worldGroup.add(sunLight.target);

      // Ground plane
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(9000, 9000),
        new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 0.95, metalness: 0.02 })
      );
      ground.rotation.x = -Math.PI * 0.5;
      ground.position.y = -0.35;
      ground.receiveShadow = true;
      worldGroup.add(ground);

      const pts = track.pts;
      // Runoff apron
      const runoff = new THREE.Mesh(
        buildRibbon(pts, -16.2, 16.2, 0.005, 0.04),
        new THREE.MeshStandardMaterial({ color: circuit.biome === "street" ? 0x3b4454 : (circuit.biome === "desert" ? 0xc89a64 : 0x2d6431), roughness: 0.92, side: THREE.DoubleSide })
      );
      runoff.receiveShadow = true;
      worldGroup.add(runoff);

      // Main PBR Asphalt
      roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.72, metalness: 0.08, side: THREE.DoubleSide });
      const road = new THREE.Mesh(buildRibbon(pts, -7.5, 7.5, 0.03, 0.085), roadMat);
      road.receiveShadow = true;
      worldGroup.add(road);

      // Left & Right Stepped FIA Kerbs
      const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.65, side: THREE.DoubleSide });
      worldGroup.add(new THREE.Mesh(buildRibbon(pts, -9.0, -7.45, 0.045, 0.35), kerbMat));
      worldGroup.add(new THREE.Mesh(buildRibbon(pts, 7.45, 9.0, 0.045, 0.35), kerbMat));

      // Sponsor-walled Track Barriers
      const barMat = new THREE.MeshStandardMaterial({ map: barrierTex, roughness: 0.5, side: THREE.DoubleSide });
      worldGroup.add(new THREE.Mesh(buildWall(pts, -16.1, 1.35), barMat));
      worldGroup.add(new THREE.Mesh(buildWall(pts, 16.1, 1.35), barMat));

      // Start/Finish Gantry + 5 Interactive Red/Green Start Lights
      const p0 = track.sample(0);
      const sYaw = Math.atan2(p0.tx, p0.tz);
      const gantry = new THREE.Group();
      gantry.position.set(p0.x, p0.y, p0.z);
      gantry.rotation.y = sYaw;
      const gMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.6 });
      const postL = new THREE.Mesh(new THREE.BoxGeometry(0.7, 7.2, 0.7), gMat); postL.position.set(-10.5, 3.6, 0); gantry.add(postL);
      const postR = postL.clone(); postR.position.x = 10.5; gantry.add(postR);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(22.0, 1.25, 1.1), gMat); beam.position.set(0, 6.8, 0); gantry.add(beam);
      // 5 Start Light Pods facing approaching grid (-Z)
      startLightMats = [];
      for (let i = 0; i < 5; i++) {
        const lMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
        startLightMats.push(lMat);
        const pod = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.65, 0.25), lMat);
        pod.position.set((i - 2) * 1.6, 6.2, -0.62);
        gantry.add(pod);
      }
      // Checkered Start Line strip
      const sfStrip = new THREE.Mesh(new THREE.PlaneGeometry(14.8, 1.4), new THREE.MeshBasicMaterial({ color: 0xf8fafc }));
      sfStrip.rotation.x = -Math.PI * 0.5;
      sfStrip.position.set(0, 0.055, 0);
      gantry.add(sfStrip);
      worldGroup.add(gantry);

      // Corner Braking Distance Boards (100m & 50m) at braking_zones
      const bZones = Array.isArray(circuit.braking_zones) ? circuit.braking_zones : [];
      const b100Mat = new THREE.MeshBasicMaterial({ map: board100Tex, side: THREE.DoubleSide });
      const b50Mat = new THREE.MeshBasicMaterial({ map: board50Tex, side: THREE.DoubleSide });
      bZones.forEach((bz) => {
        const tZone = Number(bz.t || 0);
        const side = (track.sample(tZone).curv >= 0) ? -1 : 1; // place on outside of turn!
        [[100, b100Mat], [50, b50Mat]].forEach(([distM, mat]) => {
          const pOff = (((tZone - distM / Math.max(1000, track.totalLen)) % 1) + 1) % 1;
          const sp = track.sample(pOff);
          const board = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.25), mat);
          board.position.set(sp.x + sp.rx * (side * 11.2), sp.y + 1.1, sp.z + sp.rz * (side * 11.2));
          board.rotation.y = Math.atan2(sp.tx, sp.tz);
          worldGroup.add(board);
        });
      });

      // Dynamic 3D Racing & Braking Line Ribbon (Vertex-colored Green -> Amber -> Red)
      const n = pts.length;
      const rlPos = new Float32Array((n + 1) * 6);
      const rlCol = new Float32Array((n + 1) * 6);
      const rlIdx = [];
      for (let i = 0; i <= n; i++) {
        const p = pts[i % n];
        const lat = p.optLat || 0;
        const cx = p.x + p.rx * lat;
        const cz = p.z + p.rz * lat;
        const vi = i * 6;
        rlPos[vi]     = cx - p.rx * 0.42; rlPos[vi + 1] = p.y + 0.09; rlPos[vi + 2] = cz - p.rz * 0.42;
        rlPos[vi + 3] = cx + p.rx * 0.42; rlPos[vi + 4] = p.y + 0.09; rlPos[vi + 5] = cz + p.rz * 0.42;
        rlCol[vi] = 0.13; rlCol[vi + 1] = 0.77; rlCol[vi + 2] = 0.37;
        rlCol[vi + 3] = 0.13; rlCol[vi + 4] = 0.77; rlCol[vi + 5] = 0.37;
        if (i < n) {
          const b = i * 2;
          rlIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
      }
      const rlGeo = new THREE.BufferGeometry();
      rlGeo.setAttribute("position", new THREE.BufferAttribute(rlPos, 3));
      racingLineColors = new THREE.BufferAttribute(rlCol, 3);
      rlGeo.setAttribute("color", racingLineColors);
      rlGeo.setIndex(rlIdx);
      racingLineMesh = new THREE.Mesh(
        rlGeo,
        new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.72, side: THREE.DoubleSide })
      );
      racingLineMesh.visible = racingLineMode !== "off";
      worldGroup.add(racingLineMesh);

      // Rain Particle System (hidden when dry)
      const rCount = 900;
      const rPos = new Float32Array(rCount * 3);
      for (let i = 0; i < rCount; i++) {
        rPos[i * 3] = (Math.random() - 0.5) * 90;
        rPos[i * 3 + 1] = Math.random() * 28;
        rPos[i * 3 + 2] = (Math.random() - 0.5) * 90;
      }
      const rGeo = new THREE.BufferGeometry();
      rGeo.setAttribute("position", new THREE.BufferAttribute(rPos, 3));
      rainPoints = new THREE.Points(rGeo, new THREE.PointsMaterial({ color: 0xbae6fd, size: 0.28, transparent: true, opacity: 0.55 }));
      rainPoints.visible = false;
      worldGroup.add(rainPoints);
    }

    function updateRacingLine(car) {
      if (!racingLineMesh || !racingLineColors || !currentTrack || !car) return;
      racingLineMesh.visible = racingLineMode !== "off";
      if (!racingLineMesh.visible) return;
      const pts = currentTrack.pts;
      const n = pts.length;
      const arr = racingLineColors.array;
      const curVx = Math.max(22, car.vx || 0);
      for (let i = 0; i <= n; i++) {
        const p = pts[i % n];
        const diff = curVx - p.vTarget;
        let r = 0.12, g = 0.84, b = 0.44; // Green: flat out
        if (diff > 7.5) {
          r = 0.96; g = 0.16; b = 0.18;   // Red: heavy braking!
        } else if (diff > -1.5) {
          r = 0.98; g = 0.76; b = 0.12;   // Amber: lift / trail-brake
        } else if (racingLineMode === "corners") {
          r = 0.08; g = 0.18; b = 0.14;
        }
        const vi = i * 6;
        arr[vi] = r; arr[vi + 1] = g; arr[vi + 2] = b;
        arr[vi + 3] = r; arr[vi + 4] = g; arr[vi + 5] = b;
      }
      racingLineColors.needsUpdate = true;
    }

    function setStartLights(litCount, isGreen) {
      for (let i = 0; i < startLightMats.length; i++) {
        if (isGreen) startLightMats[i].color.setHex(0x22c55e);
        else startLightMats[i].color.setHex(i < litCount ? 0xef4444 : 0x1e293b);
      }
    }

    function syncAiCars(aiCars, ghostPose) {
      if (!worldGroup) return;
      const activeIds = new Set();
      for (let i = 0; i < (aiCars || []).length; i++) {
        const a = aiCars[i];
        activeIds.add(a.driver_id);
        let mesh = aiMeshes.get(a.driver_id);
        if (!mesh) {
          mesh = makeAiCarMesh(a.color, false);
          worldGroup.add(mesh);
          aiMeshes.set(a.driver_id, mesh);
        }
        mesh.visible = !a.dnf;
        mesh.position.set(a.x, a.y + 0.04, a.z);
        mesh.rotation.y = a.yaw;
        if (mesh.userData.rearWing) {
          mesh.userData.rearWing.rotation.x = a.drsOpen ? 0.35 : 0.0;
        }
      }
      for (const [id, mesh] of aiMeshes.entries()) {
        if (!activeIds.has(id)) {
          worldGroup.remove(mesh);
          aiMeshes.delete(id);
        }
      }

      if (ghostPose) {
        if (!ghostMesh) {
          ghostMesh = makeAiCarMesh("#22d3ee", true);
          worldGroup.add(ghostMesh);
        }
        ghostMesh.visible = true;
        ghostMesh.position.set(ghostPose.x, ghostPose.y + 0.05, ghostPose.z);
        ghostMesh.rotation.y = ghostPose.yaw;
      } else if (ghostMesh) {
        ghostMesh.visible = false;
      }
    }

    function updateWeather(car, wetness, dt) {
      if (roadMat) {
        const wet = Math.max(0, Math.min(1, (wetness || 0) / 100));
        roadMat.roughness = 0.72 - wet * 0.48;
        roadMat.metalness = 0.08 + wet * 0.28;
      }
      if (rainPoints && car) {
        rainPoints.visible = (wetness || 0) >= 22;
        if (rainPoints.visible) {
          rainPoints.position.set(car.x, car.y, car.z);
          const pos = rainPoints.geometry.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            let y = pos.getY(i) - (dt || 0.016) * 28;
            if (y < 0) y = 26;
            pos.setY(i, y);
          }
          pos.needsUpdate = true;
        }
      }
      if (sunLight && car) {
        sunLight.position.set(car.x + 90, car.y + 180, car.z + 75);
        sunLight.target.position.set(car.x, car.y, car.z);
        sunLight.target.updateMatrixWorld();
      }
    }

    function cycleRacingLine() {
      const modes = ["full", "corners", "off"];
      racingLineMode = modes[(modes.indexOf(racingLineMode) + 1) % modes.length];
      return racingLineMode;
    }

    function render() {
      renderer.render(scene, camera);
    }

    function dispose() {
      clearWorld();
      asphaltTex.dispose();
      kerbTex.dispose();
      barrierTex.dispose();
      board100Tex.dispose();
      board50Tex.dispose();
      renderer.dispose();
    }

    return {
      scene,
      camera,
      resize,
      buildCircuit,
      updateRacingLine,
      setStartLights,
      syncAiCars,
      updateWeather,
      cycleRacingLine,
      getRacingLineMode: () => racingLineMode,
      render,
      dispose,
    };
  }

  global.F1DriveWorld3D = { createDriveWorld };
})(window);
