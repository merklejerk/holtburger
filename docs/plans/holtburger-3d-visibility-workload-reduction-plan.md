# Holtburger 3D Visibility Workload Reduction Plan

Status: planned; implementation has not started.
Created: 2026-08-03
Related investigation: `docs/plans/holtburger-3d-portal-frame-cpu-investigation.md`

## Context and Boundaries

### Goal

Reduce frame work before preparation and submission by recursively pruning negligible portal
subtrees, removing subpixel generated-scenery instances, and sampling offscreen visual animation at
a lower cadence without weakening semantic animation progression.

### Starting State

- Portal traversal already carries an exact inherited `PortalViewWindow` through every crossing,
  but projected-footprint rejection is restricted to non-near-plane outdoor-to-indoor exterior
  transitions.
- The accepted DA55 `16px²` entrance cutoff removes one transition, two portal nodes, two mask
  edges, and 31 static draws. Indoor-to-indoor, same-domain, and indoor-to-outdoor crossings remain
  unconditionally traversed after exact projection.
- Generated scenery is partitioned into tightly bounded scene fragments and compatible immutable
  instance streams. Once a fragment passes scene-frustum culling, every instance in its selected
  stream is copied into renderer-owned frame storage before grouped submission.
- The representative DA55 frame selects 1,327 generated fragments containing 3,174 instances.
  Existing fragment bounds reduce broad-phase work but do not reject individually subpixel
  instances inside selected fragments.
- Dynamic roots use animation-wide conservative bounds swept across every authored frame. Culling
  therefore does not depend on the current sampled pose.
- `AnimationSystem.update()` currently advances semantic state and samples every active pose at
  render cadence. `DynamicEntitySystem.publishPresentation()` then publishes every sample before
  renderer visibility selection. The representative workload samples and publishes 171 animated
  entities while only 20 contribute to the frame.

### In Scope

- Generalize the existing exact projected-area cutoff to recursive portal traversal.
- Preserve a zero-threshold exact baseline and select production thresholds from matched outdoor,
  indoor, and hybrid workloads.
- Cull generated opaque and alpha-tested instances by conservative physical-pixel footprint before
  frame-instance compaction and upload.
- Compute generated culling envelopes once in the static geometry preparation contract.
- Separate exact animation semantic advancement from visual pose/effect sampling.
- Use renderer-authored dynamic visibility feedback to schedule visible and offscreen presentation
  cadence across all active views.
- Add harness controls, temporary attribution, permanent workload diagnostics, representative
  screenshots, and motion checks required to select each production policy.
- Remove every temporary probe, threshold cycle, and measurement-only harness path at the
  resteering gate that consumes it; temporary instrumentation may not cross an implementation
  commit boundary.
- Land each optimization as an independently measurable cutover with a resteering gate before the
  next one.

### Out of Scope

- Rebaking EnvCell shells into smaller spatial draw units.
- Portal distance limits, traversal hop limits, approximate viewport grids, or replacing exact
  portal windows with bounding rectangles.
- Hardware occlusion queries, Hi-Z occlusion, GPU-driven culling, indirect drawing, or compute
  compaction.
- Screen-size culling for explicit objects, buildings, EnvCell residents, dynamics, transparent
  generated instances, or additive generated instances in the first cutover.
- Skipping, coalescing, or reordering animation semantic steps and hooks.
- Changing animation-wide conservative bounds to pose-dependent bounds.
- Scissor optimization, dynamic resolution, portal-target resolution scaling, or renderer-wide
  temporal caches.
- New long-lived browser fixtures or camera-specific application code whose only consumer is a
  profiling run. Prefer existing parameterized harness controls and documented commands.
- Modifying ACE, ACViewer, or the retail client decompile.

## Ground Truth

### Portal Traversal

- `apps/holtburger-3d/src/lib/game/renderer/portal-render-graph.ts`
  - owns scope-local fixed-point traversal, exact projected-window admission, render-domain
    discovery, and the current outdoor-transition footprint predicate;
  - applies the current cutoff after exact projection and before target-scope selection.
