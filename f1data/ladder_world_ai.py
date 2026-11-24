"""
Pit Wall: The Ladder — Living 5-Tier World AI & Off-Season Ecosystem Engine.

Decoupled from ladder_engine.py to keep the core engine lean (<2,000 LOC).
Handles:
  1. 40-point Super License Auto-Graduation from F2/F3 into open F1 seats
  2. Inter-tier Ladder Flow (Karting -> F4 -> F3 -> F2 promotions, stalled junior washouts)
  3. Fresh 13–15-year-old Karting regen spawning with Fog-of-War masked potential_ceiling & traits
  4. Organic AI Silly Season: AI principal firings vs board expectations -> player F1 Poaching Offers
  5. AI rival staff poaching with mandatory gardening leave & structured Silly Season news feed
"""
from __future__ import annotations

import random
from typing import Any, Callable


_REGEN_FIRST = (
    "Matteo", "Leo", "Kian", "Sora", "Milo", "Emilio", "Toby", "Rayan", "Luka",
    "Jenson", "Gabe", "Archie", "Nils", "Enzo", "Dante", "Theo", "Callum", "Riku",
)
_REGEN_LAST = (
    "Bellucci", "Lind", "Takagi", "Reyes", "Kowalsky", "Moreau", "O'Brien", "Voss",
    "Conti", "Almeida", "Berg", "Serrano", "Nakamura", "Ferreira", "Hart", "Bauer",
)
_REGEN_NATS = ("GBR", "ITA", "FRA", "NED", "ESP", "GER", "BRA", "JPN", "AUS", "FIN", "IRL", "USA", "AUT")
_AI_PRINCIPALS = (
    "Marco Bellini", "Claire Devereux", "Henrik Lindholm", "Stefan Brenner",
    "Matteo Conti", "Rachel Vance", "Kenji Sato", "David Gallagher",
)


def _emit_silly_news(
    state: dict[str, Any],
    *,
    kind: str,
    tier: str,
    team: str,
    person: str,
    text: str,
    also_inbox: bool = False,
    inbox_title: str | None = None,
) -> dict[str, Any]:
    item = {
        "type": kind,
        "season": int(state.get("season") or 1),
        "round": int(state.get("round") or 1),
        "tier": tier,
        "team": team,
        "person": person,
        "text": text,
    }
    state.setdefault("silly_season_log", []).insert(0, item)
    state["silly_season_log"] = state["silly_season_log"][:36]
    if also_inbox:
        state.setdefault("inbox", []).insert(0, {
            "id": f"ai_{state['season']}_{state['round']}_{len(state.get('inbox', [])) + 1}",
            "round": int(state.get("round") or 1),
            "sender": "Paddock Silly Season Wire",
            "tag": kind.upper()[:8],
            "title": inbox_title or f"{team}: {kind.replace('_', ' ').title()}",
            "body": text,
            "read": False,
        })
        state["inbox"] = state["inbox"][:32]
    return item


