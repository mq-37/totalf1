from __future__ import annotations

from pathlib import Path
import re
from typing import Optional

from fastapi import APIRouter, Request, Query, Form, UploadFile, File, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse, Response, JSONResponse

from .. import server as srv
from ..db import Database

router = APIRouter()

from .cards import _build_driver_cards_bundle, _build_team_cards_bundle

@router.get("/api/prefetch/driver-images")
def prefetch_driver_images(limit: int = Query(0), year_start: Optional[int] = Query(None), year_end: Optional[int] = Query(None)):
    db = srv.get_db()
    # Build driver name list
    names: list[str] = []
    if year_start is not None and year_end is not None:
        cur = db._conn.execute(
            """
            SELECT DISTINCT driver FROM drivers_standings
            WHERE year BETWEEN ? AND ?
            ORDER BY driver
            """,
            (int(year_start), int(year_end)),
        )
    else:
        cur = db._conn.execute("SELECT DISTINCT driver FROM drivers_standings ORDER BY driver")
    names = [row[0] for row in cur.fetchall() if row and row[0]]
    fetched = 0
    existing = 0
    failed = 0
    stored: list[dict] = []
    for name in names[: (limit or len(names))]:
        img = db.get_driver_image(name)
        if img:
            existing += 1
            stored.append({"driver": name, "image": img, "status": "existing"})
            continue
        new_img = srv._fetch_driver_image_if_missing(db, name)
        if new_img:
            fetched += 1
            stored.append({"driver": name, "image": new_img, "status": "fetched"})
        else:
            failed += 1
            stored.append({"driver": name, "image": None, "status": "failed"})
    return {
        "total": len(names[: (limit or len(names))]),
        "existing": existing,
        "fetched": fetched,
        "failed": failed,
        "items": stored,
    }

# List a few drivers currently missing cached images
@router.get("/api/missing/driver-images")
def missing_driver_images(limit: int = Query(10)):
    db = srv.get_db()
    cur = db._conn.execute("SELECT DISTINCT driver FROM drivers_standings ORDER BY driver")
    all_names = [row[0] for row in cur.fetchall() if row and row[0]]
    existing = {
        row[0]
        for row in db._conn.execute("SELECT driver FROM driver_images WHERE image_path IS NOT NULL AND image_path != ''").fetchall()
    }
    cap = max(1, min(500, int(limit)))
    missing = [name for name in all_names if name not in existing][:cap]
    return {"missing": missing, "count": len(missing)}

# Prefetch a single driver image by name (query param or simple slug)
@router.get("/api/prefetch/driver-image")
def prefetch_driver_image(driver: str = Query(..., description="Driver name or slug with dashes")):
    db = srv.get_db()
    name = db.resolve_driver_name(driver)
    if not name:
        return {"ok": False, "error": "driver required"}
    existing = db.get_driver_image(name)
    if existing:
        return {"ok": True, "driver": name, "image": existing, "status": "existing"}
    img = srv._fetch_driver_image_if_missing(db, name)
    return {"ok": bool(img), "driver": name, "image": img, "status": "fetched" if img else "failed"}



@router.post("/api/team/{team}/colors")
@router.post("/api/admin/teams/colors/{team}")
async def save_team_colors(team: str, request: Request, primary: str = Form(...), secondary: str = Form(...), accent: str = Form(...)):
    import json
    for field_name, val in (("primary", primary), ("secondary", secondary), ("accent", accent)):
        if not srv._HEX_COLOR_RE.match((val or "").strip()):
            raise HTTPException(status_code=400, detail=f"Invalid hex colour for {field_name}: expected #RRGGBB")
    primary, secondary, accent = primary.strip(), secondary.strip(), accent.strip()
    db = srv.get_db()
    name = db.resolve_team_name(team)
    srv.LOGGER.info(f"save_team_colors: incoming team='{team}' resolved='{name}', primary='{primary}', secondary='{secondary}', accent='{accent}'")
    srv.TEAM_COLORS[name] = {"primary": primary, "secondary": secondary, "accent": accent}
    srv._invalidate_team_colors_cache()
    # persist to data/team_colors.json and static copy
    for path in srv.TEAM_COLORS_PATHS:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(srv.TEAM_COLORS, indent=2), encoding="utf-8")
            srv.LOGGER.info(f"save_team_colors: wrote colors to {path}")
        except Exception:
            srv.LOGGER.exception(f"save_team_colors: failed to write {path}")
    if request.headers.get("HX-Request"):
        return PlainTextResponse("Saved", status_code=200, headers={"HX-Trigger": "teamColorsSaved"})
    accept = (request.headers.get("accept") or "").lower()
    wants_json = "application/json" in accept and "text/html" not in accept
    if wants_json or request.headers.get("x-requested-with") == "fetch":
        return {"ok": True, "team": name, "colors": srv.TEAM_COLORS[name]}
    return RedirectResponse(url=f"/team/{team}", status_code=303)

