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

Status: complete as of 2026-06-23.

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

- [x] Define detector input/output types and `RuntimePortalOverlapResidency`.
- [x] Implement landblock render-local camera/aperture coordinate conversion.
- [x] Implement plane/slab and padded aperture tests.
- [x] Compute deterministic overlap signatures.
- [x] Store current runtime portal overlap state next to current camera residency.
- [x] Add synthetic tests for env-cell and building-transition boundaries.
- [x] Add minimal runtime diagnostics plumbing.

Decisions and course corrections:

- Added `apps/holtburger-3d/src/v2/runtime/portal-base-overlap.ts` as a pure detector/runtime
  classification helper. It accepts env-cell portal edges attached to the current env cell,
  env-cell-root outdoor scene crossings targeting the current env cell, and outdoor-root
  building-transition edges.
- Added `StaticSceneQuery.queryPortalApertureResources` so detection uses committed CPU aperture
  resources, not renderer GPU resources or debug overlay geometry.
- Runtime now retains the latest `FrameState`, derives `RuntimePortalOverlapResidency` alongside
  current camera residency, exposes it in `RuntimeSnapshot` and diagnostics, and refreshes render
  planning only when the overlap signature changes.
- The detector currently uses projected aperture bounds after plane projection, not an exact
  polygon containment test. That is intentional for the first proof and should be tightened only if
  visual testing shows false-positive overlap cells.
- Missing overlap target resources are reported through
  `RuntimePortalOverlapResidency.missingResourceEnvCellIds`.
- Phase 1 deliberately does not add `portalOverlapSignature` to `PortalFramePlanKey`, attach
  `PortalBaseOverlapPlan` to frame plans, or draw overlap resources. Those remain Phase 2 and Phase
  3 work.

### Phase 2: Propagate Overlap Residency Into Frame Plans

Status: complete as of 2026-06-23.

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
- Include the discrete overlap signature in `PortalFramePlanKey` and portal frame-work equality, the
  same way the existing key already includes discrete camera-derived residency such as env-cell id
  or outdoor landblock id.
- Do not include continuous camera coordinates. If the signature is unchanged, the plan can be
  reused while the camera moves within the same straddled boundary set.
- Keep the existing static projection caches unchanged. They already cache static projection records
  by static source inputs; the runtime plan key should describe the enriched residency state that
  consumes those records.

Acceptance criteria:

- Frame-plan tests prove overlap residency env cells appear in the base-overlap plan.
- Duplicate candidates collapse to one overlap env-cell draw entry with multiple reasons.
- Missing resource membership is diagnosed without throwing.
- Existing projection graph shape remains unchanged when overlap is empty.
- Portal frame-work equality changes when the overlap signature changes and remains stable when only
  continuous camera coordinates change.

Task checklist:

- [x] Add renderer types for base-overlap plan data.
- [x] Add overlap signature handling to `PortalFramePlanKey` and portal frame-work equality.
- [x] Derive base-overlap frame-plan data from `RuntimePortalOverlapResidency`.
- [x] Resolve overlap env-cell resources from membership.
- [x] Add deterministic sorting and dedupe.
- [x] Add frame-plan tests for env-cell and building-transition overlap data.

Decisions and course corrections:

- Added `PortalBaseOverlapPlan` to direct env-cell portal frame-work plans. This is required data on
  direct plans rather than an optional diagnostics side channel, because the renderer will consume
  it in Phase 3.
- Runtime now adds `portalOverlapSignature` to `PortalFramePlanKey` and key equality. The signature
  is the discrete overlap-residency state; raw camera coordinates remain outside the key so cached
  plans can be reused while the camera moves within the same straddled boundary set.
- Env-cell-root plans receive the current runtime overlap residency directly. Outdoor-root retained
  plans pass overlap only to the seed landblock projection before retained projections are combined;
  non-seed retained projections receive empty overlap residency for the first proof.
- `createPortalProjectionFramePlan` resolves overlap env-cell ids through the existing
  `createNodeResources` path and records stable reasons per env cell. Duplicate overlap env-cell ids
  collapse to one base-overlap entry.
