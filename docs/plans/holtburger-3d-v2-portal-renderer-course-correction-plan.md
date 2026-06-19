# Holtburger 3D V2 Portal Renderer Course Correction Plan

Date: 2026-06-19

Status: draft planning document; first dry run completed on 2026-06-19.

## Context

The V2 frontend has reached the point where structured interiors are source-resolved, baked,
materialized, uploaded, drawn, queried, and partially inspected. That exposed a stronger truth than
the original transition-portal path assumed: Asheron's Call interiors are not a flat second scene
domain that can be drawn wholesale behind a few outdoor apertures. They are env-cell graphs whose
visible contents are defined by portal traversal, clipping, and cell-scoped visibility.

Recent V2 work proved several useful pieces:

- `landblock-env-cells` is the correct source domain for both outdoor-linked interiors and pure
  dungeon landblocks.
- Env-cell bundles preserve cell membership, local placement, environment/cell-structure identity,
  portal links, aperture geometry, static seeds, landblock-wide env-cell BVHs, and per-cell local
  BVHs.
- Structured-interior cell structures and env-cell static seeds can become first-class static draw
  units without pretending to be outdoor objects.
- Typed portal/interior, visibility, spatial, and source-mapping records exist in the static commit
  path.
- Building-sourced transition aperture masks are now sourced from outdoor building `GfxObj`
  `PortalPoly` records rather than from env-cell outside-transition apertures.
- The WebGL2 transition compositor has already taught a hard lesson: aperture coverage must use
  fixed-function depth/stencil-style tests where possible; shader-side sampled-depth comparisons are
  not stable enough for portal mask authority.

The current failure mode is equally important. V2 can draw resident structured-interior resources,
but it still draws too much of them. Investigation around `0x1a73ffff` suggests the apparent tunnel
"boulder" is likely overlapping capped neighboring cell shells drawn wholesale, not an authored
static marker, source-object filter issue, or simple portal-plane side decode bug. In other words,
the visual artifact is a portal renderer problem: V2 is rendering resident env-cell shells without a
frame-specific portal traversal and clipping plan.

The existing two-scene-domain transition compositor remains useful as a bootstrap for outdoor to
indoor apertures, but it is not enough for correct recursive cell rendering. A proper portal
renderer should treat env cells as first-class scene graph nodes and treat portal traversal as the
authority for which cell-owned draw units are submitted in a frame.

## Goal

Course-correct V2 from whole-domain interior rendering toward a portal renderer that draws
cell-scoped static resources through portal-derived traversal, culling, clipping, and stencil plans
while preserving the existing landblock-owned source, bake, atlas, and runtime ownership model.

## Scope

In scope:

- A dedicated portal renderer plan and corresponding updates to
  [holtburger-3d-frontend-v2-design.md](holtburger-3d-frontend-v2-design.md).
- Treating env cells as first-class render visibility nodes while keeping source loading and
  residency landblock-owned.
- Partitioning or indexing resident structured-interior and env-cell static-object resources so the
  renderer can submit them by env cell.
- Runtime/static-scene portal traversal over committed env-cell portal/interior records.
- Renderer frame-plan inputs for visible cells, portal aperture stacks, stencil/depth levels,
  clipping/frustum constraints, and transition scene-domain crossings.
- Portal-aware culling for structured interiors and env-cell static seeds.
- Preserving browser diagnostic modes that intentionally draw broad resident interiors, as long as
  those modes are clearly not the production portal path.
- Focused tests for pure traversal and renderer contract helpers, plus browser/manual inspection for
  visual progress on known dungeon/transition targets.

Out of scope for this plan:

- Rewriting Rust shared crates unless source evidence proves frontend DTOs are missing required
  facts.
- Replacing WebGL2.
- Implementing arbitrary unbounded recursion.
- Solving dynamic creature/player rendering.
- Moving browser camera/focus UX into shared crates.
- Reintroducing V1 topology-plus-one-request-per-env-cell frontend choreography.
- Filtering suspicious env-cell static seeds by visual guesswork.
- Keeping the current two-surface transition compositor as the final architecture if it conflicts
  with env-cell traversal correctness.

## Ground Truth

Primary V2 design and implementation docs:

- [holtburger-3d-frontend-v2-design.md](holtburger-3d-frontend-v2-design.md)
- [holtburger-3d-frontend-v2-implementation-plan.md](holtburger-3d-frontend-v2-implementation-plan.md)

Portal and visibility prior art:

- [holtburger-3d-browser-visible-cell-traversal-plan.md](holtburger-3d-browser-visible-cell-traversal-plan.md)
- [holtburger-3d-outdoor-portal-stencil-rendering-plan.md](holtburger-3d-outdoor-portal-stencil-rendering-plan.md)
- [holtburger-3d-unified-render-pipeline-plan.md](holtburger-3d-unified-render-pipeline-plan.md)
- [holtburger-3d-portal-depth-copy-postmortem.md](holtburger-3d-portal-depth-copy-postmortem.md)
- [holtburger-3d-v2-transition-portal-duplicate-aperture-investigation.md](holtburger-3d-v2-transition-portal-duplicate-aperture-investigation.md)

Reference implementation sources:

- `ACE/Source/ACE.DatLoader/FileTypes/EnvCell.cs` for env-cell portal and visible-cell fields.
- `ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs` for object-maintenance visibility behavior.
- `ACViewer/ACViewer/Render/R_CellStruct.cs` and related render code for DAT cell-structure
  rendering behavior, while remembering ACViewer is not a full retail portal renderer.
- `acclient-eor-source/` as secondary evidence for retail portal view setup, `PView`, env-cell
  drawing, portal clipping, and depth/stencil-style behavior. Do not modify this source.

Current V2 implementation areas to audit during execution:

- `apps/holtburger-3d/src/v2/static/env-cells/`
- `apps/holtburger-3d/src/v2/static/bake/`
- `apps/holtburger-3d/src/v2/runtime/`
- `apps/holtburger-3d/src/v2/renderer/webgl2/`
- `apps/holtburger-3d/src/v2/browser/`
- `crates/holtburger-content/` env-cell and outdoor-building aperture preparation.
- `crates/holtburger-debug-harness/` inspection tools for env-cell, portal, and landblock bundle
  evidence when a specific source-data question cannot be answered from frontend diagnostics or
  checked-in docs. Harnesses are investigation tools, not continuous verification gates for this
  renderer plan.

## Current Architecture Baseline

The current V2 shape should be preserved where it is correct:

- Static demand remains landblock/domain-owned. `landblock-env-cells` is the source domain for
  interiors and dungeons.
- Resolver workers produce source facts and typed records. They do not own renderer visibility.
- Bakers produce draw units, texture uses, spatial records, visibility records, portal/interior
  records, and source mappings. They do not own frame traversal.
- Texture/atlas manager ownership remains batch-scoped; draw units remain landblock/env-cell
  scoped.
- Runtime owns scene anchoring, current camera residency, semantic query, and frame-interest policy.
- Renderer owns GPU resources and drawing, and may own reduced render acceleration structures, but
  not source dependency policy or semantic picking truth.

The current V2 shape is not sufficient in these areas:

- Interior scene-domain rendering can draw every resident structured-interior cell shell, even when
  only a portal-clipped subset should be visible.
- Env-cell static object draw units retain env-cell ownership metadata, but batching intentionally
  avoided per-cell draw fragmentation in earlier phases. A real portal renderer needs at least a
  cell-membership submission index.
- Transition portal compositing currently bridges outdoor/interior scene domains, but source
  interior targets can still contain unrelated resident env-cell resources. That is the wrong
  execution model for env cells: they should not be pre-rendered as one large interior offscreen
  scene before compositing.
- Portal/interior records exist, but the production renderer path is not yet driven by a
  per-frame portal traversal result.

## Architectural Direction

### Ownership Model

Use a split ownership model:

- **Residency owner:** the static coordinator retains and evicts landblock-owned static scopes such
  as `landblock-env-cells`.
- **Source/query owner:** runtime/static-scene query owns semantic env-cell, portal, visibility,
  BVH, and source-mapping facts.
- **Render-resource owner:** the renderer owns uploaded GPU buffers/materials/textures and
  render-local resource indexes.
- **Frame-plan owner:** runtime and/or a renderer-adjacent pure planner turns camera residency,
  committed portal records, and renderer resource membership into a portal draw plan for one frame.

The frame plan is not a new source asset and not a new static bake result. It is transient drawing
policy derived from committed records and current frame state.

### Env Cells As Render Visibility Nodes

Env cells should become first-class render visibility nodes:

- each node has a stable landblock/env-cell identity;
- each node references committed structured-interior draw resources for that env cell;
- each node references committed env-cell static-object resources whose authored membership
  includes that env cell;
- each node references portal apertures and links to adjacent env cells or transition scene-domain
  boundaries;
- each node has bounds and local BVH facts for query/culling.

This does not require every source cell to become a separate atlas batch or host request. It means
resident renderer resources must be addressable by env-cell membership at frame-submission time.

### Portal Traversal Authority

The production interior path should draw cells selected by portal traversal, not by "all resident
interior resources." Traversal starts from camera residency:

- pure dungeon/interior focus starts at the selected/current env cell;
- outdoor transition viewing starts from a building-sourced transition aperture and its linked
  indoor cell context;
- future live client mode starts from world/session residency.

Traversal output should be bounded:

- max recursion depth;
- max cells per frame;
- aperture screen-footprint and frustum rejection;
- optional debug overrides for browser inspection.

### Renderer Submission Model

Outdoor and env-cell rendering should use different execution strategies:

- **Outdoor scene-domain target:** outdoor terrain, outdoor buildings, outdoor detail, and other
  broad exterior resources are large enough that rendering them once into an offscreen target is a
  reasonable base-scene strategy for portal compositing. The outdoor target can be copied/blitted
  through the compositor as the stable exterior source.
- **Direct env-cell draws:** env-cell cell structures and env-cell static seeds should be drawn on
  demand during portal execution under the active stencil/depth/clip state. They should not first be
  rendered wholesale into a single interior source target. Drawing them directly is the point of
  making env cells first-class render visibility nodes.

The renderer should consume a frame plan shaped roughly like this, with exact names decided during
implementation:

```ts
interface PortalRenderFramePlan {
  outdoorSceneTarget?: OutdoorSceneTargetPlan;
  baseScene: "outdoor-target" | "env-cell-direct";
  directEnvCellDraws: PortalVisibleCellDraw[];
  portalPasses: PortalStencilPass[];
  transitionPasses: TransitionPortalPass[];
  diagnosticMode?: "flat-resident" | "portal-traversal" | "portal-debug";
}
```

