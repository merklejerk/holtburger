# Holtburger 3D Shader-Composited Terrain Architecture Plan

Status: Draft for review. No implementation phases have started.

## Context And Boundaries

### Goal

Encode the intended shader-composited terrain architecture in minimal, type-safe TypeScript shapes,
state transitions, and call sites without pretending the redesigned app is ready to render terrain.

This plan applies to the new runtime under `apps/holtburger-3d/src/lib/game`. The completed
[terrain rendering implementation plan](./holtburger-3d-terrain-rendering-implementation-plan.md)
describes the previous `world-display` architecture and remains historical context only.

### In Scope

- Replace lossy terrain presentation DTOs with source-proven composition shapes.
- Make `StandardCommitPipeline` produce reusable terrain source data and non-atlased source-texture
  artifacts without generating geometry or selecting an LOD.
- Represent anchor-driven, repeatedly generated terrain geometry through a
  `TerrainGeometryGenerator` port.
- Generate the terrain cell-composition field alongside geometry because retail recomputes surfaces
  from the sampled corners of each LOD cell.
- Show that terrain generation jobs execute through the one shared baker boundary.
- Implement and test `TerrainService` reconciliation, coalescing, and stale-result behavior with a
  fake generator.
- Make `GameRuntime` bridge terrain source lifetime, stable scene-node lifetime, and replaceable
  render-product lifetime.
- Replace material patches and per-vertex feature slots with logical shader-composition resource
  shapes.
- Stub WebGL2 resource and draw boundaries deeply enough that their intended inputs, outputs,
  ownership, and replacement flow are visible in code.
- Fail loudly at unimplemented mechanical boundaries.

### Out Of Scope

- A runnable end-to-end terrain path.
- Real Rust-host terrain composition resolution.
- Porting the legacy baker worker pool or worker transport.
- Implementing retail terrain vertex generation, transition adjustment, normals, or indices.
- Implementing WebGL2 texture-array allocation.
- Packing terrain compositions into GPU data textures or uniforms.
- Implementing the terrain GLSL program.
- Visual parity, profiling, or performance optimization.
- CPU or GPU precomposition of landblock color surfaces.
- Final lighting, shadows, atmosphere, or terrain effects.

Out-of-scope mechanics must still have code-level boundaries wherever their architectural role is
already known. A prose note or TODO is not a substitute for a known participant or flow.

## Ground Truth

### Presentation References

- `ACE/Source/ACE.DatLoader/Entity/TexMerge.cs`: DAT texture-merge descriptor structure.
- `ACE/Source/ACE.DatLoader/Entity/TerrainAlphaMap.cs`: terrain alpha-map asset shape.
- `ACE/Source/ACE.DatLoader/Entity/RoadAlphaMap.cs`: road alpha-map asset shape.
- `ACE/Source/ACE.Server/Physics/Common/TexMerge.cs`: pcode terrain, overlay, rotation, and road
  resolution behavior.
- `ACE/Source/ACE.Server/Physics/Common/TextureMergeInfo.cs`: resolved overlay cardinalities.
- `ACViewer/ACViewer/Physics/Common/TexMerge.cs`: inspectable composition resolution.
- `ACViewer/ACViewer/Model/LandVertex.cs`: ACViewer texture-array and alpha-map representation.
- `ACViewer/ACViewer/Render/TerrainBatchDraw.cs`: ACViewer terrain GPU submission inputs.
- `ACViewer/ACViewer/Content/texture.fx`: shader-side overlay composition behavior.
- `acclient-eor-source/acclient.c`, `TexMerge::GetTerrain`, `TexMerge::FindTerrainAlpha`,
  `TexMerge::FindRoadAlpha`, `TexMerge::FillTempTexBuffer`, and `TexMerge::MakeNewSurface`: secondary
  retail evidence.

Do not infer rotations, mask selection, road ordering, UV behavior, or blend equations from names.
Only encode fields whose meaning is established by these references.

### Legacy Worker References

- `apps/holtburger-3d-legacy/src/lib/static/bake/worker-client.ts`: shared baker worker-pool client.
- `apps/holtburger-3d-legacy/src/lib/static/bake/static-bake.worker.ts`: domain routing inside the
  shared worker.
- `apps/holtburger-3d-legacy/src/lib/static/terrain/bake/terrain-geometry-baker.ts`: old terrain
  workload and transferable geometry products.

