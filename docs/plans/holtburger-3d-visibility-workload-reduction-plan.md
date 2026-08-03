# Holtburger 3D Visibility Workload Reduction Plan

Status: active; Phases 0-7 complete with `64px²` portal/generated cutoffs and a `100ms`
offscreen animation interval accepted.
Created: 2026-08-03
Related investigation: `docs/plans/holtburger-3d-portal-frame-cpu-investigation.md`

## Context and Boundaries

### Goal

Reduce frame work before preparation and submission by recursively pruning negligible portal
subtrees, rejecting negligible independently drawable object presentations, removing subpixel
generated-scenery instances, and sampling offscreen visual animation at a lower cadence without
weakening semantic animation progression.

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
- Generalize the accepted generated-instance cutoff into one object-footprint fidelity policy while
  retaining specialized per-instance and per-presentation-root selection algorithms.
- Cull independently drawable building, explicit-object, EnvCell-resident, and anchored authored
  dynamic roots from their current published presentation bounds after coarse scene selection and
  before contribution expansion.
- Preserve the scene graph's one conservative spatial-bounds concept; current presentation bounds
  remain renderer-facing state and never churn spatial membership.
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
- Footprint culling of terrain, EnvCell shells, generated transparent/additive instance streams, or
  any container whose bound does not describe one independently optional presentation unit.
- Skipping, coalescing, or reordering animation semantic steps and hooks.
- Replacing animation-wide scene bounds with pose-dependent bounds or updating scene spatial
  membership at animation cadence.
- Applying anchored-authored dynamic bounds policy to future runtime actors before authoritative
  root motion and replaceable appearance/clip envelope ownership are defined.
- Scissor optimization, dynamic resolution, portal-target resolution scaling, or renderer-wide
  temporal caches.
- New long-lived browser fixtures or camera-specific application code whose only consumer is a
  profiling run. Prefer existing parameterized harness controls and documented commands.
- Modifying ACE, ACViewer, or the retail client decompile.

## Ground Truth

### Portal Traversal

- `apps/holtburger-3d/src/lib/game/renderer/portal-render-graph.ts`
  - owns scope-local fixed-point traversal, exact projected-window admission, render-domain
    discovery, and the original entry-only footprint predicate;
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
  - records the original entry-only threshold matrix, target profiles, diagnostics, and
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

### Object Presentation Footprints

- `apps/holtburger-3d/src/lib/game/scene/scene-graph.ts`
  - owns the single conservative local-bounds contract used for spatial indexing, scope queries,
    and broad-phase frustum selection; it must not acquire a second presentation-bounds concept.
- `apps/holtburger-3d/src/lib/game/renderer/render-world.ts`
  - currently identifies a selected node and eagerly expands dynamic contributions through
    `DynamicEntitySystem.getVisibleContributions()`; Phase 8 must split lightweight presentation
    identity/bounds lookup from retained contribution expansion.
- `apps/holtburger-3d/src/lib/game/systems/dynamic-entity-system.ts`
  - owns the last published articulated pose, effect root rotation, part transforms, render states,
    and authored scale, making it the owner of a bound for the presentation that will actually draw.
- `apps/holtburger-3d/src/lib/game/systems/object-visual-template-repository.ts`
  - prepares each rigid part's geometry-local bounds with its default scale and draw units; the
    active dynamic-part contract currently drops the local bound during installation.
- `apps/holtburger-3d/src/lib/game/commit/artifacts.ts`
  - carries each immutable static object's root-local bound into scene publication. Because the
    presentation never changes, the existing scene-node bound is also its exact presentation bound
    and must be reused rather than duplicated.
- `apps/holtburger-3d/src/lib/game/renderer/generated-instance-selection.ts`
  - owns the accepted conservative physical-pixel AABB projection semantics for generated
    instances, including zero-disabled behavior and near-plane retention; Phase 8 should extract or
    reuse the projection primitive without forcing all object classes through instance-stream code.

### Measurement Surfaces

- `apps/holtburger-3d/scripts/browser-harness.mjs`
- `apps/holtburger-3d/src/harness/browser/BrowserHarnessApp.svelte`
- `apps/holtburger-3d/src/explorer/ExplorerFramePanel.svelte`
- `apps/holtburger-3d/src/explorer/explorer-frame-diagnostic-report.ts`

## North Stars

1. Remove work before object preparation, instance upload, and draw submission.
2. Keep semantic animation time and hook execution exact; reduce only visual sampling work.
3. Compute each culling envelope once at the worker, planner, or presentation-publication boundary
   that owns every source fact it requires.
4. Express fidelity policy in physical pixels and record the effective policy with every profile.
5. Preserve exact zero-threshold/full-cadence modes as diagnostic baselines, not parallel legacy
   architectures.
6. Keep scene bounds conservative and stable; presentation fidelity belongs after broad-phase
   selection and before contribution expansion.
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
| Explicit-object/building-heavy outdoor views        | Independently drawable static-root footprint elimination                |
| Indoor view with resident objects                   | EnvCell scope admission followed by per-resident footprint filtering    |
| DA55 with camera turned away from authored dynamics | Offscreen animation cadence and publication reduction                   |
| DA55 with animated entities entering view           | Dynamic published-footprint and first-visible-frame behavior            |

SwiftShader provides deterministic regression evidence. Apple/WebKit target captures decide whether
a policy improves the intended client. Threshold comparisons must run inside one settled process
where practical so content, atlas state, camera, and viewport remain identical.

## Phase 0: Freeze Baselines and Add Temporary Attribution

### Task Checklist

- [x] Commit or otherwise isolate the accepted entry-only cutoff before changing its
      vocabulary or behavior.
