# Holtburger 3D Indexed Resource Atlas Plan

## Goal

Reduce opaque indexed-paletted static draw pressure by atlasing the indexed family resources that
currently force per-slice texture binds:

- indexed texel pages (`R8` for P8, `RG8` for Index16);
- palette lookup rows (`RGBA8`);
- optional detail overlays, continuing through the existing detail atlas.

The target is to let compacted indexed-paletted draw slices group by atlas resource and render state
rather than by individual `indexPageKey` and `palettePageKey`.

Alpha-blended indexed materials remain retained direct for this work. The first implementation should
only cover indexed-paletted materials whose compaction alpha policy is `opaque`.

## Current State

The indexed-paletted family already has geometry compaction and material-table submission, but it does
not atlas the family resources that dominate slice fragmentation.

- `planCompactionFamilies` sends indexed candidates only through `detailCandidates`; base indexed
  texels and palette lookups do not enter an atlas plan.
- `Webgl2IndexedPalettedFamilyResource` receives only `detailPlacementsByEntryKey`.
- `submitWebgl2IndexedPalettedFamilyBatches` binds `slice.indexPageKey` and `slice.palettePageKey`
  directly and issues one draw per visible slice.
- The compacted indexed shader assumes one bound index texture and one bound palette texture per
  draw slice.

## Baseline Metrics

Use this debug report as the initial comparison point:

- Generated: `2026-06-03T17:23:41.951Z`
- Destination: `33.50S, 72.80E, 0.0Z`
- Outdoor anchor: `0xda55ffff`
- Canvas: `1440x853 @0.90`

Scene/render baseline:

- FPS: `33.5`
- Render time: `26.0 ms`
- Visible draws: `2327`
- Candidate draw units: `18425`
- Static draw units: `17420`
- Retained triangles: `115314`

Material/resource baseline:

- Material recipes: `282`
- Texture recipes: `250`
- Solid recipes: `32`
- Indexed recipes: `116`
- Render resources: `265 surface textures`, `264 surfaces`, `23 palettes`
- Indexed resources: `115 indexed textures`, `22 palettes`
- Texture-page bindings: `25274`
  - base-color: `12267`
  - indexed-texels: `5964`
  - palette-lookup: `5964`
  - detail: `1079`

Compaction baseline:

- Compaction candidates: `4552`
- Family counts:
  - textured-opaque: `11907`
  - indexed-paletted: `5964`
  - transparent-blended: `360`
  - debug-pipeline: `200`
- Retained direct families:
  - transparent-blended: `360`
  - indexed-paletted: `261`
  - debug-pipeline: `200`
- Material blockers:
  - missing-compacted-transparent-blended-family: `360`
  - indexed-alpha-policy-unsupported: `261`
  - debug-pipeline-material: `200`
- Geometry blockers:
  - non-static: `200`
  - missing-landblock-origin: `200`
  - missing-uv-buffer: `200`
- Compacted batches: `26`
- Compacted family resources:
  - rgba-texture-page: `18`
  - indexed-paletted: `8`

Indexed-family baseline:

- Indexed shader draws: `1084`
- Indexed replaced draw units: `1354`
- Indexed retained direct draw units: `357`
- Indexed draw-call estimate: `1711 -> 1441`
- Indexed draw-call savings: `270`
- Indexed no-visible routes: `8`

Expected first-order impact:

- The retained direct indexed count should not materially change until alpha/blend indexed batching is
  deliberately implemented.
- Indexed replaced draw units should stay at least as high as baseline for opaque table-ready indexed
  materials.
- Indexed shader draws and submitted slices should drop because slices stop being keyed by standalone
  `indexPageKey` / `palettePageKey`.
- Indexed texture/palette standalone resource counts may still exist for direct retained materials,
  but compacted indexed submits should report atlas texture use.

## Non-Goals

- Do not batch indexed alpha/blended/translucent materials in this pass.
- Do not pre-bake indexed+palette output to RGBA as the primary path; that loses palette indirection
  and will multiply runtime appearance variants.
- Do not move browser/WebGL-specific atlas resources into shared crates.
- Visibility partitions may be collapsed for compacted static families when draw-call reduction is more
  valuable than strict per-BVH-item culling.

## Dry-Run Findings

Dry-running this plan against the current WebGL2 renderer surfaces these constraints and scheduling
corrections:

- Before Phase G, `Webgl2WorldDrawUnit.indexedMaterial` meant "direct draw WebGL textures plus metadata".
  `createOrReuseWebgl2DrawUnit` uploads standalone index and palette textures before compaction
  planning, and `retainedTextureKeys` retains those keys for every indexed draw unit. If atlas submit
  lands without changing this, draw calls can drop while standalone indexed texture upload/memory
  remains unchanged.
