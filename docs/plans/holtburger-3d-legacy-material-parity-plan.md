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
- Terrain material tables and their downstream surface texture/surface/palette
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
- `ClothingTable` parsing and `ClothingTable::BuildObjDesc`-style generation
  exist in `holtburger-content`; clothing recipes now produce normal `ObjDesc`
  facts rather than renderer-specific material state.
- Classic `TextureVelocity` and `TextureVelocityPart` hooks are parsed and
  routed into renderer-local UV velocity state. The renderer subsystem owns
  signatures, shader patching, uniforms, and debug metrics, while future
  animation playback still needs to feed frame-hook execution at runtime.
- Clipmap alpha-test, translucency, luminosity/diffuse scalar handling, legacy
  blend-state mapping, texture filtering policy, anisotropy preference, and
  direct-color compact texture upload are implemented for the legacy material
  path.
- Legacy `0x05` material texture records have been renamed and treated as
  `SurfaceTexture`/`ImgTex` source-level lists. The renderer consumes one
  DTO-selected `RenderSurface` source image instead of treating the list as an
  authored mip chain.
- Real legacy surface materials now use neutral Three.js PBR defaults
  (`metalness = 0`, `roughness = 1`, `envMapIntensity = 0`) so accidental
  specular/environment tint does not affect retail-parity material rendering.

### Known Gaps

- Live runtime object integration still needs a producer that feeds server or
  client-mode `ObjDesc` values into the derived runtime appearance cache and
  dependency planner. The content resolver, cache API, and browser preview
  harness exist, but the 3D app still mostly discovers renderable entities from
  static DAT scene sources.
- Texture velocity is renderer-ready and static-placement-fed, but true runtime
  animation frame-hook execution is still missing. Moving/client-mode entities
  must eventually update texture velocity from the animation system rather than
  relying only on setup placement defaults.
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
- Indexed-color textures are still sampled as raw index textures with nearest
  filtering before palette lookup. Retail appears to resolve indexed surfaces
  with the active palette into color textures before normal filtering, so some
  palettized static objects can still look more pixelated than retail.
- Renderer performance has known pressure from draw-call/static-geometry-group
  count, many instanced groups, and portal pass multiplication. The shader
  program count is no longer the leading suspect.
- Lighting parity remains broader than material defaults. Legacy materials no
  longer inject PBR specular/env defaults, but the browser scene still uses
  Three.js light choices that only approximate retail fixed-function lighting.

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
   expose downstream surface-texture, render-surface, and palette dependencies.
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
  objs, material recipes, surface textures, render surfaces, and palettes.
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
  `GfxObj`, material recipes, surface textures, render surfaces, and palettes.
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

Status: **implemented**.

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

Progress:

- Added a renderer-local `texture-velocity.ts` subsystem that owns:
  - `TextureVelocityRenderState`;
  - zero-velocity normalization;
  - stable velocity signatures;
  - UV-animated material cloning and shader patching;
  - per-frame UV offset uniform updates;
  - texture velocity metric derivation.
- Moved static renderable texture-velocity signature formatting to the shared
  subsystem. Static renderable parts now consume the shared render-state type
  instead of owning renderer-specific formatting helpers.
- Replaced the inline `world-display-renderer.ts` material clone/patch/update
  helpers with calls into the subsystem.
- Added renderer debug metrics for nonzero texture-velocity parts,
  texture-velocity render groups, UV-animated cloned materials, unique
  signatures, and bounded signature samples.
- Surfaced those metrics in the Debug panel renderer diagnostic text.
- Added focused tests for signature generation, zero normalization, cache-owned
  versus cloned material ownership, shader patching, uniform updates, and metric
  derivation.

Decisions:

- Texture velocity is now modeled as renderer animation state, not as a material
  asset resource. Metrics intentionally distinguish cache-owned material counts
  from UV-animated cloned material counts.
- Shader patching remains material-instance based. The subsystem still clones
  materials for animated groups so shared `WorldMaterialResourceCache` materials
  and shared geometry remain immutable.
- The subsystem stays app-local under `apps/holtburger-3d` because it is a
  Three.js renderer implementation concern, even though the source data comes
  from shared DAT parsing.

Course corrections:

- Phase 7's behavior was correct, but `world-display-renderer.ts` owned too many
  texture-velocity details. Moving clone/patch/update/metrics into
  `texture-velocity.ts` makes the concept reusable for previews and future
  client-mode entities.
- Three.js material cloning does not preserve the source material's custom
  program-cache behavior in the way this path needs. The subsystem now captures
  the source material's `onBeforeCompile` and `customProgramCacheKey` before
  cloning so indexed/material-specific shader patches are preserved.

Cleanup targets:

- When preview and client-mode runtime entity render paths mature, route their
  part/entity render state through `TextureVelocityRenderState` instead of
  inventing another UV animation representation.
- If the Debug panel grows structured renderer detail rows, move texture
  velocity metrics out of the long renderer diagnostics sentence into a
  dedicated row. The current text is visible but dense.

Legacy shims:

- None introduced. `texture-velocity.ts` is the active renderer subsystem for
  classic hook-driven texture velocity, not a compatibility wrapper.

Refinements to future steps:

- Phase 8 can now focus on clip/scalar material behavior without expanding the
  renderer file's material-animation responsibilities.
- Modern waveform/layer material animation should remain a separate subsystem.
  It may reuse generic scheduling/metric ideas later, but should not share
  source-data or identity types with hook-driven texture velocity.
- No immediate interim phase is needed before Phase 8.

Verification:

- `npm run test:ts -- src/lib/world-display/texture-velocity.test.ts
  src/lib/world-display/static-renderables.test.ts` passes.
- `npm run test:ts` passes 250 frontend tests across 47 files.
- `npm run check` passes.
- `npm run lint:ts` passes.

### Phase 8: Clipmap And Scalar Material Behavior

Status: **implemented**.

Goal: tighten the non-topological material properties.

- Validate `SurfaceType.Base1ClipMap` for indexed and direct/DXT texture paths.
- Map `CSurface.translucency`, `diffuse`, and `luminosity` into Three material
  behavior with reference screenshots or ACViewer comparisons.
- Avoid inventing formulas for fields with no proven active retail path.
- Add diagnostics for unsupported scalar behavior if exact parity is deferred.

Expected effect: alpha-cut, translucent, luminous, and diffuse-tinted surfaces
should be closer to retail without weakening the material data model.

Progress:

- Added renderer-local legacy material behavior derivation in
  `material-behavior.ts`.
- Centralized `CSurface.translucency`, `diffuse`, and `luminosity` handling for
  solid-color, direct texture, indexed texture, and placeholder material paths.
- Fixed indexed material opacity to use the same normalized client
  translucency interpretation as the direct material path.
- Preserved indexed `SurfaceType.Base1ClipMap` behavior as shader discard for
  palette indices below 8, matching ACViewer's indexed clipmap conversion.
- Added direct texture clipmap handling through material alpha-test when the
  source surface carries alpha, instead of making every alpha-bearing direct
  texture transparent by default.
- Corrected clipmap alpha-test thresholds from the retail decompile:
  paletted/indexed clipmaps use `100 / 255`, and direct/DDS-style clipmaps use
  `200 / 255`.
- Added diagnostics for parsed but not fully rendered `InvAlpha`, `Additive`,
  and `Detail` surface flags.

Decisions:

- `CSurface.translucency` maps to opacity as `1.0 - translucency`, following
  the retail client's `CMaterial::SetTranslucencySimple`.
- `CSurface.diffuse` maps to a grayscale material diffuse multiplier only when
  the `SurfaceType.Diffuse` flag is present, following the retail client's
  `CMaterial::SetDiffuseSimple` channel assignment.
- `CSurface.luminosity` maps to grayscale emissive intensity only when the
  `SurfaceType.Luminous` flag is present, following the retail client's
  `CMaterial::SetLuminositySimple` channel assignment.
- Direct clipmaps use Three `alphaTest` at the retail DDS threshold. Indexed
  clipmaps keep the palette-index discard shader for indices below 8 and also
  use the retail 256-color alpha-test threshold after palette lookup.
- `Additive`, `InvAlpha`, and `Detail` are reported but not approximated yet.
  They need reference-backed blend/detail behavior rather than a guessed Three
  material setting.

Course corrections:

- The previous indexed material opacity path treated translucency as byte-scale
  only. That was inconsistent with parsed `CSurface` data and the direct
  material path, so Phase 8 collapsed the opacity math into one shared helper.
- Direct alpha textures are no longer treated as transparent solely because the
  upload format has alpha. Clipmaps with source alpha now use alpha-test unless
  an explicit translucent/alpha scalar requires transparency.
- Follow-up investigation against the retail decompile showed ACViewer's
  indexed `index < 8` clipmap conversion is correct but incomplete for retail
  parity. Retail `D3DPolyRender::SetSurface` also enables `GREATEREQUAL`
  alpha-test with refs 100 for paletted/256-color textures and 200 for DDS-style
  textures, so the initial `1 / 255` direct alpha-test was too permissive.

Cleanup targets:

- `material-construction.ts` still owns both fallback diagnostics and material
  recipe construction. If Phase 9 adds terrain material diagnostics, keep those
  terrain-specific diagnostics out of this module.
- Unsupported surface-flag diagnostics are currently emitted during material
  construction. If the debug UI starts exposing material issue categories, move
  these into a structured material-diagnostics view rather than growing the
  renderer summary text.
- The scalar behavior helper is renderer-local and Three-specific. Do not move
  it into shared crates unless another frontend renderer needs the same policy.

Legacy shims:

- No compatibility shims were introduced.
- Existing callers were moved to the shared behavior helper instead of keeping a
  re-export on `indexed-materials.ts`.

Refinements to future steps:

- Phase 9 should keep terrain material behavior separate. Terrain may reuse
  scalar helpers only for true `CSurface`-style material recipes; terrain
  `TexMerge` blending, roads, alpha maps, and detail surfaces need terrain
  resource types.
- Future animation-system work should feed runtime diffuse/luminous/translucent
  frame hooks into material instance state. Phase 8 handles static recipe
  defaults only.
- Phase 8.1 now owns additive/inverse-alpha blend mapping. Future alpha work
  should focus on animation-driven state changes and any remaining retail
  edge-cases, not on basic fixed-function blend factors.

Verification:

- `npm run test:ts -- src/lib/world-display/material-behavior.test.ts
  src/lib/world-display/indexed-materials.test.ts
  src/lib/world-display/material-resources.test.ts` passes.
- `npm run check` passes.
- `npm run lint:ts` passes.
- No immediate interim phase is needed before Phase 9.

### Phase 8.1: Legacy Alpha Blend And Sampler Modes

Status: Implemented.

Goal: implement the fixed-function alpha blend modes and sampler behavior that
retail applies around `D3DPolyRender::SetSurface`.

Why this exists:

- Phase 8 implemented scalar opacity and clipmap alpha-test behavior, but
  retail treats alpha-test and alpha-blend as separate render states.
- `SurfaceType.Alpha`, `InvAlpha`, `Additive`, `Translucent`, and
  `Base1ClipMap` choose distinct blend factors and depth-write behavior.
- Retail applies sampler state independently from texture upload. The main
  `CSurface` path sets sampler stage 0 to clamp or wrap based on stippling and
  then uses linear mag/min/mip filtering. Single-pass detail uses sampler stage
  1 with wrap plus linear mag/min/mip filtering.
- Render-material layers carry separate min, mag, and mip filter modes, and the
  device layer can downgrade mip filtering to point when texture filtering is
  disabled or promote linear min/mag filtering to anisotropic when preferences
  and D3D caps allow it.

Implementation scope:

- Extend `material-behavior.ts` or a sibling renderer-local helper with a typed
  legacy blend description:
  - normal opaque: no alpha blend, depth write enabled;
  - `Alpha`: `SRCALPHA, INVSRCALPHA`;
  - `Alpha | Additive`: `SRCALPHA, ONE`;
  - `InvAlpha`: `INVSRCALPHA, SRCALPHA`;
  - `InvAlpha | Additive`: `INVSRCALPHA, ONE`;
  - `Additive`: `ONE, ONE`;
  - `Base1ClipMap`: alpha-test plus blend enabled; if no prior blend mode was
    selected, use `ONE, INVSRCALPHA`;
  - `Translucent`: use `CSurface.translucency` and force normal alpha blending
    when retail does.
- Map those blend descriptions onto Three material state:
  - `transparent`;
  - `blending`;
  - `blendSrc`, `blendDst`, `blendEquation`;
  - `depthWrite`;
  - `alphaTest`.
- Keep unsupported or ambiguous cases diagnostic-backed rather than guessed.
- Add tests for the retail blend matrix, including combined flags.
- Add debug metadata for selected blend mode and alpha-test ref so render oddness
  can be inspected from material diagnostics.
- Implement the static/interior `CSurface` sampler parity pass:
  - extend `TextureSamplingPolicy` to represent mag, min, and mip filter intent
    separately instead of collapsing minification and mip behavior into one
    `minFilter` field;
  - map retail linear/linear/linear to Three minification filters that actually
    use mip levels when mipmaps are available;
  - prefer linear filtering by default for direct and compressed color textures
    when the renderer can support it, because that matches the retail `CSurface`
    path better than the current nearest-heavy defaults;
  - enable mipmap generation for uncompressed direct-color texture resources
    where WebGL can generate mips;
  - preserve compressed texture uploaded mip behavior according to payload
    evidence; do not invent missing mip chains for compressed surfaces without
    proving the DAT payload contains them or generating a renderer-local fallback;
  - keep indexed source textures and palette lookup textures nearest/no-mip for
    palette correctness unless retail evidence proves filtered indexed sampling;
  - retain sampler wrap selection from Phase 3, but express the effective policy
    as `{ wrapS, wrapT, magFilter, minFilter, mipFilter, anisotropy }`;
  - add anisotropy as a renderer capability/preference applied only when the
    requested min/mag filters are linear and the renderer reports a supported max
    anisotropy; default the preference to anisotropic 4x, clamp it to the
    renderer maximum, and degrade through lower supported values before falling
    back to plain linear filtering;
  - include effective sampler policy in material/texture resource cache keys and
    debug diagnostics so policy changes cannot reuse stale GPU textures.
- Treat retail fixed-function stages as shader/material inputs in Holtburger:
  stage 0 maps to the base texture sampler and stage 1/detail maps to additional
  shader samplers/uniforms on the same material variant. Do not introduce extra
  draw passes for detail composition unless a later evidence-backed limitation
  makes that unavoidable.

