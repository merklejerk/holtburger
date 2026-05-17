# Holtburger 3D Outdoor Portal Stencil Rendering Plan

Status: Phase 9 complete; Phase 10 planned.

## Purpose

Implement outdoor-to-indoor portal rendering in `apps/holtburger-3d` so exterior views can show
interior env cells through door, window, and underground-transition apertures without cutting
terrain meshes or rendering portal polygons as opaque walls.

The first target is browser/free-camera outdoor scenes. This work should not depend on live runtime
residency or the future walkabout simulator. It should consume static scene coverage, camera state,
prepared env-cell topology, and prepared portal geometry. Later browser walkabout and client modes
can feed the same renderer pass with simulator/runtime-resident portal view groups.

Browser/free-camera mode remains a diagnostic level browser. It should still be able to render all
loaded env cells normally when the user asks for broad interior visibility. The portal stencil pass
is an additional smoke-test/accuracy pass for outdoor apertures, not a replacement for free-camera
whole-level inspection.

## Source-Backed Context

Related docs:

- Findings: [../portal_rendering.md](../portal_rendering.md)
- Renderer-local rebasing:
  [holtburger-3d-renderer-local-rebasing-plan.md](holtburger-3d-renderer-local-rebasing-plan.md)
- Local simulation exploration:
  [holtburger-local-world-simulation-exploration-plan.md](holtburger-local-world-simulation-exploration-plan.md)

Retail references:

- `PView::DrawCells` draws landscape first, then draws env-cell outside-transition portal polygons
  before drawing env cells:
  `acclient-eor-source/acclient.c:441068`
- `D3DPolyRender::DrawPortalPolyInternal` draws clipped portal polygons with texture disabled and
  depth-buffer state configured for a portal mask/depth operation:
  `acclient-eor-source/acclient.c:433532`,
  `acclient-eor-source/acclient.c:433593`,
  `acclient-eor-source/acclient.c:433600`,
  `acclient-eor-source/acclient.c:433662`
- Retail portal draw mode globals are named `maxZ2` and `maxZ1` in the decompile statics, initialized
  to `6` and `7`; these flags control depth-write and forced-depth behavior in
  `DrawPortalPolyInternal`:
  `acclient-eor-source/acclient.c:44699`,
  `acclient-eor-source/statics.txt:11196`
- `PView::DrawCells` clears depth after landscape drawing when portal polygons were drawn, then
  later draws env cells:
  `acclient-eor-source/acclient.c:441096`,
  `acclient-eor-source/acclient.c:441099`,
  `acclient-eor-source/acclient.c:441210`
- `RenderDeviceD3D::DrawLandCell` draws terrain landcell polygons directly:
  `acclient-eor-source/acclient.c:436408`
- `CLandBlockStruct::ConstructPolygons` constructs normal terrain triangles; no source-backed
  evidence currently indicates that terrain is physically cut around underground openings:
  `acclient-eor-source/acclient.c:339407`
- `PView::ConstructView` culls building/outside portals by portal side and polygon plane before
  constructing the linked view:
  `acclient-eor-source/acclient.c:442041`,
  `acclient-eor-source/acclient.c:442079`,
  `acclient-eor-source/acclient.c:442084`,
  `acclient-eor-source/acclient.c:442093`
- Retail building rendering invokes drawing-BSP portal-only passes for blank portal/depth setup and
  view-through portal drawing:
  `acclient-eor-source/acclient.c:436520`,
  `acclient-eor-source/acclient.h:4673`
- `CEnvCell::grab_visible_cells` adds the current env cell, its visible/stab cells, and outside
  landscape when `seen_outside` is set:
  `acclient-eor-source/acclient.c:335978`
- Outdoor building transition records are topology, not aperture geometry. Retail `CBldPortal`
  stores side/target/stab data but no polygon pointer:
  `acclient-eor-source/acclient.h:13730`
- Env-cell transition records point at real aperture polygons. Retail `CCellPortal` stores a
  `CPolygon *portal`, and `CCellStruct` stores the portal polygon array:
  `acclient-eor-source/acclient.h:13818`,
  `acclient-eor-source/acclient.h:13788`

Holtburger references:

- Environment geometry preparation and portal-polygon exclusion:
  `apps/holtburger-3d/src/workers/asset-worker.ts`
- Indoor env-cell payloads expose portals, `visibleCellIds`, and `seenOutside`:
  `apps/holtburger-3d/src/lib/host/contracts.ts`
- Tauri adapter serializes env-cell visible cells and `seenOutside`:
  `apps/holtburger-3d/src-tauri/src/adapter.rs:1210`
- Current structured interior visible-cell closure helper:
  `apps/holtburger-3d/src/lib/assets/structured-interior-coverage.ts`
- Current portal debug overlay and spatial item derivation:
  `apps/holtburger-3d/src/lib/world-display/debug-overlays.ts`,
  `apps/holtburger-3d/src/lib/world-display/render-spatial-scene.ts`
- Current renderer uses a single Three.js scene render with no explicit pass ordering:
  `apps/holtburger-3d/src/lib/world-display/world-display-renderer.ts`
- Current static outdoor scene assembly mirrors the topology-only outdoor building portal source:
  `crates/holtburger-core/src/static_outdoor_scene.rs:46`,
  `crates/holtburger-core/src/static_outdoor_scene.rs:318`

ACViewer references:

- ACViewer draws terrain before env-cell batches and does not implement retail portal view/depth
  composition:
  `ACViewer/ACViewer/Render/Buffer.cs:510`,
  `ACViewer/ACViewer/Render/Buffer.cs:513`
- ACViewer skips `NoPos` env-cell polygons in both direct cell-structure drawing and batched
  env-cell model construction:
  `ACViewer/ACViewer/Render/R_CellStruct.cs:120`,
  `ACViewer/ACViewer/Render/InstanceBatch.cs:69`
- ACE's DAT loader exposes `NoPos`/`NoNeg` side suppression and omits positive/negative UV indices
  for suppressed sides:
  `ACViewer/ACE/Source/ACE.DatLoader/Entity/Polygon.cs:35`,
  `ACViewer/ACE/Source/ACE.Entity/Enum/StipplingType.cs:3`

## Goals

- Render exterior terrain and buildings normally.
- Add a portal-composited exterior view that renders linked interior env cells through visible
  outdoor portal apertures.
- Preserve browser/free-camera whole-level interior rendering as a diagnostic mode outside the
  portal-composited pass.
- Keep terrain geometry intact. Do not cut terrain triangles around underground openings.
- Preserve portal polygons as portal aperture data, not ordinary wall/floor/ceiling geometry.
- Use stencil masking for the browser renderer rather than copying retail's likely depth-mask
  implementation.
- Keep free-camera portal rendering independent of runtime residency.
- Keep walkabout/client residency integration as a later input source to the same portal-view model.
- Centralize render ordering in a named renderer pass pipeline instead of scattering material state.
- Retain diagnostic overlays and picking for portal polygons.

## Non-Goals