# Existing APIs
@router.get("/api/seasons")
def list_seasons():
    db = srv.get_db()
    rows = db._conn.execute("SELECT year FROM seasons ORDER BY year").fetchall()
    seasons = [r["year"] for r in rows]
    return srv._seasons_with_current(seasons)

@router.get("/api/races/{year}")
def api_races(year: int):
    db = srv.get_db()
    return [dict(r) for r in db.list_races(year)]

@router.get("/api/drivers/{year}")
def api_drivers(year: int):
    db = srv.get_db()
    return [dict(r) for r in db.list_driver_standings(year)]

@router.get("/api/teams/{year}")
def api_teams(year: int):
    db = srv.get_db()
    return [dict(r) for r in db.list_team_standings(year)]

@router.get("/api/awards/{year}")
def api_awards(year: int):
    db = srv.get_db()
    return [dict(r) for r in db.list_fastest_laps(year)]

# Analytics APIs
@router.get("/api/analytics/driver-total-points")
def api_driver_total_points(q: Optional[str] = None):
    db = srv.get_db()
    return [dict(r) for r in db.driver_total_points(q)]

@router.get("/api/analytics/driver-champions")
def api_driver_champions():
    db = srv.get_db()
    return [dict(r) for r in db.driver_champions()]

@router.get("/api/analytics/constructor-champions")
def api_constructor_champions():
    db = srv.get_db()
    return [dict(r) for r in db.constructor_champions()]

@router.get("/api/analytics/wins/{year}")
def api_wins(year: int):
    db = srv.get_db()
    return {
        "drivers": [dict(r) for r in db.driver_wins_by_year(year)],
        "teams": [dict(r) for r in db.team_wins_by_year(year)],
        "fastest_laps": [dict(r) for r in db.fastest_lap_leaders_by_year(year)],
        "team_points": [dict(r) for r in db.points_by_team_year(year)],
    }

@router.get("/api/driver/search")
def api_driver_search(q: str = Query("")):
    db = srv.get_db()
    if not q.strip():
        return {"results": []}
    return {"results": db.search_drivers(q)}

# --------------- Jolpica-F1 (Ergast-compatible) current season calendar ---------------
ERGAST_CURRENT_URL = "https://api.jolpi.ca/ergast/f1/current.json"
_CALENDAR_CACHE: dict[str, object] = {"ts": 0.0, "season": None, "races": []}
_CALENDAR_TTL_SECONDS = 900.0


def _fetch_ergast_calendar():
    """Fetch current season race calendar from Jolpica-F1 (Ergast-compatible API) with TTL cache.

    Returns (season, races) or (None, []).
    """
    import time as _time
    now = _time.monotonic()
    if _CALENDAR_CACHE["races"] and (now - float(_CALENDAR_CACHE["ts"])) < _CALENDAR_TTL_SECONDS:
        return (_CALENDAR_CACHE["season"], _CALENDAR_CACHE["races"])
    try:
        import requests
        r = requests.get(ERGAST_CURRENT_URL, timeout=5)
        r.raise_for_status()
        data = r.json()
        rt = data.get("MRData", {}).get("RaceTable", {})
        season = rt.get("season")
        raw_races = rt.get("Races") or []
        races = []
        for race in raw_races:
            loc = (race.get("Circuit") or {}).get("Location") or {}
            fp1 = race.get("FirstPractice") or {}
            qual = race.get("Qualifying") or {}
            races.append({
                "round": race.get("round"),
                "name": race.get("raceName", "").replace(" Grand Prix", "").strip() or race.get("raceName", ""),
                "full_name": race.get("raceName", ""),
                "circuit": (race.get("Circuit") or {}).get("circuitName", ""),
                "locality": loc.get("locality", ""),
                "country": loc.get("country", ""),
                "date": race.get("date", ""),
                "time": race.get("time", ""),
                "fp1_date": fp1.get("date", ""),
                "fp1_time": fp1.get("time", ""),
                "qual_date": qual.get("date", ""),
                "qual_time": qual.get("time", ""),
            })
        if races:
            _CALENDAR_CACHE.update({"ts": now, "season": season, "races": races})
        return (season, races)
    except Exception:
        return (None, [])


