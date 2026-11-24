from __future__ import annotations

from contextlib import asynccontextmanager
from contextvars import ContextVar
from pathlib import Path
import re
from typing import Optional

from fastapi import FastAPI, Request, Query, Form, UploadFile, File, HTTPException
import logging
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, RedirectResponse, Response, JSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles

from .db import Database

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DB = BASE_DIR / "data" / "f1.sqlite"
DRIVER_IMAGES_DIR = BASE_DIR / "data" / "driver_images"
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
TEAM_COLORS_PATHS = [BASE_DIR / "data" / "team_colors.json", STATIC_DIR / "team_colors.json"]
CURRENT_SEASON = 2026  # Always show in season dropdowns even before data is scraped
_ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".avif"}
_MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_INITIALIZED_DB_PATHS: set[str] = set()
_REQUEST_DBS: ContextVar[dict[str, Database] | None] = ContextVar("traf1_request_dbs", default=None)

def _seasons_with_current(seasons: list) -> list:
    """Ensure CURRENT_SEASON is in the seasons list for UI dropdowns."""
    if not seasons or CURRENT_SEASON in seasons:
        return seasons
    return sorted(seasons + [CURRENT_SEASON])


def _ensure_db_initialized(db_path: Path) -> None:
    key = str(Path(db_path).resolve())
    if key not in _INITIALIZED_DB_PATHS:
        with Database(key, init_schema=True):
            pass
        _INITIALIZED_DB_PATHS.add(key)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    _ensure_db_initialized(Path(DATA_DB))
    yield


app = FastAPI(title="Local F1 Data", lifespan=_lifespan)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
# Only expose public flag assets under /data/flags (never mount root data/ with SQLite DBs)
_FLAGS_DIR = BASE_DIR / "data" / "flags"
if _FLAGS_DIR.exists():
    app.mount("/data/flags", StaticFiles(directory=str(_FLAGS_DIR)), name="data_flags")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
ASSET_VERSION = "20261124l"
templates.env.globals["asset_v"] = ASSET_VERSION


@app.middleware("http")
async def _db_session_middleware(request: Request, call_next):
    bucket: dict[str, Database] = {}
    token = _REQUEST_DBS.set(bucket)
    try:
        response = await call_next(request)
        p = request.url.path
        if p.startswith("/static/js/") or p.startswith("/static/css/"):
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response
    finally:
        _REQUEST_DBS.reset(token)
        for conn in bucket.values():
            conn.close()


@app.get("/data/driver_images/{filename:path}")
def serve_driver_image(filename: str):
    """Safely serve cached/uploaded driver portraits without exposing SQLite DBs in data/."""
    base = Path(DRIVER_IMAGES_DIR).resolve()
    target = (base / filename).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        raise HTTPException(status_code=404, detail="Image not found")
    if target.suffix.lower() not in _ALLOWED_IMAGE_EXTS or not target.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(str(target), headers={"Cache-Control": "public, max-age=86400"})


# Basic logger for troubleshooting color saves/lookups
LOGGER = logging.getLogger("f1data.colors")
if not LOGGER.handlers:
    _h = logging.StreamHandler()
    _f = logging.Formatter("[%(asctime)s] %(levelname)s %(message)s")
    _h.setFormatter(_f)
    LOGGER.addHandler(_h)
LOGGER.setLevel(logging.INFO)


def get_db() -> Database:
    p_resolved = str(Path(DATA_DB).resolve())
    _ensure_db_initialized(Path(p_resolved))
    bucket = _REQUEST_DBS.get()
    if bucket is not None:
        existing = bucket.get(p_resolved)
        if existing is not None:
            return existing
        db = Database(p_resolved, init_schema=False)
        bucket[p_resolved] = db
        return db
    return Database(p_resolved, init_schema=False)

