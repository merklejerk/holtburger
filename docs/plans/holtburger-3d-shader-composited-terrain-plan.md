# Holtburger 3D Shader-Composited Terrain Architecture Plan

Status: Implemented. The client-agnostic Rust terrain-source and texture-pixel boundary is
implemented by `holtburger-3d-terrain-loading-pipeline-plan.md`; this plan completes terrain
generation, device realization, shader composition, and headless WebGL2 validation. Visual parity
review against reference applications is deliberately user-owned work.

## Implementation Record

### 2026-07-23 — Explorer free-fly camera follows source availability

Completed:

- Explorer now owns a legacy-style free-fly controller rather than an editable camera-position
  form. Left drag rotates; middle/right drag pans; wheel moves along local up; W/S, Z/C, A/D,
  Space/Page Up, Page Down, and Shift retain the legacy movement policy.
- `GameRuntime.updateSceneInterest` returns an opaque revision receipt and publishes narrow,
  revision-aware source/topology availability events. The events expose neither terrain buffers nor
  runtime resource identities. A repeat request updates the active layer's revision, so an older
  coalesced load cannot be discarded merely because the Explorer asked to refocus the same target.
- Outdoor terrain source commit publishes availability before geometry and texture realization.
  `queryOutdoorTerrainSurface` samples the canonical source grid using the same deterministic
  triangle split as the stride-one rendered mesh, allowing Explorer to place its camera above a
  real terrain height without waiting for the radius-two interest halo.
- Explorer's camera coordinator is app-local. It chooses an in-landblock offset/look-at pose,
  obtains world-point residency from runtime for every controller update, submits the resolved
  camera, and cancels an outstanding automatic focus as soon as the user takes manual control.
- Explorer exposes the complete outdoor LoD request policy. Its sliders preserve the proven
  `terrain ≥ buildings ≥ explicit objects/generated scenery` hierarchy, while env-cell radius is
  constrained by terrain. Terrain is the only typed source capability currently implemented;
  enabling another configured layer deliberately surfaces its runtime availability failure rather
  than silently dropping the requested layer.
- The runtime contract includes future environment-cell topology availability and world-bound
  queries. Explorer deliberately does not request the unimplemented env-cell layer; an env-cell
  target reports that limitation rather than generating a predictable pipeline error or claiming a
  camera focus it cannot establish.
- Explorer telemetry now measures runtime tick and render separately. The former implementation
  measured rendering before starting its displayed draw timer, making a near-zero draw number
  meaningless.
- Shared helper review moved vector scaling, subtraction, cross products, normalization, and scalar
  clamping into `game/math/vector-utils`, while yaw/pitch quaternion conversion now lives in
  `game/math/camera-orientation`. The canonical outdoor terrain-cell count has one terrain-domain
  owner in `terrain/types`. The terrain sampler remains terrain-domain logic, and the Explorer
  offset/look-at choice remains Explorer policy; promoting either as generic math would blur real
  ownership rather than eliminate duplication.
- The first quaternion bridge used the mathematical positive-Y yaw sign, but this renderer's
  camera-to-world matrix convention requires its inverse. That made a positive legacy yaw render
  its movement-forward point behind the camera. `camera-orientation` now owns both the shared
  axes and corrected conversion, and Explorer restores legacy's 60-degree vertical FOV.

Verification:

- Focused terrain-surface tests prove interpolation of the renderer's triangle surface and its
  canonical boundary behavior. Runtime tests prove unavailable target content is reported against
  the current matching scene-interest revision.
- `npm run check`, `npm run test:ts` (93 tests), and `npm run build` pass. The camera-orientation
  regression test proves a controller-forward point transforms to camera-space `-Z` through the
  same quaternion and view-matrix path used for rendering.
- The self-cleaning `npm run harness:browser -- --landblock 0xda55ffff` run reaches a real
  textured frame with no browser errors after the runtime frame split.

### 2026-07-23 — Canonical-grid generator replaces the terrain stub

Completed:

- `TerrainGenerationSource` now carries its outdoor `landblockId`. Retail's deterministic diagonal
  split uses global cell coordinates derived from that identity, so leaving it only on the enclosing
  installation would force a generator to invent topology or accept hidden ambient state.
- `InlineTerrainGenerator` replaces the falsely named throwing `WorkerTerrainGenerator`. It consumes
  only the immutable canonical source and creates all 36 stride/direction variants as one
  concatenated indexed terrain geometry, with per-variant bounds, render-local positions, normals,
  and normalized grid coordinates. It also creates exactly one pcode field for each stride.
- Generated positions perform the sole frontend basis adaptation: canonical columns become render X,
  canonical south-to-north rows become negative render Z, and resolved heights become render Y. The
  terrain root keeps its identity local transform. The conversion avoids negative zero at the south
  edge, matching existing static-terrain conventions.
- Stride-specific pcode fields use the proven southwest, southeast, northeast, northwest sample
  order and the established retail bit packing. Generated topology uses the same unsigned global-cell
  split hash already used by the shared canonical terrain mesh.
- Directional variants apply the direct retail edge rule: every odd edge vertex that faces a coarser
  neighbor becomes the average of its two even-edge neighbors; normals are then regenerated from the
  adjusted indexed geometry. Geometry and pcode allocation remain independent of texture residency.

Decisions and debt:

- The fixed 9x9 source and 36 bounded variants make an inline executor the honest current
  implementation. The `TerrainGenerator` port still permits a future dedicated worker, but there is
  no fake worker transport or detached source buffer today. Move it off-thread only with a measured
  scheduling problem, preserving the same source/result contract.
- At this checkpoint the special cardinal transition lowering formulas had not yet been ported. The
  common edge averaging was real and source-backed, but retail-transition parity still required the
  authored-grid clamp pass.
- At this checkpoint the renderer still used its temporary flat green terrain pass. Generated geometry
  and pcode fields reached device realization; shader composition was the next presentation step.

Verification:

- Focused generator tests prove the complete 36-variant/4-field result, pcode corner packing, the
  canonical-to-render-local basis conversion, and a stride-two north-edge stitch.
- The affected frontend files pass ESLint and Prettier checks. The broader app lint command still
  stops on unrelated existing findings in `commit/pipeline.ts` and `texture-manager.test.ts`.
  Frontend type checking now passes.

### 2026-07-23 — WebGL2 composes terrain from canonical source resources

Completed:

- `WebGL2TerrainProgram` replaces the flat-green terrain path. Its vertex stage keeps the terrain
  basis and anchor-relative transform explicit; its fragment stage fetches the selected stride's
  integer pcode field and performs regional composition from the existing `RGBA32UI` composition
  table, color array, terrain-mask array, road-mask array, and detail texture.
- The shader ports the source-proven `TexMerge` choices: terrain corner extraction, repeated-corner
  base/overlay selection, corner-versus-side alpha-map selection, rotations, road combinations,
  full-road type `0x20`, and the pcode-stable variation hash. The hash uses 16-bit pieces so
  `floor(hash * count / 2^32)` remains exact under WebGL2's 32-bit integer arithmetic.
- Source alpha coordinates and quarter-turn mapping follow the established legacy renderer and
  ACViewer convention. Color/detail tiling stays in composition metadata; pcodes remain generated
  cell resources rather than material attributes.
- The renderer binds six source resources per selected terrain draw and submits only the selected
  index range. Detail fade retains the legacy frontend policy (`10` to `50` world units), outside
  content and IPC contracts.
- The unused flat-color program was deleted instead of retained as a second renderer mode. The
  shared shader compile/uniform helpers are deliberately small and renderer-local.
- Normalized 2D textures and arrays now set explicit filters and wrap. In particular, one-level R8
  mask arrays use `LINEAR` rather than the default mipmapped min filter, which would be incomplete.
- The Tauri dev launcher supplies the existing `HOLTBURGER_DATS` override from the checked-out
  workspace `dats` directory only when the caller has not supplied one. Cargo runs the host from
  `src-tauri`, where the shared repository's relative `./dats` fallback cannot see the workspace
  fixture; this dev-only bridge preserves the common content-discovery API rather than adding a
  Tauri-specific host setting.

