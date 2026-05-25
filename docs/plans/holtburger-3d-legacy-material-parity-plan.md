# Holtburger 3D Legacy Material Parity Plan

## Purpose

Close the gap between the current `apps/holtburger-3d` renderer and the legacy
Asheron's Call material path used by retail and ACViewer.

This is the follow-up to
[`holtburger-3d-indexed-palette-materials-plan.md`](./holtburger-3d-indexed-palette-materials-plan.md).
The indexed palette foundation is in place: palette payloads are lossless,
`PFID_P8` and `PFID_INDEX16` can upload as index textures, and the renderer can
sample palettes in a patched `MeshStandardMaterial`.

The strategy authority remains
[`holtburger-3d-materials-texturing-strategy.md`](./holtburger-3d-materials-texturing-strategy.md).
When this plan and that strategy diverge, the strategy document wins unless code
or new reference evidence proves it stale.

## Current State

### Implemented

- `CSurface` material recipes resolve through `holtburger-content` and expose
  texture, palette, translucency, luminosity, and diffuse facts.
- Direct-color render surfaces can upload as ordinary Three.js textures.
- DXT render surfaces can upload when browser S3TC support is available.
- `PFID_P8` and `PFID_INDEX16` render through GPU palette lookup instead of
  load-time RGBA baking.
- Structured interior cell geometry uses env-cell surface IDs to build
  material groups.
- Static `GfxObj` and setup-model render groups include material signatures, so
  batching is no longer keyed only by geometry.
- Terrain material tables and their downstream render texture/surface/palette
  dependencies are schedulable assets.
- Prepared `setup-appearance/{setup_did}` payloads exist and preserve base
  setup part material slots, texture changes, animation part changes,
  `paletteId`, and `subPalettes`.

### Known Gaps

- Static setup-model rendering still expands parts from the raw
  `setup-model`/`GfxObj` path and uses `"setup-base"` slots. It does not prefer
  the prepared `setup-appearance` payload, so texture swaps and base appearance
  material slots can be ignored.
- Static `GfxObj` and setup rendering have no derived palette view identity.
  `materialSignature` reflects material slots, not per-instance subpalette
  replacement.
- The renderer selects only base material/default render-surface palettes for
  indexed textures. It does not compose `ObjDesc.paletteId` and `subPalettes`
  into a per-appearance palette texture.
- `ClothingTable`-driven appearance generation is not implemented. The lower
  level `ObjDesc + Setup` path should come first; clothing tables should later
  produce `ObjDesc` inputs in `holtburger-content`, not renderer-local clothing
  state.
- Legacy texture animation hooks are preserved opaquely but not applied.
  `TextureVelocity` and `TextureVelocityPart` should eventually drive
  per-instance UV offsets without mutating shared `GfxObj` geometry.
- Outdoor terrain is still diagnostic vertex color only. It does not consume
  `terrain-material/{regionNumber}`, terrain pcodes, overlay alpha maps, road
  maps, detail textures, or texture tiling.
- Interior cell geometry has material groups, but UV and sampler behavior has
  not been validated against ACViewer. The likely missing parity pieces are
  wrap/clamp selection from wrapping UVs, V-axis/orientation checks, and
  texture repeat settings for out-of-range UVs.
- Optional high-res JPEG replacement is not implemented. The retail client has
  engine support for `client_highres.dat` and `PFID_CUSTOM_RAW_JPEG`, but this
  should be treated as optional mounted-pack support rather than baseline retail
  visual parity unless we prove the target retail install actually shipped and
  activated those assets.
- `CSurface.diffuse` and `CSurface.luminosity` are preserved in payloads but
  mostly not reflected in Three material parameters.
- Clipmap handling exists for indexed materials, but broader clipmap/direct
  texture parity still needs validation.

## Reference Behavior

Keep these open while implementing:

- Retail material strategy:
  [`holtburger-3d-materials-texturing-strategy.md`](./holtburger-3d-materials-texturing-strategy.md)
- ACViewer indexed/subpalette expansion:
  `ACViewer/ACViewer/Render/TextureCache.cs`
- ACViewer setup appearance flow:
  `ACViewer/ACViewer/Model/Setup.cs`
