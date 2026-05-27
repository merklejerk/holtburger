# Holtburger 3D BVH Batch Culling Plan

Status: draft.

## Purpose

Use prepared terrain, outdoor-static, env-cell, and portal BVH payloads to reduce renderer work as
the camera moves, without rebuilding static instance buffers every frame.

The renderer should treat BVH results as conservative render-candidate selection. A render batch is
eligible for a pass when any BVH item referenced by that batch intersects that pass's visibility
volume. The batch may be a `Mesh`, `InstancedMesh`, `Group`, portal mask object, debug object, or
future pass-local render unit. The culling system should not care which Three.js object type backs
the batch.

This extends the existing render spatial index work in
[holtburger-3d-render-spatial-index-plan.md](holtburger-3d-render-spatial-index-plan.md), which
currently covers terrain, structured interior meshes, and debug overlays but intentionally deferred
static `InstancedMesh` culling.

## Current State

- Rust content assembly prepares stable static instance identities for outdoor explicit objects,
  buildings, generated scenery, and indoor statics.
- Outdoor static payloads now use source-landblock ownership consistently: overhanging static
  placements stay in the source landblock payload, source render chunk, and source-landblock-local
  BVH bounds instead of normalizing into neighbor chunks.
- Outdoor landblock payloads expose `outdoorBvh` items keyed by `instanceId` with `static` or
  `building` kind.
- Generated scenery is currently represented as `static` in `outdoorBvh` even though the static
  member payload labels it as `generated-scenery`; this is fine for culling, but the serializer can
  expose a distinct `generated-scenery` BVH item kind if consumers need that semantic distinction.
- Env-cell payloads expose `localBvh` items for cell render geometry, static objects, and portal
  apertures.
- Terrain payloads expose `terrainBvh` items for terrain quads.
- Topology payloads expose `envCellResidencyBvh` items for env-cell residency/streaming.
- `WorldDisplay` already applies frustum visibility through `RenderSpatialIndex` for non-instanced
  terrain meshes, structured interior meshes, and debug overlay objects.
- Static renderables are currently batched into stable `InstancedMesh` groups by render domain,
  render chunk, gfx object, material signature, texture velocity signature, and region detail
  signature.

## Non-Goals

- Do not rebuild static `InstancedMesh` buffers on every camera change.
- Do not filter individual instances inside an existing `InstancedMesh` per frame.
- Do not replace Three.js object-level culling. Keep Three.js as a final conservative pass.
- Do not make global `Object3D.visible` the target architecture for BVH culling. Existing code may
  use it during migration, but the end state should pass explicit candidate sets to render passes.
- Do not move browser-mode camera policy, UI toggles, or diagnostic display policy into shared Rust
  crates.
- Do not move renderer batch candidate policy into `holtburger-world` or `holtburger-core`.
- Do not make rendering depend on BVH registration. Missing or suspect BVH data must fall back to
  inclusion.

## Design Principles

- Per-camera work should select stable render batches, not mutate static geometry buffers.
- BVH culling must be conservative. False positives are acceptable; false negatives are correctness
  bugs.
- Batch identity and BVH item identity are separate. A batch may reference many BVH items, and a BVH
  item may later feed multiple batches.
- Culling should be generic across object types. Static `InstancedMesh` groups are only one
  consumer.
- Prepared BVH payloads are renderer input data, not authoritative world semantics.
- Instrument before changing rendering behavior so culling effectiveness is visible and testable.

## Dry-Run Findings Against Current Code

- `WorldDisplay` currently applies frustum culling by mutating global `Object3D.visible` state in
  `syncSpatialVisibility`. Treat that as migration behavior, not the target architecture.
  Portal-clipped culling needs explicit pass-scoped candidate sets because a batch can be hidden in
  the base pass and visible through an aperture.
- Static renderables already retain enough identity to bind batches without changing scene-model
  derivation: each `StaticRenderablePart` carries `kind`, `instanceId`, `owningLandblockId`,
  `owningEnvCellId`, `renderChunk`, and `renderKey`.
- Current static group creation in `syncStaticRenderableMeshes` is a good binding point because it
  has both the `InstancedMesh` and `partsByRenderGroupKey`. Register or refresh batch bindings
  there, and unregister them when a static group mesh is removed.
