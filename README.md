# Local F1 Results & Simulator (traf1)

Scrapes 1950–2026 race results, driver/team standings, fastest laps, and per-race classifications from [formula1.com](https://www.formula1.com) into a local SQLite DB for offline browsing, printable collector & game trading cards, a 3D Card Arena (`/play`), a 100% CPU F1 TV Broadcast Director (`/sim`), and an F1 Team Principal Career Manager (`/career`).

**AI and onboarding:** For context, reading order, and task shortcuts, start from the project root [AI_CONTEXT.md](../AI_CONTEXT.md).

## Quickstart

```bash
cd traf1
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
```

### Scrape everything (recommended)

One command scrapes races, drivers, teams, awards (fastest laps), and race results for all years, then normalizes the DB:

```bash
# Full history (1950–2026)
python3 -m f1data.cli scrape-all

# Or use the script (same thing)
./scripts/scrape_all.sh
```

With a custom range or single year:

```bash
python3 -m f1data.cli scrape-all --start 2000 --end 2026
python3 -m f1data.cli scrape-all --year 2026
./scripts/scrape_all.sh --start 2010 --end 2026
```

### Scrape individual data types

If you prefer to run each scrape separately:

```bash
python3 -m f1data.cli scrape          --start 1950 --end 2026   # race list
python3 -m f1data.cli scrape-drivers  --start 1950 --end 2026   # driver standings
python3 -m f1data.cli scrape-teams    --start 1950 --end 2026   # team standings
python3 -m f1data.cli scrape-awards   --start 1950 --end 2026   # fastest laps
python3 -m f1data.cli scrape-results  --start 1950 --end 2026   # per-race results
python3 -m f1data.cli normalize   # build normalized tables (required for web UI)
```

Options for all scrape commands:

- `--year YYYY` — single season
- `--start YYYY` / `--end YYYY` — range (default 1950–2026)
- `--db path/to/f1.sqlite` — custom DB path (default `data/f1.sqlite`)

### Run the web UI

From the **traf1** directory (so Python can find the `f1data` package):

```bash
cd traf1
python3 -m f1data.cli serve
```

Then open **http://127.0.0.1:8000** for Cards, F1 Card Arena (`/play`), Full CPU Broadcast Sim (`/sim`), Team Principal Career (`/career`), Driver Search, Races, Teams, Analytics, and Team Colors & 3D Livery Studio.

### Run the test suite

```bash
cd traf1
.venv/bin/python -m unittest discover -s tests -v
```

### CLI browse (no server)

```bash
python3 -m f1data.cli browse --year 1981
python3 -m f1data.cli browse-drivers --year 1981
python3 -m f1data.cli browse-teams --year 1981
python3 -m f1data.cli browse-awards --year 1981
```

## Architecture & Frontend

The UI is **server-rendered** with **FastAPI + Jinja2** templates and **modular vanilla CSS/JS** with **offline-vendored assets**:

- **Backend:** FastAPI app in `f1data/server.py` mounting modular routers (`f1data/routers/{archive,cards,game,career,dev}.py`), ReportLab PDF generator (`f1data/pdf.py`), Career engine (`f1data/career.py`, `f1data/career_db.py`), and 24 GPS circuit splines (`data/circuits.json`).
- **Styling:** Core `static/styles.css` + page-scoped `static/css/{play,sim,career}.css`.
- **Shared JS Engines:** `f1_car_3d.js` (procedural 3D F1 cars), `f1_track_renderer.js` (12-layer GPS broadcast canvas), `f1_race_engine.js` (tyre/DRS/pit-rejoin/HUD physics), `f1_sfx.js` (Web Audio synthesizer).
- **Offline Assets:** Three.js r158, Font Awesome 6, Orbitron & Source Sans 3 fonts, and HTMX 1.9.12 are all vendored under `static/vendor/` — zero external CDN runtime dependencies.

**Optimizations in place:**

- **2026 in dropdowns:** Season lists always include `CURRENT_SEASON = 2026`.
- **SQLite secondary indexes & bulk queries:** Indexed lookups on `f1.sqlite` and bulk queries eliminate N+1 bottlenecks on Cards, PDFs, and Team Colors.
- **Lazy loading & slim mutations:** Driver portraits lazy-load (`loading="lazy"`); Career POST mutations return slimmed payloads with optimistic version locking (`HTTP 409` on conflict).
