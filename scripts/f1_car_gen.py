#!/usr/bin/env python3
"""Generate recoloured F1 car SVGs from the Inkport side-profile art (v2).

Source art: docs/NewF1Car-SVG.md (16 flat-colour rect layers, viewBox 320x159).

Layer model (document paint order, disjoint pixel regions)
----------------------------------------------------------
    outline-0    #171818  ink: crevices, text, shadows -> team-tinted ink
    shade-1      #343434  deep dark panels             -> derived from main
    highlight-2  #ffffff  bright panels + tyre lettering -> main-light tint
    outline-3    #040202  deep ink (tyres)             -> kept black
    gold-4       #fdad03  SECONDARY mass (nose, wing)   <- team colour 2
    paint-5      #1d2f86  MAIN bodywork mass            <- team colour 1
    gold-6       #c77b15  secondary shadow              -> secondary * 0.79
    body-7       #7b410c  secondary deep                -> secondary * 0.48
    body-8       #3c2207  secondary deepest             -> secondary * 0.24
    shade-9      #b8adc0  light panels                  -> main-light mid
    paint-10     #8b7b1c  secondary mid detail          -> secondary * 0.60
    body-11      #d83939  ACCENT (swoosh, wing band)    <- team colour 3
    paint-12     #5c73a1  DETAIL (cool light details)   <- team colour 5
    paint-13     #0d6a1b  leaf detail                   -> main dark tint
    paint-14     #44871d  leaf detail 2                 -> main dark tint 2
    gold-15      #fffa02  POP (tiny highlights)         <- team colour 4

Team palette = 5 colours: [main, secondary, accent, pop, detail].
Bodywork/tonal layers are derived so the car reads as a team livery while
keeping its 3D depth. Tyres (two measured wheel discs) always get fixed
neutral rubber tones; rim accents inside the discs stay team-coloured.

Usage
-----
    python3 scripts/f1_car_gen.py --preview out.png     # all teams contact sheet
    python3 scripts/f1_car_gen.py --svg static/cars     # write per-team SVGs
    python3 scripts/f1_car_gen.py --png static/cars/png # print PNGs (scale 3)
    python3 scripts/f1_car_gen.py --derive-palettes     # rebuild all-team palettes
"""
from __future__ import annotations

import colorsys
import json
import re
import sys
from pathlib import Path

TRAf1 = Path(__file__).resolve().parent.parent
ROOT = TRAf1.parent                      # "f1 sim" project root
SRC_SVG = ROOT / "docs" / "NewF1Car-SVG.md"
PALETTES = TRAf1 / "data" / "team_car_palettes.json"

# palette slots (document order of the accent layers they feed)
SLOT = {"paint-5": "main", "gold-4": "secondary", "body-11": "accent",
        "gold-15": "pop", "paint-12": "detail"}

# fixed ink for deep outline layer
INK_LAYER = "outline-3"
INK = "#040202"

# Tyres stay black in every livery: rects inside these discs are the rubber
# (measured off the source art; near-side + far-side wheel outer discs).
WHEEL_DISCS = [(113, 115, 32), (280, 68, 25)]

# Fixed rubber tones inside the discs, per layer. highlight-2 stays near-white
# so the GOODYEAR lettering survives recolouring; paint-5/gold-4 are rim
# accents and keep the team colours.
TYRE_FILLS = {
    "outline-0": "#0b0a10",
    "outline-3": "#040202",
    "shade-1": "#1a1b1e",
    "gold-6": "#26272b",
    "body-7": "#1a1b1e",
    "body-8": "#101214",
    "shade-9": "#323338",
    "highlight-2": "#f2f2f4",
}

# filled in by load_layers()
ART_ORDER: list[str] = []
ART_W, ART_H = 320, 159

_team_ink = ["#171818"]  # set per team inside recolor_svg()


