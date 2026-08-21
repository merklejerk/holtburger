# Holtburger 3D Worker Terrain and Far Vertex-Color Plan

Status: in progress — Phase 0 complete
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
  transport. The host already owns normalized level-zero pixels and can derive their arithmetic
  mean without a second decode.

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
6. Keep one draw per independently owned landblock, but group all far draws behind one program and
   one palette upload.
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
- Near-terrain browser captures remain within the measured unchanged-build noise floor.
- No texture identity, layer index, RGB value, or active-region fact enters the generator contract.

### Task Checklist

- [ ] Extend terrain geometry and validation contracts.
- [ ] Generate the code stream beside positions and UVs in the one canonical vertex loop.
- [ ] Add the WebGL integer attribute upload path and focused tests.
- [ ] Verify unchanged near rendering before introducing a second shader.

### Decisions and Course Corrections

To be filled during execution.

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
- Add queued-job cancellation for terrain eviction. Pending jobs should be removed before dispatch;
  an already-running job may finish but its result remains stale and unpublished.
- Preserve the existing installation-identity check as the final stale-completion authority.
- Replace production `InlineTerrainGenerator.build()` wiring with `WorkerTerrainGenerator.build()`.
- Delete the `InlineTerrainGenerator` class. Tests invoke `generateTerrain` directly or inject a
  fake `ClosedWorkerPort`; there is no independent fallback algorithm. `GameRuntime.build` must
  receive an injectable terrain-worker factory for Node tests instead of selecting an inline path
  with `typeof Worker`.
- Expose dedicated worker count, queue depth/peak, queue delay, execution/round-trip duration,
  completed job count, and transferred input bytes through runtime/harness diagnostics. Treat the
  pool's execution duration as end-to-end worker dispatch/response time rather than claiming it is
  kernel-only CPU time. Reuse `ClosedWorkerPoolDiagnostics`; do not create synonymous terrain-only
  metrics.

### Acceptance Criteria

- Production runtime code contains no direct call to `generateTerrain` outside the worker entry.
- A worker-client test proves source arrays remain attached and unchanged after dispatch.
- Result arrays are transferred, not cloned, and hydrated bounds preserve class behavior.
- Evicting queued terrain prevents its publication and does not log an expected cancellation as a
  failure.
- Worker error, termination, stale completion, cancellation, and runtime destruction each have a
  focused lifecycle test.
- Browser evidence shows terrain worker activity and no synchronous `generateTerrain` sample on the
  page's V8 profile during a boundary crossing.

### Task Checklist

- [ ] Define the closed job/result and transferable lists.
- [ ] Implement the worker entry around the pure kernel.
- [ ] Implement the dedicated worker-backed generator and result hydration.
- [ ] Inject the worker-port factory into runtime construction for non-browser tests without adding
      an inline runtime mode.
- [ ] Add queued cancellation without terminating healthy slots for ordinary eviction.
- [ ] Cut production wiring over and delete the inline adapter.
- [ ] Publish non-duplicative worker diagnostics.
- [ ] Run worker lifecycle and real-browser streaming verification.

### Decisions and Course Corrections

To be filled during execution.

## Phase 3: Immutable Active-Region Terrain Palette

### Deliverables

- Add normalized mean RGB metadata to the canonical texture-pixel response for terrain-color RGBA8
  surfaces. Compute it in the host while it owns the prepared level-zero pixels, using wide integer
  channel sums followed by one normalization. Do not read pixels back from WebGL or load the asset a
  second time.
- Make the transport contract purpose-aware: terrain-color responses require and validate mean RGB;
  unrelated formats do not acquire meaningless fallback fields.
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

- Host and TypeScript transport tests reject missing, malformed, non-finite, or out-of-range mean
  color metadata for terrain-color responses.
- Known synthetic pixel fixtures produce exact expected averages, including non-square textures and
  channel values whose sums exceed 32-bit range.
- Duplicate terrain types sharing one source texture reuse its one computed mean.
- Missing authored terrain types resolve to the same fallback texture in both near composition and
  the palette.
