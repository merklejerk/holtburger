# Holtburger 3D Full Palette Texture Simplification Plan

## Goal

Replace palette range-strip plumbing with full-domain palette textures: `16x16`
for `index8` and `256x256` for `index16`, deduped by final composed pixel
content.

## Context

The current palette path supports `firstIndex` and `indexCount` on palette
texture uses, but the production planner normally emits the whole palette range
anyway. That leaves us with range-aware keys, shader offset math, and atlas
semantics that imply an optimization we do not actually use. The cleaner model
is dumb on purpose: an index value maps directly to a texel in a full palette
domain.

In scope:

- Remove palette texture range identity from renderer-facing palette uses.
- Represent prepared palette textures as fixed square RGBA domains.
- Deduplicate palette atlas entries by final composed RGBA pixels.
- Move palette composition out of main-thread TypeScript if the host route can
  be made narrow and typed.

Out of scope:

- Changing AC palette asset parsing semantics.
- Discovering used index ranges by scanning indexed textures.
- Terrain `TexMerge` parity or broader material scalar parity.
- Backwards-compatible support for palette strip uploads.

## North Stars

Use these as review criteria while executing the plan. If a phase starts
violating them, resteer the phase instead of adding compatibility glue.

1. Full-domain palette textures are the only renderer-facing model.
   New code should treat `index8` as a `16x16` RGBA texture and `index16` as a
   `256x256` RGBA texture. Do not preserve strip-shaped palette textures as a
   second upload path, fallback path, or test-only mode.
2. Clean cutovers beat compatibility shims.
   Once a producer emits the new prepared palette use shape, update its
   downstream consumers in the same cutover. Do not support both
   `palette-texture-use` range strips and full-domain prepared palette uses in
   long-lived production code.
3. Delete old semantics, not just old names.
   Removing `firstIndex`, `indexCount`, and `paletteFirstIndex` is not enough if
   equivalent range-offset behavior survives under new field names. Indexed
   values must map directly to palette texels.
4. Resolver identity is logical, host identity is recipe-bearing, atlas identity
   is content-based.
   Keep those three identities separate. Resolver keys bind materials. Host
   route ids describe the recipe Rust must compose. Atlas dedupe keys come from
   final RGBA content hash and dimensions.
5. Rust owns AC palette composition.
   Browser code may request a prepared palette and consume RGBA bytes, but it
   should not clone base palettes, apply sub-palette replacement ranges, or
   perform ARGB-to-RGBA conversion.
6. Tests must defend the new contract.
   Yeet ossified tests that only prove range strips still work. Replace them
   with tests for full-domain dimensions, replacement validation, composition
   order, content-hash dedupe, and shader coordinate mapping.
7. No quiet fallbacks.
   Missing palettes, invalid replacement ranges, unsupported palette domains,
   and malformed prepared palette routes should fail loudly with enough context
   to identify the bad asset or recipe.
8. Prefer less palette-specific texture machinery.
   After preparation, palette textures should look like ordinary RGBA sources to
   packing and upload code. Palette-specific logic should be limited to recipe
   construction, host composition, and shader sampling from indexed materials.

## Ground Truth

Reference files:

- `crates/holtburger-dat/src/file_type/material.rs`
- `apps/holtburger-3d/src-tauri/src/adapter/prepared_texture.rs`
- `apps/holtburger-3d/src/lib/assets/preparation/prepared-texture-source.ts`
- `apps/holtburger-3d/src/lib/textures/texture-manager.ts`
- `apps/holtburger-3d/src/lib/textures/placement.ts`
- `apps/holtburger-3d/src/lib/textures/sampling-policy.ts`
- `apps/holtburger-3d/src/lib/visual/object-visual-material-planner.ts`
- `apps/holtburger-3d/src/lib/visual/object-visual-source-bundle-producer.ts`
- `apps/holtburger-3d/src/lib/static/bake/static-material-adapter.ts`
- `apps/holtburger-3d/src/lib/dynamic/visual-baker.ts`
- `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.ts`
- `docs/plans/holtburger-3d-indexed-palette-materials-plan.md`