- Do not implement full recursive portal rendering.
- Do not implement full retail PVS clipping in the first pass.
- Do not implement walkabout residency, collision, or portal traversal.
- Do not move browser-mode render coverage policy into shared Rust crates.
- Do not make `WorldDisplay` decide browser free-camera asset streaming or focus-anchor policy.
- Do not render all loaded interior env cells through every portal aperture.
- Do not remove browser/free-camera's ability to draw all loaded env cells for level inspection.
- Do not use `seenOutside` alone as the set of cells to render through a portal.
- Do not make terrain holes by deleting or modifying landblock terrain mesh triangles.

## Current Diagnosis

The current browser renderer has static data needed to draw portal diagnostics, but it has no portal
composition pass. It renders one Three.js scene with ordinary depth testing:

```text
renderer.render(scene, camera)
```

That is insufficient for outdoor-to-indoor transitions. Retail appears to use an order-dependent
portal pass:

```text
landscape
outside-transition portal mask/depth draw
env-cell draw
```

For Holtburger's WebGL/Three.js renderer, stencil expresses aperture membership more clearly than
copying retail's fixed-function D3D portal path directly:

```text
exterior opaque
portal aperture stencil
portal aperture depth reset
interior opaque constrained by stencil
debug overlays
```

Stencil and depth reset split the two parts of the portal problem:

```text
Where is the portal opening on screen?  -> stencil
Can linked interiors pass exterior terrain depth inside that opening? -> aperture-local depth reset
How do interior surfaces sort internally? -> normal depth after the reset
```

This keeps the terrain mesh faithful to the source landblock data while avoiding the current failure
where exterior terrain depth blocks linked interiors inside a valid aperture.

This pass should coexist with the existing browser diagnostic interior rendering. In free-camera
mode, users may choose or configure a broad diagnostic view where loaded env cells are drawn
normally outside portal apertures. The portal-composited view is valuable as a smoke test for
retail-like exterior visibility and as groundwork for future walkabout/client portal rendering.

## Conceptual Model

Introduce an app-local portal view group model.

```ts
interface OutdoorPortalViewGroup {
  id: string;
  stencilRef: number;
  portalId: string;
  source: "browser-free-camera" | "walkabout" | "runtime";
  renderChunk: RenderChunkPlacement;
  aperture: PortalApertureGeometry;
  interiorEnvCellIds: number[];
}
```

The exact type names may differ. The important boundary is:

- scene coordination derives which portal groups exist
- renderer consumes portal groups as already-local render instructions
- asset/cache code ensures the group has the required env-cell and environment assets loaded
- aperture extraction is source-neutral and not tied to whether debug portal overlays are enabled

For the first browser/free-camera implementation, group derivation should use static topology and
camera state:

```text
loaded outdoor static scene/building portals
loaded indoor env cells and environment cell structures
camera frustum and portal facing
existing visible-cell closure helper
```

Later walkabout/client modes can derive the same group type from simulator/runtime residency.

Dry-run note: current outdoor static building portal payloads expose topology, not aperture
geometry. `PreparedOutdoorStaticSceneBuildingPortal` currently carries `portalId`, `flags`,
`stabList`, and `linkedEnvCellIds`, but no polygon points, source plane, or placement transform for
the portal aperture itself. The first implementation must therefore add a source-neutral
`PortalAperture` derivation layer before renderer work. That layer can initially derive aperture
points from loaded indoor env-cell/environment portal polygons, or the host adapter can be enriched
to expose outdoor building portal aperture geometry directly if the source data supports it. Do not
reuse debug overlay models as the authoritative source; overlays are presentation and may be
disabled.

## Render Pipeline

Replace the single implicit scene render with an explicit pass sequence inside
`WorldDisplayRenderer`.

Initial fixed pass order:

```text
1. Exterior opaque pass
   - terrain
   - outdoor static renderables/buildings

2. Portal stencil write pass
   - visible outdoor-transition aperture polygons
   - color write disabled
   - depth write disabled
   - depth test policy decided during implementation; start with normal depth test if the aperture
     should be occluded by nearer exterior geometry
   - stencil write enabled

3. Portal aperture depth reset pass
   - visible outdoor-transition aperture polygons
   - stencil test enabled for that portal group's ref
   - color write disabled
   - depth write enabled
   - depth test set to always or otherwise configured so the aperture can replace exterior terrain
     depth inside the portal mask
   - shader/material writes far depth for the aperture footprint, matching the retail intent of
     allowing linked interior geometry to render through the opening after exterior terrain has
     written depth

4. Portal-composited interior pass
   - structured interior meshes and indoor static renderables grouped by portal view group
   - stencil test enabled for that group's stencil ref
   - normal depth test/write within the masked area

5. Free-camera diagnostic interior pass
   - optional/browser-mode-only pass for loaded structured interiors and indoor static renderables
     outside portal masks
   - used for level inspection, not retail-like exterior portal composition
   - may be disabled in future walkabout/client modes where portal visibility should own interior
     exposure

6. Debug overlay pass
   - cell indicators
   - portal outlines
   - selected portal bounds
   - diagnostic overlays should not accidentally inherit portal stencil state

7. Future transparent/effects pass
   - not part of the first implementation unless current behavior regresses
```

This is a fixed class-level ordering dependency, not a per-frame global depth sort. Per-frame work is
limited to selecting visible portal groups and updating their contents.

Dry-run scheduling note: the current renderer keeps one `structuredInteriorMeshes` map and one
`staticRenderableGroupMeshes` map attached to chunk roots. Portal rendering needs separate pass
membership from object lifetime. Do not create duplicate geometry caches for every portal group.
Instead, split "mesh exists in the chunk root" from "mesh participates in this pass", then have the
pass pipeline temporarily expose the relevant object sets or render pass roots. This is especially
important because the same env cell can be visible in browser diagnostic mode and through one or
more portal groups in the same frame.

## Portal Candidate Selection

Do not render masks for every known portal. A portal should be eligible only when all of the
following are true:

- The portal is an outdoor-to-indoor or indoor-to-outside transition relevant to the current outdoor
  scene.
- The linked entry env cell can be resolved or requested.
- The portal polygon/aperture geometry can be resolved.
- The portal aperture intersects the camera frustum.
- The camera is on the visible side of the portal plane.
- The owning render chunk is spatially visible.
- Optional: the projected screen area is above a small threshold.

Back-facing portals should be skipped unless source-backed evidence proves a particular portal class
is two-sided. Retail `PView::ConstructView` performs portal-side checks before constructing a portal
view, so the first implementation should also treat facing as a correctness condition.

Screen-area culling should be implemented as a late optimization after frustum and facing checks.
The low-risk first version can project aperture vertices through the active camera, convert NDC to
viewport pixels, clamp to the viewport, and reject apertures whose projected bounding-box area is
below a small configurable threshold. A later refinement can compute the clipped projected polygon
area with the shoelace formula. Keep this threshold disabled or very low by default until visual
fixtures prove it does not hide meaningful small windows.

Dry-run note: portal candidates must not depend on `showPortalPolygons`. The existing portal point
path lives in `debug-overlays.ts`, but that model only exists for diagnostics and only includes
portals from the current `StructuredInteriorSceneModel`. Portal aperture extraction must become a
shared world-display helper consumed by both debug overlays and portal view group derivation.

