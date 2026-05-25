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
- Runtime `ObjDesc` overrides are no longer represented as app asset routes.
  The rejected `setup-appearance/{setup_did}/obj-desc/...` route was removed;
  override-shaped appearances now have a bounded derived appearance cache API
  keyed by `Setup + normalized ObjDesc`.
- Static setup-model rendering requests and prefers prepared
  `setup-appearance/{setup_did}` payloads when available, while retaining raw
  setup-model part rendering as an explicit fallback.
- Material plans, final material cache keys, and static renderable geometry
  groups carry immutable material variant identity. Prepared polygon content
  now emits sampler-derived `sampler=clamp`/`sampler=repeat` variants; older or
  missing variant data still normalizes to `base`.
- Prepared polygon render geometry now emits side-local sampler material
  variants from retail `CPolygon.stippling` bits, and the 3D renderer uses
  those variants to split material slots/groups and choose clamp or repeat
  texture wrapping.
- Indexed material rendering can now consume renderer-local derived palette
  views from `MaterialAppearanceContext`: an appearance `paletteId` overrides
  the material/render-surface selected base palette, and appearance subpalettes
  are composed into a per-view palette texture before shader binding.
- Setup appearance material contexts fill `textureSwapSignature` from resolved
  `ObjDesc.texture_changes`, so material cache keys now distinguish texture
  swap variants as well as selected parts and palette views.

### Known Gaps

- Live runtime object integration still needs a producer that feeds
  server/client `ObjDesc` values into the derived runtime appearance cache and
  dependency planner. The content resolver and cache API exist, but the 3D app
  still mostly discovers base setup snapshots from static DAT scene sources.
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
- Interior cell geometry preserves the retail side-local sampler rule and has a
  deterministic sampler/UV report harness, but broader ACViewer side-by-side
  fixture comparison and final V-axis screenshot validation are still pending.
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
- Retail legacy sampler path:
  `acclient-eor-source/acclient.c` `D3DPolyRender::SetSurface(...)`
- Retail polygon packing/stippling flags:
  `acclient-eor-source/acclient.c` `CPolygon::Pack/UnPack` and
  `acclient-eor-source/acclient.h` `CPolygon`
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

Retail decompile course correction: legacy polygon rendering does not appear to
infer repeat/clamp by checking whether UV coordinates fall outside `[0, 1]`.
`D3DPolyRender::SetSurface(CPolygon*, ...)` passes a side-local `stippled`
boolean derived from `CPolygon.stippling` bit `0x1` for the positive side and
bit `0x2` for the negative side. `D3DPolyRender::SetSurface(CSurface*, bool,
...)` then sets `TEXADDRESS_WRAP` when that boolean is true and
`TEXADDRESS_CLAMP` when false. Bits `0x4` and `0x8` are the no-positive-UV and
no-negative-UV serialization flags. ACViewer's `HasWrappingUVs` should therefore
be treated as a comparator/heuristic, not the primary source of truth for
Holtburger's legacy sampler policy.

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
  path. The retail binary has live `RenderMaterial` users, including UI and the
  newer `RenderMesh` path, but legacy `GfxObj`/`CPolygon`/`CSurface` rendering
  does not use that material stack.
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
- Phase 2.5 should prepare material identity and geometry grouping for sampler
  variation before Phase 3 changes visible behavior. The texture resource cache
  can already distinguish sampling policies, but material plans and geometry
  groups still need a stable variant identity.
- Phase 3 can then fit as diagnostics plus focused prepared-geometry, sampler,
  and texture-resource behavior changes. The polygon render geometry path
  already emits UVs and material surface IDs, and the renderer already
  centralizes direct/indexed texture upload helpers, but the prepared path still
  needs to carry the legacy side-local sampler flag.

Needs deliberate boundary work before implementation:

- Do not keep growing `material-resources.ts` as a god module. It currently owns
  material plan orchestration, cache keys, fallback diagnostics, direct texture
  selection, indexed resource selection, palette resource lookup, and material
  construction. Derived palette views, scalar parity, and clipmap parity should
  be split into focused helpers before they land.
- Avoid collapsing all material variation into one mega-cache. Keep immutable
  GPU resource caches layered by responsibility: texture resources by render
  surface plus sampler/upload policy, palette resources by base or derived
  palette view, indexed helpers by index texture plus palette view plus sampler
  policy, and final Three materials by the resolved material recipe/signature.
  Per-instance or time-varying state, such as texture velocity offsets, should
  stay outside shared cache keys unless a renderer-native alternative is proven
  impossible.
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
- Add terrain-specific material/resource modules before Phase 9. Terrain uses
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

1. `setup-appearance` assets are supported and are now scheduled for visible
   setup models.
   - `setup-appearance/{setup_did}` is recognized by the Tauri adapter, worker,
     contracts, prepared asset types, and dependency walker.
   - `setup-model` dependencies still expose only `gfxObjAssetIds`; the scene
     request planner derives the base `setup-appearance/{setupDid}` route for
     visible setup-model source IDs instead of widening the setup-model
     contract.
   - Phase 2 added planner tests proving visible setup models request their base
     setup appearance and follow appearance-selected part/material dependencies
     once the appearance payload is prepared.
2. Setup appearance payloads carry selected parts and material slots but not
   placement frames or scale. That is fine for base setup routing: combine
   appearance-selected part/gfx/material data with placement/scale from the
   matching `setup-model` part index. Do not duplicate placement data into
   `setup-appearance` unless runtime evidence proves part replacement changes
   placement semantics.
3. Sampler state cannot be cached only by render-surface decode identity.
   Three.js stores wrap mode, filters, color space, and `flipY` on the texture
   object. Retail legacy polygons can use the same render surface through both
   clamped and repeated sampler modes, so Holtburger must produce distinct
   texture resources or texture clones keyed by sampling policy. Phase 1 handled
   the texture-resource cache side. Phase 2.5 handled material-plan and
   geometry-group identity. Phase 3 should now feed those seams with
   stippling-derived sampler variants; texture-cache identity alone would not be
   enough if one geometry group otherwise contained both clamped and repeated
   polygons for the same `CSurface`.
4. The current prepared render geometry emits UVs but does not carry the
   polygon-side legacy sampler bit that retail uses. Phase 3 should preserve the
   positive/negative-side wrap flag from `CPolygon.stippling` through prepared
   geometry or material group metadata. A `uvBounds`/`hasWrappingUvs` summary is
   still useful for diagnostics and ACViewer comparison, but it should not be
   the primary source of sampler truth when stippling data is available.
5. `material-resources.ts` previously accepted only `appearanceKey: string`.
   Phase 0 replaced this with a typed `MaterialAppearanceContext` carrying the
   current key plus nullable selected-part, texture-swap, and palette-view
   signatures. Derived palette views still need the real palette composition
   data in Phase 4, but the renderer API no longer needs to change shape for
   that work.
6. Terrain data is currently flattened too early for material parity.
   `terrain-scene.ts` converts outdoor terrain into `PreparedTerrainMesh` and
   stores the quad pcode in a triangle field named `terrainType`. That is enough
   for debug colors but not enough for terrain material blending. Phase 9 should
   preserve quads, pcodes, region number, and material table identity in a
   material-ready terrain model.
7. Terrain scheduling is mostly ready. `landblock-outdoor` dependency extraction
   requests `terrain-material/{regionNumber}`, and terrain material payloads
   expose downstream render-texture, render-surface, and palette dependencies.
   The missing part is renderer consumption, not asset graph reachability.
8. Phase 3 validation can be mostly automated after Phase 2.5 material identity
   prep lands, but fixture selection still
   matters. Pick at least one problematic env cell and one static object/building
   sample before implementation. The comparison harness can generate the proof;
   screenshots should only confirm rendered output after the data report passes.

Cleanup targets created by this dry run:

- Continue removing any stale tests or comments that describe setup-model
  dependencies as intentionally excluding base setup appearances. Phase 2
  renamed the main planner test, but nearby planning comments may still need
  cleanup as Phase 2.5/3 touch the same code.
- Add sampler-policy identity to texture resource cache keys before changing
  wrap/clamp or `flipY`.
- Split material groups by sampler policy when preserving one group would mix
  clamped and repeated legacy polygons.