- The compacted indexed material table is built from `Webgl2WorldDrawUnit.indexedMaterial`, so the
  current planner depends on WebGL texture resources being created first. Cleaner indexed atlasing
  needs a CPU/metadata descriptor that is independent from direct-draw texture resources.
- The existing `textureAtlasGeneration` lifecycle is a single RGBA/detail atlas resource with graph
  leases, metrics, keying, refresh, and dispose logic embedded in `webgl2-world-resources.ts`. Adding
  indexed atlases by copy-pasting this lifecycle would increase resource-store debt.
- `planAtlasLayout` creates max-size atlas pages. That is acceptable for existing RGBA atlases but can
  be wasteful for palette rows, where a custom compact row planner can allocate a tight `width x rows`
  texture.
- Indexed texel atlases should use zero gutter and integer `texelFetch` addressing. Gutter replication
  is unnecessary if the shader applies material-local wrap/clamp before adding atlas rect offsets.
- Palette atlases do not need gutters either, but the shader must continue to enforce per-material
  `paletteColorCount` and clip-threshold behavior.
- Initial atlas work should remove resource-bind fragmentation first. Follow-up batching may allow
  overdraw by merging compacted static slices across visibility partitions when draw-call pressure
  remains high.

## Cleaner Scheduling

The implementation should be staged so each phase has a visible payoff and does not bake in the old
direct-texture coupling.

### Phase 0: Split Indexed Metadata from Direct WebGL Textures

Introduce an indexed material descriptor on `Webgl2WorldDrawUnit` that can feed both direct and
compacted paths without requiring standalone texture upload:

- material key;
- index texture key;
- palette texture key;
- index format;
- source width/height;
- source indexed bytes or a stable reference to them;
- palette color count and RGBA bytes or a stable reference to them;
- wrap policy;
- clip threshold;
- color/detail metadata.

Keep the existing direct indexed texture resource path working, but stop treating it as the
source of truth for compaction planning. After this phase, `createIndexedPalettedFamilyMaterialTableRecord`
should be able to build records from descriptor metadata rather than direct WebGL texture resources.

This phase may still upload standalone indexed textures for all indexed draw units. That is acceptable
as an intermediate state, but metrics should distinguish direct texture resources from descriptor-backed
atlas candidates.

### Phase 1: Shared Atlas Resource Lifecycle or Deliberate Parallel Resource

Before adding indexed atlas generation, choose one of these clean resource-lifecycle approaches:

- Extract a small reusable generation lifecycle helper for keyed atlas resources with create/refresh,
  dispose, graph lease, and count update hooks.
- Or add a deliberately separate `indexedResourceAtlasGeneration` store field with clear naming and no
  attempt to pretend it is the RGBA/detail `textureAtlasGeneration`.

Do not overload `Webgl2TextureAtlasGenerationResource` with indexed data pages. It is RGBA/detail
specific today and its sampler/filtering assumptions are wrong for indexed data.

## Design

### 1. Add Indexed Resource Atlas Planning

Create an indexed-specific atlas plan alongside the existing RGBA/detail atlas plan. This can live near
the current texture-page planning code, but it should be typed separately enough that color pages and
data lookup pages cannot be mixed accidentally.

Recommended new shapes:

- `IndexedTexelAtlasCandidate`
  - draw unit id
  - source texture key
  - format: `p8` or `index16`
  - width/height
  - source bytes or upload reference
  - wrap policy
- `IndexedPaletteAtlasCandidate`
  - palette texture key
  - color count
  - RGBA bytes or upload reference
- `IndexedResourceAtlasPlan`
  - P8 atlas textures
  - Index16 atlas textures
  - palette atlas textures
  - placements by index texture key
  - placements by palette texture key
  - failures with explicit reasons

Keep P8 and Index16 separate initially. A shared atlas for both would complicate shader formats for
little benefit.

Placement source:

- Build candidates from indexed material descriptors, not from direct WebGL texture resources.
- Dedupe index pages by `indexTextureKey` and validate duplicate dimensions, format, and source
  identity.
- Dedupe palettes by `paletteTextureKey` and validate duplicate color counts and source identity.
- Keep detail overlay planning in the existing RGBA/detail atlas plan.

### 2. Pack Indexed Texel Pages as Data Atlases

Generate WebGL textures for indexed texels:

- P8 atlas: `R8` / `RED` / `UNSIGNED_BYTE`
- Index16 atlas: `RG8` / `RG` / `UNSIGNED_BYTE`
- `NEAREST` min/mag filtering
- no mipmaps
- clamp-to-edge sampler at the atlas texture level

The shader should implement material-local wrap/clamp manually before applying atlas placement. This
avoids relying on sampler wrap behavior at atlas rect edges.

Use integer `texelFetch` coordinates:

```glsl
ivec2 local = resolveIndexedSampleCoord(baseCoord, offset, materialSlot);
ivec2 atlasCoord = ivec2(indexRect.xy) + local;
vec4 packed = texelFetch(uIndexAtlasTexture, atlasCoord, 0) * 255.0;
```