- ACViewer static object batching:
  `ACViewer/ACViewer/Render/GfxObjInstance_Shared.cs`
- ACViewer env-cell batching and wrap/clamp decision:
  `ACViewer/ACViewer/Render/InstanceBatch.cs`
- ACViewer UV lookup:
  `ACViewer/ACViewer/Extensions/VertexArrayExtensions.cs` and
  `ACViewer/ACViewer/Model/Polygon.cs`
- ACViewer terrain blend direction:
  `ACViewer/ACViewer/Content/texture_clamp.fx`
- Holtburger content material graph:
  `crates/holtburger-content/src/material_graph.rs`
- Holtburger polygon render geometry:
  `crates/holtburger-content/src/landblock_scene_assets.rs`
- Holtburger renderer material cache:
  `apps/holtburger-3d/src/lib/world-display/material-resources.ts`
- Holtburger static renderable expansion:
  `apps/holtburger-3d/src/lib/world-display/static-renderables.ts`
- Holtburger terrain geometry:
  `apps/holtburger-3d/src/lib/world-display/terrain-geometry.ts`

## Parity Target

The target is near visual parity with the retail EOR client, using the
decompile, ACE DAT parsing, and real content as proof sources. We should not
sacrifice modern renderer architecture to clone every fixed-function or
pre-baked retail implementation detail, but visible output should trend toward
retail unless a documented tradeoff says otherwise.

ACViewer is a practical comparator and reference implementation for legacy DAT
interpretation, not a renderer architecture target. Use it to understand asset
semantics and to get rough visual comparisons, but choose renderer-native
techniques that fit Holtburger cleanly when they preserve the same visible
behavior. It is not the final source of truth when it conflicts with retail
evidence.

- setup/static/interior meshes should use the same texture IDs, palette IDs,
  texture swaps, and subpalette ranges as the resolved content graph;
- indexed materials should keep palette lookup on the GPU;
- texture sampling should respect AC wrapping/clamping behavior;
- terrain should visually approach retail while using a renderer-native material
  path rather than diagnostic colors or a premature CPU `TexMerge` clone;
- material diagnostics should distinguish missing data, unsupported formats,
  invalid palette views, and shader/resource capability gaps.

Exact CPU `TexMerge::FillTempTexBuffer` parity is deferred unless we later need
retail-identical terrain texels.

### Explicit Deferrals

The legacy parity target is a textured static snapshot plus the appearance
overrides required to render real outfits and static/setup objects correctly.
The following work is intentionally outside the first parity pass:

- Modern `RenderMaterial`, `MaterialModifier`, and `MaterialInstance` DATs:
  recognize/report them enough to avoid blocking asset loading, but defer full
  parsing and rendering until visible content requires the programmable material
  path.
- Legacy texture velocity animation: parse and preserve
  `TextureVelocity`/`TextureVelocityPart` as typed setup/animation/runtime data
  later, then expose renderer UV offsets keyed by object or part instance.
- `ClothingTable::BuildObjDesc`: implement after direct `ObjDesc` setup
  appearance parity works. Clothing tables are an appearance recipe source, not
  a separate renderer material model.

## Implementation Plan

### Pipeline Readiness

The current renderer is prepared for the first parity steps, but not for the
whole plan as-is.

Ready without broad refactor:

- Phase 2 can fit in `static-renderables.ts` because setup/static expansion
  now carries a typed `materialAppearanceContext`, material slots, and
  `materialSignature`. `materialAppearanceKey` remains temporarily as a display
  and compatibility field.
- Phase 3 can fit as diagnostics plus focused sampler/texture-resource changes.
  The polygon render geometry path already emits UVs and material surface IDs,
  and the renderer already centralizes direct/indexed texture upload helpers.

Needs deliberate boundary work before implementation:

- Do not keep growing `material-resources.ts` as a god module. It currently owns
  material plan orchestration, cache keys, fallback diagnostics, direct texture
  selection, indexed resource selection, palette resource lookup, and material
  construction. Derived palette views, scalar parity, and clipmap parity should
  be split into focused helpers before they land.
- Introduce an explicit renderer-local appearance context before Phase 4. It
  should carry the setup appearance key, selected part/material slots, base
  palette override, subpalette replacements, texture swap identity, and a stable
  palette-view signature. Passing only `appearanceKey: string` will become too
  lossy once derived palette resources exist.