Decisions and debt:

- Composition is shader-side, not host-resolved or CPU-precomposed. `holtburger-content` remains
  client-agnostic; the renderer alone owns GPU record packing and sampler binding.
- Exact extracted vertex/fragment source is validated and linked by `glslangValidator`. That pass
  exposed a missing GLSL ES sampler default-precision declaration; the terrain fragment stage now
  declares precision for `sampler2D`, `sampler2DArray`, and `usampler2D`. The user owns any
  subsequent terrain, road, mask, and detail comparison against legacy/ACViewer.
- A virtual-display Tauri launch reaches the native host with both an explicit and the new automatic
  development `HOLTBURGER_DATS` path. This environment cannot keep its window interactive, so it is
  startup evidence only—not proof that pixels reached a live canvas.
- Lighting remains deliberately absent: textured source composition should land before we invent a
  light model. Normals are generated and uploaded for the following presentation pass.
- A live reference comparison remains useful evidence, especially for the authored-grid cardinal
  clamp pass, but is outside this implementation plan and is not a rendering-completion gate.

Verification:

- Focused pcode, generator, terrain-system, and texture-manager tests pass. Modified terrain,
  renderer, and script files pass ESLint and Prettier.
- The full frontend suite and production Vite build pass. The exact extracted vertex and fragment
  shader stages compile and link through `npm run check:terrain-shader`, which invokes
  `glslangValidator` without relying on source line numbers.
- `knip` still reports the repository's pre-existing unused inventory; it found one newly added
  shader-source export, which was removed. Repository-wide `git diff --check` still reports an
  unrelated trailing blank line in the
  user-modified `scene-graph.ts`; the terrain slice itself is whitespace-clean.
- The complete frontend lint command currently stops only on existing unrelated findings in
  `commit/pipeline.ts` and `texture-manager.test.ts`. Frontend type checking passes.

### 2026-07-23 — Retail 4×4-cell cardinal transition clamps

Completed:

- The special `CLandBlockStruct::TransAdjust` lowering pass now runs for `stride === 2`, which is
  retail's 4×4-cell mesh. The former “stride-4” label was wrong: source `SideCellCount == 4` means
  source-grid stride two, not four.
- Cardinal north, south, east, and west variants clamp two odd reduced-grid boundary vertices using
  the retail pair of authored-height extrapolations. Diagonal variants deliberately retain only the
  ordinary edge averaging pass.
- The port samples `TerrainGenerationSource.heights` in its canonical 9×9 grid. ACE and ACViewer's
  C# translations use the reduced `SideVertexCount` in several source-height expressions, whereas
  the retail client decompile indexes the authored `9`-wide height array; the implementation follows
  the retail indexes.

Verification:

- Focused generator tests exercise all four cardinal targets and prove a diagonal transition does
  not receive the cardinal clamp.

Remaining debt:

- The user will perform any rendered comparison against retail or ACViewer to validate the combined
  average-and-clamp result on real neighboring landblocks. The implementation has source-proven
  formulas and a live WebGL2 capture, but does not claim visual parity.

### 2026-07-23 — Headless WebGL2 browser harness produces the first textured frame

Completed:

- `npm run harness:browser` adapts the legacy browser-harness pattern without importing its old
  renderer or asset model. It starts a self-cleaning local content host, Vite, and headless Chrome;
  then CDP submits one outdoor scene interest plus a resolved camera and captures a PNG.
- The diagnostic content host serves the exact existing `HBTR` terrain-source and `HBTP`
  texture-pixel responses. The browser-specific `HttpTerrainContentSource` decodes those contracts
  through the same validators as the Tauri adapters, so the harness does not introduce an alternate
  content representation.
- The first `0xda55ffff` run exposed a host-contract bug: the outer source manifest contained the
  region number, but its nested composition object omitted the `regionNumber` required for texture
  key resolution. The host now serializes it, and a Rust manifest test asserts it.
- Successful ANGLE/SwiftShader Chrome runs render `0xda55ffff` grass, road masks, and detail, plus
  `0xdc56ffff`'s varied-height grass/dirt/water blend, without browser errors. The captures are
  direct WebGL2 evidence of source loading, terrain generation, resource realization, shader
  composition, and indexed drawing—not a mock or a flat-color fallback.

Decisions and debt:

- The HTTP host and adapter are diagnostics-only application code. They reuse the Tauri host's
  public byte builders; `holtburger-content` remains client agnostic and receives no HTTP or browser
  vocabulary. The harness applies the same development-only workspace `HOLTBURGER_DATS` fallback as
  the Tauri dev launcher, while respecting an explicit caller override.
- Current Chrome requires `--use-gl=angle --use-angle=swiftshader`; legacy's
  `--use-gl=swiftshader` leaves WebGL limits unavailable in this environment. The harness fails on
  browser console errors and tears down detached process groups, avoiding the stale GUI/server
  instances that made virtual-display validation unreliable.
- The legacy browser harness can boot its older asset host, Vite, and Chrome stack, but it did not
  settle or terminate under this executor. It is therefore not yet a usable automated source of
  matching captures here; the exact leftover process group was stopped and cleanup was verified.
- Visual parity against legacy, retail, or ACViewer is user-owned review work. It is deliberately
  excluded from this implementation plan's completion gate; the headless harness supplies the
  repeatable landblock/camera evidence needed for that review without launching persistent apps.
- This proves a real textured draw, but not visual parity. The user will compare matching
  landblocks/camera poses from legacy or ACViewer, including multi-terrain and transition cases,
  before considering the road blend, variation, or 4×4 transition geometry visually identical.

Verification:

- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml` passes.
- `npm run harness:browser -- --landblock 0xda55ffff --settle-ms 15000 --screenshot /tmp/holtburger-3d-da55-terrain.png`
  yields a non-flat grass-and-road frame with no browser errors; the same command for
  `0xdc56ffff` yields a multi-terrain grass/dirt/water frame.

## Context And Boundaries

### Goal

Encode a direct terrain flow in which resolution determines stable logical texture identities,
runtime materializes and leases those textures, `TerrainSystem` generates and realizes every
required LOD resource once per interested landblock, and drawing selects an already-realized variant
from the scene anchor.

This plan applies to `apps/holtburger-3d/src/lib/game`. It includes a real WebGL2 composition
capture. Visual and retail-transition parity are intentionally user-owned reference-review work,
outside the implementation completion criteria.

### In Scope

- Preserve source-proven landblock terrain and regional composition facts.
- Resolve deterministic keys for terrain color, blend-mask, and road-mask arrays plus standalone
  detail textures before any pixel materialization occurs.
- Make terrain commit artifacts source-only: texture facts, terrain samples, and composition facts,
  with no decoded pixels or generated geometry.
- Move texture preparation, in-flight coalescing, device materialization, leasing, and eviction into
  runtime residency.
- Start independent terrain generation and regional texture preparation concurrently after source
  resolution.
- Remove `TerrainMaterialSetKey`, `TerrainTextureSetKey`, and aggregate terrain texture-set lifetime.
- Generate all source-proven geometry variants as one concatenated indexed geometry plus one
  per-stride surface field during landblock installation.
- Make `TerrainSystem` own generated terrain device allocations and answer query-time draw-resource
  selection for each landblock.
- Let runtime bridge terrain source installation to one stable `SceneGraph` root without mediating
  generated-resource realization.
- Make frame assembly query visible landblocks from `TerrainSystem` instead of duplicating terrain
  resources in `RenderScene` and `RenderResourceRegistry`.
- Bind source-proven terrain program resources and compose them in WebGL2 without moving renderer
  policy into content or the host.

### Out Of Scope

- Visual-parity certification against legacy, retail, or ACViewer. The user will conduct that
  reference review; this plan records the evidence needed to make it possible.
- Porting the legacy worker pool or transport.
- Final lighting, shadows, atmosphere, effects, and visual-parity policy.
- Profiling and production optimization.
- CPU or GPU precomposition of complete landblock color surfaces.
- Supporting arbitrary per-edge LOD relationships outside retail's concentric Chebyshev ring policy.

Known participants and ownership boundaries must still exist as code-level shapes. Unknown mechanics
must fail at a narrow boundary rather than being represented by fake working behavior.

## Ground Truth

### Presentation References

- `ACE/Source/ACE.DatLoader/Entity/TexMerge.cs`: DAT texture-merge descriptor structure.
- `ACE/Source/ACE.DatLoader/Entity/TerrainAlphaMap.cs`: terrain alpha-map assets.
- `ACE/Source/ACE.DatLoader/Entity/RoadAlphaMap.cs`: road alpha-map assets.
- `ACE/Source/ACE.Server/Physics/Common/TexMerge.cs`: pcode terrain, overlay, rotation, and road
  resolution.
- `ACE/Source/ACE.Server/Physics/Common/TextureMergeInfo.cs`: resolved overlay cardinalities.
- `ACViewer/ACViewer/Physics/Common/TexMerge.cs`: inspectable composition resolution.
- `ACViewer/ACViewer/Model/LandVertex.cs`: terrain texture-array and alpha-map representation.
- `ACViewer/ACViewer/Render/TerrainBatchDraw.cs`: terrain GPU submission inputs.
- `ACViewer/ACViewer/Content/texture.fx`: shader-side overlay composition.
- `acclient-eor-source/acclient.c`, especially `TexMerge::GetTerrain`,
  `TexMerge::FindTerrainAlpha`, `TexMerge::FindRoadAlpha`, `TexMerge::FillTempTexBuffer`, and
  `TexMerge::MakeNewSurface`: secondary retail composition evidence.
- `acclient-eor-source/acclient.c`, especially `LScape::get_block_orient`,
  `CLandBlockStruct::generate`, and `CLandBlockStruct::TransAdjust`: secondary retail LOD selection
  and landblock-local transition-adjustment evidence.

Do not infer mask selection, rotation, road ordering, UV behavior, or blend equations from names.
Only encode facts established by these references.

### Worker References

- `apps/holtburger-3d-legacy/src/lib/workers/pool.ts`: worker pool and service-channel mechanics.
- `apps/holtburger-3d-legacy/src/lib/workers/prepared-asset-service.ts`: worker-to-host prepared-asset
  requests and request coalescing.
- `apps/holtburger-3d-legacy/src/lib/systems/open-world-streaming/texture-residency/page-build/`:
  worker-side surface requests and transferable pixel results.
- `apps/holtburger-3d-legacy/src/lib/static/bake/worker-client.ts`: shared baker client.
- `apps/holtburger-3d-legacy/src/lib/static/terrain/bake/terrain-geometry-baker.ts`: old terrain
  generation workload and transferable products.

The new architecture may reuse worker infrastructure and Rust host preparation, but not the legacy
atlas-centric terrain model, diagnostics-heavy contracts, or duplicated ownership systems.

### Proven Terrain Facts

- `CellLandblock` stores canonical `9x9` height bytes and `9x9` `u16` terrain samples. Terrain sample
  bits 0-1 carry road state and bits 2-6 carry terrain type.
- Retail derives mesh density from Chebyshev landblock distance to the scene anchor: distance `0..1`
  uses an `8x8` cell mesh, distance `2` uses `4x4`, distance `3..4` uses `2x2`, and greater distance
  uses `1x1`.
- Retail subsamples the authored grid with strides `1`, `2`, `4`, or `8`; it does not subdivide
  beyond the authored grid.
- Transition direction can alter intermediate boundary heights, so generation policy includes both
  source-grid stride and transition direction.
- Retail recomputes generated cell pcodes and surfaces when source-grid stride changes.
- Retail transition-direction changes at a fixed stride reconstruct vertex heights and planes but do
  not reconstruct polygons, UVs, or selected surfaces. Directional geometry variants at one stride
  can therefore share that stride's surface field.
- `CLandBlockStruct::generate` and `CLandBlockStruct::TransAdjust` read only the current landblock's
  canonical heights and generated vertices. They do not read neighboring landblock sources,
  geometry, heights, or selected LODs.
- Retail's landblock-local adjustment therefore assumes compatible authored heights along shared
  landblock boundaries. The absence of neighbor reads is proven; DAT-wide boundary compatibility
  must be verified from representative assets rather than assumed from the algorithm.
- `CLandBlockStruct::GetCellRotation` selects one surface for each generated cell and assigns it to
  both triangles. The canonical generated surface field is per cell/quad, not per vertex or triangle.
- Full-road pcodes normalize to synthetic road terrain type `0x20` as the base texture with no
  overlay or mask.
- Landscape detail is region-level presentation from terrain descriptor index `0`: one texture plus
  tiling. Fade constants found in legacy adapters are not DAT source facts.
- Checked Dereth assets contain 30 compatible terrain colors, five compatible terrain masks, and
  three compatible road masks. Color, blend-mask, and road-mask arrays are therefore realistic.
  Landscape detail is a separate compatible standalone texture.
- Canonical terrain-generation input is small enough to structured-clone. Only generated output
  buffers should be transferred; retained source buffers must not be detached.

## North Stars

- **Resolve identity before residency.** Stable `TextureKey`s and ordered source memberships are
  known from canonical asset facts before pixels are decoded or device resources exist.
- **Commit facts, not materialized resources.** The terrain commit pipeline resolves source facts;
  runtime owns loading and residency.
- **Use individual texture keys as ownership identities.** A landblock directly leases the arrays
  and standalone textures it requires. Do not add an aggregate terrain texture-set key.
- **Keep texture and generated-resource lifetimes independent.** Regional textures and the complete
  realized terrain resources remain stable while frame-time LOD selection changes.
- **Keep generation renderer-independent.** Workers operate on terrain and composition facts, not
  WebGL handles, texture-array layer numbers, or backend packing.
- **Keep generation landblock-local.** One terrain-generation job consumes one landblock source.
  Neighbor sources, generated geometry, current LODs, and scene-anchor state are not generation
  inputs.
- **Give terrain one authoritative resource owner.** `TerrainSystem` owns CPU generation state,
  generated device allocations, failure state, and query-time variant selection. Do not mirror
  that state in runtime render registries.
- **Keep scene topology stable.** Runtime creates one terrain root from immutable source placement and
  bounds. LOD selection does not create, replace, or resize scene nodes.
- **Keep device ownership behind managers.** `TerrainSystem` owns the generated keys it leases
  through injected `GeometryManager` and `TextureManager`; the WebGL2 resource manager owns the
  corresponding backend handles. The renderer only borrows resolved backend resources while drawing.
- **Realize every variant up front.** A landblock becomes drawable only after its concatenated
  geometry and every per-stride surface field are device-backed. This deliberately trades loading
  work and memory for one installation/eviction lifecycle and allocation-free frame-time selection.
- **Reuse indexed draw ranges.** Concatenate terrain variants into one geometry resource per
  landblock and select variants with the renderer's existing `indexStart`/`indexCount` model.
- **Select; do not regenerate.** Scene-anchor movement chooses an existing variant at frame
  assembly and performs no worker work, device allocation, or resource retirement.

## Worker Ownership And Boundaries

Explorer and client frontends construct the same runtime architecture but own the commit pipeline as
an injected collaborator:

```text
ExplorerApp / ClientApp
    -> LandblockTerrainSource + TexturePixelSource
    -> StandardCommitPipeline
         -> StaticBakeWorkerPool
         -> TexturePageBuildWorkerPool
    -> GameRuntime (borrows CommitPipeline)
         -> TexturePreparer
              -> TexturePreparationWorkerPool
         -> TerrainSystem
              -> GeometryManager + TextureManager
         -> InlineTerrainGenerator
    -> WebGL2Device
         -> WebGL2ResourceManager
         -> Renderer (borrows resources while drawing)
