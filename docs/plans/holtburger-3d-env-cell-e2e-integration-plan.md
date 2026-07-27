# Holtburger 3D Environment-Cell End-to-End Integration Plan

Status: Finalized — evidence, flat-rendering midpoint, and hybrid portal-rendering contracts locked,
ready to execute
(2026-07-27)

## Context and Boundaries

### Goal

Materialize one landblock's complete environment-cell system through the existing content,
interest, resource, scene, and WebGL pipelines so Explorer can render textured cell structures and
their residents, traverse their directed portal topology conservatively, and establish camera
residency without treating spatial overlap as authoritative connectivity.

The implementation must also close the current static-material detail-texture parity gap. Building,
environment, and object detail roles are active-region resources and must be selectable by every
compatible static material, including environment-cell structures and residents.

### Current State

- `holtburger-content` already assembles `LandblockInteriorSystemAsset`: ordered EnvCells,
  deduplicated Environments with their `CellStruct`s, directed portal topology, potentially visible
  cell references, and every authored indoor static-object placement.
- `ContentAssetRequest::LandblockInteriorSystem` already provides a closed content request for the
  canonical interior fanout.
- `apps/holtburger-3d` already has a cumulative `LandblockSourceBatchSource`, independently decoded
  HBLB records, scene-interest receipts, texture preparation, atlas residency, static geometry
  realization, render-world projection, object shaders, and renderer pass ordering.
- `EnvCellSystem` and `SceneGraph` are implemented rather than stubbed. They already model
  landblock and EnvCell scopes, directed crossings, node bounds, frustum tests, camera-facing
  apertures, recursive traversal, cycle avoidance, and culling groups.
- `LandblockLayerKind.EnvCells`, provisional `ResolvedEnvCellLayerSource` shapes,
  `EnvCellLayerCommit`/`EnvCellLayerArtifact`, and the runtime installation branch already exist.
  They are structural steering for the intended pipeline, but no host record currently populates
  them end to end. Some fields, including `unknown` BSP payloads and renderer-neutral shell
  material IDs, are deliberately incomplete and must be replaced rather than preserved as
  compatibility contracts.
- The source batch and static realization types are still named and closed around outdoor layers.
  The HBLB batch has no environment-cell record, and the host geometry builder accepts only
  `GfxObj`.
- `SceneGraph.queryWorldPointResidency` is AABB-only and returns the first overlapping scope in
  insertion order. That behavior is insufficient for overlapping and non-Euclidean interiors.
- Portal traversal applies the original camera frustum and camera-facing test but scans all
  crossings for every visited scope. Dense portal grids would turn a useful conservative traversal
  into avoidable `O(visited scopes × all crossings)` work.
- The object shader supports a detail overlay, but `ActiveRegionObjectDetailOwner` currently
  prepares only the building-detail role and the renderer applies it to every object material with
  the raw detail flag. That is a policy gap, not an environment-cell-only concern.

### Terminology

| Term | Meaning |
| --- | --- |
| Environment-cell system | All EnvCells, CellStructs, directed portal topology, cell surfaces, and authored residents owned by one landblock. |
| Cell structure | The selected `CellStruct` inside an Environment, instanced by one EnvCell with EnvCell-selected surfaces. |
| Aperture | Material-free, planar polygonal geometry used for visibility traversal, directed crossing queries, stencil masking, and scene-domain composition. |
| Cell shell | Textured render geometry selected from a CellStruct for one EnvCell. It excludes aperture mask geometry. |
| Resident | A static-object reference authored by an EnvCell. Its source placement is EnvCell-local. |
| EnvCell culling group | A producer-specific aggregate broad-phase inside one EnvCell scene scope. Groups reject member sets by their unioned transformed bounds before surviving nodes receive exact AABB tests. |
| Indoor visibility island | EnvCell scopes connected only by conservatively proven depth-continuous indoor seams. Its scopes retain independent topology/residency identity but can render as one ordinary spatial domain. |
| Scene domain target | Renderer-owned offscreen color and sampleable depth for a scene domain such as the exterior. It is rendered once and reused through portal composites. |
| EnvCell render mode | Permanent frame-level presentation policy: `flat` draws resident EnvCell content in the ordinary main view, while `portal` applies topology masks and exterior scene-domain composition. |
| Authoritative residency | The cell identity carried by gameplay or movement state and updated by directed portal crossings. |
| Explorer placement residency | Best-effort initial scope selection when no crossing history exists. It is allowed to be ambiguous. |
| Camera residency | A view scope derived from an authoritative player cell plus a directed segment to the desired camera position. |
| Near-plane straddle | A renderer-only condition where the camera's finite near-plane quad intersects a topology-mask or exterior portal aperture. Both adjacent render branches are seeded without changing camera or player residency. |
| Detail role | An active-region semantic texture binding: landscape, building, environment, or object. |

### In Scope

- Add environment cells as a first-class, independently decoded record in
  `LandblockSourceBatchSource`.
- Resolve `LandblockInteriorSystemAsset` only when the environment-cell record is requested.
- Generalize the host polygon builder shared by `GfxObj` and `CellStruct` without erasing their
  different material-slot and topology semantics.
- Select CellStruct drawing geometry, EnvCell surfaces, render flags, UVs, bounds, and material
  inputs losslessly.
- Project every portal as a validated planar, arbitrarily shaped aperture with directed side
  semantics. Apertures are not assumed rectangular, convex, or axis-aligned.
- Materialize every supported EnvCell resident through the existing object presentation closure,
  geometry, texture, atlas, and draw-material paths.
- Compose resident transforms into landblock space while retaining the owning `envCellId` as typed
  scope identity.
- Partition resident render batching by EnvCell scope before geometry/material/pass batching. Source
  geometry and immutable GPU resources may be shared across cells, but no scene node, instance
  population, or draw submission may claim residents from multiple scopes.
- Publish separate shell and static-resident culling groups inside each EnvCell scope. Aggregate
  bounds come from actual transformed member-node bounds rather than trusting the authored cell
  shell AABB to contain every resident.
- Generalize active-region static detail resources to building, environment, and object roles and
  select the correct role per material domain.
- Install cell shells, residents, bounds, scopes, and directed crossings atomically for one
  environment-cell layer receipt.
- Preserve a permanent flat EnvCell render mode as the end-to-end midpoint and bird's-eye
  diagnostic view. It renders resident EnvCell content in the ordinary exterior/main view with no
  portal traversal, masks, or scene-domain composition.
- Preserve the legacy flat-mode shell policy: force back-face culling for structured EnvCell shell
  ranges so an exterior bird's-eye camera can see through their outward backs. This override must
  not change authored culling for EnvCell residents or other static objects.
- Expose the render mode through typed frame settings and an Explorer `Portal rendering` control.
  Switching modes must not reload content, rebuild GPU resources, or alter scene/residency state.
- Replace global crossing scans with outgoing adjacency keyed by source scope.
- Retain conservative visibility traversal using the original camera frustum, cell/node AABBs,
  aperture AABBs, and directed camera-facing rejection.
- Add pure planar-aperture queries for point-in-aperture, directed segment crossing, earliest
  crossing, and repeated portal tracing.
- Replace first-match point residency with candidate-oriented AABB broad phase plus Cell BSP
  containment for Explorer initial placement.
- Derive client-mode third-person camera residency from the player's authoritative cell and a
  directed player-to-camera segment.
- Conservatively classify proven depth-continuous indoor seams during host projection; leave every
  unproven internal edge as a topology-mask boundary.
- Design and implement hybrid portal rendering as a separate late phase:
  - ordinary depth rendering inside proven indoor visibility islands;
  - path-local stencil at unproven/non-Euclidean indoor boundaries;
  - mandatory scene-domain composition at every indoor/outdoor transition.
- Render the exterior scene domain at most once per camera frame into offscreen color and depth,
  then composite both through every applicable transition mask.
- Detect finite camera near-plane intersections with actual aperture triangles and temporarily seed
  both adjacent render branches to prevent degenerate masks, black regions, and side flicker.
- Add synthetic tests, host diagnostics, and non-interactive browser-harness coverage. Permanent
  tests must not require uncommitted DAT or HBA assets.
- Update architecture and file-format documentation with facts proven during implementation.

### Out of Scope

- Portal-clipped child frusta or recursive screen-space portal clipping. Overdraw is accepted for
  this milestone.
- Inferring player or actor residency from a world-space point every frame.
- Treating authored potentially-visible-cell lists as an authoritative replacement for portal
  traversal. Retail uses them to seed candidate views and containment searches, then follows actual
  portal topology.
- Full collision response, camera obstruction, camera boom shortening, sphere/box BSP queries, or
  physics-object movement. Camera collision and camera residency are separate problems.
- A general-purpose full recursive Cell BSP transport merely because the canonical asset retains
  one. The current Explorer point query needs only the retail-equivalent containment projection.
- Invented portal teleport transforms, mirroring, or cross-landblock portal semantics without
  evidence in ACE, ACViewer, or the retail client.
- Rendering a portal aperture as a visible material-bearing surface.
- Porting the legacy renderer's frame-plan architecture.
- Heuristic portal-mask elision based on projected coverage, graph degree, or dungeon shape.
- Changing authoritative player/camera residency because the render near plane intersects a portal.
- Temporal overlap hysteresis unless deterministic near-plane/aperture intersection with a shared
  epsilon proves insufficient in executable fixtures.
- Promoting Explorer camera policy into shared Rust crates.
- TUI integration or TUI diagnostics.
- Permanent tests that depend on locally installed client archives.

## Ground Truth and Reference Paths

### Canonical Rust Content

- `crates/holtburger-dat/src/file_type/env_cell.rs`
- `crates/holtburger-dat/src/file_type/environment.rs`
- `crates/holtburger-dat/src/physics.rs`
- `crates/holtburger-content/src/interior.rs`
- `crates/holtburger-content/src/landblock.rs`
- `crates/holtburger-content/src/material_graph.rs`
- `crates/holtburger-core/src/content_assets.rs`
- `crates/holtburger-debug-harness/src/bin/inspect_env_cell_integration.rs`

`LandblockInteriorSystemAsset` is the canonical static asset. App-specific mesh buffers, aperture
triangles, compact containment planes, texture pixels, and wire sections must be derived at the
Tauri boundary; they do not belong in `holtburger-content`.

### Current 3D Source and Materialization Seams