Expected effect: alpha-blended, additive, inverse-alpha, translucent, and
clipmap surfaces should behave closer to retail, and material diagnostics should
explain the chosen blend/filter policy instead of hiding it inside Three
defaults.

Completion criteria:

- Legacy blend state is represented as typed behavior, tested independently, and
  applied consistently to solid, direct, indexed, and placeholder material
  paths.
- `InvAlpha` and `Additive` are no longer reported as unsupported merely because
  the renderer lacks blend-factor mapping.
- Clipmap alpha-test thresholds from Phase 8 remain unchanged.
- Static/interior `CSurface` texture resources use a tested sampler policy that
  distinguishes mag/min/mip filters, mip generation, and optional anisotropy.
- Indexed palette textures remain nearest/no-mip unless a separate evidence pass
  proves filtered palette lookup is retail-correct.
- Retail stage-style detail composition is planned as a single shader/material
  path, not as a second scene/render pass.

Progress:

- Extended `material-behavior.ts` with a typed `LegacyMaterialBlendBehavior`
  derived from the parsed `CSurface` flags.
- Mapped the retail blend matrix onto Three material state:
  - opaque surfaces keep blending disabled and depth writes enabled;
  - `Alpha` uses `SRCALPHA, INVSRCALPHA`;
  - `Alpha | Additive` uses `SRCALPHA, ONE`;
  - `InvAlpha` uses `INVSRCALPHA, SRCALPHA`;
  - `InvAlpha | Additive` uses `INVSRCALPHA, ONE`;
  - `Additive` uses `ONE, ONE`;
  - `Base1ClipMap` keeps the Phase 8 alpha-test thresholds and uses
    `ONE, INVSRCALPHA` blending with depth writes enabled;
  - `Translucent` and scalar opacity below 1 use normal alpha blending with
    depth writes disabled.
- Applied the blend behavior consistently to solid, direct-texture, indexed,
  and placeholder material paths.
- Added material `userData` metadata for opacity, alpha-test, blend mode,
  blend enablement, depth-write behavior, and remaining unsupported flags.
- Removed `InvAlpha` and `Additive` from unsupported-surface diagnostics now
  that they have explicit renderer behavior. `Detail` remains diagnostic-only.
- Extended `TextureSamplingPolicy` to carry `magFilter`, `minFilter`,
  `mipFilter`, `anisotropy`, `generateMipmaps`, wrap, color-space, and `flipY`
  as separate policy fields.
- Changed direct-color surface defaults to linear mag/min/mip filtering,
  generated mipmaps, sRGB color space, and anisotropy capped at 4x by renderer
  capability.
- Kept compressed surface defaults linear but no generated mips because the
  current upload path only proves a base compressed mip payload.
- Kept indexed source textures nearest/no-mip with anisotropy 1 for palette
  correctness.
- Threaded renderer `getMaxAnisotropy()` into the material texture capability
  detection path and included effective sampler policy in texture cache keys.
- Added a browser Settings dropdown for maximum texture filtering mode:
  `nearest`, `linear`, and `anisotropic-4x`. Changing the mode rebuilds the
  material resource cache and materialized static/interior meshes so old texture
  resources are not reused under a new sampler policy.
- Surfaced the active filtering mode and effective sampler policy counts/samples
  in renderer debug diagnostics.

Decisions:

- Clipmap materials are now `transparent=true` because retail enables alpha
  blending for `Base1ClipMap`; the important Phase 8 behavior is that their
  alpha-test refs stay at 100/255 for indexed and 200/255 for direct alpha
  sources.
- Anisotropy is treated as renderer capability/preference, not asset data. The
  default request is 4x and the effective value is clamped down to the renderer
  maximum, falling back to 1 when unsupported.
- Compressed textures do not synthesize missing mip chains yet. Adding generated
  or decoded compressed mip levels needs payload evidence or a deliberate
  renderer-local fallback phase.
- Texture velocity animation remains independent from sampler policy; sampler
  changes are cache-keyed static texture-resource state.
- Browser texture filtering is a maximum color-texture policy. Indexed/palette
  textures remain nearest/no-mip in every mode for palette correctness.

Course corrections:

- Earlier Phase 8 wording expected clipmaps to avoid transparent sorting. The
  retail evidence for `Base1ClipMap` says alpha-test and alpha-blend are both
  active, so tests now assert transparent clipmap materials with depth writes
  preserved instead of opaque alpha-test-only materials.
- Retail also shows `Base1ClipMap | Translucent` clears the single-pass clipmap
  alpha-test path and uses normal alpha blending. The helper now disables
  clipmap alpha-test for translucent surfaces instead of treating alpha-test and
  translucent blending as fully independent.
- The first validation command was accidentally run from the repository root,
  which has no `package.json`. All app validation for this phase was rerun from
  `apps/holtburger-3d`.

Cleanup targets:

- `material-construction.ts` now has repeated `MeshStandardMaterial`
  construction blocks with identical behavior metadata attachment. A small
  local factory would reduce duplication before additional detail/terrain
  material paths add more variants.
- `LegacyMaterialBlendBehavior` currently uses the static recipe default state.
  A later real animation system still needs to drive runtime diffuse,
  luminosity, translucency, and texture velocity frame changes without
  rebuilding whole scene material plans.
- Debug panels can surface the new blend/sampler metadata more directly; for
  now it is present in material `userData` and cache/program diagnostics.

Legacy shims:

- The cache-level `MaterialTextureSamplingPolicy` override remains as a test and
  diagnostic seam. It should not become a second runtime policy system.
- Compressed texture filtering currently keeps `mipFilter: "none"` even though
  retail stage 0 asks for linear mip filtering, because the current uploaded
  resource contains only the proven base level. Phase 8.2 exists to replace this
  shim after proving the correct `SurfaceTexture`/`ImgTex` source-level
  semantics.

Refinements to future steps:

- Phase 8.2 should land before Phase 9 so terrain work does not inherit the
  current base-level-only compressed texture path.
- Phase 9 should continue treating terrain as a separate material pipeline.
  Terrain can reuse sampler capability helpers, but terrain blending, roads,
  detail textures, and terrain alpha maps should not be forced through the
  `CSurface` recipe path.
- The later detail-texture phase should implement fixed-function stage 1 as an
  additional shader sampler/uniform path on a material variant, not as a second
  scene pass.
- Before adding richer material diagnostics UI, consider consolidating material
  construction so every material path has one obvious place to attach behavior
  and sampler metadata.
- No immediate interim phase is needed before Phase 9.

Verification:

- `npm run test:ts -- material-behavior texture-sampling-policy
  material-resources indexed-materials indexed-texture-resources
  render-surface-texture-resources` passes from `apps/holtburger-3d`.
- `npm run check` passes from `apps/holtburger-3d`.
- `npm run lint:ts` passes from `apps/holtburger-3d`.
- `npm run test:ts` passes from `apps/holtburger-3d` with 48 files and 260
  tests.
- Follow-up validation after the filtering selector and translucent clipmap
  correction:
  - `npm run test:ts -- material-behavior texture-sampling-policy
    material-resources` passes.
  - `npm run check` passes.
  - `npm run lint:ts` passes.
  - `npm run test:ts` passes with 48 files and 262 tests.

### Phase 8.2: SurfaceTexture/ImgTex Source-Level And Mipmap Parity

Status: Implemented.