Do not use filtered `texture()` for indexed texels. The current shader performs palette-aware bilinear
filtering by sampling neighboring indices, converting each through the palette, and mixing colors.

Material table additions:

- index atlas texture id or atlas index
- index rect: `x`, `y`, `width`, `height` in texels
- source width/height
- wrap flags

### 3. Pack Palettes as Lookup Atlases

Pack palettes into an `RGBA8` texture. The simplest robust layout is one palette per row:

- width: max palette color count in that atlas, or a fixed row width if that proves simpler
- height: number of packed palette rows
- `NEAREST` filtering
- clamp-to-edge sampler
- no mipmaps

Prefer a custom palette row planner over `planAtlasLayout`; palette pages do not need square max-size
textures. A tight palette texture avoids wasting memory on mostly empty `4096x4096` atlas pages.

Material table additions:

- palette atlas texture id or atlas index
- palette row
- palette color count
- optional palette x offset if rows are suballocated horizontally

Shader palette lookup becomes row/offset aware:

```glsl
float paletteU = (paletteOffsetX + index + 0.5) / paletteAtlasSize.x;
float paletteV = (paletteRowY + 0.5) / paletteAtlasSize.y;
vec4 color = texture(uPaletteAtlasTexture, vec2(paletteU, paletteV));
```

### 4. Update Indexed Family Slicing

Once index and palette placements exist, update indexed draw-slice grouping.

Today slices include individual `indexPageKey` and `palettePageKey`. New slices should group by:

- index format;
- index atlas texture index;
- palette atlas texture index;
- detail atlas texture index, if present;
- render state (`indexed-opaque`);
- visibility partition, until overdraw-tolerant static batching is enabled;
- material-table partition.

The material table, not the draw slice, should carry per-material index/palette rect data.

Footgun: grouping by material-table partition alone is not enough. Since WebGL2 cannot bind a dynamic
sampler per material, each submitted draw slice must still have one concrete index atlas texture and
one concrete palette atlas texture bound. If a material-table partition spans multiple atlas textures,
the slice builder must split by atlas texture pair.

### 5. Update WebGL Resources and Shader Submit

Resource sync should create and retain:

- indexed texel atlas WebGL texture resources;
- palette atlas WebGL texture resources;
- updated indexed family resources with atlas-aware material records.

Submit should bind atlas textures per slice:

- texture unit 0: indexed texel atlas;
- texture unit 1: palette atlas;
- texture unit 2: detail atlas, unchanged.

The shader should sample the atlas-local indexed texels with exact texel coordinates, reconstruct P8
or Index16 palette indices, and then look up the palette atlas row.

Submit should fail hard if an atlas-planned indexed family references a missing atlas placement. Missing
placement should be handled during planning as retained direct, not silently patched at submit time.

### 6. Diagnostics and Metrics

Add metrics that make the improvement and failure modes obvious:

- indexed texel atlas texture count;
- indexed palette atlas texture count;
- indexed atlas candidate count;
- indexed atlas placed draw unit count;
- indexed atlas failure count/samples;
- indexed family slices before/after atlas grouping;
- indexed direct texture-page draw count avoided, if practical;
- standalone indexed texture count for retained-direct indexed materials;
- standalone indexed texture count still uploaded for compacted indexed materials, until Phase F
  removes that debt.
- family-split compaction candidate counts, because the current aggregate metric is RGBA-family based
  and can understate indexed work.

Update the debug report to distinguish:

- standalone indexed texture/palette resources retained for direct draws;
- indexed resource atlas textures used by compacted indexed draws.

## Implementation Phases

### Phase A: Descriptor Split and Planner Tests

Status: partially complete as of `2026-06-03`.

Completed:

- Added `Webgl2IndexedMaterialDescriptor` to carry indexed source metadata separately from direct
  WebGL texture resources.
- Added `Webgl2WorldDrawUnit.indexedMaterialDescriptor`.
- Kept direct indexed draw behavior unchanged through the then-current
  `Webgl2IndexedMaterialResources` direct-resource type.
- Changed compacted indexed material table creation to read descriptor metadata instead of
  `drawUnit.indexedMaterial` direct WebGL texture resources.
- Added resource tests proving the descriptor carries the source index and palette byte buffers used
  for upload.

Validation:

- `npm exec vitest -- src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/webgl2-world-submit.test.ts src/lib/world-display/webgl2-direct-render-family.test.ts src/lib/world-display/webgl2-transition-portal-work.test.ts --run`
  from `apps/holtburger-3d`
  - Result: 4 test files passed, 56 tests passed.
- `npm run lint:ts` from `apps/holtburger-3d`
  - Result: passed.

Course corrections:

- The first descriptor step did not add indexed atlas planner types yet. Keeping this separate made
  the production behavior change smaller and confirmed the compaction planner no longer depends on
  direct texture resource presence.