- [x] Express the indoor-root and hybrid cameras through existing harness controls; add only the
      missing parameterized placement control required for reproducibility, not a camera-specific
      fixture.
- [x] Capture the benchmark matrix with every optimization explicitly disabled.
- [x] Add temporary portal crossing-class counts and projected-area distributions sufficient to
      distinguish outdoor-to-indoor, indoor-to-indoor, same-domain, and indoor-to-outdoor pruning.
- [x] Add temporary generated-instance footprint buckets after scene-fragment selection but before
      compaction.
- [x] Add temporary animation counts for semantically advanced, visually sampled, published,
      visible, and offscreen entities.
- [x] Measure instrumentation overhead and remove any probe that materially perturbs its target.

### Acceptance Criteria

- All benchmark cameras and policies are reproducible without manual interaction.
- Baseline metrics agree with the current Explorer diagnostic report and known DA55 workload.
- Every temporary counter answers a named threshold or scheduling decision.
- Phase 0 probes remain uncommitted measurement scaffolding and are removed by the first
  resteering gate that consumes them.
- No visibility, culling, animation, or submission behavior changes in this phase.

### Decisions and Course Corrections

- The accepted entry-only cutoff and this plan were isolated as commits `921ba1a8` and
  `4e01b23d` before Phase 0 measurement began. The pre-existing `ACE`, `ACViewer`, and app-local
  `AGENTS.md` worktree changes were excluded.
- Existing EnvCell position and orientation controls were sufficient for indoor and hybrid roots.
  The harness did not, however, report the applied EnvCell camera and could not preserve an exact
  outdoor position while changing orientation. The durable harness contract now reports EnvCell
  residency, accepts a generic explicit outdoor position, and optionally applies a second settled
  orientation. No camera-specific fixture was added.
- Archive projection established the indoor camera without guessing: EnvCell `0x7d64010e` has
  render-bounds center `[24089.25, 13.6, -19337.75]`. At yaw `180`, the zero-cutoff plan reaches six
  same-domain scopes through five projected windows, emits one render node and no mask or exterior
  contribution, and submits 72 static draws. The established hybrid camera remains EnvCell
  `0x7d640113`, position `[24078.5, 13.7, -19328.25]`, yaw/pitch `0`; it emits two nodes, two masks,
  one exterior render, 349 static draws, and 1,748 generated instance-fragment occurrences.
- Every measurement explicitly set `--minimum-portal-footprint-pixel-area 0`; generated
  footprint rejection and visual animation cadence do not yet exist, so their baseline modes are
  structurally exact/full cadence.

#### Reproducible Phase 0 Cameras

All commands run from `apps/holtburger-3d`. Shared quality flags are physical viewport `690x852`,
device scale `1`, anisotropic 2x filtering, portal frame mode, and a zero portal-footprint cutoff.

| Workload                 | Parameterized camera                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| DA55 Explorer outdoor    | `--landblock 0xda55ffff --explorer-focus`                                                                                           |
| Indoor root              | `--landblock 0x7d64ffff --env-cell-camera 0x7d64010e --env-cell-position 24089.25,13.6,-19337.75 --camera-yaw 180 --camera-pitch 0` |
| Hybrid                   | `--landblock 0x7d64ffff --env-cell-camera 0x7d640113 --env-cell-position 24078.5,13.7,-19328.25 --camera-yaw 0 --camera-pitch 0`    |
| DC58 generated-heavy     | `--landblock 0xdc58ffff --explorer-focus`                                                                                           |
| DA55 offscreen animation | `--landblock 0xda55ffff --camera-position 42000,68,-16368 --camera-yaw -45 --camera-pitch 45`                                       |
| DA55 visibility entry    | The preceding placement plus `--camera-end-yaw -45 --camera-end-pitch -35.264389682754654`                                          |

The DA55 heavy baseline used radii `8/2/2/2` for buildings, EnvCells, explicit objects, and generated
scenery. The indoor and hybrid runs used radius one for all four populations. DC58 used building and
generated radii one with EnvCell and explicit radii zero. The matched animation transition used
radius two for all populations so both orientations shared one settled resident set.

#### Disabled-Policy Baseline

The probe-free DA55 heavy capture preserved the known accepted workload: 11 portal nodes, 16 mask
edges, 98 visible entries, 887 static draws, 779 generated fragments containing 3,174 instance
occurrences, 425 compacted generated draws, 20 visible dynamic entities/80 parts, and 171 active
animation playbacks. SwiftShader renderer CPU measured `5.056ms` mean and `6.6ms` p95 over 54
profiled frames. The Explorer report and harness therefore agree on the workload shape; the smaller
physical viewport is measurement context, not a canonical policy input beyond pixel thresholds.

#### Temporary Portal Attribution

The temporary probe bucketed final inherited-window area after successful projection and before
footprint rejection. Buckets are exclusive physical-pixel areas `<1`, `1-4`, `4-16`, `16-64`, and
`>=64`. No measured crossing straddled the near plane.

| Camera / crossing class                      |  <1 | 1-4 | 4-16 | 16-64 | >=64 |
| -------------------------------------------- | --: | --: | ---: | ----: | ---: |
| DA55 outdoor / indoor-to-indoor cross-domain |   0 |   2 |    0 |     0 |    1 |
| DA55 outdoor / outdoor-to-indoor             |   0 |   0 |    1 |     1 |   11 |
| DA55 outdoor / same-domain                   |   1 |   0 |    2 |    10 |    9 |
| Indoor root / same-domain                    |   0 |   0 |    0 |     0 |    5 |
| Hybrid / indoor-to-outdoor                   |   0 |   0 |    0 |     0 |    1 |
| Hybrid / outdoor-to-indoor                   |   0 |   0 |    0 |     0 |    1 |
| Hybrid / same-domain                         |   0 |   0 |    0 |     0 |    3 |