- `apps/holtburger-3d/src-tauri/src/landblock_source_batch.rs`
- `apps/holtburger-3d/src-tauri/src/outdoor_static_source.rs`
- `apps/holtburger-3d/src-tauri/src/gfx_obj_geometry.rs`
- `apps/holtburger-3d/src-tauri/src/lib.rs`
- `apps/holtburger-3d/src/lib/assets/landblock-source-batch.ts`
- `apps/holtburger-3d/src/lib/assets/decode-landblock-source-batch.ts`
- `apps/holtburger-3d/src/lib/assets/decode-outdoor-static-record.ts`
- `apps/holtburger-3d/src/lib/game/resolution/landblock-layer.ts`
- `apps/holtburger-3d/src/lib/game/resolution/object-material-planner.ts`
- `apps/holtburger-3d/src/lib/game/resolution/active-region-object-detail.ts`
- `apps/holtburger-3d/src/lib/game/commit/pipeline.ts`
- `apps/holtburger-3d/src/lib/game/commit/static-object-texture-inputs.ts`
- `apps/holtburger-3d/src/lib/game/commit/static-object-geometry-worker.ts`
- `apps/holtburger-3d/src/lib/game/runtime/static-layer-realizer.ts`
- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`

### Current Scene and Renderer Seams

- `apps/holtburger-3d/src/lib/game/systems/env-cell-system.ts`
- `apps/holtburger-3d/src/lib/game/systems/static-object-system.ts`
- `apps/holtburger-3d/src/lib/game/scene/index.ts`
- `apps/holtburger-3d/src/lib/game/scene/scene-graph.ts`
- `apps/holtburger-3d/src/lib/game/math/frustum.ts`
- `apps/holtburger-3d/src/lib/game/renderer/render-world.ts`
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-object-program.ts`
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
- `apps/holtburger-3d/src/explorer/explorer-camera-coordinator.ts`

### Legacy Prior Art to Mine, Not Copy

- `apps/holtburger-3d-legacy/src/lib/static/env-cells/env-cell-system-resolver.ts`
- `apps/holtburger-3d-legacy/src/lib/static/env-cells/bake/`
- `apps/holtburger-3d-legacy/src/lib/runtime/scene-query/env-cell-residency.ts`
- `apps/holtburger-3d-legacy/src/lib/runtime/direct-env-cell-frame-plan.ts`
- `apps/holtburger-3d-legacy/src/lib/renderer/`

The useful legacy facts are CellStruct polygon selection, EnvCell surface indexing, containment
plane traversal, and portal/stencil observations. Its broad runtime and frame-plan abstractions are
not target architecture.

### Authoritative External References

- `ACE/Source/ACE.DatLoader/FileTypes/EnvCell.cs`
- `ACE/Source/ACE.DatLoader/FileTypes/Environment.cs`
- `ACE/Source/ACE.DatLoader/Entity/CellStruct.cs`
- `ACE/Source/ACE.DatLoader/Entity/CellPortal.cs`
- `ACE/Source/ACE.DatLoader/Entity/PortalPoly.cs`
- `ACE/Source/ACE.Server/Physics/Common/EnvCell.cs`
- `ACE/Source/ACE.Server/Physics/Common/CellStruct.cs`
- `ACE/Source/ACE.Server/Physics/BSP/PortalPoly.cs`
- `ACViewer/ACViewer/FileTypes/EnvCell.cs`
- `ACViewer/ACViewer/Render/R_EnvCell.cs`
- `ACViewer/ACViewer/Render/R_CellStruct.cs`
- `ACViewer/ACViewer/Render/Buffer.cs`
- `acclient-eor-source/acclient.c`

Retail functions around `CEnvCell::point_in_cell`, `CCellStruct::point_in_cell`,
`CEnvCell::find_transit_cells`, cell/building portal transit, and portal render setup are the
highest-authority behavioral references. Record layouts come from the DAT decoders. ACViewer is
useful executable prior art, not authority over conflicting retail behavior.

## Evidence Lock

The following contracts were proven before finalizing this plan. Implementation diagnostics may
find malformed or exceptional assets, but no later phase depends on guessing these semantics.

| Question | Evidence | Locked contract |
| --- | --- | --- |
| CellStruct render selection | Retail `CEnvCell::UnPack` passes `structure->num_polygons` and `structure->polygons` to `D3DPolyRender::ConstructMesh`; `RenderDeviceD3D::DrawEnvCell` queues the same complete polygon collection. | Cell shells emit every CellStruct render polygon. The generic builder shares polygon mechanics only; GfxObj retains its drawing-BSP selection adapter. |
| EnvCell surface slots | Retail `D3DPolyRender::DrawPolyInternal` indexes the current EnvCell surface array directly with `pos_surface`; ACE `Polygon` preserves signed positive/negative surface indices. | Non-negative polygon surface indices are direct zero-based slots into `EnvCell.surfaces`; negative means no surface for that side. Out-of-range non-negative slots are malformed. |
| Point containment | Retail `CEnvCell::point_in_cell` transforms into cell-local space and calls `CCellStruct::point_in_cell`, which follows the positive child while rejecting signed plane distances below `-0.0002`. | Explorer transports the normalized positive-child plane chain and uses the retail `0.0002` epsilon. The full collision BSP remains canonical Rust data but does not cross the app boundary for this query. |
| Portal side | Retail `CCellPortal::UnPack` decodes `portal_side = (~flags >> 1) & 1`; `PView::InitCell`/`ConstructView` accept the positive plane side for decoded side `0` and the negative side for decoded side `1`. ACE confirms raw `PortalSide = 0x02` and its inverted accessor. | Raw flag `0x02` selects the authored plane's positive accepted side; a clear bit selects its negative side. Preserve authored plane/winding and store the accepted side explicitly. |
| Reciprocal portals | Retail `PView::ClipPortals` calls `OtherPortalClip` for non-`ExactMatch` links, transforming and clipping against the target portal's own polygon and side. | Each directed crossing retains its authored aperture, side, reciprocal ID, and `ExactMatch`. Never synthesize a reverse crossing by flipping the source plane. Deduplicate geometry only after transformed equivalence is proven. |
| Outside/building transitions | `LandblockInteriorSystemAsset` already pairs raw EnvCell `Outside` endpoints with unique `LandblockInfo` building-portal claims. Retail `PView::DrawPortal`/`ConstructView(CBldPortal, CPolygon, ...)` enters the target EnvCell through the building GfxObj portal polygon; `CBldPortal::UnPack` uses the same flag-to-side decoding. | Materialize both directions as authored crossings between the landblock/outdoor scope and EnvCell scope. The building-side aperture comes from its GfxObj portal polygon; the EnvCell side comes from its CellStruct. Every resolved exterior transition remains a mandatory portal-composite boundary even when its apertures match spatially, because terrain depth need not encode the opening. Missing claims remain explicit diagnostics. |
| Potentially visible cells | Retail `CEnvCell::grab_visible_cells`/`PView::DrawInside` seed listed cells, while `PView::ConstructView` and `AddViewToPortals` still follow portal links; `find_visible_child_cell` uses the list as a containment candidate set. | Preserve the list as preload/candidate provenance. It may broaden discovery but may not reject traversal or replace connectivity. |
| Detail roles | Retail `LScape::SetDetailTexturing(landscape, building, environment, object)` maps indices `0`, `1`, `2`, and `3` respectively; `RenderDeviceD3D::DrawBuilding` and `DrawEnvCell` bind their domain roles. `REGION_DETAIL_ROLE_ORDER` already preserves that order in `holtburger-content`. | Terrain uses landscape detail; building shells use building; CellStruct shells use environment; non-building objects, including generated objects and EnvCell residents, use object. Existing per-surface detail eligibility remains independent from semantic role selection. |
| Static animated residents | Retail `CEnvCell::init_static_objects` creates Stabs as static physics objects; default setup motion/script state registers through the static-animation path. The current 3D runtime deliberately defers this class in `GameRuntime.#deferStaticAuthoredDynamic`. | Account for every resident, materialize supported non-animated statics, and keep setup-default-animation residents on the explicit static-authored-animation deferral seam. Do not misroute them through spawned-dynamic installation. |
| Portal rendering | Retail `PView::GetClip`, `ClipPortals`, and `OtherPortalClip` propagate path-specific clipped screen polygons. `D3DPolyRender::DrawPortalPolyInternal` performs material-free depth behavior; retail stencil use found here is shadow-related, not portal-related. | Our renderer uses ordinary depth inside proven Euclidean islands and path-local stencil only where topology requires a mask. This is an app-local substitute for retail screen-space clipping, not a literal retail port. |
| Exterior scene reuse | Legacy `Webgl2Renderer.#renderSceneDomainTarget` renders the exterior once. `#renderOutdoorProjectionComposite` and `#drawPortalProjectionOutdoorCrossings` reuse it; `SOURCE_SCENE_COPY_FRAGMENT_SHADER` samples both exterior color and depth and writes `gl_FragDepth`. | Preserve the scene-domain invariant without preserving the legacy breadth-layer graph: exterior geometry renders at most once per camera frame, while transition passes copy cached exterior color and depth through exact portal masks. Composite ping-pong is allowed only to avoid framebuffer feedback. |
| Portal-plane flicker | Legacy `deriveRuntimePortalOverlapResidency` accepts a camera-point plane slab plus padded projected aperture AABB, seeds target EnvCells as `baseOverlap`, searches one extra hop, and sets `requiresExteriorSeed` for building transitions. `#drawPortalBaseOverlapEnvCells` draws those seeds before masked layers. | Preserve the successful dual-side render result but replace the proxy: derive a renderer-only closure from finite near-plane-quad intersection with actual aperture triangles. It neither mutates residency nor uses aperture AABBs or one-hop caps. |

The opt-in archive census is implemented by
`crates/holtburger-debug-harness/src/bin/inspect_env_cell_integration.rs`. Against
`dats/assets.hba` on 2026-07-27 it found:

- 542,369 EnvCells, 1,380,760 directed portals, 1,362,480 resolved internal reciprocal directed
  links, and 16,512 authored outside endpoints;
- 363,472 non-quad portal apertures and 119,693 non-axis-aligned portal planes;
- 442,400 authored static residents and 41,587,650 potentially-visible-cell references;
- a maximum positive containment-chain depth of 62 and a maximum of 27 portals in one cell.

Selected archive-backed fixtures are:

- simple reciprocal and rotated aperture: EnvCell `0x00010100`;
- non-quad aperture: EnvCell `0x00020104`, polygon `8` (six vertices);
- portal-dense cell: EnvCell `0xEC0E010B` (27 portals);
- resident-heavy cell: EnvCell `0x64440248` (231 residents);
- deep containment chain: EnvCell `0x11340139` (62 nodes).

Overlap/non-Euclidean behavior remains a synthetic topology fixture until an authoritative archive
case is identified; the algorithm does not depend on having a convenient retail example.

## North Stars

- Preserve one closed, cumulative landblock acquisition. Environment cells are another requested
  HBLB record, not a parallel host-loading protocol.
- Keep independent records independently decodable. A terrain consumer must not parse an
  environment-cell payload, and a missing interior must not poison an unrelated record.
- Reuse the existing object presentation closure, texture preparation, atlas, geometry residency,
  scene publication, and object shader paths. Generalize only seams that represent the same
  concept.
- Keep CellStruct selection, EnvCell surface indexing, aperture extraction, and containment
  projection specialized. Similar binary ingredients do not imply identical semantics.
- An aperture has geometry and direction but no material. Its render resource is a mask resource,
  never a textured object range.
- Support arbitrary planar aperture polygons. Triangulation may be reused from the source polygon,
  but containment and crossing code must not assume a rectangle, AABB, or convex fan.
- Keep cell and resident transforms in landblock space. Preserve `envCellId` as ownership and
  visibility identity rather than creating cross-system transform parenting.
- Treat EnvCell scope as the indivisible visibility and batching boundary. Portal traversal chooses
  scopes; culling groups only broad-phase producer sets within a chosen scope.