def _local_calendar_fallback(db: Database):
    """Fallback to the latest scraped season in SQLite when the live API is unavailable."""
    row = db._conn.execute("SELECT MAX(year) AS y FROM races").fetchone()
    if not row or not row["y"]:
        return (None, [])
    year = int(row["y"])
    rows = db.list_races(year)
    races = [
        {
            "round": r["round"],
            "name": r["grand_prix"],
            "full_name": r["grand_prix"],
            "circuit": r["winner"] or "",
            "locality": r["team"] or "",
            "country": "",
            "date": r["date"] or "",
            "time": "",
            "fp1_date": "",
            "fp1_time": "",
            "qual_date": "",
            "qual_time": "",
            "winner": r["winner"] or "",
            "team": r["team"] or "",
        }
        for r in rows
    ]
    return (year, races)



@router.get("/", response_class=HTMLResponse)
async def home(request: Request):
    db = srv.get_db()
    seasons = [r["year"] for r in db._conn.execute("SELECT year FROM seasons ORDER BY year").fetchall()]
    seasons = srv._seasons_with_current(seasons)
    latest = seasons[-1] if seasons else None
    champion_team, champion_driver = "", ""
    if latest:
        row = db._conn.execute(
            "SELECT team, driver FROM drivers_standings WHERE year=? ORDER BY position LIMIT 1",
            (latest,),
        ).fetchone()
        if row:
            champion_team = row["team"]
            champion_driver = row["driver"]
    champion_slug = srv._find_slug_cached(champion_team)
    return srv.templates.TemplateResponse(
        "index.html",
        {"request": request, "seasons": seasons, "latest": latest,
         "champion_team": champion_team, "champion_driver": champion_driver,
         "champion_slug": champion_slug,
         "champion_color": srv.get_team_colors(champion_team).get("primary", "#d9a441") if champion_team else "#d9a441"},
    )



@router.get("/race", response_class=HTMLResponse)
async def race_calendar_page(request: Request):
    season, races = _fetch_ergast_calendar()
    calendar_source = "live"
    if not races:
        db = srv.get_db()
        local_season, local_races = _local_calendar_fallback(db)
        if local_races:
            season, races = local_season, local_races
            calendar_source = "local"
    return srv.templates.TemplateResponse(
        "race_calendar.html",
        {
            "request": request,
            "season": season or srv.CURRENT_SEASON,
            "races": races,
            "calendar_source": calendar_source,
        },
    )

@router.get("/teams/colors", response_class=HTMLResponse)
@router.get("/team-colors", response_class=HTMLResponse)
@router.get("/admin/teams/colors", response_class=HTMLResponse)
async def team_colors_page(request: Request):
    from ..f1_car_palettes import find_car_png_slug as _find_car_png_slug
    db = srv.get_db()
    # Bulk query 1: every distinct team + active year span (replaces 201 per-team queries)
    span_rows = db._conn.execute(
        """
        SELECT team, MIN(year) AS y_min, MAX(year) AS y_max FROM (
            SELECT team, year FROM drivers_standings WHERE team IS NOT NULL AND team != ''
            UNION ALL
            SELECT team, year FROM team_standings WHERE team IS NOT NULL AND team != ''
        )
        GROUP BY team
        ORDER BY team
        """
    ).fetchall()
    # Bulk query 2: top drivers per team by season appearances (replaces 201 per-team queries)
    drv_rows = db._conn.execute(
        """
        SELECT team, driver, COUNT(*) AS c
        FROM drivers_standings
        WHERE team IS NOT NULL AND team != '' AND driver IS NOT NULL AND driver != ''
        GROUP BY team, driver
        ORDER BY team, c DESC, driver
        """
    ).fetchall()
    top_drivers_by_team: dict[str, list[str]] = {}
    for rr in drv_rows:
        lst = top_drivers_by_team.setdefault(rr["team"], [])
        if len(lst) < 6:
            lst.append(rr["driver"])

    payload = []
    for row in span_rows:
        t = row["team"]
        y_min, y_max = row["y_min"], row["y_max"]
        years_label = "" if (y_min is None or y_max is None) else (str(y_min) if y_min == y_max else f"{y_min}–{y_max}")
        payload.append({
            "name": t,
            "colors": srv.get_team_colors(t),
            "years": years_label,
            "drivers": ", ".join(top_drivers_by_team.get(t, [])),
            "slug": srv._slugify_name(t),
            "car_slug": _find_car_png_slug(t, year=y_max),
        })
    return srv.templates.TemplateResponse("team_colors.html", {"request": request, "teams": payload})

