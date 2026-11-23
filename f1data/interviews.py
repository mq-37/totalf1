"""
Context-Aware Post-Race Driver Reports, Press-Pen Interviews & Opinions Engine.

Generates realistic post-race questions & driver answers shaped by:
  - Actual race outcome (win, podium, points, climbed grid, dropped places, DNF)
  - Specific race events (overtakes, lock-ups/mistakes, slow/fast pits, rain, safety cars)
  - Driver end-of-race Confidence (0-100), Momentum (-100..+100), and Historical Track Affinity
  - Driver Persona (iceman, fiery_racer, perfectionist, rookie_hungry, veteran_statesman, team_player)
  - Explicit "Driver Perspective" reasoning tags explaining WHY they answered that way.
"""
from __future__ import annotations

from typing import Any


PERSONA_LABELS: dict[str, str] = {
    "iceman": "Iceman (Stoic & Direct)",
    "fiery_racer": "Fiery Racer (Passionate & Aggressive)",
    "perfectionist": "Perfectionist (Relentless Analyst)",
    "rookie_hungry": "Hungry Rookie (Eager & Expressive)",
    "veteran_statesman": "Veteran Statesman (Measured & Tactical)",
    "team_player": "Team Player (Constructive & Loyal)",
}


def _conf_label(conf: float) -> str:
    if conf >= 82:
        return "IN THE ZONE"
    if conf >= 66:
        return "HIGH CONFIDENCE"
    if conf >= 46:
        return "STEADY"
    if conf >= 28:
        return "LOW CONFIDENCE"
    return "SHAKEN"


def _rate_driver(stint: dict[str, Any], grid_pos: int, total_cars: int) -> float:
    if stint.get("dnf"):
        return round(max(4.2, min(7.2, 5.5 + (stint.get("overtakes", 0) * 0.25) - (stint.get("mistakes", 0) * 0.6))), 1)
    fin = int(stint.get("finishPos") or total_cars)
    gain = grid_pos - fin
    conf = float(stint.get("endConf") or 60)
    ovt = int(stint.get("overtakes") or 0)
    mis = int(stint.get("mistakes") or 0)
    base = 7.4
    if fin == 1:
        base += 1.6
    elif fin <= 3:
        base += 1.1
    elif fin <= 10:
        base += 0.4
    base += max(-1.6, min(1.8, gain * 0.24))
    base += min(0.8, ovt * 0.16)
    base -= min(1.8, mis * 0.55)
    base += ((conf - 60.0) / 40.0) * 0.45
    return round(max(3.5, min(10.0, base)), 1)


