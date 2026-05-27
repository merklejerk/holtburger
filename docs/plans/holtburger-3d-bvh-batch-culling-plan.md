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

Status: completed.

Run prepared BVH visibility queries every camera update, but do not change object visibility yet.

Implementation prep from Phase 1:

- Build the instrumentation adapter near existing scene/render-resource coordination code so it can
  access prepared payloads and current `RenderChunkTransform`s without making asset DTOs global
  renderer state.
- Reuse `buildAcPlacementMatrix` / bounds transform behavior from structured interior spatial item
  derivation for env-cell local BVH bounds.
- Treat any Phase 1 fallback reason as "include for now" and surface the reason in counters.

Done:

- Added a renderer-local `prepared-bvh-metrics.ts` adapter that gathers active prepared payloads,
  current render chunk transforms, and the camera frustum, then runs prepared-BVH visibility queries
  without mutating meshes, object visibility, instance buffers, or render pass inputs.
- Exposed metrics in `WorldRenderDebugMetrics`:
  - terrain BVH visible/total item counts;
  - outdoor static BVH visible/total item counts;
  - env-cell local BVH visible/total item counts;
  - visible static instance key count;
  - visible portal key count;
  - env cells considered for local BVH querying;
  - fallback reason count and samples;
  - BVH query time.
- Added the BVH line to browser renderer diagnostics so camera/frustum plausibility can be observed
  before culling affects rendering.
- Added focused tests for visible counts, fallback reasons, and query timing plumbing.

Decisions and course corrections:

- Phase 2 uses already-active structured interior cells as the conservative env-cell set for local
  BVH metrics. It does not yet use topology residency BVHs to discover additional env cells. This
  keeps instrumentation aligned with what the renderer already has loaded and avoids accidentally
  changing residency policy.
- Missing prepared payloads, missing chunk transforms, unexpected coordinate spaces, and missing
  local BVHs remain instrumentation fallbacks. They are reported as fallback reasons and do not
  exclude anything.
- Env-cell local BVH bounds are transformed with the same `buildAcPlacementMatrix` style used by
  structured interior rendering before chunk offsets are applied.
- Outdoor static BVH totals are scoped to active outdoor static source landblocks, not every cached
  outdoor payload.

Validation:

```text
npm run test:ts -- --run prepared-bvh-metrics prepared-bvh-visibility render-spatial-index render-picking-math static-renderables
npm run check
npm run lint:ts
```

Introduced cleanup targets:

- The browser diagnostics string is now very dense. Before adding more renderer diagnostics, split
  it into grouped display lines or a structured debug panel.
- Topology residency BVH metrics are still not surfaced. Decide in Phase 2.5 whether to add them
  before candidate selection or defer them until portal/streaming work.

### Phase 2.5: Candidate Selection Readiness Check

Status: completed.

Phase 3 starts building a generic batch candidate registry. Before that changes object/pass
selection plumbing, do a short readiness pass:

- Done: compared Phase 2 BVH metrics across an outdoor town-facing view, the same location turned
  away from town, and an indoor/portal-visible view.
- Done: confirmed visible BVH counts move plausibly with camera orientation:
  - town-facing: terrain `576/1600`, outdoor statics `619/1013`, env local `1325/1725`, static keys
    `1161`, portal keys `574`, env cells `299`, fallbacks `0`, query `2.00 ms`;
  - turned away: terrain `256/1600`, outdoor statics `57/1013`, env local `0/1725`, static keys
    `57`, portal keys `0`, env cells `299`, fallbacks `0`, query `2.00 ms`;
  - indoor/portal-visible: terrain `704/1600`, outdoor statics `247/1013`, env local `593/1725`,
    static keys `501`, portal keys `248`, env cells `299`, fallbacks `0`, query `1.00 ms`.
- Done: confirmed fallback count stayed at `0` in ordinary outdoor and indoor/portal-visible
  samples.
- Done: kept this as verification/prep only; no candidate batch filtering was introduced.

Decision:

- Proceed to Phase 3 without adding topology residency BVH metrics first. Active structured cells
  are a conservative enough env-cell input for the base-pass candidate registry. Topology residency
  BVH discovery can wait until portal-clipped culling or streaming/residency work needs it.

Refinements for Phase 3:

- Treat Phase 2 fallback reasons as registry fallback-inclusion reasons. If a batch cannot be bound
  or a query path reports suspect data, include the batch and count the reason.
