# TRAF1 3D Livery Architecture & Gotchas

Single source of truth for 3D livery construction in `static/js/f1_car_3d.js` and year resolution in `f1data/livery_registry.py`.

## Data Flow

1. `f1data/livery_registry.py` (`resolve_team_livery(team, year)`) resolves `(team_name, year)` -> `{palette: {main, secondary, accent, pop, detail}, style, finish, motif, label, year, team}`.
2. `FAMILY_RESOLVERS` runs before `WORKS_PREFIX_RESOLVERS` so customer teams like `"McLaren Mercedes"` or `"Haas Ferrari"` never resolve to the PU supplier.
3. `scripts/render_3d_cars.py` drives `/dev/car-render-harness` (`templates/car_render_harness.html`) in headless Chrome via CDP to bake deduplicated transparent studio PNGs into `static/cars/png/` + `static/cars/png/manifest.json`.
4. `/dev/car-3d`, `/dev/car-liveries`, museum plinths, broadcast 3D, top-down track sprites, and team blueprints all consume the exact same `window.F1Car3D.createCar()` + `.userData.setPalette(palette, style, finish)`.

## 2020s Chassis Coordinate Reference (`static/js/f1_car_3d.js`)

Coordinate convention (1 unit = 1 meter): `+Z` = nose forward (`+2.74`), `-Z` = rear wing (`-2.66`), `+Y` = up (ground `0`), `+X` = driver's left (camera side in `card`, `hero`, `side` presets).

- **Monocoque (`bodySpec`):** `z = +2.74` (nose tip `y=0.19..0.23, hw=0.045`) -> `z = +0.65` (cockpit front `y=0.14..0.62, hw=0.305`) -> `z = -2.24` (rear exit `y=0.21..0.34, hw=0.085`).
- **Sidepods (`podSpecRef`):** `z = +0.62` (inlet) -> `z = +0.38` (`xC=0.55, hw=0.22, y=0.26..0.60`) -> `z = -0.08` (`xC=0.54, hw=0.23, y=0.21..0.59`) -> `z = -0.65` (`xC=0.47, hw=0.21, y=0.18..0.52`) -> `z = -1.20` (`xC=0.35, hw=0.16, y=0.17..0.42`) -> `z = -1.68` (taper).
- **Airbox & Engine Cover (`airboxSpec`):** `z = -0.18` (`hw=0.132, y=0.58..0.99`) -> `z = -0.50` (`hw=0.155, y=0.56..0.97`) -> `z = -0.98` (`hw=0.122, y=0.52..0.87`) -> `z = -1.50` (`hw=0.072, y=0.44..0.70`) -> `z = -1.96`.
- **DRS Rear Wing Flap (`drsPivot20`):** Pivot at `(0, 0.94, -2.60)`; flap centered at local `(0, -0.04, 0.06)`, `halfSpan = 0.49`, `arch = -0.012`, `pitch = 0.48`.

## Built-In 3D Decal & Surface Helpers

Always reuse these existing helpers in `static/js/f1_car_3d.js`:

- **`interpSpec(spec, z)`** — Linearly interpolates `bodySpec`, `podSpecRef`, or `airboxSpec` at any `z`.
- **`superSurfaceX(xOff, hw, yBot, yTop, pTop, pBot, y)`** — Exact outer `X` of a `superRing` cross-section at height `y`.
- **`buildCurvedDecalGrid(zs, yBotFn, yTopFn, xFn, side, mat, vRows)`** — Builds an `N_z x vRows` UV-mapped mesh hugging convex curved bodywork (`vRows = 5..6`). Automatically flips `u` on `side = -1` so text reads left-to-right on both sides of the car.
- **`addSidepodDecal(grp, mat, zList, halfH, yBias)`** — Wraps a `decalMat(tex)` symmetrically across both 2020s sidepods.
- **`addEngineDecal(grp, mat, zList, yBot, yTopStart, ySlope)`** — Wraps a `decalMat(tex)` symmetrically across both sides of the airbox/shark fin.
- **`addDrsDecal(mat, width, height)`** — Attaches a dual-face `buildArchedWingDecal` inside `drsPivot20` so it moves cleanly if DRS opens.
- **`makeWordmarkTexture(text, colorHex, opts)`** — Crisp high-DPI transparent wordmark texture (`{w, h, size, skew, weight, stroke, strokeW, bg}`).

## Era Chassis Branches (`1950s` .. `2020s`)

`createF1Car` dispatches geometry by technical generation (`normalizeEra(eraOrYear)`):
- `1950s` (`<=1959`): Front-engined cigar, wire wheels, no wings.
- `1960s` (`1960–1969`): Rear-engined cigar + exposed V8 (`>=1968` adds high stilt wings).
- `1970s` (`1970–1982`): Wedge body, boxy sidepods (`1971–1975` tall periscope airbox; `>=1978` ground-effect skirts).
- `1980s` (`1983–1988`): Low-line turbo wedge, sculpted low sidepods, no tall airbox.
- `1990s` (`1989–1997`): Tall overhead airbox, clean sculpted sidepods, Goodyear slicks.
- `2000s` (`1998–2008`): Raised narrow V10 nose, arched front wing, bargeboards, 4-groove tyres.
- `2010s` (`2009–2021`): Long shark fin, 13" open-rim Pirelli tyres (`2009–2016` tall narrow rear wing; `2017` T-wing; `>=2018` Halo).
- `2020s` (`>=2022`): 18" aero wheel covers, Venturi floor (`<2026` wheel wake brows; `>=2026` nimble `0.95x / 0.945x` proportions + active-aero front wing pods).

> **Important for historical audits (`<=2021`):** All bespoke 2026 kits live inside the `2020s` geometry branch (`else { ... }`). When adding bespoke decals/sleeves for a historical era (`1970s`–`2010s`), guard them inside that era's branch (or attach to meshes built in that branch) and still initialize the placeholder `{ visible: false }` variable before the `if (era === ...)` dispatch so `setPalette()` never throws across era switches.

## Hard-Won Gotchas

1. **Convex clipping:** A 2-row quad strip cuts straight through a bulging sidepod or airbox belly. Always use `buildCurvedDecalGrid` with `vRows >= 5` and `+0.008m` clearance on `superSurfaceX`.
2. **Canvas aspect ratio vs 3D span:** Match the canvas aspect ratio to the physical `deltaZ / deltaY` span of the decal grid (e.g., `512x256` 2:1 for a round emblem on the engine cover; `768x256` 3:1 for a full engine-cover motif) so circles stay circular and logos never stretch.
3. **Colour-block loft sleeve clearance:** When wrapping a coloured loft sleeve over an underlying body/sidepod loft (e.g., Audi's red sidepod wedge or McLaren's papaya tail wedge), add `+0.014m` to `hw` and `+0.012m` to `yTop` (and `-0.006m` to `yBot`) to prevent base carbon bleed-through at grazing side angles.
4. **Complete `setPalette()` reset:** The render harness reuses one Three.js car mesh per chassis bucket and swaps liveries in-memory via `setPalette()`. Every style-specific mesh group, material `.map`, `mats.wheelCover.color`, `noseStripeMesh.visible`, `sidepodSwooshMeshes`, `sidepodLipMeshes`, and `paintKeys` material property (`roughness`, `metalness`, `clearcoat`) MUST be reset unconditionally at the top of `setPalette()`.
5. **Wing & endplate restraint:** Modern F1 front wings, floors, and rear wings are predominantly exposed carbon black unless the real photo clearly shows painted endplates or flaps. Check the front and rear views, not just the 3/4 card angle.