This supports Phase 1: DA55 contains small recursive same-domain and indoor cross-domain work, while
the hybrid acceptance pose keeps every transition above 64 pixels squared. It does not select a
threshold; moving-camera gates still own that decision.

#### Temporary Generated Attribution

The generated probe ran after scene-fragment selection and before compaction. It projected each
instance occurrence with the complete source-geometry AABB. That envelope is intentionally
conservative and can overstate a sub-draw's footprint; it is evidence for building the worker-owned
envelope in Phase 3, not the final culling algorithm.

| Workload              |    <1 | 1-4 | 4-16 | 16-64 |  >=64 | Total |
| --------------------- | ----: | --: | ---: | ----: | ----: | ----: |
| DA55 Explorer outdoor | 2,028 | 200 |  165 |   185 |   596 | 3,174 |
| DC58 generated-heavy  |   990 | 252 |  316 |   255 |   542 | 2,355 |
| Hybrid                |   151 |   1 |   27 |   151 | 1,418 | 1,748 |

DA55 has 2,393 occurrences (`75.4%`) below 16 pixels squared and DC58 has 1,558 (`66.2%`). Even the
conservative envelope exposes a large candidate cohort, so Phase 3 remains justified.

#### Animation Attribution and Transition

Existing animation/runtime/frame diagnostics already answer the baseline ownership questions, so
no duplicate temporary animation metric was added. In the matched one-process DA55 transition:

- the settled sky-facing state had 171 active playbacks, 171 visually sampled/published
  presentations, zero visible dynamic entities, and therefore 171 offscreen presentations;
- after the parameterized orientation change, the same resident set retained 171 active and 171
  sampled/published presentations while 42 entities/228 parts became visible, leaving 129 offscreen
  presentations; and
- semantic fixed-step counts and hook observations continued across both states with no
  discontinuity.

No recency or grace-window axis was added. Phase 7 uses the renderer's previous completed frame as
the only visibility feedback and measures the bounded first-visible-frame staleness directly.

#### Probe Overhead and Cleanup

The temporary portal histogram plus generated AABB projection raised the matched DA55 heavy profile
from `5.056ms` mean / `6.6ms` p95 to `5.961ms` mean / `8.4ms` p95 over 54 frames: approximately
`0.906ms` (`17.9%`) mean overhead. This materially perturbed the target. All temporary fields,
geometry bounds, projection loops, planner buckets, executor plumbing, and frame metrics were
removed immediately after capture. Only the parameterized camera/reporting controls and this
evidence remain.

## Phase 1: Generalize Footprint Rejection Across Portal Traversal

### Design

Replace entry-only vocabulary with one recursive portal-footprint policy. After
each crossing is projected and intersected with its inherited window, reject a non-near-plane
crossing whose final physical-pixel area is strictly below the configured threshold. Apply the
decision before target-scope selection for cross-domain and same-domain traversal alike.

The policy must not special-case indoor topology, exterior exits, render layers, or traversal depth.
The exact inherited window already contains those facts. Alternate routes remain independent
crossings and can admit the same target through a larger window.

### Task Checklist

- [x] Rename the entry-only setting, default constant, planner policy, diagnostics,
      UI label, harness flag, tests, and documentation to generic portal-footprint vocabulary in one
      clean cutover.
- [x] Collapse `#rejectsPortalFootprint()` to a predicate that depends only on the
      non-near-plane state, final inherited window area, and configured threshold.
- [x] Preserve zero-threshold graph identity and strict-less-than equality behavior.
- [x] Preserve the near-plane exemption for every crossing class.
- [x] Prove same-domain pruning omits the target scope and descendants without manufacturing a mask
      edge or splitting its render domain.
- [x] Prove small indoor exits can omit exterior work while larger alternate exits still admit it.
- [x] Add dense-cycle, L-shaped re-entry, reciprocal, near-plane, indoor-root, and hybrid regression
      coverage.
- [x] Sweep candidate thresholds across the complete benchmark matrix. Use one universal threshold
      unless evidence demonstrates a concrete crossing class that requires a distinct value.
- [x] Update the portable diagnostic schema once for the vocabulary and setting change.
- [x] Remove temporary crossing-class distributions after selecting or rejecting the policy.

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

- The clean cutover uses `minimumPortalFootprintPixelArea`, `PortalFootprintPolicy`,
  `rejectedPortalFootprintCount`, and `--minimum-portal-footprint-pixel-area`. No compatibility
  aliases preserve the deleted entry-only policy vocabulary.
- The Explorer frame diagnostic schema advances from version `2` to `3` because both the effective
  setting and rejection metric changed names in the exported JSON contract.
- The rejection predicate now consumes only the near-plane classification and final inherited
  window. Same-domain and cross-domain crossings therefore share one decision before target-scope
  selection; renderer-domain classification remains downstream and unchanged.
- Focused coverage proves strict threshold equality, near-plane retention, same-domain descendant
  omission, indoor-exit exterior omission, and larger alternate-route admission. The existing
  dense-cycle, L-shaped re-entry, reciprocal, exact-oracle, internal executor, and hybrid executor
  fixtures all continue to pass at the zero-threshold identity baseline.
- DA55 threshold sweeps compared `0`, `4`, `16`, and `64px²`. The generic `16px²` policy rejected
  four crossings, reduced portal nodes from 11 to 8 and static draws from 887 to 816, and reduced
  mean profiled renderer CPU from `4.994ms` to `4.416ms` (`11.6%`) over matched 3-second captures.
  `4px²` removed three crossings but showed no net timing reduction in its short sample. `64px²`
  removed nine crossings and 117 static draws but measured `4.382ms`, effectively equal to
  `16px²` on SwiftShader.
