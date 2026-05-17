# Holtburger 3D Outdoor Portal Stencil Rendering Plan

Status: Phase 0 complete; Phase 1 not started.

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
  `acclient-eor-source/acclient.c:433532`
- `RenderDeviceD3D::DrawLandCell` draws terrain landcell polygons directly:
  `acclient-eor-source/acclient.c:436408`
- `CLandBlockStruct::ConstructPolygons` constructs normal terrain triangles; no source-backed
  evidence currently indicates that terrain is physically cut around underground openings:
  `acclient-eor-source/acclient.c:339407`
- `PView::ConstructView` culls building/outside portals by portal side and polygon plane before
  constructing the linked view:
  `acclient-eor-source/acclient.c:442041`
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

For Holtburger's WebGL/Three.js renderer, a stencil pass expresses the exterior-portal intent more
clearly:

```text
exterior opaque
portal aperture stencil
interior opaque constrained by stencil
debug overlays
```

Stencil separates aperture membership from depth ordering:

```text
Where is the portal opening on screen?  -> stencil
How do interior surfaces sort internally? -> depth
```

This avoids coupling terrain depth to portal visibility and keeps the terrain mesh faithful to the
source landblock data.

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

3. Portal-composited interior pass
   - structured interior meshes and indoor static renderables grouped by portal view group
   - stencil test enabled for that group's stencil ref
   - normal depth test/write within the masked area

4. Free-camera diagnostic interior pass
   - optional/browser-mode-only pass for loaded structured interiors and indoor static renderables
     outside portal masks
   - used for level inspection, not retail-like exterior portal composition
   - may be disabled in future walkabout/client modes where portal visibility should own interior
     exposure

5. Debug overlay pass
   - cell indicators
   - portal outlines
   - selected portal bounds
   - diagnostic overlays should not accidentally inherit portal stencil state

6. Future transparent/effects pass
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

### Phase 2: Asset Request Coverage

- Extend browser asset planning so visible portal groups request their entry env cells and visible
  closure dependencies.
- Reuse `deriveStructuredInteriorCoverage` where it fits.
- Keep the existing broad outdoor-linked interior request path as a diagnostic/free-camera coverage
  policy until portal-specific requests prove complete enough to replace it.
- Keep existing free-camera outdoor coverage behavior when no portal groups are visible.
- Add deterministic tests for missing/loaded portal dependencies.

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

### Phase 5: Visibility And Facing Culling

- Add camera-frustum, portal-plane side, and screen-area culling.
- Derive portal facing from source-backed AC polygon plane/side semantics where available. If the
  first implementation computes a normal from aperture points, explicitly validate the result
  against known `PortalSide`/outside-transition fixtures before relying on it for culling.
- Revisit the Phase 0 `PortalAperturePlane.source` marker. Keep render-point-derived planes as a
  provisional input unless AC polygon plane/side data is added to the aperture model.
- Add synthetic tests for front-facing and back-facing candidate rejection.
- Keep debug overlays independent from mask culling.

### Phase 6: Diagnostics And Tuning

- Add lightweight metrics:
  - candidate outdoor portal count
  - visible portal group count
  - masked interior cell count
  - skipped groups by reason
- Add panel diagnostics without turning them into user instructions.
- Tune max portal groups, visible-cell depth, and screen-area threshold.

### Phase 7: Walkabout/Client Integration Hook

- Define the adapter point where simulator/runtime residency can provide portal view groups.
- Do not implement walkabout traversal here.
- Ensure browser/free-camera static derivation remains available for diagnostics.

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

## Test Strategy

Use synthetic fixtures for unit tests:

- one outdoor portal aperture linked to one env cell
- two visible portal apertures linked to different env-cell sets
- back-facing portal rejected from mask candidates
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
- Terrain meshes remain intact and are not cut around underground openings.
- Portal polygons are not ordinary opaque render geometry.
- Back-facing/offscreen portal apertures do not create masks.
- Missing portal/interior assets degrade gracefully and are surfaced in diagnostics.
- Debug portal overlays still work independently from stencil masking.
- Existing terrain, static renderables, structured interior browser focus, picking, and diagnostics
  remain covered by tests.
