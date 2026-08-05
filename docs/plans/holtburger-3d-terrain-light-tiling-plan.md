# Terrain Light Tiling Plan

Status: Complete
Created: 2026-08-04
Closed at the Phase 1 measurement gate: 2026-08-04
Reopened: 2026-08-05 — build for headroom, incorporating the parallel implementation's evidence
Completed: 2026-08-05 — built, verified visually identical, and measurably faster in the worst case

## Goal

Cut terrain's per-pixel point-light loop from a landblock's whole light set to only the lights that
reach the terrain cell being shaded, using the 8x8 grid terrain already has.

## Reopening Rationale

At reopening, the Phase 1 gate finding stood unrefuted: the untiled loop over the archive's worst
landblock was measured at about 0.045 ms per frame. The plan was reopened as a deliberate decision
to build **headroom**, not because a new measurement had reversed the gate:

> Superseded by Phase 5. The reopened build's own A/B measured 0.518 ms of light cost in its
> worst-case scene and a 0.36 ms saving from tiling — an order of magnitude above the figure this
> section was written against. The configurations differ and neither measurement was re-derived
> against the other; see Phase 5 for what is and is not claimed. The headroom argument below stands
> on its own regardless, and was the reason to build.

- The per-fragment iteration bound currently scales with a landblock's whole light set (up to
  `MAX_STATIC_LIGHTS` = 64). Tiling drops it to the per-cell population, which the parallel
  `3d-next` implementation measured at 4–5 lights in the busiest cell of one of the densest
  landblocks in the archive (`0xDA55FFFF`). Entity and effect lights will eventually join the
  scene; a per-cell bound is the shape that survives that growth without revisiting the shader.
- A sibling branch (`3d-next`) built a tiled terrain path end to end. Its GPU-side design was
  sound; its costs were CPU-side lifecycle mistakes. Building now lets us adopt the proven parts
  while the comparison is fresh, and record the mistakes as explicit anti-goals.

Because the motivation is headroom, the acceptance bar changes accordingly: the build must be
**visually identical and performance-neutral** in both the realistic and the worst-case scenes.
Phase 1's measured baseline remains the number the re-profile is checked against; a regression
against it is a defect, and a measured improvement is not required.

## Learnings from the parallel implementation

The `3d-next` branch implemented terrain light tiling as a view-wide deduplicated std140 UBO of
light records plus a per-landblock `R8UI` index texture of `[count, index…]` rows, capped at 8
lights per cell. It worked, and its evidence and failures inform this design:

- **Per-cell populations are tiny even where lights are dense.** `0xDA55FFFF` settled at 35–42
  active sources with at most 4–5 applicable to any one cell. The mask iteration this plan chose
  will be short in practice everywhere.
- **A per-cell capacity is a failure mode; a mask has none.** Their 8-per-cell rows required a
  loud overflow failure, and their pre-resteer bounded-set attempt silently dropped 27 of 35
  lights on that landblock. A `uvec2` bit mask over the landblock's uploaded set has no per-cell
  cap and no overflow path at all. This plan keeps the mask.
- **Build tiles at publish cadence, never per frame.** Their dominant costs were per-frame,
  per-view CPU lifecycle: light collection ran three times per visible landblock, dynamic lights
  were re-projected onto every visible grid every frame, and the full light table and index atlas
  were recompiled and diff-compared per view even when settled. This plan computes masks inside
  `OutdoorLightIndex`'s existing residency-scoped memoization and uploads per bind; nothing about
  tiling runs per frame beyond the existing 13–22 landblock binds.
- **Keep dynamic lights out of the tiles.** Their moving headlamp forced per-frame re-projection
  and re-canonicalization work across every receiver and grid it touched. This plan's dynamic set
  stays untiled in its existing ≤8-light frame-global loop, so a moving light costs what it
  costs today.
- **No cross-landblock light table.** Their view-wide deduplicated UBO exists to serve a
  cross-layer draw-time light field; our terrain already binds per-landblock uniform arrays at
  most 22 times a frame, and a shared table would add a lifecycle owner without a measured
  benefit. The mask indexes the per-landblock upload order we already have.