- The `16px²` indoor-root and hybrid acceptance cameras rejected zero crossings. DC58 with EnvCell
  radius zero retained its single outdoor node and rejected zero crossings. A parameterized DA55
  sky-to-scene camera transition completed without errors; its final graph fell from 16 to 12 nodes
  and from 1,154 to 1,068 static draws. Matched captures were visually indistinguishable under
  inspection with normalized pixel RMSE `0.00393`.
- Target-native Explorer use at `16px²` was anecdotally faster and showed no portal pop, disappearing
  content, or flicker. Target-native motion at `64px²` exposed only very-far-distance portal pop,
  which the user accepted as the intended fidelity/performance trade. The larger cutoff is therefore
  the selected universal production default; the explicit override remains for diagnostics, not as
  a parallel production policy.

## Phase 2: Portal Resteering Gate

- [x] Compare rejected crossing classes, eliminated descendants, planner cost, contribution cost,
      submission work, screenshots, and motion behavior.
- [x] Decide whether recursive rejection ships with one threshold, class-specific thresholds, or
      disabled. Do not retain unused policy fields.
- [x] Re-run the remaining generated and animation phases against the new settled workload.
- [x] Update both this plan and the portal CPU investigation with the accepted evidence.
- [x] Remove every portal distribution probe, measurement-only cycle, and unused harness control;
      retain only selected production settings, their explicit single-value overrides, and tests
      protecting lasting behavior.
- [x] Commit the portal phase independently before beginning generated-instance work.

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

- [x] Audit cohort formation for heterogeneous geometry, setup transforms, scale, and shared
      material partitions; record the chosen stream-level or per-instance envelope shape.
- [x] Add the minimum renderer-neutral envelope data to worker output, transfer validation,
      artifacts, and static instance resources.
- [x] Implement a small pure projection helper that conservatively classifies an envelope as
      near-plane/visible, below threshold, or outside the view.
- [x] Keep near-plane or numerically ambiguous instances; screen-size policy must only remove
      proven-small visible instances.
- [x] Add output-to-target filtering with reusable scratch storage so the culling pass does not
      replace GPU work with per-frame allocation churn.
- [x] Compute selected instance indices once per immutable stream and reuse them for every
      compatible material partition.
- [x] Restrict the first cutover to generated opaque and alpha-tested instances.
- [x] Keep zero-threshold behavior byte-for-byte equivalent at frame-instance upload boundaries.

### Acceptance Criteria

- Every culling envelope has one named producer and one frame-time consumer.
- Shared instance streams are filtered once per view, not once per draw unit.
- Near-plane, large, and threshold-equal instances are retained.
- Buildings, explicit objects, EnvCell residents, dynamics, transparent generated instances, and
  additive generated instances do not enter the new path.
- Focused worker-transfer, projection, compaction, multi-material, and sequential-view tests pass.

### Decisions and Course Corrections

- Cohort formation proves a homogeneous stream-level envelope: partition identity includes source
  geometry identity, material/order contract, and exact triangle membership. Every stream member
  therefore shares one union of its source partitions. Per-instance setup transforms, authored
  scale, and placement remain flattened into the existing `sourceToLandblock` matrix, so duplicating
  an envelope beside every instance would add bytes without adding information.
- The static geometry worker is the sole envelope producer. It unions the already-resolved source
  partition positions before transfer; the renderer never queries or reconstructs device geometry.
- `GeneratedInstanceSelector` owns reusable per-view index arrays and caches by immutable stream.
  Repeated material partitions reuse the same result, while reuse across different landblock render
  frames fails loudly because the projected result would not be equivalent.
- Projection is conservative: near-plane intersections and non-finite intermediates are retained;
  threshold equality is retained; only proven-small visible or proven-outside envelopes are omitted.
- Phase 3 left `minimumGeneratedInstancePixelArea` at zero. This bypassed classification and
  preserved the complete ordered upload population while establishing the lasting contract. The
  DA55 browser smoke retained identical initial/final generated counts (`10,199`) and upload bytes
  (`961,120`) with no browser console errors. Phase 4 then owned harness controls and threshold
  selection.

## Phase 4: Select and Promote Generated Screen-Size Policy

### Task Checklist

- [x] Expose a harness-only minimum generated-instance pixel-footprint override with zero disabled.
- [x] Sweep conservative candidate thresholds on DA55 and DC58 without changing scene radius or
      fragment culling.
- [x] Record tested, retained, rejected, uploaded, and submitted generated instance counts plus
      culling CPU, compaction CPU, upload bytes, draw counts, frame CPU, and GPU timing where
      supported.
- [x] Capture static and moving-camera comparisons for thin, alpha-tested, silhouette-heavy, and
      repeated scenery.
- [x] Promote the smallest threshold with material net savings and no unacceptable sparkle or pop.
- [x] If no candidate pays for its CPU test, remove the culling contract and temporary diagnostics
      rather than retaining a dormant abstraction.
- [x] Record the effective policy in frame settings and the versioned diagnostic report.

### Acceptance Criteria

- The selected-instance count and uploaded instance bytes decrease together.
- Generated draw compatibility, first-seen grouping, material behavior, fog, transparency ordering,
  and sequential-view frame ranges remain correct.
- The culling pass produces a positive net frame result on at least one target workload and does not
  materially regress the other representative workload.
- No permanent metric survives without a scenario that differs from existing selected/submitted
  counts.

### Decisions and Course Corrections