- Never use visibility-island membership as culling-group identity. Islands may schedule multiple
  scopes together, but residency, exact node culling, masks, picking, and lifecycle remain scoped.
- Make player residency authoritative and historical. Spatial containment is an Explorer bootstrap
  tool, not a substitute for portal-connected state.
- Derive third-person camera residency from an authoritative anchor and a directed segment. The
  desired endpoint alone cannot select between overlapping cells.
- Separate camera residency from camera collision. A successful portal trace says where the camera
  view belongs, not whether the boom intersects solid geometry.
- Use the original camera frustum throughout conservative EnvCell traversal for this milestone.
  Facing and bounds may reject work; child-frustum clipping may not.
- Reject apertures that do not face the traversal origin/camera. Reciprocal directed crossings use
  their own authored aperture and accepted side; they are not inferred by flipping the source.
- Collapse only conservatively proven indoor depth-continuous seams into visibility islands.
  Failure to prove continuity means mask, never heuristic elision.
- Treat every indoor/outdoor transition as a portal-composite boundary. Matching apertures do not
  make terrain depth safe for underground openings.
- Render exterior terrain, buildings, and objects at most once per camera frame. Reuse its color
  and depth through any number of exact transition masks.
- Preserve the good legacy scene-domain invariant, not its flat/breadth indoor work graph.
- Treat flat rendering as a supported diagnostic mode, not a temporary fallback. It shares the
  ordinary main view with outdoors and intentionally forces `BACK` culling only on structured
  EnvCell shell ranges for bird's-eye inspection.
- Keep render-mode selection a frame policy. It must not mutate content residency, scene topology,
  camera residency, materialization, or GPU resource ownership.
- Treat near-plane straddling as render-view ambiguity only. The eye retains one authoritative
  camera scope while the renderer seeds both adjacent branches inside the existing parent mask.
- Test the finite near-plane quad against triangulated aperture geometry. Camera-point slabs,
  aperture AABBs, and fixed-hop expansion are insufficient proxies.
- Index crossings by source scope before measuring dense dungeons. Avoid encoding accidental
  `O(V × E)` behavior into the public scene API.
- Keep active-region detail textures independent of per-landblock atlas pages. They have regional
  lifetime and semantic roles.
- Prove detail-role mapping, portal-side interpretation, winding, and stencil behavior from
  authoritative references or diagnostics. Do not let a convenient screenshot choose the model.
- Publish one complete environment-cell layer transaction or publish nothing. Stale work must not
  leave shells, residents, scopes, crossings, or GPU resources behind.
- Keep presentation and Explorer camera policy app-local. Shared crates retain decoded facts and
  reusable world semantics only.
- Fail malformed source geometry at the earliest typed boundary with source IDs and indices.
  Runtime culling must not silently fail open over data the materializer claimed was valid.

## Reuse, Generalization, and Specialization Budget

### Reuse Without Architectural Change

- `ContentAssetRequest` execution and content/decode caches.
- Shallow landblock acquisition and the cumulative HBLB envelope.
- Scene-interest diffs, layer receipts, revisions, late-result rejection, and eviction.
- Object presentation closure and static/default-animation classification.
- Texture input preparation, logical texture identities, regional detail residency, atlas
  arbitration, and GPU texture ownership.
- Worker-side baked object geometry and the geometry manager.
- Static node installation, render-world read membrane, object material programs, and existing
  opaque/alpha-test/transparent/additive pass policy.
- Landblock anchor-relative rendering and landblock-space transforms.
- Scene scope, node, culling-group, and conservative frustum primitives.

### Generalize Deliberately

- `LandblockSourceLayer` and `LandblockSourceRecord` to admit the already-defined environment-cell
  layer and replace its provisional source shape with a transport-backed record.
- `gfx_obj_geometry.rs` into a polygon-set geometry primitive shared by GfxObj and CellStruct
  adapters.
- Static source closure/material planning names that encode outdoor-only ownership while processing
  domain-independent static objects.
- `OutdoorStaticLayerKind`, worker inputs, and `StaticLayerRealizer` where their actual contract is
  a static render layer or scoped static artifact.
- Material binding from a boolean “has object detail” interpretation to a semantic `DetailRole |
  null`.
- Static placement inputs from a translation-only assumption to the existing complete
  `ScenePlacement` shape where EnvCell and resident composition requires it.
- Scene crossing storage from a flat traversal scan to a source-scope adjacency index.
- Point query APIs from a single guessed residency to explicit candidates and typed ambiguity.
- Renderer device ownership to include resize-safe scene-domain color/depth targets and masked
  color-plus-depth composition.

### Keep Specialized

- Interior-system serialization and decoding.
- CellStruct all-render-polygon selection and zero-based EnvCell surface-slot lookup.
- Portal aperture extraction, plane validation, directed visible-side derivation, and reciprocal
  link validation.
- Compact Cell BSP containment projection.
- Cell shell resource shape and atomic EnvCell-layer publication.
- Resident placement composition and `envCellId` assignment.
- Explorer initial-placement policy.
- Authoritative-anchor camera portal tracing.
- Conservative indoor seam classification and visibility-island construction.
- Path-local stencil/depth mask scheduling for topology boundaries.
- Exterior scene-domain rendering and indoor/outdoor composition.
- Renderer-local near-plane/aperture intersection and dual-side seed closure.

If implementation starts duplicating texture, material, atlas, or static-object closure code in an
`env-cell-*` module, stop and generalize the existing primitive. If it starts adding portal fields
to generic textured draw ranges, stop and restore the specialization boundary.

## Target Data Flow

```text
ContentRepository + ContentDecodeCache
  └─ ContentAssetRequest::LandblockInteriorSystem
      └─ LandblockInteriorSystemAsset
          ├─ EnvCell + selected CellStruct
          │   ├─ shell polygon adapter ──► generic polygon geometry builder
          │   ├─ EnvCell surfaces ──────► existing material/texture preparation
          │   ├─ Cell BSP ──────────────► compact containment hull
          │   └─ portal polygons ───────► validated planar apertures
          ├─ portal topology ───────────► directed crossings
          │   ├─ proven indoor seam ───► depth-continuous visibility-island edge
          │   ├─ unproven indoor edge ─► topology-mask boundary
          │   └─ exterior edge ────────► mandatory scene-domain composite boundary
          └─ indoor Stabs
              └─ existing object presentation closure
                  ├─ supported static ──► existing static geometry/material pipeline
                  └─ default animated ──► explicit static-authored animation deferral

HBLB requested record: EnvCells
  └─ TypeScript decode
      └─ EnvCell materialization commit
          ├─ cell shell geometry + material jobs
          ├─ resident static geometry + material jobs
          ├─ aperture mask geometry
          ├─ containment hulls
          └─ topology/scopes
              └─ atomic EnvCellSystem + StaticObjectSystem + SceneGraph publication
                  └─ RenderWorld
                      ├─ conservative visible shells/residents
                      └─ later hybrid portal render plan
                          ├─ finite near-plane/aperture intersections
                          │   └─ topology-bounded dual-side render seeds
                          ├─ ordinary depth inside indoor visibility islands
                          ├─ path-local stencil across topology-mask boundaries
                          └─ one cached exterior color/depth domain
                              └─ masked color/depth composites at every transition
```

Active-region detail ownership remains orthogonal:

```text
ActiveRegionData
  └─ StaticDetailTextureOwner
      ├─ Building detail
      ├─ Environment detail
      └─ Object detail
          └─ TextureManager regional bindings
              └─ material DetailRole selection at draw time
```

## Target Contracts

The exact field ordering belongs to the wire-format implementation, but the semantic shapes should
converge on the following contracts.

### Source Batch

```ts
export type LandblockSourceLayer =
  | LandblockLayerKind.Terrain
  | LandblockLayerKind.Buildings
  | LandblockLayerKind.Objects
  | LandblockLayerKind.Generated
  | LandblockLayerKind.EnvCells;

export type LandblockSourceRecord =
  | ResolvedTerrainLayerSource
  | ResolvedObjectLayerSource
  | ResolvedEnvCellLayerSource
  | null;
```

`LandblockSourceBatchSource` remains the one port that holds all landblock source record types. It
is not strictly an outdoor abstraction despite its current comment and union. It represents one
closed host capability for one landblock plus a requested record set. The implementation should
rename outdoor-only comments and subordinate types, not split the port merely because interiors
have a different record shape.

### Apertures and Directed Crossings

```ts
interface PortalAperture {
  readonly geometryId: PortalApertureGeometryId;
  readonly plane: Plane;
  readonly positions: Float32Array;
  readonly triangleIndices: Uint32Array;
  readonly bounds: Aabb;
}

interface DirectedPortalCrossing {
  readonly sourceScope: SceneScope;
  readonly targetScope: SceneScope;
  readonly apertureGeometryId: PortalApertureGeometryId;
  readonly acceptedSide: PlaneSide;
  readonly exactMatch: boolean;
  readonly reciprocalCrossingId: DirectedPortalCrossingId | null;
  readonly sourcePortal: EnvCellPortalIdentity | BuildingPortalIdentity;
  readonly spatialRelationship: PortalSpatialRelationship;
}

type PortalSpatialRelationship =
  | {
      readonly kind: "indoor-depth-continuous";
      readonly reciprocalApertureGeometryId: PortalApertureGeometryId;
    }
  | {
      readonly kind: "indoor-topology-boundary";
      readonly reason: IndoorTopologyBoundaryReason;
    }
  | {
      readonly kind: "exterior-transition";
      readonly exteriorLandblockId: LandblockId;
    };
```

- `positions` and `triangleIndices` describe the authored planar aperture. No rectangle or
  axis-aligned shortcut is permitted.
- A reciprocal portal pair retains both authored apertures and accepted sides. An implementation
  may share immutable geometry only after equivalence in a common coordinate frame is proven.
- Non-`ExactMatch` rendering intersects both directed apertures along the active path, matching
  retail's reciprocal clipping semantics without manufacturing a shared polygon.
- Internal crossings connect two EnvCell scopes. Authored building transitions connect the
  landblock/outdoor scope and an EnvCell scope using the independently authored building and
  CellStruct apertures.
- `indoor-depth-continuous` is emitted only when reciprocal identity, `ExactMatch`, transformed
  aperture equivalence, opposing accepted sides, and conservative cell-volume separation are all
  proven in landblock space. Every failed or unavailable proof becomes
  `indoor-topology-boundary`.
- `exterior-transition` can never become `indoor-depth-continuous`. Terrain and building depth do
  not necessarily contain a geometric hole matching the portal.
- Segment crossing performs one segment-plane intersection, then a point-in-triangulated-aperture
  test. It must not require the aperture to be convex.
- A segment coplanar with the aperture is not a crossing unless a later proven policy can establish
  an unambiguous directed side transition.
- Epsilon, plane normalization, degeneracy, winding, and boundary-hit policy live in one math
  module and are covered by focused tests.

### EnvCell Culling Groups

The existing `SceneGraph` indexes spatial aggregates as:

```text
scene scope → landblock → producer culling group → aggregate bounds → exact member nodes
```

EnvCell integration preserves that hierarchy:

- Each cell shell is published in `env-cell-shell` under its own EnvCell scope.
- Static residents are published in `env-cell-static-residents` under their owning EnvCell scope.
- Dynamic residents retain the established dynamic producer group under their owning EnvCell scope
  when that route becomes active.
- Reusing a producer key across cells never creates one dungeon-sized aggregate because scene scope
  partitions the map first.
- A culling-group bound is the conservative union of its members' transformed landblock-space
  bounds. Do not substitute the authored cell/shell AABB: an authored resident may extend beyond it.
- A resident artifact must be partitioned by EnvCell scope before batching. Geometry resources may
  be deduplicated globally, but baked nodes, persistent instance populations, transparent
  candidates, and draw submissions cannot span scopes.
- Flat mode considers every resident EnvCell scope, then performs group broad phase followed by
  exact node-AABB tests.
- Portal mode first selects scopes through topology and facing, then performs the identical group
  and node tests inside the selected scopes.
- Visibility islands affect ordinary-depth scheduling only. They do not merge scope indexes,
  culling groups, node ownership, or render submissions across cells.

### EnvCell Render Modes

```ts
type EnvCellRenderMode = "flat" | "portal";

interface FrameSettings {
  readonly distanceFogEnabled: boolean;
  readonly envCellRenderMode: EnvCellRenderMode;
}
```

- `flat` submits all resident EnvCell shells and residents to the ordinary main view alongside
  exterior terrain, buildings, and objects. It performs no portal traversal, aperture-mask draw,
  offscreen scene-domain render, or portal composite.
- In `flat`, structured EnvCell shell ranges force `BACK` culling. This is the intentional legacy
  bird's-eye diagnostic policy: outward back faces do not turn the cells into opaque shells when
  inspected from above or outside.
- The flat-mode override is resource-class-specific, not a global GL toggle. EnvCell residents and
  all other static materials retain their authored material culling.
- `portal` uses the hybrid work plan below and owns its own shell culling policy. The legacy policy
  disables structured-shell culling in portal rendering; retain that behavior unless executable
  fixtures prove a more precise per-material policy without reintroducing opaque-shell failures.
- `FrameSettings` is the sole presentation seam. A mode change invalidates frame work only; it
  cannot reacquire content, rebuild geometry/material resources, republish scene nodes, or change
  authoritative, camera, or Explorer residency.
- The Explorer control is labeled `Portal rendering`. While portal work is incomplete, `flat` is
  the default. Once the portal acceptance suite passes, `portal` becomes the default and unchecking
  the control selects the permanently supported flat diagnostic mode.

### Hybrid Portal Render Targets

```ts
interface SceneDomainTarget {
  readonly color: WebGLTexture;
  readonly depthStencil: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  readonly extent: RenderExtent;
}

interface PortalRenderPlan {
  readonly rootDomain: "exterior" | "interior";
  readonly indoorVisibilityIslands: readonly IndoorVisibilityIslandPlan[];
  readonly topologyMaskPaths: readonly PortalMaskPath[];
  readonly exteriorTransitions: readonly ExteriorTransitionComposite[];
}
```

- The exterior target contains the complete established outdoor pass sequence for the active
  camera and is rendered no more than once per frame.
- A source-scene copy samples both color and depth and writes the sampled depth while constrained by
  the exact transition stencil.
- Outdoor-root rendering seeds the composite from exterior color/depth, then renders reached indoor
  work through transition masks.
- Indoor-root rendering builds the indoor composite, then copies cached exterior color/depth
  through every reached outdoor mask. Multiple masks reuse the same exterior target.
- Composite ping-pong exists only when a pass would otherwise sample from the framebuffer it is
  writing. No target is allocated per portal, cell, or path.

### Near-Plane Straddle Rendering

```ts
interface PortalNearPlaneIntersection {
  readonly crossingId: DirectedPortalCrossingId;
  readonly sourceScope: SceneScope;
  readonly targetScope: SceneScope;
  readonly apertureGeometryId: PortalApertureGeometryId;
}

interface PortalBoundaryRenderSeeds {
  readonly authoritativeRoot: SceneScope;
  readonly intersections: readonly PortalNearPlaneIntersection[];
  readonly additionalSeeds: readonly SceneScope[];
  readonly includesExterior: boolean;
}
```

- Build the finite world/view-space near-plane quad from the active camera projection. Do not use
  the camera point as the overlap primitive.
- For each relevant topology-mask or exterior boundary, intersect the near-plane quad with the
  portal plane and require the resulting point/segment to overlap the actual triangulated aperture.
  Coplanar and boundary contacts use the shared rendering epsilon.
- Starting at the authoritative render root, add the adjacent scope for every intersected boundary
  and continue through newly added seeds until no additional near-plane-intersected boundary is
  found. Use visited scopes/crossings and a topology-derived bound, not a fixed hop count.
- An intersected boundary bypasses directed facing rejection only for this seed step. Descendant
  traversal resumes normal facing, frustum, island, and mask rules.
- Additional seeds inherit the current parent stencil/visibility region; they never become
  unrestricted full-frame roots when the straddle occurs inside a masked path.
- `includesExterior` reuses the single cached exterior scene target. It does not trigger another
  exterior render.
- The result is stateless renderer input. It does not update authoritative player residency,
  camera portal-trace residency, or Explorer containment.

### Explorer Containment

```ts
interface EnvCellContainmentCandidate {
  readonly envCellId: EnvCellId;
  readonly scope: SceneScope;
  readonly worldBounds: Aabb;
  readonly containmentHull: CellContainmentHull;
}

type ExplorerResidencyQuery =
  | { readonly kind: "resolved"; readonly residency: SceneResidency }
  | { readonly kind: "ambiguous"; readonly candidates: readonly SceneResidency[] }
  | { readonly kind: "outside" }
  | { readonly kind: "topology-unavailable"; readonly reason: string };
```

The containment hull projects the retail `CCellStruct::point_in_cell` positive-child plane chain
with the proven epsilon. The query broad-phases by AABB, transforms the point to CellStruct-local AC
coordinates, evaluates every candidate hull, and preserves ambiguity. An explicitly requested
EnvCell DID takes precedence when available.

### Camera Portal Trace

```ts
interface PortalTraceRequest {
  readonly startResidency: SceneResidency;
  readonly start: Vec3;
  readonly end: Vec3;
}

type PortalTraceResult =
  | {
      readonly kind: "complete";
      readonly residency: SceneResidency;
      readonly crossings: readonly DirectedPortalHit[];
    }
  | {
      readonly kind: "topology-unavailable";
      readonly lastKnownResidency: SceneResidency;
      readonly crossings: readonly DirectedPortalHit[];
    };
```

The trace inspects only outgoing crossings from the current scope, rejects wrong-facing apertures,
selects the earliest valid segment hit, advances the current scope, and continues over the
remaining segment with a small forward epsilon and last-crossing guard. The endpoint never
independently selects an overlapping cell.

### Static Detail Roles

```ts
enum StaticDetailRole {
  Building = "building",
  Environment = "environment",
  Object = "object",
}

interface StaticMaterialBinding {
  // Existing base, palette, clip-map, blend, cull, and lighting facts remain.
  readonly detailRole: StaticDetailRole | null;
}
```

The active-region texture owner resolves each role to a texture plus tiling factor. Landscape
detail remains terrain-specific. Material planning chooses a semantic role; the renderer only
resolves the active regional binding for that role.

## Phased Implementation

### Phase 0 — Evidence Lock and Contract Census — Complete 2026-07-27

The `Evidence Lock` section records the authority trail and selected contracts. The archive census
and fixture selection were run with:

```bash
cargo run -p holtburger-debug-harness --bin audit_polygon_sides -- --dats dats/assets.hba
cargo run -p holtburger-debug-harness --bin inspect_env_cell_integration -- --dats dats/assets.hba
```

The polygon audit covered 35,280 unique CellStruct render polygons and found no malformed positive
or negative UV payloads. The integration census and selected fixtures are recorded above.

#### Completed Checklist

- [x] Cite exact retail/ACE functions beside every non-obvious behavioral rule.
- [x] Separate CellStruct all-polygon selection from GfxObj drawing-BSP selection.
- [x] Prove direct zero-based `EnvCell.surfaces` indexing.
- [x] Prove the local plane convention, positive-chain walk, and `0.0002` containment epsilon.
- [x] Prove raw `PortalSide` decoding and accepted plane sides.
- [x] Prove active-region detail role ordering and select roles by render domain.
- [x] Prove potentially-visible cells are candidate/preload provenance, not a rejection oracle.
- [x] Prove reciprocal aperture semantics and reject synthesized reverse geometry.
- [x] Prove outside/building transition pairing and include the landblock/outdoor scope.
- [x] Establish path-local stencil ancestry as the required app-side replacement for retail clip
      propagation.
- [x] Verify the legacy exterior-domain invariant: render once, then copy cached color and sampled
      depth through transition masks.
- [x] Verify legacy portal-overlap behavior and separate its successful dual-side result from its
      camera-point slab, aperture-AABB, and one-hop approximations.
- [x] Add an opt-in non-TUI archive census and select risk-oriented fixtures.

No implementation phase now depends on an uncited guess about indices, winding, detail roles,
containment, portal direction, reciprocal geometry, or PVS authority.

### Phase 1 — Universal Active-Region Static Detail Roles

Fix the existing material parity gap before environment-cell materialization adds another special
case.

#### Deliverables

- Replace `ActiveRegionObjectDetailOwner` with a role-aware owner whose name reflects all static
  detail textures.
- Prepare building, environment, and object detail textures once per active region with typed
  tiling facts and independent GPU ownership.
- Replace renderer policy based on “raw material is detail-eligible, therefore use building detail”
  with a material-plan decision that combines existing per-surface eligibility and the semantic
  `StaticDetailRole | null` selected from the render domain.
- Apply building detail to building shells, environment detail to CellStruct shells, and object
  detail to outdoor objects, generated objects, and indoor residents whenever the source surface
  is detail-eligible.
- Keep landscape detail in the terrain path and keep regional detail textures out of per-landblock
  atlases.

#### Checklist

- [ ] Use one role-aware regional resource owner and one read-only renderer lookup.
- [ ] Keep missing authored roles explicit; do not silently substitute another role.
- [ ] Preserve material flags as provenance even when no proven detail role applies.
- [ ] Add synthetic planner and renderer tests for each role, no-detail, and missing-binding
      failure.
- [ ] Update Explorer and existing harness bootstrap to install all static detail roles.

#### Acceptance

- Existing static layers no longer receive building detail merely because a raw detail bit is set.
- Every supported detail role produces the correct texture/tiling binding through the same object
  shader.
- Regional detail ownership and eviction remain independent of landblock resource owners.

### Phase 2 — General Polygon Geometry and Interior Projections

#### Deliverables

- Refactor `gfx_obj_geometry.rs` into:
  - a small generic polygon-set geometry builder for vertices, normals, UVs, triangles, material
    slots, sides, stippling, wrap modes, and bounds;
  - a GfxObj adapter preserving existing behavior;
  - a CellStruct adapter with explicitly different surface-slot and drawing-selection rules.
- Project one CellStruct into:
  - textured shell geometry;
  - material-free aperture geometry;
  - a validated aperture plane and AABB per portal polygon;
  - a compact point-containment hull derived from the Cell BSP.
