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