- Preserve legacy polygon-side sampler flags from `CPolygon.stippling`; do not
  replace them with UV-range inference.
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
- Phase 2.5 should add material variant identity and group splitting before
  Phase 3 consumes stippling-derived sampler policy.
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
- Confirmed that sampler policy is one layer of material identity, not the only
  layer. Phase 1 made texture caches safe for different sampler states; later
  phases still need material-plan and geometry-group inputs to avoid mixing
  incompatible policies in one rendered group.
- Added tests for default policy values, policy application, policy identity,
  indexed texture policy use, and cache separation by sampling policy.

Verification refresh:

- `npm run test:ts` passes with 44 test files and 225 tests.
- `npm run check` passes with no Svelte or TypeScript diagnostics.
- `npm run lint:ts` passes.
- `npm run lint:dead` passes.
- No bridge phase is needed between Phase 1 and Phase 2. The sampler-policy
  resource seam is complete enough for setup appearance routing, and Phase 2
  should avoid expanding sampler behavior unless setup appearance routing
  reveals material-slot identity bugs.

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
- Legacy wrap selection is not implemented in Phase 1. The seam is in place;
  Phase 3 should consume the side-local wrap bit from polygon `stippling` and
  choose between clamp/repeat by supplying a different policy.
- Texture velocity remains separate from sampling policy. Future UV scrolling
  should update instance or material UV transform state, not the texture
  resource cache key.
- After validating the retail decompile, ACViewer's `HasWrappingUVs` path is
  explicitly not the source of truth for legacy `CSurface` sampler state.
  Phase 3 should preserve the polygon-side `CPolygon.stippling` wrap bits and
  use UV-range checks only as diagnostics or fallback metadata.

Cleanup targets from Phase 1:

- Keep policy converter helpers private unless another module truly needs Three
  constants directly.
- Once Phase 3 introduces polygon/geometry-derived policy selection, remove any
  temporary call-site assumptions that all static/interior materials use the
  cache default policy.
- Add terrain policy buckets or terrain-specific policy helpers in Phase 9
  instead of forcing terrain sampling through static/interior defaults.
- Keep the `WorldMaterialResourceCache.getDefaultTextureSamplingPolicy()` helper
  as a temporary bridge for tests and current default call sites. Future
  sampler-aware geometry/material grouping should pass the effective policy
  explicitly from prepared material/group metadata.

Legacy shims:

- Phase 1 intentionally preserves the legacy renderer's current all-clamped
  default policy. This is a compatibility shim, not a parity claim. The retail
  sampler rule is side-local and must be carried by Phase 3 before visible
  wrap/repeat behavior changes.
- The cache-level `MaterialTextureSamplingPolicy` override is useful for tests
  and early integration, but final static/interior material selection should
  derive policy from prepared geometry/material facts rather than broad cache
  construction options.

Refinements to future steps:

- Phase 2 can ignore sampler selection unless setup appearance routing exposes
  geometry or material slots that need a non-default policy.
- Phase 2.5 should add the material identity seam Phase 3 needs: variant-aware
  material slots, material cache signatures, and geometry group mapping that can
  distinguish one `CSurface` rendered with different sampler policies.
- Phase 3 should become the phase that carries polygon-side wrap/clamp metadata
  from decoded geometry into prepared render geometry/material groups and uses
  Phase 2.5's variant identity to choose sampler policy. Add
  `uvBounds`/`hasWrappingUvs` only as diagnostic/comparison metadata or as a
  fallback helper for fixtures that lack source polygon flags. Do not re-scan UV
  arrays independently in renderer, diagnostics, and cache logic.
- Phase 3 should select wrap/clamp from the preserved stippling-derived side
  flag by producing a per-material or per-geometry
  `MaterialTextureSamplingPolicy` before calling `resolveMaterialPlan()`.
- Phase 3 should split prepared geometry/material groups when material slot,
  palette view, texture swap, or sampler policy differs. Correctness wins over
  batch reuse until the material identity axes are proven stable.
- Phase 7 texture velocity should not modify `TextureSamplingPolicy`; it needs a
  separate instance/part UV-offset model.
- Add no new intermediate phase before Phase 2. If Phase 2 discovers that setup
  appearance material slots cannot be represented without sampler variants,
  fold only the identity plumbing into Phase 2.5 rather than pulling Phase 3
  behavior forward.

- Add `texture-sampling-policy` helpers for wrap/clamp, `flipY`, color-space,
  mipmap, and filter decisions.
- Thread the policy through direct-color, compressed, indexed, and future
  terrain texture resources.
- Include sampling policy identity in texture resource cache keys. Reusing a
  single Three.js `Texture` for both clamped and repeated geometry is incorrect
  because sampler state lives on the texture object.
- Do not solve the material-variation problem with a single broad cache key.
  Keep texture, palette, indexed-resource, final material, and instance-state
  identities layered so future palette views, texture swaps, clipmaps, scalar
  behavior, and texture velocity do not all fragment the same cache.
- Decide where legacy sampler policy lives. Prefer explicit side-local
  wrap/clamp metadata on prepared render geometry or material groups, derived
  from `CPolygon.stippling`. Keep a small `uvBounds`/`hasWrappingUvs` summary as
  diagnostic evidence and an ACViewer comparison aid.
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

Progress: implemented.

Implemented changes:

- `scene-asset-request-planner.ts` now derives
  `setup-appearance/{setupDid}` requests from visible `setup-model/{setupDid}`
  static source IDs. This keeps the contract shape unchanged and avoids adding
  a temporary `setupAppearanceAssetIds` dependency field to setup-model
  payloads.
- Scene request planning follows prepared setup-appearance parts when the
  appearance asset is ready, requesting appearance-selected `GfxObj`
  dependencies and material dependencies. While the appearance is missing,
  failed, or still pending, the planner continues requesting raw setup-model
  part `GfxObj` dependencies so fallback rendering remains available.
- `static-renderables.ts` now prefers prepared setup-appearance parts and
  material slots for setup-model statics. Raw setup-model part expansion remains
  the fallback.
- Added `createSetupAppearanceMaterialAppearanceContext()` in
  `material-appearance.ts` and exported `PreparedSetupAppearancePayload` so
  setup appearance identity is built in one place.
- Setup appearance parts use the payload `appearanceKey` as
  `materialAppearanceKey` and fill `selectedPartsSignature` from the resolved
  selected parts and material slots. `textureSwapSignature` and
  `paletteViewSignature` remain null until the later texture-swap and derived
  palette phases.
- Static setup appearance rendering continues to use setup-model placement
  frames and scale by `partIndex`. Placement and scale are not duplicated into
  setup-appearance payloads.
- `StaticRenderableSceneModel` now carries
  `missingSetupAppearanceAssetIds` so raw setup fallback is visible as an
  explicit diagnostic instead of silently looking identical to the intended
  path.
- Added tests proving:
  - visible setup models request their base setup-appearance assets;
  - prepared setup appearances request selected part `GfxObj` and material
    dependencies;
  - static renderables prefer setup appearance selected parts/material slots;
  - raw setup fallback records missing setup-appearance diagnostics.

Verification:

- `npm run test:ts` passes with 44 test files and 227 tests.
- `npm run check` passes with no Svelte or TypeScript diagnostics.
- `npm run lint:ts` passes.
- `npm run lint:dead` passes.
- Touched files pass Prettier checks. Repo-wide `npm run format:check` still
  fails on pre-existing unrelated format drift in other app files.

Decisions and course corrections:

- The scene planner, not the setup-model DTO, owns the base
  `setup-model/{setupDid}` to `setup-appearance/{setupDid}` bridge for now.
  This keeps host/content contracts narrower and avoids claiming
  setup-appearance is an intrinsic setup-model dependency before runtime
  `ObjDesc` variants exist.
- Once a setup-appearance payload is prepared, planner fallback stops requesting
  raw setup-model part `GfxObj` dependencies for that source. This prevents the
  old raw setup path from competing with the appearance-selected path after the
  intended data is available.
- Missing setup-appearance is diagnostic, not a hard render blocker. The
  renderer keeps using raw setup-model parts so visible statics do not disappear
  while appearance assets are loading or unavailable.
- `selectedPartsSignature` includes selected `GfxObj` and material-slot facts.
  `textureChanges`, `paletteId`, and `subPalettes` are preserved on the payload
  but not yet converted into cache-visible texture-swap or palette-view
  identity.
