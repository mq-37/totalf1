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

import hashlib
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


_STREET_MARKERS = (
    "monaco", "monte carlo", "baku", "singapore", "jeddah", "vegas", "las vegas", "miami",
    "melbourne", "adelaide", "montreal", "detroit", "long beach", "dallas", "caesars",
    "mexico city", "hungaroring", "marina bay", "robson", "primerose",
)


def _is_street_circuit(circuit_name: str) -> bool:
    low = str(circuit_name or "").lower()
    return any(marker in low for marker in _STREET_MARKERS)


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


def _conf_band(conf: float) -> str:
    """Confidence axis: shapes how ASSERTIVE the answer is, independent of mood."""
    if conf >= 82:
        return "soaring"
    if conf >= 66:
        return "assured"
    if conf >= 46:
        return "measured"
    return "rattled"


def _seg_pick(pools: dict[str, list[str]], key: str, seed: str, used: set[str] | None = None) -> str:
    """Deterministic pool pick; avoids reusing the same segment twice in one answer."""
    items = pools.get(key) or []
    if not items:
        return ""
    h = int(hashlib.md5(f"{seed}|{key}".encode("utf-8")).hexdigest()[:8], 16)
    if used is None:
        return items[h % len(items)]
    fresh = [x for x in items if x not in used] or items
    return fresh[h % len(fresh)]


