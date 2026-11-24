/* reg_grapher.js — Interactive 2D CAD Dimension Grapher + Live 3D Parametric Car + Custom Car Tools Builder
   Zero-scroll embedded module for TRAF1 Career OS (FIA Stewards -> Reg Architect) and shared Sim Formula Library. */
(function (global) {
  'use strict';

  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function createRegGrapher(container, opts) {
    opts = opts || {};
    var state = {
      formula: JSON.parse(JSON.stringify(opts.initialFormula || {
        id: 'fia_2026_official',
        name: '2026 FIA Active-Aero Formula',
        year: 2026,
        group: 'custom_voted_formulas',
        dimensions: {
          wheelbase_mm: 3400, width_mm: 1900, min_weight_kg: 768,
          front_wing_mm: 1800, rear_wing_mm: 1000, ride_height_mm: 32, tyre_rim_in: 18
        },
        powertrain: { ers_kw: 350, ice_share_pct: 50, refuelling: false },
        governance: { cost_cap_m: 135, points_system: '25_18_15' },
        active_tools: ['active_aero', 'manual_override', 'ground_effect'],
        custom_tools: []
      })),
      toolsCatalog: opts.toolsCatalog || [],
      presets: opts.presets || {},
      metrics: null,
      viewMode: '2d', /* '2d' | '3d' */
      palette: opts.palette || { main: '#e10600', secondary: '#14171d', accent: '#38bdf8', pop: '#ffffff', detail: '#1e293b' },
      liveryStyle: opts.liveryStyle || 'modern',
      liveryFinish: opts.liveryFinish || 'gloss',
      lobbiedIds: opts.lobbiedIds || [],
      threeCtx: null,
      rafId: null,
      previewTimer: null
    };

    container.innerHTML = '';
    var root = el('div', 'rg-shell');
    root.innerHTML = [
      '<div class="rg-left">',
        '<div class="rg-head">',
          '<div class="rg-title-wrap">',
            '<input class="rg-name-input" type="text" maxlength="54" placeholder="Name your Formula (e.g. 2028 Nimble V10)" />',
            '<select class="rg-preset-sel" title="Load FIA Formula Preset">',
              '<option value="">Presets…</option>',
              '<option value="2026_nimble">2026 Active-Aero</option>',
              '<option value="2022_ground_effect">2022–25 Ground Effect + DRS</option>',
              '<option value="2004_v10_screamer">2004 V10 Lightweight</option>',
              '<option value="unlimited_prototype">Formula Libre (Fan Car)</option>',
            '</select>',
          '</div>',
          '<div class="rg-view-toggle">',
            '<button type="button" class="rg-vbtn active" data-v="2d">2D CAD Blueprint</button>',
            '<button type="button" class="rg-vbtn" data-v="3d">Live 3D Car</button>',
          '</div>',
        '</div>',
        '<div class="rg-stage">',
          '<canvas class="rg-cad-canvas"></canvas>',
          '<div class="rg-3d-host" style="display:none;"></div>',
          '<div class="rg-stage-badges"></div>',
        '</div>',
        '<div class="rg-impact-bar"></div>',
      '</div>',
      '<div class="rg-right">',
        '<div class="rg-tabs">',
          '<button type="button" class="rg-tab active" data-t="dims">Chassis &amp; Cap</button>',
          '<button type="button" class="rg-tab" data-t="tools">Car Tools (Vote)</button>',
          '<button type="button" class="rg-tab" data-t="invent">+ Invent Tool</button>',
        '</div>',
        '<div class="rg-pane" data-p="dims"></div>',
        '<div class="rg-pane" data-p="tools" style="display:none;"></div>',
        '<div class="rg-pane" data-p="invent" style="display:none;"></div>',
        '<div class="rg-actions">',
          '<button type="button" class="rg-btn rg-btn-primary" data-act="vote">🏛️ Submit Bill to F1 Commission</button>',
          '<button type="button" class="rg-btn rg-btn-ghost" data-act="save">💾 Save to Sim Library</button>',
        '</div>',
        '<div class="rg-status"></div>',
      '</div>'
    ].join('');
    container.appendChild(root);

    var nameInput = root.querySelector('.rg-name-input');
    var presetSel = root.querySelector('.rg-preset-sel');
    var cadCanvas = root.querySelector('.rg-cad-canvas');
    var host3d = root.querySelector('.rg-3d-host');
    var stageBadges = root.querySelector('.rg-stage-badges');
    var impactBar = root.querySelector('.rg-impact-bar');
    var paneDims = root.querySelector('[data-p="dims"]');
    var paneTools = root.querySelector('[data-p="tools"]');
    var paneInvent = root.querySelector('[data-p="invent"]');
    var statusEl = root.querySelector('.rg-status');

    nameInput.value = state.formula.name || '2026 FIA Active-Aero Formula';
    nameInput.addEventListener('input', function () {
      state.formula.name = nameInput.value.trim() || 'Custom F1 Formula';
    });

    presetSel.addEventListener('change', function () {
      var k = presetSel.value;
      if (k && state.presets[k] && state.presets[k].formula) {
        state.formula = JSON.parse(JSON.stringify(state.presets[k].formula));
        nameInput.value = state.formula.name;
        renderDimsPane();
        renderToolsPane();
        requestPreview();
      }
      presetSel.value = '';
    });

    /* Tab switching */
    root.querySelectorAll('.rg-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var t = btn.getAttribute('data-t');
        root.querySelectorAll('.rg-tab').forEach(function (b) { b.classList.toggle('active', b === btn); });
        root.querySelectorAll('.rg-pane').forEach(function (p) {
          p.style.display = (p.getAttribute('data-p') === t) ? '' : 'none';
        });
      });
    });

    /* View toggle 2D CAD <-> Live 3D Car */
    root.querySelectorAll('.rg-vbtn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var v = btn.getAttribute('data-v');
        state.viewMode = v;
        root.querySelectorAll('.rg-vbtn').forEach(function (b) { b.classList.toggle('active', b === btn); });
        cadCanvas.style.display = (v === '2d') ? 'block' : 'none';
        host3d.style.display = (v === '3d') ? 'block' : 'none';
        if (v === '3d') {
          ensure3DCar();
          update3DCar();
        } else {
          drawCAD();
        }
      });
    });

    /* Dimensions & Governance Sliders */
    var SLIDERS = [
      { grp: 'dimensions', key: 'wheelbase_mm', label: 'Wheelbase', min: 2800, max: 3800, step: 20, unit: 'mm' },
      { grp: 'dimensions', key: 'width_mm', label: 'Chassis Width', min: 1650, max: 2150, step: 25, unit: 'mm' },
      { grp: 'dimensions', key: 'min_weight_kg', label: 'Min Weight', min: 580, max: 860, step: 4, unit: 'kg' },
      { grp: 'dimensions', key: 'front_wing_mm', label: 'Front Wing Span', min: 1300, max: 2100, step: 25, unit: 'mm' },
      { grp: 'dimensions', key: 'rear_wing_mm', label: 'Rear Wing Span', min: 750, max: 1200, step: 25, unit: 'mm' },
      { grp: 'dimensions', key: 'ride_height_mm', label: 'Min Ride Height', min: 18, max: 65, step: 2, unit: 'mm' },
      { grp: 'powertrain', key: 'ers_kw', label: 'ERS Hybrid Output', min: 0, max: 500, step: 25, unit: 'kW' },
      { grp: 'governance', key: 'cost_cap_m', label: 'FIA Cost Cap', min: 85, max: 250, step: 5, unit: '$M' }
    ];

    function renderDimsPane() {
      var html = '<div class="rg-sliders">';
      SLIDERS.forEach(function (s) {
        var val = state.formula[s.grp][s.key];
        html += '<label class="rg-srow">' +
          '<span class="rg-slbl">' + s.label + '</span>' +
          '<input type="range" data-grp="' + s.grp + '" data-key="' + s.key + '" min="' + s.min + '" max="' + s.max + '" step="' + s.step + '" value="' + val + '" />' +
          '<span class="rg-sval">' + val + ' ' + s.unit + '</span>' +
          '</label>';
      });
      html += '</div>';
      html += '<div class="rg-toggles">' +
        '<label class="rg-chk"><input type="checkbox" data-bool="refuelling" ' + (state.formula.powertrain.refuelling ? 'checked' : '') + ' /> In-Race Refuelling</label>' +
        '<label class="rg-chk">Tyre Rims: <select data-sel="rim">' +
          '<option value="18" ' + (state.formula.dimensions.tyre_rim_in === 18 ? 'selected' : '') + '>18" Low-Profile</option>' +
          '<option value="13" ' + (state.formula.dimensions.tyre_rim_in === 13 ? 'selected' : '') + '>13" Classic Balloon</option>' +
        '</select></label>' +
        '</div>';
      paneDims.innerHTML = html;

      paneDims.querySelectorAll('input[type="range"]').forEach(function (inp) {
        inp.addEventListener('input', function () {
          var grp = inp.getAttribute('data-grp');
          var key = inp.getAttribute('data-key');
          var v = Number(inp.value);
          state.formula[grp][key] = v;
          var meta = SLIDERS.find(function (x) { return x.key === key; });
          inp.parentElement.querySelector('.rg-sval').textContent = v + ' ' + (meta ? meta.unit : '');
          drawCAD();
          update3DCar();
          requestPreview();
        });
      });

      var refChk = paneDims.querySelector('[data-bool="refuelling"]');
      if (refChk) refChk.addEventListener('change', function () {
        state.formula.powertrain.refuelling = !!refChk.checked;
        requestPreview();
      });
      var rimSel = paneDims.querySelector('[data-sel="rim"]');
      if (rimSel) rimSel.addEventListener('change', function () {
        state.formula.dimensions.tyre_rim_in = Number(rimSel.value);
        drawCAD();
        requestPreview();
      });
    }

    function renderToolsPane() {
      var allTools = (state.toolsCatalog || []).concat(state.formula.custom_tools || []);
      var activeSet = {};
      (state.formula.active_tools || []).forEach(function (id) { activeSet[id] = true; });
      var html = '<div class="rg-tools-grid">';
      allTools.forEach(function (t) {
        var on = !!activeSet[t.id];
        html += '<button type="button" class="rg-tool-card' + (on ? ' on' : '') + (t.category === 'custom' ? ' custom' : '') + '" data-tid="' + esc(t.id) + '" title="' + esc(t.desc) + '">' +
          '<div class="rg-tc-top"><span class="rg-tc-badge">' + esc(t.short || t.id) + '</span><span class="rg-tc-era">' + esc(t.era_origin || 'FIA') + '</span></div>' +
          '<div class="rg-tc-name">' + esc(t.name) + '</div>' +
          '<div class="rg-tc-state">' + (on ? 'ACTIVE IN BILL' : 'VOTED OUT') + '</div>' +
          '</button>';
      });
      html += '</div>';
      paneTools.innerHTML = html;

      paneTools.querySelectorAll('.rg-tool-card').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var tid = btn.getAttribute('data-tid');
          var arr = state.formula.active_tools || [];
          var idx = arr.indexOf(tid);
          if (idx === -1) arr.push(tid);
          else arr.splice(idx, 1);
          state.formula.active_tools = arr;
          renderToolsPane();
          drawCAD();
          update3DCar();
          requestPreview();
        });
      });
    }

    function renderInventPane() {
      paneInvent.innerHTML = [
        '<div class="rg-invent-form">',
          '<div class="rg-irow"><label>Tool Name</label><input type="text" data-f="name" placeholder="e.g. Vortex Slot Flap / Hyper-ERS" maxlength="42" /></div>',
          '<div class="rg-irow-2">',
            '<div><label>HUD Badge</label><input type="text" data-f="short" placeholder="VORTEX" maxlength="8" /></div>',
            '<div><label>Intensity</label><input type="range" data-f="intensity" min="0.6" max="1.6" step="0.1" value="1.1" /></div>',
          '</div>',
          '<div class="rg-irow-2">',
            '<div><label>Trigger</label><select data-f="trigger"><option value="within_1s">Within 1.0s Chase</option><option value="driver_push">Driver Push-to-Pass</option><option value="automatic_corner">Auto Corner-Load</option></select></div>',
            '<div><label>Aero Effect</label><select data-f="aero"><option value="drag_cut">Straight-Line Drag Cut</option><option value="downforce_surge">Downforce Surge</option><option value="wake_cleaner">Clean-Air Wake Diffuser</option><option value="adaptive_dual">Adaptive Dual Wing</option></select></div>',
          '</div>',
          '<div class="rg-irow-2">',
            '<div><label>Power Assist</label><select data-f="power"><option value="none">None (Pure Aero)</option><option value="ers_overboost">ERS Overboost</option><option value="torque_vector">Torque Vectoring</option><option value="regen_harvest">Thermal Regen</option></select></div>',
            '<div><label>Engineering Trade-Off</label><select data-f="side"><option value="tyre_wear">Higher Tyre Wear</option><option value="reliability_risk">Mechanical DNF Risk</option><option value="dirty_wake">Turbulent Wake</option><option value="budget_heavy">Higher Cost-Cap Spend</option></select></div>',
          '</div>',
          '<button type="button" class="rg-btn rg-btn-accent" data-act="create-tool">⚡ Invent &amp; Mount Car Tool</button>',
        '</div>'
      ].join('');

      paneInvent.querySelector('[data-act="create-tool"]').addEventListener('click', function () {
        var nm = (paneInvent.querySelector('[data-f="name"]').value || '').trim();
        if (!nm) {
          statusEl.textContent = 'Enter a name for your custom Car Tool first (e.g. "Vortex DRS").';
          return;
        }
        var payload = {
          name: nm,
          short_code: paneInvent.querySelector('[data-f="short"]').value,
          trigger: paneInvent.querySelector('[data-f="trigger"]').value,
          aero_mode: paneInvent.querySelector('[data-f="aero"]').value,
          power_mode: paneInvent.querySelector('[data-f="power"]').value,
          intensity: Number(paneInvent.querySelector('[data-f="intensity"]').value || 1.0),
          side_effect: paneInvent.querySelector('[data-f="side"]').value
        };
        fetch('/api/regulations/tool/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.tool) {
              state.formula.custom_tools = state.formula.custom_tools || [];
              state.formula.custom_tools.push(d.tool);
              if (state.formula.active_tools.indexOf(d.tool.id) === -1) {
                state.formula.active_tools.push(d.tool.id);
              }
              paneInvent.querySelector('[data-f="name"]').value = '';
              paneInvent.querySelector('[data-f="short"]').value = '';
              statusEl.textContent = 'Mounted custom Car Tool "' + d.tool.name + '" [' + d.tool.short + '] onto blueprint!';
              renderToolsPane();
              root.querySelector('.rg-tab[data-t="tools"]').click();
              drawCAD();
              update3DCar();
              requestPreview();
            }
          })
          .catch(function (e) { statusEl.textContent = 'Tool creation error: ' + e; });
      });
    }

    /* 2D Orthographic CAD Blueprint Renderer (Top Plan + Side Elevation with mm Engineering Callouts) */
    function drawCAD() {
      var rect = cadCanvas.parentElement.getBoundingClientRect();
      var w = Math.max(360, Math.floor(rect.width || 560));
      var h = Math.max(210, Math.floor(rect.height || 260));
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (cadCanvas.width !== w * dpr || cadCanvas.height !== h * dpr) {
        cadCanvas.width = w * dpr;
        cadCanvas.height = h * dpr;
      }
      var g = cadCanvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      /* Blueprint grid background */
      g.fillStyle = '#07111e';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(56, 189, 248, 0.09)';
      g.lineWidth = 1;
      for (var gx = 0; gx < w; gx += 20) { g.beginPath(); g.moveTo(gx, 0); g.lineTo(gx, h); g.stroke(); }
      for (var gy = 0; gy < h; gy += 20) { g.beginPath(); g.moveTo(0, gy); g.lineTo(w, gy); g.stroke(); }

      var dims = state.formula.dimensions;
      var tools = state.formula.active_tools || [];
      var scale = Math.min((w * 0.62) / 5600, (h * 0.34) / 2100);
      var cx = w * 0.50;
      var topY = h * 0.34;
      var sideY = h * 0.78;

      var wbPx = dims.wheelbase_mm * scale;
      var wdPx = dims.width_mm * scale;
      var fwPx = dims.front_wing_mm * scale;
      var rwPx = dims.rear_wing_mm * scale;
      var carLen = wbPx * 1.56;
      var noseX = cx + carLen * 0.52;
      var rearX = cx - carLen * 0.48;
      var fAxleX = cx + wbPx * 0.50;
      var rAxleX = cx - wbPx * 0.50;

      /* --- TOP-DOWN PLAN VIEW --- */
      g.save();
      g.strokeStyle = '#38bdf8';
      g.fillStyle = 'rgba(14, 165, 233, 0.14)';
      g.lineWidth = 1.6;

      /* Floor & Sidepods */
      g.beginPath();
      g.moveTo(noseX, topY);
      g.lineTo(fAxleX + 10, topY - wdPx * 0.14);
      g.lineTo(cx + wbPx * 0.14, topY - wdPx * 0.40);
      g.lineTo(rAxleX + 12, topY - wdPx * 0.34);
      g.lineTo(rearX + 10, topY - wdPx * 0.14);
      g.lineTo(rearX + 10, topY + wdPx * 0.14);
      g.lineTo(rAxleX + 12, topY + wdPx * 0.34);
      g.lineTo(cx + wbPx * 0.14, topY + wdPx * 0.40);
      g.lineTo(fAxleX + 10, topY + wdPx * 0.14);
      g.closePath();
      g.fill();
      g.stroke();

      /* Ground-effect venturi glow skirts */
      if (tools.indexOf('ground_effect') !== -1) {
        g.strokeStyle = '#22d3ee';
        g.lineWidth = 2.6;
        [-1, 1].forEach(function (s) {
          g.beginPath();
          g.moveTo(cx + wbPx * 0.16, topY + s * wdPx * 0.42);
          g.lineTo(rAxleX + 16, topY + s * wdPx * 0.36);
          g.stroke();
        });
      }

      /* Front Wing & Rear Wing */
      var wingActive = (tools.indexOf('active_aero') !== -1 || tools.indexOf('drs') !== -1);
      g.fillStyle = wingActive ? 'rgba(56, 189, 248, 0.36)' : 'rgba(225, 6, 0, 0.25)';
      g.strokeStyle = wingActive ? '#7dd3fc' : '#f87171';
      g.lineWidth = 1.5;
      g.fillRect(noseX - 24, topY - fwPx * 0.5, 22, fwPx);
      g.strokeRect(noseX - 24, topY - fwPx * 0.5, 22, fwPx);
      g.fillRect(rearX - 6, topY - rwPx * 0.5, 18, rwPx);
      g.strokeRect(rearX - 6, topY - rwPx * 0.5, 18, rwPx);

      /* Wheels (4 wheels, or 6 wheels if six_wheeler active!) */
      var wLen = 30 * (scale / 0.06);
      var wThick = (dims.tyre_rim_in === 13 ? 13 : 11) * (scale / 0.06);
      g.fillStyle = '#0f172a';
      g.strokeStyle = '#94a3b8';
      [
        [fAxleX, topY - wdPx * 0.46], [fAxleX, topY + wdPx * 0.46],
        [rAxleX, topY - wdPx * 0.46], [rAxleX, topY + wdPx * 0.46]
      ].forEach(function (pt) {
        g.fillRect(pt[0] - wLen * 0.5, pt[1] - wThick * 0.5, wLen, wThick);
        g.strokeRect(pt[0] - wLen * 0.5, pt[1] - wThick * 0.5, wLen, wThick);
      });
      if (tools.indexOf('six_wheeler') !== -1) {
        g.strokeStyle = '#facc15';
        [topY - wdPx * 0.45, topY + wdPx * 0.45].forEach(function (wy) {
          g.fillRect(fAxleX - wLen * 1.45, wy - wThick * 0.42, wLen * 0.8, wThick * 0.84);
          g.strokeRect(fAxleX - wLen * 1.45, wy - wThick * 0.42, wLen * 0.8, wThick * 0.84);
        });
      }

      /* Fan Car Rear Turbine */
      if (tools.indexOf('fan_car') !== -1) {
        g.strokeStyle = '#f43f5e';
        g.fillStyle = 'rgba(244, 63, 94, 0.35)';
        g.beginPath();
        g.arc(rearX - 10, topY, 10, 0, Math.PI * 2);
        g.fill(); g.stroke();
      }

      /* Dimension Callout Arrows (Wheelbase + Width + Wings) */
      g.strokeStyle = 'rgba(248, 250, 252, 0.55)';
      g.fillStyle = '#e2e8f0';
      g.font = '600 10px ui-monospace, SFMono-Regular, monospace';
      g.lineWidth = 1;
      /* Wheelbase line */
      var wbLineY = topY + wdPx * 0.64 + 8;
      g.beginPath(); g.moveTo(rAxleX, wbLineY); g.lineTo(fAxleX, wbLineY); g.stroke();
      g.fillText('WB ' + dims.wheelbase_mm + ' mm', cx - 34, wbLineY + 12);
      /* Width callout */
      g.fillText('W ' + dims.width_mm + ' mm', cx - 28, topY - wdPx * 0.56 - 4);
      /* Front & Rear wing callouts */
      g.fillStyle = '#7dd3fc';
      g.fillText('FW ' + dims.front_wing_mm, noseX + 6, topY + 4);
      g.fillText('RW ' + dims.rear_wing_mm, rearX - 58, topY + 4);

      /* --- SIDE ELEVATION PROFILE --- */
      var groundY = sideY + 18;
      var rhPx = Math.max(3, dims.ride_height_mm * 0.24);
      g.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      g.beginPath(); g.moveTo(rearX - 30, groundY); g.lineTo(noseX + 20, groundY); g.stroke();

      g.strokeStyle = '#38bdf8';
      g.fillStyle = 'rgba(56, 189, 248, 0.14)';
      g.beginPath();
      g.moveTo(noseX, groundY - rhPx - 4);
      g.lineTo(fAxleX - 10, groundY - rhPx - 18);
      g.lineTo(cx - 8, groundY - rhPx - 36); /* airbox */
      g.lineTo(rAxleX + 10, groundY - rhPx - 24);
      g.lineTo(rearX, groundY - rhPx - 34); /* rear wing */
      g.lineTo(rearX, groundY - rhPx);
      g.lineTo(noseX, groundY - rhPx);
      g.closePath();
      g.fill(); g.stroke();

      /* Side wheels */
      var wRad = dims.tyre_rim_in === 13 ? 13 : 14;
      [rAxleX, fAxleX].forEach(function (ax) {
        g.fillStyle = '#0f172a'; g.strokeStyle = '#cbd5e1';
        g.beginPath(); g.arc(ax, groundY - wRad, wRad, 0, Math.PI * 2); g.fill(); g.stroke();
        g.strokeStyle = '#38bdf8';
        g.beginPath(); g.arc(ax, groundY - wRad, dims.tyre_rim_in === 13 ? 6 : 9, 0, Math.PI * 2); g.stroke();
      });

      g.fillStyle = '#94a3b8';
      g.fillText(dims.min_weight_kg + ' kg  |  ERS ' + state.formula.powertrain.ers_kw + ' kW  |  CAP $' + state.formula.governance.cost_cap_m + 'M  |  RH ' + dims.ride_height_mm + 'mm', 12, h - 8);
      g.restore();

      /* Active Tool Badges Overlay */
      var allTools = (state.toolsCatalog || []).concat(state.formula.custom_tools || []);
      var map = {}; allTools.forEach(function (t) { map[t.id] = t; });
      stageBadges.innerHTML = (state.formula.active_tools || []).map(function (tid) {
        var t = map[tid];
        return '<span class="rg-badge' + (t && t.category === 'custom' ? ' custom' : '') + '">' + esc((t && t.short) || tid.toUpperCase()) + '</span>';
      }).join('') || '<span class="rg-badge muted">PURE MECHANICAL (NO CAR TOOLS)</span>';
    }

    /* Live 3D Parametric Car Preview (uses shared window.F1Car3D!) */
    function ensure3DCar() {
      if (state.threeCtx || !global.THREE || !global.F1Car3D) return;
      var w = host3d.clientWidth || 540;
      var h = host3d.clientHeight || 240;
      var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      host3d.innerHTML = '';
      host3d.appendChild(renderer.domElement);

      var scene = new THREE.Scene();
      scene.environment = F1Car3D.createStudioEnvironment(renderer);
      F1Car3D.addStudioLights(scene, state.palette.main);
      var cam = new THREE.PerspectiveCamera(32, w / h, 0.1, 40);
      cam.position.set(4.5, 2.2, 4.7);
      cam.lookAt(0, 0.42, 0);

      var car = F1Car3D.createCar(state.palette, state.liveryStyle, '2020s');
      if (car.userData.setPalette) car.userData.setPalette(state.palette, state.liveryStyle, state.liveryFinish);
      scene.add(car);
      scene.add(F1Car3D.createContactShadow());

      var angle = 0.72;
      state.threeCtx = { renderer: renderer, scene: scene, cam: cam, car: car };

      function tick() {
        state.rafId = requestAnimationFrame(tick);
        if (state.viewMode !== '3d' || !state.threeCtx) return;
        angle += 0.0055;
        cam.position.set(Math.sin(angle) * 6.0, 2.0, Math.cos(angle) * 6.0);
        cam.lookAt(0, 0.42, 0);
        if (car.userData.regToolsGroup && car.userData.regToolsGroup.userData.fanCar && car.userData.regToolsGroup.userData.fanCar.visible) {
          car.userData.regToolsGroup.userData.fanCar.userData.rotor.rotation.z += 0.28;
        }
        renderer.render(scene, cam);
      }
      tick();
    }

    function update3DCar() {
      if (state.threeCtx && state.threeCtx.car && global.F1Car3D && F1Car3D.applyRegulationDimensions) {
        F1Car3D.applyRegulationDimensions(state.threeCtx.car, state.formula);
      }
    }

    function renderImpact(ev) {
      if (!ev || !ev.metrics) return;
      state.metrics = ev.metrics;
      var m = ev.metrics;
      var rows = [
        { k: 'Cornering', v: m.cornering_index, txt: m.cornering_index + '/100', col: '#38bdf8' },
        { k: 'Top Speed', v: m.top_speed_score, txt: m.top_speed_kph + ' km/h', col: '#f59e0b' },
        { k: 'Clean Air', v: m.clean_air_score, txt: m.dirty_air_mult + 'x wake', col: '#22c55e' },
        { k: 'Overtaking', v: m.overtake_score, txt: '+' + m.overtake_delta_s + 's', col: '#a855f7' },
        { k: 'Agility', v: m.agility_index, txt: m.agility_index + '/100', col: '#ec4899' },
        { k: 'Lap Delta', v: Math.max(15, Math.min(100, 55 - m.lap_time_delta_s * 12)), txt: (m.lap_time_delta_s > 0 ? '+' : '') + m.lap_time_delta_s + 's', col: '#ef4444' }
      ];
      impactBar.innerHTML = rows.map(function (r) {
        return '<div class="rg-mitem">' +
          '<div class="rg-mtop"><span>' + r.k + '</span><strong>' + r.txt + '</strong></div>' +
          '<div class="rg-mtrack"><div class="rg-mfill" style="width:' + Math.round(r.v) + '%;background:' + r.col + '"></div></div>' +
          '</div>';
      }).join('');
    }

    function requestPreview() {
      clearTimeout(state.previewTimer);
      state.previewTimer = setTimeout(function () {
        fetch('/api/regulations/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ formula: state.formula })
        })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (d && d.metrics) renderImpact(d); })
          .catch(function () {});
      }, 90);
    }

    /* Action buttons */
    root.querySelector('[data-act="vote"]').addEventListener('click', function () {
      if (typeof opts.onSubmitBill === 'function') {
        statusEl.textContent = 'Tabling regulation bill before the F1 Commission…';
        opts.onSubmitBill(JSON.parse(JSON.stringify(state.formula)), function (msg) {
          statusEl.textContent = msg || '';
        });
      }
    });

    root.querySelector('[data-act="save"]').addEventListener('click', function () {
      statusEl.textContent = 'Saving formula to shared Sim & Career library…';
      fetch('/api/regulations/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formula: state.formula })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          statusEl.textContent = d && d.ok
            ? 'Saved "' + state.formula.name + '" to Custom Voted Formulas (available in /sim & /career)!'
            : 'Could not save formula.';
          if (typeof opts.onSaved === 'function') opts.onSaved(d);
        })
        .catch(function (e) { statusEl.textContent = 'Save failed: ' + e; });
    });

    renderDimsPane();
    renderToolsPane();
    renderInventPane();
    drawCAD();
    requestPreview();

    return {
      getFormula: function () { return JSON.parse(JSON.stringify(state.formula)); },
      setLivery: function (pal, style, finish) {
        state.palette = pal || state.palette;
        state.liveryStyle = style || state.liveryStyle;
        state.liveryFinish = finish || state.liveryFinish;
        if (state.threeCtx && state.threeCtx.car && state.threeCtx.car.userData.setPalette) {
          state.threeCtx.car.userData.setPalette(state.palette, state.liveryStyle, state.liveryFinish);
        }
      },
      redraw: function () { drawCAD(); update3DCar(); },
      destroy: function () {
        if (state.rafId) cancelAnimationFrame(state.rafId);
        if (state.threeCtx && state.threeCtx.renderer) state.threeCtx.renderer.dispose();
      }
    };
  }

  global.F1RegGrapher = { create: createRegGrapher };
})(window);