- No bridge phase is needed before Phase 2.5. The remaining work is material
  variant identity and grouping, not missing setup-appearance routing.

Cleanup targets from Phase 2:

- Completed pre-Phase 2.5 cleanup: extracted repeated static
  source/setup-appearance dependency expansion in
  `scene-asset-request-planner.ts` into a shared helper that returns geometry
  request IDs and material dependency input IDs. Phase 2.5 should extend that
  helper rather than reintroducing separate indoor/outdoor variant expansion.
- Rename older tests/comments that describe setup-model dependencies as only
  raw `gfxObjAssetIds`; visible setup models now also request derived base
  setup-appearance assets.
- Decide whether `missingSetupAppearanceAssetIds` should surface in user-facing
  debug UI or remain a render-model diagnostic only.
- Remove `materialAppearanceKey` after the remaining renderer grouping and
  diagnostics consume `MaterialAppearanceContext` directly.

Legacy shims:

- Raw setup-model part rendering remains as a compatibility fallback for
  missing, pending, failed, or mismatched setup-appearance assets.
- The base `setup-appearance/{setupDid}` route is a static snapshot bridge.
  Runtime/server `ObjDesc` variants and future `ClothingTable -> ObjDesc`
  generation should still produce setup-appearance-style resolved facts before
  reaching Three.js.
- `textureSwapSignature` and `paletteViewSignature` remain deliberately empty
  even when the setup-appearance payload preserves texture changes and
  subpalettes. Filling those signatures belongs to Phase 5 and Phase 4.

Refinements to future steps:

- Phase 2.5 should account for setup-appearance-selected material slots when it
  adds material variant signatures and geometry group mapping.
- Phase 3 sampler work should attach sampler variants to the material slots or
  geometry groups produced by either raw setup fallback or setup-appearance
  routing.
- Phase 4 derived palette views should reuse the setup appearance context
  builder and fill `paletteViewSignature` from `paletteId` plus subpalette
  replacement facts.
- Phase 5 texture-map changes should fill `textureSwapSignature` from the same
  setup-appearance payload instead of inventing another appearance identity
  path.

Expected effect: building/setup/static objects should stop rendering as
untextured placeholders when the material graph already has the correct resolved
slots.

### Phase 2.5: Material Variant And Grouping Prep

Goal: prepare material identity and geometry grouping for sampler-policy
variation before Phase 3 changes UV/sampler behavior.

Progress: implemented.

Implemented changes:

- Added `material-variants.ts` with a normalized immutable material variant
  signature helper. Empty or missing variant signatures normalize to `base`.
- Extended `ResolvedMaterialSlot` with optional `materialVariantSignature`.
  Existing raw/static/setup appearance slots remain `base` by default.
- Included material variant identity in material-plan signatures and final
  Three material cache keys. Two slots that share the same material recipe and
  appearance facts but differ by immutable variant signature now produce
  separate cached materials.
- Changed material slot deduping from `slotIndex` only to
  `slotIndex + materialVariantSignature`, so one setup/GfxObj surface slot can
  prepare separate clamp/repeat material entries.
- Extended `MaterialGeometrySlot` and geometry group lookup with optional
  `materialVariantSignature`. Grouping now resolves by
  `surfaceId + materialVariantSignature`, not just `surfaceId`.
- Added optional `materialVariantSignature` to prepared render triangle DTOs and
  app-local prepared render geometry types. Phase 3 later populated this field
  from polygon-side sampler metadata without another browser-app contract
  reshuffle.
- Kept the layered cache boundary intact: texture resources are still keyed by
  render surface plus sampling policy, palette resources are unchanged, and
  final materials are keyed by appearance plus material recipe plus variant
  signature.
- Added tests proving:
  - material cache keys differ by immutable variant signature;
  - material plans differ by variant signature;
  - duplicate slot indices survive when variants differ;
  - geometry grouping can split one `CSurface` into clamp/repeat material
    groups when triangle variant metadata is present.

Verification:

- `npm run test:ts` passes with 44 test files and 231 tests.
- `npm run check` passes with no Svelte or TypeScript diagnostics.
- `npm run lint:ts` passes.
- `npm run lint:dead` passes.
- Touched files pass Prettier checks.

Decisions and course corrections:

- Variant signatures are intentionally plain stable strings for now. The first
  concrete axis should be sampler policy in Phase 3, for example a signature
  derived from the effective wrap/clamp policy. Future palette view, texture
  swap, clipmap/scalar behavior, or other immutable material recipe choices can
  join this identity without changing cache or geometry APIs again.
- Phase 2.5 did not change visible sampler behavior on its own. Phase 3 now
  emits real sampler variants from content and uses this identity seam for
  clamp/repeat texture policy selection.
- The optional browser triangle `materialVariantSignature` field remains an app
  compatibility shim. Rust/content now emits explicit side-local sampler
  metadata, while missing browser values still mean `base`.
- Per-instance and time-varying state remains outside shared material cache
  keys. Texture velocity must still be represented as instance/part UV state,
  not as a material variant.
- No immediate interim phase was needed before Phase 3. The material identity
  and geometry grouping seam was sufficient for stippling-derived sampler
  metadata from content.

Cleanup targets from Phase 2.5:

- Phase 3 replaced the contract shim in new Rust payloads with real emitted
  `materialVariantSignature` values from decoded polygon-side sampler metadata.
- Consider replacing free-form variant strings with a tiny typed builder if
  more Rust/TS producers need to share them. Do not add broad variant enums
  before another concrete axis settles.
- Keep watch on `ResolvedMaterialSlot`: once palette view and texture swap
  signatures are filled, this type may deserve a focused material-identity
  helper rather than more inline string assembly in callers.
- If Phase 3 needs both diagnostic `uvBounds` and production sampler variants,
  keep the diagnostic UV summary out of final material cache keys unless it
  affects immutable render behavior.

Legacy shims:

- `base` is the compatibility variant for all existing material slots and
  triangles.
- Prepared render triangle `materialVariantSignature` remains optional in the
  browser DTO for older/degraded payloads. Missing values must mean `base`, not
  "unknown".
- Final materials are now separated by variant identity and `sampler=repeat`
  changes actual texture wrap state.

Refinements to future steps:

- Phase 3 derived sampler variant signatures from the retail side-local
  `CPolygon.stippling` wrap bit and attached them to prepared render triangles
  before `resolveMaterialPlan()`.
- Phase 3 uses the Phase 1 `TextureSamplingPolicy` path to create the actual
  clamp/repeat texture policy that corresponds to the material variant
  signature. Keep the signature and policy in sync if this axis expands.
- Phase 4 should add palette-view identity as another immutable material
  variant or appearance signature axis only after derived palette resources are
  implemented.
- Phase 5 should decide whether texture swaps alter the appearance signature,
  material variant signature, or both. The current expectation is that resolved
  appearance texture-swap identity belongs in `MaterialAppearanceContext`, while
  immutable per-slot render behavior stays in material variants.

Expected effect: Phase 3 can add stippling-derived sampler metadata and
wrap/clamp policy without also redesigning cache and geometry-group identity.

### Phase 3: UV And Sampler Parity Validation

Goal: prove whether interior texture orientation/tiling bugs come from decoded
UVs, sampler state, or material upload. The primary validation path should be
programmatic; manual visual inspection is only a final smoke check after the
data and renderer-state comparisons are explainable.

Progress: implemented.

Implemented changes:

- `holtburger-content` now derives a sampler material variant for each prepared
  polygon render side from retail `CPolygon.stippling` bits:
  - positive-side polygons use `sampler=repeat` when bit `0x1` is set;
  - negative-side polygons use `sampler=repeat` when bit `0x2` is set;
  - otherwise the emitted variant is `sampler=clamp`.
- Prepared render triangles now carry a non-optional
  `material_variant_signature` in Rust payloads. The browser DTO remains
  optional for compatibility with older/degraded payloads, where missing still
  means `base`.
- JSON and binary Tauri adapters include the material variant in prepared
  render geometry. The binary triangle section is now four `i32` components:
  `polygonId`, `surfaceId`, encoded material variant, and `firstVertex`.
- `static-renderables.ts` derives duplicate material slots from
  `GfxObj.renderGeometry.triangles` when a single surface slot appears with
  multiple sampler variants. This applies to raw `GfxObj`, raw setup fallback,
  and setup-appearance-selected parts.