The new terrain flow should retain worker-backed CPU generation, but not the legacy terrain baker's
atlas slicing, pcode geometry partitioning, duplicated vertices, per-vertex layer slots, provenance,
or renderer diagnostics.

### Asset And Retail Findings

- `CellLandblock` stores canonical `9x9` height bytes and `9x9` `u16` terrain samples. Terrain sample
  bits 0–1 carry road state and bits 2–6 carry terrain type.
- Retail derives mesh density from Chebyshev landblock distance to the landscape anchor: distance
  `0..1` uses an `8x8` cell mesh, distance `2` uses `4x4`, distance `3..4` uses `2x2`, and greater
  distance uses `1x1`.
- Retail subsamples the canonical `9x9` source grid with strides `1`, `2`, `4`, or `8`; it does not
  subdivide terrain beyond the authored grid.
- Retail transition direction can alter intermediate `4x4` and `2x2` boundary heights, so generated
  product identity includes both cell stride and transition direction.
- Retail recomputes generated cell pcodes and surfaces from the four sampled source terrain values.
  The surface field therefore changes with LOD alongside geometry.
- Full-road pcodes normalize to the synthetic road terrain type `0x20` as the base texture with no
  overlay or mask. They do not require a persistent `allRoad` presentation flag. The legacy TS
  planner's road terrain code `3` is incorrect and must not be ported.
- Landscape detail is region-level presentation from terrain descriptor index `0`: texture plus
  tiling. Legacy `fadeNear` and `fadeFar` values are adapter constants, not DAT source facts.
- The checked-out Dereth assets contain 30 terrain colors, all `512x512 A8R8G8B8`; five terrain
  masks and three road masks, all `512x512 CustomLandscapeAlpha`; and ordinary `Texture2D` source
  textures. Landscape detail is a separate `256x256 A8R8G8B8` binding. Separate color and mask
  texture arrays are therefore realistic without source normalization.
- Canonical terrain-generation input is about 486 bytes before object overhead: 81 `f32` heights and
  81 `u16` terrain samples. Structured-clone input and transfer generated output buffers; do not
  detach retained source buffers or introduce shared memory.

### Current New-Runtime Touch Points

- `apps/holtburger-3d/src/lib/assets/host-contracts.ts`
- `apps/holtburger-3d/src/lib/game/resolution/landblock-layer.ts`
- `apps/holtburger-3d/src/lib/game/resolution/resolve-landblock-layer.ts`
- `apps/holtburger-3d/src/lib/game/commit/types.ts`
- `apps/holtburger-3d/src/lib/game/commit/pipeline.ts`
- `apps/holtburger-3d/src/lib/game/terrain/terrain-service.ts`
- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
- `apps/holtburger-3d/src/lib/game/textures/types.ts`
- `apps/holtburger-3d/src/lib/game/renderer/geometry.ts`
- `apps/holtburger-3d/src/lib/game/renderer/render-resources.ts`
- `apps/holtburger-3d/src/lib/game/renderer/resource-manager.ts`
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-resource-manager.ts`
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`

## Confirmed Decisions

- Terrain source and generated terrain products have different lifetimes.
- `StandardCommitPipeline` commits stable heights, raw terrain samples, region material definitions,
  landscape detail, and texture dependencies.
- Terrain LOD is derived continuously from distance to the scene anchor, not selected once during
  layer installation and not derived from the camera.
- `TerrainService` owns desired and pending generation state but does not talk directly to
  `SceneGraph` or renderer systems.
- `TerrainGeometryGenerator` is the terrain-domain async generation port.
- The shared baker is the only baker concept. A worker-backed generator adapter will delegate terrain
  jobs to it; there will be no `TerrainMeshBaker` or terrain-specific worker pool.
- Terrain generation policy contains source-grid stride and transition direction derived from the
  landblock's relation to the anchor.
- A generated terrain product contains one landblock-local mesh plus its matching cell-composition
  field; both may change repeatedly.
- The terrain scene node, render instance, logical render resource, region material definition, and
  source texture dependencies remain stable across generated-product changes.
- The old geometry and surface field remain drawable while a replacement product is pending and
  until replacement upload succeeds.
- Terrain surface selection is a landblock cell field, not a per-vertex attribute or set of material
  draw ranges.
- Terrain colors, blend masks, roads, and detail are composed by a terrain-specific shader from
  shared source textures.
