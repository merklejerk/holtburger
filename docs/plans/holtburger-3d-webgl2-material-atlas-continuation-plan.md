# Holtburger 3D WebGL2 Material, Portal, and Atlas Continuation Plan

Status: Phase M7.1 complete; Phase M7 atlas-backed static draw substitution next.

Related plans:

- [Holtburger 3D WebGL2 Renderer Pivot Plan](./holtburger-3d-webgl2-renderer-pivot-plan.md)
- [Holtburger 3D Luma Renderer Swapout Plan](./holtburger-3d-luma-renderer-swapout-plan.md)
- [Holtburger 3D Portal Depth Copy Postmortem](./holtburger-3d-portal-depth-copy-postmortem.md)

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

Status: Complete.

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

Progress:

- Added renderer-neutral palette DTO extraction in `palette-data.ts`, including ARGB-to-RGBA byte
  conversion, palette asset IDs, copied source ARGB data, and derived palette construction.
- Moved derived palette range validation and stable derived palette key construction out of the
  Three resource helper. The Three `derived-palette-resources.ts` adapter now delegates to the pure
  DTO helper before creating a `DataTexture`.
- Added renderer-neutral indexed texture DTO extraction in `indexed-material-data.ts`, including
  format classification, source length validation, copied source bytes, dimensions, max palette
  index scanning, and render-surface asset IDs.
- Added renderer-neutral indexed material DTO resolution that binds material recipe, indexed render
  surface, selected palette, optional derived palette, sampler policy, legacy behavior metadata, and
  prepared asset dependencies into one material fact.
- Added explicit palette selection order for indexed materials: setup appearance override first,
  material recipe palette second, render-surface default palette third.
- Added neighbor-packed indexed derivatives:
  - P8 produces an `RGBA8`-shaped byte payload containing current/right/down/diagonal indices.
  - P16 produces an `RGBA16UI`-shaped unsigned-short payload containing current/right/down/diagonal
    indices.
  - Edge neighbor policy follows the resolved sampler wrap mode, so repeat wraps edge neighbors and
    clamp keeps edge neighbors pinned.
- Kept the old Three indexed texture resource wrapper as an adapter over the new DTO extraction
  rather than leaving duplicate decode/validation logic in the Three path.
- Added focused tests for indexed DTO extraction, P8/P16 neighbor packing, setup palette override
  precedence, derived palette application, missing subpalette diagnostics, and dependency visibility.

Decisions:

- Neighbor-packed payloads are renderer-prepared derivatives. Raw indexed source bytes remain the
  source DTO so future upload paths can choose different packing or filtering strategies without
  reparsing render surfaces.
- Derived palettes are produced before renderer upload. WebGL2 should receive a complete palette
  texture for the indexed material, not a base palette plus shader-side subpalette patch commands.
- M3B keeps WebGL2 upload and shader work out of scope. The phase proves the data model and tests
  first, then M3C can consume it for actual rendering.
- Palette DTOs use copied arrays. Renderer/resource code should not mutate prepared asset payloads
  in place.

Course corrections:

- The existing Three helper's `selectIndexedPalette(recipe, renderSurface)` signature is retained as
  a compatibility adapter for current Three call sites, but the new renderer-neutral selector accepts
  the appearance context needed for setup palette overrides.
- The readiness/admission system already tracks setup appearance palette dependency asset IDs. M3B
  added DTO-level proof that missing subpalettes block indexed material resolution and report a
  concrete diagnostic; if M3C finds a composed object entering staged rendering with unresolved
  subpalette assets, add an immediate readiness integration phase before enabling indexed WebGL2
  drawing.

Cleanup targets and legacy shims:

- `indexed-texture-resources.ts` is now a Three adapter. After WebGL2 indexed materials are working
  and Three is no longer the comparison source for indexed behavior, remove the adapter or move it
  under a Three-specific path.
- `palette-resources.ts` now carries the pure palette DTO alongside its Three `DataTexture`. Future
  WebGL2 resources should consume `palette-data.ts` directly and should not depend on the Three
  wrapper.
- M3C should wire `ResolvedIndexedMaterialData` into staged material strategy/resource realization
  and add diagnostics that distinguish missing base palette, missing setup override palette, missing
  subpalette, invalid subpalette range, index out of range, and unsupported P16 integer upload.
- Follow-up visual inspection after M3B confirmed indexed materials currently render as flat WebGL2
  fallback silhouettes because M3C has not added the indexed upload/shader path yet. The staged
  strategy now reports this as `indexed-paletted-deferred` instead of the generic
  `unsupported-render-surface-format` reason, and the debug panel truncates long sample strings so
  fallback/atlas diagnostics stay readable.

## Phase M3C: WebGL2 Indexed/Paletted Direct Materials

Status: Complete.

Purpose: render indexed/paletted setup and structured-interior materials directly in WebGL2 using
the DTOs from M3B. This is still staged/direct rendering, not atlas compaction.

Tasks:

- Add WebGL2 uploads for palette, derived palette, and indexed texture resources after DTO
  extraction.
- Upload one resolved palette texture per indexed material palette fact. If setup subpalettes apply,
  WebGL2 receives the already-derived palette texture rather than applying subpalette patches in the
  shader.
- Upload P8 as an `R8` source-index texture.
- Upload P16 as an `RG8` byte-pair source-index texture and reconstruct `low + high * 256` in the
  shader, matching the known Three indexed shader behavior.
- Add a WebGL2 indexed/paletted material shader path for staged draw units.
- Sample indexed materials with shader-side palette-aware linear filtering over neighboring source
  index texels. Preserve clip-map transparency by treating transparent clip indices as zero-alpha
  palette samples before alpha testing.
- Disable indexed mipmapping for now and report mip use as unsupported/deferred for indexed
  materials. Do not generate hardware mips over index values.
- Route static/setup and structured-interior indexed surfaces through the same staged material
  strategy/fallback reporting model used by direct RGBA materials.
- Add diagnostics for missing indexed payloads, missing base palette payloads, missing setup palette
  override payloads, missing subpalette payloads, invalid subpalette ranges, unsupported palette
  variants, indexed no-mip fallback, and indexed material upload/shader fallback.
- Keep indexed atlas participation deferred. Indexed textures require palette shader state and are
  not equivalent to ordinary RGBA base-color atlas entries.
- Keep detail overlays and texture velocity out of this phase.

Exit criteria:

- P8 and common P16 indexed/paletted setup appearances render close enough for visual inspection
  with shader-side palette-aware linear filtering.
- Structured-interior indexed/paletted surfaces use the same material-slot interpretation as
  non-indexed interiors.
- Setup appearance palette overrides and subpalettes affect WebGL2 indexed output through derived
  palette resources, not shader-side patch logic.
- Indexed materials have explicit no-mip diagnostics rather than silently pretending mip support
  exists.
- Remaining indexed/paletted material differences are explicit, metric-visible, and backed by
  examples.

Progress:

- Added a first-class `indexed-paletted` staged material strategy/plan instead of routing indexed
  materials through `flat-fallback` once their material recipe, indexed render surface, palette, and
  setup subpalette dependencies resolve.
- Threaded setup appearance context into static staged material resolution so palette overrides and
  subpalette patches affect indexed WebGL2 output through the M3B derived-palette DTOs. Structured
  interiors continue to use base/material palette selection.
- Added WebGL2 uploads for indexed textures and resolved palette textures:
  - P8 uses `R8`/`RED`/`UNSIGNED_BYTE`.
  - P16 uses `RG8`/`RG`/`UNSIGNED_BYTE` and reconstructs the palette index from the source byte pair.
  - Index and palette textures are retained in the existing WebGL2 texture store and counted in
    renderer metrics as indexed texture and palette resources.
- Added separate P8 and P16 indexed shader programs. Both use the staged UV buffer and shader-side
  palette-aware linear filtering over neighboring source index texels. Hardware mip generation stays
  disabled for indexed textures.
- Added submit-path support for binding index texture unit 0 and palette texture unit 1, with
  explicit indexed uniforms for texture dimensions, palette size, clip threshold, and wrap flags.
- Added tests for indexed strategy resolution, invalid indexed fallback, WebGL2 indexed resource
  realization, and indexed submit texture/uniform binding.
- Added an Index16 upload regression test proving the WebGL2 source texture stays in the same RG
  byte-pair shape that the Three indexed shader used.

Decisions:

- Indexed materials remain excluded from atlas participation. The palette dependency and shader
  state make them materially different from ordinary RGBA base-color atlas entries.
- Indexed mipmaps remain deferred. Mipping index values directly is wrong, and palette-aware
  prefiltered mip chains should be designed separately if we need them.
- P16 now follows the Three path's normalized two-byte texture reconstruction instead of using a
  WebGL2 integer texture path. This is less novel, keeps comparison behavior straightforward, and
  avoids mixing `usampler2D` with normalized `RG8` uploads.
- Shader-side linear filtering is the current direct-render policy for indexed materials. The
  visible speckles were not caused by bilinear filtering because they persisted with nearest
  sampling; the actual mismatch was the P16 upload/reconstruction path plus missing clip-map
  threshold upload.
- Indexed shaders apply the same clip-map threshold as the Three path (`paletteIndex < 8` for base-1
  clip-map surfaces). For shader-side linear filtering, transparent clip-map indices contribute
  zero-alpha samples before the final alpha test. Palette alpha remains a secondary discard guard,
  but clip-map transparency must not rely on alpha values in the palette.

Course Corrections:

- The old M3B-era `indexed-paletted-deferred` fallback was too broad after DTO extraction. It now
  only represents unresolved/invalid indexed resources or the explicit no-mip caveat, not normal
  indexed material rendering.
- Static material resolution had enough data for setup palette overrides, but the staged strategy
  was not receiving the appearance context. M3C fixed that handoff instead of duplicating palette
  logic in WebGL2 resource upload.
- The initial M3C implementation shipped shader-side manual bilinear filtering. Visual testing
  showed persistent chroma speckles, so the direct path was temporarily changed to nearest-index
  sampling. Follow-up visual testing showed the speckles persisted, proving filtering was not the
  root cause; shader-side linear filtering was restored after correcting the P16 byte-pair
  reconstruction and clip-map threshold upload.
- Compared the WebGL2 indexed shader against the older Three shader and found two mismatches:
  Index16 was uploaded/read as an incompatible integer path instead of reconstructing low/high bytes,
  and the clip-map index discard threshold was computed in resources but never uploaded to the
  shader. Both are now corrected.

Cleanup Targets / Debt:

- The P8/P16 shader programs duplicate most fragment logic. If indexed behavior grows, extract a
  shader-source helper or generator before adding detail/velocity variants.
- `BrowserWorldDisplay` still contains runtime appearance preview plumbing even though the debug UX
  now hides it. Remove or relocate that plumbing before it becomes stale UI debt.
- Indexed diagnostics are now metric-visible, but the generated report should eventually group
  indexed samples by material/render-surface/palette instead of relying on generic texture upload
  samples.
- Indexed mip policy needs a future explicit design. Do not silently enable hardware mipmaps over
  packed index textures.
- Neighbor-packed indexed DTOs are no longer consumed by the direct WebGL2 path. Remove them or move
  them behind a future filtering experiment before M5 hardening if no other path uses them.

## Phase M3D: Detail Texture Policy and Static Detail Support

Status: Complete.

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

Progress:

- Audited the existing Three detail path and confirmed region detail overlays are already applied to
  static buildings and structured interiors through `applyRegionDetailOverlayToMaterials()`.
- Split region detail overlay resolution into a renderer-neutral plan plus the existing Three texture
  material adapter. WebGL2 now consumes the plan without importing Three resource classes.
- Threaded detail overlay plans through staged static and structured-interior material assembly.
  Detail overlays are controlled by the existing browser detail-textures toggle, and toggling now
  rebuilds WebGL2 staged resources.
- Added WebGL2 resource realization for supported region detail textures. Detail textures are
  uploaded as repeat-sampled direct textures and retained through the existing texture store.
- Added direct-texture and indexed/paletted shader support for constant destination-color detail
  blending, matching the current Three building/environment approximation:
  `base * (detail.rgb + (1 - detail.a))`.
- Added metrics visibility for WebGL2 detail overlay texture resources and test coverage proving a
  building direct-texture draw unit realizes a detail overlay texture.

Decisions:

- M3D supports only building and environment region detail roles in WebGL2. Those are the roles with
  an existing destination-color blend policy and are the practical static/interior detail cases.
- Landscape detail remains owned by the terrain material path. It has separate source-alpha,
  distance-fade behavior and should not be conflated with static building/interior detail.
- Object/scenery detail remains disabled because the existing shared detail policy intentionally has
  no blend mode for the `object` role. Do not invent one without retail/ACE/ACViewer evidence.
- Detail overlays stay staged/direct only. They are not atlas candidates and do not participate in
  static compaction until atlas material tables can represent multi-texture material state.
