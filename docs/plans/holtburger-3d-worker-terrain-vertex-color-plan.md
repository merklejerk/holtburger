# Holtburger 3D Worker Terrain and Far Vertex-Color Plan

Status: complete — all six phases implemented and verified
Created: 2026-08-20
Related:

- `docs/plans/holtburger-3d-terrain-draw-state-reduction-plan.md`
- `docs/plans/holtburger-3d-shader-composited-terrain-plan.md`
- `docs/plans/holtburger-3d-terrain-loading-pipeline-plan.md`

## Goal

Move landblock terrain generation completely off the runtime thread and replace the distant
winner-take-all textured stand-in with a contiguous, sampler-free far-terrain pass whose vertex
colors come from one immutable active-region terrain palette.

## Context

Terrain currently has two independent asynchronous products:

- `InlineTerrainGenerator` synchronously builds one 9x9 mesh and one 8x8 pcode field when a
  landblock installs. Its `Promise` return type is only an executor seam; the computation still runs
  on the runtime thread.
- `TextureManager.retain` independently prepares and uploads the active region's terrain textures.
  Terrain draw units are withheld until geometry and all texture resources are resident.

The distant path does less fragment work than full composition, but it still uses the full terrain
program. One dominant terrain code per landblock selects a color-texture array layer, whose smallest
mip supplies one color for the entire mesh. Distant landblocks are already submitted contiguously,
but the pass retains sampler, composition-table, UV, and dominant-code dependencies it does not
need.

The target keeps geometry and texture materialization independent:

```text
dedicated terrain worker             active-region texture preparation
  positions                            GPU terrain texture resources
  normals                              immutable 32-color terrain palette
  texture coordinates
  terrain color code per vertex
  indices
  pcode field
              \                       /
               renderer joins at draw time
```

The mesh stores authored terrain codes, not resolved RGB values. Geometry can therefore complete,
be published, and remain valid before the region palette is resident. The far vertex shader resolves
each code through the shared palette and lets normal triangle interpolation blend the resulting
colors.

## Scope

### In Scope

- One dedicated browser worker for terrain generation, implemented with the existing closed-worker
  infrastructure.
- Exactly one deterministic `generateTerrain` kernel shared by direct unit tests and the worker
  entry point; no second generation algorithm or production inline fallback.
- Retained runtime terrain inputs remain usable after dispatch; worker transport must not detach
  their buffers.
- One integer terrain-color code per authored terrain vertex.
- One complete, immutable 32-entry average-color palette per active-region terrain presentation.
- Average-color derivation from the exact normalized RGBA8 pixels already prepared for each terrain
  color texture, without a second asset load or GPU readback.
- A dedicated sampler-free far-terrain WebGL2 program and a contiguous far-terrain state group.
- Removal of the dominant-terrain-code mechanism and all surviving production vocabulary for the
  superseded flat/solid representation.
- Worker queue/execution diagnostics and repeatable browser-harness streaming and rendering
  evidence.

### Out of Scope

- Merging landblocks, instancing terrain, `WEBGL_multi_draw`, or reducing terrain to one draw call.
  Each landblock keeps its independent geometry, culling, materialization, and eviction lifetime.
- Reintroducing retail mesh strides or otherwise decimating the authored 9x9 terrain mesh.
- Changing near-terrain pcode composition, alpha-mask selection, roads, landscape detail, point
  lights, fog policy, scene interest, or the far-terrain cutoff policy.
- Software-evaluating terrain blend masks or road masks while generating far vertex colors. The
  first implementation uses authored terrain type at each vertex and raster interpolation; the
  existing distant path already omits roads and secondary terrain types.
- Moving generic texture decoding into another browser worker. Production texture pixels are
  normalized by the host asset boundary; this plan adds average metadata to that existing work.
- Sharing the terrain worker's queue with conventional static geometry. They may share the closed
  worker primitive, but terrain must not wait behind heavier static materialization.

## Ground Truth and Existing Patterns

### Terrain and Rendering

- `apps/holtburger-3d/src/lib/game/terrain/terrain-generator.ts`: the sole current terrain
  generation kernel and the synchronous `InlineTerrainGenerator` adapter.
- `apps/holtburger-3d/src/lib/game/terrain/terrain-system.ts`: independent geometry/texture
  reservation, stale-completion rejection, source retention, draw-unit readiness, and eviction.
- `apps/holtburger-3d/src/lib/game/terrain/types.ts`: generation, presentation, resource, and draw
  contracts.
- `apps/holtburger-3d/src/lib/game/terrain/terrain-sample.ts` and `pcode.ts`: canonical terrain-code
  extraction and pcode layout. Do not duplicate bit extraction in the worker or renderer.
- `apps/holtburger-3d/src/lib/game/renderer/geometry.ts`: renderer-independent geometry attributes.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-resource-manager.ts`: VAO attribute upload and
  validation.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-terrain-program.ts`: current combined near/far
  shader.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`: region-constant binding hoist,
  near/far partitioning, per-landblock transform/VAO/draw submission, and frame metrics.
- `apps/holtburger-3d/src/lib/game/environment/terrain-fog.ts`: stable landblock-ring cutoff.

### Texture Presentation

- `apps/holtburger-3d/src/lib/game/terrain/active-region-terrain-resolver.ts`: active-region terrain
  type and texture identities.
- `apps/holtburger-3d/src/lib/game/terrain/composition-table.ts`: terrain-code fallback resolution
  and terrain-code-to-color-layer records.
- `apps/holtburger-3d/src/lib/game/textures/texture-preparer.ts`: complete array preparation and
  in-flight coalescing.
- `apps/holtburger-3d/src/lib/game/textures/texture-manager.ts`: texture-array ownership, atomic
  publication, layer identity, and release.
- `apps/holtburger-3d/src-tauri/src/lib.rs` and
  `apps/holtburger-3d/src/lib/assets/decode-texture-pixels.ts`: canonical host texture-pixel
  transport. The host already owns normalized level-zero pixels and receives the semantic texture
  purpose, so the existing response can carry a required per-surface mean only for terrain-color
  requests without creating a separate terrain endpoint or second decode.

### Worker Precedent

- `apps/holtburger-3d/src/lib/game/workers/closed-worker.ts`: correlated closed requests, bounded
  pools, queue-delay/execution diagnostics, and lifecycle behavior.
- `apps/holtburger-3d/src/lib/game/commit/static-object-geometry-worker.ts`: one pure geometry
  kernel behind a closed job contract.
- `apps/holtburger-3d/src/lib/game/commit/static-object-geometry-worker-client.ts`: transport-only
  client, explicit transferable ownership, and result hydration.
- `apps/holtburger-3d/src/lib/game/commit/static-object-geometry-worker.entry.ts`: thin worker entry
  invoking the pure kernel and transferring output buffers.

### Authoritative Behavior References

- `acclient-eor-source/acclient.c`: retail landscape generation, pcode composition, lighting, and
  degrade behavior. Before changing or adding a `RETAIL DIVERGENCE` marker, record exact line
  citations, the observable consequence, and the content/scene census required by
  `apps/holtburger-3d/AGENTS.md`.
- `ACE/Source/ACE.Server/Physics/Common/TexMerge.cs`: terrain pcode, overlay, rotation, and road
  composition reference.
- `ACViewer/`: secondary evidence for terrain sample orientation and presentation.

## North Stars

1. World streaming must not synchronously generate terrain geometry on the runtime thread.
2. Geometry generation remains texture-blind; authored codes are the stable join contract.
3. There is one generation algorithm. A worker is an execution boundary, not a second
   implementation.
4. Region-derived presentation facts publish atomically; no placeholder colors or partially filled
   palettes may render.
5. The far path owns no sampler, surface-field, composition-table, UV, mask, detail, or point-light
   dependency.
6. Keep one draw per independently owned landblock, but group all far draws in each terrain pass
   behind one program and one palette upload.
7. Derived facts are computed once by their owner: the host computes texture means, terrain
   presentation resolves code mapping, and renderer consumers only read the completed palette.
8. Measure streaming tail latency and workload, not merely average kernel duration.

## Target Contracts

Names below are directional. During implementation, preserve established local vocabulary where it
is clearer, but do not retain aliases for removed concepts.

```ts
interface TerrainGeometryData {
  readonly kind: "terrain";
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly textureCoordinates: Float32Array;
  /** One authored terrain type code for each terrain vertex. */
  readonly terrainColorCodes: Uint8Array;
  readonly indices: Uint16Array | Uint32Array;
}

