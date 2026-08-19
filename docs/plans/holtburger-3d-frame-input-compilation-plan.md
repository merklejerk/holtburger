# Frame-Input Compilation: Rate-Tiered Derived Facts for the Flat Frame Loop

## Context & Boundaries

**Goal:** Remove per-frame recomputation of publication-stable facts from the WebGL2 frame loop so a
static scene's CPU frame cost is dominated by genuinely per-frame work (selection, ordering,
submission).

**The reference pose.** Every timing in this plan comes from one camera pose, so they are
comparable to each other and reproducible. C061 is dense forest — the scene the user reported as
the worst case — viewed from ground level toward the horizon:

```
npm run harness:browser -- --landblock C061FFFF \
  --terrain-radius 8 --building-radius 8 \
  --explicit-object-radius 2 --generated-object-radius 2 \
  --camera-position 37008,46,-18672 --camera-yaw 45 --camera-pitch -2 \
  --viewport-width 1492 --viewport-height 952 \
  --gpu --profile-renderer --settle-ms 45000 --measure-ms 10000 --brief
```

Radii match the Explorer defaults except EnvCells, which C061 has none of — the harness gate for
them cannot be satisfied there. Add `--particle-seed 7 --frame-interval-ms 16.667
--capture-frame 240` for the screenshot-parity variant, and `--cpu-profile <path>` for V8 self
times. Hardware: AMD 7900XT via ANGLE; SwiftShader numbers are not evidence.

**Motivating evidence (2026-08-18, the pose above, V8 CPU profile at 100 µs sampling over 10 s /
3,814 frames):**

- Total renderer CPU ≈ 1.85 ms/frame (explorer-in-Tauri measures ≈ 7.5 ms for the same scene; the
  WebKitGTK/JavaScriptCore multiplier amplifies exactly this allocation-heavy work).
- `objectPreparation` phase ≈ 0.47 ms/frame: `#prepareObjectFrameInput` recompiles geometry
  lookups, draw-range validation, atlas rects, samplers, material constants, and landblock offsets
  for ~1,700 object frame inputs per frame.
- `sceneContributionResolution` ≈ 0.28 ms/frame: per-frame descriptor and node re-resolution.
- `blendedOrdering` ≈ 0.20 ms/frame: `#transparentSortFacts` re-transforms 1,380 static instance
  centers through `transformPoint3` every frame.
- Terrain program resolution (`resolveGeometry`/`resolveTexture2D`/`resolveTextureArray` for ~98
  terrain inputs) re-runs per frame.
- GC ≈ 234 ms over the 10 s window, driven by ~1,700 `{...object, compatibility: {...}}`
  allocations per frame.

**In scope:**

- Static-object draw units and frame-streamed transparent templates (outdoor layers and env-cell
  residents), env-cell shells, and terrain frame inputs.
- Bake-time landblock-space transparent sort centers and lazy near-only `cameraDepth`.
- The invalidation contract for renderer-owned compiled state.

**Out of scope:**

- Dynamic-entity placement math (`#sceneOriginOf`/`#resolvePlacement`) — genuinely
  animation-variant; revisit at the resteering phase with numbers. (Per-part _material_
  compilation for dynamics is in scope: it shares the compiled store; see Decisions.)
- Particle system cost (~0.4 ms/frame) — separate investigation.
- The portal (env-cell interior) view path beyond keeping it compiling and correct.
- GPU-side costs; canopy triangle load (tracked separately as the future-client LOD flag).
- The Tauri WebView engine choice.

## Ground Truth

- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts` — `#collectScene`,
  `#resolveSceneContributions`, `#prepareObjectFrameInput`, `#prepareObjectAtlasBinding`,
  `#prepareObjectTextureBinding`, `#transparentSortFacts`, `#createObjectSubmissionPhases`.