- Texture velocity remains deferred. M3D does not add a renderer-local time source or animated UV
  uniforms.

Course Corrections:

- The phase name said "static detail," but the audited Three path applies the same region detail
  concept to structured interior cell shells through the `environment` role. M3D includes that path
  so WebGL2 does not regress indoor material parity.
- The implementation uses raw/base-color prepared texture selection for detail textures in WebGL2
  rather than the terrain-specific `usage=detail` single-channel policy. Static building/environment
  detail samples RGB and alpha, while terrain masks/detail still use their existing specialized
  upload policy.
- WebGL2 resource sync originally treated the detail-textures toggle as metrics-only. M3D made it a
  scene resource rebuild input so the toggle actually adds/removes detail overlay resources.

Cleanup Targets / Debt:

- WebGL2 detail overlay diagnostics currently surface as upload/fallback samples, not a dedicated
  grouped detail-overlay diagnostic table. M5 should group detail failures by
  region/role/surface-texture/render-surface.
- The direct-texture, P8 indexed, and P16 indexed shaders now duplicate the small destination-color
  detail helper. Extract shader-source helpers before adding more material variants.
- Detail overlays use the existing general texture store but do not yet contribute generated
  prepared-texture byte totals separately from base textures. Preserve this distinction before M5
  reporting hardening.
- Atlas compaction must treat detail overlays as incompatible with single-texture atlas slices until
  a deliberate multi-texture material-table design exists.

## Phase M3D.1: WebGL2 Texture Filtering UX Policy

Status: Complete.

Purpose: correct WebGL2 sampler policy plumbing discovered after M3D. The browser filtering select
was reflected in metrics, but WebGL2 resource upload prep still used hidden default sampler policy
inputs. This made the UX misleading and risked comparing Three and WebGL2 with different effective
sampler state.

Tasks:

- Detect WebGL2 material texture capabilities, including maximum anisotropy, during renderer
  initialization.
- Thread the browser texture filtering mode into staged material strategy resolution and WebGL2
  terrain/detail upload prep.
- Rebuild WebGL2 staged resources when the filtering mode changes so retained texture keys and
  sampler parameters are regenerated.
- Keep indexed texture storage outside the UX filtering policy. Indexed materials continue to use
  nearest raw index textures; palette-aware filtering is shader-owned.

Progress:

- Added explicit `textureFilteringMode` plumbing through staged scene assembly, material plan
  resolution, and direct-texture strategy sampling policy selection.
- WebGL2 now stores detected material texture capabilities on renderer resources and passes them
  into resource sync. `anisotropic-4x` remains the default/target policy; if the browser exposes no
  anisotropy extension or reports a low cap, policy selection degrades to ordinary linear mip
  filtering.
- WebGL2 direct material uploads, terrain blend texture uploads, and static/interior detail overlay
  uploads now use the active filtering mode and detected capability object.
- Changing the browser filtering mode now calls WebGL2 resource sync instead of only updating
  metrics.
- Added focused WebGL2 resource coverage proving direct uploads use 4x anisotropy when capability
  allows it and rebuild to nearest/no-mips when the UX mode is changed to nearest.

Decisions:

- The UX filtering policy applies to direct color, compressed, terrain, and detail textures. It does
  not apply to indexed raw index textures because those must remain exact integer/byte lookups for
  palette reconstruction and clip-map semantics.
- Capability degradation stays in `createDefaultMaterialTextureSamplingPolicy()`: requesting
  `anisotropic-4x` with `maxAnisotropy <= 1` yields linear mip filtering with anisotropy 1 rather
  than a fallback UI mode change.

Course Corrections:

- Earlier M3D notes treated WebGL2 detail toggle sync as the only UX-backed resource rebuild issue.
  Filtering mode had the same class of bug: renderer state and metrics changed, but already prepared
  WebGL2 resources did not. M3D.1 fixes that before portal work.
- WebGL2 terrain and detail uploads had local default capability calls. They now consume the same
  renderer-level capability/filtering policy as staged direct materials.

Cleanup Targets / Debt:

- Texture color-space mode still deserves the same audit. WebGL2 currently reports the UX value, but
  color-space policy plumbing is not covered by the M3D.1 filtering fix.
- Anisotropy extension lookup happens both during capability detection and sampler application.
  This is acceptable for now, but a future WebGL2 context capability object could cache the extension
  enum for cleaner sampler application.

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

## Phase M4A: WebGL2 Portal Mask Resource Prep

Status: Complete.

Purpose: add an immediate prep slice before full portal compositing because the WebGL2 path had no
stencil buffer and no aperture mask draw-unit resources. Full portal rendering cannot be correct
until masks are represented separately from normal scene geometry.

Tasks:

- Request a stencil-capable WebGL2 context.
- Stage transition portal aperture masks as WebGL2 draw-unit resources using the existing
  renderer-neutral portal candidate model.
- Transform portal mask geometry through the same render-chunk and AC placement matrix path as
  structured interiors.
- Bind portal masks to their existing portal BVH item keys so frame selection and diagnostics can
  account for them.
- Keep portal masks out of the normal world submit order; they must be submitted only by explicit
  portal pass code.
- Add test coverage proving visible portal masks are partitioned away from normal world draws.

Exit criteria:

- WebGL2 owns portal aperture mask buffers/VAOs alongside other staged resources.
- Portal masks are counted as `portal-mask` frame candidates without drawing into the base world
  pass.
- The browser creates WebGL2 with stencil storage available for upcoming pass work.

Progress:

- Added `portal-mask` as a first-class staged draw-unit kind/category.
- Added staged portal mask draw-unit assembly from committed transition portal candidates. The
  geometry triangulates aperture polygons and applies render-chunk offset plus the aperture's
  chunk-local placement.
- Reused `deriveTransitionPortalMaskBatchBvhBinding()` so portal masks retain the same BVH identity
  as the Three path.
- Updated WebGL2 resource realization to accept the new staged draw-unit kind without treating masks
  as static/material scene geometry.
- Added `planWebgl2PortalMaskSubmitOrder()` and filtered masks out of
  `planWebgl2FlatWorldSubmitOrder()`. This prevents accidental base-pass aperture drawing before
  explicit stencil/depth/composite passes exist.
- Switched WebGL2 context creation from `stencil: false` to `stencil: true`.
- Routed portal-mask visible draw counts into WebGL2 debug metrics.

Decisions:

- Portal mask resources live in staged WebGL2 resources for now because they share buffer/VAO
  ownership and lifecycle with other retained draw units. Their pass policy remains submitter-owned.
- The normal flat world submitter must not draw `portal-mask` units. Future portal pass submission
  will opt into those masks explicitly.
- M4A does not fake a portal composite. Rendering a convincing but wrong portal would hide the
  remaining depth-reset and clipped-scene work.
- After M4A, the portal strategy pivoted away from redrawing clipped scene geometry per portal
  depth. The target design is now dual scene-domain render targets plus iterative stencil/depth
  compositing. This keeps expensive scene draw-unit submission bounded to the exterior and interior
  domain renders while preserving portal occluders through copied depth.

Course corrections:

- The original M4 was too large for one clean step because WebGL2 had a missing prerequisite: no
  stencil context and no aperture mask resources. M4A was added as an immediate interim phase.
- Full portal parity should now continue as a dual-target pipeline. Do not resurrect the old plan of
  recursively redrawing clipped interior/exterior scene geometry through each portal pass unless the
  dual-target composite proves incorrect for AC portal semantics.

Cleanup targets and legacy shims:

- Portal masks currently do not register renderer-resource graph leases. M4B should either add graph
  records for mask draw units or document why they are retained only through `drawUnitsById`.
- WebGL2 portal metrics now count visible mask draw units, but portal work-item counts are still
  zero. M4B should derive visible work batches and update work-item/skipped metrics.
- The submitter now has separate flat-world and portal-mask order planners. When M4B adds explicit
  graph-node submission, keep this separation and avoid a boolean flag on the flat submitter.
- The old "portal depth reset" language is superseded by depth-copy compositing. If a reset shader is
  still needed for an intermediate debug path, keep it outside the main dual-target portal pipeline.

## Phase M4B: Dual Scene-Domain Render Targets

Status: Complete.

Purpose: render the two portal scene domains once per frame into offscreen color/depth targets so
portal recursion no longer redraws scene geometry per portal depth. This phase does not need to
solve nested portal compositing yet; it establishes the render-target ownership, scene-domain draw
partitioning, and base copy path.

Strategy:

- Render the exterior domain into `exteriorTarget`.
- Render the interior domain into `interiorTarget`.
- Copy the active base domain's color and depth to the default framebuffer.
- Keep portal aperture masks separate from both scene-domain draw lists.

Tasks:

- Add WebGL2 framebuffer resources for offscreen scene-domain targets with color texture and depth
  texture attachments. Resize them with the canvas and retire them through explicit disposal.
- Detect and fail loudly when required WebGL2 depth-texture/framebuffer capabilities are unavailable.
- Partition staged world draws into exterior-domain and interior-domain draw lists:
  - terrain and outdoor statics belong to exterior;
  - structured interiors belong to interior;
  - portal masks belong to neither and remain pass-owned;
  - debug overlays stay out of this phase unless they are needed for validation.
- Refactor the flat world submit path so it can submit a supplied draw list into either an offscreen
  framebuffer or the default framebuffer without rebuilding resources.
- Add a base composite/copy shader that copies color and depth from one scene-domain target to the
  default framebuffer. The shader must write `gl_FragDepth` from the sampled depth texture.
- Preserve current non-portal WebGL2 behavior when portal compositing is disabled or no portal
  candidates are visible.
- Add metrics for exterior-domain draw calls, interior-domain draw calls, render-target dimensions,
  framebuffer completeness failures, and base-copy pass count.
- Add tests for target lifecycle, draw-list partitioning, base-domain selection, framebuffer failure
  reporting, and no portal-mask leakage into scene-domain renders.

Exit criteria:

- WebGL2 can render exterior and interior scene domains into separate offscreen targets each frame.
- The default framebuffer can be populated by copying one domain target's color and depth.
- Scene geometry submission is prepared to be bounded to two domain renders before portal recursion
  is enabled.
- Portal masks remain pass resources, not scene-domain geometry.

Progress:

- Added WebGL2 scene-domain target resources with paired `exterior` and `interior` framebuffers.
  Each target owns an RGB8 color texture and a DEPTH_COMPONENT24 depth texture so later portal
  composites can sample both color and depth.
- Scene-domain targets are created at the canvas backing size, disposed explicitly, recreated on
  resize, and validated with `checkFramebufferStatus()`. Framebuffer failures are reported through
  WebGL2 debug metrics and still fail loudly.
- Split the flat submitter so existing frame submission can still plan visible draw units, while
  domain rendering can submit a supplied draw-unit list into whichever framebuffer is currently
  bound.
- Added draw-list partitioning for the dual-domain model: terrain and statics render into the
  exterior domain, structured interiors render into the interior domain, and portal masks render
  into neither domain.
- Added a full-screen base-copy shader that samples a domain color texture plus depth texture and
  writes both `fragColor` and `gl_FragDepth` to the default framebuffer.
- Added WebGL2 renderer metrics for scene-domain target dimensions, framebuffer failures, exterior
  and interior domain draw counts, per-domain draw calls, and base-copy pass count.
- Added unit coverage for scene-domain target lifecycle and framebuffer failure reporting, plus
  submitter coverage proving portal masks do not leak into either scene domain.

Decisions:

- The target is fixed expensive geometry passes, not fixed total GPU work. Portal depth still costs
  mask/composite iterations, but those iterations should be small aperture/rect fills rather than
  full scene draw-unit redraws.
- Both domain targets use the same camera projection for the first implementation. If AC portal
  semantics require camera transforms later, add explicit projected-coordinate remapping before
  changing the storage model.
- The scene-domain path is currently gated to frames with visible portal mask draw units and a
  positive portal depth limit. Non-portal frames continue using the existing direct default
  framebuffer submit path so ordinary WebGL2 behavior does not regress while portal compositing is
  incomplete.
- The base copy currently uses the exterior target. This is correct for outdoor-origin portal
  bring-up but is not the final base-domain policy for indoor camera views.
- Scene-domain color targets use RGB8 instead of RGBA8 because the portal pipeline uses stencil and
  copied depth to define aperture visibility; target alpha is not part of the composite contract.

Course corrections:

- M4B kept the old `submitWebgl2FlatWorldFrame()` API as the frame-planning entry point and added
  `submitWebgl2FlatWorldDrawUnits()` for supplied domain draw lists. This avoided a broad rename
  while preserving a clean separation between visibility planning and framebuffer ownership.
- Target lifecycle lives outside the general world resource store for now. The targets are
  frame-size resources, not scene-resource graph entries, and they are recreated by the renderer
  when the canvas backing resolution changes.

Cleanup targets and legacy shims:

- Existing `submitWebgl2FlatWorldFrame()` naming is now a compatibility shim for frame-planned
  submission. Rename the submitter API family when M4C adds explicit mask/composite submission so
  the names describe scene-domain and composite responsibilities.