Design rule:

- `index8` palettes are `16x16` RGBA textures.
- `index16` palettes are `256x256` RGBA textures.
- Palette texels not backed by loaded palette colors are transparent black.
- Sub-palette entries are replacement instructions, not standalone assets. Each
  entry references a normal `0x04...` Palette asset plus an `offset` and
  `numColors` range.
- Replacement palette ranges are applied before hashing and upload.
- Prepared palette texture content hashes use FNV-1a 64-bit, matching the
  existing prepared texture source hash implementation.
- Resolver-authored logical texture keys identify the recipe, not the expanded
  palette colors. They may include compact replacement triples
  `{paletteId, offset, count}` or a deterministic recipe digest, but must never
  embed palette table contents.

## Dry-Run Findings

This plan was dry-run against the current code before implementation. The
following items are not optional; they are the concrete integration points that
will otherwise drag range-strip behavior back in through the side door.

1. Use a binary virtual host route, not a loose bridge function.
   `apps/holtburger-3d/src-tauri/src/adapter/service.rs` already intercepts
   `prepared-texture/` inside `asset_lookup_binary_batch()` before ordinary
   `ContentAssetRequest` dispatch. `prepared-palette-texture/` should follow
   that pattern so RGBA bytes use the binary envelope.
2. Add the route to both route systems.
   TypeScript needs `HostAssetKeyKind`, `HEX32_ROUTE_KINDS`-adjacent
   normalization, `formatHostAssetId()`, `parseHostAssetId()`,
   `usesBinaryAssetLookup()`, and `prepareV2AssetPayload()`. Rust needs a parser
   beside `parse_prepared_texture_asset_id()`.
3. Keep route ids compact.
   The route may encode `base`, `domain`, and replacement triples like
   `repl=04000100:16:32,04000110:64:16`. It must never encode palette table
   contents. A 65k-color replacement is still one triple: `04000100:0:65536`.
4. Replace the TypeScript palette data-use type, do not mutate it in place.
   `MaterialTextureDataUseIdentity` currently has `palette-texture-use` with
   `firstIndex`, `indexCount`, and `subPalettes`. Introduce a full-domain
   prepared palette texture use shape, then delete the range shape in cleanup.
   The `rg` dry run found live references in texture placement, sampling policy,
   dynamic visual baking, static material adapters, runtime serialization, and
   object/structured source bundle producers.
5. Object visual recipe ids are already dense numeric ids.
   `object-visual-source-bundle-producer.ts` registers string recipe keys into
   `ObjectVisualTextureRecipeId`. Keep the string recipe key compact; downstream
   material recipes should continue to reference numeric recipe ids.
6. Material table entries still carry `paletteFirstIndex`.
   Remove it from `StaticMaterialTableEntry`,
   `ObjectVisualMaterialRecipeBase`, recipe publication, object/structured
   bakers, `webgl2-object-material-payloads.ts`, and the indexed shader in
   `webgl2-renderer.ts`.
7. Content-hash dedupe cannot happen in the resolver.
   The resolver does not have pixels yet. It creates logical binding ids and
   prepared palette route requests. The texture manager receives the prepared
   payload, reads `contentHash`, and aliases physical atlas entries by content
   key.
8. `ContentDecodeCache` does not cache palettes today.
   Add a `Palette` LRU before implementing the prepared palette route, then use
   it from both `ContentAssetService::Palette` and prepared palette composition.

## Progress Log

- Completed implementation-order step 1 before numbered Phase 1. This is an
  intentional steering choice from the dry run: source palette decode caching is
  prerequisite infrastructure for the prepared palette route, so it lands before
  the host contract even though the later phase headings list the route first.
- Completed the prepared palette texture host contract surface: Rust route
  parsing/formatting, Rust binary payload serialization, TypeScript host key
  handling, TypeScript payload schema, binary lookup classification, and binary
  envelope hydration tests.
