"""
TracingInsights F1DB Sync Engine (`https://tracinginsights.com/f1db`).

Downloads the static F1DB manifest + Parquet catalog (58 tables, 1.1M+ rows,
CC BY 4.0) with ETag caching into `data/f1db_parquet/` and compiles a single
indexed SQLite database at `data/f1db.sqlite` for zero-dependency runtime reads.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import sqlite3
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests

BASE_URL = "https://tracinginsights.com"
MANIFEST_URL = f"{BASE_URL}/f1db/manifest.json"

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
}

# Helpful indexes built after loading into SQLite for fast O(log N) lookups.
TABLE_INDEXES: dict[str, list[tuple[str, ...]]] = {
    "drivers": [("id",), ("name",), ("abbreviation",), ("nationalityCountryId",)],
    "constructors": [("id",), ("name",)],
    "circuits": [("id",), ("countryId",)],
    "circuits_layouts": [("circuitId",)],
    "chassis": [("constructorId",)],
    "engines": [("engineManufacturerId",)],
    "races": [("id",), ("year", "round"), ("circuitId",), ("grandPrixId",)],
    "races_race_results": [("raceId",), ("year", "round"), ("driverId",), ("constructorId",)],
    "races_qualifying_results": [("raceId",), ("year", "round"), ("driverId",), ("constructorId",)],
    "races_starting_grid_positions": [("raceId",), ("driverId",)],
    "races_pit_stops": [("raceId",), ("year", "round"), ("driverId",), ("constructorId",)],
    "races_fastest_laps": [("raceId",), ("year", "round"), ("driverId",)],
    "races_safety_cars": [("raceId",), ("year",)],
    "races_virtual_safety_cars": [("raceId",), ("year",)],
    "races_red_flags": [("raceId",), ("year",)],
    "races_lap_times": [("raceId", "driverId"), ("driverId",)],
    "races_sprint_race_results": [("raceId",), ("year", "round"), ("driverId",)],
    "races_sprint_qualifying_results": [("raceId",), ("driverId",)],
    "races_driver_of_the_day_results": [("raceId",), ("driverId",)],
    "races_driver_standings": [("raceId",), ("year", "round"), ("driverId",)],
    "races_constructor_standings": [("raceId",), ("year", "round"), ("constructorId",)],
    "seasons_drivers": [("year",), ("driverId",)],
    "seasons_constructors": [("year",), ("constructorId",)],
    "seasons_driver_standings": [("year",), ("driverId",)],
    "seasons_constructor_standings": [("year",), ("constructorId",)],
    "seasons_entrants_drivers": [("year",), ("driverId",), ("constructorId",)],
    "seasons_entrants_chassis": [("year",), ("constructorId",)],
    "seasons_entrants_engines": [("year",), ("constructorId",)],
    "seasons_entrants_tyre_manufacturers": [("year",), ("constructorId",)],
    "seasons_technical_regulations": [("year",)],
    "seasons_sporting_regulations": [("year",)],
    "seasons_qualifying_formats": [("year",)],
    "seasons_points_systems": [("year",)],
    "seasons_sprint_points_systems": [("year",)],
    "seasons_eras": [("year",)],
}


def fetch_manifest(timeout: float = 20.0) -> dict[str, Any]:
    resp = requests.get(MANIFEST_URL, headers=DEFAULT_HEADERS, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def _download_one(
    table_name: str,
    meta: dict[str, Any],
    parquet_dir: Path,
    etags: dict[str, str],
    force: bool = False,
) -> tuple[str, Path, bool, int]:
    parquet_path = meta["parquetPath"]
    url = urljoin(BASE_URL, parquet_path)
    out_file = parquet_dir / f"{table_name}.parquet"
    remote_etag = str(meta.get("etag") or "")
    if not force and out_file.exists() and remote_etag and etags.get(table_name) == remote_etag:
        return table_name, out_file, False, out_file.stat().st_size

    resp = requests.get(url, headers=DEFAULT_HEADERS, timeout=45)
    resp.raise_for_status()
    tmp = out_file.with_suffix(".parquet.tmp")
    tmp.write_bytes(resp.content)
    tmp.replace(out_file)
    return table_name, out_file, True, len(resp.content)


def _sqlite_type(duck_type: str) -> str:
    t = (duck_type or "").upper()
    if any(k in t for k in ("INT", "BOOL")):
        return "INTEGER"
    if any(k in t for k in ("DOUBLE", "FLOAT", "DECIMAL", "REAL")):
        return "REAL"
    return "TEXT"


def _quote_ident(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def build_sqlite_from_parquets(
    manifest: dict[str, Any],
    parquet_dir: Path,
    sqlite_path: Path,
) -> dict[str, int]:
    """Compile all downloaded F1DB Parquet files into an indexed SQLite DB atomically."""
    import duckdb  # lazy import: only required during sync, not runtime

    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_db = sqlite_path.with_suffix(".sqlite.tmp")
    if tmp_db.exists():
        tmp_db.unlink()

    con = sqlite3.connect(str(tmp_db))
    con.execute("PRAGMA synchronous = OFF")
    con.execute("PRAGMA journal_mode = OFF")
    con.execute("PRAGMA temp_store = MEMORY")

    con.execute(
        """
        CREATE TABLE _f1db_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    con.execute(
        """
        CREATE TABLE _f1db_catalog (
            table_name TEXT PRIMARY KEY,
            row_count INTEGER NOT NULL,
            size_bytes INTEGER NOT NULL,
            parquet_path TEXT NOT NULL,
            etag TEXT NOT NULL,
            columns_json TEXT NOT NULL
        )
        """
    )

    duck = duckdb.connect(":memory:")
    row_counts: dict[str, int] = {}

    try:
        tables = manifest.get("tables", {})
        for table_name, meta in sorted(tables.items()):
            pq_file = parquet_dir / f"{table_name}.parquet"
            if not pq_file.exists():
                continue

            rel = duck.read_parquet(str(pq_file))
            col_names = list(rel.columns)
            col_types = [str(t) for t in rel.dtypes]

            col_defs = ", ".join(
                f"{_quote_ident(c)} {_sqlite_type(t)}"
                for c, t in zip(col_names, col_types)
            )
            con.execute(f"CREATE TABLE {_quote_ident(table_name)} ({col_defs})")

            placeholders = ", ".join(["?"] * len(col_names))
            insert_sql = f"INSERT INTO {_quote_ident(table_name)} VALUES ({placeholders})"

            cur = duck.execute(f"SELECT * FROM read_parquet(?)", [str(pq_file)])
            total_inserted = 0
            while True:
                batch = cur.fetchmany(25000)
                if not batch:
                    break
                # Convert Python booleans/dates safely for sqlite3
                cleaned = [
                    tuple(
                        (int(v) if isinstance(v, bool) else (v.isoformat() if hasattr(v, "isoformat") else v))
                        for v in row
                    )
                    for row in batch
                ]
                con.executemany(insert_sql, cleaned)
                total_inserted += len(cleaned)

            row_counts[table_name] = total_inserted
            con.execute(
                "INSERT INTO _f1db_catalog VALUES (?, ?, ?, ?, ?, ?)",
                (
                    table_name,
                    total_inserted,
                    int(meta.get("size") or pq_file.stat().st_size),
                    str(meta.get("parquetPath") or ""),
                    str(meta.get("etag") or ""),
                    json.dumps(meta.get("columns") or []),
                ),
            )

            for idx_cols in TABLE_INDEXES.get(table_name, []):
                if all(c in col_names for c in idx_cols):
                    idx_name = f"idx_{table_name}_{'_'.join(idx_cols)}"
                    cols_sql = ", ".join(_quote_ident(c) for c in idx_cols)
                    con.execute(
                        f"CREATE INDEX IF NOT EXISTS {_quote_ident(idx_name)} "
                        f"ON {_quote_ident(table_name)} ({cols_sql})"
                    )

        con.execute("INSERT INTO _f1db_meta VALUES ('version', ?)", (str(manifest.get("version") or ""),))
        con.execute("INSERT INTO _f1db_meta VALUES ('lastUpdated', ?)", (str(manifest.get("lastUpdated") or ""),))
        con.execute("INSERT INTO _f1db_meta VALUES ('schemaHash', ?)", (str(manifest.get("schemaHash") or ""),))
        con.execute("INSERT INTO _f1db_meta VALUES ('source', ?)", (f"{BASE_URL}/f1db",))
        con.commit()
    finally:
        duck.close()
        con.close()

    # Finalize with WAL off & clean atomic replace
    tmp_db.replace(sqlite_path)
    return row_counts


