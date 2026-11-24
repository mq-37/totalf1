"""
Historical Track × Era × Team × Driver Performance Balancing & Psychology Profiler.

Reads strictly read-only historical records from `data/f1.sqlite` (25,769 race results across 1950–2026)
once per process (~25ms) and caches:
  1. Canonical Grand Prix -> circuit_id mapping across all historical F1 venues
  2. Driver × Track affinity bonuses (Bayesian-shrunk historical over/under-performance at a venue)
  3. Team × Track × Era affinity bonuses (constructor historical strength per circuit & era)
  4. Data-driven Driver Psychology Profile (aggression, composure, wet_confidence, recovery, persona)
"""
from __future__ import annotations

import math
import re
import sqlite3
import threading
import unicodedata
from pathlib import Path
from typing import Any

from .era_rules import era_key_for_year

_CACHE_LOCK = threading.Lock()
_CACHE: dict[str, Any] | None = None

# Canonical mapping from normalized Grand Prix names (from f1.sqlite races.grand_prix) to circuit_id
GP_TO_CIRCUIT_ID: dict[str, str] = {
    "great britain": "silverstone",
    "italy": "monza",
    "monaco": "monaco",
    "belgium": "spa",
    "germany": "hockenheimring",
    "france": "paul_ricard",
    "spain": "barcelona",
    "canada": "montreal",
    "brazil": "interlagos",
    "united states": "austin",
    "hungary": "hungaroring",
    "japan": "suzuka",
    "australia": "melbourne",
    "austria": "spielberg",
    "netherlands": "zandvoort",
    "san marino": "imola",
    "emilia romagna": "imola",
    "mexico": "mexico",
    "south africa": "kyalami",
    "bahrain": "bahrain",
    "sakhir": "bahrain",
    "argentina": "buenos_aires",
    "malaysia": "sepang",
    "portugal": "estoril",
    "china": "shanghai",
    "abu dhabi": "abudhabi",
    "singapore": "singapore",
    "europe": "nurburgring",
    "eifel": "nurburgring",
    "luxembourg": "nurburgring",
    "indianapolis": "indianapolis",
    "turkey": "istanbul",
    "usa west": "long_beach",
    "russia": "sochi",
    "azerbaijan": "baku",
    "detroit": "detroit",
    "sweden": "anderstorp",
    "usa east": "watkins_glen",
    "switzerland": "bremgarten",
    "miami": "miami",
    "saudi arabia": "jeddah",
    "qatar": "qatar",
    "las vegas": "vegas",
    "caesars palace": "caesars_palace",
    "india": "buddh",
    "south korea": "yeongam",
    "korea": "yeongam",
    "pacific": "okayama",
    "tuscany": "mugello",
    "styria": "spielberg",
    "70th anniversary": "silverstone",
    "dallas": "dallas",
    "morocco": "ain_diab",
    "pescara": "pescara",
    "madrid": "madrid",
    "madring": "madrid",
}