- `apps/holtburger-3d/src/lib/game/renderer/render-world.ts` — node/descriptor resolution ports.
- `apps/holtburger-3d/src/lib/game/commit/artifacts.ts` — `StaticObjectDrawUnit`,
  `FrameStreamedObjectInstanceTemplate`, `EnvCellDrawUnit` `transparentSort` contracts.
- `apps/holtburger-3d/src/lib/game/commit/static-object-geometry-worker.ts` — bake-time owner of
  per-draw facts.
- `apps/holtburger-3d/src/lib/game/textures/atlas/resident-texture-atlas.ts` — placement mobility:
  the stable planner never moves a retained placement, but compaction plans do move placements, so
  cached atlas rects require an invalidation source.
- `apps/holtburger-3d/src/lib/game/systems/terrain-system.ts` — `getDrawUnit` and terrain resource
  keys.
- Existing lifecycle precedent: static layers already publish/evict through
  `StaticLayerRealizer`/`SceneInterestCommitCoordinator`; compiled state must ride those events,
  not introduce new ones.

## North Stars

1. Every derived fact is computed at the rate tier that owns it: bake time → publication time →
   rare frontend events → frame time. The frame loop touches only camera-variant facts.
2. Invalidation rides existing lifecycle events (node removal, atlas publication, settings
   changes). No dirty flags polled per frame, no timers, no reference-equality guessing.
3. Anchor-relativity is a per-landblock frame fact, never a cached fact. Cached spatial facts
   live in landblock space — the bake artifact's native frame — so re-anchoring invalidates
   nothing and no second coordinate convention (world space) enters the renderer.
4. Rendering output is bit-identical: this plan moves computation, it does not change what is
   drawn or its order. Verified by screenshot parity on one reference scenario (the C061 ground
   pose); other scenes are covered by run/draw-count metrics.
5. Failure stays loud: a compiled entry that cannot be produced (missing texture, invalid range)
   fails at publication, where today's code fails per frame.
6. Measure with the established harness methodology: medians over repeated runs, real GPU,
   like-for-like poses; publication counts reported with timings.

## Phased Implementation

### Phase 1: Landblock-space transparent sort centers at bake time

Transparent classification, not sorting, is the measured cost: at the C061 baseline all 1,380
candidates were far (near count 0), yet each paid two `transformPoint3` calls, a coordinate
parse, and an allocation per frame just to be classified. The bake already merges geometry in
landblock space — the artifact's native frame — so sort centers belong there too: the static
local→landblock transform is applied once at bake, and the per-frame path becomes
`center + landblockOffset − camera` using the same per-landblock offset map Phase 2 introduces.
Runtime coordinates stay inside the anchored-window convention throughout.

`cameraDepth` is consumed only by the near sort, so it is computed lazily for near-classified
candidates only; far candidates pay a subtraction and three multiplies.

**Deliverables:**

- `commit/artifacts.ts`: `transparentSort.center` semantics change from source-local to landblock
  space on `StaticObjectDrawUnit`, `FrameStreamedObjectInstanceTemplate`, and `EnvCellDrawUnit`.
  Update doc comments to name the space.
- `commit/static-object-geometry-worker.ts`: apply the local→landblock transform to centers at
  bake. Env-cell shells compute centers in `runtime/env-cell-realization.ts` instead — their
  placement transform is in hand there, and realization is the shells' owning one-time tier
  (verified; see Decisions). Contract comments name the tier per producer.
- `webgl2-renderer.ts` `#transparentSortFacts`: drop per-instance transforms; classify from
  landblock-space center + per-landblock offset. Restructure `orderTransparentObjectRanges`
  inputs so `cameraDepth` is derived only for near candidates (one transform each, bounded by
  the near population), and remove the per-candidate spread allocation.
- Tests: worker suite pins landblock-space centers; renderer ordering tests updated. Delete any
  test asserting source-local centers. Before deleting the old computation, pin the new near-path
  `cameraDepth` equality against it in a unit test over representative transforms.

**Acceptance criteria:**