- `combineOutdoorPortalProjectionFramePlans` merges per-projection base-overlap plans after retained
  projection planning. This keeps the static projection graph unchanged while preserving overlap
  state for the renderer.
- Browser debug frame-plan summary now reports base-overlap cell count, missing overlap resources,
  exterior-seed requirement, and overlap signature.
- Phase 2 intentionally still does not draw overlap resources or seed indoor-to-outdoor exterior
  surfaces. Those are Phase 3 and Phase 5 respectively.

### Phase 3: Draw Base-Overlap Env Cells In Existing Paths

Status: implementation complete as of 2026-06-23; manual visual validation pending.

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

- [x] Split `#drawPortalProjectionFrameResources` into explicit base-resource and masked-layer
      helpers.
- [x] Add `#drawPortalBaseOverlapEnvCells`.
- [x] Insert overlap draw in ordinary env-cell and outdoor-root paths.
- [x] Verify depth state is normal before and after overlap draws.
- [x] Add renderer pass-order tests.

Decisions and course corrections:

- Split direct portal drawing into base-resource, base-overlap, and masked-layer helpers. The draw
  order is now explicit: base resources, overlap env-cell resources, then existing aperture-mask
  layers.
- `PortalBaseOverlapEnvCellPlan.resources` are drawn through the existing
  `#drawPortalFrameResourceSet` path, so overlap draws use the same static-object and structured
  interior material/depth behavior as ordinary direct env-cell resources.
- Outdoor-root projection composites now preserve the active `PortalBaseOverlapPlan` instead of
  passing only the projection graph. Exterior suffix helper composites intentionally receive an
  empty overlap plan because they are not the active camera base surface.
- Existing portal masks, masked layer rendering, and outdoor crossing copies remain unchanged.
- Added renderer tests for ordinary env-cell pass ordering and outdoor-root overlap propagation.
- Manual visual validation is still pending. This phase proves renderer pass order in tests, but it
  does not prove the black wedge is gone in live inside-inside or outdoor-to-indoor repros.

### Phase 4: One-Hop Env-Cell Overlap Closure

Status: implementation complete as of 2026-06-23; manual grid-junction validation pending.

Deliverables:

- Extend env-cell portal overlap detection to evaluate straddled portals attached to the immediate
  overlap env cells discovered from the canonical current env cell.
- Keep the closure strictly one env-cell hop beyond the canonical current env cell.
- Add diagnostics for seed env-cell count, one-hop candidate count, accepted one-hop cells, and
  whether the one-hop cap was reached.
- Add explicit runtime overlap diagnostics:
  - primary candidate count,
  - primary accepted boundary count,
  - one-hop seed env-cell count,
  - one-hop candidate count,
  - one-hop accepted boundary count,
  - one-hop traversal capped flag.
- Preserve the existing overlap signature model by including newly accepted one-hop boundaries and
  target env-cell ids.
- Add focused synthetic tests for a four-cell junction where the canonical current cell sees only
  part of the straddled neighborhood.

Likely files:

- `apps/holtburger-3d/src/v2/runtime/portal-base-overlap.ts`
- `apps/holtburger-3d/src/v2/runtime/portal-base-overlap.test.ts`
- `apps/holtburger-3d/src/v2/runtime/diagnostics.ts`
- `apps/holtburger-3d/src/pages/BrowserWorldDisplayV2.svelte`

Dry-run notes:

- This is not general portal visibility traversal. The detector should only run a second pass over
  env cells already accepted by the first pass from the canonical current env cell.
- Implementation should split the current candidate/classification flow into:
  - `createPrimaryPortalOverlapCandidates`,
  - `classifyPortalOverlapCandidates`,
  - `createOneHopEnvCellPortalCandidates`.
- The second pass should evaluate portals whose `sourceEnvCellId` is one of those first-pass overlap
  env cells, using the same camera-eye plane slab and projected aperture bounds.