- `apps/holtburger-3d/src/lib/game/renderer/portal-view-window.ts`
  - owns homogeneous clipping, exact multipart NDC windows, intersection, normalization, coverage
    admission, and NDC fragment area.
- `apps/holtburger-3d/src/lib/game/renderer/portal-near-plane.ts`
  - owns the near-plane-straddle proof whose crossings remain exempt from footprint rejection.
- `docs/plans/holtburger-3d-scope-local-portal-traversal-plan.md`
  - establishes that traversal coverage belongs to exact scopes while visibility islands own draw
    scheduling.
- `docs/plans/holtburger-3d-portal-frame-cpu-investigation.md`
  - records the accepted outdoor-transition threshold matrix, target profiles, diagnostics, and
    residual workload.

### Generated Scenery

- `apps/holtburger-3d/src/lib/game/commit/static-object-geometry-worker.ts`
  - forms generated spatial fragments, compatible instance cohorts, shared partition geometry,
    immutable instance streams, and transparent frame templates.
- `apps/holtburger-3d/src/lib/game/commit/artifacts.ts`
  - owns renderer-neutral static draw units, instance-stream identities, object bounds, and
    generated-fragment contracts.
- `apps/holtburger-3d/src/lib/game/systems/static-resources.ts`
  - owns immutable `ObjectInstanceData` and `StaticInstanceStreamData` payloads.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
  - resolves visible generated fragments, forms compatible instance runs, copies selected
    instances into frame storage, and records selected/submitted instance facts.
- `docs/plans/holtburger-3d-generated-objects-layer-plan.md`
  - establishes generated-layer ownership, instancing eligibility, transparency ordering,
    installation-scoped streams, and independent scene lifecycle.

### Animation and Dynamic Visibility

- `apps/holtburger-3d/src/lib/game/animation/prepared-dynamic-animation.ts`
  - precomputes animation-wide local bounds by sweeping every authored part pose and expanding
    unbounded root rotation to a rotation-invariant envelope.
- `apps/holtburger-3d/src/lib/game/systems/animation-system.ts`
  - owns playback clocks, exact 30 Hz semantic traversal, departed-frame hooks, discontinuity
    behavior, and render-cadence visual sampling.
- `apps/holtburger-3d/src/lib/game/systems/effect-system.ts`
  - separates exact semantic effect advancement from fractional visual presentation sampling.
- `apps/holtburger-3d/src/lib/game/systems/dynamic-entity-system.ts`
  - publishes sampled part transforms and render states while retaining animation-wide root bounds.
- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
  - currently samples and publishes all animations before invoking renderer selection.
- `apps/holtburger-3d/src/lib/game/scene/scene-graph.ts`
  - culls dynamic roots through their precomputed conservative bounds.
- `docs/plans/holtburger-3d-static-authored-animation-runtime-plan.md`
  - records retail-derived semantic traversal, smooth visual interpolation, conservative bounds,
    and hook guarantees that cadence reduction must preserve.
- `acclient-eor-source/acclient.c`
  - `CSequence::update_internal`, `CSequence::execute_hooks`, and
    `CPhysicsObj::animate_static_object` remain the authoritative client-behavior references.

### Measurement Surfaces

- `apps/holtburger-3d/scripts/browser-harness.mjs`
- `apps/holtburger-3d/src/harness/browser/BrowserHarnessApp.svelte`
- `apps/holtburger-3d/src/explorer/ExplorerFramePanel.svelte`
- `apps/holtburger-3d/src/explorer/explorer-frame-diagnostic-report.ts`

## North Stars

1. Remove work before object preparation, instance upload, and draw submission.
2. Keep semantic animation time and hook execution exact; reduce only visual sampling work.
3. Compute each culling envelope once at the worker or planner boundary that owns its source facts.
4. Express fidelity policy in physical pixels and record the effective policy with every profile.
5. Preserve exact zero-threshold/full-cadence modes as diagnostic baselines, not parallel legacy
   architectures.