## Portal-Composited Interior Cell Selection

Do not render all loaded env cells inside each portal stencil.

First implementation:

```text
portal group seed:
  linked entry env cell
  plus building/outdoor portal stab list if available

expansion:
  use visibleCellIds closure
  apply existing max cell and max depth limits
  keep deterministic ordering
```

`seenOutside` should be treated as an eligibility/context hint, not the complete render set.

Interpretation:

- `seenOutside` means an env cell can see outside.
- Physical visibility is reciprocal through the aperture, so it can indicate the cell may be
  externally visible.
- The actual exterior portal view still depends on aperture visibility, facing, clipping, and the
  env-cell visible/stab closure.

The first implementation can use `seenOutside` to prioritize or validate candidate entry cells, but
it should not render every `seenOutside` cell globally.

This restriction applies only to the portal-composited pass. Browser/free-camera diagnostic
rendering may still draw all loaded env cells outside the portal mask so users can inspect the whole
level without simulation residency.

Indoor static objects are part of the same selection problem as env-cell shell geometry. The current
outdoor static renderable scene can include indoor static objects for linked outdoor interiors. The
portal-composited path must either group those indoor static renderables by the same portal view
groups or exclude them from the exterior opaque pass. Otherwise benches, statues, and props can draw
outside the portal mask even when the env-cell shell is correctly constrained.

## Free-Camera Versus Residency

Outdoor portal rendering must not require runtime residency.

Separate:

```text
render coverage: static assets loaded for browser rendering and diagnostics
simulation residency: current landblock/env-cell of a moving body
```

Browser/free-camera mode can derive portal groups from:

- camera frame
- outdoor landblock coverage
- prepared static renderable/building portal metadata
- prepared indoor env-cell topology
- prepared environment geometry

Browser walkabout mode and future client mode can later provide portal groups using simulator or
runtime residency, but the renderer pass should be the same after group derivation.

## Stencil Strategy

Start with non-recursive portal rendering.

Simplest viable strategy:

```text
all visible outdoor portal apertures write stencil = 1
all linked interior cells render where stencil == 1
```

This is acceptable only if all visible portals share the same interior render set, or if leakage
between multiple visible portals is not noticeable in early diagnostics.

Preferred first production strategy:

```text
for each visible portal group:
  clear stencil or reserve a stencil ref
  write that group's aperture
  render that group's interior cells where stencil == group ref
```

Tradeoff:

- clearing and rendering per group is simpler and avoids cross-portal leakage
- allocating refs can batch multiple groups but is limited by stencil bit depth and requires more
  state management

Start with per-group stencil rendering unless performance data shows it is too expensive.

## Three.js State Requirements

Renderer creation must request stencil support:

```ts
new WebGLRenderer({ antialias: true, alpha: true, stencil: true })
```

Implementation must explicitly restore state after each pass:

- color write
- depth test/write
- stencil test/write/op/ref/mask
- scene/object visibility masks or layers
- clear depth/stencil behavior

Prefer named helper functions around pass state transitions. Do not hide stencil behavior inside
ordinary mesh material construction.

Candidate object organization:

```text
scene
  lights
  exteriorRoot
    terrain meshes
    static outdoor meshes
  portalMaskRoot
    aperture meshes
  portalInteriorRoot
    structured interior meshes used by portal groups
  debugOverlayRoot
```

Existing chunk roots should remain the spatial placement mechanism. Pass roots should organize
rendering behavior, not replace chunk-local placement.

## Spatial And Picking Considerations

- Portal apertures should remain spatial-index items for diagnostics and picking.
- Portal mask meshes should not become pick targets unless intentionally wired to the same portal
  metadata.
- Spatial frustum queries can be reused to reject offscreen portal candidates, but the renderer
  should still perform final camera-facing checks because portal facing depends on polygon plane
  semantics.
- Debug overlays should draw independently of whether the portal was used as a stencil mask.
- Selected portal overlays should remain visible even when the portal is back-face culled from the
  mask pass.
- Spatial culling should feed candidate derivation, not only mutate Three.js `object.visible`.
  Current renderer culling sets visibility on meshes and debug overlay objects before rendering.
  Portal view group selection should use the spatial query results directly so a diagnostic overlay
  toggle or temporary object visibility state cannot suppress portal masking.

## Asset Coverage Requirements

The browser scene coordinator must be able to request assets needed for visible outdoor portal
groups:

- entry env-cell asset
- environment asset for the entry env-cell's `environmentId`
- visible/stab closure env-cell assets up to configured limits
- environment assets for those cells
- surface dependencies already handled by existing prepared payloads

Do not block exterior rendering on missing portal assets. Missing portal interiors should degrade to
normal exterior rendering plus diagnostics:

```text
portal candidate found
linked env cell missing -> request it, skip interior pass for this group this frame
environment missing -> request it, skip only affected cells
portal aperture missing -> report diagnostic, skip mask
```

## Implementation Phases

### Phase 0: Aperture Source Model

- Add an app-local `PortalAperture`/`PortalApertureSource` helper near `world-display`, separate
  from debug overlays.
- Represent aperture id, source env cell/building portal id, chunk placement, local points,
  resolved target env cell ids, outside-transition flag, and enough side/plane information for
  facing checks.
- Reuse this helper from debug overlays to avoid two portal polygon extraction paths.
- Decide whether aperture geometry is derived from loaded indoor env-cell portal polygons or exposed
  directly by the Tauri adapter from outdoor building source data.
- Add synthetic tests with inline DTOs/assets. Do not depend on DAT/HBA loading.

Progress:

- Completed in `apps/holtburger-3d/src/lib/world-display/portal-apertures.ts`.
- Added `PortalAperture`, `PortalAperturePlane`, `PortalApertureTargetStatus`, and
  `derivePortalAperturesFromStructuredInteriorScene`.
- Refactored debug overlays to consume the aperture helper rather than owning portal point
  extraction and target classification.
- Added synthetic unit coverage in
  `apps/holtburger-3d/src/lib/world-display/portal-apertures.test.ts`.
- Verified with focused portal/debug tests, `npm run check`, and `npm run lint:ts`.
- Source proof completed against ACE, Holtburger Rust loaders, and retail decompile references.

Decisions and course corrections:

- The first aperture source is loaded indoor env-cell portal polygons joined through the prepared
  environment cell structure. This matches the data the app already has and avoids inventing outdoor
  building aperture fields before proving they exist in source data.
- Outdoor building portal payloads are topology-only inputs. ACE `CBldPortal` and Holtburger
  `PortalInternal`/`StaticOutdoorBuildingPortal` carry flags, target cell/portal ids, and stab
  lists, but no polygon id, vertices, or plane. Retail `CBldPortal` likewise has side/target/stab
  fields and no portal polygon pointer. They can identify linked env cells and stab lists, but they
  are not authoritative aperture geometry.
- Env-cell portal data is the authoritative aperture source currently proven in source data. ACE
  `CellPortal` carries `PolygonId`, `EnvCell` carries `CellPortals`, and `CellStruct` carries the
  portal polygon ids plus polygon/vertex data. Retail mirrors this with `CCellPortal::portal` and
  `CCellStruct::portals`.
