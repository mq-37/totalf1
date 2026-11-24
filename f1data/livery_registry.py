"""
Year-Accurate Formula 1 Team Livery, Paint Finish & Chassis Shape Registry (1950–2026).

Resolves `(team_name, year)` into faithful 5-slot palettes (`main`, `secondary`, `accent`,
`pop`, `detail`), 3D livery pattern styles (`redbull`, `ferrari_hp`, `merc_arrow`,
`williams_duracell`, `audi_slash`, `cadillac_split`, `mclaren_papaya`, `modern`,
`two-tone`, `racing-stripe`, `chevron`, `classic`), paint finish (`matte`, `gloss`,
`metallic`, `carbon`), and optional 3D motif decals.
"""
from __future__ import annotations

import re
from typing import Any


def _norm(name: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(name or "").lower()).strip()


def _yr(year: int | str | None) -> int:
    if year is None:
        return 2026
    try:
        return int(str(year).strip()[:4])
    except Exception:
        return 2026


# Ordered family match rules: (keywords, resolver(year) -> dict)
def _resolve_red_bull(y: int) -> dict[str, Any]:
    if y <= 2015:
        return {
            "palette": {"main": "#142254", "secondary": "#DB0A40", "accent": "#FFCC00", "pop": "#FFFFFF", "detail": "#0A1026"},
            "style": "redbull",
            "finish": "metallic",
            "motif": "bull_nose",
            "label": f"{y} Red Bull Racing (Gloss Navy & Yellow Bull Nose)",
        }
    return {
        "palette": {"main": "#0B1A3C", "secondary": "#DB0A40", "accent": "#FFCC00", "pop": "#FFFFFF", "detail": "#070D1D"},
        "style": "redbull",
        "finish": "matte",
        "motif": "bull_nose",
        "label": f"{y} Oracle Red Bull Racing (Matte Navy, Yellow Nose & Crimson Bull)",
    }