The core requirement is not this exact DTO. The requirement is that per-frame rendering can answer:

- which env cells are visible;
- through which portal stack or aperture each visible cell is visible;
- which draw resources belong to each visible cell;
- which stencil/depth/clipping state applies before drawing those resources;
- when an outdoor offscreen target is used as a source or base;
- which transition apertures cross between outdoor and interior domains.

### Transition Portals

Outdoor to indoor and indoor to outdoor transitions should be modeled as scene-domain crossings in
the same portal graph, not as a separate visibility universe. Outdoor scenes may still require an
offscreen target because exterior terrain/buildings/detail are broad and expensive. Env-cell scenes
should not mirror that model. A transition compositor should combine the outdoor offscreen target
with direct env-cell draws selected by traversal, rather than compositing a pre-rendered "all
resident interiors" target.

Building-sourced transition aperture geometry remains the mask authority for building portals.
Env-cell outside-transition records remain traversal/query/debug facts unless evidence proves a
non-building transition source that requires them as mask geometry.

## Implementation Phases

## Dry Run Findings

Dry run completed on 2026-06-19 against the current V2 TypeScript code.

Code evidence:

- `StaticObjectGeometryStaticDrawUnit` already carries env-cell seed ownership for
  `landblock-env-cells` through `ownership.kind: "env-cell-static-object-seeds"` and
  `ownership.envCellIds`.
- `StructuredInteriorGeometryStaticDrawUnit` already carries a single `envCellId`.
- `materializeStaticCommit` preserves structured-interior draw units and fine-splits
  static-object draw units for texture/material capacity. Env-cell seed ownership should therefore
  survive current materialization, but Phase 2 should verify that from resident renderer resources
  rather than assuming it from source contracts.
- `Webgl2Renderer` currently stores `#staticObjectResources` and `#structuredInteriorResources` in
  private maps keyed by draw-unit id. It does not expose env-cell membership counts or a way to
  request "resources for env cell X" from outside the renderer.
- Current WebGL drawing uses `#drawStaticObjects(domain, aspectRatio)`. Structured interiors are
  drawn whenever `domain !== "exterior"`, so the current scene-domain path draws all resident
  structured interiors into the interior target.
- `RenderPassPlan` currently has only `single-surface-resident` and `portal-scene-domains`.
  `portal-scene-domains` still means "render exterior target and interior target, then composite
  source target copies." It cannot express direct traversal-selected env-cell draws.
- `StaticSceneQuery` already retains committed portal/interior records, spatial records, visibility
  records, source mappings, and transition aperture batches. It also has
  `queryCommittedEnvCellRecords`. There is no portal traversal API yet.
- `BrowserWorldDisplayV2.svelte` already has a debug tab with env-cell payload, camera residency,
  draw-unit, render-pass, and overlay controls. Phase 2 inspection should extend that surface rather
  than create a new dashboard.
- V2 picking can select env-cell static objects and debug-overlay portal apertures when the overlay
  is enabled, but it does not yet pick structured-interior cell geometry. The plan should not depend
  on click-to-pick env cells until Phase 8.

Course corrections from the dry run:

- Phase 2 should be renderer-snapshot/resource-index work, not a materializer refactor unless the
  renderer cannot recover membership from uploaded draw units.
- Add an explicit frame-contract phase before traversal execution. The current `RenderPassPlan`
  vocabulary cannot carry direct env-cell draw work, portal stacks, or outdoor-target plus
  env-cell-direct composition.
- Phase 4 should prove direct env-cell draw submission against selected/current cells. It should not
  filter the existing interior source target, because that would preserve the wrong execution model.
- Keep Phase 2 browser inspection inside the current V2 debug tab. This is enough for manual
  inspection and avoids inventing a diagnostics subsystem.
- Treat `acceptedEnvCellIds` as existing flat query/residency support, not as the recursive portal
  traversal result. Portal traversal needs its own output with depth, parent edge, and aperture-stack
  context.

### Phase 0: Resteer The Active Plan And Freeze Temporary Probes

Status: completed on 2026-06-19.

Purpose: make the course correction explicit before more renderer work piles onto the wrong model.

Deliverables:

- Add this document.
- Add a concise portal-renderer course-correction section to
  [holtburger-3d-frontend-v2-design.md](holtburger-3d-frontend-v2-design.md).
- Update [holtburger-3d-frontend-v2-implementation-plan.md](holtburger-3d-frontend-v2-implementation-plan.md)
  to mark current 13B portal/interior work as superseded or pending this dedicated plan where
  appropriate.
- Inventory active temporary probes and hard-skips from the recent tunnel investigation.
- Decide which diagnostics are retained as browser inspection tools and which must be deleted before
  production portal traversal lands.

Acceptance criteria:

- The active plans no longer imply whole-domain interior rendering is the durable path.
- Temporary hard-coded cell suppression or visual probes are documented as blocked cleanup, not
  implementation precedent.

Implementation notes:

- Added this dedicated plan and linked it from the active V2 implementation plan. Phase 13B3 in
  [holtburger-3d-frontend-v2-implementation-plan.md](holtburger-3d-frontend-v2-implementation-plan.md)
  is now historical context, not the next active portal-rendering track.