- Transparency draw order unchanged: screenshot parity on the C061 ground pose; run/draw-count
  metrics unchanged on a pose with a non-empty near population so the lazy path is exercised.
- `blendedOrdering` phase mean measurably reduced at the C061 ground pose.

**Task checklist:**

- [x] Worker emits landblock-space centers for baked ranges and templates
- [x] Env-cell shell bake emits landblock-space centers
- [x] `cameraDepth` equivalence pinned in a test before the old path is deleted
- [x] Classification consumes cached centers; `cameraDepth` computed for near candidates only
- [x] Per-candidate spread allocation removed from the classification loop
- [x] Contract comments and tests updated

### Phase 2: Publication-tier compiled object frame inputs

Compile the per-draw constants (`compatibility`, prepared material, geometry binding, validated
range, blend policy) once per static draw unit / template / shell draw, owned by the renderer and
keyed by node identity. The frame loop assembles submissions from compiled entries plus two
per-frame facts: the per-landblock anchor offset map and the sort ordering from Phase 1.

**Deliverables:**

- A renderer-owned compiled-input store (new module colocated with `webgl2-renderer.ts`),
  keyed by draw-unit identity (statics' renderables and dynamics' active draw units are both
  reference-stable per publication/appearance):
  - Entries created on first visibility (lazy) or eagerly at installation — see Open Questions;
    decide during implementation with flight evidence.
  - Static entries dropped on node removal (existing static/env-cell lifecycle events); dynamic
    entries die with their draw-unit references when visual preparation replaces an appearance.
  - Dynamics share the store (see Decisions). The effect-translucency ordering override
    (translucency ramps, `effect-system.ts`) clones its draw unit per frame, so the store keys on
    the underlying stable draw unit and holds two compiled slots — natural ordering and the
    transparent override — because ramps can settle at a steady nonzero value (permanently
    ghostly creatures), which would otherwise recompile every frame forever.
  - Flushed by: atlas publication events that can move placements, texture-filtering policy
    change, active-region static-detail change, `envCellRenderMode` change (shell cull-face
    override). Each flush source is a named, tested entry point.
- `#resolveSceneContributions`/`#prepareObjectFrameInput` split: the per-frame path reads compiled
  entries; compilation code moves out of the frame loop wholesale (no dual path retained).
- Per-frame landblock offset map computed once per view from visible landblocks.
- Preserved diagnostics: `objectPreparation` phase continues to measure the (now small) assembly
  cost; compiled-store size and flush counts added to renderer diagnostics.

**Acceptance criteria:**

- `svelte-check`, unit suites, lint, knip clean.
- Screenshot parity on the C061 ground pose; filtering-cycle, AO-cycle, and portal harness
  scenarios still pass.
- C061 ground pose: `objectPreparation` + `sceneContributionResolution` combined mean reduced by
  ≥ 60 %; GC time over a 10 s window materially reduced.
- An atlas-churn scenario (relocation sequence forcing atlas growth/compaction) renders without
  stale rects.

**Task checklist:**

- [x] Compiled-input store with named flush sources and tests
- [x] Frame loop consumes compiled entries; compilation removed from the per-frame path
- [x] Per-landblock offset map replaces per-object offset computation
- [x] Diagnostics for store size/flushes wired into the frame panel
- [x] Harness A/B recorded in Decisions

### Phase 3: Terrain frame-input compilation

Apply the same tier split to terrain: resolve `TerrainFrameInput.program` (geometry + texture
bindings) at publication, keep per-frame work to frustum selection and appending.

**Deliverables:**

- Terrain prepared-program cache keyed by node, dropped on terrain layer republication/eviction.
  Census result (see Decisions): texture arrays are immutable per key, so layer lifecycle is the
  only flush source — no texture-event wiring.
- `TerrainDrawUnit` built once at realization instead of allocated fresh in `getDrawUnit` per
  node per frame (its fields all derive from the installation).
- `#resolveSceneContributions` terrain arm reads cached programs.