6. Reuse existing scope traversal, generated compaction, and animation ownership instead of adding
   competing schedulers.
7. Measure candidate elimination and net frame cost; a culling pass that costs more than it removes
   is rejected.
8. Promote the smallest threshold or lowest cadence that produces material savings without visible
   instability.
9. Keep each optimization independently revertible and attributable.
10. End every phase with zero temporary instrumentation debt; the final cleanup phase audits this
    invariant rather than postponing cleanup until the end.

## Benchmark Matrix

Every phase records camera, drawing-buffer extent, device scale, scene interest, filtering,
renderer identity, frame settings, and settled work counts.

| Workload                                            | Purpose                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| DA55 Explorer outdoor focus                         | Existing portal and generated-scenery baseline                          |
| Representative indoor-root camera                   | Recursive interior traversal, doorway approach, and near-plane behavior |
| Hybrid indoor/exterior camera                       | Indoor-to-outdoor rejection and exterior subtree preservation           |
| DC58 generated-heavy outdoor focus                  | Generated-instance elimination and compaction payoff                    |
| DA55 with camera turned away from authored dynamics | Offscreen animation cadence and publication reduction                   |
| DA55 with animated entities entering view           | First-visible-frame and recently-visible behavior                       |

SwiftShader provides deterministic regression evidence. Apple/WebKit target captures decide whether
a policy improves the intended client. Threshold comparisons must run inside one settled process
where practical so content, atlas state, camera, and viewport remain identical.

## Phase 0: Freeze Baselines and Add Temporary Attribution

### Task Checklist

- [ ] Commit or otherwise isolate the accepted outdoor-transition cutoff before changing its
      vocabulary or behavior.
- [ ] Express the indoor-root and hybrid cameras through existing harness controls; add only the
      missing parameterized placement control required for reproducibility, not a camera-specific
      fixture.
- [ ] Capture the benchmark matrix with every optimization explicitly disabled.
- [ ] Add temporary portal crossing-class counts and projected-area distributions sufficient to
      distinguish outdoor-to-indoor, indoor-to-indoor, same-domain, and indoor-to-outdoor pruning.
- [ ] Add temporary generated-instance footprint buckets after scene-fragment selection but before
      compaction.
- [ ] Add temporary animation counts for semantically advanced, visually sampled, published,
      visible, recently visible, and offscreen entities.
- [ ] Measure instrumentation overhead and remove any probe that materially perturbs its target.

### Acceptance Criteria

- All benchmark cameras and policies are reproducible without manual interaction.
- Baseline metrics agree with the current Explorer diagnostic report and known DA55 workload.
- Every temporary counter answers a named threshold or scheduling decision.
- Phase 0 probes remain uncommitted measurement scaffolding and are removed by the first
  resteering gate that consumes them.
- No visibility, culling, animation, or submission behavior changes in this phase.

### Decisions and Course Corrections

- To be completed during execution.

## Phase 1: Generalize Footprint Rejection Across Portal Traversal

### Design

Replace outdoor-transition-specific vocabulary with one recursive portal-footprint policy. After
each crossing is projected and intersected with its inherited window, reject a non-near-plane
crossing whose final physical-pixel area is strictly below the configured threshold. Apply the
decision before target-scope selection for cross-domain and same-domain traversal alike.

The policy must not special-case indoor topology, exterior exits, render layers, or traversal depth.
The exact inherited window already contains those facts. Alternate routes remain independent
crossings and can admit the same target through a larger window.

### Task Checklist

- [ ] Rename `minimumOutdoorTransitionPixelArea`, its default constant, planner policy, diagnostics,
      UI label, harness flag, tests, and documentation to generic portal-footprint vocabulary in one
      clean cutover.
- [ ] Replace `#rejectsOutdoorTransitionFootprint()` with a predicate that depends only on the
      non-near-plane state, final inherited window area, and configured threshold.
