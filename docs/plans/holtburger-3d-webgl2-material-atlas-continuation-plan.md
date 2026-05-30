# Holtburger 3D WebGL2 Material, Portal, and Atlas Continuation Plan

Status: Phase M3A complete; ready for Phase M3B.

Related plans:

- [Holtburger 3D WebGL2 Renderer Pivot Plan](./holtburger-3d-webgl2-renderer-pivot-plan.md)
- [Holtburger 3D Luma Renderer Swapout Plan](./holtburger-3d-luma-renderer-swapout-plan.md)

## Purpose

Continue the renderer work that was paused after the luma Phase 6C.3 detour, but in the current
WebGL2 framing. The old luma plan still contains useful rationale around material strategy,
atlas-ready prepared textures, object assembly, resource-graph retention, portals, terrain material
parity, and later static compaction. The luma backend itself is retired, so this plan carries those
designs forward without retaining luma terminology or implementation targets.

The next implementation work should correct staged material visibility. A staged draw unit should
render its resolved per-surface material directly whenever WebGL2 supports that material. Atlas
eligibility is metadata for future compaction, not a prerequisite for seeing materials.

## Current Baseline

- `webgl2` is the only active low-level renderer backend.
- `three` remains the comparison/high-level backend.
- `luma` is no longer selectable and `@luma.gl/*` dependencies have been removed.
- Renderer-neutral helpers now live under WebGL2/staged names:
  - `render-math.ts`
  - `staged-world-geometry.ts`
  - `staged-world-materials.ts`
  - `staged-world-material-strategy.ts`
  - `material-texture-preparation-policy.ts`
- WebGL2 can render the staged baseline with flat fallback and direct-texture draw units.
- Current visual behavior is still too flat because many common material slots are classified as
  future atlas candidates and then rendered as fallback. That is the next problem to fix.
- The normalized prepared-texture path exists for decompressed, base-level material texture inputs:
  `prepared-texture/<renderSurfaceId>?usage=<usage>&out=rgba8|r8&mips=none&cs=linear|data`.
- The renderer resource graph, cleanup scheduler, readiness/incubation, staged assembly, BVH
  visibility, and WebGL2 resource stores are in place.

## Carried-Forward Decisions

- Atlas inputs use non-mipmapped decompressed prepared textures. Compressed source render surfaces
  should be decoded through the prepared-texture route before atlas packing. Do not request
  source-level software mip payloads for atlas inputs.
- Use linear color for base-color material texture inputs unless runtime evidence proves another
  policy is needed. Do not adopt Three-style sRGB assumptions by default.
- Atlas eligibility is material-aware. Evaluate material recipe, render surface, texture usage,
  sampler policy, render state, alpha behavior, and UV animation together.
- Atlas eligibility must not suppress staged material visibility. For staged draw units, the active
  render path should prefer direct material rendering when supported, while separately recording
  atlas eligibility for later compaction.
- One atlas set may contain multiple atlas textures. Pack additional atlas textures into the same
  atlas set before falling back for capacity.
- Initial atlas packing should use deterministic ordering, power-of-two page dimensions where
  practical, padded entries, and at least a 2-pixel base-level gutter.
- Generate mipmaps from packed atlas pages after padding/gutter extrusion. Do not stitch source mips.
- Preserve author UVs. For repeating/wrapping atlas materials, either use shader sampling that keeps
  derivatives correct or fall back explicitly.
- Start material tables with bounded uniform arrays. Partition draw slices deterministically when
  material slots exceed the selected uniform limit.
- Conservative WebGL2 draw slices should bind one atlas texture unless a deliberate multi-sampler
  path is implemented and measured.
- Split draw slices on render-state compatibility: shader variant, atlas set, atlas texture binding,
  blend mode, depth write/test, alpha test, cull/two-sided mode, and other non-varying GL state.
- Alpha-test/cutout materials may enter atlas batching when compatible. Blended transparency remains
  direct/staged/fallback until sorting and depth-write behavior are explicitly modeled.
- Materials with texture velocity or UV animation stay direct/staged/fallback until shader and
  strategy support exists.
- Atlas generations are immutable. Old generations stay alive while draw units, compacted batches,
  or staged entries reference them, then retire through resource graph cleanup and owning stores.
- Debug metrics must distinguish direct texture, atlas texture, flat fallback, missing decompressed
  prepared texture, atlas full, source texture too large, material-table overflow, unsupported render
  state, blended transparency fallback, animated UV fallback, and mip/repeat derivative fallback.

## Ownership Model

```mermaid
flowchart TD
  assets["Prepared assets"] --> incubation["Readiness / incubation"]
  scene["Scene models"] --> incubation
  incubation --> assembly["Staged world assembly"]
  assembly --> graph["RendererResourceGraph"]
  assembly --> strategy["Staged material strategy"]
  strategy --> direct["Direct texture / flat staged resources"]
  direct --> webgl2Scene["WebGL2 draw units"]
  webgl2Scene --> submit["State-cached WebGL2 submitter"]

  strategy -. future atlas candidates .-> layout["Atlas layout planner"]
  layout -. future atlas plan .-> compaction["Render compaction scheduler"]
  compaction -. atlas generation + compacted buffers .-> graph
  compaction -. compacted draw slices .-> submit
```

Assembly turns ready scene objects into complete renderable facts. WebGL2 resource realization owns
GL buffers, VAOs, textures, programs, and disposal. The material strategy decides eligibility and
fallback reasons. The atlas layout planner is pure placement logic. Later compaction is the duty
cycle that decides when to build or retire atlas generations and compacted static buffers.