interface TerrainColorPalette {
  /** RGB or RGBA entries indexed directly by authored terrain code 0..31. */
  readonly colors: Float32Array;
}
```

`TerrainColorPalette` is a region presentation resource, not a field recomputed per landblock.
Road terrain type `0x20` remains available to near composition but is not part of the first far
vertex-code palette because authored terrain vertex codes occupy `0..31` and far roads remain out of
scope.

The Rust host remains ignorant of terrain codes and active-region composition. For each request whose
purpose is terrain color, the canonical texture-pixel response carries the normalized RGBA8 pixels
plus that one source surface's required mean RGB. Responses for every other purpose retain their
existing shape and carry no mean. The TypeScript texture preparer joins those per-asset means with
the active-region terrain-code mapping to assemble `TerrainColorPalette`; no separate terrain pixel
endpoint or generic always-present optional mean field is introduced.

The WebGL far program receives:

- position at attribute 0;
- normal at attribute 1;
- integer terrain code at a terrain-specific attribute location;
- projection, view, landblock offset, camera, ambient/sun, fog, and the 32-entry palette as
  uniforms.

It receives no UV and declares no sampler. The vertex stage indexes the palette and emits a smooth
RGB varying; the fragment stage applies fog to the interpolated, directionally lit albedo.

## Phased Implementation

## Phase 0: Current Evidence and Compatibility Audit

### Deliverables

- Capture a fresh baseline; do not reuse the historical 0.50 ms figure as current evidence.
- Record at least five identical `--relocate-sequence` streaming runs with terrain radius, all scene
  radii, content source, render scale, GPU mode, and hop interval beside the results.
- Record worst-frame median/spread, terrain installations per hop, and current synchronous terrain
  generation duration/workload.
- Retain separate terrain-isolation and Explorer-default baselines. The former attributes terrain
  costs; the latter sizes their importance under the product's concurrent streaming workload.
- Capture a deterministic mixed-terrain scene with the current far path enabled and disabled for
  later visual comparison.
- Sweep retail, ACE, and ACViewer references for the current distant approximation. Decide whether
  the existing solid path needs a missing `RETAIL DIVERGENCE` marker or whether the already-marked
  full-resolution terrain divergence owns the observable difference. Apply no marker without the
  required citation and census.

### Acceptance Criteria

- Baseline evidence is reproducible from recorded harness commands.
- At least five samples establish median and spread rather than a single favorable run.
- The visual capture includes landblocks with more than one terrain type; a uniform test block is
  not sufficient evidence for vertex-color blending.
- Any compatibility marker decision is backed by exact references rather than inference.

### Task Checklist

- [x] Add only the minimum temporary or durable diagnostics needed to attribute terrain generation.
- [x] Capture and record the current streaming workload and frame timings.
- [x] Capture current far-terrain appearance at a deterministic camera/time/fog state.
- [x] Complete the compatibility audit and record its result under this phase.

### Decisions and Course Corrections

The reproducible terrain-isolation workload is one eastward boundary crossing from `0xda55ffff` to
`0xda56ffff` with this command, run from `apps/holtburger-3d`:

```sh
npm run harness:browser -- --brief --gpu --landblock 0xda55ffff --terrain-radius 8 \
  --building-radius 0 --relocate-sequence 0xda56ffff --relocate-hop-ms 2000 \
  --time-of-day 0.5 --no-ambient-occlusion --vite-port 1481
```

All five samples used a fresh browser and content-host process, the AMD Radeon 780M through
ANGLE/Vulkan, a 1280x720 viewport at device and render scale 1, generated/environment/explicit scene
radii disabled, camera height 600 metres, yaw 0, pitch -45 degrees, day group 0, noon, and fog
enabled. Each run loaded 289 initial terrain landblocks and exactly 17 new terrain landblocks at the
crossing, published two static layers, and ended with 139 visible terrain inputs. The stable workload
partition was 111 solid draws at cutoff ring 4.

| Sample | Longest frame/render work | Longest tick |
| ------ | ------------------------: | -----------: |
| 1      |                   37.7 ms |       4.8 ms |
| 2      |                   36.1 ms |       4.1 ms |
| 3      |                   35.1 ms |       6.1 ms |
| 4      |                   34.3 ms |       8.1 ms |
| 5      |                   37.0 ms |       6.8 ms |

The longest-frame median was 36.1 ms with a 34.3-37.7 ms range and 3.4 ms spread. The longest-tick
median was 6.1 ms with a 4.1-8.1 ms range and 4.0 ms spread. Rendering dominated the longest frame in
all five runs. Atlas publication varied between cold processes, so source terrain batches and static
layer publications, rather than atlas counters, are the matched workload controls.

That first dataset deliberately disabled non-terrain residency and AO, used the harness's elevated
90-degree camera, and used teleport-style relocation. It is an attribution baseline, not an Explorer
default. The product-shaped baseline instead used the Explorer's complete default radii and frame
settings, automatic outdoor focus, and a continuous follow-mode flight across the same eastward
boundary:

```sh
npm run harness:browser -- --brief --gpu --landblock 0xda55ffff --terrain-radius 8 \
  --building-radius 8 --env-cell-radius 2 --explicit-object-radius 2 \
  --generated-object-radius 2 --explorer-focus --follow-flight 0xda56ffff \
  --follow-flight-ms 5000 --time-of-day 0.5 --day-group 0 --frame-mode portal \
  --ambient-occlusion --vite-port 1481
```

The first sanity run found that scripted follow flight reset the Explorer-focused 60-degree
projection to the harness's explicit-camera 90-degree projection on its first frame. The harness now
retains the active camera's near, far, and field of view while changing only its outdoor pose. The
five recorded runs each verified 60 degrees before and after flight, a 0.5/2,000 near/far range,
Explorer focus at pitch -35.264 degrees and yaw -45 degrees, AO enabled, portal EnvCell mode, all
layers enabled, render scale 1, anisotropic-2x filtering, weather, fog, static lights, day group 0,
and noon.

Every cold process crossed into `0xda56ffff` once near 3.0 seconds and received the same source
workload: 306 terrain and building layers, 30 object, generated, and EnvCell layers, and 24,521,746
response bytes. This is 289 initial plus exactly 17 new terrain landblocks. Static-layer
publications completed during the flight varied narrowly between 25 and 26; each run ended with 18
visible terrain inputs and four solid-terrain draws. No run reported a browser console error.

| Sample | Longest frame work | Longest render | Longest tick | Static publications |
| ------ | -----------------: | -------------: | -----------: | ------------------: |
| 1      |            86.4 ms |        45.9 ms |      74.5 ms |                  26 |
| 2      |            92.6 ms |        43.3 ms |      87.1 ms |                  25 |
| 3      |            84.0 ms |        40.6 ms |      75.6 ms |                  25 |
| 4      |            49.8 ms |        49.8 ms |      42.9 ms |                  25 |
| 5      |            80.2 ms |        48.5 ms |      73.4 ms |                  26 |

The Explorer-default median longest frame was 84.0 ms with a 49.8-92.6 ms range and 42.8 ms spread.
Median longest render was 45.9 ms with a 40.6-49.8 ms range and 9.2 ms spread. Median longest tick
was 74.5 ms with a 42.9-87.1 ms range and 44.2 ms spread; median average frame work was 7.86 ms. The
tail is usually runtime/publication-heavy under default concurrent streaming, although render alone
still reached 40.6-49.8 ms. These figures are intentionally not compared as a direct speed ratio to
the terrain-isolation relocation runs: the default workload adds buildings, EnvCells, authored and
generated objects, dynamics, AO, portal mode, a different camera, and continuous motion.

The default baseline limits what this plan may claim. Moving the terrain kernel and its validation
off-thread removes one synchronous contributor, but the sampled kernel is too small to explain an
84 ms product median. Phase 5 must report terrain-worker gains inside both datasets and must not
credit this terrain project for unrelated static publication, dynamic presentation, portal, AO, or
render costs.

These Phase 0 timings were captured on the recorded AMD Radeon 780M machine and are evidence about
workload shape and relative attribution on that machine, not portable performance thresholds.
Implementation and final verification may run on materially different hardware. Before Phase 1
changes behavior, capture a fresh same-machine timing baseline and unchanged-build screenshot noise
floor on the implementation machine. Phase 5 may compare performance only against that same-machine
baseline; the Phase 0 figures remain historical context rather than the other side of a speed ratio.

A separate real-GPU V8 profile used a 5-second follow flight from `0xda55ffff` through three
eastward crossings to `0xda58ffff`:

```sh
npm run harness:browser -- --brief --gpu --landblock 0xda55ffff --terrain-radius 8 \
  --building-radius 0 --follow-flight 0xda58ffff --follow-flight-ms 5000 \
  --time-of-day 0.5 --no-ambient-occlusion \
  --cpu-profile /tmp/holtburger-terrain-phase0.cpuprofile --vite-port 1481