- **GL details their fixtures caught, worth pre-empting:** integer-texture uploads whose row size
  is not 4-byte aligned need `UNPACK_ALIGNMENT = 1`, and any pixel-store state changed for the
  upload must be restored so unrelated texture paths do not inherit it. An `RG32UI` 8x8 upload is
  8-byte-aligned rows, so this likely stays theoretical here — but the restore discipline applies
  regardless.

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

### Phase 2: Per-cell bucketing

Progress: **Complete (2026-08-05).** Reopened from the 2026-08-04 gate closure.

Landed:

- [terrain-light-mask.ts](../../apps/holtburger-3d/src/lib/game/environment/terrain-light-mask.ts):
  `buildTerrainLightMasks` buckets a resolved set into the 8x8 grid, testing each light's
  horizontal sphere against every cell its bounding span touches, with the same
  vertical-extent-ignoring rule `reachesBounds` already uses at landblock scale.
- `LandblockLights` in
  [outdoor-light-index.ts](../../apps/holtburger-3d/src/lib/game/environment/outdoor-light-index.ts):
  the lights and their masks now resolve as one value, built inside the existing memoization.

Decisions:

- **The masks and the light array are one composite value, not two returns.** A mask names slots
  in a specific array; anything that reorders that array must replace the masks in the same step.
  Making them separate returns would let a caller pair a fresh array with a stale table, which is
  precisely the drift this plan's risk section names.
- **Overflow binds `TERRAIN_LIGHT_MASK_ALL`, not stale masks.** The renderer's `selectNearestLights`
  path reorders by camera distance when a landblock exceeds `MAX_STATIC_LIGHTS`, invalidating masks
  built against the gathered order. That path is unreachable on retail content (worst landblock 51
  against a cap of 64), but the fallback makes it correct rather than merely improbable: the shader
  bounds iteration by the live count, so an all-ones table costs only the tiling saving.
- **A module-load invariant ties the cap to the mask width.** `MAX_STATIC_LIGHTS` must equal
  `TERRAIN_LIGHT_MASK_WORDS * 32`, because the shader declares a `uvec2` and an `RG32UI` texture.
  Raising the cap is a shader change; failing at load says so rather than letting lights past slot
  63 silently stop reaching terrain.

Deliverables as originally planned:

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

- [x] Bucketing with residency-scoped caching.
- [x] Tests, including the mask-index-versus-upload-order agreement. The agreement test walks all
      64 slots and asserts bit position equals array index across both words, plus that a
      second-word light does not leak into first-word bits.

### Phase 3: Mask delivery and the shader

Progress: **Complete (2026-08-05).** Reopened from the 2026-08-04 gate closure.

Landed:

- [webgl2-terrain-light-mask.ts](../../apps/holtburger-3d/src/lib/game/renderer/webgl2-terrain-light-mask.ts):
  one immutable 8x8 `RG32UI` texture, allocated by `texStorage2D` and updated by `texSubImage2D`.
- Shared GLSL split into `evaluateDynamicLights`, `evaluateStaticLights` and `accumulateMaskedWord`;
  `evaluateRuntimeLights` is now their sum, so the object path is byte-for-byte the same work it
  was. Terrain calls its own `evaluateMaskedStaticLights`, per the plan's preference for a
  terrain-specific entry point over a branch inside the shared function.

Decisions and discoveries:

- **The light cell is derived independently of the surface field.** The obvious move was to reuse
  the `cell` the fragment already computes for `uSurfaceField`, which would have guaranteed
  agreement for free. It is wrong: the surface field's resolution follows the LOD stride (8x8,
  4x4, 2x2 for strides 1, 2, 4), so a distant landblock would coarsen its light cells to 48 or 96
  units and shift which fragments see a lamp. The mask grid is therefore always the authored 8x8,
  derived from `vGridUv` directly.
- **`findLSB` is GLSL ES 3.10 and unavailable in WebGL2**, as recorded before the build started.
  The shader isolates the lowest set bit with `bits & (0u - bits)` and reads its index out of the
  float exponent, which is exact for every power of two through 2^31. `glslangValidator` accepts
  it; the shift-and-test fallback was not needed.
- **The validator needed `landblocks.ts` added to its constant modules**, because the shader now
  interpolates `OUTDOOR_TERRAIN_GRID_CELLS`. It failed loudly on the unknown name rather than
  emitting a literal `${...}`, which is the behaviour that phase was built for.