- Extend the GfxObj adapter to project `CPortalPoly`/drawing-BSP portal geometry for claimed
  landblock building transitions, without turning it into a visible material range.
- Add a pure conservative indoor-seam classifier over landblock-space apertures, accepted sides,
  reciprocal facts, and cell volumes. It emits proof-backed `indoor-depth-continuous` or an honest
  `indoor-topology-boundary` reason; exterior transitions bypass this classifier.
- Preserve full source identities in diagnostics: landblock, EnvCell, Environment, CellStruct,
  polygon, portal, surface slot, and object DID.

#### Checklist

- [ ] Start by deleting duplicated GfxObj-specific mechanics that the generic builder supersedes.
- [ ] Keep adapter-owned material-slot interpretation outside the generic builder.
- [ ] Validate every aperture vertex is coplanar within the proven tolerance.
- [ ] Reject degenerate planes, zero-area triangles, invalid polygon indices, and out-of-range
      surface slots.
- [ ] Retain arbitrary triangulated aperture shapes; do not rebuild them as quads.
- [ ] Verify both authored winding directions and one non-axis-aligned plane.
- [ ] Verify building-side portal index selection and flag/plane convention against
      `PView::ConstructView(CBldPortal, CPolygon, ...)`.
- [ ] Require reciprocal `ExactMatch`, transformed aperture equivalence, opposing sides, and
      conservative non-overlap/separation before declaring an indoor seam depth-continuous.
- [ ] Make every uncertain, malformed, non-exact, overlapping, or exterior edge a mask boundary.
- [ ] Verify existing building/object output remains byte-for-byte or semantically identical where
      the refactor should be behavior-preserving.
- [ ] Unit-test compact containment projection against a synthetic full BSP walk.

#### Acceptance

- GfxObj and CellStruct geometry share mechanics without sharing false material semantics.
- Portal geometry contains no material or visible draw range.
- Indoor seam classification has no view-dependent thresholds or silent fallback.
- A non-rectangular, non-axis-aligned planar aperture survives projection without loss.
- Existing building and object harnesses remain unchanged visually and diagnostically.

### Phase 3 — First-Class Environment-Cell HBLB Record

#### Deliverables

- Retain the existing `LandblockLayerKind.EnvCells` scene-interest identity and admit it as
  `LandblockSourceLayer.EnvCells` in the source batch.
- Add a distinct versioned environment-cell record to the HBLB directory. Do not reuse the outdoor
  static record serializer.
- Make the host request `LandblockInteriorSystem` only when `EnvCells` is requested.
- Serialize independently bounded sections for:
  - EnvCell identities, placement, flags, bounds, and selected structures;
  - shell vertices/indices/ranges/material inputs;
  - portal aperture vertices/indices/planes/bounds and directed topology;
  - building-side aperture references for claimed outside transitions and explicit unresolved
    outside endpoints;
  - proof-backed indoor spatial-relationship classification and boundary reasons;
  - compact containment hulls;
  - resident object-source records and complete EnvCell-local placements;
  - potentially-visible references and diagnostics/provenance.
- Add a strict TypeScript decoder returning a completed `ResolvedEnvCellLayerSource`, replacing
  provisional `unknown` BSP and incomplete aperture contracts rather than adding a parallel type.

#### Checklist

- [ ] Extend both Tauri and HTTP batch sources without adding a second environment-cell port.
- [ ] Preserve cumulative acquisition: one host request may return terrain, outdoor statics, and
      EnvCells as independent records.
- [ ] Validate record version, byte ranges, alignment, counts, indices, finite scalars, IDs,
      reciprocal links, spatial-relationship invariants, and section non-overlap.
- [ ] Represent a landblock with no EnvCells as a successful `null` EnvCells record.
- [ ] Ensure a decoder can skip every unrequested or unknown independent record safely.
- [ ] Keep source arrays transferable and avoid JSON expansion of geometry.
- [ ] Cover malformed directory offsets and cross-section indices with synthetic fixtures.

#### Acceptance

- Requesting only terrain does not assemble interiors.
- Requesting EnvCells returns one closed interior record and does not duplicate the shallow
  landblock acquisition.
- Existing HBLB record decoders remain independent and compatible with the new directory member.
- Rust and TypeScript agree on a committed synthetic record fixture or equivalent round-trip
  contract test.

### Phase 4 — Closed EnvCell Materialization Jobs

#### Deliverables

- Add an EnvCell resolver that turns `ResolvedEnvCellLayerSource` into a closed layer plan:
  - one shell job per supported cell structure instance;
  - one material/texture closure across all shell surfaces;
  - resident object closure using the existing object presentation resolver;
  - explicit static-authored default-animation classification/deferral through the existing seam;
  - aperture, containment, scope, and topology artifacts.
- Compose `cellToLandblock × residentToCell` into each resident's landblock-space
  `ScenePlacement`.
- Extend static worker and source inputs to carry complete placements and owning `envCellId`.
- Partition resident work by EnvCell scope before existing geometry/material/pass batching. Preserve
  shared immutable geometry identities across partitions, but emit no baked object, instance
  stream, transparent candidate population, or renderable containing multiple `envCellId` values.
- Reuse existing texture preparation and static geometry worker contracts for resident objects.
- Populate and complete the existing `EnvCellLayerCommit` seam so it owns the environment artifact
  and its static resident artifact together.

#### Checklist

- [ ] Deduplicate shared CellStruct source geometry without conflating per-EnvCell surfaces or
      transforms.
- [ ] Deduplicate resident GfxObj/material closure across cells using existing logical identities.
- [ ] Assert every emitted resident renderable has exactly one owning EnvCell scope even when source
      geometry, material bindings, or instance definitions are shared.
- [ ] Cover identical residents in two overlapping EnvCells and prove they remain separate scoped
      submissions with shared source resources.
- [ ] Preserve source order and stable identities for diagnostics.
- [ ] Count expected, static, default-animated, unsupported, shell, aperture, and materialized
      records.
- [ ] Fail the closed job on missing required shell material or geometry rather than publishing a
      partial cell.
- [ ] Keep static-authored default-animated residents on the existing explicit deferral seam; do
      not send them through spawned-dynamic installation or invent a second animation system.
- [ ] Verify quaternion/placement composition against an authoritative or diagnostic fixture with
      non-identity cell and resident transforms.

#### Acceptance

- Every authored EnvCell static-object reference is accounted for as materialized, explicitly
  deferred as static-authored animation, or loudly unsupported.
- Shells and residents share the established texture, atlas, material, and geometry primitives.
- No EnvCell-local transform leaks into a runtime contract that claims landblock space.
- Worker diagnostics cross the commit boundary as real consumption data, not ceremonial metadata.

### Phase 5 — Atomic Realization and Scene Publication

#### Deliverables

- Generalize `StaticLayerRealizer` and related outdoor-only names to accept scoped static artifacts
  while preserving existing layer behavior.
- Complete cell-shell GPU geometry ownership and aperture mask geometry ownership behind the
  existing `EnvCellSystem`.
- Publish typed `env-cell-shell` and `env-cell-static-residents` producer groups within each EnvCell
  scope. Retain dynamic residents in the established dynamic group when activated.
- Harden the current remove-then-install mutation into one environment-cell system transaction
  containing:
  - landblock root;
  - the landblock/outdoor scope used by building transitions;
  - EnvCell root scopes and landblock-space bounds;
  - cell-shell nodes;
  - resident static nodes with `envCellId`;
  - directed crossings and their authored aperture resources;
  - indoor visibility-island membership derived only from proven depth-continuous seams;
  - topology-mask and exterior-composite boundaries;
  - containment candidates;
  - authored potentially-visible references as non-authoritative provenance.
- Build outgoing portal adjacency keyed by source scope during scene publication.
- Roll back all installed nodes, scopes, crossings, textures, atlas leases, and geometry when any
  step fails or the layer receipt becomes stale.

#### Checklist

- [ ] Define one owner/release handle for the complete EnvCell layer transaction.
- [ ] Preserve each internal and building-transition crossing's independently authored aperture,
      accepted side, `ExactMatch`, and reciprocal identity; never synthesize it from the other
      direction.
- [ ] Union only proven indoor depth-continuous edges; keep scopes, residency, ownership, and
      outgoing adjacency independent inside an island.
- [ ] Build group bounds from the union of actual transformed member-node bounds and keep exact
      member-node AABB tests after aggregate acceptance.
- [ ] Cover a resident extending beyond the authored shell/cell AABB without false rejection.
- [ ] Verify identical producer group keys in different EnvCell scopes remain independent
      aggregates and dirty/rebuild independently.
- [ ] Never union an EnvCell scope with the landblock/outdoor scope.
- [ ] Reject duplicate scope IDs, dangling endpoints, invalid aperture resources, and inconsistent
      reciprocal links before mutation.
- [ ] Do not parent resident resources across `EnvCellSystem` and `StaticObjectSystem`; flatten
      transforms and retain scope identity.
- [ ] Eviction removes outgoing adjacency without scanning unrelated landblocks.
- [ ] Late-result rejection works before and during queued runtime commit draining.
- [ ] Resource accounting reaches zero after eviction and runtime destruction.

#### Acceptance

- A receipt installs all shells, residents, scopes, topology, and resources atomically.
- A stale or failed receipt installs none of them.
- Traversal lookup is proportional to visited scopes plus their outgoing crossings rather than all
  crossings in the scene.
- Layer eviction and reload restore identical scene/resource counts.
- Shell and resident group membership, aggregate bounds, and exact-node results remain stable across
  replacement, eviction, and reload.

### Resteering Gate A — Source and Ownership Audit

Pause after Phase 5 and inspect at least the small, rotated, resident-heavy, and portal-dense
fixtures.

#### Questions

- Are HBLB bytes dominated by duplicated CellStruct geometry or resident closure?
- Are CellStruct instances sharing only source geometry while retaining correct per-cell materials?
- Does any generic type now carry portal-only or outdoor-only fields?
- Does one layer release handle own every installed resource exactly once?
- Does every resident renderable, instance population, and culling group retain exactly one EnvCell
  scope while still sharing immutable source resources where valid?
- Are dense-grid adjacency counts and traversal costs consistent with the topology?
- Do any unsupported dynamic residents need a broader existing animation route before rendering can
  be called complete?

#### Acceptance

- Record measured counts, concessions, and course corrections under Plan Maintenance before Phase 6.
- Reshape contracts now if the source or ownership model is wrong; do not stabilize a bad wire
  format through renderer work.

### Phase 6 — Flat EnvCell End-to-End Rendering Midpoint

#### Deliverables

- Extend `RenderWorld` with read-only cell-shell and scoped-resident draw records for every resident
  EnvCell layer, independent of portal reachability.
- Add the typed `EnvCellRenderMode` to `FrameSettings` and route it through `ExplorerApp`,
  `GameRuntime`, and `Webgl2Renderer`. Use `flat` as the midpoint default.
- In flat mode, submit exterior terrain/buildings/objects plus all resident EnvCell shells and
  residents into the same ordinary main view. Retain ordinary node/frustum bounds rejection, but
  perform no portal traversal, aperture-mask draw, offscreen scene-domain render, or composite.