- Updated [holtburger-3d-frontend-v2-design.md](holtburger-3d-frontend-v2-design.md) with the
  architectural pivot: outdoor scene-domain rendering may keep an offscreen source target, while
  env-cell resources must become direct portal-traversal draw submissions rather than a broad
  all-interiors source target.
- Code search on 2026-06-19 found no live hard-coded suppression for the old tunnel probe cells
  `0x1a730100` through `0x1a730103` in `apps/holtburger-3d/src`,
  `crates/holtburger-content`, or `crates/holtburger-debug-harness`.
- The temporary `aperture-depth-probe`, `shader-coverage-probe`, sampled-depth visualization modes,
  incoming portal-plane clipping probes, side-flip probes, and the explicit tunnel-cell hard skip are
  historical investigation notes only. They are not active renderer policy.
- Retained diagnostics:
  - Browser V2 `Env-cell portals` overlay and overlay-gated portal picking. This is retained because
    Phase 1/2 manual inspection needs authored aperture evidence.
  - Browser V2 `Flat vision` mode. This is retained as an explicitly named broad resident diagnostic
    lens, not as production rendering.
  - Debug-harness commands such as `inspect_env_cell_asset` and `inspect_landblock_env_cell_bvh`.
    These remain source-data investigation tools, not continuous verification gates.
- High-risk boundary: `acceptedEnvCellIds` and flat resident rendering are allowed to help load and
  inspect current data, but they are not recursive portal traversal output and should not drive the
  final production interior draw set.

Debt recorded:

- Phase 9 must delete or isolate any flat resident interior path that is still reachable as ordinary
  production rendering after portal traversal lands.
- Phase 2 should expose renderer resource membership in browser diagnostics so future manual checks
  do not have to infer "what got drawn" from visual overlap alone.
- If the `Flat vision` diagnostic becomes noisy or starts shaping production design, remove it
  earlier than Phase 9.

### Phase 1: Source Evidence And Verification Targets

Status: completed on 2026-06-19.

Purpose: choose source-backed fixtures before changing render behavior.

Deliverables:

- Named pure dungeon target with a known start env cell.
- Named outdoor-to-indoor transition target.
- Named interior overlap/tunnel target, initially `0x1a73ffff` if still representative.
- Browser inspection flow for each target, including which debug overlays or panels should be used
  to inspect env-cell identity, portal apertures, and rendered cell membership.
- Optional one-off harness notes only when needed to answer source-data questions such as reciprocal
  portal links, aperture geometry, or cell shell triangle facts.
- Reference notes from ACE, ACViewer, and retail decompile for the chosen targets.

Acceptance criteria:

- Each target has a repeatable browser flow for inspection.
- The plan records what visual behavior the target is supposed to prove.

Verification targets:

1. Pure dungeon/current-cell target: `0x1a73ffff`, start env cell `0x1a730103`.
   - Why this target: it is already source-probed, has no raw statics or prepared static meshes in
     the reported "boulder" cell, and exercises cell-structure-only interior drawing.
   - Browser flow: open V2 browser mode, set landblock input mode to `Dungeon`, enter
     `0x1a730103`, wait for the `landblock-env-cells` commit, then inspect the debug tab. Use the
     Env-cell AABBs and Env-cell portals overlays to confirm camera/current residency and authored
     apertures. Toggle `Flat vision` only as a diagnostic comparison against the broad resident draw.
   - Behavior to prove: Phase 4 current-cell-only drawing should submit only `0x1a730103` resources.
     The target should make it obvious whether V2 is still drawing unrelated resident cell shells.

2. Interior overlap/tunnel target: `0x1a73ffff`, tunnel cluster around `0x1a730102`,
   `0x1a730103`, and `0x1a730304`; secondary comparison target `0x40d8ffff` around
   `0x40d80102`, `0x40d80103`, `0x40d80285`, and `0x40d80286`.
   - Why these targets: checked-in investigation found duplicate/coplanar portal-aperture clusters
     with abnormal relationship topology. In `0x1a73ffff`, `0x1a730102/00` and
     `0x1a730304/00` are non-reciprocal with zero incoming references, while `0x1a730103/00` is
     reciprocal with two incoming references. The `0x40d8ffff` sample repeats the pattern.
   - Browser flow: enter the representative env cell as a dungeon target, enable Env-cell portals,
     inspect portal overlay/pick diagnostics at the tunnel junction, and compare normal rendering
     against `Flat vision`. Do not use visual disappearance as proof of a source filter; compare
     active/current env cell, portal records, accepted env-cell set, and eventually renderer
     membership counts.
   - Optional harness note: if browser portal diagnostics are insufficient, use
     `cargo run -p holtburger-debug-harness --bin inspect_landblock_env_cell_bvh -- --landblock 1a73ffff --portal-clusters --portal-cluster-min-size 2`
     or the equivalent `40d8ffff` command to re-check cluster membership and incoming-reference
     counts.
   - Behavior to prove: portal traversal and direct env-cell drawing should prevent unrelated capped
     neighboring cell shells from reading as a solid tunnel obstruction. This is not a marker/static
     object filtering target unless picking later proves a distinct explicit source object is
     involved.