- The second pass should explicitly reject reverse edges whose `targetEnvCellId` is the canonical
  current env cell. We want missing neighboring cells, not the current cell re-added as overlap.
- Do not recursively evaluate env cells accepted by the second pass. The cap is intentionally fixed
  at one extra env-cell hop to cover junctions without expanding into full graph search.
- Outdoor building-transition overlap remains governed by the current outdoor/transition rules in
  this phase. Keep this phase focused on env-cell-to-env-cell junction closure.
- Do not seed one-hop closure from building-transition boundaries.
- Stable sorting and dedupe should make a one-hop accepted cell indistinguishable from a first-pass
  cell to later frame-plan and renderer phases, except for diagnostics/reasons.

Acceptance criteria:

- Synthetic tests prove a four-cell junction can accept the missing adjacent env cell through a
  first-pass neighbor's straddled portal.
- Tests prove the detector does not traverse beyond one extra env-cell hop.
- Tests prove reverse edges back to the canonical current env cell are not emitted as base-overlap
  cells.
- The overlap signature changes when the one-hop accepted set changes and remains stable under
  continuous camera movement inside the same accepted boundary set.
- Existing single-portal overlap tests remain unchanged.
- Manual env-cell grid junction repro no longer shows the remaining black wedge when all involved
  resources are resident.

Task checklist:

- [x] Add one-hop closure inputs/diagnostics to runtime overlap detection.
- [x] Split candidate creation/classification so primary and one-hop passes share classifier logic.
- [x] Collect first-pass overlap env cells as one-hop seeds.
- [x] Evaluate only env-cell portal edges sourced from one-hop seeds.
- [x] Filter one-hop reverse edges back to the canonical current env cell.
- [x] Dedupe and sort first-pass and one-hop overlap cells into one base-overlap set.
- [x] Add four-cell junction tests and one-hop cap tests.
- [x] Add reverse-edge rejection test.
- [x] Surface concise one-hop diagnostics in existing debug summaries.

Decisions and course corrections:

- Added after Phase 3 visual testing showed base overlap removed most env-cell portal artifacts, but
  a remaining black wedge can appear at grid junctions where the camera intersects multiple portal
  polygons at once.
- The closure is deliberately capped at one env-cell hop. We want boundary-neighborhood fill, not a
  second portal visibility system.
- Dry-run finding: most of this phase should stay inside `portal-base-overlap.ts`. Frame-plan
  construction and renderer drawing should keep consuming the final base-overlap env-cell set
  unchanged.
- Split detector flow into primary candidate creation, shared candidate classification, and one-hop
  candidate creation. The one-hop pass only runs for env-cell residency and only seeds from accepted
  first-pass env-cell portal boundaries.
- Added runtime overlap diagnostics for primary candidates/acceptances, one-hop seeds,
  candidates/acceptances, and the one-hop cap. `oneHopTraversalCapped` means one-hop boundaries were
  accepted and traversal intentionally stopped there; it does not imply that a deeper candidate was
  separately detected.
- Reverse edges targeting the canonical current env cell are filtered before one-hop classification
  so the base-overlap set does not re-add the current cell.
- Browser debug output now includes a `Portal overlap` row with primary and one-hop detector counts.
- Manual validation of the grid-junction repro remains pending.

### Phase 5: Exterior-Seeded Indoor-To-Outdoor Straddles

Status: implementation complete as of 2026-06-23; manual indoor-to-outdoor validation pending.

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

- [x] Add a frame-plan flag for exterior-seeded base surfaces.
- [x] Branch env-cell-root outdoor crossing path on that flag.
- [x] Copy outdoor crossing source color/depth into destination instead of clearing when selected.
- [x] Draw base and overlap env cells into the exterior-seeded destination.
- [x] Keep outdoor crossing copy pass unchanged for proof.

Decisions and course corrections:

- Reused `PortalBaseOverlapPlan.requiresExteriorSeed` as the frame-plan flag instead of adding a
  second renderer-specific flag. It already captures the straddled indoor-to-outdoor transition
  condition from runtime overlap residency.