def _norm_key(raw: str) -> str:
    s = unicodedata.normalize("NFKD", str(raw or "")).encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"\s+[a-z]{3}$", "", s.strip())
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def _norm_gp_to_circuit(gp_raw: str, year: int) -> str:
    s = str(gp_raw or "").strip()
    # Strip leading "Flag of <Country> " scraper prefix
    s = re.sub(r"^Flag of .+?\s+(?=[A-Z0-9])", "", s)
    low = _norm_key(s)
    # Year-aware disambiguation for multi-venue Grands Prix!
    if low == "australia" and year <= 1995:
        return "adelaide"
    if low == "great britain":
        if year in (1955, 1957, 1959, 1961, 1962):
            return "aintree"
        if year in (1964, 1966, 1968, 1970, 1972, 1974, 1976, 1978, 1980, 1982, 1984, 1986):
            return "brands_hatch"
        return "silverstone"
    if low == "germany":
        if year <= 1976 or year in (1985, 2009, 2011, 2013):
            return "nurburgring"
        return "hockenheimring"
    if low == "france":
        if year >= 1991 and year <= 2008:
            return "magny_cours"
        if year in (1974, 1977, 1979, 1981, 1984):
            return "dijon"
        if year in (1952, 1957, 1962, 1964, 1968):
            return "rouen"
        if year in (1965, 1969, 1970, 1972):
            return "charade"
        return "paul_ricard"
    if low == "spain":
        if year >= 1991:
            return "barcelona"
        if year >= 1986:
            return "jerez"
        if year in (1968, 1970, 1972, 1974, 1976, 1977, 1978, 1979, 1981):
            return "jarama"
        if year in (1969, 1971, 1973, 1975):
            return "montjuic"
        return "pedralbes"
    if low == "portugal":
        if year >= 2020:
            return "portimao"
        if year >= 1984:
            return "estoril"
        if year == 1959:
            return "monsanto"
        return "boavista"
    if low == "japan":
        if year in (1976, 1977, 2007, 2008):
            return "fuji"
        return "suzuka"
    if low == "brazil":
        if year in (1978, 1981, 1982, 1983, 1984, 1985, 1986, 1987, 1988, 1989):
            return "jacarepagua"
        return "interlagos"
    if low == "canada":
        if year in (1968, 1970):
            return "mont_tremblant"
        if year <= 1977:
            return "mosport"
        return "montreal"
    if low == "united states":
        if year >= 2012:
            return "austin"
        if 2000 <= year <= 2007:
            return "indianapolis"
        if 1989 <= year <= 1991:
            return "phoenix"
        if 1961 <= year <= 1980:
            return "watkins_glen"
        if year == 1960:
            return "riverside"
        return "sebring"
    if low == "europe":
        if 2008 <= year <= 2012:
            return "valencia"
        if year == 1993:
            return "donington"
        if year in (1994, 1997):
            return "jerez"
        if year == 2016:
            return "baku"
        return "nurburgring"
    if low == "belgium":
        if year in (1973, 1975, 1976, 1977, 1978, 1979, 1980, 1981, 1982, 1984):
            return "zolder"
        if year in (1972, 1974):
            return "nivelles"
        return "spa"
    if low == "south africa" and year <= 1965:
        return "prince_george"
    if low == "austria" and year == 1964:
        return "zeltweg"
    if low == "austria" and 1970 <= year <= 1987:
        return "osterreichring"
    if low == "italy" and year == 1980:
        return "imola"

    for k, cid in GP_TO_CIRCUIT_ID.items():
        if k in low:
            return cid
    return low.replace(" ", "_")


def _norm_team_family(team_raw: str) -> str:
    t = _norm_key(team_raw)
    for fam in (
        "ferrari", "mclaren", "mercedes", "red bull", "williams", "lotus", "renault",
        "alpine", "aston martin", "benetton", "tyrrell", "brabham", "sauber", "haas",
        "alfa romeo", "alphatauri", "racing bulls", "toro rosso", "force india",
        "jordan", "ligier", "minardi", "brm", "cooper", "maserati", "matra", "march",
        "arrows", "stewart", "jaguar", "toyota", "honda", "brawn", "bar", "audi", "cadillac",
    ):
        if fam in t:
            return fam
    return t.split(" ")[0] if t else "privateer"


