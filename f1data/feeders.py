"""
FIA Feeder Series Ecosystem (F2, F3, F1 Academy, W Series Legacy),
Rolling 3-Year 40-Point Super Licence Engine, Team Operations Board & Silly Season Rumours.
"""
from __future__ import annotations

import random
from typing import Any


SL_POINTS_TABLE: dict[str, list[int]] = {
    "f2":         [40, 40, 40, 30, 20, 10, 8, 6, 4, 3],
    "f3":         [30, 25, 20, 15, 12, 10, 7, 5, 3, 2],
    "f1_academy": [10, 7, 5, 3, 1],
    "w_series":   [15, 12, 10, 7, 5, 3, 2, 1],
}

RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]

# Authentic 2025/2026 Feeder Series & W Series Legacy driver catalog
# (id, name, code3, nat, series, team, age, ovr, pot, sl_prior_pts, academy_link, trait)
FEEDER_ROSTER_SEED: list[tuple[Any, ...]] = [
    # FIA Formula 2
    ("f2_fornaroli", "Leonardo Fornaroli", "FOR", "ITA", "f2", "Invicta Racing", 21, 79, 91, 40, "McLaren", "F3 Champion"),
    ("f2_crawford", "Jak Crawford", "CRA", "USA", "f2", "DAMS Lucas Oil", 21, 78, 88, 36, "Aston Martin", "Quali Specialist"),
    ("f2_browning", "Luke Browning", "BRO", "GBR", "f2", "Hitech TGR", 24, 78, 87, 34, "Williams", "Wet Master"),
    ("f2_beganovic", "Dino Beganovic", "BEG", "SWE", "f2", "Hitech TGR", 22, 77, 89, 32, "Ferrari", "Smooth Operator"),
    ("f2_mini", "Gabriele Minì", "MIN", "ITA", "f2", "PREMA Racing", 21, 77, 90, 34, "Alpine", "Late Braker"),
    ("f2_dunne", "Alexander Dunne", "DUN", "IRL", "f2", "Rodin Motorsport", 20, 77, 91, 28, "McLaren", "Fearless Overtaker"),
    ("f2_verschoor", "Richard Verschoor", "VER2", "NED", "f2", "MP Motorsport", 25, 78, 83, 35, "Independent", "Street Fighter"),
    ("f2_goethe", "Oliver Goethe", "GOE", "GER", "f2", "MP Motorsport", 21, 75, 86, 26, "Red Bull", "Tyre Whisperer"),
    ("f2_montoya", "Sebastián Montoya", "MON", "COL", "f2", "PREMA Racing", 21, 75, 87, 24, "Independent", "Aggressive"),
    ("f2_stenshorne", "Martinius Stenshorne", "STE", "NOR", "f2", "Trident", 20, 75, 89, 25, "McLaren", "Ice Cold"),
    ("f2_durksen", "Joshua Dürksen", "DUR", "PAR", "f2", "AIX Racing", 22, 76, 86, 22, "Independent", "Giant Killer"),
    ("f2_tsolov", "Nikola Tsolov", "TSO", "BUL", "f2", "Campos Racing", 19, 76, 91, 26, "Red Bull", "Wonderkid"),
    ("f2_boya", "Mari Boya", "BOY", "ESP", "f2", "Campos Racing", 22, 75, 85, 22, "Aston Martin", "Consistent"),
    ("f2_miyata", "Ritomo Miyata", "MIY", "JPN", "f2", "ART Grand Prix", 26, 77, 84, 40, "Haas", "Super Formula Champ"),
    ("f2_herta", "Colton Herta", "HER", "USA", "f2", "Cadillac Test / F2", 26, 81, 88, 38, "Cadillac", "IndyCar Ace"),
    ("f2_maini", "Kush Maini", "MAI", "IND", "f2", "DAMS Lucas Oil", 25, 75, 83, 24, "Alpine", "Quali Punch"),

    # FIA Formula 3
    ("f3_camara", "Rafael Câmara", "CAM", "BRA", "f3", "Trident", 20, 74, 92, 24, "Ferrari", "FRECA Champion"),
    ("f3_tramnitz", "Tim Tramnitz", "TRA", "GER", "f3", "MP Motorsport", 21, 73, 87, 20, "Red Bull", "Consistent"),
    ("f3_taponen", "Tuukka Taponen", "TAP", "FIN", "f3", "ART Grand Prix", 19, 73, 91, 22, "Ferrari", "Flying Finn"),
    ("f3_stromsted", "Noah Strømsted", "STR", "DEN", "f3", "Trident", 18, 72, 90, 16, "Mercedes", "Prodigy"),
    ("f3_slater", "Freddie Slater", "SLA", "GBR", "f3", "PREMA Racing", 17, 73, 94, 18, "Independent", "Generational Talent"),
    ("f3_badoer", "Brando Badoer", "BAD", "ITA", "f3", "PREMA Racing", 19, 71, 86, 15, "McLaren", "Racing Pedigree"),
    ("f3_ugochukwu", "Ugo Ugochukwu", "UGO", "USA", "f3", "PREMA Racing", 18, 72, 89, 18, "McLaren", "Macau Winner"),
    ("f3_leon", "Noel León", "LEO", "MEX", "f3", "PREMA Racing", 21, 72, 86, 19, "Independent", "Clutch Racer"),
    ("f3_wurz", "Charlie Wurz", "WUR", "AUT", "f3", "Trident", 20, 71, 85, 14, "Independent", "Technical Feedback"),
    ("f3_bilinski", "Roman Bilinski", "BIL", "POL", "f3", "Rodin Motorsport", 22, 72, 85, 16, "Independent", "Racecraft"),

    # F1 Academy
    ("f1a_pin", "Doriane Pin", "PIN", "FRA", "f1_academy", "PREMA (Mercedes)", 22, 74, 88, 22, "Mercedes", "Pocket Rocket"),
    ("f1a_weug", "Maya Weug", "WEU", "NED", "f1_academy", "MP (Ferrari)", 21, 73, 87, 19, "Ferrari", "Precision"),
    ("f1a_chambers", "Chloe Chambers", "CHA", "USA", "f1_academy", "Campos (Haas)", 21, 72, 86, 16, "Haas", "Smooth Pace"),
    ("f1a_lloyd", "Ella Lloyd", "LLO", "GBR", "f1_academy", "Rodin (McLaren)", 20, 71, 87, 14, "McLaren", "Rising Star"),
    ("f1a_gademan", "Nina Gademan", "GAD", "NED", "f1_academy", "PREMA (Alpine)", 22, 70, 84, 12, "Alpine", "Fearless"),
    ("f1a_hausmann", "Tina Hausmann", "HAU", "SUI", "f1_academy", "PREMA (Aston Martin)", 19, 70, 85, 11, "Aston Martin", "Composed"),
    ("f1a_palmowski", "Alisha Palmowski", "PAL", "GBR", "f1_academy", "Campos (Red Bull)", 19, 71, 87, 13, "Red Bull", "Quali Ace"),
    ("f1a_block", "Lia Block", "BLO", "USA", "f1_academy", "ART (Williams)", 19, 69, 84, 10, "Williams", "Car Control"),

    # W Series Legacy & Graduates
    ("ws_chadwick", "Jamie Chadwick", "CHD", "GBR", "w_series", "3× W Series Champion", 27, 76, 84, 32, "Williams", "3× W Series Champ"),
    ("ws_pulling", "Abbi Pulling", "PUL", "GBR", "w_series", "F1 Academy Champ / GB3", 23, 75, 88, 26, "Alpine", "2024 F1A Champion"),
    ("ws_powell", "Alice Powell", "POW", "GBR", "w_series", "W Series Vice-Champ", 33, 73, 79, 24, "Alpine", "Mentor & Tester"),
    ("ws_visser", "Beitske Visser", "VIS", "NED", "w_series", "W Series Runner-Up", 31, 73, 79, 22, "Independent", "Endurance Pace"),
]


