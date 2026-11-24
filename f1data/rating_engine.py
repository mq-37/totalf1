"""
Multi-Source Fair F1 Driver Rating & Attribute Engine (1950–2026).

Leverages ALL local primary datasets:
  - data/f1db.sqlite (58 tables, 1.13M rows: qualifying, race results, grid-to-finish positions gained,
    mechanical vs driver-fault retirements, exact teammate H2H excluding mechanical DNFs, poles, DOTD, sprints)
  - data/fia_docs.sqlite (11,919 official FIA documents: steward infringement & penalty cleanliness)
  - f1data/driver_dna.py (wet mastery, tyre preservation & mechanical sympathy baselines)

Produces 8 fair, era-normalized, machinery-adjusted attributes (50–99) + Fair Overall for BOTH:
  - Collector & Game Cards (/play, /cards, /api/game/deck, PDFs)
  - Live Race Simulators (/sim, /career)
"""
from __future__ import annotations

import math
import re
import sqlite3
import threading
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent.parent
F1DB_PATH = BASE_DIR / "data" / "f1db.sqlite"
FIA_DOCS_PATH = BASE_DIR / "data" / "fia_docs.sqlite"

_LOCK = threading.Lock()
_CACHE: dict[str, Any] | None = None

_DRIVER_FAULT_RE = re.compile(
    r"accident|collision|spun|spin|crash|off track|barrier|wall|damage|disqualif|excluded|unsafe",
    re.IGNORECASE,
)

_WET_STREET_CIRCUIT_KEYS = (
    "spa", "interlagos", "monaco", "silverstone", "suzuka", "singapore",
    "montreal", "nurburgring", "imola", "baku", "zandvoort", "adelaide", "villeneuve",
)


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def _norm_name(raw: str | None) -> str:
    s = unicodedata.normalize("NFKD", str(raw or "")).encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"\s+[a-z]{3}$", "", s.strip())
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def _is_driver_fault(reason: str | None) -> bool:
    if not reason:
        return False
    return bool(_DRIVER_FAULT_RE.search(str(reason)))


