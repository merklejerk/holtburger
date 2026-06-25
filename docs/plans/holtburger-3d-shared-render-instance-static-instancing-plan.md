# Holtburger 3D Shared Render Instance And Static Instancing Plan

## Context

The current browser renderer uploads static object geometry as baked draw units. That model is simple
and works for terrain, buildings, detail objects, and env-cell static geometry, but it makes repeated
objects expensive: duplicated trees, scenery props, and future dynamic entity parts can each become
separate GPU buffers even when their visual resource data is effectively identical.

Dynamic entity rendering will need the same separation static generated scenery wants: shared visual
resources plus many live instances with independent placement, residence, bounds, sorting, and source
metadata. Static generated scenery is the better first consumer because it is already present in the
frontend, has repeated outdoor objects, and can prove the resource/instance split before dynamic
animation and hook state are layered on top.

## Goal

Introduce a shared resource-backed render instance path by first applying it to eligible generated
outdoor static objects. The path should later be reused by dynamic entity parts without creating a
parallel dynamic-only VAO, texture, material, or draw-submission stack.

## Non-Goals

- Do not implement dynamic entities in this plan.
- Do not require atlas packing, vertex compaction, or texture atlasing.
- Do not require WebGL2 instanced draws for Phase 0 diagnostics or early contract bring-up. Direct
  per-instance draws over shared GPU resources are acceptable only as a temporary validation path,
  low-count path, debug path, or sort-required path.
- Do not convert every static draw unit. Terrain, buildings, structured interiors, explicit objects,
  non-repeated object geometry, and compatibility-fragmented object geometry can remain on the baked
  batch path indefinitely when that is the better cost model.
- Do not hide transparent sorting tradeoffs behind batching. Alpha-blended instances need explicit
  sort policy even if that means falling back to direct sorted draws near the camera.

## Ground Truth

Primary references:

- `docs/plans/holtburger-3d-dynamic-entity-system-requirements-plan.md`
- `apps/holtburger-3d/src/lib/renderer/types.ts`
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.ts`
- `apps/holtburger-3d/src/lib/static/contracts.ts`
- `apps/holtburger-3d/src/lib/static/objects/outdoor-static-objects-resolver.ts`
- `apps/holtburger-3d/src/lib/static/objects/bake/static-object-compatibility-baker.ts`
- `apps/holtburger-3d/src/lib/static/objects/bake/static-object-compatibility-partitioner.ts`
- `apps/holtburger-3d/src/lib/static/objects/bake/static-object-material-planner.ts`
- `apps/holtburger-3d/src/lib/runtime/static-scene-query.ts`

Existing transparent sorting mechanic:

- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.ts` defines
  `NEAR_TRANSPARENT_STATIC_SORT_DISTANCE = 16` and
  `NEAR_TRANSPARENT_STATIC_SORT_DISTANCE_SQUARED`.
- Transparent static object resources farther than that distance enter the far transparent draw list.
- Transparent static object resources within that distance enter the near transparent draw entries and
  are sorted back-to-front before drawing.

Current evidence:

- `StaticObjectGeometryStaticDrawUnit` owns positions, texcoords, material slot indices, indices,
  material entries, render state, sort metadata, source mapping, and spatial record data.
- The WebGL2 renderer stores static object GPU resources by draw-unit id and texture bindings by
  draw-unit id.
- The WebGL2 renderer has an empty `applyDynamicDelta()` placeholder, but no real dynamic resource or
  instance path.
- Generated outdoor detail objects are a likely high-value first consumer because repeated trees and
  scenery props can produce large VAOs while sharing setup/gfx/material inputs.
- Existing static scene query already depends on semantic source and bounds records, so any
  resource/instance split must preserve per-instance query identity.

## Performance Investigation Findings

Generated outdoor statics appear to preserve instance shape until the frontend static object bake:

- `crates/holtburger-content/src/landblock_scene_assets.rs` builds generated scenery as
  `PreparedStaticInstance` records with source did, source asset id, local placement, and per-instance
  source scale. The host/content layer also derives bounds-oriented `PreparedStaticMesh` records, but
  it does not appear to emit one render VAO per generated tree.
- `apps/holtburger-3d/src/lib/static/objects/outdoor-static-objects-resolver.ts` preserves
  `StaticObjectInstanceFacts` for selected outdoor detail objects, including generated facts,
  instance bounds, source identity, local placement, and source scale.
- `apps/holtburger-3d/src/lib/static/objects/static-object-source-closure.ts` dedupes source asset
  ids before resolving setup/gfx/material facts. This can still be slow when a landblock has many
  unique generated sources, but repeated copies of the same generated source should not multiply
  source asset resolution work.
- `apps/holtburger-3d/src/lib/static/objects/bake/static-object-bake-attachments.ts` collects unique
  static object source geometry identities and reloads full geometry attachments by source geometry.
  This keeps geometry transfer into the bake worker source-deduped.
- `apps/holtburger-3d/src/lib/static/objects/bake/static-object-compatibility-partitioner.ts`
  expands every object, part, and triangle into `StaticObjectTriangleCandidate` records. This is the
  first clear de-instancing point for repeated generated statics.
- `apps/holtburger-3d/src/lib/static/objects/bake/static-object-compatibility-baker.ts` allocates
  flattened typed arrays sized from `triangles.length * 3`, applies each object's placement/scale to
  source vertices, copies texcoords, writes per-vertex material slot indices, and emits baked static
  draw units. This fully converts repeated generated sources into duplicated CPU-side vertex/index
  data.
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.ts` uploads each outdoor-detail draw
  unit as an independent VAO plus position, texcoord, material-slot, and index buffers. Upload cost
  therefore scales with flattened duplicated triangles, not unique generated visual resources.

Working conclusion:

- The most likely bottleneck for repeated generated outdoor statics is the frontend bake/upload path
  destroying the source/instance separation, not the host asset assembler naively producing per-tree
  render resources.
- The current diagnostics can show object count, generated count, source count, partition count, and
  triangle count, but they do not measure attachment creation time, bake worker time, renderer upload
  time, flattened typed-array bytes, or visual-resource dedupe ratio.
- The first implementation phase should add lightweight diagnostics and timing before changing the
  data model. The plan should prove that the shared render instance path reduces flattened geometry
  work and upload bytes rather than only reducing draw-call count.

## Proposed Architecture

Add a resource/instance split that is neutral between static generated objects and future dynamic
entity parts.

### Submission Families

Do not broaden `StaticObjectGeometryStaticDrawUnit` to represent every object rendering shape. The
existing draw-unit path is a baked static object batch representation: geometry is already
landblock-placed and compatibility-batched for draw efficiency. That is a legitimate long-term path
for buildings, structured interiors, explicit objects, terrain-adjacent static batches, and generated
objects that are not good instancing candidates.

Add instanced object submissions alongside baked batches instead:

- baked static object batches: current `StaticObjectGeometryStaticDrawUnit` path, with renderer
  resources owned by baked draw-unit ids;
- instanced static object sets: shared visual resources plus per-instance placement/bounds/source
  records, used first for repeated generated outdoor detail;
- future dynamic object sets: the same shared visual resource and render instance concepts, but with
  dynamic lifecycle and continuously changing transforms.

Layer payloads may temporarily carry both baked draw units and instanced object submissions. The
shared abstraction should be material/texture/shader/resource helper code, not a single polymorphic
draw-unit DTO with unused fields.

### Proposed Contract Sketch

The final names should follow the surrounding code, but the contract shape should preserve this split:

```ts
interface OutdoorDetailsLayerPayload {
	readonly kind: "outdoor-detail";
	readonly generationId: StaticLandblockLayerGenerationId;
	readonly landblockId: number;
	readonly bakedDrawUnits: readonly StaticObjectGeometryStaticDrawUnit[];
	readonly instancedObjectResources: readonly StaticObjectVisualResource[];
	readonly instancedObjectInstances: readonly StaticObjectRenderInstance[];
	readonly materialCoverage: readonly StaticMaterialCoverageReport[];
	readonly sourceMappingRecords: readonly StaticSourceMappingRecord[];
	readonly spatialRecords: readonly StaticSpatialRecord[];
	readonly textureUses: readonly StaticBakeTextureUse[];
}