```

The flight installed exactly 51 new terrain landblocks. Across the 6.405-second profile,
`generateTerrain` accounted for 1.651 ms of page-thread self samples, approximately 0.032 ms per new
landblock. This is sampled CPU time, not an exact wall-clock kernel timer. The receiver-side
`validateTerrainGenerationResult` accounted for 6.978 ms and allocates temporary JavaScript arrays
while scanning every typed-array value. `compileTerrainCompositionTable` accounted for 2.492 ms
because `TerrainSystem.#publishComposition` rebuilds the same active-region table for every
landblock. `#uploadGeometry` accounted for 0.534 ms of self samples. The flight's longest
frame/render work was 40.3 ms and its longest tick was 3.9 ms.

These findings change two later phases:

- Phase 2 must not move only the cheap kernel and leave a more expensive allocating validation scan
  on the runtime thread. Full value validation belongs beside generation in the worker; the receiver
  should enforce only cheap transport shape and boundary invariants without duplicating the scan.
- Phase 3 must compile the resolved active-region composition facts once and share that immutable
  result between the near composition table and far palette. Repeating an identical regional
  derivation per landblock is not acceptable even if downstream publication coalesces it.

The deterministic visual pair used the same camera, viewport, noon fog, AO setting, and particle
seed. The baseline retained `solidTerrainFogCoverage: 0.33`; the comparison temporarily set it to
`2`, captured frame 120, and restored the source constant immediately. The baseline submitted 111
solid draws among 139 visible terrain inputs; the comparison submitted none. The mixed river,
grass, shore, and road scene demonstrates that the current path loses within-landblock material
variation and introduces a hard flat-colour/fog boundary. ImageMagick measured 144,784 changed
pixels and normalized RMSE 0.00670488 across the 1280x633 captures. These values document the
comparison, not a future acceptance threshold.

```sh
npm run harness:browser -- --brief --gpu --landblock 0xda55ffff --terrain-radius 8 \
  --building-radius 0 --time-of-day 0.5 --no-ambient-occlusion --particle-seed 7 \
  --frame-interval-ms 16.6666667 --capture-frame 120 \
  --screenshot /tmp/holtburger-terrain-phase0-solid.png --vite-port 1481
```

The disabled comparison used the identical command with the screenshot name changed to
`holtburger-terrain-phase0-composited.png` while the temporary coverage value was `2`.

The compatibility audit found that the existing full-resolution mesh marker does not own this
observable difference. Retail's `CLandBlockStruct::GetCellRotation` derives each cell's surface from
four authored terrain codes and calls `LandSurf::SelectTerrain` (acclient.c:339677-339713);
`RenderDeviceD3D::DrawBlock` then binds the region surface array and draws every visible land cell
(acclient.c:438478-438495). `TexMerge::GetTerrain` resolves all four pcode terrain types with the
first region descriptor as fallback (acclient.c:294307-294477), matching
`ACE/Source/ACE.Server/Physics/Common/TexMerge.cs:83-122,144-194`. ACViewer independently retains a
base terrain plus as many as three terrain overlays and road overlays per polygon
(`ACViewer/ACViewer/Render/TerrainBatchDraw.cs:49-127`). None of these references supports a
winner-take-all landblock colour at distance.

The current shader therefore received its missing `RETAIL DIVERGENCE` marker with the 111-of-139
runtime census. Phase 4 must transfer that marker to the sampler-free far program and update its
consequence: vertex colors restore authored per-vertex terrain variation and remove the current hard
boundary, but they still omit retail cell-level alpha-mask, road, and detail-texture composition.

## Phase 1: Finalize the Texture-Independent Geometry Contract

### Deliverables

- On the implementation machine, capture the representative pre-change timing baseline required for
  Phase 5 and a repeated unchanged-build screenshot pair that establishes the local visual noise
  floor. Preserve the exact commands and environment beside the results.
- Add one `Uint8Array` terrain-color-code stream to `TerrainGeometryData`.
- Generate each code from the canonical 9x9 `terrainSamples` entry using the existing terrain-code
  extractor. Do not derive it from generated pcodes or duplicate bit masks.
- Upload the stream with `vertexAttribIPointer`; do not convert the domain integer to an implicit
  float convention.
- Extend worker-side geometry validation to require one in-range code per terrain vertex. Keep the
  runtime receiver's validation structural and allocation-free.
- Keep near rendering pixel-identical: its shader and resource usage ignore the new attribute.
- Remove `dominantTerrainCode` derivation and transport only after the far shader no longer consumes
  it in Phase 4; until then, treat it as an explicitly temporary migration field and do not add new
  consumers.

### Acceptance Criteria

- Generator tests prove canonical row-major vertex-code placement, full code range, and shared-edge
  equality for adjacent sources with equal boundary samples.
- Geometry upload tests prove an integer one-component attribute with the correct count and type.
- Near-terrain before/after browser captures remain within the unchanged-build noise floor measured
  on the same machine at the start of this phase.
- No texture identity, layer index, RGB value, or active-region fact enters the generator contract.

### Task Checklist

- [x] Capture the implementation-machine timing baseline and unchanged-build visual noise floor.
- [x] Extend terrain geometry and validation contracts.
- [x] Generate the code stream beside positions and UVs in the one canonical vertex loop.
- [x] Add the WebGL integer attribute upload path and focused tests.
- [x] Verify unchanged near rendering before introducing a second shader.

### Decisions and Course Corrections

Implementation moved to an AMD Radeon RX 7900 XT through ANGLE/Vulkan. Before changing terrain
code, five fresh cold-process samples repeated each Phase 0 workload on this machine. The commands,
camera, viewport, render scale, content source, and workload controls were unchanged except for the
dedicated Vite port `1483`.

The terrain-isolation samples each installed exactly 17 new terrain landblocks, published two static
layers, ended with 139 visible terrain inputs and 111 solid draws, and reported no browser error:

| Sample | Longest frame/render work | Longest tick |
| ------ | ------------------------: | -----------: |
| 1      |                    3.7 ms |       2.2 ms |
| 2      |                    3.9 ms |       2.0 ms |
| 3      |                    4.5 ms |       1.8 ms |
| 4      |                    3.9 ms |       1.9 ms |
| 5      |                    4.2 ms |       2.2 ms |