```

Ownership rules:

- The frontend constructs and destroys its `CommitPipeline`.
- `GameRuntime` borrows the `CommitPipeline` interface, may request commits, and never destroys it.
- `StandardCommitPipeline` privately constructs and destroys commit-time static-bake and texture-page
  workers. Alternative pipeline implementations may use different internals.
- `GameRuntime` privately constructs and destroys runtime texture-preparation workers and its
  `TerrainSystem`. It also constructs and destroys the `InlineTerrainGenerator` injected into that
  system. `TerrainSystem` owns every generated terrain allocation key it creates through the
  injected device resource boundary, but it does not own either injected collaborator.
- The frontend owns the typed Tauri source adapters. `StandardCommitPipeline` receives only
  `LandblockTerrainSource`; `GameRuntime` receives only `TexturePixelSource`.
- Tests inject fake pipeline, texture-preparer, terrain-generator, geometry-manager, and
  texture-manager collaborators through the same constructors used by production.
- Worker pools do not own scene interest, texture leases, terrain source state, or device resources.
  They execute typed jobs and return owned transferable CPU output.

Worker responsibilities remain separate even when they reuse generic queue, transfer, service-channel,
and disposal primitives:

- Static-bake and texture-page workers execute during commit preparation and are pipeline-owned.
- Texture-preparation workers execute after terrain commit when runtime residency requires a missing
  texture. They request normalized pixels through the typed `TexturePixelSource` capability.
- Terrain generation executes once for each newly installed landblock source and produces one
  complete immutable generation result. Scene-anchor movement never submits terrain-generation work.
  The committed source input is sufficient, so the current inline executor does not request host
  assets. A future worker must preserve this boundary.
- Terrain generation is not a static bake job and does not run in the static baker worker pool.

Ordered teardown is part of the ownership contract:

```text
stop frontend frame loop
    -> await GameRuntime.destroy()
         -> stop accepting new runtime work
         -> destroy TerrainSystem
              -> discard pending generation completions
              -> release every generated terrain allocation
         -> dispose terrain generator
         -> dispose texture-preparation workers
    -> await CommitPipeline.destroy()
         -> dispose commit-time workers
    -> await renderer device destruction
```

## Target Shapes

Names are directional. Exact field names may change when source investigation proves a more accurate
domain term.

```ts
interface ResolvedTextureArrayFact {
  readonly kind: "array";
  readonly key: TextureArrayKey;
  readonly purpose: TexturePurpose;
  readonly sourceAssetIds: readonly DatAssetId[];
}

interface ResolvedStandaloneTextureFact {
  readonly kind: "standalone";
  readonly key: StandaloneTextureKey;
  readonly purpose: TexturePurpose;
  readonly sourceAssetId: DatAssetId;
}

interface ResolvedTerrainTextureFacts {
  readonly colors: ResolvedTextureArrayFact;
  readonly blendMasks: ResolvedTextureArrayFact;
  readonly roadMasks: ResolvedTextureArrayFact;
  readonly detail: ResolvedStandaloneTextureFact;
}

interface TerrainTextureKeys {
  readonly colors: TextureArrayKey;
  readonly blendMasks: TextureArrayKey;
  readonly roadMasks: TextureArrayKey;
  readonly detail: StandaloneTextureKey;
}

/** Authored-grid sampling stride used to produce one terrain LOD. */
type TerrainMeshStride = 1 | 2 | 4 | 8;

/** Retail edge-adjustment orientation relative to the scene anchor. */
type TerrainTransitionDirection =
  | "viewer-block"
  | "north"
  | "northeast"
  | "east"
  | "southeast"
  | "south"
  | "southwest"
  | "west"
  | "northwest";

interface TerrainPcodeField {
  readonly stride: TerrainMeshStride;
  /** Canonical row-major 32-bit pcodes, one per generated cell/quad. */
  readonly cellPcodes: Uint32Array;
}

/** LOD and edge adjustment selected from scene-anchor-relative policy. */
interface TerrainVariant {
  readonly stride: TerrainMeshStride;
  readonly transitionDirection: TerrainTransitionDirection;
}

/** Indexed slice containing one variant in concatenated terrain geometry. */
interface TerrainVariantDrawRange {
  readonly variant: TerrainVariant;
  readonly indexStart: number;
  readonly indexCount: number;
  readonly bounds: AABB3;
}

interface TerrainGenerationResult {
  readonly geometry: TerrainGeometryData;
  readonly variants: readonly TerrainVariantDrawRange[];
  readonly surfaceFields: readonly TerrainPcodeField[];
}

interface TerrainSourceInstallation {
  readonly landblockId: LandblockId;
  readonly generation: TerrainGenerationSource;
  readonly presentation: TerrainPresentationSource;
}

interface RealizedTerrainResources {
  readonly variants: readonly TerrainVariantDrawRange[];
}

interface TerrainDrawUnit {
  readonly landblockId: LandblockId;
  readonly geometry: TerrainGeometryKey;
  readonly indexStart: number;
  readonly indexCount: number;
  readonly surfaceField: TerrainSurfaceTextureKey;
  readonly textures: TerrainTextureKeys;
  readonly composition: TerrainCompositionTextureKey;
}

interface TerrainGenerator {
  /** Generates every required variant without consulting neighboring landblocks. */
  generate(source: TerrainGenerationSource): Promise<TerrainGenerationResult>;
}

interface TerrainSystem {
  /** Installs a missing source and its stable scene root before returning. */
  install(
    ownerId: RuntimeLayerOwnerId,
    artifact: TerrainSystemArtifact,
  ): SceneNodeId;
  removeOwner(ownerId: RuntimeLayerOwnerId): void;
  getDrawUnit(
    nodeId: SceneNodeId,
    anchorLandblockId: LandblockId,
  ): TerrainDrawUnit | null;
  destroy(): Promise<void>;
}
```

Array keys identify complete ordered arrays. Member DAT assets are not independent `TextureKey`s and
are not leased separately. Standalone keys identify complete unpacked textures. Sampler policy is a
draw-time choice and is not part of either key.

`TerrainGeometryKey`, `TerrainSurfaceTextureKey`, and `TerrainCompositionTextureKey` are stable
logical identities. `GeometryManager` and `TextureManager` map them to device resources; they do not
prescribe whether a backend uses an integer texture, buffer, or another representation. The exact
fields and `R32UI`/`RGBA32UI` packing are now proven in the implementation.

The generator concatenates every variant's compatible terrain attributes and rebases its indices by
the variant's vertex offset. Each `TerrainVariantDrawRange` names the resulting index slice. This
requires no new renderer mechanism: WebGL2 submission already accepts `indexStart` and `indexCount`,
and rebasing avoids relying on a base-vertex draw operation.

`install` records the source and scene root synchronously, starts tracked asynchronous generation internally,
and returns no completion signal. `TerrainSystem` catches terminal generation or realization
failure, reports it once, and records the failed state. Runtime receives no resource-completion events.
Repeated calls for an existing installation are no-ops and submit no additional job.

### Runtime State Vocabulary

- **Interested layer:** requested by `SceneInterestMap`.
- **Installed terrain source:** canonical landblock facts retained by `TerrainSystem`.
- **Resident texture:** logical regional texture currently device-backed and leased.
- **Generated terrain result:** complete CPU output returned by the terrain generator.
- **Realized terrain resources:** complete device-backed geometry and surface keys retained for one
  landblock.
- **Visible terrain node:** stable terrain root returned by `SceneGraph` visibility.
- **Drawable terrain:** visible terrain whose selected geometry, surface field, and regional textures
  resolve.

Do not use unqualified "resident landblock" where one of these states is intended.

## Target Flow

### Initial Terrain Commit

```text
landblock interest
    -> StandardCommitPipeline
         -> LandblockTerrainSource.loadTerrainSource(...)
         -> ResolvedTerrainLayerSource
              - canonical heights and terrain samples
              - source-proven composition facts
              - deterministic texture facts and keys
         -> source-only terrain CommitBundle
    -> GameRuntime stages terrain-layer installation
         -> lease required TextureKeys for the landblock owner
         -> start independent installation work concurrently:
              textures:
                  for each texture fact:
                      resident: reuse existing TextureManager binding
                      pending: join existing preparation by TextureKey
                      absent: TexturePreparer prepares pixels
                              TextureManager materializes the stable key
              terrain:
                  TerrainSystem.install(owner, terrain artifact)
                      loading/realized/failed entry already exists: no-op
                      absent entry: retain source and start one terrain-generation job
              scene:
                  create stable terrain SceneGraph root from source placement
                      + one fixed conservative terrain bound established from retail's
                        height table and worst-case transition adjustment
         -> independently reject stale texture completion or remove stale terrain/scene installation
