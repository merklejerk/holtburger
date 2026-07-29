# Holtburger 3D Direct Portal Compositing Plan

Status: Complete
Branch: `portal-direct-composite`
Created: 2026-07-29

## Context and Boundaries

### Goal

Replace sampled exterior color/depth composition with direct, stencil-constrained rendering into
one composite target, eliminating the portal depth-copy round trip without weakening graph
correctness or redrawing the exterior.

### In Scope

- Preserve the existing pure per-view portal graph and unique render-node ownership model.
- Render the exterior directly into the composite target exactly once per independent view.
- Support outdoor-root, indoor-root, multiple-entry, near-plane-straddle, exterior-cycle, and
  mixed same-layer contribution graphs.
- Add explicit planner-owned stencil labels for exterior entry and non-root exterior suffix work.
- Add renderer primitives for masked scene initialization and parent-label-constrained mask writes.
- Remove the exterior render target, sampled scene-copy shader, and color/depth copy operation after
  the direct path is proven.
- Preserve ordinary opaque, alpha-tested, transparent, and additive material ordering.
- Measure correctness, GPU work, allocation, and frame-time effects before accepting the cutover.
- Update portal rendering documentation and diagnostics to describe direct scene-domain ownership.

### Out of Scope

- Changing authored portal topology, effective-aperture preprocessing, visibility-island proofs,
  or portal-window admission.
- Retaining a permanent sampled-copy fallback for selected graph shapes or devices.
- Moving portal policy outside `apps/holtburger-3d`.
- Changing camera residency, movement crossing, collision, or third-person camera policy.
- Changing camera near/far values, adopting reverse-Z, or changing depth formats as part of this
  cutover.
- Adding MSAA, post-processing, temporal antialiasing, or a general render graph.
- Optimizing scene selection, draw-call submission, or vertex processing.
- Modifying the legacy app or the retail client decompile.

## Ground Truth

### Pre-Cutover Contracts

- `apps/holtburger-3d/src/lib/game/renderer/portal-render-graph.ts`
  - owns unique render nodes, SCC-derived layers, the exterior component operation, and stencil
    capacity preflight;
  - already retains exterior entry masks, internal indoor suffix masks, return masks, root
    containment, and same-layer isolation.