- [ ] Preserve zero-threshold graph identity and strict-less-than equality behavior.
- [ ] Preserve the near-plane exemption for every crossing class.
- [ ] Prove same-domain pruning omits the target scope and descendants without manufacturing a mask
      edge or splitting its render domain.
- [ ] Prove small indoor exits can omit exterior work while larger alternate exits still admit it.
- [ ] Add dense-cycle, L-shaped re-entry, reciprocal, near-plane, indoor-root, and hybrid regression
      coverage.
- [ ] Sweep candidate thresholds across the complete benchmark matrix. Use one universal threshold
      unless evidence demonstrates a concrete crossing class that requires a distinct value.
- [ ] Update the portable diagnostic schema once for the vocabulary and setting change.
- [ ] Remove temporary crossing-class distributions after selecting or rejecting the policy.

### Acceptance Criteria

- Threshold zero reproduces the complete current graph, selected scopes, edges, layers, and
  contributions for every existing planner fixture.
- A rejected crossing performs no target-scope selection, coverage admission, render-node work,
  scene query, contribution preparation, instance upload, or draw submission through that route.
- Near-plane crossings are never footprint-rejected.
- Alternate larger routes preserve target reachability regardless of smaller rejected routes.
- Selected production thresholds pass static and moving-camera checks on outdoor, indoor-root, and
  hybrid target workloads.
- The accepted policy produces a material reduction in portal nodes, scopes, draws, or frame cost;
  otherwise the generic cutoff remains disabled.

### Decisions and Course Corrections

- To be completed during execution.

## Phase 2: Portal Resteering Gate

- [ ] Compare rejected crossing classes, eliminated descendants, planner cost, contribution cost,
      submission work, screenshots, and motion behavior.
- [ ] Decide whether recursive rejection ships with one threshold, class-specific thresholds, or
      disabled. Do not retain unused policy fields.
- [ ] Re-run the remaining generated and animation phases against the new settled workload.
- [ ] Update both this plan and the portal CPU investigation with the accepted evidence.
- [ ] Remove every portal distribution probe, measurement-only cycle, and unused harness control;
      retain only selected production settings, their explicit single-value overrides, and tests
      protecting lasting behavior.
- [ ] Commit the portal phase independently before beginning generated-instance work.

## Phase 3: Establish a Generated-Instance Cull Contract

### Design Gate

The renderer must not reconstruct culling bounds from device geometry or repeat the same footprint
test for every material partition sharing one instance stream. First prove whether every generated
instance stream has one homogeneous source-local culling envelope:

- if yes, add one envelope to the immutable stream contract and reuse one selected-instance result
  across all referencing draw units;
- if no, colocate one compact culling envelope with each `ObjectInstanceData` entry and preserve its
  one-to-one relationship through worker transfer, installation, selection, and compaction.

The worker computes the envelope from resolved source geometry, setup-part transforms, and scale.
The renderer consumes it without re-deriving asset facts.

### Task Checklist

- [ ] Audit cohort formation for heterogeneous geometry, setup transforms, scale, and shared
      material partitions; record the chosen stream-level or per-instance envelope shape.
- [ ] Add the minimum renderer-neutral envelope data to worker output, transfer validation,
      artifacts, and static instance resources.
- [ ] Implement a small pure projection helper that conservatively classifies an envelope as
      near-plane/visible, below threshold, or outside the view.
- [ ] Keep near-plane or numerically ambiguous instances; screen-size policy must only remove
      proven-small visible instances.
- [ ] Add output-to-target filtering with reusable scratch storage so the culling pass does not
      replace GPU work with per-frame allocation churn.
- [ ] Compute selected instance indices once per immutable stream and reuse them for every
      compatible material partition.
- [ ] Restrict the first cutover to generated opaque and alpha-tested instances.
- [ ] Keep zero-threshold behavior byte-for-byte equivalent at frame-instance upload boundaries.

