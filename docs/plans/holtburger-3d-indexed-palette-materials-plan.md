# Holtburger 3D Indexed Texture Foundation Plan

## Purpose

Implement foundational Asheron's Call indexed texture support in
`apps/holtburger-3d` without baking indexed textures into ordinary RGBA textures
as the primary renderer model.

The design authority is
[`holtburger-3d-materials-texturing-strategy.md`](./holtburger-3d-materials-texturing-strategy.md).
That document establishes that `PFID_P8` and `PFID_INDEX16` are first-class
legacy material paths. This plan covers the base indexed texture foundation:
lossless palette transport, GPU palette/index resources, indexed material
sampling, and indexed-specific diagnostics. Full `ObjDesc` palette changes,
subpalette replacement, clothing, skin, hair, dye, terrain `TexMerge`, and full
material scalar parity belong to a later legacy material parity push.

## Current State

The current browser renderer supports a partial legacy material path:

- `CSurface` material recipes are loaded as solid color or texture materials.
- Mesh polygon material groups are derived from `surfaceId`.
- Direct-color `RenderSurface` formats are expanded to RGBA `DataTexture`.
- DXT1/DXT3/DXT5 render surfaces can upload through Three `CompressedTexture`
  when S3TC is available.
- Palette assets are lossless in the browser contract. Tauri binary lookup
  carries palette tables as `u32` envelope sections and hydrates them as
  `Uint32Array`.
- Material diagnostics report missing recipes, missing dependencies, unsupported
  formats, and texture upload fallback.

The current browser renderer does not yet support real indexed materials:

- `PFID_P8` and `PFID_INDEX16` render surfaces are reported as unsupported.
- `setup-appearance` payloads preserve `paletteId`, `subPalettes`,
  `textureChanges`, and `animPartChanges`, but the static renderable scene path
  mostly resolves base setup/gfx material slots.
- The material cache creates ordinary `MeshStandardMaterial` instances and has
  no shader path for palette lookup.
- Static renderable instancing groups already include `materialSignature`, but
  that signature currently reflects base material slots only. It does not yet
  include palette-view identity or setup appearance state.

## Dry-Run Findings

This plan was checked against the current code paths before implementation. The
following gaps should be addressed in this order.

1. Complete: `palette/` assets now go through the binary lookup path.
   `usesBinaryAssetLookup()` in `apps/holtburger-3d/src/lib/host/tauri.ts`
   routes `palette/` alongside `render-surface/`.
2. Complete: the binary envelope supports `u32`.
   `BinaryAssetSectionWriter` can write `u32` sections and
   `apps/holtburger-3d/src/lib/host/binary-asset-envelope.ts` hydrates them as
   copied `Uint32Array` values.
3. Course correction: the Rust binary manifest did not currently repeat the
   `responses` key. That dry-run note was stale; no cleanup was needed.
4. Complete: worker transferables now include render-surface and palette buffers.
   `collectPreparedAssetTransferables()` in
   `apps/holtburger-3d/src/workers/asset-worker.ts` transfers
   `render-surface.sourceBytes` and `palette.colorsArgb` when they occupy a
   transferable full buffer.
5. Asset dependency discovery already has the right shape for palettes.
   `material-recipe`, `setup-appearance`, `terrain-material`, and
   `render-surface` dependencies all surface `paletteAssetIds`. Once palette
   payloads are lossless, the scheduler should automatically prepare them.
6. Complete: static renderable grouping accepts material signature as part of
   the group key, and the misleading grouping names were collapsed to
   `partsByRenderGroupKey` and `groupStaticRenderablePartsByRenderGroupKey`.
   Later material parity work only needs to expand `materialSignature` with
   palette-view identity.
7. `setup-appearance` payloads are prepared by the asset graph, but
   `static-renderables.ts` does not currently prefer them for setup model parts.
   Dyed/clothing appearance correctness is blocked until static part expansion
   consumes those payloads. This is intentionally outside this foundation push.