The local median longest frame/render was 3.9 ms with a 3.7-4.5 ms range and 0.8 ms spread. Median
longest tick was 2.0 ms with a 1.8-2.2 ms range and 0.4 ms spread.

The Explorer-shaped samples each crossed once near 3.0 seconds, received 306 terrain and building
layers plus 30 object, generated, and EnvCell layers totaling 24,521,746 response bytes, published
27 static layers, ended with 18 visible terrain inputs and four solid draws, preserved the 60-degree
camera projection, and reported no browser error:

| Sample | Longest frame work | Longest render | Longest tick |
| ------ | -----------------: | -------------: | -----------: |
| 1      |            15.5 ms |         8.8 ms |      12.6 ms |
| 2      |            22.8 ms |         9.4 ms |      21.2 ms |
| 3      |            14.0 ms |         7.5 ms |      12.5 ms |
| 4      |            15.7 ms |         7.4 ms |      12.7 ms |
| 5      |            17.8 ms |         7.2 ms |      15.7 ms |

The local Explorer-shaped median longest frame was 15.7 ms with a 14.0-22.8 ms range and 8.8 ms
spread. Median longest render was 7.5 ms with a 7.2-9.4 ms range and 2.2 ms spread. Median longest
tick was 12.7 ms with a 12.5-21.2 ms range and 8.7 ms spread. These same-machine figures, not the
Phase 0 laptop figures, are the performance comparison baseline for Phase 5.

Two repeated deterministic unchanged-build captures at frame 120 were both 1280x633. ImageMagick
measured normalized RMSE `0.000554038` between them. Phase 1 near-terrain comparison must stay at or
below that local noise floor; the temporary captures live at
`/tmp/holtburger-terrain-local-baseline-{a,b}.png` and are not repository artifacts.

`TerrainGeometryData` now carries one `Uint8Array` authored code stream generated in the existing
canonical vertex loop through `terrainCodeOf`. WebGL uploads it at terrain attribute location 3 with
`vertexAttribIPointer(..., 1, UNSIGNED_BYTE, ...)`; the near shader does not declare or consume the
attribute. Focused generator, terrain-system, geometry-manager, and WebGL resource-manager tests all
pass (19 tests), and TypeScript ESLint passes.

The deterministic Phase 1 capture measured normalized RMSE `0.000493617` against baseline A and
`0.000551026` against baseline B, both within the `0.000554038` unchanged-build noise floor. The
unused integer attribute therefore left current near and far rendering visually unchanged before
the shader split.

The aggregate `npm run check` currently reaches unrelated pre-existing trace-harness type failures:
`portal-work-trace.ts` still supplies the removed `renderAnchorOrigin` dependency and calls the
removed `ParticleSystem.collectCohorts` API. No Phase 1 file touches that harness. This is recorded
for the final repository gate rather than hidden or conflated with terrain work.

## Phase 2: Dedicated Terrain Worker Cutover

### Deliverables

- Retain `generateTerrain` as the sole pure deterministic kernel.
- Add a closed terrain job/result contract, worker entry, and transport-only
  `WorkerTerrainGenerator` using a dedicated one-slot `BoundedClosedWorkerPool` initially.
- Copy the retained input typed arrays into the job and transfer those copies. Never transfer the
  authoritative arrays held by `TerrainSystem`, because surface queries and ambient classification
  continue to consume them.
- Transfer every newly allocated result buffer back from the worker and hydrate `AABB3`/`Vec3`
  prototypes at the client boundary.
- Run exhaustive finite-value, index-range, surface-field, and terrain-code validation in the worker
  before transferring the result. Replace the runtime thread's allocating full-array scan with
  structural transport validation; do not validate the same values twice.
- Do not add queued-job cancellation in the initial cut. Evicted queued or running jobs may settle;
  the existing installation-identity check is the sole stale-completion authority and must reject
  their results before publication. Add cancellation later only if Phase 5 measures obsolete queued
  jobs delaying currently interested terrain.
- Replace production `InlineTerrainGenerator.build()` wiring with `WorkerTerrainGenerator.build()`.
- Delete the `InlineTerrainGenerator` class. Tests invoke `generateTerrain` directly or inject a
  fake `ClosedWorkerPort`; there is no independent fallback algorithm. `GameRuntime.build` must
  receive an injectable terrain-worker factory for Node tests instead of selecting an inline path
  with `typeof Worker`.
- Expose dedicated worker count, queue depth/peak, queue delay, execution/round-trip duration, the
  existing `completedJobCount`, and transferred input bytes through runtime/harness diagnostics.
  `completedJobCount` is the pool's settled-dispatch count and includes failed dispatches; do not
  present it as a success count. Treat the pool's execution duration as end-to-end worker
  dispatch/response time rather than claiming it is kernel-only CPU time. Reuse
  `ClosedWorkerPoolDiagnostics`; do not create synonymous terrain-only metrics.

### Acceptance Criteria

- Production runtime code contains no direct call to `generateTerrain` outside the worker entry.
- A worker-client test proves source arrays remain attached and unchanged after dispatch.
- Result arrays are transferred, not cloned, and hydrated bounds preserve class behavior.
- Evicting queued or running terrain prevents its later result from publishing or logging a failure.
- Worker error, termination, stale queued/running completion, and runtime destruction each have a
  focused lifecycle test.
- Browser evidence shows terrain worker activity and no synchronous `generateTerrain` sample on the
  page's V8 profile during a boundary crossing.

### Task Checklist

- [x] Define the closed job/result and transferable lists.
- [x] Implement the worker entry around the pure kernel.
- [x] Implement the dedicated worker-backed generator and result hydration.
- [x] Inject the worker-port factory into runtime construction for non-browser tests without adding
      an inline runtime mode.
- [x] Prove queued and running completions become harmlessly stale after eviction.
- [x] Cut production wiring over and delete the inline adapter.
- [x] Publish non-duplicative worker diagnostics.
- [x] Run worker lifecycle and real-browser streaming verification.

### Decisions and Course Corrections

`generateTerrain` remains the only generation kernel and its sole production caller is now the
terrain worker entry. `WorkerTerrainGenerator` owns a dedicated one-slot `BoundedClosedWorkerPool`.
It copies and transfers the four retained source arrays, transfers all six generated buffers back,
performs exhaustive value validation in the worker, performs only allocation-free structural
validation on receipt, and restores the `AABB3`/`Vec3` prototypes at that boundary. The inline
adapter and runtime's environment-dependent terrain fallback were deleted; Node runtime tests inject
a fake closed worker which executes the production kernel across real `structuredClone` transfer
semantics.

The input copies are intentional bounded overhead: `TerrainSystem` continues to own and query its
source height and terrain-sample arrays after dispatch, so transferring those authoritative buffers
would violate the existing runtime contract. Focused tests prove the retained inputs remain attached
and unchanged, both sides' transferred buffers detach, worker-reported errors surface, browser
worker `error` termination replaces the failed slot, destruction terminates pending work, and the
terrain installation identity rejects both explicitly queued and running completions after eviction
without allocating geometry or logging a failure.

The browser harness now reports the unmodified `ClosedWorkerPoolDiagnostics` as `terrainWorker` in
both steady-state and relocation output. A production-worker run of the Phase 1 terrain-isolation
boundary crossing completed 306 jobs and ended with zero active or queued jobs, one worker, 97 peak
queued jobs, 14,788.8 ms cumulative queue delay, 314.8 ms cumulative dispatch/response duration, and
193,086 transferred input bytes. The same crossing still installed exactly 17 new landblocks,
published two static layers, ended with 139 terrain inputs and 111 far draws, and reported a 3.5 ms
longest frame/render and 1.9 ms longest tick with no browser errors.

