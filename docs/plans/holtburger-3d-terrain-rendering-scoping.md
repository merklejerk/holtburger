# Holtburger 3D Terrain Rendering Pipeline Scoping

Status: scoping draft. This is an investigation log and target inventory, not an
implementation plan. Execution planning has moved to
[Holtburger 3D Terrain Rendering Implementation Plan](./holtburger-3d-terrain-rendering-implementation-plan.md).

## Purpose

Track discoveries, questions, and possible action items for redesigning terrain loading and
rendering in `apps/holtburger-3d`.

The immediate concern is that terrain is currently shaped as a special render family. It does not
benefit from the same batching and compaction paths as other landblock renderables, and its scene
model carries renderer-placement data that appears mechanically derivable from existing landblock
or env-cell identities.

This document should become the source of truth for the investigation until the goals are concrete
enough to convert into a real implementation plan.

## Current Working Thesis

Terrain rendering is paying for two separate kinds of special casing:

- terrain blend material state is encoded as one draw unit per landblock terrain tile per `pcode`;
- render chunk placement is stored on scene objects even when it is a pure function of the object's
  landblock or env-cell id.

The first issue creates draw-call, geometry, texture-binding, and uniform-upload churn. The second
issue obscures ownership by making chunk membership look like separate model state.

The terrain redesign should separate authoritative scene identity from renderer-local placement,
then decide whether terrain should join an existing compacted render family or receive its own
terrain-specific batch family.

## Confirmed Direction

These decisions are no longer open scoping questions:

- Delete legacy Three.js terrain/rendering backends once exact dependencies are inventoried. The
  WebGL2 renderer should own the production terrain path, and stale Three.js-era backend code should
  not remain as a compatibility layer.
- Do not store or perform separate landblock derivation for landblock-owned assets or records
  descended from landblock-owned assets. Their renderer placement should be derived directly from
  the authoritative landblock identity at renderer boundaries.
- Treat env-cell-derived placement the same way when the env cell exists as a descendant of a known
  landblock-owned asset. The env-cell id still carries the containing landblock bits, but the source
  model should not preserve an extra `renderChunk` field as if chunk assignment were independent
  state.
- Prefer source identity fields over renderer placement fields in scene models. Renderer-local
  chunk offsets remain necessary, but they should be computed from source identity where staging,
  BVH conversion, diagnostics, or compaction need them.
- Target a terrain atlas/table shader model instead of per-pcode terrain draw units. The happy path
  should render one landblock terrain tile in one draw call.
- Keep terrain vertex buffers and draw units landblock-scoped. Terrain for a landblock arrives as a
  complete landblock terrain payload, so the intended batching unit is the landblock terrain tile
  itself rather than a cross-landblock batch.
- Use a stable, small sampler set for terrain:
  - terrain color atlas for base, overlay, and road color textures;
  - terrain mask atlas for terrain alpha maps and road alpha masks;
  - terrain detail atlas or single-entry detail texture for landscape detail.
- Treat terrain atlas buckets as hard atlas page-family boundaries, not just diagnostic labels.
  Terrain color, terrain mask, and terrain detail pages must not mix with static base-color or static
  detail pages by default.
- Use atlas rect sampling with explicit gradients for repeated terrain atlas entries. Terrain color
  textures need mipmapping, and repeated atlas sampling should use `textureGrad`-style derivatives
  rather than relying on implicit derivatives through `fract`.
- Keep terrain detail as a separate sampler/page path. It has distinct tiling, fade, sharing, and
  mipmapping policy from pcode-driven terrain color and mask layers.
- Fall back to terrain draw slices when a landblock's required color/mask/detail pages cannot be
  represented by the single-draw terrain page set.
- Keep terrain BVH data quad-granular for renderer visibility queries, metrics, diagnostics, and
  future slice binding. The landblock terrain happy path may still render the whole terrain mesh
  when any quad volume in that landblock is visible.
- Treat terrain as a first-class renderer family with shared orchestration, not as an independent
  renderer island and not as a static-like generic draw unit.
- Do not make terrain participate in the generic static staging/baking/compaction pipeline. The
  current staging pipeline should be treated as the path for non-terrain scene renderables unless it
  is later generalized into render-domain-specific family inputs.