**Acceptance criteria:**

- Terrain rendering unchanged (C061 ground pose parity); `sceneContributionResolution` mean
  drops further at radius-8 poses.

**Task checklist:**

- [x] Census of terrain resource keys and their mutation events recorded in Decisions
- [x] Terrain program cache with lifecycle-driven invalidation
- [x] `TerrainDrawUnit` allocation moved to realization
- [x] Frame loop reads cached terrain programs

### Phase 4: Re-measure & resteer

- Re-run the C061 ground pose and a C061→C661 follow-flight (medians of 5) on the real GPU;
  record CPU phase means, GC, worst frames, and publication counts against the Phase 0 baseline
  in Decisions.
- Ask the user for an explorer-in-Tauri spot check of the same pose.
- Decide with numbers whether the deferred items (particle advance cost, dynamic placement
  math) are promoted to work or closed.
- Dry-run the cleanup phase.

**Task checklist:**

- [x] A/B tables recorded in Decisions
- [x] Parked items decided with numbers

### Phase 5: Cleanup

- Delete vestigial per-frame compilation helpers, dead exports, and stale comments; sweep
  vocabulary of the old model (any "prepare" naming that now means "assemble").
- Verify every guarantee of the deleted per-frame path against its named replacement:
  - per-frame atlas-rect freshness → atlas-event flush
  - per-frame sampler policy pickup → filtering-change flush
  - per-frame detail binding pickup → region-detail flush
  - per-frame cull-face override pickup → `envCellRenderMode` flush
  - per-frame draw-range validation → publication-time validation

**Task checklist:**

- [x] Vestigial code and naming swept
- [x] Guarantee/replacement census verified and recorded in Decisions

## Risks & Mitigations

- **Stale atlas rects after compaction** (visual corruption): single flush entry point fed by the
  atlas publication event; atlas-churn scenario in Phase 2 acceptance.
- **Missed invalidation source** (a settings path picked up "for free" today by per-frame
  recompute): the guarantee census in Phase 5 is written down _now_ (see Phase 5 deliverables) and
  each flush source gets a focused test in Phase 2.
- **Memory growth of the compiled store**: bounded by resident node count (~340 owners at
  radius 8); store size surfaced in diagnostics so leaks are visible in the existing leak-check
  workflow.
- **`cameraDepth` numeric drift or near/far misclassification from the landblock-space
  derivation** (Phase 1): pinned by test before the old computation is deleted; acceptance
  includes a pose with a non-empty near population so the lazy path is exercised.
- **Portal path regressions**: the portal view shares `#prepareObjectFrameInput` consumers; keep
  the compiled store view-agnostic and run the portal harness scenario in Phase 2 acceptance.

## Definition of Done

- [x] All phases complete; checklists ticked.
- [x] `svelte-check` (437 files, 0 errors), 1,165 unit tests, lint, knip, prettier all clean.
- [x] Screenshot parity on the C061 ground pose (0.046 %, under the 0.082 % same-code noise
      floor); portal, filtering-cycle, AO-cycle and atlas-churn scenarios pass by metrics.
- [~] **Partially met.** C061 ground pose renderer CPU mean 1.845 → 1.163 ms, a **37 %** median
  reduction over five runs; repeated sample sets ranged 33–41 %, so the ≥ 40 % target is
  within run-to-run variance rather than reliably cleared. See Phase 4 for why the remainder
  is out of this plan's scope. No follow-flight worst-frame regression: longest render
  13.7 → 9.4 ms at identical workload (162 publications / 6 crossings).
- [x] No new `any`, no swallowed errors, no per-frame allocation of compiled shapes.

## Open Questions

- Lazy-on-first-visibility vs. eager-at-installation compilation: eager front-loads cost into the
  publication stall budget (already under scrutiny from the worker-queue debt); lazy smears it
  across the first frames after a crossing. Decide in Phase 2 with flight evidence.