- Prepared BVH DTO interfaces are currently nested/private in `assets/types.ts`. Make the needed
  DTOs public or refactor the shared shapes into focused exported components; do not duplicate DTO
  shapes by hand.
- Existing frustum and bounds intersection helpers live inside `render-spatial-index.ts`. Move the
  neutral math to a small shared helper before implementing prepared-BVH traversal so the renderer
  does not grow two subtly different frustum tests.
- Outdoor static placement used to normalize into neighboring render chunks when placement
  coordinates left the source landblock's `0..192` range. Phase 0 removed that policy. The current
  invariant is symmetric source-landblock ownership: a landblock payload owns, renders, and culls
  all statics sourced by that landblock. Its `outdoorBvh` root is expressed in source-landblock
  render-local coordinates and includes overhanging statics outside the normal tile range.
- Existing portal visibility already computes world aperture points, a transformed portal plane, and
  clipped projected screen area. Portal-clipped BVH work should reuse those results rather than
  recomputing aperture transforms in a separate path.
- Portal mask/depth passes already use a pass-local scene for aperture meshes, while portal
  composite passes still render the main scene by layer. The portal-clipped culling phase should
  target composite-pass object selection first; mask/depth aperture passes are already small.

## Core Model

Introduce a renderer-local batch candidate registry:

```ts
interface RenderBatchCandidateBinding {
  batchId: string;
  object: Object3D;
  chunkKey: RenderChunkKey;
  itemKeys: readonly RenderBvhItemKey[];
  fallbackIncluded: boolean;
}
```

`object` is a migration convenience for the current Three.js scene. The durable abstraction is
`batchId -> itemKeys -> pass candidate sets`; render passes should be able to consume candidate
batch ids directly without relying on global object visibility flags.

`RenderBvhItemKey` should be a stable, scoped string derived from prepared payload identities:

```text
terrain:landblock:<landblockId>:quad:<quadIndex>
outdoor-static:landblock:<landblockId>:instance:<instanceId>
env-static:cell:<envCellId>:instance:<instanceId>
env-render-geometry:cell:<envCellId>
env-portal:cell:<envCellId>:portal:<portalId>
residency-cell:cell:<envCellId>
```

The exact helper names can differ, but key construction must live in one module and be shared by
BVH item derivation and batch binding code.

For outdoor statics, `<landblockId>` means the source landblock asset id, not a normalized neighbor
chunk id. Overhanging statics remain source-owned for asset payloads, render batches, and BVH
culling.

Per camera update:

```text
visible item keys = query prepared BVHs with camera frustum
candidate batch ids = every batch whose itemKeys intersects visible item keys
base pass receives candidate batch ids plus fallback-included batch ids
```

For static instanced groups:

```text
group is a candidate if any part.instanceId in the group is visible
```

No per-frame regrouping or instance matrix rewriting is required.

## Hierarchical Env-Cell Culling

Env-cell culling should be hierarchical, but conservative.

First query landblock/topology-level data to decide which loaded env cells are relevant to the
current camera or render pass. Then, for each relevant loaded env cell, query that cell's `localBvh`
to identify visible local items:

```text
camera or pass visibility volume
  -> envCellResidencyBvh / existing structured-interior coverage
  -> loaded env cells
  -> envCell.localBvh
  -> render geometry, indoor statics, portals
  -> render batch candidate selection
```

The first implementation should recurse only into already-loaded/relevant env cells. It must not use
the local BVH pass to change asset residency or streaming policy. If the residency/topology data,
cell asset, local BVH, or transform is missing, the fallback is to include the affected cell-local
batches in the relevant pass.

Portal rendering will eventually need pass-specific visibility volumes, such as portal-clipped
frustums or aperture-derived volumes. The first slice should use the main camera frustum for direct
metrics and conservative candidate selection, then leave portal-specific recursion as a follow-up
once the generic batch candidate path is proven.

## Implementation Phases

### Phase 0: Source-Owned Outdoor Static Cleanup

Status: completed.

Before outdoor static BVH results can exclude render batches, make outdoor static ownership
symmetric.

Responsibilities:

- Done: Rust outdoor static assembly now keeps explicit objects, buildings, and generated scenery
  on the normalized source landblock while preserving source-local placement coordinates, including
  coordinates outside `0..192`.
