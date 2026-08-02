# Holtburger 3D Texture Filtering Policy Plan

Date: 2026-07-30
Status: Complete (2026-07-30, including repeat-gradient correction and 8px gutter restoration)

## Context and Boundaries

### Goal

Add an Explorer-owned global filtering control for filterable textures, with nearest, linear, and
anisotropic 2x/4x/8x modes that can change immediately while content is resident or loading.

### Current State

The current renderer has pieces of a sampling model but no global quality policy:

- `TextureSamplerPolicy` records nearest or linear filtering plus wrap behavior for object
  materials.
- Terrain normalized textures are configured as linear or trilinear when their resources are
  allocated.
- Object atlas pages are rebound with nearest or linear texture parameters during each draw.
- Indexed object colors are manually bilinear-filtered after exact index and palette fetches.
- Terrain color/detail and standalone object-detail resources already generate mipmaps according to
  `TexturePurposePolicy`.
- Packed direct-color atlas pages have a four-pixel repeated gutter but currently allocate only
  level zero.

The legacy application exposed nearest, linear, and anisotropic-4x modes. Its useful precedent is
the separation of exact data sampling from filterable color sampling. Its residency-wide sampler
mutation path should not be ported: WebGL2 sampler objects allow the current renderer to select
sampling at draw time without mutating, rebuilding, or re-identifying textures.

### Confirmed Decisions

- The user-facing modes are nearest, linear, anisotropic 2x, anisotropic 4x, and anisotropic 8x.
  Anisotropic 1x is represented by linear because it has no distinct hardware effect.
- The default requested policy is anisotropic 2x. A device without anisotropic support resolves it
  honestly to linear rather than failing renderer construction.
- The Explorer shows only effective filtering choices through 8x and displays the device maximum;
  unsupported anisotropy levels are not included in the selector or cycle.
- The control governs filterable normalized textures. Exact integer data, packed indices, and
  palettes remain exact regardless of the selected mode.
- Indexed object color remains manually bilinear-filtered after palette lookup in every mode.
  Hardware filtering and anisotropy are not applied to encoded indices or palettes.
- Mipmap availability is an immutable texture-purpose fact, not a consequence of the current
  filtering selection.
- Mip-capable resources construct their purpose-promised accessible mip range when created or
  replaced, even when the current selection is nearest.
- Packed direct-color atlas pages use ordinary whole-page `generateMipmap` through a maximum level
  derived from their repeated gutter width.
- Packed direct-color pages use an eight-pixel repeated gutter and maximum LOD 3. Placement
  alignment and anisotropic footprints remain evidence-led follow-up concerns if a concrete
  artifact survives this cap.
- Filtering policy is absent from logical texture identity, atlas compatibility, source requests,
  worker jobs, ownership, and residency.
- Changing the selection never evicts, reloads, repacks, replaces, or regenerates an already
  complete texture.
- A change made during an active frame takes effect from the next frame snapshot. Pending content
  completes normally and uses the then-current policy when first drawn.
- The Explorer owns the requested setting. `GameRuntime` owns the current render-settings snapshot.
  `WebGL2Renderer` owns translation into backend sampler state.
- `TexturePurposePolicy` owns mip eligibility. Atlas publication and the renderer resource manager
  execute allocation, upload, replacement, and mip generation.
- The WebGL device owns the hardware anisotropy capability fact. The renderer owns capability
  clamping and sampler-object lifetime.

### In Scope

- A typed filterable-texture quality policy in the app-local render-settings contract.
- A WebGL2 anisotropy capability probe with a single named UI and renderer consumer contract.
- Renderer-owned `WebGLSampler` objects for exact, nearest, linear, trilinear, and anisotropic
  sampling.
- Mip-aware and wrap-aware sampler selection for normalized 2D and texture-array resources.
- Exact sampler selection for integer terrain facts, composition data, object indices, and
  palettes.
- Whole-page mip allocation and generation for packed direct-color atlas pages.
- Immediate policy changes for resident resources and content that is concurrently loading.
- An Explorer control that cycles or selects every supported mode and reports the effective
  capability honestly.
- Focused unit and browser-harness coverage of policy resolution, capability clamping, resource
  completeness, runtime switching, and packed-page sampling.
- Removal of per-draw object texture-parameter mutation after sampler objects own that state.

### Out of Scope

- Hardware filtering of encoded palette indices.
- Replacing the existing manual bilinear indexed-color shader path.
- Anisotropic indexed-color reconstruction.
- Custom per-entry atlas mip generation.
- A permanent second atlas implementation or sampling fallback.
- Texture-array migration, bindless textures, or one WebGL texture per object source.
- Atlas compaction, page-size, or placement-algorithm changes.
- Preemptive gutter enlargement or mip-level capping without observed artifacts.
- Persisting the Explorer selection across application launches.
- Promoting Explorer presentation policy into shared Rust crates or other applications.
- Modifying `apps/holtburger-3d-legacy`.
- Running the interactive TUI client.

## Ground Truth and Existing Precedent

### Current Application Contracts

- `apps/holtburger-3d/src/lib/game/renderer/renderer.ts`
  - `FrameSettings` and `FrameInput`, the immutable per-frame render-settings snapshot.
- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
  - `setFrameSettings` and `render`, the runtime-owned settings and frame handoff.
- `apps/holtburger-3d/src/explorer/ExplorerApp.svelte`
  - Explorer-local settings ownership and runtime update precedent.
- `apps/holtburger-3d/src/explorer/ExplorerTools.svelte`
- `apps/holtburger-3d/src/explorer/ExplorerWorldPanel.svelte`
  - app-local routing and presentation of render settings.