Goal: pivot legacy material texture handling from the mistaken `RenderTexture`
chain model to the retail `CSurface -> SurfaceTexture -> ImgTex -> RenderSurface`
path, then implement mip filtering and texture-filtering preference modes on
the selected source image before terrain materials consume the same texture
resource path.

Why this exists:

- Phase 8.1 made sampler state explicit, but compressed textures still upload
  only one `RenderSurface` level and therefore need an evidence-backed mip
  policy.
- The DAT `0x05` format has been named `RenderTexture` in our current code, but
  retail material rendering proves this is the legacy `SurfaceTexture`/`ImgTex`
  source-level path. `CSurface::RestoreLostSurface` loads `orig_texture_id` as
  DB type `11`, `ImgTex::GetSurfaceDID` selects one source level, and
  `ImgTex::CreateD3DTexture` generates GPU mipmaps from that selected
  `RenderSurface`.
- Retail `RenderTexture` is a separate `0x15`/DB type `30` resource family with
  explicit `m_nNumLevels` and D3D level resources. It should not drive the
  legacy `CSurface` material implementation.
- Direct-color textures currently generate mipmaps in WebGL. That now appears
  directionally correct for selected legacy material source images, but the
  source-level selection and naming are wrong.
- The browser filtering selector currently exposes `Nearest`, `Linear`, and
  `Anisotropic 4x`. Retail exposes `Bilinear`, `Trilinear`, `Sharp`, and
  `Anisotropic`; the debug selector should either mirror those names or clearly
  remain a non-retail diagnostic control.

Evidence summary:

- Retail `CSurface` stores `orig_texture_id`, `indexed_texture_id`, and
  `ImgTex *base1map` (`acclient.h:13427`).
- `CSurface::RestoreLostSurface` requests `orig_texture_id` as DB type `11`
  (`SurfaceTexture`), not DB type `30` (`RenderTexture`) (`acclient.c:343480`).
- `ImgTex::GetSurfaceDID` accepts one or two source IDs. With two IDs it selects
  the first normally, or the second when `Render::ShouldDropHighDetail()` is
  true (`acclient.c:350884`).
- `ImgTex::CreateD3DTexture` uploads the selected `RenderSurface` and calls
  `D3DXFilterTexture`, so material GPU mips are generated from the selected
  source image (`acclient.c:350735`).
- Retail `RenderTextureD3D::CreateD3DTexture` does allocate a multi-level D3D
  texture from `m_nNumLevels`, but that belongs to the `0x15`/DB type `30`
  `RenderTexture` family (`acclient.c:652645`).

Implementation scope:

- Rename code, payloads, diagnostics, and plan language that expose legacy
  `0x05` material assets as `RenderTexture`. Use `SurfaceTexture` for the DAT
  source-level record and `ImgTex` for the selected runtime image concept.
- Keep compatibility with existing asset IDs only as a short-lived migration
  target if needed; do not add new `render-texture/` material call sites.
  Prefer a clean `surface-texture/{did}` asset ID once the pivot lands.
- Add source-level selection equivalent to `ImgTex::GetSurfaceDID`: choose the
  first source level by default, choose the second source level when high-detail
  dropping is active, and report unsupported source-count shapes in diagnostics.
- Treat the chosen `RenderSurface` as the texture upload source. For
  direct-color textures, generate GPU mipmaps from that source. For compressed
  textures, investigate whether WebGL can generate or upload compatible mips
  from the selected compressed source; if not, degrade mip filtering explicitly
  and surface the reason.
- Add validation/diagnostics for missing selected source surfaces, unsupported
  compressed mip behavior, high-detail drop decisions, and source-level counts
  outside the retail-proven one-or-two level material path.
- Update `TextureSamplingPolicy` and the browser selector to represent retail
  preference modes:
  - `Bilinear`: linear mag/min with point mip selection;
  - `Trilinear`: linear mag/min/mip;
  - `Sharp`: trilinear-style filtering plus the retail mip LOD bias if WebGL
    support can be mapped cleanly;
  - `Anisotropic`: trilinear plus anisotropic mag/min where renderer capability
    allows.
- Keep indexed/palette textures nearest/no-mip unless a separate evidence pass
  proves retail filters indexed source samples before palette lookup.
- Ensure texture velocity animation remains a UV transform on the selected
  material/texture resource and does not force per-frame texture resource
  rebuilding.

Expected effect: legacy material texture naming should match retail, source
level selection should follow the `ImgTex` path, and mip/filter behavior should
be applied to the selected source image instead of pretending every `0x05`
surface list is an authored mip chain.

Completion criteria:

- The plan/reference notes cite the decompile or ACViewer/ACE evidence used to
  classify `0x05` `SurfaceTexture` lists as `ImgTex` source levels and `0x15`
  `RenderTexture` as the separate runtime texture family.
- Legacy material APIs, prepared payloads, debug UI, and tests use
  `SurfaceTexture`/`ImgTex` terminology for `0x05` assets.
- Material texture upload chooses a source `RenderSurface` through the retail
  source-level rule, then applies mip/filter policy to that selected image.
- Compressed texture upload has an explicit parity decision for selected
  compressed source images: supported generated/uploaded mips, or a documented
  fallback to non-mip sampling when WebGL/browser constraints require it.
- Direct-color texture upload generates mips from the selected source image
  when the active filtering mode requests mips.
- Browser filtering modes are renamed or remapped to retail concepts, and debug
  diagnostics surface both requested mode and effective sampler policy.
- Cache keys include the DTO-provided high-detail `RenderSurface` and effective
  sampler policy.
- Tests cover DTO-provided high-detail source use, direct-color generated mip behavior,
  compressed-source fallback behavior, cache-key separation, and browser
  filtering mode mapping.

Progress:

- Renamed the material-facing `0x05` path across Rust content/core, Tauri
  adapter payloads, frontend prepared asset contracts, worker routing,
  diagnostics, tests, and renderer code from `RenderTexture` /
  `render-texture/{did}` to `SurfaceTexture` / `surface-texture/{did}`.
- Renamed the DAT parser type for `0x05` to `SurfaceTexture` and updated parser
  tests to describe the list as source levels, not a mip chain.
- Preserved original `SurfaceTexture.render_surface_ids` order in
  `holtburger-content` instead of filtering the list down to available render
  surfaces. Missing or pruned source levels remain visible to the renderer and
  asset graph.
- Updated material recipe payloads and terrain material payload dependencies to
  use `surfaceTextureAssetIds` and `surfaceTextureId`.
- Updated Tauri JSON lookup and material recipe payloads to prefer the retail
  high-detail `SurfaceTexture` source `RenderSurface`, then fall back to the
  first available lower source level when the mounted repo-local HBA does not
  contain that high-detail `RenderSurface`. `holtburger-content` and
  `holtburger-dat` still preserve the full source-level list.
- Renamed the renderer-facing selected source field from plural
  `renderSurfaceIds` to nullable `selectedRenderSurfaceId`. Dependency fields
  remain arrays, but the material and `surface-texture` DTOs now represent the
  single chosen `ImgTex` source explicitly.
- Reworked material construction to consume the DTO-provided `ImgTex` source
  `RenderSurface` before deciding whether that selected surface is direct,
  compressed, indexed, unsupported, or missing.
- Added tests that prove the renderer uses the DTO-selected render surface and
  that the Tauri DTO does not emit a missing high-detail render surface from the
  repo-local fixture.
- Updated the reference texturing strategy doc to reserve `RenderTexture`
  terminology for the `0x15` resource family and use `SurfaceTexture`/`ImgTex`
  for legacy material `0x05` records.

