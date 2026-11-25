# Game Concept Document: Pit Wall — The Ladder

| Field | Specification |
| --- | --- |
| **Working Title** | Pit Wall: The Ladder |
| **Genre** | Motorsport Management Simulation / Persistent Career RPG |
| **Core Fantasy** | Rise from a grassroots karting mechanic-owner to a premier feeder-team boss, then choose your own path into Formula 1—either poached as a Team Principal or bidding to enter your own Constructor. |
| **Target Experience** | High-leverage pit-wall strategy and paddock politics, balancing authentic motorsport systems with snappy, readable gameplay. |

---

## 1. Executive Summary & Design Pillars

**Pit Wall: The Ladder** is a persistent, five-tier motorsport management simulation spanning Karting, Formula 4, Formula 3, Formula 2, and Formula 1. Unlike traditional racing managers that lock the player into a single static tier or force tedious lap-by-lap micromanagement, this experience evolves its core mechanics at every rung of the ladder.

### Core Design Pillars

1. **Macro-Strategy Over Micromanagement:** Players operate as Team Principals managing pit windows, tire thermal cliffs, weather risk, and driver psychology—not toggling pace sliders every three corners.
2. **Evolving Gameplay Loop:** Each tier introduces distinct operational realities. Karting is hands-on tuning with zero radio; F1 is aerospace R&D, cost-cap accounting, and FIA politics.
3. **The Hybrid Career Fork:** Players start as an Owner-Principal aiming to become an F1 Academy feeder team. Once established, the career branches: accept a poaching offer to run an existing F1 team, or stay as Owner and bid for an F1 grid slot.
4. **A Living 5-Tier Ecosystem:** All five championships simulate concurrently. Drivers age, earn Super License points, get promoted, or wash out; AI principals get fired, and staff get poached with realistic gardening leave.

---

## 2. Core Gameplay Loops

### Micro Loop: The Race Weekend

1. **Practice (F4+):** Run setup programs to dial in car balance and validate new upgrades for wind-tunnel-to-track correlation (F1).
2. **Qualifying:** Manage track evolution, slipstream/tow timing, and clean-air release windows.
3. **Race Day:** Execute strategy via pit-wall telemetry—managing undercuts/overcuts, dirty-air overheating, fuel/ERS modes, dynamic weather radar, and driver radio friction.
4. **Post-Race Debrief:** Process prize payouts, crash-damage repair invoices, reputation shifts, and FIA Super License points.

### Meso Loop: Between-Race Operations (Weekly)

1. **Paddock Inbox & Politics:** Respond to sponsor demands, F1 Academy KPI checks, press rumors, and staff poaching alerts.
2. **Garage & Factory:** Repair chassis damage, manufacture spare parts (F4+), or allocate Wind Tunnel/CFD hours (F1).
3. **Personnel & Scouting:** Dispatch scouts to junior grids, run pit-crew drills (F2+), and negotiate driver/engineer contracts.
4. **Pre-Weekend Prep:** Select tire allocations, review circuit aero profiles, and issue pre-race coaching directives (Karting).

### Macro Loop: Multi-Season Career Progression

1. **Grassroots Survival (Karting / F4):** Manage tight cash flow, balance pay drivers against raw talent, and survive crash-damage bills.
2. **Feeder Team Prestige (F3 / F2):** Build a reputation as a talent factory to secure lucrative **F1 Academy Affiliate** contracts.
3. **The Career Fork (F2 → F1):**
* **Path A — The Poach:** Accept a Team Principal offer from an F1 team. Your original feeder team continues running as an AI rival, and you can attempt to poach your former staff or star junior driver.
* **Path B — The Constructor Bid:** Reject F1 job offers, stay as Owner, secure title sponsors, and submit an F1 Entry Bid (or buy out a struggling backmarker) to bring your own team to the top grid.
* **Path C — The Mercenary:** Move freely between F1 teams across seasons based on reputation, salary, and championship ambition.



---

## 3. Tier Progression & Unlock Matrix

Complexity scales strictly with tier progression so new systems unlock only when the player has mastered the previous layer.

