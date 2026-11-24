# FIA Formula 1 Sporting Regulations & Flag Rules — Research & `traf1` Gap Audit

> **Primary Sources:**
> - FIA International Sporting Code (ISC), **Appendix H** (*Recommendations for the Supervision of the Track and Competitions* — Flag Signals) — [fia.com](https://www.fia.com/regulation/category/123)
> - FIA International Sporting Code (ISC), **Appendix L, Chapter IV** (*Code of Driving Conduct on Circuits*) — [fia.com](https://www.fia.com/regulation/category/123)
> - FIA **Formula 1 Sporting Regulations** (Section B, 2025/2026 Regulations) & **Driving Standards / Penalty Guidelines** — [fia.com](https://www.fia.com/regulation/category/110) / [formula1.com](https://www.formula1.com)

---

## 1. Official FIA Flag Signals (ISC Appendix H)

| Flag | Official FIA Trigger & Meaning | Driver Obligation | Standard Stewards Penalty | Current `traf1` Status |
|---|---|---|---|---|
| **Blue Flag** *(Pantone 298C)* | **3.0s** team pre-warning; **< 1.2s** triggers automated trackside blue LED panels + cockpit wheel blue LEDs for a car about to be lapped (ISC App. H & App. L). | Yield at the earliest safe opportunity off the racing line. Ignoring **~3 consecutive marshal posts / light panels** triggers an impeding referral. | **+5s** or **+10s** time penalty (escalating to Drive-Through if persistent). | **Partial** — AI yields when a car `>0.45` laps ahead is `<62m` behind (`f1_track_renderer.js:2257`), **but** there is no 3.0s/1.2s threshold, no blue LED marshal panels in 3D, no blue-flag radio call, and no 3-post ignoring-blue-flags `+5s` penalty. |
| **Single Waved Yellow** | Danger beside or partly on the track (e.g. parked breakdown or spin off-line). | Discernible speed drop, earlier braking, **no overtaking** (except bypassing a stranded car or blue-flagged car). | **+5s** time penalty or 5-place grid drop for failing to slow / overtaking under yellow. | **Implemented** — Yellow sector slows cars & blocks overtaking (`f1_track_renderer.js:2343`), 3D marshal panels flash yellow. Missing: overtaking-under-yellow penalty check & double-yellow distinction. |
| **Double Waved Yellow** | Hazard wholly/partly blocking track or marshals working on track. | **Significantly** reduce speed, be prepared to stop; **no overtaking**. In **Qualifying**, automatically deletes the lap time. | **+10s stop-and-go** in-race / **10-place grid drop** + license penalty points. | **Missing** — Currently only single yellow sector exists; no Double-Yellow heavier speed cap or Q1/Q2/Q3 lap-deletion rule. |
| **Green Flag** | Track clear after yellow sector / start of session / end of SC/VSC. | Full racing resumes immediately past the green panel/line. | — | **Implemented** — Green flag pill & marshal panel reset. |
| **Red Flag** | Session suspended immediately due to major blockage, barrier repair, or extreme weather. | Slow immediately, no overtaking, return to Pit Lane; tyre changes & repairs allowed before Standing or Rolling Restart. | Severe penalty / DQ for failing to slow or overtaking under red. | **Implemented** — Automatic + manual Red Flag with free pit repairs/tyres & 5-Red-Lights Standing Restart. |
| **Black & White Flag** *(Diagonal)* | Unsportsmanlike driving warning or **3rd Track Limits strike** (Art. 33.3). | Final warning before a formal time penalty on the next breach. | Warning only; next breach = **+5s** (then +10s). | **Implemented** — Track limits 3rd strike B&W warning + 4th strike `+5s`, plus moving-under-braking B&W warning. |
| **Black & Orange Disc** *("Meatball")* | Car has dangerous mechanical damage (loose front wing dragging, fluid leak, broken suspension). | Must **box on the next lap** for repairs or retire. | Disqualification (Black Flag) if ignored. | **Missing!** — We already render 3D damaged front wings scraping sparks (`car.wingDamaged`), so triggering an official **Meatball Flag** forcing an immediate mandatory pit stop for a nose change would be ultra-authentic! |
| **Black Flag** | Disqualification from the race (ignoring meatball/penalties, severe misconduct, illegal car). | Return immediately to the pits and retire from the race. | Immediate **DSQ**. | **Missing** — Currently no DSQ state (only DNF). |
| **White Flag** | Much slower vehicle on track ahead (limping car with puncture/ERS failure or recovery vehicle). | Exercise caution; overtaking the slow car is permitted. | — | **Missing** — Easy to flash white marshal panels in 3D/2D when a crippled car limps back to pits! |
| **Yellow & Red Striped** | Slippery surface ahead (oil spill, standing water, carbon debris). | Expect sudden grip drop in that sector. | — | **Missing** — Could trigger automatically whenever `debrisZones` exist or sudden rain hits a sector! |

---

## 2. Wheel-to-Wheel Overtaking & Driving Standards Guidelines (FIA 2025/2026)

1. **Inside Overtake Right to Room:** Attacking car's **front axle must be at least alongside the defender's mirror prior to and at the apex**, driven in full control and staying within track limits. If met, the defender *must* leave a car's width on exit.
2. **Outside Overtake Right to Room:** Attacking car's **front axle must be ahead of the defender's front axle at the apex**, under full control and within track limits. Otherwise the inside car owns the exit.
3. **One Defensive Move / No Weaving / No Moving Under Braking (ISC App. L Ch. IV):** Defenders may make **one** change of direction off the racing line to defend on a straight, and may return toward the racing line only if leaving at least **one full car's width** between their car and the track edge. Sudden reactive jinks in the braking zone are illegal.
4. **Leaving the Track & Gaining a Lasting Advantage (Art. 33.3):** White lines define the track (kerbs do **not**). Cutting a chicane or running all 4 wheels off-track to complete a pass requires **giving the place back voluntarily** within ~1 lap, or stewards issue a **+5s / +10s penalty**.
5. **`traf1` Gap:** We already model side-by-side car-width spacing, moving-under-braking warnings/penalties, and track-limits strikes — adding **Leaving the Track & Gaining an Advantage** (voluntary give-back vs +5s penalty) and **Apex Priority checks** would elevate battle stewardship even further.

---

## 3. Starts, Pit Lane, Penalties & Tyre Rules (FIA Sporting Regulations)

| Rule Area | Official FIA Rule | Current `traf1` Status |
|---|---|---|
| **Jump Start / False Start** | Car moves out of grid box before all 5 red lights extinguish (FIA grid sensors). Penalty: **+5s** or **+10s** (or Drive-Through if blatant). | **Missing** — Standing start has rare anti-stall (`2.5%`), but no rare **Jump Start** (`+5s` penalty)! |
| **Serving Time Penalties in the Pit Box** | A **+5s or +10s** penalty MUST be served at the car's next pit stop **before mechanics touch the car** (visible 5s/10s hold in the pit box, car motionless, crew hands off!). If no more stops occur, added to finish time. | **Missing!** — Currently `car.timePenaltyS` only adds at the finish line instead of holding the car motionless in the 3D/2D pit box for 5s/10s before the crew leaps in! |
| **Pit-Lane Speeding Tiers** | Standard **80 km/h** (60 km/h at tight street tracks like Monaco/Singapore/Zandvoort). `< 6 kph` over = **+5s**; `6–15 kph` over = **Drive-Through**; `> 15 kph` over = **10s Stop-and-Go**. | **Partial** — Flat `+5s` penalty exists; missing 60 kph street-track limit & Drive-Through tier. |
| **Unsafe Pit Release** | Releasing a car into the path of an oncoming fast-lane car or with an unsecured wheel = **+5s / +10s penalty** (or immediate stop on track if wheel loose). | **Missing!** — Easy to detect when two cars exit adjacent pit boxes within `<1.2s`! |
| **Two Dry Tyre Compounds Rule** | Must use **at least 2 distinct dry compounds** in a dry Grand Prix (waived if Wet/Inter tyres are used). Non-compliance = **Disqualification (DSQ)** (or +30s if red-flagged permanently). | **Partial** — AI forces a stop to comply (`mustFulfillRule`), **but** no post-race DSQ check if a car somehow finishes a dry race on only 1 compound! |
| **Safety Car / VSC Procedures** | **VSC:** Maintain positive ECU delta (~35–40% slower), gaps frozen, no overtaking. **SC:** Pack bunches behind P1, lapped cars unlap via Art. 55.13, lights go off on "SC IN THIS LAP", P1 controls restart pace until **Safety Car Line 1 / Control Line** (no overtaking before S/F line!). | **Strong!** — Pack bunching, leader S3 backing-up, Art. 55.13 unlapping, and SC lights-off are all implemented! |
| **2026 Active Aero & Overtake Mode** | Replaces classic DRS in 2026: all cars use Straight-Line **X-Mode** / Corner **Z-Mode**; chasing within **< 1.0s** at the detection point unlocks **Overtake Mode** (`+0.5 MJ` extra electrical harvest & extended 355 kph MGU-K deployment). | **Implemented** — 2026 X-Mode aero unloading + Manual Override Mode banner & radio already built! |