Decisions:

- No backwards-compatible `render-texture/{did}` material route was kept. The
  old name encoded the wrong model, and retaining both routes would fragment the
  asset graph for no useful runtime behavior.
- `SurfaceTexture` payload dependencies now include only the selected
  render-surface ID. The preferred selection is the retail high-detail source;
  availability fallback is app-local DTO policy because the repo-local HBA is
  not a complete retail DAT.
- The renderer does not scan source levels or know which source-level index is
  high detail. It renders or falls back based on the single `RenderSurface`
  provided by the DTO.
- `selectedRenderSurfaceId: null` is the explicit DTO shape for an unresolved
  or unavailable `SurfaceTexture` source. This keeps the one-selected-source
  contract intact without fabricating an empty candidate list.
- Direct-color selected surfaces continue to generate GPU mips when the active
  sampler policy requests mips, matching the retail `D3DXFilterTexture` shape.
- Compressed selected surfaces keep the explicit Phase 8.1 non-mip fallback
  (`mipFilter: "none"`, `generateMipmaps: false`) because WebGL cannot generate
  compressed mipmaps from a single compressed base image, and retail evidence no
  longer supports treating the `0x05` source-level list as authored compressed
  mips.
- Indexed selected surfaces remain nearest/no-mip for palette correctness.

Course corrections:

- The previous "available render-surface candidates" resolver behavior was
  wrong for retail parity because it destroyed source-level index semantics.
  Content now preserves source order, and the Tauri DTO boundary prefers the
  retail high-detail source for the browser.
- A blind high-detail-only DTO broke the browser scene with the current
  repo-local `assets.hba` because many source-0 `RenderSurface` records are not
  present. The DTO now validates render-surface availability before emitting a
  dependency, preserving the retail preference without flooding the frontend
  with impossible asset requests.
- The true retail `RenderTexture` class is still relevant to `0x15` and modern
  material resources, but it is no longer part of the legacy `CSurface` texture
  path.
- Phase 8.2 no longer attempts to build multi-level Three.js textures from all
  `0x05` render-surface IDs. That would have been a false parity path.

Cleanup targets:

- Some diagnostic strings still use the shorthand "tex" in compact debug output.
  They point at `surfaceTextureAssetIds` now, but the UI label can be polished
  when the debug panel gets another pass.
- The current DTO exposes the highest available retail-preferred source level.
  Add an explicit lower-detail browser/client setting only when we decide how to
  expose retail `EnvironmentTextureDetail` or high-detail-drop behavior.
- True `0x15` `RenderTexture` support remains deferred until modern material or
  UI texture work needs it.
- The material-construction path now owns more source selection and fallback
  logic. If Phase 9 adds terrain source selection, extract a small shared
  source-selection helper rather than duplicating the rules.

Legacy shims:

- Compressed selected source surfaces still disable mip filtering under the
  current browser upload path. This is an explicit WebGL/browser constraint, not
  a `0x05` chain TODO.
- Browser filtering modes still expose `Nearest`, `Linear`, and
  `Anisotropic 4x` rather than retail names. This remains a debug-control naming
  mismatch, not a blocker for Phase 9.
- Source-level availability fallback is a repo-local HBA constraint shim. A full
  retail DAT mount should normally satisfy the high-detail source level.

Refinements to future steps:

- Phase 9 can proceed without an interim bridge phase. Terrain should consume
  `surface-texture/{did}` terminology and source-level semantics from the start.
- Terrain material work should consume the DTO-selected source level unless and
  until a real texture-detail setting is introduced.
- If modern material phases later need true `0x15` `RenderTexture`, introduce it
  as a separate asset family instead of reusing the legacy `SurfaceTexture`
  payload.

Verification:

- `npm run check` passes from `apps/holtburger-3d`.
- `npm run lint:ts` passes from `apps/holtburger-3d`.
- `npm run test:ts` passes from `apps/holtburger-3d` with 48 files and 265
  tests.
- `cargo check -p holtburger-content -p holtburger-core -p holtburger-dat`
  passes.