- Enumerate every resident EnvCell scope, reject its shell and static-resident producer groups by
  aggregate frustum bounds, then exact-test member nodes. Do not flatten all EnvCell nodes into one
  landblock-wide culling group.
- Submit shell and resident ranges through the existing object material programs and pass ordering.
- Bind environment detail to shells and the proven object/environment role to residents.
- Keep portal aperture geometry out of visible material draws.
- Force `BACK` culling for structured EnvCell shell ranges in flat mode. Keep authored culling for
  EnvCell residents and every other static range.
- Add renderer diagnostics for active mode, resident/visible scopes, visible nodes, submitted
  shell/resident ranges and triangles, shell-cull overrides, pass counts, and zero portal work.

#### Checklist

- [ ] Deduplicate each resident shell and resident range exactly once per ordinary view.
- [ ] Report EnvCell scopes, producer groups, and exact nodes tested/rejected independently.
- [ ] Verify an off-frustum resident group is rejected even when its cell shell intersects, and a
      protruding resident remains visible when the shell group is rejected.
- [ ] Keep EnvCell scope IDs on render records for picking, diagnostics, containment, and later
      portal planning even though flat scheduling ignores topology.
- [ ] Assert flat mode issues zero aperture, stencil, scene-domain-target, and composite work.
- [ ] Verify a bird's-eye exterior camera can inspect cell interiors because structured shells use
      forced back-face culling rather than rendering as opaque outward shells.
- [ ] Verify the cull override applies only to structured shell ranges; resident and outdoor
      materials preserve their authored cull mode.
- [ ] Preserve opaque, alpha-test, transparent, and additive ordering already established for
      objects.
- [ ] Exercise environment and object detail roles in a browser-visible fixture.
- [ ] Ensure malformed aperture data cannot reach a runtime “fail open” branch.
- [ ] Switch frame modes without content acquisition, resource rebuild, scene publication, or
      residency mutations.

#### Acceptance

- Explorer renders textured EnvCell shells and every supported resident from the canonical HBLB
  source path in the same main view as outdoors.
- Bird's-eye inspection exposes interior cell structure while resident objects retain correct
  material sidedness.
- The flat renderer performs no portal traversal or composition and remains usable after portal
  rendering ships.
- Browser harness runs without console, WebGL, stale-resource, or ownership errors.

### Resteering Gate B — Flat EnvCell Midpoint Audit

Pause after the first complete source-to-pixel path. Run the small, rotated, resident-heavy,
portal-dense, and bird's-eye fixtures with flat mode active.

#### Questions

- Do source, decoded, realized, scene, and submitted shell/resident counts reconcile?
- Do per-scope shell/resident group membership, aggregate bounds, and exact-node counts reconcile?
- Are landblock-space transforms, surface bindings, detail roles, blend passes, and authored
  resident culling correct?
- Does forced shell `BACK` culling expose useful bird's-eye structure without leaking to residents?
- Are ordinary frustum/node bounds enough to keep flat-mode overdraw usable in the selected dense
  fixtures?
- Does switching modes leave content/resource/scene ownership untouched?
- Did any worker batch or instance population cross an EnvCell scope to gain draw-call reduction?
- Did any provisional abstraction survive only to serve portal rendering that has not yet earned
  its shape?

#### Acceptance

- Record captures, counts, timing, shell-cull behavior, and lifecycle measurements under Plan
  Maintenance before adding residency or portal-rendering complexity.
- Fix source, material, transform, ownership, or flat-rendering defects at this midpoint; do not
  bury them under masks and offscreen composition.

### Phase 7 — Explorer Initial Placement via Bounds and Cell Containment

#### Deliverables

- Replace `queryWorldPointResidency` with a candidate-oriented scene query. Remove insertion-order
  first-match semantics.
- Add pure Cell containment evaluation using the projected positive-child plane chain and the
  retail epsilon.
- Add Explorer policy:
  1. use an explicitly selected EnvCell DID when valid;
  2. otherwise broad-phase scene scopes by AABB;
  3. transform the world point into each candidate CellStruct-local AC frame;
  4. test every containment hull;
  5. return resolved, ambiguous, outside, or topology-unavailable.
- Surface ambiguous/outside state in Explorer diagnostics without inventing a hidden tie-break.

#### Checklist

- [ ] Keep the pure candidate query in scene math and the selection policy in Explorer.
- [ ] Cover overlapping AABBs with exactly one BSP match, multiple BSP matches, and no BSP matches.
- [ ] Cover boundary epsilon and transformed/rotated cell placements.
- [ ] Do not use `BspNode::intersects_solid`; it is a physics sphere/solid query with different
      semantics.
- [ ] Preserve an explicit landblock/outdoor candidate where the current Explorer experience needs
      one.
- [ ] Remove or rewrite tests that enshrine first-insertion selection.

#### Acceptance

- Explorer can initialize inside a known EnvCell without crossing history.
- Overlapping cells never resolve by insertion order.
- Ambiguity is typed and inspectable.
- The result matches the retail `point_in_cell` algorithm for selected diagnostic fixtures.

### Phase 8 — Authoritative-Anchor Camera Portal Tracing

#### Deliverables

- Extract reusable pure aperture math:
  - signed plane side;
  - segment-plane intersection;
  - point-in-triangulated-aperture;
  - earliest outgoing directed crossing;
  - repeated portal-segment trace.
- Add a typed authoritative player/actor residency input at the client/runtime boundary. Do not
  derive it from camera or point containment.
- Update third-person camera coordination to trace from the player's authoritative position and
  cell to the desired camera endpoint.
- Return crossing history and explicit topology-unavailable state for diagnostics and safe caller
  policy.
- Keep obstruction/collision response out of this controller.
- Keep render near-plane intersection out of this controller. The camera eye has one
  topology-derived residency even when later portal rendering temporarily renders both sides.

#### Checklist

- [ ] Inspect only current-scope outgoing crossings at each trace step.
- [ ] Reject wrong-facing crossings before accepting an intersection.
- [ ] Trace claimed building/outside transitions in both authored directions and leave unclaimed
      outside endpoints explicitly unavailable.
- [ ] Select the smallest forward segment parameter and define deterministic boundary ties.
- [ ] Advance by one shared epsilon and guard against immediately re-crossing the same aperture.
- [ ] Bound maximum crossings by topology size or another structurally justified limit.
- [ ] Cover no crossing, one crossing, multiple crossings, overlapping destination cells,
      non-rectangular aperture misses, boundary hits, coplanar segments, and cycles.
- [ ] Preserve player residency when the camera trace cannot complete.
- [ ] Do not add a straddling/overlap residency variant to camera trace results.

#### Acceptance

- A camera endpoint inside a spatially overlapping but unconnected EnvCell does not switch scope.
- A camera segment through one or more directed apertures ends in the topology-derived scope.
- Reverse-direction and wrong-facing traces are rejected according to the proven side convention.
- Client camera residency depends on authoritative player state plus crossing history, while
  Explorer initialization remains the separate best-effort containment path.

### Resteering Gate C — Topology, Camera, and Portal Readiness Audit

Pause before GPU portal work. Run the portal-dense, arbitrary-aperture, transition, overlap, and
third-person camera fixtures with topology/query diagnostics enabled.

#### Questions

- Do outgoing adjacency, visibility-island, topology-boundary, and exterior-transition counts match
  the selected source fixtures?
- Are directed segment-facing rejections stable near aperture planes and under rotated queries?
- Are camera traces oscillating on boundaries or exhausting crossing guards?
- Does the authored potentially-visible candidate set improve residency/preload work without being
  misused as a traversal rejection?
- Do the tunnel, multi-window, non-Euclidean, non-exact reciprocal, and near-plane corner fixtures
  exercise every locked renderer hazard before GPU implementation begins?
- Do the selected WebGL color/depth-stencil formats and sampling requirements have browser support,
  or must Phase 9 revise the target contract before resource ownership hardens?
- What topology-derived upper bound should Phase 9 use for synthetic stencil overflow coverage while
  reserving stencil value `0` for the base scope?

#### Acceptance

- Record topology/query measurements, browser capability evidence, and fixture coverage under Plan
  Maintenance.
- Enter Phase 9 only when flat rendering, containment, and camera trace remain independently green.
- Do not let the existing `VisibleScene.crossings` shape dictate stencil architecture; the locked
  contract requires path-local ancestry.

### Phase 9 — Portal GPU Substrate

This phase builds and proves renderer mechanics without switching production rendering away from
the accepted flat path.

#### Deliverables

- Upload/reuse arbitrary aperture geometry as material-free mask resources.
- Add resize-safe renderer-owned scene-domain targets:
  - one exterior source target with color plus sampleable depth/stencil;
  - one composite destination;
  - a second composite ping-pong target only if an executable pass proves framebuffer feedback
    otherwise unavoidable.
- Add a source-scene copy program that samples color and depth, writes `gl_FragDepth`, and obeys an
  active stencil mask.
- Add a small explicit renderer state owner for framebuffer, viewport, color/depth/stencil, blend,
  cull, texture, and VAO transitions plus restoration.
- Add pure finite-near-plane-quad versus triangulated-aperture intersection math using the exact
  active camera projection facts, with one tested rendering epsilon.
- Add deterministic resize, disposal, context-loss, recursion-limit, and stencil-overflow behavior.
- Add synthetic GPU fixtures for mask nesting/restoration, color-plus-depth copy, target lifecycle,
  arbitrary aperture shapes, and near-plane edge/coplanar/degenerate contacts.

#### Checklist

- [ ] Allocate no framebuffer or texture per aperture, cell, island, or path.
- [ ] Keep aperture masks material-free and clipped child frusta out.
- [ ] Restore every mutated WebGL state after each synthetic mask/composite pass.
- [ ] Test the finite near-plane quad, not camera-point distance or aperture AABB overlap.
- [ ] Keep `flat` production rendering and its shell-cull policy unchanged while this substrate is
      developed.
- [ ] Ensure substrate diagnostics are consumed by fixtures or remove them.

#### Acceptance

- Synthetic masks constrain color and sampled-depth composition without state leakage.
- Targets resize, dispose, and recover without stale attachments or leaked GPU resources.
- Near-plane/aperture math handles arbitrary planar triangulations and rejects contacts outside the
  actual aperture.
- Flat mode remains the stable end-to-end renderer.

### Phase 10 — Exterior Transition Composition

#### Deliverables

- Render the complete established exterior terrain/building/object pass sequence at most once per
  frame whenever the exterior is the root or a reached transition requires it.
- Treat every `exterior-transition` as a mandatory scene-domain boundary; never collapse one into a
  depth-continuous indoor seam.
- Implement both root directions:
  - exterior root seeds the composite from exterior color/depth, establishes each accepted
    transition mask, resets/replaces depth inside it, and renders reached indoor content;
  - interior root renders indoor content, then copies cached exterior color/depth through every
    exact reached outdoor mask without redrawing exterior geometry.
- Derive exterior-transition dual-side render seeds when the finite near plane intersects the
  actual aperture. Keep the authoritative eye-side root and all residency unchanged.
- Add tunnel, multi-window, exterior-root, interior-root, exterior-straddle, and
  indoor → outdoor → indoor fixtures; decide composite ping-pong from the executable feedback case.