interface StaticObjectVisualResource {
	readonly kind: "static-object-visual-resource";
	readonly resourceId: string;
	readonly key: StaticObjectVisualResourceKey;
	readonly geometry: StaticObjectSourceGeometryIdentity;
	readonly materialEntries: readonly StaticMaterialTableEntry[];
	readonly materialFamily: StaticObjectGeometryStaticDrawUnit["materialFamily"];
	readonly materialPass: StaticObjectGeometryStaticDrawUnit["materialPass"];
	readonly renderState: StaticObjectRenderState;
	readonly textureUseIds: readonly string[];
}

interface StaticObjectRenderInstance {
	readonly kind: "static-object-render-instance";
	readonly instanceId: string;
	readonly resourceId: StaticObjectVisualResource["resourceId"];
	readonly domain: "outdoor-detail";
	readonly landblockId: number;
	readonly transform: StaticPlacementTransform;
	readonly bounds: StaticBounds;
	readonly sortCenter: StaticVec3;
	readonly transparency: StaticObjectTransparencySubmission;
	readonly source: StaticObjectInstanceIdentity;
	readonly generated: StaticObjectGeneratedFacts | null;
}

type StaticObjectTransparencySubmission =
	| { readonly kind: "depth-writing" }
	| { readonly kind: "instanced-transparent"; readonly sortCenter: StaticVec3 }
	| { readonly kind: "direct-sorted-transparent"; readonly sortCenter: StaticVec3 };