## Scheduling Principles

- Do not make atlas-backed compaction the first proof of a material feature. Direct/staged material
  rendering should keep common objects visible before compaction exists.
- Do not make atlas layout the first continuation phase. Pure layout does not make materials
  visible; staged direct material completion does.
- Do not advance to broader material metrics before staged sampler correctness is fixed. Textures are
  visible now, so lost repeat/clamp metadata and disabled mipmaps are real rendering bugs rather
  than future polish.
- Do not rebuild atlas pages every time one renderable hydrates. Newly assembled objects enter
  staged direct/fallback rendering first. Later compaction runs on its own duty cycle.
- Keep layout, material strategy, resource realization, and compaction separate. The atlas layout
  planner should not inspect material recipes or allocate GL resources.
- Use injected capability interfaces at assembly/compaction boundaries where tests need fake asset,
  graph, and resource stores. Do not let future compaction reach directly into WebGL2 resource maps
  or asset-channel internals.
- Treat render policy/backend config changes as scene rebuild events. Do not build a broad live
  migration system for those cases until there is evidence it is needed.
- Keep debug overlays outside material strategy, atlas layout, and compaction.

## Phase M1: Staged Direct Material Completion

Status: Complete.

Purpose: make staged WebGL2 draw units render with their resolved per-surface/material-slot
materials whenever WebGL2 can represent those materials directly. Atlas candidacy should be recorded
as future compaction metadata, not used as a reason to render the staged object flat.

Tasks:

- Rework staged material strategy so `atlas` is not the active staged render strategy. For staged
  rendering, a material slot should resolve to one of:
  - direct texture;
  - direct color/flat material when that is the material's actual behavior;
  - explicit unsupported fallback with a concrete reason.
- Keep atlas eligibility as an additional fact on a staged material decision, for example
  `atlasEligibility` or `compactionCandidate`, rather than replacing the direct render strategy.
- Audit static staged assembly: each draw unit should represent one geometry subset for one material
  slot/surface/variant and should bind that slot's resolved texture/material state when supported.
- Audit structured interior staged assembly against the same rule. Cell structures should not stay
  flat merely because they would be atlas candidates in a future compaction pass.
- Make normalized prepared texture requests match the staged direct material policy. Common static
  and structured-interior material slots should request the decompressed base-level payloads needed
  for direct WebGL2 texture upload.
- Preserve and bind UV buffers for direct-texture staged draw units only when the active shader uses
  them.
- Keep unsupported cases explicit and metric-visible: missing material recipe, missing render
  surface, missing normalized prepared texture, indexed/paletted unsupported, detail unsupported,
  animated UV unsupported, blended transparency unsupported, sampler unsupported, and texture upload
  unsupported.
- Update diagnostics so flat fallback means "unsupported or unresolved," not "eligible for future
  atlas."
- Add tests for:
  - atlas-eligible material slots still resolving to direct staged texture rendering;
  - multi-surface static objects producing separate staged draw units with separate materials;
  - structured interior surfaces following the same direct/fallback policy;
  - unsupported material reasons remaining explicit;
  - no partial object commit while sibling material slots are unresolved.

Exit criteria:

- Common static/building and structured-interior staged draw units render textured when their
  per-slot material can be represented by WebGL2 direct texture rendering.
- Flat fallback is limited to genuinely unsupported or unresolved material cases.
- Atlas eligibility is preserved for future compaction without blocking staged visibility.
- Diagnostics explain why any visible draw unit is flat.

Progress:

- Changed the active staged material resolver so atlas-ready compressed materials resolve as
  `direct-texture` when their normalized prepared texture is present.
- Added `atlasEligibility` metadata to direct staged material strategies. Future atlas planning can
  still see the atlas entry key, material slot key, sampling key, render-state key, and prepared
  texture input without turning staged rendering flat.
- Removed the staged fallback message that treated a resolved atlas strategy as an unwired render
  mode. Flat fallback now means the material is unresolved or unsupported.
- Added normalized prepared texture asset IDs to direct staged material dependencies when that
  direct texture came from an atlas-ready prepared texture.
- Audited static staged assembly with test coverage proving separate material-slot subsets produce
  separate direct-texture draw units and texture keys.
- Audited structured-interior material strategy with test coverage proving it follows the same
  direct staged policy as static renderables.
- Confirmed the existing static readiness tests already cover no partial commit for composed
  objects and unresolved material dependencies; no new readiness path was needed in M1.

Decisions:

- `atlas` remains a future planner/layout output, but `resolveStagedWorldMaterialStrategy()` no
  longer returns it as an active staged render strategy.
- Direct-color render surfaces that WebGL2 can upload directly are no longer tagged with
  `direct-color-normalization-deferred` as a fallback reason. They are direct materials, not
  degraded materials.
- WebGL2 staged direct materials reject compressed upload objects even if runtime S3TC capabilities
  are present. The current WebGL2 direct submit path accepts decompressed direct uploads only; source
  compressed upload support remains deferred.

Course corrections:

- The future atlas planner currently derives atlas candidates from `direct-texture.atlasEligibility`
  instead of from the active staged strategy kind. Phase M2 should keep that separation and avoid
  reintroducing an active staged `atlas` material mode.
- The test default sampler expectation was corrected to the current clamp/clamp material sampling
  policy. Repeating sampler support remains future material work, especially for atlas compaction.

Cleanup targets and legacy shims:

- The `planStagedWorldMaterialStrategies()` API now returns `atlasLayoutDecisions` instead of
  `materialStrategies`, making it explicit that `atlas` entries are future layout decisions rather
  than active staged material render strategies.
