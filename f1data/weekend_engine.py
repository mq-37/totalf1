"""
Full F1 Grand Prix Weekend Structure & Free Practice Programmes Engine.

Powers structured FP1 -> FP2 -> FP3 -> Qualifying (Q1/Q2/Q3) -> Grand Prix progression:
  - 6 authentic F1 Practice Programmes assignable independently to Car #1 and Car #2.
  - Real persistent rewards:
      * Driver Skill XP & stat progression (pace, racecraft, consistency, tyre_care, clutch, wet)
      * Car Knowledge % (0..100%) boosting qualifying/race pace & setup window
      * Dev Points (spendable on instant car upgrades or R&D wind-tunnel acceleration)
      * Engineer Strategy Intel (35% -> 100% NAILED) giving concrete pit-window, degradation,
        undercut, and compound strategy calls plus a Race Strategy Execution bonus.
  - Works seamlessly with both Watch-Live on-track sessions and instant Sim-to-End!
"""
from __future__ import annotations

import copy
import random
from typing import Any


PRACTICE_PROGRAMMES: list[dict[str, Any]] = [
    {
        "id": "track_acclim",
        "name": "Track Acclimatisation",
        "short": "ACCLIM",
        "icon": "fa-route",
        "tyre": "medium",
        "target_laps": 6,
        "skill_stat": "pace",
        "skill_bonus": 0.45,
        "knowledge_gain": 16,
        "dev_points": 35,
        "strategy_gain": 10,
        "quali_bonus_s": 0.06,
        "tyre_life_bonus": 0.0,
        "desc": "Build corner apex rhythm & kerb confidence. +Pace XP, +16% Car Knowledge, +35 Dev Pts.",
        "engineer_hint": "Driver nailed braking markers through Sector 2 — corner exit traction is dialed in.",
    },
    {
        "id": "tyre_mgmt",
        "name": "Tyre Management Long-Run",
        "short": "TYRE-SIM",
        "icon": "fa-dharmachakra",
        "tyre": "hard",
        "target_laps": 8,
        "skill_stat": "tyre_care",
        "skill_bonus": 0.55,
        "knowledge_gain": 14,
        "dev_points": 35,
        "strategy_gain": 28,
        "quali_bonus_s": 0.0,
        "tyre_life_bonus": 4.0,
        "desc": "High-fuel thermal deg sweep. +Tyre Care XP, +28% Strategy Intel, +4% Race Tyre Life, +35 Dev Pts.",
        "engineer_hint": "Thermal deg curve mapped — rear surface temps stabilize 1.4 laps earlier than baseline.",
    },
    {
        "id": "aero_corr",
        "name": "Aero Flow-Viz & Correlation",
        "short": "AERO-CFD",
        "icon": "fa-wind",
        "tyre": "medium",
        "target_laps": 5,
        "skill_stat": "consistency",
        "skill_bonus": 0.35,
        "knowledge_gain": 26,
        "dev_points": 55,
        "strategy_gain": 12,
        "quali_bonus_s": 0.05,
        "tyre_life_bonus": 1.0,
        "desc": "Aero rake & floor pressure scan. +26% Car Knowledge, +55 Dev Pts, +Wind-Tunnel Correlation.",
        "engineer_hint": "Pitot rake array confirms floor vortex seal matches CFD within 1.2% — strong R&D data.",
    },
    {
        "id": "quali_sim",
        "name": "Qualifying Pace Glory Run",
        "short": "QUALI-SIM",
        "icon": "fa-stopwatch",
        "tyre": "soft",
        "target_laps": 5,
        "skill_stat": "clutch",
        "skill_bonus": 0.50,
        "knowledge_gain": 14,
        "dev_points": 30,
        "strategy_gain": 10,
        "quali_bonus_s": 0.16,
        "tyre_life_bonus": 0.0,
        "desc": "Low-fuel Softs peak-grip run. -0.16s Qualifying Pace Bonus, +Clutch XP, +30 Dev Pts.",
        "engineer_hint": "Single-lap out-lap prep temperature hit the 102°C sweet spot — Q3 peak grip unlocked.",
    },
    {
        "id": "race_strat",
        "name": "Race Strategy & Pit Window",
        "short": "STRAT-SIM",
        "icon": "fa-chess",
        "tyre": "medium",
        "target_laps": 7,
        "skill_stat": "racecraft",
        "skill_bonus": 0.45,
        "knowledge_gain": 15,
        "dev_points": 40,
        "strategy_gain": 34,
        "quali_bonus_s": 0.02,
        "tyre_life_bonus": 2.5,
        "desc": "Fuel-corrected stint model. +34% Strategy Intel (nails exact pit lap & undercut!), +40 Dev Pts.",
        "engineer_hint": "Pit-wall strategy model locked: undercut delta is worth +1.8s when boxing cleanly before traffic.",
    },
    {
        "id": "ers_deploy",
        "name": "ERS Harvest & Power Map",
        "short": "ERS-MAP",
        "icon": "fa-bolt",
        "tyre": "medium",
        "target_laps": 6,
        "skill_stat": "racecraft",
        "skill_bonus": 0.40,
        "knowledge_gain": 20,
        "dev_points": 45,
        "strategy_gain": 16,
        "quali_bonus_s": 0.07,
        "tyre_life_bonus": 1.0,
        "desc": "MGU-K harvest & clipping optimization. +20% Car Knowledge, +45 Dev Pts, +ERS Deployment Efficiency.",
        "engineer_hint": "Battery clipping eliminated on the main straight — extra +6% ERS deploy available for overtaking.",
    },
]

