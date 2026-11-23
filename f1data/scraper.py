from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Iterable, List, Dict
import re
from urllib.parse import urljoin

import backoff
import requests
from bs4 import BeautifulSoup


BASE_URL = "https://www.formula1.com"
RESULTS_URL_TEMPLATE = "https://www.formula1.com/en/results/{year}/races"
DRIVERS_URL_TEMPLATE = "https://www.formula1.com/en/results/{year}/drivers"
TEAMS_URL_TEMPLATE = "https://www.formula1.com/en/results/{year}/team"
AWARDS_FASTEST_LAPS_URL_TEMPLATE = "https://www.formula1.com/en/results/{year}/awards/fastest-laps"
DEFAULT_START_YEAR = 1950
DEFAULT_END_YEAR = 2026


@dataclass
class RaceRow:
    year: int
    round_number: int
    grand_prix: str
    date: str  # ISO date string YYYY-MM-DD
    winner: str
    team: str
    laps: int | None
    time: str | None
    race_url: str


@dataclass
class DriverStandingRow:
    year: int
    position: int
    driver: str
    nationality: str
    team: str
    points: float  # allow half-points (e.g. 2021 Belgian GP)
    driver_id: str | None
    driver_url: str


@dataclass
class TeamStandingRow:
    year: int
    position: int
    team: str
    points: float  # allow half-points
    team_id: str | None
    team_url: str


@dataclass
class FastestLapRow:
    year: int
    round_number: int
    grand_prix: str
    winner: str
    time: str
    race_url: str


DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
}


class HttpError(RuntimeError):
    pass


@backoff.on_exception(
    backoff.expo,
    (requests.RequestException, HttpError),
    max_time=60,
)
def _get(url: str) -> requests.Response:
    resp = requests.get(url, headers=DEFAULT_HEADERS, timeout=30)
    if resp.status_code in (429, 403):
        raise HttpError(f"HTTP {resp.status_code} for {url}")
    resp.raise_for_status()
    return resp


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _extract_gp_name(cell) -> str:
    """Extract clean Grand Prix name from a table cell, stripping inline SVG flag titles."""
    target = cell.find("a") or cell
    parts: List[str] = []
    for node in target.descendants:
        if isinstance(node, str):
            parent = getattr(node, "parent", None)
            # Skip text inside <svg> (e.g. <title>Flag of Australia</title>)
            inside_svg = False
            cur = parent
            while cur is not None and cur is not target:
                if getattr(cur, "name", None) in ("svg", "title"):
                    inside_svg = True
                    break
                cur = getattr(cur, "parent", None)
            if not inside_svg:
                parts.append(str(node))
    text = _normalize_whitespace(" ".join(parts))
    if not text:
        text = _normalize_whitespace(target.get_text(" "))
    return text


def _parse_points(text: str) -> float:
    """Parse points string, allowing decimals (e.g. 395.5 for half-points)."""
    if not text:
        return 0.0
    # Keep digits and one decimal point so "395.5" stays 395.5 (not 3955)
    m = re.search(r"\d+\.?\d*", text.replace(",", "."))
    if not m:
        return 0.0
    try:
        return float(m.group())
    except ValueError:
        return 0.0


def _parse_date(day_month: str, year: int) -> str:
    value = _normalize_whitespace(day_month)
    dt = datetime.strptime(f"{value} {year}", "%d %b %Y")
    return dt.date().isoformat()


def _select_table_rows(soup: BeautifulSoup) -> List:
    table = soup.select_one("table.f1-table") or soup.select_one("table.f1-table-with-data")
    if not table:
        # Fallbacks used by awards tables
        table = soup.select_one("#awards-table table") or soup.find("table")
    if not table:
        raise RuntimeError("Could not find results table on the page.")
    tbody = table.find("tbody")
    if not tbody:
        # Some tables omit <tbody>; treat direct <tr> as rows
        rows = table.find_all("tr")
        return [r for r in rows if r.find_all("td")]
    return list(tbody.find_all("tr"))


# ---------------------- Per-race classification scraping ----------------------
def _ensure_race_result_url(base_url: str) -> str:
    u = base_url or ""
    if not u.endswith("/"):
        u = u + "/"
    if not u.endswith("/race-result/"):
        u = u + "race-result"
    return u

