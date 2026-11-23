#!/usr/bin/env python3
"""
Upgrade all F1 driver portraits in data/driver_images/ and data/f1.sqlite.

3-Tier Portrait Pipeline:
  Tier 1 — Official 2026 & 2025 Formula1.com 720px studio portraits (cropped to crisp 5:6 head-and-shoulders busts)
  Tier 2 — Official 2018-2024 Formula1.com 840x840 studio headshots
  Tier 3 — High-resolution (640-800px) verified Wikipedia / Wikidata P18 / Wikimedia Commons portraits
           with strict filtering against maps, flags, logos, helmets, SVGs, and cars.

Also removes bogus Wikipedia World-Map placeholders where no real human portrait exists
(so cards display the clean team-coloured Driver Monogram instead of a map).
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
import re
import sqlite3
import sys
import time
import unicodedata
import urllib.parse
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageOps

REPO = Path(__file__).resolve().parent.parent
DB_PATH = REPO / "data" / "f1.sqlite"
IMG_DIR = REPO / "data" / "driver_images"

UA_BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36"
UA_WIKI = "LocalF1/2.0 (+https://github.com/local; portrait-upgrade)"

# Explicit mapping for F1.com 2026 slug codes -> exact DB driver names
F1_2026_CODE_TO_DRIVER = {
    "fracol01": "Franco Colapinto COL",
    "piegas01": "Pierre Gasly GAS",
    "feralo01": "Fernando Alonso ALO",
    "lanstr01": "Lance Stroll STR",
    "gabbor01": "Gabriel Bortoleto BOR",
    "nichul01": "Nico Hulkenberg HUL",
    "serper01": "Sergio Perez PER",
    "valbot01": "Valtteri Bottas BOT",
    "chalec01": "Charles Leclerc LEC",
    "lewham01": "Lewis Hamilton HAM",
    "olibea01": "Oliver Bearman BEA",
    "rafcam01": "Rafael Camara CAM",
    "lannor01": "Lando Norris NOR",
    "oscpia01": "Oscar Piastri PIA",
    "andant01": "Kimi Antonelli ANT",
    "georus01": "George Russell RUS",
    "arvlin01": "Arvid Lindblad LIN",
    "lialaw01": "Liam Lawson LAW",
    "isahad01": "Isack Hadjar HAD",
    "maxver01": "Max Verstappen VER",
    "alealb01": "Alexander Albon ALB",
    "carsai01": "Carlos Sainz SAI",
}

F1_2025_EXTRA = {
    "Esteban Ocon OCO": "https://media.formula1.com/image/upload/c_lfill,w_720/q_auto/v1740000001/common/f1/2025/haasf1team/estoco01/2025haasf1teamestoco01right.webp",
    "Yuki Tsunoda TSU": "https://media.formula1.com/image/upload/c_lfill,w_720/q_auto/v1740000001/common/f1/2025/redbullracing/yuktsu01/2025redbullracingyuktsu01right.webp",
    "Jack Doohan DOO": "https://media.formula1.com/image/upload/c_lfill,w_720/q_auto/v1740000001/common/f1/2025/alpine/jacdoo01/2025alpinejacdoo01right.webp",
}

F1_LEGACY_EXTRA = {
    "Zhou Guanyu ZHO": "https://media.formula1.com/content/dam/fom-website/drivers/G/GUAZHO01_Guanyu_Zhou/guazho01.png",
    "Guanyu Zhou ZHO": "https://media.formula1.com/content/dam/fom-website/drivers/G/GUAZHO01_Guanyu_Zhou/guazho01.png",
    "Nyck De Vries DEV": "https://media.formula1.com/content/dam/fom-website/drivers/N/NYCDEV01_Nyck_De_Vries/nycdev01.png",
    "Nyck de Vries DEV": "https://media.formula1.com/content/dam/fom-website/drivers/N/NYCDEV01_Nyck_De_Vries/nycdev01.png",
}

# Reject URLs/filenames that are clearly maps, flags, logos, helmets, circuits, or cars
BAD_URL_TOKENS = (
    "formula_one_drivers_by_country",
    "world_map", "blankmap", "map_of_", "location_map",
    "flag_of_", "bandeira", "drapeau", "fahne",
    ".svg", "coat_of_arms", "emblem", "crest", "logo", "icon",
    "silhouette", "placeholder", "no_image", "question_mark", "ambox", "edit-clear",
    "signature", "autograph", "helmet", "casco",
    "circuit", "track_map", "layout", "diagram",
)

CAR_TOKENS = (
    "ferrari_f", "ferrari_312", "ferrari_156", "ferrari_500", "mclaren_m", "mclaren_mp",
    "lotus_49", "lotus_72", "lotus_79", "williams_fw", "brabham_bt", "tyrrell_",
    "cooper_t", "brm_p", "maserati_250", "vanwall", "march_7", "ligier_js", "benetton_b",
    "jordan_1", "sauber_c", "minardi_m", "arrows_a", "red_bull_rb", "mercedes_w",
    "goodwood", "pitlane", "pit_lane", "starting_grid", "monaco_grand_prix",
    "british_grand_prix", "italian_grand_prix", "silverstone_classic", "race_car",
)

# Explicit Wikipedia article overrides for ambiguous names or DB typos
WIKI_TITLE_OVERRIDES = {
    "Michael Andretti": "Michael Andretti",
    "Mario Andretti": "Mario Andretti",
    "Ryo Hirakawa": "Ryō Hirakawa",
    "Prince Bira": "Bira (prince)",
    "JJ Lehto": "JJ Lehto",
    "J.J. Lehto": "JJ Lehto",
    "Keke Rosberg": "Keke Rosberg",
    "Niki Lauda": "Niki Lauda",
    "Gilles Villeneuve": "Gilles Villeneuve",
    "Jacques Villeneuve": "Jacques Villeneuve",
    "Damon Hill": "Damon Hill",
    "Graham Hill": "Graham Hill",
    "Phil Hill": "Phil Hill",
    "Jody Scheckter": "Jody Scheckter",
    "Ronnie Peterson": "Ronnie Peterson",
    "Stefan Bellof": "Stefan Bellof",
    "Mike Hawthorn": "Mike Hawthorn",
    "Peter Collins": "Peter Collins (racing driver)",
    "Bob Anderson": "Bob Anderson (racing driver)",
    "John Taylor": "John Taylor (racing driver)",
    "Trevor Taylor": "Trevor Taylor (racing driver)",
    "Mike Taylor": "Mike Taylor (racing driver)",
    "Dennis Poore": "Dennis Poore",
    "Chris Irwin": "Chris Irwin",
    "Paul Frere": "Paul Frère",
    "Rene Arnoux": "René Arnoux",
    "Francois Cevert": "François Cevert",
    "Jose Froilan Gonzalez": "José Froilán González",
    "Kimi Raikkonen": "Kimi Räikkönen",
    "Mika Hakkinen": "Mika Häkkinen",
    "Sergio Perez": "Sergio Pérez",
    "Nico Hulkenberg": "Nico Hülkenberg",
    "Esteban Gutierrez": "Esteban Gutiérrez",
    "Antonio Pizzonia": "Antônio Pizzonia",
    "Rubens Barrichello": "Rubens Barrichello",
    "Nelson Piquet": "Nelson Piquet",
    "Emerson Fittipaldi": "Emerson Fittipaldi",
    "Ayrton Senna": "Ayrton Senna",
    "Juan Manuel Fangio": "Juan Manuel Fangio",
    "Carlos Reutemann": "Carlos Reutemann",
    "Stirling Moss": "Stirling Moss",
    "Alberto Ascari": "Alberto Ascari",
    "Jim Clark": "Jim Clark",
    "Jackie Stewart": "Jackie Stewart",
    "Alain Prost": "Alain Prost",
    "Michael Schumacher": "Michael Schumacher",
    "Ralf Schumacher": "Ralf Schumacher",
    "Juan Pablo Montoya": "Juan Pablo Montoya",
    "Scott Speed": "Scott Speed",
    "Christian Danner": "Christian Danner",
    "Eric Bernard": "Éric Bernard",
    "Johnny Dumfries": "Johnny Dumfries",
    "Innes Ireland": "Innes Ireland",
    "Peter Gethin": "Peter Gethin",
    "Tim Schenken": "Tim Schenken",
    "George Follmer": "George Follmer",
    "Jim Hall": "Jim Hall (racing driver)",
    "Bill Vukovich": "Bill Vukovich",
    "Sam Hanks": "Sam Hanks",
    "Rodger Ward": "Rodger Ward",
    "Jim Rathmann": "Jim Rathmann",
    "Jimmy Bryan": "Jimmy Bryan",
    "Johnnie Parsons": "Johnnie Parsons",
    "Lee Wallard": "Lee Wallard",
    "Bob Sweikert": "Bob Sweikert",
    "Bill Holland": "Bill Holland",
    "Duane Carter": "Duane Carter",
    "Jack McGrath": "Jack McGrath (racing driver)",
    "Art Cross": "Art Cross",
    "Paul Russo": "Paul Russo",
    "Johnny Thomson": "Johnny Thomson",
    "Johnny Boyd": "Johnny Boyd",
    "Jimmy Davies": "Jimmy Davies",
    "George Amick": "George Amick",
    "Mike Nazaruk": "Mike Nazaruk",
    "Jack Fairman": "Jack Fairman",
    "Mike Spence": "Mike Spence",
    "Ron Flockhart": "Ron Flockhart (racing driver)",
    "Robert Manzon": "Robert Manzon",
    "Neville Lederle": "Neville Lederle",
}


def strip_code3(driver_name: str) -> str:
    return re.sub(r"\s+[A-Z]{3}$", "", (driver_name or "").strip()).strip()


def clean_ascii(txt: str) -> str:
    txt = unicodedata.normalize("NFKD", txt).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Za-z]", "", txt)


def make_studio_bg(w: int, h: int) -> Image.Image:
    """Create a subtle motorsport studio gradient backdrop for transparent F1 cutouts."""
    bg = Image.new("RGB", (w, h), (234, 240, 247))
    draw = ImageDraw.Draw(bg)
    # Soft vertical + edge shading from crisp studio silver-white to cool slate bottom
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(242 - t * 26)
        g = int(246 - t * 23)
        b = int(251 - t * 18)
        draw.line([(0, y), (w, y)], fill=(r, g, b))
    return bg


def render_f1_cutout_bust(img_bytes: bytes, is_full_body: bool) -> bytes:
    """Crop an official F1.com RGBA studio cutout into a crisp 560x672 (5:6) bust JPEG."""
    im = Image.open(BytesIO(img_bytes)).convert("RGBA")
    w, h = im.size
    alpha = im.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        raise ValueError("Empty alpha channel")
    x0, y0, x1, y1 = bbox

    if is_full_body or (h > w * 1.45):
        # Full-body cutout (e.g. 720x2069): focus on head + shoulders + upper race suit chest!
        body_h = y1 - y0
        bust_h = int(body_h * 0.36)
        top = max(0, y0 - int(bust_h * 0.06))
        bot = min(h, top + bust_h)
        # Find horizontal center of the head/shoulders region
        upper_bbox = alpha.crop((0, top, w, bot)).getbbox()
        if upper_bbox:
            cx = (upper_bbox[0] + upper_bbox[2]) // 2
        else:
            cx = (x0 + x1) // 2
        bust_w = int((bot - top) * (5.0 / 6.0))
        left = max(0, min(w - bust_w, cx - bust_w // 2))
        right = min(w, left + bust_w)
        crop = im.crop((left, top, right, bot))
    else:
        # Square/headshot cutout (e.g. 840x840): trim neatly to 5:6 head-and-shoulders
        subj_h = y1 - y0
        top = max(0, y0 - int(subj_h * 0.06))
        bot = y1
        ch = bot - top
        cw = int(ch * (5.0 / 6.0))
        cx = (x0 + x1) // 2
        left = cx - cw // 2
        right = left + cw
        # Pad if needed so shoulders aren't clipped
        canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        src_l = max(0, left)
        src_r = min(w, right)
        dst_x = src_l - left
        canvas.paste(im.crop((src_l, top, src_r, bot)), (dst_x, 0))
        crop = canvas

    target_w, target_h = 560, 672
    crop = crop.resize((target_w, target_h), Image.Resampling.LANCZOS)
    bg = make_studio_bg(target_w, target_h)
    bg.paste(crop, (0, 0), crop)
    out = BytesIO()
    bg.save(out, format="JPEG", quality=91, optimize=True)
    return out.getvalue()


def normalize_photo_jpeg(img_bytes: bytes, max_dim: int = 760) -> tuple[bytes, int, int]:
    """Normalize a standard photo (Wikipedia/Commons) to a clean high-res JPEG."""
    im = Image.open(BytesIO(img_bytes))
    im = ImageOps.exif_transpose(im)
    if im.mode in ("RGBA", "LA", "P"):
        rgba = im.convert("RGBA")
        bg = make_studio_bg(rgba.width, rgba.height)
        bg.paste(rgba, (0, 0), rgba)
        im = bg
    elif im.mode != "RGB":
        im = im.convert("RGB")

    w, h = im.size
    if w < 120 or h < 120:
        raise ValueError(f"Image too small: {w}x{h}")

    # Gently trim extreme ultra-wide panoramic photos (>1.65 aspect) to 4:3 centered
    if w > h * 1.65:
        new_w = int(h * 1.35)
        left = (w - new_w) // 2
        im = im.crop((left, 0, left + new_w, h))
        w, h = im.size

    if max(w, h) > max_dim:
        im.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        w, h = im.size

    out = BytesIO()
    im.save(out, format="JPEG", quality=90, optimize=True)
    return out.getvalue(), w, h


def is_bad_url(url: str) -> bool:
    low = urllib.parse.unquote(url or "").lower()
    return any(tok in low for tok in BAD_URL_TOKENS)


def is_car_url(url: str) -> bool:
    low = urllib.parse.unquote(url or "").lower()
    return any(tok in low for tok in CAR_TOKENS)


def is_world_map_image(path: Path) -> bool:
    """Detect the ubiquitous Wikipedia 'Formula One drivers by country' world map PNG."""
    if not path.exists():
        return False
    try:
        with Image.open(path) as im:
            w, h = im.size
            if path.suffix.lower() == ".png" and 315 <= w <= 345 and 160 <= h <= 178:
                rgba = im.convert("RGBA")
                corners = [rgba.getpixel((2, 2)), rgba.getpixel((w - 3, 2)), rgba.getpixel((2, h - 3))]
                # World map has either transparent (alpha==0) or pure white corners
                if all(c[3] < 20 or (c[0] > 245 and c[1] > 245 and c[2] > 245) for c in corners):
                    return True
    except Exception:
        pass
    return False


def discover_f1_2026_urls(session: requests.Session) -> dict[str, str]:
    """Scrape all 22 official 2026 Formula1.com driver cutout URLs."""
    mapping: dict[str, str] = {}
    try:
        r = session.get("https://www.formula1.com/en/drivers", headers={"User-Agent": UA_BROWSER}, timeout=15)
        if r.status_code != 200:
            return mapping
        urls = set(re.findall(r'https://media\.formula1\.com/image/upload/[^"\'\s<>\\]+', r.text))
        for u in urls:
            if "/common/f1/2026/" not in u or "right.webp" not in u:
                continue
            m = re.search(r'/([a-z]{6}\d{2})/', u)
            if m and m.group(1) in F1_2026_CODE_TO_DRIVER:
                drv = F1_2026_CODE_TO_DRIVER[m.group(1)]
                mapping[drv] = u.replace("w_440", "w_720")
    except Exception as exc:
        print(f"Warning: F1.com 2026 discovery failed: {exc}", file=sys.stderr)
    return mapping


def find_f1_legacy_url(session: requests.Session, driver_name: str) -> str | None:
    if driver_name in F1_LEGACY_EXTRA:
        return F1_LEGACY_EXTRA[driver_name]
    base = strip_code3(driver_name)
    parts = base.split()
    if len(parts) < 2:
        return None
    fa, la = clean_ascii(parts[0]), clean_ascii(parts[-1])
    if len(fa) < 2 or len(la) < 2:
        return None
    for num in ("01", "02"):
        code = (fa[:3] + la[:3] + num).upper()
        url = f"https://media.formula1.com/content/dam/fom-website/drivers/{code[0]}/{code}_{fa}_{la}/{code.lower()}.png"
        try:
            r = session.head(url, headers={"User-Agent": UA_BROWSER}, timeout=6)
            if r.status_code == 200:
                return url
        except Exception:
            pass
    return None


def _wiki_get(session: requests.Session, url: str, params: dict | None = None, timeout: int = 10) -> dict | None:
    for attempt in range(2):
        try:
            r = session.get(url, params=params, headers={"User-Agent": UA_WIKI}, timeout=timeout)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 429:
                time.sleep(1.0 + attempt)
        except Exception:
            time.sleep(0.3)
    return None


def resolve_wiki_title(session: requests.Session, base_name: str) -> str | None:
    if base_name in WIKI_TITLE_OVERRIDES:
        return WIKI_TITLE_OVERRIDES[base_name]

    surname = clean_ascii(base_name.split()[-1]).lower()
    # 1. Try direct page summary first (fastest & most accurate!)
    s_direct = _wiki_get(session, f"https://en.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(base_name)}")
    if s_direct and s_direct.get("type") == "standard":
        desc = (s_direct.get("description") or "" + " " + (s_direct.get("extract") or "")).lower()
        if any(k in desc for k in ("formula one", "racing driver", "motorsport", "grand prix", "indianapolis 500", "f1")):
            return s_direct.get("title") or base_name

    # 2. Try "(racing driver)" disambiguation
    s_dis = _wiki_get(session, f"https://en.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(base_name + ' (racing driver)')}")
    if s_dis and s_dis.get("type") == "standard":
        return s_dis.get("title")

    # 3. Search Wikipedia and pick the first valid biographical driver article
    for q in (f'"{base_name}" Formula One driver', f'"{base_name}" racing driver', f"{base_name} racing driver"):
        js = _wiki_get(
            session,
            "https://en.wikipedia.org/w/api.php",
            {"action": "query", "list": "search", "srsearch": q, "format": "json", "srlimit": 5},
        )
        for hit in (js or {}).get("query", {}).get("search", []):
            title = hit.get("title") or ""
            tlow = title.lower()
            if tlow.startswith("list of ") or "grand prix" in tlow or "season" in tlow or "championship" in tlow:
                continue
            if surname and surname not in clean_ascii(title).lower():
                continue
            return title
    return None


def fetch_best_wiki_portrait(session: requests.Session, base_name: str) -> tuple[str | None, str]:
    """Return (image_url, source_tag) for the best high-res portrait on Wikipedia/Commons."""
    title = resolve_wiki_title(session, base_name)
    candidates: list[tuple[int, str, str]] = []  # (score, url, source)

    if title:
        # A. PageImages at 720px + originalimage
        js = _wiki_get(
            session,
            "https://en.wikipedia.org/w/api.php",
            {
                "action": "query",
                "prop": "pageimages|images",
                "piprop": "thumbnail|original",
                "pithumbsize": 720,
                "imlimit": 20,
                "format": "json",
                "titles": title,
            },
        )
        pages = (js or {}).get("query", {}).get("pages", {})
        for page in pages.values():
            thumb = page.get("thumbnail") or {}
            orig = page.get("original") or {}
            t_url = thumb.get("source")
            if t_url and not is_bad_url(t_url):
                tw, th = thumb.get("width", 0), thumb.get("height", 0)
                score = 80
                if is_car_url(t_url):
                    score -= 40
                if tw and th:
                    ar = tw / max(1, th)
                    if 0.55 <= ar <= 1.15:
                        score += 20
                    elif ar > 1.45:
                        score -= 18
                    if max(tw, th) >= 500:
                        score += 10
                # Prefer thumbnail at 720px (or original if <= 1400px to avoid huge 15MB TIFF/RAWs)
                use_url = t_url
                if orig.get("source") and not is_bad_url(orig["source"]) and orig.get("width", 9999) <= 2600 and orig.get("width", 0) > tw:
                    use_url = orig["source"]
                candidates.append((score, use_url, f"wiki_pageimage:{title}"))

            # B. Inspect other article images if main pageimage was missing, wide, or a car!
            if not candidates or candidates[0][0] < 85:
                img_titles = [
                    im.get("title")
                    for im in (page.get("images") or [])
                    if im.get("title") and not is_bad_url(im["title"])
                ]
                surname = clean_ascii(base_name.split()[-1]).lower()
                # Prioritize files mentioning driver's surname
                img_titles.sort(key=lambda t: (0 if surname in clean_ascii(t).lower() else 1))
                if img_titles[:8]:
                    ii_js = _wiki_get(
                        session,
                        "https://en.wikipedia.org/w/api.php",
                        {
                            "action": "query",
                            "titles": "|".join(img_titles[:8]),
                            "prop": "imageinfo",
                            "iiprop": "url|size|mime",
                            "iiurlwidth": 720,
                            "format": "json",
                        },
                    )
                    for ip in (ii_js or {}).get("query", {}).get("pages", {}).values():
                        infos = ip.get("imageinfo") or []
                        if not infos:
                            continue
                        info = infos[0]
                        mime = (info.get("mime") or "").lower()
                        if "jpeg" not in mime and "png" not in mime and "webp" not in mime:
                            continue
                        u = info.get("thumburl") or info.get("url")
                        if not u or is_bad_url(u):
                            continue
                        iw = info.get("thumbwidth") or info.get("width") or 0
                        ih = info.get("thumbheight") or info.get("height") or 0
                        if iw < 180 or ih < 180:
                            continue
                        sc = 65
                        if surname in clean_ascii(ip.get("title", "")).lower():
                            sc += 18
                        if is_car_url(u):
                            sc -= 35
                        ar = iw / max(1, ih)
                        if 0.55 <= ar <= 1.15:
                            sc += 20
                        elif ar > 1.45:
                            sc -= 15
                        candidates.append((sc, u, f"wiki_article_img:{title}"))

    # C. Wikimedia Commons portrait search fallback (crucial for World-Map drivers or car-only articles!)
    if not candidates or max(c[0] for c in candidates) < 72:
        surname = clean_ascii(base_name.split()[-1]).lower()
        firstname = clean_ascii(base_name.split()[0]).lower()
        c_js = _wiki_get(
            session,
            "https://commons.wikimedia.org/w/api.php",
            {
                "action": "query",
                "generator": "search",
                "gsrsearch": f'"{base_name}"',
                "gsrnamespace": 6,
                "gsrlimit": 6,
                "prop": "imageinfo",
                "iiprop": "url|size|mime",
                "iiurlwidth": 720,
                "format": "json",
            },
        )
        for cp in (c_js or {}).get("query", {}).get("pages", {}).values():
            ftitle = cp.get("title") or ""
            cl_t = clean_ascii(ftitle).lower()
            if surname not in cl_t or (len(firstname) >= 3 and firstname[:3] not in cl_t):
                continue
            infos = cp.get("imageinfo") or []
            if not infos:
                continue
            info = infos[0]
            mime = (info.get("mime") or "").lower()
            if "jpeg" not in mime and "png" not in mime:
                continue
            u = info.get("thumburl") or info.get("url")
            if not u or is_bad_url(u):
                continue
            iw = info.get("thumbwidth") or info.get("width") or 0
            ih = info.get("thumbheight") or info.get("height") or 0
            if iw < 180 or ih < 180:
                continue
            sc = 74
            if "portrait" in ftitle.lower() or "cropped" in ftitle.lower():
                sc += 15
            if is_car_url(u):
                sc -= 30
            ar = iw / max(1, ih)
            if 0.55 <= ar <= 1.15:
                sc += 16
            elif ar > 1.5:
                sc -= 15
            candidates.append((sc, u, f"commons:{ftitle}"))

    if not candidates:
        return None, "none"
    candidates.sort(key=lambda x: -x[0])
    return candidates[0][1], candidates[0][2]


def save_driver_jpeg(driver_name: str, jpeg_bytes: bytes, old_rel: str | None) -> str:
    safe = driver_name.replace(" ", "-")
    out_path = IMG_DIR / f"{safe}.jpg"
    out_path.write_bytes(jpeg_bytes)
    new_rel = f"data/driver_images/{out_path.name}"
    if old_rel and old_rel != new_rel:
        old_p = REPO / old_rel
        if old_p.exists() and old_p.parent == IMG_DIR and old_p.name != out_path.name:
            try:
                old_p.unlink()
            except OSError:
                pass
    return new_rel


def main() -> int:
    ap = argparse.ArgumentParser(description="Upgrade all F1 driver portraits to crisp high-res images.")
    ap.add_argument("--dry-run", action="store_true", help="Only report what would change")
    ap.add_argument("--workers", type=int, default=8, help="Concurrent download workers")
    ap.add_argument("--only-modern", action="store_true", help="Only upgrade 2016-2026 drivers")
    args = ap.parse_args()

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # Gather all drivers from standings + existing driver_images
    standings_rows = conn.execute(
        "SELECT driver, MAX(year) as max_year FROM drivers_standings GROUP BY driver ORDER BY max_year DESC, driver ASC"
    ).fetchall()
    max_year_map = {r["driver"]: int(r["max_year"] or 1950) for r in standings_rows}
    existing_map = {
        r["driver"]: r["image_path"]
        for r in conn.execute("SELECT driver, image_path FROM driver_images").fetchall()
    }
    all_drivers = sorted(set(max_year_map.keys()) | set(existing_map.keys()), key=lambda d: (-max_year_map.get(d, 0), d))
    if args.only_modern:
        all_drivers = [d for d in all_drivers if max_year_map.get(d, 0) >= 2016]

    print(f"Loaded {len(all_drivers)} drivers. Discovering official 2026 Formula1.com portraits...")
    boot_sess = requests.Session()
    f1_2026 = discover_f1_2026_urls(boot_sess)
    print(f"Found {len(f1_2026)} official 2026 F1.com studio cutouts (+ {len(F1_2025_EXTRA)} 2025 cutouts).")

    stats = {
        "f1_2026": 0,
        "f1_2025": 0,
        "f1_legacy": 0,
        "wiki_upgraded": 0,
        "wiki_fixed_map": 0,
        "removed_map": 0,
        "kept_good": 0,
        "failed": 0,
    }
    updates: list[tuple[str, str | None]] = []

    def process_one(driver_name: str) -> tuple[str, str, str | None, str]:
        sess = requests.Session()
        old_rel = existing_map.get(driver_name)
        old_path = (REPO / old_rel) if old_rel else None
        was_map = bool(old_path and is_world_map_image(old_path))
        max_yr = max_year_map.get(driver_name, 1950)

        # Tier 1A: Official 2026 F1.com Studio Cutout
        if driver_name in f1_2026:
            try:
                r = sess.get(f1_2026[driver_name], headers={"User-Agent": UA_BROWSER}, timeout=15)
                if r.status_code == 200 and len(r.content) > 5000:
                    jpg = render_f1_cutout_bust(r.content, is_full_body=True)
                    new_rel = save_driver_jpeg(driver_name, jpg, old_rel) if not args.dry_run else f"data/driver_images/{driver_name.replace(' ', '-')}.jpg"
                    return (driver_name, "f1_2026", new_rel, "2026 F1 studio bust 560x672")
            except Exception as exc:
                print(f"  [WARN] 2026 F1 failed for {driver_name}: {exc}", file=sys.stderr)

        # Tier 1B: Official 2025 F1.com Studio Cutout
        if driver_name in F1_2025_EXTRA:
            try:
                r = sess.get(F1_2025_EXTRA[driver_name], headers={"User-Agent": UA_BROWSER}, timeout=15)
                if r.status_code == 200 and len(r.content) > 5000:
                    jpg = render_f1_cutout_bust(r.content, is_full_body=True)
                    new_rel = save_driver_jpeg(driver_name, jpg, old_rel) if not args.dry_run else f"data/driver_images/{driver_name.replace(' ', '-')}.jpg"
                    return (driver_name, "f1_2025", new_rel, "2025 F1 studio bust 560x672")
            except Exception as exc:
                print(f"  [WARN] 2025 F1 failed for {driver_name}: {exc}", file=sys.stderr)

        # Tier 2: Official 2016-2024 F1.com 840x840 Studio Headshot
        if max_yr >= 2016 or driver_name in F1_LEGACY_EXTRA:
            leg_url = find_f1_legacy_url(sess, driver_name)
            if leg_url:
                try:
                    r = sess.get(leg_url, headers={"User-Agent": UA_BROWSER}, timeout=15)
                    if r.status_code == 200 and len(r.content) > 8000:
                        jpg = render_f1_cutout_bust(r.content, is_full_body=False)
                        new_rel = save_driver_jpeg(driver_name, jpg, old_rel) if not args.dry_run else f"data/driver_images/{driver_name.replace(' ', '-')}.jpg"
                        return (driver_name, "f1_legacy", new_rel, "F1.com studio headshot 560x672")
                except Exception:
                    pass

        # Check existing quality for historical drivers
        cur_w, cur_h = 0, 0
        cur_ext = old_path.suffix.lower() if old_path else ""
        if old_path and old_path.exists() and not was_map:
            try:
                with Image.open(old_path) as im:
                    cur_w, cur_h = im.size
            except Exception:
                pass

        # Skip only if already high-res portrait JPEG (not map, not tiny <=380px, not Michael Andretti dupe, not avif/webp)
        force_refresh = (
            was_map
            or not old_path
            or not old_path.exists()
            or cur_w <= 420
            or cur_ext in (".avif", ".webp", ".png")
            or (cur_w > cur_h * 1.45)
            or driver_name == "Michael Andretti AND"
        )

        if not force_refresh:
            return (driver_name, "kept_good", old_rel, f"kept {cur_w}x{cur_h}")

        # Tier 3: High-res Wikipedia / Wikimedia Commons portrait
        base_name = strip_code3(driver_name)
        wiki_url, src = fetch_best_wiki_portrait(sess, base_name)
        if wiki_url:
            try:
                r = sess.get(wiki_url, headers={"User-Agent": UA_WIKI}, timeout=15)
                if r.status_code == 200 and len(r.content) > 2500:
                    jpg, nw, nh = normalize_photo_jpeg(r.content)
                    # Only replace existing real photo if new one is genuinely better (higher res or better format/aspect)
                    if was_map or cur_w == 0 or driver_name == "Michael Andretti AND" or cur_ext in (".avif", ".webp") or (nw >= cur_w):
                        new_rel = save_driver_jpeg(driver_name, jpg, old_rel) if not args.dry_run else f"data/driver_images/{driver_name.replace(' ', '-')}.jpg"
                        cat = "wiki_fixed_map" if was_map else "wiki_upgraded"
                        return (driver_name, cat, new_rel, f"{nw}x{nh} via {src}")
            except Exception:
                pass

        # If existing was a bogus World Map and no genuine portrait exists, remove it so clean monogram shows!
        if was_map:
            if not args.dry_run and old_path and old_path.exists():
                try:
                    old_path.unlink()
                except OSError:
                    pass
            return (driver_name, "removed_map", None, "removed bogus world map -> clean monogram fallback")

        # If existing is valid non-JPEG (.avif/.webp/.png), at least normalize it to clean JPEG for PDF compatibility
        if old_path and old_path.exists() and cur_ext in (".avif", ".webp"):
            try:
                jpg, nw, nh = normalize_photo_jpeg(old_path.read_bytes())
                new_rel = save_driver_jpeg(driver_name, jpg, old_rel) if not args.dry_run else old_rel
                return (driver_name, "wiki_upgraded", new_rel, f"converted {cur_ext} -> jpg {nw}x{nh}")
            except Exception:
                pass

        return (driver_name, "kept_good" if (old_path and old_path.exists()) else "failed", old_rel, f"kept existing {cur_w}x{cur_h}")

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(process_one, d): d for d in all_drivers}
        done = 0
        for fut in as_completed(futs):
            done += 1
            drv, cat, new_rel, note = fut.result()
            stats[cat] = stats.get(cat, 0) + 1
            updates.append((drv, new_rel))
            if cat in ("f1_2026", "f1_2025", "f1_legacy", "wiki_fixed_map", "removed_map") or done % 40 == 0:
                print(f"[{done:3d}/{len(all_drivers)}] {cat:14s} | {drv:30s} | {note}")

    if not args.dry_run:
        with conn:
            for drv, new_rel in updates:
                if new_rel is None:
                    conn.execute("DELETE FROM driver_images WHERE driver=?", (drv,))
                else:
                    conn.execute(
                        "INSERT INTO driver_images(driver, image_path) VALUES (?, ?) "
                        "ON CONFLICT(driver) DO UPDATE SET image_path=excluded.image_path",
                        (drv, new_rel),
                    )
        print("\nSaved all updates to data/f1.sqlite.")

    print("\n=== UPGRADE SUMMARY ===")
    for k, v in stats.items():
        print(f"  {k:16s}: {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
