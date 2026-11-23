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
    return srv.templates.TemplateResponse("car_composition.html", {"request": request})

@router.get("/dev/car-composition-v2", response_class=HTMLResponse)
async def car_composition_v2_page(request: Request):
    """Photo-based front silhouette v2 vs photo + unchanged v1."""
    return srv.templates.TemplateResponse("car_composition_v2.html", {"request": request})


@router.get("/dev/car-liveries", response_class=HTMLResponse)
async def car_liveries_page(request: Request):
    """3D studio car renders, one 5-colour livery per team."""
    import re as _re
    from ..f1_car_palettes import load_palettes, infer_livery_style, infer_team_era

    def slugify(name: str) -> str:
        return _re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

    year_map = srv._team_peak_years_map(srv.get_db())
    teams = [
        {
            "name": name,
            "slug": slugify(name),
            "palette": pal,
            "style": infer_livery_style(name),
            "era": infer_team_era(name, team_years_map=year_map),
        }
        for name, pal in load_palettes().items()
    ]
    return srv.templates.TemplateResponse("car_liveries.html", {"request": request, "teams": teams})


@router.get("/dev/car-3d", response_class=HTMLResponse)
async def car_3d_studio_page(request: Request, team: Optional[str] = None, era: Optional[str] = None):
    """Interactive 3D F1 car livery studio."""
    from ..f1_car_palettes import load_palettes, slugify, infer_livery_style, infer_team_era, LIVERY_STYLES, CAR_ERAS
    palettes = load_palettes()
    year_map = srv._team_peak_years_map(srv.get_db())
    team_list = [
        {
            "name": name,
            "slug": slugify(name),
            "palette": pal,
            "style": infer_livery_style(name),
            "era": infer_team_era(name, team_years_map=year_map),
        }
        for name, pal in palettes.items()
    ]
    selected = team if (team and team in palettes) else ("McLaren Mercedes" if "McLaren Mercedes" in palettes else (team_list[0]["name"] if team_list else "Ferrari"))
    selected_era = era if (era and era in CAR_ERAS) else infer_team_era(selected, team_years_map=year_map)
    return srv.templates.TemplateResponse(
        "car_3d.html",
        {
            "request": request,
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
    return srv.templates.TemplateResponse("car_render_harness.html", {"request": request})



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


@router.get("/api/car/{team}/palette")
def car_palette_api(team: str, year: Optional[int] = Query(None)):
    """Return the 5-colour livery palette + livery pattern style + decade era for a team."""
    from ..f1_car_palettes import find_slug, load_palettes, slugify, infer_livery_style, infer_team_era
    db = srv.get_db()
    resolved = db.resolve_team_name(team)
    palettes = load_palettes()
    slug = find_slug(resolved) or find_slug(team.replace("-", " "))
    pal = None
    matched_name = resolved
    if slug:
        for name, p in palettes.items():
            if slugify(name) == slug:
                pal = p
                matched_name = name
                break
    if pal is None:
        tc = srv.get_team_colors(resolved)
        pal = {
            "main": tc.get("primary", "#5a6472"),
            "secondary": tc.get("secondary", "#161920"),
            "accent": tc.get("accent", "#ffffff"),
            "pop": "#ffffff",
            "detail": "#2b303a",
        }
    year_map = srv._team_peak_years_map(db)
    era = infer_team_era(matched_name, year=year, team_years_map=year_map)
    return JSONResponse({
        "team": matched_name,
        "slug": slug or srv._slugify_name(resolved),
        "palette": pal,
        "style": infer_livery_style(matched_name),
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


