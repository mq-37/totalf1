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

  let _voicePack = null;
  let _voicePackLoading = false;
  function ensureVoicePack() {
    if (_voicePack || _voicePackLoading || typeof fetch !== "function") return;
    _voicePackLoading = true;
    fetch("/api/dialogue/voice-pack")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && d.drivers) _voicePack = d; })
      .catch(() => {})
      .finally(() => { _voicePackLoading = false; });
  }

  function getBanterMode() {
    try { return localStorage.getItem("traf1_banter_mode") || "authentic"; } catch (_) { return "authentic"; }
  }
  function setBanterMode(mode) {
    const m = ["strict", "authentic", "spicy"].includes(mode) ? mode : "authentic";
    try { localStorage.setItem("traf1_banter_mode", m); } catch (_) {}
    return m;
  }

  function _normDrvName(raw) {
    return String(raw || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+[a-z]{3}$/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function pickDriverSignature(fullName, sit) {
    const mode = getBanterMode();
    if (mode === "strict" || !_voicePack || !_voicePack.drivers) return null;
    const nk = _normDrvName(fullName);
    let prof = _voicePack.drivers[nk];
    if (!prof && nk.includes(" ")) {
      const last = nk.split(" ").pop();
      const k = Object.keys(_voicePack.drivers).find((x) => x.endsWith(" " + last));
      if (k) prof = _voicePack.drivers[k];
    }
    if (!prof || !Array.isArray(prof[sit]) || !prof[sit].length) return null;
    const prob = mode === "spicy" ? 0.82 : 0.56;
    return Math.random() < prob ? pick(prof[sit]) : null;
  }

  function pickTrope(key, drv, eng, rival) {
    const mode = getBanterMode();
    if (mode === "strict" || !_voicePack || !_voicePack.tropes) return null;
    const list = _voicePack.tropes[key];
    if (!Array.isArray(list) || !list.length) return null;
    const item = pick(list);
    const fmt = (s) => String(s || "").replace(/\{rival\}/g, rival || "the car ahead").replace(/\bENG\b/g, eng.short).replace(/\bDRV\b/g, drv);
    return {
      speaker: item.speaker === "ENG" ? eng.short : (item.speaker === "DRV" ? drv : item.speaker),
      to: item.speaker === "ENG" ? drv : eng.short,
      text: fmt(item.text),
      engReply: item.engReply ? fmt(item.engReply) : "",
    };
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function isClassicNoRadioEra(car, ctx) {
    const raw = (ctx && ctx.eraKey) || (car && car.eraKey) || "2026";
    const s = String(raw).toLowerCase();
    const m = s.match(/(19\d{2}|20\d{2})/);
    if (m) return Number(m[1]) < 1985;
    return s.includes("1950") || s.includes("1960") || s.includes("1970") || s.includes("classic");
  }

  function buildMessage(type, car, ctx) {
    ensureVoicePack();
    const eng = car.engineer || { name: "Race Engineer", short: "ENG", personality: "calm" };
    const drv = car.code3 || "DRV";
    const fullName = car.name || car.cleanName || drv;
    const rival = (ctx && ctx.rival) || "the car ahead";
    const lap = (ctx && ctx.lap) || (car.lap + 1);
    const conf = Math.round(car.confidence ?? 60);
    const dna = (car && car.dna) || (ctx && ctx.dna) || {};
    const rArch = dna.radio_archetype || "rhythmic_strategist";
    const noRadio = isClassicNoRadioEra(car, ctx);
    const banterMode = getBanterMode();

    // New proactive engineer & classic F1 trope radio types
    if (!noRadio && (type === "proactive_undercut" || type === "give_place_back" || type === "we_are_checking" || type === "pit_confusion")) {
      const tr = pickTrope(type, drv, eng, rival);
      if (tr) {
        return {
          speaker: tr.speaker,
          to: tr.to,
          text: tr.text,
          engReply: tr.engReply,
          tone: type === "proactive_undercut" ? "win" : "warn",
          category: "strategy",
        };
      }
    }

    // Pre-1985 Authentic Pit-Wall Chalkboard & Marshal Channel for non-mechanical events!
    if (noRadio && !String(type).startsWith("comp_")) {
      const boardLines = {
        overtake: `PIT BOARD → ${drv}: P${car.pos || 1} (+PASS ${rival}) · HOLD RHYTHM`,
        tyre_cliff: `MARSHAL OBS: ${fullName} sliding heavily on worn tread — pit crew preparing fresh rubber!`,
        mistake: `MARSHAL OBS: ${fullName} locks up into the braking zone — recovers cleanly onto track.`,
        confidence_zone: `PIT BOARD → ${drv}: FASTEST LAP · GAP GROWING · KEEP IT SMOOTH`,
        slow_pit: `PIT LANE: Slow knock-off wheel nut costs ${fullName} precious seconds in the bay!`,
        fast_pit: `PIT LANE: Crisp mechanical service — ${fullName} rejoins cleanly!`,
        rain: `PIT BOARD → ${drv}: RAIN AHEAD · WET TYRES READY IN GARAGE`,
        refuel: `PIT BOARD → ${drv}: BOX THIS LAP · FUEL CHURN READY`,
        safety_car: `MARSHAL POST: YELLOW FLAGS WAVED · HOLD POSITION`,
        final_lap: `PIT BOARD → ${drv}: L1 TO GO · BRING IT HOME`,
        setup_feedback: `PIT WALL LOG: ${fullName} chassis balance ${Math.round((ctx && ctx.balanceBias) || 0)} · Signal ${Math.round((ctx && ctx.feedbackQuality) || 74)}/100.`,
      };
      return {
        speaker: "PIT BOARD",
        to: drv,
        text: boardLines[type] || `PIT BOARD → ${drv}: LAP ${lap} · STAY SMOOTH`,
        tone: (type === "overtake" || type === "confidence_zone" || type === "fast_pit" || type === "final_lap") ? "win" : (type === "tyre_cliff" || type === "mistake" || type === "rain" ? "warn" : "info"),
        category: type === "setup_feedback" ? "setup" : "race",
      };
    }

    switch (type) {
      case "overtake": {
        const sigOvt = pickDriverSignature(fullName, "overtake");
        const byArch = {
          clinical_perfectionist: [
            `Got ${rival}. Front-left was graining slightly in the wake — give me Diff Entry +1 now we have clean air.`,
            `Done on ${rival}. Mode 4, recharge on the back straight and let's manage the target delta.`,
          ],
          rhythmic_strategist: [
            `Clean pass on ${rival}. Tyres are coming back to me nicely — keep me posted on the gap behind.`,
            `Through past ${rival}! Let's stay on Plan B, Target +2 and build a rhythm.`,
          ],
          tactical_chessmaster: [
            `Past ${rival}! Wait — check the undercut window on the car ahead, I think Plan C is two seconds strong here.`,
            `Got ${rival} cleanly. Tell me if they box opposite — we can box to overtake if they cover.`,
          ],
          expressive_telemetry: [
            `YES! Late on the brakes past ${rival}! What a move — car is alive on turn-in, let's push!`,
            `Boom! Got ${rival} on the switchback! Give me Strat Mode 4 and the gap to the next car!`,
          ],
          stoic_minimalist: [
            `Copy. Past ${rival}.`,
            `Yeah, got ${rival}. Balance is fine, keep me posted on gaps.`,
          ],
        };
        return {
          speaker: drv,
          to: eng.short,
          text: sigOvt || pick(byArch[rArch] || byArch.rhythmic_strategist),
          engReply: `${eng.short}: Copy ${drv}, clean move. ${conf >= 75 ? "Push now, clean air ahead — Strat Mode 4." : "Manage rear temps, Target +1."}`,
          tone: "win",
          category: "race",
        };
      }
      case "tyre_cliff": {
        if (banterMode !== "strict" && Math.random() < (banterMode === "spicy" ? 0.45 : 0.22)) {
          const bluff = pickTrope("tyre_bluff", drv, eng, rival);
          if (bluff) return { speaker: bluff.speaker, to: bluff.to, text: bluff.text, engReply: bluff.engReply, tone: "warn", category: "strategy" };
        }
        const sigTyre = pickDriverSignature(fullName, "tyre");
        const byArch = {
          clinical_perfectionist: `${eng.short}, rear surface temp is spiked and front-left is graining in mid-speed — two clicks front wing on the stop.`,
          rhythmic_strategist: `${eng.short}, these tyres are gone mate — zero rear traction on exit. Check Plan B window.`,
          tactical_chessmaster: `Box to overtake now? My rears hit the cliff and the undercut is worth 1.8s here — check traffic!`,
          expressive_telemetry: `No grip! Rear is sliding everywhere off the apex — Multi-function Yellow G6 isn't saving it, we need to box!`,
          stoic_minimalist: `Yeah, the rear is a bit spicy now. Tyres are done. Box when ready.`,
        };
        return {
          speaker: drv,
          to: eng.short,
          text: sigTyre || byArch[rArch] || byArch.rhythmic_strategist,
          engReply: `${eng.short}: Copy ${drv}, box this lap — box opposite ${rival} if they stay out. Confirm pit confirm button.`,
          tone: "warn",
          category: "strategy",
        };
      }
      case "mistake": {
        const sigFrust = pickDriverSignature(fullName, "frustrated");
        if (sigFrust && banterMode !== "strict") {
          return {
            speaker: drv,
            to: eng.short,
            text: sigFrust,
            engReply: `${eng.short}: Copy ${drv}, shake it off — B-Bal +1% forward and focus on the next apex.`,
            tone: "warn",
            category: "race",
          };
        }
        return {
          speaker: eng.short,
          to: drv,
          text: eng.personality === "fiery"
            ? `${drv}, breathe! B-Bal +1.5% forward, Diff Entry +2, Mid -1. Forget that lock-up and hit your braking markers.`
            : `All good ${fullName.split(" ")[0]}, small lock-up, tyres look okay on temp. Lift and coast 30m into T1 to settle the fronts.`,
          tone: "warn",
          category: "race",
        };
      }
      case "confidence_zone": {
        const sigWin = pickDriverSignature(fullName, "win");
        return {
          speaker: eng.short,
          to: drv,
          text: rArch === "stoic_minimalist"
            ? `Purple S1 and S2, ${drv}. Gap opening by four tenths a lap.`
            : pick([
                `Hammer time ${drv}! Purple sectors — Strat Mode 4, keep hitting those apexes!`,
                `Mega stint ${drv}, fastest car on track! Target +2 on Plan A, gap building nicely.`,
              ]),
          engReply: sigWin ? `${drv}: ${sigWin}` : (rArch === "stoic_minimalist" ? `${drv}: Copy. Understood.` : ""),
          tone: "win",
          category: "race",
        };
      }
      case "slow_pit":
        return {
          speaker: eng.short,
          to: drv,
          text: `Sorry mate, sticky wheel nut cost us time in the box. Head down, Recharge Off — push now, overtake available!`,
          tone: "warn",
          category: "strategy",
        };
      case "fast_pit":
        return {
          speaker: eng.short,
          to: drv,
          text: `⚡ Lightning stop by the crew! Push hard on this out-lap — overtake available, box-to-overtake is ON!`,
          tone: "win",
          category: "strategy",
        };
      case "rain":
        return {
          speaker: eng.short,
          to: drv,
          text: `Radar shows rain intensifying at Turn 1. Look for off-line grip off the rubber — Inters are ready in the garage!`,
          engReply: rArch === "tactical_chessmaster" ? `${drv}: Copy, keep me posted every half-lap — I'll call the crossover.` : "",
          tone: "warn",
          category: "strategy",
        };
      case "refuel":
        return {
          speaker: eng.short,
          to: drv,
          text: `Box this lap for fuel & fresh rubber — short-fill Plan B puts us lighter than ${rival}!`,
          tone: "info",
          category: "strategy",
        };
      case "override_ready":
        return {
          speaker: eng.short,
          to: drv,
          text: `Within 1.0 second! 2026 Manual Override Mode is ARMED — Push now, overtake available on the main straight!`,
          tone: "win",
          category: "race",
        };
      case "team_order":
        return {
          speaker: eng.short,
          to: drv,
          text: `${drv}, let ${rival} through into the next braking zone — they are on a different strategy with fresher tyres. Swap positions.`,
          engReply: `${drv}: Copy, understood — moving off line on the straight.`,
          tone: "info",
          category: "strategy",
        };
      case "blue_flag":
        return {
          speaker: eng.short,
          to: drv,
          text: `Blue flags coming up — ${rival} is ${(ctx && ctx.gapS ? ctx.gapS.toFixed(1) : "2.1")} seconds behind lapping us. Let them pass cleanly after the apex, don't risk a 5-second penalty!`,
          engReply: `${drv}: Copy, watching my mirrors — moving off-line on exit.`,
          tone: "info",
          category: "race",
        };
      case "meatball":
        return {
          speaker: eng.short,
          to: drv,
          text: `Black and Orange Meatball Flag from Race Control! Front wing endplate is dragging — box this lap for a new nose, mandatory FIA safety order!`,
          engReply: `${drv}: Understood, pitting this lap — car feels super light on the front axle anyway.`,
          tone: "warn",
          category: "mechanical",
        };
      case "penalty_serve":
        return {
          speaker: eng.short,
          to: drv,
          text: `Box this lap — remember we have a ${ctx?.penS || 5}-second FIA penalty to serve motionless in the box! Crew will stay hands-off until the clock clears.`,
          engReply: `${drv}: Copy, hitting my marks cleanly — give me the countdown.`,
          tone: "warn",
          category: "strategy",
        };
      case "give_place_back":
        return {
          speaker: eng.short,
          to: drv,
          text: `FIA Race Control noted leaving the track to pass ${rival} — give the position back immediately on the straight to avoid a 5-second penalty!`,
          engReply: `${drv}: Fine, lifting off to hand it back — I'll get him cleanly with DRS next lap!`,
          tone: "warn",
          category: "race",
        };
      case "unsafe_release":
        return {
          speaker: eng.short,
          to: drv,
          text: `Stewards handed us a 5-second penalty for unsafe release in the fast lane — head down and push to build a 5-second gap behind!`,
          engReply: `${drv}: Copy that — Strat Mode 2, pushing flat out!`,
          tone: "warn",
          category: "strategy",
        };
      case "safety_car":
        return {
          speaker: eng.short,
          to: drv,
          text: `Safety Car deployed! Stay positive on the FIA delta — Fail 24 off, keep brake & front tyre temps alive.`,
          tone: "warn",
          category: "strategy",
        };
      case "final_lap":
        return {
          speaker: eng.short,
          to: drv,
          text: `Last lap, Lap ${lap}! Strat Mode 1, empty the battery — everything you've got to the flag!`,
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
      const replyHtml = payload.engReply
        ? `<div class="tr-reply"><i class="fas fa-reply"></i> ${esc(payload.engReply)}</div>`
        : "";
      containerEl.innerHTML = `
        <div class="tr-card tone-${esc(payload.tone || "info")}" style="--tr-col:${esc(payload.color || "#e10600")}">
          <div class="tr-head">
            <span class="tr-badge"><i class="fas fa-headset"></i> ${payload.engReply ? "2-WAY RADIO" : "TEAM RADIO"}</span>
            <strong class="tr-route">${esc(payload.speaker)} → ${esc(payload.to)}</strong>
            <span class="tr-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
          </div>
          <div class="tr-body">"${esc(payload.text)}"</div>
          ${replyHtml}
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
      if (o.voiceEnabled && o.voiceEnabled()) {
        if (global.F1Sfx && global.F1Sfx.speak) {
          const isBoard = String(payload.speaker || "").toUpperCase() === "PIT BOARD";
          const cleanReply = payload.engReply ? String(payload.engReply).replace(/^[^:]{2,26}:\s*/, "").slice(0, 175) : "";
          global.F1Sfx.speak({
            text: payload.text.slice(0, 190),
            replyText: isBoard ? "" : cleanReply,
            role: isBoard ? "stewards" : (payload.isEngineer ? "engineer" : "driver"),
            archetype: payload.archetype || "",
            driverName: payload.driverName || "",
            engineerName: payload.engineerName || "",
            nationality: payload.nationality || "",
            tone: payload.tone || "info",
            channel: isBoard ? "stewards" : "radio",
            priority: "high",
          });
        } else if (global.speechSynthesis && !global.speechSynthesis.speaking) {
          try {
            const u = new SpeechSynthesisUtterance(payload.text.slice(0, 140));
            u.rate = 1.1;
            global.speechSynthesis.speak(u);
          } catch (_) {}
        }
      }

      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => containerEl.classList.add("hidden"), payload.actions ? 8500 : (payload.engReply ? 7200 : 5400));
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
          engReply: msg.engReply || "",
          tone: msg.tone,
          color,
          isEngineer: msg.speaker !== (car.code3 || (car.card && car.card.code3) || "DRV"),
          archetype: (car.dna && car.dna.radio_archetype) || "",
          driverName: car.name || car.cleanName || (car.card && car.card.clean_name) || "",
          engineerName: (car.engineer && car.engineer.name) || "",
          nationality: (car.card && car.card.nationality) || (car.driver && car.driver.nationality) || "",
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
    getBanterMode,
    setBanterMode,
    ensureVoicePack,
  };
})(window);
