from __future__ import annotations

from pathlib import Path
import re
from typing import Optional

from fastapi import APIRouter, Request, Query, Form, UploadFile, File, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse, Response, JSONResponse

from .. import server as srv
from ..db import Database

router = APIRouter()

from ..pdf import _render_cards_pdf, _render_tracks_pdf

def _build_driver_cards_bundle(db, name: str) -> list[dict]:
    """Build All-Time Legacy card + every Season Card for a single driver (for web gallery & PDF export)."""
    from ..f1_car_palettes import find_car_png_slug
    img = db.get_driver_image(name)
    alltime_list = db.driver_alltime_ratings()
    alltime_entry = next((r for r in alltime_list if r.get("driver") == name), None)
    champ_years = [
        int(r["year"])
        for r in db._conn.execute(
            "SELECT year FROM drivers_standings WHERE position=1 AND driver=? ORDER BY year",
            (name,),
        ).fetchall()
    ]
    seasons_rows = [
        dict(r)
        for r in db._conn.execute(
            "SELECT year, position, team, points, nationality FROM drivers_standings WHERE driver=? ORDER BY year DESC",
            (name,),
        ).fetchall()
    ]

    # Map team constructor podiums by (year, team)
    cpos_map: dict[tuple[int, str], int] = {}
    for rr in db._conn.execute("SELECT year, position, team FROM team_standings WHERE position IN (1,2,3)").fetchall():
        cpos_map[(int(rr["year"]), (rr["team"] or "").strip().lower())] = int(rr["position"])

    cards: list[dict] = []
    if alltime_entry:
        hist_cars = []
        for sr in reversed(seasons_rows):
            tname = sr.get("team") or ""
            y = int(sr["year"])
            tcols = srv.get_team_colors(tname) if tname else {"primary": "#5a6472", "secondary": "#cbd5e1", "accent": "#111111"}
            hist_cars.append({
                "name": tname,
                "colors": tcols,
                "year": y,
                "position": sr.get("position"),
                "points": sr.get("points"),
                "cpos": cpos_map.get((y, tname.strip().lower()), 0),
                "car_slug": find_car_png_slug(tname, year=y) if tname else None,
            })
        latest_t = seasons_rows[0]["team"] if seasons_rows else (alltime_entry.get("team") or "")
        latest_y = int(seasons_rows[0]["year"]) if seasons_rows else None
        av = db.resolve_avatar(name, srv.get_team_colors(latest_t) if latest_t else None)
        cards.append({
            **alltime_entry,
            "card_kind": "alltime",
            "card_label": "ALL-TIME LEGACY",
            "year": None,
            "team": latest_t,
            "car_slug": find_car_png_slug(latest_t, year=latest_y) if latest_t else None,
            "team_color": (srv.get_team_colors(latest_t) if latest_t else {}).get("primary", "#facc15"),
            "avatar_suit": av.get("suit", "#888888"),
            "avatar_helmet": av.get("helmet", "#bbbbbb"),
            "avatar_accent": av.get("accent", "#333333"),
            "driver_image": img,
            "cars": hist_cars,
            "champion_years": champ_years,
        })

    for sr in seasons_rows:
        y = int(sr["year"])
        s_ratings = db.driver_season_ratings(y)
        r = next((x for x in s_ratings if x.get("driver") == name), None)
        if not r:
            continue
        tname = r.get("team") or sr.get("team") or ""
        tcols = srv.get_team_colors(tname) if tname else {"primary": "#5a6472", "secondary": "#cbd5e1", "accent": "#111111"}
        av = db.resolve_avatar(name, tcols)
        cards.append({
            **r,
            "card_kind": "season",
            "card_label": f"SEASON {y}",
            "year": y,
            "car_slug": find_car_png_slug(tname, year=y) if tname else None,
            "team_color": tcols.get("primary", "#5a6472"),
            "avatar_suit": av.get("suit", "#888888"),
            "avatar_helmet": av.get("helmet", "#bbbbbb"),
            "avatar_accent": av.get("accent", "#333333"),
            "driver_image": img,
            "cars": [{
                "name": tname,
                "colors": tcols,
                "year": y,
                "position": r.get("rank") or sr.get("position"),
                "points": r.get("points"),
                "wins": r.get("wins"),
                "cpos": cpos_map.get((y, tname.strip().lower()), 0),
            }],
            "champion_years": champ_years,
        })
    return cards


