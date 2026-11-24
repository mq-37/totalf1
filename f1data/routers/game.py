from __future__ import annotations

from pathlib import Path
import re
from typing import Optional

from fastapi import APIRouter, Request, Query, Form, UploadFile, File, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse, Response, JSONResponse

from .. import server as srv
from ..db import Database

router = APIRouter()

@router.get("/play", response_class=HTMLResponse)
async def play_page(request: Request):
    db = srv.get_db()
    seasons = [r["year"] for r in db._conn.execute("SELECT year FROM seasons ORDER BY year DESC").fetchall()]
    decades = sorted({(y // 10) * 10 for y in seasons}, reverse=True)
    from ..circuits import CIRCUITS
    from ..game import BATTLE_STATS, TRACK_DECK
    return srv.templates.TemplateResponse(
        "play.html",
        {
            "request": request,
            "seasons": seasons,
            "decades": decades,
            "latest_year": seasons[0] if seasons else srv.CURRENT_SEASON,
            "tracks": TRACK_DECK,
            "battle_stats": BATTLE_STATS,
            "circuits": CIRCUITS,
        },
    )


@router.get("/api/game/tracks")
def api_game_tracks():
    from ..game import BATTLE_STATS, TRACK_DECK
    return {"tracks": TRACK_DECK, "battle_stats": BATTLE_STATS}


@router.get("/api/game/circuits")
def api_game_circuits():
    from ..circuits import CIRCUITS
    return {"count": len(CIRCUITS), "circuits": CIRCUITS}


@router.get("/api/game/circuits-meta")
def api_game_circuits_meta():
    from ..circuits import CIRCUITS_META
    return {"count": len(CIRCUITS_META), "circuits": CIRCUITS_META}


@router.get("/api/game/circuits/{circuit_id}")
def api_game_circuit_detail(circuit_id: str):
    from ..circuits import get_circuit
    c = get_circuit(circuit_id)
    if not c:
        raise HTTPException(status_code=404, detail=f"Circuit '{circuit_id}' not found")
    return c


@router.get("/api/sim/eras")
def api_sim_eras():
    from ..era_rules import list_era_rules
    return {"eras": list_era_rules()}


@router.get("/api/sim/balance")
def api_sim_balance(
    circuit_id: str = Query("melbourne"),
    era: str = Query("2026"),
    era_key: Optional[str] = Query(None),
    drivers: str = Query(""),
):
    """Return historical Track x Era x Team x Driver affinity & psychology bundle from f1.sqlite."""
    from ..performance_balance import get_track_balance_bundle
    drv_list: list[dict] = []
    if drivers.strip():
        for item in drivers.split("|"):
            parts = item.split("::")
            dname = parts[0].strip()
            tname = parts[1].strip() if len(parts) > 1 else ""
            if dname:
                drv_list.append({"driver": dname, "team": tname})
    return get_track_balance_bundle(srv.DATA_DB, circuit_id, era_key or era, drv_list or None)


@router.get("/api/sim/driver-dna")
def api_sim_driver_dna(drivers: str = Query("")):
    """Return data-deduced + curated iconic F1 Driver DNA profiles (1950-2026)."""
    from ..driver_dna import get_driver_dna_map
    names = [s.strip() for s in drivers.split("|") if s.strip()] if drivers.strip() else None
    dna = get_driver_dna_map(srv.DATA_DB, names)
    return {"ok": True, "count": len(dna), "driver_dna": dna}


@router.get("/api/dialogue/voice-pack")
def api_dialogue_voice_pack():
    """Return FIA-transcript-grounded driver speech signatures, F1 radio tropes & banter modes."""
    from ..paddock_dialogue import get_voice_pack_payload
    return {"ok": True, **get_voice_pack_payload()}


@router.get("/api/tts/status")
def api_tts_status():
    """Return live status of the Hybrid Gemini TTS + Neural Edge-TTS broadcast voice engine."""
    from ..voice_engine import get_voice_status
    return get_voice_status()


@router.post("/api/tts/speak")
async def api_tts_speak(request: Request):
    """Synthesize natural neural F1 commentary or cockpit team radio audio (Gemini TTS -> Edge-TTS fallback)."""
    from ..voice_engine import synthesize_speech
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    text = str(body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Missing text")
    try:
        res = synthesize_speech(
            text=text,
            role=str(body.get("role") or "crofty"),
            archetype=str(body.get("archetype") or ""),
            driver_name=str(body.get("driver_name") or ""),
            tone=str(body.get("tone") or ""),
            engine=str(body.get("engine") or "auto"),
            reply_text=str(body.get("reply_text") or ""),
            engineer_name=str(body.get("engineer_name") or ""),
            nationality=str(body.get("nationality") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    return Response(
        content=res["audio"],
        media_type=res["mime"],
        headers={
            "X-TTS-Engine": res["engine"],
            "X-TTS-Voice": res["voice"],
            "X-TTS-Accent": res.get("accent", "British"),
            "X-TTS-Cached": "1" if res["cached"] else "0",
            "Cache-Control": "public, max-age=3600",
        },
    )


@router.post("/api/sim/interviews")
async def api_sim_interviews(request: Request):
    """Generate context-aware post-race driver reports & press-pen interviews ONLY after the Chequered Flag."""
    from ..interviews import generate_race_interviews
    body = await request.json()
    telem = body.get("telemetry") if isinstance(body, dict) else None
    if not isinstance(telem, dict):
        raise HTTPException(status_code=400, detail="Missing telemetry payload")
    if telem.get("raceFinished") is False:
        return {
            "ok": True,
            "locked": True,
            "interviews": [],
            "message": "Post-race Media Pen interviews unlock only after the Chequered Flag falls. View live Driver Radio & Component Diagnostics while racing.",
        }
    return {"ok": True, "locked": False, "interviews": generate_race_interviews(telem)}


@router.get("/api/feeders/overview")
def api_feeders_overview():
    """Public browseable FIA Feeder Series (F2, F3, F1 Academy, W Series Legacy) & Super Licence catalog."""
    from ..feeders import build_initial_feeders
    return {"ok": True, **build_initial_feeders()}


@router.get("/api/custom-seasons/presets")
def api_custom_season_presets():
    from ..custom_season import builder_presets
    return builder_presets()


@router.get("/api/custom-seasons")
def api_custom_seasons_list():
    from ..custom_season import list_seasons
    return {"ok": True, "seasons": list_seasons(srv._career_base_dir())}


@router.post("/api/custom-seasons")
async def api_custom_seasons_save(request: Request):
    from ..custom_season import save_season
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Invalid custom season payload")
    saved = save_season(srv._career_base_dir(), body, season_id=body.get("season_id"))
    return {"ok": True, **saved}


@router.get("/api/custom-seasons/{season_id}")
def api_custom_season_get(season_id: str):
    from ..custom_season import get_season
    s = get_season(srv._career_base_dir(), season_id)
    if not s:
        raise HTTPException(status_code=404, detail="Custom season not found")
    return {"ok": True, "season": s}


@router.delete("/api/custom-seasons/{season_id}")
def api_custom_season_delete(season_id: str):
    from ..custom_season import delete_season
    ok = delete_season(srv._career_base_dir(), season_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Custom season not found")
    return {"ok": True}


@router.get("/sim", response_class=HTMLResponse)
async def full_sim_page(request: Request):
    db = srv.get_db()
    seasons = [r["year"] for r in db._conn.execute("SELECT year FROM seasons ORDER BY year DESC").fetchall()]
    decades = sorted({(y // 10) * 10 for y in seasons}, reverse=True)
    from ..circuits import CIRCUITS
    from ..era_rules import list_era_rules
    return srv.templates.TemplateResponse(
        "full_sim.html",
        {
            "request": request,
            "seasons": seasons,
            "decades": decades,
            "latest_year": seasons[0] if seasons else srv.CURRENT_SEASON,
            "circuits": CIRCUITS,
            "default_circuit": CIRCUITS[0] if CIRCUITS else None,
            "era_rules": list_era_rules(),
        },
    )



@router.get("/api/game/deck")
def api_game_deck(
    source: str = Query("season"),
    year: Optional[int] = Query(None),
    decade: Optional[int] = Query(None),
    limit: int = Query(0),
):
    from ..f1_car_palettes import (
        find_car_png_slug as _find_car_png_slug,
        find_slug as _find_car_slug,
        infer_livery_style as _infer_livery_style,
        infer_team_era as _infer_team_era,
        load_palettes as _load_car_palettes,
        slugify as _car_slugify,
    )
    from ..game import clean_driver_name as _clean_drv, compute_game_profile

    _car_palettes_by_slug = {_car_slugify(k): v for k, v in _load_car_palettes().items()}

    db = srv.get_db()
    _team_years_map = srv._team_peak_years_map(db)
    src = (source or "season").strip().lower()
    seasons_all = [r["year"] for r in db._conn.execute("SELECT year FROM seasons ORDER BY year").fetchall()]
    latest = seasons_all[-1] if seasons_all else srv.CURRENT_SEASON

    if src == "alltime":
        ratings = db.driver_alltime_ratings()
        deck_title = "All-Time Legends (1950–Present)"
    elif src == "decade":
        sel_dec = decade if decade is not None else ((latest // 10) * 10)
        ratings = db.driver_decade_ratings(sel_dec)
        deck_title = f"The {sel_dec}s Decade"
    else:
        sel_yr = year if year is not None else latest
        ratings = db.driver_season_ratings(sel_yr)
        deck_title = f"{sel_yr} Season Grid"

    # Pre-fetch career team histories and championship years in bulk for speed
    champ_map: dict[str, list[int]] = {}
    for rr in db._conn.execute("SELECT driver, year FROM drivers_standings WHERE position=1 ORDER BY year").fetchall():
        champ_map.setdefault(rr["driver"], []).append(int(rr["year"]))

    team_hist_map: dict[str, list[dict]] = {}
    if src == "decade":
        sel_dec = decade if decade is not None else ((latest // 10) * 10)
        q_hist = db._conn.execute(
            "SELECT driver, year, position, team, points FROM drivers_standings WHERE year BETWEEN ? AND ? ORDER BY year",
            (sel_dec, sel_dec + 9),
        ).fetchall()
    elif src == "season":
        sel_yr = year if year is not None else latest
        q_hist = db._conn.execute(
            "SELECT driver, year, position, team, points FROM drivers_standings WHERE year=? ORDER BY year",
            (sel_yr,),
        ).fetchall()
    else:
        q_hist = db._conn.execute(
            "SELECT driver, year, position, team, points FROM drivers_standings ORDER BY year"
        ).fetchall()
    for rr in q_hist:
        team_hist_map.setdefault(rr["driver"], []).append(dict(rr))

    img_map = {
        rr["driver"]: rr["image_path"]
        for rr in db._conn.execute("SELECT driver, image_path FROM driver_images").fetchall()
    }

    if limit > 0:
        ratings = ratings[:limit]

    deck: list[dict] = []
    for r in ratings:
        name = r.get("driver", "")
        clean_name, code3 = _clean_drv(name)
        hist = team_hist_map.get(name) or []
        cars = []
        spine_colors: list[str] = []
        unique_teams: list[str] = []
        for s in hist:
            tname = s.get("team") or ""
            cols = srv.get_team_colors(tname) if tname else {"primary": "#475569", "secondary": "#cbd5e1", "accent": "#111111"}
            pcol = cols.get("primary") or "#475569"
            if not spine_colors or spine_colors[-1].lower() != pcol.lower():
                spine_colors.append(pcol)
            if tname and tname not in unique_teams:
                unique_teams.append(tname)
            cars.append({
                "name": tname,
                "year": s.get("year"),
                "position": s.get("position"),
                "points": s.get("points"),
                "color": pcol,
                "car_slug": _find_car_png_slug(tname, year=s.get("year")) if tname else None,
                "base_slug": _find_car_slug(tname) if tname else None,
            })
        # Pick signature hero team (best finish / latest)
        hero = max(
            cars,
            key=lambda cc: (
                1 if cc.get("position") == 1 else 0,
                -(int(cc.get("position") or 99)),
                int(cc.get("year") or 0),
            ),
        ) if cars else {"name": r.get("team", ""), "color": "#475569", "car_slug": _find_car_png_slug(r.get("team", "")) if r.get("team") else None, "base_slug": _find_car_slug(r.get("team", "")) if r.get("team") else None}

        champ_years = champ_map.get(name, [])
        card_ctx = {**r, "champion_years": champ_years, "cars": cars}
        gprof = compute_game_profile(card_ctx)

        hero_slug = hero.get("car_slug")
        hero_base_slug = hero.get("base_slug") or _find_car_slug(hero.get("name") or "")
        hero_pal = _car_palettes_by_slug.get(hero_base_slug) if hero_base_slug else None
        if not hero_pal:
            hcol = hero.get("color") or "#475569"
            hero_pal = {"main": hcol, "secondary": "#1e293b", "accent": "#e10600", "pop": "#ffffff", "detail": "#0f172a"}

        deck.append({
            "driver": name,
            "clean_name": clean_name,
            "code3": code3,
            "nationality": (r.get("nationality") or "").upper(),
            "rank": r.get("rank"),
            "overall": round(float(r.get("overall") or 0), 1),
            "legacy_overall": round(float(r.get("legacy_overall") or r.get("overall") or 0), 1),
            "points": round(float(r.get("points") or 0), 1),
            "total_points": round(float(r.get("total_points") or r.get("points") or 0), 1),
            "wins": int(r.get("wins") or 0),
            "podiums": int(r.get("podiums") or 0),
            "fastest_laps": int(r.get("fastest_laps") or 0),
            "starts": int(r.get("starts") or 0),
            "dnfs": int(r.get("dnfs") or 0),
            "win_rate": round(float(r.get("win_rate") or 0), 1),
            "fl_rate": round(float(r.get("fl_rate") or 0), 1),
            "podium_rate": round(float(r.get("podium_rate") or 0), 1),
            "top10_rate": round(float(r.get("top10_rate") or 0), 1),
            "seasons": int(r.get("seasons") or len(hist) or 1),
            "years_active": r.get("years_active") or "—",
            "championships": len(champ_years),
            "champion_years": champ_years,
            "badges": r.get("badges") or [],
            "driver_image": img_map.get(name),
            "hero_team": hero.get("name") or "",
            "hero_car_slug": hero_slug,
            "hero_palette": hero_pal,
            "hero_livery_style": _infer_livery_style(hero.get("name") or ""),
            "hero_era": _infer_team_era(hero.get("name") or "", year=hero.get("year"), team_years_map=_team_years_map),
            "hero_color": hero.get("color") or "#475569",
            "spine_colors": spine_colors or ["#475569"],
            "unique_teams": unique_teams,
            "cars": cars,
            "game": gprof,
        })

    return {"source": src, "title": deck_title, "count": len(deck), "cards": deck}


