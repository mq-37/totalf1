# Handover — TRAF1 (f1 sim/traf1)
Updated: 2026-11-25 · Branch: master (clean @ f2357b0)

## Current state
Per-year livery system fully committed: registry resolves every DB team-year 1950–2026, era splits landed (Gold Leaf Lotus 49B, Ferrari 126C2 white deck, Sauber per-era incl. team-keyed BMW branch). 12/12 livery tests pass, JS syntax clean. Live instance on :8001 restarted with new code; temp audit instance on :8017 (safe to kill).
Remote: `origin` = https://github.com/mq-37/totalf1.git (private, mq-37's account — NOT the MartinQuinnSOI stored account). Push creds for mq-37 live in `~/.git-credentials`; token is burnable — if revoked, replace that line on next push.

## Last session
Committed the previous session's pending livery audit (e099e53: 1950–2026 registry, 313 renders, vendored audit skill), then executed the era-splits audit (f2357b0): new styles `lotus_gold_leaf`, `ferrari_white_deck` (+ era-scoped `deckPanelMesh` white deck on 1970s/1980s chassis), `sauber_petronas`, new `_resolve_sauber`/`_resolve_sauber_bmw` resolvers, era PNGs + manifest, comparison sheet + report in `docs/audit/`. Verified live in UI screenshots (`/teams/1968`, `/teams/1982`, `/teams/2001` all era-correct).

## Decisions & why
- Lotus 1967 stays BRG green; Gold Leaf branch = 1968–71 only — 49 debuted green (museum photo evidence).
- Jordan NOT split for orange — EJ14/15 stayed B&H yellow (websearch-verified); orange was the 2000–01 Arrows.
- Sauber BMW identity keyed on team name (`("bmw sauber","sauber bmw")`), not year — `_team_peak_years_map` gives Sauber BMW peak=2005, a year-keyed branch bleeds Petronas blue into it.
- McLaren 1980s left as `mclaren_marlboro` white/red — that IS authentic for MP4/1–4.
- Renderer dedups byte-identical renders: year slugs alias to one canonical PNG (e.g. `ferrari--1983..85 → ferrari--1982`); lookups must go through `find_car_png_slug(team, year)`.

## Known issues
- `render_3d_cars.py` sometimes dies at exit with `OSError: [Errno 39]` (chrome kill races temp-dir cleanup) — PNGs may be written but the manifest merge is SKIPPED. Fix: clean `/tmp/tmp*` leftovers, re-run the render (idempotent).
- Port 8000 is a different app (has login); traf1 lives on 8001/8017.

## Next steps
1. Remaining livery targets from the gap analysis: `shadow-ford` 1977 black split, `mclaren-tag` early-80s, `ferrari--1990s` 1998–05 stretch (lowest priority — mostly consistent red).
2. Other active threads if user pivots: `/drive` cockpit AI (e273614), `/sim` POV + APEX GRID rebrand (6cd4fa7), `/ladder` career mode (PRs 1–7).
3. Kill the temp server on :8017 when convenient.

## Don't touch / gotchas
- Repo path contains a space: `/home/martin-quinn/Dev/projects/f1 sim/traf1` — always quote.
- Use `.venv/bin/python` for everything Python; start server via `uvicorn f1data.server:app` (NOT `python -m f1data.server` — circular import crash).
- Harness `chassisBucketKey` ≠ `normalizeEra`: harness buckets by 4-year buckets (1982→'1988'→1980s chassis), registry eras differ (1982→1970s branch). Both are correct-by-design; don't "fix" either.
- Historical chassis (1950s–2010s) have NO signature kit meshes — styles affect them only through shared material slots; kit meshes on them are plain-object stubs.
- After any registry/palette/PNG change, the long-running :8001 instance must be restarted to serve new liveries.