def _build_team_cards_bundle(db, team_name: str) -> list[dict]:
    """Build driver cards for every driver who raced for a constructor (sorted by wins, points, overall)."""
    from ..f1_car_palettes import find_car_png_slug
    rows = db._conn.execute(
        """
        SELECT driver, MIN(year) AS first_y, MAX(year) AS last_y, COUNT(*) AS team_seasons,
               SUM(COALESCE(points, 0)) AS team_pts, MIN(position) AS best_pos
        FROM drivers_standings
        WHERE team=? AND driver IS NOT NULL AND driver != ''
        GROUP BY driver
        ORDER BY team_pts DESC, best_pos ASC, last_y DESC
        """,
        (team_name,),
    ).fetchall()
    if not rows:
        return []

    alltime_map = {r["driver"]: r for r in db.driver_alltime_ratings()}
    wins_map = {
        r["winner"]: int(r["w"])
        for r in db._conn.execute(
            "SELECT winner, COUNT(*) AS w FROM races WHERE team=? AND winner IS NOT NULL GROUP BY winner",
            (team_name,),
        ).fetchall()
    }
    champ_map: dict[str, list[int]] = {}
    for rr in db._conn.execute("SELECT driver, year FROM drivers_standings WHERE position=1 ORDER BY year").fetchall():
        champ_map.setdefault(rr["driver"], []).append(int(rr["year"]))

    tcols = srv.get_team_colors(team_name)
    cards: list[dict] = []
    for idx, r in enumerate(rows, start=1):
        drv = r["driver"]
        at = alltime_map.get(drv) or {}
        img = db.get_driver_image(drv)
        av = db.resolve_avatar(drv, tcols)
        last_y = int(r["last_y"])
        first_y = int(r["first_y"])
        twins = int(wins_map.get(drv, 0))
        tpts = round(float(r["team_pts"] or 0), 1)
        yr_lbl = str(first_y) if first_y == last_y else f"{first_y}–{last_y}"
        c_slug = find_car_png_slug(team_name, year=last_y)
        cards.append({
            **at,
            "driver": drv,
            "rank": idx,
            "position": int(r["best_pos"] or idx),
            "nationality": at.get("nationality") or "",
            "team": team_name,
            "team_color": tcols.get("primary", "#5a6472"),
            "car_slug": c_slug,
            "overall": round(float(at.get("overall") or 70.0), 1),
            "legacy_overall": round(float(at.get("legacy_overall") or at.get("overall") or 70.0), 1),
            "points": tpts,
            "wins": twins,
            "fastest_laps": int(at.get("fastest_laps") or 0),
            "starts": int(at.get("starts") or max(1, int(r["team_seasons"]) * 12)),
            "podiums": int(at.get("podiums") or twins),
            "dnfs": int(at.get("dnfs") or 0),
            "years_active": yr_lbl,
            "team_seasons": int(r["team_seasons"]),
            "badges": list(at.get("badges") or []),
            "avatar_suit": av.get("suit", "#888888"),
            "avatar_helmet": av.get("helmet", "#bbbbbb"),
            "avatar_accent": av.get("accent", "#333333"),
            "driver_image": img,
            "cars": [{
                "name": team_name,
                "colors": tcols,
                "year": last_y,
                "position": int(r["best_pos"] or idx),
                "points": tpts,
                "wins": twins,
                "cpos": 1 if int(r["best_pos"] or 99) == 1 else 0,
            }],
            "champion_years": champ_map.get(drv, []),
        })
    cards.sort(key=lambda c: (-c["wins"], -c["points"], -c["overall"]))
    for i, c in enumerate(cards, start=1):
        c["rank"] = i
    return cards