```

The commit pipeline does not decode texture pixels, create texture arrays, generate terrain meshes,
or select an LOD. Repeated installation for an already-interested landblock keeps the existing
source and generation/realization state; terrain source has no revision or replacement workflow.

### Terrain Generation And Resource Realization

```text
TerrainSystem installs a previously absent source
    -> TerrainGenerator.generate(source)
         -> terrain-generator job
         -> generate all required stride/direction geometry variants
         -> concatenate compatible attributes and rebase variant indices
         -> record one indexed draw range per variant
         -> generate one per-cell surface field for each stride
         -> return one complete renderer-independent TerrainGenerationResult
    -> TerrainSystem rejects completion if its installation entry was removed
    -> TerrainSystem realizes the complete result through injected GeometryManager and TextureManager
         -> create one concatenated geometry resource and four generated-surface resources
         -> retain one geometry key, variant draw ranges, and one surface key per stride
         -> on partial failure: release every allocation created from this result
    -> TerrainSystem stores RealizedTerrainResources or marks the installation failed
```

Generation or realization failure is terminal for the current installation: log the error once,
mark the landblock non-drawable, and do not retry while interest remains. Removing interest clears
the failed installation; later reacquisition is a new installation. Late completion rejection uses
private operation or entry identity, not a terrain source revision.

The generation result and realized resources are immutable. LOD changes never submit worker work,
recommit terrain source, rematerialize regional textures, allocate device resources, or retire
resources. Generation occurs once during runtime terrain installation, not during commit, and
requires no neighborhood coordination.

### Drawing

```text
SceneGraph visibility query
    -> visible terrain root nodes / landblock ids
    -> RenderWorld asks TerrainSystem.getDrawUnit(nodeId, anchorLandblockId)
         -> derive retail stride + transition direction
         -> select an already-realized variant, or missing
    -> renderer collects one TerrainDrawUnit from its read-only RenderWorld
    -> renderer resolves resource identities:
         geometry key + index range -> selected variant in concatenated device geometry
         surface-field key -> selected stride surface field
         logical texture keys -> color/mask arrays + standalone detail texture
    -> absent realized resources: omit this landblock before frame input
    -> missing logical texture during loading: skip this landblock
    -> missing referenced geometry/surface resource: fail as an ownership invariant
    -> terrain program binds draw-time sampler policy
    -> vertex shader applies landblock-local transform and anchor-relative offset
    -> fragment shader performs terrain composition
