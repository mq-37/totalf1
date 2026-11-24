"""
Career Mode Expansion Systems:
  1. Team Analytics War Room (WDC/WCC trajectory, Teammate H2H, Cost Cap/R&D ROI, F1DB Strategy Curves)
  2. FIA Stewards' Room & 12-Point Super Licence (rolling penalty points, 1-race ban + reserve call-up, Right of Review)
  3. Works vs. Customer Power Unit Supplier Contracts
  4. Inter-Season F1 Commission Regulation Votes
"""
from __future__ import annotations

import random
from pathlib import Path
from typing import Any

PU_SUPPLIERS: list[dict[str, Any]] = [
    {
        "id": "mercedes_hpp",
        "name": "Mercedes-AMG HPP",
        "origin": "Brixworth, UK",
        "tier": "Elite Customer",
        "annual_fee_m": 15.0,
        "power_bonus": 2.4,
        "reliability_bonus": 1.8,
        "cooling_bonus": 1.0,
        "desc": "Bulletproof 2026 MGU-K efficiency & crisp drivability; premium customer fee.",
    },
    {
        "id": "ferrari_pu",
        "name": "Ferrari Maranello 067",
        "origin": "Maranello, Italy",
        "tier": "Factory Power",
        "annual_fee_m": 14.2,
        "power_bonus": 2.8,
        "reliability_bonus": 0.9,
        "cooling_bonus": 0.8,
        "desc": "Explosive straight-line acceleration & rapid ERS harvest; runs slightly hotter.",
    },
    {
        "id": "rb_ford",
        "name": "Red Bull Ford Powertrains",
        "origin": "Milton Keynes, UK",
        "tier": "Aggressive Hybrid",
        "annual_fee_m": 13.5,
        "power_bonus": 2.5,
        "reliability_bonus": 1.1,
        "cooling_bonus": 1.4,
        "desc": "Tight sidepod packaging & sharp overtaking deployment boost.",
    },
    {
        "id": "audi_works",
        "name": "Audi Neuburg V6-Hybrid",
        "origin": "Neuburg, Germany",
        "tier": "Works Partnership",
        "annual_fee_m": 10.5,
        "power_bonus": 1.5,
        "reliability_bonus": 1.6,
        "cooling_bonus": 1.6,
        "desc": "Discounted works-style integration with extra Cost Cap headroom for aero R&D.",
    },
    {
        "id": "cadillac_gm",
        "name": "Cadillac GM Racing V6",
        "origin": "Charlotte, USA",
        "tier": "Value Customer",
        "annual_fee_m": 8.8,
        "power_bonus": 1.0,
        "reliability_bonus": 1.4,
        "cooling_bonus": 1.2,
        "desc": "Lowest annual lease fee, freeing $6M+ for Wind Tunnel upgrades & driver salaries.",
    },
]

F1_COMMISSION_PROPOSALS: list[dict[str, Any]] = [
    {
        "id": "refuel_return",
        "title": "Reinstate Mid-Race Refuelling (Art. B4.2)",
        "category": "Sporting",
        "summary": "Lighter cars, ferocious qualifying-pace stints, and tactical fuel-load gambles.",
        "impact": "Refuelling ON next season · +15% strategy variance",
        "rule_key": "refuelling",
        "rule_val": True,
    },
    {
        "id": "cost_cap_squeeze",
        "title": "Tighten FIA Cost Cap to $120M (Financial Regs)",
        "category": "Financial",
        "summary": "Compresses the field and punishes big-spending giants; rewards efficient ATR usage.",
        "impact": "Cost Cap $135M → $120M next season",
        "rule_key": "cost_cap_m",
        "rule_val": 120.0,
    },
    {
        "id": "double_points_finale",
        "title": "Double Points Season Finale (Art. 6.5)",
        "category": "Sporting",
        "summary": "Abu Dhabi finale awards 50 pts for P1 — guaranteed title-decider drama!",
        "impact": "Final round awards 2× WDC & WCC points",
        "rule_key": "double_finale",
        "rule_val": True,
    },
    {
        "id": "aero_reset_2027",
        "title": "Major Ground-Effect Floor Revision (Technical Regs)",
        "category": "Technical",
        "summary": "Forces a 20% aero reset across the grid — teams with Next-Gen Research vault ahead!",
        "impact": "Next-Gen R&D carry-over bonus ×1.6 next season",
        "rule_key": "aero_reset",
        "rule_val": True,
    },
]