_PERSONA_SEGMENTS: dict[str, dict[str, list[str]]] = {
    "iceman": {
        "open_elated": [
            "Good day at the office.",
            "That's what the car can do when everything works.",
            "Clean Sunday. I like those.",
        ],
        "open_confident": [
            "Solid race. Nothing dramatic.",
            "We did what we came to do.",
            "Fine afternoon in the car.",
        ],
        "open_mixed": [
            "It was okay. Not much more.",
            "Average Sunday, honestly.",
            "Middle of the road. We take it.",
        ],
        "open_frustrated": [
            "Not what we wanted.",
            "Frustrating one. Simple as that.",
            "That stung, but I won't dwell on it.",
        ],
        "open_shaken": [
            "Difficult to explain that one.",
            "Some days the car just fights you.",
            "Not my finest Sunday.",
        ],
        "body_soaring": [
            "From lap one I could place the car within two centimetres — P{fin} was under control the whole way.",
            "When it's like this you don't think, you just drive. Everything around {cir} came to me.",
            "We were the benchmark today. I never had to ask for more than the car gave.",
        ],
        "body_assured": [
            "{ovt} pass{es} and a quiet {gain:+d} on the grid — the rhythm was there all race.",
            "Balance was decent, tyres stayed alive, and P{fin} is a fair return.",
            "We managed the gaps instead of chasing them. That's how you score well here.",
        ],
        "body_measured": [
            "Some phases worked, some didn't. We scored, which matters more than the feeling.",
            "Pace was average on a track that punishes average. We banked what was available.",
            "We were neither quick nor slow — the result reflects exactly that.",
        ],
        "body_rattled": [
            "I couldn't find a rhythm anywhere and the laps showed it.",
            "The car moved around too much under me and P{fin} says the rest.",
            "When you don't trust the front end, you leave time in every braking zone.",
        ],
        "trait_wet": [
            "In those conditions you just drive to your instincts — that part never changes.",
            "The wet actually simplifies things. Less thinking, more feeling.",
        ],
        "trait_street": [
            "Places like {cir} reward precision, and that suits my style.",
            "You need total commitment between the walls here. I enjoy that.",
        ],
        "trait_overtake": [
            "The moves were there to be made. I made them.",
            "Late on the brakes when it counts — that's where those passes came from.",
        ],
        "trait_tyre": [
            "Tyres were still alive at the end because I never abused them early.",
            "Looking after the rears is half the race. The other half is patience.",
        ],
        "trait_mech": [
            "The car gave me honest feedback all day — you can only ask for that.",
            "When the car talks, I listen. Today it spoke clearly.",
        ],
        "cb_pit": [
            "The {pit:.1f}s stop cost us track position we never recovered.",
            "Losing {pit:.1f} seconds in the box decided our race more than anything on track.",
        ],
        "cb_mistake": [
            "The lock-up{plural} were mine. I'll fix that before the next one.",
            "I pushed one brake marker too far — that's on me, nobody else.",
        ],
        "cb_sc": [
            "The safety car compressed everything and made the first laps after it a lottery.",
            "Safety cars turn a rhythm race into a sprint. We didn't win that lottery.",
        ],
        "cb_affinity": [
            "I've always gone well around {cir} — it fits how I drive.",
            "Some tracks just click. This is one of them for me.",
        ],
        "cb_title": [
            "Championships are won on days like this, not talked about.",
            "It's a good haul of points. The table looks after itself.",
        ],
        "close_elated": [
            "Good result. We go again.",
            "Enjoy it tonight, work tomorrow.",
        ],
        "close_confident": [
            "We keep this direction.",
            "More of the same next weekend, please.",
        ],
        "close_mixed": [
            "We move on.",
            "Next round is a new story.",
        ],
        "close_frustrated": [
            "We reset and come back.",
            "Nothing to say that the timing screens don't already show.",
        ],
        "close_shaken": [
            "I need to look at myself first.",
            "Some quiet laps in the sim, then we go again.",
        ],
    },
    "fiery_racer": {
        "open_elated": [
            "WHAT A RACE! I gave it everything and the lap times just kept coming!",
            "That is EXACTLY the fight I live for — I'm buzzing the whole way to the debrief!",
            "Unreal! Every single braking zone was a battle and we won them!",
        ],
        "open_confident": [
            "I attacked from lights out and it felt great!",
            "Loved every wheel-to-wheel moment out there today!",
            "That's the aggressive Sunday we've been building towards!",
        ],
        "open_mixed": [
            "Some great fights, some frustrations — my emotions are all over the place!",
            "Bits were brilliant, bits were painful. That's racing!",
            "We had the scrap I wanted but not the result I demanded!",
        ],
        "open_frustrated": [
            "I'm furious, honestly — we deserved so much more today!",
            "That one HURTS. We had the pace and nothing to show for it!",
            "So much anger in this car right now — in a good way, we'll use it!",
        ],
        "open_shaken": [
            "I'm not going to hide it — that shook me deep down.",
            "I fought like crazy and the day still beat me. It's crushing.",
            "Right now I'm just disappointed in myself, full stop.",
        ],
        "body_soaring": [
            "I was throwing it into every apex at {cir} and the car just STUCK — P{fin} feels electric!",
            "When my confidence sits at {conf} there is nobody on this grid keeping me behind!",
            "Every overtake today I initiated with my foot STILL in it — that's total belief!",
        ],
        "body_assured": [
            "{ovt} overtakes and {gain:+d} places — I was on the front foot every single lap!",
            "I kept the pressure on all race and the fights came to me — brilliant feeling!",
            "We raced hard, we raced clean, and the result shows the aggression paid!",
        ],
        "body_measured": [
            "I pushed as hard as the car allowed — maybe today it just wasn't enough.",
            "The fights were there but the pace window was narrow, and I couldn't stretch it.",
            "I gave it everything but you can't fight physics — we scored and we move!",
        ],
        "body_rattled": [
            "Once my rhythm broke I couldn't trust the rear end — and I HATE that feeling.",
            "I was second-guessing every entry and that's when mistakes compound. Gutting.",
            "The fight was in me but the grip wasn't under me — worst combination there is.",
        ],
        "trait_wet": [
            "Those wet conditions? That's MY playground — the more it rains the more I smile!",
            "Everyone lifted in the spray and I attacked — that's where my best laps came!",
        ],
        "trait_street": [
            "Circuits with walls at {cir}? I LOVE that — zero room for error gets my blood going!",
            "You have to be a brave idiot through places like that and I'm proud to be one!",
        ],
        "trait_overtake": [
            "Those passes were LATE — I put the car where they didn't want to be!",
            "Every overtake today was a statement, not just a move!",
        ],
        "trait_tyre": [
            "I managed the rubber harder than anyone and still had tyres left to attack!",
            "Patience isn't my natural language but today the tyres rewarded it!",
        ],
        "trait_mech": [
            "The car talked to me the whole race and I answered every lap — beautiful partnership!",
            "You feel the machine breathing under you when it's this good — I love it!",
        ],
        "cb_pit": [
            "{pit:.1f} SECONDS in the box! We fought like lions on track and gave it away in the lane!",
            "I did my job on track — the pit stop handed our race to the rivals! We MUST sharpen up!",
        ],
        "cb_mistake": [
            "Yes, the lock-up{plural} were mine and they cost us massive time — I take that on the chin!",
            "I overcooked one entry chasing the margin and it bit me! I'd rather fail attacking!",
        ],
        "cb_sc": [
            "The safety car bunched everyone up and turned it into a knife fight — I loved and hated it!",
            "Every restart was a war after that safety car and we came out of one with scars!",
        ],
        "cb_affinity": [
            "{cir} is MY track — you can see it in every braking zone I won today!",
            "I've dreamed about racing here since I was a kid and today I attacked it like that kid would!",
        ],
        "cb_title": [
            "Podium points! This championship fight is ON and I'm coming for all of them!",
            "Bank that — we're in this fight and I'm not here to finish second!",
        ],
        "close_elated": [
            "Let's gooooooooo!",
            "I want the next race TOMORROW!",
        ],
        "close_confident": [
            "Same aggression next weekend — let's go!",
            "The momentum is ours and I'm not giving it back!",
        ],
        "close_mixed": [
            "We take the lessons and come back ANGRIER!",
            "Half good, half bad — next time it's all good!",
        ],
        "close_frustrated": [
            "Channel this into the next one — heads up, foot down!",
            "I promise you, we respond on track!",
        ],
        "close_shaken": [
            "I'll rebuild from this — I always do.",
            "Tomorrow I'm back in the gym and the sim. This fuels me.",
        ],
    },
    "perfectionist": {
        "open_elated": [
            "Execution was close to 100% from formation lap to flag.",
            "Textbook Sunday — every target we set this morning was met.",
            "We planned it precisely and delivered it precisely.",
        ],
        "open_confident": [
            "Strong, controlled race. A few tenths still on the table.",
            "Good delivery against the plan, with known margins left.",
            "Solid. The data says we're trending the right way.",
        ],
        "open_mixed": [
            "A methodical P{fin} — right on our pre-race model, honestly.",
            "Partial execution. The outputs matched the inputs, unfortunately.",
            "We hit our process targets; the outright pace wasn't there.",
        ],
        "open_frustrated": [
            "Too many small compromises compounded into a bad result.",
            "The plan broke in phase two and we never rebuilt the margin.",
            "Unacceptable execution by our own standards, frankly.",
        ],
        "open_shaken": [
            "Nothing about today matched the preparation. That's the hardest part.",
            "The model failed and I don't yet know why. That bothers me most.",
            "A race like this costs you two nights of telemetry review, minimum.",
        ],
        "body_soaring": [
            "Tyre temps stayed in the window every stint and we extracted the maximum at every corner of {cir}.",
            "Every sector target was met or exceeded — that's what full confidence at {conf} delivers.",
            "Zero errors across the distance. When that happens, P{fin} is a formality.",
        ],
        "body_assured": [
            "We gained {gain:+d} places through disciplined pace management, though two corners still cost us tenths.",
            "The stint plan worked to within a tenth of projection — the remaining gap is setup, not execution.",
            "Clean wheel-to-wheel work, {ovt} passes, and no wasted tyre energy. Reasonably satisfied.",
        ],
        "body_measured": [
            "We protected what we had rather than gambling — the numbers justified that call.",
            "Deg was slightly off projection, so we converted the plan into a P{fin} instead of a gamble.",
            "The pace was honest, not special. We optimised an average car to its full value.",
        ],
        "body_rattled": [
            "When the window closes like it did today, every correction costs lap time — the telemetry shows it plainly.",
            "I couldn't repeat my references lap after lap, and consistency is the entire job.",
            "Too many inputs fighting me. We'll strip it back to fundamentals tonight.",
        ],
        "trait_wet": [
            "The crossover calls were the decisive variable, and our window judgments were excellent.",
            "Wet running is a data problem — crossover, pressures, line evolution — and we solved most of it.",
        ],
        "trait_street": [
            "{cir} punishes imprecision by tenths of a metre, and our reference points held up well.",
            "Street layouts suit a disciplined approach — you build the lap in segments and repeat it.",
        ],
        "trait_overtake": [
            "Both passes were prepared two laps in advance — battery deployed exactly where the model said.",
            "Overtaking is engineering plus patience: right mode, right lift, right apex. We got them right.",
        ],
        "trait_tyre": [
            "Tyre preservation was the difference — I never asked for more than the carcass could give.",
            "Deg management decided the strategy window and we extended it further than projected.",
        ],
        "trait_mech": [
            "The platform communicated beautifully — when the car is this honest, setup work converges fast.",
            "Mechanically we were squeaky clean, which is exactly why we could attack the plan.",
        ],
        "cb_pit": [
            "A {pit:.1f}s stop is a 0.5s wheel-gun issue plus a 0.4s release issue. Both are fixable and both will be.",
            "The stop cost more than any on-track phase — that's a process failure, not luck.",
        ],
        "cb_mistake": [
            "The lock-up{plural} broke our stint target — one marker change fixes both.",
            "I hold myself to a zero-error standard, so {mis} today is below the line. It gets addressed.",
        ],
        "cb_sc": [
            "The safety car invalidated our tyre model mid-race — the restart calls were reactive, not optimal.",
            "Safety cars compress strategy variance. We recalculated live but lost the projection margin.",
        ],
        "cb_affinity": [
            "My historical data around {cir} predicted a strong weekend and the correlation held.",
            "Track affinity is real and measurable — this place has always suited my reference style.",
        ],
        "cb_title": [
            "Championship math favours consistency — today was exactly that.",
            "We bank maximum points from the car we have. The standings reflect discipline over a season.",
        ],
        "close_elated": [
            "We'll enjoy it for exactly one hour, then it's onto the next target.",
            "Perfect execution is rare. We log what made it work.",
        ],
        "close_confident": [
            "Two refinements and this becomes a win. That's the focus.",
            "The trend line is correct. We keep sharpening.",
        ],
        "close_mixed": [
            "The review will be thorough, as always.",
            "Process good, pace insufficient. We know which lever to pull.",
        ],
        "close_frustrated": [
            "Every issue today has a root cause. We'll find all of them.",
            "I've already flagged three items for the debrief.",
        ],
        "close_shaken": [
            "Tonight is telemetry. Tomorrow is solutions.",
            "I don't do panic. I do analysis, then correction.",
        ],
    },
    "rookie_hungry": {
        "open_elated": [
            "I can't stop smiling! This is everything I dreamed about!",
            "Pinch me — that was UNREAL from where I'm standing!",
            "Racing at {cir} and finishing P{fin} — my childhood self is screaming right now!",
        ],
        "open_confident": [
            "That felt like a big step forward for me!",
            "I'm learning fast and today proved it!",
            "Every lap I understood the car a little more!",
        ],
        "open_mixed": [
            "Tons learned today, mixed feelings about the result.",
            "Some moments I'll remember, some I'd rather forget!",
            "A rollercoaster — but a useful one!",
        ],
        "open_frustrated": [
            "That's frustrating because I KNOW there was more in me today.",
            "Steep learning curve is real — today the hill was steep!",
            "I wanted so much more from this weekend.",
        ],
        "open_shaken": [
            "Honestly? That was intimidating from start to finish.",
            "This one hurt my confidence badly, not going to lie.",
            "I overdrove, I know it, and the result shows it.",
        ],
        "body_soaring": [
            "My confidence finished at {conf} and I pulled off {ovt} passes on drivers I grew up watching on TV!",
            "Every braking zone I arrived with total belief — that's a feeling I want to bottle!",
            "The car, the team, the track — everything clicked and I finally felt like I BELONG out there!",
        ],
        "body_assured": [
            "I gained {gain:+d} places and each one taught me something new about wheel-to-wheel racing!",
            "My engineer {eng} was incredible — every call built my trust through the race!",
            "I kept my mistakes to a minimum and delivered when it mattered. That's the job!",
        ],
        "body_measured": [
            "There were moments I was a bit too respectful of the fast guys — next time I'll push harder!",
            "I managed the race like the team asked, even where my instinct said push!",
            "Tyre management at this level is a science and I'm still doing the reading!",
        ],
        "body_rattled": [
            "When the confidence dropped below 40 everything felt like it was happening TO me, not BY me.",
            "I overcooked one braking zone trying too hard and it knocked me for the rest of the stint.",
            "The pace of this category is brutal — I lost time just adjusting to the entries.",
        ],
        "trait_wet": [
            "Racing in the wet here was terrifying and THRILLING in equal measure!",
            "My wet driving is coming from pure instinct right now — and today the instinct worked!",
        ],
        "trait_street": [
            "Street tracks like {cir} are the ultimate exam and I loved every question it asked!",
            "Zero margin between the walls — I've never focused so hard for two hours straight!",
        ],
        "trait_overtake": [
            "Those overtakes were the best moments of my season so far!",
            "I braved two moves I'd only ever tried in the sim — and they STUCK!",
        ],
        "trait_tyre": [
            "Looking after tyres was my biggest pre-race worry and it went better than expected!",
            "The veterans made it look easy — my tyre numbers are getting closer to theirs every round!",
        ],
        "trait_mech": [
            "When the car communicates this well, even a rookie can attack confidently!",
            "The team gave me a car I could trust — that's why I could learn race-long!",
        ],
        "cb_pit": [
            "The {pit:.1f}s stop dropped me into traffic I wasn't expecting — huge learning about race flow!",
            "My first real pit-lane lesson: {pit:.1f} seconds changes your whole race plan!",
        ],
        "cb_mistake": [
            "The lock-up{plural} were rookie errors, plain and simple — I'm owning them!",
            "I asked too much from the front tyres mid-race. Notebook open, lesson logged!",
        ],
        "cb_sc": [
            "My first safety car restarts at this level — the pace delta confused me twice!",
            "Safety car laps are a masterclass in patience and I'm not there yet!",
        ],
        "cb_affinity": [
            "I've raced {cir} on the ladder and that history genuinely helped today!",
            "This track has been good to me my whole career so far — long may it continue!",
        ],
        "cb_title": [
            "A result like this at my stage — I don't take a single point for granted!",
            "Big points for the team and for my learning curve. Both matter!",
        ],
        "close_elated": [
            "Thank you to the whole team — this one's for the mechanics!",
            "I'm going to remember this one for the rest of my life!",
        ],
        "close_confident": [
            "The curve is pointing up. That's all I can ask!",
            "More of this please! I'm hooked!",
        ],
        "close_mixed": [
            "Chalk it up as experience and move forward!",
            "Learn fast, forget slow — that's my motto now!",
        ],
        "close_frustrated": [
            "I'll be first in the simulator this week, promise!",
            "The hunger is bigger than the disappointment!",
        ],
        "close_shaken": [
            "Days like this build character. I need to believe that right now.",
            "The team believes in me — I have to repay that immediately.",
        ],
    },
    "veteran_statesman": {
        "open_elated": [
            "You wait years for a day where the car talks to you like that.",
            "There's a craft to these days and today we practised it well.",
            "A satisfying afternoon's work at {cir}, by any standard.",
        ],
        "open_confident": [
            "A tidy race, built on patience rather than heroics.",
            "We let the race come to us. It usually does.",
            "Measured, mature, effective — I'll take that.",
        ],
        "open_mixed": [
            "A race of two halves and we won one of them.",
            "Nothing spectacular, nothing embarrassing.",
            "The points are real even if the poetry wasn't.",
        ],
        "open_frustrated": [
            "Frustration is for young drivers. Mine is more... disappointment.",
            "We left something out there through caution, not pace.",
            "I've seen this movie before and I didn't like the ending then either.",
        ],
        "open_shaken": [
            "In a long career you collect days like this. You do.",
            "That was one of the harder afternoons to process, honestly.",
            "Experience tells me to breathe. The result still stings.",
        ],
        "body_soaring": [
            "Experience paid in the key moments — tyre phases, traffic, the decisive calls all went our way.",
            "When the field is this deep, a P{fin} built on judgment means more than one built on luck.",
            "I managed every phase like I've done a thousand times, and today the thousand-and-first worked too.",
        ],
        "body_assured": [
            "We didn't panic early, kept our confidence steady at {conf}, and picked them off when their tyres dropped.",
            "The trick at this level is knowing WHICH fights to take. Today I took the right ones.",
            "{ovt} passes without a single drama — that's what the years in the seat are for.",
        ],
        "body_measured": [
            "In this field, banking clean laps and staying out of trouble always matters over a season.",
            "We raced the car we had, not the car we wished for. That's the professional's line.",
            "Points today, lessons today. Both carry value to the next round.",
        ],
        "body_rattled": [
            "There are days the instinct dulls and today was one. I won't pretend otherwise.",
            "I've been doing this long enough to know when it's the car and when it's me. Today, a bit of both.",
            "The pace of the young guys is real. My job is to answer it with craft, and today I fell short.",
        ],
        "trait_wet": [
            "I've driven wet races at places like this for two decades — the crossover judgment becomes second nature.",
            "Rain separates the calculated from the hopeful. Today I stayed calculated.",
        ],
        "trait_street": [
            "Street circuits reward memory, and {cir} and I have a long history together.",
            "Between these walls, experience is worth more than raw pace. That's always suited me.",
        ],
        "trait_overtake": [
            "Every pass had a story: study, wait, strike. The old ways still work.",
            "You don't out-brake the young ones anymore — you out-think them. Today I did.",
        ],
        "trait_tyre": [
            "Tyre care is a veteran's art and I've had good teachers across a long career.",
            "The rear tyres were alive at the end precisely because they were respected at the start.",
        ],
        "trait_mech": [
            "A car that talks to you honestly is worth more than two tenths of pace. Today it spoke.",
            "Mechanical sympathy isn't sentiment — it's how you keep a race car alive to the flag.",
        ],
        "cb_pit": [
            "A {pit:.1f}s stop at this level is painful, but squads have bad days. You back the crew.",
            "The stop hurt us, sure. But I've seen decades of pit crews — they'll respond.",
        ],
        "cb_mistake": [
            "The lock-up{plural}? Even after all these races, the margins humble you sometimes.",
            "One mistake from me changed our race. Accountability starts with the bloke in the mirror.",
        ],
        "cb_sc": [
            "Safety cars turn strategy into chess with dice. We navigated it as well as anyone could.",
            "I've seen hundreds of restarts. The field is so even now that each one is a coin toss.",
        ],
        "cb_affinity": [
            "{cir} and I go back a long way — it's kind to drivers who respect it.",
            "There are tracks you learn and tracks you instinctively know. This has always been the latter.",
        ],
        "cb_title": [
            "Championships are built in races exactly like this one. We did our part.",
            "I've been in title fights before — the trick is treating every round like this one mattered.",
        ],
        "close_elated": [
            "Days like this are why you keep going.",
            "Savour it briefly. Then back to work.",
        ],
        "close_confident": [
            "Steady as she goes.",
            "One race at a time. That's how titles happen.",
        ],
        "close_mixed": [
            "Keep calm and keep scoring.",
            "The season is long. Perspective is everything.",
        ],
        "close_frustrated": [
            "We regroup. That's what experience is for.",
            "On to the next one, wiser.",
        ],
        "close_shaken": [
            "You breathe, you review, you return. That's the job.",
            "I've recovered from worse. Ask me again next round.",
        ],
    },
    "team_player": {
        "open_elated": [
            "Massive credit to everyone at the factory and on the pit wall today!",
            "This one's for the whole team — what a collective effort!",
            "We promised each other a result and we delivered it together!",
        ],
        "open_confident": [
            "Really proud of how we worked as a unit out there.",
            "Great calls all round — this was a team win in every sense.",
            "The plan came together and everyone played their part.",
        ],
        "open_mixed": [
            "Mixed day, but the togetherness never wavered.",
            "We got most of it right and the rest we'll fix together.",
            "Some good, some lessons — all shared.",
        ],
        "open_frustrated": [
            "Tough afternoon for all of us, no pointing fingers.",
            "We win and lose together — today stung for everyone.",
            "Not the Sunday we wanted, but nobody hid from it.",
        ],
        "open_shaken": [
            "Hard to put into words right now, honestly.",
            "That was painful for the whole garage, not just me.",
            "We'll carry this one together too.",
        ],
        "body_soaring": [
            "The strategy, the stops, the car — everything clicked and P{fin} belongs to every single person here.",
            "When {eng} and the wall make calls like that, my job is easy — I just drive!",
            "We gained {gain:+d} places as a team. The car was mega and the calls were even better!",
        ],
        "body_assured": [
            "{ovt} passes and a clean race — the engineers gave me a platform and I tried to honour it!",
            "We executed the plan beautifully and the crew deserved every point of P{fin}!",
            "Confidence sat at {conf} because the car felt safe underneath me all race!",
        ],
        "body_measured": [
            "We optimised what we had — the team extracted every tenth available today.",
            "Pace was honest rather than special, so we raced smart and banked the points.",
            "The others had a bit more today, but our process stayed clean.",
        ],
        "body_rattled": [
            "I couldn't quite find my rhythm and the team couldn't magically give me one — we'll solve it together.",
            "We struggled to switch the tyres on and it cost us everywhere. The analysis will tell us why.",
            "When the car isn't communicating, it's a long afternoon for driver and engineers alike.",
        ],
        "trait_wet": [
            "The wet calls from the wall were excellent — I just tried to execute them!",
            "Crossover decisions are team decisions, and ours were mostly spot on!",
        ],
        "trait_street": [
            "{cir} is unforgiving and the team prepped a car I could trust between the walls!",
            "Street races are about collective confidence — ours held up today!",
        ],
        "trait_overtake": [
            "Both passes came from great information — I knew exactly where they'd be weak!",
            "When the pit wall tells you a pass is on, you commit fully. We did!",
        ],
        "trait_tyre": [
            "Tyre life was a whole-team effort — my driving, their modelling, all aligned!",
            "We saved the rears together and it paid off at the end!",
        ],
        "trait_mech": [
            "The reliability team deserves a shout — the car felt bulletproof all race!",
            "A car this honest comes from hundreds of hours at the factory. Thank you!",
        ],
        "cb_pit": [
            "The {pit:.1f}s stop hurt, but those guys are in the gym for us every week — we review and improve.",
            "Slow stops happen to great teams. What matters is we own it and fix it together.",
        ],
        "cb_mistake": [
            "The lock-up{plural} were my contribution to a tough day — I'll put it right.",
            "I cost the team time today with my error. That accountability drives me.",
        ],
        "cb_sc": [
            "The safety car gave the strategists a headache and they handled it about as well as possible!",
            "Restart chaos is a team sport — we came out of it reasonably!",
        ],
        "cb_affinity": [
            "{cir} has been kind to our team historically and today kept that story alive!",
            "This place suits our car concept — you could feel it from the engineers' faces!",
        ],
        "cb_title": [
            "Big points for the championship and the team's bonus structure — everyone's a winner!",
            "This is how you build a season: together, race by race!",
        ],
        "close_elated": [
            "For the team! Onwards!",
            "Enjoy it, everyone. You earned it!",
        ],
        "close_confident": [
            "We keep building, together.",
            "Same energy next weekend!",
        ],
        "close_mixed": [
            "We debrief, we learn, we go again.",
            "Together through the ups and downs!",
        ],
        "close_frustrated": [
            "We'll come back stronger as a unit.",
            "Heads up, team. Next round soon.",
        ],
        "close_shaken": [
            "We'll hold each other up after this one.",
            "The team spirit gets tested on days like today. I back us fully.",
        ],
    },
}