```

`RenderWorld` resolves object occurrences as well as terrain contributions. It does not duplicate
realized terrain resources or selection state when `TerrainSystem` already owns both.

## Phased Implementation

### Phase 1: Resolve Lossless Terrain And Texture Facts

Goal: make host and resolution output sufficient for generation and deterministic texture residency
without decoded pixel payloads.

Primary targets:

- `apps/holtburger-3d/src/lib/assets/landblock-terrain-source.ts`
- `apps/holtburger-3d/src/lib/assets/texture-pixel-source.ts`
- `apps/holtburger-3d/src/lib/assets/decode-terrain-source.ts`
- `apps/holtburger-3d/src/lib/game/resolution/landblock-layer.ts`
- `apps/holtburger-3d/src/lib/game/textures/types.ts`

Tasks:

- Replace lossy terrain feature/index DTOs with canonical `9x9` heights, canonical `9x9` raw terrain
  samples, terrain material entries, mask selectors, road selectors, and landscape detail facts.
- Define resolved array and standalone texture facts carrying stable keys and source identities.
- Derive array keys deterministically from canonical region/purpose identity and preserve deterministic
  member ordering.
- Derive standalone detail identity from purpose and DAT source identity.
- Validate source lengths, required texture references, unique array members, and compatible purpose
  assignment.
- Keep decoded pixels, device formats, sampler policy, array-layer indices, and renderer resources out
  of resolved terrain contracts.
- Delete `TerrainMaterialSetKey`, `TerrainTextureSetKey`, and superseded material-set DTO fields.
- Add focused conversion and deterministic-key tests using inline fixtures.

Acceptance criteria:

- Two landblocks using the same regional facts resolve equal texture keys and ordered memberships.
- Resolution requires no texture pixel reads or device access.
- Road masks resolve as an array fact and landscape detail resolves as a standalone fact.
- Invalid or ambiguous source composition fails loudly.

Decisions and course corrections:

- Completed by the terrain-loading pipeline. The typed `HBTR` source carries canonical height
  indices, resolved heights, terrain samples, and lossless regional composition. Texture facts are
  derived in frontend terrain code; no pixel reads occur during commit preparation.

### Phase 2: Make Terrain Commit Strictly Source-Only

Goal: remove texture materialization and recurring terrain work from `StandardCommitPipeline`.

Primary targets:

- `apps/holtburger-3d/src/lib/game/commit/types.ts`
- `apps/holtburger-3d/src/lib/game/commit/pipeline.ts`
- commit-pipeline tests

Tasks:

- Make the terrain commit contain canonical generation source and resolved texture facts.
- Remove `TerrainTextureSetCommit`, `PreparedTerrainTextureSet`, and pipeline-owned terrain texture
  preparation.
- Remove terrain material-set preparation maps and `WorkerTexturePreparer` ownership from the commit
  pipeline.
- Keep static atlas planning, static baking, and static page preparation as separate pipeline work;
  this terrain correction must not force static resources into the same loading model.
- Keep standard static-bake and texture-page workers private to `StandardCommitPipeline`; expose only
  commit preparation and ordered destruction through its public boundary.
- Ensure terrain commit construction remains synchronous after host resolution.
- Keep anchor, LOD policy, generated resources, decoded pixels, and device resources out of commits.

Acceptance criteria:

- A terrain commit returns immediately after canonical host resolution and structural validation.
- Repository search finds no terrain pixel preparation or mesh generation under `game/commit`.
- Static commit behavior remains independently shaped.

Decisions and course corrections:

- Completed by the terrain-loading pipeline. `StandardCommitPipeline` obtains one
  `ResolvedTerrainLayerSource` through `LandblockTerrainSource` and produces a source-only terrain
  commit. The old generic bridge and `resolve_landblock_layer` route were deleted.

### Steering Checkpoint A: Dry-Run Runtime Installation

Before implementing runtime residency, dry-run concurrent interest for neighboring landblocks sharing
all regional arrays and detail, eviction while preparation is pending, one preparation failure, and
later reload after complete eviction. Refine the next phase if the proposed ownership cannot express
those cases with independent texture and terrain installation state.

### Phase 3: Move Texture Preparation And Residency Into Runtime

Goal: materialize stable texture facts exactly when runtime residency requires them.

Primary targets:

- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
- `apps/holtburger-3d/src/lib/game/runtime/ownership.ts`
- `apps/holtburger-3d/src/lib/game/textures/texture-preparer.ts`
- `apps/holtburger-3d/src/lib/game/textures/texture-manager.ts`
- focused residency and texture-manager tests

Tasks:

- Generalize `TexturePreparer` from whole terrain sets to one discriminated array or standalone
  texture fact.
- Have the worker request normalized surfaces through `TexturePixelSource` and return a complete pixel-bearing
  source matching the requested stable key.
- Track pending preparation by `TextureKey` so concurrent landblocks join one job.
- Add a narrow `TextureManager` residency query and keep complete-resource creation idempotent.
- Lease the four terrain texture keys directly from each interested terrain-layer owner.
- Start terrain source installation and texture preparation concurrently without blocking runtime
  ticks; terrain generation must not wait for decoded or uploaded regional textures.
- On stale interest, release the owner's leases, discard texture completion, and remove the terrain
  installation independently.
- On failure, roll back that owner's leases, release newly unowned resources, and surface the error.
- Keep texture failure terminal for that interested layer without removing successfully generated
  terrain resources; drawing remains suppressed until eviction because required textures are absent.
- Destroy runtime-owned texture workers during `GameRuntime.destroy()`, not commit-pipeline teardown.

Acceptance criteria:

- Concurrent landblocks sharing a texture key trigger one preparation and one device materialization.
- Terrain generation can complete while its regional textures are still preparing.
- An already resident key performs no CPU preparation or device upload.
- Eviction and failure leave no ownerless committed texture resources.
- Reload after full eviction prepares the texture again without stale-cache poisoning.
- No aggregate terrain texture-set registry or lease exists.

Decisions and course corrections:

- The terrain-loading pipeline completed the typed texture boundary and the residency lifecycle
  proof. `TauriTexturePixelSource` consumes `HBTP`; `WorkerTexturePreparer` validates stable keys
  and semantic purposes; `ContentAssetRuntime` and the preparer coalesce in-flight work. Focused
  tests prove same-region color/blend/road/detail identities, final-owner withdrawal while pixels
  are pending, and late terrain-commit rejection after scene-interest eviction.
- Failure classification remains deliberately narrow: the host currently supplies no typed
  retryability code, so a failed texture is terminal for the current installation and retried only
  after eviction/reacquisition. Do not manufacture retry classes from error strings; add a typed
  host failure contract when a transient source exists to justify it.
- `TextureManager.retain` now rolls back only the logical keys newly leased by that retain call.
  Terrain reserves generated pcode/composition keys before asynchronously retaining regional asset
  facts, so dropping the complete owner after an asset failure would incorrectly evict valid
  generated resources. A focused regression proves that an asset failure leaves independently
  reserved terrain pcode resources resident until explicit owner eviction.

### Phase 4: Implement Renderer-Independent Terrain Generation

Goal: define renderer-independent generation input and one complete immutable landblock result.

Primary targets:

- a terrain generator module under `apps/holtburger-3d/src/lib/game/terrain`
- reusable worker infrastructure only where proven necessary
- `apps/holtburger-3d/src/lib/game/renderer/geometry.ts`

Tasks:

- [x] Define `TerrainGenerator` from one immutable canonical source to one complete
      `TerrainGenerationResult`.
- [x] Keep the generation job strictly landblock-local: do not include neighbor sources, neighbor geometry,
      neighbor LODs, scene anchor, or scene-interest state.
- [x] Define the four source-grid strides and source-proven transition directions without introducing a
      source revision or generation identity.
- [x] Let the service's pending operation associate a result with its landblock; do not echo
      `LandblockId` or other correlation metadata through `TerrainGenerationResult`.
- [x] Add the runtime-owned `InlineTerrainGenerator`; retain the `TerrainGenerator` protocol for a
      measured future worker migration rather than carrying a fake worker adapter.
- [x] Decide not to introduce worker queueing or transfer primitives until profiling establishes a
      scheduling need; the current inline generator is the truthful implementation for the fixed
      9×9 input and retains the same future migration seam.
- [x] Define the pure generator entry point, validate canonical source buffers, and fail loudly for
      malformed source data.
- [x] Require `TerrainGenerationResult` to contain one concatenated `TerrainGeometryData`, one indexed
      draw range for every required stride/direction variant, and exactly one renderer-neutral,
      per-generated-cell surface field for each stride.
- [x] Concatenate compatible vertex attributes in the generator, rebase every variant's indices by its
      vertex offset, and validate non-overlapping in-bounds draw ranges.
- [x] Encode surface-field sharing by stride rather than duplicating it into directional variants.
- [x] Keep `TextureKey`s only where composition source identity requires them; keep device resources and
      backend array-layer indices out of worker contracts.
- [x] Omit temporary per-vertex feature slots. Retain normalized grid coordinates because the shader
      needs a stable generated-cell lookup domain; texture tiling remains a composition/shader concern.
- [x] Defer structured-clone input and transferred output buffers until a measured worker migration
      is introduced; no fake worker transport is retained in the current architecture.

Acceptance criteria:

- A code tour reaches the runtime-owned `InlineTerrainGenerator` from `TerrainSystem` without
  entering `StandardCommitPipeline` or its static baker.
- One typed job output represents all variants through one geometry payload, indexed draw ranges,
  and per-stride surface fields.
- A generator fake can produce a complete result from that landblock's source alone; no
  neighborhood setup is required.
- Anchor changes cannot submit terrain worker work.
- Runtime destruction stops the terrain generator; pipeline destruction does not affect it.

Decisions and course corrections:

- `InlineTerrainGenerator` is complete for canonical-grid subsampling, deterministic topology,
  pcode construction, normals, edge averaging, and retail's cardinal 4×4-cell lowering clamps. A
  worker migration remains conditional on profiling rather than a correctness prerequisite.

### Phase 5: Make TerrainSystem The Generated Resource Owner

Goal: make terrain installation idempotent and give one subsystem complete generated-resource
ownership.

Primary targets:

- `apps/holtburger-3d/src/lib/game/terrain/terrain-system.ts`
- focused terrain-system tests
- existing landblock-coordinate helpers

Tasks:

- [x] Constructor-inject `TerrainGenerator`, `GeometryManager`, and `TextureManager` into
      `TerrainSystem` in both production and tests. `GameRuntime` owns the generator lifecycle;
      `TerrainSystem` owns only the allocation keys it leases through those injected managers.
- [x] Store one installation entry per landblock: immutable source, direct `TerrainTextureKeys`, loading,
      realized, or failed state, and `RealizedTerrainResources` when available.
- [x] Make repeated installation for an existing interested landblock a no-op. Do not add source
      replacement, revision, or in-place update semantics.
- [x] Reject late completion after removal by comparing private operation/entry identity.
- [x] Realize a returned `TerrainGenerationResult` atomically through the injected geometry and texture
      managers: retain no `RealizedTerrainResources` until the concatenated geometry key and every
      per-stride surface key exist.
- [x] Realize the complete concatenated geometry and all four surface fields during installation. Do not
      add lazy per-variant or per-stride device upload.
- [x] On generation or realization failure, release partial allocations, log once, mark the entry failed,
      and perform no retry while that installation remains.
- [x] Derive retail stride and transition direction only inside
      `getDrawUnit(nodeId, anchorLandblockId)` and select an existing realized variant.
- [x] On removal, discard pending completion and release `RealizedTerrainResources` exactly once.

Acceptance criteria:

- Moving the scene anchor across an LOD boundary keeps the geometry key stable and selects a
  different index range plus the corresponding existing surface key without worker or device work.
- Direction changes at one stride select a different index range while retaining the same geometry
  and surface keys.
- Every policy-selectable variant is drawable immediately after realization without further device
  allocation.
- Failed installation remains non-drawable and submits no retry until removal/reacquisition.
- `getDrawUnit` returns one complete geometry/range/surface selection or no draw resources.
- No realized terrain resources or selected draw pair are duplicated in a runtime render registry.

Decisions and course corrections:

- `TerrainSystem` owns the stable terrain scene root as well as installation state, but receives
  `SceneGraph`, geometry, and texture managers by injection rather than becoming a renderer-specific
  service.
- A realization failure now drops the complete source owner before marking the installation failed.
  This releases an already-created geometry and composition/surface resources instead of retaining a
  partial realization until later eviction. A focused synthetic surface-upload failure proves it.
- This complete-source rollback applies only to generation/realization failure. Texture preparation
  is independent: its failure removes the failed asset-fact leases while retaining already-generated
  terrain resources, so the layer remains non-drawable but does not lose valid generation work.

### Steering Checkpoint B: Dry-Run Resource Lifecycle And Drawing

Dry-run first installation, duplicate installation, partial resource realization, terminal failure,
removal during generation, reacquisition after failure, anchor movement across every stride ring and
direction, and visibility before/after realization. Confirm that incomplete realization never enters
frame input and that anchor movement performs selection only.

### Phase 6: Connect Stable Terrain Nodes And Device Resource Storage

Goal: connect terrain installation to stable spatial state while keeping generated resource lifetime
inside `TerrainSystem`.

Primary targets:

- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
- `apps/holtburger-3d/src/lib/game/scene/scene-graph.ts`
- `apps/holtburger-3d/src/lib/game/renderer/resource-manager.ts`
- runtime ownership tests

Tasks:

- [x] Maintain one stable terrain root node per installed source and a narrow node-to-landblock index for
      visible terrain roots.
- [x] Derive the root's placement synchronously. Establish one fixed conservative terrain bound from the
      proven landblock horizontal extent, retail height table, and worst-case transition adjustment; do
      not duplicate transition mathematics per landblock merely to tighten initial culling bounds.
- [x] Keep scene-node creation/removal and texture leases in runtime; do not give `TerrainSystem` direct
      device access.
- [x] Add generated terrain-surface upload support to `TextureManager` without exposing its final
      WebGL2 representation to terrain generation.
- [x] Have `TerrainSystem` create one concatenated geometry resource plus one surface resource per
      stride, retain their keys only after complete realization, and release partial or installed
      allocations exactly once.
- [x] Reuse the established indexed draw-range submission model. Do not introduce a specialized terrain
      resource manager or a second draw-range registry.
- [x] Ensure `TerrainSystem`, not the renderer or runtime, owns every generated geometry and surface
      allocation key.
- [x] Remove terrain render-resource storage from `GameRuntime.#terrainRenderRecords`, `RenderResourceRegistry`,
      and `RenderScene` once service-owned resource lookup replaces it.