- Done: frontend static renderable derivation now treats outdoor statics as source-owned by the
  payload landblock and no longer normalizes overhanging placements into neighboring render chunks.
- Done: overhanging statics remain in the source render chunk; their chunk-local instance placement
  stays source-landblock-local.
- Done: Rust regression coverage verifies an overhanging source-owned static feeds a source
  landblock outdoor BVH item whose padded render-space bounds still lie outside the normal tile
  footprint.
- Done: TypeScript regression coverage verifies an overhanging outdoor static renders from the
  source landblock chunk with the original source-local placement.

Decisions and course corrections:

- The old "adjust to outside" style normalization is no longer part of the prepared outdoor static
  rendering contract. Neighboring terrain chunks do not own overhanging statics sourced by another
  landblock.
- Generated scenery follows the same source-ownership policy as explicit outdoor objects and
  buildings.
- We still normalize the low 16 bits of the source landblock id to `ffff`; this keeps existing
  outdoor-landblock chunk identity behavior without moving ownership across x/y chunks.

Legacy shims removed:

- Rust `normalize_outdoor_static_frame`.
- TypeScript `normalizeOutdoorStaticPlacement`.

Validation:

```text
cargo test -p holtburger-content outdoor_static_frames_remain_source_landblock_owned_when_overhanging
npm run test:ts -- --run static-renderables
npm run check
```

### Phase 0.5: Source-Owned Contract Audit

Status: completed.

Phase 0 removed the known normalization paths. Before prepared BVH query results exclude batches,
do a short contract audit so Phase 1 does not bake in any hidden neighbor-owned assumptions.

Responsibilities:

- Done: verified the Tauri serializer emits outdoor static `localPlacement`, `instanceBounds`, and
  `outdoorBvh.nodes` in source-landblock-local render space, while `outdoorBvh.items` remains keyed
  by the source-owned instance id.
- Done: added a Tauri/Rust contract test that serializes an overhanging static and verifies the
  JSON payload preserves source landblock ownership, source-local placement, source-local static
  bounds, source-local BVH node bounds, and matching BVH item indices.
- Done: scanned browser resource coordination, render chunk, debug/spatial, and static-renderable
  paths for assumptions that outdoor static coordinates are clamped to `0..192`.
- Done: confirmed the relevant frontend static path uses `payload.landblockId` as the outdoor
  static source landblock. Phase 1 key helpers should do the same.
- Done: kept this phase contract-only; no traversal or candidate-selection behavior was introduced.

Decisions and course corrections:

- Do not add `owningLandblockId` to serialized outdoor static members for Phase 1. The source
  landblock is already the payload `landblockId`; duplicating it would create a second contract
  surface that could drift.
- Keep `outdoorBvh.items` compact as `{ kind, instanceId }`. The landblock scope comes from the
  containing payload and should be supplied by key-construction helpers.
- Treat `outdoorBvh.coordinateSpace === "landblock-render-local"` as a query precondition. Phase 1
  should fallback-include affected batches if a prepared BVH has an unexpected coordinate space.

Validation:

```text
cargo test -p holtburger-3d serialize_landblock_outdoor_preserves_source_owned_overhanging_static_space
cargo test -p holtburger-content outdoor_static_frames_remain_source_landblock_owned_when_overhanging
```

Discovered cleanup targets:

- The names `owningLandblockId` and `chunkLocalInstancePlacement` are now accurate but easy to
  misread as normalized chunk ownership. Phase 1 key helpers should introduce clearer source-scoped
  helper names for outdoor BVH keys instead of leaning on ad hoc field interpretation.
- The frontend scan did not find a remaining outdoor-static clamp/normalization path. Existing
  `192` and `clamp` hits are terrain/chunk offset, LOD radius, generated-scenery source generation,
  material sampling, or camera/UI math and do not block Phase 1.

### Phase 1: Identity Helpers and BVH Traversal

Status: completed.

Add a TypeScript module under `apps/holtburger-3d/src/lib/world-display/` for prepared BVH
visibility helpers.

Responsibilities:

- Done: added `RenderBvhItemKey` and scoped key helpers for terrain quads, outdoor static
  instances, env-cell static instances, env-cell render geometry, env-cell portals, and residency
  cells.
