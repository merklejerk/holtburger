# Holtburger 3D V2 Portal Crossing Base Overlap Plan

Date: 2026-06-23

Status: active planning document

Supersedes:

- [holtburger-3d-v2-portal-crossing-direct-env-cell-set-plan.md](holtburger-3d-v2-portal-crossing-direct-env-cell-set-plan.md)

## Context

V2 portal rendering now exposes a boundary case: when the camera intersects a portal aperture plane,
the aperture mask is clipped by the camera near plane. The clipped mask is technically correct GPU
behavior, but it is the wrong visibility primitive when the eye is on the boundary. The clipped mask
can leave a black wedge or split-screen gap where the adjacent scene should already be visible.

Earlier attempts tried to move or bias the aperture mask. Those attempts were useful diagnostics,
but they did not solve the real issue. The renderer should not depend on a finite aperture mask for
the camera's immediate straddled neighborhood.

The current direction is simpler: before normal portal projection runs, draw the env cells that
overlap the camera's straddled portal boundaries directly onto the current base surface with normal
depth testing and depth writes. Then let the existing portal machinery continue unchanged. This
accepts static overdraw to avoid special-case mask suppression in the first implementation.

## Goal

Fill portal-plane crossing gaps by pre-drawing straddled env cells onto the base render surface with
normal depth, while leaving existing portal compositing behavior intact for the first proof.

## Scope

In scope:

- Detect current-frame portal apertures whose plane intersects the canonical camera eye.
- Support both env-cell portals and outdoor building-transition portals.
- Promote portal straddling to runtime visibility/residency state alongside current camera
  residency.
- Build a stable overlap signature from straddled portal ids, target env-cell ids, and exterior
  participation.
- Build a base-overlap env-cell list from the current runtime overlap state.
- Draw base-overlap env-cell resources directly onto the working base surface with depth testing and
  depth writes enabled.
- Preserve the existing portal mask, projection, and outdoor crossing passes for the first proof.
- Add focused tests for detector behavior, frame-plan overlap resources, and renderer pass order.
- Keep diagnostics minimal: accepted overlap cells, missing resources, and whether exterior seeding
  was required.

Out of scope for the first implementation:

- Suppressing portal masks or outdoor crossing masks that target already-overlapped cells.
- Replacing the portal projection graph.
- Broad portal/BSP visibility culling.
- Dynamic creature/player portal rendering.
- Movement, collision, or authoritative residency changes outside the frontend. The canonical camera
  position remains authoritative, while frontend runtime visibility/residency gains explicit portal
  overlap state derived from it.

## Ground Truth

Primary V2 architecture:

- [holtburger-3d-frontend-v2-implementation-plan.md](holtburger-3d-frontend-v2-implementation-plan.md)
- [holtburger-3d-v2-portal-renderer-course-correction-plan.md](holtburger-3d-v2-portal-renderer-course-correction-plan.md)
- [holtburger-3d-v2-render-pipeline-correction-plan.md](holtburger-3d-v2-render-pipeline-correction-plan.md)

Current implementation touch points:

- `apps/holtburger-3d/src/v2/runtime/client-runtime.ts`
- `apps/holtburger-3d/src/v2/runtime/direct-env-cell-frame-plan.ts`
- `apps/holtburger-3d/src/v2/runtime/static-scene-query.ts`
- `apps/holtburger-3d/src/v2/renderer/types.ts`
- `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.ts`
- `apps/holtburger-3d/src/pages/BrowserWorldDisplayV2.svelte`
- `apps/holtburger-3d/src/v2/static/portal-aperture-resources.ts`
- `apps/holtburger-3d/src/v2/static/portal-graphs.ts`
- `apps/holtburger-3d/src/v2/static/contracts.ts`

Reference sources if frontend records are insufficient:

- `ACE/Source/ACE.DatLoader/FileTypes/EnvCell.cs`
- `ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs`
- `ACViewer/ACViewer/Render/R_CellStruct.cs`
- `acclient-eor-source/` for secondary evidence only. Do not modify this source.