_PERSONA_CLOSE_SKIP_P = {"iceman": 0.40}  # Iceman often ends the sentence... early.
_PERSONA_MAX_EXTRAS = {"iceman": 1, "perfectionist": 2, "fiery_racer": 2}


def _persona_voice(persona: str, mood: str, ctx: dict[str, Any], seed: str = "", flavour: list[str] | None = None) -> str:
    """Compose a persona-authentic answer: mood opening + confidence body + trait/context extras + closer.

    Confidence is its own axis (`end_conf` in ctx): soaring (>=82) answers make bold claims,
    assured (66-81) state targets, measured (46-65) talk process, rattled (<46) hedge and doubt.
    `flavour` (driver DNA tags from driver_dna.flavour_tags) weaves trait lines in only when the
    race context matches the trait. Everything is seeded so the same race yields the same quote.
    """
    pools = _PERSONA_SEGMENTS.get(persona) or _PERSONA_SEGMENTS["team_player"]
    conf = float(ctx.get("end_conf", 60) or 0)
    band = _conf_band(conf)
    used: set[str] = set()

    parts: list[str] = [_seg_pick(pools, f"open_{mood}", seed, used)]

    body = _seg_pick(pools, f"body_{band}", seed, used)
    if body:
        used.add(body)
        parts.append(body)

    # Trait extras: only when race context genuinely matches the driver's DNA strength.
    fl = set(flavour or [])
    extras_max = _PERSONA_MAX_EXTRAS.get(persona, 2)
    h = int(hashlib.md5(f"{seed}|gate".encode("utf-8")).hexdigest()[:8], 16)
    trait_flags: list[tuple[bool, str]] = [
        (bool(ctx.get("had_wet")) and "wet" in fl, "trait_wet"),
        (bool(ctx.get("is_street")) and "street" in fl, "trait_street"),
        (int(ctx.get("overtakes", 0) or 0) >= 2 and "overtake" in fl, "trait_overtake"),
        (int(ctx.get("finish_pos", 99) or 99) <= 10 and "tyre" in fl, "trait_tyre"),
        (bool(ctx.get("dnf")) and "mech" in fl, "trait_mech"),
    ]
    extras = 0
    for ok, key in trait_flags:
        if not ok or extras >= extras_max:
            continue
        if h % 5 == 3 and extras > 0:  # dampen: not every eligible trait every time
            h >>= 3
            continue
        line = _seg_pick(pools, key, seed, used)
        if line:
            used.add(line)
            parts.append(line)
            extras += 1
        h >>= 2

    # Context callbacks: only when the race event actually happened.
    cb_flags: list[tuple[bool, str]] = [
        (float(ctx.get("pit_delay", 0.0) or 0.0) >= 0.8, "cb_pit"),
        (int(ctx.get("mistakes", 0) or 0) >= 1, "cb_mistake"),
        (bool(ctx.get("had_sc")), "cb_sc"),
        (abs(float(ctx.get("aff", 0.0) or 0.0)) >= 0.6, "cb_affinity"),
        (int(ctx.get("finish_pos", 99) or 99) <= 3 and conf >= 70, "cb_title"),
    ]
    for ok, key in cb_flags:
        if not ok or extras >= extras_max:
            continue
        line = _seg_pick(pools, key, seed, used)
        if line:
            used.add(line)
            parts.append(line)
            extras += 1
        h >>= 2

    # Closer: persona may skip it (Iceman terseness), elated/shaken moods weight towards having one.
    if h % 100 >= (100 * _PERSONA_CLOSE_SKIP_P.get(persona, 0.0)):
        close = _seg_pick(pools, f"close_{mood}", seed, used)
        if close:
            parts.append(close)

    fmt = _voice_format_map(ctx)
    out = " ".join(p for p in parts if p)
    try:
        return out.format(**fmt)
    except Exception:
        return out