- `material-construction.ts` parses `sampler=clamp` and `sampler=repeat`
  material variants and applies the corresponding wrap mode to direct-color,
  compressed, and indexed texture policy selection. Texture resources remain
  cached by render-surface decode identity plus effective sampling policy.
- Added `report_polygon_sampler_parity` in `holtburger-debug-harness`. It emits
  deterministic per-env-cell rows covering polygon ID, side, raw `stippling`,
  derived repeat flag, surface slot/material ID, render surface IDs, vertex
  IDs, UV indices/values, ACViewer-style UV range wrapping signal, emitted
  material variant, and prepared triangle first-vertex offsets.
- Added tests for:
  - Rust stippling-derived sampler variants, including one `CSurface` used as
    both repeat and clamp;
  - binary triangle hydration with material variant codes;
  - renderer material slots duplicated by emitted sampler variants;
  - final texture wrap policy selection from `sampler=repeat`.

Validation:

- `cargo run -p holtburger-debug-harness --bin report_polygon_sampler_parity
  -- --env-cell da55010b` produced a deterministic report from repo-local
  `dats/assets.hba`. The sample shows `stippling=0x01` polygons emitted as
  `sampler=repeat` with ACViewer-style wrapping UVs, and `stippling=0x00`
  polygons emitted as `sampler=clamp`.
- `cargo test -p holtburger-content
  landblock_scene_assets::tests::polygon_render_geometry` passes.
- `cargo check -p holtburger-content -p holtburger-debug-harness` passes.
- `npm run test:ts` passes with 44 test files and 233 tests.
- `npm run check` passes with no Svelte or TypeScript diagnostics.
- `npm run lint:ts` passes.
- `npm run lint:dead` passes.
- Touched TypeScript files were formatted. Repo-wide `npm run format:check`
  still fails only on pre-existing unrelated format drift in nine app files.

Decisions and course corrections:

- The production sampler source of truth is the preserved retail side-local
  `stippling` bit, not UV range scanning. The harness reports an
  ACViewer-style UV wrapping signal only as comparison evidence.
- `sampler=clamp` and `sampler=repeat` are the concrete Phase 3 material
  variant strings. They are intentionally kept narrow and parsed in one
  renderer helper rather than generalized into a broad material-variant enum.
- The binary prepared-geometry triangle section changed shape from three to
  four `i32` components. This is an internal app/host envelope format, and the
  JSON/DTO shape remains self-describing.
- Missing or unknown material variant signatures still normalize to `base` for
  old payload compatibility. New Rust-prepared polygon geometry emits explicit
  sampler variants for renderable sides.
- The Phase 3 harness proves Holtburger's emitted data and derived sampler
  state. It is not a full ACViewer automated diff yet because ACViewer does
  not expose a ready machine-readable report in this repo. Use the harness rows
  as the stable Holtburger side before adding any ACViewer instrumentation.

Cleanup targets from Phase 3:

- Consider moving the shared sampler variant strings into a tiny cross-boundary
  contract helper if more Rust/TS producers need to emit or consume them. Do
  not widen this until a second concrete variant axis exists.
- If binary envelope compatibility becomes important across app versions, add a
  manifest/schema version before changing any other binary section component
  layout.
- Keep `WorldMaterialResourceCache.getDefaultTextureSamplingPolicy()` as a test
  bridge only. Production sampler-aware paths now pass through material
  variants and should not reintroduce broad all-clamped assumptions.
- Add optional ACViewer-side diagnostic output only if the current harness
  uncovers mismatches that cannot be explained from retail/decompile evidence.

Legacy shims:

- Browser prepared triangle DTOs still accept missing
  `materialVariantSignature`; missing means `base`.
- Unknown binary material variant codes decode to `null`, preserving the same
  base fallback instead of failing old cached/enveloped payloads.
- Raw setup-model fallback remains, but it now receives sampler variants from
  the selected part `GfxObj` geometry just like setup-appearance parts.

Refinements to future steps:

- Phase 4 derived palette views can proceed without an interim bridge phase.
  The sampler/material variant path is now complete enough and does not block
  palette-view identity.
- Phase 4 should avoid placing palette-view identity in
  `materialVariantSignature` unless the palette view is truly per-slot immutable
  behavior. The current expectation remains: palette view belongs in
  `MaterialAppearanceContext.paletteViewSignature`, while sampler behavior
  remains a material variant.
- Phase 5 texture swaps should follow the same pattern: resolved appearance
  identity in `MaterialAppearanceContext`, with material variants reserved for
  immutable per-slot render behavior.
- Manual screenshots should now focus on V-axis/`flipY` confirmation and
  visible clamp/repeat seams, not on proving the sampler rule from scratch.

Expected effect: interior textures should become visible and consistently tiled
or clamped before deeper material work.

### Phase 4: Derived Palette Views

Goal: compose per-appearance palette textures for indexed materials.

Progress: implemented.

Implemented changes:

- Extended renderer-local `MaterialAppearanceContext` with a typed
  `paletteView` carrying the resolved appearance `paletteId` override and
  sorted `subPalettes`.
- `createSetupAppearanceMaterialAppearanceContext()` now fills
  `paletteViewSignature` and `paletteView` from prepared
  `setup-appearance/{setup_did}` payloads. Base appearances still normalize to
  `palette=base`.
- Added `derived-palette-resources.ts` for renderer-local palette composition.
  It copies the selected base palette, applies each subpalette replacement
  range, uploads the composed palette through the existing palette texture
  helper, and caches by base palette prepared state plus subpalette prepared
  state.
- Indexed material construction now applies an appearance `paletteId` as the
  effective base palette override before falling back to the `CSurface`
  palette or render-surface default palette.
- Indexed materials with subpalette replacements now bind the derived palette
  resource rather than the base palette resource.
- Subpalette composition follows ACViewer and retail `Palette::Modify`
  behavior: the destination range is replaced with the same offset range from
  the referenced palette, not colors starting at index zero.
- Material cache keys now include appearance palette asset prepared state, so a
  refreshed appearance override or subpalette invalidates the final Three
  material instead of reusing a stale shader uniform.
- Added diagnostics for unprepared subpalettes, invalid subpalette ranges,
  derived/base palette kind mismatches, and post-derivation indexed palette
  range failures.
- Added tests for subpalette composition, appearance palette override
  selection, and final material refresh when appearance palette assets change.

Verification:

- `npm run test:ts` passes with 45 test files and 238 tests.
- `npm run check` passes with no Svelte or TypeScript diagnostics.
- `npm run lint:ts` passes.
- `npm run lint:dead` passes.
- Touched TypeScript files pass targeted Prettier checks.

Decisions and course corrections:

- The Phase 4 plan said the palette-view signature should include the base
  palette asset ID. That base palette is not known when the source-agnostic
  appearance context is created; it depends on the indexed material recipe and
  render surface selected later. The implemented split is:
  `MaterialAppearanceContext.paletteViewSignature` records only resolved
  appearance facts, while `DerivedPaletteResource` keys include the
  material-selected base palette asset ID and prepared state.
- Palette-view identity remains in `MaterialAppearanceContext`, not
  `materialVariantSignature`. Sampler policy is per-slot immutable render
  behavior; palette view is per-appearance indexed color state.
- Direct appearance palette overrides without subpalettes reuse the ordinary
  base palette resource. A derived palette resource is only created when at
  least one subpalette replacement is present.
- Missing or invalid derived palette inputs produce diagnostics and fall back to
  placeholder material behavior. They do not silently bind the wrong base
  palette.

Cleanup targets from Phase 4:

- `material-construction.ts` now has repeated "effective palette ID/source"
  ternaries. If Phase 5 expands indexed material selection further, extract an
  `IndexedPaletteViewSelection` helper rather than growing the function body.
- `material-signatures.ts` duplicates a small `formatPaletteAssetId()` helper.
  Consolidate formatting helpers once the remaining material-signature shim
  cleanup happens; avoid moving renderer-only derived palette policy into shared
  host contracts.
- `WorldMaterialResourceCache.getDerivedPaletteResource()` is public mostly for
  focused tests. If no production-adjacent diagnostics need direct access after
  Phase 5, hide it behind material construction again or move tests down to the
  derived-palette module.
- Add dedicated derived-palette tests for missing subpalette and invalid range
  diagnostics if Phase 5 starts feeding runtime data from less controlled
  sources.

