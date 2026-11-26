/**
 * TRAF1 — CareerFactoryIsoProcedural
 * 100% procedurally generated 2.5D isometric F1 Career Factory HQ renderer.
 * Extracted from the career_factory_iso.html sandbox and wired to the live career save.
 *
 * Additions over the sandbox engine:
 *   - 4-way isometric orientation (cycleOrientation() / setOrientation()) — freedom to view
 *     the facility from any corner instead of one locked angle.
 *   - Wheel zoom + setZoom() (clamped 0.62x–1.8x).
 *   - No auto-spin: the scene is a still diorama until you rotate it.
 *
 * Public API: new CareerFactoryIsoProcedural(containerEl, { onZoneSelect, onZoneFocus, onFps })
 *   .setState({ facility_level, active_staff_count, livery:{primary,secondary,accent} })
 *   .cycleOrientation(+1|-1) · .setZoom(f) · .cycleZone(dir) · .focusZoneById(id) · .destroy()
 */
(function (global) {
  "use strict";

  class CareerFactoryIsoProcedural {
    static TIERS = {
      1: { name: 'Grassroots Garage',    arch: 'brick',   desc: 'Single-bay brick workshop with retro tooling.' },
      2: { name: 'Privateer Workshop',   arch: 'brick',   desc: 'Expanded engineering desk & spares inventory.' },
      3: { name: 'Midfield Works',       arch: 'drywall', desc: 'Dual car bays, epoxy floor & CFD server farm.' },
      4: { name: 'Factory Contender',    arch: 'drywall', desc: 'Dedicated team hospitality lounge & trophy hall.' },
      5: { name: 'Elite Technology HQ',  arch: 'glass',   desc: 'MTC glass architecture, gantry crane & wind tunnel.' },
      6: { name: 'Championship Dynasty', arch: 'glass',   desc: 'Full telemetry wall, championship banners & peak aero.' },
    };

    static ZONES = [
      {
        id: 'garage', label: 'Chassis & Garage', tag: 'MANUFACTURING BAY', minLevel: 1,
        pin: { x: 4.4, y: 7.1, z: 2.3 }, bounds: { x: 1.4, y: 5.0, dx: 5.6, dy: 4.2 },
        desc: 'Primary race chassis assembly, suspension setup, and carbon layup bay.',
        stationIds: ['JOB_CAR1_WHEEL_FL', 'JOB_CAR1_WING', 'JOB_CAR2_ENGINE'],
        metrics: (lvl) => [
          { k: 'ACTIVE BAYS', v: lvl >= 3 ? '2 Race Chassis' : '1 Race Chassis' },
          { k: 'BUILD SPEED', v: `+${lvl * 14}%` },
          { k: 'FLOOR SPEC',  v: lvl >= 5 ? 'LED Porcelain' : lvl >= 3 ? 'Gloss Epoxy' : 'Raw Concrete' },
          { k: 'CRANE RIG',   v: lvl >= 5 ? 'Gantry Online' : 'Manual Hoist' },
        ],
      },
      {
        id: 'engineering', label: 'Design Office', tag: 'CAD & STRATEGY', minLevel: 1,
        pin: { x: 12.6, y: 7.4, z: 2.2 }, bounds: { x: 10.6, y: 5.4, dx: 4.8, dy: 4.4 },
        desc: 'Vehicle dynamics workstations, race strategy terminals, and telemetry analysis.',
        stationIds: ['JOB_DESK_01', 'JOB_DESK_02'],
        metrics: (lvl) => [
          { k: 'WORKSTATIONS', v: lvl >= 2 ? 'Dual Engineering' : 'Single Terminal' },
          { k: 'HARDWARE',     v: lvl >= 3 ? 'Dual-4K CAD' : 'Retro CRT Rig' },
          { k: 'R&D OUTPUT',   v: `${12 + lvl * 8} pts/wk` },
          { k: 'TELEMETRY',    v: lvl >= 6 ? 'Live Wall Sync' : 'Local Feed' },
        ],
      },
      {
        id: 'cfd_servers', label: 'CFD Server Farm', tag: 'COMPUTATIONAL FLUID DYNAMICS', minLevel: 3,
        pin: { x: 10.2, y: 1.9, z: 2.8 }, bounds: { x: 7.8, y: 0.5, dx: 4.8, dy: 2.6 },
        desc: 'High-density liquid-cooled compute cluster simulating millions of aero mesh cells.',
        stationIds: ['JOB_SERVER_TECH'],
        metrics: (lvl) => [
          { k: 'COMPUTE',     v: `${(lvl - 2) * 42} TFLOPS` },
          { k: 'AERO CORR.',  v: `${78 + lvl * 3}%` },
          { k: 'RACK UNITS',  v: lvl >= 5 ? '4x Tier-1 Blades' : '3x Midfield Racks' },
          { k: 'COOLING',     v: 'Closed-Loop Chilled' },
        ],
      },
      {
        id: 'lounge', label: 'Team Lounge', tag: 'HOSPITALITY & HERITAGE', minLevel: 4,
        pin: { x: 13.8, y: 3.3, z: 2.3 }, bounds: { x: 12.2, y: 1.4, dx: 3.4, dy: 3.6 },
        desc: 'Sponsor hospitality suite, driver briefing lounge, and illuminated championship trophy cabinet.',
        stationIds: ['JOB_LOUNGE_BRIEF'],
        metrics: (lvl) => [
          { k: 'MORALE BOOST', v: `+${(lvl - 3) * 7}%` },
          { k: 'SPONSOR TIER', v: lvl >= 6 ? 'Title Partner' : lvl >= 5 ? 'Global' : 'Regional' },
          { k: 'DRIVER APPEAL', v: `${70 + lvl * 5}/100` },
          { k: 'TROPHY CASE',  v: lvl >= 6 ? 'Championship Gold' : 'Podium Silver' },
        ],
      },
      {
        id: 'wind_tunnel', label: 'Aero Wind Tunnel', tag: '60% SCALE ROLLING ROAD', minLevel: 5,
        pin: { x: 3.5, y: 2.4, z: 2.9 }, bounds: { x: 0.6, y: 0.5, dx: 6.2, dy: 3.8 },
        desc: 'Closed-circuit laminar wind tunnel with rolling road belt and laser PIV airflow visualization.',
        stationIds: ['JOB_TUNNEL_OBS'],
        metrics: (lvl) => [
          { k: 'WIND SPEED',  v: '180 km/h Laminar' },
          { k: 'DOWNFORCE',   v: lvl >= 6 ? '+26% Aero Gain' : '+18% Aero Gain' },
          { k: 'SCALE MODEL', v: '60% Carbon Spec' },
          { k: 'CALIBRATION', v: lvl >= 6 ? '99.4% Precision' : '96.2% Precision' },
        ],
      },
    ];

    static JOB_STATIONS = [
      { id: 'JOB_CAR1_WHEEL_FL', minLevel: 1, x: 5.55, y: 8.15, z: 0, pose: 'kneel_wrench', facing: -1, phase: 0.0 },
      { id: 'JOB_CAR1_WING',     minLevel: 1, x: 6.75, y: 6.85, z: 0, pose: 'inspect',      facing: -1, phase: 1.3 },
      { id: 'JOB_DESK_01',       minLevel: 1, x: 12.1, y: 7.75, z: 0, pose: 'typing',       facing: -1, phase: 2.4 },
      { id: 'JOB_DESK_02',       minLevel: 2, x: 13.7, y: 8.65, z: 0, pose: 'typing',       facing: -1, phase: 3.8 },
      { id: 'JOB_CAR2_ENGINE',   minLevel: 3, x: 8.65, y: 9.75, z: 0, pose: 'wrench_stand', facing: -1, phase: 0.7 },
      { id: 'JOB_SERVER_TECH',   minLevel: 3, x: 10.3, y: 2.75, z: 0, pose: 'tablet',       facing: -1, phase: 4.5 },
      { id: 'JOB_LOUNGE_BRIEF',  minLevel: 4, x: 13.4, y: 3.85, z: 0, pose: 'sit_tablet',   facing:  1, phase: 2.1 },
      { id: 'JOB_TUNNEL_OBS',    minLevel: 5, x: 3.9,  y: 4.45, z: 0, pose: 'clipboard',    facing: -1, phase: 5.2 },
    ];

    constructor(containerEl, options = {}) {
      this.container = containerEl;
      this.options = options;

      this.canvas = document.createElement('canvas');
      this.canvas.style.cssText = 'width:100%;height:100%;display:block;cursor:pointer;';
      this.container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      this.state = {
        facility_level: 1,
        active_staff_count: 4,
        livery: { primary: '#ff8000', secondary: '#181c24', accent: '#47c7fc' },
      };

      this.worldW = 16;
      this.worldD = 11;
      this.wallH = 4.9;

      this.width = 0;
      this.height = 0;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.tileW = 36;
      this.tileH = 18;
      this.tileZ = 34;
      this.originX = 0;
      this.originY = 0;

      // View freedom: 4-way isometric orientation + wheel zoom, zero auto-spin.
      this.orientation = 0;   // 0..3 quarter turns
      this.zoomFactor = 1.0;  // clamped 0.62..1.8

      this.focusedZoneId = 'garage';
      this.hoveredZoneId = null;
      this.pinScreenCoords = [];

      this.rafId = null;
      this.startTime = performance.now();
      this.fpsFrames = 0;
      this.fpsTimer = this.startTime;

      this._floorCracks = [
        [[2.1, 2.3], [2.7, 2.6], [3.2, 2.5], [3.6, 3.0]],
        [[7.5, 4.1], [8.1, 4.4], [8.5, 5.1]],
        [[4.2, 9.2], [4.9, 9.4], [5.4, 9.1]],
        [[11.2, 6.1], [11.9, 5.8], [12.4, 6.2]],
      ];
      this._oilPatches = [
        { x: 4.1, y: 7.4, rx: 0.75, ry: 0.42 },
        { x: 6.2, y: 6.3, rx: 0.45, ry: 0.28 },
        { x: 8.8, y: 8.1, rx: 0.55, ry: 0.35 },
      ];

      this._bindEvents();
      this.resize();
      this.start();
    }

    /* ---------------- PUBLIC API ---------------- */

    setState(partialState) {
      if (partialState.facility_level !== undefined) {
        this.state.facility_level = Math.max(1, Math.min(6, Math.round(partialState.facility_level)));
      }
      if (partialState.active_staff_count !== undefined) {
        this.state.active_staff_count = Math.max(0, Math.min(8, Math.round(partialState.active_staff_count)));
      }
      if (partialState.livery) {
        this.state.livery = { ...this.state.livery, ...partialState.livery };
      }
      const unlocked = this.getUnlockedZones();
      if (!unlocked.some((z) => z.id === this.focusedZoneId) && unlocked.length) {
        this.focusedZoneId = unlocked[0].id;
        if (this.options.onZoneFocus) this.options.onZoneFocus(unlocked[0]);
      }
    }

    getUnlockedZones() {
      return CareerFactoryIsoProcedural.ZONES.filter((z) => this.state.facility_level >= z.minLevel);
    }

    getFocusedZone() {
      const unlocked = this.getUnlockedZones();
      return unlocked.find((z) => z.id === this.focusedZoneId) || unlocked[0];
    }

    cycleZone(dir = 1) {
      const unlocked = this.getUnlockedZones();
      if (!unlocked.length) return null;
      const idx = unlocked.findIndex((z) => z.id === this.focusedZoneId);
      const nextIdx = (idx + dir + unlocked.length) % unlocked.length;
      this.focusedZoneId = unlocked[nextIdx].id;
      if (this.options.onZoneFocus) this.options.onZoneFocus(unlocked[nextIdx]);
      return unlocked[nextIdx];
    }

    focusZoneById(zoneId) {
      const unlocked = this.getUnlockedZones();
      const found = unlocked.find((z) => z.id === zoneId);
      if (found) {
        this.focusedZoneId = found.id;
        if (this.options.onZoneFocus) this.options.onZoneFocus(found);
      }
    }

    setOrientation(k) {
      this.orientation = ((k % 4) + 4) % 4;
    }

    cycleOrientation(dir = 1) {
      this.setOrientation(this.orientation + dir);
      return this.orientation;
    }

    setZoom(f) {
      this.zoomFactor = Math.max(0.62, Math.min(1.8, f));
      this.resize();
    }

    getActiveStaffForZone(zone) {
      const active = CareerFactoryIsoProcedural.JOB_STATIONS
        .filter((s) => this.state.facility_level >= s.minLevel)
        .slice(0, this.state.active_staff_count);
      return active.filter((s) => zone.stationIds.includes(s.id)).length;
    }

    resize() {
      const rect = this.container.getBoundingClientRect();
      this.width = Math.max(320, rect.width);
      this.height = Math.max(240, rect.height);
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);

      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);

      const spanX = (this.worldW + this.worldD);
      const spanY = (this.worldW + this.worldD) * 0.5 + this.wallH * 1.15;

      const scaleFromW = (this.width * 0.90) / spanX;
      const scaleFromH = (this.height * 0.88) / spanY;
      this.tileW = Math.max(12, Math.min(scaleFromW, scaleFromH)) * this.zoomFactor;
      this.tileH = this.tileW * 0.5;
      this.tileZ = this.tileW * 0.96;

      const centerOffsetX = (this.worldW - this.worldD) * 0.5 * this.tileW;
      const totalDrawH = (this.worldW + this.worldD) * this.tileH + this.wallH * this.tileZ;
      this.originX = this.width * 0.5 - centerOffsetX;
      this.originY = (this.height - totalDrawH) * 0.5 + this.wallH * this.tileZ + this.height * 0.03;
    }

    start() {
      if (this.rafId) return;
      const loop = (now) => {
        this.render((now - this.startTime) * 0.001);
        this.fpsFrames++;
        if (now - this.fpsTimer >= 500) {
          const fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsTimer));
          if (this.options.onFps) this.options.onFps(fps);
          this.fpsFrames = 0;
          this.fpsTimer = now;
        }
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    }

    destroy() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = null;
      if (this._onResize) window.removeEventListener('resize', this._onResize);
      if (this.canvas) this.canvas.remove();
    }

    /* ---------------- ORIENTATION TRANSFORMS ----------------
     * Canonical zone coordinates stay fixed; iso() projects the rotated view. */

    _rot(x, y) {
      const W = this.worldW, D = this.worldD;
      switch (this.orientation) {
        case 1: return { x: y, y: W - x };
        case 2: return { x: W - x, y: D - y };
        case 3: return { x: D - y, y: x };
        default: return { x, y };
      }
    }

    _unrot(rx, ry) {
      const W = this.worldW, D = this.worldD;
      switch (this.orientation) {
        case 1: return { x: W - ry, y: rx };
        case 2: return { x: W - rx, y: D - ry };
        case 3: return { x: ry, y: D - rx };
        default: return { x: rx, y: ry };
      }
    }

    iso(x, y, z = 0) {
      const r = this._rot(x, y);
      return {
        x: this.originX + (r.x - r.y) * this.tileW,
        y: this.originY + (r.x + r.y) * this.tileH - z * this.tileZ,
      };
    }

    screenToWorldFloor(sx, sy) {
      const dx = (sx - this.originX) / this.tileW;
      const dy = (sy - this.originY) / this.tileH;
      const rx = (dx + dy) * 0.5;
      const ry = (dy - dx) * 0.5;
      return this._unrot(rx, ry);
    }

    /* ---------------- POINTER & HIT-TESTING ---------------- */

    _bindEvents() {
      this._onResize = () => this.resize();
      window.addEventListener('resize', this._onResize);

      const getLocalPos = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: clientX - rect.left, y: clientY - rect.top };
      };

      this.canvas.addEventListener('mousemove', (e) => {
        const pos = getLocalPos(e);
        const hit = this._hitTestZone(pos.x, pos.y);
        this.hoveredZoneId = hit ? hit.id : null;
        this.canvas.style.cursor = hit ? 'pointer' : 'default';
      });

      this.canvas.addEventListener('mouseleave', () => { this.hoveredZoneId = null; });

      this.canvas.addEventListener('click', (e) => {
        const pos = getLocalPos(e);
        const hit = this._hitTestZone(pos.x, pos.y);
        if (hit) {
          this.focusedZoneId = hit.id;
          if (this.options.onZoneFocus) this.options.onZoneFocus(hit);
          if (this.options.onZoneSelect) this.options.onZoneSelect(hit);
        }
      });

      // Wheel zoom — the scene is a diorama, so zoom is the natural navigation.
      this.canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.setZoom(this.zoomFactor + (e.deltaY > 0 ? -0.08 : 0.08));
      }, { passive: false });
    }

    _hitTestZone(px, py) {
      for (let i = this.pinScreenCoords.length - 1; i >= 0; i--) {
        const p = this.pinScreenCoords[i];
        if (px >= p.x - p.w * 0.5 && px <= p.x + p.w * 0.5 && py >= p.y - p.h * 0.5 && py <= p.y + p.h * 0.5) {
          return p.zone;
        }
      }
      const world = this.screenToWorldFloor(px, py);
      const unlocked = this.getUnlockedZones();
      for (const z of unlocked) {
        const b = z.bounds;
        if (world.x >= b.x && world.x <= b.x + b.dx && world.y >= b.y && world.y <= b.y + b.dy) {
          return z;
        }
      }
      return null;
    }

    /* ---------------- COLOR UTILITIES ---------------- */

    static hexToRgb(hex) {
      const clean = (hex || '#888888').replace('#', '');
      const num = parseInt(clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean, 16);
      return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    }

    static shade(hex, factor) {
      const { r, g, b } = CareerFactoryIsoProcedural.hexToRgb(hex);
      const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
      return `rgb(${clamp(r * factor)}, ${clamp(g * factor)}, ${clamp(b * factor)})`;
    }

    static rgba(hex, alpha) {
      const { r, g, b } = CareerFactoryIsoProcedural.hexToRgb(hex);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    static mix(hexA, hexB, t) {
      const a = CareerFactoryIsoProcedural.hexToRgb(hexA);
      const b = CareerFactoryIsoProcedural.hexToRgb(hexB);
      const lerp = (u, v) => Math.round(u + (v - u) * t);
      return `rgb(${lerp(a.r, b.r)}, ${lerp(a.g, b.g)}, ${lerp(a.b, b.b)})`;
    }

    /* ---------------- DRAWING PRIMITIVES ---------------- */

    drawPoly(pts, fill, stroke = null, lineWidth = 1) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
    }

    drawIsoBox(x, y, z, dx, dy, dz, baseColor, opts = {}) {
      const topCol   = opts.top   || CareerFactoryIsoProcedural.shade(baseColor, 1.16);
      const rightCol = opts.right || CareerFactoryIsoProcedural.shade(baseColor, 0.88);
      const leftCol  = opts.left  || CareerFactoryIsoProcedural.shade(baseColor, 0.64);
      const stroke   = opts.stroke || 'rgba(0,0,0,0.22)';

      const p000 = this.iso(x,      y,      z);
      const p100 = this.iso(x + dx, y,      z);
      const p110 = this.iso(x + dx, y + dy, z);
      const p010 = this.iso(x,      y + dy, z);

      const p001 = this.iso(x,      y,      z + dz);
      const p101 = this.iso(x + dx, y,      z + dz);
      const p111 = this.iso(x + dx, y + dy, z + dz);
      const p011 = this.iso(x,      y + dy, z + dz);

      this.drawPoly([p010, p110, p111, p011], leftCol, stroke, 0.7);
      this.drawPoly([p100, p110, p111, p101], rightCol, stroke, 0.7);
      this.drawPoly([p001, p101, p111, p011], topCol, stroke, 0.7);

      if (opts.highlight !== false) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.moveTo(p011.x, p011.y);
        ctx.lineTo(p111.x, p111.y);
        ctx.lineTo(p101.x, p101.y);
        ctx.strokeStyle = opts.highlightColor || 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
    }

    drawContactShadow(cx, cy, rx, ry, alpha = 0.42) {
      const ctx = this.ctx;
      const p = this.iso(cx, cy, 0.01);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(1, 0.52);
      const r = Math.max(rx, ry) * this.tileW * 1.1;
      const grad = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r);
      grad.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
      grad.addColorStop(0.65, `rgba(0, 0, 0, ${alpha * 0.55})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * this.tileW * 1.25, ry * this.tileW * 1.25, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawGlassQuad(pts, tint = '#88ccff', alpha = 0.22, border = 'rgba(210,235,255,0.35)') {
      const ctx = this.ctx;
      ctx.save();
      this.drawPoly(pts, CareerFactoryIsoProcedural.rgba(tint, alpha), border, 1);
      ctx.clip();
      const minX = Math.min(...pts.map(p => p.x));
      const maxX = Math.max(...pts.map(p => p.x));
      const minY = Math.min(...pts.map(p => p.y));
      const maxY = Math.max(...pts.map(p => p.y));
      const grad = ctx.createLinearGradient(minX, minY, maxX, maxY);
      grad.addColorStop(0.0, 'rgba(255,255,255,0.0)');
      grad.addColorStop(0.28, 'rgba(255,255,255,0.16)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.03)');
      grad.addColorStop(0.62, 'rgba(255,255,255,0.12)');
      grad.addColorStop(0.70, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
      ctx.restore();
    }

    /* ---------------- MAIN FRAME RENDER ---------------- */

    render(t) {
      const ctx = this.ctx;
      ctx.save();
      ctx.scale(this.dpr, this.dpr);

      const bgGrad = ctx.createRadialGradient(
        this.width * 0.5, this.height * 0.42, this.width * 0.08,
        this.width * 0.5, this.height * 0.5, this.width * 0.78
      );
      bgGrad.addColorStop(0, '#141a29');
      bgGrad.addColorStop(0.65, '#0b0e17');
      bgGrad.addColorStop(1, '#06080d');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, this.width, this.height);

      const lvl = this.state.facility_level;
      const livery = this.state.livery;

      this._drawFloorSlab(lvl, livery, t);
      this._drawBackWalls(lvl, livery, t);
      this._drawZoneFloorHighlights(t);

      const queue = [];
      const add = (depth, fn) => queue.push({ depth, fn });

      if (lvl <= 2) {
        add(2.0 + 1.5, () => this._drawCrate(1.1, 1.1, 0, 1.0, 1.0, 0.95));
        add(2.0 + 1.5 + 0.1, () => this._drawCrate(1.15, 1.15, 0.95, 0.85, 0.85, 0.78));
        add(2.3 + 2.3, () => this._drawCrate(2.3, 1.0, 0, 1.1, 0.95, 0.88));
        add(1.4 + 3.0, () => this._drawTireStack(1.1, 2.7, 3, livery.accent));
        add(4.0 + 1.4, () => this._drawToolBench(3.8, 0.7, livery));
      }

      if (lvl >= 3) {
        const rackCount = lvl >= 5 ? 4 : 3;
        for (let i = 0; i < rackCount; i++) {
          const rx = 8.1 + i * 1.1;
          add(rx + 1.1, () => this._drawServerRack(rx, 0.75, i, t, livery));
        }
      }

      if (lvl >= 4) {
        add(13.2 + 1.1, () => this._drawTrophyCabinet(12.6, 0.65, lvl, t, livery));
        add(14.5 + 2.7, () => this._drawLoungeSofa(14.0, 2.0, livery));
        add(13.0 + 3.2, () => this._drawGlassCoffeeTable(12.6, 2.8, livery));
        add(15.0 + 4.3, () => this._drawPlantPot(14.8, 4.2));
      }

      if (lvl >= 5) {
        add(3.6 + 2.4, () => this._drawWindTunnel(0.85, 0.85, t, livery));
      }

      add(4.2 + 7.0, () => this._drawF1Car(2.1, 6.2, livery, 1, t));
      add(2.4 + 5.3, () => this._drawToolCabinet(1.8, 5.1, livery));
      if (lvl >= 3) {
        add(6.6 + 5.5, () => this._drawDiagnosticStand(6.3, 5.3, t, livery));
      }

      if (lvl >= 3) {
        add(8.2 + 8.6, () => this._drawF1Car(6.1, 7.8, livery, 2, t));
        add(6.4 + 9.8, () => this._drawToolCabinet(5.8, 9.5, livery));
      }

      add(12.6 + 6.9, () => this._drawEngineeringDesk(11.6, 6.4, lvl, t, livery, 0));
      if (lvl >= 2) {
        add(14.2 + 7.9, () => this._drawEngineeringDesk(13.2, 7.4, lvl, t, livery, 1));
      }

      const activeStations = CareerFactoryIsoProcedural.JOB_STATIONS
        .filter((s) => lvl >= s.minLevel)
        .slice(0, this.state.active_staff_count);

      activeStations.forEach((st) => {
        add(st.x + st.y + 0.15, () => this._drawStaffMember(st, t, livery));
      });

      queue.sort((a, b) => a.depth - b.depth);
      for (const item of queue) item.fn();

      if (lvl >= 5) {
        this._drawOverheadGantryCrane(t, livery);
      }
      if (lvl >= 6) {
        this._drawChampionshipBanners(livery, t);
      }
      this._drawOverheadLighting(lvl, livery, t);
      this._drawZonePins(t, livery);

      ctx.restore();
    }

    /* ---------------- FLOOR & WALLS (transcribed from the sandbox) ---------------- */

    _drawFloorSlab(lvl, livery, t) {
      const ctx = this.ctx;
      const W = this.worldW;
      const D = this.worldD;
      const slabH = 0.42;

      const p00 = this.iso(0, 0, 0);
      const p10 = this.iso(W, 0, 0);
      const p11 = this.iso(W, D, 0);
      const p01 = this.iso(0, D, 0);

      const p10b = this.iso(W, 0, -slabH);
      const p11b = this.iso(W, D, -slabH);
      const p01b = this.iso(0, D, -slabH);

      this.drawPoly([p01, p11, p11b, p01b], '#141923', 'rgba(0,0,0,0.45)', 1);
      this.drawPoly([p10, p11, p11b, p10b], '#1c2331', 'rgba(0,0,0,0.45)', 1);

      let floorFill;
      if (lvl <= 2) {
        const g = ctx.createLinearGradient(p00.x, p00.y, p11.x, p11.y);
        g.addColorStop(0, '#3a3d42');
        g.addColorStop(0.5, '#33363b');
        g.addColorStop(1, '#2a2d32');
        floorFill = g;
      } else if (lvl <= 4) {
        const g = ctx.createLinearGradient(p00.x, p00.y, p11.x, p11.y);
        g.addColorStop(0, '#464e5d');
        g.addColorStop(0.5, '#3b4352');
        g.addColorStop(1, '#2f3644');
        floorFill = g;
      } else {
        const g = ctx.createLinearGradient(p00.x, p00.y, p11.x, p11.y);
        g.addColorStop(0, '#2a3140');
        g.addColorStop(0.45, '#222836');
        g.addColorStop(1, '#1a1f2b');
        floorFill = g;
      }

      this.drawPoly([p00, p10, p11, p01], floorFill, 'rgba(255,255,255,0.08)', 1);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p00.x, p00.y);
      ctx.lineTo(p10.x, p10.y);
      ctx.lineTo(p11.x, p11.y);
      ctx.lineTo(p01.x, p01.y);
      ctx.closePath();
      ctx.clip();

      const step = lvl <= 2 ? 2 : 1;
      ctx.strokeStyle = lvl <= 2 ? 'rgba(0,0,0,0.22)' : lvl <= 4 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = lvl <= 2 ? 1.1 : 0.8;
      for (let x = step; x < W; x += step) {
        const a = this.iso(x, 0, 0);
        const b = this.iso(x, D, 0);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      for (let y = step; y < D; y += step) {
        const a = this.iso(0, y, 0);
        const b = this.iso(W, y, 0);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }

      if (lvl <= 2) {
        ctx.strokeStyle = 'rgba(15,15,18,0.45)';
        ctx.lineWidth = 1;
        for (const crack of this._floorCracks) {
          ctx.beginPath();
          crack.forEach(([cx, cy], idx) => {
            const p = this.iso(cx, cy, 0);
            if (idx === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();
        }
        for (const oil of this._oilPatches) {
          this.drawContactShadow(oil.x, oil.y, oil.rx, oil.ry, 0.25);
        }
      } else {
        const sheen = ctx.createLinearGradient(p01.x, p01.y, p10.x, p10.y);
        sheen.addColorStop(0.0, 'rgba(255,255,255,0)');
        sheen.addColorStop(0.35, lvl >= 5 ? 'rgba(160,210,255,0.07)' : 'rgba(255,255,255,0.05)');
        sheen.addColorStop(0.45, 'rgba(255,255,255,0)');
        sheen.addColorStop(0.72, lvl >= 5 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)');
        sheen.addColorStop(1.0, 'rgba(255,255,255,0)');
        ctx.fillStyle = sheen;
        ctx.fillRect(0, 0, this.width, this.height);
      }

      this._drawCarBayPad(1.7, 5.5, 4.9, 2.8, lvl, livery, 'BAY 01', t);
      if (lvl >= 3) {
        this._drawCarBayPad(5.7, 7.1, 4.9, 2.8, lvl, livery, 'BAY 02', t);
      }

      if (lvl >= 4) {
        const lp = [
          this.iso(12.2, 1.6, 0.01),
          this.iso(15.4, 1.6, 0.01),
          this.iso(15.4, 4.9, 0.01),
          this.iso(12.2, 4.9, 0.01),
        ];
        this.drawPoly(lp, CareerFactoryIsoProcedural.rgba(livery.secondary, 0.55), CareerFactoryIsoProcedural.rgba(livery.accent, 0.45), 1.2);
      }

      if (lvl >= 5) {
        const glow = 0.65 + Math.sin(t * 2.2) * 0.2;
        const drawLedLine = (x1, y1, x2, y2) => {
          const a = this.iso(x1, y1, 0.02);
          const b = this.iso(x2, y2, 0.02);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = CareerFactoryIsoProcedural.rgba(livery.accent, glow);
          ctx.lineWidth = 2.2;
          ctx.shadowColor = livery.accent;
          ctx.shadowBlur = 10;
          ctx.stroke();
          ctx.restore();
        };
        drawLedLine(0.6, 4.7, 11.4, 4.7);
        drawLedLine(11.4, 4.7, 11.4, 10.4);
        drawLedLine(7.3, 0.5, 7.3, 4.7);
      }

      ctx.restore();
    }

    _drawCarBayPad(x, y, dx, dy, lvl, livery, label, t) {
      const ctx = this.ctx;
      const pts = [
        this.iso(x, y, 0.01),
        this.iso(x + dx, y, 0.01),
        this.iso(x + dx, y + dy, 0.01),
        this.iso(x, y + dy, 0.01),
      ];

      const padFill = lvl <= 2
        ? 'rgba(20, 22, 26, 0.42)'
        : lvl <= 4
          ? 'rgba(24, 30, 40, 0.52)'
          : 'rgba(13, 17, 25, 0.72)';

      const borderCol = lvl <= 2
        ? 'rgba(234, 179, 8, 0.55)'
        : lvl <= 4
          ? CareerFactoryIsoProcedural.rgba(livery.primary, 0.75)
          : CareerFactoryIsoProcedural.rgba(livery.accent, 0.85);

      this.drawPoly(pts, padFill, borderCol, lvl >= 5 ? 1.8 : 1.3);

      const inset = 0.25;
      const inner = [
        this.iso(x + inset, y + inset, 0.01),
        this.iso(x + dx - inset, y + inset, 0.01),
        this.iso(x + dx - inset, y + dy - inset, 0.01),
        this.iso(x + inset, y + dy - inset, 0.01),
      ];
      this.drawPoly(inner, null, 'rgba(255,255,255,0.12)', 0.8);

      const lp = this.iso(x + dx - 0.55, y + dy - 0.35, 0.02);
      ctx.save();
      ctx.fillStyle = lvl <= 2 ? 'rgba(234,179,8,0.65)' : 'rgba(255,255,255,0.45)';
      ctx.font = `700 ${Math.max(8, Math.round(this.tileW * 0.26))}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(label, lp.x, lp.y);
      ctx.restore();
    }

    _drawBackWalls(lvl, livery, t) {
      const ctx = this.ctx;
      const W = this.worldW;
      const D = this.worldD;
      const H = this.wallH;
      const thick = 0.32;

      const leftWall = [
        this.iso(0, 0, 0),
        this.iso(0, D, 0),
        this.iso(0, D, H),
        this.iso(0, 0, H),
      ];
      const rightWall = [
        this.iso(0, 0, 0),
        this.iso(W, 0, 0),
        this.iso(W, 0, H),
        this.iso(0, 0, H),
      ];

      const leftCap = [
        this.iso(0, 0, H),
        this.iso(0, D, H),
        this.iso(-thick, D, H),
        this.iso(-thick, -thick, H),
      ];
      const rightCap = [
        this.iso(0, 0, H),
        this.iso(W, 0, H),
        this.iso(W, -thick, H),
        this.iso(-thick, -thick, H),
      ];

      if (lvl <= 2) {
        this.drawPoly(leftWall, '#4a312c', '#241816', 1);
        this.drawPoly(rightWall, '#5a3c35', '#241816', 1);
        this._drawBrickPattern(0, D, H, true);
        this._drawBrickPattern(W, 0, H, false);
        this.drawPoly(leftCap, '#2b2424', '#1a1515', 0.8);
        this.drawPoly(rightCap, '#332b2b', '#1a1515', 0.8);

        this._drawWallStripe(0, D, 0, 0.35, true, '#272a30');
        this._drawWallStripe(W, 0, 0, 0.35, false, '#2e323a');
        this._drawWallTeamPlaque(6.2, 0.02, 2.3, 2.6, 1.2, livery);
      } else if (lvl <= 4) {
        const lg = ctx.createLinearGradient(leftWall[3].x, leftWall[3].y, leftWall[0].x, leftWall[0].y);
        lg.addColorStop(0, '#363e4d');
        lg.addColorStop(1, '#272d38');
        this.drawPoly(leftWall, lg, '#1b2029', 1);

        const rg = ctx.createLinearGradient(rightWall[3].x, rightWall[3].y, rightWall[0].x, rightWall[0].y);
        rg.addColorStop(0, '#454f62');
        rg.addColorStop(1, '#313948');
        this.drawPoly(rightWall, rg, '#1b2029', 1);

        ctx.strokeStyle = 'rgba(0,0,0,0.22)';
        ctx.lineWidth = 1;
        for (let y = 2; y < D; y += 2) {
          const a = this.iso(0, y, 0), b = this.iso(0, y, H);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        for (let x = 2; x < W; x += 2) {
          const a = this.iso(x, 0, 0), b = this.iso(x, 0, H);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }

        this._drawWallStripe(0, D, 1.55, 0.55, true, CareerFactoryIsoProcedural.shade(livery.primary, 0.85));
        this._drawWallStripe(0, D, 2.15, 0.14, true, livery.accent);
        this._drawWallStripe(W, 0, 1.55, 0.55, false, livery.primary);
        this._drawWallStripe(W, 0, 2.15, 0.14, false, livery.accent);

        this._drawWallTeamPlaque(5.2, 0.02, 2.7, 3.2, 1.3, livery);

        this.drawPoly(leftCap, '#252b36', '#161a22', 0.8);
        this.drawPoly(rightCap, '#2d3442', '#161a22', 0.8);
      } else {
        const skyL = ctx.createLinearGradient(leftWall[3].x, leftWall[3].y, leftWall[0].x, leftWall[0].y);
        skyL.addColorStop(0, '#101c30');
        skyL.addColorStop(0.65, '#192a42');
        skyL.addColorStop(1, '#0d1522');
        this.drawPoly(leftWall, skyL, '#0e131c', 1);

        const skyR = ctx.createLinearGradient(rightWall[3].x, rightWall[3].y, rightWall[0].x, rightWall[0].y);
        skyR.addColorStop(0, '#14233b');
        skyR.addColorStop(0.65, '#1e334f');
        skyR.addColorStop(1, '#101a2a');
        this.drawPoly(rightWall, skyR, '#0e131c', 1);

        this.drawGlassQuad(leftWall, '#6db8ff', 0.16, 'rgba(180,220,255,0.22)');
        this.drawGlassQuad(rightWall, '#7ec4ff', 0.18, 'rgba(180,220,255,0.25)');

        const mullionCol = '#141820';
        ctx.strokeStyle = mullionCol;
        ctx.lineWidth = Math.max(2.2, this.tileW * 0.085);
        for (let y = 0; y <= D; y += 2.2) {
          const a = this.iso(0, Math.min(y, D), 0);
          const b = this.iso(0, Math.min(y, D), H);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        for (let x = 0; x <= W; x += 2.0) {
          const a = this.iso(Math.min(x, W), 0, 0);
          const b = this.iso(Math.min(x, W), 0, H);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        [1.6, 3.3, H].forEach((zh) => {
          const a1 = this.iso(0, 0, zh), b1 = this.iso(0, D, zh);
          const a2 = this.iso(0, 0, zh), b2 = this.iso(W, 0, zh);
          ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
        });

        this._drawWallStripe(0, D, 0, 0.55, true, '#151922');
        this._drawWallStripe(W, 0, 0, 0.55, false, '#1b202b');
        this._drawWallStripe(0, D, 0.55, 0.08, true, livery.primary);
        this._drawWallStripe(W, 0, 0.55, 0.08, false, livery.primary);

        if (lvl >= 6) {
          this._drawTelemetryWallDisplay(7.6, 0.04, 2.5, 4.4, 1.55, t, livery, false);
          this._drawTelemetryWallDisplay(0.04, 5.4, 2.3, 3.6, 1.45, t, livery, true);
        }

        this.drawPoly(leftCap, '#181e29', '#0c0f15', 1);
        this.drawPoly(rightCap, '#202736', '#0c0f15', 1);
      }

      this.drawIsoBox(-0.15, -0.15, 0, 0.42, 0.42, H + 0.05, lvl >= 5 ? '#1b202b' : '#353a44');
    }

    _drawBrickPattern(lenX, lenY, H, isLeftWall) {
      const ctx = this.ctx;
      const rows = 14;
      const rowH = H / rows;
      const totalLen = isLeftWall ? lenY : lenX;
      const brickLen = 0.72;

      ctx.strokeStyle = 'rgba(28, 22, 20, 0.55)';
      ctx.lineWidth = 0.75;

      for (let r = 0; r < rows; r++) {
        const z0 = r * rowH;
        const z1 = (r + 1) * rowH;
        const hA = this.iso(0, 0, z0);
        const hB = isLeftWall ? this.iso(0, totalLen, z0) : this.iso(totalLen, 0, z0);
        ctx.beginPath(); ctx.moveTo(hA.x, hA.y); ctx.lineTo(hB.x, hB.y); ctx.stroke();

        const offset = (r % 2) * (brickLen * 0.5);
        for (let pos = offset; pos < totalLen; pos += brickLen) {
          const p0 = isLeftWall ? this.iso(0, pos, z0) : this.iso(pos, 0, z0);
          const p1 = isLeftWall ? this.iso(0, pos, z1) : this.iso(pos, 0, z1);
          ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();

          const hash = Math.sin(r * 19.3 + pos * 7.1) * 43758.5453;
          const frac = hash - Math.floor(hash);
          if (frac > 0.74 && pos + brickLen <= totalLen) {
            const bPts = isLeftWall
              ? [this.iso(0, pos, z0), this.iso(0, pos + brickLen, z0), this.iso(0, pos + brickLen, z1), this.iso(0, pos, z1)]
              : [this.iso(pos, 0, z0), this.iso(pos + brickLen, 0, z0), this.iso(pos + brickLen, 0, z1), this.iso(pos, 0, z1)];
            this.drawPoly(bPts, frac > 0.88 ? 'rgba(0,0,0,0.14)' : 'rgba(255,190,150,0.07)');
          }
        }
      }
    }

    _drawWallStripe(lenX, lenY, z0, dz, isLeftWall, color) {
      const pts = isLeftWall
        ? [this.iso(0.01, 0, z0), this.iso(0.01, lenY, z0), this.iso(0.01, lenY, z0 + dz), this.iso(0.01, 0, z0 + dz)]
        : [this.iso(0, 0.01, z0), this.iso(lenX, 0.01, z0), this.iso(lenX, 0.01, z0 + dz), this.iso(0, 0.01, z0 + dz)];
      this.drawPoly(pts, color);
    }

    _drawWallTeamPlaque(x, y, z, w, h, livery) {
      const ctx = this.ctx;
      const pts = [
        this.iso(x, y, z),
        this.iso(x + w, y, z),
        this.iso(x + w, y, z + h),
        this.iso(x, y, z + h),
      ];
      this.drawPoly(pts, '#141821', 'rgba(255,255,255,0.2)', 1);

      const stripe = [
        this.iso(x + 0.15, y, z + 0.15),
        this.iso(x + 0.85, y, z + 0.15),
        this.iso(x + 1.15, y, z + h - 0.15),
        this.iso(x + 0.45, y, z + h - 0.15),
      ];
      this.drawPoly(stripe, livery.primary);

      const c = this.iso(x + w * 0.62, y, z + h * 0.48);
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.font = `800 ${Math.max(9, Math.round(this.tileW * 0.34))}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('TRAF1', c.x, c.y);
      ctx.restore();
    }

    _drawTelemetryWallDisplay(x, y, z, len, h, t, livery, isLeftWall = false) {
      const ctx = this.ctx;
      const pts = isLeftWall
        ? [this.iso(x, y, z), this.iso(x, y + len, z), this.iso(x, y + len, z + h), this.iso(x, y, z + h)]
        : [this.iso(x, y, z), this.iso(x + len, y, z), this.iso(x + len, y, z + h), this.iso(x, y, z + h)];

      this.drawPoly(pts, 'rgba(7, 13, 24, 0.90)', CareerFactoryIsoProcedural.rgba(livery.accent, 0.7), 1.4);

      ctx.save();
      ctx.beginPath();
      const steps = 18;
      for (let i = 0; i <= steps; i++) {
        const frac = i / steps;
        const wave = 0.5 + 0.3 * Math.sin(frac * 9 + t * 2.6) * Math.cos(frac * 4 - t * 1.1);
        const pt = isLeftWall
          ? this.iso(x + 0.02, y + 0.2 + frac * (len - 0.4), z + 0.25 + wave * (h - 0.5))
          : this.iso(x + 0.2 + frac * (len - 0.4), y + 0.02, z + 0.25 + wave * (h - 0.5));
        if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = livery.accent;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = livery.accent;
      ctx.shadowBlur = 6;
      ctx.stroke();

      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const frac = i / steps;
        const wave = 0.42 + 0.24 * Math.cos(frac * 7 - t * 2.1);
        const pt = isLeftWall
          ? this.iso(x + 0.02, y + 0.2 + frac * (len - 0.4), z + 0.2 + wave * (h - 0.5))
          : this.iso(x + 0.2 + frac * (len - 0.4), y + 0.02, z + 0.2 + wave * (h - 0.5));
        if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = livery.primary;
      ctx.lineWidth = 1.2;
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.restore();
    }

    /* ---------------- PROCEDURAL F1 CAR ---------------- */

    _drawF1Car(x, y, livery, carNum, t) {
      const ctx = this.ctx;
      const P = livery.primary;
      const S = livery.secondary;
      const A = livery.accent;

      this.drawContactShadow(x + 2.05, y + 0.72, 2.25, 0.92, 0.52);

      this._drawF1Tire(x + 0.65, y + 0.14, 0.34, 0.30, A);
      this._drawF1Tire(x + 3.25, y + 0.16, 0.30, 0.26, A);

      this.drawIsoBox(x + 0.35, y + 0.22, 0.08, 3.15, 1.02, 0.07, '#15181e', { highlight: false });

      this.drawIsoBox(x + 0.05, y + 0.22, 0.16, 0.42, 0.07, 0.72, S);
      this.drawIsoBox(x + 0.10, y + 0.26, 0.68, 0.34, 0.94, 0.09, P);
      this.drawIsoBox(x + 0.06, y + 0.26, 0.79, 0.24, 0.94, 0.06, A);
      this.drawIsoBox(x + 0.05, y + 1.18, 0.16, 0.42, 0.07, 0.72, S);

      const blink = Math.sin(t * 6 + carNum * 2) > 0.2;
      if (blink) {
        const rl = this.iso(x + 0.08, y + 0.72, 0.26);
        ctx.save();
        ctx.fillStyle = '#ff2a2a';
        ctx.shadowColor = '#ff2a2a';
        ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(rl.x, rl.y, Math.max(1.8, this.tileW * 0.06), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }

      this.drawIsoBox(x + 0.95, y + 0.24, 0.15, 1.48, 0.32, 0.34, P);
      this.drawIsoBox(x + 0.62, y + 0.50, 0.15, 1.95, 0.46, 0.46, P);
      this.drawIsoBox(x + 0.68, y + 0.69, 0.61, 1.05, 0.08, 0.24, S);
      this.drawIsoBox(x + 1.65, y + 0.59, 0.61, 0.36, 0.28, 0.24, A);
      this.drawIsoBox(x + 0.95, y + 0.90, 0.15, 1.48, 0.34, 0.34, P);
      this.drawIsoBox(x + 2.38, y + 0.92, 0.20, 0.08, 0.30, 0.24, '#0c0e12', { highlight: false });
      this.drawIsoBox(x + 1.02, y + 1.21, 0.35, 1.32, 0.05, 0.08, A);

      this.drawIsoBox(x + 1.95, y + 0.54, 0.18, 0.78, 0.38, 0.34, S);
      this.drawIsoBox(x + 2.02, y + 0.59, 0.49, 0.62, 0.28, 0.06, '#0b0d12', { highlight: false });
      const hRearL = this.iso(x + 2.05, y + 0.56, 0.60);
      const hRearR = this.iso(x + 2.05, y + 0.90, 0.60);
      const hFront = this.iso(x + 2.66, y + 0.73, 0.62);
      const hStem  = this.iso(x + 2.62, y + 0.73, 0.48);
      ctx.save();
      ctx.strokeStyle = '#181c24';
      ctx.lineWidth = Math.max(2.2, this.tileW * 0.085);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hRearL.x, hRearL.y);
      ctx.quadraticCurveTo(hFront.x, hFront.y - this.tileW * 0.08, hRearR.x, hRearR.y);
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hFront.x, hFront.y); ctx.lineTo(hStem.x, hStem.y); ctx.stroke();
      ctx.restore();

      this.drawIsoBox(x + 2.68, y + 0.56, 0.18, 0.68, 0.34, 0.26, P);
      this.drawIsoBox(x + 3.32, y + 0.60, 0.16, 0.56, 0.26, 0.19, P);
      this.drawIsoBox(x + 3.82, y + 0.64, 0.14, 0.28, 0.18, 0.13, A);

      this.drawIsoBox(x + 3.74, y + 0.10, 0.10, 0.42, 1.26, 0.06, S);
      this.drawIsoBox(x + 3.68, y + 0.14, 0.16, 0.24, 1.18, 0.05, A);
      this.drawIsoBox(x + 3.70, y + 0.08, 0.10, 0.46, 0.07, 0.24, P);
      this.drawIsoBox(x + 3.70, y + 1.32, 0.10, 0.46, 0.07, 0.24, P);

      this._drawF1Tire(x + 0.65, y + 1.18, 0.34, 0.32, A);
      this._drawF1Tire(x + 3.25, y + 1.16, 0.30, 0.28, A);
    }

    _drawF1Tire(x, y, radius, width, ringColor) {
      const ctx = this.ctx;
      const p = this.iso(x, y + width * 0.5, radius * 0.92);
      const rx = radius * this.tileW * 0.85;
      const ry = radius * this.tileZ * 0.95;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = '#14171c';
      ctx.beginPath();
      ctx.ellipse(-width * this.tileW * 0.32, -width * this.tileH * 0.32, rx, ry, -0.22, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1f242c';
      ctx.strokeStyle = '#0c0e12';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, -0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = ringColor;
      ctx.lineWidth = Math.max(1.2, this.tileW * 0.045);
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * 0.68, ry * 0.68, -0.22, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#384152';
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * 0.42, ry * 0.42, -0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(1.3, rx * 0.14), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    /* ---------------- FACILITY PROPS ---------------- */

    _drawCrate(x, y, z, dx, dy, dz) {
      if (z === 0) this.drawContactShadow(x + dx * 0.5, y + dy * 0.5, dx * 0.65, dy * 0.65, 0.35);
      this.drawIsoBox(x, y, z, dx, dy, dz, '#8c6239', { stroke: '#4a3219' });
      const ctx = this.ctx;
      const a = this.iso(x + dx, y, z);
      const b = this.iso(x + dx, y + dy, z + dz);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(74,50,25,0.55)'; ctx.lineWidth = 1.4; ctx.stroke();
    }

    _drawTireStack(x, y, count, ringColor) {
      this.drawContactShadow(x + 0.35, y + 0.35, 0.55, 0.55, 0.38);
      const ctx = this.ctx;
      for (let i = 0; i < count; i++) {
        const p = this.iso(x + 0.35, y + 0.35, i * 0.24 + 0.14);
        const rx = this.tileW * 0.42;
        const ry = this.tileH * 0.45;
        ctx.save();
        ctx.fillStyle = '#1b1f26';
        ctx.strokeStyle = '#0d0f13';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (i === count - 1) {
          ctx.strokeStyle = ringColor;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, rx * 0.65, ry * 0.65, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    _drawToolBench(x, y, livery) {
      this.drawContactShadow(x + 1.0, y + 0.4, 1.1, 0.55, 0.35);
      this.drawIsoBox(x, y, 0, 2.0, 0.72, 0.85, '#475569');
      this.drawIsoBox(x - 0.04, y - 0.04, 0.85, 2.08, 0.8, 0.08, '#94a3b8');
      this.drawIsoBox(x + 0.2, y + 0.15, 0.93, 0.55, 0.35, 0.28, livery.primary);
    }

    _drawToolCabinet(x, y, livery) {
      this.drawContactShadow(x + 0.45, y + 0.32, 0.55, 0.45, 0.35);
      this.drawIsoBox(x, y, 0.06, 0.92, 0.58, 0.96, livery.primary);
      this.drawIsoBox(x - 0.02, y - 0.02, 1.02, 0.96, 0.62, 0.07, '#1e2430');
      const ctx = this.ctx;
      [0.28, 0.54, 0.78].forEach((zh) => {
        const a = this.iso(x + 0.18, y + 0.59, zh);
        const b = this.iso(x + 0.74, y + 0.59, zh);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 1.5; ctx.stroke();
      });
    }

    _drawDiagnosticStand(x, y, t, livery) {
      this.drawContactShadow(x + 0.3, y + 0.3, 0.4, 0.4, 0.3);
      this.drawIsoBox(x + 0.1, y + 0.1, 0, 0.45, 0.45, 0.9, '#1f2633');
      this.drawIsoBox(x + 0.12, y + 0.15, 0.92, 0.42, 0.12, 0.42, '#0b1220', {
        left: CareerFactoryIsoProcedural.rgba(livery.accent, 0.7 + Math.sin(t * 3) * 0.2),
      });
    }

    _drawEngineeringDesk(x, y, lvl, t, livery, idx) {
      this.drawContactShadow(x + 0.85, y + 0.5, 1.05, 0.65, 0.35);
      const isRetro = lvl <= 2;

      this.drawIsoBox(x, y, 0, 0.12, 0.85, 0.72, isRetro ? '#52525b' : '#1e2430');
      this.drawIsoBox(x + 1.58, y, 0, 0.12, 0.85, 0.72, isRetro ? '#52525b' : '#1e2430');
      this.drawIsoBox(x, y, 0.72, 1.7, 0.88, 0.08, isRetro ? '#b8a992' : '#2b3344');

      this.drawIsoBox(x + 0.55, y + 0.95, 0.05, 0.52, 0.48, 0.42, '#1e2430');
      this.drawIsoBox(x + 0.55, y + 1.34, 0.47, 0.52, 0.12, 0.55, livery.primary);

      if (isRetro) {
        this.drawIsoBox(x + 0.55, y + 0.18, 0.80, 0.56, 0.46, 0.48, '#d4cbb8');
        this.drawIsoBox(x + 0.60, y + 0.62, 0.88, 0.44, 0.05, 0.32, '#1e3a2f', {
          left: 'rgba(74, 222, 128, 0.65)',
        });
        this.drawIsoBox(x + 0.48, y + 0.68, 0.80, 0.65, 0.18, 0.04, '#c7beaa');
      } else {
        const glow = 0.72 + Math.sin(t * 2.5 + idx * 1.7) * 0.18;
        this.drawIsoBox(x + 0.18, y + 0.22, 0.80, 0.64, 0.07, 0.44, '#111622', {
          left: CareerFactoryIsoProcedural.rgba(livery.accent, glow),
        });
        this.drawIsoBox(x + 0.90, y + 0.22, 0.80, 0.64, 0.07, 0.44, '#111622', {
          left: CareerFactoryIsoProcedural.rgba(livery.primary, glow),
        });
        this.drawIsoBox(x + 0.48, y + 0.58, 0.80, 0.68, 0.18, 0.03, '#141923');
      }
    }

    _drawServerRack(x, y, idx, t, livery) {
      const ctx = this.ctx;
      this.drawContactShadow(x + 0.46, y + 0.46, 0.62, 0.62, 0.42);

      this.drawIsoBox(x, y, 0, 0.92, 0.88, 2.25, '#181e29', { stroke: '#0c1017' });
      this.drawIsoBox(x, y, 2.25, 0.92, 0.88, 0.08, livery.primary);

      const rows = 7;
      for (let r = 0; r < rows; r++) {
        const zh = 0.28 + r * 0.27;
        const a = this.iso(x + 0.08, y + 0.89, zh);
        const b = this.iso(x + 0.84, y + 0.89, zh);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 0.8; ctx.stroke();

        for (let c = 0; c < 3; c++) {
          const phase = Math.sin(t * (3.2 + (r + c) * 0.7) + idx * 2.1 + r * 1.3);
          if (phase > -0.15) {
            const lp = this.iso(x + 0.16 + c * 0.14, y + 0.89, zh + 0.10);
            const col = c === 0 ? '#22c55e' : c === 1 ? livery.accent : '#f59e0b';
            ctx.save();
            ctx.fillStyle = col;
            ctx.shadowColor = col;
            ctx.shadowBlur = 5;
            ctx.beginPath();
            ctx.arc(lp.x, lp.y, Math.max(1.2, this.tileW * 0.042), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
    }

    _drawTrophyCabinet(x, y, lvl, t, livery) {
      this.drawContactShadow(x + 0.9, y + 0.38, 1.0, 0.48, 0.35);
      this.drawIsoBox(x, y, 0, 1.8, 0.68, 0.62, '#1b2230');
      const backPts = [
        this.iso(x, y, 0.62),
        this.iso(x + 1.8, y, 0.62),
        this.iso(x + 1.8, y, 2.25),
        this.iso(x, y, 2.25),
      ];
      this.drawPoly(backPts, 'rgba(251, 191, 36, 0.14)', 'rgba(255,255,255,0.2)', 1);

      const trophies = lvl >= 6 ? 4 : lvl >= 5 ? 3 : 2;
      const ctx = this.ctx;
      for (let i = 0; i < trophies; i++) {
        const tx = x + 0.32 + i * 0.38;
        const p = this.iso(tx, y + 0.34, 0.88 + (i % 2) * 0.45);
        ctx.save();
        ctx.fillStyle = i % 2 === 0 ? '#fbbf24' : '#e2e8f0';
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(2.6, this.tileW * 0.095), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      const frontGlass = [
        this.iso(x, y + 0.68, 0.62),
        this.iso(x + 1.8, y + 0.68, 0.62),
        this.iso(x + 1.8, y + 0.68, 2.25),
        this.iso(x, y + 0.68, 2.25),
      ];
      this.drawGlassQuad(frontGlass, '#bae6fd', 0.22);
      this.drawIsoBox(x, y, 2.25, 1.8, 0.68, 0.10, livery.primary);
    }

    _drawLoungeSofa(x, y, livery) {
      this.drawContactShadow(x + 0.55, y + 1.0, 0.8, 1.2, 0.35);
      this.drawIsoBox(x, y, 0.05, 0.88, 2.0, 0.38, livery.primary);
      this.drawIsoBox(x + 0.62, y, 0.43, 0.26, 2.0, 0.52, CareerFactoryIsoProcedural.shade(livery.primary, 0.85));
      this.drawIsoBox(x, y, 0.43, 0.88, 0.20, 0.26, livery.secondary);
      this.drawIsoBox(x, y + 1.80, 0.43, 0.88, 0.20, 0.26, livery.secondary);
    }

    _drawGlassCoffeeTable(x, y, livery) {
      this.drawContactShadow(x + 0.5, y + 0.65, 0.6, 0.72, 0.28);
      this.drawIsoBox(x + 0.05, y + 0.05, 0, 0.08, 0.08, 0.42, '#283040');
      this.drawIsoBox(x + 0.82, y + 1.15, 0, 0.08, 0.08, 0.42, '#283040');
      const top = [
        this.iso(x, y, 0.42),
        this.iso(x + 0.95, y, 0.42),
        this.iso(x + 0.95, y + 1.25, 0.42),
        this.iso(x, y + 1.25, 0.42),
      ];
      this.drawGlassQuad(top, '#93c5fd', 0.32, 'rgba(255,255,255,0.45)');
    }

    _drawPlantPot(x, y) {
      this.drawContactShadow(x + 0.25, y + 0.25, 0.35, 0.35, 0.3);
      this.drawIsoBox(x, y, 0, 0.5, 0.5, 0.52, '#334155');
      const ctx = this.ctx;
      const base = this.iso(x + 0.25, y + 0.25, 0.62);
      const foliage = [
        { dx: 0, dy: -0.35, r: 0.24, c: '#15803d' },
        { dx: -0.18, dy: -0.18, r: 0.20, c: '#16a34a' },
        { dx: 0.18, dy: -0.20, r: 0.20, c: '#22c55e' },
      ];
      foliage.forEach((f) => {
        ctx.fillStyle = f.c;
        ctx.beginPath();
        ctx.arc(base.x + f.dx * this.tileW, base.y + f.dy * this.tileZ, f.r * this.tileW, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    _drawWindTunnel(x, y, t, livery) {
      const ctx = this.ctx;
      this.drawContactShadow(x + 2.8, y + 1.4, 3.2, 1.5, 0.45);

      this.drawIsoBox(x, y + 0.15, 0, 1.25, 2.35, 2.35, '#2b3446', { stroke: '#111622' });
      this.drawIsoBox(x + 0.15, y + 0.35, 2.35, 0.95, 1.95, 0.14, livery.primary);

      this.drawIsoBox(x + 1.25, y + 0.25, 0, 3.2, 2.15, 0.22, '#1f2633');
      const beltPts = [
        this.iso(x + 1.45, y + 0.65, 0.23),
        this.iso(x + 4.25, y + 0.65, 0.23),
        this.iso(x + 4.25, y + 2.00, 0.23),
        this.iso(x + 1.45, y + 2.00, 0.23),
      ];
      this.drawPoly(beltPts, '#12161f', CareerFactoryIsoProcedural.rgba(livery.accent, 0.5), 1);

      const backGlass = [
        this.iso(x + 1.25, y + 0.25, 0.22),
        this.iso(x + 4.45, y + 0.25, 0.22),
        this.iso(x + 4.45, y + 0.25, 2.25),
        this.iso(x + 1.25, y + 0.25, 2.25),
      ];
      this.drawGlassQuad(backGlass, '#60a5fa', 0.18);

      this._drawScaleTunnelCar(x + 1.75, y + 0.92, 0.25, livery);

      ctx.save();
      for (let s = 0; s < 5; s++) {
        const sy = y + 0.85 + s * 0.24;
        const baseZ = 0.50 + (s % 2) * 0.18;
        ctx.beginPath();
        const segs = 22;
        for (let i = 0; i <= segs; i++) {
          const frac = i / segs;
          const wx = x + 1.32 + frac * 3.05;
          const hump = Math.exp(-Math.pow((frac - 0.52) / 0.22, 2)) * 0.52
                     + Math.exp(-Math.pow((frac - 0.25) / 0.14, 2)) * 0.22;
          const ripple = Math.sin(frac * 12 - t * 6.5 + s * 1.1) * 0.04;
          const pt = this.iso(wx, sy, baseZ + hump + ripple);
          if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
        }
        ctx.strokeStyle = CareerFactoryIsoProcedural.rgba(livery.accent, 0.65);
        ctx.lineWidth = 1.4;
        ctx.shadowColor = livery.accent;
        ctx.shadowBlur = 7;
        ctx.stroke();

        const pFrac = (t * 0.85 + s * 0.21) % 1;
        const px = x + 1.32 + pFrac * 3.05;
        const pHump = Math.exp(-Math.pow((pFrac - 0.52) / 0.22, 2)) * 0.52
                    + Math.exp(-Math.pow((pFrac - 0.25) / 0.14, 2)) * 0.22;
        const pp = this.iso(px, sy, baseZ + pHump);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, Math.max(1.4, this.tileW * 0.045), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      this.drawIsoBox(x + 4.45, y + 0.20, 0, 1.15, 2.25, 2.28, '#262f40', { stroke: '#111622' });
      const fanCenter = this.iso(x + 5.62, y + 1.32, 1.15);
      ctx.save();
      ctx.translate(fanCenter.x, fanCenter.y);
      ctx.fillStyle = '#0e131d';
      ctx.beginPath();
      ctx.ellipse(0, 0, this.tileW * 0.65, this.tileZ * 0.68, 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = CareerFactoryIsoProcedural.rgba(livery.accent, 0.6);
      ctx.lineWidth = 1.2;
      for (let b = 0; b < 4; b++) {
        const ang = t * 4.5 + (b * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang) * this.tileW * 0.58, Math.sin(ang) * this.tileZ * 0.58);
        ctx.stroke();
      }
      ctx.restore();

      const frontGlass = [
        this.iso(x + 1.25, y + 2.40, 0.22),
        this.iso(x + 4.45, y + 2.40, 0.22),
        this.iso(x + 4.45, y + 2.40, 2.25),
        this.iso(x + 1.25, y + 2.40, 2.25),
      ];
      const topGlass = [
        this.iso(x + 1.25, y + 0.25, 2.25),
        this.iso(x + 4.45, y + 0.25, 2.25),
        this.iso(x + 4.45, y + 2.40, 2.25),
        this.iso(x + 1.25, y + 2.40, 2.25),
      ];
      this.drawGlassQuad(frontGlass, '#7dd3fc', 0.20, 'rgba(200,235,255,0.45)');
      this.drawGlassQuad(topGlass, '#bae6fd', 0.16, 'rgba(200,235,255,0.35)');
    }

    _drawScaleTunnelCar(x, y, z, livery) {
      this.drawIsoBox(x + 0.15, y + 0.14, z, 1.9, 0.58, 0.06, '#141821');
      this.drawIsoBox(x + 0.05, y + 0.15, z + 0.28, 0.24, 0.56, 0.12, livery.accent);
      this.drawIsoBox(x + 0.35, y + 0.22, z + 0.06, 1.15, 0.42, 0.28, livery.primary);
      this.drawIsoBox(x + 1.45, y + 0.30, z + 0.06, 0.65, 0.26, 0.16, livery.primary);
      this.drawIsoBox(x + 1.98, y + 0.06, z + 0.04, 0.26, 0.74, 0.06, livery.secondary);
    }

    /* ---------------- ANIMATED STAFF ---------------- */

    _drawStaffMember(station, t, livery) {
      const ctx = this.ctx;
      const phase = t * 3.0 + station.phase;
      const p = this.iso(station.x, station.y, station.z);
      const s = this.tileW * 0.032;

      this.drawContactShadow(station.x, station.y, 0.34, 0.34, 0.38);

      ctx.save();
      ctx.translate(p.x, p.y);

      const isKneel = station.pose === 'kneel_wrench';
      const isSit   = station.pose === 'typing' || station.pose === 'sit_tablet';
      const bob     = isKneel ? Math.sin(phase * 1.4) * 1.2 * s : Math.sin(phase) * 1.0 * s;
      const hipY    = isKneel ? -6 * s : isSit ? -9 * s : -13 * s;

      ctx.strokeStyle = CareerFactoryIsoProcedural.shade(livery.secondary, 0.85);
      ctx.lineWidth = Math.max(2.2, 3.2 * s);
      ctx.lineCap = 'round';
      if (isKneel) {
        ctx.beginPath();
        ctx.moveTo(-2 * s, hipY); ctx.lineTo(-5 * s, -2 * s); ctx.lineTo(-2 * s, 0);
        ctx.moveTo(2 * s, hipY);  ctx.lineTo(4 * s, -4 * s);  ctx.lineTo(3 * s, 0);
        ctx.stroke();
      } else if (isSit) {
        ctx.beginPath();
        ctx.moveTo(-2.2 * s, hipY); ctx.lineTo(-5 * s, hipY + 3 * s); ctx.lineTo(-4 * s, 0);
        ctx.moveTo(2.2 * s, hipY);  ctx.lineTo(-1 * s, hipY + 3 * s); ctx.lineTo(0 * s, 0);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(-2.2 * s, hipY); ctx.lineTo(-2.6 * s, 0);
        ctx.moveTo(2.2 * s, hipY);  ctx.lineTo(2.6 * s, 0);
        ctx.stroke();
      }

      const torsoTopY = hipY - 11.5 * s + bob;
      ctx.fillStyle = livery.primary;
      ctx.beginPath();
      ctx.roundRect(-4.6 * s, torsoTopY, 9.2 * s, 11.5 * s, 2.5 * s);
      ctx.fill();

      ctx.fillStyle = livery.secondary;
      ctx.fillRect(-4.4 * s, torsoTopY + 4.2 * s, 8.8 * s, 2.6 * s);
      ctx.fillStyle = livery.accent;
      ctx.fillRect(-2.6 * s, torsoTopY, 5.2 * s, 1.5 * s);

      const headY = torsoTopY - 4.5 * s;
      ctx.fillStyle = '#eab696';
      ctx.beginPath();
      ctx.arc(0, headY, 3.6 * s, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1e2430';
      ctx.beginPath();
      ctx.arc(0, headY - 0.8 * s, 3.6 * s, Math.PI, Math.PI * 2);
      ctx.fill();

      if (station.pose === 'clipboard' || station.pose === 'tablet' || station.pose === 'inspect') {
        ctx.strokeStyle = livery.accent;
        ctx.lineWidth = Math.max(1, 1.2 * s);
        ctx.beginPath();
        ctx.arc(0, headY, 3.9 * s, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }

      const armSwing = Math.sin(phase * 1.6);
      const shoulderY = torsoTopY + 2.5 * s;
      ctx.strokeStyle = CareerFactoryIsoProcedural.shade(livery.primary, 1.1);
      ctx.lineWidth = Math.max(1.8, 2.6 * s);

      if (station.pose === 'kneel_wrench' || station.pose === 'wrench_stand') {
        const wx = -8.5 * s + armSwing * 2.2 * s;
        const wy = shoulderY + 4.5 * s + Math.cos(phase * 1.6) * 2.0 * s;
        ctx.beginPath();
        ctx.moveTo(-4 * s, shoulderY); ctx.lineTo(wx, wy);
        ctx.moveTo(4 * s, shoulderY);  ctx.lineTo(wx + 2.5 * s, wy + 1 * s);
        ctx.stroke();
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = Math.max(1.4, 1.8 * s);
        ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx - 4.5 * s, wy + 2 * s); ctx.stroke();
      } else if (station.pose === 'typing') {
        const tyL = shoulderY + 4.2 * s + Math.sin(phase * 3.5) * 1.3 * s;
        const tyR = shoulderY + 4.2 * s + Math.cos(phase * 3.5) * 1.3 * s;
        ctx.beginPath();
        ctx.moveTo(-4 * s, shoulderY); ctx.lineTo(-7.5 * s, tyL);
        ctx.moveTo(4 * s, shoulderY);  ctx.lineTo(-2.5 * s, tyR);
        ctx.stroke();
      } else {
        const hx = -6.5 * s;
        const hy = shoulderY + 3.5 * s + armSwing * 0.9 * s;
        ctx.beginPath();
        ctx.moveTo(-4 * s, shoulderY); ctx.lineTo(hx, hy);
        ctx.moveTo(4 * s, shoulderY);  ctx.lineTo(hx + 3 * s, hy + 0.8 * s);
        ctx.stroke();

        ctx.fillStyle = station.pose === 'clipboard' ? '#e2e8f0' : '#0f172a';
        ctx.strokeStyle = livery.accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(hx - 2.5 * s, hy - 2 * s, 5.2 * s, 3.8 * s);
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore();
    }

    /* ---------------- OVERHEAD ELEMENTS ---------------- */

    _drawOverheadGantryCrane(t, livery) {
      const ctx = this.ctx;
      const z = this.wallH - 0.35;
      const drawBeam = (yPos) => {
        const a = this.iso(0.2, yPos, z);
        const b = this.iso(this.worldW - 0.3, yPos, z);
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = Math.max(2.5, this.tileW * 0.10);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      };
      drawBeam(4.8);
      drawBeam(9.4);

      const bridgeX = 4.6 + Math.sin(t * 0.35) * 1.8;
      const ba = this.iso(bridgeX, 4.8, z);
      const bb = this.iso(bridgeX, 9.4, z);
      ctx.strokeStyle = CareerFactoryIsoProcedural.rgba(livery.primary, 0.85);
      ctx.lineWidth = Math.max(3, this.tileW * 0.13);
      ctx.beginPath(); ctx.moveTo(ba.x, ba.y); ctx.lineTo(bb.x, bb.y); ctx.stroke();

      const hoist = this.iso(bridgeX, 6.8, z - 0.18);
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = livery.accent;
      ctx.lineWidth = 1.2;
      ctx.fillRect(hoist.x - 5, hoist.y - 4, 10, 8);
      ctx.strokeRect(hoist.x - 5, hoist.y - 4, 10, 8);
    }

    _drawChampionshipBanners(livery, t) {
      const ctx = this.ctx;
      const positions = [
        { x: 2.5, y: 0.15 },
        { x: 5.0, y: 0.15 },
        { x: 13.5, y: 0.15 },
      ];
      positions.forEach((pos, i) => {
        const sway = Math.sin(t * 1.5 + i) * 0.04;
        const pts = [
          this.iso(pos.x, pos.y, 4.75),
          this.iso(pos.x + 1.15, pos.y, 4.75),
          this.iso(pos.x + 1.15, pos.y + sway, 3.25),
          this.iso(pos.x + 0.58, pos.y + sway, 2.90),
          this.iso(pos.x, pos.y + sway, 3.25),
        ];
        this.drawPoly(pts, i % 2 === 0 ? livery.primary : livery.secondary, 'rgba(255,255,255,0.35)', 1);
        const star = this.iso(pos.x + 0.58, pos.y + sway * 0.5, 3.95);
        ctx.fillStyle = livery.accent;
        ctx.beginPath();
        ctx.arc(star.x, star.y, Math.max(2.5, this.tileW * 0.10), 0, Math.PI * 2);
        ctx.fill();
      });
    }

    _drawOverheadLighting(lvl, livery, t) {
      const ctx = this.ctx;
      const fixtures = lvl <= 2
        ? [{ x: 4.2, y: 7.0 }, { x: 12.2, y: 7.0 }]
        : lvl <= 4
          ? [{ x: 4.2, y: 7.0 }, { x: 8.2, y: 8.2 }, { x: 12.8, y: 7.2 }]
          : [{ x: 4.2, y: 7.0 }, { x: 8.2, y: 8.2 }, { x: 3.2, y: 2.2 }, { x: 12.8, y: 7.2 }];

      const tint = lvl <= 2 ? '#ffb347' : lvl <= 4 ? '#e0f2fe' : '#bae6fd';
      const coneAlpha = lvl <= 2 ? 0.11 : lvl <= 4 ? 0.08 : 0.09;

      fixtures.forEach((f) => {
        const top = this.iso(f.x, f.y, this.wallH + 0.1);
        const bot = this.iso(f.x, f.y, 0);
        const spread = this.tileW * 2.4;

        const grad = ctx.createLinearGradient(top.x, top.y, bot.x, bot.y);
        grad.addColorStop(0, CareerFactoryIsoProcedural.rgba(tint, coneAlpha * 1.4));
        grad.addColorStop(0.75, CareerFactoryIsoProcedural.rgba(tint, coneAlpha * 0.35));
        grad.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.save();
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(top.x - 8, top.y);
        ctx.lineTo(top.x + 8, top.y);
        ctx.lineTo(bot.x + spread, bot.y + this.tileH * 0.6);
        ctx.lineTo(bot.x - spread, bot.y + this.tileH * 0.6);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = tint;
        ctx.shadowBlur = 12;
        ctx.fillRect(top.x - 10, top.y - 2, 20, 3.5);
        ctx.restore();
      });
    }

    /* ---------------- ZONE HIGHLIGHTS & PINS ---------------- */

    _drawZoneFloorHighlights(t) {
      const unlocked = this.getUnlockedZones();
      const pulse = 0.55 + Math.sin(t * 4) * 0.25;

      unlocked.forEach((z) => {
        const isFocused = z.id === this.focusedZoneId;
        const isHovered = z.id === this.hoveredZoneId;
        if (!isFocused && !isHovered) return;

        const b = z.bounds;
        const pts = [
          this.iso(b.x, b.y, 0.03),
          this.iso(b.x + b.dx, b.y, 0.03),
          this.iso(b.x + b.dx, b.y + b.dy, 0.03),
          this.iso(b.x, b.y + b.dy, 0.03),
        ];
        const col = this.state.livery.accent;
        this.drawPoly(
          pts,
          CareerFactoryIsoProcedural.rgba(col, isFocused ? 0.13 : 0.08),
          CareerFactoryIsoProcedural.rgba(col, isFocused ? pulse : 0.55),
          isFocused ? 2.2 : 1.3
        );
      });
    }

    _drawZonePins(t, livery) {
      const ctx = this.ctx;
      const unlocked = this.getUnlockedZones();
      this.pinScreenCoords = [];

      unlocked.forEach((z) => {
        const isFocused = z.id === this.focusedZoneId;
        const isHovered = z.id === this.hoveredZoneId;
        const bob = isFocused ? Math.sin(t * 3.8) * 3 : 0;

        const p = this.iso(z.pin.x, z.pin.y, z.pin.z);
        const py = p.y + bob;

        ctx.save();
        ctx.font = `700 ${isFocused ? 11 : 10}px Inter, sans-serif`;
        const textW = ctx.measureText(z.label).width;
        const pillW = textW + 22;
        const pillH = isFocused ? 24 : 21;

        const floorP = this.iso(z.pin.x, z.pin.y, 0.2);
        ctx.strokeStyle = isFocused
          ? CareerFactoryIsoProcedural.rgba(livery.accent, 0.7)
          : 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(p.x, py + pillH * 0.5);
        ctx.lineTo(floorP.x, floorP.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = isFocused
          ? 'rgba(12, 18, 30, 0.92)'
          : isHovered
            ? 'rgba(18, 24, 38, 0.88)'
            : 'rgba(11, 15, 24, 0.74)';
        ctx.strokeStyle = isFocused
          ? livery.accent
          : isHovered
            ? 'rgba(255,255,255,0.45)'
            : 'rgba(255,255,255,0.18)';
        ctx.lineWidth = isFocused ? 1.6 : 1;

        if (isFocused) {
          ctx.shadowColor = livery.accent;
          ctx.shadowBlur = 12;
        }

        ctx.beginPath();
        ctx.roundRect(p.x - pillW * 0.5, py - pillH * 0.5, pillW, pillH, 999);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = isFocused ? livery.accent : livery.primary;
        ctx.beginPath();
        ctx.arc(p.x - pillW * 0.5 + 9, py, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = isFocused ? '#ffffff' : '#cbd5e1';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(z.label, p.x - pillW * 0.5 + 16, py + 0.5);
        ctx.restore();

        this.pinScreenCoords.push({ zone: z, x: p.x, y: py, w: pillW, h: pillH });
      });
    }
  }

  global.CareerFactoryIsoProcedural = CareerFactoryIsoProcedural;
})(window);