# ---------------- Team Colors ----------------
def _load_team_colors() -> dict:
    import json
    default = {
        "Ferrari": {"primary": "#DC0000", "secondary": "#FFFFFF", "accent": "#000000"},
        "Red Bull Racing": {"primary": "#1E41FF", "secondary": "#DC0000", "accent": "#FFC300"},
        "Red Bull Racing Honda RBPT": {"primary": "#1E41FF", "secondary": "#DC0000", "accent": "#FFC300"},
        "Mercedes": {"primary": "#00D2BE", "secondary": "#000000", "accent": "#FFFFFF"},
        "McLaren": {"primary": "#FF8000", "secondary": "#000000", "accent": "#FFFFFF"},
        "McLaren Mercedes": {"primary": "#FF8000", "secondary": "#000000", "accent": "#FFFFFF"},
        "Aston Martin": {"primary": "#006F62", "secondary": "#FFFFFF", "accent": "#F5D000"},
        "Alpine": {"primary": "#0090FF", "secondary": "#FF2A6D", "accent": "#FFFFFF"},
        "Williams": {"primary": "#00A0DE", "secondary": "#00294F", "accent": "#FFFFFF"},
        "Ferrari Marlboro": {"primary": "#DC0000", "secondary": "#FFFFFF", "accent": "#000000"},
    }
    for p in TEAM_COLORS_PATHS:
        try:
            if p.exists():
                payload = json.loads(p.read_text(encoding="utf-8"))
                # Accept array or dict
                if isinstance(payload, list):
                    out = {}
                    for item in payload:
                        name = item.get("team") or item.get("name")
                        if not name:
                            continue
                        out[name] = {
                            "primary": item.get("primary", "#777777"),
                            "secondary": item.get("secondary", "#CCCCCC"),
                            "accent": item.get("accent", "#111111"),
                        }
                    return out or default
                elif isinstance(payload, dict):
                    return payload or default
        except Exception:
            pass
    return default

TEAM_COLORS = _load_team_colors()

# Cached SVG template for F1 car (same asset as web partial); loaded on first PDF car draw.


def _norm_team_name_key(name: str) -> str:
    import re as _re
    n = (name or "").lower()
    n = _re.sub(r"[^a-z0-9]+", " ", n).strip()
    n = _re.sub(r"\s+", " ", n)
    return n

def _simplify_team_alias_key(name: str) -> str:
    # Remove common engine/sponsor suffix tokens for alias matching
    tokens_to_drop = {
        "mercedes","honda","renault","ferrari","rbpt","tag","tag heuer","bmw","cosworth",
        "mecachrome","ilmor","matra","brm","climax","judd","yamaha","alfaromeo","alfa","dfv",
        "aramco","marlboro","rb","rbpt","rbpt"
    }
    norm = _norm_team_name_key(name)
    parts = [p for p in norm.split(" ") if p]
    kept: list[str] = []
    for p in parts:
        if p in tokens_to_drop:
            continue
        kept.append(p)
    return " ".join(kept).strip()

def _slugify_name(name: str) -> str:
    import re as _re
    s = (name or "").lower()
    s = _re.sub(r"[^a-z0-9]+", "-", s)
    s = _re.sub(r"-+", "-", s).strip('-')
    return s

# Try to fetch and cache a driver's face portrait from Wikipedia if missing
def _fetch_driver_image_if_missing(db, driver_name: str) -> str | None:
    import urllib.parse
    import requests
    import re as _re
    try:
        existing = db.get_driver_image(driver_name)
        if existing:
            return existing
        base_name = _re.sub(r"\s+[A-Z]{3}$", "", (driver_name or "").strip()).strip()
        surname = base_name.split()[-1].lower() if base_name else ""
        bad_tokens = (
            "formula_one_drivers_by_country", "world_map", "blankmap", "flag_of_",
            ".svg", "coat_of_arms", "logo", "icon", "silhouette", "helmet", "circuit",
        )
        session = requests.Session()
        session.headers.update({"User-Agent": "LocalF1/2.0 (+local; image-prefetch)"})

        title = None
        for q in (f'"{base_name}" Formula One driver', f'"{base_name}" racing driver', base_name):
            r = session.get(
                "https://en.wikipedia.org/w/api.php",
                params={"action": "query", "list": "search", "srsearch": q, "format": "json", "srlimit": 5},
                timeout=8,
            )
            if r.status_code != 200:
                continue
            for hit in ((r.json() or {}).get("query", {}).get("search", [])):
                t = hit.get("title") or ""
                if t.lower().startswith("list of ") or "grand prix" in t.lower():
                    continue
                if surname and surname not in t.lower():
                    continue
                title = t
                break
            if title:
                break
        if not title:
            return None

        thumb_url = None
        rq = session.get(
            "https://en.wikipedia.org/w/api.php",
            params={"action": "query", "prop": "pageimages", "pithumbsize": 640, "format": "json", "titles": title},
            timeout=8,
        )
        if rq.status_code == 200:
            for page in ((rq.json() or {}).get("query", {}).get("pages", {})).values():
                src = ((page or {}).get("thumbnail") or {}).get("source")
                if src and not any(tok in src.lower() for tok in bad_tokens):
                    thumb_url = src
                    break
        if not thumb_url:
            return None
        r3 = session.get(thumb_url, timeout=12)
        if r3.status_code != 200 or not r3.content or len(r3.content) < 2500:
            return None
        ext = ".jpg"
        ct = r3.headers.get("Content-Type", "").lower()
        lower = thumb_url.lower()
        if lower.endswith(".png") or "png" in ct:
            ext = ".png"
        elif lower.endswith(".webp") or "webp" in ct:
            ext = ".webp"
        safe = driver_name.replace(" ", "-")
        fname = f"{safe}{ext}"
        out_path = BASE_DIR / "data" / "driver_images" / fname
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(r3.content)
        stored = f"data/driver_images/{fname}"
        db.upsert_driver_image(driver_name, stored)
        return stored
    except Exception:
        return None