The 97-job initial-load queue is evidence for Phase 5's worker-count decision, not sufficient by
itself to expand the pool: it includes the cold 289-landblock burst, while the decision criterion is
matched boundary-crossing tail latency and obsolete-work interference. Initial cancellation remains
out of scope as planned.

The runtime-thread profile was captured with:

```sh
npm run harness:browser -- --brief --gpu --landblock 0xda55ffff --terrain-radius 8 \
  --building-radius 0 --follow-flight 0xda58ffff --follow-flight-ms 5000 \
  --time-of-day 0.5 --no-ambient-occlusion \
  --cpu-profile /tmp/holtburger-terrain-phase2.cpuprofile --vite-port 1483
```

Across 40,520 page-thread V8 samples it contained no `generateTerrain` sample. Two samples landed in
`validateTerrainGenerationTransport`, the deliberately cheap receiver-side shape validator; the
exhaustive generation and value-validation functions were absent from the page profile. Focused
terrain/worker/runtime tests, test-source checking, TypeScript ESLint, and `git diff --check` pass.
The aggregate `npm run check` remains blocked only after the app checks by the unrelated pre-existing
trace-harness API drift recorded in Phase 1.

## Phase 3: Immutable Active-Region Terrain Palette

### Deliverables

- Add normalized mean RGB metadata to the existing canonical texture-pixel response for
  terrain-color RGBA8 surfaces. Compute it in the Rust host while it owns the prepared level-zero
  pixels, using wide integer channel sums followed by one normalization. Keep the averaging helper
  generic pixel math, but invoke it only for terrain-color requests. Do not add a terrain-specific
  endpoint, read pixels back from WebGL, or load the asset a second time.
- Make the one transport contract purpose-discriminated: a terrain-color response requires and
  validates mean RGB for its single source surface, while every unrelated response retains its
  current shape with no optional, null, or fallback mean field. The host does not resolve terrain
  codes; TypeScript performs that active-region join.
- Resolve the complete authored terrain-code table once per active region, including the same
  missing-type fallback used by near composition. Both composition-table generation and palette
  assembly consume that immutable result; no landblock publication may recompile regional facts.
- Extend the terrain-color texture-array prepared-source/binding contract as a discriminated variant
  carrying one complete 32-entry `TerrainColorPalette`. Other texture-array purposes retain their
  existing shape.
- Publish the GPU color array and its CPU palette atomically under the same active-region texture
  identity and lease lifetime. No palette is observable before all required layers are prepared.
- Expose the already-completed palette through terrain program input. `TerrainSystem` must not reach
  into prepared pixel storage, and the renderer must not recompute texture averages.
- Validate finite normalized channels, exact palette length, code ordering, fallback mapping, and
  texture-array identity at every replaceable boundary.

### Acceptance Criteria

- The canonical host/TypeScript contract rejects missing, malformed, non-finite, or out-of-range
  mean color metadata at the boundary where each failure can occur, and proves unrelated responses
  carry no mean metadata.
- Known synthetic pixel fixtures produce exact expected averages, including non-square textures and
  channel values whose sums exceed 32-bit range.
- Duplicate terrain types sharing one source texture reuse its one computed mean.
- Missing authored terrain types resolve to the same fallback texture in both near composition and
  the palette.
- Delayed texture preparation proves geometry may finish first, no partial palette can render, and
  palette readiness does not regenerate geometry.
- Releasing the final region texture-array lease releases the associated palette metadata.

### Task Checklist

- [x] Extend and validate the canonical host texture response.
- [x] Add the purpose-specific prepared terrain-color source/binding variant.
- [x] Collapse terrain-type fallback resolution into one owned table.
- [x] Assemble and retain the immutable 32-entry palette.
- [x] Cover atomic publication, sharing, delayed readiness, and release.

### Decisions and Course Corrections

The host now emits two structurally distinct surface-manifest variants. A `terrain-color` response
requires `meanRgb`; every conventional response serializes the old surface shape and has no field
capable of carrying that metadata. The host computes the mean while it owns the normalized RGBA8
level-zero buffer, using `u64` channel sums, ignoring alpha, and applying one normalization after all
texels are visited. The helper validates dimensions against the byte buffer. Synthetic Rust tests
cover a non-square surface and a repeated-texel fixture whose channel sum exceeds `u32::MAX` without
allocating a correspondingly huge image.

The TypeScript host response is likewise a purpose-discriminated union: terrain color carries a
required normalized three-channel mean, while masks, detail, object surfaces, and palettes retain
`PreparedTextureSurface` with no optional mean. The binary decoder gives distinct failures for a
missing/non-array value, wrong channel count, non-numeric channel, out-of-range channel, and
wrong-purpose metadata. Valid JSON cannot represent `NaN` or infinity; the replaceable in-process
`TexturePixelSource` can, so `WorkerTexturePreparer` separately rejects wrong channel count,
non-finite channels, and out-of-range channels there. `TextureManager` independently validates
palette storage, both sides of the exact-length boundary, finite channels, and normalized range.
Tightening this union exposed an existing route mismatch: `ObjectDetail` was declared as an
object-texture request but fell through to the host's terrain-only surface path. It now follows the
already-supported prepared-object-texture path.

Regional terrain material resolution is now one composite table with authored descriptors and a
complete fallback-resolved lookup for codes `0..0x20`. `resolveActiveRegionTerrainPresentation`
caches one immutable presentation per `ActiveRegionSource`; that value owns the texture facts and
the precompiled near-composition table. Individual landblock installation no longer searches the
authored descriptors or recompiles the same regional lookup payload. Near composition and palette
assembly therefore consume the exact same missing-code fallback decision.

The terrain-color array fact carries the 32-entry code-to-source join. Preparation requests each
unique array source once, joins its host mean into a 96-float code-ordered palette, and returns a
terrain-color-only prepared-source variant. `TextureManager` validates exact length, finite
normalized channels, array membership and identity, then publishes the GPU resource and CPU palette
together in one binding only after every layer upload and mip generation succeeds. Terrain program
input receives that specialized binding; neither `TerrainSystem` nor the renderer sees prepared
pixels or recomputes an average.

Focused tests prove duplicate terrain codes sharing one source issue one host request, fallback code
ordering, malformed mean rejection, atomic binding identity, delayed palette readiness, geometry
completion before texture completion without regeneration, and final-lease release of both binding
and metadata. The purpose-specific Rust tests, 32 focused TypeScript tests, test type-check, Svelte
check, TypeScript ESLint, Rust formatting, and Clippy pass. A real RX 7900 XT browser-harness run
loaded 25 terrain landblocks through the rebuilt HTTP content host, completed 25 terrain worker jobs,
rendered 15 terrain inputs, and reported no browser console messages, proving the Rust binary
manifest, TypeScript decoder, palette preparation, texture publication, and WebGL input path agree
end to end. The aggregate check still stops only at the unrelated trace-harness drift recorded in
Phase 1.

## Phase 4: Sampler-Free Far-Terrain Program and Clean Cutover

### Deliverables

- Add a dedicated WebGL2 far-terrain program with position, normal, integer terrain code, palette,
  ambient/sun, camera, transforms, and fog only.
- Resolve palette lookup in the vertex shader and emit a smooth RGB varying. Preserve current
  directional lighting and per-fragment radial fog behavior; continue omitting static/dynamic point
  lights in the far path.
- Keep near and far landblocks as contiguous state groups. Bind the near program and terrain
  resources only when at least one near landblock is visible; then bind the far program and upload
  the region palette once before all far draws in that terrain pass.
- Do not unbind near textures merely to make device state look empty. The guarantee is that the far
  program declares no samplers and the far group performs no texture-related bind or sample.
- Hoist terrain's identity local-to-landblock matrix out of each group loop. Inside the far loop,
  only landblock offset, VAO, and `drawElements` should vary.
- Remove `dominantTerrainCode` from generation results, realized resources, draw units, validation,
  renderer uniforms, tests, and diagnostics.