- Start with base-pass candidate bookkeeping and metrics. Do not wire candidate sets into portal
  composite passes until Phase 6.
- Preserve the Phase 2 metrics while Phase 3 rolls out so candidate-batch counts can be compared
  against visible item-key counts.

### Phase 3: Generic Batch Candidate Registry

Status: completed.

Add a renderer-local batch candidate registry in `world-display-renderer.ts` or a focused helper
module.

Responsibilities:

- Done: added `render-batch-candidates.ts` as a focused renderer helper for registering,
  replacing, unregistering, and clearing render batch bindings.
- Done: registry bindings store `batchId -> Object3D` and `batchId -> itemKeys`, with item keys
  deduplicated at registration time.
- Done: candidate selection returns candidate batch ids and candidate objects for a
  `ReadonlySet<RenderBvhItemKey>`.
- Done: batches fallback-include when they have no item keys, have an explicit binding fallback
  reason, or when the prepared-BVH query path reports fallback/suspect data.
- Done: selection counters track registered batches, keyed batches, represented item keys, visible
  item keys, matched batches, unbound fallback batches, explicit fallback batches, query-fallback
  batches, candidate batches, and fallback reason counts/samples.
- Done: unit coverage verifies any-key matching, duplicate key deduplication, unbound fallback,
  explicit fallback, query fallback, and replacement/unregister behavior.
- Still Phase 4: register actual static `InstancedMesh` groups as Three.js objects are created and
  disposed. Phase 3 intentionally shipped the registry without production render mutations.

Original requirements:

- Register/unregister render batches as Three.js objects are created and disposed. Phase 3 added the
  registry API; Phase 4 wires static group creation/disposal into it.
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

Decisions and course corrections:

- Keep the registry in a focused helper module instead of adding more state directly to
  `world-display-renderer.ts`. The helper is still renderer-local because it stores Three.js
  `Object3D` handles and imports renderer-only BVH item key types.
- Do not bind real objects in Phase 3. The codebase has one clear binding point for static groups:
  `syncStaticRenderableMeshes`. Binding before Phase 4 would either duplicate the upcoming static
  key derivation or register empty batches that only inflate fallback counts.
- Treat any prepared-BVH query fallback reason as conservative all-batch inclusion for the selected
  registry. This is intentionally broad until bindings can scope fallback reasons by batch/domain.
- Replacement by `batchId` is supported because render mesh material/capacity changes can recreate
  a Three.js object while preserving the logical batch identity.

Validation:

```text
npm run test:ts -- --run render-batch-candidates prepared-bvh-metrics prepared-bvh-visibility
```

Introduced cleanup targets:

- Phase 4 should derive static group item keys in a small helper instead of inline in
  `syncStaticRenderableMeshes`; that helper should be unit-tested separately from Three.js object
  lifecycle.
- Phase 4 should add candidate-batch metrics to `WorldRenderDebugMetrics`, but keep the existing
  Phase 2 visible item-key metrics for comparison.
- The current query-fallback behavior includes all batches in the registry. Once static, terrain,
  and env-cell registries share the path, consider domain-scoped fallback reasons so a missing
  outdoor BVH does not force-include unrelated indoor batches.

### Phase 4: Static Instanced Batch Bindings

Status: completed.

Bind existing static `InstancedMesh` groups to prepared BVH item keys.

For each `staticRenderableGroupMeshes` entry:

- Done: `syncStaticRenderableMeshes` now reads group parts from
  `staticRenderableScene.partsByRenderGroupKey` and registers each live `InstancedMesh` in the
  static render batch candidate registry.
- Done: stale static render batches unregister when their mesh is removed, and the registry clears
  when materialized static meshes are rebuilt or disposed.
- Done: static group key derivation lives in `static-renderable-bvh-bindings.ts` instead of being
  inlined into the renderer.
- Done: each static part converts to a scoped item key:
  - outdoor scenery/building/generated scenery: source landblock id plus `instanceId`;
  - indoor static: `owningEnvCellId + instanceId`;
- Done: each static group registers as one batch with all unique item keys.
- Done: if any part cannot be converted to a scoped key, the whole group registers as
  fallback-included with an explicit reason.

On camera update:

- Done: prepared-BVH visibility now returns a snapshot with both debug metrics and the visible item
  key set, so Phase 4 reuses the same query results instead of running traversal twice.