8. Complete for the indexed foundation: pixel format classification and
   direct-color/compressed texture creation now live in
   `render-surface-texture-resources.ts`; palette texture upload, indexed
   texture upload, and shader patching also live in focused modules.
   `material-resources.ts` still owns recipe resolution, cache coordination, and
   material diagnostics.

## Goals

1. Preserve palette colors losslessly in asset contracts.
2. Upload indexed image data as index textures, not as pre-baked diffuse maps.
3. Upload palettes as GPU lookup textures sized to the actual palette length.
4. Render `PFID_P8` and `PFID_INDEX16` through a palette-sampling material path.
5. Apply base `CSurface` palette IDs and `RenderSurface.defaultPaletteId`.
6. Replace generic unsupported-format warnings with indexed-material diagnostics
   that identify missing palette data, unsupported index encoding, or shader
   capability issues.

## Non-Goals

- Do not implement `ObjDesc` subpalette replacement, clothing table selection,
  skin/hair/dye appearance parity, or `PaletteSet` selection in this pass.
- Do not implement full terrain `TexMerge` blending in this pass.
- Do not implement broad `CSurface` material scalar parity for luminosity,
  diffuse, terrain, or high-res JPEG replacement in this pass.
- Do not bake indexed render surfaces to RGBA as the durable cache/resource
  model. A temporary debug fallback may be acceptable only if it is clearly
  separated from the real path.
- Do not move browser-specific shader/material policy out of
  `apps/holtburger-3d`.

## Reference Behavior

Reference code to keep open while implementing:

- Retail client texture/material strategy:
  [`docs/plans/holtburger-3d-materials-texturing-strategy.md`](./holtburger-3d-materials-texturing-strategy.md)
- ACE parser:
  `ACE/Source/ACE.DatLoader/FileTypes/Texture.cs`
- ACViewer renderer:
  `ACViewer/ACViewer/Render/TextureCache.cs`
- Holtburger DAT parser:
  `crates/holtburger-dat/src/file_type/material.rs`
- Holtburger content graph:
  `crates/holtburger-content/src/material_graph.rs`

ACViewer's `IndexToColor` path confirms `PFID_INDEX16` source bytes are
16-bit palette indices. The retail-client strategy document is stricter than
ACViewer's CPU expansion path: Holtburger should keep indexed maps and palettes
separate so runtime appearance changes remain cheap and correct.

## Phase 1: Lossless Palette Assets

Status: complete as of 2026-05-25.

Extend palette payloads to carry the actual palette table.

Render-surface pixel/index bytes already use the binary asset envelope. Tauri
leaves `payload.sourceBytes = []` in the JSON manifest and appends the real bytes
as a `u8` binary section hydrated by
`apps/holtburger-3d/src/lib/host/binary-asset-envelope.ts`. Palette colors should
follow the same pattern rather than becoming large JSON arrays.

Files likely involved:

- `apps/holtburger-3d/src/lib/host/contracts.ts`
- `apps/holtburger-3d/src/lib/assets/types.ts`
- `apps/holtburger-3d/src-tauri/src/adapter/json.rs`
- `apps/holtburger-3d/src-tauri/src/adapter/binary.rs`
- `apps/holtburger-3d/src/lib/host/binary-asset-envelope.ts`
- `apps/holtburger-3d/src/lib/host/tauri.ts`
- `apps/holtburger-3d/src/workers/asset-worker.ts`
- tests under `apps/holtburger-3d/src/lib/host/`,
  `apps/holtburger-3d/src/lib/assets/`, and `apps/holtburger-3d/src-tauri/`

Contract changes:

```ts
interface PreparedPalettePayload {
  kind: "palette";
  paletteId: number;
  colorCount: number;
  colorsArgb: Uint32Array;
}
```

Transport changes:

- Add a binary envelope scalar type for palette colors. Prefer `u32` so ARGB
  values remain exact and little-endian, matching the existing envelope
  byte-order declaration.
- Route `palette/` asset IDs through binary lookup in `usesBinaryAssetLookup()`.
- Tauri should serialize palette JSON with an empty placeholder, for example
  `colorsArgb: []`, and push the palette table as a binary section.