- Remove the `uSolidTerrain` branch and `uSolidTerrainCode` from the near program.
- Rename surviving live vocabulary from solid/flat terrain to far vertex-color terrain, including
  cutoff helpers, tuning, metrics, comments, harness labels, and non-historical documentation.
  Retained historical plan results should receive a short supersession note rather than rewritten
  history.

### Acceptance Criteria

- Shader introspection/source tests prove the far program declares no sampler or UV input.
- A browser GL trace proves each far state group performs zero texture/sampler binds and one palette
  upload per terrain pass, regardless of far-landblock count. Portal and other additional terrain
  passes are counted independently.
- Frame metrics prove all visible far landblocks are contiguous under one program selection while
  retaining one draw per landblock.
- A far-only view does not bind near terrain composition resources.
- Mixed-terrain screenshots show interpolation within landblocks and no new cracks or color seams
  along shared landblock edges.
- Near terrain remains visually unchanged, and cutoff behavior responds exactly as before.
- `rg` finds no surviving production symbol or label for the deleted dominant/solid-color
  mechanism.

### Task Checklist

- [x] Build and test the narrow far shader/program.
- [x] Split near and far setup into explicit contiguous state groups.
- [x] Upload one palette per far group in each terrain pass and reduce the per-landblock loop to
      offset/VAO/draw.
- [x] Delete dominant-code and combined-program branches.
- [x] Sweep renamed vocabulary and append supersession notes to historical plans.
- [x] Verify real WebGL state and rendered appearance in the browser harness.

### Decisions and Course Corrections

The clean cutover uses two deliberately narrow programs. The near program retains composition,
detail, masks, point lights, and per-landblock surface-field inputs, while the far program accepts
only position, normal, integer terrain code, the regional palette, directional light, transforms,
camera, and fog. Shared directional-light GLSL and its uniform binder prevent semantic drift without
turning the two shaders into one conditional template. The old `uSolidTerrain`,
`uSolidTerrainCode`, and `dominantTerrainCode` contracts and derivation were deleted rather than
retained as migration aliases.

The renderer counts the visible near/far partition once, conditionally enters each contiguous state
group, and uploads the far palette once per entered group. The identity local transform is now
group-constant. Each far landblock varies only offset, VAO, and indexed draw; its loop does not bind
surface fields, texture arrays, samplers, masks, or point lights. The final RX 7900 XT frame at the
Phase 1 pose had 139 terrain inputs, 111 far draws at cutoff ring 4, and one far-palette upload. The
same run reported no browser console errors.

Shader source validation compiles both near and far vertex/fragment pairs and asserts that the far
pair contains neither a sampler, UV input, nor texture call. An opt-in browser-harness trace wraps
the real WebGL2 context before construction, identifies the near and far programs from their
uniform contracts, and fails if texture-unit, texture, or sampler state changes before or between
any far indexed draw. The final far-only real-GPU audit observed 108,647 far draws with zero such
calls, 913 palette uploads for 913 far-program activations, and zero near-program activations. A
separate Explorer portal/AO trace observed 792 far draws with zero such calls and 198 palette
uploads for 198 far activations. That product scene produced one outdoor terrain view; it proves the
portal execution path, while the renderer's per-view group entry and activation/upload equality
count any additional terrain views independently rather than fabricating a second view for the
evidence. The trace intentionally attributes through each draw rather than until the next
`useProgram`: WebGL leaves the far program current after its group, so later pipeline cleanup
otherwise produces false ownership. This is durable harness evidence, not a production renderer
hook.

The deterministic Phase 1 and Phase 4 captures use the same machine, content, camera, viewport,
time, fog, and AO setting. Visual review shows smoothly interpolated mixed terrain through the far
region instead of whole-landblock blocks, with no obvious cracks at adjacent edges; the near region
retains its composed appearance. Phase 5 still owns the seam-focused cutoff review and matched
performance repetitions. A production vocabulary sweep finds no surviving dominant/solid-terrain
symbol or label. Historical measurements keep their original names under the supersession note in
the older draw-state plan.

## Phase 5: Resteer Against Streaming and Visual Evidence

### Deliverables

- Compare the first four phases against the goal before polishing or tuning.
- Repeat at least five identical terrain-isolation relocation sequences and five identical
  Explorer-default follow flights on the implementation machine. Compare them only with the
  same-machine pre-change baseline captured in Phase 1. Report median/spread beside worker queue,
  execution, settled-dispatch (`completedJobCount`), terrain-installation, static-publication, and
  atlas workloads for each dataset.
- Compare page V8 profiles to prove terrain kernel work left the runtime thread; separately identify
  remaining synchronous terrain publication and GPU upload cost rather than crediting it to the
  worker.
- Compare near/far GPU terrain spans within each baseline at identical camera, radii, content,
  render scale, hardware, time, and fog. Do not compare the isolated relocation and default flight
  as though they were the same workload.
- Review mixed-terrain captures at the cutoff and at adjacent landblock seams.
- Decide from evidence whether the one-slot terrain pool is sufficient. Increase it only if queue
  delay, not execution time or main-thread publication, is the measured bottleneck.
- Dry-run Phase 6 after recording any course correction.

### Acceptance Criteria

- No conclusion relies on one streaming sample or an unmatched workload.
- Runtime-thread stall, worker queue delay, worker round-trip, synchronous GPU publication, and GPU
  draw cost are reported as distinct quantities.
- Any worker-count change is supported by queue-delay evidence and retested for CPU contention.
- Visual review either accepts the authored-vertex approximation or records a bounded corrective
  phase before cleanup.

### Task Checklist

- [x] Repeat streaming and rendering measurements under both baseline configurations.
- [x] Attribute remaining worst-frame work with renderer and V8 profiles.
- [x] Review screenshots and seam-focused captures.
- [x] Record decisions and update later acceptance criteria if evidence changes the plan.

### Decisions and Course Corrections

All measurements below ran on the Phase 1 implementation machine: RX 7900 XT through ANGLE/Vulkan,
1280x720 CSS/device viewport, render scale 1, and Vite port 1483. The exact Phase 1 terrain-isolation
and Explorer commands were reused. Every run used a fresh content host, Vite process, Chrome
process, and worker; GPU runs were serialized to avoid cross-process contention.

The terrain-isolation cohort used one teleport-style eastward boundary crossing. Every sample
completed exactly 17 new terrain jobs, transferred 10,727 worker input bytes, published two static
layers, received 306 terrain and two building layers in 912,906 response bytes, ended with 139
visible terrain inputs, submitted 111 far draws with one palette upload, and reported no browser
error.

| Sample | Longest frame/render | Longest tick | Worker queue delta | Worker dispatch delta |
| ------ | -------------------: | -----------: | -----------------: | --------------------: |
| 1      |               5.3 ms |       2.4 ms |            20.1 ms |               10.7 ms |
| 2      |               5.1 ms |       1.7 ms |            71.6 ms |               14.1 ms |
| 3      |               5.7 ms |       1.9 ms |            39.7 ms |               12.6 ms |
| 4      |               5.6 ms |       2.2 ms |            31.3 ms |               12.1 ms |
| 5      |               5.3 ms |       2.5 ms |            31.0 ms |               12.2 ms |

Median longest frame/render was 5.3 ms with a 5.1-5.7 ms range and 0.6 ms spread, compared with the
Phase 1 median of 3.9 ms. Median longest tick was 2.2 ms with a 1.7-2.5 ms range and 0.8 ms spread,
compared with 2.0 ms. The worker's median summed boundary queue delay was 31.3 ms across all 17 jobs
(1.84 ms/job) and median total dispatch/response duration was 12.2 ms (0.72 ms/job). The median cold
load queue high-water mark was 50; that cumulative peak is not presented as boundary-only. Atlas
work was stable at four uploaded pages/58,720,256 bytes. Median cumulative atlas-publication time
was 41.9 ms and median longest publication was 19.7 ms.