- Accepted `4px²` as the generated opaque/alpha-test product cutoff. Zero remains the explicit
  disabled baseline through the harness override. All matched runs used a `1280×720` physical
  viewport, building radius 8, generated/explicit/EnvCell radius 2, and the same relative camera
  placement and orientation in each landblock.
- DA55 results were: disabled `8,333` submitted generated instances, `795,040` upload bytes, and
  `925` generated draws; `1px²` retained `2,990/3,860` unique candidates and produced `6,216`
  submissions, `625,680` bytes, and `784` draws; `4px²` retained `2,469/3,860` and produced `4,725`
  submissions, `506,400` bytes, and `723` draws. Mean profiled frame CPU moved from `203.94ms` to
  `190.33ms` and `179.94ms`, respectively, while culling itself cost `0.95-1.20ms`.
- DC58 results were: disabled `9,334` submissions, `924,000` bytes, and `706` draws; `1px²`
  retained `2,884/4,034` and produced `6,749` submissions, `717,200` bytes, and `650` draws;
  `4px²` retained `2,134/4,034` and produced `4,894` submissions, `568,800` bytes, and `591` draws.
  Mean profiled frame CPU was `8.71ms`, `9.32ms`, and `9.08ms`. The `0.36ms` `4px²` regression is
  accepted as a small SwiftShader CPU-side concession against 47% unique-instance rejection, 38%
  lower upload bytes, 16% fewer generated draws, and 32% fewer submitted static triangles.
- GPU timestamp queries were unsupported in the harness. Submission-phase attribution also moved
  between phase labels on DA55, so the decision uses aggregate frame CPU and exact workload counts
  rather than overstating phase-local timing precision.
- Static DA55 and DC58 screenshots exercised repeated trees/shrubs, thin and alpha-tested foliage,
  and distant silhouettes at disabled, `1px²`, and `4px²`. No objectionable loss was visible at
  `4px²`. A DC58 camera rotation from `-45°` to `-35°` recomputed stable per-view populations with
  no browser errors or stale frame ranges.
- Added unique tested/retained/rejected metrics because shared material partitions make each differ
  from existing partition-expanded selected/submitted counts. Added an opt-in culling CPU phase and
  surfaced it beside compaction/upload. The diagnostic report schema advances from version 3 to 4
  because frame settings and renderer diagnostics gained lasting fields.
- After reviewing the differing portal and object semantics, the product default was deliberately
  raised from `4px²` to `64px²` and accepted after direct Explorer evaluation. The default DA55
  smoke retained `1,625/3,860` stream-unique candidates, produced `2,935` partition-expanded
  submissions and `549` generated draws, and reduced frame uploads to `363,200` bytes without
  browser errors. The earlier `4px²` measurements remain recorded as the conservative comparison.

## Phase 5: Generated Resteering Gate

- [x] Compare net CPU/GPU benefit, rejected-instance distribution, upload reduction, image behavior,
      and camera-motion stability.
- [x] Decide whether transparent or additive generated instances justify a later extension; do not
      widen this plan without evidence.
- [x] Rebaseline animation measurements after generated work settles.
- [x] Remove all rejected envelope shapes, threshold variants, probes, and harness cycles.
- [x] Commit the generated phase independently before animation scheduling changes.

### Decisions and Course Corrections

- The accepted generated implementation remains limited to opaque and alpha-tested instance
  streams. Transparent candidates already enter ordering-sensitive frame runs, and the measured
  workloads contained no additive submissions. Neither path has evidence sufficient to justify
  widening the culling contract.
- The single-value harness override remains as a durable reproducibility control; rejected sweep
  cycles, alternative envelope shapes, and temporary distributions do not remain in runtime or UI
  code.
- With the settled `64px²` product default, DA55 retained `1,625/3,860` unique generated instances,
  submitted `2,935` partition-expanded instances in `549` draws, and uploaded `363,200` bytes.
  DC58 retained `771/4,034`, submitted `1,641` in `374` draws, and uploaded `308,560` bytes.
- The post-generated animation baseline still samples every active playback. DA55 had `171` active
  playbacks versus `61` visible dynamic roots, with roughly `0.5ms` combined animation advancement
  and sampling plus `0.3ms` publication. DC58 had `472` active versus `210` visible, with roughly
  `1.0ms` combined animation work plus `0.7ms` publication. GPU timestamps remain unsupported in
  the browser harness, so Phase 7 must judge cadence scheduling from exact workload counts and
  aggregate CPU rather than invented GPU precision.
- Generated culling was committed independently as `a4ce669b` before the animation contract
  changed.

## Phase 6: Split Animation Semantics from Visual Sampling

### Design

Replace `AnimationSystem.update()` with explicit semantic advancement and selected visual sampling.
Every active record advances its clock, departed frames, hooks, persistent omega, translucency
ramps, and discontinuity policy exactly as today. Only `sampleAnimationPose()` and
`EffectSystem.samplePresentation()` become cadence-controlled.

Initial owner staging still produces a complete pose before publication. Skipped visual samples do
not mutate the last published presentation; the next sample evaluates the current clock and effect
state directly rather than replaying missed visual interpolation.

The current conservative animation-wide bounds belong specifically to anchored
`AuthoredDynamicSource` residents: their authored scene root remains fixed while one known default
clip moves visual parts beneath it. Do not silently promote that into the contract for future
runtime-authored actors. Before such actors reuse this path, define authoritative root-motion
ownership and a replaceable conservative envelope for the current appearance/clip. Runtime
locomotion moves the authoritative root; presentation-only root translation stays in the local clip
envelope. Never union every possible runtime animation into one lifetime AABB.

### Task Checklist

- [x] Introduce explicit `advance(timeSeconds)` and `sample(frame, nodeIds)` operations with types
      that make semantic progression impossible to skip accidentally.
