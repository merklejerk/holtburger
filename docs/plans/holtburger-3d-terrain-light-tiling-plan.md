# Terrain Light Tiling Plan

## Goal

Cut terrain's per-pixel point-light loop from a landblock's whole light set to only the lights that
reach the terrain cell being shaded, using the 8x8 grid terrain already has — but only after a
hardware profile proves the loop is worth cutting.

## Scope

In scope:

- A hardware baseline for terrain point-light fragment cost, including the archive's worst
  landblock rather than a typical one.
- Per-cell light bucketing for outdoor authored lights, cached under the existing residency
  invalidation.
- A per-cell mask delivered to the terrain fragment shader, and the shader change to consume it.

Out of scope:

- **Raising the light count.** Tiling reduces iteration; it does not touch storage. See
  Non-Goals.
- Objects. They evaluate per vertex and are finely tessellated; the smearing problem that forced
  terrain per-pixel does not apply to them.
- Dynamic lights. They are frame-global and few; bucketing them per landblock cell would mean
  rebuilding buckets every frame for a set that currently holds one light.
- Screen-space tiled or clustered forward rendering. See Non-Goals.

## Non-Goals, and why

**This does not raise the uniform ceiling.** The two light arrays occupy `2 * 64 + 2 * 8 = 144`
vec4. A per-cell mask makes the shader _iterate_ fewer of them; the data still lives in those same
uniform arrays. Raising `MAX_STATIC_LIGHTS` is a storage problem whose answer is a uniform buffer
(16 KB guaranteed, roughly 1024 vec4) or a light-data texture. The two levers are orthogonal and
should not be conflated:

| Problem               | Lever                       |
| --------------------- | --------------------------- |
| Terrain fragment cost | Per-cell tiling (this plan) |
| Light count ceiling   | UBO or texture storage      |

**This is deliberately not screen-space tiling.** Clustered forward bounds work by what is on
screen and would serve terrain, objects, and dynamic lights with one mechanism, which is the right
answer if light counts ever grow broadly. A landblock-local world-space grid is narrower: it does
work proportional to resident landblocks rather than to the view, and helps only terrain. It is
chosen here because it reuses a grid that already exists and needs no new spatial structure — and
because if the profile says terrain is not the bottleneck, we will have built neither.

## Ground Truth

- Terrain landblocks are a regular grid: `OUTDOOR_TERRAIN_GRID_CELLS = 8`,
  `OUTDOOR_TERRAIN_TILE_SIZE = 24`, `OUTDOOR_LANDBLOCK_WORLD_SIZE = 192`
  ([landblocks.ts](../../apps/holtburger-3d/src/lib/game/landblocks.ts)).
- Authored lamp reach is 4.5 to 9.0 units (falloff 3 to 6, scaled by
  `RUNTIME_LIGHT_RANGE_SCALE`), so a lamp touches one or two cells per axis.
- Measured light counts: **3.6 per landblock on average, 51 in the archive's worst single
  landblock**. `MAX_STATIC_LIGHTS` is 64.
- A `uint` mask covers only 32 lights, so the mask must be `uvec2`. This is forced by the 51-light
  landblock, not by the 64 cap.
- The terrain mesh is a shared 9x9 = 81-vertex grid, so adjacent cells share vertices.
- WebGL2 guaranteed uniform floors: 256 vertex vectors, **224 fragment vectors**.
- `WEBGL2_SCENE_LIGHTING_GLSL` is included by the terrain **fragment** shader
  ([webgl2-terrain-program.ts:73](../../apps/holtburger-3d/src/lib/game/renderer/webgl2-terrain-program.ts)),
  so the 144 vec4 of light arrays land against the 224 floor, not the 256 one.
- Existing patterns: `OutdoorLightIndex` already memoizes per-landblock sets and clears wholesale
  on residency change; the renderer already profiles CPU/GPU phases via `--profile-renderer`.

## North Stars

1. **A number to beat, before a line of shader code.** An optimization with no baseline can
   neither succeed nor fail.
2. **Measure the tail, not the median.** The average landblock has 3.6 lights and was never the
   concern. If the 51-light case is fine on hardware, the honest outcome is to close the question.
3. **Reuse the grid terrain already has.** This earns its place by needing no new spatial
   structure; a version that invents one has lost its argument.
4. **Do not spend the uniform budget to save uniform iteration.** The terrain fragment stage is
   the constrained one.
5. **Leave the general answer open.** Nothing here should make screen-space clustering harder
   later.

## Phased Implementation

### Phase 1: Baseline, and the gate

Progress: **Complete (2026-08-04). The gate closed the plan — Phases 2 and 3 are not built.**

Deliverables landed:

- `outdoor_light_ranking` debug bin, replacing the deleted census with a narrower tool that ranks
  landblocks by authored light count. It enumerates the landblock coordinate space directly rather
  than through an archive-wide index, so it did not require resurrecting the
  `ContentRepository::resource_index` accessor removed alongside the census.
- `--gpu` harness mode, which runs on the real adapter instead of SwiftShader, plus a recorded
  `glRenderer` string on every harness report so any timing carries proof of what produced it.
- `staticLightsEnabled` frame setting and `--no-static-lights` harness flag, so the A/B is the same
  scene and the same camera with only the lights removed.

Findings:

- **Worst landblock is `0xE74EFFFF` with 51 authored lights**, confirming the previously recorded
  worst case. Next are `0x49B8FFFF` at 44 and `0xDA55FFFF` at 39. 629 of 5346 landblocks carry any
  authored light, mean 3.6 across the lit ones.
- **Measured cost: about 0.045 ms per frame** for all 51 lights, at 3840x2160, terrain filling the
  screen, on an RX 7900 XT. Three runs each: lights on 0.4848 / 0.5023 / 0.5327 ms, lights off
  0.4807 / 0.4406 / 0.4590 ms. Clean separation, roughly 10% of a terrain-only frame — and **0.27%
  of a 16.7 ms frame budget**.
- **In a realistic scene the effect is below the noise floor.** At 1920x1080 with a one-landblock
  radius, lights-off measured _slower_ than lights-on across repeats. The cost is only resolvable
  in a synthetic terrain-only 4K configuration built specifically to expose it.

**Gate: closed. Terrain point-light cost does not justify a tiling structure.** The worst landblock
in the entire archive, at 4K, costs a quarter of a percent of a frame. Per North Star 2, the honest
outcome is to close the question rather than build against it.

Decisions and course corrections:

- **Every timing figure this repository had recorded before today was invalid, including this
  plan's own premise.** The browser harness ran Chrome without `--disable-gpu-vsync` and
  `--disable-frame-rate-limit`, so frame time was pinned near 5.5 ms regardless of workload.
  Nine times the pixels (1280x720 to 3840x2160) moved frame time by 1%. The first A/B run under
  those conditions produced a _perfect null result_ — lights-on marginally faster than lights-off —
  which would have been reported as "terrain lighting is free" had the fill-sensitivity control not
  caught it. The control existed only because the measurement was distrusted on principle.
- **GPU timestamp queries are unavailable in the headless harness**, reporting
  `{"kind": "unsupported"}`. Fragment cost therefore cannot be attributed directly and had to be
  inferred from end-to-end frame time with the workload starved of CPU work. This is a standing
  limitation on any GPU-phase attribution from this harness.
- Concession: the reported cost is an inference from wall-clock frame time under a synthetic
  configuration, not a measured shader-stage cost. It bounds the cost from above, which is all the
  gate needed.

Tasks:

- [x] Restore a narrow means of finding high-light landblocks.
- [x] Add a static-light frame setting so the A/B is same-scene, same-camera.
- [x] Profile on hardware; record numbers and the exact scene.
- [x] Evaluate the gate and either continue or close the plan.

### Phase 2: Per-cell bucketing — NOT BUILT (gate closed)

Deliverables:

- Bucketing of a landblock's resolved light set into its 8x8 cells, as a `uvec2` mask per cell,
  computed alongside the effective set in `OutdoorLightIndex` and invalidated identically.
- A light's sphere must be tested against each cell's extent, the same horizontal-only test
  `reachesBounds` already performs. Neighbour spill means a cell near a boundary can hold lights
  owned by another landblock, which is already handled upstream.

Acceptance criteria:

- Unit tests: a lamp deep inside one cell marks only that cell; a lamp near a cell corner marks
  every cell it reaches; a landblock with no lights produces no masks and allocates nothing.
- Bucket indices agree with the order the bind uploads lights in, since the mask indexes that
  array. A test must pin this, because it is the one place the two can silently disagree.

Tasks:

- [ ] Bucketing with residency-scoped caching.
- [ ] Tests, including the mask-index-versus-upload-order agreement.

### Phase 3: Mask delivery and the shader — NOT BUILT (gate closed)

Deliverables:

- An 8x8 `RG32UI` texture per landblock bind, uploaded by `texSubImage2D` — 512 bytes across 13 to
  22 binds per frame. Chosen over the alternatives:
  - `uniform uvec2[64]` would add 64 slots to a fragment stage already carrying 144 of a
    guaranteed 224. Self-defeating, per North Star 4.
  - A `flat` vertex attribute would be free, since each terrain triangle lies wholly within one
    cell — but the mesh shares vertices across cells, so it would need unsharing from 81 to 256
    vertices. Cheap in itself, but it changes the terrain mesh layout, a wider blast radius than
    the thing being optimized.