PROGRAMMES_BY_ID: dict[str, dict[str, Any]] = {p["id"]: p for p in PRACTICE_PROGRAMMES}


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(v)))


def _setup_hint(val: int, ideal: int) -> str:
    diff = val - ideal
    if abs(diff) <= 4:
        return "OPTIMAL"
    if diff < -14:
        return "WAY TOO LOW"
    if diff < 0:
        return "SLIGHTLY LOW"
    if diff > 14:
        return "WAY TOO HIGH"
    return "SLIGHTLY HIGH"


def _compute_strategy_intel(circuit: dict[str, Any], accuracy_pct: int, weather_mode: str = "dynamic") -> dict[str, Any]:
    """Compute engineer strategy guidance whose precision sharpens as FP programmes raise accuracy_pct."""
    acc = int(_clamp(accuracy_pct, 30, 100))
    laps = int(circuit.get("laps") or 57)
    base_deg = float(circuit.get("tyre_deg_s") or 0.068)
    pit_loss = float(circuit.get("pit_loss_s") or 22.0)

    # Low intel -> rougher +/- uncertainty; >=85% -> NAILED exact window!
    uncertainty = round(max(0.0, (100 - acc) * 0.035), 2)
    is_wet = weather_mode in ("rain", "showers")
    opt_stops = 1 if (base_deg < 0.072 and not is_wet) else 2
    opt_pit_frac = 0.42 if opt_stops == 1 else 0.30
    opt_pit_15 = max(4, min(11, round(15 * opt_pit_frac)))
    opt_pit_full = max(10, round(laps * opt_pit_frac))
    undercut_s = round(1.1 + base_deg * 14.0, 2)

    tier = "NAILED" if acc >= 85 else ("CALIBRATED" if acc >= 62 else "ROUGH ESTIMATE")
    rec_plan = (
        f"Inter → Inter (Box ~L{opt_pit_15} on 15L / L{opt_pit_full} full)" if is_wet
        else (
            f"1-Stop S → M or M → H (Optimal Pit Window: L{opt_pit_15} on 15L · Undercut +{undercut_s}s)"
            if opt_stops == 1
            else f"2-Stop S → M → M (Aggressive Undercut L{opt_pit_15} on 15L · Deg {base_deg:.3f}s/lap)"
        )
    )
    return {
        "accuracy_pct": acc,
        "tier": tier,
        "calibrated_deg_s": round(base_deg, 4),
        "uncertainty_laps": uncertainty,
        "pit_loss_s": round(pit_loss, 1),
        "optimal_stops": opt_stops,
        "optimal_pit_lap_15": opt_pit_15,
        "optimal_pit_lap_full": opt_pit_full,
        "undercut_gain_s": undercut_s,
        "recommended_plan": rec_plan,
        "race_strategy_bonus_s": round(max(0.0, (acc - 50) * 0.0045), 3),
    }