- Done: static batch candidate selection runs once per rendered frame from that visible item-key
  set.
- Done: base-pass rendering applies the candidate set to static `InstancedMesh.visible` only while
  rendering the base node, then restores all static meshes visible before later graph nodes.
- Done: Three.js object frustum culling remains enabled.
- Done: camera movement does not update `instanceMatrix`, `instanceColor`, or `mesh.count`; it only
  selects which existing batches are visible for the base pass.
- Done: groups with unkeyed parts fallback-include and count as fallback-included batches.
- Done: if a static mesh somehow lacks a matching registry binding, the base pass conservatively
  keeps it visible instead of creating a false negative.

Original requirements:

- Include the mesh's batch id in the base-pass candidate set when any referenced item key is visible.
- Keep existing Three.js frustum culling enabled.
- Do not update `instanceMatrix`, `instanceColor`, or `mesh.count` due only to camera movement.
- Do not bind a group to item keys if any part lacks a scoped key; fallback-include that group and
  count it as an unbound/fallback-included batch.

Add metrics:

- Done: total static render batches.
- Done: BVH-candidate static render batches.
- Done: total static instance keys represented by batches.
- Done: BVH-visible static instance keys.
- Done: fallback-included static render batches.

Decisions and course corrections:

- The current renderer has shared scene rendering for base, diagnostic, debug, and portal composite
  passes. Applying static culling as a permanent global `Object3D.visible` state would leak into
  portal composites, so Phase 4 scopes the visibility shim to base-pass render calls and restores
  visibility immediately after each base pass.
- Keep the durable target as explicit pass candidate sets. The `Object3D.visible` shim is a
  migration bridge for static base-pass rendering, not the final renderer architecture.
- Query fallback reasons still include every static batch in the static registry. This is
  conservative and correct, but broad; domain-scoped fallback reasons should be considered once
  more batch classes share the registry.
- `visibleStaticGroupMeshCount` remains an object-visibility diagnostic after visibility restoration.
  Use `staticBvhCandidateBatchCount/staticRenderBatchCount` for the actual Phase 4 culling signal.

Validation:

```text
npm run test:ts -- --run static-renderable-bvh-bindings render-batch-candidates prepared-bvh-metrics prepared-bvh-visibility
npm run check
npm run lint:ts
```

Introduced cleanup targets:

- The renderer now has a base-pass visibility shim for statics. Phase 5 should avoid extending that
  shim blindly to every object class; prefer pass-scoped candidate plumbing where practical.
- The browser debug BVH row is carrying both item-key metrics and static batch metrics. Before
  adding Phase 5/6 metrics, split the debug presentation into grouped rows.
- Static batch fallback metrics count explicit, unbound, and query-fallback batches together in the
  public debug contract. Keep the detailed counters inside the registry until the UI needs the
  breakdown.

### Phase 5: Non-Instanced Prepared BVH Bindings

Status: completed.

Move existing non-instanced culling toward the same batch registry.

Candidates:

- Done: terrain landblock meshes now register as non-instanced render batches and participate in
  exterior base-pass candidate selection. They keep whole-tile draw granularity by binding each tile
  mesh to all of its terrain quad keys; the tile is a candidate when any bound quad is visible.
- Done: structured env-cell shell meshes now register as non-instanced render batches keyed by the
  env-cell render-geometry key.
- Done: cell debug overlays now bind to the env-cell render-geometry key.
- Done: portal debug overlays now bind to the env-cell portal key.
- Done: transition portal mask objects now bind to the env-cell portal key and visible portal work
  collection conservatively skips registered mask batches that are not BVH candidates.
- Deferred: future pass-local portal render batches still need Phase 6 portal-clipped candidate
  sets. Phase 5 does not apply the base camera candidate set to portal composites.

Do this incrementally. The current `RenderSpatialIndex` path can coexist while the prepared-BVH
batch registry is proven.

Implementation notes:

- Added `non-instanced-bvh-bindings.ts` so terrain, structured-cell, debug-overlay, and portal-mask
  batch ids and item-key derivation live outside the renderer lifecycle code.
- Added separate registries for terrain, structured interiors, debug overlays, and portal masks.
  This keeps lifecycle clears scoped to the object class being rebuilt.