@router.get("/races/{year}", response_class=HTMLResponse)
async def races_page(year: int, request: Request):
    db = srv.get_db()
    rows = db.list_races(year)
    return srv.templates.TemplateResponse("races.html", {"request": request, "year": year, "rows": rows})

@router.get("/drivers/{year}", response_class=HTMLResponse)
async def drivers_page(year: int, request: Request):
    db = srv.get_db()
    rows = db.list_driver_standings(year)
    return srv.templates.TemplateResponse("drivers.html", {"request": request, "year": year, "rows": rows})

@router.get("/teams/{year}", response_class=HTMLResponse)
async def teams_page(year: int, request: Request):
    db = srv.get_db()
    rows = db.list_team_standings(year)
    from ..f1_car_palettes import find_car_png_slug
    car_slugs = {r["team"]: find_car_png_slug(r["team"], year=year) for r in rows if r["team"]}
    return srv.templates.TemplateResponse(
        "teams.html",
        {"request": request, "year": year, "rows": rows, "car_slugs": car_slugs},
    )

@router.get("/awards/{year}", response_class=HTMLResponse)
async def awards_page(year: int, request: Request):
    db = srv.get_db()
    rows = db.list_fastest_laps(year)
    return srv.templates.TemplateResponse("awards.html", {"request": request, "year": year, "rows": rows})

@router.get("/analytics", response_class=HTMLResponse)
async def analytics_home(request: Request, year: Optional[int] = None):
    db = srv.get_db()
    seasons = [r["year"] for r in db._conn.execute("SELECT year FROM seasons ORDER BY year").fetchall()]
    seasons = srv._seasons_with_current(seasons)
    year = year or (seasons[-1] if seasons else None)
    data = {
        "driver_totals": db.driver_total_points()[:25],
        "driver_champions": db.driver_champions(),
        "constructor_champions": db.constructor_champions(),
        "wins": db.driver_wins_by_year(year) if year else [],
        "team_wins": db.team_wins_by_year(year) if year else [],
        "fastest": db.fastest_lap_leaders_by_year(year) if year else [],
        "team_points": db.points_by_team_year(year) if year else [],
    }
    return srv.templates.TemplateResponse(
        "analytics.html",
        {"request": request, "seasons": seasons, "year": year, **data},
    )

@router.get("/analytics/overall", response_class=HTMLResponse)
async def analytics_overall(request: Request):
    db = srv.get_db()
    data = {
        "driver_totals": db.driver_total_points()[:50],
        "driver_champions": db.driver_champions(),
        "constructor_champions": db.constructor_champions(),
        "team_totals": db.team_total_points_overall(),
    }
    return srv.templates.TemplateResponse("analytics_overall.html", {"request": request, **data})

@router.get("/analytics/season", response_class=HTMLResponse)
async def analytics_season(request: Request, year: Optional[int] = None):
    db = srv.get_db()
    seasons = [r["year"] for r in db._conn.execute("SELECT year FROM seasons ORDER BY year").fetchall()]
    seasons = srv._seasons_with_current(seasons)
    year = year or (seasons[-1] if seasons else None)
    # Build race list and per-race classification for the chosen season
    races = db.list_races(year) if year else []
    # Group race results by round for tabbed display
    results_by_round: dict[int, list[dict]] = {}
    if year:
        cur = db._conn.execute(
            "SELECT round, driver, team, position_text, position_order FROM race_results WHERE year=? ORDER BY round, position_order, driver",
            (year,),
        )
        for r in cur.fetchall():
            d = dict(r)
            results_by_round.setdefault(int(d["round"]), []).append(d)
    # Compose race tabs with metadata and per-race classification rows
    race_tabs: list[dict] = []
    for r in races:
        rnd = int(r["round"])  # sqlite3.Row is subscriptable; avoid attribute access
        race_tabs.append({
            "round": rnd,
            "grand_prix": r["grand_prix"],
            "date": r["date"],
            "winner": r["winner"],
            "team": r["team"],
            "laps": r["laps"],
            "time": r["time"],
            "results": results_by_round.get(rnd, []),
        })
    payload = {
        "seasons": seasons,
        "year": year,
        "wins": db.driver_wins_by_year(year) if year else [],
        "team_wins": db.team_wins_by_year(year) if year else [],
        "fastest": db.fastest_lap_leaders_by_year(year) if year else [],
        "team_points": db.points_by_team_year(year) if year else [],
        "driver_standings": db.list_driver_standings(year) if year else [],
        "team_standings": db.list_team_standings(year) if year else [],
        "race_tabs": race_tabs,
    }
    return srv.templates.TemplateResponse("analytics_season.html", {"request": request, **payload})