- The frontend envelope decoder should hydrate that section into a `Uint32Array`.
- JSON-only test fixtures can still use plain number arrays if the schema and
  preparation layer normalize them, but the Tauri path should not send real
  palette tables as JSON arrays.
- Worker preparation should transfer hydrated palette buffers from worker to main
  rather than structured-cloning them.

Validation rules:

- `colorsArgb.length === colorCount`.
- Values are unsigned 32-bit ARGB.
- Failed palette decode remains a hard asset provenance failure, not an empty
  palette.

This phase should not change rendered output yet. It only makes the data
available.

Implemented changes:

- `PreparedPalettePayload` and `PalettePayloadDto` now include
  `colorsArgb: Uint32Array`.
- JSON fixture/direct lookup payloads may provide `colorsArgb` as a plain
  unsigned integer array; frontend contract parsing normalizes it to
  `Uint32Array` and validates `colorsArgb.length === colorCount`.
- Tauri's JSON serializer exposes `colorsArgb` for direct JSON lookups, but the
  app host routes `palette/` through binary lookup so normal app traffic does
  not send palette tables as large JSON arrays.
- The binary envelope supports `u32` sections. Palette binary payloads leave
  `colorsArgb: []` in the manifest and append palette ARGB values as a
  little-endian `u32` section.
- Worker postmessage transfer handling now covers `render-surface.sourceBytes`
  and `palette.colorsArgb` in addition to prepared geometry buffers.

Validation added:

- Frontend binary envelope test for `palette.colorsArgb` hydration as
  `Uint32Array`.
- Tauri routing test proving `palette/` uses binary lookup.
- Asset preparation test proving JSON palette arrays normalize to
  `Uint32Array`.
- Rust binary payload test proving palette colors move into a `u32` binary
  section.

Course corrections:

- The earlier duplicate-`responses` manifest cleanup item was not present in the
  current code, so Phase 1 did not change the manifest shape beyond adding `u32`
  sections.
- Direct JSON palette lookup remains lossless for diagnostics and tests. The
  browser app still avoids that path for palette assets through binary routing.

Cleanup targets:

- Add a direct test for worker transfer-list behavior if
  `prepareAssetForPostMessage()` or the transfer collector becomes exported or
  gets a pure helper. Current coverage validates typed payload preparation and
  binary hydration, but not the internal transfer-list mutation directly.
- Consider sharing the typed-array transferable helper with future render
  resource loaders if more binary asset families are added.

## Phase 2: Palette Resource Cache

Status: complete as of 2026-05-25.

Add palette GPU conversion helpers and a renderer-local palette resource cache.

Likely home:

- `apps/holtburger-3d/src/lib/world-display/palette-resources.ts`
- `apps/holtburger-3d/src/lib/world-display/material-resources.ts` as the
  integration point

Responsibilities:

- Consume already-normalized `Uint32Array` palette payloads from the asset
  preparation layer.
- Convert `colorsArgb` to GPU color data.
- Preserve alpha from ARGB.
- Upload a palette texture with stable dimensions derived from palette length.
- Cache by palette asset ID plus prepared timestamp/provenance state.
- Dispose palette textures with the material cache.

Recommended representation:

- Use a 2D `DataTexture`, not a hard-coded 256-wide texture.
- Pick a deterministic width such as `min(nextPowerOfTwoOrPaletteWidth, maxTextureSize)`
  only after checking WebGL constraints. Simpler first version can use width =
  `colorCount`, height = `1` if supported by target devices.
- Use nearest filtering and no mipmaps. Palette lookup must be exact.

Open decision:

- Whether to expose renderer max texture size to the palette cache directly or
  keep the first version constrained to palette sizes known from AC content.

Refinement after Phase 1:

- Use an explicit `argbToRgbaBytes()` helper with tests before touching Three
  resources. This prevents accidental ABGR/RGBA channel swaps when uploading the
  palette lookup texture.
- Cache keys should include palette asset ID and prepared provenance/timestamp.
  They do not need subpalette identity yet; that belongs to the later material
  parity push.
- Treat zero-length palettes as invalid renderer resources even though the
  transport contract allows `colorCount = 0` for provenance payloads.