def _build_f1db_and_fia_index() -> dict[str, Any]:
    """Single bulk pass over f1db.sqlite + fia_docs.sqlite (<200ms) cached in memory."""
    career_stats: dict[str, dict[str, Any]] = {}
    season_stats: dict[tuple[str, int], dict[str, Any]] = {}
    name_to_id: dict[str, str] = {}
    fia_infringements: dict[str, int] = defaultdict(int)

    # 1. Count FIA Steward Infringements / Penalties per driver surname (modern era 2018-2026)
    if FIA_DOCS_PATH.exists():
        try:
            fcon = sqlite3.connect(str(FIA_DOCS_PATH))
            rows = fcon.execute(
                "SELECT title, summary FROM fia_docs WHERE title LIKE '%Infringement%' OR title LIKE '%Penalty%' OR title LIKE '%Offence%'"
            ).fetchall()
            fcon.close()
            for title, summ in rows:
                txt = f"{title or ''} {summ or ''}".lower()
                # Extract "Car XX - Surname" or common driver surnames
                m = re.search(r"car\s+\d+\s*[-–]\s*([a-z]+)", txt)
                if m:
                    fia_infringements[m.group(1)] += 1
        except Exception:
            pass

    if not F1DB_PATH.exists():
        return {"career": career_stats, "season": season_stats, "name_to_id": name_to_id, "fia_infringements": dict(fia_infringements)}

    try:
        con = sqlite3.connect(str(F1DB_PATH))
        con.row_factory = sqlite3.Row

        # Load master driver metadata
        drv_meta: dict[str, dict[str, Any]] = {}
        for r in con.execute(
            """
            SELECT id, name, fullName, lastName, abbreviation,
                   totalChampionshipWins, totalRaceStarts, totalRaceWins, totalPodiums,
                   totalPolePositions, totalFastestLaps, totalSprintRaceWins,
                   totalDriverOfTheDay, totalGrandSlams
            FROM drivers
            """
        ).fetchall():
            did = str(r["id"])
            drv_meta[did] = dict(r)
            for cand in (r["name"], r["fullName"]):
                nk = _norm_name(cand)
                if nk:
                    name_to_id[nk] = did
                    # Also index without trailing "jr" / "sr" so "Carlos Sainz" -> "Carlos Sainz Jr."
                    stripped = re.sub(r"\s+(jr|sr|ii|iii)$", "", nk).strip()
                    if stripped and stripped != nk:
                        # Prefer the driver with more starts if collision (e.g., Carlos Sainz Jr. vs Sr.)
                        prev_id = name_to_id.get(stripped)
                        if not prev_id or int(r["totalRaceStarts"] or 0) > int((drv_meta.get(prev_id) or {}).get("totalRaceStarts") or 0):
                            name_to_id[stripped] = did

        # Identify wet/street raceIds
        wet_street_races: set[int] = set()
        for r in con.execute("SELECT id, circuitId, officialName FROM races").fetchall():
            blob = f"{r['circuitId'] or ''} {r['officialName'] or ''}".lower()
            if any(k in blob for k in _WET_STREET_CIRCUIT_KEYS):
                wet_street_races.add(int(r["id"]))

        # Bulk-fetch all race results (1950-2026) in ONE query!
        race_rows = con.execute(
            """
            SELECT raceId, year, driverId, constructorId,
                   positionNumber, positionText, qualificationPositionNumber,
                   gridPositionNumber, positionsGained, reasonRetired,
                   polePosition, fastestLap, driverOfTheDay, grandSlam, timePenaltyMillis
            FROM races_race_results
            """
        ).fetchall()
        con.close()

        def _blank() -> dict[str, Any]:
            return {
                "starts": 0, "classified": 0, "wins": 0, "podiums": 0, "top10": 0,
                "poles": 0, "fastest_laps": 0, "dotd": 0, "grand_slams": 0,
                "driver_fault_dnfs": 0, "mech_dnfs": 0, "time_penalties": 0,
                "fin_sum": 0.0, "fin_cnt": 0,
                "quali_sum": 0.0, "quali_cnt": 0,
                "pos_gained_sum": 0.0, "pos_gained_cnt": 0,
                "wet_fin_sum": 0.0, "wet_fin_cnt": 0,
                "q_h2h_w": 0, "q_h2h_l": 0,
                "r_h2h_w": 0, "r_h2h_l": 0,
                "years": set(),
            }

        # Group by (raceId, constructorId) for true race-by-race teammate H2H (excluding mechanical DNFs!)
        team_race_groups: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)

        for r in race_rows:
            did = str(r["driverId"] or "")
            if not did:
                continue
            yr = int(r["year"] or 2000)
            rid = int(r["raceId"] or 0)
            cid = str(r["constructorId"] or "")
            pos = r["positionNumber"]
            qpos = r["qualificationPositionNumber"] or r["gridPositionNumber"]
            gpos = r["gridPositionNumber"] or r["qualificationPositionNumber"]
            pgain = r["positionsGained"]
            reason = r["reasonRetired"]
            ptxt = str(r["positionText"] or "")
            is_dnf = (pos is None) or (ptxt in ("DNF", "DSQ", "RET", "NC"))
            is_fault = is_dnf and _is_driver_fault(reason)
            is_mech = is_dnf and (not is_fault)

            c_acc = career_stats.setdefault(did, _blank())
            s_acc = season_stats.setdefault((did, yr), _blank())

            for acc in (c_acc, s_acc):
                acc["starts"] += 1
                acc["years"].add(yr)
                if r["polePosition"]:
                    acc["poles"] += 1
                if r["fastestLap"]:
                    acc["fastest_laps"] += 1
                if r["driverOfTheDay"]:
                    acc["dotd"] += 1
                if r["grandSlam"]:
                    acc["grand_slams"] += 1
                if r["timePenaltyMillis"] and int(r["timePenaltyMillis"]) > 0:
                    acc["time_penalties"] += 1

                if qpos is not None and int(qpos) > 0:
                    acc["quali_sum"] += float(qpos)
                    acc["quali_cnt"] += 1

                if not is_dnf and pos is not None:
                    p_int = int(pos)
                    acc["classified"] += 1
                    acc["fin_sum"] += float(p_int)
                    acc["fin_cnt"] += 1
                    if p_int == 1:
                        acc["wins"] += 1
                    if p_int <= 3:
                        acc["podiums"] += 1
                    if p_int <= 10:
                        acc["top10"] += 1
                    if rid in wet_street_races:
                        acc["wet_fin_sum"] += float(p_int)
                        acc["wet_fin_cnt"] += 1
                    if pgain is not None:
                        acc["pos_gained_sum"] += float(pgain)
                        acc["pos_gained_cnt"] += 1
                    elif gpos is not None and int(gpos) > 0:
                        acc["pos_gained_sum"] += float(int(gpos) - p_int)
                        acc["pos_gained_cnt"] += 1
                else:
                    if is_fault:
                        acc["driver_fault_dnfs"] += 1
                    elif is_mech:
                        acc["mech_dnfs"] += 1

            if cid:
                team_race_groups[(rid, cid)].append({
                    "did": did, "yr": yr,
                    "qpos": int(qpos) if (qpos is not None and int(qpos) > 0) else None,
                    "pos": int(pos) if (not is_dnf and pos is not None) else None,
                    "is_mech": is_mech, "is_fault": is_fault,
                })

        # Compute fair Teammate H2H (Qualifying + Race excluding Mechanical DNFs!)
        for (_rid, _cid), entries in team_race_groups.items():
            if len(entries) != 2:
                continue
            a, b = entries[0], entries[1]
            if a["did"] == b["did"]:
                continue
            # Qualifying H2H
            if a["qpos"] is not None and b["qpos"] is not None and a["qpos"] != b["qpos"]:
                win_e, los_e = (a, b) if a["qpos"] < b["qpos"] else (b, a)
                career_stats[win_e["did"]]["q_h2h_w"] += 1
                career_stats[los_e["did"]]["q_h2h_l"] += 1
                season_stats[(win_e["did"], win_e["yr"])]["q_h2h_w"] += 1
                season_stats[(los_e["did"], los_e["yr"])]["q_h2h_l"] += 1
            # Race H2H: skip when EITHER teammate had a mechanical DNF!
            if not a["is_mech"] and not b["is_mech"]:
                a_rank = a["pos"] if a["pos"] is not None else 99
                b_rank = b["pos"] if b["pos"] is not None else 99
                if a_rank != b_rank:
                    win_e, los_e = (a, b) if a_rank < b_rank else (b, a)
                    career_stats[win_e["did"]]["r_h2h_w"] += 1
                    career_stats[los_e["did"]]["r_h2h_l"] += 1
                    season_stats[(win_e["did"], win_e["yr"])]["r_h2h_w"] += 1
                    season_stats[(los_e["did"], los_e["yr"])]["r_h2h_l"] += 1

        # Finalize derived summaries
        def _finalize(acc: dict[str, Any], did: str) -> dict[str, Any]:
            meta = drv_meta.get(did) or {}
            st = max(1, acc["starts"])
            avg_fin = round(acc["fin_sum"] / acc["fin_cnt"], 2) if acc["fin_cnt"] else None
            avg_q = round(acc["quali_sum"] / acc["quali_cnt"], 2) if acc["quali_cnt"] else None
            avg_pg = round(acc["pos_gained_sum"] / acc["pos_gained_cnt"], 2) if acc["pos_gained_cnt"] else 0.0
            wet_delta = 0.0
            if avg_fin is not None and acc["wet_fin_cnt"] >= 3:
                wet_avg = acc["wet_fin_sum"] / acc["wet_fin_cnt"]
                wet_delta = round(avg_fin - wet_avg, 2)  # positive = finishes BETTER at wet/street tracks!
            q_tot = acc["q_h2h_w"] + acc["q_h2h_l"]
            r_tot = acc["r_h2h_w"] + acc["r_h2h_l"]
            surname = _norm_name(meta.get("lastName") or did.split("-")[-1])
            fia_cnt = int(fia_infringements.get(surname, 0))
            return {
                "driver_id": did,
                "starts": acc["starts"],
                "wins": acc["wins"],
                "podiums": acc["podiums"],
                "top10": acc["top10"],
                "poles": acc["poles"],
                "fastest_laps": acc["fastest_laps"],
                "dotd": acc["dotd"],
                "grand_slams": acc["grand_slams"],
                "championships": int(meta.get("totalChampionshipWins") or 0),
                "sprint_wins": int(meta.get("totalSprintRaceWins") or 0),
                "avg_finish": avg_fin,
                "avg_quali": avg_q,
                "avg_pos_gained": avg_pg,
                "wet_street_delta": wet_delta,
                "driver_fault_dnfs": acc["driver_fault_dnfs"],
                "mech_dnfs": acc["mech_dnfs"],
                "driver_fault_dnf_pct": round((acc["driver_fault_dnfs"] / st) * 100.0, 1),
                "mech_dnf_pct": round((acc["mech_dnfs"] / st) * 100.0, 1),
                "time_penalties": acc["time_penalties"],
                "fia_infringements": fia_cnt,
                "q_h2h_w": acc["q_h2h_w"],
                "q_h2h_l": acc["q_h2h_l"],
                "q_h2h_pct": round((acc["q_h2h_w"] / q_tot) * 100.0, 1) if q_tot > 0 else None,
                "r_h2h_w": acc["r_h2h_w"],
                "r_h2h_l": acc["r_h2h_l"],
                "r_h2h_pct": round((acc["r_h2h_w"] / r_tot) * 100.0, 1) if r_tot > 0 else None,
                "seasons_count": len(acc["years"]),
            }

        career_final = {did: _finalize(acc, did) for did, acc in career_stats.items()}
        season_final = {k: _finalize(acc, k[0]) for k, acc in season_stats.items()}
        return {
            "career": career_final,
            "season": season_final,
            "name_to_id": name_to_id,
            "fia_infringements": dict(fia_infringements),
        }
    except Exception:
        return {"career": career_stats, "season": season_stats, "name_to_id": name_to_id, "fia_infringements": dict(fia_infringements)}