#### Checklist

- [ ] Assert exterior scene-domain render count is zero or one per frame.
- [ ] Copy exterior color and sampled depth through every transition; color-only composition is
      invalid.
- [ ] Validate the exact WebGL depth function with nearer exterior geometry over an
      outdoor-to-indoor aperture before the masked depth reset.
- [ ] Treat unavailable/stale domain resources as typed unavailable work; never reuse a prior frame.
- [ ] Keep transparent/additive ordering correct and constrained by transition masks.
- [ ] Preserve one exterior render when an exterior transition straddles the near plane.
- [ ] Keep flat mode selectable and byte-for-byte independent of offscreen target availability.

#### Acceptance

- Terrain depth cannot cover an indoor tunnel visible through an accepted exterior transition.
- Exterior geometry renders at most once with any number of transition apertures.
- Outdoor-root and indoor-root views composite color and depth correctly through arbitrary planar
  transitions.
- Exterior near-plane straddles show both sides without black regions, flicker, or residency
  changes.

### Phase 11 — Internal Topology Masks and Portal Mode

This phase completes the hybrid renderer: ordinary depth inside proven visibility islands,
path-local stencil only at unproven/non-Euclidean boundaries, and the Phase 10 exterior-domain
composition at every outdoor transition. It does not import the legacy breadth/frame-plan graph.

#### Deliverables

- Build the renderer-local hybrid work plan:
  - traverse from the selected camera scope using the original frustum, scope/node and aperture
    bounds, outgoing adjacency, cycle prevention, and directed camera-facing rejection;
  - render each reached indoor visibility island through ordinary depth;
  - carry path-local ancestry only across `indoor-topology-boundary` edges;
  - delegate every `exterior-transition` to the Phase 10 composition path.
- After topology selects scopes, run the same per-scope shell/static-resident group broad phase and
  exact member-node tests used by flat mode. Portal mode changes scope selection and masking, not
  spatial-index membership or batching.
- For non-`ExactMatch` internal links, intersect both authored aperture masks along the active path.
- Derive topology-bounded dual-side seeds for every near-plane-intersected internal boundary.
  Bypass facing only for the intersected seed edge, continue until closure, and retain the current
  parent stencil region.
- Activate `portal` mode, expose the Explorer `Portal rendering` control, and make portal mode the
  default only after this phase's acceptance suite passes. Preserve flat mode permanently.
- Report active mode, visited scopes, facing/frustum rejections, island submissions, mask paths,
  stencil depth, near-plane intersections/closure, exterior inclusion, and draw/composite counts.
- Add browser fixtures for dense grids, nested/non-Euclidean boundaries, non-exact reciprocal
  apertures, both-direction/exact-contact straddles, concave apertures, four-cell corners, and every
  established material pass.

#### Checklist

- [ ] Reject apertures that do not face the camera/traversal origin except for the exact
      near-plane-intersected seed edge.
- [ ] Retain conservative overdraw and do not introduce portal-clipped child frusta.
- [ ] Keep visibility-island scheduling from merging culling groups, nodes, or draw submissions
      across EnvCell scopes.
- [ ] Prove flat and portal modes return identical group/node results when given the same explicit
      selected-scope set.
- [ ] Seed every topology-connected side whose actual aperture intersects the near plane; do not
      use a fixed hop count.
- [ ] Keep dual-side seeds inside their existing parent stencil region and leave player, camera,
      and Explorer residency unchanged.
- [ ] Bound topology-mask depth and fail loudly on overflow.
- [ ] Verify exact reciprocal crossings share geometry only where equivalence is proven.
- [ ] Verify non-exact reciprocal apertures intersect without sibling/union leakage.
- [ ] Verify portal mode owns its shell-sidedness policy while flat mode still forces `BACK`
      culling only for structured shells.
- [ ] Toggle modes without content reload, GPU resource rebuild, scene republish, or residency
      mutation.
- [ ] Compare captures, draw/composite counts, GPU bytes, and timing against the Phase 6 flat
      baseline.

#### Acceptance

- Proven indoor visibility islands spend no masks on uniform subdivision seams.
- Unproven/non-Euclidean child geometry is visible only through its path-local topology masks.
- Crossing an internal portal with the camera near plane produces no black frame, flickering side
  selection, or missing adjacent branch.
- Multi-portal corner contact computes the complete topology-bounded seed closure without changing
  residency.
- Nested and adjacent masks do not leak into siblings or later passes.
- Explorer can switch between accepted portal rendering and the permanent bird's-eye-friendly flat
  mode at runtime.
- The renderer remains app-local and preserves the useful legacy scene-domain and flat-inspection
  behaviors without importing the legacy frame-plan hierarchy.

### Phase 12 — Cleanup, Documentation, and Full Verification

#### Deliverables

- Remove superseded outdoor-only aliases, old detail-owner policy, first-match residency APIs,
  duplicate geometry helpers, and unused compatibility paths.
- Update `apps/holtburger-3d/ARCHITECTURE_AUDIT.md` with the final source, ownership, scene, query,
  and renderer boundaries.
- Update relevant DAT/file-format documentation with proven CellStruct surface, Cell BSP, portal
  side, and potentially-visible semantics.
- Add permanent synthetic tests for pure contracts and retain archive-backed diagnostics only as
  opt-in harnesses.
- Record final fixture metrics and known concessions.

#### Checklist

- [ ] Search for obsolete `OutdoorStaticLayerKind`, `ActiveRegionObjectDetailOwner`, and
      `queryWorldPointResidency` uses.
- [ ] Verify no env-cell-specific copy of object texture/material/atlas closure remains.
- [ ] Verify no aperture is represented as a textured material range.
- [ ] Verify diagnostics fields are consumed by harness/UI/audit or remove them.
- [ ] Run formatting, frontend tests/checks/lints/build, Rust tests/checks/clippy, and browser
      harnesses.
- [ ] Confirm `git diff` contains no generated captures, runtime assets, or unrelated submodule
      changes.

#### Acceptance

- The final architecture has one cumulative source batch, one generalized polygon primitive, one
  static material pipeline, specialized interior/topology/query contracts, and renderer-local
  stencil policy.
- All touched lint and clippy warnings are resolved rather than suppressed.
- Permanent tests are deterministic without local client archives.
- Architecture and format docs distinguish proven facts from deferred behavior.

## Verification Matrix

Run focused checks during each phase, then the full matrix in Phase 12.

### Rust

```bash
cargo fmt --all -- --check
cargo test -p holtburger-content
cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml
cargo clippy -p holtburger-content --all-targets -- -D warnings
cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D warnings
```

Adjust package selectors only if the workspace manifest proves different names. Do not replace
targeted checks with repository-wide churn unrelated to this plan.

### Frontend

From `apps/holtburger-3d`:

```bash
npm run test:ts
npm run check
npm run lint
npm run check:terrain-shader
npm run build
```

### Browser and Diagnostic Coverage

- Existing terrain/building/outdoor-object harness routes remain green.
- Small interior: source-to-render counts, shell texture correctness, and one reciprocal crossing.
- Arbitrary aperture: non-rectangular and non-axis-aligned facing, crossing, and stencil mask.
- Resident-heavy interior: authored/static/deferred/materialized counts and transform composition.
- Dense grid: outgoing adjacency, visited scopes, shell/resident group membership, aggregate versus
  exact-node rejections, overdraw, stencil depth, and frame counts.
- Tunnel transition: outdoor terrain depth plus an EnvCell one edge underground; verify masked
  color/depth composition exposes the interior without redrawing exterior.
- Multi-window interior: several accepted outdoor crossings reuse one exterior render and preserve
  exterior depth through every composite.
- Near-plane straddle: both approach directions, exact contact, outside-aperture rejection,
  arbitrary aperture shape, four-cell corner closure, and exterior reuse.
- Overlap case: Explorer ambiguity plus authoritative camera trace connectivity.
- Lifecycle: load, evict to zero resources/nodes/crossings, reload, destroy.
- Synthetic material fixture: building/environment/object detail roles plus every established blend
  class behind a portal mask.

Do not run the TUI. Archive-backed diagnostics and browser runs are non-interactive and opt-in.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| EnvCell surface indices differ from GfxObj material slots. | Keep CellStruct adapter specialized and prove indexing before wire stabilization. |
| Portal polygon winding or `PortalSide` is interpreted backward. | Capture both directions from retail/ACE, retain source flags, and test reciprocal accepted sides. |
| Arbitrary apertures are accidentally treated as convex quads. | Preserve source triangulation and use point-in-triangle union after plane intersection. |
| Dense portal grids make traversal quadratic. | Build outgoing adjacency at publication and measure visited scopes plus outgoing edge counts. |
| Overlapping non-Euclidean cells make point residency nondeterministic. | Reserve point containment for Explorer bootstrap; use authoritative residency and portal traces in client mode. |
| Full Cell BSP transport expands scope into collision. | Project the retail point-containment plane chain only; retain canonical full BSP in Rust for future consumers. |
| Resident transforms are applied twice or in the wrong coordinate frame. | Compose once at materialization, name the result landblock-space, and test non-identity parent/child rotations. |
| Static batching merges residents from different EnvCell scopes. | Partition by `envCellId` before geometry/material/pass batching; share immutable resources but forbid multi-scope nodes, instance populations, and draw submissions. |
| An authored cell AABB excludes a protruding resident. | Build producer-group aggregates from actual transformed member-node bounds and retain exact node tests after the group broad phase. |
| Visibility islands become accidental culling/ownership groups. | Use islands only for ordinary-depth scheduling; keep scope indexes, producer groups, nodes, and submissions independently addressable per EnvCell. |
| Generic geometry refactor erases domain semantics. | Generic builder owns mechanics; GfxObj and CellStruct adapters own selection and material-slot meaning. |
| Detail textures remain hard-coded to buildings. | Introduce semantic roles before EnvCell rendering and make missing roles explicit. |
| Atomic publication leaks mixed system ownership. | One transaction/release handle owns all layer resources; transforms are flattened and scope IDs cross systems. |
| Flat shell culling leaks onto residents or becomes accidental global GL state. | Apply forced `BACK` culling only while submitting typed structured-shell ranges; assert authored resident/outdoor culling before and after the shell draw. |
| Portal work breaks the useful flat diagnostic path. | Keep `flat` as a permanent typed frame mode, require zero portal work in that mode, and run its bird's-eye/lifecycle baseline through Phases 9–12. |
| A heuristic elides a required portal mask. | Only proof-backed indoor seams enter visibility islands; every unproven internal edge masks and every exterior edge composites. |
| Terrain depth covers an underground interior behind an exterior portal. | Treat every indoor/outdoor transition as a mandatory color-plus-depth composite boundary and test a tunnel fixture. |
| Exterior geometry is redrawn through every window. | Render one exterior scene-domain target per camera frame and reuse its sampled color/depth through every mask. |
| Offscreen targets add memory, resize, or lifecycle leaks. | Allocate renderer-owned extent-keyed targets, measure bytes, dispose transactionally, and add resize/context-loss coverage. |
| Color-only composition breaks later depth and transparency. | Source-scene copy samples and writes depth; cover every established blend class and both root directions. |
| A portal mask degenerates when the camera near plane intersects its aperture. | Detect the finite near-plane/aperture intersection renderer-side and seed both adjacent branches inside the current parent region. |
| Straddle handling mutates or destabilizes residency. | Keep it stateless and renderer-local; camera/player residency remains eye/history-derived. |
| Camera-point or AABB overlap produces false straddles. | Intersect the finite near-plane quad with actual aperture triangles and test outside-aperture contacts. |
| Transparent draws leak outside portal masks. | Include all established blend passes in synthetic stencil fixtures and specify state restoration. |
| Authored PVS is over-trusted. | Preserve it as preload/containment-candidate provenance; never use it to reject portal traversal. |
| Diagnostics become ceremonial. | Every metric must feed a harness assertion, UI inspection, audit decision, or be removed. |

