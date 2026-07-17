# Holtburger 3D Shader-Composited Terrain Architecture Plan

Status: Draft steered around resolver-authored texture facts, immutable prebuilt terrain resources,
and service-owned terrain device resources. Existing terrain and texture stubs partially reflect
superseded recurrent-generation and aggregate-texture architecture and require a clean cutover.

## Context And Boundaries

### Goal

Encode a direct terrain flow in which resolution determines stable logical texture identities,
runtime materializes and leases those textures, `TerrainService` generates and realizes every
required LOD resource once per interested landblock, and drawing selects an already-realized variant
from the scene anchor.

This plan applies to `apps/holtburger-3d/src/lib/game`. It defines architecture through minimal,
type-safe shapes, state transitions, and call sites. It does not claim that terrain rendering is
functional.

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
- Make `TerrainService` own generated terrain device allocations and answer query-time draw-resource
  selection for each landblock.
- Let runtime bridge terrain source installation to one stable `SceneGraph` root without mediating
  generated-resource realization.
- Make frame assembly query visible landblocks from `TerrainService` instead of duplicating terrain
  resources in `RenderScene` and `RenderResourceRegistry`.
- Stub the WebGL2 terrain draw boundary with logical resource resolution and draw-time sampler
  policy, while leaving unproven shader mechanics unimplemented.

### Out Of Scope

- A runnable end-to-end terrain path.
- Real Rust-host terrain composition resolution.
- Porting the legacy worker pool or transport.
- Implementing retail terrain vertex generation, transition adjustment, normals, or indices.
- Choosing the final GPU representation of the per-generated-cell surface field and composition
  records.
- Implementing the terrain GLSL program.
- Final lighting, shadows, atmosphere, effects, or visual parity.
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
- **Give terrain one authoritative resource owner.** `TerrainService` owns CPU generation state,
  generated device allocations, failure state, and query-time variant selection. Do not mirror
  that state in runtime render registries.
- **Keep scene topology stable.** Runtime creates one terrain root from immutable source placement and
  bounds. LOD selection does not create, replace, or resize scene nodes.
- **Let the device own its backend manager.** Terrain and texture systems own the allocations they
  create through the device-owned resource manager. The renderer only borrows resolved backend
  resources while drawing.
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
    -> AssetBridge
    -> StandardCommitPipeline
         -> StaticBakeWorkerPool
         -> TexturePageBuildWorkerPool
    -> GameRuntime (borrows CommitPipeline)
         -> TexturePreparer
              -> TexturePreparationWorkerPool
         -> TerrainService
              -> device-owned RendererResourceManager
         -> WorkerTerrainGenerator
              -> TerrainGenerationWorkerPool
    -> WebGL2Device
         -> RendererResourceManager
         -> Renderer (borrows resources while drawing)
```

Ownership rules:

- The frontend constructs and destroys its `CommitPipeline`.
- `GameRuntime` borrows the `CommitPipeline` interface, may request commits, and never destroys it.
- `StandardCommitPipeline` privately constructs and destroys commit-time static-bake and texture-page
  workers. Alternative pipeline implementations may use different internals.
- `GameRuntime` privately constructs and destroys runtime texture-preparation workers and its
  `TerrainService`. It also constructs and destroys the `WorkerTerrainGenerator` injected into that
  service. `TerrainService` owns every generated terrain allocation key it creates through the
  injected device resource boundary, but it does not own either injected collaborator.
- The frontend owns the shared `AssetBridge` and supplies it to pipeline/runtime construction where
  host-backed work requires it.
- Tests inject fake pipeline, texture-preparer, terrain-generator, and renderer-resource-manager
  ports through the same constructors used by production.
- Worker pools do not own scene interest, texture leases, terrain source state, or device resources.
  They execute typed jobs and return owned transferable CPU output.

Worker responsibilities remain separate even when they reuse generic queue, transfer, service-channel,
and disposal primitives:

- Static-bake and texture-page workers execute during commit preparation and are pipeline-owned.
- Texture-preparation workers execute after terrain commit when runtime residency requires a missing
  texture. They may request prepared DAT surfaces through the `AssetBridge` service channel.
- Terrain-generation workers execute once for each newly installed landblock source and produce one
  complete immutable generation result. Scene-anchor movement never submits terrain-generation work.
  The committed source input is sufficient, so workers do not request host assets.
- Terrain generation is not a static bake job and does not run in the static baker worker pool.

Ordered teardown is part of the ownership contract:

```text
stop frontend frame loop
    -> await GameRuntime.destroy()
         -> stop accepting new runtime work
         -> destroy TerrainService
              -> discard pending generation completions
              -> release every generated terrain allocation
         -> dispose terrain-generation workers
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