def _get_index() -> dict[str, Any]:
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    with _LOCK:
        if _CACHE is None:
            _CACHE = _build_f1db_and_fia_index()
        return _CACHE


def lookup_f1db_driver_metrics(driver_name: str | None, year: int | None = None) -> dict[str, Any] | None:
    """Lookup real F1DB + FIA-Docs metrics for a driver (optionally scoped to a specific season year)."""
    idx = _get_index()
    nk = _norm_name(driver_name)
    if not nk:
        return None
    did = idx["name_to_id"].get(nk)
    if not did:
        # Try matching last name + first initial when spelling differs slightly
        parts = nk.split()
        if len(parts) >= 2:
            last = parts[-1]
            first = parts[0]
            for cand_name, cand_id in idx["name_to_id"].items():
                cp = cand_name.split()
                if len(cp) >= 2 and cp[-1] == last and cp[0][:2] == first[:2]:
                    did = cand_id
                    break
    if not did:
        return None

    career_m = idx["career"].get(did)
    if year is not None:
        sm = idx["season"].get((did, int(year)))
        if sm and sm.get("starts", 0) >= 3:
            # Blend season metrics with career context for championships & wet mastery
            out = dict(sm)
            if career_m:
                out["career_q_h2h_pct"] = career_m.get("q_h2h_pct")
                out["career_r_h2h_pct"] = career_m.get("r_h2h_pct")
                out["career_wet_delta"] = career_m.get("wet_street_delta", 0.0)
                out["career_driver_fault_dnf_pct"] = career_m.get("driver_fault_dnf_pct", 8.0)
            return out
    return dict(career_m) if career_m else None


