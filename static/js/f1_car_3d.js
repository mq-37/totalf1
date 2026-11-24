/* f1_car_3d.js — Procedural Sculpted 3D Modern Ground-Effect F1 Car (Three.js r158)
   Shared single source of truth for:
   1. Interactive 3D museum plinths (Home, Driver Profile, Team Profile, /dev/car-3d)
   2. Headless studio batch renderer (scripts/render_3d_cars.py) -> Cards, Teams, Liveries & PDFs

   Coordinate system (1 unit = 1 meter):
     +Z = forward (nose at ~+2.78, rear wing at ~-2.66)
     +Y = up (ground plane y = 0, tyre contact at y = 0)
     +X = driver's left (car symmetric across x = 0)
*/
(function (global) {
  'use strict';

  function parseColor(hex, fallback) {
    if (typeof hex === 'string' && /^#?[0-9a-fA-F]{6}$/.test(hex.trim())) {
      return new THREE.Color(hex.trim().startsWith('#') ? hex.trim() : '#' + hex.trim());
    }
    return new THREE.Color(fallback || '#e10600');
  }

  /* Smoothly loft an array of closed cross-section rings into a BufferGeometry.
     Each section is an array of [x, y, z] points of identical length N. */
  function buildLoft(sections, capStart, capEnd) {
    var rings = sections.length;
    var n = sections[0].length;
    var positions = [];
    var indices = [];

    for (var i = 0; i < rings; i++) {
      var ring = sections[i];
      for (var j = 0; j < n; j++) {
        positions.push(ring[j][0], ring[j][1], ring[j][2]);
      }
    }

    for (var i = 0; i < rings - 1; i++) {
      var a0 = i * n;
      var b0 = (i + 1) * n;
      for (var j = 0; j < n; j++) {
        var jn = (j + 1) % n;
        var v00 = a0 + j;
        var v01 = a0 + jn;
        var v10 = b0 + j;
        var v11 = b0 + jn;
        indices.push(v00, v10, v11);
        indices.push(v00, v11, v01);
      }
    }

    if (capStart) {
      var cIdx = positions.length / 3;
      var cx = 0, cy = 0, cz = 0;
      for (var j = 0; j < n; j++) {
        cx += sections[0][j][0];
        cy += sections[0][j][1];
        cz += sections[0][j][2];
      }
      positions.push(cx / n, cy / n, cz / n);
      for (var j = 0; j < n; j++) {
        indices.push(cIdx, (j + 1) % n, j);
      }
    }

    if (capEnd) {
      var last = (rings - 1) * n;
      var eIdx = positions.length / 3;
      var ex = 0, ey = 0, ez = 0;
      for (var j = 0; j < n; j++) {
        ex += sections[rings - 1][j][0];
        ey += sections[rings - 1][j][1];
        ez += sections[rings - 1][j][2];
      }
      positions.push(ex / n, ey / n, ez / n);
      for (var j = 0; j < n; j++) {
        indices.push(eIdx, last + j, last + ((j + 1) % n));
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /* Generate a superellipse ring in XY at z:
     width hw (half-width), top yTop, bottom yBot, center xOffset, power p (2=ellipse, >2=squircle). */
  function superRing(z, xOff, hw, yBot, yTop, pTop, pBot, segs, topFlat) {
    var pts = [];
    var yc = (yTop + yBot) * 0.5;
    var hy = (yTop - yBot) * 0.5;
    for (var i = 0; i < segs; i++) {
      var a = (i / segs) * Math.PI * 2;
      var ca = Math.cos(a);
      var sa = Math.sin(a);
      var p = sa >= 0 ? (pTop || 2.2) : (pBot || 2.6);
      var sx = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / p);
      var sy = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / p);
      var x = xOff + sx * hw;
      var y = yc + sy * hy;
      if (topFlat && sa > 0.35) {
        y = Math.min(y, yTop - topFlat * (1 - Math.abs(sx)));
      }
      pts.push([x, y, z]);
    }
    return pts;
  }

  /* Build a curved wing element spanning -halfSpan..+halfSpan with sweep, arch, and chord taper. */
  function buildWingElement(opts) {
    var span = opts.halfSpan;
    var steps = opts.steps || 28;
    var chordC = opts.chordCenter;
    var chordT = opts.chordTip;
    var thick = opts.thick || 0.028;
    var zC = opts.zCenter;
    var zT = opts.zTip;
    var yC = opts.yCenter;
    var yT = opts.yTip;
    var arch = opts.arch || 0;      /* mid-span dip/rise */
    var pitch = opts.pitch || 0.14; /* angle of attack rad (trailing edge higher) */
    var profileSegs = 12;

    var sections = [];
    for (var i = 0; i <= steps; i++) {
      var u = (i / steps) * 2 - 1;        /* -1 .. +1 along +X */
      var au = Math.abs(u);
      var x = u * span;
      var tSmooth = au * au * (3 - 2 * au);
      var chord = chordC + (chordT - chordC) * tSmooth;
      var zMid = zC + (zT - zC) * tSmooth;
      var yMid = yC + (yT - yC) * tSmooth + Math.sin(au * Math.PI) * arch;
      var cp = Math.cos(pitch);
      var sp = Math.sin(pitch);

      var ring = [];
      for (var j = 0; j < profileSegs; j++) {
        /* Winding chosen so outward normals point away from aerofoil surface along +X sweep */
        var a = -(j / profileSegs) * Math.PI * 2;
        var lz = Math.cos(a) * chord * 0.5;
        var camber = (1 - Math.cos(a) * Math.cos(a)) * thick * 0.40;
        var ly = Math.sin(a) * thick * 0.5 * (0.68 + 0.32 * Math.cos(a * 0.5)) + camber;
        /* Positive pitch tilts leading edge (+lz) down and trailing edge (-lz) up */
        var rz = lz * cp + ly * sp;
        var ry = -lz * sp + ly * cp;
        ring.push([x, yMid + ry, zMid + rz]);
      }
      sections.push(ring);
    }
    return buildLoft(sections, true, true);
  }

  /* Build a flat vertical aero fin/endplate in the YZ plane centered at xPos.
     pts2d is array of [z, y] pairs (world Z and world Y). */
  function buildVerticalPlate(pts2d, xPos, thickness) {
    var sh = new THREE.Shape();
    sh.moveTo(pts2d[0][0], pts2d[0][1]);
    for (var i = 1; i < pts2d.length; i++) {
      sh.lineTo(pts2d[i][0], pts2d[i][1]);
    }
    sh.closePath();
    var geo = new THREE.ExtrudeGeometry(sh, {
      depth: thickness,
      bevelEnabled: true,
      bevelThickness: Math.min(0.004, thickness * 0.25),
      bevelSize: Math.min(0.004, thickness * 0.25),
      bevelSegments: 2
    });
    /* Rotate so shape X (world Z) maps to +Z, shape Y stays +Y, extrusion depth spans X */
    geo.rotateY(-Math.PI / 2);
    /* Wait: rotateY(-PI/2) maps (x, y, z) -> (-z, y, x). So shape X -> +Z, shape Z (0..depth) -> -depth..0 */
    geo.translate(xPos + thickness * 0.5, 0, 0);
    return geo;
  }

  /* Build a strut/wishbone cylinder connecting point A to point B. */
  function buildStrut(a, b, r, mat) {
    var va = new THREE.Vector3(a[0], a[1], a[2]);
    var vb = new THREE.Vector3(b[0], b[1], b[2]);
    var dir = new THREE.Vector3().subVectors(vb, va);
    var len = dir.length();
    var geo = new THREE.CylinderGeometry(r, r, len, 8);
    /* Flatten slightly into aero teardrop wishbone */
    geo.scale(1.0, 1.0, 2.2);
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(va).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return mesh;
  }

  /* Procedural Red Bull yellow sun-disc + charging bull nosecone motif texture */
  function makeBullNoseTexture() {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    var g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    /* Yellow solar disc */
    g.fillStyle = '#FFCC00';
    g.beginPath();
    g.arc(128, 134, 84, 0, Math.PI * 2);
    g.fill();
    /* Two stylized crimson charging bulls facing center */
    g.fillStyle = '#DB0A40';
    [-1, 1].forEach(function (dir) {
      g.save();
      g.translate(128, 136);
      g.scale(dir, 1);
      g.beginPath();
      g.moveTo(6, 4);
      g.quadraticCurveTo(22, -26, 54, -22);
      g.quadraticCurveTo(72, -16, 76, 8);
      g.lineTo(66, 24);
      g.lineTo(54, 14);
      g.lineTo(40, 26);
      g.lineTo(28, 12);
      g.lineTo(10, 18);
      g.closePath();
      g.fill();
      /* Horns */
      g.beginPath();
      g.moveTo(14, -8);
      g.lineTo(2, -28);
      g.lineTo(22, -16);
      g.closePath();
      g.fill();
      g.restore();
    });
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /* Procedural carbon-fiber subtle weave CanvasTexture. */
  function makeCarbonTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 32;
    var g = c.getContext('2d');
    g.fillStyle = '#15171c';
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = '#20242c';
    for (var y = 0; y < 32; y += 8) {
      for (var x = 0; x < 32; x += 8) {
        g.fillRect(x, y, 4, 4);
        g.fillRect(x + 4, y + 4, 4, 4);
      }
    }
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(24, 24);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /* Procedural automotive studio environment map via PMREMGenerator. */
  function createStudioEnvironment(renderer) {
    var pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    var envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x0c0f16);

    function softbox(w, h, color, intensity, pos, rot) {
      var m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })
      );
      m.position.set(pos[0], pos[1], pos[2]);
      m.rotation.set(rot[0], rot[1], rot[2]);
      envScene.add(m);
    }

    /* Overhead longitudinal automotive light strips (create crisp clearcoat streaks) */
    softbox(3.2, 16, 0xffffff, 2.6, [0, 8.5, 0], [Math.PI / 2, 0, 0]);
    softbox(1.4, 14, 0xdbe8ff, 1.8, [5.5, 6.2, 0], [Math.PI / 2, -0.55, 0]);
    softbox(1.4, 14, 0xfff0dc, 1.6, [-5.5, 6.2, 0], [Math.PI / 2, 0.55, 0]);
    /* Front/rear key bounce cards */
    softbox(10, 4, 0xe8eefc, 1.3, [0, 3.2, 9.5], [0, Math.PI, 0]);
    softbox(8, 3.5, 0xb8c8e8, 1.0, [0, 3.5, -9.5], [0, 0, 0]);
    /* Horizon rim strips */
    softbox(14, 1.2, 0xffffff, 1.1, [9.0, 2.2, 0], [0, -Math.PI / 2, 0]);
    softbox(14, 1.2, 0xffffff, 1.1, [-9.0, 2.2, 0], [0, Math.PI / 2, 0]);

    var rt = pmrem.fromScene(envScene, 0.035);
    pmrem.dispose();
    return rt.texture;
  }

  var CAR_ERAS = ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];

  function parseExactYear(eraOrYear) {
    if (eraOrYear == null) return 2026;
    var s = String(eraOrYear).trim().toLowerCase();
    if (/^\d{4}$/.test(s)) return Math.max(1950, Math.min(2030, parseInt(s, 10)));
    var m = s.match(/^(\d{4})s$/);
    if (m) {
      var dec = parseInt(m[1], 10);
      if (dec === 2020) return 2026;
      if (dec === 2010) return 2019;
      if (dec === 2000) return 2004;
      if (dec === 1990) return 1994;
      if (dec === 1980) return 1988;
      if (dec === 1970) return 1978;
      if (dec === 1960) return 1967;
      return 1955;
    }
    return 2026;
  }

  function normalizeEra(era) {
    if (!era) return '2020s';
    var y = parseExactYear(era);
    /* Map each exact season year onto its true technical chassis generation!
       Notice: 2009-2016 belong to the Wide-Front/Tall-Narrow-Rear generation (2010s branch),
       2017-2021 belong to the Wide-2000mm 13"-Tyre generation (2010s branch),
       and 2022-2026+ belong to the 18" Ground-Effect / Active-Aero generation (2020s branch)! */
    if (y <= 1959) return '1950s';
    if (y <= 1969) return '1960s';
    if (y <= 1982) return '1970s';
    if (y <= 1988) return '1980s';
    if (y <= 1997) return '1990s';
    if (y <= 2008) return '2000s';
    if (y <= 2021) return '2010s';
    return '2020s';
  }

  /* Build an era-authentic wheel + tyre assembly for any F1 decade (1950s–2020s). */
  function buildEraWheel(isRear, mats, wheelStyle) {
    if (!wheelStyle || wheelStyle === 'aero_2020s') {
      return buildWheel(isRear, mats);
    }
    var g = new THREE.Group();
    var rOuter = 0.36, rRim = 0.22, hw = isRear ? 0.195 : 0.145, bevel = 0.044;
    if (wheelStyle === 'wire_1950s') {
      rOuter = isRear ? 0.40 : 0.38; rRim = 0.255; hw = isRear ? 0.092 : 0.078; bevel = 0.032;
    } else if (wheelStyle === 'classic_1960s') {
      rOuter = isRear ? 0.39 : 0.34; rRim = isRear ? 0.205 : 0.19; hw = isRear ? 0.168 : 0.108; bevel = 0.042;
    } else if (wheelStyle === 'bbs_1970s') {
      rOuter = isRear ? 0.395 : 0.33; rRim = isRear ? 0.215 : 0.195; hw = isRear ? 0.205 : 0.138; bevel = 0.044;
    } else if (wheelStyle === 'slick_80s' || wheelStyle === 'slick_90s') {
      rOuter = isRear ? 0.37 : 0.345; rRim = 0.195; hw = isRear ? 0.208 : 0.155; bevel = 0.046;
    } else if (wheelStyle === 'grooved_2000s') {
      rOuter = 0.355; rRim = 0.195; hw = isRear ? 0.195 : 0.155; bevel = 0.042;
    } else if (wheelStyle === 'pirelli_2010s') {
      rOuter = 0.36; rRim = 0.198; hw = isRear ? 0.205 : 0.155; bevel = 0.045;
    }

    var pts = [
      new THREE.Vector2(rRim, -hw + 0.008),
      new THREE.Vector2(rOuter - bevel, -hw),
      new THREE.Vector2(rOuter - 0.012, -hw + bevel * 0.45),
      new THREE.Vector2(rOuter, -hw + bevel),
      new THREE.Vector2(rOuter, hw - bevel),
      new THREE.Vector2(rOuter - 0.012, hw - bevel * 0.45),
      new THREE.Vector2(rOuter - bevel, hw),
      new THREE.Vector2(rRim, hw - 0.008)
    ];
    var tyreGeo = new THREE.LatheGeometry(pts, 36);
    tyreGeo.rotateZ(Math.PI / 2);
    var tyre = new THREE.Mesh(tyreGeo, mats.rubber);
    tyre.castShadow = true; tyre.receiveShadow = true;
    g.add(tyre);

    /* Authentic 2000s 4-groove tyres (1998-2008 regulations!) */
    if (wheelStyle === 'grooved_2000s') {
      [-0.62, -0.21, 0.21, 0.62].forEach(function (frac) {
        var grv = new THREE.Mesh(new THREE.TorusGeometry(rOuter + 0.001, 0.006, 6, 36), mats.intakeDark);
        grv.rotation.y = Math.PI / 2;
        grv.position.x = frac * (hw - bevel);
        g.add(grv);
      });
    } else {
      var bandGeo = new THREE.CylinderGeometry(rOuter + 0.001, rOuter + 0.001, (hw - bevel) * 1.85, 36, 1, true);
      bandGeo.rotateZ(Math.PI / 2);
      g.add(new THREE.Mesh(bandGeo, mats.rubberTread));
    }

    var rimMat = (wheelStyle === 'wire_1950s') ? mats.chrome : ((wheelStyle === 'bbs_1970s' || wheelStyle === 'classic_1960s' || wheelStyle === 'grooved_2000s') ? mats.goldRim : mats.rimDark);
    /* Open-ended outer rim dish + recessed dark brake drum so 3D spokes pop in high contrast! */
    var dish = new THREE.Mesh(new THREE.CylinderGeometry(rRim, rRim, hw * 1.84, 28, 1, true), rimMat);
    dish.rotation.z = Math.PI / 2;
    g.add(dish);
    var brakeDrum = new THREE.Mesh(new THREE.CylinderGeometry(rRim * 0.96, rRim * 0.96, hw * 1.15, 24), mats.intakeDark);
    brakeDrum.rotation.z = Math.PI / 2;
    g.add(brakeDrum);

    [-1, 1].forEach(function (side) {
      var xFace = side * (hw - 0.006);
      if (wheelStyle === 'wire_1950s') {
        /* Chrome rim lip + 14 metallic wire spokes + knock-off spinner hub over dark recessed drum */
        var lip50 = new THREE.Mesh(new THREE.TorusGeometry(rRim - 0.006, 0.013, 8, 32), mats.chrome);
        lip50.rotation.y = Math.PI / 2; lip50.position.x = xFace; g.add(lip50);
        for (var sp = 0; sp < 14; sp++) {
          var a = (sp / 14) * Math.PI * 2;
          var spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, rRim * 1.88, 5), mats.chrome);
          spoke.position.set(side * (hw - 0.016), 0, 0);
          spoke.rotation.x = a;
          g.add(spoke);
        }
        var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.055, 14), mats.chrome);
        hub.rotation.z = Math.PI / 2; hub.position.x = side * (hw + 0.002); g.add(hub);
        var ear = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.022, 0.135), mats.chrome);
        ear.position.x = side * (hw + 0.024); g.add(ear);
      } else {
        /* Deep-dish rim lip + open 3D spokes over dark brake disc */
        var lip = new THREE.Mesh(new THREE.TorusGeometry(rRim - 0.008, 0.015, 8, 32), rimMat);
        lip.rotation.y = Math.PI / 2; lip.position.x = xFace; g.add(lip);
        var spokeCount = (wheelStyle === 'bbs_1970s' || wheelStyle === 'grooved_2000s') ? 10 : ((wheelStyle === 'pirelli_2010s') ? 8 : 6);
        var spokeW = (wheelStyle === 'classic_1960s') ? 0.028 : ((wheelStyle === 'bbs_1970s' || wheelStyle === 'grooved_2000s') ? 0.015 : 0.020);
        for (var k = 0; k < spokeCount; k++) {
          var ang = (k / spokeCount) * Math.PI * 2;
          var sBar = new THREE.Mesh(new THREE.BoxGeometry(0.018, spokeW, rRim * 1.82), rimMat);
          sBar.position.set(side * (hw - 0.022), 0, 0);
          sBar.rotation.x = ang;
          g.add(sBar);
        }
        var innerRing = new THREE.Mesh(new THREE.TorusGeometry(rRim * 0.42, 0.010, 6, 20), rimMat);
        innerRing.rotation.y = Math.PI / 2; innerRing.position.x = side * (hw - 0.018); g.add(innerRing);
        var nut = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.044, 0.036, 10), mats.chrome);
        nut.rotation.z = Math.PI / 2; nut.position.x = side * (hw - 0.010); g.add(nut);

        /* Sidewall ring for 1990s (Goodyear white) & 2010s (Pirelli coloured) */
        if (wheelStyle === 'slick_90s' || wheelStyle === 'pirelli_2010s') {
          var ringGeo = new THREE.RingGeometry(rRim + 0.042, rRim + 0.062, 40);
          ringGeo.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
          var ring = new THREE.Mesh(ringGeo, wheelStyle === 'slick_90s' ? mats.exhaustWhite : mats.tyreRing);
          ring.position.x = side * (hw + 0.0015);
          g.add(ring);
        }
      }
    });
    g.userData.radius = rOuter;
    return g;
  }

  /* Build a realistic 18-inch F1 slick wheel + tyre + aero cover + coloured sidewall ring. */
  function buildWheel(isRear, mats) {
    var g = new THREE.Group();
    var rOuter = 0.36;
    var rRim = 0.235;
    var hw = isRear ? 0.202 : 0.152;
    var bevel = 0.042;

    /* Tyre rubber profile revolved around Y, then rotated so axle is X */
    var pts = [
      new THREE.Vector2(rRim, -hw + 0.008),
      new THREE.Vector2(rOuter - bevel, -hw),
      new THREE.Vector2(rOuter - 0.012, -hw + bevel * 0.45),
      new THREE.Vector2(rOuter, -hw + bevel),
      new THREE.Vector2(rOuter, hw - bevel),
      new THREE.Vector2(rOuter - 0.012, hw - bevel * 0.45),
      new THREE.Vector2(rOuter - bevel, hw),
      new THREE.Vector2(rRim, hw - 0.008),
    ];
    var tyreGeo = new THREE.LatheGeometry(pts, 40);
    tyreGeo.rotateZ(Math.PI / 2);
    var tyre = new THREE.Mesh(tyreGeo, mats.rubber);
    tyre.castShadow = true;
    tyre.receiveShadow = true;
    g.add(tyre);

    /* Glossy subtle tread shoulder sheen strip (center band) */
    var bandGeo = new THREE.CylinderGeometry(rOuter + 0.001, rOuter + 0.001, (hw - bevel) * 1.9, 40, 1, true);
    bandGeo.rotateZ(Math.PI / 2);
    g.add(new THREE.Mesh(bandGeo, mats.rubberTread));

    /* Inner rim barrel */
    var barrelGeo = new THREE.CylinderGeometry(rRim, rRim, hw * 1.88, 32);
    barrelGeo.rotateZ(Math.PI / 2);
    g.add(new THREE.Mesh(barrelGeo, mats.rimDark));

    /* Outer & inner aero wheel covers + Pirelli-style sidewall ring */
    [-1, 1].forEach(function (side) {
      var xFace = side * (hw - 0.004);
      /* Coloured sidewall ring (uses team accent or pop) */
      var ringGeo = new THREE.RingGeometry(rRim + 0.022, rRim + 0.042, 44);
      ringGeo.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
      var ring = new THREE.Mesh(ringGeo, mats.tyreRing);
      ring.position.x = side * (hw + 0.0015);
      g.add(ring);

      /* Outer rim lip */
      var lipGeo = new THREE.TorusGeometry(rRim - 0.008, 0.012, 10, 36);
      lipGeo.rotateY(Math.PI / 2);
      var lip = new THREE.Mesh(lipGeo, mats.rimAccent);
      lip.position.x = xFace;
      g.add(lip);

      /* Recessed dished aero wheel cover */
      var dishGeo = new THREE.CylinderGeometry(rRim - 0.015, rRim - 0.045, 0.032, 32);
      dishGeo.rotateZ(Math.PI / 2);
      var dish = new THREE.Mesh(dishGeo, mats.wheelCover);
      dish.position.x = side * (hw - 0.026);
      g.add(dish);

      /* 6 subtle aero spokes / ribs on wheel cover */
      for (var k = 0; k < 6; k++) {
        var ang = (k / 6) * Math.PI * 2;
        var rib = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.018, rRim * 0.72), mats.rimDark);
        rib.position.set(side * (hw - 0.014), Math.sin(ang) * rRim * 0.48, Math.cos(ang) * rRim * 0.48);
        rib.rotation.x = -ang;
        g.add(rib);
      }

      /* Metallic centre-lock nut */
      var nutGeo = new THREE.CylinderGeometry(0.042, 0.048, 0.03, 12);
      nutGeo.rotateZ(Math.PI / 2);
      var nut = new THREE.Mesh(nutGeo, mats.chrome);
      nut.position.x = side * (hw - 0.010);
      g.add(nut);
    });

    return g;
  }

  /* Create the full 3D F1 car Group for any exact season year (1950..2026) or era ('1950s'..'2020s') + live .setPalette(). */
  function createF1Car(palette, styleName, eraName) {
    var exactYear = parseExactYear(eraName);
    var era = normalizeEra(eraName);
    var root = new THREE.Group();
    root.name = 'F1Car3D';
    root.userData.era = era;
    root.userData.year = exactYear;

    var carbonTex = makeCarbonTexture();

    function paintMat(hex, metal, rough, coat) {
      return new THREE.MeshPhysicalMaterial({
        color: hex,
        metalness: metal == null ? 0.34 : metal,
        roughness: rough == null ? 0.24 : rough,
        clearcoat: coat == null ? 1.0 : coat,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.35
      });
    }

    /* Per-zone materials so 5 livery pattern styles recolour independently in <0.2ms */
    var mats = {
      bodyMain:       paintMat(0xff8000, 0.34, 0.24, 1.0),
      noseStripe:     paintMat(0x47c7fc, 0.26, 0.22, 1.0),
      noseTip:        paintMat(0x161920, 0.30, 0.26, 0.9),
      sidepodBody:    paintMat(0xff8000, 0.34, 0.24, 1.0),
      sidepodLower:   paintMat(0x161920, 0.28, 0.30, 0.85),
      sidepodSwoosh:  paintMat(0x47c7fc, 0.25, 0.22, 1.0),
      airboxBody:     paintMat(0x161920, 0.28, 0.28, 0.9),
      airboxRim:      paintMat(0x47c7fc, 0.25, 0.22, 1.0),
      sharkFin:       paintMat(0xff8000, 0.34, 0.24, 1.0),
      sharkFinEdge:   paintMat(0x47c7fc, 0.25, 0.22, 1.0),
      halo:           paintMat(0x161920, 0.32, 0.28, 0.85),
      frontWing1:     paintMat(0x161920, 0.28, 0.28, 0.85),
      frontWing2:     paintMat(0xff8000, 0.34, 0.24, 1.0),
      frontWing3:     paintMat(0x47c7fc, 0.26, 0.22, 1.0),
      frontEndplate:  paintMat(0x161920, 0.28, 0.28, 0.85),
      frontDiveplane: paintMat(0x47c7fc, 0.25, 0.22, 1.0),
      rearWingMain:   paintMat(0x161920, 0.28, 0.28, 0.85),
      rearWingFlap:   paintMat(0x47c7fc, 0.25, 0.22, 1.0),
      rearEndplate:   paintMat(0xff8000, 0.34, 0.24, 1.0),
      rearEndplateCap:paintMat(0x47c7fc, 0.25, 0.22, 1.0),
      mirrorCap:      paintMat(0x161920, 0.28, 0.26, 0.9),
      mirrorAccent:   paintMat(0x47c7fc, 0.25, 0.22, 1.0),
      helmet:         paintMat(0xffffff, 0.20, 0.20, 1.0),
      helmetStripe:   paintMat(0x47c7fc, 0.25, 0.22, 1.0),
      tcam:           paintMat(0xffffff, 0.20, 0.22, 0.9),
      floorEdge:      paintMat(0x2a303c, 0.45, 0.32, 0.6),
      carbon: new THREE.MeshPhysicalMaterial({
        color: 0x1e2128, map: carbonTex, metalness: 0.25, roughness: 0.42,
        clearcoat: 0.55, clearcoatRoughness: 0.25, envMapIntensity: 1.0
      }),
      intakeDark: new THREE.MeshStandardMaterial({
        color: 0x050608, metalness: 0.1, roughness: 0.9
      }),
      rubber: new THREE.MeshStandardMaterial({
        color: 0x141518, metalness: 0.02, roughness: 0.84, envMapIntensity: 0.45
      }),
      rubberTread: new THREE.MeshStandardMaterial({
        color: 0x191b20, metalness: 0.05, roughness: 0.58, envMapIntensity: 0.6
      }),
      wheelCover: new THREE.MeshStandardMaterial({
        color: 0x15181f, metalness: 0.42, roughness: 0.36, envMapIntensity: 1.1
      }),
      rimDark: new THREE.MeshStandardMaterial({
        color: 0x0d0f14, metalness: 0.55, roughness: 0.32
      }),
      rimAccent: new THREE.MeshStandardMaterial({
        color: 0xff8000, metalness: 0.35, roughness: 0.28, envMapIntensity: 1.2
      }),
      tyreRing: new THREE.MeshBasicMaterial({
        color: 0xe10600, side: THREE.DoubleSide
      }),
      chrome: new THREE.MeshStandardMaterial({
        color: 0xd6dce6, metalness: 0.92, roughness: 0.18, envMapIntensity: 1.5
      }),
      visor: new THREE.MeshPhysicalMaterial({
        color: 0x0a101d, metalness: 0.9, roughness: 0.06,
        clearcoat: 1.0, clearcoatRoughness: 0.02, envMapIntensity: 1.8
      }),
      rainLight: new THREE.MeshStandardMaterial({
        color: 0xff1a1a, emissive: 0xff0000, emissiveIntensity: 1.8, roughness: 0.2
      }),
      leather: new THREE.MeshStandardMaterial({
        color: 0x5c3318, metalness: 0.05, roughness: 0.78
      }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0xdbeafe, metalness: 0.1, roughness: 0.06, transparent: true, opacity: 0.42, clearcoat: 1.0
      }),
      exhaustWhite: new THREE.MeshStandardMaterial({
        color: 0xe6e4dc, metalness: 0.15, roughness: 0.48
      }),
      goldRim: new THREE.MeshStandardMaterial({
        color: 0xc9a24b, metalness: 0.72, roughness: 0.28, envMapIntensity: 1.4
      }),
      engineAlloy: new THREE.MeshStandardMaterial({
        color: 0x545b66, metalness: 0.78, roughness: 0.34, envMapIntensity: 1.2
      })
    };

    /* Aliases for code clarity inside geometry construction */
    mats.main = mats.bodyMain;
    mats.secondary = mats.sidepodLower;
    mats.accent = mats.sidepodSwoosh;
    mats.pop = mats.helmet;
    mats.detail = mats.floorEdge;

    var noseCapMesh = { visible: false };
    var bullDecalMesh = { visible: false };
    var ferrariBandMesh = { visible: false };
    var duracellCapMesh = { visible: false };
    var triStripeMesh = { visible: false };
    var pinstripeMesh = { visible: false };
    var chevronCanopyMesh = { visible: false };

    function addMesh(geo, mat, pos, rot, shadow) {
      var m = new THREE.Mesh(geo, mat);
      if (pos) m.position.set(pos[0], pos[1], pos[2]);
      if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
      if (shadow !== false) { m.castShadow = true; m.receiveShadow = true; }
      root.add(m);
      return m;
    }

    function addDriverHelmet(yPos, zPos, openFace) {
      var hg = new THREE.Group();
      hg.position.set(0, yPos, zPos);
      var hShell = new THREE.Mesh(new THREE.SphereGeometry(0.128, 20, 16), mats.helmet);
      hShell.scale.set(0.92, 0.95, 1.10);
      hg.add(hShell);
      var hStripe = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.235, 0.255), mats.helmetStripe);
      hStripe.position.set(0, 0.014, -0.01);
      hg.add(hStripe);
      var visor = new THREE.Mesh(
        new THREE.SphereGeometry(0.131, 18, 12, -Math.PI * 0.34, Math.PI * 0.68, Math.PI * 0.34, openFace ? Math.PI * 0.14 : Math.PI * 0.24),
        mats.visor
      );
      visor.rotation.y = Math.PI * 0.5;
      visor.scale.set(1.12, 0.95, 0.93);
      hg.add(visor);
      root.add(hg);
    }

    function addExposedV8(zCenter, yBase, withSpaghettiExhaust) {
      /* Cosworth DFV style V8 block + 8 gleaming vertical chrome intake trumpets! */
      addMesh(new THREE.BoxGeometry(0.32, 0.24, 0.72), mats.engineAlloy, [0, yBase + 0.12, zCenter]);
      [-1, 1].forEach(function (s) {
        addMesh(new THREE.BoxGeometry(0.12, 0.14, 0.66), mats.rimDark, [s * 0.15, yBase + 0.24, zCenter], [0, 0, s * 0.36]);
        for (var t = 0; t < 4; t++) {
          var tz = zCenter + 0.24 - t * 0.16;
          addMesh(new THREE.CylinderGeometry(0.024, 0.015, 0.17, 10), mats.chrome, [s * 0.11, yBase + 0.35, tz], [0, 0, s * -0.18]);
        }
        if (withSpaghettiExhaust) {
          var pipe = new THREE.CatmullRomCurve3([
            new THREE.Vector3(s * 0.18, yBase + 0.18, zCenter + 0.24),
            new THREE.Vector3(s * 0.28, yBase + 0.24, zCenter - 0.05),
            new THREE.Vector3(s * 0.24, yBase + 0.28, zCenter - 0.42),
            new THREE.Vector3(s * 0.09, yBase + 0.19, zCenter - 0.72)
          ]);
          addMesh(new THREE.TubeGeometry(pipe, 18, 0.024, 8, false), mats.exhaustWhite);
          var pipe2 = new THREE.CatmullRomCurve3([
            new THREE.Vector3(s * 0.18, yBase + 0.14, zCenter - 0.04),
            new THREE.Vector3(s * 0.27, yBase + 0.20, zCenter - 0.32),
            new THREE.Vector3(s * 0.12, yBase + 0.14, zCenter - 0.70)
          ]);
          addMesh(new THREE.TubeGeometry(pipe2, 16, 0.022, 8, false), mats.exhaustWhite);
        }
      });
      /* Rear transaxle gearbox casing */
      addMesh(new THREE.CylinderGeometry(0.10, 0.14, 0.44, 12), mats.engineAlloy, [0, yBase + 0.11, zCenter - 0.56], [Math.PI / 2, 0, 0]);
    }

    function addChromeRollHoop(zPos, yBase, yTop, halfW) {
      var curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-halfW, yBase, zPos),
        new THREE.Vector3(-halfW * 0.75, yTop * 0.92, zPos),
        new THREE.Vector3(0, yTop, zPos),
        new THREE.Vector3(halfW * 0.75, yTop * 0.92, zPos),
        new THREE.Vector3(halfW, yBase, zPos)
      ]);
      addMesh(new THREE.TubeGeometry(curve, 18, 0.022, 8, false), mats.chrome);
      root.add(buildStrut([0, yTop - 0.03, zPos], [0, yBase + 0.04, zPos - 0.36], 0.015, mats.chrome));
    }

    function addFourWheels(zF, zR, xF, xR, wheelStyle, suspMat) {
      var sMat = suspMat || mats.carbon;
      var wSpecs = [
        { pos: [ xF, 0, zF], rear: false },
        { pos: [-xF, 0, zF], rear: false },
        { pos: [ xR, 0, zR], rear: true  },
        { pos: [-xR, 0, zR], rear: true  }
      ];
      root.userData.wheels = root.userData.wheels || [];
      root.userData.tyreRingMat = mats.tyreRing;
      wSpecs.forEach(function (w) {
        var wg = buildEraWheel(w.rear, mats, wheelStyle);
        var ry = wg.userData.radius || 0.36;
        wg.position.set(w.pos[0], ry, w.pos[2]);
        wg.rotation.order = 'YXZ';
        wg.userData.isFront = !w.rear;
        wg.userData.radius = ry;
        root.userData.wheels.push(wg);
        root.add(wg);
      });
      [-1, 1].forEach(function (s) {
        var fTop = [s * (xF - 0.14), 0.42, zF];
        var fBot = [s * (xF - 0.14), 0.23, zF];
        root.add(buildStrut([s * 0.16, 0.42, zF + 0.20], fTop, 0.011, sMat));
        root.add(buildStrut([s * 0.20, 0.42, zF - 0.20], fTop, 0.011, sMat));
        root.add(buildStrut([s * 0.15, 0.22, zF + 0.18], fBot, 0.011, sMat));
        root.add(buildStrut([s * 0.19, 0.21, zF - 0.20], fBot, 0.011, sMat));
        root.add(buildStrut([s * 0.17, 0.32, zF + 0.04], [s * (xF - 0.14), 0.33, zF + 0.04], 0.008, mats.chrome));

        var rTop = [s * (xR - 0.19), 0.44, zR];
        var rBot = [s * (xR - 0.19), 0.24, zR];
        root.add(buildStrut([s * 0.16, 0.42, zR + 0.26], rTop, 0.012, sMat));
        root.add(buildStrut([s * 0.11, 0.36, zR - 0.24], rTop, 0.012, sMat));
        root.add(buildStrut([s * 0.18, 0.22, zR + 0.22], rBot, 0.012, sMat));
        root.add(buildStrut([s * 0.11, 0.20, zR - 0.22], rBot, 0.012, sMat));
        root.add(buildStrut([s * 0.12, 0.34, zR], [s * (xR - 0.17), 0.35, zR], 0.013, mats.chrome));
      });
    }

    /* =================================================================
       DISPATCH TO ERA-FAITHFUL 3D GEOMETRY BUILDER (1950s .. 2020s)
       ================================================================= */
    if (era === '1950s') {
      /* 1950s FRONT-ENGINED CIGAR (Maserati 250F / Ferrari 500) — NO WINGS, WIRE WHEELS */
      var cigar50 = [
        [ 2.18, 0.14, 0.24, 0.56, 2.0, 2.0],
        [ 1.98, 0.26, 0.20, 0.68, 2.0, 2.0],
        [ 1.45, 0.33, 0.19, 0.77, 2.0, 2.0],
        [ 0.75, 0.37, 0.18, 0.84, 2.0, 2.0],
        [ 0.10, 0.41, 0.18, 0.85, 2.0, 2.0],
        [-0.45, 0.42, 0.19, 0.76, 2.0, 2.0],
        [-1.02, 0.38, 0.21, 0.84, 2.0, 2.0],
        [-1.65, 0.28, 0.26, 0.76, 2.0, 2.0],
        [-2.14, 0.12, 0.34, 0.56, 2.0, 2.0]
      ];
      addMesh(buildLoft(cigar50.map(function (s) { return superRing(s[0], 0, s[1], s[2], s[3], s[4], s[5], 24); }), true, true), mats.bodyMain);
      /* Nose & bonnet racing stripe */
      var st50 = [
        [ 2.06, 0.055, 0.63, 0.66, 2.0, 2.0],
        [ 1.35, 0.075, 0.76, 0.79, 2.0, 2.0],
        [ 0.45, 0.085, 0.83, 0.86, 2.0, 2.0]
      ];
      addMesh(buildLoft(st50.map(function (s) { return superRing(s[0], 0, s[1], s[2], s[3], 2.0, 2.0, 12); }), true, true), mats.noseStripe);
      /* Iconic oval slatted chrome radiator grille at nose! */
      var grRing = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 10, 28), mats.chrome);
      grRing.scale.set(1.12, 0.86, 0.6); grRing.position.set(0, 0.41, 2.18); root.add(grRing);
      addMesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 20), mats.intakeDark, [0, 0.41, 2.16], [Math.PI / 2, 0, 0]);
      for (var bar = -3; bar <= 3; bar++) {
        addMesh(new THREE.BoxGeometry(0.32, 0.008, 0.012), mats.chrome, [0, 0.41 + bar * 0.036, 2.185]);
      }
      /* Open leather cockpit, wrap-around Perspex windscreen & open-face helmet */
      addMesh(new THREE.BoxGeometry(0.42, 0.22, 0.64), mats.leather, [0, 0.64, -0.45]);
      var ws50 = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.27, 0.19, 18, 1, true, -Math.PI * 0.42, Math.PI * 0.84), mats.glass);
      ws50.position.set(0, 0.87, -0.02); ws50.rotation.x = -0.35; root.add(ws50);
      addDriverHelmet(0.86, -0.48, true);
      /* Long gleaming chrome side exhaust pipe along left flank! */
      var exh50 = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.37, 0.40, 1.35),
        new THREE.Vector3(0.44, 0.28, 0.65),
        new THREE.Vector3(0.45, 0.25, -0.45),
        new THREE.Vector3(0.40, 0.27, -1.65)
      ]);
      addMesh(new THREE.TubeGeometry(exh50, 22, 0.034, 10, false), mats.chrome);
      /* Tall skinny wire-spoke wheels! */
      addFourWheels(1.42, -1.32, 0.74, 0.74, 'wire_1950s', mats.chrome);

    } else if (era === '1960s') {
      /* 1960s REAR-ENGINED CIGAR (Lotus 49) — EXPOSED COSWORTH V8 + WHITE EXHAUSTS, NO WINGS */
      var cigar60 = [
        [ 2.28, 0.13, 0.22, 0.39, 2.0, 2.0],
        [ 1.92, 0.23, 0.18, 0.48, 2.0, 2.0],
        [ 1.25, 0.28, 0.16, 0.56, 2.0, 2.0],
        [ 0.55, 0.34, 0.15, 0.62, 2.1, 2.2],
        [-0.08, 0.36, 0.15, 0.60, 2.1, 2.2],
        [-0.68, 0.33, 0.16, 0.56, 2.1, 2.2],
        [-1.12, 0.24, 0.18, 0.46, 2.0, 2.0]
      ];
      addMesh(buildLoft(cigar60.map(function (s) { return superRing(s[0], 0, s[1], s[2], s[3], s[4], s[5], 24); }), true, true), mats.bodyMain);
      /* Iconic Lotus yellow/accent noseband & centre stripe! */
      var noseBand60 = [
        [ 2.285, 0.133, 0.218, 0.393, 2.0, 2.0],
        [ 1.96,  0.228, 0.178, 0.478, 2.0, 2.0]
      ];
      noseCapMesh = addMesh(buildLoft(noseBand60.map(function (s) { return superRing(s[0], 0, s[1], s[2], s[3], 2.0, 2.0, 20); }), true, true), mats.noseStripe);
      var st60 = [
        [ 2.20, 0.055, 0.39, 0.42, 2.0, 2.0],
        [ 1.35, 0.068, 0.54, 0.57, 2.0, 2.0],
        [ 0.55, 0.075, 0.60, 0.63, 2.0, 2.0]
      ];
      addMesh(buildLoft(st60.map(function (s) { return superRing(s[0], 0, s[1], s[2], s[3], 2.0, 2.0, 12); }), true, true), mats.noseStripe);
      /* Open front radiator mouth */
      addMesh(new THREE.CylinderGeometry(0.12, 0.12, 0.05, 18), mats.intakeDark, [0, 0.30, 2.27], [Math.PI / 2, 0, 0]);
      /* Cockpit, low windscreen, chrome roll-hoop & exposed Cosworth DFV V8 + white spaghetti exhausts! */
      addMesh(new THREE.BoxGeometry(0.36, 0.16, 0.58), mats.intakeDark, [0, 0.54, -0.08]);
      var ws60 = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.13, 16, 1, true, -Math.PI * 0.4, Math.PI * 0.8), mats.glass);
      ws60.position.set(0, 0.66, 0.30); ws60.rotation.x = -0.45; root.add(ws60);
      addDriverHelmet(0.69, -0.14, true);
      addChromeRollHoop(-0.46, 0.54, 0.94, 0.19);
      addExposedV8(-1.14, 0.22, true);
      /* 1968-1969 Iconic High-Stilt Wings Era (Lotus 49B / Matra MS10 / Ferrari 312)! */
      if (exactYear >= 1968) {
        addMesh(buildWingElement({ halfSpan: 0.62, zCenter: -1.48, zTip: -1.48, yCenter: 1.44, yTip: 1.44, chordCenter: 0.26, chordTip: 0.26, thick: 0.022, pitch: 0.20 }), mats.rearWingMain);
        addMesh(buildWingElement({ halfSpan: 0.58, zCenter: 2.08, zTip: 2.08, yCenter: 0.66, yTip: 0.66, chordCenter: 0.20, chordTip: 0.20, thick: 0.018, pitch: 0.16 }), mats.frontWing1);
        [-1, 1].forEach(function (s) {
          addMesh(new THREE.CylinderGeometry(0.012, 0.014, 0.96, 8), mats.chrome, [s * 0.26, 0.96, -1.48]);
          addMesh(new THREE.CylinderGeometry(0.010, 0.012, 0.38, 8), mats.chrome, [s * 0.22, 0.47, 2.08]);
        });
      }
      addFourWheels(1.48, -1.42, 0.78, 0.80, 'classic_1960s', mats.chrome);

    } else if (era === '1970s') {
      /* 1970s WEDGE GROUND-EFFECT (Lotus 78/79) — CHISEL NOSE, BOXY SIDEPODS, EXPOSED V8, GIANT HIGH WING */
      var wedge70 = [
        [ 2.52, 0.14, 0.14, 0.20, 2.6, 2.8],
        [ 2.05, 0.22, 0.14, 0.32, 2.6, 2.8],
        [ 1.35, 0.28, 0.14, 0.48, 2.6, 2.8],
        [ 0.65, 0.32, 0.14, 0.58, 2.6, 2.8],
        [-0.08, 0.33, 0.14, 0.57, 2.6, 2.8],
        [-0.65, 0.30, 0.15, 0.54, 2.4, 2.6],
        [-1.15, 0.24, 0.16, 0.46, 2.2, 2.4]
      ];
      addMesh(buildLoft(wedge70.map(function (s) { return superRing(s[0], 0, s[1], s[2], s[3], s[4], s[5], 20); }), true, true), mats.bodyMain);
      /* Boxy rectangular ground-effect sidepods with accent pinstripe trim */
      [-1, 1].forEach(function (s) {
        addMesh(new THREE.BoxGeometry(0.42, 0.34, 1.92), mats.sidepodBody, [s * 0.52, 0.30, -0.12]);
        addMesh(new THREE.BoxGeometry(0.36, 0.24, 0.04), mats.intakeDark, [s * 0.52, 0.31, 0.84]);
        addMesh(new THREE.BoxGeometry(0.018, 0.032, 1.94), mats.sidepodSwoosh, [s * 0.735, 0.45, -0.12]);
        addMesh(new THREE.BoxGeometry(0.018, 0.028, 1.94), mats.sidepodSwoosh, [s * 0.735, 0.15, -0.12]);
      });
      /* Wide flat 1970s front wing */
      addMesh(buildWingElement({ halfSpan: 0.94, zCenter: 2.38, zTip: 2.36, yCenter: 0.15, yTip: 0.15, chordCenter: 0.36, chordTip: 0.34, thick: 0.028, pitch: 0.12 }), mats.frontWing1);
      [-1, 1].forEach(function (s) {
        addMesh(buildVerticalPlate([[2.56, 0.09], [2.16, 0.09], [2.16, 0.28], [2.48, 0.22]], s * 0.94, 0.018), mats.frontEndplate);
      });
      /* Open cockpit, chrome roll-hoop & exposed Cosworth V8 */
      addMesh(new THREE.BoxGeometry(0.34, 0.14, 0.56), mats.intakeDark, [0, 0.52, 0.02]);
      addDriverHelmet(0.65, -0.02, false);
      addChromeRollHoop(-0.42, 0.50, 0.92, 0.20);
      /* 1971-1975 Iconic Tall Periscope Overhead Airbox (Ferrari 312T / McLaren M23 / Brabham BT44)! */
      if (exactYear >= 1971 && exactYear <= 1975) {
        var peri70 = [
          [-0.28, 0.145, 0.62, 1.32, 2.0, 2.2],
          [-0.68, 0.155, 0.56, 1.24, 2.0, 2.2],
          [-1.18, 0.100, 0.46, 0.86, 1.9, 2.0]
        ];
        addMesh(buildLoft(peri70.map(function (s) { return superRing(s[0], 0, s[1], s[2], s[3], s[4], s[5], 16); }), true, true), mats.airboxBody);
        addMesh(new THREE.CylinderGeometry(0.095, 0.095, 0.08, 16), mats.intakeDark, [0, 1.18, -0.27], [Math.PI / 2, 0, 0]);
      }
      /* 1978-1982 Ground-Effect Venturi Side Skirts (Lotus 79 / Williams FW07) */
      if (exactYear >= 1978) {
        [-1, 1].forEach(function (s) {
          addMesh(new THREE.BoxGeometry(0.022, 0.12, 1.94), mats.carbon, [s * 0.73, 0.07, -0.12]);
        });
      }
      addExposedV8(-1.12, 0.20, false);
      /* Iconic high-mounted sweeping 1970s rear wing on twin rear pillars */
      addMesh(buildWingElement({ halfSpan: 0.56, zCenter: -2.08, zTip: -2.08, yCenter: 0.86, yTip: 0.86, chordCenter: 0.34, chordTip: 0.34, thick: 0.03, pitch: 0.26 }), mats.rearWingMain);
      addMesh(buildWingElement({ halfSpan: 0.55, zCenter: -2.26, zTip: -2.26, yCenter: 0.95, yTip: 0.95, chordCenter: 0.18, chordTip: 0.18, thick: 0.022, pitch: 0.44 }), mats.rearWingFlap);
      [-1, 1].forEach(function (s) {
        addMesh(new THREE.BoxGeometry(0.024, 0.56, 0.20), mats.carbon, [s * 0.18, 0.58, -1.96]);
        addMesh(buildVerticalPlate([[-1.88, 0.68], [-2.36, 0.68], [-2.42, 1.02], [-1.96, 1.02]], s * 0.565, 0.022), mats.rearEndplate);
        addMesh(new THREE.BoxGeometry(0.03, 0.024, 0.44), mats.rearEndplateCap, [s * 0.565, 1.03, -2.18]);
      });
      addFourWheels(1.52, -1.42, 0.80, 0.82, 'bbs_1970s', mats.chrome);

    } else if (era === '1980s') {
      /* 1980s TURBO ERA (McLaren MP4/4) — LOW WEDGE NOSE, SCULPTED SIDEPODS, LOW SLOPED ENGINE COVER, NO TALL AIRBOX */
      var body80 = [
        [ 2.56, 0.09, 0.12, 0.19, 2.4, 2.6],
        [ 2.08, 0.19, 0.13, 0.32, 2.4, 2.6],
        [ 1.38, 0.27, 0.13, 0.48, 2.5, 2.8],
        [ 0.68, 0.32, 0.13, 0.58, 2.5, 2.8],
        [-0.05, 0.33, 0.13, 0.56, 2.5, 2.8],
        [-0.52, 0.31, 0.13, 0.72, 2.2, 2.6],
        [-1.15, 0.24, 0.15, 0.62, 2.1, 2.4],
        [-1.82, 0.15, 0.17, 0.44, 2.0, 2.2]
      ];
      addMesh(buildLoft(body80.map(function (s) { return superRing(s[0], 0, s[1], s[2], s[3], s[4], s[5], 22); }), true, true), mats.bodyMain);
      /* Sculpted low 1980s sidepods with recessed side radiator openings */
      [-1, 1].forEach(function (s) {
        var pod80 = [
          [ 0.55, s * 0.50, 0.21, 0.14, 0.48],
          [ 0.05, s * 0.54, 0.24, 0.13, 0.52],
          [-0.65, s * 0.52, 0.23, 0.13, 0.50],
          [-1.30, s * 0.42, 0.17, 0.14, 0.42],
          [-1.78, s * 0.24, 0.09, 0.16, 0.32]
        ];
        addMesh(buildLoft(pod80.map(function (r) { return superRing(r[0], r[1], r[2], r[3], r[4], 2.5, 2.8, 18); }), true, true), mats.sidepodBody);
        addMesh(new THREE.BoxGeometry(0.03, 0.22, 0.54), mats.intakeDark, [s * 0.77, 0.30, -0.30]);
        addMesh(new THREE.BoxGeometry(0.32, 0.22, 0.04), mats.intakeDark, [s * 0.50, 0.31, 0.56]);
        addMesh(new THREE.BoxGeometry(0.02, 0.04, 1.48), mats.sidepodSwoosh, [s * 0.76, 0.47, -0.32]);
      });
      /* Flat carbon floor + diffuser */
      addMesh(new THREE.BoxGeometry(1.52, 0.04, 2.35), mats.carbon, [0, 0.11, -0.35]);
      /* Wide low straight 1980s front wing */
      addMesh(buildWingElement({ halfSpan: 0.94, zCenter: 2.38, zTip: 2.38, yCenter: 0.14, yTip: 0.14, chordCenter: 0.36, chordTip: 0.35, thick: 0.028, pitch: 0.14 }), mats.frontWing1);
      addMesh(buildWingElement({ halfSpan: 0.92, zCenter: 2.22, zTip: 2.22, yCenter: 0.20, yTip: 0.20, chordCenter: 0.16, chordTip: 0.16, thick: 0.020, pitch: 0.28 }), mats.frontWing2);
      [-1, 1].forEach(function (s) {
        addMesh(buildVerticalPlate([[2.58, 0.08], [2.06, 0.08], [2.06, 0.31], [2.52, 0.22]], s * 0.945, 0.022), mats.frontEndplate);
      });
      /* Cockpit + exposed roll-hoop (no tall overhead airbox yet!) */
      addMesh(new THREE.BoxGeometry(0.34, 0.12, 0.54), mats.intakeDark, [0, 0.52, 0.08]);
      addDriverHelmet(0.65, 0.04, false);
      addChromeRollHoop(-0.34, 0.56, 0.93, 0.16);
      /* Wide 1980s box rear wing */
      addMesh(buildWingElement({ halfSpan: 0.54, zCenter: -2.14, zTip: -2.14, yCenter: 0.78, yTip: 0.78, chordCenter: 0.34, chordTip: 0.34, thick: 0.03, pitch: 0.24 }), mats.rearWingMain);
      addMesh(buildWingElement({ halfSpan: 0.53, zCenter: -2.30, zTip: -2.30, yCenter: 0.90, yTip: 0.90, chordCenter: 0.19, chordTip: 0.19, thick: 0.022, pitch: 0.44 }), mats.rearWingFlap);
      addMesh(new THREE.BoxGeometry(0.03, 0.46, 0.18), mats.carbon, [0, 0.54, -2.08]);
      [-1, 1].forEach(function (s) {
        addMesh(buildVerticalPlate([[-1.92, 0.52], [-2.42, 0.52], [-2.42, 0.98], [-1.92, 0.98]], s * 0.545, 0.024), mats.rearEndplate);
        addMesh(new THREE.BoxGeometry(0.03, 0.026, 0.46), mats.rearEndplateCap, [s * 0.545, 0.99, -2.17]);
      });
      addFourWheels(1.58, -1.50, 0.80, 0.80, 'slick_80s', mats.carbon);

    } else if (era === '1990s') {
      /* 1990s CLASSIC HIGH-AIRBOX (Williams FW14B / FW15C) — TALL AIRBOX, CLEAN LONG SIDEPODS, MULTI-PLANE WING */
      var body90 = [
        [ 2.62, 0.075, 0.15, 0.21, 2.2, 2.4],
        [ 2.12, 0.165, 0.16, 0.35, 2.3, 2.5],
        [ 1.48, 0.235, 0.14, 0.49, 2.4, 2.6],
        [ 0.78, 0.295, 0.13, 0.58, 2.5, 2.8],
        [ 0.05, 0.310, 0.13, 0.57, 2.5, 2.8],
        [-0.45, 0.295, 0.13, 0.68, 2.2, 2.6],
        [-1.15, 0.230, 0.15, 0.62, 2.0, 2.4],
        [-1.92, 0.135, 0.18, 0.43, 2.0, 2.2]
      ];
      addMesh(buildLoft(body90.map(function (s) { return superRing(s[0], 0, s[1], s[2], s[3], s[4], s[5], 22); }), true, true), mats.bodyMain);
      /* Tall prominent 1990s overhead airbox & swept engine cover! */
      var air90 = [
        [-0.24, 0.145, 0.56, 1.04, 2.0, 2.2],
        [-0.60, 0.165, 0.54, 1.00, 2.0, 2.2],
        [-1.20, 0.125, 0.46, 0.82, 1.9, 2.0],
        [-1.85, 0.055, 0.34, 0.54, 1.8, 2.0]
      ];
      addMesh(buildLoft(air90.map(function (s) { return superRing(s[0], 0, s[1], s[2], s[3], s[4], s[5], 18); }), true, true), mats.airboxBody);
      addMesh(new THREE.CylinderGeometry(0.088, 0.088, 0.07, 16), mats.intakeDark, [0, 0.91, -0.23], [Math.PI / 2, 0, 0]);
      addMesh(new THREE.BoxGeometry(0.24, 0.022, 0.05), mats.tcam, [0, 1.09, -0.32]);
      /* Clean tall sculpted 1990s sidepods */
      [-1, 1].forEach(function (s) {
        var pod90 = [
          [ 0.52, s * 0.48, 0.19, 0.16, 0.54],
          [-0.08, s * 0.53, 0.23, 0.14, 0.56],
          [-0.78, s * 0.50, 0.22, 0.14, 0.52],
          [-1.42, s * 0.36, 0.15, 0.16, 0.40],
          [-1.88, s * 0.18, 0.08, 0.18, 0.32]
        ];
        addMesh(buildLoft(pod90.map(function (r) { return superRing(r[0], r[1], r[2], r[3], r[4], 2.4, 2.6, 18); }), true, true), mats.sidepodBody);
        addMesh(new THREE.BoxGeometry(0.28, 0.22, 0.04), mats.intakeDark, [s * 0.48, 0.36, 0.53]);
        addMesh(new THREE.BoxGeometry(0.02, 0.08, 1.56), mats.sidepodSwoosh, [s * 0.75, 0.36, -0.42]);
      });
      addMesh(new THREE.BoxGeometry(1.48, 0.04, 2.45), mats.carbon, [0, 0.11, -0.40]);
      /* Multi-element 1990s front wing */
      addMesh(buildWingElement({ halfSpan: 0.93, zCenter: 2.46, zTip: 2.38, yCenter: 0.13, yTip: 0.12, chordCenter: 0.30, chordTip: 0.28, thick: 0.026, pitch: 0.12 }), mats.frontWing1);
      addMesh(buildWingElement({ halfSpan: 0.91, zCenter: 2.28, zTip: 2.22, yCenter: 0.19, yTip: 0.18, chordCenter: 0.17, chordTip: 0.16, thick: 0.020, pitch: 0.26 }), mats.frontWing2);
      [-1, 1].forEach(function (s) {
        addMesh(buildVerticalPlate([[2.62, 0.08], [2.10, 0.08], [2.10, 0.33], [2.56, 0.24]], s * 0.935, 0.022), mats.frontEndplate);
      });
      addMesh(new THREE.BoxGeometry(0.32, 0.12, 0.52), mats.intakeDark, [0, 0.53, 0.08]);
      addDriverHelmet(0.66, 0.02, false);
      /* Tall 1990s multi-plane rear wing on deep endplates */
      addMesh(buildWingElement({ halfSpan: 0.52, zCenter: -2.24, zTip: -2.24, yCenter: 0.78, yTip: 0.78, chordCenter: 0.30, chordTip: 0.30, thick: 0.028, pitch: 0.22 }), mats.rearWingMain);
      addMesh(buildWingElement({ halfSpan: 0.51, zCenter: -2.40, zTip: -2.40, yCenter: 0.92, yTip: 0.92, chordCenter: 0.20, chordTip: 0.20, thick: 0.022, pitch: 0.44 }), mats.rearWingFlap);
      [-1, 1].forEach(function (s) {
        addMesh(buildVerticalPlate([[-2.02, 0.34], [-2.52, 0.34], [-2.52, 1.00], [-2.02, 1.00]], s * 0.525, 0.024), mats.rearEndplate);
        addMesh(new THREE.BoxGeometry(0.03, 0.026, 0.48), mats.rearEndplateCap, [s * 0.525, 1.01, -2.27]);
      });
      addMesh(new THREE.BoxGeometry(0.045, 0.10, 0.025), mats.rainLight, [0, 0.26, -2.28], null, false);
      addFourWheels(1.62, -1.58, 0.80, 0.80, 'slick_90s', mats.carbon);

    } else if (era === '2000s') {
      /* 2000s SCREAMING V10 ERA (Ferrari F2004) — HIGH RAISED NOSE, ARCHED WING, BARGEBOARDS, GROOVED TYRES */
      var body00 = [
        [ 2.64, 0.065, 0.28, 0.36, 2.2, 2.4], /* high narrow raised nose! */
        [ 2.15, 0.130, 0.26, 0.43, 2.3, 2.5],
        [ 1.55, 0.190, 0.21, 0.50, 2.4, 2.6],
        [ 0.88, 0.265, 0.15, 0.58, 2.5, 2.8],
        [ 0.15, 0.295, 0.14, 0.58, 2.5, 2.8],
        [-0.38, 0.285, 0.14, 0.68, 2.2, 2.6],
        [-1.08, 0.220, 0.15, 0.60, 2.0, 2.4],
        [-1.88, 0.130, 0.18, 0.44, 2.0, 2.2]
      ];
      addMesh(buildLoft(body00.map(function (s) { return superRing(s[0], 0, s[1], s[2], s[3], s[4], s[5], 22); }), true, true), mats.bodyMain);
      /* Tall triangular V10 airbox + T-cam */
      var air00 = [
        [-0.20, 0.125, 0.56, 1.03, 2.0, 2.2],
        [-0.56, 0.145, 0.54, 0.98, 2.0, 2.2],
        [-1.18, 0.105, 0.44, 0.78, 1.9, 2.0],
        [-1.82, 0.045, 0.32, 0.50, 1.8, 2.0]
      ];
      addMesh(buildLoft(air00.map(function (s) { return superRing(s[0], 0, s[1], s[2], s[3], s[4], s[5], 18); }), true, true), mats.airboxBody);
      addMesh(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 16), mats.intakeDark, [0, 0.90, -0.19], [Math.PI / 2, 0, 0]);
      addMesh(new THREE.BoxGeometry(0.26, 0.022, 0.05), mats.tcam, [0, 1.09, -0.26]);
      /* Curvy deeply undercut sidepods + iconic 2000s bargeboards & flip-up winglets! */
      [-1, 1].forEach(function (s) {
        var pod00 = [
          [ 0.58, s * 0.46, 0.17, 0.28, 0.54],
          [ 0.12, s * 0.52, 0.22, 0.20, 0.58],
          [-0.55, s * 0.49, 0.21, 0.17, 0.52],
          [-1.25, s * 0.34, 0.14, 0.16, 0.38],
          [-1.78, s * 0.17, 0.07, 0.18, 0.30]
        ];
        addMesh(buildLoft(pod00.map(function (r) { return superRing(r[0], r[1], r[2], r[3], r[4], 2.4, 2.2, 18); }), true, true), mats.sidepodBody);
        addMesh(new THREE.BoxGeometry(0.24, 0.16, 0.04), mats.intakeDark, [s * 0.46, 0.42, 0.59]);
        /* Sculpted bargeboard ahead of sidepod! */
        addMesh(buildVerticalPlate([[1.16, 0.14], [0.64, 0.14], [0.64, 0.44], [0.98, 0.36]], s * 0.42, 0.018), mats.frontWing2);
        /* Sidepod flip-up winglet & chimney */
        addMesh(new THREE.BoxGeometry(0.022, 0.24, 0.14), mats.sidepodSwoosh, [s * 0.72, 0.48, -0.78], [0, 0, s * -0.14]);
      });
      addMesh(new THREE.BoxGeometry(1.42, 0.04, 2.42), mats.carbon, [0, 0.11, -0.38]);
      /* Arched/waved 2000s front wing hanging from raised nose via twin pylons! */
      addMesh(buildWingElement({ halfSpan: 0.90, zCenter: 2.52, zTip: 2.42, yCenter: 0.11, yTip: 0.16, arch: 0.045, chordCenter: 0.28, chordTip: 0.26, thick: 0.026, pitch: 0.14 }), mats.frontWing1);
      addMesh(buildWingElement({ halfSpan: 0.88, zCenter: 2.34, zTip: 2.26, yCenter: 0.17, yTip: 0.22, arch: 0.040, chordCenter: 0.18, chordTip: 0.16, thick: 0.020, pitch: 0.28 }), mats.frontWing2);
      [-1, 1].forEach(function (s) {
        addMesh(new THREE.BoxGeometry(0.018, 0.22, 0.20), mats.bodyMain, [s * 0.06, 0.22, 2.42]);
        addMesh(buildVerticalPlate([[2.58, 0.10], [2.10, 0.10], [2.10, 0.34], [2.52, 0.25]], s * 0.905, 0.022), mats.frontEndplate);
      });
      addMesh(new THREE.BoxGeometry(0.32, 0.12, 0.50), mats.intakeDark, [0, 0.53, 0.08]);
      addDriverHelmet(0.66, 0.02, false);
      /* Clean wide 2000s rear wing (sculpted endplates matching F2004 profile) */
      addMesh(buildWingElement({ halfSpan: 0.49, zCenter: -2.18, zTip: -2.18, yCenter: 0.78, yTip: 0.78, chordCenter: 0.25, chordTip: 0.25, thick: 0.024, pitch: 0.22 }), mats.rearWingMain);
      addMesh(buildWingElement({ halfSpan: 0.48, zCenter: -2.33, zTip: -2.33, yCenter: 0.90, yTip: 0.90, chordCenter: 0.16, chordTip: 0.16, thick: 0.018, pitch: 0.44 }), mats.rearWingFlap);
      [-1, 1].forEach(function (s) {
        addMesh(buildVerticalPlate([[-2.02, 0.42], [-2.22, 0.34], [-2.42, 0.38], [-2.44, 0.95], [-2.02, 0.96]], s * 0.495, 0.020), mats.rearEndplate);
        addMesh(new THREE.BoxGeometry(0.028, 0.022, 0.42), mats.rearEndplateCap, [s * 0.495, 0.96, -2.23]);
      });
      addMesh(new THREE.BoxGeometry(0.045, 0.10, 0.025), mats.rainLight, [0, 0.26, -2.24], null, false);
      addFourWheels(1.66, -1.62, 0.79, 0.78, 'grooved_2000s', mats.carbon);

    } else if (era === '2010s') {
      /* 2010s TURBO-HYBRID ERA (Mercedes W09/W10) — HALO, LONG SHARK FIN, CASCADED FRONT WING, 13" PIRELLI OPEN RIMS */
      var body10 = [
        [ 2.78, 0.055, 0.22, 0.27, 2.0, 2.2],
        [ 2.25, 0.130, 0.22, 0.37, 2.2, 2.4],
        [ 1.65, 0.195, 0.19, 0.47, 2.4, 2.6],
        [ 0.98, 0.265, 0.15, 0.57, 2.5, 2.8],
        [ 0.25, 0.305, 0.14, 0.60, 2.5, 2.8],
        [-0.35, 0.295, 0.14, 0.68, 2.3, 2.6],
        [-1.15, 0.225, 0.16, 0.60, 2.0, 2.4],
        [-2.05, 0.125, 0.19, 0.42, 2.0, 2.2]
      ];
      addMesh(buildLoft(body10.map(function (s) { return superRing(s[0], 0, s[1], s[2], s[3], s[4], s[5], 22); }), true, true), mats.bodyMain);
      /* Airbox + LONG prominent 2010s shark fin! */
      var air10 = [
        [-0.18, 0.128, 0.58, 0.99, 2.0, 2.2],
        [-0.60, 0.145, 0.54, 0.96, 2.0, 2.2],
        [-1.30, 0.095, 0.44, 0.80, 1.9, 2.0],
        [-1.96, 0.042, 0.34, 0.52, 1.8, 2.0]
      ];
      addMesh(buildLoft(air10.map(function (s) { return superRing(s[0], 0, s[1], s[2], s[3], s[4], s[5], 18); }), true, true), mats.airboxBody);
      addMesh(new THREE.CylinderGeometry(0.08, 0.08, 0.07, 16), mats.intakeDark, [0, 0.87, -0.18], [Math.PI / 2, 0, 0]);
      addMesh(buildVerticalPlate([[-0.50, 0.97], [-1.92, 0.92], [-2.06, 0.52], [-2.06, 0.42], [-0.50, 0.62]], 0, 0.020), mats.sharkFin);
      addMesh(buildVerticalPlate([[-0.52, 0.98], [-1.92, 0.93], [-1.92, 0.89], [-0.52, 0.94]], 0, 0.024), mats.sharkFinEdge);
      addMesh(new THREE.BoxGeometry(0.28, 0.024, 0.05), mats.tcam, [0, 1.08, -0.24]);
      /* Tight sculpted sidepods + 2010s complex floor bargeboards */
      [-1, 1].forEach(function (s) {
        var pod10 = [
          [ 0.60, s * 0.46, 0.16, 0.30, 0.54],
          [ 0.08, s * 0.53, 0.22, 0.20, 0.58],
          [-0.65, s * 0.46, 0.19, 0.17, 0.50],
          [-1.40, s * 0.28, 0.12, 0.17, 0.38],
          [-1.92, s * 0.14, 0.06, 0.19, 0.30]
        ];
        addMesh(buildLoft(pod10.map(function (r) { return superRing(r[0], r[1], r[2], r[3], r[4], 2.4, 2.2, 18); }), true, true), mats.sidepodBody);
        /* Flowing 2010s sidepod accent livery stripe (e.g. Mercedes Petronas teal wave) */
        var sw10 = [
          [ 0.56, s * 0.625, 0.016, 0.38, 0.44],
          [ 0.08, s * 0.755, 0.016, 0.34, 0.40],
          [-0.65, s * 0.655, 0.015, 0.28, 0.34],
          [-1.35, s * 0.408, 0.013, 0.23, 0.28]
        ];
        addMesh(buildLoft(sw10.map(function (r) { return superRing(r[0], r[1], r[2], r[3], r[4], 2.0, 2.0, 12); }), true, true), mats.sidepodSwoosh);
        addMesh(new THREE.BoxGeometry(0.22, 0.12, 0.04), mats.intakeDark, [s * 0.46, 0.44, 0.60]);
        addMesh(buildVerticalPlate([[1.12, 0.13], [0.58, 0.13], [0.58, 0.42], [0.95, 0.30]], s * 0.48, 0.018), mats.carbon);
      });
      addMesh(new THREE.BoxGeometry(1.56, 0.04, 2.72), mats.carbon, [0, 0.11, -0.45]);
      /* Cockpit + Year-Accurate HALO (Halo introduced in 2018; NO Halo in 2009-2017!) */
      addMesh(new THREE.BoxGeometry(0.32, 0.12, 0.52), mats.intakeDark, [0, 0.54, 0.06]);
      addDriverHelmet(0.66, -0.02, false);
      if (exactYear >= 2018) {
        var hPil10 = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.56, 0.72), new THREE.Vector3(0, 0.74, 0.60), new THREE.Vector3(0, 0.80, 0.46)]);
        addMesh(new THREE.TubeGeometry(hPil10, 12, 0.022, 8, false), mats.halo);
        [-1, 1].forEach(function (s) {
          var hp = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.80, 0.46), new THREE.Vector3(s * 0.18, 0.81, 0.34), new THREE.Vector3(s * 0.25, 0.78, 0.06), new THREE.Vector3(s * 0.22, 0.67, -0.24)]);
          addMesh(new THREE.TubeGeometry(hp, 18, 0.024, 8, false), mats.halo);
        });
      }
      /* 2017 Iconic Coat-Hanger T-Wing atop Shark Fin (SF70H / W08)! */
      if (exactYear === 2017) {
        addMesh(new THREE.BoxGeometry(0.72, 0.018, 0.09), mats.sharkFinEdge, [0, 0.99, -1.86]);
      }
      /* Year-accurate Front & Rear Wing proportions:
         2009-2016 = Super-wide low front wing + TALL NARROW rectangular rear wing!
         2017-2021 = Swept delta front wing + WIDE LOW angled rear wing! */
      var isTallNarrowRear = (exactYear >= 2009 && exactYear <= 2016);
      var rwSpan10 = isTallNarrowRear ? 0.38 : 0.53;
      var rwYMain10 = isTallNarrowRear ? 0.86 : 0.73;
      var rwYFlap10 = isTallNarrowRear ? 1.01 : 0.89;
      addMesh(buildWingElement({ halfSpan: isTallNarrowRear ? 0.96 : 0.99, zCenter: 2.66, zTip: isTallNarrowRear ? 2.62 : 2.52, yCenter: 0.12, yTip: 0.11, chordCenter: 0.28, chordTip: 0.26, thick: 0.026, pitch: 0.10 }), mats.frontWing1);
      addMesh(buildWingElement({ halfSpan: isTallNarrowRear ? 0.95 : 0.98, zCenter: 2.48, zTip: isTallNarrowRear ? 2.45 : 2.36, yCenter: 0.17, yTip: 0.16, chordCenter: 0.20, chordTip: 0.18, thick: 0.020, pitch: 0.22 }), mats.frontWing2);
      addMesh(buildWingElement({ halfSpan: isTallNarrowRear ? 0.93 : 0.96, zCenter: 2.33, zTip: isTallNarrowRear ? 2.30 : 2.22, yCenter: 0.23, yTip: 0.22, chordCenter: 0.15, chordTip: 0.14, thick: 0.018, pitch: 0.34 }), mats.frontWing3);
      [-1, 1].forEach(function (s) {
        addMesh(buildVerticalPlate([[2.68, 0.09], [2.14, 0.09], [2.14, 0.33], [2.62, 0.22]], s * (isTallNarrowRear ? 0.965 : 0.995), 0.022), mats.frontEndplate);
      });
      addMesh(buildWingElement({ halfSpan: rwSpan10, zCenter: -2.34, zTip: -2.34, yCenter: rwYMain10, yTip: rwYMain10, chordCenter: 0.25, chordTip: 0.25, thick: 0.024, pitch: 0.20 }), mats.rearWingMain);
      var drsPivot10 = new THREE.Group();
      drsPivot10.position.set(0, rwYFlap10, -2.54);
      var drsMesh10 = new THREE.Mesh(
        buildWingElement({ halfSpan: rwSpan10 - 0.01, zCenter: 0.06, zTip: 0.06, yCenter: -0.04, yTip: -0.04, chordCenter: 0.17, chordTip: 0.17, thick: 0.020, pitch: 0.46 }),
        mats.rearWingFlap
      );
      drsMesh10.castShadow = true;
      drsPivot10.add(drsMesh10);
      root.add(drsPivot10);
      root.userData.drsFlap = drsPivot10;
      var rwTop10 = isTallNarrowRear ? 1.06 : 0.91;
      [-1, 1].forEach(function (s) {
        addMesh(buildVerticalPlate([[-2.18, 0.44], [-2.36, 0.32], [-2.52, 0.36], [-2.58, rwTop10], [-2.22, rwTop10]], s * (rwSpan10 + 0.005), 0.020), mats.rearEndplate);
        addMesh(new THREE.BoxGeometry(0.028, 0.022, 0.36), mats.rearEndplateCap, [s * (rwSpan10 + 0.005), rwTop10 + 0.01, -2.40]);
      });
      addMesh(new THREE.BoxGeometry(0.045, 0.11, 0.025), mats.rainLight, [0, 0.26, -2.38], null, false);
      addFourWheels(1.74, -1.80, 0.82, 0.79, 'pirelli_2010s', mats.carbon);

    } else {
    /* =================================================================
       2020s MODERN GROUND-EFFECT F1 CAR (18" Aero Covers, Wake Brows, Venturi Floor)
       ================================================================= */
    var floorShape = new THREE.Shape();
    floorShape.moveTo(0, 1.32);           /* front bib / tea-tray */
    floorShape.lineTo(0.24, 1.22);
    floorShape.lineTo(0.32, 0.92);
    floorShape.lineTo(0.76, 0.78);        /* floor fence leading edge */
    floorShape.lineTo(0.80, 0.25);
    floorShape.lineTo(0.79, -0.82);       /* floor edge */
    floorShape.lineTo(0.68, -1.32);       /* rear tyre squirt cutout */
    floorShape.lineTo(0.46, -1.48);
    floorShape.lineTo(0.46, -2.26);       /* diffuser sides */
    floorShape.lineTo(0, -2.32);
    floorShape.lineTo(-0.46, -2.26);
    floorShape.lineTo(-0.46, -1.48);
    floorShape.lineTo(-0.68, -1.32);
    floorShape.lineTo(-0.79, -0.82);
    floorShape.lineTo(-0.80, 0.25);
    floorShape.lineTo(-0.76, 0.78);
    floorShape.lineTo(-0.32, 0.92);
    floorShape.lineTo(-0.24, 1.22);
    floorShape.closePath();

    var floorGeo = new THREE.ExtrudeGeometry(floorShape, {
      depth: 0.042, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2
    });
    floorGeo.rotateX(Math.PI / 2);
    addMesh(floorGeo, mats.carbon, [0, 0.115, 0]);

    /* Floor edge accent wing strakes (left & right) */
    [-1, 1].forEach(function (s) {
      var edgeGeo = new THREE.BoxGeometry(0.035, 0.038, 1.72);
      addMesh(edgeGeo, mats.detail, [s * 0.79, 0.125, -0.18]);
      /* Front floor Venturi fences */
      for (var f = 0; f < 2; f++) {
        var fence = new THREE.BoxGeometry(0.014, 0.16, 0.36);
        addMesh(fence, mats.carbon, [s * (0.42 + f * 0.20), 0.19, 0.74], [0, s * -0.12, 0]);
      }
      /* Rear diffuser vertical strakes */
      addMesh(new THREE.BoxGeometry(0.018, 0.15, 0.45), mats.carbon, [s * 0.22, 0.17, -2.08]);
      addMesh(new THREE.BoxGeometry(0.018, 0.17, 0.48), mats.carbon, [s * 0.44, 0.18, -2.06]);
    });

    /* Rear crash structure + FIA glowing red rain light */
    addMesh(new THREE.BoxGeometry(0.14, 0.18, 0.46), mats.carbon, [0, 0.26, -2.26]);
    addMesh(new THREE.BoxGeometry(0.045, 0.11, 0.025), mats.rainLight, [0, 0.26, -2.495], null, false);

    /* =================================================================
       2. SCULPTED MONOCOQUE, NOSECONE & ENGINE COVER (Central Loft)
       ================================================================= */
    var segs = 24;
    var bodySpec = [
      /* z,      hw,   yBot, yTop, pTop, pBot */
      [ 2.74,  0.045, 0.19, 0.23, 2.0, 2.0], /* nose spatula tip */
      [ 2.52,  0.095, 0.18, 0.26, 2.2, 2.4],
      [ 2.15,  0.140, 0.19, 0.34, 2.3, 2.6],
      [ 1.65,  0.195, 0.18, 0.46, 2.4, 2.8], /* front axle bulkhead */
      [ 1.12,  0.260, 0.15, 0.56, 2.5, 3.0],
      [ 0.65,  0.305, 0.14, 0.62, 2.6, 3.0], /* cockpit front */
      [ 0.15,  0.315, 0.14, 0.60, 2.6, 3.0], /* cockpit mid */
      [-0.35,  0.305, 0.14, 0.68, 2.4, 2.8], /* cockpit rear / roll hoop base */
      [-0.85,  0.275, 0.15, 0.72, 2.1, 2.6], /* engine cover mid */
      [-1.40,  0.215, 0.16, 0.60, 2.0, 2.4], /* coke-bottle taper */
      [-1.88,  0.140, 0.18, 0.46, 2.0, 2.2], /* rear gearbox casing */
      [-2.24,  0.085, 0.21, 0.34, 2.0, 2.0]  /* rear cooling exit */
    ];
    var bodySections = bodySpec.map(function (s) {
      return superRing(s[0], 0, s[1], s[2], s[3], s[4], s[5], segs);
    });
    addMesh(buildLoft(bodySections, true, true), mats.main);

    /* Sleek nose & engine-cover livery accent spine (thin offset loft on top of nose) */
    var stripeSpec = [
      [ 2.64,  0.030, 0.228, 0.244, 2.0, 2.0],
      [ 2.20,  0.055, 0.305, 0.335, 2.0, 2.0],
      [ 1.65,  0.082, 0.435, 0.468, 2.0, 2.0],
      [ 1.02,  0.105, 0.542, 0.576, 2.0, 2.0],
      [ 0.66,  0.115, 0.595, 0.628, 2.0, 2.0]
    ];
    addMesh(buildLoft(stripeSpec.map(function (s) {
      return superRing(s[0], 0, s[1], s[2], s[3], s[4], s[5], 14);
    }), true, true), mats.noseStripe);

    /* Subtle nosecone tip sleeve for chevron / two-tone colour-block liveries */
    var noseCapSpec = [
      [ 2.745, 0.047, 0.188, 0.233, 2.0, 2.0],
      [ 2.52,  0.098, 0.178, 0.263, 2.2, 2.4],
      [ 2.18,  0.140, 0.190, 0.338, 2.3, 2.6]
    ];
    noseCapMesh = addMesh(buildLoft(noseCapSpec.map(function (s) {
      return superRing(s[0], 0, s[1], s[2], s[3], s[4], s[5], 20);
    }), true, true), mats.noseTip);

    /* Signature Red Bull charging-bull solar disc nosecone emblem (shown for 'redbull' style) */
    var bullTex = makeBullNoseTexture();
    var bullMat = new THREE.MeshBasicMaterial({ map: bullTex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    bullDecalMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.24), bullMat);
    bullDecalMesh.position.set(0, 0.382, 2.02);
    bullDecalMesh.rotation.x = -Math.PI / 2 + 0.22;
    bullDecalMesh.visible = false;
    root.add(bullDecalMesh);

    /* Signature Ferrari 2025/2026 HP white engine-cover diagonal band + blue trim collar */
    var fBandGroup = new THREE.Group();
    var fWhitePanel = new THREE.Mesh(
      buildLoft([
        superRing(-0.22, 0, 0.162, 0.62, 0.995, 2.0, 2.2, 18),
        superRing(-0.74, 0, 0.148, 0.56, 0.925, 2.0, 2.2, 18),
        superRing(-1.02, 0, 0.125, 0.52, 0.855, 1.9, 2.0, 18)
      ], true, true),
      mats.sidepodLower
    );
    var fBlueTrim = new THREE.Mesh(
      buildLoft([
        superRing(-0.98, 0, 0.128, 0.53, 0.865, 1.9, 2.0, 18),
        superRing(-1.12, 0, 0.114, 0.50, 0.822, 1.9, 2.0, 18)
      ], true, true),
      mats.sidepodSwoosh
    );
    fBandGroup.add(fWhitePanel);
    fBandGroup.add(fBlueTrim);
    fBandGroup.visible = false;
    ferrariBandMesh = fBandGroup;
    root.add(fBandGroup);

    /* Signature Williams Duracell copper-top airbox ring (shown for 'williams_duracell' style) */
    var durCap = new THREE.Mesh(
      buildLoft([
        superRing(-0.17, 0, 0.136, 0.80, 0.996, 2.0, 2.0, 18),
        superRing(-0.46, 0, 0.158, 0.78, 0.978, 2.0, 2.0, 18)
      ], true, true),
      mats.airboxRim
    );
    durCap.visible = false;
    duracellCapMesh = durCap;
    root.add(durCap);

    /* Bespoke 3-Ribbon Parallel Racing Stripes (Martini Tricolour & Gulf Heritage) */
    var triGrp = new THREE.Group();
    [-0.072, 0.072].forEach(function (xOff) {
      var sideRib = buildLoft([
        superRing(2.58, xOff * 0.45, 0.018, 0.236, 0.252, 2.0, 2.0, 10),
        superRing(2.08, xOff * 0.72, 0.020, 0.332, 0.354, 2.0, 2.0, 10),
        superRing(1.50, xOff * 0.95, 0.022, 0.468, 0.494, 2.0, 2.0, 10),
        superRing(0.85, xOff * 1.15, 0.024, 0.576, 0.606, 2.0, 2.0, 10)
      ], true, true);
      triGrp.add(new THREE.Mesh(sideRib, mats.sidepodSwoosh));
    });
    triGrp.visible = false;
    triStripeMesh = triGrp;
    root.add(triGrp);

    /* Bespoke Razor-Thin Pinstripe Rail Kit (Lotus JPS Gold / Aston Lime / Carbon Stealth / Brawn Neon) */
    var pinGrp = new THREE.Group();
    [-1, 1].forEach(function (side) {
      /* Floor outer edge razor pinstripe */
      var flPin = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 2.32), mats.sidepodSwoosh);
      flPin.position.set(side * 0.795, 0.095, -0.22);
      pinGrp.add(flPin);
      /* Upper sidepod ridge razor pinstripe */
      var podPin = new THREE.Mesh(
        buildLoft([
          superRing(0.56, side * 0.50, 0.014, 0.545, 0.568, 2.0, 2.0, 8),
          superRing(0.02, side * 0.58, 0.014, 0.582, 0.604, 2.0, 2.0, 8),
          superRing(-0.68, side * 0.49, 0.014, 0.512, 0.532, 2.0, 2.0, 8),
          superRing(-1.32, side * 0.34, 0.012, 0.402, 0.422, 2.0, 2.0, 8)
        ], true, true),
        mats.airboxRim
      );
      pinGrp.add(podPin);
      /* Nose flank fine pinstripe */
      var nPin = new THREE.Mesh(
        buildLoft([
          superRing(2.58, side * 0.088, 0.010, 0.225, 0.242, 2.0, 2.0, 8),
          superRing(1.75, side * 0.188, 0.012, 0.345, 0.368, 2.0, 2.0, 8),
          superRing(1.02, side * 0.268, 0.012, 0.455, 0.480, 2.0, 2.0, 8)
        ], true, true),
        mats.sidepodSwoosh
      );
      pinGrp.add(nPin);
    });
    pinGrp.visible = false;
    pinstripeMesh = pinGrp;
    root.add(pinGrp);

    /* Bespoke Angled Chevron Canopy (McLaren Marlboro Day-Glo / Jordan Hornet / Renault Mild Seven) */
    var chevGrp = new THREE.Group();
    var chevBody = new THREE.Mesh(
      buildLoft([
        superRing(0.68, 0, 0.312, 0.42, 0.630, 2.5, 2.8, 18),
        superRing(-0.20, 0, 0.318, 0.46, 0.695, 2.4, 2.6, 18),
        superRing(-0.88, 0, 0.282, 0.48, 0.735, 2.1, 2.4, 18),
        superRing(-1.45, 0, 0.218, 0.38, 0.610, 2.0, 2.2, 18)
      ], true, true),
      mats.sidepodLower
    );
    chevGrp.add(chevBody);
    chevGrp.visible = false;
    chevronCanopyMesh = chevGrp;
    root.add(chevGrp);

    /* Nose pitot sensor */
    addMesh(new THREE.CylinderGeometry(0.005, 0.006, 0.14, 6), mats.chrome, [0, 0.56, 1.32]);

    /* =================================================================
       3. SCULPTED DOWNWASH SIDEPODS (Left & Right Lofts + Undercut)
       ================================================================= */
    [-1, 1].forEach(function (side) {
      var podSpec = [
        /* z,     xCenter,      hw,   yBot, yTop */
        [ 0.62,  side * 0.48, 0.15, 0.36, 0.55], /* sculpted inlet mouth */
        [ 0.38,  side * 0.55, 0.22, 0.26, 0.60], /* wide front shoulder + undercut */
        [-0.08,  side * 0.54, 0.23, 0.21, 0.59], /* mid downwash */
        [-0.65,  side * 0.47, 0.21, 0.18, 0.52], /* sweeping down */
        [-1.20,  side * 0.35, 0.16, 0.17, 0.42], /* coke-bottle tuck */
        [-1.68,  side * 0.20, 0.09, 0.18, 0.33]  /* rear blend into engine cover */
      ];
      var podRings = podSpec.map(function (s) {
        return superRing(s[0], s[1], s[2], s[3], s[4], 2.5, 2.2, 20);
      });
      addMesh(buildLoft(podRings, true, true), mats.sidepodBody);

      /* Sidepod lower secondary colour skirt / undercut trim */
      var skirtSpec = [
        [ 0.42,  side * 0.53, 0.19, 0.16, 0.29],
        [-0.10,  side * 0.52, 0.20, 0.14, 0.26],
        [-0.75,  side * 0.44, 0.17, 0.13, 0.24],
        [-1.35,  side * 0.30, 0.12, 0.13, 0.22]
      ];
      addMesh(buildLoft(skirtSpec.map(function (s) {
        return superRing(s[0], s[1], s[2], s[3], s[4], 2.4, 2.4, 16);
      }), true, true), mats.sidepodLower);

      /* Dynamic sidepod accent swoosh ribbon hugging the outer sidepod flank */
      var swooshSpec = [
        [ 0.36, side * 0.768, 0.018, 0.44, 0.50],
        [-0.04, side * 0.780, 0.018, 0.39, 0.46],
        [-0.58, side * 0.692, 0.016, 0.32, 0.38],
        [-1.14, side * 0.528, 0.014, 0.25, 0.30],
        [-1.56, side * 0.340, 0.012, 0.22, 0.26]
      ];
      addMesh(buildLoft(swooshSpec.map(function (s) {
        return superRing(s[0], s[1], s[2], s[3], s[4], 2.0, 2.0, 12);
      }), true, true), mats.sidepodSwoosh);

      /* Recessed dark radiator inlet cavity + sleek curved accent brow */
      var mouth = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.115, 0.05), mats.intakeDark);
      mouth.position.set(side * 0.48, 0.46, 0.585);
      mouth.rotation.y = side * -0.18;
      root.add(mouth);

      var lip = new THREE.Mesh(new THREE.TorusGeometry(0.098, 0.016, 8, 22), mats.airboxRim);
      lip.scale.set(1.38, 0.62, 0.55);
      lip.position.set(side * 0.48, 0.46, 0.605);
      lip.rotation.y = side * -0.18;
      root.add(lip);

      /* Aerodynamic wing mirrors + stalks */
      addMesh(new THREE.BoxGeometry(0.16, 0.012, 0.022), mats.carbon, [side * 0.45, 0.635, 0.46], [0, 0, side * 0.14]);
      addMesh(new THREE.BoxGeometry(0.145, 0.044, 0.064), mats.mirrorCap, [side * 0.54, 0.66, 0.46], [0, side * -0.14, 0]);
      addMesh(new THREE.BoxGeometry(0.125, 0.013, 0.066), mats.mirrorAccent, [side * 0.54, 0.682, 0.46], [0, side * -0.14, 0]);
    });

    /* =================================================================
       4. ROLL-HOOP AIRBOX, SHARK FIN & T-CAM
       ================================================================= */
    var airboxSpec = [
      [-0.18, 0.132, 0.58, 0.99, 2.0, 2.2], /* roll hoop intake smoothly rooted into spine */
      [-0.50, 0.155, 0.56, 0.97, 2.0, 2.2],
      [-0.98, 0.122, 0.52, 0.87, 1.9, 2.0],
      [-1.50, 0.072, 0.44, 0.70, 1.8, 2.0],
      [-1.96, 0.036, 0.34, 0.50, 1.8, 2.0]
    ];
    addMesh(buildLoft(airboxSpec.map(function (s) {
      return superRing(s[0], 0, s[1], s[2], s[3], s[4], s[5], 18);
    }), true, true), mats.airboxBody);

    /* Dark airbox scoop + vivid accent surround rim (Audi R26 style!) */
    var scoopDark = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.08, 16), mats.intakeDark);
    scoopDark.rotation.x = Math.PI / 2;
    scoopDark.scale.set(1.06, 1.0, 1.24);
    scoopDark.position.set(0, 0.875, -0.185);
    root.add(scoopDark);

    var scoopRim = new THREE.Mesh(new THREE.TorusGeometry(0.092, 0.017, 10, 24), mats.airboxRim);
    scoopRim.scale.set(1.08, 1.24, 0.75);
    scoopRim.position.set(0, 0.875, -0.16);
    root.add(scoopRim);

    /* Shark fin spine along rear engine cover (world Z: -0.58 to -1.96) */
    addMesh(buildVerticalPlate([
      [-0.56, 0.95],
      [-1.62, 0.84],
      [-1.98, 0.52],
      [-1.98, 0.40],
      [-0.56, 0.62]
    ], 0, 0.022), mats.sharkFin);
    /* Accent top edge trim along shark fin */
    addMesh(buildVerticalPlate([
      [-0.58, 0.96],
      [-1.62, 0.85],
      [-1.66, 0.81],
      [-0.58, 0.91]
    ], 0, 0.026), mats.sharkFinEdge);

    /* Overhead T-Cam */
    addMesh(new THREE.BoxGeometry(0.030, 0.095, 0.060), mats.carbon, [0, 1.03, -0.26]);
    addMesh(new THREE.BoxGeometry(0.28, 0.024, 0.052), mats.tcam, [0, 1.085, -0.26]);
    addMesh(new THREE.BoxGeometry(0.045, 0.030, 0.058), mats.carbon, [0.145, 1.085, -0.26]);
    addMesh(new THREE.BoxGeometry(0.045, 0.030, 0.058), mats.carbon, [-0.145, 1.085, -0.26]);

    /* =================================================================
       5. COCKPIT, DRIVER HELMET & TITANIUM HALO
       ================================================================= */
    var cockpitRecess = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.52), mats.intakeDark);
    cockpitRecess.position.set(0, 0.545, 0.06);
    root.add(cockpitRecess);

    /* Driver helmet + visor */
    var helmetGroup = new THREE.Group();
    helmetGroup.position.set(0, 0.66, -0.02);
    var hShell = new THREE.Mesh(new THREE.SphereGeometry(0.130, 22, 18), mats.helmet);
    hShell.scale.set(0.92, 0.95, 1.12);
    helmetGroup.add(hShell);
    var hStripe = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.245, 0.27), mats.helmetStripe);
    hStripe.position.set(0, 0.015, -0.01);
    helmetGroup.add(hStripe);
    var visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.133, 20, 12, -Math.PI * 0.34, Math.PI * 0.68, Math.PI * 0.34, Math.PI * 0.24),
      mats.visor
    );
    visor.rotation.y = Math.PI * 0.5;
    visor.scale.set(1.13, 0.95, 0.93);
    helmetGroup.add(visor);
    root.add(helmetGroup);

    /* Halo: front pillar + left/right swept hoops */
    var haloPillar = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.56, 0.72),
      new THREE.Vector3(0, 0.74, 0.60),
      new THREE.Vector3(0, 0.80, 0.46)
    ]);
    addMesh(new THREE.TubeGeometry(haloPillar, 14, 0.022, 10, false), mats.halo);

    [-1, 1].forEach(function (s) {
      var hoop = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.80, 0.46),
        new THREE.Vector3(s * 0.18, 0.81, 0.34),
        new THREE.Vector3(s * 0.25, 0.78, 0.06),
        new THREE.Vector3(s * 0.22, 0.67, -0.24)
      ]);
      addMesh(new THREE.TubeGeometry(hoop, 22, 0.024, 10, false), mats.halo);
    });

    /* =================================================================
       6. MULTI-ELEMENT CURVED FRONT WING & MODERN ENDPLATES
       ================================================================= */
    /* Mainplane (lowest, widest, subtle spoon arch) */
    addMesh(buildWingElement({
      halfSpan: 0.97, zCenter: 2.66, zTip: 2.38, yCenter: 0.125, yTip: 0.105,
      arch: 0.026, chordCenter: 0.28, chordTip: 0.25, thick: 0.028, pitch: 0.08
    }), mats.frontWing1);

    /* 2nd flap */
    addMesh(buildWingElement({
      halfSpan: 0.96, zCenter: 2.48, zTip: 2.24, yCenter: 0.168, yTip: 0.152,
      arch: 0.024, chordCenter: 0.20, chordTip: 0.18, thick: 0.022, pitch: 0.20
    }), mats.frontWing2);

    /* 3rd upper flap */
    addMesh(buildWingElement({
      halfSpan: 0.94, zCenter: 2.34, zTip: 2.13, yCenter: 0.218, yTip: 0.202,
      arch: 0.020, chordCenter: 0.15, chordTip: 0.14, thick: 0.018, pitch: 0.32
    }), mats.frontWing3);

    /* Front wing nose pylons + sculpted swept modern endplates */
    [-1, 1].forEach(function (s) {
      addMesh(new THREE.BoxGeometry(0.018, 0.12, 0.18), mats.carbon, [s * 0.065, 0.18, 2.52]);

      /* Modern curved upward-sweeping endplate aligned directly at z = 2.02..2.52 */
      addMesh(buildVerticalPlate([
        [2.52, 0.085],
        [2.04, 0.095],
        [2.02, 0.34],
        [2.26, 0.32],
        [2.44, 0.18]
      ], s * 0.975, 0.022), mats.frontEndplate);

      /* Endplate outer diveplane winglet */
      addMesh(new THREE.BoxGeometry(0.048, 0.016, 0.26), mats.frontDiveplane, [s * 1.00, 0.23, 2.22], [0.22, 0, s * -0.18]);
    });

    /* =================================================================
       7. DUAL-ELEMENT REAR WING, DRS ACTUATOR & BEAM WING
       ================================================================= */
    /* Main rear wing plane */
    addMesh(buildWingElement({
      halfSpan: 0.50, zCenter: -2.38, zTip: -2.38, yCenter: 0.78, yTip: 0.82,
      arch: -0.018, chordCenter: 0.28, chordTip: 0.24, thick: 0.028, pitch: 0.20
    }), mats.rearWingMain);

    /* Upper DRS flap (hinged pivot at upper trailing edge so DRS physically opens!) */
    var drsPivot20 = new THREE.Group();
    drsPivot20.position.set(0, 0.94, -2.60);
    var drsMesh20 = new THREE.Mesh(
      buildWingElement({
        halfSpan: 0.49, zCenter: 0.06, zTip: 0.06, yCenter: -0.04, yTip: -0.02,
        arch: -0.012, chordCenter: 0.19, chordTip: 0.17, thick: 0.022, pitch: 0.48
      }),
      mats.rearWingFlap
    );
    drsMesh20.castShadow = true;
    drsPivot20.add(drsMesh20);
    root.add(drsPivot20);
    root.userData.drsFlap = drsPivot20;

    /* Lower beam wing above diffuser */
    addMesh(buildWingElement({
      halfSpan: 0.46, zCenter: -2.34, zTip: -2.36, yCenter: 0.36, yTip: 0.38,
      arch: 0, chordCenter: 0.20, chordTip: 0.18, thick: 0.020, pitch: 0.24
    }), mats.carbon);

    /* Central swan-neck rear wing pylon (exact world Z plate) + DRS actuator pod */
    addMesh(buildVerticalPlate([
      [-2.14, 0.30],
      [-2.32, 0.30],
      [-2.42, 0.89],
      [-2.26, 0.88],
      [-2.22, 0.62]
    ], 0, 0.024), mats.carbon);
    addMesh(new THREE.BoxGeometry(0.048, 0.068, 0.20), mats.bodyMain, [0, 0.905, -2.44]);

    /* Rear wing curved endplates aligned directly at z = -2.20..-2.66 */
    [-1, 1].forEach(function (s) {
      addMesh(buildVerticalPlate([
        [-2.24, 0.32],
        [-2.54, 0.32],
        [-2.66, 0.96],
        [-2.24, 0.96],
        [-2.18, 0.62]
      ], s * 0.505, 0.022), mats.rearEndplate);

      /* Accent strip cleanly capping rear endplate upper edge (no z-fighting) */
      addMesh(new THREE.BoxGeometry(0.032, 0.032, 0.42), mats.rearEndplateCap, [s * 0.505, 0.976, -2.45]);
    });

    /* =================================================================
       8. DOUBLE-WISHBONE SUSPENSION, PUSHRODS & WHEEL WAKE BROWS
       ================================================================= */
    var zFront = 1.72;
    var zRear = -1.78;
    var xFront = 0.82;
    var xRear = 0.785;

    [-1, 1].forEach(function (s) {
      /* Front suspension A-arms + pushrod */
      var fHubTop = [s * (xFront - 0.16), 0.45, zFront];
      var fHubBot = [s * (xFront - 0.16), 0.25, zFront];
      root.add(buildStrut([s * 0.17, 0.44, zFront + 0.24], fHubTop, 0.012, mats.carbon));
      root.add(buildStrut([s * 0.22, 0.46, zFront - 0.22], fHubTop, 0.012, mats.carbon));
      root.add(buildStrut([s * 0.15, 0.22, zFront + 0.22], fHubBot, 0.012, mats.carbon));
      root.add(buildStrut([s * 0.20, 0.21, zFront - 0.24], fHubBot, 0.012, mats.carbon));
      /* Front pullrod / pushrod diagonal */
      root.add(buildStrut([s * 0.18, 0.45, zFront - 0.04], fHubBot, 0.010, mats.carbon));
      /* Steering trackrod */
      root.add(buildStrut([s * 0.18, 0.34, zFront + 0.06], [s * (xFront - 0.16), 0.35, zFront + 0.06], 0.009, mats.chrome));

      /* Front brake duct + over-wheel wake deflector brow (present on 2022-2025 ground-effect cars; REMOVED in 2026 Active-Aero regulations!) */
      addMesh(new THREE.BoxGeometry(0.06, 0.22, 0.24), mats.carbon, [s * (xFront - 0.17), 0.36, zFront]);
      if (exactYear < 2026) {
        var browSpec = [
          [zFront + 0.26, s * (xFront - 0.16), 0.045, 0.56, 0.59],
          [zFront + 0.06, s * (xFront - 0.14), 0.052, 0.72, 0.75],
          [zFront - 0.22, s * (xFront - 0.16), 0.045, 0.62, 0.65]
        ];
        addMesh(buildLoft(browSpec.map(function (b) {
          return superRing(b[0], b[1], b[2], b[3], b[4], 2.0, 2.0, 10);
        }), true, true), mats.carbon);
      } else {
        /* 2026 Active-Aero front wing inboard footplate & actuator pod */
        addMesh(new THREE.BoxGeometry(0.036, 0.032, 0.26), mats.frontDiveplane, [s * 0.42, 0.20, 2.40]);
      }

      /* Rear suspension A-arms + pushrod + driveshaft */
      var rHubTop = [s * (xRear - 0.21), 0.45, zRear];
      var rHubBot = [s * (xRear - 0.21), 0.25, zRear];
      root.add(buildStrut([s * 0.16, 0.42, zRear + 0.30], rHubTop, 0.013, mats.carbon));
      root.add(buildStrut([s * 0.10, 0.36, zRear - 0.28], rHubTop, 0.013, mats.carbon));
      root.add(buildStrut([s * 0.18, 0.22, zRear + 0.26], rHubBot, 0.013, mats.carbon));
      root.add(buildStrut([s * 0.10, 0.20, zRear - 0.26], rHubBot, 0.013, mats.carbon));
      root.add(buildStrut([s * 0.14, 0.44, zRear + 0.12], rHubBot, 0.011, mats.carbon));
      root.add(buildStrut([s * 0.12, 0.33, zRear], [s * (xRear - 0.18), 0.35, zRear], 0.014, mats.chrome));
    });

    /* =================================================================
       9. FOUR 18-INCH SLICK WHEELS (Y = 0.36 so tyres rest cleanly at Y = 0)
       ================================================================= */
    var wheelPositions = [
      { pos: [ xFront, 0.36, zFront], rear: false },
      { pos: [-xFront, 0.36, zFront], rear: false },
      { pos: [ xRear,  0.36, zRear],  rear: true  },
      { pos: [-xRear,  0.36, zRear],  rear: true  }
    ];
    root.userData.wheels = root.userData.wheels || [];
    root.userData.tyreRingMat = mats.tyreRing;
    wheelPositions.forEach(function (w) {
      var wg = buildWheel(w.rear, mats);
      wg.position.set(w.pos[0], w.pos[1], w.pos[2]);
      wg.rotation.order = 'YXZ';
      wg.userData.isFront = !w.rear;
      wg.userData.radius = 0.36;
      root.userData.wheels.push(wg);
      root.add(wg);
    });
    } /* end era === '2020s' branch */

    /* Apply a 5-colour team palette + signature livery pattern style + paint finish:
       styles: modern | two-tone | racing-stripe | chevron | classic |
               redbull | ferrari_hp | merc_arrow | williams_duracell | audi_slash | cadillac_split
       finish: gloss | matte | metallic | carbon */
    function setPalette(pal, style, finish) {
      pal = pal || {};
      var st = (style || root.userData.style || 'modern').toLowerCase();
      var fin = (finish || pal.finish || root.userData.finish || (st === 'redbull' ? 'matte' : (st === 'merc_arrow' || st === 'audi_slash' ? 'metallic' : 'gloss'))).toLowerCase();
      root.userData.style = st;
      root.userData.finish = fin;

      var cMain = parseColor(pal.main || pal.primary, '#ff8000');
      var cSec  = parseColor(pal.secondary, '#161920');
      var cAcc  = parseColor(pal.accent, '#ffffff');
      var cPop  = parseColor(pal.pop, '#ffffff');
      var cDet  = parseColor(pal.detail, '#2b303a');

      /* Apply authentic paint finish across bodywork materials */
      var paintKeys = ['bodyMain', 'sidepodBody', 'sidepodLower', 'airboxBody', 'sharkFin', 'noseTip', 'rearEndplate', 'frontEndplate'];
      var roughVal = fin === 'matte' ? 0.62 : (fin === 'metallic' ? 0.22 : (fin === 'carbon' ? 0.44 : 0.24));
      var metalVal = fin === 'matte' ? 0.14 : (fin === 'metallic' ? 0.68 : (fin === 'carbon' ? 0.28 : 0.34));
      var coatVal  = fin === 'matte' ? 0.08 : (fin === 'carbon' ? 0.48 : 1.0);
      paintKeys.forEach(function (k) {
        if (mats[k]) {
          mats[k].roughness = roughVal;
          mats[k].metalness = metalVal;
          mats[k].clearcoat = coatVal;
          mats[k].needsUpdate = true;
        }
      });

      /* Reset signature 3D motifs & exposed carbon weave maps */
      noseCapMesh.visible = false;
      bullDecalMesh.visible = false;
      ferrariBandMesh.visible = false;
      duracellCapMesh.visible = false;
      triStripeMesh.visible = false;
      pinstripeMesh.visible = false;
      chevronCanopyMesh.visible = false;
      ['bodyMain', 'sidepodBody', 'sidepodLower', 'airboxBody', 'sharkFin'].forEach(function (k) {
        if (mats[k]) { mats[k].map = null; mats[k].needsUpdate = true; }
      });

      /* Baseline modern mapping */
      mats.bodyMain.color.copy(cMain);
      mats.sidepodBody.color.copy(cMain);
      mats.sidepodLower.color.copy(cSec);
      mats.sidepodSwoosh.color.copy(cAcc);
      mats.noseStripe.color.copy(cAcc);
      mats.noseTip.color.copy(cMain);
      mats.airboxBody.color.copy(cSec);
      mats.airboxRim.color.copy(cAcc);
      mats.sharkFin.color.copy(cMain);
      mats.sharkFinEdge.color.copy(cAcc);
      mats.halo.color.copy(cSec);
      mats.frontWing1.color.copy(cSec);
      mats.frontWing2.color.copy(cMain);
      mats.frontWing3.color.copy(cAcc);
      mats.frontEndplate.color.copy(cSec);
      mats.frontDiveplane.color.copy(cAcc);
      mats.rearWingMain.color.copy(cSec);
      mats.rearWingFlap.color.copy(cAcc);
      mats.rearEndplate.color.copy(cMain);
      mats.rearEndplateCap.color.copy(cAcc);
      mats.mirrorCap.color.copy(cSec);
      mats.mirrorAccent.color.copy(cAcc);
      mats.helmet.color.copy(cPop);
      mats.helmetStripe.color.copy(cAcc);
      mats.tcam.color.copy(cPop);
      mats.floorEdge.color.copy(cDet);
      mats.rimAccent.color.copy(cMain);

      if (st === 'redbull') {
        /* Signature Red Bull Racing: Matte midnight navy chassis, bright yellow nose tip + charging bull sun decal, crimson airbox/roll-hoop & red-trimmed wings */
        noseCapMesh.visible = true;
        bullDecalMesh.visible = true;
        mats.bodyMain.color.copy(cMain);
        mats.sidepodBody.color.copy(cMain);
        mats.sidepodLower.color.copy(cDet);
        mats.sidepodSwoosh.color.copy(cSec);
        mats.noseTip.color.copy(cAcc);
        mats.noseStripe.color.copy(cSec);
        mats.airboxBody.color.copy(cAcc);
        mats.airboxRim.color.copy(cSec);
        mats.sharkFin.color.copy(cMain);
        mats.sharkFinEdge.color.copy(cSec);
        mats.halo.color.copy(cMain);
        mats.frontWing1.color.copy(cMain);
        mats.frontWing2.color.copy(cMain);
        mats.frontWing3.color.copy(cSec);
        mats.frontEndplate.color.copy(cMain);
        mats.frontDiveplane.color.copy(cAcc);
        mats.rearWingMain.color.copy(cMain);
        mats.rearWingFlap.color.copy(cSec);
        mats.rearEndplate.color.copy(cMain);
        mats.rearEndplateCap.color.copy(cAcc);
        mats.rimAccent.color.copy(cSec);
      } else if (st === 'ferrari_hp') {
        /* Signature 2025/2026 Scuderia Ferrari HP: Gloss Rosso Corsa + crisp HP White engine cover/wings + HP Blue accents */
        ferrariBandMesh.visible = true;
        mats.bodyMain.color.copy(cMain);
        mats.sidepodBody.color.copy(cMain);
        mats.sidepodLower.color.copy(cSec);
        mats.sidepodSwoosh.color.copy(cAcc);
        mats.noseStripe.color.copy(cSec);
        mats.airboxBody.color.copy(cSec);
        mats.airboxRim.color.copy(cAcc);
        mats.sharkFin.color.copy(cSec);
        mats.sharkFinEdge.color.copy(cAcc);
        mats.halo.color.copy(cMain);
        mats.frontWing1.color.copy(cMain);
        mats.frontWing2.color.copy(cSec);
        mats.frontWing3.color.copy(cAcc);
        mats.frontEndplate.color.copy(cMain);
        mats.frontDiveplane.color.copy(cAcc);
        mats.rearWingMain.color.copy(cSec);
        mats.rearWingFlap.color.copy(cAcc);
        mats.rearEndplate.color.copy(cMain);
        mats.rearEndplateCap.color.copy(cAcc);
        mats.rimAccent.color.copy(cAcc);
      } else if (st === 'merc_arrow') {
        /* Signature Mercedes-AMG Petronas: Obsidian Carbon / Silver Arrow split + Razor Petronas Teal pinstripe + INEOS Crimson roll hoop */
        noseCapMesh.visible = true;
        mats.bodyMain.color.copy(cMain);
        mats.noseTip.color.copy(cSec);
        mats.noseStripe.color.copy(cSec);
        mats.sidepodBody.color.copy(cMain);
        mats.sidepodLower.color.copy(cDet);
        mats.sidepodSwoosh.color.copy(cAcc);
        mats.airboxBody.color.copy(cMain);
        mats.airboxRim.color.copy(cPop);
        mats.sharkFin.color.copy(cMain);
        mats.sharkFinEdge.color.copy(cAcc);
        mats.halo.color.copy(cMain);
        mats.frontWing1.color.copy(cMain);
        mats.frontWing2.color.copy(cSec);
        mats.frontWing3.color.copy(cAcc);
        mats.frontEndplate.color.copy(cMain);
        mats.frontDiveplane.color.copy(cAcc);
        mats.rearWingMain.color.copy(cMain);
        mats.rearWingFlap.color.copy(cAcc);
        mats.rearEndplate.color.copy(cMain);
        mats.rearEndplateCap.color.copy(cAcc);
        mats.rimAccent.color.copy(cAcc);
      } else if (st === 'williams_duracell') {
        /* Signature Williams Racing: Royal Navy + Electric Blue wings/swoosh + Duracell Copper airbox top */
        duracellCapMesh.visible = true;
        mats.bodyMain.color.copy(cMain);
        mats.sidepodBody.color.copy(cMain);
        mats.sidepodLower.color.copy(cDet);
        mats.sidepodSwoosh.color.copy(cSec);
        mats.noseStripe.color.copy(cSec);
        mats.airboxBody.color.copy(cDet);
        mats.airboxRim.color.copy(cAcc);
        mats.sharkFin.color.copy(cMain);
        mats.sharkFinEdge.color.copy(cSec);
        mats.halo.color.copy(cMain);
        mats.frontWing1.color.copy(cMain);
        mats.frontWing2.color.copy(cSec);
        mats.frontWing3.color.copy(cSec);
        mats.frontEndplate.color.copy(cMain);
        mats.rearWingMain.color.copy(cMain);
        mats.rearWingFlap.color.copy(cSec);
        mats.rearEndplate.color.copy(cMain);
        mats.rearEndplateCap.color.copy(cAcc);
        mats.rimAccent.color.copy(cSec);
      } else if (st === 'audi_slash') {
        /* Signature 2026 Audi Works R26: Titanium Silver front, Exposed Carbon rear/sidepods & Audi Lava Red accents */
        noseCapMesh.visible = true;
        mats.bodyMain.color.copy(cMain);
        mats.noseTip.color.copy(cMain);
        mats.noseStripe.color.copy(cAcc);
        mats.sidepodBody.color.copy(cSec);
        mats.sidepodLower.color.copy(cSec);
        mats.sidepodSwoosh.color.copy(cAcc);
        mats.airboxBody.color.copy(cSec);
        mats.airboxRim.color.copy(cAcc);
        mats.sharkFin.color.copy(cSec);
        mats.sharkFinEdge.color.copy(cAcc);
        mats.halo.color.copy(cSec);
        mats.frontWing1.color.copy(cSec);
        mats.frontWing2.color.copy(cMain);
        mats.frontWing3.color.copy(cAcc);
        mats.frontEndplate.color.copy(cAcc);
        mats.rearWingMain.color.copy(cSec);
        mats.rearWingFlap.color.copy(cAcc);
        mats.rearEndplate.color.copy(cSec);
        mats.rearEndplateCap.color.copy(cAcc);
        mats.rimAccent.color.copy(cAcc);
      } else if (st === 'cadillac_split') {
        /* Signature 2026 Cadillac F1: Monochrome Black/White split with Brushed Gold crest trim */
        noseCapMesh.visible = true;
        mats.bodyMain.color.copy(cMain);
        mats.noseTip.color.copy(cSec);
        mats.noseStripe.color.copy(cAcc);
        mats.sidepodBody.color.copy(cSec);
        mats.sidepodLower.color.copy(cMain);
        mats.sidepodSwoosh.color.copy(cAcc);
        mats.airboxBody.color.copy(cMain);
        mats.airboxRim.color.copy(cAcc);
        mats.sharkFin.color.copy(cSec);
        mats.sharkFinEdge.color.copy(cAcc);
        mats.halo.color.copy(cMain);
        mats.frontWing1.color.copy(cMain);
        mats.frontWing2.color.copy(cSec);
        mats.frontWing3.color.copy(cAcc);
        mats.frontEndplate.color.copy(cSec);
        mats.rearWingMain.color.copy(cMain);
        mats.rearWingFlap.color.copy(cSec);
        mats.rearEndplate.color.copy(cMain);
        mats.rearEndplateCap.color.copy(cAcc);
        mats.rimAccent.color.copy(cAcc);
      } else if (st === 'mclaren_papaya') {
        /* Signature Modern McLaren: Matte Papaya Orange nose & spine + Raw Woven Carbon sidepod flanks + Sky Blue accents */
        mats.bodyMain.color.copy(cMain);
        mats.sidepodBody.color.copy(cSec);
        mats.sidepodBody.map = carbonTex;
        mats.sidepodLower.color.copy(cSec);
        mats.sidepodLower.map = carbonTex;
        mats.sidepodSwoosh.color.copy(cMain);
        mats.noseStripe.color.copy(cSec);
        mats.airboxBody.color.copy(cMain);
        mats.airboxRim.color.copy(cAcc);
        mats.sharkFin.color.copy(cSec);
        mats.sharkFin.map = carbonTex;
        mats.sharkFinEdge.color.copy(cMain);
        mats.halo.color.copy(cMain);
        mats.frontWing1.color.copy(cSec);
        mats.frontWing2.color.copy(cMain);
        mats.frontWing3.color.copy(cAcc);
        mats.frontEndplate.color.copy(cMain);
        mats.rearWingMain.color.copy(cSec);
        mats.rearWingFlap.color.copy(cMain);
        mats.rearEndplate.color.copy(cMain);
        mats.rearEndplateCap.color.copy(cAcc);
        mats.rimAccent.color.copy(cAcc);
      } else if (st === 'mclaren_marlboro') {
        /* Iconic 1974-1996 McLaren MP4/4: Pearl White base + Bold Day-Glo Red forward chevron & wings */
        noseCapMesh.visible = true;
        chevronCanopyMesh.visible = true;
        mats.bodyMain.color.copy(cMain);
        mats.noseTip.color.copy(cSec);
        mats.noseStripe.color.copy(cSec);
        mats.sidepodBody.color.copy(cMain);
        mats.sidepodLower.color.copy(cSec);
        mats.sidepodSwoosh.color.copy(cSec);
        mats.airboxBody.color.copy(cSec);
        mats.airboxRim.color.copy(cMain);
        mats.sharkFin.color.copy(cSec);
        mats.sharkFinEdge.color.copy(cMain);
        mats.halo.color.copy(cSec);
        mats.frontWing1.color.copy(cSec);
        mats.frontWing2.color.copy(cSec);
        mats.frontWing3.color.copy(cMain);
        mats.frontEndplate.color.copy(cSec);
        mats.rearWingMain.color.copy(cSec);
        mats.rearWingFlap.color.copy(cSec);
        mats.rearEndplate.color.copy(cSec);
        mats.rearEndplateCap.color.copy(cMain);
        mats.rimAccent.color.copy(cSec);
      } else if (st === 'aston_wings') {
        /* Signature Aston Martin Aramco: Metallic British Racing Green + Razor Highlighter-Lime pinstripes & woven carbon undercut */
        pinstripeMesh.visible = true;
        mats.bodyMain.color.copy(cMain);
        mats.sidepodBody.color.copy(cMain);
        mats.sidepodLower.color.copy(cSec);
        mats.sidepodLower.map = carbonTex;
        mats.sidepodSwoosh.color.copy(cAcc);
        mats.noseStripe.color.copy(cAcc);
        mats.airboxBody.color.copy(cMain);
        mats.airboxRim.color.copy(cAcc);
        mats.sharkFin.color.copy(cMain);
        mats.sharkFinEdge.color.copy(cAcc);
        mats.halo.color.copy(cMain);
        mats.frontWing1.color.copy(cSec);
        mats.frontWing2.color.copy(cMain);
        mats.frontWing3.color.copy(cAcc);
        mats.frontEndplate.color.copy(cMain);
        mats.rearWingMain.color.copy(cMain);
        mats.rearWingFlap.color.copy(cAcc);
        mats.rearEndplate.color.copy(cMain);
        mats.rearEndplateCap.color.copy(cAcc);
        mats.rimAccent.color.copy(cAcc);
      } else if (st === 'alpine_bwt') {
        /* Signature BWT Alpine: Metallic Alpine Blue + Bold Neon BWT Pink sidepod shoulders & nose flash + Carbon floor */
        noseCapMesh.visible = true;
        mats.bodyMain.color.copy(cMain);
        mats.noseTip.color.copy(cSec);
        mats.noseStripe.color.copy(cSec);
        mats.sidepodBody.color.copy(cSec);
        mats.sidepodLower.color.copy(cAcc);
        mats.sidepodLower.map = carbonTex;
        mats.sidepodSwoosh.color.copy(cMain);
        mats.airboxBody.color.copy(cMain);
        mats.airboxRim.color.copy(cSec);
        mats.sharkFin.color.copy(cMain);
        mats.sharkFinEdge.color.copy(cSec);
        mats.halo.color.copy(cSec);
        mats.frontWing1.color.copy(cAcc);
        mats.frontWing2.color.copy(cSec);
        mats.frontWing3.color.copy(cMain);
        mats.frontEndplate.color.copy(cSec);
        mats.rearWingMain.color.copy(cMain);
        mats.rearWingFlap.color.copy(cSec);
        mats.rearEndplate.color.copy(cSec);
        mats.rearEndplateCap.color.copy(cMain);
        mats.rimAccent.color.copy(cSec);
      } else if (st === 'lotus_jps') {
        /* Iconic John Player Special Lotus: Mirror-Gloss Piano Black + Razor Brushed-Gold double pinstripes & rims */
        pinstripeMesh.visible = true;
        mats.bodyMain.color.copy(cMain);
        mats.sidepodBody.color.copy(cMain);
        mats.sidepodLower.color.copy(cDet);
        mats.sidepodSwoosh.color.copy(cSec);
        mats.noseStripe.color.copy(cSec);
        mats.airboxBody.color.copy(cMain);
        mats.airboxRim.color.copy(cSec);
        mats.sharkFin.color.copy(cMain);
        mats.sharkFinEdge.color.copy(cSec);
        mats.halo.color.copy(cMain);
        mats.frontWing1.color.copy(cMain);
        mats.frontWing2.color.copy(cMain);
        mats.frontWing3.color.copy(cSec);
        mats.frontEndplate.color.copy(cMain);
        mats.frontDiveplane.color.copy(cSec);
        mats.rearWingMain.color.copy(cMain);
        mats.rearWingFlap.color.copy(cSec);
        mats.rearEndplate.color.copy(cMain);
        mats.rearEndplateCap.color.copy(cSec);
        mats.rimAccent.color.copy(cSec);
      } else if (st === 'gulf_heritage') {
        /* Iconic Gulf Racing Heritage: Powder Blue bodywork + Full-length Marigold Orange centre stripe & nose tip */
        noseCapMesh.visible = true;
        triStripeMesh.visible = true;
        mats.bodyMain.color.copy(cMain);
        mats.noseTip.color.copy(cAcc);
        mats.noseStripe.color.copy(cAcc);
        mats.sidepodBody.color.copy(cMain);
        mats.sidepodLower.color.copy(cSec);
        mats.sidepodSwoosh.color.copy(cAcc);
        mats.airboxBody.color.copy(cAcc);
        mats.airboxRim.color.copy(cSec);
        mats.sharkFin.color.copy(cMain);
        mats.sharkFinEdge.color.copy(cAcc);
        mats.halo.color.copy(cAcc);
        mats.frontWing1.color.copy(cMain);
        mats.frontWing2.color.copy(cAcc);
        mats.frontWing3.color.copy(cAcc);
        mats.frontEndplate.color.copy(cMain);
        mats.rearWingMain.color.copy(cMain);
        mats.rearWingFlap.color.copy(cAcc);
        mats.rearEndplate.color.copy(cMain);
        mats.rearEndplateCap.color.copy(cAcc);
        mats.rimAccent.color.copy(cAcc);
      } else if (st === 'martini_tri') {
        /* Classic Martini / Heritage Tricolour: Pearl White bodywork + 3-Ribbon Red/Navy/Sky stripes down the spine */
        triStripeMesh.visible = true;
        mats.bodyMain.color.copy(cMain);
        mats.noseStripe.color.copy(cAcc);
        mats.sidepodBody.color.copy(cMain);
        mats.sidepodLower.color.copy(cSec);
        mats.sidepodSwoosh.color.copy(cAcc);
        mats.airboxBody.color.copy(cMain);
        mats.airboxRim.color.copy(cAcc);
        mats.sharkFin.color.copy(cMain);
        mats.sharkFinEdge.color.copy(cAcc);
        mats.halo.color.copy(cMain);
        mats.frontWing1.color.copy(cMain);
        mats.frontWing2.color.copy(cSec);
        mats.frontWing3.color.copy(cAcc);
        mats.frontEndplate.color.copy(cMain);
        mats.rearWingMain.color.copy(cSec);
        mats.rearWingFlap.color.copy(cAcc);
        mats.rearEndplate.color.copy(cMain);
        mats.rearEndplateCap.color.copy(cAcc);
        mats.rimAccent.color.copy(cAcc);
      } else if (st === 'renault_mildseven') {
        /* 2005-2006 Championship Renault R25/R26: Electric Sky Blue + Canary Yellow engine canopy & wings */
        noseCapMesh.visible = true;
        chevronCanopyMesh.visible = true;
        mats.bodyMain.color.copy(cMain);
        mats.noseTip.color.copy(cSec);
        mats.noseStripe.color.copy(cSec);
        mats.sidepodBody.color.copy(cMain);
        mats.sidepodLower.color.copy(cSec);
        mats.sidepodSwoosh.color.copy(cSec);
        mats.airboxBody.color.copy(cSec);
        mats.airboxRim.color.copy(cMain);
        mats.sharkFin.color.copy(cSec);
        mats.sharkFinEdge.color.copy(cMain);
        mats.halo.color.copy(cSec);
        mats.frontWing1.color.copy(cSec);
        mats.frontWing2.color.copy(cMain);
        mats.frontWing3.color.copy(cSec);
        mats.frontEndplate.color.copy(cSec);
        mats.rearWingMain.color.copy(cSec);
        mats.rearWingFlap.color.copy(cMain);
        mats.rearEndplate.color.copy(cSec);
        mats.rearEndplateCap.color.copy(cMain);
        mats.rimAccent.color.copy(cSec);
      } else if (st === 'brawn_neon') {
        /* Iconic 2009 Brawn GP BGP 001: Pearl White + Vivid Neon Chartreuse pinstripes & nose + Piano Black rear wing */
        pinstripeMesh.visible = true;
        mats.bodyMain.color.copy(cMain);
        mats.noseStripe.color.copy(cAcc);
        mats.sidepodBody.color.copy(cMain);
        mats.sidepodLower.color.copy(cSec);
        mats.sidepodSwoosh.color.copy(cAcc);
        mats.airboxBody.color.copy(cMain);
        mats.airboxRim.color.copy(cAcc);
        mats.sharkFin.color.copy(cMain);
        mats.sharkFinEdge.color.copy(cAcc);
        mats.halo.color.copy(cSec);
        mats.frontWing1.color.copy(cMain);
        mats.frontWing2.color.copy(cAcc);
        mats.frontWing3.color.copy(cSec);
        mats.frontEndplate.color.copy(cSec);
        mats.rearWingMain.color.copy(cSec);
        mats.rearWingFlap.color.copy(cAcc);
        mats.rearEndplate.color.copy(cSec);
        mats.rearEndplateCap.color.copy(cAcc);
        mats.rimAccent.color.copy(cAcc);
      } else if (st === 'haas_carbon') {
        /* Modern Haas Stealth: Crisp Gloss White nose/engine cover + Raw Exposed Woven Carbon sidepods + Crimson Red trim */
        mats.bodyMain.color.copy(cMain);
        mats.sidepodBody.color.copy(cSec);
        mats.sidepodBody.map = carbonTex;
        mats.sidepodLower.color.copy(cSec);
        mats.sidepodLower.map = carbonTex;
        mats.sidepodSwoosh.color.copy(cAcc);
        mats.noseStripe.color.copy(cAcc);
        mats.airboxBody.color.copy(cMain);
        mats.airboxRim.color.copy(cAcc);
        mats.sharkFin.color.copy(cMain);
        mats.sharkFinEdge.color.copy(cAcc);
        mats.halo.color.copy(cSec);
        mats.frontWing1.color.copy(cSec);
        mats.frontWing2.color.copy(cMain);
        mats.frontWing3.color.copy(cAcc);
        mats.frontEndplate.color.copy(cAcc);
        mats.rearWingMain.color.copy(cSec);
        mats.rearWingFlap.color.copy(cMain);
        mats.rearEndplate.color.copy(cSec);
        mats.rearEndplateCap.color.copy(cAcc);
        mats.rimAccent.color.copy(cAcc);
      } else if (st === 'jordan_hornet') {
        /* Iconic Jordan Buzzin' Hornets: Vivid Hornet Yellow + Dramatic Matte-Black Nose & Engine Chevron + Red Endplates */
        noseCapMesh.visible = true;
        chevronCanopyMesh.visible = true;
        mats.bodyMain.color.copy(cMain);
        mats.noseTip.color.copy(cSec);
        mats.noseStripe.color.copy(cSec);
        mats.sidepodBody.color.copy(cMain);
        mats.sidepodLower.color.copy(cSec);
        mats.sidepodSwoosh.color.copy(cSec);
        mats.airboxBody.color.copy(cSec);
        mats.airboxRim.color.copy(cMain);
        mats.sharkFin.color.copy(cMain);
        mats.sharkFinEdge.color.copy(cSec);
        mats.halo.color.copy(cSec);
        mats.frontWing1.color.copy(cMain);
        mats.frontWing2.color.copy(cSec);
        mats.frontWing3.color.copy(cAcc);
        mats.frontEndplate.color.copy(cSec);
        mats.rearWingMain.color.copy(cMain);
        mats.rearWingFlap.color.copy(cSec);
        mats.rearEndplate.color.copy(cSec);
        mats.rearEndplateCap.color.copy(cAcc);
        mats.rimAccent.color.copy(cMain);
      } else if (st === 'carbon_stealth') {
        /* Winter Testing / Night-Race Stealth: Full Exposed Woven Carbon-Fibre chassis + Neon Accent Pinstripes */
        pinstripeMesh.visible = true;
        mats.bodyMain.color.set('#1a1e26');
        mats.bodyMain.map = carbonTex;
        mats.sidepodBody.color.set('#1a1e26');
        mats.sidepodBody.map = carbonTex;
        mats.sidepodLower.color.set('#11141a');
        mats.sidepodLower.map = carbonTex;
        mats.airboxBody.color.set('#1a1e26');
        mats.airboxBody.map = carbonTex;
        mats.sharkFin.color.set('#1a1e26');
        mats.sharkFin.map = carbonTex;
        mats.sidepodSwoosh.color.copy(cAcc);
        mats.noseStripe.color.copy(cAcc);
        mats.airboxRim.color.copy(cAcc);
        mats.sharkFinEdge.color.copy(cAcc);
        mats.halo.color.copy(cAcc);
        mats.frontWing1.color.set('#14171e');
        mats.frontWing2.color.set('#1a1e26');
        mats.frontWing3.color.copy(cAcc);
        mats.frontEndplate.color.set('#14171e');
        mats.rearWingMain.color.set('#14171e');
        mats.rearWingFlap.color.copy(cAcc);
        mats.rearEndplate.color.set('#14171e');
        mats.rearEndplateCap.color.copy(cAcc);
        mats.rimAccent.color.copy(cAcc);
      } else if (st === 'two-tone') {
        /* Bold contrasting sidepod & rear colour-block (McLaren / Alpine / Sauber / Red Bull) */
        noseCapMesh.visible = true;
        mats.noseTip.color.copy(cSec);
        mats.sidepodBody.color.copy(cSec);
        mats.sidepodLower.color.copy(cMain);
        mats.sidepodSwoosh.color.copy(cMain);
        mats.noseStripe.color.copy(cAcc);
        mats.airboxBody.color.copy(cMain);
        mats.airboxRim.color.copy(cAcc);
        mats.sharkFin.color.copy(cSec);
        mats.sharkFinEdge.color.copy(cMain);
        mats.halo.color.copy(cMain);
        mats.frontWing1.color.copy(cSec);
        mats.frontWing2.color.copy(cSec);
        mats.frontWing3.color.copy(cMain);
        mats.frontEndplate.color.copy(cMain);
        mats.rearWingMain.color.copy(cSec);
        mats.rearWingFlap.color.copy(cMain);
        mats.rearEndplate.color.copy(cSec);
        mats.rearEndplateCap.color.copy(cAcc);
      } else if (st === 'racing-stripe') {
        /* Full-length centre stripe + crisp contrasting nose/airbox/wings (Williams / Brabham / Tyrrell / Ligier) */
        mats.noseStripe.color.copy(cSec);
        mats.sidepodBody.color.copy(cMain);
        mats.sidepodLower.color.copy(cDet);
        mats.sidepodSwoosh.color.copy(cSec);
        mats.airboxBody.color.copy(cMain);
        mats.airboxRim.color.copy(cSec);
        mats.sharkFin.color.copy(cSec);
        mats.sharkFinEdge.color.copy(cAcc);
        mats.halo.color.copy(cSec);
        mats.frontWing1.color.copy(cMain);
        mats.frontWing2.color.copy(cSec);
        mats.frontWing3.color.copy(cAcc);
        mats.frontEndplate.color.copy(cMain);
        mats.rearWingMain.color.copy(cMain);
        mats.rearWingFlap.color.copy(cSec);
        mats.rearEndplate.color.copy(cSec);
        mats.rearEndplateCap.color.copy(cAcc);
      } else if (st === 'chevron') {
        /* Bold contrasting nosecone tip + vivid accent rear wing & airbox (Jordan / Benetton / Renault / Racing Bulls) */
        noseCapMesh.visible = true;
        mats.noseTip.color.copy(cAcc);
        mats.noseStripe.color.copy(cSec);
        mats.sidepodBody.color.copy(cMain);
        mats.sidepodLower.color.copy(cSec);
        mats.sidepodSwoosh.color.copy(cAcc);
        mats.airboxBody.color.copy(cAcc);
        mats.airboxRim.color.copy(cSec);
        mats.sharkFin.color.copy(cSec);
        mats.sharkFinEdge.color.copy(cAcc);
        mats.halo.color.copy(cSec);
        mats.frontWing1.color.copy(cAcc);
        mats.frontWing2.color.copy(cSec);
        mats.frontWing3.color.copy(cMain);
        mats.frontEndplate.color.copy(cSec);
        mats.rearWingMain.color.copy(cAcc);
        mats.rearWingFlap.color.copy(cSec);
        mats.rearEndplate.color.copy(cSec);
        mats.rearEndplateCap.color.copy(cMain);
      } else if (st === 'classic') {
        /* Heritage monochrome bodywork with metallic/gold pinstripes (Lotus / Mercedes / Alfa / Maserati / Vanwall) */
        mats.bodyMain.color.copy(cMain);
        mats.sidepodBody.color.copy(cMain);
        mats.sidepodLower.color.copy(cDet);
        mats.sidepodSwoosh.color.copy(cSec);
        mats.noseStripe.color.copy(cSec);
        mats.airboxBody.color.copy(cMain);
        mats.airboxRim.color.copy(cSec);
        mats.sharkFin.color.copy(cMain);
        mats.sharkFinEdge.color.copy(cSec);
        mats.halo.color.copy(cMain);
        mats.frontWing1.color.copy(cMain);
        mats.frontWing2.color.copy(cMain);
        mats.frontWing3.color.copy(cSec);
        mats.frontEndplate.color.copy(cMain);
        mats.frontDiveplane.color.copy(cSec);
        mats.rearWingMain.color.copy(cMain);
        mats.rearWingFlap.color.copy(cSec);
        mats.rearEndplate.color.copy(cMain);
        mats.rearEndplateCap.color.copy(cSec);
        mats.rimAccent.color.copy(cSec);
      }

      /* Keep tyre sidewall ring vibrant & legible against dark rubber */
      var ringCol = (st === 'classic') ? cSec : cAcc;
      var hsl = {};
      ringCol.getHSL(hsl);
      if (hsl.l < 0.30) {
        var mHsl = {};
        cMain.getHSL(mHsl);
        mats.tyreRing.color.copy(mHsl.l >= 0.34 ? cMain : cPop);
      } else {
        mats.tyreRing.color.copy(ringCol);
      }
    }

    /* Apply authentic year-specific chassis dimensional proportions:
       - 2026+ Nimble Active-Aero Formula: 1900mm width (0.95x) & 3400mm wheelbase (0.945x) vs 2022-25 (2000mm / 3600mm)
       - 2009-2016 Narrow-Track Formula: 1800mm width (0.91x) vs 2017-2021 Wide 2000mm cars */
    if (exactYear >= 2026) {
      root.scale.set(0.95, 1.0, 0.945);
    } else if (exactYear >= 2009 && exactYear <= 2016) {
      root.scale.set(0.91, 1.0, 0.97);
    }

    setPalette(palette, styleName || 'modern');
    root.userData.setPalette = setPalette;
    root.userData.materials = mats;
    return root;
  }

  /* Create a soft contact shadow decal plane directly under the car (fades to 0 before all edges). */
  function createContactShadow() {
    var c = document.createElement('canvas');
    c.width = 256; c.height = 512;
    var g = c.getContext('2d');
    g.clearRect(0, 0, 256, 512);

    function softEllipse(cx, cy, rx, ry, alpha) {
      g.save();
      g.translate(cx, cy);
      g.scale(rx, ry);
      var gr = g.createRadialGradient(0, 0, 0.08, 0, 0, 1.0);
      gr.addColorStop(0, 'rgba(0,0,0,' + alpha + ')');
      gr.addColorStop(0.55, 'rgba(0,0,0,' + (alpha * 0.42).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, 1.0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    /* Central underfloor & nose shadow */
    softEllipse(128, 260, 74, 185, 0.56);
    /* Front wing subtle shadow */
    softEllipse(128, 72, 86, 32, 0.34);
    /* 4 tyre contact patches */
    softEllipse(60, 134, 28, 42, 0.62);
    softEllipse(196, 134, 28, 42, 0.62);
    softEllipse(62, 390, 32, 46, 0.62);
    softEllipse(194, 390, 32, 46, 0.62);

    var tex = new THREE.CanvasTexture(c);
    var mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.75, 6.2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.90 })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.004;
    return mesh;
  }

  /* Add balanced studio key/rim/fill lighting to a scene. */
  function addStudioLights(scene, accentColorHex) {
    var accent = parseColor(accentColorHex, '#d9a441');
    scene.add(new THREE.HemisphereLight(0xf4f7ff, 0x1b2030, 0.95));

    var key = new THREE.DirectionalLight(0xffffff, 2.35);
    key.position.set(5.5, 8.5, 6.2);
    scene.add(key);

    var fill = new THREE.DirectionalLight(0xd2e2ff, 1.05);
    fill.position.set(-6.0, 4.5, 3.5);
    scene.add(fill);

    var rim = new THREE.DirectionalLight(accent, 1.25);
    rim.position.set(-3.5, 4.0, -7.5);
    scene.add(rim);

    return { key: key, fill: fill, rim: rim };
  }

  /* Render crisp CAD-style orthographic 3D blueprint PNG data URLs (top, front, side)
     using a single temporary offscreen WebGLRenderer so zero persistent GPU contexts are leaked. */
  function renderOrthoViews(palette, styleName, eraName) {
    var canvas = document.createElement('canvas');
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) {
      return null;
    }
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.24;
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    var scene = new THREE.Scene();
    var envTex = createStudioEnvironment(renderer);
    scene.environment = envTex;
    var lights = addStudioLights(scene, (palette && palette.main) || '#ffffff');
    lights.key.intensity = 2.6;
    lights.fill.intensity = 1.45;
    lights.rim.intensity = 1.25;

    var car = createF1Car(palette, styleName, eraName);
    scene.add(car);

    function snap(w, h, halfW, pos, up, lookAt) {
      renderer.setSize(w, h, false);
      var aspect = w / h;
      var halfH = halfW / aspect;
      var cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 40);
      cam.up.set(up[0], up[1], up[2]);
      cam.position.set(pos[0], pos[1], pos[2]);
      cam.lookAt(lookAt[0], lookAt[1], lookAt[2]);
      cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      return canvas.toDataURL('image/png');
    }

    var out = {
      /* Top plan view: nose pointing right (+Z -> +screen X) */
      top:   snap(960, 420, 3.05, [0, 10, 0.04],   [-1, 0, 0], [0, 0.4, 0.04]),
      /* Front elevation: true orthographic head-on */
      front: snap(960, 520, 1.32, [0, 0.56, 10],   [0, 1, 0],  [0, 0.56, 0]),
      /* Side profile elevation: nose pointing right */
      side:  snap(960, 320, 3.05, [10, 0.56, 0.04],[0, 1, 0],  [0, 0.56, 0.04])
    };

    disposeObject(car);
    if (envTex && envTex.dispose) envTex.dispose();
    renderer.dispose();
    return out;
  }

  function disposeObject(root) {
    if (!root || !root.traverse) return;
    root.traverse(function (node) {
      if (node.geometry && node.geometry.dispose) {
        node.geometry.dispose();
      }
      if (node.material) {
        var mats = Array.isArray(node.material) ? node.material : [node.material];
        for (var i = 0; i < mats.length; i++) {
          var m = mats[i];
          if (!m) continue;
          if (m.map && m.map.dispose) m.map.dispose();
          if (m.normalMap && m.normalMap.dispose) m.normalMap.dispose();
          if (m.roughnessMap && m.roughnessMap.dispose) m.roughnessMap.dispose();
          if (m.metalnessMap && m.metalnessMap.dispose) m.metalnessMap.dispose();
          if (m.emissiveMap && m.emissiveMap.dispose) m.emissiveMap.dispose();
          if (m.alphaMap && m.alphaMap.dispose) m.alphaMap.dispose();
          if (m.dispose) m.dispose();
        }
      }
    });
  }

  /* Parametrically scale a 3D car & toggle custom Car Tools from an FIA Regulation Formula spec. */
  function applyRegulationDimensions(root, regSpec) {
    if (!root || !regSpec) return;
    var dims = regSpec.dimensions || regSpec;
    var wb = Number(dims.wheelbase_mm || 3400);
    var wd = Number(dims.width_mm || 1900);
    var rh = Number(dims.ride_height_mm || 32);
    var scaleZ = Math.max(0.76, Math.min(1.16, wb / 3400));
    var scaleX = Math.max(0.82, Math.min(1.18, wd / 1900));
    var yLift  = Math.max(-0.02, Math.min(0.08, (rh - 32) * 0.0012));

    root.scale.set(scaleX, 1.0, scaleZ);
    root.position.y = Math.max(0, yLift);

    /* Manage 3D Car Tool attachments (Fan Car turbine, 6-Wheeler twin front axle, Venturi Skirts, Active Aero pods, Custom Tool emitter) */
    var tools = Array.isArray(regSpec.active_tools) ? regSpec.active_tools : [];
    var hasCustom = Array.isArray(regSpec.custom_tools) && regSpec.custom_tools.some(function (t) {
      return tools.indexOf(t.id) !== -1;
    });

    if (!root.userData.regToolsGroup) {
      var tg = new THREE.Group();
      tg.name = 'RegCarTools';

      /* 1. Fan Car Suction Turbine (Brabham BT46B style at rear diffuser) */
      var fanGrp = new THREE.Group();
      var fanMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.72, roughness: 0.28 });
      var bladeMat = new THREE.MeshStandardMaterial({ color: 0xe10600, metalness: 0.45, roughness: 0.35 });
      var shroud = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.036, 10, 28), fanMat);
      shroud.position.set(0, 0.34, -2.52);
      fanGrp.add(shroud);
      var rotor = new THREE.Group();
      rotor.position.set(0, 0.34, -2.52);
      for (var b = 0; b < 8; b++) {
        var bl = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.24, 0.018), bladeMat);
        bl.rotation.z = (b / 8) * Math.PI * 2;
        bl.position.set(Math.sin((b / 8) * Math.PI * 2) * 0.12, Math.cos((b / 8) * Math.PI * 2) * 0.12, 0);
        rotor.add(bl);
      }
      fanGrp.add(rotor);
      fanGrp.userData.rotor = rotor;
      fanGrp.visible = false;
      tg.add(fanGrp);
      tg.userData.fanCar = fanGrp;

      /* 2. 6-Wheeler Twin Front Axle (Tyrrell P34 style smaller tandem front tyres) */
      var sixGrp = new THREE.Group();
      var mats = root.userData.materials;
      if (mats) {
        [-1, 1].forEach(function (side) {
          var miniW = buildWheel(false, mats);
          miniW.scale.set(0.86, 0.72, 0.72);
          miniW.position.set(side * 0.80, 0.26, 1.02);
          sixGrp.add(miniW);
        });
      }
      sixGrp.visible = false;
      tg.add(sixGrp);
      tg.userData.sixWheeler = sixGrp;

      /* 3. Ground Effect Venturi Sliding Side Skirts */
      var skirtGrp = new THREE.Group();
      var skirtMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x0ea5e9, emissiveIntensity: 0.22, roughness: 0.4 });
      [-1, 1].forEach(function (side) {
        var sk = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.10, 2.35), skirtMat);
        sk.position.set(side * 0.78, 0.06, -0.22);
        skirtGrp.add(sk);
      });
      skirtGrp.visible = false;
      tg.add(skirtGrp);
      tg.userData.groundEffect = skirtGrp;

      /* 4. Active Aero / DRS Actuator Pods */
      var aeroGrp = new THREE.Group();
      var aeroMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 0.85, roughness: 0.2 });
      [-1, 1].forEach(function (side) {
        var fPod = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.26), aeroMat);
        fPod.position.set(side * 0.36, 0.22, 2.38);
        aeroGrp.add(fPod);
      });
      var rPod = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.24), aeroMat);
      rPod.position.set(0, 0.96, -2.44);
      aeroGrp.add(rPod);
      aeroGrp.visible = false;
      tg.add(aeroGrp);
      tg.userData.activeAero = aeroGrp;

      /* 5. Custom Invented Car Tool Emitter Fin */
      var customGrp = new THREE.Group();
      var customMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xd97706, emissiveIntensity: 0.8, roughness: 0.2 });
      var fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.92), customMat);
      fin.position.set(0, 0.94, -1.16);
      customGrp.add(fin);
      customGrp.visible = false;
      tg.add(customGrp);
      tg.userData.customTool = customGrp;

      root.add(tg);
      root.userData.regToolsGroup = tg;
    }

    var g = root.userData.regToolsGroup;
    g.userData.fanCar.visible = tools.indexOf('fan_car') !== -1;
    g.userData.sixWheeler.visible = tools.indexOf('six_wheeler') !== -1;
    g.userData.groundEffect.visible = tools.indexOf('ground_effect') !== -1;
    g.userData.activeAero.visible = (tools.indexOf('active_aero') !== -1 || tools.indexOf('drs') !== -1);
    g.userData.customTool.visible = hasCustom;
  }

  global.F1Car3D = {
    createCar: createF1Car,
    applyRegulationDimensions: applyRegulationDimensions,
    disposeObject: disposeObject,
    createStudioEnvironment: createStudioEnvironment,
    createContactShadow: createContactShadow,
    addStudioLights: addStudioLights,
    renderOrthoViews: renderOrthoViews,
    eraForYear: normalizeEra,
    ERAS: CAR_ERAS,
    LIVERY_STYLES: [
      'modern', 'two-tone', 'racing-stripe', 'chevron', 'classic',
      'redbull', 'ferrari_hp', 'merc_arrow', 'williams_duracell', 'audi_slash', 'cadillac_split',
      'mclaren_papaya', 'mclaren_marlboro', 'aston_wings', 'alpine_bwt', 'lotus_jps',
      'gulf_heritage', 'martini_tri', 'renault_mildseven', 'brawn_neon', 'haas_carbon',
      'jordan_hornet', 'carbon_stealth'
    ],
    CAMERA_PRESETS: {
      hero:  { theta:  0.76, phi: 0.24, radius: 6.30, targetY: 0.44 },
      side:  { theta:  Math.PI / 2, phi: 0.08, radius: 7.40, targetY: 0.46 },
      front: { theta:  0.00, phi: 0.13, radius: 5.20, targetY: 0.44 },
      top:   { theta:  Math.PI / 2, phi: 1.48, radius: 7.60, targetY: 0.15 },
      rear:  { theta:  Math.PI - 0.42, phi: 0.24, radius: 5.90, targetY: 0.46 }
    }
  };
})(window);