- `apps/holtburger-3d/src/lib/game/textures/types.ts`
  - `TexturePurpose`, `TexturePurposePolicy`, `TextureMipPolicy`, `TextureSamplerPolicy`, mip
    eligibility, and packed direct-color gutter policy.
- `apps/holtburger-3d/src/lib/game/textures/atlas/page-build.ts`
  - repeated direct-color gutter materialization.
- `apps/holtburger-3d/src/lib/game/textures/atlas/page-publication.ts`
  - purpose-specific atlas resource creation and mip-level count.
- `apps/holtburger-3d/src/lib/game/renderer/resource-manager.ts`
  - renderer-neutral 2D and array upload descriptions.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-resource-manager.ts`
  - texture allocation, replacement, mip generation, and backend binding facts.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-device.ts`
  - WebGL context and backend capability ownership.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
  - terrain and object texture-unit binding, current per-draw texture mutation, and renderer
    resource lifetime.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-object-program.ts`
  - exact indexed fetches and manual post-palette bilinear filtering.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-terrain-program.ts`
  - exact terrain data and normalized terrain texture consumers.

### Historical Evidence

- `apps/holtburger-3d-legacy/src/lib/textures/sampling-policy.ts`
  - exact data classes remain nearest while normalized color/detail/mask classes consume the
    selected filtering policy.
- `apps/holtburger-3d-legacy/src/lib/renderer/webgl2/webgl2-renderer.ts`
  - anisotropy extension lookup, device-limit clamping, and mip-aware minification selection.
- `apps/holtburger-3d-legacy/src/pages/BrowserDisplay.svelte`
  - Explorer-style runtime filtering control precedent.

The legacy files establish behavior to preserve, not architecture to copy. The current app should
not gain residency policy keys, policy-bearing texture identities, or mutation broadcasts over all
resident pages.

### Related Plans

- `docs/plans/holtburger-3d-runtime-texture-atlas-residency-plan.md`
  - `TexturePurpose` remains the complete physical compatibility bucket; filtering does not alter
    logical identity or residency.
- `docs/plans/holtburger-3d-shader-composited-terrain-plan.md`
  - normalized mask completeness and separation of sampler policy from logical texture identity.

## North Stars

1. **Sampling is late-bound; content is not.** One filtering change affects the next frame without
   disturbing logical ownership, preparation, residency, or publication.
2. **Mip availability is truthful resource structure.** Generate the complete chain promised by a
   purpose once; never make completeness depend on transient UI state.
3. **Exact data remains exact.** Global presentation controls cannot reinterpret indices,
   palettes, integer fields, or composition records as filterable color.
4. **One requested policy yields one effective backend decision.** The renderer combines requested
   quality, resource mip availability, sampling class, wrap requirement, and device capability
   once; consumers do not re-derive it.
5. **Frames are explicit snapshots.** Render behavior comes from immutable frame input rather than
   hidden setter ordering inside the renderer.
6. **Use WebGL2's sampler boundary.** Sampler objects own draw-time filtering and wrap state;
   textures own pixels, format, dimensions, and mip completeness.
7. **First make it complete, then make it precious.** Generate ordinary direct-color page mipmaps
   and validate real artifacts before inventing custom atlas mip machinery.
8. **Capability reporting is honest.** The UI never presents an unsupported anisotropy level as
   effective.
9. **The cutover includes subtraction.** Remove redundant texture-parameter mutation and stale
   filtering vocabulary after sampler objects take over.

## Phased Implementation

### Phase 1: Define Render Quality and Capability Contracts

#### Deliverables

- Add a closed `TextureFilteringPolicy` representation for nearest, linear, and anisotropic
  2x/4x/8x.
- Group filtering under a named render-quality portion of the runtime settings contract rather than
  adding unrelated scalar fields.
- Preserve an immutable settings snapshot in `FrameInput`.
- Add a device capability value containing the maximum effective anisotropy.
- Add pure resolution helpers that distinguish requested policy from effective capability-clamped
  policy.

#### Task Checklist

- [x] Choose one canonical policy representation with no independent mode/level fields that can
      form invalid combinations.
- [x] Reshape `FrameSettings` into explicit presentation and quality groups if that remains the
      smallest coherent contract after updating all consumers.
- [x] Give every new field a named runtime, renderer, diagnostics, or UI consumer.
- [x] Query `EXT_texture_filter_anisotropic`, including vendor-prefixed aliases only if still
      needed by supported WebViews.
- [x] Normalize extension absence to maximum anisotropy 1.
- [x] Clamp requested anisotropy to both the device maximum and the app-supported ceiling of 8.
- [x] Add focused tests for every requested/capability combination.

#### Acceptance Criteria

- Invalid combinations such as `linear + anisotropy 8` cannot be represented.
- Frame settings carry the requested policy without any WebGL types or extension constants.
- Capability probing occurs once per device, not once per texture or draw.
- Pure tests distinguish selected and effective values, including extension absence and hardware
  limits below 8.

#### Decisions and Course Corrections

- Completed 2026-07-30.
- `TextureFilteringPolicy` is a string-literal union whose anisotropy is encoded in the
  discriminant. There are no independently mutable mode and multiplier fields.
- Existing fog and EnvCell presentation fields remain flat. Only the new `quality` group was added;
  nesting unrelated existing settings would create mechanical churn without strengthening an
  invariant.
- The device retains the hardware's real maximum anisotropy while supported-policy enumeration and
  requested-policy resolution cap client behavior at 8x.
- The extension probe is a context-lifetime device fact. The public capability copy contains no
  WebGL types; the private extension constants remain available for Phase 3 sampler construction.
- Focused policy/runtime tests and the complete TypeScript/Svelte check passed after the cutover.

