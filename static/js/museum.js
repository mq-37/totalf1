/* museum.js — Local F1 "The Private Collection"
   1. Voxel car plinth (Three.js): pixel-art livery rebuilt as an instanced
      voxel sculpture on a lit museum plinth. Drag to orbit, wheel to zoom.
   2. Gallery wall: subtle perspective drift on card grids (CSS 3D).
   3. Reveal-on-scroll for cards/KPI plaques.
   Everything degrades: no WebGL -> SVG fallback image; reduced-motion ->
   static displays. */
(function () {
  'use strict';
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var COARSE = window.matchMedia('(pointer: coarse)').matches;

  /* ------------------------------------------------------------ plinth */
  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function lum(rgb) { return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255; }

  function mountPlinth(container) {
    var team = container.getAttribute('data-team');
    var color = container.getAttribute('data-color') || '#d9a441';
    var explicitEra = container.getAttribute('data-era') || '';
    var explicitYear = container.getAttribute('data-year') || '';
    var canvas = container.querySelector('canvas');
    if (!canvas || !team) return;

    /* Prefer the real sculpted 3D F1 car (f1_car_3d.js) + lightweight palette API */
    if (window.F1Car3D && window.THREE) {
      var url = '/api/car/' + encodeURIComponent(team) + '/palette' + (explicitYear ? ('?year=' + encodeURIComponent(explicitYear)) : '');
      fetch(url)
        .then(function (r) { if (!r.ok) throw new Error('no palette'); return r.json(); })
        .then(function (data) { initCar3DScene(data.palette || {}, data.style || 'modern', explicitEra || data.era || '2020s'); })
        .catch(function () {
          initCar3DScene({ main: color, secondary: '#161920', accent: '#ffffff', pop: '#ffffff', detail: '#2a303c' }, 'modern', explicitEra || '2020s');
        });
      return;
    }

    fetch('/api/car/' + encodeURIComponent(team) + '/voxels')
      .then(function (r) { if (!r.ok) throw new Error('no livery'); return r.json(); })
      .then(function (data) { initScene(data); })
      .catch(function () { container.classList.add('no3d'); });

    function initCar3DScene(palette, liveryStyle, carEra) {
      var renderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      } catch (e) {
        container.classList.add('no3d');
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.18;
      if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      }

      var scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x0a0c11, 14, 34);
      scene.environment = F1Car3D.createStudioEnvironment(renderer);

      var camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 100);
      var rimHex = (palette && palette.main) || color;
      var lights = F1Car3D.addStudioLights(scene, rimHex);

      /* Floor & showroom plinth */
      var floor = new THREE.Mesh(
        new THREE.CircleGeometry(18, 64),
        new THREE.MeshStandardMaterial({ color: 0x0c0f16, roughness: 0.92, metalness: 0.05 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.18;
      scene.add(floor);

      var plinth = new THREE.Mesh(
        new THREE.CylinderGeometry(3.25, 3.48, 0.18, 64),
        new THREE.MeshStandardMaterial({ color: 0x141822, roughness: 0.48, metalness: 0.32 })
      );
      plinth.position.y = -0.09;
      scene.add(plinth);

      var rimColor = new THREE.Color(rimHex);
      var ringMat = new THREE.MeshBasicMaterial({ color: rimColor, transparent: true, opacity: 0.78 });
      var ring = new THREE.Mesh(new THREE.TorusGeometry(3.26, 0.028, 12, 84), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.002;
      scene.add(ring);

      /* Sculpted 3D F1 car + soft contact shadow */
      var car = F1Car3D.createCar(palette, liveryStyle, carEra || '2020s');
      scene.add(car);
      scene.add(F1Car3D.createContactShadow());

      /* Subtle floating museum dust motes */
      var dust = null;
      if (!REDUCED) {
        var N = 140, pos = new Float32Array(N * 3), spd = new Float32Array(N);
        for (var d = 0; d < N; d++) {
          pos[d * 3] = (Math.random() - 0.5) * 6.5;
          pos[d * 3 + 1] = Math.random() * 2.8;
          pos[d * 3 + 2] = (Math.random() - 0.5) * 6.5;
          spd[d] = 0.0008 + Math.random() * 0.0018;
        }
        var dgeo = new THREE.BufferGeometry();
        dgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        dust = new THREE.Points(dgeo, new THREE.PointsMaterial({
          color: 0xcfd6e6, size: 0.025, transparent: true, opacity: 0.32,
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
        dust.userData.spd = spd;
        scene.add(dust);
      }

      /* Camera orbit + presets */
      var preset = F1Car3D.CAMERA_PRESETS.hero;
      var theta = preset.theta, phi = preset.phi, radius = preset.radius, targetY = preset.targetY;
      var tTheta = theta, tPhi = phi, tRadius = radius, tTargetY = targetY;
      var dragging = false, lastX = 0, lastY = 0, idle = 0, autoSpin = true;

      function applyCamera() {
        var y = radius * Math.sin(phi) + targetY;
        var r = radius * Math.cos(phi);
        camera.position.set(r * Math.sin(theta), y, r * Math.cos(theta));
        camera.lookAt(0, targetY, 0);
      }
      applyCamera();

      /* Inject compact angle switcher buttons (3/4, Side, Front, Top) unless compact driver plinth */
      if (!container.classList.contains('plinth-driver') && !container.querySelector('.plinth-angles')) {
        var bar = document.createElement('div');
        bar.className = 'plinth-angles';
        [['hero', '3/4'], ['side', 'Side'], ['front', 'Front'], ['top', 'Top']].forEach(function (pair) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'plinth-angle-btn' + (pair[0] === 'hero' ? ' active' : '');
          b.textContent = pair[1];
          b.addEventListener('click', function (e) {
            e.stopPropagation();
            var pr = F1Car3D.CAMERA_PRESETS[pair[0]];
            if (!pr) return;
            tTheta = pr.theta; tPhi = pr.phi; tRadius = pr.radius; tTargetY = pr.targetY;
            autoSpin = (pair[0] === 'hero');
            idle = 0;
            bar.querySelectorAll('button').forEach(function (btn) { btn.classList.remove('active'); });
            b.classList.add('active');
            if (REDUCED) { theta = tTheta; phi = tPhi; radius = tRadius; targetY = tTargetY; applyCamera(); renderer.render(scene, camera); }
          });
          bar.appendChild(b);
        });
        container.appendChild(bar);
      }

      canvas.addEventListener('pointerdown', function (e) {
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        tTheta -= (e.clientX - lastX) * 0.007;
        tPhi = Math.min(1.42, Math.max(0.06, tPhi + (e.clientY - lastY) * 0.005));
        lastX = e.clientX; lastY = e.clientY;
        idle = 0;
      });
      canvas.addEventListener('pointerup', function () { dragging = false; });
      canvas.addEventListener('wheel', function (e) {
        e.preventDefault();
        tRadius = Math.min(8.5, Math.max(3.1, tRadius + e.deltaY * 0.004));
      }, { passive: false });

      function resize() {
        var w = container.clientWidth || 600, h = container.clientHeight || 340;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      if (window.ResizeObserver) new ResizeObserver(resize).observe(container);
      else window.addEventListener('resize', resize);
      resize();

      var clock = new THREE.Clock();
      function tick() {
        var t = clock.getElapsedTime();
        if (!REDUCED && !dragging) {
          idle += 1 / 60;
          if (autoSpin && idle > 2.2) tTheta += 0.0038;
          ringMat.opacity = 0.58 + 0.22 * Math.sin(t * 1.6);
          lights.rim.intensity = 1.05 + 0.30 * Math.sin(t * 1.6 + 1);
        }
        theta += (tTheta - theta) * 0.10;
        phi += (tPhi - phi) * 0.10;
        radius += (tRadius - radius) * 0.10;
        targetY += (tTargetY - targetY) * 0.10;
        applyCamera();
        if (dust) {
          var pAttr = dust.geometry.attributes.position, sp = dust.userData.spd;
          for (var i = 0; i < sp.length; i++) {
            pAttr.array[i * 3 + 1] += sp[i];
            if (pAttr.array[i * 3 + 1] > 2.9) pAttr.array[i * 3 + 1] = 0.05;
          }
          pAttr.needsUpdate = true;
        }
        renderer.render(scene, camera);
        requestAnimationFrame(tick);
      }
      if (REDUCED) { renderer.render(scene, camera); }
      else requestAnimationFrame(tick);
    }

    function initScene(data) {
      var renderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      } catch (e) {
        container.classList.add('no3d');
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      var scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0x0a0c11, 160, 460);

      var camera = new THREE.PerspectiveCamera(38, 2, 0.1, 800);

      /* ---- lights: low ambient, one key spot, one team-colour rim ---- */
      scene.add(new THREE.AmbientLight(0x8892a8, 0.95));
      var key = new THREE.SpotLight(0xf2f4fa, 2.2, 0, Math.PI / 5, 0.45, 1.4);
      key.position.set(30, 95, 55);
      key.target.position.set(0, 0, 0);
      scene.add(key); scene.add(key.target);
      var rimColor = new THREE.Color(color);
      var rim = new THREE.PointLight(rimColor, 1.35, 260, 1.6);
      rim.position.set(-70, 22, -55);
      scene.add(rim);
      var fill = new THREE.DirectionalLight(0xbfc8dd, 0.85);
      fill.position.set(0, 40, 120);
      scene.add(fill);

      /* ---- floor + light pool ---- */
      var floor = new THREE.Mesh(
        new THREE.CircleGeometry(420, 64),
        new THREE.MeshStandardMaterial({ color: 0x0d1017, roughness: 0.95, metalness: 0 })
      );
      floor.rotation.x = -Math.PI / 2;
      scene.add(floor);

      var poolTex = (function () {
        var c = document.createElement('canvas'); c.width = c.height = 256;
        var g = c.getContext('2d');
        var grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
        grad.addColorStop(0, 'rgba(190,200,220,0.55)');
        grad.addColorStop(0.5, 'rgba(190,200,220,0.12)');
        grad.addColorStop(1, 'rgba(190,200,220,0)');
        g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
        return new THREE.CanvasTexture(c);
      })();
      var pool = new THREE.Mesh(
        new THREE.CircleGeometry(110, 48),
        new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0.35, depthWrite: false })
      );
      pool.rotation.x = -Math.PI / 2; pool.position.y = 0.05;
      scene.add(pool);

      /* ---- plinth ---- */
      var plinth = new THREE.Mesh(
        new THREE.CylinderGeometry(88, 94, 7, 56),
        new THREE.MeshStandardMaterial({ color: 0x151923, roughness: 0.6, metalness: 0.25 })
      );
      plinth.position.y = 3.5;
      scene.add(plinth);

      var ringMat = new THREE.MeshBasicMaterial({ color: rimColor, transparent: true, opacity: 0.75 });
      var ring = new THREE.Mesh(new THREE.TorusGeometry(88, 0.9, 10, 72), ringMat);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 7;
      scene.add(ring);

      /* ---- voxel car (instanced) — upright relief, museum-style ---- */
      var pts = data.pts, W = data.w, H = data.h, pal = data.pal;
      var SP = 0.88;                                  /* voxel spacing */
      var geo = new THREE.BoxGeometry(SP * 0.92, SP * 0.92, 2.8);
      var mat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.18 });
      var mesh = new THREE.InstancedMesh(geo, mat, pts.length);
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      var dummy = new THREE.Object3D();
      var col = new THREE.Color();
      var car = new THREE.Group();
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        var x = (p[0] - W / 2) * SP;
        var y = 7 + (H - p[1]) * SP;                  /* stand upright on plinth */
        dummy.position.set(x, y, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        var prgb = hexToRgb(pal[p[2]]);
        col.setRGB(prgb[0] / 255, prgb[1] / 255, prgb[2] / 255);
        mesh.setColorAt(i, col);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      car.add(mesh);
      scene.add(car);

      /* ---- dust motes in the spotlight beam ---- */
      var dust = null;
      if (!REDUCED) {
        var N = 260, pos = new Float32Array(N * 3), spd = new Float32Array(N);
        for (var d = 0; d < N; d++) {
          pos[d * 3] = (Math.random() - 0.5) * 160;
          pos[d * 3 + 1] = Math.random() * 90;
          pos[d * 3 + 2] = (Math.random() - 0.5) * 120;
          spd[d] = 0.02 + Math.random() * 0.05;
        }
        var dgeo = new THREE.BufferGeometry();
        dgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        dust = new THREE.Points(dgeo, new THREE.PointsMaterial({
          color: 0xcfd6e6, size: 0.55, transparent: true, opacity: 0.35,
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
        dust.userData.spd = spd;
        scene.add(dust);
      }

      /* ---- camera + interaction ---- */
      var theta = -0.35, phi = 0.10, radius = 185, tTheta = theta, tRadius = radius;
      var dragging = false, lastX = 0, lastY = 0, idle = 0;

      function applyCamera() {
        var y = radius * Math.sin(phi) + 30;
        var r = radius * Math.cos(phi);
        camera.position.set(r * Math.sin(theta), y, r * Math.cos(theta));
        camera.lookAt(0, 38, 0);
      }
      applyCamera();

      canvas.addEventListener('pointerdown', function (e) {
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        tTheta += (e.clientX - lastX) * 0.006;
        phi = Math.min(0.85, Math.max(0.14, phi + (e.clientY - lastY) * 0.004));
        lastX = e.clientX; lastY = e.clientY;
        idle = 0;
      });
      canvas.addEventListener('pointerup', function () { dragging = false; });
      canvas.addEventListener('wheel', function (e) {
        e.preventDefault();
        tRadius = Math.min(230, Math.max(85, tRadius + e.deltaY * 0.12));
      }, { passive: false });

      /* ---- resize ---- */
      function resize() {
        var w = container.clientWidth || 600, h = container.clientHeight || 340;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      if (window.ResizeObserver) new ResizeObserver(resize).observe(container);
      else window.addEventListener('resize', resize);
      resize();

      /* ---- loop ---- */
      var clock = new THREE.Clock();
      function tick() {
        var t = clock.getElapsedTime();
        idle += clock.getDelta ? 0 : 0; /* keep simple */
        if (!REDUCED && !dragging) {
          idle += 1 / 60;
          if (idle > 2.2) tTheta += 0.0032;           /* slow gallery spin when idle */
          ringMat.opacity = 0.55 + 0.25 * Math.sin(t * 1.6);
          rim.intensity = 1.15 + 0.35 * Math.sin(t * 1.6 + 1);
        }
        theta += (tTheta - theta) * 0.08;
        radius += (tRadius - radius) * 0.08;
        applyCamera();
        if (dust) {
          var pos = dust.geometry.attributes.position, spd = dust.userData.spd;
          for (var i = 0; i < spd.length; i++) {
            pos.array[i * 3 + 1] += spd[i];
            if (pos.array[i * 3 + 1] > 95) pos.array[i * 3 + 1] = 0;
          }
          pos.needsUpdate = true;
        }
        renderer.render(scene, camera);
        requestAnimationFrame(tick);
      }
      if (REDUCED) { renderer.render(scene, camera); }  /* single static frame */
      else requestAnimationFrame(tick);
    }
  }

  /* ------------------------------------------------- gallery wall drift */
  function mountWall(wall) {
    var cards = wall.querySelectorAll('.print-card');
    if (!cards.length || REDUCED || COARSE) return;
    var ticking = false;
    function drift() {
      ticking = false;
      var mid = window.innerHeight / 2;
      cards.forEach(function (card) {
        var r = card.getBoundingClientRect();
        if (r.bottom < -80 || r.top > window.innerHeight + 80) return;
        var d = (r.top + r.height / 2 - mid) / window.innerHeight; /* -0.5..0.5-ish */
        card.style.transform = 'perspective(1100px) rotateX(' + (d * -3.2).toFixed(2) + 'deg)';
      });
    }
    function onScroll() {
      if (!ticking) { ticking = true; requestAnimationFrame(drift); }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    drift();
  }

  /* ------------------------------------------------------ reveal on view */
  function reveal() {
    var els = Array.from(document.querySelectorAll('.print-card, .profile-kpi, .card')).filter(function (el) {
      if (el.closest('.no-reveal')) return false;
      /* Never hide elements inside switchable tab panels or collapsed <details>,
         where display:none prevents IntersectionObserver from firing cleanly. */
      if (el.closest('[data-tab-panel], details')) return false;
      return true;
    });
    if (!els.length) return;
    if (REDUCED || !('IntersectionObserver' in window)) {
      return;
    }
    var vh = window.innerHeight || 900;
    var toObserve = [];
    els.forEach(function (el) {
      var r = el.getBoundingClientRect();
      /* Elements already in the initial viewport stay visible immediately */
      if (r.top < vh && r.bottom > 0) return;
      el.classList.add('reveal');
      toObserve.push(el);
    });
    if (!toObserve.length) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          io.unobserve(en.target);
        }
      });
    }, { rootMargin: '0px', threshold: 0.01 });
    toObserve.forEach(function (el) { io.observe(el); });
  }

  function boot() {
    document.querySelectorAll('.plinth').forEach(mountPlinth);
    document.querySelectorAll('.wall3d').forEach(mountWall);
    reveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