@router.get("/analytics/team", response_class=HTMLResponse)
async def analytics_team(request: Request, team: Optional[str] = None):
    db = srv.get_db()
    teams = [r["team"] for r in db._conn.execute("SELECT DISTINCT team FROM drivers_standings ORDER BY team").fetchall()]
    selected = team or (teams[0] if teams else None)
    seasons = []
    if selected:
        seasons = [dict(r) for r in db._conn.execute(
            "SELECT year, SUM(points) AS points FROM drivers_standings WHERE team=? GROUP BY year ORDER BY year",
            (selected,),
        ).fetchall()]
    return srv.templates.TemplateResponse("analytics_team.html", {"request": request, "teams": teams, "team": selected, "seasons": seasons})


@router.get("/analytics/tracks", response_class=HTMLResponse)
async def analytics_tracks(request: Request, track: Optional[str] = None, top: int = 5):
    """Per-track championship: normalised points 1st=10, 2nd=9, ..., 10th=1. Highest scorer per track."""
    db = srv.get_db()
    top = max(1, min(20, top))
    champions = db.per_track_driver_points(top_per_track=1)
    all_standings = db.per_track_driver_points(top_per_track=top)
    tracks = db.list_tracks()
    # Track championships per driver: one track = 1 (count of tracks where they are champion)
    track_championship_counts: dict[str, int] = {}
    for r in champions:
        d = r["driver"]
        track_championship_counts[d] = track_championship_counts.get(d, 0) + 1
    selected_track = track or None
    track_standings = []
    if selected_track:
        track_standings = db.per_track_standings(selected_track, limit=30)
    return srv.templates.TemplateResponse(
        "analytics_tracks.html",
        {
            "request": request,
            "champions": champions,
            "track_championship_counts": track_championship_counts,
            "all_standings": all_standings,
            "tracks": tracks,
            "selected_track": selected_track,
            "track_standings": track_standings,
            "top_n": top,
        },
    )


@router.get("/driver", response_class=HTMLResponse)
async def driver_search_page(request: Request, q: str | None = None):
    db = srv.get_db()
    results = db.search_drivers(q) if q else []
    return srv.templates.TemplateResponse("driver_search.html", {"request": request, "q": q or "", "results": results})



@router.get("/driver/{driver}", response_class=HTMLResponse)
async def driver_page(driver: str, request: Request):
    db = srv.get_db()
    name = db.resolve_driver_name(driver)
    data = db.driver_profile(name)
    seasons = data.get("seasons") or []
    latest_team = seasons[-1]["team"] if seasons else ""
    latest_year = seasons[-1]["year"] if seasons else None
    team_colors = srv.get_team_colors(latest_team) if latest_team else {}
    avatar = db.resolve_avatar(name, team_colors)
    team_defaults = db.avatar_from_team_colors(team_colors)
    driver_image = db.get_driver_image(name)
    from ..f1_car_palettes import find_car_png_slug, infer_team_era
    car_era = infer_team_era(latest_team, year=latest_year, team_years_map=srv._team_peak_years_map(db)) if latest_team else "2020s"
    driver_cards = _build_driver_cards_bundle(db, name)
    return srv.templates.TemplateResponse(
        "driver.html",
        {
            "request": request,
            **data,
            "avatar": avatar,
            "team_defaults": team_defaults,
            "latest_team": latest_team,
            "latest_year": latest_year,
            "driver_image": driver_image,
            "car_slug": find_car_png_slug(latest_team, year=latest_year) if latest_team else None,
            "car_era": car_era,
            "driver_cards": driver_cards,
        },
    )



