"""
Pit Wall: The Ladder — Meso Economy, Spare-Parts Inventory, Inbox Dilemmas & F1 Paddock Politics.

Isolated from f1data/ladder_engine.py to keep the core engine lean:
  1. Tier-Scaled Spare Parts Inventory (F4–F1; Karting exempt) with crash deduction
     and emergency overnight manufacture fees that count toward the FIA F1 Cost Cap.
  2. Interactive Between-Race Inbox Dilemmas (F1 Academy KPI check-ins, sponsor
     bonus targets, pay-driver installment demands, and FIA Technical Directives).
  3. Authentic FIA regulatory phrasing & steward precedents pulled from data/fia_docs.sqlite.
  4. Tier 5 (F1) Commission Governance Bridge wiring paddock_profiles.py and
     regulation_architect.py so real AI Team Principals vote via leadership style,
     car strengths, and job stress rather than random coin flips.
"""
from __future__ import annotations

import copy
import json
import random
import sqlite3
from pathlib import Path
from typing import Any, Callable

from . import paddock_profiles as pp
from . import regulation_architect as ra

_BASE_DIR = Path(__file__).resolve().parent.parent
_FIA_DOCS_DB = _BASE_DIR / "data" / "fia_docs.sqlite"


# =============================================================================
# 1. TIER-SCALED SPARE PARTS INVENTORY (F4+)
# =============================================================================

SPARE_PARTS_CATALOG: dict[str, list[dict[str, Any]]] = {
    "karting": [],
    "f4": [
        {"id": "wing_kit", "name": "Wing & Nose Kit", "short": "WING", "initial": 2, "cost_k": 8.0, "weight": 0.70},
        {"id": "chassis", "name": "Tub & Wishbone Kit", "short": "CHASSIS", "initial": 1, "cost_k": 22.0, "weight": 0.30},
    ],
    "f3": [
        {"id": "wing_kit", "name": "Aero Wing Kit", "short": "WING", "initial": 2, "cost_k": 24.0, "weight": 0.68},
        {"id": "chassis", "name": "Dallara Chassis Kit", "short": "CHASSIS", "initial": 1, "cost_k": 68.0, "weight": 0.32},
    ],
    "f2": [
        {"id": "wing_kit", "name": "Carbon Wing Kit", "short": "WING", "initial": 2, "cost_k": 65.0, "weight": 0.65},
        {"id": "chassis", "name": "Monocoque & Floor Kit", "short": "CHASSIS", "initial": 1, "cost_k": 180.0, "weight": 0.35},
    ],
    "f1": [
        {"id": "front_wing", "name": "Front Wing Assembly", "short": "F-WING", "initial": 3, "cost_k": 420.0, "weight": 0.42},
        {"id": "suspension", "name": "Suspension Wishbones", "short": "SUSP", "initial": 2, "cost_k": 520.0, "weight": 0.28},
        {"id": "floor", "name": "Venturi Floor Assembly", "short": "FLOOR", "initial": 2, "cost_k": 780.0, "weight": 0.20},
        {"id": "chassis_tub", "name": "Carbon Chassis Tub", "short": "TUB", "initial": 1, "cost_k": 1450.0, "weight": 0.10},
    ],
}

EMERGENCY_MULTIPLIER = 1.45


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def _workshop_discount(state: dict[str, Any]) -> float:
    fac = state.get("facilities") or {}
    ws_lv = int(fac.get("composite_factory", fac.get("regional_workshop", 1)))
    return max(0.55, 1.0 - (ws_lv - 1) * 0.10)


def ensure_spare_parts(state: dict[str, Any], *, reset: bool = False) -> dict[str, int]:
    """Ensure state['economy']['spare_parts'] matches the current tier's parts catalog."""
    tier = str(state.get("tier") or "karting")
    cat = SPARE_PARTS_CATALOG.get(tier, [])
    eco = state.setdefault("economy", {})
    cur = eco.get("spare_parts")
    valid_ids = [p["id"] for p in cat]

    if reset or not isinstance(cur, dict) or set(cur.keys()) != set(valid_ids):
        eco["spare_parts"] = {p["id"]: int(p["initial"]) for p in cat}
    return eco["spare_parts"]