Implemented changes:

- Added `apps/holtburger-3d/src/lib/world-display/palette-resources.ts` for
  palette-specific renderer resource work.
- Added `argbToRgbaBytes()` and tests proving ARGB values upload as RGBA bytes
  with alpha preserved.
- Added `createPaletteTextureResource()` to create a one-row `DataTexture`
  where `width = colorCount` and `height = 1`.
- Palette textures use `RGBAFormat`, `UnsignedByteType`, nearest min/mag
  filtering, no mipmaps, and `SRGBColorSpace`.
- `WorldMaterialResourceCache` now owns a palette resource cache and disposes
  palette textures with other material resources.
- Palette resource cache keys include asset ID, prepared timestamp/provenance,
  `paletteId`, and `colorCount`. Subpalette identity is intentionally not part
  of this foundation cache yet.

Validation added:

- Unit coverage for ARGB-to-RGBA byte ordering.
- Unit coverage for rejecting zero-length palettes as invalid renderer
  resources.
- Unit coverage for palette texture dimensions, format, filters, mipmap
  behavior, color space, and upload bytes.
- Unit coverage proving `WorldMaterialResourceCache` reuses palette resources
  for the same prepared asset and refreshes after prepared state changes.

Decisions:

- The first renderer representation is a one-row 2D `DataTexture`, not a fixed
  256-wide texture and not a max-texture-size-aware atlas. AC palette sizes are
  expected to be far below WebGL texture width limits; add tiling only if real
  content proves this assumption wrong.
- Palette textures are marked `SRGBColorSpace` because the palette table
  represents albedo color values, matching the direct-color texture path. Phase
  4 shader work should keep this color-space decision explicit when sampling the
  palette texture.
- Zero-length palettes fail during resource creation instead of becoming a
  transparent or black placeholder. Missing/empty palette diagnostics should be
  added at the indexed-material classification layer in Phase 3.

Cleanup targets:

- `material-resources.ts` still owns too many resource families. Phase 3 should
  avoid adding more pixel-format logic directly to that file and should move
  indexed texture classification into `indexed-texture-resources.ts`.
- Palette resource creation is currently public through
  `WorldMaterialResourceCache.getPaletteResource()` for upcoming phases, but no
  material consumes it yet. Phase 3 should become the first real consumer.
- Direct-color and compressed texture resource creation was later split into
  `render-surface-texture-resources.ts` during the cleanup pass after Phase 6.

## Phase 3: Indexed Surface Resource Cache

Status: complete as of 2026-05-25.

Add indexed surface classification, validation, and index texture creation for
indexed `RenderSurface` formats.

Likely home:

- `apps/holtburger-3d/src/lib/world-display/indexed-texture-resources.ts`
- `apps/holtburger-3d/src/lib/world-display/material-resources.ts` as the
  integration point

Formats:

- `PFID_P8` (`0x29`): one unsigned byte per pixel.
- `PFID_INDEX16` (`0x65`): one little-endian unsigned 16-bit index per pixel.

Validation:

- Width and height must be positive and safe.
- `P8` source length must equal `width * height`.
- `Index16` source length must equal `width * height * 2`.
- Indexed surfaces must have either `CSurface.orig_palette_id` or
  `RenderSurface.defaultPaletteId`.
- Palette index range must be validated against the prepared palette length
  when practical. For shader-only range validation, add diagnostics that sample
  or pre-scan indices before upload.

WebGL representation:

- For `P8`, use a single-channel unsigned byte texture when available.
- For `Index16`, prefer an integer-safe representation. Options:
  - WebGL2 `R16UI`/integer sampler path if Three integration is practical.
  - Two-channel byte packing (`RG`) with shader reconstruction:
    `index = low + high * 256`.

The byte-packing path is likely the most portable in Tauri/Chromium while still
avoiding RGBA baking.

Scheduling note:

- Land classification and diagnostics before shader work. This lets the browser
  report `indexed-texture-palette-unprepared` instead of
  `unsupported-render-surface` as soon as the asset data is available, even
  before indexed rendering is complete.

