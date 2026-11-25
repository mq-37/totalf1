from __future__ import annotations

from pathlib import Path
import re
from typing import Optional

from fastapi import APIRouter, Request, Query, Form, UploadFile, File, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse, Response, JSONResponse

from .. import server as srv
from ..db import Database

router = APIRouter()

_car_gen_mod = None
_car_layers = None

@router.get("/dev/car-composition", response_class=HTMLResponse)
async def car_composition_page(request: Request):
    """Side-by-side grid overlay: real F1 reference vs live front-view SVG."""
    return srv.render_template(request, "car_composition.html", {})

@router.get("/dev/car-composition-v2", response_class=HTMLResponse)
async def car_composition_v2_page(request: Request):
    """Photo-based front silhouette v2 vs photo + unchanged v1."""
    return srv.render_template(request, "car_composition_v2.html", {})


@router.get("/dev/car-liveries", response_class=HTMLResponse)
async def car_liveries_page(request: Request):
    """3D studio car renders, one 5-colour livery per team."""
    import re as _re
    from ..f1_car_palettes import load_palettes, infer_team_era, find_car_png_slug
    from ..livery_registry import resolve_team_livery

    def slugify(name: str) -> str:
        return _re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

    year_map = srv._team_peak_years_map(srv.get_db())
    teams = []
    for name in load_palettes():
        peak_yr = year_map.get(name)
        era = infer_team_era(name, team_years_map=year_map)
        yr = int(peak_yr) if peak_yr else (int(era[:4]) + 5 if era[:4].isdigit() else 2026)
        spec = resolve_team_livery(name, yr)
        teams.append({
            "name": name,
            "slug": find_car_png_slug(name, year=yr) or slugify(name),
            "palette": spec["palette"],
            "style": spec["style"],
            "era": era,
        })
    return srv.render_template(request, "car_liveries.html", { "teams": teams})


@router.get("/dev/car-3d", response_class=HTMLResponse)
async def car_3d_studio_page(request: Request, team: Optional[str] = None, era: Optional[str] = None):
    """Interactive 3D F1 car livery studio."""
    from ..f1_car_palettes import load_palettes, slugify, infer_team_era, LIVERY_STYLES, CAR_ERAS
    from ..livery_registry import resolve_team_livery
    palettes = load_palettes()
    year_map = srv._team_peak_years_map(srv.get_db())
    team_list = []
    for name in palettes:
        peak_yr = year_map.get(name)
        t_era = infer_team_era(name, team_years_map=year_map)
        yr = int(peak_yr) if peak_yr else (int(t_era[:4]) + 5 if t_era[:4].isdigit() else 2026)
        spec = resolve_team_livery(name, yr)
        team_list.append({
            "name": name,
            "slug": slugify(name),
            "palette": spec["palette"],
            "style": spec["style"],
            "finish": spec["finish"],
            "era": t_era,
        })
    selected = team if (team and team in palettes) else ("McLaren Mercedes" if "McLaren Mercedes" in palettes else (team_list[0]["name"] if team_list else "Ferrari"))
    selected_era = era if (era and era in CAR_ERAS) else infer_team_era(selected, team_years_map=year_map)
    return srv.render_template(request, "car_3d.html", {
            "teams": team_list,
            "selected_team": selected,
            "selected_era": selected_era,
            "livery_styles": list(LIVERY_STYLES),
            "car_eras": list(CAR_ERAS),
        },
    )


@router.get("/dev/car-render-harness", response_class=HTMLResponse)
async def car_render_harness_page(request: Request):
    """Minimal headless WebGL harness for batch-rendering transparent 3D car PNGs."""
    return srv.render_template(request, "car_render_harness.html", {})



def _voxel_payload(slug: str) -> dict | None:
    """Downsampled voxel grid + palette for one team's livery car (cached)."""
    global _car_gen_mod, _car_layers
    from ..f1_car_palettes import load_palettes, slugify
    palettes = load_palettes()
    pal_name = next((n for n in palettes if slugify(n) == slug), None)
    if not pal_name:
        return None
    if _car_gen_mod is None:
        import sys
        sys.path.insert(0, str(srv.BASE_DIR / "scripts"))
        import f1_car_gen as gen
        _car_gen_mod = gen
        _car_layers = gen.load_layers()
    gen = _car_gen_mod
    colors = gen.team_colors(palettes[pal_name])
    grid, pal = gen._render_grid(_car_layers, colors)
    # downsample 2x for a manageable voxel count
    pts, used, index = [], {}, []
    for y in range(0, gen.ART_H, 2):
        for x in range(0, gen.ART_W, 2):
            pi = grid[y][x]
            if not pi:
                continue
            hexc = pal[pi - 1]
            ci = index.index(hexc) if hexc in index else -1
            if ci == -1:
                index.append(hexc)
                ci = len(index) - 1
            pts.append([x // 2, y // 2, ci])
    return {"w": gen.ART_W // 2, "h": gen.ART_H // 2,
            "pal": index, "pts": pts}


@router.get("/api/cars/livery")
def car_livery_year_api(team: str = Query("Ferrari"), year: int = Query(2026)):
    """Return year-accurate 5-colour palette, signature 3D livery style, paint finish, motif & era."""
    from ..f1_car_palettes import era_for_year, find_slug
    from ..livery_registry import resolve_team_livery
    spec = resolve_team_livery(team, year)
    return JSONResponse({
        "ok": True,
        "team": team,
        "year": spec["year"],
        "era": era_for_year(spec["year"]),
        "slug": find_slug(team) or srv._slugify_name(team),
        "palette": spec["palette"],
        "style": spec["style"],
        "finish": spec["finish"],
        "motif": spec.get("motif", "standard"),
        "label": spec.get("label", f"{spec['year']} {team}"),
    })


@router.get("/api/car/{team}/palette")
def car_palette_api(team: str, year: Optional[int] = Query(None)):
    """Return the year-aware 5-colour livery palette + livery pattern style + paint finish + decade era."""
    from ..f1_car_palettes import find_slug, load_palettes, slugify, infer_livery_style, infer_team_era
    from ..livery_registry import resolve_team_livery
    db = srv.get_db()
    resolved = db.resolve_team_name(team)
    year_map = srv._team_peak_years_map(db)
    era = infer_team_era(resolved, year=year, team_years_map=year_map)
    target_year = year if year is not None else (year_map.get(resolved) or 2026)
    spec = resolve_team_livery(resolved, target_year)
    slug = find_slug(resolved) or find_slug(team.replace("-", " "))
    return JSONResponse({
        "team": resolved,
        "slug": slug or srv._slugify_name(resolved),
        "palette": spec["palette"],
        "style": spec["style"],
        "finish": spec["finish"],
        "motif": spec.get("motif", "standard"),
        "label": spec.get("label", resolved),
        "year": spec["year"],
        "era": era,
    })


@router.get("/api/car/{team}/voxels")
def car_voxels(team: str):
    from ..f1_car_palettes import find_slug
    slug = find_slug(team.replace("-", " "))
    if not slug:
        raise HTTPException(status_code=404, detail="no livery for team")
    payload = _voxel_payload(slug)
    if payload is None:
        raise HTTPException(status_code=404, detail="no livery for team")
    return JSONResponse(payload)


