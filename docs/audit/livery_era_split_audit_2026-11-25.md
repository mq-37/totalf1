# Livery Era-Split Audit — 2026-11-25

Split decade-wide livery PNGs into year-accurate eras, verified against real
Wikimedia/Commons photos. Comparison sheet:
[docs/audit/livery_era_splits_2026-11-25.png](./livery_era_splits_2026-11-25.png)
(Real Photo | Before | After).

## Eras split

| Team-years | Before (shared PNG) | After | Registry change |
|---|---|---|---|
| Lotus Ford 1968–71 | green/yellow BRG fallback | **Gold Leaf** metallic gold + red noseband (`lotus_gold_leaf`) | `_resolve_lotus` 1968–71 branch (1967 correctly stays BRG — 49 debut year) |
| Ferrari 1982–85 | generic classic red | **126C2 Marlboro white deck** (`ferrari_white_deck`) | `_resolve_ferrari` 1982–85 branch + new `deckPanelMesh` white sock on 1970s/1980s chassis |
| Sauber 1993 | generic blue | **C12 black carbon + white** | `_resolve_sauber` y≤1993 branch |
| Sauber Petronas 1998–2000 | generic blue | **red/white Petronas debut era** (reuses `ferrari_white_deck`) | 1994–2000 branch |
| Sauber Petronas 2001–05 | generic blue | **Red Bull royal blue + Petronas teal underline** (`sauber_petronas`) | 2001–05 branch |
| Sauber BMW 2006–09 (+2010 carry-over) | generic blue | **pearl white + BMW Motorsport blue** | team-keyed `_resolve_sauber_bmw` (peak-year 2005 can't bleed into Petronas era) |
| Sauber Ferrari 2011–18 | generic blue | steel-blue graphite matte | 2011–18 branch |
| Kick Sauber 2024–25 | generic green | dark carbon + Kick neon green (`carbon_stealth`) | fallback branch |

## New 3D styles (`static/js/f1_car_3d.js`)

- `lotus_gold_leaf` — metallic gold body, red noseband/spine stripe, red high-stilt wing + white flap
  (the 1960s chassis branch adds exact-year `>= 1968` high-stilt wings = Lotus 49B).
- `ferrari_white_deck` — red tub + white deck via new `deckPanelMesh` (era-scoped loft added to the
  1970s and 1980s chassis branches, reset + hidden for every other style — zero impact on other cars).
- `sauber_petronas` — royal blue, teal underlines/front wing, white Credit Suisse wing, Red Bull red.

## Key gotchas found & fixed

- **1967 Lotus 49 was NOT Gold Leaf** — it debuted in BRG green + yellow stripe (museum photo).
  Gold Leaf only from 1968; JPS only from 1972.
- **Jordan never went orange** — EJ14/EJ15 (2004–05) stayed B&H yellow; orange was a false memory
  (2000–01 Orange Arrows). Jordan left unchanged.
- **`Sauber BMW` peak-year is 2005** — a year-keyed BMW branch would wrongly render Petronas blue.
  Fixed by keying BMW identity on the team name (`("bmw sauber", "sauber bmw")` family resolver).
- Renderer dedups byte-identical renders via the manifest (e.g. `ferrari--1983..85 → ferrari--1982`,
  `lotus-ford--1968..70 → lotus-ford--1960s`) — year lookups must go through
  `find_car_png_slug(team, year)`, which resolves these aliases.

## Verification

- `tests/test_livery_regs_politics.py` — 12/12 pass (new Gold Leaf / white-deck / Sauber-era assertions)
- `node --check static/js/f1_car_3d.js` — clean
- Spot-checks rendered via `livery_audit_kit.py render-angles` (card/side/rear/top) — white deck
  reads correctly from all angles; no clipping, no stretched decals, no regression on other cars
  (git diff shows only era-relevant PNGs changed).