- Debug overlays are now a consumer of aperture data, not the source of aperture data. Future portal
  view group derivation should call the same helper or a sibling helper, regardless of whether
  `showPortalPolygons` is enabled.
- Plane data is currently derived from render-space aperture points and is explicitly marked
  `derived-from-render-points`. Phase 5 must validate this against AC portal side semantics before
  using it as the final facing authority.

### Phase 1: Portal View Group Model

- Add a browser/app-local model for outdoor portal view groups.
- Derive candidate groups from outdoor static scene/building portal topology plus the source-neutral
  aperture model.
- Include linked entry env-cell id, portal id, render chunk, aperture points, target status, and
  requested interior env-cell ids.
- Join topology to apertures by linked env-cell/outside-transition facts first. Do not assume the
  outdoor building portal id and env-cell portal id are the same namespace.
- Treat missing aperture geometry as a skip-with-diagnostic condition, not a hard failure, because
  the first aperture source depends on linked env-cell/environment assets being loaded.
- Add tests with synthetic assets. Do not depend on DAT/HBA loading.

Progress:

- Completed in `apps/holtburger-3d/src/lib/world-display/outdoor-portal-view-groups.ts`.
- Added `OutdoorPortalViewGroup`, `OutdoorPortalViewGroupModel`, and diagnostics for topology
  portals, aperture candidates, created view groups, missing apertures, malformed portal polygons,
  and truncated interior coverage.
- Outdoor portal group derivation now scans active outdoor static scene building portals, joins
  them to loaded env-cell outside-transition apertures by linked env-cell id, and builds deterministic
  browser/free-camera portal view groups.
- Interior cell membership for a group seeds from the entry aperture env cell, the outdoor topology
  portal's linked env cells, and env-cell-shaped stab-list entries, then reuses
  `deriveStructuredInteriorCoverage`.
- Exported `PreparedOutdoorStaticSceneBuildingPortal` so the app-local model can type the topology
  records directly instead of using an anonymous payload shape.
- Added synthetic coverage in
  `apps/holtburger-3d/src/lib/world-display/outdoor-portal-view-groups.test.ts`.
- Verified with `npm run test:ts -- src/lib/world-display/outdoor-portal-view-groups.test.ts
  src/lib/world-display/portal-apertures.test.ts`.

Decisions and course corrections:

- The join deliberately uses linked env-cell ids plus outside-transition aperture facts. It does
  not assume outdoor building portal ids and env-cell portal ids share a namespace.
- Missing aperture geometry is a diagnostic skip. This is expected when the linked env-cell or
  environment/cell-structure payload has not been loaded yet.
- Non-outside env-cell apertures are filtered before group creation. Phase 1 only models
  outdoor-transition masks; interior-to-interior portal recursion remains a non-goal.
- Stencil refs are assigned deterministically after group creation. Phase 4 may replace this with a
  per-group clear path, but the model already carries a stable ref for the renderer.

### Phase 2: Asset Request Coverage

- Extend browser asset planning so visible portal groups request their entry env cells and visible
  closure dependencies.
- Reuse `deriveStructuredInteriorCoverage` where it fits.
- Keep the existing broad outdoor-linked interior request path as a diagnostic/free-camera coverage
  policy until portal-specific requests prove complete enough to replace it.
- Keep existing free-camera outdoor coverage behavior when no portal groups are visible.
- Add deterministic tests for missing/loaded portal dependencies.

Progress:

- Completed in `apps/holtburger-3d/src/lib/assets/scene-asset-request-planner.ts`.
- Added `deriveOutdoorPortalInteriorSeedEnvCellIds`, which derives portal interior seeds from
  active outdoor static scene topology by including linked env cells plus env-cell-shaped stab-list
  entries.
- Updated outdoor structured-interior coverage requests, scene coverage asset-id derivation, static
  renderable asset requests, and free-camera static renderable scene derivation to use the portal
  interior seed set.
- Added deterministic synthetic coverage in
  `apps/holtburger-3d/src/lib/assets/scene-asset-request-planner-cache.test.ts` for stab-list env
  cells, visible-cell closure expansion, prepared environment requests, and pending asset exclusion.
- Verified with `npm run test:ts -- src/lib/assets/scene-asset-request-planner-cache.test.ts
  src/lib/world-display/outdoor-portal-view-groups.test.ts`.

Decisions and course corrections:

- Phase 2 still preserves the broad browser/free-camera outdoor-linked interior request path. The
  change enriches its seed set to match the portal view group model instead of replacing it with
  visibility-gated requests before Phase 5 culling exists.
- Stab-list entries whose low 16 bits are `0xffff` are treated as outdoor landcells and excluded
  from structured-interior requests.
- Missing env-cell assets remain ordinary requests, not render blockers. Environment assets are
  requested when the relevant env-cell metadata payload is already prepared and exposes an
  `environmentId`.

### Phase 3: Renderer Pass Structure

- Introduce explicit pass roots or render layers for exterior, portal masks, portal interiors, and
  debug overlays.
- Replace the single `renderer.render(scene, camera)` call with a named pass sequence.
- Preserve current output when no portal view groups exist.
- Preserve browser/free-camera whole-level interior visibility as a separate diagnostic pass or
  mode, rather than folding it into the portal-composited pass.
- Split render participation for outdoor static renderables, indoor static renderables, structured
  interior shells, portal masks, and debug overlays. The current `StaticRenderableSceneModel`
  already mixes outdoor and indoor static renderable parts, so the renderer cannot treat every
  static renderable as exterior opaque.
- Add renderer-level tests around pass model derivation where possible. If direct WebGL testing is
  impractical, keep stateful Three.js calls isolated behind small functions.

Progress:

- Completed initial pass structure in
  `apps/holtburger-3d/src/lib/world-display/render-passes.ts` and
  `apps/holtburger-3d/src/lib/world-display/world-display-renderer.ts`.
- Added named render layers for exterior opaque, portal mask, portal-composited interior,
  diagnostic interior, and debug overlays.
- Replaced the implicit single `renderer.render(scene, camera)` call with a named pass loop derived
  by `deriveWorldRenderPasses`.
- Split static renderable participation by kind: outdoor/building/generated static renderables use
  the exterior layer, while indoor static renderables use the diagnostic interior layer.
- Structured interior shell meshes now participate in the diagnostic interior layer, and debug
  overlays participate in their own layer.
- Added tests in `apps/holtburger-3d/src/lib/world-display/render-passes.test.ts`.
- Verified with `npm run test:ts -- src/lib/world-display/render-passes.test.ts
  src/lib/assets/scene-asset-request-planner-cache.test.ts
  src/lib/world-display/outdoor-portal-view-groups.test.ts`.

Decisions and course corrections:

- The diagnostic interior pass does not clear depth after the exterior pass. This preserves the
  current broad free-camera diagnostic behavior without making interiors draw through terrain before
  the Phase 4 stencil path exists.
- Renderer-level WebGL behavior remains isolated in `WorldDisplayRenderer`; the tested portion is
  the pure pass/layer derivation and renderable classification.
