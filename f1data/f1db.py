"""
Read-only query & analytics layer for the TracingInsights F1DB SQLite database
(`data/f1db.sqlite`, synced from https://tracinginsights.com/f1db).

Gracefully degrades (returns empty/None) when `data/f1db.sqlite` is absent so
cold installs and isolated tests continue working seamlessly.
"""
from __future__ import annotations

import json
import re
import sqlite3
import threading
import unicodedata
from pathlib import Path
from typing import Any

DEFAULT_F1DB_PATH = Path(__file__).resolve().parent.parent / "data" / "f1db.sqlite"

# Canonical TRAF1 local circuit_id -> F1DB circuits.id mapping
LOCAL_TO_F1DB_CIRCUIT: dict[str, str] = {
    "abudhabi": "yas-marina",
    "ain_diab": "ain-diab",
    "barcelona": "catalunya",
    "boavista": "porto",
    "brands_hatch": "brands-hatch",
    "buenos_aires": "buenos-aires",
    "bugatti_lemans": "bugatti",
    "caesars_palace": "caesars-palace",
    "charade": "clermont-ferrand",
    "east_london": "east-london",
    "hockenheim": "hockenheimring",
    "hockenheimring": "hockenheimring",
    "long_beach": "long-beach",
    "madrid": "madring",
    "magny_cours": "magny-cours",
    "mexico": "mexico-city",
    "mont_tremblant": "mont-tremblant",
    "nordschleife": "nurburgring",
    "paul_ricard": "paul-ricard",
    "qatar": "lusail",
    "singapore": "marina-bay",
    "sochi": "sirius",
    "spa": "spa-francorchamps",
    "vegas": "las-vegas",
    "watkins_glen": "watkins-glen",
}

F1DB_TO_LOCAL_CIRCUIT: dict[str, str] = {v: k for k, v in LOCAL_TO_F1DB_CIRCUIT.items()}

# Retirement reasons classified as driver/incident errors vs mechanical/car failures
CRASH_RETIREMENT_KEYWORDS = (
    "accident",
    "collision",
    "spun off",
    "spin",
    "crash",
    "damage",
    "barrier",
    "wall",
    "gravel",
    "off track",
    "disqualified",
)

MECHANICAL_RETIREMENT_KEYWORDS = (
    "engine",
    "gearbox",
    "suspension",
    "electrical",
    "transmission",
    "brakes",
    "brake",
    "clutch",
    "hydraulics",
    "fuel",
    "turbo",
    "overheating",
    "ignition",
    "oil",
    "throttle",
    "halfshaft",
    "driveshaft",
    "power unit",
    "water",
    "radiator",
    "alternator",
    "battery",
    "differential",
    "wheel",
    "puncture",
    "exhaust",
    "steering",
    "pneumatics",
    "ers",
    "mgu",
    "electronics",
    "mechanical",
    "axle",
    "chassis",
    "fire",
    "vibrations",
    "cooling",
)

_METRICS_LOCK = threading.Lock()
_METRICS_CACHE: dict[str, dict[str, Any]] = {}
_CIRCUIT_LOCK = threading.Lock()
_CIRCUIT_CACHE: dict[str, dict[str, dict[str, Any]]] = {}


def _norm_key(raw: str) -> str:
    s = unicodedata.normalize("NFKD", str(raw or "")).encode("ascii", "ignore").decode("ascii").lower()
    s = re.sub(r"\s+[a-z]{3}$", "", s.strip())
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def resolve_f1db_circuit_id(circuit_id: str) -> str:
    cid = (circuit_id or "").strip().lower()
    if cid in LOCAL_TO_F1DB_CIRCUIT:
        return LOCAL_TO_F1DB_CIRCUIT[cid]
    return cid.replace("_", "-")


def resolve_f1db_path(f1db_path: str | Path | None = None) -> Path:
    if f1db_path is None:
        return DEFAULT_F1DB_PATH
    p = Path(f1db_path)
    # If caller passed data/f1.sqlite, look for sibling data/f1db.sqlite
    if p.name == "f1.sqlite":
        return p.parent / "f1db.sqlite"
    return p


def _connect_ro(f1db_path: str | Path | None = None) -> sqlite3.Connection | None:
    p = resolve_f1db_path(f1db_path)
    if not p.exists() or p.stat().st_size == 0:
        return None
    con = sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=5.0)
    con.row_factory = sqlite3.Row
    return con


def invalidate_caches() -> None:
    with _METRICS_LOCK:
        _METRICS_CACHE.clear()
    with _CIRCUIT_LOCK:
        _CIRCUIT_CACHE.clear()