def load_layers() -> dict[str, list[tuple[int, int, int, int]]]:
    global ART_ORDER, ART_W, ART_H
    svg = SRC_SVG.read_text()
    vb = re.search(r'viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"', svg)
    ART_W, ART_H = int(float(vb.group(3))), int(float(vb.group(4)))
    parts = re.split(r'(<g id=")', svg)
    layers: dict[str, list] = {}
    order: list[str] = []
    for i in range(1, len(parts), 2):
        m = re.match(r'([^"]+)"', parts[i + 1])
        if not m:
            continue
        lid = m.group(1)
        rects = [(int(float(x)), int(float(y)), int(float(w)), int(float(h)))
                 for x, y, w, h in re.findall(
                     r'<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"',
                     parts[i + 1])]
        layers[lid] = rects
        order.append(lid)
    ART_ORDER = order
    return layers


def hsv(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return colorsys.rgb_to_hsv(r, g, b)


def hexc(h: float, s: float, v: float) -> str:
    r, g, b = colorsys.hsv_to_rgb(h % 1.0, min(1.0, s), min(1.0, v))
    return f"#{round(r*255):02x}{round(g*255):02x}{round(b*255):02x}"


def derive_layer_tones(palette: dict[str, str]) -> dict[str, str]:
    """Tonal layers derived from the team's main/secondary colours."""
    hm, sm, vm = hsv(palette["main"])
    hs, ss, vs = hsv(palette["secondary"])
    return {
        "outline-0": hexc(hm, min(1.0, sm), 0.10 + 0.06 * vm),   # team ink
        "shade-1": hexc(hm, min(1.0, sm * 0.70), 0.16 + 0.14 * vm),
        "highlight-2": hexc(hm, sm * 0.10, 0.93),
        "gold-6": hexc(hs, min(1.0, ss * 1.05), vs * 0.79),
        "body-7": hexc(hs, min(1.0, ss * 1.10), vs * 0.48),
        "body-8": hexc(hs, min(1.0, ss * 1.15), vs * 0.24),
        "shade-9": hexc(hm, sm * 0.20, 0.72),
        "paint-10": hexc(hs, ss * 0.80, vs * 0.60),
        "paint-13": hexc(hm, sm * 0.9, 0.30),
        "paint-14": hexc(hm, sm * 0.7, 0.48),
    }


def team_colors(palette: dict[str, str]) -> dict[str, str]:
    """Full layer colour map for one team palette."""
    out = {lid: INK for lid in (INK_LAYER,)}
    out.update(derive_layer_tones(palette))
    for layer, slot in SLOT.items():
        out[layer] = palette[slot]
    return out


def recolor_svg(layers: dict, colors: dict[str, str]) -> str:
    """Emit the standalone SVG with each layer's fills replaced.

    Rects inside the wheel discs get fixed rubber tones so the tyres stay
    black in every livery (rim accents keep the team colours).
    """
    global _team_ink
    _team_ink = [colors.get("outline-0", "#171818")]
    svg = SRC_SVG.read_text()
    svg = re.sub(r'^<!--.*?-->\s*', '', svg, flags=re.S)          # strip md wrapper comment
    svg = re.sub(r'^<div[^>]*>|</div>$', '', svg, flags=re.M)     # strip embed div
    for lid in ART_ORDER:
        chunk_re = re.compile(
            r'(<g id="' + lid + r'".*?)(?=<g id="|</svg>)', re.S)

        def repl(m, _lid=lid):
            return _apply_tyres(m.group(1), _lid, colors[_lid])

        svg = chunk_re.sub(repl, svg, count=1)
    return svg.strip()


def _apply_tyres(chunk: str, lid: str, layer_color: str) -> str:
    """Recolour rects inside wheel discs to fixed rubber tones; team colour elsewhere."""
    tyre = TYRE_FILLS.get(lid)

    def per_rect(m):
        tag = m.group(0)
        x = float(re.search(r'x="([\d.]+)"', tag).group(1))
        y = float(re.search(r'y="([\d.]+)"', tag).group(1))
        w = float(re.search(r'width="([\d.]+)"', tag).group(1))
        h = float(re.search(r'height="([\d.]+)"', tag).group(1))
        cx, cy = x + w / 2, y + h / 2
        in_disc = any((cx - wx) ** 2 + (cy - wy) ** 2 <= wr * wr
                      for wx, wy, wr in WHEEL_DISCS)
        fill = tyre if (in_disc and tyre) else layer_color
        return tag.replace(re.search(r'fill="[^"]*"', tag).group(0), f'fill="{fill}"')

    return re.sub(r'<rect [^>]*/>', per_rect, chunk)


def load_palettes() -> dict[str, dict[str, str]]:
    """Palettes from data/team_car_palettes.json (shared loader)."""
    sys.path.insert(0, str(TRAf1))
    from f1data.f1_car_palettes import load_palettes as _load
    return _load()


# ---------------------------------------------------------------- rendering
def _render_grid(layers, colors):
    """Painted index grid + palette; shared by PNG renderers."""
    grid = [bytearray(ART_W) for _ in range(ART_H)]
    pal = [colors[k] for k in ART_ORDER] + list(TYRE_FILLS.values())
    idx = {c: i + 1 for i, c in enumerate(pal)}
    tyre_pi = {lid: len(pal) - len(TYRE_FILLS) + i
               for i, lid in enumerate(TYRE_FILLS)}
    for lid in ART_ORDER:
        for x, y, w, h in layers[lid]:
            pi = idx[colors[lid]]
            if lid in TYRE_FILLS:
                cx, cy = x + w / 2, y + h / 2
                if any((cx - wx) ** 2 + (cy - wy) ** 2 <= wr * wr
                       for wx, wy, wr in WHEEL_DISCS):
                    pi = tyre_pi[lid]
            for yy in range(max(0, y), min(ART_H, y + h)):
                row = grid[yy]
                for xx in range(max(0, x), min(ART_W, x + w)):
                    row[xx] = pi
    return grid, pal


def render_png(layers, colors, path, scale=3, bg=None):
    """Rasterise a team car to PNG. Transparent background unless bg given."""
    import zlib, struct
    grid, pal = _render_grid(layers, colors)
    rgb = [tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in pal]

    out = []
    for yy in range(0, ART_H, scale):
        row = []
        for xx in range(0, ART_W, scale):
            pi = grid[yy][xx]
            if pi:
                px = rgb[pi - 1] + (255,)
            elif bg:
                px = bg + (255,)
            else:
                px = (0, 0, 0, 0)
            row.append(px)
        out.append(row)

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)

    h_, w_ = len(out), len(out[0])
    raw = b"".join(b"\x00" + b"".join(bytes(p) for p in r) for r in out)
    data = (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w_, h_, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6))
            + chunk(b"IEND", b""))
    Path(path).write_bytes(data)