- Done: exported narrow prepared-BVH DTO types from the existing asset payload type layer instead
  of duplicating DTO shapes in renderer code.
- Done: extracted neutral render-space vector, bounds, ray, and frustum math into
  `render-spatial-math.ts`; `RenderSpatialIndex` now reuses that math and re-exports the existing
  public types.
- Done: added prepared-BVH query helpers for terrain, outdoor statics, env-cell residency,
  env-cell local BVHs, and loaded env-cell two-stage recursion.
- Done: traversal returns visible item keys, query counters, and fallback reasons.
- Done: outdoor static item keys derive landblock scope from the containing outdoor payload's
  `landblockId`; render chunk inference and duplicated member ownership are not used.
- Done: query helpers validate expected coordinate spaces and return fallback reasons instead of
  treating suspect BVH data as culling authority.
- Done: source-owned outdoor overhang behavior from Phases 0 and 0.5 is consumed by the outdoor
  static key helper and query tests.

Decisions and course corrections:

- Prepared BVH roots are at node index `0`. The traversal starts there explicitly; tests cover a
  root-with-children BVH so this does not regress to a last-node assumption.
- Env-cell local BVH queries accept a caller-provided bounds-to-renderer transform. This keeps
  Phase 1 independent of renderer scene construction while making Phase 2 responsible for supplying
  the same env-cell placement transform used by structured interior rendering.
- Missing BVHs, unexpected coordinate spaces, missing loaded env-cell payloads, and invalid
  `itemIndices` are represented as fallback reasons. Later phases must count those as inclusion,
  not as successful culling.
- `RenderBvhItemKey` helpers live in `prepared-bvh-visibility.ts` for now. If more renderer spatial
  identity helpers accumulate, move them into a dedicated key module rather than scattering template
  strings.

Validation:

```text
npm run test:ts -- --run prepared-bvh-visibility render-spatial-index
npm run check
```

Introduced cleanup targets:

- `RenderSpatialIndex` still owns picking-specific polygon/sphere helpers. Only neutral
  vector/bounds/frustum/ray-box math moved in Phase 1; keep picking code local unless another
  caller needs it.
- Phase 2 needs a small adapter that gathers prepared outdoor/topology/env-cell payloads, resolves
  current render chunk offsets, and applies env-cell `localPlacement` transforms before calling the
  query helpers.
- Phase 2 metrics should include fallback-reason counters from the helper results so missing or
  suspect data is visible instead of quietly looking like effective culling.

### Phase 2: Instrumentation-Only Metrics

Run prepared BVH visibility queries every camera update, but do not change object visibility yet.

Implementation prep from Phase 1:

- Build the instrumentation adapter near existing scene/render-resource coordination code so it can
  access prepared payloads and current `RenderChunkTransform`s without making asset DTOs global
  renderer state.
- Reuse `buildAcPlacementMatrix` / bounds transform behavior from structured interior spatial item
  derivation for env-cell local BVH bounds.
- Treat any Phase 1 fallback reason as "include for now" and surface the reason in counters.

Expose metrics in `WorldRenderDebugMetrics`:

- terrain BVH visible/total item counts;
- outdoor static BVH visible/total item counts;
- env-cell local BVH visible/total item counts;
- visible static instance key count;
- visible portal key count;
- env cells considered for local BVH recursion;
- BVH query time if cheap to measure without noisy logging.

Show a compact line in the browser debug panel. This confirms that the camera frustum produces
plausible visibility sets before those sets affect rendering.

### Phase 3: Generic Batch Candidate Registry

Add a renderer-local batch candidate registry in `world-display-renderer.ts` or a focused helper
module.

Responsibilities:

- Register/unregister render batches as Three.js objects are created and disposed.
- Store `batchId -> Object3D`.
- Store `batchId -> itemKeys`.
- Produce candidate batch ids from a `ReadonlySet<RenderBvhItemKey>`.
- Fall back to including a batch when it has no item keys or the relevant BVH data is absent.
- Track why a batch was fallback-included, at least in counters, so missing binding data does not
  look like effective culling.

Keep this registry renderer-local. Scene model derivation should produce stable identities and
payload metadata; `WorldDisplay` owns the actual Three.js object handles.