```

Important constraints:

- `bakedDrawUnits` is the renamed existing outdoor-detail draw-unit collection, not a fallback bucket.
- `instancedObjectResources` contains source-local reusable visual resources. It must not contain
  landblock placement, sort distance, source object id, or current near/far sort-bucket membership.
- `instancedObjectInstances` contains placement, bounds, source identity, generated facts, and current
  submission policy.
- The same `StaticObjectVisualResource` may be referenced by direct-sorted transparent instances and
  instanced transparent instances in the same frame.
- `StaticBakeBatchResult`, `StaticCoordinatorCommitDelta`, `OutdoorDetailsLayerPayload`, renderer
  layer commits, texture placement ownership, eviction records, diagnostics, and scene-query records
  need matching first-class fields. Do not tunnel instanced data through `drawUnits`.

Naming inventory to settle during Phase 1:

- `StaticObjectVisualResourceKey`: stable dedupe key for reusable static object visual resources.
- `StaticObjectVisualResource`: source-local reusable visual resource definition.
- `StaticObjectRenderInstance`: per-instance placement, bounds, source identity, generated facts,
  sort center, and submission policy.
- `StaticObjectTransparencySubmission`: current draw-list policy for an instance.
- `bakedDrawUnits`: proposed `OutdoorDetailsLayerPayload` name for the existing baked
  `StaticObjectGeometryStaticDrawUnit` collection.
- `instancedObjectResources` and `instancedObjectInstances`: proposed payload and commit field names
  for generated static instancing.
- `TextureBindingOwner`: proposed discriminated owner for texture bindings, replacing object-only
  reliance on `TextureDrawUnitBinding.drawUnitId` with draw-unit and visual-resource owner variants.

### Shared Visual Resource Key

Define a stable key for reusable visual data. The key should include only facts that require distinct
GPU resources or material binding behavior:

- geometry source identity: setup/gfx/part identity or existing static compatibility geometry
  identity;
- material family and pass;
- render state that changes shader path, depth/blend/cull behavior, clip behavior, or indexed
  palette behavior;
- material table entries and texture-use layout;
- palette, sub-palette, texture-change, and part-change variant facts when those affect the final
  visual resource;
- index type and vertex attribute layout.

The key must not include per-instance residence, landblock, source object id, transform, bounds,
selection/debug identity, sort distance, or the current near/far transparent sort bucket. Sort bucket
membership is instance/draw-list state unless it changes actual render state.

### Render Instance

Introduce a renderer-facing instance record that references a shared visual resource and carries
instance-specific state:

- instance id;
- shared visual resource key or resolved renderer resource id;
- scene domain and effective residence;
- landblock-local transform or renderer-local transform depending on the commit boundary;
- current-frame bounds and sort center;
- transparency sort policy;
- semantic source metadata for picking, diagnostics, and debug overlays.

Static generated instances and dynamic entity part instances should share this shape where their data
is isomorphic. Domain-specific source metadata can remain typed by producer.

### Renderer Resource Cache

Move reusable object GPU resources toward a cache keyed by shared visual resource key rather than by
draw-unit id. The first implementation may still direct draw each instance, but identical repeated
visual resources should upload vertex/index buffers and material/texture binding tables once per
visual variant.

Texture bindings should be owned by shared visual resource id or resource key. Keeping bindings tied
to draw-unit ids would preserve the current duplication problem in a new shape.

### Draw Strategy

Use a staged draw strategy:

- Bring-up path: direct draw each render instance while binding a shared resource. This proves the
  data model, cache lifetime, scene-domain submission, and query identity with minimal shader churn.
- Required generated-static path: use WebGL2 instanced draws for compatible high-count opaque and
  alpha-tested generated instance groups by uploading per-instance transform/sort metadata buffers
  and calling `drawElementsInstanced`.
- Required transparent generated-static path: use shared resources plus instanced draws for
  compatible transparent generated instances outside the existing near transparent static sort
  distance.
- Sort-required path: transparent near-camera instances remain direct sorted draws by instance or
  chunk when batching would break ordering.

### Alpha-Blended Generated Statics

Alpha-blended generated statics should use the same instance infrastructure, but they need explicit
sort policy:

- opaque or alpha-test: eligible for WebGL2 instanced draw once the generated-static path is broadly
  enabled;
- transparent outside `NEAR_TRANSPARENT_STATIC_SORT_DISTANCE`: eligible for WebGL2 instanced draw
  using the same shared resources as sorted transparent instances;
- near transparent: sorted by camera depth at instance or chunk granularity, with direct draw fallback
  if batching would break ordering.

Near-sorted and instanced transparent instances should reuse the same shared visual resource when
their geometry, material, texture layout, and render state match. Moving an instance across the
existing transparent sort-distance boundary must not create a new VAO, duplicate texture/material
bindings, or invalidate the shared resource cache. The renderer should choose direct sorted draws
versus instanced draws at draw-list construction time.

The first implementation should preserve current transparent behavior before optimizing it. Any
known sorting compromise must be visible in diagnostics.

## Implementation Progress

### 2026-06-25 Phase 0 Progress

- Added first-class static-object bake diagnostics to `StaticBakeBatchResult` for object counts,
  generated/explicit/building counts, unique source and source-part geometry counts, unique source
  triangle count, flattened triangle/vertex counts, draw-unit and partition counts, skipped
  partition count, and estimated flattened typed-array bytes.
- Added coordinator timing diagnostics for resolver, attachment creation, bake worker, and commit
  wall-clock time. These are coarse runtime timings intended for comparison between landblocks, not
  profiler-grade measurements.
- Added renderer diagnostics for static object resource count, outdoor-detail static object resource
  count, current uploaded static object buffer bytes, outdoor-detail uploaded buffer bytes, and recent
  static object upload batches grouped by domain/landblock.
- The env-cell static object compatibility sub-bake forwards its diagnostics because it shares the
  same de-instancing path, even though generated outdoor detail remains the first optimization target.

Spicy bits and debt:

- Renderer upload timing measures CPU-side WebGL resource creation and `bufferData` calls, not GPU
  completion. Async GPU timer queries would be heavier than Phase 0 needs.
- The flattened byte estimate intentionally mirrors the current four static-object geometry buffers:
  positions, texcoords, material slot indices, and indices. It does not include JS object overhead,
  material table metadata, texture pages, VAOs, or driver-side padding.
- Static object draw units still carry transitional derived material summary fields alongside
  `materialEntries` and `materialSlotIndices`. Phase 0 leaves that debt alone; cleaning it up belongs
  in a renderer/material contract cutover, not diagnostics.
- The captured outdoor-anchor baseline is good enough to steer Phase 1. The timing fields are useful
  context, but byte counts, draw-unit counts, generated instance counts, flattened triangle counts,
  and largest-bake data are the structural scoreboard.
- Follow-up `jq` review of a saved runtime report found the largest report offenders were renderer's
  embedded portal frame work plan, static-object bake rows from non-target domains, and texture-atlas
  per-domain sampler/material detail. The report now summarizes renderer portal plans, collapses static
  material coverage, filters static-object bake rows to non-empty outdoor-detail domains, and keeps
  texture atlas domain diagnostics to count-level fields. Projected minified report size on the saved
  sample fell from roughly 54 KB to roughly 11 KB.
- A second pass collapsed remaining repeated rows into dashboard-style summaries: renderer static
  uploads are totals by domain plus the largest upload, static bake diagnostics are aggregate totals
  plus the largest bake, coordinator timings are totals by domain plus slowest resolver/bake samples,
  and texture-atlas per-domain rows were removed from the copy report. The updated sample projects to
  roughly 7 KB minified.
- A third pass tightened the report to be a summary instead of a diary: copied reports no longer
  include current residency objects, full render-pass plans, committed/pending revision arrays,
  latest payload strings, renderer portal-plan duplicates, asset pending snapshots, or by-domain
  mini tables. Deeper row-level data should live behind targeted inspectors, not the general runtime
  report.
- A fourth pass omitted empty warning/failure/fallback arrays and flattened portal diagnostics to the
  handful of counts that matter in the summary. Empty sections should not appear in copied diagnostics.
- Baseline capture for `manual|outdoor-anchor|0xda55ffff|buildings,detail,env-cells,terrain` with
  anisotropic filtering and portal projection active:
  - Runtime materialized 713 static draw units from 713 source static draw units with 8 committed
    materialization revisions and no pending materialization work.
  - Renderer held 425 static object resources and 193 outdoor-detail static object resources. Recent
    static object uploads totaled 11,086,218 bytes across 425 draw units; outdoor-detail accounted for
    7,439,406 uploaded bytes.
  - Outdoor-detail static object bake diagnostics covered 488 objects, including 370 generated
    instances, producing 193 draw units, 95,377 flattened triangles, 286,131 flattened vertices, and an
    estimated 7,439,406 flattened typed-array bytes.
  - Largest outdoor-detail bake target was landblock `0xda56ffff`: 179 objects, 178 generated
    instances, 116 draw units, 39,692 flattened triangles, and 3,095,976 estimated flattened bytes.
  - Static coordinator timing remained resolver-heavy: 58,945 ms resolver time and 6,019 ms bake time
    across 28 items. Slowest bake was outdoor-detail at 2,195 ms; slowest resolver was outdoor-terrain
    at 24,442 ms.
  - Portal frame summary for base scene `outdoor:0xda55ffff` had 204 render entries, 490 aperture
    resources, 490 mask edges, 444 env-cell portal edges, 536 selected mask edges, and 46 transition
    roots.
- Plan impact from the baseline:
  - Phase 1 should target outdoor-detail landblock `0xda56ffff` first because it is the largest
    captured generated-static bake: 178 generated instances, 116 draw units, and 3,095,976 estimated
    flattened bytes.
  - The optimization target remains bake/upload duplication, not portal projection or texture atlas
    memory. Portal and texture numbers are useful guardrails, but they should not drive the shared
    instance contract.
  - Resolver time is still large, especially terrain resolution, but the shared render instance plan
    should not chase resolver optimization before proving reduced flattened static-object bytes.
  - Phase 2 diagnostics should report avoided flattened bytes and retained-baked reasons for the
    `0xda56ffff` baseline so the before/after comparison is unambiguous.
- Report-shape tests were intentionally dropped; the report is operational scaffolding, not a stable
  contract. Behavior tests remain around the renderer/static/texture paths that produce the underlying
  state.

### 2026-06-25 Phase 1 Progress

- Added first-class shared static object visual resource and render instance contracts to
  `apps/holtburger-3d/src/lib/static/contracts.ts`. The contracts explicitly split reusable visual
  facts from per-instance placement, bounds, generated-source identity, and transparency submission
  policy.
- Added deterministic visual resource key helpers in
  `apps/holtburger-3d/src/lib/static/objects/static-object-visual-resource-key.ts`, including stable
  key string/id creation and grouping of render instances by visual resource id.
- Added generated outdoor-detail inventory helpers in
  `apps/holtburger-3d/src/lib/static/objects/static-object-instance-inventory.ts` to identify repeated
  generated source/part/material coverage that survived into baked draw-unit source mappings. This is
  Phase 2's bridge from current baked output to candidate shared resources.
- Added focused tests proving visual resource keys ignore per-instance placement/source identity,
  normalize material-entry and texture-use ordering, change when geometry/material/render-state/index
  type changes, group multiple render instances under a shared resource id, and inventory repeated
  generated candidates without counting explicit objects or one-off generated objects.

Spicy bits and debt:

- `StaticPlacementTransform` and `StaticObjectGeneratedFacts` are now exported because the render
  instance contract should use the existing authoritative shapes instead of clone types. That is a
  small API expansion, but it avoids parallel frontend DTO drift.
- The visual resource contract currently references source geometry identity and renderer-visible
  material data; Phase 2 still needs to decide the exact produced payload fields for source-local
  vertex/index data and retained-baked reasons.
- The key helper uses a deterministic JSON string over a curated object. That is acceptable for
  Phase 1 contract tests, but Phase 3 can replace the string format if renderer cache profiling shows
  key construction cost matters.
- Inventory currently groups by retained source mapping coverage, not by full future visual resource
  keys. That is intentional: current baked draw units no longer retain source-local vertex/index
  resources, so Phase 2 still has to produce real visual resources before renderer cache grouping can
  be exact.
- Texture binding ownership is still draw-unit keyed in the texture manager and renderer. Phase 3
  remains responsible for introducing the shared visual-resource owner path.

### 2026-06-25 Phase 2 Progress

- Extended `StaticBakeBatchResult`, `StaticCoordinatorCommitDelta`, materialization results, and
  `OutdoorDetailsLayerPayload` with first-class `staticObjectVisualResources` /
  `staticObjectRenderInstances` fields. The fields are propagated through the coordinator,
  materializer, and runtime outdoor-detail layer assembly.
- The static object compatibility bake now emits candidate shared visual resources and render
  instances for repeated generated outdoor-detail objects that retain source mapping coverage,
  generated facts, and instance bounds. Current baked draw units are still emitted in parallel.
- Candidate construction now burns off nullable host/content facts through a local eligibility gate:
  emitted render instances require generated facts and non-null instance bounds, while ineligible
  objects remain on the baked path.
- Shared visual resources now carry source-local uploadable geometry: positions, texcoords,
  material-slot indices, indices, counts, and local bounds. Render instances carry a full
  source-geometry-to-landblock matrix so source scale and setup part placement do not get baked into
  the shared buffers.
- Static-object bake diagnostics now report shared visual resource count, render instance count,
  instanced source triangle/byte counts, and estimated duplicate flattened triangles/bytes that the
  eventual shared-resource cutover can avoid.
- Added a bake test proving repeated generated outdoor-detail scenery produces one shared visual
  resource with source-local geometry and multiple render instances that reference the same resource
  id.

Spicy bits and debt:

- This is a production-data bridge, not the byte-saving cutover. Eligible generated instances are
  still baked into draw units so the current renderer remains visually unchanged. Phase 2 still needs
  a follow-up cut that keeps eligible generated candidates out of the flattened baked path once the
  renderer can consume shared resources.
- Candidate emission requires `instanceBounds`; generated objects without bounds stay baked-only for
  now. The nullable source data is contained at the eligibility boundary, but Phase 2 should report
  retained-baked reasons before broad enablement.
- The duplicate-byte counters are estimates of what the post-cutover path can avoid, not current
  runtime savings. The baked draw-unit path is still emitted and uploaded today.
- Retained-baked reasons are still implicit. Phase 4/debug parity should expose a compact reason
  summary for missing bounds, one-off generated sources, non-generated objects, and non-renderable
  partitions without expanding the copied runtime report into row-level noise.
- Runtime layer resource collection now includes `instancedObjectResources`; Phase 3 adds the WebGL2
  cache and guarded direct draw path for those resources.

### 2026-06-25 Phase 3 Progress

- Added a WebGL2 static object visual-resource cache for outdoor-detail shared resources. The cache
  uploads source-local positions, texcoords, material-slot indices, and indices once per visual
  resource id, and evicts those GPU resources with their owning outdoor-detail layer.
- Updated the static object shader path from a translation-only placement uniform to a full object
  transform matrix. Baked static draw units still receive the same landblock-root translation as
  before, while render instances can supply `landblockRoot * sourceToLandblockMatrix`.
- Added a direct render-instance draw path over shared resources, including near/far transparent
  classification using the existing static transparent distance policy. Instance drawing is
  suppressed while the same outdoor-detail layer still carries baked draw units, avoiding double
  rendering until the flattened-path cutover lands.
- Added renderer/runtime summary counters for shared visual resources and render instances, plus
  visual-resource uploaded bytes in the existing static object upload byte totals.

Spicy bits and debt:

- Texture binding ownership is only partially generalized. The renderer can resolve visual-resource
  material bindings from texture-use ids, but runtime texture placement updates still arrive as
  draw-unit binding rows. A clean owner-key contract remains Phase 3/cleanup debt.
- The direct instance draw path is intentionally gated by baked draw-unit suppression. It proves cache,
  shader, lifetime, material binding, and sort plumbing without visual duplication, but it does not
  produce a visible/generated-static win until the next cut keeps eligible generated objects out of
  baked outdoor-detail draw units.
- Far transparent generated instances still use direct per-instance draws. That is correct for this
  phase but not the desired steady state; Phase 5B should replace compatible far transparent groups
  with real instanced draw calls.

### 2026-06-25 Flattened-Path Cutover Progress

- Eligible repeated generated outdoor-detail partitions now cut over from flattened baked draw units
  to shared visual resources plus render instances. The cutover is partition-local and all-or-nothing:
  every triangle in the partition must be covered by qualifying generated render-instance groups, or
  the whole partition stays on the baked path.
- Shared visual-resource geometry now dedupes by source-local triangle identity rather than
  per-object partition triangle id. That keeps one repeated source mesh from carrying duplicate
  copies of the same triangle before it is drawn once per instance.
- Bake diagnostics now distinguish renderable partition count from baked draw-unit count. After this
  cutover, an eligible generated partition can be renderable while contributing zero flattened
  triangles, zero flattened vertices, and zero baked draw units.
- The renderer no longer suppresses outdoor-detail render instances just because the same layer still
  has some baked draw units. The baker is responsible for only emitting instances for partitions that
  were removed from the baked path.

Spicy bits and debt:

- This is intentionally conservative. Mixed generated/non-generated partitions, one-off generated
  objects, missing-bounds candidates, and unsupported material partitions remain baked. That avoids
  geometry surgery inside a partition, but later diagnostics showed transparent sort-policy
  partitions are too conservative for repeated generated scenery; Phase 5A owns that correction.
- Texture staging still flows through renderable partition texture uses and the draw-unit-shaped
  texture binding bridge. This keeps shared visual resources bindable today, but it is still a
  transitional owner model and belongs in the cleanup phase.
- Static scene query/source-mapping parity for instanced generated objects is not done. Baked
  partitions keep their existing source mappings; cutover partitions now rely on render-instance
  identity and need the query/debug path to consume it.
- `isDrawSuppressedByBakedLayer` is now a bring-up remnant forced to `false`. It should disappear
  once the direct render-instance path is no longer sharing transitional state with the old baked
  layer suppression model.

### 2026-06-25 Resteer: Instanced Submission Moves Up

Fresh post-cutover diagnostics show the shared-resource path is active but still submitted through
direct per-instance draws:

- Outdoor-detail shared visual resources: `70`
- Outdoor-detail shared render instances: `233`
- Outdoor-detail baked draw units: `193 -> 186`
- Outdoor-detail uploaded static object bytes: `7,439,406 -> 6,918,288`
- Total static object uploaded bytes: `11,086,218 -> 10,565,100`
- Renderer pass changed between captures from `single-surface-resident` to `portal-scene-domains`, so
  frame-time comparisons are not perfectly apples-to-apples.

Decision:

- Move the WebGL2 instanced draw path ahead of query/debug parity and alpha-blended policy. The
  cutover reduced flattened/uploaded bytes, but direct-drawing the new `233` render instances can
  make frame handling worse until compatible groups use `drawElementsInstanced`.
- Start with opaque and alpha-tested generated statics. Keep near transparent direct sorted behavior
  for a later transparency-policy pass.
- Add renderer diagnostics for direct shared-resource draws versus instanced shared-resource draws as
  part of the instanced submission phase, not after it. We need those counters to prove the perf fix
  is real and not vibes.

### 2026-06-25 Phase 4 Progress

- Added a WebGL2 instanced submission path for compatible non-transparent shared outdoor-detail
  render instances. Instances are grouped by shared visual resource id; groups of two or more submit
  through `drawElementsInstanced`, while singleton groups remain direct draws.
- Added a dynamic renderer-owned transform buffer for per-instance `sourceToLandblock` matrices.
  The static object shader now accepts either the existing uniform object transform or a per-instance
  matrix attribute.
- Preserved direct sorted draws for transparent shared render instances. Alpha-blended/far
  transparent instancing remains Phase 5 so near-camera sorting behavior does not regress.
- Added renderer/runtime summary counters for direct shared render-instance draw calls, instanced
  shared render-instance draw calls, and render instances submitted through instanced draws.
- Added a focused WebGL2 renderer test proving two compatible shared outdoor-detail render instances
  submit as one instanced draw and report the new counters.

Spicy bits and debt:

- The direct and instanced static-material draw helpers duplicate texture/material uniform upload
  setup. That is intentionally local for this phase, but cleanup should extract a shared
  `prepare/bind static material resource` helper before the draw path grows more branches.
- Instanced grouping is intentionally conservative and resource-id local. It does not yet merge
  compatible transparent/far-sort groups, and it does not batch singleton resources.
- Instance transform scratch storage avoids per-group matrix-array allocation, but each instance
  still materializes a temporary transform matrix while filling the scratch buffer. If this remains
  hot after live profiling, write transforms directly into the scratch array.
- The texture binding owner bridge is still unchanged. Instanced drawing reduces submission count but
  does not solve the draw-unit-shaped texture binding contract.

### 2026-06-25 Direct Static Draw Breakdown Progress

- Added renderer/runtime summary counters for actual baked static-object direct draw submissions.
  The report now separates total baked static-object direct draw calls from outdoor-detail baked
  direct draw calls.
- Added an outdoor-detail baked direct draw breakdown by material pass: opaque, alpha-test,
  transparent, and additive. This is the compact signal needed to decide whether Phase 5
  alpha-blended instancing is a real perf lever or just aesthetic yak-shaving.

Spicy bits and debt:

- This breakdown explains what is still submitted directly, not why it stayed baked. Retained-baked
  reason summaries are still needed to distinguish explicit objects, one-off generated sources,
  missing instance bounds, mixed partitions, and unsupported material buckets.
- The breakdown currently focuses on outdoor detail because that is where the shared-instance cutover
  is active. Outdoor buildings/env-cell direct draw breakdowns can be added if the remaining draw
  pressure points there after this data lands.

### 2026-06-25 Transparent Retained-Draw Resteer

Fresh direct-draw breakdown shows the remaining outdoor-detail baked direct draws are overwhelmingly
transparent:

- Outdoor-detail baked direct draw calls: `186`
- Transparent: `162`
- Alpha-test: `14`
- Opaque: `10`
- Additive: `0`
- Shared render instances: `233`
- Shared instanced draw calls: `70`
- Shared direct render-instance draw calls: `0`

Decision:

- Phase 5 remains the right next perf phase, but it should start by explaining why transparent
  outdoor-detail partitions stayed baked. The current numbers say alpha-blended work matters, but
  not whether the retained transparent draws are repeated generated sources, explicit objects,
  mixed partitions, missing-bounds candidates, or unsupported material buckets.
- Do not blindly batch all transparent geometry. Near-camera transparent objects still need sorted
  direct submission unless we build sorted per-frame instance buffers and prove the artifacts are
  acceptable.
- Prioritize far-transparent generated scenery where repeated sources can cut over cleanly to shared
  resources and use instanced draws outside `NEAR_TRANSPARENT_STATIC_SORT_DISTANCE`.

### 2026-06-25 Transparent Retained-Reason Progress

- Added compact bake diagnostics for retained transparent outdoor-detail partitions. The report now
  rolls these up under `staticObjectBakeSummary.retainedTransparentOutdoorDetailPartitionReasons`.
- Reason buckets are: explicit object, one-off generated source, repeated generated source retained
  by partition policy, missing instance bounds, unsupported material bucket, and
  non-renderable/deferred material bucket.
- The repeated-source bucket intentionally covers transparent sort-policy partitioning as well as
  mixed partitions. Transparent policy can split otherwise repeated generated sources into
  per-object partitions, which is the exact shape Phase 5 needs to understand before changing
  submission.
- Added a focused bake test proving repeated transparent generated outdoor detail stays baked today
  and is counted as repeated-source-retained-by-partition-policy.

Spicy bits and debt:

- This explains retained baked transparent draw units, not all skipped transparent material coverage.
  Fully non-renderable/deferred buckets that never become baked draw units may still only appear in
  material coverage summaries.
- The reason summary is partition-count based, matching direct draw pressure. It does not yet report
  triangle counts or byte estimates per reason.

### 2026-06-25 Transparent Generated Course Correction

Fresh retained-reason diagnostics show the remaining transparent outdoor-detail pressure is not a
missing-data problem:

- Retained transparent outdoor-detail partitions caused by repeated generated sources: `159`
- Retained transparent outdoor-detail partitions caused by explicit objects: `3`
- Missing instance bounds: `0`
- Unsupported or non-renderable material buckets: `0`
- One-off generated transparent sources: `0`

Decision:

- Add an immediate Phase 5A before the broader alpha-blended renderer policy work. The current plan's
  "whole partition can move" language is too conservative for this shape because transparent
  sort-policy partitioning is what splits otherwise repeated generated sources into per-object baked
  partitions.
- Decouple repeated generated transparent instance eligibility from baked transparent sort
  partitioning. The cutover owner should be the generated source/object facts plus coverage identity,
  not the current partition slice.
- Preserve explicit transparent objects on the baked/direct path for now. The data says only `3`
  retained outdoor-detail transparent partitions are explicit objects, so chasing them now would be
  a distraction.
- Preserve near-camera sorted transparent behavior. Far enough from the camera, repeated generated
  transparent scenery can be treated as shared instances and batched; near the camera it can still
  fall back to direct sorted submission.

Spicy bits and debt:

- This is a real course correction, not a renderer-only optimization. The bake/cutover layer currently
  treats transparent sort partitions as ownership boundaries, which blocks shared visual resources
  from forming across repeated generated sources.
- The hardest part is avoiding double rendering without doing sloppy partial transparent geometry
  surgery. We need coverage tracking that can remove fully covered generated transparent partitions
  from baked draw units while still leaving mixed or explicit partitions alone.
- If a transparent partition mixes generated cutover geometry with explicit or unsupported geometry,
  keep it baked until we have a principled split. Do not invent a best-effort half-cutover path just
  to make counters look better.

### 2026-06-25 Phase 5A Progress

- Reworked outdoor-detail generated instance grouping so compatible transparent/additive generated
  candidates can form a shared visual resource across baked transparent partition slices.
- Coverage is still tracked per partition slice. A baked transparent partition is only removed when
  all of its triangle coverage is owned by qualifying repeated generated groups, so mixed or explicit
  transparent partitions stay baked/direct.
- Render-instance emission now filters candidates by cutover-owned partition slices. This preserves
  the no-duplicate-rendering invariant even when a visual-resource group spans multiple transparent
  sort partitions.
- Updated the repeated transparent generated outdoor-detail test from "stays baked and reports why"
  to "cuts over to one transparent shared visual resource plus two render instances." The retained
  repeated-source reason bucket is expected to stay at zero for that shape now.

Spicy bits and debt:

- The bake layer now correctly treats "instance-able" as resource eligibility rather than "must always
  be instanced." Transparent render instances still carry direct-sorted transparency metadata so the
  renderer can direct draw near-camera cases and batch far-camera cases later.
- Phase 5B still owns the actual far-transparent `drawElementsInstanced` submission. After this phase,
  live diagnostics should show fewer retained transparent baked draw units, but perf will only fully
  pay off once far transparent render instances stop direct-drawing one by one.
- Mixed transparent partitions remain intentionally conservative. If the live scene still reports
  retained repeated-generated transparent partitions after this, inspect whether those partitions are
  genuinely mixed/unsupported before reaching for geometry surgery.

### 2026-06-25 Phase 5B Progress

- Far transparent shared render instances now group by shared visual resource id and use the existing
  `drawElementsInstanced` path when at least two compatible instances are outside
  `NEAR_TRANSPARENT_STATIC_SORT_DISTANCE`.
- Near transparent shared render instances keep the direct sorted path. This preserves the existing
  near-camera alpha behavior while allowing far generated scenery to batch.
- Added renderer/runtime summary counters for near transparent direct render-instance draws, far
  transparent direct fallback draws, far transparent instanced draw calls, and far transparent
  instanced instance count.
- Added a focused WebGL2 renderer test proving two far transparent shared outdoor-detail render
  instances submit as one instanced draw and report the transparent-specific counters.

Spicy bits and debt:

- Singleton far transparent render-instance groups still direct draw. That is intentional because
  instancing a one-item group is bookkeeping cosplay, not a perf win.
- Transparent grouping is still resource-id local. It will not merge across compatible resources with
  equivalent material state, and that is fine until live data proves resource fragmentation is the
  next bottleneck.
- Direct and instanced static material binding setup remain duplicated. Phase 8 cleanup should extract
  the shared bind/upload helper before adding more submission branches.

### 2026-06-25 Phase 5A/5B Live Diagnostic Readout

Fresh runtime diagnostics after the transparent cutover and far-transparent instancing show the
course correction worked:

- Outdoor-detail baked direct draw calls dropped from `186` to `27`.
- Outdoor-detail transparent baked direct draw calls dropped from `162` to `3`.
- Retained repeated generated transparent outdoor-detail partitions dropped from `159` to `0`.
- Far transparent shared render instances now submit as `26` instanced draw calls for `159`
  instances.
- The remaining `3` outdoor-detail transparent baked direct draws line up with the intentionally
  retained `explicitObject: 3` bucket.

Decision:

- The transparent generated outdoor-detail path is no longer the main perf pressure point. Remaining
  direct draw pressure is mostly outside outdoor detail: total baked static direct draws are still
  `242`, `directEnvCellDrawCalls` is still `417`, and the largest recent static-object upload is
  `landblock-env-cells`.
- Treat the mismatch between the old `staticObjectBakeSummary.instancedRenderInstanceCount` (`392`) and
  renderer `staticObjectRenderInstances` (`344`) as diagnostic accounting debt, not as a rendering
  correctness bug. The bake summary is summing bake diagnostic reports; the renderer count is live
  committed/drawable state.
- Narrow Phase 6 to a mini hardening pass before the next perf hunt. Clean up diagnostic accounting
  and run a query identity smoke test first, then resteer toward the next pressure point.

Spicy bits and debt:

- The current report names make bake-output totals look like live state. That is sus because it sends
  reviewers hunting for dropped instances when the populations are not required to match.
- Do not add warning logic for this mismatch unless we first define two counts that are supposed to
  describe the same population.
- Env-cell/static direct draw pressure probably deserves the next perf hunt, but doing that before
  the diagnostic accounting cleanup leaves us driving with muddy counters. Do the small cleanup first;
  do not turn Phase 6 into a giant debug-panel polish phase.

### 2026-06-25 Phase 6A Progress

- Renamed the copied runtime report's static-object bake summary counters from
  `instancedRenderInstanceCount` / `instancedVisualResourceCount` to
  `bakedInstancedRenderInstanceCount` / `bakedInstancedVisualResourceCount`.
- Applied the same `bakedInstanced*` naming to `largestBake`, so sample bake rows do not look like
  live renderer state either.
- Kept the lower-level `StaticObjectBakeDiagnostics` contract unchanged. Those records are
  bake-local by construction; the ambiguity was in the aggregated runtime report copy.
- Tightened the generated outdoor-detail shared-instance bake test so emitted render instances must
  retain required bounds, source identity, generated metadata, and landblock ownership.

Spicy bits and debt:

- This is a clean report-shape cutover. No legacy aliases were kept because the old field names were
  the footgun.
- The smoke test proves render-instance identity/bounds are emitted correctly at bake time. It does
  not add a committed scene-query index for render instances; if query UI needs to inspect render
  instances directly instead of the original static object payload, that is still real follow-up work.
- Live committed coordinator-side shared-resource counters were not added because renderer live
  counters already provide the current draw-state truth. Add coordinator parity only if the next perf
  hunt needs a non-renderer owner view.

### 2026-06-25 Phase 6B Resteer Wrap-Up

Final compact diagnostics after Phase 6A made the generated-static report read clearly:

- Outdoor-detail baked direct draw calls: `27`.
- Outdoor-detail transparent baked direct draw calls: `3`.
- Outdoor-detail render instances: `344`.
- Outdoor-detail visual resources: `96`.
- Static object instanced render-instance draws: `81` draw calls for `344` instances.
- Far transparent instanced render-instance draws: `26` draw calls for `159` instances.
- Retained repeated generated transparent outdoor-detail partitions: `0`.
- Bake-produced outdoor-detail render instances: `392` under
  `staticObjectBakeSummary.bakedInstancedRenderInstanceCount`.
- Live renderer render instances: `344` under `renderer.summary.staticObjectRenderInstances`.

Profiler readout:

- The sampled hot path is no longer outdoor-detail generated instancing. The expensive stack is
  `renderFrame -> #renderDirectEnvCellFramePlan -> #drawPortalProjectionMaskedLayers ->
  #drawStaticMaterialResourceSet`.
