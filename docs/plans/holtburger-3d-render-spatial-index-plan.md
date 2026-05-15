# Holtburger 3D Render Spatial Index Plan

Status: implemented through the non-instanced renderer-culling slice. The spatial-index substrate, terrain pick migration, portal/cell diagnostic picking, frustum query support, and spatial-index-driven culling for terrain, structured interior meshes, and debug overlays are in place. Static `InstancedMesh` culling remains profiling-gated follow-up work.

Progress log:

- 2026-05-15: Added shared spatial item id helpers for terrain, structured cells, and portals.
- 2026-05-15: Added a narrow TypeScript render spatial index interface and a simple owner-scoped linear implementation with ray picking, frustum queries, kind masks, owner replacement, and missing-item fallback checks.
- 2026-05-15: Added pure spatial scene derivation for terrain plus Phase 13.7 debug cell/portal targets. Static renderables remain intentionally excluded because current rendering batches them into `InstancedMesh` objects by `gfxObjAssetId`.
- 2026-05-15: `BrowserWorldDisplay` now owns concrete index construction and owner-scoped item population from already-derived scene models.
- 2026-05-15: `WorldDisplay` now receives a narrow query interface by dependency injection and routes the existing Ctrl-click terrain landblock pick through the spatial index.
- 2026-05-15: Added browser-owned diagnostic selection for portal and structured-cell spatial picks. Normal clicks against debug targets open a closable, context-sensitive inspector panel and feed selected portal/cell ids back into the debug overlay model for highlighting.
- 2026-05-15: Added conservative frustum query support to the linear spatial index.
- 2026-05-15: Split structured-cell spatial item derivation out of debug overlays so structured mesh culling and picking do not depend on the cell-indicator toggle.
- 2026-05-15: Added spatial-index-driven visibility updates for non-instanced terrain meshes, structured interior meshes, cell debug overlays, and portal debug overlays. Missing index entries fall back to visible.
- 2026-05-15: Debug raycast targets are now gated by browser visibility toggles and owner-filtered to the debug-overlay bucket. Structured-cell mesh culling remains indexed separately from visible cell-indicator pick targets.
- 2026-05-15: Validation passed with `npm run test:ts`, `npm run check`, `npm run lint:ts`, and `npm run build` in `apps/holtburger-3d`.

Course corrections:

- Portal/cell spatial item derivation moved into the first code pass even though inspector UX remains a second-slice deliverable. This keeps geometry/identity derivation centralized from the start and avoids creating a terrain-only helper that would immediately be generalized.
- Terrain ray picking now uses conservative tile bounds rather than exact triangle intersection. This matches the first-slice plan and is sufficient for preserving Ctrl-click landblock destination selection, but it is less precise near tile edges or vertical camera angles than the previous Three.js mesh raycast.
- Structured-cell picking uses transformed cell bounds when available and falls back to the marker sphere when bounds are absent. This makes the visible bounds indicator inspectable without requiring debug overlay Three.js objects to be raycast targets.
- The optional render-object binding sink was removed rather than made real. `WorldDisplay` already owns the non-instanced Three.js object maps, so it can apply culling by mapping those objects to shared spatial item ids without storing renderer handles inside the index.
- Frustum broadphase is now connected to non-instanced visibility toggles. Static `InstancedMesh` culling remains deferred because splitting or partially hiding those batches needs profiling and a separate batch-vs-instance design.
- Debug pick targets use distinct IDs from structured mesh culling targets so hidden debug affordances are not accidentally pickable through always-present render geometry.

## Purpose

The 3D app now has renderer-local scene objects that are not authoritative Rust runtime objects: terrain meshes, static renderables, structured-interior shells, portal diagnostics, cell indicators, and future editor/debug helpers. Browser-mode interactions already need renderer-local picking for landblock focus, and Phase 13.7 exposed portal/cell diagnostics that would benefit from inspectable picks.

The existing approach is ad hoc: `WorldDisplay` raycasts directly against terrain meshes for one browser workflow. That does not scale to portal/cell inspection, static-object picking, renderer-aware frustum culling, or future client/debug tools.

This plan defines a TypeScript-side render spatial index that can serve renderer-local picking and broadphase visibility queries without moving browser-mode policy into `WorldDisplay` and without forcing Rust runtime code to understand browser-only render/debug targets.

