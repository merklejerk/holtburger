# Holtburger 3D Compacted Render Family Pipeline Replacement Plan

Status: Active detour; replaces the next compacted/baked material work in the WebGL2 material atlas
continuation plan.

Related plans:

- [Holtburger 3D WebGL2 Material, Portal, and Atlas Continuation Plan](./holtburger-3d-webgl2-material-atlas-continuation-plan.md)

## Purpose

Replace the current baked/compacted WebGL2 architecture instead of adding another parallel path for
indexed, alpha, and future material families. The current RGBA atlas path became the implicit
definition of "baked geometry," so every new material family now requires parallel plan fields,
parallel resource collections, parallel diagnostics, and careful exceptions. That is the wrong
pressure: the architecture is growing more code before it can represent the next material pipeline.

This detour should produce less code at the end. It should remove the RGBA-atlas-shaped baked
resource model and replace it with:

- material-aware compaction planning;
- material-agnostic compacted geometry data;
- explicit render family pipelines that own material resources and drawing behavior for both direct
  and compacted geometry submissions.

The concrete end goal is to finish the work the previous plan could not cleanly finish: implement
compacted indexed/paletted material rendering. The replacement work is justified only if it makes that
implementation smaller, more direct, and less duplicative than continuing to bolt indexed rendering
onto the old RGBA-atlas-shaped baked path.

Do not implement this as a long-lived second compacted pipeline. Temporary migration scaffolding is
acceptable only when each phase deletes or replaces an old concept in the same change.

## Problem Statement

The current architecture mixes four concepts:

- compacted geometry buffers;
- RGBA texture atlas material tables;
- baked draw replacement planning;
- metrics/debug vocabulary.

Because those are coupled, indexed/paletted work already needed several phases before any indexed
shader path could draw:

- `submitFamilies.indexedPaletted` had to be added beside RGBA atlas fields.
- `buildBakedGeometry()` had to be relaxed away from RGBA material slots.
- `bakedIndexedGeometryBatches` had to be added beside `bakedGeometryBatches`.
- Diagnostics still report `bakedGeometry*` mostly as RGBA atlas submitted resources.
- `missing-baked-indexed-paletted-family` remains as a blocker even when indexed compacted resources
  are partially planned.

That is a sign that the current boundary is too patchwork. The renderer should not need thousands of
lines of parallel shape before it can reach the material-family implementation.

## Target Architecture

### Material-Aware Compaction Planning

The compaction planner may and should understand materials. Batching decisions depend on material
facts:

- render family;
- texture-page set;
- render state;
- alpha policy;
- data texture requirements;
- material table limits;
- draw slice compatibility;
- ordering/sorting constraints;
- geometry layout requirements.

Planning output should be explicit and minimal:

- a family pipeline kind;
- compactable draw unit IDs;
- local material slot assignment;
- slice partitioning;
- resource dependency keys needed by the family pipeline.

The planner is where material knowledge belongs.

### Material-Agnostic Compacted Geometry

The compaction data and buffer builder must not know about atlas rects, palette records, texture
page keys, alpha behavior, shader variants, or material resource formats.

The compacted geometry model should be shaped around:

```ts
interface CompactedGeometryBatch {
  key: string;
  landblockId: number;
  layout: CompactedGeometryLayout;
  batchModelMatrix: RenderMat4;
  positions: Float32Array;
  uvs: Float32Array;
  materialSlotIndices: Float32Array;
  indices: Uint16Array | Uint32Array;
  drawRanges: CompactedDrawRange[];
  slices: CompactedGeometrySlice[];
}
```

For current RGBA texture-page and indexed/paletted work, the first layout should be:

```ts
type CompactedGeometryLayout = "position-uv-material-slot";
```

Future layouts may add normals, vertex colors, tangents, secondary UVs, or lightmap UVs. Those are
geometry layout variants, not family-specific material payloads.

### Render Family Pipelines

A render family pipeline is a bespoke material draw pipeline. It owns:

- material resource collection;
- family material table shape;
- texture/page/palette bindings;
- shader/program selection;
- uniform/table upload;
- render-state setup;
- drawing direct geometry submissions for that family;
- drawing compacted geometry slices for that family;
- family-specific metrics and blockers.

The direct and compacted paths should be isomorphic at the render-family boundary, but not identical
in resource lifecycle. Direct draw is used for dynamic entities and incrementally hydrated objects.
Compacted draw is a static/locality optimization. A direct draw unit may be modeled as a single-draw
geometry submission for family-pipeline purposes:

```ts
interface DirectGeometrySubmission {
  mode: "direct";
  drawUnitId: string;
  layout: GeometrySubmissionLayout;
  vertexArrayKey: string;
  modelMatrix: RenderMat4;
  firstIndex: 0;
  indexCount: number;
  materialSlotIndex: 0;
}
```

For a single direct draw, `modelMatrix` is effectively a degenerate batch model matrix and the whole
index buffer is one slice. This is a conceptual and API-level isomorphism, not a requirement to turn
direct draw resources into compacted resources.

Compacted submissions keep their landblock/static lifecycle:

```ts
interface CompactedGeometrySubmission {
  mode: "compacted";
  geometryBatchKey: string;
  layout: GeometrySubmissionLayout;
  vertexArrayKey: string;
  batchModelMatrix: RenderMat4;
  slices: CompactedGeometrySlice[];
}
```

Both submission modes should reach the same family pipeline material code where practical. They differ
at the geometry adapter:

- direct mode uploads per-draw model matrices and draws one resource at a time;
- compacted mode uploads batch matrices, material-slot tables, and draws compatible slices;
- dynamic entities stay direct-lifecycle resources and do not participate in static compaction
  rebuilds.

Initial families:

- `rgba-texture-page`: current RGBA base/detail texture-page path, including packed atlas and
  single-entry pages.
- `indexed-paletted`: indexed texel page plus palette page, initially opaque only.

Later families:

- `alpha-rgba-texture-page`: or an extension of `rgba-texture-page` if alpha-test/blend policy fits
  cleanly inside the same shader family.
- indexed alpha variants if palette/material alpha can be made explicit without mixing it into the
  opaque indexed path.
- terrain remains separate unless a future terrain-specific compaction plan proves value.

Family-specific payloads must live beside compacted geometry and be keyed by local material slot
indices and slice keys. They must not live inside the geometry batch.

Example RGBA family payload:

```ts
interface RgbaTexturePageFamilyBatch {
  geometryBatchKey: string;
  materialSlots: RgbaTexturePageMaterialSlot[];
  slices: RgbaTexturePageSlice[];
}
```

Example indexed family payload:

```ts
interface IndexedPalettedFamilyBatch {
  geometryBatchKey: string;
  materialSlots: IndexedPalettedMaterialSlot[];
  slices: IndexedPalettedSlice[];
}
```

## Replacement Rules

- Replace current architecture in place. Do not create a durable `v2` pipeline beside the old baked
  path.
- A phase should delete or collapse old RGBA-atlas-shaped concepts whenever it introduces the
  family-pipeline equivalent.
- Temporary adapters are allowed only as migration handles. Every adapter introduced by a phase must
  have either:
  - a deletion task in the same phase; or
  - a named deletion target in the cleanup phase.
- Do not wrap the new render family pipeline architecture around the old material-kind branch,
  `BakedRenderablePlan` root fields, `submitFamilies`, `bakedGeometryBatches`, or
  `bakedIndexedGeometryBatches` as an enduring compatibility layer.
- A phase is not complete if it only adds a new family-shaped view while leaving the old path as the
  authoritative owner of the same behavior. The new shape must either become authoritative in that
  phase or have an explicit next-phase takeover/deletion target.
- Avoid compatibility shims and reexports. Rename aggressively when the old name encodes the wrong
  model.
- Keep direct draw working throughout. Direct draw is the visibility safety path while compacted
  replacement changes.
- Mirror the render family pipeline boundary in direct draw. The goal is one material family model
  with direct and compacted geometry adapters, not one direct material architecture plus one compacted
  material architecture.
- Do not force dynamic direct draw resources into compacted resource lifecycles for purity. The
  isomorphism is at the geometry submission/family pipeline boundary.
- Do not broaden material coverage during the architecture replacement except where needed to prove
  the family boundary.
- Diagnostics should measure true states:
  - compacted geometry resources planned/built;
  - family pipeline resources planned/built;
  - family pipelines actually rendered;
  - direct draw units actually replaced.