def ensure_weekend_state(
    state: dict[str, Any],
    circuit: dict[str, Any],
    ideal_setup: dict[str, int],
    weather_mode: str = "dynamic",
) -> dict[str, Any]:
    """Lazily initialize or return the structured FP1->FP2->FP3->Quali->Race weekend state for current round."""
    state.setdefault("dev_points", 0)
    rnd = int(state.get("current_round") or 1)
    cal = state.get("calendar") or []
    cal_item = cal[rnd - 1] if 0 < rnd <= len(cal) else {}
    is_sprint = bool(cal_item.get("is_sprint"))

    wk = state.get("weekend_state")
    if not isinstance(wk, dict) or wk.get("round") != rnd or wk.get("circuit_id") != circuit["id"]:
        # Sync initial setup sliders from weekend_setup if already present
        ws_old = state.get("weekend_setup") if isinstance(state.get("weekend_setup"), dict) and state["weekend_setup"].get("round") == rnd else {}
        wk = {
            "round": rnd,
            "circuit_id": circuit["id"],
            "circuit_name": circuit.get("name") or circuit["id"],
            "gp": circuit.get("gp") or cal_item.get("gp") or circuit.get("name"),
            "is_sprint": is_sprint,
            "sessions_order": ["fp1", "fp2", "q1", "q2", "q3", "race"] if is_sprint else ["fp1", "fp2", "fp3", "q1", "q2", "q3", "race"],
            "completed_sessions": [],
            "current_phase": "fp1",
            "car_knowledge_pct": 12,
            "weekend_dev_points": 0,
            "quali_pace_bonus_s": 0.0,
            "tyre_life_bonus_pct": 0.0,
            "ers_eff_bonus_pct": 0.0,
            "setup": {
                "wing": int(ws_old.get("wing", 50)),
                "susp": int(ws_old.get("susp", 50)),
                "diff": int(ws_old.get("diff", 50)),
                "confidence": int(ws_old.get("confidence", 64)),
                "feedback": dict(ws_old.get("feedback") or {"wing": "UNTESTED", "susp": "UNTESTED", "diff": "UNTESTED"}),
            },
            "programmes_assigned": {"0": "track_acclim", "1": "tyre_mgmt"},
            "programmes_completed": [],
            "driver_skill_gains": {},
            "engineer_notes": [
                f"Welcome to {circuit.get('name')}. Run FP1 & FP2 programmes to build Car Knowledge, Dev Points, Driver XP & nail Sunday's pit strategy."
            ],
            "strategy_intel": _compute_strategy_intel(circuit, 35, weather_mode),
            "session_results": {},
        }
        state["weekend_state"] = wk
    else:
        # Refresh strategy intel if weather changed
        wk["strategy_intel"] = _compute_strategy_intel(
            circuit,
            int((wk.get("strategy_intel") or {}).get("accuracy_pct", 35)),
            weather_mode,
        )
    return wk