- Keep the appearance context source-agnostic. It should represent resolved
  appearance facts from base setups, direct/server `ObjDesc` data, and future
  `ClothingTable -> ObjDesc` generation without exposing clothing-table concepts
  to Three.js.
- Add a derived palette resource/cache module rather than folding subpalette
  replacement into `palette-resources.ts` or `indexed-materials.ts`.
  `palette-resources.ts` should remain base palette upload logic.
- Add terrain-specific material/resource modules before Phase 7. Terrain uses
  pcodes, layer blends, alpha maps, roads, and detail textures; it should not be
  forced through the env-cell/static `CSurface` material slot model or the
  current debug-color `terrain-geometry.ts` path.
- Keep validation tooling separate from renderer production paths. Phase 3's
  comparison report should live in a harness/tool or pure diagnostic module, not
  as ad hoc debug branches inside `world-display-renderer.ts`.

Without these seams, later phases are likely to become patchwork. Treat the prep
phases below as part of the implementation plan, not optional cleanup.

### Dry-Run Findings

This plan was checked against the current code paths before implementation. The
following gaps should be addressed in order.

1. `setup-appearance` assets are supported but not naturally scheduled for
   setup models.
   - `setup-appearance/{setup_did}` is recognized by the Tauri adapter, worker,
     contracts, prepared asset types, and dependency walker.
   - `setup-model` dependencies currently expose only `gfxObjAssetIds`, and the
     dependency test explicitly says "without default setup appearance".
   - Phase 2 cannot simply "look for" a setup appearance payload and expect one
     to exist. The scheduler/contract must request the base setup appearance for
     visible setup models.
2. Setup appearance payloads carry selected parts and material slots but not
   placement frames or scale. That is fine for base setup routing: combine
   appearance-selected part/gfx/material data with placement/scale from the
   matching `setup-model` part index. Do not duplicate placement data into
   `setup-appearance` unless runtime evidence proves part replacement changes
   placement semantics.
3. Sampler state cannot be cached only by render-surface decode identity.
   Three.js stores wrap mode, filters, color space, and `flipY` on the texture
   object. ACViewer also keys texture batches by `HasWrappingUVs`. If the same
   render surface is used by both clamped and repeated geometry, Holtburger must
   produce distinct texture resources or texture clones keyed by sampling
   policy. Phase 1 must handle this before Phase 3 changes wrap/clamp behavior.
4. The current prepared render geometry emits UVs but does not carry an explicit
   UV bounds or `hasWrappingUvs` summary. Phase 3 can compute that from emitted
   UVs, but adding a small prepared geometry summary would make diagnostics and
   material planning cleaner. Prefer `uvBounds` plus `hasWrappingUvs` over
   re-scanning large arrays in several renderer paths.
5. `material-resources.ts` previously accepted only `appearanceKey: string`.
   Phase 0 replaced this with a typed `MaterialAppearanceContext` carrying the
   current key plus nullable selected-part, texture-swap, and palette-view
   signatures. Derived palette views still need the real palette composition
   data in Phase 4, but the renderer API no longer needs to change shape for
   that work.
6. Terrain data is currently flattened too early for material parity.
   `terrain-scene.ts` converts outdoor terrain into `PreparedTerrainMesh` and
   stores the quad pcode in a triangle field named `terrainType`. That is enough
   for debug colors but not enough for terrain material blending. Phase 7 should
   preserve quads, pcodes, region number, and material table identity in a
   material-ready terrain model.
7. Terrain scheduling is mostly ready. `landblock-outdoor` dependency extraction
   requests `terrain-material/{regionNumber}`, and terrain material payloads
   expose downstream render-texture, render-surface, and palette dependencies.
   The missing part is renderer consumption, not asset graph reachability.
8. Phase 3 validation can be mostly automated, but fixture selection still
   matters. Pick at least one problematic env cell and one static object/building
   sample before implementation. The comparison harness can generate the proof;
   screenshots should only confirm rendered output after the data report passes.

Cleanup targets created by this dry run:

- Rename or replace tests and comments that describe setup-model dependencies as
  intentionally excluding default setup appearances once Phase 2 scheduling is
  implemented.