def _build_cache(db_path: Path) -> dict[str, Any]:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        # 1. Circuit winners & team/driver track history from `races` + `race_results`
        race_map: dict[tuple[int, int], tuple[int, str, str]] = {}
        circuit_winners: dict[str, dict[str, int]] = {}
        team_circuit_era: dict[tuple[str, str, str], list[float]] = {}
        team_circuit_all: dict[tuple[str, str], list[float]] = {}
        driver_circuit: dict[tuple[str, str], list[float]] = {}
        driver_totals: dict[str, dict[str, float]] = {}

        for r in conn.execute("SELECT year, round, grand_prix, winner, team FROM races").fetchall():
            yr = int(r["year"] or 2020)
            rnd = int(r["round"] or 0)
            cid = _norm_gp_to_circuit(r["grand_prix"], yr)
            ek = era_key_for_year(yr)
            race_map[(yr, rnd)] = (yr, cid, ek)
            w = (r["winner"] or "").strip()
            if w:
                w_clean = re.sub(r"\s+[A-Z]{3}$", "", w).strip()
                cw = circuit_winners.setdefault(cid, {})
                cw[w_clean] = cw.get(w_clean, 0) + 1

        for rr in conn.execute(
            "SELECT year, round, driver, team, position_text, position_order FROM race_results"
        ).fetchall():
            yr = int(rr["year"] or 2020)
            rnd = int(rr["round"] or 0)
            if (yr, rnd) in race_map:
                yr, cid, ek = race_map[(yr, rnd)]
            else:
                cid, ek = "", era_key_for_year(yr)
            dkey = _norm_key(rr["driver"])
            tkey = _norm_team_family(rr["team"])
            ptxt = str(rr["position_text"] or "").strip().upper()
            pos = int(ptxt) if ptxt.isdigit() else None
            is_dnf = pos is None or ptxt in ("NC", "DNF", "RET", "DSQ", "DNS", "DNQ", "EX")
            # Score finish performance on [0..1] scale (P1=1.0, P10=0.45, P20=0.05, DNF=0.0)
            perf = 0.0 if is_dnf else max(0.05, 1.0 - (pos - 1) * 0.055)

            dt = driver_totals.setdefault(dkey, {"starts": 0.0, "wins": 0.0, "pods": 0.0, "dnfs": 0.0, "perf_sum": 0.0})
            dt["starts"] += 1.0
            dt["perf_sum"] += perf
            if not is_dnf and pos == 1:
                dt["wins"] += 1.0
            if not is_dnf and pos <= 3:
                dt["pods"] += 1.0
            if is_dnf:
                dt["dnfs"] += 1.0

            if cid:
                driver_circuit.setdefault((dkey, cid), []).append(perf)
                team_circuit_era.setdefault((tkey, cid, ek), []).append(perf)
                team_circuit_all.setdefault((tkey, cid), []).append(perf)

        # 2. Compute Bayesian-shrunk driver psychology & risk traits
        driver_psych: dict[str, dict[str, Any]] = {}
        for dkey, st in driver_totals.items():
            starts = max(1.0, st["starts"])
            win_r = st["wins"] / starts
            pod_r = st["pods"] / starts
            dnf_r = st["dnfs"] / starts
            avg_p = st["perf_sum"] / starts

            # Aggression (40-96): high win/podium punch + higher risk appetite
            aggression = int(round(max(42, min(96, 56 + win_r * 55 + pod_r * 16 + min(0.35, dnf_r) * 28))))
            # Composure (42-97): low DNF + strong average finish + experience
            composure = int(round(max(44, min(97, 78 - dnf_r * 45 + avg_p * 22 + min(10.0, math.sqrt(starts) * 0.75)))))
            # Wet confidence (45-96): correlated with racecraft/podium conversion
            wet_conf = int(round(max(48, min(96, 58 + pod_r * 48 + win_r * 25))))
            # Recovery from mistakes (45-96)
            recovery = int(round(max(46, min(96, 62 + composure * 0.25 + min(12.0, math.log1p(starts) * 2.2)))))

            # Voice / Interview Persona derived from real career signature
            if composure >= 86 and aggression <= 72:
                persona = "iceman"
            elif aggression >= 82 and win_r >= 0.14:
                persona = "fiery_racer"
            elif win_r >= 0.18 and composure >= 78:
                persona = "perfectionist"
            elif starts <= 32:
                persona = "rookie_hungry"
            elif starts >= 140:
                persona = "veteran_statesman"
            else:
                persona = "team_player"

            driver_psych[dkey] = {
                "starts": int(starts),
                "avg_perf": round(avg_p, 3),
                "dnf_rate": round(dnf_r * 100.0, 1),
                "aggression": aggression,
                "composure": composure,
                "wet_confidence": wet_conf,
                "recovery": recovery,
                "persona": persona,
            }

        # Top historical winners list per circuit
        top_winners: dict[str, list[dict[str, Any]]] = {}
        for cid, wmap in circuit_winners.items():
            ranked = sorted(wmap.items(), key=lambda kv: (-kv[1], kv[0]))[:4]
            top_winners[cid] = [{"driver": d, "wins": c} for d, c in ranked]

        return {
            "driver_circuit": driver_circuit,
            "team_circuit_era": team_circuit_era,
            "team_circuit_all": team_circuit_all,
            "driver_psych": driver_psych,
            "top_winners": top_winners,
        }
    finally:
        conn.close()


def _ensure_cache(db_path: Path) -> dict[str, Any]:
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    with _CACHE_LOCK:
        if _CACHE is None:
            _CACHE = _build_cache(db_path)
    return _CACHE


def get_driver_psychology(db_path: Path, driver_name: str) -> dict[str, Any]:
    cache = _ensure_cache(db_path)
    dkey = _norm_key(driver_name)
    found = cache["driver_psych"].get(dkey)
    if found:
        return dict(found)
    return {
        "starts": 0,
        "avg_perf": 0.45,
        "dnf_rate": 14.0,
        "aggression": 68,
        "composure": 70,
        "wet_confidence": 66,
        "recovery": 68,
        "persona": "rookie_hungry",
    }