STEWARD_INCIDENT_TEMPLATES: list[dict[str, Any]] = [
    {
        "code": "collision",
        "offence": "Breach of Appendix L, Chapter IV, Article 2 d) of the FIA International Sporting Code.",
        "fact_tpl": "Car #{car} ({driver}) made contact with a rival entering Turn 14 during the {gp}.",
        "decision": "10 second time penalty (2 Super Licence penalty points).",
        "penalty_points": 2,
        "fine_eur": 0,
        "grid_drop": 0,
        "reason": "Applying the FIA Driving Standards Guidelines, the Stewards reviewed onboard video and telemetry and determined the car's front axle was not alongside the rival's mirror at the apex.",
        "rules": ["Appendix L", "Chapter IV", "Article 2 d)"],
    },
    {
        "code": "unsafe_release",
        "offence": "Breach of Article 34.14 a) of the FIA Formula One Sporting Regulations (Unsafe Pit Release).",
        "fact_tpl": "Car #{car} ({driver}) was released from the pit box into the fast lane in front of an oncoming car during the {gp}.",
        "decision": "Competitor fined €5,000 + 1 Super Licence penalty point.",
        "penalty_points": 1,
        "fine_eur": 5000,
        "grid_drop": 0,
        "reason": "Pit-lane telemetry confirmed the oncoming car had to brake sharply to avoid contact. Standard financial penalty applied to the competitor.",
        "rules": ["Article 34.14 a)", "FIA Sporting Regs"],
    },
    {
        "code": "track_limits",
        "offence": "Breach of Appendix L, Chapter IV, Article 2 c) and Sporting Regs Article 33.3 (Multiple Track Limits).",
        "fact_tpl": "Car #{car} ({driver}) left the track without justifiable reason 4 times during the {gp}.",
        "decision": "5 second time penalty + 1 Super Licence penalty point.",
        "penalty_points": 1,
        "fine_eur": 0,
        "grid_drop": 0,
        "reason": "After receiving the Black & White flag on strike 3, Car #{car} exceeded track limits again at the exit kerb. Mandatory +5s penalty imposed.",
        "rules": ["Article 33.3", "Appendix L Ch IV Art 2 c)"],
    },
    {
        "code": "impeding",
        "offence": "Breach of Article 37.5 of the FIA Formula One Sporting Regulations (Unnecessary Impeding).",
        "fact_tpl": "Car #{car} ({driver}) unnecessarily impeded a rival on a flying lap during {gp} Qualifying.",
        "decision": "Drop of 3 grid positions for the next Race + 1 Super Licence penalty point.",
        "penalty_points": 1,
        "fine_eur": 0,
        "grid_drop": 3,
        "reason": "Team radio showed insufficient warning from the pit wall while the driver remained on the racing line through a high-speed apex.",
        "rules": ["Article 37.5", "FIA Sporting Regs"],
    },
    {
        "code": "pit_speeding",
        "offence": "Breach of Article 34.7 of the FIA Formula One Sporting Regulations (Pit Lane Speeding).",
        "fact_tpl": "Car #{car} ({driver}) was clocked at 83.4 km/h in the 80 km/h pit lane during the {gp}.",
        "decision": "Competitor fined €1,000.",
        "penalty_points": 0,
        "fine_eur": 1000,
        "grid_drop": 0,
        "reason": "FIA pit-lane speed loop recorded a 3.4 km/h excess at pit entry. Standard €100 per km/h (rounded) competitor fine issued.",
        "rules": ["Article 34.7", "FIA Sporting Regs"],
    },
]


def ensure_career_extras(state: dict[str, Any]) -> None:
    """Lazily initialize Phase 2/3/5 Career fields with 100% backwards-compatibility."""
    if not isinstance(state.get("analytics_rounds"), list):
        state["analytics_rounds"] = []
    if not isinstance(state.get("stewards_history"), list):
        state["stewards_history"] = []
    state.setdefault("pending_stewards", None)
    state.setdefault("parc_ferme_locked", False)
    state.setdefault("banter_mode", "authentic")

    # 12-Point Super Licence fields on every driver
    for d in (state.get("drivers") or {}).values():
        d.setdefault("penalty_points", 0)
        if not isinstance(d.get("penalty_log"), list):
            d["penalty_log"] = []
        d.setdefault("race_ban_rounds", 0)

    # Power Unit Supplier Contract
    if not isinstance(state.get("pu_contract"), dict):
        state["pu_contract"] = {
            "supplier_id": "mercedes_hpp",
            "name": "Mercedes-AMG HPP",
            "seasons_left": 2,
            "annual_fee_m": 15.0,
            "power_bonus": 2.4,
            "reliability_bonus": 1.8,
            "cooling_bonus": 1.0,
        }

    # F1 Commission active ballot
    if not isinstance(state.get("f1_commission"), dict):
        state["f1_commission"] = {
            "season": int(state.get("season_num") or 1),
            "voted_ids": {},
            "active_rules": {},
            "proposals": [dict(p) for p in F1_COMMISSION_PROPOSALS[:3]],
        }

    # Regulation Architect Formula, TP Profiles & Paddock Politics (Plan v2)
    if not isinstance(state.get("regulation_formula"), dict):
        from .regulation_architect import DEFAULT_2026_FORMULA
        import copy as _copy
        state["regulation_formula"] = _copy.deepcopy(DEFAULT_2026_FORMULA)
    if not isinstance(state.get("tp_profiles"), list) or not state["tp_profiles"]:
        from .paddock_profiles import initial_tp_roster
        state["tp_profiles"] = initial_tp_roster()
    state.setdefault("political_capital", 100)
    if not isinstance(state.get("lobbied_tps"), list):
        state["lobbied_tps"] = []
    if not isinstance(state.get("commission_bill_history"), list):
        state["commission_bill_history"] = []
    if not isinstance(state.get("paddock_transition_log"), list):
        state["paddock_transition_log"] = []