### Phase 2: Make Mip Completeness Explicit and Enable Direct-Color Atlas Mips

#### Deliverables

- Change packed `ObjectDirectColor` purpose policy to generate mipmaps.
- Allocate and generate the full ordinary mip chain for every new or replaced direct-color atlas
  page.
- Retain mip-level availability in 2D backend resource bindings, matching the already explicit
  texture-array description.
- Preserve level-zero-only resources for masks, indices, palettes, and integer data.
- Keep atlas diagnostics honest by distinguishing level-zero page payload bytes from complete
  device allocation bytes including mip levels.

#### Task Checklist

- [x] Update the direct-color purpose policy rather than special-casing atlas publication.
- [x] Prove `AtlasPagePublication` derives the full mip count from the purpose policy.
- [x] Prove 2D creation and replacement generate the chain before publishing the resource.
- [x] Add `mipLevels` to the 2D backend binding so sampler resolution consumes an owned fact.
- [x] Update resource-manager fixtures and fakes to retain the new required fact.
- [x] Test direct-color pages as mipmapped and every exact packed purpose as level zero.
- [x] Update active, peak, released, and per-page device-byte accounting to include the complete mip
      chain while retaining `uploadedAtlasPageBytes` as the level-zero worker payload submitted to
      the device.
- [x] Comment both byte metrics at their contract boundary so consumers cannot conflate transfer
      volume with retained device allocation.
- [x] Do not add filtering policy to page identity, layout, build jobs, or publication transactions.

#### Acceptance Criteria

- A packed direct-color page reports a complete full mip chain after creation and replacement.
- Indexed and palette atlas pages remain level zero.
- Switching filtering modes performs no texture creation, replacement, upload, or mip generation.
- Atlas device-byte diagnostics include allocated mip levels while upload-byte diagnostics continue
  to report the actual level-zero payload.
- Atlas readiness remains transactional: no page binding is visible before its complete resource,
  including promised mip levels, exists.

#### Decisions and Course Corrections

- Whole-page `generateMipmap` is the accepted initial implementation.
- The existing four-pixel gutter remains unchanged until browser evidence justifies tuning.
- Completed 2026-07-30.
- `completeTextureMipLevelCount` and `textureMipChainByteLength` now provide one validated owner for
  mip structure and normalized device-byte accounting. Atlas publication no longer re-derives the
  complete-chain formula.
- `ObjectDirectColor` alone changed among packed purposes. Index8, index16, and palette pages remain
  level zero.
- Both 2D creation and replacement use the same validated upload path, which generates promised
  mipmaps before returning the replacement binding. The binding now retains `mipLevels` for Phase 3
  instead of requiring the renderer to infer completeness.
- Atlas active, peak, released, and per-page bytes now include mip allocation. Uploaded page bytes
  deliberately remain the level-zero worker payload. For a production 2048x2048 RGBA page these
  facts are 22,369,620 device bytes versus 16,777,216 uploaded bytes.
- All 448 TypeScript tests, the full Svelte/TypeScript check, and TypeScript ESLint passed after this
  phase.

### Phase 3: Introduce the Renderer-Owned Sampler Catalog

#### Deliverables

- Add a focused WebGL2 sampler catalog owned and destroyed by `WebGL2Renderer`.
- Cover exact nearest, filterable nearest, linear, trilinear, and anisotropic 2x/4x/8x variants.
- Cover the hardware wrap states actually required by terrain resources and packed atlas pages.
- Resolve samplers from one composite input containing sampling class, requested policy, mip
  availability, wrap requirement, and device capability.

#### Task Checklist

- [x] Create every admitted sampler once during renderer construction.
- [x] Set minification, magnification, wrap, anisotropy, and any required LOD parameters completely
      on each sampler.
- [x] Use `LINEAR` for level-zero linear/anisotropic resources and `LINEAR_MIPMAP_LINEAR` for
      mip-complete linear/anisotropic resources.
- [x] Keep exact samplers nearest regardless of global policy.
- [x] Bind an explicit sampler for every renderer-owned texture unit so state cannot leak between
      terrain, object, portal, fixture, or fallback paths.
- [x] Delete all sampler objects during renderer destruction.
- [x] Add pure catalog-selection tests and focused WebGL fixture assertions.

#### Acceptance Criteria

- Every admitted composite input resolves to exactly one complete sampler.
- No incomplete level-zero texture receives a mipmapped minification filter.
- Anisotropy is applied to filterable level-zero packed pages as well as mipmapped resources.
- Exact data never receives normalized linear or anisotropic sampling.
- Renderer teardown releases every sampler it creates.

#### Decisions and Course Corrections

- Completed 2026-07-30.
- The catalog prebuilds unique admitted hardware descriptions rather than duplicating samplers for
  semantic requests that resolve to identical state. Exact and filterable-nearest requests can
  therefore share one immutable nearest sampler without weakening their classification boundary.
- The renderer receives the device's one context-lifetime extension probe; it never repeats
  extension lookup.
- Portal rendering no longer samples portal textures after the direct-compositing cutover.
  Renderer-owned game texture units and fallback bindings receive explicit samplers; allocation and
  framebuffer-only portal paths have no draw-time sampler consumer.
- Pure tests cover exactness, mip completeness, wrapping, capability clamping, and invalid resource
  facts. The production Chrome/WebGL2 harness constructed, bound, drew through, and destroyed the
  sampler catalog without GL or console errors.

### Phase 4: Cut Terrain and Object Binding Over to Sampler Objects

#### Deliverables

- Bind explicit samplers for terrain color, detail, masks, integer facts, and composition data.
- Bind explicit samplers for packed direct color, packed indices, palettes, and standalone object
  detail.
