# Holtburger 3D Environment-Cell End-to-End Integration Plan

Status: Complete — Phases 1–15 and Resteering Gates A–G complete
(2026-07-28)

## Context and Boundaries

### Goal

Materialize one landblock's complete environment-cell system through the existing content,
interest, resource, scene, and WebGL pipelines so Explorer can render textured cell structures and
their residents, traverse their directed portal topology conservatively, and establish camera
residency without treating spatial overlap as authoritative connectivity.

The implementation must also close the current static-material detail-texture parity gap. Building
and environment detail roles are active-region resources selected by their shell render domains.
Ordinary objects, including environment-cell residents, do not consume a detail texture in the
proven retail D3D path.

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
- The first Phase 10 planner applied only the original camera frustum and camera-facing rejection,
  then enumerated distinct simple topology paths. Gate E proved that model unusable: one archive
  fixture exceeded 100,000 work items at stencil depth 14. The failed planner is not a compatibility
  surface and must be purged before replacement.
- Legacy projection planning establishes one render entry per EnvCell and attaches all incoming
  mask edges to that unique entry. Its executor unions masks by render layer, resets depth once for
  the layer, and draws each entry once. The replacement planner must preserve that
  correct-by-construction contribution ownership; exact portal windows are visibility-propagation
  state, not geometry-submission identities.
- The object shader supports a detail overlay, but `ActiveRegionObjectDetailOwner` currently
  prepares only the building-detail role and the renderer applies it to every object material with
  the raw detail flag. That is a policy gap, not an environment-cell-only concern.

### Terminology

| Term                          | Meaning                                                                                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment-cell system       | All EnvCells, CellStructs, directed portal topology, cell surfaces, and authored residents owned by one landblock.                                                                                                                                    |
| Cell structure                | The selected `CellStruct` inside an Environment, instanced by one EnvCell with EnvCell-selected surfaces.                                                                                                                                             |
| Authored aperture             | Material-free planar polygon from one directed portal record. It retains the source plane, side, and geometry used by residency and spatial queries.                                                                                                  |
| Effective visibility aperture | The single material-free aperture used by render planning and GPU masks. It is either the authored source aperture or a host-preprocessed planar intersection with a validated non-`ExactMatch` reciprocal.                                           |
| Cell shell                    | Textured render geometry selected from a CellStruct for one EnvCell. It excludes aperture mask geometry.                                                                                                                                              |
| Resident                      | A static-object reference authored by an EnvCell. Its source placement is already landblock-local; the EnvCell supplies residency and visibility scope, not transform parenting.                                                                      |
| EnvCell culling group         | A producer-specific aggregate broad-phase inside one EnvCell scene scope. Groups reject member sets by their unioned transformed bounds before surviving nodes receive exact AABB tests.                                                              |
| Indoor visibility island      | EnvCell scopes connected only by conservatively proven depth-continuous indoor seams. Its scopes retain independent topology/residency identity but can render as one ordinary spatial domain.                                                        |
| Scene domain target           | Renderer-owned offscreen color and sampleable depth for a scene domain such as the exterior. It is rendered once and reused through portal composites.                                                                                                |
| EnvCell render mode           | Permanent frame-level presentation policy: `flat` draws resident EnvCell content in the ordinary main view, while `portal` applies topology masks and exterior scene-domain composition.                                                              |
| Authoritative residency       | The cell identity carried by gameplay or movement state and updated by directed portal crossings.                                                                                                                                                     |
| Explorer placement residency  | Best-effort initial scope selection when no crossing history exists. It is allowed to be ambiguous.                                                                                                                                                   |
| Camera residency              | A view scope derived from an authoritative player cell plus a directed segment to the desired camera position.                                                                                                                                        |
| Near-plane straddle           | A renderer-only condition where a topology-mask or exterior portal aperture intersects the finite clipped volume between the camera eye and near-plane quad. Both adjacent render branches are seeded without changing camera or player residency.    |
| Portal view window            | An exact camera-dependent normalized-device-coordinate region produced after homogeneous clipping and surviving every aperture crossed by one render-planning route. It is renderer-local, material-free, and unrelated to actor or camera residency. |
| Portal render node            | The unique per-view executable owner for one reached render domain. Alternate portal routes add incoming visibility and mask edges to this node; they never create additional geometry submissions for it.                                            |
| Portal render layer           | An ordered set of unique render nodes reached at the same derived mask depth. The executor unions the layer's admitted aperture masks, resets depth once inside that union, and draws every member node once.                                         |
| Detail role                   | An active-region semantic texture binding consumed by a proven render domain: landscape for terrain, building for building shells, or environment for CellStruct shells.                                                                              |

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
- Preserve each authored source aperture for spatial queries while deriving one effective
  visibility aperture per directed crossing before the host record crosses into TypeScript.
  Validated non-`ExactMatch` reciprocals are intersected once in landblock space; render planning
  and GPU execution never receive a paired-aperture operation.
- Materialize every supported EnvCell resident through the existing object presentation closure,
  geometry, texture, atlas, and draw-material paths.
- Preserve authored landblock-space resident transforms while retaining the owning `envCellId` as
  typed scope identity.
- Partition resident render batching by EnvCell scope before geometry/material/pass batching. Source
  geometry and immutable GPU resources may be shared across cells, but no scene node, instance
  population, or draw submission may claim residents from multiple scopes.
- Publish separate shell and static-resident culling groups inside each EnvCell scope. Aggregate
  bounds come from actual transformed member-node bounds rather than trusting the authored cell
  shell AABB to contain every resident.
- Generalize active-region static detail resources to building and environment roles, select the
  correct role per shell domain, and represent ordinary-object domains explicitly as no detail.
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
- Propagate exact clipped portal view windows from the root camera view, rejecting empty windows
  before scheduling target cells or scene-domain operations. Use bounds only as a broad phase.
- Keep clipped windows renderer-local. They may drive planning rejection and scissor bounds, but
  they do not replace exact GPU aperture masks or leak into containment, motion, or camera-residency
  queries.
- Add pure planar-aperture queries for point-in-aperture, directed segment crossing, earliest
  crossing, and repeated portal tracing.
- Replace first-match point residency with candidate-oriented AABB broad phase plus Cell BSP
  containment for Explorer initial placement.
- Provide a runtime query primitive that derives a future client camera's residency from
  caller-supplied authoritative actor state and a directed actor-to-camera segment; production
  client/controller ownership remains deferred.
- Conservatively classify proven depth-continuous indoor seams during host projection; leave every
  unproven internal edge as a topology-mask boundary.
- Design and implement hybrid portal rendering as a separate late phase:
  - ordinary depth rendering inside proven indoor visibility islands;
  - exact ordered stencil masks at unproven/non-Euclidean indoor boundaries selected by surviving
    portal view windows;
  - mandatory scene-domain composition at every indoor/outdoor transition.
- Render the exterior scene domain at most once per camera frame into offscreen color and depth,
  then composite both through every applicable transition mask.
- Detect intersections between actual aperture triangles and the finite camera near-clip volume, then temporarily seed
  both adjacent render branches to prevent degenerate masks, black regions, and side flicker.
- Add synthetic tests, host diagnostics, and non-interactive browser-harness coverage. Permanent
  tests must not require uncommitted DAT or HBA assets.
- Update architecture and file-format documentation with facts proven during implementation.

### Out of Scope

- CPU clipping of scene meshes or collision geometry. Portal view windows clip visibility regions;
  ordinary scene geometry remains GPU-rendered.
- Using coarse screen tiles, rectangles, or aperture bounds as authoritative portal visibility.
  Conservative approximations may broad-phase exact clipping but may not erase an exact route or
  become the final render mask.
- Using renderer portal windows for actor residency, camera residency, collision, containment, AI,
  sound, or other general spatial queries.
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
- `apps/holtburger-3d/src-tauri/src/portal_geometry.rs`
- `apps/holtburger-3d/src-tauri/src/env_cell_source.rs`
- `apps/holtburger-3d/src-tauri/src/bin/inspect_interior_projection.rs`
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

| Question                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                            | Locked contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CellStruct render selection  | Retail `CEnvCell::UnPack` passes `structure->num_polygons` and `structure->polygons` to `D3DPolyRender::ConstructMesh`; `RenderDeviceD3D::DrawEnvCell` queues the same complete polygon collection.                                                                                                                                                                                                                                                 | Cell shells emit every CellStruct render polygon. The generic builder shares polygon mechanics only; GfxObj retains its drawing-BSP selection adapter.                                                                                                                                                                                                                                                                                                                                                                                |
| EnvCell surface slots        | Retail `D3DPolyRender::DrawPolyInternal` indexes the current EnvCell surface array directly with `pos_surface`; ACE `Polygon` preserves signed positive/negative surface indices.                                                                                                                                                                                                                                                                   | Non-negative polygon surface indices are direct zero-based slots into `EnvCell.surfaces`; negative means no surface for that side. Out-of-range non-negative slots are malformed.                                                                                                                                                                                                                                                                                                                                                     |
| Point containment            | Retail `CEnvCell::point_in_cell` transforms into cell-local space and calls `CCellStruct::point_in_cell`, which follows the positive child while rejecting signed plane distances below `-0.0002`.                                                                                                                                                                                                                                                  | Explorer transports the normalized positive-child plane chain and uses the retail `0.0002` epsilon. The full collision BSP remains canonical Rust data but does not cross the app boundary for this query.                                                                                                                                                                                                                                                                                                                            |
| Portal side                  | Retail `CCellPortal::UnPack` decodes `portal_side = (~flags >> 1) & 1`; `PView::InitCell`/`ConstructView` accept the positive plane side for decoded side `0` and the negative side for decoded side `1`. ACE confirms raw `PortalSide = 0x02` and its inverted accessor.                                                                                                                                                                           | Raw flag `0x02` selects the authored plane's positive accepted side; a clear bit selects its negative side. Preserve authored plane/winding and store the accepted side explicitly.                                                                                                                                                                                                                                                                                                                                                   |
| Reciprocal portals           | Retail `PView::ClipPortals` calls `OtherPortalClip` for non-`ExactMatch` links, transforming and clipping against the target portal's own polygon and side. The 2026-07-28 archive census found 110,316 validated non-exact internal reciprocal directions: 109,637 coplanar within `0.0002`, all within `0.001`, with maximum deviation `0.00090026855`; no canonical exterior transition was non-exact.                                           | Preserve the authored source aperture, side, reciprocal ID, and `ExactMatch` for topology and queries. At the app-host projection boundary, synthesize one effective visibility aperture by intersecting validated non-exact reciprocal polygons on a named `0.001` coplanarity/snap tolerance. Preserve source provenance and fail loudly above that tolerance. A missing reciprocal retains the retail-compatible source aperture plus an explicit unresolved diagnostic. Never synthesize a reverse crossing by flipping geometry. |
| Outside/building transitions | `LandblockInteriorSystemAsset` already pairs raw EnvCell `Outside` endpoints with unique `LandblockInfo` building-portal claims. Retail `PView::DrawPortal`/`ConstructView(CBldPortal, CPolygon, ...)` enters the target EnvCell through the building GfxObj portal polygon; `CBldPortal::UnPack` uses the same flag-to-side decoding.                                                                                                              | Materialize both directions as authored crossings between the landblock/outdoor scope and EnvCell scope. The building-side aperture comes from its GfxObj portal polygon; the EnvCell side comes from its CellStruct. Every resolved exterior transition remains a mandatory portal-composite boundary even when its apertures match spatially, because terrain depth need not encode the opening. Missing claims remain explicit diagnostics.                                                                                        |
| Potentially visible cells    | Retail `CEnvCell::grab_visible_cells`/`PView::DrawInside` seed listed cells, while `PView::ConstructView` and `AddViewToPortals` still follow portal links; `find_visible_child_cell` uses the list as a containment candidate set.                                                                                                                                                                                                                 | Preserve the list as preload/candidate provenance. It may broaden discovery but may not reject traversal or replace connectivity.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Detail roles                 | Retail `LScape::SetDetailTexturing(landscape, building, environment, object)` loads four region descriptors. `RenderDeviceD3D::DrawBlock` scopes landscape detail to terrain, `DrawBuilding` scopes building detail to building geometry, and `DrawEnvCell` scopes environment detail to CellStruct geometry. `DrawPartCell` clears `curr_detail_surface` before drawing ordinary objects.                                                          | Terrain uses landscape detail; building shells use building; CellStruct shells use environment. Outdoor explicit/generated objects and EnvCell residents use no detail texture. The raw object descriptor remains source provenance but has no proven consumer in this D3D path. The owning render domain selects the role independently from raw surface flags.                                                                                                                                                                      |
| Static animated residents    | Retail `CEnvCell::init_static_objects` creates Stabs as static physics objects; default setup motion/script state registers through the static-animation path. The current 3D runtime deliberately defers this class in `GameRuntime.#deferStaticAuthoredDynamic`.                                                                                                                                                                                  | Account for every resident, materialize supported non-animated statics, and keep setup-default-animation residents on the explicit static-authored-animation deferral seam. Do not misroute them through spawned-dynamic installation.                                                                                                                                                                                                                                                                                                |
| Portal rendering             | Retail `PView::GetClip`, `Render::copy_view`, `ClipPortals`, `AddViewToPortals`, and `OtherPortalClip` propagate clipped screen polygons, accumulate multiple views per destination cell, process newly appended views incrementally, and clip non-exact links through both authored apertures. `D3DPolyRender::DrawPortalPolyInternal` performs material-free depth behavior; retail stencil use found here is shadow-related, not portal-related. | Preserve the invariant, not the implementation: renderer-local exact portal windows bound planning using the host-resolved effective visibility aperture, while WebGL reproduces that same single aperture as the exact mask. Do not enumerate topology paths, repeat reciprocal intersection per frame, port retail allocation patterns, or promote render apertures/windows into shared spatial-query contracts.                                                                                                                    |
| Exterior scene reuse         | Legacy `Webgl2Renderer.#renderSceneDomainTarget` renders the exterior once. `#renderOutdoorProjectionComposite` and `#drawPortalProjectionOutdoorCrossings` reuse it; `SOURCE_SCENE_COPY_FRAGMENT_SHADER` samples both exterior color and depth and writes `gl_FragDepth`.                                                                                                                                                                          | Preserve the scene-domain invariant without preserving the legacy breadth-layer graph: exterior geometry renders at most once per camera frame, while transition passes copy cached exterior color and depth through exact portal masks. Composite ping-pong is allowed only to avoid framebuffer feedback.                                                                                                                                                                                                                           |
| Portal-plane flicker         | Legacy `deriveRuntimePortalOverlapResidency` accepts a camera-point plane slab plus padded projected aperture AABB, seeds target EnvCells as `baseOverlap`, searches one extra hop, and sets `requiresExteriorSeed` for building transitions. `#drawPortalBaseOverlapEnvCells` draws those seeds before masked layers.                                                                                                                              | Preserve the successful dual-side render result but replace the proxy: derive a renderer-only closure by clipping actual aperture triangles against the finite pyramid between the camera eye and near-plane quad. It neither mutates residency nor uses aperture AABBs or one-hop caps.                                                                                                                                                                                                                                              |

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
- Keep authored crossing geometry and effective visibility geometry distinct. Spatial queries use
  the authored source aperture; window planning and stencil execution use the single host-resolved
  visibility aperture.
- Resolve non-`ExactMatch` reciprocal geometry once at the app-host projection boundary. Do not
  make the planner or GPU repeatedly intersect static authored polygons.
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
- Begin with the original camera view and propagate an exact clipped portal window through each
  accepted aperture. Reject empty child windows before target scheduling; bounds and projected
  rectangles are broad-phase accelerators only.
- Keep portal-window planning distinct from ordinary scene culling. Selected scopes still use the
  shared culling-group broad phase and exact node-AABB tests; tighter per-object window culling is
  optional evidence-driven optimization.
- Make one unique render node own each reached exterior domain or indoor visibility island. Exact
  windows and alternate routes add visibility and incoming mask edges; they never duplicate
  scope-owned geometry contribution.
- Use legacy-style layer-wide mask union as the executable model: one stencil value and depth reset
  per derived render layer, followed by one draw of every unique member node. Do not introduce a
  second per-node contribution model or speculative partition contract.
- Treat the finalized graph as the complete draw schedule. GPU integration may resolve node-owned
  scene contributions and translate masks into Phase 9B substrate calls, but it may not re-plan,
  split, deduplicate, or invent per-region contribution ownership.
- Reject apertures that do not face the traversal origin/camera using the authored source plane and
  accepted side. The admitted window and mask use the crossing's effective visibility aperture;
  neither direction is inferred by flipping the other.
- Collapse only conservatively proven indoor depth-continuous seams into visibility islands.
  Failure to prove continuity means mask, never heuristic elision.
- Treat every indoor/outdoor transition as a portal-composite boundary. Matching apertures do not
  make terrain depth safe for underground openings.
- Render exterior terrain, buildings, and objects at most once per camera frame. Reuse its color
  and depth through any number of exact transition masks.
- Preserve the good legacy scene-domain invariant and retail's clipped-window visibility invariant,
  not either renderer's broad frame-plan architecture.
- Treat flat rendering as a supported diagnostic mode, not a temporary fallback. It shares the
  ordinary main view with outdoors and intentionally forces `BACK` culling only on structured
  EnvCell shell ranges for bird's-eye inspection.
- Keep render-mode selection a frame policy. It must not mutate content residency, scene topology,
  camera residency, materialization, or GPU resource ownership.
- Treat near-plane straddling as render-view ambiguity only. The eye retains one authoritative
  camera scope while the renderer seeds both adjacent branches inside the existing parent mask.
- Test the finite eye-to-near-plane clipped volume against triangulated aperture geometry. Camera-point slabs,
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
- Keep general portal spatial queries view-independent. Phase 7 containment and Phase 8 directed
  segment tracing remain authoritative for their use cases and must not consume portal-window or
  stencil state.
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
- Material binding from a boolean “has detail” interpretation to a semantic
  `StaticDetailRole | null`.
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
- Host-only effective visibility aperture intersection, coplanarity validation, provenance, and
  HBEC projection.
- Compact Cell BSP containment projection.
- Cell shell resource shape and atomic EnvCell-layer publication.
- Resident placement composition and `envCellId` assignment.
- Explorer initial-placement policy.
- Authoritative-anchor camera portal tracing.
- Conservative indoor seam classification and visibility-island construction.
- Renderer-local exact portal-window propagation and stencil/depth mask scheduling for topology
  boundaries.
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

App-host EnvCell projection
  ├─ authored apertures in landblock space ──► query geometry
  ├─ validated non-exact reciprocal pair
  │   └─ coplanar planar intersection ───────► one effective visibility aperture
  └─ exact or unresolved reciprocal
      └─ authored source aperture ───────────► one effective visibility aperture

HBLB requested record: EnvCells v2
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
                          ├─ exact clipped portal view windows
                          │   ├─ empty-window rejection and fixed-point propagation
                          │   └─ unique render nodes + incoming mask edges
                          ├─ SCC-derived ordered render layers
                          │   └─ thin GPU consumer
                          │       └─ layer-wide mask union + one draw per member node
                          ├─ ordinary depth inside indoor visibility islands
                          ├─ exact authored masks across topology boundaries
                          └─ one cached exterior color/depth domain
                              └─ masked color/depth composites at every transition
```

Active-region detail ownership remains orthogonal:

```text
ActiveRegionData
  └─ StaticDetailTextureOwner
      ├─ Building detail
      ├─ Environment detail
      └─ TextureManager regional bindings
          └─ material StaticDetailRole or no-detail selection at draw time
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

interface PortalVisibilityAperture {
  readonly geometryId: PortalApertureGeometryId;
  readonly resolution:
    | { readonly kind: "authored-source" }
    | {
        readonly kind: "reciprocal-intersection";
        readonly sourceGeometryId: PortalApertureGeometryId;
        readonly reciprocalGeometryId: PortalApertureGeometryId;
        readonly maximumCoplanarDeviation: number;
      };
}

