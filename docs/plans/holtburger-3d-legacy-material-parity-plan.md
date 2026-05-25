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
- Static setup-model rendering requests and prefers prepared
  `setup-appearance/{setup_did}` payloads when available, while retaining raw
  setup-model part rendering as an explicit fallback.
- Material plans, final material cache keys, and static renderable geometry
  groups carry immutable material variant identity. Existing content normalizes
  to the `base` variant until Phase 3 emits sampler-derived variants.

### Known Gaps

- Runtime/server `ObjDesc` variants are not yet routed into prepared
  setup-appearance inputs. Static setup-model rendering uses the base prepared
  `setup-appearance/{setup_did}` snapshot when available.
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
  not been validated against ACViewer or the retail decompile. Retail legacy
  `CSurface` rendering appears to choose wrap/clamp from polygon-side
  `stippling` bits, not by scanning emitted UV ranges. The likely missing parity
  pieces are preserving those side-local sampler bits, emitting sampler-derived
  material variants, validating UV orientation, and using the existing
  repeated/clamped texture-resource and material-variant cache seams.
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
  app-local prepared render geometry types. Rust/content does not emit it yet;
  Phase 3 can populate it from polygon-side sampler metadata without another
  browser-app contract reshuffle.
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
- Phase 2.5 does not change visible sampler behavior. Existing geometry has no
  `materialVariantSignature`, so current rendering remains on the normalized
  `base` variant until Phase 3 emits real per-triangle/per-group sampler facts.
- The optional triangle `materialVariantSignature` field is an app contract
  shim for Phase 3. It is deliberately optional so existing content payloads
  remain valid until `holtburger-content` starts emitting side-local sampler
  metadata.
- Per-instance and time-varying state remains outside shared material cache
  keys. Texture velocity must still be represented as instance/part UV state,
  not as a material variant.
- No immediate interim phase is needed before Phase 3. The material identity
  and geometry grouping seam exists; the next work is to feed it with
  stippling-derived sampler metadata from content.

Cleanup targets from Phase 2.5:

- Phase 3 should replace the optional contract shim with real emitted
  `materialVariantSignature` values from decoded polygon-side sampler metadata.
- Consider replacing free-form variant strings with a tiny typed builder once
  Phase 3 proves the exact sampler signature shape. Do not add broad variant
  enums before the concrete axes settle.
- Keep watch on `ResolvedMaterialSlot`: once palette view and texture swap
  signatures are filled, this type may deserve a focused material-identity
  helper rather than more inline string assembly in callers.
- If Phase 3 needs both diagnostic `uvBounds` and production sampler variants,
  keep the diagnostic UV summary out of final material cache keys unless it
  affects immutable render behavior.

Legacy shims:

- `base` is the compatibility variant for all existing material slots and
  triangles.
- Prepared render triangle `materialVariantSignature` is optional until
  `holtburger-content` emits it. Missing values must mean `base`, not
  "unknown".
- Current final materials are separated by variant identity even though variant
  identity does not yet alter material construction. Phase 3 should supply
  sampler-specific texture policies so separated materials can diverge in
  actual GPU state.

Refinements to future steps:

- Phase 3 should derive a sampler variant signature from the retail
  side-local `CPolygon.stippling` wrap bit and attach it to prepared render
  triangles or material groups before `resolveMaterialPlan()`.
- Phase 3 should use the Phase 1 `TextureSamplingPolicy` helpers to create the
  actual clamp/repeat texture policy that corresponds to the material variant
  signature. The signature and policy must stay in sync.
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

- Add a small diagnostic/export harness that emits per-polygon vertex IDs,
  side, raw `stippling`, derived side wrap flag, UV indices, UV values, surface
  slot, and material/render-surface IDs for a known problematic env cell.
- Compare Holtburger output against ACViewer's `BuildUVLookup()` and
  `Polygon.BuildIndices()` behavior. Treat ACViewer's `HasWrappingUVs` as a
  comparison signal only; retail legacy sampler state is driven by polygon
  `stippling` bits.
- Produce a deterministic comparison report for each fixture env cell covering:
  - polygon IDs;
  - polygon side and raw `stippling` value;
  - triangle fan order;
  - surface slot and resolved `CSurface` ID;
  - UV index selection;
  - emitted UV values;
  - render texture/render surface IDs;
  - retail-derived wrap/clamp policy from the side-local stippling bit;
  - ACViewer-style `HasWrappingUVs` result, with mismatches called out for
    investigation;
  - texture `flipY` or V-axis transform policy.
- Add renderer texture wrapping policy from preserved legacy polygon metadata:
  - positive-side polygons repeat when `CPolygon.stippling & 0x1` is set;
  - negative-side polygons repeat when `CPolygon.stippling & 0x2` is set;
  - otherwise use clamp wrapping;
  - keep UV-range checks as diagnostics or fallback only when source-side
    stippling metadata is unavailable.
- Split geometry/material groups when the side-derived sampler policy differs,
  even if the polygons resolve to the same `CSurface`, render texture, and
  palette. The material plan must not place clamp and repeat polygons into one
  Three material slot.
- Validate whether Three's default V-axis handling needs `flipY = false` or UV
  V inversion for DAT textures.
- Add targeted tests around UV emission, stippling-derived sampler metadata, and
  texture wrap selection, including a fixture where one `CSurface` is used with
  both clamp and repeat policies.
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
4. Phase 2.5 material variant and grouping prep.
5. Phase 3 UV and sampler validation.
6. Phase 4 derived palette views.
7. Phase 5 runtime appearance parity.
8. Phase 6 ClothingTable appearance generation.
9. Phase 7 legacy texture velocity animation.
10. Phase 8 clipmap/scalar behavior.
11. Phase 9 terrain material pipeline prep.
12. Phase 10 terrain TexMerge GPU path.
13. Phase 11 optional high-res JPEG replacement.

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
- ACViewer sometimes uses pragmatic renderer shortcuts. Use retail references
  when ACViewer behavior conflicts with decoded data or the strategy document.