- Delayed texture preparation proves geometry may finish first, no partial palette can render, and
  palette readiness does not regenerate geometry.
- Releasing the final region texture-array lease releases the associated palette metadata.

### Task Checklist

- [ ] Extend and validate the canonical host texture response.
- [ ] Add the purpose-specific prepared terrain-color source/binding variant.
- [ ] Collapse terrain-type fallback resolution into one owned table.
- [ ] Assemble and retain the immutable 32-entry palette.
- [ ] Cover atomic publication, sharing, delayed readiness, and release.

### Decisions and Course Corrections

To be filled during execution.

## Phase 4: Sampler-Free Far-Terrain Program and Clean Cutover

### Deliverables

- Add a dedicated WebGL2 far-terrain program with position, normal, integer terrain code, palette,
  ambient/sun, camera, transforms, and fog only.
- Resolve palette lookup in the vertex shader and emit a smooth RGB varying. Preserve current
  directional lighting and per-fragment radial fog behavior; continue omitting static/dynamic point
  lights in the far path.
- Keep near and far landblocks as contiguous state groups. Bind the near program and terrain
  resources only when at least one near landblock is visible; then bind the far program and upload
  the region palette once before all far draws.
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
- A browser GL trace proves the far state group performs zero texture/sampler binds and one palette
  upload, regardless of far-landblock count.
- Frame metrics prove all visible far landblocks are contiguous under one program selection while
  retaining one draw per landblock.
- A far-only view does not bind near terrain composition resources.
- Mixed-terrain screenshots show interpolation within landblocks and no new cracks or color seams
  along shared landblock edges.
- Near terrain remains visually unchanged, and cutoff behavior responds exactly as before.
- `rg` finds no surviving production symbol or label for the deleted dominant/solid-color
  mechanism.

### Task Checklist

- [ ] Build and test the narrow far shader/program.
- [ ] Split near and far setup into explicit contiguous state groups.
- [ ] Upload one palette per far group and reduce the per-landblock loop to offset/VAO/draw.
- [ ] Delete dominant-code and combined-program branches.
- [ ] Sweep renamed vocabulary and append supersession notes to historical plans.
- [ ] Verify real WebGL state and rendered appearance in the browser harness.

### Decisions and Course Corrections

To be filled during execution.

## Phase 5: Resteer Against Streaming and Visual Evidence

### Deliverables

- Compare the first four phases against the goal before polishing or tuning.
- Repeat at least five identical terrain-isolation relocation sequences and five identical
  Explorer-default follow flights. Report median/spread beside worker queue, execution,
  completed-job, terrain-installation, static-publication, and atlas workloads for each dataset.
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

- [ ] Repeat streaming and rendering measurements under both baseline configurations.
- [ ] Attribute remaining worst-frame work with renderer and V8 profiles.
- [ ] Review screenshots and seam-focused captures.
- [ ] Record decisions and update later acceptance criteria if evidence changes the plan.

### Decisions and Course Corrections

To be filled during execution.

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

- [ ] Delete temporary evidence collection and dead migration code.
- [ ] Perform a field/consumer, validation/reachability, ownership, and lifecycle review.
- [ ] Run all static, unit, Rust, browser, streaming, and visual gates.
- [ ] Record final evidence and remaining concessions in this plan.

### Decisions and Course Corrections

To be filled during execution.

## Risks and Mitigations