## Current Evidence

### Artifact

- Env-cell portals and outdoor transition portals can both show a black wedge or split when the
  camera intersects the aperture plane.
- With portal overlays enabled, the cut follows the portal aperture being clipped by the near plane.
- When the camera is exactly on a portal plane and looking across it, the aperture can degenerate
  toward a line. A finite mask cannot cover the intended neighboring scene area in that state.

### Rejected Attempts

- Global aperture depth nudge moved distant masks more visibly than the actively intersected mask.
- Per-aperture computed nudge exposed many `clipW <= 0` candidates, where a z-only nudge is not an
  exact solution.
- CPU near-plane clipping would reproduce the finite clipped mask the GPU already produces.
- Mask suppression may still become useful, but it is not necessary for the first proof if the base
  surface already contains the missing adjacent scene content.

## Proposed Model

### Portal Overlap Residency

For each runtime camera update, derive a `PortalOverlapResidency` state alongside the current
camera residency:

1. Classify portal aperture ranges near the canonical camera eye.
2. Accept a portal as straddled when:
   - the camera is within a small signed-distance slab around the aperture plane,
   - the camera eye projects inside or near the aperture polygon bounds,
   - the portal has a resolved target env cell.
3. Record each accepted straddled boundary with a stable id, source kind, source env cell when
   present, target env cell, and aperture range id.
4. Build a stable overlap signature from accepted boundary ids, target env-cell ids, and whether
   outdoor participates in the base surface.
5. Add target env cells to the base-overlap set.
6. If the current camera residency is an env cell, include the current env cell as the normal base
   participant through existing frame-plan behavior.
7. If any accepted straddled boundary connects to the outdoor scene, mark the runtime overlap state
   as requiring an exterior-seeded base surface.

The first implementation does not suppress any existing mask edge or outdoor crossing. The overlap
draw is a fill layer that happens before normal portal projection.

`PortalOverlapResidency` is frontend runtime state, not renderer-only state. The renderer consumes
the resulting base-overlap plan, but the runtime owns the classification and uses the overlap
signature to decide when portal frame-work plans must be refreshed.

### Render Order

The desired render order is:

```text
1. Establish the base surface.
   - Env-cell-only frame: clear the destination as today.
   - Outdoor participant frame: render exterior, then copy exterior color/depth into the destination.

2. Draw direct base env cells.
   - Existing base env-cell resources.
   - Additional base-overlap env-cell resources.
   - Normal depth test and depth write.

3. Run existing portal projection and outdoor crossing passes unchanged.
```

Scenario mapping:

- Inside to inside:
  - clear destination,
  - draw current env cell,
  - draw straddled neighbor env cells,
  - run existing masked portal layers unchanged.
- Outdoor to indoor:
  - render exterior and copy exterior color/depth to the composite target,
  - draw straddled interior env cells onto that target,
  - run existing outdoor-root portal projection unchanged.
- Indoor to outdoor:
  - when a straddled outdoor transition is accepted, seed the working target from the same outdoor
    crossing source the existing renderer would later copy through transition masks. That source may
    be raw exterior or an exterior suffix composite,
  - draw the current env cell and any straddled env cells onto that exterior-seeded target,
  - run existing projection and outdoor crossing copies unchanged.

This keeps the pipelines isomorphic: the base surface is a shared depth/color surface, and overlap
env cells are direct depth-tested additions before portal recursion.

## Code-Level Grounding

- `#renderDirectEnvCellFramePlan` already branches between outdoor-root, env-cell with outdoor
  crossings, and ordinary env-cell rendering in `webgl2-renderer.ts`.
- `#renderOutdoorProjectionComposite` already copies exterior color/depth into a composite target
  and then draws portal resources into that target.
- `#drawPortalProjectionFrameResources` already draws base resources before masked render layers.
- `#drawPortalFrameResourceSet` resolves env-cell resource sets into static object and structured
  interior draws.
- `#drawStaticMaterialResourceSet` applies normal depth writing for opaque resources and restores
  normal render state afterward.