SERIES_META: dict[str, dict[str, Any]] = {
    "f2":         {"id": "f2", "name": "FIA Formula 2", "short": "F2", "color": "#38bdf8", "sl_top": 40, "desc": "Direct gateway to Formula 1 — Top 3 earn all 40 Super Licence points instantly."},
    "f3":         {"id": "f3", "name": "FIA Formula 3", "short": "F3", "color": "#f97316", "sl_top": 30, "desc": "Ultra-competitive 30-car junior proving ground — Champion earns 30 SL points."},
    "f1_academy": {"id": "f1_academy", "name": "F1 Academy", "short": "F1A", "color": "#ec4899", "sl_top": 10, "desc": "All-female single-seater championship backed by all 10 F1 teams."},
    "w_series":   {"id": "w_series", "name": "W Series Legacy", "short": "WS", "color": "#a855f7", "sl_top": 15, "desc": "Pioneering 2019–2022 championship alumni & graduates active in global motorsport."},
}


def build_initial_feeders() -> dict[str, Any]:
    drivers: list[dict[str, Any]] = []
    for row in FEEDER_ROSTER_SEED:
        fid, name, code3, nat, ser, team, age, ovr, pot, sl_pts, acad, trait = row
        drivers.append({
            "id": fid,
            "name": name,
            "code3": code3,
            "nationality": nat,
            "series": ser,
            "team": team,
            "age": age,
            "overall": ovr,
            "potential": pot,
            "sl_points": sl_pts,
            "sl_eligible": sl_pts >= 40,
            "academy": acad,
            "trait": trait,
            "season_pts": 0,
            "season_wins": 0,
            "season_podiums": 0,
            "recruited": False,
        })
    return {
        "rounds_completed": 0,
        "series_meta": SERIES_META,
        "drivers": drivers,
    }