def build_weekend_roster(state: dict[str, Any], circuit: dict[str, Any], compute_car_overall_fn) -> list[dict[str, Any]]:
    """Build the 20-car weekend grid roster with performance specs for live FP1/FP2/FP3 & Quali watchable sims."""
    roster: list[dict[str, Any]] = []
    for t in state.get("teams") or []:
        car_ovr = float(compute_car_overall_fn(t, state.get("staff")))
        rd = t.get("rd") or {"aero": 75, "chassis": 75, "power": 75, "tyre_care": 75}
        if circuit.get("aero") == "HIGH":
            car_fit = rd["aero"] * 0.42 + rd["chassis"] * 0.28 + rd["power"] * 0.16 + rd["tyre_care"] * 0.14
        elif circuit.get("aero") == "LOW":
            car_fit = rd["power"] * 0.44 + rd["chassis"] * 0.28 + rd["aero"] * 0.16 + rd["tyre_care"] * 0.12
        else:
            car_fit = car_ovr

        for slot_i, did in enumerate(t.get("driver_ids") or []):
            d = (state.get("drivers") or {}).get(did)
            if not d:
                continue
            st = d.get("stats") or {}
            roster.append({
                "driver_id": did,
                "slot": slot_i,
                "clean_name": d.get("clean_name") or did,
                "code3": d.get("code3") or "DRV",
                "team_id": t["id"],
                "team_name": t["name"],
                "color": t.get("color") or "#e10600",
                "is_player_team": bool(t.get("is_player")),
                "car_overall": round(car_ovr, 1),
                "car_fit": round(car_fit, 1),
                "pace": float(st.get("pace", 75)),
                "racecraft": float(st.get("racecraft", 75)),
                "tyre_care": float(st.get("tyre_care", st.get("consistency", 75))),
                "consistency": float(st.get("consistency", 75)),
                "wet": float(st.get("wet", 75)),
                "clutch": float(st.get("clutch", 75)),
                "trait": d.get("trait") or "",
            })
    return roster