3. Outdoor-to-indoor transition target: `0xf418ffff`, duplicate arch aperture involving
   `0xf4180103/portal/01` and `0xf418010b/portal/00`.
   - Why this target: the transition investigation found exact duplicate transformed aperture
     points across two env cells with different portal flags. The current lesson is that
     transition aperture batches are too coarse as the smallest portal-logic unit.
   - Browser flow: open V2 browser mode in outdoor landblock mode for `0xf418ffff`, enable
     Transition portals, and use the transition aperture overlay mode selector to inspect
     outside-to-inside, inside-to-outside, and combined overlays. Use Env-cell portals only when
     comparing the linked env-cell metadata; building-sourced transition aperture geometry remains
     the mask authority for building portals.
   - Optional harness note: use
     `cargo run -p holtburger-debug-harness --bin inspect_env_cell_asset -- --env-cell f4180103`
     and `--env-cell f418010b`, or
     `cargo run -p holtburger-debug-harness --bin inspect_landblock_env_cell_bvh -- --landblock f418ffff --limit 0 --portal-duplicates`
     if the browser overlay cannot explain a duplicate aperture.
   - Behavior to prove: transition compositing must combine an outdoor offscreen target with
     traversal-selected direct env-cell draws. It must not composite a single all-resident interior
     target through every visible transition aperture.

Source evidence notes:

- ACE `EnvCell` decoding records separate `CellPortals`, `VisibleCells`, `StaticObjects`,
  `EnvironmentId`, `CellStructure`, and `SeenOutside` facts. That supports treating portal traversal,
  visible-cell/PVS data, static seeds, and cell-structure resources as related but distinct inputs.
- ACE object maintenance uses current env cell plus `VisibleCells` for dungeon/interior dynamic
  object visibility, and adds outdoor landblock objects separately when an env cell is `SeenOutside`.
  This is not a renderer pass model, but it reinforces that "all resident env cells" is not the
  semantic visibility set.
- ACViewer is useful geometry-decoding evidence, but not a final portal-renderer parity oracle:
  `R_CellStruct.Draw` draws cell-structure polygons while skipping `NoPos`, and landblock buffering
  can add all env cells from a landblock. That is intentionally broader than retail portal view
  execution.
- Retail decompile evidence points at an actual portal view renderer. `PView::ConstructView`
  initializes a draw list from a root env cell or building portal, `PView::ClipPortals` builds
  clipped portal views, `PView::AddViewToPortals` expands through portal-linked cells, and
  `PView::DrawCells` draws the resulting cell draw list. `PView::DrawPortal` bridges building
  portals to an env-cell root. The decompile is secondary evidence, but it strongly argues against
  wholesale resident interior rendering as the durable model.

Open work for the user:

- Manual browser inspection is expected for these targets once Phase 2 exposes renderer membership
  counts. The key user-side check is visual: does current-cell/single-hop/portal traversal change
  the tunnel and transition artifacts for the expected reason?
- Retail comparison is still needed for the unresolved marker/static family
  `0x00070145` / `02000c39` and outdoor `0x2f2fffff` object index `104` / `02000c3d`. This is
  tracked separately from the portal renderer because the tunnel target no longer looks like an
  authored static-object filter problem.

### Phase 2: Cell-Scoped Render Resource Membership

Status: planned.

Purpose: make uploaded resident resources addressable by env-cell membership without changing source
loading or atlas ownership. Keep this as the smallest browser-inspectable cut: enough membership
indexing for manual portal-rendering progress checks, not a complete renderer verification harness.

Deliverables:

- Minimal renderer-side index mapping env-cell identity to resident structured-interior resources.
- Equivalent minimal renderer-side index for env-cell static-object resources where the current
  draw-unit shape already preserves honest env-cell ownership.
- Browser inspection affordance showing resident resource counts by landblock/env cell for the
  current camera-residency env cell, a manually entered env cell id, or a known target selected from
  browser state. Put this in the existing V2 debug tab unless implementation proves that surface is
  too cramped. Do not require click-to-pick env-cell geometry in this phase.
- Renderer snapshot or runtime report fields that expose these counts without leaking host/source
  DTOs into the browser UI.
- A small focused unit test only for the renderer membership-index helper if the implementation
  extracts one.
- Document any draw unit that cannot yet be submitted by one env cell without also drawing unrelated
  cells; defer fine splitting until portal traversal proves it is required.

Acceptance criteria:

- Browser inspection can show which resident resources are associated with the current/manual env
  cell selection without relying on env-cell picking.
- The first portal traversal prototype can ask for candidate draw resources for env cell A without
  needing to inspect source DTOs.
- Existing atlas and texture placement lifetimes remain unchanged.

### Phase 2R: Reassessment After Membership Indexing

Status: planned checkpoint.

Purpose: confirm the plan still has the right granularity before portal traversal depends on the
membership model.

Questions to answer:

- Can browser inspection identify resident resources for the current/manual env cell clearly enough
  to guide portal-rendering work?
- Do current structured-interior and env-cell static-object draw units preserve enough membership
  metadata, or is fine splitting required earlier than expected?
- Did Phase 2 introduce renderer-owned semantic knowledge that should move back to runtime/static
  scene query?
- Are any temporary hard-skips, flat-resident modes, or investigation probes still influencing the
  perceived result?

Exit criteria:

- Either Phase 3A/Phase 3 can consume the Phase 2 membership shape as-is, or the plan is updated
  with a smaller corrective phase before frame-contract/traversal work proceeds.

### Phase 3A: Portal Frame Contract Skeleton

Status: planned; inserted by the 2026-06-19 dry run.

Purpose: replace the too-coarse scene-domain render plan vocabulary before traversal or WebGL
execution phases depend on it.

Deliverables:

- A small `PortalDrawPlan`/`PortalFrameWorkPlan` contract that can express:
  - outdoor offscreen target as an optional base/source;
  - direct env-cell draw requests by landblock/env-cell id;
  - traversal depth or portal stack identity for each direct env-cell draw request;
  - transition aperture batches as scene-domain crossings;
  - explicit diagnostic mode for flat resident rendering.
- Runtime-to-renderer API surface updated enough to pass the new plan shape, even if early fields are
  empty.
- Renderer snapshot/debug output that reports whether the frame is using legacy scene-domain
  compositing, flat resident diagnostics, or the new direct-env-cell plan shape.
- Focused TypeScript tests for plan equality/snapshot behavior. Do not build WebGL recursion yet.

Acceptance criteria:

- The frame contract can represent outdoor target plus direct env-cell draws without naming an
  all-interior source target.
- Existing single-surface and transition behavior can continue while the new plan shape is introduced
  behind explicit modes or empty work lists.
- Phase 3 traversal output has a concrete target contract to populate.

### Phase 3: Portal Graph And Traversal Planner

Status: planned.

Purpose: derive visible env cells from committed portal/interior records and current camera
residency.

Deliverables:

- A pure traversal planner over committed env-cell portal records.
- Inputs for camera/current env cell, traversal depth cap, cell cap, frustum/footprint policy, and
  optional browser debug overrides.
- Output records for visible cells, parent portal edge, traversal depth, aperture stack, and
  rejection reason diagnostics.
- Tests for:
  - reciprocal portal traversal;
  - asymmetric visible/portal relationships;
  - depth limiting;
  - cell cap truncation;
  - non-building transition records remaining metadata-only unless explicitly bridged.

Acceptance criteria:

- Runtime can produce a deterministic visible-cell set from committed records without asking the
  renderer to inspect source DTOs.
- Traversal does not depend on browser-only visible-cell closure policy.
- Traversal output can populate the Phase 3A frame contract without losing depth/parent/aperture
  context.

### Phase 3R: Reassessment After Traversal Planning

Status: planned checkpoint.

Purpose: verify the semantic portal model before renderer execution work starts.

Questions to answer:

- Does traversal over committed portal/interior records match the chosen browser inspection targets
  closely enough to explain expected visibility?
- Are non-reciprocal, duplicate, or overlapping portal relationships represented honestly, or did
  the planner assume a cleaner graph than AC data provides?
- Is the frame-plan vocabulary still small and concrete, or has it become a vague transport bucket?
- Does the traversal output contain enough aperture-stack/depth/cell information for direct
  env-cell drawing without re-querying source DTOs in the renderer?

Exit criteria:

- Phase 4 can implement single-cell/single-hop drawing from traversal output, or the plan records
  the missing portal/source facts and schedules the smallest fix.

### Phase 4: Portal-Aware Single-Cell And Single-Hop Drawing

Status: planned.

Purpose: prove cell-scoped submission before implementing full recursion.

Deliverables:

- Renderer frame-plan input that selects only the current env cell in pure dungeon/null-anchor mode.
- Optional single-hop draw mode that adds direct portal neighbors without recursion.
- Direct renderer draw path for selected env-cell resources. This must not be implemented as
  filtering the current all-interiors source target.
- Browser debug-tab comparison of:
  - flat resident rendering;
  - current-cell-only rendering;
  - direct-neighbor portal rendering.
- Query/residency checks that the drawn cell set and semantic env-cell context agree. Do not require
  structured-interior click picking here.

Acceptance criteria:

- Pure dungeon mode can draw only the selected/current env cell.
- The known overlap/tunnel artifact changes in the expected direction when unrelated resident cells
  are not submitted.
- The renderer can draw a selected env-cell resource set directly without rendering all resident
  interiors to a source target first.

### Phase 4R: Reassessment After First Portal-Aware Drawing

Status: planned checkpoint.

Purpose: decide whether the direct-env-cell drawing model is proving itself before adding recursive
stencil complexity.

Questions to answer:

- Did current-cell and single-hop drawing improve the tunnel/overlap target for the reason expected?
- Are browser inspection affordances sufficient, or is env-cell click picking needed earlier than
  Phase 8 to keep work moving?
- Is direct env-cell drawing under portal state still the right model, or did WebGL2 constraints
  reveal a need to revise pass sequencing?
- Are outdoor offscreen target assumptions still separate from env-cell direct drawing, or did the
  implementation start rebuilding a broad interior source target by accident?

Exit criteria:

- Either Phase 5 proceeds with a validated direct-draw execution model, or the plan is updated with
  a narrower renderer/pass proof before recursive portal execution.

### Phase 5: Recursive Portal Stencil And Clip Execution

Status: planned.

Purpose: draw recursive env-cell visibility using aperture-constrained passes instead of whole-shell
interior targets.

Deliverables:

- A bounded recursive portal execution model for env-cell to env-cell portals.
- Direct drawing of selected env-cell resources during portal execution, under the active
  stencil/depth/clip state, without rendering a whole interior source target first.
