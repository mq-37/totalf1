/**
 * Live Three.js Full-Screen Multi-Scene 3D F1 Battle Arena for /play.
 *
 * 5 Distinct Iconic F1 Circuit Environments ("Scenes"):
 *   1. monza     — Temple of Speed: Golden sunset, grandstands, sponsor bridge, Italian cypress park, Parabolica apex
 *   2. monaco    — Monte Carlo Harbour: Mediterranean marina water, luxury superyachts, Riviera hillside, tight street barriers
 *   3. singapore — Marina Bay Night GP: Towering overhead floodlight trusses, neon skyline, rotating Singapore Flyer, SkyPark
 *   4. spa       — Eau Rouge Storm: Real 3D elevation climb (-1.2m -> +6.0m), Ardennes pine valley, heavy rain & rooster-tail spray
 *   5. cota      — Austin Twilight Climb: Uphill left-hand Turn 1 hairpin (+4.8m), iconic curved Observation Tower, desert dusk
 *
 * 5 Dynamic Battle Maneuvers driven by card matchup, stat, margin, ERS & DNF:
 *   - divebomb     : Late-braking lunge down the inside with cherry-red carbon brakes & lock-up smoke
 *   - slipstream   : DRS/ERS tow & slingshot blitz past rival at 335+ KPH with cyan energy trail & sparks
 *   - switchback   : Over-under cutback when rival overshoots the apex!
 *   - dnf          : Reliability/mechanical drama — thick dark smoke + embers from rival power unit!
 *   - photo_finish : Wheel-to-wheel dead heat across the checkered line!
 *
 * Auto-Director Broadcast Camera System + 5 Manual Cameras (auto, tv, chase, heli, apex, onboard).
 */