def preview(layers, palettes, out, columns=4, scale=2):
    """Contact sheet PNG: one car per team, rows top-to-bottom."""
    import zlib, struct
    names = list(palettes)
    cars = []
    for name in names:
        colors = team_colors(palettes[name])
        grid, pal = _render_grid(layers, colors)
        rgb = [tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in pal]
        img = [[rgb[grid[y][x] - 1] if grid[y][x] else (252, 252, 252)
                for x in range(0, ART_W, scale)] for y in range(0, ART_H, scale)]
        cars.append(img)

    cw, ch = len(cars[0][0]), len(cars[0])
    rows = (len(cars) + columns - 1) // columns
    sheet = []
    for r in range(rows):
        band = []
        for yy in range(ch):
            band.append([px for c in cars[r * columns:(r + 1) * columns]
                         for px in c[yy]])
        sheet.extend(band)
        sheet.append([(230, 232, 236)] * (cw * columns))

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)

    h_, w_ = len(sheet), len(sheet[0])
    raw = b"".join(b"\x00" + b"".join(bytes(p) for p in r) for r in sheet)
    data = (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w_, h_, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6))
            + chunk(b"IEND", b""))
    Path(out).write_bytes(data)
    print(f"preview -> {out}  ({w_}x{h_}, {len(cars)} teams, order: {', '.join(names)})")