def _header_index_map(table) -> dict[str, int]:
    thead = table.find("thead")
    if not thead:
        return {}
    ths = thead.find_all("th")
    labels = [(_normalize_whitespace(th.get_text(" ")).upper()) for th in ths]
    idx: dict[str, int] = {}
    for i, t in enumerate(labels):
        if "POS" in t:
            idx["pos"] = i
        elif "DRIVER" in t:
            idx["driver"] = i
        elif "TEAM" in t or "CAR" in t:
            idx["team"] = i
    return idx

def _parse_race_results_page(year: int, round_number: int, race_url: str) -> List[dict]:
    url = _ensure_race_result_url(race_url)
    resp = _get(url)
    soup = BeautifulSoup(resp.text, "lxml")
    table = soup.select_one("table.f1-table") or soup.select_one("table.f1-table-with-data") or soup.find("table")
    if not table:
        return []
    col = _header_index_map(table)
    tbody = table.find("tbody") or table
    rows_out: List[dict] = []
    for tr in tbody.find_all("tr"):
        tds = tr.find_all("td")
        if not tds:
            continue
        pos_i = col.get("pos", 0)
        drv_i = col.get("driver", 2)
        team_i = col.get("team", 3)
        pos_text = _normalize_whitespace(tds[pos_i].get_text(" ")) if pos_i < len(tds) else ""
        driver = _normalize_whitespace(tds[drv_i].get_text(" ")) if drv_i < len(tds) else ""
        team = _normalize_whitespace(tds[team_i].get_text(" ")) if team_i < len(tds) else ""
        m = re.search(r"\d+", pos_text)
        position_order = int(m.group(0)) if m else 0
        if driver and team:
            rows_out.append({
                "year": year,
                "round_number": round_number,
                "driver": driver,
                "team": team,
                "position_text": pos_text,
                "position_order": position_order,
            })
    return rows_out

def scrape_race_results_for_year(year: int) -> List[dict]:
    races = scrape_races_for_year(year)
    out: List[dict] = []
    for r in races:
        out.extend(_parse_race_results_page(r.year, r.round_number, r.race_url))
    return out

def scrape_race_results_for_years(years: Iterable[int]) -> List[dict]:
    all_rows: List[dict] = []
    for y in years:
        all_rows.extend(scrape_race_results_for_year(y))
    return all_rows


def scrape_races_for_year(year: int) -> List[RaceRow]:
    url = RESULTS_URL_TEMPLATE.format(year=year)
    resp = _get(url)
    soup = BeautifulSoup(resp.text, "lxml")
    rows = _select_table_rows(soup)

    races: List[RaceRow] = []
    for idx, tr in enumerate(rows, start=1):
        tds = tr.find_all("td")
        if len(tds) < 6:
            continue

        gp_cell = tds[0]
        a = gp_cell.find("a")
        grand_prix = _extract_gp_name(gp_cell)
        href = a.get("href") if a else None
        race_url = urljoin(BASE_URL, href) if href else url

        date_cell = tds[1].get_text(" ")
        date_iso = _parse_date(date_cell, year)

        winner_cell = _normalize_whitespace(tds[2].get_text(" "))
        team_cell = _normalize_whitespace(tds[3].get_text(" "))

        laps_text = _normalize_whitespace(tds[4].get_text(" "))
        laps = int(laps_text) if laps_text.isdigit() else None

        time_text = _normalize_whitespace(tds[5].get_text(" "))
        time_value = time_text if time_text and time_text != "-" else None

        races.append(
            RaceRow(
                year=year,
                round_number=idx,
                grand_prix=grand_prix,
                date=date_iso,
                winner=winner_cell,
                team=team_cell,
                laps=laps,
                time=time_value,
                race_url=race_url,
            )
        )

    if not races:
        raise RuntimeError(f"No race rows parsed for {year} from {url}")

    return races


def scrape_races_for_years(years: Iterable[int]) -> List[RaceRow]:
    all_rows: List[RaceRow] = []
    for y in years:
        all_rows.extend(scrape_races_for_year(y))
    return all_rows