- Chunk roots remain the spatial placement mechanism. Render layers express pass participation and
  do not replace chunk-local placement.
- Portal mask and portal-composited layers are defined but not populated yet. Phase 4 will add mask
  meshes, stencil state, and per-group interior rendering.

### Phase 4: Stencil Portal Mask Rendering

- Enable stencil on the WebGL renderer.
- Build aperture meshes from portal polygon points.
- Implement per-group stencil write and interior render passes.
- Ensure stencil state is cleared/restored before debug overlays.
- Set explicit clear behavior for multi-pass rendering. The current renderer relies on the default
  single `renderer.render(scene, camera)` clear path; portal rendering should deliberately control
  color, depth, and stencil clears.
- Add a browser screenshot/manual verification checklist for underground openings and building
  door/window portals.

Progress:

- Completed initial stencil rendering in
  `apps/holtburger-3d/src/lib/world-display/world-display-renderer.ts`.
- `WorldDisplay` now accepts `OutdoorPortalViewGroupModel`, and `BrowserWorldDisplay.svelte`
  derives that model from the active outdoor building landblocks plus loaded structured interior
  aperture data.
- The Three.js renderer now requests a stencil buffer with
  `new WebGLRenderer({ antialias: true, alpha: true, stencil: true })`.
- Portal aperture mask meshes are built from portal polygon points, attached to the existing
  render-chunk roots, and rendered on the portal-mask layer with color writes disabled, depth writes
  disabled, depth testing enabled, and stencil replacement enabled.
- Portal-composited interiors render per portal group with stencil equality against that group's
  stencil ref.
- Structured interior shells and indoor static renderables participate in both the diagnostic
  interior layer and the portal-composited interior layer.
- Portal rendering restores mask visibility, interior visibility, stencil material state, and
  spatial visibility before the diagnostic/debug passes.
- Verified with focused unit tests and `npm run check`.
- Follow-up debugging found that this first implementation is only an aperture mask for interior
  draws. It does not reveal interiors through terrain that has already written color/depth in the
  exterior pass, so underground openings can still appear covered by terrain even when their portal
  mask exists.

Decisions and course corrections:

- Phase 4 renders all derived portal groups; frustum, facing, and screen-area culling remain Phase 5
  work.
- Portal mask writes use normal depth testing, so nearer exterior terrain/building geometry can
  occlude an aperture mask. This matches the plan's initial depth policy.
- The diagnostic interior pass remains active after portal compositing so browser/free-camera mode
  still supports whole-level inspection.
- Interior meshes can be rendered twice in browser/free-camera mode: once through the portal mask
  and once in the diagnostic pass. This is intentional for now and should be revisited when a UI
  mode switch or walkabout/client mode disables broad diagnostic interiors.
- The renderer must add an explicit portal reveal/depth policy before this phase can be considered
  visually correct for underground transitions. Options to investigate include a portal-depth reset
  pass, a separate interior render target composited through the aperture, or source-backed terrain
  cutout geometry. A stencil equality test alone is insufficient because it does not remove
  exterior pixels already rendered at the aperture.

Manual verification checklist:

- Underground dungeon entrance: from outside, terrain must not cover the aperture. The current
  stencil-only implementation fails this check when terrain has already rendered over the portal.
- Building door/window from outside: linked interior shell and indoor statics appear through the
  aperture rather than drawing as an opaque portal polygon wall.
- Same portal viewed from the invalid/back side: before Phase 5, it may still render; after Phase 5,
  facing culling should reject it.
- Multiple nearby exterior portals: each portal should render only its own interior group without
  obvious leakage through a different aperture.
- Debug portal overlays enabled and disabled: overlay visibility must not control whether portal
  stenciling runs.

### Phase 5: Visibility And Facing Culling

- Add camera-frustum, portal-plane side, and screen-area culling.
- Derive portal facing from source-backed AC polygon plane/side semantics where available. If the
  first implementation computes a normal from aperture points, explicitly validate the result
  against known `PortalSide`/outside-transition fixtures before relying on it for culling.
- Revisit the Phase 0 `PortalAperturePlane.source` marker. Keep render-point-derived planes as a
  provisional input unless AC polygon plane/side data is added to the aperture model.
- Add synthetic tests for front-facing and back-facing candidate rejection.
- Keep debug overlays independent from mask culling.

Progress:

- Completed initial renderer-local portal culling in
  `apps/holtburger-3d/src/lib/world-display/portal-visibility.ts` and
  `apps/holtburger-3d/src/lib/world-display/world-display-renderer.ts`.
- Added frustum rejection using the current Three.js camera and a world-space aperture bounding box.
- Added front/back facing rejection from the transformed aperture polygon winding.
- Added projected screen-area rejection using a clamped projected bounding box with a low
  `1px` threshold.
- The renderer now filters portal groups immediately before stencil rendering, after mask meshes
  have current chunk/world transforms.
- Added synthetic tests in `apps/holtburger-3d/src/lib/world-display/portal-visibility.test.ts`
  for visible, back-facing, and too-small aperture cases.
- Verified with `npm run test:ts -- src/lib/world-display/portal-visibility.test.ts
  src/lib/world-display/render-passes.test.ts` and `npm run check`.

Decisions and course corrections:

- Culling is renderer-local for now because it depends on the active camera, viewport size, and
  current render-chunk transforms.
- The facing check currently uses transformed aperture winding. This keeps the implementation
  testable, but it is still provisional because Phase 0 plane data is derived from render points.
  A future refinement should compare this against AC portal side semantics before raising the
  screen-area threshold or relying on culling as a correctness boundary.
- Debug overlays remain independent. Selected portal outlines can still be drawn by the debug pass
  even when a portal is rejected for stencil rendering.

### Phase 6: Diagnostics And Tuning

- Add lightweight metrics:
  - candidate outdoor portal count
  - visible portal group count
  - masked interior cell count
  - skipped groups by reason
- Add panel diagnostics without turning them into user instructions.
- Tune max portal groups, visible-cell depth, and screen-area threshold.

Progress:

- Completed initial portal stencil diagnostics in
  `apps/holtburger-3d/src/lib/world-display/renderer-contract.ts`,
  `apps/holtburger-3d/src/lib/world-display/world-display-renderer.ts`, and
  `apps/holtburger-3d/src/pages/BrowserWorldDisplay.svelte`.
- Added `WorldRenderPortalMetrics` with candidate topology portal count, visible portal group count,
  masked interior env-cell count, source/model skip counts, and render-time culling skip counts.
- The renderer now records frustum, back-facing, and small-screen-area skips from the actual
  camera-space culling pass.
- The browser panel now includes a compact `Stencil` row that reports visible groups, candidate
  groups, masked env cells, and total skipped groups.
- Verified with `npm run check`.
- Removed temporary localStorage render-mode diagnostics that were added during blank-frame
  investigation. The app now has one production render path again.
- Removed the hidden per-frame portal-group cap that had been added as a speculative performance
  patch. Portal count tuning should be reintroduced only with an explicit policy and metrics.

Decisions and course corrections:

- The screen-area threshold remains low at `1px`. This keeps the optimization from hiding small
  windows until visual fixtures prove a higher threshold is safe.