- `createNodeResources` already maps an env-cell scene source to `PortalFrameNodeResources`.

The main missing pieces are runtime portal-overlap residency state, frame-plan data derived from
that state, and a renderer slot that draws the resulting resources immediately after the base surface
is established.

## Detection Strategy

The first detector should be pure and app-local.

Candidate inputs:

- Current `FrameState`.
- Current camera residency.
- Render anchor landblock id.
- `StaticPortalProjectionRecord`.
- `StaticPortalApertureResource[]`.
- Env-cell resource membership.
- Detector constants.

Accepted boundary kinds:

- `env-cell-portal`: source env cell to target env cell.
- `building-transition`: outdoor scene to target env cell, or env cell to outdoor scene through an
  outdoor crossing.

Recommended initial constants:

- `PORTAL_BASE_OVERLAP_PLANE_EPSILON`: conservative distance slab in render units.
- `PORTAL_BASE_OVERLAP_APERTURE_PADDING`: small aperture-bound tolerance.

Start with camera-eye classification only. Do not use a shadow camera position, near-plane nudge, or
full near-plane quad in the first implementation.

## Data Model Sketch

Names are provisional, but the model should be explicit:

```ts
interface RuntimePortalOverlapResidency {
  readonly kind: "portal-overlap";
  readonly signature: string;
  readonly boundaries: readonly RuntimePortalOverlapBoundary[];
  readonly baseOverlapEnvCellIds: readonly number[];
  readonly requiresExteriorSeed: boolean;
}

interface RuntimePortalOverlapBoundary {
  readonly boundaryId: string;
  readonly sourceKind: "env-cell-portal" | "building-transition";
  readonly sourceEnvCellId: number | null;
  readonly targetEnvCellId: number;
  readonly apertureRangeId: string;
}

interface PortalBaseOverlapEnvCellPlan {
  readonly envCellId: number;
  readonly landblockId: number;
  readonly resources: PortalFrameNodeResources;
  readonly reasons: readonly PortalBaseOverlapReason[];
}

type PortalBaseOverlapReason =
  | { readonly kind: "env-cell-portal"; readonly apertureRangeId: string }
  | { readonly kind: "building-transition"; readonly apertureRangeId: string };

interface PortalBaseOverlapPlan {
  readonly overlapSignature: string;
  readonly envCells: readonly PortalBaseOverlapEnvCellPlan[];
  readonly requiresExteriorSeed: boolean;
  readonly diagnostics: PortalBaseOverlapDiagnostics;
}
```

`requiresExteriorSeed` is intentionally separate from `envCells`: the outdoor scene is a base
surface source, not an env-cell resource set.

## Immediate Implementation Phases

### Phase 1: Add Portal Overlap Residency Detection

Deliverables:

- A pure helper that evaluates portal aperture ranges against the camera frame.
- A runtime-owned `RuntimePortalOverlapResidency` state derived alongside current camera residency.
- Typed boundary results for accepted straddled portals:
  - source kind,
  - source env cell id when present,
  - target env cell id,
  - aperture range id,
  - signed camera-plane distance,
  - exterior involvement flag.
- A stable overlap signature derived from accepted boundary ids, target env-cell ids, and exterior
  involvement. Continuous camera coordinates must not be part of the signature.
- Focused tests with synthetic aperture/camera cases:
  - away from plane rejects,
  - in slab and inside aperture accepts,
  - in slab but outside padded aperture rejects,
  - multiple env-cell portals can be accepted,
  - building-transition aperture can be accepted.

Likely files:

- `apps/holtburger-3d/src/v2/runtime/portal-base-overlap.ts`
- `apps/holtburger-3d/src/v2/runtime/portal-base-overlap.test.ts`
- `apps/holtburger-3d/src/v2/runtime/client-runtime.ts`

Dry-run notes:

- Use `StaticPortalProjectionRecord.edges` for env-cell portal edges and building-transition edges.
- Use `StaticPortalProjectionRecord.outdoorSceneCrossings` for env-cell-root frames that can see
  exterior through outdoor transition apertures.