Refinement after Phase 2:

- Phase 3 should resolve palette assets to
  `WorldMaterialResourceCache.getPaletteResource()` instead of creating a second
  palette cache.
- Add pure helpers first: indexed pixel-format classification, source length
  validation, palette ID selection, and optional max-index scanning. This gives
  diagnostics something stable to test before shader work.
- If max-index scanning is added, keep it CPU-side and bounded to prepared
  source bytes. This is diagnostic validation, not RGBA baking.

Implemented changes:

- Added `apps/holtburger-3d/src/lib/world-display/indexed-texture-resources.ts`
  for indexed pixel-format classification, source validation, palette selection,
  max-index scanning, and index texture resource creation.
- Added `WorldMaterialResourceCache.getIndexedTextureResource()` so indexed
  texture resources are cached and disposed with other renderer material
  resources.
- Routed indexed material diagnostics through the indexed resource and palette
  resource caches. Invalid indexed data reports indexed-specific diagnostics
  instead of generic `unsupported-render-surface`.
- Replaced generic unsupported-format diagnostics for `PFID_P8` and
  `PFID_INDEX16` with indexed-specific diagnostics:
  `indexed-texture-palette-missing`,
  `indexed-texture-palette-unprepared`, `indexed-texture-palette-empty`,
  `indexed-texture-index-out-of-range`,
  `indexed-texture-palette-resource-failed` and
  `indexed-texture-upload-failed`.

Validation added:

- Unit coverage for `PFID_P8` and `PFID_INDEX16` classification.
- Unit coverage for P8 upload as single-channel `RedFormat`,
  `UnsignedByteType`, `NoColorSpace`, nearest-filtered `DataTexture`.
- Unit coverage for Index16 upload as little-endian byte-packed `RGFormat`,
  `UnsignedByteType`, `NoColorSpace`, nearest-filtered `DataTexture`.
- Unit coverage for indexed source byte-length validation.
- Unit coverage for palette selection precedence:
  `CSurface.orig_palette_id` before `RenderSurface.defaultPaletteId`.
- Unit coverage for CPU max-index scans.
- Material cache coverage proving indexed resources are cached and indexed
  materials no longer report generic unsupported render-surface diagnostics.
- Material cache coverage for palette index range diagnostics.

Decisions:

- P8 uses a one-channel unsigned-byte texture (`RedFormat`). Index16 uses
  two-channel byte packing (`RGFormat`) with low and high source bytes preserved
  in little-endian order. This avoids depending on integer texture sampler
  support before shader work.
- Indexed textures use `NoColorSpace` because they are index data, not color
  data.
- CPU max-index scanning is part of resource creation diagnostics. It is bounded
  to already prepared source bytes and does not bake indexed textures into RGBA.
- Phase 3 intentionally kept rendering as a placeholder. Phase 4 replaces the
  temporary `indexed-texture-shader-pending` state with real indexed material
  creation when index and palette resources are valid.

Course corrections:

- Phase 3 partially implements the palette-selection semantics originally
  listed in Phase 5 because indexed resource validation cannot produce useful
  diagnostics without knowing whether the base palette comes from the material
  recipe or render surface default.
- `WorldMaterialResourceCache.getPaletteResource()` has its first real consumer
  in indexed diagnostics and material creation.

Cleanup targets:

- Direct-color and compressed texture creation was split out of
  `material-resources.ts` after Phase 6. Phase 4 isolated shader code first,
  then the cleanup pass moved the stable upload path behind a focused module.
- `indexed-texture-shader-pending` has been removed for valid resources. Future
  shader capability failures should use a different explicit diagnostic.
- Material cache signatures now include render-surface and palette prepared
  resource details such as format, dimensions, source byte length, default
  palette, palette ID, and color count.

## Phase 4: Indexed Material Shader

Status: complete as of 2026-05-25.

Add a material path that samples an index texture and palette texture.

Requirements:

- Preserve standard lighting enough for static objects to remain visually
  coherent with direct-color/DXT materials.
- Support material opacity from `CSurface.translucency`.
- Support clipmap behavior for `SurfaceType.Base1ClipMap`: indices under 8
  should discard or alpha out, matching reference behavior.