Legacy shims:

- Base setup appearances still usually carry no `paletteId` or subpalettes
  because runtime/server `ObjDesc` variants are not yet routed into prepared
  setup appearances. Phase 4 makes the renderer path correct when those facts
  exist; Phase 5 must make the asset/request path produce them for live
  objects.
- Existing non-indexed material paths ignore `paletteView`, as expected. Direct
  color and compressed textures remain unaffected until texture-map changes
  start selecting different render textures.

Refinements to future steps:

- Phase 5 should prioritize the bridge from runtime/server `ObjDesc` data into
  distinct prepared setup-appearance requests. Without that, derived palette
  support is mostly latent for base static snapshots.
- Phase 5 texture swap identity should follow the same two-layer pattern:
  appearance-level texture swap facts in `MaterialAppearanceContext`, with
  material-selected render-surface/resource prepared state in cache keys.
- No immediate interim phase is required before Phase 5. The palette-view
  renderer path is in place, but Phase 5 should include a small cleanup task to
  extract effective indexed palette selection if texture-swap handling touches
  `resolveIndexedMaterialResources()`.

Expected effect: indexed clothing, skin, hair, and dyed/static appearance paths
can use the same indexed render surfaces with different palette views.

### Phase 5: Texture Swap And Appearance Parity

Goal: ensure `ObjDesc.texture_changes` and `anim_part_changes` affect static and
runtime renderables consistently.

Progress: implemented.

Implemented changes:

- Changed `ContentAssetRequest::SetupAppearance` from a setup-model ID only to
  a typed `SetupAppearanceRequest { setup_model_id, appearance }`. The
  appearance input is the existing `MaterialAppearanceInput`, so content keeps
  owning `ObjDesc + Setup -> ResolvedSetupAppearance`.
- Added deterministic app/host asset IDs for runtime appearance variants:
  `setup-appearance/{setupDid}/obj-desc/...`. Supported segments are:
  - `pal-{paletteId8}`
  - `sub-{subPaletteId8}-{offsetHex}-{numColorsHex}`
  - `tex-{partIndexHex}-{oldTextureId8}-{newTextureId8}`
  - `anim-{partIndexHex}-{partId8}`
- Kept `setup-appearance/{setupDid}` as the base appearance route and mapped it
  to `MaterialAppearanceInput::default()`.
- The Tauri adapter parses variant IDs into `ObjDesc` and rejects wrong DID
  classes: setup IDs must be `0x02`, palette IDs `0x04`, texture IDs `0x05`,
  and animation part model IDs `0x01`.
- The asset worker now recognizes setup-appearance variant IDs as ordinary
  route-matched setup appearance payloads.
- Scene request planning treats explicit setup-appearance variant source IDs as
  renderable sources. Once the variant payload is prepared, the planner requests
  its selected part `GfxObj` dependencies and material dependencies.
- Hydration policy now classifies setup-appearance variants as direct static
  renderable roots. This keeps the streaming sync key sensitive to prepared
  variant payloads, so follow-up selected-part requests are not stranded behind
  an unchanged scene-interest key.
- `createSetupAppearanceMaterialAppearanceContext()` now fills
  `textureSwapSignature` from prepared `textureChanges`; final material cache
  keys already include that appearance signature.
- Added `Hash` derives for `ObjDesc`, its component records, and
  `MaterialAppearanceInput` so setup-appearance variant requests can safely
  participate in the existing shared content asset runtime cache.
- Added focused Rust and TypeScript tests for variant ID parsing, host lookup
  routing, direct renderable hydration, scene dependency planning, and texture
  swap signatures on static renderables.
- Cleaned up an unrelated clippy failure in
  `landblock_scene_assets.rs` by grouping polygon render output buffers into a
  helper struct. This was needed to keep `cargo clippy -D warnings` green after
  the toolchain flagged the existing helper as too argument-heavy.

Post-implementation course correction:

- Treat the `setup-appearance/{setupDid}/obj-desc/...` route as rejected debt,
  not a bridge to keep. `ObjDesc` is override state, not a true source asset.
  Encoding every override as a normal app asset route risks unbounded prepared
  asset cardinality once live runtime objects start producing unique
  appearances.
- Keep the proven content resolver contract (`Setup + MaterialAppearanceInput
  -> ResolvedSetupAppearance`) and the renderer appearance signatures. Replace
  the app-local obj-desc asset route with a layered derived appearance cache in
  Phase 5.5 before Phase 6 grows more producers.

Verification:

- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml` passes
  with 16 tests.
- `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml
  --all-targets -- -D warnings` passes.
- `npm run test:ts` passes with 45 test files and 240 tests.
- `npm run check` passes with no Svelte or TypeScript diagnostics.
- `npm run lint:ts` passes.
- `npm run lint:dead` passes.
- `git diff --check` passes.
- `npm run format:check` still fails on pre-existing unrelated formatting
  drift in ten app files. Touched TypeScript files were formatted with the app
  Prettier install.

Decisions and course corrections:

- The canonical content identity is `Setup + normalized ObjDesc`, not a string
  asset ID. Phase 5 proved the resolver can carry those facts, but Phase 5.5
  must remove the asset-route representation for override variants.
- The variant ID parser intentionally preserved legacy DID classes and raw
  change facts, which made the proof debuggable. That benefit does not justify
  keeping ObjDesc variants in the ordinary prepared-asset namespace.
- Texture swap identity belongs in `MaterialAppearanceContext`, alongside
  selected part and palette-view identity. It does not belong in
  `materialVariantSignature`, which remains reserved for immutable per-slot
  render behavior such as sampler policy.
- The current route is a proof artifact, not a clothing-system implementation.
  `ClothingTable` should later produce the same `ObjDesc` input and feed a
  layered appearance resolver/cache, not asset-route strings.
- Add an immediate Phase 5.5 before Phase 6. Without it, Phase 6 would risk
  baking the wrong cache ownership model into clothing-generated appearances.

Cleanup targets from Phase 5:

- Remove app/host support for `setup-appearance/{setupDid}/obj-desc/...` in
  Phase 5.5. Do not add a formatter for that route.
- Preserve tests that prove `Setup + ObjDesc` resolution, but move app tests
  away from route-shaped ObjDesc variants.
- Prove and document normalized ObjDesc key semantics, especially duplicate
  texture-change records for the same part/old texture, before using the key in
  a layered cache.
- Consolidate material/palette asset ID formatting helpers once Phase 6 starts
  emitting clothing-generated appearance requests.
- Keep the clippy cleanup in `landblock_scene_assets.rs` as a small quality
  correction; it introduced no legacy shim and should not affect Phase 6.

Legacy shims:

- Raw setup-model part rendering remains the fallback for base setup sources
  while the corresponding setup-appearance payload is missing, pending, or
  failed.
- `setup-appearance/{setupDid}` remains a compatibility base route for DAT
  static snapshots with no runtime `ObjDesc`.
- Browser DTOs still accept older setup-appearance payloads with empty
  `textureChanges`, `paletteId`, or `subPalettes`; empty facts normalize to
  `textures=base` and `palette=base`.
- App-local setup-appearance variant IDs are temporary debt and should not gain
  new producers.

Refinements to future steps:

- Phase 5.5 must replace ObjDesc variant asset routes with a layered derived
  appearance cache before Phase 6 starts producing clothing-generated
  appearances.
- Phase 6 should focus on `ClothingTable -> ObjDesc` generation in
  `holtburger-content`, then feed the Phase 5.5 derived appearance resolver.
  Do not introduce renderer-local clothing state or route-shaped ObjDesc
  assets.
- Texture animation remains distinct from texture swaps. A later animation
  phase should drive per-instance/per-part UV offsets and should not mutate
  setup-appearance asset identity unless the selected part or texture map facts
  actually change.
- Modern material DATs remain explicitly deferred; this phase only completed
  legacy setup appearance parity.

Expected effect: appearance changes should select the right mesh parts,
textures, and palettes without mutating base DAT material definitions.

### Phase 5.5: Layered Runtime Appearance Cache

Goal: remove `ObjDesc` variants from the ordinary app asset namespace and cache
resolved appearance overlays as bounded derived state instead.

Progress: implemented.

Rationale:

- `ObjDesc` is override/input state, not a true asset. Treating every unique
  override as `setup-appearance/{setupDid}/obj-desc/...` makes runtime
  appearance cardinality look like source asset cardinality, which is wrong for
  live players, equipment, corpses, and other high-churn objects.
- We do not need a full visible-object render model to fix the ownership
  boundary. A layered derived cache with passive eviction mitigates unbounded
  growth now and can later be connected to explicit object visibility/lifetime
  ownership.

Implementation targets:

- Removed app/host parsing and worker/planner treatment for
  `setup-appearance/{setupDid}/obj-desc/...`.
- Kept `setup-appearance/{setupDid}` only as the base DAT/static setup
  appearance asset route.
- Removed production `dependency-manifest` support from the frontend asset
  contracts, worker preparation path, prepared payload union, and dependency
  extraction. It is a synthetic graph-test helper, not a meaningful runtime
  asset. Tests now use production-shaped setup-model payloads instead of a
  production dependency-manifest type.
- Added a derived runtime appearance resolver/memo keyed structurally by
  `(setupDid, normalized ObjDesc)`, not by string asset ID.
- The memo value should be the small resolved appearance facts needed by the
  renderer and dependency planner:
  selected part `GfxObj` asset IDs, material asset IDs, palette asset IDs,
  texture changes, anim-part changes, palette view facts, and appearance
  signatures. The first implementation exposes this as
  `RuntimeAppearanceResolvedFacts`.
- Kept true assets in the existing prepared asset cache: setup models, gfx
  objs, material recipes, render textures, render surfaces, and palettes.
- Implemented passive bounded eviction with max entries plus LRU. Max age is
  deferred until real runtime-object usage proves it is needed.
- Added diagnostics for derived appearance memo size, hits, misses, evictions,
  in-flight requests, and distinct normalized ObjDesc keys.
- Preserved Rust/content resolver support for `Setup + ObjDesc`; app tests now
  exercise the derived memo instead of route-shaped prepared assets.

Verification:

- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml` passes
  with 13 tests.