def get_track_balance_bundle(
    db_path: Path,
    circuit_id: str,
    era_key: str,
    drivers: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """
    Compute per-driver & per-team affinity modifiers (-3.0 to +4.0 rating points)
    for a given circuit & era using Bayesian shrinkage over historical f1.sqlite results.
    """
    cache = _ensure_cache(db_path)
    cid = (circuit_id or "").strip().lower()
    ek = era_key_for_year(era_key)

    driver_aff: dict[str, dict[str, Any]] = {}
    team_aff: dict[str, float] = {}
    flat_drv_aff: dict[str, float] = {}
    flat_team_aff: dict[str, float] = {}
    drv_psych_map: dict[str, dict[str, Any]] = {}

    if drivers:
        for d in drivers:
            dname = d.get("driver") or d.get("name") or ""
            tname = d.get("team") or d.get("hero_team") or ""
            dkey = _norm_key(dname)
            tkey = _norm_team_family(tname)
            psych = get_driver_psychology(db_path, dname)

            c_perfs = cache["driver_circuit"].get((dkey, cid), [])
            if c_perfs:
                base_avg = psych["avg_perf"]
                local_avg = sum(c_perfs) / len(c_perfs)
                shrink = len(c_perfs) / (len(c_perfs) + 3.0)
                d_delta = round(max(-2.8, min(3.8, (local_avg - base_avg) * 10.5 * shrink)), 2)
            else:
                d_delta = 0.0

            t_perfs = cache["team_circuit_era"].get((tkey, cid, ek)) or cache["team_circuit_all"].get((tkey, cid), [])
            if t_perfs:
                t_avg = sum(t_perfs) / len(t_perfs)
                shrink_t = len(t_perfs) / (len(t_perfs) + 4.0)
                t_delta = round(max(-2.4, min(3.2, (t_avg - 0.48) * 7.5 * shrink_t)), 2)
            else:
                t_delta = 0.0

            team_aff[tname] = t_delta
            flat_team_aff[tkey] = t_delta
            flat_drv_aff[dkey] = d_delta
            drv_psych_map[dkey] = psych
            driver_aff[dname] = {
                "driver_delta": d_delta,
                "team_delta": t_delta,
                "total_delta": round(max(-3.5, min(4.5, d_delta + t_delta * 0.65)), 2),
                "starts_here": len(c_perfs),
                "psych": psych,
            }
    else:
        # Populate flat circuit-wide lookup maps for zero-config frontend consumption
        for (dkey, c_id), c_perfs in cache["driver_circuit"].items():
            if c_id != cid or not c_perfs:
                continue
            psych = cache["driver_psych"].get(dkey)
            base_avg = psych["avg_perf"] if psych else 0.48
            local_avg = sum(c_perfs) / len(c_perfs)
            shrink = len(c_perfs) / (len(c_perfs) + 3.0)
            flat_drv_aff[dkey] = round(max(-2.8, min(3.8, (local_avg - base_avg) * 10.5 * shrink)), 2)
        seen_teams: set[str] = set()
        for (tkey, c_id, e_k), t_perfs in cache["team_circuit_era"].items():
            if c_id != cid or e_k != ek or not t_perfs:
                continue
            seen_teams.add(tkey)
            t_avg = sum(t_perfs) / len(t_perfs)
            shrink_t = len(t_perfs) / (len(t_perfs) + 4.0)
            flat_team_aff[tkey] = round(max(-2.4, min(3.2, (t_avg - 0.48) * 7.5 * shrink_t)), 2)
        for (tkey, c_id), t_perfs in cache["team_circuit_all"].items():
            if c_id != cid or tkey in seen_teams or not t_perfs:
                continue
            t_avg = sum(t_perfs) / len(t_perfs)
            shrink_t = len(t_perfs) / (len(t_perfs) + 4.0)
            flat_team_aff[tkey] = round(max(-2.4, min(3.2, (t_avg - 0.48) * 7.5 * shrink_t)), 2)
        drv_psych_map = cache["driver_psych"]

    from .driver_dna import get_driver_dna_map
    req_names = [d.get("driver") or d.get("name") or "" for d in (drivers or [])] if drivers else None
    dna_map = get_driver_dna_map(db_path, req_names)

    return {
        "circuit_id": cid,
        "era_key": ek,
        "top_winners": cache["top_winners"].get(cid, []),
        "driver_affinities": driver_aff,
        "team_affinities": team_aff,
        "driver_affinity": flat_drv_aff,
        "team_affinity": flat_team_aff,
        "driver_psychology": drv_psych_map,
        "driver_dna": dna_map,
    }
