/**
 * Race Engineers & Contextual Team Radio Engine (/sim & /career).
 * - Assigns 2 authentic/named Race Engineers per team with personality & chemistry
 * - Renders translucent F1 TV Team Radio Wave Cards with animated equalizer bars
 * - Supports contextual race events (overtake, tyre cliff, rain, confidence, mistakes,
 *   pit errors, refuelling, 2026 Manual Override, safety car) + 1-click Pit Wall replies.
 */
(function (global) {
  "use strict";

  const TEAM_ENGINEERS = {
    "mercedes":     [{ name: "Peter Bonnington", short: "BONO", personality: "calm", rating: 94 }, { name: "Marcus Dudley", short: "DUDLEY", personality: "analytical", rating: 88 }],
    "red bull":     [{ name: "Gianpiero Lambiase", short: "GP", personality: "fiery", rating: 95 }, { name: "Hugh Bird", short: "BIRD", personality: "analytical", rating: 86 }],
    "ferrari":      [{ name: "Bryan Bozzi", short: "BOZZI", personality: "calm", rating: 91 }, { name: "Riccardo Adami", short: "ADAMI", personality: "veteran", rating: 90 }],
    "mclaren":      [{ name: "Will Joseph", short: "JOSEPH", personality: "analytical", rating: 92 }, { name: "Tom Stallard", short: "STALLARD", personality: "calm", rating: 90 }],
    "aston martin": [{ name: "Andrew Vizard", short: "VIZARD", personality: "calm", rating: 85 }, { name: "Gary Gannon", short: "GANNON", personality: "veteran", rating: 87 }],
    "alpine":       [{ name: "John Howard", short: "HOWARD", personality: "analytical", rating: 83 }, { name: "Josh Peckett", short: "PECKETT", personality: "calm", rating: 82 }],
    "williams":     [{ name: "Gaëtan Jego", short: "JEGO", personality: "analytical", rating: 86 }, { name: "James Urwin", short: "URWIN", personality: "calm", rating: 84 }],
    "haas":         [{ name: "Ronan O'Hare", short: "O'HARE", personality: "calm", rating: 82 }, { name: "Laura Mueller", short: "MUELLER", personality: "analytical", rating: 85 }],
    "sauber":       [{ name: "Steven Petrik", short: "PETRIK", personality: "analytical", rating: 81 }, { name: "Jose Manuel Lopez", short: "LOPEZ", personality: "calm", rating: 82 }],
    "audi":         [{ name: "Steven Petrik", short: "PETRIK", personality: "analytical", rating: 84 }, { name: "Lukas Weber", short: "WEBER", personality: "calm", rating: 85 }],
    "racing bulls": [{ name: "Mattia Spini", short: "SPINI", personality: "calm", rating: 84 }, { name: "Pierre Hamelin", short: "HAMELIN", personality: "fiery", rating: 86 }],
    "cadillac":     [{ name: "Kyle Mitchell", short: "MITCHELL", personality: "analytical", rating: 83 }, { name: "Elena Rossi", short: "ROSSI", personality: "calm", rating: 82 }],
    "lotus":        [{ name: "Colin Chapman", short: "CHAPMAN", personality: "veteran", rating: 94 }, { name: "Peter Warr", short: "WARR", personality: "calm", rating: 88 }],
    "benetton":     [{ name: "Pat Symonds", short: "SYMONDS", personality: "analytical", rating: 93 }, { name: "Joan Villadelprat", short: "JOAN", personality: "fiery", rating: 87 }],
    "renault":      [{ name: "Alan Permane", short: "PERMANE", personality: "fiery", rating: 91 }, { name: "Rod Nelson", short: "NELSON", personality: "veteran", rating: 88 }],
  };

  const FALLBACK_ENGINEERS = [
    { name: "Marco Bellini", short: "BELLINI", personality: "analytical", rating: 83 },
    { name: "Claire Bennett", short: "BENNETT", personality: "calm", rating: 84 },
    { name: "David Kowalski", short: "KOWALSKI", personality: "fiery", rating: 81 },
    { name: "Stefan Lindqvist", short: "LINDQVIST", personality: "veteran", rating: 85 },
    { name: "Hiroshi Tanaka", short: "TANAKA", personality: "calm", rating: 84 },
    { name: "Lucas Moreau", short: "MOREAU", personality: "analytical", rating: 82 },
  ];

  function assignEngineer(teamName, seatIdx) {
    const tl = String(teamName || "").toLowerCase();
    for (const k of Object.keys(TEAM_ENGINEERS)) {
      if (tl.includes(k)) {
        const base = TEAM_ENGINEERS[k][seatIdx % 2];
        return Object.assign({}, base, { chemistry: 68 + ((seatIdx * 7) % 18) });
      }
    }
    let h = 0;
    for (let i = 0; i < tl.length; i++) h = (h * 31 + tl.charCodeAt(i)) | 0;
    const base = FALLBACK_ENGINEERS[Math.abs(h + seatIdx) % FALLBACK_ENGINEERS.length];
    return Object.assign({}, base, { chemistry: 66 + (Math.abs(h) % 16) });
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function buildMessage(type, car, ctx) {
    const eng = car.engineer || { name: "Race Engineer", short: "ENG", personality: "calm" };
    const drv = car.code3 || "DRV";
    const fullName = car.name || car.cleanName || drv;
    const rival = (ctx && ctx.rival) || "the car ahead";
    const lap = (ctx && ctx.lap) || (car.lap + 1);
    const conf = Math.round(car.confidence ?? 60);

    switch (type) {
      case "overtake":
        return {
          speaker: drv,
          to: eng.short,
          text: conf >= 76
            ? pick([`YES! Got ${rival} cleanly! Car feels hooked up, let's hunt the next one!`, `Boom! Late on the brakes past ${rival} — give me the gap ahead!`])
            : pick([`Through past ${rival}. Tyres are hanging in there.`, `Done! Clean pass on ${rival}, settling into rhythm now.`]),
          tone: "win",
        };
      case "tyre_cliff":
        return {
          speaker: drv,
          to: eng.short,
          text: pick([
            `${eng.short}, my rears are completely gone! I'm sliding everywhere — we need to box!`,
            `Zero traction out of the slow corners, these tyres have hit the cliff!`,
          ]),
          tone: "warn",
        };
      case "mistake":
        return {
          speaker: eng.short,
          to: drv,
          text: eng.personality === "fiery"
            ? `${drv}, breathe! Reset the brake bias one click forward and forget that lock-up. Keep your head in it.`
            : `All good ${fullName.split(" ")[0]}, tiny lock-up, zero damage. Stay calm, your pace is still strong.`,
          tone: "warn",
        };
      case "confidence_zone":
        return {
          speaker: eng.short,
          to: drv,
          text: pick([
            `Purple sectors! You're in the zone right now — keep hitting those apexes!`,
            `Mega stint ${drv}, fastest car on track! Keep building this gap.`,
          ]),
          tone: "win",
        };
      case "slow_pit":
        return {
          speaker: eng.short,
          to: drv,
          text: `Sorry mate, sticky wheel nut cost us time in the box. Head down, clean air ahead — push!`,
          tone: "warn",
        };
      case "fast_pit":
        return {
          speaker: eng.short,
          to: drv,
          text: `⚡ Lightning stop by the crew! Push hard on this out-lap to lock in the undercut!`,
          tone: "win",
        };
      case "rain":
        return {
          speaker: eng.short,
          to: drv,
          text: `Radar shows rain intensifying at Turn 1. Keep us posted on grip — Inters are ready in the garage!`,
          tone: "warn",
        };
      case "refuel":
        return {
          speaker: eng.short,
          to: drv,
          text: `Box this lap for fuel & fresh rubber — short-fill strategy puts us lighter than ${rival}!`,
          tone: "info",
        };
      case "override_ready":
        return {
          speaker: eng.short,
          to: drv,
          text: `Within 1.0 second! 2026 Manual Override Mode is ARMED — deploy full battery on the main straight!`,
          tone: "win",
        };
      case "safety_car":
        return {
          speaker: eng.short,
          to: drv,
          text: `Safety Car deployed! Stay positive on the delta — keep heat in the fronts and standby for pit call.`,
          tone: "warn",
        };
      case "final_lap":
        return {
          speaker: eng.short,
          to: drv,
          text: `Last lap, Lap ${lap}! Empty the battery, everything you've got to the flag!`,
          tone: "win",
        };
      default:
        return {
          speaker: eng.short,
          to: drv,
          text: (ctx && ctx.text) || `Copy ${drv}, looking strong out there.`,
          tone: "info",
        };
    }
  }

  function createRadioController(containerEl, opts) {
    const o = opts || {};
    let hideTimer = null;
    let lastEmitTs = 0;
    const minCooldownMs = o.cooldownMs || 6500;

    function showCard(payload) {
      if (!containerEl || !payload) return;
      const esc = global.F1RaceEngine ? global.F1RaceEngine.esc : (s) => String(s || "");
      const actionsHtml = Array.isArray(payload.actions) && payload.actions.length
        ? `<div class="tr-actions">${payload.actions.map((a, idx) => `<button type="button" class="tr-act-btn" data-tr-act="${idx}">${esc(a.label)}</button>`).join("")}</div>`
        : "";
      containerEl.innerHTML = `
        <div class="tr-card tone-${esc(payload.tone || "info")}" style="--tr-col:${esc(payload.color || "#e10600")}">
          <div class="tr-head">
            <span class="tr-badge"><i class="fas fa-headset"></i> TEAM RADIO</span>
            <strong class="tr-route">${esc(payload.speaker)} → ${esc(payload.to)}</strong>
            <span class="tr-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
          </div>
          <div class="tr-body">"${esc(payload.text)}"</div>
          ${actionsHtml}
        </div>
      `;
      containerEl.classList.remove("hidden");

      if (Array.isArray(payload.actions)) {
        containerEl.querySelectorAll("[data-tr-act]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const act = payload.actions[Number(btn.dataset.trAct)];
            if (act && typeof act.onClick === "function") act.onClick();
            containerEl.classList.add("hidden");
          });
        });
      }

      if (o.sfxEnabled && o.sfxEnabled() && global.F1Sfx && global.F1Sfx.radioBeep) {
        try { global.F1Sfx.radioBeep(); } catch (_) {}
      }
      if (o.voiceEnabled && o.voiceEnabled() && global.speechSynthesis && !global.speechSynthesis.speaking) {
        try {
          const u = new SpeechSynthesisUtterance(payload.text.slice(0, 140));
          u.rate = 1.1;
          global.speechSynthesis.speak(u);
        } catch (_) {}
      }

      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => containerEl.classList.add("hidden"), payload.actions ? 8500 : 5400);
    }

    return {
      emit(type, car, ctx, force) {
        const now = performance.now();
        if (!force && now - lastEmitTs < minCooldownMs) return false;
        lastEmitTs = now;
        const msg = buildMessage(type, car, ctx);
        showCard({
          speaker: msg.speaker,
          to: msg.to,
          text: msg.text,
          tone: msg.tone,
          color: car.color || (car.card && car.card.hero_color) || "#e10600",
          actions: ctx && ctx.actions,
        });
        return true;
      },
      hide() {
        clearTimeout(hideTimer);
        if (containerEl) containerEl.classList.add("hidden");
      },
    };
  }

  global.F1RadioEngine = {
    assignEngineer,
    createRadioController,
  };
})(window);