- Non-instanced scoped render helpers preserve each object's prior `visible` state. This lets the
  existing `RenderSpatialIndex` global culling coexist as a conservative backstop instead of being
  overwritten by prepared-BVH scoped renders.
- Base exterior rendering scopes terrain candidates plus static candidates.
- Base interior and diagnostic-interior rendering scope structured-cell candidates plus static
  candidates where relevant.
- Debug-overlay rendering scopes debug overlay candidates.
- Portal aperture mask/depth rendering still uses its pass-local aperture scene. Phase 5 only gates
  visible portal work collection by the registered portal-mask candidate when available.

Metrics added:

- terrain render batches and BVH-candidate terrain batches;
- structured interior render batches and BVH-candidate structured interior batches;
- debug overlay render batches and BVH-candidate debug overlay batches;
- portal mask render batches and BVH-candidate portal mask batches;
- aggregate fallback-included non-static batches.

Decisions and course corrections:

- Terrain remains coarse by render tile. Binding all quad keys to the landblock mesh gives a
  conservative "any visible quad renders the tile" policy without splitting terrain geometry.
- Course correction: manual validation showed terrain disappearing by camera angle in outdoor
  residency after the first Phase 5 implementation. The bug was proven from code evidence: the
  Tauri serializer built terrain BVH bounds from `PreparedTerrainMesh.vertices` in AC
  terrain-local coordinates, while the renderer uploads terrain positions as `(x, z, -y)`. Phase 5
  now transforms terrain BVH bounds into render coordinates before frustum tests and includes a
  regression test for that axis/sign conversion.
- The old `RenderSpatialIndex` culling path remains active. Prepared-BVH candidate selection is an
  additional scoped filter for registered non-instanced batches, not a deletion of the legacy path.
- Do not apply non-instanced prepared-BVH candidates to portal composite scene rendering yet. The
  composite pass still renders the shared scene by layer/stencil and needs Phase 6 pass-scoped
  portal-clipped candidate sets to avoid base-frustum false negatives.
- Portal mask candidate gating uses main-camera env-cell portal visibility plus the existing portal
  aperture visibility check. Missing/unregistered mask bindings are included conservatively.

Validation:

```text
npm run test:ts -- --run non-instanced-bvh-bindings static-renderable-bvh-bindings render-batch-candidates prepared-bvh-metrics prepared-bvh-visibility
npm run check
npm run lint:ts
```

Introduced cleanup targets:

- The public debug contract now has several batch-counter fields. Before adding Phase 6 portal-pass
  metrics, split browser debug rendering into grouped rows or a structured view so the BVH line does
  not become unusable again.
- `RenderSpatialIndex` and prepared-BVH registries now overlap for terrain, structured interiors,
  and debug overlays. Keep both until manual validation confirms prepared-BVH candidate counts and
  visuals are stable, then consider retiring duplicated object visibility toggles.
- The scoped visibility helpers are still migration shims around Three.js scene rendering. Phase 6
  should prefer explicit pass-scoped candidate plumbing for portal composites instead of expanding
  global `Object3D.visible` state.

### Phase 5.5: Scoped Candidate Validation

Status: completed.

Before implementing portal-clipped BVH queries, validate that the Phase 4/5 base-pass candidate
path is not hiding required terrain, static, structured, debug, or portal-mask objects in ordinary
camera movement.

Responsibilities:

- Done: compared debug metrics for outdoor town-facing, turned-away, indoor, and portal-visible
  views.
- Done: verified candidate batch counts move with visible item-key counts and fallback-included batch counts
  stay explainable.
- Done: confirmed screenshots do not show base-pass false negatives for terrain, outdoor statics,
  indoor statics, structured interiors, debug overlays, or transition portal aperture masks.
- Done: query time remained in the low single-digit millisecond range in validated views.
- Done: confirmed `renderPassCount` is graph-node count rather than portal recursion depth. At
  transition depth `4`, outdoor rendering normally reports `14` graph passes: one base pass, four
  aperture-mask passes, four aperture-depth-reset passes, four portal composite passes, and one debug
  overlay pass.
- Decision: keep the legacy `RenderSpatialIndex` object-visible path through Phase 6 as a
  conservative backstop while portal composites move to pass-scoped prepared-BVH candidate sets.
- Deferred: split the debug BVH/render display before or during Phase 6 metrics work if the added
  portal-pass counters make the panel hard to scan.