- Terrain source textures are not packed into atlas pages. Compatible source textures eventually
  occupy independent WebGL2 texture-array layers with ordinary layer-local UVs.
- Commit texture artifacts distinguish existing static atlas pages from independent source textures;
  neither representation masquerades as the other.
- Backend array layers and GPU composition packing never enter host, resolved, commit, terrain, or
  scene-domain contracts.

## Target Code Flow

```text
HostTerrainLayerSourceDto
    -> ResolvedTerrainLayerSource
    -> StandardCommitPipeline
         -> StaticLandblockLayerCommitTerrain
              - heights
              - raw terrain samples
              - region material definition + landscape detail
         -> non-atlased terrain source-texture artifacts
    -> GameRuntime
         -> installs stable terrain SceneGraph node
         -> installs source in TerrainService
    -> TerrainService.reconcile(anchor, residency, policy)
         -> TerrainGeometryGenerator.generate(...)
    -> worker-backed generator adapter
         -> shared Baker.execute(terrain-generation job)
         -> generated geometry + matching surface field
    -> TerrainService accepts current result or rejects stale result
         -> upsert-product / remove-product
    -> GameRuntime
         -> first product: create logical terrain resource and render instance
         -> later product: atomically replace geometry + generated surface together
    -> RenderScene
         -> terrain frame input containing the current generated product
    -> WebGL2 terrain draw boundary
         -> intentionally unimplemented mechanics
```

## Phased Implementation

### Phase 1: Encode Lossless Terrain Source Presentation

Goal: make the host and resolution shapes preserve the raw landblock samples and regional material
definitions needed to generate LOD-specific terrain compositions.

Primary targets:

- `apps/holtburger-3d/src/lib/assets/host-contracts.ts`
- `apps/holtburger-3d/src/lib/game/resolution/landblock-layer.ts`
- `apps/holtburger-3d/src/lib/game/resolution/resolve-landblock-layer.ts`
- a focused presentation module if the existing resolution file becomes incoherent

Tasks:

- Replace `HostTerrainFeatureDto` with canonical raw terrain samples, terrain material entries,
  terrain alpha-map selectors, road alpha-map selectors, and landscape detail.
- Preserve terrain tiling, mask selectors, mask identities, and the synthetic road material entry
  needed to resolve generated pcodes.
- Define generated terrain surface compositions and the generated surface field in the terrain
  generation domain, not in host DTOs.
- Normalize full-road generated output to a base texture using terrain type `0x20`; do not retain
  diagnostic provenance or an `allRoad` field.
- Keep detail fade policy out of source contracts because it is not present in the DAT definition.
- Keep host DTO identifiers as host data and normalize them into typed frontend asset identifiers at
  the resolution boundary.
- Validate the two `9x9` source-array lengths, material type identities, selector identities, and
  required texture references.
- Delete `HostTerrainFeatureDto`, `ResolvedTerrainFeature`, and their lossy conversion flow.
- Add focused conversion tests using inline fixtures only.

Acceptance criteria:

- Code preserves enough source information to generate base-only, terrain-overlay, rotated-mask,
  road, full-road, and detail presentation without parallel-array coupling.
- No renderer allocation or GPU storage detail appears in presentation types.
- Invalid host composition data fails loudly.

Decisions and course corrections:

- Pending implementation.

### Phase 2: Make Terrain Commit Source-Only

Goal: encode that layer commit prepares reusable terrain source data while runtime generation owns
all LOD-dependent geometry.

Primary targets:

- `apps/holtburger-3d/src/lib/game/commit/types.ts`
- `apps/holtburger-3d/src/lib/game/commit/pipeline.ts`

Tasks:

- Replace `TerrainFeatures` and `featureIndexes` with canonical `9x9` heights, canonical `9x9` raw
  terrain samples, region material definitions, and landscape detail.
- Replace the universal `CommitBundle.atlasPages` assumption with a discriminated texture-artifact
  boundary that can carry existing static atlas pages or independent source textures.
- Define the independent source-texture artifact with stable `TextureKey`, `TexturePurpose`, decoded
  dimensions, and pixel payload. Format and sampling policy remain derived from purpose.
- Make the terrain branch of `StandardCommitPipeline` emit one independent artifact for each unique
  referenced terrain color, terrain mask, road mask, and detail texture.
- Keep static layers on explicit atlas-page artifacts until their later batching architecture says
  otherwise; do not broaden this terrain correction into an unrelated static-texture rewrite.