- The time inside that path is mostly static material setup and direct static submission:
  `#drawStaticMaterialResource`, `uploadStaticObjectMaterialTableUniforms`,
  `uploadStaticObjectRolePageBindings`, `uniformMatrix4fv`, and `drawElements`.
- The shared instanced path appears under `#renderSceneDomainTarget ->
  #drawStaticObjectInstanceGroup`, but it is not the dominant sampled cost.

Decision:

- Close the generated outdoor-detail static-instancing perf hunt here. The in-scope generated-static
  work moved the intended counters, and the remaining outdoor-detail direct draw pressure is small and
  mostly explicit-object/alpha-test/opaque leftovers.
- Do not fold env-cell or portal-projection optimization into this plan. `directEnvCellDrawCalls`,
  `landblock-env-cells` upload volume, and portal projection masked-layer CPU cost are real, but they
  deserve a separate focused plan or a follow-up perf effort.
- Keep the Phase 8 material-binding cleanup because the profile upgraded it from pure maintainability
  debt to a plausible local perf lever. That cleanup must stay scoped to shared static material setup,
  not become an env-cell draw-reduction project.

Spicy bits and debt:

- The profile makes our renderer cleanup debt less theoretical: duplicated direct/instanced static
  material binding now shows up in a hot sampled path. Still, the correct fix is a scoped binding
  helper extraction, not a surprise rewrite of portal projection.