- `direct-color-normalization-deferred` is now unused as an active staged fallback reason. Keep it
  only if M2/M3 finds a real reporting use; otherwise remove it with the next material metrics pass.
- Texture upload fallback reasons still collapse several direct upload failures into broad material
  reasons. M2 should split metric labels for missing normalized prepared texture versus unsupported
  direct upload path where practical.

## Phase M1A: Staged Direct Sampler and Interior Material Slot Fix

Status: Complete.

Purpose: correct the direct staged material path now that textures are visible. Buildings and other
setup-backed static objects need their authored repeat/clamp sampler variants preserved, staged
direct normalized textures need mipmaps where legal, and structured interiors need their geometry
surface indices mapped through env-cell material slots instead of being interpreted as material
asset IDs.

Why this phase is immediate:

- Screenshot inspection after M1 showed many static objects rendering with real textures, but
  buildings/walls show severe smeared UVs. The most likely cause is clamp sampling on surfaces whose
  UVs intentionally repeat outside `0..1`.
- Code inspection confirmed static setup parts with explicit material slots currently use
  `part.materialSlots` directly in `deriveStagedStaticSurfaceKeys()`. That path does not expand
  per-triangle `materialVariantSignature` values from the prepared render geometry, so
  `sampler=repeat` can be lost before WebGL2 material resolution.
- Code inspection also confirmed structured-interior staged assembly currently calls
  `resolveStagedWorldSurfaceMaterialPlan()` with `triangle.surfaceId`. The Three.js path maps
  `cell.surfaceIds` into material slots and treats geometry surface IDs as slot indices. WebGL2
  should do the same. The current WebGL2 path can therefore look for `material/00000000` or other
  slot-index recipes instead of the env-cell surface material IDs, explaining why interior cell
  structures stay flat even when non-indexed material assets are available.
- The normalized prepared-texture upload path disables mipmaps because it was originally designed as
  atlas input. Staged direct rendering now reuses that path, so it should be allowed to generate GPU
  mipmaps from the decompressed base level when the active direct sampler requests mips. Future atlas
  inputs still stay non-mipmapped and generate atlas mips after packing.

Tasks:

- Add a renderer-neutral helper that expands a geometry/material slot list into staged surface keys
  using prepared polygon `materialVariantSignature` values, matching the Three path's
  `applyRenderGeometryMaterialVariants()` behavior without importing Three material concerns.
- Update static staged assembly so setup-backed/static parts with explicit material slots split by
  both material slot and geometry sampler variant. `sampler=repeat` and `sampler=clamp` must reach
  `resolveStagedWorldMaterialSlotPlan()`.
- Update structured-interior staged assembly so each geometry surface ID is treated as a slot index
  into `cell.surfaceIds`, with material asset IDs derived from the mapped env-cell surface material.
  Preserve per-triangle material variants for those slots.
- Update staged direct material strategy to select sampler policy from
  `materialVariantSignature`, matching the Three material path's
  `parseLegacySamplerMaterialVariantSignature()` handling.
- Enable GPU mipmap generation for staged direct normalized `rgba8` prepared texture uploads when
  the selected sampler requests mip filtering and the texture dimensions are legal for WebGL2
  mipmaps. Do not request source software mips for this path.
- Keep future atlas eligibility/input policy non-mipmapped. Atlas pages still generate their own
  padded mip chain after packing in a later compaction phase.
- Add diagnostics/metrics samples for direct material sampler policy so clamp/repeat/mip choices can
  be inspected without opening WebGL state.
- Add tests for:
  - setup/static material slots preserving repeat sampler variants from polygon geometry;
  - structured-interior geometry surface indices mapping through `cell.surfaceIds`;
  - structured-interior direct material resolution for a non-indexed surface;
  - normalized direct texture upload generating mipmaps when sampler policy requests them;
  - atlas eligibility still referencing non-mipmapped normalized prepared texture input.

Exit criteria:

- Building/wall static draw units that carry repeat sampler variants render with repeat sampling
  instead of clamp smearing.
- Staged direct normalized textures use mip filtering/generation where WebGL2 supports it.
- Structured-interior non-indexed surfaces can resolve direct textures through env-cell material
  slots rather than falling back because of slot-index material IDs.
- Future atlas input policy remains non-mipmapped and distinct from the active staged direct sampler.

Course corrections for following phases:

- Phase M2 should consume the sampler and material-slot fixes from M1A when reporting
  atlas-eligible staged direct materials.
- Phase M3 should still own indexed/paletted interior and terrain texture support. M1A only proves
  non-indexed structured-interior materials can reach the existing direct texture path.
- If M1A shows that many interior surfaces are indexed/paletted, M3 should include an explicit
  before/after diagnostic count for indexed interior surfaces, not just terrain/setup appearances.

Progress:

- Added shared `selectVariantTextureSamplingPolicy()` behavior in the texture sampling policy module
  and routed both the Three material constructor and WebGL2 staged material strategy through it.
- Updated static staged assembly so material-slot-backed geometry expands by polygon
  `materialVariantSignature`. Repeat/clamp sampler variants now reach direct staged material
  resolution instead of being flattened to the part-level slot.
- Updated structured-interior staged assembly so geometry `surfaceId` values are interpreted as
  slot indices into `cell.surfaceIds`, with material asset IDs derived from the mapped env-cell
  surface material. This fixes the slot-index-as-material-ID failure path for non-indexed interior
  surfaces.