- Max env-cell and visible-cell depth tuning continues to use the existing browser controls. No new
  portal-specific UI control was added in this phase.
- Metrics report both model-time skips and render-time culling skips so missing asset/aperture
  problems do not get conflated with camera visibility.
- Debug-only pass bisection is useful while diagnosing renderer state, but it should not remain as
  localStorage-controlled production behavior.

### Phase 7: Walkabout/Client Integration Hook

- Define the adapter point where simulator/runtime residency can provide portal view groups.
- Do not implement walkabout traversal here.
- Ensure browser/free-camera static derivation remains available for diagnostics.

Progress:

- Completed in `apps/holtburger-3d/src/lib/world-display/outdoor-portal-view-groups.ts`.
- Added `OutdoorPortalViewGroupSource` with `browser-free-camera`, `walkabout`, and `runtime`
  sources.
- `deriveOutdoorPortalViewGroups` now accepts an optional source, defaulting to
  `browser-free-camera`.
- Added synthetic test coverage proving source injection works.
- Verified with `npm run test:ts -- src/lib/world-display/outdoor-portal-view-groups.test.ts` and
  `npm run check`.

Decisions and course corrections:

- The renderer integration point is the `OutdoorPortalViewGroupModel` prop on `WorldDisplay`.
  Browser/free-camera static derivation is one producer; future walkabout/runtime residency can be
  another producer of the same model.
- No walkabout traversal, residency mutation, or runtime portal recursion was implemented in this
  phase.

### Phase 8: Touchpoint Cleanup And Consolidation

After the stencil path works, clean up the code around the touched seams before calling the work
complete.

Goals:

- Remove compatibility shims or temporary reexports introduced during the implementation.
- Consolidate duplicate portal geometry, visible-cell closure, render-pass, and diagnostic derivation
  logic.
- Delete obsolete code paths that were kept only to make the staged migration easier.
- Replace placeholder/hollow abstractions with either concrete narrow helpers or no abstraction.
- Rename types and functions whose names still describe the pre-stencil behavior.
- Remove legacy comments or docs that imply portal polygons are renderable wall geometry.
- Keep browser/free-camera policy app-local, but do not duplicate the same policy across page,
  asset-planning, scene-model, and renderer modules.

Touch points to audit:

- `BrowserWorldDisplay.svelte` scene composition and browser-mode policy.
- Asset request planning and streaming controller portal dependency code.
- Outdoor portal view group derivation.
- Structured interior scene derivation reused by portal-composited interiors.
- Debug overlay portal geometry helpers.
- `WorldDisplayRenderer` pass-state helpers and render roots/layers.
- Render spatial index portal item construction.
- Tests that still encode old single-scene or portal-as-overlay assumptions.
- Hollow tests that assert wiring without behavior, or dead-code-path tests retained only to protect
  transitional implementation scaffolding.

Cleanup criteria:

- No duplicated portal aperture extraction logic.
- No separate "temporary" and "real" portal view group types.
- No render-pass state hidden in ordinary mesh/material constructors.
- No browser-only policy promoted into shared crates.
- No stale plan/doc references claiming the old single-render-pass model is current.
- No tests retained solely for backwards compatibility with removed behavior.
- No hollow tests or dead-code-path rejection tests remain after the corresponding shim, fallback,
  or transitional branch is removed.

Progress:

- Completed cleanup across the touched TypeScript and plan-doc surfaces.
- Removed the unused linked-only `deriveOutdoorLinkedInteriorEnvCellIds` compatibility helper and
  kept `deriveOutdoorPortalInteriorSeedEnvCellIds` as the single outdoor portal interior seed path.
- Removed the unused `createEmptyOutdoorPortalViewGroupModel` future convenience factory and its
  hollow assertion test.
- Removed unreachable `skippedUnsupportedTargetCount` diagnostics. Outdoor portal view groups are
  derived only from outside-transition apertures; a non-outside aperture join is now treated as an
  internal logic error instead of a dead skip path.
- Tightened `staticRenderableLayerForKind` to accept `StaticRenderablePart["kind"]` instead of an
  open string.
- Updated the earlier phase notes so the plan no longer claims retained helpers or diagnostics that
  cleanup removed.
- Removed the temporary render-mode toggles, verbose pass summaries, WebGL state dumps, and portal
  group cap that were introduced during regression diagnosis.
- Removed the stateful object-visibility pass bisection that had been added during diagnosis and
  returned ordinary passes to the named render-layer model from Phase 3.
- Recorded the remaining underground portal reveal gap as unfinished work instead of treating the
  current stencil-only implementation as complete.

Decisions and course corrections:

- The runtime/walkabout hook remains the `OutdoorPortalViewGroupSource` plus the
  `OutdoorPortalViewGroupModel` renderer prop. No empty-model factory is needed until a real
  runtime producer exists.
- The source-backed aperture extraction path remains single-sourced through
  `derivePortalAperturesFromStructuredInteriorScene`; debug overlays and portal view groups consume
  it rather than duplicating point extraction.
- The blank-frame regression was caused by multi-pass rendering with `scene.background` set: later
  passes could clear color even when they drew no geometry. The renderer now owns the clear color
  with `renderer.setClearColor(...)` and keeps scene background unset so only explicit pass clears
  affect the framebuffer.

### Phase 9: Aperture Depth Reset Research

The current portal pass writes stencil and then renders linked interiors through that stencil. That
is not enough for underground/outside-transition apertures where exterior terrain has already
written nearer depth over the opening. Before implementing the production reset pass, prove which
WebGL/Three.js depth-reset technique is actually available in the Tauri/browser renderer and record
the chosen approach.

Source-backed basis:

- Retail `PView::DrawCells` draws landscape before env cells, conditionally clears depth after
  portal polygons were drawn, then draws env cells later in the same routine:
  `acclient-eor-source/acclient.c:441096`,
  `acclient-eor-source/acclient.c:441099`,
  `acclient-eor-source/acclient.c:441210`.
- Retail `D3DPolyRender::DrawPortalPolyInternal` renders clipped portal polygons with textures
  disabled, `DEPTHTEST_ALWAYS`, mode-controlled depth writes, and a forced far depth value in one
  mode:
  `acclient-eor-source/acclient.c:433593`,
  `acclient-eor-source/acclient.c:433600`,
  `acclient-eor-source/acclient.c:433662`.
- Retail building portal rendering runs drawing-BSP portal-only passes for blank portals and
  view-through portals:
  `acclient-eor-source/acclient.c:436520`,
  `acclient-eor-source/acclient.h:4673`.
- `PView::ConstructView` also performs portal side checks, clips the portal view, copies that view
  into the linked env cell, and draws the portal polygon except in the view-through-only mode:
  `acclient-eor-source/acclient.c:442070`,
  `acclient-eor-source/acclient.c:442079`,
  `acclient-eor-source/acclient.c:442084`,
  `acclient-eor-source/acclient.c:442093`.
- ACViewer is not a parity model for this behavior. It draws terrain before env-cell batches and
  skips `NoPos` polygons, but it does not implement retail portal view/depth composition:
  `ACViewer/ACViewer/Render/Buffer.cs:510`,
  `ACViewer/ACViewer/Render/Buffer.cs:513`,
  `ACViewer/ACViewer/Render/R_CellStruct.cs:120`.