- The remaining perf cliff is probably architectural around env-cell/static direct draw pressure.
  Treat it as out of scope here so this plan can actually finish instead of turning into an amoeba.

## Implementation Phases

### Phase 0: Baseline And De-Instancing Diagnostics

- Add outdoor-detail diagnostics that report generated instance count, explicit object count, unique
  source count, unique source-part/geometry count, source triangle count, flattened triangle count,
  draw-unit count, partition count, and estimated flattened typed-array bytes.
- Add coarse timing probes for resolver/source-closure time, static attachment creation, bake worker
  time, coordinator commit time, and renderer static object upload time, grouped by static domain.
- Add renderer diagnostics for static object resource count and uploaded buffer bytes for
  outdoor-detail layers.
- Compare at least one generated-heavy landblock before structural changes and record the baseline in
  implementation notes or diagnostics output.
- Keep diagnostics low-impact and removable/refinable; do not route core abstractions around debug
  consumers.

### Phase 1: Inventory And Contracts

- Inventory generated outdoor static object draw units and identify which repeated objects retain
  enough source identity to become instances.
- Use Phase 0 diagnostics to identify the first generated-heavy target landblocks and the dominant
  cost center: source resolution, attachment creation, bake flattening, renderer upload, or draw
  submission.
- Define shared visual resource key and render instance contracts in the renderer/static contract
  layer, with professional comments on fields whose equality affects GPU reuse.