def evaluate_ai_principals_and_poaching(
    state: dict[str, Any],
    rng: random.Random,
    *,
    force_vacancy_for_test: bool = False,
) -> dict[str, Any]:
    """
    Evaluate AI team standings vs. car_rating board expectations across F1 and F2.
    Underperforming AI F1 teams fire their Team Principal, opening genuine F1 Poaching Offers
    for the player if reputation or Academy KPI score meets the threshold.
    """
    firings: list[dict[str, Any]] = []
    vacancies: list[dict[str, Any]] = []

    for tid in ("f1", "f2"):
        teams = state["tiers"][tid]["teams"]
        if not teams:
            continue
        by_car = sorted(teams, key=lambda t: -float(t["car_rating"]))
        expected_rank = {t["id"]: i + 1 for i, t in enumerate(by_car)}
        by_pts = sorted(teams, key=lambda t: (-float(t["points"]), -float(t["car_rating"])))
        actual_rank = {t["id"]: i + 1 for i, t in enumerate(by_pts)}

        for tm in teams:
            if tm.get("is_player"):
                continue
            exp_p = expected_rank[tm["id"]]
            act_p = actual_rank[tm["id"]]
            underperf = act_p - exp_p
            should_fire = (
                (underperf >= 2)
                or (act_p >= len(teams) - 1 and float(tm["car_rating"]) >= 80)
                or (force_vacancy_for_test and tid == "f1" and act_p == len(teams))
            )
            if not should_fire:
                continue
            old_tp = str(tm.get("principal") or "AI Principal")
            new_tp = rng.choice([p for p in _AI_PRINCIPALS if p != old_tp] or list(_AI_PRINCIPALS))
            tm["principal"] = f"{new_tp} (Interim)" if tid == "f1" else new_tp
            tm["tp_vacant"] = (tid == "f1")
            ev = _emit_silly_news(
                state,
                kind="principal_fired",
                tier=tid,
                team=tm["name"],
                person=old_tp,
                text=f"{tm['name']} ({tid.upper()}) board fires TP {old_tp} after finishing P{act_p} (expected P{exp_p})!",
                also_inbox=(tid == "f1"),
                inbox_title=f"F1 Seat Open: {tm['name']} Fires {old_tp}",
            )
            firings.append(ev)
            if tid == "f1":
                vacancies.append({
                    "id": f"poach_{tm['id']}",
                    "f1_team": tm["name"],
                    "color": tm["color"],
                    "car_rating": tm["car_rating"],
                    "budget_k": round(128000.0 + (float(tm["car_rating"]) - 76.0) * 2800.0, 1),
                    "reputation_req": 64 if float(tm["car_rating"]) < 84 else 78,
                    "reason": f"Vacancy opened after {old_tp} dismissal (P{act_p} vs expected P{exp_p})",
                })

    # Match F1 vacancies against player reputation OR active F1 Academy KPI performance!
    player = state["player"]
    rep = float(player.get("reputation") or 0.0)
    acad = state.get("academy_deal")
    acad_kpi_met = False
    if acad and state["tier"] in ("f2", "f3"):
        cur_teams = sorted(state["tiers"][state["tier"]]["teams"], key=lambda t: -float(t["points"]))
        p_pos = next((i + 1 for i, t in enumerate(cur_teams) if t.get("is_player")), 99)
        acad_kpi_met = p_pos <= int(acad.get("kpi_min_pos") or 5)

    qualified_offers = [
        v for v in vacancies
        if (rep >= v["reputation_req"]) or acad_kpi_met
    ]
    if qualified_offers and state["tier"] in ("f2", "f1"):
        existing_names = {o["f1_team"] for o in player.get("poach_offers", [])}
        merged = list(player.get("poach_offers", []))
        for q in qualified_offers:
            if q["f1_team"] not in existing_names:
                merged.insert(0, q)
                existing_names.add(q["f1_team"])
        player["poach_offers"] = merged[:4]
        if state["tier"] == "f2":
            player["fork_ready"] = True

    return {"firings": firings, "vacancies": vacancies, "qualified_offers": qualified_offers}


def run_ai_staff_poaching(state: dict[str, Any], rng: random.Random) -> list[dict[str, Any]]:
    """AI teams poach senior engineers/staff from rivals while respecting mandatory gardening leave."""
    poaches: list[dict[str, Any]] = []
    f1_ai = [t for t in state["tiers"]["f1"]["teams"] if not t.get("is_player")]
    if len(f1_ai) < 2:
        return poaches

    mkt = state.get("staff_market") or []
    if mkt and rng.random() < 0.65:
        target_staff = rng.choice(mkt)
        buyer = rng.choice([t for t in f1_ai if t["name"] != target_staff.get("from_team")] or f1_ai)
        gl = int(target_staff.get("gardening_rounds") or 2)
        ev = _emit_silly_news(
            state,
            kind="staff_poached",
            tier="f1",
            team=buyer["name"],
            person=target_staff["name"],
            text=f"{buyer['name']} poaches {target_staff['role']} {target_staff['name']} from {target_staff['from_team']} ({gl}-round gardening leave).",
        )
        # Mild competitive shift for buyer after gardening leave
        buyer["car_rating"] = round(min(94.0, float(buyer["car_rating"]) + 0.6), 1)
        poaches.append(ev)
    return poaches