- For outdoor-root retained plans, run overlap detection against the seed landblock projection before
  retained outdoor projections are combined. Broaden to additional retained source landblocks only
  after the seed-landblock proof works.
- Use `StaticPortalApertureResource[]` to resolve range vertices and derive the aperture plane.
- Runtime currently forwards frame state to the renderer and does not retain it for planning; Phase
  1 must add a runtime-owned last `FrameState`, refresh `RuntimePortalOverlapResidency` when camera
  position changes, and trigger portal frame-work plan refreshes only when the overlap signature
  changes.
- `StaticSceneQuery` currently uses committed portal aperture resources internally when creating
  projections. Phase 1 should add a deliberate query/accessor for committed portal aperture
  resources by landblock instead of re-walking renderer GPU resources.

Acceptance criteria:

- The helper is deterministic and does not touch WebGL.
- Runtime snapshots expose canonical residency and portal-overlap residency separately.
- The overlap signature stays unchanged while the camera moves within the same accepted boundary
  set.
- Tests cover env-cell and building-transition acceptance/rejection.
- Diagnostics can distinguish no candidates from accepted candidates with missing resources.

Task checklist:

- [ ] Define detector input/output types and `RuntimePortalOverlapResidency`.
- [ ] Implement landblock render-local camera/aperture coordinate conversion.
- [ ] Implement plane/slab and padded aperture tests.
- [ ] Compute deterministic overlap signatures.
- [ ] Store current runtime portal overlap state next to current camera residency.
- [ ] Add synthetic tests for env-cell and building-transition boundaries.
- [ ] Add minimal runtime diagnostics plumbing.

Decisions and course corrections:

- Pending.

### Phase 2: Propagate Overlap Residency Into Frame Plans

Deliverables:

- `PortalBaseOverlapPlan` attached to the direct env-cell portal frame plan.
- Frame-plan construction that resolves `RuntimePortalOverlapResidency.baseOverlapEnvCellIds` to
  `PortalFrameNodeResources`.
- Stable sorting/deduping of overlap env cells.
- Diagnostics for overlap count, missing resources, and `requiresExteriorSeed`.

Likely files:

- `apps/holtburger-3d/src/v2/runtime/direct-env-cell-frame-plan.ts`
- `apps/holtburger-3d/src/v2/renderer/types.ts`
- `apps/holtburger-3d/src/v2/runtime/client-runtime.ts`

Dry-run notes:

- Reuse `createNodeResources` for overlap env cells instead of creating a second membership lookup
  path.
- Do not remove overlap env cells from existing render entries or outdoor crossings.
- Do not filter mask edges in this phase.
- Include the discrete overlap signature in portal frame-work plan invalidation/equality, but do not
  include continuous camera coordinates. If the signature is unchanged, the plan can be reused while
  the camera moves within the same straddled boundary set.
- Keep static projection graph caching keyed by static inputs. Attach base-overlap data from
  `RuntimePortalOverlapResidency` after retrieving the cached static projection graph, or split the
  cache into static graph and dynamic frame-work wrapper layers.

Acceptance criteria:

- Frame-plan tests prove overlap residency env cells appear in the base-overlap plan.
- Duplicate candidates collapse to one overlap env-cell draw entry with multiple reasons.
- Missing resource membership is diagnosed without throwing.
- Existing projection graph shape remains unchanged when overlap is empty.
- Portal frame-work equality changes when the overlap signature changes and remains stable when only
  continuous camera coordinates change.

Task checklist:

- [ ] Add renderer types for base-overlap plan data.
- [ ] Add overlap signature handling to runtime plan invalidation/equality.
- [ ] Layer overlap onto cached static portal graphs using `RuntimePortalOverlapResidency`.
- [ ] Resolve overlap env-cell resources from membership.
- [ ] Add deterministic sorting and dedupe.
- [ ] Add frame-plan tests for env-cell and building-transition overlap data.

Decisions and course corrections:

- Pending.