- Define transparency sort policy as data, not as implicit renderer branch behavior.
- Add focused tests for key stability, non-key instance fields, and resource grouping.

### Phase 2: Static Generated Instance Production

- Extend the outdoor static object bake/resolution path to emit eligible generated outdoor detail
  objects as shared visual resource definitions plus render instances.
- Extend the static object contracts explicitly: `StaticBakeBatchResult`,
  `StaticCoordinatorCommitDelta`, and `OutdoorDetailsLayerPayload` need first-class fields for
  instanced object visual resources and render instances. Do not smuggle these through existing
  draw-unit arrays or renderer-local side channels.
- Keep incompatible static object partitions on the existing baked static draw-unit path.
- Avoid the current `object -> part -> triangle -> flattened vertex` bake path for eligible generated
  instances. Source geometry should remain in shared visual resources while placement, scale, bounds,
  and source/debug identity stay on render instances.
- Preserve per-instance source mapping, bounds, and static scene-query identity.
- Add diagnostics that report generated static instance count, shared resource count, retained-baked
  reasons, and avoided flattened triangle/byte estimates.

### Phase 3: Renderer Shared Resource Cache

- Add a WebGL2 object visual resource cache keyed by shared visual resource key or a resolved stable
  resource id.
- Upload geometry and material binding data once per shared visual resource.
- Generalize texture binding ownership away from draw-unit id for object resources.
- Render static generated instances by binding the shared resource and applying each instance
  transform.