- WebGL2 render metrics still use several "batch" terms from older Three/luma phases. Preserve
  compatibility during M4B, but mark renamed metrics for M5 if they become confusing.
- Base-copy metrics are frame-level and do not yet expose source-domain selection. M4B.1 should add
  that before M4C.
- Scene-domain target framebuffer failure metrics only report samples after an attempted target
  creation. If creation fails during a render frame, the renderer still throws; add graceful
  degradation only if we need to keep the app alive on browsers without the required attachments.
- RGB8 color targets assume WebGL2 framebuffer completeness for this attachment format. If browser
  coverage proves weaker than expected, add an explicit RGB8 capability probe/fallback rather than
  silently returning to RGBA8.

## Phase M4B.1: Base-Domain and Portal Work-Item Prep

Status: Complete.

Purpose: close the immediate M4B policy gap before full residency is wired into WebGL2. M4C needs
explicit visible portal work items and a temporary base-domain bridge, but correct portal rendering
also needs real camera residency before stencil/depth compositing starts.

Why this phase is immediate:

- M4B deliberately copies the exterior target as the base scene. That is enough to validate
  offscreen color/depth target ownership, but indoor camera views need to copy the interior target
  first before compositing outward portals.
- M4A/M4B metrics can count visible portal mask draw units, but M4C needs direction, parent stencil
  ref, depth, screen bounds, and skipped-reason accounting from transition portal work items.

Tasks:

- Derive a temporary WebGL2 base scene domain from the existing render-scene context and loaded
  structured-interior availability.
- Thread the selected base domain into the scene-domain copy path and debug metrics.
- Build the WebGL2 visible portal work-item plan from the existing transition portal candidate
  model without reintroducing clipped scene redraw as the primary composite strategy.
- Keep work items tied to M4A portal mask draw units so M4C can draw aperture masks by explicit
  pass code.
- Add tests for base-domain selection, metric reporting, and portal work-item visibility/counting
  without drawing portal composites yet.

Exit criteria:

- The WebGL2 scene-domain copy path no longer hard-codes exterior as the base scene.
- Metrics report the selected base scene domain and visible portal work-item counts.
- M4C can consume a visible portal work-item list with mask draw-unit IDs, stencil refs, depth, and
  direction without changing scene-domain render target ownership.

Progress:

- Added a WebGL2 portal work planner that maps visible `portal-mask/*` draw units back to
  transition portal candidates and derives `TransitionPortalWorkItem` records with the existing
  shared `createTransitionPortalWorkItem()` helper.
- Reused `deriveTransitionPortalDepthBatches()` so WebGL2 portal work follows the same recursive
  direction and interior-frontier filtering rules as the Three comparison path.
- Added WebGL2 base scene-domain selection. Dungeon/interior render contexts with loaded structured
  interior cells copy the interior scene-domain target first; outdoor and unavailable-interior
  contexts copy the exterior target.
- Threaded the selected base domain into WebGL2 scene-domain target copy and debug metrics through
  `renderGraphBaseScene`.
- Added WebGL2 portal metrics for candidate work-item count, visible work-item count, and masked
  interior cell count.
- Added unit coverage for base-domain selection, visible mask-to-work-item planning, and
  interior-base frontier filtering.

Decisions:

- M4B.1 uses visible portal mask draw units as the WebGL2 work-item visibility input. This keeps
  work planning tied to the same staged/BVH visibility path that owns mask resources.
- WebGL2 derives portal direction from the transformed aperture plane and camera position, but does
  not yet calculate screen-space aperture rectangles. Rect planning belongs to M4C because it is
  part of the actual stencil/composite pass contract.
- Until WebGL2 has its own camera residency query, base-domain selection uses the existing
  render-scene context plus structured-interior availability. This handles explicit dungeon/interior
  destinations now and avoids copying a blank interior target when no interior cells are loaded, but
  it is not sufficient for free-camera portal traversal.

Course corrections:

- The original M4B.1 wording referenced camera residency directly. The WebGL2 renderer does not yet
  compute or publish camera residency like the Three path, so this phase uses render-scene context as
  an interim bridge and records true WebGL2 residency as an immediate prerequisite phase.
- Portal work planning intentionally does not resurrect clipped-BVH scene redraw. It only prepares
  mask draw-unit IDs, directions, depth batches, and masked interior counts for the dual-target
  compositor.

Cleanup targets and legacy shims:

- `submitWebgl2SceneDomainFrame()` still keeps the portal work plan local to
  `webgl2-world-display-renderer-impl.ts`. M4C should pass explicit depth batches into mask and
  composite submission helpers rather than letting the renderer implementation grow into a pass
  scheduler god function.
- WebGL2 still lacks Three's detailed portal skipped-reason metrics for outside-frustum,
  back-facing, too-small, and missing aperture cases. M4C should add screen-space visibility and
  skipped-reason accounting when it adds bounded composite rectangles.
- WebGL2 base-domain selection must consume actual camera residency before M4C. Do not treat the
  current render-scene-context bridge as final portal policy.
- The transformed aperture-plane helper assumes the existing portal mask model matrices are affine
  placement transforms. If future mask transforms include non-uniform scale/shear, replace the
  normal transform with a full inverse-transpose plane transform.

## Phase M4B.2: Shared Camera Residency for WebGL2

Status: Complete.

Purpose: make camera residency a renderer-agnostic input or helper so WebGL2 can choose the correct
base scene, initial env-cell frontier, and residency metrics before stencil/depth portal compositing.

Why this phase is immediate:

- Three computes camera residency internally from `residencyIndex.queryDetailed(...)` and reports it
  through `deriveBrowserCameraResidency()`. WebGL2 currently no-ops `setCameraResidencyChangeHandler`
  and does not use `renderSpatialQuery`, so it cannot inherit that result.
- Portal compositing depends on whether the camera is currently in exterior space, a specific
  env-cell, or an unknown/fallback region. The M4B.1 render-scene-context bridge is only good enough
  for explicit browser destination mode, not free-camera traversal.
- `deriveTransitionPortalDepthBatches()` needs the correct initial env-cell for interior-base
  portals. Guessing from `structuredInteriorScene.focusEnvCellId` is insufficient once the camera
  moves between loaded interior cells.

Tasks:

- Extract or expose a shared camera residency query path that both Three and WebGL2 can call without
  depending on Three camera objects or scene graph state.
- Feed WebGL2's current `SceneCameraFrame.position` into the shared residency query each frame when
  a render spatial query/residency source is available.
- Implement WebGL2 `setCameraResidencyChangeHandler()` and report residency changes with the same
  `BrowserCameraResidency` shape used by Three.
- Use actual residency to select WebGL2 base scene domain:
  - `env-cell` -> `interior`;
  - `outdoor-landblock` -> `exterior`;
  - `unknown` -> `exterior` with diagnostic/fallback metrics.
- Use the actual env-cell residency as the initial interior frontier for
  `deriveTransitionPortalDepthBatches()`.
- Update WebGL2 metrics to report `cameraViewResidency`, `residencySource`, landblock/env-cell
  counts, and fallback details from the shared residency query instead of placeholder values.
- Add tests covering outdoor, env-cell, unknown/fallback, handler notification, and initial
  frontier selection for portal work planning.

Exit criteria:

- WebGL2 reports camera residency through the existing renderer contract instead of no-oping it.
- WebGL2 base-domain selection and portal depth-batch initial env-cell come from actual camera
  residency, not render-scene context or focused-cell fallbacks.
- The M4B.1 render-scene-context bridge is removed or demoted to a fallback used only when the
  shared residency query is unavailable.
- M4C can assume the base scene and initial interior frontier are correct for free-camera portal
  traversal.

Progress:

- Wired WebGL2 to build and retain the shared `WorldResidencyIndex` from structured interior cells,
  render chunk transforms, and render-scene context. This reuses the same renderer-neutral residency
  query path that the Three backend already uses.
- WebGL2 now queries camera residency each frame from the current `SceneCameraFrame.position`.
- Implemented WebGL2 `setCameraResidencyChangeHandler()` so browser-mode observers receive
  `BrowserCameraResidency` updates from `deriveBrowserCameraResidency()` instead of a no-op.
- Replaced WebGL2 base-domain selection with actual camera residency:
  - `env-cell` selects `interior`;
  - `outdoor-landblock` and `unknown` select `exterior`.
- Replaced the focused-cell fallback for portal depth batching with the current env-cell residency
  when the camera is actually in an env-cell.
- Updated WebGL2 metrics to report camera residency text, residency source, residency index counts,
  AABB candidate count, BSP match count, and AABB fallback count from the shared residency query.
- Added pure WebGL2 portal work tests covering residency-backed base-scene selection and initial
  portal env-cell selection.

Decisions:

- Camera residency is a renderer-shared concern, not a Three implementation detail. The WebGL2
  backend must not duplicate Three scene graph residency logic.
- Keep browser-mode UX policy outside the shared residency helper. The helper should answer
  "where is this camera position?" and return diagnostics; renderer/UI code can decide how to
  present or react to that result.
- WebGL2 does not need to consume `renderSpatialQuery` for camera residency. The existing
  `WorldResidencyIndex` is already the renderer-neutral API; M4B.2 wires that directly into the
  WebGL2 backend.
- Unknown residency intentionally selects the exterior base domain. That matches the existing Three
  policy's diagnostic/fallback stance and avoids copying an arbitrary interior target when the
  camera is outside known env-cell bounds.
- The M4B.1 render-scene-context base-domain helper remains only as a compatibility/fallback helper
  for tests and future unavailable-residency cases. The active WebGL2 render path now uses actual
  residency.

Course corrections:

- The phase text assumed a new shared residency query might need to be extracted. Code inspection
  showed the shared `buildWorldResidencyIndex()` path already existed; the missing work was WebGL2
  ownership, per-frame querying, callback reporting, and metrics wiring.
- Handler notification is keyed by residency kind, landblock, env-cell, and source so repeated
  frames do not spam unchanged residency events.

Cleanup targets and legacy shims:

- The WebGL2 `setCameraResidencyChangeHandler()` no-op has been replaced with real callback
  reporting.
- The old `deriveWebgl2BaseSceneDomain()` render-scene-context helper is now a fallback shim. Remove
  or rename it after M4C proves no tests or unavailable-residency paths need it.
- WebGL2 residency still does not drive picking APIs; `pickTerrainLandblockAtViewportPoint()` and
  `pickAtViewportPoint()` remain null. That is outside M4 portal rendering but should be revisited
  when WebGL2 becomes the primary backend.
- WebGL2 metrics now report residency query diagnostics, but the debug labels still use older
  `renderGraph*` naming inherited from Three/luma. M5 should rationalize metric names once portal
  compositing lands.

## Phase M4C: Iterative Stencil/Depth Portal Composite

Status: Core complete; immediate M4C.1 hardening required.

Purpose: composite portals by iteratively drawing visible aperture masks to stencil and copying
color/depth from the opposite scene-domain target through screen-space portal bounds. This preserves
occluders because every composite writes both color and depth back to the default framebuffer before
the next aperture mask depth-test.

Pipeline target:

1. Render `exteriorTarget` once.
2. Render `interiorTarget` once.
3. Copy the camera's base scene target color/depth to the default framebuffer.
4. For each visible portal depth up to the configured limit:
   - draw all aperture masks for that depth with stencil/depth state;
   - composite the opposite scene target through bounded/scissored screen-space portal rects where
     the stencil ref matches;
   - write sampled color and sampled depth (`gl_FragDepth`) into the default framebuffer.

Tasks:

- Reuse transition portal visibility/work-item planning for direction, visible side, screen area,
  recursion-depth batching, and skipped aperture diagnostics.
- Replace clipped-scene redraw planning with scene-domain target compositing. `derivePortalClippedBvhVisibility()`
  should remain available for diagnostics/comparison, but it is no longer the main composite input.
- Draw portal aperture masks from M4A draw units with explicit stencil state:
  - depth 1 writes stencil ref 1 where the aperture depth-tests against the current default depth;
  - deeper masks test the parent stencil ref and write/increment to the current depth ref;
  - masks must write no color;
  - masks must depth-test against the current composited default depth so current-scene occluders
    hide downstream portals.
- Add a portal composite shader that samples a source domain color/depth target and writes both
  color and `gl_FragDepth`.
- Composite with bounded screen-space rects rather than fullscreen quads. Start with one rect per
  visible portal aperture, scissored to the projected aperture bounds and parent bounds where
  available.
- Add a later-merge hook for nearby/overlapping portal rects, but do not implement aggressive rect
  union until metrics prove fill rate needs it.
- Keep the configured recursion depth as a correctness/performance cap. This strategy fixes scene
  geometry pass growth, not the mathematical need for iterative portal crossings.
- Add metrics for visible work-item count, mask pass count, composite pass count, composite rect
  count, estimated composite pixel area, skipped/invalid aperture counts, stencil-visible candidate
  count, and max composited depth reached.