- Terrain should enter the renderer through a terrain-specific resource boundary: a terrain tile
  render resource or plan with geometry, layer table, atlas/page bindings, visibility binding, and
  draw-slice fallback already resolved.
- Share renderer concepts and infrastructure where they preserve the domain model: render domains,
  pass sequencing, visibility queries, resource lifetime, resource graph diagnostics, texture
  upload/cache, atlas layout primitives, picking support, and metrics.
- Keep terrain-specific behavior contained inside the terrain family: layer table construction,
  terrain color/mask/detail page selection, repeated atlas sampling policy, conservative landblock
  submit, and terrain draw-slice fallback.

## Current Terrain Loading Path

Terrain source data enters the frontend as part of `landblock-outdoor` prepared assets.

Relevant code:

- `crates/holtburger-core/src/content_assets.rs`
- `crates/holtburger-content/src/landblock_scene_assets.rs`
- `apps/holtburger-3d/src-tauri/src/adapter/json.rs`
- `apps/holtburger-3d/src-tauri/src/adapter/binary.rs`
- `apps/holtburger-3d/src/lib/assets/types.ts`

Current flow:

- Browser scene planning requests `landblock/<id>/outdoor` for outdoor coverage.
- `ContentAssetService` maps that request to `ContentAssetRequest::LandblockOutdoor`.
- `LandblockOutdoorAssetAssembler` normalizes the landblock id, loads the CellLandblock, and builds
  a `PreparedTerrainMesh`.
- The terrain mesh is grid-based:
  - vertices are one point per normalized CellLandblock height sample;
  - each quad emits two triangles;
  - diagonal choice comes from `uses_southwest_to_northeast_cut`;
  - terrain quads retain terrain codes, pcode, average height, bounds, and BVH item data.
- Tauri serializes terrain separately from outdoor statics, with large arrays carried through the
  binary asset envelope.

Current terminology:

- Terrain quad: one grid square inside a landblock terrain mesh.
- Terrain tile: the frontend scene model's terrain surface for one outdoor landblock.
- Landblock-outdoor payload: the prepared source asset that contains terrain, statics, outdoor BVH,
  and dependencies for one landblock.

## Current Terrain Scene Path

Relevant code:

- `apps/holtburger-3d/src/lib/world-display/terrain-scene.ts`
- `apps/holtburger-3d/src/lib/world-display/staged-world-assembly.ts`
- `apps/holtburger-3d/src/lib/world-display/staged-world-geometry.ts`
- `apps/holtburger-3d/src/lib/world-display/terrain-blend-plan.ts`

Current flow:

- `deriveTerrainSceneModel` reads prepared `landblock-outdoor` payloads and creates one
  `TerrainSceneTile` per loaded active landblock.
- Each tile stores:
  - `assetId`;
  - `landblockId`;
  - `renderChunk`;
  - terrain mesh;
  - material resource readiness;
  - provenance and focus metadata.
- Staging commits terrain only after scene readiness evaluation.
- If terrain blend resources are ready:
  - `buildTerrainBlendPlanSet` resolves unique pcodes for the tile;
  - staging emits one terrain draw unit per tile per pcode;
  - `buildStagedTerrainGeometry(mesh, { pcode })` filters triangles to that pcode and duplicates
    every triangle vertex so quad-local UVs can be emitted.
- If terrain blend resources are not ready:
  - staging emits one fallback debug-flat draw unit for the whole tile;
  - this path keeps indexed shared vertices and has no UV buffer.

Finding:

- Terrain currently flows through the generic staged world draw-unit assembly even though it is not
  part of the static compaction/baking pipeline.
- This is now considered suspicious architecture. Terrain should not be represented as generic
  staged draw units that later become retained direct WebGL draw units. It should be assembled into a
  terrain-specific final render resource shape before scene submission.

## Current WebGL2 Render Path

Relevant code:

- `apps/holtburger-3d/src/lib/world-display/webgl2-world-resources.ts`
- `apps/holtburger-3d/src/lib/world-display/webgl2-world-submit.ts`
- `apps/holtburger-3d/src/lib/world-display/webgl2/families/direct-family-adapters.ts`
- `apps/holtburger-3d/src/lib/world-display/webgl2-world-display-renderer-impl.ts`

