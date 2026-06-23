# Holtburger 3D V2 Portal Crossing Direct Env-Cell Set Plan

> Superseded by
> [holtburger-3d-v2-portal-crossing-base-overlap-plan.md](holtburger-3d-v2-portal-crossing-base-overlap-plan.md).
> This document is retained as investigation history for the earlier direct-set/mask-suppression
> direction.

Date: 2026-06-23

Status: superseded

## Context

V2 direct env-cell portal rendering now handles normal portal projection well enough to expose a
different failure mode: when the camera intersects one or more env-cell portal planes, the portal
aperture mask itself is clipped by the camera near plane. Outdoor transition portals can show the
same visible artifact, but they are composited through a materially different renderer path and need
their own design pass before we treat them as equivalent. The result is a hard black wedge or split
in the scene where the stencil mask no longer covers the screen area that semantically belongs to a
neighboring env cell.

The important observation is that the mask is not randomly breaking. The fixed-function pipeline is
doing exactly what it is supposed to do: it clips the aperture triangles against the near plane at a
pixel/raster level. The problem is that a portal aperture ceases to be a stable finite screen window
when the eye is on or through its plane. At that point, the renderer should not depend on a
degenerate portal mask to decide whether the adjacent cell is visible.

## Goal

Render stable env-cell crossings when the camera intersects current env-cell portal planes, and
separately design the equivalent policy for outdoor transition portals whose compositor path is
materially different.

## Scope

In scope:

- Track the current portal-crossing artifact, experiments, findings, and course corrections.
- Detect current env-cell portal apertures whose plane intersects the camera eye slab.
- Build a per-frame direct env-cell set containing the current camera env cell plus directly linked
  env cells reached through those intersecting current-cell portals.
- Render all direct-set env cells directly into the base scene with normal depth for env-cell-rooted
  frames.
- Suppress portal mask/composite edges internal to the direct env-cell set.
- Continue normal portal compositing for non-intersecting boundary portals leaving the direct set.
- Investigate outdoor transition portal crossings as a separate phase before applying the direct-set
  policy there.
- Add focused tests for candidate detection, direct-set construction, and frame-plan filtering.
- Preserve minimal diagnostics that describe the selected policy without driving the design.

Out of scope for the immediate phases:

- Replacing the WebGL2 renderer.
- General screen-space portal continuation masks.
- Full portal/BSP culling beyond the current projection frame-plan model.
- Solving dynamic creature/player rendering through portals.
- Broad movement/collision changes. Camera residency may be consumed and diagnosed, but the runtime
  transition policy should remain frontend-local unless source evidence proves shared semantics are
  missing.

## Ground Truth

Primary V2 architecture:

- [holtburger-3d-frontend-v2-implementation-plan.md](holtburger-3d-frontend-v2-implementation-plan.md)
- [holtburger-3d-v2-portal-renderer-course-correction-plan.md](holtburger-3d-v2-portal-renderer-course-correction-plan.md)
- [holtburger-3d-v2-render-pipeline-correction-plan.md](holtburger-3d-v2-render-pipeline-correction-plan.md)

Current implementation touch points:

- `apps/holtburger-3d/src/v2/runtime/client-runtime.ts`
- `apps/holtburger-3d/src/v2/runtime/direct-env-cell-frame-plan.ts`
- `apps/holtburger-3d/src/v2/runtime/static-scene-query.ts`
- `apps/holtburger-3d/src/v2/renderer/portal-frame-work-plan.ts`
- `apps/holtburger-3d/src/v2/renderer/types.ts`
- `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.ts`
- `apps/holtburger-3d/src/pages/BrowserWorldDisplayV2.svelte`
- `apps/holtburger-3d/src/v2/static/portal-aperture-resources.ts`
- `apps/holtburger-3d/src/v2/static/contracts.ts`

Reference sources if frontend records are insufficient:

- `ACE/Source/ACE.DatLoader/FileTypes/EnvCell.cs`
- `ACE/Source/ACE.Server/Physics/Common/ObjectMaint.cs`
- `ACViewer/ACViewer/Render/R_CellStruct.cs`
- `acclient-eor-source/` for secondary evidence only. Do not modify this source.

## Current Evidence And Attempts

### Observed Artifact

- When the camera approaches or crosses env-cell portal planes or outdoor transition portal planes,
  the portal-composited region can reveal a black wedge or half-screen gap.
- With portal overlay enabled, the visible cut aligns with the aperture mask clipped by the camera
  near plane.
- When the camera is exactly on the portal plane and looking across it, the aperture can degenerate
  toward a screen-space line. There is then no finite portal window that can cover the screen region
  that should show the neighboring env cell.

### Attempt: Global NDC Nudge

We added a shader-side aperture depth nudge:

```glsl
clipPosition.z += uNearClipNdcNudge * clipPosition.w;
```

Finding:

- Positive values push the aperture mask farther away in NDC depth.
- The global nudge affected distant portals more visibly than the actively intersected portal.
- The artifact persisted.

Conclusion:

- A global depth nudge is too broad and does not address the singular case.

### Attempt: Per-Aperture Computed Nudge

We retained CPU-side aperture vertices/indices and computed a per-range NDC nudge when vertices
straddled the near plane:

```text
requiredNudge = max(0, maxVertex(-0.999 - ndcZ))
```

Diagnostics showed examples like:

```text
auto applied 0/471 max 0.000 behind-eye 107
```

Finding:

- Many problematic aperture draws include vertices with `clipW <= 0`.
- For those vertices, a z-only nudge is not a valid exact solution.
- Manual nudge confirms that applying arbitrary values to candidates does not produce a robust
  crossing behavior.

Conclusion:

- Nudge math is useful diagnostic evidence, but not the production fix.

### Rejected Next Step: Ordinary CPU Near-Plane Clipping

CPU clipping the aperture polygon against the same near plane would likely reproduce the same finite
clipped mask that the GPU already produces. It might reduce triangulation artifacts, but it would
not fill the missing semantic region when the camera stands on the portal plane.

Conclusion:

- Normal near-plane clipping is not sufficient as the main solution.

### Candidate Broader Solution: Direct Env-Cell Set

When the camera intersects portal boundaries, treat those portals as temporary direct base-scene
connections:

```text
normal env-cell portal:
  current cell -> stencil/composite neighbor through aperture

intersecting env-cell portal:
  current cell + neighbor cell -> both rendered directly in the base scene

outdoor transition:
  separate design pass because this composites exterior scene-domain content through outdoor
  crossing masks rather than only drawing env-cell resources through layered portal masks
```

This reframes `behind-eye` aperture diagnostics as a frame-plan policy problem for env-cell portal
edges: do not mask a singular portal edge; merge both sides of that edge into the base render set
for the current frame.

## Proposed Model

### Direct Env-Cell Set

For each env-cell-rooted frame, build a direct env-cell set:

1. Determine the current camera env cell.
2. Find env-cell portal apertures attached to that current cell whose plane intersects the camera
   eye slab.
3. Add the directly linked env cells for those current-cell portals.
4. Render direct-set cell resources directly in the base scene.
5. Suppress portal edges whose source and target cells are both inside the direct set.
6. Keep normal portal projection/compositing for edges that leave the direct set.

Outdoor transitions need a separate model. In the current renderer path, outdoor crossings render
exterior scene-domain content into `SceneDomainTargets.exterior`, may render an exterior suffix
composite, and then copy exterior color/depth through `outdoorCrossings` masks into the destination
target. That is not equivalent to suppressing an env-cell-to-env-cell mask edge.

### Why This Is Broader Than A Narrow Edge Case

The degenerate aperture mask is only one symptom. The broader rule for the first implementation is
that a current env-cell portal boundary intersecting the camera should not be treated as an
occluding mask boundary. It is part of the camera's immediate base visibility neighborhood.

This also handles:

- Camera exactly on a portal plane.
- Multiple current-cell portals intersecting the camera at corners or doorway clusters.
- Brief crossing flicker caused by residency or mask transition timing.

## Detection Strategy

The first implementation should be deliberately conservative.

Candidate portal criteria:

- The current camera residency is an env cell.
- The portal source cell is the current camera env cell.
- The camera is within a small signed-distance slab around the aperture plane.
- The camera eye point projects inside, or close to, the aperture polygon bounds.
- The portal has a resolved linked env-cell target and corresponding cell resources are resident or
  can be represented as missing.

Recommended initial constants should be app-local and diagnostic-visible:

- `PORTAL_DIRECT_SET_PLANE_EPSILON`: tuned in render units after first visual proof.
- `PORTAL_DIRECT_SET_APERTURE_PADDING`: small aperture-bound tolerance to avoid flicker at edges.

Hysteresis and recursive expansion should be considered only after the direct-neighbor version is
visually evaluated. Do not add either to the first implementation.

## Immediate Implementation Phases

Note: the experimental nudge/mode/diagnostic code was reset after it proved non-promising. The
attempt remains documented above as investigation evidence, but there is no active nudge cleanup
phase. The immediate implementation starts with current env-cell portal crossing detection.

### Phase 1: Add Intersecting Portal Candidate Detection

Deliverables:

- A pure helper that evaluates portal aperture ranges against the current camera frame.
- A typed result containing:
  - source cell id,
  - target cell id,
  - aperture range id,
  - signed camera-plane distance,
  - whether the camera eye point is inside or near the aperture bounds.
- Focused tests with synthetic aperture/camera cases:
  - camera away from portal plane rejects,
  - camera in slab and inside aperture accepts,
  - camera in slab but outside aperture rejects,
  - multiple current-cell portals can be accepted in one frame.

Likely files:

- `apps/holtburger-3d/src/v2/runtime/portal-crossing-direct-env-cell-set.ts`
- `apps/holtburger-3d/src/v2/runtime/portal-crossing-direct-env-cell-set.test.ts`
- `apps/holtburger-3d/src/v2/runtime/client-runtime.ts`

Dry-run notes:

- Use `StaticPortalProjectionRecord.edges` as the first source of portal source/target ids and
  `apertureRangeId` for env-cell roots. Do not re-walk raw portal graphs for the first
  implementation.
- Use the current landblock's `StaticPortalApertureResource[]` to resolve `apertureRangeId` to
  vertices/indices/ranges.
- `ClientRuntimeImpl.updateFrameState` currently forwards frame state directly to the renderer and
  does not retain it. Phase 1 must add a runtime-owned last `FrameState` or pass the current frame
  state into portal-frame-plan derivation.
- The helper can be pure if it receives:
  - current `FrameState`,
  - current camera residency,
  - landblock id,
  - portal projection record,
  - portal aperture resources,
  - detector constants.

Acceptance criteria:

- The helper is deterministic and does not touch WebGL.
- Minimal derived diagnostics report tested and accepted current-cell crossings.
- Tests cover both acceptance and rejection paths.

Task checklist:

- [ ] Identify the best existing runtime/static-scene-query source for aperture vertices, range
      source/target ids, and cell membership.
- [ ] Implement plane derivation from aperture vertices in landblock render-local space.
- [ ] Implement camera-to-aperture coordinate conversion using current render anchor semantics.
- [ ] Add minimal candidate diagnostics to `RuntimeSnapshot` or frame-plan diagnostics.

Decisions and course corrections:

- Pending.

### Phase 2: Build Direct Env-Cell Set Frame Policy

Deliverables:

- A pure direct-set builder rooted at current camera residency.
- Direct neighbor inclusion across accepted current-cell intersecting portals.
- Minimal diagnostics for direct-set cells, accepted crossings, and missing target resources.

Likely files:

- `apps/holtburger-3d/src/v2/runtime/portal-crossing-direct-env-cell-set.ts`
- `apps/holtburger-3d/src/v2/runtime/direct-env-cell-frame-plan.ts`
- `apps/holtburger-3d/src/v2/runtime/client-runtime.ts`