- Add tests for mask/composite ordering, parent stencil behavior, depth-copy shader state,
  per-portal rect planning, multiple portals at the same depth, empty/invalid aperture handling, and
  no scene-geometry redraw during portal composite iterations.

Exit criteria:

- Outdoor-to-indoor and indoor-to-outdoor portal views render through WebGL2.
- Portal rendering uses two scene-domain geometry renders plus iterative mask/composite passes
  instead of recursively redrawing clipped scene geometry.
- Current-scene occluders affect downstream portal visibility through the default framebuffer depth
  copied from prior composites.
- Multiple visible portals at the same depth composite correctly without forcing a single wasteful
  fullscreen or whole-union blit.
- Portal work remains separate from material batching and atlas compaction.

Progress:

- Extended WebGL2 portal work items with projected screen rectangles and estimated pixel area.
- Added one scissored composite rectangle per visible portal aperture instead of a fullscreen or
  same-depth union blit.
- Added iterative WebGL2 portal composite execution after the base scene-domain copy:
  - draw each visible portal depth batch to stencil using M4A portal-mask draw units;
  - use depth testing against the current default framebuffer depth so current-scene occluders can
    block downstream portals;
  - composite the opposite scene-domain color and depth target through the matching stencil ref;
  - write sampled depth via the existing scene-domain copy shader's `gl_FragDepth`.
- Kept scene geometry bounded to the two scene-domain renders. Portal iterations draw only mask
  geometry and screen-space composite triangles.
- Added WebGL2 metrics for transition mask pass count, interior/exterior composite pass counts,
  composite rect count, estimated composite pixel area, and max composited depth reached.
- Added portal-work test coverage for screen-rect planning.

Decisions:

- Fullscreen composite quads are acceptable only for bring-up/debug. The default path should use
  aperture screen bounds and scissor to keep fill rate proportional to visible portal area.
- A single union rectangle for all same-depth portals is not the default. Prefer one rect per
  aperture first, then add measured rect merging when it reduces total cost.
- Fixed total passes for unbounded portal depth is not a goal. The project goal is fixed scene
  geometry renders plus bounded/metric-visible composite iterations.
- WebGL2 cannot test one stencil ref and replace with a different ref in one draw. The compositor
  uses replace for depth 1 and parent-ref test plus stencil increment for deeper masks, matching the
  sequential stencil-ref model.
- The first WebGL2 compositor path uses a full-screen triangle shader clipped by per-portal scissor
  rectangles. That keeps shader code simple while bounding fill to projected aperture rectangles.

Cleanup targets and legacy shims:

- Remove or clearly demote old clipped-BVH composite counters once dual-target metrics are proven.
- The existing Three path can remain as a comparison backend, but new WebGL2 portal code should not
  copy Three's scene-mutation/layer toggling model.
- Portal mask and composite pass submission currently live inside
  `webgl2-world-display-renderer-impl.ts`. Extract pass helpers before adding more portal state or
  debug overlays.
- The projected aperture rectangle path currently drops portals with all vertices behind the camera
  and clamps visible vertex bounds; it does not yet do full near-plane polygon clipping. M4C.1 should
  harden this before broader visual validation.

Course corrections:

- M4C initially looked like it might need a separate copy shader. The M4B scene-domain copy shader
  already samples color/depth and writes `gl_FragDepth`, so M4C reuses it for both base copy and
  portal composite.
- Parent bounds intersection is deferred to M4C.1. The stencil test already prevents child portals
  from drawing outside the parent stencil region, but metrics/fill estimates still use each
  aperture's own projected rectangle.

## Phase M4C.1: Portal Composite Clipping and Static Domain Stabilization

Status: Complete.

Purpose: harden the first WebGL2 portal compositor before broader fill-rate/visual work. M4C has the
core dual-target stencil/depth pipeline, but close/partially clipped portal apertures exposed an
unstable screen-rect path, and staged static draw units were all being routed to the exterior
scene-domain target even when owned by interior env cells.

Why this phase is immediate:

- Per-aperture scissor rectangles are bounded but currently based on projected visible vertices
  rather than full near-plane clipped aperture polygons. Close or partially clipped portals can
  produce conservative or missing rects.
- Static object draw units already carry enough staged ownership to distinguish `exterior-static`
  and `interior-static`, but WebGL2 partitioning ignored that ownership and put all statics in the
  exterior target.

Tasks:

- Replace simple projected-point bounds with near/frustum-clipped aperture polygon projection for
  WebGL2 portal work items.
- Carry static render-domain ownership through staged WebGL2 draw units and use it for
  scene-domain partitioning.
- Add tests for partially clipped portals and interior/exterior static partitioning.

Exit criteria:

- WebGL2 portal work-item planning produces stable bounded rects for close, edge-of-screen, and
  partially clipped apertures.
- Interior-owned static objects no longer render into the exterior scene-domain target.
- M4C.2 can focus on parent rects and skipped-reason diagnostics rather than the immediate visual
  artifacts reported during first portal testing.

Progress:

- Replaced WebGL2 portal screen-rect projection with homogeneous clip-space polygon clipping against
  the six frustum planes before converting to viewport bounds. This matches the clipping model used
  by the Three portal visibility helper and prevents near-plane vertices from being dropped out of
  the scissor calculation.
- Added a regression test for a portal aperture crossing the near plane. The work item remains
  visible and produces the clipped rect instead of disappearing.
- Added explicit `sceneDomain` ownership to WebGL2 draw units and derived it from staged draw-unit
  semantics:
  - terrain -> exterior;
  - structured interiors -> interior;
  - `exterior-static` -> exterior;
  - `interior-static` -> interior;
  - portal masks -> neither.
- Updated WebGL2 scene-domain partitioning to use `sceneDomain` instead of assuming every `static`
  draw unit belongs outside.
- Added partitioning coverage proving indoor statics go to the interior target while outdoor statics
  stay in the exterior target.
- Added a mask-only negative polygon offset around the WebGL2 portal aperture stencil pass. This
  stabilizes aperture stencil coverage when the mask is depth-tested against default-framebuffer
  depth that was copied from an offscreen depth texture.

Decisions:

- Static ownership belongs on the draw unit because the render-domain distinction is already decided
  during staged assembly. Parsing draw-unit IDs in the partitioner would be a brittle shim.
- Portal rect planning should clip in homogeneous clip space, not by dropping vertices with invalid
  `w`. Dropping vertices was the likely cause of camera-distance-dependent holes near transition
  portals.
- Keep parent-rect intersection and skipped-reason metrics as a separate prep phase. They are still
  needed before M4D, but the reported artifact had two sharper causes: near-plane/scissor clipping
  and static domain ownership.
- Portal mask depth bias is intentionally scoped to the mask pass. The scene-domain depth textures
  and composite `gl_FragDepth` writes remain unbiased so downstream occluder depth stays authored.

Course corrections:

- The previous M4C.1 text combined immediate visual stabilization with broader diagnostics. This
  phase now records the stabilization work that landed, and M4C.2 carries the remaining diagnostics
  and parent-rect scope.
- Visual inspection suggests aperture depth precision may still need review if coplanar wall/portal
  masks shimmer after the clipping fix. A follow-up screenshot showed distance-dependent stencil
  loss persisted while close-up coverage looked stable, which points to depth equality/precision
  between copied offscreen depth and re-rasterized aperture masks. M4C.1 added a small mask-only
  polygon offset as the targeted correction.

Cleanup targets and legacy shims:

- `Webgl2WorldDrawUnit.sceneDomain` is now the source of truth for dual-target ownership. Any future
  draw-unit kind should set this explicitly instead of extending kind-based partition logic.
- `StagedStaticDrawUnitAssembly.renderDomain` is currently carried only to derive WebGL2
  `sceneDomain`. If other backends need the same static ownership, promote a renderer-neutral
  scene-domain field in staged assembly rather than duplicating backend-specific mapping.
- Parent portal bounds are still enforced only by stencil during rendering; fill estimates and
  scissor rectangles do not yet intersect with parent rects.
- WebGL2 portal work planning still lacks skipped-reason counters.
- If portal coverage still leaks after the mask-depth bias, inspect mask geometry placement and
  alpha-tested/cutout occluder depth writes before increasing the bias.

## Phase M4C.2: Portal Coverage Triage and Diagnostics

Status: Fixed and cleaned up. Field validation proved the compositor depth copy and normal aperture
mask depth policy were the root cause. Production WebGL2 portal compositing now uses framebuffer
depth blits for portal composite depth transfer and fixed-function `LEQUAL` for aperture masks.
Temporary portal triage controls and renderer branches have been removed after validation.

Purpose: stop guessing about the remaining first-depth portal holes. M4C.1 fixed static
scene-domain ownership, hardened near-plane rect clipping, and added a mask-only depth bias, but
field testing still shows outdoor scene strips through outdoor-to-indoor portals at distance. This
phase must isolate whether the failure is stencil mask coverage, scissor/screen-rect coverage,
composite sampling/state, aperture/depth geometry, or depth-buffer precision before adding
parent-bound optimization work.

Why this phase is immediate:

- The observed artifact occurs on first-depth outdoor-to-indoor portals, so parent portal bounds are
  not the primary suspect.
- The artifact changes with camera distance, which is consistent with depth precision or projected
  coverage drift, but M4C.1's small mask-depth bias did not resolve it.
- Field triage showed `no-composite-scissor` does not change the artifact, while `no-mask-depth`
  removes the shimmering/clipping entirely at the expected cost of losing legitimate occluders. The
  failing pass is therefore the portal aperture mask depth test against already-composited depth.
- Near/far experiments showed contradictory near/far behavior instead of a stable tuning point:
  larger near planes improved far portals but damaged near portals, and shorter far ranges still
  showed banded holes. This makes near/far tuning an unacceptable long-term fix.
- The default browser free camera currently uses a very large far/near range (`near=0.1`,
  `far=5000`). That makes depth precision highly non-linear and can produce distance-dependent
  banding when an aperture mask is re-rasterized against depth copied from an offscreen texture.
- Parent rect intersection and skipped-reason counters are still useful, but they should not be
  implemented before the compositor can prove where pixels are being lost.

Tasks:

- [Done] Add a temporary WebGL2 portal coverage debug mode that can independently visualize
  or force:
  - aperture stencil/mask coverage after the mask pass;
  - composite rectangle/scissor coverage before sampling;
  - final composite source sampling coverage.
- [Done] Add controlled toggles, preferably debug-only renderer options or panel flags, for the
  triage ladder:
  - `no-composite-scissor`: disables composite scissor while keeping stencil enabled;
  - `no-mask-depth`: disables aperture mask depth testing while keeping stencil/composite enabled;
  - `flat-stencil-color`: draws stencil-visible pixels as a flat debug color instead of sampling the
    scene-domain target;
  - `incoming-depth-test`: disables aperture mask depth testing and enables `LEQUAL` depth testing
    for the incoming scene-domain composite pass.
- [Done] Record debug metrics for mask-visible candidate count, composite rect count, rect area,
  and which triage override is active.
  - Existing WebGL2 metrics already report visible portal work item count, composite rect count, and
    estimated pixel area.
  - The temporary active-triage metric was removed with the triage controls after the root cause was
    fixed.
- [Done] Add depth-precision probes for portal triage:
  - report active camera `near`, `far`, and `far/near` ratio in WebGL2 portal debug metrics;
  - add temporary/debug-only near/far overrides for WebGL2 portal rendering experiments;
  - test whether increasing near plane (`1.0` or `2.0`) or reducing far plane (`500` or `1000`)
    reduces the banding/strip artifact;
  - optionally create scene-domain depth textures as `DEPTH_COMPONENT32F` behind a debug option to
    separate offscreen depth texture precision from default-framebuffer precision.
- [Done] Replace the fragile shader depth-copy path and shader-side portal mask comparison with
  production framebuffer/fixed-function depth operations:
  - base scene now copies into an offscreen portal composite target instead of directly to the
    default framebuffer;
  - each portal depth level copies the current composite color/depth/stencil into the alternate
    composite target;
  - portal composite color copies use the fullscreen shader path, while composite depth transfer uses
    `gl.blitFramebuffer(... DEPTH_BUFFER_BIT ...)`;
  - portal aperture masks use fixed-function `LEQUAL` against the copied composite depth buffer;
  - stencil history is blitted between ping-pong composite targets so recursive parent aperture
    tests keep working;
  - final composited color/depth copies to the default framebuffer once all requested portal levels
    are complete.
- If disabling scissor fixes the artifact, fix `screenRect` planning before parent-rect work.
- If disabling mask depth testing fixes the artifact, inspect aperture mask geometry placement,
  copied-depth precision, camera near/far policy, alpha/cutout occluder depth writes, and whether
  the aperture should use a different depth function or mask-specific depth path.
