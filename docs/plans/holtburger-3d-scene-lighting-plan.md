# Holtburger 3D Scene Lighting Plan

Status: Executing. Phases 0-3 complete; Phase 4 resteer done and awaiting one design decision.
Created: 2026-08-03

## Goal

Reproduce the retail client's lighting model — time-of-day sun and ambient, software-style terrain
lighting, and authored static interior lights — in the currently unlit holtburger-3d renderer.

## Scope

**In scope**

- Region-driven sun + ambient resolution with time-of-day interpolation (`SkyTimeOfDay` brackets).
- Terrain lighting (`ambient + N·L` per vertex).
- Object/building lighting outdoors via the retail fixed-function equation.
- Per-draw lighting roles so portal-visible interiors and sunlit outdoors coexist in one frame.
- Setup `LightInfo` plumbing from `holtburger-dat` through `holtburger-content` to the frontend.
- Interior lighting: burned-in static lights for all interior static geometry (shells and
  residents), forced interior ambient, and the viewer headlamp.
- Game-clock light ticking and fog-distance parity.

**Out of scope (deferred, not abandoned)**

- Sky pass: split into [holtburger-3d-sky-pass-plan.md](holtburger-3d-sky-pass-plan.md), which
  queues behind this plan's Phase 1 and consumes its time source and environment resolution. The
  split is scope hygiene only — the sky has no lighting semantics and no machinery dependency
  (its brightness values are instant material writes, not timed interpolation or hooks; evidence
  recorded in that plan's Ground Truth).
- Dynamic lights: entity-carried lights, the `SetLight` animation hook, nearest-N light sorting and
  hardware-slot allocation, and `SetLuminosity`/`SetDiffusion` timed interpolation. Blocked on
  [holtburger-3d-dynamic-entity-runtime-plan.md](holtburger-3d-dynamic-entity-runtime-plan.md).
  Known interim consequence: dynamic entities in interiors render at the flat forced interior
  ambient.
- Spell/quest environment overrides (`LScape::m_override_*`) — requires a network client.
- Screen brightness/gamma preference.
- Specular — retail disables it globally; there is nothing to implement.

## Ground Truth

The retail client is a D3D9 fixed-function renderer. All lighting behavior below is established
from the decompile, not inferred:

- Sun and ambient come from `SkyDesc` day groups: `SkyTimeOfDay` carries `dir_bright`,
  `dir_heading`, `dir_pitch`, `dir_color`, `amb_bright`, `amb_color`, and world-fog fields.
  Bracketing entries are linearly interpolated by day fraction (`DayGroup::GetTimeOfDay`,
  acclient.c:290881; `SkyDesc::GetLighting`, acclient.c:290949). The sun vector is deliberately
  unnormalized — its length carries `dir_bright`.
- Terrain is software-lit per vertex with fixed-function lighting disabled:
  `min(1, ambient_level * amb_color + max(0, N·sunlight) * sunlight_color)` per channel
  (`CLandBlockStruct::calc_lighting`, acclient.c:339136; `ACRender::landPolyDraw`,
  acclient.c:684340).
- The fixed-function object equation (no specular anywhere):
  `C = emissive + ambient_material * global_ambient + Σ diffuse_material * light_color * max(0, N·L) * atten`.
  Surface `luminosity` is pure emissive; `diffuse` scales the material diffuse
  (`CMaterial::SetLuminositySimple`, acclient.c:345688).
- Authored lights live on object Setups (`LIGHTINFO`: type, offset frame, color, intensity,
  falloff, cone angle — acclient.h:13465), not on EnvCells. `CEnvCell::light_array` is vestigial
  even in retail. Lights register into their containing cell (`CObjCell::add_light`,
  acclient.c:332796).
- Static interior lights are burned into EnvCell mesh vertex diffuse at construction using a
  half-Lambert wrap (`D3DPolyRender::SetStaticLightingVertexColors`, acclient.c:434570;
  `calc_point_light`, acclient.c:434189). Only dynamic lights hit hardware slots when drawing
  EnvCells (`Render::minimize_envcell_lighting`, acclient.c:363190).
- Interior ambient policy: when the camera's cell is not `seen_outside`, world ambient is forced to
  0.2 white and the sun is disabled (cell transition, acclient.c:140480; per-pass sun toggle
  `Render::useSunlightSet`, acclient.c:364145). Outdoor object ambient is
  `|sunlight| * 0.2 + ambient_level` (`LScape::calc_object_light`, acclient.c:140248).
- The viewer headlamp is a single point light at offset `(0, 0, 2)` from the player
  (`SmartBox::set_viewer`, acclient.c:137873).
- Fog is linear, vertex, radial (true 3D distance): `D3DRS_RANGEFOGENABLE = 1`
  (acclient.c:440257). Fog and lighting share the same time driver, so they stay in sync.

### Retail constants

| Symbol                                          | Value                                                                                       | Location                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------- |
| `LScape::min_ambient`                           | 0.2                                                                                         | acclient.c:747815                 |
| Interior forced ambient                         | 0.2, white                                                                                  | acclient.c:140521                 |
| Outdoor object ambient                          | `\|sunlight\| * 0.2 + ambient_level`                                                        | acclient.c:140248                 |
| Default `ambient_level` / `sunlight`            | 0.4 / (1.2, 0, 0.5)                                                                         | acclient.c:295928                 |
| Fallback (no sky_time entries)                  | ambient 0.3, white, dir (0.5, 0, 0.8)                                                       | acclient.c:290949                 |
| Point-light attenuation (Att0, Att1, Att2)      | 0, 1, 0 (pure 1/d)                                                                          | acclient.c:432903                 |
| Hardware light range multiplier (`rangeAdjust`) | 1.5                                                                                         | acclient.c:44671                  |
| Burned-in static light range multiplier         | 1.3                                                                                         | acclient.c:44703                  |
| Half-Lambert wrap in `calc_point_light`         | `(0.5·d + N·D) / 1.5`, per-channel clamp to light color                                     | acclient.c:434220                 |
| Light tick / sky tick                           | code defaults 20.0 s / 3.0 s; EoR Dereth DAT authors 15.0 s / 0.8 s — read from region data | acclient.c:290941; Phase 0 census |
| Always-daylight day fraction (`/day`)           | 0.5                                                                                         | acclient.c:295885                 |
| Terrain detail fade                             | alpha 255 at 10 m → 0 at 50 m                                                               | acclient.c:684401                 |
| Specular                                        | globally disabled                                                                           | acclient.c:440250                 |

### Existing patterns and touch points

- Environment resolution: `apps/holtburger-3d/src/lib/game/environment/scene-environment.ts`
  (day-group hash and fog already implemented; `lighting` facts stubbed for this plan).
- Region decode: `apps/holtburger-3d/src/lib/assets/active-region-source.ts` (all `directional*`
  fields already decoded, currently unread).
- Terrain shader and composition table:
  `apps/holtburger-3d/src/lib/game/renderer/webgl2-terrain-program.ts`,
  `apps/holtburger-3d/src/lib/game/terrain/composition-table.ts` (variation row packed at
  `TERRAIN_TYPE_VARIATION_ROW`, never sampled), normals from
  `apps/holtburger-3d/src/lib/game/terrain/terrain-generator.ts`.
- Object shader and variants: `apps/holtburger-3d/src/lib/game/renderer/webgl2-object-program.ts`
  (normals at location 1, unused; `uLuminosity` emissive add already matches retail),
  four hand-built variants in `webgl2-renderer.ts:451-460`.
- Geometry upload is non-interleaved per-attribute buffers
  (`webgl2-resource-manager.ts:237`), so new attribute streams are additive.
- EnvCell materialization: `apps/holtburger-3d/src/lib/game/commit/env-cell-materialization.ts` —
  shell geometry deduplicated by content identity (lines 142–151); resident jobs are per-cell and
  cannot span EnvCell scopes (line 63).
- Static worker instancing split: `isInstanceEligibleTransform` in
  `apps/holtburger-3d/src/lib/game/commit/static-object-geometry-worker.ts:562`.
- `LightInfo` parsed in `crates/holtburger-dat/src/file_type/setup_model.rs:45`; dropped at
  `crates/holtburger-content/src/repository.rs:977` and
  `crates/holtburger-content/src/generated_scenery.rs:768` (`lights: Default::default()`).
- Corroborating references: ACE server physics sources under `ACE/`; ACViewer is **not** a lighting
  reference (single hardcoded directional + 0.5 ambient, no point lights, no fog).

## North Stars

1. Retail-faithful output, architecture-native mechanism. We reproduce retail's math exactly, but
   map it onto our renderer's strengths (shader uniforms over CPU bakes) wherever the result is
   pixel-equivalent.
2. One lighting formula, one owner. Sun/ambient resolution happens once in the environment layer
   and lands in the contract type; shaders and bakers consume it, never re-derive it.
3. Lighting is always on. "Unlit" is neutral uniforms, not a shader variant. No program
   permutation growth.
4. The time-of-day slider is the debug harness. Every phase must be visually verifiable by
   scrubbing it in the explorer.
5. The CPU bake and the GPU uniform path are the same formula. A shared reference implementation
   with a parity fixture, or shells and furniture will disagree about the same torch.
6. Preserve retail's intentional quirks (unnormalized sun vector, per-channel clamps, min-ambient
   floor, gamma-naive 8-bit math). Do not "correct" them toward modern PBR habits.