- Changed normalized `rgba8` prepared texture direct uploads to preserve active mip filtering and
  generate GPU mipmaps whenever the selected staged direct sampler uses a mipmapped minification
  filter. The prepared texture asset request itself remains `mips=none`.
- Added WebGL2 resource metrics for direct texture sampler policy counts and samples.
- Added tests for static repeat sampler preservation, structured-interior material slot mapping,
  normalized direct upload mip generation, WebGL2 mipmap generation, and sampler diagnostics.
- Added targeted WebGL2 texture upload diagnostics after visual validation still showed black
  textured materials. The debug panel now reports representative uploaded texture keys, dimensions,
  upload format/type, mip generation policy, first pixel, first nonzero-alpha pixel, and nonzero
  RGB/alpha counts from the first sampled texels. Upload-time WebGL errors are also surfaced through
  fallback diagnostic samples. This is intended to distinguish black source bytes, failed/incomplete
  texture upload, and later shader/sampling failures before making another rendering change.
- Used the diagnostics to identify the black-texture regression: compressed-source materials were
  decompressed to RGBA8 and assigned a mipmapped sampler, but the inherited compressed sampling
  policy had `generateMipmaps=false`. WebGL therefore sampled incomplete textures and returned
  black. The normalized RGBA8 direct upload path now generates GPU mips based on `mipFilter`, not on
  the source compressed texture's native mip-generation flag.
- Reverted the interim diffuse-tint submitter change because the diagnostic data proved the black
  output was texture completeness, not material diffuse tinting.

Decisions:

- The source prepared texture policy remains non-mipmapped. Staged direct rendering may generate GPU
  mips from that decompressed base level, while future atlas compaction still generates mip chains
  from packed atlas pages.
- Structured interiors now follow the Three path's material slot interpretation: geometry surface IDs
  are slot indices, not material asset IDs.
- The geometry/material-slot expansion helper is local to staged assembly for now because only staged
  assembly needs the staging-specific key shape today.
- Normalized RGBA8 direct uploads are WebGL2-owned texture resources, even when their source render
  surface is compressed. Their mip-generation policy must be derived from the active WebGL2 sampler,
  not from the source compressed texture policy.

Course corrections:

- Phase M2 should treat sampler policy as part of candidate reporting and dedupe. A direct texture
  with `repeat` and one with `clamp` are not equivalent future atlas candidates.
- M3 should still investigate indexed/paletted interior surfaces separately. M1A only fixes direct
  non-indexed interior material plumbing.
- M2 diagnostics should keep upload completeness visible enough to catch sampler/upload mismatches.
  A future atlas or indexed path can hit the same class of bug if the texture's min filter requires
  mips that were not generated or supplied.

Cleanup targets and legacy shims:

- If M2 or M3 needs geometry/material-slot expansion outside staged assembly, extract the helper into
  a renderer-neutral module instead of copying it.
- `resolveStagedWorldSurfaceMaterialPlan()` remains as a fallback route, but structured interiors now
  use explicit slots. M2 should audit whether the surface-only resolver is still needed outside
  terrain/fallback cases.
- WebGL2 sampler diagnostics currently live on direct texture draw units only. If indexed/paletted
  WebGL2 materials are added in M3, extend the same metric shape to those resource types.
- The new texture upload diagnostics are intentionally narrow and temporary. Remove or compress them
  once the black-texture regression is proven and fixed so the render debug panel does not become a
  permanent dump of per-texture internals.

## Phase M2: Material Candidate Metrics and Structured Interior Unification

Status: Complete.

Purpose: after staged materials are visible, make atlas candidate reporting consistent across static
and structured-interior draw units without realizing atlas resources.

Tasks:

- Audit current WebGL2 structured-interior material resolution against staged static material
  resolution.
- Route structured interior surface requirements through `staged-world-material-strategy.ts` for
  direct/fallback decisions and atlas-candidate metrics.
- Let structured interiors contribute stable `atlasEligibility` records for future atlas generation
  without folding per-cell geometry into static compaction.
- Add metrics that distinguish direct texture, atlas-eligible-but-not-realized, flat fallback,
  animated UV fallback, missing normalized prepared texture, and sampler policy.
- Add tests that static and structured-interior candidates dedupe by compatible render surface,
  usage, transfer, sampler policy, material variant, and render-state signature.
- Reshape or clearly rename the future atlas planner result so staged direct material decisions and
  future atlas layout decisions are not both called material strategies.

Exit criteria:

- Static and structured-interior materials share material strategy behavior and fallback reasons.
- Structured interiors remain independent draw units, not static compacted geometry.
- Atlas candidate dedupe is proven across renderable families without realizing atlas GPU resources.
- Diagnostics can report atlas-eligible staged direct materials without implying an atlas texture is
  currently bound.

Progress:

- Preserved `atlasEligibility` on staged direct texture material plans instead of dropping it at the
  `StagedWorldMaterialPlan` boundary. Static and structured-interior draw units can now remain
  direct-rendered while still carrying future atlas candidate facts.
- Added WebGL2 resource-store metrics for atlas-eligible direct draws, unique candidate atlas
  entries, unique candidate material slots, and representative candidate samples.
- Routed the new candidate metrics through `WorldRenderDebugMetrics`, the WebGL2 metrics adapter,
  and the browser debug panel. The diagnostics now distinguish direct texture rendering from
  atlas-eligible-but-not-realized materials without claiming an atlas is bound.
- Renamed the future atlas planner result from `materialStrategies` to `atlasLayoutDecisions`.
  This removes the most confusing remaining luma-era naming seam: active staged material decisions
  are direct/fallback plans, while `atlas` records are layout/planning outputs.