- **Unlit landblocks skip the upload entirely.** The texture and sampler bind once per terrain
  pass; only a landblock with lights uploads its table. An unlit landblock inherits whatever was
  uploaded last, which cannot leak light because the masked loop bounds every index by the live
  light count. This was not a micro-optimization for its own sake — see the Phase 5 measurement
  that forced it.

Deliverables as originally planned:

- An 8x8 `RG32UI` texture per landblock bind, uploaded by `texSubImage2D` — 512 bytes across 13 to
  22 binds per frame. Chosen over the alternatives:
  - `uniform uvec2[64]` would add 64 slots to a fragment stage already carrying 144 of a
    guaranteed 224. Self-defeating, per North Star 4.
  - A `flat` vertex attribute would be free, since each terrain triangle lies wholly within one
    cell — but the mesh shares vertices across cells, so it would need unsharing from 81 to 256
    vertices. Cheap in itself, but it changes the terrain mesh layout, a wider blast radius than
    the thing being optimized.
- Terrain fragment derives its cell from the landblock-local position it already has, reads one
  texel, and iterates only the set bits. `findLSB` is GLSL ES 3.10 and unavailable in WebGL2's
  ES 3.00, so isolate the lowest set bit as `mask & (0u - mask)`, recover its index from the
  float exponent — `(floatBitsToUint(float(lsb)) >> 23) - 127u`, exact for every power of two up
  to bit 31 — and clear it with `mask ^= lsb`. The loop then runs once per resident light rather
  than once per array slot. If the emulation proves awkward under the shader validator, the
  fallback is a shift-and-test loop terminating when the remaining mask is zero; unset bits then
  cost one shift and one branch each.
- The dynamic set is untouched: the terrain fragment keeps its existing ≤8-light frame-global
  dynamic loop after the masked static loop. Only static iteration is tiled.
- The shared `evaluateRuntimeLights` must not regress for objects, which have no mask. Prefer a
  terrain-specific entry point over a branch inside the shared function.

Acceptance criteria:

- Night captures are visually identical to the current renderer, at the same camera. Any visible
  change is a defect.
- Re-profiled against the Phase 1 baseline in both the realistic scene and the worst-landblock
  synthetic scene, the build is **performance-neutral or better**. Per the reopening rationale, a
  measured improvement is not required — the worst-case cost was already 0.27% of a frame — but a
  regression against either baseline is a defect. The per-bind mask upload (512 bytes across
  13–22 binds) is the plausible regression source to watch.
- GLSL validation, and the existing shader uniform-consistency test, both pass.

Tasks:

- [x] Mask texture lifecycle and per-bind upload.
- [x] Terrain fragment cell derivation and masked iteration.
- [x] Before/after captures at identical framing. See Phase 5.
- [x] Re-profile and compare against Phase 1. See Phase 5.

### Phase 4: Resteer and cleanup

Progress: Complete (2026-08-04). This phase closed the plan's first iteration at the gate; it is
retained as the record of that decision. The 2026-08-05 reopening supersedes the closure but not
the findings.

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

### Phase 5: Verification and closure of the reopened build

Progress: **Complete (2026-08-05).**

#### Building an instrument that could fail

Two configurations produced a perfect null result before one produced a real one, and both nulls
would have read as "visually identical, ship it":

1. **An empty frame.** The first fixed-camera capture placed the camera at `96,120,-96`, which is
   in landblock `0x0000`; `0xDA55FFFF` sits near `x 41856, z -16320`. Nothing drew.
   `staticLightBinds: 0` in the harness report is what exposed it — the terrain loop body had
   never run, so before and after were two identical blank frames.
2. **A scene with no lights in it.** The next capture isolated terrain by dropping
   `--explicit-object-radius`. Authored lamps are published by the **Objects layer**, so removing
   objects removed every static light. Terrain drew, the diff was still zero, and the comparison
   still proved nothing.

The lesson generalizes past this plan: a zero diff is evidence only once the same instrument has
been shown to produce a non-zero one. Two controls now bracket every claim below.

- **Live-signal control.** Lights on versus `--no-static-lights`, same camera: **136,008 differing
  pixels (7.13%), max channel delta 70**. The lamps are demonstrably reaching the pixels compared.