Initial scheduling correction: implement this registry for base-pass candidate selection first.
Temporary `Object3D.visible` toggles are acceptable during migration, but the intended interface is
explicit candidate sets per render pass. Do not use it for portal composite passes until Phase 6
introduces pass-scoped candidate sets.

### Phase 4: Static Instanced Batch Bindings

Bind existing static `InstancedMesh` groups to prepared BVH item keys.

For each `staticRenderableGroupMeshes` entry:

- read the group parts from `staticRenderableScene.partsByRenderGroupKey`;
- convert each part to a scoped item key:
  - outdoor scenery/building/generated scenery: source landblock id plus `instanceId`;
  - indoor static: `owningEnvCellId + instanceId`;
- register the mesh as one batch with all unique item keys.

On camera update:

- include the mesh's batch id in the base-pass candidate set when any referenced item key is visible;
- keep existing Three.js frustum culling enabled;
- do not update `instanceMatrix`, `instanceColor`, or `mesh.count` due only to camera movement.
- do not bind a group to item keys if any part lacks a scoped key; fallback-include that group and
  count it as an unbound/fallback-included batch.

Add metrics:

- total static render batches;
- BVH-candidate static render batches;
- total static instance keys represented by batches;
- BVH-visible static instance keys;
- unbound/fallback-included static render batches.

### Phase 5: Non-Instanced Prepared BVH Bindings

Move existing non-instanced culling toward the same batch registry.

Candidates:

- terrain landblock meshes: keep coarse whole-landblock behavior unless terrain metrics later prove
  this matters;
- structured env-cell meshes: candidate when the env-cell render-geometry key is visible;
- portal debug overlays and portal mask objects: candidate when the portal key is visible;
- future pass-local portal render batches: candidate when at least one referenced portal or target
  cell key is visible for that pass.

Do this incrementally. The current `RenderSpatialIndex` path can coexist while the prepared-BVH
batch registry is proven.

### Phase 6: Portal-Clipped BVH Queries

Extend BVH visibility from direct camera-frustum culling to portal-pass culling.

Portal rendering needs pass-scoped visibility. A batch may be hidden in the base camera pass but
visible through a portal aperture, so portal-clipped results should not be applied as one global
`object.visible` flag.

Target shape:

```text
main camera frustum
  -> visible portal apertures
  -> aperture-clipped visibility volume
  -> target env-cell/local BVHs
  -> pass-scoped candidate batch ids
  -> portal mask/depth/composite render work
```

Responsibilities:

- derive a conservative portal-clipped visibility volume from the camera frustum and aperture
  polygon;
- reuse the already-computed world aperture points, transformed portal plane, visible side, and
  screen-area result from the transition portal visibility path;
- query target env-cell `localBvh` payloads with that pass-specific volume;
- produce visible item keys and candidate batch ids scoped to the portal pass, not the whole frame;
- keep base-pass, portal-pass, and debug-pass candidate sets separate;
- feed portal-pass candidate sets into the render graph/composite path, not global `Object3D.visible`
  state for the whole frame;
- fallback-include batches for the portal pass when aperture geometry, target cell data, or clipping
  math is incomplete;
- add metrics for portal candidates before/after aperture clipping and local-BVH recursion.

This phase should integrate with the portal render graph rather than the static scene model. It is
about reducing portal composite pass work, not changing static instance buffer construction. The
aperture mask and depth-reset passes already render a small pass-local aperture scene and should not
be the first target.

## Testing Strategy

Unit tests:

- BVH traversal returns expected visible item keys for simple frustums.
- Item key helpers scope identical `instanceId`s differently by landblock/env-cell.
- Outdoor source-landblock root BVH and render batch contain a static whose placement overhangs into
  a neighboring landblock, with placement/bounds expressed in source-landblock-local coordinates.
  Phase 0 has focused Rust and TypeScript coverage for this; keep it as regression coverage for
  later culling phases.
- Batch candidate selection includes a batch when any item key is visible.
- Batch candidate selection falls back to including batches with missing item-key data.
- Static group binding maps all group parts to the expected scoped item keys.
- Shared frustum/bounds helpers preserve current `RenderSpatialIndex` behavior.

Integration-style TypeScript tests:

- Existing static renderable grouping remains stable when camera visibility changes.
- Camera culling changes candidate sets without changing `mesh.count` or instance matrix contents.
- Terrain and structured-cell batches can be driven by the generic registry without losing current
  fallback behavior.
- Portal composite candidate selection remains pass-scoped and does not exclude objects needed by
  the base pass or a different portal pass.

Rust/Tauri contract tests:

- Outdoor BVH item order stays aligned with BVH node `itemIndices`.
- Env-cell local BVH item order stays aligned with filtered node inputs.
- Prepared BVH bounds are non-degenerate after padding.
- Serialized overhanging outdoor statics keep payload `landblockId`, member `localPlacement`,
  member `instanceBounds`, and `outdoorBvh.nodes` in the same source-landblock-local contract.

Validation commands:

```text
npm run test:ts
npm run check
npm run lint:ts
cargo test -p holtburger-3d
cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D warnings
```

## Rollout and Debugging

First ship instrumentation with rendering unchanged. Use the debug panel to compare:

- loaded item counts;
- BVH-visible item counts;
- rendered batch counts;
- Three.js render calls and triangle counts.

Then enable BVH candidate selection behind a browser debug toggle or narrow renderer setting so
regressions can be bisected quickly. Once stable, make conservative BVH candidate selection the
default and keep the fallback path for missing data.

Useful manual checks:

- load a dense outdoor area with high static LOD radius;
- face away from dense static clusters and verify static candidate/rendered batch counts drop;
- rotate the camera back and verify batches reappear without asset reloads or instance buffer
  rebuilds;
- enter/inspect an interior and verify env-cell render geometry and portal debug overlays remain
  conservative;
- compare screenshots with BVH batch culling on/off to catch false negatives.

## Open Questions

- Should prepared BVH traversal reuse `RenderSpatialIndex` query types directly, or should it have a
  separate DTO-focused query helper that only returns item keys?
- Should terrain initially remain whole-landblock culling, or should terrain meshes bind to all quad
  keys immediately?
- Should portal mask/pass-local batches key by portal aperture, target env-cell, or both?
- Do we need a visual debug overlay for BVH-visible items, or are metrics plus existing overlays
  enough?
- Should portal-clipped visibility use full frustum plane clipping first, or start with a
  conservative aperture AABB/pyramid approximation and tighten later?

Recommended answers for the first implementation:

- Use a separate DTO-focused prepared-BVH query helper that returns item keys and counters, but share
  the neutral frustum/bounds math with `RenderSpatialIndex`. Phase 1 implements this shape.
- Keep terrain whole-landblock at first. Terrain is currently cheap enough that quad-level draw
  granularity is not worth adding complexity.
- Key portal composite batches by both aperture/pass and target env-cell set. Aperture identity alone
  is not enough once recursive portal levels and shared target cells are involved.
- Start with metrics plus existing portal/cell overlays. Add a BVH-visible overlay only if debugging
  false negatives is painful.
- Start portal-clipped visibility with a conservative aperture-derived volume, then tighten toward
  full plane clipping after screenshots and metrics prove the fallback behavior.

## Cleanup Targets

- Remove or replace `RenderSpatialIndex`'s private frustum/bounds math duplication by extracting
  shared renderer spatial math. Phase 1 moved the neutral vector/bounds/frustum/ray-box math; the
  remaining private helpers are picking-specific.
- Centralize renderer spatial key construction. `render-spatial-ids.ts` can grow prepared-BVH item
  key helpers or a sibling module can own them; avoid scattered template strings. Phase 1 currently
  keeps prepared-BVH key helpers in `prepared-bvh-visibility.ts`.
- Remove stale comments, names, or docs that still imply outdoor statics normalize into neighboring
  chunks. The known Rust and TypeScript normalization helpers were removed in Phase 0.
- Consider naming Phase 1 helpers around `sourceLandblockId` for outdoor static keys so the code
  does not reintroduce normalized-neighbor ownership by reading render chunk identity as ownership.
  Phase 1 uses `sourceLandblockId` in the outdoor static key helper.
- Consider renaming the current `syncSpatialVisibility` once batch candidate selection exists,
  because it will otherwise sound like the only culling system even when prepared BVH batch culling
  is active.
- Keep stale DTO union members out of `assets/types.ts` and `host/contracts.ts`; the host contract
  should match exactly what the Rust serializer emits.
