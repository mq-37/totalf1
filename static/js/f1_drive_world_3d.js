/**
 * Apex POV (/drive) — Next-Gen 3D Circuit World, GLSL Atmospheric Sky, PMREM Reflections,
 * GPU-Instanced Trackside Scenery (Grandstands, Trees, Tyre Barriers, DRS Gantries, FIA LED Flags),
 * 5 Live Particle Pools (Sparks, Lockup Smoke, Rain Spray, Gravel Dust, Carbon Debris) & High-Detail AI Cars.
 */
(function (global) {
  "use strict";

  const BIOME_THEMES = {
    parkland:     { skyTop: 0x1659b8, skyHor: 0xaad8ff, sunCol: 0xfff5d6, ground: 0x356e32, grassAlt: 0x45843c, fog: 0x99c8ee, sunInt: 2.2, isNight: false },
    harbour:      { skyTop: 0x145ec2, skyHor: 0x9ed6ff, sunCol: 0xfff4d4, ground: 0x475569, grassAlt: 0x3d6a43, fog: 0x8cc3e9, sunInt: 2.3, isNight: false, water: 0x0b74b8 },
    coastal:      { skyTop: 0x166bcb, skyHor: 0xa8ddff, sunCol: 0xfff7dd, ground: 0x4b7f44, grassAlt: 0x678f4b, fog: 0x99cef0, sunInt: 2.3, isNight: false, water: 0x0ea5e9 },
    street:       { skyTop: 0x225cb0, skyHor: 0xa6cbe8, sunCol: 0xfff1cc, ground: 0x3e4756, grassAlt: 0x385740, fog: 0x8db6da, sunInt: 2.1, isNight: false },
    desert:       { skyTop: 0x1f69c4, skyHor: 0xf6d19c, sunCol: 0xffe4a8, ground: 0xd9a76a, grassAlt: 0xc58e52, fog: 0xe6c89d, sunInt: 2.4, isNight: false },
    night_desert: { skyTop: 0x050b1c, skyHor: 0x192544, sunCol: 0xdbeafe, ground: 0x26212c, grassAlt: 0x312a38, fog: 0x10182e, sunInt: 1.45, isNight: true },
    night_street: { skyTop: 0x040918, skyHor: 0x162242, sunCol: 0xe0f2fe, ground: 0x1e2534, grassAlt: 0x262f42, fog: 0x0e162a, sunInt: 1.50, isNight: true },
  };

  const COMPOUND_HEX = { soft: 0xef4444, medium: 0xfacc15, hard: 0xf8fafc, inter: 0x22c55e, wet: 0x3b82f6 };

  function getTheme(circuit) {
    if (circuit && circuit.is_night) {
      return circuit.biome && circuit.biome.includes("desert") ? BIOME_THEMES.night_desert : BIOME_THEMES.night_street;
    }
    return BIOME_THEMES[(circuit && circuit.biome) || "parkland"] || BIOME_THEMES.parkland;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashStr(s) {
    let h = 2166136261;
    const str = String(s || "melbourne");
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // --- GLSL Atmospheric Sky Dome (Rayleigh/Mie Gradient + Volumetric Sun + Drifting Clouds + Stars) ---
  function buildSkyDome(theme) {
    const THREE = global.THREE;
    const uniforms = {
      uTop: { value: new THREE.Color(theme.skyTop) },
      uHor: { value: new THREE.Color(theme.skyHor) },
      uSunCol: { value: new THREE.Color(theme.sunCol) },
      uSunDir: { value: new THREE.Vector3(0.45, theme.isNight ? 0.25 : 0.48, 0.35).normalize() },
      uNight: { value: theme.isNight ? 1.0 : 0.0 },
      uWet: { value: 0.0 },
      uTime: { value: 0.0 },
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vDir = normalize(position);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uTop, uHor, uSunCol, uSunDir;
        uniform float uNight, uWet, uTime;
        varying vec3 vDir;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 sky = mix(uHor, uTop, pow(h, 0.58));
          // Storm overcast darkening when wet
          sky = mix(sky, vec3(0.18, 0.23, 0.31), uWet * 0.62);
          // Volumetric sun disc & Mie halo
          float sunDot = max(dot(d, uSunDir), 0.0);
          sky += uSunCol * (pow(sunDot, 16.0) * 0.24 + smoothstep(0.9965, 0.9994, sunDot) * 1.15) * (1.0 - uNight * 0.85) * (1.0 - uWet * 0.7);
          // Procedural drifting clouds
          if (d.y > 0.04) {
            vec2 cuv = (d.xz / (d.y + 0.18)) * 1.45 + vec2(uTime * 0.008, uTime * 0.004);
            float c = noise(cuv) * 0.62 + noise(cuv * 2.3) * 0.38;
            float cloudMask = smoothstep(0.54 - uWet * 0.24, 0.82, c) * smoothstep(0.04, 0.26, d.y);
            vec3 cCol = mix(vec3(0.96, 0.98, 1.0), vec3(0.28, 0.34, 0.44), max(uWet * 0.75, uNight * 0.85));
            sky = mix(sky, cCol, cloudMask * (0.48 + uWet * 0.38));
          }
          // Twinkling night stars
          if (uNight > 0.5 && d.y > 0.12) {
            float st = hash(floor(d.xz * 260.0 / (d.y + 0.3)));
            if (st > 0.995) sky += vec3(0.85, 0.92, 1.0) * (0.6 + 0.4 * sin(uTime * 3.0 + st * 80.0)) * (1.0 - uWet);
          }
          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(3200, 28, 18), mat);
    return { mesh, uniforms };
  }

  function buildEnvMap(renderer, theme) {
    const THREE = global.THREE;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(theme.skyHor);
      const hemi = new THREE.HemisphereLight(theme.skyTop, theme.ground, 2.2);
      envScene.add(hemi);
      const rt = pmrem.fromScene(envScene, 0.04);
      pmrem.dispose();
      return rt;
    } catch (_) {
      return null;
    }
  }

  function makeAsphaltTex() {
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 512;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#2b313b";
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 10000; i++) {
      const v = 34 + Math.floor(Math.random() * 30);
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    const g = ctx.createLinearGradient(0, 0, 512, 0);
    g.addColorStop(0.0, "rgba(0,0,0,0)");
    g.addColorStop(0.24, "rgba(8,10,14,0.38)");
    g.addColorStop(0.50, "rgba(8,10,14,0.06)");
    g.addColorStop(0.76, "rgba(8,10,14,0.38)");
    g.addColorStop(1.0, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(14, 0, 10, 512);
    ctx.fillRect(488, 0, 10, 512);
    const tex = new global.THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = global.THREE.RepeatWrapping;
    tex.anisotropy = 8;
    tex.colorSpace = global.THREE.SRGBColorSpace;
    return tex;
  }

  function makeGroundTex(baseHex, altHex) {
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 512;
    const ctx = cv.getContext("2d");
    const c1 = new global.THREE.Color(baseHex);
    const c2 = new global.THREE.Color(altHex);
    ctx.fillStyle = `#${c1.getHexString()}`; ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = `#${c2.getHexString()}`; ctx.globalAlpha = 0.30;
    for (let y = 0; y < 512; y += 32) ctx.fillRect(0, y, 512, 16);
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 4500; i++) {
      ctx.fillStyle = i % 3 === 0 ? "#ffffff" : `#${c2.getHexString()}`;
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 3, 3);
    }
    ctx.globalAlpha = 1;
    const tex = new global.THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = global.THREE.RepeatWrapping;
    tex.repeat.set(90, 90);
    tex.colorSpace = global.THREE.SRGBColorSpace;
    return tex;
  }

  function makeKerbTex() {
    const cv = document.createElement("canvas");
    cv.width = 64; cv.height = 128;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#dc2626"; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#f8fafc"; ctx.fillRect(0, 64, 64, 64);
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    for (let y = 0; y < 128; y += 8) ctx.fillRect(0, y, 64, 2);
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
      ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.fillRect(i * pw, 0, pw, 6); ctx.fillRect(i * pw, 58, pw, 6);
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

  function makeCheckeredTex() {
    const cv = document.createElement("canvas");
    cv.width = 128; cv.height = 32;
    const ctx = cv.getContext("2d");
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 8; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#f8fafc" : "#0f172a";
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    }
    const tex = new global.THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = global.THREE.RepeatWrapping;
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

  // --- Reusable Particle Pool (Sparks, Lockup Smoke, Wet Spray, Gravel Dust, Carbon Debris) ---
  function createParticlePool(maxCount, colorHex, size, opacity, additive) {
    const THREE = global.THREE;
    const pos = new Float32Array(maxCount * 3);
    const vel = new Float32Array(maxCount * 3);
    const life = new Float32Array(maxCount);
    for (let i = 0; i < maxCount; i++) pos[i * 3 + 1] = -999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: colorHex, size, transparent: true, opacity, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    let cursor = 0;

    function emit(x, y, z, vx, vy, vz, ttl) {
      const i = cursor;
      cursor = (cursor + 1) % maxCount;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
      life[i] = ttl;
    }

    function step(dt, gravityY) {
      let dirty = false;
      for (let i = 0; i < maxCount; i++) {
        if (life[i] <= 0) continue;
        dirty = true;
        life[i] -= dt;
        if (life[i] <= 0) {
          pos[i * 3 + 1] = -999;
          continue;
        }
        vel[i * 3 + 1] -= (gravityY || 0) * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] = Math.max(0.05, pos[i * 3 + 1] + vel[i * 3 + 1] * dt);
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      if (dirty) geo.attributes.position.needsUpdate = true;
    }

    return { points, emit, step };
  }

  function makeAiCarMesh(colorHex, isGhost) {
    const THREE = global.THREE;
    const g = new THREE.Group();
    const mat = isGhost
      ? new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.42 })
      : new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex || "#38bdf8"), roughness: 0.26, metalness: 0.42 });
    const dark = isGhost
      ? new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.30 })
      : new THREE.MeshStandardMaterial({ color: 0x151922, roughness: 0.52, metalness: 0.30 });

    // Sculpted monocoque + tapered sidepods
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.42, 3.85), mat);
    body.position.set(0, 0.38, 0.08); g.add(body);
    const sidepods = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.34, 1.95), mat);
    sidepods.position.set(0, 0.34, -0.25); g.add(sidepods);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 1.55), mat);
    nose.position.set(0, 0.29, 2.38); g.add(nose);
    const fw = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.07, 0.42), dark);
    fw.position.set(0, 0.14, 2.96); g.add(fw);
    const rwMain = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.12, 0.30), dark);
    rwMain.position.set(0, 0.84, -1.85); g.add(rwMain);
    const rwFlap = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.14, 0.20), mat);
    rwFlap.position.set(0, 0.96, -1.88); g.add(rwFlap);
    const airbox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.44, 1.18), mat);
    airbox.position.set(0, 0.72, -0.35); g.add(airbox);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.036, 6, 14, Math.PI), dark);
    halo.rotation.x = Math.PI * 0.5; halo.position.set(0, 0.72, 0.36); g.add(halo);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2, metalness: 0.3 }));
    helmet.position.set(0, 0.68, 0.22); g.add(helmet);
    const rainLight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.06), new THREE.MeshBasicMaterial({ color: isGhost ? 0x22d3ee : 0xef4444 }));
    rainLight.position.set(0, 0.36, -2.02); g.add(rainLight);

    const wGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.32, 12);
    const ringMat = new THREE.MeshBasicMaterial({ color: COMPOUND_HEX.soft });
    const ringGeo = new THREE.TorusGeometry(0.24, 0.024, 5, 14);
    const wheels = [];
    [[-0.88, 1.55], [0.88, 1.55], [-0.92, -1.45], [0.92, -1.45]].forEach(([wx, wz]) => {
      const wg = new THREE.Group();
      wg.position.set(wx, 0.34, wz);
      const wm = new THREE.Mesh(wGeo, dark); wm.rotation.z = Math.PI * 0.5; wg.add(wm);
      if (!isGhost) {
        const rm = new THREE.Mesh(ringGeo, ringMat); rm.rotation.y = Math.PI * 0.5;
        rm.position.x = wx > 0 ? 0.165 : -0.165; wg.add(rm);
      }
      g.add(wg);
      wheels.push(wg);
    });
    g.userData.rearWing = rwFlap;
    g.userData.rainLight = rainLight;
    g.userData.ringMat = ringMat;
    g.userData.wheels = wheels;
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
    const checkerTex = makeCheckeredTex();
    const board150Tex = makeBoardTex("150");
    const board100Tex = makeBoardTex("100");
    const board50Tex = makeBoardTex("50");

    let worldGroup = null;
    let skyUniforms = null;
    let envRT = null;
    let sunLight = null;
    let roadMat = null;
    let racingLineMesh = null;
    let racingLineColors = null;
    let racingLineMode = "full";
    let startLightMats = [];
    let marshalLedMat = null;
    let aiMeshes = new Map();
    let ghostMesh = null;
    let rainPoints = null;
    let sparkPool = null, smokePool = null, sprayPool = null, gravelPool = null, debrisPool = null;
    let currentTrack = null;
    let worldElapsed = 0;

    function resize() {
      const rect = canvasEl.getBoundingClientRect();
      const w = Math.max(320, Math.round(rect.width || window.innerWidth));
      const h = Math.max(240, Math.round(rect.height || window.innerHeight));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function clearWorld() {
      if (worldGroup) { scene.remove(worldGroup); worldGroup = null; }
      if (envRT) { envRT.dispose(); envRT = null; scene.environment = null; }
      aiMeshes.clear();
      ghostMesh = null;
      racingLineMesh = null;
      startLightMats = [];
      marshalLedMat = null;
      rainPoints = null;
      skyUniforms = null;
      sparkPool = smokePool = sprayPool = gravelPool = debrisPool = null;
    }

    function isClearOfTrack(x, z, pts, minDist) {
      const m2 = minDist * minDist;
      for (let i = 0; i < pts.length; i += 6) {
        const dx = x - pts[i].x, dz = z - pts[i].z;
        if (dx * dx + dz * dz < m2) return false;
      }
      return true;
    }

    function buildCircuit(circuit, track) {
      clearWorld();
      currentTrack = track;
      const theme = getTheme(circuit);
      const rng = mulberry32(hashStr(circuit.id));
      scene.background = new THREE.Color(theme.skyHor);
      scene.fog = new THREE.FogExp2(theme.fog, theme.isNight ? 0.00068 : 0.00028);

      envRT = buildEnvMap(renderer, theme);
      if (envRT) scene.environment = envRT.texture;

      worldGroup = new THREE.Group();
      scene.add(worldGroup);

      // 1. Custom GLSL Atmospheric Sky Dome
      const sky = buildSkyDome(theme);
      skyUniforms = sky.uniforms;
      worldGroup.add(sky.mesh);

      // 2. Lighting
      const hemi = new THREE.HemisphereLight(theme.skyHor, theme.ground, theme.isNight ? 1.05 : 1.38);
      worldGroup.add(hemi);
      sunLight = new THREE.DirectionalLight(theme.sunCol, theme.sunInt);
      sunLight.position.set(140, 220, 100);
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(1024, 1024);
      sunLight.shadow.camera.near = 15;
      sunLight.shadow.camera.far = 600;
      const sb = 115;
      sunLight.shadow.camera.left = -sb; sunLight.shadow.camera.right = sb;
      sunLight.shadow.camera.top = sb; sunLight.shadow.camera.bottom = -sb;
      worldGroup.add(sunLight);
      worldGroup.add(sunLight.target);

      // 3. Textured Biome Ground & Harbour/Lake Water
      const groundTex = makeGroundTex(theme.ground, theme.grassAlt);
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(9000, 9000),
        new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.94, metalness: 0.02 })
      );
      ground.rotation.x = -Math.PI * 0.5;
      ground.position.y = -0.36;
      ground.receiveShadow = true;
      worldGroup.add(ground);

      if (theme.water || circuit.id === "melbourne" || circuit.id === "monaco" || circuit.id === "montreal" || circuit.id === "abudhabi") {
        const wMesh = new THREE.Mesh(
          new THREE.CircleGeometry(240, 32),
          new THREE.MeshStandardMaterial({ color: theme.water || 0x0b74b8, roughness: 0.14, metalness: 0.72 })
        );
        wMesh.rotation.x = -Math.PI * 0.5;
        wMesh.position.set(0, -0.22, 0);
        worldGroup.add(wMesh);
      }

      const pts = track.pts;
      // 4. Multi-Layer Track Surface: Runoff Apron + PBR Asphalt + Stepped FIA Kerbs + Sponsor Barriers
      const runoff = new THREE.Mesh(
        buildRibbon(pts, -16.2, 16.2, 0.005, 0.04),
        new THREE.MeshStandardMaterial({ color: circuit.biome === "street" ? 0x3b4454 : (circuit.biome === "desert" ? 0xc89a64 : 0x2c6130), roughness: 0.92, side: THREE.DoubleSide })
      );
      runoff.receiveShadow = true;
      worldGroup.add(runoff);

      roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.70, metalness: 0.10, side: THREE.DoubleSide });
      const road = new THREE.Mesh(buildRibbon(pts, -7.5, 7.5, 0.03, 0.085), roadMat);
      road.receiveShadow = true;
      worldGroup.add(road);

      const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.62, side: THREE.DoubleSide });
      worldGroup.add(new THREE.Mesh(buildRibbon(pts, -9.0, -7.45, 0.055, 0.35), kerbMat));
      worldGroup.add(new THREE.Mesh(buildRibbon(pts, 7.45, 9.0, 0.055, 0.35), kerbMat));

      const barMat = new THREE.MeshStandardMaterial({ map: barrierTex, roughness: 0.48, side: THREE.DoubleSide });
      worldGroup.add(new THREE.Mesh(buildWall(pts, -16.1, 1.38), barMat));
      worldGroup.add(new THREE.Mesh(buildWall(pts, 16.1, 1.38), barMat));

      // 5. Start/Finish Gantry + 5 Interactive Start Lights + Checkered Line + Pit Garages
      const p0 = track.sample(0);
      const sYaw = Math.atan2(p0.tx, p0.tz);
      const gantry = new THREE.Group();
      gantry.position.set(p0.x, p0.y, p0.z);
      gantry.rotation.y = sYaw;
      const gMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.38, metalness: 0.65 });
      const postL = new THREE.Mesh(new THREE.BoxGeometry(0.75, 7.4, 0.75), gMat); postL.position.set(-10.8, 3.7, 0); gantry.add(postL);
      const postR = postL.clone(); postR.position.x = 10.8; gantry.add(postR);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(22.6, 1.3, 1.15), gMat); beam.position.set(0, 6.9, 0); gantry.add(beam);
      startLightMats = [];
      for (let i = 0; i < 5; i++) {
        const lMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
        startLightMats.push(lMat);
        const pod = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.65, 0.25), lMat);
        pod.position.set((i - 2) * 1.65, 6.25, -0.64);
        gantry.add(pod);
      }
      const sfStrip = new THREE.Mesh(new THREE.PlaneGeometry(14.8, 1.6), new THREE.MeshBasicMaterial({ map: checkerTex }));
      sfStrip.rotation.x = -Math.PI * 0.5; sfStrip.position.set(0, 0.055, 0); gantry.add(sfStrip);
      worldGroup.add(gantry);

      // Pit Building / Team Garages (cleared away from track)
      const pitSide = isClearOfTrack(p0.x + p0.rx * 28, p0.z + p0.rz * 28, pts, 19) ? 1 : -1;
      const pitBldg = new THREE.Mesh(
        new THREE.BoxGeometry(10.5, 6.8, 86),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.4 })
      );
      pitBldg.position.set(p0.x + p0.rx * (pitSide * 28), p0.y + 3.4, p0.z + p0.rz * (pitSide * 28));
      pitBldg.rotation.y = sYaw;
      worldGroup.add(pitBldg);

      // 6. Multi-Tier Grandstands along Main Straight & Corners (clearance-audited!)
      const gsMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.25 });
      const crowdMat = new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.8 });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.35, metalness: 0.4 });
      for (let k = 0; k < 8; k++) {
        const sp = track.sample((k / 8 + 0.03) % 1);
        for (const side of [-1, 1]) {
          const gx = sp.x + sp.rx * (side * 30);
          const gz = sp.z + sp.rz * (side * 30);
          if (!isClearOfTrack(gx, gz, pts, 21)) continue;
          const stand = new THREE.Group();
          stand.position.set(gx, sp.y, gz);
          stand.rotation.y = Math.atan2(sp.tx, sp.tz);
          const base = new THREE.Mesh(new THREE.BoxGeometry(11, 5.5, 36), gsMat); base.position.y = 2.75; stand.add(base);
          const deck = new THREE.Mesh(new THREE.BoxGeometry(8, 3.2, 34), crowdMat); deck.position.set(-side * 1.4, 3.8, 0); stand.add(deck);
          const roof = new THREE.Mesh(new THREE.BoxGeometry(12.5, 0.5, 37), roofMat); roof.position.set(-side * 0.6, 8.2, 0); stand.add(roof);
          worldGroup.add(stand);
          break;
        }
      }

      // 7. Overhead DRS Activation Gantries + 150m/100m/50m Braking Boards + Tyre Barriers
      const drsRanges = Array.isArray(circuit.drs_ranges) ? circuit.drs_ranges : [];
      const drsSignMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
      drsRanges.forEach(([a]) => {
        const sp = track.sample(a);
        const dg = new THREE.Group();
        dg.position.set(sp.x, sp.y, sp.z);
        dg.rotation.y = Math.atan2(sp.tx, sp.tz);
        const pL = new THREE.Mesh(new THREE.BoxGeometry(0.45, 5.8, 0.45), gMat); pL.position.set(-9.8, 2.9, 0); dg.add(pL);
        const pR = pL.clone(); pR.position.x = 9.8; dg.add(pR);
        const top = new THREE.Mesh(new THREE.BoxGeometry(20.2, 0.75, 0.55), gMat); top.position.set(0, 5.6, 0); dg.add(top);
        const glow = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.35, 0.6), drsSignMat); glow.position.set(0, 5.6, 0); dg.add(glow);
        worldGroup.add(dg);
      });

      const bZones = Array.isArray(circuit.braking_zones) ? circuit.braking_zones : [];
      const bMats = [[150, new THREE.MeshBasicMaterial({ map: board150Tex, side: THREE.DoubleSide })],
                     [100, new THREE.MeshBasicMaterial({ map: board100Tex, side: THREE.DoubleSide })],
                     [50,  new THREE.MeshBasicMaterial({ map: board50Tex, side: THREE.DoubleSide })]];
      const tyreRedMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.75 });
      const gravelTrapMat = new THREE.MeshStandardMaterial({ color: 0xc2a878, roughness: 0.96 });
      bZones.forEach((bz) => {
        const tZone = Number(bz.t || 0);
        const spZ = track.sample(tZone);
        const side = spZ.curv >= 0 ? -1 : 1;
        bMats.forEach(([distM, mat]) => {
          const pOff = (((tZone - distM / Math.max(1000, track.totalLen)) % 1) + 1) % 1;
          const sp = track.sample(pOff);
          const board = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 1.3), mat);
          board.position.set(sp.x + sp.rx * (side * 11.4), sp.y + 1.15, sp.z + sp.rz * (side * 11.4));
          board.rotation.y = Math.atan2(sp.tx, sp.tz);
          worldGroup.add(board);
        });
        // Gravel trap & FIA tyre barrier stack outside heavy braking apex!
        const trap = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 22), gravelTrapMat);
        trap.rotation.x = -Math.PI * 0.5;
        trap.position.set(spZ.x + spZ.rx * (side * 12.6), spZ.y + 0.02, spZ.z + spZ.rz * (side * 12.6));
        trap.rotation.z = -Math.atan2(spZ.tx, spZ.tz);
        worldGroup.add(trap);
        const tb = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 16), tyreRedMat);
        tb.position.set(spZ.x + spZ.rx * (side * 15.2), spZ.y + 0.6, spZ.z + spZ.rz * (side * 15.2));
        tb.rotation.y = Math.atan2(spZ.tx, spZ.tz);
        worldGroup.add(tb);
      });

      // 8. Live Digital FIA Marshal LED Flag Panels (16 around circuit, synced to weather/track status!)
      marshalLedMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
      for (let m = 0; m < 16; m++) {
        const sp = track.sample((m + 0.4) / 16);
        const side = m % 2 === 0 ? 1 : -1;
        const post = new THREE.Group();
        post.position.set(sp.x + sp.rx * (side * 11.8), sp.y, sp.z + sp.rz * (side * 11.8));
        post.rotation.y = Math.atan2(sp.tx, sp.tz);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 3.2, 6), gMat); pole.position.y = 1.6; post.add(pole);
        const led = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.9, 0.22), marshalLedMat); led.position.y = 3.2; post.add(led);
        worldGroup.add(post);
      }

      // 9. GPU-Instanced Biome Trees or Night Floodlight Towers (Zero Draw-Call Overhead!)
      const scCount = 120;
      const scPos = [];
      for (let i = 0; i < scCount * 3 && scPos.length < scCount; i++) {
        const sp = track.sample(rng());
        const side = rng() > 0.5 ? 1 : -1;
        const off = 24 + rng() * 52;
        const x = sp.x + sp.rx * (side * off);
        const z = sp.z + sp.rz * (side * off);
        if (isClearOfTrack(x, z, pts, 20)) scPos.push({ x, y: sp.y, z, sc: 0.75 + rng() * 0.7 });
      }
      if (scPos.length) {
        const dummy = new THREE.Object3D();
        if (theme.isNight || circuit.biome === "desert") {
          const towerMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.48, 16, 6), gMat, scPos.length);
          const lampMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.7, 0.7), new THREE.MeshBasicMaterial({ color: 0xfef3c7 }), scPos.length);
          scPos.forEach((p, idx) => {
            dummy.position.set(p.x, p.y + 8, p.z); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
            towerMesh.setMatrixAt(idx, dummy.matrix);
            dummy.position.set(p.x, p.y + 16.2, p.z); dummy.updateMatrix();
            lampMesh.setMatrixAt(idx, dummy.matrix);
          });
          worldGroup.add(towerMesh); worldGroup.add(lampMesh);
        } else {
          const trunkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 4.2, 6), new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.9 }), scPos.length);
          const crownMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(2.8, 7.2, 7), new THREE.MeshStandardMaterial({ color: 0x22542b, roughness: 0.85 }), scPos.length);
          scPos.forEach((p, idx) => {
            dummy.position.set(p.x, p.y + 2.1 * p.sc, p.z); dummy.scale.setScalar(p.sc); dummy.updateMatrix();
            trunkMesh.setMatrixAt(idx, dummy.matrix);
            dummy.position.set(p.x, p.y + 6.4 * p.sc, p.z); dummy.updateMatrix();
            crownMesh.setMatrixAt(idx, dummy.matrix);
          });
          worldGroup.add(trunkMesh); worldGroup.add(crownMesh);
        }
      }

      // 10. Dynamic 3D Racing & Braking Line Ribbon
      const n = pts.length;
      const rlPos = new Float32Array((n + 1) * 6);
      const rlCol = new Float32Array((n + 1) * 6);
      const rlIdx = [];
      for (let i = 0; i <= n; i++) {
        const p = pts[i % n];
        const lat = p.optLat || 0;
        const cx = p.x + p.rx * lat, cz = p.z + p.rz * lat;
        const vi = i * 6;
        rlPos[vi]     = cx - p.rx * 0.42; rlPos[vi + 1] = p.y + 0.09; rlPos[vi + 2] = cz - p.rz * 0.42;
        rlPos[vi + 3] = cx + p.rx * 0.42; rlPos[vi + 4] = p.y + 0.09; rlPos[vi + 5] = cz + p.rz * 0.42;
        rlCol[vi] = 0.13; rlCol[vi + 1] = 0.77; rlCol[vi + 2] = 0.37;
        rlCol[vi + 3] = 0.13; rlCol[vi + 4] = 0.77; rlCol[vi + 5] = 0.37;
        if (i < n) { const b = i * 2; rlIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
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

      // 11. 5 Live GPU Particle Pools (Sparks, Lockup Smoke, Wet Spray, Gravel Dust, Carbon Debris) + Rain
      sparkPool  = createParticlePool(180, 0xfbbf24, 0.34, 0.95, true);
      smokePool  = createParticlePool(140, 0xe2e8f0, 0.95, 0.46, false);
      sprayPool  = createParticlePool(220, 0xbae6fd, 1.15, 0.32, false);
      gravelPool = createParticlePool(120, 0xc2a878, 0.75, 0.55, false);
      debrisPool = createParticlePool(90,  0x1e293b, 0.32, 0.95, false);
      worldGroup.add(sparkPool.points, smokePool.points, sprayPool.points, gravelPool.points, debrisPool.points);

      const rCount = 1100;
      const rPos = new Float32Array(rCount * 3);
      for (let i = 0; i < rCount; i++) {
        rPos[i * 3] = (Math.random() - 0.5) * 95;
        rPos[i * 3 + 1] = Math.random() * 28;
        rPos[i * 3 + 2] = (Math.random() - 0.5) * 95;
      }
      const rGeo = new THREE.BufferGeometry();
      rGeo.setAttribute("position", new THREE.BufferAttribute(rPos, 3));
      rainPoints = new THREE.Points(rGeo, new THREE.PointsMaterial({ color: 0xbae6fd, size: 0.28, transparent: true, opacity: 0.58 }));
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
        let r = 0.12, g = 0.84, b = 0.44;
        if (diff > 7.5) { r = 0.96; g = 0.16; b = 0.18; }
        else if (diff > -1.5) { r = 0.98; g = 0.76; b = 0.12; }
        else if (racingLineMode === "corners") { r = 0.08; g = 0.18; b = 0.14; }
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

    function syncAiCars(aiCars, ghostPose, wetness) {
      if (!worldGroup) return;
      const activeIds = new Set();
      const wetOn = (wetness || 0) >= 22;
      const rainBlink = Math.floor(worldElapsed * 6) % 2 === 0;
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
        if (mesh.userData.rearWing) mesh.userData.rearWing.rotation.x = a.drsOpen ? 0.35 : 0.0;
        if (mesh.userData.ringMat) mesh.userData.ringMat.color.setHex(COMPOUND_HEX[a.compound] || COMPOUND_HEX.soft);
        if (mesh.userData.rainLight) mesh.userData.rainLight.visible = !wetOn || rainBlink;
        if (mesh.userData.wheels) {
          for (let w = 0; w < mesh.userData.wheels.length; w++) mesh.userData.wheels[w].rotation.x += (a.vx || 40) * 0.045;
        }
        // Rooster-tail wet rain spray behind AI cars!
        if (wetOn && sprayPool && !a.dnf && a.vx > 25 && Math.random() < 0.45) {
          const sx = Math.sin(a.yaw), cz = Math.cos(a.yaw);
          sprayPool.emit(
            a.x - sx * 2.2 + (Math.random() - 0.5) * 1.4,
            a.y + 0.45,
            a.z - cz * 2.2 + (Math.random() - 0.5) * 1.4,
            -sx * 5 + (Math.random() - 0.5) * 2.2,
            1.6 + Math.random() * 1.4,
            -cz * 5 + (Math.random() - 0.5) * 2.2,
            0.55
          );
        }
      }
      for (const [id, mesh] of aiMeshes.entries()) {
        if (!activeIds.has(id)) { worldGroup.remove(mesh); aiMeshes.delete(id); }
      }

      if (ghostPose) {
        if (!ghostMesh) { ghostMesh = makeAiCarMesh("#22d3ee", true); worldGroup.add(ghostMesh); }
        ghostMesh.visible = true;
        ghostMesh.position.set(ghostPose.x, ghostPose.y + 0.05, ghostPose.z);
        ghostMesh.rotation.y = ghostPose.yaw;
      } else if (ghostMesh) {
        ghostMesh.visible = false;
      }
    }

    function updateWeatherAndFX(car, wetness, dt) {
      const stepDt = dt || 0.016;
      worldElapsed += stepDt;
      const wet = Math.max(0, Math.min(1, (wetness || 0) / 100));

      if (skyUniforms) {
        skyUniforms.uTime.value = worldElapsed;
        skyUniforms.uWet.value = wet;
      }
      if (roadMat) {
        roadMat.roughness = 0.70 - wet * 0.54;
        roadMat.metalness = 0.10 + wet * 0.42;
      }
      // Update Digital FIA Marshal LED Panels (Yellow when off-track/impact, Cyan when heavy rain, Green otherwise!)
      if (marshalLedMat && car) {
        if (car.surface === "runoff" || (car.impactStrength || 0) > 0.15) marshalLedMat.color.setHex(0xfacc15);
        else if (wet > 0.35) marshalLedMat.color.setHex(0x38bdf8);
        else marshalLedMat.color.setHex(0x22c55e);
      }

      // Emit Live Player Particle FX!
      if (car) {
        const sx = Math.sin(car.yaw), cz = Math.cos(car.yaw);
        const rx = -cz, rz = sx;

        // 1. Titanium Plank Bottoming Sparks!
        if (sparkPool && (car.bottoming || 0) > 0.18) {
          const nSp = Math.ceil(car.bottoming * 5);
          for (let i = 0; i < nSp; i++) {
            sparkPool.emit(
              car.x - sx * 1.4 + (Math.random() - 0.5) * 0.6,
              car.y + 0.12,
              car.z - cz * 1.4 + (Math.random() - 0.5) * 0.6,
              -sx * 12 + (Math.random() - 0.5) * 4,
              1.4 + Math.random() * 2.8,
              -cz * 12 + (Math.random() - 0.5) * 4,
              0.38
            );
          }
        }
        // 2. White Tyre Lockup / Wheelspin Smoke!
        if (smokePool && (car.lockingFront || car.wheelSpinRear) && (car.speedKph || 0) > 30) {
          const zOff = car.lockingFront ? 1.85 : -1.5;
          [-0.9, 0.9].forEach((side) => {
            smokePool.emit(
              car.x + sx * zOff + rx * side,
              car.y + 0.22,
              car.z + cz * zOff + rz * side,
              (Math.random() - 0.5) * 2.2,
              0.9 + Math.random() * 1.1,
              (Math.random() - 0.5) * 2.2,
              0.65
            );
          });
        }
        // 3. Gravel / Off-Track Dust Plumes!
        if (gravelPool && (car.gravelIntensity || 0) > 0.08) {
          for (let i = 0; i < 3; i++) {
            gravelPool.emit(
              car.x - sx * 1.2 + (Math.random() - 0.5) * 1.6,
              car.y + 0.25,
              car.z - cz * 1.2 + (Math.random() - 0.5) * 1.6,
              -sx * 5 + (Math.random() - 0.5) * 3.5,
              1.4 + Math.random() * 2.0,
              -cz * 5 + (Math.random() - 0.5) * 3.5,
              0.70
            );
          }
        }
        // 4. Carbon Debris Burst on Wall / Car Impact!
        if (debrisPool && (car.impactStrength || 0) > 0.22) {
          const burst = Math.ceil(car.impactStrength * 14);
          for (let i = 0; i < burst; i++) {
            debrisPool.emit(
              car.x + sx * 2.4 + (Math.random() - 0.5) * 1.2,
              car.y + 0.45,
              car.z + cz * 2.4 + (Math.random() - 0.5) * 1.2,
              (Math.random() - 0.5) * 14,
              2.5 + Math.random() * 5.5,
              (Math.random() - 0.5) * 14,
              0.95
            );
          }
        }
      }

      if (sparkPool)  sparkPool.step(stepDt, 9.5);
      if (smokePool)  smokePool.step(stepDt, -0.6);
      if (sprayPool)  sprayPool.step(stepDt, 1.5);
      if (gravelPool) gravelPool.step(stepDt, 3.2);
      if (debrisPool) debrisPool.step(stepDt, 14.0);

      if (rainPoints && car) {
        rainPoints.visible = (wetness || 0) >= 20;
        if (rainPoints.visible) {
          rainPoints.position.set(car.x, car.y, car.z);
          const pos = rainPoints.geometry.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            let y = pos.getY(i) - stepDt * 30;
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

    function render() { renderer.render(scene, camera); }

    function dispose() {
      clearWorld();
      asphaltTex.dispose(); kerbTex.dispose(); barrierTex.dispose(); checkerTex.dispose();
      board150Tex.dispose(); board100Tex.dispose(); board50Tex.dispose();
      renderer.dispose();
    }

    return {
      scene, camera, resize, buildCircuit, updateRacingLine, setStartLights,
      syncAiCars,
      updateWeather: updateWeatherAndFX,
      cycleRacingLine, getRacingLineMode: () => racingLineMode,
      render, dispose,
    };
  }

  global.F1DriveWorld3D = { createDriveWorld };
})(window);