- Added coverage proving atlas-eligible direct WebGL2 materials report candidate metrics while still
  using the staged direct texture path.
- Kept the existing strategy coverage proving static and structured-interior requirements dedupe to
  a shared atlas entry when render surface, prepared texture input, transfer, sampler policy,
  material variant, and render state are compatible.

Decisions:

- Runtime candidate metrics are derived from staged direct draw units, not from the offline atlas
  layout planner. This keeps diagnostics aligned with what the scene is actually rendering.
- Candidate identity is split across entry and material-slot counts. The same texture entry may be
  shared by many renderable families, while sampler/render-state/material-variant differences remain
  distinct material slots for future draw slicing.
- Structured interiors continue to render as independent staged draw units. They can contribute
  atlas candidate facts now, but compaction must not fold per-cell geometry into static batches until
  a later, explicit compaction phase.

Course corrections:

- Phase M3 should continue using direct staged rendering as the visual proof path. Indexed/paletted
  and terrain materials should add candidate/fallback metrics only after their direct resource DTOs
  exist.
- The debug panel now has enough candidate signal to avoid resurrecting the old “flat because atlas
  is not realized” ambiguity. Future fallback text should stay specific: missing normalized texture,
  unsupported indexed/palette payload, animated UV, blended transparency, or sampler/render-state
  incompatibility.
- The current candidate samples are intentionally compact strings. If Phase M3 adds indexed or
  terrain candidate support, prefer extending the same summary shape over adding per-material log
  spam.

Cleanup targets and legacy shims:

- The function name `planStagedWorldMaterialStrategies()` still says “material strategies” even
  though its return shape now says `atlasLayoutDecisions`. Rename the function when M6 extracts the
  atlas layout planner so call sites do not mix staged strategy resolution with future layout.
- The temporary `textureUploadSamples` diagnostics remain useful while M3 adds indexed/terrain
  texture paths, but they should be compressed or removed once texture completeness bugs are no
  longer active.
- `direct-color-normalization-deferred` remains unused as an active fallback reason after M2. Remove
  it during the M3 fallback-reason cleanup unless indexed/terrain DTO work uncovers a real use.

## Phase M3A: Terrain Base Materials

Status: Complete.

Purpose: close the highest-volume visual material gap before indexed/paletted setup work: terrain
blend materials. Terrain moves ahead of portal passes because material visibility is the current
scene-inspection blocker.

Tasks:

- Port terrain blend shader behavior from `terrain-blend-materials.ts` into WebGL2-friendly shader
  and resource code.
- Reuse the existing terrain material preparation/cache facts where they are renderer-neutral, but
  keep WebGL2 GL texture/program ownership inside the WebGL2 resource store.
- Preserve current BVH terrain draw-unit visibility and only replace the flat terrain material path.
- Add diagnostics for terrain material table readiness, missing terrain material tables, missing
  terrain render surfaces, unsupported blend surfaces, and terrain shader fallback.
- Keep detail textures, indexed/paletted setup appearances, and texture velocity out of this phase.

Exit criteria:

- Terrain renders with recognizable AC base terrain materials and roads in WebGL2.
- Terrain fallback reasons are explicit enough to identify missing tables versus unsupported
  surface/texture data.
- Static/setup/interior indexed materials may still be flat fallback after this phase.

Progress:

- Added a renderer-neutral terrain blend plan module that resolves terrain pcodes into base,
  overlay, road, and alpha-mask texture references without creating Three materials or GL resources.
- Added WebGL2 staged terrain draw units split by terrain pcode when terrain material resources are
  ready. Flat terrain fallback remains in place when the terrain material table/resource plan is not
  ready.
- Extended staged terrain geometry so pcode-specific draw units emit terrain UVs while preserving
  the existing whole-tile flat debug geometry path.
- Added a `terrain-blend` staged material plan kind for multi-texture terrain materials. This keeps
  terrain blend state separate from the single-texture direct material path.
- Added WebGL2 terrain blend resource realization in the WebGL2 world resource store. Terrain
  texture GL ownership stays in WebGL2 resources and reuses the existing texture cache/disposal path.
- Added a WebGL2 terrain blend shader/program and submit path with base terrain, up to three terrain
  overlays, and up to two road alpha overlays. Detail textures remain out of scope for this phase.
- Added focused tests for the renderer-neutral terrain blend plan and kept existing terrain,
  staged-geometry, staged-assembly, WebGL2 resource, and submit tests passing.

Decisions:

- Terrain material rendering uses one staged draw unit per resolved pcode instead of per-tile
  material groups. This matches the current WebGL2 retained draw-unit model and avoids adding
  indexed draw ranges before the submit path has a broader batching/compaction story.
- The WebGL2 terrain path intentionally ports the existing Three shader behavior for base,
  terrain-overlay, road-overlay, alpha rotation, and repeat/clamp sampling, but excludes landscape
  detail overlays until M3D.
- Terrain blend textures currently use WebGL2 direct uploads through the existing render-surface
  upload helper. Compressed terrain surfaces still require the normalized prepared texture path just
  like staged direct materials.

Course corrections:

- M3B should treat the new renderer-neutral terrain blend plan as the pattern for indexed material
  DTO work: resolve multi-resource material facts first, then let WebGL2 resource realization own GL
  textures/programs.
- M3C should avoid folding indexed/paletted materials into the single-texture direct path. Terrain
  proved that distinct multi-texture material kinds are cleaner and easier to diagnose.
