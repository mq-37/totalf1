/**
 * Next-Gen Live 3D Race-Weekend Broadcast Engine (/sim & /career).
 *
 * Multi-Tech WebGL2 Graphics Pipeline:
 *   1. Real-Time PMREM Procedural HDR Sky/Studio Environment Reflections + PCFSoftShadowMap Sun
 *   2. Custom GLSL Atmospheric Sky Dome Shader (Rayleigh/Mie gradient, volumetric sun, FBM clouds, stars)
 *   3. Custom GLSL Wet/Dry PBR Asphalt + Rubbered Racing Groove + Stepped FIA Kerbs + Catch Fencing
 *   4. Sculpted 20-Car Grid (F1Car3D Hero LOD + Aerodynamic Sculpted Grid LOD) with Pirelli compound
 *      tyre sidewall rings, glowing carbon brake discs, active DRS indicator, rain light, sparks & spray
 *   5. GPU-Instanced Animated Stadium Crowd (5,000+ colourful fans jumping & waving foaming beer cups!)
 *   6. GLSL Wind-Rippling Flags + Rising Tifosi/Orange-Army Party Smoke Flares + Multi-Tier Grandstands
 *   7. Active Race-Weekend Festival Zone: Rotating Illuminated Giant Ferris Wheel, Beer Garden Marquees,
 *      Live DJ/Concert Stage with pulsing beams, Orbiting TV Helicopter & Signature Circuit Landmarks
 *   8. Dynamic HTML5 Canvas2D -> GPU Live LED Jumbotron Screens displaying live P1/P2/P3 & Lap status!
 */