- `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml
  --all-targets -- -D warnings` passes.
- `npm run test:ts` passes with 46 test files and 242 tests.
- `npm run check` passes with no Svelte or TypeScript diagnostics.
- `npm run lint:ts` passes.
- `npm run lint:dead` passes.
- `git diff --check` passes.

Course corrections:

- The derived cache is currently an API plus tests, not wired into live object
  rendering. This is intentional: no runtime object render model exists yet,
  and Phase 5.5 only needed to remove the fake asset ownership model before
  Phase 6 introduces new ObjDesc producers.
- The normalized ObjDesc key currently preserves array order, matching the
  existing content appearance key behavior. Retail unpack deduplicates texture
  and animation changes before they reach this layer; future non-DAT producers
  should normalize to the same semantics before cache lookup.
- In-flight dedupe is included in the derived cache so concurrent identical
  runtime appearance requests do not stampede the resolver.

Decisions:

- Do not introduce reference counting in this phase. Passive LRU is enough
  until a runtime-object render model exists.
- Do not add a shared formatter for obj-desc setup-appearance asset IDs. That
  route should disappear rather than become easier to produce.
- Do not retain `dependency-manifest` for tests. Tests are low-priority
  consumers and should adapt to production shapes.
- Do not move clothing-specific concepts into the renderer. The derived memo
  consumes normalized ObjDesc inputs regardless of whether they came from the
  server, clothing tables, or tests.

Cleanup targets from Phase 5.5:

- Wire `RuntimeAppearanceCache` into the first real runtime-object or clothing
  producer instead of creating another asset route.
- Add max-age or memory-pressure eviction only after runtime diagnostics show
  max-entry LRU is insufficient.
- Consider moving the normalized ObjDesc key builder beside the Rust
  `build_setup_appearance_key` logic if Phase 6 needs cross-language parity
  tests for clothing-generated appearances.

Legacy shims:

- Base `setup-appearance/{setupDid}` remains as the static DAT setup snapshot
  asset route.
- Raw setup-model part rendering remains the fallback while base setup
  appearance assets are unavailable.
- No `dependency-manifest` production shim remains.

Refinements to future steps:

- Phase 5.75 should wire the derived runtime appearance cache into a local
  browser runtime appearance before clothing generation adds more producers.
- Phase 6 should feed clothing-generated ObjDesc values into the derived
  runtime appearance cache API, not the prepared asset graph.
- Phase 6 should add fixture coverage proving clothing-generated ObjDesc
  normalization matches direct/server ObjDesc normalization before cache lookup.
- A later runtime object phase should decide how visible object state supplies
  active appearance inputs; do not add reference counting before that ownership
  boundary exists.

Expected effect: runtime and clothing-generated appearances can reuse resolved
appearance facts without polluting the true asset cache or requiring immediate
object-level lifetime ownership.

### Phase 5.75: Browser Appearance Preview Harness

Goal: give browser mode a local visual verification path for `Setup + ObjDesc`
appearance overrides before clothing-table generation expands the input space.

Rationale:

- Tests and payload diagnostics can prove texture swaps and palette facts, but
  they do not prove the rendered result is visually correct. Phase 4/5 palette
  and texture-swap work needs a fast, local visual loop.
- A full entity spawner would imply server/world object lifecycle, collision,
  replication, and authoritative placement. That is out of scope here. This
  phase should create a local preview object only.

Implementation targets:

- Add a browser-mode debug panel for a runtime appearance with:
  - required `setupDid`;
  - optional base palette ID;
  - editable subpalette rows;
  - editable texture-swap rows;
  - editable animation-part swap rows.
- Derive the preview appearance through `RuntimeAppearanceCache`, then hydrate
  any referenced true DAT assets through the existing asset loading path. Do not
  encode ObjDesc overrides as `setup-appearance/.../obj-desc/...` asset IDs.
- Render each preview as an app-local object spawned once 1 meter in front of
  the active browser camera. Do not keep previews camera-sticky after spawn, do
  not mutate world state, and do not send server spawn requests.
- Request true asset dependencies through the existing asset hydration path so
  assets can be loaded from DAT when they are not already resident: selected
  `GfxObj`, material recipes, render textures, render surfaces, and palettes.
  The prepared asset cache should be the resident reuse layer after hydration,
  not a requirement that the asset was already loaded before preview.
- Show compact diagnostics for the resolved appearance: selected part IDs,
  material asset IDs, palette asset IDs, texture-swap signature, palette-view
  signature, cache hit/miss/eviction counts, and missing dependencies.
- Do not add WCID/weenie lookup. WCIDs require an ACE/world-content projection
  layer, while this phase should stay limited to DAT render inputs.

Implementation decisions:

- This is a runtime appearance, not an entity spawner.
- The canonical preview input is `setupDid + ObjDesc facts`.
- Do not introduce route-shaped ObjDesc assets for preview convenience.

Expected effect: palette overrides, subpalette ranges, texture swaps, and
animation-part swaps can be visually inspected before clothing-generated
appearances depend on the same path.

Progress: implemented.

Implementation notes:

- Added a Tauri `resolve_runtime_appearance` command that accepts
  `setupModelId + ObjDesc` facts and resolves them through the content runtime.
  This is intentionally not an asset lookup route and does not create
  `setup-appearance/.../obj-desc/...` asset IDs.
- Browser debug mode now includes a runtime appearance form with setup DID,
  optional base palette, subpalette rows, texture-swap rows, and animation-part
  rows.
- The frontend derives runtime appearance payloads through
  `RuntimeAppearanceCache`, then
  reports the resulting true dependency asset IDs to the scene asset streamer.
  The streamer hydrates missing setup-model, selected gfx, material, and palette
  assets through the normal asset loading path.
- The world display can merge multiple resolved previews into the
  static-renderable scene as app-local objects. Each submit creates a distinct
  preview instance with a captured spawn camera frame, so repeated submits of
  the same `setupDid + ObjDesc` reuse the resolved appearance cache but still
  create separate preview placements.
- Preview diagnostics currently show cache counts, appearance key, selected
  part count, requested material/palette counts, texture-swap signature, and
  palette-view signature.

Implementation decisions:

- Keep the runtime appearance resolver as a typed command boundary instead of
  overloading the asset ID namespace. The command returns a setup-appearance
  payload, while true DAT assets still flow through the existing asset
  streamer/cache.
- Keep WCID/weenie lookup out of the preview. The preview input remains
  `setupDid + ObjDesc` facts.
