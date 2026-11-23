"""ReportLab PDF rendering for Collector/Game Driver Cards and Circuit & Weather Track Decks."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
_f1_car_svg_template: Optional[str] = None
_livery_slug_cache: dict[str, str] = {}


def _get_team_colors(team_name: str) -> dict:
    from . import server as srv
    return srv.get_team_colors(team_name)


def _draw_livery_car(canvas, team_name: str, x: float, y: float, w: float, h: float) -> bool:
    """Draw the team's Inkport livery car (pre-rendered PNG) fitted into (w, h).

    Returns False when the team has no livery so callers can fall back to the
    vector top-view icon.
    """
    if not team_name:
        return False
    slug = _livery_slug_cache.get(team_name)
    if slug is None:
        from .f1_car_palettes import find_slug
        slug = find_slug(team_name) or ""
        _livery_slug_cache[team_name] = slug
    if not slug:
        return False
    png = STATIC_DIR / "cars" / "png" / f"{slug}.png"
    if not png.exists():
        return False
    img_ratio = 640.0 / 320.0
    box_ratio = w / h if h else img_ratio
    if box_ratio > img_ratio:
        dh = h
        dw = h * img_ratio
    else:
        dw = w
        dh = w / img_ratio
    canvas.drawImage(str(png), x + (w - dw) / 2, y + (h - dh) / 2,
                     width=dw, height=dh, mask="auto")
    return True

def _draw_car_from_svg(canvas, primary_hex: str, secondary_hex: str, accent_hex: str,
                       x: float, y: float, w: float, h: float) -> None:
    """Draw the same F1 car as the web (static/svg/f1_car_top.svg) into the PDF. Uses svglib."""
    global _f1_car_svg_template
    if _f1_car_svg_template is None:
        svg_path = STATIC_DIR / "svg" / "f1_car_top.svg"
        if not svg_path.exists():
            raise FileNotFoundError(str(svg_path))
        _f1_car_svg_template = svg_path.read_text(encoding="utf-8")
    p = (primary_hex if primary_hex.startswith("#") else "#" + primary_hex).strip()
    s = (secondary_hex if secondary_hex.startswith("#") else "#" + secondary_hex).strip()
    a = (accent_hex if accent_hex.startswith("#") else "#" + accent_hex).strip()
    svg_str = _f1_car_svg_template.replace("__PRIMARY__", p).replace("__SECONDARY__", s).replace("__ACCENT__", a)
    try:
        from io import BytesIO
        from svglib.svglib import svg2rlg
        from reportlab.graphics import renderPDF
    except ImportError:
        raise RuntimeError("svglib not installed")
    drawing = svg2rlg(BytesIO(svg_str.encode("utf-8")))
    if drawing is None:
        raise RuntimeError("svg2rlg returned None")
    scale = min(w / drawing.width, h / drawing.height)
    drawing.scale(scale, scale)
    drawing.width = drawing.width * scale
    drawing.height = drawing.height * scale
    renderPDF.draw(drawing, canvas, x, y)


def _render_cards_pdf(cards: list[dict], title: str = "Driver Cards", size: str = "standard", mode: str = "collector") -> bytes:
    import math as _math
    import re as _re
    from io import BytesIO
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import landscape, letter
    from reportlab.lib.units import inch
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfgen import canvas
    from .f1_car_palettes import find_car_png_slug as _find_car_png_slug
    from .game import BATTLE_STATS as _BATTLE_STATS, compute_game_profile as _compute_game_profile

    game_mode = (mode or "collector").strip().lower() == "game"

    buf = BytesIO()
    fold_mode = (size == "fold")
    if fold_mode:
        page_w, page_h = letter
        margin = 0.3 * inch
        card_w = (page_w - 3 * margin) / 2.0
        card_h = (page_h - 3 * margin) / 2.0
        cols, rows, gap = 2, 2, margin
    else:
        page_w, page_h = landscape(letter)
        margin = 0.4 * inch
        if size == "large":
            card_w, card_h, gap, cols, rows = 3.5 * inch, 5.0 * inch, 0.5 * inch, 2, 1
        else:
            card_w, card_h, gap, cols, rows = 2.5 * inch, 3.5 * inch, 0.35 * inch, 3, 1

    c = canvas.Canvas(buf, pagesize=(page_w, page_h))
    x0 = margin
    y0 = (page_h - card_h) / 2.0 if (rows == 1 and not fold_mode) else margin

    # Canonical collector-card coordinate system (matches fold 2x2 portrait card size)
    REF_W = (letter[0] - 3 * (0.3 * inch)) / 2.0  # 273.6 pt
    REF_H = (letter[1] - 3 * (0.3 * inch)) / 2.0  # 363.6 pt

    # Cache ImageReader instances across all cards in the batch for speed & smaller PDFs
    _img_cache: dict[str, ImageReader | None] = {}

    def _get_image_reader(path: Path) -> ImageReader | None:
        key = str(path)
        if key not in _img_cache:
            try:
                _img_cache[key] = ImageReader(key) if path.exists() else None
            except Exception:
                _img_cache[key] = None
        return _img_cache[key]

    def _clean_driver_name(raw: str) -> tuple[str, str]:
        s = (raw or "").strip()
        m = _re.search(r"\s+([A-Z]{3})$", s)
        if m:
            return s[: m.start()].strip(), m.group(1)
        return s, ""

    def _spine_prefix(raw_title: str) -> str:
        t = (raw_title or "Driver Cards").strip()
        t = _re.sub(r"^Driver\s+Cards\s*[•·:\-]?\s*", "", t, flags=_re.IGNORECASE).strip()
        return (t or "DRIVER CARDS").upper()

    def _fmt_num(v, decimals: int = 0) -> str:
        try:
            f = float(v)
            if decimals == 0 or abs(f - round(f)) < 1e-6:
                return f"{int(round(f)):,}"
            return f"{f:,.{decimals}f}"
        except Exception:
            return str(v if v is not None else "—")

    def _fmt_pts_compact(v) -> str:
        try:
            f = float(v)
            if abs(f - round(f)) < 1e-6:
                return f"{int(round(f))}"
            return f"{f:.1f}"
        except Exception:
            return str(v if v is not None else "0")

    def _fmt_pct(v) -> str:
        try:
            return f"{float(v):.1f}%"
        except Exception:
            return str(v if v is not None else "0.0%")

    def _ellipsize(text: str, font_name: str, font_size: float, max_w: float) -> str:
        s = str(text or "")
        if pdfmetrics.stringWidth(s, font_name, font_size) <= max(0.0, max_w):
            return s
        ell = "\u2026"
        while s and pdfmetrics.stringWidth(s + ell, font_name, font_size) > max(0.0, max_w):
            s = s[:-1]
        return (s + ell) if s else ell

    def _fit_font_size(text: str, font_name: str, max_w: float, base: float, minimum: float = 7.5) -> float:
        sz = base
        while sz >= minimum:
            if pdfmetrics.stringWidth(text, font_name, sz) <= max_w:
                return sz
            sz -= 0.5
        return minimum

    def _hex_to_rgbf(h: str) -> tuple[float, float, float]:
        try:
            h = (h or "").strip().lstrip("#")
            if len(h) == 3:
                h = "".join(ch * 2 for ch in h)
            return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)
        except Exception:
            return (0.4, 0.45, 0.55)

    def _luminance(hex_col: str) -> float:
        r, g, b = _hex_to_rgbf(hex_col)
        return 0.299 * r + 0.587 * g + 0.114 * b

    def _draw_car_visual(team_name: str, col_dict: dict, x: float, y: float, w: float, h: float, year: int | str | None = None):
        slug = _find_car_png_slug(team_name or "", year=year)
        if slug:
            png_path = BASE_DIR / "static" / "cars" / "png" / f"{slug}.png"
            ir = _get_image_reader(png_path)
            if ir is not None:
                try:
                    c.drawImage(ir, x, y, width=w, height=h, preserveAspectRatio=True, anchor="c", mask="auto")
                    return
                except Exception:
                    pass
        try:
            p = (col_dict or {}).get("primary", "#777777")
            s = (col_dict or {}).get("secondary", "#DDDDDD")
            a = (col_dict or {}).get("accent", "#111111")
            _draw_car_from_svg(c, p, s, a, x, y, w, h)
        except Exception:
            # Simple minimalist silhouette fallback
            c.setFillColor(colors.HexColor((col_dict or {}).get("primary", "#64748b")))
            c.roundRect(x + w * 0.1, y + h * 0.3, w * 0.8, h * 0.4, 3, fill=1, stroke=0)

    def _draw_flag(nationality: str, x: float, y: float, w: float, h: float):
        import requests as _rq
        nat3 = (nationality or "").upper()
        map3_to_2 = {
            "GBR": "gb", "UK": "gb", "ENG": "gb", "SCO": "gb", "WAL": "gb", "NIR": "gb",
            "NED": "nl", "NLD": "nl", "BEL": "be", "MEX": "mx", "GER": "de", "DEU": "de",
            "ESP": "es", "POR": "pt", "BRA": "br", "ARG": "ar", "CAN": "ca", "USA": "us",
            "AUS": "au", "SWE": "se", "FIN": "fi", "FRA": "fr", "ITA": "it", "JPN": "jp",
            "SUI": "ch", "CHE": "ch", "AUT": "at", "MON": "mc", "MCO": "mc", "NZL": "nz",
            "RUS": "ru", "CHN": "cn", "IND": "in", "UAE": "ae", "QAT": "qa", "SAU": "sa",
            "THA": "th", "MYS": "my", "IDN": "id", "POL": "pl", "CZE": "cz", "HUN": "hu",
            "DEN": "dk", "DNK": "dk", "RSA": "za", "ZAF": "za", "VEN": "ve", "COL": "co",
            "IRL": "ie", "CHI": "cl", "CHL": "cl", "URU": "uy", "RHO": "zw", "ISR": "il",
        }
        iso2 = map3_to_2.get(nat3)
        flag_dir = BASE_DIR / "data" / "flags"
        flag_dir.mkdir(parents=True, exist_ok=True)
        if iso2:
            path = flag_dir / f"{iso2}.png"
            if not path.exists():
                try:
                    r = _rq.get(f"https://flagcdn.com/w80/{iso2}.png", timeout=3)
                    if r.status_code == 200 and r.content:
                        path.write_bytes(r.content)
                except Exception:
                    pass
            ir = _get_image_reader(path)
            if ir is not None:
                try:
                    c.saveState()
                    fp = c.beginPath()
                    fp.roundRect(x, y, w, h, 2.5)
                    c.clipPath(fp, stroke=0, fill=0)
                    c.drawImage(ir, x, y, width=w, height=h, preserveAspectRatio=False, mask="auto")
                    c.restoreState()
                    c.setStrokeColor(colors.HexColor("#475569"))
                    c.setLineWidth(0.5)
                    c.roundRect(x, y, w, h, 2.5, fill=0, stroke=1)
                    return
                except Exception:
                    pass
        # Crisp geometric stripe fallback
        stripes = {
            "ITA": ["#009246", "#F1F2F1", "#CE2B37"], "FRA": ["#0055A4", "#FFFFFF", "#EF4135"],
            "NED": ["#AE1C28", "#FFFFFF", "#21468B"], "BEL": ["#000000", "#FFD90C", "#ED2939"],
            "MEX": ["#006847", "#FFFFFF", "#CE1126"], "IRL": ["#169B62", "#FFFFFF", "#FF883E"],
            "GER": ["#000000", "#DD0000", "#FFCE00"], "ESP": ["#AA151B", "#F1BF00", "#AA151B"],
            "BRA": ["#229E45", "#FFDF00", "#3D5BA9"], "ARG": ["#75AADB", "#FFFFFF", "#75AADB"],
            "CAN": ["#FF0000", "#FFFFFF", "#FF0000"], "USA": ["#B22234", "#FFFFFF", "#3C3B6E"],
            "GBR": ["#00247D", "#FFFFFF", "#CF142B"], "AUS": ["#012169", "#FFFFFF", "#E4002B"],
            "SWE": ["#006AA7", "#FECC00", "#006AA7"], "FIN": ["#FFFFFF", "#003580", "#FFFFFF"],
        }
        c.saveState()
        fp = c.beginPath()
        fp.roundRect(x, y, w, h, 2.5)
        c.clipPath(fp, stroke=0, fill=0)
        if nat3 == "JPN":
            c.setFillColor(colors.white)
            c.rect(x, y, w, h, fill=1, stroke=0)
            c.setFillColor(colors.HexColor("#BC002D"))
            c.circle(x + w / 2.0, y + h / 2.0, min(w, h) * 0.28, fill=1, stroke=0)
        else:
            st_cols = stripes.get(nat3, ["#334155", "#475569", "#64748b"])
            sw = w / 3.0
            for idx_s, hc in enumerate(st_cols):
                c.setFillColor(colors.HexColor(hc))
                c.rect(x + idx_s * sw, y, sw + 0.3, h, fill=1, stroke=0)
        c.restoreState()
        c.setStrokeColor(colors.HexColor("#475569"))
        c.setLineWidth(0.5)
        c.roundRect(x, y, w, h, 2.5, fill=0, stroke=1)

    def _draw_star(cx: float, cy: float, r: float, fill_color):
        pts = []
        for i in range(10):
            ang = _math.radians(90 + i * 36)
            rr = r if i % 2 == 0 else r * 0.44
            pts.append((cx + rr * _math.cos(ang), cy + rr * _math.sin(ang)))
        c.setFillColor(fill_color)
        p = c.beginPath()
        p.moveTo(pts[0][0], pts[0][1])
        for px, py in pts[1:]:
            p.lineTo(px, py)
        p.close()
        c.drawPath(p, fill=1, stroke=0)

    def _draw_trophy(cx: float, cy: float, s: float = 0.88):
        c.saveState()
        gold = colors.HexColor("#d4af37")
        gold_light = colors.HexColor("#fde047")
        gold_dark = colors.HexColor("#a16207")
        stroke = colors.HexColor("#854d0e")
        c.setLineCap(1)
        c.setLineJoin(1)
        cup_cx = cx + 7 * s
        cup_top_y = cy + 10.5 * s
        cup_w = 9.5 * s
        cup_h = 6 * s
        bot_y = cup_top_y - cup_h - 1.0 * s
        handle_y = cup_top_y - 2.0 * s
        c.setStrokeColor(gold_dark)
        c.setLineWidth(1.1 * s)
        for sign in (-1, 1):
            hx0 = cup_cx + sign * (cup_w / 2.0)
            hx1 = cup_cx + sign * (cup_w / 2.0 + 2.2 * s)
            ph = c.beginPath()
            ph.moveTo(hx0, handle_y)
            ph.curveTo(hx0 + sign * 2.4 * s, handle_y, hx1, handle_y - 2.6 * s, hx0 - sign * 0.5 * s, bot_y + 1.2 * s)
            c.drawPath(ph, fill=0, stroke=1)
        c.setLineWidth(0.45 * s)
        p = c.beginPath()
        p.moveTo(cup_cx - cup_w / 2.0, cup_top_y)
        p.curveTo(cup_cx - cup_w / 2.0, cup_top_y - cup_h * 0.65, cup_cx - 1.0 * s, bot_y, cup_cx, bot_y)
        p.curveTo(cup_cx + 1.0 * s, bot_y, cup_cx + cup_w / 2.0, cup_top_y - cup_h * 0.65, cup_cx + cup_w / 2.0, cup_top_y)
        p.close()
        c.setFillColor(gold)
        c.setStrokeColor(stroke)
        c.drawPath(p, fill=1, stroke=1)
        p2 = c.beginPath()
        p2.moveTo(cup_cx - 1.2 * s, cup_top_y - 0.8 * s)
        p2.lineTo(cup_cx - 0.5 * s, bot_y + 0.8 * s)
        p2.lineTo(cup_cx + 0.3 * s, bot_y + 0.8 * s)
        p2.lineTo(cup_cx + 0.6 * s, cup_top_y - 0.8 * s)
        p2.close()
        c.setFillColor(gold_light)
        c.drawPath(p2, fill=1, stroke=0)
        c.setFillColor(gold_dark)
        c.setStrokeColor(stroke)
        c.roundRect(cup_cx - 1.1 * s, bot_y - 3.0 * s, 2.2 * s, 3.0 * s, 0.3 * s, fill=1, stroke=1)
        c.setFillColor(gold)
        c.roundRect(cup_cx - 5.2 * s, bot_y - 4.8 * s, 10.4 * s, 1.8 * s, 0.5 * s, fill=1, stroke=1)
        c.restoreState()

    def _draw_spine(
        x: float, y: float, band_w: float, ch: float,
        grad_cols: list[str], label: str, wins_total: int = 0,
        show_stars: bool = True, is_champion: bool = False,
    ):
        sx = x + 4.0
        sy = y + 4.0
        sh = ch - 8.0
        dedup: list[str] = []
        for col in grad_cols:
            if col and (not dedup or dedup[-1].lower() != col.lower()):
                dedup.append(col)
        if not dedup:
            dedup = ["#334155"]

        c.saveState()
        clip = c.beginPath()
        clip.roundRect(sx, sy, band_w, sh, 5)
        c.clipPath(clip, stroke=0, fill=0)

        if len(dedup) == 1:
            c.setFillColorRGB(*_hex_to_rgbf(dedup[0]))
            c.rect(sx, sy, band_w, sh, fill=1, stroke=0)
        else:
            segments = len(dedup) - 1
            steps = 16
            slice_h = sh / float(segments * steps)
            yy = sy
            for seg_i in range(segments):
                c0 = _hex_to_rgbf(dedup[seg_i])
                c1 = _hex_to_rgbf(dedup[seg_i + 1])
                for st in range(steps):
                    t = st / float(steps - 1)
                    c.setFillColorRGB(
                        c0[0] * (1 - t) + c1[0] * t,
                        c0[1] * (1 - t) + c1[1] * t,
                        c0[2] * (1 - t) + c1[2] * t,
                    )
                    c.rect(sx, yy, band_w, slice_h + 0.4, fill=1, stroke=0)
                    yy += slice_h

        # Dark top vignette behind win badge / stars
        if show_stars and wins_total > 0:
            c.setFillColorRGB(0.06, 0.09, 0.16, alpha=0.55)
            badge_h = 26.0 if wins_total > 18 else min(48.0, 10.0 + _math.ceil(wins_total / 3.0) * 6.5)
            c.rect(sx, sy + sh - badge_h, band_w, badge_h, fill=1, stroke=0)

        # High-contrast pill behind rotated label
        lbl_font = "Helvetica-Bold"
        lbl_size = 6.4
        lbl_fit = _ellipsize(label, lbl_font, lbl_size, sh - 76.0)
        tw = pdfmetrics.stringWidth(lbl_fit, lbl_font, lbl_size)
        pill_h = tw + 16.0
        pill_w = band_w - 4.0
        pill_x = sx + 2.0
        pill_y = sy + (sh - pill_h) / 2.0
        c.setFillColorRGB(0.06, 0.09, 0.16, alpha=0.78)
        c.roundRect(pill_x, pill_y, pill_w, pill_h, 4, fill=1, stroke=0)

        # Win stars (or compact gold star + count for 18+ winners)
        if show_stars and wins_total > 0:
            gold = colors.HexColor("#fbbf24")
            if wins_total <= 18:
                cols_s = 3
                r = 2.0
                gap_s = 1.6
                grid_w = cols_s * (2 * r) + (cols_s - 1) * gap_s
                start_x = sx + (band_w - grid_w) / 2.0 + r
                start_y = sy + sh - 7.5
                for idx_w in range(wins_total):
                    rr_i = idx_w // cols_s
                    cc_i = idx_w % cols_s
                    _draw_star(start_x + cc_i * (2 * r + gap_s), start_y - rr_i * (2 * r + gap_s), r, gold)
            else:
                _draw_star(sx + band_w / 2.0, sy + sh - 8.5, 4.2, gold)
                wtxt = f"{wins_total}W"
                c.setFillColor(colors.HexColor("#fef08a"))
                c.setFont("Helvetica-Bold", 6.2)
                wt = pdfmetrics.stringWidth(wtxt, "Helvetica-Bold", 6.2)
                c.drawString(sx + (band_w - wt) / 2.0, sy + sh - 21.5, wtxt)

        # Rotated spine label
        c.saveState()
        c.translate(sx + band_w / 2.0, sy + sh / 2.0)
        c.rotate(90)
        c.setFont(lbl_font, lbl_size)
        c.setFillColor(colors.HexColor("#fef08a") if is_champion else colors.white)
        c.drawString(-tw / 2.0, -2.3, lbl_fit)
        c.restoreState()

        c.restoreState()
        c.setStrokeColor(colors.HexColor("#d4af37") if is_champion else colors.HexColor("#cbd5e1"))
        c.setLineWidth(0.6)
        c.roundRect(sx, sy, band_w, sh, 5, fill=0, stroke=1)

    def _pick_hero_car(card: dict) -> dict:
        cars = card.get("cars") or []
        if not cars:
            tname = card.get("team", "") or ""
            return {"name": tname, "year": "", "colors": _get_team_colors(tname) if tname else {"primary": "#334155", "accent": "#e10600"}}
        return max(
            cars,
            key=lambda cc: (
                1 if cc.get("position") == 1 else 0,
                int(cc.get("wins") or 0),
                -(int(cc.get("position") or 99)),
                int(cc.get("year") or 0),
            ),
        )

    def _safe_accent(col_dict: dict) -> str:
        col = (col_dict or {}).get("primary") or "#e10600"
        if _luminance(col) > 0.82:
            col = (col_dict or {}).get("secondary") or (col_dict or {}).get("accent") or "#1e293b"
            if _luminance(col) > 0.82:
                col = "#1e293b"
        return col

    def _is_card_champion(card: dict) -> bool:
        if card.get("champion_years"):
            return True
        if card.get("titles_decade") and int(card.get("titles_decade") or 0) > 0:
            return True
        badges = card.get("badges") or []
        if isinstance(badges, list) and any("champion" in str(b).lower() for b in badges):
            return True
        return False

    def _chip_style(lbl: str) -> tuple[str, str, str]:
        lo = (lbl or "").lower()
        if "goat" in lo:
            return ("#fef3c7", "#f59e0b", "#92400e")
        if "champion" in lo or "triple" in lo:
            return ("#fef3c7", "#d97706", "#92400e")
        if "win" in lo or "dominant" in lo:
            return ("#fee2e2", "#ef4444", "#991b1b")
        if "fastest" in lo:
            return ("#f3e8ff", "#8b5cf6", "#5b21b6")
        if "teammate" in lo or "rookie" in lo:
            return ("#ecfeff", "#06b6d4", "#155e75")
        return ("#eef2ff", "#94a3b8", "#1e293b")

    def _draw_front_ref(card: dict, idx: int, total: int):
        cw, ch = REF_W, REF_H
        champ_years = card.get("champion_years") or []
        is_champion = _is_card_champion(card)
        rank = int(card.get("rank") or (idx + 1))
        clean_name, code3 = _clean_driver_name(card.get("driver", ""))
        nat = (card.get("nationality") or "").upper()
        cars = card.get("cars") or []
        is_single_season = (len(cars) == 1 and "total_points" not in card and "seasons" not in card)
        hero_car = _pick_hero_car(card)
        hero_cols = hero_car.get("colors") or {}
        accent_hex = _safe_accent(hero_cols)
        header_accent = "#d4af37" if is_champion else accent_hex

        # Outer card shell
        c.setFillColor(colors.HexColor("#f8fafc"))
        c.roundRect(0, 0, cw, ch, 10, fill=1, stroke=0)
        if is_champion:
            c.setStrokeColor(colors.HexColor("#b45309"))
            c.setLineWidth(1.8)
            c.roundRect(0, 0, cw, ch, 10, fill=0, stroke=1)
            c.setStrokeColor(colors.HexColor("#f59e0b"))
            c.setLineWidth(1.0)
            c.roundRect(2, 2, cw - 4, ch - 4, 8.5, fill=0, stroke=1)
        else:
            c.setStrokeColor(colors.HexColor("#1e293b"))
            c.setLineWidth(1.4)
            c.roundRect(0, 0, cw, ch, 10, fill=0, stroke=1)

        # Left career spine
        band_w = 19.0
        grad_cols = [(cc.get("colors") or {}).get("primary") for cc in cars if (cc.get("colors") or {}).get("primary")]
        spine_lbl = f"{_spine_prefix(title)}  •  #{rank}/{total}"
        _draw_spine(
            0, 0, band_w, ch,
            grad_cols or [accent_hex],
            spine_lbl,
            wins_total=int(card.get("wins") or 0),
            show_stars=True,
            is_champion=is_champion,
        )

        ix = 4.0 + band_w + 6.5
        iw = cw - (4.0 + band_w + 6.5) - 7.5
        cur_y = ch - 7.5

        # ---------------- 1) DARK CARBON HEADER BANNER ----------------
        hdr_h = 46.0
        hdr_y = cur_y - hdr_h
        c.saveState()
        p_hdr = c.beginPath()
        p_hdr.roundRect(ix, hdr_y, iw, hdr_h, 6)
        c.clipPath(p_hdr, stroke=0, fill=0)
        c.setFillColor(colors.HexColor("#0f172a"))
        c.rect(ix, hdr_y, iw, hdr_h, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1, alpha=0.04)
        sp = c.beginPath()
        sp.moveTo(ix + iw - 92, hdr_y)
        sp.lineTo(ix + iw - 62, hdr_y + hdr_h)
        sp.lineTo(ix + iw - 42, hdr_y + hdr_h)
        sp.lineTo(ix + iw - 72, hdr_y)
        sp.close()
        c.drawPath(sp, fill=1, stroke=0)
        c.setFillColor(colors.HexColor(header_accent))
        c.rect(ix, hdr_y, iw, 3.0, fill=1, stroke=0)
        c.restoreState()

        # OVR Shield (+ Draft Salary Cap Cost pill in Game Edition)
        game_prof = _compute_game_profile(card) if game_mode else None
        ovr_w, ovr_h = 40.0, 34.0
        ovr_x = ix + iw - ovr_w - 6.0
        ovr_y = hdr_y + 7.5
        c.setFillColor(colors.HexColor("#1e293b"))
        c.setStrokeColor(colors.HexColor("#f59e0b" if is_champion else "#475569"))
        c.setLineWidth(1.1 if is_champion else 0.7)
        c.roundRect(ovr_x, ovr_y, ovr_w, ovr_h, 5, fill=1, stroke=1)
        c.setFont("Helvetica-Bold", 5.2)
        c.setFillColor(colors.HexColor("#fbbf24" if is_champion else "#94a3b8"))
        lbl_o = "OVERALL"
        c.drawString(ovr_x + (ovr_w - pdfmetrics.stringWidth(lbl_o, "Helvetica-Bold", 5.2)) / 2.0, ovr_y + ovr_h - 8.5, lbl_o)
        ovr_val = f"{int(round(float(card.get('overall') or 0)))}"
        c.setFont("Helvetica-Bold", 16.5)
        c.setFillColor(colors.HexColor("#fef08a") if is_champion else colors.white)
        c.drawString(ovr_x + (ovr_w - pdfmetrics.stringWidth(ovr_val, "Helvetica-Bold", 16.5)) / 2.0, ovr_y + 6.5, ovr_val)

        hdr_right_limit = ovr_x
        if game_prof is not None:
            cost_w, cost_h = 30.0, 34.0
            cost_x = ovr_x - cost_w - 4.0
            cost_y = ovr_y
            c.setFillColor(colors.HexColor("#14532d"))
            c.setStrokeColor(colors.HexColor("#22c55e"))
            c.setLineWidth(0.75)
            c.roundRect(cost_x, cost_y, cost_w, cost_h, 5, fill=1, stroke=1)
            c.setFont("Helvetica-Bold", 4.8)
            c.setFillColor(colors.HexColor("#86efac"))
            clbl = "COST"
            c.drawString(cost_x + (cost_w - pdfmetrics.stringWidth(clbl, "Helvetica-Bold", 4.8)) / 2.0, cost_y + cost_h - 8.5, clbl)
            cval = f"${game_prof['cost_m']}M"
            c.setFont("Helvetica-Bold", 9.4)
            c.setFillColor(colors.white)
            c.drawString(cost_x + (cost_w - pdfmetrics.stringWidth(cval, "Helvetica-Bold", 9.4)) / 2.0, cost_y + 9.0, cval)
            hdr_right_limit = cost_x

        # Header top micro row: Rank + FIA code + Era/Team
        micro_y = hdr_y + hdr_h - 14.5
        px = ix + 7.5
        rank_txt = f"#{rank}"
        rk_w = max(21.0, pdfmetrics.stringWidth(rank_txt, "Helvetica-Bold", 6.8) + 8.0)
        c.setFillColor(colors.HexColor("#f59e0b" if is_champion else accent_hex))
        c.roundRect(px, micro_y, rk_w, 10.5, 3, fill=1, stroke=0)
        c.setFont("Helvetica-Bold", 6.8)
        c.setFillColor(colors.HexColor("#0f172a") if (is_champion or _luminance(accent_hex) > 0.55) else colors.white)
        c.drawString(px + (rk_w - pdfmetrics.stringWidth(rank_txt, "Helvetica-Bold", 6.8)) / 2.0, micro_y + 2.6, rank_txt)
        px += rk_w + 4.0

        if code3:
            c.setFillColor(colors.HexColor("#1e293b"))
            c.setStrokeColor(colors.HexColor("#475569"))
            c.setLineWidth(0.5)
            cw3 = 20.0
            c.roundRect(px, micro_y, cw3, 10.5, 2.5, fill=1, stroke=1)
            c.setFont("Helvetica-Bold", 6.0)
            c.setFillColor(colors.HexColor("#cbd5e1"))
            c.drawString(px + (cw3 - pdfmetrics.stringWidth(code3, "Helvetica-Bold", 6.0)) / 2.0, micro_y + 2.8, code3)
            px += cw3 + 4.5

        years_list = sorted({int(cc["year"]) for cc in cars if cc.get("year")})
        if is_single_season:
            yr_one = str(years_list[0]) if years_list else ""
            t_one = (hero_car.get("name") or card.get("team") or "").upper()
            meta_str = "  ·  ".join([s for s in [nat, yr_one, t_one] if s])
        else:
            era_txt = f"{years_list[0]}–{years_list[-1]}" if len(years_list) > 1 else (str(years_list[0]) if years_list else "")
            seasons_n = int(card.get("seasons") or len(years_list) or 0)
            meta_str = "  ·  ".join([s for s in [nat, era_txt, f"{seasons_n} SEAS." if seasons_n else ""] if s])
        c.setFont("Helvetica", 6.0)
        c.setFillColor(colors.HexColor("#94a3b8"))
        c.drawString(px, micro_y + 2.8, _ellipsize(meta_str, "Helvetica", 6.0, max(10.0, hdr_right_limit - px - 5.0)))

        # Driver Name
        name_max_w = max(40.0, hdr_right_limit - (ix + 7.5) - 6.0)
        name_disp = clean_name.upper()
        name_fs = _fit_font_size(name_disp, "Helvetica-Bold", name_max_w, 12.2, 8.2)
        c.setFont("Helvetica-Bold", name_fs)
        c.setFillColor(colors.white)
        c.drawString(ix + 7.5, hdr_y + 11.5, _ellipsize(name_disp, "Helvetica-Bold", name_fs, name_max_w))

        cur_y = hdr_y - 6.0

        # ---------------- 2) HERO STAGE: PORTRAIT + 3D STUDIO CAR ----------------
        stage_h = 84.0
        stage_y = cur_y - stage_h
        c.saveState()
        p_st = c.beginPath()
        p_st.roundRect(ix, stage_y, iw, stage_h, 6)
        c.clipPath(p_st, stroke=0, fill=0)
        c.setFillColor(colors.white)
        c.rect(ix, stage_y, iw, stage_h, fill=1, stroke=0)
        c.setFillColor(colors.HexColor("#f1f5f9"))
        c.rect(ix, stage_y, iw, stage_h * 0.36, fill=1, stroke=0)
        r_a, g_a, b_a = _hex_to_rgbf(accent_hex)
        c.setFillColorRGB(r_a, g_a, b_a, alpha=0.10)
        sl = c.beginPath()
        sl.moveTo(ix + 74, stage_y)
        sl.lineTo(ix + 106, stage_y + stage_h)
        sl.lineTo(ix + iw, stage_y + stage_h)
        sl.lineTo(ix + iw, stage_y)
        sl.close()
        c.drawPath(sl, fill=1, stroke=0)
        c.restoreState()

        c.setStrokeColor(colors.HexColor("#cbd5e1"))
        c.setLineWidth(0.75)
        c.roundRect(ix, stage_y, iw, stage_h, 6, fill=0, stroke=1)

        # Framed Driver Portrait (or clean monogram crest fallback)
        port_w, port_h = 57.0, 72.0
        port_x = ix + 6.0
        port_y = stage_y + (stage_h - port_h) / 2.0
        img_rel = card.get("driver_image")
        ir_port = _get_image_reader(BASE_DIR / img_rel) if img_rel else None
        if ir_port is not None:
            try:
                iw_img, ih_img = ir_port.getSize()
                sc = max(port_w / iw_img, port_h / ih_img)
                dw, dh = iw_img * sc, ih_img * sc
                dx = port_x + (port_w - dw) / 2.0
                dy = port_y + (port_h - dh) * 0.78
                c.saveState()
                cp = c.beginPath()
                cp.roundRect(port_x, port_y, port_w, port_h, 4.5)
                c.clipPath(cp, stroke=0, fill=0)
                c.drawImage(ir_port, dx, dy, width=dw, height=dh, mask="auto")
                c.restoreState()
            except Exception:
                ir_port = None
        if ir_port is None:
            c.saveState()
            cp = c.beginPath()
            cp.roundRect(port_x, port_y, port_w, port_h, 4.5)
            c.clipPath(cp, stroke=0, fill=0)
            c.setFillColor(colors.HexColor("#0f172a"))
            c.rect(port_x, port_y, port_w, port_h, fill=1, stroke=0)
            c.setFillColor(colors.HexColor(accent_hex))
            c.rect(port_x, port_y, port_w, 5.0, fill=1, stroke=0)
            parts = [w for w in clean_name.split() if w]
            initials = (parts[0][0] + parts[-1][0]).upper() if len(parts) >= 2 else (clean_name[:2].upper() or "F1")
            c.setFont("Helvetica-Bold", 19)
            c.setFillColor(colors.white)
            itw = pdfmetrics.stringWidth(initials, "Helvetica-Bold", 19)
            c.drawString(port_x + (port_w - itw) / 2.0, port_y + port_h * 0.44, initials)
            sub_m = code3 or nat or "F1"
            c.setFont("Helvetica-Bold", 6.5)
            c.setFillColor(colors.HexColor("#94a3b8"))
            stw = pdfmetrics.stringWidth(sub_m, "Helvetica-Bold", 6.5)
            c.drawString(port_x + (port_w - stw) / 2.0, port_y + 13.0, sub_m)
            c.restoreState()

        c.setStrokeColor(colors.HexColor("#d4af37" if is_champion else "#94a3b8"))
        c.setLineWidth(1.0 if is_champion else 0.7)
        c.roundRect(port_x, port_y, port_w, port_h, 4.5, fill=0, stroke=1)

        # Prominent 3D Studio F1 Car (always selected by YEAR!)
        car_box_x = port_x + port_w + 4.0
        car_box_w = (ix + iw - 4.0) - car_box_x
        _draw_car_visual(hero_car.get("name", ""), hero_cols, car_box_x + 2, stage_y + 12, car_box_w - 4, stage_h - 16, year=hero_car.get("year") or card.get("year"))

        # Signature constructor caption pill
        cap_parts = [p for p in [hero_car.get("name", ""), str(hero_car.get("year") or "")] if p]
        cap_txt = "  ·  ".join(cap_parts)
        if cap_txt:
            c.setFont("Helvetica-Bold", 6.0)
            cap_fit = _ellipsize(cap_txt, "Helvetica-Bold", 6.0, car_box_w - 14)
            cap_w = pdfmetrics.stringWidth(cap_fit, "Helvetica-Bold", 6.0) + 10.5
            cap_x = ix + iw - cap_w - 5.0
            cap_y = stage_y + 4.5
            c.setFillColorRGB(1, 1, 1, alpha=0.90)
            c.setStrokeColor(colors.HexColor("#cbd5e1"))
            c.setLineWidth(0.5)
            c.roundRect(cap_x, cap_y, cap_w, 10.5, 3, fill=1, stroke=1)
            c.setFillColor(colors.HexColor(accent_hex))
            c.circle(cap_x + 4.5, cap_y + 5.25, 2.0, fill=1, stroke=0)
            c.setFillColor(colors.HexColor("#1e293b"))
            c.drawString(cap_x + 8.5, cap_y + 3.0, cap_fit)

        cur_y = stage_y - 6.0

        if game_mode and game_prof is not None:
            # ---------------- GAME EDITION: BATTLE STATS + PIT WALL ABILITY ----------------
            g_stats = game_prof["stats"]
            g_ability = game_prof["ability"]
            # Compact mini KPI strip (Wins · Podiums · Fastest · Starts)
            mini_h = 21.0
            mini_y = cur_y - mini_h
            mini_items = [
                ("WINS", _fmt_num(card.get("wins", 0))),
                ("PODIUMS", _fmt_num(card.get("podiums", 0))),
                ("FASTEST", _fmt_num(card.get("fastest_laps", 0))),
                ("STARTS", _fmt_num(card.get("starts", 0))),
            ]
            c.setFillColor(colors.white)
            c.setStrokeColor(colors.HexColor("#cbd5e1"))
            c.setLineWidth(0.6)
            c.roundRect(ix, mini_y, iw, mini_h, 4.5, fill=1, stroke=1)
            mw = iw / 4.0
            for m_i, (ml, mv) in enumerate(mini_items):
                mx = ix + m_i * mw
                if m_i > 0:
                    c.setStrokeColor(colors.HexColor("#e2e8f0"))
                    c.setLineWidth(0.5)
                    c.line(mx, mini_y + 3.5, mx, mini_y + mini_h - 3.5)
                c.setFont("Helvetica-Bold", 8.4)
                c.setFillColor(colors.HexColor("#0f172a"))
                c.drawString(mx + (mw - pdfmetrics.stringWidth(mv, "Helvetica-Bold", 8.4)) / 2.0, mini_y + 9.2, mv)
                c.setFont("Helvetica-Bold", 4.7)
                c.setFillColor(colors.HexColor("#64748b"))
                c.drawString(mx + (mw - pdfmetrics.stringWidth(ml, "Helvetica-Bold", 4.7)) / 2.0, mini_y + 3.0, ml)

            cur_y = mini_y - 5.5

            # 6 Top Trumps Battle Bars (5 High-Wins 0–99 + 1 Low-Wins DNF Rate %)
            b_hdr_h = 13.0
            b_row_h = 17.5
            b_box_h = b_hdr_h + 6 * b_row_h
            b_box_y = cur_y - b_box_h

            c.saveState()
            bp_g = c.beginPath()
            bp_g.roundRect(ix, b_box_y, iw, b_box_h, 5.5)
            c.clipPath(bp_g, stroke=0, fill=0)
            c.setFillColor(colors.white)
            c.rect(ix, b_box_y, iw, b_box_h, fill=1, stroke=0)
            c.setFillColor(colors.HexColor("#0f172a"))
            c.rect(ix, cur_y - b_hdr_h, iw, b_hdr_h, fill=1, stroke=0)
            for bi in range(6):
                bry = cur_y - b_hdr_h - (bi + 1) * b_row_h
                if bi == 5:
                    c.setFillColor(colors.HexColor("#f1f5f9"))
                    c.rect(ix, bry, iw, b_row_h, fill=1, stroke=0)
                elif bi % 2 == 1:
                    c.setFillColor(colors.HexColor("#f8fafc"))
                    c.rect(ix, bry, iw, b_row_h, fill=1, stroke=0)
                c.setStrokeColor(colors.HexColor("#e2e8f0"))
                c.setLineWidth(0.45)
                c.line(ix, bry + b_row_h, ix + iw, bry + b_row_h)
            c.restoreState()

            c.setStrokeColor(colors.HexColor("#cbd5e1"))
            c.setLineWidth(0.65)
            c.roundRect(ix, b_box_y, iw, b_box_h, 5.5, fill=0, stroke=1)

            c.setFont("Helvetica-Bold", 5.6)
            c.setFillColor(colors.HexColor("#f8fafc"))
            c.drawString(ix + 7.0, cur_y - b_hdr_h + 4.0, "TOP TRUMPS BATTLE ATTRIBUTES")
            tier_txt = f"{game_prof['tier']}  ·  AVG {game_prof['power_avg']}"
            c.setFillColor(colors.HexColor("#fbbf24" if is_champion else "#94a3b8"))
            c.drawString(ix + iw - 7.0 - pdfmetrics.stringWidth(tier_txt, "Helvetica-Bold", 5.6), cur_y - b_hdr_h + 4.0, tier_txt)

            lbl_x = ix + 7.0
            bar_x = ix + 75.0
            val_w = 34.0
            bar_w = iw - (bar_x - ix) - val_w - 8.0

            for bi, bdef in enumerate(_BATTLE_STATS):
                bry = cur_y - b_hdr_h - (bi + 1) * b_row_h
                key = bdef["key"]
                is_low = (bdef["dir"] == "low")
                bcol = bdef["color"]
                val = g_stats[key]

                # Direction arrow + Label
                arrow = "▼" if is_low else "▲"
                c.setFont("Helvetica-Bold", 6.2)
                c.setFillColor(colors.HexColor("#dc2626" if is_low else bcol))
                c.drawString(lbl_x, bry + 5.6, arrow)
                c.setFont("Helvetica-Bold", 6.7)
                c.setFillColor(colors.HexColor("#0f172a"))
                c.drawString(lbl_x + 8.0, bry + 5.6, bdef["label"])

                if is_low:
                    # Low-Wins callout bar + crisp LOW WINS tag
                    tag = "LOW WINS"
                    tw_t = pdfmetrics.stringWidth(tag, "Helvetica-Bold", 4.8) + 7.0
                    c.setFillColor(colors.HexColor("#fee2e2"))
                    c.setStrokeColor(colors.HexColor("#f87171"))
                    c.setLineWidth(0.5)
                    c.roundRect(bar_x, bry + 4.2, tw_t, 9.2, 2.5, fill=1, stroke=1)
                    c.setFont("Helvetica-Bold", 4.8)
                    c.setFillColor(colors.HexColor("#991b1b"))
                    c.drawString(bar_x + 3.5, bry + 6.9, tag)

                    # Mini inverted bar (green = low DNF, red = high DNF)
                    ib_x = bar_x + tw_t + 5.0
                    ib_w = max(20.0, bar_w - tw_t - 5.0)
                    c.setFillColor(colors.HexColor("#e2e8f0"))
                    c.roundRect(ib_x, bry + 6.0, ib_w, 5.4, 2.5, fill=1, stroke=0)
                    fill_frac = max(0.05, min(1.0, float(val) / 50.0))
                    bar_c = "#16a34a" if float(val) <= 10.0 else ("#d97706" if float(val) <= 24.0 else "#dc2626")
                    c.setFillColor(colors.HexColor(bar_c))
                    c.roundRect(ib_x, bry + 6.0, ib_w * fill_frac, 5.4, 2.5, fill=1, stroke=0)

                    v_str = f"{float(val):.1f}%"
                    c.setFont("Helvetica-Bold", 7.6)
                    c.setFillColor(colors.HexColor(bar_c))
                    c.drawString(ix + iw - 7.0 - pdfmetrics.stringWidth(v_str, "Helvetica-Bold", 7.6), bry + 5.4, v_str)
                else:
                    # 0-99 Battle Bar
                    c.setFillColor(colors.HexColor("#e2e8f0"))
                    c.roundRect(bar_x, bry + 6.0, bar_w, 5.6, 2.6, fill=1, stroke=0)
                    frac = max(0.05, min(1.0, float(val) / 99.0))
                    c.setFillColor(colors.HexColor(bcol))
                    c.roundRect(bar_x, bry + 6.0, bar_w * frac, 5.6, 2.6, fill=1, stroke=0)

                    # Score pill
                    v_str = str(int(val))
                    c.setFillColor(colors.HexColor("#f1f5f9"))
                    c.roundRect(ix + iw - 30.0, bry + 3.0, 23.5, 11.4, 3, fill=1, stroke=0)
                    c.setFont("Helvetica-Bold", 8.0)
                    c.setFillColor(colors.HexColor("#0f172a"))
                    c.drawString(ix + iw - 30.0 + (23.5 - pdfmetrics.stringWidth(v_str, "Helvetica-Bold", 8.0)) / 2.0, bry + 5.6, v_str)

            cur_y = b_box_y - 5.5

            # Pit Wall Ability Box (+ Champion Years ribbon if champion)
            ab_y = 7.5
            ab_h = max(28.0, cur_y - ab_y)
            ab_col = g_ability["accent"]
            c.saveState()
            abp = c.beginPath()
            abp.roundRect(ix, ab_y, iw, ab_h, 5.5)
            c.clipPath(abp, stroke=0, fill=0)
            c.setFillColor(colors.HexColor("#fffbeb" if is_champion else "#f8fafc"))
            c.rect(ix, ab_y, iw, ab_h, fill=1, stroke=0)
            c.setFillColor(colors.HexColor(ab_col))
            c.rect(ix, ab_y, 3.6, ab_h, fill=1, stroke=0)
            c.restoreState()
            c.setStrokeColor(colors.HexColor("#f59e0b" if is_champion else "#cbd5e1"))
            c.setLineWidth(0.8 if is_champion else 0.65)
            c.roundRect(ix, ab_y, iw, ab_h, 5.5, fill=0, stroke=1)

            # Top row inside ability box: Ability Name + Role Pill + optional WDC count
            top_ab_y = ab_y + ab_h - 12.0
            c.setFont("Helvetica-Bold", 7.2)
            c.setFillColor(colors.HexColor("#0f172a"))
            ab_title = f"PIT WALL: {g_ability['name']}"
            c.drawString(ix + 8.5, top_ab_y, ab_title)

            bt_txt = g_ability["badge"]
            bt_w = pdfmetrics.stringWidth(bt_txt, "Helvetica-Bold", 5.0) + 8.0
            c.setFillColor(colors.HexColor(ab_col))
            c.roundRect(ix + iw - bt_w - 6.0, top_ab_y - 1.5, bt_w, 9.5, 2.5, fill=1, stroke=0)
            c.setFont("Helvetica-Bold", 5.0)
            c.setFillColor(colors.white)
            c.drawString(ix + iw - bt_w - 2.0, top_ab_y + 1.0, bt_txt)

            # Ability description line
            c.setFont("Helvetica", 6.2)
            c.setFillColor(colors.HexColor("#334155"))
            c.drawString(ix + 8.5, top_ab_y - 11.0, _ellipsize(g_ability["summary"], "Helvetica", 6.2, iw - 14.0))

            # Bottom subtle line: Champion years OR Synergy hint
            if champ_years:
                yrs_s = ", ".join(str(int(yy)) for yy in champ_years)
                c.setFont("Helvetica-Bold", 5.6)
                c.setFillColor(colors.HexColor("#b45309"))
                c.drawString(ix + 8.5, ab_y + 5.2, _ellipsize(f"★ {len(champ_years)}× WORLD CHAMPION ({yrs_s})", "Helvetica-Bold", 5.6, iw - 14.0))
            else:
                syn_team = hero_car.get("name", "") or "Constructor"
                c.setFont("Helvetica-Oblique", 5.5)
                c.setFillColor(colors.HexColor("#64748b"))
                c.drawString(ix + 8.5, ab_y + 5.2, _ellipsize(f"Team Orders Synergy: +5 when paired with another {syn_team} driver", "Helvetica-Oblique", 5.5, iw - 14.0))
            return

        # ---------------- 3) FOUR HERO KPI TILES (COLLECTOR EDITION) ----------------
        kpi_h = 37.0
        kpi_y = cur_y - kpi_h
        kpi_gap = 4.5
        kpi_w = (iw - 3 * kpi_gap) / 4.0
        kpis = [
            ("WINS", _fmt_num(card.get("wins", 0)), "#f59e0b" if is_champion else accent_hex),
            ("PODIUMS", _fmt_num(card.get("podiums", 0)), "#334155"),
            ("FASTEST", _fmt_num(card.get("fastest_laps", 0)), "#7c3aed"),
            ("STARTS", _fmt_num(card.get("starts", 0)), "#0284c7"),
        ]
        for k_idx, (k_lbl, k_val, k_bar) in enumerate(kpis):
            kx = ix + k_idx * (kpi_w + kpi_gap)
            c.saveState()
            kp = c.beginPath()
            kp.roundRect(kx, kpi_y, kpi_w, kpi_h, 5)
            c.clipPath(kp, stroke=0, fill=0)
            c.setFillColor(colors.white)
            c.rect(kx, kpi_y, kpi_w, kpi_h, fill=1, stroke=0)
            c.setFillColor(colors.HexColor(k_bar))
            c.rect(kx, kpi_y + kpi_h - 2.6, kpi_w, 2.6, fill=1, stroke=0)
            c.restoreState()
            c.setStrokeColor(colors.HexColor("#cbd5e1"))
            c.setLineWidth(0.6)
            c.roundRect(kx, kpi_y, kpi_w, kpi_h, 5, fill=0, stroke=1)
            v_fs = 13.5 if len(k_val) <= 3 else 11.5
            c.setFont("Helvetica-Bold", v_fs)
            c.setFillColor(colors.HexColor("#0f172a"))
            c.drawString(kx + (kpi_w - pdfmetrics.stringWidth(k_val, "Helvetica-Bold", v_fs)) / 2.0, kpi_y + 14.5, k_val)
            c.setFont("Helvetica-Bold", 5.4)
            c.setFillColor(colors.HexColor("#64748b"))
            c.drawString(kx + (kpi_w - pdfmetrics.stringWidth(k_lbl, "Helvetica-Bold", 5.4)) / 2.0, kpi_y + 5.2, k_lbl)

        cur_y = kpi_y - 6.0

        # ---------------- 4) 2-COLUMN HIGH-SIGNAL TELEMETRY GRID ----------------
        win_pct = _fmt_pct(card.get("win_rate", 0.0))
        fl_pct = _fmt_pct(card.get("fl_rate", 0.0))
        pod_pct = _fmt_pct(card.get("podium_rate", 0.0))
        top10_n = card.get("top10")
        top10_pct = _fmt_pct(card.get("top10_rate", 0.0))
        top10_str = f"{int(top10_n)} ({top10_pct})" if top10_n is not None else top10_pct
        tm_w = card.get("team_driver_wins", 0)
        tm_l = card.get("teammate_wins", 0)
        tm_ratio = ((card.get("battles") or {}).get("teammate") or {}).get("ratio")
        tm_str = f"{tm_w}–{tm_l} ({int(round(float(tm_ratio) * 100))}%)" if tm_ratio is not None else f"{tm_w}–{tm_l}"

        if card.get("total_points") is not None:
            # All-Time
            pts_row_1 = ("Career Pts", _fmt_num(card.get("total_points", 0)))
            pts_row_2 = ("Modern Pts", _fmt_num(card.get("points", 0)))
            sec_title = "CAREER TELEMETRY & RATINGS"
        elif is_single_season:
            # Single-Season
            pts_row_1 = ("Season Pts", _fmt_pts_compact(card.get("points", 0)))
            if card.get("speed_index") is not None:
                pts_row_2 = ("Speed Index", f"{float(card.get('speed_index') or 0):.1f}")
            else:
                pts_row_2 = ("Modern Pts", _fmt_num(card.get("points_modern", 0)))
            sec_title = "SEASON TELEMETRY & RATINGS"
        else:
            # Decade
            pts_row_1 = ("Decade Pts", _fmt_num(card.get("points", 0)))
            pts_row_2 = ("Modern Pts", _fmt_num(card.get("points_modern", 0)))
            sec_title = "DECADE TELEMETRY & RATINGS"

        left_metrics = [
            ("Legacy OVR", f"{float(card.get('legacy_overall') or card.get('overall') or 0):.1f}"),
            pts_row_1,
            pts_row_2,
            ("Win Rate", win_pct),
            ("Podium Rate", pod_pct),
        ]
        right_metrics = [
            ("Top-10s", top10_str),
            ("FL Rate", fl_pct),
            ("Dominance", f"{float(card.get('dominance_index') or 0):.1f}"),
            ("Teammate", tm_str),
            ("DNFs", _fmt_num(card.get("dnfs", 0))),
        ]

        sec_hdr_h = 14.0
        row_h = 17.8
        grid_h = sec_hdr_h + 5 * row_h
        grid_y = cur_y - grid_h

        c.saveState()
        gp = c.beginPath()
        gp.roundRect(ix, grid_y, iw, grid_h, 5.5)
        c.clipPath(gp, stroke=0, fill=0)
        c.setFillColor(colors.white)
        c.rect(ix, grid_y, iw, grid_h, fill=1, stroke=0)
        c.setFillColor(colors.HexColor("#eef2f6"))
        c.rect(ix, cur_y - sec_hdr_h, iw, sec_hdr_h, fill=1, stroke=0)
        for r_i in range(5):
            ry = cur_y - sec_hdr_h - (r_i + 1) * row_h
            if r_i % 2 == 1:
                c.setFillColor(colors.HexColor("#f8fafc"))
                c.rect(ix, ry, iw, row_h, fill=1, stroke=0)
            c.setStrokeColor(colors.HexColor("#e2e8f0"))
            c.setLineWidth(0.45)
            c.line(ix, ry + row_h, ix + iw, ry + row_h)
        mid_x = ix + iw / 2.0
        c.setStrokeColor(colors.HexColor("#e2e8f0"))
        c.setLineWidth(0.6)
        c.line(mid_x, grid_y, mid_x, cur_y - sec_hdr_h)
        c.restoreState()

        c.setStrokeColor(colors.HexColor("#cbd5e1"))
        c.setLineWidth(0.65)
        c.roundRect(ix, grid_y, iw, grid_h, 5.5, fill=0, stroke=1)

        c.setFont("Helvetica-Bold", 5.8)
        c.setFillColor(colors.HexColor("#475569"))
        c.drawString(ix + 7, cur_y - sec_hdr_h + 4.3, sec_title)
        pts_share = (card.get("battles") or {}).get("points_share")
        if isinstance(pts_share, (int, float)):
            sh_txt = f"PTS SHARE {float(pts_share) * 100.0:.1f}%"
            c.setFillColor(colors.HexColor("#64748b"))
            c.drawString(ix + iw - 7 - pdfmetrics.stringWidth(sh_txt, "Helvetica-Bold", 5.8), cur_y - sec_hdr_h + 4.3, sh_txt)

        half_w = iw / 2.0
        for col_i, mlist in enumerate((left_metrics, right_metrics)):
            cx0 = ix + col_i * half_w
            cx1 = cx0 + half_w
            for r_i, (mlbl, mval) in enumerate(mlist):
                ry = cur_y - sec_hdr_h - (r_i + 1) * row_h
                c.setFont("Helvetica", 6.8)
                c.setFillColor(colors.HexColor("#475569"))
                c.drawString(cx0 + 6.5, ry + 5.6, mlbl)
                c.setFont("Helvetica-Bold", 7.3)
                c.setFillColor(colors.HexColor("#0f172a"))
                vfit = _ellipsize(mval, "Helvetica-Bold", 7.3, half_w - 52.0)
                vw = pdfmetrics.stringWidth(vfit, "Helvetica-Bold", 7.3)
                c.drawString(cx1 - 6.5 - vw, ry + 5.6, vfit)

        cur_y = grid_y - 6.0

        # ---------------- 5) BOTTOM ACCOLADES / WORLD CHAMPION FOOTER ----------------
        foot_y = 7.5
        foot_h = max(16.0, cur_y - foot_y)
        badges_non_champ = [str(b) for b in (card.get("badges") or []) if "champion" not in str(b).lower()][:4]

        if champ_years:
            champ_banner_h = 26.0 if (badges_non_champ and foot_h > 42.0) else min(foot_h, 34.0)
            cb_y = cur_y - champ_banner_h
            c.setFillColor(colors.HexColor("#fffbeb"))
            c.setStrokeColor(colors.HexColor("#f59e0b"))
            c.setLineWidth(0.9)
            c.roundRect(ix, cb_y, iw, champ_banner_h, 5, fill=1, stroke=1)
            _draw_trophy(ix + 5.5, cb_y + (champ_banner_h - 11.0) / 2.0 + 1.0, 0.90)
            tx_c = ix + 23.5
            c.setFont("Helvetica-Bold", 7.4)
            c.setFillColor(colors.HexColor("#92400e"))
            title_str = f"{len(champ_years)}× WORLD CHAMPION" if len(champ_years) > 1 else "WORLD CHAMPION"
            c.drawString(tx_c, cb_y + champ_banner_h - 10.5, title_str)
            yrs_str = ", ".join(str(int(yy)) for yy in champ_years)
            c.setFont("Helvetica-Bold", 6.4)
            c.setFillColor(colors.HexColor("#b45309"))
            c.drawString(tx_c, cb_y + 4.8, _ellipsize(yrs_str, "Helvetica-Bold", 6.4, iw - 30))

            rem_h = cb_y - 3.5 - foot_y
            if badges_non_champ and rem_h >= 12.0:
                bx = ix
                chip_h = min(13.5, rem_h)
                by = foot_y + (rem_h - chip_h) / 2.0
                for b in badges_non_champ:
                    bw = pdfmetrics.stringWidth(b, "Helvetica-Bold", 5.8) + 11.0
                    if bx + bw > ix + iw:
                        break
                    cf, cs, ct = _chip_style(b)
                    c.setFillColor(colors.HexColor(cf))
                    c.setStrokeColor(colors.HexColor(cs))
                    c.setLineWidth(0.55)
                    c.roundRect(bx, by, bw, chip_h, 3.5, fill=1, stroke=1)
                    c.setFont("Helvetica-Bold", 5.8)
                    c.setFillColor(colors.HexColor(ct))
                    c.drawString(bx + 5.5, by + (chip_h - 5.2) / 2.0, b)
                    bx += bw + 4.5
        else:
            # Non-champion balanced Career/Season Highlights bar (+ optional badges strip)
            if badges_non_champ and foot_h > 42.0:
                hl_h = foot_h - 17.0
                hl_y = cur_y - hl_h
                bx = ix
                chip_h = 13.0
                by = foot_y
                for b in badges_non_champ:
                    bw = pdfmetrics.stringWidth(b, "Helvetica-Bold", 5.8) + 11.0
                    if bx + bw > ix + iw:
                        break
                    cf, cs, ct = _chip_style(b)
                    c.setFillColor(colors.HexColor(cf))
                    c.setStrokeColor(colors.HexColor(cs))
                    c.setLineWidth(0.55)
                    c.roundRect(bx, by, bw, chip_h, 3.5, fill=1, stroke=1)
                    c.setFont("Helvetica-Bold", 5.8)
                    c.setFillColor(colors.HexColor(ct))
                    c.drawString(bx + 5.5, by + (chip_h - 5.2) / 2.0, b)
                    bx += bw + 4.5
            else:
                hl_h = foot_h
                hl_y = foot_y

            valid_cars = [cc for cc in cars if cc.get("position") is not None]
            best_pos_car = min(valid_cars, key=lambda cc: int(cc.get("position") or 99)) if valid_cars else {}
            bp = best_pos_car.get("position")
            bp_yr = best_pos_car.get("year")
            streak = int(card.get("win_streak") or 0)
            exp_b = card.get("experience_bonus", 0)
            leg_b = card.get("legacy_bonus", 0)

            c.setFillColor(colors.HexColor("#f1f5f9"))
            c.setStrokeColor(colors.HexColor("#cbd5e1"))
            c.setLineWidth(0.65)
            c.roundRect(ix, hl_y, iw, hl_h, 5.5, fill=1, stroke=1)

            hl_items = [
                ("SEASON FINISH" if is_single_season else "BEST CHAMPIONSHIP", f"P{bp} ({bp_yr})" if (bp and bp_yr) else (f"P{bp}" if bp else "—")),
                ("LEGACY / EXP BONUS", f"+{leg_b} / +{exp_b}"),
                ("WIN STREAK", f"{streak} {'Win' if streak == 1 else 'Wins'}"),
            ]
            col_hw = iw / 3.0
            mid_fy = hl_y + hl_h / 2.0
            for hi, (hl, hv) in enumerate(hl_items):
                hx = ix + hi * col_hw
                if hi > 0:
                    c.setStrokeColor(colors.HexColor("#cbd5e1"))
                    c.setLineWidth(0.5)
                    c.line(hx, hl_y + 5.5, hx, hl_y + hl_h - 5.5)
                c.setFont("Helvetica-Bold", 5.0)
                c.setFillColor(colors.HexColor("#64748b"))
                c.drawString(hx + (col_hw - pdfmetrics.stringWidth(hl, "Helvetica-Bold", 5.0)) / 2.0, mid_fy + 4.2, hl)
                c.setFont("Helvetica-Bold", 8.4)
                c.setFillColor(colors.HexColor("#0f172a"))
                hv_fit = _ellipsize(hv, "Helvetica-Bold", 8.4, col_hw - 6)
                c.drawString(hx + (col_hw - pdfmetrics.stringWidth(hv_fit, "Helvetica-Bold", 8.4)) / 2.0, mid_fy - 7.8, hv_fit)

    def _draw_back_ref(card: dict, idx: int, total: int):
        cw, ch = REF_W, REF_H
        is_champion = _is_card_champion(card)
        rank = int(card.get("rank") or (idx + 1))
        clean_name, _ = _clean_driver_name(card.get("driver", ""))
        nat = (card.get("nationality") or "").upper()
        cars = card.get("cars") or []
        hero_car = _pick_hero_car(card)
        accent_hex = _safe_accent(hero_car.get("colors") or {})
        header_accent = "#d4af37" if is_champion else accent_hex

        # Outer shell
        c.setFillColor(colors.HexColor("#f8fafc"))
        c.roundRect(0, 0, cw, ch, 10, fill=1, stroke=0)
        if is_champion:
            c.setStrokeColor(colors.HexColor("#b45309"))
            c.setLineWidth(1.5)
            c.roundRect(0, 0, cw, ch, 10, fill=0, stroke=1)
        else:
            c.setStrokeColor(colors.HexColor("#1e293b"))
            c.setLineWidth(1.2)
            c.roundRect(0, 0, cw, ch, 10, fill=0, stroke=1)

        # Matching spine
        band_w = 19.0
        grad_cols = [(cc.get("colors") or {}).get("primary") for cc in cars if (cc.get("colors") or {}).get("primary")]
        spine_lbl = f"{_spine_prefix(title)}  •  #{rank}/{total}"
        _draw_spine(0, 0, band_w, ch, grad_cols or [accent_hex], spine_lbl, wins_total=0, show_stars=False, is_champion=is_champion)

        ix = 4.0 + band_w + 6.5
        iw = cw - (4.0 + band_w + 6.5) - 7.5
        cur_y = ch - 7.5

        # ---------------- 1) MATCHING DARK CARBON BACK HEADER ----------------
        hdr_h = 38.0
        hdr_y = cur_y - hdr_h
        c.saveState()
        p_hdr = c.beginPath()
        p_hdr.roundRect(ix, hdr_y, iw, hdr_h, 6)
        c.clipPath(p_hdr, stroke=0, fill=0)
        c.setFillColor(colors.HexColor("#0f172a"))
        c.rect(ix, hdr_y, iw, hdr_h, fill=1, stroke=0)
        c.setFillColor(colors.HexColor(header_accent))
        c.rect(ix, hdr_y, iw, 2.5, fill=1, stroke=0)
        c.restoreState()

        # Nationality Flag + code
        flag_w, flag_h = 30.0, 18.0
        fx = ix + iw - flag_w - 7.0
        fy = hdr_y + 13.5
        _draw_flag(nat, fx, fy, flag_w, flag_h)
        if nat:
            c.setFont("Helvetica-Bold", 5.8)
            c.setFillColor(colors.HexColor("#cbd5e1"))
            nw = pdfmetrics.stringWidth(nat, "Helvetica-Bold", 5.8)
            c.drawString(fx + (flag_w - nw) / 2.0, hdr_y + 5.2, nat)

        name_max_w = max(40.0, fx - (ix + 7.5) - 6.0)
        name_disp = clean_name.upper()
        nfs = _fit_font_size(name_disp, "Helvetica-Bold", name_max_w, 10.5, 8.0)
        c.setFont("Helvetica-Bold", nfs)
        c.setFillColor(colors.white)
        c.drawString(ix + 7.5, hdr_y + hdr_h - 16.5, _ellipsize(name_disp, "Helvetica-Bold", nfs, name_max_w))

        uniq_teams = len({(cc.get("name") or "").strip() for cc in cars if cc.get("name")})
        if len(cars) == 1:
            sub = f"{cars[0].get('year', '')} SEASON CHASSIS  ·  {cars[0].get('name', '').upper()}".strip(" ·")
        else:
            sub = f"CAREER GARAGE  ·  {len(cars)} SEASONS  ·  {uniq_teams} CONSTRUCTORS"
        c.setFont("Helvetica", 5.8)
        c.setFillColor(colors.HexColor("#94a3b8"))
        c.drawString(ix + 7.5, hdr_y + 8.5, _ellipsize(sub, "Helvetica", 5.8, name_max_w))

        cur_y = hdr_y - 6.0

        # ---------------- 2) FOOTER KEY RESERVED HEIGHT ----------------
        foot_h = 24.0
        foot_y = 7.5
        avail_h = cur_y - (foot_y + foot_h + 6.0)

        # ---------------- 3) BODY: SINGLE-SEASON SHOWCASE OR MULTI-SEASON GARAGE ----------------
        n_cars = len(cars)
        if n_cars == 0:
            c.setFillColor(colors.white)
            c.setStrokeColor(colors.HexColor("#cbd5e1"))
            c.roundRect(ix, foot_y + foot_h + 6.0, iw, avail_h, 5, fill=1, stroke=1)
            c.setFont("Helvetica-Oblique", 7.5)
            c.setFillColor(colors.HexColor("#64748b"))
            c.drawString(ix + 12, cur_y - 24, "No constructor season records recorded.")
        elif n_cars == 1:
            # Single-Season Edition Back: Hero 3D Chassis Showcase + Season Telemetry Card
            car = cars[0]
            cpos = int(car.get("cpos") or 0)
            car_cols = car.get("colors") or {}
            bar_col = "#f59e0b" if cpos == 1 else ("#94a3b8" if cpos == 2 else ("#c27803" if cpos == 3 else _safe_accent(car_cols)))

            box_h = 122.0
            box_y = cur_y - box_h
            c.saveState()
            bp = c.beginPath()
            bp.roundRect(ix, box_y, iw, box_h, 6)
            c.clipPath(bp, stroke=0, fill=0)
            c.setFillColor(colors.white)
            c.rect(ix, box_y, iw, box_h, fill=1, stroke=0)
            c.setFillColor(colors.HexColor("#f1f5f9"))
            c.rect(ix, box_y, iw, box_h * 0.32, fill=1, stroke=0)
            r_c, g_c, b_c = _hex_to_rgbf(_safe_accent(car_cols))
            c.setFillColorRGB(r_c, g_c, b_c, alpha=0.09)
            sl2 = c.beginPath()
            sl2.moveTo(ix + iw * 0.22, box_y)
            sl2.lineTo(ix + iw * 0.42, box_y + box_h)
            sl2.lineTo(ix + iw, box_y + box_h)
            sl2.lineTo(ix + iw, box_y)
            sl2.close()
            c.drawPath(sl2, fill=1, stroke=0)
            c.setFillColor(colors.HexColor(bar_col))
            c.rect(ix, box_y, 3.8, box_h, fill=1, stroke=0)
            c.restoreState()

            c.setStrokeColor(colors.HexColor("#cbd5e1"))
            c.setLineWidth(0.75)
            c.roundRect(ix, box_y, iw, box_h, 6, fill=0, stroke=1)

            # Top constructor label + WCC medal pill
            c.setFont("Helvetica-Bold", 8.5)
            c.setFillColor(colors.HexColor("#0f172a"))
            c.drawString(ix + 10, box_y + box_h - 16, _ellipsize(car.get("name", ""), "Helvetica-Bold", 8.5, iw - 92))
            if cpos in (1, 2, 3):
                wcc_txt = {1: "WCC P1 · CHAMPION", 2: "WCC P2 · RUNNER-UP", 3: "WCC P3 · PODIUM"}[cpos]
                wcc_bg = {1: "#fef3c7", 2: "#f1f5f9", 3: "#fdf6ef"}[cpos]
                wcc_fg = {1: "#92400e", 2: "#334155", 3: "#9a3412"}[cpos]
                ww = pdfmetrics.stringWidth(wcc_txt, "Helvetica-Bold", 5.4) + 10
                c.setFillColor(colors.HexColor(wcc_bg))
                c.setStrokeColor(colors.HexColor(bar_col))
                c.setLineWidth(0.6)
                c.roundRect(ix + iw - ww - 7, box_y + box_h - 18.5, ww, 11.5, 3, fill=1, stroke=1)
                c.setFont("Helvetica-Bold", 5.4)
                c.setFillColor(colors.HexColor(wcc_fg))
                c.drawString(ix + iw - ww - 2, box_y + box_h - 14.8, wcc_txt)

            # Large centered 3D Car Render (selected by season YEAR!)
            _draw_car_visual(car.get("name", ""), car_cols, ix + 14, box_y + 12, iw - 28, box_h - 32, year=car.get("year") or card.get("year"))

            # Season Breakdown Panel below chassis showcase
            panel_top = box_y - 7.0
            panel_bot = foot_y + foot_h + 6.0
            panel_h = max(60.0, panel_top - panel_bot)
            sec_h = 14.0
            season_rows = [
                ("Championship Standing", f"P{car.get('position')}" if car.get("position") is not None else "—"),
                ("Championship Points", f"{_fmt_pts_compact(car.get('points', 0))} pts"),
                ("Modern 2025-Scheme Pts", f"{_fmt_num(card.get('points_modern', 0))} pts ({float(card.get('modern_pps') or 0):.1f}/start)"),
                ("Season Wins / Fastest Laps", f"{int(card.get('wins') or 0)} Wins  ·  {int(card.get('fastest_laps') or 0)} FL"),
                ("Clutch Wins / Best Streak", f"{int(card.get('clutch_wins') or 0)} Clutch  ·  {int(card.get('win_streak') or 0)} Streak"),
                ("Career Experience", f"{int(card.get('experience_seasons') or 1)} Seasons  ·  {int(card.get('championships') or 0)} Titles"),
            ]
            s_row_h = (panel_h - sec_h) / len(season_rows)

            c.saveState()
            pp = c.beginPath()
            pp.roundRect(ix, panel_bot, iw, panel_h, 5.5)
            c.clipPath(pp, stroke=0, fill=0)
            c.setFillColor(colors.white)
            c.rect(ix, panel_bot, iw, panel_h, fill=1, stroke=0)
            c.setFillColor(colors.HexColor("#eef2f6"))
            c.rect(ix, panel_top - sec_h, iw, sec_h, fill=1, stroke=0)
            for s_i in range(len(season_rows)):
                sy_r = panel_top - sec_h - (s_i + 1) * s_row_h
                if s_i % 2 == 1:
                    c.setFillColor(colors.HexColor("#f8fafc"))
                    c.rect(ix, sy_r, iw, s_row_h, fill=1, stroke=0)
                c.setStrokeColor(colors.HexColor("#e2e8f0"))
                c.setLineWidth(0.45)
                c.line(ix, sy_r + s_row_h, ix + iw, sy_r + s_row_h)
            c.restoreState()
            c.setStrokeColor(colors.HexColor("#cbd5e1"))
            c.setLineWidth(0.65)
            c.roundRect(ix, panel_bot, iw, panel_h, 5.5, fill=0, stroke=1)
            c.setFont("Helvetica-Bold", 5.8)
            c.setFillColor(colors.HexColor("#475569"))
            c.drawString(ix + 7.5, panel_top - sec_h + 4.3, f"{car.get('year', '')} SEASON BREAKDOWN".strip())

            for s_i, (slbl, sval) in enumerate(season_rows):
                sy_r = panel_top - sec_h - (s_i + 1) * s_row_h
                ty_m = sy_r + (s_row_h - 6.5) / 2.0 + 0.8
                c.setFont("Helvetica", 6.8)
                c.setFillColor(colors.HexColor("#475569"))
                c.drawString(ix + 7.5, ty_m, slbl)
                c.setFont("Helvetica-Bold", 7.1)
                c.setFillColor(colors.HexColor("#0f172a"))
                vw = pdfmetrics.stringWidth(sval, "Helvetica-Bold", 7.1)
                c.drawString(ix + iw - 7.5 - vw, ty_m, sval)

        elif n_cars <= 11:
            # Crisp Single-Column Garage Table (exact right-to-left math -> zero overflow!)
            hdr_row_h = 11.0
            hy = cur_y - hdr_row_h
            pad_r = 5.0
            cw_w, cw_pts, cw_pos, cw_yr = 18.0, 26.0, 21.0, 24.0
            col_gap = 3.0
            x_w = ix + iw - pad_r - cw_w
            x_pts = x_w - col_gap - cw_pts
            x_pos = x_pts - col_gap - cw_pos
            x_yr = x_pos - col_gap - cw_yr
            car_w_px = 40.0
            team_x = ix + 8.0 + car_w_px + 5.0
            team_max_w = max(24.0, x_yr - team_x - 4.0)

            c.setFont("Helvetica-Bold", 5.4)
            c.setFillColor(colors.HexColor("#64748b"))
            c.drawString(team_x, hy + 3.0, "CONSTRUCTOR")
            for lbl, cx_c, cw_c in [("YEAR", x_yr, cw_yr), ("POS", x_pos, cw_pos), ("PTS", x_pts, cw_pts), ("WINS", x_w, cw_w)]:
                tw = pdfmetrics.stringWidth(lbl, "Helvetica-Bold", 5.4)
                c.drawString(cx_c + (cw_c - tw) / 2.0, hy + 3.0, lbl)
            c.setStrokeColor(colors.HexColor("#cbd5e1"))
            c.setLineWidth(0.5)
            c.line(ix, hy, ix + iw, hy)

            rows_avail_h = hy - 4.0 - (foot_y + foot_h + 6.0)
            row_gap = 3.6 if n_cars <= 9 else 2.8
            row_h = min(26.5, (rows_avail_h - max(0, n_cars - 1) * row_gap) / max(1, n_cars))
            ry = hy - 4.0

            for car in cars:
                y_bot_row = ry - row_h
                cpos = int(car.get("cpos") or 0)
                dpos = car.get("position")
                is_wdc = (dpos == 1)
                if cpos == 1:
                    bg, bar_col = "#fffbeb", "#f59e0b"
                elif cpos == 2:
                    bg, bar_col = "#f8fafc", "#94a3b8"
                elif cpos == 3:
                    bg, bar_col = "#fdf6ef", "#c27803"
                else:
                    bg, bar_col = "#ffffff", _safe_accent(car.get("colors") or {})

                c.saveState()
                rp = c.beginPath()
                rp.roundRect(ix, y_bot_row, iw, row_h, 4.5)
                c.clipPath(rp, stroke=0, fill=0)
                c.setFillColor(colors.HexColor(bg))
                c.rect(ix, y_bot_row, iw, row_h, fill=1, stroke=0)
                c.setFillColor(colors.HexColor(bar_col))
                c.rect(ix, y_bot_row, 3.2, row_h, fill=1, stroke=0)
                c.restoreState()

                c.setStrokeColor(colors.HexColor("#f59e0b" if is_wdc else "#e2e8f0"))
                c.setLineWidth(0.75 if is_wdc else 0.6)
                c.roundRect(ix, y_bot_row, iw, row_h, 4.5, fill=0, stroke=1)

                car_h_px = min(row_h - 3.5, 21.0)
                _draw_car_visual(car.get("name", ""), car.get("colors") or {}, ix + 6.5, y_bot_row + (row_h - car_h_px) / 2.0, car_w_px, car_h_px, year=car.get("year"))

                mid_text_y = y_bot_row + (row_h - 6.5) / 2.0 + 0.8
                c.setFont("Helvetica-Bold", 7.3)
                c.setFillColor(colors.HexColor("#0f172a"))
                c.drawString(team_x, mid_text_y, _ellipsize(car.get("name", ""), "Helvetica-Bold", 7.3, team_max_w))

                yr_s = str(car.get("year", ""))
                c.setFont("Helvetica", 6.8)
                c.setFillColor(colors.HexColor("#475569"))
                c.drawString(x_yr + (cw_yr - pdfmetrics.stringWidth(yr_s, "Helvetica", 6.8)) / 2.0, mid_text_y, yr_s)

                pos_s = f"P{dpos}" if dpos is not None else "—"
                pill_h = min(12.0, row_h - 4.0)
                pill_y = y_bot_row + (row_h - pill_h) / 2.0
                if is_wdc:
                    c.setFillColor(colors.HexColor("#fef3c7"))
                    c.setStrokeColor(colors.HexColor("#f59e0b"))
                    c.setLineWidth(0.6)
                    c.roundRect(x_pos, pill_y, cw_pos, pill_h, 3, fill=1, stroke=1)
                    c.setFont("Helvetica-Bold", 6.6)
                    c.setFillColor(colors.HexColor("#92400e"))
                else:
                    c.setFillColor(colors.HexColor("#f1f5f9"))
                    c.roundRect(x_pos, pill_y, cw_pos, pill_h, 3, fill=1, stroke=0)
                    c.setFont("Helvetica-Bold", 6.5)
                    c.setFillColor(colors.HexColor("#334155"))
                c.drawString(x_pos + (cw_pos - pdfmetrics.stringWidth(pos_s, "Helvetica-Bold", 6.5)) / 2.0, pill_y + (pill_h - 5.2) / 2.0, pos_s)

                pts_s = _fmt_pts_compact(car.get("points", 0))
                c.setFont("Helvetica", 6.8)
                c.setFillColor(colors.HexColor("#1e293b"))
                c.drawString(x_pts + (cw_pts - pdfmetrics.stringWidth(pts_s, "Helvetica", 6.8)) / 2.0, mid_text_y, pts_s)

                w_val = int(car.get("wins") or 0)
                w_s = str(w_val) if w_val > 0 else "—"
                w_font = "Helvetica-Bold" if w_val > 0 else "Helvetica"
                c.setFont(w_font, 6.8)
                c.setFillColor(colors.HexColor("#0f172a") if w_val > 0 else colors.HexColor("#94a3b8"))
                c.drawString(x_w + (cw_w - pdfmetrics.stringWidth(w_s, w_font, 6.8)) / 2.0, mid_text_y, w_s)

                ry = y_bot_row - row_gap
        else:
            # Clean 2-column (12–24 seasons) or 3-column (25+ seasons) compact garage grid
            cols_total = 3 if n_cars > 24 else 2
            col_gap = 5.0 if cols_total == 3 else 6.0
            col_w = (iw - col_gap * (cols_total - 1)) / float(cols_total)
            per_col = _math.ceil(n_cars / float(cols_total))
            row_gap = 2.6 if cols_total == 3 else 3.2
            row_h = min(24.0, (avail_h - max(0, per_col - 1) * row_gap) / max(1, per_col))
            car_w_px = 18.0 if cols_total == 3 else 27.0
            tf_sz = 5.3 if cols_total == 3 else 6.2
            sf_sz = 4.8 if cols_total == 3 else 5.6

            for col_i in range(cols_total):
                cx = ix + col_i * (col_w + col_gap)
                ry = cur_y
                chunk = cars[col_i * per_col : (col_i + 1) * per_col]
                for car in chunk:
                    y_bot_row = ry - row_h
                    cpos = int(car.get("cpos") or 0)
                    dpos = car.get("position")
                    is_wdc = (dpos == 1)
                    if cpos == 1:
                        bg, bar_col = "#fffbeb", "#f59e0b"
                    elif cpos == 2:
                        bg, bar_col = "#f8fafc", "#94a3b8"
                    elif cpos == 3:
                        bg, bar_col = "#fdf6ef", "#c27803"
                    else:
                        bg, bar_col = "#ffffff", _safe_accent(car.get("colors") or {})

                    c.saveState()
                    rp = c.beginPath()
                    rp.roundRect(cx, y_bot_row, col_w, row_h, 3.8)
                    c.clipPath(rp, stroke=0, fill=0)
                    c.setFillColor(colors.HexColor(bg))
                    c.rect(cx, y_bot_row, col_w, row_h, fill=1, stroke=0)
                    c.setFillColor(colors.HexColor(bar_col))
                    c.rect(cx, y_bot_row, 2.8, row_h, fill=1, stroke=0)
                    c.restoreState()

                    c.setStrokeColor(colors.HexColor("#f59e0b" if is_wdc else "#e2e8f0"))
                    c.setLineWidth(0.7 if is_wdc else 0.5)
                    c.roundRect(cx, y_bot_row, col_w, row_h, 3.8, fill=0, stroke=1)

                    car_h_px = min(row_h - 3.5, 14.0 if cols_total == 2 else 10.0)
                    _draw_car_visual(car.get("name", ""), car.get("colors") or {}, cx + 4.2, y_bot_row + (row_h - car_h_px) / 2.0, car_w_px, car_h_px, year=car.get("year"))

                    tx_c = cx + 4.2 + car_w_px + 3.0
                    tw_max = max(14.0, (cx + col_w - 3.5) - tx_c)
                    yr_s = str(car.get("year", ""))
                    c.setFont("Helvetica-Bold", sf_sz + 0.3)
                    yr_w = pdfmetrics.stringWidth(yr_s, "Helvetica-Bold", sf_sz + 0.3)
                    c.setFillColor(colors.HexColor("#64748b"))
                    c.drawString(cx + col_w - 3.5 - yr_w, y_bot_row + row_h - (8.2 if row_h >= 19 else 7.0), yr_s)

                    c.setFont("Helvetica-Bold", tf_sz)
                    c.setFillColor(colors.HexColor("#0f172a"))
                    t_fit = _ellipsize(car.get("name", ""), "Helvetica-Bold", tf_sz, max(8.0, tw_max - yr_w - 2.5))
                    c.drawString(tx_c, y_bot_row + row_h - (8.2 if row_h >= 19 else 7.0), t_fit)

                    pos_s = f"P{dpos}" if dpos is not None else "—"
                    pts_s = f"{_fmt_pts_compact(car.get('points', 0))} pts"
                    w_val = int(car.get("wins") or 0)
                    stat_line = f"{pos_s}  ·  {pts_s}  ·  {w_val}W"
                    s_font = "Helvetica-Bold" if is_wdc else "Helvetica"
                    c.setFont(s_font, sf_sz)
                    c.setFillColor(colors.HexColor("#b45309") if is_wdc else colors.HexColor("#475569"))
                    c.drawString(tx_c, y_bot_row + (3.2 if row_h >= 19 else 2.4), _ellipsize(stat_line, s_font, sf_sz, tw_max))

                    ry = y_bot_row - row_gap

        # ---------------- 4) COMPACT 2-LINE FOOTER KEY ----------------
        c.setFillColor(colors.HexColor("#f1f5f9"))
        c.setStrokeColor(colors.HexColor("#cbd5e1"))
        c.setLineWidth(0.55)
        c.roundRect(ix, foot_y, iw, foot_h, 4.5, fill=1, stroke=1)

        ly1 = foot_y + 13.8
        kx = ix + 6.5
        c.setFont("Helvetica-Bold", 5.4)
        c.setFillColor(colors.HexColor("#475569"))
        c.drawString(kx, ly1, "WCC BAR:")
        kx += pdfmetrics.stringWidth("WCC BAR:", "Helvetica-Bold", 5.4) + 5.0
        for dot_col, dot_lbl in [("#f59e0b", "P1 Gold"), ("#94a3b8", "P2 Silver"), ("#c27803", "P3 Bronze")]:
            c.setFillColor(colors.HexColor(dot_col))
            c.roundRect(kx, ly1 - 0.5, 4.5, 5.5, 1.0, fill=1, stroke=0)
            kx += 6.5
            c.setFont("Helvetica", 5.4)
            c.setFillColor(colors.HexColor("#334155"))
            c.drawString(kx, ly1, dot_lbl)
            kx += pdfmetrics.stringWidth(dot_lbl, "Helvetica", 5.4) + 7.5
        c.setFont("Helvetica-Bold", 5.4)
        c.setFillColor(colors.HexColor("#92400e"))
        c.drawString(kx, ly1, "P1 = World Title")

        ly2 = foot_y + 4.8
        if game_mode:
            note = "GAME EDITION: High ▲ wins (0–99) · Low ▼ wins DNF% · Pair with /cards/tracks.pdf Weather Deck"
        else:
            note = "Modern Pts re-scored to 2025 F1 system  ·  Legacy OVR includes top-5 peak & seasons bonus"
        c.setFont("Helvetica-Oblique", 5.2)
        c.setFillColor(colors.HexColor("#64748b"))
        c.drawString(ix + 6.5, ly2, _ellipsize(note, "Helvetica-Oblique", 5.2, iw - 13.0))

    def draw_card(card: dict, x: float, y: float, idx: int, total: int):
        c.saveState()
        c.translate(x, y)
        if abs(card_w - REF_W) > 0.5 or abs(card_h - REF_H) > 0.5:
            c.scale(card_w / REF_W, card_h / REF_H)
        _draw_front_ref(card, idx, total)
        c.restoreState()

    def draw_card_back(card: dict, x: float, y: float, idx: int, total: int):
        c.saveState()
        c.translate(x, y)
        if abs(card_w - REF_W) > 0.5 or abs(card_h - REF_H) > 0.5:
            c.scale(card_w / REF_W, card_h / REF_H)
        _draw_back_ref(card, idx, total)
        c.restoreState()

    total_cards = len(cards)
    if fold_mode:
        def pos(col: int, row: int) -> tuple[float, float]:
            px = margin + col * (card_w + margin)
            py = page_h - margin - (row + 1) * card_h - row * margin
            return px, py

        i = 0
        while i < len(cards):
            c.setStrokeColor(colors.HexColor("#cbd5e1"))
            c.setLineWidth(0.75)
            c.setDash(4, 4)
            c.line(page_w / 2.0, margin / 2.0, page_w / 2.0, page_h - margin / 2.0)
            c.line(margin / 2.0, page_h / 2.0, page_w - margin / 2.0, page_h / 2.0)
            c.setDash()
            x_f0, y_f0 = pos(0, 0)
            draw_card(cards[i], x_f0, y_f0, i, total_cards)
            x_b0, y_b0 = pos(1, 0)
            draw_card_back(cards[i], x_b0, y_b0, i, total_cards)
            if i + 1 < len(cards):
                x_f1, y_f1 = pos(0, 1)
                draw_card(cards[i + 1], x_f1, y_f1, i + 1, total_cards)
                x_b1, y_b1 = pos(1, 1)
                draw_card_back(cards[i + 1], x_b1, y_b1, i + 1, total_cards)
            c.showPage()
            i += 2
    else:
        i = 0
        for idx, card in enumerate(cards):
            col = i % cols
            row = (i // cols) % rows
            x = x0 + col * (card_w + gap)
            y = y0 + (rows - 1 - row) * (card_h + gap)
            draw_card(card, x, y, idx, total_cards)
            i += 1
            if i % (cols * rows) == 0 or idx == len(cards) - 1:
                c.showPage()
                j = ((i - 1) // (cols * rows)) * (cols * rows)
                for k in range(cols * rows):
                    if j + k >= len(cards):
                        break
                    col2 = k % cols
                    row2 = (k // cols) % rows
                    xb = x0 + col2 * (card_w + gap)
                    yb = y0 + (rows - 1 - row2) * (card_h + gap)
                    draw_card_back(cards[j + k], xb, yb, j + k, total_cards)
                c.showPage()

    c.save()
    return buf.getvalue()


def _render_tracks_pdf() -> bytes:
    """Render the 12-card printable Circuit & Weather Track Deck (4 cards per US Letter page)."""
    from io import BytesIO
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfgen import canvas
    from .game import TRACK_DECK

    buf = BytesIO()
    page_w, page_h = letter
    margin = 0.3 * inch
    card_w = (page_w - 3 * margin) / 2.0
    card_h = (page_h - 3 * margin) / 2.0
    c = canvas.Canvas(buf, pagesize=(page_w, page_h))

    flag_map = {
        "ITA": "it", "MON": "mc", "BEL": "be", "BRA": "br", "GBR": "gb", "JPN": "jp",
        "SGP": "sg", "AZE": "az", "CAN": "ca", "AUT": "at", "USA": "us", "UAE": "ae",
    }

    def _wrap_text(txt: str, font_name: str, font_sz: float, max_w: float) -> list[str]:
        words = (txt or "").split()
        lines: list[str] = []
        cur = ""
        for w in words:
            cand = f"{cur} {w}".strip()
            if pdfmetrics.stringWidth(cand, font_name, font_sz) <= max_w:
                cur = cand
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        return lines

    def _draw_track_card(tr: dict, x: float, y: float, idx: int, total: int):
        accent = tr["accent"]
        weather = tr["weather"]
        # Outer dark racing cardstock frame
        c.setFillColor(colors.HexColor("#0f172a"))
        c.roundRect(x, y, card_w, card_h, 10, fill=1, stroke=0)
        c.setStrokeColor(colors.HexColor(accent))
        c.setLineWidth(2.0)
        c.roundRect(x, y, card_w, card_h, 10, fill=0, stroke=1)

        ix = x + 12.0
        iw = card_w - 24.0
        cur_y = y + card_h - 14.0

        # Top deck tag + card number
        c.setFont("Helvetica-Bold", 6.2)
        c.setFillColor(colors.HexColor("#94a3b8"))
        c.drawString(ix, cur_y - 6.0, "CIRCUIT & WEATHER DECK")
        num_s = f"TRACK #{idx + 1}/{total}"
        c.drawString(ix + iw - pdfmetrics.stringWidth(num_s, "Helvetica-Bold", 6.2), cur_y - 6.0, num_s)
        cur_y -= 14.0

        # Weather banner pill
        wb_h = 20.0
        wb_y = cur_y - wb_h
        c.setFillColor(colors.HexColor(accent))
        c.roundRect(ix, wb_y, iw, wb_h, 4.5, fill=1, stroke=0)
        c.setFont("Helvetica-Bold", 8.2)
        c.setFillColor(colors.white)
        wl = tr["weather_label"]
        c.drawString(ix + (iw - pdfmetrics.stringWidth(wl, "Helvetica-Bold", 8.2)) / 2.0, wb_y + 6.5, wl)
        cur_y = wb_y - 12.0

        # Circuit Title + Flag
        flag_iso = flag_map.get(tr.get("nat3", ""))
        flag_path = (BASE_DIR / "data" / "flags" / f"{flag_iso}.png") if flag_iso else None
        if flag_path and flag_path.exists():
            try:
                c.saveState()
                fp = c.beginPath()
                fp.roundRect(ix + iw - 34, cur_y - 19, 34, 20, 3)
                c.clipPath(fp, stroke=0, fill=0)
                c.drawImage(ImageReader(str(flag_path)), ix + iw - 34, cur_y - 19, width=34, height=20, preserveAspectRatio=False, mask="auto")
                c.restoreState()
            except Exception:
                pass
        title_fs = 15.0
        t_name = tr["name"].upper()
        while title_fs > 10.0 and pdfmetrics.stringWidth(t_name, "Helvetica-Bold", title_fs) > (iw - 42):
            title_fs -= 0.5
        c.setFont("Helvetica-Bold", title_fs)
        c.setFillColor(colors.white)
        c.drawString(ix, cur_y - 12.0, t_name)
        c.setFont("Helvetica", 7.2)
        c.setFillColor(colors.HexColor("#cbd5e1"))
        c.drawString(ix, cur_y - 24.5, tr["subtitle"])
        cur_y -= 36.0

        # Big Track Modifier Showcase Card
        mod_h = 92.0
        mod_y = cur_y - mod_h
        c.setFillColor(colors.HexColor("#1e293b"))
        c.setStrokeColor(colors.HexColor("#334155"))
        c.setLineWidth(0.8)
        c.roundRect(ix, mod_y, iw, mod_h, 6, fill=1, stroke=1)

        boost_stat = tr["boost_stat"].upper().replace("_", " ")
        boost_delta = int(tr.get("boost_delta") or 0)
        headline = f"{boost_stat}  +{boost_delta}" if boost_delta > 0 else "LOW DNF% SHINES"
        c.setFont("Helvetica-Bold", 6.2)
        c.setFillColor(colors.HexColor("#94a3b8"))
        lbl_m = "ACTIVE TRACK MODIFIER"
        c.drawString(ix + (iw - pdfmetrics.stringWidth(lbl_m, "Helvetica-Bold", 6.2)) / 2.0, mod_y + mod_h - 15.0, lbl_m)

        c.setFont("Helvetica-Bold", 20.0)
        c.setFillColor(colors.HexColor("#fde047") if weather in ("WET", "CHAOS") else colors.white)
        c.drawString(ix + (iw - pdfmetrics.stringWidth(headline, "Helvetica-Bold", 20.0)) / 2.0, mod_y + mod_h - 44.0, headline)

        # Underdog Chaos Bonus badge
        ub = int(tr.get("underdog_bonus") or 0)
        if ub > 0:
            ub_txt = f"UNDERDOG CHAOS BONUS: +{ub} (IF OVR < 78)"
            ub_w = min(iw - 16, pdfmetrics.stringWidth(ub_txt, "Helvetica-Bold", 6.5) + 16)
            c.setFillColor(colors.HexColor("#14532d"))
            c.setStrokeColor(colors.HexColor("#22c55e"))
            c.setLineWidth(0.75)
            c.roundRect(ix + (iw - ub_w) / 2.0, mod_y + 14.0, ub_w, 18.0, 4, fill=1, stroke=1)
            c.setFont("Helvetica-Bold", 6.5)
            c.setFillColor(colors.HexColor("#dcfce7"))
            c.drawString(ix + (iw - pdfmetrics.stringWidth(ub_txt, "Helvetica-Bold", 6.5)) / 2.0, mod_y + 20.2, ub_txt)
        else:
            pb_txt = "PURE PACE CIRCUIT · NO UNDERDOG EQUALISER"
            c.setFont("Helvetica-Bold", 6.0)
            c.setFillColor(colors.HexColor("#94a3b8"))
            c.drawString(ix + (iw - pdfmetrics.stringWidth(pb_txt, "Helvetica-Bold", 6.0)) / 2.0, mod_y + 18.0, pb_txt)

        cur_y = mod_y - 10.0

        # Tabletop Rule Box
        rule_h = 68.0
        rule_y = cur_y - rule_h
        c.setFillColor(colors.HexColor("#f8fafc"))
        c.roundRect(ix, rule_y, iw, rule_h, 5.5, fill=1, stroke=0)
        c.setFillColor(colors.HexColor(accent))
        c.rect(ix, rule_y, 3.8, rule_h, fill=1, stroke=0)
        c.setFont("Helvetica-Bold", 6.4)
        c.setFillColor(colors.HexColor("#475569"))
        c.drawString(ix + 10.0, rule_y + rule_h - 14.0, "ROUND RULE")
        c.setFont("Helvetica-Bold", 8.0)
        c.setFillColor(colors.HexColor("#0f172a"))
        ry_t = rule_y + rule_h - 28.0
        for ln in _wrap_text(tr["rule"], "Helvetica-Bold", 8.0, iw - 18.0)[:4]:
            c.drawString(ix + 10.0, ry_t, ln)
            ry_t -= 11.0

        # Flavour quote at bottom
        c.setFont("Helvetica-Oblique", 6.6)
        c.setFillColor(colors.HexColor("#94a3b8"))
        fy_t = rule_y - 16.0
        for ln in _wrap_text(f"“{tr['flavour']}”", "Helvetica-Oblique", 6.6, iw)[:3]:
            c.drawString(ix, fy_t, ln)
            fy_t -= 9.5

        # Bottom check bar
        c.setFont("Helvetica-Bold", 5.5)
        c.setFillColor(colors.HexColor("#64748b"))
        c.drawString(ix, y + 11.0, "FLIP ONE TRACK CARD PER ROUND  ·  LOCAL F1 GAME EDITION")

    total = len(TRACK_DECK)
    for page_start in range(0, total, 4):
        c.setStrokeColor(colors.HexColor("#cbd5e1"))
        c.setLineWidth(0.75)
        c.setDash(4, 4)
        c.line(page_w / 2.0, margin / 2.0, page_w / 2.0, page_h - margin / 2.0)
        c.line(margin / 2.0, page_h / 2.0, page_w - margin / 2.0, page_h / 2.0)
        c.setDash()
        for slot in range(4):
            idx = page_start + slot
            if idx >= total:
                break
            col = slot % 2
            row = slot // 2
            px = margin + col * (card_w + margin)
            py = page_h - margin - (row + 1) * card_h - row * margin
            _draw_track_card(TRACK_DECK[idx], px, py, idx, total)
        c.showPage()

    c.save()
    return buf.getvalue()