(function (global) {
  "use strict";

  const BIOME_THEMES = {
    parkland:     { skyTop: 0x1d6fd6, skyHor: 0xaad8ff, sunCol: 0xfff5d6, ground: 0x3b7a38, grassAlt: 0x4b8f42, fog: 0x9bc9ef, sunInt: 2.15, isNight: false, kerbA: "#dc2626", kerbB: "#f8fafc", lake: 0x1e88c8 },
    harbour:      { skyTop: 0x1565c8, skyHor: 0x9ed6ff, sunCol: 0xfff4d4, ground: 0x475569, grassAlt: 0x3f6e45, fog: 0x8ec5ea, sunInt: 2.25, isNight: false, kerbA: "#dc2626", kerbB: "#f8fafc", water: 0x0b74b8 },
    coastal:      { skyTop: 0x1874d2, skyHor: 0xa8ddff, sunCol: 0xfff7dd, ground: 0x4b7f44, grassAlt: 0x6b944f, fog: 0x99cef0, sunInt: 2.25, isNight: false, kerbA: "#2563eb", kerbB: "#f8fafc", water: 0x0ea5e9 },
    street:       { skyTop: 0x2563b8, skyHor: 0xa6cbe8, sunCol: 0xfff1cc, ground: 0x475060, grassAlt: 0x3e5e46, fog: 0x8db6da, sunInt: 2.05, isNight: false, kerbA: "#dc2626", kerbB: "#facc15" },
    desert:       { skyTop: 0x2574d0, skyHor: 0xf6d19c, sunCol: 0xffe4a8, ground: 0xd9a76a, grassAlt: 0xc99357, fog: 0xe6c89d, sunInt: 2.35, isNight: false, kerbA: "#dc2626", kerbB: "#ffffff" },
    night_desert: { skyTop: 0x071024, skyHor: 0x1d2948, sunCol: 0xdbeafe, ground: 0x2a2530, grassAlt: 0x352e3a, fog: 0x121b33, sunInt: 1.35, isNight: true,  kerbA: "#ef4444", kerbB: "#f8fafc" },
    night_street: { skyTop: 0x060c1f, skyHor: 0x1b2646, sunCol: 0xe0f2fe, ground: 0x212938, grassAlt: 0x283244, fog: 0x111a30, sunInt: 1.40, isNight: true,  kerbA: "#ef4444", kerbB: "#facc15" },
  };

  const COMPOUND_HEX = {
    soft:   0xef4444,
    medium: 0xfacc15,
    hard:   0xf8fafc,
    inter:  0x22c55e,
    wet:    0x3b82f6,
  };

  // Vibrant mixed festival crowd shirt & hat palette (Tifosi, Orange Army, Papaya, Merc Teal, RB, Summer!)
  const FAN_PALETTE = [
    0xe10600, 0xff2800, 0xff6b00, 0xff8700, 0xffa500,
    0x00d2be, 0x1e41ff, 0x0090ff, 0x38bdf8, 0x006f62,
    0xfacc15, 0xfde047, 0xec4899, 0xa855f7, 0x22c55e,
    0xffffff, 0xf1f5f9, 0x38bdf8, 0xfb7185, 0x34d399,
  ];

  function getTheme(circuit) {
    if (circuit && circuit.is_night) {
      return circuit.biome && circuit.biome.includes("desert") ? BIOME_THEMES.night_desert : BIOME_THEMES.night_street;
    }
    const b = (circuit && circuit.biome) || "parkland";
    return BIOME_THEMES[b] || BIOME_THEMES.parkland;
  }

  // Deterministic pseudo-random helper so each circuit has rich, repeatable landmarks & festival placement
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
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function buildRibbonGeo(pts, leftOff, rightOff, yElev, closed, uvScale, useBank) {
    const n = pts.length;
    const count = closed ? n + 1 : n;
    const positions = new Float32Array(count * 2 * 3);
    const uvs = new Float32Array(count * 2 * 2);
    const indices = [];
    const sc = uvScale || 0.08;

    let dist = 0;
    for (let i = 0; i < count; i++) {
      const p = pts[i % n];
      if (i > 0) {
        const prev = pts[(i - 1) % n];
        dist += Math.hypot(p.x - prev.x, p.z - prev.z);
      }
      const rx = -p.tz;
      const rz = p.tx;
      const baseY = p.y || 0;
      const bSin = (useBank && p.bankRad) ? Math.sin(p.bankRad) : 0;
      const vi = i * 6;
      positions[vi]     = p.x + rx * leftOff;  positions[vi + 1] = baseY + yElev + bSin * leftOff;  positions[vi + 2] = p.z + rz * leftOff;
      positions[vi + 3] = p.x + rx * rightOff; positions[vi + 4] = baseY + yElev + bSin * rightOff; positions[vi + 5] = p.z + rz * rightOff;

      const ui = i * 4;
      uvs[ui]     = 0; uvs[ui + 1] = dist * sc;
      uvs[ui + 2] = 1; uvs[ui + 3] = dist * sc;

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

  function buildEmbankmentSkirtGeo(pts, innerOff, sign) {
    const n = pts.length;
    const count = n + 1;
    const positions = new Float32Array(count * 2 * 3);
    const indices = [];
    for (let i = 0; i < count; i++) {
      const p = pts[i % n];
      const rx = -p.tz;
      const rz = p.tx;
      const baseY = p.y || 0;
      const bSin = p.bankRad ? Math.sin(p.bankRad) : 0;
      const topY = baseY + 0.005 + bSin * innerOff;
      const skirtW = Math.max(9.0, topY * 1.45 + 7.5);
      const outerOff = innerOff + sign * skirtW;
      const vi = i * 6;
      positions[vi]     = p.x + rx * innerOff; positions[vi + 1] = topY;  positions[vi + 2] = p.z + rz * innerOff;
      positions[vi + 3] = p.x + rx * outerOff; positions[vi + 4] = -0.35; positions[vi + 5] = p.z + rz * outerOff;
      if (i < count - 1) {
        const b = i * 2;
        indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  // ---------------------------------------------------------------------------
  // Procedural PBR Canvas Textures (Asphalt, Grass Meadow, Sponsor Walls, Kerbs)
  // ---------------------------------------------------------------------------
  function makeAsphaltTextures() {
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 512;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#343b46";
    ctx.fillRect(0, 0, 512, 512);
    // Fine aggregate stone texture
    for (let i = 0; i < 12000; i++) {
      const v = 42 + Math.floor(Math.random() * 34);
      ctx.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    // Rubbered-in racing grooves (twin tyre tracks)
    const g1 = ctx.createLinearGradient(0, 0, 512, 0);
    g1.addColorStop(0.00, "rgba(0,0,0,0)");
    g1.addColorStop(0.24, "rgba(12,15,20,0.34)");
    g1.addColorStop(0.36, "rgba(12,15,20,0.08)");
    g1.addColorStop(0.64, "rgba(12,15,20,0.08)");
    g1.addColorStop(0.76, "rgba(12,15,20,0.34)");
    g1.addColorStop(1.00, "rgba(0,0,0,0)");
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, 512, 512);

    // Crisp FIA white track limit lines
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(16, 0, 10, 512);
    ctx.fillRect(486, 0, 10, 512);

    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function makeGroundTexture(baseHex, altHex, isDesert) {
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 512;
    const ctx = cv.getContext("2d");
    const c1 = new THREE.Color(baseHex);
    const c2 = new THREE.Color(altHex);
    ctx.fillStyle = `#${c1.getHexString()}`;
    ctx.fillRect(0, 0, 512, 512);
    // Mowed grass stripes or desert ripple bands + sunlit speckles
    ctx.fillStyle = `#${c2.getHexString()}`;
    ctx.globalAlpha = isDesert ? 0.25 : 0.34;
    for (let y = 0; y < 512; y += 32) {
      ctx.fillRect(0, y, 512, 16);
    }
    ctx.globalAlpha = 0.20;
    for (let i = 0; i < 6500; i++) {
      ctx.fillStyle = (i % 3 === 0) ? "#ffffff" : `#${c2.getHexString()}`;
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 3, 3);
    }
    ctx.globalAlpha = 1.0;
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(95, 95);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function makeKerbTexture(colA, colB) {
    const cv = document.createElement("canvas");
    cv.width = 64; cv.height = 128;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = colA || "#dc2626"; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = colB || "#f8fafc"; ctx.fillRect(0, 64, 64, 64);
    // Subtle grip ridges
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    for (let y = 0; y < 128; y += 8) ctx.fillRect(0, y, 64, 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function makeSponsorWallTexture() {
    const cv = document.createElement("canvas");
    cv.width = 1024; cv.height = 128;
    const ctx = cv.getContext("2d");
    const panels = [
      { bg: "#e10600", fg: "#ffffff", txt: "LOCAL F1 GRAND PRIX" },
      { bg: "#0f172a", fg: "#facc15", txt: "PIRELLI  P-ZERO" },
      { bg: "#0284c7", fg: "#ffffff", txt: "APEX TELEMETRY" },
      { bg: "#15803d", fg: "#fef08a", txt: "FAN FESTIVAL · LIVE" },
      { bg: "#1e1b4b", fg: "#38bdf8", txt: "DRS ZONE · HYBRID" },
      { bg: "#b91c1c", fg: "#ffffff", txt: "GRAND PRIX WEEKEND" },
      { bg: "#ea580c", fg: "#ffffff", txt: "FAN ZONE · BEERS & MUSIC" },
      { bg: "#0f766e", fg: "#ffffff", txt: "FIA CHAMPIONSHIP" },
    ];
    const pw = 1024 / panels.length;
    panels.forEach((p, idx) => {
      const x = idx * pw;
      ctx.fillStyle = p.bg;
      ctx.fillRect(x, 0, pw, 128);
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.fillRect(x, 0, pw, 10);
      ctx.fillRect(x, 118, pw, 10);
      ctx.fillStyle = p.fg;
      ctx.font = "900 18px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.txt, x + pw * 0.5, 66, pw - 14);
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function makeCheckeredLineTexture() {
    const cv = document.createElement("canvas");
    cv.width = 256; cv.height = 64;
    const ctx = cv.getContext("2d");
    const sz = 16;
    for (let y = 0; y < 64; y += sz) {
      for (let x = 0; x < 256; x += sz) {
        ctx.fillStyle = ((x / sz + y / sz) % 2 === 0) ? "#f8fafc" : "#0f172a";
        ctx.fillRect(x, y, sz, sz);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ---------------------------------------------------------------------------
  // Custom GLSL Physical Atmospheric Sky Dome (Daylight, Clouds, Sun, Night Stars)
  // ---------------------------------------------------------------------------
  function buildSkyDome(theme) {
    const uniforms = {
      uTopColor:    { value: new THREE.Color(theme.skyTop) },
      uHorColor:    { value: new THREE.Color(theme.skyHor) },
      uSunColor:    { value: new THREE.Color(theme.sunCol) },
      uSunDir:      { value: new THREE.Vector3(0.45, theme.isNight ? 0.25 : 0.42, 0.35).normalize() },
      uTime:        { value: 0 },
      uIsNight:     { value: theme.isNight ? 1.0 : 0.0 },
      uWetness:     { value: 0.0 },
    };

    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms,
      vertexShader: `
        varying vec3 vWorldDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(position);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uTopColor;
        uniform vec3 uHorColor;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        uniform float uTime;
        uniform float uIsNight;
        uniform float uWetness;
        varying vec3 vWorldDir;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise(p);
            p *= 2.04;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 dir = normalize(vWorldDir);
          float h = clamp(dir.y, 0.0, 1.0);
          vec3 col = mix(uHorColor, uTopColor, pow(h, 0.52));

          // Overcast storm tint as wetness increases
          vec3 stormCol = mix(vec3(0.45, 0.50, 0.58), vec3(0.18, 0.23, 0.31), pow(h, 0.6));
          col = mix(col, stormCol, uWetness * 0.62 * (1.0 - uIsNight * 0.6));

          if (uIsNight < 0.5) {
            // Crisp glowing sun disc + warm Mie scattering halo
            float sunDot = max(dot(dir, uSunDir), 0.0);
            col += uSunColor * pow(sunDot, 12.0) * 0.36 * (1.0 - uWetness * 0.7);
            col += uSunColor * smoothstep(0.9965, 0.9992, sunDot) * 1.45 * (1.0 - uWetness * 0.8);

            // Drifting sunlit cumulus clouds
            if (dir.y > 0.03) {
              vec2 uv = dir.xz / (dir.y + 0.18) * 1.45 + vec2(uTime * 0.012, uTime * 0.005);
              float cl = fbm(uv);
              float thresh = mix(0.54, 0.34, uWetness);
              float cloudMask = smoothstep(thresh, thresh + 0.26, cl) * smoothstep(0.03, 0.22, dir.y);
              vec3 cloudCol = mix(vec3(0.98, 0.99, 1.0), vec3(0.62, 0.67, 0.74), uWetness);
              col = mix(col, cloudCol, cloudMask * 0.78);
            }
          } else {
            // Starfield & vibrant stadium horizon glow at night!
            if (dir.y > 0.06) {
              vec2 sp = floor(dir.xz / (dir.y + 0.25) * 140.0);
              float st = hash21(sp);
              if (st > 0.992) {
                float tw = 0.6 + 0.4 * sin(uTime * 2.5 + st * 90.0);
                col += vec3(0.85, 0.92, 1.0) * tw * smoothstep(0.06, 0.3, dir.y);
              }
            }
            col += vec3(0.14, 0.22, 0.42) * pow(1.0 - h, 4.5);
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(3600, 32, 20), mat);
    return { mesh, uniforms };
  }

  // ---------------------------------------------------------------------------
  // PMREM Procedural HDR Sky/Studio Environment (Makes F1 Clearcoat & Metal Pop!)
  // ---------------------------------------------------------------------------
  function buildEnvMap(renderer, theme) {
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(theme.skyHor);
      const hemi = new THREE.HemisphereLight(theme.skyTop, theme.ground, theme.isNight ? 1.4 : 2.6);
      envScene.add(hemi);
      const panelGeo = new THREE.PlaneGeometry(40, 40);
      const sunPanel = new THREE.Mesh(panelGeo, new THREE.MeshBasicMaterial({ color: theme.sunCol, side: THREE.DoubleSide }));
      sunPanel.position.set(16, 26, 12);
      sunPanel.lookAt(0, 0, 0);
      envScene.add(sunPanel);
      const skyPanel = new THREE.Mesh(panelGeo, new THREE.MeshBasicMaterial({ color: theme.skyTop, side: THREE.DoubleSide }));
      skyPanel.position.set(-18, 22, -14);
      skyPanel.lookAt(0, 0, 0);
      envScene.add(skyPanel);
      const rt = pmrem.fromScene(envScene, 0.04);
      pmrem.dispose();
      panelGeo.dispose();
      return rt;
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Sculpted Aerodynamic Fast-LOD F1 Car (NO clunky boxes for non-hero cars!)
  // + Dynamic Compound Tyre Sidewalls, Glowing Brake Discs, DRS & Rain Light
  // ---------------------------------------------------------------------------
  function makeSculptedGridCar(colorHex) {
    const grp = new THREE.Group();
    const col = new THREE.Color(colorHex || "#e10600");
    const paintMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.22, metalness: 0.55 });
    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x161b26, roughness: 0.48, metalness: 0.32 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.18, metalness: 0.85 });

    // Tapered sculpted monocoque + nose cone
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.08, 4.95), carbonMat);
    floor.position.set(0, 0.12, 0.05);
    grp.add(floor);

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.44, 3.65), paintMat);
    chassis.position.set(0, 0.38, -0.05);
    grp.add(chassis);

    const noseGeo = new THREE.ConeGeometry(0.42, 1.95, 6);
    noseGeo.rotateX(Math.PI * 0.5);
    noseGeo.scale(1.05, 0.58, 1.0);
    const nose = new THREE.Mesh(noseGeo, paintMat);
    nose.position.set(0, 0.30, 2.55);
    grp.add(nose);

    // Sculpted undercut sidepods (left & right)
    [-0.64, 0.64].forEach((sx) => {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.36, 2.25), paintMat);
      pod.position.set(sx, 0.34, -0.25);
      grp.add(pod);
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.12), carbonMat);
      intake.position.set(sx, 0.37, 0.88);
      grp.add(intake);
    });

    // Airbox & shark fin engine cover
    const airbox = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 1.65), paintMat);
    airbox.position.set(0, 0.72, -0.68);
    grp.add(airbox);

    // Swept multi-element Front Wing + Endplates
    const fwMain = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.08, 0.52), paintMat);
    fwMain.position.set(0, 0.17, 3.12);
    grp.add(fwMain);
    [-1.02, 1.02].forEach((ex) => {
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.56), carbonMat);
      ep.position.set(ex, 0.26, 3.10);
      grp.add(ep);
    });

    // Rear Wing + Hinged DRS Upper Flap + Endplates
    const rwLower = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.08, 0.34), carbonMat);
    rwLower.position.set(0, 0.86, -2.28);
    grp.add(rwLower);
    const drsPivot = new THREE.Group();
    drsPivot.position.set(0, 1.06, -2.38);
    const rwDrs = new THREE.Mesh(new THREE.BoxGeometry(1.40, 0.18, 0.10), paintMat);
    rwDrs.position.set(0, -0.06, 0.03);
    rwDrs.name = "drs_flap";
    drsPivot.add(rwDrs);
    grp.add(drsPivot);
    grp.userData.drsFlap = drsPivot;
    [-0.72, 0.72].forEach((ex) => {
      const rep = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.56, 0.46), paintMat);
      rep.position.set(ex, 0.84, -2.28);
      grp.add(rep);
    });

    // Cockpit Halo + Driver Helmet
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 6, 14, Math.PI), carbonMat);
    halo.rotation.x = Math.PI * 0.5;
    halo.position.set(0, 0.72, 0.34);
    grp.add(halo);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), chromeMat);
    helmet.position.set(0, 0.72, 0.08);
    grp.add(helmet);

    // 4 Wide Pirelli Tyres (individually articulated for spin & front-wheel steering!)
    const tyreGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.42, 16);
    tyreGeo.rotateZ(Math.PI * 0.5);
    const spokeGeo = new THREE.BoxGeometry(0.43, 0.06, 0.42);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide });
    const ringGeo = new THREE.RingGeometry(0.21, 0.27, 20);
    grp.userData.wheels = [];
    grp.userData.tyreRingMat = ringMat;
    [
      [-0.96, 0.36,  1.82, true,  -1],
      [ 0.96, 0.36,  1.82, true,   1],
      [-1.00, 0.36, -1.52, false, -1],
      [ 1.00, 0.36, -1.52, false,  1],
    ].forEach(([x, y, z, isFront, side]) => {
      const wg = new THREE.Group();
      wg.position.set(x, y, z);
      wg.rotation.order = "YXZ";
      wg.userData.isFront = isFront;
      const wMesh = new THREE.Mesh(tyreGeo, carbonMat);
      const spk = new THREE.Mesh(spokeGeo, chromeMat);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.x = side * 0.214;
      ring.rotation.y = side > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
      wg.add(wMesh, spk, ring);
      grp.add(wg);
      grp.userData.wheels.push(wg);
    });

    return grp;
  }

  function attachDynamicCarFX(carGrp) {
    // 1. Soft grounded contact shadow underneath car
    const shGeo = new THREE.PlaneGeometry(2.6, 5.9);
    shGeo.rotateX(-Math.PI * 0.5);
    const shMat = new THREE.MeshBasicMaterial({ color: 0x050811, transparent: true, opacity: 0.46, depthWrite: false });
    const shadow = new THREE.Mesh(shGeo, shMat);
    shadow.position.set(0, 0.03, 0.15);
    carGrp.add(shadow);

    // 2. Compound-Coloured Pirelli Sidewall Rings (reuse integrated wheel ringMat when available so rings spin & steer!)
    let ringMat = carGrp.userData && carGrp.userData.tyreRingMat;
    if (!ringMat) {
      ringMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide });
      const ringGeo = new THREE.RingGeometry(0.21, 0.27, 20);
      const wheelCoords = [
        [-1.02, 0.36,  1.72, -Math.PI * 0.5],
        [ 1.02, 0.36,  1.72,  Math.PI * 0.5],
        [-1.06, 0.36, -1.64, -Math.PI * 0.5],
        [ 1.06, 0.36, -1.64,  Math.PI * 0.5],
      ];
      wheelCoords.forEach(([x, y, z, ry]) => {
        const r = new THREE.Mesh(ringGeo, ringMat);
        r.position.set(x, y, z);
        r.rotation.y = ry;
        carGrp.add(r);
      });
    }

    // 3. Glowing Carbon Brake Discs (Front Left & Right — glow bright cherry-orange under braking!)
    const brakeMat = new THREE.MeshBasicMaterial({ color: 0xff3d00, transparent: true, opacity: 0.0 });
    const brakeGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.09, 12);
    brakeGeo.rotateZ(Math.PI * 0.5);
    const brL = new THREE.Mesh(brakeGeo, brakeMat); brL.position.set(-0.82, 0.36, 1.82); carGrp.add(brL);
    const brR = new THREE.Mesh(brakeGeo, brakeMat); brR.position.set( 0.82, 0.36, 1.82); carGrp.add(brR);

    // 4. FIA Rear Rain / ERS Safety Blinker Light
    const rainMat = new THREE.MeshBasicMaterial({ color: 0xff1100, transparent: true, opacity: 0.25 });
    const rainLight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.06), rainMat);
    rainLight.position.set(0, 0.34, -2.54);
    carGrp.add(rainLight);

    // 5. Subtle Green DRS Active Strip on rear wing
    const drsMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.0 });
    const drsBar = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.06, 0.06), drsMat);
    drsBar.position.set(0, 1.06, -2.38);
    carGrp.add(drsBar);

    // 6. Procedural Damaged Front-Wing Overlay (visibly cracked/tilted endplate scraping asphalt!)
    const dmgWingGrp = new THREE.Group();
    const brokenEndplate = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.14, 0.42),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.65, metalness: 0.35 })
    );
    brokenEndplate.position.set(0.62, 0.13, 2.38);
    brokenEndplate.rotation.set(0.18, 0.28, -0.44);
    const scrapeGlow = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.08, 0.14),
      new THREE.MeshBasicMaterial({ color: 0xf97316 })
    );
    scrapeGlow.position.set(0.76, 0.08, 2.48);
    dmgWingGrp.add(brokenEndplate, scrapeGlow);
    dmgWingGrp.visible = false;
    carGrp.add(dmgWingGrp);

    return { ringMat, brakeMat, rainMat, drsMat, dmgWingGrp };
  }

  // ---------------------------------------------------------------------------
  // Physical 3D FIA Safety Car (Aston Martin Racing Green GT Coupe + LED Lightbar!)
  // ---------------------------------------------------------------------------
  function buildSafetyCar3D() {
    const sc = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x00594f, roughness: 0.22, metalness: 0.72 });
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.14, metalness: 0.85 });
    const limeMat = new THREE.MeshBasicMaterial({ color: 0xc8ff00 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x11151d, roughness: 0.85 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.8 });

    // Sculpted GT lower chassis & bonnet
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.62, 4.75), bodyMat);
    chassis.position.set(0, 0.50, 0);
    chassis.castShadow = true;
    sc.add(chassis);

    // Aerodynamic coupe greenhouse / cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.56, 2.25), cabinMat);
    cabin.position.set(0, 1.02, -0.22);
    cabin.castShadow = true;
    sc.add(cabin);

    // Lime-yellow FIA side stripe & rear GT wing
    const stripeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 4.2), limeMat);
    stripeL.position.set(-1.04, 0.44, 0);
    const stripeR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 4.2), limeMat);
    stripeR.position.set(1.04, 0.44, 0);
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.08, 0.38), cabinMat);
    spoiler.position.set(0, 1.04, -2.18);
    sc.add(stripeL, stripeR, spoiler);

    // Glowing LED Headlights & Taillights
    const hlMat = new THREE.MeshBasicMaterial({ color: 0xfef9c3 });
    const tlMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    [-0.68, 0.68].forEach((ox) => {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.08), hlMat);
      hl.position.set(ox, 0.56, 2.39);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.08), tlMat);
      tl.position.set(ox, 0.58, -2.39);
      sc.add(hl, tl);
    });

    // 4 GT Wheels
    const wGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.32, 14);
    wGeo.rotateZ(Math.PI * 0.5);
    const rGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.34, 10);
    rGeo.rotateZ(Math.PI * 0.5);
    [[-1.02, 0.36, 1.48], [1.02, 0.36, 1.48], [-1.02, 0.36, -1.48], [1.02, 0.36, -1.48]].forEach(([x, y, z]) => {
      const w = new THREE.Mesh(wGeo, tireMat); w.position.set(x, y, z); sc.add(w);
      const r = new THREE.Mesh(rGeo, rimMat); r.position.set(x, y, z); sc.add(r);
    });

    // FIA Roof Lightbar (Flashing Amber -> Green when "Safety Car In This Lap"!)
    const barFrame = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.14, 0.34), cabinMat);
    barFrame.position.set(0, 1.37, -0.15);
    sc.add(barFrame);
    const amberL = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const amberR = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const centerMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
    const lampL = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.38), amberL);
    lampL.position.set(-0.42, 1.39, -0.15);
    const lampR = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.18, 0.38), amberR);
    lampR.position.set(0.42, 1.39, -0.15);
    const lampC = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.38), centerMat);
    lampC.position.set(0, 1.39, -0.15);
    sc.add(lampL, lampR, lampC);

    sc.visible = false;
    return { group: sc, amberL, amberR, centerMat };
  }

  // ---------------------------------------------------------------------------
  // Live Canvas2D -> GPU LED Jumbotron Texture Updater (Real-Time Standings!)
  // ---------------------------------------------------------------------------
  function createJumbotronSystem() {
    const cv = document.createElement("canvas");
    cv.width = 512; cv.height = 256;
    const ctx = cv.getContext("2d");
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;

    function draw(circuitName, raceState) {
      const rs = raceState || {};
      ctx.fillStyle = "#080d1a";
      ctx.fillRect(0, 0, 512, 256);

      // Top broadcast red/gold header bar
      ctx.fillStyle = rs.redFlag ? "#dc2626" : (rs.chequered ? "#facc15" : (rs.scActive ? "#f59e0b" : "#e10600"));
      ctx.fillRect(0, 0, 512, 52);
      ctx.fillStyle = (rs.chequered || rs.scActive) && !rs.redFlag ? "#0f172a" : "#ffffff";
      ctx.font = "900 26px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(
        rs.redFlag ? "🚩 RED FLAG · SUSPENDED"
          : (rs.chequered ? "🏁 CHEQUERED FLAG"
            : (rs.scActive ? (rs.scInThisLap ? "⚠ SC IN THIS LAP" : "⚠ FIA SAFETY CAR")
              : `F1 LIVE · ${(circuitName || "GP").toUpperCase().slice(0, 18)}`)),
        16, 35
      );
      ctx.textAlign = "right";
      ctx.fillText(`LAP ${rs.lap || 1}/${rs.totalLaps || 15}`, 496, 35);

      // Top 3 live podium tower
      const top3 = rs.top3 || [];
      for (let i = 0; i < 3; i++) {
        const y = 72 + i * 56;
        const item = top3[i] || { code3: "---", color: "#64748b" };
        ctx.fillStyle = "rgba(30,41,59,0.85)";
        ctx.fillRect(16, y, 480, 46);
        ctx.fillStyle = item.color || "#e10600";
        ctx.fillRect(16, y, 14, 46);
        ctx.fillStyle = "#94a3b8";
        ctx.font = "800 26px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`P${i + 1}`, 44, y + 32);
        ctx.fillStyle = "#ffffff";
        ctx.font = "900 30px sans-serif";
        ctx.fillText(item.code3 || "DRV", 108, y + 33);
        ctx.fillStyle = i === 0 ? "#4ade80" : "#38bdf8";
        ctx.font = "700 22px monospace";
        ctx.textAlign = "right";
        ctx.fillText(i === 0 ? "LEADER" : (i === 1 ? "CHASING" : "PODIUM"), 480, y + 31);
      }

      tex.needsUpdate = true;
    }

    draw("GRAND PRIX", {});
    return { tex, draw };
  }

  // ---------------------------------------------------------------------------
  // GLSL Wind-Rippling Flags Material (Checkered, National & Team Banners!)
  // ---------------------------------------------------------------------------
  function makeWavingFlagMaterial(colorHex, isCheckered) {
    const uniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(colorHex) },
      uCheckered: { value: isCheckered ? 1.0 : 0.0 },
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms,
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 pos = position;
          float wave = sin(uv.x * 7.5 - uTime * 5.8) * 0.28 * uv.x;
          float flutter = cos(uv.y * 5.0 - uTime * 7.2) * 0.08 * uv.x;
          pos.z += wave + flutter;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uCheckered;
        varying vec2 vUv;
        void main() {
          vec3 col = uColor;
          if (uCheckered > 0.5) {
            float cx = floor(vUv.x * 6.0);
            float cy = floor(vUv.y * 4.0);
            float chk = mod(cx + cy, 2.0);
            col = mix(vec3(0.08, 0.1, 0.14), vec3(0.98, 0.99, 1.0), chk);
          } else {
            // Crisp racing stripe across flag!
            float stripe = step(0.38, vUv.y) * step(vUv.y, 0.62);
            col = mix(col, vec3(1.0, 0.98, 0.92), stripe * 0.72);
          }
          float shade = 0.86 + 0.14 * sin(vUv.x * 9.0);
          gl_FragColor = vec4(col * shade, 1.0);
        }
      `,
    });
    return { mat, uniforms };
  }

  // ---------------------------------------------------------------------------
  // GPU-Instanced Animated Cheering Crowd + Foaming Beer Cups!
  // ---------------------------------------------------------------------------
  function buildAnimatedCrowd(crowdSpots, beerSpots) {
    const group = new THREE.Group();
    const uTime = { value: 0 };
    const uExcite = { value: 1.0 };

    if (crowdSpots.length > 0) {
      const bodyGeo = new THREE.CylinderGeometry(0.24, 0.30, 1.15, 6);
      bodyGeo.translate(0, 0.58, 0);
      const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.05 });
      bodyMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = uTime;
        shader.uniforms.uExcite = uExcite;
        shader.vertexShader = `
          uniform float uTime;
          uniform float uExcite;
        ` + shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           float phase = instanceMatrix[3].x * 0.22 + instanceMatrix[3].z * 0.18;
           float wave = max(0.0, sin(uTime * 4.2 + phase));
           float jump = pow(wave, 2.0) * 0.36 * uExcite;
           transformed.y += jump;
           transformed.x += sin(uTime * 7.0 + phase * 3.1) * 0.05 * transformed.y;`
        );
      };

      const bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, crowdSpots.length);
      const headGeo = new THREE.SphereGeometry(0.22, 6, 5);
      headGeo.translate(0, 1.32, 0);
      const headMat = new THREE.MeshStandardMaterial({ roughness: 0.72 });
      headMat.onBeforeCompile = bodyMat.onBeforeCompile;
      const headMesh = new THREE.InstancedMesh(headGeo, headMat, crowdSpots.length);

      const dummy = new THREE.Object3D();
      const col = new THREE.Color();
      const skinTones = [0xf5d0b5, 0xe8b490, 0xd49a6a, 0xa86b42, 0x704225, 0xffdfc4];

      for (let i = 0; i < crowdSpots.length; i++) {
        const s = crowdSpots[i];
        dummy.position.set(s.x, s.y, s.z);
        dummy.rotation.set(0, s.ry || 0, 0);
        const sc = 0.88 + (i % 5) * 0.07;
        dummy.scale.set(sc, sc, sc);
        dummy.updateMatrix();
        bodyMesh.setMatrixAt(i, dummy.matrix);
        headMesh.setMatrixAt(i, dummy.matrix);
        col.setHex(s.color);
        bodyMesh.setColorAt(i, col);
        col.setHex(skinTones[i % skinTones.length]);
        headMesh.setColorAt(i, col);
      }
      bodyMesh.instanceMatrix.needsUpdate = true;
      headMesh.instanceMatrix.needsUpdate = true;
      if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
      if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;
      group.add(bodyMesh);
      group.add(headMesh);
    }

    // Golden Foaming Beer Steins & Team Foam Fingers raised in the air by cheering fans!
    if (beerSpots.length > 0) {
      const cupGeo = new THREE.CylinderGeometry(0.11, 0.09, 0.34, 6);
      cupGeo.translate(0, 1.55, 0);
      const cupMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
      cupMat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = uTime;
        shader.uniforms.uExcite = uExcite;
        shader.vertexShader = `
          uniform float uTime;
          uniform float uExcite;
        ` + shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           float phase = instanceMatrix[3].x * 0.22 + instanceMatrix[3].z * 0.18;
           float cheer = pow(max(0.0, sin(uTime * 4.2 + phase)), 2.0) * 0.48 * uExcite;
           transformed.y += cheer;`
        );
      };
      const cupMesh = new THREE.InstancedMesh(cupGeo, cupMat, beerSpots.length);
      const dummy = new THREE.Object3D();
      const c = new THREE.Color();
      for (let i = 0; i < beerSpots.length; i++) {
        const b = beerSpots[i];
        dummy.position.set(b.x, b.y, b.z);
        dummy.rotation.set(0, b.ry || 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        cupMesh.setMatrixAt(i, dummy.matrix);
        // Mix golden frothy beers with bright red/orange foam fingers!
        c.setHex(i % 4 === 0 ? 0xff6b00 : (i % 5 === 0 ? 0xef4444 : 0xfbbf24));
        cupMesh.setColorAt(i, c);
      }
      cupMesh.instanceMatrix.needsUpdate = true;
      if (cupMesh.instanceColor) cupMesh.instanceColor.needsUpdate = true;
      group.add(cupMesh);
    }

    return { group, uTime, uExcite };
  }

  // ---------------------------------------------------------------------------
  // Rotating Illuminated Giant Ferris Wheel (Iconic Suzuka / Melbourne / COTA / Vegas!)
  // ---------------------------------------------------------------------------
  function buildFerrisWheel(x, z, theme) {
    const fw = new THREE.Group();
    fw.position.set(x, 0, z);
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.35, metalness: 0.65 });
    const legGeo = new THREE.CylinderGeometry(0.75, 1.3, 44, 8);
    [-9, 9].forEach((ox) => {
      const l1 = new THREE.Mesh(legGeo, steelMat); l1.position.set(ox, 21, -7); l1.rotation.x = 0.22; fw.add(l1);
      const l2 = new THREE.Mesh(legGeo, steelMat); l2.position.set(ox, 21,  7); l2.rotation.x = -0.22; fw.add(l2);
    });

    const wheel = new THREE.Group();
    wheel.position.set(0, 38, 0);
    const rimCol = theme.isNight ? 0x38bdf8 : 0xf8fafc;
    const rimMat = new THREE.MeshStandardMaterial({ color: rimCol, emissive: theme.isNight ? 0x0284c7 : 0x000000, emissiveIntensity: 0.85, roughness: 0.25, metalness: 0.6 });
    const rim1 = new THREE.Mesh(new THREE.TorusGeometry(28, 0.75, 8, 36), rimMat); rim1.position.z = -2.2; wheel.add(rim1);
    const rim2 = new THREE.Mesh(new THREE.TorusGeometry(28, 0.75, 8, 36), rimMat); rim2.position.z =  2.2; wheel.add(rim2);

    const podCols = [0xef4444, 0xf97316, 0xfacc15, 0x22c55e, 0x38bdf8, 0xa855f7, 0xec4899, 0xffffff];
    const spokeGeo = new THREE.CylinderGeometry(0.22, 0.22, 56, 5);
    const podGeo = new THREE.BoxGeometry(2.8, 2.8, 3.6);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      if (i < 8) {
        const sp = new THREE.Mesh(spokeGeo, steelMat);
        sp.rotation.z = a;
        wheel.add(sp);
      }
      const pMat = new THREE.MeshStandardMaterial({
        color: podCols[i % podCols.length],
        emissive: podCols[i % podCols.length],
        emissiveIntensity: theme.isNight ? 0.65 : 0.14,
        roughness: 0.35,
      });
      const pod = new THREE.Mesh(podGeo, pMat);
      pod.position.set(Math.cos(a) * 28, Math.sin(a) * 28, 0);
      wheel.add(pod);
    }
    fw.add(wheel);
    return { group: fw, wheel };
  }

  // ---------------------------------------------------------------------------
  // Orbiting TV Broadcast Helicopter with Spinning Rotor Blades!
  // ---------------------------------------------------------------------------
  function buildHelicopter() {
    const heli = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe10600, roughness: 0.25, metalness: 0.5 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xbae6fd, roughness: 0.1, metalness: 0.85 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 });

    const cabin = new THREE.Mesh(new THREE.SphereGeometry(2.1, 12, 10), bodyMat);
    cabin.scale.set(0.85, 0.72, 1.55);
    heli.add(cabin);
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8), glassMat);
    cockpit.position.set(0, 0.18, 1.45);
    heli.add(cockpit);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.52, 5.2, 8), bodyMat);
    tail.rotation.x = Math.PI * 0.5;
    tail.position.set(0, 0.2, -3.9);
    heli.add(tail);

    const rotor = new THREE.Group();
    rotor.position.set(0, 1.8, 0);
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.08, 0.35), darkMat);
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 10.5), darkMat);
    rotor.add(b1, b2);
    heli.add(rotor);
    return { group: heli, rotor };
  }

  // ---------------------------------------------------------------------------
  // Main Broadcast 3D Engine Factory
  // ---------------------------------------------------------------------------
  function createBroadcast3D(canvasEl, hudEl) {
    if (!global.THREE || !canvasEl) return null;
    const THREE = global.THREE;

    let renderer = null;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.25, 6500);

    function ensureRenderer() {
      if (renderer) return true;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.18;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        return true;
      } catch (err) {
        console.error("F1Broadcast3D WebGL init failed:", err);
        renderer = null;
        return false;
      }
    }

    const jumbotron = createJumbotronSystem();

    const state = {
      active: false,
      mode: "tv",
      directorSub: "tv",
      directorTimer: 0,
      circuitId: "",
      circuitName: "",
      trackPts: [],
      trackSpline: null,
      layout: null,
      pitPts: [],
      pitSide: 1,
      pitBoxCrews: [],
      pitBoxGantries: [],
      gantryBulbMats: [],
      tvCams: [],
      worldGroup: null,
      envRT: null,
      sunLight: null,
      skyUniforms: null,
      roadMat: null,
      crowdRef: null,
      flagUniforms: [],
      smokePuffs: [],
      ferrisWheel: null,
      djBeams: [],
      helicopter: null,
      sparkSystem: null,
      magSparkSystem: null,
      spraySystem: null,
      breakdownSmokeSystem: null,
      safetyCar3D: null,
      marshalPanels: [],
      debrisGroup: null,
      debrisKey: "",
      carMeshes: new Map(),   // carIdx -> { group, isHero, fx }
      carPhysics: new Map(),  // carIdx -> F1VehiclePhysics state
      pitCrewGroup: null,
      camPosSmooth: new THREE.Vector3(),
      camLookSmooth: new THREE.Vector3(),
      camInit: false,
      elapsed: 0,
      lastJumbotronDraw: -99,
      asphaltTex: makeAsphaltTextures(),
      sponsorTex: makeSponsorWallTexture(),
      checkerTex: makeCheckeredLineTexture(),
    };

    function disposeWorld() {
      if (state.worldGroup) {
        state.worldGroup.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => {
              if (m.map && m.map !== state.asphaltTex && m.map !== state.sponsorTex && m.map !== state.checkerTex && m.map !== jumbotron.tex) {
                m.map.dispose();
              }
              m.dispose();
            });
          }
        });
        scene.remove(state.worldGroup);
        state.worldGroup = null;
      }
      if (state.envRT) {
        state.envRT.dispose();
        state.envRT = null;
        scene.environment = null;
      }
      state.carMeshes.forEach((entry) => {
        if (global.F1Car3D && global.F1Car3D.disposeObject) global.F1Car3D.disposeObject(entry.group);
        scene.remove(entry.group);
      });
      state.carMeshes.clear();
      state.carPhysics.clear();
      state.trackSpline = null;
      state.layout = null;
      state.pitBoxCrews = [];
      state.pitBoxGantries = [];
      state.gantryBulbMats = [];
      state.flagUniforms = [];
      state.smokePuffs = [];
      state.djBeams = [];
      state.ferrisWheel = null;
      state.helicopter = null;
      state.crowdRef = null;
      state.sparkSystem = null;
      state.magSparkSystem = null;
      state.spraySystem = null;
      state.breakdownSmokeSystem = null;
      state.lockupSmokeSystem = null;
      state.rainSystem = null;
      state.dryLineMat = null;
      state.circuit = null;
      state.safetyCar3D = null;
      state.marshalPanels = [];
      state.debrisGroup = null;
      state.debrisKey = "";
      state.camInit = false;
    }

    function sample3DTrack(prog) {
      let base;
      if (state.trackSpline) {
        base = state.trackSpline.sample(prog);
      } else {
        const pts = state.trackPts;
        if (!pts.length) return { x: 0, y: 0, z: 0, tx: 1, tz: 0, curv: 0, bumpMm: 0, slopePitch: 0, bankRad: 0, inTunnel: false };
        const n = pts.length;
        const p = (((prog % 1) + 1) % 1) * n;
        const i0 = Math.floor(p) % n;
        const i1 = (i0 + 1) % n;
        const f = p - Math.floor(p);
        const a = pts[i0], b = pts[i1];
        const tx = a.tx + (b.tx - a.tx) * f;
        const tz = a.tz + (b.tz - a.tz) * f;
        const tl = Math.max(1e-5, Math.hypot(tx, tz));
        base = {
          x: a.x + (b.x - a.x) * f,
          z: a.z + (b.z - a.z) * f,
          tx: tx / tl,
          tz: tz / tl,
          curv: 0,
          bumpMm: 0,
        };
      }
      const ARCH = global.F1TrackArchitect;
      if (ARCH && ARCH.getCircuitElevationAndBank && state.circuit) {
        const topo = ARCH.getCircuitElevationAndBank(state.circuit, prog);
        return Object.assign({}, base, topo);
      }
      return Object.assign({ y: 0, slopePitch: 0, bankRad: 0, inTunnel: false }, base);
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

    function buildCircuit3D(circuit) {
      if (!circuit || !Array.isArray(circuit.points) || circuit.points.length < 10) return;
      if (state.circuitId === circuit.id && state.worldGroup) return;
      disposeWorld();
      state.circuit = circuit;
      state.circuitId = circuit.id;
      state.circuitName = circuit.name || circuit.id;

      const rng = mulberry32(hashStr(circuit.id));
      const theme = getTheme(circuit);
      scene.background = new THREE.Color(theme.skyHor);
      scene.fog = new THREE.FogExp2(theme.fog, theme.isNight ? 0.00055 : 0.00024);

      if (renderer) {
        state.envRT = buildEnvMap(renderer, theme);
        if (state.envRT) scene.environment = state.envRT.texture;
      }

      const grp = new THREE.Group();
      state.worldGroup = grp;
      scene.add(grp);

      // 1. Custom GLSL Atmospheric Sky Dome
      const sky = buildSkyDome(theme);
      state.skyUniforms = sky.uniforms;
      grp.add(sky.mesh);

      // 2. Vibrant Daylight / Floodlight Illumination + Dynamic Soft Shadows
      const hemi = new THREE.HemisphereLight(theme.skyHor, theme.ground, theme.isNight ? 1.1 : 1.35);
      grp.add(hemi);
      const sun = new THREE.DirectionalLight(theme.sunCol, theme.sunInt);
      sun.position.set(160, 260, 120);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.near = 20;
      sun.shadow.camera.far = 900;
      const scBound = 160;
      sun.shadow.camera.left = -scBound;
      sun.shadow.camera.right = scBound;
      sun.shadow.camera.top = scBound;
      sun.shadow.camera.bottom = -scBound;
      sun.shadow.bias = -0.0006;
      grp.add(sun);
      grp.add(sun.target);
      state.sunLight = sun;

      // 3. Build C2-Continuous Catmull-Rom 3D Circuit Centerline (Eliminates all corner kinks & camera jitter!)
      const raw = circuit.points;
      let pts = [];
      if (global.F1VehiclePhysics && global.F1VehiclePhysics.buildTrackSpline) {
        state.trackSpline = global.F1VehiclePhysics.buildTrackSpline(raw, circuit.length_km, circuit.id, circuit.biome);
        // Sample 360 ultra-smooth spline vertices for crisp curved asphalt/kerb ribbons
        for (let i = 0; i < 360; i++) {
          pts.push(state.trackSpline.sample(i / 360));
        }
      } else {
        let perim = 0;
        for (let i = 0; i < raw.length; i++) {
          const a = raw[i], b = raw[(i + 1) % raw.length];
          perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
        }
        const targetPerimM = Math.max(2400, Math.min(5400, (circuit.length_km || 5.0) * 660));
        const scale = targetPerimM / Math.max(10, perim);
        let cx = 0, cz = 0;
        raw.forEach(([x, y]) => { cx += x; cz += y; });
        cx /= raw.length; cz /= raw.length;
        const nRaw = raw.length;
        for (let i = 0; i < nRaw; i++) {
          const a = raw[i], b = raw[(i + 1) % nRaw];
          for (let k = 0; k < 2; k++) {
            const t = k * 0.5;
            pts.push({ x: ((a[0] + (b[0] - a[0]) * t) - cx) * scale, z: ((a[1] + (b[1] - a[1]) * t) - cz) * scale, tx: 1, tz: 0 });
          }
        }
        const nn = pts.length;
        for (let i = 0; i < nn; i++) {
          const prev = pts[(i - 1 + nn) % nn], next = pts[(i + 1) % nn];
          const dx = next.x - prev.x, dz = next.z - prev.z;
          const len = Math.max(1e-5, Math.hypot(dx, dz));
          pts[i].tx = dx / len; pts[i].tz = dz / len;
        }
      }
      const n = pts.length;
      const ARCH_T = global.F1TrackArchitect;
      let maxElev = 0;
      for (let i = 0; i < n; i++) {
        const prog = i / n;
        const topo = (ARCH_T && ARCH_T.getCircuitElevationAndBank)
          ? ARCH_T.getCircuitElevationAndBank(circuit, prog)
          : { y: 0, slopePitch: 0, bankRad: 0, inTunnel: false };
        pts[i].y = topo.y;
        pts[i].slopePitch = topo.slopePitch;
        pts[i].bankRad = topo.bankRad;
        pts[i].inTunnel = topo.inTunnel;
        if (topo.y > maxElev) maxElev = topo.y;
      }
      state.trackPts = pts;

      // 4. Textured Biome Ground Plane + Harbour/Lake Water with Luxury Yachts!
      const groundTex = makeGroundTexture(theme.ground, theme.grassAlt, circuit.biome === "desert");
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(11000, 11000),
        new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.92, metalness: 0.02 })
      );
      ground.rotation.x = -Math.PI * 0.5;
      ground.position.y = -0.30;
      ground.receiveShadow = true;
      grp.add(ground);

      const hasWater = Boolean(theme.water || theme.lake || circuit.id === "melbourne" || circuit.id === "monaco" || circuit.id === "montreal" || circuit.id === "miami" || circuit.id === "abudhabi");
      if (hasWater) {
        const waterMat = new THREE.MeshStandardMaterial({
          color: theme.water || theme.lake || 0x0ea5e9,
          roughness: 0.14,
          metalness: 0.65,
        });
        const isLake = circuit.id === "melbourne" || (!theme.water);
        const water = new THREE.Mesh(isLake ? new THREE.CircleGeometry(210, 36) : new THREE.PlaneGeometry(5200, 5200), waterMat);
        water.rotation.x = -Math.PI * 0.5;
        water.position.set(isLake ? 0 : 1800, -0.18, isLake ? 0 : 1200);
        grp.add(water);

        // Luxury white yachts floating on the lake/harbour!
        const hullMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25, metalness: 0.2 });
        const deckMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.3 });
        for (let yIdx = 0; yIdx < 8; yIdx++) {
          const ya = (yIdx / 8) * Math.PI * 2 + 0.4;
          const yr = isLake ? (75 + rng() * 85) : (420 + rng() * 320);
          const yacht = new THREE.Group();
          const hull = new THREE.Mesh(new THREE.BoxGeometry(5.5, 2.2, 16), hullMat); hull.position.y = 1.0; yacht.add(hull);
          const cab = new THREE.Mesh(new THREE.BoxGeometry(4.0, 2.4, 8.5), hullMat); cab.position.set(0, 3.0, -1); yacht.add(cab);
          const stripe = new THREE.Mesh(new THREE.BoxGeometry(5.7, 0.5, 15.5), deckMat); stripe.position.y = 1.8; yacht.add(stripe);
          yacht.position.set((isLake ? 0 : 520) + Math.cos(ya) * yr, -0.15, (isLake ? 0 : 320) + Math.sin(ya) * yr);
          yacht.rotation.y = ya + Math.PI * 0.5;
          grp.add(yacht);
        }
      }

      // 5. Multi-Layer Track Surface: Runoff Apron + Embankments + PBR Asphalt + Drying Rubber Line + Banked Kerbs
      const runoffMat = new THREE.MeshStandardMaterial({
        color: circuit.biome === "street" ? 0x475569 : (circuit.biome === "desert" ? 0xc89a64 : 0x2f6d34),
        roughness: 0.9,
        side: THREE.DoubleSide,
      });
      const runoff = new THREE.Mesh(buildRibbonGeo(pts, -16.5, 16.5, 0.005, true, 0.04, true), runoffMat);
      runoff.receiveShadow = true;
      grp.add(runoff);

      if (maxElev > 0.45) {
        const bankMat = new THREE.MeshStandardMaterial({
          color: circuit.biome === "desert" ? 0xb58652 : (circuit.biome === "street" ? 0x334155 : 0x2a5f30),
          roughness: 0.94,
          side: THREE.DoubleSide,
        });
        grp.add(new THREE.Mesh(buildEmbankmentSkirtGeo(pts, -16.5, -1), bankMat));
        grp.add(new THREE.Mesh(buildEmbankmentSkirtGeo(pts,  16.5,  1), bankMat));
      }

      const roadMat = new THREE.MeshStandardMaterial({
        map: state.asphaltTex,
        roughness: 0.72,
        metalness: 0.12,
        side: THREE.DoubleSide,
      });
      state.roadMat = roadMat;
      const roadMesh = new THREE.Mesh(buildRibbonGeo(pts, -7.4, 7.4, 0.04, true, 0.06, true), roadMat);
      roadMesh.receiveShadow = true;
      grp.add(roadMesh);

      // Dynamic Drying / Rubbered-In Racing Line Ribbon (darkens with grip & pops visibly on drying wet tracks!)
      const dryLineMat = new THREE.MeshStandardMaterial({
        color: 0x10151e,
        roughness: 0.86,
        metalness: 0.04,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      state.dryLineMat = dryLineMat;
      const dryLineMesh = new THREE.Mesh(buildRibbonGeo(pts, -2.55, 2.55, 0.056, true, 0.06, true), dryLineMat);
      grp.add(dryLineMesh);

      const kerbTex = makeKerbTexture(theme.kerbA, theme.kerbB);
      const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.62, side: THREE.DoubleSide });
      grp.add(new THREE.Mesh(buildRibbonGeo(pts, -8.8, -7.25, 0.065, true, 0.22, true), kerbMat));
      grp.add(new THREE.Mesh(buildRibbonGeo(pts, 7.25, 8.8, 0.065, true, 0.22, true), kerbMat));

      // Iconic Landmark Geometry: Monaco Illuminated Harbour Tunnel & Suzuka Figure-8 Overpass Piers!
      if (circuit.id === "monaco") {
        const tunConcMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.82, metalness: 0.12, side: THREE.DoubleSide });
        const tunLightMat = new THREE.MeshBasicMaterial({ color: 0xfde68a });
        const tunPillarMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.75 });
        for (let i = 0; i < n; i += 2) {
          const p = pts[i];
          if (!p.inTunnel) continue;
          const next = pts[(i + 2) % n];
          const segLen = Math.max(5.5, Math.hypot(next.x - p.x, next.z - p.z) * 1.12);
          const tunGrp = new THREE.Group();
          tunGrp.position.set(p.x, p.y || 0, p.z);
          tunGrp.rotation.y = Math.atan2(p.tx, p.tz);
          // Concrete roof slab + side walls + warm overhead sodium strip lights!
          const roof = new THREE.Mesh(new THREE.BoxGeometry(20.5, 1.4, segLen), tunConcMat);
          roof.position.set(0, 7.2, 0);
          const wallL = new THREE.Mesh(new THREE.BoxGeometry(1.1, 7.4, segLen), tunPillarMat);
          wallL.position.set(-10.0, 3.6, 0);
          const wallR = new THREE.Mesh(new THREE.BoxGeometry(1.1, 7.4, segLen), tunPillarMat);
          wallR.position.set(10.0, 3.6, 0);
          const strip = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, segLen * 0.72), tunLightMat);
          strip.position.set(0, 6.42, 0);
          tunGrp.add(roof, wallL, wallR, strip);
          grp.add(tunGrp);
        }
      } else if (circuit.id === "suzuka") {
        const pierMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.72 });
        for (let i = 0; i < n; i += 5) {
          const p = pts[i];
          if ((p.y || 0) < 4.2) continue;
          const rx = -p.tz, rz = p.tx;
          [-8.5, 8.5].forEach((sideOff) => {
            const pier = new THREE.Mesh(new THREE.BoxGeometry(1.4, p.y + 0.5, 1.4), pierMat);
            pier.position.set(p.x + rx * sideOff, (p.y - 0.5) * 0.5, p.z + rz * sideOff);
            grp.add(pier);
          });
        }
      }

      // 6. Standardised FIA Circuit Layout Solver (Zero Obstructions across all 79 Tracks!)
      const ARCH = global.F1TrackArchitect;
      const layout = ARCH ? ARCH.buildCircuitLayout(pts, sample3DTrack, circuit, rng) : null;
      state.layout = layout;
      const pitSide = layout ? layout.pitSide : (((-pts[0].x) * (-pts[0].tz) + (-pts[0].z) * pts[0].tx) >= 0 ? 1 : -1);
      state.pitSide = pitSide;

      // Vibrant Trackside Sponsor Walls (with clean Pit Entry & Exit opening on pitSide!)
      const wallMat = new THREE.MeshStandardMaterial({ map: state.sponsorTex, roughness: 0.45, metalness: 0.18, side: THREE.DoubleSide });
      const pitOpenSpan = (layout && layout.pitLayout && layout.pitLayout.pitSpan) ? (layout.pitLayout.pitSpan + 0.012) : 0.095;
      const buildSponsorWall = (offset, skipPitGap) => {
        const count = n + 1;
        const pos = new Float32Array(count * 2 * 3);
        const uvs = new Float32Array(count * 2 * 2);
        const idx = [];
        let dAcc = 0;
        for (let i = 0; i < count; i++) {
          const p = pts[i % n];
          if (i > 0) {
            const prev = pts[(i - 1) % n];
            dAcc += Math.hypot(p.x - prev.x, p.z - prev.z);
          }
          const rx = -p.tz, rz = p.tx;
          const wx = p.x + rx * offset, wz = p.z + rz * offset;
          const wy = (p.y || 0) + (p.bankRad ? Math.sin(p.bankRad) * offset : 0);
          const vi = i * 6;
          pos[vi] = wx; pos[vi + 1] = wy;        pos[vi + 2] = wz;
          pos[vi + 3] = wx; pos[vi + 4] = wy + 1.55; pos[vi + 5] = wz;
          const ui = i * 4;
          uvs[ui] = dAcc * 0.015; uvs[ui + 1] = 0;
          uvs[ui + 2] = dAcc * 0.015; uvs[ui + 3] = 1;
          if (i < count - 1) {
            const segProg = (i + 0.5) / n;
            const inPitGap = skipPitGap && (segProg < pitOpenSpan || segProg > (1 - pitOpenSpan));
            if (!inPitGap) {
              const b = i * 2;
              idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
            }
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        return new THREE.Mesh(g, wallMat);
      };
      grp.add(buildSponsorWall(-15.2, pitSide < 0));
      grp.add(buildSponsorWall(15.2, pitSide > 0));

      const pitPts = layout ? layout.pitLayout.fastPts : (() => {
        const arr = [];
        for (let i = 0; i <= 44; i++) {
          const u = i / 44;
          const prog = ((1 - 0.085 + u * 0.17) % 1 + 1) % 1;
          const sp = sample3DTrack(prog);
          const off = pitSide * (19.5 * Math.pow(Math.sin(u * Math.PI), 0.65));
          arr.push({ x: sp.x + (-sp.tz) * off, z: sp.z + sp.tx * off, tx: sp.tx, tz: sp.tz });
        }
        return arr;
      })();
      state.pitPts = pitPts;

      // Dedicated FIA Pit Fast Lane + Working Apron + Pit Wall Barrier + 80 KPH Speed-Limit Lines
      grp.add(new THREE.Mesh(
        buildRibbonGeo(pitPts, -3.6, 3.6, 0.055, false, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x262f3e, roughness: 0.72, side: THREE.DoubleSide })
      ));
      if (layout && layout.pitLayout.workPts.length > 2) {
        grp.add(new THREE.Mesh(
          buildRibbonGeo(layout.pitLayout.workPts, -4.6, 4.6, 0.052, false, 0.08),
          new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.80, side: THREE.DoubleSide })
        ));
      }
      if (layout && layout.pitLayout.wallPts.length > 2) {
        const wPts = layout.pitLayout.wallPts;
        const wMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide });
        const count = wPts.length;
        const pos = new Float32Array(count * 2 * 3);
        const idx = [];
        for (let i = 0; i < count; i++) {
          const wp = wPts[i];
          const vi = i * 6;
          pos[vi] = wp.x; pos[vi + 1] = 0.0; pos[vi + 2] = wp.z;
          pos[vi + 3] = wp.x; pos[vi + 4] = 1.25; pos[vi + 5] = wp.z;
          if (i < count - 1) {
            const b = i * 2;
            idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
          }
        }
        const wg = new THREE.BufferGeometry();
        wg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        wg.setIndex(idx);
        wg.computeVertexNormals();
        grp.add(new THREE.Mesh(wg, wMat));
      }
      // 80 KPH Pit Entry & Exit Speed-Limit White Lines + FIA Bollards
      if (layout && layout.pitLayout.speedLimitIn && layout.pitLayout.speedLimitOut) {
        const lineMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc, side: THREE.DoubleSide });
        const postMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
        [layout.pitLayout.speedLimitIn, layout.pitLayout.speedLimitOut].forEach((sl, sIdx) => {
          const slGrp = new THREE.Group();
          slGrp.position.set(sl.x, 0.07, sl.z);
          slGrp.rotation.y = Math.atan2(sl.tx, sl.tz);
          const bar = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 0.55), lineMat);
          bar.rotation.x = -Math.PI * 0.5;
          slGrp.add(bar);
          const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.35, 8), sIdx === 0 ? postMat : new THREE.MeshBasicMaterial({ color: 0x22c55e }));
          bollard.position.set(-pitSide * 3.8, 0.68, 0);
          slGrp.add(bollard);
          grp.add(slGrp);
        });
      }

      // 10 Painted Colour-Coded Team Pit Boxes + Overhead Red/Amber/Green Pit Gantry + Animated 3D Pit Crews!
      state.pitBoxCrews = [];
      state.pitBoxGantries = [];
      if (layout && layout.pitLayout.boxes.length) {
        const boxLineMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc, side: THREE.DoubleSide });
        const gantrySteel = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.65 });
        const helmMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25 });
        layout.pitLayout.boxes.forEach((box) => {
          const bGrp = new THREE.Group();
          bGrp.position.set(box.x, 0, box.z);
          bGrp.rotation.y = box.yaw;
          grp.add(bGrp);

          // Coloured team pit-box pad + crisp white FIA stop lines
          const pad = new THREE.Mesh(
            new THREE.PlaneGeometry(3.4, 6.8),
            new THREE.MeshBasicMaterial({ color: box.color, transparent: true, opacity: 0.28, side: THREE.DoubleSide })
          );
          pad.rotation.x = -Math.PI * 0.5;
          pad.position.y = 0.068;
          bGrp.add(pad);
          const stopBar = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 0.35), boxLineMat);
          stopBar.rotation.x = -Math.PI * 0.5;
          stopBar.position.set(0, 0.072, 2.75);
          bGrp.add(stopBar);

          // Overhead Pit Boom Gantry + Dynamic Red/Amber/Green Release Light
          const boom = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.28, 0.32), gantrySteel);
          boom.position.set(-pitSide * 1.4, 3.6, 1.8);
          bGrp.add(boom);
          const lightMat = new THREE.MeshBasicMaterial({ color: 0x334155 });
          const lightLamp = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.42, 0.42), lightMat);
          lightLamp.position.set(0, 3.3, 2.0);
          bGrp.add(lightLamp);
          state.pitBoxGantries.push({ mat: lightMat, state: "off" });

          // 5 Animated 3D Pit Crew Figures (4 Wheel-Gun Mechanics + Front Jack!)
          const suitMat = new THREE.MeshStandardMaterial({ color: box.color, roughness: 0.55 });
          const members = [];
          const crewSpecs = [
            { restX: -2.2, workX: -1.45, z:  1.75 }, // Front-Left gun
            { restX:  2.2, workX:  1.45, z:  1.75 }, // Front-Right gun
            { restX: -2.2, workX: -1.45, z: -1.55 }, // Rear-Left gun
            { restX:  2.2, workX:  1.45, z: -1.55 }, // Rear-Right gun
            { restX: -pitSide * 2.4, workX: 0.0, z: 3.35 }, // Front Jack
          ];
          crewSpecs.forEach((sp) => {
            const fig = new THREE.Group();
            const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 1.25, 7), suitMat);
            torso.position.y = 0.65;
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 7, 6), helmMat);
            head.position.y = 1.42;
            fig.add(torso, head);
            fig.position.set(sp.restX, 0, sp.z);
            bGrp.add(fig);
            members.push({ fig, restX: sp.restX, workX: sp.workX, z: sp.z });
          });
          state.pitBoxCrews.push({ members, activeAmt: 0 });
        });
      }

      // Start/Finish Checkered Line + Dynamic 5-Red-Lights Overhead FIA Start Gantry
      const p0 = pts[0];
      const sfGroup = new THREE.Group();
      sfGroup.position.set(p0.x, 0, p0.z);
      sfGroup.rotation.y = Math.atan2(p0.tx, p0.tz);
      grp.add(sfGroup);

      const sfLine = new THREE.Mesh(
        new THREE.PlaneGeometry(14.2, 2.8),
        new THREE.MeshBasicMaterial({ map: state.checkerTex, side: THREE.DoubleSide })
      );
      sfLine.rotation.x = -Math.PI * 0.5;
      sfLine.position.set(0, 0.075, 0);
      sfGroup.add(sfLine);

      // Painted Staggered 2x2 FIA Starting Grid Boxes along track spline!
      if (layout && layout.gridSlots.length) {
        const gridLineMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc, side: THREE.DoubleSide });
        layout.gridSlots.slice(0, 20).forEach((slot) => {
          const gBox = new THREE.Group();
          gBox.position.set(slot.x, 0.072, slot.z);
          gBox.rotation.y = slot.yaw;
          const front = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.26), gridLineMat);
          front.rotation.x = -Math.PI * 0.5;
          front.position.set(0, 0, 2.85);
          const sideL = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 2.2), gridLineMat);
          sideL.rotation.x = -Math.PI * 0.5;
          sideL.position.set(-1.32, 0, 1.85);
          const sideR = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 2.2), gridLineMat);
          sideR.rotation.x = -Math.PI * 0.5;
          sideR.position.set(1.32, 0, 1.85);
          gBox.add(front, sideL, sideR);
          grp.add(gBox);
        });
      }

      // FIA Overhead Start Gantry + 5 Independent Dynamic Red/Green Light Pods!
      const gantryMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.65 });
      const legL = new THREE.Mesh(new THREE.BoxGeometry(1.1, 9.2, 1.1), gantryMat); legL.position.set(-10.5, 4.6, 0); sfGroup.add(legL);
      const legR = new THREE.Mesh(new THREE.BoxGeometry(1.1, 9.2, 1.1), gantryMat); legR.position.set(10.5, 4.6, 0); sfGroup.add(legR);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(22.4, 1.8, 2.0), gantryMat); beam.position.set(0, 8.6, 0); sfGroup.add(beam);
      const bannerStrip = new THREE.Mesh(new THREE.BoxGeometry(21.6, 1.3, 2.12), new THREE.MeshBasicMaterial({ color: 0xe10600 }));
      bannerStrip.position.set(0, 8.7, 0);
      sfGroup.add(bannerStrip);
      state.gantryBulbMats = [];
      for (let li = 2; li >= -2; li--) {
        const pod = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.55, 0.55), gantryMat);
        pod.position.set(li * 1.65, 7.25, -0.95);
        sfGroup.add(pod);
        const bulbMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
        state.gantryBulbMats.push(bulbMat);
        const bulbTop = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), bulbMat);
        bulbTop.position.set(li * 1.65, 7.55, -1.24);
        const bulbBot = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), bulbMat);
        bulbBot.position.set(li * 1.65, 6.95, -1.24);
        sfGroup.add(bulbTop, bulbBot);
      }

      // Per-Track Architectural Pit Building (Positioned via Spatial Clearance Solver behind the 10 Pit Boxes!)
      const pb = layout ? layout.pitLayout.pitBuilding : { x: p0.x + (-p0.tz) * pitSide * 31, z: p0.z + p0.tx * pitSide * 31, yaw: Math.atan2(p0.tx, p0.tz), depth: 11.5, length: 122, style: circuit.pit_building || "modern_glass" };
      const pStyle = pb.style || "modern_glass";
      const bldgColor = pStyle === "vintage_wood" ? 0x7c5333
        : (pStyle === "classic_brick" ? 0x8f3a3a
          : (pStyle === "desert_wing" ? 0xf1f5f9
            : (pStyle === "street_canopy" ? 0x334155 : 0x26354d)));
      const bldgH = pStyle === "vintage_wood" ? 6.2 : (pStyle === "desert_wing" ? 12.2 : 10.5);
      const pitBldgGrp = new THREE.Group();
      pitBldgGrp.position.set(pb.x, 0, pb.z);
      pitBldgGrp.rotation.y = pb.yaw;
      grp.add(pitBldgGrp);

      const bldg = new THREE.Mesh(
        new THREE.BoxGeometry(pb.depth, bldgH, pb.length),
        new THREE.MeshStandardMaterial({ color: bldgColor, roughness: pStyle === "modern_glass" ? 0.2 : 0.68, metalness: pStyle === "modern_glass" ? 0.65 : 0.15 })
      );
      bldg.position.set(0, bldgH * 0.5, 0);
      bldg.castShadow = true;
      bldg.receiveShadow = true;
      pitBldgGrp.add(bldg);

      const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(pb.depth + 4.8, 0.85, pb.length + 6),
        new THREE.MeshStandardMaterial({ color: pStyle === "vintage_wood" ? 0xb45309 : 0xf8fafc, roughness: 0.25, metalness: 0.4 })
      );
      canopy.position.set(pitSide * 2.4, bldgH + 0.45, 0);
      pitBldgGrp.add(canopy);

      const bayCols = ARCH ? ARCH.PIT_BOX_COLORS : [0xe10600, 0xff8700, 0x00d2be, 0x1e41ff, 0x006f62, 0x0090ff, 0x6692ff, 0xfacc15, 0x22c55e, 0xffffff];
      const baySpacing = (pb.length - 14) / 9;
      for (let b = 0; b < 10; b++) {
        const bz = -(pb.length - 14) * 0.5 + b * baySpacing;
        const bayDoor = new THREE.Mesh(new THREE.BoxGeometry(0.45, 3.8, Math.min(8.2, baySpacing * 0.72)), new THREE.MeshBasicMaterial({ color: 0x0b1222 }));
        bayDoor.position.set(pitSide * (pb.depth * 0.5 + 0.12), 1.95, bz);
        pitBldgGrp.add(bayDoor);
        const fascia = new THREE.Mesh(new THREE.BoxGeometry(0.65, 1.1, Math.min(9.4, baySpacing * 0.86)), new THREE.MeshBasicMaterial({ color: bayCols[b] }));
        fascia.position.set(pitSide * (pb.depth * 0.5 + 0.22), 4.5, bz);
        pitBldgGrp.add(fascia);
      }

      // 7. OBSTRUCTION-FREE MULTI-TIER STADIUMS, GRANDSTANDS, CHEERING FANS W/ BEERS, FLAGS & SMOKE FLARES!
      const crowdSpots = [];
      const beerSpots = [];
      const standAccentCols = [0xe10600, 0xff8700, 0x0ea5e9, 0xfacc15, 0x22c55e, 0x6366f1, 0xec4899, 0x14b8a6];
      const standMatConcrete = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.75 });
      const standMatDeck = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
      const standMatRoof = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.32, metalness: 0.25, side: THREE.DoubleSide });
      const poleMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.7 });

      const standList = layout ? layout.grandstands : [];
      standList.forEach((slot, sIdx) => {
        const sx = slot.x;
        const sz = slot.z;
        const sy = (ARCH && ARCH.getCircuitElevationAndBank && slot.prog != null)
          ? Math.max(0, ARCH.getCircuitElevationAndBank(circuit, slot.prog).y * 0.72)
          : 0;
        const yaw = slot.yaw;

        const stand = new THREE.Group();
        stand.position.set(sx, sy, sz);
        stand.rotation.y = yaw;
        grp.add(stand);

        const faceSign = slot.side;
        const depth = slot.depth || (slot.tiers * 2.2 + 3.0);
        const maxH = slot.tiers * 1.45 + 2.5;
        const accentHex = standAccentCols[sIdx % standAccentCols.length];

        const backWall = new THREE.Mesh(new THREE.BoxGeometry(2.2, maxH + 2.0, slot.len), standMatConcrete);
        backWall.position.set(-faceSign * (depth * 0.5), (maxH + 2.0) * 0.5, 0);
        backWall.castShadow = true;
        stand.add(backWall);

        const fascia = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, slot.len + 1), new THREE.MeshBasicMaterial({ color: accentHex }));
        fascia.position.set(faceSign * (depth * 0.45), 1.4, 0);
        stand.add(fascia);

        const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
        for (let t = 0; t < slot.tiers; t++) {
          const lx = faceSign * (depth * 0.42 - t * 2.1);
          const ly = 1.6 + t * 1.38;
          const step = new THREE.Mesh(new THREE.BoxGeometry(2.15, 1.38, slot.len), standMatDeck);
          step.position.set(lx, ly * 0.5, 0);
          stand.add(step);

          const fanStep = 2.05;
          for (let lz = -slot.len * 0.46; lz <= slot.len * 0.46; lz += fanStep) {
            if (rng() < 0.14) continue;
            const jx = lx + (rng() - 0.5) * 0.55;
            const jz = lz + (rng() - 0.5) * 0.55;
            const wx = sx + jx * cosY + jz * sinY;
            const wz = sz - jx * sinY + jz * cosY;
            const fanCol = rng() < 0.34 ? accentHex : FAN_PALETTE[Math.floor(rng() * FAN_PALETTE.length)];
            crowdSpots.push({ x: wx, y: sy + ly, z: wz, ry: yaw, color: fanCol });
            if (rng() < 0.22) beerSpots.push({ x: wx, y: sy + ly, z: wz, ry: yaw });
          }
        }

        const roof = new THREE.Mesh(new THREE.BoxGeometry(depth + 5.5, 0.55, slot.len + 4), standMatRoof);
        roof.position.set(faceSign * 1.2, maxH + 4.4, 0);
        roof.rotation.z = faceSign * 0.14;
        stand.add(roof);
        const roofTrim = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, slot.len + 4.2), new THREE.MeshBasicMaterial({ color: accentHex }));
        roofTrim.position.set(faceSign * (depth * 0.5 + 3.2), maxH + 3.5, 0);
        stand.add(roofTrim);

        for (let fi = -2; fi <= 2; fi++) {
          const fz = fi * (slot.len * 0.2);
          const fPole = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 7.5, 6), poleMat);
          fPole.position.set(-faceSign * (depth * 0.45), maxH + 7.5, fz);
          stand.add(fPole);
          const fCol = fi === 0 ? 0xffffff : FAN_PALETTE[(sIdx * 3 + fi + 10) % FAN_PALETTE.length];
          const fw = makeWavingFlagMaterial(fCol, fi === 0 && sIdx % 2 === 0);
          state.flagUniforms.push(fw.uniforms);
          const fGeo = new THREE.PlaneGeometry(4.2, 2.4, 10, 4);
          fGeo.translate(2.1, 0, 0);
          const fMesh = new THREE.Mesh(fGeo, fw.mat);
          fMesh.position.set(-faceSign * (depth * 0.45), maxH + 10.0, fz);
          stand.add(fMesh);
        }

        if (sIdx % 2 === 1) {
          const flareCol = sIdx === 1 ? 0xff6b00 : (sIdx === 3 ? 0xef4444 : (sIdx === 5 ? 0xff8700 : 0xfacc15));
          for (let p = 0; p < 5; p++) {
            const pMat = new THREE.MeshBasicMaterial({ color: flareCol, transparent: true, opacity: 0.30, depthWrite: false });
            const puff = new THREE.Mesh(new THREE.SphereGeometry(2.6 + p * 0.85, 8, 6), pMat);
            const baseZ = (rng() - 0.5) * slot.len * 0.6;
            const bx = sx + (-faceSign * 2) * cosY + baseZ * sinY;
            const bz = sz - (-faceSign * 2) * sinY + baseZ * cosY;
            puff.position.set(bx, sy + maxH + 2 + p * 3.8, bz);
            grp.add(puff);
            state.smokePuffs.push({ mesh: puff, baseX: bx, baseY: sy + maxH + 1.5, baseZ: bz, phase: p * 1.25 + sIdx, speed: 0.65 + rng() * 0.35 });
          }
        }
      });

      // 8. OBSTRUCTION-FREE LIVE LED JUMBOTRON SCREENS
      const jumboMat = new THREE.MeshBasicMaterial({ map: jumbotron.tex });
      const jumboFrameMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.6 });
      (layout ? layout.jumbotrons : []).forEach((jb) => {
        const jg = new THREE.Group();
        jg.position.set(jb.x, 0, jb.z);
        jg.rotation.y = jb.yaw;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 9.5, 8), jumboFrameMat); leg.position.y = 4.75; jg.add(leg);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(19.2, 10.4, 1.2), jumboFrameMat); frame.position.y = 12.6; jg.add(frame);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(18.0, 9.2), jumboMat); screen.position.set(0, 12.6, 0.66); jg.add(screen);
        const screenBack = new THREE.Mesh(new THREE.PlaneGeometry(18.0, 9.2), jumboMat); screenBack.position.set(0, 12.6, -0.66); screenBack.rotation.y = Math.PI; jg.add(screenBack);
        grp.add(jg);
      });

      // 9. OBSTRUCTION-FREE OVERHEAD SPONSOR BRIDGES (elevated with local track height!)
      const bridgeCols = [0xe10600, 0x0284c7, 0xf97316];
      (layout ? layout.bridges : []).forEach((br, bi) => {
        const bTopo = (ARCH && ARCH.getCircuitElevationAndBank) ? ARCH.getCircuitElevationAndBank(circuit, br.prog || 0) : { y: 0, inTunnel: false };
        if (bTopo.inTunnel) return;
        const bg = new THREE.Group();
        bg.position.set(br.x, bTopo.y || 0, br.z);
        bg.rotation.y = br.yaw;
        const pillarL = new THREE.Mesh(new THREE.BoxGeometry(1.4, 9.5, 2.4), gantryMat); pillarL.position.set(-12.5, 4.75, 0); bg.add(pillarL);
        const pillarR = new THREE.Mesh(new THREE.BoxGeometry(1.4, 9.5, 2.4), gantryMat); pillarR.position.set( 12.5, 4.75, 0); bg.add(pillarR);
        const deck = new THREE.Mesh(new THREE.BoxGeometry(27.0, 2.8, 3.6), new THREE.MeshStandardMaterial({ color: bridgeCols[bi % bridgeCols.length], roughness: 0.35, metalness: 0.25 }));
        deck.position.set(0, 9.2, 0);
        bg.add(deck);
        const trim = new THREE.Mesh(new THREE.BoxGeometry(27.2, 0.45, 3.75), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
        trim.position.set(0, 7.85, 0);
        bg.add(trim);
        grp.add(bg);
      });

      // 10. OBSTRUCTION-FREE ACTIVE FAN FESTIVAL & PARTY VILLAGE
      const fest = layout && layout.festival;
      if (fest) {
        const fw = buildFerrisWheel(fest.x, fest.z, theme);
        grp.add(fw.group);
        state.ferrisWheel = fw.wheel;

        const tentCols = [0xef4444, 0xfacc15, 0x0ea5e9, 0xf97316, 0x22c55e, 0xa855f7];
        (layout.festivalTents || []).forEach((tSpec, ti) => {
          const tent = new THREE.Group();
          tent.position.set(tSpec.x, 0, tSpec.z);
          const roof = new THREE.Mesh(
            new THREE.ConeGeometry(7.2, 4.2, 6),
            new THREE.MeshStandardMaterial({ color: tentCols[ti % tentCols.length], roughness: 0.55 })
          );
          roof.position.y = 5.6;
          tent.add(roof);
          const trim = new THREE.Mesh(new THREE.CylinderGeometry(6.8, 6.8, 0.55, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
          trim.position.y = 3.55;
          tent.add(trim);
          for (let p = 0; p < 6; p++) {
            const pa = (p / 6) * Math.PI * 2;
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 3.6, 5), poleMat);
            post.position.set(Math.cos(pa) * 5.8, 1.8, Math.sin(pa) * 5.8);
            tent.add(post);
          }
          grp.add(tent);
          for (let f = 0; f < 24; f++) {
            const fa = rng() * Math.PI * 2;
            const fr = 4 + rng() * 9;
            const px = tSpec.x + Math.cos(fa) * fr;
            const pz = tSpec.z + Math.sin(fa) * fr;
            crowdSpots.push({ x: px, y: 0, z: pz, ry: rng() * Math.PI * 2, color: FAN_PALETTE[Math.floor(rng() * FAN_PALETTE.length)] });
            if (f % 2 === 0) beerSpots.push({ x: px, y: 0, z: pz, ry: fa });
          }
        });

        if (layout.djStage) {
          const stageGrp = new THREE.Group();
          stageGrp.position.set(layout.djStage.x, 0, layout.djStage.z);
          const stageDeck = new THREE.Mesh(new THREE.BoxGeometry(20, 2.2, 12), new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 }));
          stageDeck.position.y = 1.1; stageGrp.add(stageDeck);
          const stageBack = new THREE.Mesh(new THREE.BoxGeometry(19, 9.5, 1.0), new THREE.MeshBasicMaterial({ color: 0x3b0764 }));
          stageBack.position.set(0, 6.8, -5.2); stageGrp.add(stageBack);
          const stageRoof = new THREE.Mesh(new THREE.BoxGeometry(21, 0.9, 13), new THREE.MeshStandardMaterial({ color: 0x1e293b }));
          stageRoof.position.y = 11.8; stageGrp.add(stageRoof);
          const beamCols = [0xec4899, 0x38bdf8, 0xfacc15, 0x22c55e];
          beamCols.forEach((bc, bi) => {
            const bMat = new THREE.MeshBasicMaterial({ color: bc, transparent: true, opacity: 0.34, depthWrite: false });
            const cone = new THREE.Mesh(new THREE.ConeGeometry(3.2, 16, 10, 1, true), bMat);
            cone.position.set(-6 + bi * 4, 8.5, 2.0);
            cone.rotation.x = 0.55;
            stageGrp.add(cone);
            state.djBeams.push({ mesh: cone, mat: bMat, phase: bi * 1.5 });
          });
          grp.add(stageGrp);
        }
      }

      // Build single-draw-call GPU-instanced cheering crowd + raised beer cups!
      state.crowdRef = buildAnimatedCrowd(crowdSpots, beerSpots);
      grp.add(state.crowdRef.group);

      // 11. OBSTRUCTION-FREE SUNLIT TREES / URBAN SKYLINES / FLOODLIGHTS (Every prop >= 26m from track & pit!)
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3d24, roughness: 0.9 });
      const foliageMats = [
        new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.85 }),
        new THREE.MeshStandardMaterial({ color: 0x3f8f38, roughness: 0.85 }),
        new THREE.MeshStandardMaterial({ color: 0x558b2f, roughness: 0.85 }),
        new THREE.MeshStandardMaterial({ color: 0x1b5e20, roughness: 0.88 }),
      ];
      (layout ? layout.props : []).forEach((pr) => {
        const i = pr.idx;
        const px = pr.x;
        const pz = pr.z;

        if (theme.isNight && i % 3 === 0) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.45, 24, 6), gantryMat);
          pole.position.set(px, 12, pz);
          grp.add(pole);
          const bank = new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.4, 1.0), new THREE.MeshBasicMaterial({ color: 0xf0f9ff }));
          bank.position.set(px, 24, pz);
          bank.lookAt(pr.lookX, 1, pr.lookZ);
          grp.add(bank);
          // Volumetric night-race stadium floodlight beam cone illuminating the asphalt!
          const beamMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.085, depthWrite: false, side: THREE.DoubleSide });
          const beam = new THREE.Mesh(new THREE.ConeGeometry(13.5, 28, 10, 1, true), beamMat);
          beam.position.set((px + pr.lookX) * 0.5, 12.2, (pz + pr.lookZ) * 0.5);
          beam.lookAt(pr.lookX, 0, pr.lookZ);
          beam.rotateX(Math.PI * 0.5);
          grp.add(beam);
        } else if (circuit.biome === "street" || circuit.biome === "night_street" || (circuit.id === "melbourne" && i % 4 === 0)) {
          const h = 22 + Math.floor(rng() * 55);
          const w = 12 + Math.floor(rng() * 14);
          const cCol = theme.isNight ? (0x1e293b + (i % 4) * 0x081020) : (0x64748b + (i % 4) * 0x101418);
          const tower = new THREE.Mesh(
            new THREE.BoxGeometry(w, h, w),
            new THREE.MeshStandardMaterial({ color: cCol, roughness: 0.35, metalness: 0.55 })
          );
          tower.position.set(px, h * 0.5, pz);
          grp.add(tower);
          if (theme.isNight) {
            const neon = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 1.0, w + 0.3), new THREE.MeshBasicMaterial({ color: FAN_PALETTE[i % FAN_PALETTE.length] }));
            neon.position.set(px, h - 1.5, pz);
            grp.add(neon);
          }
        } else if (circuit.biome === "desert" || circuit.biome === "night_desert") {
          const h = 8 + rng() * 5;
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, h, 6), trunkMat);
          trunk.position.set(px, h * 0.5, pz);
          grp.add(trunk);
          const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(3.2, 0), foliageMats[1]);
          crown.scale.set(1.4, 0.55, 1.4);
          crown.position.set(px, h + 0.8, pz);
          grp.add(crown);
        } else {
          const tree = new THREE.Group();
          tree.position.set(px, 0, pz);
          const h = 5.5 + rng() * 5.0;
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.52, h * 0.55, 6), trunkMat);
          trunk.position.y = h * 0.27;
          tree.add(trunk);
          const fMat = foliageMats[i % foliageMats.length];
          const c1 = new THREE.Mesh(new THREE.DodecahedronGeometry(3.4 + rng() * 1.6, 1), fMat);
          c1.position.set(0, h * 0.72, 0);
          tree.add(c1);
          const c2 = new THREE.Mesh(new THREE.DodecahedronGeometry(2.4 + rng() * 1.2, 1), foliageMats[(i + 1) % foliageMats.length]);
          c2.position.set(1.6, h * 0.58, 1.2);
          tree.add(c2);
          grp.add(tree);
        }
      });

      if (fest && circuit.id === "vegas") {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(42, 24, 18),
          new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
        );
        sphere.position.set(fest.x - 95, 36, fest.z + 70);
        grp.add(sphere);
      } else if (fest && circuit.id === "austin") {
        const cotaTower = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 4.5, 76, 10), new THREE.MeshStandardMaterial({ color: 0xe10600, roughness: 0.35, metalness: 0.5 }));
        cotaTower.position.set(fest.x - 60, 38, fest.z + 40);
        grp.add(cotaTower);
      }

      // 12. Orbiting TV Broadcast Helicopter overhead!
      const heli = buildHelicopter();
      heli.group.position.set(0, 58, 0);
      grp.add(heli.group);
      state.helicopter = heli;

      // 13. GPU Particle Pools: Sharp Titanium/Magnesium Bottoming Sparks + Subtle Non-Blinding Rain Mist!
      const makeSparkSprite = () => {
        const cv = document.createElement("canvas");
        cv.width = 32; cv.height = 32;
        const c2 = cv.getContext("2d");
        const g = c2.createRadialGradient(16, 16, 0.5, 16, 16, 14);
        g.addColorStop(0.0, "rgba(255,250,210,1)");
        g.addColorStop(0.35, "rgba(255,170,35,0.92)");
        g.addColorStop(0.75, "rgba(255,88,10,0.38)");
        g.addColorStop(1.0, "rgba(255,40,0,0)");
        c2.fillStyle = g;
        c2.fillRect(0, 0, 32, 32);
        return new THREE.CanvasTexture(cv);
      };
      const makeMistSprite = () => {
        const cv = document.createElement("canvas");
        cv.width = 32; cv.height = 32;
        const c2 = cv.getContext("2d");
        const g = c2.createRadialGradient(16, 16, 2, 16, 16, 15);
        g.addColorStop(0.0, "rgba(165,186,208,0.42)");
        g.addColorStop(0.55, "rgba(148,168,190,0.18)");
        g.addColorStop(1.0, "rgba(148,168,190,0)");
        c2.fillStyle = g;
        c2.fillRect(0, 0, 32, 32);
        return new THREE.CanvasTexture(cv);
      };
      const sparkTex = makeSparkSprite();
      const mistTex = makeMistSprite();
      const makePool = (count, colorHex, size, opacity, tex, additive) => {
        const pos = new Float32Array(count * 3);
        const vel = new Float32Array(count * 3);
        const life = new Float32Array(count);
        for (let i = 0; i < count; i++) { pos[i * 3 + 1] = -999; life[i] = 0; }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({
          color: colorHex,
          map: tex,
          size,
          transparent: true,
          opacity,
          depthWrite: false,
          blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        });
        const ptsMesh = new THREE.Points(geo, mat);
        ptsMesh.frustumCulled = false;
        grp.add(ptsMesh);
        return { geo, pos, vel, life, cursor: 0, count };
      };
      state.sparkSystem = makePool(360, 0xffb326, 0.34, 0.95, sparkTex, false);
      state.magSparkSystem = makePool(180, 0xfff3b0, 0.36, 0.95, sparkTex, false);
      state.spraySystem = makePool(240, 0x9fb4ca, 0.72, 0.24, mistTex, false);
      state.breakdownSmokeSystem = makePool(220, 0x64748b, 1.85, 0.52, mistTex, false);
      state.lockupSmokeSystem = makePool(180, 0xf1f5f9, 1.18, 0.62, mistTex, false);

      // 13a. Camera-Centered 3D Falling Rain Streaks System (active when wetness >= 22%!)
      const rainCount = 620;
      const rainPos = new Float32Array(rainCount * 2 * 3);
      const rainOff = new Float32Array(rainCount * 3);
      for (let ri = 0; ri < rainCount; ri++) {
        rainOff[ri * 3]     = (Math.random() - 0.5) * 95;
        rainOff[ri * 3 + 1] = Math.random() * 44;
        rainOff[ri * 3 + 2] = (Math.random() - 0.5) * 95;
      }
      const rainGeo = new THREE.BufferGeometry();
      rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
      const rainMat = new THREE.LineBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.42, depthWrite: false });
      const rainLines = new THREE.LineSegments(rainGeo, rainMat);
      rainLines.frustumCulled = false;
      rainLines.visible = false;
      grp.add(rainLines);
      state.rainSystem = { lines: rainLines, geo: rainGeo, mat: rainMat, pos: rainPos, off: rainOff, count: rainCount };

      // 13b. Physical 3D FIA Safety Car + Trackside FIA Digital Marshal Flag Panels + Persistent Track Debris Group
      state.safetyCar3D = buildSafetyCar3D();
      grp.add(state.safetyCar3D.group);

      state.debrisGroup = new THREE.Group();
      grp.add(state.debrisGroup);
      state.debrisKey = "";

      state.marshalPanels = [];
      const postSteel = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.45, metalness: 0.55 });
      for (let mi = 0; mi < 12; mi++) {
        const mProg = (mi + 0.5) / 12;
        const mp = sample3DTrack(mProg);
        const rx = -mp.tz, rz = mp.tx;
        const side = (mProg < 0.12 || mProg > 0.88) ? -pitSide : (mi % 2 === 0 ? 1 : -1);
        const mx = mp.x + rx * side * 14.4;
        const mz = mp.z + rz * side * 14.4;
        const pGrp = new THREE.Group();
        pGrp.position.set(mx, mp.y || 0, mz);
        pGrp.rotation.y = Math.atan2(mp.tx, mp.tz);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 3.6, 6), postSteel);
        pole.position.y = 1.8;
        const panelMat = new THREE.MeshBasicMaterial({ color: 0x111827 });
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.15, 1.75), panelMat);
        panel.position.set(0, 3.35, 0);
        pGrp.add(pole, panel);
        grp.add(pGrp);
        state.marshalPanels.push({ mat: panelMat, sector: Math.floor(mProg * 3) + 1 });
      }

      // 14. Obstruction-Free Elevated Trackside TV Broadcast Cameras (adjusted for local hill elevation!)
      state.tvCams = (layout ? layout.tvCams : []).map((tc) => {
        const tElev = (ARCH && ARCH.getCircuitElevationAndBank) ? ARCH.getCircuitElevationAndBank(circuit, tc.prog || 0).y : 0;
        return {
          prog: tc.prog,
          pos: new THREE.Vector3(tc.x, tc.y + tElev, tc.z),
        };
      });
    }

    function spawnParticle(pool, x, y, z, vx, vy, vz, maxLife) {
      if (!pool) return;
      const i = pool.cursor;
      pool.cursor = (pool.cursor + 1) % pool.count;
      pool.pos[i * 3] = x;
      pool.pos[i * 3 + 1] = y;
      pool.pos[i * 3 + 2] = z;
      pool.vel[i * 3] = vx;
      pool.vel[i * 3 + 1] = vy;
      pool.vel[i * 3 + 2] = vz;
      pool.life[i] = maxLife;
    }

    function stepPool(pool, dt, gravity) {
      if (!pool) return;
      for (let i = 0; i < pool.count; i++) {
        if (pool.life[i] <= 0) continue;
        pool.life[i] -= dt;
        if (pool.life[i] <= 0) {
          pool.pos[i * 3 + 1] = -999;
        } else {
          pool.vel[i * 3 + 1] -= gravity * dt;
          pool.pos[i * 3]     += pool.vel[i * 3] * dt;
          pool.pos[i * 3 + 1] = Math.max(0.08, pool.pos[i * 3 + 1] + pool.vel[i * 3 + 1] * dt);
          pool.pos[i * 3 + 2] += pool.vel[i * 3 + 2] * dt;
        }
      }
      pool.geo.attributes.position.needsUpdate = true;
    }

    function ensureCarMesh(car, wantHero) {
      const existing = state.carMeshes.get(car.idx);
      if (existing && existing.isHero === wantHero) return existing;
      if (existing) {
        if (global.F1Car3D && global.F1Car3D.disposeObject) global.F1Car3D.disposeObject(existing.group);
        scene.remove(existing.group);
      }
      let grp;
      if (wantHero && global.F1Car3D && global.F1Car3D.createCar) {
        const pal = car.palette || { main: car.color || "#e10600", secondary: "#111622", accent: "#facc15", pop: "#ffffff", detail: "#262c36" };
        grp = global.F1Car3D.createCar(pal, car.liveryStyle || "two-tone", car.era || "2020s");
        grp.scale.setScalar(1.06);
      } else {
        grp = makeSculptedGridCar(car.color);
      }
      const fx = attachDynamicCarFX(grp);
      scene.add(grp);
      const entry = { group: grp, isHero: wantHero, color: car.color, fx };
      state.carMeshes.set(car.idx, entry);
      return entry;
    }

    function updateAndRender(opts) {
      if (!state.active) return;
      if (!ensureRenderer()) return;
      const { circuit, cars, focusIdx, dt, paused, raceState } = opts;
      if (!circuit || !cars || !cars.length) return;
      buildCircuit3D(circuit);

      const cssW = canvasEl.clientWidth || (canvasEl.parentElement && canvasEl.parentElement.clientWidth) || 720;
      const cssH = canvasEl.clientHeight || (canvasEl.parentElement && canvasEl.parentElement.clientHeight) || 480;
      if (cssW < 30 || cssH < 30) return;
      if (canvasEl.width !== Math.round(cssW * renderer.getPixelRatio()) || canvasEl.height !== Math.round(cssH * renderer.getPixelRatio())) {
        renderer.setSize(cssW, cssH, false);
        camera.aspect = cssW / cssH;
        camera.updateProjectionMatrix();
      }

      const stepDt = paused ? 0 : Math.min(0.05, dt || 0.016);
      state.elapsed += stepDt;

      const rs = raceState || {};
      const wetness = Math.max(0, Math.min(100, Number(rs.wetness || 0)));
      const wetNorm = wetness / 100;

      // Update Sky Dome, Wet Asphalt sheen, Animated Crowd excitement, Waving Flags, Smoke Flares, Ferris Wheel & Helicopter!
      if (state.skyUniforms) {
        state.skyUniforms.uTime.value = state.elapsed;
        state.skyUniforms.uWetness.value = wetNorm;
      }
      if (state.roadMat) {
        state.roadMat.roughness = 0.72 - wetNorm * 0.50;
        state.roadMat.metalness = 0.12 + wetNorm * 0.42;
      }
      if (state.dryLineMat) {
        // Dark rubbered groove builds up with track grip; on a drying damp track (10-65% wet) a crisp dark dry line stands out!
        const grip = Math.max(0.2, Math.min(1.0, Number(rs.trackGrip || 0.55)));
        const dryingBoost = (wetness >= 8 && wetness <= 68) ? (0.30 * Math.sin(((wetness - 8) / 60) * Math.PI)) : 0;
        state.dryLineMat.opacity = Math.min(0.62, 0.08 + grip * 0.24 + dryingBoost - (wetness > 75 ? 0.18 : 0));
        state.dryLineMat.roughness = wetness > 70 ? 0.35 : 0.88;
      }
      if (state.rainSystem) {
        const rainOn = wetness >= 22;
        state.rainSystem.lines.visible = rainOn;
        if (rainOn) {
          const rSys = state.rainSystem;
          const intensity = Math.min(1, (wetness - 18) / 72);
          rSys.mat.opacity = 0.18 + intensity * 0.38;
          const cx = camera.position.x, cy = Math.max(0, camera.position.y), cz = camera.position.z;
          const fallSpeed = 38 + intensity * 24;
          const streakLen = 1.65 + intensity * 1.35;
          for (let ri = 0; ri < rSys.count; ri++) {
            let oy = rSys.off[ri * 3 + 1] - fallSpeed * stepDt;
            if (oy < -4) oy += 44;
            rSys.off[ri * 3 + 1] = oy;
            const px = cx + rSys.off[ri * 3];
            const py = cy - 10 + oy;
            const pz = cz + rSys.off[ri * 3 + 2];
            const pi = ri * 6;
            rSys.pos[pi]     = px;
            rSys.pos[pi + 1] = py;
            rSys.pos[pi + 2] = pz;
            rSys.pos[pi + 3] = px + 0.35;
            rSys.pos[pi + 4] = py - streakLen;
            rSys.pos[pi + 5] = pz + 0.18;
          }
          rSys.geo.attributes.position.needsUpdate = true;
        }
      }
      if (state.crowdRef) {
        state.crowdRef.uTime.value = state.elapsed;
        state.crowdRef.uExcite.value = rs.chequered ? 1.85 : 1.05;
      }
      for (let i = 0; i < state.flagUniforms.length; i++) {
        state.flagUniforms[i].uTime.value = state.elapsed;
      }
      for (let i = 0; i < state.smokePuffs.length; i++) {
        const sp = state.smokePuffs[i];
        const cycle = ((state.elapsed * sp.speed + sp.phase) % 5.0) / 5.0;
        sp.mesh.position.set(
          sp.baseX + Math.sin(state.elapsed * 0.9 + sp.phase) * 3.5 + cycle * 9.0,
          sp.baseY + cycle * 22.0,
          sp.baseZ + Math.cos(state.elapsed * 0.7 + sp.phase) * 2.5
        );
        const s = 0.7 + cycle * 1.9;
        sp.mesh.scale.setScalar(s);
        sp.mesh.material.opacity = Math.sin(cycle * Math.PI) * (rs.chequered ? 0.48 : 0.28);
      }
      if (state.ferrisWheel) {
        state.ferrisWheel.rotation.z += stepDt * 0.22;
      }
      for (let i = 0; i < state.djBeams.length; i++) {
        const b = state.djBeams[i];
        b.mesh.rotation.z = Math.sin(state.elapsed * 2.6 + b.phase) * 0.45;
        b.mat.opacity = 0.20 + 0.20 * Math.abs(Math.sin(state.elapsed * 4.2 + b.phase));
      }
      if (state.helicopter) {
        state.helicopter.rotor.rotation.y += stepDt * 24;
        const ha = state.elapsed * 0.12;
        state.helicopter.group.position.set(Math.cos(ha) * 190, 56 + Math.sin(state.elapsed * 0.8) * 3, Math.sin(ha) * 190);
        state.helicopter.group.rotation.y = -ha;
      }

      // Redraw Live Canvas2D LED Jumbotrons every 0.5s
      if (state.elapsed - state.lastJumbotronDraw >= 0.45 || state.lastJumbotronDraw < 0) {
        state.lastJumbotronDraw = state.elapsed;
        jumbotron.draw(state.circuitName, rs);
      }

      const focCar = cars.find((c) => c.idx === focusIdx && !c.dnf) || cars.find((c) => !c.dnf) || cars[0];
      // Top 8 closest cars to camera use full sculpted F1Car3D hero models
      const nearestIds = new Set();
      if (focCar) {
        nearestIds.add(focCar.idx);
        cars
          .filter((c) => !c.dnf && c.idx !== focCar.idx)
          .sort((a, b) => Math.abs(a.totalProg - focCar.totalProg) - Math.abs(b.totalProg - focCar.totalProg))
          .slice(0, 7)
          .forEach((c) => nearestIds.add(c.idx));
      }

      let focPos = new THREE.Vector3();
      let focFwd = new THREE.Vector3(0, 0, 1);
      let focDyn = null;
      let focPitMotion = null;
      let pittingCarPos = null;
      let pittingBoxIdx = -1;
      const rainBlink = (Math.floor(state.elapsed * 5) % 2 === 0) ? 0.95 : 0.15;
      const VP = global.F1VehiclePhysics;
      const ARCH = global.F1TrackArchitect;
      const eraKey = (rs && rs.eraKey) || "2026";
      const startSeq = rs && rs.startSeq;

      // Update Overhead 3D FIA 5-Red-Lights Start Gantry Bulbs!
      if (state.gantryBulbMats && state.gantryBulbMats.length) {
        const isHold = startSeq && startSeq.active && !startSeq.lightsOut;
        const isGreenFlash = startSeq && startSeq.lightsOut && (startSeq.lightsOutElapsed || 0) < 2.2;
        const lit = isHold ? (startSeq.litCount || 0) : 0;
        for (let bi = 0; bi < state.gantryBulbMats.length; bi++) {
          if (isHold) {
            state.gantryBulbMats[bi].color.setHex(bi < lit ? 0xff1e1e : 0x1e293b);
          } else if (isGreenFlash) {
            state.gantryBulbMats[bi].color.setHex(0x22c55e);
          } else {
            state.gantryBulbMats[bi].color.setHex(0x1e293b);
          }
        }
      }

      // Reset pit box states each frame before animating active pitting cars
      const activeBoxState = new Map();

      // Sync Persistent 3D Track Carbon-Fibre Debris Shards (cleared by marshals / SC / Red Flag!)
      const debrisZones = Array.isArray(rs.debrisZones) ? rs.debrisZones : [];
      const dKey = debrisZones.map((d) => d.id).join(",");
      if (state.debrisGroup && dKey !== state.debrisKey) {
        state.debrisKey = dKey;
        while (state.debrisGroup.children.length) {
          const ch = state.debrisGroup.children[0];
          state.debrisGroup.remove(ch);
          if (ch.geometry) ch.geometry.dispose();
          if (ch.material) ch.material.dispose();
        }
        const carbMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.7, metalness: 0.25 });
        const orangeMat = new THREE.MeshBasicMaterial({ color: 0xf97316 });
        debrisZones.forEach((dz) => {
          const sp = sample3DTrack(dz.prog || 0);
          const rx = -sp.tz, rz = sp.tx;
          for (let k = 0; k < 10; k++) {
            const ang = (k * 2.399) + (dz.id || 1);
            const rad = 0.8 + (k % 5) * 1.15;
            const lx = (dz.lat || 0) + Math.cos(ang) * rad;
            const lz = Math.sin(ang) * rad * 1.4;
            const shard = new THREE.Mesh(
              new THREE.BoxGeometry(0.32 + (k % 3) * 0.14, 0.06, 0.22 + (k % 2) * 0.16),
              k % 4 === 0 ? orangeMat : carbMat
            );
            shard.position.set(
              sp.x + rx * lx + sp.tx * lz,
              (sp.y || 0) + 0.08 + (sp.bankRad ? Math.sin(sp.bankRad) * lx : 0),
              sp.z + rz * lx + sp.tz * lz
            );
            shard.rotation.set(0.1 * k, ang, 0.2 * (k % 3));
            state.debrisGroup.add(shard);
          }
        });
      }

      // Animate Trackside FIA Digital Marshal Flag Panels (Red Flag / Safety Car / Yellow Sector!)
      if (state.marshalPanels && state.marshalPanels.length) {
        const blinkOn = Math.floor(state.elapsed * 4.5) % 2 === 0;
        for (let mi = 0; mi < state.marshalPanels.length; mi++) {
          const mp = state.marshalPanels[mi];
          if (rs.redFlag) {
            mp.mat.color.setHex(blinkOn ? 0xef4444 : 0x7f1d1d);
          } else if (rs.scActive || rs.vscActive || (rs.yellowSector > 0 && mp.sector === rs.yellowSector)) {
            mp.mat.color.setHex(blinkOn ? 0xfacc15 : 0x713f12);
          } else {
            mp.mat.color.setHex(0x111827);
          }
        }
      }

      // Physical 3D FIA Safety Car ahead of P1 during Safety Car periods!
      if (state.safetyCar3D) {
        if (rs.scActive && !rs.redFlag) {
          const leaderCar = cars.find((c) => !c.dnf && c.pos === 1) || cars.find((c) => !c.dnf);
          if (leaderCar) {
            state.safetyCar3D.group.visible = true;
            const scProg = (leaderCar.totalProg || 0) + 0.013;
            const scPose = sample3DTrack(scProg);
            const scPhase = Math.floor(state.elapsed * 6.5) % 2;
            const scIn = !!rs.scInThisLap;
            // On final SC lap near pit entry, peel slightly toward pitSide!
            const pMod = ((scProg % 1) + 1) % 1;
            const peel = (scIn && pMod > 0.88) ? (state.pitSide * ((pMod - 0.88) / 0.12) * 8.5) : 0;
            state.safetyCar3D.group.position.set(
              scPose.x + (-scPose.tz) * peel,
              (scPose.y || 0) + 0.04,
              scPose.z + scPose.tx * peel
            );
            state.safetyCar3D.group.rotation.order = "YXZ";
            state.safetyCar3D.group.rotation.set(-(scPose.slopePitch || 0), Math.atan2(scPose.tx, scPose.tz), scPose.bankRad || 0);
            if (scIn) {
              // Roof lights switch OFF / Green when Safety Car is coming in this lap!
              state.safetyCar3D.amberL.color.setHex(0x1e293b);
              state.safetyCar3D.amberR.color.setHex(0x1e293b);
              state.safetyCar3D.centerMat.color.setHex(scPhase === 0 ? 0x22c55e : 0x14532d);
            } else {
              state.safetyCar3D.amberL.color.setHex(scPhase === 0 ? 0xfacc15 : 0x78350f);
              state.safetyCar3D.amberR.color.setHex(scPhase === 1 ? 0xfacc15 : 0x78350f);
              state.safetyCar3D.centerMat.color.setHex(0x22c55e);
            }
          }
        } else {
          state.safetyCar3D.group.visible = false;
        }
      }

      cars.forEach((car) => {
        const existing = state.carMeshes.get(car.idx);
        if (car.dnf) {
          // Procedural Trackside Smoking Breakdown / Crash Car — NO MORE VANISHING DNFs!
          if (car.cleared) {
            if (existing) existing.group.visible = false;
            return;
          }
          const entry = ensureCarMesh(car, false);
          const mesh = entry.group;
          mesh.visible = true;
          const bPose = sample3DTrack(car.parkedProg != null ? car.parkedProg : (car.totalProg || 0));
          const bSide = car.parkedSide != null ? car.parkedSide : (car.idx % 2 === 0 ? 1 : -1);
          const bLat = bSide * 11.4;
          const bx = bPose.x + (-bPose.tz) * bLat;
          const bz = bPose.z + bPose.tx * bLat;
          const bYaw = Math.atan2(bPose.tx, bPose.tz) + (car.parkedYawOff != null ? car.parkedYawOff : (bSide * 0.42));
          mesh.position.set(bx, (bPose.y || 0) + 0.05, bz);
          mesh.rotation.order = "YXZ";
          mesh.rotation.set(0.03 - (bPose.slopePitch || 0), bYaw, bSide * 0.05 + (bPose.bankRad || 0));
          if (entry.fx) {
            entry.fx.brakeMat.opacity = 0;
            entry.fx.drsMat.opacity = 0;
            entry.fx.rainMat.opacity = rainBlink;
            if (entry.fx.dmgWingGrp) entry.fx.dmgWingGrp.visible = !!car.wingDamaged || car.breakdownKind === "crash";
          }
          if (!paused && car.smokeActive !== false && state.breakdownSmokeSystem && Math.random() < 0.55) {
            spawnParticle(
              state.breakdownSmokeSystem,
              bx + (Math.random() - 0.5) * 0.9,
              (bPose.y || 0) + 0.72 + Math.random() * 0.3,
              bz + (Math.random() - 0.5) * 0.9,
              (Math.random() - 0.5) * 1.4,
              1.6 + Math.random() * 1.5,
              (Math.random() - 0.5) * 1.4,
              2.2 + Math.random() * 1.2
            );
          }
          return;
        }
        const entry = ensureCarMesh(car, nearestIds.has(car.idx));
        const mesh = entry.group;
        mesh.visible = true;
        const inPit = car.inPit > 0 && car.pitDuration > 0;
        const pitU = inPit ? (1 - Math.max(0, Math.min(1, car.inPit / car.pitDuration))) : 0;
        const pitMotion = (inPit && ARCH && state.layout && state.layout.pitLayout)
          ? ARCH.samplePitStopMotion(state.layout.pitLayout, pitU, car.pitBoxIdx != null ? car.pitBoxIdx : (car.idx % 10))
          : null;

        let wx, wz, trackY = 0, slopePitch = 0, bankRad = 0, heaveY = 0.06, yaw = 0, pitchRad = 0, rollRad = 0, dyn = null;
        if (pitMotion) {
          wx = pitMotion.x;
          wz = pitMotion.z;
          heaveY = 0.055 + (pitMotion.jackLift || 0);
          yaw = pitMotion.yaw;
          pitchRad = pitMotion.jackLift > 0.01 ? -0.024 : 0;
          rollRad = 0;
          activeBoxState.set(pitMotion.boxIdx, pitMotion);
          // Keep per-car physics state synced cleanly so pit exit has zero jump
          const pState = state.carPhysics.get(car.idx);
          if (pState) {
            pState.wx = wx;
            pState.wz = wz;
            pState.yaw = yaw;
            pState.latPos = 0;
            pState.latVel = 0;
          }
        } else {
          const pose = inPit
            ? sample3DPit(pitU)
            : sample3DTrack(car.totalProg);
          const latTarget = inPit ? 0 : Math.max(-5.6, Math.min(5.6, (car.latOffset || 0) * 1.12));
          trackY = inPit ? 0 : ((pose.y || 0) + (pose.bankRad ? Math.sin(pose.bankRad) * latTarget : 0));
          slopePitch = inPit ? 0 : (pose.slopePitch || 0);
          bankRad = inPit ? 0 : (pose.bankRad || 0);
          yaw = Math.atan2(pose.tx, pose.tz);
          const effectiveKph = car.liveKph != null ? car.liveKph : 220;

          if (VP && VP.stepCarPhysics) {
            let pState = state.carPhysics.get(car.idx);
            if (!pState) {
              pState = VP.createCarPhysicsState(car, eraKey);
              state.carPhysics.set(car.idx, pState);
            }
            dyn = VP.stepCarPhysics(pState, {
              x: pose.x,
              z: pose.z,
              tx: pose.tx,
              tz: pose.tz,
              curv: pose.curv || 0,
              bumpMm: pose.bumpMm || 0,
              targetLat: latTarget,
              liveKph: effectiveKph,
              liveLongG: car.liveLongG || 0,
              drsOpen: !!car.drsOpen,
              fuelKg: car.fuelKg,
              floorHealth: car.floorHealth,
              suspHealth: car.suspHealth,
              balanceBias: car.balanceBias,
              inPit,
            }, stepDt > 0 ? stepDt : 0.016, { wetness });
            wx = dyn.wx;
            wz = dyn.wz;
            heaveY = dyn.heaveY;
            yaw = dyn.yaw;
            pitchRad = dyn.pitchRad;
            rollRad = dyn.rollRad;
          } else {
            const rx = -pose.tz, rz = pose.tx;
            wx = pose.x + rx * latTarget;
            wz = pose.z + rz * latTarget;
          }
        }

        const worldY = trackY + heaveY;
        mesh.position.set(wx, worldY, wz);
        mesh.rotation.order = "YXZ";
        mesh.rotation.set(pitchRad - slopePitch, yaw, rollRad + bankRad);

        // Phase B Living Car Mechanics: Spinning Wheels, Front-Wheel Steering & Hinged 3D DRS Flap!
        const wheels = mesh.userData && mesh.userData.wheels;
        if (wheels && wheels.length) {
          const wSpin = dyn ? (dyn.wheelSpin || 0) : (state.elapsed * ((car.liveKph || 0) / 14));
          const wSteer = pitMotion
            ? (pitMotion.phase === "turn_in" ? state.pitSide * 0.28 : (pitMotion.phase === "release" ? -state.pitSide * 0.25 : 0))
            : (dyn ? (dyn.steerAngle || 0) : 0);
          for (let wi = 0; wi < wheels.length; wi++) {
            const wg = wheels[wi];
            wg.rotation.x = wSpin;
            if (wg.userData && wg.userData.isFront) {
              wg.rotation.y = wSteer;
            }
          }
        }
        const drsFlap = mesh.userData && mesh.userData.drsFlap;
        if (drsFlap) {
          const drsTarget = (!inPit && (car.drsOpen || (dyn && dyn.inXMode))) ? -0.48 : 0.0;
          drsFlap.rotation.x += (drsTarget - drsFlap.rotation.x) * Math.min(1, (stepDt || 0.016) * 14);
        }

        // Update dynamic Pirelli tyre compound ring, glowing brakes, DRS, wet rain light & 3D damaged front wing!
        if (entry.fx) {
          entry.fx.ringMat.color.setHex(COMPOUND_HEX[car.compound] || 0xfacc15);
          const braking = (car.liveLongG || 0) < -1.1 || (pitMotion && pitMotion.phase === "turn_in");
          entry.fx.brakeMat.opacity = braking ? 0.92 : 0.0;
          entry.fx.drsMat.opacity = (!inPit && (car.drsOpen || (dyn && dyn.inXMode))) ? 0.95 : 0.0;
          entry.fx.rainMat.opacity = wetness >= 20 ? rainBlink : 0.08;
          if (entry.fx.dmgWingGrp) entry.fx.dmgWingGrp.visible = !!car.wingDamaged;
        }
        // Front-wing endplate scraping asphalt sparks when damaged!
        if (!paused && !inPit && car.wingDamaged && (car.liveKph || 0) > 130 && Math.random() < 0.45) {
          const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
          spawnParticle(
            state.sparkSystem,
            wx + fwdX * 2.2 + (Math.random() - 0.5) * 0.5,
            trackY + 0.09,
            wz + fwdZ * 2.2 + (Math.random() - 0.5) * 0.5,
            -fwdX * 14 + (Math.random() - 0.5) * 3,
            1.1 + Math.random() * 1.4,
            -fwdZ * 14 + (Math.random() - 0.5) * 3,
            0.22
          );
        }
        // 3D White Lock-Up Tyre Smoke bursting from front tyres during braking lock-ups!
        if (!paused && !inPit && state.lockupSmokeSystem && ((car.lockupSmokeTimer || 0) > 0 || ((car.liveLongG || 0) < -3.45 && (car.liveKph || 0) > 125 && Math.random() < 0.25))) {
          const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
          const rightX = -fwdZ, rightZ = fwdX;
          const wheelSide = (Math.random() < 0.5 ? -0.92 : 0.92);
          spawnParticle(
            state.lockupSmokeSystem,
            wx + fwdX * 1.75 + rightX * wheelSide,
            trackY + 0.22,
            wz + fwdZ * 1.75 + rightZ * wheelSide,
            -fwdX * 4.5 + (Math.random() - 0.5) * 1.6,
            0.95 + Math.random() * 1.2,
            -fwdZ * 4.5 + (Math.random() - 0.5) * 1.6,
            0.85 + Math.random() * 0.45
          );
        }

        // Authentic Per-Car Physics Particles:
        // 1. Titanium / Magnesium Skid-Block Sparks ONLY when THIS car physically bottoms out!
        // 2. Subtle, non-blinding low-wake rain mist ONLY in wet conditions (never obstructing POV!)
        if (!paused && !inPit && nearestIds.has(car.idx)) {
          const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
          if (dyn && dyn.bottoming > 0.06) {
            const sparkPool = dyn.skidType === "magnesium" ? state.magSparkSystem : state.sparkSystem;
            const burst = Math.max(1, Math.round(dyn.bottoming * 5));
            for (let b = 0; b < burst; b++) {
              const spreadX = (Math.random() - 0.5) * 0.75;
              const spreadZ = (Math.random() - 0.5) * 0.75;
              spawnParticle(
                sparkPool,
                wx - fwdX * (1.8 + Math.random() * 0.6) + spreadX * 0.4,
                trackY + 0.08 + Math.random() * 0.05,
                wz - fwdZ * (1.8 + Math.random() * 0.6) + spreadZ * 0.4,
                -fwdX * (18 + Math.random() * 14) + spreadX * 4.5,
                0.9 + Math.random() * 2.2 * dyn.bottoming,
                -fwdZ * (18 + Math.random() * 14) + spreadZ * 4.5,
                0.22 + Math.random() * 0.18
              );
            }
          }
          // Subtle low rear-diffuser water mist (only for cars ahead/around, never blinding!)
          if (wetness >= 28 && (!focCar || car.idx !== focCar.idx) && (car.liveKph || 0) > 65 && Math.random() < (wetness / 100) * 0.36) {
            spawnParticle(
              state.spraySystem,
              wx - fwdX * 2.7 + (Math.random() - 0.5) * 1.1,
              trackY + 0.24 + Math.random() * 0.16,
              wz - fwdZ * 2.7 + (Math.random() - 0.5) * 1.1,
              -fwdX * 5.5 + (Math.random() - 0.5) * 1.8,
              0.55 + Math.random() * 0.85,
              -fwdZ * 5.5 + (Math.random() - 0.5) * 1.8,
              0.38
            );
          }
        }

        if (inPit && !pittingCarPos) {
          pittingCarPos = new THREE.Vector3(wx, 0.85, wz);
          if (pitMotion) pittingBoxIdx = pitMotion.boxIdx;
        }
        if (focCar && car.idx === focCar.idx) {
          focPos.set(wx, worldY, wz);
          focFwd.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
          focDyn = dyn;
          focPitMotion = pitMotion;
        }
      });

      // Animate 3D Pit Box Crews & Overhead Red/Amber/Green Pit Release Gantries!
      if (state.pitBoxCrews && state.pitBoxCrews.length) {
        for (let b = 0; b < state.pitBoxCrews.length; b++) {
          const crew = state.pitBoxCrews[b];
          const gantry = state.pitBoxGantries && state.pitBoxGantries[b];
          const pm = activeBoxState.get(b);
          const targetAmt = pm && pm.crewActive ? 1.0 : 0.0;
          crew.activeAmt += (targetAmt - crew.activeAmt) * Math.min(1, (stepDt || 0.016) * 8.5);
          const bob = (pm && pm.stopped) ? Math.abs(Math.sin(state.elapsed * 18 + b)) * 0.14 : 0;
          for (let m = 0; m < crew.members.length; m++) {
            const mem = crew.members[m];
            mem.fig.position.x = mem.restX + (mem.workX - mem.restX) * crew.activeAmt;
            mem.fig.position.y = bob * (m < 4 ? 1 : 0.45);
          }
          if (gantry && gantry.mat) {
            const gs = pm ? pm.gantryState : "off";
            if (gs !== gantry.state) {
              gantry.state = gs;
              gantry.mat.color.setHex(
                gs === "red" ? 0xef4444
                  : (gs === "amber" ? 0xf59e0b
                    : (gs === "green" ? 0x22c55e : 0x334155))
              );
            }
          }
        }
      }

      stepPool(state.sparkSystem, stepDt, 12.5);
      stepPool(state.magSparkSystem, stepDt, 12.0);
      stepPool(state.spraySystem, stepDt, 1.4);
      stepPool(state.breakdownSmokeSystem, stepDt, -0.55);
      stepPool(state.lockupSmokeSystem, stepDt, -0.75);

      // Keep sun shadow frustum centered right on the hero car for crisp shadows everywhere on track!
      if (state.sunLight) {
        state.sunLight.position.set(focPos.x + 120, focPos.y + 220, focPos.z + 90);
        state.sunLight.target.position.copy(focPos);
        state.sunLight.target.updateMatrixWorld();
      }

      // Resolve Auto 3D Director mode
      let effMode = state.mode;
      if (state.mode === "director") {
        if (!paused) state.directorTimer += stepDt;
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
        // Silky Suspension-Coupled Onboard Halo T-Cam POV (climbs Spa Eau Rouge & COTA T1 seamlessly!)
        const pitchLookY = focDyn ? (-focDyn.pitchRad * 7.5) : 0;
        desiredPos.copy(focPos).addScaledVector(focFwd, -0.58);
        desiredPos.y = focPos.y + 1.42;
        desiredLook.copy(focPos).addScaledVector(focFwd, 32);
        desiredLook.y = focPos.y + 1.05 + pitchLookY;
        desiredFov = 66 + Math.min(10, ((focCar?.liveKph || 220) - 180) * 0.055);
        const pLerp = state.camInit ? Math.min(1, (dt || 0.016) * 24) : 1;
        const lLerp = state.camInit ? Math.min(1, (dt || 0.016) * 16) : 1;
        state.camPosSmooth.lerp(desiredPos, pLerp);
        state.camLookSmooth.lerp(desiredLook, lLerp);
      } else if (effMode === "chase") {
        desiredPos.copy(focPos).addScaledVector(focFwd, -10.8);
        desiredPos.y = focPos.y + 3.85;
        desiredLook.copy(focPos).addScaledVector(focFwd, 15);
        desiredLook.y = focPos.y + 1.25;
        desiredFov = 54 + Math.min(12, ((focCar?.liveKph || 220) - 180) * 0.07);
        const lerpF = state.camInit ? Math.min(1, (dt || 0.016) * 8.5) : 1;
        state.camPosSmooth.lerp(desiredPos, lerpF);
        state.camLookSmooth.lerp(desiredLook, lerpF);
      } else if (effMode === "pitlane") {
        const boxes = state.layout && state.layout.pitLayout && state.layout.pitLayout.boxes;
        const pBox = (boxes && pittingBoxIdx >= 0 && boxes[pittingBoxIdx]) ? boxes[pittingBoxIdx] : null;
        if (pBox && pittingCarPos) {
          desiredPos.set(
            pBox.fastX - pBox.tx * 11.0 - pBox.rx * state.pitSide * 2.8,
            4.2,
            pBox.fastZ - pBox.tz * 11.0 - pBox.rz * state.pitSide * 2.8
          );
          desiredLook.copy(pittingCarPos);
        } else {
          const pMid = state.pitPts[Math.floor(state.pitPts.length * 0.25)] || sample3DTrack(0);
          const pEnd = state.pitPts[Math.floor(state.pitPts.length * 0.65)] || sample3DTrack(0.02);
          desiredPos.set(pMid.x, 4.4, pMid.z);
          if (pittingCarPos) desiredLook.copy(pittingCarPos);
          else desiredLook.set(pEnd.x, 1.3, pEnd.z);
        }
        desiredFov = 46;
        const lerpF = state.camInit ? Math.min(1, (dt || 0.016) * 5.0) : 1;
        state.camPosSmooth.lerp(desiredPos, lerpF);
        state.camLookSmooth.lerp(desiredLook, lerpF);
      } else {
        let bestIdx = 0;
        let bestDist = Infinity;
        state.tvCams.forEach((tc, i) => {
          const d = tc.pos.distanceTo(focPos);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        });
        const camSpot = state.tvCams[bestIdx] || { pos: new THREE.Vector3(focPos.x + 25, focPos.y + 10, focPos.z + 25) };
        desiredPos.copy(camSpot.pos);
        desiredLook.copy(focPos).addScaledVector(focFwd, 5.0);
        desiredLook.y = focPos.y + 1.25;
        desiredFov = Math.max(26, Math.min(50, 56 - bestDist * 0.11));
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

      if (hudEl && focCar) {
        const camLabel = effMode === "pov" ? "ONBOARD T-CAM POV"
          : (effMode === "chase" ? "3RD PERSON CHASE"
            : (effMode === "pitlane" ? "PITLANE CAM" : "TRACKSIDE TV CAM"));
        const isHold = startSeq && startSeq.active && !startSeq.lightsOut;
        const dispKph = isHold ? 0 : (focPitMotion ? Math.round(focPitMotion.speedKph) : Math.round(focCar.liveKph != null ? focCar.liveKph : 260));
        const dispGear = isHold ? 1 : (focPitMotion && focPitMotion.stopped ? "N" : (focCar.liveGear || 6));
        let statusTag = "";
        if (rs.redFlag) {
          statusTag = `<span class="b3d-phys-tag" style="border-color:rgba(239,68,68,.7);background:rgba(153,27,27,.45);color:#fecaca;">🚩 <b>RED FLAG · PIT REPAIR</b></span>`;
        } else if (isHold) {
          const dots = "🔴".repeat(startSeq.litCount || 0) + "⚫".repeat(Math.max(0, 5 - (startSeq.litCount || 0)));
          statusTag = `<span class="b3d-phys-tag" style="border-color:rgba(239,68,68,.55);color:#fca5a5;">${dots} <b>GRID HOLD</b></span>`;
        } else if (rs.scActive) {
          statusTag = `<span class="b3d-phys-tag" style="border-color:rgba(250,204,21,.65);color:#fde047;">⚠️ <b>${rs.scInThisLap ? "SC IN THIS LAP" : "FIA SAFETY CAR"}</b></span>`;
        } else if (focPitMotion && focPitMotion.stopped) {
          statusTag = `<span class="b3d-phys-tag" style="border-color:rgba(250,204,21,.55);color:#fde047;">🔧 <b>PIT BOX SERVICE</b></span>`;
        } else if (focDyn) {
          statusTag = `<span class="b3d-phys-tag">RH <b>${focDyn.minRideMm}mm</b> · DF <b>${(focDyn.downforceKg / 1000).toFixed(1)}t</b>${focDyn.bottoming > 0.15 ? ` · <em style="color:#fbbf24;font-style:normal;font-weight:900;">⚡ PLANK</em>` : (focDyn.inXMode ? ` · <em style="color:#38bdf8;font-style:normal;font-weight:800;">X-MODE</em>` : "")}</span>`;
        }
        hudEl.innerHTML = `
          <span class="b3d-cam-tag"><i class="fas fa-video"></i> ${camLabel}${state.mode === "director" ? " · AUTO" : ""}</span>
          <span class="b3d-drv-tag"><i style="background:${focCar.color || "#e10600"}"></i>P${focCar.pos || 1} <b>${focCar.code3 || "DRV"}</b></span>
          <span class="b3d-speed-tag"><b>${dispKph}</b> KPH · G${dispGear}</span>
          ${statusTag}
        `;
      }
    }

    return {
      setActive(on) {
        state.active = !!on;
        canvasEl.classList.toggle("hidden", !state.active);
        if (hudEl) hudEl.classList.toggle("hidden", !state.active);
        const stage = canvasEl.closest(".sim-stage-panel");
        if (stage) stage.classList.toggle("is-3d-active", state.active);
        if (state.active) {
          state.camInit = false;
          return ensureRenderer();
        }
        return true;
      },
      isActive() { return state.active; },
      setMode(mode) {
        state.mode = mode || "tv";
        state.camInit = false;
      },
      getMode() { return state.mode; },
      getLayout() { return state.layout; },
      auditClearance() {
        if (!state.layout || !global.F1TrackArchitect) return null;
        return global.F1TrackArchitect.auditLayoutClearance(state.layout, state.trackPts);
      },
      updateAndRender,
      dispose() {
        disposeWorld();
        state.asphaltTex.dispose();
        state.sponsorTex.dispose();
        state.checkerTex.dispose();
        jumbotron.tex.dispose();
        if (renderer) renderer.dispose();
      },
    };
  }

  global.F1Broadcast3D = {
    createBroadcast3D,
  };
})(window);