- Stencil or equivalent aperture-mask state per traversal depth.
- Fixed-function depth testing for aperture coverage wherever WebGL2 can express it.
- Clip/frustum narrowing per portal stack where feasible.
- Tests for pass ordering, stencil state, and resource selection with fake WebGL2 contexts.
- Manual validation against the Phase 1 dungeon and tunnel targets.

Acceptance criteria:

- Recursive portal rendering draws the expected cells through apertures without drawing unrelated
  resident cell shells.
- The renderer does not rely on shader-side sampled-depth comparisons as aperture coverage
  authority.

### Phase 5R: Reassessment After Recursive Interior Portals

Status: planned checkpoint.

Purpose: decide whether transition unification and performance work should proceed on the current
renderer model.

Questions to answer:

- Does bounded recursive portal rendering visually match the selected dungeon/interior targets well
  enough to treat the model as correct?
- Are stencil/depth/clip mechanics stable without shader-side sampled-depth aperture authority?
- Did recursion require more draw-unit splitting than expected?
- Are the remaining visual issues source-data questions, pass-order questions, material issues, or
  traversal-policy issues?

Exit criteria:

- Phase 6 proceeds only if the interior portal model is stable enough to bridge outdoor scene
  targets with direct env-cell draws.

### Phase 6: Transition Portal Unification

Status: planned.

Purpose: make outdoor/interior transitions use the same visibility model while preserving the
building-sourced aperture mask truth.

Deliverables:

- Transition portal entries in the portal frame plan that bridge outdoor scene domains and env-cell
  traversal roots.
- Outdoor terrain/buildings/detail rendered to an offscreen outdoor scene target when needed for
  compositing.
- Env-cell resources drawn directly during transition portal execution from traversal-selected cell
  membership, not from a pre-rendered interior scene target.
- Building-sourced aperture mask geometry remains the transition aperture authority.
- Interior passes are filtered by traversal result instead of all resident interiors.
- Indoor-to-outdoor transition behavior reviewed against the existing transition compositor.

Acceptance criteria:

- Outdoor-to-indoor transition apertures no longer composite unrelated resident interior cell
  shells.
- The transition compositor can combine an outdoor offscreen target with direct env-cell draws.
- Existing building seam duplicate suppression remains intact.

### Phase 6R: Reassessment After Transition Unification

Status: planned checkpoint.

Purpose: verify the outdoor/offscreen plus direct-env-cell model before optimization and picking
work.

Questions to answer:

- Does outdoor-to-indoor compositing correctly use the outdoor target without reviving an
  all-interiors source target?
- Does indoor-to-outdoor behavior require a different pass sequence, or can it use the same scene
  crossing model?
- Are building-sourced transition apertures still the only mask authority for building portals?
- Which known visual gaps remain, and are they blockers for culling/picking work?

Exit criteria:

- Phase 7 starts with a stable execution model and a current list of remaining correctness gaps.

### Phase 7: Portal-Based Culling And Performance Guardrails

Status: planned.

Purpose: prevent the correct portal model from becoming a draw-call explosion.

Deliverables:

- Cell-level culling before draw-resource submission.
- Resource-level culling within visible cells where existing BVH/slice metadata supports it.
- Metrics for traversal count, submitted cells, submitted draw units, portal passes, triangles, and
  GPU draw calls.
- Budget policy for browser mode and future client mode kept separate.
- Assessment of whether additional bake-time cell/material partitioning is needed.

Acceptance criteria:

- Typical dungeon/interior frames submit a bounded visible subset instead of every resident cell.
- Diagnostics can explain why a cell or portal was accepted/rejected.

### Phase 7R: Reassessment Before Picking And Cleanup

Status: planned checkpoint.

Purpose: decide whether the portal renderer is correct and maintainable enough to align picking and
start deleting obsolete paths.

Questions to answer:

- Are performance guardrails solving real measured costs rather than speculative costs?
- Did culling introduce any mismatch between visible rendering and semantic query state?
- Are browser diagnostics still useful, or have they become stale/noisy enough to remove or rename?
- Is Phase 8 picking still the right next step, or do remaining visual correctness gaps need to be
  fixed first?

Exit criteria:

- Phase 8 proceeds only if render visibility is stable enough that picking can use it as a coherent
  target model.

### Phase 8: Portal-Aware Picking And Query Consistency

Status: planned.

Purpose: align semantic picking with the portal-rendered scene.

Deliverables:

- `pickRay` context that can traverse portals consistently with the visible frame plan.
- Click-to-select env-cell support for visible structured-interior geometry and/or env-cell
  selection records, so browser inspection no longer depends only on manual ids or camera
  residency.
- Structured-interior cell-structure picking where source BVH records support it.
- Env-cell static seed picking constrained by portal context rather than renderer-local overlap.
- Tests proving outdoor rays, env-cell rays, and transition rays do not hit objects outside their
  portal-reachable context.

Acceptance criteria:

- Browser picking can identify the visible dungeon geometry needed for portal debugging.
- Picking does not regress outdoor terrain/static behavior.

### Phase 8R: Final Reassessment Before Cleanup

Status: planned checkpoint.

Purpose: make sure cleanup deletes obsolete paths instead of deleting active escape hatches.