7. Extensible shared representations: `LightInfo` crosses the content boundary lossless (including
   cone angle and type) even though this plan only consumes point lights statically.

## Phased Implementation

### Phase 0: Evidence gathering

Close the plan's measurable unknowns before any implementation, using bespoke harness programs in
`crates/holtburger-debug-harness` (temporary; removed or promoted deliberately afterward) and the
retail decompile. Confirmed already: `seen_outside` is parsed from EnvCell flag `0x01` and surfaced
at `crates/holtburger-content/src/interior.rs:244` — no work needed there.

Deliverables (each result is recorded in this plan's decision logs, with the dependent phase
updated):

- **Cell static light census**: iterate dungeon landblocks; for each EnvCell, resolve resident
  setups and count authored lights, recording the distribution (max, p99), the light-type mix
  (point / spot / distant), and intensity/falloff/color ranges. Decides the Phase 5 per-cell
  uniform array cap and whether spot or distant handling is needed indoors at all.
- **Retail spot handling check**: confirm from the decompile whether
  `D3DPolyRender::SetStaticLightingVertexColors` evaluates SPOT_LIGHT sources or only distant +
  point, so the burn-in formula's scope is proven, not assumed.
- **Zero-normals census**: scan GfxObjs for zero/degenerate authored normals (count, which objects,
  whether they appear in common scenes), paired with the decompile answer for what fixed-function
  D3D produced for them. Feeds the Phase 3 blocking decision.