### Acceptance Criteria

- Every culling envelope has one named producer and one frame-time consumer.
- Shared instance streams are filtered once per view, not once per draw unit.
- Near-plane, large, and threshold-equal instances are retained.
- Buildings, explicit objects, EnvCell residents, dynamics, transparent generated instances, and
  additive generated instances do not enter the new path.
- Focused worker-transfer, projection, compaction, multi-material, and sequential-view tests pass.

### Decisions and Course Corrections

- To be completed during execution.

## Phase 4: Select and Promote Generated Screen-Size Policy

### Task Checklist

- [ ] Expose a harness-only minimum generated-instance pixel-footprint override with zero disabled.
- [ ] Sweep conservative candidate thresholds on DA55 and DC58 without changing scene radius or
      fragment culling.
- [ ] Record tested, retained, rejected, uploaded, and submitted generated instance counts plus
      culling CPU, compaction CPU, upload bytes, draw counts, frame CPU, and GPU timing where
      supported.
- [ ] Capture static and moving-camera comparisons for thin, alpha-tested, silhouette-heavy, and
      repeated scenery.
- [ ] Promote the smallest threshold with material net savings and no unacceptable sparkle or pop.
- [ ] If no candidate pays for its CPU test, remove the culling contract and temporary diagnostics
      rather than retaining a dormant abstraction.
- [ ] Record the effective policy in frame settings and the versioned diagnostic report.

### Acceptance Criteria

- The selected-instance count and uploaded instance bytes decrease together.
- Generated draw compatibility, first-seen grouping, material behavior, fog, transparency ordering,
  and sequential-view frame ranges remain correct.
- The culling pass produces a positive net frame result on at least one target workload and does not
  materially regress the other representative workload.
- No permanent metric survives without a scenario that differs from existing selected/submitted
  counts.

### Decisions and Course Corrections

- To be completed during execution.

## Phase 5: Generated Resteering Gate

- [ ] Compare net CPU/GPU benefit, rejected-instance distribution, upload reduction, image behavior,
      and camera-motion stability.
- [ ] Decide whether transparent or additive generated instances justify a later extension; do not
      widen this plan without evidence.
- [ ] Rebaseline animation measurements after generated work settles.
- [ ] Remove all rejected envelope shapes, threshold variants, probes, and harness cycles.
- [ ] Commit the generated phase independently before animation scheduling changes.

## Phase 6: Split Animation Semantics from Visual Sampling

### Design

Replace `AnimationSystem.update()` with explicit semantic advancement and selected visual sampling.
Every active record advances its clock, departed frames, hooks, persistent omega, translucency
ramps, and discontinuity policy exactly as today. Only `sampleAnimationPose()` and
`EffectSystem.samplePresentation()` become cadence-controlled.

Initial owner staging still produces a complete pose before publication. Skipped visual samples do
not mutate the last published presentation; the next sample evaluates the current clock and effect
state directly rather than replaying missed visual interpolation.

### Task Checklist

- [ ] Introduce explicit `advance(timeSeconds)` and `sample(nodeIds)` operations with types that make
      semantic progression impossible to skip accidentally.
- [ ] Preserve install/stage atomicity and mandatory initial samples.
- [ ] Preserve 30 Hz departed-frame traversal, authored hook order, cyclic seams, two-second
      discontinuity behavior, omega integration, and translucency completion.
- [ ] Make duplicate or unknown sample requests fail loudly.
- [ ] Change `DynamicEntitySystem.publishPresentation()` to accept sparse current samples while
      retaining exact entity ownership validation.
- [ ] Add deterministic tests proving full-cadence and sparse-cadence runs reach identical semantic
      state and produce the same pose/effect presentation when sampled at the same final time.

### Acceptance Criteria

- Semantic step and hook observations are identical between full and sparse visual cadence.
- Sampling an entity after an arbitrary offscreen interval matches a full-cadence sample at that
  exact time within existing numeric tolerances.