- **Positive control.** With the mask deliberately transposed (`column * CELLS + row`), the same
  comparison yields **90,120 differing pixels (4.73%), max delta 70** — roughly 115x the noise
  floor. A cell-indexing defect is loudly detectable by this instrument, so the null result below
  is meaningful.

#### Visual identity

Scene: `0xDA55FFFF`, one-landblock radius, night (`--time-of-day 0`), explicit camera
`42000,68,-16368` at pitch -35, 1920x1080, `--gpu`, object geometry culled by footprint while
remaining resident so their lamps still publish.
Adapter: `ANGLE (AMD, Vulkan 1.4.354 (AMD Radeon RX 7900 XT (RADV NAVI31)), radv)`.

| Comparison                       | Differing pixels | Max delta |
| -------------------------------- | ---------------- | --------- |
| Same build, two runs (noise)     | 681 (0.036%)     | 32        |
| Untiled versus tiled             | 793 (0.042%)     | 32        |
| Untiled versus tiled, after skip | 778 (0.041%)     | 32        |
| Lights on versus off (signal)    | 136,008 (7.13%)  | 70        |
| Transposed mask (positive)       | 90,120 (4.73%)   | 70        |

The tiled build is indistinguishable from the untiled one at the instrument's noise floor, while
that instrument resolves a deliberate defect at 115x that floor.

**The harness is not frame-deterministic once objects or generated scenery are resident**: two runs
of identical code differ by 681 to 2,597 pixels at max delta 27 to 35, scattered rather than
structured. Terrain alone with an explicit camera is bit-exact across runs, so the variance enters
with object content — most likely async texture residency racing the capture. It was bounded and
worked around rather than diagnosed; see Debt.

#### Performance

Worst landblock `0xE74EFFFF`, 3840x2160, explorer focus, `--measure-ms 4000`, three runs each,
`averageRenderMs`:

| Build   | Lights on           | Lights off          | Light cost |
| ------- | ------------------- | ------------------- | ---------- |
| Untiled | 1.194 /1.178 /1.203 | 0.668 /0.682 /0.672 | 0.518 ms   |
| Tiled   | 0.827 /0.824 /0.832 | 0.691 /0.690 /0.700 | 0.134 ms   |

Tiling removes about **0.36 ms**, roughly 70% of the measured light cost, with no overlap between
the two lights-on groups. Unlit cost rises by 0.020 ms, which is the residual pass-level bind.

Realistic scene (`0xDA55FFFF`, 1920x1080, explorer focus, generated scenery included): tiled
1.159 / 1.152 / 1.122 versus untiled 1.203 / 1.168 / 1.144. The ranges overlap; the effect is below
the noise floor exactly as Phase 1 found at this resolution. The neutrality bar is met in both
scenes and exceeded in the worst case.

**A first measurement forced a design change.** Before the upload skip, the tiled build was
_slower_ than the untiled one with lights disabled — 0.766 / 0.751 / 0.774 against 0.680 — because
every terrain bind uploaded a 512-byte table plus sampler and uniform state whether or not the
landblock had any lights to name. Binding once per pass and uploading only for lit landblocks
removed it. In the verification scene this is 3 uploads across 7 terrain binds; archive-wide only
629 of 5,346 landblocks carry an authored light, so most terrain now pays nothing at all.

**This contradicts Phase 1's magnitude, and the disagreement is left standing rather than
reconciled.** Phase 1 measured the whole 51-light loop at about 0.045 ms and closed the plan on it;
this phase measures 0.518 ms of light cost in its worst-case scene. The configurations differ —
Phase 1 used a synthetic terrain-only camera against a single landblock's set, this one an
explorer-focus view with seven lit terrain draw units and buildings — so the two are not directly
comparable, and no attempt was made to re-derive Phase 1's exact scene. What can be said is that
the reopened build's own A/B is internally consistent, three-sample, cleanly separated, and taken
on the same adapter. Anyone treating 0.045 ms as the standing figure for terrain light cost should
re-measure first.

Deliverables:

- Before/after captures at identical framing, night, in a lit town and in the worst landblock.
- Re-profile against both Phase 1 baselines under `--gpu` with the pacing flags, recorded here
  with the `glRenderer` string.
- [docs/lighting.md](../lighting.md) updated: the terrain divergence bullet gains the per-cell
  mask mechanism, since the shader-facing behavior changes shape even though its output must not.
