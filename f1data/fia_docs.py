"""
Read-only query & Steward Precedents layer for the TracingInsights FIA Documents
Archive (`data/fia_docs.sqlite`, synced from https://tracinginsights.com/fia-docs).

Supports:
  - Full-catalog search across all ~11,919 official FIA documents (2018-2026)
  - On-demand sidecar JSON hydration & caching for any historical document
  - Real FIA Steward ruling precedents & ISC Article citations for live race sim
  - Penalties Dashboard (2020-2025: 1,240 decisions, €840.8k fines, 368 penalty pts)
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

DEFAULT_FIA_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "fia_docs.sqlite"


def resolve_fia_db_path(path: str | Path | None = None) -> Path:
    if path is None:
        return DEFAULT_FIA_DB_PATH
    p = Path(path)
    if p.name in ("f1.sqlite", "f1db.sqlite"):
        return p.parent / "fia_docs.sqlite"
    return p


def _connect_ro(path: str | Path | None = None) -> sqlite3.Connection | None:
    p = resolve_fia_db_path(path)
    if not p.exists() or p.stat().st_size == 0:
        return None
    con = sqlite3.connect(f"file:{p}?mode=ro", uri=True, timeout=5.0)
    con.row_factory = sqlite3.Row
    return con


def get_fia_docs_status(path: str | Path | None = None) -> dict[str, Any]:
    p = resolve_fia_db_path(path)
    con = _connect_ro(p)
    if con is None:
        return {"available": False, "path": str(p), "totalDocuments": 0, "totalEvents": 0, "hydratedDecisions": 0}
    try:
        meta = dict(con.execute("SELECT key, value FROM _fia_meta").fetchall())
        total_docs = int(con.execute("SELECT COUNT(*) FROM fia_documents").fetchone()[0])
        total_events = int(con.execute("SELECT COUNT(*) FROM fia_events").fetchone()[0])
        hydrated = int(con.execute("SELECT COUNT(*) FROM fia_decisions_detail").fetchone()[0])
        seasons = [
            {"year": int(r[0]), "documents": int(r[1])}
            for r in con.execute("SELECT year, COUNT(*) FROM fia_documents GROUP BY year ORDER BY year DESC").fetchall()
        ]
        doc_types = [
            {"type": r[0], "count": int(r[1])}
            for r in con.execute("SELECT doc_type, COUNT(*) c FROM fia_documents GROUP BY doc_type ORDER BY c DESC").fetchall()
        ]
        pen_row = con.execute("SELECT payload_json FROM fia_penalties_summary WHERE key = 'dashboard'").fetchone()
        penalties = json.loads(pen_row[0]) if pen_row else None
        return {
            "available": True,
            "path": str(p),
            "sqliteBytes": p.stat().st_size,
            "source": meta.get("source", "https://tracinginsights.com/fia-docs"),
            "updatedAt": meta.get("updatedAt"),
            "syncSha": meta.get("syncSha"),
            "totalDocuments": total_docs,
            "totalEvents": total_events,
            "hydratedDecisions": hydrated,
            "seasons": seasons,
            "docTypes": doc_types,
            "penaltiesSummary": penalties,
        }
    finally:
        con.close()


def list_events(year: int | None = None, path: str | Path | None = None) -> list[dict[str, Any]]:
    con = _connect_ro(path)
    if con is None:
        return []
    try:
        if year is not None:
            rows = con.execute(
                "SELECT year, event_slug, event_name, doc_count, date_modified FROM fia_events WHERE year = ? ORDER BY date_modified DESC, event_name",
                (int(year),),
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT year, event_slug, event_name, doc_count, date_modified FROM fia_events ORDER BY year DESC, date_modified DESC LIMIT 250"
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        con.close()


def search_fia_docs(
    *,
    path: str | Path | None = None,
    year: int | None = None,
    event_slug: str = "",
    doc_type: str = "",
    driver: str = "",
    team: str = "",
    q: str = "",
    only_hydrated: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> dict[str, Any]:
    con = _connect_ro(path)
    if con is None:
        return {"total": 0, "limit": limit, "offset": offset, "items": []}
    try:
        where: list[str] = []
        params: list[Any] = []
        if year is not None:
            where.append("d.year = ?")
            params.append(int(year))
        if event_slug.strip():
            where.append("d.event_slug = ?")
            params.append(event_slug.strip())
        if doc_type.strip():
            where.append("d.doc_type = ?")
            params.append(doc_type.strip())
        if driver.strip():
            like = f"%{driver.strip()}%"
            where.append("(d.drivers_text LIKE ? OR dd.driver LIKE ?)")
            params.extend([like, like])
        if team.strip():
            like = f"%{team.strip()}%"
            where.append("(d.teams_text LIKE ? OR dd.team LIKE ?)")
            params.extend([like, like])
        if q.strip():
            like = f"%{q.strip()}%"
            where.append(
                "(d.title LIKE ? OR d.event_name LIKE ? OR d.drivers_text LIKE ? "
                "OR dd.fact LIKE ? OR dd.offence LIKE ? OR dd.decision LIKE ? OR dd.reason LIKE ?)"
            )
            params.extend([like] * 7)
        if only_hydrated:
            where.append("dd.slug IS NOT NULL")

        where_sql = (" WHERE " + " AND ".join(where)) if where else ""
        lim = max(1, min(200, int(limit)))
        off = max(0, int(offset))

        join_sql = """
            FROM fia_documents d
            LEFT JOIN fia_decisions_detail dd
              ON dd.year = d.year AND dd.event_slug = d.event_slug AND dd.slug = d.slug
        """
        total = int(con.execute(f"SELECT COUNT(*) {join_sql}{where_sql}", params).fetchone()[0])
        rows = con.execute(
            f"""
            SELECT d.year, d.event_slug, d.event_name, d.slug, d.title, d.doc_type,
                   d.date, d.doc_number, d.drivers_text, d.teams_text, d.pdf_url,
                   d.source_url, d.json_path,
                   dd.session, dd.car_number, dd.fact, dd.offence, dd.decision,
                   dd.penalty, dd.penalty_points, dd.rules_referenced_json,
                   CASE WHEN dd.slug IS NOT NULL THEN 1 ELSE 0 END AS hydrated
            {join_sql}
            {where_sql}
            ORDER BY d.year DESC, d.date DESC, d.doc_number DESC
            LIMIT ? OFFSET ?
            """,
            params + [lim, off],
        ).fetchall()

        items = []
        for r in rows:
            item = dict(r)
            item["rulesReferenced"] = json.loads(item.pop("rules_referenced_json") or "[]")
            item["hydrated"] = bool(item["hydrated"])
            items.append(item)

        return {"total": total, "limit": lim, "offset": off, "items": items}
    finally:
        con.close()


def get_fia_doc_detail(
    year: int,
    event_slug: str,
    slug: str,
    *,
    path: str | Path | None = None,
    hydrate: bool = True,
) -> dict[str, Any] | None:
    p = resolve_fia_db_path(path)
    con = _connect_ro(p)
    if con is None:
        return None
    try:
        doc = con.execute(
            "SELECT * FROM fia_documents WHERE year = ? AND event_slug = ? AND slug = ?",
            (int(year), event_slug, slug),
        ).fetchone()
        if not doc:
            return None
        doc_d = dict(doc)
        detail = con.execute(
            "SELECT * FROM fia_decisions_detail WHERE year = ? AND event_slug = ? AND slug = ?",
            (int(year), event_slug, slug),
        ).fetchone()
    finally:
        con.close()

    detail_d = dict(detail) if detail else None

    # Transparent on-demand sidecar hydration & SQLite cache for older 2018-2024 documents
    if detail_d is None and hydrate and doc_d.get("json_path"):
        from .fia_docs_sync import fetch_doc_sidecar, upsert_decision_sidecar
        sc = fetch_doc_sidecar(doc_d["json_path"])
        if isinstance(sc, dict):
            wcon = sqlite3.connect(str(p), timeout=10.0)
            try:
                upsert_decision_sidecar(wcon, int(year), event_slug, slug, sc)
                wcon.commit()
            finally:
                wcon.close()
            con2 = _connect_ro(p)
            if con2 is not None:
                try:
                    row2 = con2.execute(
                        "SELECT * FROM fia_decisions_detail WHERE year = ? AND event_slug = ? AND slug = ?",
                        (int(year), event_slug, slug),
                    ).fetchone()
                    detail_d = dict(row2) if row2 else None
                finally:
                    con2.close()

    if detail_d:
        detail_d["rulesReferenced"] = json.loads(detail_d.pop("rules_referenced_json") or "[]")
        detail_d["raw"] = json.loads(detail_d.pop("raw_json") or "{}")

    return {
        "document": {
            "year": doc_d["year"],
            "eventSlug": doc_d["event_slug"],
            "eventName": doc_d["event_name"],
            "slug": doc_d["slug"],
            "title": doc_d["title"],
            "docType": doc_d["doc_type"],
            "date": doc_d["date"],
            "docNumber": doc_d["doc_number"],
            "drivers": json.loads(doc_d.get("drivers_json") or "[]"),
            "teams": json.loads(doc_d.get("teams_json") or "[]"),
            "pdfUrl": doc_d.get("pdf_url"),
            "sourceUrl": doc_d.get("source_url"),
            "tracingInsightsUrl": f"https://tracinginsights.com/fia-docs/{doc_d['year']}/{doc_d['event_slug']}/{doc_d['slug']}",
        },
        "detail": detail_d,
    }


def get_fia_precedents(path: str | Path | None = None) -> dict[str, Any]:
    """
    Build structured real-world FIA Stewards' ruling precedents grouped by offence category
    (for live broadcast steward banners, race-control reasoning, and career steward hearings).
    """
    con = _connect_ro(path)
    if con is None:
        return {"available": False, "categories": {}, "penaltiesSummary": None}

    category_rules = [
        ("collision", "Causing a Collision", ("collision", "contact", "forcing another driver")),
        ("unsafe_release", "Unsafe Release", ("unsafe release", "unsafe condition")),
        ("pit_speeding", "Pit Lane Speeding", ("pit lane speed", "speed limit")),
        ("track_limits", "Track Limits & Gaining Advantage", ("leaving the track", "track limits", "gaining an advantage")),
        ("impeding", "Impeding / Driving Unnecessarily Slowly", ("impeding", "unnecessarily slowly", "maximum delta")),
        ("erratic", "Erratic Driving / Moving Under Braking", ("erratic", "weaving", "change of direction", "braking")),
        ("jump_start", "False Start / Grid Box Infringement", ("false start", "jump start", "grid position", "starting position")),
        ("yellow_flags", "Failure to Slow Under Yellow Flags", ("yellow flag", "double yellow", "vsc", "safety car")),
    ]

    try:
        rows = con.execute(
            """
            SELECT dd.year, dd.event_slug, d.event_name, dd.slug, dd.driver, dd.team,
                   dd.car_number, dd.session, dd.fact, dd.offence, dd.decision,
                   dd.penalty, dd.penalty_points, dd.reason, dd.rules_referenced_json,
                   d.title
            FROM fia_decisions_detail dd
            LEFT JOIN fia_documents d
              ON d.year = dd.year AND d.event_slug = dd.event_slug AND d.slug = dd.slug
            WHERE (dd.offence != '' OR dd.decision != '' OR dd.fact != '')
            ORDER BY dd.year DESC, dd.date DESC
            """
        ).fetchall()

        categories: dict[str, dict[str, Any]] = {}
        for key, label, keywords in category_rules:
            matched: list[dict[str, Any]] = []
            articles: dict[str, int] = {}
            for r in rows:
                blob = f"{r['title'] or ''} {r['fact'] or ''} {r['offence'] or ''} {r['decision'] or ''}".lower()
                if any(kw in blob for kw in keywords):
                    rules_list = json.loads(r["rules_referenced_json"] or "[]")
                    for art in rules_list:
                        articles[art] = articles.get(art, 0) + 1
                    if len(matched) < 8:
                        matched.append(
                            {
                                "year": r["year"],
                                "event": r["event_name"] or r["event_slug"],
                                "driver": r["driver"],
                                "team": r["team"],
                                "carNumber": r["car_number"],
                                "session": r["session"],
                                "fact": r["fact"],
                                "offence": r["offence"],
                                "decision": r["decision"] or r["penalty"],
                                "penaltyPoints": r["penalty_points"],
                                "rulesReferenced": rules_list,
                                "slug": r["slug"],
                                "eventSlug": r["event_slug"],
                            }
                        )
            top_articles = [a for a, _ in sorted(articles.items(), key=lambda kv: -kv[1])[:4]]
            categories[key] = {
                "label": label,
                "count": len(matched),
                "topArticles": top_articles,
                "examples": matched,
            }

        pen_row = con.execute("SELECT payload_json FROM fia_penalties_summary WHERE key = 'dashboard'").fetchone()
        penalties = json.loads(pen_row[0]) if pen_row else None

        return {
            "available": True,
            "hydratedTotal": len(rows),
            "categories": categories,
            "penaltiesSummary": penalties,
        }
    finally:
        con.close()