def complete_practice_session(
    state: dict[str, Any],
    session_key: str,
    car_programmes: dict[str, str] | None,
    wing: int,
    susp: int,
    diff: int,
    auto_tune: bool,
    programme_scores: dict[str, float] | None,
    session_times: list[dict[str, Any]] | None,
    circuit: dict[str, Any],
    ideal_setup: dict[str, int],
    get_player_team_fn,
    compute_car_overall_fn,
    add_inbox_fn,
    weather_mode: str = "dynamic",
) -> tuple[bool, str, dict[str, Any]]:
    """Commit a finished FP1 / FP2 / FP3 session (watched live or simmed to end) & award all progression."""
    skey = (session_key or "fp1").strip().lower()
    if skey not in ("fp1", "fp2", "fp3"):
        return False, f"Invalid practice session '{session_key}'", {}

    wk = ensure_weekend_state(state, circuit, ideal_setup, weather_mode=weather_mode)
    pq = state.get("pending_quali") or {}
    if pq.get("round") == wk["round"] and pq.get("stage") == "done":
        return False, "Qualifying is already complete — setup & practice are locked in FIA Parc Fermé!", wk
    if skey in wk["completed_sessions"]:
        return False, f"{skey.upper()} has already been completed this weekend.", wk

    re_staff = (state.get("staff") or {}).get("race_engineer") or {}
    re_rating = float(re_staff.get("rating", 76))
    re_name = re_staff.get("name") or "Chief Race Engineer"
    rng = random.Random(wk["round"] * 997 + (1 if skey == "fp1" else (2 if skey == "fp2" else 3)) * 131 + int(re_rating))

    # 1. Setup tuning (manual sliders OR Chief Engineer Auto-Tune)
    if auto_tune:
        spread = max(2, int(round((98 - re_rating) * 0.42)))
        wing = int(_clamp(ideal_setup["wing"] + rng.randint(-spread, spread), 5, 95))
        susp = int(_clamp(ideal_setup["susp"] + rng.randint(-spread, spread), 5, 95))
        diff = int(_clamp(ideal_setup["diff"] + rng.randint(-spread, spread), 5, 95))
    else:
        wing = int(_clamp(wing, 0, 100))
        susp = int(_clamp(susp, 0, 100))
        diff = int(_clamp(diff, 0, 100))

    avg_err = (abs(wing - ideal_setup["wing"]) + abs(susp - ideal_setup["susp"]) + abs(diff - ideal_setup["diff"])) / 3.0
    eng_bonus = max(0.0, (re_rating - 70.0) * 0.35)
    conf = int(_clamp(round(100.0 - avg_err * 1.42 + eng_bonus), 44, 100))
    fb = {
        "wing": _setup_hint(wing, ideal_setup["wing"]),
        "susp": _setup_hint(susp, ideal_setup["susp"]),
        "diff": _setup_hint(diff, ideal_setup["diff"]),
    }
    wk["setup"] = {"wing": wing, "susp": susp, "diff": diff, "confidence": conf, "feedback": fb}

    # Keep legacy state["weekend_setup"] perfectly synchronized for existing race/quali consumers
    stints_done = len([x for x in wk["completed_sessions"] if x.startswith("fp")]) + 1
    state["weekend_setup"] = {
        "round": wk["round"],
        "circuit_id": circuit["id"],
        "stints_used": stints_done,
        "max_stints": 2 if wk["is_sprint"] else 3,
        "wing": wing,
        "susp": susp,
        "diff": diff,
        "confidence": conf,
        "feedback": fb,
    }

    # 2. Evaluate Practice Programmes for Car #1 & Car #2 -> Skills, Car Knowledge, Dev Points, Strategy Intel!
    pt = get_player_team_fn(state)
    progs_in = car_programmes or wk.get("programmes_assigned") or {"0": "track_acclim", "1": "tyre_mgmt"}
    wk["programmes_assigned"] = {
        "0": str(progs_in.get("0") or "track_acclim"),
        "1": str(progs_in.get("1") or "tyre_mgmt"),
    }

    total_kn = 0
    total_dev = 0
    total_strat = 0
    session_notes: list[str] = []
    prog_summaries: list[dict[str, Any]] = []

    for slot_i in (0, 1):
        pid = wk["programmes_assigned"].get(str(slot_i), "track_acclim")
        prog = copy.deepcopy(PROGRAMMES_BY_ID.get(pid, PRACTICE_PROGRAMMES[0]))
        did = pt["driver_ids"][slot_i] if slot_i < len(pt.get("driver_ids") or []) else None
        drv = (state.get("drivers") or {}).get(did) if did else None

        # Completion ratio from live session watch (0.5..1.0) or sim-to-end (computed from setup + engineer)
        raw_score = None
        if isinstance(programme_scores, dict) and str(slot_i) in programme_scores:
            raw_score = float(programme_scores[str(slot_i)])
        if raw_score is None:
            raw_score = _clamp(0.72 + (conf - 65) * 0.006 + (re_rating - 75) * 0.004 + rng.uniform(-0.06, 0.12), 0.55, 1.0)
        score = _clamp(raw_score, 0.45, 1.0)
        grade = "GOLD" if score >= 0.88 else ("SILVER" if score >= 0.70 else "BRONZE")
        mult = 1.15 if grade == "GOLD" else (1.0 if grade == "SILVER" else 0.78)

        kn_gain = int(round(prog["knowledge_gain"] * mult))
        dev_gain = int(round(prog["dev_points"] * mult))
        strat_gain = int(round(prog["strategy_gain"] * mult))
        total_kn += kn_gain
        total_dev += dev_gain
        total_strat += strat_gain

        wk["quali_pace_bonus_s"] = round(min(0.32, float(wk.get("quali_pace_bonus_s", 0.0)) + prog["quali_bonus_s"] * mult), 3)
        wk["tyre_life_bonus_pct"] = round(min(8.0, float(wk.get("tyre_life_bonus_pct", 0.0)) + prog["tyre_life_bonus"] * mult), 1)
        if pid == "ers_deploy":
            wk["ers_eff_bonus_pct"] = round(min(10.0, float(wk.get("ers_eff_bonus_pct", 0.0)) + 4.5 * mult), 1)

        # Apply real Driver Skill XP / stat improvement (capped at driver potential)
        stat_key = prog["skill_stat"]
        stat_delta = round(prog["skill_bonus"] * mult, 2)
        drv_name = drv.get("clean_name", f"Car #{slot_i + 1}") if drv else f"Car #{slot_i + 1}"
        if drv and isinstance(drv.get("stats"), dict):
            pot = float(drv.get("potential", 95))
            if stat_key in drv["stats"]:
                cur_v = float(drv["stats"][stat_key])
                new_v = round(min(99.0, max(cur_v, min(pot, cur_v + stat_delta))), 2)
                drv["stats"][stat_key] = new_v
            else:
                # Map tyre_care onto consistency if legacy driver lacks explicit tyre_care key
                cur_v = float(drv["stats"].get("consistency", 75))
                drv["stats"]["consistency"] = round(min(99.0, min(pot, cur_v + stat_delta)), 2)
            drv["xp"] = int(drv.get("xp") or 0) + int(round(28 * mult))
            gains_map = wk["driver_skill_gains"].setdefault(did, {"name": drv_name, "code3": drv.get("code3", "DRV"), "stats": {}})
            gains_map["stats"][stat_key] = round(float(gains_map["stats"].get(stat_key, 0.0)) + stat_delta, 2)

        prog_summaries.append({
            "slot": slot_i,
            "driver": drv_name,
            "programme_id": pid,
            "programme_name": prog["name"],
            "short": prog["short"],
            "grade": grade,
            "dev_points": dev_gain,
            "knowledge_gain": kn_gain,
            "strategy_gain": strat_gain,
            "skill_stat": stat_key,
            "skill_delta": stat_delta,
        })
        session_notes.append(f"[{skey.upper()} · {drv_name} · {prog['short']} {grade}] {prog['engineer_hint']}")

    # Setup feedback engineering note
    bad_axes = [f"{k.upper()} ({v})" for k, v in fb.items() if v != "OPTIMAL"]
    if not bad_axes:
        session_notes.insert(0, f"{re_name}: Balance is spot-on ({conf}% confidence) — all 3 setup axes in the OPTIMAL window!")
    else:
        session_notes.insert(0, f"{re_name}: Setup at {conf}% — tweak {', '.join(bad_axes)} before Parc Fermé.")

    wk["car_knowledge_pct"] = int(_clamp(int(wk.get("car_knowledge_pct", 12)) + total_kn, 0, 100))
    wk["weekend_dev_points"] = int(wk.get("weekend_dev_points", 0)) + total_dev
    state["dev_points"] = int(state.get("dev_points", 0)) + total_dev

    new_acc = int(_clamp(int((wk.get("strategy_intel") or {}).get("accuracy_pct", 35)) + total_strat, 35, 100))
    wk["strategy_intel"] = _compute_strategy_intel(circuit, new_acc, weather_mode)
    wk["programmes_completed"].append({"session": skey, "items": prog_summaries})
    wk["engineer_notes"] = (session_notes + list(wk.get("engineer_notes") or []))[:10]

    # 3. Generate or store 20-car classification table for this practice session
    if isinstance(session_times, list) and len(session_times) >= 6:
        times_out = session_times
    else:
        roster = build_weekend_roster(state, circuit, compute_car_overall_fn)
        times_out = []
        base_lap = float(circuit.get("base_lap_s") or 86.0)
        for r in roster:
            perf = r["car_fit"] * 0.55 + r["pace"] * 0.35 + r["consistency"] * 0.10
            setup_b = (conf - 70.0) * 0.012 if r["is_player_team"] else 0.0
            kn_b = (wk["car_knowledge_pct"] * 0.002) if r["is_player_team"] else 0.0
            lap = base_lap + 1.15 - (perf - 75.0) * 0.09 - setup_b - kn_b + rng.uniform(-0.45, 0.45)
            times_out.append({
                "driver_id": r["driver_id"],
                "code3": r["code3"],
                "clean_name": r["clean_name"],
                "team_name": r["team_name"],
                "color": r["color"],
                "is_player_team": r["is_player_team"],
                "best_lap_s": round(lap, 3),
                "laps": rng.randint(14, 24),
                "tyre": rng.choice(["S", "M", "H"]),
            })
        times_out.sort(key=lambda x: x["best_lap_s"])
        best0 = times_out[0]["best_lap_s"] if times_out else base_lap
        for i, row in enumerate(times_out, start=1):
            row["pos"] = i
            row["gap_s"] = round(max(0.0, row["best_lap_s"] - best0), 3)

    wk["session_results"][skey] = {
        "session": skey,
        "classification": times_out,
        "programmes": prog_summaries,
        "setup_confidence": conf,
    }
    wk["completed_sessions"].append(skey)

    # Advance weekend phase automatically
    order = wk["sessions_order"]
    try:
        idx = order.index(skey)
        wk["current_phase"] = order[min(len(order) - 1, idx + 1)]
    except ValueError:
        wk["current_phase"] = "q1"

    # Suggest smart next programmes so player gets variety across FP1 -> FP2 -> FP3
    if skey == "fp1":
        wk["programmes_assigned"] = {"0": "aero_corr", "1": "race_strat"}
    elif skey == "fp2":
        wk["programmes_assigned"] = {"0": "quali_sim", "1": "ers_deploy"}

    state["weekend_state"] = wk
    msg = (
        f"{skey.upper()} Complete! Setup {conf}% · Car Knowledge {wk['car_knowledge_pct']}% · "
        f"+{total_dev} Dev Pts · Strategy Intel {wk['strategy_intel']['accuracy_pct']}% ({wk['strategy_intel']['tier']})"
    )
    return True, msg, wk