@router.get("/driver/{driver}/cards.pdf")
async def driver_cards_pdf(driver: str, mode: str = Query("collector"), year: Optional[int] = Query(None)):
    """Download printable Collector or Game PDF containing all cards (or one season card) for a driver."""
    db = srv.get_db()
    name = db.resolve_driver_name(driver)
    cards = _build_driver_cards_bundle(db, name)
    if year is not None:
        cards = [c for c in cards if c.get("year") == year]
    if not cards:
        raise HTTPException(status_code=404, detail="No cards found for driver")
    lbl = f"{name} · {year}" if year else f"{name} · All Cards"
    pdf_bytes = _render_cards_pdf(cards, title=lbl, size="fold", mode=mode)
    slug = srv._slugify_name(name) or "driver"
    suffix = "-game" if (mode or "").lower() == "game" else ""
    yr_tag = f"-{year}" if year else "-all"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename={slug}{yr_tag}{suffix}.pdf"},
    )



@router.get("/team/{team}/cards.pdf")
async def team_cards_pdf(team: str, mode: str = Query("collector")):
    """Download printable Collector or Game PDF containing all driver cards for a constructor."""
    db = srv.get_db()
    name = db.resolve_team_name(team)
    cards = _build_team_cards_bundle(db, name)
    if not cards:
        raise HTTPException(status_code=404, detail="No driver cards found for team")
    pdf_bytes = _render_cards_pdf(cards, title=f"{name} · Driver Cards", size="fold", mode=mode)
    slug = srv._slugify_name(name) or "team"
    suffix = "-game" if (mode or "").lower() == "game" else ""
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename={slug}-driver-cards{suffix}.pdf"},
    )

@router.get("/api/ratings/season/{year}")
def api_ratings_season(year: int):
    db = srv.get_db()
    return db.driver_season_ratings(year)

@router.get("/cards", response_class=HTMLResponse)
async def cards_page(request: Request, year: Optional[int] = None):
    db = srv.get_db()
    seasons = [r["year"] for r in db._conn.execute("SELECT year FROM seasons ORDER BY year").fetchall()]
    seasons = srv._seasons_with_current(seasons)
    sel = year or (seasons[-1] if seasons else None)
    ratings = db.driver_season_ratings(sel) if sel else []
    img_map = {r["driver"]: r["image_path"] for r in db._conn.execute("SELECT driver, image_path FROM driver_images").fetchall()}
    out = []
    for r in ratings:
        img = img_map.get(r.get("driver", ""))
        out.append({**r, "driver_image": img} if img else r)
    from ..f1_car_palettes import find_car_png_slug
    car_slugs = {r["team"]: find_car_png_slug(r["team"], year=sel) for r in out if r.get("team")}
    return srv.render_template(request, "cards.html", { "seasons": seasons, "year": sel, "ratings": out, "car_slugs": car_slugs})