def lobby_team_principal(state: dict[str, Any], tp_id: str, add_inbox_fn) -> tuple[bool, str]:
    """Spend 25 Political Capital to lobby a rival Team Principal ahead of an F1 Commission vote."""
    ensure_career_extras(state)
    tp = next((t for t in state["tp_profiles"] if t.get("id") == tp_id), None)
    if not tp:
        return False, "Team Principal not found."
    if tp_id in state["lobbied_tps"]:
        return False, f"Already lobbied {tp['name']} ({tp['team']}) for the upcoming F1 Commission vote."
    cap = int(state.get("political_capital") or 0)
    if cap < 25:
        return False, f"Not enough Political Capital ({cap}/25 required). Score clean race finishes to replenish clout."
    state["political_capital"] = cap - 25
    state["lobbied_tps"].append(tp_id)
    add_inbox_fn(
        state,
        "politics",
        f"Paddock Lobbying: {tp['name']} ({tp['team']})",
        f"Private hospitality briefing held with {tp['name']}. They are now significantly more receptive to your next Regulation Bill.",
    )
    return True, f"Lobbied {tp['name']} ({tp['team']}) — +34% vote support locked for your next bill!"


def submit_regulation_bill(state: dict[str, Any], formula_raw: dict[str, Any], get_player_team_fn, add_inbox_fn) -> tuple[bool, str, dict[str, Any]]:
    """Submit a custom Car Dimensions / Car Tools / Cost Cap bill to the F1 Commission."""
    from .regulation_architect import evaluate_formula_physics, save_custom_formula
    from .paddock_profiles import evaluate_commission_bill

    ensure_career_extras(state)
    pt = get_player_team_fn(state)
    ev = evaluate_formula_physics(formula_raw)
    vote_res = evaluate_commission_bill(
        state["tp_profiles"],
        ev,
        lobbied_tp_ids=state.get("lobbied_tps") or [],
        player_team_name=pt.get("name", "Player Team"),
    )
    # Reset lobbied list after vote and replenish small political capital
    state["lobbied_tps"] = []
    state["political_capital"] = min(100, int(state.get("political_capital") or 0) + (20 if vote_res["passed"] else 10))

    record = {
        "season": int(state.get("season_num") or 1),
        "round": int(state.get("current_round") or 1),
        "formula_name": ev["formula"]["name"],
        "passed": vote_res["passed"],
        "yes_count": vote_res["yes_count"],
        "no_count": vote_res["no_count"],
        "needed": vote_res["needed"],
        "active_tool_badges": ev["active_tool_badges"],
        "summary": vote_res["summary"],
        "votes": vote_res["votes"],
    }
    state["commission_bill_history"].insert(0, record)
    state["commission_bill_history"] = state["commission_bill_history"][:12]

    if vote_res["passed"]:
        saved = save_custom_formula(ev["formula"])
        state["regulation_formula"] = saved["formula"]
        state["cost_cap_limit_m"] = float(saved["formula"]["governance"]["cost_cap_m"])
        add_inbox_fn(
            state,
            "commission",
            f"F1 Commission PASSED: {saved['formula']['name']}",
            f"{vote_res['summary']} Active Car Tools: {', '.join(saved['active_tool_badges']) or 'Pure Mechanical'}. Saved to Sim & Career Formula Library!",
        )
    else:
        add_inbox_fn(
            state,
            "commission",
            f"F1 Commission Rejected: {ev['formula']['name']}",
            vote_res["summary"],
        )

    return True, vote_res["summary"], {"vote": vote_res, "evaluation": ev}


def record_analytics_snapshot(
    state: dict[str, Any],
    cal_item: dict[str, Any],
    player_finishes: list[dict[str, Any]],
    quali_grid: list[dict[str, Any]] | None,
    wcc_sorted: list[dict[str, Any]],
    pt: dict[str, Any],
    telem: dict[str, Any],
) -> None:
    """Append a rich per-round telemetry snapshot for the Career Analytics War Room."""
    ensure_career_extras(state)
    grid_by_did = {g.get("driver_id"): int(g.get("pos") or 10) for g in (quali_grid or [])}
    drv_snaps = []
    for pf in player_finishes:
        did = pf.get("driver_id")
        d = (state.get("drivers") or {}).get(did, {})
        drv_snaps.append({
            "driver_id": did,
            "code3": pf.get("code3") or d.get("code3") or "DRV",
            "name": pf.get("name") or d.get("clean_name") or "Driver",
            "grid_pos": grid_by_did.get(did, int(pf.get("pos") or 10)),
            "finish_pos": int(pf.get("pos") or 20),
            "dnf": bool(pf.get("dnf")),
            "pts": int(pf.get("pts") or 0),
            "morale": int(d.get("morale") or 75),
            "penalty_points": int(d.get("penalty_points") or 0),
        })

    top_teams = [
        {"id": t["id"], "name": t["name"], "color": t["color"], "points": t["points"], "car_overall": t["car_overall"], "is_player": t["is_player"]}
        for t in wcc_sorted[:6]
    ]
    if not any(t["is_player"] for t in top_teams):
        top_teams.append({"id": pt["id"], "name": pt["name"], "color": pt["color"], "points": pt["points"], "car_overall": pt["car_overall"], "is_player": True})

    state["analytics_rounds"].append({
        "season": int(state.get("season_num") or 1),
        "round": int(cal_item.get("round") or state.get("current_round") or 1),
        "circuit_id": cal_item.get("circuit_id") or "",
        "gp": cal_item.get("gp") or cal_item.get("name") or "GP",
        "wcc_pts": int(pt.get("points") or 0),
        "car_overall": float(pt.get("car_overall") or 75.0),
        "rd": dict(pt.get("rd") or {}),
        "cash_m": round(float(state.get("cash_m") or 0.0), 2),
        "cost_cap_spent_m": round(float(state.get("cost_cap_spent_m") or 0.0), 2),
        "board_confidence": int(state.get("board_confidence") or 75),
        "is_wet": bool(telem.get("is_wet")),
        "sc_count": int(telem.get("sc_count") or 0),
        "drivers": drv_snaps,
        "top_teams": top_teams,
    })
    state["analytics_rounds"] = state["analytics_rounds"][-48:]

    # Step realistic AI Team Principal job stress & executive transitions
    try:
        from .paddock_profiles import step_paddock_stress
        cal_all = state.get("calendar") or []
        is_finale = int(cal_item.get("round") or 0) >= len(cal_all) and len(cal_all) > 0
        res_stress = step_paddock_stress(
            state["tp_profiles"],
            [t["name"] for t in wcc_sorted],
            season_end=is_finale,
        )
        for ev in res_stress.get("events") or []:
            state["paddock_transition_log"].insert(0, ev)
        state["paddock_transition_log"] = state["paddock_transition_log"][:15]
        state["political_capital"] = min(100, int(state.get("political_capital") or 50) + 12)
    except Exception:
        pass