- Env-cell-root frames with outdoor crossings now prepare the working destination through a single
  helper. Non-straddled frames keep the old clear-to-background behavior. Straddled frames copy the
  selected outdoor crossing source color/depth into the destination before direct env-cell and
  base-overlap resources draw.
- The outdoor crossing source is unchanged: raw exterior when no exterior suffix composite is
  present, or the exterior suffix composite when retained outdoor projection is needed.
- Existing outdoor crossing copy passes remain unchanged for this proof, so exterior may still be
  copied again through transition masks after the base surface has already been seeded.
- Added renderer diagnostics `exteriorSeededBase` for this branch and tests that prove seeded frames
  copy exterior before direct resource draws while non-straddled suffix frames remain unseeded.
- Manual indoor-to-outdoor transition validation found that the seeded branch activates, but the
  later outdoor crossing copy can still overwrite the indoor scene through the same
  near-plane-intersecting transition mask. The current raw-exterior/exterior-suffix split is also
  too exposed in the env-cell crossing path; we should collapse it into a selected outdoor composite
  source before changing the indoor-to-outdoor composition order.

### Phase 6: Course Correct Indoor-To-Outdoor Composition

Deliverables:

- Introduce a single selected outdoor composite source abstraction for env-cell-root frames with
  outdoor crossings.
- Hide whether the source is raw exterior or an exterior suffix composite behind that abstraction.
- Render/copy flow should match:
  1. render the selected outdoor composite source,
  2. copy its color to the env-cell destination as the visual base surface for indoor-to-outdoor
     frames, while clearing destination depth/stencil,
  3. stencil the outdoor transition apertures,
  4. draw the resident/base env cell through the inverted outdoor-transition stencil,
  5. draw accepted base-overlap env cells directly/unmasked,
  6. draw normal masked env-cell layers,
  7. skip the late outdoor-crossing source-copy pass for this env-cell-root frame shape.
- Treat outdoor color as the transition-side visual owner and indoor env-cell geometry/depth as the
  inverse-side owner instead of stamping outdoor over an already-composed indoor target late in the
  frame. The proof slice does not copy outdoor depth into the env-cell destination.
- Keep diagnostics that report the selected outdoor source kind, exterior seeded base flag, and
  whether the env-cell-root outdoor crossing pass was bypassed by this ownership path.

Likely files:

- `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.ts`
- `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.test.ts`
- `apps/holtburger-3d/src/v2/renderer/types.ts`
- `apps/holtburger-3d/src/pages/BrowserWorldDisplayV2.svelte`

Dry-run notes:

- Add a helper such as `#renderSelectedOutdoorCompositeSource(plan, targets)` that always returns
  the source surface for outdoor crossing/base seeding. Internally, it renders raw exterior first
  and, when `plan.exteriorComposite` exists, renders the suffix composite from that exterior source.
- Model the helper return explicitly, for example:
  - `kind: "raw-exterior" | "exterior-suffix"`,
  - `target: SceneDomainTarget`.
- Env-cell-root outdoor crossing path should consume the selected source without caring whether it
  is raw exterior or suffix.
- For env-cell-root frames with outdoor crossings, copy selected outdoor source color to the
  destination before direct env-cell resources draw, then clear destination depth/stencil. This is no
  longer conditional on overlap; the selected outdoor source is the visual base surface for the
  frame shape.
- Build the outdoor-transition stencil from the frame's `outdoorCrossings` before drawing the
  resident/base env-cell resources.
- Draw the resident/base env-cell resources with a stencil test that accepts pixels outside the
  outdoor-transition stencil. This is the "inverted transition mask" path.
- Draw `baseOverlap.envCells` after the resident/base env cell with ordinary direct geometry
  depth/stencil behavior, so straddled cells cover the near-plane intersection without depending on
  the transition aperture.