Current flow:

- Terrain blend staged material plans become WebGL2 draw units with `terrainBlend` resources.
- Terrain blend resources bind:
  - base texture;
  - up to three overlay textures;
  - up to three overlay alpha masks;
  - road texture;
  - up to two road alpha masks.
- Terrain routes through the direct retained submit path with program kind `terrain`.
- Terrain does not get an atlas/compaction owning landblock id. `resolveAtlasCompactionLandblockId`
  returns `null` for terrain.
- The compacted RGBA texture-page and indexed-paletted submit families can replace eligible static
  or structured-interior draw units, but terrain remains direct.
- Per terrain draw, submit binds terrain blend textures, uploads pcode-specific uniforms, binds the
  draw-unit VAO, uploads MVP, and draws.

Current cost shape:

- draw units scale roughly with `visible loaded landblocks * unique pcodes per landblock`;
- terrain blend geometry is duplicated per pcode;
- terrain texture binding and dynamic uniform uploads happen per retained direct terrain draw;
- terrain is not currently represented by the existing compacted render families.

## Render Chunk Placement Findings

Relevant code:

- `apps/holtburger-3d/src/lib/world-display/render-chunks.ts`
- `apps/holtburger-3d/src/lib/world-display/render-anchor.ts`
- `apps/holtburger-3d/src/lib/world-display/browser-render-resource-coordinator.ts`

Current model:

- `RenderChunkPlacement` stores `chunkKey` and `chunkLandblockId`.
- `deriveRenderChunkTransforms` converts active chunk placements into offsets relative to the
  current render anchor.
- `OUTDOOR_LANDBLOCK_WORLD_SIZE` is `192`, so neighboring landblock chunks are offset in 192-unit
  steps.

Current derivation helpers:

- `deriveTerrainTileRenderChunk(landblockId)` derives the normalized outdoor landblock chunk.
- `deriveStructuredCellRenderChunk(envCellId)` derives the normalized outdoor landblock chunk from
  the env-cell id.
- `deriveDebugOverlayRenderChunk(envCellId)` delegates to structured-cell derivation.
- `deriveStaticRenderablePartRenderChunk(part)` derives the chunk from
  `part.owningEnvCellId ?? part.owningLandblockId`.

Finding:

Render chunk membership is currently stored on several scene model objects even though it is a pure
function of already-present identity fields:

- terrain tile chunk is derived from `landblockId`;
- outdoor static chunk is derived from `owningLandblockId`;
- structured cell chunk is derived from `envCellId`;
- debug overlays and portal apertures usually inherit the structured cell chunk.

This creates redundant state and makes chunk assignment look more meaningful than it is. The
renderer does need chunk offsets, but the source scene models probably do not need to store
`renderChunk`.

## Known Render Chunk Consumers

Production consumers currently read stored `renderChunk` values from:

- `terrainScene.tiles`;
- `structuredInteriorScene.cells`;
- debug overlay cells and portals;
- `staticRenderableScene.parts`;
- transition portal candidates.

Important use sites:

- `browser-render-resource-coordinator.ts` collects all active render chunk placements.
- `staged-world-assembly.ts` looks up chunk offsets by `renderChunk.chunkKey`.
- `prepared-bvh-metrics.ts` and `prepared-bvh-render-sources.ts` convert prepared BVH coordinate
  spaces into renderer-local coordinate spaces.
- `render-spatial-scene.ts` uses chunk keys for spatial scene records.
- WebGL2 compacted geometry sync uses chunk transforms to bake or submit compacted geometry.

Potential implication:

Removing stored `renderChunk` from scene models is not a one-line cleanup. It needs a replacement
boundary API that derives chunk ids and offsets from source identities consistently across staging,
BVH conversion, diagnostics, and compaction.

## Related Legacy or Duplicate Paths

`apps/holtburger-3d/src/lib/world-display/terrain-blend-materials.ts` still contains an older
Three.js `ShaderMaterial` terrain blend path. The active WebGL2 path uses
`terrain-blend-plan.ts` plus WebGL2 resource resolution and shaders.