- Completed Rust prepared palette composition and runtime serving:
  `prepared-palette-texture/` now loads decoded source palettes through
  `ContentAssetRuntime`, applies replacement ranges in Rust, emits full-domain
  RGBA pixels, hashes the final renderer payload identity, and serializes pixels
  through the binary envelope.
- Completed the generated prepared palette texture cache. The host adapter now
  checks a bounded recipe-keyed cache before loading palettes and composing
  renderer-ready RGBA payloads.
- Completed the frontend palette data-use cutover and pulled the texture upload
  portion of Phase 5 into the same change. Renderer-facing material data uses
  now emit `prepared-palette-texture-use` with a full `index8`/`index16` domain
  and compact replacement triples. Texture staging requests
  `prepared-palette-texture/` binary payloads and consumes host-composed RGBA
  bytes instead of loading `palette/` payloads and composing in TypeScript.
- Completed physical palette atlas dedupe by prepared content. Texture registry
  entries now keep logical texture keys for material binding while using a
  separate physical source key for atlas reuse. Prepared palette sources alias
  by `rgba8:{width}x{height}:bytes:{byteLength}:hash:{contentHash}`.
- Completed material/shader range metadata removal. `paletteFirstIndex` and
  `uMaterialPaletteFirstIndices` are gone from shared material tables, object
  visual recipes, WebGL payload uniforms, and tests. Indexed shaders now map
  palette indices directly into `16x16` or `256x256` palette domains.
- Completed cleanup verification. Exact old range-strip symbol greps are clean
  except the shader test that asserts `uMaterialPaletteFirstIndices` is absent.
  Final cleanup also removed stale exported helpers/types surfaced by
  `lint:dead` after the palette cutover.
- Final verification passed for TypeScript tests/checks, app lint, Rust
  check/clippy, Tauri tests, and content/core library tests. Python lint was not
  run because no Python files were touched.

## Decisions And Course Corrections

- `ContentDecodeCache` now owns decoded source `Palette` records, while prepared
  palette textures remain explicitly out of that cache. This keeps the two cache
  layers clean: source DAT/HBA decode reuse in `holtburger-content`, generated
  renderer-ready RGBA reuse later in the host adapter.
- Ordinary `ContentAssetService::Palette` loads now go through
  `ContentDecodeCache::palette(...)`. The future prepared palette route should
  use the same method instead of adding another direct `Palette::unpack` path.
- Runtime interception in `asset_lookup_binary_batch()` moves from the contract
  phase to the composition phase. Serving `prepared-palette-texture/` requires
  real composed pixels; wiring it before composition would either create a fake
  payload path or a loud-but-useless not-implemented route.
- Browser palette composition removal moves to the frontend cutover phase. The
  old `prepareDirectPaletteTextureSource()` path is still needed until texture
  manager/material producers request `prepared-palette-texture/`; deleting it
  earlier would break the only active path instead of creating a clean cutover.
- Prepared palette texture caching is intentionally separate from
  `ContentDecodeCache`. The cache key is the normalized recipe; the cached value
  is final RGBA pixels, dimensions, and content hash.
- Phase 4 and the host-fetch portion of Phase 5 are intentionally combined. A
  pure data-use rename would have preserved the old browser composition path for
  another phase, which would violate the clean-cutover north star and keep tests
  defending range-strip uploads.
- Setup/authored palette view ranges remain in source facts as replacement
  instructions. They are not palette texture use ranges and should continue to
  be named and reviewed as replacement recipe inputs.
- `object-visual-baker.ts` now normalizes raw `null` material variant
  signatures to the canonical `base` signature when resolving material
  bindings. This was exposed by the palette cutover tests and fixes a real
  binding mismatch instead of papering over the fixture.
- Atlas dedupe now separates resolver identity from physical identity in the
  texture manager. Non-palette sources keep their logical data-use key as the
  physical key; prepared palette sources use the host-provided final content
  hash plus dimensions and byte length. This preserves cheap collision-tolerant
  dedupe without allowing hash-only ids to leak back into resolver recipes.