def _quote_ident(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def get_f1db_status(f1db_path: str | Path | None = None) -> dict[str, Any]:
    p = resolve_f1db_path(f1db_path)
    con = _connect_ro(p)
    if con is None:
        return {"available": False, "path": str(p), "tableCount": 0, "totalRows": 0}
    try:
        meta = dict(con.execute("SELECT key, value FROM _f1db_meta").fetchall())
        row = con.execute("SELECT COUNT(*), COALESCE(SUM(row_count), 0), COALESCE(SUM(size_bytes), 0) FROM _f1db_catalog").fetchone()
        max_year, max_round = con.execute(
            "SELECT year, round FROM races_race_results ORDER BY year DESC, round DESC LIMIT 1"
        ).fetchone() or (None, None)
        return {
            "available": True,
            "path": str(p),
            "sqliteBytes": p.stat().st_size,
            "source": meta.get("source", "https://tracinginsights.com/f1db"),
            "lastUpdated": meta.get("lastUpdated"),
            "version": meta.get("version"),
            "tableCount": int(row[0]),
            "totalRows": int(row[1]),
            "parquetBytes": int(row[2]),
            "latestRaceResults": {"year": max_year, "round": max_round},
        }
    finally:
        con.close()


def list_tables(f1db_path: str | Path | None = None) -> list[dict[str, Any]]:
    con = _connect_ro(f1db_path)
    if con is None:
        return []
    try:
        rows = con.execute(
            "SELECT table_name, row_count, size_bytes, parquet_path, columns_json FROM _f1db_catalog ORDER BY table_name"
        ).fetchall()
        out = []
        for r in rows:
            cols = json.loads(r["columns_json"])
            out.append(
                {
                    "name": r["table_name"],
                    "rowCount": int(r["row_count"]),
                    "sizeBytes": int(r["size_bytes"]),
                    "parquetPath": r["parquet_path"],
                    "columnCount": len(cols),
                    "columns": cols,
                }
            )
        return out
    finally:
        con.close()


def query_table(
    table_name: str,
    *,
    f1db_path: str | Path | None = None,
    search: str = "",
    year: int | None = None,
    sort_col: str | None = None,
    sort_dir: str = "asc",
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any] | None:
    con = _connect_ro(f1db_path)
    if con is None:
        return None
    try:
        meta = con.execute(
            "SELECT table_name, row_count, size_bytes, parquet_path, columns_json FROM _f1db_catalog WHERE table_name = ?",
            (table_name,),
        ).fetchone()
        if not meta:
            return None
        cols = json.loads(meta["columns_json"])
        col_names = [c["name"] for c in cols]

        where_parts: list[str] = []
        params: list[Any] = []
        if year is not None and "year" in col_names:
            where_parts.append('"year" = ?')
            params.append(int(year))
        q = (search or "").strip()
        if q:
            like_val = f"%{q}%"
            # Search across first 12 columns to stay fast even on wide tables
            search_cols = [c["name"] for c in cols[:12]]
            or_clause = " OR ".join(f"CAST({_quote_ident(c)} AS TEXT) LIKE ?" for c in search_cols)
            where_parts.append(f"({or_clause})")
            params.extend([like_val] * len(search_cols))

        where_sql = (" WHERE " + " AND ".join(where_parts)) if where_parts else ""
        order_sql = ""
        if sort_col and sort_col in col_names:
            direction = "DESC" if str(sort_dir).lower() == "desc" else "ASC"
            order_sql = f" ORDER BY {_quote_ident(sort_col)} {direction}"
        elif "year" in col_names and "round" in col_names:
            order_sql = ' ORDER BY "year" DESC, "round" DESC'
        elif "year" in col_names:
            order_sql = ' ORDER BY "year" DESC'

        lim = max(1, min(250, int(limit)))
        off = max(0, int(offset))

        t_quoted = _quote_ident(table_name)
        total_filtered = int(
            con.execute(f"SELECT COUNT(*) FROM {t_quoted}{where_sql}", params).fetchone()[0]
        )
        rows = con.execute(
            f"SELECT * FROM {t_quoted}{where_sql}{order_sql} LIMIT ? OFFSET ?",
            params + [lim, off],
        ).fetchall()

        return {
            "table": table_name,
            "totalRows": int(meta["row_count"]),
            "filteredRows": total_filtered,
            "limit": lim,
            "offset": off,
            "hasYearColumn": "year" in col_names,
            "columns": cols,
            "rows": [dict(r) for r in rows],
        }
    finally:
        con.close()


def get_season_dossier(year: int, f1db_path: str | Path | None = None) -> dict[str, Any] | None:
    """Return full FIA technical/sporting/qualifying/points regulations & hardware for a season (1950-2026)."""
    con = _connect_ro(f1db_path)
    if con is None:
        return None
    try:
        yr = int(year)
        era = con.execute("SELECT * FROM seasons_eras WHERE year = ?", (yr,)).fetchone()
        tech = con.execute("SELECT * FROM seasons_technical_regulations WHERE year = ?", (yr,)).fetchone()
        sport = con.execute("SELECT * FROM seasons_sporting_regulations WHERE year = ?", (yr,)).fetchone()
        quali = con.execute("SELECT * FROM seasons_qualifying_formats WHERE year = ?", (yr,)).fetchone()
        pts = con.execute("SELECT * FROM seasons_points_systems WHERE year = ?", (yr,)).fetchone()
        sprint_pts = con.execute("SELECT * FROM seasons_sprint_points_systems WHERE year = ?", (yr,)).fetchone()
        overrides = [
            dict(r)
            for r in con.execute("SELECT * FROM seasons_points_overrides WHERE year = ? ORDER BY round", (yr,)).fetchall()
        ]
        if not any((era, tech, sport, quali, pts)):
            return None

        # Constructor -> Chassis + Engine + Tyre hardware grid for this season
        hardware = [
            dict(r)
            for r in con.execute(
                """
                SELECT
                    sec.constructorId AS constructorId,
                    c.name AS constructorName,
                    em.name AS engineManufacturer,
                    GROUP_CONCAT(DISTINCT ch.name) AS chassis,
                    GROUP_CONCAT(DISTINCT e.fullName) AS engines,
                    GROUP_CONCAT(DISTINCT tm.name) AS tyres
                FROM seasons_entrants_constructors sec
                LEFT JOIN constructors c ON c.id = sec.constructorId
                LEFT JOIN engine_manufacturers em ON em.id = sec.engineManufacturerId
                LEFT JOIN seasons_entrants_chassis sech
                    ON sech.year = sec.year AND sech.entrantId = sec.entrantId AND sech.constructorId = sec.constructorId
                LEFT JOIN chassis ch ON ch.id = sech.chassisId
                LEFT JOIN seasons_entrants_engines see
                    ON see.year = sec.year AND see.entrantId = sec.entrantId AND see.constructorId = sec.constructorId
                LEFT JOIN engines e ON e.id = see.engineId
                LEFT JOIN seasons_entrants_tyre_manufacturers setm
                    ON setm.year = sec.year AND setm.entrantId = sec.entrantId AND setm.constructorId = sec.constructorId
                LEFT JOIN tyre_manufacturers tm ON tm.id = setm.tyreManufacturerId
                WHERE sec.year = ?
                GROUP BY sec.constructorId, c.name, em.name
                ORDER BY c.name
                """,
                (yr,),
            ).fetchall()
        ]

        races = [
            dict(r)
            for r in con.execute(
                """
                SELECT r.id, r.round, r.date, r.officialName, r.grandPrixId, r.circuitId,
                       c.name AS circuitName, r.courseLength, r.turns, r.laps,
                       r.sprintRaceLaps,
                       (SELECT COUNT(*) FROM races_safety_cars sc WHERE sc.raceId = r.id) AS scCount,
                       (SELECT COUNT(*) FROM races_virtual_safety_cars vsc WHERE vsc.raceId = r.id) AS vscCount,
                       (SELECT COUNT(*) FROM races_red_flags rf WHERE rf.raceId = r.id) AS redFlagCount
                FROM races r
                LEFT JOIN circuits c ON c.id = r.circuitId
                WHERE r.year = ?
                ORDER BY r.round
                """,
                (yr,),
            ).fetchall()
        ]

        return {
            "year": yr,
            "era": dict(era) if era else None,
            "technical": dict(tech) if tech else None,
            "sporting": dict(sport) if sport else None,
            "qualifying": dict(quali) if quali else None,
            "pointsSystem": dict(pts) if pts else None,
            "sprintPointsSystem": dict(sprint_pts) if sprint_pts else None,
            "pointsOverrides": overrides,
            "hardware": hardware,
            "races": races,
        }
    finally:
        con.close()


def _build_all_circuit_profiles(f1db_path: Path) -> dict[str, dict[str, Any]]:
    con = _connect_ro(f1db_path)
    if con is None:
        return {}
    try:
        circuits = {r["id"]: dict(r) for r in con.execute("SELECT * FROM circuits").fetchall()}
        layouts_by_c: dict[str, list[dict[str, Any]]] = {}
        for r in con.execute("SELECT * FROM circuits_layouts ORDER BY circuitId, effective DESC, id").fetchall():
            layouts_by_c.setdefault(r["circuitId"], []).append(dict(r))

        # Races per circuit (total, SC-era 1973+, VSC-era 2015+)
        race_counts: dict[str, dict[str, int]] = {}
        for r in con.execute(
            """
            SELECT circuitId,
                   COUNT(*) AS total_races,
                   SUM(CASE WHEN year >= 1973 THEN 1 ELSE 0 END) AS sc_era_races,
                   SUM(CASE WHEN year >= 2015 THEN 1 ELSE 0 END) AS vsc_era_races,
                   SUM(CASE WHEN year >= 2018 THEN 1 ELSE 0 END) AS modern_races
            FROM races
            GROUP BY circuitId
            """
        ).fetchall():
            race_counts[r["circuitId"]] = dict(r)

        sc_by_c: dict[str, dict[str, Any]] = {}
        for r in con.execute(
            """
            SELECT r.circuitId,
                   COUNT(*) AS deployments,
                   COUNT(DISTINCT sc.raceId) AS races_with_sc,
                   COALESCE(SUM(sc.fullLaps), 0) AS total_sc_laps
            FROM races_safety_cars sc
            JOIN races r ON r.id = sc.raceId
            GROUP BY r.circuitId
            """
        ).fetchall():
            sc_by_c[r["circuitId"]] = dict(r)

        vsc_by_c: dict[str, dict[str, Any]] = {}
        for r in con.execute(
            """
            SELECT r.circuitId,
                   COUNT(*) AS deployments,
                   COUNT(DISTINCT v.raceId) AS races_with_vsc
            FROM races_virtual_safety_cars v
            JOIN races r ON r.id = v.raceId
            GROUP BY r.circuitId
            """
        ).fetchall():
            vsc_by_c[r["circuitId"]] = dict(r)

        rf_by_c: dict[str, dict[str, Any]] = {}
        for r in con.execute(
            """
            SELECT r.circuitId,
                   COUNT(*) AS deployments,
                   COUNT(DISTINCT rf.raceId) AS races_with_rf
            FROM races_red_flags rf
            JOIN races r ON r.id = rf.raceId
            GROUP BY r.circuitId
            """
        ).fetchall():
            rf_by_c[r["circuitId"]] = dict(r)

        # Pit stop lane-loss benchmarks (modern 2014+ reasonable stops 12s..45s to exclude red-flag holds)
        pit_by_c: dict[str, dict[str, Any]] = {}
        pit_rows = con.execute(
            """
            SELECT r.circuitId, ps.timeMillis
            FROM races_pit_stops ps
            JOIN races r ON r.id = ps.raceId
            WHERE ps.year >= 2014 AND ps.timeMillis BETWEEN 12000 AND 45000
            """
        ).fetchall()
        pit_buckets: dict[str, list[int]] = {}
        for cid, ms in pit_rows:
            pit_buckets.setdefault(cid, []).append(int(ms))
        for cid, vals in pit_buckets.items():
            vals.sort()
            mid = vals[len(vals) // 2]
            p10 = vals[max(0, int(len(vals) * 0.10))]
            pit_by_c[cid] = {
                "sampleCount": len(vals),
                "medianPitLaneSec": round(mid / 1000.0, 2),
                "fastPitLaneSec": round(p10 / 1000.0, 2),
            }

        # Fastest race lap record per circuit
        fl_by_c: dict[str, dict[str, Any]] = {}
        for r in con.execute(
            """
            SELECT r.circuitId, fl.year, fl.time, fl.timeMillis, d.name AS driverName, c.name AS constructorName
            FROM races_fastest_laps fl
            JOIN races r ON r.id = fl.raceId
            LEFT JOIN drivers d ON d.id = fl.driverId
            LEFT JOIN constructors c ON c.id = fl.constructorId
            WHERE fl.positionNumber = 1 AND fl.timeMillis IS NOT NULL AND fl.timeMillis > 0
            ORDER BY r.circuitId, fl.timeMillis ASC
            """
        ).fetchall():
            if r["circuitId"] not in fl_by_c:
                fl_by_c[r["circuitId"]] = dict(r)

        out: dict[str, dict[str, Any]] = {}
        for cid, cinfo in circuits.items():
            rc = race_counts.get(cid, {})
            total_r = max(1, int(rc.get("total_races") or cinfo.get("totalRacesHeld") or 1))
            sc_era_r = max(1, int(rc.get("sc_era_races") or 0))
            vsc_era_r = max(1, int(rc.get("vsc_era_races") or 0))

            sc_info = sc_by_c.get(cid, {})
            vsc_info = vsc_by_c.get(cid, {})
            rf_info = rf_by_c.get(cid, {})

            sc_prob = round(min(0.95, int(sc_info.get("races_with_sc") or 0) / sc_era_r), 3) if rc.get("sc_era_races") else 0.32
            vsc_prob = round(min(0.85, int(vsc_info.get("races_with_vsc") or 0) / vsc_era_r), 3) if rc.get("vsc_era_races") else 0.25
            rf_prob = round(min(0.50, int(rf_info.get("races_with_rf") or 0) / total_r), 3)

            # Relative safety car multiplier vs F1 historical baseline (~0.42 SC probability/race)
            sc_mult = round(max(0.55, min(1.85, (sc_prob + 0.15) / 0.57)), 2)

            out[cid] = {
                "circuit": cinfo,
                "layouts": layouts_by_c.get(cid, []),
                "racesHeld": int(rc.get("total_races") or 0),
                "incidents": {
                    "safetyCarDeployments": int(sc_info.get("deployments") or 0),
                    "safetyCarRaces": int(sc_info.get("races_with_sc") or 0),
                    "safetyCarProbability": sc_prob,
                    "safetyCarMultiplier": sc_mult,
                    "vscDeployments": int(vsc_info.get("deployments") or 0),
                    "vscProbability": vsc_prob,
                    "redFlagDeployments": int(rf_info.get("deployments") or 0),
                    "redFlagProbability": rf_prob,
                },
                "pitStops": pit_by_c.get(cid),
                "lapRecord": fl_by_c.get(cid),
            }
        return out
    finally:
        con.close()


def get_circuit_profile(circuit_id: str, f1db_path: str | Path | None = None) -> dict[str, Any] | None:
    p = resolve_f1db_path(f1db_path)
    key = str(p.resolve())
    with _CIRCUIT_LOCK:
        profiles = _CIRCUIT_CACHE.get(key)
        if profiles is None:
            profiles = _build_all_circuit_profiles(p)
            _CIRCUIT_CACHE[key] = profiles
    if not profiles:
        return None
    f1db_cid = resolve_f1db_circuit_id(circuit_id)
    return profiles.get(f1db_cid)


def get_all_driver_f1db_metrics(f1db_path: str | Path | None = None) -> dict[str, dict[str, Any]]:
    """
    Precompute rich per-driver F1DB metrics across all 921 drivers:
      - Bio & career records (poles, wins, podiums, fastest laps, DOTD, Grand Slams, nationality, DOB, permanentNumber)
      - True mechanical DNF rate vs crash/collision DNF rate from `reasonRetired`
      - Qualifying sharpness (pole rate, front-row rate, avg quali position)
      - Racecraft / overtaking (avg `positionsGained` from grid to chequered flag!)
      - Wet-prone & street-circuit performance splits using F1DB `circuits.type = 'STREET'`
    """
    p = resolve_f1db_path(f1db_path)
    cache_key = str(p.resolve())
    with _METRICS_LOCK:
        if cache_key in _METRICS_CACHE:
            return _METRICS_CACHE[cache_key]

    con = _connect_ro(p)
    if con is None:
        return {}

    try:
        countries = {
            r["id"]: {"name": r["name"], "demonym": r["demonym"], "alpha2": r["alpha2Code"], "ioc": r["iocCode"]}
            for r in con.execute("SELECT id, name, demonym, alpha2Code, iocCode FROM countries").fetchall()
        }
        street_circuits = {
            r["id"] for r in con.execute("SELECT id FROM circuits WHERE UPPER(type) = 'STREET'").fetchall()
        }
        wet_circuits = {
            "spa-francorchamps", "interlagos", "silverstone", "suzuka", "monaco",
            "nurburgring", "imola", "montreal", "hockenheimring", "sepang", "fuji", "zandvoort",
        }

        drivers_by_id: dict[str, dict[str, Any]] = {}
        for r in con.execute("SELECT * FROM drivers").fetchall():
            d = dict(r)
            nat = countries.get(d.get("nationalityCountryId") or "", {})
            d["_nationalityName"] = nat.get("name")
            d["_demonym"] = nat.get("demonym")
            d["_ioc"] = nat.get("ioc")
            drivers_by_id[d["id"]] = d

        # Aggregate race_results metrics per driverId
        agg: dict[str, dict[str, Any]] = {}
        for r in con.execute(
            """
            SELECT rr.driverId, rr.positionNumber, rr.positionText, rr.gridPositionNumber,
                   rr.positionsGained, rr.reasonRetired, rr.polePosition, rr.fastestLap,
                   rr.driverOfTheDay, r.circuitId
            FROM races_race_results rr
            JOIN races r ON r.id = rr.raceId
            WHERE rr.driverId IS NOT NULL
            """
        ).fetchall():
            did = r["driverId"]
            st = agg.setdefault(
                did,
                {
                    "starts": 0,
                    "finishes": 0,
                    "mech_dnfs": 0,
                    "crash_dnfs": 0,
                    "other_dnfs": 0,
                    "pos_gained_sum": 0.0,
                    "pos_gained_n": 0,
                    "perf_sum": 0.0,
                    "street_perf_sum": 0.0,
                    "street_n": 0,
                    "wet_perf_sum": 0.0,
                    "wet_n": 0,
                },
            )
            st["starts"] += 1
            pos = r["positionNumber"]
            reason = (r["reasonRetired"] or "").strip().lower()
            if pos is not None and not reason:
                st["finishes"] += 1
                perf = max(0.05, min(1.0, 1.0 - (int(pos) - 1) / 19.0))
            else:
                perf = 0.12
                if reason:
                    if any(k in reason for k in CRASH_RETIREMENT_KEYWORDS):
                        st["crash_dnfs"] += 1
                    elif any(k in reason for k in MECHANICAL_RETIREMENT_KEYWORDS):
                        st["mech_dnfs"] += 1
                    else:
                        st["other_dnfs"] += 1
                elif pos is None:
                    st["other_dnfs"] += 1

            st["perf_sum"] += perf
            cid = r["circuitId"] or ""
            if cid in street_circuits:
                st["street_perf_sum"] += perf
                st["street_n"] += 1
            if cid in wet_circuits:
                st["wet_perf_sum"] += perf
                st["wet_n"] += 1

            pg = r["positionsGained"]
            if pg is not None and pos is not None:
                st["pos_gained_sum"] += float(pg)
                st["pos_gained_n"] += 1

        # Qualifying average position & front-row rate
        quali_agg: dict[str, dict[str, Any]] = {}
        for r in con.execute(
            """
            SELECT driverId, COUNT(*) AS n,
                   AVG(positionNumber) AS avg_pos,
                   SUM(CASE WHEN positionNumber <= 2 THEN 1 ELSE 0 END) AS front_rows,
                   SUM(CASE WHEN positionNumber <= 10 THEN 1 ELSE 0 END) AS top10s
            FROM races_qualifying_results
            WHERE driverId IS NOT NULL AND positionNumber IS NOT NULL
            GROUP BY driverId
            """
        ).fetchall():
            quali_agg[r["driverId"]] = {
                "qualiSessions": int(r["n"]),
                "avgQualiPos": round(float(r["avg_pos"]), 2),
                "frontRowRate": round(int(r["front_rows"]) / max(1, int(r["n"])), 3),
                "top10QualiRate": round(int(r["top10s"]) / max(1, int(r["n"])), 3),
            }

        out: dict[str, dict[str, Any]] = {}
        for did, d in drivers_by_id.items():
            st = agg.get(did)
            n = st["starts"] if st and st["starts"] > 0 else int(d.get("totalRaceStarts") or 0)
            qinfo = quali_agg.get(did, {})
            avg_perf = (st["perf_sum"] / st["starts"]) if st and st["starts"] else 0.35
            street_avg = (st["street_perf_sum"] / st["street_n"]) if st and st["street_n"] else avg_perf
            wet_avg = (st["wet_perf_sum"] / st["wet_n"]) if st and st["wet_n"] else avg_perf
            mech_dnf_rate = (st["mech_dnfs"] / st["starts"]) if st and st["starts"] else 0.10
            crash_dnf_rate = (st["crash_dnfs"] / st["starts"]) if st and st["starts"] else 0.08
            avg_pos_gained = (st["pos_gained_sum"] / st["pos_gained_n"]) if st and st["pos_gained_n"] else 0.0

            rec = {
                "f1dbId": did,
                "name": d.get("name"),
                "fullName": d.get("fullName"),
                "abbreviation": d.get("abbreviation"),
                "permanentNumber": d.get("permanentNumber"),
                "dateOfBirth": d.get("dateOfBirth"),
                "dateOfDeath": d.get("dateOfDeath"),
                "nationality": d.get("_nationalityName"),
                "demonym": d.get("_demonym"),
                "iocCode": d.get("_ioc"),
                "starts": n,
                "championships": int(d.get("totalChampionshipWins") or 0),
                "wins": int(d.get("totalRaceWins") or 0),
                "poles": int(d.get("totalPolePositions") or 0),
                "podiums": int(d.get("totalPodiums") or 0),
                "fastestLaps": int(d.get("totalFastestLaps") or 0),
                "sprintWins": int(d.get("totalSprintRaceWins") or 0),
                "driverOfTheDay": int(d.get("totalDriverOfTheDay") or 0),
                "grandSlams": int(d.get("totalGrandSlams") or 0),
                "avgPerf": round(avg_perf, 4),
                "streetAvg": round(street_avg, 4),
                "streetStarts": st["street_n"] if st else 0,
                "wetAvg": round(wet_avg, 4),
                "wetStarts": st["wet_n"] if st else 0,
                "mechDnfRate": round(mech_dnf_rate, 4),
                "crashDnfRate": round(crash_dnf_rate, 4),
                "avgPositionsGained": round(avg_pos_gained, 2),
                "avgQualiPos": qinfo.get("avgQualiPos"),
                "frontRowRate": qinfo.get("frontRowRate"),
                "top10QualiRate": qinfo.get("top10QualiRate"),
            }

            for alias in {d.get("name"), d.get("fullName"), did.replace("-", " ")}:
                nk = _norm_key(alias or "")
                if nk:
                    out[nk] = rec
        with _METRICS_LOCK:
            _METRICS_CACHE[cache_key] = out
        return out
    finally:
        con.close()


def get_driver_f1db_profile(driver_query: str, f1db_path: str | Path | None = None) -> dict[str, Any] | None:
    """Return full F1DB dossier for a single driver (bio, career records, family, retirement breakdown, constructors)."""
    con = _connect_ro(f1db_path)
    if con is None:
        return None
    try:
        q = (driver_query or "").strip()
        if not q:
            return None
        row = con.execute("SELECT * FROM drivers WHERE id = ?", (q.lower(),)).fetchone()
        if not row:
            nk = _norm_key(q)
            metrics = get_all_driver_f1db_metrics(f1db_path)
            hit = metrics.get(nk)
            if hit:
                row = con.execute("SELECT * FROM drivers WHERE id = ?", (hit["f1dbId"],)).fetchone()
        if not row:
            row = con.execute(
                "SELECT * FROM drivers WHERE LOWER(name) LIKE ? ORDER BY totalRaceStarts DESC LIMIT 1",
                (f"%{q.lower()}%",),
            ).fetchone()
        if not row:
            return None

        d = dict(row)
        did = d["id"]
        nat = con.execute("SELECT name, demonym, alpha2Code, iocCode FROM countries WHERE id = ?", (d.get("nationalityCountryId"),)).fetchone()

        family = [
            dict(r)
            for r in con.execute(
                """
                SELECT fr.type, fr.driverId AS relatedDriverId, dr.name AS relatedDriverName, dr.totalChampionshipWins
                FROM drivers_family_relationships fr
                JOIN drivers dr ON dr.id = fr.driverId
                WHERE fr.parentDriverId = ?
                ORDER BY fr.positionDisplayOrder
                """,
                (did,),
            ).fetchall()
        ]

        retirements = [
            dict(r)
            for r in con.execute(
                """
                SELECT reasonRetired, COUNT(*) AS count
                FROM races_race_results
                WHERE driverId = ? AND reasonRetired IS NOT NULL AND TRIM(reasonRetired) != ''
                GROUP BY reasonRetired
                ORDER BY count DESC
                LIMIT 10
                """,
                (did,),
            ).fetchall()
        ]

        constructors = [
            dict(r)
            for r in con.execute(
                """
                SELECT c.id, c.name, MIN(rr.year) AS firstYear, MAX(rr.year) AS lastYear,
                       COUNT(*) AS starts,
                       SUM(CASE WHEN rr.positionNumber = 1 THEN 1 ELSE 0 END) AS wins,
                       SUM(CASE WHEN rr.positionNumber <= 3 THEN 1 ELSE 0 END) AS podiums
                FROM races_race_results rr
                JOIN constructors c ON c.id = rr.constructorId
                WHERE rr.driverId = ?
                GROUP BY c.id, c.name
                ORDER BY starts DESC
                """,
                (did,),
            ).fetchall()
        ]

        metrics = get_all_driver_f1db_metrics(f1db_path).get(_norm_key(d.get("name") or ""), {})
        return {
            "driver": d,
            "nationality": dict(nat) if nat else None,
            "metrics": metrics,
            "family": family,
            "retirements": retirements,
            "constructors": constructors,
        }
    finally:
        con.close()


def get_race_weekend_dossier(year: int, round_num: int, f1db_path: str | Path | None = None) -> dict[str, Any] | None:
    """Return full F1DB race weekend packet: race, circuit, qualifying, sprint, results, pit stops, SC, VSC, Red Flags, DOTD."""
    con = _connect_ro(f1db_path)
    if con is None:
        return None
    try:
        race = con.execute(
            """
            SELECT r.*, c.name AS circuitName, c.fullName AS circuitFullName, c.type AS circuitTypeName,
                   c.placeName, c.countryId AS circuitCountryId, gp.name AS grandPrixName
            FROM races r
            LEFT JOIN circuits c ON c.id = r.circuitId
            LEFT JOIN grands_prix gp ON gp.id = r.grandPrixId
            WHERE r.year = ? AND r.round = ?
            """,
            (int(year), int(round_num)),
        ).fetchone()
        if not race:
            return None
        rid = race["id"]

        results = [
            dict(r)
            for r in con.execute(
                """
                SELECT rr.*, d.name AS driverName, d.abbreviation AS driverAbbr,
                       c.name AS constructorName, em.name AS engineManufacturerName, tm.name AS tyreName
                FROM races_race_results rr
                LEFT JOIN drivers d ON d.id = rr.driverId
                LEFT JOIN constructors c ON c.id = rr.constructorId
                LEFT JOIN engine_manufacturers em ON em.id = rr.engineManufacturerId
                LEFT JOIN tyre_manufacturers tm ON tm.id = rr.tyreManufacturerId
                WHERE rr.raceId = ?
                ORDER BY rr.positionDisplayOrder
                """,
                (rid,),
            ).fetchall()
        ]

        qualifying = [
            dict(r)
            for r in con.execute(
                """
                SELECT q.*, d.name AS driverName, d.abbreviation AS driverAbbr, c.name AS constructorName
                FROM races_qualifying_results q
                LEFT JOIN drivers d ON d.id = q.driverId
                LEFT JOIN constructors c ON c.id = q.constructorId
                WHERE q.raceId = ?
                ORDER BY q.positionDisplayOrder
                """,
                (rid,),
            ).fetchall()
        ]

        sprint = [
            dict(r)
            for r in con.execute(
                """
                SELECT sr.*, d.name AS driverName, d.abbreviation AS driverAbbr, c.name AS constructorName
                FROM races_sprint_race_results sr
                LEFT JOIN drivers d ON d.id = sr.driverId
                LEFT JOIN constructors c ON c.id = sr.constructorId
                WHERE sr.raceId = ?
                ORDER BY sr.positionDisplayOrder
                """,
                (rid,),
            ).fetchall()
        ]

        pit_stops = [
            dict(r)
            for r in con.execute(
                """
                SELECT ps.*, d.name AS driverName, d.abbreviation AS driverAbbr, c.name AS constructorName
                FROM races_pit_stops ps
                LEFT JOIN drivers d ON d.id = ps.driverId
                LEFT JOIN constructors c ON c.id = ps.constructorId
                WHERE ps.raceId = ?
                ORDER BY ps.lap, ps.stop
                """,
                (rid,),
            ).fetchall()
        ]

        safety_cars = [
            dict(r)
            for r in con.execute("SELECT * FROM races_safety_cars WHERE raceId = ? ORDER BY deployed", (rid,)).fetchall()
        ]
        vscs = [
            dict(r)
            for r in con.execute("SELECT * FROM races_virtual_safety_cars WHERE raceId = ? ORDER BY deployed", (rid,)).fetchall()
        ]
        red_flags = [
            dict(r)
            for r in con.execute("SELECT * FROM races_red_flags WHERE raceId = ? ORDER BY lap", (rid,)).fetchall()
        ]
        dotd = [
            dict(r)
            for r in con.execute(
                """
                SELECT dt.*, d.name AS driverName, d.abbreviation AS driverAbbr, c.name AS constructorName
                FROM races_driver_of_the_day_results dt
                LEFT JOIN drivers d ON d.id = dt.driverId
                LEFT JOIN constructors c ON c.id = dt.constructorId
                WHERE dt.raceId = ?
                ORDER BY dt.positionDisplayOrder
                """,
                (rid,),
            ).fetchall()
        ]

        return {
            "race": dict(race),
            "results": results,
            "qualifying": qualifying,
            "sprint": sprint,
            "pitStops": pit_stops,
            "safetyCars": safety_cars,
            "virtualSafetyCars": vscs,
            "redFlags": red_flags,
            "driverOfTheDay": dotd,
        }
    finally:
        con.close()