interface TerrainSurfaceField {
  readonly stride: TerrainMeshStride;
  /** Canonical row-major compositions, one per generated cell/quad. */
  readonly cells: readonly ResolvedTerrainComposition[];
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
  readonly surfaceFields: readonly TerrainSurfaceField[];
}

interface TerrainSourceInstallation {
  readonly source: TerrainGenerationSource;
  readonly textures: TerrainTextureKeys;
}

/** Opaque device identity for one uploaded generated surface field. */
type TerrainSurfaceResourceKey = `terrain-surface-resource:${number}`;

interface RendererResourceManager {
  createTerrainSurface(field: TerrainSurfaceField): TerrainSurfaceResourceKey;
  // Existing releaseResource accepts TerrainSurfaceResourceKey through RenderResourceKey.
}

interface RealizedTerrainResources {
  readonly geometry: GeometryResourceKey;
  readonly variants: readonly TerrainVariantDrawRange[];
  readonly surfaceFields: ReadonlyMap<
    TerrainMeshStride,
    TerrainSurfaceResourceKey
  >;
}

interface TerrainDrawResources {
  readonly geometry: GeometryResourceKey;
  readonly indexStart: number;
  readonly indexCount: number;
  readonly surfaceField: TerrainSurfaceResourceKey;
  readonly textures: TerrainTextureKeys;
}

interface TerrainGenerator {
  /** Generates every required variant without consulting neighboring landblocks. */
  generate(source: TerrainGenerationSource): Promise<TerrainGenerationResult>;
}