## Definition of Done

- [ ] Environment cells are a first-class independent HBLB record requested through
      `LandblockSourceBatchSource`.
- [ ] The host resolves `LandblockInteriorSystemAsset` only for an EnvCells request.
- [ ] CellStruct shell geometry, materials, apertures, containment, topology, and residents cross a
      strict versioned binary boundary.
- [ ] GfxObj and CellStruct share a focused polygon geometry primitive without conflated semantics.
- [ ] Building, environment, and object detail textures work through semantic active-region roles
      for every supported static layer.
- [ ] Every authored EnvCell static resident is materialized, explicitly deferred, or loudly
      unsupported.
- [ ] Cell shells and residents use landblock-space transforms and retain EnvCell scope identity.
- [ ] Resident batching is partitioned by EnvCell scope; no baked node, instance population,
      transparent population, or draw submission spans multiple EnvCells.
- [ ] Each EnvCell scope owns independent shell and static-resident producer groups whose aggregate
      bounds union actual transformed members before exact node tests.
- [ ] Flat and portal modes share the same culling-group and exact-node query policy after their
      intentionally different scope-selection steps.
- [ ] EnvCell layer publication and eviction are atomic and leak-free.
- [ ] Scene traversal uses source-keyed outgoing adjacency, original camera frustum, bounds, facing,
      and cycle prevention.
- [ ] Claimed outside/building portals connect the landblock/outdoor scope and EnvCell scopes using
      both authored aperture records; unresolved claims remain explicit.
- [ ] Proof-backed indoor visibility islands render ordinary spatial seams without masks; every
      unproven indoor edge remains a topology-mask boundary.
- [ ] No portal-clipped child frusta are introduced.
- [ ] Flat mode renders all resident EnvCell shells and residents in the ordinary main view, issues
      no portal/offscreen work, and remains permanently selectable.
- [ ] Flat mode forces `BACK` culling only for structured EnvCell shell ranges so bird's-eye
      inspection can see cell interiors; resident and outdoor materials retain authored culling.
- [ ] Explorer exposes a typed `Portal rendering` control whose mode switch causes no content
      reload, resource rebuild, scene republish, or residency mutation.
- [ ] Explorer initial placement uses AABB candidates plus retail-equivalent Cell BSP containment
      and preserves ambiguity.
- [ ] Client camera residency traces from authoritative player residency through directed arbitrary
      planar apertures.
- [ ] Aperture geometry is material-free.
- [ ] Every indoor/outdoor transition composites cached scene-domain color and depth through an
      arbitrary planar mask.
- [ ] Exterior terrain, buildings, and objects render at most once per camera frame regardless of
      transition count.
- [ ] Path-local stencil handles unproven/non-Euclidean indoor boundaries and established object
      pass ordering without importing the legacy frame-plan architecture.
- [ ] Finite near-plane/aperture straddles render both adjacent branches without black regions or
      residency changes.
- [ ] Straddle closure handles multi-portal corners without camera-point slabs, aperture AABBs, or
      fixed-hop traversal.
- [ ] Existing outdoor render paths and lifecycle behavior remain green.
- [ ] Synthetic tests require no local DAT/HBA assets; selected archive-backed diagnostics and
      browser harnesses pass.
- [ ] Architecture and file-format documentation reflect the final proven contracts.
- [ ] No dead compatibility types, unconsumed diagnostics, lint ignores, staged files, or commits
      are left behind.

## Implementation-Time Validation Questions

These measurements can tune an implementation but cannot change the locked semantic contracts:

1. Which CellStruct source geometry is equivalent enough to deduplicate without merging per-cell
   surface bindings or transforms?
2. Which explicit topology-mask mutation/restore sequence is least stateful and most robust across
   every established object blend pass in WebGL2?
3. Does the measured render graph need a second composite ping-pong target, or can one exterior
   source plus one composite destination cover every non-feedback pass?
4. What practical portal recursion cap follows from the selected archive fixtures, with stencil
   overflow remaining a loud failure?
5. What single rendering epsilon makes near-plane/aperture edge and coplanar contact stable across
   the selected coordinate scales without introducing false dual-side seeds?
6. Does the potentially-visible candidate set materially improve preload or Explorer containment
   discovery enough to justify consuming it beyond diagnostics?
7. Which static-authored animation capability should be implemented in a later plan before deferred
   residents can become live without abusing spawned-dynamic ownership?

## Decisions

### 2026-07-27 — Evidence Finalization

- CellStruct shells render all authored render polygons; only polygon emission is generalized with
  GfxObj.
- Surface slots are signed, direct, and zero-based.
- Detail texture roles follow render domain while source surfaces retain independent eligibility:
  landscape, building, environment, and object.
- Portal flags decode to an explicit authored-plane accepted side. Reciprocal crossings retain
  their own geometry and direction; reverse crossings are never synthesized.
- EnvCell outside endpoints pair with LandblockInfo building portal claims. Their two authored
  apertures form directed crossings between the landblock/outdoor and EnvCell scopes.
- Potentially-visible cell lists are candidate/preload provenance, not connectivity or visibility
  rejection.
- Explorer bootstraps with AABB candidates plus the retail positive-chain containment test. Client
  and third-person camera residency remain historical and portal-directed.
- Setup-default-animation Stabs remain explicitly deferred static-authored residents until a shared
  static-animation route exists.
- Portal masks are material-free. Proven indoor depth-continuous seams form ordinary-rendered
  visibility islands; every unproven internal edge retains path-local topology masking.
- Every indoor/outdoor transition remains a mandatory composite boundary. Exterior geometry
  renders once into reusable color/depth and is never redrawn per opening.
- Near-plane straddling is renderer-only view ambiguity. It temporarily seeds both adjacent
  branches but never changes authoritative player/camera residency.
- Flat EnvCell rendering is a permanent first-class diagnostic mode. It draws resident cells in the
  ordinary main view and intentionally forces back-face culling only on structured shell ranges,
  preserving the legacy bird's-eye inspection behavior.
- Portal rendering is a frame setting, not a materialization or residency mode. The Explorer
  control can switch it at runtime without rebuilding resources or changing topology state.
- EnvCell scope is the static batching and culling partition. Shell and static-resident producer
  groups remain separate within that scope; geometry resources may be shared across scopes, but
  nodes, instance populations, and draw submissions may not.
- Visibility islands never merge culling or ownership identity. Flat mode selects all resident
  scopes and portal mode selects topology-reachable scopes, after which both use the same
  group-bounds and exact-node tests.

## Course Corrections

### 2026-07-27 — Hybrid Indoor/Exterior Portal Rendering

- Rejected stencil masking on every internal portal. Uniform grid subdivisions would spend mask
  work without improving spatial correctness; only conservatively proven indoor seams may join a
  depth-rendered visibility island, and uncertainty still masks.
- Rejected view-dependent mask inheritance based on projected aperture coverage. It can expose
  overlapping or non-Euclidean children outside their real portal path.
- Rejected treating a spatially matched exterior transition as an ordinary depth-continuous seam.
  Terrain can write depth over cells immediately behind a tunnel entrance even when the transition
  apertures align.
- Retained the useful legacy renderer invariant proven in
  `Webgl2Renderer.#renderSceneDomainTarget`, `#renderOutdoorProjectionComposite`,
  `#drawPortalProjectionOutdoorCrossings`, and `SOURCE_SCENE_COPY_FRAGMENT_SHADER`: render exterior
  once, then composite cached color and sampled depth through portal masks.
- Phase 2 now classifies only indoor spatial continuity; Phase 5 publishes that classification;
  Phases 9–11 build the portal substrate, exterior composition, and internal topology masks.

### 2026-07-27 — Near-Plane Straddle Correction

- Preserved legacy's successful behavior of rendering both adjacent sides while a portal mask is
  geometrically ambiguous.
- Rejected legacy's camera-point plane slab as the trigger. The actual failure occurs when the
  finite camera near plane intersects the portal aperture while the eye can remain unambiguously
  resident on one side.
- Rejected padded aperture AABB containment and fixed one-hop expansion. Phases 9–11 instead
  intersect the finite near-plane quad with actual aperture triangles and compute a visited,
  topology-bounded seed closure.
- Kept the correction entirely in renderer work planning. Phase 7 containment, Phase 8 camera
  portal tracing, and authoritative residency contracts remain unchanged.

### 2026-07-27 — Flat Rendering Midpoint and Portal Phase Split

- Replaced the former Phase 6 portal-traversed renderer with a complete flat source-to-pixel
  midpoint. Materialization, transforms, materials, residents, lifecycle, and ordinary render
  submission can now be accepted before portal composition obscures their failures.
- Preserved the legacy flat-vision culling policy proven in
  `applyStructuredInteriorCullState`: flat mode forces `BACK` culling for structured EnvCell shells
  so an exterior bird's-eye camera does not see opaque shells. The override explicitly excludes
  resident and outdoor materials.
- Kept flat mode as a permanent Explorer feature rather than a temporary fallback. `portal` and
  `flat` are typed frame policies over the same resident resources and scene graph.
- Split the former portal mega-phase into GPU substrate, exterior transition composition, and
  internal topology masks. Exterior tunnel correctness and render-once reuse now earn acceptance
  before path-local internal stencil and near-plane closure are layered on top.

### 2026-07-27 — EnvCell Culling-Group and Batching Boundary

- Made the current `SceneGraph` hierarchy explicit: scope and landblock partition producer culling
  groups before aggregate bounds and exact member-node tests. Reusing a group key across cells does
  not create one dungeon-wide aggregate.
- Selected separate `env-cell-shell` and `env-cell-static-residents` groups within each EnvCell
  scope so either producer set can be rejected independently.
- Prohibited cross-EnvCell resident batching. Immutable geometry/material resources remain
  shareable, but a baked node, instance population, transparent population, or draw submission must
  have exactly one EnvCell scope.
- Rejected visibility islands as culling groups. Islands affect render scheduling only; flattening
  their scopes would erase the topology identity required by masks, residency, picking, and
  lifecycle.
- Required aggregate bounds to union actual transformed members rather than assuming the authored
  shell AABB contains every resident.

## Plan Maintenance

After each completed phase, append:

- date and phase status;
- relevant source/render/resource counts;
- verification commands and fixtures;
- concessions or newly discovered debt;
- decisions and course corrections;
- cleanup targets for the next phase.

Do not silently rewrite completed phase history. Amend the forward plan and record why.