def _persona_voice(persona: str, mood: str, ctx: dict[str, Any]) -> str:
    """Craft a persona-authentic answer shaped by mood (elated|confident|mixed|frustrated|shaken)."""
    cir = ctx["circuit"]
    fin = ctx["finish_pos"]
    gain = ctx["gain"]
    ovt = ctx["overtakes"]
    mis = ctx["mistakes"]
    pit_d = ctx["pit_delay"]
    conf = ctx["end_conf"]
    wet = ctx["had_wet"]

    if persona == "iceman":
        if mood == "elated":
            return f"Good car today. Everything worked around {cir}, we stayed out of trouble and took P{fin}. Simple as that."
        if mood == "confident":
            return f"Solid race. Balance was decent, made {ovt} clean pass{'es' if ovt != 1 else ''} and brought it home P{fin}."
        if mood == "frustrated" or mood == "shaken":
            if pit_d > 0.8:
                return f"Lost {pit_d:.1f}s in the pit box. Not much you can do after that, we just move on to the next one."
            return f"Tricky afternoon. Grip wasn't where we needed it and P{fin} is disappointing, but that's racing."
        return f"It was okay. Not the fastest, not the slowest. P{fin} is what we had today."

    if persona == "fiery_racer":
        if mood == "elated":
            return f"WHAT A DRIVE! I felt unstoppable out there at {cir} — every braking zone I could throw it on the apex and the car just stuck! P{fin} feels electric!"
        if mood == "confident":
            return f"We attacked from lights out! {ovt} overtakes and climbing {gain:+d} places — when my confidence is at {conf}, nobody's keeping me behind!"
        if mood == "shaken":
            return f"Honestly I'm furious with myself right now. {'Those mistakes cost us huge time' if mis > 0 else 'We had zero grip'} and once my rhythm broke I couldn't trust the rear end."
        if mood == "frustrated":
            if pit_d > 0.8:
                return f"We fought like lions on track and then gave away {pit_d:.1f} seconds in the pit lane! We HAVE to sharpen up if we want to fight at the front."
            return f"Tough one to swallow. We pushed hard, maybe too hard in dirty air, and P{fin} doesn't reflect our true speed."
        return f"Decent scrap out there — loved the wheel-to-wheel fights, just needed a tenth more pace to break into the top battle."

    if persona == "perfectionist":
        if mood == "elated":
            return f"Execution was nearly 100% from formation lap to flag. Tyre temps stayed right in the window{' even in the wet' if wet else ''} and we maximized every stint for P{fin}."
        if mood == "confident":
            return f"Strong data from today. We gained {gain:+d} spots through disciplined pace management, though there are still two corners where I want another tenth."
        if mood in ("frustrated", "shaken"):
            return f"Too many small compromises today — {'a lock-up broke our stint target' if mis > 0 else 'traffic hurt our tyre deg'}. We'll dissect the telemetry tonight and come back sharper."
        return f"A methodical P{fin}. We hit our pit windows, protected the tyres, and learned where our setup window needs refining."

    if persona == "rookie_hungry":
        if mood == "elated":
            return f"I can't stop smiling! Racing wheel-to-wheel at {cir} and finishing P{fin} — this is everything I dreamed of growing up!"
        if mood == "confident":
            return f"Every lap my confidence grew — finished at {conf} and pulled off {ovt} passes on drivers I used to watch on TV! Huge step forward!"
        if mood in ("frustrated", "shaken"):
            return f"Steep learning curve today. {'I overcooked a braking zone trying too hard' if mis > 0 else 'The dirty air caught me out'}, so my confidence dipped, but I'm taking every lesson with me."
        return f"Learned a ton managing tyres and energy over a full race distance. Grateful to bring the car home in P{fin}."

    if persona == "veteran_statesman":
        if mood == "elated":
            return f"You wait years for days where the car talks to you like that around {cir}. Experience paid off in the key moments — thrilled to take P{fin}."
        if mood == "confident":
            return f"Patience won us that result. We didn't panic early, kept confidence steady at {conf}, and picked them off when their tyres dropped."
        if mood in ("frustrated", "shaken"):
            return f"I've had enough Grands Prix to know days like this happen. We'll keep our heads calm, back the mechanics, and turn it around next round."
        return f"Respectable P{fin}. In this field, banking clean laps and staying out of trouble always matters over a season."

    # Default: team_player
    if mood == "elated":
        return f"Massive credit to everyone at the factory and on the pit wall — the strategy and car balance were mega today for P{fin}!"
    if mood == "confident":
        return f"Really proud of how we worked together on the radio. Great calls, strong rhythm, and a well-earned P{fin} for the team."
    if mood in ("frustrated", "shaken"):
        return f"Tough afternoon for all of us. {'A slow stop put us on the back foot' if pit_d > 0.8 else 'We struggled to switch the tyres on'}, but we win and lose together."
    return f"Solid team effort to bring it home P{fin}. We'll debrief with the engineers and aim higher next weekend."