def ensure_feeder_state(state: dict[str, Any]) -> dict[str, Any]:
    if not state.get("feeders") or not state["feeders"].get("drivers"):
        state["feeders"] = build_initial_feeders()
    return state["feeders"]


def simulate_feeder_round(state: dict[str, Any]) -> dict[str, Any]:
    """Simulate 1 race weekend across F2, F3 & F1 Academy and update projected Super Licence points."""
    feed = ensure_feeder_state(state)
    feed["rounds_completed"] = int(feed.get("rounds_completed") or 0) + 1
    winners: dict[str, str] = {}

    for ser in ("f2", "f3", "f1_academy"):
        grid = [d for d in feed["drivers"] if d["series"] == ser and not d.get("recruited")]
        if not grid:
            continue
        scored = sorted(
            grid,
            key=lambda d: -(float(d["overall"]) + random.gauss(0, 4.2)),
        )
        for pos, drv in enumerate(scored):
            if pos < len(RACE_POINTS):
                drv["season_pts"] = int(drv.get("season_pts") or 0) + RACE_POINTS[pos]
            if pos == 0:
                drv["season_wins"] = int(drv.get("season_wins") or 0) + 1
                winners[ser] = drv["name"]
            if pos < 3:
                drv["season_podiums"] = int(drv.get("season_podiums") or 0) + 1
        # Update live projected SL points based on current championship standing
        ranked = sorted(grid, key=lambda d: (-int(d.get("season_pts") or 0), -int(d.get("season_wins") or 0), -float(d["overall"])))
        sl_tbl = SL_POINTS_TABLE.get(ser, [])
        for r_idx, drv in enumerate(ranked):
            bonus_sl = sl_tbl[r_idx] if r_idx < len(sl_tbl) else 0
            # Rolling 3-year projection: keep base prior points + 35% of current season pace
            proj = min(60, int(drv.get("sl_points") or 0) + (2 if r_idx == 0 else (1 if r_idx <= 2 else 0)))
            drv["sl_points"] = proj
            drv["projected_sl"] = min(80, proj + bonus_sl)
            drv["sl_eligible"] = drv["sl_points"] >= 40 or (feed["rounds_completed"] >= 6 and drv["projected_sl"] >= 40)

    return {"rounds_completed": feed["rounds_completed"], "winners": winners}