- Initial publication never exposes an entity without a valid pose.
- No renderer or visibility policy enters `AnimationSystem`; it consumes only explicit node IDs.

### Decisions and Course Corrections

- To be completed during execution.

## Phase 7: Schedule Visible and Offscreen Presentation Cadence

### Design Gate

The renderer owns the actual portal/frustum visibility decision. Publish typed frame visibility
feedback containing the union of selected dynamic root IDs across all views; do not repurpose
diagnostic counters as control input.

Dry-run two scheduling shapes before choosing the cutover:

1. Previous-frame visibility plus a recently-visible grace window. This preserves the current
   renderer API shape but permits one first-visible frame to use an offscreen-cadence pose.
2. Split renderer selection from execution so the current frame's selected dynamics are sampled
   before contribution preparation. Select this only if target motion proves the bounded stale
   first-visible frame unacceptable; do not introduce a general render graph as collateral damage.

### Task Checklist

- [ ] Add typed renderer frame feedback for selected dynamic root IDs, unioned across views and
      independent from optional profiling diagnostics.
- [ ] Add one runtime-owned visual cadence scheduler tracking last sampled and recently visible
      times by authoritative dynamic node identity.
- [ ] Sample visible/recently-visible entities every rendered frame and offscreen entities at an
      explicit harness-controlled interval.
- [ ] Clean scheduler state immediately when an entity owner is replaced, evicted, or destroyed.
- [ ] Preserve full-cadence mode as the zero/disabled baseline.
- [ ] Exercise camera cuts, portal transitions, visibility flapping, multiple views, owner
      replacement, long frame gaps, and context loss.
- [ ] Sweep offscreen intervals on DA55 and the larger DC58 authored-animation workload.
- [ ] Measure semantic advancement, visual sampling, publication, renderer selection, total frame
      CPU, and first-visible pose age.
- [ ] Select previous-frame feedback or split selection/execution from motion evidence, then delete
      the rejected path.
- [ ] Promote a production interval only if animation sampling/publication savings remain material
      after scheduler overhead.
- [ ] Remove visibility/cadence distributions, measurement cycles, and rejected scheduler controls
      before the animation implementation commit.

### Acceptance Criteria

- All active animations advance semantics every frame call regardless of visual cadence.
- Visible and recently-visible entities sample at render cadence.
- Offscreen sampled/published counts decrease with the accepted policy.
- An entity returning to view presents a current pose within the accepted first-visible-frame
  contract and exhibits no sustained slow animation, clock reset, or missed visual state.
- Multi-view feedback samples the union once; no entity is sampled twice per frame.
- Owner replacement and eviction leave no stale cadence state.

### Decisions and Course Corrections

- To be completed during execution.

## Phase 8: Cleanup, Cross-Feature Verification, and Closeout

### Task Checklist

- [ ] Audit that each earlier resteering gate already removed its temporary distributions, cadence
      probes, screenshot cycles, rejected policy fields, compatibility aliases, and dead
      vocabulary; treat any survivor as a failed phase boundary.
- [ ] Ensure every surviving setting and metric has one named consumer and a scenario distinct from
      existing fields.
- [ ] Re-run formatting, Svelte/TypeScript checks, ESLint, dead-code analysis, Rust clippy, and the
      full TypeScript suite.
- [ ] Re-run portal planner/executor fixtures, generated worker/compaction tests, animation/effect
      tests, lifecycle tests, and the canonical browser harness matrix.
- [ ] Capture final SwiftShader and Apple/WebKit profiles with effective policies embedded in the
      diagnostic report.
- [ ] Update architecture documentation and historical plans with accepted decisions, rejected
      alternatives, measured benefit, and remaining debt.
- [ ] Commit portal, generated, animation, and documentation cleanup as reviewable independent
      milestones.

### Acceptance Criteria

- Each accepted optimization independently reduces its owned workload and remains individually
  attributable in the final evidence.
