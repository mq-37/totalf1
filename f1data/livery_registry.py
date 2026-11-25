"""
Year-Accurate Formula 1 Team Livery, Paint Finish & Chassis Shape Registry (1950–2026).

Resolves `(team_name, year)` into faithful 5-slot palettes (`main`, `secondary`, `accent`,
`pop`, `detail`), 3D livery pattern styles (`redbull`, `vcarb_2026`, `vcarb_2024`,
`ferrari_hp`, `ferrari_2024`, `merc_arrow`, `williams_2026`, `williams_duracell`,
`audi_slash`, `cadillac_split`, `mclaren_papaya`, `mclaren_marlboro`, `aston_wings`,
`alpine_bwt`, `haas_tgr`, `haas_carbon`, `sauber_kick`, `alfa_romeo`, `bwt_pink`,
`lotus_jps`, `martini_tri`, `renault_mildseven`, `brawn_neon`, `jordan_hornet`,
`modern`, `two-tone`, `racing-stripe`, `chevron`, `classic`), paint finish (`matte`,
`gloss`, `metallic`, `carbon`), and optional 3D motif decals.
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


# =====================================================================
# CONSTRUCTOR FAMILY RESOLVERS (1950–2026, Full 1988–2026 Photo-Audited)
# =====================================================================

def _resolve_red_bull(y: int) -> dict[str, Any]:
    if y >= 2026:
        # 2026 Oracle Red Bull Racing RB22 (Red Bull Ford): High-gloss cobalt blue,
        # sun-yellow nose & airbox with white-outlined crimson charging bull.
        return {
            "palette": {"main": "#0B2168", "secondary": "#E00A2B", "accent": "#FFBE00", "pop": "#FFFFFF", "detail": "#061030"},
            "style": "redbull",
            "finish": "gloss",
            "motif": "bull_nose",
            "label": f"{y} Oracle Red Bull Racing RB22 (Gloss Cobalt Blue, Sun Yellow & Charging Bull)",
        }
    if y >= 2016:
        return {
            "palette": {"main": "#0B1A3C", "secondary": "#DB0A40", "accent": "#FFCC00", "pop": "#FFFFFF", "detail": "#070D1D"},
            "style": "redbull",
            "finish": "matte",
            "motif": "bull_nose",
            "label": f"{y} Red Bull Racing (Matte Navy, Yellow Nose & Crimson Bull)",
        }
    if 2013 <= y <= 2015:
        # Infiniti Red Bull Racing RB9–RB11: Metallic deep navy with signature Infiniti purple sidepods & yellow nose.
        return {
            "palette": {"main": "#14205C", "secondary": "#5B238C", "accent": "#FFCC00", "pop": "#DB0A40", "detail": "#0A1026"},
            "style": "redbull",
            "finish": "metallic",
            "motif": "bull_nose",
            "label": f"{y} Infiniti Red Bull Racing (Metallic Navy, Infiniti Purple & Yellow Bull Nose)",
        }
    return {
        "palette": {"main": "#142254", "secondary": "#DB0A40", "accent": "#FFCC00", "pop": "#FFFFFF", "detail": "#0A1026"},
        "style": "redbull",
        "finish": "metallic",
        "motif": "bull_nose",
        "label": f"{y} Red Bull Racing (Metallic Navy & Yellow Bull Nose)",
    }


def _resolve_ferrari(y: int) -> dict[str, Any]:
    if y >= 2025:
        # 2025 SF-25 & 2026 SF-26: Gloss Rosso Corsa + seamless HP White engine cover & circular HP Blue emblem.
        return {
            "palette": {"main": "#DC0000", "secondary": "#FFFFFF", "accent": "#0052B4", "pop": "#FFEF00", "detail": "#14161C"},
            "style": "ferrari_hp",
            "finish": "gloss",
            "motif": "ferrari_hp_blue",
            "label": f"{y} Scuderia Ferrari HP (Rosso Corsa, White Engine Cover & HP Blue)",
        }
    if y == 2024:
        # 2024 SF-24: Full Matte Rosso Corsa (red engine cover & halo!) + Yellow & White twin pinstripes + HP wing decals.
        return {
            "palette": {"main": "#E0001B", "secondary": "#FFEF00", "accent": "#FFFFFF", "pop": "#0052B4", "detail": "#14161C"},
            "style": "ferrari_2024",
            "finish": "matte",
            "motif": "ferrari_sf24",
            "label": "2024 Scuderia Ferrari SF-24 (Matte Rosso Corsa, Yellow/White Pinstripes & HP)",
        }
    if 2022 <= y <= 2023:
        return {
            "palette": {"main": "#C40018", "secondary": "#14161C", "accent": "#FFEF00", "pop": "#FFFFFF", "detail": "#0D0F14"},
            "style": "modern",
            "finish": "matte",
            "motif": "scuderia",
            "label": f"{y} Scuderia Ferrari (Deep Matte Rosso & Black Wings)",
        }
    if 2019 <= y <= 2021:
        return {
            "palette": {"main": "#C80018", "secondary": "#14161C", "accent": "#FFEF00", "pop": "#FFFFFF", "detail": "#720616"},
            "style": "modern",
            "finish": "matte",
            "motif": "scuderia",
            "label": f"{y} Scuderia Ferrari (Matte Rosso Corsa & Carbon)",
        }
    if y == 2016:
        # 2016 SF16-H: Retro Niki Lauda-inspired white engine cover on gloss Rosso Corsa.
        return {
            "palette": {"main": "#DC0000", "secondary": "#FFFFFF", "accent": "#14161C", "pop": "#FFEF00", "detail": "#8E0B22"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "scuderia",
            "label": "2016 Scuderia Ferrari SF16-H (Rosso Corsa & Retro White Engine Cover)",
        }
    if y in (2015, 2017, 2018):
        return {
            "palette": {"main": "#DC0000", "secondary": "#14161C", "accent": "#FFFFFF", "pop": "#FFEF00", "detail": "#8E0B22"},
            "style": "modern",
            "finish": "gloss",
            "motif": "scuderia",
            "label": f"{y} Scuderia Ferrari (Gloss Rosso Corsa & White/Black Trim)",
        }
    if 2007 <= y <= 2008:
        return {
            "palette": {"main": "#B8001A", "secondary": "#FFFFFF", "accent": "#14161C", "pop": "#FFEF00", "detail": "#6E0412"},
            "style": "two-tone",
            "finish": "metallic",
            "motif": "scuderia",
            "label": f"{y} Scuderia Ferrari (Metallic Candy Rosso Corsa & White)",
        }
    if 1996 <= y <= 2014:
        return {
            "palette": {"main": "#DC0000", "secondary": "#FFFFFF", "accent": "#14161C", "pop": "#FFEF00", "detail": "#8E0B22"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "scuderia",
            "label": f"{y} Scuderia Ferrari (Scarlet Rosso Corsa & White Wings)",
        }
    if 1988 <= y <= 1995:
        # 1988–1995 F1/87-88C, 640, 641, F92A, 412T1/T2: Classic Gloss Rosso Corsa with Black wings & lower skirts.
        return {
            "palette": {"main": "#D4001A", "secondary": "#14161C", "accent": "#FFEF00", "pop": "#FFFFFF", "detail": "#7A0614"},
            "style": "classic",
            "finish": "gloss",
            "motif": "scuderia",
            "label": f"{y} Scuderia Ferrari (Classic Rosso Corsa & Black Wings)",
        }
    if 1982 <= y <= 1985:
        # 126C2 / 126C3 / 126C4 Marlboro turbo era: Rosso Corsa tub & sidepods + iconic WHITE upper deck!
        return {
            "palette": {"main": "#DC0000", "secondary": "#FFFFFF", "accent": "#14161C", "pop": "#FFEF00", "detail": "#8E0B22"},
            "style": "ferrari_white_deck",
            "finish": "gloss",
            "motif": "scuderia",
            "label": f"{y} Scuderia Ferrari (Rosso Corsa & White Marlboro Turbo Deck)",
        }
    if 1975 <= y <= 1987:
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
        # 2026 Mercedes-AMG Petronas W17: Gloss Obsidian Black + Silver Arrow nose & AMG slashes + Petronas Teal.
        return {
            "palette": {"main": "#0F1319", "secondary": "#C8CCCE", "accent": "#00D2BE", "pop": "#FFFFFF", "detail": "#07090D"},
            "style": "merc_arrow",
            "finish": "gloss",
            "motif": "silver_arrow",
            "label": f"{y} Mercedes-AMG Petronas W17 (Obsidian Black, Silver Arrow Slashes & Petronas Teal)",
        }
    if y >= 2024:
        # 2024–2025 W15/W16: Obsidian Carbon + Silver Arrow Nose + Petronas Teal + INEOS Red Roll Hoop.
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
    if y == 2022:
        return {
            "palette": {"main": "#C8CCCE", "secondary": "#1A1E24", "accent": "#27F4D2", "pop": "#E10600", "detail": "#64748B"},
            "style": "merc_arrow",
            "finish": "metallic",
            "motif": "silver_arrow",
            "label": "2022 Mercedes-AMG Petronas W13 (Silver Arrow, Petronas Teal & INEOS Red)",
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
            "label": f"{y} McLaren F1 Team (Matte Papaya Orange & Anthracite Carbon)",
        }
    if 2018 <= y <= 2021:
        return {
            "palette": {"main": "#FF8000", "secondary": "#0059B3", "accent": "#47C7FC", "pop": "#FFFFFF", "detail": "#14171D"},
            "style": "two-tone",
            "finish": "matte",
            "motif": "papaya",
            "label": f"{y} McLaren F1 Team (Papaya Orange & Electric Blue)",
        }
    if y == 2017:
        return {
            "palette": {"main": "#FF5500", "secondary": "#1A1D22", "accent": "#FFFFFF", "pop": "#FFFFFF", "detail": "#0F1216"},
            "style": "two-tone",
            "finish": "matte",
            "motif": "papaya",
            "label": "2017 McLaren Honda MCL32 (Tarocco Orange & Graphite Black)",
        }
    if 2015 <= y <= 2016:
        return {
            "palette": {"main": "#22262E", "secondary": "#101216", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#0F1216"},
            "style": "modern",
            "finish": "metallic",
            "motif": "chrome_arrow",
            "label": f"{y} McLaren Honda (Graphite Metallic & Rocket Red)",
        }
    if 2006 <= y <= 2014:
        return {
            "palette": {"main": "#CFD4DC", "secondary": "#14161B", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#525866"},
            "style": "two-tone",
            "finish": "metallic",
            "motif": "chrome_arrow",
            "label": f"{y} Vodafone McLaren Mercedes (Mirror Chrome Silver & Rocket Red)",
        }
    if 1997 <= y <= 2005:
        return {
            "palette": {"main": "#B8BFC8", "secondary": "#161920", "accent": "#FFFFFF", "pop": "#E10600", "detail": "#4A505C"},
            "style": "two-tone",
            "finish": "metallic",
            "motif": "chrome_arrow",
            "label": f"{y} West McLaren Mercedes (Silver, Obsidian Black & White)",
        }
    if 1974 <= y <= 1996:
        return {
            "palette": {"main": "#F8FAFC", "secondary": "#EE1C25", "accent": "#111318", "pop": "#FFCC00", "detail": "#991B1B"},
            "style": "mclaren_marlboro",
            "finish": "gloss",
            "motif": "marlboro_chevron",
            "label": f"{y} McLaren (Iconic Pearl White & Day-Glo Red Chevron)",
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
    if y == 2021:
        return {
            "palette": {"main": "#0B2466", "secondary": "#00A3E0", "accent": "#FFCC00", "pop": "#FFFFFF", "detail": "#06143A"},
            "style": "chevron",
            "finish": "gloss",
            "motif": "classic",
            "label": "2021 Williams Racing FW43B (Royal Navy, Electric Cyan & Yellow Stripes)",
        }
    if 2019 <= y <= 2020:
        return {
            "palette": {"main": "#F8FAFC", "secondary": "#00A3E0", "accent": "#041E42", "pop": "#FFFFFF", "detail": "#0A1228"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "classic",
            "label": f"{y} ROKiT Williams Racing (White & Electric Sky Blue)",
        }
    if 2014 <= y <= 2018:
        return {
            "palette": {"main": "#F8FAFC", "secondary": "#002366", "accent": "#E10600", "pop": "#38BDF8", "detail": "#1E293B"},
            "style": "martini_tri",
            "finish": "gloss",
            "motif": "martini",
            "label": f"{y} Williams Martini Racing (Pearl White & Tricolour Stripes)",
        }
    if 2006 <= y <= 2013:
        # AT&T / PDVSA Williams FW28–FW35: Deep Royal Navy & Crisp White.
        return {
            "palette": {"main": "#0A1E5E", "secondary": "#F8FAFC", "accent": "#00A3E0", "pop": "#E10600", "detail": "#061238"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "att_williams",
            "label": f"{y} Williams F1 Team (Royal Navy & Crisp White)",
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
        return {
            "palette": {"main": "#00584B", "secondary": "#101418", "accent": "#CEDC00", "pop": "#FFFFFF", "detail": "#003B34"},
            "style": "aston_wings",
            "finish": "matte",
            "motif": "brg_lime",
            "label": f"{y} Aston Martin Aramco Honda AMR26 (Matte British Racing Green & Lime Pinstripe)",
        }
    if y == 2021:
        # 2021 AMR21: Metallic BRG with BWT Pink stripes (switched to Lime in 2022!).
        return {
            "palette": {"main": "#00594F", "secondary": "#101418", "accent": "#F484B8", "pop": "#FFFFFF", "detail": "#003B34"},
            "style": "aston_wings",
            "finish": "metallic",
            "motif": "brg_pink",
            "label": "2021 Aston Martin Cognizant AMR21 (Metallic BRG & BWT Pink Pinstripes)",
        }
    return {
        "palette": {"main": "#00594F", "secondary": "#101418", "accent": "#CEDC00", "pop": "#FFFFFF", "detail": "#003B34"},
        "style": "aston_wings",
        "finish": "metallic",
        "motif": "brg_lime",
        "label": f"{y} Aston Martin Aramco (Metallic British Racing Green & Lime Pinstripes)",
    }


def _resolve_racing_point(y: int) -> dict[str, Any]:
    # 2019–2020 BWT Racing Point RP19 / RP20 ("The Pink Mercedes"): Full Iconic BWT Pink!
    acc = "#0052B4" if y == 2019 else "#FFFFFF"
    return {
        "palette": {"main": "#F484B8", "secondary": "#FFFFFF", "accent": acc, "pop": "#14171D", "detail": "#C94D8B"},
        "style": "bwt_pink",
        "finish": "gloss",
        "motif": "bwt_pink",
        "label": f"{y} BWT Racing Point (Iconic BWT Pink & White/Blue)",
    }


def _resolve_force_india(y: int) -> dict[str, Any]:
    if y >= 2017:
        return {
            "palette": {"main": "#F484B8", "secondary": "#FFFFFF", "accent": "#C8CED6", "pop": "#14171D", "detail": "#C94D8B"},
            "style": "bwt_pink",
            "finish": "gloss",
            "motif": "bwt_pink",
            "label": f"{y} BWT Force India (BWT Pink & Silver)",
        }
    if 2014 <= y <= 2016:
        return {
            "palette": {"main": "#161920", "secondary": "#A8B0BA", "accent": "#FF6B00", "pop": "#009A44", "detail": "#0D0F14"},
            "style": "two-tone",
            "finish": "metallic",
            "motif": "force_india_silver",
            "label": f"{y} Sahara Force India (Black, Metallic Silver & Saffron Orange)",
        }
    if 2009 <= y <= 2013:
        return {
            "palette": {"main": "#F8FAFC", "secondary": "#FF6B00", "accent": "#009A44", "pop": "#FFFFFF", "detail": "#14161A"},
            "style": "chevron",
            "finish": "gloss",
            "motif": "force_india_tri",
            "label": f"{y} Force India (White, Saffron Orange & India Green Tricolour)",
        }
    # 2008 VJM01: White, Gold & Crimson Red
    return {
        "palette": {"main": "#F6F7FA", "secondary": "#C8102E", "accent": "#C9A238", "pop": "#FFFFFF", "detail": "#14161A"},
        "style": "two-tone",
        "finish": "gloss",
        "motif": "force_india_08",
        "label": "2008 Force India VJM01 (White, Crimson Red & Gold)",
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
    return {
        "palette": {"main": "#F2F4F7", "secondary": "#111419", "accent": "#9BA3AE", "pop": "#FFFFFF", "detail": "#1B2028"},
        "style": "cadillac_split",
        "finish": "gloss",
        "motif": "cadillac_crest",
        "label": f"{y} Cadillac Formula 1 Team (Monochrome Pearl White, Silver Fade & Gloss Black)",
    }


def _resolve_racing_bulls(y: int) -> dict[str, Any]:
    if y >= 2025:
        return {
            "palette": {"main": "#F7F8FA", "secondary": "#1434A4", "accent": "#FFBE00", "pop": "#DB0A40", "detail": "#14171D"},
            "style": "vcarb_2026",
            "finish": "gloss",
            "motif": "bull_nose",
            "label": f"{y} Visa Cash App Racing Bulls (Gloss White, Yellow Bull Nose/Airbox & Royal Blue)",
        }
    if y == 2024:
        # 2024 Visa Cash App RB VCARB 01: Metallic Royal Blue, White shoulder flash, Red halo & VISA flank!
        return {
            "palette": {"main": "#1038C8", "secondary": "#F6F7FA", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#11141B"},
            "style": "vcarb_2024",
            "finish": "metallic",
            "motif": "bull_nose",
            "label": "2024 Visa Cash App RB VCARB 01 (Metallic Royal Blue, White & Red Halo)",
        }
    if y == 2023:
        return {
            "palette": {"main": "#132240", "secondary": "#F4F6F9", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#0A1428"},
            "style": "two-tone",
            "finish": "matte",
            "motif": "alphatauri",
            "label": "2023 Scuderia AlphaTauri AT04 (Matte Navy, White & Orlen Red)",
        }
    if 2021 <= y <= 2022:
        return {
            "palette": {"main": "#132240", "secondary": "#F4F6F9", "accent": "#FFFFFF", "pop": "#E10600", "detail": "#0A1428"},
            "style": "two-tone",
            "finish": "matte",
            "motif": "alphatauri",
            "label": f"{y} Scuderia AlphaTauri (Matte Deep Navy & Crisp White)",
        }
    if y == 2020:
        return {
            "palette": {"main": "#F4F6F9", "secondary": "#132240", "accent": "#132240", "pop": "#FFFFFF", "detail": "#0A1428"},
            "style": "two-tone",
            "finish": "matte",
            "motif": "alphatauri",
            "label": "2020 Scuderia AlphaTauri AT01 (Matte Pure White & Deep Navy)",
        }
    if 2017 <= y <= 2019:
        # STR12–STR14: Iconic Metallic Electric Cobalt Blue, Silver Bull & Bright Red accents!
        return {
            "palette": {"main": "#0040B8", "secondary": "#C8D0DC", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#081C54"},
            "style": "chevron",
            "finish": "metallic",
            "motif": "toro_rosso_cobalt",
            "label": f"{y} Scuderia Toro Rosso (Metallic Electric Blue, Silver & Red)",
        }
    # 2006–2016 STR1–STR11: Dark Gloss Navy, Crimson Red Nose & Gold Bull
    return {
        "palette": {"main": "#0D1B4C", "secondary": "#D4AF37", "accent": "#D80A28", "pop": "#FFFFFF", "detail": "#070E28"},
        "style": "chevron",
        "finish": "metallic",
        "motif": "bull_nose",
        "label": f"{y} Scuderia Toro Rosso (Dark Navy, Crimson Nose & Gold Bull)",
    }


def _resolve_sauber_family(y: int) -> dict[str, Any]:
    if y >= 2024:
        # 2024–2025 Stake F1 Team Kick Sauber C44 / C45: Electric Neon Acid Green & Exposed Carbon Black!
        return {
            "palette": {"main": "#00E701", "secondary": "#101318", "accent": "#FFFFFF", "pop": "#00E701", "detail": "#0A0C10"},
            "style": "sauber_kick",
            "finish": "matte",
            "motif": "kick_sauber",
            "label": f"{y} Stake F1 Team Kick Sauber (Neon Acid Green & Exposed Carbon)",
        }
    if y == 2023:
        # 2023 Alfa Romeo C43: Alfa Crimson Red & Exposed Carbon Black
        return {
            "palette": {"main": "#B00C22", "secondary": "#121418", "accent": "#FFFFFF", "pop": "#FFFFFF", "detail": "#0A0C0F"},
            "style": "alfa_romeo",
            "finish": "gloss",
            "motif": "alfa_romeo",
            "label": "2023 Alfa Romeo F1 Team Stake C43 (Alfa Crimson Red & Carbon Black)",
        }
    if y == 2022:
        # 2022 Alfa Romeo C42: Deep Alfa Crimson Red & Crisp Pearl White
        return {
            "palette": {"main": "#A40B20", "secondary": "#F6F7FA", "accent": "#14161A", "pop": "#FFFFFF", "detail": "#5C0612"},
            "style": "alfa_romeo",
            "finish": "gloss",
            "motif": "alfa_romeo",
            "label": "2022 Alfa Romeo F1 Team ORLEN C42 (Alfa Crimson & Pearl White)",
        }
    if 2019 <= y <= 2021:
        # 2019–2021 Alfa Romeo C38/C39/C41: Pearl White & Deep Metallic Alfa Burgundy!
        return {
            "palette": {"main": "#F6F7FA", "secondary": "#8C0A1E", "accent": "#14161A", "pop": "#FFFFFF", "detail": "#4A0510"},
            "style": "alfa_romeo",
            "finish": "gloss",
            "motif": "alfa_romeo",
            "label": f"{y} Alfa Romeo Racing (Pearl White & Deep Alfa Burgundy)",
        }
    if y == 2018:
        return {
            "palette": {"main": "#F6F7FA", "secondary": "#9B0A1F", "accent": "#0B1E4A", "pop": "#FFFFFF", "detail": "#14161A"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "alfa_romeo",
            "label": "2018 Alfa Romeo Sauber C37 (Pearl White, Alfa Burgundy & Navy)",
        }
    if y == 2017:
        return {
            "palette": {"main": "#0B3B8C", "secondary": "#F6F7FA", "accent": "#D4AF37", "pop": "#FFFFFF", "detail": "#072052"},
            "style": "two-tone",
            "finish": "metallic",
            "motif": "sauber_25",
            "label": "2017 Sauber C36 (25th Anniversary Royal Blue, White & Gold)",
        }
    if 2015 <= y <= 2016:
        return {
            "palette": {"main": "#0052A5", "secondary": "#FFD500", "accent": "#FFFFFF", "pop": "#FFFFFF", "detail": "#002F66"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "sauber_brasil",
            "label": f"{y} Sauber F1 Team (Royal Blue & Banco do Brasil Yellow)",
        }
    if 2013 <= y <= 2014:
        return {
            "palette": {"main": "#3B4048", "secondary": "#161920", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#1E222A"},
            "style": "modern",
            "finish": "metallic",
            "motif": "sauber_stealth",
            "label": f"{y} Sauber F1 Team (Stealth Gunmetal Charcoal & Red)",
        }
    if y == 2012:
        # 2012 Sauber C31: Dark Steel-Blue Charcoal engine cover/flanks & Crisp White nose/tub.
        return {
            "palette": {"main": "#1A2237", "secondary": "#F4F6F9", "accent": "#D0021B", "pop": "#FFFFFF", "detail": "#0D1220"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "sauber_c31",
            "label": "2012 Sauber F1 Team C31 (Charcoal Graphite, White & Red)",
        }
    if 2010 <= y <= 2011:
        return {
            "palette": {"main": "#F5F7FA", "secondary": "#242830", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#14161A"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "sauber_white",
            "label": f"{y} Sauber F1 Team (Crisp White, Charcoal & Red)",
        }
    if 2006 <= y <= 2009:
        # BMW Sauber F1.06–F1.09: Crisp BMW Pearl White, Deep BMW Navy/Blue & Red!
        return {
            "palette": {"main": "#F5F7FA", "secondary": "#0B2265", "accent": "#D5001F", "pop": "#FFFFFF", "detail": "#06143D"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "bmw_sauber",
            "label": f"{y} BMW Sauber F1 Team (BMW Pearl White, Deep Navy & Red)",
        }
    if 1995 <= y <= 2005:
        # Red Bull Sauber Petronas C14–C24: Royal Blue, Petronas Turquoise under-sidepod sweep & Crisp White wings!
        return {
            "palette": {"main": "#1530B8", "secondary": "#3EC6C0", "accent": "#FFFFFF", "pop": "#E10600", "detail": "#0A1660"},
            "style": "sauber_petronas",
            "finish": "gloss",
            "motif": "petronas_teal",
            "label": f"{y} Red Bull Sauber Petronas (Royal Blue, Petronas Teal & White)",
        }
    # 1993–1994 Sauber C12 / C13: Iconic Gloss Jet Black Carbon & Crisp White Wings!
    return {
        "palette": {"main": "#0C0D0F", "secondary": "#FFFFFF", "accent": "#D0021B", "pop": "#FFEF00", "detail": "#08090B"},
        "style": "carbon_stealth",
        "finish": "gloss",
        "motif": "c12_black",
        "label": f"{y} Sauber (Concept by Mercedes-Benz C12 Black Carbon & White Elements)",
    }


def _resolve_sauber_bmw(y: int) -> dict[str, Any]:
    # Team-keyed BMW Sauber identity so "Sauber BMW" never bleeds into the Petronas blue era even at y=2005.
    if 2004 <= y <= 2010:
        return {
            "palette": {"main": "#F5F7FA", "secondary": "#0B2265", "accent": "#D5001F", "pop": "#FFFFFF", "detail": "#06143D"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "bmw_sauber",
            "label": f"{y} BMW Sauber F1 Team (BMW Pearl White, Deep Navy & Red)",
        }
    return _resolve_sauber_family(y)


def _resolve_haas(y: int) -> dict[str, Any]:
    if y >= 2026:
        return {
            "palette": {"main": "#F7F8FA", "secondary": "#13161B", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#1B1F26"},
            "style": "haas_tgr",
            "finish": "gloss",
            "motif": "haas_tgr",
            "label": f"{y} TGR Haas F1 Team VF-26 (Gloss White, Haas Red Airbox & GR Engine Cover)",
        }
    if y == 2025:
        return {
            "palette": {"main": "#F6F7F9", "secondary": "#14161A", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#262B33"},
            "style": "modern",
            "finish": "gloss",
            "motif": "haas",
            "label": "2025 MoneyGram Haas F1 Team VF-25 (Gloss White, Carbon Undercut & Haas Red)",
        }
    if y in (2023, 2024):
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
        return {
            "palette": {"main": "#F8FAFC", "secondary": "#0039A6", "accent": "#D52B1E", "pop": "#FFFFFF", "detail": "#1E293B"},
            "style": "martini_tri",
            "finish": "gloss",
            "motif": "haas",
            "label": "2021 Uralkali Haas F1 Team VF-21 (White, Blue & Red Tricolour)",
        }
    if y == 2019:
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
    return {
        "palette": {"main": "#696E77", "secondary": "#181B21", "accent": "#DA291C", "pop": "#F4F5F7", "detail": "#343942"},
        "style": "two-tone",
        "finish": "metallic",
        "motif": "haas",
        "label": f"{y} Haas F1 Team (Gunmetal Grey, Black & Haas Red)",
    }


def _resolve_lotus(y: int) -> dict[str, Any]:
    if 1972 <= y <= 1986 or y >= 2011:
        # 2011 Lotus Renault GP R31 through 2015 Lotus E23 + classic 1972–1986 JPS: Piano Black & Gold!
        return {
            "palette": {"main": "#0E0E10", "secondary": "#D4AF37", "accent": "#FACC15", "pop": "#FFFFFF", "detail": "#070708"},
            "style": "lotus_jps",
            "finish": "gloss",
            "motif": "jps_gold",
            "label": f"{y} Team Lotus (Black & Gold Pinstripe)",
        }
    if 1968 <= y <= 1971:
        # Gold Leaf Team Lotus era: rich metallic gold, red noseband & white accents.
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
    # 2010 Lotus Racing T127 + 1991–1994 Castrol Lotus + 1958–1967 Heritage Lotus: British Racing Green & Yellow!
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
    if 2007 <= y <= 2009:
        # ING Renault R27–R29: White, Vivid ING Orange & Canary Yellow!
        return {
            "palette": {"main": "#F8FAFC", "secondary": "#FF6600", "accent": "#FFCC00", "pop": "#0B1F5C", "detail": "#14161A"},
            "style": "chevron",
            "finish": "gloss",
            "motif": "ing_renault",
            "label": f"{y} ING Renault F1 Team (White, ING Orange & Canary Yellow)",
        }
    if y == 2010:
        return {
            "palette": {"main": "#FFCC00", "secondary": "#111318", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#090A0D"},
            "style": "chevron",
            "finish": "gloss",
            "motif": "renault_yellow",
            "label": "2010 Renault F1 Team R30 (Bumblebee Yellow & Piano Black)",
        }
    return {
        "palette": {"main": "#FFCC00", "secondary": "#111318", "accent": "#FFFFFF", "pop": "#FDE047", "detail": "#090A0D"},
        "style": "two-tone",
        "finish": "matte",
        "motif": "renault_yellow",
        "label": f"{y} Renault F1 Team (Matte Yellow & Black)",
    }


def _resolve_brawn(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#F8FAFC", "secondary": "#111318", "accent": "#D8FF00", "pop": "#FFFFFF", "detail": "#334155"},
        "style": "brawn_neon",
        "finish": "gloss",
        "motif": "brawn_09",
        "label": "2009 Brawn GP BGP 001 (Pearl White, Neon Chartreuse & Black)",
    }


def _resolve_bar(y: int) -> dict[str, Any]:
    if y == 1999:
        return {
            "palette": {"main": "#F8FAFC", "secondary": "#0052B4", "accent": "#DC0018", "pop": "#FFCC00", "detail": "#14161A"},
            "style": "chevron",
            "finish": "gloss",
            "motif": "bar_zipper",
            "label": "1999 BAR 01 (Iconic Lucky Strike / 555 Zipper Split)",
        }
    # 2000–2005 BAR Honda 002–007: Lucky Strike Pearl White, Crimson Red & Black!
    return {
        "palette": {"main": "#F8FAFC", "secondary": "#14161A", "accent": "#DC0018", "pop": "#FFFFFF", "detail": "#1E222A"},
        "style": "chevron",
        "finish": "gloss",
        "motif": "bar_lucky_strike",
        "label": f"{y} BAR Honda (Lucky Strike Pearl White, Crimson Red & Black)",
    }


def _resolve_honda(y: int) -> dict[str, Any]:
    if y == 2008:
        return {
            "palette": {"main": "#F8FAFC", "secondary": "#1A73C8", "accent": "#2CA048", "pop": "#FFFFFF", "detail": "#0E2448"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "honda_earth",
            "label": "2008 Honda Racing RA108 (White & Earth Dreams Blue/Green)",
        }
    if y == 2007:
        return {
            "palette": {"main": "#124E8C", "secondary": "#228B4A", "accent": "#F8FAFC", "pop": "#FFFFFF", "detail": "#0A1424"},
            "style": "modern",
            "finish": "gloss",
            "motif": "honda_earth",
            "label": "2007 Honda Racing RA107 (Earth Dreams Ocean Blue & Emerald)",
        }
    # 2006 RA106 & 1960s RA272/RA300: Championship Japanese Racing White & Crimson Red!
    return {
        "palette": {"main": "#F8FAFC", "secondary": "#14161A", "accent": "#DC0018", "pop": "#FFFFFF", "detail": "#1E222A"},
        "style": "chevron",
        "finish": "gloss",
        "motif": "honda_white",
        "label": f"{y} Honda Racing F1 (Championship White & Crimson Red)",
    }


def _resolve_toyota(y: int) -> dict[str, Any]:
    # 2002–2009 Panasonic Toyota Racing TF102–TF109: Pearl White, Bold Toyota Red Nose/Slashes & Panasonic Blue!
    return {
        "palette": {"main": "#F8FAFC", "secondary": "#E00A1E", "accent": "#0040A8", "pop": "#FFFFFF", "detail": "#14161A"},
        "style": "mclaren_marlboro",
        "finish": "gloss",
        "motif": "toyota_panasonic",
        "label": f"{y} Panasonic Toyota Racing (Pearl White, Toyota Red & Panasonic Blue)",
    }


def _resolve_super_aguri(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#F8FAFC", "secondary": "#E10600", "accent": "#14161A", "pop": "#FFFFFF", "detail": "#1E222A"},
        "style": "racing-stripe",
        "finish": "gloss",
        "motif": "super_aguri",
        "label": f"{y} Super Aguri F1 Team (Japanese Racing White & Crimson Red)",
    }


def _resolve_jaguar(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#005A36", "secondary": "#F8FAFC", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#003620"},
        "style": "classic",
        "finish": "metallic",
        "motif": "jaguar_brg",
        "label": f"{y} Jaguar Racing (Metallic British Racing Green & HSBC White)",
    }


def _resolve_stewart(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#F8FAFC", "secondary": "#CC0018", "accent": "#006B38", "pop": "#FFFFFF", "detail": "#0B1F5C"},
        "style": "racing-stripe",
        "finish": "gloss",
        "motif": "stewart_tartan",
        "label": f"{y} Stewart Grand Prix (Gloss Pure White & Royal Stewart Tartan)",
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
    if 1991 <= y <= 1993:
        return {
            "palette": {"main": "#FFCC00", "secondary": "#008C45", "accent": "#0047AB", "pop": "#FFFFFF", "detail": "#111827"},
            "style": "chevron",
            "finish": "gloss",
            "motif": "camel_benetton",
            "label": f"{y} Camel Benetton Ford (Camel Yellow & Emerald Green)",
        }
    return {
        "palette": {"main": "#008C45", "secondary": "#FFCC00", "accent": "#E10600", "pop": "#2563EB", "detail": "#111827"},
        "style": "chevron",
        "finish": "gloss",
        "motif": "united_colors",
        "label": f"{y} Benetton Formula (United Colors Green, Yellow, Red & Blue)",
    }


def _resolve_jordan(y: int) -> dict[str, Any]:
    if y == 1991:
        # 1991 Jordan 191: Iconic 7UP Emerald Green, Royal Blue Sidepods & Neon Lime trim!
        return {
            "palette": {"main": "#009E49", "secondary": "#00449E", "accent": "#A8E000", "pop": "#FFFFFF", "detail": "#005E2B"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "jordan_7up",
            "label": "1991 7UP Jordan 191 (Emerald Green, Royal Blue & Lime)",
        }
    if y == 1992:
        return {
            "palette": {"main": "#0047AB", "secondary": "#F8FAFC", "accent": "#009E49", "pop": "#FFFFFF", "detail": "#07245C"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "jordan_sasol",
            "label": "1992 Sasol Jordan Yamaha 192 (Royal Blue, White & Green)",
        }
    if 1993 <= y <= 1995:
        return {
            "palette": {"main": "#F6F7FA", "secondary": "#0052B4", "accent": "#E10600", "pop": "#009E49", "detail": "#0B245C"},
            "style": "racing-stripe",
            "finish": "gloss",
            "motif": "jordan_sasol",
            "label": f"{y} Sasol/Total Jordan (White, Royal Blue & Red/Green)",
        }
    if y == 1996:
        return {
            "palette": {"main": "#C9A238", "secondary": "#111318", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#715610"},
            "style": "two-tone",
            "finish": "metallic",
            "motif": "jordan_gold",
            "label": "1996 B&H Jordan Peugeot 196 (Metallic Gold & Black)",
        }
    return {
        "palette": {"main": "#FFCC00", "secondary": "#111318", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#713F12"},
        "style": "jordan_hornet",
        "finish": "gloss",
        "motif": "hornet",
        "label": f"{y} Jordan Grand Prix (Buzzin' Hornets Yellow & Black Nose)",
    }


def _resolve_arrows_footwork(y: int) -> dict[str, Any]:
    if 2000 <= y <= 2002:
        # Orange Arrows A21–A23: Vibrant Orange & Gloss Black!
        return {
            "palette": {"main": "#FF6B00", "secondary": "#101216", "accent": "#FFFFFF", "pop": "#FFCC00", "detail": "#090A0D"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "arrows_orange",
            "label": f"{y} Orange Arrows (Vibrant Orange & Gloss Black)",
        }
    if 1998 <= y <= 1999:
        return {
            "palette": {"main": "#111318", "secondary": "#F8FAFC", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#08090C"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "arrows_black",
            "label": f"{y} Arrows (Gloss Black & Crisp White)",
        }
    if y == 1997:
        return {
            "palette": {"main": "#0052B4", "secondary": "#F8FAFC", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#08245C"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "arrows_danka",
            "label": "1997 Danka Arrows Yamaha A18 (Royal Blue & White)",
        }
    if y == 1996:
        return {
            "palette": {"main": "#F8FAFC", "secondary": "#0052B4", "accent": "#FF6B00", "pop": "#FFFFFF", "detail": "#0B225C"},
            "style": "chevron",
            "finish": "gloss",
            "motif": "footwork",
            "label": "1996 Footwork Hart FA17 (White, Royal Blue & Orange)",
        }
    if 1991 <= y <= 1995:
        return {
            "palette": {"main": "#F6F7FA", "secondary": "#DA121A", "accent": "#14161A", "pop": "#FFFFFF", "detail": "#7A0810"},
            "style": "chevron",
            "finish": "gloss",
            "motif": "footwork",
            "label": f"{y} Footwork (White & Crimson Red)",
        }
    # 1988–1990 USF&G Arrows
    return {
        "palette": {"main": "#F8FAFC", "secondary": "#0B2366", "accent": "#DA121A", "pop": "#FFFFFF", "detail": "#14161A"},
        "style": "racing-stripe",
        "finish": "gloss",
        "motif": "arrows_usfg",
        "label": f"{y} USF&G Arrows (White, Navy & Red)",
    }


def _resolve_tyrrell(y: int) -> dict[str, Any]:
    if 1997 <= y <= 1998:
        return {
            "palette": {"main": "#F6F7FA", "secondary": "#14161B", "accent": "#0052B4", "pop": "#FFFFFF", "detail": "#1E222A"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "tyrrell_piaa",
            "label": f"{y} PIAA Tyrrell Ford (White & Gloss Black)",
        }
    if 1994 <= y <= 1996:
        return {
            "palette": {"main": "#F6F7FA", "secondary": "#0D3B94", "accent": "#00A3E0", "pop": "#FFFFFF", "detail": "#082054"},
            "style": "racing-stripe",
            "finish": "gloss",
            "motif": "tyrrell_nokia",
            "label": f"{y} Nokia Tyrrell Yamaha (White & Deep Blue)",
        }
    if y == 1991:
        return {
            "palette": {"main": "#14161B", "secondary": "#F4F6F9", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#0A0C0F"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "tyrrell_braun",
            "label": "1991 Braun Tyrrell Honda 020 (Gloss Black & White)",
        }
    if y >= 1988:
        return {
            "palette": {"main": "#F6F7FA", "secondary": "#00449E", "accent": "#FFCC00", "pop": "#FFFFFF", "detail": "#082054"},
            "style": "racing-stripe",
            "finish": "gloss",
            "motif": "tyrrell",
            "label": f"{y} Tyrrell (White & Tyrrell Blue)",
        }
    return {
        "palette": {"main": "#00449E", "secondary": "#FFFFFF", "accent": "#FFCC00", "pop": "#FFFFFF", "detail": "#082054"},
        "style": "racing-stripe",
        "finish": "gloss",
        "motif": "tyrrell",
        "label": f"{y} Tyrrell Racing (Elf Blue & White)",
    }


def _resolve_ligier_prost(y: int) -> dict[str, Any]:
    if y >= 1997:
        return {
            "palette": {"main": "#1242A8", "secondary": "#F8FAFC", "accent": "#00A3E0", "pop": "#FFFFFF", "detail": "#08225C"},
            "style": "racing-stripe",
            "finish": "metallic",
            "motif": "prost_blue",
            "label": f"{y} Prost Grand Prix (Metallic Gauloises French Racing Blue)",
        }
    return {
        "palette": {"main": "#0052B4", "secondary": "#F8FAFC", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#082860"},
        "style": "racing-stripe",
        "finish": "gloss",
        "motif": "ligier_blue",
        "label": f"{y} Equipe Ligier (Gitanes French Racing Blue & White)",
    }


def _resolve_minardi(y: int) -> dict[str, Any]:
    if 2001 <= y <= 2005:
        return {
            "palette": {"main": "#121418", "secondary": "#F4F6F9", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#08090C"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "minardi_black",
            "label": f"{y} Minardi (Stoddart Gloss Black & White)",
        }
    if y == 2000:
        return {
            "palette": {"main": "#E8FF00", "secondary": "#0B2260", "accent": "#FFFFFF", "pop": "#FFFFFF", "detail": "#06143A"},
            "style": "chevron",
            "finish": "gloss",
            "motif": "minardi_telefonica",
            "label": "2000 Telefónica Minardi M02 (Fluorescent Yellow & Navy)",
        }
    if 1998 <= y <= 1999:
        return {
            "palette": {"main": "#AEB6C2", "secondary": "#0D2460", "accent": "#FFFFFF", "pop": "#FFCC00", "detail": "#4A5260"},
            "style": "two-tone",
            "finish": "metallic",
            "motif": "minardi_silver",
            "label": f"{y} Minardi (Metallic Silver & Deep Navy)",
        }
    if 1993 <= y <= 1997:
        return {
            "palette": {"main": "#F6F7FA", "secondary": "#14161A", "accent": "#0052B4", "pop": "#FFCC00", "detail": "#1E222A"},
            "style": "racing-stripe",
            "finish": "gloss",
            "motif": "minardi_white",
            "label": f"{y} Minardi (White, Black & Blue/Yellow)",
        }
    # 1988–1992 Classic Black & Yellow Minardi!
    return {
        "palette": {"main": "#121418", "secondary": "#FFCC00", "accent": "#F8FAFC", "pop": "#FFFFFF", "detail": "#08090C"},
        "style": "racing-stripe",
        "finish": "gloss",
        "motif": "minardi_classic",
        "label": f"{y} Minardi (Classic Gloss Black & Yellow)",
    }


def _resolve_march_leyton(y: int) -> dict[str, Any]:
    if y == 1992:
        return {
            "palette": {"main": "#24B4B8", "secondary": "#F8FAFC", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#0E5A5E"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "leyton_house",
            "label": "1992 March Ilmor CG911B (Turquoise, White & Red)",
        }
    if 1987 <= y <= 1991:
        # 1988–1991 March 881 / 891 / Leyton House CG901 / CG911: Iconic Miami Coral Turquoise!
        return {
            "palette": {"main": "#24B4B8", "secondary": "#14161A", "accent": "#FFFFFF", "pop": "#FFFFFF", "detail": "#0E5A5E"},
            "style": "classic",
            "finish": "gloss",
            "motif": "leyton_house",
            "label": f"{y} Leyton House March (Iconic Miami Coral Turquoise)",
        }
    return {
        "palette": {"main": "#DA291C", "secondary": "#FFFFFF", "accent": "#14161A", "pop": "#FFFFFF", "detail": "#7A0F08"},
        "style": "classic",
        "finish": "gloss",
        "motif": "march_classic",
        "label": f"{y} March Engineering",
    }


def _resolve_caterham(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#006B38", "secondary": "#FFCC00", "accent": "#FFFFFF", "pop": "#FFFFFF", "detail": "#003D20"},
        "style": "classic",
        "finish": "metallic",
        "motif": "caterham_green",
        "label": f"{y} Caterham F1 Team (Metallic Emerald Green & Yellow)",
    }


def _resolve_manor_mrt(y: int) -> dict[str, Any]:
    # 2016 Manor Racing MRT05: Iconic Sky Blue, Neon Coral-Orange & Crisp White!
    return {
        "palette": {"main": "#0095E8", "secondary": "#FF4D24", "accent": "#F8FAFC", "pop": "#FFFFFF", "detail": "#14161A"},
        "style": "two-tone",
        "finish": "gloss",
        "motif": "manor_mrt05",
        "label": f"{y} Manor Racing MRT05 (Sky Blue, Neon Coral-Orange & White)",
    }


def _resolve_marussia_virgin(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#C8001A", "secondary": "#111318", "accent": "#FFFFFF", "pop": "#FFFFFF", "detail": "#6A000E"},
        "style": "two-tone",
        "finish": "gloss",
        "motif": "marussia_red",
        "label": f"{y} Marussia / Virgin Racing (Gloss Crimson Red & Black)",
    }


def _resolve_hrt(y: int) -> dict[str, Any]:
    if y == 2012:
        return {
            "palette": {"main": "#F6F7FA", "secondary": "#D4AF37", "accent": "#C8102E", "pop": "#FFFFFF", "detail": "#1E222A"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "hrt_gold",
            "label": "2012 HRT F112 (White, Gold & Crimson Red)",
        }
    if y == 2011:
        return {
            "palette": {"main": "#F6F7FA", "secondary": "#14161A", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#333A44"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "hrt_white",
            "label": "2011 HRT F111 (White, Black & Red)",
        }
    return {
        "palette": {"main": "#484E56", "secondary": "#14161A", "accent": "#E10600", "pop": "#F6F7FA", "detail": "#22262C"},
        "style": "modern",
        "finish": "metallic",
        "motif": "hrt_grey",
        "label": "2010 Hispania Racing F110 (Gunmetal Grey & Red)",
    }


def _resolve_spyker(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#FF5A00", "secondary": "#8C929C", "accent": "#14161A", "pop": "#FFFFFF", "detail": "#8A3000"},
        "style": "chevron",
        "finish": "gloss",
        "motif": "spyker_orange",
        "label": "2007 Etihad Aldar Spyker F8-VII (Dutch Vivid Orange & Silver)",
    }


def _resolve_mf1(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#D4001A", "secondary": "#F4F6F9", "accent": "#2A2E35", "pop": "#FFFFFF", "detail": "#14161A"},
        "style": "two-tone",
        "finish": "gloss",
        "motif": "mf1_midland",
        "label": "2006 MF1 Racing M16 (Midland Red, White & Charcoal)",
    }


def _resolve_brabham(y: int) -> dict[str, Any]:
    if y >= 1989:
        return {
            "palette": {"main": "#0B1F5C", "secondary": "#F8FAFC", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#061238"},
            "style": "racing-stripe",
            "finish": "gloss",
            "motif": "brabham_navy",
            "label": f"{y} Brabham (Deep Navy & Crisp White)",
        }
    return {
        "palette": {"main": "#1E3C8C", "secondary": "#FFFFFF", "accent": "#D5001F", "pop": "#8FA6E8", "detail": "#101E4E"},
        "style": "racing-stripe",
        "finish": "gloss",
        "motif": "brabham_classic",
        "label": f"{y} Brabham (Blue, White & Red)",
    }


def _resolve_dallara(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#C4001E", "secondary": "#F8FAFC", "accent": "#14161A", "pop": "#FFFFFF", "detail": "#6A0010"},
        "style": "two-tone",
        "finish": "gloss",
        "motif": "dallara_bms",
        "label": f"{y} BMS Scuderia Italia Dallara (Crimson Red & White)",
    }


def _resolve_larrousse_lola_venturi(y: int) -> dict[str, Any]:
    if y == 1994:
        return {
            "palette": {"main": "#007A3D", "secondary": "#F8FAFC", "accent": "#E10600", "pop": "#FFFFFF", "detail": "#004724"},
            "style": "two-tone",
            "finish": "gloss",
            "motif": "larrousse_tourtel",
            "label": "1994 Tourtel Larrousse Ford LH94 (Emerald Green & White)",
        }
    if y == 1992:
        return {
            "palette": {"main": "#1DA1C8", "secondary": "#F8FAFC", "accent": "#14161A", "pop": "#FFFFFF", "detail": "#0D5A72"},
            "style": "classic",
            "finish": "metallic",
            "motif": "venturi_blue",
            "label": "1992 Central Park Venturi Lamborghini (Metallic Venturi Turquoise & White)",
        }
    return {
        "palette": {"main": "#123C8F", "secondary": "#F8FAFC", "accent": "#E10600", "pop": "#FFCC00", "detail": "#082052"},
        "style": "two-tone",
        "finish": "gloss",
        "motif": "lola_larrousse",
        "label": f"{y} Larrousse Lola (Deep Royal Blue, White & Red)",
    }


def _resolve_rial(y: int) -> dict[str, Any]:
    return {
        "palette": {"main": "#1A4DB8", "secondary": "#F8FAFC", "accent": "#14161A", "pop": "#FFFFFF", "detail": "#0D2B6E"},
        "style": "chevron",
        "finish": "gloss",
        "motif": "rial_blue",
        "label": f"{y} Rial Racing (Cobalt Blue & White)",
    }


# IMPORTANT: Customer constructors MUST come BEFORE works engine suppliers (ferrari, mercedes, renault, honda, toyota)
# so names like "McLaren Mercedes", "Williams Toyota", "BAR Honda", "Haas Ferrari", "Brawn Mercedes",
# "Kick Sauber Ferrari", and "Alpine Renault" resolve to the constructor, NOT the PU supplier!
FAMILY_RESOLVERS: list[tuple[tuple[str, ...], Any]] = [
    (("racing bulls", "vcarb", "rb honda", "toro rosso", "alphatauri", "str "), _resolve_racing_bulls),
    (("red bull", "rbr"), _resolve_red_bull),
    (("mclaren",), _resolve_mclaren),
    (("aston martin",), _resolve_aston),
    (("racing point",), _resolve_racing_point),
    (("force india",), _resolve_force_india),
    (("williams",), _resolve_williams),
    (("alpine",), _resolve_alpine),
    (("audi",), _resolve_audi),
    (("cadillac",), _resolve_cadillac),
    (("haas",), _resolve_haas),
    (("bmw sauber", "sauber bmw"), _resolve_sauber_bmw),
    (("kick sauber", "alfa romeo", "sauber"), _resolve_sauber_family),
    (("brawn",), _resolve_brawn),
    (("bar ",), _resolve_bar),
    (("super aguri",), _resolve_super_aguri),
    (("jaguar",), _resolve_jaguar),
    (("stewart",), _resolve_stewart),
    (("lotus",), _resolve_lotus),
    (("benetton",), _resolve_benetton),
    (("jordan",), _resolve_jordan),
    (("arrows", "footwork"), _resolve_arrows_footwork),
    (("tyrrell",), _resolve_tyrrell),
    (("ligier", "prost"), _resolve_ligier_prost),
    (("minardi",), _resolve_minardi),
    (("leyton house", "march"), _resolve_march_leyton),
    (("caterham",), _resolve_caterham),
    (("mrt ", "manor"), _resolve_manor_mrt),
    (("marussia", "virgin"), _resolve_marussia_virgin),
    (("hrt ",), _resolve_hrt),
    (("spyker",), _resolve_spyker),
    (("mf1", "midland"), _resolve_mf1),
    (("brabham",), _resolve_brabham),
    (("dallara",), _resolve_dallara),
    (("larrousse", "lola", "venturi"), _resolve_larrousse_lola_venturi),
    (("rial",), _resolve_rial),
]

# Works PU constructors ONLY match when they are the actual constructor name
# (not when listed as an engine supplier suffix like "Kick Sauber Ferrari", "BAR Honda", "Williams Toyota").
WORKS_PREFIX_RESOLVERS: list[tuple[tuple[str, ...], Any]] = [
    (("ferrari", "scuderia ferrari"), _resolve_ferrari),
    (("mercedes",), _resolve_mercedes),
    (("renault",), _resolve_renault),
    (("honda",), _resolve_honda),
    (("toyota",), _resolve_toyota),
]


def resolve_team_livery(team_name: str | None, year: int | str | None = 2026) -> dict[str, Any]:
    """Return year-accurate 5-slot palette, 3D livery style, paint finish & chassis motif."""
    low = _norm(team_name)
    y = _yr(year)
    for keys, fn in FAMILY_RESOLVERS:
        if any((k in low) or (k.endswith(" ") and low == k.strip()) for k in keys):
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