- M3D should reuse the terrain blend plan's explicit omission of detail overlays and add them as a
  deliberate material feature, not as part of terrain base parity.

Cleanup targets and legacy shims:

- Terrain pcode selection logic now exists in both `terrain-blend-materials.ts` and
  `terrain-blend-plan.ts`. Keep both until Three comparison is retired, then move the shared pure
  logic behind the renderer-neutral plan and have any remaining Three path consume it.
- WebGL2 terrain blend submit uploads terrain material uniforms per draw. This is acceptable for the
  staged baseline, but future batching/compaction should group by terrain material key and reduce
  redundant uniform/texture binding churn.
- Terrain material graph records still do not lease terrain material dependencies per pcode draw
  unit. If M3B/M3C expands renderer-resource graph visibility for multi-resource materials, include
  terrain blend draw units in the same cleanup.
- Terrain blend diagnostics currently rely on terrain resource-plan status plus resource realization
  fallback behavior. If visual testing finds white terrain draw units from failed texture
  realization, add explicit WebGL2 terrain upload fallback samples before M3B.

## Phase M3B: Indexed/Paletted Texture DTO Extraction

Status: Not started.

Purpose: extract renderer-neutral indexed texture and palette DTOs from Three-era helpers before
adding WebGL2 uploads. This keeps the shared material/resource pipeline honest and testable without
mixing DTO design with GL upload behavior.

Tasks:

- Extract Three-free indexed texture and palette byte DTOs from the existing indexed/palette
  resource helpers.
- Include palette, derived palette, indexed texture dimensions/bytes, index bit depth, palette
  binding, and transfer metadata needed by both WebGL2 and future non-Three renderers.
- Add a multi-resource indexed material DTO that binds the indexed render surface, base palette
  selection, optional derived palette, material recipe, sampler policy, render state, and appearance
  palette context into one resolved material fact.
- Model palette selection explicitly:
  - setup appearance palette override when present;
  - otherwise material recipe palette;
  - otherwise render-surface default palette.
- Model setup subpalettes as derived palette inputs. Derived palette DTO creation should copy the
  selected base palette and apply each subpalette asset range before WebGL2 sees the palette.
- Add DTO support for neighbor-packed indexed upload payloads:
  - P8 packs four neighboring indices into `RGBA8` channels for manual bilinear filtering.
  - P16 packs four neighboring indices into `RGBA16UI` channels for manual bilinear filtering.
- Preserve raw indexed DTOs as source facts. Neighbor-packed payloads are renderer-prepared
  derivatives, not replacements for the decoded source data.
- Keep indexed mip DTOs out of this phase. Correct mip color depends on the palette, so hardware or
  palette-independent index mips are not acceptable as a default.
- Preserve material/readiness dependency reporting for indexed surface textures, base palette assets,
  setup palette overrides, and every subpalette palette asset.
- Add readiness tests proving a composed object with subpalette-dependent indexed materials is not
  admitted to staged rendering until material recipe, indexed render surface, base palette, and all
  subpalette assets are resolved or intentionally fallback-resolved.
- Add tests that DTO extraction matches current Three-rendered indexed material inputs and that P8
  and P16 neighbor packing handles edge texels deterministically.
- Add tests for derived palette DTO range validation, missing subpalette diagnostics, and stable
  derived palette keys that include base palette, override source, subpalette IDs, offsets, counts,
  and prepared-state/version.
- Keep compressed direct upload deferred unless runtime extension detection and memory evidence
  justify it. The current atlas-prep path should keep using decompressed normalized payloads.

Exit criteria:

- Indexed material facts, palette data, derived palette data, and neighbor-packed P8/P16 derivatives
  can be produced without importing Three resources.
- DTO tests cover representative setup/static and structured-interior indexed materials.
- Setup appearance palette overrides and subpalettes are dependency-visible and key-stable.
- No WebGL2 shader/upload work is required to complete this phase.

## Phase M3C: WebGL2 Indexed/Paletted Direct Materials

Status: Not started.

Purpose: render indexed/paletted setup and structured-interior materials directly in WebGL2 using
the DTOs from M3B. This is still staged/direct rendering, not atlas compaction.

Tasks:

- Add WebGL2 uploads for palette, derived palette, and neighbor-packed indexed texture resources
  after DTO extraction.
- Upload one resolved palette texture per indexed material palette fact. If setup subpalettes apply,
  WebGL2 receives the already-derived palette texture rather than applying subpalette patches in the
  shader.
- Upload P8 neighbor-packed textures as `RGBA8`.
- Upload P16 neighbor-packed textures as `RGBA16UI` and sample them through a WebGL2 integer texture
  path (`usampler2D`/`texelFetch`).
- Query/runtime-gate the integer texture path and report `indexed-uint16-texture-unsupported` if the
  required WebGL2 behavior is unavailable.
- Add a WebGL2 indexed/paletted material shader path for staged draw units.
- Do indexed filtering manually in the shader: nearest sample the packed-neighbor texel, lookup four
  palette colors exactly, then bilinear blend colors using the original UV texel-local fractional
  coordinates.
- Disable indexed mipmapping for now and report mip use as unsupported/deferred for indexed
  materials. Do not generate hardware mips over index values.
- Route static/setup and structured-interior indexed surfaces through the same staged material
  strategy/fallback reporting model used by direct RGBA materials.
- Add diagnostics for missing indexed payloads, missing base palette payloads, missing setup palette
  override payloads, missing subpalette payloads, invalid subpalette ranges, unsupported palette
  variants, missing integer texture support, indexed no-mip fallback, and indexed material
  upload/shader fallback.