def _build_driver_interview(
    drv: dict[str, Any],
    stint: dict[str, Any],
    events: list[dict[str, Any]],
    circuit_name: str,
    era_label: str,
    had_wet: bool,
    had_sc: bool,
    total_cars: int,
) -> dict[str, Any]:
    idx = drv.get("idx", -1)
    grid_pos = int(drv.get("gridPos") or (idx + 1))
    dnf = bool(stint.get("dnf"))
    fin = int(stint.get("finishPos") or total_cars)
    gain = 0 if dnf else (grid_pos - fin)
    end_conf = int(stint.get("endConf") if stint.get("endConf") is not None else 60)
    peak_conf = int(stint.get("peakConf") if stint.get("peakConf") is not None else end_conf)
    min_conf = int(stint.get("minConf") if stint.get("minConf") is not None else end_conf)
    end_mom = int(stint.get("endMom") if stint.get("endMom") is not None else 0)
    ovt = int(stint.get("overtakes") or 0)
    mis = int(stint.get("mistakes") or 0)
    pit_delay = float(stint.get("pitDelayS") or 0.0)
    aff = float(drv.get("trackAffinity") or 0.0)
    persona = str(drv.get("persona") or "team_player")
    eng_name = str(drv.get("engineerName") or "Race Engineer")

    # Classify driver's post-race mood from actual race result + confidence + momentum
    if dnf:
        mood = "shaken" if end_conf < 42 else "frustrated"
    elif fin == 1 or (fin <= 3 and end_conf >= 70) or gain >= 5:
        mood = "elated"
    elif end_conf >= 68 or gain >= 2 or (fin <= 6 and end_mom >= 8):
        mood = "confident"
    elif end_conf <= 35 or gain <= -5 or mis >= 2:
        mood = "shaken"
    elif end_conf < 48 or gain <= -3 or pit_delay >= 1.2:
        mood = "frustrated"
    else:
        mood = "mixed"

    # Explicit transparent reasons explaining WHY this driver holds these opinions
    reasons: list[str] = [
        f"End Confidence: {end_conf}/100 ({_conf_label(end_conf)})",
        f"Momentum: {end_mom:+d}",
        f"Persona: {PERSONA_LABELS.get(persona, persona)}",
    ]
    if dnf:
        reasons.append(f"Retired ({stint.get('dnfReason') or 'Mechanical'})")
    else:
        reasons.append(f"Result: P{grid_pos} → P{fin} ({gain:+d})")
    if ovt >= 2:
        reasons.append(f"{ovt} On-Track Overtakes")
    if mis > 0:
        reasons.append(f"{mis} Braking Lock-Up{'s' if mis > 1 else ''}")
    if pit_delay >= 0.8:
        reasons.append(f"Pit Delay: +{pit_delay:.1f}s")
    if abs(aff) >= 0.6:
        reasons.append(f"Track Affinity: {aff:+.1f}")

    ctx = {
        "circuit": circuit_name,
        "finish_pos": fin,
        "gain": gain,
        "overtakes": ovt,
        "mistakes": mis,
        "pit_delay": pit_delay,
        "end_conf": end_conf,
        "had_wet": had_wet,
    }

    qas: list[dict[str, str]] = []

    # Q1: Race Outcome Headline Question (tailored to what actually happened!)
    if dnf:
        q1 = f"A bitter early end to your {circuit_name} Grand Prix with a {stint.get('dnfReason') or 'technical'} retirement — how are you feeling right now?"
        a1 = (
            f"Gutted, honestly. We were working hard to build rhythm before it let go. "
            f"{'At least the pace felt promising early on.' if peak_conf >= 65 else 'It was a tough weekend from the start, so we reset and come back stronger.'}"
        )
    elif fin == 1:
        q1 = f"Grand Prix Winner at {circuit_name}! Starting P{grid_pos} and taking the chequered flag first — how special does that feel?"
        a1 = _persona_voice(persona, "elated", ctx)
    elif gain >= 4:
        q1 = f"Driver of the Day contender! You surged {gain} places from P{grid_pos} to P{fin} — when did you feel the race swinging your way?"
        a1 = _persona_voice(persona, mood, ctx)
    elif gain <= -4:
        q1 = f"You started P{grid_pos} but slipped back to P{fin} by the flag — where did the race get away from you?"
        a1 = _persona_voice(persona, mood, ctx)
    else:
        q1 = f"P{fin} at the chequered flag here at {circuit_name} — does that match what you expected coming into today?"
        a1 = _persona_voice(persona, mood, ctx)
    qas.append({"q": q1, "a": a1, "topic": "Race Outcome"})

    # Q2: Specific Key Moment Question (Mistake, Pit Delay, Overtakes, Weather, or Confidence Swing!)
    drv_events = [e for e in events if e.get("carIdx") == idx]
    if mis > 0:
        q2 = f"We saw {mis} heavy lock-up{'s' if mis > 1 else ''} during the race that dipped your confidence to {min_conf} — how difficult was it rebuilding trust in the brakes?"
        if end_conf >= 60:
            a2 = f"Once I talked it through with {eng_name} on the radio and shifted brake bias, my head cleared fast. Finishing at {end_conf} confidence shows we bounced back properly."
        else:
            a2 = f"It genuinely shook my rhythm. When you're second-guessing the braking marker into every heavy stop, you leave two tenths on the table every lap."
        topic2 = "Composure & Recovery"
    elif pit_delay >= 0.8:
        q2 = f"A {pit_delay:.1f}-second delay in the pit box put you right back into traffic — how frustrated were you on the radio?"
        if persona == "fiery_racer":
            a2 = f"You heard me on the radio! In a pack this tight, {pit_delay:.1f} seconds is an eternity. We'll debrief hard with the crew because we can't gift free positions."
        else:
            a2 = f"Obviously hurts when you're fighting for tenths, but the boys in the garage give 110% every weekend. We'll review it together and nail the next one."
        topic2 = "Pit Wall & Strategy"
    elif ovt >= 3:
        q2 = f"You pulled off {ovt} bold on-track overtakes under {era_label} rules — were you feeling extra confident on the brakes today?"
        a2 = f"100%. Peak confidence hit {peak_conf} out there — when the front end bites like that and momentum is rolling ({end_mom:+d}), you just see the gap and go for it!"
        topic2 = "Racecraft & Confidence"
    elif had_wet:
        q2 = f"Changing weather made {circuit_name} treacherous — how confident were you judging the wet/slick crossover?"
        a2 = f"In the wet it's pure instinct and trust between you and {eng_name}. {'I loved the slippery conditions and gained real momentum!' if end_conf >= 62 else 'Visibility and tyre temps were brutal — just relieved to keep it out of the barriers.'}"
        topic2 = "Wet Weather Mastery"
    else:
        q2 = f"Your confidence peaked at {peak_conf} and ended at {end_conf} — how did your relationship with {eng_name} help manage the stints?"
        a2 = f"{eng_name} kept the calls crisp and calm all afternoon. {'When the car is humming and we are aligned like that, the lap times come naturally.' if end_conf >= 62 else 'We had to compromise pace to protect the tyres, so it was all about damage limitation.'}"
        topic2 = "Engineer & Rhythm"
    qas.append({"q": q2, "a": a2, "topic": topic2})

    # Q3: Looking Ahead / Track Affinity / Regulation Era Opinion
    if aff >= 0.7:
        q3 = f"Historically you've always shone around {circuit_name} — did that familiarity give you an extra edge today?"
        a3 = f"There's something about the kerbs and flow here that just fits my driving style. Every time we arrive at {circuit_name}, I start the weekend already believing we can punch above our weight."
    elif had_sc:
        q3 = f"The Safety Car bunched the whole field right back up — did that help or hurt your strategy?"
        a3 = f"{'It played straight into our hands — cheap pit stop and fresh rubber for the sprint to the flag!' if gain >= 0 else 'Worst possible timing for us, wiped out the gap we spent ten laps building.'}"
    else:
        q3 = f"Heading into the next round under {era_label}, what's the #1 takeaway from today's telemetry?"
        a3 = (
            f"Carry this momentum ({end_mom:+d}) straight into qualifying next weekend — our race pace is genuinely strong."
            if end_mom >= 5
            else f"We need better track position on Saturday so we aren't burning our tyres in dirty air all Sunday."
        )
    qas.append({"q": q3, "a": a3, "topic": "Looking Ahead"})

    return {
        "idx": idx,
        "code3": drv.get("code3") or "DRV",
        "name": drv.get("name") or "Driver",
        "team": drv.get("team") or "Team",
        "color": drv.get("color") or "#e10600",
        "isPlayer": bool(drv.get("isPlayer")),
        "gridPos": grid_pos,
        "finishPos": fin,
        "dnf": dnf,
        "posGain": gain,
        "rating": _rate_driver(stint, grid_pos, total_cars),
        "endConf": end_conf,
        "peakConf": peak_conf,
        "minConf": min_conf,
        "endMom": end_mom,
        "overtakes": ovt,
        "mistakes": mis,
        "pitDelayS": round(pit_delay, 1),
        "persona": persona,
        "personaLabel": PERSONA_LABELS.get(persona, persona),
        "engineerName": eng_name,
        "mood": mood,
        "perspectiveReasons": reasons,
        "headlineQuote": qas[0]["a"],
        "qas": qas,
        "eventCount": len(drv_events),
    }