interface TerrainService {
  /** Retains a missing source and starts tracked generation before returning. */
  installSource(input: TerrainSourceInstallation): void;
  removeSource(landblockId: LandblockId): void;
  getDrawResources(
    landblockId: LandblockId,
    anchorLandblockId: LandblockId,
  ): TerrainDrawResources | null;
  destroy(): Promise<void>;
}
```

Array keys identify complete ordered arrays. Member DAT assets are not independent `TextureKey`s and
are not leased separately. Standalone keys identify complete unpacked textures. Sampler policy is a
draw-time choice and is not part of either key.

`TerrainSurfaceResourceKey` is an opaque device-resource identity alongside `GeometryResourceKey`.
It does not prescribe whether WebGL2 uses an integer texture, buffer, or another representation. The
exact fields of `TerrainGenerationSource`, `ResolvedTerrainComposition`, and the device packing of
`TerrainSurfaceField` must be proven before implementation; their ownership and the per-cell surface
cardinality are established.

The generator concatenates every variant's compatible terrain attributes and rebases its indices by
the variant's vertex offset. Each `TerrainVariantDrawRange` names the resulting index slice. This
requires no new renderer mechanism: WebGL2 submission already accepts `indexStart` and `indexCount`,
and rebasing avoids relying on a base-vertex draw operation.

`installSource` records the source synchronously, starts tracked asynchronous generation internally,
and returns no completion signal. `TerrainService` catches terminal generation or realization
failure, reports it once, and records the failed state. Runtime receives no resource-completion events.
Repeated calls for an existing installation are no-ops and submit no additional job.

### Runtime State Vocabulary

- **Interested layer:** requested by `SceneInterestMap`.
- **Installed terrain source:** canonical landblock facts retained by `TerrainService`.
- **Resident texture:** logical regional texture currently device-backed and leased.
- **Generated terrain result:** complete CPU output returned by the terrain worker.
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
         -> AssetBridge.resolveLandblockLayer(...)
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
                  TerrainService.installSource(..., TerrainTextureKeys)
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
TerrainService installs a previously absent source
    -> TerrainGenerator.generate(source)
         -> dedicated terrain-generation worker job
         -> generate all required stride/direction geometry variants
         -> concatenate compatible attributes and rebase variant indices
         -> record one indexed draw range per variant
         -> generate one per-cell surface field for each stride
         -> return one complete renderer-independent TerrainGenerationResult
    -> TerrainService rejects completion if its installation entry was removed
    -> TerrainService realizes the complete result through RendererResourceManager
         -> create one concatenated geometry resource and four generated-surface resources
         -> retain one geometry key, variant draw ranges, and one surface key per stride
         -> on partial failure: release every allocation created from this result
    -> TerrainService stores RealizedTerrainResources or marks the installation failed
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
    -> GameRuntime asks TerrainService.getDrawResources(landblockId, anchorLandblockId)
         -> derive retail stride + transition direction
         -> select an already-realized variant, or missing
    -> FrameInput contains placement + TerrainDrawResources
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

`RenderScene` may continue indexing object occurrences. It does not duplicate realized terrain
resources or selection state when `TerrainService` already owns both.

## Phased Implementation

### Phase 1: Resolve Lossless Terrain And Texture Facts

Goal: make host and resolution output sufficient for generation and deterministic texture residency
without decoded pixel payloads.

Primary targets:

- `apps/holtburger-3d/src/lib/assets/host-contracts.ts`
- `apps/holtburger-3d/src/lib/game/resolution/landblock-layer.ts`
- `apps/holtburger-3d/src/lib/game/resolution/resolve-landblock-layer.ts`
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

- Pending implementation.

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

- Pending implementation.

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
- Have the worker request prepared surfaces through `AssetBridge` and return a complete pixel-bearing
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

- Pending implementation.

### Phase 4: Encode The Dedicated Terrain Generator Worker

Goal: define renderer-independent generation input and one complete immutable landblock result.

Primary targets:

- a terrain generator module under `apps/holtburger-3d/src/lib/game/terrain`
- reusable worker infrastructure only where proven necessary
- `apps/holtburger-3d/src/lib/game/renderer/geometry.ts`

Tasks:

- Define `TerrainGenerator` from one immutable canonical source to one complete
  `TerrainGenerationResult`.
- Keep the worker job strictly landblock-local: do not include neighbor sources, neighbor geometry,
  neighbor LODs, scene anchor, or scene-interest state.
- Define the four source-grid strides and source-proven transition directions without introducing a
  source revision or generation identity.
- Let the service's pending operation associate a result with its landblock; do not echo
  `LandblockId` or other correlation metadata through `TerrainGenerationResult`.
- Add `WorkerTerrainGenerator` with a dedicated terrain-generation job protocol and worker
  pool constructed and destroyed by `GameRuntime`.
- Reuse generic worker queueing and transfer primitives without routing terrain jobs through the
  commit pipeline or static baker.
- Define the pure worker-side terrain entry point and fail loudly while the algorithm is absent.
- Require `TerrainGenerationResult` to contain one concatenated `TerrainGeometryData`, one indexed
  draw range for every required stride/direction variant, and exactly one renderer-neutral,
  per-generated-cell surface field for each stride.
- Concatenate compatible vertex attributes in the worker, rebase every variant's indices by its
  vertex offset, and validate non-overlapping in-bounds draw ranges.
- Encode surface-field sharing by stride rather than duplicating it into directional variants.
- Keep `TextureKey`s only where composition source identity requires them; keep device resources and
  backend array-layer indices out of worker contracts.
- Remove temporary per-vertex `featureSlots`; remove UVs unless source investigation proves they
  cannot be derived from landblock-local position.
- Structured-clone retained source input and transfer only worker-owned output buffers.

Acceptance criteria:

- A code tour reaches a dedicated terrain-generation worker from `TerrainService` without entering
  `StandardCommitPipeline` or its static baker.
- One typed job output represents all variants through one geometry payload, indexed draw ranges,
  and per-stride surface fields.
- A generator fake can produce a complete result from that landblock's source alone; no
  neighborhood setup is required.
- Anchor changes cannot submit terrain worker work.
- Runtime destruction terminates terrain-generation workers; pipeline destruction does not affect
  them.

Decisions and course corrections:

- Pending implementation.

### Phase 5: Make TerrainService The Generated Resource Owner

Goal: make terrain installation idempotent and give one subsystem complete generated-resource
ownership.

Primary targets:

- `apps/holtburger-3d/src/lib/game/terrain/terrain-service.ts`
- focused terrain-service tests
- existing landblock-coordinate helpers

Tasks:

- Constructor-inject `TerrainGenerator` and `RendererResourceManager` into `TerrainService` in both
  production and tests. `GameRuntime` owns the generator lifecycle; the device owns the resource
  manager; `TerrainService` owns only the allocation keys it creates through that manager.
- Store one installation entry per landblock: immutable source, direct `TerrainTextureKeys`, loading,
  realized, or failed state, and `RealizedTerrainResources` when available.
- Make repeated installation for an existing interested landblock a no-op. Do not add source
  replacement, revision, or in-place update semantics.
- Reject late completion after removal by comparing private operation/entry identity.
- Realize a returned `TerrainGenerationResult` atomically through `RendererResourceManager`: retain
  no `RealizedTerrainResources` until the concatenated geometry key and every per-stride surface key
  exist.
- Realize the complete concatenated geometry and all four surface fields during installation. Do not
  add lazy per-variant or per-stride device upload.
- On generation or realization failure, release partial allocations, log once, mark the entry failed,
  and perform no retry while that installation remains.
- Derive retail stride and transition direction only inside
  `getDrawResources(landblockId, anchorLandblockId)` and select an existing realized variant.
- On removal, discard pending completion and release `RealizedTerrainResources` exactly once.

Acceptance criteria:

- Moving the scene anchor across an LOD boundary keeps the geometry key stable and selects a
  different index range plus the corresponding existing surface key without worker or device work.
- Direction changes at one stride select a different index range while retaining the same geometry
  and surface keys.
- Every policy-selectable variant is drawable immediately after realization without further device
  allocation.
- Failed installation remains non-drawable and submits no retry until removal/reacquisition.
- `getDrawResources` returns one complete geometry/range/surface selection or no draw resources.
- No realized terrain resources or selected draw pair are duplicated in a runtime render registry.

Decisions and course corrections:

- Pending implementation.

### Steering Checkpoint B: Dry-Run Resource Lifecycle And Drawing

Dry-run first installation, duplicate installation, partial resource realization, terminal failure,
removal during generation, reacquisition after failure, anchor movement across every stride ring and
direction, and visibility before/after realization. Confirm that incomplete realization never enters
frame input and that anchor movement performs selection only.

### Phase 6: Connect Stable Terrain Nodes And Device Resource Storage

Goal: connect terrain installation to stable spatial state while keeping generated resource lifetime
inside `TerrainService`.

Primary targets:

- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
- `apps/holtburger-3d/src/lib/game/scene/scene-graph.ts`
- `apps/holtburger-3d/src/lib/game/renderer/resource-manager.ts`
- runtime ownership tests

Tasks:

- Maintain one stable terrain root node per installed source and a narrow node-to-landblock index for
  visible terrain roots.
- Derive the root's placement synchronously. Establish one fixed conservative terrain bound from the
  proven landblock horizontal extent, retail height table, and worst-case transition adjustment; do
  not duplicate transition mathematics per landblock merely to tighten initial culling bounds.
- Keep scene-node creation/removal and texture leases in runtime; do not give `TerrainService` access
  to `SceneGraph`.
- Add opaque terrain-surface create and release support to `RendererResourceManager` without choosing
  its final WebGL2 representation.
- Have `TerrainService` create one concatenated geometry resource plus one surface resource per
  stride, retain their keys only after complete realization, and release partial or installed
  allocations exactly once.
- Reuse the established indexed draw-range submission model. Do not introduce a specialized terrain
  resource manager or a second draw-range registry.
- Ensure `TerrainService`, not the renderer or runtime, owns every generated geometry and surface
  allocation key.
- Remove terrain render-resource storage from `GameRuntime.#terrainRenderRecords`, `RenderResourceRegistry`,
  and `RenderScene` once service-owned resource lookup replaces it.
