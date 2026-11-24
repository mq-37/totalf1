"""Shared loader for the per-team 5-colour car palettes.

Single source of truth for both the web app and scripts/f1_car_gen.py.
Keys starting with "_" are metadata and skipped.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

PALETTES_PATH = Path(__file__).resolve().parent.parent / "data" / "team_car_palettes.json"
CAR_PNG_DIR = Path(__file__).resolve().parent.parent / "static" / "cars" / "png"

SLOT_ORDER = ("main", "secondary", "accent", "pop", "detail")

LIVERY_STYLES = (
    "modern",
    "two-tone",
    "racing-stripe",
    "chevron",
    "classic",
    "redbull",
    "ferrari_hp",
    "merc_arrow",
    "williams_duracell",
    "audi_slash",
    "cadillac_split",
    "mclaren_papaya",
    "mclaren_marlboro",
    "aston_wings",
    "alpine_bwt",
    "lotus_jps",
    "gulf_heritage",
    "martini_tri",
    "renault_mildseven",
    "brawn_neon",
    "haas_carbon",
    "jordan_hornet",
    "carbon_stealth",
)

CAR_ERAS = ("1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s")


def era_for_year(year: int | str | None) -> str:
    """Convert any F1 season year (1950–2026+) into its canonical 3D car decade era."""
    if year is None:
        return "2020s"
    try:
        y = int(str(year).strip()[:4])
    except Exception:
        return "2020s"
    dec = (max(1950, min(2029, y)) // 10) * 10
    return f"{dec}s"


_ERA_FALLBACK_KEYWORDS: list[tuple[tuple[str, ...], str]] = [
    (("maserati", "vanwall", "connaught", "gordini", "lancia", "talbot", "kurtis", "watson", "epperly", "kuzma", "lesovsky", "hwn", "alfa romeo 158", "frazer"), "1950s"),
    (("cooper", "brm", "eagle", "honda ra", "matra", "porsche", "scirocco", "ats", "emeryson", "scarab"), "1960s"),
    (("tyrrell", "march", "surtees", "shadow", "hesketh", "wolf", "ensign", "fittipaldi", "penske", "brm", "iso", "lec", "parnelli", "hill", "token", "trojan", "makki", "lotus ford", "brabham ford", "mclaren ford"), "1970s"),
    (("toleman", "zakspeed", "osella", "rial", "onyx", "ags", "coloni", "eurobrun", "spirit", "ram", "theodore", "mclaren tag", "mclaren honda", "lotus renault", "lotus honda", "brabham bmw", "williams honda", "benetton bmw"), "1980s"),
    (("benetton", "jordan", "ligier", "prost", "stewart", "larrousse", "footwork", "pacific", "simtek", "forti", "leyton", "dallara", "fondmetal", "modena", "williams renault", "mclaren peugeot"), "1990s"),
    (("brawn", "bmw sauber", "toyota", "bar", "jaguar", "super aguri", "spyker", "midland", "minardi", "arrows", "sauber petronas", "renault"), "2000s"),
    (("force india", "toro rosso", "caterham", "marussia", "manor", "hrt", "virgin", "lotus f1", "racing point", "alfa romeo racing", "scuderia toro rosso"), "2010s"),
    (("audi", "cadillac", "alpine", "racing bulls", "alphatauri", "rb ", "kick sauber", "aston martin", "red bull racing", "haas", "mercedes", "mclaren", "ferrari", "williams"), "2020s"),
]


def infer_team_era(
    team_name: str | None,
    year: int | str | None = None,
    team_years_map: dict[str, int] | None = None,
) -> str:
    """Return the authentic decade era ('1950s'..'2020s') for a team (optionally at a specific year)."""
    if year is not None:
        return era_for_year(year)
    if team_name and team_years_map:
        yr = team_years_map.get(team_name)
        if yr is None:
            low_t = _norm(team_name)
            for k, v in team_years_map.items():
                if _norm(k) == low_t:
                    yr = v
                    break
        if yr is not None:
            return era_for_year(yr)
    if not team_name:
        return "2020s"
    low = _norm(team_name)
    for keys, era in _ERA_FALLBACK_KEYWORDS:
        if any(k in low for k in keys):
            return era
    return "2020s"

_STYLE_KEYWORDS: list[tuple[tuple[str, ...], str]] = [
    (("racing bulls", "vcarb"), "redbull"),
    (("red bull", "rbr"), "redbull"),
    (("mclaren",), "mclaren_papaya"),
    (("aston martin",), "aston_wings"),
    (("alpine",), "alpine_bwt"),
    (("williams",), "williams_duracell"),
    (("audi",), "audi_slash"),
    (("cadillac",), "cadillac_split"),
    (("haas",), "haas_carbon"),
    (("lotus",), "lotus_jps"),
    (("brawn",), "brawn_neon"),
    (("jordan",), "jordan_hornet"),
    (("sauber", "kick", "alphatauri", "virgin", "marussia", "force india", "racing point"), "two-tone"),
    (("brabham", "tyrrell", "ligier", "matra", "talbot", "prost", "minardi", "stewart", "penske", "zakspeed", "aguri"), "racing-stripe"),
    (("benetton", "toro rosso", "arrows", "footwork", "spyker", "toleman", "larrousse", "leyton"), "chevron"),
    (("maserati", "alfa", "porsche", "vanwall", "lancia", "cooper", "brm", "jaguar", "shadow", "wolf", "march", "iso"), "classic"),
    (("toyota", "honda", "bar"), "modern"),
]

_WORKS_STYLE_PREFIXES: list[tuple[tuple[str, ...], str]] = [
    (("ferrari", "scuderia ferrari"), "ferrari_hp"),
    (("mercedes",), "merc_arrow"),
    (("renault",), "renault_mildseven"),
]


def infer_livery_style(team_name: str | None) -> str:
    """Return a signature livery pattern style for a constructor name."""
    if not team_name:
        return "modern"
    low = _norm(team_name)
    for keys, style in _STYLE_KEYWORDS:
        if any(k in low for k in keys):
            return style
    for prefixes, style in _WORKS_STYLE_PREFIXES:
        if any(low == p or low.startswith(p + " ") for p in prefixes):
            return style
    # Deterministic fallback across the base 5 styles for minor historical constructors
    base_styles = ("modern", "two-tone", "racing-stripe", "chevron", "classic")
    h = sum(ord(ch) * (i + 1) for i, ch in enumerate(low))
    return base_styles[h % len(base_styles)]


def resolve_livery(team_name: str | None, year: int | str | None = 2026) -> dict:
    """Year-aware livery resolver combining authentic palettes, pattern styles, paint finish & motifs."""
    from .livery_registry import resolve_team_livery
    return resolve_team_livery(team_name, year)

# generic words that must not drive team matching ("Racing Bulls" vs "Red Bull Racing")
_STOP_TOKENS = {"racing", "team", "f1"}


def load_palettes() -> dict[str, dict[str, str]]:
    """Return {team name: {slot: hex}} for every team in the palettes file."""
    raw = json.loads(PALETTES_PATH.read_text())
    return {
        name: {slot: pal[slot] for slot in SLOT_ORDER}
        for name, pal in raw.items()
        if not name.startswith("_")
    }


def slugify(name: str) -> str:
    """Team name -> file slug used in static/cars/."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def find_slug(team_name: str | None) -> str | None:
    """Best-matching livery slug for a (possibly historical) team name.

    Order: exact name, prefix family match ("McLaren" -> "McLaren Mercedes"),
    then significant-token overlap ("Haas F1 Team" -> "Haas Ferrari").
    Returns None when nothing plausibly matches.
    """
    if not team_name:
        return None
    palettes = load_palettes()
    t = _norm(team_name)
    for name in palettes:
        if _norm(name) == t:
            return slugify(name)
    for name in palettes:
        n = _norm(name)
        if n.startswith(t) or t.startswith(n):
            return slugify(name)
    t_tokens = set(t.split()) - _STOP_TOKENS
    best, best_score = None, 0
    for name in palettes:
        score = len(t_tokens & (set(_norm(name).split()) - _STOP_TOKENS))
        if score > best_score:
            best, best_score = slugify(name), score
    return best


def find_car_png_slug(
    team_name: str | None,
    year: int | str | None = None,
    era: str | None = None,
) -> str | None:
    """Return the exact-year (e.g. 'ferrari--2026', 'red-bull-racing-honda-rbpt--2024') or
    decade-era ('ferrari--1950s') studio PNG slug when available.

    Always checks exact season year first so every aero generation & year-specific livery
    (e.g. 2024 vs 2025 vs 2026 Ferrari, 2014 vs 2017 vs 2024 vs 2026 Red Bull) displays its
    exact faithful 3D chassis & livery!
    """
    base = find_slug(team_name)
    if not base:
        return None
    if year is not None:
        try:
            y_int = int(str(year).strip()[:4])
            year_slug = f"{base}--{y_int}"
            if (CAR_PNG_DIR / f"{year_slug}.png").exists():
                return year_slug
        except Exception:
            pass
    target_era = era or (era_for_year(year) if year is not None else None)
    if target_era:
        era_slug = f"{base}--{target_era}"
        if (CAR_PNG_DIR / f"{era_slug}.png").exists():
            return era_slug
    return base