@router.post("/api/driver/{driver}/avatar")
async def update_avatar(
    request: Request,
    driver: str,
    suit: str = Form(None),
    helmet: str = Form(None),
    accent: str = Form(None),
    trim: str = Form(None),
    skin: str = Form(None),
    hair: str = Form(None),
    style: str = Form(None),
    reset: str = Form(None),
):
    db = srv.get_db()
    name = db.resolve_driver_name(driver)
    slug = driver
    if reset:
        db.clear_avatar(name)
        # Resolve against latest team so JSON clients get team defaults
        try:
            seasons = db.driver_profile(name).get("seasons") or []
            latest = seasons[-1]["team"] if seasons else ""
            avatar = db.resolve_avatar(name, srv.get_team_colors(latest) if latest else None)
        except Exception:
            avatar = db.resolve_avatar(name, None)
    else:
        current = {
            "suit": suit or "#555555",
            "helmet": helmet or "#dddddd",
            "accent": accent or "#111111",
            "trim": trim or accent or "#111111",
            "style": style or "race",
            "custom": True,
        }
        if skin:
            current["skin"] = skin
        if hair:
            current["hair"] = hair
        db.upsert_avatar(name, current)
        avatar = current
    # Form posts: return to profile; fetch/XHR: JSON
    accept = (request.headers.get("accept") or "").lower()
    wants_json = "application/json" in accept and "text/html" not in accept
    if wants_json or request.headers.get("x-requested-with") == "fetch":
        return {"ok": True, "avatar": avatar}
    return RedirectResponse(url=f"/driver/{slug}", status_code=303)

def _is_valid_image_bytes(content: bytes, ext: str) -> bool:
    if not content:
        return False
    magic_ok = (
        (ext in (".jpg", ".jpeg") and content.startswith(b"\xff\xd8\xff"))
        or (ext == ".png" and content.startswith(b"\x89PNG\r\n\x1a\n"))
        or (ext == ".webp" and len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP")
        or (ext == ".avif" and len(content) >= 12 and content[4:8] == b"ftyp" and content[8:12] in (b"avif", b"avis", b"mif1"))
    )
    if not magic_ok:
        return False
    # Reject disguised active markup even if prefixed with fake headers
    head_low = content[:512].lower()
    if b"<svg" in head_low or b"<script" in head_low or b"<html" in head_low:
        return False
    return True


# ---------------- Driver images (upload) ----------------
@router.post("/api/driver/{driver}/image")
async def upload_driver_image(request: Request, driver: str, file: UploadFile = File(...)):
    db = srv.get_db()
    name = db.resolve_driver_name(driver)
    images_dir = Path(srv.DRIVER_IMAGES_DIR)
    images_dir.mkdir(parents=True, exist_ok=True)
    ext = (Path(file.filename or "").suffix or ".jpg").lower()
    if ext not in srv._ALLOWED_IMAGE_EXTS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type '{ext}'. Allowed: .jpg, .jpeg, .png, .webp",
        )
    content = await file.read(srv._MAX_UPLOAD_IMAGE_BYTES + 1)
    if len(content) > srv._MAX_UPLOAD_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Uploaded image exceeds 5 MB limit")
    if not _is_valid_image_bytes(content, ext):
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid JPG, PNG, or WebP image")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-") or "driver"
    out_path = images_dir / f"{safe}{ext}"
    out_path.write_bytes(content)
    # Persist path (relative to srv.BASE_DIR when inside it, else canonical data/driver_images/...)
    try:
        rel_path = str(out_path.relative_to(srv.BASE_DIR))
    except ValueError:
        rel_path = f"data/driver_images/{out_path.name}"
    db.upsert_driver_image(name, rel_path)
    srv.LOGGER.info(f"upload_driver_image: saved image for '{name}' to {rel_path}")
    accept = (request.headers.get("accept") or "").lower()
    wants_json = "application/json" in accept and "text/html" not in accept
    if wants_json or request.headers.get("x-requested-with") == "fetch":
        return {"ok": True, "image": rel_path}
    return RedirectResponse(url=f"/driver/{driver}", status_code=303)

@router.get("/api/team/{team}")
def api_team(team: str):
    db = srv.get_db()
    name = db.resolve_team_name(team)
    return db.team_profile(name)

