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
          category: "race",
        };
      case "comp_ice": {
        const kph = (ctx && ctx.kphLoss) || 8;
        const sharp = ((ctx && ctx.feedbackQuality) || 70) >= 78;
        const tier = (global.F1RaceEngine && global.F1RaceEngine.resolveEraTier) ? global.F1RaceEngine.resolveEraTier((ctx && ctx.eraKey) || car.eraKey || "2026") : "hybrid";
        if (tier === "classic") {
          return {
            speaker: "PIT BOARD",
            to: drv,
            text: `CHALKBOARD: Engine oil temp climbing (${ctx?.temp || 104}°C · ${ctx?.health || 58}%) — short-shift 500 RPM down the straight!`,
            engReply: `MARSHAL OBS: ${drv}'s naturally aspirated engine sounding slightly flat (-${kph} kph trap) on top end.`,
            tone: ctx && ctx.severity === "critical" ? "warn" : "info",
            category: "mechanical",
            component: "ice",
          };
        }
        return {
          speaker: drv,
          to: eng.short,
          text: sharp
            ? `${eng.short}, losing ~${kph} kph at the end of the main straight — feels like ${tier === "turbo" ? "boost drop" : (tier === "v10" ? "top-end V10 misfire" : "ICE cylinder derate")}!`
            : `${eng.short}, I'm losing power down the straight! Car feels flat at the top of the rev range, check the engine!`,
          engReply: `${eng.short}: Copy ${drv}, confirmed on telemetry — engine thermal derate (+${Math.round(kph * 0.9)}°C, health ${ctx?.health || 55}%). ${tier === "hybrid" ? "Switch Strat Mode 4 & lift-and-coast 35m!" : "Short-shift 300 RPM & nurse temps!"}`,
          tone: ctx && ctx.severity === "critical" ? "warn" : "info",
          category: "mechanical",
          component: "ice",
        };
      }
      case "comp_ers": {
        const kph = (ctx && ctx.kphLoss) || 6;
        const sharp = ((ctx && ctx.feedbackQuality) || 70) >= 78;
        const tier = (global.F1RaceEngine && global.F1RaceEngine.resolveEraTier) ? global.F1RaceEngine.resolveEraTier((ctx && ctx.eraKey) || car.eraKey || "2026") : "hybrid";
        if (tier === "classic") {
          return {
            speaker: "PIT BOARD",
            to: drv,
            text: `CHALKBOARD: Fuel pressure / Weber carburettors running rich (${ctx?.health || 58}%) — smooth throttle out of slow bends!`,
            engReply: `MARSHAL OBS: ${drv}'s Lotus/chassis stumbling briefly on carburettor pickup (-${kph} kph exit).`,
            tone: "warn",
            category: "mechanical",
            component: "ers",
          };
        }
        if (tier === "turbo") {
          return {
            speaker: drv,
            to: eng.short,
            text: sharp
              ? `Turbo wastegate sticking out of the slow corners — boost lag is costing ~${kph} kph down the straight!`
              : `No boost coming off the apex! Turbo feels super laggy, check the pressure!`,
            engReply: `${eng.short}: Confirmed ${drv}, turbo wastegate temp ${ctx?.temp || 168}°C (${ctx?.health || 56}%). Dial boost knob back two clicks!`,
            tone: "warn",
            category: "mechanical",
            component: "ers",
          };
        }
        if (tier === "v10") {
          return {
            speaker: drv,
            to: eng.short,
            text: sharp
              ? `Hydraulic pressure dipping on upshifts — ECU sensor flag on the dash, losing ~${kph} kph on exit!`
              : `Car feels hesitant on upshifts — electronics or hydraulics acting up!`,
            engReply: `${eng.short}: Understood ${drv}, hydraulic manifold at ${ctx?.health || 58}% (${ctx?.temp || 96}°C). Switch Multi-Function Default 04.`,
            tone: "warn",
            category: "mechanical",
            component: "ers",
          };
        }
        return {
          speaker: drv,
          to: eng.short,
          text: sharp
            ? `Battery derating 150m early out of the hairpin — MGU-K harvest is clipping on exit, costing ~${kph} kph on the straight!`
            : `No deployment out of the slow corners! Feels like the hybrid battery isn't harvesting properly.`,
          engReply: `${eng.short}: Understood ${drv}, MGU-K inverter temp elevated (${ctx?.temp || 92}°C · ${ctx?.health || 58}%). Going Harvest Map 3 to stabilize deploy.`,
          tone: "warn",
          category: "mechanical",
          component: "ers",
        };
      }
      case "comp_gearbox": {
        const sharp = ((ctx && ctx.feedbackQuality) || 70) >= 78;
        const tier = (global.F1RaceEngine && global.F1RaceEngine.resolveEraTier) ? global.F1RaceEngine.resolveEraTier((ctx && ctx.eraKey) || car.eraKey || "2026") : "hybrid";
        if (tier === "classic") {
          return {
            speaker: "PIT BOARD",
            to: drv,
            text: `CHALKBOARD: 5-speed dogleg synchros worn (${ctx?.health || 56}%) — double-declutch down into slow hairpins!`,
            engReply: `MARSHAL OBS: ${drv} carefully nursing manual dogleg gear shifts at ${ctx?.temp || 98}°C.`,
            tone: "warn",
            category: "mechanical",
            component: "gearbox",
          };
        }
        return {
          speaker: drv,
          to: eng.short,
          text: sharp
            ? `Syncro hesitation shifting 4th to 5th on traction exit — ${tier === "turbo" ? "H-pattern linkage" : "hydraulic pressure"} feels sluggish!`
            : `Shifts feel clunky coming off the apex, losing drive out of the tight turns!`,
          engReply: `${eng.short}: Copy, gearbox wear at ${ctx?.health || 56}% (${ctx?.temp || 114}°C). Short-shift 4th/5th slightly — keeping you out of neutral.`,
          tone: "warn",
          category: "mechanical",
          component: "gearbox",
        };
      }
      case "comp_brakes": {
        const sharp = ((ctx && ctx.feedbackQuality) || 70) >= 78;
        const tier = (global.F1RaceEngine && global.F1RaceEngine.resolveEraTier) ? global.F1RaceEngine.resolveEraTier((ctx && ctx.eraKey) || car.eraKey || "2026") : "hybrid";
        if (tier === "classic") {
          return {
            speaker: "PIT BOARD",
            to: drv,
            text: `CHALKBOARD: Early disc/drum fade (${ctx?.temp || 335}°C · ${ctx?.health || 56}%) — brake 25m earlier into Turn 1!`,
            engReply: `MARSHAL OBS: ${drv} pumping the brake pedal entering the heavy stop.`,
            tone: "warn",
            category: "mechanical",
            component: "brakes",
          };
        }
        return {
          speaker: drv,
          to: eng.short,
          text: sharp
            ? `Front-left ${tier === "turbo" ? "ventilated disc" : "carbon disc"} glazing into the heavy braking zone — pedal went long by 15m! Moving B-Bal 1.5% rearward.`
            : `Brakes feel super spongy into the hairpin! Nearly locked up twice in dirty air.`,
          engReply: `${eng.short}: Telemetry confirms brake duct temp ${ctx?.temp || 640}°C (health ${ctx?.health || 55}%). Pull out of slipstream on straights & lift-coast 40m.`,
          tone: "warn",
          category: "mechanical",
          component: "brakes",
        };
      }
      case "comp_floor": {
        const sharp = ((ctx && ctx.feedbackQuality) || 70) >= 78;
        const tier = (global.F1RaceEngine && global.F1RaceEngine.resolveEraTier) ? global.F1RaceEngine.resolveEraTier((ctx && ctx.eraKey) || car.eraKey || "2026") : "hybrid";
        if (tier === "classic") {
          return {
            speaker: "PIT BOARD",
            to: drv,
            text: `CHALKBOARD: Spaceframe / monocoque rivet fatigue (${ctx?.health || 58}%) — avoid rough apex kerbs!`,
            engReply: `MARSHAL OBS: ${drv}'s classic monocoque flexing noticeably over high-speed bumps.`,
            tone: "warn",
            category: "mechanical",
            component: "floor",
          };
        }
        return {
          speaker: drv,
          to: eng.short,
          text: sharp
            ? `Lost ~12 points of rear downforce through the high-speed sweepers — ${tier === "turbo" ? "ground-effect side skirt" : (tier === "v10" ? "bargeboard/diffuser" : "Venturi floor edge seal")} must be damaged!`
            : `Rear end suddenly feels super loose in the fast corners — zero aero bite!`,
          engReply: `${eng.short}: Confirmed — aero load shows ${tier === "turbo" ? "skirt/wing" : "floor edge"} degradation (${ctx?.health || 58}%). Compensating with diff entry +1 click.`,
          tone: "warn",
          category: "mechanical",
          component: "floor",
        };
      }
      case "comp_suspension": {
        const sharp = ((ctx && ctx.feedbackQuality) || 70) >= 78;
        return {
          speaker: drv,
          to: eng.short,
          text: sharp
            ? `Heavy front-right steering vibration over the apex kerbs — damper rebound feels off on turn-in!`
            : `Steering feels heavy and bumpy through the chicane, car isn't riding the kerbs cleanly.`,
          engReply: `${eng.short}: Copy ${drv}, front suspension strain at ${ctx?.health || 58}%. Stay off the high sausage kerbs to protect the wishbone.`,
          tone: "warn",
          category: "mechanical",
          component: "suspension",
        };
      }
      case "setup_feedback": {
        const bal = Number((ctx && ctx.balanceBias) || 0);
        const fbq = Number((ctx && ctx.feedbackQuality) || 72);
        const isMid = lap >= 7;
        const balTxt = bal < -18
          ? (fbq >= 78
            ? (isMid ? `As fuel burns off, mid-corner front washout (-${Math.abs(bal)}) is growing — let's add +2 clicks front wing at the next stop.` : `Early balance check: front axle pushing wide in medium-speed apexes (-${Math.abs(bal)} understeer).`)
            : `Front isn't turning in well, still fighting understeer through the tight turns.`)
          : (bal > 18
            ? (fbq >= 78
              ? (isMid ? `Rear getting livelier on worn rubber (+${bal} oversteer) — going +2% on-throttle diff lock to calm traction exits.` : `Rear stepping out slightly on power (+${bal} oversteer) — diff entry feels a click too open.`)
              : `Rear feels snappy on exit, hard to put the power down cleanly!`)
            : (isMid
              ? `Mid-stint check: aero balance & brake migration still bang on target — rear degradation is super manageable.`
              : `Opening stint feedback: aero balance & diff feel right in the sweet spot! Car is rotating predictably on entry and exit.`));
        return {
          speaker: drv,
          to: eng.short,
          text: balTxt,
          engReply: `${eng.short}: Copy ${drv} — Signal Quality ${fbq}/100 logged to Pit Wall setup model.`,
          tone: Math.abs(bal) <= 18 ? "win" : "info",
          category: "setup",
        };
      }
      default:
        return {
          speaker: eng.short,
          to: drv,
          text: (ctx && ctx.text) || `Copy ${drv}, looking strong out there.`,
          tone: "info",
          category: "race",
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
        const msg = buildMessage(type, car, ctx);
        const color = car.color || (car.card && car.card.hero_color) || "#e10600";
        if (typeof o.onEmit === "function") {
          try {
            o.onEmit({
              lap: (ctx && ctx.lap) || ((car.lap || 0) + 1),
              carIdx: car.idx ?? -1,
              code3: car.code3 || (car.card && car.card.code3) || "DRV",
              speaker: msg.speaker,
              to: msg.to,
              color,
              category: msg.category || (type.startsWith("comp_") ? "mechanical" : (type === "setup_feedback" ? "setup" : "race")),
              component: msg.component || (ctx && ctx.component) || "",
              severity: (ctx && ctx.severity) || msg.tone || "info",
              text: msg.text,
              engReply: msg.engReply || "",
              feedbackQuality: (ctx && ctx.feedbackQuality) ?? (car.eng && car.eng.feedback ? car.eng.feedback.score : null),
            });
          } catch (_) {}
        }
        const now = performance.now();
        if (!force && now - lastEmitTs < minCooldownMs) return false;
        lastEmitTs = now;
        showCard({
          speaker: msg.speaker,
          to: msg.to,
          text: msg.text,
          tone: msg.tone,
          color,
          actions: ctx && ctx.actions,
        });
        return true;
      },
      buildMessage,
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