- At the end of Phase A, `Webgl2IndexedMaterialResources` extended
  `Webgl2IndexedMaterialDescriptor` as a deliberate interim shim. Phase G later removed this shim.
- Some test helpers set `indexedMaterialDescriptor: indexedMaterial`. This is acceptable for this
  interim phase because the direct resource extends the descriptor, but it should be cleaned up once
  atlas planning has a standalone descriptor fixture.

Remaining Phase A work moved into immediate Phase A.5 below.

### Phase A.5: Descriptor Metrics and Indexed Atlas Planner Prep

Status: complete as of `2026-06-03`.

This is an immediate interim phase before Phase B. It exists because Phase A left two small but useful
prep gaps that should be closed before adding WebGL atlas resources:

- Added descriptor-backed indexed candidate metrics:
  - indexed descriptor draw unit count;
  - descriptor-backed compacted indexed candidate count;
  - standalone direct indexed resource count;
  - compacted indexed draw units still uploading standalone direct resources.
- Added pure indexed resource atlas planner types and tests:
  - P8 index page placement is deterministic;
  - Index16 index page placement is deterministic;
  - palette row placement is deterministic and tight, not max-size square-page based;
  - duplicate index texture keys validate matching format/dimensions/source identity;
  - duplicate palette texture keys validate matching color count/source identity;
  - atlas failures are indexed-local and do not affect RGBA/detail atlas placement.
- Replaced test helper shims where practical with a small descriptor fixture builder and a direct
  resource fixture builder that composes the descriptor.

Validation:

- `npm exec vitest -- src/lib/world-display/texture-pages/indexed-resource-atlas-planner.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/webgl2-world-submit.test.ts src/lib/world-display/webgl2-direct-render-family.test.ts --run`
  from `apps/holtburger-3d`
  - Result: 4 test files passed, 57 tests passed.
- `npm run lint:ts` from `apps/holtburger-3d`
  - Result: passed.

Decisions and course corrections:

- The indexed planner is separate from `TexturePageAtlasPlan`. This keeps data-texture atlas policy
  separate from RGBA/detail atlas policy and avoids mixing sampler/filtering assumptions.
- Index texel pages use the existing rectangle layout planner with zero gutter. That planner still
  allocates max-size pages, so Phase B should measure index atlas memory before assuming this is the
  final allocation shape.
- Palette pages use a custom row planner. It creates tight `width x row-count` textures rather than
  max-size square atlas pages.
- The planner validates duplicate keys by comparing dimensions/format and byte contents. That is
  stricter than object identity and should catch accidental key collisions before WebGL upload.
- The descriptor metrics are first-class `WorldRenderMetrics` fields and also appear in
  `materialTypeCounts` under `webgl2-indexed-*` keys for debug/report visibility.

Remaining debt carried into Phase B:

- At this point, `Webgl2IndexedMaterialResources extends Webgl2IndexedMaterialDescriptor` remained as
  the main legacy shim. Phase G later removed it by composing a `descriptor` field.
- Phase B should decide whether indexed atlas resource lifecycle gets a deliberately separate
  `indexedResourceAtlasGeneration` store field or a small shared lifecycle helper. Do not reuse the
  RGBA/detail `textureAtlasGeneration` type directly.

### Phase B: Resource Lifecycle and WebGL Atlas Generation

Status: complete as of `2026-06-03`.

Completed:

- Added `indexedResourceAtlasGeneration` to the WebGL2 world resource store as a deliberately separate
  lifecycle from RGBA/detail `textureAtlasGeneration`.
- Generated P8, Index16, and palette atlas textures from `IndexedResourceAtlasPlan`.
- Added lifecycle cleanup and resource-store metrics.
- Kept direct indexed resources unchanged.
- Added tests for upload format, sampler state, packed byte contents, no-mipmap behavior, and dispose
  behavior.
- Fed atlas candidates from `Webgl2IndexedMaterialDescriptor`, not from direct indexed WebGL texture
  resources.
- Kept the existing direct indexed resource upload path until Phase F removes avoidable standalone
  uploads for compacted indexed draw units.

Validation:

- `npm exec vitest -- src/lib/world-display/webgl2-world-submit.test.ts src/lib/world-display/webgl2-direct-render-family.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/webgl2-indexed-resource-atlas-generation.test.ts src/lib/world-display/texture-pages/indexed-resource-atlas-planner.test.ts --run`
  from `apps/holtburger-3d`
  - Result: 5 test files passed, 59 tests passed.
- `npm run lint:ts` from `apps/holtburger-3d`
  - Result: passed.

Decisions and course corrections:

- Chose a deliberately separate `indexedResourceAtlasGeneration` store field instead of extracting a
  shared atlas lifecycle helper. This keeps data-texture behavior isolated while the shader submit path
  is still being built.