- Shader palette-domain selection uses the indexed texture format already
  carried by each material slot: `p8` samples a `16x16` palette and `index16`
  samples a `256x256` palette. No range offset is available to subtract.

## Debt And Spicy Bits

- The numbered phase ordering is slightly misleading because the concrete
  implementation order starts with source palette caching. If this plan is
  edited again, consider splitting the current Phase 2 into a Phase 0/1 cache
  foundation and a later composition phase. Not doing that now avoids a noisy
  plan restructure mid-stream.
- `usesBinaryAssetLookup()` now recognizes `prepared-palette-texture/` before
  the Tauri runtime serves it. No production planner emits that route yet, so
  this is acceptable as a contract-only phase, but the composition phase must
  wire the Rust runtime before any frontend producer starts requesting it.
- Full `npm run lint:ts` currently fails on unrelated unused-symbol debt in
  static coordinator, env-cell baker, and static object baker files. Touched-file
  ESLint for this contract phase is clean; do not conflate that existing lint
  debt with palette route work unless the next phases touch those files.
- `prepare_palette_texture()` remains a pure composer and does not own caching.
  Keep it that way; generated payload reuse belongs to the host adapter cache,
  not `ContentDecodeCache`.
- Concurrent identical prepared palette requests can still race and compose
  twice on a cold miss because the cache lock is not held across async palette
  loads. This avoids blocking the cache mutex across awaits. If measurement says
  this matters, add an in-flight shared future map beside the cache rather than
  moving generated payloads into `ContentDecodeCache`.
- Full `npm run lint:ts` still fails on unrelated unused-symbol debt in static
  coordinator, env-cell baker, and static object job baker files. The current
  touched-file ESLint set is clean.
- Texture manager diagnostics now count unique physical source keys, not
  logical palette recipes. That matches the atlas behavior after content-hash
  aliasing; logical recipe diversity remains visible through texture-use ids and
  bindings rather than page source counts.
- The final cleanup intentionally removed unrelated but now-visible dead exports
  in static coordinator/runtime overview/static material helper code so the
  project lint gates can pass without carrying local caveats.

## Implementation Order

This is the intended execution order. Do not start by changing the shader; the
renderer can only be simplified after every producer emits full-domain palette
uses.

1. Add source palette caching in Rust.
   Update `crates/holtburger-content/src/decode_cache.rs` first:
   import `Palette`, add `PALETTE_CAPACITY`, add a `palettes` LRU field, and add
   `ContentDecodeCache::palette(...)`. Then update
   `crates/holtburger-core/src/content_assets.rs` so
   `ContentAssetRequest::Palette` uses the cache.
2. Add the prepared palette route contract without using it yet.
   Add Rust parsing/building/serialization and TypeScript key/schema/binary
   hydration. At the end of this step,
   `prepared-palette-texture/...` should round-trip in tests but no material
   planner should emit it yet.
3. Move palette composition into the route.
   Implement base palette load, normalized replacement application, padding,
   ARGB-to-RGBA conversion, FNV-1a hashing, and prepared recipe caching behind
   `prepared-palette-texture/`.
4. Replace the frontend palette use model.
   Introduce the full-domain data-use shape and update object, dynamic, static,
   structured interior, runtime serialization, placement, sampling, and texture
   manager paths to consume it. This is the highest-churn step and should be the
   only step where many TypeScript tests are rewritten.
5. Change texture upload/dedupe.
   Make palette sources fetch prepared palette binary payloads and alias physical
   atlas entries by `rgba8:{width}x{height}:{contentHash}` while preserving
   logical recipe ids for material binding.
6. Remove renderer range metadata.
   Delete `paletteFirstIndex` fields/uniforms and shader offset math only after
   every material table producer has stopped publishing them.
7. Run cleanup greps and full verification.
   Delete obsolete range-strip tests instead of updating them to preserve legacy
   behavior.