def recruit_feeder_driver(state: dict[str, Any], feeder_id: str) -> tuple[bool, str]:
    """Recruit a Feeder Series star into your Career Driver Market / Junior Academy!"""
    feed = ensure_feeder_state(state)
    target = next((d for d in feed["drivers"] if d["id"] == feeder_id), None)
    if not target:
        return False, "Feeder driver not found."
    if target.get("recruited"):
        return False, f"{target['name']} is already in the F1 Driver Market!"

    pt = next((t for t in state.get("teams") or [] if t["id"] == state.get("player_team_id")), None)
    if not pt:
        return False, "Player team not found."

    fee = 1.2 if target["series"] == "f2" else 0.7
    if float(pt.get("cash_m") or 0) < fee:
        return False, f"Need ${fee:.1f}M academy buyout to recruit {target['name']}."

    pt["cash_m"] = round(float(pt["cash_m"]) - fee, 2)
    target["recruited"] = True
    target["academy"] = pt["name"]

    # Insert directly into Career drivers dict so user can offer a Race Seat or Reserve Seat!
    did = f"junior_{target['id']}"
    ovr = float(target["overall"])
    pot = int(target["potential"])
    state["drivers"][did] = {
        "id": did,
        "driver": f"{target['name']} {target['code3']}",
        "clean_name": target["name"],
        "code3": target["code3"],
        "nationality": target["nationality"],
        "age": int(target["age"]),
        "overall": ovr,
        "potential": pot,
        "seasons_exp": 0,
        "wins": 0,
        "podiums": 0,
        "championships": 0,
        "team_id": None,
        "hero_team": f"{target['series'].upper()} · {target['team']}",
        "role": "free_agent",
        "salary_m": round(max(0.8, (ovr - 65) * 0.18), 1),
        "contract_years": 0,
        "morale": 88,
        "xp": 0,
        "scouted": True,
        "trait": target["trait"],
        "sl_points": int(target["sl_points"]),
        "sl_eligible": bool(target["sl_eligible"]),
        "stats": {
            "pace": int(min(94, ovr + 2)),
            "racecraft": int(min(94, ovr)),
            "reliability": int(min(92, ovr + 1)),
            "duels": int(min(94, ovr + 1)),
            "clutch": int(min(94, ovr - 1)),
            "wet": int(min(94, ovr)),
            "dnf_rate": 9,
        },
        "season_pts": 0,
        "season_wins": 0,
        "season_podiums": 0,
        "season_fl": 0,
    }
    if not pt.get("reserve_id"):
        pt["reserve_id"] = did
        state["drivers"][did]["team_id"] = pt["id"]
        state["drivers"][did]["role"] = "reserve"
        state["drivers"][did]["contract_years"] = 2
        msg = f"Signed {target['name']} ({target['series'].upper()}, POT {pot}) as your Reserve & Academy Driver (-${fee:.1f}M)!"
    else:
        msg = f"Recruited {target['name']} ({target['series'].upper()}, POT {pot}) into your F1 Driver Market (-${fee:.1f}M) — ready for contract talks!"
    return True, msg