| Risk                                                                                         | Mitigation                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker dispatch overhead exceeds the tiny terrain kernel cost.                               | The worker move is required to remove synchronous streaming work, but queue delay and round-trip are measured separately. Start with one dedicated slot and tune only from repeated evidence.                         |
| Continuous travel queues terrain that has already left interest.                             | Cancel jobs still pending in the client pool; let active work finish safely; retain the installation-identity check before publication.                                                                               |
| Worker transfer detaches source arrays still used for surface and ambient queries.           | Copy the small input arrays and transfer only those copies. Tests assert the authoritative buffers remain attached and unchanged.                                                                                     |
| Sharing a worker with static geometry delays ground arrival.                                 | Reuse closed-worker infrastructure but own a dedicated terrain queue and worker.                                                                                                                                      |
| Palette construction creates a geometry/texture dependency.                                  | Geometry emits authored codes only. Palette readiness gates far drawing, never generation or geometry publication.                                                                                                    |
| CPU texture averaging adds frontend streaming work.                                          | Compute means in the host while it owns normalized pixels and carry the result through the existing response; do not rescan pixels in the renderer/runtime.                                                           |
| Palette fallback differs from near composition.                                              | Resolve the terrain-code material table once and make both composition and palette consume it.                                                                                                                        |
| Uniform-array indexing or limits vary across WebGL2 implementations.                         | Use 32 `vec4` entries, comfortably inside WebGL2's minimum vertex-uniform budget, compile in the real browser harness, and fail renderer construction loudly on shader failure.                                       |
| Integer attribute wiring silently disagrees with shader type.                                | Use a dedicated validated `Uint8Array` plus `vertexAttribIPointer`; cover location, width, type, and count in resource-manager tests.                                                                                 |
| Arithmetic mean differs slightly from the GPU's generated 1x1 mip due to reduction rounding. | Define the new palette as the normalized arithmetic mean of level-zero RGB, test that contract exactly, and judge the intentional appearance change visually rather than claiming bit identity with the old stand-in. |
| Vertex interpolation exposes color seams at landblock boundaries.                            | Codes come from canonical shared-edge terrain samples; test equal boundary streams and capture real adjacent blocks. Do not hide a source mismatch with edge averaging.                                               |
| Roads disappear from far terrain.                                                            | This matches the current far concession. Keep road-mask software composition out of the worker unless visual evidence demonstrates a material regression from the current path.                                       |
| Worker completion is off-thread but GPU publication still stalls.                            | Attribute generation separately from geometry upload during resteering. Do not present the worker move as eliminating all terrain publication cost.                                                                   |
| Separate near/far programs drift in shared transform, lighting, or fog semantics.            | Share small proven GLSL primitives where they are genuinely identical and cover both programs in browser captures; do not create a large shader-template abstraction merely to deduplicate text.                      |

## Definition of Done

- [ ] Production terrain generation executes only through a dedicated worker around the one pure
      `generateTerrain` kernel.
- [ ] Runtime-retained terrain source buffers are never detached by worker dispatch.
- [ ] Obsolete queued terrain work is cancellable and stale results cannot publish.
- [ ] Terrain geometry carries one validated integer terrain code per authored vertex.
- [ ] Terrain texture preparation publishes one complete immutable 32-entry regional palette from
      source-proven normalized pixels without a duplicate asset load.
- [ ] Geometry generation and palette materialization remain independently schedulable.
- [ ] Far terrain uses a dedicated program with no sampler, UV, surface field, composition, detail,
      mask, road, or point-light contract.
- [ ] Far landblocks render contiguously under one program/palette state group with one draw per
      landblock.
- [ ] The dominant-terrain-code and combined solid-terrain branch are deleted completely.
- [ ] Near-terrain composition and cutoff selection retain their behavior.
- [ ] Mixed terrain blends through vertex interpolation without new landblock-edge seams.
- [ ] Repeated streaming evidence shows terrain generation no longer contributes synchronous page
      execution, with queue and publication costs honestly separated.
- [ ] Unit, type, lint, dead-code, Rust, WebGL browser, streaming, and visual gates pass.
- [ ] This plan records final measurements, decisions, concessions, and remaining debt.

## Open Questions

No question blocks implementation.

- Far roads remain intentionally omitted for the first cutover. If mixed-terrain visual review shows
  that road disappearance, rather than terrain interpolation, is the dominant artifact, add a
  separately scoped follow-up backed by road-heavy captures and retail/ACE composition evidence.
- The dedicated terrain worker begins with one slot. Phase 5 may raise the count only when repeated
  queue-delay evidence shows that readiness latency, rather than runtime publication, is the active
  bottleneck.