- Reuse the static-renderable renderer path instead of adding a one-off Three.js
  preview scene. This exercises the same material, palette, geometry, and render
  style code that visible world objects use.

Course corrections:

- The preview depends on the content runtime to apply texture swaps and
  animation-part changes. The frontend does not try to duplicate
  `ResolvedSetupAppearance` generation logic.
- Active previews are retained through scene-streamer interest rather than by
  pinning prepared assets manually. This keeps the resident cache as a reuse
  layer after hydration.
- Camera movement should not re-run browser scene-resource derivation. Preview
  placement captures the camera frame once at spawn time; subsequent movement
  updates only the renderer camera and throttled camera hint path.

Cleanup targets:

- The debug panel now has enough dense controls that it should eventually split
  appearance-preview editing into a focused child component.
- Preview dependency diagnostics should distinguish "requested", "prepared",
  and "missing/error" asset states instead of only showing requested counts.

Legacy shims:

- None introduced. The rejected ObjDesc asset-route path remains absent.

Refinements to future steps:

- Phase 6 can reuse the runtime appearance command/cache flow for visual
  verification of clothing-generated ObjDesc values before wiring clothing into
  live object rendering.
- If preview UX grows beyond manual `setupDid + ObjDesc` entry, add direct
  DAT/content selectors only; do not add ACE SQL/WCID lookup inside this plan.

Verification:

- `npm run check` passes.
- `npm run test:ts` passes: 46 files, 242 tests.
- `npm run lint:ts` passes.
- `npm run lint:dead` passes.
- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml` passes:
  14 tests.
- `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml
  --all-targets -- -D warnings` passes.
- `git diff --check` passes.

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

Status: **implemented**.

Progress:

- Added typed `holtburger-dat` parsers for `PaletteSet`, `ClothingTable`,
  `ClothingBase`, `CloObjectEffect`, `CloTextureEffect`,
  `CloPaletteTemplate`, `CloSubpalEffect`, and `CloSubpaletteRange`.
- Added `ClothingTable::build_obj_desc`, which emits normal `ObjDesc` state:
  animation-part changes, texture changes, and subpalette changes. It uses the
  existing retail replacement/cap behavior for texture and animation changes
  and adds the retail subpalette replace/supercede behavior for constructed
  clothing output.
- Added `PaletteSet::palette_id_for_shade` with the retail
  `(count - 0.000001) * shade` selection formula.
- Added `ContentRepository::build_clothing_obj_desc(...)`, which reads the
  clothing table and required palette sets from mounted content and returns the
  derived `ObjDesc` without creating a route-shaped asset ID.
- Added `DatFileType::PaletteSet` and included palette-set availability in the
  material capability report because clothing table subpalette effects depend
  on palette-set records, not only raw palette records.
- Added tests proving:
  - palette-set shade selection keeps the retail epsilon;
  - clothing table parsing/building emits part, texture, and palette effects;
  - a clothing-generated `ObjDesc` resolves to the same setup appearance,
    texture swaps, subpalette dependencies, and appearance key as the equivalent
    direct `ObjDesc` input.

Decisions:

- Clothing remains a content/DAT concern. The renderer still only consumes the
  existing setup appearance payloads, palette dependencies, texture swaps, and
  material signatures.
- The new content API returns derived override state, not a cached true asset.
  This keeps Phase 5.5's layered runtime appearance cache decision intact.
- The implementation supports the retail constructor shape where one shade is
  replicated across the four-slot `ShadePackage`. A future caller that proves
  distinct per-slot shades are needed should extend the API explicitly rather
  than smuggling a renderer-side clothing concept into the path.
- Retail setup fallback mappings from `ClothingTable::BuildObjDesc` are encoded
  for the known Umbraen, Penumbraen, Undead, and Anakshay setup aliases found in
  the client decompile. Missing clothing bases fail loudly after applying that
  mapping.

Course corrections:

- `PaletteSet` had not been modeled as its own DAT type even though clothing
  palette effects require it. This pass added the type instead of treating
  palette-set IDs as ordinary palette IDs.
- Capability diagnostics previously considered clothing tables and palettes but
  not palette sets. That would have made clothing capability reporting too
  optimistic for archives with clothing tables but pruned `0x0F` palette sets.

Cleanup targets:

- Consider exposing a small content-facing clothing preview DTO only when the
  browser UX needs direct clothing-table selection. Do not add WCID/ACE SQL
  lookup to this plan.
- If character creation or live equipment layering starts combining multiple
  `ObjDesc` producers in Rust, add an explicit `ObjDesc` merge helper with the
  same retail `ObjDesc::operator+=` semantics instead of open-coding repeated
  add/dedup loops.

Legacy shims:

- None introduced. Clothing output feeds the normal `Setup + ObjDesc` resolver
  and does not revive `setup-appearance/.../obj-desc/...` asset IDs.

Refinements to future steps:

- Phase 7 texture velocity should remain independent of clothing generation.
  Clothing can produce texture/part overrides; texture velocity is runtime UV
  state and should not be folded into the clothing table model.
- The future runtime entity projection followup should use
  `ContentRepository::build_clothing_obj_desc(...)` as one producer of entity
  appearance override state, alongside server-supplied `ObjDesc` values.

Verification:

- `cargo test --manifest-path crates/holtburger-dat/Cargo.toml material`
  passes: 12 tests.
- `cargo test --manifest-path crates/holtburger-content/Cargo.toml
  clothing_generated_obj_desc_matches_direct_setup_appearance_input` passes.
- `cargo test --manifest-path crates/holtburger-content/Cargo.toml` passes:
  40 tests.
- `cargo clippy --manifest-path crates/holtburger-dat/Cargo.toml
  --all-targets -- -D warnings` passes.
- `cargo clippy --manifest-path crates/holtburger-content/Cargo.toml
  --all-targets -- -D warnings` passes.

### Phase 7: Classic Texture Velocity Animation

Status: **implemented**.

Goal: add the classic hook-driven UV-scrolling path without pulling in the
newer waveform/layer material animation system.

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

Progress:

- Replaced opaque DAT preservation for hook types `23` and `24` with typed
  `TextureVelocity` and `TextureVelocityPart` payloads in the setup-model hook
  parser. Other hook payloads remain raw unless they already need typed runtime
  behavior.
- Exposed resolved setup-placement texture velocity hooks in the setup-model
  frontend payload as `textureVelocities`, with either `all-parts` or
  part-specific scope.
- Threaded setup placement texture velocity into static renderable part state.
  Part-specific hooks override prior all-part hooks for that part, matching the
  retail call path where a later hook updates the affected part/GfxObj velocity.
- Added texture-velocity signatures to static renderable render-group keys.
  Zero velocity normalizes to `uv:none` so inert hooks do not fragment batches.
- Added renderer-local UV scrolling by cloning the affected render-group
  materials, patching the map UV in shader state, and updating a per-material
  offset uniform each frame. Shared `GfxObj` geometry and shared material-cache
  materials are not mutated.
- Added DAT hook parsing tests and frontend render-group/signature tests.

Decisions:

- Texture velocity remains a classic setup/animation hook path that is actively
  supported content behavior. It is not part of newer material DAT handling and
  does not alter `TextureSamplingPolicy`, material recipe identity, palette
  state, or geometry UV buffers.
- The browser renderer treats velocity as render-group state rather than
  per-source asset state. This keeps normal material cache keys stable while
  still allowing animated and non-animated instances of the same material to
  coexist.
- Animated groups use cloned Three materials and are disposed with the mesh.
  Non-animated groups continue to use resource-cache-owned materials.
- The first implemented frontend source is setup placement hooks because that is
  where browser-mode static renderables currently resolve setup placements.
  Future runtime animation playback should feed the same part-level velocity
  state rather than creating a second material-animation system.

Course corrections:

- Retail and ACE references show `TextureVelocityHook` as `(u_speed, v_speed)`
  and `TextureVelocityPartHook` as `(part_index, u_speed, v_speed)`. Retail
  applies them through `CPhysicsObj::SetTextureVelocity` /
  `SetPartTextureVelocity`, which ultimately records velocity against the
  affected part `GfxObj` DID. That confirms this belongs in render instance
  state, not in immutable material or geometry assets.
- The old `hookCount` field was only diagnostic. It remains present, but the
  renderer now consumes typed `textureVelocities`.

Cleanup targets:

- If more hook payloads become active, split setup-model hook payload parsing
  into a dedicated hook module instead of continuing to grow
  `setup_model.rs`.
- Runtime entity rendering should converge on the same `partIndex + GfxObj +
  material appearance + texture velocity` render-state shape used by static
  renderables. Do not let preview/static/client entities grow separate UV
  animation paths.
- Once real animation playback lands, add a small conflict-resolution helper for
  hook-applied texture velocity so placement defaults, animation frame hooks,
  and network/runtime updates have one ordering rule.

Legacy shims:

- None introduced. The only retained compatibility field is existing
  diagnostic `hookCount`; active behavior uses typed hook data.

Refinements to future steps:

- Phase 8 should continue to focus on scalar/clip behavior. It should not absorb
  texture velocity or modern `Waveform`/`LayerModifier` animation.
- Later client-mode entity work should route server/runtime animation hooks into
  the same renderer part state and avoid mutating cached material resources.
- If animated groups become numerous enough to hurt batching, add metrics for
  UV-velocity group counts before changing the architecture.

Verification:

- `cargo test --manifest-path crates/holtburger-dat/Cargo.toml setup_model`
  passes.
- `npm run test:ts -- src/lib/world-display/static-renderables.test.ts`
  passes.
- `npm run check` passes.
- `cargo clippy --manifest-path crates/holtburger-dat/Cargo.toml --all-targets
  -- -D warnings` passes.
- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml` passes.
- `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml
  --all-targets -- -D warnings` passes.
