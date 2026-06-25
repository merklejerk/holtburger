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

### Phase 4: Query And Debug Parity

- Ensure static scene query continues to return semantic static source identity for instanced
  generated objects.
- Surface debug counters for shared resources, render instances, direct draws, instanced draw
  eligibility, and retained-baked reasons.
- Verify that generated static instance bounds are current and landblock-local in the same coordinate
  convention as existing outdoor static query records.

### Phase 5: Alpha-Blended Policy

- Carry transparency sort policy on generated static instances.
- Preserve existing depth-sorted behavior for near-camera transparent objects using direct sorted
  draws when needed.
- Use instanced draws for compatible transparent generated statics outside
  `NEAR_TRANSPARENT_STATIC_SORT_DISTANCE`. Direct grouped transparent draws are a bring-up/fallback
  behavior only, not the desired steady-state for generated outdoor statics.
- Add tests for sort-policy classification and renderer draw-list construction where practical.

### Phase 6: WebGL2 Instanced Draw Path

- Add per-instance transform buffers for compatible opaque and alpha-tested generated static
  instances.
- Add per-instance transform/sort metadata buffers for compatible transparent generated static
  instances outside `NEAR_TRANSPARENT_STATIC_SORT_DISTANCE`.
- Use `drawElementsInstanced` only for groups with identical visual resource, material pass, render
  state, and sort policy.
- Preserve direct draw fallback for unsupported browsers, debug modes, transparent near-camera
  groups, and small instance counts where batching is not useful.
- Report direct sorted, direct unsorted, and instanced draw counts in renderer diagnostics.

### Phase 7: Dynamic Entity Resteering Gate

- Revisit the dynamic entity requirements plan after the shared static instance path lands.
- Confirm that dynamic entity parts can reuse the same shared visual resource key, material binding
  ownership, texture cache, scene-domain submission, and render instance contract.
- If dynamic entities need extra per-instance fields, add them as optional or domain-specific
  metadata without forking the core resource cache.
- Delete or replace `applyDynamicDelta()` with the real declarative dynamic scene commit API before
  implementing dynamic renderer submissions.

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

- Which generated-heavy landblocks should be used as the first baseline and visual regression targets?
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
