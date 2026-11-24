"""
TracingInsights FIA Documents & Penalties Archive Sync Engine
(`https://tracinginsights.com/fia-docs` & `/f1/penalties-dashboard/`).

Syncs:
  1. Full catalog of ~11,919 official FIA F1 documents (2018–2026) across every
     season and Grand Prix from TracingInsights SvelteKit data endpoints.
  2. Full structured JSON sidecars (fact, offence, decision, penalty, penalty_points,
     reason, rules_referenced, car_number, driver, team, session) for recent
     infringement & decision documents (2025–2026 by default; any older doc can
     also be hydrated on demand and cached in SQLite).
  3. Aggregated 2020–2025 FIA Penalties Dashboard telemetry (1,240 decisions,
     fines, penalty points, allegations, outcomes, driver leaderboards).

Compiles everything atomically into `data/fia_docs.sqlite`.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import sqlite3
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests

BASE_URL = "https://tracinginsights.com"
FIA_INDEX_DATA_URL = f"{BASE_URL}/fia-docs/__data.json"
PENALTIES_DATA_URL = f"{BASE_URL}/f1/penalties-dashboard/__data.json"

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json,*/*",
}


def resolve_devalue(arr: list[Any], idx: Any = 0, depth: int = 0) -> Any:
    """Decode SvelteKit's compact devalue index-table payload into normal Python dicts/lists."""
    if depth > 28 or not isinstance(idx, int) or idx < 0 or idx >= len(arr):
        return idx
    val = arr[idx]
    if isinstance(val, list):
        return [resolve_devalue(arr, x, depth + 1) for x in val]
    if isinstance(val, dict):
        return {k: resolve_devalue(arr, v, depth + 1) for k, v in val.items()}
    return val