- `npm run lint:ts` passes.

### Phase 7.1: Texture Velocity Renderer Subsystem

Goal: promote hook-driven texture velocity from static-renderable plumbing to a
first-class renderer concept shared by static renderables, previews, and future
client-mode runtime entities.

- Move UV velocity material patching, shader cache-key extension, uniform
  ownership, and per-frame offset updates out of `world-display-renderer.ts`
  into a dedicated renderer-local module.
- Introduce a small shared render-state type for texture velocity, including a
  stable signature helper and zero-velocity normalization. Static renderables
  should consume this type instead of owning ad hoc `textureVelocity` and
  `textureVelocitySignature` formatting logic.
- Keep texture velocity as active classic content support, not a compatibility
  shim. The name should avoid implying the path is unused or obsolete merely
  because newer EOR waveform/layer material animation exists.
- Keep the subsystem separate from material DAT waveform/layer animation.
  Future modern material animation may share renderer scheduling utilities, but
  should not share identity or source-data types with hook-driven velocity.
- Ensure the same subsystem can accept velocity from setup placement hooks,
  future animation frame hooks, server/runtime entity state, and preview
  entities.
- Preserve the Phase 7 invariant that shared `GfxObj` geometry and
  resource-cache-owned base materials are not mutated.
- Add renderer debug metrics and Debug panel surfacing for texture velocity as
  animation/render state, not as material asset resources:
  - nonzero texture-velocity part count;
  - texture-velocity render-group count;
  - UV-animated cloned material count;
  - unique texture-velocity signature count and bounded signature samples.
- Keep cache-owned material stats and UV-animated material stats distinct. The
  cloned animated materials are created outside `WorldMaterialResourceCache`,
  so relying only on material-cache stats under-reports the actual program and
  material shape.
- Add focused tests for signature generation, zero-velocity normalization,
  material ownership/disposal behavior, group-key stability, and renderer
  metric derivation. Do not write tests for debug-oriented logging.

Expected effect: texture velocity becomes a reusable renderer capability rather
than a static-renderable-only implementation detail, reducing the chance that
client-mode entities or previews grow parallel UV animation paths.

Debt to collapse before Phase 8:

- Phase 7 currently has correct behavior but embeds the material clone/patch and
  offset update loop inside `world-display-renderer.ts`. Address that before
  adding more scalar/material behavior so Phase 8 does not build on a renderer
  file that is already carrying too many material concerns.
- Static renderable group identity currently formats texture velocity inline.
  Move that into the shared texture-velocity render-state helper so later
  runtime entity render models can use the same key semantics.
- The Debug UI currently surfaces material cache counts and program-key samples
  but does not expose texture velocity presence/counts. Add that visibility in
  Phase 7.1 so animated UV content is inspectable before Phase 8 adds more
  material behavior.

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
for the main pcode-driven terrain merge.

- Build a terrain material resource path that consumes:
  - `landblock-outdoor.terrain.quads[].pcode`;
  - `terrain-material/{regionNumber}`;
  - terrain base textures and tiling;
  - terrain overlay alpha maps;
  - road textures and road alpha maps.
- Emit terrain geometry attributes with quad/pcode-driven layer indices and UVs.
- Use GPU texture arrays or grouped materials to blend base, overlays, roads,
  and alpha maps.
- Do not fold detail textures into this blend. Retail applies terrain detail as
  a separate detail-surface path after the base terrain material is selected.
- Preserve color-variation fields in data and diagnostics, but do not implement
  an invented HSB variation path.

Expected effect: outdoor terrain stops being debug-colored and begins using
terrain material data in a way that can be compared against retail visuals.

### Phase 10.5: Legacy Detail Texture Overlay

Goal: implement the proven retail detail-surface path without baking detail
textures into base terrain, building, object, or environment materials.

- Select role-specific `DetailTexGID` and `DetailTexTiling` through
  `LandSurf`/`TexMerge.terrain_desc`. Retail indexes the same table by role:
  landscape `0`, building `1`, environment `2`, and object `3`.
- Treat detail textures as overlay resources, not as part of the TexMerge GPU
  base/overlay/road blend and not as ordinary `CSurface` material variants.
- Add a shared renderer-local detail-overlay policy/resource path that can be
  applied by render domain: landscape terrain first, then building statics,
  environment/interior cell geometry, and object/static renderables as the
  corresponding render paths can carry a detail role.
- Use wrapped linear sampling and detail UVs derived from base UVs multiplied by
  the selected role's detail tiling.
- Fade the detail overlay by camera depth using the retail thresholds documented
  in the strategy reference: fully visible before `zw = 10`, linearly fading
  from `zw = 10..50`, and absent after `zw = 50`.
- Add diagnostics for missing detail texture resources, unsupported detail
  formats, zero/invalid detail tiling, disabled detail-overlay capability, and
  render domains that have not yet been wired to a retail detail role.

Expected effect: terrain, buildings, environment/interior geometry, and static
objects can gain the high-frequency detail layer visible in the retail client
without fragmenting base material caches or pretending detail textures are part
of pcode terrain materials.

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

## Cross-Cutting Followups

- Define a shared render-facing runtime entity projection before client-mode
  entity rendering lands. Browser preview objects currently flow through
  browser-local preview state and are projected into the static-renderable
  scene, but local previews and server-spawned entities should be mostly
  isomorphic at the render layer: different authority/lifetime sources, same
  render-facing entity shape.
- Add a focused renderer performance phase before increasing runtime entity
  density. Recent profiling showed low material program-key count but high
  draw-call/static-geometry-group count, many instanced groups, and multi-pass
  portal rendering. Future batching work should target geometry-group
  reduction, visibility culling, and portal pass multiplication rather than
  shader-program count.

## Suggested Order

1. Phase 0 material pipeline refactor prep.
2. Phase 1 texture sampling policy prep.
3. Phase 2 setup appearance routing.
4. Phase 2.5 material variant and grouping prep.
5. Phase 3 UV and sampler validation.
6. Phase 4 derived palette views.
7. Phase 5 runtime appearance parity.
8. Phase 6 ClothingTable appearance generation.
9. Phase 7 classic texture velocity animation.
10. Phase 7.1 texture velocity renderer subsystem.
11. Phase 8 clipmap/scalar behavior.
12. Phase 9 terrain material pipeline prep.
13. Phase 10 terrain TexMerge GPU path.
14. Phase 10.5 legacy detail texture overlay.
15. Phase 11 optional high-res JPEG replacement.

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
  - material variant signature and geometry group split behavior;
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
- Detail textures are visually important but architecturally distinct from base
  material selection. Baking them into terrain/static/interior materials would
  fight the retail role-specific detail-surface/fade behavior and over-fragment
  base material resources.
- ACViewer sometimes uses pragmatic renderer shortcuts. Use retail references
  when ACViewer behavior conflicts with decoded data or the strategy document.