def run_inter_tier_driver_flow(
    state: dict[str, Any],
    rng: random.Random,
    make_driver_fn: Callable[..., dict[str, Any]],
) -> dict[str, Any]:
    """
    Simulate organic 5-tier driver movement at season end:
      - F1 veteran retirements -> Auto-graduate 40+ SL-point F2/F3 stars into open AI F1 seats
      - Top finishers promote Karting -> F4 -> F3 -> F2
      - Stalled older juniors wash out
      - Spawn fresh 13–15yo Karting regens with Fog-of-War masked potential_ceiling & traits
    """
    drivers = state["drivers"]
    player_ids = set(state["player"].get("driver_ids") or [])
    f1_graduations: list[dict[str, Any]] = []
    promotions: list[dict[str, Any]] = []
    washouts: list[str] = []
    regens_spawned: list[str] = []

    # 1. Open F1 AI seats from veteran retirements (age >= 38) or lowest-performing aging backmarker
    open_f1_slots: list[tuple[dict[str, Any], int]] = []
    for tm in state["tiers"]["f1"]["teams"]:
        if tm.get("is_player"):
            continue
        for s_i, did in enumerate(list(tm["driver_ids"])):
            d = drivers.get(did)
            if not d or did in player_ids:
                continue
            if int(d["age"]) >= 38 or (int(d["age"]) >= 34 and float(d["season_pts"]) == 0 and rng.random() < 0.45):
                d["team"] = "Retired"
                d["tier"] = "retired"
                _emit_silly_news(
                    state, kind="retirement", tier="f1", team=tm["name"], person=d["name"],
                    text=f"{d['name']} ({d['age']}y) retires from Formula 1, opening a seat at {tm['name']}!",
                )
                open_f1_slots.append((tm, s_i))

    # Auto-graduate 40+ Super License F2/F3 stars into open F1 seats!
    sl_grads = [
        d for d in drivers.values()
        if d["tier"] in ("f2", "f3")
        and d["id"] not in player_ids
        and int(d.get("sl_points") or 0) >= 40
        and d["team"] not in ("Free Agent", "Retired")
    ]
    sl_grads.sort(key=lambda d: (-int(d["sl_points"]), -float(d["season_pts"]), -int(d["overall"])))

    for tm, s_i in open_f1_slots:
        if not sl_grads:
            break
        grad = sl_grads.pop(0)
        old_tier = grad["tier"]
        # Remove grad from old feeder team
        for old_t in state["tiers"][old_tier]["teams"]:
            if grad["id"] in old_t["driver_ids"]:
                old_t["driver_ids"].remove(grad["id"])
        grad["tier"] = "f1"
        grad["team"] = tm["name"]
        grad["scouted"] = True
        grad["trait_revealed"] = True
        grad["overall"] = min(grad["potential"], max(int(grad["overall"]), 78))
        tm["driver_ids"][s_i] = grad["id"]
        ev = _emit_silly_news(
            state, kind="f1_graduation", tier="f1", team=tm["name"], person=grad["name"],
            text=f"SUPER LICENSE GRADUATE: {grad['name']} ({grad['sl_points']} SL pts) promoted from {old_tier.upper()} to {tm['name']} in Formula 1!",
            also_inbox=True,
            inbox_title=f"F1 Rookie Signed: {grad['name']} → {tm['name']}",
        )
        f1_graduations.append(ev)

    # 2. Wash out stalled older juniors from Karting, F4, F3
    max_age_by_tier = {"karting": 18, "f4": 21, "f3": 24, "f2": 27}
    for tid, max_a in max_age_by_tier.items():
        for tm in state["tiers"][tid]["teams"]:
            if tm.get("is_player"):
                continue
            for did in list(tm["driver_ids"]):
                d = drivers.get(did)
                if not d or did in player_ids:
                    continue
                if int(d["age"]) >= max_a and int(d["overall"]) < (62 if tid == "karting" else 74):
                    tm["driver_ids"].remove(did)
                    d["team"] = "Free Agent"
                    washouts.append(d["name"])

    # 3. Promote top championship finishers up the ladder: Karting -> F4 -> F3 -> F2
    ladder_pairs = (("f3", "f2"), ("f4", "f3"), ("karting", "f4"))
    for src_tier, dst_tier in ladder_pairs:
        src_candidates = [
            d for d in drivers.values()
            if d["tier"] == src_tier and d["id"] not in player_ids and d["team"] not in ("Free Agent", "Retired")
        ]
        src_candidates.sort(key=lambda d: (-float(d["season_pts"]), -int(d["overall"])))
        dst_ai_teams = [t for t in state["tiers"][dst_tier]["teams"] if not t.get("is_player")]
        promoted_cnt = 0
        for cand in src_candidates[:3]:
            if not dst_ai_teams:
                break
            # Prefer a team with an open slot, else replace weakest driver in bottom team
            target_tm = next((t for t in dst_ai_teams if len(t["driver_ids"]) < (3 if dst_tier == "f3" else 2)), None)
            if target_tm is None:
                target_tm = dst_ai_teams[-1]
                if target_tm["driver_ids"]:
                    dropped_id = target_tm["driver_ids"].pop()
                    if dropped_id in drivers:
                        drivers[dropped_id]["team"] = "Free Agent"
            for st_tm in state["tiers"][src_tier]["teams"]:
                if cand["id"] in st_tm["driver_ids"]:
                    st_tm["driver_ids"].remove(cand["id"])
            cand["tier"] = dst_tier
            cand["team"] = target_tm["name"]
            cand["overall"] = min(cand["potential"], int(cand["overall"]) + 2)
            target_tm["driver_ids"].append(cand["id"])
            promoted_cnt += 1
            promotions.append({"driver": cand["name"], "from": src_tier, "to": dst_tier, "team": target_tm["name"]})
        if promoted_cnt:
            _emit_silly_news(
                state, kind="ladder_promotion", tier=dst_tier, team=dst_tier.upper(), person=promotions[-1]["driver"],
                text=f"{promoted_cnt} top {src_tier.upper()} graduate(s) stepped up into {dst_tier.upper()}, led by {promotions[-1]['driver']}.",
            )

    # 4. Backfill any empty Karting/F4/F3/F2 AI seats & spawn fresh 13-to-15yo Karting regens!
    existing_names = {d["name"] for d in drivers.values()}

    def _spawn_kart_regen(team_name: str, slot_tag: str) -> dict[str, Any]:
        nm = ""
        for _ in range(40):
            cand_nm = f"{rng.choice(_REGEN_FIRST)} {rng.choice(_REGEN_LAST)}"
            if cand_nm not in existing_names:
                nm = cand_nm
                break
        if not nm:
            nm = f"Kart Prodigy {len(drivers) + 1}"
        existing_names.add(nm)
        did = f"regen_s{state['season']}_{slot_tag}_{len(drivers) + 1}"
        age = rng.randint(13, 15)
        ovr = rng.randint(48, 60)
        pot = rng.randint(70, 96)
        drv = make_driver_fn(
            rng, did, nm, rng.choice(_REGEN_NATS), "karting", team_name,
            age, ovr, pot, sl_history=[0, 0, 0], pay_driver_k=rng.choice([0.0, 18.0, 30.0]), scouted=False,
        )
        drivers[did] = drv
        regens_spawned.append(did)
        return drv

    # Ensure every Karting AI team has 2 seats (spawning 13-15yo regens) + 2 free-agent Karting wonderkids!
    for idx, ktm in enumerate(state["tiers"]["karting"]["teams"]):
        if ktm.get("is_player"):
            continue
        while len(ktm["driver_ids"]) < 2:
            reg = _spawn_kart_regen(ktm["name"], f"k{idx}")
            ktm["driver_ids"].append(reg["id"])
    for fa_i in range(2):
        _spawn_kart_regen("Free Agent", f"fa{fa_i}")

    # Refill any vacancies in F4/F3/F2 AI teams so grids never shrink
    for tid in ("f4", "f3", "f2"):
        req_seats = 3 if tid == "f3" else 2
        ovr_rng = {"f4": (56, 67), "f3": (64, 74), "f2": (71, 80)}[tid]
        age_rng = {"f4": (15, 18), "f3": (17, 20), "f2": (19, 22)}[tid]
        for idx, tm in enumerate(state["tiers"][tid]["teams"]):
            if tm.get("is_player"):
                continue
            while len(tm["driver_ids"]) < req_seats:
                nm = f"{rng.choice(_REGEN_FIRST)} {rng.choice(_REGEN_LAST)}"
                if nm in existing_names:
                    nm = f"{nm} Jr."
                existing_names.add(nm)
                did = f"fill_{tid}_s{state['season']}_{idx}_{len(drivers) + 1}"
                ovr = rng.randint(*ovr_rng)
                pot = min(95, ovr + rng.randint(6, 18))
                drv = make_driver_fn(
                    rng, did, nm, rng.choice(_REGEN_NATS), tid, tm["name"],
                    rng.randint(*age_rng), ovr, pot, sl_history=[4, 6, 0], scouted=False,
                )
                drivers[did] = drv
                tm["driver_ids"].append(did)

    return {
        "f1_graduations": f1_graduations,
        "promotions": promotions,
        "washouts": washouts,
        "regens_spawned": regens_spawned,
    }


def run_offseason_world_ai(
    state: dict[str, Any],
    rng: random.Random,
    make_driver_fn: Callable[..., dict[str, Any]],
) -> dict[str, Any]:
    """Run the full living 5-tier off-season AI pass (promotions, graduations, regens, firings, staff poaching)."""
    flow = run_inter_tier_driver_flow(state, rng, make_driver_fn)
    principals = evaluate_ai_principals_and_poaching(state, rng)
    staff_moves = run_ai_staff_poaching(state, rng)
    return {
        **flow,
        "principal_firings": principals["firings"],
        "staff_poaches": staff_moves,
    }