_CAR_PALETTES_BY_SLUG_CACHE: dict[str, dict] | None = None
_TEAM_COLORS_CACHE_SIG: tuple[int, int] | None = None
_TEAM_COLORS_NORM_LOOKUP: dict[str, dict] = {}
_TEAM_COLORS_ALIAS_LOOKUP: dict[str, dict] = {}


def _invalidate_team_colors_cache() -> None:
    global _TEAM_COLORS_CACHE_SIG
    _TEAM_COLORS_CACHE_SIG = None


def _ensure_team_colors_indexes() -> tuple[dict[str, dict], dict[str, dict]]:
    global _TEAM_COLORS_CACHE_SIG, _TEAM_COLORS_NORM_LOOKUP, _TEAM_COLORS_ALIAS_LOOKUP
    sig = (id(TEAM_COLORS), len(TEAM_COLORS))
    if _TEAM_COLORS_CACHE_SIG != sig:
        norm_l: dict[str, dict] = {}
        alias_l: dict[str, dict] = {}
        for k, v in TEAM_COLORS.items():
            nk = _norm_team_name_key(k)
            if nk and nk not in norm_l:
                norm_l[nk] = v
            ak = _simplify_team_alias_key(k)
            if ak and ak not in alias_l:
                alias_l[ak] = v
        _TEAM_COLORS_NORM_LOOKUP = norm_l
        _TEAM_COLORS_ALIAS_LOOKUP = alias_l
        _TEAM_COLORS_CACHE_SIG = sig
    return _TEAM_COLORS_NORM_LOOKUP, _TEAM_COLORS_ALIAS_LOOKUP


def get_team_colors(team_name: str) -> dict:
    global _CAR_PALETTES_BY_SLUG_CACHE

    def _is_placeholder(c: dict | None) -> bool:
        if not c:
            return True
        return (str(c.get("primary") or "").lower() == "#777777" and str(c.get("secondary") or "").lower() == "#dddddd")

    matched = None
    if team_name in TEAM_COLORS:
        LOGGER.debug("get_team_colors: exact match for '%s'", team_name)
        matched = TEAM_COLORS[team_name]
    norm_key = _norm_team_name_key(team_name)
    norm_lookup, alias_lookup = _ensure_team_colors_indexes()
    if matched is None and norm_key in norm_lookup:
        LOGGER.debug("get_team_colors: normalized exact match for '%s' -> '%s'", team_name, norm_key)
        matched = norm_lookup[norm_key]
    ak_req = _simplify_team_alias_key(team_name)
    if matched is None and ak_req in alias_lookup:
        LOGGER.debug("get_team_colors: alias match for '%s' -> '%s'", team_name, ak_req)
        matched = alias_lookup[ak_req]
    if matched is not None and not _is_placeholder(matched):
        return matched
    # Fallback to our 200+ studio car livery palettes (cached by slug)
    try:
        from .f1_car_palettes import find_slug as _fc_find, load_palettes as _fc_load, slugify as _fc_slug
        if _CAR_PALETTES_BY_SLUG_CACHE is None:
            _CAR_PALETTES_BY_SLUG_CACHE = {_fc_slug(pn): pal for pn, pal in _fc_load().items()}
        slug = _fc_find(team_name)
        if slug and slug in _CAR_PALETTES_BY_SLUG_CACHE:
            pal = _CAR_PALETTES_BY_SLUG_CACHE[slug]
            return {
                "primary": pal.get("main", "#e10600"),
                "secondary": pal.get("secondary", "#161b26"),
                "accent": pal.get("accent", "#facc15"),
            }
    except Exception:
        pass
    # Classic 1950s/60s historic constructor racing colors (FIA national racing liveries)
    _CLASSIC_NATIONAL = {
        "lancia": {"primary": "#c01c28", "secondary": "#f5f0e6", "accent": "#facc15"},
        "gordini": {"primary": "#0055a4", "secondary": "#ffffff", "accent": "#ef4444"},
        "simca gordini": {"primary": "#0055a4", "secondary": "#ffffff", "accent": "#ef4444"},
        "talbot lago": {"primary": "#1d4ed8", "secondary": "#f8fafc", "accent": "#dc2626"},
        "osca": {"primary": "#b91c1c", "secondary": "#f8fafc", "accent": "#facc15"},
        "connaught": {"primary": "#006b3c", "secondary": "#f8fafc", "accent": "#facc15"},
        "hwm": {"primary": "#006b3c", "secondary": "#e5e7eb", "accent": "#facc15"},
        "frazer nash": {"primary": "#006b3c", "secondary": "#f8fafc", "accent": "#d4af37"},
        "alta": {"primary": "#006b3c", "secondary": "#f8fafc", "accent": "#d4af37"},
        "veritas": {"primary": "#cbd5e1", "secondary": "#1e293b", "accent": "#dc2626"},
        "kurtis kraft": {"primary": "#1e3a8a", "secondary": "#f8fafc", "accent": "#ef4444"},
        "epperly": {"primary": "#1e3a8a", "secondary": "#f8fafc", "accent": "#facc15"},
    }
    if norm_key in _CLASSIC_NATIONAL:
        return _CLASSIC_NATIONAL[norm_key]
    if ak_req in _CLASSIC_NATIONAL:
        return _CLASSIC_NATIONAL[ak_req]
    LOGGER.debug("get_team_colors: no match for '%s', returning default", team_name)
    return {"primary": "#777777", "secondary": "#DDDDDD", "accent": "#111111"}