def _voice_format_map(ctx: dict[str, Any]) -> dict[str, Any]:
    mis = int(ctx.get("mistakes", 0) or 0)
    return {
        "cir": ctx.get("circuit", "the circuit"),
        "fin": ctx.get("finish_pos", "?"),
        "grid": ctx.get("grid_pos", "?"),
        "gain": int(ctx.get("gain", 0) or 0),
        "ovt": int(ctx.get("overtakes", 0) or 0),
        "es": "es" if int(ctx.get("overtakes", 0) or 0) != 1 else "",
        "mis": mis,
        "plural": "s" if mis != 1 else "",
        "pit": float(ctx.get("pit_delay", 0.0) or 0.0),
        "conf": int(float(ctx.get("end_conf", 60) or 0)),
        "peak": int(float(ctx.get("peak_conf", ctx.get("end_conf", 60)) or 0)),
        "mom": int(ctx.get("end_mom", 0) or 0),
        "eng": ctx.get("eng_name", "Race Engineer"),
        "era": ctx.get("era_label", ""),
        "wet": "y" if ctx.get("had_wet") else "",
    }


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
        "grid_pos": grid_pos,
        "gain": gain,
        "overtakes": ovt,
        "mistakes": mis,
        "pit_delay": pit_delay,
        "end_conf": end_conf,
        "peak_conf": peak_conf,
        "end_mom": end_mom,
        "had_wet": had_wet,
        "had_sc": had_sc,
        "dnf": dnf,
        "dnf_reason": str(stint.get("dnfReason") or "Mechanical"),
        "aff": aff,
        "eng_name": eng_name,
        "era_label": era_label,
        "is_street": _is_street_circuit(circuit_name),
    }

    qas: list[dict[str, str]] = []
    drv_name = str(drv.get("name") or "")
    # Depth inputs: deterministic per-race seed + driver-DNA flavour tags (wet/street/overtake/...)
    voice_seed = f"{drv_name}|{circuit_name}|{fin}|{end_conf}|{era_label}"
    try:
        from .driver_dna import flavour_tags as _flavour_tags
        flavour = _flavour_tags(drv_name)
    except Exception:
        flavour = []
    try:
        from .paddock_dialogue import get_driver_voice_line
    except Exception:
        get_driver_voice_line = None

    # Q1: Race Outcome Headline Question (tailored to what actually happened + real driver voice signature!)
    if dnf:
        q1 = f"A bitter early end to your {circuit_name} Grand Prix with a {stint.get('dnfReason') or 'technical'} retirement — how are you feeling right now?"
        sig = get_driver_voice_line(drv_name, "frustrated", seed=f"{circuit_name}|{fin}") if get_driver_voice_line else None
        a1 = sig or (
            f"Gutted, honestly. We were working hard to build rhythm before it let go. "
            f"{'At least the pace felt promising early on.' if peak_conf >= 65 else 'It was a tough weekend from the start, so we reset and come back stronger.'}"
        )
    elif fin == 1:
        q1 = f"Grand Prix Winner at {circuit_name}! Starting P{grid_pos} and taking the chequered flag first — how special does that feel?"
        sig = get_driver_voice_line(drv_name, "win", seed=f"{circuit_name}|{fin}") if get_driver_voice_line else None
        a1 = f"{sig} ({_persona_voice(persona, 'elated', ctx, voice_seed, flavour)})" if sig and len(sig) < 95 else (sig or _persona_voice(persona, "elated", ctx, voice_seed, flavour))
    elif gain >= 4:
        q1 = f"Driver of the Day contender! You surged {gain} places from P{grid_pos} to P{fin} — when did you feel the race swinging your way?"
        sig = get_driver_voice_line(drv_name, "overtake", seed=f"{circuit_name}|{gain}") if get_driver_voice_line else None
        a1 = sig or _persona_voice(persona, mood, ctx, voice_seed, flavour)
    elif gain <= -4:
        q1 = f"You started P{grid_pos} but slipped back to P{fin} by the flag — where did the race get away from you?"
        sig = get_driver_voice_line(drv_name, "frustrated", seed=f"{circuit_name}|{gain}") if get_driver_voice_line else None
        a1 = sig or _persona_voice(persona, mood, ctx, voice_seed, flavour)
    else:
        q1 = f"P{fin} at the chequered flag here at {circuit_name} — does that match what you expected coming into today?"
        sit = "win" if fin <= 3 else ("frustrated" if mood in ("frustrated", "shaken") else "overtake")
        sig = get_driver_voice_line(drv_name, sit, seed=f"{circuit_name}|{fin}") if (get_driver_voice_line and (fin <= 3 or mood in ("frustrated", "shaken"))) else None
        a1 = sig or _persona_voice(persona, mood, ctx, voice_seed, flavour)
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

    # Q3: Real Component Wear / Mechanical Symptom Reported on Radio (if any!)
    comp_issues = stint.get("compIssues") or []
    comps = stint.get("components") or {}
    eng_data = stint.get("engineering") or {}
    fb_data = eng_data.get("feedback") or {}
    fb_score = int(fb_data.get("score") or 72)
    fb_tier = str(fb_data.get("tier") or "CLEAR")
    setup_acc = int(eng_data.get("setupAccuracy") or 80)
    bal_bias = int(eng_data.get("balanceBias") or 0)
    kph_loss = int(stint.get("compKphLoss") or 0)
    comp_loss_s = float(stint.get("compPaceLossS") or 0.0)
    drv_radios = [r for r in (stint.get("driverRadio") or []) if r.get("text")]

    if comp_issues:
        worst = sorted(comp_issues, key=lambda x: (0 if x.get("severity") == "critical" else 1, x.get("health", 100)))[0]
        w_comp = str(worst.get("comp") or "ice")
        w_lbl = str(worst.get("label") or "Power Unit")
        w_lap = int(worst.get("lap") or 1)
        w_hlth = int(worst.get("health") or 55)
        w_kph = int(worst.get("kphLoss") or kph_loss)
        reasons.append(f"{w_lbl}: {w_hlth}% (L{w_lap} radio alert)")
        if w_comp in ("ice", "ers"):
            q_mech = (
                f"On Lap {w_lap} we heard you on team radio reporting straight-line power loss "
                f"({f'~{w_kph} kph down at the speed trap' if w_kph > 0 else 'early clipping'}) — how badly did that {w_lbl} wear compromise your race?"
            )
            a_mech = (
                f"Massively. Once {eng_name} confirmed the {w_lbl} dropped to {w_hlth}% and was costing {comp_loss_s:.2f}s a lap, "
                f"we had to lift-and-coast and defend offline on every straight. Just relieved it survived to the chequered flag."
                if not dnf else
                f"You could feel it going from Lap {w_lap} — losing {max(6, w_kph)} kph on the straight meant we were a sitting duck before it finally gave up."
            )
        elif w_comp == "brakes":
            q_mech = f"You radioed {eng_name} on Lap {w_lap} about a long brake pedal in dirty air — were you nursing glazed carbon discs all stint?"
            a_mech = f"Yeah, brake health fell to {w_hlth}% and temps spiked every time I sat in a tow. I had to move brake bias rearward and give up 15 metres into the heavy stops."
        elif w_comp == "floor":
            q_mech = f"Telemetry flagged floor-edge degradation ({w_hlth}%) after Lap {w_lap} — could you feel the aero balance shift through the fast corners?"
            a_mech = f"Instantly. The rear downforce just vanished in the high-speed sweepers — costing around {max(0.2, comp_loss_s):.2f}s per lap and chewing the rear tyres."
        else:
            q_mech = f"You flagged a {w_lbl} issue on Lap {w_lap} ({w_hlth}% health) — how tricky was it nursing the car home?"
            a_mech = f"{eng_name} gave me clear mitigation maps straight away. You lose confidence over the kerbs when the {w_lbl} is compromised, so bringing it home P{fin} was all about discipline."
        qas.append({"q": q_mech, "a": a_mech, "topic": f"Car Wear · {w_lbl}"})

    # Q4: Engineer Setup Convergence & Driver Feedback Quality (Experience × Confidence × Momentum × Quality)
    bal_desc = "heavy understeer" if bal_bias < -18 else ("snappy oversteer" if bal_bias > 18 else "neutral sweet-spot balance")
    reasons.append(f"Engineer Feedback: {fb_score}/100 ({fb_tier}) · Setup {setup_acc}%")
    q_eng = (
        f"Your race engineer {eng_name} logged a {fb_score}/100 ({fb_tier}) feedback precision rating with {setup_acc}% setup convergence — "
        f"how did the car's {bal_desc} feel over the stint?"
    )
    if setup_acc >= 85 and fb_score >= 76:
        a_eng = (
            f"When you and {eng_name} speak the exact same language on aero balance, diff locking, and brake migration, everything clicks. "
            f"We nailed {setup_acc}% of our target window around {circuit_name} and I could lean on the front end every lap."
        )
    elif bal_bias < -18:
        a_eng = (
            f"We chased front-end washout ({bal_bias} balance index) all afternoon. I gave {eng_name} detailed corner-entry notes so we know we need more front wing and softer front heave next time."
        )
    elif bal_bias > 18:
        a_eng = (
            f"The rear was lively (+{bal_bias} oversteer bias), especially on traction exits. {'At least our clear feedback helped adjust diff settings on the fly.' if fb_score >= 70 else 'With my confidence dipping it was hard to isolate whether it was diff lock or tyre temps.'}"
        )
    else:
        a_eng = (
            f"Pretty solid baseline ({setup_acc}% target hit). {eng_name} kept the telemetry calls super clean, though we can still tighten our ride-height and camber window for qualifying."
        )
    qas.append({"q": q_eng, "a": a_eng, "topic": "Setup & Engineering"})

    # Q5: Looking Ahead / Track Affinity / Regulation Era Opinion
    if aff >= 0.7:
        q3 = f"Historically you've always shone around {circuit_name} — did that familiarity give you an extra edge today?"
        a3 = f"There's something about the kerbs and flow here that just fits my driving style. Every time we arrive at {circuit_name}, I start the weekend already believing we can punch above our weight."
    elif had_sc:
        q3 = f"The Safety Car bunched the whole field right back up — did that help or hurt your strategy?"
        a3 = f"{'It played straight into our hands — cheap pit stop and fresh rubber for the sprint to the flag!' if gain >= 0 else 'Worst possible timing for us, wiped out the gap we spent ten laps building.'}"
    else:
        q3 = f"Heading into the next round under {era_label}, what's the #1 takeaway from today's telemetry?"
        a3 = _persona_voice(persona, mood, ctx, voice_seed + "|ahead", flavour) if end_mom < 5 else (
            f"Carry this momentum ({end_mom:+d}) straight into qualifying next weekend — our race pace is genuinely strong."
        )
    qas.append({"q": q3, "a": a3, "topic": "Looking Ahead"})

    # Parting quote: a short composed sign-off, distinct seed so it never duplicates the lead answer.
    parting = _persona_voice(persona, mood, ctx, voice_seed + "|parting", flavour)
    if parting:
        parting = parting[:240]

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
        "mood": mood,
        "confBand": _conf_band(end_conf),
        "partingQuote": parting,
        "engineerName": eng_name,
        "feedbackScore": fb_score,
        "setupAccuracy": setup_acc,
        "compIssues": comp_issues,
        "driverRadio": drv_radios[:8],
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
    Generate context-aware post-race driver reports & interviews ONLY after the race finishes:
    Podium (P1-P3), Player Team drivers, Biggest Climber, Most Dramatic/Mechanical-Failure story.
    """
    if not isinstance(telemetry_payload, dict):
        return []
    # Strictly lock Post-Race Interviews during an active race (mid-race uses live Radio Logs only!)
    if telemetry_payload.get("raceFinished") is False:
        return []
    drivers = telemetry_payload.get("drivers") or []
    stints = telemetry_payload.get("stints") or []
    events = telemetry_payload.get("events") or []
    frames = telemetry_payload.get("frames") or []
    radio_log = telemetry_payload.get("radioLog") or []
    circuit_name = str(telemetry_payload.get("circuitName") or "Grand Prix")
    era_label = str(telemetry_payload.get("eraLabel") or "2026 Rules")

    had_wet = any((f.get("wetness") or 0) >= 25 for f in frames)
    had_sc = any(f.get("sc") for f in frames)

    drv_by_idx = {d.get("idx"): d for d in drivers}
    radio_by_idx: dict[Any, list[dict[str, Any]]] = {}
    for rm in radio_log:
        radio_by_idx.setdefault(rm.get("carIdx"), []).append(rm)
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
        s_enriched = dict(s)
        s_enriched["driverRadio"] = radio_by_idx.get(idx, [])
        all_reports.append(_build_driver_interview(d, s_enriched, events, circuit_name, era_label, had_wet, had_sc, total_cars))

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