### Phase 3: Draw Base-Overlap Env Cells In Existing Paths

Deliverables:

- Renderer helper that draws `PortalBaseOverlapEnvCellPlan[]` with `#drawPortalFrameResourceSet`.
- Draw overlap resources after the base surface is established and before masked portal layers.
- Preserve existing mask edge, render layer, and outdoor crossing behavior.
- Diagnostics count overlap draw calls separately from ordinary portal draw calls if useful.

Likely files:

- `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.ts`
- `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.test.ts`

Dry-run notes:

- Ordinary env-cell path can draw overlaps after `#drawPortalProjectionFrameResources` draws its
  base resources only if that helper is split. Prefer explicit helpers
  `#drawPortalProjectionBaseResources` and `#drawPortalProjectionMaskedLayers`; avoid callback-based
  control flow.
- Outdoor-root path already copies exterior color/depth, then draws portal resources. Insert overlap
  draw after exterior copy and before masked layers.
- The draw path already enables normal depth writes for opaque resources via
  `#drawStaticMaterialResourceSet`.

Acceptance criteria:

- Renderer tests prove overlap resources are drawn before portal layer aperture masks.
- Existing no-overlap renderer tests remain unchanged.
- Manual inside-inside portal-plane repro no longer shows a black wedge when resources are resident.
- Manual outdoor-to-indoor transition repro improves without mask suppression.

Task checklist:

- [ ] Split `#drawPortalProjectionFrameResources` into explicit base-resource and masked-layer
      helpers.
- [ ] Add `#drawPortalBaseOverlapEnvCells`.
- [ ] Insert overlap draw in ordinary env-cell and outdoor-root paths.
- [ ] Verify depth state is normal before and after overlap draws.
- [ ] Add renderer pass-order tests.

Decisions and course corrections:

- Pending.

### Phase 4: Exterior-Seeded Indoor-To-Outdoor Straddles

Deliverables:

- When an env-cell-root frame has an accepted building-transition straddle to outdoor, seed the
  working destination from the outdoor crossing source color/depth before drawing direct env-cell
  resources.
- Preserve existing outdoor crossing copy passes for the first proof.
- Diagnostics report when exterior seeding was selected.

Likely files:

- `apps/holtburger-3d/src/v2/runtime/direct-env-cell-frame-plan.ts`
- `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.ts`
- `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.test.ts`

Dry-run notes:

- The current env-cell-root path with `outdoorCrossings.length > 0` renders exterior, may build an
  exterior suffix composite, then clears a destination, draws env-cell resources, and copies the
  outdoor crossing source through crossing masks. For a straddled transition, the destination should
  start from that same outdoor crossing source color/depth instead of an empty clear.
- This makes indoor-to-outdoor straddles use the same base-surface model as outdoor-to-indoor
  straddles.
- Leave `#drawPortalProjectionOutdoorCrossings` unchanged initially, even though it may overdraw
  exterior through a mask that is already represented in the base surface.

Acceptance criteria:

- Renderer tests prove outdoor crossing source color/depth copy happens before env-cell resources when
  `requiresExteriorSeed` is true.
- Non-straddled env-cell-root outdoor crossing behavior remains unchanged.
- Manual indoor-to-outdoor transition repro no longer shows a black wedge when resources are
  resident.

Task checklist:

- [ ] Add a frame-plan flag for exterior-seeded base surfaces.
- [ ] Branch env-cell-root outdoor crossing path on that flag.
- [ ] Copy outdoor crossing source color/depth into destination instead of clearing when selected.
- [ ] Draw base and overlap env cells into the exterior-seeded destination.
- [ ] Keep outdoor crossing copy pass unchanged for proof.

Decisions and course corrections:

- Pending.

### Phase 5: Resteer After Visual Proof

Deliverables:

- Update this document with visual findings from:
  - inside-inside env-cell portal crossing,
  - outdoor-to-indoor transition crossing,
  - indoor-to-outdoor transition crossing.