- Retire misleading `bakedGeometry*` names after their replacement names exist.

## Codebase Dry Run Findings

These findings come from tracing the current WebGL2 resource and draw paths before starting the
replacement work.

- Direct draw VAO construction currently lives in `createOrReuseWebgl2DrawUnit()`. It creates:
  - `position` only for flat draw;
  - `position + uv` for direct texture, indexed/paletted, and terrain blend;
  - no direct material-slot attribute.
- Compacted RGBA batches use `position + uv + materialSlot`. Do not force direct draw to add
  `materialSlot` unless shader sharing requires it. The likely first direct family boundary should
  treat direct material slot `0` as a uniform/family payload fact.
- Direct draw resource creation currently mixes geometry buffers, texture uploads, indexed/palette
  uploads, detail overlays, terrain resources, texture-page binding facts, bake eligibility, and
  diagnostics in one `Webgl2WorldDrawUnit` construction path. C2 must add typed views first; C3 can
  then move behavior into family pipelines.
- The central direct draw loop in `submitWebgl2FlatWorldDrawUnits()` owns program selection, texture
  binding, uniform upload, render-state application, metrics, and draw calls. Family pipelines need a
  shared draw context for `gl`, `stateCache`, view/projection data, and metrics so this does not turn
  into copied logic.
- Direct RGBA and direct indexed shaders already share the `position + uv` vertex shader shape.
  Compacted RGBA uses a different vertex shader with `uViewProjection`, `uBatchModel`, and
  `materialSlot`. Shader unification is not required for C2 or C3; the boundary can be introduced
  while preserving current shaders.
- Direct texture-page bindings are first collected as single-entry pages, then `resolveWebgl2DrawUnitTexturePageBindings()`
  mutates base-color bindings after packed atlas generation exists. The family pipeline resource plan
  must preserve this ordering or replace it with an explicit two-stage page-resolution step.
- Texture-page bindings currently carry `Webgl2Texture2DResource`, so they are not pure material
  facts. A cleaner architecture should distinguish texture-page facts from realized WebGL texture
  resources before compacted and direct paths can share planning cleanly.
- Existing staged assembly already splits static/structured-interior surfaces into material-specific
  draw units. The replacement plan should reuse that as the direct draw granularity and should not
  begin by refactoring staged assembly.
- Replacement planning currently filters visible direct draw units before the central direct loop and
  only understands RGBA baked resources. Family-aware replacement must happen after family resource
  readiness is known and must not count merely planned indexed resources as rendered.
- Resource graph retention exists for RGBA baked batches and texture atlas generations. The temporary
  indexed compacted batch path has no equivalent graph lease. C5 should collapse lifecycle ownership
  and C7 should delete old patterns before C8 relies on indexed compacted resources.
- Render state is currently applied per draw unit through `applyDrawUnitRenderState()`. Family
  pipelines must own render-state requirements but should reuse the existing state-cache helpers.
- Diagnostics are heavily `bakedGeometry*` and material-kind oriented. C6 must update names after the
  resource shape changes, not before, or debug output will get noisier.

## Desired End State

- `buildCompactedGeometryBatch()` is the compacted geometry builder and has no material-family
  imports.
- WebGL2 resource store has one compacted resource model, not one RGBA baked map plus one indexed
  baked map.
- Render family pipelines consume compacted geometry plus family payloads.
- Direct draw and compacted draw share render family classification, material resource collection
  concepts, shader ownership, render-state policy, and diagnostics vocabulary.
- Direct draw and compacted draw keep separate geometry/resource lifecycles.
- RGBA texture-page and indexed-paletted families share compaction data but not material payloads.
- Opaque indexed/paletted static and structured-interior draw units render through compacted indexed
  family pipelines, replacing their direct draw calls when visible.
- Metrics are shorter and less ambiguous.
- The next material family should require adding a family pipeline, not threading parallel fields
  through every baked/render-store/diagnostic layer.

## Phase C1: Name the Real Boundary and Freeze Old Growth

Status: Complete.

Purpose: stop extending the old baked/RGBA atlas architecture and make the intended replacement
boundary explicit in code and docs before adding more material behavior.

Tasks:

- Mark the old M7D.5b baked indexed submit variant as paused/superseded by this replacement plan.
- Rename plan language from "submitter" or "submit family" to "render family pipeline."
- Add a short code comment or type-level note at the current `submitFamilies`/`bakedIndexedGeometry`
  boundary stating it is temporary migration debt, not the target architecture.
- Add direct draw to the replacement boundary: render family pipelines must support direct geometry
  submissions as well as compacted submissions, while preserving direct-lifecycle resources for
  dynamic entities.
- Add a dry-run inventory table to this plan or nearby implementation notes mapping current code to
  replacement concepts:
  - `createOrReuseWebgl2DrawUnit()` -> direct geometry/resource construction;
  - `submitWebgl2FlatWorldDrawUnits()` -> direct family draw orchestration;
  - `texture-page-binding.ts` -> texture-page facts plus realized texture resources;
  - `baked-renderable-planner.ts` -> material-aware compacted planning;
  - `baked-geometry.ts` -> material-agnostic compacted geometry candidate;
  - `webgl2-baked-geometry-batches.ts` -> compacted geometry resource plus temporary family payloads;
  - `webgl2-baked-submit.ts` -> RGBA texture-page compacted family draw path.
- Inventory the old concepts that must be deleted or renamed:
  - `BakedRenderablePlan` root RGBA atlas fields;
  - `submitFamilies`;
  - `bakedGeometryBatches`;
  - `bakedIndexedGeometryBatches`;
  - `Webgl2BakedGeometryBatchResource`;
  - `bakedGeometry*` diagnostics that mean only RGBA submitted geometry.
- Do not add any new material family behavior in this phase.

Progress:

- Marked the old material atlas continuation plan as paused after M7D.5b4 and pointed follow-up
  compacted material work here.
- Added code-level migration notes at the old `BakedRenderablePlan.submitFamilies` boundary and the
  temporary `Webgl2WorldResourceStore.bakedIndexedGeometryBatches` resource map.
- Replaced the implicit "submit family" direction with render family pipeline terminology for future
  work.
- Confirmed direct draw is in scope for the same family pipeline vocabulary, while retaining its
  direct/dynamic resource lifecycle.

Decisions:

- Do not continue indexed/paletted rendering by extending `bakedIndexedGeometryBatches`.
- Treat `submitFamilies` as old migration debt. It may remain only until the family pipeline plan
  shape replaces it.
- Direct draw and compacted draw should become isomorphic at the family/submission boundary, not by
  sharing the same resource lifecycle.

Dry-run inventory:

| Current code                                 | Replacement concept                                                                    | Phase target |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | ------------ |
| `createOrReuseWebgl2DrawUnit()`              | direct geometry/resource construction plus direct family material payload construction | C2/C3        |
| `submitWebgl2FlatWorldDrawUnits()`           | direct family draw orchestration and temporary central routing                         | C3/C7        |
| `texture-page-binding.ts`                    | texture-page facts separated from realized WebGL texture resources                     | C3/C5        |
| `baked-renderable-planner.ts`                | material-aware compacted planning and family pipeline planning                         | C4/C5        |
| `compacted-geometry.ts`                      | material-agnostic compacted geometry construction                                      | C4           |
| `webgl2-baked-geometry-batches.ts`           | compacted geometry resources plus temporary family payload resources                   | C5/C7        |
| `webgl2-baked-submit.ts`                     | RGBA texture-page compacted family draw path                                           | C5/C7        |
| `webgl2-world-resources.ts` baked batch maps | unified compacted geometry lifecycle plus keyed family resources                       | C5           |
| `webgl2-render-metrics.ts` baked counters    | compacted geometry, family resource, rendered family, and replacement counters         | C6           |

Old concepts to delete or rename:

- `BakedRenderablePlan` root RGBA atlas fields.
- `submitFamilies`.
- `bakedGeometryBatches`.
- `bakedIndexedGeometryBatches`.
- `Webgl2BakedGeometryBatchResource`.
- `BakedRenderablePolicy` / `DEFAULT_WEBGL2_BAKED_RENDERABLE_POLICY`.
- `atlasEligibility` where it means texture-page/family compaction eligibility rather than atlas
  placement facts.
- `bakedGeometry*` diagnostics that only describe RGBA submitted geometry.