def sync_f1db(
    data_dir: str | Path,
    *,
    force: bool = False,
    max_workers: int = 8,
) -> dict[str, Any]:
    """Download all TracingInsights F1DB Parquet files and build `data/f1db.sqlite`."""
    data_path = Path(data_dir)
    parquet_dir = data_path / "f1db_parquet"
    parquet_dir.mkdir(parents=True, exist_ok=True)
    state_file = parquet_dir / "_sync_state.json"
    sqlite_path = data_path / "f1db.sqlite"

    prev_state: dict[str, Any] = {}
    if state_file.exists():
        try:
            prev_state = json.loads(state_file.read_text(encoding="utf-8"))
        except Exception:
            prev_state = {}
    prev_etags: dict[str, str] = dict(prev_state.get("etags") or {})

    manifest = fetch_manifest()
    tables = manifest.get("tables") or {}

    downloaded = 0
    cached = 0
    total_bytes = 0
    new_etags: dict[str, str] = {}

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            pool.submit(_download_one, tname, tmeta, parquet_dir, prev_etags, force): (tname, tmeta)
            for tname, tmeta in tables.items()
        }
        for fut in as_completed(futures):
            tname, tmeta = futures[fut]
            _, _, was_downloaded, nbytes = fut.result()
            total_bytes += nbytes
            if was_downloaded:
                downloaded += 1
            else:
                cached += 1
            new_etags[tname] = str(tmeta.get("etag") or "")

    needs_rebuild = force or downloaded > 0 or not sqlite_path.exists()
    row_counts: dict[str, int] = {}
    if needs_rebuild:
        row_counts = build_sqlite_from_parquets(manifest, parquet_dir, sqlite_path)
    else:
        con = sqlite3.connect(str(sqlite_path))
        try:
            for tname, cnt in con.execute("SELECT table_name, row_count FROM _f1db_catalog"):
                row_counts[tname] = int(cnt)
        finally:
            con.close()

    state_file.write_text(
        json.dumps(
            {
                "version": manifest.get("version"),
                "lastUpdated": manifest.get("lastUpdated"),
                "schemaHash": manifest.get("schemaHash"),
                "etags": new_etags,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    return {
        "ok": True,
        "source": f"{BASE_URL}/f1db",
        "lastUpdated": manifest.get("lastUpdated"),
        "version": manifest.get("version"),
        "tableCount": len(tables),
        "downloaded": downloaded,
        "cached": cached,
        "parquetBytes": total_bytes,
        "sqlitePath": str(sqlite_path),
        "sqliteBytes": sqlite_path.stat().st_size if sqlite_path.exists() else 0,
        "totalRows": sum(row_counts.values()),
        "rebuilt": needs_rebuild,
    }


def sync_latest_season_into_f1_sqlite(
    f1_sqlite_path: str | Path,
    f1db_sqlite_path: str | Path,
    year: int = 2026,
) -> dict[str, Any]:
    """
    Backfill any completed rounds & updated standings from `f1db.sqlite` into TRAF1's
    primary `data/f1.sqlite` (e.g. 2026 Round 21 Las Vegas GP) while preserving existing rounds.
    """
    f1_p = Path(f1_sqlite_path)
    src_p = Path(f1db_sqlite_path)
    if not f1_p.exists() or not src_p.exists():
        return {"ok": False, "reason": "missing db"}

    src = sqlite3.connect(f"file:{src_p}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row
    dst = sqlite3.connect(str(f1_p), timeout=15.0)
    dst.row_factory = sqlite3.Row

    try:
        existing_rounds = {
            int(r[0]) for r in dst.execute("SELECT round FROM races WHERE year = ?", (year,)).fetchall()
        }
        completed_rounds = [
            int(r[0])
            for r in src.execute(
                "SELECT DISTINCT round FROM races_race_results WHERE year = ? ORDER BY round", (year,)
            ).fetchall()
        ]
        new_rounds = [rnd for rnd in completed_rounds if rnd not in existing_rounds]

        # Build canonical driver display name map ("First Last ABR") from existing 2026 f1.sqlite rows
        existing_drv_by_abbr: dict[str, tuple[str, str, str, str]] = {}
        for r in dst.execute(
            "SELECT driver, nationality, team, driver_id, driver_url FROM drivers_standings WHERE year = ?",
            (year,),
        ).fetchall():
            parts = str(r["driver"]).split()
            if parts and len(parts[-1]) == 3 and parts[-1].isupper():
                existing_drv_by_abbr[parts[-1]] = (
                    r["driver"],
                    r["nationality"],
                    r["driver_id"] or "",
                    r["driver_url"] or "",
                )

        def fmt_driver(name: str, abbr: str | None) -> str:
            a = (abbr or "").strip().upper()
            if a in existing_drv_by_abbr:
                return existing_drv_by_abbr[a][0]
            return f"{name} {a}".strip() if a else name

        # Map F1DB constructor names to f1.sqlite short team names
        team_alias = {
            "Red Bull": "Red Bull Racing",
            "Racing Bulls": "Racing Bulls",
            "Haas": "Haas F1 Team",
            "Aston Martin": "Aston Martin",
            "Alpine": "Alpine",
            "Williams": "Williams",
            "Mercedes": "Mercedes",
            "Ferrari": "Ferrari",
            "McLaren": "McLaren",
            "Audi": "Audi",
            "Cadillac": "Cadillac",
        }

        def fmt_team(cname: str | None) -> str:
            c = str(cname or "").strip()
            return team_alias.get(c, c)

        races_added = 0
        results_added = 0

        for rnd in new_rounds:
            race = src.execute(
                """
                SELECT r.id, r.year, r.round, r.date, r.laps, gp.name AS gpName, gp.id AS gpId
                FROM races r
                LEFT JOIN grands_prix gp ON gp.id = r.grandPrixId
                WHERE r.year = ? AND r.round = ?
                """,
                (year, rnd),
            ).fetchone()
            if not race:
                continue
            rid = race["id"]
            winner = src.execute(
                """
                SELECT rr.laps, rr.time, d.name AS drvName, d.abbreviation AS drvAbbr, c.name AS conName
                FROM races_race_results rr
                LEFT JOIN drivers d ON d.id = rr.driverId
                LEFT JOIN constructors c ON c.id = rr.constructorId
                WHERE rr.raceId = ? AND rr.positionNumber = 1
                LIMIT 1
                """,
                (rid,),
            ).fetchone()
            if not winner:
                continue

            gp_name = str(race["gpName"] or f"Round {rnd}")
            gp_slug = str(race["gpId"] or gp_name.lower().replace(" ", "-"))
            win_drv = fmt_driver(winner["drvName"], winner["drvAbbr"])
            win_team = fmt_team(winner["conName"])
            race_url = f"https://tracinginsights.com/f1db/races?year={year}&round={rnd}"

            dst.execute("INSERT OR IGNORE INTO seasons (year) VALUES (?)", (year,))
            dst.execute("INSERT OR IGNORE INTO grands_prix (gp_slug, name) VALUES (?, ?)", (gp_slug, gp_name))
            dst.execute(
                """
                INSERT OR REPLACE INTO races (year, round, grand_prix, date, winner, team, laps, time, race_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (year, rnd, gp_name, race["date"] or "", win_drv, win_team, winner["laps"] or race["laps"], winner["time"], race_url),
            )
            dst.execute(
                """
                INSERT OR REPLACE INTO races_normalized (year, round, race_id, gp_slug, date, winner_name, team_name, laps, time, race_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (year, rnd, int(rid), gp_slug, race["date"] or "", win_drv, win_team, winner["laps"] or race["laps"], winner["time"], race_url),
            )
            races_added += 1

            # Race results
            for rr in src.execute(
                """
                SELECT rr.positionDisplayOrder, rr.positionNumber, rr.positionText,
                       d.name AS drvName, d.abbreviation AS drvAbbr, c.name AS conName
                FROM races_race_results rr
                LEFT JOIN drivers d ON d.id = rr.driverId
                LEFT JOIN constructors c ON c.id = rr.constructorId
                WHERE rr.raceId = ?
                ORDER BY rr.positionDisplayOrder
                """,
                (rid,),
            ).fetchall():
                d_str = fmt_driver(rr["drvName"] or "", rr["drvAbbr"])
                t_str = fmt_team(rr["conName"])
                pos_txt = str(rr["positionText"] or ("NC" if rr["positionNumber"] is None else rr["positionNumber"]))
                pos_ord = int(rr["positionNumber"]) if rr["positionNumber"] is not None else 0
                dst.execute(
                    """
                    INSERT OR REPLACE INTO race_results (year, round, driver, team, position_text, position_order)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (year, rnd, d_str, t_str, pos_txt, pos_ord),
                )
                results_added += 1

            # Fastest lap
            fl = src.execute(
                """
                SELECT fl.time, d.name AS drvName, d.abbreviation AS drvAbbr
                FROM races_fastest_laps fl
                LEFT JOIN drivers d ON d.id = fl.driverId
                WHERE fl.raceId = ? AND fl.positionNumber = 1
                LIMIT 1
                """,
                (rid,),
            ).fetchone()
            if fl and fl["time"]:
                fl_drv = fmt_driver(fl["drvName"] or "", fl["drvAbbr"])
                dst.execute(
                    """
                    INSERT OR REPLACE INTO fastest_laps (year, round, grand_prix, winner, time, race_url)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (year, rnd, gp_name, fl_drv, fl["time"], race_url),
                )
                dst.execute(
                    """
                    INSERT OR REPLACE INTO fastest_laps_normalized (year, round, race_id, gp_slug, winner_name, time, race_url)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (year, rnd, int(rid), gp_slug, fl_drv, fl["time"], race_url),
                )

        # Refresh season driver & constructor standings when new rounds were added
        standings_updated = False
        if new_rounds:
            latest_rnd = max(completed_rounds)
            # Drivers standings from F1DB seasons_driver_standings
            ds_rows = src.execute(
                """
                SELECT sds.positionDisplayOrder, sds.positionNumber, sds.points,
                       d.id AS f1dbId, d.name AS drvName, d.abbreviation AS drvAbbr,
                       co.iocCode AS natIoc,
                       (SELECT c.name FROM races_race_results rr2
                        JOIN constructors c ON c.id = rr2.constructorId
                        WHERE rr2.year = sds.year AND rr2.driverId = sds.driverId
                        ORDER BY rr2.round DESC LIMIT 1) AS latestTeam
                FROM seasons_driver_standings sds
                JOIN drivers d ON d.id = sds.driverId
                LEFT JOIN countries co ON co.id = d.nationalityCountryId
                WHERE sds.year = ?
                ORDER BY sds.positionDisplayOrder
                """,
                (year,),
            ).fetchall()
            if ds_rows:
                dst.execute("DELETE FROM drivers_standings WHERE year = ?", (year,))
                for idx, r in enumerate(ds_rows, 1):
                    abbr = (r["drvAbbr"] or "").strip().upper()
                    prev = existing_drv_by_abbr.get(abbr)
                    d_str = prev[0] if prev else fmt_driver(r["drvName"], abbr)
                    nat = (prev[1] if prev else None) or (r["natIoc"] or "FIA")
                    did = (prev[2] if prev and prev[2] else None) or r["f1dbId"]
                    durl = (prev[3] if prev and prev[3] else None) or f"https://tracinginsights.com/f1db/drivers?search={r['f1dbId']}"
                    t_str = fmt_team(r["latestTeam"])
                    pos_i = int(r["positionNumber"] or idx)
                    dst.execute(
                        """
                        INSERT OR REPLACE INTO drivers_standings
                        (year, position, driver, nationality, team, points, driver_id, driver_url)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (year, pos_i, d_str, nat, t_str, float(r["points"] or 0.0), did, durl),
                    )

            ts_rows = src.execute(
                """
                SELECT scs.positionDisplayOrder, scs.positionNumber, scs.points,
                       c.id AS conId, c.name AS conName
                FROM seasons_constructor_standings scs
                JOIN constructors c ON c.id = scs.constructorId
                WHERE scs.year = ?
                ORDER BY scs.positionDisplayOrder
                """,
                (year,),
            ).fetchall()
            if ts_rows:
                dst.execute("DELETE FROM team_standings WHERE year = ?", (year,))
                for idx, r in enumerate(ts_rows, 1):
                    t_str = fmt_team(r["conName"])
                    pos_i = int(r["positionNumber"] or idx)
                    dst.execute(
                        """
                        INSERT OR REPLACE INTO team_standings
                        (year, position, team, points, team_id, team_url)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (year, pos_i, t_str, float(r["points"] or 0.0), t_str, f"https://tracinginsights.com/f1db/constructors?search={r['conId']}"),
                    )
            standings_updated = True

        dst.commit()
        return {
            "ok": True,
            "year": year,
            "newRounds": new_rounds,
            "racesAdded": races_added,
            "resultsAdded": results_added,
            "standingsUpdated": standings_updated,
        }
    finally:
        src.close()
        dst.close()