def maybe_spawn_stewards_hearing(
    state: dict[str, Any],
    cal_item: dict[str, Any],
    player_finishes: list[dict[str, Any]],
    pt: dict[str, Any],
    add_inbox_fn: Any,
) -> dict[str, Any] | None:
    """
    Decay expired penalty points, enforce 12-point automatic race bans, and
    occasionally spawn an interactive post-race FIA Stewards' Summons & Right of Review!
    """
    ensure_career_extras(state)
    rnd = int(cal_item.get("round") or state.get("current_round") or 1)
    season = int(state.get("season_num") or 1)
    abs_rnd = (season - 1) * 24 + rnd

    # Expire old penalty points (>12 rounds old) across the entire grid
    for d in (state.get("drivers") or {}).values():
        log = [e for e in (d.get("penalty_log") or []) if (abs_rnd - int(e.get("abs_round") or 0)) < 12]
        d["penalty_log"] = log
        d["penalty_points"] = sum(int(e.get("pts") or 0) for e in log)
        if int(d.get("race_ban_rounds") or 0) > 0:
            d["race_ban_rounds"] = max(0, int(d["race_ban_rounds"]) - 1)

    # Slight random rival penalty points so the 12-pt grid tracker feels alive!
    rng = random.Random(f"stewards|{season}|{rnd}|{pt['id']}")
    ai_drivers = [d for d in (state.get("drivers") or {}).values() if d.get("team_id") and d.get("team_id") != pt["id"] and d.get("role") == "race"]
    if ai_drivers and rng.random() < 0.65:
        culprit = rng.choice(ai_drivers)
        pts_add = rng.choice([1, 2])
        culprit["penalty_log"].append({"abs_round": abs_rnd, "pts": pts_add, "gp": cal_item.get("gp", "GP"), "reason": "Causing a collision / Track limits"})
        culprit["penalty_points"] = sum(int(e["pts"]) for e in culprit["penalty_log"])

    # Spawn a player Stewards' Hearing if a player driver DNF'd or ~40% of normal races
    any_dnf = any(f.get("dnf") for f in player_finishes)
    if state.get("pending_stewards") is None and (any_dnf or rng.random() < 0.42):
        target_f = next((f for f in player_finishes if f.get("dnf")), None) or (player_finishes[0] if player_finishes else None)
        if target_f:
            did = target_f.get("driver_id")
            drv = (state.get("drivers") or {}).get(did, {})
            tpl = rng.choice(STEWARD_INCIDENT_TEMPLATES[:3] if any_dnf else STEWARD_INCIDENT_TEMPLATES)
            car_num = 1 + (pt["driver_ids"].index(did) if did in pt["driver_ids"] else 0)
            doc_num = 32 + ((rnd * 7 + car_num * 3) % 45)
            gp = cal_item.get("gp") or cal_item.get("name") or "Grand Prix"
            hearing = {
                "id": f"doc-{season}-{rnd}-{doc_num}",
                "doc_number": doc_num,
                "season": season,
                "round": rnd,
                "abs_round": abs_rnd,
                "gp": gp,
                "code": tpl["code"],
                "driver_id": did,
                "driver_name": drv.get("clean_name") or target_f.get("name") or "Driver",
                "car_number": car_num,
                "team_name": pt["name"],
                "fact": tpl["fact_tpl"].format(car=car_num, driver=drv.get("clean_name") or "Driver", gp=gp),
                "offence": tpl["offence"],
                "decision": tpl["decision"],
                "reason": tpl["reason"].replace("#{car}", f"#{car_num}"),
                "rules_referenced": list(tpl["rules"]),
                "penalty_points": int(tpl["penalty_points"]),
                "fine_eur": int(tpl["fine_eur"]),
                "grid_drop": int(tpl["grid_drop"]),
                "status": "pending",
            }
            state["pending_stewards"] = hearing
            add_inbox_fn(
                state,
                "FIA STEWARDS",
                f"⚖️ FIA Doc #{doc_num} Summons: {hearing['driver_name']} ({gp})",
                f"{hearing['offence']} Proposed ruling: {hearing['decision']} Open FIA Stewards' Room to Accept or file a Right of Review.",
            )
            return hearing
    return None