- [x] Preserve install/stage atomicity and mandatory initial samples.
- [x] Preserve 30 Hz departed-frame traversal, authored hook order, cyclic seams, two-second
      discontinuity behavior, omega integration, and translucency completion.
- [x] Make duplicate or unknown sample requests fail loudly.
- [x] Change `DynamicEntitySystem.publishPresentation()` to accept sparse current samples while
      retaining exact entity ownership validation.
- [x] Keep the existing swept-bound policy explicitly scoped to anchored authored dynamics; do not
      introduce a speculative runtime-actor fallback or generic lifetime-bound contract.
- [x] Add deterministic tests proving full-cadence and sparse-cadence runs reach identical semantic
      state and produce the same pose/effect presentation when sampled at the same final time.

### Acceptance Criteria

- Semantic step and hook observations are identical between full and sparse visual cadence.
- Sampling an entity after an arbitrary offscreen interval matches a full-cadence sample at that
  exact time within existing numeric tolerances.
- Initial publication never exposes an entity without a valid pose.
- No renderer or visibility policy enters `AnimationSystem`; it consumes only explicit node IDs.

### Decisions and Course Corrections

- `advance(timeSeconds)` returns an opaque, frozen frame token containing the active node IDs.
  `sample(frame, nodeIds)` accepts only the latest token, so presentation cannot be sampled against
  playback state that has not reached that frame. Owner mutations invalidate the token.
- Sampling accepts a sparse selection but rejects duplicate and unknown animation nodes.
  `DynamicEntitySystem.publishPresentation()` independently preflights duplicate and unknown
  entity ownership before applying any sample; unsampled entities retain their last published
  presentation.
- Initial install and staged-owner paths still sample complete presentations directly before scene
  publication. The cadence seam does not weaken the atomic initial-pose guarantee.
- Advancement and visual sampling now have separate duration diagnostics, and sampled presentation
  count is distinct from semantic step count and publication count. The Explorer exposes the three
  advance/sample/publish durations without adding a scheduling policy or temporary fixture.
- Full-cadence and sparse-cadence deterministic tests produce identical hook observations, pose,
  omega-derived root rotation, and translucency at the same final time. Stale frame tokens,
  duplicate requests, unknown animation nodes, duplicate publications, and unknown dynamic owners
  fail loudly.
- The runtime intentionally continues to sample and publish every active node. DA55 browser
  verification reported `171` advanced/sampled/published with `61` visible; DC58 reported
  `472` advanced/sampled/published with `210` visible. Both completed without console errors or
  discontinuities. This preserves a behavior-identical baseline for Phase 7.
- Conservative swept bounds remain constructed from `AuthoredDynamicSource` during authored
  preparation. No runtime-authored actor type, root-motion fallback, or generic lifetime envelope
  was introduced.

## Phase 7: Schedule Visible and Offscreen Presentation Cadence

### Design Gate

The renderer owns the actual portal/frustum visibility decision. Publish typed frame visibility
feedback containing the union of selected dynamic root IDs across all views; do not repurpose
diagnostic counters as control input.

Use one binary scheduling decision: roots selected in the previous completed frame sample at render
cadence; every other active root samples at the configured offscreen interval. This permits one
first-visible frame to use an offscreen-cadence pose. Measure that bounded staleness directly. Split
renderer selection from execution only if target motion proves the one-frame contract unacceptable;
do not add recency, grace-window, or general render-graph state as collateral damage.

### Task Checklist

- [x] Add typed renderer frame feedback for selected dynamic root IDs, unioned across views and
      independent from optional profiling diagnostics.
- [x] Add one runtime-owned visual cadence scheduler tracking only last-sampled time by
      authoritative dynamic node identity.
- [x] Sample roots visible in the previous completed frame every rendered frame and offscreen roots
      at an explicit harness-controlled interval.
- [x] Reconcile scheduler state against active animation ownership every frame so replacement,
      eviction, and destruction leave no stale identity state.
- [x] Preserve full-cadence mode as the zero/disabled baseline.
- [x] Exercise camera cuts, portal transitions, multiple views, owner replacement, long frame gaps,
      and context loss.
- [x] Sweep offscreen intervals on DA55 and the larger DC58 authored-animation workload.
- [x] Measure semantic advancement, visual sampling, publication, renderer selection, total frame
      CPU, and first-visible pose age.
- [x] Escalate to split selection/execution only if previous-frame feedback fails the motion gate;
      otherwise do not implement the more complex path.
- [x] Promote a production interval only if animation sampling/publication savings remain material
      after scheduler overhead.
- [x] Remove visibility/cadence distributions, measurement cycles, and rejected scheduler controls
      before the animation implementation commit.

### Acceptance Criteria

- All active animations advance semantics every frame call regardless of visual cadence.
- Roots visible in the previous completed frame sample at render cadence.
- Offscreen sampled/published counts decrease with the accepted policy.
- An entity returning to view exhibits at most the accepted one-frame stale presentation and no
  sustained slow animation, clock reset, or missed visual state.
- Multi-view feedback samples the union once; no entity is sampled twice per frame.
- Owner replacement and eviction leave no stale cadence state.

### Decisions and Course Corrections

- The scheduler has exactly two inputs beyond the advanced animation frame: the previous completed
  renderer frame's visible-root union and each active playback's last visual sample time. No
  recently-visible category, grace duration, or visibility-flapping state exists.
- `Renderer.drawFrame()` now returns typed production feedback containing dynamic root IDs selected
  in at least one view. The WebGL renderer deduplicates them in a frame-local set across flat and
  portal contribution resolution; optional profiling diagnostics remain uninvolved.