def build_team_ops_board(state: dict[str, Any]) -> dict[str, Any]:
    """
    Build the 5-Department Team Operations Board & Live Silly Season Rumour Mill
    so Career feels alive, immersive, and goal-oriented with 1-click actions.
    """
    if not state or not state.get("teams"):
        return {"departments": [], "rumours": [], "season_goal": {}}

    pt = next((t for t in state["teams"] if t["id"] == state.get("player_team_id")), state["teams"][0])
    wcc = sorted(state["teams"], key=lambda t: (-t.get("points", 0), -t.get("wins", 0), -t.get("car_overall", 0)))
    wcc_pos = next((i + 1 for i, t in enumerate(wcc) if t["id"] == pt["id"]), len(wcc))
    target_wcc = int(pt.get("board_target_wcc") or 5)
    cash = float(pt.get("cash_m") or 0)
    rd_active = state.get("rd_projects") or []
    scouts_active = state.get("active_scouts") or []
    facs = pt.get("facilities") or {}
    staff = state.get("staff") or {}

    # 1. Chief Technical Officer (R&D & Performance)
    if not rd_active and cash >= 3.5:
        cto_status = "warn"
        cto_msg = "R&D wind-tunnel bays are IDLE! Commission a Chassis or Aero upgrade before our rivals pull away."
        cto_action = {"label": "Open Car R&D", "tab": "rd"}
    elif rd_active:
        p0 = rd_active[0]
        cto_status = "ok"
        cto_msg = f"Manufacturing {p0.get('label', 'upgrade')} (+{p0.get('gain', 2)} pts) — ready in {p0.get('rounds_left', 1)} round(s)."
        cto_action = {"label": "View R&D", "tab": "rd"}
    else:
        cto_status = "info"
        cto_msg = f"Car OVR sits at {pt.get('car_overall', 75):.1f}. Save ${max(0, 3.5 - cash):.1f}M for the next upgrade package."
        cto_action = {"label": "Car R&D", "tab": "rd"}

    # 2. Head of Facilities & Pit Crew
    lowest_fac = min(facs.items(), key=lambda kv: kv[1]) if facs else ("aero_tunnel", 1)
    fac_status = "ok" if lowest_fac[1] >= 3 else "info"
    fac_msg = f"Lowest HQ wing: {lowest_fac[0].replace('_', ' ').title()} (Lvl {lowest_fac[1]}/5). Upgrading unlocks faster pit stops, R&D & 3D HQ campus visuals."
    fac_action = {"label": "Upgrade HQ", "tab": "facilities"}

    # 3. Race Engineering & Strategy Lead
    re_name = (staff.get("race_engineer") or {}).get("name") or "Chief Race Engineer"
    re_rating = (staff.get("race_engineer") or {}).get("rating") or 78
    cal = state.get("calendar") or []
    rnd = int(state.get("current_round") or 1)
    nxt_gp = cal[rnd - 1]["name"] if rnd <= len(cal) else "Season Finale"
    re_msg = f"{re_name} (OVR {re_rating}) is prepping baseline setup & tyre curves for {nxt_gp}. Ready for Free Practice."
    re_action = {"label": "Go to Track", "action": "race"}

    # 4. Head of Scouting & Junior Academy
    feed = ensure_feeder_state(state)
    f2_leader = sorted([d for d in feed["drivers"] if d["series"] == "f2"], key=lambda d: (-int(d.get("season_pts") or 0), -float(d["overall"])))
    star_name = f2_leader[0]["name"] if f2_leader else "F2 Leader"
    sc_status = "info" if scouts_active else "warn"
    sc_msg = (
        f"Tracking {len(scouts_active)} driver dossier(s). In F2, {star_name} is turning heads — check the Junior Hub!"
        if scouts_active
        else f"No active F1 scouts deployed! Plus {star_name} is dominating Formula 2 with Super Licence points."
    )
    sc_action = {"label": "Junior & Feeders", "tab": "feeders"}

    # 5. Commercial & Board Liaison
    board_conf = int(pt.get("board_confidence") or 75)
    on_track = wcc_pos <= target_wcc
    fin_status = "ok" if on_track and cash >= 10 else "warn"
    fin_msg = f"P{wcc_pos} in WCC (Board Target: P{target_wcc}) · Budget ${cash:.1f}M · Board Confidence {board_conf}%."
    fin_action = {"label": "Finances", "tab": "standings"}

    # Live Silly Season Rumour Mill (dynamic from expiring contracts + feeder standouts!)
    rumours: list[dict[str, str]] = []
    expiring = [
        d for d in (state.get("drivers") or {}).values()
        if d.get("team_id") and int(d.get("contract_years") or 1) <= 1 and d.get("role") == "race"
    ]
    expiring.sort(key=lambda d: -float(d.get("overall") or 0))
    team_map = {t["id"]: t["name"] for t in state["teams"]}
    for drv in expiring[:3]:
        tname = team_map.get(drv["team_id"], "their team")
        rumours.append({
            "tag": "CONTRACT",
            "text": f"{drv['clean_name']} ({tname}) enters final contract year — paddock rivals monitoring closely!",
        })
    if f2_leader:
        rumours.append({
            "tag": "F2 PROMOTION",
            "text": f"Paddock buzz: {f2_leader[0]['name']} ({f2_leader[0]['sl_points']} SL pts) linked with an F1 seat next season!",
        })

    return {
        "season_goal": {
            "wcc_pos": wcc_pos,
            "target_wcc": target_wcc,
            "on_track": on_track,
            "board_confidence": board_conf,
            "round": rnd,
            "total_rounds": len(cal),
        },
        "departments": [
            {"id": "cto", "role": "Chief Technical Officer", "icon": "fa-cogs", "status": cto_status, "message": cto_msg, "cta": cto_action},
            {"id": "fac", "role": "Factory & Pit Operations", "icon": "fa-industry", "status": fac_status, "message": fac_msg, "cta": fac_action},
            {"id": "eng", "role": "Trackside Engineering", "icon": "fa-headset", "status": "ok", "message": re_msg, "cta": re_action},
            {"id": "scout", "role": "Scouting & Junior Academy", "icon": "fa-graduation-cap", "status": sc_status, "message": sc_msg, "cta": sc_action},
            {"id": "board", "role": "Board & Commercial", "icon": "fa-landmark", "status": fin_status, "message": fin_msg, "cta": fin_action},
        ],
        "rumours": rumours,
    }