- Keep indexed atlas participation deferred. Neighbor-packed indexed textures may use RGBA-like
  storage, but they require palette shader state and are not equivalent to ordinary RGBA base-color
  atlas entries.
- Keep detail overlays and texture velocity out of this phase.

Exit criteria:

- P8 and common P16 indexed/paletted setup appearances render close enough for visual inspection
  with shader-side bilinear filtering.
- Structured-interior indexed/paletted surfaces use the same material-slot interpretation as
  non-indexed interiors.
- Setup appearance palette overrides and subpalettes affect WebGL2 indexed output through derived
  palette resources, not shader-side patch logic.
- Indexed materials have explicit no-mip diagnostics rather than silently pretending mip support
  exists.
- Remaining indexed/paletted material differences are explicit, metric-visible, and backed by
  examples.

## Phase M3D: Detail Texture Policy and Static Detail Support

Status: Not started.

Purpose: add detail texture behavior only after base terrain and indexed/paletted direct materials
are understandable. Detail should be a controlled material feature, not a masking layer over broken
base materials.

Tasks:

- Audit detail texture usage across terrain, setup/static, and structured interiors using existing
  material/resource metadata.
- Decide which static/non-animated detail combinations WebGL2 should support directly before atlas
  compaction.
- Add shader/resource support for the selected direct detail path if it materially improves visual
  parity.
- Keep unsupported detail combinations explicit in diagnostics instead of silently flattening them.
- Do not implement texture velocity or animated UV application here; leave those as animation-system
  owned future work.

Exit criteria:

- Supported static detail texture cases render intentionally in WebGL2, or the phase records that
  detail should stay deferred with measured examples.
- Unsupported detail cases are counted separately from missing base materials.
- Texture velocity remains a metric-visible fallback, not an active renderer-owned timer.

## Future Phase: Texture Velocity and UV Animation System Integration

Status: Deferred.

Purpose: apply texture velocity/animated UV materials through a shared animation/time system rather
than a WebGL2-only timer. Texture velocity should remain a resolved material fact in the shared
pipeline, but active per-frame UV animation belongs with broader animation scheduling.

Tasks:

- Preserve texture velocity signatures as material metadata and fallback diagnostics in M3 phases.
- Design shared animation timing/uniform update ownership before enabling animated UV rendering.
- Add WebGL2 shader uniforms and submit-time updates only after the animation system can drive them
  consistently.

Exit criteria:

- Animated UV materials use the same frame-time source and update lifecycle as other animated scene
  systems.
- WebGL2 no longer needs a one-off material timer for texture velocity.

## Phase M4: Portal Passes in WebGL2

Status: Not started.

Purpose: restore portal stencil/depth/composite rendering against the WebGL2 renderer without
mutating scene visibility per portal pass, after the core staged/terrain material path is visible
enough to make portal views useful to inspect.

Tasks:

- Reuse the existing portal work item and clipped BVH candidate planning where it remains
  renderer-neutral.
- Add explicit WebGL2 portal pass submission phases:
  - aperture mask/stencil pass;
  - portal depth reset or depth-scoped pass as needed;
  - clipped scene composite pass;
  - normal scene pass.
- Keep portal mask geometry as separate draw units or pass work items; do not run it through
  material atlas planning.
- Keep per-portal clipped candidate selection in frame/pass planning, not in resource stores.
- Add metrics for portal work item counts, skipped aperture cases, stencil-visible candidates, and
  fallback/unmasked cases.
- Add tests for pass ordering, stencil state setup, clipped candidate plumbing, and empty/invalid
  aperture handling.

Exit criteria:

- Outdoor-to-indoor and indoor-to-outdoor portal views render through WebGL2.
- Portal rendering uses explicit WebGL2 pass state rather than Three scene mutation or luma-era
  abstractions.
- Portal work remains separate from material batching and atlas compaction.

## Phase M5: Visual Parity and Material Hardening

Status: Not started.

Purpose: audit and harden the WebGL2 staged/direct material path before introducing atlas-backed
static compaction.

Tasks:

- Audit direct-color texture edge cases not covered by M2/M3.
- Audit alpha test, clip, depth-write, cull/two-sided, and blend behavior for foliage, fences,
  windows, and portals.
- Audit sampler wrapping/repeating behavior for direct textures and future atlas candidates.
- Audit coordinate handedness and matrix conventions against Three.js, especially static placement,
  terrain packing, and chunk re-anchoring.
- Add visual/debug scenarios for:
  - outdoor terrain with blended roads;
  - buildings with direct textures;
  - indexed/paletted setup appearances;
  - indoor cell shells;
  - indoor statics seen through outdoor portals;
  - outdoor scene seen from indoor portal;
  - wireframe and no-material modes.
- Fix or document known material differences before compaction makes debugging harder.

Exit criteria:

- Common material differences are either fixed or explicitly accepted with examples.
- No common material code imports Three-specific resource classes.
- WebGL2 can run the normal browser-mode workflow with known gaps tracked in metrics.

## Phase M6: Atlas Layout Planner Extraction

Status: Not started.

Purpose: extract atlas page/rect placement into a pure helper separate from material strategy,
resource realization, and compaction scheduling. This phase is compaction prep; it is not expected
to change visible materials by itself.

Tasks:

- Move atlas entry placement logic out of `staged-world-material-strategy.ts` into a dedicated pure
  layout module.
- Inputs should be atlas entries with stable keys, dimensions, gutters, and capacity policy.
- Outputs should include atlas texture pages, rects, atlas texture indices, and explicit overflow
  results for source-too-large and atlas-full cases.