- **Region lighting data dump**: dump `SkyDesc` day groups for the main regions — raw
  `SkyTimeOfDay` values and interpolated outputs at sampled day fractions. Validates unit
  interpretation (degrees for heading/pitch, brightness scales) against plausible dawn/noon/night
  values before Phase 1 encodes the math. Include the terrain vertex-variation bounds to confirm
  the Phase 2 variation sub-task is non-trivial in practice.
- **Interior instancing census**: measure how often interior residents are actually
  instance-eligible (`isInstanceEligibleTransform`) in real dungeons. If cell-scoped instanced
  fragments are rare, Phase 5 may drop the per-cell uniform array path entirely and bake
  everything — a meaningful simplification worth buying with one measurement.

Acceptance criteria:

- Each census produces concrete numbers recorded in this plan; the Phase 5 light cap, spot/distant
  scope, Phase 3 normals policy input, and the instanced-fragment path decision are filled in or
  explicitly re-deferred with a reason.

Tasks:

- [x] Harness: cell static light census.
- [x] Decompile: burn-in spot/distant scope.
- [x] Harness: zero-normals census + decompile behavior.
- [x] Harness: region `SkyDesc` dump + variation bounds.
- [x] Harness: interior instancing census.
- [x] Record results and update dependent phases.

Decisions and course corrections (executed 2026-08-03; harness:
`crates/holtburger-debug-harness/src/bin/lighting_census.rs`):

- **Light census** (734,976 EnvCells, all decoded): 146,307 lit cells holding 198,334 placed
  lights from 288 distinct setups. Per lit cell: p50=1, p99=5, max=26 (two cells). Histogram
  above 8 lights: 63 cells total. Intensity 20–100 (mean ≈100), falloff 1–15 world units,
  69 distinct colors dominated by warm 0xFFFAD79C. **Decision: per-cell light uniform cap = 32**
  — covers the observed max with headroom, needs no truncation policy in practice; assert on
  overflow anyway.
- **All authored lights are point lights.** Every light's `light_type` is 0 across the archive,
  and `cone_angle` is the 0xCDCDCDCD uninitialized-memory float in every asset. Retail's burn-in
  additionally skips SPOT structurally (type dispatch has no spot branch, acclient.c:434632-434651;
  `convert_to_local` drops orientation so a spot direction cannot exist in that path,
  acclient.c:433979). **Decision: implement point lights only; fail loudly on any other type.**
- **Course correction — parser shape fix landed during the census**: `SetupModel.lights` was
  `HashMap<i32, LightInfo>` treating the leading dword as a dict key, but retail `CSetup::UnPack`
  reads that dword into `LIGHTINFO.type` (acclient.c:322738). Cut over to `Vec<LightInfo>` with a
  leading `light_type` field (`crates/holtburger-dat/src/file_type/setup_model.rs`). Census counts
  were identical before/after, proving no multi-light setups exist and no HashMap collapse had
  occurred.
- **Intensity semantics**: intensity is not 0–1; the burn-in's per-channel
  `min(s * color, color)` clamp is the scaling mechanism (high intensity ⇒ light holds full color
  until near the range edge). The hardware path relied on D3D output saturation.
- **Burn-in quirks to carry** (from the decompile pass): with zero static lights the vertex
  diffuse is written **black 0xFF000000**, not left alone (acclient.c:434617-434684); the final
  color write forces alpha=0xFF, clobbering per-vertex translucency alpha; `calc_point_light`'s
  wrap term uses the **unnormalized** light vector (`dot(N, D)`, not `N·L̂`).
- **Zero normals**: 16,043 of 615,119 GfxObj vertices (2.6%) across 1,000 of 15,318 objects
  (6.5%). Retail performs no normalization, validation, or face-normal fallback for objects; only
  terrain derives normals (with a `<2e-4 → (0,0,1)` guard). Retail software-lighting semantics for
  a zero normal: distant/sun term contributes nothing (`max(0, N·L)`), point burn-in contributes a
  direction-independent glow via the wrap term. **Decision: preserve authored zeros, replicate the
  software semantics, derive nothing. The worker test's preserve-zeros policy stands; update its
  rationale, not its behavior.**
- **Region data** (Dereth, 20 day groups): DAT `tick_size=0.8`, `light_tick_size=15` — the retail
  constructor defaults (3.0/20.0) are fallbacks only; **ticking cadence must come from region
  data, not constants**. Sun heading is only ever 90°/270° (east→west with a flip at t=0.611);
  ambient colors are tinted (night ambient 0xFFC864FF); fog brackets track the same times.
  Interpolated samples at t=0/0.25/0.5/0.75 are plausible dawn/noon/dusk values.
- **Terrain variation bounds are non-trivial**: brightness 90–100, saturation 70–90, hue 90–150
  for land types; water types differ (30–60 / 30–40). Phase 2's variation sub-task is confirmed
  real work.