- Add sampler-policy identity to texture resource cache keys before changing
  wrap/clamp or `flipY`.
- Keep base palette upload, derived palette composition, and indexed material
  shader patching in separate modules.
- Keep terrain material resources separate from static/interior `CSurface`
  material slots.
- Do not add debug-only branches to `world-display-renderer.ts`; use pure
  diagnostics or a harness/tool for Phase 3 comparison output.

### Phase 0: Material Pipeline Refactor Prep

Goal: create the seams needed for material parity work before adding more
behavior.

Progress: implemented.

Implemented changes:

- Added `material-appearance.ts` with renderer-local
  `MaterialAppearanceContext` and source-agnostic appearance signatures.
- Added `material-signatures.ts` for material asset IDs, prepared-state
  signatures, palette resource keys, and material cache keys.
- Added `material-plan.ts` for slot deduping, material-plan signatures,
  geometry slot mapping, fallback slot insertion, and material array assembly.
- Added `material-construction.ts` for material recipe interpretation,
  direct/compressed/indexed texture selection, fallback diagnostics, and
  placeholder material construction.
- Reduced `material-resources.ts` to GPU resource lifetime ownership,
  texture/palette/indexed texture caches, diagnostic de-duplication, and
  orchestration through the focused helpers.
- Threaded `MaterialAppearanceContext` through static renderables and
  `WorldMaterialResourceCache.resolveMaterialPlan()`.
- Added signature tests proving equivalent resolved appearance facts share cache
  keys regardless of whether the future source is direct `ObjDesc` data or
  clothing-table-generated `ObjDesc` data.

Decisions and course corrections:

- `MaterialAppearanceContext` describes resolved appearance facts only. It does
  not include source labels such as "server", "direct ObjDesc", or
  "ClothingTable".
- `materialAppearanceKey` remains on `StaticRenderablePart` as a temporary
  compatibility/display field while existing scene grouping and diagnostics are
  migrated. The material resource path now consumes `materialAppearanceContext`.
- The re-exports from `material-resources.ts` are a temporary import shim for
  existing callers. New code should import material signatures and appearance
  helpers from their focused modules.
- Fallback material selection lives with material construction for now because
  it depends on recipe/provenance/dependency diagnostics. If scalar parity
  starts expanding this module too much, split fallback diagnostics and
  placeholder material creation into a separate helper.

Cleanup targets from Phase 0:

- Remove the `material-resources.ts` re-export shim once nearby callers import
  from `material-signatures.ts`, `material-plan.ts`, and
  `material-appearance.ts` directly.
- Collapse or remove `materialAppearanceKey` after Phase 2 proves setup
  appearance routing can use `MaterialAppearanceContext` everywhere that needs
  identity.
- Add a small `MaterialAppearanceContext` builder for setup-appearance payloads
  in Phase 2 instead of hand-authoring signatures at each call site.
- Keep watching `material-construction.ts`; it is intentionally a split from
  cache ownership, not a license to accumulate terrain or derived-palette logic.

Refinements to future steps:

- Phase 1 should add sampling policy as another typed input to plan/material
  construction rather than adding optional bags to `resolveMaterialPlan()`.
- Phase 2 should fill `selectedPartsSignature` from the resolved setup
  appearance payload and use direct setup-appearance material slots before
  touching palette derivation.
- Phase 4 should fill `paletteViewSignature` and add a separate derived palette
  resource/cache module. Base palette upload remains in `palette-resources.ts`.
- Phase 5 should fill `textureSwapSignature` from resolved `ObjDesc` texture
  changes and should reuse the same context builder that Phase 2 introduces.

- Split material plan construction from material resource creation:
  - material plan input/output types;
  - geometry slot mapping;
  - material array construction;
  - fallback material selection.
- Move cache-key and signature construction into focused helpers with tests.
- Introduce a typed renderer-local material appearance context. Initially it can
  wrap today's `appearanceKey`, but it should be able to grow into palette-view
  identity and texture-swap identity without changing every call site.
- Make material appearance signatures describe resolved appearance facts, not
  the source that produced them. Equivalent direct `ObjDesc` and future
  clothing-generated appearances should be able to share material and palette
  resources.