- If near/far overrides materially reduce the artifact, treat depth precision as proven and design a
  real camera clipping/depth policy instead of increasing polygon offset.
- If stencil coverage is solid but sampled composite still has holes, inspect composite shader UVs,
  depth writes, state-cache invalidation around scissor/stencil/depth, and framebuffer target size.
- Add tests for debug-mode planning/state where feasible without writing tests for debug logging.
- After the root cause is fixed, add skipped-reason counters for missing candidate, missing mask draw
  unit, back-facing/missing plane, outside-frustum, too-small, and invalid screen rect.
- After first-depth coverage is stable, intersect child-depth composite rectangles with parent
  portal rectangles where available so fill estimates and scissor bounds better match
  stencil-visible area.
- Add tests for portals behind the camera, multiple same-depth portals, parent rect intersection,
  and skipped-reason accounting after the root-cause fix lands.
- Consider moving mask/composite pass helpers out of `webgl2-world-display-renderer-impl.ts` once
  the pass API stabilizes.

Exit criteria:

- A debug screenshot or metric path can distinguish stencil coverage, scissor coverage, and sampled
  composite coverage for WebGL2 transition portals.
- The current first-depth outdoor-to-indoor portal strip artifact is assigned to a proven root cause
  and fixed, or the plan records a concrete blocker with the exact failing pass.
- Depth precision is explicitly ruled in or out with near/far experiments and, if needed,
  offscreen-depth-format experiments.
- Metrics distinguish visible portal work from skipped/invalid portal candidates.
- Composite pixel-area estimates account for parent rect clipping.
- M4D can focus on measured fill-rate and visual hardening rather than missing planning diagnostics.

Decisions:

- M4C.2 now starts with runtime controls rather than another speculative compositor change. The
  browser settings panel exposes the triage modes so field screenshots can identify the failing
  pass directly.
- `no-composite-scissor` having no visible effect rules out scissor/screen-rect bounds as the cause
  of the current first-depth artifact.
- `no-mask-depth` removing the artifact confirms the aperture mask depth test is the immediate
  failure point. Keep testing with normal depth enabled and adjusted camera near/far before changing
  bias or aperture geometry.
- Near/far range tuning is not a viable product policy. The current direction is to remove the
  fixed-function depth equality dependency from portal masks rather than balance per-camera clipping
  values.
- The portal compositor now owns ping-pong color/depth/stencil targets. This costs an additional
  fullscreen copy per active portal depth, but it keeps the "current composited depth" sampleable and
  avoids sampling from the framebuffer being written.
- Stencil is still the parent-aperture ownership mechanism. Because stencil is not a texture, the
  compositor explicitly blits stencil from the previous composite target to the next target before
  drawing child-depth masks.
- Course correction: the first composite-target version used a sampleable depth texture plus a
  separate STENCIL_INDEX8 renderbuffer, which produced `FRAMEBUFFER_UNSUPPORTED` on the field
  browser/GPU. Composite targets now use packed DEPTH24_STENCIL8 textures attached as
  DEPTH_STENCIL_ATTACHMENT so the framebuffer has a WebGL2-compatible depth/stencil shape while the
  mask shader can still sample the depth component.
- Shader-side mask depth comparison currently uses linearized depth plus a small world-space
  tolerance (`0.5`) and an adaptive screen-space derivative tolerance. Treat those tolerances as
  implementation details to validate, not gameplay or product policy.
- `flat-stencil-color` intentionally disables depth writes for the debug composite. It visualizes
  stencil coverage and should not be interpreted as a faithful recursive-portal output mode.
- Camera near/far metrics are permanent enough to keep: they are useful renderer diagnostics and
  directly explain depth precision risk. The triage override itself remains debug policy.
- Parent-rect clipping is demoted behind first-depth coverage triage. It is still needed for better
  fill estimates, but it cannot explain the current single-depth strip artifact.
- Do not increase the mask polygon offset again until debug coverage proves the aperture depth test
  is the failing pass. Blindly increasing the offset risks letting portals draw through legitimate
  occluders.
- Do not make `DEPTH_COMPONENT32F` the default unless evidence shows `DEPTH_COMPONENT24` is the
  bottleneck and the compatibility/performance cost is acceptable.
- If near/far policy is the root cause, prefer a renderer-level clipping strategy over special-case
  portal hacks. The portal compositor should not depend on fragile depth equality across a
  `50000:1` far/near range.
- Debug rendering controls should be temporary or clearly marked. Keep permanent metrics useful,
  but do not let one-off triage flags become product-facing renderer policy.

Progress:

- Added `WorldDisplayPortalTriageMode` and propagated it through browser mode state, the resource
  coordinator, renderer contract, deferred renderer, WebGL2 renderer, and settings panel.
- Added WebGL2 compositor branches for `no-composite-scissor`, `no-mask-depth`, and
  `flat-stencil-color`.
- Added WebGL2 render metrics for active triage mode plus active camera `near`, `far`, and
  `far/near` ratio. The debug summary now includes those values for quick screenshots/reports.
- Added a browser-local portal depth range selector with `default`, `near=1/far=1000`,
  `near=2/far=1000`, and `near=1/far=500`. The selector modifies the effective camera frame passed
  into the renderer so scene projection, offscreen depth, and mask depth testing stay coherent.
- Added WebGL2 portal composite target creation with RGB8 color and packed DEPTH24_STENCIL8
  depth-stencil textures.
- Added a WebGL2 portal mask depth-compare shader and moved portal compositing into ping-pong
  offscreen targets before the final default-framebuffer copy.
- Added adaptive derivative tolerance to the portal mask depth shader after field testing showed the
  initial shader-side compare still shimmered/clipped like the fixed-function path.
- Field testing showed adaptive tolerance still did not change the artifact. Added
  `depth-delta-color` triage mode to paint the aperture by `portalDepth - sampledSceneDepth` so the
  next screenshot can distinguish wrong/noisy depth samples from wrong aperture depth.
- Added a browser-local terrain rendering toggle to test whether exterior terrain depth under or
  behind the portal opening is poisoning the sampled depth source.
- Added `sampled-depth-color` triage mode and a `flip-y` depth-sample switch to test whether the
  mask shader is sampling a vertically flipped or otherwise misaligned depth texel.
- Added `raw-depth-delta-color` triage mode to compare `gl_FragCoord.z - sampledDepth` before
  depth linearization. This separates raw depth-buffer ordering problems from linearization or
  world-unit tolerance artifacts.
- Added `mask-clear-depth` triage mode. Accepted aperture mask fragments still pass the same manual
  depth comparison, but also write far depth (`1.0`) into the composite depth buffer while writing
  stencil. This tests whether stale accepted-mask depth is poisoning later composite or child-mask
  work.
- Added `incoming-depth-test` triage mode to test the proposed pipeline pivot: use the aperture mask
  as coverage only, then let incoming scene-domain depth test against the current composite depth
  during the fullscreen composite pass.
- Added `aperture-incoming-depth-color` triage mode. The portal mask shader now receives the
  incoming scene-domain depth texture for the current transition level and colors aperture fragments
  by `apertureDepth - incomingSceneDepth`. This compares aperture depth, current/base depth, and
  incoming depth inside the same mask shader and screen-space sample path.
- Added `aperture-raw-depth-color` and `current-raw-depth-color` triage modes to visualize the two
  raw depth values independently before linearization or delta comparison. The shader uses a
  false-color raw-depth ramp instead of plain grayscale because WebGL depth is heavily compressed
  near `1.0`.
- Added `mask-triangle-color` triage mode to draw aperture mask indices one triangle at a time with
  a stable debug palette. This distinguishes real overlapping/triangulation discontinuities from the
  expected periodic bands in the raw-depth false-color ramp.
- Added `fixed-mask-depth` triage mode to bypass shader-side depth sampling/linearization and use
  fixed-function `LEQUAL` depth testing for the aperture mask against the composite framebuffer
  depth. Accepted aperture fragments render green and stop before the incoming composite pass.
- Added `scene-portal-geometry` triage mode to draw portal aperture meshes as ordinary magenta
  geometry directly into the base scene-domain framebuffer before any portal-composite target copy.
  This is the strict no-stencil/no-compositor diagnostic for the simple "portal polygon in the
  scene" case.
- Added `portal-geometry-depth` triage mode to draw portal aperture meshes as ordinary magenta
  opaque geometry against the copied current/base depth, with fixed-function `LEQUAL`, depth writes
  enabled, stencil disabled, and no incoming portal composite.
- Added `portal-geometry-depth-blit` triage mode to run the same copied-composite-target magenta
  geometry test as `portal-geometry-depth`, but with the base scene depth transferred into the
  portal composite target by `gl.blitFramebuffer(... DEPTH_BUFFER_BIT ...)` instead of the shader
  `gl_FragDepth` copy.
- Added `blit-depth-copy` triage mode to A/B the composited-depth copy path. This mode keeps normal
  portal rendering semantics, draws copied color with shader depth writes disabled, and then copies
  the source framebuffer depth into the portal composite target with
  `gl.blitFramebuffer(... DEPTH_BUFFER_BIT ...)`.
- Field testing of the first `blit-depth-copy` attempt showed camera-motion streaking. The likely
  cause was the diagnostic blitting from scene-domain `DEPTH_COMPONENT24` targets into portal
  composite `DEPTH24_STENCIL8` targets. Scene-domain targets now also use packed `DEPTH24_STENCIL8`
  depth-stencil textures so the diagnostic blits between matching depth formats.
- Field testing then showed `scene-portal-geometry` renders the aperture solid in the scene-domain
  target, `portal-geometry-depth` clips after the shader depth copy into the portal composite
  target, and `portal-geometry-depth-blit` renders solid after a depth blit into that same composite
  target. Portal composite copies now use a shader color copy plus framebuffer depth blit by default;
  the final default-framebuffer copy still uses the shader color/depth copy.
- Follow-up field testing showed `portal-geometry-depth` is solid after the depth-blit copy fix, but
  `flat-stencil-color` still has holes. That means the remaining normal mask loss was the
  shader-side manual depth compare itself. Normal aperture masks now use fixed-function `LEQUAL`
  against the copied composite depth buffer.
- Field review of `aperture-incoming-depth-color` showed a large incoming-depth slab that looked
  like grass/terrain. WebGL2 terrain draw units are already exterior-only, so added
  `no-interior-shell` triage mode to render the interior scene-domain target without
  `structured-interior` draw units and test whether the slab is coming from the cell shell rather
  than terrain ownership.
- Added `StagedWorldFrame.cameraFrame` so the mask shader receives the exact near/far values used
  for the frame projection.
- Added focused browser-mode test coverage for preserving the portal triage mode.
- Removed the temporary portal triage state, settings controls, renderer contract options,
  diagnostic shader branches, manual mask-depth compare program, stencil debug composite program,
  terrain-rendering toggle, and near/far override plumbing after the field fix was validated.

Completed validation summary:

- `scene-portal-geometry` proved the aperture polygon itself was ordinary scene geometry and did not
  overlap terrain in the source scene-domain target.
- `portal-geometry-depth` versus `portal-geometry-depth-blit` proved the shader `gl_FragDepth`
  depth-copy path was not equivalent to framebuffer depth transfer for the portal composite target.
- Matching scene-domain and portal-composite targets on packed `DEPTH24_STENCIL8` removed the noisy
  first blit attempt.
- After promoting the depth blit to the normal portal composite copy path, the remaining normal
  aperture holes were isolated to the shader-side manual mask-depth comparison.
- Fixed-function `LEQUAL` aperture masking against the copied composite depth resolved the normal
  terrain/base-scene bands.

Cleanup targets and legacy shims:

- Temporary portal triage modes, depth sample controls, near/far portal override controls, and the
  terrain rendering toggle have been removed from runtime state, settings UI, renderer contracts,
  and WebGL2 pass code.
- The WebGL2 pass helpers in `webgl2-world-display-renderer-impl.ts` are growing. Extract mask,
  copy, and debug-composite pass code after M4C.2 stabilizes the pass contract.
- The offscreen compositor adds another target set beside scene-domain targets. Extract these pass
  resources from `webgl2-world-display-renderer-impl.ts` before M4D if the current design validates.
- Keep camera near/far metrics because they are generally useful depth-precision diagnostics.

## Phase M4D: Portal Fill-Rate and Visual Hardening

Status: Complete; rect merging and extra composite overlays deferred until metrics prove they are needed.

Purpose: harden the dual-target portal compositor after it renders correctly. This phase is about
performance envelope, edge cases, and deciding which portal limits are product policy versus
temporary diagnostics.

Tasks:

- Profile composite fill cost at common desktop and high-DPI canvas sizes.
- Add rect merging only if measured composite fill or draw-call cost justifies it. Use a deterministic
  merge heuristic that compares merged area against separate area.
- Validate large close portals, multiple separated same-depth portals, nested portal chains, and
  portals partially clipped by the screen.
- Verify depth precision around aperture edges, indoor tables/window frames, outdoor trees/buildings,
  terrain, and alpha-tested materials.