- Remove per-object `texParameteri` filtering and wrap mutation.
- Preserve manual post-palette bilinear indexed-color behavior.

#### Task Checklist

- [x] Classify each terrain texture unit as exact or filterable at its owning bind site.
- [x] Classify each object texture unit without inferring exactness from pixel format alone.
- [x] Keep atlas page hardware wrap clamped; retain source-local repeat/clamp behavior in the object
      shader and prepared gutters.
- [x] Ensure direct-color atlas sampling uses the current global filterable policy.
- [x] Ensure object-detail sampling uses the current global filterable policy and its existing mip
      chain.
- [x] Leave `texelFetch` index and palette paths unchanged.
- [x] Remove obsolete texture-parameter mutation and update any metrics or tests that assumed it.

#### Acceptance Criteria

- Nearest, linear, and anisotropic modes affect every filterable terrain and object binding.
- Packed direct-color objects use the selected policy, including anisotropy.
- Indexed output remains manually bilinear and byte-exact index/palette fetches remain unchanged.
- No draw depends on whichever sampler another pass most recently left bound.
- The same frame input produces the same sampler choices regardless of scene load history.

#### Decisions and Course Corrections

- Completed 2026-07-30.
- Terrain surface/composition units are exact and clamped; normalized terrain color, mask, and
  detail units are filterable and repeated. The owning bind site supplies these semantics
  explicitly.
- Packed direct color is filterable; index and palette bindings are exact; standalone object detail
  is filterable. Atlas hardware wrap remains clamped while the shader and prepared gutter preserve
  source-local repeat/clamp behavior.
- The obsolete per-material `TextureFilteringMode`, `filtering` field, filtering sort-key component,
  and per-draw `texParameteri` calls were deleted. Indexed output continues through the unchanged
  manual post-palette bilinear shader path.
- The requested quality is captured at frame entry so nested flat and portal draws consume one
  immutable frame decision.

### Phase 5: Add Explorer Control and Runtime Switching

#### Deliverables

- Add an Explorer-local texture filtering control alongside other world/render settings.
- Route settings through `ExplorerTools`, `ExplorerWorldPanel`, `ExplorerApp`, and
  `GameRuntime.setFrameSettings` without giving UI components renderer access.
- Present only supported anisotropy levels or explicitly display the capability-clamped effective
  level.
- Preserve the requested setting across scene-interest changes for the lifetime of the Explorer
  runtime.

#### Task Checklist

- [x] Add the default policy to the canonical default render settings.
- [x] Add typed labels for nearest, linear, anisotropic 2x, 4x, and 8x.
- [x] Disable the control until the runtime/device capability is available.
- [x] Apply a change by replacing the runtime-owned immutable settings value.
- [x] Do not call texture manager, atlas, resource manager, or worker APIs from the UI handler.
- [x] Add Svelte/type tests where existing component-test infrastructure makes them valuable;
      otherwise cover routing through pure settings helpers and `svelte-check`.

#### Acceptance Criteria

- Changing the setting with a fully loaded scene changes sampling on the next rendered frame.
- Changing it while source decode, page build, publication, or scene realization is pending neither
  cancels nor restarts that work.
- A texture published after the change uses the same current policy as older resident textures on
  its first draw.
- Rapid mode cycling cannot create stale callbacks, duplicate resources, or partial policy state.
- Device capability and effective anisotropy are represented honestly in the control.

#### Decisions and Course Corrections

- The default requested policy is anisotropic 2x. Capability resolution may reduce it to linear on
  devices whose maximum anisotropy is 1.
- The control exposes only effective choices and displays the device maximum nearby. Unsupported
  anisotropy levels are omitted rather than shown disabled.
- Completed 2026-07-30.
- Explorer retains the requested quality in its immutable settings value and derives the displayed
  effective value from the one device capability. The UI has no renderer, resource, atlas, or
  worker dependency.
- Render quality has its own fieldset rather than being conditional on regional sky data.
- The existing harness now changes filtering immediately after requesting content and cycles every
  supported mode after settlement. On a 16x-capable SwiftShader context it proved nearest, linear,
  2x, 4x, and 8x changes without any resident resource or source-request mutation.

### Phase 6: Browser Validation and Evidence-Led Atlas Tuning Decision

#### Deliverables

- Extend an existing browser harness rather than creating an unrelated sampling
  application.
- Capture nearest, linear, anisotropic 2x/4x/8x comparisons for terrain, packed direct-color
  objects, indexed objects, details, and masks.
- Exercise resident switching, switching during loading, replacement publication, and context
  teardown.
- Record whether whole-page direct-color mipmaps exhibit visible cross-entry contamination.

#### Task Checklist

- [x] Use a device reporting anisotropy of at least 8 where available.
- [x] Inspect oblique near/mid/far views of packed direct-color entries adjacent to strongly
      contrasting entries.
- [x] Inspect repeated and clamped source-local UV cases.
- [x] Confirm the direct-color page consumes nonzero mip levels under minification.
- [x] Confirm indexed objects retain their manual bilinear appearance across hardware modes.
- [x] Measure page memory growth and page-publication cost after enabling the full mip chain.
- [x] Decide from evidence whether to retain the four-pixel gutter and unrestricted mip chain or
      schedule a separate tuning change.

#### Acceptance Criteria

- Browser evidence demonstrates an immediate mode change without texture reload or scene restart.
- Anisotropic filtering visibly or measurably affects packed direct-color pages as well as terrain.
- No exact-data corruption occurs.
- Any observed atlas bleeding is reproducible with an exact page, placement, mode, view, and LOD
  context rather than recorded as a vague visual concern.
- Gutter, alignment, and LOD changes are made only if this evidence identifies a concrete failure.

#### Decisions and Course Corrections