Discovered debt:

- The temporary indexed compacted resource map currently has no graph lease equivalent to the RGBA
  baked batch map. C5 must collapse this lifecycle before C8 depends on indexed compacted rendering.
- Direct texture-page bindings still combine material/page facts with realized WebGL texture
  resources, which will make direct and compacted family planning harder to share until C3/C5 split
  that responsibility.
- Existing staged diagnostics still expose `webgl2-staged-resources` and `baked*` names. Renaming
  these before the resource shape changes would create churn, so C6 should rename them after the
  authoritative family/resource shape exists.

Exit criteria:

- The docs and code comments make it clear that further indexed work must happen through the
  replacement architecture, not by extending the current parallel indexed resource map.
- The plan explicitly treats direct draw as a geometry submission mode of the same family pipeline
  model, not as a separate material architecture.
- The next implementation phase has a deletion-oriented checklist.

## Phase C2: Direct Family Facts and Geometry Submission Views

Status: Complete.

Purpose: introduce typed direct draw family facts and neutral geometry submission views without moving
draw behavior yet. This proves the direct-side vocabulary with minimal risk because direct draw is
already the visibility path for static and dynamic entities.

This phase has direct VBA implications. Current direct draw VBAs are built around per-material-kind
submit assumptions: direct texture, indexed/paletted, terrain, and flat paths each expect their own
attribute/program setup from the central draw loop. The new boundary should make direct VBAs expose a
neutral geometry submission layout first, then let the render family pipeline decide how that layout
is consumed. This is not a request to rebuild dynamic entities into compacted resources; it is a
request to normalize direct draw VAO/VBA construction around family-compatible geometry layouts.

Tasks:

- Start with an explicit deletion-oriented checklist for temporary C2 artifacts:
  - any mapper from `Webgl2WorldDrawUnit` must be deleted or reduced to a construction helper by C7;
  - any direct family classification strings must be typed internally and converted to strings only
    for diagnostics;
  - any shared draw context introduced in C2 must become the context used by C3 family adapters, not a
    passive mirror of the old central loop.
- Inventory current direct draw VAO/VBA construction by family:
  - flat/constant color;
  - RGBA texture-page;
  - indexed/paletted;
  - terrain blend;
  - debug/portal masks.
- Define direct geometry layout contracts before changing buffer construction:
  - `position`;
  - `position-uv`;
  - `position-uv-material-slot` only where the family pipeline needs the same material-slot attribute
    as compacted geometry;
  - later dynamic layouts such as skinned, animated, vertex-color, or secondary-UV variants.
- Decide whether direct `rgba-texture-page` and direct `indexed-paletted` should add an explicit
  one-value material-slot attribute now, or whether the direct family pipeline should supply slot `0`
  as a uniform until compacted and direct shader inputs are unified. Prefer the smaller change unless
  shader sharing requires the attribute.
- Introduce a direct draw family view/adaptor before moving WebGL behavior:
  - `DirectGeometrySubmission`;
  - `DirectFamilyMaterialPayload`;
  - `DirectRenderFamilyKind`;
  - a mapper from `Webgl2WorldDrawUnit` to the above records.
    This mapper is temporary. It must either be deleted when `Webgl2WorldDrawUnit` is split or be
    reduced to a thin construction helper owned by the new direct family path.
- Introduce a shared family draw context for direct pipelines:
  - `gl`;
  - `stateCache`;
  - view/projection matrices;
  - texture unit assignments;
  - metric increment helpers;
  - render-state helpers.
    Do not let each family pipeline invent its own metric accounting.
- Refactor direct VBA creation so material-family-specific assumptions are represented as typed
  geometry layouts and family pipeline requirements, not string/program switches in the central draw
  loop.
- Define neutral direct geometry submission records for current direct draw units:
  - draw unit ID;
  - geometry layout;
  - VAO/resource key;
  - model matrix;
  - index range;
  - local material slot index, initially always `0`;
  - render domain / scene domain routing facts where needed.
- Classify direct draw units by render family:
  - `flat-constant-color`;
  - `rgba-texture-page`;
  - `indexed-paletted`;
  - `terrain-blend`;
  - debug/portal families as explicit non-production families.
- Keep the current central draw loop active. This phase should only add and test the typed views.

Progress:

- Added `webgl2-direct-render-family.ts` with typed direct geometry submission and material payload
  views:
  - `GeometrySubmissionLayout`;
  - `DirectRenderFamilyKind`;
  - `DirectGeometrySubmission`;
  - `DirectFamilyMaterialPayload`;
  - `DirectRenderFamilySubmission`;
  - `mapWebgl2DrawUnitToDirectRenderFamilySubmission()`.
- Labeled direct draw units with `directGeometryLayout`, derived from the actual VAO inputs:
  - `position` when only the position buffer is bound;
  - `position-uv` when a UV buffer is bound;
  - no direct path uses `position-uv-material-slot` yet.
- Confirmed direct RGBA texture-page and indexed/paletted submissions use material slot `0` as a
  family payload fact rather than adding a compacted-only material-slot vertex attribute.
- Added focused tests for flat, RGBA texture-page, indexed/paletted, terrain, and portal-mask/debug
  family mapping.
- Added resource-sync assertions proving flat direct resources are layout-labeled as `position` and
  direct texture resources are layout-labeled as `position-uv`.

Decisions:

- Classify direct family submissions from the active realized resources, matching current draw-loop
  behavior:
  - portal masks route to `debug-pipeline`;
  - terrain resources route to `terrain-blend`;
  - indexed resources route to `indexed-paletted`;
  - realized base textures route to `rgba-texture-page`;
  - remaining units route to `flat-constant-color`.
- Keep the C2 mapper as a temporary migration adapter over `Webgl2WorldDrawUnit`. It is allowed only
  until direct family adapters own RGBA/indexed draw behavior and `Webgl2WorldDrawUnit` can be split.
- Do not introduce a shared family draw context as an unused object in C2. That would create a
  passive mirror of the central loop rather than an owned boundary.

Course correction:

- Added immediate C2.5 before C3 to extract the direct family draw context and route plan in the same
  slice that starts consuming them. This keeps C3 from beginning with a hand-wavy "shared context"
  step and avoids another compatibility shell.

Legacy shims introduced:

- `mapWebgl2DrawUnitToDirectRenderFamilySubmission()` is a temporary mapper from the old
  `Webgl2WorldDrawUnit` aggregate into the new family/submission shape. C7 must delete it or reduce
  it to a construction helper after direct family adapters own behavior.
- `directGeometryLayout` is currently duplicated beside `uvBuffer` so the old draw loop remains
  authoritative. C7 should either keep the layout as the resource contract and delete implicit UV
  checks, or move layout construction into the split direct geometry resource.

Validation:

- `npm exec tsc -- --noEmit`
- `npm exec vitest -- src/lib/world-display/webgl2-direct-render-family.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/webgl2-world-submit.test.ts src/lib/world-display/webgl2-transition-portal-work.test.ts --run`

Exit criteria:

- Every current direct draw unit can be mapped to a `DirectGeometrySubmission` and
  `DirectRenderFamilyKind`.
- Direct draw VBA construction is layout-labeled and no longer implicit in material-kind checks alone.
- Dynamic/direct resources still use direct lifecycle and per-draw transforms.
- Existing direct draw behavior and metrics are unchanged.

## Phase C2.5: Direct Family Draw Context Prep

Status: Complete.

Purpose: prepare C3 by extracting the draw-loop context and route decisions that family adapters will
actually consume. This is an immediate interim phase because adding an unused context object in C2
would have been a passive shim.

Tasks:

- Define a `DirectFamilyDrawContext` that contains only data and helpers consumed by the first C3
  adapters:
  - `gl`;
  - `stateCache`;
  - view/projection matrix;
  - texture unit assignments;
  - metric increment hooks or a narrow mutable metric recorder;
  - render-state helper access.
- Define a typed direct route record for the existing central loop:
  - draw unit;
  - direct render family submission;
  - active program kind;
  - active program resource;
  - indexed program variant where relevant;
  - texture-page binding resolution where relevant.
- Replace local string `programKind` decisions in the central loop with the typed route record without
  moving draw behavior yet.
- Preserve current draw order, state-cache behavior, texture binding order, uniform upload counts,
  and metrics.