- Define removal order: remove the scene root and leases, remove the service installation, discard
  pending work, and release its realized resources before device destruction.

Acceptance criteria:

- Source installation creates at most one scene root regardless of generation outcome.
- Partial or failed resource realization exposes no terrain draw resources.
- LOD selection causes no scene-node, texture-lease, worker, or device-resource churn.
- Terrain has one authoritative realized-resource record in `TerrainService`.
- No composite terrain-resource collection or specialized manager is required by the baseline.

Decisions and course corrections:

- Pending implementation.

### Phase 7: Assemble Terrain Draw Inputs From Visibility

Goal: make frame assembly follow the direct visible-landblock-to-service-query flow.

Primary targets:

- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
- `apps/holtburger-3d/src/lib/game/renderer/renderer.ts`
- `apps/holtburger-3d/src/lib/game/renderer/render-scene.ts`
- frame-assembly tests

Tasks:

- Identify visible terrain roots from the `SceneGraph` visibility result without adding render
  semantics to `SceneGraph`.
- Resolve each visible terrain landblock through
  `TerrainService.getDrawResources(landblockId, anchorLandblockId)`.
- Add placement plus complete `TerrainDrawResources` directly to `FrameInput`.
- Keep object occurrence resolution in `RenderScene`; remove only its terrain-specific records and
  frame instances.