# ------------------------------------------------------- palette derivation
def derive_palette(colors: dict) -> dict[str, str]:
    """Derive a 5-slot livery palette from a team_colors.json entry.

    main/secondary/accent come straight across (with fallbacks when missing
    or duplicate); pop/detail are light/dark tints of main so the set stays
    coherent.
    """
    main = _valid_hex(colors.get("primary")) or "#5A6B7A"
    h, s, v = hsv(main)

    def light(k: float) -> str:
        return hexc(h, s * (1 - k * 0.55), v + (1 - v) * k)

    def dark(k: float) -> str:
        return hexc(h, min(1.0, s * 1.08), v * (1 - k))

    secondary = _valid_hex(colors.get("secondary"))
    if not secondary or secondary.lower() == main.lower():
        secondary = light(0.28) if v < 0.85 else dark(0.25)
    accent = _valid_hex(colors.get("accent"))
    if not accent or accent.lower() in {main.lower(), secondary.lower()}:
        accent = "#FFFFFF" if v < 0.82 else dark(0.30)
    pop = light(0.45)
    if pop.lower() in {main.lower(), secondary.lower(), accent.lower()}:
        pop = dark(0.30)
    detail = dark(0.38)
    if detail.lower() in {main.lower(), secondary.lower()}:
        detail = "#101216"
    return {"main": main, "secondary": secondary, "accent": accent,
            "pop": pop, "detail": detail}


def _valid_hex(value) -> str | None:
    if not isinstance(value, str):
        return None
    v = value.strip()
    return v if re.fullmatch(r"#[0-9a-fA-F]{6}", v) else None


def _norm_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


# generic words that must not drive matching ("Racing Bulls" vs "Red Bull Racing")
_DERIVE_STOP = {"racing", "team", "f1"}