- Terrain fragment derives its cell from the landblock-local position it already has, reads one
  texel, and iterates only the set bits.
- The shared `evaluateRuntimeLights` must not regress for objects, which have no mask. Prefer a
  terrain-specific entry point over a branch inside the shared function.

Acceptance criteria:

- Night captures are visually identical to the current renderer, at the same camera. This is an
  optimization; any visible change is a defect.
- The profiled cost from Phase 1 improves measurably in the worst landblock.
- GLSL validation, and the existing shader uniform-consistency test, both pass.

Tasks:

- [ ] Mask texture lifecycle and per-bind upload.
- [ ] Terrain fragment cell derivation and masked iteration.
- [ ] Before/after captures at identical framing.
- [ ] Re-profile and compare against Phase 1.

### Phase 4: Resteer and cleanup

Progress: Complete (2026-08-04).

- [x] The result does not justify the mechanism, so nothing was built to revert. Reverting was a
      declared legitimate outcome; closing before building is the cheaper version of it.
- [x] Corrected the stale uniform budget note in
      [runtime-lights.ts](../../apps/holtburger-3d/src/lib/game/environment/runtime-lights.ts). It
      cited the vertex stage's 256-vector floor; the binding constraint is the fragment stage's 224,
      because terrain evaluates point lights per pixel. Worth fixing independently of this plan, as
      predicted.
- [x] Nothing recorded in [docs/lighting.md](../lighting.md): no mechanism was kept.
- [x] **Retained** the static-light toggle, `--gpu`, `glRenderer` reporting, and the frame-pacing
      flags. The toggle is the only way to attribute light cost at all, and the pacing flags are
      what make any harness timing meaningful. Removing them would re-create the exact trap this
      phase fell into.
- [x] **Retained** `outdoor_light_ranking`. Unlike the census it replaced, it answers a question
      that recurs — which landblock is the worst case — rather than a one-time census whose findings
      could be written down.

Debt raised for elsewhere:

- The runtime light system plan's Phase 3 resteer recorded a 0.57 ms lit-town figure against a
  0.19 ms unlit baseline. Both were measured on SwiftShader **and** under the frame-rate limiter, so
  they measured pacing, not rendering. That plan has been corrected rather than left to mislead.
- Any future performance work should treat `--gpu` as mandatory and confirm fill sensitivity before
  trusting a null result.

## Risks & Mitigations

- **The profile says terrain was never the bottleneck.** Likely, and fine — Phase 1 is designed to
  cost little and to end the plan cleanly. The stale uniform note still gets fixed.
- **Mask indices drift from upload order.** The mask is meaningless if bit _n_ stops meaning the
  *n*th uploaded light. Pinned by test in Phase 2; the two are produced in different files, which
  is exactly the drift shape that survives review.
- **Per-bind texture upload costs more than the loop saves.** Plausible at 13 to 22 uploads per
  frame for an average of 3.6 lights. The Phase 3 re-profile is the check, and Phase 4 permits
  reverting.
- **A cell-boundary seam.** A light must mark every cell it reaches, not merely the cell holding
  its centre. Covered by the corner test in Phase 2, and any seam is immediately visible in the
  Phase 3 captures.
- **Entity lights arrive mid-flight and change the picture.** They land in the dynamic set, which
  this plan deliberately leaves untiled. If they push counts up broadly, screen-space clustering
  becomes the better investment and this mechanism should be reconsidered rather than extended.

## Definition of Done

- [x] Hardware baseline recorded, with the scene and camera named, for both a typical and the worst
      landblock.
- [x] The gate is evaluated explicitly, and a decision recorded either way. **Closed: not built.**
- [x] If built: night captures visually identical, profiled improvement demonstrated, and the mask
      index-versus-upload-order agreement pinned by test. Not applicable — nothing was built.
- [x] Terrain fragment uniform usage is stated in absolute terms against the 224 floor, not the 256
      one.
- [x] `npm run check` by exit code, frontend tests, GLSL validation, lint, formatting, and
      `cargo clippy` all clean.

## Open Questions

- ~~Is the worst landblock somewhere a player would ever stand?~~ Moot: even assuming a player
  stands in the worst one at 4K, the cost is 0.27% of a frame.
- ~~Should the cell grid match terrain's 8x8, or a coarser 4x4?~~ Moot; nothing was built.
- **Still open, and now the only live question here:** the uniform ceiling. It is independent of
  this plan and is the constraint that will actually bite, since raising `MAX_STATIC_LIGHTS` eats
  the fragment stage's 224-vector floor. A UBO cutover raises the cap without touching throughput.
  Nothing measured today argues against it; it simply was not what this plan tested.