## Core Ownership Decision

`BrowserWorldDisplay` may construct the concrete spatial index because it is the current app composition root for the browser world surface.

`WorldDisplay` should not depend on browser-specific behavior. It should receive narrow renderer-facing interfaces by dependency injection. Those interfaces should let it ask neutral renderer-local queries without learning browser actions.

Browser/client wrappers interpret pick results. `WorldDisplay` and the index return neutral renderer identities and metadata only.

Ownership split:

- `BrowserWorldDisplay` or a browser scene controller: browser controls, input gestures, selected inspector item, diagnostic toggles, click meaning, destination changes, and semantic spatial item population from already-derived scene models
- `WorldDisplay`: Three.js scene lifecycle, GPU object lifecycle, non-instanced visibility toggles, and neutral renderer-local pick/frustum queries
- `RenderSpatialIndex`: spatial item storage, broadphase partitioning, query adapters, optional narrowphase pick tests, query masks
- Rust/Tauri runtime: authoritative/session picks only, such as server-known entities or future physics-backed gameplay queries

Population split:

- Scene/controller code populates semantic spatial items from `terrainScene`, `structuredInteriorScene`, and `debugOverlayScene`. Static renderables remain excluded until the batch-vs-instance design is explicit.
- `WorldDisplay` maps its own non-instanced Three.js objects to shared spatial item ids when applying visibility. Those object maps are renderer mechanics, not the source of semantic spatial truth.
- Browser/client wrappers interpret query results and own any UI action or inspector state.

Critical invariant:

- Rendering must not depend on index registration. Scene models render directly through `WorldDisplay`; the spatial index is an auxiliary query and optimization structure.
- If an item is missing from the index, it should still render. The item simply cannot be picked through the index and cannot participate in index-driven visibility optimization.
- Index-driven frustum culling must be conservative. The fallback for missing or suspect index data is to render normally.

## Non-Goals

- Do not move browser-mode click policy, inspector state, scene membership, streaming policy, or resident-camera semantics into `WorldDisplay`.
- Do not require Rust to know about browser-only debug overlays or renderer-only pick targets.
- Do not use debug overlay geometry as content assets or asset-channel records.
- Do not implement portal visibility, portal traversal, masking, or culling as part of the first spatial index.
- Do not replace Three.js rendering or all Three.js ray math up front. The first index is a broadphase and policy boundary, not a full engine rewrite.

## Interface Direction

Keep the injected dependency narrow. `WorldDisplay` should code against an interface, not a browser-owned concrete type.

Implemented interface shape:

```ts
export type RenderSpatialItemKind = "terrain" | "structured-cell" | "portal";

export interface RenderSpatialItem {
  id: string;
  kind: RenderSpatialItemKind;
  ownerKey: string;
  broadphaseBounds: RenderBounds;
  pickShape?: RenderPickShape;
  metadata: RenderSpatialMetadata;
}

export interface RenderSpatialIndexSink {
  clearOwner(ownerKey: string): void;
  replaceOwnerItems(ownerKey: string, items: RenderSpatialItem[]): void;
  upsertItem(item: RenderSpatialItem): void;
  removeItem(itemId: string): void;
}

export interface RenderSpatialIndexQuery {
  hasItem(itemId: RenderSpatialItemId): boolean;
  pickRay(
    ray: RenderRay,
    mask: ReadonlySet<RenderSpatialItemKind>,
  ): RenderSpatialPick | null;
  queryFrustum(
    frustum: RenderFrustum,
    mask: ReadonlySet<RenderSpatialItemKind>,
  ): RenderSpatialItem[];
}

export interface RenderSpatialIndex
  extends RenderSpatialIndexSink, RenderSpatialIndexQuery {}
```

`metadata` should be strongly typed enough to identify renderer facts, but not browser actions. For example, a portal item can expose source env-cell id, target env-cell id, portal id, polygon id, and target status. It should not expose "open inspector" or "select destination" commands.

## Stable Spatial Identity

The scene/controller layer and `WorldDisplay` must agree on deterministic item ids without relying on renderer allocation order.

Shared helper functions should produce spatial item ids from existing scene-model identities. Do not duplicate string construction in browser wrappers and `WorldDisplay`.

Examples:

```ts
export function terrainSpatialItemId(assetId: string): RenderSpatialItemId {
  return `terrain:${assetId}`;
}

export function structuredCellSpatialItemId(
  renderKey: string,
): RenderSpatialItemId {
  return `structured-cell:${renderKey}`;
}

export function portalSpatialItemId(portalId: string): RenderSpatialItemId {
  return `portal:${portalId}`;
}
```

Known identity sources:

- terrain tiles: `terrain/*` asset id
- structured cells: `StructuredInteriorCell.renderKey`
- portals: stable decoded `portalId`
- outdoor static instances: stable static instance id
- indoor static instances: stable static object instance id
- static renderable batches: explicit batch key, such as gfx asset id plus scene owner, until per-instance picking is required

If a stable id cannot be derived from scene data, the object should still render but should not be indexable yet. Add the missing identity at the scene-model layer before adding pick/cull behavior for that object.

Batched or instanced objects must make their identity level explicit:

- first pass may register one spatial item per owner or batch
- precise inspection later may require one spatial item per instance
- helper names should distinguish batch identity from instance identity

Dry-run finding:

- Terrain, structured cells, and portals already have suitable stable identities. Terrain uses `TerrainSceneTile.assetId`, structured interiors use `StructuredInteriorCell.renderKey`, and portal diagnostics use decoded `portalId`.
- Static renderables have stable per-part `renderKey` values, but current rendering batches by `gfxObjAssetId`. Do not make static renderable picking or culling part of the first implementation slice; static spatial identity needs an explicit batch-vs-instance decision first.
- Shared id helpers should be introduced before the index implementation so both scene-model spatial derivation and later renderer binding can use the same identities from the start.

## Spatial Data Shape

The index should not require display geometry. Display geometry, broadphase bounds, optional narrowphase pick shape, renderer bindings, and semantic metadata are separate concepts.

Scope the first structure as a shared broadphase registry:

- each item has one conservative `broadphaseBounds`
- broadphase partitioning and masks operate on that conservative bounds
- frustum culling can stop at the broadphase result because false positives are acceptable
- ray picking uses the broadphase result only as candidate filtering, then runs optional kind-specific narrowphase
- streaming or interest queries can use broadphase bounds plus inflated query regions/hysteresis outside the index

Initial narrowphase pick shapes:

- `box`: good for cell bounds, terrain tile bounds, and static-object approximations
- `sphere`: good for markers, approximate small objects, and simple debug helpers
- `polygon`: good for portal openings when decoded polygon points are available
- `mesh-ref`: optional later escape hatch for precise Three.js or BVH-backed mesh tests

The first implementation can use simple arrays grouped by owner/bucket. If performance pressure appears, the implementation can move to a BVH, octree, grid, or landblock/env-cell buckets without changing `WorldDisplay`'s interface.

Avoid separate cull/pick/interest bounds on day one. The broadphase volume should be conservative enough for all broadphase consumers; precision belongs in ray-pick narrowphase, not in duplicate partitioning volumes.

Coordinate and bounds guardrail:

- Scene-model spatial derivation must use the same render-space transform helpers as `WorldDisplay`. The current renderer applies AC-to-Three conversion through `buildAcPlacementMatrix(...)` and landblock-relative offsets. Spatial bounds and pick shapes must use the same basis.
- If a helper currently lives in a geometry/render file but becomes needed for scene-model spatial derivation, move or split it into a pure shared module under `world-display` rather than duplicating transform math.
- Terrain broadphase bounds can be derived directly from `TerrainSceneTile.worldOffsetX`, `worldOffsetY`, and `PreparedTerrainMesh` min/max height.
- Structured-cell broadphase bounds can start from `StructuredInteriorCell.renderGeometry.bounds` transformed by the cell placement and landblock offset.
- Portal broadphase bounds can start from the transformed portal polygon points, expanded by a small epsilon so thin portals are pickable.

## Relationship To Three.js

Three.js `Raycaster` is useful for precise object tests, but it is mostly naive over the object list it receives. The render spatial index should provide the semantic and spatial prefilter:

1. Browser/client wrapper requests a pick with a mask, such as `["portal", "structured-cell"]`.
2. `WorldDisplay` converts the viewport point into a renderer ray.
3. The index broadphase tests ray vs conservative item bounds.
4. The ray query adapter runs optional kind-specific narrowphase, such as portal polygon, marker sphere, terrain tile, or mesh-ref fallback.
5. If a precise mesh test is needed later, the narrowed candidate set can be passed to Three.js or a mesh BVH.

Frustum culling can use the same broadphase bounds:

1. `WorldDisplay` derives the camera frustum.
2. The index returns visible item candidates for requested kinds.
3. `WorldDisplay` may hide/show or skip updating renderer objects through optional renderer bindings.

Frustum culling remains renderer optimization. It must not become authoritative scene membership or portal visibility.

## First Implementation Slice

Status: implemented.

Purpose: add the spatial-index substrate and replace the ad hoc terrain-only raycast path without changing browser-visible behavior.

Deliverables:

- add render-spatial-index types and a simple concrete TypeScript implementation
- add shared spatial item id helpers and use them from both semantic item derivation and renderer binding code
- add a pure spatial scene derivation helper that accepts `terrainScene` first and returns owner-scoped spatial items
- have `BrowserWorldDisplay` or a small controller create the spatial scene items from `terrainScene`
- have `BrowserWorldDisplay` construct the concrete index, replace owner-scoped terrain items when the terrain scene changes, and inject the query interface into `WorldDisplay`
- have `WorldDisplay` optionally bind terrain render object keys/handles to the registered terrain items during terrain mesh sync
- replace `pickTerrainLandblockAtViewportPoint(...)` internals so it queries the spatial index for terrain items rather than raycasting an ad hoc terrain mesh list directly. The first terrain narrowphase may use landblock/tile bounds rather than exact terrain triangles.
- keep the public behavior identical: Ctrl-click terrain still selects the browser landblock destination
- add unit tests for id helpers, terrain spatial item derivation, index insertion, owner replacement/clearing, mask filtering, and terrain pick ordering

Acceptance:

- no browser action semantics are introduced into the index or `WorldDisplay`
- semantic terrain spatial item population is testable without constructing Three.js meshes
- terrain spatial ids are deterministic and shared; browser/controller code and `WorldDisplay` do not independently invent id strings
- terrain picking still works through the same browser control path
- rendering still succeeds if the index is empty or missing a terrain item; only spatial-index picking is unavailable in that case
- the index can answer a masked terrain pick without testing static renderables, structured cells, or portal overlays
- no portal/cell inspection UI is added yet for this slice; it was added in the second slice
- static renderables are explicitly left out of this slice

## Second Implementation Slice

Status: implemented with a context-sensitive browser inspector panel.

Purpose: register Phase 13.7 diagnostic items and expose neutral portal/cell pick results.

Deliverables:

- register structured-cell broadphase bounds and marker/cell narrowphase shapes as `structured-cell`
- register portal conservative broadphase bounds and portal polygon or approximate narrowphase shapes as `portal`
- derive portal/cell spatial items from `structuredInteriorScene` and `debugOverlayScene`, not from Three.js debug overlay objects
- expose a neutral `pickAtViewportPoint(point, mask)` from `WorldDisplay`
- have `BrowserWorldDisplay` use the neutral pick result to populate a diagnostic inspector selection
- highlight selected source/target cell or portal through browser-owned state passed back into the debug overlay model

Acceptance:

- clicking a portal or cell can show decoded diagnostic facts without changing scene membership, streaming, or camera residency
- portal picks do not ray-test terrain/static objects unless the query mask asks for them
- cell/portal picking is optional and browser-owned; future client mode can interpret the same neutral pick result differently
- the inspector can report unsupported portal targets without treating that as a pick failure. Missing-polygon witnesses are reported by the existing diagnostics row and are intentionally not pickable until a fallback pick shape is added.

Recommended inspector payload:

- cell pick: env-cell id and focus/visible state are implemented. Environment id, cell-structure id, `SeenOutside`, static object count, and portal count should be added to spatial metadata if the diagnostics panel needs richer inspection.
- portal pick: portal id, source env-cell id, polygon id, flags, `otherPortalId`, normalized target env-cell id, and target status are implemented. `otherCellId` is not currently carried by the debug overlay model and should be added there before exposing it in the pick metadata.
- terrain pick: landblock id and asset id, preserving the current destination-selection path