def scrape_drivers_for_year(year: int) -> List[DriverStandingRow]:
    url = DRIVERS_URL_TEMPLATE.format(year=year)
    resp = _get(url)
    soup = BeautifulSoup(resp.text, "lxml")
    rows = _select_table_rows(soup)

    results: List[DriverStandingRow] = []
    for tr in rows:
        tds = tr.find_all("td")
        if len(tds) < 5:
            continue

        pos_text = _normalize_whitespace(tds[0].get_text(" "))
        try:
            position = int(re.sub(r"[^0-9]", "", pos_text))
        except ValueError:
            continue

        # DRIVER cell
        drv_cell = tds[1]
        a = drv_cell.find("a")
        driver_name = _normalize_whitespace(a.get_text(" ")) if a else _normalize_whitespace(drv_cell.get_text(" "))
        href = a.get("href") if a else None
        driver_url = urljoin(BASE_URL, href) if href else url
        driver_id = None
        if href:
            parts = [p for p in href.split("/") if p]
            # Expect: .../drivers/<DRIVERID>/<slug>
            try:
                idx = parts.index("drivers")
                driver_id = parts[idx + 1]
            except Exception:
                driver_id = None

        nationality = _normalize_whitespace(tds[2].get_text(" "))
        team_cell = tds[3]
        team = _normalize_whitespace(team_cell.get_text(" "))

        pts_text = _normalize_whitespace(tds[4].get_text(" "))
        points = _parse_points(pts_text)

        results.append(
            DriverStandingRow(
                year=year,
                position=position,
                driver=driver_name,
                nationality=nationality,
                team=team,
                points=points,
                driver_id=driver_id,
                driver_url=driver_url,
            )
        )

    if not results:
        raise RuntimeError(f"No driver rows parsed for {year} from {url}")

    # Sort by position in case the table contained separator rows
    results.sort(key=lambda r: r.position)
    return results


def scrape_teams_for_year(year: int) -> List[TeamStandingRow]:
    url = TEAMS_URL_TEMPLATE.format(year=year)
    resp = _get(url)
    soup = BeautifulSoup(resp.text, "lxml")
    rows = _select_table_rows(soup)

    results: List[TeamStandingRow] = []
    for tr in rows:
        tds = tr.find_all("td")
        if len(tds) < 3:
            continue

        pos_text = _normalize_whitespace(tds[0].get_text(" "))
        try:
            position = int(re.sub(r"[^0-9]", "", pos_text))
        except ValueError:
            continue

        team_cell = tds[1]
        a = team_cell.find("a")
        team_name = _normalize_whitespace(a.get_text(" ")) if a else _normalize_whitespace(team_cell.get_text(" "))
        href = a.get("href") if a else None
        team_url = urljoin(BASE_URL, href) if href else url
        team_id = None
        if href:
            parts = [p for p in href.split("/") if p]
            # Expect: .../team/<Team-Slug>
            try:
                idx = parts.index("team")
                team_id = parts[idx + 1]
            except Exception:
                team_id = None

        pts_text = _normalize_whitespace(tds[2].get_text(" "))
        points = _parse_points(pts_text)

        results.append(
            TeamStandingRow(
                year=year,
                position=position,
                team=team_name,
                points=points,
                team_id=team_id,
                team_url=team_url,
            )
        )

    if not results:
        raise RuntimeError(f"No team rows parsed for {year} from {url}")

    results.sort(key=lambda r: r.position)
    return results


def scrape_fastest_laps_for_year(year: int) -> List[FastestLapRow]:
    url = AWARDS_FASTEST_LAPS_URL_TEMPLATE.format(year=year)
    resp = _get(url)
    soup = BeautifulSoup(resp.text, "lxml")
    rows = _select_table_rows(soup)

    results: List[FastestLapRow] = []
    for idx, tr in enumerate(rows, start=1):
        tds = tr.find_all("td")
        if len(tds) < 3:
            continue
        gp_cell = tds[0]
        a = gp_cell.find("a")
        grand_prix = _extract_gp_name(gp_cell)
        href = a.get("href") if a else None
        race_url = urljoin(BASE_URL, href) if href else url

        winner = _normalize_whitespace(tds[1].get_text(" "))
        time_value = _normalize_whitespace(tds[2].get_text(" "))

        results.append(
            FastestLapRow(
                year=year,
                round_number=idx,
                grand_prix=grand_prix,
                winner=winner,
                time=time_value,
                race_url=race_url,
            )
        )

    if not results:
        raise RuntimeError(f"No fastest lap rows parsed for {year} from {url}")

    return results
