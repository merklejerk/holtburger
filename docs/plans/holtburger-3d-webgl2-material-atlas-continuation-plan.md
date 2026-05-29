# Holtburger 3D WebGL2 Material, Portal, and Atlas Continuation Plan

Status: Draft; ready to start Phase M1 after the WebGL2 renderer pivot.

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

Status: Not started.

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

## Phase M2: Material Candidate Metrics and Structured Interior Unification

Status: Not started.

Purpose: after staged materials are visible, make atlas candidate reporting consistent across static
and structured-interior draw units without realizing atlas resources.

Tasks:

- Audit current WebGL2 structured-interior material resolution against staged static material
  resolution.
- Route structured interior surface requirements through `staged-world-material-strategy.ts` for
  direct/fallback decisions and atlas-candidate metrics.
- Let structured interiors contribute stable atlas candidate records for future atlas generation
  without folding per-cell geometry into static compaction.
- Add metrics that distinguish direct texture, atlas-eligible-but-not-realized, flat fallback,
  animated UV fallback, and missing normalized prepared texture.
- Add tests that static and structured-interior candidates dedupe by compatible render surface,
  usage, transfer, sampler policy, and render-state signature.

Exit criteria:

- Static and structured-interior materials share material strategy behavior and fallback reasons.
- Structured interiors remain independent draw units, not static compacted geometry.
- Atlas candidate dedupe is proven across renderable families without realizing atlas GPU resources.

## Phase M3: Terrain Materials and Indexed/Paletted Texture DTOs

Status: Not started.

Purpose: close the highest-volume visual material gaps before static compaction: terrain blend
materials, indexed/paletted appearances, palette uploads, and material edge cases. Terrain moves
ahead of portal passes because material visibility is the current scene-inspection blocker.

Tasks:

- Port terrain blend shader behavior from `terrain-blend-materials.ts` into WebGL2-friendly shader
  and resource code.
- Extract Three-free indexed texture and palette byte DTOs from the existing indexed/palette
  resource helpers.
- Add WebGL2 uploads for palette, derived palette, and indexed texture resources after DTO
  extraction.
- Keep compressed direct upload deferred unless runtime extension detection and memory evidence
  justify it. The current atlas-prep path should keep using decompressed normalized payloads.
- Add detail overlays and texture velocity only after base terrain/indexed material parity is
  understandable.
- Add diagnostics for terrain material table readiness, missing indexed payloads, missing palette
  payloads, unsupported detail textures, and texture velocity fallback.

Exit criteria:

- Terrain renders with recognizable AC terrain materials and roads in WebGL2.
- Indexed/paletted setup appearances render close enough for visual inspection.
- Remaining material differences are explicit, metric-visible, and backed by examples.

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