- Record whether unchanged masks/crossings caused visible overdraw problems.
- Decide whether mask suppression is still needed.
- Decide whether detector hysteresis or near-plane-center/quad detection is needed.

Acceptance criteria:

- We have a clear go/no-go on base overlap as the primary solution.
- Any remaining phases are based on observed behavior, not prewritten anxiety.

Task checklist:

- [ ] Capture repro notes for each crossing direction.
- [ ] Record draw counts and diagnostics for accepted overlap cells.
- [ ] Decide whether to suppress duplicate masks/crossings later.
- [ ] Decide whether to broaden the detector beyond camera-eye classification.

Decisions and course corrections:

- Pending.

### Phase 6: Stabilization And Cleanup

Deliverables:

- Remove temporary diagnostics that do not describe production behavior.
- Keep comments documenting why straddled env cells are drawn as base overlap.
- Run focused and relevant frontend verification.

Acceptance criteria:

- No nudge path is needed for normal visual correctness.
- Tests and lint pass.
- Debug panel names describe base overlap, not failed nudge/direct-set experiments.

Task checklist:

- [ ] Remove obsolete nudge terminology from diagnostics/docs.
- [ ] Add focused regression tests for finalized base-overlap behavior.
- [ ] Run `cd apps/holtburger-3d && npm run test:ts` for relevant tests at minimum.
- [ ] Run `cd apps/holtburger-3d && npm run lint:ts`.

Decisions and course corrections:

- Pending.

## Dry Run Summary

The shortest viable implementation cut is:

1. Add a pure portal straddle detector that updates runtime portal-overlap residency.
2. Use the overlap residency signature to refresh portal frame-work plans only when the discrete
   overlap state changes.
3. Attach overlap-residency-derived env-cell resources to the portal frame plan.
4. Split renderer portal drawing enough to draw base resources, then overlap resources, then masked
   layers.
5. For outdoor-root frames, draw overlap env cells after exterior color/depth is copied into the
   composite target.
6. For indoor-to-outdoor straddles, seed the env-cell-root destination from the outdoor crossing
   source color/depth before drawing base and overlap env cells.

Why this is viable in the current code:

- Env-cell resource drawing is already factored through `PortalFrameNodeResources`.
- Static resources already draw with normal depth state.
- Outdoor-root compositing already uses an exterior-seeded target.
- The existing portal graph can remain unchanged for the first proof.

### Dry-Run Findings

- **Frame state is not currently retained by runtime planning.**  
  `ClientRuntimeImpl.updateFrameState` forwards the frame to the renderer and returns. Because portal
  straddling changes with camera position, runtime must retain the latest `FrameState` and refresh
  `RuntimePortalOverlapResidency` when the camera moves. The portal frame-work plan only needs to
  refresh when the discrete overlap signature changes.

- **Treat overlap like residency, not like renderer-only decoration.**  
  The runtime should propagate current camera residency plus current portal-overlap residency into
  portal plan derivation. Base-overlap draw resources are derived from that state; the renderer only
  consumes the planned result.

- **Do not bake continuous camera pose into `PortalFramePlanKey`.**  
  The existing cache key tracks static projection inputs: residency/root, generation ids, max depth,
  retained source key, and render anchor. Adding raw camera coordinates to that key would thrash the
  static portal-plan cache. Better shape: give overlap residency a stable signature and use that
  signature for portal frame-work invalidation/equality while keeping static projection graph caches
  keyed by static inputs.

- **Aperture CPU geometry must come from committed static data, not renderer resources.**  
  `StaticPortalApertureResource` already stores landblock-render-local vertices, indices, and
  ranges. `StaticSceneQuery` uses those resources internally to build projections, but the detector
  needs an explicit runtime-accessible query for the relevant landblock resources.

- **Detector coordinates should stay landblock-render-local.**  
  Debug overlay helpers add render-anchor translation for display. The detector should instead
  convert the camera point into each aperture resource's landblock-render-local space and evaluate
  against stored aperture vertices directly.