- Update runtime commit handling to dispatch texture artifacts by their discriminant instead of
  assuming every texture resource is an atlas page.
- Keep generation policy, generated geometry, draw units, generated texture keys, backend resource
  keys, and array layers out of the commit artifact.
- Make unimplemented host asset preparation fail at the narrow asset-bridge boundary rather than
  weakening the commit shape.
- Add tests proving terrain commit does not require an anchor or LOD policy and preserves composition
  relationships.

Acceptance criteria:

- Terrain commit output is sufficient for repeated future geometry generation.
- `StandardCommitPipeline` does not invoke terrain generation.
- Terrain commit output contains no atlas placement, atlas page identity, gutter, or subrect
  coordinates.
- Existing static atlas artifacts remain explicit and cannot be consumed as independent source
  textures accidentally.
- Repository search finds no production use of the removed terrain feature/index model.

Decisions and course corrections:

- Pending implementation.

### Phase 3: Encode The Shared Baker And Terrain Generation Boundary

Goal: show how recurrent terrain generation reaches the future shared worker without implementing
worker transport or geometry mechanics.

Primary targets:

- a minimal shared baker boundary under `apps/holtburger-3d/src/lib/game/bake`
- a terrain generator module under `apps/holtburger-3d/src/lib/game/terrain`
- `apps/holtburger-3d/src/lib/game/renderer/geometry.ts`

Tasks:

- Define the minimal discriminated baker job/result protocol needed to route a terrain-generation
  job without speculating about unshaped static domains.
- Define `TerrainGeometryGenerator`, `TerrainGenerationInput`, `TerrainGenerationResult`, generation
  identity, source revision, and policy containing grid stride plus transition direction.
- Add a worker-backed generator adapter whose call site delegates to the shared baker boundary.
- Make the absent worker implementation fail loudly when invoked.
- Define the pure worker-side `generateTerrainGeometry` entry point with its intended typed input and
  result, but leave the unproven algorithm unimplemented.
- Shape `TerrainGenerationResult` as geometry plus the generated surface field derived from the same
  sampled cells.
- Shape `TerrainGeometryData` as positions, normals, indices, and only source-proven geometric
  attributes.
- Remove `featureSlots`; remove UVs unless the source investigation proves they cannot be derived
  from landblock-local position.
- Structured-clone the small canonical input and transfer owned generated output buffers. Do not
  transfer retained source heights or terrain samples.

Acceptance criteria:

- A code tour reaches the shared baker boundary from `TerrainGeometryGenerator` without encountering
  a second baker abstraction.
- Generation output contains its matching renderer-neutral surface field but no backend allocation
  state.
- Calling the absent worker or geometry algorithm fails with a specific error.

Decisions and course corrections:

- Pending implementation.

### Phase 4: Implement Anchor-Driven Terrain Reconciliation

Goal: make the important terrain lifecycle behavior real and testable independently of workers and
rendering.

Primary targets:

- `apps/holtburger-3d/src/lib/game/terrain/terrain-service.ts`
- focused `terrain-service` tests
- existing landblock-coordinate helpers, extended only where needed

Tasks:

- Inject `TerrainGeometryGenerator` into `TerrainService`.
- Store installed source and source revision per landblock.
- Accept scene anchor, resident landblocks, and terrain generation policy as reconciliation input.
- Derive source-grid stride from retail's Chebyshev anchor-distance rings and transition direction
  from the landblock's relative anchor position.
- Track desired policy, installed policy, and pending generation identity per landblock.
- Start initial generation when a resident source has no mesh.
- Request replacement generation when its desired policy changes.
- Coalesce superseded desired states rather than enqueueing every anchor transition.
- Reject completion when its generation, source revision, residency, or desired policy is stale.
- Retain the installed mesh while a replacement is pending.
- Emit one `upsert-product` shape carrying geometry plus its surface field for initial and replacement
  products, and one `remove-product` shape for teardown.
- Use a controllable fake generator to test completion ordering without timers or real workers.

Acceptance criteria:

- Moving the anchor across an LOD boundary requests replacement geometry without recommitting the
  terrain source.
- Rapid anchor movement converges on the latest desired policy.
- Stale results cannot become current.
- Removing or replacing a source invalidates its pending work.
- Existing geometry and surface field remain installed until a current replacement result is
  accepted.

Decisions and course corrections:

- Pending implementation.