- Decide the default `transitionPortalMaxDepth` for browser mode after measuring scene-domain render
  cost versus composite cost.
- Add debug metrics and overlay samples for composite rects, parent-depth clipping, depth-copy
  failures, and max-depth fallback.

Exit criteria:

- Portal compositor cost is visible in metrics as geometry draw cost versus composite fill cost.
- Common indoor/outdoor portal cases are visually stable enough for M5 material hardening.
- Known remaining portal artifacts have examples and owners.

Progress:

- Captured comparable WebGL2 field baselines at transition portal depth 4 and depth 0. The measured
  frame rate and render time did not show a meaningful win from disabling portal recursion in the
  tested outdoor/indoor transition scene, so composite fill did not appear to be the dominant cost.
- Kept rect merging out of the renderer because current measurements do not justify adding an area
  heuristic, extra planning work, or more compositor complexity.
- Fixed interior-base WebGL2 scene-domain selection so an indoor camera can still use the
  dual-domain path even when no transition portal masks are currently visible. This prevents outdoor
  terrain/static depth from leaking through interior floors in indoor views.
- Added browser camera near/far controls and WebGL2 camera metrics to make depth precision and
  clipping experiments repeatable.
- Tightened terrain backface culling for indoor-base exterior-domain renders so underground/indoor
  views looking outward do not let terrain backfaces overwrite portal views.
- Cleaned up framebuffer clear behavior and attachment metadata so WebGL2 no longer spams
  attachment/clear warnings during normal portal-domain rendering.

Deferred:

- Composite rect merging remains a measured optimization, not default behavior.
- Extra overlay samples for composite rects and parent-depth clipping should be added only if a new
  portal artifact needs that visibility.

## Phase M5: Visual Parity and Material Hardening

Status: Complete for pre-compaction WebGL2 hardening.

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

Progress:

- Fixed startup material pop-in by preventing transient unresolved material fallbacks from being
  committed as visible flat draw units. Terrain, static, and structured-interior materials now wait
  for required material resources instead of briefly rendering untextured.
- Suppressed transient terrain-material readiness noise while keeping durable unsupported terrain
  material diagnostics visible.
- Fixed alpha/blended indexed material classification so indexed/paletted materials stay on the
  indexed shader path instead of being misrouted through direct texture fallback and rendered as
  opaque debug colors.
- Added WebGL2 bounds reporting from render-space BVH sources so reset-camera and the existing
  browser free-camera fit path work without depending on Three scene graph bounds.
- Replaced misleading backend UI copy that referred to Three.js even when WebGL2 was active.
- Added WebGL2 near/far camera UX and metrics, with the browser default far distance reduced to the
  current diagnostic default.

Known remaining risk:

- Direct texture rendering is functionally good enough for the normal browser-mode workflow, but
  performance is not yet understood. Slow loading, high steady-state CPU cost, and poor performance
  when little is visible need a measured audit before atlas compaction work.

## Phase M5A: Direct Texture Path Performance Audit

Status: Complete.

Purpose: measure the current WebGL2 direct/staged texture path before starting atlas layout or
static compaction. The renderer is visibly much better, but performance may be limited by draw
calls, state churn, staged frame assembly, visibility candidate pressure, resource realization,
texture upload bursts, metrics generation, or asset-prep latency. This phase should separate those
costs with instrumentation before choosing the next optimization.

Tasks:

- Add frame-phase timings for:
  - staged frame visibility/build;
  - submit-order planning and sorting;
  - GL draw submission;
  - scene-domain/portal composite passes;
  - metrics/report generation.
- Add resource-sync timings for:
  - staged scene assembly;
  - material strategy resolution;
  - WebGL buffer/VAO creation and reuse;
  - direct texture and indexed texture uploads;
  - renderer resource graph lease/update work.
- Track texture upload volume by frame: upload count, dimensions, approximate bytes, material kind,
  and whether the upload came from direct texture, indexed texture, terrain blend, detail overlay,
  or prepared normalized texture.
- Track steady-state direct texture submit pressure: visible draw units, candidate draw units,
  program switches, VAO binds, texture binds, uniform uploads, blend/depth/cull state changes, and
  material/sampler buckets.
- Add a "looking at nothing" diagnostic scenario or metric grouping that distinguishes visible draw
  pressure from retained/candidate/frame-assembly pressure.
- Add loading diagnostics that measure time from destination/landblock request to committed visible
  resources, with prepared asset counts and deferred material reasons by kind.
- Use the audit to decide whether the next optimization should be atlas/static compaction, candidate
  pruning, staged assembly caching, resource-sync scheduling, texture upload throttling, or asset
  incubation changes.

Progress:

- Added a runtime-toggleable browser JS profiler exposed as `window.holtburgerJsProfiler` and
  `?holtburgerJsProfile=1`, plus a Debug-tab start/flush button. Profiling no longer persists
  across reloads.
- Instrumented the first M5A loading and frame scopes:
  - asset interest-key creation, coverage request planning, bootstrap/streaming batches, asset
    pending/apply/prune updates, worker prepare waits, and Tauri binary lookup waits;
  - WebGL2 resource sync, staged scene assembly, draw-unit creation/reuse, scene bounds generation,
    direct/shared/indexed/detail/terrain texture upload scopes;
  - WebGL2 frame camera residency, staged-frame build, portal-mask planning, flat submit,
    scene-domain target sync, portal work planning, domain renders, composite copies, and metrics
    reporting.
- First profile pass showed repeated render-surface decode work during WebGL2 resource sync. Terrain
  and detail-overlay texture binding now check the cached WebGL texture key before decoding upload
  bytes, avoiding repeated CPU decode on texture cache hits.
- Follow-up profile showed the browser resource coordinator and WebGL2 renderer were still shaped
  like a snapshot browser rather than a streaming client: each asset-state wave could trigger
  immediate whole-scene WebGL2 sync, and signature diffing rebuilt/sorted large structured-interior
  strings on the hot path. WebGL2 resource sync is now dirty/coalesced into the next render frame,
  and the coordinator reuses per-update scene signatures instead of recomputing structured-interior
  signatures for render-spatial updates.
- Steady-frame profiling showed a separate per-frame bottleneck in visible draw ordering:
  `buildStagedWorldFrame` and WebGL2 submit planning rebuilt visible arrays and sorted them with
  repeated `localeCompare` calls over long material, texture, geometry, and draw-unit identifiers.
  Submit planning now avoids `flatMap` allocation, uses cheap stable ASCII comparisons, and
  compares a precomputed WebGL2 draw-unit submit key generated during resource sync.
- Follow-mode streaming profiles showed indexed/paletted material derivation repeatedly rebuilding
  CPU-side indexed DTOs, including neighbor-packed index payloads, before WebGL2 texture-cache reuse
  could help. WebGL2 resource sync now owns an indexed material data cache and threads it through
  staged assembly/material resolution so unchanged prepared indexed inputs reuse the derived DTO
  across resource syncs.
- A later follow-mode profile showed resource sync dominated by renderer resource graph batch
  updates, specifically full-state cloning and sorted full-graph acyclic validation. Batch updates
  now mutate the graph in place and treat invalid batches as catastrophic internal renderer errors;
  explicit `transaction()` remains the rollback API. Hot acyclic validation also avoids
  deterministic sorting, leaving sorted traversal to reporting/explanation paths.
- Follow-up profiles then moved the dominant cost back to full staged static assembly and repeated
  material strategy resolution. WebGL2 resource sync now owns a staged material plan cache, threaded
  through staged assembly, that reuses material decisions while their prepared dependency states are
  unchanged. The lower indexed material data cache remains as a miss-path optimization.
- After resource-sync caching, a longer follow-mode profile showed asset streaming/preparation as
  the next ambiguous cost center. The asset profiler now records request-kind, hydration-mode, batch
  shape, prepared-output-kind, worker host-lookup/decode, worker payload preparation, and transfer
  preparation samples so the next capture can separate prepared texture work from graph expansion,
  host lookup, envelope decode, and main-thread apply work.
- The first sharper asset profile showed prepared texture requests incorrectly going through graph
  hydration even though prepared textures are dependency-free leaf assets. Prepared texture asset IDs
  now use direct hydration, while material recipes remain graph-hydrated pending a later batched
  graph scheduler decision if per-material graph roots remain hot.
- Final M5A profile after direct prepared-texture hydration showed the remaining streaming stalls
  dominated by host binary lookup latency for landblock outdoor/topology batches. Worker envelope
  decode and landblock payload preparation were small, so host lookup/Tauri/Rust DAT delivery is the
  deferred loading follow-up. WebGL2 resource sync remains nontrivial after asset waves, but the
  dominant direct-texture path evidence is sufficient to proceed to M6 atlas layout extraction.
- Deferred submit-order follow-up: if per-frame sort/submit planning becomes hot again, replace
  full visible-list sorting with global render-domain submit buckets keyed by material kind,
  material state, texture/sampler state, and geometry. Landblocks should own draw-unit lifetime and
  streaming membership, but final submit buckets should be global per render domain so shared
  materials/textures batch across many loaded landblocks. Keep true blended transparency in a
  separate visible depth-sorted path.

Exit criteria:

- Direct texture frame cost is broken down into CPU frame assembly, CPU/GL submit, resource sync,
  texture upload, and portal/composite costs.
- Loading slowness is separated from steady-state render slowness.
- The next phase has evidence for the dominant bottleneck rather than assuming draw-call count is
  the only issue.

## Phase M6: Atlas Layout Planner Extraction and Compaction Contract

Status: Complete.

Purpose: extract atlas page/rect placement into a pure helper separate from material strategy,
material-table/draw-slice planning, resource realization, and compaction scheduling. This phase is
compaction prep; it is not expected to change visible materials by itself. It should also turn the
atlas/compaction pipeline shape into explicit interfaces so M7 starts from a known contract instead
of discovering ownership while GPU resources and renderer graph lifetime are being added.

Expected pipeline shape:

- Material strategy resolves material semantics and atlas eligibility from prepared assets, recipes,
  render state, sampler policy, appearance, and fallback rules.
- Atlas layout receives only stable atlas entries plus layout policy, then returns immutable page,
  rect, texture-index, and overflow decisions.
- Material-table and draw-slice planning consume material strategy output plus layout decisions, but
  do not live inside the rectangle packer.
- Compaction scheduling later consumes staged/current static membership and readiness, then chooses
  when to build immutable atlas generations and compacted buffers.
- WebGL2 resource stores and `RendererResourceGraph` later own realized atlas textures, compacted
  buffers, leases, dependencies, and retirement.

Tasks:

- Move atlas entry placement logic out of `staged-world-material-strategy.ts` into a dedicated pure
  layout module.
- Define the planner input DTO around atlas entries with stable entry keys, dimensions, per-entry or
  policy gutter requirements, and capacity policy. Do not include material recipes, render states,
  prepared asset records, WebGL handles, or renderer graph node keys.
- Define the planner output DTO around atlas texture pages, rects, atlas texture indices,
  deterministic placement lookup, and explicit overflow results for source-too-large and atlas-full
  cases.
- Keep material semantics out of the layout planner. Material strategy owns recipes, render states,
  usages, sampler compatibility, and fallback reasons.
- Keep material-table slot assignment and draw-slice partitioning out of the atlas layout planner.
  Leave them in material strategy for M6 unless extracting a second pure helper makes M7 simpler.
- Preserve deterministic ordering for stable atlas generations.
- Decide and document whether source-too-large is detected inside the layout planner or by
  pre-validation before layout. The decision must be represented by tests and by the returned
  overflow shape.
- Decide and document which stable keys M7 needs for atlas generation reuse and graph retention:
  layout policy key, ordered entry keys, page keys, material-slot keys, and dependency asset IDs.
- Keep or add tests for empty input, multi-atlas page layout, deterministic placement,
  source-too-large, atlas-full, duplicate entry handling, and gutter policy.

Exit criteria:

- Atlas layout can be tested without WebGL2, prepared assets, material recipes, or renderer graph
  stores.
- `staged-world-material-strategy.ts` can ask a pure planner for placement without owning rectangle
  packing.
- Future compaction can consume material strategy output plus layout output without either module
  allocating GPU resources.
- Material-table slot assignment and draw-slice planning have an explicit owner and are not hidden
  inside the rectangle packer.
- The M7 handoff contract is written down in this plan or colocated module docs: material strategy
  output, atlas layout output, material-table/draw-slice owner, atlas generation key inputs, and
  resource-graph dependency inputs.
- Any unresolved compaction-shape questions are named as M7 sub-phase risks rather than left
  implicit in the extraction.

Progress:

- Added a pure `atlas-layout-planner` module that accepts stable atlas entries plus layout policy
  and returns deterministic atlas texture pages, per-entry placements, lookup maps, and explicit
  overflow records.
- Moved source-too-large detection into the layout planner. That decision is dimension/policy-only,
  so material strategy now translates the planner overflow back into its existing
  `source-texture-too-large` fallback reason instead of pre-validating it.