The corrected Explorer cohort retained full default radii, Explorer focus, portal mode, AO, and a
five-second continuous follow flight. Every sample crossed once near three seconds, completed 17
new terrain jobs, transferred 10,727 worker bytes, published 27 static layers, received the matched
306 terrain/building plus 30 object/generated/EnvCell layers in 24,521,746 bytes, preserved the
60-degree projection, ended with 18 visible terrain inputs and four far draws/one palette upload,
and reported no browser error.

| Sample | Longest frame | Longest render | Longest tick | Worker queue delta | Worker dispatch delta | Atlas pages |
| ------ | ------------: | -------------: | -----------: | -----------------: | --------------------: | ----------: |
| 1      |       16.9 ms |         7.2 ms |      15.3 ms |             6.2 ms |               25.3 ms |           5 |
| 2      |       26.1 ms |         8.0 ms |      24.2 ms |             8.5 ms |               25.4 ms |           5 |
| 3      |       22.6 ms |         6.7 ms |      21.1 ms |             3.0 ms |               26.4 ms |           5 |
| 4      |       20.0 ms |         7.6 ms |      18.3 ms |            31.6 ms |               26.5 ms |           6 |
| 5      |       25.4 ms |         7.9 ms |      23.8 ms |             1.8 ms |               26.9 ms |           5 |

Median longest frame was 22.6 ms with a 16.9-26.1 ms range and 9.2 ms spread, compared with the
Phase 1 median of 15.7 ms. Median longest render was 7.6 ms with a 6.7-8.0 ms range, effectively the
same as the 7.5 ms baseline. Median longest tick was 21.1 ms with a 15.3-24.2 ms range, compared with
12.7 ms. The worker's median summed boundary queue delay was 6.2 ms and median total
dispatch/response duration was 26.4 ms across 17 jobs; the median cold-load queue high-water mark
was 52. Median atlas work was five uploaded pages/75,497,472 bytes, 65.8 ms cumulative publication,
and a 29.5 ms longest publication. A first five-run Explorer cohort captured before the brief report
included atlas facts had lower 16.7/7.0/14.6 ms medians; it remains valid timing evidence. Across all
ten runs the corresponding medians were 20.9/7.25/19.25 ms. This variance and the unfavorable
matched medians are recorded rather than converted into a speedup claim.

The three-crossing terrain-isolation V8 profile contained 40,498 page samples and no
`generateTerrain`, exhaustive/transport validation, or composition-table compilation sample.
Synchronous `#uploadGeometry` self-time totaled 0.313 ms. The matched Explorer flight profile
contained 40,622 samples, likewise contained none of those functions or palette/mean preparation,
and totaled 0.152 ms in `#uploadGeometry`. Its dominant page self-time belonged to object draw,
scene culling, instance-run formation, and portal work. A profiled Explorer flight landed at
15.0/6.7/13.4 ms frame/render/tick, further demonstrating that the tail varies with concurrent
publication. Terrain generation has left the runtime thread, but the data does not show an overall
streaming-tail improvement; nor does it support blaming the observed tail increase on terrain.

The renderer profiler now preserves aggregate `terrainMs` while reporting non-overlapping near and
far elapsed-query spans. In the isolation scene, 28 near draws cost 0.02936 ms GPU and 111 far draws
cost 0.02336 ms, for 0.05272 ms total terrain GPU time and 0.0967 ms mean CPU submission. In the
Explorer final pose, 14 near and four far draws cost 0.05216 and 0.01312 ms respectively, for
0.06528 ms total; AO and portal composition dominated the broader measured GPU work. The far group
therefore handles substantially more isolation draws for less GPU time, but terrain GPU cost is not
the streaming tail.

The cutoff crop covers mixed river, shore, grass, and road landblocks. Authored terrain colors now
interpolate through each far mesh and remain continuous across shared edges with no visible cracks
or edge-color seams. The thin road still disappears in the far region, matching the pre-existing
far-road omission; it is visible but does not dominate the materially improved river and shore
continuity. Near composition remains intact below the cutoff. No corrective visual phase is needed.

One terrain worker remains the evidence-backed choice. Explorer boundary queue delay is small, the
isolation queue average is 1.84 ms/job, execution remains sub-millisecond per job there, and no run
measured obsolete work delaying current terrain. A second slot would optimize the cold burst while
adding contention to the much heavier concurrent workload. Queued cancellation likewise remains
YAGNI: installation identity already prevents stale publication, and no obsolete-queue interference
was observed. The Phase 6 dry run exposed the unrelated pre-existing `portal-work-trace.ts` API
drift recorded in Phase 1 as its only aggregate-check blocker; Phase 6 resolves that bounded drift.

## Phase 6: Cleanup and Final Verification

### Deliverables

- Remove temporary GL counters, probes, screenshots, profiles, and diagnostic scaffolding that has
  no durable operational consumer.
- Keep worker queue diagnostics only if they remain useful for diagnosing streaming readiness;
  delete metrics that merely duplicate existing closed-worker facts.
- Remove migration fields, unused texture metadata, dead shader uniforms, obsolete test fixtures,
  and compatibility adapters.
- Review every touched type and field for one named consumer and every validation clause for a
  reachable failure case.
- Update this plan with final measurements, decisions, concessions, and any explicitly deferred
  debt.

### Acceptance Criteria

- Formatting, TypeScript/Svelte checks, lint, dead-code checks, focused/full Vitest, Rust formatting,
  and clippy all pass with warnings treated as errors.
- `git diff --check` passes.
- Canonical browser-harness runs complete without browser console errors, worker errors, rejected
  resource promises, or WebGL errors.
- A final diff sweep finds no duplicate terrain-generation algorithm, production inline terrain
  adapter, dominant-code path, far sampler dependency, or stale vocabulary.
- The final implementation satisfies the Definition of Done below without relying on temporary
  instrumentation.

### Task Checklist

- [x] Delete temporary evidence collection and dead migration code.
- [x] Perform a field/consumer, validation/reachability, ownership, and lifecycle review.
- [x] Run all static, unit, Rust, browser, streaming, and visual gates.
- [x] Record final evidence and remaining concessions in this plan.

### Decisions and Course Corrections

The final field/consumer audit found one complete ownership chain for each new fact. Authored terrain
codes travel from the canonical generator loop through worker validation/transfer and integer VAO
upload to the far vertex shader. Host-derived surface means travel only through the terrain-color
response, specialized preparer, code-ordered palette, atomic texture binding, and one far-group
upload. No runtime or renderer consumer rescans pixels, recompiles regional composition, or derives
a dominant code.

The validation audit also removed an allocating receiver-side terrain range scan and split every
new mean/palette guard into one reachable failure mode per message. Focused tests now exercise
missing/non-array, wrong-count, non-numeric, non-finite, out-of-range, wrong-storage, short, and long
inputs at their actual replaceable boundaries. Canonical terrain-code tuples make palette and
composition iteration total, removing assertions and redundant length checks from consumers.

One full-suite failure exposed an over-eager ownership boundary: the active-region static-detail
owner consumed only ordered detail roles but had become coupled to complete blend/road texture-array
resolution. Detail-role resolution is now a separately cached non-empty tuple; complete terrain
presentation still resolves and caches composition, texture facts, and composition table atomically.
This preserves the non-empty array invariant instead of weakening it for an unrelated consumer.
Dead-code analysis then caught and removed an unnecessary exported role interface.

The previously recorded aggregate-check blocker was bounded API drift rather than dead architecture.
`portal-work-trace.ts` now supplies `targetLives` and snapshots persistent particle draw ranges
instead of the deleted cohort representation. The production particle reference comment was swept
to the current vocabulary. No legacy adapter or duplicate particle path was restored.