Step gates:

- After step 1: Rust tests around `ContentDecodeCache::palette` and
  `ContentAssetService::Palette` pass.
- After step 2: route/key/binary envelope tests pass; no producer emits the new
  route yet.
- After step 3: prepared palette route tests prove dimensions, padding,
  replacement order, hash input, and recipe-cache reuse.
- After step 4: TypeScript compiles with the old `palette-texture-use` shape
  removed from public contracts.
- After step 5: texture manager tests prove logical ids can differ while the
  physical atlas rect aliases by content hash.
- After step 6: shader/payload tests prove there is no palette offset uniform or
  index subtraction.

## Phase 1: Add The Prepared Palette Texture Host Contract

Deliverables:

- Add `PreparedPaletteTextureDomain = Index8 | Index16`,
  `PreparedPaletteReplacement`, `PreparedPaletteTextureRequest`,
  `PreparedPaletteTexturePayload`, and route parsing/formatting in a new Rust
  module, likely `apps/holtburger-3d/src-tauri/src/adapter/prepared_palette_texture.rs`.
- Route format:
  `prepared-palette-texture/{basePaletteHex}?domain=index8|index16&repl={palette}:{offset}:{count},...`.
  Omit `repl` for no replacements. The `repl` value is a compact replacement
  instruction list, not color data. Under the current host contract,
  `AssetLookupRequestDto` only carries `assetId`, so the full recipe must be
  recoverable from this route unless a separate recipe registry API is added.
- Add `PreparedPaletteTexturePayloadDto` and schema in
  `apps/holtburger-3d/src/lib/host/contracts.ts`.
- Add `"prepared-palette-texture"` to `HostAssetKeyKind` and teach
  `apps/holtburger-3d/src/lib/assets/keys.ts` to keep its query route id as a
  normalized string, like `prepared-texture`.
- Add the route to `usesBinaryAssetLookup()` in
  `apps/holtburger-3d/src/lib/host/tauri.ts`.
- Add the route parser/schema to
  `apps/holtburger-3d/src/lib/assets/preparation/route-payloads.ts`.
- Add binary serialization support beside
  `serialize_prepared_texture_binary_response()` in
  `apps/holtburger-3d/src-tauri/src/adapter/binary.rs`.

Acceptance criteria:

- The contract has no `firstIndex` or `indexCount`.
- The content hash is computed in Rust using FNV-1a 64-bit over the final
  renderer payload identity: `rgba8`, width, height, and composed RGBA bytes.
- The request shape is deterministic so identical recipes can still share host
  work before content-level dedupe.
- TypeScript creates deterministic recipe requests and consumes the returned
  `contentHash`; TS resolvers do not recompute palette content hashes.
- Logical texture-use ids remain available before host preparation. They should
  be bounded recipe identifiers used for material binding and placement
  bookkeeping, not final content-dedupe keys.
- Resolver keys must not be serialized as expanded color data. If the compact
  replacement triple list is too long for a practical logical key, use a digest
  for frontend logical ids only. Do not use a digest-only host asset id unless
  the implementation also adds a typed recipe registry that lets Rust resolve
  the digest back to the full recipe.
- Binary envelope hydration returns `pixels: Uint8Array` for the prepared
  palette payload.
- Unit tests cover route formatting/parsing on both Rust and TypeScript sides:
  `apps/holtburger-3d/src-tauri/src/adapter/prepared_palette_texture.rs`,
  `apps/holtburger-3d/src/lib/assets/keys.test.ts`,
  `apps/holtburger-3d/src/lib/assets/preparation.test.ts`, and
  `apps/holtburger-3d/src/lib/host/binary-asset-envelope.test.ts`.

## Phase 2: Add Rust Palette Decode Cache And Composition

Deliverables:

- Add `Palette` to `ContentDecodeCache` and route ordinary
  `ContentAssetService::Palette` loads through it.