- **Outdoor retained projections need pre-combine overlap evaluation.**  
  Outdoor plans may combine several retained outdoor projection records. Base-overlap detection
  should run against the source projection records before `combineOutdoorPortalProjectionFramePlans`
  loses that context, or the retained plan result should carry enough source projection/resource
  context to evaluate overlap afterward. For the first proof, evaluating the seed landblock's outdoor
  projection is the narrowest useful cut.

- **Renderer splitting should be explicit.**  
  `#drawPortalProjectionFrameResources` currently draws base resources and masked layers in one
  method. The clean implementation is to split it into base-resource and masked-layer helpers, insert
  `#drawPortalBaseOverlapEnvCells` between them, and keep the current method as a simple wrapper if
  helpful for no-overlap paths.

- **Indoor-to-outdoor seeding should use the outdoor crossing source.**  
  In env-cell-root frames with outdoor crossings, the current renderer may use raw exterior or an
  exterior suffix composite as the copy source. Exterior-seeded straddles should seed from the same
  source, not always raw exterior, so retained outdoor composition remains consistent.

## Risks And Mitigations

- **Risk: Overlap env cells overdraw the same geometry later through portal masks.**  
  Mitigation: accept static overdraw for the first proof. Add suppression only if observed artifacts
  justify it.

- **Risk: Outdoor crossing copy passes overwrite some overlap pixels.**  
  Mitigation: leave the pass unchanged initially because clipped-mask holes should remain filled
  outside the copied aperture. Revisit only with visual evidence.

- **Risk: Exterior-seeded indoor-to-outdoor frames change depth behavior away from transition
  portals.**  
  Mitigation: enable exterior seeding only when a building-transition straddle is accepted.

- **Risk: Candidate detection uses the wrong coordinate space during render reanchors.**  
  Mitigation: compute tests in landblock render-local space plus explicit landblock translation,
  matching renderer placement semantics.

- **Risk: Target env-cell resources are not resident when overlap should draw them.**  
  Mitigation: diagnostics must distinguish accepted-but-missing overlap cells from no accepted
  overlap. Add prefetch/interest changes only if this appears in normal repros.

- **Risk: The detector flickers around aperture edges.**  
  Mitigation: start with deterministic sorting and aperture padding. Add hysteresis only after
  visual proof shows stationary or slow-motion flicker.

## Definition Of Done

- Inside-inside portal-plane crossings no longer show the black wedge/split artifact when target
  resources are resident.
- Outdoor-to-indoor transition crossings no longer show the black wedge/split artifact when target
  resources are resident.
- Indoor-to-outdoor transition crossings no longer show the black wedge/split artifact when target
  resources are resident.
- Existing portal projection and outdoor crossing passes still run unchanged unless a later
  resteer phase proves suppression is needed.
- Base-overlap env cells draw with normal depth testing and depth writes.
- Diagnostics report accepted overlap cells, missing resources, and exterior seeding.
- Focused tests cover detection, frame-plan overlap data, and renderer pass order.
- `cd apps/holtburger-3d && npm run test:ts` passes for relevant focused tests at minimum.
- `cd apps/holtburger-3d && npm run lint:ts` passes.

## Open Questions And Provisional Answers

- **Should the first proof suppress portal masks or outdoor crossings for overlapped cells?**  
  No. Leave them unchanged. Overdraw is acceptable unless visual proof says otherwise.

- **Should base overlap use a shadow or nudged camera position?**  
  No. The canonical camera remains authoritative. Base overlap is derived visibility state.

- **Should detection use the eye point, near-plane center, or full near-plane quad?**  
  Start with the eye point. It directly captures the singular boundary case and keeps tests simple.

- **What should happen if multiple transition portals are straddled at once?**  
  Accept all resolved target env cells, sort deterministically, and draw all resident overlaps.

- **Should exterior seeding happen for every env-cell frame with outdoor crossings?**  
  No. Only select exterior seeding when a building-transition straddle is accepted.

- **Should overlap cells affect static interest/prefetch?**  
  Not in the first implementation. Diagnose accepted missing resources first.