- The indexed generation graph uses an `atlas-generation` graph node labeled `indexed resource atlas`
  with index/palette texture counts. It currently has no prepared-asset dependencies because the atlas
  is descriptor-backed, not prepared-texture-asset backed.
- Indexed atlas candidates are limited to compacted indexed draw units. Retained-direct indexed
  alpha/blend materials are not atlased in this phase because no submit path consumes those atlases.
- The transitional resource-sync test now expects standalone direct index/palette uploads plus indexed
  atlas uploads for compacted indexed units. That is intentional debt until Phase F.
- Index atlas pages still use the max-size rectangle layout from the shared atlas planner. This can
  allocate large data pages, so runtime metrics should watch GPU memory/texture dimensions before this
  becomes the final allocator.

Remaining debt before Phase C:

- At this point, `Webgl2IndexedMaterialResources extends Webgl2IndexedMaterialDescriptor` still
  remained as the main legacy shim. Phase G later removed it.
- `indexedResourceAtlasGeneration` is generated but not consumed by compacted indexed submit yet.
  Phase C must wire material-table atlas placement fields and shader addressing before draw calls drop.
- Compacted indexed draw units still upload and retain standalone index/palette textures. Keep this
  visible through `compactedIndexedMaterialStandaloneResourceDrawUnitCount`; do not remove standalone
  uploads until atlas submit is stable.
- If index atlas memory is high in runtime reports, add an immediate Phase B.5 to replace max-size
  index pages with a tight data-page planner before Phase C.

Original Phase B checklist:

- Add `indexedResourceAtlasGeneration` to the WebGL2 world resource store, or extract a reusable atlas
  generation lifecycle helper before adding the field.
- Generate P8, Index16, and palette atlas textures from the plan.
- Add lifecycle cleanup and resource-store metrics.
- Keep direct indexed resources unchanged.
- Add tests for upload format, sampler state, and retained resource counts.
- Feed atlas candidates from `Webgl2IndexedMaterialDescriptor`, not from direct indexed WebGL texture
  resources.
- Keep the existing direct indexed resource upload path until Phase F removes avoidable standalone
  uploads for compacted indexed draw units.

### Phase C: Material Table and Shader Addressing

Status: complete as of `2026-06-03`.

Completed:

- Extended the compacted indexed submit material table with index and palette atlas rect uniforms.
- Updated P8 and Index16 compacted shaders to sample atlas-local indexed texels with integer
  `texelFetch` coordinates and palette rows through atlas-aware UVs.
- Changed compacted indexed submit to bind indexed resource atlas textures instead of standalone
  direct indexed textures.
- Made indexed resource atlas generation required for compacted indexed replacement planning. Missing
  atlas generation or placements now keep indexed draw units retained direct instead of submitting an
  incomplete compacted path.
- Added submit-test assertions proving compacted indexed draw units bind atlas textures and upload
  palette atlas size uniforms.

Validation:

- `npm exec vitest -- src/lib/world-display/webgl2-world-submit.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/webgl2-indexed-resource-atlas-generation.test.ts src/lib/world-display/texture-pages/indexed-resource-atlas-planner.test.ts --run`
  from `apps/holtburger-3d`
  - Result: 4 test files passed, 54 tests passed.
- `npm run lint:ts` from `apps/holtburger-3d`
  - Result: passed.

Decisions and course corrections:

- Binding indexed atlas textures moved from Phase D into Phase C. Shader addressing cannot be validated
  without binding atlas textures, so keeping binding separate would have created an unusable halfway
  state.
- Phase C did not regroup draw slices. Slices are still keyed by standalone `indexPageKey` and
  `palettePageKey`, so draw-call reduction is still expected in Phase D.
- Material table records still carry source page keys. The submit path resolves those keys into atlas
  placements through `indexedResourceAtlasGeneration`; Phase D can change slice keys once grouping is
  atlas-resource based.

Remaining debt before Phase D:

- Compacted indexed family resources still expose `indexPageKey` and `palettePageKey` as source keys.
  Addressed in Phase D for submit/resource binding. The source keys remain as diagnostics and material
  source identity, but submit no longer resolves them into atlas placements.
- Missing indexed atlas placements currently disable compacted indexed resource construction for the
  affected resource sync pass and leave draw units retained direct. Phase D added a fallback sample,
  but finer per-route blocker reporting remains future metrics work.
- Standalone direct indexed resources remain uploaded and retained for compacted indexed draw units.
  Keep this debt visible until Phase F.

### Phase D: Slice Regrouping and Submit

Status: complete as of `2026-06-03`.

Completed:

- Added atlas texture indices to indexed draw slices during WebGL compacted resource sync.
- Regrouped local indexed landblock slices by:
  - index format;
  - index atlas texture index;
  - palette atlas texture index;
  - detail atlas texture index;
  - render state.