- **Interior composition**: 486,198 setup stabs vs 111,665 raw-GfxObj stabs; 198,541 duplicate
  placements across 65,831 cells; residents per cell p99=11, max=231. Superseded finding: the
  frontend only instances the outdoor Generated layer
  (`static-object-geometry-worker.ts:161-164`) — interior residents are always merged per cell,
  so **all interior static lighting is baked and no per-cell light uniform array is needed** (see
  Phase 5 decision log). The duplication numbers instead quantify a _potential future_ interior
  instancing optimization, which would then need shader-evaluated cell lights.

### Phase 1: Lighting resolution contract and time-of-day control

Retail behavior: `SkyDesc::GetLighting` interpolation, min-ambient floor, unnormalized sun vector,
`/day` fixed fraction.

Deliverables:

- `scene-environment.ts`: extend `ResolvedSceneEnvironment.lighting` to the full resolved output —
  ambient level + color, sun vector (unnormalized, brightness in magnitude), sun color — computed
  by interpolating the bracketing `SkyTimeOfDay` entries at a supplied day fraction, with the
  wrap-around span handling and the no-entries fallback.
- Fog resolution moves onto the same interpolation (it already reads the same brackets; unify the
  ratio computation so light and fog can never drift).
- Explorer time-of-day slider (day fraction 0..1) in `ExplorerWorldPanel.svelte`, default 0.5,
  feeding environment resolution alongside the existing day-group select.

Acceptance criteria:

- Unit tests: bracket selection incl. wrap span, interpolation ratios, min-ambient floor,
  unnormalized sun magnitude, fallback values — all against runtime constants, no magic numbers.
- Scrubbing the slider visibly changes fog color/range in the explorer (lighting itself lands in
  later phases).

Tasks:

- [x] Resolve full lighting facts in `resolveSceneEnvironment` from already-decoded region fields.
- [x] Unify fog onto the shared bracket interpolation.
- [x] Add the day-fraction slider and thread it through environment resolution.
- [x] Unit tests for the resolver.

Progress: Complete (2026-08-03). `npm run check`, `npm run lint`, and the environment suite
(12 tests) are green.

Decisions and course corrections:

- **Two deliverables were already satisfied.** The explorer day-fraction slider, day index, and
  day-group select already existed (`ExplorerWorldPanel.svelte:225-247`,
  `ExplorerApp.svelte:79-81`, default `timeOfDay` 0.5), and fog already resolved from a single
  `bracketKeyframes` call shared with the background color — so light and fog could not drift.
  Phase 1 reduced to the lighting facts themselves.
- **`lighting` is no longer nullable.** Retail's `GetLighting` returns fallback values (ambient
  0.3, white, sun `(0.5, 0, 0.8)`) rather than "no lighting" when a region or day group authors no
  keyframes, so the contract now always carries lighting. Exported as
  `UNAUTHORED_SCENE_LIGHTING` and reused for the runtime's `DEFAULT_ENVIRONMENT`, which removes a
  null case from every future consumer instead of propagating it into Phases 2, 3, and 5.
- **Sun vector is stored in render axes, unnormalized.** `renderVector` was added to
  `ac-frame.ts` beside the existing `acFrameTransform`/`renderScale` so the AC→render axis mapping
  (`render = (x, z, -y)`) has exactly one owner. Retail's Z-up sun formula is applied first, then
  converted; brightness stays in the magnitude per the north star. Tests assert a due-north sun
  lands on render −Z and an east/overhead sun on +X/+Y, which pins the convention against future
  axis drift.
- **Ambient floor applied at resolution time**, not at consumption, so no consumer can forget it
  (`MINIMUM_AMBIENT_LEVEL`, exported for tests; no magic numbers in assertions).
- **Deliberately not resolved here**: the outdoor object ambient (`|sun| * 0.2 + ambientLevel`)
  and the interior ambient override. Both are per-draw policy owned by the Phase 3 lighting
  context, not regional facts; putting them in this contract would have meant two layers claiming
  the same decision. `ResolvedSceneLighting`'s doc comment states that boundary.
- Debt: none introduced. `ambientBrightness` (the old, unfloored field name) is gone rather than
  aliased, and the old `backgroundColor`-as-ambient aliasing is replaced by a properly interpolated
  `ambientColor`.

### Phase 2: Terrain lighting

Retail behavior: per-vertex `min(1, ambient + N·L)` with FF lighting off.

Deliverables:

- `webgl2-terrain-program.ts`: consume `aNormal` and new sun/ambient uniforms in the vertex shader;
  evaluate the retail terrain formula per vertex and modulate the composed albedo.
  (Design departure from retail, blessed: shader evaluation instead of CPU bake — identical math,
  free re-ticking. Recorded here so nobody "fixes" it back.)
- Renderer plumbing: lighting uniforms bound from the frame environment.

Acceptance criteria:

- Terrain shading visibly responds to the time-of-day slider (dawn/dusk sun angle and color).
- Terrain slopes facing the sun are brighter than back slopes; night scenes floor at ambient.
- Existing terrain tests pass; GLSL validation covers the shared lighting block.

Tasks:

- [x] Add lighting uniforms to the terrain program and bind from frame input.
- [x] Evaluate the retail terrain formula on `aNormal`.
- [x] ~~Sample and apply composition-table variation row~~ — dropped; proven dead in retail.
- [x] Verify terrain normal generation against retail's accumulation (degenerate → up-vector).