- Removed rectangle packing from `staged-world-material-strategy.ts`. Material strategy now dedupes
  semantic atlas entries, asks the pure planner for placement, then continues to own material-table
  slot assignment, draw-slice planning, fallback translation, and atlas-set generation keys.
- Added planner tests for empty input, deterministic sorted placement, multi-page packing,
  atlas-full overflow, source-too-large overflow, duplicate handling, conflicting duplicate
  rejection, and per-entry gutter override.

Decisions and course corrections:

- The planner deliberately has no prepared asset payloads, material recipes, render states, WebGL
  handles, renderer graph node keys, or compaction scheduler inputs. M7 should keep those concerns
  outside the rectangle packer.
- Material-table slot assignment and draw-slice planning remain in material strategy for now. If M7
  needs reuse or more complex partitioning, extract that as a second pure helper rather than folding
  it into atlas layout.
- The new planner returns readonly page collections, while the existing staged atlas-set plan still
  exposes mutable arrays. The strategy boundary copies planner pages to preserve the current plan
  shape; future cleanup should make the atlas-set plan readonly instead of relying on this copy.
- M7 needed one immediate prep slice before shader/resource work because the renderer only had atlas
  eligibility metrics, not a deterministic compaction membership/generation contract over current
  WebGL2 draw units.

## Phase M7.0: Outdoor Static Atlas Compaction Planner

Status: Complete.

Purpose: add the immediate prep needed before atlas-backed GPU rendering: a deterministic planner
that consumes current WebGL2 draw units, selects the first-slice outdoor static compaction set,
builds atlas layout/material-slot/draw-slice descriptors, and reports why remaining draw units stay
on the staged direct path.

Tasks:

- Add a pure outdoor-static atlas compaction planner over renderer-neutral draw-unit DTOs.
- Accept only the first M7 slice: exterior static, direct-texture, atlas-eligible, UV-backed,
  opaque, no detail overlay.
- Reuse the M6 atlas layout planner for atlas pages/placements and keep material-table and draw-slice
  partitioning outside the rectangle packer.
- Report bypass reasons for non-static, non-exterior, non-direct, missing UVs, missing atlas
  eligibility, non-opaque material behavior, detail overlays, atlas overflow, and material-table
  overflow.
- Thread the planner through WebGL2 resource sync as metrics only. Do not alter rendering yet.
- Surface compactable/bypass counts in render metrics/debug summaries so field captures can validate
  first-slice coverage before shader work lands.

Progress:

- Added `atlas-static-compaction-planner`, which produces compactable draw-unit IDs, atlas entries,
  texture pages, material slots, draw slices, static object keys, triangle/static-part totals, and
  prepared texture dependencies.
- WebGL2 resource sync now builds an atlas static compaction plan after staged draw-unit realization
  and exposes compactable/bypass counts through render metrics.
- Browser debug summary now reports atlas static compactable draw units and bypass samples beside
  atlas candidate metrics.
- Added tests for deterministic outdoor static planning, staged-path bypass reasons, source texture
  overflow, material-table overflow, and empty-store initialization.

Decisions and course corrections:

- This phase intentionally does not create atlas textures, compacted buffers, graph leases, or an
  atlas shader. The point is to freeze membership and generation descriptors before introducing GPU
  lifetime and visibility changes.
- Detail overlays stay staged for the first slice even when the base material is atlas-compatible.
  M7 can either encode detail as a second material-table texture path or keep those objects staged
  until a later material-table expansion.
- The compaction planner uses the material strategy's `atlasEntryKey` directly. It must not derive a
  parallel atlas identity from texture payload fields.
- No legacy shims were added.

Exit criteria:

- Current WebGL2 resource sync can report which outdoor static draw units would compact without
  changing visible rendering.
- M7 has a deterministic handoff for compactable draw-unit IDs, atlas pages, material slots,
  draw slices, and prepared texture dependencies.
- Bypass reasons make first-slice exclusions explicit before shader work starts.

## Phase M7.1: Graph-Backed Outdoor Static Atlas Generation

Status: Complete.

Purpose: add the immediate resource-realization prep before replacing visible draw submission. This
phase turns the M7.0 compaction plan into immutable WebGL2 atlas texture generations, registers their
prepared-texture dependencies in `RendererResourceGraph`, and keeps staged direct rendering as the
visible path.

Tasks:

- Preserve keyed atlas-entry records in the compaction plan so texture placement can resolve source
  payloads without re-deriving atlas identity from diagnostic strings.
- Build WebGL2 atlas textures from compactable RGBA8 base-level prepared textures.
- Extrude gutters into the atlas bitmap before mip generation so later atlas sampling has stable edge
  texels.
- Upload atlas textures with clamp-to-edge atlas sampling and generated mip chains.
- Own atlas generation resources separately from staged direct texture resources.
- Register atlas generation nodes and prepared-texture dependencies in `RendererResourceGraph` and
  lease the active generation without sharing the scene-assembly graph lease slot.
- Surface generated atlas texture count in metrics/debug summaries.
- Keep rendering unchanged; staged direct/fallback draw units remain the visible path until M7 draw
  substitution lands.

Progress:

- Added `webgl2-atlas-static-generation`, which copies planned atlas placements into RGBA8 atlas
  bitmaps, applies clamped gutter extrusion, uploads mipmapped WebGL2 textures, and owns disposal.
- Extended `AtlasStaticCompactionPlan` with `atlasEntryRecords` while keeping the existing unkeyed
  `atlasEntries` field for current diagnostics.
- WebGL2 resource sync now creates/reuses an atlas static generation for the active compaction plan,
  disposes replaced generations, and reports atlas generation texture count.
- Active atlas generations now lease dedicated `atlas-generation` graph nodes with prepared-texture
  dependencies. Atlas graph ownership is separate from scene-assembly graph ownership to avoid
  stranding leases across graph swaps.
- Added unit coverage for atlas pixel packing, gutter extrusion, mip upload, sampler parameters, and
  empty-plan behavior.

Decisions and course corrections:

- This phase deliberately stops before compacted geometry buffers, material-table shader uniforms, or
  visible draw substitution. That keeps GPU lifetime and pixel packing separate from the harder
  visibility/order change.
- Atlas texture generation uses the compaction plan's keyed records as the source of truth. It does
  not parse or reconstruct atlas keys.
- Atlas textures are uploaded as one texture per planned atlas page with `CLAMP_TO_EDGE`; repeat
  semantics must be handled by the future atlas shader/material slot data rather than by atlas texture
  sampler state.
- No legacy shims were added.

Exit criteria:

- A non-empty outdoor static compaction plan creates retained WebGL2 atlas textures.
- Atlas textures include gutter extrusion and generated mipmaps.
- Prepared texture dependencies are retained by graph-backed atlas-generation leases.
- Visible staged rendering is unchanged, making M7.1 safe to validate with existing scenes before
  draw substitution.

## Phase M7: Atlas-Backed Static Compaction Vertical Slice

Status: Not started. M7.1 split out atlas generation; the remaining atlas-backed compaction work is
explicitly staged as M7.2 static-batch resources, M7.3 atlas submission, and M7.4 default draw
substitution.

Purpose: add atlas-backed render compaction after direct materials, structured interiors, portals,
terrain/indexed material parity, and visual hardening are far enough along that compaction is a
batching/correctness change rather than the first material-rendering milestone.

First vertical-slice boundary:

- Start with opaque outdoor static direct-texture materials that already have atlas eligibility.
- Use one atlas texture per draw slice unless a multi-sampler path is deliberately added.
- Keep direct staged rendering as the visible path for unsupported, not-yet-compacted, blended,
  animated-UV, indexed/paletted, terrain, structured-interior, and dynamic materials.
- Treat repeat/clamp sampling data, material-table partitioning, generation reuse, retirement, and
  re-anchor behavior as required M7 work, but split them into M7 sub-phases if the first slice grows
  past a contained vertical implementation.

Near-follow expansion:

- Structured-interior direct-texture materials should be the first atlas expansion after outdoor
  static compaction proves the generation, shader table, and resource-graph lifetime path.
  Structured interiors use the same material strategy and should share atlas entries/generations
  with outdoor statics when their prepared texture, sampler, and render-state requirements match.
- Keep structured interiors out of the first slice only to isolate compaction correctness from
  portal/domain membership, stencil masking, and env-cell visibility. Add them in an M7A-style
  follow-up with portal/domain coverage tests rather than treating them as a separate texture-format
  problem.

Dedicated later atlas families:

- Indexed/paletted materials need a separate atlas design. The current indexed path relies on index
  textures, palette resources, and shader-side palette/neighbor sampling; folding them into the
  direct RGBA atlas would either bake palette output or require a dedicated indexed atlas and
  palette-table contract.
- Terrain should stay out of M7 static compaction. Terrain has tile/chunk/blend-table semantics and
  a different batching problem from object static draw units. Revisit terrain atlas/blend compaction
  only after profiling proves terrain remains a meaningful bottleneck.

Lifecycle target:

- Readiness/incubation remains the first gate.
- Scene assembly creates complete staged entries first.
- Newly assembled static objects remain visible through staged direct/fallback rendering.
- Compaction runs on a separate duty cycle and collects compactable staged/current membership.
- Compaction uses material strategy output plus atlas layout output to build immutable atlas
  generations and compacted static buffers.
- Re-anchor-only updates adjust draw-time transforms only. They must not repack atlases, rewrite UVs,
  or rebuild compacted/staged vertex buffers.

Sub-phases:

### Phase M7.2: Compacted Outdoor Static Batch Resources

Status: Complete.

Purpose: build graph-backed compacted geometry resources from the M7.0 compaction plan and M7.1
atlas generation without changing visible rendering.

Tasks:

- Consume the M7.1 atlas generation resource as the immutable texture source for compacted static
  drawing.
- Add a compaction scheduler that decides when the planned staged outdoor static membership is ready
  enough to realize as GPU resources.
- Consume atlas-capable material strategy output, M6 atlas layout output, and M7.0 material-slot /
  draw-slice output for compatible static renderables.
- Build compacted position, author-UV, material-slot, and index buffers for eligible outdoor static
  draw units.
- Build compacted VAOs and draw-slice descriptors, but do not submit them in the visible path yet.
- Register compacted static-batch nodes and dependencies in `RendererResourceGraph`; atlas-generation
  texture dependencies are already registered by M7.1.
- Retire replaced compacted buffers through graph cleanup and owning WebGL2 stores.
- Surface debug-report metrics for compacted static batch count, compacted draw-unit count,
  compacted triangle count, compacted vertex/index byte sizes, compacted draw-slice count, and
  planned-but-not-submitted/fallback reason samples.
- Add tests for compaction scheduling, static-batch generation reuse, old-generation retirement,
  material-table partitioning, multi-atlas slice partitioning, staged-object no-rebuild behavior,
  fallback handling, and re-anchor-only updates.

Progress:

- Added `atlas-static-geometry-compactor`, which builds compacted local-position, author-UV,
  material-slot, transform-slot, and index arrays from the M7.0 compaction plan and staged outdoor
  static draw units.
- Added `webgl2-atlas-static-batches`, which uploads compacted static batch VBOs/IBOs and creates a
  VAO with reserved attributes for position, UV, material slot, and transform slot.
- WebGL2 resource sync now creates/reuses one first-slice compacted outdoor static batch when an
  atlas generation is available, disposes replaced batches, and registers a `static-batch` graph node
  depending on the active atlas generation plus the source staged scene-object nodes.
- Debug metrics now report compacted batch count, compacted draw-unit count, compacted triangle
  count, compacted vertex/index/total bytes, compacted draw-slice count, and resource fallback
  samples.
- Added unit coverage for compacted geometry layout, material/transform slot assignment, draw-range
  and draw-slice descriptors, and transform-only key stability.

Decisions and course corrections:

- M7.2 preserves local object geometry and stores a per-vertex transform slot instead of baking
  vertices to world space. Baking would have simplified this phase but would force buffer rebuilds on
  re-anchor/transform-only updates, which conflicts with the lifecycle target.
- The first compacted batch is still not submit-ready by itself: M7.3 must add the shader-side
  transform table upload path along with material-table uniforms.
- Static-batch graph ownership is separate from atlas-generation and scene-assembly graph leases.
- No legacy shims were added.

Future-step refinements:

- M7.3 must treat transform slot upload as part of the atlas shader contract, not as a geometry
  rebuild trigger.
- M7.4 should use conservative compacted submission: if any member draw unit in a compacted slice is
  visible, draw the whole compacted slice/batch and measure the overdraw afterward.

Exit criteria:

- A non-empty eligible outdoor static compaction plan can produce retained compacted static-batch
  resources and graph nodes.
- Visible rendering remains staged/direct while compacted batch resources are validated by metrics.
- Debug reports expose enough compaction resource metrics to diagnose generation size and coverage
  before submission is enabled.

