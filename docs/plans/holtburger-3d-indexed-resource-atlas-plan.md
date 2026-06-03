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
- Do not collapse visibility partitions unless a separate visibility/overdraw analysis proves it is
  worthwhile.

## Dry-Run Findings

Dry-running this plan against the current WebGL2 renderer surfaces these constraints and scheduling
corrections:

- `Webgl2WorldDrawUnit.indexedMaterial` currently means "direct draw WebGL textures plus metadata".
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
- Slice grouping by visibility partition remains intentional. The atlas work should first remove
  resource-bind fragmentation; visibility partition overdraw tradeoffs can be revisited with fresh
  metrics afterward.

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

Keep the existing `indexedMaterial` direct texture resource path working, but stop treating it as the
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
- visibility partition;
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

- Add the indexed material descriptor described in Phase 0.
- Keep direct indexed draw behavior unchanged.
- Update compaction candidate conversion to use descriptor metadata instead of direct WebGL texture
  resource presence.
- Add tests proving indexed compaction planning works without requiring standalone texture upload as
  the source of truth.
- Add indexed resource atlas planner types and pure planning tests.
- Prove P8, Index16, and palette placements are deterministic.
- Prove atlas failures do not affect unrelated RGBA/detail atlas placement.
- Prove palettes dedupe by palette texture key.

### Phase B: Resource Lifecycle and WebGL Atlas Generation

- Add `indexedResourceAtlasGeneration` to the WebGL2 world resource store, or extract a reusable atlas
  generation lifecycle helper before adding the field.
- Generate P8, Index16, and palette atlas textures from the plan.
- Add lifecycle cleanup and resource-store metrics.
- Keep direct indexed resources unchanged.
- Add tests for upload format, sampler state, and retained resource counts.

### Phase C: Material Table and Shader Addressing

- Extend indexed material table records with index/palette atlas placement fields.
- Update P8 and Index16 compacted shaders to sample atlas-local texels and palette rows.
- Add shader-level unit tests where feasible through submit mocks and material table assertions.

### Phase D: Slice Regrouping and Submit

- Change indexed draw slice keys from individual index/palette texture keys to atlas texture indices.
- Bind atlas textures during compacted indexed submit.
- Keep missing atlas placements as retained direct with explicit blocker/fallback samples.
- Add tests proving multiple indexed materials with different source textures/palettes collapse into
  fewer submitted slices when they share atlas resources.

### Phase E: Metrics and Runtime Verification

- Extend render metrics and debug report text before relying on field testing.
- Run the 3D debug destination from the original report.
- Compare:
  - visible draws;
  - indexed family shader draws;
  - indexed replaced/retained draw units;
  - indexed atlas texture counts;
  - texture binding counts;
  - FPS/render time.
- Inspect at least one palette-varied static and one Index16 material for visual parity.

### Phase F: Remove Avoidable Standalone Indexed Uploads

After atlas submit is stable, stop uploading standalone index/palette textures for indexed draw units
that are planned and submitted through the compacted indexed atlas path.

Expected cleanup targets:

- Split direct indexed texture resources from indexed material descriptor metadata.
- Retain standalone indexed textures only for retained direct indexed materials.
- Revisit `collectIndexedMaterialTextureKeys` so compacted indexed units do not pin standalone direct
  resources.
- Update texture count metrics to report retained direct indexed textures separately from indexed atlas
  textures.

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
- After Phase F, compacted indexed draw units do not retain redundant standalone direct index/palette
  texture resources.

## Risks

- Atlas edge bugs could produce wrong palette indices at UV boundaries. Keep manual wrap/clamp logic
  explicit and heavily tested.
- Palette rows with different lengths need correct bounds behavior. Shader lookup should continue to
  use per-material `paletteColorCount`.
- Uniform material-table pressure may remain a bottleneck. If 128 slots is still too small, consider
  texture-backed material tables after this work lands.
- Visibility partitioning may still produce many slices. Treat that as a later culling/overdraw tradeoff
  after resource-bind fragmentation is removed.
- Descriptor/direct-resource split may temporarily increase code surface. Keep the names honest:
  descriptors are source metadata; direct resources are WebGL textures for retained direct submit.
- Atlas generation can increase GPU memory if pages are always allocated at `maxAtlasTextureSize`.
  Use tight palette rows and consider tighter indexed page sizing if measurements show waste.

## Cleanup Targets

- `Webgl2WorldDrawUnit.indexedMaterial`: rename or split so it no longer conflates descriptor metadata
  with direct WebGL textures.
- `collectIndexedMaterialTextureKeys`: make this retain only direct indexed textures after atlas submit
  can replace compacted indexed units.
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