Progress: Complete (2026-08-03). `npm run check`, `npm run lint`, `npm run check:terrain-shader`,
571 frontend tests, and browser-harness renders at three day fractions are all green.

Decisions and course corrections:

- **Terrain vertex color variation is dead data in retail — sub-task dropped.** A decompile sweep
  enumerated every consumer of a `TerrainTex*` (allocation at acclient.c:294827; accessors
  `GetDetailTiling` 293090, `GetTerrainTex` 293995, `GetSubDataIDs` 294298, `GetTerrain` 294403+,
  `CopyAndTile` 293773, `Merge` 293948, `InitEnd` 293737): the six min/max vertex
  brightness/saturation/hue fields at struct offsets 16–36 are read **only** by
  `TerrainTex::Pack` (294081-294111) and written **only** by `TerrainTex::UnPack` (294167-294197).
  There is no HSV code anywhere in the binary, and `CLandBlockStruct` has exactly one per-vertex
  color array (`vertex_lighting`), written solely by `calc_lighting` and consumed at
  acclient.c:684395 as the D3D vertex diffuse. Implementing the variation would have made us
  diverge from retail, not match it. Supporting evidence that the feature was cut pre-EoR:
  `min_slope` at offset 8 is likewise never read and is not even serialized, and
  `TMTerrainDesc::UnPack` (294811) unpacks exactly one `TerrainTex` into what is declared as a
  `SmartArray`, with every accessor hardcoding index 0.
  - Debt created: `composition-table.ts` still packs those six values into GPU table row 1 and
    row 0's z/w, which no shader reads. Retained for the Phase 7 cleanup target list. Parsing and
    decoding them remains correct (lossless DAT round-trip); only the GPU packing is dead.
- **Fog and lighting now travel together as one `SceneShading` parameter.** Fog was threaded
  through seven renderer method signatures; adding lighting beside it would have meant threading
  twice, since Phase 3 must vary lighting per draw anyway. Introducing the bundle now made this
  one mechanical diff instead of two, and `SceneShading` is exactly the value Phase 3 extends with
  interior/outdoor selection. `#drawBlendedObjects` gained the parameter for the same reason.
- **Shared lighting GLSL lives in `webgl2-lighting.ts`**, mirroring `webgl2-fog.ts`, so terrain and
  the Phase 3 object program compile the identical `evaluateSceneLighting`. Departure from the fog
  precedent: the uniform declarations live inside the shared block rather than being redeclared per
  program, giving the lighting uniform names one owner.
- **Normals are transformed by `mat3(uLocalToLandblock)`** even though terrain currently passes
  identity, so a future non-identity terrain root cannot silently break shading.
- **Lighting modulates the fully composed albedo (base + overlays + roads + detail), then fog
  applies.** Fog-last is certain (raster stage after texturing). Applying lighting after the detail
  blend rather than to the base only is an interpretation of retail's multi-stage setup; both
  layers are surface color, so modulating the combined result is the defensible reading.
- **No hollow binding test written.** `bindWebGL2SceneLighting` is pure uniform forwarding with no
  branching; asserting the calls would restate the implementation. Real coverage comes from the
  resolver unit tests (Phase 1), `check:terrain-shader` GLSL validation, and browser-harness
  renders.
- **Tooling**: `scripts/validate-terrain-shader.mjs` was generalized from a hardcoded fog
  substitution to a map of shared GLSL modules, so future shared blocks validate automatically.
  `browser-harness.mjs` gained `--time-of-day <0..1>`; the harness previously never resolved a
  scene environment at all and rendered with the runtime default, so time-of-day behavior was
  unverifiable there.
- **Runtime evidence**: harness renders at day fractions 0.05, 0.22, and 0.5 show night terrain
  dropping to the authored purple-tinted ambient (0xFFC864FF), dawn dim with warm fog, and noon
  clamping flat ground to full brightness while sloped terrain shades — matching retail's
  `min(c, 1.0)` clamp. Buildings correctly remain unlit pending Phase 3.

### Phase 3: Object lighting and per-draw lighting context

Retail behavior: FF equation on meshes; per-pass sun toggle; outdoor object ambient formula;
`luminosity` as emissive.

Deliverables:

- Zero-normals policy (resolved by Phase 0): preserve authored zeros and replicate retail's
  software semantics — sun term zeroes out via `max(0, N·L)`, no face-normal derivation. Update
  `static-object-geometry-worker.test.ts:120`'s rationale comment only; behavior stands.
- `webgl2-object-program.ts`: always-on lighting — transform normals (baked and instanced transform
  variants), evaluate `emissive + ambient + diffuse·sunColor·max(0, N·L)`. Neutral uniforms
  reproduce today's unlit output exactly.
- Per-draw-unit lighting context in the frame contract: replace the single frame-global environment
  assumption with lighting state resolvable per render-graph node, so portal-visible interiors draw
  sun-off while the outdoor pass draws sun-on. Outdoor context uses
  `|sunlight| * 0.2 + ambient_level` for objects.
- Program variant count stays at four (fog × transform source).

Acceptance criteria:

- Buildings and statics respond to the slider consistently with terrain (same sun, same ambient).
- Draws carry per-contribution lighting roles; unit tests cover outdoor vs interior selection.
- Zero-normal decision recorded with decompile evidence; worker test updated, not deleted-and-lost.