Decisions and course corrections:

- Do not treat `14` passes at transition depth `4` as a Phase 5.5 performance failure. The important
  Phase 5.5 validation signals are visual correctness, explainable candidate counts, zero ordinary
  fallback churn, and low prepared-BVH query time.
- Phase 6 should focus performance work on the four portal composite passes. The aperture mask and
  depth-reset passes render small pass-local aperture scenes and are not the primary source of scene
  traversal/draw cost.

### Phase 6: Portal-Clipped BVH Queries

Status: completed.

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

- Done: derive a conservative portal-clipped visibility volume from the camera frustum and aperture
  polygon;
  polygon.
- Done: reuse the already-computed world aperture points from transition portal visibility.
- Done: query target env-cell `localBvh` payloads with pass-specific aperture-clipped volumes for
  interior portal composites.
- Done: query loaded terrain and outdoor-static BVHs with pass-specific aperture-clipped volumes for
  exterior portal composites.
- Done: produce visible item keys and candidate batch ids scoped to the portal composite pass, not
  the whole frame.
- Done: keep base-pass, portal-pass, and debug-pass candidate sets separate.
- Done: feed portal-pass candidate sets into the render graph/composite path through scoped
  candidate helpers. The implementation still uses temporary `Object3D.visible` mutation only inside
  the composite render call and restores it immediately after the pass.
- Done: fallback-include batches for the portal pass when aperture geometry, target cell data,
  loaded scene coverage, or clipping math is incomplete.
- Done: add aggregate portal composite candidate metrics to the debug contract.

This phase should integrate with the portal render graph rather than the static scene model. It is
about reducing portal composite pass work, not changing static instance buffer construction. The
aperture mask and depth-reset passes already render a small pass-local aperture scene and should not
be the first target.

Decisions and course corrections:

- Portal clipping uses the main camera frustum plus a conservative aperture cone. The cone includes
  edge planes through the camera and aperture edges, plus an aperture-forward plane so objects
  between the camera and aperture do not keep a composite batch alive.
- Portal composite queries are aggregated per render graph node. If multiple apertures feed the same
  transition depth, their visible item keys are unioned before selecting render batches.
- Interior composites query only requested/loaded structured env cells. Exterior composites query
  loaded terrain tiles and active outdoor static payloads.
- Query fallback remains intentionally broad. If a portal pass cannot build an aperture volume or
  cannot find scene payloads/transforms to query, the affected registered batches are included rather
  than hidden.
- Shared env-cell local BVH bounds transformation now lives in `prepared-bvh-bounds.ts` so base-pass
  and portal-pass queries use the same placement math.

Introduced cleanup targets:

- The debug render summary string is now too dense again. Split it into grouped/debug rows before
  adding more renderer counters.
- Portal composite metrics are aggregate per frame. If Phase 6.5 finds confusing behavior, add
  per-depth or per-composite-scene samples instead of only totals.
- The scoped visibility helpers are still migration shims around Three.js scene traversal. A later
  renderer cleanup should replace them with explicit render-list plumbing once the candidate model is
  stable.

### Phase 6.5: Portal-Clipped Candidate Validation

Status: pending.

Before doing broader performance tuning, manually validate that portal-clipped composite candidates
are conservative in real scenes.

Responsibilities:

- Inspect outdoor-looking-into-interior and indoor-looking-outdoor views at transition depths `1`
  through `4`.
- Confirm portal composites do not lose terrain, outdoor statics, structured cell geometry, or
  indoor statics that are visible through apertures.
- Compare render calls/triangles before and after Phase 6 from similar camera positions.
- Watch portal composite candidate counters for obvious fallback churn. Occasional fallback is fine
  when assets are genuinely missing; steady fallback in normal loaded scenes means the query source
  selection needs tightening.
- If visual correctness is good but call counts stay high, profile whether the remaining cost is
  broad fallback inclusion, too-large aperture cones, material/program churn, or unavoidable
  transition depth.

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
  picking-specific helpers were later split into `render-picking-math.ts` with direct and
  black-box tests.
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
- Split the browser renderer diagnostics text into grouped debug lines or a structured panel before
  adding more metrics; Phase 2 made the single diagnostics sentence harder to scan.
- Keep stale DTO union members out of `assets/types.ts` and `host/contracts.ts`; the host contract
  should match exactly what the Rust serializer emits.