# make team color helper available to templates
app.state.get_team_colors = get_team_colors



_slug_cache: dict[str, str] = {}
_team_years_cache: dict[str, int] | None = None

def _team_peak_years_map(db=None) -> dict[str, int]:
    """Return {team_name: signature_year} from SQLite so every constructor maps to its authentic era.

    Active 2020s constructors use their latest year (2020s), while historical teams use their
    dominant decade (most seasons/points) so iconic combinations like Williams Renault (1989-97)
    or Lotus Ford (1967-82) aren't skewed by brief 1-2 year reunions.
    """
    global _team_years_cache
    if _team_years_cache is not None:
        return _team_years_cache
    if db is None:
        db = get_db()
    by_team: dict[str, list[tuple[int, float]]] = {}
    for tbl in ("team_standings", "drivers_standings"):
        try:
            for r in db._conn.execute(
                f"SELECT team, year, COALESCE(points, 0) AS pts FROM {tbl} WHERE team IS NOT NULL AND team != ''"
            ).fetchall():
                by_team.setdefault(r["team"], []).append((int(r["year"]), float(r["pts"] or 0.0)))
        except Exception:
            pass
    out: dict[str, int] = {}
    for tname, rows in by_team.items():
        max_yr = max(y for y, _ in rows)
        if max_yr >= 2020:
            out[tname] = max_yr
        else:
            dec_score: dict[int, float] = {}
            for y, pts in rows:
                d = (y // 10) * 10
                dec_score[d] = dec_score.get(d, 0.0) + 1.0 + (pts / 40.0)
            best_dec = max(dec_score.items(), key=lambda kv: (kv[1], kv[0]))[0]
            out[tname] = best_dec + 5
    _team_years_cache = out
    return out


def _find_slug_cached(team: str) -> str | None:
    if team not in _slug_cache:
        from .f1_car_palettes import find_slug
        _slug_cache[team] = find_slug(team) or ""
    return _slug_cache[team] or None



def _career_base_dir() -> Path:
    return BASE_DIR


# Mount modular APIRouters (keeping f1data.server:app as single ASGI entrypoint)
from .routers import archive as _r_archive, cards as _r_cards, career as _r_career, dev as _r_dev, f1db as _r_f1db, game as _r_game, ladder as _r_ladder
app.include_router(_r_archive.router)
app.include_router(_r_cards.router)
app.include_router(_r_game.router)
app.include_router(_r_career.router)
app.include_router(_r_dev.router)
app.include_router(_r_f1db.router)
app.include_router(_r_ladder.router)