Dry-run notes:

- The direct-set builder can operate on the same projection edge data as Phase 1. It does not need a
  renderer dependency.
- The root should follow `currentCameraResidency` only when residency is an env cell: add the
  current env cell plus accepted neighbor env cells.
- The first direct-set result should be a set of env-cell ids plus diagnostics, not a renderer plan.
  Keep this step independent from draw submission.
- Do not recursively expand from newly promoted neighbors in the first slice.

Acceptance criteria:

- Given synthetic portal graph data, the builder returns the expected direct set.
- Multiple current-cell intersecting portals can add multiple neighboring cells.
- Non-intersecting portals remain outside the direct set.
- Existing direct env-cell frame-plan tests still pass.

Task checklist:

- [ ] Define `PortalCrossingDirectEnvCellSet` and diagnostics types.
- [ ] Use current camera residency as the root.
- [ ] Add only direct neighbors reached through accepted current-cell intersecting portals.
- [ ] Apply deterministic sorting to keep test output stable.
- [ ] Add focused tests for multiple accepted crossings.

Decisions and course corrections:

- Pending.

### Phase 3: Integrate Direct Set With Direct Env-Cell Frame Plan

Deliverables:

- Base scene resources include all direct-set cells, not only the current camera cell.
- Portal mask/projection edges internal to the direct set are suppressed.
- Portal projection continues from direct-set boundary cells to non-direct-set cells.
- Diagnostics show direct-set cells and suppressed internal edges.

Likely files:

- `apps/holtburger-3d/src/v2/runtime/direct-env-cell-frame-plan.ts`
- `apps/holtburger-3d/src/v2/renderer/types.ts`
- `apps/holtburger-3d/src/pages/BrowserWorldDisplayV2.svelte`

Dry-run notes:

- `createPortalProjectionFramePlan` is the main integration choke point. It already creates render
  entries and mask edges from projection data.
- `PortalProjectionFrameBaseEntryPlan` is currently singular. The implementation should not simply
  suppress internal mask edges while leaving promoted cells as normal render entries: the renderer
  skips a layer when `layerMaskCount === 0`, so those entries would not draw.
- Prefer adding an explicit direct-base resource list/entry list to the frame plan, or changing the
  base resource set to represent multiple env-cell resource memberships. This makes promoted cells
  direct base submissions rather than mask-gated render entries.
- Internal direct-set edges should be filtered before aperture resources and mask edges are planned.
- Boundary edges leaving the direct set should remain normal mask edges.

Acceptance criteria:

- Synthetic frame-plan tests prove internal direct-set edges are not emitted as mask edges.
- Direct-set cells are submitted as direct/base resources.
- Boundary portal edges still render through normal aperture masks.
- Known portal-plane repro no longer shows a black wedge when the target resources are resident.

Task checklist:

- [ ] Extend direct frame-plan input with optional direct-set data.
- [ ] Merge direct-set resources into the base render entry/resource set.
- [ ] Filter internal portal edges before mask edge planning.
- [ ] Add browser diagnostics for direct-set size and suppressed internal edges.
- [ ] Manually verify the current repro landblock/cell.

Decisions and course corrections:

- Pending.

### Phase 4: Outdoor Transition Portal Crossing Design

Deliverables:

- A design note in this document for outdoor transition crossings that accounts for:
  - exterior scene-domain rendering,
  - optional exterior suffix compositing,
  - `outdoorCrossings` mask copy into the destination target,
  - outdoor-root projection where `baseEntry.scene.kind === "outdoor-target"`.
- A decision on whether outdoor crossings should:
  - promote target env cells into the outdoor base draw before outdoor crossing masks,
  - alter `outdoorCrossings` mask planning,
  - use a separate screen-space continuation path,
  - or use a hybrid policy.
- Focused tests for the chosen frame-plan contract before implementation.

Acceptance criteria:

- The document explains why the env-cell direct-set policy does or does not transfer to outdoor
  transitions.