- If tuning is required, first evaluate the smallest structural correction: gutter size and
  placement alignment, then a safe atlas LOD cap. Custom per-entry mip construction or storage
  replacement requires a separate plan unless evidence proves the smaller corrections inadequate.
- Completed 2026-07-30.
- The production browser harness reported a maximum anisotropy of 16 and cycled nearest, linear,
  2x, 4x, and 8x both immediately after requesting content and after settlement. Resident
  static-object diagnostics remained byte-identical throughout the cycle, proving that switching
  did not recreate, replace, repack, or reload content.
- The same da55 scene exercised direct-color, index16, palette, repeated terrain, clamped packed
  atlas, detail, and mask bindings. A direct-color binding with 12 mip levels drew with
  `LINEAR_MIPMAP_LINEAR` sampling under minification; indexed bindings continued to use exact
  samplers and the unchanged manual post-palette bilinear shader path in every hardware mode.
- Temporary nearest and anisotropic-8x captures of the same oblique scene showed the expected
  filtering difference without a reproducible cross-entry contamination case. They remain
  disposable harness evidence in `/tmp`, not checked-in golden images.
- One 2048x2048 RGBA direct-color page retained 22,369,620 bytes for its full chain versus
  16,777,216 level-zero bytes, a deterministic increase of 5,592,404 bytes. In the observed
  three-page scene this was also the total mip overhead, increasing retained atlas memory from
  41,943,040 to 47,535,444 bytes (13.3%).
- One observed publication completed in 72.8 ms with a 47.7 ms longest transaction. The user
  explicitly declined a pre-change evidence pass, so these are absolute post-change timings rather
  than a defensible before/after performance delta.
- Retain the four-pixel gutter and unrestricted ordinary mip chain. No concrete bleeding failure
  justified tuning, and speculative custom mip machinery remains out of scope.

### Phase 7: Cleanup and Architectural Verification

#### Deliverables

- Remove obsolete nearest/linear backend mutation paths and duplicated policy helpers.
- Sweep stale filtering, mip, and sampler terminology from touched tests, comments, diagnostics,
  and UI labels.
- Update the plan with final decisions, measurements, concessions, and follow-up debt.

#### Task Checklist

- [x] Verify one authority each for requested policy, effective capability, mip eligibility, mip
      execution, and sampler-object state.
- [x] Verify no texture key, atlas bucket, worker protocol, or ownership contract contains filtering
      policy.
- [x] Verify every new capability or diagnostic field has a named consumer and scenario where it
      differs from an existing fact.
- [x] Delete tests that preserve per-texture mutation behavior rather than rewriting the new
      architecture as compatibility scaffolding.
- [x] Run `npm run test:ts` from `apps/holtburger-3d`.
- [x] Run `npm run check` from `apps/holtburger-3d`.
- [x] Run `npm run lint` from `apps/holtburger-3d`, treating every warning as an error.
- [x] Run `npm run format:check` from `apps/holtburger-3d`.
- [x] Run the relevant browser harness and record exact command, device capability, and outcome.

#### Acceptance Criteria

- The filtering pipeline has one coherent settings-to-sampler path with no vestigial mutation
  mechanism.
- Type checks, focused tests, lint, formatting, and the browser harness pass.
- The plan records measured GPU-memory/publication effects of direct-color atlas mipmaps.
- Remaining atlas sampling debt is concrete, reproducible, and separately scoped.

#### Decisions and Course Corrections

- Completed 2026-07-30.
- Authority remains deliberately split by lifecycle: Explorer owns the requested immutable
  setting, the WebGL device owns the capability probe, `TexturePurposePolicy` owns mip eligibility,
  resource publication owns mip execution, and the renderer sampler catalog owns effective
  draw-time state.
- A complete vocabulary sweep found no filtering policy in asset keys, atlas compatibility,
  preparation jobs, worker messages, source ownership, or residency. Remaining texture-object
  `texParameteri` calls establish safe allocation defaults for probe, render-target, fallback, and
  resource textures; no game draw mutates or relies on them because every game texture unit binds
  an explicit sampler.
- Dead-code analysis identified two needlessly exported enclosing-contract details:
  `RenderQualitySettings` and the private anisotropy extension shape. Their exports were removed
  instead of inventing consumers.
- `npm run test:ts` passed 455 tests in 75 files. `npm run check` passed with zero Svelte warnings;
  `npm run lint` passed ESLint, knip, and Rust clippy with warnings denied; and
  `npm run format:check` passed.
- `npm run harness:browser -- --brief --filtering-cycle --lifecycle --settle-ms 1000` passed on a
  device reporting maximum anisotropy 16. It cycled nearest, linear, 2x, 4x, and 8x, drew 43 static
  object batches with 90 object texture-page binds, withdrew and reloaded da55 content, retained
  three atlas pages and 29 resident sources, and reported no application console messages.
- No separate atlas sampling debt is scheduled. If a reproducible page/placement/view/LOD bleeding
  case appears, gutter/alignment and then an atlas LOD cap remain the ordered follow-up options.

### Phase 8: Evidence-Led Direct-Color Gutter Tuning

#### Deliverables

- Increase the purpose-owned packed direct-color gutter from four to eight pixels.
- Keep layout allocation and page pixel materialization derived from the same preparation fact.
- Leave exact index and palette pages unchanged at zero gutter.
- Revalidate atlas layout, publication, filtering-cycle, and lifecycle behavior.

#### Task Checklist

- [x] Change only the canonical direct-color preparation policy.
- [x] Replace touched test magic numbers with the runtime preparation fact.
- [x] Prove the page builder materializes the complete enlarged repeated gutter.
- [x] Prove layout accounting reserves the complete enlarged allocation.
- [x] Record the resulting da55 page count and any observable residency cost.
- [x] Run focused tests, complete TypeScript checks, lint, formatting, and the browser harness.