@router.get("/team/{team}", response_class=HTMLResponse)
async def team_page(team: str, request: Request):
    db = srv.get_db()
    name = db.resolve_team_name(team)
    data = db.team_profile(name)
    from ..f1_car_palettes import find_slug, load_palettes, infer_livery_style, infer_team_era
    car_slug = find_slug(name)
    car_palette = load_palettes().get(name)
    if car_palette is None and car_slug:
        # display name (e.g. "McLaren") -> palette keyed by its full family name
        for pal_name, pal in load_palettes().items():
            if find_slug(pal_name) == car_slug:
                car_palette = pal
                break
    last_year = (data.get("range") or {}).get("last_year")
    car_era = infer_team_era(name, year=last_year, team_years_map=srv._team_peak_years_map(db))
    team_cards = _build_team_cards_bundle(db, name)
    return srv.templates.TemplateResponse(
        "team.html",
        {
            "request": request,
            **data,
            "car_slug": car_slug,
            "car_palette": car_palette,
            "car_livery_style": infer_livery_style(name),
            "car_era": car_era,
            "team_cards": team_cards,
        },
    )



@router.get("/drivers/{year}/edit/{position}", response_class=HTMLResponse)
async def driver_edit_row(year: int, position: int, request: Request):
    db = srv.get_db()
    row = db.get_driver_standing(year, position)
    if not row:
        return HTMLResponse("Row not found", status_code=404)
    return srv.templates.TemplateResponse("partials/driver_row_edit.html", {"request": request, "r": row})

@router.post("/drivers/{year}/edit/{position}", response_class=HTMLResponse)
async def driver_save_row(year: int, position: int, request: Request,
                          driver: str = Form(...), nationality: str = Form(...), team: str = Form(...), points: float = Form(...), driver_id: str | None = Form(None)):
    db = srv.get_db()
    db.update_driver_standing(year, position, driver=driver, nationality=nationality, team=team, points=float(points), driver_id=driver_id)
    # Return the read-only row partial
    rows = db.list_driver_standings(year)
    r = next((rr for rr in rows if rr["position"] == position), None)
    if not r:
        return HTMLResponse("Row not found", status_code=404)
    return srv.templates.TemplateResponse("partials/driver_row_view.html", {"request": request, "r": r})

@router.get("/api/analytics/balance-audit", response_class=JSONResponse)
async def api_balance_audit():
    """Diagnostic audit of rating spread, floor pile-up, duel diversity & cross-era balance."""
    from ..game import compute_game_profile
    db = srv.get_db()
    buckets = []
    for label, rows in [
        ("2026", db.driver_season_ratings(2026)),
        ("2025", db.driver_season_ratings(2025)),
        ("2024", db.driver_season_ratings(2024)),
        ("2021", db.driver_season_ratings(2021)),
        ("1988", db.driver_season_ratings(1988)),
        ("alltime_top25", db.driver_alltime_ratings()[:25]),
    ]:
        if not rows:
            continue
        ovrs = [r["overall"] for r in rows]
        profs = [compute_game_profile(r) for r in rows]
        paces = [p["stats"]["pace"] for p in profs]
        rcs = [p["stats"]["racecraft"] for p in profs]
        duels = [p["stats"]["duels"] for p in profs]
        buckets.append({
            "deck": label,
            "count": len(rows),
            "ovr_min": round(min(ovrs), 2),
            "ovr_max": round(max(ovrs), 2),
            "ovr_avg": round(sum(ovrs) / len(ovrs), 2),
            "p1_p2_gap": round(ovrs[0] - ovrs[1], 2) if len(ovrs) >= 2 else 0.0,
            "pace_range": [min(paces), max(paces)],
            "racecraft_range": [min(rcs), max(rcs)],
            "unique_duel_values": len(set(duels)),
            "top5": [
                {
                    "driver": r["driver"],
                    "team": r.get("team") or "",
                    "overall": r["overall"],
                    "legacy_overall": r["legacy_overall"],
                    "stats": p["stats"],
                }
                for r, p in list(zip(rows, profs))[:5]
            ],
        })
    return {"status": "ok", "decks": buckets}


@router.get("/drivers/{year}/row/{position}", response_class=HTMLResponse)
async def driver_row_view(year: int, position: int, request: Request):
    db = srv.get_db()
    rows = db.list_driver_standings(year)
    r = next((rr for rr in rows if rr["position"] == position), None)
    if not r:
        return HTMLResponse("Row not found", status_code=404)
    return srv.templates.TemplateResponse("partials/driver_row_view.html", {"request": request, "r": r})