def respond_stewards_hearing(
    state: dict[str, Any],
    action: str,
    log_finance_fn: Any,
    add_inbox_fn: Any,
) -> tuple[bool, str]:
    """Resolve `pending_stewards`: 'accept', 'appeal' (Right of Review), or 'protest_rival'."""
    ensure_career_extras(state)
    h = state.get("pending_stewards")
    if not h:
        return False, "No active FIA Stewards' summons awaiting response."

    did = h.get("driver_id")
    drv = (state.get("drivers") or {}).get(did)
    sd_rating = float(((state.get("staff") or {}).get("sporting_dir") or {}).get("rating") or 75)
    act = (action or "accept").strip().lower()

    applied_pts = int(h.get("penalty_points") or 0)
    applied_fine_m = round(int(h.get("fine_eur") or 0) / 1_000_000.0, 3)
    outcome_note = ""

    if act == "appeal":
        fee_m = 0.2
        if float(state.get("cash_m") or 0) < fee_m:
            return False, "Need $0.2M to lodge an FIA Right of Review protest fee."
        log_finance_fn(state, f"FIA Right of Review Fee (Doc #{h['doc_number']})", -fee_m, cap_eligible=False)
        # Success chance scales from 35% to 72% with Sporting Director rating
        chance = max(0.30, min(0.75, 0.25 + (sd_rating - 60.0) * 0.014))
        roll = random.random()
        if roll < chance:
            applied_pts = max(0, applied_pts - 1) if applied_pts >= 2 else 0
            applied_fine_m = 0.0
            h["status"] = "overturned"
            outcome_note = f"RIGHT OF REVIEW UPHELD! New telemetry convinced the Stewards — penalty reduced/rescinded (Sporting Dir {int(sd_rating)})."
            state["board_confidence"] = min(100, int(state.get("board_confidence") or 75) + 3)
        else:
            h["status"] = "upheld"
            outcome_note = "Stewards rejected the Right of Review ('no significant new element') — original ruling stands."
    elif act == "protest_rival":
        fee_m = 0.3
        if float(state.get("cash_m") or 0) < fee_m:
            return False, "Need $0.3M to lodge a technical scrutineering counter-protest."
        log_finance_fn(state, f"FIA Technical Protest Fee (Doc #{h['doc_number']})", -fee_m, cap_eligible=False)
        h["status"] = "counter_protest"
        state["board_confidence"] = min(100, int(state.get("board_confidence") or 75) + 2)
        outcome_note = "Technical protest filed! Rival plank wear & parc fermé under scrutiny — paddock tension spikes (+2% Board)."
    else:
        h["status"] = "accepted"
        outcome_note = f"Accepted FIA Doc #{h['doc_number']} ruling ({h['decision']})."

    if applied_fine_m > 0:
        log_finance_fn(state, f"FIA Fine (Doc #{h['doc_number']})", -applied_fine_m, cap_eligible=False)

    ban_msg = ""
    if drv and applied_pts > 0:
        drv.setdefault("penalty_log", []).append({
            "abs_round": int(h.get("abs_round") or 1),
            "pts": applied_pts,
            "gp": h.get("gp", "GP"),
            "reason": h.get("code", "infringement"),
        })
        drv["penalty_points"] = sum(int(e["pts"]) for e in drv["penalty_log"])
        if drv["penalty_points"] >= 12:
            drv["race_ban_rounds"] = 1
            drv["penalty_log"] = []
            drv["penalty_points"] = 0
            ban_msg = f" 🚨 {drv['clean_name']} hit 12 SUPER LICENCE PENALTY POINTS — AUTOMATIC 1-RACE BAN! Reserve driver called up!"
            add_inbox_fn(state, "RACE BAN", f"🚨 12-Point Super Licence Ban: {drv['clean_name']}", ban_msg.strip())

    h["outcome_note"] = outcome_note + ban_msg
    state["stewards_history"].insert(0, h)
    state["stewards_history"] = state["stewards_history"][:25]
    state["pending_stewards"] = None
    return True, outcome_note + ban_msg