## Decisions and Course Corrections

- **Env-cell shell centers computed at realization (2026-08-18, resolved pre-implementation):**
  Shell draw units are assembled in `runtime/env-cell-realization.ts` with `shell.placement`
  available, so landblock-space centers are a one-time computation at that site; the geometry
  worker is not involved for shells.
- **Terrain resource census (2026-08-18, resolved pre-implementation):** All `TerrainDrawUnit`
  fields derive from the realized installation; `TextureManager.#createTextureArray` early-returns
  on an existing key, so texture arrays are immutable per key for their lifetime. The terrain
  program cache therefore has exactly one flush source: terrain layer realization/eviction.
  `getDrawUnit` today also allocates the draw unit fresh per node per frame; Phase 3 moves that
  to realization.
- **Dynamics share the compiled store (2026-08-18, resolved pre-implementation):** Evidence:
  (a) the C061 ground pose compiles 1,620 static vs 174 dynamic inputs per frame (~10 % of the
  count); (b) `getVisibleContributions` returns reference-stable `ActiveDynamicDrawUnit.drawUnit`
  objects whose replacement rides the visual-preparation (appearance-change) event — identity and
  invalidation both exist already; (c) the compiled output shape is identical to statics', so a
  separate compile path would duplicate it. The effect-translucency ordering override
  (translucency ramps, `effect-system.ts:238`, sampled into `PartRenderState.translucency`)
  clones its draw unit per frame; since ramps can settle at steady nonzero values (permanently
  translucent creatures), the store keys on the underlying stable draw unit with one compiled
  slot per ordering variant rather than treating the override as a transient cache miss. Store
  keying is draw-unit identity for both populations.

- **Phase 1 landed (2026-08-19).** Centers are landblock space at every producer, and the
  contract is now compiler-enforced: `transparentSort.center` is typed `LandblockVec3` (the
  existing zero-cost brand) on all three artifact contracts and on
  `VisibleRigidPartContribution`, so a producer cannot publish an untransformed center. The brand
  immediately caught the worker's structured-clone rehydration boundary, which now restores the
  frame explicitly through one `hydrateLandblockVec3` helper (it also collapsed a duplicated
  rehydration literal).

  **Producer tiers, one per rate:** baked ranges were already landblock space (merged geometry is,
  and `StaticObjectArtifact.placement.localTransform` is identity) — the renderer had been
  multiplying them by identity every frame; static templates apply `instance.sourceToLandblock`
  once at bake; env-cell shells apply `structureToLandblock` once at realization; dynamics apply
  their animated pose per frame **at the producer** (`getVisibleContributions`), because that
  transform is genuinely animation-variant. Moving the dynamic transform to its producer rather
  than keeping a renderer branch is what makes the invariant uniform: every center reaching the
  renderer is in one frame, and the renderer transforms nothing.

  **Lazy near depth:** `TransparentObjectSortFacts` lost `cameraDepth`;
  `orderTransparentObjectRanges` takes a depth callback invoked only for near candidates and
  reports `cameraDepthEvaluationCount`. `createObjectSubmissionPhases` now takes a range producer
  that returns the complete `TransparentObjectRange`, so classification allocates once per
  candidate instead of twice.

  **Evidence.** C061 ground pose, medians of 3, real GPU: `blendedOrdering` 0.200 → 0.157 ms;
  renderer CPU total 1.845 → 1.730 ms. DA55 candle pose A/B: `blendedOrdering` 0.058 → 0.010 ms
  with identical counts (201 candidates, 2 draws, 84 static draws). Transparency structure
  unchanged at C061 (1,380 candidates, 11 draws/runs, 251 static draws, 501,533 triangles).

  **Parity.** Frozen-time captures (`--particle-seed 7 --frame-interval-ms 16.667
--capture-frame 240`) differ pre→post by 0.067 % of pixels, which is _below the same-code noise
  floor_ measured by capturing the identical build twice (0.082 %). The residual is the known
  non-byte-identical capture behavior, not an ordering change.

  **Near path proven, not assumed.** No production pose reached the near phase — C061 and DA55
  both classify 100 % far, because transparent centers (tree crowns, building glass) sit beyond
  the 16-unit radius. Rather than ship the lazy path unexercised, the near radius was temporarily
  raised to 2000 so all 1,380 C061 candidates took the exact-depth path: pre and post both
  produced 1,380 near candidates and 633 draws/runs, with a 0.024 % screenshot difference (again
  under the noise floor). Tuning was restored to 16 afterward. Unit tests additionally pin that
  depth is derived for near candidates only, and reject a non-finite derived depth.

  **Debt/notes:** the near phase being empty in all sampled production content means its cost is
  currently theoretical; the forced-near run shows `blendedOrdering` at 0.33–0.38 ms when every
  candidate orders exactly, so the far/near split is load-bearing for this scene type.