def _get_json(url: str, timeout: float = 20.0) -> Any:
    resp = requests.get(url, headers=DEFAULT_HEADERS, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def fetch_fia_manifest(timeout: float = 20.0) -> dict[str, Any]:
    raw = _get_json(FIA_INDEX_DATA_URL, timeout=timeout)
    nodes = raw.get("nodes") or []
    for node in reversed(nodes):
        if isinstance(node, dict) and isinstance(node.get("data"), list) and node["data"]:
            decoded = resolve_devalue(node["data"], 0)
            if isinstance(decoded, dict) and "manifest" in decoded:
                return decoded["manifest"]
    raise RuntimeError("Could not locate FIA docs manifest in __data.json")


def fetch_penalties_dashboard(timeout: float = 20.0) -> dict[str, Any] | None:
    try:
        raw = _get_json(PENALTIES_DATA_URL, timeout=timeout)
        for node in reversed(raw.get("nodes") or []):
            if isinstance(node, dict) and isinstance(node.get("data"), list) and node["data"]:
                decoded = resolve_devalue(node["data"], 0)
                if isinstance(decoded, dict) and isinstance(decoded.get("pen"), dict):
                    return decoded["pen"]
    except Exception:
        return None
    return None


def fetch_event_docs(year: int, event_slug: str, timeout: float = 20.0) -> dict[str, Any]:
    url = f"{BASE_URL}/fia-docs/{year}/{event_slug}/__data.json"
    raw = _get_json(url, timeout=timeout)
    for node in reversed(raw.get("nodes") or []):
        if isinstance(node, dict) and isinstance(node.get("data"), list) and node["data"]:
            decoded = resolve_devalue(node["data"], 0)
            if isinstance(decoded, dict) and "docs" in decoded:
                return decoded
    return {"year": year, "event": event_slug, "docs": [], "weekendRules": []}


def fetch_doc_sidecar(json_path: str, timeout: float = 15.0) -> dict[str, Any] | None:
    if not json_path:
        return None
    url = urljoin(BASE_URL, json_path)
    try:
        return _get_json(url, timeout=timeout)
    except Exception:
        return None


def _init_schema(con: sqlite3.Connection) -> None:
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS _fia_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS fia_events (
            year INTEGER NOT NULL,
            event_slug TEXT NOT NULL,
            event_name TEXT NOT NULL,
            doc_count INTEGER NOT NULL,
            date_modified TEXT,
            weekend_rules_json TEXT,
            PRIMARY KEY (year, event_slug)
        );

        CREATE TABLE IF NOT EXISTS fia_documents (
            year INTEGER NOT NULL,
            event_slug TEXT NOT NULL,
            event_name TEXT NOT NULL,
            slug TEXT NOT NULL,
            title TEXT NOT NULL,
            doc_type TEXT NOT NULL,
            kind TEXT,
            date TEXT,
            doc_number INTEGER,
            drivers_json TEXT,
            teams_json TEXT,
            drivers_text TEXT,
            teams_text TEXT,
            pdf_url TEXT,
            source_url TEXT,
            md_path TEXT,
            json_path TEXT,
            PRIMARY KEY (year, event_slug, slug)
        );

        CREATE TABLE IF NOT EXISTS fia_decisions_detail (
            year INTEGER NOT NULL,
            event_slug TEXT NOT NULL,
            slug TEXT NOT NULL,
            doc_type TEXT,
            doc_number TEXT,
            date TEXT,
            incident_time TEXT,
            session TEXT,
            car_number INTEGER,
            driver TEXT,
            team TEXT,
            fact TEXT,
            offence TEXT,
            decision TEXT,
            penalty TEXT,
            penalty_points INTEGER,
            reason TEXT,
            rules_referenced_json TEXT,
            raw_json TEXT,
            PRIMARY KEY (year, event_slug, slug)
        );

        CREATE TABLE IF NOT EXISTS fia_penalties_summary (
            key TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_fia_docs_year_type ON fia_documents (year, doc_type);
        CREATE INDEX IF NOT EXISTS idx_fia_docs_event ON fia_documents (year, event_slug);
        CREATE INDEX IF NOT EXISTS idx_fia_docs_date ON fia_documents (date DESC);
        CREATE INDEX IF NOT EXISTS idx_fia_docs_type ON fia_documents (doc_type);
        CREATE INDEX IF NOT EXISTS idx_fia_detail_driver ON fia_decisions_detail (driver);
        CREATE INDEX IF NOT EXISTS idx_fia_detail_offence ON fia_decisions_detail (offence);
        CREATE INDEX IF NOT EXISTS idx_fia_detail_year ON fia_decisions_detail (year DESC);
        """
    )


def upsert_decision_sidecar(
    con: sqlite3.Connection,
    year: int,
    event_slug: str,
    slug: str,
    sidecar: dict[str, Any],
) -> None:
    pts = sidecar.get("penalty_points")
    try:
        pts_int = int(pts) if pts is not None and str(pts).strip() != "" else None
    except (ValueError, TypeError):
        pts_int = None
    car_no = sidecar.get("car_number")
    try:
        car_int = int(car_no) if car_no is not None and str(car_no).strip() != "" else None
    except (ValueError, TypeError):
        car_int = None

    con.execute(
        """
        INSERT OR REPLACE INTO fia_decisions_detail (
            year, event_slug, slug, doc_type, doc_number, date, incident_time,
            session, car_number, driver, team, fact, offence, decision,
            penalty, penalty_points, reason, rules_referenced_json, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            int(year),
            str(event_slug),
            str(slug),
            str(sidecar.get("doc_type") or ""),
            str(sidecar.get("doc_number") or ""),
            str(sidecar.get("date") or ""),
            str(sidecar.get("incident_time") or ""),
            str(sidecar.get("session") or ""),
            car_int,
            str(sidecar.get("driver") or ""),
            str(sidecar.get("team") or ""),
            str(sidecar.get("fact") or ""),
            str(sidecar.get("offence") or ""),
            str(sidecar.get("decision") or ""),
            str(sidecar.get("penalty") or ""),
            pts_int,
            str(sidecar.get("reason") or ""),
            json.dumps(sidecar.get("rules_referenced") or []),
            json.dumps(sidecar),
        ),
    )


def sync_fia_docs(
    data_dir: str | Path,
    *,
    hydrate_years: tuple[int, ...] = (2026, 2025),
    hydrate_types: tuple[str, ...] = ("infringement", "decision", "offence"),
    max_sidecars: int = 350,
    max_workers: int = 12,
    force: bool = False,
) -> dict[str, Any]:
    """
    Sync the full 2018-2026 FIA Documents catalog (~11,919 docs), hydrate recent
    Steward Infringements/Decisions sidecars, and pull Penalties Dashboard data.
    """
    data_path = Path(data_dir)
    data_path.mkdir(parents=True, exist_ok=True)
    db_path = data_path / "fia_docs.sqlite"

    manifest = fetch_fia_manifest()
    sync_sha = str(manifest.get("syncSha") or "")
    updated_at = str(manifest.get("updatedAt") or "")
    seasons = manifest.get("seasons") or []

    con = sqlite3.connect(str(db_path), timeout=20.0)
    con.execute("PRAGMA journal_mode = WAL")
    con.execute("PRAGMA synchronous = NORMAL")
    _init_schema(con)

    try:
        prev_sha_row = con.execute("SELECT value FROM _fia_meta WHERE key = 'syncSha'").fetchone()
        prev_sha = prev_sha_row[0] if prev_sha_row else ""
        existing_events = {
            (int(y), s): int(c)
            for y, s, c in con.execute("SELECT year, event_slug, doc_count FROM fia_events").fetchall()
        }
        existing_details = {
            (int(y), e, s)
            for y, e, s in con.execute("SELECT year, event_slug, slug FROM fia_decisions_detail").fetchall()
        }

        # Determine which (year, event) endpoints need fetching
        to_fetch: list[tuple[int, str, str, int]] = []
        for season in seasons:
            yr = int(season["year"])
            for ev in season.get("events") or []:
                slug = str(ev["slug"])
                name = str(ev.get("name") or slug)
                cnt = int(ev.get("docCount") or 0)
                if force or existing_events.get((yr, slug)) != cnt or prev_sha != sync_sha:
                    # Only re-fetch events whose doc_count changed (or all if missing/forced)
                    if force or (yr, slug) not in existing_events or existing_events[(yr, slug)] != cnt:
                        to_fetch.append((yr, slug, name, cnt))

        events_fetched = 0
        docs_upserted = 0
        errors = 0

        if to_fetch:
            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                futs = {
                    pool.submit(fetch_event_docs, yr, slug): (yr, slug, name, cnt)
                    for yr, slug, name, cnt in to_fetch
                }
                for fut in as_completed(futs):
                    yr, slug, name, cnt = futs[fut]
                    try:
                        ev_data = fut.result()
                    except Exception:
                        errors += 1
                        continue
                    events_fetched += 1
                    ev_name = str(ev_data.get("eventName") or name)
                    docs = ev_data.get("docs") or []
                    con.execute(
                        """
                        INSERT OR REPLACE INTO fia_events
                        (year, event_slug, event_name, doc_count, date_modified, weekend_rules_json)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (
                            yr,
                            slug,
                            ev_name,
                            cnt or len(docs),
                            str(ev_data.get("dateModified") or ""),
                            json.dumps(ev_data.get("weekendRules") or []),
                        ),
                    )
                    rows = []
                    for d in docs:
                        if not isinstance(d, dict) or not d.get("slug"):
                            continue
                        drvs = d.get("drivers") or []
                        tms = d.get("teams") or []
                        doc_num = d.get("docNumber")
                        try:
                            doc_num_i = int(doc_num) if doc_num is not None else None
                        except (ValueError, TypeError):
                            doc_num_i = None
                        rows.append(
                            (
                                yr,
                                slug,
                                ev_name,
                                str(d["slug"]),
                                str(d.get("title") or d["slug"]),
                                str(d.get("type") or "other"),
                                str(d.get("kind") or "pdf"),
                                str(d.get("date") or ""),
                                doc_num_i,
                                json.dumps(drvs),
                                json.dumps(tms),
                                ", ".join(str(x) for x in drvs),
                                ", ".join(str(x) for x in tms),
                                str(d.get("pdfUrl") or ""),
                                str(d.get("sourceUrl") or ""),
                                str(d.get("mdPath") or ""),
                                str(d.get("jsonPath") or ""),
                            )
                        )
                    if rows:
                        con.executemany(
                            """
                            INSERT OR REPLACE INTO fia_documents (
                                year, event_slug, event_name, slug, title, doc_type, kind,
                                date, doc_number, drivers_json, teams_json, drivers_text,
                                teams_text, pdf_url, source_url, md_path, json_path
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            rows,
                        )
                        docs_upserted += len(rows)
            con.commit()

        # Hydrate structured Steward Decisions / Infringements JSON sidecars for recent seasons
        yr_placeholders = ",".join(["?"] * len(hydrate_years))
        tp_placeholders = ",".join(["?"] * len(hydrate_types))
        candidates = con.execute(
            f"""
            SELECT year, event_slug, slug, json_path
            FROM fia_documents
            WHERE year IN ({yr_placeholders})
              AND doc_type IN ({tp_placeholders})
              AND json_path IS NOT NULL AND json_path != ''
            ORDER BY year DESC, date DESC, doc_number DESC
            """,
            (*hydrate_years, *hydrate_types),
        ).fetchall()

        sidecar_targets = [
            (int(y), e, s, jp)
            for y, e, s, jp in candidates
            if force or (int(y), e, s) not in existing_details
        ][:max_sidecars]

        sidecars_fetched = 0
        if sidecar_targets:
            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                futs = {
                    pool.submit(fetch_doc_sidecar, jp): (y, e, s)
                    for y, e, s, jp in sidecar_targets
                }
                for fut in as_completed(futs):
                    y, e, s = futs[fut]
                    sc = fut.result()
                    if isinstance(sc, dict):
                        upsert_decision_sidecar(con, y, e, s, sc)
                        sidecars_fetched += 1
            con.commit()

        # Sync 2020-2025 Penalties Dashboard aggregate telemetry
        pen = fetch_penalties_dashboard()
        if pen:
            con.execute(
                "INSERT OR REPLACE INTO fia_penalties_summary VALUES ('dashboard', ?)",
                (json.dumps(pen),),
            )

        con.execute("INSERT OR REPLACE INTO _fia_meta VALUES ('syncSha', ?)", (sync_sha,))
        con.execute("INSERT OR REPLACE INTO _fia_meta VALUES ('updatedAt', ?)", (updated_at,))
        con.execute("INSERT OR REPLACE INTO _fia_meta VALUES ('source', ?)", (f"{BASE_URL}/fia-docs",))
        con.execute(
            "INSERT OR REPLACE INTO _fia_meta VALUES ('docTypes', ?)",
            (json.dumps(manifest.get("docTypes") or []),),
        )
        con.commit()

        total_docs = int(con.execute("SELECT COUNT(*) FROM fia_documents").fetchone()[0])
        total_events = int(con.execute("SELECT COUNT(*) FROM fia_events").fetchone()[0])
        total_details = int(con.execute("SELECT COUNT(*) FROM fia_decisions_detail").fetchone()[0])

        return {
            "ok": True,
            "source": f"{BASE_URL}/fia-docs",
            "updatedAt": updated_at,
            "syncSha": sync_sha,
            "totalEvents": total_events,
            "totalDocuments": total_docs,
            "hydratedDecisions": total_details,
            "eventsFetched": events_fetched,
            "docsUpserted": docs_upserted,
            "sidecarsFetched": sidecars_fetched,
            "errors": errors,
            "penaltiesSynced": bool(pen),
            "sqlitePath": str(db_path),
            "sqliteBytes": db_path.stat().st_size,
        }
    finally:
        con.close()