- Keep existing baked static draw-unit rendering as a first-class parallel path.

### Phase 4: WebGL2 Instanced Draw Path

- Add per-instance transform buffers for compatible opaque and alpha-tested generated static
  instances.
- Use `drawElementsInstanced` only for groups with identical visual resource, material pass, render
  state, and sort policy.
- Preserve direct draw fallback for unsupported browsers, debug modes, transparent near-camera
  groups, and small instance counts where batching is not useful.
- Report direct sorted, direct unsorted, and instanced draw counts in renderer diagnostics.

### Phase 5A: Transparent Generated Cutover Course Correct

- Treat repeated generated transparent outdoor-detail objects as shared-instance candidates even when
  transparent sort policy split them into per-object baked partitions.
- Build transparent generated visual-resource candidate groups across partition slices using
  source-local geometry, material binding identity, and generated source identity. Partition slice id
  must not be part of the shared visual-resource grouping key for this case.
- Track candidate coverage per partition slice so fully covered generated transparent partitions can
  be removed from baked draw units without duplicate rendering.
- Keep mixed, explicit, unsupported, missing-bounds, and non-renderable/deferred transparent
  partitions baked/direct until a later phase proves a clean split.
- Carry transparency sort policy and bounds on the emitted render instances so renderer submission can
  choose near direct sorting or far instanced batching without re-deriving eligibility.
- Update retained transparent diagnostics so the `repeatedGeneratedSourceRetainedByPartitionPolicy`
  bucket falls sharply after cutover; any remaining count must describe true mixed/unsupported cases,
  not merely sort-policy partitioning.
- Add focused bake tests showing repeated generated transparent outdoor-detail partitions cut over to
  one shared visual resource plus render instances and no longer emit duplicate baked draw units.

### Phase 5B: Alpha-Blended Instanced Submission Policy

- Preserve existing depth-sorted behavior for near-camera transparent render instances using direct
  sorted draws when needed.
- Add per-instance transform/sort metadata buffers for compatible transparent generated static
  instances outside `NEAR_TRANSPARENT_STATIC_SORT_DISTANCE`.
- Use instanced draws for compatible transparent generated statics outside
  `NEAR_TRANSPARENT_STATIC_SORT_DISTANCE`. Direct grouped transparent draws are a bring-up/fallback
  behavior only, not the desired steady-state for generated outdoor statics.
- Report near transparent direct sorted draws, far transparent direct sorted draws, far transparent
  instanced draw calls, and far transparent instanced instance count.
- Add tests for sort-policy classification and renderer draw-list construction where practical.

### Phase 6A: Diagnostic And Query Hardening Mini-Phase

- Keep this phase intentionally small. Its job is to make the next perf hunt trustworthy, not to
  polish every debug surface.
- Split diagnostics that describe bake-produced totals from diagnostics that describe live committed
  renderer/coordinator state. Keep `bakedInstancedRenderInstanceCount`-style report fields scoped to
  bake-output totals and use renderer live counters for current drawable render-instance counts.
- Add live committed shared static-object counters only if coordinator-side parity is needed:
  committed render-instance count, committed visual-resource count, and retained baked draw-unit
  count. Renderer live counters remain the draw-state source of truth.