- Add `PALETTE_CAPACITY` to `crates/holtburger-content/src/decode_cache.rs`.
  Use an LRU sized for broad reuse; start with `8_192` unless measurement says
  otherwise.
- Implement `ContentDecodeCache::palette(&self, content, palette_id)`.
- Add `palettes: Mutex<SimpleLru<u32, Palette>>` to `LruDecodedRecordCache`.
- Update `crates/holtburger-core/src/content_assets.rs`
  `ContentAssetRequest::Palette` to call `decode_cache.palette(...)`.
- Implement composition in Rust:
  load the base palette, load replacement palette assets referenced by
  replacement entries, copy `offset..offset+count`, expand/pad to full domain,
  convert ARGB to RGBA, emit `pixels`.
- Extend `LoadedBinaryAsset` in
  `apps/holtburger-3d/src-tauri/src/adapter/service.rs` with a prepared palette
  variant and intercept the new route before
  `content_asset_request_from_asset_id()`.
- Normalize replacement order before composition and cache lookup. Use the same
  deterministic order everywhere: `offset`, then `count`, then `paletteId`.

Acceptance criteria:

- Repeated base and replacement palette lookups reuse decoded `Palette` records
  through `ContentDecodeCache`.
- Missing palettes and invalid sub-palette ranges fail loudly.
- `index8` output is always `16x16`.
- `index16` output is always `256x256`.
- Existing palette binary payload loading remains lossless.
- Tests prove `ContentAssetService::Palette` reuses the new decode cache.
- Tests prove composition applies replacements before padding and hashing.
- Tests prove replacement validation rejects `offset + count` outside either
  the replacement palette or destination domain.

## Phase 3: Add Prepared Palette Texture Caching

Deliverables:

- Add a prepared palette texture cache to the host adapter/service layer, keyed
  by normalized recipe: index domain, base palette id, and ordered replacement
  entries.
- Add test-only instrumentation or a narrow injected composer dependency so
  cache reuse can be asserted without relying on timing.
- Put the cache near the prepared palette builder, not in `ContentDecodeCache`.
  `ContentDecodeCache` caches decoded source records; this cache stores
  renderer-ready generated assets.
- Store the final RGBA bytes, dimensions, and FNV-1a 64 content hash.
- Keep this separate from `ContentDecodeCache`: decoded palette caching avoids
  DAT/HBA reads and parsing; prepared texture caching avoids recomposition,
  padding, hashing, and binary payload assembly.

Acceptance criteria:

- The same recipe does not repeatedly compose or hash palette pixels.
- Different recipes that produce identical pixels still dedupe later by content
  key in the texture atlas.
- Cache keys use normalized replacement order so equivalent requests do not
  fragment the prepared cache.
- Tests issue the same `prepared-palette-texture/` request twice and prove only
  one composition happens.

## Phase 4: Replace Palette Data-Use And Logical Keys

Deliverables:

- Replace `palette-texture-use` in `MaterialTextureDataUseIdentity` with a
  full-domain prepared palette texture use. The new shape must carry:
  - base palette id
  - domain: `index8` or `index16`
  - normalized replacement entries
  - usage: `palette-rgba`
- Update the related contract types in:
  - `apps/holtburger-3d/src/lib/static/contracts.ts`
  - `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`
  - `apps/holtburger-3d/src/lib/visual/object-visual-source-payload.ts`
  - `apps/holtburger-3d/src/lib/visual/object-visual-recipe-bundle.ts`
- Update palette planning in:
  - `apps/holtburger-3d/src/lib/visual/object-visual-material-planner.ts`
  - `apps/holtburger-3d/src/lib/visual/object-visual-source-bundle-producer.ts`
  - `apps/holtburger-3d/src/lib/static/env-cells/bake/structured-interior-visual-bundle-producer.ts`
  - `apps/holtburger-3d/src/lib/static/bake/static-material-texture-policy.ts`
  - `apps/holtburger-3d/src/lib/static/bake/static-material-adapter.ts`
  - `apps/holtburger-3d/src/lib/static/bake/static-material-plan-primitives.ts`
  - `apps/holtburger-3d/src/lib/static/objects/bake/static-object-renderability.ts`
  - `apps/holtburger-3d/src/lib/dynamic/visual-baker.ts`
  - `apps/holtburger-3d/src/lib/textures/placement.ts`
  - `apps/holtburger-3d/src/lib/textures/sampling-policy.ts`
  - `apps/holtburger-3d/src/lib/textures/texture-manager.ts`