- Treat an installed source without realized resources as intentionally non-drawable.
- Omit loading and failed installations from frame input; only complete realized variants are
  returned by the service.
- Allow frame input to carry unresolved logical texture keys while parallel texture preparation is
  pending; renderer texture resolution suppresses that landblock for the frame.

Acceptance criteria:

- Frame input contains exactly one record per visible terrain landblock with realized geometry and
  surface resources.
- Frame assembly performs no texture preparation, generation, or device allocation.
- Repeated frame assembly at different anchors keeps the geometry key stable and changes only the
  selected index range and, across stride boundaries, the surface key.
- No terrain draw record is mirrored between `TerrainService` and `RenderScene`.

Decisions and course corrections:

- Pending implementation.

### Phase 8: Stub Logical Resource Resolution And Terrain Drawing

Goal: make the final renderer handoff visible without guessing composition packing or GLSL.

Primary targets:

- `apps/holtburger-3d/src/lib/game/renderer/resource-manager.ts`
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-resource-manager.ts`
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
- a focused terrain-program boundary

Tasks:

- Resolve the stable `GeometryResourceKey` and selected `TerrainSurfaceResourceKey` through the
  existing device resource manager, then submit the selected `indexStart`/`indexCount` range.
- Resolve color, blend-mask, and road-mask `TextureArrayKey`s plus standalone detail key through
  `TextureManager`.
- Define terrain-program input containing resolved resources, landblock-local placement,
  anchor-relative offset, and view/frame state.
- Define draw-time sampler policy independently from texture identity and storage.
- Keep array UVs layer-local and keep atlas placement out of terrain contracts.
- Show that generated surface selection is separate from regional source texture arrays.
- Make unimplemented surface packing and terrain drawing fail precisely.
- Remove the temporary flat-color terrain path when the new boundary is connected.

Acceptance criteria:

- A code tour reaches geometry and surface resolution from one `TerrainDrawResources` record.
- Terrain drawing uses the selected range rather than submitting the complete concatenated index
  buffer.
- Incomplete realization cannot produce `TerrainDrawResources`; unexpectedly missing backend resources
  fail loudly as an ownership invariant.
- No composite terrain product key or product registry exists.
- No logical texture key contains sampler policy or generated terrain allocation identity.
- No terrain backend contract contains atlas placement.
- The renderer cannot silently draw a fake terrain approximation.

Decisions and course corrections:

- Pending implementation.

### Phase 9: Cleanup And Architectural Verification

Goal: leave one direct terrain architecture with no superseded aggregate or duplicated resource
model.

Tasks:

- Delete `TerrainMaterialSetKey`, `TerrainTextureSetKey`, aggregate set commits, aggregate leases, and
  whole-set texture-preparer jobs.
- Delete terrain-specific records from `RenderResourceRegistry` and `RenderScene` after the
  service-owned resource path replaces them.
- Delete temporary feature/index models, per-vertex feature slots, material patches, terrain draw
  units, and flat-color terrain code.
- Audit names so commit, texture preparation, terrain generation, realization, selection, and drawing
  remain distinct operations.
- Audit every new type and unintuitive transition for concise ownership comments.
- Rewrite tests that preserve superseded architecture instead of adding compatibility behavior.
- Run focused tests, TypeScript checks, lint, dead-code checks, and formatting.
- Update this plan with implementation course corrections and remaining proven mechanics.

Acceptance criteria:

- Repository search finds no aggregate terrain material/texture-set identity.
- Terrain texture preparation is owned by runtime residency, not the commit pipeline.
- Terrain draw lookup has one authority and no mirrored terrain resource record.
- Known architecture is represented by code shapes and call sites, not only prose.
- Unimplemented mechanics fail at narrow boundaries.

Decisions and course corrections:

- Pending implementation.

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
- **TerrainService becomes WebGL-specific.** Inject the backend-neutral `RendererResourceManager`
  interface. Keep WebGL handles, formats, and surface packing out of the service and worker contracts
  while allowing the service to own allocation lifetime.
- **Resource realization partially succeeds.** Make service realization transactional: release every
  geometry and surface allocation created before failure, retain no realized-resource record, log
  once, and mark the installation failed.
- **Prebuilding directional geometry wastes memory.** The source-proven result is small: 19 variants
  and roughly 229 total quads before backend representation. Measure during real implementation;
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
  `TextureKey`s separate from `GeometryResourceKey`, `TerrainSurfaceResourceKey`, and opaque WebGL
  handles.
- **Array-layer indices leak into generation.** Preserve DAT or composition identities until backend
  realization resolves them against texture bindings.
- **Shared detail texture is released too early.** Use the existing global texture lease registry;
  every landblock owner leases each required logical key directly.
- **Renderer defaults reintroduce sampler identity.** Bind explicit draw-time sampler objects when
  textured drawing is implemented; never encode wrap or filtering into standalone or array keys.
- **The plan drifts into full implementation.** Stop once shapes, ownership, state transitions, and
  focused tests are coherent. Pixel correctness and GLSL require a separate execution signal.

## Verification

Run from `apps/holtburger-3d`:

```bash
npm run test:ts
npm run check
npm run lint
npm run format:check
```

Rust host checks and visual browser verification are not completion criteria because this plan does
not implement the Rust producer or a drawable terrain backend. Existing unrelated failures must be
reported rather than hidden.

## Definition Of Done

- Terrain resolution preserves every source-proven composition fact and emits deterministic array
  and standalone texture facts.
- Terrain commits contain no decoded texture pixels, generated resources, anchor, or LOD policy.
- Runtime coalesces texture preparation by stable `TextureKey`, materializes only missing resources,
  and owns direct landblock-to-texture leases.
- No aggregate terrain material or texture-set key remains.
- `TerrainGenerator` reaches its dedicated runtime-owned worker and emits one concatenated geometry,
  validated draw ranges for all required variants, and one per-cell surface field per stride without
  entering the static baker.
- `TerrainService` installs each immutable source once, realizes all generated resources, owns their
  device allocations, and exposes no draw resources for loading or failed installations.
- Scene-anchor-relative LOD selection chooses an existing variant and performs no generation,
  allocation, replacement, or scene-node mutation.
- Runtime creates one stable terrain scene root from source facts and does not mediate terrain
  realization or duplicate realized-resource ownership.
- Frame assembly queries visible landblocks from `TerrainService` and passes selected resource keys,
  indexed draw ranges, and logical texture keys to the renderer.
- Renderer stubs resolve the stable geometry key and selected surface key, submit only the selected
  index range, resolve logical texture keys, and expose explicit draw-time sampler policy.
- Obsolete aggregate sets, terrain render-scene records, material patches, draw units, feature slots,
  and flat-color terrain paths are removed.
- Focused tests validate deterministic resolution, texture residency, complete terrain generation,
  atomic realization rollback, duplicate installation, terminal failure, anchor-based selection,
  visibility-to-frame assembly, removal during generation, reacquisition, and eviction.
- The code remains honest about unimplemented mechanics and does not claim to render terrain.

## Remaining Mechanical Decisions

The exact fields of one source-proven per-cell composition record, its GPU packing, and the GLSL
binding layout remain mechanical investigation. The architecture requires each geometry variant to
select its stride's surface resource, but does not yet require choosing between integer textures,
uniform buffers, or another proven WebGL2 representation.