#### Acceptance Criteria

- Direct-color entries receive an eight-pixel repeated border on every side.
- Exact packed entries retain zero gutter.
- Stable layout and page publication consume the same preparation policy without duplicated width.
- The da55 filtering/lifecycle harness completes without resource churn or application errors.

#### Decisions and Course Corrections

- The user reproduced direct-color bleeding at distance after the initial four-pixel validation.
- Eight pixels is the smallest admitted structural correction and preserves the plan's tuning
  order. It protects one additional mip level but cannot isolate entries in the deepest whole-page
  mips; a reproducible failure after this change should evaluate an atlas LOD cap next.
- Completed 2026-07-30.
- `STATIC_OBJECT_TEXTURE_GUTTER_PIXELS` remains the sole width authority. Stable layout and page
  materialization already consumed `packedObjectTexturePreparation`, so no worker, publication,
  identity, or renderer contract changed.
- Touched tests now derive content placement, padded allocation, page size, byte offsets, and
  diagnostic ratios from the runtime preparation fact. The resident-atlas fixture chooses the
  smallest power-of-two page that can contain its direct-color source and current gutter instead of
  assuming a 16px page.
- On da55, all 27 direct-color entries still fit one page. The complete atlas remains three pages,
  29 resident sources, 47,535,444 retained device bytes, and 41,943,040 uploaded level-zero bytes.
  Direct-page allocated area is 14.14% versus 11.33% content area, with a 79.69% largest free
  rectangle. The enlarged gutter consumed packing headroom but caused no additional page or GPU
  allocation.
- `npm run test:ts` passed 456 tests in 75 files. `npm run check`, `npm run lint`, and
  `npm run format:check` passed. The 16x-capable filtering-cycle/lifecycle browser harness cycled
  all five modes, withdrew and reloaded da55, retained the same resource counts, and emitted no
  application console messages.

### Phase 9: Derive Direct-Color Mip Extent from Gutter Isolation

#### Deliverables

- Replace boolean mip eligibility with a closed purpose-owned mip extent policy.
- Derive the packed direct-color maximum mip level from its gutter width.
- Configure mutable 2D textures with the promised `TEXTURE_MAX_LEVEL` before mip generation.
- Allocate, generate, account, and expose only the purpose-promised accessible mip range.

#### Task Checklist

- [x] Represent level-zero, complete, and maximum-level mip policies without invalid field
      combinations.
- [x] Compute the gutter-isolated maximum level once from the canonical preparation width.
- [x] Centralize purpose/dimension-to-mip-level-count resolution for atlas pages, standalone 2D
      textures, and texture arrays.
- [x] Set `TEXTURE_MAX_LEVEL` before `generateMipmap` so WebGL generation matches the binding fact.
- [x] Update byte accounting and tests from a complete chain to the capped accessible range.
- [x] Record production da55 binding, memory, filtering-cycle, and lifecycle evidence.
- [x] Run complete tests, checks, lint, and formatting.

#### Acceptance Criteria

- An eight-pixel direct-color gutter yields maximum LOD 3 and four accessible mip levels.
- Direct-color atlas generation stops at LOD 3; no draw can sample deeper atlas levels.
- Terrain color/detail and standalone object-detail textures retain complete mip chains.
- Exact packed pages remain level zero.
- Binding `mipLevels`, texture accessible range, generated levels, and diagnostics agree.

#### Decisions and Course Corrections

- A computed cap replaces the proposed hard-coded `3`: `floor(log2(max(1, gutterPixels)))`.
- The cap belongs to immutable purpose/resource structure, not global filtering policy or sampler
  selection. A sampler-only clamp would retain and regenerate unreachable atlas levels.
- The OpenGL ES 3.0.6 specification defines mip generation through `q`, where `q` is bounded by
  `TEXTURE_MAX_LEVEL`. The resource manager will set this texture parameter before calling
  `generateMipmap`.
- Gutter width alone is not a formal proof against every footprint: placement alignment and
  anisotropic footprints can still matter. This cap removes known whole-page deep-mip mixing; any
  surviving reproducible artifact should be investigated rather than answered with another blind
  constant.
- Completed 2026-07-30.
- `TextureMipPolicy` is a closed union of level-zero, complete, and inclusive maximum-level
  policies. `texturePurposeMipLevelCount` is the sole purpose/dimension resolver consumed by atlas
  publication, standalone 2D upload, texture-array allocation, and byte accounting.
- An eight-pixel gutter resolves to maximum LOD 3 and four accessible levels. The WebGL2 2D upload
  path sets `TEXTURE_MAX_LEVEL` to `mipLevels - 1` before `generateMipmap`; replacement uses the
  same path. Immutable texture arrays remain physically bounded by their allocated level count.
- The production 2048x2048 direct-color page now retains 22,282,240 bytes for levels 0-3, saving
  87,380 bytes of unreachable deep levels. The complete three-page da55 atlas retains 47,448,064
  bytes while level-zero upload volume remains 41,943,040 bytes.
- `npm run test:ts` passed 457 tests in 75 files. `npm run check`, `npm run lint`, and
  `npm run format:check` passed. The 16x-capable filtering-cycle/lifecycle harness cycled all five
  filtering modes, withdrew and reloaded da55, retained three pages and 29 sources, and emitted no
  application console messages.

### Phase 10: Trial a Twelve-Pixel Direct-Color Gutter

#### Deliverables

- Increase the canonical direct-color gutter from eight to twelve pixels.
- Preserve the computed maximum LOD 3 because twelve pixels does not admit another full power-of-two
  reduction.