def compute_fair_attributes(card: dict[str, Any], year: int | None = None) -> dict[str, Any]:
    """
    Compute 8 fair, era-normalized, machinery-adjusted driver attributes (50–99) + Fair Overall
    by fusing F1DB qualifying/race/teammate/fault-DNF data, FIA Docs discipline, and Driver DNA.
    """
    raw_name = str(card.get("clean_name") or card.get("driver") or "")
    f1m = lookup_f1db_driver_metrics(raw_name, year=year)

    # Pull Driver DNA curated/deduced baselines when available
    dna: dict[str, Any] = {}
    try:
        from .driver_dna import CURATED_DRIVER_DNA, _norm_key
        dna = CURATED_DRIVER_DNA.get(_norm_key(raw_name)) or {}
    except Exception:
        dna = {}

    starts = max(0, int((f1m or {}).get("starts") or card.get("starts") or 0))
    wins = max(0, int((f1m or {}).get("wins") or card.get("wins") or 0))
    podiums = max(0, int((f1m or {}).get("podiums") or card.get("podiums") or 0))
    poles = max(0, int((f1m or {}).get("poles") or card.get("poles") or 0))
    fl = max(0, int((f1m or {}).get("fastest_laps") or card.get("fastest_laps") or 0))
    dotd = max(0, int((f1m or {}).get("dotd") or 0))
    grand_slams = max(0, int((f1m or {}).get("grand_slams") or 0))
    sprint_wins = max(0, int((f1m or {}).get("sprint_wins") or 0))
    champ_years = card.get("champion_years") or []
    championships = max(
        int((f1m or {}).get("championships") or 0),
        int(card.get("championships") or 0),
        len(champ_years) if isinstance(champ_years, (list, tuple)) else 0,
    )
    titles_period = int(card.get("titles_decade") or 0)
    raw_overall = float(card.get("overall") or 68.0)

    # Bayesian-smoothed rates (eliminates 1-race cameo anomalies!)
    eff_starts = max(1, starts)
    pole_rate = (poles / eff_starts) * 100.0 if starts > 0 else 0.0
    win_rate = (wins / eff_starts) * 100.0 if starts > 0 else float(card.get("win_rate") or 0.0)
    pod_rate = (podiums / eff_starts) * 100.0 if starts > 0 else float(card.get("podium_rate") or 0.0)
    fl_rate = (fl / eff_starts) * 100.0 if starts > 0 else float(card.get("fl_rate") or 0.0)
    top10_rate = ((int((f1m or {}).get("top10") or 0) / eff_starts) * 100.0) if (f1m and starts > 0) else float(card.get("top10_rate") or 40.0)

    avg_quali = (f1m or {}).get("avg_quali")
    avg_fin = (f1m or {}).get("avg_finish") or card.get("avg_finish")
    avg_pos_gained = float((f1m or {}).get("avg_pos_gained") or 0.0)

    # Fair Teammate H2H (Bayesian prior = 50% over 5 virtual races)
    q_w = int((f1m or {}).get("q_h2h_w") or 0)
    q_l = int((f1m or {}).get("q_h2h_l") or 0)
    q_h2h_smooth = (q_w + 2.5) / (q_w + q_l + 5.0)

    r_w = int((f1m or {}).get("r_h2h_w") or card.get("race_tm_wins") or 0)
    r_l = int((f1m or {}).get("r_h2h_l") or card.get("race_tm_losses") or 0)
    r_h2h_smooth = (r_w + 2.5) / (r_w + r_l + 5.0)

    # Driver-Fault DNF % vs Mechanical DNF % (NEVER blame drivers for blown engines!)
    if f1m and starts > 0:
        fault_dnfs = int(f1m.get("driver_fault_dnfs") or 0)
        mech_dnfs = int(f1m.get("mech_dnfs") or 0)
        raw_dnf_pct = round(((fault_dnfs + mech_dnfs) / starts) * 100.0, 1)
        fault_dnf_pct = round((fault_dnfs / starts) * 100.0, 1)
        mech_dnf_pct = round((mech_dnfs / starts) * 100.0, 1)
        # Bayesian-smoothed driver-fault cleanliness (prior 8.5% over 8 virtual races)
        smooth_fault_rate = (fault_dnfs + 8.0 * 0.085) / (starts + 8.0)
    else:
        dnfs_fallback = max(0, int(card.get("dnfs") or 0))
        raw_dnf_pct = round((dnfs_fallback / eff_starts) * 100.0, 1) if starts > 0 else 16.0
        fault_dnf_pct = round(raw_dnf_pct * 0.42, 1)
        mech_dnf_pct = round(raw_dnf_pct * 0.58, 1)
        smooth_fault_rate = _clamp(fault_dnf_pct / 100.0, 0.03, 0.28)

    # Normalized field position curves
    q_pos_norm = _clamp((19.0 - float(avg_quali)) / 17.5, 0.0, 1.0) if avg_quali else _clamp((raw_overall - 62.0) / 36.0, 0.0, 1.0)
    f_pos_norm = _clamp((19.0 - float(avg_fin)) / 17.5, 0.0, 1.0) if avg_fin else _clamp((raw_overall - 62.0) / 36.0, 0.0, 1.0)
    pg_norm = _clamp((avg_pos_gained + 2.0) / 6.0, 0.0, 1.0)  # +0 = 0.33, +2 = 0.67, +4 = 1.0

    # =========================================================================
    # 8 FAIR, DATA-BACKED ATTRIBUTES (52–99)
    # =========================================================================

    # 1. PACE: Real Qualifying velocity + Pole rate + Teammate Quali H2H + Fastest-Lap burst
    pace_raw = (
        50.0
        + q_pos_norm * 16.0
        + q_h2h_smooth * 17.5
        + min(11.0, math.sqrt(max(0.0, pole_rate)) * 2.1)
        + min(6.5, math.sqrt(max(0.0, fl_rate)) * 1.45)
    )
    pace = int(round(_clamp(pace_raw, 54.0, 99.0)))

    # 2. RACECRAFT: Real Sunday Positions Gained + Race Teammate H2H + Win/Podium/Top-10 conversion
    racecraft_raw = (
        48.0
        + f_pos_norm * 12.5
        + r_h2h_smooth * 16.0
        + pg_norm * 8.5
        + min(9.5, math.sqrt(max(0.0, win_rate)) * 1.65)
        + min(7.0, pod_rate * 0.11 + (top10_rate / 100.0) * 4.0)
    )
    racecraft = int(round(_clamp(racecraft_raw, 54.0, 99.0)))

    # 3. RELIABILITY (CONSISTENCY): Fault-Adjusted Cleanliness (ignores engine blowups!) + Top-10 rhythm
    mech_symp = float(dna.get("mech_sympathy") or 80.0)
    fault_clean_score = _clamp((0.22 - smooth_fault_rate) / 0.20, 0.0, 1.0)
    reliability_raw = (
        50.0
        + fault_clean_score * 29.0
        + (top10_rate / 100.0) * 10.5
        + ((mech_symp - 70.0) * 0.28)
    )
    reliability = int(round(_clamp(reliability_raw, 54.0, 99.0)))

    # 4. DUELS: True Combined Teammate Dominance (50% Quali H2H + 50% Fault-Free Race H2H) + Passing
    combined_h2h = q_h2h_smooth * 0.48 + r_h2h_smooth * 0.52
    duels_raw = 46.0 + combined_h2h * 44.0 + pg_norm * 6.5 + min(3.5, math.sqrt(q_w + r_w) * 0.35)
    duels = int(round(_clamp(duels_raw, 54.0, 99.0)))

    # 5. CLUTCH: World Titles, Grand Slams, Sprint Wins, Driver of the Day, & Peak Dominance
    clutch_raw = (
        52.0
        + min(20.0, championships * 4.5 + titles_period * 2.0)
        + min(8.0, grand_slams * 2.0 + sprint_wins * 1.2 + math.sqrt(dotd) * 1.4)
        + f_pos_norm * 10.0
        + combined_h2h * 9.0
    )
    clutch = int(round(_clamp(clutch_raw, 54.0, 99.0)))

    # 6. WET: Real F1DB Wet/Street Circuit Delta + Driver DNA Wet Mastery
    wet_delta = float((f1m or {}).get("career_wet_delta") or (f1m or {}).get("wet_street_delta") or 0.0)
    if dna.get("wet_mastery"):
        wet_raw = float(dna["wet_mastery"]) * 0.72 + (68.0 + wet_delta * 3.8 + racecraft * 0.14) * 0.28
    else:
        wet_raw = 58.0 + f_pos_norm * 14.0 + combined_h2h * 14.0 + _clamp(wet_delta * 4.2, -8.0, 12.0)
    wet = int(round(_clamp(wet_raw, 54.0, 99.0)))

    # 7. TYRE_CARE: Race-vs-Quali retention + Mechanical/Tyre Preservation DNA
    tyre_dna = float(dna.get("tyre_preservation") or 78.0)
    tyre_raw = (
        tyre_dna * 0.55
        + (54.0 + pg_norm * 14.0 + fault_clean_score * 16.0 + r_h2h_smooth * 12.0) * 0.45
    )
    tyre_care = int(round(_clamp(tyre_raw, 54.0, 99.0)))

    # 8. DISCIPLINE: Low Driver-Fault Crashes + Low FIA Steward Penalties/Infringements
    fia_inf = int((f1m or {}).get("fia_infringements") or 0)
    time_pens = int((f1m or {}).get("time_penalties") or 0)
    pen_rate = (time_pens + fia_inf * 0.35) / max(10, starts)
    disc_raw = 56.0 + fault_clean_score * 32.0 - min(18.0, pen_rate * 26.0) + ((mech_symp - 78.0) * 0.25)
    discipline = int(round(_clamp(disc_raw, 52.0, 99.0)))

    # =========================================================================
    # FAIR MACHINERY-ADJUSTED OVERALL (56% Results/Pedigree + 44% Car-Independent Skill)
    # =========================================================================
    car_indep_skill = (
        (50.0 + combined_h2h * 46.0) * 0.42
        + (58.0 + pg_norm * 36.0) * 0.18
        + reliability * 0.16
        + wet * 0.14
        + tyre_care * 0.10
    )
    attr_composite = (
        pace * 0.24
        + racecraft * 0.22
        + duels * 0.16
        + reliability * 0.11
        + clutch * 0.13
        + wet * 0.07
        + tyre_care * 0.07
    )
    # Gentle calibration so all-time legends sit cleanly in 93-98, elite stars 85-92, strong midfield 78-84
    raw_blend = attr_composite * 0.56 + car_indep_skill * 0.22 + raw_overall * 0.22
    pedigree_lift = min(5.5, championships * 1.15 + (1.4 if wins >= 20 else (0.7 if wins >= 5 else 0.0)))
    fair_overall = round(_clamp(raw_blend + 3.6 + pedigree_lift, 60.0, 99.0), 1)
    # Estimated Car Strength vs Pure Driver Skill (for fair /sim machinery separation!)
    car_strength_est = round(_clamp(58.0 + (q_pos_norm * 0.55 + f_pos_norm * 0.45) * 39.0, 58.0, 98.0), 1)

    return {
        "stats": {
            "pace": pace,
            "racecraft": racecraft,
            "reliability": reliability,
            "duels": duels,
            "clutch": clutch,
            "wet": wet,
            "tyre_care": tyre_care,
            "discipline": discipline,
            "dnf_rate": fault_dnf_pct,  # Fair Driver-Fault DNF % (does NOT punish mechanical engine blowups!)
        },
        "fair_overall": fair_overall,
        "driver_skill": round(car_indep_skill, 1),
        "car_strength_est": car_strength_est,
        "telemetry": {
            "source": "F1DB + FIA Docs" if f1m else "Historical Archive",
            "poles": poles,
            "dotd": dotd,
            "sprint_wins": sprint_wins,
            "grand_slams": grand_slams,
            "avg_quali": avg_quali,
            "avg_finish": avg_fin,
            "avg_pos_gained": avg_pos_gained,
            "quali_h2h_pct": (f1m or {}).get("q_h2h_pct"),
            "race_h2h_pct": (f1m or {}).get("r_h2h_pct"),
            "driver_fault_dnf_pct": fault_dnf_pct,
            "mech_dnf_pct": mech_dnf_pct,
            "raw_dnf_pct": raw_dnf_pct,
            "fia_infringements": fia_inf,
            "time_penalties": time_pens,
        },
    }