- Thread enough material-source context through `resolveMaterialPlan()` for
  future per-slot sampling policy and palette-view identity. Avoid widening the
  API with loosely typed optional bags.
- Keep `WorldMaterialResourceCache` as the owner of GPU resource lifetimes, but
  move format-specific decisions into smaller modules.
- Add tests that prove the refactor preserves current direct-color, compressed,
  indexed, fallback, and material grouping behavior.

Completion criteria:

- `material-resources.ts` is mostly orchestration and lifetime ownership.
- Direct texture, indexed texture, base palette, material construction, and
  signature helpers live behind focused APIs.
- No visual behavior changes are intended in this phase.

### Phase 1: Texture Sampling Policy Prep

Goal: isolate texture sampler decisions before changing UV behavior.

Progress: implemented.

Implemented changes:

- Added `texture-sampling-policy.ts` with typed wrap, filter, color-space,
  mipmap, and `flipY` policy data.
- Added format-aware default material texture sampling policy buckets for
  direct-color render surfaces, compressed render surfaces, and indexed render
  surfaces.
- Threaded explicit `TextureSamplingPolicy` values through
  `createRenderSurfaceTexture()`, `createIndexedTextureResource()`,
  `WorldMaterialResourceCache.getTexture()`, and
  `WorldMaterialResourceCache.getIndexedTextureResource()`.
- Added sampling policy identity to direct/compressed/indexed texture resource
  cache keys so the same render surface can be cached separately for clamped and
  repeated sampling.
- Kept material construction on a single `MaterialTextureSamplingPolicy`
  context instead of adding loose optional parameters to individual texture
  call sites.
- Added tests for default policy values, policy application, policy identity,
  indexed texture policy use, and cache separation by sampling policy.

Decisions and course corrections:

- Current behavior is preserved by default. Direct-color `DataTexture` uploads
  keep clamp wrapping, nearest filtering, sRGB color space, no mipmaps, and
  `flipY = false`. Compressed textures keep clamp wrapping, linear filtering, no
  mipmaps, and `flipY = false`, with sRGB only when S3TC sRGB upload is
  supported. Indexed textures keep clamp wrapping, nearest filtering,
  non-color data, no mipmaps, and `flipY = false`.
- `MaterialTextureSamplingPolicy` is bucketed by render-surface kind instead of
  using one global policy, because Three.js `DataTexture`, `CompressedTexture`,
  and indexed palette lookup textures had different existing sampler defaults.
- Geometry-derived wrap selection is not implemented in Phase 1. The seam is in
  place; Phase 3 should compute or consume `uvBounds`/`hasWrappingUvs` and
  choose between clamp/repeat by supplying a different policy.
- Texture velocity remains separate from sampling policy. Future UV scrolling
  should update instance or material UV transform state, not the texture
  resource cache key.

Cleanup targets from Phase 1:

- Keep policy converter helpers private unless another module truly needs Three
  constants directly.
- Once Phase 3 introduces geometry-derived policy selection, remove any
  temporary call-site assumptions that all static/interior materials use the
  cache default policy.
- Add terrain policy buckets or terrain-specific policy helpers in Phase 9
  instead of forcing terrain sampling through static/interior defaults.

Refinements to future steps:

- Phase 2 can ignore sampler selection unless setup appearance routing exposes
  geometry or material slots that need a non-default policy.
- Phase 3 should become the phase that adds `uvBounds`/`hasWrappingUvs` to
  prepared render geometry or a single fallback computation helper. Do not
  re-scan UV arrays independently in renderer, diagnostics, and cache logic.
- Phase 3 should select wrap/clamp by producing a per-material or per-geometry
  `MaterialTextureSamplingPolicy` before calling `resolveMaterialPlan()`.
- Phase 7 texture velocity should not modify `TextureSamplingPolicy`; it needs a
  separate instance/part UV-offset model.

- Add `texture-sampling-policy` helpers for wrap/clamp, `flipY`, color-space,
  mipmap, and filter decisions.
- Thread the policy through direct-color, compressed, indexed, and future
  terrain texture resources.
- Include sampling policy identity in texture resource cache keys. Reusing a
  single Three.js `Texture` for both clamped and repeated geometry is incorrect
  because sampler state lives on the texture object.