- Add tests that prove route construction matches the current program/material decisions for:
  - flat;
  - RGBA texture-page;
  - indexed P8/P16;
  - terrain blend;
  - portal masks/debug.

Progress:

- Added typed direct draw route/context records in `webgl2-world-submit.ts`:
  - `DirectFamilyDrawContext`;
  - `DirectFamilyDrawTextureUnits`;
  - `Webgl2DirectDrawPrograms`;
  - `Webgl2DirectDrawRoute`;
  - `Webgl2DirectProgramKind`.
- Added `DIRECT_FAMILY_DRAW_TEXTURE_UNITS` as the first explicit texture-unit contract for direct
  family drawing:
  - RGBA base/detail use units 0/1;
  - indexed texels/palette/detail use units 0/1/2;
  - terrain keeps its existing 0-9 unit layout.
- Added `planWebgl2DirectDrawRoute()` to construct the typed route record used by the central loop.
  It carries the direct family submission, active program, indexed variant, texture-page binding,
  active base texture, detail texture unit, and family booleans.
- Replaced the central loop's local `useTerrainBlend` / `useIndexed` / `useTexture` / string
  `programKind` route derivation with the typed route record.
- Kept draw order, state-cache behavior, texture binding order, uniform upload counts, and metrics
  unchanged.
- Added route construction tests for flat, RGBA texture-page, indexed P8, indexed P16, terrain blend,
  and portal-mask/debug routing.

Decisions:

- Keep route construction in `webgl2-world-submit.ts` for now. It is the current owner of direct draw
  orchestration, and moving the helper to a new module before C3 would create a second submit-shaped
  home without deleting anything.
- Preserve the current behavior where portal masks use the flat program but classify as
  `debug-pipeline` at the direct family view boundary.
- Preserve texture-page binding resolution in the route record for C2.5. C3 should move RGBA
  texture-page binding/use into the RGBA direct family adapter, then delete the central-loop duplicate
  logic in the same phase.

Course corrections:

- The route record intentionally still exposes family booleans (`usesRgbaTexturePage`, `usesIndexed`,
  `usesTerrainBlend`) because C3 needs a low-risk bridge from central-loop branches to adapter calls.
  These should shrink once RGBA and indexed adapters own their material work.
- `DirectFamilyDrawContext` currently carries state and texture-unit contracts but not a formal metric
  recorder. C3 should introduce the narrow recorder only when adapter functions start incrementing
  metrics; adding it earlier would be a passive shell.

Legacy shims introduced:

- `planWebgl2DirectDrawRoute()` is a migration route builder over `Webgl2WorldDrawUnit`. C7 should
  delete it or reduce it to adapter-owned construction once `Webgl2WorldDrawUnit` is split.
- `Webgl2DirectDrawRoute` still points at the old draw unit aggregate and current program resources.
  This is acceptable for C3, but it must not become the final family pipeline plan shape.
- Central-loop metric increments still live outside family adapters. C3 should move RGBA/indexed
  increments with the behavior they measure, then leave only orchestration-level counters in the
  central loop.

Validation:

- `npm exec tsc -- --noEmit`
- `npm exec vitest -- src/lib/world-display/webgl2-direct-render-family.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/webgl2-world-submit.test.ts src/lib/world-display/webgl2-transition-portal-work.test.ts --run`

Exit criteria:

- C3 can move RGBA texture-page drawing behind a family adapter by consuming `DirectFamilyDrawContext`
  and typed route records, without re-deriving program/material decisions from strings.
- The central loop has fewer ad hoc local booleans for material routing, or those booleans are
  confined to one route-construction helper with typed output.
- No draw behavior or metrics change.

## Phase C3: Direct Family Pipeline Draw Adapters

Status: Complete.

Purpose: move direct RGBA texture-page and indexed/paletted draw behavior behind family pipeline
adapters after C2/C2.5 have established typed direct geometry submission views and typed direct draw
route/context records.

Tasks:

- Keep direct draw order, scene-domain routing, portal masking, and state-cache behavior unchanged.
- Start with the RGBA texture-page adapter first. It is the simplest useful adapter because
  `planWebgl2DirectDrawRoute()` already resolves the texture-page binding, active base texture, detail
  unit, alpha program, and texture-page program.
- In the same RGBA adapter change, remove central-loop duplicate ownership of:
  - RGBA sampler uniform setup;
  - base/detail texture binding;
  - RGBA color and alpha-test upload;
  - detail overlay upload;
  - direct texture-page uniform upload;
  - direct texture-page/staged atlas metrics.
- Then move indexed/paletted direct drawing behind an indexed adapter, deleting central-loop duplicate
  ownership of:
  - indexed sampler uniform setup;
  - index/palette/detail texture binding;
  - indexed color and alpha-test upload;
  - indexed material dynamic uniform upload;
  - indexed detail overlay upload.
- Move direct RGBA texture-page drawing behind an `rgba-texture-page` family pipeline adapter without
  changing behavior.
- Move direct indexed drawing behind an `indexed-paletted` family pipeline adapter without changing
  behavior.
- Make the family adapters the authoritative owners of RGBA and indexed direct material drawing by
  the end of the phase. The central loop may still route draw units, but it must not retain duplicate
  RGBA/indexed binding and uniform logic.
- Move direct texture-page resolution into the family boundary carefully:
  - preserve single-entry page behavior;
  - preserve packed atlas substitution after atlas generation exists;
  - preserve detail overlay texture unit behavior;
  - keep indexed texel and palette pages as exact data pages.
- Keep terrain behind its dedicated path unless a thin family wrapper clarifies routing without
  weakening terrain ownership.
- Keep dynamic/direct resource lifecycle unchanged. This phase should not build compacted resources.
- Add tests around direct VBA layout selection, especially proving RGBA and indexed direct draw still
  create the expected attributes and do not accidentally receive compacted-only material slot buffers
  unless the chosen direct layout requires them.
- Add tests proving direct RGBA and direct indexed draw units route through family classification and
  still bind the same textures, palettes, uniforms, and render state.

Progress:

- Moved RGBA texture-page direct material work behind adapter functions in `webgl2-world-submit.ts`:
  - sampler uniform setup;
  - base/detail texture binding;
  - direct texture-page/staged atlas metrics;
  - color and alpha-test uniforms;
  - detail overlay uniforms;
  - texture-page rect/wrap uniforms.
- Moved indexed/paletted direct material work behind adapter functions:
  - sampler uniform setup;
  - index/palette/detail texture binding;
  - color and alpha-test uniforms;
  - indexed material dynamic uniforms;
  - indexed detail overlay uniforms.
- Replaced the central loop's RGBA/indexed duplicate material ownership with calls to the family
  adapter prep/upload functions. The central loop still owns draw order, render-state application,
  VAO binding, MVP upload, terrain, flat color, draw calls, and compacted submit handoff.
- Added a `DirectFamilyUniformCache` so family adapters share the same cache invalidation behavior
  that the central loop previously owned.
- Preserved current route tests and submit behavior tests; no metric behavior changes were intended.

Decisions:

- Keep the first adapter functions in `webgl2-world-submit.ts` for this phase so the old central
  logic could be deleted in-place instead of copied into a second module and then rethreaded.
- Treat RGBA and indexed material prep/upload as two-phase adapters because current WebGL ordering
  binds textures before VAO/MVP upload and uploads material uniforms after MVP upload.
- Leave terrain in the central submit path. Terrain still has a dedicated pipeline and is explicitly
  outside this replacement detour.

Course corrections:

- This phase achieved ownership separation but increased `webgl2-world-submit.ts` size. That is not a
  good stopping point before compacted work. Add C3.5 as an immediate cleanup phase to move the
  direct family adapter surface into a dedicated module, reduce route booleans, and keep the central
  loop small.

Legacy shims introduced:

- `prepareDirectRgbaTexturePageDraw()` / `uploadDirectRgbaTexturePageUniforms()` and
  `prepareDirectIndexedPalettedDraw()` / `uploadDirectIndexedPalettedUniforms()` are adapter-shaped
  but still colocated in the old submit module. C3.5 should either move them to a direct family
  adapter module or collapse them into a smaller dispatch table.
- `Webgl2DirectDrawRoute` still contains convenience booleans. C3.5 should convert route decisions to
  discriminated route variants so adapters do not rely on boolean combinations.
- Central-loop flat and terrain behavior still uses older direct branches. This is acceptable because
  C3 targeted RGBA and indexed, but C7 should decide whether flat/debug/terrain need thin family
  wrappers or should remain explicit non-production/dedicated paths.