- The chosen outdoor approach identifies renderer/runtime touch points and test coverage before code
  changes start.

Task checklist:

- [ ] Trace `#renderDirectEnvCellFramePlan`, `#renderOutdoorProjectionComposite`,
      `#drawPortalProjectionOutdoorCrossings`, and `createPortalProjectionOutdoorCrossings`.
- [ ] Identify the source target, destination target, and depth owner when an outdoor transition
      aperture is intersected.
- [ ] Decide whether direct target env-cell drawing can happen in the same destination without
      corrupting exterior depth/composite behavior.
- [ ] Update the implementation phases with the chosen outdoor-transition path.

Decisions and course corrections:

- Outdoor transition artifacts are in scope, but not covered by Phases 1-3. Their compositor path is
  different enough that they need this design checkpoint before implementation.

### Phase 5: Resteer After First Env-Cell Visual Proof

Deliverables:

- Update this document with:
  - visual results,
  - screenshots or textual repro notes,
  - whether leakage occurred,
  - whether hysteresis is needed,
  - whether any further env-cell portal-mask special case is still needed,
  - whether the env-cell direct-set result informs the outdoor-transition design.

Acceptance criteria:

- We have a clear go/no-go on the direct-set model.
- Remaining phases are updated to reflect evidence, not prewritten optimism.

Task checklist:

- [ ] Compare repro with direct-set behavior enabled.
- [ ] Record whether camera residency flips early, late, or independently of the direct set.
- [ ] Record any geometry leakage introduced by direct neighbor submission.
- [ ] Decide whether to add temporal hysteresis before cleanup.

Decisions and course corrections:

- Pending.

### Phase 6: Stabilization And Cleanup

Deliverables:

- Keep only diagnostics that help maintain portal crossing policy.
- Add or update comments documenting why intersecting current-cell portals become direct-set
  connections.
- Run the frontend verification suite.

Acceptance criteria:

- No diagnostic-only nudge path is needed for normal visual correctness.
- Tests and lint pass.
- The debug panel names reflect production behavior rather than failed experiments.

Task checklist:

- [ ] Remove any newly introduced temporary diagnostics that no longer diagnose active behavior.
- [ ] Keep intersecting portal counts only if they are useful for future debugging.
- [ ] Add focused regression tests around the finalized direct-set behavior.
- [ ] Run `npm run test:ts`, `npm run lint:ts`, and other relevant checks.

Decisions and course corrections:

- Pending.

## Dry Run Summary

The plan is longer than the implementation path because it records investigation context. The first
implementation cut is intentionally narrow:

1. Add a pure current-cell portal crossing detector/direct-set helper in runtime.
2. Retain the current camera `FrameState` in `ClientRuntimeImpl`.
3. Feed direct-set data into `createPortalProjectionFramePlan`.
4. Extend the direct env-cell frame plan so promoted direct-set cells draw as base resources, not as
   mask-gated render entries.

Code-level conclusions:

- `StaticPortalProjectionRecord.edges` already has the cell graph relationship needed for direct-set
  expansion: source cell, target cell, aperture range id, source kind, and provenance.
- Outdoor transition cases are intentionally split into Phase 4 because the renderer uses
  scene-domain targets and `outdoorCrossings` copy masks. Do not assume the env-cell direct-set
  policy transfers without tracing that path.
- `StaticPortalApertureResource` already has landblock-render-local vertices, indices, and ranges.
  That is enough to derive portal planes and aperture bounds for the first detector.
- Runtime currently lacks stored frame state; this is the main missing input.
- The renderer should not own this policy. The renderer should keep consuming a frame plan; the
  runtime/frame-plan builder should decide which cells are direct-set cells.
- The direct frame-plan renderer currently only draws `baseEntry.resources` directly. Render entries
  require masks per layer. Therefore direct-set integration must add explicit direct-base resource
  submission, not just suppress internal masks.

## Risks And Mitigations