- [x] Define removal order: remove the scene root and leases, remove the system installation, discard
      pending work, and release its realized resources before device destruction.

Acceptance criteria:

- Source installation creates at most one scene root regardless of generation outcome.
- Partial or failed resource realization exposes no terrain draw resources.
- LOD selection causes no scene-node, texture-lease, worker, or device-resource churn.
- Terrain has one authoritative realized-resource record in `TerrainSystem`.
- No composite terrain-resource collection or specialized manager is required by the baseline.

Decisions and course corrections:

- Generated pcode fields use the general generated-texture path with `R32UI`, rather than a
  terrain-specific device manager. The composition table follows the same owner/lease path as
  `RGBA32UI`; both formats remain backend details.
- `TERRAIN_ROOT_BOUNDS` is one fixed conservative local bound. It keeps scene culling independent of
  directional-variant generation and preserves the stable root invariant.

### Phase 7: Assemble Terrain Draw Inputs From Visibility

Goal: make frame assembly follow the direct visible-landblock-to-service-query flow.

Primary targets:

- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
- `apps/holtburger-3d/src/lib/game/renderer/renderer.ts`
- `apps/holtburger-3d/src/lib/game/renderer/render-world.ts`
- frame-assembly tests

Tasks:

- [x] Identify visible terrain roots from the `SceneGraph` visibility result without adding render
      semantics to `SceneGraph`.
- [x] Resolve each visible terrain root through
      `TerrainSystem.getDrawUnit(nodeId, anchorLandblockId)`.
- [x] Pass only anchor and camera state to `FrameInput`; let the renderer's read-only `RenderWorld`
      collect visible contributions. This keeps frontend frame input free of resource authority.
- [x] Keep object occurrence resolution in `RenderWorld`; no terrain-specific records or frame
      instances remain in a `RenderScene` registry.
- [x] Treat an installed source without a complete realized resource set as intentionally non-drawable.
- [x] Omit loading, failed, and texture-incomplete installations from renderer contributions.
- [x] Suppress a terrain draw before renderer submission while regional texture preparation is pending.
      This is simpler and safer than carrying an unresolved logical texture key into `FrameInput`.

Acceptance criteria:

- The renderer obtains at most one complete draw unit per visible terrain root, with realized geometry,
  surface, and texture resources.
- Frame rendering performs no texture preparation, generation, or device allocation.
- Repeated rendering at different anchors keeps the geometry key stable and changes only the selected
  index range and, across stride boundaries, the surface key.
- No terrain draw record is mirrored between `TerrainSystem` and `RenderWorld`.

Decisions and course corrections:

- The plan's original preassembled `FrameInput` model was removed. `RenderWorld` is an injected,
  read-only façade; its renderer-owned visibility collection does not duplicate runtime ownership or
  turn `SceneGraph` into a render model.
- Earlier prose allowed unresolved texture keys to reach a draw. The implemented contract is tighter:
  `TerrainSystem.#hasDrawUnit` requires every complete resource. This avoids partial texture binding
  and makes a loading landblock non-drawable until its regional assets are resident.

### Phase 8: Bind And Compose Terrain In WebGL2

Goal: compose one selected terrain draw directly from source-proven GPU resources.

Primary targets:

- `apps/holtburger-3d/src/lib/game/renderer/resource-manager.ts`
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-resource-manager.ts`
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
- a focused terrain-program boundary

Tasks:

- [x] Resolve the stable `TerrainGeometryKey` and selected `TerrainSurfaceTextureKey` through the
      existing geometry and texture managers, then submit the selected `indexStart`/`indexCount` range.
- [x] Resolve color, blend-mask, and road-mask `TextureArrayKey`s plus standalone detail key through
      `TextureManager`.
- [x] Define terrain-program input containing resolved resources, landblock-local placement,
      anchor-relative offset, and view/frame state.
- [x] Define draw-time sampler policy independently from texture identity and storage.
- [x] Keep array UVs layer-local and keep atlas placement out of terrain contracts.
- [x] Show that generated surface selection is separate from regional source texture arrays.
- [x] Define a WebGL2 terrain program that interprets the generated `R32UI` field and regional
      `RGBA32UI` composition table, including source-proven terrain and road merge rules.
- [x] Remove the temporary flat-color terrain path when the new boundary is connected.
- [x] Run the program in a headless WebGL2 harness against the real content host and capture a
      textured road/detail terrain frame.
- [x] Hand representative textured, multi-terrain, road, and detail comparison against
      legacy/ACViewer to the user as a separate visual-parity review, not an implementation gate.

Acceptance criteria:

- A code tour reaches geometry and surface resolution from one `TerrainDrawUnit` record.
- Terrain drawing uses the selected range rather than submitting the complete concatenated index
  buffer.
- Incomplete realization cannot produce `TerrainDrawUnit`; unexpectedly missing backend resources
  fail loudly as an ownership invariant.
- No composite terrain product key or product registry exists.
- No logical texture key contains sampler policy or generated terrain allocation identity.
- No terrain backend contract contains atlas placement.
- The renderer cannot silently draw a flat-color terrain approximation.

Decisions and course corrections:

- The compact integer textures are the chosen GPU representation: `R32UI` for one stride's
  generated cell pcodes and `RGBA32UI` for the shared regional table. This remains renderer-local;
  content exposes source facts, not WebGL packing.
- Texture-array and standalone-texture filtering is configured at resource allocation, not encoded
  in a logical key. Normalized one-level masks require explicit non-mipmapped filtering to be
  complete in WebGL2.
- The shader source is validated with a desktop GLSL ES validator, and the new headless harness now
  proves a real browser canvas. Reference-application comparison remains useful user-owned
  visual-parity evidence, rather than an acceptance criterion for this implementation plan.

### Phase 9: Cleanup And Architectural Verification

Goal: leave one direct terrain architecture with no superseded aggregate or duplicated resource
model.

Tasks:

- [x] Delete `TerrainMaterialSetKey`, `TerrainTextureSetKey`, aggregate set commits, aggregate leases, and
      whole-set texture-preparer jobs.
- [x] Delete terrain-specific records from `RenderResourceRegistry` and `RenderScene` after the
      service-owned resource path replaces them.
- [x] Delete temporary feature/index models, per-vertex feature slots, material patches, terrain draw
      units, and flat-color terrain code.
- [x] Audit names so commit, texture preparation, terrain generation, realization, selection, and drawing
      remain distinct operations.
- [x] Audit every new type and unintuitive transition for concise ownership comments.
- [x] Rewrite tests that preserve superseded architecture instead of adding compatibility behavior.
- [x] Run focused tests, TypeScript checks, lint, dead-code checks, and formatting; record unrelated
      repository-wide failures separately rather than attributing them to this terrain slice.
- [x] Update this plan with implementation course corrections and remaining proven mechanics.

Acceptance criteria:

- Repository search finds no aggregate terrain material/texture-set identity.
- Terrain texture preparation is owned by runtime residency, not the commit pipeline.
- Terrain draw lookup has one authority and no mirrored terrain resource record.
- Known architecture is represented by code shapes and call sites, not only prose.
- Unimplemented mechanics fail at narrow boundaries.

Decisions and course corrections:

- Search confirms that the aggregate terrain-set identities, `RenderScene`,
  `RenderResourceRegistry`, and `WorkerTerrainGenerator` no longer exist in the 3D source tree.
  Terrain rendering now has one `TerrainSystem`/`RenderWorld` path.
- The original target-shape prose had plan-era service/resource placeholders. It now names the
  implemented `TerrainSystem`, its `TerrainDrawUnit`, and the injected read-only `RenderWorld`; this
  clean cutover avoids keeping aliases merely to preserve draft terminology.
- Full focused tests, shader validation, production build, terrain-slice lint, and frontend type
  checking pass. The global lint command remains blocked only by the unrelated
  `commit/pipeline.ts` and `texture-manager.test.ts` findings recorded above.

## Risks And Mitigations

- **Stable keys hide conflicting facts.** Validate that an existing key has the same purpose, ordered
  source membership, dimensions after preparation, and immutable content identity; throw on conflict.
- **Runtime texture loading becomes a second pipeline.** Keep it narrow: fact-to-prepared-source,
  in-flight coalescing, idempotent materialization, and leases. Do not duplicate layer resolution or
  static baking.
- **Generic worker reuse conflates lifecycle domains.** Share worker infrastructure only. Keep
  commit-time static baking, runtime texture preparation, and one-shot terrain generation in
  separate owner-scoped worker pools and protocols.
- **Pending installation outlives interest.** Associate every asynchronous terrain install with the
  current landblock-layer owner and private installation-entry identity; roll back texture leases and
  generated allocations on stale completion.
- **TerrainSystem becomes WebGL-specific.** Inject backend-neutral geometry and texture managers.
  Keep WebGL handles, formats, and surface packing out of the system and generator contracts while
  allowing the system to own allocation lifetime.
- **Resource realization partially succeeds.** Make system realization transactional: release every
  geometry and surface allocation created before failure, retain no realized-resource record, log
  once, and mark the installation failed.
- **Prebuilding directional geometry wastes memory.** The source-proven result is bounded: 36 variants
  and 765 total quads before backend representation. Measure during real implementation;
  deduplicate or repack storage only if profiling proves the straightforward concatenated geometry
  material. Preserve complete upfront realization and allocation-free variant selection.
- **Concatenated variant indices address the wrong vertices.** Rebase each variant's indices by its
  concatenated vertex offset, select `u16` or `u32` after concatenation, and validate every stored
  draw range against the final index buffer.
- **Authored landblock boundaries disagree.** Retail generation cannot repair source disagreement
  because it never reads neighbors. Add focused DAT investigation over representative adjacent
  landblocks before treating compatible shared-edge heights as a validated source invariant.
- **A future LOD policy permits arbitrary neighbor combinations.** The retail direction variants are
  valid for its concentric Chebyshev rings. A policy allowing unrelated per-edge LOD differences
  requires separately proven edge-mask variants or another stitching strategy; do not silently
  stretch `TerrainTransitionDirection` into that model.
- **Geometry and surface fields become mismatched.** Return draw resources only after selecting an
  existing draw range in the stable geometry key and its stride's existing surface key; never expose
  a partial selection.
- **Logical texture and generated device identities collapse together.** Keep deterministic
  asset/array texture keys separate from generated `TerrainGeometryKey`,
  `TerrainSurfaceTextureKey`, `TerrainCompositionTextureKey`, and opaque WebGL handles.
- **Array-layer indices leak into generation.** Preserve DAT or composition identities until backend
  realization resolves them against texture bindings.
- **Shared detail texture is released too early.** Use the existing global texture lease registry;
  every landblock owner leases each required logical key directly.
- **Renderer defaults reintroduce sampler identity.** Explicitly configure normalized texture
  filtering and wrap at allocation; never encode those policies into standalone or array keys.
- **GPU source fails only at runtime.** Keep shader creation fail-loud and require a real WebGL2
  Explorer run before claiming visual correctness.

## Verification

Run from `apps/holtburger-3d`:

```bash
npm run test:ts
npm run check:terrain-shader
npm run harness:browser -- --landblock 0xda55ffff --screenshot /tmp/holtburger-3d-da55-terrain.png
npm run check
npm run lint
npm run format:check
```

Rust host checks for the terrain source/pixel producer are covered by the terrain-loading pipeline.
This plan now has a drawable terrain backend; existing unrelated failures and outstanding live-WebGL
validation must be reported rather than hidden.

## Definition Of Done

- Terrain resolution preserves every source-proven composition fact and emits deterministic array
  and standalone texture facts.
- Terrain commits contain no decoded texture pixels, generated resources, anchor, or LOD policy.
- Runtime coalesces texture preparation by stable `TextureKey`, materializes only missing resources,
  and owns direct landblock-to-texture leases.
- No aggregate terrain material or texture-set key remains.
- `TerrainGenerator` runs from a runtime-owned executor and emits one concatenated geometry,
  validated draw ranges for all required variants, and one per-cell surface field per stride without
  entering the static baker.
- `TerrainSystem` installs each immutable source once, realizes all generated resources, owns their
  device allocations, and exposes no draw resources for loading or failed installations.
- Scene-anchor-relative LOD selection chooses an existing variant and performs no generation,
  allocation, replacement, or scene-node mutation.
- Runtime creates one stable terrain scene root from source facts and does not mediate terrain
  realization or duplicate realized-resource ownership.
- Frame assembly queries visible landblocks from `TerrainSystem` through `RenderWorld` and passes selected resource keys,
  indexed draw ranges, and logical texture keys to the renderer.
- Renderer resolves the stable geometry key and selected surface key, submits only the selected
  index range, resolves logical texture keys, explicitly configures normalized texture sampling,
  and composes terrain from the pcode and regional lookup textures.
- Obsolete aggregate sets, terrain render-scene records, material patches, draw units, feature slots,
  and flat-color terrain paths are removed.
- Focused tests validate deterministic resolution, texture residency, complete terrain generation,
  atomic realization rollback, duplicate installation, terminal failure, anchor-based selection,
  visibility-to-frame assembly, removal during generation, reacquisition, and eviction.
- A real browser harness run proves shader linkage and representative source composition before the
  code claims it can render textured terrain. Legacy/ACViewer captures remain user-owned evidence
  for any separate visual-parity claim.

## Remaining Mechanical Decisions

The first binding layout is intentionally narrow: one `R32UI` pcode field selected by stride, one
regional `RGBA32UI` table, three normalized texture arrays, and one normalized detail texture.
Only user-led visual-parity review, lighting, and future performance evidence can justify changing
that layout.
