---
name: traf1-livery-audit
description: >-
  Photo-verified per-year 3D F1 livery audit and upgrade workflow for TRAF1.
  Use when auditing, correcting, or upgrading car liveries for a specific F1 season,
  decade, or constructor in TRAF1, comparing 3D renders against real track photos,
  adding year-accurate palettes/finishes/decals, or spot-checking multi-angle car PNGs.
---

# TRAF1 Per-Year Livery Audit

Audit and upgrade TRAF1 car liveries against real race photography, verify every car across multiple 3D angles (`card`, `side`, `front`, `rear`), and regenerate production studio PNGs.

## Scope & Paths

- **Repo root:** `/home/martin-quinn/Dev/projects/f1 sim/traf1` (use `.venv/bin/python` for all Python commands).
- **Helper CLI:** [scripts/livery_audit_kit.py](./scripts/livery_audit_kit.py) (run `--help` for flags).
- **3D architecture, decal rules & gotchas:** Read [references/3d-livery-architecture.md](./references/3d-livery-architecture.md) before editing `static/js/f1_car_3d.js`.

## Steps

### 1. Select Target Scope & Snapshot Current Renders

1. Resolve the exact `(team, year)` pairs from `data/f1.sqlite`:
   ```bash
   .venv/bin/python .agents/skills/traf1-livery-audit/scripts/livery_audit_kit.py list --year <YEAR>
   # or: ... list --team "<TEAM>"
   ```
2. Snapshot existing PNGs into a scratch folder (`<scratch>/before/`) before any edits:
   ```bash
   .venv/bin/python .agents/skills/traf1-livery-audit/scripts/livery_audit_kit.py snapshot --year <YEAR> --out <scratch>/before
   ```

**Done when:** Every target `(team, year)` is listed with its current resolved `style`, `finish`, `palette`, and saved before-PNG.

### 2. Gather Real Reference Photos (Visual Ground Truth)

Never rely on text descriptions alone—always inspect actual photographs of the car from the target season.

1. Fetch real Wikimedia Commons photos with polite rate-limiting:
   ```bash
   .venv/bin/python .agents/skills/traf1-livery-audit/scripts/livery_audit_kit.py fetch-refs --year <YEAR> --teams "<Team1>,<Team2>,..." --out <scratch>/refs
   ```
2. Open every downloaded photo alongside its current TRAF1 before-PNG with `read_file`.
3. Record exact visual deltas per car: base colour & finish (`gloss` | `matte` | `metallic` | `carbon`), nose/halo/mirror colours, sidepod colour-blocking, airbox & engine cover graphics, front & rear wing colours, wheel cover colours, and distinctive sponsor/emblem placements.

**Done when:** Every target car has at least one inspected real-world reference photo and a concrete zone-by-zone delta list.

### 3. Implement Year-Accurate Registry & 3D Livery Upgrades

Consult [references/3d-livery-architecture.md](./references/3d-livery-architecture.md) for loft coordinates, convex decal helpers, aspect-ratio matching, and `setPalette()` reset rules.

1. **Registry (`f1data/livery_registry.py`):** Add or refine year branches in `_resolve_<family>(y)` (keeping customer constructors ahead of works engine suppliers in `FAMILY_RESOLVERS`).
2. **Palette/style sync:**
   - Register any new style name in `f1data/f1_car_palettes.py` (`LIVERY_STYLES`), `static/js/f1_car_3d.js` (`LIVERY_STYLES`), and `templates/career.html`.
   - Sync updated latest-year entries in `data/team_car_palettes.json`.
3. **3D model (`static/js/f1_car_3d.js`):**
   - Build high-DPI procedural `CanvasTexture` decals matched to the physical 3D surface aspect ratio.
   - Wrap decals onto convex sidepods/airboxes using `buildCurvedDecalGrid` (never flat planes) and arched rear wings using `buildArchedWingDecal`.
   - Reset every custom kit's `.visible`, shared stripe/swoosh visibility, `mats.wheelCover.color`, and texture `.map` slots at the top of `setPalette()`.
4. **Tests (`tests/test_livery_regs_politics.py`):** Add/update year-resolution assertions for every modified team/year branch.

**Done when:** All registry, style, 3D geometry, and test edits are saved cleanly with no syntax errors.

### 4. Multi-Angle Render & Relentless Visual Spot-Check

1. Re-render production PNGs (filtered by `--team` during iteration, or full batch if shared geometry changed):
   ```bash
   .venv/bin/python scripts/render_3d_cars.py --team "<TEAM>"
   ```
2. Render high-res multi-angle inspection views (`card,side,front,rear`) for every edited car:
   ```bash
   .venv/bin/python .agents/skills/traf1-livery-audit/scripts/livery_audit_kit.py render-angles --year <YEAR> --teams "<Team1>,<Team2>" --presets card,side,front,rear --out <scratch>/spotcheck
   ```
3. Inspect the `card` and `side` (plus `front`/`rear` when wings or noses changed) PNGs with `read_file` against the real photos. Check specifically for:
   - Decal clipping through curved sidepods or airboxes
   - Stretched logos/circles (canvas vs 3D aspect mismatch)
   - Base mesh bleeding through colour-block sleeves
   - Front vs rear wheel cover parity
   - Stray default nose stripes, sidepod swooshes, or wrong-colour wing flaps
4. Fix every defect found and repeat step 4 until every angle is clean.

**Done when:** Every audited car has zero clipping, accurate proportions, and matches its real reference photo across inspected angles.

### 5. Build Comparison Sheet & Verify Tests

1. Generate a side-by-side **Real Photo | Before | After** comparison sheet in the artifact directory:
   ```bash
   .venv/bin/python .agents/skills/traf1-livery-audit/scripts/livery_audit_kit.py compare \
     --manifest <scratch>/compare_spec.json \
     --out <artifact_dir>/comparison_<YEAR>.png
   ```
2. Visually inspect the generated comparison sheet with `read_file` and embed it in a concise audit markdown report.
3. Run the livery verification suite:
   ```bash
   .venv/bin/python -m unittest tests/test_livery_regs_politics.py -v
   ```

**Done when:** Comparison sheet is verified, production `static/cars/png/` assets and `manifest.json` are up to date, and all unit tests pass.