## Third Implementation Slice

Status: implemented for non-instanced renderer objects. Static `InstancedMesh` culling remains deferred.

Purpose: use the same index for renderer broadphase visibility work.

Deliverables:

- add frustum query support using item bounds
- group spatial items by landblock/env-cell owner keys where practical; current owner buckets are scene-level (`terrain-scene`, `structured-interior-scene`, `debug-overlay-scene`), which is sufficient for replacement and visibility but still coarse for detailed culling diagnostics
- have `WorldDisplay` hide non-instanced terrain, structured-interior, and debug-overlay objects outside the frustum
- treat static-renderable instanced mesh culling as profiling-gated follow-up work, not an assumed deliverable
- keep Three.js object-level frustum culling enabled as a second layer

Acceptance:

- frustum broadphase now drives conservative visibility for terrain meshes, structured interior meshes, and debug overlay objects without changing scene membership
- `InstancedMesh` limitations are documented, but static renderable batches are not split solely for theoretical culling gains
- any future split of static renderable instancing by landblock, env cell, or grid bucket is justified by measured render or CPU cost
- portal visibility/culling remains out of scope

Scheduling guardrail:

- Do not start this slice until the terrain and portal/cell pick paths are stable. Frustum broadphase should consume the same spatial registry after picking has proven the item ids, owner replacement, and bounds math.
- Treat frustum broadphase as observability/performance work. It should include diagnostics showing indexed item counts, visible candidate counts, and fallback/render-normally counts.

## Open Questions

- Should the first concrete index use only owner buckets plus linear scans, or should terrain/static density justify a grid immediately?
  - Direction: start with owner buckets plus linear scans. Current browser coverage is small enough, tests will be simpler, and the interface can hide a later grid/BVH/octree swap.
- How precise should portal pick shapes be: planar polygon, thin box around the polygon, or center sphere plus metadata?
  - Direction: use transformed portal polygon points for narrowphase when available, with a small broadphase expansion. If polygon math is awkward, use a thin expanded box as a temporary narrowphase, but keep the metadata tied to the decoded portal polygon id.
- Should terrain pick precision remain mesh-based after broadphase filtering, or is landblock/tile bounds precision enough for browser destination selection?
  - Direction: landblock/tile bounds are enough for the first slice because the current behavior only selects the landblock destination. Add precise terrain triangle picking later only when click height, surface/material inspection, or terrain-feature selection needs it.
- What metadata shape is narrow enough for renderer neutrality but rich enough for browser diagnostic inspectors?
  - Direction: use discriminated metadata by item kind with ids and decoded witness fields only. No commands, callbacks, browser labels, or destination-selection semantics.
- Should Phase 13.8 resident-camera work consume this index directly, or should it introduce a separate shared spatial/containment component for camera residency?
  - Direction: do not use this render index as the authority for resident-camera containment. Phase 13.8 can use render-index pick/diagnostic results for UI, but camera residency/containment should be source-backed and likely live in a separate spatial/physics component if it must be shared by browser and client mode.

Additional dry-run questions:

- Where should spatial scene derivation live?
  - Direction: add pure helpers under `src/lib/world-display/` first, for example `render-spatial-index.ts` and `render-spatial-scene.ts`. If browser/client policies diverge later, split scene-controller-specific derivation above those pure helpers.
- Should the index use Three.js classes in its public API?
  - Direction: avoid exposing Three.js classes in scene-model spatial item types. Keep simple DTO-like vectors/bounds for testability. `WorldDisplay` can adapt viewport/camera state into a query ray internally.
- How should static renderables enter the index?
  - Direction: defer. First decide whether picking static renderables needs per-instance identity. The current instancing by `gfxObjAssetId` is render-efficient but not a clean semantic pick unit.

## Relationship To Existing Plans

This plan complements Phase 13.7 and should be treated as a prerequisite or short parallel track before deeper Phase 13.8 interaction work.

Phase 13.7 produced visual portal/cell diagnostics but deliberately did not add click/hover inspection. The second slice here is the clean path to add inspection without putting browser behavior into `WorldDisplay`.

Phase 13.8 still owns resident-camera semantics and portal visibility. This index may support the renderer side of that work, but it must not become the authority for indoor scene membership or portal-driven visibility by itself.