Candidate cleanup:

- Delete the old Three.js terrain material path after auditing import/test dependencies.
- Move any still-useful terrain pcode/material-plan tests to the renderer-neutral plan module or
  WebGL2 resource/shader tests.
- Keep terrain pcode/material planning in one source of truth.

## Target Terrain Atlas Model

The desired terrain render model is one terrain draw for a whole landblock tile when the required
resources fit into one compatible page set.

Target render unit:

- one landblock terrain mesh;
- one terrain color atlas binding;
- one terrain mask atlas binding;
- one terrain detail binding, either atlas-backed or single-entry;
- one terrain layer table describing pcode-derived layer refs, atlas rects, tiling, rotations, road
  overlays, and detail parameters;
- vertex or per-corner attributes that select terrain layer table entries and blend inputs.
- quad-granular BVH binding for visibility queries and slice fallback.

Terrain resources and draw units should remain landblock-scoped. Do not batch terrain vertex buffers
across landblocks in the first design.

The terrain layer table should replace the current "one material per pcode" shape. Terrain uses one
shader behavior; the variable data is pcode/layer metadata, atlas rects, and blend controls.

Terrain should be produced through a terrain-specific resource boundary, not as input to the generic
staged world draw-unit pipeline. The renderer should consume terrain through a terrain render family
that still participates in shared world renderer orchestration.

## Orchestration Impact

The current renderer orchestration will fight the target terrain-family split unless the shared
orchestration boundary is designed explicitly.

Current pressure points:

- `WorldDisplayRendererOptions` passes `terrainScene` beside static/interior scenes, but the WebGL2
  resource sync immediately feeds terrain into `buildStagedWorldSceneAssembly`.
- `Webgl2WorldResourceStore` is centered on `drawUnits` and `drawUnitsById`. Terrain currently has
  to become a `Webgl2WorldDrawUnit` to participate in resource lifetime, frame visibility,
  diagnostics, and submit ordering.
- `buildStagedWorldFrame` currently accepts one flat candidate list from `worldStore.drawUnits`.
  Terrain visibility therefore rides the generic draw-unit candidate model.
- Compaction planning, texture atlas planning, texture retention, metrics, and resource graph sync
  are currently derived from the same `drawUnits` list.
- Submit scheduling partitions retained direct draw units and compacted static families from that
  same list. A terrain family resource cannot simply appear unless frame planning and submit
  scheduling know about terrain resources separately.

Required design shift:

- Keep terrain integrated with renderer orchestration, but introduce a terrain-family resource store
  and frame candidate path.
- The world resource store should likely split into:
  - non-terrain draw units for static/interior/portal/debug renderables;
  - terrain tile resources for landblock terrain.
- Frame planning should combine visibility results from non-terrain draw-unit candidates and
  terrain tile candidates, then produce pass inputs that include both non-terrain draws and terrain
  terrain-family submissions.
- Submit scheduling should treat terrain as an exterior render-domain participant with its own
  terrain family submit resources, not as retained direct generic draw units.
- Resource graph, metrics, picking, and diagnostics need terrain-specific records rather than
  forcing terrain back into draw-unit diagnostics only.
- Shared orchestration should not erase family semantics. Static/interior renderables can keep using
  draw-unit/material-family concepts, while terrain uses terrain tile resources and a layer-table
  shader model.

This orchestration change is part of the terrain plan. Terrain should not be made independent of the
renderer, but the renderer's current draw-unit-centric resource/frame/submit model must be loosened
so terrain can be first-class without pretending to be a static-like staged draw unit.

Expected shader inputs:

- `uTerrainColorAtlas`: color-space, filtered, mipmapped atlas for terrain base, terrain overlays,
  and road color textures.
- `uTerrainMaskAtlas`: control-data atlas for terrain alpha maps and road alpha masks. Filtering and
  mip policy remain parity questions, but masks should not use color conversion.
- `uTerrainDetailAtlas` or `uTerrainDetailTexture`: filtered, mipmapped landscape detail source with
  separate tiling and fade parameters.

Terrain atlas bucket boundaries:

- Terrain color pages are generated only from terrain color candidates: terrain base textures,
  terrain overlay textures, and road color textures.
- Terrain mask pages are generated only from terrain mask candidates: terrain alpha maps and road
  alpha masks.
- Terrain detail pages or bindings are generated only from terrain landscape detail candidates.
- Terrain pages must not share atlas textures with static base-color, object/building detail,
  indexed material, palette, or other non-terrain page families unless a later source-proven design
  explicitly changes that policy.
- The bucket boundary is a planning invariant. A `TexturePageBinding` usage label is not sufficient
  unless the atlas planner also partitions candidates into separate terrain page families.

Atlas sampling requirements:

- Repeated color textures packed into an atlas cannot use normal sampler repeat across the whole
  atlas. The shader must repeat inside the entry rect.
- Mipmapped repeated atlas sampling should use explicit gradients to avoid bad derivative behavior
  around `fract` boundaries.
- The shader shape should be equivalent to computing tiled UV derivatives from unwrapped local UVs,
  scaling them by the atlas rect size, and sampling with explicit gradients.
- Atlas packing must include gutters/padded edge pixels sufficient for filtered and mipmapped
  terrain sampling.

Fallback model:

- If all color refs fit one terrain color page, all mask refs fit one terrain mask page, and the
  selected detail ref can be represented by one detail binding, render the landblock terrain tile in
  one draw call.
- For the single-draw landblock path, conservative visibility is acceptable: if the terrain BVH
  reports any visible quad for the landblock, submit the whole landblock terrain mesh.
- If a landblock cannot fit that page set, split terrain into draw slices grouped by compatible
  atlas pages.
- Start with a strict fallback rule of one color atlas page and one mask atlas page per slice. Only
  add multi-page terrain slices if measurements prove the extra shader/state complexity is worth it.
- For draw-slice fallback, bind each slice to the quad keys represented by that slice rather than
  every quad in the landblock.

Layer table limits:

- Target a maximum of 8 terrain layer entries per landblock terrain tile or draw slice.
- Treat 8 layers as the first implementation limit because it should fit comfortably inside
  widespread WebGL2 uniform and vertex-attribute budgets.
- If a landblock exceeds the 8-layer limit, split it into terrain draw slices rather than expanding
  the first shader design.

## Investigation Tracks

### Track A: Terrain Render Granularity

Question: what is the desired draw-unit granularity for terrain?

Current concern:

- One draw unit per landblock per pcode duplicates geometry and limits batching.

Candidate directions:

- One terrain draw unit per landblock, with pcode or material-layer metadata supplied as vertex
  attributes, per-quad attributes, a texture buffer, or a material lookup texture.
- One terrain draw unit per render chunk across multiple landblocks.
- A terrain-specific final render resource that preserves culling and material correctness without
  entering the generic staged/static compaction path.
- Preferred target: one draw unit per landblock terrain tile when the terrain color/mask/detail page
  set fits; terrain draw slices only as the atlas-capacity fallback.
- Align the renderer around render families rather than one universal draw-unit abstraction:
  terrain should be a terrain tile family that shares pass/visibility/resource infrastructure.
- Do not pursue cross-landblock terrain batching in this pass. Landblock-scoped terrain payloads
  already give the desired batching unit once pcode-split draw units are removed.

Evidence to collect:

- Typical unique pcode count per visible landblock.
- Current draw-call and triangle counts by material kind in outdoor scenes.
- Texture-binding churn from terrain draws.
- Whether per-quad visibility is important enough to preserve after batching.
- Whether any landblock exceeds the 8-layer terrain table limit after terrain color/mask/detail page
  planning. Exceeding the limit should trigger slice fallback, not shader expansion by default.

### Track B: Terrain Material Representation

Question: how should terrain blend material state be represented so batching is possible?

Current concern:

- Pcode-specific textures are resolved into per-draw uniforms and sampler bindings.

Candidate directions:

- Pack terrain base, overlay, alpha, and road textures into texture arrays or atlases.
- Upload a terrain material table keyed by pcode.
- Keep pcode as per-vertex/per-quad data and let the shader fetch material-layer information.
- Split roads and terrain overlays into separate render phases only if that materially improves
  correctness or batching.