def generate_race_interviews(
    telemetry_payload: dict[str, Any],
    *,
    max_drivers: int = 8,
) -> list[dict[str, Any]]:
    """
    Generate context-aware post-race driver reports & interviews for key storylines:
    Podium (P1-P3), Player Team drivers, Biggest Climber, Most Dramatic/Shaken driver.
    """
    if not isinstance(telemetry_payload, dict):
        return []
    drivers = telemetry_payload.get("drivers") or []
    stints = telemetry_payload.get("stints") or []
    events = telemetry_payload.get("events") or []
    frames = telemetry_payload.get("frames") or []
    circuit_name = str(telemetry_payload.get("circuitName") or "Grand Prix")
    era_label = str(telemetry_payload.get("eraLabel") or "2026 Rules")

    had_wet = any((f.get("wetness") or 0) >= 25 for f in frames)
    had_sc = any(f.get("sc") for f in frames)

    drv_by_idx = {d.get("idx"): d for d in drivers}
    stint_by_idx = {s.get("idx"): s for s in stints}
    total_cars = max(1, len(stints) or len(drivers))

    # Build reports for all drivers so we can select the richest storylines
    all_reports: list[dict[str, Any]] = []
    for s in stints:
        idx = s.get("idx")
        d = drv_by_idx.get(idx) or {
            "idx": idx,
            "code3": s.get("code3"),
            "name": s.get("name"),
            "team": s.get("team"),
            "color": s.get("color"),
            "gridPos": s.get("finishPos") or 1,
        }
        all_reports.append(_build_driver_interview(d, s, events, circuit_name, era_label, had_wet, had_sc, total_cars))

    if not all_reports:
        return []

    # Select featured interviewees: Player drivers first, then P1-P3, biggest climber, biggest drop/drama
    picked_ids: list[int] = []
    out: list[dict[str, Any]] = []

    def add_rep(r: dict[str, Any] | None) -> None:
        if r and r["idx"] not in picked_ids and len(out) < max_drivers:
            picked_ids.append(r["idx"])
            out.append(r)

    for r in all_reports:
        if r["isPlayer"]:
            add_rep(r)
    for r in sorted(all_reports, key=lambda x: (x["dnf"], x["finishPos"]))[:3]:
        add_rep(r)
    # Biggest climber
    add_rep(max(all_reports, key=lambda x: x["posGain"], default=None))
    # Most dramatic / shaken story (mistakes, slow pit, or DNF)
    add_rep(max(all_reports, key=lambda x: (x["mistakes"] * 3 + x["pitDelayS"] + (3 if x["dnf"] else 0) - x["posGain"] * 0.4), default=None))
    # Fill remaining slots by finish order
    for r in sorted(all_reports, key=lambda x: (x["dnf"], x["finishPos"])):
        add_rep(r)

    return out