def _resolve_ferrari(y: int) -> dict[str, Any]:
    if y >= 2025:
        # 2025 SF-25 & 2026 SF-26: Rosso Corsa + crisp HP White engine cover band + HP / Azzurro Blue accents!
        return {
            "palette": {"main": "#DC0000", "secondary": "#FFFFFF", "accent": "#0052B4", "pop": "#FFEF00", "detail": "#14161C"},
            "style": "ferrari_hp",
            "finish": "gloss",
            "motif": "ferrari_hp_blue",
            "label": f"{y} Scuderia Ferrari HP (Rosso Corsa, White Engine Band & Blue Accents)",
        }
    if y == 2024:
        return {
            "palette": {"main": "#E80020", "secondary": "#FFEF00", "accent": "#FFFFFF", "pop": "#0052B4", "detail": "#14161C"},
            "style": "ferrari_hp",
            "finish": "matte",
            "motif": "ferrari_hp_blue",
            "label": "2024 Scuderia Ferrari SF-24 (Rosso Corsa, Yellow/White Stripes & HP Blue)",
        }
    if y >= 2019:
        return {
            "palette": {"main": "#DC0000", "secondary": "#14161C", "accent": "#FFEF00", "pop": "#FFFFFF", "detail": "#7D0818"},
            "style": "modern",
            "finish": "matte",
            "motif": "scuderia",
            "label": f"{y} Scuderia Ferrari (Matte Rosso Corsa & Carbon)",
        }
    if 1996 <= y <= 2010:
        return {
            "palette": {"main": "#DC0000", "secondary": "#FFFFFF", "accent": "#14161C", "pop": "#FFEF00", "detail": "#8E0B22"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "scuderia",
            "label": f"{y} Scuderia Ferrari (Scarlet & White Marlboro Era)",
        }
    if 1975 <= y <= 1995:
        return {
            "palette": {"main": "#D4001A", "secondary": "#FFFFFF", "accent": "#FFEF00", "pop": "#14161C", "detail": "#7A0614"},
            "style": "classic",
            "finish": "gloss",
            "motif": "scuderia",
            "label": f"{y} Scuderia Ferrari (Classic Rosso Corsa & White Wings)",
        }
    return {
        "palette": {"main": "#A8001A", "secondary": "#FFEF00", "accent": "#E5E7EB", "pop": "#FFFFFF", "detail": "#5A040F"},
        "style": "classic",
        "finish": "gloss",
        "motif": "scuderia",
        "label": f"{y} Scuderia Ferrari (Heritage Dark Rosso Corsa)",
    }


def _resolve_mercedes(y: int) -> dict[str, Any]:
    if y >= 2024:
        # 2024-2026: Sleek Obsidian Carbon + Silver Arrow Nose + Razor Petronas Teal Pinstripe + INEOS Red Roll Hoop!
        return {
            "palette": {"main": "#11151B", "secondary": "#C8CCCE", "accent": "#27F4D2", "pop": "#E10600", "detail": "#090B0E"},
            "style": "merc_arrow",
            "finish": "metallic",
            "motif": "silver_arrow",
            "label": f"{y} Mercedes-AMG Petronas (Carbon/Silver Arrow & Petronas Teal)",
        }
    if y in (2020, 2021, 2023):
        return {
            "palette": {"main": "#0C0F14", "secondary": "#1D222B", "accent": "#27F4D2", "pop": "#E10600", "detail": "#06080B"},
            "style": "merc_arrow",
            "finish": "gloss",
            "motif": "silver_arrow",
            "label": f"{y} Mercedes-AMG Petronas (Black Arrow & Petronas Teal)",
        }
    return {
        "palette": {"main": "#C8CCCE", "secondary": "#1A1E24", "accent": "#27F4D2", "pop": "#FFFFFF", "detail": "#64748B"},
        "style": "merc_arrow",
        "finish": "metallic",
        "motif": "silver_arrow",
        "label": f"{y} Mercedes Silver Arrow (Metallic Silver & Petronas Teal)",
    }


def _resolve_mclaren(y: int) -> dict[str, Any]:
    if y >= 2018:
        return {
            "palette": {"main": "#FF8000", "secondary": "#14171D", "accent": "#47C7FC", "pop": "#FFFFFF", "detail": "#9E4F00"},
            "style": "two-tone",
            "finish": "matte",
            "motif": "papaya",
            "label": f"{y} McLaren F1 Team (Papaya Orange & Exposed Carbon)",
        }
    if 1997 <= y <= 2014:
        return {
            "palette": {"main": "#C6CBD2", "secondary": "#14161B", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#525866"},
            "style": "two-tone",
            "finish": "metallic",
            "motif": "chrome_arrow",
            "label": f"{y} McLaren Mercedes (Chrome Silver & Rocket Red)",
        }
    if 1974 <= y <= 1996:
        return {
            "palette": {"main": "#F8FAFC", "secondary": "#EE1C25", "accent": "#111318", "pop": "#FFCC00", "detail": "#991B1B"},
            "style": "chevron",
            "finish": "gloss",
            "motif": "marlboro_chevron",
            "label": f"{y} McLaren (Iconic White & Day-Glo Red Chevron)",
        }
    return {
        "palette": {"main": "#FF8000", "secondary": "#14171D", "accent": "#FFFFFF", "pop": "#FFAA44", "detail": "#8F4700"},
        "style": "classic",
        "finish": "gloss",
        "motif": "papaya",
        "label": f"{y} Bruce McLaren Heritage Papaya",
    }


def _resolve_williams(y: int) -> dict[str, Any]:
    if y >= 2022:
        return {
            "palette": {"main": "#041E42", "secondary": "#00A3E0", "accent": "#C87533", "pop": "#FFFFFF", "detail": "#0A1228"},
            "style": "williams_duracell",
            "finish": "gloss",
            "motif": "duracell_airbox",
            "label": f"{y} Williams Racing (Royal Navy, Electric Blue & Copper Airbox)",
        }
    if 1994 <= y <= 1997:
        return {
            "palette": {"main": "#0D2B7A", "secondary": "#FFFFFF", "accent": "#D4AF37", "pop": "#E10600", "detail": "#081A4B"},
            "style": "racing-stripe",
            "finish": "gloss",
            "motif": "rothmans",
            "label": f"{y} Rothmans Williams Renault (Blue, White & Gold)",
        }
    if 1985 <= y <= 1993:
        return {
            "palette": {"main": "#F8FAFC", "secondary": "#0A2B8C", "accent": "#FFCC00", "pop": "#E10600", "detail": "#1E3A8A"},
            "style": "racing-stripe",
            "finish": "gloss",
            "motif": "canon",
            "label": f"{y} Canon Williams (White, Blue & Yellow)",
        }
    return {
        "palette": {"main": "#F8FAFC", "secondary": "#006B3C", "accent": "#00A3E0", "pop": "#FFFFFF", "detail": "#041E42"},
        "style": "racing-stripe",
        "finish": "gloss",
        "motif": "classic",
        "label": f"{y} Williams Grand Prix Engineering",
    }


def _resolve_aston(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#00594F", "secondary": "#101418", "accent": "#CEDC00", "pop": "#FFFFFF", "detail": "#003B34"},
        "style": "modern",
        "finish": "metallic",
        "motif": "brg_lime",
        "label": f"{y} Aston Martin Aramco (Metallic British Racing Green & Lime)",
    }


def _resolve_alpine(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#0072CE", "secondary": "#FD4BC7", "accent": "#14171D", "pop": "#FFFFFF", "detail": "#0A3A6E"},
        "style": "two-tone",
        "finish": "metallic",
        "motif": "alpine_bwt",
        "label": f"{y} BWT Alpine F1 Team (Alpine Blue, BWT Pink & Carbon)",
    }


def _resolve_audi(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#C2C7D0", "secondary": "#101319", "accent": "#F50537", "pop": "#FFFFFF", "detail": "#3F4552"},
        "style": "audi_slash",
        "finish": "metallic",
        "motif": "audi_rings",
        "label": f"{y} Audi F1 Works Team (Titanium Silver, Carbon & Lava Red)",
    }


def _resolve_cadillac(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#0B0D12", "secondary": "#F8FAFC", "accent": "#D4AF37", "pop": "#94A3B8", "detail": "#050608"},
        "style": "cadillac_split",
        "finish": "gloss",
        "motif": "cadillac_crest",
        "label": f"{y} Cadillac Formula 1 Team (Monochrome Black/White Split & Gold)",
    }


def _resolve_racing_bulls(y: int) -> dict[str, Any]:
    if y >= 2025:
        return {
            "palette": {"main": "#F8FAFC", "secondary": "#1E41FF", "accent": "#DB0A40", "pop": "#FFCC00", "detail": "#111827"},
            "style": "redbull",
            "finish": "gloss",
            "motif": "bull_nose",
            "label": f"{y} Visa Cash App Racing Bulls (Gloss White, Royal Blue & Red Bull Nose)",
        }
    return {
        "palette": {"main": "#14266B", "secondary": "#F8FAFC", "accent": "#DB0A40", "pop": "#FFCC00", "detail": "#0A143A"},
        "style": "two-tone",
        "finish": "metallic",
        "motif": "bull_nose",
        "label": f"{y} Racing Bulls / Toro Rosso",
    }


def _resolve_haas(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#F4F5F7", "secondary": "#14161A", "accent": "#DA291C", "pop": "#FFFFFF", "detail": "#475569"},
        "style": "two-tone",
        "finish": "gloss",
        "motif": "haas",
        "label": f"{y} MoneyGram Haas F1 Team (White, Carbon & Haas Red)",
    }


def _resolve_lotus(y: int) -> dict[str, Any]:
    if 1972 <= y <= 1986 or y >= 2012:
        return {
            "palette": {"main": "#0E0E10", "secondary": "#D4AF37", "accent": "#FACC15", "pop": "#FFFFFF", "detail": "#070708"},
            "style": "classic",
            "finish": "gloss",
            "motif": "jps_gold",
            "label": f"{y} Team Lotus (Black & Gold Pinstripe)",
        }
    if 1987 <= y <= 1990:
        return {
            "palette": {"main": "#FFCC00", "secondary": "#0B2C7A", "accent": "#FFFFFF", "pop": "#111318", "detail": "#A16207"},
            "style": "racing-stripe",
            "finish": "gloss",
            "motif": "camel",
            "label": f"{y} Camel Team Lotus (Yellow & Blue)",
        }
    return {
        "palette": {"main": "#005936", "secondary": "#FACC15", "accent": "#FFFFFF", "pop": "#FDE047", "detail": "#003621"},
        "style": "classic",
        "finish": "gloss",
        "motif": "brg_yellow",
        "label": f"{y} Team Lotus (British Racing Green & Yellow Stripe)",
    }


def _resolve_renault(y: int) -> dict[str, Any]:
    if 2002 <= y <= 2006:
        return {
            "palette": {"main": "#38A1E8", "secondary": "#FFCC00", "accent": "#FFFFFF", "pop": "#0B1F4B", "detail": "#1E40AF"},
            "style": "chevron",
            "finish": "gloss",
            "motif": "mild_seven",
            "label": f"{y} Mild Seven Renault F1 (Sky Blue & Yellow)",
        }
    return {
        "palette": {"main": "#FFCC00", "secondary": "#111318", "accent": "#FFFFFF", "pop": "#FDE047", "detail": "#090A0D"},
        "style": "two-tone",
        "finish": "matte",
        "motif": "renault_yellow",
        "label": f"{y} Renault F1 Team (Yellow & Black)",
    }


def _resolve_brawn(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#F8FAFC", "secondary": "#111318", "accent": "#D8FF00", "pop": "#FFFFFF", "detail": "#334155"},
        "style": "chevron",
        "finish": "gloss",
        "motif": "brawn_09",
        "label": "2009 Brawn GP (Pearl White, Neon Yellow & Black)",
    }


def _resolve_benetton(y: int) -> dict[str, Any]:
    if y >= 1994:
        return {
            "palette": {"main": "#38A1E8", "secondary": "#FFFFFF", "accent": "#16A34A", "pop": "#FFCC00", "detail": "#1D4ED8"},
            "style": "chevron",
            "finish": "gloss",
            "motif": "mild_seven",
            "label": f"{y} Mild Seven Benetton (Sky Blue & White)",
        }
    return {
        "palette": {"main": "#FFCC00", "secondary": "#16A34A", "accent": "#E10600", "pop": "#2563EB", "detail": "#111827"},
        "style": "chevron",
        "finish": "gloss",
        "motif": "united_colors",
        "label": f"{y} Benetton Formula (Yellow, Green & Red)",
    }


def _resolve_jordan(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#FFCC00", "secondary": "#111318", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#713F12"},
        "style": "chevron",
        "finish": "gloss",
        "motif": "hornet",
        "label": f"{y} Jordan Grand Prix (Buzzin Hornets Yellow & Black)",
    }


FAMILY_RESOLVERS: list[tuple[tuple[str, ...], Any]] = [
    (("racing bulls", "vcarb", "toro rosso", "alphatauri", "str "), _resolve_racing_bulls),
    (("red bull", "rbr"), _resolve_red_bull),
    (("ferrari",), _resolve_ferrari),
    (("mercedes",), _resolve_mercedes),
    (("mclaren",), _resolve_mclaren),
    (("williams",), _resolve_williams),
    (("aston martin",), _resolve_aston),
    (("alpine",), _resolve_alpine),
    (("audi",), _resolve_audi),
    (("cadillac",), _resolve_cadillac),
    (("haas",), _resolve_haas),
    (("lotus",), _resolve_lotus),
    (("brawn",), _resolve_brawn),
    (("benetton",), _resolve_benetton),
    (("jordan",), _resolve_jordan),
    (("renault",), _resolve_renault),
]


def resolve_team_livery(team_name: str | None, year: int | str | None = 2026) -> dict[str, Any]:
    """Return year-accurate 5-slot palette, 3D livery style, paint finish & chassis motif."""
    low = _norm(team_name)
    y = _yr(year)
    for keys, fn in FAMILY_RESOLVERS:
        if any(k in low for k in keys):
            out = dict(fn(y))
            out["year"] = y
            out["team"] = team_name or ""
            return out

    # Fallback to team_car_palettes.json + style inference
    from . import f1_car_palettes as fcp
    pals = fcp.load_palettes()
    slug = fcp.find_slug(team_name)
    found_pal = None
    if slug:
        for nm, pal in pals.items():
            if fcp.slugify(nm) == slug:
                found_pal = dict(pal)
                break
    return {
        "palette": found_pal or {"main": "#E10600", "secondary": "#14171D", "accent": "#FACC15", "pop": "#FFFFFF", "detail": "#0F172A"},
        "style": fcp.infer_livery_style(team_name),
        "finish": "gloss",
        "motif": "standard",
        "year": y,
        "team": team_name or "",
        "label": f"{y} {team_name or 'Constructor'}",
    }