- Preferred target: replace terrain pcode materials with a terrain layer table plus three texture
  page bindings: color, mask, and detail.
- Use explicit-gradient atlas sampling for repeated, mipmapped terrain color textures.
- Keep detail in the existing detail-page conceptual bucket rather than packing it with terrain
  color or mask entries, but do not mix terrain landscape detail pages with static detail pages by
  default.
- Do not model terrain pcodes as static-style materials. Terrain's variable data should be terrain
  layer table entries consumed by the terrain family shader.

Evidence to collect:

- Maximum texture count and size pressure for region terrain tables.
- Whether WebGL2 texture array support and sampler limits fit the terrain table shape.
- Treat the current WebGL2 implementation as the proven behavior baseline for pcode decoding,
  road/overlay semantics, detail blending, and terrain texture sampling until a specific visual
  defect requires source-backed revalidation.
- Per-landblock counts for distinct terrain color refs, mask refs, road refs, and detail refs.
- Correct mip/gutter policy for repeated atlas terrain entries.
- Whether terrain alpha masks should be mipmapped, linearly filtered, or sampled as exact control
  data.
- Whether any existing texture-page planner code treats usage buckets as hard atlas partitions; if
  not, terrain needs a separate planner or explicit page-family partitioning.

### Track C: Render Chunk Ownership Cleanup

Question: how should scene models stop storing render chunk placement?

Current concern:

- `renderChunk` duplicates identity data on terrain, statics, structured cells, overlays, and
  portal-derived records.
- Landblock-owned assets and their descendants already carry enough identity to derive renderer
  placement.

Candidate directions:

- Replace stored `RenderChunkPlacement` with explicit source identities:
  - terrain: `landblockId`;
  - structured cell: `envCellId`;
  - static part: `owningLandblockId` and optional `owningEnvCellId`;
  - portal/debug overlay: source env-cell or source aperture identity.
- Derive chunk landblock ids and offsets at staging, BVH conversion, and diagnostics boundaries.
- Create a small renderer-local placement helper that accepts source identity rather than storing
  chunk state in scene models.
- Start with landblock-owned terrain and outdoor static records, then handle structured cells,
  portals, debug overlays, and BVH diagnostics as descendants rather than independent chunk owners.

Evidence to collect:

- All production consumers that require `renderChunk`.
- Whether compaction currently depends on stable chunk keys as grouping keys.
- Landblock chunks are the renderer placement policy. Scene model objects should not render in a
  chunk other than the normalized landblock derived from their source identity.

### Track D: Terrain Visibility and BVH Binding

Question: what should terrain visibility mean after batching changes?

Current concern:

- Terrain pcode draw units are bound to terrain BVH item keys, but visibility at draw-unit level can
  still retain a whole pcode slice for a tile if any represented terrain quad is visible.

Candidate directions:

- Keep landblock-level terrain visibility and accept conservative overdraw.
- Keep terrain-quad BVH visibility but submit compacted visible ranges or draw slices.
- Move terrain culling to a terrain-specific chunk/patch model independent of pcode.
- Preferred target: keep the prepared terrain BVH quad-granular, but render the whole landblock
  terrain tile when any terrain quad is visible in the single-draw path.
- If atlas-capacity fallback creates terrain draw slices, derive each slice's BVH binding from only
  the terrain quads included in that slice.

Evidence to collect:

- How many terrain quads survive BVH visibility in normal outdoor views.
- Whether pcode-sliced terrain draw units produce meaningful culling or mostly split material work.
- Whether terrain overdraw is a measurable problem compared with draw-call and texture-binding cost.
- Whether landblock-level conservative terrain submit creates visible frame-time or overdraw
  problems in broad browser-mode views.

### Track E: Old Terrain Material Path Cleanup

Question: which legacy Three.js terrain/rendering backend files must be deleted or migrated?

Current concern:

- Terrain blend planning logic appears duplicated between the old Three.js material path and the
  active WebGL2 path.

Candidate directions:

- Delete `terrain-blend-materials.ts` if unused.
- Move any still-useful tests to `terrain-blend-plan.ts` or WebGL2 shader/resource tests.
- Keep a renderer-neutral pcode decode/material-plan module and make renderer backends consume it.
- Identify and delete other stale Three.js-era backend files after confirming they are no longer
  production paths.