def spend_dev_points(
    state: dict[str, Any],
    target: str,
    get_player_team_fn,
    compute_car_overall_fn,
    add_inbox_fn,
) -> tuple[bool, str]:
    """Spend 100 Weekend Dev Points on immediate car part tuning or accelerating active R&D projects."""
    cost = 100
    pts = int(state.get("dev_points") or 0)
    if pts < cost:
        return False, f"Need {cost} Dev Points (currently {pts}). Complete FP1/FP2/FP3 programmes to earn more!"

    pt = get_player_team_fn(state)
    tgt = (target or "aero").strip().lower()
    if tgt in ("aero", "chassis", "power", "tyre_care"):
        rd = pt.get("rd") or {}
        rd[tgt] = round(min(99.5, float(rd.get(tgt, 75.0)) + 1.2), 1)
        pt["rd"] = rd
        pt["car_overall"] = compute_car_overall_fn(pt, state.get("staff"))
        state["dev_points"] = pts - cost
        add_inbox_fn(
            state,
            "rd",
            f"Trackside Dev Upgrade Applied ({tgt.upper()})",
            f"Spent {cost} FP Dev Points to refine {tgt.upper()} (+1.2 -> {rd[tgt]}). Car OVR is now {pt['car_overall']}!",
        )
        return True, f"Applied trackside {tgt.upper()} upgrade (+1.2) using {cost} Dev Points!"

    if tgt == "rd_boost":
        active = state.get("rd_projects") or []
        if not active:
            return False, "No active R&D project in the factory to accelerate — pick Aero, Chassis, Power, or Tyre Care instead."
        for proj in active:
            proj["rounds_left"] = max(1, int(proj.get("rounds_left", 2)) - 1)
            proj["corr_chance"] = min(0.99, float(proj.get("corr_chance", 0.85)) + 0.08)
        state["dev_points"] = pts - cost
        add_inbox_fn(
            state,
            "rd",
            "FP Telemetry Fast-Tracked Factory R&D!",
            f"Spent {cost} Dev Points from Practice Programmes to cut 1 round off active R&D projects and boost correlation +8%.",
        )
        return True, f"Fast-tracked {len(active)} active R&D project(s) (-1 round, +8% correlation)!"

    return False, f"Unknown Dev Points target '{target}'"
