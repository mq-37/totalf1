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
    if y >= 2026:
        # 2026 Oracle Red Bull Racing RB22 (Red Bull Ford): Returned to high-gloss vibrant metallic cobalt blue,
        # bright sun-yellow nose & airbox with crisp white-outlined crimson charging bull!
        return {
            "palette": {"main": "#0B2168", "secondary": "#E00A2B", "accent": "#FFBE00", "pop": "#FFFFFF", "detail": "#061030"},
            "style": "redbull",
            "finish": "gloss",
            "motif": "bull_nose",
            "label": f"{y} Oracle Red Bull Racing RB22 (Gloss Cobalt Blue, Sun Yellow & Charging Bull)",
        }
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
    if 1982 <= y <= 1985:
        # 126C2 / 126C3 / 126C4 Marlboro turbo era: Rosso Corsa tub & sidepods + iconic WHITE upper
        # engine-cover deck, white nose band & white wings with red trim!
        return {
            "palette": {"main": "#DC0000", "secondary": "#FFFFFF", "accent": "#14161C", "pop": "#FFEF00", "detail": "#8E0B22"},
            "style": "ferrari_white_deck",
            "finish": "gloss",
            "motif": "scuderia",
            "label": f"{y} Scuderia Ferrari (Rosso Corsa & White Marlboro Turbo Deck)",
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
    if y >= 2026:
        # 2026 Mercedes-AMG Petronas W17: Gloss Obsidian Black + Silver Arrow top nose & AMG flank slashes +
        # flowing Petronas Turquoise wave & silver 3-pointed stars (no red INEOS roll-hoop in 2026!)
        return {
            "palette": {"main": "#0F1319", "secondary": "#C8CCCE", "accent": "#00D2BE", "pop": "#FFFFFF", "detail": "#07090D"},
            "style": "merc_arrow",
            "finish": "gloss",
            "motif": "silver_arrow",
            "label": f"{y} Mercedes-AMG Petronas W17 (Obsidian Black, Silver Arrow Slashes & Petronas Teal)",
        }
    if y >= 2024:
        # 2024-2025 W15/W16: Sleek Obsidian Carbon + Silver Arrow Nose + Petronas Teal + INEOS Red Roll Hoop!
        return {
            "palette": {"main": "#11151B", "secondary": "#C8CCCE", "accent": "#27F4D2", "pop": "#E10600", "detail": "#090B0E"},
            "style": "merc_arrow",
            "finish": "metallic",
            "motif": "silver_arrow",
            "label": f"{y} Mercedes-AMG Petronas (Carbon/Silver Arrow, Petronas Teal & INEOS Red)",
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
    if y >= 2022:
        return {
            "palette": {"main": "#FF7A00", "secondary": "#14171D", "accent": "#00B8D4", "pop": "#FFFFFF", "detail": "#1A1E26"},
            "style": "mclaren_papaya",
            "finish": "matte",
            "motif": "papaya",
            "label": f"{y} McLaren F1 Team (Matte Papaya Orange, Anthracite Carbon & Chrome Rims)",
        }
    if 2018 <= y <= 2021:
        return {
            "palette": {"main": "#FF8000", "secondary": "#0059B3", "accent": "#47C7FC", "pop": "#FFFFFF", "detail": "#14171D"},
            "style": "two-tone",
            "finish": "matte",
            "motif": "papaya",
            "label": f"{y} McLaren F1 Team (Papaya Orange & Electric Blue)",
        }
    if 2015 <= y <= 2017:
        return {
            "palette": {"main": "#1C2026", "secondary": "#FF6A00", "accent": "#FFFFFF", "pop": "#FFFFFF", "detail": "#0F1216"},
            "style": "two-tone",
            "finish": "matte",
            "motif": "papaya",
            "label": f"{y} McLaren Honda (Graphite Black & Orange)",
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
            "style": "mclaren_marlboro",
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
    if y >= 2026:
        # 2026 Atlassian Williams FW48: Vibrant Gloss Royal Blue, Sky Blue upper sidepod + Crisp White lower panel
        # (Barclays/Komatsu) & iconic Duracell Copper airbox!
        return {
            "palette": {"main": "#0062C8", "secondary": "#32A3E8", "accent": "#C87533", "pop": "#F7F8FA", "detail": "#12161E"},
            "style": "williams_2026",
            "finish": "gloss",
            "motif": "duracell_airbox",
            "label": f"{y} Atlassian Williams Racing FW48 (Gloss Royal Blue, Sky/White Sidepods & Duracell Airbox)",
        }
    if y >= 2022:
        return {
            "palette": {"main": "#041E42", "secondary": "#00A3E0", "accent": "#C87533", "pop": "#FFFFFF", "detail": "#0A1228"},
            "style": "williams_duracell",
            "finish": "gloss",
            "motif": "duracell_airbox",
            "label": f"{y} Williams Racing (Royal Navy, Electric Blue & Copper Airbox)",
        }
    if 2019 <= y <= 2021:
        return {
            "palette": {"main": "#F8FAFC", "secondary": "#00A3E0", "accent": "#041E42", "pop": "#FFFFFF", "detail": "#0A1228"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "classic",
            "label": f"{y} Williams Racing (White & Sky Blue)",
        }
    if 2014 <= y <= 2018:
        return {
            "palette": {"main": "#F8FAFC", "secondary": "#002366", "accent": "#E10600", "pop": "#38BDF8", "detail": "#1E293B"},
            "style": "martini_tri",
            "finish": "gloss",
            "motif": "martini",
            "label": f"{y} Williams Martini Racing (Pearl White & Tricolour Stripes)",
        }
    if 2000 <= y <= 2005:
        return {
            "palette": {"main": "#F8FAFC", "secondary": "#0B2466", "accent": "#0072CE", "pop": "#FFFFFF", "detail": "#081845"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "bmw_williams",
            "label": f"{y} BMW WilliamsF1 Team (Pearl White & Deep Navy)",
        }
    if 1998 <= y <= 1999:
        return {
            "palette": {"main": "#CC0018", "secondary": "#F8FAFC", "accent": "#111318", "pop": "#FFCC00", "detail": "#7A0410"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "winfield",
            "label": f"{y} Winfield Williams (Crimson Red & White)",
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
    if y >= 2026:
        # 2026 Aston Martin Aramco Honda AMR26: Satin/Matte British Racing Green, Carbon wings & razor lime pinstripe!
        return {
            "palette": {"main": "#00584B", "secondary": "#101418", "accent": "#CEDC00", "pop": "#FFFFFF", "detail": "#003B34"},
            "style": "aston_wings",
            "finish": "matte",
            "motif": "brg_lime",
            "label": f"{y} Aston Martin Aramco Honda AMR26 (Matte British Racing Green & Lime Pinstripe)",
        }
    return {
        "palette": {"main": "#00594F", "secondary": "#101418", "accent": "#CEDC00", "pop": "#FFFFFF", "detail": "#003B34"},
        "style": "aston_wings",
        "finish": "metallic",
        "motif": "brg_lime",
        "label": f"{y} Aston Martin Aramco (Metallic British Racing Green & Lime Pinstripes)",
    }


def _resolve_alpine(y: int) -> dict[str, Any]:
    if y == 2021:
        return {
            "palette": {"main": "#0059B3", "secondary": "#14171D", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#082C5A"},
            "style": "modern",
            "finish": "metallic",
            "motif": "alpine_tricolour",
            "label": "2021 Alpine F1 Team A521 (Metallic Alpine Blue & French Tricolour)",
        }
    return {
        "palette": {"main": "#005CB9", "secondary": "#F47BBF", "accent": "#14171D", "pop": "#FFFFFF", "detail": "#093160"},
        "style": "alpine_bwt",
        "finish": "metallic",
        "motif": "alpine_bwt",
        "label": f"{y} BWT Alpine F1 Team (Metallic Alpine Blue, BWT Rose Pink & Carbon)",
    }


def _resolve_audi(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#8D929A", "secondary": "#12151B", "accent": "#FF2400", "pop": "#FFFFFF", "detail": "#2A2E37"},
        "style": "audi_slash",
        "finish": "metallic",
        "motif": "audi_rings",
        "label": f"{y} Audi Revolut F1 Team R26 (Brushed Titanium Silver, Lava Red Slash & Exposed Carbon)",
    }


def _resolve_cadillac(y: int) -> dict[str, Any]:
    # 2026 Cadillac Formula 1 Team: Sleek Monochrome Pearl White, Silver-Grey & Deep Gloss Black
    # with chequered speed-stripes, monochrome Cadillac crest, TWG flank & white aero wheel covers!
    return {
        "palette": {"main": "#F2F4F7", "secondary": "#111419", "accent": "#9BA3AE", "pop": "#FFFFFF", "detail": "#1B2028"},
        "style": "cadillac_split",
        "finish": "gloss",
        "motif": "cadillac_crest",
        "label": f"{y} Cadillac Formula 1 Team (Monochrome Pearl White, Silver Fade & Gloss Black)",
    }


def _resolve_racing_bulls(y: int) -> dict[str, Any]:
    if y >= 2025:
        # 2025-2026 Visa Cash App Racing Bulls (VCARB 02 / VCARB 03): Gloss Pure White bodywork & white wheel covers,
        # Sun-Yellow nose & airbox with Red Charging Bull, Royal Blue sidepod swoosh & VISA branding!
        return {
            "palette": {"main": "#F7F8FA", "secondary": "#1434A4", "accent": "#FFBE00", "pop": "#DB0A40", "detail": "#14171D"},
            "style": "vcarb_2026",
            "finish": "gloss",
            "motif": "bull_nose",
            "label": f"{y} Visa Cash App Racing Bulls (Gloss White, Yellow Bull Nose/Airbox & Royal Blue)",
        }
    if y == 2024:
        return {
            "palette": {"main": "#1A3CE6", "secondary": "#F8FAFC", "accent": "#DB0A40", "pop": "#FFCC00", "detail": "#0E1A4A"},
            "style": "two-tone",
            "finish": "metallic",
            "motif": "bull_nose",
            "label": "2024 Visa Cash App RB VCARB 01 (Metallic Royal Blue, White & Red Bull)",
        }
    if 2020 <= y <= 2023:
        return {
            "palette": {"main": "#F4F6F9", "secondary": "#132240", "accent": "#DB0A40", "pop": "#FFFFFF", "detail": "#0A1428"},
            "style": "two-tone",
            "finish": "matte",
            "motif": "alphatauri",
            "label": f"{y} Scuderia AlphaTauri (Matte White & Deep Navy)",
        }
    return {
        "palette": {"main": "#14266B", "secondary": "#DB0A40", "accent": "#FFCC00", "pop": "#FFFFFF", "detail": "#0A143A"},
        "style": "two-tone",
        "finish": "metallic",
        "motif": "bull_nose",
        "label": f"{y} Scuderia Toro Rosso (Metallic Blue & Red Bull)",
    }


def _resolve_haas(y: int) -> dict[str, Any]:
    if y >= 2026:
        # 2026 TGR Haas F1 Team VF-26: Gloss Pure White bodywork/sidepods/halo/rear endplates,
        # bold Red airbox hood & upper shoulder beltline, exposed carbon floor, black HAAS & black/red GR branding!
        return {
            "palette": {"main": "#F7F8FA", "secondary": "#13161B", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#1B1F26"},
            "style": "haas_tgr",
            "finish": "gloss",
            "motif": "haas_tgr",
            "label": f"{y} TGR Haas F1 Team VF-26 (Gloss White, Haas Red Airbox & GR Engine Cover)",
        }
    if y == 2025:
        # 2025 MoneyGram Haas VF-25: Predominantly Gloss White bodywork & sidepods with black lower undercut & red trim
        return {
            "palette": {"main": "#F6F7F9", "secondary": "#14161A", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#262B33"},
            "style": "modern",
            "finish": "gloss",
            "motif": "haas",
            "label": "2025 MoneyGram Haas F1 Team VF-25 (Gloss White, Carbon Undercut & Haas Red)",
        }
    if y in (2023, 2024):
        # 2023-2024 MoneyGram Haas VF-23 / VF-24: White nose & engine cover + Raw Exposed Carbon Black sidepods + Red accents
        return {
            "palette": {"main": "#F4F5F7", "secondary": "#14161A", "accent": "#DA291C", "pop": "#FFFFFF", "detail": "#2E3440"},
            "style": "haas_carbon",
            "finish": "gloss",
            "motif": "haas",
            "label": f"{y} MoneyGram Haas F1 Team (White Spine, Exposed Carbon Sidepods & Red)",
        }
    if y == 2022:
        return {
            "palette": {"main": "#F6F7F9", "secondary": "#14161A", "accent": "#DA291C", "pop": "#FFFFFF", "detail": "#334155"},
            "style": "modern",
            "finish": "gloss",
            "motif": "haas",
            "label": "2022 Haas F1 Team VF-22 (White, Black & Haas Red)",
        }
    if y == 2021:
        # 2021 Uralkali Haas VF-21: Gloss White with Blue & Red tricolour stripes
        return {
            "palette": {"main": "#F8FAFC", "secondary": "#0039A6", "accent": "#D52B1E", "pop": "#FFFFFF", "detail": "#1E293B"},
            "style": "martini_tri",
            "finish": "gloss",
            "motif": "haas",
            "label": "2021 Uralkali Haas F1 Team VF-21 (White, Blue & Red Tricolour)",
        }
    if y == 2019:
        # 2019 Rich Energy Haas VF-19: Gloss Black & Brushed Gold Pinstripes!
        return {
            "palette": {"main": "#0E0F12", "secondary": "#D4AF37", "accent": "#FACC15", "pop": "#FFFFFF", "detail": "#07080A"},
            "style": "lotus_jps",
            "finish": "gloss",
            "motif": "rich_energy",
            "label": "2019 Rich Energy Haas F1 Team VF-19 (Gloss Black & Gold)",
        }
    if y in (2018, 2020):
        return {
            "palette": {"main": "#F2F4F7", "secondary": "#1A1D24", "accent": "#DA291C", "pop": "#FFFFFF", "detail": "#475569"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "haas",
            "label": f"{y} Haas F1 Team (White, Charcoal & Haas Red)",
        }
    # 2016-2017 VF-16 / VF-17: Metallic Gunmetal Grey, Black & Haas Red
    return {
        "palette": {"main": "#696E77", "secondary": "#181B21", "accent": "#DA291C", "pop": "#F4F5F7", "detail": "#343942"},
        "style": "two-tone",
        "finish": "metallic",
        "motif": "haas",
        "label": f"{y} Haas F1 Team (Gunmetal Grey, Black & Haas Red)",
    }


def _resolve_lotus(y: int) -> dict[str, Any]:
    if 1972 <= y <= 1986 or y >= 2012:
        return {
            "palette": {"main": "#0E0E10", "secondary": "#D4AF37", "accent": "#FACC15", "pop": "#FFFFFF", "detail": "#070708"},
            "style": "lotus_jps",
            "finish": "gloss",
            "motif": "jps_gold",
            "label": f"{y} Team Lotus (John Player Special Black & Gold Pinstripe)",
        }
    if 1968 <= y <= 1971:
        # Gold Leaf Team Lotus era: Lotus 49B high-stilt wings & early Lotus 72s in rich metallic
        # GOLD with the red nose band / spine stripe & white "GA·GA" accents (JPS only arrived in 1972!)
        return {
            "palette": {"main": "#C9A227", "secondary": "#E10600", "accent": "#FFFFFF", "pop": "#FFFFFF", "detail": "#14100A"},
            "style": "lotus_gold_leaf",
            "finish": "metallic",
            "motif": "gold_leaf",
            "label": f"{y} Gold Leaf Team Lotus (Metallic Gold & Red Noseband)",
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
            "style": "renault_mildseven",
            "finish": "gloss",
            "motif": "mild_seven",
            "label": f"{y} Mild Seven Renault F1 (Sky Blue & Canary Yellow)",
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
        "style": "brawn_neon",
        "finish": "gloss",
        "motif": "brawn_09",
        "label": "2009 Brawn GP (Pearl White, Neon Chartreuse & Black)",
    }


def _resolve_benetton(y: int) -> dict[str, Any]:
    if y >= 1994:
        return {
            "palette": {"main": "#38A1E8", "secondary": "#FFFFFF", "accent": "#16A34A", "pop": "#FFCC00", "detail": "#1D4ED8"},
            "style": "renault_mildseven",
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
        "style": "jordan_hornet",
        "finish": "gloss",
        "motif": "hornet",
        "label": f"{y} Jordan Grand Prix (Buzzin Hornets Yellow & Black Nose)",
    }


def _resolve_sauber(y: int) -> dict[str, Any]:
    if y <= 1993:
        # C12 debut: all-black carbon chassis with white lower-flank & wing elements
        return {
            "palette": {"main": "#0C0D0F", "secondary": "#FFFFFF", "accent": "#D0021B", "pop": "#FFEF00", "detail": "#08090B"},
            "style": "carbon_stealth",
            "finish": "gloss",
            "motif": "c12_black",
            "label": f"{y} Team Sauber (C12 Black Carbon & White Elements)",
        }
    if 2001 <= y <= 2005:
        # C20-C24 Red Bull era: Royal Blue chassis + Petronas turquoise under-sidepod sweep &
        # front wing + crisp white Credit Suisse wings & the Red Bull roundel on the airbox!
        return {
            "palette": {"main": "#1530B8", "secondary": "#3EC6C0", "accent": "#FFFFFF", "pop": "#E10600", "detail": "#0A1660"},
            "style": "sauber_petronas",
            "finish": "gloss",
            "motif": "petronas_teal",
            "label": f"{y} Sauber Petronas (Royal Blue, Teal Underline & Red Bull)",
        }
    if 1994 <= y <= 2000:
        # C13-C19 Petronas debut years: deep signal red tub & engine cover + clean white top deck
        # and wings (Petronas ran red/white before the 2001 blue Red Bull refresh!)
        return {
            "palette": {"main": "#C8102E", "secondary": "#FFFFFF", "accent": "#F9C802", "pop": "#111318", "detail": "#7A0614"},
            "style": "ferrari_white_deck",
            "finish": "gloss",
            "motif": "petronas_red",
            "label": f"{y} Red Bull Sauber Petronas (Signal Red & White Deck)",
        }
    if 2006 <= y <= 2010:
        # Stray "Sauber" 2006-09 seasons + 2010 C29 carry-over keep the BMW-era white/blue look
        return {
            "palette": {"main": "#F5F7FA", "secondary": "#1E40C8", "accent": "#0B1F6B", "pop": "#5EB8FF", "detail": "#101423"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "bmw_sweep",
            "label": f"{y} Sauber F1 Team (Pearl White & Motorsport Blue carry-over)",
        }
    if y <= 2018:
        # C29-C37 years: dark steel-blue graphite bodywork with white & red accents
        return {
            "palette": {"main": "#1A2237", "secondary": "#5E6A85", "accent": "#FFFFFF", "pop": "#D0021B", "detail": "#0D1220"},
            "style": "two-tone",
            "finish": "matte",
            "motif": "standard",
            "label": f"{y} Sauber F1 Team (Steel Blue Graphite & White)",
        }
    # 2023+ (incl. 2024-25 Kick Sauber): dark carbon-green chassis with Kick neon green accents
    return {
        "palette": {"main": "#0E1F1A", "secondary": "#3BFF9E", "accent": "#FFFFFF", "pop": "#00E073", "detail": "#071310"},
        "style": "carbon_stealth",
        "finish": "matte",
        "motif": "kick_green",
        "label": f"{y} Stake/Kick Sauber (Dark Carbon & Kick Neon Green)",
    }


def _resolve_sauber_bmw(y: int) -> dict[str, Any]:
    # BMW-era identity ("Sauber BMW" / "BMW Sauber", 2006-09): crisp pearl white chassis +
    # BMW Motorsport blue flank sweeps & navy engine cover. Kept team-keyed so a stray
    # peak-year like 2005 can never bleed into the Petronas blue era branch!
    if 2004 <= y <= 2010:
        return {
            "palette": {"main": "#F5F7FA", "secondary": "#1E40C8", "accent": "#0B1F6B", "pop": "#5EB8FF", "detail": "#101423"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "bmw_sweep",
            "label": f"{y} BMW Sauber F1 Team (Pearl White & Motorsport Blue)",
        }
    return _resolve_sauber(y)


# IMPORTANT: Customer constructors MUST come BEFORE works engine suppliers (ferrari, mercedes, renault)
# so names like "McLaren Mercedes", "Williams Mercedes", "Aston Martin Aramco Mercedes",
# "Haas Ferrari", "Brawn Mercedes", and "Alpine Renault" resolve to the constructor, NOT the PU supplier!
FAMILY_RESOLVERS: list[tuple[tuple[str, ...], Any]] = [
    (("racing bulls", "vcarb", "toro rosso", "alphatauri", "str "), _resolve_racing_bulls),
    (("red bull", "rbr"), _resolve_red_bull),
    (("mclaren",), _resolve_mclaren),
    (("aston martin",), _resolve_aston),
    (("williams",), _resolve_williams),
    (("alpine",), _resolve_alpine),
    (("audi",), _resolve_audi),
    (("cadillac",), _resolve_cadillac),
    (("haas",), _resolve_haas),
    (("brawn",), _resolve_brawn),
    (("lotus",), _resolve_lotus),
    (("benetton",), _resolve_benetton),
    (("jordan",), _resolve_jordan),
    (("bmw sauber", "sauber bmw"), _resolve_sauber_bmw),
    (("sauber",), _resolve_sauber),
]

# Works PU constructors ONLY match when they are the actual constructor name
# (not when listed as an engine supplier suffix like "Kick Sauber Ferrari", "Force India Mercedes", "Caterham Renault").
WORKS_PREFIX_RESOLVERS: list[tuple[tuple[str, ...], Any]] = [
    (("ferrari", "scuderia ferrari"), _resolve_ferrari),
    (("mercedes",), _resolve_mercedes),
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
    for prefixes, fn in WORKS_PREFIX_RESOLVERS:
        if any(low == p or low.startswith(p + " ") for p in prefixes):
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