def sign_pu_contract(
    state: dict[str, Any],
    supplier_id: str,
    get_player_team_fn: Any,
    log_finance_fn: Any,
    add_inbox_fn: Any,
) -> tuple[bool, str]:
    """Sign a 2-season Power Unit supplier contract with power/reliability/Cost Cap trade-offs."""
    ensure_career_extras(state)
    sup = next((s for s in PU_SUPPLIERS if s["id"] == supplier_id), None)
    if not sup:
        return False, "Unknown Power Unit supplier."
    cur = state.get("pu_contract") or {}
    if cur.get("supplier_id") == supplier_id:
        return False, f"Already contracted with {sup['name']}."
    switch_fee = 2.5
    if float(state.get("cash_m") or 0) < switch_fee:
        return False, f"Need ${switch_fee}M chassis-integration fee to switch PU supplier."

    pt = get_player_team_fn(state)
    old_pwr = float(cur.get("power_bonus") or 0.0)
    delta_pwr = round(float(sup["power_bonus"]) - old_pwr, 2)
    pt["rd"]["power"] = round(max(40.0, min(99.0, float(pt["rd"].get("power") or 75.0) + delta_pwr)), 1)

    state["pu_contract"] = {
        "supplier_id": sup["id"],
        "name": sup["name"],
        "seasons_left": 2,
        "annual_fee_m": sup["annual_fee_m"],
        "power_bonus": sup["power_bonus"],
        "reliability_bonus": sup["reliability_bonus"],
        "cooling_bonus": sup["cooling_bonus"],
    }
    log_finance_fn(state, f"PU Switch Integration: {sup['name']}", -switch_fee, cap_eligible=True)
    add_inbox_fn(
        state,
        "POWERTRAIN",
        f"⚡ Signed 2-Season Deal with {sup['name']}",
        f"Annual fee ${sup['annual_fee_m']}M · Power {delta_pwr:+.1f} · Reliability +{sup['reliability_bonus']} · Cooling +{sup['cooling_bonus']}.",
    )
    return True, f"Signed with {sup['name']} (Power {delta_pwr:+.1f}, ${sup['annual_fee_m']}M/yr)!"


def cast_commission_vote(
    state: dict[str, Any],
    proposal_id: str,
    support: bool,
    add_inbox_fn: Any,
) -> tuple[bool, str]:
    """Vote on an F1 Commission regulation proposal for next season."""
    ensure_career_extras(state)
    comm = state["f1_commission"]
    prop = next((p for p in (comm.get("proposals") or []) if p["id"] == proposal_id), None)
    if not prop:
        return False, "Unknown F1 Commission proposal."
    voted = comm.setdefault("voted_ids", {})
    if proposal_id in voted:
        return False, "You already cast your Team Principal vote on this proposal."

    # Paddock votes alongside you (weighted slightly toward your vote!)
    rng = random.Random(f"comm|{state.get('season_num', 1)}|{proposal_id}")
    yes_votes = (1 if support else 0) + sum(1 for _ in range(9) if rng.random() < (0.56 if support else 0.44))
    passed = yes_votes >= 6
    voted[proposal_id] = {"support": bool(support), "yes_votes": yes_votes, "passed": passed}
    if passed:
        comm.setdefault("active_rules", {})[prop["rule_key"]] = prop["rule_val"]

    verdict = f"PASSED ({yes_votes}/10 teams)" if passed else f"REJECTED ({yes_votes}/10 teams)"
    add_inbox_fn(
        state,
        "F1 COMMISSION",
        f"🏛️ FIA Vote {verdict}: {prop['title']}",
        f"You voted {'IN FAVOUR' if support else 'AGAINST'}. {prop['impact'] if passed else 'Current regulations remain unchanged.'}",
    )
    return True, f"F1 Commission Vote {verdict}: {prop['title']}"