- `apps/holtburger-3d/src/lib/game/renderer/portal-render-plan-validation.ts`
  - validates the complete planner-authored execution contract before GPU allocation.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-executor.ts`
  - mechanically executes the planner graph;
  - currently renders an exterior source target first and samples its color/depth into the
    composite target.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-substrate.ts`
  - owns the fixed two-target allocation, fixed-function stencil/depth states, depth reset, sampled
    scene copy, and presentation.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
  - resolves graph nodes to scene contributions and preserves one exterior submission per view.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-hybrid-portal-executor-fixture.ts`
  - proves both root directions, multiple windows, near-plane straddles, exterior cycles, suffix
    confinement, copied depth, and blended material ordering.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-internal-portal-executor-fixture.ts`
  - proves internal layer unions, nested contributions, depth replacement, and material passes.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-device.ts`
  - exposes browser capability and fixture probes tied to the current target contract.
- `docs/portal_rendering.md`
  - documents the accepted planner, layer-wide stencil union, two-target composition, and
    near-plane ownership behavior.

### Historical Evidence

- `apps/holtburger-3d-legacy/src/lib/renderer/webgl2/webgl2-renderer.ts`
  - demonstrates that legacy retained `DEPTH24_STENCIL8` and used framebuffer depth blits to
    bypass the sampled copy shader;
  - does not establish that sampled depth transfer is inherently unstable: the later root-cause
    audit found that the copy shader omitted an explicit precision qualifier for its sampler;
  - is historical evidence, not a design to preserve.
- `docs/plans/holtburger-3d-env-cell-e2e-integration-plan.md`
  - records why the exterior target and explicit exterior SCC operation were introduced;
  - records the archive-backed `0xEC0E010B` exterior cycle and the same-layer sibling isolation
    requirement.

### Required Archive and Browser Cases

- Outdoor-root transition with multiple indoor windows.
- Indoor-root transition with multiple exterior entry windows.
- Both directions of finite near-plane straddles.
- Non-root `indoor -> outdoor -> indoor suffix -> outdoor` SCC.
- Exterior SCC sharing a layer with an unrelated indoor contribution.
- Archive-backed transition-heavy view rooted at EnvCell `0xEC0E010B`.
- A real camera projection using the Explorer `near = 0.5`, `far = 2000` range.

## North Stars

1. Remove the depth transfer rather than masking its numeric symptoms.
2. Keep one pure planner graph mapping to one mechanical GPU execution trace.
3. Render every reached node, including outdoors, at most once per independent view.
4. Make scene-domain ownership explicit in stencil state; do not infer it from draw order.
5. Preserve pre-layer depth when constructing unrelated same-layer mask unions.
6. Use typed composite stencil-label facts for interdependent entry/suffix state.
7. Prefer one complete cutover over graph-shape fallbacks or two maintained executors.
8. Delete obsolete targets, shaders, metrics, tests, and terminology after acceptance.

## Accepted Execution Contract

The composite target becomes the sole full-size portal target.

### Root Exterior

1. Clear composite color, depth, and stencil.
2. Render exterior directly as layer zero.
3. Execute reached indoor layers using the existing layer unions and masked depth resets.
4. Present composite color.

### Non-Root Singleton Exterior

1. Construct all unrelated same-layer mask unions against pre-layer depth.
2. Construct the exterior entry union under its planner-assigned label.
3. Replace color with the view clear color and depth with `1.0` inside the exterior label.
4. Render exterior once with `stencil == exterior entry label`.
5. Execute unrelated same-layer contributions through their distinct labels.

### Non-Root Exterior SCC with Indoor Suffix

1. Construct all exterior entry and unrelated same-layer unions against pre-layer depth.
2. Initialize and render exterior under the exterior entry label.
3. Rasterize the SCC's internal indoor masks with:
   - the authored mask's existing depth policy;
   - `stencil == exterior entry label` as a parent ownership constraint; and
   - replacement with the planner-assigned suffix label on pass.
4. Reset depth, but retain exterior color, under the suffix label.
5. Render all suffix indoor nodes once under the suffix label.
6. Treat return-to-outdoor edges as consumed cycle provenance without another draw.
7. Execute unrelated same-layer contributions through their previously completed labels.

### Required Stencil Facts

Collapse interdependent exterior labels into one planner-owned composite value rather than adding
independent nullable fields:

```ts
interface PortalExteriorStencilLabels {
  readonly entry: number;
  readonly suffix: number | null;
}
```

- `entry` isolates a non-root exterior contribution from unrelated same-layer contributions.
- `suffix` exists only for a non-root exterior component with indoor suffix members.
- The planner includes both labels in capacity preflight.
- The executor validates and consumes these labels; it does not allocate scratch values.
- Final naming may change during implementation, but the composite invariant must remain explicit.

## Phased Implementation

## Phase 0: Reproduce and Baseline

### Deliverables

- Add a focused browser-harness depth-transfer sweep using the runtime perspective projection,
  real portal target formats, and production copy state.
- Add an Explorer-owned field capture for an exact rendered camera pose, residency, renderer
  metrics, and real WebGL device identity.
- Capture baseline allocation, execution, and timing facts for representative portal views.
- Record the exact camera distances and pixel/depth outcomes that reproduce flickering or banding.

### Task Checklist

- [x] Extend a portal fixture rather than creating a parallel renderer harness.
- [x] Generate depths from the runtime projection instead of using only convenient constants.
- [x] Add a versioned, clipboard-ready Explorer field capture without changing shared runtime
      contracts.
- [x] Sweep stable camera positions across the known failing distance band.
- [x] Distinguish source-depth instability, copy-depth instability, aperture-mask instability, and
      ordinary geometry z-fighting.
- [x] Run the same-pose sampled-copy/attachment-blit field A/B on the affected WebKit device.
- [x] Capture baseline active target count and bytes.
- [x] Capture exterior render count, mask draws, render-node submissions, and composite count.
- [x] Capture GPU time with `EXT_disjoint_timer_query_webgl2` when available and wall-clock frame
      timing as labeled fallback evidence.
- [x] Record the affected outdoor-root baseline; defer the full representative-shape performance
      matrix to the same-device before/after gate in Phase 4.
- [x] Keep only deterministic regression evidence; remove temporary diagnostic visualization and
      logging after the cause is proven.

### Acceptance Criteria

- The reported artifact has a deterministic fixture or harness reproduction.
- Evidence identifies whether the sampled depth-copy path is causal.
- Baseline results are recorded in this plan's Decisions and Course Corrections section.
- No production rendering behavior changes in this phase.

### Decisions and Course Corrections

- Added `webgl2-projected-depth-transfer-fixture.ts` and integrated it into the existing opt-in
  portal-substrate browser fixture. It rasterizes 2,048 logarithmically spaced depths across the
  Explorer `near = 0.5`, `far = 2000` projection, then re-rasterizes the same values with `EQUAL`
  before and after the production sampled copy. A whole-attachment depth blit provides the legacy
  control without changing production execution.
- The automated harness uses ANGLE over SwiftShader at DPR 1. Its 2026-07-29 result was:
  - source rasterization: 2,048 exact matches, 0 mismatches;
  - production sampled copy: 2,048 exact matches, 0 mismatches;
  - depth blit control: 2,048 exact matches, 0 mismatches; and
  - `DEPTH24_STENCIL8`: 24 depth bits and 8 stencil bits.
- Course correction after the first field capture: the original synthetic run incorrectly used
  `GameRuntime`'s pre-camera placeholder `far = 800`, while both the Explorer and terrain harness
  install `far = 2000`. The fixture now requires its caller's active projection range instead of
  owning duplicated pseudo-runtime constants. The earlier 800-range result remains historical
  negative evidence rather than the accepted Explorer baseline.
- The corrected `near = 0.5`, `far = 2000` SwiftShader rerun also reported 2,048 of 2,048 exact
  source, sampled-copy, and blit-control matches with no WebGL errors. This keeps the isolated
  transfer result negative on SwiftShader; it does not override the affected WebKit/Apple-GPU field
  case.
- This is negative evidence: the isolated D24 sample/`gl_FragDepth` round trip is exact on
  SwiftShader and does not reproduce the reported field artifact. SwiftShader's tolerance did not
  establish that the production shader was portable; the copy remained suspect from legacy
  hardware evidence, but it was not yet proven causal in the current renderer.
- The fixed two-target allocation is confirmed at 16 bytes per drawing-buffer pixel in aggregate:
  the 8-by-8 fixture reports 1,024 active bytes. The accepted 1280-by-720 archive capture therefore
  reports 14,745,600 bytes; the proposed one-target contract would use 7,372,800 bytes at that
  extent.
- Automated hardware timing is deliberately not recorded from SwiftShader because it would not be
  representative GPU evidence. A real-GPU reproduction and timing capture remain required.
- Added a `Copy portal repro` action to the Explorer Frame panel. Its versioned
  `holtburger.portal-repro.v1` JSON contains:
  - the exact XYZ/yaw/pitch and residency consumed by the most recently completed render;
  - the complete renderer selection snapshot, current frame settings, and unsmoothed frontend
    timing;
  - drawing-buffer size, device-pixel ratio, browser/WebView identity, and masked/unmasked WebGL
    renderer identity when the browser exposes it; and
  - an ISO capture timestamp so adjacent good/bad samples can be correlated with video.
- Field collection procedure: stop at a stable position immediately before the artifact, at its
  worst point, and immediately after it disappears; use the Frame panel action at each position
  and retain a short video of the same sweep. Clipboard failures surface in the panel rather than
  silently claiming success.
- First affected-hardware capture received for outdoor `0xda55ffff` at
  `(41923.83612680768, 124.04071669546535, -16425.573572172383)`, yaw
  `-1.2887860020678734`, pitch `-1.3640927736670714`, and a 1439-by-853 drawing buffer at DPR
  `0.899993896484375`. WebKit reported WebGL 2.0 with an unmasked `Apple GPU`, 24 active
  draw-framebuffer depth bits, and 8 stencil bits.
- The affected frame retained 3 portal layers, 17 mask edges/draws, and submitted all 10 of 10
  planned render nodes with one exterior render and one exterior composition. The screenshots show
  the open-roof interior disappearing in distance bands while this graph work remains present.
  This narrows the failure to pixel execution after planning—most plausibly aperture mask depth
  acceptance against composed exterior depth—but does not yet distinguish sampled-copy
  perturbation from ordinary coplanar aperture/depth instability.
- Matched close/far captures strengthen that classification:
  - at the fully visible close pose `(41900.61111564237, 42.92771680155347,
-16427.087351562495)`, Portal planned/submitted 2 of 2 nodes through one mask;
  - at the fully missing far pose `(41934.93699594489, 224.24934110052823,
-16422.783726063877)`, Portal planned/submitted 17 of 17 nodes through 22 submitted mask draws
    for 23 graph mask edges; and
  - changing only the far-pose renderer mode from Portal to Flat restored the missing interior
    pixels. This rules out missing content, camera frustum selection, and node submission as the
    direct cause.
- Added a temporary same-pose `Portal root transfer` selector to compare the production sampled
  copy with a whole-attachment color/depth blit for outdoor-root frames. The browser substrate
  fixture proves the control transfers root color and depth and that the blitted nearer depth
  rejects a farther aperture mask. This is causal instrumentation, not a candidate final
  architecture.
- The affected-device same-pose A/B proves the sampled copy-shader path is causal. It does not, by
  itself, prove that a correctly qualified sampled depth transfer is unstable. Both captures used
  camera position `(41933.37494013507, 193.99393505713343, -16412.60825751729)`, yaw
  `-1.0081962963731457`, pitch `-1.3259414723119698`, the same 1439-by-853 drawing buffer, and the
  same WebKit-reported `Apple GPU`. Both frames reported:
  - 16 of 16 portal nodes submitted;
  - 3 render layers, 24 mask edges, and 23 submitted mask draws;
  - 1 exterior render and 1 exterior composition;
  - 2 retained `DEPTH24_STENCIL8` scene-domain targets using 19,639,472 bytes; and
  - 17 ms frontend frame time with 10 ms attributed to portal execution.
- With `sampled-copy`, the open-roof interior was missing. Changing only
  `portalDepthTransferDiagnostic` to `attachment-blit` restored the interior. The source exterior,
  aperture geometry/depth test, planner graph, selected content, and D24S8 target format were held
  constant. Therefore:
  - source rendering and ordinary aperture depth acceptance are stable with exact transferred
    depth;
  - the production sampled copy shader produced depth values on the affected device that rejected
    aperture-mask pixels in distance bands; and
  - increasing the attachment to 32-bit depth is not required to fix this demonstrated defect,
    because the same D24 source/destination attachments succeed under an exact blit.
- Post-completion root-cause correction: a later cross-session shader audit identified the defect
  as the copy shader's missing explicit sampler precision qualifier. `precision highp float;` does
  not set sampler precision. The affected Apple/WebKit implementation exposed the omission as
  distance-dependent banding, while SwiftShader tolerated it, explaining the isolated fixture's
  negative result. Declaring `precision highp sampler2D;` or qualifying the sampler uniform itself
  fixes the removed copy path. The D24S8 attachment format and depth texture sampling were not
  intrinsically at fault. A follow-up audit confirmed that the surviving production object and
  terrain fragment shaders explicitly declare high precision for their sampler types; the current
  portal shaders declare no sampler uniforms.
- The attachment blit remains a diagnostic control, not the chosen architecture. Direct rendering
  into the composite target still removes the defective copy path while also deleting its source
  target and fullscreen copy work. Correctness no longer requires that architectural cutover, but
  its simpler ownership model, lower target memory, and eliminated full-screen transfer remain the
  accepted reasons to retain it.
- `EXT_disjoint_timer_query_webgl2` evidence was not exposed by the affected Explorer capture, so
  the labeled fallback is the same-pose 17 ms frontend frame time and 10 ms portal-execution wall
  time. This is sufficient for causality but not a performance claim.
- Course correction: the affected outdoor-root baseline is now exact and reproducible, while
  small-window, large-window, and exterior-cycle captures would only become actionable when paired
  with the new executor on the same device. Those shape baselines move to Phase 4's explicit
  before/after matrix rather than blocking the planner contract. Phase 0 is complete.

## Phase 1: Planner Contract and Capacity

### Deliverables

- Extend `PortalExteriorComponentOperation` with typed entry/suffix stencil-label ownership.
- Update capacity preflight for the complete direct-execution label set.
- Update `portal-render-plan-validation.ts` to reject inconsistent labels before allocation.
- Replace copy-specific exterior terminology in the planner where the new meaning is already
  authoritative.

### Task Checklist

- [x] Derive entry and suffix labels in the pure planner from SCC membership and layer sharing.
- [x] Require no suffix label for singleton or root-contained exterior components.
- [x] Require a distinct suffix label for non-root exterior SCCs with indoor members.
- [x] Keep unrelated same-layer labels distinct from exterior entry and suffix labels.
- [x] Include every emitted label in `requiredMaximumStencilValue`.
- [x] Reject duplicate, zero-invalid, out-of-range, or ceremonially unused labels.
- [x] Update planner tests for singleton exterior, root-contained exterior, cyclic suffix, and
      same-layer sibling cases.
- [x] Preserve deterministic plan output.

### Acceptance Criteria

- Planner tests prove every supported exterior graph shape has a complete label contract.
- A plan exceeding the available stencil range fails before any GPU work.
- The executor needs no private SCC analysis or label allocation.
- TypeScript checks and focused planner tests pass.

### Decisions and Course Corrections

- Replaced the copy-specific scalar `compositionStencilValue` with the composite
  `PortalExteriorStencilLabels { entry, suffix }` contract. The bundle is absent only when outdoors
  is the unmasked layer-zero root; this avoids inventing a label that no mask or draw consumes.
- A masked exterior reuses its render-layer label when it is the layer's only independent
  contribution. If an unrelated contribution shares that layer, the entry label is allocated
  above the maximum render layer. A non-root exterior SCC with indoor members then receives the
  next distinct suffix label.
- Root-contained does not mean unmasked: an indoor root SCC can reach outdoors through a retained
  near-plane seed at a later layer. That case consumes an entry label but intentionally has no
  suffix label because the indoor root was already rendered at layer zero.
- Validation recomputes the same structural label facts and rejects missing, duplicate, zero,
  out-of-range, or unused labels before target allocation. Capacity now includes both composite
  fields.
- Temporary concession: the existing two-target executor consumes the new suffix label while the
  substrate remains in place through Phase 2. This keeps one planner contract and a runnable branch
  without treating the detached-target executor as a permanent compatibility path.
- Verification: 72 TypeScript test files / 380 tests, TypeScript/Svelte checks, ESLint, and Knip
  pass.

## Phase 2: Direct-Execution GPU Primitives

### Deliverables

- Add one masked scene-initialization primitive that writes clear color and depth without changing
  stencil.
- Generalize aperture and NDC-window mask writes to support either:
  - unconditional label replacement; or
  - replacement constrained by equality with one parent label.
- Add complete fixed-function state commands for both operations.
- Initially retain the existing copy path only to keep this phase independently verifiable.

### Task Checklist

- [x] Represent mask stencil policy as a discriminated type rather than boolean parameters.
- [x] Preserve ordinary world-aperture `LEQUAL` and near-clip-window `ALWAYS` depth behavior.
- [x] Ensure parent-label failure retains the existing stencil value.
- [x] Ensure masked scene initialization writes the view clear color and depth `1.0` only where
      the requested label matches.
- [x] Ensure suffix depth reset retains exterior color.
- [x] Validate labels, normalized colors/depth, target ownership, and framebuffer extent.
- [x] Extend substrate unit tests for state baselines and invalid inputs.
- [x] Extend browser pixel coverage for parent-constrained aperture and NDC-window masks.

### Acceptance Criteria

- Parent-constrained masks cannot escape their exterior entry region.
- Masked initialization prevents root color from contaminating transparent exterior rendering.
- Existing ordinary portal layers remain pixel-identical.
- Focused unit, browser fixture, lint, and type checks pass.

### Decisions and Course Corrections

- Resteering required before implementation: WebGL stencil `REPLACE` writes the reference value
  configured by `stencilFunc`, and that same reference value is used by the stencil comparison.
  Therefore one mask draw cannot compare `stencil == entry` while replacing passing pixels with an
  independently chosen `suffix` label. The proposed arbitrary parent-constrained replacement
  primitive is not expressible in WebGL 2 fixed-function stencil state.
- The smallest structural correction is to allocate cyclic exterior labels as an adjacent pair
  above all ordinary render layers, then use `stencilFunc(EQUAL, entry, 0xff)` with
  `stencilOp(KEEP, KEEP, INCR)` for the internal suffix-mask union. Passing entry pixels become
  `entry + 1 == suffix`; stencil-test or depth-test failures retain their existing value. Capacity
  preflight continues to prevent overflow at 255.
- Alternatives are materially worse: bitmask ownership limits the planner to eight independent
  bits and changes all label semantics; repeated increment passes add geometry work proportional
  to label distance; retaining a detached target/copy abandons the one-target North Star.
- User approved the adjacent-label/`INCR` correction on 2026-07-29. Phase 2 resumes with the mask
  policy expressed honestly as unconditional replacement or parent-equality increment.
- Added `PortalMaskStencilPolicy` as a discriminated union: ordinary unions use unconditional
  `replace`, while exterior suffix unions use `increment-if-equal`. The latter configures
  `stencilFunc(EQUAL, entry)` plus `stencilOp(KEEP, KEEP, INCR)`, so stencil or depth failure
  retains the previous label.
- Cyclic exterior plans now reserve adjacent scratch labels above every ordinary render layer.
  Repeated/overlapping suffix masks are idempotent because a pixel already incremented to the
  suffix label no longer equals the entry label.
- Added one masked scene program and `initializeMaskedScene` primitive. It writes caller-provided
  clear color and depth under stencil equality without modifying stencil. The existing depth-reset
  path reuses the same fullscreen program with color writes disabled, avoiding a second shader.
- Browser pixel coverage proves both world-aperture and NDC-window increments remain inside the
  parent entry label, failed parent equality retains a different pre-existing label, masked
  initialization retains stencil and resets depth, and suffix depth reset retains color.
- Verification: 72 TypeScript test files / 382 tests, TypeScript/Svelte checks, ESLint, Knip, and
  the real-browser `portal-substrate` fixture pass without WebGL or console errors.

## Resteering Gate A: Dry-Run the Complete Cutover

Before changing the executor:

- Compare the proposed trace against every required graph shape.
- Confirm all same-layer unions are completed before any contribution mutates pre-layer depth.
- Confirm suffix masks are created after exterior depth exists and only inside the entry label.
- Confirm transparent backgrounds match the isolated-target result.
- Confirm near-plane windows use the same parent-label rule without a second special scheduler.
- Confirm required stencil capacity remains practical for archive-backed dense views.
- Re-evaluate whether one direct executor is still simpler than the current target/copy model.

If any graph requires executor-private topology reconstruction, a per-route target, or a permanent
copy fallback, pause for user review rather than widening the implementation.

### Decisions and Course Corrections

- Gate triggered before executor work: the original parent-equality-plus-arbitrary-replacement
  stencil trace is impossible in one WebGL draw because comparison and `REPLACE` share one
  reference value. The approved trace uses adjacent entry/suffix labels and an equality-constrained
  increment, preserving one mask draw and the one-target architecture.
- The corrected dry run covers outdoor root, masked singleton exterior, root-contained
  near-plane-seeded exterior, non-root exterior SCC, same-layer sibling, and internal-only graphs.
  Every ordinary layer union completes before color/depth mutation; suffix masks execute only
  after direct exterior depth exists; and both aperture kinds consume the same stencil policy.
- Transparent-background equivalence is structural: masked scene initialization writes the view
  clear color and depth before the exterior draw, matching the detached target's former clear
  without sampling another attachment.
- No graph shape requires executor-private SCC analysis, another target, or a copy fallback. The
  archive-backed capacity probe remains a Phase 4 acceptance item, but synthetic plans require at
  most five stencil values and remain far below the 255 ceiling.

## Phase 3: One-Target Executor Cutover

### Deliverables

- Rewrite `executePortalGraph` to render exterior contributions directly into `composite`.
- Execute non-root exterior suffixes using planner-authored entry and suffix labels.
- Allocate and reuse only the composite scene-domain target.
- Preserve one exterior draw and one submission per reached render node.

### Task Checklist

- [x] Validate the complete plan and resolve every mask before target allocation.
- [x] Clear the composite target once per independent view.
- [x] Render root exterior directly at layer zero.
- [x] Build every ordinary same-layer entry union before drawing that layer.
- [x] Initialize and render a non-root exterior under its entry label.
- [x] Build suffix masks after exterior rendering with the entry-label constraint.
- [x] Reset suffix depth without clearing exterior color.
- [x] Render suffix indoor nodes once.
- [x] Consume return-to-outdoor edges without redrawing exterior.
- [x] Preserve ordinary indoor layer execution.
- [x] Preserve state restoration after allocation, mask, reset, or contribution failures.
- [x] Update execution diagnostics to report direct exterior work honestly.

### Acceptance Criteria

- Outdoor-root, indoor-root, multiple-entry, straddle, exterior-cycle, and same-layer sibling traces
  all execute through one code path.
- Exterior renders exactly once whenever reached.
- Every reached render node submits exactly once.
- No sampled color/depth scene copy occurs.
- No graph-shape fallback retains the old exterior target path.
- Executor unit tests pass with explicit operation-order assertions.

### Decisions and Course Corrections

- `executePortalGraph` now resolves and validates every mask before allocation, allocates one target,
  clears it once, and renders every contribution directly into it. The executor contains no scene
  copy call or graph-shape fallback.
- For each non-root layer, every contribution's entry union is rasterized against pre-layer depth
  before any masked initialization or depth reset. Exterior then initializes clear color/depth,
  renders once, promotes its internal suffix masks with parent-equality `INCR`, resets only suffix
  depth, and submits suffix indoor nodes once. Return-to-outdoor edges remain validated provenance
  and produce no draw.
- `WebGL2PortalSubstrate.resize` now owns exactly one RGBA8/D24S8 target. The 8-by-8 browser fixture
  reports 512 active bytes and one target; the 16-by-16 resize reports 2,048 bytes and one target.
- Renamed `exteriorCompositeCount` / `portalCompositeCount` to
  `exteriorContributionCount` / `portalExteriorContributionCount`. The metric now reports direct
  exterior contributions rather than a copy operation that no longer exists.
- The runtime-projection sweep now verifies stable direct rasterization across `near = 0.5`,
  `far = 2000`; it no longer performs or reports sampled-copy/blit controls.
- Explicit operation-order tests cover outdoor root, internal-only layers, masked exterior,
  root-contained straddle, exterior cycle, same-layer sibling, and restoration after mask,
  initialization, reset, and contribution failures.
- Verification: 72 TypeScript test files / 386 tests, TypeScript/Svelte checks, ESLint, Knip, the
  one-target substrate browser fixture, the hybrid exterior/straddle fixture, and the internal-only
  fixture pass without WebGL or console errors.
- Temporary debt retained for Phase 5: unreachable scene-copy/blit methods and their shader,
  the now-inert Explorer transfer selector, and Phase 0 capture plumbing remain until Phase 4 field
  acceptance is complete.

## Phase 4: Browser, Archive, and Performance Acceptance

### Deliverables

- Convert hybrid browser fixtures from copied-depth assertions to direct-ownership assertions.
- Preserve all existing pixel outcomes that describe game-visible behavior.
- Run the archive-backed transition-heavy execution probe.
- Compare new performance and allocation evidence with Phase 0.

### Task Checklist

- [x] Prove exterior occluders still constrain transition masks.
- [x] Prove root color/depth remain authoritative outside entry windows.
- [x] Prove exterior color/depth become authoritative inside entry windows.
- [x] Prove nearer later geometry passes and farther geometry rejects against direct exterior depth.
- [x] Prove suffix color/depth cannot escape the exterior entry union.
- [x] Prove unrelated same-layer contributions remain isolated where masks overlap.
- [x] Prove ordinary and near-plane masks work in both transition directions.
- [x] Prove opaque, alpha-tested, transparent, and additive results retain expected order.
- [x] Prove sequential views do not retain stale target contents.
- [x] Run the projected-depth distance sweep and verify the reported flicker/banding is absent.
- [x] Execute the `0xEC0E010B` archive-backed graph without duplicated nodes or WebGL errors.
- [x] Compare target bytes, exterior GPU time, portal execution GPU time, and frame timing.

### Acceptance Criteria

- All browser-read pixel gates pass.
- The projected-depth regression passes across the recorded failing distance band.
- Active portal target count falls from two to one.
- Active target bytes fall by one `RGBA8 + DEPTH24_STENCIL8` allocation at the drawing-buffer
  extent.
- No representative view regresses portal GPU time beyond measurement noise without an explained
  tradeoff.
- Small-window indoor views demonstrate reduced exterior fragment/bandwidth cost when GPU timing is
  available.
- Archive-backed hybrid execution retains bounded mask and render-node counts.

### Decisions and Course Corrections

- Renamed the hybrid fixture's copied-depth assertions to direct depth-ordering assertions and the
  projection fixture to direct depth rasterization. The acceptance fields now describe observable
  ownership and ordering rather than the removed transfer mechanism.
- The substrate and hybrid production-WebGL browser gates pass with no console or WebGL errors.
  Their readbacks cover exterior occlusion, root/exterior ownership inside and outside apertures,
  later near/far depth ordering, suffix and same-layer confinement, ordinary and NDC-straddle
  masks in both residency directions, material-pass order, and sequential one-target reuse.
- The automated direct rasterization diagnostic recorded exact equality for all 2,048 logarithmic
  samples across the production `near = 0.5`, `far = 2000` range. It classified the absence of a
  transfer quantization step but did not replace the affected Apple-GPU field acceptance gate.
- Recovered the `0xEC0E010B` camera from authoritative archive projection instead of accepting the
  earlier guessed coordinate. Its contained shell center maps to canonical
  `[45468, 41.496002, -2752.900002]`.
- At that center the archive execution retained 8 planned/submitted nodes, 3 layers, 42 admitted
  edges, 15 actual mask draws, one exterior render/contribution, and no console/WebGL errors.
- The archive run allocated one 7,372,800-byte scene-domain target at 1280-by-720, down exactly
  50% from the historical two-target 14,745,600-byte allocation. Observed portal execution was
  1.4 ms versus the historical 1.1–1.2 ms range; the wall-clock spread is not sufficient to claim
  a speedup or regression, and this harness does not expose GPU timer queries.
- The affected Apple/WebKit D24S8 field sweep passed without visible artifacts at a representative
  far view around `(41981.3125, 160.0024, -16419.2917)`. The direct frame retained 12/12 submitted
  nodes, 3 layers, 20/20 mask edges/draws, one exterior render/contribution, one 9,819,736-byte
  target, 9 ms portal execution, and 15 ms total frame time.
- Compared with the Phase 0 affected-device capture, full-size target memory fell from 19,639,472
  bytes to 9,819,736 bytes. The representative direct frame's 9 ms portal execution / 15 ms frame
  is consistent with the earlier 10 ms / 17 ms capture, but the poses and selected scene work
  differ, so this is non-regression evidence rather than a defensible timing speedup claim.
- No GPU timer-query evidence is available from the current harness. The accepted performance
  claim is therefore limited to the exact 50% attachment-memory reduction, removal of the
  full-screen color/depth transfer, and no observed same-device frame-time regression.

## Resteering Gate B: Accept or Revert the Architecture

Review correctness, complexity, and measurements before deleting the old path.

- Accept only if the direct executor covers all graph shapes without a second scheduler.
- Reject if suffix intersection requires per-route state or topology reconstruction in WebGL.
- Reject if the depth artifact remains; return to the measured cause rather than declaring an
  architectural placebo successful.
- Review any performance regression separately for outdoor-root, small-window, large-window, and
  cycle cases.
- Lock final diagnostic naming and documentation terminology.

### Decisions and Course Corrections

- Accepted the direct one-target architecture. It covers every planned graph shape through one
  executor, the suffix intersection is expressed by planner-owned adjacent stencil labels plus a
  guarded increment rather than executor-private route state, and the affected-device artifact is
  absent.
- The stencil concession spends one extra adjacent suffix label for a non-root cyclic exterior
  component. Archive capacity validation passes, and this bounded label cost is preferable to a
  second full-size target and depth-transfer path.
- Performance acceptance is deliberately conservative: target allocation and transfer removal are
  structural wins; the available wall-clock samples prove no observed regression but do not prove
  a GPU-time speedup.
- Diagnostic naming is locked around exterior contributions and direct scene-domain ownership.
  Phase 5 will now remove the sampled-copy/blit controls rather than retain a fallback.

## Phase 5: Clean Cutover and Documentation

### Deliverables

- Remove the exterior scene-domain target and its lifecycle accounting.
- Remove `copyScene`, its shader, uniforms, validation, fixture cases, and copy-specific types.
- Collapse plural target ownership types into the one-target shape or remove the wrapper entirely.
- Remove superseded exterior-composite diagnostics and UI labels.
- Update `docs/portal_rendering.md` and relevant architecture comments.

### Task Checklist

- [x] Delete the scene-copy shader and program allocation/disposal.
- [x] Delete exterior texture/framebuffer allocation and resize/disposal branches.
- [x] Delete tests that only preserve sampled-copy architecture.
- [x] Delete the temporary Explorer `Copy portal repro` action, capture payload/types, clipboard
      plumbing, and capture-only tests after the field case and final comparison are recorded.
- [x] Delete the temporary portal root-transfer selector, `FrameSettings` diagnostic field,
      substrate attachment-blit branch, and blit-control fixture assertion after causality is
      recorded.
- [x] Rename target, operation, and diagnostic symbols to describe direct ownership.
- [x] Update device capability probes for the one-target contract.
- [x] Update target count and memory diagnostics.
- [x] Update comments that claim exterior color/depth are copied.
- [x] Update the permanent portal rendering document with direct entry/suffix stencil semantics.
- [x] Search for stale `copy`, `composite`, `exterior target`, and `two-target` terminology.
- [x] Run the formatter rather than hand-formatting touched files.

### Acceptance Criteria

- No production portal code samples a depth texture or writes copied `gl_FragDepth`.
- No exterior framebuffer, texture, or copy program remains.
- Portal mode lazily allocates exactly one full-size color/depth-stencil target.
- Documentation and diagnostics match the implemented direct execution.
- Dead-code lint reports no vestigial copy architecture.

### Decisions and Course Corrections

- Deleted the temporary `PortalDepthTransferDiagnostic` from `FrameSettings` and every runtime,
  harness, Explorer, and test consumer. There is no device- or graph-selectable fallback.
- Deleted `copyScene`, `copyRootScene`, the masked-copy pass state, the sampled color/depth shader,
  the attachment-blit control, and their program lifecycle. The substrate now owns only the
  direct mask/initialization programs and one scene-domain target.
- Deleted the `holtburger.portal-repro.v1` capture module, capture-only tests, clipboard plumbing,
  Frame-panel action, and World-panel transfer selector after recording the affected-device field
  acceptance.
- Deleted the temporary projected-depth rasterization diagnostic after recording its Phase 4
  result. Repeating the same fragment-computed depth under `EQUAL` was useful during causality
  work but would be hollow permanent coverage; production browser fixtures instead retain actual
  portal near/far ordering checks.
- Collapsed the portal target capability probe from a two-framebuffer sampled-depth experiment to
  the permanent one-target question: RGBA8/D24S8 framebuffer completeness, depth/stencil bits, and
  maximum texture extent. This also removes the diagnostic depth-sampling shader.
- Retained `gl_FragDepth` only where direct masked initialization/reset and fixture-generated
  projection depths require it. No portal production shader samples a depth texture or emits a
  copied depth value.
- Updated `docs/portal_rendering.md` to document one direct-owned target, pre-depth-mutation
  same-layer mask unions, adjacent exterior entry/suffix labels, guarded parent-equality
  increment, masked initialization, and exactly-once exterior/suffix submission.
- Stale-term review found no remaining portal copy/blit/two-target terminology. Terrain
  `composition` symbols were intentionally retained because they describe AC terrain pcode
  texture composition and are unrelated to portal assembly.
- TypeScript/Svelte checks, 33 focused tests, and the substrate, hybrid, and internal
  production-WebGL browser fixtures pass after cleanup with no console or WebGL errors.

## Phase 6: Final Verification

### Task Checklist

- [x] Run focused planner, validator, executor, substrate, renderer, and fixture tests.
- [x] Run `npm run test:ts` from `apps/holtburger-3d`.
- [x] Run `npm run check` from `apps/holtburger-3d`.
- [x] Run `npm run lint` from `apps/holtburger-3d` with warnings treated as errors.
- [x] Run `npm run format:check` from `apps/holtburger-3d`.
- [x] Run `npm run build` from `apps/holtburger-3d`.
- [x] Run the browser harness portal fixtures.
- [x] Run the archive-backed `0xEC0E010B` execution probe.
- [x] Re-run the Phase 0 affected-device field sweep with the same browser, extent, DPR, and
      content; record the representative-camera concession.
- [x] Review the final diff for unrelated changes, stale diagnostics, and obsolete tests.
- [x] Update this plan with landed decisions, measurements, concessions, and remaining debt.

### Acceptance Criteria

- All required commands and browser/archive gates pass.
- No clippy, ESLint, TypeScript, Svelte, Knip, or formatting warnings remain.
- The final diff contains no sampled-copy fallback or unrelated edits.
- The plan records reproducible before/after correctness and performance evidence.

### Decisions and Course Corrections

- Final focused portal verification passed 3 files / 43 tests; the complete frontend suite passed
  71 files / 383 tests after deleting the temporary three-test capture suite.
- `npm run check`, `npm run lint` (ESLint, Knip, and Clippy with warnings denied),
  `npm run format:check`, and `npm run build` all pass on the final source.
- The final substrate, hybrid, and internal production-WebGL fixtures pass. The substrate harness
  now consumes the capability probe and requires one complete RGBA8/D24S8 target with 24 depth
  bits and 8 stencil bits rather than publishing unconsumed diagnostic provenance.
- The final archive run at canonical `[45468, 41.496002, -2752.900002]` retained 8/8
  planned/submitted nodes, 3 layers, 42 admitted edges, 15 mask draws, one exterior
  render/contribution, one 7,372,800-byte target, no browser/WebGL errors, and 1.2 ms observed
  execution.
- The affected-device follow-up preserved Apple/WebKit, drawing-buffer extent, DPR, D24S8 format,
  landblock, and a sweep through the failing distance range, but its captured representative pose
  differed from the exact Phase 0 frame. It is accepted as artifact-removal and frame-time
  non-regression evidence; no same-pose speedup claim is made.
- Final source and documentation searches find no portal sampled-copy/blit fallback, copy shader,
  second target, temporary selector/capture, or stale composite metric. The final diff is confined
  to portal planning/execution, its diagnostics/fixtures/harness, and the two requested portal
  documents. Existing `ACE`, `ACViewer`, and `.worktrees/` worktree state is unrelated and was
  left untouched.
- No in-scope implementation debt remains. Reverse-Z, alternate depth formats, GPU timer-query
  instrumentation, and broader scene submission optimization remain explicitly separate future
  work rather than concessions hidden in this cutover.

## Risks and Mitigations

| Risk                                                             | Mitigation                                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Internal suffix masks escape the exterior entry region.          | Require parent-label equality during suffix mask replacement and prove confinement with overlapping pixel fixtures. |
| Same-layer sibling masks observe mutated depth.                  | Complete all outer same-layer unions before rendering any contribution.                                             |
| Suffix and sibling labels collide.                               | Assign all interdependent labels in the planner and preflight their combined capacity.                              |
| Transparent exterior blends over root interior color.            | Mask-clear both color and depth before direct non-root exterior rendering.                                          |
| Transparent suffix loses the exterior background.                | Reset suffix depth only; retain direct exterior color beneath the suffix.                                           |
| Near-plane window masks bypass parent ownership.                 | Give NDC-window and world-aperture writes the same explicit stencil policy.                                         |
| Direct rendering becomes a second executor beside the copy path. | Permit coexistence only until Resteering Gate B, then accept one path or revert.                                    |
| The diagnosed sampler-precision defect masks another issue.      | Retain the Phase 0 sweep as a post-cutover gate and record any independent residual artifact.                       |
| Conventional depth precision remains weak at long range.         | Keep reverse-Z and depth-format work out of scope; record any independent residual issue.                           |
| Stencil capacity grows unexpectedly on dense graphs.             | Include all direct labels in pure planner preflight and run archive-backed dense cases before cutover.              |
| Performance gains are hidden by CPU or vertex bottlenecks.       | Measure GPU portal work by view shape and report fragment/bandwidth wins separately from total frame time.          |
| Browser timer queries are unavailable or disjoint.               | Label wall-clock measurements as fallback evidence and never compare mixed measurement methods.                     |
| Context loss or resize leaks the surviving target.               | Preserve transactional resize/disposal tests and device-owned restart policy.                                       |

## Definition of Done

- [x] The exterior copy-shader artifact has a documented deterministic reproduction and root cause.
- [x] Exterior rendering occurs directly in the portal target for every supported graph shape.
- [x] Exactly one portal scene-domain target is allocated per renderer extent.
- [x] Exterior and every indoor render node submit at most once per independent view.
- [x] Exterior suffix masks are constrained by their entry ownership and cannot leak.
- [x] Same-layer unrelated contributions retain pre-layer mask correctness and independent labels.
- [x] Both near-plane transition directions retain exact screen-space ownership.
- [x] Opaque, alpha-tested, transparent, and additive fixture outcomes remain correct.
- [x] The recorded distance sweep contains no portal flicker or depth banding.
- [x] The transition-heavy archive probe passes without duplicated contributions or WebGL errors.
- [x] Target-memory reduction and before/after timing evidence are recorded.
- [x] Copy shaders, exterior targets, fallback paths, stale metrics, and obsolete tests are removed.
- [x] Permanent portal documentation describes the direct one-target strategy.
- [x] All frontend tests, checks, lint, formatting, build, browser gates, and relevant Rust checks
      pass.

## Resolved Questions

1. Resolved in Phase 0: outdoor `0xda55ffff`, including the exact same-pose A/B at
   `(41933.37494013507, 193.99393505713343, -16412.60825751729)`, proves the affected WebKit/Apple
   GPU copy-shader failure and attachment-blit control. A later shader audit identified the
   missing explicit sampler precision qualifier as the root cause; sampling and D24S8 are not
   inherently defective.
2. Resolved in Phase 4: the harness exposes wall-clock execution time but no GPU timer queries.
   Acceptance therefore requires no observed same-device regression and records structural memory
   and transfer-work reductions without inventing a percentage threshold.
3. Resolved in Phase 3: `portalCompositeCount` became
   `portalExteriorContributionCount`, preserving useful exactly-once diagnostics without naming a
   deleted copy operation.