### Phase 5: Encode Runtime Ownership And Geometry Replacement

Goal: show how stable source and scene state own a repeatedly replaceable terrain render product.

Primary targets:

- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
- `apps/holtburger-3d/src/lib/game/runtime/ownership.ts`
- `apps/holtburger-3d/src/lib/game/scene/scene-graph.ts`
- runtime ownership tests

Tasks:

- Install a stable landblock-resident terrain scene node when the source layer commits, independently
  from mesh readiness.
- Feed world-anchor, scene-interest, and policy changes into `TerrainService` reconciliation.
- Keep `TerrainService` isolated from `SceneGraph`, render registries, and backend resources.
- On the first accepted product, create the logical terrain resource and render instance for the
  existing scene node.
- On later accepted products, realize replacement geometry and generated surface state, then
  atomically replace them as one matching pair.
- Destroy displaced geometry and generated surface resources only after a successful logical swap.
- Preserve the scene node, render instance, region material state, and source texture ownership
  across product replacement.
- Define explicit source replacement and eviction teardown order.
- Remove camera-driven terrain residency calls and material-patch-to-draw-unit conversion.

Acceptance criteria:

- Source installation, initial product publication, product replacement, and eviction are visible as
  separate runtime transitions.
- A geometry or surface realization failure leaves the previous product installed.
- LOD replacement causes no scene-node or texture-ownership churn.
- Ownership tests prove each displaced or evicted resource is released exactly once.

Decisions and course corrections:

- Pending implementation.

### Phase 6: Encode Logical Shader-Composition Resources

Goal: replace the fake singular terrain material model with renderer-neutral resources that express
the known shader-composition flow.

Primary targets:

- `apps/holtburger-3d/src/lib/game/textures/types.ts`
- `apps/holtburger-3d/src/lib/game/renderer/render-resources.ts`
- `apps/holtburger-3d/src/lib/game/renderer/render-scene.ts`
- renderer resource tests

Tasks:

- Add distinct texture purposes for terrain blend masks and generated terrain surface slots.
- Split stable texture identity into DAT-backed and generated variants without exposing GPU storage.
- Keep terrain source texture identity independent from atlas page identity and placement.
- Replace `TerrainRenderMaterial` and `TerrainRenderDrawUnit` with one stable landblock terrain
  resource containing stable source-texture requirements and one replaceable generated product made
  of matching geometry and surface-field references.
- Represent the surface field, source texture requirements, and composition records without choosing
  texture-array layers, atlas rectangles, data textures, or uniform layouts.
- Add an explicit product replacement operation that returns displaced geometry and generated
  surface keys.
- Make `RenderScene` resolve one terrain frame instance from the stable logical resource.
- Rewrite tests around resource ownership and replacement rather than material-patch ranges.

Acceptance criteria:

- The logical renderer model clearly requires shader composition but does not encode an unproven GPU
  packing strategy.
- Geometry and its generated surface field are replaced atomically without replacing source texture
  residency.
- No singular terrain material, material patch, per-pcode draw unit, or per-vertex feature slot
  remains in production types.

Decisions and course corrections:

- Pending implementation.

### Phase 7: Stub The WebGL2 Terrain Boundary

Goal: make the final renderer handoff visible and honest without implementing texture arrays,
composition packing, or GLSL.

Primary targets:

- `apps/holtburger-3d/src/lib/game/renderer/resource-manager.ts`
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-resource-manager.ts`
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
- a focused terrain-program boundary under `apps/holtburger-3d/src/lib/game/renderer`

Tasks:

- Define backend terrain-surface resource identity and create, resolve, and release operations.
- Show that backend realization consumes independent source textures and groups compatible terrain
  colors, masks, roads, and detail inputs into purpose-specific texture arrays.
- Keep every array layer's sampling coordinates layer-local; do not introduce atlas rects, gutters,
  page bindings, or explicit-gradient atlas-repeat helpers into the terrain program boundary.
- Show that generated landblock surface slots are a separate integer lookup texture, not an atlas
  entry or a source texture-array layer.
- Produce opaque backend state after source-array and generated-surface realization.
- Define a terrain program draw input containing geometry, resolved surface backend state,
  landblock-local transform, anchor-relative landblock offset, and frame/view state.
- Route terrain frame instances to that program boundary from `Webgl2Renderer`.
- Make unimplemented surface realization and terrain drawing throw precise errors.
- Remove the temporary flat-color terrain material path once the new boundary is connected.
- Do not invent array-layer limits, texture normalization, composition packing, or shader uniforms to
  make the stubs look more complete.

Acceptance criteria:

- A code tour can follow an accepted terrain generation result to the exact WebGL2 boundary that will
  eventually draw it.
- Every backend-specific output is opaque outside the WebGL2 resource and program modules.
- No terrain backend contract contains atlas placement or atlas-page state.
- Attempting real terrain realization or drawing fails loudly rather than silently rendering a fake
  approximation.

Decisions and course corrections:

- Pending implementation.

### Phase 8: Cleanup And Architectural Verification

Goal: leave one legible terrain architecture with no obsolete compatibility model or fake working
path.

Tasks:

- Delete dead feature, feature-index, material-patch, singular-material, and flat-color terrain code.
- Delete or rewrite tests that preserve those old shapes.
- Audit naming so only shared worker infrastructure uses baker vocabulary and terrain code uses
  generation vocabulary.
- Audit new types and fields for concise ownership and lifecycle comments.
- Audit for hollow wrappers that do not enforce a boundary or remove real complexity.
- Run focused tests, TypeScript checks, lint, and formatting; record unrelated pre-existing failures
  without weakening checks.
- Update this plan with completed phases and any course corrections discovered while coding.

Acceptance criteria:

- The source tree expresses the complete target flow from resolved terrain source to the WebGL2 draw
  boundary.
- Anchor-driven generation and stale-result behavior are covered by focused tests.
- Known architectural participants are represented in code, not only comments or this plan.
- Unimplemented mechanics fail at narrow, honestly named boundaries.
- Nothing claims that terrain currently renders or that the app is runnable.

Decisions and course corrections:

- Pending implementation.

## Risks And Mitigations

- **Stub types accidentally canonize guesses.** Encode only source-proven presentation fields and
  opaque backend boundaries; stop and investigate when a field's meaning is uncertain.
- **The shared baker stub becomes a speculative framework.** Add only the terrain job needed to show
  the known route. Do not model unshaped static jobs preemptively.
- **Async service tests dictate production scheduling.** Test observable reconciliation behavior with
  a fake generator, not worker internals, timers, or queue implementation details.
- **Source buffers are detached by future worker transfer.** Structured-clone the small canonical
  input and transfer only worker-owned generated output buffers.
- **Runtime starts owning terrain policy.** Runtime supplies anchor, residency, and configured policy;
  `TerrainService` derives and tracks desired mesh state.
- **Renderer details leak upward.** Keep array layers, packing, shader bindings, and capability limits
  behind opaque backend resource identities.
- **The atlas-centric commit shape infects terrain.** Introduce explicit independent source-texture
  artifacts and dispatch them by kind; retain atlas-page artifacts only for domains that actually
  consume atlases.
- **A fake renderer path becomes accidental compatibility code.** Fail loudly at the terrain backend
  boundary and delete the temporary flat-color terrain route.
- **The plan expands into production implementation.** Stop when shapes, calls, state transitions,
  ownership, and focused domain tests are coherent. Real pixels require a separate execution signal.

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

- Terrain presentation types preserve every currently proven composition relationship.
- `StandardCommitPipeline` produces reusable raw terrain source and material artifacts without
  generating a terrain product.
- Terrain texture artifacts are independent source textures with no atlas placement or page state.
- `TerrainGeometryGenerator` reaches the one shared baker boundary through code.
- `TerrainService` reconciles resident geometry from scene-anchor distance and rejects stale work.
- Initial generation and later LOD changes share one product-upsert flow.
- `GameRuntime` keeps scene and source-texture ownership stable while atomically replacing matching
  geometry and generated surface state.
- Logical render resources express shader-composited terrain without backend packing details.
- The WebGL2 surface-realization and terrain-draw boundaries exist and fail loudly.
- Obsolete material patches, terrain draw units, singular materials, and feature slots are removed.
- Focused tests validate source conversion, reconciliation, replacement, and ownership behavior.
- The code makes its unimplemented mechanics obvious and does not claim to render terrain.

## Remaining Mechanical Decisions

The exact GPU composition-record packing and GLSL implementation remain backend mechanics. They do
not change the logical source, generated-product, ownership, or replacement contracts in this plan,
so choosing between uniforms and an integer data texture is intentionally not part of the
architecture-stubbing work.