- Decide where geometry-derived UV policy lives. Prefer a small
  `uvBounds`/`hasWrappingUvs` summary on prepared render geometry, with a
  fallback helper that computes it from emitted UV arrays for older fixtures.
- Keep sampling policy separate from future texture-velocity animation. Wrap,
  filter, color-space, mipmap, and `flipY` decisions belong to texture resource
  policy; per-object or per-part UV offsets should later be instance state, not
  shared texture identity.
- Preserve current behavior by default until Phase 3 proves the AC-specific
  policy changes.
- Add tests for policy defaults and resource application.

Completion criteria:

- Sampler state is not scattered through resource constructors.
- Texture cache reuse is safe across different wrap/filter/`flipY` policies.
- Phase 3 can change wrap/clamp or `flipY` behavior by changing policy logic,
  not individual texture upload call sites.

### Phase 2: Setup Appearance Routing

Goal: make setup-model statics consume prepared `setup-appearance` payloads.

- In `static-renderables.ts`, when a static source asset is a setup model, look
  for `setup-appearance/{setupModelId}` and use its parts/material slots when
  available.
- First update setup-model scheduling so the base `setup-appearance/{setupDid}`
  asset is requested for visible setup models. Either add explicit
  `setupAppearanceAssetIds` to setup-model dependencies or teach the scene
  request planner to derive the base setup appearance route from visible setup
  model IDs.
- Preserve the current raw setup fallback for missing or failed appearance
  assets, with explicit diagnostics.
- Use the setup appearance key in `materialAppearanceKey`.
- Ensure `materialSignature` changes when setup appearance material slots differ
  from raw `GfxObj` slots.
- Continue using setup-model placement frames and per-part scale by part index;
  do not move placement data into setup appearance payloads in this phase.
- Add tests proving setup appearance texture-swapped material slots flow into
  static renderable parts.

Expected effect: building/setup/static objects should stop rendering as
untextured placeholders when the material graph already has the correct resolved
slots.

### Phase 3: UV And Sampler Parity Validation

Goal: prove whether interior texture orientation/tiling bugs come from decoded
UVs, sampler state, or material upload. The primary validation path should be
programmatic; manual visual inspection is only a final smoke check after the
data and renderer-state comparisons are explainable.

- Add a small diagnostic/export harness that emits per-polygon vertex IDs,
  UV indices, UV values, surface slot, and material/render-surface IDs for a
  known problematic env cell.
- Compare Holtburger output against ACViewer's `BuildUVLookup()` and
  `Polygon.BuildIndices()` behavior.
- Produce a deterministic comparison report for each fixture env cell covering:
  - polygon IDs;
  - triangle fan order;
  - surface slot and resolved `CSurface` ID;
  - UV index selection;
  - emitted UV values;
  - render texture/render surface IDs;
  - wrap/clamp policy;
  - texture `flipY` or V-axis transform policy.
- Add renderer texture wrapping policy:
  - if any vertex UV on the source vertex array is outside `[0, 1]`, use repeat
    wrapping;
  - otherwise use clamp wrapping;
  - mirror ACViewer's `HasWrappingUVs` behavior first, then refine only with
    reference evidence.
- Validate whether Three's default V-axis handling needs `flipY = false` or UV
  V inversion for DAT textures.
- Add targeted tests around UV emission and texture wrap selection.
- Use manual Holtburger-vs-reference screenshots only after the comparison
  report passes, to catch renderer-state issues that are hard to infer from
  data alone.

Expected effect: interior textures should become visible and consistently tiled
or clamped before deeper material work.

### Phase 4: Derived Palette Views

Goal: compose per-appearance palette textures for indexed materials.

- Introduce a renderer-local `PaletteView`/`DerivedPaletteResource` signature:
  base palette asset ID, base prepared signature, appearance palette ID,
  subpalette list, subpalette prepared signatures.
- Apply `ObjDesc.paletteId` as the base palette override when present.
- Apply each `SubPalette` by replacing the destination range with colors from
  the referenced subpalette.
- Include palette view identity in material signatures and material cache keys.
- Keep derived palette upload in `apps/holtburger-3d`; do not promote
  Three.js resource policy into shared crates.
- Add diagnostics for missing base palettes, missing subpalettes, invalid
  ranges, and palette index out-of-range after derivation.