- Audit the current object-visual texture recipe keys, static material binding
  keys, and texture placement source keys so palette recipe identity is carried
  as a compact logical id. Do not thread expanded palette colors or per-index
  color strings through resolver outputs.
- Remove palette `firstIndex`/`indexCount` from object visual texture recipe
  sources in `object-visual-recipe-bundle.ts`.
- Create one helper for normalized palette recipe keys and reuse it from object,
  structured interior, static material policy, and texture manager paths.
- Make palette direct sources look like ordinary RGBA texture sources to the
  packer.
- Remove or shrink `prepareDirectPaletteTextureSource()` so browser code no
  longer owns AC-specific palette composition rules.

Acceptance criteria:

- Host request ids may carry the normalized recipe when small enough, but the
  canonical renderer/binding id should stay compact. If normalized replacement
  lists prove too large, introduce a recipe digest for frontend logical ids and
  keep the host asset id recipe-bearing unless a typed recipe registry is added.
- No logical key contains palette color table contents.
- `createMaterialTextureDataUseKey()` no longer mentions range strips.
- Existing object/structured texture recipe id tests are updated to assert
  compact prepared palette keys.
- `rg -n "palette-texture-use|firstIndex.*palette|indexCount.*palette" apps/holtburger-3d/src/lib`
  has no hits except fields that are explicitly setup/sub-palette replacement
  ranges.

## Phase 5: Deduplicate Physical Palette Atlas Entries By Content

Deliverables:

- Change `prepareDirectMaterialTextureSource()`/texture-manager palette staging
  so palette sources request `prepared-palette-texture/` rather than `palette/`
  plus replacement palette payloads.
- Add a direct source shape for prepared palette textures, or reuse
  `DirectRgbaTextureSource` if the payload can be validated as `rgba8`.
- Teach `TextureManager` to create a physical content key for palette prepared
  payloads: `rgba8:{width}x{height}:{contentHash}`.
- Use the content key in `findRegistryEntryBySource()` or an adjacent alias map
  so different logical texture-use ids can point to the same atlas rect when
  final pixels match.
- Update source equality helpers in `texture-manager.ts` and palette sizing in
  `placement.ts`; they should compare full-domain prepared palette recipe
  identity for logical bookkeeping and content hash for physical atlas reuse.
- Keep logical `textureUseId -> TextureBinding` recording intact so materials
  still bind through their original recipe-level ids.

Acceptance criteria:

- Same final composed palette pixels alias to one atlas entry, even if produced
  by different recipes.
- Different final composed palette pixels never alias just because recipe ids
  match.
- Palette atlas packing does not special-case 1-row palette strips.
- Texture placement receives or derives content keys from prepared palette
  payload metadata, not from resolver-side palette recipe strings.

## Phase 6: Simplify Material And Shader Payloads

Deliverables:

- Remove `paletteFirstIndex` from material table entries and renderer uniforms.
- Remove palette range subtraction and clamp behavior from the indexed shader.
- Map palette index directly to square palette texture coordinates:
  `x = index % side`, `y = index / side`.
- The shader side must know the palette side from material/source format, not
  from a range count. `index8` uses side `16`; `index16` uses side `256`.
- Update both object visual and structured interior bundle producers where
  `getPaletteFirstIndex()` currently exists.