def compute_career_analytics(state: dict[str, Any], f1db_path: Path | None = None) -> dict[str, Any]:
    """Build full Career Telemetry & Analytics War Room payload + F1DB Next-GP Strategy Curves."""
    ensure_career_extras(state)
    teams = state.get("teams") or []
    pt = next((t for t in teams if t.get("is_player")), teams[0] if teams else {})
    drivers = state.get("drivers") or {}
    pt_dids = list(pt.get("driver_ids") or [])

    rounds = list(state.get("analytics_rounds") or [])
    # Backfill seamlessly from completed calendar rounds & wcc_history for existing saves!
    if not rounds:
        done_cal = [c for c in (state.get("calendar") or []) if c.get("completed")]
        wcc_hist = state.get("wcc_history") or []
        cum_pts = 0
        total_done = max(1, len(done_cal))
        for idx, cal_r in enumerate(done_cal, 1):
            pres = cal_r.get("player_results") or []
            cum_pts += sum(int(x.get("pts") or 0) for x in pres)
            # Use exact wcc_history points if recorded for this round
            if idx - 1 < len(wcc_hist) and isinstance(wcc_hist[idx - 1], dict):
                w_entry = wcc_hist[idx - 1]
                if pt.get("id") in w_entry:
                    cum_pts = int(w_entry[pt["id"]])
            drv_entries = []
            for slot_i, did in enumerate(pt_dids[:2]):
                d_obj = drivers.get(did, {})
                d_name = d_obj.get("clean_name") or ""
                hit = next((x for x in pres if x.get("driver_id") == did or x.get("driver") == d_name), pres[slot_i] if slot_i < len(pres) else None)
                if hit:
                    drv_entries.append({
                        "driver_id": did,
                        "code3": hit.get("code3") or d_obj.get("code3") or "DRV",
                        "name": hit.get("driver") or d_name,
                        "grid_pos": int(hit.get("start_pos") or hit.get("pos") or 10),
                        "finish_pos": int(hit.get("pos") or 10),
                        "dnf": bool(hit.get("dnf")),
                        "pts": int(hit.get("pts") or 0),
                    })
            rounds.append({
                "season": int(state.get("season_num") or 1),
                "round": int(cal_r.get("round") or idx),
                "circuit_id": cal_r.get("circuit_id") or "",
                "gp": cal_r.get("gp") or cal_r.get("name") or f"R{idx}",
                "wcc_pts": cum_pts,
                "car_overall": round(max(65.0, float(pt.get("car_overall") or 80.0) - (total_done - idx) * 0.45), 1),
                "cash_m": float(state.get("cash_m") or 0.0),
                "cost_cap_spent_m": round(float(state.get("cost_cap_spent_m") or 0.0) * (idx / total_done), 2),
                "board_confidence": int(min(100, max(55, int(state.get("board_confidence") or 78) - round((total_done - idx) * 0.6)))),
                "drivers": drv_entries,
                "top_teams": [],
            })

    # Teammate H2H telemetry
    h2h_cards = []
    quali_wins = [0, 0]
    race_wins = [0, 0]
    for r in rounds:
        ds = r.get("drivers") or []
        if len(ds) >= 2:
            if ds[0]["grid_pos"] < ds[1]["grid_pos"]:
                quali_wins[0] += 1
            elif ds[1]["grid_pos"] < ds[0]["grid_pos"]:
                quali_wins[1] += 1
            if (not ds[0]["dnf"] and ds[1]["dnf"]) or (not ds[0]["dnf"] and not ds[1]["dnf"] and ds[0]["finish_pos"] < ds[1]["finish_pos"]):
                race_wins[0] += 1
            elif (ds[0]["dnf"] and not ds[1]["dnf"]) or (not ds[0]["dnf"] and not ds[1]["dnf"] and ds[1]["finish_pos"] < ds[0]["finish_pos"]):
                race_wins[1] += 1

    for slot_i, did in enumerate(pt_dids[:2]):
        d = drivers.get(did, {})
        drv_rounds = [next((x for x in (r.get("drivers") or []) if x.get("driver_id") == did), None) for r in rounds]
        drv_rounds = [x for x in drv_rounds if x]
        avg_grid = round(sum(x["grid_pos"] for x in drv_rounds) / max(1, len(drv_rounds)), 1) if drv_rounds else None
        fin_only = [x["finish_pos"] for x in drv_rounds if not x.get("dnf")]
        avg_fin = round(sum(fin_only) / max(1, len(fin_only)), 1) if fin_only else None
        sal = max(0.5, float(d.get("salary_m") or 2.0))
        pts = int(d.get("season_pts") or 0)
        h2h_cards.append({
            "driver_id": did,
            "name": d.get("clean_name") or "Driver",
            "code3": d.get("code3") or "DRV",
            "overall": int(d.get("overall") or 75),
            "morale": int(d.get("morale") or 75),
            "points": pts,
            "wins": int(d.get("season_wins") or 0),
            "podiums": int(d.get("season_podiums") or 0),
            "salary_m": sal,
            "pts_per_m": round(pts / sal, 2),
            "avg_grid": avg_grid,
            "avg_finish": avg_fin,
            "quali_h2h_wins": quali_wins[slot_i] if slot_i < 2 else 0,
            "race_h2h_wins": race_wins[slot_i] if slot_i < 2 else 0,
            "penalty_points": int(d.get("penalty_points") or 0),
            "race_ban_rounds": int(d.get("race_ban_rounds") or 0),
        })

    # R&D & Wind-Tunnel Correlation ROI
    rd_hist = list(state.get("rd_history") or [])
    corr_counts = {"breakthrough": 0, "clean": 0, "mismatch": 0}
    for h in rd_hist:
        oc = str(h.get("outcome") or "").lower()
        if "breakthrough" in oc:
            corr_counts["breakthrough"] += 1
        elif "mismatch" in oc:
            corr_counts["mismatch"] += 1
        else:
            corr_counts["clean"] += 1
    total_corr = max(1, sum(corr_counts.values()))
    corr_hit_pct = round(((corr_counts["breakthrough"] + corr_counts["clean"]) / total_corr) * 100.0, 1) if rd_hist else 100.0

    # Next GP Real F1DB Strategy Curve (1-Stop vs 2-Stop vs 3-Stop)
    cal = state.get("calendar") or []
    cur_rnd = max(1, min(len(cal), int(state.get("current_round") or 1)))
    next_gp = cal[cur_rnd - 1] if cal else {}
    next_cid = next_gp.get("circuit_id") or "melbourne"
    next_laps = int(next_gp.get("laps") or 57)

    f1db_cir = None
    try:
        from . import f1db
        f1db_cir = f1db.get_circuit_profile(next_cid, f1db_path)
    except Exception:
        f1db_cir = None

    deg_s = float(((f1db_cir or {}).get("tyreDegradation") or {}).get("tyreDegSecPerLap") or 0.068)
    pit_s = float(((f1db_cir or {}).get("pitStops") or {}).get("medianPitLaneSec") or next_gp.get("pit_loss_s") or 22.0)
    base_lap_s = float(((f1db_cir or {}).get("tyreDegradation") or {}).get("modernMedianLapSec") or next_gp.get("base_lap_s") or 88.0)

    def _sim_strategy(label: str, compounds: list[tuple[str, int, float, float]]) -> dict[str, Any]:
        # compounds: [(name, laps, pace_offset_s, deg_mult)]
        total_t = (len(compounds) - 1) * pit_s
        pit_laps = []
        lap_cursor = 0
        points = []
        for idx, (cname, st_laps, p_off, d_mult) in enumerate(compounds):
            if idx > 0:
                pit_laps.append(lap_cursor)
            for sl in range(st_laps):
                lap_cursor += 1
                cliff = max(0.0, (sl - 22) * 0.09) if cname == "S" else (max(0.0, (sl - 30) * 0.06) if cname == "M" else 0.0)
                lap_t = base_lap_s + p_off + (sl * deg_s * d_mult) + cliff
                total_t += lap_t
                if lap_cursor % 5 == 0 or lap_cursor == next_laps:
                    points.append({"lap": lap_cursor, "cumS": round(total_t - lap_cursor * base_lap_s, 1)})
        return {
            "label": label,
            "stops": len(compounds) - 1,
            "pitLaps": pit_laps,
            "totalSec": round(total_t, 1),
            "deltaVsBase": round(total_t - next_laps * base_lap_s, 1),
            "stints": [{"compound": c, "laps": l} for c, l, _, _ in compounds],
            "curve": points,
        }

    s1_l1 = max(10, round(next_laps * 0.42))
    s2_l1 = max(8, round(next_laps * 0.28))
    s2_l2 = max(10, round(next_laps * 0.36))
    s3_l1 = max(8, round(next_laps * 0.24))
    s3_l2 = max(8, round(next_laps * 0.26))
    s3_l3 = max(8, round(next_laps * 0.26))

    strategies = [
        _sim_strategy("1-Stop (M → H)", [("M", s1_l1, -0.35, 1.0), ("H", next_laps - s1_l1, 0.25, 0.65)]),
        _sim_strategy("2-Stop (S → M → M)", [("S", s2_l1, -0.95, 1.45), ("M", s2_l2, -0.35, 1.0), ("M", next_laps - s2_l1 - s2_l2, -0.35, 1.0)]),
        _sim_strategy("3-Stop Aggressive (S → S → M → S)", [("S", s3_l1, -0.95, 1.45), ("S", s3_l2, -0.95, 1.45), ("M", s3_l3, -0.35, 1.0), ("S", next_laps - s3_l1 - s3_l2 - s3_l3, -0.95, 1.45)]),
    ]
    best_t = min(s["totalSec"] for s in strategies)
    for s in strategies:
        s["gapToOptimal"] = round(s["totalSec"] - best_t, 1)
        s["recommended"] = s["totalSec"] == best_t

    # Grid-wide Super Licence 12-Point Leaderboard
    licence_grid = sorted(
        [
            {
                "driver_id": d["id"],
                "name": d["clean_name"],
                "code3": d["code3"],
                "team": next((t["name"] for t in teams if t["id"] == d.get("team_id")), "Free Agent"),
                "is_player": d.get("team_id") == pt.get("id"),
                "penalty_points": int(d.get("penalty_points") or 0),
                "race_ban_rounds": int(d.get("race_ban_rounds") or 0),
                "risk": "BAN" if int(d.get("race_ban_rounds") or 0) > 0 else ("CRITICAL" if int(d.get("penalty_points") or 0) >= 9 else ("WATCH" if int(d.get("penalty_points") or 0) >= 6 else "CLEAN")),
            }
            for d in drivers.values()
            if d.get("team_id") and d.get("role") == "race"
        ],
        key=lambda x: (-x["race_ban_rounds"], -x["penalty_points"], x["name"]),
    )

    return {
        "season": int(state.get("season_num") or 1),
        "currentRound": cur_rnd,
        "totalRounds": len(cal),
        "costCapLimitM": float(state.get("cost_cap_limit_m") or 135.0),
        "costCapSpentM": round(float(state.get("cost_cap_spent_m") or 0.0), 2),
        "rounds": rounds,
        "teammateH2H": h2h_cards,
        "rdCorrelation": {
            "counts": corr_counts,
            "hitRatePct": corr_hit_pct,
            "totalPackages": len(rd_hist),
        },
        "nextGp": {
            "circuitId": next_cid,
            "gp": next_gp.get("gp") or next_gp.get("name") or "Grand Prix",
            "laps": next_laps,
            "tyreDegSecPerLap": round(deg_s, 4),
            "medianPitLaneSec": round(pit_s, 2),
            "baseLapSec": round(base_lap_s, 2),
            "incidents": (f1db_cir or {}).get("incidents"),
            "tyreDegradation": (f1db_cir or {}).get("tyreDegradation"),
            "strategies": strategies,
        },
        "superLicenceGrid": licence_grid,
        "puContract": state.get("pu_contract"),
        "puSuppliers": PU_SUPPLIERS,
        "f1Commission": state.get("f1_commission"),
        "pendingStewards": state.get("pending_stewards"),
        "stewardsHistory": (state.get("stewards_history") or [])[:12],
        "regulationFormula": state.get("regulation_formula"),
        "tpProfiles": state.get("tp_profiles") or [],
        "politicalCapital": int(state.get("political_capital") or 0),
        "lobbiedTps": state.get("lobbied_tps") or [],
        "commissionBillHistory": (state.get("commission_bill_history") or [])[:8],
        "paddockTransitionLog": (state.get("paddock_transition_log") or [])[:8],
    }