- Use nearest sampling for index and palette textures.
- Keep material cache signatures aware of:
  - material asset ID
  - render surface asset ID
  - palette asset ID
  - base palette resource signature
  - format (`P8` or `Index16`)
  - prepared asset timestamps/provenance

Implementation options:

- Patch `MeshStandardMaterial` with `onBeforeCompile` to replace diffuse map
  sampling with palette lookup. This keeps lighting and fog behavior.
- Use a custom `ShaderMaterial` only if the patch path becomes too brittle.

Preferred first attempt:

- `MeshStandardMaterial` plus `onBeforeCompile`.
- Keep shader patching isolated in small functions with tests around material
  classification/cache behavior. Do not snapshot large generated shader text.

Implementation cleanup before this phase:

- Split direct-color, compressed, and indexed texture resource creation into
  separate helpers/modules. `material-resources.ts` should orchestrate resource
  selection, not own every pixel-format implementation.

Implemented changes:

- Added `apps/holtburger-3d/src/lib/world-display/indexed-materials.ts` to keep
  indexed shader patching isolated from material resource selection.
- Added a `MeshStandardMaterial` path for valid indexed resources. It uses the
  indexed texture as the material map to get Three's standard UV plumbing, then
  replaces the map fragment with palette lookup logic.
- The fragment shader reconstructs P8 indices from the red channel and Index16
  indices from little-endian byte-packed red/green channels.
- The fragment shader samples the one-row palette texture using
  `(paletteIndex + 0.5) / paletteColorCount`.
- `SurfaceType.Base1ClipMap` (`0x4`) discards indices below 8 in the shader.
- Indexed materials keep standard lighting, flat shading, roughness/metalness,
  and legacy translucency opacity behavior from the existing material path.
- Valid indexed materials no longer emit `indexed-texture-shader-pending` or
  fall back to placeholder colors.

Validation added:

- Unit coverage proving indexed material creation wires a `MeshStandardMaterial`
  with indexed texture map metadata.
- Unit coverage proving the shader patch injects palette uniforms, Index16
  reconstruction, palette texture sampling, and clip discard behavior.
- Unit coverage for `Base1ClipMap` flag detection.
- Material resource coverage proving valid indexed materials produce a real
  mapped material and no generic unsupported-format diagnostic.

Decisions:

- Stayed with `MeshStandardMaterial.onBeforeCompile` instead of a custom
  `ShaderMaterial`. This preserves Three's standard lighting path and keeps the
  indexed behavior scoped to diffuse map sampling.
- Indexed materials are marked transparent. Palette alpha and clipmap discard
  can affect output, and this is the safer first visual parity choice. Sorting
  cost can be revisited after visual validation.
- The shader uses normalized unsigned-byte texture samples and rounds back to
  bytes with `floor(channel * 255.0 + 0.5)`. This matches the Phase 3 byte-packed
  resource representation without requiring integer samplers.
- The shader patch uses a local minimal shader interface because the installed
  Three package does not export a `Shader` type.

Course corrections:

- The direct-color/compressed texture split was deferred. Shader code landed in
  a separate module, which kept the Phase 4 diff focused without moving stable
  direct-color and DXT behavior.
- Phase 5's base palette threading is effectively complete for the foundation
  path because Phase 4 consumes the selected palette resource.

Cleanup targets:

- Run browser smoke validation on real `Index16` samples and compare against
  ACViewer where possible. Unit tests verify shader wiring, not final visual
  parity.
- If transparent indexed materials cause avoidable sorting artifacts, refine
  transparency flags using `SurfaceType` and palette alpha observations from
  real content.
- Direct-color and compressed texture resource creation now lives in
  `render-surface-texture-resources.ts`.

## Phase 5: Base Palette Selection Semantics

Status: complete for foundation base indexed materials as of 2026-05-25.

Resolve which palette an indexed material should use.

Foundation precedence:

1. `CSurface.orig_palette_id` when non-zero.
2. `RenderSurface.defaultPaletteId`.
3. Diagnostic fallback if no palette can be resolved.