- `cargo test -p holtburger-content` passes.
- `cargo test -p holtburger-dat -p holtburger-core` passes.
- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml` passes.

Course-correction targets from Phase 8.1:

- Remove the compressed `mipFilter: "none"` shim once compatible chains upload
  with real mip levels. Phase 8.2 narrows this to true `0x15` or another
  explicit authored-mip source; it no longer applies to legacy `0x05`
  `SurfaceTexture`.
- Replace the debug-only `Nearest` mode or label it clearly if it remains useful
  for diagnostics but does not match a retail preference.
- Keep Phase 9 on the new `surface-texture` path so terrain work does not
  revive `render-texture/{did}` for legacy `0x05` assets.

### Phase 8.3: Legacy Material Lighting Defaults

Status: Implemented.

Goal: remove accidental Three.js PBR material defaults from real legacy surface
materials before terrain work compares broader scene lighting.

Why this exists:

- Retail `CSurface::SetSurface` configures fixed-function texture, blend,
  alpha-test, diffuse, translucency, and luminosity state. It does not apply a
  physically based metalness/roughness/specular model.
- Holtburger's real legacy materials were built with `MeshStandardMaterial`
  defaults plus small nonzero metalness/roughness choices. That could add
  browser-authored specular/environment tint to textured statics, interiors, and
  terrain even when the source material was otherwise correct.
- Debug fallback and no-material modes can keep diagnostic styling, but normal
  material mode should not tint valid textured surfaces for renderer-debug
  reasons.

Progress:

- Added a shared material-construction helper that forces real legacy
  `MeshStandardMaterial` instances to `metalness = 0`, `roughness = 1`,
  `envMapIntensity = 0`, and `flatShading = true`.
- Applied the helper to real solid, direct/compressed texture, indexed,
  placeholder, and terrain tile materials.
- Left explicit debug/no-material fallback materials free to keep diagnostic
  styling because those modes intentionally do not represent retail material
  output.

Decisions:

- Keep using `MeshStandardMaterial` for now so existing indexed shader patches,
  alpha state, texture velocity patches, and material cache behavior remain
  stable.
- Treat remaining brightness/color mismatch as lighting parity work, not as a
  reason to reintroduce specular or environment contribution on legacy surface
  materials.

Cleanup targets:

- If lighting mismatch remains obvious after terrain materials land, audit the
  browser scene's ambient/directional light model against retail fixed-function
  lighting rather than adjusting per-material PBR knobs.
- Reconsider `MeshLambertMaterial` or a dedicated fixed-function-style shader
  only if evidence shows `MeshStandardMaterial` cannot be made visually close
  without fragile parameter tuning.

Verification:

- `npm run test:ts -- material-behavior material-resources indexed-materials`
  passes from `apps/holtburger-3d`.
- `npm run check` passes from `apps/holtburger-3d`.
- `npm run lint:ts` passes from `apps/holtburger-3d`.

### Phase 9: Terrain Material Pipeline Prep

Status: Implemented.

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

Progress:

- Added an app-local terrain material resource planning module. It consumes the
  prepared `terrain-material/{regionNumber}` table plus visible landblock quads,
  summarizes referenced pcodes/terrain codes, and reports missing terrain
  tables, missing `SurfaceTexture` dependencies, missing selected
  `RenderSurface` dependencies, unsupported render-surface formats, absent
  terrain alpha maps, and absent road alpha maps.
- Extended the browser terrain scene model so each visible terrain tile carries
  a `TerrainMaterialResourcePlan` alongside the existing debug mesh. This keeps
  terrain material readiness scoped to the terrain renderer path instead of
  leaking terrain concepts into normal `CSurface` material slots.
- Preserved prepared terrain quads in the frontend `PreparedTerrainMesh` shape.
  Triangle debug rendering still has a `terrainType` fallback field, but the
  material-ready path now reads the original quad pcode/corner terrain codes
  instead of deriving material identity from per-triangle debug color state.
- Added terrain geometry attributes for `terrainPcode`, `terrainQuadIndex`, and
  `terrainCornerCodes`. The current material still renders diagnostic vertex
  colors, but Phase 10 can bind terrain shaders without rebuilding the scene
  selection or geometry ownership path.
- Included terrain material prep status in the terrain cache text and scene
  signature so material readiness changes invalidate the rendered terrain scene
  deterministically.

Decisions:

- Keep Phase 9 entirely app-local under `apps/holtburger-3d`. The host/content
  side already exposes landblock quads and terrain material tables; this phase
  only preserves and organizes those facts for Three.js.
- Treat direct-color, compressed, and indexed render surfaces as terrain-capable
  resource inputs for now. Phase 10 owns the actual shader/upload strategy and
  can narrow or split those buckets if terrain blending needs specialized
  handling.
- Keep the old debug-color terrain material active until Phase 10 lands. Phase
  9 is a boundary/readiness phase, not the visual terrain-material replacement.
- Report absent alpha-map and road-map tables as diagnostics, not blockers.
  Some regions or repo-local fixture profiles may be incomplete, and Phase 10
  should decide which absences are fatal for a specific blend path.

Course corrections:

- The frontend was collapsing quad pcodes into triangle `terrainType` values in
  `terrain-scene.ts`. That was sufficient for debug colors but too lossy for
  terrain material parity. The quad records now survive into the render scene.
- Terrain material readiness should not reuse `material-resources.ts` or
  `MaterialAppearanceContext`. Terrain consumes pcodes, alpha maps, roads, and
  detail roles rather than `GfxObj`/env-cell `CSurface` slots.

Cleanup targets:

- `PreparedTerrainTriangle.terrainType` remains as debug-color compatibility
  state. Remove or rename it after Phase 10 stops using per-triangle debug hue
  selection for normal terrain rendering.
- Terrain diagnostics currently surface through compact terrain cache text and
  the resource plan object. If the Debug panel gets structured renderer rows,
  expose terrain material prep counts there instead of relying on a long status
  string.
- The old binary `prepared.terrainMesh.triangles` fallback path still fabricates
  quad metadata from the debug terrain type because it predates structured
  landblock terrain quads. Prefer the structured `landblockTerrain.*` payload
  path for material work.

Legacy shims:

- Debug vertex-color terrain remains the visible renderer path. This is an
  intentional fallback until Phase 10 replaces terrain color materials with a
  GPU terrain blend.
- Missing selected source surfaces still reflect the repo-local HBA/source-level
  availability shim from Phase 8.2. Full retail DAT mounts should reduce those
  diagnostics.

Refinements to future steps:

- Phase 10 can now focus on terrain shader/resource construction: pcode layer
  decoding, texture/alpha/road resource binding, and fallback grouping when
  browser texture-array limits are too low.
- Phase 10 should consume `TerrainMaterialResourcePlan` rather than scanning
  arbitrary prepared assets inside the renderer hot path.
- Phase 10.5 should attach detail-overlay role selection to this terrain
  material boundary rather than treating detail textures as extra
  `CSurface`/material variants.
- No immediate interim phase is needed before Phase 10. The known remaining
  debt is contained: debug `terrainType` naming and compact diagnostics can be
  cleaned while implementing the blend path.

Verification:

- `npm run test:ts -- terrain-materials terrain-geometry` passes from
  `apps/holtburger-3d`.
- `npm run check` passes from `apps/holtburger-3d`.
- `npm run lint:ts` passes from `apps/holtburger-3d`.

### Phase 10: Terrain GPU Blend Path

Status: Implemented.

Goal: replace diagnostic terrain colors with renderer-native terrain materials
for the main pcode-driven terrain blend.

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
- Do not implement this as a CPU `TexMerge::FillTempTexBuffer` clone unless
  exact retail texel output later becomes a hard requirement. The current
  strategy prefers a renderer-native GPU path using the same pcode/material
  inputs.

Expected effect: outdoor terrain stops being debug-colored and begins using
terrain material data in a way that can be compared against retail visuals.

Progress:

- Added an app-local terrain blend material path that consumes visible terrain
  pcodes, `terrain-material/{regionNumber}`, terrain texture entries, terrain
  alpha maps, road maps, and prepared surface/render-surface resources.
- Implemented the client/ACViewer pcode interpretation in the browser renderer:
  four corner terrain codes are decoded from pcode, repeated terrain corners
  select the base layer, non-base corner/side tcodes select terrain alpha maps,
  and road corner bits select all-road or up to two road overlays.
- The terrain alpha/road alpha selection PRNG uses explicit 32-bit integer
  mixing so JavaScript number precision does not drift from the client/ACViewer
  pcode selector formula.
- Added grouped terrain material geometry. Terrain triangles are grouped by
  pcode/material index, emit per-quad UVs, and preserve `terrainPcode`,
  `terrainQuadIndex`, and `terrainCornerCodes` attributes for diagnostics and
  future array-based batching.
- Added a terrain shader material that samples the base terrain texture, blends
  up to three terrain overlays through selected alpha maps, and applies up to
  two road overlays. The shader uses the prepared texture resources and sampler
  policy from the existing material resource cache instead of baking merged
  `TexMerge` textures on the CPU.
- Wired `world-display-renderer.ts` so ready terrain tiles use the new grouped
  terrain material path and non-ready tiles keep the debug vertex-color
  fallback. Terrain mesh recreation now keys off the terrain material resource
  signature so newly prepared terrain material dependencies replace the
  fallback deterministically.
- Follow-up fix: browser scene coverage now requests the active
  `terrain-material/{regionNumber}` graph once an outdoor landblock is prepared.
  Without that request, landblock `0xda55ffff` and its neighbors could render
  only debug terrain because all visible tiles reported `missing-table`.
- Follow-up fix: terrain material readiness now checks only Phase 10 base blend
  inputs: terrain base textures, terrain alpha maps, road textures, and road
  alpha maps. The broader terrain table dependency list also contains deferred
  detail textures, and those Phase 10.5 resources should not block the base
  pcode blend path.
- Added console surfacing for non-ready terrain material plans. The browser now
  emits coalesced `[holtburger-3d][terrain-material]` warnings with status
  counts, sample tiles, missing texture IDs, missing render-surface IDs, and
  unsupported render-surface IDs instead of leaving the Scene panel as the only
  signal.

Decisions:

- Use grouped per-pcode shader materials for the first GPU blend path instead
  of texture arrays. This satisfies the Phase 10 renderer-native blend goal
  without forcing WebGL texture-array capability, fixed array dimensions, or
  atlas packing policy before visual parity is proven.
- Keep the implementation app-local. The pcode decode and material binding are
  frontend renderer concerns because shared crates already expose the lossless
  terrain table/quads needed by any client.
- Reuse `WorldMaterialResourceCache` for texture uploads and sampler policy.
  Terrain does not use normal `CSurface` material slots, but it should not fork
  render-surface decoding, filtering, compressed texture upload, or capability
  handling.
- Override terrain color-layer wrapping to repeat while keeping alpha-map
  textures clamped. Normal material textures default to clamp, but the terrain
  shader applies `TerrainTex.tiling` in UV space and needs repeated color
  layers to avoid clamped edge streaks.
- Do not consume `TerrainTex` color-variation fields yet. They remain preserved
  data, matching the reference decision that no active retail call path has
  been proven.
- Keep detail textures out of the shader. Phase 10.5 remains the dedicated
  detail-surface overlay phase.

Course corrections:

- The Phase 9 resource plan treated indexed terrain render surfaces as
  terrain-capable inputs, but the first Phase 10 shader path only resolves
  direct-color/compressed textures through `getTexture`. Indexed terrain
  textures need either palette-aware shader sampling or a small decoded color
  cache before they can participate in this blend path.
- Texture arrays are not required to start comparing terrain visuals. Grouped
  materials are a more conservative first step because they keep pcode layer
  selection explicit and easier to diagnose.
- The material-ready geometry needed actual UVs, not only pcode attributes.
  Phase 10 now derives per-quad UVs from the preserved quad vertex order.
- The renderer fallback was working correctly; the missing visual texture path
  was a planner gap. Landblock payloads exposed `regionNumber`, but
  browser-mode coverage did not schedule the region-scoped terrain material
  graph after direct landblock hydration.
- The first unsupported-surface wave after terrain material loading was caused
  by treating the table-level dependency list as base terrain readiness. That
  list intentionally includes detail textures for Phase 10.5, so readiness had
  to be scoped to the resources the Phase 10 shader actually samples.

Cleanup targets:

- Validate terrain UV orientation and alpha-map rotation against retail/ACViewer
  screenshots. The current UVs use the preserved quad corner order
  `[southwest, southeast, northeast, northwest]`; if the rendered terrain is
  rotated or mirrored, fix the UV/rotation mapping before layering detail
  textures.
- Add structured terrain blend diagnostics to the Debug panel. The material set
  currently carries diagnostics, but the UI still primarily exposes terrain
  readiness through compact cache text.
- Keep the new console diagnostics coalesced. Terrain scenes can have many
  landblocks with identical resource status, so per-tile logging would become
  noisy quickly.
- Decide the indexed terrain texture policy. Options are palette-aware shader
  sampling, a decoded direct-color texture cache for rare indexed terrain
  inputs, or marking indexed terrain unsupported until a real scene proves it is
  required.
- Consider texture-array batching after parity is clearer. Per-pcode grouped
  materials are intentionally straightforward, but large outdoor views may
  benefit from array/atlas batching once UV and alpha behavior are proven.
- The shader is intentionally unlit for the first material pass. Retail terrain
  also has landblock lighting behavior; fold lighting in only after the base
  texture/alpha selection is visually correct.

Legacy shims:

- Debug vertex-color terrain remains the fallback for missing terrain material
  tables, missing selected render surfaces, unsupported uploads, and no
  resolvable pcode material. This is now a fallback path rather than the normal
  ready-terrain path.
- `PreparedTerrainTriangle.terrainType` still exists for debug fallback colors.
  It should be removed or renamed after the material path no longer needs the
  fallback as a first-class browser mode.

Refinements to future steps:

- Add an immediate Phase 10.25 before detail overlays to harden terrain blend
  parity: UV orientation, alpha rotation, indexed-texture policy, diagnostics,
  and initial performance observations. Detail overlays depend on the same base
  UVs, so this should land before Phase 10.5.
- Phase 10.5 should reuse the terrain UVs/material boundary but keep detail
  overlay resources separate from the pcode blend shader.
- If Phase 10.25 shows grouped materials causing measurable program churn, move
  to texture arrays or atlases as a performance correction rather than changing
  the terrain material data model again.

Verification:

- `npm run test:ts -- terrain-blend-materials terrain-geometry` passes from
  `apps/holtburger-3d`.
- `npm run test:ts -- scene-asset-request-planner` passes from
  `apps/holtburger-3d`.
- `npm run test:ts -- terrain-materials scene-asset-request-planner` passes from
  `apps/holtburger-3d`.
- `npm run test:ts` passes from `apps/holtburger-3d`.
- `npm run check` passes from `apps/holtburger-3d`.
- `npm run lint:ts` passes from `apps/holtburger-3d`.
- `git diff --check` passes from the repo root.

### Phase 10.25: Terrain Blend Parity Hardening

Goal: stabilize the newly visible terrain blend path before layering detail
textures on top of it.

- Compare the Phase 10 grouped shader output against retail/ACViewer at known
  outdoor locations and correct UV orientation, alpha-map rotation, and road
  overlay orientation if needed.
- Surface terrain blend diagnostics in the renderer Debug panel: ready grouped
  material count, fallback pcode count, missing indexed-texture support,
  unresolved terrain/road alpha selections, and per-tile material mode.
- Decide and implement the indexed terrain texture policy if indexed terrain
  resources appear in real terrain material tables.
- Capture a small performance profile for grouped per-pcode materials in a
  dense outdoor view. If program/material churn is material, pivot to
  texture-array/atlas batching while keeping the same pcode decode outputs.
- Keep this phase focused on the base pcode terrain blend. Do not add detail
  overlays here.

Expected effect: terrain base/overlay/road visuals are stable enough that
Phase 10.5 can add detail textures without hiding unresolved base blend errors.

### Phase 10.5: Legacy Detail Texture Overlay

Goal: implement the proven retail detail-surface path without baking detail
textures into base terrain, building, object, or environment materials.

- Select role-specific `DetailTexGID` and `DetailTexTiling` through
  `LandSurf`/`TexMerge.terrain_desc`. Retail indexes the same table by role:
  landscape `0`, building `1`, environment `2`, and object `3`.
- Treat detail textures as overlay resources, not as part of the terrain GPU
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

Progress:

- Landed the landscape terrain slice of the detail path in
  `terrain-blend-materials.ts`. The terrain shader now resolves the
  role-indexed landscape detail layer from `terrain_desc[0]`, samples it with
  wrapped linear texture policy, derives detail UVs from base terrain UVs times
  `DetailTexTiling`, and applies it after base terrain, terrain overlays, and
  roads are blended.
- The detail overlay uses retail depth fade thresholds: fully available before
  view-space z `10`, linearly fading through `10..50`, and absent after `50`.
  The Tauri terrain material DTO now emits those constants instead of placeholder
  zeroes.
- Detail is intentionally not part of the pcode/material identity. It is a
  role-selected overlay resource on the terrain material boundary, matching the
  retail `LScape::GenerateDetailSurface(0)` / `Render::SetLandscapeDetailSurface`
  path rather than the base terrain texture selection path.
- Added focused shader tests covering post-blend detail application, detail
  tiling/fade uniforms, landscape-role texture selection, and wrapped linear
  sampling.

Decisions and course corrections:

- Do not select the detail texture from the pcode base terrain layer. Retail
  selects detail surfaces by terrain role index: landscape `0`, building `1`,
  environment `2`, and object `3`. Using the currently selected base texture
  would look plausible in many outdoor cases but would be wrong for retail
  parity.
- Use `mix(finalColor, detail.rgb, detail.a * depthFade)` for the browser
  shader approximation. Retail applies a detail surface as a fixed-function
  blend pass; the landscape multi-pass path uses SRCALPHA over INVSRCALPHA, and
  the retail detail texture alpha is low, so this preserves the subtle observed
  effect without folding detail into terrain alpha blending.
- Keep Phase 10.5 terrain-only for now. Building, environment/interior, and
  object detail roles need render-domain role propagation and material wrapping
  work before they can share the same overlay policy cleanly.

Cleanup/debt discovered:

- The broad `npm run check` still fails on the pre-existing
  `render-surface-texture-resources.ts` `PixelFormatGPU | null` typing issue.
  This is unrelated to detail overlays, but it should be fixed before treating
  frontend validation as a reliable gate again.
- Static/interior/object material paths still report or ignore `Detail` surface
  behavior. They need a shared detail-overlay wrapper/resource policy instead
  of ad hoc shader edits in each render domain.
- The detail approximation needs screenshot comparison against retail and a
  debug intensity/toggle only if the real alpha-weighted effect proves too hard
  to inspect during parity validation.

### Phase 10.6: Detail Overlay Role Propagation and Validation

Goal: finish the non-landscape detail roles and validate the terrain detail
approximation before optional high-res replacement work.

- Add renderer-local detail role metadata for building statics, environment and
  interior cell geometry, and object/static renderables. The role assignment
  must stay render-domain local and should not become a `CSurface` material
  variant or pcode key.
- Factor the terrain detail resource/shader policy into a reusable overlay
  helper that can wrap or extend legacy material render paths without
  fragmenting base material caches.
- Wire role-indexed detail selection for building `terrain_desc[1]`,
  environment `terrain_desc[2]`, and object `terrain_desc[3]`, including
  diagnostics for missing assets, invalid tiling, unsupported render-surface
  formats, disabled detail capability, and render domains that still lack role
  metadata.
- Capture before/after screenshots against the retail client for at least one
  outdoor terrain view and one static/interior/object case. If the retail
  fixed-function blend differs visibly from the current alpha-weighted mix,
  update the shader approximation before moving on.

Expected effect: detail overlays become a shared renderer capability with clear
role ownership across terrain and non-terrain render domains, leaving Phase 11
free to focus on high-res texture replacement rather than material graph debt.

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

These are not blockers for Phase 9 terrain work, but they should become named
implementation phases before client-mode entity density or final material
parity depends on them.

- Define a shared render-facing runtime entity projection before client-mode
  entity rendering lands. Browser preview objects currently flow through
  browser-local preview state and are projected into the static-renderable
  scene, but local previews and server-spawned entities should be mostly
  isomorphic at the render layer: different authority/lifetime sources, same
  render-facing entity shape.
- Add real animation frame-hook execution before relying on texture velocity for
  moving/client-mode entities. Current texture velocity support is renderer-ready
  and setup-placement-fed: browser static renderables harvest hooks from the
  selected setup placement frame and treat the resulting velocity as active
  render state. Retail triggers `TextureVelocity` and `TextureVelocityPart`
  through animation/physics sequence frame hooks, so future animation playback
  must feed `TextureVelocityRenderState` from actual frame-key execution rather
  than only from static setup placement facts.
- Add a focused renderer performance phase before increasing runtime entity
  density. Recent profiling showed low material program-key count but high
  draw-call/static-geometry-group count, many instanced groups, and multi-pass
  portal rendering. Future batching work should target geometry-group
  reduction, visibility culling, and portal pass multiplication rather than
  shader-program count.
- Add an indexed-color filtering evaluation phase before treating indexed
  material filtering as complete. Retail `CSurface::SetTextureAndPalette`
  resolves `P8`/`Index16` plus the selected palette into a color `ImgTex` first,
  then the normal `CSurface` path applies linear/min/mip sampler state to that
  color texture. Holtburger currently keeps raw indexed source textures on the
  GPU and samples them with nearest filtering before a shader palette lookup,
  which preserves exact indices but makes some palettized static objects visibly
  more pixelated than retail. The follow-up should compare two implementation
  options against real scene counts and frame timings:
  - lazily resolve indexed render surfaces plus base/derived palette views into
    renderer-local color textures for normal material rendering;
  - or keep the raw indexed texture and implement shader-side bilinear filtering
    in color space by sampling four neighboring indices, looking up four palette
    colors, and interpolating the palette colors rather than the indices;
  - retain raw nearest indexed textures only for diagnostics or exact-index
    paths;
  - choose compact upload formats for resolved indexed-color textures where
    practical, following the direct-color path's compact uploads for RGB-like
    sources and packed RGBA4444 where browser/Three capabilities allow;
  - keep compressed render surfaces compressed when browser capabilities allow;
  - bound derived resolved-texture cache growth by estimated GPU bytes with LRU
    eviction, because palette views, clothing, and future runtime entity
    variation can multiply `renderSurfaceId + palette view + clipmap/sampler`
    cardinality;
  - surface debug counters for resolved texture count, estimated bytes,
    evictions, and the largest cardinality contributors.

## Suggested Order

Completed or current material-parity phases:

1. Phase 0 material pipeline refactor prep.
2. Phase 1 texture sampling policy prep.
3. Phase 2 setup appearance routing.
4. Phase 2.5 material variant and grouping prep.
5. Phase 3 UV and sampler validation.
6. Phase 4 derived palette views.
7. Phase 5 runtime appearance parity.
8. Phase 5.5 layered runtime appearance cache.
9. Phase 5.75 browser appearance preview harness.
10. Phase 6 ClothingTable appearance generation.
11. Phase 7 classic texture velocity animation.
12. Phase 7.1 texture velocity renderer subsystem.
13. Phase 8 clipmap/scalar behavior.
14. Phase 8.1 legacy alpha blend and sampler modes.
15. Phase 8.2 SurfaceTexture/ImgTex source-level and mipmap parity.
16. Phase 8.3 legacy material lighting defaults.
17. Phase 9 terrain material pipeline prep.
18. Phase 10 terrain GPU blend path.

Remaining planned parity phases:

1. Phase 10.25 terrain blend parity hardening.
2. Phase 10.5 legacy detail texture overlay.
3. Phase 10.6 detail overlay role propagation and validation.
4. Phase 11 optional high-res JPEG replacement.

Recommended follow-up phases after the terrain/detail pass:

1. Indexed-color filtering evaluation and implementation. This should compare
   lazy resolved color textures against shader-side color-space bilinear
   filtering, then choose a bounded cache strategy.
2. Renderer performance consolidation before dense runtime entity/client-mode
   rendering. Focus on geometry-group count, draw-call count, instanced-group
   fragmentation, visibility culling, and portal pass multiplication.
3. Runtime entity render projection. Browser preview objects and server-spawned
   entities should feed the same render-facing shape with different
   authority/lifetime sources.
4. Animation frame-hook execution for moving entities. Texture velocity already
   has renderer state, but runtime animation playback needs to drive it from
   frame-key execution.

This order now targets the currently observed failures and risks:

- outdoor terrain is intentionally debug-colored until the terrain material path
  exists;
- detail textures are visually important across landscape, building,
  environment, and object roles, but should remain a separate overlay path;
- indexed palettized statics can still look too pixelated because Holtburger
  filters palette indices differently from retail's resolved-color path;
- runtime entity scale will stress render projection, batching, visibility, and
  animation hooks more than the current static browser scene does.

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