Research goals:

- Prove whether the active renderer is WebGL2 and whether a fragment-depth write path is available
  through Three.js in the app's runtime environment.
- Build a tiny synthetic renderer experiment that does not depend on DAT/HBA loading:
  - exterior plane writes depth in front of a rectangular aperture
  - portal stencil marks the aperture
  - candidate depth-reset method runs only in the aperture
  - interior plane behind the exterior plane renders only inside the aperture with normal depth
- Compare candidate reset methods:
  - shader writes explicit far depth with `gl_FragDepth`
  - aperture geometry rendered at controlled clip-space/depth with depth function always
  - any Three.js-supported depth material path that can write far depth without color
- Confirm whether WebGL clears can or cannot be used safely for aperture-local depth behavior in our
  renderer. Do not assume stencil-scoped clears are portable.
- Confirm how the chosen method interacts with:
  - colorWrite disabled
  - depthWrite enabled
  - stencil equality
  - depth function restoration after the pass
  - multisampling/antialiasing in the Tauri/browser renderer
- Document the chosen production approach, rejected approaches, and required renderer capability
  checks before Phase 10 implementation.

Modern renderer approach:

- Prefer a WebGL2 shader-based depth reset using aperture geometry and `gl_FragDepth`/Three.js
  `ShaderMaterial` if capability checks prove the Tauri/browser renderer supports it.
- If WebGL2 explicit fragment depth is unavailable, evaluate a fallback that renders aperture
  geometry at a controlled far clip-space depth with depth write enabled and depth function always.
- Do not use `renderer.clear(false, true, false)` as the primary solution. A WebGL clear is not an
  aperture-shaped operation; it would reset the full depth buffer unless constrained by another
  mechanism, and stencil-scoped clears are not portable enough to be the foundation.
- Do not disable depth testing for portal interiors as a production solution. That may be useful as
  a one-off diagnostic proof, but it would let interiors overdraw exterior occluders incorrectly.
- Do not physically cut terrain triangles in this phase. Retail evidence points to portal/depth
  behavior, and ACViewer's simplified viewer path is not evidence that terrain data contains
  source-backed cutouts.

Research deliverables:

- A small app-local probe or harness entry point that can run in the browser/Tauri renderer and
  report:
  - WebGL version
  - fragment-depth support path
  - stencil buffer availability
  - whether the synthetic depth-reset scene renders the expected aperture reveal
- A concise update to this plan recording the selected implementation route for Phase 10.
- Any throwaway probe code should either live under an explicit debug/harness path or be removed
  after the finding is documented. Do not leave hidden production branches.

Testing and verification:

- Add unit coverage only for pure capability-selection helpers if such helpers are introduced.
- Do not write tests for debug-oriented logging.
- Use a synthetic visual/probe scene rather than DAT/HBA fixtures.
- The research phase is complete only when it produces an explicit go/no-go for the Phase 10
  production path.

Non-goals for this phase:

- Production portal renderer changes.
- UI controls for portal modes.
- Full recursive retail portal rendering.
- Terrain mesh mutation or source-generated terrain hole carving.

Decisions to record before Phase 10:

- Chosen depth-reset technique.
- Required WebGL/Three.js capability checks and failure behavior.
- Whether the implementation can be purely material/shader based or requires a renderer-level helper.
- Whether the synthetic probe should remain as a developer-only diagnostic fixture.

Progress:

- Added an app-local developer probe at `apps/holtburger-3d/src/dev/PortalDepthResetProbe.svelte`
  and `apps/holtburger-3d/src/dev/portal-depth-reset-probe.ts`.
- The probe is reachable at `/?probe=portal-depth-reset` and bypasses Tauri host startup. It is an
  explicit developer entry point rather than a hidden render-mode branch in the production world
  renderer.
- The fixture uses only synthetic Three.js geometry:
  - a front exterior plane that writes color/depth,
  - a rectangular aperture mesh that writes stencil,
  - a shader-based aperture depth reset constrained by stencil equality,
  - a rear interior plane rendered afterward with normal depth testing and the same stencil equality.
- The probe samples framebuffer pixels and reports:
  - whether the control scene reveals the rear plane without a reset,
  - whether the reset scene reveals the rear plane inside the aperture,
  - whether an outside-aperture pixel preserves exterior color,
  - WebGL version, renderer/vendor strings, stencil bits, fragment-depth path, route, and verdict.
- Headless Chromium/Vite result on 2026-05-17:
  - verdict: `go`
  - route: `shader-fragment-depth-aperture-reset`
  - WebGL: `webgl2`
  - fragment depth path: `webgl2-gl-frag-depth`
  - stencil bits: `8`
  - renderer: ANGLE SwiftShader via Chromium headless
  - control reveal: blocked
  - reset reveal: visible
  - exterior preserved outside aperture: yes
- Tauri webview manual result on 2026-05-17:
  - verdict: `go`
  - route: `shader-fragment-depth-aperture-reset`
  - WebGL: `webgl2`
  - fragment depth path: `webgl2-gl-frag-depth`
  - stencil bits: `8`
  - renderer: Apple GPU
  - vendor: Apple Inc.
  - control reveal: blocked
  - reset reveal: visible
  - exterior preserved outside aperture: yes
- Verification commands:
  - `npm run check`
  - `npm run lint:ts`
  - `npm run dev`
  - `/opt/google/chrome/chrome --headless=new --disable-gpu-sandbox --no-sandbox --enable-unsafe-swiftshader --dump-dom 'http://127.0.0.1:1420/?probe=portal-depth-reset'`
  - `npm run --prefix apps/holtburger-3d/ tauri:dev`, then
    `window.location.assign("/?probe=portal-depth-reset")` in the Tauri devtools console

Decisions:

- Use a shader/material aperture depth reset for Phase 10. The Tauri webview produced the required
  `go` verdict.
- The selected route writes far depth from a `ShaderMaterial` fragment shader using `gl_FragDepth`
  and `GLSL3`, with color writes disabled, depth writes enabled, `AlwaysDepth`, and stencil equality
  against the active portal aperture ref.
- The production renderer should fail hard or surface a clear blocking diagnostic if WebGL2,
  stencil bits, or the synthetic aperture reset capability is unavailable. It should not silently
  fall back to drawing interiors without depth testing.
- The reset can be implemented as a renderer-level helper that reuses existing aperture meshes and
  swaps only material/state for the depth reset pass. It does not require terrain mutation.
- Keep the synthetic probe as a developer-only diagnostic fixture until Phase 10 is implemented and
  verified against real underground/outside-transition portals. It should not grow production
  toggles or asset-loading dependencies.

Course corrections:

- The probe proves that a full depth clear is not necessary for the desired browser path. A
  stencil-constrained aperture draw can update only the masked pixels' depth while preserving
  exterior depth outside the aperture.
- Browser proof was not treated as sufficient. The selected production route is based on the Tauri
  webview also reporting `go`.

### Phase 10: Aperture-Local Depth Reset Implementation