Diagnostics:

- `indexed-texture-palette-missing`: no palette ID can be derived.
- `indexed-texture-palette-unprepared`: palette ID exists but asset is not
  prepared.
- `indexed-texture-palette-empty`: palette prepared with zero colors.
- `indexed-texture-index-out-of-range`: source indices exceed palette length.

Do not collapse these into `unsupported-render-surface`.

Implemented changes:

- `selectIndexedPalette()` now returns the selected palette asset ID, raw
  palette ID, and selection source.
- Selection source is either `material-recipe` for `CSurface.orig_palette_id` or
  `render-surface-default` for `RenderSurface.defaultPaletteId`.
- Indexed material diagnostics now include `paletteId` and `paletteSource` when
  a palette ID was selected but the palette is unprepared, empty, resource
  creation failed, or source indices exceed palette length.
- Missing palette selection remains a separate diagnostic with recipe/default
  palette fields so "no palette ID exists" is not confused with "palette asset
  is not prepared."

Validation added:

- Unit coverage for material recipe palette precedence with selection source.
- Unit coverage for render surface default palette fallback with selection
  source.
- Unit coverage for no-selection fallback.
- Material resource coverage for `indexed-texture-palette-missing`.
- Material resource coverage that range diagnostics carry `paletteSource`.

Decisions:

- Keep the foundation precedence narrow: base `CSurface.orig_palette_id`, then
  `RenderSurface.defaultPaletteId`. ObjDesc palette changes and subpalettes
  remain explicitly out of scope for this foundation pass.
- Use selection-source strings now because the later legacy material parity push
  will need to distinguish base palette choices from derived palette views.

Course corrections:

- Phase 5 had behavior from earlier phases, but the selection result did not
  carry enough provenance. This phase made the behavior explicit and testable
  instead of only returning a string asset ID.
- The asset-ID-only `selectIndexedPaletteAssetId()` wrapper was removed during
  cleanup because it became a hollow convenience shim once all callers needed
  source provenance.

Cleanup targets:

- When derived palette views are introduced, replace `paletteAssetId`-only
  material signatures with a palette-view signature that includes base palette,
  subpalette replacements, and prepared source state.
- Phase 6 diagnostics should summarize selection source counts so the Debug
  panel can distinguish recipe palettes from render-surface default palettes.

Remaining work:

- Extend beyond this base precedence only in the later legacy material parity
  push, where derived palette views and subpalette replacement are introduced.

## Phase 6: Diagnostics And Debug UI

Status: complete as of 2026-05-25.

Extend current material diagnostics so the Debug panel can answer:

- Number of indexed recipes visible.
- Number of indexed recipes with prepared base/default palettes.
- Number of indexed surfaces using `P8` vs `Index16`.
- Missing/unprepared palette samples.
- Index range errors.

Console warnings should be coalesced like current material diagnostics.

Do not write tests for debug-only logging. Test the pure diagnostic summary
helpers and material classification behavior instead.

Implemented changes:

- Extended `describeMaterialAssetDiagnostics()` with indexed-material summary
  data in the existing Debug panel Materials row.
- Added visible indexed recipe counts when a browser destination is active, with
  prepared indexed recipe counts as the destination-less diagnostic fallback.
- Added prepared indexed surface counts split by `P8` and `Index16`.
- Added palette-selection counts split by material recipe palette,
  render-surface default palette, and missing palette selection.
- Added prepared indexed palette count plus samples for missing palette assets,
  empty palettes, and index range errors.
- Reused the Phase 5 palette selection helper so diagnostics report the same
  base/default semantics the renderer uses.

Validation added:

- Unit coverage for indexed recipe counts.
- Unit coverage for P8 and Index16 surface counts.
- Unit coverage for material-recipe and render-surface-default palette source
  counts.
- Unit coverage for empty palette samples.
- Unit coverage for index range error samples.

Decisions:

- Keep Phase 6 in the existing Materials row instead of adding a new Debug panel
  section. The indexed summary is still part of material pipeline health, and
  this avoids extra UI surface before visual smoke testing.