- **Phase 3 landed (2026-08-19), with one regression caught by its own metrics.**
  `TerrainDrawUnit` is now assembled once when a landblock realizes, and the renderer resolves its
  program once against that now-stable object through a `WeakMap` — no flush wiring, because the
  census held: terrain resources are immutable per key, so an entry simply dies with the
  installation.

  The first attempt also folded the residency check into realization, caching `drawUnit | null`.
  That was wrong and the harness said so immediately: `terrainFrameInputs` fell from 98 to **0** —
  terrain stopped rendering entirely. `#hasDrawUnit` is not invariant; the shared region texture
  arrays a draw unit names can still be preparing when the landblock realizes and become resident
  later, so the old per-frame check was silently self-healing. Fixed by keeping residency a
  per-frame question while caching the object, then narrowed further: because residency only ever
  goes pending → satisfied within one installation, the check now latches on first success
  (`#residentDrawUnits`), which the profile had shown costing 207 ms/10 s.

  Recorded as a caution: this is exactly the hazard the plan named for atlas rects, and it landed
  in terrain instead. A cached value is only as valid as the _invariance_ of the condition that
  produced it, and "resources are resident" was a condition that changed after publication.

  Evidence: `terrainSubmission` 0.118 → 0.078 ms, `sceneContributionResolution` 0.275 → 0.205 ms,
  terrain inputs back at 98.