def get_spare_parts_view(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Serialize tier-scaled spare parts stock + discounted manufacture prices for the UI."""
    tier = str(state.get("tier") or "karting")
    cat = SPARE_PARTS_CATALOG.get(tier, [])
    stock = ensure_spare_parts(state)
    disc = _workshop_discount(state)
    out: list[dict[str, Any]] = []
    for p in cat:
        unit_k = round(float(p["cost_k"]) * disc, 1)
        out.append({
            "id": p["id"],
            "name": p["name"],
            "short": p["short"],
            "stock": int(stock.get(p["id"], 0)),
            "unit_cost_k": unit_k,
            "emergency_cost_k": round(unit_k * EMERGENCY_MULTIPLIER, 1),
            "cap_counts": tier == "f1",
        })
    return out


def manufacture_spare_part(
    state: dict[str, Any],
    part_id: str,
    record_ledger_fn: Callable[..., None],
) -> tuple[bool, str]:
    """Build 1 spare part into inventory. Counts toward F1 Cost Cap in Tier 5."""
    tier = str(state.get("tier") or "karting")
    cat = SPARE_PARTS_CATALOG.get(tier, [])
    if not cat:
        return False, "Karting does not track carbon spare-parts inventory."
    spec = next((p for p in cat if p["id"] == part_id), None)
    if not spec:
        return False, f"Part '{part_id}' is not valid for {tier.upper()}."

    stock = ensure_spare_parts(state)
    cost_k = round(float(spec["cost_k"]) * _workshop_discount(state), 1)
    eco = state["economy"]
    if float(eco.get("cash_k", 0.0)) < cost_k:
        return False, f"Insufficient cash (${cost_k}k required to manufacture {spec['name']})."
    if tier == "f1":
        spent = float(eco.get("cost_cap_spent_k", 0.0))
        limit = float(eco.get("cost_cap_limit_k", 135000.0))
        if spent + cost_k > limit:
            return False, f"FIA Cost Cap Breach Blocked! (${spent:.1f}k + ${cost_k:.1f}k > ${limit:.1f}k cap)."

    record_ledger_fn(state, f"Manufacture Spare: {spec['name']}", -cost_k, cap_counts=True)
    stock[part_id] = int(stock.get(part_id, 0)) + 1
    return True, f"Manufactured 1× {spec['name']} (${cost_k}k · Stock now {stock[part_id]})."


def consume_crash_parts(
    state: dict[str, Any],
    rng: random.Random,
    *,
    heavy: bool = False,
) -> dict[str, Any]:
    """
    Resolve crash damage against spare-parts stock first.
      - If stock > 0: deduct 1 unit from inventory (no emergency manufacture fee).
      - If stock == 0: trigger emergency overnight manufacture (1.45× unit cost),
        which counts toward the F1 Cost Cap when booked to the ledger.
    """
    tier = str(state.get("tier") or "karting")
    cat = SPARE_PARTS_CATALOG.get(tier, [])
    if not cat:
        return {"bill_k": 0.0, "consumed": [], "emergency_parts": [], "labor_k": 0.0}

    stock = ensure_spare_parts(state)
    disc = _workshop_discount(state)
    weights = [float(p["weight"]) for p in cat]
    hit_count = 2 if (heavy and len(cat) > 1) else 1

    # Pick unique damaged parts weighted by crash exposure
    chosen: list[dict[str, Any]] = []
    pool = list(cat)
    pool_w = list(weights)
    for _ in range(min(hit_count, len(pool))):
        pick = rng.choices(pool, weights=pool_w, k=1)[0]
        chosen.append(pick)
        idx = pool.index(pick)
        pool.pop(idx)
        pool_w.pop(idx)

    bill_k = 0.0
    labor_k = 0.0
    consumed: list[str] = []
    emergency_parts: list[dict[str, Any]] = []

    for spec in chosen:
        pid = spec["id"]
        unit_k = round(float(spec["cost_k"]) * disc, 1)
        if int(stock.get(pid, 0)) > 0:
            stock[pid] = int(stock[pid]) - 1
            consumed.append(pid)
            # Minor trackside fitting / scrutineering consumables (~12% of unit cost)
            fit_k = round(unit_k * 0.12, 1)
            labor_k = round(labor_k + fit_k, 1)
            bill_k = round(bill_k + fit_k, 1)
        else:
            em_k = round(unit_k * EMERGENCY_MULTIPLIER, 1)
            bill_k = round(bill_k + em_k, 1)
            emergency_parts.append({"id": pid, "name": spec["name"], "cost_k": em_k})

    return {
        "bill_k": round(bill_k, 1),
        "labor_k": round(labor_k, 1),
        "consumed": consumed,
        "emergency_parts": emergency_parts,
    }


# =============================================================================
# 2. AUTHENTIC FIA DOCS PRECEDENT LOOKUP (data/fia_docs.sqlite)
# =============================================================================

_CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "Aero": ("wing", "floor", "plank", "diffuser", "aero", "bodywork", "flex"),
    "Finance": ("weight", "parc ferme", "technical", "curfew", "component"),
    "Tyres": ("tyre", "pirelli", "compound", "pressure", "wet"),
    "Sporting": ("sprint", "grid", "safety car", "track limits", "collision", "impeding"),
    "Power Unit": ("power unit", "pu ", "ice", "ers", "battery", "gearbox", "fuel"),
}


def fetch_fia_technical_precedent(
    category: str = "Aero",
    *,
    seed: int = 1,
    db_path: Path | None = None,
) -> dict[str, Any]:
    """Pull authentic FIA regulatory phrasing & precedent from data/fia_docs.sqlite."""
    path = db_path or _FIA_DOCS_DB
    kws = _CATEGORY_KEYWORDS.get(category, ("technical", "article", "regulation"))

    if path.exists():
        try:
            con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            con.row_factory = sqlite3.Row

            # 1. Try detailed FIA Steward / Technical decisions with rules_referenced
            where_parts = " OR ".join(["LOWER(title || ' ' || COALESCE(offence,'') || ' ' || COALESCE(fact,'')) LIKE ?" for _ in kws])
            params = [f"%{kw}%" for kw in kws]
            rows = con.execute(
                f"""
                SELECT d.year, d.event_slug, COALESCE(e.event_name, d.event_slug) AS event_name,
                       d.doc_number, d.doc_type, COALESCE(doc.title, d.offence, 'FIA Decision') AS title,
                       d.fact, d.offence, d.decision, d.rules_referenced_json
                FROM fia_decisions_detail d
                LEFT JOIN fia_events e ON e.year = d.year AND e.event_slug = d.event_slug
                LEFT JOIN fia_documents doc ON doc.year = d.year AND doc.event_slug = d.event_slug AND doc.slug = d.slug
                WHERE ({where_parts})
                  AND (d.rules_referenced_json IS NOT NULL AND d.rules_referenced_json != '[]')
                ORDER BY d.year DESC, d.doc_number DESC
                LIMIT 25
                """,
                params,
            ).fetchall()

            if rows:
                pick = rows[abs(int(seed)) % len(rows)]
                try:
                    rules = json.loads(pick["rules_referenced_json"] or "[]")
                    if not isinstance(rules, list):
                        rules = []
                except Exception:
                    rules = []
                excerpt = str(pick["offence"] or pick["fact"] or pick["decision"] or "").strip()
                if len(excerpt) > 170:
                    excerpt = excerpt[:167].rstrip() + "..."
                con.close()
                return {
                    "source": "fia_docs.sqlite",
                    "year": int(pick["year"]),
                    "event_name": str(pick["event_name"]),
                    "doc_number": str(pick["doc_number"] or ""),
                    "title": str(pick["title"]),
                    "rules_referenced": [str(r) for r in rules[:3]],
                    "excerpt": excerpt or "Official FIA technical & sporting precedent on record.",
                }

            # 2. Fallback to fia_documents table (e.g., Technical Delegate Reports / Scrutineering)
            doc_rows = con.execute(
                """
                SELECT year, event_name, doc_number, title, doc_type
                FROM fia_documents
                WHERE LOWER(title) LIKE '%technical%' OR LOWER(title) LIKE '%scrutineering%' OR LOWER(title) LIKE '%power unit%'
                ORDER BY year DESC
                LIMIT 20
                """
            ).fetchall()
            con.close()
            if doc_rows:
                pick = doc_rows[abs(int(seed)) % len(doc_rows)]
                return {
                    "source": "fia_docs.sqlite",
                    "year": int(pick["year"]),
                    "event_name": str(pick["event_name"]),
                    "doc_number": str(pick["doc_number"] or ""),
                    "title": str(pick["title"]),
                    "rules_referenced": ["FIA Technical Regulations"],
                    "excerpt": f"Doc #{pick['doc_number']} ({pick['year']} {pick['event_name']}): {pick['title']}.",
                }
        except Exception:
            pass

    return {
        "source": "fallback",
        "year": 2026,
        "event_name": "FIA World Motor Sport Council",
        "doc_number": "TD-018",
        "title": f"Technical Directive — {category} Compliance Review",
        "rules_referenced": ["Article 3.15 FIA Technical Regulations"],
        "excerpt": "Mandatory aerodynamic & operational compliance review under Article 3.15.",
    }


# =============================================================================
# 3. INTERACTIVE INBOX DILEMMAS
# =============================================================================

def ensure_dilemmas(state: dict[str, Any]) -> list[dict[str, Any]]:
    dils = state.get("dilemmas")
    if not isinstance(dils, list):
        state["dilemmas"] = []
    return state["dilemmas"]


def generate_round_dilemma(
    state: dict[str, Any],
    rng: random.Random,
    *,
    force_kind: str | None = None,
) -> dict[str, Any] | None:
    """Generate an actionable between-race inbox dilemma scaled to the player's tier & contracts."""
    dils = ensure_dilemmas(state)
    # Keep at most 2 unresolved dilemmas at once so the inbox never overflows
    if not force_kind and sum(1 for d in dils if not d.get("resolved")) >= 2:
        return None

    tier = str(state.get("tier") or "karting")
    rnd = int(state.get("round") or 1)
    season = int(state.get("season") or 1)
    wk = state.get("weekend") or {}
    next_gp = str(wk.get("circuit_name") or "Next Round")
    eco = state.get("economy") or {}
    spon_k = max(12.0, float(eco.get("sponsor_per_round_k") or 20.0))

    p_drvs = [state["drivers"][did] for did in state["player"]["driver_ids"] if did in state["drivers"]]
    pay_drv = next((d for d in p_drvs if float(d.get("pay_driver_k") or 0.0) > 0), None)

    candidates: list[str] = []
    if force_kind:
        candidates = [force_kind]
    else:
        if state.get("academy_deal"):
            candidates.append("academy_kpi")
        if tier == "f1":
            candidates.append("fia_td")
        if pay_drv or tier in ("f4", "f3", "f2"):
            candidates.append("pay_driver")
        candidates.append("sponsor_bonus")

    kind = rng.choice(candidates)
    did_str = f"dil_s{season}_r{rnd}_{kind}_{len(dils) + 1}"

    if kind == "academy_kpi" and state.get("academy_deal"):
        ad = state["academy_deal"]
        bonus_k = round(float(ad.get("funding_k", 400.0)) * 0.16, 1)
        pen_k = round(float(ad.get("penalty_k", 160.0)) * 0.25, 1)
        junior = str(ad.get("junior_name") or "Academy Junior")
        f1_team = str(ad.get("f1_team") or "F1 Academy")
        dilemma = {
            "id": did_str,
            "kind": "academy_kpi",
            "round": rnd,
            "sender": f1_team,
            "tag": "ACADEMY KPI",
            "title": f"{f1_team} Upgrade Priority Demand",
            "body": f"{f1_team} wants {junior} to receive priority fresh aero parts & first pit-stop call at {next_gp} to protect their KPI target (P{ad.get('kpi_min_pos', 5)}).",
            "resolved": False,
            "chosen_id": None,
            "choices": [
                {
                    "id": "prioritize_junior",
                    "label": f"Prioritize {junior} (+${bonus_k:.0f}k Funding · Seat #1 Morale -3)",
                    "effects": {"cash_k": bonus_k, "cap_counts": False, "rep": 1.0, "seat2_trust": 5, "seat1_morale": -3},
                },
                {
                    "id": "equal_treatment",
                    "label": f"Enforce Equal Status (-${pen_k:.0f}k Clawback · Seat #1 Trust +4)",
                    "effects": {"cash_k": -pen_k, "cap_counts": False, "rep": 1.5, "seat1_trust": 4, "seat2_morale": -2},
                },
            ],
        }
    elif kind == "fia_td" and tier == "f1":
        prec = fetch_fia_technical_precedent("Aero", seed=season * 31 + rnd * 7)
        comply_k = round(min(2200.0, max(650.0, spon_k * 0.12)), 1)
        rules_txt = ", ".join(prec.get("rules_referenced") or ["Article 3.15"])
        dilemma = {
            "id": did_str,
            "kind": "fia_td",
            "round": rnd,
            "sender": "FIA Technical Delegate",
            "tag": "FIA DIRECTIVE",
            "title": f"Technical Directive: {prec['title'][:46]}",
            "body": f"Citing {prec['year']} {prec['event_name']} ({rules_txt}): \"{prec['excerpt']}\" Scrutineers request floor & wing deflection verification before {next_gp}.",
            "precedent": prec,
            "resolved": False,
            "chosen_id": None,
            "choices": [
                {
                    "id": "comply_early",
                    "label": f"Stiffen Floor Early (-${comply_k:.0f}k Cost Cap · +2% Correlation)",
                    "effects": {"cash_k": -comply_k, "cap_counts": True, "rep": 2.0, "correlation": 2.0},
                },
                {
                    "id": "contest_directive",
                    "label": "Contest Interpretation ($0 · +1.0 Downforce · FIA Scrutiny)",
                    "effects": {"cash_k": 0.0, "cap_counts": False, "rep": -1.5, "philosophy_vec": ("low_speed_df", 1.0)},
                },
            ],
        }
    elif kind == "pay_driver":
        target_drv = pay_drv or (p_drvs[-1] if p_drvs else {"name": "Seat #2 Driver"})
        inj_k = round(max(18.0, float(target_drv.get("pay_driver_k") or spon_k * 1.4) * 0.28), 1)
        dilemma = {
            "id": did_str,
            "kind": "pay_driver",
            "round": rnd,
            "sender": f"{target_drv['name']} Backers",
            "tag": "PAY DRIVER",
            "title": "Accelerated Sponsor Installment Offer",
            "body": f"Personal backers for {target_drv['name']} offer a ${inj_k:.0f}k cash advance if you tailor {next_gp} setup direction toward their driving style.",
            "resolved": False,
            "chosen_id": None,
            "choices": [
                {
                    "id": "grant_focus",
                    "label": f"Accept Advance (+${inj_k:.0f}k Cash · Backer Happy · -3% Setup)",
                    "effects": {"cash_k": inj_k, "cap_counts": False, "rep": -0.5, "seat2_morale": 5, "setup_conf": -3.0},
                },
                {
                    "id": "refuse_backers",
                    "label": "Refuse — Pure Engineering Merit (+1.5 Rep · +2 Team Trust)",
                    "effects": {"cash_k": 0.0, "cap_counts": False, "rep": 1.5, "seat1_trust": 2, "seat2_trust": 1},
                },
            ],
        }
    else:
        adv_k = round(spon_k * 0.48, 1)
        safe_k = round(spon_k * 0.14, 1)
        dilemma = {
            "id": did_str,
            "kind": "sponsor_bonus",
            "round": rnd,
            "sender": "Commercial Partners",
            "tag": "SPONSOR",
            "title": f"Hospitality & Bonus Clause — {next_gp}",
            "body": f"Title sponsors propose a media-heavy activation ahead of {next_gp} with a front-loaded ${adv_k:.0f}k payout if the drivers commit extra PR hours.",
            "resolved": False,
            "chosen_id": None,
            "choices": [
                {
                    "id": "accept_target",
                    "label": f"Sign Activation (+${adv_k:.0f}k Cash · +1.5 Rep · -2 Driver Morale)",
                    "effects": {"cash_k": adv_k, "cap_counts": False, "rep": 1.5, "seat1_morale": -2, "seat2_morale": -2},
                },
                {
                    "id": "decline_safe",
                    "label": f"Keep Drivers Focused (+${safe_k:.0f}k Retainer · +2% Setup Focus)",
                    "effects": {"cash_k": safe_k, "cap_counts": False, "rep": 0.5, "setup_conf": 2.0},
                },
            ],
        }

    dils.insert(0, dilemma)
    state["dilemmas"] = dils[:8]
    return dilemma


def resolve_dilemma(
    state: dict[str, Any],
    dilemma_id: str,
    choice_id: str,
    record_ledger_fn: Callable[..., None],
    add_inbox_fn: Callable[..., None],
) -> tuple[bool, str]:
    """Resolve an active interactive inbox dilemma and apply its economic/morale/technical effects."""
    dils = ensure_dilemmas(state)
    dil = next((d for d in dils if d.get("id") == dilemma_id), None)
    if not dil:
        return False, "Inbox dilemma not found."
    if dil.get("resolved"):
        return False, "This dilemma has already been resolved."
    choice = next((c for c in dil.get("choices", []) if c.get("id") == choice_id), None)
    if not choice:
        return False, "Invalid decision option."

    eff = choice.get("effects") or {}
    cash_k = float(eff.get("cash_k") or 0.0)
    cap_counts = bool(eff.get("cap_counts", False))

    if cash_k < 0:
        if float(state["economy"]["cash_k"]) < abs(cash_k):
            return False, f"Insufficient cash (${abs(cash_k):.1f}k required)."
        if state["tier"] == "f1" and cap_counts:
            spent = float(state["economy"].get("cost_cap_spent_k", 0.0))
            limit = float(state["economy"].get("cost_cap_limit_k", 135000.0))
            if spent + abs(cash_k) > limit:
                return False, f"FIA Cost Cap Breach Blocked (${spent:.1f}k + ${abs(cash_k):.1f}k > ${limit:.1f}k)."

    if cash_k != 0.0:
        record_ledger_fn(state, f"Decision: {dil['title'][:36]}", cash_k, cap_counts=cap_counts)

    if eff.get("rep"):
        state["player"]["reputation"] = round(_clamp(float(state["player"]["reputation"]) + float(eff["rep"]), 5.0, 99.0), 1)

    p_ids = state["player"].get("driver_ids") or []
    if len(p_ids) >= 1 and p_ids[0] in state["drivers"]:
        d1 = state["drivers"][p_ids[0]]
        if eff.get("seat1_trust"):
            d1["trust"] = int(_clamp(d1["trust"] + int(eff["seat1_trust"]), 20, 99))
        if eff.get("seat1_morale"):
            d1["morale"] = int(_clamp(d1["morale"] + int(eff["seat1_morale"]), 20, 99))
    if len(p_ids) >= 2 and p_ids[1] in state["drivers"]:
        d2 = state["drivers"][p_ids[1]]
        if eff.get("seat2_trust"):
            d2["trust"] = int(_clamp(d2["trust"] + int(eff["seat2_trust"]), 20, 99))
        if eff.get("seat2_morale"):
            d2["morale"] = int(_clamp(d2["morale"] + int(eff["seat2_morale"]), 20, 99))

    if eff.get("setup_conf") and "weekend" in state:
        state["weekend"]["setup_confidence"] = round(_clamp(float(state["weekend"].get("setup_confidence", 55.0)) + float(eff["setup_conf"]), 35.0, 99.0), 1)
    if eff.get("correlation") and "rd" in state:
        state["rd"]["correlation_accuracy"] = round(_clamp(float(state["rd"].get("correlation_accuracy", 74.0)) + float(eff["correlation"]), 50.0, 98.0), 1)
    if eff.get("philosophy_vec") and "rd" in state:
        vec_k, delta_v = eff["philosophy_vec"]
        if vec_k in state["rd"]["philosophy"]:
            state["rd"]["philosophy"][vec_k] = round(_clamp(float(state["rd"]["philosophy"][vec_k]) + float(delta_v), 55.0, 99.0), 1)

    dil["resolved"] = True
    dil["chosen_id"] = choice_id
    dil["chosen_label"] = choice["label"]
    add_inbox_fn(state, dil["sender"], dil["tag"], f"Resolved: {dil['title']}", f"Decision executed: {choice['label']}")
    return True, f"Resolved '{dil['title']}' — {choice['label']}"


# =============================================================================
# 4. REAL F1 PADDOCK POLITICS BRIDGE (paddock_profiles + regulation_architect)
# =============================================================================

def ensure_f1_paddock_roster(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Ensure state['fia_governance']['tp_roster'] holds live Team Principal dossiers."""
    gov = state.setdefault("fia_governance", {})
    roster = gov.get("tp_roster")
    if not isinstance(roster, list) or not roster:
        roster = pp.initial_tp_roster()
        gov["tp_roster"] = roster

    # Sync live car_rating & principal names from Ladder's F1 grid into TP strengths
    f1_teams = (state.get("tiers") or {}).get("f1", {}).get("teams") or []
    by_low = {str(t["name"]).lower(): t for t in f1_teams}
    for tp in roster:
        tlow = str(tp.get("team") or "").lower()
        match = next((tm for k, tm in by_low.items() if tlow in k or k in tlow), None)
        if match:
            cr = float(match.get("car_rating", 82.0))
            st = tp.setdefault("strengths", {"aero": 82, "power": 82, "budget": 82, "chassis": 82})
            st["aero"] = int(round(_clamp((st.get("aero", 82) * 0.55) + cr * 0.45, 65, 98)))
            st["chassis"] = int(round(_clamp((st.get("chassis", 82) * 0.55) + cr * 0.45, 65, 98)))
            if match.get("principal") and not match.get("is_player"):
                tp["name"] = str(match["principal"])
    return roster


def step_ladder_paddock_stress(state: dict[str, Any], *, season_end: bool = False) -> list[dict[str, Any]]:
    """Update real F1 TP job stress & board confidence from live Ladder F1 standings."""
    roster = ensure_f1_paddock_roster(state)
    f1_teams = (state.get("tiers") or {}).get("f1", {}).get("teams") or []
    ordered = [t["name"] for t in sorted(f1_teams, key=lambda x: (-float(x.get("points", 0.0)), -float(x.get("car_rating", 80.0))))]
    res = pp.step_paddock_stress(roster, team_standings_order=ordered, season_end=season_end)
    return list(res.get("events") or [])


def _proposal_to_formula_eval(state: dict[str, Any], prop: dict[str, Any]) -> dict[str, Any]:
    """Translate a Ladder FIA proposal into a real regulation_architect formula evaluation."""
    formula = copy.deepcopy(ra.DEFAULT_2026_FORMULA)
    formula["id"] = str(prop.get("id") or "ladder_fia_bill")
    formula["name"] = str(prop.get("title") or "FIA Regulation Proposal")
    formula["year"] = int(state.get("year") or 2026) + 1

    imp = prop.get("impact") or {}
    cat = str(prop.get("category") or "Aero")
    cur_cap_m = int(round(float(state["economy"].get("cost_cap_limit_k", 135000.0)) / 1000.0))

    if "cost_cap_delta_k" in imp:
        formula["governance"]["cost_cap_m"] = int(_clamp(cur_cap_m + float(imp["cost_cap_delta_k"]) / 1000.0, 95, 220))
    else:
        formula["governance"]["cost_cap_m"] = int(_clamp(cur_cap_m, 95, 220))

    if cat == "Aero" or "low_speed_df" in imp:
        formula["dimensions"]["front_wing_mm"] = 1650
        formula["dimensions"]["ride_height_mm"] = 42
        formula["active_tools"] = ["active_aero", "manual_override"]
    elif cat == "Power Unit":
        formula["powertrain"]["ers_kw"] = 425
        formula["powertrain"]["ice_share_pct"] = 45
        formula["active_tools"] = ["active_aero", "manual_override", "kers"]
    elif cat == "Tyres":
        formula["dimensions"]["min_weight_kg"] = 790
        formula["dimensions"]["tyre_rim_in"] = 13
    elif cat == "Sporting":
        formula["governance"]["points_system"] = "top12_expanded"
        formula["active_tools"] = ["active_aero", "manual_override", "drs"]

    return ra.evaluate_formula_physics(formula)


def vote_fia_proposal_with_paddock(
    state: dict[str, Any],
    vote: str,
    add_inbox_fn: Callable[..., None],
    *,
    lobbied_tp_ids: list[str] | None = None,
) -> tuple[bool, str]:
    """
    Execute a Tier 5 (F1) Commission vote using paddock_profiles.evaluate_commission_bill,
    regulation_architect.evaluate_formula_physics, and authentic fia_docs.sqlite precedents.
    """
    gov = state["fia_governance"]
    if gov.get("voted"):
        return False, "You already voted on this season's FIA proposal."

    prop = gov["active_proposal"]
    roster = ensure_f1_paddock_roster(state)
    player_team_name = str(state["player"]["team_name"])
    # Exclude the player's own team from AI TP voters if they took over a real F1 team
    ai_roster = [tp for tp in roster if str(tp.get("team", "")).lower() != player_team_name.lower()]

    formula_eval = _proposal_to_formula_eval(state, prop)
    bill_res = pp.evaluate_commission_bill(
        ai_roster,
        formula_eval,
        lobbied_tp_ids=lobbied_tp_ids,
        player_team_name=player_team_name,
    )

    # evaluate_commission_bill counts the player's own vote as YES; flip if player voted NO
    yes_votes = int(bill_res["yes_count"])
    no_votes = int(bill_res["no_count"])
    player_yes = str(vote).lower() == "yes"
    if not player_yes:
        yes_votes = max(0, yes_votes - 1)
        no_votes += 1
    needed = int(bill_res["needed"])
    passed = yes_votes >= needed

    precedent = fetch_fia_technical_precedent(
        str(prop.get("category") or "Aero"),
        seed=int(state.get("rng_seed") or 1) + int(state.get("season") or 1) * 19,
    )

    gov["voted"] = True
    gov["last_tally"] = {
        "yes": yes_votes,
        "no": no_votes,
        "needed": needed,
        "passed": passed,
        "player_vote": "YES" if player_yes else "NO",
        "fia_vote": bill_res["fia_vote"],
        "votes": bill_res["votes"],
        "formula_metrics": formula_eval["metrics"],
        "fia_precedent": precedent,
    }

    if passed:
        gov.setdefault("passed_rules", []).append({
            "season": state["season"],
            "title": prop["title"],
            "precedent": f"{precedent['year']} {precedent['event_name']} ({precedent['title']})",
        })
        imp = prop.get("impact") or {}
        if "cost_cap_delta_k" in imp:
            state["economy"]["cost_cap_limit_k"] = max(110000.0, float(state["economy"]["cost_cap_limit_k"]) + float(imp["cost_cap_delta_k"]))
        for vec_k in ("low_speed_df", "high_speed_eff", "drag", "tyre_pres", "cooling"):
            if vec_k in imp and vec_k in state["rd"]["philosophy"]:
                state["rd"]["philosophy"][vec_k] = round(_clamp(float(state["rd"]["philosophy"][vec_k]) + float(imp[vec_k]), 55.0, 99.0), 1)

    rules_ref = ", ".join(precedent.get("rules_referenced") or ["FIA Sporting Code"])
    add_inbox_fn(
        state,
        "FIA Commission",
        "FIA",
        f"Vote {'PASSED' if passed else 'REJECTED'}: {prop['title']}",
        f"Commission Tally: {yes_votes} YES vs {no_votes} NO (needed {needed}, FIA Delegate: {bill_res['fia_vote']}). Precedent cited: {precedent['year']} {precedent['event_name']} [{rules_ref}].",
    )
    return True, f"Proposal {'PASSED' if passed else 'REJECTED'} ({yes_votes}–{no_votes}, threshold {needed}) via F1 Commission vote."
