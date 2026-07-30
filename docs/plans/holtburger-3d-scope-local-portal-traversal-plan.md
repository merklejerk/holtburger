# Holtburger 3D Scope-Local Portal Traversal Plan

Status: In progress — post-completion outdoor-root field verification
Created: 2026-07-30
Evidence pass: 2026-07-30

## Context and Boundaries

### Goal

Separate EnvCell visibility traversal from visibility-island draw ownership so concave connected
interiors receive correctly clipped portal paths and can re-enter an already-rendered domain without
losing bounded fixed-point planning or direct exterior composition.

### Problem Statement

The current portal planner uses one `PortalRenderNode` for every proof-backed indoor visibility
island. That is the correct draw-ownership shape, but the same node currently owns traversal
coverage:

- the camera's root render node receives a full-screen `PortalViewWindow`;
- expanding that node enumerates outgoing crossings from every EnvCell scope in the island;
- every enumerated scope inherits the same full-screen window, even when no clipped path from the
  camera's actual EnvCell reaches it; and
- a reached domain is scheduled once, so an exterior transition can replace root-island pixels
  without a later masked contribution restoring a legitimately re-entered portion of that island.

Landblock `0x7D64FFFF` exposes both defects in one view. Camera EnvCell `0x7D640113` belongs to the
same depth-continuous visibility island as both doorway cells of an L-shaped building. The admitted
route is `0x7D640113 -> 0x7D640119 -> outdoor -> 0x7D64011A`, whose final target resolves back to the
root render island. The masked exterior pass clears color and depth inside the near doorway's
label, including the projected far doorway. The planner retains the valid outdoor-to-root return
edge, but root-wide full coverage subsumes the return window and the root-contained exterior
component schedules no suffix redraw. Terrain therefore replaces the layer-zero root pixels and no
indoor contribution restores the far room.

Domain-wide full-window expansion remains a structural defect even though it is not, by itself,
the complete explanation for this screenshot. It attempts crossings from every island member
without proving that a clipped scope-local path reached that member. A root-contained suffix-only
patch would repair this particular return draw while retaining false crossing attempts and invalid
window inheritance elsewhere. Both traversal locality and repeated contribution scheduling are
required.

### In Scope

- Give portal traversal exact window coverage per `SceneScope`, beginning with only the camera's
  authoritative root scope.
- Propagate windows through `indoor-depth-continuous` seams without spending stencil masks or
  splitting their shared render domain.
- Preserve unique visibility-island render ownership independently from traversal state.
- Represent planner-authored masked contributions that may submit one render node more than once
  in disjoint execution regions.
- Support a root indoor contribution followed by masked exterior work and a masked return
  contribution into the root island.
- Update SCC/exterior-component planning, stencil-capacity preflight, plan validation, and the
  mechanical WebGL executor for the accepted contribution schedule.
- Add a permanent synthetic L-shaped regression and focused GPU readback coverage.
- Re-run existing dense, cyclic, near-plane, and archive-backed portal probes as manual acceptance
  gates.
- Update portal architecture documentation and remove vocabulary that claims every reached render
  node is necessarily submitted exactly once.

### Out of Scope

- Changing EnvCell, CellStruct, building-portal, or effective-aperture host projection.
- Weakening the proof required to form a depth-continuous visibility island.
- Treating authored potentially-visible-cell lists as traversal authority.
- Changing player or camera residency, collision, movement crossing, or third-person camera policy.
- Reintroducing the sampled exterior color/depth composition path.
- Adding a permanent flat-render fallback for unsupported portal graph shapes.
- Replacing exact portal windows with a viewport grid, tile approximation, or heuristic hop limit.
- Restoring the previously rejected unbounded simple-path/ancestry planner.
- Adding durable diagnostic fields or UI solely to investigate this defect.
- Modifying ACE, ACViewer, or the retail client decompile.

## Ground Truth

### Runtime and Renderer Contracts

- `apps/holtburger-3d/src/lib/game/runtime/env-cell-realization.ts`
  - unions only host-proven `indoor-depth-continuous` crossings into visibility islands;
  - must continue to preserve independent EnvCell scopes inside each island.
- `apps/holtburger-3d/src/lib/game/scene/scene-graph.ts`
  - retains source-keyed crossing adjacency and independent scope identities;
  - provides the immutable topology view consumed by the renderer.
- `apps/holtburger-3d/src/lib/game/renderer/portal-render-graph.ts`
  - combines scope-local traversal coverage, unique render-node discovery, SCC layering, exterior
    scheduling, and stencil-capacity preflight;
  - seeds only the authoritative root scope with `createFullPortalViewWindow`;
  - expands only source-keyed crossings from the work item's exact scope.
- `apps/holtburger-3d/src/lib/game/renderer/portal-view-window.ts`
  - owns exact monotonic NDC-window admission, containment, convex normalization, and immutable
    source-aperture decomposition;
  - removes triangulation-only seams without approximating concave or disconnected regions.
- `apps/holtburger-3d/src/lib/game/renderer/portal-render-plan-validation.ts`
  - validates ordinary, exterior, deferred, and additional contribution occurrences without
    reconstructing planner policy.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-executor.ts`
  - directly initializes and renders exterior scene ownership under planner-assigned labels;
  - resolves masks and executes the complete planner-authored schedule mechanically.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-substrate.ts`
  - owns the accepted parent-constrained stencil promotion, masked scene initialization, and masked
    depth reset primitives.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
  - resolves one render node from its reached member scopes;
  - reuses that resolved contribution when the planner schedules the node again.