Expected effect: indexed clothing, skin, hair, and dyed/static appearance paths
can use the same indexed render surfaces with different palette views.

### Phase 5: Texture Swap And Appearance Parity

Goal: ensure `ObjDesc.texture_changes` and `anim_part_changes` affect static and
runtime renderables consistently.

- Extend asset IDs or renderer inputs so runtime objects can request
  setup appearances with real `ObjDesc` data, not only base
  `setup-appearance/{setup_did}`.
- Keep content resolution in `holtburger-content`; keep renderer material
  policy in `apps/holtburger-3d`.
- Make material cache signatures include selected part IDs, texture swap
  identity, and palette view identity.
- Treat this as the canonical path for resolved appearances:
  `ObjDesc + Setup -> setup-appearance payload`. Clothing tables should later
  feed this path by producing an `ObjDesc`, not by adding renderer-specific
  clothing state.
- Add integration tests using the existing
  `resolve_setup_appearance_with_texture_and_part_overrides` coverage as the
  Rust-side truth.

Expected effect: appearance changes should select the right mesh parts,
textures, and palettes without mutating base DAT material definitions.

### Phase 6: ClothingTable Appearance Generation

Goal: make retail clothing/outfit recipes produce the same appearance inputs as
server-supplied `ObjDesc` data.

- Implement `ClothingTable::BuildObjDesc` in `holtburger-content` after direct
  `ObjDesc + Setup` resolution is proven in Phase 5.
- Keep `ClothingTable` parsing and recipe resolution out of the renderer. The
  renderer should continue consuming setup-appearance payloads, palette views,
  texture swaps, and material signatures.
- Use client naming and semantics from the strategy doc:
  `ClothingBase`, `CloObjectEffect`, `CloTextureEffect`,
  `CloPaletteTemplate`, and `CloSubpalEffect`.
- Preserve the retail palette shade selection formula, including the
  `(count - 0.000001) * hue` epsilon.
- Add tests proving clothing-generated `ObjDesc` values produce the same
  selected parts, texture swaps, subpalette dependencies, and appearance keys as
  equivalent direct `ObjDesc` inputs.

Expected effect: character and equipment appearances can flow through the same
renderer path whether they originate from server `ObjDesc` data or retail
clothing table recipes.

### Phase 7: Legacy Texture Velocity Animation

Goal: add the legacy UV-scrolling path without pulling in the modern material
DAT system.

- Parse `TextureVelocity` and `TextureVelocityPart` hook payloads into typed
  data instead of preserving them opaquely.
- Preserve texture velocity data in setup, animation, or runtime appearance
  payloads at the layer where the hook is actually resolved.
- Apply UV offsets as renderer instance state keyed by object or part instance.
  Do not mutate shared `GfxObj` geometry or shared material definitions.
- Keep this separate from modern `Waveform`/`LayerModifier` material animation.
- Add tests for hook parsing and renderer key/signature behavior. Do not write
  tests for debug-oriented logging.

Expected effect: legacy scrolling textures can animate while static material
identity, batching, and shared geometry remain correct.

### Phase 8: Clipmap And Scalar Material Behavior

Goal: tighten the non-topological material properties.

- Validate `SurfaceType.Base1ClipMap` for indexed and direct/DXT texture paths.
- Map `CSurface.translucency`, `diffuse`, and `luminosity` into Three material
  behavior with reference screenshots or ACViewer comparisons.
- Avoid inventing formulas for fields with no proven active retail path.
- Add diagnostics for unsupported scalar behavior if exact parity is deferred.

Expected effect: alpha-cut, translucent, luminous, and diffuse-tinted surfaces
should be closer to retail without weakening the material data model.

### Phase 9: Terrain Material Pipeline Prep

Goal: introduce terrain-specific renderer boundaries before implementing terrain
blending.

- Add terrain material/resource types that consume landblock terrain quads,
  pcodes, and `terrain-material/{regionNumber}` tables without pretending they
  are `CSurface` slots.
- Split debug terrain geometry from material-ready terrain geometry so the
  renderer can carry quad/pcode/layer attributes without losing the current
  fallback path.
- Add terrain material cache/signature helpers scoped to terrain resources.
- Add diagnostics for missing terrain material table, missing texture resources,
  unsupported terrain render-surface formats, and absent alpha/road maps.