Tasks:

- [x] Zero-normals investigation and policy decision.
- [x] Normal transform + lighting in both object vertex variants.
- [x] Lighting context type on draw units / render-graph nodes; renderer binds per draw.
- [x] ~~Neutral-uniform regression fixture~~ — dropped; see the luminosity decision below.

Progress: Complete (2026-08-03). `npm run check`, `npm run lint`, `check:terrain-shader`,
577 frontend tests, and browser-harness renders (outdoor day/night, plus an EnvCell-bearing
neighborhood) are green.

Decisions and course corrections:

- **Luminosity became multiplicative, which retires the byte-identical acceptance criterion.**
  The unlit-era shader did `albedo + luminosity`. Retail's fixed-function pipeline builds one
  clamped vertex color from `emissive + ambient + Σ diffuse·light·max(0, N·L)` and then modulates
  the texture by it (`CMaterial::SetLuminositySimple` sets `Emissive.rgb`, acclient.c:345688), so
  the faithful form is `albedo * min(lighting + luminosity, 1)`. These cannot both hold: under
  neutral lighting the multiplicative form yields plain albedo, so a luminous surface would not
  match the old additive output. Retail fidelity wins; the neutral-uniform fixture was dropped
  rather than kept as a test asserting the wrong equation. Non-luminous surfaces under neutral
  lighting are unchanged, which is the property that fixture actually existed to protect.
- **Lighting roles, not a per-node context object.** `ObjectFrameInput.source` already
  distinguishes `outdoor | generated | env-cell-shell | env-cell-resident | dynamic`, which is
  exactly retail's per-pass distinction (`useSunlightSet(1)` outdoors, `(0)` for the cell pass).
  Rather than add a lighting field to draw units or render-graph nodes, `objectLightingRole`
  derives the policy from that existing fact and `SceneShading.lighting` carries one
  `SceneLightingByRole` record built once per frame. Nothing new is plumbed through commit, and
  draw loops stay allocation-free.
- **Terrain and objects use different ambient, per retail.** Terrain reads `ambient_level`
  directly (`calc_lighting`); meshes read the boosted world ambient
  `|sunlight| * 0.2 + ambient_level` (`LScape::calc_object_light`, acclient.c:140248). Both are
  derived once in `resolveSceneLightingByRole`, so no consumer re-derives either.
- **Interior policy is partially delivered, by necessity.** Cell draws now disable the sun (zero
  sun vector — no branch, no second shader), matching retail's cell pass. The _forced_ 0.2-white
  interior ambient depends on the camera cell's `seen_outside`, which exists in
  `holtburger-content` (`interior.rs:244`) but is not serialized to the frontend. That plumbing is
  already Phase 5's first task, so the forced ambient lands there. Recorded so the gap is not
  mistaken for an oversight.
- **Redundant-bind suppression added to the state applicator.** Interior and outdoor contributions
  interleave within a pass, so lighting binds per draw; `applyLightingRole` collapses repeats and
  is reset on program change because uniform state is per program. Measured: 1 bind for an
  outdoor-only neighborhood, 3 when EnvCells are present. New `objectLightingBinds` frame metric
  makes this observable rather than assumed.
- **Zero normals**: `safeNormal` in the shared GLSL returns zero for a zero-length normal instead
  of letting `normalize` produce NaN, which reproduces retail's software behavior (no sun term)
  without inventing data. The worker test keeps its behavior and gains the decompile rationale.
- **Runtime evidence**: buildings now shade with orientation and darken into the authored night
  ambient alongside terrain; the scene reads as one lighting environment rather than lit ground
  under unlit props.

### Phase 4: Resteer

Reassess before the interior phase, which carries the plan's structural risk:

- Dry-run Phase 5 against the codebase as it now exists: per-cell color streams, VAO layout,
  worker outputs, and the content-boundary schema change.
- Confirm the per-draw lighting context from Phase 3 actually carries what Phase 5 needs
  (interior ambient state and cell identity for bake association), or adjust its shape now.
- Review accumulated debt and shader/tuning knobs introduced so far; fold corrections into the
  remaining phases.

Progress: Dry run complete (2026-08-04); **blocked on one design decision** before Phase 5 can
execute.

Findings:

- **`seen_outside` needs no plumbing.** The host already serializes a `cellFlags` u32 section
  (`env_cell_source.rs:173`), the frontend already decodes it into each cell's `flags`
  (`decode-env-cell-record.ts:724`), and `seen_outside` is bit `0x01`. Phase 5's forced interior
  ambient only needs the camera cell's flags at frame time, not a new content field. Phase 5's
  first task shrinks to `LightInfo` alone.
- **Phase 3's lighting roles are sufficient.** Cell draws already select `interior-object`; Phase 5
  swaps in the forced 0.2-white ambient for the camera-inside case. No contract reshaping needed.
- **Shell geometry sharing is far heavier than assumed, which reopens the bake decision.** The host
  deduplicates shell geometry by `(environment_id, local_selector)`
  (`env_cell_source.rs:99-149`), and the frontend does the same by geometry id
  (`env-cell-materialization.ts:142-151`). Census over the full archive: **3,145 distinct shell
  structures serve 734,976 cells — mean reuse 234x, maximum 29,314x.** Retail could bake because
  it constructed one mesh per cell; we deliberately do not.