- Active roots absent from scheduler history sample immediately. Each selection reconciles retained
  timestamps against the advanced frame's authoritative active IDs, so owner replacement and
  eviction cannot preserve stale cadence state. Destruction clears both timestamps and feedback.
- Zero seconds remains the exact full-cadence override. The browser harness exposes the single
  `--offscreen-animation-sample-interval-ms` tuning control; no interval cycle or app-specific
  camera fixture was retained.
- On the animation-isolated DC58 workload, `0ms`, `100ms`, and `250ms` averaged `4.575ms`,
  `3.873ms`, and `3.725ms` of total frame work over matched two-second captures. `100ms` reduced
  isolated frame work by about 15% while bounding offscreen pose age much more tightly; the extra
  `150ms` at `250ms` bought only about three additional percentage points.
- DA55 is dominated by SwiftShader EnvCell shell submission in this harness, but the matched
  `100ms` policy still reduced non-due-frame presentation work from all `171` playbacks to `61`
  visible roots while skipping `110` offscreen roots. Its average frame work moved from `72.34ms`
  to roughly `71ms`; aggregate timing is correctly treated as secondary to the exact workload
  reduction.
- The accepted product default is `100ms`. Visible roots return to a current pose on the frame after
  their first selection. Scheduler diagnostics record newly visible playback count and maximum
  visible presentation age for the first-selection frame; deterministic tests prove the following
  frame samples them regardless of the offscreen timer.
- The DA55 sky-to-scene camera cut completed at the product default with all `61` newly selected
  roots sampling at render cadence thereafter, no clock discontinuity, and no browser console
  errors. A portal-mode DA55 smoke retained the same `61`-root feedback through the recursive
  contribution path without errors. The evidence did not justify splitting renderer selection from
  execution.

## Phase 8: Cull Eligible Object Presentation Roots by Published Footprint

### Design

Keep `SceneGraph` local bounds as the one stable, conservative spatial envelope. After scope and
frustum selection, apply a second renderer-owned fidelity decision to an eligible atomic
presentation root. Reject roots whose conservative current published-presentation AABB projects to
strictly less than the configured physical-pixel area. Near-plane-straddling roots remain retained.

Generalize `minimumGeneratedInstancePixelArea` into one
`minimumObjectFootprintPixelArea` product setting. The accepted `64px²` default and zero-disabled
baseline remain unchanged. This setting drives two deliberately different algorithms:

1. Generated opaque/alpha-tested streams retain their existing per-instance selector because one
   scene node contains many independently optional instances.
2. Buildings, explicit objects, EnvCell residents, and anchored authored dynamics use one
   independently drawable presentation root after scene selection.

Do not route portals through this policy: their aperture cutoff prunes topology and remains a
separate setting. Do not admit terrain, EnvCell shells, generated transparent/additive streams, or
container bounds that combine independently visible presentations.

For anchored authored dynamics, `DynamicEntitySystem` owns a `publishedPresentationBounds` fact
computed atomically from the same prepared part geometry, articulated transforms, authored scale,
effect root rotation, and render states applied by `publishPresentation()`. It describes the pose
that will actually draw, not the semantic animation's current unsampled pose and not the inflated
animation-wide swept scene bound. When offscreen sampling is skipped, both the published pose and
its bound intentionally remain unchanged.

Split renderer contribution lookup into a cheap presentation descriptor and retained expansion.
The descriptor identifies eligibility and provides a local presentation envelope plus resolved root
placement. Immutable static descriptors reuse their selected scene node's existing local bound;
anchored dynamics use their separately owned published-presentation bound. Only a root retained by
footprint policy may expand dynamic parts, resolve static draw units, bind resources, enter
visibility feedback, upload instances, or submit draws.

### Task Checklist

- [ ] Cleanly rename the generated-specific object setting, default constant, harness flag,
      diagnostic presentation, tests, and documentation to
      `minimumObjectFootprintPixelArea`; retain no compatibility alias.
- [ ] Extract or reuse one conservative physical-pixel AABB projection predicate shared by
      generated-instance and presentation-root selectors, including strict-less-than equality,
      zero-disabled identity, multi-view independence, and near-plane retention.
- [ ] Introduce a discriminated renderer-facing presentation-footprint descriptor whose eligible
      variants are building, explicit object, EnvCell resident, and anchored authored dynamic.
- [ ] Keep terrain, EnvCell shells, generated stream containers, generated transparent/additive
      streams, and future runtime-authored actors explicitly ineligible rather than silently
      falling back through missing bounds.
- [ ] Split `RenderWorld` dynamic identification and bounds lookup from
      `getVisibleContributions()` so rejected roots perform no articulated-part or material
      expansion.
- [ ] Reuse each eligible immutable static root's existing scene-node local bound in the renderer
      descriptor; do not duplicate it in `StaticObjectRenderable` or traverse geometry resources at
      frame time.
- [ ] Retain each prepared dynamic part's geometry-local bound through activation so publication
      can derive the complete pose envelope without renderer resource lookup.
- [ ] Compute and store each anchored dynamic's complete published-presentation envelope as part of
      initial staging and every sparse presentation publication; fail before scene mutation if the
      envelope cannot cover every applied part.
- [ ] Prove dynamic envelopes include articulated transforms, nonuniform authored/default scale,
      `SetOmega` root rotation, mixed part geometry, and cyclic/interpolated poses.
- [ ] Reject eligible roots before contribution expansion and omit rejected dynamics from renderer
      visibility feedback so the existing offscreen cadence policy follows the same decision.
- [ ] Add temporary per-class tested/rejected/area attribution only long enough to decide whether
      every eligible class benefits; retain only metrics with distinct operational consumers.