- Measure da55 packing pressure and verify no additional page is required.

#### Task Checklist

- [x] Admit twelve pixels in the closed gutter-width type and select it for direct color.
- [x] Prove direct-color preparation reports twelve while exact pages remain zero.
- [x] Prove the derived maximum LOD remains 3 and accessible mip count remains four.
- [x] Record da55 page count, allocation ratio, device bytes, and lifecycle behavior.
- [x] Run complete tests, checks, lint, formatting, and the browser harness.

#### Acceptance Criteria

- Direct-color entries receive twelve repeated pixels on every side.
- Direct-color textures remain limited to LODs 0-3.
- Exact packed textures remain unchanged.
- Production da55 completes without resource churn, application errors, or an unexpected page-count
  increase.

#### Decisions and Course Corrections

- Twelve pixels is an explicit visual trial requested after the 8px/LOD-3 pipeline landed. It adds
  a 50% wider base-level border without changing mip extent or per-page GPU allocation.
- Completed 2026-07-30.
- The closed `TextureGutterPixels` vocabulary now admits twelve and the canonical direct-color
  preparation selects it. Existing layout, page-build, and resident-atlas tests derive their
  geometry from that runtime fact and required no new conditional path.
- `gutterIsolatedMaximumMipLevel(12)` remains 3, so the direct page still exposes four levels and
  retains 22,282,240 bytes. The complete three-page atlas remains 47,448,064 device bytes with
  41,943,040 level-zero upload bytes.
- All 27 da55 direct-color entries remain on one page. Reserved area increased from 14.14% at 8px
  to 15.67% at 12px while content stayed 11.33%; the largest free rectangle decreased from 79.69%
  to 78.84%. No additional page or resource was created.
- `npm run test:ts` passed 457 tests in 75 files. `npm run check`, `npm run lint`, and
  `npm run format:check` passed. The 16x-capable filtering-cycle/lifecycle harness cycled all five
  modes, withdrew and reloaded da55, retained three pages and 29 sources, and emitted no
  application console messages.
- Rejected after visual inspection: the user reported that the 12px result looked worse. Twelve
  pixels was removed from the closed gutter vocabulary rather than retained as an unused tuning
  option.

### Phase 11: Trial a Sixteen-Pixel Direct-Color Gutter

#### Deliverables

- Replace the rejected twelve-pixel trial with a sixteen-pixel direct-color gutter.
- Let the existing gutter-derived policy advance the maximum mip level from 3 to 4.
- Measure the resulting da55 packing and device-memory costs.

#### Task Checklist

- [x] Remove twelve from the closed gutter vocabulary and select sixteen for direct color.
- [x] Prove direct-color preparation reports sixteen and exact pages remain zero.
- [x] Prove the derived maximum LOD is 4 and accessible mip count is five.
- [x] Record da55 page count, allocation ratio, device bytes, and lifecycle behavior.
- [x] Run complete tests, checks, lint, formatting, and the browser harness.

#### Acceptance Criteria

- No surviving runtime or test policy admits a twelve-pixel gutter.
- Direct-color entries receive sixteen repeated pixels on every side and expose LODs 0-4.
- Exact packed textures remain unchanged.
- Production da55 completes without resource churn, application errors, or an unexpected page-count
  increase.

#### Decisions and Course Corrections

- Sixteen is the next admitted power-of-two gutter after the rejected twelve-pixel visual trial.
  Unlike twelve, it expands the mathematically isolated mip extent by one complete level.
- Completed 2026-07-30.
- Twelve was removed from `TextureGutterPixels`; sixteen is now the sole canonical direct-color
  width. The existing derived policy resolves maximum LOD 4 and five accessible levels without a
  separate cap constant.
- The production direct page retains 22,347,776 bytes, adding the 128x128 LOD 4 allocation. The
  complete three-page da55 atlas retains 47,513,600 bytes while level-zero upload volume remains
  41,943,040 bytes.
- All 27 da55 direct-color entries remain on one page. Reserved area is 17.29% versus 11.33%
  content area, and the largest free rectangle is 74.90%. The trial did not add a page or resource.
- `npm run test:ts` passed 457 tests in 75 files. `npm run check`, `npm run lint`, and
  `npm run format:check` passed. The 16x-capable filtering-cycle/lifecycle harness cycled all five
  modes, withdrew and reloaded da55, retained three pages and 29 sources, and emitted no
  application console messages.

### Phase 12: Preserve Gradients Across Virtual Repeat Seams

#### Deliverables

- Replace implicit mip selection from discontinuous wrapped object UVs with explicit gradients
  derived from the continuous source UVs.
- Apply the same atlas-gradient contract to repeated direct-color bases and static detail
  textures.
- Leave clamped direct-color sampling and manual indexed bilinear filtering unchanged.

#### Task Checklist

- [x] Add one normalized atlas-rectangle sampling primitive that wraps coordinates after deriving
      the continuous source footprint.
- [x] Route repeated direct-color pixel rectangles through explicit-gradient sampling.
- [x] Route repeated static detail rectangles through the same sampling primitive.
- [x] Add focused shader-source coverage for coordinate wrapping and gradient order.
- [x] Run complete tests, checks, lint, formatting, and production browser validation.

#### Acceptance Criteria

- A repeat seam cannot create a false derivative spike and select a coarser atlas mip solely
  because the wrapped coordinate crosses from one to zero.
- Atlas gradients account for the packed rectangle extent rather than the complete atlas extent.
- The physical atlas sampler remains clamped because repetition is virtual within each packed
  rectangle.
- Indexed textures retain exact fetches followed by manual bilinear filtering.

#### Decisions and Course Corrections