- Moved compacted indexed submit away from source-key placement lookups. Submit now binds atlas
  textures by `slice.indexAtlasTextureIndex` and `slice.paletteAtlasTextureIndex`.
- Moved index and palette atlas rects onto compacted indexed material records, so material-table upload
  no longer needs `indexedResourceAtlasGeneration` placement scans.
- Threaded `indexedResourceAtlasPlan` into compacted geometry sync so atlas-aware slices are built
  before `buildCompactedGeometryBatch`.
- Added an incomplete-placement guard that skips indexed compacted resource creation and records a
  fallback sample instead of constructing a resource that would throw or submit incomplete atlas state.
- Added resource-store regression coverage proving compacted indexed slices can merge across visibility
  partitions when atlas state is compatible.

Validation:

- `npm exec vitest -- src/lib/world-display/webgl2-world-submit.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/webgl2-indexed-resource-atlas-generation.test.ts src/lib/world-display/texture-pages/indexed-resource-atlas-planner.test.ts src/lib/world-display/compaction/compaction-family-planner.test.ts --run`
  from `apps/holtburger-3d`
  - Result: 5 test files passed, 79 tests passed.
- `npm run lint:ts` from `apps/holtburger-3d`
  - Result: passed.

Decisions and course corrections:

- The global compaction planner still emits source-key indexed slices with nullable atlas texture
  indices. WebGL compacted resource sync fills atlas texture indices after indexed atlas planning,
  because the planner runs before atlas placements exist.
- A follow-up change removed visibility partitioning from compacted RGBA and indexed slice grouping.
  Compacted static batches are now explicitly overdraw-tolerant: if any represented draw unit is
  visible, the merged slice can submit hidden draw units that share the same compacted slice.
- Source `indexPageKey` and `palettePageKey` remain on WebGL indexed slices as diagnostics/source
  identity. They are no longer used for submit-time texture binding.
- Missing placements are handled at compacted resource sync time rather than submit time. This avoids
  late failures and keeps direct rendering responsible for affected draw units.

Remaining debt before Phase E:

- Runtime comparison now covers the original destination and the overdraw-tolerant static batching
  behavior. Phase E is complete for the baseline scene.
- Dedicated compacted slice limiter metrics are no longer immediate prep. Keep them as conditional
  diagnostics if another scene shows unexplained compacted draw pressure.

### Phase D.5: Indexed Slice Reason Metrics (Immediate Prep If Needed)

Status: superseded as immediate prep on `2026-06-03`.

The runtime comparison after visibility-agnostic compacted batching explained the remaining draw-call
pressure clearly enough for the baseline scene. Explicit limiter-reason metrics are still useful, but
they are no longer a blocker before Phase E.

- Count compacted indexed WebGL slices by grouping limiter:
  - atlas texture pair;
  - detail atlas texture;
  - material-table partition;
  - landblock batch boundary.
- Count overdraw introduced by visibility-agnostic compacted static batching.
- Include sample slice keys for the top limiter categories.
- Keep this diagnostic local to `apps/holtburger-3d`; it is renderer-specific and should not move into
  shared crates.

### Phase E: Metrics and Runtime Verification

Status: complete for the baseline destination as of `2026-06-03`.

Completed:

- Re-ran the original debug destination after indexed atlas resource grouping.
- Re-ran the original debug destination again after removing compacted static visibility partitioning.
- Compared visible draws, indexed shader draws, RGBA shader draws, replaced/retained counts,
  overdraw, FPS, and render time against the baseline report.

Baseline report:

- Generated: `2026-06-03T17:23:41.951Z`
- Visible draws: `2327`
- Render time: `26.0 ms`
- FPS: `33.5`
- Retained triangles: `115314`
- RGBA shader draws: `866`
- Indexed shader draws: `1084`
- Indexed estimate: `1711 -> 1441`
- Indexed saved: `270`
- Overdraw: `0 tris (0.00)`

After indexed resource atlasing and atlas-bound submit:

- Generated: `2026-06-03T18:48:41.543Z`
- Visible draws: `1801`
- Render time: `25.7 ms`
- FPS: `36.5`
- Retained triangles: `115314`
- RGBA shader draws: `866`
- Indexed shader draws: `558`
- Indexed estimate: `1711 -> 915`
- Indexed saved: `796`
- Overdraw: `0 tris (0.00)`

After visibility-agnostic compacted static grouping:

- Generated: `2026-06-03T18:55:07.788Z`
- Visible draws: `434`
- Render time: `25.1 ms`
- FPS: `37.4`
- Retained triangles: `254960`
- RGBA shader draws: `44`
- Indexed shader draws: `13`
- RGBA estimate: `3154 -> 401`
- Indexed estimate: `1711 -> 370`
- RGBA saved: `2753`
- Indexed saved: `1341`
- Overdraw: `95202 tris (0.48)`

Decisions and course corrections:

- Indexed atlas resource grouping worked as intended: indexed shader draws dropped from `1084` to
  `558` before any visibility-agnostic grouping.
- Removing compacted static visibility partitioning was the larger draw-call reducer: RGBA shader
  draws dropped from `866` to `44`, and indexed shader draws dropped from `558` to `13`.
- The overdraw tradeoff is currently favorable for the baseline scene: retained/submitted triangles
  increased from `115314` to `254960`, but render time improved from `26.0 ms` to `25.1 ms`.
- Draw pressure is no longer the dominant reported signal for this scene. Further work should focus on
  direct retained material families, portal masks/stencil cost, redundant standalone indexed uploads,
  and visual parity checks rather than more opaque static draw-call batching.

Remaining Phase E caveat:

- Visual parity should still be spot-checked manually for palette-varied statics and at least one
  Index16 material after the batching changes.

### Phase F: Remove Avoidable Standalone Indexed Uploads

Status: complete as of `2026-06-03`.

After atlas submit is stable, stop uploading standalone index/palette textures for indexed draw units
that are planned and submitted through the compacted indexed atlas path.

Completed:

- Changed WebGL draw-unit sync so indexed draw units are first created with descriptor metadata only.
- Added descriptor-backed indexed texture-page bindings. Compaction planning still sees
  `indexed-texels` and `palette-lookup` bindings without requiring standalone WebGL textures.
- Delayed standalone indexed texture upload until after compaction planning and indexed atlas
  placement are known.
- Retain/upload standalone indexed textures only for indexed draw units that are not atlas-placed
  compacted indexed units.
- Updated indexed resource tests so compacted indexed draw units assert:
  - descriptor metadata is present;
  - `directIndexedMaterialResources` direct WebGL resources are absent;
  - standalone indexed texture counts are `0`;
  - indexed atlas generation still uploads the P8/Index16 data atlas and palette atlas.

Validation:

- `npm exec vitest -- src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/webgl2-world-submit.test.ts src/lib/world-display/webgl2-direct-render-family.test.ts src/lib/world-display/texture-page-binding.test.ts src/lib/world-display/compaction/compaction-family-planner.test.ts --run`
  from `apps/holtburger-3d`
  - Result: 5 test files passed, 79 tests passed.
- `npm run lint:ts` from `apps/holtburger-3d`
  - Result: passed.

Decisions and course corrections:

- `TexturePageDescriptor` is now the metadata shape used by compaction/material coverage. Descriptor-
  backed indexed entries intentionally carry no WebGL texture.
- Direct RGBA binding code was adjusted to tolerate nullable binding textures. Retained direct indexed
  submit still requires direct indexed WebGL resources; compacted indexed draw units intentionally keep
  those resources `null`.
- Phase F left final naming/type cleanup for Phase G. `indexedMaterialDescriptor` remained the
  compaction/atlas source of truth.

Remaining debt after Phase F:

- Add an explicit retained-direct indexed resource test for a non-atlas-placed indexed material if a
  compact local fixture becomes available. Current tests cover the compacted path and direct submit
  helpers, but not a full world-resource retained-direct indexed scene.
- Rename `indexedMaterial` to `directIndexedMaterialResources` to remove the final naming ambiguity.
- Runtime metrics should continue reporting direct indexed texture counts separately from indexed atlas
  texture counts.

### Phase G: Direct Indexed Resource Cleanup

Status: complete as of `2026-06-03`.

Clean up the descriptor/direct-resource split introduced by Phase F so future indexed-atlas work does
not have to reason through ambiguous names or inheritance shims.

Completed:

- Renamed `Webgl2WorldDrawUnit.indexedMaterial` to `directIndexedMaterialResources`.
- Renamed the direct resource type to `Webgl2DirectIndexedMaterialResources`.
- Removed `Webgl2IndexedMaterialResources extends Webgl2IndexedMaterialDescriptor`; direct resources
  now compose a `descriptor` plus direct WebGL index/palette textures.
- Updated direct indexed submit, texture-page binding collection, texture retention metrics, and test
  fixtures to read descriptor metadata through `directIndexedMaterialResources.descriptor`.
- Split texture-page metadata from bindable GPU resources:
  - `TexturePageDescriptor` carries usage/sampling/rect metadata for compaction and metrics;
  - `TexturePageResourceBinding` carries a non-null WebGL texture for direct submit.
- Renamed helper functions that only touch retained direct indexed resources:
  `resolveWebgl2DirectIndexedMaterialResources` and `collectDirectIndexedMaterialTextureKeys`.
- Left staged-world `indexedMaterial` names unchanged because they refer to source material data, not
  retained WebGL resources.

Validation:

- `npm exec vitest -- src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/webgl2-world-submit.test.ts src/lib/world-display/webgl2-direct-render-family.test.ts src/lib/world-display/texture-page-binding.test.ts src/lib/world-display/compaction/compaction-family-planner.test.ts src/lib/world-display/webgl2-transition-portal-work.test.ts --run`
  from `apps/holtburger-3d`
  - Result: 6 test files passed, 84 tests passed.