Implement the production pass selected in Phase 9.

Implementation goals:

- Keep the existing stencil aperture pass as the aperture-membership mask.
- Add a new renderer-local `portal-depth-reset` pass between `portal-stencil-mask` and
  `portal-composited-interior`.
- Reuse the same source-backed aperture meshes as the stencil pass; do not create a second aperture
  extraction path.
- Render the aperture depth reset with color writes disabled, stencil equality enabled for the
  active portal group, and depth writes enabled.
- Use the Phase 9-selected shader/material strategy to write far depth across the portal aperture
  footprint so subsequent linked interior fragments can pass normal depth testing inside the
  aperture.
- Preserve normal exterior depth outside the aperture. Exterior geometry outside the stencil must
  continue to occlude normally.
- Keep linked interior rendering on normal depth test/write after the reset, so interior walls,
  props, and env-cell shells still sort with each other.
- Keep broad browser/free-camera diagnostic interiors separate from portal-composited interiors.
  Browser diagnostic visibility should not be mistaken for retail-like aperture visibility.

Required pass order after this phase:

```text
exterior opaque
for each visible outdoor portal group:
  aperture stencil write
  aperture-local depth reset constrained by stencil
  linked interior env cells constrained by stencil with normal depth
free-camera diagnostic interiors, if enabled
debug overlays
```

Portal visibility requirements:

- The depth reset must run only for portal groups that pass the same frustum, facing, screen-area,
  and aperture-geometry checks as the stencil mask.
- The reset must be per portal group or otherwise use non-overlapping stencil refs. Multiple
  portals cannot share one reset mask unless batching preserves each group's linked-interior
  isolation.
- If a portal is culled as back-facing/offscreen/too small, neither the stencil mask nor the depth
  reset should render.

Testing and verification:

- Add focused tests for pass derivation so `portal-depth-reset` is ordered after
  `portal-stencil-mask` and before `portal-composited-interior`.
- Add focused tests for capability gating if production code branches on renderer capabilities.
- Add a synthetic renderer fixture or retained developer probe from Phase 9 that models the failure
  case: exterior plane writes depth in front of an aperture; portal interior geometry behind it
  becomes visible only after the aperture-local depth reset.
- Fail hard with a clear diagnostic if the renderer cannot support the Phase 9-selected production
  path.
- Manual scene checks:
  - underground dungeon entrance from outside: terrain no longer covers the portal aperture.
  - building door/window from outside: linked interior remains visible through the aperture.
  - same portal from the invalid/back side: no stencil/depth reset/interior draw.
  - multiple nearby portals: interiors do not leak through another portal's aperture.
  - debug portal overlays on/off: overlays do not control stencil/depth reset behavior.

Non-goals for this phase:

- Full recursive retail portal rendering.
- Full `PView::ConstructView` portal-frustum clipping. The stencil aperture clips final pixels, but
  future walkabout/client mode should still add source-backed portal-view clipping for performance
  and closer retail parity.
- Terrain mesh mutation or source-generated terrain hole carving.
- A UI toggle for choosing between old/new portal rendering. The old stencil-only path is an
  incomplete implementation, not a user-facing mode.

Decisions and course corrections:

- Stencil remains the modern browser renderer's aperture-membership mechanism. The new depth reset
  pass supplies the missing retail-like depth behavior.
- Retail parity means matching the visible ordering semantics first: exterior terrain should not
  block linked interior geometry inside a valid portal aperture, while exterior depth should remain
  authoritative outside that aperture.
- Exact implementation parity with retail's D3D path is not required, but the chosen modern
  implementation must explain how it maps to retail's depth-mask/depth-clear behavior.

## Test Strategy

Use synthetic fixtures for unit tests:

- one outdoor portal aperture linked to one env cell
- two visible portal apertures linked to different env-cell sets
- back-facing portal rejected from mask candidates
- aperture-local depth reset ordered between stencil mask and linked interior drawing
- exterior depth in front of an aperture no longer blocks linked interior geometry inside the
  aperture after the depth reset pass
- missing env-cell asset produces a request and no render group
- visible-cell closure respects max depth and max cell limits

Avoid DAT/HBA-dependent tests in frontend unit suites. Source-backed DAT examples can remain in docs
or bespoke harness scripts, but ordinary CI tests should construct DTOs inline.

Manual/visual verification scenes:

- underground dungeon entrance where retail appears to show a terrain opening
- exterior building door/window looking inward
- same portal viewed from the invalid/back side
- multiple nearby exterior portals with different interior cells
- debug overlays enabled and disabled

## Risks And Open Questions

- Three.js stencil state is global and easy to leak between passes. Keep state transitions
  centralized.
- Portal aperture orientation must be derived from source semantics. Using render triangle winding
  may cull the wrong side.
- Current outdoor building portal payloads do not include aperture geometry. Either derive aperture
  geometry from indoor env-cell portal polygons after linked cells load, or add adapter support for
  outdoor portal aperture geometry if source data can provide it.
- Multiple visible portals can leak interiors through each other's masks if a single stencil ref is
  used. Prefer per-group rendering first.
- Transparent effects and debug overlays may need a later pass split.
- The current stencil path does not clear or replace exterior terrain color/depth at underground
  apertures. A reveal/depth strategy is required before underground portal rendering can match the
  retail visual result.
- A shader-based depth reset depends on WebGL2/fragment-depth capability. Capability probing should
  fail explicitly rather than silently falling back to incorrect interior overdraw.
- Existing structured interior scene derivation currently assumes indoor focus or browser-selected
  indoor destination. Outdoor portal groups need a separate interior-through-portal scene model.
- Current static renderable derivation mixes outdoor renderables and indoor static objects. Portal
  rendering must split pass membership or indoor props will remain visible outside masks.
- Browser/free-camera needs a clear policy for when broad diagnostic interior rendering is visible
  alongside portal-composited interiors, so users can inspect whole levels without confusing that
  mode with retail-like portal visibility.
- Free-camera portal group derivation may require asset requests to run ahead of what the current
  static outdoor scene model loads.
- Retail appears to use a depth-mask style portal draw, not necessarily stencil. Stencil is chosen
  because it separates aperture membership from depth ordering in the modern browser renderer.
- Open question: should the first implementation source aperture geometry only from loaded indoor
  env-cell portal polygons, or should the adapter expose outdoor building aperture geometry? The
  adapter path may be more direct for exterior views, but it should be source-backed before adding
  contract fields.

## Done Criteria

- Outdoor free-camera scenes can show linked interior env cells through visible outdoor portal
  apertures.
- Browser/free-camera scenes can still show all loaded env cells for whole-level inspection when
  diagnostic interior rendering is enabled.
- Underground outdoor portals visibly reveal linked interiors instead of leaving exterior terrain
  drawn across the aperture.
- Portal polygons are not ordinary opaque render geometry.
- Back-facing/offscreen portal apertures do not create masks.
- Missing portal/interior assets degrade gracefully and are surfaced in diagnostics.
- Debug portal overlays still work independently from stencil masking.
- Existing terrain, static renderables, structured interior browser focus, picking, and diagnostics
  remain covered by tests.