# Families with iconic identities but only default-grey data in team_colors.json.
# Keyed by a token of the team name; values are 5-slot palettes (historical liveries).
CURATED_FAMILIES = {
    "mclaren":      {"main": "#FF8000", "secondary": "#1E2228", "accent": "#47C7FC", "pop": "#FFFFFF", "detail": "#FFA945"},
    "brabham":      {"main": "#1E3C8C", "secondary": "#FFFFFF", "accent": "#D5001F", "pop": "#8FA6E8", "detail": "#101E4E"},
    "tyrrell":      {"main": "#0057B8", "secondary": "#FFFFFF", "accent": "#FFD700", "pop": "#66A3E8", "detail": "#00305E"},
    "maserati":     {"main": "#DA291C", "secondary": "#FFFFFF", "accent": "#111111", "pop": "#EE6B5C", "detail": "#7A0F08"},
    "vanwall":      {"main": "#0B5140", "secondary": "#FFFFFF", "accent": "#CEDC00", "pop": "#37A184", "detail": "#04352B"},
    "jordan":       {"main": "#FFD800", "secondary": "#111111", "accent": "#FFFFFF", "pop": "#FFEA80", "detail": "#8A7500"},
    "minardi":      {"main": "#2E5C9E", "secondary": "#FFFFFF", "accent": "#DA291C", "pop": "#6B8FC4", "detail": "#16305A"},
    "prost":        {"main": "#2AA8E0", "secondary": "#0E2C52", "accent": "#FFFFFF", "pop": "#7CCCEF", "detail": "#0A3A66"},
    "ligier":       {"main": "#1E3C8C", "secondary": "#FFFFFF", "accent": "#D5001F", "pop": "#6B84C4", "detail": "#0F2554"},
    "jaguar":       {"main": "#00594F", "secondary": "#FFFFFF", "accent": "#CEDC00", "pop": "#37A184", "detail": "#04352B"},
    "toleman":      {"main": "#2A5CAA", "secondary": "#FFFFFF", "accent": "#FFD700", "pop": "#6B84C4", "detail": "#16305A"},
    "shadow":       {"main": "#17181C", "secondary": "#E8EAF2", "accent": "#DA291C", "pop": "#8A8D96", "detail": "#0A0B0E"},
    "matra":        {"main": "#1F4AA8", "secondary": "#FFFFFF", "accent": "#D5001F", "pop": "#6B84C4", "detail": "#122A60"},
    "osella":       {"main": "#DA291C", "secondary": "#FFFFFF", "accent": "#111111", "pop": "#EE6B5C", "detail": "#7A0F08"},
    "toyota":       {"main": "#DA291C", "secondary": "#FFFFFF", "accent": "#111111", "pop": "#EE6B5C", "detail": "#7A0F08"},
    "honda":        {"main": "#005BA9", "secondary": "#FFFFFF", "accent": "#D5001F", "pop": "#6699CC", "detail": "#00305E"},
    "porsche":      {"main": "#B6BABD", "secondary": "#1B1E24", "accent": "#DA291C", "pop": "#FFFFFF", "detail": "#6E7276"},
    "lancia":       {"main": "#DA291C", "secondary": "#FFFFFF", "accent": "#111111", "pop": "#EE6B5C", "detail": "#7A0F08"},
    "talbot":       {"main": "#1F4AA8", "secondary": "#FFFFFF", "accent": "#FFFFFF", "pop": "#6B84C4", "detail": "#122A60"},
    "wolf":         {"main": "#16214A", "secondary": "#FFC906", "accent": "#FFFFFF", "pop": "#4A5AA0", "detail": "#0A0F24"},
    "zakspeed":     {"main": "#E8EAF2", "secondary": "#1E3C8C", "accent": "#D5001F", "pop": "#FFFFFF", "detail": "#101E4E"},
    "larrousse":    {"main": "#2A5CAA", "secondary": "#FFFFFF", "accent": "#FFD700", "pop": "#6B84C4", "detail": "#16305A"},
    "leyton":       {"main": "#7EC8E3", "secondary": "#0E2C52", "accent": "#FFFFFF", "pop": "#B8E4F2", "detail": "#0A3A66"},
    "stewart":      {"main": "#F2F4F8", "secondary": "#111111", "accent": "#D5001F", "pop": "#FFFFFF", "detail": "#8A8D96"},
    "aguri":        {"main": "#F2F4F8", "secondary": "#1E3C8C", "accent": "#D5001F", "pop": "#FFFFFF", "detail": "#101E4E"},
    "marussia":     {"main": "#C4001F", "secondary": "#111111", "accent": "#FFFFFF", "pop": "#E86478", "detail": "#5E000C"},
    "virgin":       {"main": "#C4001F", "secondary": "#111111", "accent": "#FFFFFF", "pop": "#E86478", "detail": "#5E000C"},
    "spyker":       {"main": "#F26522", "secondary": "#111111", "accent": "#FFFFFF", "pop": "#F9A87C", "detail": "#8A3408"},
    "lotus":        {"main": "#111111", "secondary": "#F6D32D", "accent": "#FFFFFF", "pop": "#7C7C7C", "detail": "#0B0B0B"},
    "williams":     {"main": "#041E42", "secondary": "#00A3E0", "accent": "#FFFFFF", "pop": "#64D2FF", "detail": "#123C8F"},
    "sauber":       {"main": "#1C71D8", "secondary": "#FFFFFF", "accent": "#111111", "pop": "#6BA3E8", "detail": "#0E3A6E"},
    "lola":         {"main": "#2A5CAA", "secondary": "#FFFFFF", "accent": "#FFD700", "pop": "#6B84C4", "detail": "#16305A"},
    "penske":       {"main": "#F2F4F8", "secondary": "#2E5C9E", "accent": "#DA291C", "pop": "#FFFFFF", "detail": "#16305A"},
    "surtees":      {"main": "#3A5BA0", "secondary": "#FFFFFF", "accent": "#FFD700", "pop": "#7C93C4", "detail": "#1E3560"},
    "theodore":     {"main": "#3A6BB0", "secondary": "#FFFFFF", "accent": "#FFD700", "pop": "#7C9ACC", "detail": "#1E3A66"},
    "iso":          {"main": "#F2F4F8", "secondary": "#DA291C", "accent": "#111111", "pop": "#FFFFFF", "detail": "#8A8D96"},
    "parnelli":     {"main": "#C8322B", "secondary": "#FFFFFF", "accent": "#111111", "pop": "#E0746C", "detail": "#6A130E"},
    "mercedes":     {"main": "#00B2A9", "secondary": "#1B1E24", "accent": "#C6CBD4", "pop": "#FFFFFF", "detail": "#00E3D2"},
    "alfa":         {"main": "#E01B24", "secondary": "#FFFFFF", "accent": "#111111", "pop": "#EE5058", "detail": "#8B070D"},
    "kurtis":       {"main": "#2A5CAA", "secondary": "#FFFFFF", "accent": "#FFD700", "pop": "#6B84C4", "detail": "#16305A"},
    "watson":       {"main": "#2A5CAA", "secondary": "#FFFFFF", "accent": "#FFD700", "pop": "#6B84C4", "detail": "#16305A"},
    "lesovsky":     {"main": "#2A5CAA", "secondary": "#FFFFFF", "accent": "#FFD700", "pop": "#6B84C4", "detail": "#16305A"},
    "milano":       {"main": "#2A5CAA", "secondary": "#FFFFFF", "accent": "#FFD700", "pop": "#6B84C4", "detail": "#16305A"},
    "mrt":          {"main": "#DA291C", "secondary": "#FFFFFF", "accent": "#111111", "pop": "#EE6B5C", "detail": "#7A0F08"},
    "march":        {"main": "#DA291C", "secondary": "#FFFFFF", "accent": "#111111", "pop": "#EE6B5C", "detail": "#7A0F08"},
    "tecno":        {"main": "#E07800", "secondary": "#FFFFFF", "accent": "#111111", "pop": "#F0A866", "detail": "#7A3E00"},
}