- Keep material semantics out of the layout planner. Material strategy owns recipes, render states,
  usages, sampler compatibility, and fallback reasons.
- Preserve deterministic ordering for stable atlas generations.
- Keep or add tests for multi-atlas page layout, deterministic placement, source-too-large,
  atlas-full, and gutter policy.

Exit criteria:

- Atlas layout can be tested without WebGL2, prepared assets, material recipes, or renderer graph
  stores.
- `staged-world-material-strategy.ts` can ask a pure planner for placement without owning rectangle
  packing.
- Future compaction can consume material strategy output plus layout output without either module
  allocating GPU resources.

## Phase M7: Atlas-Backed Static Compaction Vertical Slice

Status: Not started.

Purpose: add atlas-backed render compaction after direct materials, structured interiors, portals,
terrain/indexed material parity, and visual hardening are far enough along that compaction is a
batching/correctness change rather than the first material-rendering milestone.

Lifecycle target:

- Readiness/incubation remains the first gate.
- Scene assembly creates complete staged entries first.
- Newly assembled static objects remain visible through staged direct/fallback rendering.
- Compaction runs on a separate duty cycle and collects compactable staged/current membership.
- Compaction uses material strategy output plus atlas layout output to build immutable atlas
  generations and compacted static buffers.
- Re-anchor-only updates adjust draw-time transforms only. They must not repack atlases, rewrite UVs,
  or rebuild compacted/staged vertex buffers.

Tasks:

- Add a compaction scheduler that decides when staged static entries are ready enough to compact.
- Consume atlas-capable material strategy output and M6 atlas layout output for compatible static
  renderables.
- Realize atlas set generations as one or more WebGL2 atlas textures using normalized base-level
  prepared texture payloads.
- Generate mipmaps after packing and gutter extrusion.
- Implement a material-index table shader path. Start with bounded uniform arrays and partition draw
  slices when material slots exceed the limit.
- Include atlas texture index in material-slot data. Conservative slices bind one atlas texture unless
  a multi-sampler path is deliberately implemented.
- Preserve author UVs and encode enough material/sampler data for repeat/clamp behavior within atlas
  slots.
- Keep direct-texture, flat-fallback, unsupported, blended, and animated-UV materials on staged paths.
- Deduplicate direct staging textures by texture key while staged objects wait for or bypass
  compaction.
- Allow staged entries to opportunistically use an existing immutable atlas generation only when all
  required surfaces already exist in that generation and no mutation is required.
- Register atlas generations, compacted buffers, draw slices, material decisions, and prepared
  texture dependencies in `RendererResourceGraph`.
- Retire old atlas generations and compacted buffers through graph cleanup and owning WebGL2 stores.
- Add tests for compaction scheduling, atlas generation reuse, old-generation retirement,
  material-table partitioning, multi-atlas slice partitioning, repeat/clamp sampling data,
  staged-object no-rebuild behavior, fallback handling, and re-anchor-only updates.

Exit criteria:

- Common textured static objects can render through atlas-backed compacted WebGL2 batches.
- Staged direct/fallback rendering remains the visible fallback for unsupported or not-yet-compacted
  objects.
- Atlas generations and compacted buffers are retained and retired through the renderer graph.
- Large material sets split into deterministic draw slices that reuse shared buffers.
- Re-anchor-only updates reuse compacted buffers and atlas resources.

## Phase M8: Performance Gate and Three.js Retirement Decision

Status: Not started.

Purpose: prove whether the WebGL2 path has replaced the practical value of the Three.js backend for
the normal browser workflow.

Tasks:

- Compare WebGL2 and Three.js on the same dense outdoor scene:
  - load time;
  - steady FPS looking at the scene;
  - steady FPS looking away;
  - visible draw count;
  - CPU profile shape;
  - material and portal visual coverage.
- Profile portal-heavy scenes and static-heavy scenes separately.
- Confirm material/portal gaps are either closed or explicitly accepted.
- Decide whether Three.js remains a comparison backend, becomes a debug-only backend, or can be
  removed in a later cleanup plan.

Exit criteria:

- WebGL2 has credible visual and performance parity for the common browser-mode workflow.
- Remaining renderer gaps have named owners/phases.
- The project has an explicit decision about the future of the Three.js backend.

## Cleanup Targets

- Rename shared metrics fields that still use `BatchCount` terminology once WebGL2 metrics stabilize.
- Preserve prepared-texture diagnostics in WebGL2 resource records so texture byte counts and fallback
  explanations are accurate.
- Revisit the per-frame WebGL2 draw-unit sort after M3-M7 reshape the submit path.
- Split renderer-neutral material sampling DTOs from any Three adapter names/imports if they still
  imply Three ownership.
- Keep renderer graph APIs explicit around node identity, dependency edges, leases, disposal
  candidates, and cycle prevention.
- Avoid compatibility shims for retired luma names. Rename call sites instead.

## Footguns

- Do not reintroduce luma terminology into active modules.
- Do not alias old luma behavior to WebGL2.
- Do not add atlas-backed compaction before common materials are visible through direct/staged paths.
- Do not pack blended transparency into opaque atlas batches.
- Do not silently drop unsupported sampler, UV animation, indexed, or palette behavior.
- Do not let atlas layout allocate WebGL resources or inspect material recipes.
- Do not let compaction mutate atlas generations in place.
- Do not rebuild compacted buffers on camera re-anchor alone.
- Do not call synchronous GL queries in hot paths.
- Do not route debug overlays through material strategy or compaction.