- Keep console warning behavior unchanged. Coalesced material console warnings
  already come from material resource diagnostics; Phase 6 only summarizes
  prepared asset state for the panel.
- Count "indexed recipes" from the full visible material set when a browser
  destination is active. Without a destination, count prepared indexed recipes as
  a diagnostics fallback.

Course corrections:

- `scene-asset-request-planner.ts` now exposes full visible material asset IDs,
  so the Debug row no longer has to infer visibility from prepared assets only.

Cleanup targets:

- Phase 7 should confirm the panel reports zero generic
  `unsupported-render-surface` indexed failures when real indexed materials have
  valid palettes.

## Phase 7: Validation Fixtures

Use real content IDs from screenshots and references as fixtures.

Known current samples:

- `render-surface/0600425d` uses `Index16`.
- `render-surface/06004188` uses `Index16`.
- `render-surface/06004189` uses `Index16`.

Validation should include:

- Unit tests for palette DTO round-trip.
- Unit tests for P8 and Index16 source length validation.
- Unit tests for palette selection precedence.
- Renderer/material tests proving indexed materials create indexed resources
  rather than fallback materials.
- Browser smoke test with material diagnostics showing no
  `unsupported-render-surface` for indexed formats when palettes are prepared.

Manual visual validation:

- Compare a known indexed object against ACViewer where possible.
- Confirm DXT materials continue rendering.
- Confirm direct-color materials continue rendering.
- Confirm fallback diagnostics remain actionable when a palette is intentionally
  missing.

## Suggested Implementation Order

1. Debug panel indexed-material summary.
2. Browser smoke validation against real P8/Index16 content.
3. Split material resource helpers before broader material parity work.

This order keeps the contract changes reviewable before shader work, and it
lets us verify data availability before changing broader render grouping or
appearance behavior.

## Follow-Up: Legacy Material Parity Push

Do not hide broader material parity work inside the indexed texture foundation.
Track it as a separate implementation push after base indexed rendering works.

Scope for the follow-up:

- Route static setup model parts through prepared `setup-appearance` payloads
  when available.
- Preserve texture swaps already resolved by the content material graph.
- Carry `paletteId` and `subPalettes` into renderer-level palette view
  signatures.
- Implement derived palette views for per-appearance subpalette replacement.
- Update `materialSignature` to include palette-view identity.
- Implement `PaletteSet`/clothing/skin/hair/dye selection once runtime object
  appearance data requires it.
- Tighten `SurfaceType.Base1ClipMap` parity beyond the minimum needed by indexed
  texture rendering.
- Add terrain `TexMerge`, high-res JPEG replacement, and fuller
  `CSurface.diffuse`/`luminosity` semantics.

Suggested parity order:

1. Setup appearance routing.
2. Derived palette views for subpalette replacement.
3. Texture swap parity across setup appearances.
4. Clipmap parity and material scalar behavior.
5. Terrain `TexMerge`.
6. High-res JPEG replacement path.

## Risks

- Three shader patching can be fragile across Three upgrades. Keep shader edits
  narrow and isolated.
- `Index16` precision can break if implemented through normalized float samples.
  Prefer byte packing or integer sampling.
- Instancing efficiency may drop when palette views split batches. Correctness
  should win first in the later parity push; optimize grouping after visual
  parity.
- Palette/subpalette cache keys can become stale if they ignore prepared asset
  timestamps or failed provenance. Subpalette cache keys are a follow-up parity
  concern, not a foundation blocker.
- Baking RGBA as an interim shortcut can mask missing appearance semantics. If a
  temporary fallback is added, keep diagnostics explicit so it does not become
  the accepted path.

## Completion Criteria

The indexed material work is complete when:

- Palette assets are lossless in the browser.
- `P8` and `Index16` render surfaces no longer report generic unsupported-format
  warnings when valid palettes are prepared.
- Indexed materials render through palette lookup, not baked RGBA diffuse maps.
- Missing palette and invalid index data produce specific diagnostics.
- Existing direct-color and DXT material paths remain green under tests and
  manual browser smoke checks.