Validation:

- `npm exec tsc -- --noEmit`
- `npm exec vitest -- src/lib/world-display/webgl2-world-submit.test.ts --run`
- `npm exec vitest -- src/lib/world-display/webgl2-direct-render-family.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/webgl2-world-submit.test.ts src/lib/world-display/webgl2-transition-portal-work.test.ts --run`

Exit criteria:

- Direct draw has the same family vocabulary planned for compacted draw.
- The central direct draw loop delegates RGBA texture-page and indexed/paletted material work through
  family pipeline adapters while retaining current draw order and state-cache behavior.
- Direct material rendering is no longer an unrelated switch over material kind in the central world
  draw loop.
- RGBA and indexed direct draw behavior is not implemented in both the old central branch and the new
  family adapters.
- Existing direct draw behavior and metrics are unchanged except for clearer family names.

## Phase C3.5: Direct Adapter Consolidation Cleanup

Status: Complete.

Purpose: keep the direct family work from becoming a new pile inside `webgl2-world-submit.ts` before
compacted geometry work resumes. C3 moved behavior behind adapters, but the implementation is still
too colocated with the central loop.

Tasks:

- Move RGBA and indexed direct adapter functions into a dedicated direct family adapter module, or
  otherwise collapse them behind a small dispatch table with clear ownership.
- Convert `Webgl2DirectDrawRoute` from convenience booleans into discriminated route variants:
  - `flat`;
  - `rgba-texture-page`;
  - `indexed-paletted`;
  - `terrain-blend`.
- Keep `debug-pipeline` visible through direct family submissions, while allowing portal masks to use
  the flat shader route until debug rendering gets its own pipeline.
- Keep texture-unit constants and shared direct draw context colocated with the adapters that consume
  them.
- Keep central `submitWebgl2FlatWorldDrawUnits()` responsible for:
  - replacement planning;
  - draw order;
  - render-state orchestration;
  - VAO binding;
  - MVP upload;
  - draw call/triangle totals;
  - terrain until the terrain-specific plan resumes.
- Add or update tests so adapter dispatch is covered without testing debug-only logging.
- Do not change rendered behavior or metrics.

Progress:

- Added `webgl2-direct-family-adapters.ts` as the direct family adapter owner for:
  - direct draw context and texture-unit contracts;
  - direct family uniform cache;
  - route planning;
  - RGBA texture-page prep/upload;
  - indexed/paletted prep/upload;
  - direct flat color upload helper.
- Moved RGBA/indexed adapter helpers and route planning out of `webgl2-world-submit.ts`.
- Converted `Webgl2DirectDrawRoute` from convenience booleans into discriminated route variants keyed
  by `programKind`:
  - `flat`;
  - `texture`;
  - `indexed-p8` / `indexed-p16`;
  - `terrain`.
- Updated route tests to import route planning from the direct family adapter module.
- Kept `webgl2-world-submit.ts` responsible for orchestration: replacement planning, draw order,
  render state, VAO binding, MVP upload, terrain, draw calls, and compacted submit handoff.

Decisions:

- Keep `programKind: "texture"` as the internal discriminant for `rgba-texture-page` because it still
  maps to the existing WebGL2 textured program name. The family payload remains named
  `rgba-texture-page`.
- Keep portal masks classified as `debug-pipeline` in direct family submissions while routing them
  through the flat direct shader path.
- Keep terrain in the direct route union only for orchestration clarity. Terrain material binding and
  shader behavior remain dedicated terrain logic, not part of the RGBA/indexed adapter ownership.

Course corrections:

- The cleanup did not add a separate adapter dispatch test file. Existing route tests already cover
  adapter dispatch decisions without testing debug-only logging, and the submit tests cover behavior.
- The new adapter module still imports submit program/metric types as type-only imports. This avoids a
  runtime cycle, but C7 should revisit whether program type ownership belongs in a smaller shared
  direct-program-types module.

Legacy shims introduced:

- `webgl2-direct-family-adapters.ts` still plans routes from `Webgl2WorldDrawUnit`. This remains a
  migration bridge until the draw unit aggregate is split.
- Route variants still carry the old draw unit because the central loop owns VAO binding, MVP upload,
  draw counts, and terrain. This is acceptable until C4-C6 define the compacted-side equivalent and
  C7 deletes old aggregate ownership where possible.

Validation:

- `npm exec tsc -- --noEmit`
- `npm exec vitest -- src/lib/world-display/webgl2-direct-render-family.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/webgl2-world-submit.test.ts src/lib/world-display/webgl2-transition-portal-work.test.ts --run`

Exit criteria:

- `webgl2-world-submit.ts` is smaller and reads as orchestration, not the owner of RGBA/indexed
  material binding details.
- Direct RGBA/indexed adapter ownership remains authoritative; duplicate central material logic does
  not return.
- C4 can start compacted geometry extraction without dragging direct-adapter cleanup debt forward.

## Phase C4: Extract Material-Agnostic Compacted Geometry

Status: Complete.

Purpose: replace `buildBakedGeometry()` and RGBA-shaped baked geometry types with a material-agnostic
compaction subsystem.

Tasks:

- Introduce compacted geometry types with neutral names:
  - `CompactedGeometryPlan`;
  - `CompactedGeometryBatch`;
  - `CompactedGeometrySlice`;
  - `CompactedGeometryLayout`.
- Move compacted geometry construction into a module that imports staged geometry and math only, not
  baked renderable/material family types.
- Keep direct and compacted geometry layouts aligned by name, but do not force identical vertex
  attributes where the current shaders do not need them.
- Preserve explicit draw-unit-to-material-slot mapping as a hard requirement.
- Delete RGBA atlas fields from compacted geometry slices. Slice material facts should live in family
  payloads.
- Update existing RGBA tests to assert neutral compacted geometry output plus separate RGBA family
  payload output.

Progress:

- Renamed the old `baked-geometry.ts` module to `compacted-geometry.ts` and renamed the exported
  builder/type surface:
  - `buildCompactedGeometryBatch()`;
  - `CompactedGeometryPlan`;
  - `CompactedGeometryBatch`;
  - `CompactedGeometrySlice`;
  - `CompactedGeometryLayout`;
  - `CompactedDrawRange`.
- Added the explicit compacted layout value `position-uv-material-slot` to the geometry batch. Direct
  geometry layouts remain aligned by vocabulary but still do not receive compacted-only material-slot
  attributes.
- Renamed the compacted geometry vertex material stream from `materialSlots` to
  `materialSlotIndices`, making it clear this is geometry slot-index data, not a family material
  table.
- Removed RGBA and indexed family fields from compacted geometry slices. The builder now returns only
  geometry/range facts:
  - slice key;
  - render-state key;
  - first index and index count;
  - draw unit IDs;
  - material slot keys.
- Updated the RGBA and indexed WebGL batch resource construction to reattach family slice payloads
  outside the compacted geometry batch:
  - RGBA resource slices reattach `atlasTextureIndex` and `detailAtlasTextureIndex`;
  - indexed resource slices reattach `indexFormat`, `indexPageKey`, and `palettePageKey`.
- Updated compacted geometry tests so they no longer import `BakedRenderablePlan` or assert RGBA atlas
  fields as geometry output.

Decisions:

- Keep the old `webgl2-baked-geometry-batches.ts` resource module name for C4 only. It now consumes
  neutral compacted geometry, but its exported WebGL resource names are still RGBA/indexed baked
  migration debt. C5 owns collapsing and renaming that resource layer.
- Do not preserve a `baked-geometry.ts` reexport shim. The old module name encoded the wrong model,
  and importing code was updated in place.
- Keep planner material knowledge in `baked-renderable-planner.ts` for now. C4 only extracted the
  material-agnostic geometry builder; C5/C6 should rename or replace planner/storage vocabulary once
  family resources become authoritative.

Course corrections:

- The first rename pass exposed that compacted draw slices were still carrying RGBA atlas payloads by
  spreading planner slices through `compactDrawSlice()`. That would have preserved the old leak under
  new names, so C4 explicitly stopped spreading planner slice payloads and moved family slice
  reattachment to WebGL family resource construction.
- Indexed planned resources had the same leak: tests expected `indexFormat` on geometry resource
  slices. The corrected shape keeps `indexFormat` on the temporary indexed family resource slice, not
  on compacted geometry.