Questions to answer:

- Are production portal rendering and picking both driven by the same portal visibility model?
- Which diagnostic modes are intentionally retained for browser inspection?
- Which flat-resident, hard-skip, or investigation-only paths are now dead?
- Does the design doc need another update before code cleanup starts?

Exit criteria:

- Phase 9 has a concrete deletion list and no unresolved architectural fork.

### Phase 9: Cleanup And Cutover

Status: planned.

Purpose: remove obsolete whole-domain interior paths and investigation-only probes.

Deliverables:

- Delete or isolate flat resident interior rendering behind an explicit diagnostic mode.
- Remove temporary hard-skips and one-off investigation toggles.
- Remove stale two-surface assumptions that conflict with cell-scoped portal execution.
- Update the V2 implementation plan and design doc with completed decisions and remaining debt.

Acceptance criteria:

- Production V2 interior rendering is portal traversal driven.
- Historical diagnostics remain documented, but dead code paths are gone.

## Risks And Mitigations

Risk: env-cell draw fragmentation explodes draw calls.

Mitigation: split ownership from submission. Keep source/bake/atlas batches coarse where legal, but
add cell membership indexes or draw slices for frame submission. Use Phase 7 metrics before adding
more bake-time fragmentation than correctness requires.

Risk: traversal policy drifts into renderer source semantics.

Mitigation: runtime/static-scene query owns semantic env-cell and portal facts. Renderer receives a
frame plan and resident resource membership indexes; it does not read host DTOs or infer AC portal
meaning from raw assets.

Risk: transition portals and interior portals become two separate architectures.

Mitigation: model transitions as portal graph scene-domain crossings. Keep building aperture
geometry source-specific, but share traversal outputs, visibility diagnostics, and cell-filtered
interior submission.

Risk: WebGL2 stencil/depth constraints force awkward target formats.

Mitigation: carry forward the depth-copy postmortem lesson. Prefer framebuffer depth blits and
fixed-function depth/stencil coverage. Add focused experiments as phases rather than hiding them in
the production path.

Risk: direct env-cell drawing during compositing creates too many state changes compared with one
interior source target.

Mitigation: keep outdoor as the heavyweight offscreen source target, but batch env-cell direct draws
by traversal depth, material pass, and resource compatibility inside the active portal state. Measure
before adding more bake-time fragmentation.

Risk: browser diagnostic broad-interior rendering masks production bugs.

Mitigation: name it explicitly as flat resident diagnostics. Production and future client modes must
use portal traversal.

Risk: source data contains non-reciprocal or overlapping portals that do not fit a simple reciprocal
graph.

Mitigation: preserve relationship metadata and rejection diagnostics. Do not assume symmetry unless
source evidence proves it for a case.

## Definition Of Done

- Env-cell structured interiors and env-cell static seeds are addressable by env-cell membership at
  render-submission time.
- Runtime/static-scene query can derive a bounded portal traversal result from committed
  portal/interior records.
- Production interior rendering uses portal traversal output, not all resident interior resources.
- Outdoor scene-domain rendering may use an offscreen target for compositing, but env-cell resources
  are drawn directly on demand during portal execution rather than pre-rendered into one all-interior
  source target.
- Recursive env-cell portal drawing is bounded, aperture-constrained, and validated against named
  dungeon/interior targets.
- Outdoor/interior transition compositing filters the interior side by portal traversal where
  applicable.
- Picking and debug overlays agree with portal-rendered visibility for the named targets.
- Temporary investigation probes and hard-coded cell filters are removed or isolated behind clearly
  named diagnostics.
- `npm run check`, `npm run lint:ts`, focused renderer/runtime tests, and full `npm run test:ts`
  pass for affected TypeScript code.
- Rust content checks pass when content crates are touched. Debug-harness commands are used only for
  targeted investigation, not as continuous acceptance gates.

## Design Document Update Policy

Update [holtburger-3d-frontend-v2-design.md](holtburger-3d-frontend-v2-design.md) as phases settle:

- Phase 0: record the architectural pivot and link this plan.
- Phase 2: update static draw-unit and renderer-resource vocabulary if cell membership introduces
  new durable terms.
- Phase 3A: update renderer frame-plan vocabulary if the new contract replaces or substantially
  extends `RenderPassPlan`.
- Phase 3: update static scene query responsibilities with portal traversal ownership.
- Phase 5: update renderer responsibilities and render-update/frame-plan vocabulary.
- Phase 6: update transition portal source authority and scene-domain crossing rules.
- Phase 9: record final cutover decisions and remove outdated "whole-domain interior" language.

## Open Questions

- Which dungeon/env-cell targets should become the standard visual regression set beyond
  `0x1a73ffff`?
- Should the portal traversal planner live inside `StaticSceneQuery`, beside it as a pure
  `PortalVisibilityPlanner`, or behind a runtime-owned facade that consumes query snapshots?
- How much fine splitting is required for env-cell static-object draw units that currently batch
  compatible geometry across multiple env cells?
- Can WebGL2 express the desired recursive stencil/depth model without carrying extra stencil bits
  on every scene-domain target?
- Does retail clip cell geometry against finite portal apertures, narrowed frusta, cell BSPs, or a
  combination that V2 needs to approximate more closely?
- What browser diagnostics should survive cutover as intentional inspection tools?