- **Phase 4 (2026-08-19) — final measurement and parked-item decisions.**

  C061 ground pose, medians of five runs, real GPU, against the Phase 0 baseline:

  | phase                       | baseline | final | delta         |
  | --------------------------- | -------- | ----- | ------------- |
  | renderer CPU total          | 1.845    | 1.163 | −37 %         |
  | objectPreparation           | 0.470    | —     | phase deleted |
  | sceneContributionResolution | 0.275    | 0.205 | −25 %         |
  | blendedOrdering             | 0.200    | 0.132 | −34 %         |
  | terrainSubmission           | 0.118    | 0.078 | −34 %         |
  | sceneQuery                  | 0.140    | 0.108 | −23 %         |
  | opaqueSubmission            | 0.237    | 0.222 | −6 %          |
  | instanceRunPreparation      | 0.187    | 0.203 | +9 %          |

  Measured frame work 2.52 → 1.84 ms; worst frame 6.4 → 6.3 ms; GC 234 → 178 ms/10 s. Draw
  structure is byte-for-byte the same workload: 98 terrain inputs, 251 static draws, 501,533
  triangles, 1,380 transparent candidates, 11 transparent draws, 44 dynamic draws. Follow-flight
  C061→C661: identical 162 publications / 6 crossings, average frame work 2.8 → 1.9 ms, longest
  render 13.7 → 9.4 ms.

  **`instanceRunPreparation` is the one bucket that did not improve**, and chasing it produced a
  finding worth keeping: it first measured +31 %, and neither dereference depth nor the offset
  comparison explained it. The cause was object _shape_ — submissions were being built by two
  different spread sites, so the run-formation loop that reads them for every adjacent pair went
  polymorphic. Routing every producer through one `createObjectSubmission` constructor with a
  fixed field order recovered most of it (+31 % → +9 %). The residual is attributed to locality:
  cached submissions are scattered across publications, where per-frame ones were contiguous in
  the young generation. That is an inherent cost of caching and is dwarfed by what caching removed.

  **Parked items decided with numbers** (self time per 10 s window, ≈ per frame):
  - **Particles — promoted to a named follow-up.** `advance` + `collectCohorts` + related now total
    ≈ 1,630 ms/10 s (≈ 0.43 ms/frame), making particles the single largest CPU consumer in the
    frame and larger than everything this plan touched. Out of scope here by design; it needs its
    own investigation, not a cache.
  - **Dynamic placement math — promoted to a named follow-up.** `#resolvePlacement` (508) +
    `multiplyMat4` (447) + `#sceneOriginOf` (417) ≈ 1,370 ms/10 s (≈ 0.36 ms/frame) for 36 entities
    and 174 parts. Genuinely animation-variant, so it cannot be cached the way statics were, but
    the per-part cost is high enough to deserve its own look.
  - **Run formation** (`formAdjacent` + `formGrouped` + `createObjectSubmissionPhases` ≈
    1,330 ms/10 s) is now the largest remaining renderer-owned cost and the natural next target.
  - **Atlas flush coarseness — kept, not refined.** The 4-hop churn run showed 251 flushes and
    116,462 compilations against 1,259 live entries. It is correct and invisible in steady state,
    and refining it means teaching the publication event to distinguish moved placements and
    rebuilt page resources from in-place patches. Left as recorded debt rather than done blind.

  **Explorer-in-Tauri spot check is outstanding** — that measurement belongs to the user; the
  harness cannot produce it. Expect a larger relative gain there than the V8 numbers show, because
  the deleted work was allocation- and property-access-heavy, which is where JavaScriptCore lags.

- **Phase 5 (2026-08-19) — cleanup and guarantee census.** Vocabulary swept: `#prepareStaticSubmission`
  → `#compileStaticSubmission`, and the `objectPreparation` **CPU phase was deleted end to end**
  (profiler enum, totals, renderer contract, Explorer panel row, test) because its work no longer
  exists and it would have reported a permanent 0.00 ms — a metric that looks like a measurement
  but is only a leftover. Its contribution _counts_ survive, since those still describe real work.
  Dead `vector3Equals` removed with the offset it compared; the duplicated
  `CompiledObjectDrawDiagnostics` collapsed onto the renderer contract.

  Every guarantee the deleted per-frame path provided, with its replacement:

  | guarantee                     | replacement                                    | verified by                                  |
  | ----------------------------- | ---------------------------------------------- | -------------------------------------------- |
  | fresh atlas rects             | `atlas-publication` flush from the layout swap | 4-hop churn run, 251 flushes, no stale rects |
  | sampler policy pickup         | `texture-filtering` flush                      | filtering cycle: 5 flushes for 5 changes     |
  | region detail pickup          | `region-static-detail` flush from the runtime  | fires once at region load                    |
  | shell cull-face pickup        | `env-cell-render-mode` flush + cache variant   | mode cycle: 4 flushes for 4 changes          |
  | draw-range validation         | performed at compile time                      | unchanged `validateDrawRange` call           |
  | terrain resource residency    | per-frame check, latched on first success      | terrain inputs back at 98                    |
  | entry lifetime vs publication | `WeakMap` keyed by the artifact objects        | store diagnostics in panel and harness       |