**Open decision (needs a call before Phase 5):** how interior static lights reach shell and
resident geometry.

- _Option A — per-cell vertex-color bake_ (current plan). Retail's exact mechanism. Requires
  un-sharing shell geometry per cell or adding a per-cell color stream plus a per-cell VAO and
  geometry resource entry, new materialization and resource-manager machinery, and a CPU/GPU
  parity fixture because residents bake on the CPU while the headlamp evaluates in the shader.
- _Option B — per-cell light uniform array_ (the approach dropped pre-execution when interior
  instancing turned out not to exist). Shell and resident geometry both stay shared and unmodified;
  EnvCell draws are already per cell, so each binds its own light array. One evaluation path for
  every light in the plan, which deletes the parity-fixture risk entirely, and no worker,
  materialization, or resource-manager changes. Costs a bounded vertex-stage loop (census: p50 1,
  p99 5, max 26 lights per cell) and is the same shader-instead-of-bake departure already blessed
  for terrain and objects.

Recommendation: Option B. It is strictly less machinery, removes the plan's largest stated risk,
and produces identical per-vertex output. It does reverse the earlier steer that shell geometry
could simply be un-deduplicated, which was made before the 234x sharing factor was measured.

**Decision: Option A — per-cell geometry with baked vertex colors** (2026-08-04). The 234x reuse
figure was misleading on its own: shell structures are tiny. Census over every structure:
**median 10 vertices, p99 58, max 113, 45,320 vertices total across all 3,145 structures.** A
205-cell dungeon landblock therefore duplicates on the order of 3,000 vertices, so per-cell copies
cost nothing meaningful and the retail mechanism is kept intact. Phase 5 proceeds with baking, and
duplicates whole geometries per cell rather than splicing a per-cell color stream onto shared
buffers — at this vertex count the simpler shape wins over the memory-optimal one.

Additional retail semantics confirmed during the resteer, which the bake must honor: retail does
**not** bake with only the owning cell's lights. `CObjCell::add_static_to_global_lights` is called
across `CEnvCell::visible_cell_table` (acclient.c:335800), so the burn-in uses the union of nearby
visible cells' lights transformed into the mesh's frame — which is what makes light spill through
doorways. Our bake gathers all lights in the landblock and lets the authored range
(`falloff * 1.3`) cull them, which is equivalent for static content and needs no visibility query.

### Phase 5: Interior lighting — authored static lights

Retail behavior: Setup `LIGHTINFO` registered to containing cells; static lights burned into cell
mesh vertex colors (half-Lambert, range × 1.3, per-channel clamp); forced 0.2 white interior
ambient with sun off; viewer headlamp.

Deliverables:

- Content plumbing: populate `lights` at both `holtburger-content` construction sites, serialize
  across the Tauri boundary, add the TS decode schema field. Lossless: type, frame, color,
  intensity, falloff, cone angle.
- Light registration: resolve each cell's static light list from its residents' setups (owner
  frame × light offset frame), retail-equivalent to `CPartArray::AddLightsToCell`.
- Shared formula module: one TS implementation of the burn-in evaluation (point lights only —
  Phase 0 proved no other type exists in data; fail loudly on any other `light_type`), with the
  half-Lambert wrap on the unnormalized light vector, range and per-channel clamp rules, consumed
  by the CPU baker and mirrored in GLSL for the headlamp (and, later, dynamic lights), with a
  CPU/GPU parity fixture test evaluated per vertex on both sides. Decide deliberately whether to
  carry retail's black-when-unlit and alpha-clobber quirks (Phase 0 decision log) or document
  divergence.
- Burn-in for ALL interior static geometry — this covers everything: interior residents are merged
  into unique per-cell meshes by `prepareBakedStaticObjectGeometry` (instancing exists only for
  the outdoor Generated layer, `static-object-geometry-worker.ts:161-164`), so resident vertex
  colors bake directly into their per-cell geometry. Cell shells, whose geometry IS shared by
  content identity, get a per-cell vertex color stream alongside the shared position/normal/uv
  buffers.
- No per-cell light uniform arrays. Instanced geometry is exclusively outdoor generated scenery,
  lit by the global sun/ambient uniforms. The only shader-evaluated point light in this plan is
  the viewer headlamp; the Phase 0 cap-32 census result transfers to the deferred dynamic-lights
  work, where a light array first becomes real.
- Interior context: camera-cell `seen_outside` drives forced ambient 0.2 white + sun off through
  the Phase 3 lighting context; portal-visible interior cells get their own cell context.
- Viewer headlamp: single point light uniform at the camera position, tunable falloff/intensity
  mirroring `s_fViewerLight*`, explorer toggle. Retail's free-camera mode attaches the viewer
  light at the camera with zero offset (`SmartBox::set_viewer`, acclient.c:137873); the
  character-anchored `(0,0,2)` offset variant applies only once a moving character/anchor exists
  (deferred with the dynamic-entity work).

Acceptance criteria:

- A known torch-lit dungeon cell renders with warm falloff on shell geometry and matching shading
  on its baked residents (parity fixture green for the shared formula).
- Interiors are dim-but-readable with the headlamp on, flat 0.2 ambient with it off and no
  authored lights present.