- **Risk: Direct-set rendering leaks geometry that should remain hidden behind non-intersecting
  portals.**  
  Mitigation: only add direct env cells through current-cell portals whose plane/aperture actually
  intersects the camera eye slab; suppress only internal direct-set edges.

- **Risk: Multiple nearby portals cause unstable direct-set membership.**  
  Mitigation: add deterministic ordering first; add hysteresis only after visual evidence shows
  flicker.

- **Risk: Candidate detection uses the wrong coordinate space during render reanchors.**  
  Mitigation: compute tests in landblock render-local plus explicit landblock translation, matching
  the renderer/runtime contract; add tests for nonzero landblock translations if practical.

- **Risk: The target env-cell resources are not resident when a crossing should promote them.**  
  Mitigation: diagnostics must distinguish "candidate accepted but missing resources" from "no
  crossing candidate"; runtime interest may need to prefetch linked neighbor cells around camera
  residency.

- **Risk: Current camera residency disagrees with crossing policy near the portal plane.**  
  Mitigation: treat residency as the root, but let the direct set contain both sides during the
  threshold zone. Record residency timing during visual verification before changing semantic
  residency rules.

- **Risk: Outdoor transition portals look similar but are not composited like env-cell portals.**  
  Mitigation: keep outdoor transition artifacts in scope, but require the Phase 4 renderer-path
  design pass before implementation.

## Definition Of Done

- Camera crossing a current env-cell portal plane does not produce the current black wedge/split
  artifact in known env-cell repro cases.
- Camera exactly on a current env-cell portal plane can show both adjacent cells without depending
  on a degenerate finite aperture mask.
- Multiple simultaneous current-cell intersecting portals can promote multiple direct neighbor
  cells.
- Non-intersecting portal rendering remains mask/composite driven.
- Internal direct-set portal masks are suppressed.
- Diagnostics report direct-set size, accepted crossings, suppressed internal edges, and missing
  resources.
- Focused tests cover candidate detection, direct-set construction, and frame-plan integration.
- Outdoor transition portal artifacts have a documented compositor-aware design before code changes
  attempt to solve them.
- `cd apps/holtburger-3d && npm run test:ts` passes for relevant focused tests at minimum.
- `cd apps/holtburger-3d && npm run lint:ts` passes.

## Open Questions And Provisional Answers

- **What epsilon values best match Asheron's Call render units for "camera intersects portal
  plane"?**  
  Start with a conservative fixed slab, likely `0.25` render units, and tune only after first visual
  proof. Do not expose tuning as a design-driving diagnostic control.

- **Should the detector use the camera eye point only, the near-plane center, or the full near-plane
  quad?**  
  Start with the camera eye point only. That matches the singular case and keeps the detector easy
  to reason about. Add near-plane center only if the first visual proof still shows black before the
  eye reaches the portal plane.

- **Do we need temporal hysteresis immediately, or does deterministic direct-set selection already
  avoid visible flicker?**  
  Do not implement hysteresis in Phase 1. Add deterministic ordering first. Add hysteresis only if
  direct-set membership flickers while the camera is stationary or moving slowly across the
  threshold.

- **Should promoted neighbor cells also expand static interest/prefetch proactively, or is current
  resident payload enough in the repro landblocks?**  
  Do not add new prefetch policy in the first implementation. The repro already has retained env
  cell payloads. Diagnostics should report accepted crossings with missing resource membership; if
  that appears in normal repros, add a follow-up static-interest phase.

- **Does the first direct-set slice cover outdoor transition portals?**  
  No. Outdoor transition artifacts are in scope, but they need Phase 4 design first because the
  renderer composites them through exterior scene-domain targets and `outdoorCrossings` masks, not
  only env-cell layered mask edges.

- **Do we need a direct-set enabled/disabled comparison toggle during Phase 5, or is manual repro
  enough?**  
  Skip the toggle initially. Add a temporary browser-local toggle only if the visual result is
  ambiguous or the integration becomes large enough that an A/B check materially lowers risk. Do
  not make the toggle part of the production runtime contract.