- Keep this app-local under `apps/holtburger-3d`.

Completion criteria:

- Terrain has a material-ready data path and diagnostics while still rendering
  the existing debug-color fallback.
- `terrain-scene.ts` no longer has to collapse quad pcodes into a triangle
  `terrainType` field for material-ready rendering.
- Phase 10 can add blending shaders/resources without refactoring terrain scene
  selection or geometry ownership.

### Phase 10: Terrain TexMerge GPU Path

Goal: replace diagnostic terrain colors with renderer-native terrain materials
that preserve retail terrain semantics.

- Build a terrain material resource path that consumes:
  - `landblock-outdoor.terrain.quads[].pcode`;
  - `terrain-material/{regionNumber}`;
  - terrain base/detail textures and tiling;
  - terrain overlay alpha maps;
  - road textures and road alpha maps.
- Emit terrain geometry attributes with quad/pcode-driven layer indices and UVs.
- Use GPU texture arrays or grouped materials to blend base, overlays, roads,
  and alpha maps.
- Keep detail texture sampling as a separate overlay with distance fade, per the
  strategy doc.
- Preserve color-variation fields in data and diagnostics, but do not implement
  an invented HSB variation path.

Expected effect: outdoor terrain stops being debug-colored and begins using
terrain material data in a way that can be compared against retail visuals.

### Phase 11: Optional High-Res JPEG Replacement

Goal: support `PFID_CUSTOM_RAW_JPEG` render-surface replacement when an optional
high-res DAT pack is mounted.

- Detect `client_highres.dat` replacement records when mounted and enabled.
- Treat high-res substitutions as `RenderSurface` DataID replacements and honor
  mounted archive priority order when resolving render-surface records.
- Decode JPEG render surfaces through browser/Rust-safe image decoding.
- Preserve the reference channel swap behavior from ACViewer.
- Keep fallback diagnostics explicit when high-res content is absent, disabled,
  or not part of the mounted retail dataset.

Expected effect: optional high-res texture packs can improve fidelity without
changing the legacy material graph or redefining the baseline retail parity
target.

## Suggested Order

1. Phase 0 material pipeline refactor prep.
2. Phase 1 texture sampling policy prep.
3. Phase 2 setup appearance routing.
4. Phase 3 UV and sampler validation.
5. Phase 4 derived palette views.
6. Phase 5 runtime appearance parity.
7. Phase 6 ClothingTable appearance generation.
8. Phase 7 legacy texture velocity animation.
9. Phase 8 clipmap/scalar behavior.
10. Phase 9 terrain material pipeline prep.
11. Phase 10 terrain TexMerge GPU path.
12. Phase 11 optional high-res JPEG replacement.

This order should improve the currently observed failures fastest:

- untextured outdoor buildings/static setup objects are likely blocked by setup
  appearance routing and material-slot use;
- wrong or invisible interior textures are likely blocked by UV/sampler parity;
- outdoor terrain is intentionally debug-colored until the terrain shader path
  exists.

## Validation Checklist

- Pick one outdoor landblock with visible buildings, generated scenery, static
  objects, and terrain.
- Pick one interior env cell with currently wrong orientation/tiling.
- For each reference sample, record:
  - visible material asset IDs;
  - render-surface formats;
  - palette selection source;
  - wrapping/clamp policy;
  - Phase 3 UV/sampler comparison report output;
  - material diagnostics;
  - screenshots from Holtburger and ACViewer.
- Run unit tests for content material resolution, renderer material cache, UV
  emission, palette derivation, and terrain layer selection.
- Run browser smoke validation after each phase.

## Risks

- Palette-view identity can fragment instancing. Correctness wins first; batch
  optimization should follow once visual parity is stable.
- Three shader patches can break on Three upgrades. Keep indexed and terrain
  shader code isolated.
- Texture wrap and V-axis changes can improve interiors while regressing object
  meshes. Validate both with fixture IDs before making global changes.
- Terrain texture arrays may require fallback grouping if browser texture-array
  limits are lower than expected.
- ACViewer sometimes uses pragmatic renderer shortcuts. Use retail references
  when ACViewer behavior conflicts with decoded data or the strategy document.
