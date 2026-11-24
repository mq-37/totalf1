"""FastAPI router for the TracingInsights F1DB Catalog, Dossiers & Live Sync."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse

from .. import server as srv
from .. import f1db, fia_docs

router = APIRouter()


@router.get("/f1db", response_class=HTMLResponse)
async def f1db_browser_page(request: Request):
    status = f1db.get_f1db_status(srv.DATA_DB)
    tables = f1db.list_tables(srv.DATA_DB)
    fia_status = fia_docs.get_fia_docs_status(srv.DATA_DB)
    return srv.render_template(request, "f1db.html", {
            "status": status,
            "tables": tables,
            "fia_status": fia_status,
            "current_season": srv.CURRENT_SEASON,
        },
    )


@router.get("/api/f1db/status")
def api_f1db_status():
    return f1db.get_f1db_status(srv.DATA_DB)


@router.get("/api/f1db/tables")
def api_f1db_tables():
    tables = f1db.list_tables(srv.DATA_DB)
    return {"count": len(tables), "tables": tables}


@router.get("/api/f1db/table/{table_name}")
def api_f1db_table(
    table_name: str,
    search: str = Query(""),
    year: Optional[int] = Query(None),
    sort_col: Optional[str] = Query(None),
    sort_dir: str = Query("asc"),
    limit: int = Query(50, ge=1, le=250),
    offset: int = Query(0, ge=0),
):
    res = f1db.query_table(
        table_name,
        f1db_path=srv.DATA_DB,
        search=search,
        year=year,
        sort_col=sort_col,
        sort_dir=sort_dir,
        limit=limit,
        offset=offset,
    )
    if res is None:
        raise HTTPException(status_code=404, detail=f"F1DB table '{table_name}' not found")
    return res


@router.get("/api/f1db/season/{year}")
def api_f1db_season(year: int):
    dossier = f1db.get_season_dossier(year, srv.DATA_DB)
    if dossier is None:
        raise HTTPException(status_code=404, detail=f"F1DB season {year} not found")
    return dossier


@router.get("/api/f1db/race/{year}/{round_num}")
def api_f1db_race_weekend(year: int, round_num: int):
    dossier = f1db.get_race_weekend_dossier(year, round_num, srv.DATA_DB)
    if dossier is None:
        raise HTTPException(status_code=404, detail=f"F1DB race {year} Round {round_num} not found")
    return dossier


@router.get("/api/f1db/driver/{driver_query}")
def api_f1db_driver(driver_query: str):
    profile = f1db.get_driver_f1db_profile(driver_query, srv.DATA_DB)
    if profile is None:
        raise HTTPException(status_code=404, detail=f"F1DB driver '{driver_query}' not found")
    return profile


@router.get("/api/f1db/circuit/{circuit_id}")
def api_f1db_circuit(circuit_id: str):
    profile = f1db.get_circuit_profile(circuit_id, srv.DATA_DB)
    if profile is None:
        raise HTTPException(status_code=404, detail=f"F1DB circuit '{circuit_id}' not found")
    return profile


@router.get("/api/f1db/what-if/{year}/{round_num}")
def api_f1db_what_if(year: int, round_num: int):
    pkt = f1db.get_what_if_gp_packet(year, round_num, srv.DATA_DB)
    if pkt is None:
        raise HTTPException(status_code=404, detail=f"Historical GP {year} Round {round_num} not found")
    return {"ok": True, **pkt}


@router.post("/api/f1db/sync")
def api_f1db_sync(force: bool = Query(False)):
    from ..f1db_sync import sync_f1db, sync_latest_season_into_f1_sqlite
    from .. import driver_dna

    result = sync_f1db(srv.BASE_DIR / "data", force=force)
    archive_sync = sync_latest_season_into_f1_sqlite(
        srv.DATA_DB, srv.BASE_DIR / "data" / "f1db.sqlite", year=srv.CURRENT_SEASON
    )
    f1db.invalidate_caches()
    with driver_dna._DNA_LOCK:
        driver_dna._DNA_CACHE = None
    result["archiveSync"] = archive_sync
    return result


# ---------------------- TracingInsights FIA Documents & Penalties ----------------------

@router.get("/api/fia-docs/status")
def api_fia_docs_status():
    return fia_docs.get_fia_docs_status(srv.DATA_DB)


@router.get("/api/fia-docs/events")
def api_fia_docs_events(year: Optional[int] = Query(None)):
    events = fia_docs.list_events(year=year, path=srv.DATA_DB)
    return {"count": len(events), "events": events}


@router.get("/api/fia-docs/search")
def api_fia_docs_search(
    year: Optional[int] = Query(None),
    event: str = Query(""),
    doc_type: str = Query(""),
    driver: str = Query(""),
    team: str = Query(""),
    q: str = Query(""),
    only_hydrated: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    return fia_docs.search_fia_docs(
        path=srv.DATA_DB,
        year=year,
        event_slug=event,
        doc_type=doc_type,
        driver=driver,
        team=team,
        q=q,
        only_hydrated=only_hydrated,
        limit=limit,
        offset=offset,
    )


@router.get("/api/fia-docs/doc/{year}/{event_slug}/{slug}")
def api_fia_docs_detail(year: int, event_slug: str, slug: str, hydrate: bool = Query(True)):
    res = fia_docs.get_fia_doc_detail(year, event_slug, slug, path=srv.DATA_DB, hydrate=hydrate)
    if res is None:
        raise HTTPException(status_code=404, detail="FIA document not found")
    return res


@router.get("/api/fia-docs/precedents")
def api_fia_docs_precedents():
    return fia_docs.get_fia_precedents(srv.DATA_DB)


@router.post("/api/fia-docs/sync")
def api_fia_docs_sync(force: bool = Query(False), max_sidecars: int = Query(200, ge=10, le=1000)):
    from ..fia_docs_sync import sync_fia_docs
    return sync_fia_docs(srv.BASE_DIR / "data", force=force, max_sidecars=max_sidecars)