Discovered debt and cleanup targets:

- `webgl2-compacted-geometry-resources.ts` now contains the intended split in miniature: neutral compacted
  buffers plus temporary RGBA/indexed family payload reattachment. C5 should turn this into the
  authoritative compacted geometry resource plus family-resource maps, then rename the module.
- `syncWebgl2BakedGeometryBatch()` and `syncWebgl2BakedIndexedGeometryBatch()` both build neutral
  compacted geometry but still feed separate resource maps. This is the next real duplication to
  delete.
- Profile labels and diagnostics still include `buildBakedIndexedGeometry`, `createBakedGeometryBatch`,
  and `bakedGeometry*` counters. C5/C6 should rename these only as ownership moves so diagnostics do
  not lie about what is rendered.

Legacy shims introduced:

- No import reexport shim was introduced for `baked-geometry.ts`.
- Temporary family slice reattachment helpers in `webgl2-compacted-geometry-resources.ts` are migration
  scaffolding. Their deletion target is C5, where family payloads become first-class resources rather
  than fields on baked-named batch resources.

Validation:

- `npm exec tsc -- --noEmit`
- `npm exec vitest -- src/lib/world-display/compacted-geometry.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/webgl2-baked-submit.test.ts --run`

Exit criteria:

- The compaction builder has no dependency on RGBA atlas or indexed material table types.
- RGBA compacted rendering still works through existing behavior, but through neutral geometry data.
- The codebase has no `BakedGeometry*` geometry builder/type names. Remaining baked names are resource,
  submit, planner, and diagnostic migration debt for C5-C7.

## Phase C5: Collapse Family Resource Storage

Status: Complete.

Purpose: replace parallel RGBA and indexed compacted resource maps with one compacted geometry
resource store and family pipeline resource payloads.

Tasks:

- Start from the C4 split inside `webgl2-baked-geometry-batches.ts`: neutral compacted buffers plus
  temporary RGBA/indexed family slice payloads.
- Replace `bakedGeometryBatches` and `bakedIndexedGeometryBatches` with a single compacted geometry
  batch collection keyed by compacted geometry batch key.
- Add a family resource collection keyed by `(family, geometryBatchKey)`.
- Move RGBA atlas material slots into the `rgba-texture-page` family payload.
- Move indexed material table records into the `indexed-paletted` family payload.
- Move RGBA and indexed family slice payloads out of baked-named batch resources and into their family
  payload records.
- Rename `webgl2-baked-geometry-batches.ts` after the unified resource owner exists; do not leave a
  reexport shim under the old name.
- Split texture-page facts from realized WebGL texture resources where the current `TexturePageBinding`
  shape blocks sharing between direct and compacted family planning.
- Ensure resource disposal and renderer graph retention operate on compacted geometry plus family
  resources without duplicated cleanup paths.

Progress:

- Renamed `webgl2-baked-geometry-batches.ts` to `webgl2-compacted-geometry-resources.ts` without a
  compatibility reexport.
- Replaced the parallel resource maps:
  - removed `bakedGeometryBatches`;
  - removed `bakedIndexedGeometryBatches`;
  - added `compactedGeometryBatches`;
  - added `compactedGeometryFamilyResources`.
- Split WebGL resources into:
  - `Webgl2CompactedGeometryBatchResource`, which owns only VAO/VBO/IBO buffers, index type, batch
    model matrix, and geometry byte/count metrics;
  - `Webgl2RgbaTexturePageFamilyResource`, keyed by `rgba-texture-page|geometryBatchKey`, which owns
    RGBA material slots and RGBA family draw-slice payloads;
  - `Webgl2IndexedPalettedFamilyResource`, keyed by `indexed-paletted|geometryBatchKey`, which owns
    indexed material table records and indexed family draw-slice payloads.
- Collapsed `syncWebgl2BakedGeometryBatch()` and `syncWebgl2BakedIndexedGeometryBatch()` into one
  `syncWebgl2CompactedGeometryResources()` path that builds neutral compacted geometry once per
  family batch plan and retains/deletes geometry and family resources through one lifecycle.
- Updated RGBA compacted submit to consume compacted geometry batches plus `rgba-texture-page` family
  resources instead of expecting material slots and atlas slice fields on the geometry batch.
- Updated renderer handoff and tests to pass compacted geometry resources and filtered RGBA family
  resources explicitly.
- Updated resource tests so indexed assertions inspect the indexed family payload and neutral geometry
  separately.

Decisions:

- Keep the existing `webgl2-baked-submit.ts` name for now. The code now consumes the new compacted
  geometry/family resource split, but C6 owns replacement planning and metric vocabulary. Renaming
  submit before C6 would create a mostly cosmetic diff while the public metrics are still baked-named.
- Keep one generic `compactedGeometryFamilyResources` map rather than separate RGBA/indexed family
  maps. This makes the resource store match the target `(family, geometryBatchKey)` model and avoids
  recreating the parallel-map problem under better names.
- Do not split `TexturePageBinding` facts from realized WebGL textures in C5. The unified resource
  model no longer requires that split to collapse storage. Move that work to the family pipeline
  implementation phase where direct and compacted indexed/RGBA resource collection actually share the
  page facts.

Course corrections:

- The first submit refactor missed the internal `submitBakedGeometryDrawUnits()` handoff and passed
  only geometry batches to the RGBA submit path. Tests caught this immediately; the handoff now
  includes `rgbaTexturePageFamilies`.
- Resource graph node dependencies can no longer derive draw-unit IDs from geometry batches, because
  geometry is material-agnostic. The graph update now receives the family resources for a geometry
  batch and derives scene-object dependencies from those family slices.

Discovered debt and cleanup targets:

- `bakedGeometry*` counters now measure unified compacted geometry resources, not only RGBA submitted
  geometry. C6 must rename/split these diagnostics so the report distinguishes compacted geometry
  built, family resources built, and family resources actually rendered.
- `webgl2-baked-submit.ts` is now a narrow RGBA compacted family path wearing baked terminology. C6
  should rename replacement planning around rendered families; C8 should either rename this to an
  RGBA family pipeline module or replace it while implementing indexed rendering.
- `BakedRenderablePlan.submitFamilies` still feeds family resources. This is acceptable planner debt,
  but C7 should remove the old root RGBA fields and make family plans authoritative.

Legacy shims introduced:

- No old resource module reexport was introduced.
- No old `bakedGeometryBatches` or `bakedIndexedGeometryBatches` map aliases were introduced.
- The remaining baked-named submit/metrics APIs are not storage shims; they are terminology debt
  scheduled for C6/C7.

Validation:

- `npm exec tsc -- --noEmit`
- `npm exec vitest -- src/lib/world-display/webgl2-baked-submit.test.ts src/lib/world-display/webgl2-world-submit.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/compacted-geometry.test.ts --run`

Exit criteria:

- There is one compacted geometry resource lifecycle.
- Family-specific resource lifecycles are explicit and do not duplicate geometry buffers.
- The temporary indexed compacted batch map is deleted.

## Phase C6: Replace Replacement Planning and Metrics

Status: Complete.

Purpose: make draw replacement and diagnostics family-aware without using RGBA baked geometry as the
default meaning of "baked."

Tasks:

- Replace current baked replacement planning with family pipeline replacement planning.
- Compute replaceable draw units from rendered family pipelines, not from planned or merely built
  resources.
- Preserve visible draw order and scene-domain routing while applying family replacement; do not let
  compacted replacement bypass portal/scene-domain accounting.
- Split diagnostics:
  - compacted geometry resources;
  - family resources;
  - family rendered slices;
  - direct draw units replaced;
  - direct draw units retained by family/blocker.
- Remove successful-path history from hot diagnostics unless it points to an actual blocker or error.
- Delete or rename `bakedGeometry*` metrics that only describe RGBA atlas behavior.

Progress:

- Renamed the RGBA compacted replacement planner and submit surface from baked-geometry names to
  family-specific names:
  - `planWebgl2RgbaTexturePageFamilyReplacement()`;
  - `submitWebgl2RgbaTexturePageFamilyBatches()`;
  - `Webgl2RgbaTexturePageFamilySubmitResources`;
  - `Webgl2RgbaTexturePageFamilySubmitMetrics`;
  - `WEBGL2_RGBA_TEXTURE_PAGE_MAX_MATERIAL_SLOTS`.