@router.get("/api/ratings/decade/{decade}")
def api_ratings_decade(decade: int):
    db = srv.get_db()
    start = (decade // 10) * 10
    return db.driver_decade_ratings(start)

@router.get("/cards/decade", response_class=HTMLResponse)
async def cards_decade_page(request: Request, decade: Optional[int] = None):
    db = srv.get_db()
    years = [r["year"] for r in db._conn.execute("SELECT year FROM seasons ORDER BY year").fetchall()]
    years = srv._seasons_with_current(years)
    decades = sorted({(y // 10) * 10 for y in years})
    sel = decade if decade is not None else (decades[0] if decades else None)
    ratings = db.driver_decade_ratings(sel) if sel is not None else []
    img_map = {r["driver"]: r["image_path"] for r in db._conn.execute("SELECT driver, image_path FROM driver_images").fetchall()}
    out = []
    for r in ratings:
        img = img_map.get(r.get("driver", ""))
        out.append({**r, "driver_image": img} if img else r)
    from ..f1_car_palettes import find_car_png_slug
    car_slugs = {r["team"]: find_car_png_slug(r["team"], year=sel) for r in out if r.get("team")}
    return srv.render_template(request, "cards_decade.html", { "decades": decades, "decade": sel, "ratings": out, "car_slugs": car_slugs})

@router.get("/cards/alltime", response_class=HTMLResponse)
async def cards_alltime_page(request: Request):
    import re as _re
    db = srv.get_db()
    ratings = db.driver_alltime_ratings()
    img_map = {r["driver"]: r["image_path"] for r in db._conn.execute("SELECT driver, image_path FROM driver_images").fetchall()}
    from ..f1_car_palettes import find_car_png_slug
    out = []
    total_points = 0.0
    for r in ratings:
        name = r.get("driver", "")
        img = img_map.get(name)
        first_team = (r.get("teams") or [""])[0]
        yrs_found = [int(y) for y in _re.findall(r"\b(?:19|20)\d{2}\b", str(r.get("years_active") or ""))]
        era_year = (yrs_found[0] + yrs_found[-1]) // 2 if yrs_found else None
        r = {
            **r,
            **({"driver_image": img} if img else {}),
            "car_png_slug": find_car_png_slug(first_team, year=era_year) if first_team else None,
        }
        out.append(r)
        total_points += float(r.get("points") or 0)
    car_slugs = {r["teams"][0]: r["car_png_slug"] for r in out if r.get("teams") and r.get("car_png_slug")}
    return srv.render_template(request, "cards_alltime.html", { "ratings": out, "total_points_tally": round(total_points, 2), "car_slugs": car_slugs},
    )



def _pdf_bulk_lookups(db: Database, *, year_start: int | None = None, year_end: int | None = None) -> dict:
    """Preload images, champions, wins, team podiums, and season rows in bulk to eliminate PDF N+1 queries."""
    img_map = {r["driver"]: r["image_path"] for r in db._conn.execute("SELECT driver, image_path FROM driver_images").fetchall()}
    champ_map: dict[str, list[int]] = {}
    for rr in db._conn.execute("SELECT driver, year FROM drivers_standings WHERE position=1 ORDER BY year").fetchall():
        champ_map.setdefault(rr["driver"], []).append(int(rr["year"]))

    def _norm_t(n: str) -> str:
        return re.sub(r"[^a-z0-9 ]+", "", (n or "").lower()).strip()

    podiums_by_year: dict[int, list[tuple[int, str]]] = {}
    if year_start is not None and year_end is not None:
        ts_rows = db._conn.execute(
            "SELECT year, position, team FROM team_standings WHERE year BETWEEN ? AND ? AND position IN (1,2,3) ORDER BY year, position",
            (year_start, year_end),
        ).fetchall()
    else:
        ts_rows = db._conn.execute(
            "SELECT year, position, team FROM team_standings WHERE position IN (1,2,3) ORDER BY year, position"
        ).fetchall()
    for rr in ts_rows:
        podiums_by_year.setdefault(int(rr["year"]), []).append((int(rr["position"]), _norm_t(rr["team"])))

    def match_cpos(y: int | None, team_name: str) -> int:
        if y is None or not team_name:
            return 0
        dt = _norm_t(team_name)
        if not dt:
            return 0
        for pos, nt in podiums_by_year.get(int(y), ()):
            if nt.startswith(dt) or dt.startswith(nt):
                return pos
        return 0

    wins_by_dy: dict[tuple[str, int], int] = {}
    if year_start is not None and year_end is not None:
        w_rows = db._conn.execute(
            "SELECT winner, year, COUNT(*) AS c FROM races WHERE year BETWEEN ? AND ? AND winner IS NOT NULL GROUP BY winner, year",
            (year_start, year_end),
        ).fetchall()
        ds_rows = db._conn.execute(
            "SELECT driver, year, position, team, points FROM drivers_standings WHERE year BETWEEN ? AND ? ORDER BY year",
            (year_start, year_end),
        ).fetchall()
    else:
        w_rows = db._conn.execute(
            "SELECT winner, year, COUNT(*) AS c FROM races WHERE winner IS NOT NULL GROUP BY winner, year"
        ).fetchall()
        ds_rows = db._conn.execute(
            "SELECT driver, year, position, team, points FROM drivers_standings ORDER BY year"
        ).fetchall()
    for rr in w_rows:
        wins_by_dy[(rr["winner"], int(rr["year"]))] = int(rr["c"] or 0)

    seasons_by_driver: dict[str, list[dict]] = {}
    for rr in ds_rows:
        seasons_by_driver.setdefault(rr["driver"], []).append(dict(rr))

    return {
        "img_map": img_map,
        "champ_map": champ_map,
        "match_cpos": match_cpos,
        "wins_by_dy": wins_by_dy,
        "seasons_by_driver": seasons_by_driver,
    }


@router.get("/cards.pdf")
async def cards_pdf(year: Optional[int] = None, mode: str = Query("collector")):
    db = srv.get_db()
    seasons = [r["year"] for r in db._conn.execute("SELECT year FROM seasons ORDER BY year").fetchall()]
    sel = year or (seasons[-1] if seasons else None)
    ratings = db.driver_season_ratings(sel) if sel else []
    bulk = _pdf_bulk_lookups(db, year_start=sel, year_end=sel) if sel else _pdf_bulk_lookups(db)
    img_map = bulk["img_map"]
    champ_map = bulk["champ_map"]
    match_cpos = bulk["match_cpos"]
    out = []
    for r in ratings:
        name = r.get("driver", "")
        team_name = r.get("team", "") or ""
        cols = srv.get_team_colors(team_name)
        avatar = db.resolve_avatar(name, cols)
        img = img_map.get(name) or srv._fetch_driver_image_if_missing(db, name)
        cpos = match_cpos(sel, team_name)
        r2 = {
            **r,
            "avatar_suit": avatar.get("suit", "#888888"),
            "avatar_helmet": avatar.get("helmet", "#bbbbbb"),
            "avatar_accent": avatar.get("accent", "#333333"),
            "driver_image": img,
            "cars": [{"name": team_name, "colors": cols, "year": sel, "position": r.get("rank") or r.get("position"), "points": r.get("points"), "wins": r.get("wins"), "cpos": cpos}],
            "champion_years": champ_map.get(name, []),
        }
        out.append(r2)
    pdf_bytes = _render_cards_pdf(out, title=f"Driver Cards {sel}", size="fold", mode=mode)
    suffix = "-game" if (mode or "").lower() == "game" else ""
    return Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": f"inline; filename=driver-cards-{sel}{suffix}.pdf"})


@router.get("/cards/decade.pdf")
async def cards_decade_pdf(decade: Optional[int] = None, mode: str = Query("collector")):
    db = srv.get_db()
    years = [r["year"] for r in db._conn.execute("SELECT year FROM seasons ORDER BY year").fetchall()]
    decades = sorted({(y // 10) * 10 for y in years})
    sel = decade if decade is not None else (decades[0] if decades else None)
    ratings = db.driver_decade_ratings(sel) if sel is not None else []
    bulk = _pdf_bulk_lookups(db, year_start=sel, year_end=(sel + 9)) if sel is not None else _pdf_bulk_lookups(db)
    img_map = bulk["img_map"]
    champ_map = bulk["champ_map"]
    match_cpos = bulk["match_cpos"]
    wins_by_dy = bulk["wins_by_dy"]
    seasons_by_driver = bulk["seasons_by_driver"]
    out = []
    for r in ratings:
        name = r.get("driver", "")
        img = img_map.get(name) or srv._fetch_driver_image_if_missing(db, name)
        cars: list[dict] = []
        for s in seasons_by_driver.get(name, []):
            y = s.get("year")
            team_name = s.get("team") or ""
            cpos = match_cpos(y, team_name)
            cars.append({
                "name": team_name,
                "colors": srv.get_team_colors(team_name),
                "year": y,
                "position": s.get("position"),
                "points": s.get("points"),
                "wins": wins_by_dy.get((name, int(y)), 0) if y is not None else 0,
                "cw": cpos == 1,
                "cpos": cpos,
            })
        team_for_avatar = (cars[-1]["name"] if cars else r.get("team", "")) or ""
        avatar = db.resolve_avatar(name, srv.get_team_colors(team_for_avatar))
        out.append({
            **r,
            "avatar_suit": avatar.get("suit", "#888888"),
            "avatar_helmet": avatar.get("helmet", "#bbbbbb"),
            "avatar_accent": avatar.get("accent", "#333333"),
            "driver_image": img,
            "cars": cars,
            "champion_years": champ_map.get(name, []),
        })
    pdf_bytes = _render_cards_pdf(out, title=f"Driver Cards {sel}s", size="fold", mode=mode)
    suffix = "-game" if (mode or "").lower() == "game" else ""
    return Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": f"inline; filename=driver-cards-{sel}s{suffix}.pdf"})


# All-time cards (1950–present) using modern re-scoring
@router.get("/cards/alltime.pdf")
async def cards_alltime_pdf(mode: str = Query("collector")):
    db = srv.get_db()
    ratings = db.driver_alltime_ratings()
    bulk = _pdf_bulk_lookups(db)
    img_map = bulk["img_map"]
    champ_map = bulk["champ_map"]
    match_cpos = bulk["match_cpos"]
    wins_by_dy = bulk["wins_by_dy"]
    seasons_by_driver = bulk["seasons_by_driver"]
    out = []
    for r in ratings:
        name = r.get("driver", "")
        img = img_map.get(name) or srv._fetch_driver_image_if_missing(db, name)
        cars: list[dict] = []
        for s in seasons_by_driver.get(name, []):
            y = s.get("year")
            team_name = s.get("team") or ""
            cars.append({
                "name": team_name,
                "colors": srv.get_team_colors(team_name),
                "year": y,
                "position": s.get("position"),
                "points": s.get("points"),
                "wins": wins_by_dy.get((name, int(y)), 0) if y is not None else 0,
                "cpos": match_cpos(y, team_name),
            })
        team_for_avatar = (cars[-1]["name"] if cars else r.get("team", "")) or ""
        avatar = db.resolve_avatar(name, srv.get_team_colors(team_for_avatar))
        out.append({
            **r,
            "avatar_suit": avatar.get("suit", "#888888"),
            "avatar_helmet": avatar.get("helmet", "#bbbbbb"),
            "avatar_accent": avatar.get("accent", "#333333"),
            "driver_image": img,
            "cars": cars,
            "champion_years": champ_map.get(name, []),
            "legend_points": "All-time points: races re-scored with the modern 2025 scheme. Where per-race classifications are missing, a proportional season fallback is used (champion ≈ races×25).",
        })
    pdf_bytes = _render_cards_pdf(out, title="Driver Cards • All-Time", size="fold", mode=mode)
    suffix = "-game" if (mode or "").lower() == "game" else ""
    return Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": f"inline; filename=driver-cards-alltime{suffix}.pdf"})



@router.get("/cards/tracks.pdf")
async def cards_tracks_pdf():
    pdf_bytes = _render_tracks_pdf()
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=f1-track-weather-deck.pdf"},
    )



@router.get("/cards/{year}.pdf")
async def cards_pdf_path(year: int, mode: str = Query("collector")):
    return await cards_pdf(year=year, mode=mode)

@router.get("/cards/decade/{decade}.pdf")
async def cards_decade_pdf_path(decade: int, mode: str = Query("collector")):
    return await cards_decade_pdf(decade=decade, mode=mode)