- Draw normal masked env-cell layers after direct base/overlap resources.
- Do not call `#drawPortalProjectionOutdoorCrossings` for this env-cell-root outdoor-crossing path;
  the outdoor source is already the base surface, and the late copy currently uses `gl.ALWAYS`
  depth with copied source depth.
- Do not change outdoor-root projection composite behavior in this phase unless the helper naturally
  removes duplication.

Acceptance criteria:

- Renderer tests prove raw exterior and exterior suffix paths both expose the same selected-source
  behavior to env-cell-root crossing rendering.
- Renderer tests prove env-cell-root outdoor-crossing frames use selected outdoor source color as
  the destination visual base, clear destination depth/stencil before indoor geometry draws, draw
  base env-cell resources through the inverted transition stencil, and bypass the late outdoor
  crossing source-copy pass.
- Renderer tests prove accepted base-overlap env cells draw directly/unmasked after the inverted
  base env-cell pass.
- Renderer tests prove outdoor-root projection composite behavior still renders through the existing
  outdoor-base path.
- Browser diagnostics expose selected source, exterior seeded base, and the ownership-path bypass.
- Manual indoor-to-outdoor repro no longer hollows the building when exterior seeding is active, and
  outdoor terrain depth cannot reject indoor geometry below the outdoor ground surface because it is
  not copied into the env-cell destination.

Task checklist:

- [ ] Add selected outdoor composite source helper.
- [ ] Route env-cell-root outdoor crossing destination setup through the selected source helper.
- [ ] Add an outdoor-transition stencil build step for env-cell-root outdoor-crossing frames.
- [ ] Draw resident/base env-cell resources through the inverted outdoor-transition stencil.
- [ ] Keep base-overlap env-cell resources direct/unmasked after the inverted base pass.
- [ ] Bypass the late outdoor-crossing source-copy pass for env-cell-root outdoor-crossing frames.
- [ ] Add ownership-path bypass diagnostics.
- [ ] Update debug probe to include selected source and ownership-path bypass state.
- [ ] Add renderer tests for raw source, suffix source, inverted base draw, direct overlap draw, and
      bypassed outdoor-crossing copy.

Decisions and course corrections:

- Added after Phase 5 diagnostics proved the indoor-to-outdoor branch was seeded and direct env-cell
  resources were planned/drawn, while the later outdoor crossing copy still targeted the same
  straddled env cell. The remaining failure is likely the composition model itself: indoor-to-outdoor
  currently uses an indoor base plus a late outdoor stencil-copy, while outdoor-to-indoor already
  behaves like an outdoor base plus inserted env-cell geometry.
- The renderer should treat raw exterior and exterior suffix as implementation details of one
  selected outdoor composite source. The suffix still depends on raw exterior internally, but
  env-cell crossing composition should not branch on that distinction.
- User course correction: duplicate-copy suppression is less attractive than making
  indoor-to-outdoor isomorphic with outdoor-to-indoor. The new model lays down outdoor first, uses
  the transition aperture as an ownership stencil, draws the resident/base env cell through the
  inverted stencil, and draws straddled overlap env cells directly so there is no black region when
  the camera intersects the transition plane.
- Outdoor depth will not be copied for the proof slice: terrain can be above interior cells, and
  copying outdoor depth into the env-cell destination can reject valid indoor geometry. The inverted
  ownership stencil is intended to let outdoor color own the transition side while indoor geometry
  owns destination depth where it draws.
- The late outdoor-crossing copy is intentionally bypassed for this frame shape because it is a
  source-scene copy under stencil with depth func `gl.ALWAYS`; it is not equivalent to re-rendering
  outdoor geometry with normal depth testing.

### Phase 7: Resteer After Visual Proof

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

### Phase 8: Stabilization And Cleanup

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

- **Augment the existing residency-based cache key.**  
  The existing runtime plan key is already driven by discrete camera-derived residency: env-cell id
  or outdoor landblock id. Portal overlap should follow the same pattern. Add a stable
  `portalOverlapSignature` to `PortalFramePlanKey` and equality, but never add raw camera
  coordinates. The static projection caches stay unchanged.

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