Evidence to collect:

- Import/call graph for `terrain-blend-materials.ts`.
- Test-only dependencies that should move before deletion.
- Inventory of legacy Three.js backend files versus active WebGL2 renderer files.

## Candidate Action Items

These are not ordered implementation steps yet.

- Inventory terrain draw-unit counts and pcode counts in representative outdoor scenes.
- Inventory all `renderChunk` fields and decide which are source-model state versus renderer-derived
  placement.
- Prototype deriving chunk offsets directly from source identities in one narrow path, likely
  terrain staging, before touching statics or structured interiors.
- Remove render chunk storage for landblock-owned terrain and landblock-owned static descendants,
  replacing it with boundary-time placement derivation.
- Design the landblock-scoped terrain family resource path around one terrain tile draw per
  landblock when page and layer limits fit.
- Implement the first terrain material data path with isolated terrain color/mask/detail atlases and
  an up-to-8-entry uniform layer table.
- Define the terrain-specific render resource boundary that replaces terrain participation in
  `StagedWorldDrawUnitAssembly`.
- Define which renderer orchestration types should be shared across families and which should be
  specific to non-terrain draw units versus terrain tile resources.
- Specify the terrain layer table format and vertex/per-corner attributes needed to render a whole
  landblock tile without pcode-sliced geometry.
- Prototype a terrain color atlas plus terrain mask atlas for one landblock and validate
  explicit-gradient repeat sampling with mipmaps.
- Ensure terrain atlas planning uses hard terrain-only page families for color, mask, and detail
  instead of reusing static atlas pages.
- Define terrain draw-slice fallback grouping for atlas capacity overflow or 8-layer table overflow.
- Audit `terrain-blend-materials.ts` and remove duplicate terrain pcode planning if it is no longer
  part of the active renderer.
- Audit and delete legacy Three.js backend files after tests and dependency migration prove the
  WebGL2 path owns the relevant renderer surface.
- Add tests around any new renderer-placement helper so env-cell ids, outdoor landblock ids, and
  normalized ids remain consistent.

## Working Defaults

These are accepted defaults for the first implementation plan unless a concrete blocker appears.

- Batching target: remove pcode-split terrain draw units and texture-binding churn first. Terrain
  payloads are landblock-scoped, so landblock-scoped terrain vertex buffers and draw units are the
  batching unit.
- Terrain render resource boundary: introduce a terrain tile resource with landblock id, geometry,
  layer table, terrain color/mask/detail page bindings, BVH quad keys, and optional draw slices.
- Frame/pass representation: move toward render-family work lists. A frame/pass should carry both
  non-terrain draw-unit work and terrain family work without forcing terrain into static-like
  draw-unit semantics.
- Terrain culling fidelity: keep quad-granular BVH queries, but submit the whole landblock terrain
  tile if any quad is visible. Slice fallback should bind only the quads represented by each slice.
- Layer table transport: start with uniform arrays for up to 8 terrain layer entries. If a landblock
  exceeds that limit, use draw-slice fallback rather than expanding the first shader design.
- One-draw limits: one terrain color page, one terrain mask page, one terrain detail binding, and up
  to 8 terrain layer entries per landblock terrain tile or slice.
- Renderer placement: landblock chunks are fixed policy. Derive placement from source landblock or
  env-cell identity at renderer boundaries; do not store independent `renderChunk` state in source
  scene models.
- Terrain behavior baseline: the current WebGL2 terrain implementation is the proven baseline.
  Preserve its pcode decoding, road/overlay behavior, detail behavior, and texture sampling unless a
  specific defect requires source-backed revalidation.

## Open Questions

- Which files count as legacy Three.js backends rather than reusable scene/model helpers?

## Non-Goals For This Scoping Pass

- Do not implement the terrain rewrite in this document.
- Do not delete old plan files.
- Do not move browser-mode render policy into shared Rust crates.
- Do not weaken terrain material correctness to gain batching.
- Do not treat stored `renderChunk` removal as purely cosmetic until all consumers are understood.