interface DirectedPortalCrossing {
  readonly sourceScope: SceneScope;
  readonly targetScope: SceneScope;
  readonly sourceApertureGeometryId: PortalApertureGeometryId;
  readonly visibilityApertureGeometryId: PortalApertureGeometryId;
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

- `PortalAperture` preserves authored planar geometry. No rectangle, convexity, or axis-aligned
  shortcut is permitted.
- A reciprocal pair retains both authored apertures, accepted sides, flags, and identities.
  Effective visibility preprocessing never changes either directed crossing's spatial-query
  aperture or claims the authored `ExactMatch` bit changed.
- Every directed crossing has exactly one effective visibility aperture. Exact and unresolved
  crossings use their authored source geometry. A validated non-exact reciprocal uses a
  host-synthesized planar intersection carrying both source IDs and measured coplanarity
  provenance.
- Intersect arbitrary planar polygons with a maintained Rust polygon-boolean implementation after
  projection to a stable local 2D basis; triangulate every resulting component back into
  landblock-space mask geometry. Do not hand-roll a convex/quadrilateral-only clipper.
- Validate reciprocal geometry against a named app-host
  `NON_EXACT_APERTURE_COPLANAR_EPSILON = 0.001`. Orthogonally snap to the selected source plane only
  after that proof. Empty intersections and deviations above the threshold fail with both portal
  identities and measured facts.
- A missing reciprocal retains the authored source as its effective visibility aperture, matching
  retail's inability to run `OtherPortalClip`, and emits an explicit
  `non-exact-without-reciprocal` diagnostic.
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

interface PortalRenderWorkPlan {
  readonly rootNodeId: PortalRenderNodeId;
  readonly nodes: readonly PortalRenderNode[];
  readonly maskEdges: readonly PortalMaskEdge[];
  readonly renderLayers: readonly PortalRenderLayer[];
  readonly exteriorTransitions: readonly ExteriorTransitionOperation[];
  readonly capacity: PortalStencilCapacityPreflight;
}
```

- `PortalViewWindow` is planner-private work state used only to reject empty routes and converge
  visibility. It is not part of `PortalRenderWorkPlan`, a geometry-submission identity, or a GPU
  execution contract.
- `PortalRenderNode` uniquely owns one reached exterior domain or indoor visibility island for the
  view. Its EnvCell scopes, culling groups, nodes, and contributions remain independently
  addressable beneath that domain, but every contribution is scheduled at most once.
- `PortalMaskEdge` records one admitted directed crossing and exactly one effective visibility
  aperture between unique render nodes. It does not retain the CPU window, paired authored
  geometry, or preprocessing work that admitted it.
- `PortalRenderLayer` is the executable unit: emit the union of its incoming mask edges under one
  stencil value, reset depth once inside that union, then draw each member node once.
- Execution is a mechanical interpretation of this graph, not another planning phase. The renderer
  may resolve node IDs to current scene contributions and aperture IDs to GPU resources; it may not
  derive another route graph, visibility partition, overlap guard, or draw-ownership contract.
- Stencil capacity is the highest emitted render-layer label. Effective aperture preprocessing
  eliminates reciprocal-intersection scratch values; no route, window, portal, or mask edge owns a
  private stencil allocation.
- The planner may store windows as a worklist or graph; it must not expose a recursive
  topology-path tree or its internal coverage fragments as executable identity.
- A view window is planning state, not a GPU allocation. No texture, framebuffer, or persistent
  scene resource is allocated per window.
- For each independent `FrameViewInput`, the exterior target contains the complete established
  outdoor pass sequence for that view and is rendered no more than once. Renderer-owned targets
  are reused sequentially across views; an exterior image is never reused across different camera
  projections.
- Both exterior and composite targets own `RGBA8` color plus `DEPTH24_STENCIL8` texture
  attachments. The exterior depth-stencil texture is sampled by transition copies; the composite
  attachment retains depth and stencil for subsequent indoor work.
- A source-scene copy samples both color and depth and writes the sampled depth while constrained by
  the active transition region.
- Outdoor-root rendering seeds the composite from exterior color/depth, then renders reached indoor
  work through transition masks.
- Indoor-root rendering builds the indoor composite, then copies cached exterior color/depth
  through every reached outdoor mask. Multiple masks reuse the same exterior target.
- Composite ping-pong exists only when a pass would otherwise sample from the framebuffer it is
  writing. No persistent target is allocated per portal, cell, window, render node, or topology
  route.
- A final presentation pass copies or blits composite color to the active view destination. It does
  not claim that the default framebuffer retains the composite depth-stencil contents.

### Near-Plane Straddle Rendering

```ts
interface PortalNearPlaneIntersection {
  readonly crossingId: DirectedPortalCrossingId;
  readonly sourceScope: SceneScope;
  readonly targetScope: SceneScope;
  readonly visibilityApertureGeometryId: PortalApertureGeometryId;
}

interface PortalBoundaryRenderSeeds {
  readonly authoritativeRoot: SceneScope;
  readonly intersections: readonly PortalNearPlaneIntersection[];
  readonly additionalSeeds: readonly SceneScope[];
  readonly includesExterior: boolean;
}
```

- Build the finite world/view-space near-plane quad from the active camera projection and use it
  with the eye to bound the near-clipped pyramid. Do not use the camera point alone as the overlap
  primitive.
- For each relevant topology-mask or exterior boundary, admit facing from the authored source plane
  and side, then clip its effective aperture triangles against the four side planes and near cap of
  that finite pyramid. Boundary contacts use the shared rendering epsilon.
- Starting at the authoritative render root, add the adjacent scope for every intersected boundary
  and continue through newly added seeds until no additional near-plane-intersected boundary is
  found. Use visited scopes/crossings and a topology-derived bound, not a fixed hop count.
- An intersected boundary bypasses directed facing rejection only for this seed step. Descendant
  traversal resumes normal facing, frustum, island, and mask rules.
- Additional seeds inherit the current parent stencil/visibility region; they never become
  unrestricted full-frame roots when the straddle occurs inside an admitted portal view window.
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
  | {
      readonly kind: "ambiguous";
      readonly candidates: readonly SceneResidency[];
    }
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
}

interface StaticMaterialBinding {
  // Existing base, palette, clip-map, blend, cull, and lighting facts remain.
  readonly detailRole: StaticDetailRole | null;
}
```

The active-region texture owner resolves each role to a texture plus tiling factor. Landscape
detail remains terrain-specific. The owning render domain selects a semantic role or the explicit
no-detail state; the renderer resolves an active regional binding only for a selected role.

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
      **Superseded by the 2026-07-28 Gate E exact portal-window resteer.**
- [x] Verify the legacy exterior-domain invariant: render once, then copy cached color and sampled
      depth through transition masks.
- [x] Verify legacy portal-overlap behavior and separate its successful dual-side result from its
      camera-point slab, aperture-AABB, and one-hop approximations.
- [x] Add an opt-in non-TUI archive census and select risk-oriented fixtures.

No implementation phase now depends on an uncited guess about indices, winding, detail roles,
containment, portal direction, reciprocal geometry, or PVS authority.

### Phase 1 — Universal Active-Region Static Detail Roles — Complete 2026-07-27

Fix the existing material parity gap before environment-cell materialization adds another special
case.

#### Deliverables

- Replace `ActiveRegionObjectDetailOwner` with a role-aware owner whose name reflects all static
  detail textures.
- Prepare building and environment detail textures once per active region with typed tiling facts
  and independent GPU ownership.
- Replace renderer policy based on raw surface flags with a material-plan decision that retains the
  semantic `StaticDetailRole` selected by the render domain.
- Apply building detail to building shells and environment detail to CellStruct shells. Preserve
  the retail no-detail state for outdoor objects, generated objects, and indoor residents.
- Keep landscape detail in the terrain path and keep regional detail textures out of per-landblock
  atlases.

#### Checklist

- [x] Use one role-aware regional resource owner and one read-only renderer lookup.
- [x] Keep missing authored roles explicit; do not silently substitute another role.
- [x] Preserve material flags as provenance even when no proven detail role applies.
- [x] Add synthetic planner and renderer tests for each role and missing-binding failure.
- [x] Update Explorer and existing harness bootstrap to install all static detail roles.

#### Acceptance

- Existing static layers no longer receive building detail merely because a raw detail bit is set.
- Every supported detail role produces the correct texture/tiling binding through the same object
  shader.
- Regional detail ownership and eviction remain independent of landblock resource owners.

### Phase 2 — General Polygon Geometry and Interior Projections — Complete 2026-07-27

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

- [x] Start by deleting duplicated GfxObj-specific mechanics that the generic builder supersedes.
- [x] Keep adapter-owned material-slot interpretation outside the generic builder.
- [x] Validate every aperture vertex is coplanar within the audited source-planarity tolerance.
- [x] Reject degenerate aperture planes/triangles, invalid polygon indices, and out-of-range
      surface slots. Omit exact zero-area textured fan triangles with typed provenance rather than
      rejecting their complete canonical GfxObj.
- [x] Retain arbitrary and multipart triangulated aperture shapes; do not rebuild them as quads.
- [x] Verify both authored winding directions and one non-axis-aligned plane.
- [x] Verify building-side portal index selection and flag/plane convention against
      `PView::ConstructView(CBldPortal, CPolygon, ...)`.
- [x] Require reciprocal `ExactMatch`, transformed aperture equivalence, opposing sides, and
      conservative non-overlap/separation before declaring an indoor seam depth-continuous.
- [x] Make every uncertain, non-exact, overlapping, or exterior edge a mask boundary; reject
      malformed source geometry before classification.
- [x] Verify existing building/object output remains byte-for-byte or semantically identical where
      the refactor should be behavior-preserving.
- [x] Unit-test compact containment projection against a synthetic full BSP walk.

#### Acceptance

- GfxObj and CellStruct geometry share mechanics without sharing false material semantics.
- Portal geometry contains no material or visible draw range.
- Indoor seam classification has no view-dependent thresholds or silent fallback.
- A non-rectangular, non-axis-aligned planar aperture survives projection without loss.
- Existing building and object harnesses remain unchanged visually and diagnostically.

### Phase 3 — First-Class Environment-Cell HBLB Record — Complete 2026-07-27

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
  - resident object-source records and complete landblock-local placements with EnvCell residency;
  - potentially-visible references and diagnostics/provenance.
- Add a strict TypeScript decoder returning a completed `ResolvedEnvCellLayerSource`, replacing
  provisional `unknown` BSP and incomplete aperture contracts rather than adding a parallel type.

#### Checklist

- [x] Extend both Tauri and HTTP batch sources without adding a second environment-cell port.
- [x] Preserve cumulative acquisition: one host request may return terrain, outdoor statics, and
      EnvCells as independent records.
- [x] Validate record version, byte ranges, alignment, counts, indices, finite scalars, IDs,
      reciprocal links, spatial-relationship invariants, and section non-overlap.
- [x] Represent a landblock with no EnvCells as a successful `null` EnvCells record.
- [x] Ensure a decoder can skip every unrequested or unknown independent record safely.
- [x] Keep source arrays transferable and avoid JSON expansion of geometry.
- [x] Cover malformed directory offsets and cross-section indices with synthetic fixtures.

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
- Replace the stale synchronous `EnvCellLayerCommit` artifact seam with a source commit containing
  one closed environment plan plus its scope-partitioned resident jobs. It must contain every input
  required by runtime realization without owning workers, atlas state, revision namespaces, GPU
  resources, or scene mutation.

#### Checklist

- [x] Deduplicate shared CellStruct source geometry without conflating per-EnvCell surfaces or
      transforms.
- [x] Deduplicate resident GfxObj/material closure across cells using existing logical identities.
- [x] Assert every emitted resident renderable has exactly one owning EnvCell scope even when source
      geometry, material bindings, or instance definitions are shared.
- [x] Cover identical residents in two overlapping EnvCells and prove they remain separate scoped
      submissions with shared source resources.
- [x] Preserve source order and stable identities for diagnostics.
- [x] Count expected, static, default-animated, unsupported, shell, aperture, and materialized
      records.
- [x] Fail the closed job on missing required shell material or geometry rather than publishing a
      partial cell.
- [x] Keep static-authored default-animated residents on the existing explicit deferral seam; do
      not send them through spawned-dynamic installation or invent a second animation system.
- [x] Verify against retail that non-identity cell structure placement does not compose into an
      authored resident placement.

#### Acceptance

- Every authored EnvCell static-object reference is accounted for as materialized, explicitly
  deferred as static-authored animation, or loudly unsupported.
- Shells and residents share the established texture, atlas, material, and geometry primitives.
- Resident placement crosses the boundary as one landblock-space `ScenePlacement`; materialization
  does not compose it with the CellStruct placement.
- Materialization-plan accounting crosses the commit boundary as real consumption data. Geometry
  worker diagnostics join it after Phase 5 executes the closed jobs.

### Phase 5 — Atomic Realization and Scene Publication

#### Deliverables

- Generalize `StaticLayerRealizer` and related outdoor-only names to accept the Phase 4 EnvCell
  source commit, execute its closed scoped jobs with revision-owned namespaces, and preserve
  existing outdoor behavior.
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

- [x] Define one owner/release handle for the complete EnvCell layer transaction.
- [x] Preserve each internal and building-transition crossing's independently authored aperture,
      accepted side, `ExactMatch`, and reciprocal identity; never synthesize it from the other
      direction.
- [x] Union only proven indoor depth-continuous edges; keep scopes, residency, ownership, and
      outgoing adjacency independent inside an island.
- [x] Build group bounds from the union of actual transformed member-node bounds and keep exact
      member-node AABB tests after aggregate acceptance.
- [x] Cover a resident extending beyond the authored shell/cell AABB without false rejection.
- [x] Verify identical producer group keys in different EnvCell scopes remain independent
      aggregates and dirty/rebuild independently.
- [x] Never union an EnvCell scope with the landblock/outdoor scope.
- [x] Reject duplicate scope IDs, dangling endpoints, invalid aperture resources, and inconsistent
      reciprocal links before mutation.
- [x] Do not parent resident resources across `EnvCellSystem` and `StaticObjectSystem`; flatten
      transforms and retain scope identity.
- [x] Eviction removes outgoing adjacency without scanning unrelated landblocks.
- [x] Late-result rejection works before and during queued runtime commit draining.
- [x] Resource accounting reaches zero after eviction and runtime destruction.

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
- Bind environment detail to CellStruct shells and no detail texture to residents.
- Keep portal aperture geometry out of visible material draws.
- Force `BACK` culling for structured EnvCell shell ranges in flat mode. Keep authored culling for
  EnvCell residents and every other static range.
- Add renderer diagnostics for active mode, resident/visible scopes, visible nodes, submitted
  shell/resident ranges and triangles, shell-cull overrides, pass counts, and zero portal work.

#### Checklist

- [x] Deduplicate each resident shell and resident range exactly once per ordinary view.
- [x] Report EnvCell scopes, producer groups, and exact nodes tested/rejected independently.
- [x] Verify an off-frustum resident group is rejected even when its cell shell intersects, and a
      protruding resident remains visible when the shell group is rejected.
- [x] Keep EnvCell scope IDs on render records for picking, diagnostics, containment, and later
      portal planning even though flat scheduling ignores topology.
- [x] Assert flat mode issues zero aperture, stencil, scene-domain-target, and composite work.
- [x] Verify a bird's-eye exterior camera can inspect cell interiors because structured shells use
      forced back-face culling rather than rendering as opaque outward shells.
- [x] Verify the cull override applies only to structured shell ranges; resident and outdoor
      materials preserve their authored cull mode.
- [x] Preserve opaque, alpha-test, transparent, and additive ordering already established for
      objects.
- [x] Exercise environment detail on shells and the no-detail resident path in a browser-visible
      fixture.
- [x] Ensure malformed aperture data cannot reach a runtime “fail open” branch.
- [x] Switch frame modes without content acquisition, resource rebuild, scene publication, or
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

- [x] Keep the pure candidate query in scene math and the selection policy in Explorer.
- [x] Cover overlapping AABBs with exactly one BSP match, multiple BSP matches, and no BSP matches.
- [x] Cover boundary epsilon and transformed/rotated cell placements.
- [x] Do not use `BspNode::intersects_solid`; it is a physics sphere/solid query with different
      semantics.
- [x] Preserve an explicit landblock/outdoor candidate where the current Explorer experience needs
      one.
- [x] Remove or rewrite tests that enshrine first-insertion selection.

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
- Add a typed runtime query whose caller supplies an authoritative player/actor position and
  residency plus a desired camera endpoint. Do not derive the anchor from camera or point
  containment.
- Return the topology-derived endpoint residency for a future third-person camera coordinator.
  Do not create or wire a client/player/camera implementation in this phase.
- Return crossing history and explicit topology-unavailable state for diagnostics and safe caller
  policy.
- Keep obstruction/collision response out of this controller.
- Keep render near-plane intersection out of this controller. The camera eye has one
  topology-derived residency even when later portal rendering temporarily renders both sides.

#### Checklist

- [x] Inspect only current-scope outgoing crossings at each trace step.
- [x] Reject wrong-facing crossings before accepting an intersection.
- [x] Trace claimed building/outside transitions in both authored directions and leave unclaimed
      outside endpoints explicitly unavailable.
- [x] Select the smallest forward segment parameter and define deterministic boundary ties.
- [x] Advance by one shared epsilon and guard against immediately re-crossing the same aperture.
- [x] Bound maximum crossings by topology size or another structurally justified limit.
- [x] Cover no crossing, one crossing, multiple crossings, overlapping destination cells,
      non-rectangular aperture misses, boundary hits, coplanar segments, and cycles.
- [x] Preserve player residency when the camera trace cannot complete.
- [x] Do not add a straddling/overlap residency variant to camera trace results.

#### Acceptance

- A camera endpoint inside a spatially overlapping but unconnected EnvCell does not switch scope.
- A camera segment through one or more directed apertures ends in the topology-derived scope.
- Reverse-direction and wrong-facing traces are rejected according to the proven side convention.
- The runtime primitive derives a future client camera's residency from caller-supplied
  authoritative player state plus crossing history, while Explorer initialization remains the
  separate best-effort containment path.

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
  or must Phase 9B revise the target contract before resource ownership hardens?
- What topology-derived upper bound should Phase 10 use for stencil overflow coverage while
  reserving stencil value `0` for the base scope?

#### Acceptance

- Record topology/query measurements, browser capability evidence, and fixture coverage under Plan
  Maintenance.
- Enter Phase 9A only when flat rendering, containment, and camera trace remain independently
  green.
- Do not let the existing `VisibleScene.crossings` shape dictate stencil architecture; the locked
  contract requires path-local ancestry.

### Phase 9A — Portal Query Cutover and Renderer-Math Colocation — Complete 2026-07-27

This is the immediate next step. Remove the premature flattened portal-selection façade before any
GPU scheduling or target work resumes.

#### Deliverables

- Replace `SceneGraph.queryFrustum()` with two honest read contracts:
  - an explicit selected-scope frustum query that reuses the existing scope → landblock → culling
    group → exact-node pipeline;
  - the retained, revisioned topology read view consumed by Phase 10.
- Preserve canonical outgoing adjacency for topology reads and Phase 8 segment tracing; do not
  duplicate crossing ownership in the renderer.
- Split `RenderWorld.queryVisibleScene()` into flat selection and explicit selected-scope
  collection. Remove its unreachable portal-mode branch rather than keeping two competing portal
  selection paths.
- Remove `VisiblePortalCrossing`, the reused flattened crossing buffer, and the
  `visiblePortalCrossings` metric/UI row. Phase 12A introduces window-aware consumed diagnostics
  after they exist.
- Relocate the renderer-only finite near-plane/aperture helper and its tests from `scene/` to
  `renderer/` without changing the accepted math.
- Rewrite existing tests around the new boundaries:
  - spatial membership and culling tests call explicit selected-scope queries;
  - topology traversal behavior moves to Phase 10 planner fixtures;
  - flat rendering tests remain unchanged.

#### Checklist

- [x] Delete the old query façade, crossing buffer, dead portal branch, obsolete metrics, and tests
      in the same cutover; leave no compatibility shim.
- [x] Keep `queryFlatFrustum()` behavior and allocation profile unchanged.
- [x] Keep Phase 8 portal segment tracing and unavailable exterior-boundary behavior unchanged.
- [x] Do not add work-plan, stencil, render-domain, or GPU-target behavior in this phase.
- [x] Prove selected-scope queries retain producer-group broad phase followed by exact node tests.
- [x] Run focused scene, render-world, runtime-metric, Explorer check, dead-code, and formatting
      coverage.

#### Acceptance

- The scene graph exposes topology facts and spatial selection as separate contracts.
- No flattened portal crossing list remains in `VisibleScene` or renderer metrics.
- Flat rendering and portal segment tracing remain green.
- Finite near-plane math is colocated with its renderer consumer and retains its complete test
  coverage.
- Phase 9B can add GPU mechanics without depending on a known-dead portal-selection shape.

### Phase 9B — Portal GPU Substrate — Complete 2026-07-27

This phase builds and proves renderer mechanics without switching production rendering away from
the accepted flat path.

#### Deliverables

- Consume the existing material-free `PortalDrawUnit` geometry resources; do not introduce a second
  aperture upload cache or topology owner.
- Add resize-safe renderer-owned scene-domain targets:
  - one exterior source target with `RGBA8` color plus a depth-sampleable
    `DEPTH24_STENCIL8` texture attachment;
  - one composite destination with the same color/depth-stencil attachment contract;
  - a second composite ping-pong target only if an executable pass proves framebuffer feedback
    otherwise unavoidable.
- Add a source-scene copy program that samples color and depth, writes `gl_FragDepth`, and obeys an
  active stencil mask.
- Add explicit portal-pass state transitions for framebuffer, viewport, color/depth/stencil masks
  and tests, blend, and cull. Programs, textures, and VAOs remain pass-owned bindings; each pass
  establishes its complete fixed-function baseline instead of snapshotting unknown ambient state.
- Add pure finite-near-clip-volume versus triangulated-aperture intersection math using the exact
  active camera projection facts, with one tested rendering epsilon.
- Add deterministic transactional resize and disposal. Device loss invalidates the renderer into a
  typed fatal/restart-required state; this plan does not claim partial target-only restoration.
- Add unit fixtures for pass-state commands and pure near-plane geometry plus a real-browser
  synthetic fixture with pixel readback for mask nesting/restoration, color-plus-depth copy, target
  resize/disposal, final presentation, and arbitrary aperture shapes.

#### Checklist

- [x] Allocate no framebuffer or texture per aperture, cell, island, or path.
- [x] Keep aperture masks material-free and clipped child frusta out.
- [x] Establish a complete pass baseline before every mask/composite/ordinary draw transition.
- [x] Test the finite eye-to-near-plane pyramid, not camera-point distance, the cap alone, or aperture AABB overlap.
- [x] Prove the raw stencil reference range accepts `1..255` and rejects `256`; topology ancestry
      and traversal bounds belong to Phase 10.
- [x] Ensure context loss cannot continue drawing with stale programs, textures, geometry, or
      targets, and do not advertise in-place restoration.
- [x] Keep `flat` production rendering and its shell-cull policy unchanged while this substrate is
      developed.
- [x] Ensure substrate diagnostics are consumed by fixtures or remove them.

#### Acceptance

- Synthetic masks constrain color and sampled-depth composition without state leakage.
- Targets resize and dispose without stale attachments or leaked GPU resources; device loss
  produces the accepted typed restart-required outcome.
- Near-plane/aperture math handles arbitrary planar triangulations and rejects contacts outside the
  actual aperture.
- Flat mode remains the stable end-to-end renderer.

### Resteering Gate D — GPU Substrate Audit — Complete 2026-07-27

Pause before renderer work planning.

#### Acceptance

- Real-browser pixel reads prove stencil nesting, sampled-depth copy, and final presentation.
- Resize/disposal and the restart-required context-loss outcome are executable rather than
  documentation-only.
- Flat-mode frame selection, draws, and portal-work counters remain unchanged.
- No topology traversal or render-domain scheduling abstraction has been added to the substrate.

### Phase 10A — Failed Planner Purge and Contract Reset

Delete the Gate E planner before designing its replacement. This is a clean cutover, not a
migration: no failed path-tree type, diagnostic, test expectation, or browser probe may constrain
the portal-window planner.

#### Deliverables

- Delete `portal-render-work-plan.ts` and its tests rather than incrementally refactoring
  `PortalWorkOccurrence`, active-boundary ancestry, and path-count contracts.
- Remove the planner import, retained instance, diagnostic probe, and work-limit result handling
  from `webgl2-renderer.ts`. Production `portal` mode remains rejected.
- Remove tests and diagnostics whose only purpose is path enumeration, planned-path counts, or
  ancestry-tree shape.
- Rename live execution comments/errors that still call stencil depth “ancestry” to `mask stack`;
  completed plan history may retain the old term as evidence.
- Preserve the completed Phase 9A contracts: immutable topology reads, source-keyed adjacency,
  explicit selected-scope culling, and renderer-local near-plane math.
- Preserve Phase 7 containment and Phase 8 directed segment tracing byte-for-byte at their public
  boundaries. Renderer planning receives a root scope; it does not become a general portal-query
  service.

#### Checklist

- [x] Search production and tests for `PortalWorkOccurrence`, `plannedPathCount`,
      `activeBoundaries`, failed work-plan result types, and live `stencil ancestry` wording; remove
      or rename every planner-owned use.
- [x] Do not salvage types into a compatibility module or retain both planners behind a switch.
- [x] Keep topology, aperture GPU resources, scene selection, flat rendering, and the Phase 9B
      substrate intact.
- [x] Run focused renderer, SceneGraph, containment, camera-trace, and flat-browser coverage after
      subtraction.

#### Acceptance

- No failed planner code or contract remains.
- `portal` mode still fails explicitly before drawing, while `flat` remains behaviorally unchanged.
- General spatial queries remain independent of renderer window terminology and state.

### Phase 10B — Exact Portal-Window Geometry

Phase 11A preserves this completed clipping primitive but replaces its paired non-`ExactMatch`
input branch with one host-resolved effective visibility aperture. The checklist below records the
accepted pre-cutover evidence rather than the final crossing wire shape.

Build and prove the pure view-dependent geometry before adding topology scheduling. This phase
performs no SceneGraph traversal or WebGL work.

#### Deliverables

- Add a renderer-local exact portal-window representation using normalized collections of convex
  NDC polygons produced after homogeneous clip-space clipping. Preserve arbitrary authored
  aperture shapes through their existing validated triangulation rather than assuming quads,
  rectangles, or one convex outline.
- Factor the already-computed prepared view/projection facts needed by both ordinary rendering and
  portal planning into one renderer-local typed input. Do not independently reconstruct camera
  matrices inside the planner.
- Transform each aperture from its authored landblock frame into the current anchor-relative render
  frame, project its triangles through the prepared view, clip in homogeneous space before
  perspective division, and intersect them with an inherited window.
- Treat camera-frustum, aperture-AABB, projected-rectangle, and coarse coverage tests as optional
  broad phases only. An empty exact intersection is the authoritative rejection.
- For non-`ExactMatch` reciprocal links, sequentially intersect the inherited window with both
  authored aperture projections in their proven render frame.
- Normalize harmless duplicate/collinear vertices with one explicit NDC numerical tolerance; do
  not make visibility depend on viewport resolution, silently fill holes, bridge disjoint pieces,
  or approximate concavity.
- Add allocation and complexity diagnostics for projected triangles, output fragments, vertices,
  empty intersections, and broad-phase rejections. Diagnostics must feed Gate E or be removed.

#### Checklist

- [x] Keep window geometry renderer-local and stateless; it owns no scene, residency, or GPU
      resource state.
- [x] Use small focused projection, convex clipping, normalization, containment, and bounds
      functions with explicit inputs.
- [x] Cover apertures behind the eye, crossing the near plane, partially outside the viewport,
      edge-on, degenerate after clipping, multipart/concave, and non-exact reciprocal intersection.
- [x] Prove conservative broad phases never reject a non-empty exact intersection.
- [x] Compare synthetic results with a slow reference oracle; use retail as behavioral evidence,
      not as source code or allocation architecture to port.

#### Acceptance

- Exact fixtures return deterministic non-empty polygons or an explicit empty result without
  `NaN`, unbounded coordinates, or topology knowledge.
- Non-exact reciprocal clipping cannot expose the union of its two authored apertures.
- Coarse bounds/tiles are incapable of deleting an exact route or becoming a render mask.
- No materialization, scene publication, flat rendering, containment, or camera trace changes.

### Phase 10C — Unique-Node Portal Render Graph — Complete 2026-07-28

Phase 11A retains this completed fixed-point/node/layer algorithm while replacing each mask edge's
aperture array with one effective visibility aperture and removing scratch capacity. Gate E is
rerun after that cutover.

Build the final pure per-view planner over Phase 10B windows. This phase owns visibility
convergence and graph ordering, but no WebGL execution.

#### Deliverables

- Retain a renderer-local immutable index over topology revisions without cloning the graph per
  frame.
- Define `PortalRenderWorkPlan` directly: one unique node per reached exterior domain or indoor
  visibility island, one admitted mask edge per reached directed topology crossing, ordered render
  layers, exterior-transition operations, near-plane seeds, selected scopes, and complete capacity
  preflight. Do not expose planner-private window fragments.
- Seed the root node with the full view. Process `(render node, newly admitted exact window)` states
  through a worklist:
  - reject wrong-facing crossings except finite near-plane dual-side seeds;
  - broad-phase, project, and exactly intersect the aperture with the incoming window;
  - intersect both authored apertures for non-`ExactMatch` reciprocals;
  - reject empty results;
  - admit the crossing's executable mask edge and add the result only to the target node's
    planner-private coverage;
  - enqueue the target only when the result adds visibility not already processed there.
- Use one explicit fixed-point admission rule. Exact duplicates and wholly subsumed windows add no
  work; disjoint and partially novel windows propagate. A safety ceiling detects corruption or a
  failed invariant but is not the termination mechanism.
- Collapse the reached directed graph into strongly connected components and derive deterministic
  render layers. Each layer directly names its unique member nodes and admitted incoming mask
  edges; it is already the unit Phase 12A executes.
- Resolve selected scopes through the Phase 9A explicit-scope query. Visibility islands may group
  scheduling, but scopes, culling groups, nodes, batching, picking, and lifecycle remain
  independent.
- Preflight graph/mask capacity before execution. After the Phase 11A cutover, capacity depends
  only on the maximum ordered render-layer label, not total EnvCell, route, window count, or
  non-exact reciprocal steps.
- Emit only diagnostics consumed by Gate E, Phase 12A/12B, or the Explorer inspector: admitted and
  rejected window states, maximum retained windows per node, render nodes, mask edges, SCCs, render
  layers, selected scopes, transitions, near-plane seeds, capacity, and planner time.

#### Checklist

- [x] Delete rather than adapt every path-occurrence, per-window submission, overlap guard, and
      exclusive contribution-region contract.
- [x] Preserve each EnvCell scope inside its render node for selection, culling, batching, and
      diagnostics.
- [x] Bound near-plane closure from resident topology rather than a fixed hop count.
- [x] Prove diamonds and cycles update existing render nodes and mask edges rather than producing
      another occurrence or geometry submission.
- [x] Keep the plan independent from framebuffer handles, concrete stencil values, material
      contribution ownership, containment, residency, collision, and directed segment queries.
- [x] Keep every `PortalViewWindow` and node-coverage fragment private to planning; the returned
      plan contains no CPU clipping region or per-window execution record.
- [x] Return a typed complete plan or typed failure before any partial GPU work.
- [x] Keep production `portal` mode rejected.

#### Acceptance

- Pure fixtures deterministically produce exact visibility states, unique render nodes, admitted
  mask edges, SCC-derived render layers, transitions, near-plane seeds, selected scopes, and
  capacity.
- Every reached domain has exactly one render node and every selected scope contribution is
  scheduled once regardless of incoming route or window count.
- Dense depth-continuous grids spend no masks on proven ordinary seams.
- Cyclic, diamond, sibling, overlapping, non-Euclidean, non-exact reciprocal, and straddle fixtures
  agree with a slow exact visibility oracle without path enumeration, coarse underdraw, or invented
  visibility.
- No production draw path, resource ownership, materialization, residency, containment, or camera
  trace behavior changes.

### Resteering Gate E — Final Portal-Graph Audit — Complete 2026-07-28

Pause once, before GPU composition. Run the final planner against the complete synthetic matrix and
the selected `0x0001FFFF`, dense `00D1`, non-exact, and exterior-transition archive fixtures.

#### Acceptance

- Record admitted/rejected visibility states, maximum windows per node, render nodes, mask edges,
  SCCs, render layers, capacity, transitions, selected scopes, culling results, and planner time.
- Compare small fixtures with the slow exact visibility oracle.
- The `0x0001FFFF` fixture that defeated the path planner completes without routine safety-limit use
  or topology-path growth. Raising the ceiling is not acceptance.
- Window accumulation reaches a measured fixed point without unbounded fragmentation.
- Node and contribution counts are invariant under alternate-route multiplicity: alternate routes
  may change mask coverage, never render-node or draw ownership.
- The planner consumes immutable topology plus the shared selected-scope query and introduces no
  duplicate scene, material, or spatial-query ownership.
- Flat rendering, Phase 7 containment, and Phase 8 camera tracing remain independently green.
- Any oracle disagreement, unbounded accumulation, incomplete capacity preflight, or partial plan
  blocks Phase 11A.

### Phase 11A — Effective Visibility Apertures and Layer-Mask Substrate Cutover — Complete 2026-07-28

Replace per-frame reciprocal clipping and the obsolete path-stack stencil protocol before exterior
composition. This is a clean final-contract cutover over completed Phases 9B–10C, not a compatibility
layer.

#### Deliverables

- Add a focused app-host planar aperture-intersection primitive beside
  `portal_geometry.rs`. Project both validated reciprocal polygons onto a stable 2D basis, use a
  maintained Rust polygon-boolean implementation for arbitrary simple polygons, triangulate every
  non-empty result component, and lift the result onto the selected source plane.
- Lock a separate `NON_EXACT_APERTURE_COPLANAR_EPSILON = 0.001` from the archive census. It governs
  render-visibility preprocessing only and must not widen the `0.0002` spatial-query or containment
  epsilon.
- In `env_cell_source.rs`, derive one effective visibility aperture per directed crossing after all
  authored apertures reach landblock space and reciprocal identity is known:
  - authored exact crossing → authored source aperture;
  - validated non-exact reciprocal → synthesized planar intersection;
  - missing reciprocal → authored source aperture plus explicit unresolved diagnostic;
  - validated reciprocal above the coplanarity threshold or with an empty intersection → loud
    record-construction failure containing both identities and measurements.
- Cache synthesized geometry by canonical reciprocal pair. Two non-exact directions may share one
  immutable intersection geometry, while a direction authored as exact retains its own source
  aperture.
- Bump the strict EnvCell record to HBEC v2. Preserve `sourceApertureIndex` for general spatial
  queries, add `visibilityApertureIndex` for rendering, and attach consumed provenance for
  `authored-source` versus `reciprocal-intersection`. Delete the v1 crossing decoder rather than
  retaining a compatibility branch.
- Carry both typed apertures through realization and `ScenePortalCrossingInput`. Directed point and
  segment queries continue using the authored source aperture and side. Facing uses the authored
  source plane; portal-window clipping, near-plane intersection, and GPU masks use the effective
  visibility aperture.
- Simplify `PortalRenderGraphPlanner` so every mask edge contains one
  `visibilityApertureId`. Remove paired-aperture arrays, per-frame reciprocal clipping, and
  `requiresNonExactScratchValue`; stencil capacity becomes the maximum emitted render-layer label.
- Cleanly replace `WebGL2PortalSubstrate.pushMask`/`popMask` and mask-stack terminology with one
  layer-mask write: draw an effective aperture with `REPLACE renderLayer`. Internal masks use the
  accepted depth-tested policy; exterior-transition masks may explicitly ignore scene depth.
  Retain target allocation, sampled color/depth copy, masked depth replacement, presentation, and
  lifecycle ownership.
- Rerun the Phase 10B/10C synthetic oracle and Gate E archive probes through the effective-aperture
  contract. Any visibility difference must be explained by the named snap/intersection policy, not
  silently accepted.

#### Checklist

- [x] Add permanent synthetic coverage for identical, contained, partially overlapping, concave,
      multipart, disjoint, opposite-winding, near-coplanar, and over-threshold reciprocal
      apertures.
- [x] Prove that preprocessing preserves authored apertures byte-for-byte and changes only the
      visibility aperture reference.
- [x] Assert both non-exact directions reuse one synthesized geometry where valid, while asymmetric
      authored flags retain direction-specific effective geometry.
- [x] Record synthesized, authored-source, unresolved-reciprocal, empty-intersection, and
      over-threshold counts in an archive diagnostic consumed by this gate; do not ship ceremonial
      per-frame metrics.
- [x] Search frontend production/tests for paired `apertureIds`, non-exact scratch capacity,
      `pushMask`, `popMask`, and `mask stack`; remove every live execution contract.
- [x] Prove layer-mask writes union overlapping and disjoint effective apertures without increment,
      decrement, scratch, or restore operations.
- [x] Keep production `portal` mode rejected and flat rendering unchanged.

#### Acceptance

- Every canonical validated non-exact internal reciprocal resolves to one effective visibility
  aperture under the named `0.001` tolerance; canonical exterior transitions require no reciprocal
  intersection.
- Every frontend crossing exposes one authored query aperture and one effective visibility
  aperture. No TypeScript planner or WebGL API accepts paired reciprocal masks.
- General point, segment, residency, and camera-trace tests continue using authored geometry and
  remain unchanged in behavior.
- The final planner emits one aperture ID per mask edge and preflights only render-layer stencil
  labels.
- The GPU substrate contains one layer-union mask-write model and no path-stack compatibility API
  or terminology.
- Gate E remains bounded and oracle-correct on the simple, dense, cyclic, non-exact, and transition
  fixtures.

### Phase 11B — Exterior Transition Composition — Complete 2026-07-28

#### Deliverables

- Render the complete established exterior terrain/building/object pass sequence at most once per
  independent `FrameViewInput` whenever the exterior is the root or a reached transition requires
  it. Reuse the same target objects sequentially across views, but never reuse one view's exterior
  image for another.
- Treat every `exterior-transition` as a mandatory scene-domain boundary; never collapse one into a
  depth-continuous indoor seam.
- Consume the Phase 10C graph's `ExteriorTransitionOperation` records directly. Each operation
  already names the accepted crossing and its single effective visibility aperture; Phase 11B must
  not rediscover topology, inspect reciprocal authored geometry, consult planner-private windows,
  or derive a second transition schedule.
- Implement both root directions:
  - exterior root seeds the composite from exterior color/depth, establishes each accepted
    transition mask, resets/replaces depth inside it, and renders reached indoor content;
  - interior root renders indoor content, then copies cached exterior color/depth through every
    reached outdoor transition region without redrawing exterior geometry.
- Consume the graph's topology-bounded near-plane seed when it names an exterior transition. Do
  not repeat finite-near-plane/aperture intersection in the compositor. Keep the authoritative
  eye-side root, authored crossing geometry, and all residency unchanged.
- Project the straddled aperture's eye-ray footprint without ordinary near-cap rejection and use
  the retained parent-bounded footprint as executable screen-space mask geometry and as the
  adjacent domain's traversal window. Downstream portals therefore remain inside the same
  aperture-crossing camera rays.
- Keep residency as the sole layer-zero root. Write a straddle's NDC mask without a depth test,
  reset depth only inside it, and execute the adjacent domain through the ordinary later-layer
  path. Outdoor-sourced branches remain bounded by that inherited window.
- Present the completed composite color to the active view destination without claiming copied
  default-framebuffer depth.
- Add tunnel, multi-window, exterior-root, interior-root, and exterior-straddle fixtures; decide
  composite ping-pong from an executable feedback case rather than legacy structure.
- Exercise the exterior operation through a small standalone composition seam in the synthetic
  browser harness while the public `portal` mode remains disabled. This seam owns only target
  sequencing, exact transition-mask application, masked depth replacement, and cached-exterior
  copy; it is not a parallel graph executor. Arbitrary internal-boundary integration and exterior
  re-entry belong to Phase 12B; production activation belongs to Phase 13.
- Accumulate all transition effective apertures for one reached domain into the current
  layer-label union, then perform that domain render/copy once. A transition edge never owns a
  repeated exterior or indoor contribution.

#### Checklist

- [x] Assert exterior scene-domain render count is zero or one per independent view.
- [x] Copy exterior color and sampled depth through every transition; color-only composition is
      invalid.
- [x] Validate the exact WebGL depth function with nearer exterior geometry over an
      outdoor-to-indoor aperture before the masked depth reset.
- [x] Allocate required synchronous domain targets before drawing; allocation or device loss is a
      typed fatal/restart-required outcome, never stale prior-frame reuse.
- [x] Keep transparent/additive ordering correct inside each scheduled domain and constrain copied
      exterior results by transition masks.
- [x] Preserve one exterior render when an exterior transition straddles the near plane.
- [x] Preserve outdoor-sourced portals to other buildings while an indoor root straddles its
      exterior transition.
- [x] Keep flat mode's scene selection, draw ordering, resource ownership, and zero portal-work
      counters unchanged; do not promise byte-identical GPU output.

#### Acceptance

- Terrain depth cannot cover an indoor tunnel visible through an accepted exterior transition.
- Exterior geometry renders at most once with any number of transition apertures.
- Outdoor-root and indoor-root views composite color and depth correctly through arbitrary planar
  transitions.
- Exterior near-plane straddles show both sides without black regions, flicker, or residency
  changes.
- No fixture in this phase claims full internal topology execution; it proves the exterior
  scene-domain operation consumed later by Phase 12B.

### Resteering Gate F — Exterior Composition Audit — Complete 2026-07-28

Pause before internal masks.

#### Acceptance

- Synthetic browser pixel reads cover tunnel depth, multiple windows, both root directions, every
  established blend class, and exterior near-plane straddle.
- Multiple transition apertures form one layer-label union without increment/decrement, scratch, or
  per-transition contribution draws. Internal render-layer preservation and exterior re-entry are
  Phase 12B integration assertions.
- Exterior draw count is independently bounded for each view and no stale view image is reused.
- The executable pass graph proves whether a second composite target is necessary; absent that
  proof, the architecture retains one exterior and one composite target.
- Flat mode remains the production default and allocates or executes no portal work.

### Phase 12A — Internal Portal-Graph Execution

Land the graph consumer against indoor-only plans before hybrid exterior composition enters the
same debugging surface. This phase proves the final graph-to-GPU contract but does not activate the
Explorer control or execute plans containing exterior transitions.

#### Deliverables

- Add one thin renderer-local consumer that executes the final Phase 10C graph through the Phase
  11A layer-mask substrate. It resolves existing IDs and invokes existing render contribution
  paths; it does not build another graph or contribution schedule.
- Factor renderer contribution collection into reusable per-scope resolved content. Flat mode
  consumes one flat selection; portal execution consumes unique render nodes without making
  topology paths, windows, or stencil values part of contribution identity.
- Interpret render layers exactly as emitted. For each non-root layer, union its admitted incoming
  masks, reset depth once inside the union, and invoke each member render node once. Do not
  re-sort, re-deduplicate, split by window, or manufacture a per-mask draw schedule.
- Execute internal topology-bounded dual-side near-plane seeds inside their inherited parent
  region.
- Keep opaque/alpha-test, transparent, and additive ordering correct for each scheduled masked
  branch.
- Introduce the indoor subset of consumed `PortalFrameDiagnostics`: admitted/rejected visibility
  states, render nodes, mask edges, render layers, selected scopes, mask draws/capacity,
  near-plane seeds, and submitted draw counts. Add a field only when a fixture or the later
  Explorer inspector consumes it.
- Reuse Gate E's pure dense-grid, cycle, and window-oracle coverage. Add GPU fixtures only where
  pixel execution adds evidence: nested/non-Euclidean masks, both-direction/exact-contact internal
  straddles, concave effective masks, disjoint/overlapping layer unions, and every established
  material pass. Non-exact reciprocal geometry belongs exclusively to Phase 11A
  host/preplanner coverage.
- Reject a graph containing an exterior transition before any partial draw. Phase 12B owns hybrid
  integration through the already-proven Phase 11B operation.

#### Checklist

- [x] Consume only graph-admitted edges; do not repeat facing, window clipping, topology traversal,
      SCC construction, or layer derivation in the GPU path.
- [x] Treat the finalized render-layer mask state as authoritative; no CPU window or scissor enters
      the executor contract.
- [x] Keep visibility-island scheduling from merging culling groups, nodes, or draw submissions
      across EnvCell scopes.
- [x] Assert every selected scope contribution belongs to exactly one render node and is submitted
      once, regardless of incoming route or window count.
- [x] Assert one planner graph produces one execution trace directly; no executor-side route,
      region, partition, or contribution-plan collection exists.
- [x] Keep internal dual-side seeds inside their existing parent stencil region and leave player,
      camera, and Explorer residency unchanged.
- [x] Consume Phase 11A's complete render-layer stencil-label capacity preflight before issuing any
      partial draw.
- [x] Assert every mask edge resolves exactly one effective visibility aperture; the executor has
      no authored reciprocal lookup or intersection branch.
- [x] Exercise layer-wide execution against disjoint siblings,
      spatially overlapping/non-Euclidean cells, transparent/additive residents, cycles, and
      internal near-plane straddles.
- [x] Verify the portal path disables structured-shell culling while flat mode still forces `BACK`
      culling only for structured shells.
- [x] Keep the public `portal` mode rejected until Phase 13.

#### Acceptance

- Proven indoor visibility islands spend no masks on uniform subdivision seams.
- Unproven/non-Euclidean child geometry is visible only through its admitted exact topology masks.
- Crossing an internal portal with the camera near plane produces no black frame, flickering side
  selection, or missing adjacent branch.
- Multi-portal corner contact computes the complete topology-bounded seed closure without changing
  residency.
- Nested and adjacent render-layer masks pass the accepted adversarial pixel fixture matrix. Any
  failure is a renderer-strategy blocker rather than an invitation to silently grow a second
  execution model.
- Overlapping windows only add visibility/mask coverage and do not duplicate transparent or
  additive contribution.
- Indoor-only graph execution remains app-local and reaches the existing render contribution path
  without importing the legacy frame-plan hierarchy.

### Resteering Gate G — Internal Execution Audit

Pause before combining internal masks with exterior composition.

#### Acceptance

- Synthetic browser pixel reads prove layer unions, exact mask confinement, internal near-plane
  dual-side rendering, structured-shell culling policy, and every established material pass.
- One planner graph maps directly to one execution trace; no executor-private route, region,
  partition, or contribution scheduler exists.
- Each selected scope and render node is submitted once regardless of alternate incoming masks.
- Exterior operations fail before drawing, flat mode remains unchanged, and production `portal`
  mode remains rejected.
- Any layer-union leakage, contribution duplication, or blend-order failure blocks Phase 12B.

### Phase 12B — Hybrid Composition Integration — Complete 2026-07-28

Combine the proven Phase 12A internal executor with Phase 11B exterior composition. This phase
completes the hybrid renderer but still leaves public activation to Phase 13.

#### Deliverables

- Consume the planner-emitted exterior-component operation directly wherever the graph reaches an
  `exterior-transition`; do not derive another transition schedule or redraw exterior per mask.
- Compose exterior re-entry and internal render layers without framebuffer feedback, stale
  per-view results, or duplicated scene-domain contributions.
- Execute topology-bounded internal and exterior dual-side near-plane seeds inside their inherited
  parent regions.
- Keep opaque/alpha-test, transparent, and additive ordering correct across scheduled indoor
  branches; exterior transparency remains part of the cached exterior result.
- Complete `PortalFrameDiagnostics` with exterior render/composite counts and the submitted
  scene-domain draw counts consumed by the browser gate and later Explorer inspector.
- Add GPU fixtures only for hybrid facts: indoor → outdoor → indoor re-entry, internal/exterior
  mask interaction, both-direction exterior straddles, multiple transition windows, and mixed
  material passes.

#### Checklist

- [x] Invoke only the graph-emitted exterior-component operation and Phase 11B composition
      primitives.
- [x] Preserve the graph's authoritative render layers across exterior copy/reset operations.
- [x] Assert one exterior render per independent view and one contribution submission per reached
      render node.
- [x] Keep all dual-side seeds inside their existing parent mask and leave player, camera, and
      Explorer residency unchanged.
- [x] Exercise indoor → outdoor → indoor, overlapping transition/internal masks, every blend
      class, and internal plus exterior near-plane straddles.
- [x] Keep the public `portal` mode rejected until Phase 13.

#### Acceptance

- Exterior re-entry and internal topology masks compose without framebuffer feedback or duplicated
  exterior rendering unless an executable fixture proves otherwise.
- Terrain cannot overwrite an underground tunnel visible through a reached outdoor-to-indoor
  transition.
- Internal and exterior near-plane intersections produce no black region, flicker, or residency
  mutation.
- Overlapping windows add mask coverage without duplicating transparent, additive, or exterior
  contributions.
- The completed renderer remains app-local and preserves the useful legacy scene-domain behavior
  without importing the legacy frame-plan hierarchy.

### Phase 13 — Portal Mode Activation, Explorer UX, and Performance Audit

#### Deliverables

- Replace the renderer's `portal` rejection with the accepted hybrid path while preserving `flat`
  as a permanent first-class mode.
- Enable the existing Explorer `Portal rendering` control. A mode switch invalidates frame work
  only; it does not reload content, rebuild GPU resources, republish scene state, or mutate
  residency.
- Expose the consumed `PortalFrameDiagnostics` in the existing frame inspector without duplicating
  renderer state in Svelte.
- Compare representative small, dense, transition-heavy, resident-heavy, and blended-material
  captures, window/render-node/mask-edge/render-layer counts, draw/composite counts, target bytes,
  planner time, and render time against the Phase 6 flat baseline. Effective-aperture provenance is
  static source evidence and must not become repeated frame telemetry.
- Make `portal` the default only after the complete browser and lifecycle acceptance matrix passes.

#### Checklist

- [x] Toggle modes repeatedly without content reload, scene republish, resource-count drift, or
      residency mutation.
- [x] Assert flat mode executes zero portal masks and composites even after returning from portal
      mode; retained renderer-owned targets may remain allocated until resize or destroy only if
      diagnostics make that ownership explicit.
- [x] Keep the useful flat structured-shell culling policy and the portal shell policy independent.
- [x] Ensure every displayed diagnostic drives a concrete inspection or fixture assertion.
- [x] Record performance measurements as evidence, not hard-coded product thresholds.

#### Acceptance

- Explorer switches between accepted portal rendering and bird's-eye-friendly flat inspection at
  runtime.
- Portal mode passes the full synthetic browser matrix and selected archive-backed diagnostics.
- No mode switch changes authoritative, camera, or Explorer residency.
- Portal becomes the default only after these checks are recorded.

### Phase 14 — Cleanup, Documentation, and Full Verification

#### Deliverables

- Inventory candidate outdoor-only aliases, old detail-owner policy, first-match residency APIs,
  duplicate geometry helpers, and compatibility paths; remove only those proven superseded by the
  completed implementation.
- Update `apps/holtburger-3d/ARCHITECTURE_AUDIT.md` with the final source, ownership, scene, query,
  authored/effective aperture, portal-window, render-graph, render-layer, and renderer boundaries
  using the architecture-audit workflow.
- Update `docs/portal_rendering.md` and the existing BSP/file-format references with only the proven
  CellStruct surface, Cell BSP containment, portal-side, `ExactMatch`, effective-visibility
  intersection, potentially-visible, clipped-window, and mask/composition semantics touched by
  this work.
- Add permanent synthetic tests for pure contracts and retain archive-backed diagnostics only as
  opt-in harnesses.
- Record final fixture metrics and known concessions.

#### Checklist

- [x] Search for obsolete `OutdoorStaticLayerKind`, `ActiveRegionObjectDetailOwner`, and
      `queryWorldPointResidency` uses.
- [x] Search for HBEC v1 crossing decode, paired renderer `apertureIds`,
      `requiresNonExactScratchValue`, `pushMask`, `popMask`, and live mask-stack terminology;
      remove every superseded production/test contract.
- [x] Verify no env-cell-specific copy of object texture/material/atlas closure remains.
- [x] Verify no aperture is represented as a textured material range.
- [x] Verify diagnostics fields are consumed by harness/UI/audit or remove them.
- [x] Run formatting, frontend tests/checks/lints/build, Rust tests/checks/clippy, and browser
      harnesses.
- [x] Confirm this implementation added no generated captures, runtime assets, or submodule
      changes; inventory and preserve unrelated pre-existing user changes.

#### Acceptance

- The final architecture has one cumulative source batch, one generalized polygon primitive, one
  static material pipeline, specialized interior/topology/query contracts, and renderer-local
  portal-window/render-node/render-layer policy.
- All touched lint and clippy warnings are resolved rather than suppressed.
- Permanent tests are deterministic without local client archives.
- Architecture and format docs distinguish proven facts from deferred behavior.

### Phase 15 — Post-Closeout DRY and Boundary Cleanup

#### Deliverables

- Replace the independent HBSO and HBEC aligned-section encoders with one typed Rust binary-section
  writer while keeping record headers, manifests, and domain validation specialized.
- Extract shared TypeScript binary-section schemas, range/overlap validation, and typed readers;
  move static geometry, material, and presentation decoding out of the outdoor-record module into
  an honestly named shared source-decoding module.
- Centralize `AssetTextureFact` compatibility, deduplication, and stable ordering.
- Parse typed landblock-layer owner IDs at the owner boundary and share the realizer-currentness
  predicate instead of slicing owner strings in each realizer configuration.
- Move completed portal-work-plan validation out of the WebGL executor and keep execution a thin
  resource-resolution plus draw interpreter.
- Consolidate only exact portal-fixture geometry/diagnostic boilerplate and trivial source
  projection identity helpers. Keep fixture scenarios and record-specific policy explicit.
- Update the architecture audit and this plan with landed boundaries, verification, concessions,
  and any cleanup rejected as false abstraction.

#### Checklist

- [x] HBSO and HBEC section metadata, alignment, scalar encoding, and finite-float checks use one
      Rust writer.
- [x] HBSO and HBEC decoders use one binary-section validator/reader, including overlap rejection,
      while retaining independent envelope and required-section contracts.
- [x] HBEC no longer imports shared static decoding through an outdoor-named module.
- [x] Every static texture requirement merge uses one compatibility helper.
- [x] `GameRuntime` contains no manual `landblock-layer:` substring parsing.
- [x] WebGL portal execution does not derive or validate topology/component membership itself.
- [x] Exact fixture/source-projection helpers are shared without introducing scenario builders or
      generic serialization frameworks.
- [x] Focused tests prove each extracted primitive and the full verification matrix remains green.

#### Acceptance

- No source record or renderer behavior changes; existing binary fixtures and browser pixels remain
  valid.
- Shared helpers own real invariants rather than forwarding one caller or hiding record-specific
  decisions.
- `decode-outdoor-static-record.ts`, `webgl2-portal-executor.ts`, and `game-runtime.ts` lose
  responsibilities instead of gaining configuration ceremony.
- Linters, Knip, Clippy, tests, builds, and archive-backed portal/flat verification remain green.

## Verification Matrix

Run focused checks during each phase, then the full matrix in Phase 14.

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
- Effective visibility aperture: exact/source reuse, non-exact coplanar intersection, provenance,
  strict over-threshold failure, unresolved-reciprocal fallback, and unchanged authored-query
  geometry.
- Resident-heavy interior: authored/static/deferred/materialized counts and transform composition.
- Dense grid: outgoing adjacency, retained/admitted windows, relationship classes, render nodes,
  mask edges, SCCs/render layers, shell/resident group membership, aggregate versus exact-node
  rejections, mask depth, overdraw, planner timing, and frame counts.
- Tunnel transition: outdoor terrain depth plus an EnvCell one edge underground; verify masked
  color/depth composition exposes the interior without redrawing exterior.
- Multi-window interior: several accepted outdoor crossings reuse one exterior render and preserve
  exterior depth through every composite; overlapping target windows neither erase nor duplicate
  blended contribution.
- Near-plane straddle: both approach directions, exact contact, outside-aperture rejection,
  arbitrary aperture shape, four-cell corner closure, and exterior reuse.
- Overlap case: Explorer ambiguity plus authoritative camera trace connectivity.
- Lifecycle: load, evict to zero resources/nodes/crossings, reload, destroy.
- Synthetic material fixture: building/environment detail roles, ordinary-object no-detail
  bindings, and every established blend class behind a portal mask.

Do not run the TUI. Archive-backed diagnostics and browser runs are non-interactive and opt-in.

## Risks and Mitigations

| Risk                                                                                 | Mitigation                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EnvCell surface indices differ from GfxObj material slots.                           | Keep CellStruct adapter specialized and prove indexing before wire stabilization.                                                                                                                        |
| Portal polygon winding or `PortalSide` is interpreted backward.                      | Capture both directions from retail/ACE, retain source flags, and test reciprocal accepted sides.                                                                                                        |
| Arbitrary apertures are accidentally treated as convex quads.                        | Use a maintained arbitrary-polygon boolean implementation in the host preprocessor and cover concave, multipart, opposite-winding, and disjoint results before triangulation.                            |
| Effective-aperture preprocessing changes spatial-query behavior.                     | Preserve the authored source aperture as the only point/segment/residency input; carry the effective visibility aperture through a separately named field consumed only by planning and rendering.       |
| A non-exact reciprocal is not coplanar enough for static intersection.               | Validate against the census-backed app-host `0.001` tolerance and fail record construction with identities/deviation above it; never silently snap arbitrary geometry or fall back to paired GPU masks.  |
| Coplanar snapping hides malformed source data.                                       | Retain both authored geometries and measured deviation as provenance, expose archive counts through the Phase 11A gate, and keep the shared query epsilon unchanged.                                     |
| Dense portal grids make traversal quadratic.                                         | Build outgoing adjacency at publication and measure visited scopes plus outgoing edge counts.                                                                                                            |
| Exact portal windows fragment or accumulate excessively.                             | Broad-phase before exact clipping, normalize harmless duplicate/collinear vertices, and require Phase 10C plus Gate E to prove one bounded fixed-point admission invariant.                              |
| Window admission erases a valid route.                                               | Compare incremental results with a slow exact oracle; exact duplicates/subsumed states may suppress re-expansion, while unresolved or novel partial overlap remains explicit.                            |
| A layer-wide mask union exposes one node through another node's aperture.            | Exercise the legacy-proven layer executor against adversarial pixel fixtures in Phase 12A. A reproduced failure blocks at Gate G; do not hide it behind a speculative second executor.                   |
| Renderer window state contaminates general portal queries.                           | Keep windows in the renderer; preserve Phase 7 containment and Phase 8 directed segment tracing as independent view-free contracts.                                                                      |
| Overlapping non-Euclidean cells make point residency nondeterministic.               | Reserve point containment for Explorer bootstrap; use authoritative residency and portal traces in client mode.                                                                                          |
| Full Cell BSP transport expands scope into collision.                                | Project the retail point-containment plane chain only; retain canonical full BSP in Rust for future consumers.                                                                                           |
| Resident transforms are applied twice or in the wrong coordinate frame.              | Compose once at materialization, name the result landblock-space, and test non-identity parent/child rotations.                                                                                          |
| Static batching merges residents from different EnvCell scopes.                      | Partition by `envCellId` before geometry/material/pass batching; share immutable resources but forbid multi-scope nodes, instance populations, and draw submissions.                                     |
| An authored cell AABB excludes a protruding resident.                                | Build producer-group aggregates from actual transformed member-node bounds and retain exact node tests after the group broad phase.                                                                      |
| Visibility islands become accidental culling/ownership groups.                       | Use islands only for ordinary-depth scheduling; keep scope indexes, producer groups, nodes, and submissions independently addressable per EnvCell.                                                       |
| Generic geometry refactor erases domain semantics.                                   | Generic builder owns mechanics; GfxObj and CellStruct adapters own selection and material-slot meaning.                                                                                                  |
| Detail textures remain hard-coded to buildings.                                      | Introduce semantic roles before EnvCell rendering and make missing roles explicit.                                                                                                                       |
| Atomic publication leaks mixed system ownership.                                     | One transaction/release handle owns all layer resources; transforms are flattened and scope IDs cross systems.                                                                                           |
| Flat shell culling leaks onto residents or becomes accidental global GL state.       | Apply forced `BACK` culling only while submitting typed structured-shell ranges; assert authored resident/outdoor culling before and after the shell draw.                                               |
| Portal work breaks the useful flat diagnostic path.                                  | Keep `flat` as a permanent typed frame mode, require zero portal work in that mode, and run its bird's-eye/lifecycle baseline through Phases 9–13.                                                       |
| A heuristic elides a required portal mask.                                           | Only proof-backed indoor seams enter visibility islands; every unproven internal edge masks and every exterior edge composites.                                                                          |
| Terrain depth covers an underground interior behind an exterior portal.              | Treat every indoor/outdoor transition as a mandatory color-plus-depth composite boundary and test a tunnel fixture.                                                                                      |
| Exterior geometry is redrawn through every window.                                   | Render one exterior scene-domain target per camera frame and reuse its sampled color/depth through every mask.                                                                                           |
| Offscreen targets add memory, resize, or lifecycle leaks.                            | Allocate renderer-owned extent-keyed targets, measure bytes, dispose transactionally, and invalidate the whole renderer into a typed restart-required state on context loss.                             |
| Color-only composition breaks later depth and transparency.                          | Source-scene copy samples and writes depth; cover every established blend class and both root directions.                                                                                                |
| A portal mask degenerates when its aperture enters the camera's near-clipped volume. | Detect exact aperture-triangle intersection with the finite eye-to-near-plane pyramid and seed both adjacent branches inside the current parent region.                                                  |
| Straddle handling mutates or destabilizes residency.                                 | Keep it stateless and renderer-local; camera/player residency remains eye/history-derived.                                                                                                               |
| Camera-point or AABB overlap produces false straddles.                               | Clip actual aperture triangles against the finite eye-to-near-plane pyramid and test outside-volume contacts.                                                                                            |
| Blended draws are submitted twice through alternate portal routes.                   | Make render-node identity the sole contribution owner, attach alternate routes only as incoming mask edges, and assert one opaque/alpha/transparent/additive submission per selected scope contribution. |
| Authored PVS is over-trusted.                                                        | Preserve it as preload/containment-candidate provenance; never use it to reject portal traversal.                                                                                                        |
| Diagnostics become ceremonial.                                                       | Every metric must feed a harness assertion, UI inspection, audit decision, or be removed.                                                                                                                |

## Definition of Done

- [x] Environment cells are a first-class independent HBLB record requested through
      `LandblockSourceBatchSource`.
- [x] The host resolves `LandblockInteriorSystemAsset` only for an EnvCells request.
- [x] CellStruct shell geometry, materials, apertures, containment, topology, and residents cross a
      strict versioned binary boundary.
- [x] GfxObj and CellStruct share a focused polygon geometry primitive without conflated semantics.
- [x] Building and environment detail textures work through semantic active-region roles, while
      ordinary-object layers retain the proven no-detail state.
- [x] Every authored EnvCell static resident is materialized, explicitly deferred, or loudly
      unsupported.
- [x] Cell shells and residents use landblock-space transforms and retain EnvCell scope identity.
- [x] Resident batching is partitioned by EnvCell scope; no baked node, instance population,
      transparent population, or draw submission spans multiple EnvCells.
- [x] Each EnvCell scope owns independent shell and static-resident producer groups whose aggregate
      bounds union actual transformed members before exact node tests.
- [x] Flat and portal modes share the same culling-group and exact-node query policy after their
      intentionally different scope-selection steps.
- [x] EnvCell layer publication and eviction are atomic and leak-free.
- [x] Portal render planning uses source-keyed outgoing adjacency, directed facing, exact inherited
      portal-window clipping through one effective visibility aperture per crossing, unique render
      nodes, ordered render layers, and one Gate E-proven bounded visibility-admission invariant.
- [x] Claimed outside/building portals connect the landblock/outdoor scope and EnvCell scopes using
      both authored aperture records; each direction exposes one effective visibility aperture and
      unresolved claims remain explicit.
- [x] Proof-backed indoor visibility islands render ordinary spatial seams without masks; every
      unproven indoor edge remains a topology-mask boundary.
- [x] Portal-window geometry remains renderer-local and clips visibility regions rather than scene
      meshes, collision, containment, or residency queries.
- [x] Flat mode renders all resident EnvCell shells and residents in the ordinary main view, issues
      no portal/offscreen work, and remains permanently selectable.
- [x] Flat mode forces `BACK` culling only for structured EnvCell shell ranges so bird's-eye
      inspection can see cell interiors; resident and outdoor materials retain authored culling.
- [x] Explorer exposes a typed `Portal rendering` control whose mode switch causes no content
      reload, resource rebuild, scene republish, or residency mutation.
- [x] Explorer initial placement uses AABB candidates plus retail-equivalent Cell BSP containment
      and preserves ambiguity.
- [x] Runtime camera-query primitives trace from caller-supplied authoritative actor residency
      through directed authored planar apertures, never preprocessed visibility intersections;
      production client/controller ownership remains deferred.
- [x] Aperture geometry is material-free.
- [x] HBEC v2 preserves authored query apertures, carries one effective visibility aperture per
      crossing with provenance, and contains no frontend reciprocal-intersection work.
- [x] Every indoor/outdoor transition composites cached scene-domain color and depth through an
      arbitrary planar mask.
- [x] Exterior terrain, buildings, and objects render at most once per camera frame regardless of
      transition count.
- [x] Exact portal windows propagate visibility into a unique-node render graph; alternate routes
      add mask edges rather than geometry submissions.
- [x] Legacy-style layer-wide mask union executes each reached node once and passes the adversarial
      browser fixture matrix without a second contribution model.
- [x] WebGL mask execution consumes one effective aperture per edge, one stencil label per render
      layer, and no paired-aperture, scratch-value, increment/decrement, or mask-stack protocol.
- [x] Finite near-plane/aperture straddles render both adjacent branches without black regions or
      residency changes.
- [x] Straddle closure handles multi-portal corners without camera-point slabs, aperture AABBs, or
      fixed-hop traversal.
- [x] Existing outdoor render paths and lifecycle behavior remain green.
- [x] Synthetic tests require no local DAT/HBA assets; selected archive-backed diagnostics and
      browser harnesses pass.
- [x] Architecture and file-format documentation reflect the final proven contracts.
- [x] No dead compatibility types, unconsumed diagnostics, lint ignores, staged files, or commits
      are left behind.

## Implementation-Time Validation Questions

These measurements can tune an implementation but cannot change the locked semantic contracts:

1. Which CellStruct source geometry is equivalent enough to deduplicate without merging per-cell
   surface bindings or transforms?
2. Does internal `LEQUAL` versus exterior-transition `ALWAYS` remain the minimum complete
   depth-test policy for effective layer-mask writes across the accepted browser matrix?
3. Does the measured render graph need a second composite ping-pong target, or can one exterior
   source plus one composite destination cover every non-feedback pass?
4. Which minimum exact-window subsumption rule does Gate E evidence require to reach a bounded
   fixed point without erasing sibling visibility?
5. What single renderer-only epsilon makes near-plane/effective-aperture edge contact stable across
   the selected coordinate scales without introducing false dual-side seeds?
6. Does the potentially-visible candidate set materially improve preload or Explorer containment
   discovery enough to justify consuming it beyond diagnostics?
7. Which static-authored animation capability should be implemented in a later plan before deferred
   residents can become live without abusing spawned-dynamic ownership?
8. Do admitted window fragments justify a fixed-buffer optimization after Gate E, or are ordinary
   short-lived arrays already below the measured planning budget?

## Decisions

### 2026-07-27 — Evidence Finalization

- CellStruct shells render all authored render polygons; only polygon emission is generalized with
  GfxObj.
- Surface slots are signed, direct, and zero-based.
- Detail texture roles follow render domain rather than source-surface flags: landscape for
  terrain, building for building shells, environment for CellStruct shells, and no detail for
  ordinary objects.
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
  visibility islands; every unproven internal edge retains exact nested topology masking selected
  by renderer-local portal windows.
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
  portal aperture enters the finite clipped volume between the eye and near-plane cap while the
  eye can remain unambiguously resident on one side.
- Rejected padded aperture AABB containment and fixed one-hop expansion. Phases 9–11 instead
  clip actual aperture triangles against the finite near-clip pyramid and compute a visited,
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
  before exact-window-selected internal stencil and near-plane closure are layered on top.

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

### 2026-07-27 — Phase 8 Runtime-Primitive Boundary

- Corrected the Phase 8 wording that implied production client and third-person-controller
  implementation. The current client surface is intentionally only a route shell; EnvCell
  integration does not bootstrap the client runtime, authoritative actor feed, or camera owner.
- Phase 8 now provides pure directed portal tracing plus a runtime query accepting a
  caller-supplied authoritative actor position/residency and desired endpoint. That is the complete
  reusable primitive a future client camera coordinator needs.
- Rejected using Explorer free-fly state as a surrogate player anchor and rejected adding a
  no-caller controller abstraction. Explorer bootstrap remains the independent Phase 7
  containment policy.

### 2026-07-27 — Remaining-Phase Dry Run and Portal Resequencing

- Accepted typed fatal/restart-required invalidation on WebGL context loss. Honest in-place recovery
  requires reconstruction of every renderer and resource-manager allocation and is deferred to a
  dedicated device-lifecycle plan.
- Found that the former exterior-composition phase depended on path ancestry, selected-scope
  culling, domain partitioning, and cycle semantics scheduled only in the following phase.
  Introduced a pure renderer-local work-planning phase before all production composition.
- Inserted Phase 9A as the immediate clean cutover: remove the flattened
  `SceneGraph.queryFrustum()`/`VisibleScene.crossings` façade, expose separate topology and explicit
  selected-scope spatial contracts, remove its premature metrics, and relocate renderer-only
  near-plane math before Phase 9B GPU work resumes.
- Split the former internal-portal mega-phase into work planning, internal GPU execution, and
  Explorer activation/performance gates. Production `portal` mode remains rejected until the
  integrated renderer passes its browser matrix.
- Corrected exterior reuse from once per aggregate frame to once per independent `FrameViewInput`;
  renderer targets may be reused sequentially, but camera images may not.
- Completed the scene-domain target contract: both exterior and composite targets retain
  color/depth-stencil, and an explicit final presentation step outputs composite color.
- Moved traversal bounds and stencil-overflow preflight from the raw GPU substrate into pure work
  planning, where simultaneous path ancestry is known before any partial draw.
- Rejected global scope deduplication in portal work. Cycles are guarded within active ancestry,
  while sibling paths may legitimately schedule the same scope under different masks.
- Narrowed cleanup promises to evidence-backed removals and named documentation targets; preserved
  pre-existing user/submodule work as out of scope.

### 2026-07-28 — Gate E Exact Portal-Window Resteer

- Gate E disproved the Phase 0/10 assumption that path-local stencil ancestry could replace
  clipped-window propagation in the planner. The failed simple-path implementation reached 50,000
  path occurrences and 100,001 work items on landblock `0x0001FFFF` at mask depth 14; this was an
  algorithmic failure, not a stencil-capacity problem.
- Retail evidence established the missing invariant: `PView::GetClip`, `Render::copy_view`,
  `ClipPortals`, `AddViewToPortals`, and `OtherPortalClip` propagate exact clipped screen windows,
  accumulate destination-cell views, process new views incrementally, and intersect both authored
  apertures for non-exact reciprocals.
- Chose a clean purge rather than adapting the failed `PortalWorkOccurrence` tree. Phase 10A
  deletes its implementation, tests, renderer probe, path-count diagnostics, and terminology
  before replacement work begins.
- Rejected cloning retail's allocator-heavy renderer or depth-mask flow. Phase 10B ports only the
  exact view-window invariant into small renderer-local geometry primitives; the completed Phase 9B
  WebGL stencil/depth substrate remains the pixel authority.
- Rejected coarse tiles, rectangles, or bounds as authoritative window state. They may reject work
  only when conservatively proven safe and may not delete an exact route or become the final render
  mask.
- Replaced recursive topology-path identity with Phase 10C exact-window traversal and relationship
  evidence. Phase 10D must convert that evidence into bounded admission and exact submission
  regions that neither erase sibling views nor duplicate blended contribution.
- Kept the resteer renderer-local. Phase 7 Explorer containment and Phase 8 authoritative-anchor
  directed segment tracing already provide the required general spatial-query primitives and are
  explicitly regression-tested through Gates E1 and E2.
- Preserved exterior render-once color/depth composition, exact authored stencil masks,
  non-exact reciprocal intersections, near-plane dual-side seeds, visibility islands, culling
  groups, flat mode, and Explorer mode switching. Phases 11–13 consume the finalized Phase 10D
  submissions without changing scene-domain ownership.

### 2026-07-28 — Remaining-Phase Coherence Pass

- Found that the first resteer overloaded Phase 10C: a pure visibility planner could classify
  overlapping exact windows but could not prove that later GPU execution would avoid duplicate
  transparent/additive contribution.
- Split the contract at that boundary. Phase 10C now retains discrete exact windows and produces an
  overlap census; Gate E1 selects the minimum required submission mechanism; Phase 10D proves
  bounded admission, exact submission regions, blended-pass behavior, and mask/guard capacity;
  Gate E2 audits the final plan before exterior work.
- Standardized `PortalViewWindow` as a post-homogeneous-clip NDC polygon collection. Viewport
  rectangles and screen tiles remain broad phases or scissors, never authoritative visibility.
- Made `PortalWindowSubmission`, rather than a topology route or raw window, the Phase 12 draw
  contract. This keeps route provenance available for exact masks without making topology paths
  contribution identity.
- Narrowed Phase 11 to the standalone exterior scene-domain operation. Full internal-boundary
  execution, exterior re-entry, and arbitrary plan integration remain Phase 12 responsibilities.
- Aligned Phase 13 diagnostics/performance evidence and Phase 14 architecture/documentation work
  with windows, overlap resolution, submissions, mask/guard capacity, and planner timing.
- Kept Phase 7 containment and Phase 8 directed segment tracing outside every render-window and
  submission contract.

### 2026-07-28 — Unique Render Nodes and Layer-Wide Mask Cohorts

- Re-examined legacy from static projection through frame execution. Legacy creates one render
  entry per EnvCell, attaches multiple incoming mask edges to shared targets, groups entries into
  render layers, unions every layer's aperture masks, resets depth once, and draws each entry once.
- Corrected the remaining plan's central ownership mistake: portal windows and routes propagate
  visibility and mask coverage; they never own geometry contribution. Removed
  `PortalWindowSubmission`, per-window guard, exclusive overlap-region, and route-driven repeated
  draw contracts from every forward phase.
- Reframed Phase 10C as a unique-node incremental visibility graph with SCC/layer derivation.
  Phase 10D now proves one bounded fixed-point admission rule and an executable mask-cohort
  contract; Phase 12 executes each selected scope contribution exactly once.
- Retained legacy-style layer-wide stencil union as the baseline mask-cohort policy because it has
  substantial real-world evidence and materially reduces stencil values, depth resets, and state
  churn. A theoretical cross-mask leak does not justify universal node-specific masking.
- Added an isolated per-node pixel oracle for hostile sibling, overlapping/non-Euclidean,
  transparent, cyclic, transition, and near-plane fixtures. Only a reproduced mismatch may
  partition the smallest affected cohort.
- Preserved exact clipped windows for empty-route rejection, incremental convergence, descendant
  propagation, diagnostics, and optional scissors. They remain renderer-local and do not contaminate
  containment, residency, collision, or directed segment queries.

### 2026-07-28 — Portal-Planning Structural Simplification

- A follow-up coherence review found that replacing per-window submissions in the contracts had
  not removed their ceremonial phase structure. The plan still carried a reference overlap census,
  a separate final-admission phase, and two planning gates for a draw-ownership problem that unique
  render nodes already eliminate.
- Removed Phase 10D and Gate E2. Phase 10C now produces the final pure
  `PortalRenderWorkPlan`—exact visibility fixed point, unique nodes, accumulated mask edges,
  SCC-derived cohorts, transitions, selected scopes, and complete capacity preflight—and one Gate E
  audits it before GPU work.
- Removed overlap classification as a draw-contract decision. Window equality, subsumption, and
  partial novelty remain only to drive bounded visibility convergence.
- Moved layer-wide cohort correctness to Phase 12, where the real GPU executor can be compared with
  a test-only isolated-node oracle. Pure planning no longer pretends to prove pixel composition.
- The remaining pacing is now purge → exact window math → final graph planner → one planner gate →
  exterior composition → cohort executor → UX/performance → cleanup.

### 2026-07-28 — Executable Render-Layer Contract Simplification

- A follow-up review found that the operative plan still exported planner-private window state and
  pre-designed an isolated-node executor plus conditional cohort partitioning after unique
  render-node contribution ownership had already been accepted.
- Removed windows from the executable work-plan shape. Exact clipped windows remain necessary for
  empty-route rejection and fixed-point visibility propagation, but terminate at the planner
  boundary.
- Collapsed `PortalMaskCohort` into the already-required ordered `PortalRenderLayer`. Each layer
  directly owns its admitted mask-edge union and unique member nodes; Phase 12 has one execution
  model.
- Removed the speculative isolated-node executor and cohort-partition framework. Phase 12 validates
  legacy-style layer union with adversarial pixel fixtures and treats any reproduced failure as a
  strategy blocker requiring explicit resteering.
- The remaining sequence is unchanged because exact visibility convergence, exterior color/depth
  composition, and final GPU execution are still independent proofs. The contracts crossing those
  phases are materially smaller.

### 2026-07-28 — Thin Graph-Consumer Coherence Correction

- A further review found that the planner contracts were substantially simplified while the
  remaining GPU-phase prose still sounded like it would invent a second execution plan. Corrected
  the boundary: `PortalRenderWorkPlan` is the complete schedule, and the renderer only resolves IDs
  and interprets its ordered layers and transition operations.
- Clarified the reuse claim. The new app already owns the Phase 9B target, stencil-stack, mask-copy,
  and presentation substrate; legacy proves the layer-union sequencing. Phase 12 still needs a new
  integration loop, but not a new graph, route, overlap, partition, or contribution-region model.
- Narrowed Phase 11's standalone seam to exterior target sequencing, exact transition masks, masked
  depth replacement, and cached color/depth copy. Removed internal render-layer restoration from
  Gate F because that integration belongs to Phase 12.
- Removed duplicate GPU coverage for planner-only facts already proven at Gate E. Phase 12 browser
  fixtures now exist only where pixel execution adds evidence.
- Kept Phases 11 and 12 separate. Unique-node ownership simplifies planning and graph consumption;
  it does not discharge the independent tunnel-depth, exterior reuse, stencil-state restoration,
  material-pass ordering, or near-plane composition proofs.

### 2026-07-28 — Effective Visibility Aperture Preprocessing Resteer

- Grounded `ExactMatch` in retail: a directed exact crossing clips with its authored source
  aperture; a non-exact crossing with a reciprocal clips the inherited view through both authored
  polygons. The flag remains authored topology provenance and is not rewritten.
- Extended the archive diagnostic across all non-exact crossings. Of 110,971 non-exact directed
  records, 110,316 have validated internal reciprocals; 109,637 reciprocal directions are coplanar
  within `0.0002`, all 110,316 within `0.001`, and the maximum landblock-space deviation is
  `0.00090026855`. The canonical archive contains no non-exact exterior transition.
- Chose static host preprocessing over permanent planner/GPU paired-mask complexity. A validated
  non-exact reciprocal pair becomes one synthesized planar intersection used by portal-window
  clipping, near-plane tests, and stencil masks.
- Preserved the authored source aperture separately for facing, point/segment crossing, residency,
  and future motion queries. Effective visibility geometry is a render projection and may not
  narrow authoritative spatial semantics.
- Locked `0.001` as a separately named app-host coplanarity/snap tolerance backed by the census.
  It does not widen the shared retail `0.0002` query epsilon. Above-threshold or empty validated
  intersections fail loudly; 655 non-exact records without validated reciprocals retain the
  retail-compatible source-only visibility aperture and an explicit diagnostic.
- Rejected the interim source-layer-to-target-layer stencil-label proposal after dry-running
  alternate incoming layers: a single mutable provenance label can underdraw a valid older-layer
  route after another branch relabels the same pixel.
- Retained the accepted legacy-style layer-wide mask union, now with one effective aperture per
  edge. The substrate cleanly cuts from increment/decrement path-stack operations to direct
  `REPLACE renderLayer` mask writes; Phase 12 still blocks on any reproduced cross-mask leakage.
- Inserted Phase 11A before exterior composition. It owns arbitrary planar intersection, HBEC v2,
  source/effective aperture separation, planner simplification, stencil-capacity simplification,
  substrate purge, and a Gate E rerun. Exterior composition is now Phase 11B.

### 2026-07-28 — Renderer Integration Pacing Split

- Phase 11A evidence confirmed that visibility preprocessing and graph planning are no longer the
  dominant uncertainty. The remaining risk is GPU integration across internal masks, material
  passes, exterior composition, and near-plane dual-side rendering.
- Split the former Phase 12 into Phase 12A internal graph execution, Gate G, and Phase 12B hybrid
  composition integration. This changes proof order only; the final graph, layer-mask substrate,
  exterior operation, and renderer ownership remain unchanged.
- Phase 12A must reject exterior operations before drawing. This creates a debuggable milestone
  where graph-to-layer execution, contribution uniqueness, blend ordering, culling policy, and
  internal straddles are proven without exterior feedback or re-entry.
- Gate G blocks hybrid integration on any layer-union leakage, contribution duplication, or
  material-order failure. Phase 12B then adds only the already-proven Phase 11B exterior operation,
  exterior re-entry, and combined internal/exterior straddles.
- Kept Phase 13 as the sole production activation and Explorer-UX phase. Neither intermediate
  executor becomes a second public render mode.

### 2026-07-28 — Phase 12A Nested-Mask False Blocker Corrected

- Added the thin indoor executor and proved its direct plan consumption in focused tests: render
  layers execute in graph order, every unique node is submitted once, layer masks are accumulated
  before one contribution callback, admitted back-edges do not redraw the root, malformed
  apertures fail before allocation, exterior operations fail before mask resolution/allocation,
  and draw failures restore ordinary destination state.
- Began extracting renderer contribution resolution from flat selection policy. The shared seam
  now resolves already-selected scene-node identities and applies flat versus portal shell-culling
  policy without importing topology identity into contribution identity.
- Added the missing `landblockId` to `PortalDrawUnit`. Aperture geometry is already expressed in
  its owning landblock frame, and production mask transforms cannot be constructed honestly by
  parsing qualified aperture identity strings.
- The first nested-mask browser fixture incorrectly cleared the root depth buffer to far depth
  everywhere. It therefore modeled a masked topology boundary with no source-cell wall or other
  occluding geometry. A deeper aperture correctly passed `LEQUAL` outside the supposed parent
  opening; that result did not prove a renderer leak.
- Legacy confirms the intended executable contract. It draws every aperture mask with depth
  `LEQUAL`, depth writes disabled, stencil `ALWAYS`, and `REPLACE renderLayer`; resets depth only
  for the completed layer label; then draws that layer's resources. Previously rendered source
  geometry supplies the spatial confinement.
- Corrected the permanent fixture to seed a nearer root wall and farther parent opening before
  executing the normal layer masks. The nested aperture writes the expected yellow contribution
  inside the opening and preserves the blue root wall where the same aperture extends outside it:
  `[204, 204, 26, 255]` inside and `[26, 51, 204, 255]` outside.
- Open uniform subdivision seams without boundary geometry remain proof-backed
  depth-continuous visibility islands and spend no mask. Masked topology boundaries are evaluated
  with their source layer's accumulated depth, including two-sided portal-mode CellStruct shells.
- Tested and removed an unnecessary source-label-gating experiment. WebGL stencil comparison and
  `REPLACE` share one reference value, but no source-label comparison is required when the depth
  buffer retains the source scene. No failed API, terminology, clipped-window GPU contract, or
  compatibility shim remains.
- Retracted the proposed clipped execution-window resteer. CPU portal windows remain visibility
  planning evidence; the GPU continues to consume effective aperture geometry, accumulated scene
  depth, direct render-layer stencil replacement, and one contribution draw per unique node.

## Plan Maintenance

### 2026-07-27 — Phase 1 Complete

#### Landed Shape

- Replaced `ActiveRegionObjectDetailOwner` with one `ActiveRegionStaticDetailOwner` that prepares
  building and environment bindings as an all-or-nothing active-region payload.
- Added typed `StaticDetailRole` selection from static render domain:
  - buildings → building;
  - CellStruct shells → environment;
  - explicit/generated objects and EnvCell residents → no detail.
- Moved detail-role selection into `ObjectMaterialPlan`. The raw `0x20000` surface flag remains on
  the source material as provenance, while `detailRole` becomes the renderer contract and part of
  stable material-binding identity.
- Published both prepared role textures under one active-region device owner. Replacement
  stages the new role set before releasing the previous owner; per-landblock atlases never retain
  regional detail textures.
- Replaced renderer inspection of raw flags plus the global building binding with one role-indexed
  lookup. A material with a selected but missing role now fails loudly instead of silently losing
  its overlay.
- Updated Explorer and the browser harness to install the complete role set.

#### Verification

- `npm run test:ts`: 51 files and 252 tests passed.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and `npm run format:check`: passed.
- `npm run build`: production Vite build passed.
- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`: 21 tests passed.
- `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D warnings`:
  passed.
- `npm run harness:browser -- --building-radius 0 --explicit-object-radius 0
--generated-object-radius 0 --settle-ms 1000`: passed with no browser errors; rendered terrain
  plus building, explicit-object, and generated-object layers, submitting 111 static draws and
  12,180 triangles.

#### Decisions, Concessions, and Debt

- Kept one generic object shader. The shader already accepted a detail texture and tiling; only
  material planning and binding selection needed correction.
- Environment-role selection and binding are covered by planner/renderer contract tests. Visual
  CellStruct environment-detail verification remains scheduled for Phase 6 because Phase 1 has no
  CellStruct draw source yet.
- Removed the stale `x-holtburger-landblock-source-batch-lod` browser-harness diagnostic uncovered
  during verification. The current cumulative HBLB request has an exact layer set and no selected
  maximum-LoD value; the dev host exposed but never emitted that obsolete header.
- No compatibility alias for the building-only owner or runtime methods remains.

### 2026-07-27 — Phase 2 Complete

#### Landed Shape

- Split the former GfxObj-only emitter into a public app-host polygon mechanic plus specialized
  GfxObj and CellStruct adapters. The generic mechanic owns validated vertices, normals, UVs,
  sides, stippling, wrap modes, triangle emission, and bounds; each adapter owns selection and
  surface-slot meaning.
- Added CellStruct projection for every render polygon, direct zero-based EnvCell surface
  validation, material-free portal apertures, and normalized positive-child containment planes.
  Negative surface indices omit that shell side without erasing the same polygon's aperture role.
- Added renderer-coordinate portal projection with retail-equivalent averaged polygon planes,
  authored winding, accepted-side decoding, arbitrary polygon fan triangles, transforms, planes,
  and bounds. Portal resources contain no material or visible range.
- Added GfxObj drawing-BSP portal extraction keyed by building portal index. A portal may contain
  multiple coplanar authored polygons; those pieces retain every polygon ID and merge into one
  multipart aperture.
- Added a pure indoor-seam classifier. It emits depth continuity only for proven reciprocal
  `ExactMatch` links with equivalent transformed apertures, opposed accepted halfspaces, and
  conservatively separated cell AABBs; every missing proof retains a typed topology-boundary
  reason.
- Added `inspect_interior_projection` as the noninteractive archive-backed projection harness and
  kept the projection modules as a public host-library seam for Phase 3.
- Propagated exact rejected-degenerate-triangle provenance through the existing outdoor-static
  manifest and `ResolvedGeometry` instead of silently dropping it.

#### Verification

- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`: 40 app-library tests plus
  binary and documentation targets passed.
- `cargo test -p holtburger-dat`: 74 unit tests, the retail-DAT parity test, and the resource-provider
  fixture passed.
- `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D
warnings`: passed.
- `npm run test:ts`: 51 files and 252 tests passed.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run format:check`, and
  `npm run build`: passed.
- `cargo run --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --bin
inspect_interior_projection -- dats/assets.hba` projected:
  - the reciprocal/rotated, six-vertex, portal-dense, resident-heavy, and 62-plane containment
    fixtures;
  - the actual `0x00010100/0 → 0x00010103/0` reciprocal as depth-continuous;
  - 910 building aperture polygon pieces from 217 GfxObjs into 904 logical apertures.
- `npm run harness:browser -- --building-radius 0 --explicit-object-radius 0
--generated-object-radius 0 --settle-ms 1000`: passed with no browser errors and retained the
  Phase 1 baseline of 111 static draws and 12,180 triangles.

#### Decisions, Concessions, and Debt

- Corrected `PortalPoly` disk order from the inherited ACE-shaped names to retail's proven
  `(polygon_id, portal_index)` order. Archive values corroborated the correction: the first word
  reaches polygon 270 while the second reaches portal index 45.
- Added cull mode `0` as a positive-side render mode. Retail calls it `Landblock`; canonical
  CellStruct polygons use it even though ACE's comment says it is not authored in DATs.
- Kept EnvCell directed-portal identity separate from the CellStruct's unique portal-polygon list.
  `0x00020104` has four directed portals but only two CellStruct aperture polygons, so Phase 3 must
  resolve crossings by polygon ID rather than equating the two vector indices.
- Split the retail query/side epsilon (`0.0002`) from source planarity tolerance (`0.0005`).
  Across all 910 building aperture pieces, maximum averaged-plane deviation was `0.00039577484`;
  only six exceeded `0.0002`, and none exceeded `0.001`.
- Preserved one canonical multipart exception instead of taking its first polygon:
  GfxObj `0x0100228C` portal `0` contains seven coplanar aperture pieces.
- Canonical GfxObj `0x01001A6A` contains an exact zero-area render fan triangle. Rejecting its whole
  asset regressed the browser fixture, so textured geometry now omits exact zero-area triangles
  while retaining polygon, side, and fan-triangle provenance. Aperture degeneracy remains fatal.
- A broader optional GfxObj shell scan found GfxObj `0x010016D3` polygon `39` references a missing
  negative-side UV. This predates EnvCell integration and the strict builder now fails it loudly.
  It remains content-coverage debt for a future fixture that actually requests that model; Phase 2
  does not invent a replacement UV or silently discard the malformed side.

### 2026-07-27 — Phase 3 Complete

#### Landed Shape

- Admitted `EnvCells` to the existing cumulative HBLB request and record directory. The shared
  shallow landblock is still acquired once, while `LandblockInteriorSystem` is requested only when
  that exact layer is present.
- Added the independently versioned `HBEC` record rather than extending `HBSO`. Its typed binary
  sections contain cell facts and placements, finite landblock-space bounds, CellStruct shell and
  resident-object geometry, cell-selected surfaces, compact containment planes, PVS references,
  aperture triangles, and resident ranges. JSON retains identities, authored planes/bounds,
  directed topology, spatial proof results, object definitions/material recipes, and diagnostics.
- Reused the proven static polygon-buffer and object presentation/material closure mechanics
  underneath both record serializers without sharing their envelopes or pretending CellStruct
  surface slots have GfxObj semantics.
- Replaced the provisional frontend `unknown` BSP and incomplete portal-graph contracts with typed
  containment planes, cell-local resident sources, arbitrary planar apertures, directed crossings,
  accepted sides, reciprocal links, and proof-backed spatial relationships.
- Added strict binary validation for header/manifest versions, exact section inventories, alignment,
  range non-overlap and coverage, finite floating-point data, cell/structure/material indices,
  aperture indices, unique identities, exterior invariants, and reciprocal crossing symmetry.
- Made HBLB range-check and skip unknown future record identities while continuing to reject any
  unexpected known layer. Unknown payload bytes never enter a nested decoder.

#### Verification

- `cargo test -p holtburger-3d --all-targets`: 42 app-library tests plus binary targets passed.
- `cargo clippy -p holtburger-3d --all-targets -- -D warnings` and `cargo fmt --all -- --check`:
  passed.
- `npm run test:ts`: 52 files and 257 tests passed, including the committed synthetic HBEC fixture,
  invalid structure index, overlapping section, absent record, and unknown HBLB member cases.
- `npm run check`, `npm run lint`, and `npm run build`: passed.
- A live EnvCell-only request for canonical landblock `0x0001ffff` produced and decoded a
  1,619,526-byte HBLB in 454 ms. It contained 463 cells, 48 shared CellStructs, 1,095 apertures,
  1,096 directed crossings, 135 residents, 31 materials, 27 object definitions, and 290 compact
  containment planes. The seam classifier emitted 616 depth-continuous crossings and retained 480
  topology boundaries.

#### Decisions, Concessions, and Debt

- CellStruct shells must have finite bounds. HBEC fails source assembly when one does not; it does
  not encode `NaN` sentinels that would weaken containment and culling contracts.
- A reused `(Environment, CellStruct)` must have the same surface-slot cardinality in every cell.
  Per-cell material identities remain separate, but a structural slot-count disagreement is a
  source error.
- EnvCell residents with a source DID outside the supported GfxObj/setup-model families now fail
  closure assembly. Carrying a nullable definition would make the supposedly closed record
  impossible to materialize and silently discard authored residents.
- Kept seam classification over typed in-memory apertures. An early draft reconstructed geometry
  from its JSON diagnostic manifest and needed wide helper signatures; that shape was deleted
  before landing.
- Phase 3 intentionally stops at the source-batch boundary. The commit pipeline still rejects
  EnvCells until Phase 4 can return a closed environment-plus-residents commit rather than admit a
  record that runtime realization cannot yet own.

### 2026-07-27 — Phase 4 Sequencing Audit — Paused for Resteering

- The current `StandardCommitPipeline` intentionally returns source-only outdoor-static commits.
  Runtime then owns worker dispatch, revision-scoped resource namespaces, atlas preparation,
  currentness checks, stale-result withdrawal, and failure-atomic publication through
  `StaticLayerRealizer`.
- The pre-existing `EnvCellLayerCommit` instead contains an already materialized synchronous
  artifact. Following Phase 4 literally would either run geometry work in the source commit
  pipeline or inject runtime worker/atlas concerns into it, reversing the established ownership
  direction.
- Recommended course correction: Phase 4 should produce a closed, EnvCell-scope-partitioned
  materialization plan and worker jobs from `ResolvedEnvCellLayerSource`. Phase 5 should generalize
  the runtime realizer, execute those jobs with revision/atlas ownership, and publish the resulting
  environment-plus-residents artifact atomically.
- Implementation is paused before changing the commit contract because this moves the
  plan/artifact boundary between Phases 4 and 5. No partial EnvCell commit path has been admitted.

### 2026-07-27 — Phase 4/5 Sequencing Resteer Approved

- Approved the recommended boundary correction: Phase 4 produces the complete,
  EnvCell-scope-partitioned source plan and closed worker jobs; Phase 5 owns revisioned execution,
  atlas readiness, resource staging, and atomic publication through the runtime realizer.
- The old synchronous `EnvCellLayerCommit` shape is not a compatibility contract. It will be
  replaced cleanly rather than populated beside a second source-plan path.

### 2026-07-27 — Phase 4 Complete

#### Landed Shape

- Added one closed `EnvCellMaterializationPlan` containing per-cell shell selections, complete
  material/texture bindings, containment and topology facts, aperture geometry, scoped resident
  jobs, and default-animation deferrals.
- Extracted the existing static material binding primitive and generalized the static-object worker
  source contract without adding portal fields to generic object types.
- Composed cell and resident transforms into landblock-space placements before worker dispatch.
  Every resident job carries exactly one EnvCell scope.
- Reused globally semantic `static-source-geometry` keys for eligible EnvCell resident geometry.
  Per-cell instance streams remain revision- and partition-owned; the runtime merge deduplicates
  only byte-identical shared geometry and rejects divergent buffers under one key.

#### Verification

- Synthetic overlapping-cell fixtures retained two scoped resident submissions while sharing one
  shell geometry and one immutable resident geometry source.
- Non-identity cell rotation/translation plus resident translation produced the expected
  landblock-space positions.
- Missing shell materials fail the closed plan, and default-animated residents remain on the
  existing explicit deferral seam.

#### Decisions, Concessions, and Debt

- EnvCell residents use the existing instanced static strategy so immutable GfxObj partitions can
  be shared across scope-owned streams. Baked fallback remains installation-scoped because its
  transformed vertices are not reusable.
- Worker dispatch protects the complete shared EnvCell presentation buffers from transfer
  detachment. Scoped jobs therefore structured-clone those inputs today. A future worker-pool
  transport can replace those copies, but it must preserve the closed per-scope job boundary.

### 2026-07-27 — Phase 5 Complete

#### Landed Shape

- Generalized `StaticLayerRealizer` and the runtime geometry adapter for EnvCell jobs while
  preserving the existing outdoor-static path.
- Added one revision-owned EnvCell realization containing shell/aperture geometry, scoped resident
  artifacts, atlas readiness, scene scopes, topology, visibility-island membership, and atomic
  publication across `EnvCellSystem` and `StaticObjectSystem`.
- Added separate `env-cell-shell` and `env-cell-static-residents` culling groups. Identical group
  names remain independent because SceneGraph indexes them under each exact scope.
- Replaced global traversal scans with source-scope outgoing adjacency. Visibility-island IDs union
  only host-proven `indoor-depth-continuous` seams; exterior and topology-boundary crossings remain
  separate.
- Retained authored aperture planes, accepted sides, exact-match flags, reciprocal identities, and
  spatial relationships in SceneGraph. Camera-facing checks now consume the authored plane rather
  than reconstructing one from an arbitrary first triangle.

#### Verification

- Added transaction tests for failed replacement restoration, later-publication rollback, and
  cross-owner identity collision.
- Added SceneGraph coverage for independent same-name EnvCell groups, residents protruding beyond
  shell bounds, flat scope enumeration, and zero flat-mode crossings.
- Hardened the shared realizer after finding that atlas activation failure could leave an already
  published revision installed. It now removes the exact published revision before reporting the
  failure.

#### Decisions, Concessions, and Debt

- `EnvCellSystem` owns shell/aperture resources and topology; `StaticObjectSystem` owns resident
  geometry/streams. The realizer is the single transaction coordinator and rolls the first system
  back if the second cannot publish.
- Compact containment planes and structure transforms now survive scene publication, but Phase 7
  still owns replacing bounds-first Explorer point residency with the retail-equivalent
  containment test.

### 2026-07-27 — Phase 6 Complete — Visual Inspection Gate

#### Landed Shape

- Added `EnvCellRenderMode` to frame state with `flat` as the default. Explorer exposes the
  selector; the future portal option is visibly disabled and the renderer rejects programmatic
  portal selection rather than presenting topology traversal as finished portal rendering.
- Flat SceneGraph selection includes outdoor plus every resident EnvCell scope, applies existing
  per-scope aggregate and exact-node frustum tests, and performs no topology traversal.
- Cell shells now submit through the established object material programs with environment detail,
  blend ordering, texture atlases, and a renderer-local back-face cull override. Residents retain
  their authored material culling and object/environment detail selection.
- Added cold frame diagnostics for mode, scopes, shell/resident nodes and submissions, triangles,
  shell cull overrides, and the explicitly zero portal-mask/domain-target/composite work.
- Extended the noninteractive browser harness with `--env-cell-radius` so canonical
  interiors can be exercised without the TUI or manual Explorer input.

#### Verification

- `npm run test:ts`: 54 files and 268 tests passed.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and `npm run build`: passed.
- Canonical browser run:
  `npm run harness:browser -- --landblock 0001 --building-radius 0 --env-cell-radius 0
--explicit-object-radius 0 --generated-object-radius 0 --camera-pitch -90 --settle-ms 15000`
  completed without browser, console, WebGL, stale-resource, or ownership errors.
- The canonical frame reconciled 463 scopes/shells, 74 resident nodes, 1,710 shell draws / 5,652
  shell triangles, and 238 resident draws / 23,425 resident triangles. It performed zero visible
  portal crossings, aperture draws, scene-domain targets, or composites.
- The realized source accounted for all 135 residents, 1,095 apertures, and 1,096 crossings. It
  retained 48 shared CellStruct geometries and emitted 1,243 total geometry resources after
  shell/aperture/resident deduplication.
- A clear-and-reload browser lifecycle returned the same scene/draw counts, released the first
  three atlas pages (41,943,040 bytes), installed three replacement pages, and produced no browser
  errors.

#### Decisions, Concessions, and Debt

- The remaining unchecked mode-switch item is intentionally deferred until Phase 11 provides a
  second valid renderer mode. The Explorer shows `Portal (planned)` disabled; no fake maskless
  “portal mode” is available for users to mistake as correct.
- The fixed bird's-eye harness camera places the dungeon below and offset from the outdoor tile, so
  the captured overview is diagnostically useful but not presentation-quality. The requested gate
  remains a human Explorer inspection before Phase 7.

### 2026-07-27 — Phase 6 Radius-Two Follow-up

#### Corrected Defects

- EnvCell portal aperture and crossing IDs were record-local but were published into the
  scene-global identity namespace. Radius-two realization therefore made unrelated landblocks
  contend for identities such as `portal-crossing:0`. Materialization now qualifies every aperture,
  crossing, reciprocal crossing, and portal geometry identity with its owning landblock while the
  SceneGraph collision guard remains strict.
- Landblocks without interiors can carry a present-but-empty `LandblockInteriorSystemAsset`.
  The HBEC source now serializes those as valid absent records instead of emitting a present record
  that the decoder correctly rejects for containing no cells.
- Setup model `0x0200049A` uses part 8 as its hierarchy root and encodes that root as
  `parent_index[8] == 8`. The host previously projected only `0xFFFFFFFF` as a DAT root sentinel,
  so the frontend correctly rejected the serialized self-edge as a cycle. Setup serialization now
  projects both observed root conventions to `null`.

#### Verification

- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`: 43 library tests and all
  binary/doc targets passed.
- `npm run test:ts`: 55 files and 269 tests passed.
- `npm run check` and `npm run lint`: passed, including clippy with warnings denied.
- Exact browser reproduction:
  `npm run harness:browser -- --landblock da55 --building-radius 2 --env-cell-radius 2
--explicit-object-radius 0 --generated-object-radius 0 --camera-pitch -90 --settle-ms 25000`
  completed with no application console errors. All 25 requested terrain/building/EnvCell source
  batches arrived; the anchor batch also carried its radius-zero object/generated layers.
- The accepted flat frame selected 323 EnvCell scopes/shells and 104 resident nodes, submitting
  1,566 shell draws / 7,046 shell triangles and 1,643 resident draws / 24,167 resident triangles.
  It performed zero aperture-mask draws, scene-domain targets, portal composites, or visible portal
  traversals, as required by flat mode.

#### Decisions, Concessions, and Debt

- The identity correction is intentionally made at the HBEC-to-scene boundary. Weakening
  SceneGraph's global ownership invariant would hide future cross-layer aliasing instead of fixing
  source-local names.
- Retail `CPartArray::UpdateParts` combines each current animation frame directly with the owning
  object frame and does not traverse `parent_index`. The accumulated setup-part hierarchy was
  retained here to avoid an unrelated transform-model cutover.
  Closed on 2026-07-30 by Phase 1 of the object attachment parity plan: setup parts are now composed
  flat against the object frame, and `parent_index` is not serialized past the DAT decoder.

### 2026-07-27 — Phase 6 EnvCell Resident Placement Correction

#### Ground Truth and Root Cause

- Retail `CEnvCell::init_static_objects` passes each authored `static_object_frame` directly to
  `CPhysicsObj::add_obj_to_cell`. That function assigns the frame directly to
  `m_position.frame`; it does not compose the EnvCell structure placement.
- Retail `CEnvCell::point_in_cell` separately transforms a landblock-space query point through the
  EnvCell frame before calling `CCellStruct::point_in_cell`. This proves the EnvCell placement
  positions structure-local shell/containment data, while resident `Stab` frames already occupy the
  surrounding landblock coordinate space.
- The frontend incorrectly named each resident matrix `cellLocalTransform` and materialization
  computed `structureToLandblock * cellLocalTransform`. Static preparation then correctly baked
  that already-wrong result, producing the observed airborne residents. Scene publication was not
  double-parenting: shell and resident render nodes were independent landblock-space roots.

#### Corrected Shape

- `LandblockIndoorObject::placement` is documented as authored landblock-local placement.
- `ResolvedEnvCellResidentSource` now carries one complete `ScenePlacement`, coupling its
  landblock-space transform with owning landblock and EnvCell identities.
- HBEC decoding constructs that composite placement directly. The materialization layer preserves
  it without importing or invoking matrix multiplication.
- Closed-plan validation rejects any resident placement whose landblock or EnvCell identity differs
  from its containing source cell.
- Replaced the test that asserted cell/resident composition with coverage proving two independently
  placed CellStruct shells retain the same authored resident position. Added explicit
  cross-EnvCell residency rejection.

#### Verification

- `npm run test:ts`: 55 files and 270 tests passed.
- `npm run check` and `npm run lint`: passed, including ESLint, Knip, and app clippy with warnings
  denied.
- `cargo test -p holtburger-content`: 36 tests and documentation targets passed.
- The exact radius-two `da55` browser reproduction completed with no application console errors.
  Its ground-facing frustum submitted 19 EnvCell shells and six resident nodes, including 144
  resident draws / 4,196 resident triangles.
- A radius-zero steeper-angle `da55` capture accounted for all 488 authored residents, materialized
  all 488, and published 81 visible resident nodes with 1,242 draws / 16,273 triangles. Flat mode
  continued to perform zero aperture-mask, scene-domain-target, portal-composite, or traversal work.

#### Decisions, Concessions, and Debt

- This correction supersedes the Phase 3/4 historical statements describing cell-local resident
  sources and cell/resident transform composition. Those entries remain as implementation history;
  the current terminology, phase contract, and this correction record the proven semantics.
- EnvCell identity remains scope/residency metadata rather than SceneGraph transform parenting,
  preserving the agreed landblock-space scene model.
- Setup-part `parent_index` transform semantics were an independent open parity question at the
  time. This correction removed the erroneous whole-resident displacement without changing
  multipart presentation behavior. The parity question is closed on 2026-07-30: parts compose flat
  against the object frame.

### 2026-07-27 — Phase 7 Complete

#### Landed Shape

- Replaced first-match `queryWorldPointResidency` with a candidate query that returns the explicit
  point-derived outdoor landblock plus every resident EnvCell whose landblock-space AABB contains
  the point. EnvCell candidates are tested in their own landblock frames, including spatial
  overlap from a different outdoor landblock, and sorted only for stable diagnostics.
- Added the pure retail containment primitive over the projected positive-child plane chain. It
  inverse-transforms the landblock-render point through the rigid EnvCell frame, converts renderer
  axes back to CellStruct-local AC axes, and applies retail's `0.0002` negative-side tolerance.
  Non-rigid or non-finite structure transforms fail loudly.
- Added typed Explorer resolution for exact-DID, unique containment, explicit outdoor fallback,
  ambiguity, outside-world, and topology-unavailable results. Multiple contained cells retain
  every identity and never select by candidate order.
- Enabled exact EnvCell Explorer focus. It waits for atomically complete landblock topology,
  validates the selected cell's world-space shell-bounds center through exact containment, and
  applies the pose only after that proof. Disabled/missing topology and invalid exact DIDs now
  produce distinct diagnostics.
- Layer-qualified scene availability failures and split missing content from load/realization
  failures. An unrelated terrain failure can no longer cancel an EnvCell focus, and complete
  EnvCell topology publishes one landblock event rather than one misleading per-cell event.
- Explorer free-fly containment keeps the last resolved residency when a later point is ambiguous
  or outside, allowing pose updates without inventing a new cell. Phase 8 still owns replacing
  point-derived motion residency with authoritative-anchor portal history.
- Extended `inspect_interior_projection` to verify that each selected CellStruct shell-bounds
  center is contained before that point is relied on for exact-DID placement.

#### Verification

- `npm run test:ts`: 58 files and 286 tests passed.
- `npm run check`, `npm run lint`, `npm run build`, and `npm run format:check`: passed, including
  ESLint, Knip, app clippy with warnings denied, and the production Vite build.
- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets`: 43 library
  tests plus binary/documentation targets passed.
- `cargo fmt --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all -- --check`: passed.
- `inspect_interior_projection dats/assets.hba` confirmed bounds-center containment for all five
  selected fixtures, including the rotated/reciprocal, 27-aperture, and 62-plane cells.
- Canonical browser smoke:
  `npm run harness:browser -- --landblock da55 --building-radius 0 --env-cell-radius 0
--explicit-object-radius 0 --generated-object-radius 0 --camera-pitch -45 --settle-ms 15000`
  completed with no application/browser errors. It realized 236 cells, 488 residents, 528
  apertures/crossings, and retained zero portal draws, domain targets, composites, or traversals in
  flat mode.

#### Decisions, Concessions, and Debt

- Broad-phase discovery scans resident EnvCell scopes rather than filtering by the point-derived
  outdoor landblock. The outdoor landblock remains a separate fallback candidate, not indoor
  ownership evidence.
- Exact-DID placement uses the transformed shell-bounds center only after exact BSP containment.
  The selected archive diagnostics prove that seed for the committed fixture set; a future cell
  whose center fails remains a loud `outside` result rather than invoking an unproven feasibility
  solver.
- The noninteractive browser harness validates the complete da55 source/runtime/render path but
  does not drive the Tauri Explorer form. Coordinator integration tests cover exact, delayed,
  invalid, unavailable, and ambiguous flows; human Explorer UX inspection remains useful but is
  not represented as automated evidence.
- `hasEnvCellTopology` means at least one EnvCell scope from the landblock is resident. A
  source-absent landblock remains lifecycle-unavailable through the typed availability event rather
  than being represented as an installed empty topology.

### 2026-07-27 — Phase 8 Sequencing Audit — Paused for Resteering

- The topology/query side is ready for Phase 8. `SceneGraph` owns source-keyed outgoing adjacency;
  each crossing retains arbitrary triangulated aperture geometry, an authored landblock-space
  plane and accepted side, reciprocal identity, target scope, and exterior-landblock claim.
- The planned client integration target does not exist yet. `ClientApp.svelte` renders only the
  static `RouteShell`; it does not construct `GameRuntime`, ingest an authoritative player/actor
  placement, own a third-person camera, or coordinate desired camera endpoints. The frontend has
  no authoritative actor-state boundary to extend.
- Implementing “third-person camera coordination” literally at this point would require either a
  self-contained controller with no production caller or an unplanned first implementation of the
  real client runtime/player bridge. The former is a hollow abstraction; the latter materially
  expands Phase 8 and needs explicit sequencing approval.
- Recommended course correction: split Phase 8 into:
  1. pure directed aperture math, repeated segment tracing, crossing diagnostics, and a runtime
     query whose input is a typed authoritative anchor supplied by its caller;
  2. later client wiring when a real authoritative actor placement feed and third-person camera
     owner exist.
- Explorer bootstrap remains on the accepted Phase 7 containment path. Do not use Explorer's
  free-fly camera or last-residency cache as a counterfeit authoritative player feed.
- Implementation is paused before adding Phase 8 code. Approval is required to adopt the split or
  to expand this phase into the initial client runtime/player/camera integration.

### 2026-07-27 — Phase 8 Sequencing Resteer Approved

- Approved the runtime-primitive interpretation: implement the authoritative-anchor portal trace
  query required by a future third-person client, without implementing the client, player feed, or
  camera controller.
- The Phase 8 deliverables and acceptance text now state that boundary explicitly. The earlier
  sequencing-audit entry remains as evidence of why the wording changed.

### 2026-07-27 — Phase 8 Complete

#### Landed Shape

- Added allocation-light pure planar-aperture primitives for signed distance, typed
  segment/plane intersection, and point containment against arbitrary triangulated planar
  apertures. One shared `0.0002` portal-query epsilon governs plane slabs, aperture edges, and
  post-crossing progress.
- Added directed finite-aperture selection that rejects wrong-facing travel, endpoint-only plane
  touches, coplanar travel, and polygon misses before choosing the smallest forward segment
  parameter. True epsilon ties are retained in stable identity order rather than hidden behind
  source insertion order.
- Added a stateless repeated trace over caller-supplied authoritative anchor position/residency and
  a desired endpoint. Each step considers only the current scope's outgoing adjacency, advances
  along the original segment, guards immediate reciprocal re-entry, and is bounded by the
  resident crossing count.
- Exposed the primitive through `SceneGraph.tracePortalSegment` and
  `GameRuntime.tracePortalSegment`. No player feed, camera owner, third-person controller, or
  production client wiring was created.
- Added typed topology-unavailable results for missing origin/target scopes, ambiguous boundaries,
  crossing exhaustion, out-of-world endpoints, and unclaimed exterior endpoints. In every
  incomplete case the safe fallback remains the caller's authoritative anchor residency; the last
  topology-proven scope is diagnostic only.
- Synthesized an outdoor-side finite blocker only for one-way exterior apertures without a claimed
  reciprocal. This lets authored indoor-to-outdoor travel complete while preventing an outdoor
  endpoint from entering interior space through a transition the source topology did not claim.
- Extended the noninteractive browser harness with a production runtime-query hook. The hook
  accepts explicit authoritative state and endpoint coordinates; it does not move or derive the
  camera.

#### Verification

- `npm run test:ts`: 61 files and 305 tests passed. The 19 focused aperture/trace tests cover
  arbitrary triangulations, rotated non-axis-aligned planes, epsilon edges, misses, wrong-facing
  travel, touches, coplanar segments, earliest crossings, deterministic ties, multi-crossing
  traces, overlapping unconnected cells, cycles, topology loss, and claimed/unclaimed exterior
  transitions.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run build`, and
  `npm run format:check`: passed.
- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets`: 43 library
  tests plus binary targets passed.
- `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D
warnings` and `cargo fmt --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all --
--check`: passed.
- `inspect_interior_projection dats/assets.hba` selected the reciprocal
  `0x00010100/0 -> 0x00010103/0` seam and reported its landblock-space center, normalized plane,
  and accepted sides.
- Production browser traces loaded all 463 cells, 1,095 apertures, and 1,096 directed crossings in
  landblock `0x0001ffff`. The forward segment `(40,-87.5,-68) -> (40,-87.5,-66)` crossed at
  `(40,-87.5,-67)`, `t=0.5`, and resolved `0x00010100 -> 0x00010103`; the reciprocal segment
  resolved `0x00010103 -> 0x00010100`. Both runs completed without application, browser, WebGL,
  stale-resource, or ownership errors.

#### Decisions, Concessions, and Debt

- Equal-parameter crossings to different targets are explicitly ambiguous. Equal-parameter
  aliases to the same target use stable crossing identity for history because the resulting
  residency is identical; they remain visible to the lower-level directed query.
- The structural crossing bound is conservative rather than a gameplay tuning knob. Exhausting it
  is a typed topology failure and preserves authoritative residency.
- Collision response and renderer near-plane straddling remain separate concerns by design.
  Camera-eye residency has one topology-derived result; Phase 9+ may render both sides when the
  finite near plane intersects an aperture.
- The browser hook is diagnostic evidence plumbing, not a nascent client implementation. A future
  client coordinator must provide the authoritative actor anchor and decide how to respond to
  topology-unavailable results.

### 2026-07-27 — Resteering Gate C Complete

#### Topology and Query Evidence

- Extended the archive census with a per-landblock Cell count. The full archive contains 542,369
  EnvCells and 1,380,760 directed portals; the largest resident topology is landblock
  `0x00D1FFFF` with 4,213 EnvCells. This rules out using total Cell count as an 8-bit stencil-depth
  value.
- Added consumed runtime diagnostics for visibility-island count, each spatial-relationship class,
  and authored potentially-visible references. Counts reconcile exactly:
  - `0x0001FFFF`: 463 Cells, 1,096 crossings = 616 depth-continuous + 480 indoor
    topology-boundary + 0 exterior; 202 visibility islands and 35,649 potentially-visible
    references.
  - `0xEC0EFFFF`: 30 Cells, 394 crossings = 126 depth-continuous + 0 indoor
    topology-boundary + 268 exterior; 16 visibility islands and 114 potentially-visible
    references. Cell `0xEC0E010B` retains its selected 27 arbitrary apertures.
  - `0x00D1FFFF`: 4,213 Cells, 9,798 crossings = 7,762 depth-continuous + 2,036 indoor
    topology-boundary + 0 exterior; 598 visibility islands and 436,912 potentially-visible
    references.
- The potentially-visible sets remain retained candidate/preload provenance and are not consumed
  as camera-trace or renderer-traversal rejection. There is not yet a preload policy to measure;
  inventing one at this gate would exceed the runtime-query and renderer scope.
- Production forward and reciprocal camera traces through the selected `0x00010100 /
0x00010103` seam each crossed once at the same finite aperture point and resolved the authored
  target. Focused fixtures also cover arbitrary rotated planes, wrong-facing rejection, epsilon
  boundaries, cycles, topology loss, and spatially overlapping but unconnected cells without
  oscillation or guard exhaustion.

#### Browser Target Evidence

- Added an executable, state-restoring WebGL2 capability probe on the actual renderer device. It
  allocates a temporary `RGBA8` color texture and `DEPTH24_STENCIL8` texture, verifies framebuffer
  completeness, clears depth/stencil, samples the depth component into a second framebuffer, reads
  the pixel, and destroys every temporary object before normal renderer construction.
- Headless Chrome/SwiftShader reported 24 depth bits, 8 stencil bits, complete attachments, and
  maximum texture/renderbuffer extents of 8,192. Sampling clear depth `0.25` produced byte `64`,
  proving the color-plus-sampled-depth copy substrate required by Phase 9.
- Corrected the forward contract from ambiguous “sampleable depth/stencil” wording to a
  depth-sampleable `DEPTH24_STENCIL8` attachment. Shaders sample depth; stencil remains available
  to fixed-function tests and operations.

#### Fixture Coverage and Stencil Contract

- Archive-backed coverage is locked for reciprocal/rotated, six-vertex non-quad, portal-dense,
  resident-heavy, deep-containment, non-exact/topology-boundary, and exterior-transition source
  shapes. Synthetic topology already covers overlap/non-Euclidean camera residency.
- Renderer-only hazards are deliberately executable in their owning phases rather than
  counterfeited at this gate: Phase 9 owns finite near-plane edge/coplanar/corner math and mask
  substrate fixtures; Phase 10 owns tunnel, multi-window, and exterior-straddle composition;
  Phase 11 owns nested/non-Euclidean, non-exact reciprocal, and four-cell closure browser
  fixtures.
- Stencil value `0` is reserved for the base scope. Simultaneous path ancestry may use values
  `1..255`; values are reusable after a branch unwinds. Phase 9 must prove depth 255 succeeds and
  the 256th nested boundary fails loudly without wraparound. Phase 11 must report actual
  per-frame maximum ancestry; neither total Cells nor total visibility islands is treated as
  stencil depth.
- The 598-island `00D1` fixture proves that overflow handling cannot be omitted, but does not imply
  a 598-deep render path. The already-accepted loud-overflow policy remains the safe boundary until
  view-dependent path measurements exist.

#### Gate Decision

- Flat rendering, containment, camera tracing, topology accounting, and the selected browser
  attachment contract are independently green. No source or runtime abstraction needs to change
  before Phase 9.
- Gate C passes. Phase 9 may build only the synthetic GPU substrate while production rendering
  remains in accepted flat mode.

### 2026-07-27 — Phase 9 Context-Loss Recovery Gap — Paused for Resteering

- Phase 9 requires scene-domain targets to “recover” from WebGL context loss, but the existing
  device/runtime has no context-restoration architecture. `WebGL2ResourceManager` retains live GPU
  handles, while higher-level geometry and texture managers retain logical-to-resource keys rather
  than the complete CPU upload descriptions needed to rebuild those handles.
- Renderer shader programs, fallback textures, instance streams, terrain resources, atlas pages,
  and static geometry are also construction/publication-time resources. Recreating only portal
  targets after `webglcontextrestored` would leave every other binding stale and would falsely
  claim recovery.
- Explorer currently owns startup and teardown only. It has no device-loss coordinator that pauses
  frames, rebuilds `WebGL2Device`/`GameRuntime`, reacquires current scene interest, restores
  frontend camera/environment/frame settings, and republishes accepted content.
- The completed Phase 9 work retained at this pause is pure finite near-clip-pyramid versus
  arbitrary triangulated-aperture intersection. It covers rotated cameras, actual finite misses,
  apertures contained between the eye and cap, exact boundary contact, and invalid projection
  facts without touching camera residency.
- An unintegrated target/state/copy prototype was removed after the audit. Keeping it would have
  violated the repository's dead-code and consumed-diagnostics rules while the owning lifecycle
  decision remained unresolved.

#### Resteering Options

1. Recommended: narrow Phase 9 to deterministic target resize/disposal and explicit context-loss
   invalidation. A lost device enters a typed fatal/restart-required state; full device recovery is
   deferred to a dedicated renderer-lifecycle plan that can rebuild all resources honestly.
2. Expand this plan before continuing: add end-to-end WebGL device recovery, including retained or
   replayable resource upload descriptions, renderer program reconstruction, runtime frame
   suspension, scene-interest replay, and Explorer state restoration. This is materially larger
   than portal rendering.
3. Define app-level reload/restart as the supported recovery policy. This is smaller than in-place
   restoration but is a user-visible product decision and must not be disguised as target-level
   recovery.

- Implementation is paused before adding renderer-owned portal targets or state machinery. Choose
  the lifecycle contract before Phase 9 continues.

#### Resolution

- Accepted option 1. Phase 9B owns deterministic target resize/disposal and explicit whole-renderer
  invalidation into a typed fatal/restart-required state.
- Full in-place WebGL device recovery is out of scope because restoring portal targets alone would
  leave programs, fallback textures, instance streams, geometry, atlases, terrain resources, and
  runtime publication handles stale.
- The forward plan was dry-run against current `SceneGraph`, `RenderWorld`, `WebGL2Renderer`,
  Explorer, synthetic harness, and legacy scene-domain seams before implementation resumed. The
  resulting phase resequencing is recorded under Course Corrections.

### 2026-07-27 — Phase 9A Complete

#### Landed Shape

- Deleted the flattened `SceneGraph.queryFrustum()` traversal, reusable
  `VisiblePortalCrossing` buffer, `VisibleScene.crossings`, unreachable
  `RenderWorld.queryVisibleScene(..., "portal")` branch, and the corresponding crossing metric/UI.
- Added `SceneGraph.queryScopesFrustum()` as the only explicit-scope spatial contract. It validates
  EnvCell residency, deduplicates selected scope identities, and reuses the same
  scope → landblock → producer group → exact node selection path as flat mode.
- Added a lazy retained `SceneTopologyView` revision containing stable scope, visibility-island,
  PVS-provenance, crossing, and outgoing-adjacency facts. Scope/crossing publication invalidates the
  view; repeated reads without topology mutation return the same object and do not clone the graph
  per frame.
- Split `RenderWorld` into `queryFlatScene()`, `queryScopesScene()`, and
  `getPortalTopologyView()`. The renderer continues to reject portal mode before collection and
  therefore invokes only the honest flat query.
- Relocated finite camera-near-plane versus triangulated-aperture math and its tests from `scene/`
  to `renderer/`; no geometry behavior changed.
- Retained mask/scene-domain/composite zero counters because they are consumed flat-mode
  invariants. Removed only the obsolete count derived from the rejected flattened crossing list.

#### Verification

- Focused scene, render-world, runtime-metric, and renderer-near-plane selection: 4 files and 36
  tests passed.
- Full `npm run test:ts`: 62 files and 310 tests passed.
- `npm run check`: zero Svelte/TypeScript errors and warnings.
- `npm run lint:ts`, `npm run lint:dead`, `npm run format:check`, `npm run build`, and
  `git diff --check`: passed.
- Ordinary da55 flat browser harness: 111 static draws / 12,180 triangles with zero portal masks,
  targets, or composites.
- EnvCell-enabled da55 flat browser harness: 236 source cells, 528 crossings, 55 visibility
  islands, 132 visible EnvCell scopes, 44 visible resident nodes, 690 shell draws / 2,816 shell
  triangles, 665 resident draws / 9,618 resident triangles, and zero portal masks, targets, or
  composites.

#### Decisions, Concessions, and Debt

- Topology views reuse SceneGraph-owned crossing records and aperture buffers under a typed
  read-only contract rather than duplicating large geometry arrays per revision. New records
  replace old records atomically; renderer consumers must not mutate source facts.
- Removed the old breadth traversal tests instead of preserving tests for dead architecture.
  Phase 10 owns new path-aware traversal fixtures; Phase 9A retains spatial-selection and retained
  topology-contract coverage only.
- Knip rejected an eagerly exported `SceneVisibilityIslandId`; the unused export was removed.
  Phase 10 may name only the planner surface it actually consumes.
- The browser harness's `ready` state confirms renderer startup, not requested layer settlement. A
  one-second EnvCell run returned an empty but error-free frame; the five-second run produced the
  evidence above. Future archive-backed gates must wait on expected content/source-batch facts or
  use an explicit measured settlement condition rather than treating `ready` as sufficient.
- No work-plan, stencil, render-domain target, client/controller, or residency behavior was added.
  Phase 9B remains the next implementation step.

### 2026-07-27 — Phase 9B and Resteering Gate D Complete

#### Landed Shape

- Added one renderer-owned `WebGL2PortalSubstrate` whose construction allocates nothing. Its first
  explicit resize transaction creates exactly two scene-domain targets: exterior source and
  composite destination, each with `RGBA8` color and a texture-backed `DEPTH24_STENCIL8`
  attachment.
- Added material-free stencil push/pop draws over existing position-only
  `WebGL2GeometryBinding` resources. Raw stencil ancestry reserves value `0`, accepts child values
  through `255`, rejects a push from `255`, and reuses values after pop.
- Added sampled color/depth scene copy with explicit `always` or `less` depth policy and
  `gl_FragDepth` output. Self-sampling and mismatched target extents fail before drawing.
- Added complete fixed-function baselines for clear, mask push, mask pop, masked copy, presentation,
  and restoration to the ordinary pass. Programs, VAOs, and sampled textures remain owned by their
  consuming pass; ordinary restoration clears those bindings.
- Added transactional resize and deterministic disposal diagnostics. Replacement targets are
  complete before the old pair is released; a failed replacement leaves the old generation owned.
- Added a device-wide lifecycle discriminant. `webglcontextlost` is canceled and moves the device
  to `restart-required`; a later restore event deliberately does not revive stale resource handles.
  Every renderer frame first checks that device state.
- Kept production portal mode rejected. `WebGL2Renderer` owns the lazy substrate for later phases,
  while flat frames allocate no portal target or portal shader.

#### Verification

- `npm run test:ts`: 63 files and 316 tests passed. Focused pass-state/stencil and finite
  near-plane coverage contributed 12 passing tests.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run format:check`,
  `npm run build`, and `git diff --check`: passed.
- The real-browser `portal-substrate` fixture used the production resource manager and substrate
  against Chrome/SwiftShader. A concave six-vertex parent aperture plus independent child and
  sibling apertures produced:
  - nested child `[204, 51, 26, 255]`;
  - sibling `[51, 204, 51, 255]`;
  - outside-parent `[26, 51, 204, 255]`;
  - fully unwound stencil-zero presentation `[204, 204, 26, 255]`.
- A farther green copy with depth comparison `less` could not replace the child's copied red depth,
  proving sampled depth was written through `gl_FragDepth`, not merely accompanied by correct
  color.
- Target diagnostics progressed from 2 allocations / 0 disposals / 1,024 bytes at `8×8`, through
  4 / 2 / 4,096 bytes at `16×16`, to 4 / 4 / 0 active bytes after destruction.
- An isolated actual `webglcontextlost` event was canceled and produced
  `{ kind: "restart-required", reason: "context-lost" }`. Both a device operation and a constructed
  renderer frame were rejected with the restart-required error.
- The concurrent production frame remained `flat` with zero portal-aperture draws, scene-domain
  targets, or composites.

#### Decisions, Concessions, and Debt

- Two targets are sufficient for every Phase 9B operation. A second composite ping-pong target
  remains prohibited until Phase 11 demonstrates unavoidable framebuffer feedback in an executable
  composition case.
- The lifecycle contract is invalidation, not recovery. The isolated loss probe destroys its stale
  renderer and device; app-level reconstruction and scene-interest replay remain dedicated
  renderer-lifecycle work outside this plan.
- The browser fixture is intentionally app-local evidence plumbing. It runs only when selected,
  releases its temporary aperture resources through the shared manager, and does not expose a
  production portal scheduling API.
- Target byte diagnostics count the specified attachment storage (`RGBA8` plus
  `DEPTH24_STENCIL8`). Driver-private padding is neither observable nor claimed.
- Gate D passes. Phase 10 may add only pure renderer-local work planning over the retained topology
  view and explicit selected-scope query; it must not activate GPU portal execution.

### 2026-07-27 — Phase 10 Gate E Path-Growth Blocker — Paused for Resteering

#### Landed Before the Pause

- Added a renderer-local pure planner with a retained index over the current immutable topology
  revision. Per-view work applies the original camera frustum to aperture bounds, rejects
  wrong-facing directed crossings, expands proven visibility islands without merging their scope
  identities, and retains path-local mask ancestry for topology boundaries.
- Added explicit non-exact reciprocal mask intersections, exterior-transition operations,
  topology-bounded active-boundary cycle guards, finite near-plane seed records, `1..255` stencil
  preflight, and a typed work-item ceiling that returns no partial plan.
- Added synthetic coverage for dense depth-continuous collapse, cycles, sibling paths to one scope,
  repeated scopes under distinct ancestry, non-exact reciprocals, exterior transitions, concave
  near-plane contact, wrong-facing/frustum rejection, stencil depth 255/256, and work-limit
  failure.
- Added a direct equivalence test proving flat selection and explicit selection over the same
  complete scope set return the identical `SceneGraph` culling result.
- Added an app-local browser probe by capturing the concrete WebGL renderer during ordinary harness
  construction. Neither `GameRuntime` nor the generic renderer interface gained diagnostic-driven
  portal policy, and flat frames perform no planning.

#### Blocking Evidence

- The first archive-backed Gate E run used landblock `0x0001FFFF`, authoritative root
  `0x00010100`, camera `(40, -87.5, -68)`, yaw `180°`, a `90°` original frustum, and an explicit
  100,000-work-item ceiling.
- The resident topology contained 463 EnvCells, 202 visibility islands, 616 depth-continuous
  crossings, and 480 topology-boundary crossings.
- Planning failed at the ceiling after 50,000 path occurrences and 100,001 work items while maximum
  simultaneous stencil ancestry was only 14. No selected-scope culling result was produced because
  the typed failure exposed no partial plan.
- This is not an 8-bit stencil-capacity problem and increasing the ceiling is not a valid fix. The
  simple-path model grows combinatorially when distinct mask ancestries are preserved across the
  cyclic visibility-island boundary graph.
- The accepted no-child-frustum-clipping policy means ordinary frustum and camera-facing rejection
  do not constrain the graph enough. Global scope deduplication would terminate cheaply but would
  violate the already-accepted overlapping/non-Euclidean and sibling-parent mask correctness
  requirements.
- Per Gate E acceptance, pathological simple-path growth is a hard blocker before Phase 11. The
  `00D1` archive probe and all GPU composition work are intentionally not attempted.

#### Decision Required

- The plan needs a new bounded scheduling invariant that preserves parent-mask provenance without
  enumerating every simple topology path. Plausible directions include proof-backed state
  coalescing, a different stencil-region representation that can union equivalent parent regions
  without cross-parent leakage, or render-time visibility feedback with an independently safe
  preflight contract.
- Child-frustum clipping, authored PVS as a hard rejection, global scope deduplication, and merely
  raising the work ceiling each relax a previously accepted correctness or complexity constraint;
  none should be introduced silently.
- Phase 10 remains incomplete and implementation is paused pending a renderer-strategy decision.

### 2026-07-28 — Phase 10 Exact Portal-Window Plan Resteer

#### Evidence and Dry Run

- Retail `Render::copy_view` appends exact screen polygons and derives clip planes from their edges;
  it does not union overlapping windows. `PView::AddViewToPortals` and `AddToCell` accumulate views
  per destination cell and process newly appended views rather than constructing a recursive
  topology-path tree.
- Current `ScenePortalCrossingInput` already retains source/target scope, accepted side,
  `exactMatch`, reciprocal ID, spatial relationship, landblock-framed aperture vertices/indices,
  plane, and bounds. No scene or wire-format expansion is required for window planning.
- `PlanarAperture` already preserves arbitrary triangulated geometry used by Phase 8 queries and
  Phase 9B near-plane tests. Phase 10B must consume those facts without modifying their
  view-independent contract.
- `Webgl2Renderer.#prepareViewGeometry` already computes anchor-relative camera position, view,
  projection, and frustum. Phase 10B factors a renderer-local prepared-projection input rather than
  duplicating camera math in the planner.
- `PortalDrawUnit` and Phase 9B already own exact GPU aperture geometry. CPU windows select work and
  may supply scissors; they do not require another aperture upload or per-window framebuffer.
- `WebGL2PortalSubstrate` currently uses the complete eight-bit stencil value as an
  increment/decrement mask-stack depth and exposes no spare guard bits. Phase 10D may not smuggle a
  coverage marker into that state; an additional guard requires an explicit compatible protocol or
  separately owned bounded representation.
- The existing two scene-domain targets are fixed renderer-owned exterior/composite resources, and
  the Gate D browser fixture already supplies mask nesting, state restoration, sampled-depth copy,
  and pixel-read infrastructure suitable for Phase 10D extensions.
- The failed implementation is isolated to the two new planner files plus its concrete
  `Webgl2Renderer` import, retained field, and `probePortalViewPlan` harness seam. Phase 10A can
  remove it without touching scene publication, materialization, containment, segment tracing,
  flat selection, or GPU substrate ownership.

#### Revised Sequence

- Phase 10A performs the clean subtraction.
- Phase 10B proves exact renderer-local window geometry independently from topology.
- Phase 10C introduces reference incremental window traversal and records exact same-target
  relationships.
- Gate E1 measures archive growth and overlap before final submission semantics harden.
- Phase 10D establishes bounded window admission, exact submission regions, and complete
  mask/guard-capacity preflight.
- Gate E2 reruns the failed archive case and blocks exterior composition on fragmentation,
  blended-pass correctness, unresolved overlap, or routine safety-ceiling use.

After each completed phase, append:

- date and phase status;
- relevant source/render/resource counts;
- verification commands and fixtures;
- concessions or newly discovered debt;
- decisions and course corrections;
- cleanup targets for the next phase.

Do not silently rewrite completed phase history. Amend the forward plan and record why.

### 2026-07-28 — Phase 10A Complete — Failed Planner Purge and Contract Reset

#### Landed Shape

- Deleted the failed `portal-render-work-plan.ts` path-occurrence planner and its tests instead of
  adapting its ancestry tree, work ceiling, or path-count contracts.
- Removed the retained planner, `probePortalViewPlan`, selected-scope diagnostic result, and
  work-limit handling from `WebGL2Renderer`.
- Removed the terrain-harness `planPortalView` API plus `--plan-anchor-cell`, `--plan-position`, and
  `--plan-work-limit` CLI/output plumbing. A future Phase 10C archive probe must consume the final
  unique-node graph contract rather than resurrecting this seam.
- Replaced live “stencil ancestry” substrate wording with “mask stack.” The stencil-depth constant
  became module-private after Knip proved that only the deleted planner consumed its export.
- Preserved immutable topology reads, source-keyed adjacency, explicit selected-scope queries,
  near-plane geometry, containment, directed segment tracing, flat selection, aperture resources,
  and the Phase 9B GPU substrate.

#### Verification

- `rg` found no live `PortalRenderWorkPlanner`, `PortalWorkOccurrence`, `plannedPathCount`,
  `activeBoundaries`, `probePortalViewPlan`, plan-work-limit, failed-planner module, or stencil
  ancestry references under app source/scripts.
- Focused renderer, SceneGraph, containment, portal-trace, near-plane, substrate, and runtime
  coverage passed: 7 files / 57 tests.
- Full `npm run test:ts` passed: 63 files / 317 tests.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run build`, and
  `npm run format:check` passed.
- Canonical flat browser run:
  `npm run harness:browser -- --landblock da55 --building-radius 0 --env-cell-radius 0
--explicit-object-radius 0 --generated-object-radius 0 --camera-pitch -45 --settle-ms 15000`
  completed without application/browser errors. It selected 132 EnvCell scopes, submitted 690
  shell draws / 2,816 shell triangles and 665 resident draws / 9,618 resident triangles, and
  executed zero aperture draws, scene-domain targets, or portal composites.

#### Decisions, Concessions, and Debt

- Phase 10A intentionally removes the archive planner probe rather than preserving diagnostic API
  compatibility. Phase 10C owns a new probe only if Gate E consumes it.
- No renderer or query abstraction was generalized during subtraction. The replacement begins from
  the already-proven view geometry, topology, and selected-scope seams in Phase 10B/10C.
- Chrome emitted host-environment GPU readback, font-cache, and Google registration warnings; none
  appeared in the page console or changed the accepted harness state.

### 2026-07-28 — Phase 10B Complete — Exact Portal-Window Geometry

#### Landed Shape

- Added the renderer-local, stateless `portal-view-window.ts` primitive. A view window is a
  deterministic collection of independently retained convex NDC fragments; construction removes
  duplicate/collinear vertices with one `0.000001` NDC tolerance and rejects non-finite,
  out-of-range, degenerate, or non-convex input.
- Projects each authored aperture triangle from its landblock frame into the anchor-relative render
  frame, clips it against all six homogeneous WebGL clip planes before perspective division, and
  exactly intersects the surviving convex fragments with the inherited window.
- Sequential aperture intersection is the explicit non-`ExactMatch` reciprocal contract. It cannot
  expose the union of the two authored apertures.
- Preserved concave, multipart, and disjoint aperture structure as source-triangle fragments. The
  implementation deliberately performs no polygon union, hole fill, adjacency bridge, or
  viewport-resolution approximation.
- Added conservative fragment-AABB rejection before exact convex intersection. Empty exact
  geometry remains the authority.
- Added consumed algorithm diagnostics for input/rejected/projected polygons, exact and broad-phase
  fragment pairs, constructed clip/NDC vertices and polygons, empty intersections, and final
  fragment/vertex counts.
- Factored one `PreparedPortalProjection` contract into `PreparedViewGeometry`. The renderer now
  composes `clipFromAnchor` once and reuses it for frustum extraction and future portal projection
  rather than reconstructing camera matrices in the portal primitive.
- Exported the existing `validatePlanarAperture` check for reuse instead of duplicating aperture
  buffer and normalized-plane validation.

#### Verification

- Added 13 focused portal-window tests covering normalization, invalid inherited NDC geometry,
  arbitrary triangles, homogeneous near-plane clipping, behind-eye rejection, viewport clipping,
  edge-on degeneration, concave/multipart holes, sequential reciprocal intersection, landblock
  offsets, conservative broad-phase rejection, non-finite projection input, and 128 deterministic
  comparisons with an independent barycentric/segment triangle-intersection oracle.
- Frustum coverage proves `createFrustumFromClipMatrix(projection × view)` is identical to the
  established projection/view entry point.
- Full `npm run test:ts` passed: 64 files / 330 tests.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run build`, and
  `npm run format:check` passed.
- The canonical da55 flat browser run completed without page-console errors and reproduced the
  Phase 10A counts exactly: 132 visible EnvCell scopes, 690 shell draws / 2,816 triangles, 665
  resident draws / 9,618 triangles, and zero portal aperture draws, scene-domain targets, or
  composites.

#### Decisions, Concessions, and Debt

- Fragment identity quantizes only at the single documented NDC tolerance. Phase 10C may use exact
  normalized fragment identity and containment for fixed-point admission; it may not introduce a
  viewport-dependent coverage grid as authority.
- Per-triangle fragments can be more numerous than a polygon-union representation. Gate E will
  measure that honest source-preserving shape before any scratch-pool or union optimization is
  considered.
- The cost counters describe algorithm-created vertices/polygons rather than claiming visibility
  into engine-private JavaScript heap allocations.
- Chrome again emitted host-environment font/registration warnings outside the page console; the
  accepted flat renderer state was unchanged.

### 2026-07-28 — Phase 10C and Resteering Gate E Complete — Unique-Node Render Graph

#### Landed Shape

- Added the pure retained `PortalRenderGraphPlanner`. It indexes one immutable
  `SceneTopologyView` revision, groups proven depth-continuous EnvCell scopes into unique render
  domains, and performs exact incremental window propagation over source-keyed outgoing
  adjacency.
- Kept node coverage and every `PortalViewWindow` private to fixed-point planning. The returned
  `PortalRenderWorkPlan` contains only unique render nodes, admitted directed mask edges, ordered
  render layers, exterior-transition operations, near-plane seeds, selected scopes, topology
  revision, diagnostics, and complete stencil-capacity preflight.
- Separated edge admission from node re-expansion. Every non-empty directed crossing becomes an
  executable mask edge even when its target window is already covered; only novel target coverage
  enters the worklist. This preserves alternate aperture masks and cycles without duplicating
  contribution nodes.
- Derives deterministic strongly connected components and render layers. Layer zero is the
  established unmasked base node; later layers directly union their incoming mask edges and name
  every unique node to draw once.
- Non-`ExactMatch` reciprocal planning sequentially clips both authored apertures and reserves one
  reusable scratch stencil value in capacity preflight. Work-limit and mask-capacity failures are
  typed and return no partial plan.
- Added a Gate-E-only `WebGL2Renderer.probePortalRenderGraph` seam. It prepares the production
  anchor-relative projection and finite near plane, runs the retained planner, then immediately
  consumes `plan.selectedScopes` through `RenderWorld.queryScopesScene`. The generic renderer and
  runtime interfaces remain unchanged, and production `portal` drawing remains rejected.
- Reintroduced browser CLI evidence only under the final contract:
  `--portal-graph-root-cell`, `--portal-graph-position`, and
  `--portal-graph-work-limit`. Removed the stale help text for the purged path-planner flags.
- Extended the archive projection diagnostic with the selected dense `0x00D10100` render origin,
  transformed shell center, and first authored portal plane so Gate E uses a proved camera/root
  fixture rather than a guessed overlapping-cell point.

#### Verification

- Added 11 focused render-graph tests covering an isolated base, linear layers, disjoint diamond
  routes, alternate incoming masks, cycles, proof-backed depth-continuous islands, wrong-facing
  rejection, finite near-plane dual-side seeding, non-exact reciprocal intersection/capacity,
  typed work and stencil failures, exterior transitions, and one slow exact simple-path oracle.
- The test-only oracle deliberately enumerates tiny simple paths and agrees with the fixed-point
  planner on sibling routes plus a back-edge cycle. No path identity or oracle code enters
  production.
- Former path-growth fixture `0x0001FFFF`, root `0x00010100`: 15 work items, 3 render nodes, 2 mask
  edges, maximum layer/value 2, 2 maximum retained fragments per node, 6 selected scopes / 6
  selected scene entries, and approximately 4.9 ms planning time. The purged planner exceeded
  100,000 work items on this fixture.
- Dense fixture `0x00D1FFFF`, root `0x00D10100`: the resident topology contains 4,213 EnvCells,
  9,798 crossings, and 598 visibility islands; the accepted view completed in 179 work items with
  6 render nodes, 6 mask edges, maximum layer 4 plus one non-exact scratch value, 57 selected
  scopes, 117 maximum retained source-triangle fragments on one node, and approximately 18.3 ms
  planning time.
- Exterior fixture `0xEC0EFFFF`, root `0xEC0E010B`: 648 work items, 8 render nodes, 47 admitted
  directed exterior-transition masks, one cyclic component spanning exterior re-entry, maximum
  layer/value 2, 11 maximum retained fragments per node, 14 selected scene entries, and
  approximately 13.7 ms planning time.
- All three archive probes completed below the explicit 100,000-item corruption guard, consumed
  the production selected-scope culling query, left flat-frame portal draw/target/composite counts
  at zero, and produced no page-console errors.
- Full `npm run test:ts` passed: 65 files / 342 tests.
- `npm run check`, `npm run lint` including Clippy `-D warnings`, `npm run build`, and
  `npm run format:check` passed.

#### Decisions, Concessions, and Debt

- A visible crossing is executable graph structure even when it adds no new target coverage.
  Coverage admission controls only re-expansion. Conflating those decisions would erase valid
  alternate masks and make SCC/layer logic ceremonially acyclic.
- `PortalRenderLayer` replaces the discarded cohort abstraction. Only the complete work plan is
  exported today; Knip rejected premature exports for constituent executor types that Phase 11 has
  not yet consumed.
- Planner duration is measured by the Gate-E probe rather than embedded in the deterministic pure
  plan. Algorithmic counts stay inside the plan diagnostics; wall-clock policy remains with the
  caller that consumes it.
- The dense view's 117 retained triangle fragments are the first concrete optimization candidate.
  They are bounded, complete far below the work guard, and are not allowed to justify an
  approximate coverage grid or premature polygon-union implementation. Reassess only if Phase 13
  frame budgets show planner cost is material.
- The archive diagnostic additions are durable fixture provenance, not runtime policy. Camera
  residency, containment, collision, and portal tracing remain independent of renderer windows.

### 2026-07-28 — Phase 11A Complete — Effective Visibility and Layer Masks

#### Landed Shape

- Added `portal_visibility.rs` beside the existing host projection primitives. It projects
  validated reciprocal polygons onto a stable source-plane basis, intersects arbitrary simple
  polygons with `geo` boolean operations, triangulates every retained component, and lifts the
  result exactly onto the selected source plane.
- Kept `NON_EXACT_APERTURE_COPLANAR_EPSILON = 0.001` and the independently named normalized normal
  alignment threshold local to render-visibility preprocessing. The shared `0.0002` spatial-query
  tolerance and authored geometry remain unchanged.
- Cut the EnvCell transport directly to HBEC v2. Each crossing now carries
  `sourceApertureIndex`, `visibilityApertureIndex`, and consumed authored-source or
  reciprocal-intersection provenance. The v1 decoder and paired-aperture compatibility shape were
  deleted.
- Resolve reciprocal intersections once after the complete directed crossing table is known.
  Canonical pairs cache one immutable effective geometry; asymmetric exact flags preserve the
  exact direction's authored aperture while the non-exact direction uses the intersection.
- Carried separate authored query and effective visibility apertures through realization and the
  scene crossing contract. Facing and general spatial queries consume authored geometry; portal
  windows, finite-near-plane contact, and masks consume effective geometry.
- Simplified every planner mask edge to one `visibilityApertureId` and removed per-frame reciprocal
  clipping plus non-exact scratch capacity.
- Replaced path-stack `pushMask`/`popMask` operations with one layer-mask write using
  `REPLACE renderLayer`. Target allocation, sampled color/depth copy, masked depth replacement,
  presentation, resize, disposal, and context-loss behavior remain owned by the substrate.

#### Verification

- The full archive census found 1,269,789 exact directed authored apertures and 110,971 non-exact
  directed apertures. Of the latter, 110,316 have mutual internal reciprocals and 655 retain
  authored-source visibility with an unresolved diagnostic.
- All 110,316 reciprocal directions are coplanar within `0.001`; maximum deviation is
  `0.00090026855`. The 55,177 canonical reciprocal pairs produced 55,177 non-empty effective
  geometries with zero over-threshold, empty, malformed, or multipart archive results. Permanent
  synthetic coverage retains multipart support.
- HBEC v2 materialization on `0x574EFFFF` decoded and realized 423 cells, 1,031 aperture resources,
  972 directed crossings, 231 residents, and 68 visibility islands without browser-console errors.
- Gate E archive probes reproduced bounded graph structure:
  - `0x0001FFFF`: 15 work items, 3 nodes, 2 mask edges, maximum layer 2, and 6 selected scopes;
  - `0x00D1FFFF`: 179 work items, 6 nodes, 6 mask edges, maximum layer/capacity 4, 57 selected
    scopes, and 16 maximum retained fragments per node;
  - `0xEC0EFFFF`: 648 work items, 8 nodes, 47 exterior-transition mask edges, one cyclic component,
    maximum layer 2, and 14 selected scene entries.
- The dense probe's maximum retained fragments fell from 117 under per-frame paired clipping to 16
  under one preprocessed effective aperture. Required stencil capacity fell from layer 4 plus a
  scratch value to layer 4 exactly.
- The browser pixel fixture proved arbitrary apertures, overlapping and disjoint layer union,
  ordered layer overwrite, sampled-depth copy, masked depth reset, final presentation, state
  restoration, resize/disposal, and typed context-loss rejection.
- Full frontend verification passed: 65 files / 345 tests, Svelte/TypeScript checks, ESLint, Knip,
  production build, and Prettier check.
- App-host verification passed 52 tests plus Clippy for all targets with warnings denied. Relevant
  shared crates passed 112 tests, including archive-backed parity/resource fixtures.
- Production `portal` mode remains rejected. All archive and materialization browser runs stayed in
  flat mode with zero portal aperture draws, scene-domain targets, or composites.

#### Decisions, Concessions, and Debt

- `geo` is a deliberate app-host dependency for maintained arbitrary polygon boolean operations
  and triangulation. The archive currently produces only single-component intersections, but
  synthetic multipart coverage prevents that observation from narrowing the contract.
- The archive's minimum normalized absolute reciprocal-plane alignment rounds to `1`; the separate
  `0.99999` alignment threshold rejects structurally different planes without conflating angular
  validation with distance-to-plane tolerance.
- The full archive gate caught and corrected two numeric defects before acceptance: the initial
  stable-basis origin omitted division by normal length squared, and the initial alignment evidence
  used an unclamped raw nearly-unit dot product. Both calculations now use normalized, bounded
  geometry and fail loudly on invalid input.
- Full lint removed an unused paired-aperture test helper and narrowed `ScenePortalAperture` from a
  speculative public export to the private constituent type actually consumed by
  `ScenePortalCrossingInput`.
- Effective intersections increase aperture resource count but remove repeated reciprocal
  projection/intersection and scratch-stencil work from every frame. Phase 13 remains responsible
  for measuring the net runtime tradeoff.

### 2026-07-28 — Phase 11B and Resteering Gate F Complete — Exterior Composition

#### Landed Shape

- Added a stateless exterior-transition compositor that consumes the final
  `PortalRenderWorkPlan` directly. It validates the authoritative root, reached transition
  operations, render-layer capacity, target scene domains, and effective aperture resources
  before allocating or drawing.
- Implemented both direct root directions. An exterior-root view renders the exterior once, seeds
  composite color/depth, unions accepted transition masks with `LEQUAL`, resets depth in that
  union, and invokes the reached indoor contribution once. An interior-root view renders indoor
  content once and copies one cached exterior color/depth result through the transition union.
- Kept the seam deliberately narrower than a graph executor. It accepts only transitions adjacent
  to the authoritative root and rejects exterior re-entry before allocation; Phase 12B owns
  arbitrary internal/exterior graph integration.
- Used the existing fixed exterior and composite targets. The executable direct-transition cases
  require no feedback ping-pong, so no speculative third target or alternate schedule was added.
- Added dependency-injected unit coverage for operation ordering, preflight failures, allocation
  failure, draw failure/state restoration, no-transition indoor views, and both root directions.
- Added a production-WebGL browser fixture using arbitrary planar masks, real
  `RGBA8`/`DEPTH24_STENCIL8` targets, sampled color/depth copies, depth reset, material-class
  blending, presentation, and two independent views reusing the same target objects.

#### Verification

- The exterior-composition browser fixture passed tunnel depth reset, multiple-window union,
  exterior-root and interior-root composition, opaque/transparent/additive ordering, exterior
  occlusion before mask creation, copied exterior depth, target reuse without stale-view reuse,
  and an exterior near-plane straddle.
- Both independent views rendered the exterior exactly once, rendered indoor content exactly once,
  drew two transition masks, and performed one composite. Only the exterior-root view consumed its
  topology-bounded near-plane seed.
- Pixel evidence distinguished every relevant outcome: the tunnel and second window produced the
  ordered blended indoor result; a nearer exterior occluder remained exterior; the transition
  notch and clipped side remained exterior; copied exterior depth admitted a nearer probe and
  rejected a farther probe.
- The existing portal-substrate browser fixture remained green for arbitrary mask geometry,
  layer-union and overwrite behavior, sampled-depth copy, masked reset, presentation, ordinary
  state restoration, resize/disposal, and typed context-loss rejection.
- Flat fixture frames retained zero portal aperture draws, scene-domain targets, and portal
  composites.
- Full frontend verification passed: 66 files / 352 tests, Svelte/TypeScript checks, ESLint, Knip,
  Clippy with warnings denied, production build, Prettier check, and `git diff --check`.

#### Decisions, Concessions, and Debt

- The compositor consumes graph-emitted effective apertures and the graph's topology-bounded
  near-plane seed. It does not rediscover reciprocal geometry, repeat near-plane intersection, or
  create an executor-private transition schedule.
- Transition masks use `LEQUAL` against the source domain depth before reset/copy. This preserves
  nearer exterior occluders while allowing terrain behind an accepted opening to be replaced.
- The strengthened straddle fixture initially exposed a malformed test projection matrix that was
  labeled as identity while folding clip-space depth into one axis and discarding another. The
  matrix was corrected to true identity and the slanted planar L-shaped aperture retained; no
  production behavior or acceptance condition was weakened.
- Reusing target objects is not permission to reuse rendered view contents. Each independent view
  rerenders its reached exterior domain; only same-view transition apertures share that cached
  result.
- Exterior re-entry remains intentionally unsupported by this standalone seam. Phase 12B must
  prove its composition through the single Phase 12A graph executor rather than extending this
  seam into a parallel planner.

### 2026-07-28 — Phase 12A and Resteering Gate G Complete — Internal Execution

#### Landed Shape

- Added one stateless indoor graph executor. It preflights the finalized plan and every effective
  aperture before target allocation, then executes the emitted render layers directly through the
  Phase 11A substrate.
- Factored renderer scene resolution away from flat selection policy. Flat mode resolves one flat
  query; the internal executor resolves each unique graph node through the same contribution path,
  merges all nodes assigned to one render layer, and preserves the existing global material and
  transparency ordering.
- Added a harness-only production execution probe without changing the public renderer contract.
  Public `portal` mode remains rejected until Phase 13.
- Added the aperture's owning landblock to `PortalDrawUnit`, allowing the production executor to
  transform retained aperture geometry into the current anchor-relative clip frame without
  topology or reciprocal lookup.

#### Verification

- Focused executor, substrate, and exterior-compositor suites pass: 3 files / 20 tests.
  Svelte/TypeScript checks and ESLint pass.
- The `0x0001FFFF` archive view executed 3 unique render nodes across 3 render layers with 2
  effective aperture masks and 6 selected scopes. It submitted 25 existing shell draws, including
  6 transparent ranges, with no browser or WebGL errors.
- The dense `0x00D1FFFF` archive view executed 6 unique render nodes across 5 render layers with 6
  effective aperture masks and 57 selected scopes. The shared contribution path selected 55 shell
  nodes and 32 static-resident nodes, submitting 469 existing draws, 56 persistent instances, 63
  transparent draws, and zero structured-shell cull overrides. No page-console error occurred.
- The corrected substrate fixture seeds physically valid source-wall depth before nested masks.
  A child aperture inside the parent opening renders, while the same child geometry behind the
  source wall is rejected by `LEQUAL`. This matches the legacy renderer's depth-constrained,
  layer-wide stencil behavior.
- Added a production-WebGL internal-execution fixture with an L-shaped root aperture, disjoint
  sibling masks, overlapping oversized child masks, source and intermediate wall depth, and
  reciprocal near-plane-seed executions. Pixel reads prove the concave notch and parent wall stay
  at root color while both admitted child openings reach the ordered masked contribution.
- The masked contribution exercised opaque, alpha-test discard/keep, transparent, and additive
  state. Expected ordinary blended pixels were `[64,102,115,255]`; the kept alpha-test patch
  produced `[64,141,204,255]`; rejected regions remained `[26,51,204,255]`.
- The forward trace submitted 4 unique nodes through 3 layers and 4 masks exactly once. The
  reciprocal trace submitted 2 nodes through 2 layers and one mask. Both consumed exactly one
  topology-bounded near-plane seed and produced no browser error.
- Full frontend verification passed: 67 files / 357 tests, Svelte/TypeScript checks, ESLint, Knip,
  Clippy with warnings denied, production build, Prettier check, and `git diff --check`.

#### Decisions, Concessions, and Remaining Gate Work

- Retracted the earlier nested-mask blocker. Its red fixture omitted source-domain wall depth and
  therefore did not model a valid rendered portal boundary. No clipped GPU-window contract or
  source-layer stencil gating was retained.
- Render nodes sharing a layer are merged before material passes. Drawing each node as an
  independent miniature scene would break global transparent ordering even though it would look
  superficially simpler.
- The explicit probe returns its metrics in the operation result because the harness's continuing
  flat animation loop would otherwise overwrite them on the next frame.
- The fixture scene drawer is shared by the exterior and internal browser gates. It is intentionally
  fixture-only; production materials continue through the existing renderer programs, as proven by
  the dense archive run.
- Gate G passes. No layer-union leakage, duplicate node contribution, blend-order failure, public
  portal-mode activation, or flat-frame portal work was observed.

### 2026-07-28 — Phase 12B Exterior-Cycle Contract Gap — Paused for Resteering

#### Evidence

- The transition-heavy archive view rooted at `0xEC0E010B` produced the previously recorded 8-node,
  47-edge graph with one cyclic component and render layers `0..2`.
- Layer 1 contains the unique outdoor node plus three indoor visibility-island nodes. Its 42
  incoming transition edges include:
  - entries from the layer-zero indoor root into outdoor;
  - transitions from outdoor into the three same-component indoor nodes;
  - return transitions from those indoor nodes into outdoor.
- Layer 2 contains three additional indoor nodes reached from outdoor through five transition
  masks.
- Legacy does not flatten these facts into one cross-domain draw order. It builds an exterior
  suffix image containing outdoor plus re-entered indoor content, then composites that image
  through the inbound outdoor transition masks.

#### Gap

- `PortalRenderWorkPlan` currently retains unique nodes, mask edges, render layers, and individual
  `ExteriorTransitionOperation` records, but discards the strongly connected component membership
  already computed by the planner.
- A single layer-wide label cannot distinguish masks that build the exterior suffix from masks
  that place that completed suffix into the root view. Copying exterior before all same-layer
  indoor contributions can expose indoor geometry through exterior-entry masks; copying it after
  can expose exterior through indoor-entry masks.
- Reconstructing component membership and a suffix schedule inside the GPU executor would violate
  the accepted invariant that one planner graph maps directly to one execution trace without an
  executor-private route, region, partition, or contribution scheduler.

#### Recommended Contract Correction

- Have the pure planner emit one explicit exterior-component operation for the strongly connected
  component containing the unique outdoor node. The operation should name:
  - the outdoor render node;
  - indoor suffix member nodes;
  - mask edges entering the component from outside;
  - internal mask edges that expose suffix indoor members;
  - return edges targeting the outdoor base as consumed cycle provenance rather than repeated
    exterior contribution.
- Phase 12B can then retain the existing two targets without framebuffer feedback:
  1. render outdoor once into the exterior target;
  2. draw the operation's indoor suffix members into that same target through its internal masks;
  3. render the root-side graph into the composite target;
  4. copy the completed exterior suffix through the operation's entry-mask union;
  5. continue later graph layers normally.
- The operation must be derived in the planner from its existing SCC result, not reconstructed in
  WebGL code. Phase 11B's target, mask, depth-reset, and sampled color/depth primitives remain
  unchanged.

#### Decision Required

- Approve the planner-emitted exterior-component operation and two-target suffix execution as the
  Phase 12B correction, or select a different explicit execution contract. No hybrid GPU code is
  landed while this cross-domain cyclic ordering remains implicit.

#### Decision

- Approved the planner-emitted exterior-component operation and two-target suffix execution.
- The correction remains pure planning plus one graph executor. It does not import legacy's nested
  frame-plan hierarchy, add a third render target, or make the WebGL path reconstruct component
  membership.

#### Implementation Finding — Shared-Layer Mask Isolation

- A synthetic graph proved that the exterior component and an unrelated indoor component may
  legitimately share one topological render layer. The planner now retains enough component
  membership to distinguish them, but the two contributions cannot use one stencil union: copying
  the exterior suffix through the indoor branch's aperture would leak the wrong scene domain.
- Clearing and reusing the layer's stencil value is also incorrect. Every same-layer aperture must
  pass its depth test against the depth buffer at the start of that layer; drawing the first
  contribution before constructing the second mask can make newly written depth reject the second
  aperture.
- The narrow proposed correction is a planner-assigned temporary stencil value only when the
  exterior operation shares its layer with another contribution group. Both exact mask unions are
  written before either contribution changes depth, then each contribution consumes its own label.
  Ordinary layers and exterior-only layers retain the existing layer-wide union and require no
  additional value or draw.
- This changes mask-capacity preflight for the mixed-layer case from `maximumRenderLayer` to
  `maximumRenderLayer + 1`. No render target, topology schedule, or GPU graph reconstruction is
  added. The refinement was approved and implemented in Phase 12B.

### 2026-07-28 — Phase 12B Complete — Unified Hybrid Execution

#### Landed Shape

- Extended the pure planner with one explicit exterior-component operation retaining the outdoor
  strongly connected component, its indoor suffix members, entry masks, internal suffix masks,
  return-to-outdoor provenance, root membership, and composition stencil value.
- Added a planner-owned temporary stencil value only when the exterior contribution shares a
  topological layer with a different contribution group. Both exact mask unions are written
  against pre-layer depth before either contribution draws.
- Replaced the indoor-only executor with one stateless portal graph executor. It renders outdoor
  once, builds any cyclic indoor suffix in the exterior target, executes the root-side graph in the
  composite target, and copies the completed suffix through the planner's entry-mask union.
- Removed the superseded standalone exterior-transition compositor and its parallel scheduler
  contract. Direct exterior-root, indoor-root, cyclic re-entry, and internal-only cases now all
  execute through the same graph executor.
- Generalized the harness-only archive probe and its CLI flag from internal execution to complete
  portal execution. Public production `portal` mode remains rejected until Phase 13.

#### Verification

- Planner/unit coverage proves a singleton exterior component, a cyclic outdoor-plus-indoor
  component, and an unrelated same-layer indoor sibling. The mixed case requires stencil value
  `maximumRenderLayer + 1`; ordinary cases retain their graph layer value.
- The unified sequencing fixture writes both same-layer mask unions before changing depth, submits
  every graph node once, renders outdoor once, and consumes return-to-outdoor edges without drawing
  another exterior contribution.
- The production-WebGL hybrid pixel fixture passed indoor → outdoor → indoor suffix composition,
  multiple transition windows, concave-mask confinement, copied depth, exterior occlusion,
  transition/internal mask overlap, opaque/transparent/additive ordering, two near-plane seeds,
  both root directions, target reuse, and stale-view rejection.
- Hybrid readback produced the expected suffix blend `[64,102,115,255]`, exterior
  `[204,51,26,255]`, and untouched root notch `[26,51,204,255]`.
- The archive-backed `0xEC0E010B` execution completed with 8 unique render nodes, 3 layers, 42
  admitted mask edges, 15 actual mask draws, one exterior render, one exterior composite, and no
  browser or WebGL errors. Its 27 return-to-outdoor edges were consumed as cycle provenance rather
  than redundant work.
- The prior internal production-WebGL gate remained green after the cutover, including arbitrary
  masks, nested depth confinement, alpha test, transparent/additive ordering, and reciprocal
  near-plane executions.

#### Decisions, Concessions, and Debt

- Same-layer contribution isolation spends one additional stencil value only when structurally
  required. Serial stencil reuse was rejected because the first contribution's depth would alter
  the second mask's acceptance.
- `PortalFrameDiagnostics.maskEdgeCount` counts every admitted graph edge, while `maskDrawCount`
  counts only apertures that produce pixels. Return edges into an already-owned outdoor base are
  intentionally present in the former and absent from the latter.
- The hybrid browser fixture retains its historical exterior-composition coverage but was renamed
  around the unified executor. The separate internal fixture remains useful focused Gate G
  evidence rather than a second execution path.
- The archive screenshot is visually plausible—a dark interior with terrain limited to the
  transition opening—but deterministic pixel readback, not screenshot interpretation, is the
  acceptance authority.

### 2026-07-28 — Phase 13 Activation Started — Outdoor-Root Planning Gap

#### Landed Before the Pause

- Replaced the production renderer's `portal` rejection with the unified hybrid executor while
  preserving the flat path unchanged. Portal planning failures remain loud; there is no flat-mode
  fallback.
- Enabled the Explorer's `Portal rendering` option and exposed graph, mask, exterior, target,
  planning-time, and execution-time diagnostics in the existing frame panel.
- Added continuous-frame harness controls that separate authoritative EnvCell camera placement
  from flat/portal policy. A comparison can therefore use the same scene revision, GPU resources,
  camera pose, and residency in both modes.
- The continuous `0xEC0E010B` portal frame completed with 8 planned/submitted nodes, 3 layers, 42
  admitted edges, 15 mask draws, one exterior render/composite, 2 targets, 2.1 ms observed planner
  time, 0.7 ms observed executor time, and no browser error.
- The same `0xEC0E010B` camera in flat mode issued zero portal masks, composites, or targets. Its
  black floor opening matches the portal-mode pixels, proving that region is not lost by portal
  composition.
- Svelte/TypeScript checks and harness-script syntax checks pass after the activation work.

#### Blocking Evidence

- Switching the unchanged outdoor camera over `0xDA55FFFF` to portal mode fails before GPU
  allocation or drawing:
  `Masked crossing portal-crossing:0xda55ffff/250 remains inside one render domain.`
- The source topology for this landblock contains 408 directed indoor depth-continuous crossings
  and 44 directed indoor topology boundaries. Visibility-island construction transitively unions
  every depth-continuous EnvCell pair. Crossing 250 is a retained topology-mask boundary whose
  endpoints nevertheless land in the same transitive visibility island.
- This is a valid graph shape that the synthetic planner suite did not cover. A direct uncertain
  seam can connect two cells already connected through another all-depth-continuous route. The
  current planner assumes every masked indoor edge crosses visibility islands and throws when that
  assumption is false.

#### Decision Required

- Decide how render planning consumes an indoor topology-boundary edge whose endpoints already
  belong to one proven depth-continuous render domain.
- The narrow candidate is to retain the crossing in authoritative topology/spatial-query data but
  omit it from render masks: both endpoint scopes are already drawn exactly once in the same
  domain, and ordinary depth resolves their surfaces. This needs an explicit synthetic loop proof
  and archive verification before adoption.
- Splitting that visibility island is not automatically viable. The same cycle contains
  depth-continuous edges that require their endpoints to share a render domain; satisfying both
  constraints may require duplicated scope rendering, violating the accepted unique-node
  submission model.
- Phase 13 stops here. Do not collect the performance matrix, make portal the default, or begin
  Phase 14 until this graph invariant is resolved deliberately.

#### Decision and Resolution

- Approved retaining same-domain topology-boundary crossings for authoritative topology and
  spatial queries while omitting them from render masks.
- The pure planner now treats such a crossing as a render-only no-op and records a unique
  `sameDomainBoundaryCrossingCount`. It does not mutate the topology view, merge another domain,
  or hide the crossing from portal tracing.
- A permanent synthetic A → B → C depth-continuous loop plus uncertain C → A boundary proves one
  render node, zero masks, and one retained same-domain diagnostic.
- The previously failing outdoor-root `0xDA55FFFF` frame now completes with 10 planned/submitted
  nodes, 3 layers, 13 admitted/drawn masks, 4 same-domain boundaries, one exterior
  render/composite, and no browser error.
- This is a planner simplification, not a GPU exception: the executor receives only masks that can
  separate distinct render contributions.
- Repeated `portal → flat → portal → flat` frames at `0xEC0E010B` retained one source batch and
  byte-for-byte stable scene/resource diagnostics. Both flat snapshots performed zero portal frame
  work while honestly reporting the two retained reusable targets.
- A three-second fixed delay raced the 4,213-cell `0x00D1FFFF` publication and briefly exposed an
  unavailable root scope; the same capture passed with the prior ten-second delay. The browser
  harness now waits for the requested EnvCell layer's published runtime diagnostic before applying
  an EnvCell camera or portal mode. User-configured settle time is additional stabilization, not
  a correctness primitive.

#### Phase 13 Capture and Performance Evidence

All values below are single observed browser frames at the same 1536 × 600 harness extent. They
are evidence, not product thresholds. Portal target ownership is two RGBA8 plus
DEPTH24_STENCIL8 targets totaling 14,745,600 bytes; the targets remain reusable after switching
back to flat and are released by resize/destroy policy.

| Fixture and camera                                   | Flat selected scopes / ordinary draws |       Portal scopes / nodes / masks / ordinary draws | Observed planner / executor ms |
| ---------------------------------------------------- | ------------------------------------: | ---------------------------------------------------: | -----------------------------: |
| Small `0x00010100`, projected cell center            |                                7 / 31 |                                       7 / 5 / 4 / 31 |                      0.6 / 0.6 |
| Dense `0x00D10100`, first-portal-facing stress view  |                        4,012 / 29,331 |                                     55 / 6 / 6 / 469 |                      1.0 / 1.1 |
| Transition-heavy `0xEC0E010B`, projected cell center |                              19 / 267 | 9 / 8 / 15 actual draws from 42 admitted edges / 118 |              2.8–3.1 / 1.1–1.2 |
| Resident-heavy `0x64440248`, projected cell center   |                           103 / 1,790 |                                   59 / 2 / 1 / 1,146 |                      1.4 / 6.2 |

- Flat and portal PNG captures matched visually at every paired archive camera. The resident-heavy
  view retained its dense table population; the small and dense views retained identical shell
  surfaces; the transition view's black floor opening was identical in both modes and therefore
  is not portal-composition loss.
- The dense stress view is the meaningful performance result: exact portal planning avoids more
  than 28,000 ordinary draw submissions in the observed frame. The easier dense cell-center view
  reached only two nodes and was not substituted for the established first-portal-facing fixture.
- The hybrid pixel gate remained green for tunnel depth replacement, multi-window union,
  indoor/outdoor cycles, two near-plane straddles, and opaque, alpha-test, transparent, and
  additive ordering.
- With the browser, archive, blend, lifecycle, and target-ownership matrix passing, production
  `DEFAULT_FRAME_SETTINGS` now selects `portal`. The harness keeps an explicit flat baseline and
  Explorer keeps both user-selectable modes.
- Phase-close verification passed: 66 frontend test files / 354 tests, Svelte and TypeScript
  checks, ESLint, Knip, and Clippy with warnings denied.

### 2026-07-28 — Phase 14 Complete — Cleanup, Documentation, and Full Verification

#### Cleanup and Architecture Results

- Rewrote `apps/holtburger-3d/ARCHITECTURE_AUDIT.md` from the current code using the
  architecture-audit workflow. The snapshot now traces cumulative acquisition, HBEC v2,
  materialization, failure-atomic publication, scope/culling ownership, spatial queries,
  authored/effective apertures, visibility islands, unique-node planning, layer-wide mask unions,
  and exterior composition.
- Replaced the stale pre-integration portal investigation with a current proven-contract document.
  Updated the BSP and DAT references with Cell BSP positive-chain containment, Environment and
  CellStruct ownership, EnvCell record fields, portal flags, reciprocal identity, and the boundary
  between authored data and derived render policy.
- Retained `OutdoorStaticLayerKind`: it still honestly names Buildings, Objects, and Generated.
  EnvCells remains distinct because it owns shells, topology, containment, queries, and apertures
  in addition to static residents.
- Retained `queryWorldPointResidencyCandidates`: it is the ambiguity-preserving replacement for
  the deleted first-match query, not compatibility debt.
- Confirmed the remaining fixture-local `apertureIds` array is ordinary synthetic input rather
  than the deleted paired renderer-aperture protocol.
- Removed the HBEC v1 tombstone test. Positive HBEC v2 validation remains; there is no v1 decoder
  or compatibility path to preserve.
- Confirmed shell and resident preparation share the established static material planner,
  texture dependency collector, atlas, geometry manager, static object system, and renderer.
  Apertures remain material-free `PortalDrawUnit` geometry and never enter textured shell ranges.
- Confirmed every retained source/frame diagnostic is consumed by validation, runtime aggregation,
  the explorer, browser assertions, performance evidence, or this audit.

#### Discovered and Resolved Fixture Debt

- The final blended regression fixture exposed a real stale contract: both blended and instanced
  synthetic pipelines used `as unknown as CommitBundle` to inject already-built
  `StaticObjectLayerArtifact` values after production had completed its source-first cutover.
  Runtime correctly rejected the artifact with `Layer buildings has no publication contract`.
- Removed both artifact factories and unsafe casts. The fixtures now emit typed
  `ResolvedOutdoorStaticLayerSource` residents and exercise the production material planner,
  geometry worker, atlas/realizer, publication, scene, and renderer paths.
- The instanced fixture now requests the Generated layer, the honest production domain for
  persistent instancing, rather than fabricating an instanced Buildings artifact.
- Rerun evidence:
  - blended: 6 source residents, 6 baked draws, 3 transparent draws, 3 additive draws;
  - instanced: 5 source residents, 2 persistent instanced draws / 4 persistent submissions,
    3 camera-ordered transparent draws, and 1 additive draw.

#### Final Verification

- Frontend: 66 files / 353 tests passed after removing the dead HBEC v1 tombstone. Svelte and
  TypeScript checks, ESLint, Knip, terrain shader validation, production build, and Prettier passed.
- Rust: `cargo fmt --all -- --check`; 36 `holtburger-content` tests; 52 Tauri host tests; and both
  targeted Clippy runs with `-D warnings` passed.
- GPU browser fixtures passed:
  - portal substrate allocation/resize/disposal, arbitrary masks, layer unions, nested confinement,
    sampled depth copy, masked depth reset, final presentation, state restoration, and typed
    restart-required context loss;
  - internal portal layered execution;
  - hybrid outdoor/indoor cycles, tunnel depth, multiple windows, near-plane straddles, and opaque,
    alpha-test, transparent, and additive ordering;
  - migrated blended and instanced static source paths.
- Archive browser runs passed:
  - `0xEC0E010B` portal → flat → portal → flat retained one source batch, stable scene/resource
    ownership, repeatable 8-node / 3-layer portal frames, zero flat portal work, and two retained
    targets totaling 14,745,600 bytes;
  - portal-facing `0x00D10100` reduced 4,213 resident cells / 9,798 crossings to 55 selected scopes,
    6 render nodes, 6 masks, and 469 ordinary draws in the observed frame;
  - `0x64440248` materialized all 2,488 loaded residents with zero unsupported or deferred entries
    and rendered the selected resident/shell scopes without transform or ownership failures.

#### Concessions and Remaining Debt

- `webgl2-renderer.ts` is now approximately 1,900 lines. Its boundaries remain coherent, but
  contribution assembly, frame diagnostics, or harness probes should be extracted before another
  renderer subsystem is added.
- `env_cell_source.rs`, the HBEC decoder, `game-runtime.ts`, and the Tauri composition root are
  large cohesive hubs. They are recorded review targets, not justification for speculative splits.
- Flat mode deliberately favors inspection over scalable gameplay visibility.
- Same-domain topology boundaries remain query-visible but cannot produce a useful render mask
  after both endpoint scopes are owned by one depth-continuous render domain.
- Explorer free-fly residency remains best-effort and history-free. Authoritative player and
  third-person camera policy remains correctly deferred to a future client/controller.

### 2026-07-28 — Phase 15 Complete — Shared Record and Execution Contracts

#### Landed Cleanup

- Replaced the duplicate HBSO/HBEC section writers with one typed Rust binary-section writer. It
  owns alignment, scalar encoding, manifest offsets, and finite-float enforcement; each record
  retains its own header, required-section set, and domain validation.
- Added one frontend binary-section substrate for schema validation, bounds, alignment, overlap
  rejection, typed reads, and finite-float enforcement. Renamed the shared static payload decoder
  so HBEC no longer depends on an outdoor-named module.
- Centralized texture-fact compatibility and stable merging, and replaced ad hoc owner-string
  slicing with a typed landblock-layer owner parser plus one shared currentness predicate.
- Moved completed portal-plan structural validation into a pure module. The WebGL executor now
  resolves GPU masks and interprets a validated plan instead of also reconstructing topology and
  component invariants.
- Shared only exact portal-fixture geometry/diagnostic boilerplate and source projection identity
  helpers. Scenario graphs, record envelopes, and domain policy remain explicit.
- Updated the architecture audit with the new record, identity, texture, and portal-execution
  boundaries.

#### Verification

- Frontend: 69 files / 359 tests passed. Svelte and TypeScript checks, ESLint, Knip, Prettier,
  terrain shader validation, and the production build passed.
- Rust: `cargo fmt --all -- --check`; 36 `holtburger-content` tests; 53 Tauri host tests; and
  Clippy for both content and the Tauri host with warnings denied passed.
- Portal substrate, internal execution, and hybrid execution browser fixtures passed. Hybrid
  readback retained exterior depth occlusion, interior color/depth copy, multiple-window union,
  target reuse, stale-view rejection, and dual-side near-plane-straddle behavior.
- An archive-backed `0xEC0E010B` portal → flat → portal → flat cycle retained one source batch and
  stable scene/resource ownership. At the verified shell-center pose, portal frames selected one
  render node after rejecting 16 back-facing crossings; flat frames performed zero portal work
  while retaining the two reusable targets.
- `git diff --check` passed. The cleanup added no captures, runtime assets, staged files, or
  submodule changes.

#### Deliberate Non-Abstractions

- HBSO and HBEC remain distinct record formats. A generic record framework would hide their
  different envelopes and required-section contracts without removing meaningful policy.
- Portal fixtures share primitives, not scenario builders; their graph shapes and pixel assertions
  remain readable at the call site.
- Cross-language draw ranges, matrices, and polygon shapes were not forced behind parallel helper
  taxonomies. They are data contracts with different producer and consumer concerns, not duplicated
  behavior.
- `webgl2-renderer.ts` was not split as part of this cleanup. Its size remains recorded debt, but
  mixing that broader extraction into invariant deduplication would make the cutover harder to
  review and easier to get wrong.

#### Post-Review Correction

- Fixed an authored-versus-effective culling contract error. The host already expands
  `CullMode.None` into positive and reversed-winding triangles, so disabling GPU face culling for
  both ranges submitted each coplanar surface twice.
- `StaticObjectMaterialBinding` now preserves `authoredCullMode` as provenance separately from the
  effective `cullFace` consumed by WebGL. Every production expanded side is one-sided; the
  counter-clockwise authored case retains front-face rejection.
- Replaced synthetic blended and instanced fixtures that described one unexpanded triangle as
  `CullMode.None` with honest one-sided source geometry.
- Added a focused positive/reversed regression test. The full frontend suite passed at 70 files /
  361 tests; type checks, ESLint, Knip, Prettier, and production build passed. Hybrid portal,
  blended static, instanced static, and archive-backed `0xEC0E010B` portal browser runs remained
  green.

### 2026-07-28 — Post-Closeout Near-Plane Seed Execution Correction

#### Root Cause

- The planner correctly detected finite near-plane/aperture intersections and emitted
  `nearPlaneSeeds`, but execution only validated and counted those records. The target branch still
  used the ordinary aperture mask, so GPU near-plane clipping left the root contribution visible:
  clear/fog color for an indoor root and exterior color for an outdoor root.
- The synthetic fixtures called this dual-side rendering because both nodes were submitted. Their
  expected clipped pixel deliberately retained the root color, so they proved diagnostic
  provenance rather than executable seed coverage.

#### Landed Correction

- Camera residency remains the sole layer-zero root. A straddled target uses the next ordinary
  render layer and retains the aperture's parent-bounded eye-ray footprint as executable NDC mask
  geometry.
- The GPU writes that screen-space footprint without near-depth rejection, resets depth only
  inside it, and renders or composites the adjacent domain under the resulting stencil label.
  Resident depth remains authoritative outside the aperture, while adjacent depth owns its rays.
- Straddles no longer add reciprocal graph links, collapse render layers, share root depth, or
  require exterior-mask prewrites. Authored topology and downstream portal traversal remain
  unchanged.
- Completed-plan validation requires every straddle edge to carry a normalized executable mask
  window and keeps the camera-resident node as the sole layer-zero contribution.

#### Verification

- The pure planner proves a wrong-facing straddled target occupies the next layer with its exact
  screen-space mask. The executor trace proves the world aperture is not resolved for that edge,
  followed by masked depth replacement and one adjacent-domain submission.
- The internal browser fixture proves the same masked execution in the reciprocal residency
  direction.
- The hybrid browser fixture separates ordinary tunnel/multi-window/depth-copy coverage from
  straddle coverage. Dedicated outdoor-to-indoor and indoor-to-outdoor views retain one exterior
  render, preserve resident pixels outside the NDC footprint, replace color/depth inside it, and
  keep an outdoor-sourced indoor portal reachable inside the inherited straddle window.

### 2026-07-30 — Static Detail Domain Correction

- Removed the unsupported `0x20000` surface-eligibility gate. Retail scopes building and
  environment detail textures around their complete draw domains, and production DA55 building
  and CellStruct textures do not carry that flag.
- Restored retail's destination-color/inverse-source-alpha composition in the object shader:
  `base * (detail.rgb + 1 - detail.a)`.
- Distinguished CellStruct shell geometry from objects resident inside an EnvCell. Shells consume
  the environment role; resident objects consume no detail texture.
- Kept detail selection nullable as the explicit ordinary-object domain state. Selected
  building/environment roles remain mandatory at lookup, while the shader skips detail sampling
  for the no-detail state.
- Replaced flag-oriented planner tests with unflagged domain-role coverage and added shader
  composition coverage.