Decisions and course corrections:

- Split texture-page metadata from bindable GPU resources. `TexturePageDescriptor` is used for
  compaction planning, while `TexturePageResourceBinding` is used for direct submit.
- The cleanup deliberately did not rename staged-world or material-strategy `indexedMaterial` fields.
  Those names still represent decoded indexed-paletted material data and are not part of the retained
  direct-resource ambiguity.

Remaining debt after Phase G:

- Add an explicit retained-direct indexed resource test for a non-atlas-placed indexed material if a
  compact local fixture becomes available. Current focused tests cover the compacted path and direct
  submit helpers, but not a full world-resource retained-direct indexed scene.
- Runtime metrics should continue reporting direct indexed texture counts separately from indexed atlas
  texture counts.
- The nullable `TexturePageBinding.texture` cleanup has been addressed by the descriptor/resource
  split. Future work should keep compaction planner inputs descriptor-only and direct submit inputs
  resource-backed.

## Acceptance Criteria

- Opaque indexed-paletted compacted draw units no longer bind standalone index/palette textures per
  source material when atlas placement succeeds.
- The indexed family can batch across distinct source palettes that share the same palette atlas.
- The indexed family can batch across distinct source index textures that share the same index atlas
  and format.
- Direct retained indexed alpha/blended materials still render through the existing direct path.
- Palette override and derived palette behavior remains correct because palette indirection is
  preserved.
- Debug metrics clearly show indexed resource atlas use and any placement failures.
- After Phase F/G, compacted indexed draw units do not retain redundant standalone direct index/palette
  texture resources.

## Risks

- Atlas edge bugs could produce wrong palette indices at UV boundaries. Keep manual wrap/clamp logic
  explicit and heavily tested.
- Palette rows with different lengths need correct bounds behavior. Shader lookup should continue to
  use per-material `paletteColorCount`.
- Uniform material-table pressure may remain a bottleneck. If 128 slots is still too small, consider
  texture-backed material tables after this work lands.
- Visibility-agnostic compacted static batching can increase overdraw. Track represented hidden
  draw units and triangles so draw-call wins do not hide a geometry-cost regression.
- Descriptor/direct-resource split may temporarily increase code surface. Keep the names honest:
  descriptors are source metadata; direct resources are WebGL textures for retained direct submit.
- Atlas generation can increase GPU memory if pages are always allocated at `maxAtlasTextureSize`.
  Use tight palette rows and consider tighter indexed page sizing if measurements show waste.

## Cleanup Targets

- `Webgl2WorldDrawUnit.indexedMaterial`: addressed in Phase G by renaming the retained direct-resource
  field to `directIndexedMaterialResources`.
- `Webgl2IndexedMaterialResources extends Webgl2IndexedMaterialDescriptor`: addressed in Phase G.
  Direct indexed resources now compose a descriptor instead of inheriting from it.
- Test helpers that set `indexedMaterialDescriptor: indexedMaterial`: addressed in Phase A.5 for the
  direct-render and world-submit helpers by composing explicit descriptor fixtures.
- `collectIndexedMaterialTextureKeys`: addressed in Phase F/G for compacted atlas-backed indexed draw
  units. It now exists as `collectDirectIndexedMaterialTextureKeys` and sees only retained direct
  indexed resources.
- `indexedResourceAtlasGeneration`: separate lifecycle is intentional for Phase B. After Phase C/D
  prove the final resource shape, consider extracting a small shared atlas-generation lifecycle helper
  if RGBA/detail and indexed resources still duplicate graph lease or dispose patterns.
- Compacted indexed WebGL slices still retain source `indexPageKey` / `palettePageKey` for diagnostics
  and source identity. Submit now binds atlas texture indices directly; if diagnostics grow cleaner
  atlas-resource fields, consider narrowing these source keys to material records only.
- Indexed texel atlas page sizing: replace max-size `planAtlasLayout` pages with a tighter indexed
  data-page planner if runtime metrics show memory waste.
- `Webgl2TextureAtlasGenerationResource`: keep RGBA/detail-specific, or extract shared lifecycle
  helpers without forcing indexed resources into this shape.
- `compactionCandidateDrawUnitCount`: consider reporting all compactable family candidates, or split
  by family. It currently uses the RGBA family count and can understate indexed work.
- Debug labels using generic "texture atlas" terminology should distinguish RGBA/detail atlases from
  indexed resource atlases.

## Suggested Test Commands

```bash
npm exec vitest -- src/lib/world-display/compaction/compaction-family-planner.test.ts src/lib/world-display/webgl2-world-resources.test.ts src/lib/world-display/webgl2-world-submit.test.ts --run
```

Add any new indexed atlas planner/resource tests to this command as they are introduced.