_GREY_DEFAULTS = {"#777777", "#777"}


def _is_grey(entry: dict) -> bool:
    return str(entry.get("primary", "")).lower() in _GREY_DEFAULTS


def match_team_colors(team: str, tc: dict) -> dict | None:
    """Match a DB team name to a team_colors.json entry.

    Case-insensitive exact matches are collected and a non-grey one preferred
    (the file contains lowercase duplicates with real colours and grey stubs
    under the display name). Family/token matching is a fallback.
    """
    t = _norm_name(team)
    exact = [tc[k] for k in tc if _norm_name(k) == t]
    for entry in exact:
        if not _is_grey(entry):
            return entry
    if exact:
        return exact[0]
    for name, entry in tc.items():
        n = _norm_name(name)
        if n.startswith(t) or t.startswith(n):
            if not _is_grey(entry):
                return entry
    t_tokens = set(t.split()) - _DERIVE_STOP
    best, best_score, best_grey = None, 0, True
    for name, entry in tc.items():
        score = len(t_tokens & (set(_norm_name(name).split()) - _DERIVE_STOP))
        if score > best_score or (score == best_score and best_grey and not _is_grey(entry)):
            best, best_score, best_grey = entry, score, _is_grey(entry)
    return best


CURATED_10 = ["McLaren Mercedes", "Ferrari", "Red Bull Racing Honda RBPT",
              "Mercedes", "Aston Martin Aramco Mercedes", "Alpine Renault",
              "Williams Mercedes", "Racing Bulls", "Haas Ferrari",
              "Kick Sauber Ferrari"]