- Replacement planning now explicitly plans only the rendered `rgba-texture-page` family. Indexed
  family resources can be built without being counted as rendered or replaceable.
- Renamed resource diagnostics that describe neutral compacted geometry:
  - `compactedGeometryBatchCount`;
  - `compactedGeometryDrawUnitCount`;
  - `compactedGeometryTriangleCount`;
  - `compactedGeometryVertexByteLength`;
  - `compactedGeometryIndexByteLength`;
  - `compactedGeometryTotalByteLength`;
  - `compactedGeometryDrawSliceCount`;
  - `compactedGeometryBatchOriginCount`;
  - `compactedGeometryTransformTableEntryCount`;
  - `compactedResourceFallbackSamples`.
- Added `compactedGeometryFamilyResourceCounts`, keyed by family, so diagnostics can show resources
  built for `rgba-texture-page` and `indexed-paletted` separately from rendered family submissions.
- Updated material type counters so resource-building metrics use `webgl2-compacted-*` keys and
  rendered RGBA submit metrics use `webgl2-rgba-family-*` keys.
- Updated the browser debug summary from "Baked coverage" to "Compaction coverage" and added compacted
  family-resource counts to the concise render pipeline line.

Decisions:

- Do not rename `BakedRenderablePlan` or the root planner in C6. The planner still owns material-aware
  compaction decisions and still has old root RGBA fields. C7 is the cleanup phase for deleting those
  old planner shapes after the resource and replacement outputs are already split.
- Do not rename every renderer resource field related to the current RGBA shader program in C6. The
  submit module now exposes family-specific names, but renderer member names such as
  `bakedGeometryWorldProgram` are legacy wiring that should be cleaned with the old-pipeline removal
  pass.
- Keep submitted/replaced world-submit metrics as the existing `baked*` fields for this phase, while
  changing diagnostic material-type keys and summary text to family-specific language. The next
  cleanup should rename the metrics struct fields in one coordinated pass.

Course corrections:

- The earlier C5 split made indexed family resources visible in the store, but the diagnostic text
  still implied all compacted resources were "baked" and render-submitted. C6 corrects the public
  debug view: compacted geometry resources, family resources, and rendered RGBA family submissions are
  now distinct.
- The replacement planner was already effectively RGBA-only, but its name hid that. Renaming it was
  more important than changing behavior because the behavior was correct and the wording was not.

Discovered debt and cleanup targets:

- `webgl2-baked-submit.ts` should be renamed to an RGBA texture-page family pipeline module once C7
  removes the remaining old baked renderer wiring.
- `Webgl2WorldSubmitMetrics` still uses `baked*` field names for rendered RGBA family submissions.
  C7 should rename those to `rgbaTexturePageFamily*` or a generic rendered-family metric structure.
- `webgl2-world-resources.ts` still uses baked names for graph leases and planner helpers. Those no
  longer define storage, but they are cleanup targets before implementing indexed rendering.
- The debug summary still says "bypass" and several planner coverage fields still use `baked*`
  property names because they come from `BakedRenderablePlan`. C7 should collapse that planner naming
  with the old root fields.

Legacy shims introduced:

- No compatibility aliases were added for the renamed RGBA replacement planner or submit functions.
- No old `bakedGeometry*` debug metric aliases were added for neutral compacted resource metrics.
- Remaining baked-named fields are existing legacy wiring, not new shims.

Validation:

- `npm exec tsc -- --noEmit`
- `npm exec vitest -- src/lib/world-display/webgl2-baked-submit.test.ts src/lib/world-display/webgl2-world-submit.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/compacted-geometry.test.ts --run`

Exit criteria:

- Diagnostics no longer imply that planned indexed resources are rendered.
- The debug report gets shorter or clearer, not longer.
- Replacement accounting is family-aware and exact enough to support indexed rendering next.

## Phase C7: Old Pipeline Cleanup and Dead Pattern Removal

Status: In progress. First cleanup pass complete; planner-shape cleanup remains before C8.

Purpose: make sure the replacement architecture is actually a replacement. By this point direct family
adapters, material-agnostic compacted geometry, family resource storage, and family-aware replacement
metrics should exist. This phase deletes old baked/RGBA-atlas-shaped paths and patterns before adding
the compacted indexed material renderer.

Tasks:

- Delete or collapse temporary adapters introduced in C2/C3 that still wrap `Webgl2WorldDrawUnit`
  without owning behavior.
- Delete `bakedIndexedGeometryBatches`.
- Delete or rename `bakedGeometryBatches` after compacted geometry resources are authoritative.
- Delete `BakedRenderablePlan` root RGBA atlas compatibility fields once family resource payloads own
  RGBA slots/slices.
- Delete `submitFamilies` or replace it with the authoritative render family pipeline plan shape.
- Remove duplicate RGBA/indexed direct draw binding and uniform logic from `submitWebgl2FlatWorldDrawUnits()`.
- Remove diagnostics that report old `bakedGeometry*` concepts as if they are the generic compacted
  architecture.
- Rename remaining "baked" symbols that refer to compacted geometry or family pipelines rather than a
  specific historical baked RGBA path.
- Add tests or type-level checks where practical to prove:
  - old `submitFamilies` fields are no longer the source of truth;
  - compacted geometry resources do not import family material payload types;
  - direct family adapters own RGBA/indexed material binding.

Exit criteria:

- The old baked/RGBA atlas pipeline is no longer an alternate implementation path.
- Temporary migration adapters have either been deleted or are listed with a concrete remaining owner
  and deletion task.
- The next phase can implement indexed compacted rendering by adding an indexed family pipeline over
  the new model, not by touching old baked resource maps.

Progress:

- Renamed the RGBA compacted submit module from `webgl2-baked-submit.ts` to
  `webgl2-rgba-texture-page-family-submit.ts` without a reexport shim.
- Renamed the RGBA submit test module to match the new module name.
- Renamed world-submit parameters, routes, helper functions, program fields, and debug contract fields
  that described rendered RGBA family submissions:
  - `bakedGeometryProgram` -> `rgbaTexturePageFamilyProgram`;
  - `bakedGeometryResources` -> `rgbaTexturePageFamilyResources`;
  - `bakedSubmitRoute` -> `rgbaTexturePageFamilySubmitRoute`;
  - `bakedGeometryWorldProgram` -> `rgbaTexturePageFamilyWorldProgram`;
  - `baked*Submitted/Replaced/Overdraw/NoVisible/Fallback*` submit metrics ->
    `rgbaTexturePageFamily*` submit metrics.
- Renamed `visibleRetainedDirectDrawUnitCountsByBakeMaterialFamily` to
  `visibleRetainedDirectDrawUnitCountsByCompactionFamily`.
- Renamed compacted resource graph store fields from `bakedGeometryBatchGraph*` to
  `compactedGeometryBatchGraph*`.
- Updated browser diagnostics and material type counts to consume the renamed RGBA family submit
  metrics.

Decisions:

- Keep the planner-facing `baked*` names for this pass. They still describe the old
  `BakedRenderablePlan` shape and `submitFamilies` source-of-truth problem, so renaming only their
  output fields would hide the debt instead of deleting it.
- Keep the RGBA family submit path in place as the current rendered compacted family. The cleanup
  removed old naming and old module paths, not the working replacement behavior.
- Do not add compatibility exports from the old `webgl2-baked-submit.ts` path. Imports must move to
  the new family module.

Course corrections:

- C7 is too broad to finish safely as one phase without turning into another thousand-line rename.
  Split the remaining planner-shape cleanup into C7.5 so C8 starts from a clearer boundary.
- The next work should attack `BakedRenderablePlan` and `submitFamilies` directly, not continue
  renaming submit-side leaf fields.

Discovered cleanup targets:

- `baked-renderable-planner.ts` still owns the material-aware compaction plan and blocker vocabulary.
- `BakedRenderablePlan.submitFamilies` is still the authoritative source for RGBA and indexed family
  resource creation.
- `webgl2-texture-atlas-generation.ts` still consumes `BakedRenderablePlan` directly for RGBA atlas
  generation.
- `webgl2-world-resources.ts` still stores planner diagnostics as `bakedCandidate*`,
  `bakedBypass*`, and `bakedCoverage*`.
- Browser diagnostics still surface planner debt through `bakedCoverage*` debug fields.

Legacy shims:

- None added. The old `webgl2-baked-submit.ts` import path was removed instead of preserved.

Validation:

- `npm exec tsc -- --noEmit`
- `npm exec vitest -- src/lib/world-display/webgl2-rgba-texture-page-family-submit.test.ts src/lib/world-display/webgl2-world-submit.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/compacted-geometry.test.ts --run`

## Phase C7.5: Replace BakedRenderablePlan With a Compaction Family Plan

Status: Complete.

Purpose: finish the old-pipeline cleanup before indexed compacted rendering. The rendered RGBA family
path and compacted resource graph now use the replacement terminology, but the planner still exposes
`BakedRenderablePlan` and `submitFamilies`. Indexed rendering should not be implemented against that
old shape.

Tasks:

- Rename `baked-renderable-planner.ts` to a compaction/family planner module without a reexport shim.
- Replace `BakedRenderablePlan` with a material-aware compaction plan name.
- Replace `submitFamilies` with an authoritative render-family plan shape that can feed both RGBA
  texture-page and indexed-paletted family resources.
- Rename blocker names from `missing-baked-*` to `missing-compacted-family-*` or a shorter typed
  family blocker vocabulary.
- Rename store/debug fields that still use `bakedCandidate*`, `bakedBypass*`, and `bakedCoverage*`
  when they describe compaction planning rather than rendered RGBA submissions.
- Move RGBA atlas-generation consumers off root `BakedRenderablePlan` naming and onto the RGBA
  family subplan.
- Update tests to assert the new plan shape and remove assertions against `submitFamilies`.

Exit criteria:

- No production module imports `BakedRenderablePlan`.
- No production code reads `submitFamilies`.
- Planner diagnostics use compaction/family terminology.
- C8 can add indexed family rendering by adding an indexed family pipeline, not by extending a
  baked-named planner compatibility shape.

Progress:

- Renamed `baked-renderable-planner.ts` to `compaction-family-planner.ts` without a reexport shim.
- Renamed the planner test module to `compaction-family-planner.test.ts`.
- Replaced planner surface types and functions with compaction/family names:
  - `BakedRenderablePlan` -> `CompactionFamilyPlan`;
  - `BakedRenderableCandidate` -> `CompactionFamilyCandidate`;
  - `BakedRenderablePolicy` -> `CompactionFamilyPlanningPolicy`;
  - `planBakedRenderables()` -> `planCompactionFamilies()`;
  - `createEmptyBakedRenderablePlan()` -> `createEmptyCompactionFamilyPlan()`.
- Replaced `submitFamilies` with `renderFamilies`.
- Renamed the RGBA family subplan from `rgbaAtlas` to `rgbaTexturePage`.
- Renamed indexed planner payloads to `IndexedPalettedFamily*` names.
- Renamed planner diagnostics and renderer debug fields from `bakedCandidate*`, `bakedBypass*`, and
  `bakedCoverage*` to `compactionCandidate*`, `compactionBypass*`, and `compactionCoverage*`.
- Renamed blocker strings from `missing-baked-*` to `missing-compacted-*` and changed planner
  compatibility decisions from `"baked"` to `"compacted"`.
- Renamed `Webgl2WorldDrawUnit.bakeEligibility` to `compactionEligibility`.
- Renamed remaining compacted resource helpers that still used baked geometry names:
  - RGBA landblock batch planning now uses `createRgbaTexturePageCompactedLandblockBatch*`;
  - indexed landblock batch planning now uses `createIndexedPalettedCompactedLandblockBatch*`;
  - compacted batch graph/resource helpers now use compacted names.
- Updated material type count keys from `webgl2-baked-*` to `webgl2-compacted-*`.

Decisions:

- `renderFamilies` is the new authoritative planner boundary. It is still intentionally simple:
  `rgbaTexturePage` and `indexedPaletted` family plans are concrete records, not a registry or
  generic plugin layer.
- The root `CompactionFamilyPlan` still carries some RGBA atlas compatibility fields
  (`atlasEntryRecords`, `materialSlots`, `drawSlices`, etc.) because atlas generation still consumes
  them. This is now explicit cleanup debt rather than the shape C8 should extend.
- Kept indexed compacted geometry resource creation in place as a planned-resource path, but C8 still
  owns the actual indexed family renderer.

Course corrections:

- C7.5 removed the stale module/type names and the `submitFamilies` source-of-truth problem, but it
  did not fully split RGBA atlas generation onto only `renderFamilies.rgbaTexturePage`. That split is
  less urgent than C8 because no production code reads `submitFamilies` or `BakedRenderablePlan`
  anymore.
- C8 should use `renderFamilies.indexedPaletted` and existing indexed family resources directly
  rather than adding any new root plan fields.

Discovered cleanup targets:

- `CompactionFamilyPlan` root RGBA fields should be deleted after atlas generation and resource
  refresh helpers read only `renderFamilies.rgbaTexturePage` plus atlas texture layout records.
- `atlasEligibility` is still exposed as a direct compaction carrier. Replace it with a typed
  texture-page/family eligibility record later.
- Direct draw still reads `drawUnit.compactionEligibility.material.family` for retained-family
  diagnostics; long term this should come from direct family route planning.

Legacy shims:

- None added. The old `baked-renderable-planner.ts` import path was removed instead of preserved.

Validation:

- `npm exec tsc -- --noEmit`
- `npm exec vitest -- src/lib/world-display/compaction-family-planner.test.ts src/lib/world-display/webgl2-texture-atlas-generation.test.ts src/lib/world-display/webgl2-rgba-texture-page-family-submit.test.ts src/lib/world-display/webgl2-world-submit.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/compacted-geometry.test.ts --run`

## Phase C8: Reintroduce Indexed-Paletted Rendering Through the New Boundary

Status: Planned.

Purpose: implement opaque indexed/paletted compacted rendering only after the compacted geometry and
family pipeline boundaries are clean. This is the completion target for the detour, not a stretch
goal.

Tasks:

- Add the `indexed-paletted` family pipeline over the new compacted geometry resource model.
- Bind indexed texel pages and palette pages from family resources.
- Preserve current direct indexed shader behavior:
  - P8/P16 index reconstruction;
  - palette lookup;
  - no clip threshold when `clipThreshold = -1`;
  - shader-owned palette-aware linear filtering;
  - wrap flags from the family material slot.
- Remove or narrow `missing-compacted-indexed-paletted-family` for table-ready opaque indexed materials
  only when the new family pipeline actually renders them.
- Keep indexed alpha/cutout/blend retained direct with explicit blockers until their policy is
  modeled.

Exit criteria:

- Opaque indexed static/structured-interior draw units can be replaced by compacted indexed family
  rendering.
- RGBA texture-page family behavior is unchanged.
- The implementation adds less code than the old parallel-path approach would have required, and
  removes the temporary indexed resource path.
- Diagnostics show indexed/paletted compacted family rendering as actual submitted/replaced draw
  units, not merely planned resources.

## Cleanup Targets

- Split `Webgl2WorldDrawUnit` into smaller owned records over time:
  - geometry submission;
  - family material payload;
  - realized WebGL resources;
  - diagnostics/readiness facts.
    Do this after family adapters are proven, not as a first step, and do not leave a durable adapter
    shell that preserves the old ownership model.
- Move the central material-kind branch in `submitWebgl2FlatWorldDrawUnits()` into direct family
  pipeline adapters.
- Move direct texture-page mutation in `resolveWebgl2DrawUnitTexturePageBindings()` into an explicit
  family/page-resolution step.
- Delete root RGBA atlas compatibility fields from `CompactionFamilyPlan`.
- Replace `atlasEligibility` as a direct compaction carrier with a texture-page/family eligibility
  record that is not RGBA-atlas-specific.
- Remove color-space parameters from prepared texture IDs unless a real renderer color-space policy is
  implemented.
- Replace string feature flags and regexp/string matching in hot paths with typed enums/records,
  mapping to strings only when creating diagnostic output.
- Keep fallback vocabulary for real external/resource failure, but avoid internal "maybe path"
  fallbacks where explicit planning requirements can fail hard.

## Notes

- The planner remains material-aware. The simplification is not pretending materials do not affect
  batching; it is keeping material-specific payload out of compacted geometry data.
- Direct draw remains the proof path for visibility while compacted family pipelines are replaced.
- Terrain is not part of this detour. It keeps its dedicated pipeline until terrain-specific work
  resumes.