Evidence tooling retained after cleanup has a named operational consumer. Closed-worker diagnostics
separate queue, dispatch, and transfer ownership during future streaming investigations. Brief
harness initial/final worker and texture snapshots prevent cumulative-counter misattribution. The
opt-in GL trace asserts the far draw contract without production hooks. Split near/far elapsed-query
spans extend the existing opt-in renderer profiler, while aggregate `terrainMs` remains available.
Screenshots, logs, and CPU profiles remain `/tmp` artifacts and no temporary production counter or
migration field survives.

Final static and unit gates all pass:

- `npm run check`: zero Svelte warnings/errors; app, Node, trace, and test TypeScript pass.
- `npm run test:ts`: 172 files and 1,309 tests pass.
- `npm run lint`: ESLint, Knip dead-code analysis, and Clippy with warnings denied pass.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 183 Rust tests pass.
- `cargo fmt --check`, `npm run format:check`, terrain shader validation for both program pairs, and
  `git diff --check` pass.

Post-cleanup RX 7900 XT browser smokes also pass. The final deliberately far-only view rendered all
119 terrain inputs through the far group with one frame-level palette upload, zero static-light
binds, and zero near-program activations. Its reset measurement window observed 108,647 far indexed
draws with zero pre-/inter-draw texture-unit, texture, or sampler binds; 913 palette uploads exactly
matched 913 far-program activations. The Explorer portal/AO run crossed once, settled 306 terrain
jobs, published 27 static layers, retained the 60-degree camera, and ended with 18 terrain inputs and
four far draws/one palette upload. Both runs ended ready with zero active/queued terrain jobs and no
browser console error; the harness assertions, not manual log review, enforce the GL contract.

A post-implementation code-quality pass tightened the final boundaries without changing the visual
design. Terrain transport validation now requires every fixed 9x9 output buffer to have its exact
storage and length, with separate diagnostics and focused coverage for geometry, surface fields,
bounds, and scalar values. Terrain palette preparation likewise rejects both short and long
code-to-source joins before requesting pixels. Regional material lookup preserves the previous
first-authored result if malformed content repeats a terrain code, rather than accidentally adopting
`Map`'s last-write behavior. The canonical terrain-code tuple now owns the palette count used by
TypeScript and GLSL, production worker construction no longer encodes injection as an optional
fallback, and the touched renderer's shared fog/lighting uniform types and import layout were
deduplicated. Final Explorer review accepted the rendered result.

Remaining concessions are explicit rather than hidden debt. The authored-vertex far approximation
still omits road masks, cell alpha composition, detail textures, and point lights; visual evidence
accepts that bounded presentation for this phase. Repeated timings prove page-thread generation is
gone but do not show an overall streaming-tail improvement, because unchanged concurrent static,
object, portal, and atlas publication dominate the tail. The generic `WorkerTexturePreparer` still
has its pre-existing empty lifecycle hook and stale future-worker naming; redesigning generic
texture preparation is outside this terrain plan. One terrain worker and no queued cancellation
remain deliberate evidence-backed choices, not unfinished migration work.

## Risks and Mitigations

| Risk                                                                                         | Mitigation                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker dispatch overhead exceeds the tiny terrain kernel cost.                               | The worker move is required to remove synchronous streaming work, but queue delay and round-trip are measured separately. Start with one dedicated slot and tune only from repeated evidence.                                |
| Continuous travel queues terrain that has already left interest.                             | Initially let obsolete work settle and rely on the installation-identity check before publication. Add queued cancellation only if Phase 5 measures obsolete queue delay materially postponing currently interested terrain. |
| Worker transfer detaches source arrays still used for surface and ambient queries.           | Copy the small input arrays and transfer only those copies. Tests assert the authoritative buffers remain attached and unchanged.                                                                                            |
| Sharing a worker with static geometry delays ground arrival.                                 | Reuse closed-worker infrastructure but own a dedicated terrain queue and worker.                                                                                                                                             |
| Palette construction creates a geometry/texture dependency.                                  | Geometry emits authored codes only. Palette readiness gates far drawing, never generation or geometry publication.                                                                                                           |
| CPU texture averaging adds frontend streaming work.                                          | Compute means in the host while it owns normalized pixels and carry the result through the existing response; do not rescan pixels in the renderer/runtime.                                                                  |
| Palette fallback differs from near composition.                                              | Resolve the terrain-code material table once and make both composition and palette consume it.                                                                                                                               |
| Uniform-array indexing or limits vary across WebGL2 implementations.                         | Use 32 `vec3` entries, comfortably inside WebGL2's minimum vertex-uniform budget, compile in the real browser harness, and fail renderer construction loudly on shader failure.                                              |
| Integer attribute wiring silently disagrees with shader type.                                | Use a dedicated validated `Uint8Array` plus `vertexAttribIPointer`; cover location, width, type, and count in resource-manager tests.                                                                                        |
| Arithmetic mean differs slightly from the GPU's generated 1x1 mip due to reduction rounding. | Define the new palette as the normalized arithmetic mean of level-zero RGB, test that contract exactly, and judge the intentional appearance change visually rather than claiming bit identity with the old stand-in.        |
| Vertex interpolation exposes color seams at landblock boundaries.                            | Codes come from canonical shared-edge terrain samples; test equal boundary streams and capture real adjacent blocks. Do not hide a source mismatch with edge averaging.                                                      |
| Roads disappear from far terrain.                                                            | This matches the current far concession. Keep road-mask software composition out of the worker unless visual evidence demonstrates a material regression from the current path.                                              |
| Worker completion is off-thread but GPU publication still stalls.                            | Attribute generation separately from geometry upload during resteering. Do not present the worker move as eliminating all terrain publication cost.                                                                          |
| Separate near/far programs drift in shared transform, lighting, or fog semantics.            | Share small proven GLSL primitives where they are genuinely identical and cover both programs in browser captures; do not create a large shader-template abstraction merely to deduplicate text.                             |

## Definition of Done

- [x] Production terrain generation executes only through a dedicated worker around the one pure
      `generateTerrain` kernel.
- [x] Runtime-retained terrain source buffers are never detached by worker dispatch.
- [x] Evicted queued or running terrain may settle but cannot publish a stale result.
- [x] Terrain geometry carries one validated integer terrain code per authored vertex.
- [x] Terrain texture preparation publishes one complete immutable 32-entry regional palette from
      source-proven normalized pixels without a duplicate asset load.
- [x] Geometry generation and palette materialization remain independently schedulable.
- [x] Far terrain uses a dedicated program with no sampler, UV, surface field, composition, detail,
      mask, road, or point-light contract.
- [x] Far landblocks render contiguously under one program/palette state group with one draw per
      landblock.
- [x] The dominant-terrain-code and combined solid-terrain branch are deleted completely.
- [x] Near-terrain composition and cutoff selection retain their behavior.
- [x] Mixed terrain blends through vertex interpolation without new landblock-edge seams.
- [x] Repeated streaming evidence shows terrain generation no longer contributes synchronous page
      execution, with queue and publication costs honestly separated.
- [x] Unit, type, lint, dead-code, Rust, WebGL browser, streaming, and visual gates pass.
- [x] This plan records final measurements, decisions, concessions, and remaining debt.

## Open Questions

No question blocks implementation.

- Far roads remain intentionally omitted for the first cutover. If mixed-terrain visual review shows
  that road disappearance, rather than terrain interpolation, is the dominant artifact, add a
  separately scoped follow-up backed by road-heavy captures and retail/ACE composition evidence.
- The dedicated terrain worker begins with one slot. Phase 5 may raise the count only when repeated
  queue-delay evidence shows that readiness latency, rather than runtime publication, is the active
  bottleneck.
- Queued cancellation is deliberately absent from the initial worker. Add it only if Phase 5 can
  distinguish obsolete queued jobs and shows that they materially delay currently interested
  terrain; stale-installation rejection remains required either way.