- Sixteen-pixel gutters remain useful isolation for valid minification footprints, but cannot
  correct an invalid footprint derived after `fract`.
- The current object shader applied `fract` before implicit `texture` sampling. At repeat seams,
  fragment-local differencing could therefore report a footprint nearly one source texture wide
  and select a coarse mip even at close range.
- The legacy terrain shader already demonstrates the required ordering: derive gradients from the
  continuous tiled coordinates, wrap only the sample coordinate, scale gradients into the atlas
  rectangle, and call `textureGrad`.
- Completed 2026-07-30.
- `npm run test:ts` passed 458 tests in 75 files. `npm run check`, `npm run lint`, and
  `npm run format:check` passed.
- The production da55 browser harness rendered 43 static-object draws with anisotropic 8x,
  retained three atlas pages and 29 sources, and emitted no application console messages. This
  exercised successful compilation and linkage of the updated WebGL object programs.
- Visual validation across viewing distances found zero repeat-texture bleed after the explicit
  gradient correction. This confirms that the observed artifact came from false LOD selection at
  wrapped-coordinate discontinuities rather than insufficient gutter isolation.

### Phase 13: Restore the Eight-Pixel Direct-Color Gutter

#### Deliverables

- Return packed direct-color preparation from the diagnostic sixteen-pixel trial to the smallest
  previously validated eight-pixel gutter.
- Let the existing gutter-derived policy return the maximum mip level from 4 to 3.
- Preserve sixteen as an admitted preparation width rather than conflating a valid structural
  option with the rejected non-power-of-two twelve-pixel trial.

#### Task Checklist

- [x] Select eight as the canonical direct-color gutter.
- [x] Prove direct-color policy derives maximum LOD 3 and four accessible levels.
- [x] Run complete tests, checks, lint, formatting, and production browser validation.

#### Acceptance Criteria

- Direct-color entries receive eight repeated pixels on every side and expose LODs 0-3.
- Exact packed textures remain unchanged.
- Production da55 retains three atlas pages and renders without application errors.

#### Decisions and Course Corrections

- The sixteen-pixel trial was diagnostic padding while repeat seams could falsely select coarse
  mips. Once gradients were derived before coordinate wrapping, visual validation found zero bleed
  at every tested distance.
- Eight pixels remains sufficient for the valid footprints admitted through maximum LOD 3 and
  consumes less packing headroom than sixteen.
- Completed 2026-07-30.
- `npm run test:ts` passed 458 tests in 75 files. `npm run check`, `npm run lint`, and
  `npm run format:check` passed.
- The production da55 browser harness rendered 43 static-object draws with anisotropic 8x, retained
  three atlas pages and 29 sources, and emitted no application console messages.

## Risks and Mitigations

### Whole-page mipmaps blend independent atlas entries at deep levels

The repeated gutter shrinks by half at each mip level and cannot isolate entries through the final
1x1 page level. Arbitrary placement alignment can expose contamination earlier.

Mitigation: accept ordinary generation for the first pipeline, validate contrasting adjacent
entries under real minification, and record exact evidence. Tune gutter/alignment or cap atlas LOD
only after reproduction. Do not silently add a second atlas representation.

### Mipmapped direct-color pages increase retained GPU memory and publication work

A full mip chain adds approximately one third to level-zero texture memory and requires generation
for every created or replaced page.

Mitigation: measure active page bytes and publication duration before and after the cutover. Keep
mip availability purpose-owned so cost is deterministic rather than dependent on UI history.

### Sampler state leaks between texture units or passes

WebGL sampler bindings are per texture unit and persist until replaced. A portal, fallback, or
fixture path can inherit stale state if a bind helper sets only the texture.

Mitigation: every renderer-owned bind path binds both its texture and an explicit sampler. Tests
alternate exact and anisotropic paths to expose leakage.

### Hardware anisotropy support varies

The extension may be absent or expose a maximum below the requested level.

Mitigation: probe once, represent maximum 1 when absent, clamp centrally, and keep selected versus
effective values distinct. The UI exposes only truthful behavior.

### Indexed-color terminology becomes misleading

Indexed output remains manually bilinear even when the global hardware policy is nearest.

Mitigation: name and document the setting as filterable texture sampling rather than claiming to
change encoded-data fetches. Do not add a shader branch merely to make a broad label literally
global.

### Resource and UI policy become coupled

Conditional mip generation based on the current selection would require reload or mutation after a
later mode change and could race pending publication.

Mitigation: mip eligibility remains fixed in `TexturePurposePolicy`; resource creation never reads
render settings.

## Definition of Done

- [x] Explorer offers nearest, linear, and every device-supported anisotropic level through 8x.
- [x] The selected policy is an app-local render-quality setting carried by immutable frame input.
- [x] The device reports anisotropy capability once and the renderer clamps centrally.
- [x] WebGL sampler objects own all renderer texture filtering and hardware wrap state.
- [x] Packed direct-color atlas pages allocate and generate the gutter-derived accessible mip
      range.
- [x] Terrain, direct-color objects, normalized masks, and detail textures consume the selected
      filterable policy.
- [x] Integer facts, composition data, indices, and palettes remain exact.
- [x] Indexed object output remains manually bilinear-filtered.
- [x] Switching while loaded or loading takes effect on the next frame without content churn.
- [x] No filtering policy appears in logical identity, residency, worker, or atlas-layout
      contracts.
- [x] Per-draw `texParameteri` sampler mutation is removed.
- [x] Focused tests, type checks, lint, formatting, and browser validation pass.
- [x] Direct-color atlas mip memory, publication cost, and any reproducible bleeding are recorded.
- [x] The plan records final course corrections and any separately scoped sampling debt.

## Open Questions

None.