- Plan status moved to Complete, or the build reverted and the reversion recorded — reverting
  remains a legitimate outcome if Phase 3's neutrality bar cannot be met.

Concessions and debt raised:

- **No GPU-stage attribution.** GPU timestamp queries remain unsupported in the headless harness,
  so every figure here is end-to-end `averageRenderMs` with the same scene and camera on both
  sides. It bounds the change from above; it does not attribute it to the fragment stage.
- **Harness frame nondeterminism with object content is unexplained.** It was bounded by controls
  and side-stepped by culling object geometry from the draw, not diagnosed. Any future pixel
  comparison in this repository must establish its own noise floor before claiming identity, and
  the residual variance is worth a separate investigation.
- **Object footprint culling was used as a noise-reduction lever.** Objects stayed resident so
  their lamps published, but were culled from drawing by
  `--minimum-object-footprint-pixel-area 100000000`. That changes the scene from what a player
  sees; terrain, which is what tiling affects, is unchanged by it.
- **Only the terrain path is verified per-pixel.** Objects are covered by their existing tests and
  by the fact that the shared GLSL refactor leaves `evaluateRuntimeLights` computing the same sum,
  not by a rendered comparison of their own.
- **A deterministic GPU parity fixture remains the missing instrument.** The controls here are a
  workaround for its absence. A fixture that renders known geometry under known lights and asserts
  exact pixel values would have made all of Phase 5 a unit test, and would serve every future
  shader change. Raised as debt, not built here.

Tasks:

- [x] Captures compared and archived.
- [x] Re-profile recorded against both baselines.
- [x] `docs/lighting.md` divergence section updated.
- [x] Status resolved: built, verified, kept.

## Risks & Mitigations

- **The profile says terrain was never the bottleneck.** This happened, and closed the plan's
  first iteration. The reopened build accepts it and answers with a neutrality bar instead of an
  improvement bar; the residual risk is building a mechanism whose benefit never materializes,
  accepted knowingly as headroom for entity and effect lights.
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

First iteration, closed at the gate (2026-08-04):

- [x] Hardware baseline recorded, with the scene and camera named, for both a typical and the worst
      landblock.
- [x] The gate is evaluated explicitly, and a decision recorded either way. **Closed: not built.**
- [x] Terrain fragment uniform usage is stated in absolute terms against the 224 floor, not the 256
      one.

Reopened build (2026-08-05):

- [x] Masks computed under `OutdoorLightIndex`'s existing residency-scoped invalidation; nothing
      tiling-related executes per frame beyond the existing per-landblock binds and, for lit
      landblocks only, one 512-byte upload.
- [x] The mask index-versus-upload-order agreement pinned by test.
- [x] Night captures visually identical, at the instrument's noise floor, with a positive control
      proving the instrument resolves a cell-indexing defect at 115x that floor.
- [x] Re-profiled performance-neutral or better against both Phase 1 baselines, under `--gpu` with
      the pacing flags: neutral in the realistic scene, 0.36 ms faster in the worst case.
- [x] Objects and the dynamic light loop demonstrably unchanged: `evaluateRuntimeLights` still
      computes the same dynamic-plus-static sum, and terrain's dynamic loop is untouched.
- [x] `npm run check` by exit code, frontend tests, GLSL validation, lint, formatting, and
      `cargo clippy` all clean.

## Open Questions

- ~~Is the worst landblock somewhere a player would ever stand?~~ Moot: even assuming a player
  stands in the worst one at 4K, the cost is 0.27% of a frame.
- ~~Should the cell grid match terrain's 8x8, or a coarser 4x4?~~ Resolved by reuse: 8x8, the grid
  terrain already has, per North Star 3.
- ~~Bit mask or per-cell index rows?~~ Resolved on reopening: mask. Index rows (the `3d-next`
  shape) reintroduce a per-cell capacity and an overflow failure mode; a `uvec2` mask over the
  per-landblock upload order has neither. See "Learnings from the parallel implementation".
- **Still open:** the uniform ceiling. It is independent of this plan and is the constraint that
  will actually bite, since raising `MAX_STATIC_LIGHTS` eats the fragment stage's 224-vector
  floor. A UBO cutover raises the cap without touching throughput; the mask is indifferent to
  where the light array lives, so that cutover remains orthogonal.