### Phase M7.3: Atlas Static Submit Path

Status: Partial and needs M7.3.1 cleanup. The shader and submit helper exist, but the current
flat-world URL gate is the wrong migration shape and should be removed before M7.4.

Purpose: add the atlas material-table shader and submit compacted batches as part of the WebGL2
pipeline migration. This is not meant to become a long-lived parallel pipeline.

Tasks:

- Implement a material-index table shader path. Start with bounded uniform arrays and partition draw
  slices when material slots exceed the limit.
- Include atlas texture index in material-slot data. Conservative slices bind one atlas texture unless
  a multi-sampler path is deliberately implemented.
- Preserve author UVs and encode enough material/sampler data for repeat/clamp behavior within atlas
  slots.
- Submit compacted static batches when every required atlas generation, compacted buffer, draw slice,
  and material-table slot is available; unsupported or missing resources fall back to staged draws.
- Keep direct-texture, flat-fallback, unsupported, blended, animated-UV, indexed/paletted, terrain,
  structured-interior, and dynamic materials on staged paths.
- Surface debug-report metrics for atlas shader draw calls, compacted submitted draw slices, staged
  draw units retained, staged draw units replaced, and submit fallback reason samples.
- Add tests for shader-program selection, material-table upload partitioning, atlas texture binding,
  missing-resource fallback, and submit ordering.

Progress:

- Added `webgl2-atlas-static-submit`, which plans replacement for visible compactable draw units,
  validates bounded material-slot and transform-table limits, and submits compacted atlas static draw
  slices when all resources are available.
- Added an atlas static WebGL2 shader/program with position, author-UV, material-slot, and
  transform-slot attributes. The shader uses bounded uniform arrays for material atlas rects and
  transform matrices.
- Initial implementation note: the first submit path landed behind a URL query gate and only wired
  into flat-world rendering. That was corrected in M7.3.1 before proceeding to M7.4.
- Render metrics/debug reports now distinguish atlas shader draw calls, submitted atlas draw slices,
  staged draw units replaced in atlas mode, staged draw units retained, and submit fallback samples.
- Added tests for replacement planning, disabled-gate fallback, bounded transform-table fallback, and
  compacted slice submission.

Decisions and course corrections:

- The first shader path is intentionally bounded to 128 material slots and 128 transform slots.
  Larger scenes stay on staged rendering and report a submit fallback instead of partially drawing.
- The flat-world URL gate is a course-correction target. We are migrating the WebGL2 pipeline, not
  keeping a parallel opt-in renderer branch.
- Scene-domain rendering still reports staged behavior. M7.3.1/M7.4 should extend substitution using
  conservative whole-slice submission rather than waiting for per-range visibility design.
- No `localStorage` persistence was added.
- No legacy shims were added.

Future-step refinements:

- M7.3.1 must remove the URL-query gate and make atlas substitution a normal pipeline decision with
  staged fallback for missing/unsupported resources.
- M7.4 must decide whether the default path keeps the bounded uniform-array shader, partitions
  compacted batches further, or moves material/transform tables to texture buffers/2D lookup
  textures for larger scenes.
- M7.4 should make conservative whole-slice submission the default for eligible compacted statics and
  use metrics/field captures to decide whether finer visibility partitioning is worth doing later.

Exit criteria:

- The atlas shader submit path exists and has tests, but the remaining URL gate is tracked as debt
  for immediate cleanup.
- Debug reports distinguish planned, generated, submitted, replaced, retained, and fallback
  compaction counts.

### Phase M7.3.1: Remove Atlas Submit Gate and Fold Into Normal Pipeline

Status: Complete.

Purpose: correct the M7.3 course before M7.4. Atlas static submission should be a normal WebGL2
pipeline decision, not a URL-gated flat-world side path.

Tasks:

- Removed `?webgl2AtlasStaticSubmit=1` as a runtime requirement.
- Made conservative atlas static substitution run automatically whenever atlas generation,
  compacted batch resources, material-slot data, and transform tables are available.
- Applied the same conservative whole-slice replacement policy to flat-world and scene-domain submit
  routes. If any member draw unit in a compacted slice is visible in that route, submit the whole
  compacted slice for that route.
- Kept staged fallback only for missing resources, unsupported materials, exceeded shader table
  limits, or routes not yet supplied with required atlas resources.
- Renamed remaining "gated" metric/fallback wording to normal-path atlas submit wording.
- Updated tests to assert default atlas replacement behavior and staged fallback without a gate.

Progress:

- Removed the URL/query gate from the WebGL2 frame path. Atlas static substitution is now attempted
  by default through the normal submit helper when atlas generation and compacted batch resources are
  present.
- Moved replacement planning into `submitWebgl2FlatWorldDrawUnits()` so flat-world and scene-domain
  render targets share one atlas-aware submit path instead of carrying a parallel flat-world branch.
- Scene-domain exterior and interior target rendering now pass atlas static resources into the same
  conservative replacement path, and merged scene-domain metrics now preserve atlas shader draw,
  submitted slice, replaced, retained, and fallback counts.
- Fixed compacted batch reuse to refresh the transform table when the geometry key is unchanged.
  This preserves the M7.2 decision to avoid world-space baked VBO rebuilds while keeping shader
  transform uploads current after anchor/transform-only updates.
- Added a default-replacement world-submit test and updated atlas submit tests to assert normal-path
  missing-resource fallback without a gate.

Decisions and course corrections:

- Atlas submission is now a pipeline migration, not an opt-in experiment. The code still uses staged
  fallback when resources or shader table limits are unavailable, but there is no feature flag or
  browser URL switch controlling the path.
- Conservative visibility remains intentionally simple: if any draw unit in a compacted slice is
  visible for the current route, the whole compacted slice is submitted for that route.
- The bounded 128 material-slot and 128 transform-slot shader path remains the current operational
  limit. Larger compacted plans stay staged and report normal-path fallback samples.

Future-step refinements:

- M7.4 should focus on proving default atlas draw substitution in field captures: overdraw metrics,
  draw-call/state-change deltas, and whether whole-slice submission is too coarse.
- M7.4 should decide whether the bounded uniform-array shader is enough for the next milestone or
  whether material/transform table partitioning must become an immediate interim phase.
- Structured-interior, indexed/paletted, and terrain participation remain future atlas-family work;
  M7.4 should not broaden formats until outdoor direct-texture substitution metrics are reliable.

Exit criteria:

- No URL/query/debug gate is required for atlas static substitution.
- Flat-world and scene-domain submit paths both use conservative atlas static replacement when
  resources are ready.
- Debug reports describe normal-path atlas submit behavior rather than gated behavior.

### Phase M7.3.2: Bake Static Positions Relative to Batch Origin

Status: Not started.

Purpose: correct the first submit shader's transform-table design for static geometry before M7.4.
The latest field report built one atlas generation, one compacted batch, and 581 compacted static
draw units, but submitted zero atlas shader draws because the batch carried 581 per-object
transforms and exceeded the bounded 128-transform uniform path. Outdoor static compaction should not
need one shader transform per static object.

Tasks:

- Remove per-object transform slots and transform-table uniforms from atlas static compacted
  geometry and the atlas static shader path.
- Choose a stable batch-local origin for each compacted static batch. Prefer a nearby origin such as
  the anchor landblock origin, first-landblock origin, or batch AABB center so compacted vertex
  positions stay small enough for float32 precision.
- Bake static placement into compacted vertex positions during geometry compaction:
  landblock/chunk placement plus setup/object placement plus source vertex position, expressed
  relative to the batch origin.
- Submit atlas static batches with a single batch transform/offset from batch-local coordinates into
  the current render-anchor coordinate space. Re-anchor should update this one offset/matrix rather
  than rebuilding compacted VBOs.
- Keep material-slot uniforms for this phase. If material slots exceed the current 128-slot bounded
  shader path, report that as a material-table fallback rather than reintroducing per-object
  transforms.
- Update graph/resource keys so transform-only or re-anchor-only changes do not rebuild compacted
  buffers, while membership, geometry, material-slot, atlas-placement, or batch-origin changes do.
- Add tests proving static vertices are baked relative to the batch origin, re-anchor updates only the
  batch offset, atlas submit no longer rejects batches for transform count, and material-slot overflow
  remains a distinct fallback.
- Update debug reports to expose batch-origin count, transform table count avoided/removed, batch
  offset updates, and separate material-slot vs geometry/resource submit fallback samples.

Decisions and course corrections:

- Do not partition just to fit the 128-transform uniform table. Partitioning would work around the
  symptom; static geometry should remove the per-object transform requirement.
- Do not bake large global coordinates directly into compacted vertices. Keep positions batch-local
  and use a single batch offset/model transform at submit time.
- Keep the current conservative whole-slice visibility policy. If any draw unit in a compacted slice
  is visible, submit the full slice and measure overdraw later.

Exit criteria:

- The field scene that previously reported `atlas static submit transforms 581 exceed 128` can submit
  its compacted outdoor static batch unless blocked by material-slot or resource availability.
- Atlas static shader metrics show submitted slices/replaced draw units when compacted resources are
  ready and visible.
- Re-anchor-only updates reuse atlas textures and compacted VBOs while updating only batch-local
  submit transform/offset state.
- Remaining default-substitution blockers are material-table capacity, unsupported material classes,
  visibility overdraw, or resource readiness, not per-static-object transforms.

### Phase M7.4: Default Outdoor Static Draw Substitution

Status: Not started.

Purpose: after M7.3.2 removes the per-object transform blocker, harden atlas-backed compacted
outdoor static batches as the normal visible path for eligible draw units while preserving staged
fallback behavior.

Tasks:

- Keep direct-texture, flat-fallback, unsupported, blended, and animated-UV materials on staged paths.
- Deduplicate direct staging textures by texture key while staged objects wait for or bypass
  compaction.
- Allow staged entries to opportunistically use an existing immutable atlas generation only when all
  required surfaces already exist in that generation and no mutation is required.
- Validate and harden eligible staged outdoor static replacement with compacted batch submission in
  the normal submit path.
- Use conservative whole-slice submission: if any member draw unit in a compacted slice is visible,
  submit the entire slice/batch. Add conservative overdraw metrics, but do not block M7.4 on
  per-visible-range submission.
- Surface debug-report metrics for staged draw units replaced vs retained, compacted/default draw
  calls, conservative overdraw count, whole-slice overdraw ratio, and normal-path fallback reason
  samples.
- Add tests for visibility substitution, staged fallback when compacted resources are missing,
  default submit ordering, graph-retained resource lifetime, and re-anchor-only updates after
  batch-origin baking.
- Add or reserve M7A tests for structured-interior atlas participation through portal/domain
  rendering once outdoor static compaction is stable.

Exit criteria:

- Common textured static objects can render through atlas-backed compacted WebGL2 batches.
- Staged direct/fallback rendering remains the visible fallback for unsupported or not-yet-compacted
  objects.
- Atlas generations and compacted buffers are retained and retired through the renderer graph.
- Large material sets split into deterministic draw slices that reuse shared buffers.
- Re-anchor-only updates reuse compacted buffers and atlas resources through the batch-origin submit
  offset from M7.3.2.
- Debug reports expose compaction coverage and behavior: compacted batch count, compacted draw-unit
  count, compacted triangle count, compacted vertex/index byte sizes, compacted draw-slice count,
  atlas shader draw calls, staged draw units replaced vs retained, normal-path fallback samples, and
  conservative overdraw count from whole-slice submission.
- The plan names structured-interior direct-texture atlas participation as the next direct atlas
  expansion, while indexed/paletted and terrain atlas work remain explicit dedicated designs.

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
- Make staged atlas-set plan collections readonly so pure planner output can flow into material
  strategy without boundary copies.
- Replace atlas static compaction metrics-only draw handling with graph-backed compacted static-batch
  resources now that M7.1 realizes atlas-generation textures.
- Remove the temporary duplicate `atlasEntries` / `atlasEntryRecords` plan shape once downstream
  diagnostics consume keyed atlas records directly.
- Revisit the first-slice single static-batch resource after M7.3.2 proves the baked-position shader
  path; large scenes may need multiple graph-backed static batches partitioned by atlas texture,
  render state, landblock/batch origin, or visibility domain rather than one resource containing all
  compactable outdoor static draw units.
- Remove the M7.3 transform-slot table from static compaction in M7.3.2. Static atlas compaction
  should bake placement into batch-local vertex positions and submit with one batch offset/model
  transform rather than one transform uniform per static object.
- The M7.3 URL-gated flat-world atlas submit branch was removed in M7.3.1; atlas submission is now a
  normal pipeline decision with staged fallback, not a parallel opt-in path.
- Replace or partition the first submit shader's bounded material uniform arrays if field captures
  show real scenes exceeding 128 material slots after M7.3.2 removes the transform-table path.
- After M7.4, assess whether conservative whole-slice submission is too expensive in portal-heavy or
  dense static scenes before designing per-visible-range submission.
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