- **Phase 2 landed (2026-08-19).** `renderer/compiled-object-draws.ts` holds compiled state in
  `WeakMap`s keyed by the artifact draw units, templates, and renderables themselves. That choice
  removed the eviction wiring the plan budgeted for: an entry becomes collectable exactly when its
  publication does, so node removal, layer replacement, and appearance changes need no lifecycle
  hooks and cannot leak. Whole-store `flush(reason)` covers the four events that invalidate
  everything at once.

  **Two cached granularities, chosen from measurement rather than up front.** The first
  implementation cached per draw unit and reached only a 37 % reduction; its V8 profile showed the
  remaining cost was no longer compilation but the per-object cache lookup (297 ms/10 s) and the
  per-object spread that attached it (223 ms/10 s). Since every fact a _static_ submission carries
  except the anchor offset is fixed for the publication's lifetime, statics are now cached as a
  whole submission set per publication (`resolveNodeSubmissions`): a visible node costs one lookup
  and an array append per frame, and its submission objects are reused by reference — zero
  allocation. Dynamics keep per-draw compiled facts (`resolveDraw`) because their instance
  transforms are resampled every frame.

  **Anchor-relativity left the submission entirely.** `landblockOffset` was removed from
  `PreparedStaticObjectDrawCompatibility` and from the submission; the frame carries one offset per
  visible landblock and the draw path looks it up by `landblockId`. This is what makes a cached
  static submission survive re-anchoring, and it simplified run compatibility: comparing
  `landblockId` is an exact substitute for comparing offset components within a frame.

  **A per-frame clone deleted.** `getVisibleContributions` used to clone a dynamic draw unit to
  carry an effect-overridden ordering. The effective ordering now travels beside the stable draw
  unit on `VisibleRigidPartContribution`, which both removes the allocation and gives the store a
  stable key; the promoted ordering occupies its own variant slot.

  **Evidence.** C061 ground pose, medians of 3, real GPU: `objectPreparation` +
  `sceneContributionResolution` 0.745 → 0.228 ms (**−69 %**, target was ≥ 60 %); renderer CPU total
  1.845 → 1.230 ms (−33 %); measured frame work 2.52 → 1.82 ms; GC 234 → 172 ms/10 s. Draw
  structure is unchanged: 251 static draws, 501,533 triangles, 1,380 transparent candidates, 11
  transparent draws/runs, 44 dynamic draws. Frozen-time screenshot parity 0.046 %, below the
  0.082 % same-code noise floor.

  **Flush sources verified live, not just in unit tests:** filtering cycle fired exactly 5 flushes
  for 5 changes; the flat/portal mode cycle fired exactly 4; region static detail fired once at
  region load; a 4-hop relocation sequence fired 251 atlas-publication flushes and rendered
  correctly with no stale rects. Env-cell shells (168 shells / 421 shell draws / 157 resident
  draws) and the portal mode path both still render.

  **Open question resolved: lazy.** Submissions compile on first sight rather than at installation.
  Flight and relocation runs showed no first-sight cost above noise, and lazy keeps compilation out
  of the publication stall window that the worker-queue debt already pressures.

  **Debt recorded — atlas flushes are coarse.** Every atlas publication drops the whole store. In
  the 4-hop churn run that meant 251 flushes and 116,462 compilations against a live population of
  1,259 entries. It is correct (compaction can move any placement, and a rebuilt page invalidates
  cached texture handles) but pessimistic: a stable publication that only patches regions in place
  moves nothing and rebuilds no resource. Refining the event to carry whether placements moved or
  resources were rebuilt is a named follow-up, evaluated with numbers in Phase 4.

- **Phase 0 baseline (2026-08-18):** C061 ground pose — renderer CPU mean 1.845 ms
  (objectPreparation 0.470, sceneContributionResolution 0.275, opaqueSubmission 0.237,
  blendedOrdering 0.200, instanceRunPreparation 0.187, sceneQuery 0.140, terrainSubmission 0.118);
  GC 234 ms/10 s; ~1,700 object frame inputs; ~1,380 transparent candidates; 251 baked draws.
  Follow-flight C061→C661 reference: 162 publications / 6 crossings. Explorer-in-Tauri reference
  ≈ 7.5 ms update+draw at the same pose (user report).