(function (global) {
  "use strict";

  const STEALTH_PALETTE = {
    main: "#141821",
    secondary: "#242b38",
    accent: "#64748b",
    pop: "#38bdf8",
    detail: "#090c12",
  };

  const TYRE_RING_COLORS = {
    soft: 0xef4444,
    medium: 0xfacc15,
    hard: 0xf8fafc,
    inter: 0x22c55e,
    wet: 0x38bdf8,
  };

  const SCENE_PRESETS = {
    monza: {
      id: "monza",
      label: "Monza",
      shortLabel: "Monza",
      badge: "TEMPLE OF SPEED",
      subtitle: "Autodromo Sunset · Parabolica",
      skyTop: "#0b193d",
      skyMid: "#1e3f73",
      skyHoriz: "#eb8b4c",
      sunColor: "#ffe4b5",
      sunPos: [0.74, 0.72],
      fogColor: 0x262638,
      fogDensity: 0.0056,
      groundColor: 0x16291c,
      roadColor: 0x242933,
      roadRough: 0.72,
      kerbA: "#dc2626",
      kerbB: "#f8fafc",
      keyColor: 0xffd7ab,
      keyInt: 2.85,
      keyPos: [28, 20, 22],
      ambSky: 0x93c5fd,
      ambGnd: 0x2a1f18,
      ambInt: 0.96,
      rimColor: 0xf97316,
      rimInt: 1.35,
      rain: false,
      spray: false,
      nightLights: false,
      points: [
        [0, 0, -58], [0, 0, -30], [0, 0, -6], [0.5, 0, 14],
        [5.0, 0, 29], [16.5, 0, 38], [32.5, 0, 37.5], [51.0, 0, 31.0], [72.0, 0, 20.0],
      ],
      apexU: 0.59,
      turnDir: 1,
    },
    monaco: {
      id: "monaco",
      label: "Monaco",
      shortLabel: "Monaco",
      badge: "MONTE CARLO HARBOUR",
      subtitle: "Riviera Street Chicane & Marina",
      skyTop: "#0b3b75",
      skyMid: "#2980c4",
      skyHoriz: "#a9dcf7",
      sunColor: "#fff9dc",
      sunPos: [0.3, 0.68],
      fogColor: 0x5c96bd,
      fogDensity: 0.0044,
      groundColor: 0x323844,
      roadColor: 0x2a2f38,
      roadRough: 0.62,
      kerbA: "#dc2626",
      kerbB: "#f8fafc",
      keyColor: 0xfff8e7,
      keyInt: 2.95,
      keyPos: [22, 30, 18],
      ambSky: 0xdbeafe,
      ambGnd: 0x334155,
      ambInt: 1.12,
      rimColor: 0x38bdf8,
      rimInt: 1.2,
      rain: false,
      spray: false,
      nightLights: false,
      points: [
        [0, 0, -54], [0, 0, -28], [0, 0, -6], [-1.4, 0, 12],
        [3.0, 0, 24.5], [12.5, 0, 31.5], [24.5, 0, 31.8], [39.5, 0, 27.0], [58.0, 0, 19.0],
      ],
      apexU: 0.56,
      turnDir: 1,
    },
    singapore: {
      id: "singapore",
      label: "Marina Bay",
      shortLabel: "Night GP",
      badge: "FLOODLIT NIGHT GP",
      subtitle: "Marina Bay Neon Street & Flyer",
      skyTop: "#03050c",
      skyMid: "#091029",
      skyHoriz: "#1f1c4d",
      sunColor: null,
      fogColor: 0x090d1f,
      fogDensity: 0.0068,
      groundColor: 0x0a0d16,
      roadColor: 0x161b28,
      roadRough: 0.30,
      kerbA: "#e11d48",
      kerbB: "#f8fafc",
      keyColor: 0xfff3d1,
      keyInt: 2.7,
      keyPos: [14, 26, 12],
      ambSky: 0x818cf8,
      ambGnd: 0x0f172a,
      ambInt: 0.78,
      rimColor: 0x22d3ee,
      rimInt: 1.75,
      rain: false,
      spray: false,
      nightLights: true,
      points: [
        [0, 0, -54], [0, 0, -28], [0, 0, -4], [0.2, 0, 15],
        [3.8, 0, 27.5], [14.0, 0, 35.0], [28.5, 0, 36.0], [47.0, 0, 36.0], [68.0, 0, 36.0],
      ],
      apexU: 0.57,
      turnDir: 1,
    },
    spa: {
      id: "spa",
      label: "Spa Storm",
      shortLabel: "Spa Wet",
      badge: "EAU ROUGE · STORM",
      subtitle: "Ardennes Elevation & Heavy Spray",
      skyTop: "#0c1420",
      skyMid: "#1e2e40",
      skyHoriz: "#445870",
      sunColor: null,
      fogColor: 0x1b2a3b,
      fogDensity: 0.0085,
      groundColor: 0x0e1d14,
      roadColor: 0x111824,
      roadRough: 0.14,
      kerbA: "#dc2626",
      kerbB: "#facc15",
      keyColor: 0xd0e8ff,
      keyInt: 2.15,
      keyPos: [16, 24, 14],
      ambSky: 0x94a3b8,
      ambGnd: 0x0f172a,
      ambInt: 0.9,
      rimColor: 0x38bdf8,
      rimInt: 1.55,
      rain: true,
      spray: true,
      nightLights: false,
      points: [
        [0, 1.5, -56], [0, 0.2, -28], [0, -0.9, -6], [-1.2, -1.2, 10],
        [3.6, 0.8, 24.5], [13.0, 3.9, 34.5], [25.0, 5.7, 40.5], [42.0, 6.0, 42.0], [62.0, 6.0, 41.0],
      ],
      apexU: 0.58,
      turnDir: 1,
    },
    cota: {
      id: "cota",
      label: "Austin Climb",
      shortLabel: "Austin",
      badge: "TWILIGHT TURN 1",
      subtitle: "Uphill Hairpin & Observation Tower",
      skyTop: "#130b2e",
      skyMid: "#4d1d5c",
      skyHoriz: "#f97316",
      sunColor: "#fbbf24",
      sunPos: [0.26, 0.74],
      fogColor: 0x2d1838,
      fogDensity: 0.0056,
      groundColor: 0x251d18,
      roadColor: 0x222631,
      roadRough: 0.64,
      kerbA: "#dc2626",
      kerbB: "#f8fafc",
      keyColor: 0xffb673,
      keyInt: 2.8,
      keyPos: [-24, 18, 28],
      ambSky: 0xc084fc,
      ambGnd: 0x2d1810,
      ambInt: 0.9,
      rimColor: 0x38bdf8,
      rimInt: 1.4,
      rain: false,
      spray: false,
      nightLights: true,
      points: [
        [0, 0, -56], [0, 0.3, -28], [0, 1.3, -6], [0.4, 2.9, 13],
        [-3.0, 4.5, 27.5], [-13.5, 4.9, 35.5], [-27.5, 3.6, 33.8], [-44.5, 1.7, 25.0], [-62.0, 0.3, 13.5],
      ],
      apexU: 0.57,
      turnDir: -1,
    },
  };

  const TRACK_TO_SCENE = {
    monza: "monza",
    silverstone: "monza",
    spielberg: "monza",
    monaco: "monaco",
    baku: "monaco",
    singapore: "singapore",
    abudhabi: "singapore",
    spa: "spa",
    interlagos: "spa",
    austin: "cota",
    montreal: "cota",
    suzuka: "cota",
  };

  const WEATHER_OVERRIDES = {
    WET:   { rain: true, spray: true, roadRough: 0.15, fogBoost: 1.32 },
    CHAOS: { rain: false, spray: false, roadRough: 0.44, fogBoost: 1.1 },
    NIGHT: { rain: false, spray: false, roadRough: 0.32, fogBoost: 1.0 },
    DRY:   { rain: false, spray: false, roadRough: null, fogBoost: 1.0 },
    STREET:{ rain: false, spray: false, roadRough: 0.56, fogBoost: 1.0 },
  };

  function disposeGroup(group) {
    if (!group) return;
    group.traverse((obj) => {
      if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (!m) return;
          if (m.map && m.map.dispose) m.map.dispose();
          if (m.dispose) m.dispose();
        });
      }
    });
  }

  function makeSkyTexture(preset) {
    const cv = document.createElement("canvas");
    cv.width = 512;
    cv.height = 256;
    const ctx = cv.getContext("2d");
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, preset.skyTop);
    grad.addColorStop(0.45, preset.skyMid);
    grad.addColorStop(0.68, preset.skyHoriz);
    grad.addColorStop(1.0, preset.skyTop);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);

    if (preset.nightLights) {
      // Subtle starfield on upper hemisphere
      ctx.fillStyle = "rgba(255,255,255,0.65)";
      for (let i = 0; i < 120; i++) {
        const sx = (i * 197 + 31) % 512;
        const sy = (i * 89 + 13) % 105;
        const r = (i % 5 === 0) ? 1.4 : 0.8;
        ctx.fillRect(sx, sy, r, r);
      }
    }

    if (preset.sunColor && preset.sunPos) {
      const cx = preset.sunPos[0] * 512;
      const cy = preset.sunPos[1] * 256;
      const sg = ctx.createRadialGradient(cx, cy, 4, cx, cy, 78);
      sg.addColorStop(0, preset.sunColor);
      sg.addColorStop(0.28, "rgba(255, 200, 120, 0.48)");
      sg.addColorStop(1, "rgba(255, 160, 80, 0)");
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, 512, 256);
    }

    const tex = new window.THREE.CanvasTexture(cv);
    tex.needsUpdate = true;
    return tex;
  }

  function makeAsphaltTexture(isWet) {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 256;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = isWet ? "#18202c" : "#262c36";
    ctx.fillRect(0, 0, 256, 256);
    // Subtle asphalt aggregate grain
    for (let i = 0; i < 1600; i++) {
      const x = (i * 73 + 17) % 256;
      const y = (i * 139 + 41) % 256;
      const v = isWet ? (28 + (i % 24)) : (34 + (i % 26));
      ctx.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
      ctx.fillRect(x, y, 2, 2);
    }
    // Subtle dark rubber grooves along racing lanes
    ctx.fillStyle = "rgba(8, 10, 15, 0.24)";
    ctx.fillRect(46, 0, 32, 256);
    ctx.fillRect(178, 0, 32, 256);
    const tex = new window.THREE.CanvasTexture(cv);
    tex.wrapS = window.THREE.RepeatWrapping;
    tex.wrapT = window.THREE.RepeatWrapping;
    tex.repeat.set(1, 14);
    return tex;
  }

  function makeBrakeBoardTexture(label) {
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 64;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = "#dc2626";
    ctx.fillRect(0, 0, 128, 11);
    ctx.fillRect(0, 53, 128, 11);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 64, 33);
    return new window.THREE.CanvasTexture(cv);
  }

  function makeSponsorTexture(text, bgHex, fgHex, accentHex) {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 64;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = accentHex;
    ctx.fillRect(0, 0, 256, 8);
    ctx.fillRect(0, 56, 256, 8);
    ctx.fillStyle = fgHex;
    ctx.font = "900 28px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 34);
    return new window.THREE.CanvasTexture(cv);
  }

  function makeCrowdTexture() {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 128;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, 256, 128);
    const cols = ["#ef4444", "#facc15", "#38bdf8", "#f8fafc", "#fb923c", "#22c55e", "#e879f9", "#cbd5e1"];
    for (let row = 0; row < 12; row++) {
      ctx.fillStyle = row % 2 === 0 ? "#0f172a" : "#1e293b";
      ctx.fillRect(0, row * 10.6, 256, 10.6);
      for (let col = 0; col < 42; col++) {
        if ((row * 31 + col * 17) % 7 === 0) continue;
        ctx.fillStyle = cols[(row * 13 + col * 7) % cols.length];
        ctx.fillRect(col * 6 + 1, row * 10.6 + 2, 4, 6);
      }
    }
    const tex = new window.THREE.CanvasTexture(cv);
    tex.wrapS = window.THREE.RepeatWrapping;
    tex.wrapT = window.THREE.ClampToEdgeWrapping;
    tex.repeat.set(3, 1);
    return tex;
  }

  function makeBuildingTexture(isNight) {
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 256;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = isNight ? "#0b1020" : "#e2d5c3";
    ctx.fillRect(0, 0, 128, 256);
    for (let r = 0; r < 22; r++) {
      for (let c = 0; c < 8; c++) {
        const seed = (r * 37 + c * 19) % 11;
        if (isNight) {
          if (seed < 4) continue;
          ctx.fillStyle = seed === 10 ? "#38bdf8" : (seed > 7 ? "#fde68a" : "#cbd5e1");
        } else {
          ctx.fillStyle = seed < 3 ? "#3b5875" : "#64748b";
        }
        ctx.fillRect(6 + c * 15, 8 + r * 11, 10, 6);
      }
    }
    const tex = new window.THREE.CanvasTexture(cv);
    tex.wrapS = window.THREE.RepeatWrapping;
    tex.wrapT = window.THREE.RepeatWrapping;
    return tex;
  }

  function makeKerbTexture(colA, colB) {
    const cv = document.createElement("canvas");
    cv.width = 32;
    cv.height = 128;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = colA;
    ctx.fillRect(0, 0, 32, 64);
    ctx.fillStyle = colB;
    ctx.fillRect(0, 64, 32, 64);
    const tex = new window.THREE.CanvasTexture(cv);
    tex.wrapS = window.THREE.RepeatWrapping;
    tex.wrapT = window.THREE.RepeatWrapping;
    tex.repeat.set(1, 3.6);
    return tex;
  }

  function makeCheckeredTexture() {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 32;
    const ctx = cv.getContext("2d");
    for (let gx = 0; gx < 16; gx++) {
      for (let gy = 0; gy < 2; gy++) {
        ctx.fillStyle = (gx + gy) % 2 === 0 ? "#f8fafc" : "#0f172a";
        ctx.fillRect(gx * 16, gy * 16, 16, 16);
      }
    }
    return new window.THREE.CanvasTexture(cv);
  }

  class PlayArena3D {
    constructor(containerEl) {
      this.container = containerEl;
      this.ok = false;
      this.paused = false;
      this.cameraMode = "auto";
      this.sceneId = "monza";
      this.weatherOverride = null;
      this.reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // Track spline progress u in [0..1] and lateral offset (-left / +right)
      this.p1U = 0.21;
      this.p2U = 0.21;
      this.p1Lat = -1.5;
      this.p2Lat = 1.5;
      this.p1Pitch = 0;
      this.p2Pitch = 0;
      this.p1Roll = 0;
      this.p2Roll = 0;
      this.p1Steer = 0;
      this.p2Steer = 0;
      this.p1Speed = 0;
      this.p2Speed = 0;
      this.p1Tyre = "medium";
      this.p2Tyre = "medium";

      this.battleState = null;
      this.ersArmed = false;
      this.rainEnabled = false;
      this.sprayEnabled = false;
      this.brakingIntensity = 0;
      this.p1BrakeGlow = 0;
      this.p2BrakeGlow = 0;
      this.lockupSide = 0;
      this.dnfSide = 0;
      this.sparksBurst = 0;
      this.sparkSide = 0;
      this.fireworksBurst = 0;
      this.clockT = 0;
      this.liveTelemetry = { kph: 0, gear: "N", gap: "0.00s", drs: false, ers: false, maneuver: "" };

      this.p1Car = null;
      this.p2Car = null;
      this.p1Key = "";
      this.p2Key = "";
      this.worldGroup = null;
      this.marshalMats = [];
      this.gantryBannerMat = null;
      this.ferrisWheel = null;
      this.waterMesh = null;
      this.lightningTimer = 4.5;

      if (!window.THREE || !window.F1Car3D || !containerEl) return;
      try {
        this._init();
        this.ok = true;
      } catch (err) {
        console.warn("PlayArena3D WebGL fallback:", err);
        this.ok = false;
      }
    }

    _init() {
      const THREE = window.THREE;
      const w = Math.max(320, this.container.clientWidth || 1280);
      const h = Math.max(240, this.container.clientHeight || 720);

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      this.renderer.setSize(w, h, false);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.22;
      if ("outputColorSpace" in this.renderer && THREE.SRGBColorSpace) {
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      }

      const canvas = this.renderer.domElement;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      this.container.innerHTML = "";
      this.container.appendChild(canvas);

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0e1828);
      this.scene.fog = new THREE.FogExp2(0x132033, 0.006);

      this.envTex = window.F1Car3D.createStudioEnvironment(this.renderer);
      this.scene.environment = this.envTex;

      this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 260);
      this.camLook = new THREE.Vector3(0, 0.7, 0);
      this.targetFov = 42;

      this.ambLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.95);
      this.scene.add(this.ambLight);
      this.keyLight = new THREE.DirectionalLight(0xfff3de, 2.7);
      this.keyLight.position.set(20, 24, 16);
      this.scene.add(this.keyLight);
      this.rimLight = new THREE.DirectionalLight(0x38bdf8, 1.3);
      this.rimLight.position.set(-16, 10, -14);
      this.scene.add(this.rimLight);

      this.worldGroup = new THREE.Group();
      this.scene.add(this.worldGroup);

      // Car pivots + brake glows + ERS underglow + contact shadows
      this.p1Pivot = new THREE.Group();
      this.p2Pivot = new THREE.Group();
      this.scene.add(this.p1Pivot);
      this.scene.add(this.p2Pivot);

      const s1 = window.F1Car3D.createContactShadow();
      const s2 = window.F1Car3D.createContactShadow();
      s1.position.y = 0.018;
      s2.position.y = 0.018;
      this.p1Pivot.add(s1);
      this.p2Pivot.add(s2);

      // Rear FIA rain/harvest glowing red LED bar + glowing carbon front brake discs
      this.p1BrakeMat = new THREE.MeshBasicMaterial({ color: 0xff2800, transparent: true, opacity: 0.0 });
      this.p2BrakeMat = new THREE.MeshBasicMaterial({ color: 0xff2800, transparent: true, opacity: 0.0 });
      this.p1TailMat = new THREE.MeshBasicMaterial({ color: 0xff1e00, transparent: true, opacity: 0.0 });
      this.p2TailMat = new THREE.MeshBasicMaterial({ color: 0xff1e00, transparent: true, opacity: 0.0 });
      [[this.p1Pivot, this.p1BrakeMat, this.p1TailMat], [this.p2Pivot, this.p2BrakeMat, this.p2TailMat]].forEach(([piv, bMat, tMat]) => {
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.08), tMat);
        tail.position.set(0, 0.44, -2.62);
        piv.add(tail);
        [-0.86, 0.86].forEach((bx) => {
          const disc = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), bMat);
          disc.position.set(bx, 0.35, 1.58);
          piv.add(disc);
        });
      });

      // ERS electric underglow ring + speed streaks on P1
      const glowGeo = new THREE.RingGeometry(0.65, 1.65, 28);
      glowGeo.rotateX(-Math.PI / 2);
      this.ersGlowMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.ersGlow = new THREE.Mesh(glowGeo, this.ersGlowMat);
      this.ersGlow.position.set(0, 0.04, 0);
      this.ersGlow.scale.set(1.05, 1.0, 2.45);
      this.p1Pivot.add(this.ersGlow);

      this._buildParticles();
      this._buildSceneWorld("monza");

      this._placeCarOnSpline(this.p1Pivot, this.p1U, this.p1Lat, 0, 0, 0);
      this._placeCarOnSpline(this.p2Pivot, this.p2U, this.p2Lat, 0, 0, 0);
      this._snapCameraInstant();

      this._onResize = () => this.resize();
      window.addEventListener("resize", this._onResize);

      if (typeof ResizeObserver !== "undefined") {
        this._ro = new ResizeObserver(() => this.resize());
        this._ro.observe(this.container);
      }

      this._onVis = () => { this.paused = document.hidden; };
      document.addEventListener("visibilitychange", this._onVis);

      this._lastTs = performance.now();
      this._loop(this._lastTs);
    }

    resize() {
      if (!this.container || !this.renderer || !this.camera) return;
      const cw = Math.max(320, this.container.clientWidth || 1280);
      const ch = Math.max(220, this.container.clientHeight || 640);
      this.camera.aspect = cw / ch;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(cw, ch, false);
    }

    _buildRibbonGeo(curve, halfWLeft, halfWRight, segs, yOff) {
      const THREE = window.THREE;
      const positions = [];
      const uvs = [];
      const indices = [];
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const pt = curve.getPointAt(u);
        const tan = curve.getTangentAt(u).normalize();
        const right = new THREE.Vector3().crossVectors(tan, up).normalize();
        const pL = pt.clone().addScaledVector(right, -halfWLeft);
        const pR = pt.clone().addScaledVector(right, halfWRight);
        positions.push(pL.x, pt.y + yOff, pL.z, pR.x, pt.y + yOff, pR.z);
        uvs.push(0, u * 18, 1, u * 18);
        if (i < segs) {
          const b = i * 2;
          // Upward (+Y) normals since cross(tan, up) points to driver's right (-X when facing +Z)
          indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    }

    _buildSceneWorld(sceneId) {
      const THREE = window.THREE;
      const preset = SCENE_PRESETS[sceneId] || SCENE_PRESETS.monza;
      this.sceneId = preset.id;
      this.activePreset = preset;

      // Cleanly dispose previous scene world
      while (this.worldGroup.children.length > 0) {
        const child = this.worldGroup.children[0];
        this.worldGroup.remove(child);
        disposeGroup(child);
      }
      this.marshalMats = [];
      this.gantryBannerMat = null;
      this.ferrisWheel = null;
      this.waterMesh = null;

      // Curve with real 3D elevation!
      this.curve = new THREE.CatmullRomCurve3(
        preset.points.map(([x, y, z]) => new THREE.Vector3(x, y, z))
      );

      // Atmosphere & Lighting
      this.scene.background = new THREE.Color(preset.fogColor);
      this.scene.fog = new THREE.FogExp2(preset.fogColor, preset.fogDensity);
      this.ambLight.color.setHex(preset.ambSky);
      this.ambLight.groundColor.setHex(preset.ambGnd);
      this.ambLight.intensity = preset.ambInt;
      this.keyLight.color.setHex(preset.keyColor);
      this.keyLight.intensity = preset.keyInt;
      this.keyLight.position.set(preset.keyPos[0], preset.keyPos[1], preset.keyPos[2]);
      this.rimLight.color.setHex(preset.rimColor);
      this.rimLight.intensity = preset.rimInt;

      // Sky Dome
      const skyGeo = new THREE.SphereGeometry(175, 24, 16);
      const skyMat = new THREE.MeshBasicMaterial({ map: makeSkyTexture(preset), side: THREE.BackSide, fog: false });
      const skyDome = new THREE.Mesh(skyGeo, skyMat);
      skyDome.position.set(12 * preset.turnDir, 0, 12);
      this.worldGroup.add(skyDome);

      // Base Ground Plane (sunk below valley floor on undulating elevation scenes like Spa!)
      const groundY = preset.id === "spa" ? -2.4 : -0.22;
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(300, 300),
        new THREE.MeshStandardMaterial({ color: preset.groundColor, roughness: 0.94 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(16 * preset.turnDir, groundY, 12);
      this.worldGroup.add(ground);

      // Track Asphalt Ribbon + Runoff Apron + White Lines + FIA Kerbs (all DoubleSide with +Y normals!)
      const isWet = preset.rain || this.weatherOverride === "WET";
      const asphaltTex = makeAsphaltTexture(isWet);
      this.roadMat = new THREE.MeshStandardMaterial({
        color: preset.roadColor,
        map: asphaltTex,
        roughness: preset.roadRough,
        metalness: isWet ? 0.34 : 0.14,
        side: THREE.DoubleSide,
      });
      const roadMesh = new THREE.Mesh(this._buildRibbonGeo(this.curve, 5.6, 5.6, 150, 0.0), this.roadMat);
      this.worldGroup.add(roadMesh);

      // Wide runoff apron / shoulder ribbon hugging the elevation
      const apronColor = preset.id === "cota" ? 0x1d4ed8 : (preset.id === "monaco" ? 0x3b4252 : 0x1a222d);
      const apronMat = new THREE.MeshStandardMaterial({ color: apronColor, roughness: 0.88, side: THREE.DoubleSide });
      this.worldGroup.add(new THREE.Mesh(this._buildRibbonGeo(this.curve, 9.6, 9.2, 120, -0.05), apronMat));

      // Crisp White Track-Limit Lines
      const whiteMat = new THREE.MeshBasicMaterial({ color: 0xf1f5f9, side: THREE.DoubleSide });
      this.worldGroup.add(new THREE.Mesh(this._buildRibbonGeo(this.curve, 5.25, -4.95, 120, 0.018), whiteMat));
      this.worldGroup.add(new THREE.Mesh(this._buildRibbonGeo(this.curve, -4.95, 5.25, 120, 0.018), whiteMat));

      // FIA Kerbs along both edges (vivid red/white or red/yellow!)
      const kerbMat = new THREE.MeshStandardMaterial({ map: makeKerbTexture(preset.kerbA, preset.kerbB), roughness: 0.48, side: THREE.DoubleSide });
      this.worldGroup.add(new THREE.Mesh(this._buildRibbonGeo(this.curve, 6.55, -5.30, 130, 0.028), kerbMat));
      this.worldGroup.add(new THREE.Mesh(this._buildRibbonGeo(this.curve, -5.30, 6.55, 130, 0.028), kerbMat));

      // Checkered Exit Finish Line at u = 0.81
      const finU = 0.81;
      const finPt = this.curve.getPointAt(finU);
      const finTan = this.curve.getTangentAt(finU).normalize();
      const finishStrip = new THREE.Mesh(
        new THREE.PlaneGeometry(10.8, 1.4),
        new THREE.MeshBasicMaterial({ map: makeCheckeredTexture() })
      );
      finishStrip.rotation.order = "YXZ";
      finishStrip.rotation.y = Math.atan2(finTan.x, finTan.z);
      finishStrip.rotation.x = -Math.PI / 2 - Math.asin(Math.max(-0.4, Math.min(0.4, finTan.y)));
      finishStrip.position.set(finPt.x, finPt.y + 0.025, finPt.z);
      this.worldGroup.add(finishStrip);

      // Starting Grid Boxes at u = 0.21
      const gridMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.72 });
      [-1.5, 1.5].forEach((lat, idx) => {
        const gu = 0.21 + (idx === 0 ? 0.008 : 0.0);
        const gpt = this.curve.getPointAt(gu);
        const gtan = this.curve.getTangentAt(gu).normalize();
        const gright = new THREE.Vector3().crossVectors(gtan, new THREE.Vector3(0, 1, 0)).normalize();
        const box = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.22), gridMat);
        const bpos = gpt.clone().addScaledVector(gright, lat).addScaledVector(gtan, 2.8);
        box.position.set(bpos.x, bpos.y + 0.022, bpos.z);
        box.rotation.x = -Math.PI / 2;
        box.rotation.z = -Math.atan2(gtan.x, gtan.z);
        this.worldGroup.add(box);
      });

      // Barriers, Sponsor Boards, LED Marshal Panels, Start Gantry & Brake Boards
      this._buildTrackFurniture(preset);

      // Iconic Scene-Specific Architecture & Landmarks!
      if (preset.id === "monza") this._buildMonzaScenery();
      else if (preset.id === "monaco") this._buildMonacoScenery();
      else if (preset.id === "singapore") this._buildSingaporeScenery();
      else if (preset.id === "spa") this._buildSpaScenery();
      else if (preset.id === "cota") this._buildCotaScenery();

      // Apply active weather override if any
      this._applyWeatherToScene();
    }

    _buildTrackFurniture(preset) {
      const THREE = window.THREE;
      const up = new THREE.Vector3(0, 1, 0);
      const td = preset.turnDir;

      // Overhead FIA Start Gantry at u = 0.29
      const gPt = this.curve.getPointAt(0.29);
      const gTan = this.curve.getTangentAt(0.29).normalize();
      const gantry = new THREE.Group();
      gantry.position.set(gPt.x, gPt.y, gPt.z);
      gantry.rotation.y = Math.atan2(gTan.x, gTan.z);

      const darkMetal = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.78 });
      [-7.2, 7.2].forEach((px) => {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 4.7, 0.48), darkMetal);
        pillar.position.set(px, 2.35, 0);
        gantry.add(pillar);
      });
      const beam = new THREE.Mesh(new THREE.BoxGeometry(15.0, 0.62, 0.55), darkMetal);
      beam.position.set(0, 4.35, 0);
      gantry.add(beam);

      // Glowing FIA Gantry LED Banner Strip
      this.gantryBannerMat = new THREE.MeshBasicMaterial({ color: 0x16a34a });
      const ledStrip = new THREE.Mesh(new THREE.BoxGeometry(13.6, 0.16, 0.62), this.gantryBannerMat);
      ledStrip.position.set(0, 4.55, 0);
      gantry.add(ledStrip);

      // Sponsor banner facing oncoming cars on top of gantry
      const gSponsorMat = new THREE.MeshBasicMaterial({ map: makeSponsorTexture("TRAF1 GRAND PRIX", "#0f172a", "#f8fafc", "#e10600") });
      const gSign = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.72, 0.12), gSponsorMat);
      gSign.position.set(0, 5.05, 0);
      gantry.add(gSign);

      this.startLights = [];
      for (let i = 0; i < 5; i++) {
        const pod = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.64, 0.30), darkMetal);
        pod.position.set(-1.7 + i * 0.85, 3.68, -0.14);
        gantry.add(pod);
        const bulbMat = new THREE.MeshBasicMaterial({ color: 0x2a0a0a });
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10), bulbMat);
        bulb.position.set(-1.7 + i * 0.85, 3.64, -0.31);
        gantry.add(bulb);
        this.startLights.push(bulbMat);
      }
      this.worldGroup.add(gantry);

      // Exit Finish Arch at u = 0.81
      const fPt = this.curve.getPointAt(0.81);
      const fTan = this.curve.getTangentAt(0.81).normalize();
      const finishArch = new THREE.Group();
      finishArch.position.set(fPt.x, fPt.y, fPt.z);
      finishArch.rotation.y = Math.atan2(fTan.x, fTan.z);
      [-7.2, 7.2].forEach((px) => {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.38, 4.6, 0.42), darkMetal);
        p.position.set(px, 2.3, 0);
        finishArch.add(p);
      });
      const fSign = new THREE.Mesh(
        new THREE.BoxGeometry(14.8, 0.9, 0.36),
        new THREE.MeshBasicMaterial({ map: makeSponsorTexture("FINISH · TRAF1 ARENA", "#111827", "#fde047", "#e10600") })
      );
      fSign.position.set(0, 4.4, 0);
      finishArch.add(fSign);
      this.worldGroup.add(finishArch);

      // FIA 150m / 100m / 50m Braking Distance Boards on the outside of the braking approach!
      const boards = [
        { u: 0.35, lbl: "150" },
        { u: 0.41, lbl: "100" },
        { u: 0.47, lbl: "50" },
      ];
      boards.forEach(({ u, lbl }) => {
        const pt = this.curve.getPointAt(u);
        const tan = this.curve.getTangentAt(u).normalize();
        const right = new THREE.Vector3().crossVectors(tan, up).normalize();
        const pos = pt.clone().addScaledVector(right, -td * 7.2);
        const board = new THREE.Mesh(
          new THREE.BoxGeometry(1.65, 0.92, 0.1),
          new THREE.MeshBasicMaterial({ map: makeBrakeBoardTexture(lbl) })
        );
        board.position.set(pos.x, pt.y + 0.82, pos.z);
        board.rotation.y = Math.atan2(tan.x, tan.z) + Math.PI;
        this.worldGroup.add(board);
      });

      // Tecpro / Armco Barriers + Alternating Sponsor Hoardings + Digital LED Marshal Panels
      const barGeo = new THREE.BoxGeometry(3.2, 1.05, 0.48);
      const isStreet = preset.id === "monaco" || preset.id === "singapore";
      const barA = new THREE.MeshStandardMaterial({ color: isStreet ? 0x94a3b8 : 0xdc2626, roughness: isStreet ? 0.35 : 0.5, metalness: isStreet ? 0.65 : 0.1 });
      const barB = new THREE.MeshStandardMaterial({ color: isStreet ? 0xe2e8f0 : 0xf1f5f9, roughness: 0.45, metalness: isStreet ? 0.4 : 0.1 });

      const sponsorMats = [
        new THREE.MeshBasicMaterial({ map: makeSponsorTexture("PIRELLI", "#facc15", "#0f172a", "#dc2626") }),
        new THREE.MeshBasicMaterial({ map: makeSponsorTexture("TRAF1", "#e10600", "#ffffff", "#0f172a") }),
        new THREE.MeshBasicMaterial({ map: makeSponsorTexture("ARAMCO", "#065f46", "#ffffff", "#34d399") }),
        new THREE.MeshBasicMaterial({ map: makeSponsorTexture("DHL", "#facc15", "#dc2626", "#dc2626") }),
      ];

      const offOuter = isStreet ? 7.4 : 9.2;
      const offInner = isStreet ? 7.2 : 8.6;
      const fencePostGeo = new THREE.BoxGeometry(0.12, 3.2, 0.12);
      const fenceMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6, metalness: 0.5 });

      for (let i = 0; i < 36; i++) {
        const u = 0.05 + (i / 36) * 0.88;
        const pt = this.curve.getPointAt(u);
        const tan = this.curve.getTangentAt(u).normalize();
        const right = new THREE.Vector3().crossVectors(tan, up).normalize();
        const yaw = Math.atan2(tan.x, tan.z);

        // Left & Right barriers
        const matL = (i % 4 === 1) ? sponsorMats[i % sponsorMats.length] : (i % 2 === 0 ? barA : barB);
        const matR = (i % 4 === 3) ? sponsorMats[(i + 2) % sponsorMats.length] : (i % 2 === 0 ? barB : barA);

        const bL = new THREE.Mesh(barGeo, matL);
        const pL = pt.clone().addScaledVector(right, -offOuter);
        bL.position.set(pL.x, pt.y + 0.52, pL.z);
        bL.rotation.y = yaw + Math.PI / 2;
        this.worldGroup.add(bL);

        const bR = new THREE.Mesh(barGeo, matR);
        const pR = pt.clone().addScaledVector(right, offInner);
        bR.position.set(pR.x, pt.y + 0.52, pR.z);
        bR.rotation.y = yaw + Math.PI / 2;
        this.worldGroup.add(bR);

        // Catch-fence posts every 3rd segment
        if (i % 3 === 0) {
          const postL = new THREE.Mesh(fencePostGeo, fenceMat);
          postL.position.set(pL.x, pt.y + 1.6, pL.z);
          this.worldGroup.add(postL);
        }

        // Glowing FIA Digital LED Marshal Light Panels at key apex & braking positions
        if (i === 12 || i === 18 || i === 23 || i === 28) {
          const mMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
          this.marshalMats.push(mMat);
          const panel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.72, 0.14), mMat);
          const mp = pt.clone().addScaledVector(right, -td * (offOuter + 0.4));
          panel.position.set(mp.x, pt.y + 2.15, mp.z);
          panel.rotation.y = yaw + Math.PI;
          this.worldGroup.add(panel);
        }
      }
    }

    _addGrandstand(uStart, uEnd, sideSign, dist, rowsHeight) {
      const THREE = window.THREE;
      const up = new THREE.Vector3(0, 1, 0);
      const uMid = (uStart + uEnd) * 0.5;
      const ptA = this.curve.getPointAt(uStart);
      const ptB = this.curve.getPointAt(uEnd);
      const ptMid = this.curve.getPointAt(uMid);
      const tan = ptB.clone().sub(ptA).normalize();
      const len = ptA.distanceTo(ptB);
      const right = new THREE.Vector3().crossVectors(tan, up).normalize();
      const pos = ptMid.clone().addScaledVector(right, sideSign * dist);

      const g = new THREE.Group();
      g.position.set(pos.x, ptMid.y, pos.z);
      // Note: local +X = left, local -X = right when facing +Z (since cross(+Z, +Y) = -X)
      g.rotation.y = Math.atan2(tan.x, tan.z);
      const xDir = -sideSign; // +1 if placed on -right (+X), -1 if placed on +right (-X)

      const h = rowsHeight || 4.8;
      const d = 6.0;
      const crowdMat = new THREE.MeshStandardMaterial({ map: makeCrowdTexture(), roughness: 0.72, side: THREE.DoubleSide });
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65, metalness: 0.35 });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.35, metalness: 0.35 });
      const accentMat = new THREE.MeshBasicMaterial({ color: 0xe10600 });

      // 4 Stepped open bleacher tiers facing the track!
      for (let tier = 0; tier < 4; tier++) {
        const th = (h / 4) * (tier + 1);
        const step = new THREE.Mesh(new THREE.BoxGeometry(d / 4, th, len), baseMat);
        step.position.set(xDir * ((tier + 0.5) * (d / 4)), th * 0.5, 0);
        g.add(step);
      }

      // Slanted colourful crowd plane cleanly IN FRONT of the tiers facing the track!
      const crowdFace = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.96, Math.hypot(d, h) * 0.92), crowdMat);
      crowdFace.position.set(xDir * (d * 0.46), h * 0.54 + 0.25, 0);
      crowdFace.rotation.order = "YXZ";
      crowdFace.rotation.y = xDir > 0 ? -Math.PI / 2 : Math.PI / 2;
      crowdFace.rotation.x = -Math.atan2(d, h);
      g.add(crowdFace);

      // Front racing red trim wall along trackside edge
      const frontWall = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.0, len), accentMat);
      frontWall.position.set(xDir * -0.1, 0.5, 0);
      g.add(frontWall);

      // Sleek cantilevered canopy roof
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(d + 2.4, 0.26, len + 0.6), roofMat);
      canopy.position.set(xDir * (d * 0.45), h + 1.5, 0);
      canopy.rotation.z = -xDir * 0.14;
      g.add(canopy);

      // Slender roof support columns at back of stand
      const ribGeo = new THREE.BoxGeometry(0.24, h + 1.6, 0.24);
      for (let z = -len * 0.44; z <= len * 0.45; z += Math.max(4.5, len / 4)) {
        const rib = new THREE.Mesh(ribGeo, baseMat);
        rib.position.set(xDir * (d - 0.25), (h + 1.5) * 0.5, z);
        g.add(rib);
      }

      this.worldGroup.add(g);
    }

    _addTreeCluster(positions, isPine) {
      const THREE = window.THREE;
      const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 2.2, 6);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x452d1d, roughness: 0.95 });
      const crownGeo = isPine
        ? new THREE.ConeGeometry(1.75, 5.4, 7)
        : new THREE.ConeGeometry(1.05, 6.2, 7);
      const crownMat1 = new THREE.MeshStandardMaterial({ color: isPine ? 0x163824 : 0x1e4620, roughness: 0.88 });
      const crownMat2 = new THREE.MeshStandardMaterial({ color: isPine ? 0x1d472e : 0x265928, roughness: 0.88 });

      positions.forEach(([x, y, z, scale], i) => {
        const tg = new THREE.Group();
        tg.position.set(x, y, z);
        const s = scale || 1.0;
        tg.scale.set(s, s, s);
        const tr = new THREE.Mesh(trunkGeo, trunkMat);
        tr.position.y = 1.1;
        tg.add(tr);
        const cr = new THREE.Mesh(crownGeo, i % 2 === 0 ? crownMat1 : crownMat2);
        cr.position.y = isPine ? 4.1 : 4.6;
        tg.add(cr);
        this.worldGroup.add(tg);
      });
    }

    _buildMonzaScenery() {
      const THREE = window.THREE;
      // Golden gravel trap outside the Parabolica apex!
      const gravel = new THREE.Mesh(
        new THREE.CircleGeometry(21, 32),
        new THREE.MeshStandardMaterial({ color: 0x8a7554, roughness: 0.98 })
      );
      gravel.rotation.x = -Math.PI / 2;
      gravel.position.set(5.5, -0.06, 46);
      this.worldGroup.add(gravel);

      // Iconic Main Straight & Braking-Zone Grandstands
      this._addGrandstand(0.06, 0.34, -1, 12.2, 5.4);
      this._addGrandstand(0.37, 0.54, -1, 13.5, 4.8);
      this._addGrandstand(0.64, 0.86, 1, 12.5, 4.4);

      // Overhead Pirelli Footbridge spanning the straight at u = 0.44
      const bPt = this.curve.getPointAt(0.44);
      const bTan = this.curve.getTangentAt(0.44).normalize();
      const bridge = new THREE.Group();
      bridge.position.set(bPt.x, bPt.y, bPt.z);
      bridge.rotation.y = Math.atan2(bTan.x, bTan.z);
      const metal = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.65 });
      [-8.5, 8.5].forEach((px) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(1.1, 6.2, 1.8), metal);
        leg.position.set(px, 3.1, 0);
        bridge.add(leg);
      });
      const deck = new THREE.Mesh(
        new THREE.BoxGeometry(18.4, 1.55, 2.0),
        new THREE.MeshBasicMaterial({ map: makeSponsorTexture("AUTODROMO NAZIONALE · MONZA", "#111827", "#facc15", "#dc2626") })
      );
      deck.position.set(0, 5.6, 0);
      bridge.add(deck);
      this.worldGroup.add(bridge);

      // Royal Park Cypress & Pine Trees framing the circuit!
      const trees = [];
      for (let i = 0; i < 34; i++) {
        const u = 0.04 + (i / 34) * 0.92;
        const pt = this.curve.getPointAt(u);
        const tan = this.curve.getTangentAt(u).normalize();
        const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();
        const side = i % 2 === 0 ? 1 : -1;
        const dist = side > 0 ? (15 + (i % 4) * 5.5) : (24 + (i % 3) * 6.0);
        const pos = pt.clone().addScaledVector(right, side * dist);
        trees.push([pos.x, -0.1, pos.z, 0.95 + (i % 4) * 0.26]);
      }
      this._addTreeCluster(trees, false);
    }

    _buildMonacoScenery() {
      const THREE = window.THREE;
      // Shimmering Mediterranean Harbour Water flanking the left & straight-ahead bay!
      const waterMat = new THREE.MeshStandardMaterial({
        color: 0x0a7bbd,
        roughness: 0.14,
        metalness: 0.55,
        emissive: 0x043554,
        emissiveIntensity: 0.4,
      });
      this.waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(180, 140), waterMat);
      this.waterMesh.rotation.x = -Math.PI / 2;
      this.waterMesh.position.set(-18, -0.35, 62);
      this.worldGroup.add(this.waterMesh);

      // Stone Marina Quay Promenade edging the harbour
      const quayMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.72 });
      const quay = new THREE.Mesh(new THREE.BoxGeometry(110, 1.3, 6), quayMat);
      quay.position.set(6, -0.25, 42);
      this.worldGroup.add(quay);

      // 4 Gleaming Luxury Superyachts moored right in the harbour straight ahead!
      const yachtHullMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.2, metalness: 0.2 });
      const yachtGlassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1, metalness: 0.85 });
      const yachtTrimMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      [
        { x: -16, z: 44, ry: 0.35, s: 1.15 },
        { x: 4, z: 54, ry: 1.42, s: 1.35 },
        { x: 26, z: 52, ry: 1.65, s: 1.25 },
        { x: -26, z: 22, ry: 0.10, s: 1.05 },
      ].forEach(({ x, z, ry, s }) => {
        const y = new THREE.Group();
        y.position.set(x, -0.2, z);
        y.rotation.y = ry;
        y.scale.set(s, s, s);
        const hull = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.9, 17.5), yachtHullMat);
        hull.position.y = 0.95;
        y.add(hull);
        const bow = new THREE.Mesh(new THREE.ConeGeometry(2.3, 4.8, 4), yachtHullMat);
        bow.rotation.x = Math.PI / 2;
        bow.rotation.y = Math.PI / 4;
        bow.position.set(0, 1.05, 10.8);
        y.add(bow);
        const deck1 = new THREE.Mesh(new THREE.BoxGeometry(3.8, 1.5, 10.5), yachtHullMat);
        deck1.position.set(0, 2.45, -0.8);
        y.add(deck1);
        const glass = new THREE.Mesh(new THREE.BoxGeometry(3.92, 0.68, 8.4), yachtGlassMat);
        glass.position.set(0, 2.6, -0.4);
        y.add(glass);
        const deck2 = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.05, 6.2), yachtHullMat);
        deck2.position.set(0, 3.65, -1.6);
        y.add(deck2);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.18, 16.8), yachtTrimMat);
        stripe.position.set(0, 1.45, 0);
        y.add(stripe);
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 3.8, 6), yachtHullMat);
        mast.position.set(0, 5.5, -2.2);
        y.add(mast);
        this.worldGroup.add(y);
      });

      // Tiered Monte Carlo Riviera Apartment Buildings rising on the hillside right & far bay!
      const bTex = makeBuildingTexture(false);
      const bColors = [0xf5e6d3, 0xf0d2b6, 0xf7dec8, 0xdbeafe, 0xfef3c7];
      for (let i = 0; i < 16; i++) {
        const bw = 7.5 + (i % 3) * 3.5;
        const bh = 12 + (i % 5) * 4.5;
        const bd = 7.5 + (i % 2) * 3.0;
        const bMat = new THREE.MeshStandardMaterial({ color: bColors[i % bColors.length], map: bTex, roughness: 0.7 });
        const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), bMat);
        const col = i % 8;
        const row = Math.floor(i / 8);
        const x = 16 + col * 8.5 - row * 12;
        const z = -6 + col * 7.2 + row * 48;
        b.position.set(x, bh * 0.5 + row * 4.0, z);
        this.worldGroup.add(b);
      }

      // Riviera Grandstand along Swimming Pool approach (placed cleanly down-track)
      this._addGrandstand(0.32, 0.54, 1, 13.5, 4.4);
    }

    _buildSingaporeScenery() {
      const THREE = window.THREE;
      const up = new THREE.Vector3(0, 1, 0);

      // Towering Overhead Floodlight Trusses lining BOTH sides of the circuit!
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.7 });
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff8dc });
      const neonCyan = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
      const neonPink = new THREE.MeshBasicMaterial({ color: 0xe879f9 });

      for (let i = 0; i < 11; i++) {
        const u = 0.08 + (i / 11) * 0.84;
        const pt = this.curve.getPointAt(u);
        const tan = this.curve.getTangentAt(u).normalize();
        const right = new THREE.Vector3().crossVectors(tan, up).normalize();
        const yaw = Math.atan2(tan.x, tan.z);

        [-1, 1].forEach((side) => {
          const truss = new THREE.Group();
          const p = pt.clone().addScaledVector(right, side * 9.2);
          truss.position.set(p.x, pt.y, p.z);
          truss.rotation.y = yaw;

          const pole = new THREE.Mesh(new THREE.BoxGeometry(0.28, 9.8, 0.28), poleMat);
          pole.position.y = 4.9;
          truss.add(pole);

          const arm = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.22, 0.24), poleMat);
          arm.position.set(side * 2.0, 9.7, 0);
          truss.add(arm);

          const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.30, 0.78), lampMat);
          lamp.position.set(side * 2.6, 9.48, 0);
          truss.add(lamp);

          this.worldGroup.add(truss);
        });

        // Glowing neon LED accent ribbon along both street barriers!
        const nStripL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.20, 4.6), i % 2 === 0 ? neonCyan : neonPink);
        const npL = pt.clone().addScaledVector(right, -7.2);
        nStripL.position.set(npL.x, pt.y + 1.15, npL.z);
        nStripL.rotation.y = yaw;
        this.worldGroup.add(nStripL);

        const nStripR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.20, 4.6), i % 2 === 0 ? neonPink : neonCyan);
        const npR = pt.clone().addScaledVector(right, 7.0);
        nStripR.position.set(npR.x, pt.y + 1.15, npR.z);
        nStripR.rotation.y = yaw;
        this.worldGroup.add(nStripR);
      }

      // Dramatic Marina Bay Illuminated Night Skyline framing the horizon straight ahead!
      const nightTex = makeBuildingTexture(true);
      const bMat = new THREE.MeshStandardMaterial({ map: nightTex, emissive: 0x4f67b0, emissiveMap: nightTex, emissiveIntensity: 0.9, roughness: 0.45 });
      const skylineCoords = [
        [-34, 40, 56], [-20, 48, 66], [-4, 36, 74], [12, 54, 76], [30, 44, 74],
        [48, 50, 70], [64, 38, 62], [76, 44, 42], [80, 34, 18], [-32, 34, 24],
      ];
      skylineCoords.forEach(([x, h, z], i) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(8.5 + (i % 3) * 2.5, h, 8.5 + (i % 2) * 2), bMat);
        b.position.set(x, h * 0.5, z);
        this.worldGroup.add(b);
      });

      // Marina Bay Sands Triple-Tower SkyPark Silhouette RIGHT IN VIEW AHEAD!
      const mbsGroup = new THREE.Group();
      mbsGroup.position.set(22, 0, 56);
      mbsGroup.rotation.y = -0.35;
      [-7.2, 0, 7.2].forEach((tx) => {
        const tower = new THREE.Mesh(new THREE.BoxGeometry(4.4, 34, 5.2), bMat);
        tower.position.set(tx, 17, 0);
        mbsGroup.add(tower);
      });
      const skypark = new THREE.Mesh(
        new THREE.BoxGeometry(26, 2.2, 6.2),
        new THREE.MeshBasicMaterial({ color: 0xfef08a })
      );
      skypark.position.set(0, 35.2, 0);
      mbsGroup.add(skypark);
      this.worldGroup.add(mbsGroup);

      // Iconic Illuminated Rotating Singapore Flyer (Giant Ferris Wheel!) right in the sky ahead-left!
      const flyer = new THREE.Group();
      flyer.position.set(-14, 23, 54);
      flyer.rotation.y = 0.25;
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(17, 0.5, 8, 36),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
      );
      flyer.add(rim);
      const innerRim = new THREE.Mesh(
        new THREE.TorusGeometry(12.5, 0.28, 8, 28),
        new THREE.MeshBasicMaterial({ color: 0xe879f9 })
      );
      flyer.add(innerRim);
      const spokeMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
      for (let s = 0; s < 12; s++) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 34, 0.18), spokeMat);
        sp.rotation.z = (s / 12) * Math.PI;
        flyer.add(sp);
      }
      this.ferrisWheel = flyer;
      this.worldGroup.add(flyer);

      // Marina Bay Grandstand down-track on inside
      this._addGrandstand(0.32, 0.54, 1, 13.5, 4.8);
    }

    _buildSpaScenery() {
      const THREE = window.THREE;
      // Steep Ardennes Forest Hillsides framing the Eau Rouge / Raidillon elevation valley!
      const hillMat = new THREE.MeshStandardMaterial({ color: 0x0f2419, roughness: 0.96 });
      [
        { x: -34, y: 11, z: 18, rx: 28, ry: 22, rz: 48 },
        { x: 46, y: 12, z: 6, rx: 32, ry: 24, rz: 44 },
        { x: 18, y: 14, z: 68, rx: 46, ry: 22, rz: 24 },
      ].forEach(({ x, y, z, rx, ry, rz }) => {
        const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), hillMat);
        mound.scale.set(rx, ry, rz);
        mound.position.set(x, y - ry * 0.55, z);
        this.worldGroup.add(mound);
      });

      // Dense Ardennes Evergreen Pine Forest along both flanks!
      const pines = [];
      for (let i = 0; i < 42; i++) {
        const u = 0.04 + (i / 42) * 0.92;
        const pt = this.curve.getPointAt(u);
        const tan = this.curve.getTangentAt(u).normalize();
        const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();
        const side = i % 2 === 0 ? 1 : -1;
        const dist = 14 + (i % 4) * 5.2;
        const pos = pt.clone().addScaledVector(right, side * dist);
        pines.push([pos.x, pt.y + (i % 3) * 1.1 - 0.4, pos.z, 1.0 + (i % 3) * 0.32]);
      }
      this._addTreeCluster(pines, true);

      // Eau Rouge Grandstand overlooking the compression valley!
      this._addGrandstand(0.12, 0.38, -1, 13.0, 5.2);
    }

    _buildCotaScenery() {
      const THREE = window.THREE;
      // Iconic Curving Red-and-White COTA Observation Tower framed dead-center-left in the twilight sky above Turn 1!
      const tower = new THREE.Group();
      tower.position.set(10, 3.2, 46);
      const poleMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.4 });
      const redSteel = new THREE.MeshStandardMaterial({ color: 0xe10600, roughness: 0.35, metalness: 0.45 });

      const core = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.8, 34, 12), poleMat);
      core.position.y = 17;
      tower.add(core);

      // Sweeping iconic red veil arches curving down the tower
      for (let k = 0; k < 5; k++) {
        const archCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-4 + k * 0.8, 0, -2 + k * 0.4),
          new THREE.Vector3(-1.5 + k * 0.4, 16, -0.6),
          new THREE.Vector3(1.8 + k * 0.2, 31, 0),
          new THREE.Vector3(4.5, 36.5, 0),
        ]);
        const tube = new THREE.Mesh(new THREE.TubeGeometry(archCurve, 20, 0.28, 6, false), redSteel);
        tower.add(tube);
      }

      // Glowing Twilight Observation Deck Disk
      const deck = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 3.6, 1.5, 18), poleMat);
      deck.position.y = 29.5;
      tower.add(deck);
      const deckGlow = new THREE.Mesh(
        new THREE.TorusGeometry(4.5, 0.24, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0xfbbf24 })
      );
      deckGlow.rotation.x = Math.PI / 2;
      deckGlow.position.y = 29.5;
      tower.add(deckGlow);
      this.worldGroup.add(tower);

      // Red/White/Blue painted runoff strips on outside of uphill Turn 1!
      const stripCols = [0xdc2626, 0xf8fafc, 0x2563eb];
      stripCols.forEach((col, idx) => {
        const st = new THREE.Mesh(
          new THREE.PlaneGeometry(24, 4.2),
          new THREE.MeshStandardMaterial({ color: col, roughness: 0.82 })
        );
        st.rotation.x = -Math.PI / 2;
        st.rotation.z = 0.45;
        st.position.set(1.5 + idx * 3.4, 4.1, 41 + idx * 2.2);
        this.worldGroup.add(st);
      });

      // Sweeping Stadium Grandstands on both flanks of the uphill straight!
      this._addGrandstand(0.08, 0.38, 1, 13.0, 5.6);
      this._addGrandstand(0.62, 0.86, -1, 13.5, 4.6);

      // Dusk Floodlight Poles lighting the uphill climb
      const up = new THREE.Vector3(0, 1, 0);
      const fPoleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.65 });
      const fBulbMat = new THREE.MeshBasicMaterial({ color: 0xffedd5 });
      for (let i = 0; i < 6; i++) {
        const u = 0.14 + i * 0.13;
        const pt = this.curve.getPointAt(u);
        const tan = this.curve.getTangentAt(u).normalize();
        const right = new THREE.Vector3().crossVectors(tan, up).normalize();
        const pos = pt.clone().addScaledVector(right, 11.2);
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.28, 11, 0.28), fPoleMat);
        pole.position.set(pos.x, pt.y + 5.5, pos.z);
        this.worldGroup.add(pole);
        const head = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 0.6), fBulbMat);
        head.position.set(pos.x, pt.y + 11.0, pos.z);
        this.worldGroup.add(head);
      }
    }

    _buildParticles() {
      const THREE = window.THREE;

      // 1. 3D Angled Rain Streaks
      const rainCount = 340;
      const rainPos = new Float32Array(rainCount * 3);
      for (let i = 0; i < rainCount; i++) {
        rainPos[i * 3] = (Math.random() - 0.5) * 90;
        rainPos[i * 3 + 1] = Math.random() * 14;
        rainPos[i * 3 + 2] = (Math.random() - 0.4) * 100;
      }
      const rainGeo = new THREE.BufferGeometry();
      rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
      this.rainPoints = new THREE.Points(
        rainGeo,
        new THREE.PointsMaterial({ color: 0xbae6fd, size: 0.12, transparent: true, opacity: 0.68 })
      );
      this.rainPoints.visible = false;
      this.scene.add(this.rainPoints);

      // 2. Directional Titanium Skid Sparks + ERS Cyan Trail
      const sparkCount = 140;
      const sparkPos = new Float32Array(sparkCount * 3);
      this.sparkVel = [];
      for (let i = 0; i < sparkCount; i++) {
        sparkPos[i * 3 + 1] = -30;
        this.sparkVel.push({ vx: 0, vy: 0, vz: 0, life: 0 });
      }
      const sparkGeo = new THREE.BufferGeometry();
      sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
      this.sparkMat = new THREE.PointsMaterial({
        color: 0xfde047,
        size: 0.18,
        transparent: true,
        opacity: 0.94,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.sparks = new THREE.Points(sparkGeo, this.sparkMat);
      this.scene.add(this.sparks);

      // 3. White Tyre Lock-Up Smoke + Dark Engine DNF Smoke
      const smokeCount = 75;
      const smokePos = new Float32Array(smokeCount * 3);
      this.smokeVel = [];
      for (let i = 0; i < smokeCount; i++) {
        smokePos[i * 3 + 1] = -30;
        this.smokeVel.push({ vx: 0, vy: 0, vz: 0, life: 0 });
      }
      const smokeGeo = new THREE.BufferGeometry();
      smokeGeo.setAttribute("position", new THREE.BufferAttribute(smokePos, 3));
      this.smokeMat = new THREE.PointsMaterial({
        color: 0xe2e8f0,
        size: 0.55,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      });
      this.smoke = new THREE.Points(smokeGeo, this.smokeMat);
      this.scene.add(this.smoke);

      // 4. Wet Rooster-Tail Water Spray Plumes behind both cars
      const sprayCount = 120;
      const sprayPos = new Float32Array(sprayCount * 3);
      this.sprayVel = [];
      for (let i = 0; i < sprayCount; i++) {
        sprayPos[i * 3 + 1] = -30;
        this.sprayVel.push({ vx: 0, vy: 0, vz: 0, life: 0 });
      }
      const sprayGeo = new THREE.BufferGeometry();
      sprayGeo.setAttribute("position", new THREE.BufferAttribute(sprayPos, 3));
      this.sprayPoints = new THREE.Points(
        sprayGeo,
        new THREE.PointsMaterial({ color: 0xdbeafe, size: 0.48, transparent: true, opacity: 0.42, depthWrite: false })
      );
      this.scene.add(this.sprayPoints);

      // 5. Finish-Line Victory Fireworks / Confetti Sparks
      const fwCount = 90;
      const fwPos = new Float32Array(fwCount * 3);
      this.fwVel = [];
      for (let i = 0; i < fwCount; i++) {
        fwPos[i * 3 + 1] = -30;
        this.fwVel.push({ vx: 0, vy: 0, vz: 0, life: 0 });
      }
      const fwGeo = new THREE.BufferGeometry();
      fwGeo.setAttribute("position", new THREE.BufferAttribute(fwPos, 3));
      this.fwMat = new THREE.PointsMaterial({
        color: 0xfacc15,
        size: 0.28,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.fireworks = new THREE.Points(fwGeo, this.fwMat);
      this.scene.add(this.fireworks);
    }

    _placeCarOnSpline(pivot, u, lat, pitch, roll, kerbBounce) {
      const THREE = window.THREE;
      const uc = Math.max(0.01, Math.min(0.985, u));
      const pt = this.curve.getPointAt(uc);
      const tan = this.curve.getTangentAt(uc).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(tan, up).normalize();
      const pos = pt.clone().addScaledVector(right, lat);
      const slopePitch = -Math.asin(Math.max(-0.55, Math.min(0.55, tan.y)));
      pivot.position.set(pos.x, pt.y + 0.012 + (kerbBounce || 0), pos.z);
      pivot.rotation.set(slopePitch + (pitch || 0), Math.atan2(tan.x, tan.z), roll || 0, "YXZ");
    }

    _snapCameraInstant() {
      const THREE = window.THREE;
      const midU = Math.max(0.04, Math.min(0.92, (this.p1U + this.p2U) * 0.5));
      const pt = this.curve.getPointAt(midU);
      const tan = this.curve.getTangentAt(midU).normalize();
      const right = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();
      const td = this.activePreset ? this.activePreset.turnDir : 1;
      // Dramatic hero grid view framing BOTH full cars cleanly above bottom dock + gantry, corner & landmarks ahead!
      const camPos = pt.clone().addScaledVector(tan, -10.8).addScaledVector(right, -td * 1.8);
      camPos.y = pt.y + 3.25;
      this.camera.position.copy(camPos);
      this.camLook.copy(pt).addScaledVector(tan, 10.5);
      this.camLook.y = pt.y + 1.35;
      this.camera.lookAt(this.camLook);
    }

    _applyWeatherToScene() {
      if (!this.ok || !this.activePreset) return;
      const preset = this.activePreset;
      const ov = this.weatherOverride ? WEATHER_OVERRIDES[this.weatherOverride] : null;
      const rain = preset.rain || !!(ov && ov.rain);
      const spray = preset.spray || rain;
      this.rainEnabled = rain;
      this.sprayEnabled = spray;
      if (this.rainPoints) this.rainPoints.visible = rain;
      if (this.roadMat) {
        this.roadMat.roughness = (ov && ov.roadRough != null) ? Math.min(preset.roadRough, ov.roadRough) : preset.roadRough;
      }
      if (this.scene.fog) {
        this.scene.fog.density = preset.fogDensity * (ov ? ov.fogBoost : 1.0);
      }
    }

    setPaused(flag) { this.paused = !!flag; }
    setCamera(mode) { this.cameraMode = mode || "auto"; }

    setScene(sceneId, snapCam) {
      if (!this.ok || !SCENE_PRESETS[sceneId]) return;
      if (sceneId === this.sceneId) return;
      this._buildSceneWorld(sceneId);
      this._placeCarOnSpline(this.p1Pivot, this.p1U, this.p1Lat, this.p1Pitch, this.p1Roll, 0);
      this._placeCarOnSpline(this.p2Pivot, this.p2U, this.p2Lat, this.p2Pitch, this.p2Roll, 0);
      if (snapCam !== false) this._snapCameraInstant();
    }

    setSceneForTrack(trackId, weatherKey) {
      this.weatherOverride = weatherKey || null;
      const mapped = TRACK_TO_SCENE[trackId] || (weatherKey === "WET" ? "spa" : (weatherKey === "NIGHT" ? "singapore" : (weatherKey === "STREET" ? "monaco" : "monza")));
      if (mapped !== this.sceneId) {
        this.setScene(mapped, !this.battleState);
      } else {
        this._applyWeatherToScene();
      }
    }

    setWeather(weatherKey) {
      if (!this.ok) return;
      this.weatherOverride = weatherKey || "DRY";
      this._applyWeatherToScene();
    }

    setTyreCompound(side, compound) {
      if (side === "p1") this.p1Tyre = compound || "medium";
      else this.p2Tyre = compound || "medium";
      this._syncCarTyreRings();
    }

    _syncCarTyreRings() {
      const effectiveP1 = this.rainEnabled ? "wet" : this.p1Tyre;
      const effectiveP2 = this.rainEnabled ? "wet" : this.p2Tyre;
      if (this.p1Car && this.p1Car.userData.materials && this.p1Car.userData.materials.tyreRing) {
        const col = TYRE_RING_COLORS[effectiveP1] || TYRE_RING_COLORS.medium;
        this.p1Car.userData.materials.tyreRing.color.setHex(col);
      }
      if (this.p2Car && this.p2Car.userData.materials && this.p2Car.userData.materials.tyreRing) {
        const col = TYRE_RING_COLORS[effectiveP2] || TYRE_RING_COLORS.medium;
        this.p2Car.userData.materials.tyreRing.color.setHex(col);
      }
    }

    setErsArmed(flag) {
      this.ersArmed = !!flag;
      if (this.ok && flag) {
        this.sparkMat.color.setHex(0x38bdf8);
        this.sparksBurst = Math.max(this.sparksBurst, 0.9);
        this.sparkSide = -1;
      }
    }

    setCars(p1Card, p2Card, hideP2) {
      if (!this.ok) return;
      const p1Pal = (p1Card && p1Card.hero_palette) || STEALTH_PALETTE;
      const p1Style = (p1Card && p1Card.hero_livery_style) || "modern";
      const p1Era = (p1Card && p1Card.hero_era) || "2020s";
      const k1 = `${p1Card ? p1Card.hero_team : "none"}:${p1Style}:${p1Era}`;
      if (k1 !== this.p1Key) {
        if (this.p1Car) { this.p1Pivot.remove(this.p1Car); disposeGroup(this.p1Car); }
        this.p1Car = window.F1Car3D.createCar(p1Pal, p1Style, p1Era);
        this.p1Pivot.add(this.p1Car);
        this.p1Key = k1;
      }

      const p2Pal = hideP2 ? STEALTH_PALETTE : ((p2Card && p2Card.hero_palette) || STEALTH_PALETTE);
      const p2Style = hideP2 ? "modern" : ((p2Card && p2Card.hero_livery_style) || "modern");
      const p2Era = hideP2 ? p1Era : ((p2Card && p2Card.hero_era) || "2020s");
      const k2 = hideP2 ? `STEALTH:${p2Era}` : `${p2Card ? p2Card.hero_team : "none"}:${p2Style}:${p2Era}`;
      if (k2 !== this.p2Key) {
        if (this.p2Car) { this.p2Pivot.remove(this.p2Car); disposeGroup(this.p2Car); }
        this.p2Car = window.F1Car3D.createCar(p2Pal, p2Style, p2Era);
        this.p2Pivot.add(this.p2Car);
        this.p2Key = k2;
      }
      this._syncCarTyreRings();
    }

    _setMarshalColor(hex) {
      this.marshalMats.forEach((m) => m.color.setHex(hex));
      if (this.gantryBannerMat) this.gantryBannerMat.color.setHex(hex);
    }

    triggerStartLights() {
      if (!this.ok) return;
      this.battleState = null;
      this.p1U = 0.21;
      this.p2U = 0.21;
      this.p1Lat = -1.5;
      this.p2Lat = 1.5;
      this.p1Speed = 0;
      this.p2Speed = 0;
      this.p1BrakeGlow = 0;
      this.p2BrakeGlow = 0;
      this.lockupSide = 0;
      this.dnfSide = 0;
      this._setMarshalColor(0x22c55e);

      if (!this.startLights) return;
      this.startLights.forEach((m) => m.color.setHex(0x2a0a0a));
      for (let i = 0; i < 5; i++) {
        setTimeout(() => {
          if (this.startLights && this.startLights[i]) this.startLights[i].color.setHex(0xff1e00);
        }, 95 * (i + 1));
      }
      setTimeout(() => {
        if (this.startLights) {
          this.startLights.forEach((m) => m.color.setHex(0x16a34a));
          setTimeout(() => {
            if (this.startLights) this.startLights.forEach((m) => m.color.setHex(0x2a0a0a));
          }, 450);
        }
      }, 610);
    }

    getTelemetry() {
      return this.liveTelemetry;
    }

    _pickManeuver(winnerSide, meta) {
      if (winnerSide === "tie") return "photo_finish";
      const stat = (meta && meta.statKey) || "pace";
      const margin = (meta && typeof meta.margin === "number") ? meta.margin : 6;
      const ers = !!(meta && meta.ersArmed);
      const isDnf = !!(meta && meta.isDnfLoss);
      if (isDnf || (stat === "reliability" && margin >= 6)) return "dnf";
      if (ers || stat === "pace") return "slipstream";
      if (stat === "racecraft" || stat === "duels") return margin <= 9 ? "switchback" : "divebomb";
      return "divebomb";
    }

    /**
     * Choreographed 3.65-second Multi-Maneuver 3D F1 Battle!
     *  0.00 - 0.62s : Grid launch & 5 red start lights
     *  0.62 - 1.55s : High-speed straight blast (slipstream/ERS tow + rival livery reveal!)
     *  1.55 - 2.48s : 150m -> 50m Heavy Braking Zone (maneuver-specific divebomb / switchback / DNF smoke!)
     *  2.48 - 3.65s : Apex kerb attack, exit surge & checkered flag fireworks!
     */
    runBattleSequence(p1Card, p2Card, winnerSide, isDnfLoss, onReveal, onFinish, onPhase, meta) {
      const maneuver = this._pickManeuver(winnerSide, {
        statKey: meta && meta.statKey,
        margin: meta && meta.margin,
        ersArmed: (meta && meta.ersArmed) || this.ersArmed,
        isDnfLoss: !!isDnfLoss,
      });

      if (!this.ok || this.reducedMotion) {
        if (this.ok) {
          this.setCars(p1Card, p2Card, false);
          const td = this.activePreset ? this.activePreset.turnDir : 1;
          this.p1U = winnerSide === "p1" ? 0.84 : 0.74;
          this.p2U = winnerSide === "p2" ? 0.84 : 0.74;
          this.p1Lat = winnerSide === "p1" ? td * 1.4 : -td * 2.4;
          this.p2Lat = winnerSide === "p2" ? td * 1.4 : -td * 2.4;
          this._placeCarOnSpline(this.p1Pivot, this.p1U, this.p1Lat, 0, 0, 0);
          this._placeCarOnSpline(this.p2Pivot, this.p2U, this.p2Lat, 0, 0, 0);
        }
        if (onReveal) onReveal(maneuver);
        if (onFinish) onFinish(maneuver);
        return maneuver;
      }

      this.triggerStartLights();
      this.battleState = {
        startTs: performance.now(),
        elapsed: 0,
        duration: 3.65,
        winner: winnerSide,
        maneuver,
        isDnfLoss: !!isDnfLoss,
        ersActive: (meta && meta.ersArmed) || this.ersArmed,
        p1Card,
        p2Card,
        revealed: false,
        brakingAnnounced: false,
        apexAnnounced: false,
        finished: false,
        onReveal,
        onFinish,
        onPhase,
      };

      const ref = this.battleState;
      setTimeout(() => {
        if (this.battleState === ref && !ref.finished) {
          if (!ref.revealed) {
            ref.revealed = true;
            this.setCars(ref.p1Card, ref.p2Card, false);
            if (ref.onReveal) ref.onReveal(ref.maneuver);
          }
          ref.elapsed = ref.duration;
          this._updateBattle(0.016);
        }
      }, 3950);
      return maneuver;
    }

    _updateBattle(dt) {
      const b = this.battleState;
      if (!b) return;
      b.elapsed = Math.max(b.elapsed, (performance.now() - b.startTs) / 1000);
      const t = b.elapsed;
      const p1Wins = b.winner === "p1";
      const p2Wins = b.winner === "p2";
      const td = this.activePreset ? this.activePreset.turnDir : 1;
      const mv = b.maneuver;
      const lerpRate = Math.min(1, dt * 6.8);

      if (t < 0.60) {
        // Phase 1: Revving on grid under 5 red start lights
        this.p1U = 0.21;
        this.p2U = 0.21;
        this.p1Lat = -1.5;
        this.p2Lat = 1.5;
        this.p1Speed = 0;
        this.p2Speed = 0;
        this.p1Pitch = 0;
        this.p2Pitch = 0;
        this.p1Roll = 0;
        this.p2Roll = 0;
        this.p1Steer = 0;
        this.p2Steer = 0;
        this.p1BrakeGlow = 0;
        this.p2BrakeGlow = 0;
        this.lockupSide = 0;
        this.dnfSide = 0;
        this.targetFov = 39;
        this.liveTelemetry = { kph: 0, gear: "1", gap: "0.00s", drs: false, ers: b.ersActive, maneuver: mv };
      } else if (t < 1.55) {
        // Phase 2: Full-throttle launch & Slipstream / DRS blast down the straight!
        if (!b.revealed) {
          b.revealed = true;
          this.setCars(b.p1Card, b.p2Card, false);
          this.sparkMat.color.setHex(b.ersActive ? 0x38bdf8 : 0xfde047);
          this.sparkSide = b.ersActive ? -1 : 0;
          this.sparksBurst = 1.2;
          this._setMarshalColor(0x22c55e);
          if (b.onReveal) b.onReveal(mv);
        }
        const k = (t - 0.60) / 0.95;
        const ease = k * k * (3 - 2 * k);

        let wU, lU, wLat, lLat;
        if (mv === "slipstream") {
          // Winner tucks directly behind rival in slipstream, then slingshots out at 340 KPH!
          lU = 0.21 + ease * 0.245;
          wU = 0.21 + ease * (0.215 + Math.pow(k, 2.2) * 0.055);
          lLat = td * 0.85;
          wLat = k < 0.55 ? td * 0.85 : td * (0.85 - ((k - 0.55) / 0.45) * 3.0);
        } else if (mv === "switchback") {
          // Rival edges slightly ahead to dive inside; winner lines up wider entry!
          lU = 0.21 + ease * 0.252;
          wU = 0.21 + ease * 0.242;
          lLat = td * 1.45;
          wLat = -td * 1.75;
        } else {
          // Classic wheel-to-wheel straight drag into 150m board
          wU = 0.21 + ease * 0.25;
          lU = 0.21 + ease * 0.244;
          wLat = td * 0.4;
          lLat = -td * 1.45;
        }

        if (p1Wins) {
          this.p1U = wU; this.p2U = lU;
          this.p1Lat += (wLat - this.p1Lat) * lerpRate;
          this.p2Lat += (lLat - this.p2Lat) * lerpRate;
        } else if (p2Wins) {
          this.p2U = wU; this.p1U = lU;
          this.p2Lat += (wLat - this.p2Lat) * lerpRate;
          this.p1Lat += (lLat - this.p1Lat) * lerpRate;
        } else {
          this.p1U = wU; this.p2U = wU;
          this.p1Lat += (-1.35 - this.p1Lat) * lerpRate;
          this.p2Lat += (1.35 - this.p2Lat) * lerpRate;
        }

        const kph = Math.round(92 + ease * (b.ersActive || mv === "slipstream" ? 250 : 234));
        this.p1Speed = kph / 3.6;
        this.p2Speed = (kph - (p1Wins ? 6 : -6)) / 3.6;
        this.p1Pitch = -0.022;
        this.p2Pitch = -0.022;
        this.p1Roll = 0;
        this.p2Roll = 0;
        this.p1BrakeGlow = 0;
        this.p2BrakeGlow = 0;
        this.targetFov = 42 + ease * 11; // Speed-warp FOV!
        const gapSec = Math.abs(this.p1U - this.p2U) * 16.0;
        this.liveTelemetry = {
          kph,
          gear: kph > 305 ? "8" : (kph > 265 ? "7" : (kph > 220 ? "6" : (kph > 165 ? "5" : "4"))),
          gap: `${(this.p1U >= this.p2U ? "-" : "+")}${gapSec.toFixed(2)}s`,
          drs: mv === "slipstream" || k > 0.35,
          ers: b.ersActive,
          maneuver: mv,
        };
      } else if (t < 2.48) {
        // Phase 3: HEAVY BRAKING ZONE (150m -> 50m -> Apex Turn-In!)
        if (!b.brakingAnnounced) {
          b.brakingAnnounced = true;
          this._setMarshalColor(0xfacc15); // Yellow braking caution!
          if (mv === "dnf") {
            this.smokeMat.color.setHex(0x475569);
            this.dnfSide = p1Wins ? 1 : -1;
            this.sparkMat.color.setHex(0xf97316);
            this.sparkSide = this.dnfSide;
            this.sparksBurst = 1.4;
          } else {
            this.smokeMat.color.setHex(0xe2e8f0);
            this.lockupSide = p1Wins ? 1 : (p2Wins ? -1 : 0);
          }
          if (b.onPhase) b.onPhase("braking", mv);
        }
        const k = (t - 1.55) / 0.93;
        const ease = 1 - Math.pow(1 - k, 2.1);

        let wU, lU, wLat, lLat;
        if (mv === "switchback") {
          // Loser brakes too late & runs wide past the apex; winner slows cleanly & prepares inside cutback!
          lU = 0.462 + ease * 0.145;
          wU = 0.452 + ease * 0.148;
          lLat = td * (1.45 - ease * 4.5); // overshoots out wide!
          wLat = td * (-1.75 + ease * 4.45); // slices sharply to inside apex!
        } else if (mv === "dnf") {
          // Loser suffers power-unit smoke & drops back under braking!
          wU = 0.46 + ease * 0.16;
          lU = 0.45 + ease * 0.11;
          wLat = td * 2.55;
          lLat = -td * 2.8;
        } else if (mv === "slipstream") {
          // Winner sweeps aggressively around the outside then cuts to apex!
          wU = 0.48 + ease * 0.145;
          lU = 0.455 + ease * 0.132;
          wLat = td * (-2.0 + ease * 4.6);
          lLat = -td * 2.1;
        } else {
          // Divebomb! Winner dives late to inside apex (+td * 2.75), rival forced wide (-td * 2.45)
          wU = 0.46 + ease * 0.155;
          lU = 0.454 + ease * 0.135;
          wLat = td * 2.75;
          lLat = -td * 2.45;
        }

        if (p1Wins) {
          this.p1U = wU; this.p2U = lU;
          this.p1Lat += (wLat - this.p1Lat) * lerpRate;
          this.p2Lat += (lLat - this.p2Lat) * lerpRate;
        } else if (p2Wins) {
          this.p2U = wU; this.p1U = lU;
          this.p2Lat += (wLat - this.p2Lat) * lerpRate;
          this.p1Lat += (lLat - this.p1Lat) * lerpRate;
        } else {
          this.p1U = 0.46 + ease * 0.148;
          this.p2U = 0.46 + ease * 0.148;
          this.p1Lat += (-1.25 - this.p1Lat) * lerpRate;
          this.p2Lat += (1.35 - this.p2Lat) * lerpRate;
        }

        const kph = Math.round(326 - ease * 204);
        this.p1Speed = kph / 3.6;
        this.p2Speed = kph / 3.6;
        this.p1Pitch = 0.046 * (1 - k * 0.35);
        this.p2Pitch = 0.046 * (1 - k * 0.35);
        this.p1Roll = -td * 0.052 * k;
        this.p2Roll = -td * 0.052 * k;
        this.p1Steer = td * 0.24 * k;
        this.p2Steer = td * 0.22 * k;
        this.p1BrakeGlow = 1.0;
        this.p2BrakeGlow = 1.0;
        this.targetFov = 46 - ease * 6;
        const gapSec = Math.abs(this.p1U - this.p2U) * 16.0;
        this.liveTelemetry = {
          kph,
          gear: kph > 240 ? "6" : (kph > 185 ? "5" : (kph > 145 ? "4" : "3")),
          gap: `${(this.p1U >= this.p2U ? "-" : "+")}${gapSec.toFixed(2)}s`,
          drs: false,
          ers: false,
          maneuver: mv,
        };
      } else {
        // Phase 4: TAKING THE APEX, KERB ATTACK & CHECKERED EXIT SURGE!
        if (!b.apexAnnounced) {
          b.apexAnnounced = true;
          this._setMarshalColor(0x22c55e);
          this.sparkMat.color.setHex(p1Wins ? 0xfde047 : (p2Wins ? 0xf97316 : 0x38bdf8));
          this.sparkSide = p1Wins ? -1 : (p2Wins ? 1 : 0);
          this.sparksBurst = 1.5;
          this.fwMat.color.setHex(p1Wins ? 0x22c55e : (p2Wins ? 0xef4444 : 0xfacc15));
          this.fireworksBurst = 1.35;
          if (b.onPhase) b.onPhase("apex", mv);
        }

        const k = Math.min(1, (t - 2.48) / 1.17);
        const ease = 1 - Math.pow(1 - k, 2.0);
        const winEnd = 0.615 + ease * 0.255; // rockets past checkered line u=0.81 -> 0.87!
        const loseEnd = (mv === "dnf" ? 0.56 : 0.59) + ease * (mv === "dnf" ? 0.11 : 0.175);

        if (p1Wins) {
          this.p1U = winEnd; this.p2U = loseEnd;
          this.p1Lat = td * (2.65 - ease * 2.25);
          this.p2Lat = -td * (2.45 + ease * 1.1);
        } else if (p2Wins) {
          this.p2U = winEnd; this.p1U = loseEnd;
          this.p2Lat = td * (2.65 - ease * 2.25);
          this.p1Lat = -td * (2.45 + ease * 1.1);
        } else {
          this.p1U = winEnd - 0.003; this.p2U = winEnd - 0.003;
          this.p1Lat = -1.25; this.p2Lat = 1.25;
        }

        const kph = Math.round(122 + ease * 172);
        this.p1Speed = kph / 3.6;
        this.p2Speed = (mv === "dnf" && p1Wins ? 75 : kph - 12) / 3.6;
        this.p1Pitch = -0.024 * (1 - k * 0.5);
        this.p2Pitch = -0.015 * (1 - k * 0.5);
        this.p1Roll = -td * 0.055 * (1 - k);
        this.p2Roll = -td * 0.035 * (1 - k);
        this.p1Steer = td * 0.18 * (1 - k);
        this.p2Steer = td * 0.14 * (1 - k);
        this.p1BrakeGlow = Math.max(0, 1 - k * 3.5);
        this.p2BrakeGlow = Math.max(0, 1 - k * 3.5);
        this.lockupSide = 0;
        this.dnfSide = (mv === "dnf" && k < 0.85) ? (p1Wins ? 1 : -1) : 0;
        this.targetFov = 41 + ease * 7;

        const gapSec = Math.abs(this.p1U - this.p2U) * 16.0;
        this.liveTelemetry = {
          kph,
          gear: kph > 255 ? "7" : (kph > 210 ? "6" : (kph > 165 ? "5" : "4")),
          gap: `${(this.p1U >= this.p2U ? "-" : "+")}${gapSec.toFixed(2)}s`,
          drs: false,
          ers: b.ersActive && k < 0.5,
          maneuver: mv,
        };

        if (t >= b.duration && !b.finished) {
          b.finished = true;
          this._setMarshalColor(0xf8fafc); // Checkered white flash!
          if (b.onFinish) b.onFinish(mv);
        }
      }
    }

    _spinCarWheels(car, speedMps, steerAngle, dt) {
      if (!car || !car.userData || !car.userData.wheels) return;
      const wheels = car.userData.wheels;
      for (let i = 0; i < wheels.length; i++) {
        const wg = wheels[i];
        const r = wg.userData.radius || 0.36;
        wg.rotation.x += (speedMps * dt) / r;
        if (wg.userData.isFront) {
          wg.rotation.y = steerAngle || 0;
        }
      }
    }

    _loop(ts) {
      requestAnimationFrame((t) => this._loop(t));
      if (this.paused || !this.ok) {
        this._lastTs = ts;
        return;
      }
      const dt = Math.min(0.05, Math.max(0.001, (ts - this._lastTs) / 1000));
      this._lastTs = ts;
      this.clockT += dt;

      if (this.battleState) {
        this._updateBattle(dt);
      } else if (!this.reducedMotion) {
        // Gentle dramatic idle breathing on grid / post-finish cruise
        const idleWave = Math.sin(this.clockT * 1.15) * 0.08;
        this.p1Pitch = 0;
        this.p2Pitch = 0;
        this.p1Roll = 0;
        this.p2Roll = 0;
        this.p1Steer = 0;
        this.p2Steer = 0;
        this.p1Speed = 6.5; // Subtle tyre warming roll visual
        this.p2Speed = 6.5;
        this.p1BrakeGlow = 0;
        this.p2BrakeGlow = 0;
        this.targetFov = 41;
        this._idleOffset = idleWave;
      }

      // Kerb vibration rumble when car clips inside apex kerb!
      const p1Kerb = (this.battleState && Math.abs(this.p1Lat) > 2.35 && this.p1U > 0.50 && this.p1U < 0.72)
        ? Math.sin(this.clockT * 72) * 0.025 : 0;
      const p2Kerb = (this.battleState && Math.abs(this.p2Lat) > 2.35 && this.p2U > 0.50 && this.p2U < 0.72)
        ? Math.sin(this.clockT * 68) * 0.025 : 0;

      this._placeCarOnSpline(this.p1Pivot, this.p1U, this.p1Lat + (!this.battleState ? (this._idleOffset || 0) : 0), this.p1Pitch, this.p1Roll, p1Kerb);
      this._placeCarOnSpline(this.p2Pivot, this.p2U, this.p2Lat - (!this.battleState ? (this._idleOffset || 0) : 0), this.p2Pitch, this.p2Roll, p2Kerb);

      // Spin & steer wheels!
      this._spinCarWheels(this.p1Car, this.p1Speed, this.p1Steer, dt);
      this._spinCarWheels(this.p2Car, this.p2Speed, this.p2Steer, dt);

      // Animate scene landmarks (Singapore Flyer rotation, Monaco water shimmer, Spa subtle lightning)
      if (this.ferrisWheel && !this.reducedMotion) {
        this.ferrisWheel.rotation.z += dt * 0.09;
      }
      if (this.waterMesh && !this.reducedMotion) {
        this.waterMesh.position.y = -0.35 + Math.sin(this.clockT * 1.4) * 0.04;
      }
      if (this.rainEnabled && !this.reducedMotion) {
        this.lightningTimer -= dt;
        if (this.lightningTimer <= 0) {
          this.ambLight.intensity = 2.4;
          this.lightningTimer = 5.5 + Math.random() * 6.5;
        } else {
          const baseAmb = this.activePreset ? this.activePreset.ambInt : 0.9;
          this.ambLight.intensity += (baseAmb - this.ambLight.intensity) * Math.min(1, dt * 8.0);
        }
      }

      // Brake disc glow + flashing FIA wet rain/harvest rear tail light!
      const pulse = 0.75 + Math.sin(this.clockT * 26) * 0.25;
      this.p1BrakeMat.opacity = this.p1BrakeGlow * pulse;
      this.p2BrakeMat.opacity = this.p2BrakeGlow * pulse;
      const rainFlash = this.rainEnabled ? (Math.sin(this.clockT * 18) > 0 ? 0.92 : 0.12) : 0;
      this.p1TailMat.opacity = Math.max(this.p1BrakeGlow * pulse, rainFlash);
      this.p2TailMat.opacity = Math.max(this.p2BrakeGlow * pulse, rainFlash);

      // ERS electric underglow pulse
      const targetGlow = this.ersArmed ? 0.62 + Math.sin(this.clockT * 11.0) * 0.22 : 0.0;
      this.ersGlowMat.opacity += (targetGlow - this.ersGlowMat.opacity) * Math.min(1, dt * 6.5);

      // 1. Rain streaks
      if (this.rainEnabled && !this.reducedMotion) {
        const arr = this.rainPoints.geometry.attributes.position.array;
        for (let i = 0; i < arr.length; i += 3) {
          arr[i + 1] -= 19.0 * dt;
          arr[i] -= 2.2 * dt;
          if (arr[i + 1] < -1) {
            arr[i + 1] = 13.0;
            arr[i] = this.camLook.x + (Math.random() - 0.5) * 60;
            arr[i + 2] = this.camLook.z + (Math.random() - 0.5) * 60;
          }
        }
        this.rainPoints.geometry.attributes.position.needsUpdate = true;
      }

      // 2. Directional Skid Sparks / ERS Trail streaming backward behind cars!
      const THREE = window.THREE;
      const sArr = this.sparks.geometry.attributes.position.array;
      const emitSparks = this.sparksBurst > 0 || this.ersArmed;
      if (this.sparksBurst > 0) this.sparksBurst = Math.max(0, this.sparksBurst - dt);
      for (let i = 0; i < this.sparkVel.length; i++) {
        const sv = this.sparkVel[i];
        if (sv.life > 0) {
          sv.life -= dt;
          sArr[i * 3] += sv.vx * dt;
          sArr[i * 3 + 1] += sv.vy * dt;
          sArr[i * 3 + 2] += sv.vz * dt;
          sv.vy -= 5.4 * dt;
        } else if (emitSparks && Math.random() < 0.48 && !this.reducedMotion) {
          const isP1 = this.sparkSide === -1 || (this.sparkSide === 0 && Math.random() < 0.5);
          const piv = isP1 ? this.p1Pivot : this.p2Pivot;
          const u = isP1 ? this.p1U : this.p2U;
          const tan = this.curve.getTangentAt(Math.max(0.01, Math.min(0.98, u))).normalize();
          sArr[i * 3] = piv.position.x - tan.x * 1.8 + (Math.random() - 0.5) * 0.5;
          sArr[i * 3 + 1] = piv.position.y + 0.14 + Math.random() * 0.14;
          sArr[i * 3 + 2] = piv.position.z - tan.z * 1.8 + (Math.random() - 0.5) * 0.5;
          const spd = 7.5 + Math.random() * 6.5;
          sv.vx = -tan.x * spd + (Math.random() - 0.5) * 2.4;
          sv.vy = 1.0 + Math.random() * 2.0;
          sv.vz = -tan.z * spd + (Math.random() - 0.5) * 2.4;
          sv.life = 0.28 + Math.random() * 0.34;
        } else {
          sArr[i * 3 + 1] = -30;
        }
      }
      this.sparks.geometry.attributes.position.needsUpdate = true;

      // 3. Tyre Lock-Up Smoke OR Engine Failure DNF Smoke
      const smArr = this.smoke.geometry.attributes.position.array;
      const smokeSide = this.dnfSide !== 0 ? this.dnfSide : this.lockupSide;
      for (let i = 0; i < this.smokeVel.length; i++) {
        const sm = this.smokeVel[i];
        if (sm.life > 0) {
          sm.life -= dt;
          smArr[i * 3] += sm.vx * dt;
          smArr[i * 3 + 1] += sm.vy * dt;
          smArr[i * 3 + 2] += sm.vz * dt;
        } else if (smokeSide !== 0 && Math.random() < 0.62 && !this.reducedMotion) {
          const piv = smokeSide === -1 ? this.p1Pivot : this.p2Pivot;
          smArr[i * 3] = piv.position.x + (Math.random() - 0.5) * 0.9;
          smArr[i * 3 + 1] = piv.position.y + (this.dnfSide ? 0.55 : 0.25) + Math.random() * 0.2;
          smArr[i * 3 + 2] = piv.position.z + (Math.random() - 0.5) * 0.9;
          sm.vx = (Math.random() - 0.5) * 2.2;
          sm.vy = (this.dnfSide ? 2.4 : 1.3) + Math.random() * 1.2;
          sm.vz = (Math.random() - 0.5) * 2.2;
          sm.life = 0.45 + Math.random() * 0.55;
        } else {
          smArr[i * 3 + 1] = -30;
        }
      }
      this.smoke.geometry.attributes.position.needsUpdate = true;

      // 4. Wet Rooster-Tail Spray Plumes!
      const spArr = this.sprayPoints.geometry.attributes.position.array;
      const emitSpray = this.sprayEnabled && (this.battleState || this.p1Speed > 3) && !this.reducedMotion;
      for (let i = 0; i < this.sprayVel.length; i++) {
        const sp = this.sprayVel[i];
        if (sp.life > 0) {
          sp.life -= dt;
          spArr[i * 3] += sp.vx * dt;
          spArr[i * 3 + 1] += sp.vy * dt;
          spArr[i * 3 + 2] += sp.vz * dt;
          sp.vy -= 1.8 * dt;
        } else if (emitSpray && Math.random() < 0.58) {
          const isP1 = i % 2 === 0;
          const piv = isP1 ? this.p1Pivot : this.p2Pivot;
          const u = isP1 ? this.p1U : this.p2U;
          const tan = this.curve.getTangentAt(Math.max(0.01, Math.min(0.98, u))).normalize();
          spArr[i * 3] = piv.position.x - tan.x * 2.4 + (Math.random() - 0.5) * 1.2;
          spArr[i * 3 + 1] = piv.position.y + 0.35 + Math.random() * 0.4;
          spArr[i * 3 + 2] = piv.position.z - tan.z * 2.4 + (Math.random() - 0.5) * 1.2;
          sp.vx = -tan.x * 6.0 + (Math.random() - 0.5) * 2.0;
          sp.vy = 1.6 + Math.random() * 1.6;
          sp.vz = -tan.z * 6.0 + (Math.random() - 0.5) * 2.0;
          sp.life = 0.35 + Math.random() * 0.35;
        } else {
          spArr[i * 3 + 1] = -30;
        }
      }
      this.sprayPoints.geometry.attributes.position.needsUpdate = true;

      // 5. Finish-Line Victory Fireworks Burst!
      const fwArr = this.fireworks.geometry.attributes.position.array;
      if (this.fireworksBurst > 0) this.fireworksBurst = Math.max(0, this.fireworksBurst - dt);
      const fPt = this.curve.getPointAt(0.81);
      for (let i = 0; i < this.fwVel.length; i++) {
        const fw = this.fwVel[i];
        if (fw.life > 0) {
          fw.life -= dt;
          fwArr[i * 3] += fw.vx * dt;
          fwArr[i * 3 + 1] += fw.vy * dt;
          fwArr[i * 3 + 2] += fw.vz * dt;
          fw.vy -= 4.2 * dt;
        } else if (this.fireworksBurst > 0 && Math.random() < 0.35 && !this.reducedMotion) {
          const side = Math.random() < 0.5 ? -6.5 : 6.5;
          fwArr[i * 3] = fPt.x + side * 0.6 + (Math.random() - 0.5) * 2;
          fwArr[i * 3 + 1] = fPt.y + 4.5 + Math.random() * 2.5;
          fwArr[i * 3 + 2] = fPt.z + (Math.random() - 0.5) * 4;
          const ang = Math.random() * Math.PI * 2;
          const spd = 2.5 + Math.random() * 4.5;
          fw.vx = Math.cos(ang) * spd;
          fw.vy = 2.5 + Math.random() * 4.0;
          fw.vz = Math.sin(ang) * spd;
          fw.life = 0.7 + Math.random() * 0.5;
        } else {
          fwArr[i * 3 + 1] = -30;
        }
      }
      this.fireworks.geometry.attributes.position.needsUpdate = true;

      // Smooth FOV interpolation (visceral speed warp!)
      if (Math.abs(this.camera.fov - this.targetFov) > 0.05) {
        this.camera.fov += (this.targetFov - this.camera.fov) * Math.min(1, dt * 4.5);
        this.camera.updateProjectionMatrix();
      }

      // Dynamic Multi-Cut Auto-Director & Manual Broadcast Camera System!
      const midU = Math.max(0.05, Math.min(0.92, (this.p1U + this.p2U) * 0.5));
      const midPt = this.curve.getPointAt(midU);
      const midTan = this.curve.getTangentAt(midU).normalize();
      const right = new THREE.Vector3().crossVectors(midTan, new THREE.Vector3(0, 1, 0)).normalize();
      const td = this.activePreset ? this.activePreset.turnDir : 1;

      const desiredPos = new THREE.Vector3();
      const desiredLook = midPt.clone().addScaledVector(midTan, 2.0);
      desiredLook.y = midPt.y + 0.72;

      let camLerp = Math.min(1, dt * 4.4);
      let effectiveMode = this.cameraMode;

      // Auto-Director switches broadcast angles cinematically through the 4 battle phases!
      if (effectiveMode === "auto") {
        if (!this.battleState) {
          if (midU > 0.65) {
            // Post-finish hero celebration view framing BOTH cars cleanly in lower-center below HUD!
            desiredPos.copy(midPt).addScaledVector(midTan, -8.5).addScaledVector(right, -td * 4.5);
            desiredPos.y = midPt.y + 4.2;
            desiredLook.copy(midPt).addScaledVector(midTan, 2.2);
            desiredLook.y = midPt.y + 1.4;
          } else {
            // Hero Grid Broadcast Shot framing BOTH full cars cleanly above bottom dock + 5 red lights gantry & landmarks!
            const sway = Math.sin(this.clockT * 0.38) * 1.3;
            desiredPos.copy(midPt).addScaledVector(midTan, -10.8).addScaledVector(right, -td * 1.7 + sway);
            desiredPos.y = midPt.y + 3.25 + Math.sin(this.clockT * 0.5) * 0.16;
            desiredLook.copy(midPt).addScaledVector(midTan, 10.5);
            desiredLook.y = midPt.y + 1.35;
          }
        } else {
          const bt = this.battleState.elapsed;
          if (bt < 0.65) {
            // Cut 1: Low dramatic rear-3/4 start grid shot showing both cars launching under the 5 red gantry lights!
            desiredPos.copy(midPt).addScaledVector(midTan, -9.2).addScaledVector(right, -td * 1.8);
            desiredPos.y = midPt.y + 2.55;
            desiredLook.copy(midPt).addScaledVector(midTan, 10.5);
            desiredLook.y = midPt.y + 1.75;
          } else if (bt < 1.60) {
            // Cut 2: Fast dynamic tracking boom alongside the straight slipstream battle looking down the track!
            desiredPos.copy(midPt).addScaledVector(midTan, -7.8).addScaledVector(right, -td * 4.8);
            desiredPos.y = midPt.y + 2.55;
            desiredLook.copy(midPt).addScaledVector(midTan, 7.0);
            desiredLook.y = midPt.y + 0.9;
            camLerp = Math.min(1, dt * 5.8);
          } else if (bt < 2.65) {
            // Cut 3: Elevated Apex Broadcast Boom on the outside looking across BOTH cars diving through the apex!
            desiredPos.copy(midPt).addScaledVector(midTan, 7.8).addScaledVector(right, -td * 8.2);
            desiredPos.y = midPt.y + 4.3;
            desiredLook.copy(midPt).addScaledVector(midTan, 0.8);
            desiredLook.y = midPt.y + 0.65;
            camLerp = Math.min(1, dt * 6.5);
          } else {
            // Cut 4: Dramatic sweeping Finish Crane / Heli Cam following winner across the checkered line!
            desiredPos.copy(midPt).addScaledVector(midTan, -8.4).addScaledVector(right, -td * 5.4);
            desiredPos.y = midPt.y + 5.2;
            desiredLook.copy(midPt).addScaledVector(midTan, 3.2);
            desiredLook.y = midPt.y + 1.1;
          }
        }
      } else if (effectiveMode === "chase") {
        desiredPos.copy(midPt).addScaledVector(midTan, -7.8).addScaledVector(right, -td * 0.9);
        desiredPos.y = midPt.y + 2.85;
      } else if (effectiveMode === "heli") {
        desiredPos.copy(midPt).addScaledVector(midTan, -2.5).addScaledVector(right, -td * 4.5);
        desiredPos.y = midPt.y + 13.0;
        desiredLook.copy(midPt).addScaledVector(midTan, 3.5);
      } else if (effectiveMode === "apex") {
        const apexU = this.activePreset ? this.activePreset.apexU : 0.58;
        const apexPt = this.curve.getPointAt(apexU);
        const apexTan = this.curve.getTangentAt(apexU).normalize();
        const apexRight = new THREE.Vector3().crossVectors(apexTan, new THREE.Vector3(0, 1, 0)).normalize();
        desiredPos.copy(apexPt).addScaledVector(apexRight, td * 6.5).addScaledVector(apexTan, 2.8);
        desiredPos.y = apexPt.y + 1.3;
        desiredLook.copy(midPt);
        desiredLook.y = midPt.y + 0.58;
      } else if (effectiveMode === "onboard") {
        // Authentic F1 T-Cam right above Player 1's cockpit halo!
        const p1u = Math.max(0.02, Math.min(0.97, this.p1U));
        const p1Pt = this.curve.getPointAt(p1u);
        const p1Tan = this.curve.getTangentAt(p1u).normalize();
        const p1Right = new THREE.Vector3().crossVectors(p1Tan, new THREE.Vector3(0, 1, 0)).normalize();
        desiredPos.copy(p1Pt).addScaledVector(p1Right, this.p1Lat).addScaledVector(p1Tan, -0.55);
        desiredPos.y = p1Pt.y + 1.32;
        desiredLook.copy(p1Pt).addScaledVector(p1Right, this.p1Lat * 0.45).addScaledVector(p1Tan, 12.0);
        desiredLook.y = p1Pt.y + 0.55;
        camLerp = Math.min(1, dt * 11.0);
      } else {
        // Classic TV Pod Broadcast Camera
        const ahead = this.battleState && this.battleState.elapsed > 1.45 ? 9.8 : 8.5;
        desiredPos.copy(midPt).addScaledVector(midTan, ahead).addScaledVector(right, -td * 5.8);
        desiredPos.y = midPt.y + 3.05;
      }

      this.camera.position.lerp(desiredPos, camLerp);
      this.camLook.lerp(desiredLook, camLerp);
      this.camera.lookAt(this.camLook);

      this.renderer.render(this.scene, this.camera);
    }
  }

  PlayArena3D.SCENES = SCENE_PRESETS;
  PlayArena3D.TRACK_TO_SCENE = TRACK_TO_SCENE;
  global.PlayArena3D = PlayArena3D;
})(window);