- [ ] Sweep zero and `64px²` first across DA55, DC58, explicit-object-heavy, building-heavy,
      indoor-root, hybrid, camera-motion, and visibility-entry workloads. Test other thresholds only
      if `64px²` produces a concrete quality or cost failure.
- [ ] Remove rejected eligibility variants, attribution buckets, threshold cycles, and measurement
      paths before the implementation commit.

### Acceptance Criteria

- Threshold zero reproduces identical scene selections, expanded contributions, dynamic feedback,
  uploads, draw ordering, and submissions for all eligible and exempt classes.
- A footprint-rejected presentation root performs no part/draw-unit expansion, resource selection,
  frame-instance allocation, visibility feedback, or submission.
- Dynamic footprint bounds describe the exact last published presentation conservatively; sparse
  cadence never pairs a stale drawn pose with a newer incompatible bound.
- Mandatory initial publication establishes a valid dynamic presentation bound before the root can
  enter renderer selection.
- Eligible immutable static roots use the exact same bound fact for spatial and presentation
  decisions; no duplicate static envelope can drift from scene publication.
- The animation-wide swept scene bound and spatial membership never change at presentation cadence.
- Terrain and EnvCell shells never develop holes, and portal reachability remains governed only by
  portal traversal policy.
- Multi-view rendering tests each eligible root independently per view but unions retained dynamic
  feedback once by authoritative root ID.
- The shared `64px²` object policy produces material preparation/submission savings without
  objectionable static or animated popping; otherwise failing eligibility classes are removed from
  the accepted policy rather than patched with implicit fallbacks.

### Decisions and Course Corrections

- Planned from the Phase 7 resteer: scene bounds and current published-presentation bounds remain
  separate owner facts with separate consumers. No second bounds field enters `SceneGraph`.
- The shared setting expresses one object-fidelity choice, while generated instances and selected
  presentation roots retain algorithms matched to their actual atomic draw units.
- To be completed during execution.

## Phase 9: Cleanup, Cross-Feature Verification, and Closeout

### Task Checklist

- [ ] Audit that each earlier resteering gate already removed its temporary distributions, cadence
      probes, screenshot cycles, rejected policy fields, compatibility aliases, and dead
      vocabulary; treat any survivor as a failed phase boundary.
- [ ] Ensure every surviving setting and metric has one named consumer and a scenario distinct from
      existing fields.
- [ ] Re-run formatting, Svelte/TypeScript checks, ESLint, dead-code analysis, Rust clippy, and the
      full TypeScript suite.
- [ ] Re-run portal planner/executor fixtures, generated worker/compaction tests, static/dynamic
      presentation-footprint tests, animation/effect tests, lifecycle tests, and the canonical
      browser harness matrix.
- [ ] Capture final SwiftShader and Apple/WebKit profiles with effective policies embedded in the
      diagnostic report.
- [ ] Update architecture documentation and historical plans with accepted decisions, rejected
      alternatives, measured benefit, and remaining debt.
- [ ] Commit portal, generated/eligible-object footprint, animation, and documentation cleanup as
      reviewable independent milestones.

### Acceptance Criteria

- Each accepted optimization independently reduces its owned workload and remains individually
  attributable in the final evidence.
- Portal visibility, near-plane ownership, alternate routes, generated material behavior,
  eligible-root and exemption behavior, animation semantics, hooks, lifecycle, and multi-view
  behavior pass their complete regressions.
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
| Newly visible dynamics show a stale pose for one frame.                               | Measure pose age and motion; split current-frame selection from execution only if the simple feedback contract fails.                                                    |
| Visibility feedback becomes a renderer diagnostic dependency.                         | Return typed control feedback from the renderer independently of optional diagnostics and profiling.                                                                     |
| Multi-view rendering samples or publishes entities repeatedly.                        | Union authoritative node IDs at the renderer boundary and sample each selected entity once.                                                                              |
| Published dynamic footprint bounds drift from the pose that actually draws.           | Compute pose and bound atomically from the same prepared geometry, transforms, scale, root effect, and render state; fail before mutation on incomplete coverage.        |
| A second presentation bound contaminates scene spatial ownership.                     | Keep the scene graph's conservative bound unchanged; expose published presentation bounds only through renderer-facing contribution descriptors after broad-phase query. |
| A universal cutoff treats containers or continuous surfaces as optional objects.      | Use explicit eligibility variants; exempt terrain, EnvCell shells, generated containers, and unsupported generated blend streams.                                        |
| Root footprint filtering costs more than contribution work it removes.                | Reject before expansion, reuse owner-computed bounds, profile the projection pass separately, and drop any eligibility class without positive net benefit.               |
| Threshold and cadence controls accumulate into permanent debug policy.                | Keep candidates uncommitted or harness-owned, promote only selected single-value overrides, and remove every temporary cycle at its owning resteering gate.              |

## Definition of Done

- [x] Recursive portal footprint rejection is either accepted with measured thresholds or removed.
- [x] Generated screen-size culling is either accepted with positive net benefit or removed.
- [x] Offscreen visual cadence reduction is either accepted with exact semantic behavior or removed.
- [ ] Eligible static and anchored-dynamic presentation-root culling is accepted with positive net
      benefit or removed per eligibility class.
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

1. What read-only scene-query contract exposes each already-selected immutable root's local bound
   and placement without cloning unrelated node state or duplicating the bound in renderables?
2. Should prepared geometry-local bounds remain on each `ActiveDynamicPart`, or should activation
   collapse them into a separate immutable bounds input colocated with publication?
3. Does the shared `64px²` object cutoff benefit every proposed root eligibility class, or should a
   measured class remain explicitly exempt?
4. Do mixed transparent/opaque independently drawable roots remain visually stable under whole-root
   rejection, while generated transparent/additive streams stay on their existing ordered path?