- Rust: content tests cover `LightInfo` propagation; `cargo clippy` clean.
- Geometry sharing metrics confirm position/normal/uv dedup is preserved (only color streams
  multiply).

Tasks:

- [ ] `holtburger-content` light population + Tauri serialization + zod schema.
- [ ] Cell static light list resolution from resident setups.
- [ ] Shared burn-in formula module + GLSL mirror + parity fixture.
- [ ] Per-cell color stream for shells; baked vertex colors for per-cell resident meshes.
- [ ] Interior ambient policy + headlamp + explorer toggle.

Decisions and course corrections:

- 2026-08-03 (pre-execution): dropped the per-cell light uniform array deliverable. Verified that
  instancing exists only for the outdoor Generated layer
  (`prepareStaticObjectGeometry` dispatch, `static-object-geometry-worker.ts:161-164`); interior
  residents are always merged per cell and can be baked directly. Outdoor statics are sun-lit
  only, which matches retail (`useSunlightSet(1)` outdoors; `minimize_object_lighting` only ran
  with the sun off). The cap-32 census decision transfers to the deferred dynamic-lights work.

### Phase 6: Time drive and fog parity

Retail behavior: lighting re-resolved on the region's authored light tick (EoR Dereth: 15 s, on a
0.8 s sky tick grid — read from region data, not the code defaults); fog is radial 3D distance.

Deliverables:

- Game-clock day fraction feeding environment resolution on the retail light-tick cadence; the
  Phase 1 slider becomes an override (retail's always-daylight mode generalized), not a parallel
  path.
- Fog distance switched from horizontal XZ to true 3D radial distance in the shared fog GLSL.

Acceptance criteria:

- With the override off, lighting and fog evolve over game time; with it on, behavior matches
  Phase 1.
- Fog-band tests updated for radial distance using runtime constants.

Tasks:

- [ ] Clock → day fraction → environment re-resolution on light ticks.
- [ ] Slider becomes override; single resolution path.
- [ ] Radial fog distance.

Decisions and course corrections: _(fill during execution)_

### Phase 7: Cleanup and wrap-up

- Sweep vocabulary: no surviving symbol, tuning field, or doc should describe the renderer as
  unlit; retire "future terrain/object lighting" placeholder comments in `scene-environment.ts`.
- Delete or rewrite tests that enshrined unlit behavior (including the Phase 3 regression fixture
  if it has become misleading).
- Itemize and burn down debt accumulated in per-phase decision logs.
- Update per-crate architecture docs and the protocol/format docs with the lighting model and the
  retail constants table (this plan's Ground Truth section is the source).
- Confirm deferred-work seams: the dynamic-entity runtime plan can attach entity lights and
  `SetLight`, and a future sky plan can attach to the time source and environment resolution,
  without reshaping the Phase 3/5 contracts; record the intended attachment points.
- Remove or deliberately promote the Phase 0 harness programs.

## Risks & Mitigations

- **CPU bake vs GPU uniform divergence** (Phase 5): same room, two evaluation paths. Mitigation:
  shared formula module + parity fixture (North Star 5); treat fixture failure as a blocker.
- **Per-draw lighting context reshapes the frame contract** (Phase 3): touches the portal render
  graph, historically spicy. Mitigation: land context plumbing with neutral uniforms first
  (byte-identical output), then enable values; resteer phase re-validates before interiors build
  on it.
- **Per-cell color streams inflate interior memory/VAO counts** (Phase 5): mitigated by sharing
  position/normal/uv buffers and duplicating only color; acceptance criteria include a sharing
  metrics check.
- **Zero authored normals** (Phase 3): lighting on garbage normals looks worse than unlit.
  Mitigation: decompile investigation is a blocking task before shader work.
- ~~Uniform array bounds for cell lights~~ — retired: no light uniform arrays remain in this plan
  (interior statics are fully baked; the census cap of 32 transfers to the deferred dynamic-lights
  work).
- **Color-space temptation**: adding sRGB correctness would diverge from retail's gamma-naive
  pipeline. Mitigation: North Star 6; any color-space work is explicitly out of scope.

## Definition of Done

- [ ] All phases complete with per-phase acceptance criteria met.
- [ ] `cargo test`, `cargo clippy` (warnings as errors), frontend unit tests, lint, and formatting
      all clean.
- [ ] Outdoor scenes: terrain, buildings, and statics lit consistently by time-of-day sun and
      ambient; fog synchronized.
- [ ] Interior scenes: authored static lights visible with retail falloff; forced interior ambient;
      headlamp functional.
- [ ] No unlit-era vocabulary or placeholder comments survive.
- [ ] Retail lighting constants and model documented outside this plan (protocol/format docs).
- [ ] Deferred dynamic-light attachment points recorded for the dynamic-entity runtime plan.

## Open Questions

- ~~Uniform array size for per-cell lights~~ — resolved 32 by the Phase 0 census (observed max
  26), then retired from this plan entirely: interior statics bake, so the cap only matters to the
  deferred dynamic-lights work.
- Whether `holtburger-world` should eventually own cell light lists as shared world semantics (a
  future 3D client and the TUI could both consume "which lights affect this cell"); this plan keeps
  resolution in the frontend commit path and flags the promotion decision for the resteer phase.