- Add or run a focused static scene-query smoke test proving instanced generated objects still expose
  semantic source identity, landblock ownership, and required bounds in the expected coordinate
  convention.
- Verify generated static instance bounds are current and landblock-local in the same coordinate
  convention as existing outdoor static query records.
- Avoid broad debug UI work, row-level report expansion, or tests that only assert diagnostic report
  shape.

### Phase 6B: Perf Resteer Gate

- Completed: record final outdoor-detail generated-static before/after numbers from the compact diagnostics:
  baked draw calls, transparent baked draw calls, render instances, visual resources, instanced draw
  calls, retained transparent reasons, flattened bytes, and uploaded bytes.
- Completed: decide whether the next perf effort belongs in this plan. Current evidence points at
  `directEnvCellDrawCalls`, `landblock-env-cells` static-object uploads, portal-projection masked
  layers, and non-outdoor-detail baked static direct draws, so that work is out of scope for this
  generated-static instance plan.
- Do not start env-cell/static direct-draw optimization inside this plan. Open a focused follow-up
  plan if that becomes the next priority.

### Phase 7: Dynamic Entity Resteering Gate

- Revisit the dynamic entity requirements plan after the shared static instance path lands.
- Confirm that dynamic entity parts can reuse the same shared visual resource key, material binding
  ownership, texture cache, scene-domain submission, and render instance contract.
- If dynamic entities need extra per-instance fields, add them as optional or domain-specific
  metadata without forking the core resource cache.
- Delete or replace `applyDynamicDelta()` with the real declarative dynamic scene commit API before
  implementing dynamic renderer submissions.

### Phase 8: Cleanup And Contract Hardening

- Remove or demote Phase 0 diagnostics that no longer guide implementation once before/after
  generated-static metrics are captured. Keep only stable, useful runtime counters and targeted
  inspectors.
- Delete temporary compatibility shims, bring-up-only direct draw paths, and transitional names after
  the shared resource/instance contracts become the primary generated-static path.
- Remove the renderer-side `isDrawSuppressedByBakedLayer` remnant after Phase 6A confirms instance
  emission is exclusively cutover-owned and query identity does not depend on the old suppression
  bridge.
- Extract shared static-material binding setup for direct and instanced static-object draws so
  texture/material uniform upload logic does not fork across draw modes.
- Collapse or remove transitional static object draw-unit fields that duplicate `materialEntries`,
  `materialSlotIndices`, visual resource metadata, or renderer-owned derived summaries.
- Audit texture binding ownership and remove draw-unit-only assumptions for shared object visual
  resources.
- Revisit report output after Phase 6A and keep the general runtime report summary-level. Row-level
  bake/upload/timing detail should live behind explicit inspectors, not the copy report.
- Audit remaining diagnostic fields that blur bake-output history with current renderer state. The
  report should not imply `staticObjectBakeSummary.bakedInstancedRenderInstanceCount` and renderer
  `staticObjectRenderInstances` are expected to match unless they are computed from the same committed
  population.
- Re-run the `0xda56ffff` baseline comparison and update the plan with final before/after numbers:
  flattened triangles, flattened bytes, uploaded object bytes, shared resource count, retained-baked
  count, direct draw count, and instanced draw count.
- Scrub tests that only assert diagnostic report shape or legacy absence. Keep behavior tests for
  resource keying, instance grouping, renderer submission, query identity, and transparency policy.

## Acceptance Criteria

- Repeated eligible generated outdoor static objects share GPU geometry/material resources instead of
  uploading one VAO/buffer set per instance.
- Baseline diagnostics demonstrate that eligible generated statics no longer pass through the
  flattened static object triangle/vertex bake path.
- Outdoor-detail diagnostics expose source count, generated instance count, shared resource count,
  flattened baked triangle count, render instance count, and estimated uploaded bytes.
- Renderer diagnostics expose instance count, shared visual resource count, retained-baked count,
  direct sorted draw count, direct unsorted draw count, and instanced draw count.
- Compatible high-count opaque, alpha-tested, and outside-`NEAR_TRANSPARENT_STATIC_SORT_DISTANCE`
  transparent generated statics use WebGL2 instanced draws before the generated-static instance path
  is broadly enabled.
- Static scene query and debug inspection continue to return semantic per-instance source identity.
- Texture bindings for shared object resources no longer require draw-unit id ownership.
- Alpha-blended generated statics preserve current near-camera sorting behavior or report any known
  compromise explicitly.
- Dynamic entity renderer planning can point at the shared resource/instance path as the intended
  dependency.

## Risks And Mitigations

- Visual resource keys may be too broad or too narrow. Mitigate with explicit key fields and tests
  proving that instance-only fields do not fragment resources.
- Existing static compatibility bakes may merge geometry in ways that lose instance identity.
  Mitigate by targeting generated outdoor detail objects first and leaving incompatible partitions on
  the existing path.
- Source resolution may still dominate landblocks with many unique generated sources. Mitigate by
  measuring source count and source-resolution timing separately from bake/upload timing before
  optimizing the renderer path further.
- Direct draws over shared resources may reduce bake/upload cost while increasing draw-call count for
  large generated groups. Mitigate by treating direct draws as bring-up/fallback only and requiring
  WebGL2 instanced draws before broadly enabling generated outdoor static instancing.
- Transparent sorting may conflict with batching. Mitigate with explicit sort policy and direct sorted
  fallback.
- Texture binding code is currently draw-unit keyed. Mitigate by moving object texture bindings to
  shared resource ownership before dynamic entities consume the path.
- Instanced draw implementation can become a distraction if attempted before the resource/instance
  contract is proven. Mitigate by using direct draws for bring-up only, then requiring instanced draws
  for compatible generated groups before broad enablement.

## Definition Of Done

- A generated-heavy outdoor landblock has before/after diagnostics showing reduced flattened geometry
  work or uploaded object buffer bytes for eligible generated statics.
- Eligible generated outdoor static instances render through shared visual resources and per-instance
  submissions while preserving visual placement, scale, material behavior, and source identity.
- Generated objects retained on the baked static draw-unit path remain renderable with clear
  retained-baked reasons.
- Static scene query and debug inspection still identify individual generated static instances.
- Renderer texture/material binding ownership is no longer coupled only to draw-unit id for shared
  object visual resources.
- Dynamic entity renderer planning can reuse the same visual resource and render instance contracts.

## Open Questions

- First baseline target is `0xda56ffff` under
  `manual|outdoor-anchor|0xda55ffff|buildings,detail,env-cells,terrain`; we should add more targets
  only if Phase 1 discovers this landblock is not representative.
- What instance-count threshold should choose direct draws versus WebGL2 instanced draws for low-count
  generated static groups? The near transparent static sort distance already exists and should be
  reused initially.
- Are any generated outdoor statics using material variants, palette overrides, or alpha-blended
  sorting behavior that make them poor candidates for the first shared-resource path?

## Deferred Work

- Dynamic entity implementation.
- Resource atlas packing and vertex compaction.
- Full conversion of buildings, terrain, structured interiors, and all static object partitions.
- Replacing baked static object batches where they are already the better long-term representation.
- Particle/effect instance rendering.
- Cross-landblock generated static instance merging beyond the renderer cache's safe resource key
  semantics.