def derive_all_palettes() -> tuple[dict, list[str], list[str]]:
    """Build palettes for every DB team; keeps curated entries untouched.

    Order per team: curated file entry -> non-grey team_colors match ->
    curated family table -> grey team_colors fallback.
    Returns (palettes, derived_names, unmatched_names).
    """
    import sqlite3
    raw = json.loads(PALETTES.read_text()) if PALETTES.exists() else {}
    curated_names = set(raw.get("_curated", CURATED_10))
    tc = json.loads((TRAf1 / "data" / "team_colors.json").read_text())
    con = sqlite3.connect(TRAf1 / "data" / "f1.sqlite")
    rows = con.execute(
        "SELECT team FROM (SELECT DISTINCT team FROM drivers_standings WHERE team!='' "
        "UNION SELECT DISTINCT team FROM team_standings WHERE team!='') ORDER BY team"
    ).fetchall()
    palettes = {k: v for k, v in raw.items() if not k.startswith("_")}
    derived, unmatched = [], []
    for team in [r[0] for r in rows]:
        if team in curated_names:
            palettes[team] = raw[team]
            continue
        entry = match_team_colors(team, tc)
        if entry and not _is_grey(entry):
            palettes[team] = derive_palette(entry)
        else:
            t = _norm_name(team)
            fam = next((CURATED_FAMILIES[key] for key in CURATED_FAMILIES
                        if key in t.split()), None)
            if fam:
                palettes[team] = dict(fam)
            elif entry:
                palettes[team] = derive_palette(entry)
            else:
                palettes[team] = {"main": "#5A6B7A", "secondary": "#E8EAF2",
                                  "accent": "#DA291C", "pop": "#FFFFFF",
                                  "detail": "#101216"}
                unmatched.append(team)
        derived.append(team)
    return palettes, derived, unmatched


def main():
    args = sys.argv[1:]
    layers = load_layers()
    palettes = load_palettes()

    if "--derive-palettes" in args:
        all_p, derived, unmatched = derive_all_palettes()
        raw = json.loads(PALETTES.read_text()) if PALETTES.exists() else {}
        curated_names = sorted(set(CURATED_10) & set(all_p))
        payload = {"_comment": "5-colour car palettes. Curated 2025 grid + derived historical teams.",
                   "_slots": ["main", "secondary", "accent", "pop", "detail"],
                   "_curated": curated_names}
        for k in curated_names:
            payload[k] = raw[k]
        for k, v in sorted(all_p.items()):
            payload.setdefault(k, v)
        PALETTES.write_text(json.dumps(payload, indent=2) + "\n")
        print(f"palettes: {len(payload) - 3} teams ({len(curated_names)} curated, "
              f"{len(derived) - len(curated_names)} re-derived, {len(unmatched)} unmatched)")
        if unmatched:
            print("unmatched teams:")
            for u in unmatched:
                print("  -", u)
        return

    if "--preview" in args:
        out = args[args.index("--preview") + 1]
        wanted = None
        if "--teams" in args:
            wanted = args[args.index("--teams") + 1].split(",")
        palettes = {k: palettes[k] for k in (wanted or palettes)}
        preview(layers, palettes, out,
                columns=int(args[args.index("--cols") + 1]) if "--cols" in args else 4)
        return

    if "--png" in args:
        outdir = Path(args[args.index("--png") + 1])
        outdir.mkdir(parents=True, exist_ok=True)
        wanted = args[args.index("--team") + 1].split(",") if "--team" in args else None
        for name, pal in palettes.items():
            if wanted and name not in wanted:
                continue
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            render_png(layers, team_colors(pal), outdir / f"{slug}.png", scale=3)
            print(f"wrote {outdir / (slug + '.png')}")
        return

    if "--svg" in args:
        outdir = Path(args[args.index("--svg") + 1])
        outdir.mkdir(parents=True, exist_ok=True)
        wanted = args[args.index("--team") + 1].split(",") if "--team" in args else None
        for name, pal in palettes.items():
            if wanted and name not in wanted:
                continue
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            svg = recolor_svg(layers, team_colors(pal))
            (outdir / f"{slug}.svg").write_text(svg)
            print(f"wrote {outdir / (slug + '.svg')}")
        return

    print(__doc__)


if __name__ == "__main__":
    main()