| Tier | Machinery | Race-Day Mechanics Unlocked | Facilities Unlocked | Contracts & Politics Unlocked |
| --- | --- | --- | --- | --- |
| **1. Karting** | Open chassis / engine | Chassis flex, gear ratios, tire pressure, slipstream, pre-race coaching (no live radio, no pit stops). | 2-Bay Garage, Race Trailer | Parent-funded seats, local sponsors, masked-potential scouting. |
| **2. Formula 4** | Spec (identical cars) | Front/rear wing setup, Practice sessions, crash-damage economy, wet-weather pit stops. | Regional Workshop, Basic Telemetry Rig | Dedicated Race Engineer, Pay-Driver contracts. |
| **3. Formula 3** | Spec (30-car grids) | DRS, Reverse-Grid Sprint Races, Qualifying traffic management, high Safety Car variance. | Driver-in-the-Loop Sim (Lv 1), Scouting Network | **F1 Academy Affiliate Deals** (funding + junior seat with strict KPIs). |
| **4. Formula 2** | Spec (high power) | Mandatory pit stops, Prime/Option tire rules, Pit Crew speed/errors, Driver Ego & Trust. | Pit Stop Practice Rig, Advanced Sim, Sports Science Lab | **F1 Poaching Offers**, buyout clauses, teammate rivalry management. |
| **5. Formula 1** | Custom Constructor | Custom R&D, CFD/Wind Tunnel correlation, ERS deployment, Cost Cap, Engine mapping, Team Orders. | Full Factory Campus, Wind Tunnel, Composite Factory | **FIA Regulation Voting**, Gardening Leave staff poaching, Works Engine deals. |

---

## 4. Core Systems & Backend Services

To support a persistent, unscripted career across all five tiers, the architecture is divided into six decoupled services:

### 4.1 Race Simulation Engine (Tick-Based)

* **Pace & Physics Model:** Computes sector and lap times from car performance vectors, driver skill, fuel load, and track rubbering-in.
* **Tire & Aero Model:** Models surface vs. core temperature (thermal degradation cliff when over-pushed) and dirty-air downforce loss when following within 1.5 seconds.
* **Incident & Weather Director:** Drives dynamic rain radar (with forecast uncertainty), component wear, and realistic Safety Car / VSC / Red Flag triggers.

### 4.2 Persistent Paddock Ecosystem (World AI)

* **5-Tier Concurrent Sim:** Advances Karting through F1 calendars simultaneously so the talent pool organically refreshes every season.
* **AI Team Principals:** Rival teams evaluate budgets, fire underperforming principals, poach senior engineers, and bid on rising juniors—generating authentic "Silly Season" chains.
* **Governance Engine:** Generates off-season FIA rule proposals (aero resets, engine freezes, sprint formats) and tallies AI team votes based on each team's competitive self-interest.

### 4.3 Driver, Staff & Super License Service

* **Fog-of-War Scouting:** Youth drivers have hidden potential ceilings and traits (*Wet Weather Specialist*, *Fragile Confidence*, *Tire Whisperer*) revealed only through scouting and track time.
* **Super License Ledger:** Tracks rolling 3-year championship finishes across F4, F3, and F2 to enforce the 40-point F1 eligibility threshold.
* **Relationship & Ego Matrix:** Tracks trust between Driver, Race Engineer, and Principal—determining whether a driver obeys team orders or pushes back over the radio.

### 4.4 Economy & Cost Cap Service

* **Dual-Ledger Accounting:** Tracks operational cash flow (prizes, sponsors, pay-driver installments, repair invoices) alongside the F1 **Cost Cap** (excluding exempt items such as driver salaries and top-3 staff).
* **Contract & Poaching Engine:** Manages performance bonuses, academy KPI penalties, buyout clauses, and mandatory **gardening leave** delays when poaching senior F1 staff.

### 4.5 Factory & R&D Correlation Service (F1)

* **Car Philosophy Vectors:** Separates performance into distinct traits (Low-Speed Downforce, High-Speed Efficiency, Drag, Tire Preservation, Cooling) rather than a single overall rating.
* **Correlation Variance:** Compares predicted CFD/Wind Tunnel gains against actual on-track performance. Upgrading factory facilities narrows the error margin and reduces the risk of bolt-on upgrades causing instability or underperformance.

### 4.6 UI, Telemetry & Persistence Service

* **Pit-Wall Interface:** Clean 2D/isometric live track map with pit-window rejoin predictors, gap-to-ahead deltas, and tire degradation curves.
* **Smart Time Controls:** Variable fast-forward (1x–16x) with automatic pause/slowdown triggers for critical events (rain onset, yellow flags, pit window opening, radio pushback).
* **Relational Save State:** Stores multi-season historical telemetry, championship records, and retired legends to support 15+ season careers.

---

## 5. Phased Implementation Roadmap

| Phase | Milestone | Core Deliverable |
| --- | --- | --- |
| **Phase 1: Vertical Slice** | Race Sim & Pit-Wall UI | Functional 2D track map, tire thermal/dirty-air model, pit-rejoin overlay, and single-race strategy loop (F2/F1 ruleset). |
| **Phase 2: Career Core** | Economy & Paddock Loop | Between-race calendar, driver scouting/traits, crash-damage economy, and single-tier season progression. |
| **Phase 3: The Ladder** | Multi-Tier & Feeder Fork | Concurrent 5-tier simulation, Super License tracking, F1 Academy affiliate contracts, and the Poach vs. Constructor Bid fork. |
| **Phase 4: F1 Endgame** | R&D & Paddock Politics | Car philosophy vectors, wind-tunnel correlation risk, Cost Cap accounting, gardening leave, and FIA regulation voting. |