### Tests and Browser Fixtures

- `apps/holtburger-3d/src/lib/game/renderer/portal-render-graph.test.ts`
  - covers scope-local fixed-point admission, unique render nodes, exterior SCCs, non-root
    suffixes, alternating re-entry, and the L-shaped root-island regression.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-executor.test.ts`
  - proves mechanical call order for root, exterior, deferred/additional suffix, and sibling
    shapes.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-hybrid-portal-executor-fixture.ts`
  - is the preferred browser-level fixture for root/exterior/suffix composition and readback.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-internal-portal-executor-fixture.ts`
  - protects ordinary internal masked-layer behavior.

### Historical Decisions

- `docs/plans/holtburger-3d-env-cell-e2e-integration-plan.md`
  - records the failed ancestry-preserving path planner that exceeded 100,000 work items;
  - records the fixed-point unique-node cutover and archive-backed dense/cyclic probes;
  - establishes that visibility islands are render scheduling domains, not flattened scope
    identities.
- `docs/plans/holtburger-3d-direct-portal-compositing-plan.md`
  - establishes masked exterior color/depth initialization as load-bearing;
  - establishes parent-constrained suffix promotion and direct exterior rendering;
  - currently assumes root-contained exterior components require no suffix redraw.
- `docs/portal_rendering.md`
  - describes the accepted portal planner and executor and must be updated after the cutover.

### Authoritative Reference Evidence

- `dats/assets.hba`, inspected through the app's headless content boundary:
  - building index 1 is model `0x01000E11` at local origin `[84.5, 133.5, 12.0]`;
  - `0x7D640113` has placed render bounds `x = 74..83`, `z = -131..-125.5`;
  - the screenshot coordinate label `21.5S, 1.7W` constrains the camera to those same local bounds
    after coordinate rounding and residency resolution;
  - `0x7D640113/2 -> 0x7D640119/1` is a depth-continuous seam leading to the near exterior portal;
  - building portal 0 / `0x7D640119/0` lies at `z = -131.5` and admits
    indoor-to-outdoor traversal from every valid point in the camera cell;
  - building portal 4 / `0x7D64011A/1` lies at `x = 83`, is perpendicular to portal 0, and admits
    outdoor-to-indoor traversal from every valid point in the camera cell;
  - all fourteen cells `0x010E..0x011B` resolve to one visibility island, so the far return targets
    the root render node rather than a second building placement;
  - reciprocal building/EnvCell aperture normals match and maximum measured plane deviation is
    approximately `1.5e-5`, acquitting topology and projection data;
  - archive facts are manual diagnostic evidence, not a permanent test dependency.
- `acclient-eor-source/acclient.h`
  - `CEnvCell` retains `num_view` and `DArray<portal_view_type *> portal_view`;
  - `portal_view_type` retains per-view portal and cell-view state;
  - `PView::ClipPortals` processes each reached cell's newly appended view range and copies clipped
    views to the destination cell;
  - `PView::DrawCells` iterates the accumulated views of reached cells rather than drawing every
    cell in a transitive grouping;
  - these functions support cell-local monotonic traversal, reached-scope selection, and repeated
    draw contributions without requiring the WebGL implementation to copy retail allocation or
    ordering details.
- ACE and ACViewer remain ground truth for data interpretation. Neither currently supplies the
  complete retail rendering policy needed to replace proof with imitation.

## North Stars

1. A render domain answers what can share ordinary depth; a traversal state answers how the camera
   reached a scope. Never collapse those questions into one key.
2. Seed visibility from the camera's authoritative EnvCell, not every cell that shares its draw
   domain.
3. Preserve exact monotonic window admission and a demonstrably bounded fixed point.
4. Depth-continuous seams spend no stencil, but they do not erase cell-local traversal boundaries.
5. The planner authors every draw occurrence, mask, label, and withholding decision; the executor
   mechanically consumes them.
6. Reusing geometry and scene contributions does not imply submitting them only once.
7. Preserve direct exterior initialization and depth ownership rather than papering over the bug
   by weakening composite boundaries.
8. Prove the smallest sufficient state model before adding arrival ancestry.
9. Keep permanent tests synthetic and deterministic; use archive/browser cases as manual gates.

## Target Invariants

### Traversal State

- The initial work item is `(rootScope, fullWindow)`.
- Coverage is admitted against the exact source scope being reached, not its visibility island.
- Expanding a work item enumerates only `topology.outgoing(workItem.scope)`.
- A depth-continuous indoor crossing:
  - clips the current window through its effective aperture;
  - admits the result to the target EnvCell scope;
  - enqueues only novel target-scope coverage; and
  - emits no stencil mask edge because both scopes share a render domain.
- A crossing between different render domains clips and admits its window before emitting the
  planner's executable transition/mask facts.
- A non-empty crossing remains available as execution evidence even when its target scope already
  covers the projected window. Coverage subsumption controls re-expansion, not whether a valid
  transition exists.
- Facing and near-plane decisions consume the same scope-local work item whose window reaches the
  aperture. No portal inherits a full window merely because its scope shares a render domain with
  the root.

### Render Ownership and Contributions

- Each outdoor domain or proof-backed indoor visibility island retains one
  `PortalRenderNode`.
- Scene contributions for one render node are resolved once per view and may be submitted through
  multiple planner-authored contribution occurrences.
- A render node contains only member scopes proved reachable by traversal. Visibility-island
  membership authorizes shared ordinary-depth ownership; it is not scene-selection authority.
- Layer zero contains the ordinary root contribution.
- A later return into the root domain is an additional masked contribution; it does not relocate or
  suppress the layer-zero root draw.
- A non-root exterior suffix may defer its indoor nodes from ordinary layer execution and submit
  them once through the suffix.
- The plan explicitly distinguishes:
  - nodes drawn by an ordinary layer;
  - nodes withheld from ordinary execution;
  - nodes drawn by a suffix; and
  - nodes additionally redrawn by a suffix after an earlier ordinary contribution.
- Exterior entry initialization remains authoritative inside its label. Returned indoor work
  retains exterior color, resets depth only inside the parent-constrained suffix label, and draws
  through that label.
- Exterior geometry remains submitted at most once per independent view.

### Bounded Fixed Point

- Coverage state is keyed only by `SceneScope`.
- `admitPortalViewWindow` monotonically grows a finite normalized union of window fragments for
  each scope and returns only novel coverage for further expansion.
- Projection through an aperture is monotone: clipping a subset of a source window cannot produce
  target coverage outside the result of clipping its superset.
- Therefore expanding only novel scope-local coverage reaches the same geometric visibility union
  as enumerating all finite portal paths, while repeated or subsumed arrivals terminate.
- Crossing admission remains independent from target-coverage admission. A valid transition can
  contribute execution provenance even when its target window adds no traversal coverage.
- Arrival ancestry is not part of reachability state. Parent ownership for masked execution is
  represented by the planner-authored contribution and stencil-transition contract.

### Validation and Capacity

- Plan validation permits repeated node submission only through an explicit planner-authored
  contribution contract.
- No node is accidentally omitted because the executor inferred withholding from suffix
  membership.
- Every mask edge is consumed by exactly one named execution operation or explicitly retained as
  non-drawing cycle provenance.
- Every stencil label written by execution is included in capacity preflight.
- The executor performs no SCC analysis, contribution classification, or label allocation.

## Phased Implementation

## Phase 0: Encode the Proven Failing Graph

### Deliverables

- Add a permanent pure-planner L-shaped synthetic regression using:
  - a root camera EnvCell and the near doorway EnvCell in one render island;
  - multiple depth-continuous member scopes in one render island;
  - a near exterior exit;
  - a perpendicular outdoor-to-indoor return path through the far doorway; and
  - at least one unrelated island-member exterior crossing that proves domain-wide expansion is
    invalid independently from the valid near-exit/return cycle.
- Encode the measured `0x7D64` plane sides and relative layout synthetically; do not depend on the
  runtime archive.
- Use an exact temporary frame probe only if the screenshot camera orientation cannot be
  reconstructed when performing the final manual visual gate.

### Task Checklist

- [x] Build the synthetic topology from explicit apertures rather than mock planner output.
- [x] Prove only the camera scope owns the initial full window.
- [x] Prove the near indoor-to-outdoor crossing is reachable through depth-continuous propagation.
- [x] Prove the outdoor-to-far-indoor crossing is reachable through the near exterior window and
      targets the already-rendered root island.
- [x] Demonstrate that the current planner expands non-root member scopes with the root full window.
- [x] Demonstrate that a valid return mask cannot cause an additional root submission.
- [x] Capture exact archive-frame cells, edge directions, accepted sides, island membership, and
      aperture agreement before relying on aggregate diagnostics.
- [x] Remove temporary logs, bins, or probes that have no named ongoing consumer.

### Acceptance Criteria

- The synthetic regression fails for the two intended reasons and no unrelated geometry reason.
- The synthetic route matches the measured archive crossing directions and accepted sides.
- No permanent test depends on `dats/assets.hba` or a running Explorer.

### Decisions and Course Corrections

- The screenshot is a root-island/exterior/root-island cycle through building portals 0 and 4, not
  a second building placement.
- The root-contained suffix hole is part of the observed failure, not merely adjacent debt.
- Domain-wide traversal remains independently invalid and stays in the same cutover.
- The permanent synthetic regression failed only on the unrelated island-member exit and missing
  root suffix before implementation, pinning both mechanisms independently.

## Phase 1: Separate Scope Coverage from Render Nodes

### Deliverables

- Replace node-keyed traversal work items with scope-keyed work items.
- Add exact scope-local coverage storage using `admitPortalViewWindow`.
- Keep the immutable topology index's scope-to-render-domain mapping.
- Propagate clipped windows across depth-continuous crossings without creating mask edges.
- Create/select render nodes only as render ownership requires, independently from traversal
  coverage.

### Task Checklist

- [x] Introduce a traversal-state type whose identity names a `SceneScope`.
- [x] Seed only `rootScope` with `createFullPortalViewWindow`.
- [x] Remove domain-wide scope enumeration from one work-item expansion.
- [x] Route depth-continuous crossings through the same exact projection path as other crossings.
- [x] Preserve near-plane handling without seeding unrelated island members.
- [x] Preserve edge admission before target-coverage delta rejection.
- [x] Derive `selectedScopes` from proved traversal/render needs rather than eagerly selecting an
      entire domain as an accidental traversal side effect.
- [x] Update projection, work-item, and maximum-fragment diagnostics to describe scope-local state.
- [x] Delete node-coverage fields and comments whose meaning no longer survives.

### Acceptance Criteria

- The L-shaped regression admits the valid far outdoor-to-root return but does not attempt an
  unrelated exterior crossing merely because its source scope shares the root island.
- A dense depth-continuous island uses zero masks for its internal seams.
- Existing sibling-window, near-plane, facing, non-exact, and work-limit tests remain valid.
- The planner reaches a fixed point without path enumeration.

### Decisions and Course Corrections

- A render node selects only its reached member scopes. Retail accumulates and draws views per
  reached `CEnvCell`, and the historical architecture explicitly forbids treating visibility
  islands as culling groups.
- A newly reached member scope is added to its existing render node's immutable final scope list;
  render-node identity remains the visibility-island identity.
- Same-domain topology boundaries also propagate clipped scope coverage without a stencil mask.
  Skipping them was only safe while the renderer incorrectly selected every island member.

## Phase 2: Prove Termination and Re-entry

### Deliverables

- Dry-run the remaining graph algorithm against:
  - the synthetic L-shaped re-entry;
  - a non-root exterior suffix;
  - a root re-entry whose target scope already has full coverage;
  - `island A -> outdoor -> island B -> outdoor -> island A`;
  - sibling routes that overlap at one target scope; and
  - the historical dense path-growth fixture.
- Prove scope-keyed monotonic coverage against the graph matrix before changing execution
  scheduling.
- Record measured work-item and fragment growth; do not broaden state beyond
  `(scope, admitted window coverage)` without a counterexample to the monotonicity argument.

### Task Checklist

- [x] Verify that edge admission before coverage subsumption is sufficient for the L-shaped case.
- [x] Prove that a subsumed return window needs transition/contribution evidence but no traversal
      re-expansion because the target scope's superset coverage already expanded every outgoing
      aperture region reachable from that return.
- [x] Keep transition admission before target coverage subsumption.
- [x] Assert the monotonic clipping property with nested source-window tests.
- [x] Reject any design whose termination depends on a convenient test graph or a raised work
      ceiling.
- [x] Update later phases to match the accepted state and contribution model.

### Acceptance Criteria

- The remaining plan names a finite state space and monotonic admission rule.
- The accepted model does not restore simple-path enumeration.
- The accepted state key is `SceneScope`; no arrival discriminator is introduced without a failing
  counterexample.
- Historical dense fixtures remain expected to complete below the corruption-only work ceiling.

### Decisions and Course Corrections

- Scope-keyed monotonic coverage is the accepted reachability state. A subsumed arrival cannot
  reveal downstream geometry that was absent from an already-expanded superset window.
- Re-entry provenance is an execution-scheduling concern and must not infect termination state.
- A permanent alternating `root -> outdoor -> other -> outdoor -> root` fixture retains all four
  transitions, records two subsumed arrivals, and terminates below twenty consumed work units.

## Phase 3: Author Explicit Render Contributions

### Deliverables

- Replace the one-node/one-layer submission invariant with a typed planner-authored contribution
  schedule.
- Represent ordinary, exterior, deferred-suffix, and additional re-entry work without executor
  inference.
- Preserve unique `PortalRenderNode` ownership and reuse its resolved scene contribution.
- Update exterior-component construction and stencil-capacity preflight for root-contained return
  work.

### Task Checklist

- [x] Define the composite type that couples suffix masks, stencil transition, submitted indoor
      nodes, and ordinary-withholding decisions.
- [x] Make each `PortalRenderLayer` contain executable contributions rather than parallel
      `renderNodeIds` and `incomingMaskEdgeIds` arrays.
- [x] Represent indoor work as an explicit contribution containing its node IDs, mask edge IDs,
      stencil value, and ordinary submission role.
- [x] Represent exterior work as one atomic contribution containing entry masks, outdoor node and
      label, plus an optional indoor suffix whose role is either `deferred` or `additional`.
- [x] Keep the root in layer zero when it also appears in a later masked contribution.
- [x] Withhold only nodes the planner explicitly marks as deferred.
- [x] Permit suffix submission of a previously submitted node only when the operation names it as
      additional work.
- [x] Continue treating return-to-outdoor edges as cycle provenance without redrawing exterior.
- [x] Re-evaluate `mainExteriorMemberIds` and same-layer label isolation from execution ownership;
      change it only if a concrete graph proves the current definition wrong.
- [x] Include every additional suffix label in capacity preflight.
- [x] Remove the blanket claim that render nodes are scheduled exactly once.

### Acceptance Criteria

- A root-containing exterior component can retain the root base draw and add a masked root return.
- Existing non-root suffix nodes remain absent from ordinary execution and appear once in their
  suffix.
- Same-layer sibling contributions retain distinct labels and cannot leak into exterior or suffix
  regions.
- Exterior remains a single submission per independent view.

### Decisions and Course Corrections

- Use a complete contribution schedule. `preparePortalExecution` may resolve mask resources, but it
  must not classify nodes, infer withholding, or invent contributions.
- A deferred suffix has no earlier ordinary submission; an additional suffix must name a node
  already submitted ordinarily. The union encodes that distinction and validation enforces it.
- One exterior suffix may contain both `additional` and `deferred` submission groups. Root SCCs can
  contain indoor nodes on both sides of the exterior graph layer, so a component-wide role would
  either double-submit or omit a node. Execution flattens the classified groups into one renderer
  call to preserve global material and transparency ordering.
- Same-layer isolation now treats the entire exterior SCC as one contribution owner. Only nodes
  outside that component force a distinct exterior label.

## Phase 4: Validate and Execute the New Contract

### Deliverables

- Update `validatePortalRenderWorkPlan` for explicit repeated contributions.
- Refactor `preparePortalExecution` to consume planner-authored ordinary/deferred/additional
  decisions directly.
- Execute root-contained suffix work with parent-constrained stencil promotion, masked depth reset,
  and retained exterior color.
- Reuse already-resolved render-node scene contributions for additional submissions.

### Task Checklist

- [x] Validate every contribution's node, mask, layer, label, and operation ownership.
- [x] Reject an unmarked repeated submission.
- [x] Reject a node simultaneously withheld and required by an ordinary contribution.
- [x] Reject unused masks, labels, or suffix membership.
- [x] Delete executor-side `suffixMemberIds` policy derivation.
- [x] Preserve failure-before-allocation behavior.
- [x] Update execution diagnostics to count submissions honestly without duplicating node-identity
      counts.
- [x] Retain unique render-node count and total render-node submissions as distinct metrics; rename
      the panel label to `Portal node submissions / unique nodes`.
- [x] Rename admitted window state to admitted scope-window state and expose it only if Phase 6
      uses it as the boundedness signal.
- [x] Remove `selectedScopeCount` and `submittedRenderLayerCount` from portal execution diagnostics
      if they remain redundant/unconsumed rather than adding ceremonial UI.
- [x] Keep masked exterior initialization unchanged.

### Acceptance Criteria

- The executor call trace draws the root once ordinarily and once through the return suffix.
- Invalid repeated/withheld schedules fail before target allocation.
- Existing outdoor-root, singleton exterior, non-root suffix, and sibling executor tests pass.
- No executor branch reconstructs topology or SCC membership.

### Decisions and Course Corrections

- `PortalRenderWorkPlan.exteriorComponent` was deleted. The exterior SCC facts now live on the
  executable exterior contribution, removing a parallel contract that the executor previously
  reconciled with layer arrays.
- `preparePortalExecution` resolves masks and flattens classified suffix groups only; it no longer
  classifies nodes, infers withholding, chooses exterior masks, or allocates labels.
- The executor passes the planner-named outdoor node ID to the renderer callback instead of making
  the renderer search the plan for exterior ownership.
- The admitted scope-window count is now a consumed frame metric for Phase 6 boundedness checks.
  Redundant selected-scope and submitted-layer execution diagnostics were deleted.

## Phase 5: Prove GPU Composition

### Deliverables

- Extend the hybrid portal browser fixture with an L-shaped root-island case.
- Render distinguishable root-interior, exterior, and far-interior colors/depths.
- Read back pixels inside the near exit, far return, wall, and unrelated sibling regions.
- Cover opaque depth and at least one blended suffix case.

### Task Checklist

- [x] Prove exterior color/depth becomes authoritative through the near exit.
- [x] Prove far indoor content is restored only inside the parent-constrained return mask.
- [x] Prove the original root contribution survives outside exterior labels.
- [x] Prove the suffix cannot escape the exterior parent label.
- [x] Prove nearer exterior depth can block returned indoor geometry where appropriate.
- [x] Prove transparent returned indoor content blends over retained exterior color.
- [x] Preserve substrate state restoration and target reuse checks.

### Acceptance Criteria

- GPU readback catches the original clear/terrain/void failure.
- The accepted trace uses existing substrate primitives without a new fallback target.
- Opaque, alpha-tested, transparent, and additive ordering remains covered in proportion to the
  changed scheduling contract.

### Decisions and Course Corrections

- The hybrid browser fixture now executes a root-contained cycle with one near exterior aperture
  and two return apertures. One return lies inside the exterior parent label and restores the
  established opaque/transparent/additive indoor blend; the other lies outside the parent and is
  rejected by stencil promotion.
- Readback separately proves returned indoor color, retained exterior color, and untouched root
  color. The trace proves two unique nodes, three node submissions, one exterior render, and three
  mask draws.
- The first exterior-only sample accidentally targeted the authored aperture's clipped notch. The
  blue readback was correct; the fixture sample moved to the near-door band outside the suffix
  aperture. No execution change was required.
- The production Chrome/WebGL harness passed with no console messages after the sample correction.

## Phase 6: Archive and Performance Gate

### Deliverables

- Run the affected `0x7D640113` Explorer view at a reconstructed orientation that shows the near
  exit and perpendicular far return; capture the exact pose used for the acceptance record.
- Re-run the established archive-backed portal probes, including the historical dense and exterior
  fixtures.
- Compare work items, admitted scope-window states, retained fragments, render nodes, render
  contributions, mask edges, stencil capacity, and frame timings.
- Resteer before cleanup if scope-local traversal regresses boundedness or scene completeness.

### Task Checklist

- [x] Verify the room behind the far doorway renders in portal mode.
- [x] Compare the same pose in flat mode for geometry/content completeness.
- [x] Verify no exterior doorway is admitted solely because its cell shares the root island.
- [x] Verify legitimate exterior re-entry produces a masked additional contribution.
- [x] Run the former 100,000-work-item path-growth fixture.
- [x] Run the dense `0x00D1FFFF` fixture and transition-heavy `0xEC0EFFFF` fixture.
- [x] Record any material change in work growth or maximum retained fragments.
- [x] Keep steady-state dense portal planning at or below `1 ms`.
- [x] Treat the work ceiling as corruption protection, not a tuning knob.
- [x] Remove temporary archive instrumentation after recording results.

### Acceptance Criteria

- The reported visual defect is gone at the captured pose.
- No established archive probe exceeds the existing corruption-only ceiling.
- No stencil-capacity regression is hidden by device-specific availability.
- Portal planning and execution metrics distinguish unique nodes from total submissions.
- Repeated steady-state `0x00D1FFFF` planning samples remain at or below `1 ms`.

### Decisions and Course Corrections

- The exact acceptance pose is EnvCell `0x7D640113`, canonical render position
  `[24078.5, 13.7, -19328.25]`, yaw `0`, and pitch `0`. Portal and flat captures agree at this
  pose, including the indoor shell visible through the perpendicular far doorway.
- The `0x7D64FFFF` plan admits six scope-window states and selects only reached indoor scopes
  `0x010E`, `0x0113`, `0x0119`, `0x011A`, and `0x011B`; the other nine members of the fourteen-cell
  visibility island are not selected. The executable route retains two masks:
  root-island-to-outdoor through `0x0119`, then outdoor-to-root-island through `0x011A`.
- The `0x7D64FFFF` contribution schedule has two unique nodes and three submissions: the ordinary
  root, one exterior contribution, and one additional root suffix promoted from stencil value
  `2` to `3`. This is the archive-backed proof that unique node count and submission count must
  remain separate.
- The former `0x0001FFFF` path-growth camera completed at five scope-window states, three nodes,
  two masks, and three layers, far below the unchanged 100,000-work-item corruption ceiling.
- The portal-facing `0x00D1FFFF` camera completed at 80 work items, 25 admitted scope-window
  states, five nodes, five masks, five layers, and required stencil value `4`. The
  `0xEC0EFFFF` camera completed at 650 work items, 23 admitted scope-window states, eight nodes,
  45 retained masks, one cyclic component, three layers, and required stencil value `4`.
- The archive gate exposed a material CPU/representation regression in the dense
  `0x00D1FFFF` stress view. Maximum retained fragments rose from the historical post-optimization
  node-keyed value of `16` to `416` per scope, while repeated measured planning time was roughly
  `28–33 ms` rather than the historical approximately `1 ms` continuous-frame result. Work-item
  count and selected scopes improved, so this is not path growth; it is exact partial-overlap
  accumulation inside scope-local window coverage.
- The performance gate is `1 ms` or less for steady-state portal planning at the established dense
  camera. The initial scope-local implementation failed that gate at roughly `28–33 ms`.
- Profiling attributed roughly `16.2 ms` of the original cold plan to exact projection and `3.4 ms`
  to coverage admission. The dense scope retained 416 partially overlapping fragments and caused
  26,880 convex intersection pairs.
- Exact seam deletion now recombines adjacent authored triangles only when they share a complete
  oppositely directed edge and their union remains convex. Concave apertures, holes, partial
  overlaps, and disconnected components remain separate. The resulting normalized window type is
  constructor-branded, allowing hot paths to trust the invariant instead of repeatedly rebuilding
  already-normalized windows.
- Immutable aperture identities now cache exact convex source loops before per-view projection.
  The dense view dropped from 170 homogeneous triangle clips to 28 convex polygon clips and
  retained one fragment per reached scope. After validating the per-view projection once and
  caching immutable aperture validation/decomposition, repeated final mode-cycle samples measured
  `0.4`, `0.8`, `0.6`, and `0.7 ms`.
- Cold archive probes still include lazy topology snapshot/index construction and measured about
  `13 ms` for the 4,213-cell dense topology. The `1 ms` gate is the historical steady-state
  per-frame planning contract. If first-frame publication latency becomes user-visible, topology
  snapshot/index preparation should move to the completed scene-publication boundary rather than
  being hidden outside the timing metric.
- Transition-heavy `0xEC0EFFFF` remains in its historical steady-state class at `2.5–3.8 ms`; the
  newly imposed `1 ms` remediation gate applies to the dense regression that previously matched a
  roughly `1 ms` baseline. A universal `1 ms` bound for every topology would require a separate
  planner-wide performance phase.
- The three throwaway archive-inspection binaries were removed after their findings were captured
  in this plan and replaced by deterministic synthetic coverage.

## Phase 7: Cleanup and Documentation

### Deliverables

- Remove obsolete node-coverage, unique-submission, and non-root-only suffix vocabulary.
- Update `docs/portal_rendering.md` and the app architecture audit.
- Update completed historical plan claims only where they describe a currently live contract;
  retain historical decisions as history.
- Remove temporary diagnostics and redundant tests superseded by the structural regression.

### Task Checklist

- [x] Sweep code, comments, tests, diagnostics, and UI labels for the deleted mechanism's
      vocabulary.
- [x] Document scope-local traversal versus visibility-island render ownership.
- [x] Document repeated contribution occurrences and exterior single-submission invariants.
- [x] Ensure every new field has a named planner, validator, or executor consumer.
- [x] Run formatting, TypeScript checks, focused tests, lint, Rust checks if Rust files were
      touched, and browser fixtures.
- [x] Record final decisions, concessions, and remaining debt in this plan.

### Acceptance Criteria

- Surviving documentation matches the implemented planner and executor.
- No compatibility wrapper or dormant alternate scheduling path remains.
- Linters and type checks pass without ignores.
- The worktree contains no temporary diagnostic binaries, logs, or runtime-asset tests.

### Decisions and Course Corrections

- `docs/portal_rendering.md` now separates exact scope-local traversal from visibility-island draw
  ownership and documents ordinary, exterior, deferred, and additional contribution occurrences.
- `apps/holtburger-3d/ARCHITECTURE_AUDIT.md` was refreshed from the live direct-compositing
  architecture. It now names the exact-window hot path as a load-bearing bone, records the single
  scene-domain target, and removes the stale one-node/one-submit and two-target descriptions.
- Planner diagnostics now use `admittedScopeWindowStateCount` at the owning contract; the frame
  metric, Explorer row, executor diagnostics, and fixtures use the same vocabulary.
- The planner owns every contribution classification and every exterior graph fact. The validator
  consumes component, entry, return, root-containment, suffix-role, mask, label, and layer fields;
  the executor consumes only the executable subset and does not re-derive graph policy.
- The three archive-dependent throwaway binaries were deleted. No archive-dependent test was
  committed; permanent coverage is synthetic.
- Final verification passed: 71 TypeScript test files / 394 tests, Svelte and TypeScript checks,
  ESLint, Knip, Clippy with warnings denied, production build, Prettier, `git diff --check`, and the
  substrate, internal-execution, and hybrid Chrome/WebGL fixtures. Archive probes passed for
  `0x0001FFFF`, `0x00D1FFFF`, `0xEC0EFFFF`, and the affected `0x7D64FFFF` pose.
- Remaining debt is deliberately narrow: exact admission still retains partially overlapping
  convex regions when they cannot be merged without a general polygon union. The measured archive
  matrix no longer exercises that growth, so no new boolean-geometry dependency or approximation
  is justified.

## Phase 8: Outdoor-Root Exterior Cycle Regression

An Explorer field report exposed a missing schedule shape after the original evidence pass. While
the camera still had outdoor residency near an EnvCell, the planner admitted
`outdoor -> indoor island -> outdoor`. The exterior SCC therefore contained both the outdoor root
and an indoor node. `createExteriorRenderContribution` classified every SCC with an indoor member
as suffix-bearing, then correctly rejected the resulting masked layer-zero exterior contribution
with `Portal outdoor root has masked component work.`

The suffix rule was valid for an indoor root entering an exterior SCC, but it conflated
root containment with outdoor-root ownership. For an outdoor root, ordinary layer assignment
already provides the correct schedule: render outdoor unmasked at layer zero, render reached indoor
members through forward masks at later layers, and retain indoor-to-outdoor edges only as cycle
provenance.

### Task Checklist

- [x] Reproduce the field exception with a deterministic
      `outdoor -> indoor island -> outdoor` planner test.
- [x] Keep the outdoor root unmasked and suffix-free while retaining complete SCC facts.
- [x] Submit the indoor member as ordinary layer-one masked work.
- [x] Update plan validation to consume the planner-owned outdoor-root distinction.
- [x] Prove the resulting executor operation order without weakening the layer-zero invariant.
- [x] Run the complete TypeScript suite, test typechecking, ESLint, and a production DA55 browser
      harness.
- [x] Confirm the original Explorer camera movement no longer blanks the frame.

### Decisions and Evidence

- The layer-zero invariant remains fail-fast. The fix changes contribution classification rather
  than suppressing `Portal outdoor root has masked component work.`
- Outdoor-root ownership is determined once from node identity. It produces no exterior execution
  masks or suffix, while the existing ordinary-layer contract consumes the outdoor-to-indoor
  forward edge.
- The reverse indoor-to-outdoor edge remains retained graph provenance and is not executed because
  its target was already rendered at a lower layer.
- Planner and executor regressions cover two nodes, two retained exterior-transition edges, one
  cyclic component, two render layers, one submitted mask, one exterior submission, and one indoor
  submission. Required stencil capacity is `1`; the rejected suffix shape would have required
  additional labels and work.
- The complete frontend suite passes 71 files / 396 tests. Test typechecking and ESLint pass.
- The production DA55 browser harness reports no console messages, 10 of 10 render nodes submitted,
  one exterior render, 13 submitted masks, three layers, and `0.7 ms` portal planning. This
  preserves the hard `1 ms` steady-state planning budget for the measured DA55 frame.
- The harness default camera did not reproduce the reported residency transition. The subsequent
  Explorer field check confirmed that the blank frame was resolved and exposed the independent
  transition-straddle overlay recorded in Phase 9.

## Phase 9: Transition-Straddle Reciprocal Suppression

The field verification for Phase 8 exposed a second transition defect. At an indoor/outdoor
near-plane straddle, the source-to-target crossing and its immediate reciprocal both inherited a
full-screen ray footprint. The return edge became an additional root suffix, reset depth across the
screen, and redrew EnvCell geometry over outdoor building geometry.

Retail retains the incoming portal as traversal provenance. `PView::AddToCell` marks `portal_in`,
and `PView::AddViewToPortals` skips portals with that incoming flag. Holtburger's directed segment
tracer already applies the equivalent reciprocal/shared-aperture rule, but the render planner's
scope-window work item did not retain its incoming crossing.

### Task Checklist

- [x] Reproduce the overlay at the L-building transition with archive-backed camera cell
      `0x7D640119`, position `[24080, 13.7, -19331.25]`, yaw `0`, and pitch `0`.
- [x] Capture the rejected plan's exact crossing directions and NDC windows.
- [x] Confirm retail incoming-portal suppression in the client decompile.
- [x] Carry incoming-crossing provenance on each scope-window work item.
- [x] Suppress only the immediate reciprocal or shared authored aperture.
- [x] Preserve the distinct far-door return and additional root contribution.
- [x] Add deterministic planner coverage for a straddled reciprocal pair.
- [ ] Confirm the original Explorer straddle movement no longer overlays EnvCells on buildings.

### Decisions and Evidence

- Before the fix, crossings `/72` (indoor to outdoor) and `/73` (its outdoor-to-indoor reciprocal)
  both retained the full NDC rectangle. The frame retained three masks, two near-plane seeds, one
  cyclic component, and an additional full-screen root suffix.
- After the fix, the same archive pose retains one near-plane seed and two masks. The second mask
  is the distinct far-door return, so the intended L-building re-entry remains intact.
- The corrected archive frame visually preserves the building exterior over the indoor shell,
  reports one exterior render and all planned submissions, and measures `0.4 ms` planning plus
  `0.5 ms` execution.
- The original non-straddle L-building acceptance pose still retains the distinct far-door return:
  two masks, two unique nodes, three submissions, one exterior render, `0.3 ms` planning, and
  `0.5 ms` execution.
- Immediate-return suppression occurs before attempted-work accounting. The existing reciprocal
  fixture therefore performs one fewer work item; its historical expectation was preserving the
  defective traversal rather than a required execution guarantee.
- No renderer diagnostic was added. The existing edge, near-plane seed, node, submission, and
  timing metrics distinguish the failing and corrected scenarios.

## Risks and Mitigations

| Risk                                                                                             | Mitigation                                                                                                                             |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Scope-local propagation restores combinatorial path growth.                                      | Keep monotonic exact coverage keyed by a finite structural state, measure historical dense fixtures, and reject simple-path ancestry.  |
| Clipping depth-continuous seams increases CPU work in large interiors.                           | Measure work/fragments before optimizing; retain exact admission and consider structural indexing only after correctness.              |
| Drawing only reached scopes omits shell occluders or residents needed by a shared render domain. | Preserve exact seam clipping and compare complete-shell fixtures plus flat mode; retail's reached-cell draw list is the authority.     |
| Additional root submission double-blends transparent geometry.                                   | Parent-constrain the suffix to pixels whose root content was replaced by exterior initialization and prove blending with GPU readback. |
| Executor filtering silently removes the layer-zero root.                                         | Put ordinary withholding in the planner contract and validate it independently before allocation.                                      |
| One suffix union conflates unrelated same-layer contributions.                                   | Preserve distinct planner-owned labels and retain the existing sibling-isolation tests.                                                |
| A valid deeper re-entry needs downstream expansion after scope coverage is already subsumed.     | Prove the superset-window monotonicity invariant and retain the alternating-domain regression as a permanent counterexample guard.     |
| Aggregate diagnostics lead to another incorrect geometric inference.                             | Use temporary exact edge/scope/window captures for investigation; keep durable metrics scenario-driven.                                |
| Archive evidence becomes a brittle committed dependency.                                         | Keep archive probes manual and commit deterministic synthetic equivalents only.                                                        |
| The tactical suffix fix lands without the traversal correction.                                  | Treat Phase 1 and the contribution cutover as one required definition of done; do not accept the screenshot alone as completion.       |

## Definition of Done

- [x] Only the authoritative camera scope receives the initial full-screen portal window.
- [x] Traversal coverage is scope-local and independent from visibility-island draw ownership.
- [x] Depth-continuous seams propagate clipped windows without consuming stencil masks.
- [x] The L-shaped synthetic regression admits only topology-reachable exterior transitions.
- [x] A legitimate return to the root island creates an explicit additional masked contribution.
- [x] The root remains the ordinary layer-zero contribution.
- [x] Non-root suffix nodes are withheld only by planner-authored contract.
- [x] Exterior color/depth initialization remains authoritative and exterior renders once per view.
- [x] Plan validation rejects accidental repeats, omissions, unused masks, and invalid labels.
- [x] GPU readback proves near exterior, far interior, wall isolation, depth, and blending behavior.
- [x] Existing planner, executor, substrate, near-plane, non-exact, cycle, and sibling tests pass.
- [x] Historical dense and transition-heavy archive probes remain bounded.
- [x] The affected `0x7D640113` camera pose renders correctly in Explorer portal mode.
- [x] Documentation and diagnostics use the final traversal/contribution terminology.
- [x] No temporary diagnostic artifacts or runtime-asset-dependent tests remain.
- [x] Formatting, type checks, lint, and relevant Rust checks pass.

## Open Questions

No architectural question remains open after the evidence pass. Implementation must resteer only
if a synthetic monotonicity test or archive probe produces a concrete counterexample to the
scope-keyed fixed point or the explicit contribution schedule.

The screenshot does not preserve exact camera orientation. That is not a design blocker: the
camera cell, doorway pair, crossing directions, accepted sides, and render-island cycle are proven.
Capture the exact orientation only if needed to reproduce the final manual pixel composition gate.