- Remove `paletteFirstIndex` from:
  - `apps/holtburger-3d/src/lib/static/contracts.ts`
  - `apps/holtburger-3d/src/lib/visual/visual-geometry.ts`
  - `apps/holtburger-3d/src/lib/visual/object-visual-recipe-bundle.ts`
  - `apps/holtburger-3d/src/lib/visual/object-visual-baker.ts`
  - `apps/holtburger-3d/src/lib/visual/object-visual-resource-key.ts`
  - `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`
  - `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-object-material-payloads.ts`
  - `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.ts`
- Update renderer payload tests in
  `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-object-material-payloads.test.ts`
  and shader tests in `webgl2-renderer.test.ts`.

Acceptance criteria:

- `index8` and `index16` shader paths sample the same full-domain model.
- Indexed texture values are not rewritten or range-normalized.
- Materials no longer carry palette range metadata.
- `rg "paletteFirstIndex|paletteFirstIndices|firstIndex.*palette|indexCount.*palette"` returns
  no production references except unrelated setup replacement ranges.

## Phase 7: Cleanup And Tests

Deliverables:

- Delete obsolete range-specific tests and replace them with full-domain tests.
- Add tests for:
  - sub-palette composition before hashing
  - decoded palette cache reuse for base and replacement palettes
  - prepared palette texture recipe cache reuse
  - `index8` `16x16` padding
  - `index16` `256x256` padding
  - dedupe by identical composed pixels
  - shader coordinate mapping without `firstIndex`
- Run the relevant app and Rust test suites.
- Remove or rewrite tests that only prove range-strip behavior still exists.

Acceptance criteria:

- No production code references palette texture `firstIndex` or `indexCount`.
- Clippy and TypeScript checks pass with warnings treated as errors.
- Renderer tests prove the shader no longer has palette offset logic.
- Run at minimum:
  - `npm --prefix apps/holtburger-3d run test:ts`
  - `npm --prefix apps/holtburger-3d run check`
  - `npm --prefix apps/holtburger-3d run lint:ts`
  - `npm --prefix apps/holtburger-3d run lint:dead`
  - `npm --prefix apps/holtburger-3d run check:rust`
  - `npm --prefix apps/holtburger-3d run lint:rust`
  - `cargo test -p holtburger-content -p holtburger-core --lib`
  - `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`
  - `npm run python:lint` only if Python files were touched; otherwise skip and
    state that Python was not in scope.
  - `rg -n "paletteFirstIndex|paletteFirstIndices|palette-texture-use|firstIndex.*palette|indexCount.*palette" apps/holtburger-3d/src/lib apps/holtburger-3d/src-tauri/src`
    and review every hit. Remaining hits must be unrelated geometry/index
    ranges or setup/sub-palette replacement ranges, not palette texture range
    plumbing.

## Risks

- `index16` palette textures are large: `256x256x4` bytes per unique composed
  palette. Mitigation: content-hash dedupe and measure unique palette counts
  before optimizing.
- Palette terminology is easy to muddle. Mitigation: name range instructions
  `replacement` or `subPaletteReplacement` in new code; reserve `Palette` for
  actual decoded palette assets.
- Recipe identity can sprawl into user-visible/binding ids. Mitigation: keep
  logical texture-use ids compact and explicitly forbid expanded palette color
  data in keys.
- Host route churn can leak browser policy into Rust. Mitigation: keep the Rust
  contract renderer-ready but domain-neutral: compose palette, choose index
  domain, output RGBA.
- Hash-only dedupe can theoretically collide. Mitigation: include dimensions and
  byte length in the key, and add byte-compare collision handling if the registry
  shape makes it cheap.

## Definition Of Done

- Palette textures represent complete index domains, not authored or discovered
  ranges.
- The browser texture manager treats prepared palette textures like ordinary
  RGBA texture sources.
- Palette composition is no longer duplicated across host and browser logic.
- Source Palette records are cached in Rust before composition.
- Prepared palette textures are cached by normalized recipe before atlas upload.
- Material payloads and shader code no longer mention palette first indices.
- The implementation has focused tests at the host adapter, texture manager, and
  WebGL shader/payload layers.