- Portal visibility, near-plane ownership, alternate routes, generated material behavior,
  animation semantics, hooks, lifecycle, and multi-view behavior pass their complete regressions.
- No temporary instrumentation or rejected architecture remains.
- The final report distinguishes CPU culling cost, work eliminated, submission reduction, driver
  time, and GPU time where supported.

### Decisions and Course Corrections

- To be completed during execution.

## Risks and Mitigations

| Risk                                                                                  | Mitigation                                                                                                                                                               |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Recursive portal pruning hides a large domain behind a small but perceptible doorway. | Select thresholds across indoor, outdoor, and hybrid motion workloads; keep near-plane crossings exempt and prefer one smallest universal threshold.                     |
| Same-domain pruning breaks L-shaped traversal or re-entry.                            | Apply the decision to scope-local work items before selection and retain alternate-route, cycle, and suffix regressions.                                                 |
| Generated footprint tests cost more CPU than the instances they remove.               | Filter only selected generated streams, compute bounds once, reuse decisions across partitions, measure culling separately, and delete the path if net cost is negative. |
| Thin alpha-tested scenery sparkles or disappears too early.                           | Use conservative envelopes, retain threshold equality, begin with small physical-pixel candidates, and require motion captures.                                          |
| Shared streams contain heterogeneous culling bounds.                                  | Prove stream homogeneity before choosing the contract; use colocated per-instance envelopes if the invariant is false.                                                   |
| Sparse visual sampling skips hooks or persistent effects.                             | Split semantic advancement from sampling structurally and compare semantic observations under full and sparse cadence.                                                   |
| Newly visible dynamics show a stale pose for one frame.                               | Measure pose age and motion; use recent-visibility grace or split current-frame selection from execution only if the simple feedback contract fails.                     |
| Visibility feedback becomes a renderer diagnostic dependency.                         | Return typed control feedback from the renderer independently of optional diagnostics and profiling.                                                                     |
| Multi-view rendering samples or publishes entities repeatedly.                        | Union authoritative node IDs at the renderer boundary and sample each selected entity once.                                                                              |
| Threshold and cadence controls accumulate into permanent debug policy.                | Keep candidates uncommitted or harness-owned, promote only selected single-value overrides, and remove every temporary cycle at its owning resteering gate.              |

## Definition of Done

- [ ] Recursive portal footprint rejection is either accepted with measured thresholds or removed.
- [ ] Generated screen-size culling is either accepted with positive net benefit or removed.
- [ ] Offscreen visual cadence reduction is either accepted with exact semantic behavior or removed.
- [ ] Each accepted policy is explicit, typed, validated, recorded in diagnostics, and disabled by a
      precise baseline value.
- [ ] Outdoor, indoor-root, hybrid, generated-heavy, offscreen-animation, and visibility-entry
      workloads have matched evidence.
- [ ] Near-plane portals, same-domain traversal, alternate routes, generated material behavior,
      semantic animation steps, hooks, initial poses, owner replacement, and multi-view behavior are
      covered.
- [ ] Type checking, formatting of touched files, lint, dead-code analysis, Rust clippy, the full
      TypeScript suite, and browser harness verification pass.
- [ ] Temporary instrumentation, rejected paths, stale vocabulary, and unused metrics are removed.
- [ ] No measurement-only browser fixture or camera-specific application path survives; retained
      fixtures protect an executable correctness guarantee.
- [ ] Final decisions, concessions, thresholds, intervals, target profiles, and remaining questions
      are recorded in this plan.

## Open Questions

1. Does the indoor/hybrid matrix support one universal recursive portal threshold, or does a
   concrete crossing class require a separate value?
2. Are generated instance-stream cohorts homogeneous enough for one source-local culling envelope,
   or must bounds remain one-to-one with instance records?
3. Does previous-frame visibility plus a grace window meet the first-visible-frame quality bar, or
   must renderer selection be split from execution?
4. What generated pixel threshold and offscreen presentation interval produce positive target
   benefit without visible motion instability?
