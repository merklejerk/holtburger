# Holtburger 3D Particle and SAO Cost-Reduction Plan

## Status

Complete. Phase 0 instrumentation and baseline capture are complete. Phase 1's
production visibility wiring, Phase 2's range-origin cutover, and Phase 3's shared device-state
filtering are accepted at the B54A pose. The sparse particle-row branch was measured and rejected.
Phase 4's redundant SAO scratch-clear deletion and Phase 5's half-resolution SAO default are
accepted, as is Phase 6's eight-tap SAO kernel. Phase 7 secondary-tile culling was measured and
rejected, with its implementation deleted. Phase 8 combined-system proof and Phase 9 cleanup and
final repository verification are complete.

## Goal

Stop advancing hidden emitters unnecessarily, remove the pathological per-particle CPU cost of
parent-following emitters, and reduce portal/flat SAO bandwidth and shading work without changing
particle behavior, portal visibility, or accepted near-field grounding quality.

## Context and Boundaries

### In Scope

- Connect production particle advancement to the renderer's existing previous-frame visibility
  selection so the already-implemented retail-compatible hidden-emitter suspension policy runs.
- Complete the previously planned particle-origin cutover:
  - resolve one live origin per visible parent-following emitter;
  - carry that origin on the emitter's existing draw range;
  - select the range origin in the particle vertex shader;
  - stop rewriting and uploading every live following-particle record each frame.
- Re-profile particle submission after that cutover and conditionally address only evidenced
  residual costs:
  - reduce dirty-record upload amplification if sparse births/deaths still upload broad texture
    spans;
  - reuse the renderer's existing state applicator for particle draws if redundant state calls
    remain material.
- Remove SAO scratch clears proven redundant by exact current-tile coverage.
- Select a lower SAO resolution scale through fixed-pose visual and real-GPU evidence.
- Select a smaller SAO evaluation kernel through the same evidence.
- Add an SAO-specific minimum secondary-tile footprint which leaves portal traversal and rendering
  intact while omitting imperceptible AO work.
- Extend focused diagnostics only where they distinguish these mechanisms and remain useful for
  future renderer profiling.
- Verify flat, portal-atlas, portal-transition, particle, render-scale, and resource-lifecycle paths.

### Out of Scope

- Scene streaming, source publication, texture-atlas publication, or streaming hitch reduction.
- Changing Explorer scene-interest defaults. The defaults remain terrain/buildings radius 8 and
  EnvCells/explicit/generated radius 2.
- Object footprint-culling policy or a new object-distance gate.
- Particle simulation laws, emission policy, ownership, culling envelopes, slot allocation, draw
  packing, blend policy, or authored visibility behavior.
- Distance-based particle tick throttling, clock quantization, emission-density reduction, or a new
  projected-footprint particle LOD. Closed-form trajectories have no per-particle CPU update cadence
  to reduce, and visible quality degradation remains undeserved by current GPU evidence.
- A second particle-specific GL state cache. Any evidenced state filtering must generalize and reuse
  the existing renderer applicator with explicit phase invalidation.
- Sorting or regrouping particle ranges. Their current order remains intact because ordinary alpha
  blending is order-dependent; additive-only reordering is deferred without separate evidence.
- Moving SAO after final portal composition or composing a new final-scene depth buffer.
- Replacing SAO, introducing temporal accumulation, hierarchical depth, or a generic post-process
  framework.
- Fusing vertical blur with composition; that trade conflicts with sub-native SAO resolution and is
  deferred unless later evidence changes the chosen resolution.
- Player-facing controls for resolution, sample count, or tile cutoff. Candidate values are
  implementation-time tuning; only accepted product policy survives cleanup.
- Empty-caster PSSM work and explicit-object batching. They remain separately evidenced follow-up
  opportunities.

## Ground Truth

### Particle References

- `apps/holtburger-3d/src/lib/game/systems/particle-system.ts`
  - `advance` already accepts an emitter-owner visibility predicate and implements hidden persistent
    suspension plus analytic finite-emitter reconciliation;
  - hidden persistent emitters avoid spawn, expiry, and record mutation work until visible again;
  - `collectDrawRanges` owns visible-emitter selection and currently rewrites every live record for
    `followsParent` emitters.
  - `#writeParticleRecord` explicitly documents the deferred draw-uniform cutover.
  - `ParticleSourceRange` is the producer-owned, pooled per-emitter contract.
- `apps/holtburger-3d/src/lib/game/renderer/particle-render-routing.ts`
  - `ParticleRenderBatcher` pools and routes source ranges into final render-domain draw ranges.
- `apps/holtburger-3d/src/lib/game/renderer/particle-record-layout.ts`
  - fixed 24-float record layout and split landblock/local origin precision contract.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-particle-pass.ts`
  - one physical draw per emitter range and the existing range-local uniform application boundary;
  - currently writes program, blend, VAO, texture, sampler, and uniform state directly to WebGL.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-device-state-applicator.ts`
  - the existing renderer state-filtering primitive for programs, blend policy, texture/sampler
    bindings, VAOs, and uniforms;
  - currently scoped to object phases and invalidated whenever another pass may have mutated the
    context. Particle state filtering must reuse or generalize this owner rather than duplicate it.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-particle-record-store.ts` and the particle slot
  owner in `particle-system.ts`
  - currently collapse dirty slots to one enclosing range and upload every complete texture row in
    that range, which can amplify sparse changes across non-adjacent emitter allocations.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-particle-program.ts`
  - vertex-stage re-anchoring and motion evaluation shared by flat and portal variants.
- `apps/holtburger-3d/src/lib/game/runtime/game-presentation-runtime.ts`
  - `#particleRenderOwner` already resolves sky and resident particle visibility against the
    renderer's previous dynamic selection for draw-range collection;
  - production currently calls `particles.advance(timeSeconds)` without that visibility fact, so
    the tested suspension mechanism is not active outside focused unit tests.
- Commit `45dcd9d4` (`perf(particles): write records once at spawn into persistent per-emitter
slots`) states that the next sub-phase moves following-emitter origins to a draw uniform. This
  plan completes that unfinished phase rather than inventing a new direction.
- Existing `RETAIL QUIRK` citations in the particle program remain authoritative for motion-law
  behavior. This optimization changes data placement and draw plumbing only.

### SAO References

- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
  - flat and portal schedules invoke the same SAO owner after opaque work and before deferred
    blended/particle work;
  - portal SAO executes before the scope-atlas compositor resolves into the flat scene target.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-sao-pass.ts`
  - one `applyPortal` call writes tile metadata and executes four instanced exact-tile passes:
    evaluation, horizontal blur, vertical blur, and multiplicative composition;
  - `#prepareScratchDraw` currently clears the full scratch extent before evaluation and each blur;
  - shader sampling is clamped to each tile, so islands cannot read neighboring atlas tiles;
  - resolution scale and the compile-time sample kernel come from shared frontend tuning.
- `apps/holtburger-3d/src/lib/game/renderer/portal-scope-atlas-planner.ts`
  - owns selected render-domain tiles and their packed atlas/screen rectangles.
- `apps/holtburger-3d/src/lib/game/renderer/portal-scope-window-culler.ts`
  - owns the existing portal-visibility footprint threshold. The new AO threshold must not enter or
    modify this traversal.
- `apps/holtburger-3d/src/lib/frontend-tuning.ts`
  - owns accepted shared rendering defaults, including SAO resource and appearance tuning.
- `docs/plans/holtburger-3d-near-field-sao-plan.md`
  - records the original algorithm, visual matrix, retail divergence, coverage census, integration
    order, and prior performance evidence. This plan optimizes that accepted architecture.

### Current Evidence

All steady-state figures below were captured on 2026-09-01 with the real RX 7900 XT through the
canonical browser harness, renderer profiling enabled, render scale 1, portal mode, and Explorer
default radii. Streaming samples are excluded.

The pathological outdoor pose is:

```text
landblock: 0xb54affff
position: 34802.11718061791,223.56336397946617,-14232.502168398461
yaw: 33.49104048868762 degrees
pitch: -33.75263589124942 degrees
```

The original profiling capture contained 755 authored dynamic entities, 523 emitter owners, 527
active emitters, 6,838 live particles, 18,720 reserved record slots, and 218 animated dynamics.
Only 405 dynamic parts survived object footprint selection for rendering. A fresh 2026-09-01
recapture at the same pose and defaults reached 541 emitters and approximately 18,500 live
particles after settling. Wall-clock emission makes those population totals unsuitable as a
cross-revision comparison, so visual particle comparisons use fixed simulation/capture frames and
performance comparisons record the observed population beside each run.

A six-second V8 profile attributes approximately 2.69 ms per rendered frame inclusively to
`collectDrawRanges`, dominated by:

- about 2.05 ms per frame writing following-particle records;
- about 0.55 ms per frame repeatedly resolving parent scene origins; and
- the remaining range and upload bookkeeping.

The approximately 2.05 ms record cost is the visible following-particle rewrite loop, not ordinary
spawn-time record creation. Visibility wiring can avoid hidden spawn/expiry record mutations and
their upload amplification, but it cannot replace the range-origin cutover and must be attributed
separately.

A temporary diagnostic bypass of particle range collection/upload/draw approximately doubled
profiled frame throughput and reduced renderer CPU/GPU work. The bypass was reverted and is not an
implementation candidate; it proves where to cut the contract.

Object footprint classification was about 0.15 ms per frame in the same profile and remains out of
scope. SAO was about 0.2 ms GPU in this outdoor view; portal-dense scenes are the required evidence
for tile-area optimization because their committed atlas area can exceed the final viewport.

### Phase 0 Recapture

The browser harness now has a compact `--particle-sao-report-only` result containing the effective
scene-interest radii, camera, viewport, GPU, particle diagnostics, particle/SAO renderer metrics,
frame/tick profiles, and browser errors. It changes reporting only and is retained as the canonical
measurement surface for this plan.

Three six-second B54A steady-state captures used a ten-second settle, RX 7900 XT, 1280x720 drawing
buffer, render scale 1, portal mode, SAO enabled, deterministic particle seed 7, and Explorer default
radii: terrain/buildings 8 and EnvCells/explicit/generated objects 2.

| Run | Whole-frame CPU (ms) | Renderer CPU (ms) | Particle submission CPU (ms) | GPU total (ms) | Particle GPU (ms) | SAO GPU (ms) |
| --- | -------------------: | ----------------: | ---------------------------: | -------------: | ----------------: | -----------: |
| 1   |                8.188 |             4.300 |                        0.480 |          2.845 |             0.183 |        0.216 |
| 2   |                7.872 |             4.444 |                        0.481 |          2.914 |             0.193 |        0.208 |
| 3   |                6.540 |             3.430 |                        0.369 |          2.320 |             0.135 |        0.204 |

The spread is large enough that single before/after runs are not acceptable. Optimization claims
must use alternating baseline/candidate runs with the live-particle and following-particle census
recorded beside each result. The stable outdoor SAO result, about 0.20 ms GPU, remains a control and
does not predict portal-atlas savings.

Fixed-frame baseline captures were taken for B54A, the DA55 candle, sealed `0x7d64010e`, hybrid
`0x7d640113`, and `0x0007014e`. They currently live under `/tmp` and are disposable evidence rather
than repository artifacts. The B54A frame-600 capture reported 541 visible emitters, 191 visible
following emitters, 193 live following particles, 193 following-record rewrites, and 76--77 uploaded
record rows in the steady-state performance runs.

The portal-dense benchmark pose omitted from the older object-path plan was recovered from its
original harness record. Its exact recipe is:

```text
landblock: 0x0007ffff
EnvCell camera: 0x0007014e
position: 68.92237666355803,1.282946390457422,-1175.0950283339375
yaw: 4.748 degrees
pitch: 9.442 degrees
viewport: 1600x948 at device scale factor 1
frame mode: portal
radii: terrain/buildings 8; EnvCells/explicit/generated objects 2
```

That recorded workload selected 58 portal scopes and 36 crossings and committed 2,616,577 atlas
pixels against a 1,516,800-pixel drawing buffer. This exact pose, not merely the EnvCell ID, is the
SAO tile-area benchmark.

An Explorer capture supplied during Phase 0 adds a complementary mixed outdoor/portal workload:

```text
landblock: 0xda55ffff
position: 42002.30787147863,43.66980794633817,-16363.061180282511
yaw: -30.794115761156 degrees
pitch: -19.347517921726 degrees
drawing buffer: 1446x907
frame mode: portal
radii: terrain/buildings 8; EnvCells/explicit/generated objects 2
retail-hidden geometry: shown
```

It selected 44 portal scopes and 52 crossings, committed 1,347,318 atlas pixels, retained 193
dynamic parts, submitted 830 object draws, and submitted 62 particle batches/354 particles. It is
the better mixed-load and crossing-count case, while `0x0007014e` remains the stronger pure SAO
fragment-area case (2,616,577 pixels). The harness and Explorer both show retail-hidden geometry by
default, so comparisons retain that setting; `--hide-retail-hidden-geometry` is an explicit variant,
not the benchmark default.

A canonical six-second real-GPU harness recapture of that pose after a ten-second settle reported 17
SAO candidate tiles covering 1,335,986 pixels, 0.335 ms mean SAO GPU time, 1.728 ms mean total GPU
time, and 2.290 ms mean whole-frame CPU work. It submitted 64 particle batches/360 particles. The
small atlas-area difference from the supplied Explorer frame is expected frame-to-frame portal
selection movement; timing deltas still require alternating runs. This also confirms why SAO
diagnostics count actual processing tiles and pixels rather than treating portal scope/crossing
counts as shader invocations.

## North Stars

1. Compute a following emitter's live origin once at the layer that owns emitter selection; every
   downstream consumer reads the resulting range contract.
2. Preserve the split landblock/local coordinate representation so optimization never spends
   particle precision.
3. Keep source ranges and draw ranges pooled, tagged, and complete; no parallel booleans or nullable
   fields whose valid combinations must be remembered.
4. Keep SAO a consumer of an already-accepted atlas plan. Presentation fidelity must not leak into
   portal traversal, topology, or composition ownership.
5. Feed one existing visibility policy into simulation and presentation rather than inventing a
   particle-specific distance or footprint policy.
6. The renderer has one state-filtering vocabulary. Particle submission may reuse it when measured,
   but must not grow a parallel cache with subtly different ownership rules.
7. Tune against actual fragment area and actual live-particle distributions, not draw count or
   static asset census alone.
8. Each optimization must remain independently measurable and visually reversible until accepted.
9. One quality concession per measurement step: do not change resolution and sample count in the
   same attribution run.
10. Disabled/skipped work must own no hidden clocks, readbacks, allocations, or alternate frame
    schedules.

## Phase 0: Establish Durable Workload and Cost Evidence

### Deliverables

- Focused harness reporting for:
  - active, visible, hidden, and following emitter counts;
  - hidden-to-visible reconciliation counts split by persistent and finite policy;
  - live particles belonging to visible following emitters;
  - particle record writes and logically dirtied rows;
  - particle record rows uploaded per frame;
  - particle draw-state call counts already distinguished by the renderer state applicator where
    available;
  - SAO candidate/processed/skipped tile counts;
  - SAO candidate/processed/skipped drawing-buffer pixel area.
- Repeatable baseline commands and screenshots for:
  - the `0xb54affff` particle stress pose above;
  - the existing DA55 close candle/particle pose;
  - the DA55 outdoor portal/particle mixed-load pose recorded in Phase 0;
  - the sealed interior `0x7d64010e` pose from the original SAO plan;
  - the hybrid indoor/outdoor `0x7d640113` pose;
  - the portal-dense `0x0007014e` scene used by object-path profiling;
  - flat mode as a correctness comparison only, never a product performance budget.
- Real-GPU renderer profiles and V8 profiles normalized per completed frame.

### Task Checklist

- [x] Surface only metrics with distinct decisions: hidden-emitter work, following-record work, and
      SAO tile-area work.
- [x] Record viewport, render scale, radii, frame mode, pose, GPU identity, sample duration, and
      deterministic particle controls beside every result.
- [ ] Capture at least three alternating runs for each claimed steady-state timing delta.
- [x] Separate streaming/publication windows from steady-state windows and retain neither as a
      substitute for the other.
- [x] Record baseline screenshots with fixed simulation/capture frames where particle content is
      compared visually.

### Acceptance Criteria

- The particle stress capture reports a stable following-particle population and record upload
  workload rather than inferring it from total particles.
- Particle evidence distinguishes hidden spawn/expiry record mutations from visible following-origin
  rewrites.
- Particle evidence can distinguish required record mutations from rows uploaded because they lie
  inside one enclosing dirty span.
- Portal captures report atlas tile area, not merely selected scope/crossing counts.
- Repeated baseline timing spread is known before an optimization delta is accepted.
- Profiling-disabled frames retain no new clocks or readbacks.

### Decisions and Course Corrections

- Added emitter visibility, hidden reconciliation, visible following-emitter/particle, and
  following-record rewrite diagnostics at the existing particle-system decision points. They add no
  diagnostic-only scans or profiling-disabled clocks.
- Added candidate/processed/skipped SAO tile and pixel counts while evaluating tile rejection. Once
  Phase 7 rejected and deleted that policy, Phase 9 collapsed the permanently equal/zero fields to
  the two distinct workload facts that remain useful: actual SAO tile and full-resolution pixel
  counts.
- Added the compact particle/SAO harness result because the full diagnostic payload obscured repeated
  measurements and made accidental configuration drift hard to spot.
- Did not add a second logical dirty-row census in Phase 0. Existing record rewrite counts express
  required particle mutations and uploaded-row counts express transfer work; changing dirty-range
  ownership merely to produce a diagnostic would prematurely implement Phase 3. Revisit only if the
  post-origin profile cannot attribute residual upload amplification.
- Recovered and documented the exact `0x0007014e` pose. The EnvCell identifier alone produced a
  one-tile view in an initial recapture and is not a reproducible proxy for the historical 58-scope
  workload.
- Added the supplied DA55 outdoor pose as a mixed-load benchmark rather than replacing the denser
  dungeon atlas case. Crossing count is useful portal context, but SAO work follows processed tile
  pixels; the two scenes exercise different stress dimensions.
- Phase 0 focused particle-system and SAO tests pass (56 tests), the frontend test type-check passes,
  and the harness report has been exercised on the real GPU. Full-project verification remains part
  of the final phase rather than a substitute for each phase's focused checks.

## Phase 1: Activate Existing Hidden-Emitter Suspension

### Design

Production draw-range collection already resolves particle owners against the renderer's previous
dynamic selection, including an explicit always-visible exterior owner for sky particles. Pass that
same visibility policy into `ParticleSystem.advance` so its existing hidden-emitter state machine is
actually exercised in the live runtime.

Keep the one-frame-late selection contract shared with draw collection. Do not add a second frustum
test, distance threshold, retained visibility cache, or particle-only culling result. A hidden owner
must still be checked for target liveness, but persistent emitters then perform no spawn, expiry, or
record work until their existing reconciliation runs once on re-entry. Finite emitters retain the
tested analytic completion policy.

This phase targets hidden spawn-time and expiry-time record mutations. It does not address the
visible following-particle rewrite measured in `collectDrawRanges`; Phase 2 owns that independently.

### Deliverables

- `game-presentation-runtime.ts`
  - supply the existing particle-owner visibility decision to `ParticleSystem.advance`;
  - preserve unconditional sky-particle advancement through the existing sky owner case;
  - keep advance and draw collection on the same previous-frame selection semantics.
- Focused runtime integration tests proving production wiring, first-frame behavior, sky handling,
  disappearance while hidden, and hidden-to-visible reconciliation.
- Before/after diagnostics and B54A profiles that distinguish hidden emission/record savings from
  visible following-origin work.

### Task Checklist

- [x] Reuse `#particleRenderOwner` or a narrower shared predicate derived from it; do not duplicate
      scene-node conversion or selection membership logic.
- [x] Pass visibility into `particles.advance` before animation publication without changing the
      established previous-frame selection boundary.
- [x] Prove sky emitters remain visible and advancing when absent from dynamic-node selection.
- [x] Prove a resident omitted from selection enters suspension once and performs no hidden spawn,
      expiry scan, or record mutation work on subsequent frames.
- [x] Prove persistent particles freeze age and resume without a visual jump or lifespan extension.
- [x] Prove finite emitters consume hidden emission budget analytically and reap according to the
      existing authored policy.
- [x] Prove a hidden target that ceases to exist is still removed promptly.
- [x] Exercise first render, camera entry/exit, portal visibility changes, and rapid selection
      alternation without adding hysteresis.
- [x] Attribute changes in record writes/uploaded rows separately from the untouched visible
      following rewrite loop.

### Acceptance Criteria

- Production `ParticleSystem.advance` receives the same owner-selection semantics used by particle
  draw collection.
- Hidden persistent emitters perform no spawn, expiry, origin-resolution, or record-mutation work
  after their suspension transition and before reconciliation.
- Finite and persistent reconciliation tests retain their cited retail behavior.
- Sky particles and newly visible resident particles appear under the existing one-frame selection
  contract with no additional latency.
- The B54A profile records the visibility-wiring delta without claiming it removed the measured
  per-live-particle following-origin cost.
- No new distance threshold, footprint classifier, cadence state, or visibility cache survives.

### Decisions and Course Corrections

- Record visible/hidden emitter counts and the measured spawn/expiry/upload savings. If B54A has few
  hidden emitters, retain the wiring as completion of an existing tested contract but do not claim a
  material performance win there.
- Production now passes `target => #particleRenderOwner(target) !== null` directly to `advance`.
  This keeps simulation and draw routing on one previous-frame selection and retains the explicit
  unconditional sky owner; no cache, distance policy, or second visibility computation was added.
- The B54A integration capture reported 409 visible and 132 hidden emitters, matching the 409
  submitted emitter batches. At fixed frame 600 it submitted 2,588 particles versus the 2,590
  baseline, while total live particles fell to 2,708 because hidden emitters no longer accumulated
  off-screen work. The fixed images had 0.00455 normalized RMSE and no observed scene-level visual
  loss; exact seeded particle pixels are not an invariant because retail-compatible visibility
  changes which global random rolls are consumed.
- The steady-state candidate reported 14,169 submitted particles, 7,604 visible following-particle
  rewrites, 76 uploaded rows, 0.440 ms particle-submission CPU, and 0.161 ms particle GPU. Those
  values overlap the Phase 0 spread, as expected: Phase 1 does not remove visible following-record
  work. Its material result is eliminating 132 hidden emitter advancements, not a claimed isolated
  frame-time delta.
- The 409 lifetime persistent-reconciliation count in a wall-clock capture is the expected startup
  transition: the first resident frame has no previous renderer selection, then visible emitters
  reconcile once after selection arrives. Fixed-frame capture begins after selection settlement and
  reports zero additional reconciliations.
- Existing particle-system tests cover persistent freeze/resume, finite analytic completion, hidden
  no-work behavior, and target-loss removal; the real-GPU harness proves the production call path.
  A new runtime injection seam solely to spy on the one-line predicate was rejected as test-driven
  architecture. Explicit sky and camera/portal alternation coverage remains open for the combined
  transition matrix.

## Phase 2: Move Following Origins onto Particle Ranges

### Design

Replace the implicit “rewrite records when following” mechanism with one tagged origin source on
each emitter range:

```text
ParticleOriginSource
  record-owned
  range-owned { landblockOrigin, localOrigin }
```

The exact name may change during implementation, but it must remain one discriminated composite
type. A range-owned origin is computed once after the emitter passes visibility selection. The
source range owns it, the render batcher copies it into the pooled draw range, the particle pass
binds it once for that physical draw, and both particle vertex programs select it instead of the
record origin.

Non-following emitters retain their per-particle frozen record origins unchanged. Following records
remain written at birth for a complete uniform record layout, but their origin lanes are ignored
while the draw range selects a live origin. This avoids a second record format and preserves the
same slot store, compaction, birth-time patching, and shader texture addressing.

### Deliverables

- `particle-system.ts`
  - compute and split one live origin per visible following emitter;
  - put the tagged origin source on `ParticleSourceRange`;
  - delete the per-live-particle rewrite loop from `collectDrawRanges`;
  - retain record writes only for birth, compaction after death, and birth-time suspension patches.
- `particle-render-routing.ts`
  - preserve the tagged origin source through pooled source-to-draw routing.
- `webgl2-particle-pass.ts`
  - bind range origin mode and split origin once per resolved draw range;
  - keep flat and portal routing isomorphic.
- `webgl2-particle-program.ts`
  - select record-owned or range-owned anchored origin before applying authored displacement;
  - preserve exact coarse anchor cancellation and existing retail motion quirks.
- Colocated unit tests for source collection, routing, uniform application, dirty-row behavior, and
  shader contract construction.

### Task Checklist

- [x] Introduce the tagged composite range-origin type and comment its invariant.
- [x] Extend pooled blank/mutable range shapes without adding per-frame allocations.
- [x] Resolve a following frame target once per visible emitter and quantize it once.
- [x] Delete the following-emitter particle loop and sweep the obsolete rewrite vocabulary.
- [x] Bind the new uniforms in ordinary, sky, and portal particle programs.
- [x] Prove moving parents update every particle in the emitter together.
- [x] Prove leave-behind emitters retain distinct spawn origins and never read the live range origin.
- [x] Prove re-anchoring across a landblock boundary remains millimetre-stable.
- [x] Prove hidden emitters perform neither origin resolution nor range draw work.
- [x] Verify particle-record dirty rows fall to birth/death/suspension changes rather than the live
      following population.

### Acceptance Criteria

- `collectDrawRanges` contains no loop over an emitter's live particles.
- Parent scene-origin resolution scales with visible following emitters, not their particle counts.
- A steady following population with no births/deaths produces no particle-record upload solely
  because the parent moved.
- Fixed-seed screenshots at the B54A stress pose and DA55 candle pose show no placement, motion,
  blend, billboard, portal-routing, or re-anchoring regression.
- V8 profiles no longer list `#writeParticleRecord`, `writeParticleRecord`, or repeated
  `getResolvedOrigin` as per-frame following-particle hot paths.
- The B54A workload retains the same emitter/particle/draw census while materially reducing frame
  work beyond the recorded run-to-run spread.

### Decisions and Course Corrections

- Implemented `ParticleRangeOrigin` as a discriminated `record`/`range` composite. Each following
  emitter allocates one `FollowingRangeOrigin` at creation; frame collection mutates its private
  tuple storage and pooled source/draw ranges retain the readonly contract. There are no per-frame
  origin objects or per-particle origin writes.
- Both flat and portal programs use the same three uniforms: one range-origin selector plus split
  landblock/local vectors. Record-owned draws only update the selector; stale range vectors are
  shader-inactive. This preserves one record layout and exact coarse anchor cancellation.
- The first real-GPU B54A capture compiled both production shader variants, retained 409 batches and
  approximately 14,160 visible particles, reduced following-record rewrites from 7,552 to zero, and
  reduced `particleRanges` from the 2.39--3.30 ms baseline to 0.19 ms. Fixed frame 600 uploaded zero
  rows versus 74 before the cutover; the steady wall-clock run uploaded 67 birth/death rows.
- Fixed-frame B54A output showed no missing or misanchored particle population. Its 0.00310
  normalized RMSE against the Phase 1 image was sparse scene-edge variation with no observed
  particle-placement regression. DA55 close-particle comparison remains open.
- The temporary `lastVisibleFollowingRecordRewriteCount` diagnostic made the cutover measurable and
  was removed in Phase 9 once combined evidence was captured; it had become permanently zero and
  therefore no longer represented a distinct runtime fact.
- The first whole-frame candidate was 4.745 ms, below the 6.54--8.19 ms baseline range, but no final
  aggregate claim is accepted until repeated runs. Particle GPU and renderer particle-submission
  CPU were unchanged, correctly locating the win in runtime range collection rather than draw cost.
- Two repeat candidates measured 0.068 and 0.080 ms particle-range collection, 3.104 and 3.033 ms
  whole-frame work, and 2.766 and 2.697 ms renderer CPU. Together with the first 0.190 ms/4.745 ms
  candidate, range collection is consistently below the 2.69--3.30 ms baseline and whole-frame work
  clears the 6.54--8.19 ms baseline spread. Phase 2 is accepted. These are repeated baseline-then-
  candidate blocks rather than a same-process alternating harness, which remains a methodology
  concession; the mechanism-local delta is roughly an order of magnitude and is also structurally
  proven by the deleted particle loop.

## Phase 3: Resteer Residual Particle Submission Cost

### Design

Re-profile the unchanged B54A workload after following origins move onto ranges. The origin cutover
removes the dominant cost and changes both record-upload behavior and the relative value of GL state
filtering, so the baseline profile cannot justify either follow-up by itself.

First compare logical record writes and distinct dirty rows with physically uploaded rows. If sparse
birth/death/compaction changes still produce broad enclosing uploads, replace the single dirty span
with allocation-free dirty-row tracking, coalesce adjacent rows, and choose between run uploads and
one enclosing upload from measured run count and coverage. Do not force many tiny `texSubImage2D`
calls when one span is cheaper.

Separately inspect redundant particle program, blend, VAO, texture/sampler, and uniform calls. The
renderer already owns `WebGL2DeviceStateApplicator`; do not add a pass-local cache. If filtering has
a material residual win, generalize that existing applicator into the renderer's shared state owner,
inject it into particle submission, and invalidate it at every boundary where an independently owned
pass may mutate WebGL state. Keep particle range order unchanged.

Either branch may end with no production change. That is a successful evidence gate, not an
unfinished implementation.

### Deliverables

- Before/after B54A profiles taken after Phase 2 with record-write/upload amplification and particle
  GL-call evidence.
- Conditional sparse-row upload implementation in the existing particle slot/store owners, only if
  uploaded coverage materially exceeds logical dirty coverage.
- Conditional generalization and reuse of `WebGL2DeviceStateApplicator`, only if redundant particle
  state remains material after Phase 2.
- Focused tests for whichever conditional branch survives; no test or abstraction for a rejected
  branch.

### Task Checklist

- [x] Record logical record writes, distinct dirty rows, uploaded row count, upload calls, and upload
      bytes for representative stable and mixed emission/compaction frames. Separate authored burst
      fixtures were dropped once the observed absolute transfer size rejected the branch.
- [x] Measure particle submission after the origin cutover before changing upload or state policy.
- [x] If dirty-span amplification is material, implement fixed-capacity dirty-row tracking and
      coalesce adjacent rows without per-frame allocation.
- [x] Choose sparse runs versus one enclosing upload from an explicit coverage/run-count policy
      sized by the measured emitter distribution.
- [x] Verify every mutated record row is uploaded once before draw and untouched rows need not be
      uploaded.
- [x] If redundant state calls remain material, identify the exact reusable subset of the existing
      applicator before renaming or widening it.
- [x] Preserve one writer per cached uniform location and explicit invalidation around terrain,
      portal, SAO, sky, particle, and object state owners.
- [x] Keep direct per-range writes for values that necessarily change, including `instanceBase`,
      portal routing, and range-owned following origin, unless evidence shows actual adjacent reuse.
- [x] Preserve particle draw order and authored alpha/additive behavior.
- [x] Delete temporary counters and reject either optimization when its saving does not exceed
      measurement spread or its ownership contract becomes more complex than the saved work.

### Acceptance Criteria

- Stable following parents no longer dominate either logical dirty work or uploaded record rows.
- If sparse-row uploads survive, uploaded rows closely track actual dirty coverage without an
  excessive increase in upload calls or total particle CPU time.
- If state filtering survives, particles and objects use one shared state-applicator vocabulary;
  there is no particle-local cache and no cache that assumes it observed mutations from other
  passes.
- Particle census, draw order, blend results, portal routing, slot compaction, and lifecycle behavior
  remain unchanged.
- Each surviving branch improves the target metric and total particle submission beyond repeated-run
  spread on the real GPU workload.

### Decisions and Course Corrections

- Temporary exact dirty-row instrumentation sampled logical-to-physical row counts of 1-to-1,
  3-to-8, and 8-to-33 on stable and emission/compaction frames. Amplification exists, but the worst
  instrumented enclosing transfer was 33 24-KiB rows in one call. Replacing that with as many as
  eight driver calls would trade modest RX 7900 XT bandwidth for JS/driver overhead with no measured
  total win. Sparse-row tracking was rejected and all temporary Set/counter code was removed.
- A one-shot adjacency census on a 336-draw particle contribution found 335 repeated blend policies,
  315 repeated VAOs/base textures/palette textures, 319 repeated motion types, and 324 repeated
  origin modes. Geometry wrapper identity repeated zero times, proving the cache belongs at physical
  device-state identity rather than renderer wrapper identity.
- Renamed `WebGL2ObjectStateApplicator` to `WebGL2DeviceStateApplicator` and widened its existing
  texture owner with `applyTexture2D(unit, texture, sampler)`. Objects and particles now consume the
  same renderer-owned instance. Particle submission invalidates after record-store synchronization,
  owns state through the draw sequence, and invalidates after its explicit null-VAO cleanup; later
  independent phases retain their existing boundary invalidation.
- `instanceBase`, portal scope routing, and draw submission remain direct because they necessarily
  differ per range. Stable blend, VAO, texture/sampler, motion, origin-mode, orientation, and material
  uniforms use the shared applicator. Draw order and authored blend staging did not change.
- Three B54A candidates measured 0.240, 0.225, and 0.226 ms particle-submission CPU versus the
  post-origin 0.314--0.438 ms range. GPU particle time remained approximately 0.07 ms, locating the
  saving in CPU call suppression. The 409-batch/~14.2k-particle census remained stable.
- The Phase 3 fixed frame matched the Phase 2 scene without a visible particle regression; normalized
  RMSE was 0.00308 and again consisted of sparse scene-edge variation. Focused tests prove repeated
  state collapses while `instanceBase` remains one physical upload per range.

## Phase 4: Delete Redundant SAO Scratch Clears

### Design

`#prepareScratchDraw` currently clears the complete scratch attachment before evaluation and each
blur. Each active tile quad then writes every pixel in its exact scaled rectangle. Atlas gaps and
pixels belonging only to previous frames are never sampled or composited.

Split state preparation from clearing, prove current-tile full coverage at supported resolution
scales, and delete the clears. Do not replace them with scissor loops or per-tile clears.

### Deliverables

- `webgl2-sao-pass.ts`
  - separate framebuffer/state setup from obsolete neutral clearing;
  - remove `NEUTRAL_SAO_CLEAR` if it has no surviving consumer;
  - retain exact tile quads and tile-local sample clamping.
- Focused tests for scaled tile-rectangle coverage and atlas edge rounding.
- Portal motion/lifecycle captures that exercise changing tile sets and atlas reuse.

### Task Checklist

- [x] Prove evaluation writes neutral values for clear depth and distance-ineligible opaque depth.
- [x] Prove evaluation and both blur outputs fully cover each current scaled tile rectangle.
- [x] Exercise adjacent tiles, atlas gaps, disappearing tiles, shrinking/growing tiles, resize, and
      portal transition supersession.
- [x] Delete all redundant full-attachment clears together; do not retain vestigial neutral-clear
      vocabulary.
- [x] Compare profiler GPU phase and screenshots with and without the clears before accepting.

### Acceptance Criteria

- No SAO scratch color clear executes during an ordinary enabled frame.
- Reused scratch textures cannot contribute stale values to any current tile or the scene target.
- Coverage visualization, flat SAO, portal SAO, toggling, resize, and context teardown remain valid.
- Exact screenshots or accepted low-error comparisons show no stale-tile flashes or seams across
  camera motion and portal transitions.
- The deletion improves or leaves unchanged real-GPU timing; a regression restores the clears and
  records which coverage assumption was false.

### Decisions and Course Corrections

- The evaluation shader already writes neutral `1.0` for clear depth, distance-ineligible depth,
  and invalid reconstructed normals. Both separable blur passes also write every current tile pixel,
  return neutral for clear center depth, and clamp all reads to the current tile rectangle. Composite
  submits only the same current tile instances, so atlas gaps and prior-frame-only regions have no
  consumer.
- Added `scaledSaoInterval` as the CPU statement of the shader's floor-based tile interval rule and
  reused it for scratch sizing. Focused tests cover adjacent fractional edges, deliberate atlas
  gaps, and the one-pixel minimum. This is invariant documentation in executable form, not a second
  rectangle policy.
- Deleted all three full-attachment color clears—evaluation and both blur targets—and removed
  `NEUTRAL_SAO_CLEAR`. No scissor or per-tile replacement survived.
- The exact portal-dense command must request `--landblock 0x0007014e`; requesting the enclosing
  `0x0007ffff` does not demand the root EnvCell and makes the portal fixture unavailable. All timing
  evidence uses Explorer defaults (`8/8/2/2/2` radii), a 1600x948 viewport, and the RX 7900 XT.
- Three with-clear runs measured 0.35584, 0.35755, and 0.35429 ms mean SAO GPU time. Three clearless
  runs measured 0.28179, 0.28504, and 0.28728 ms over the identical 19 tiles and 2,616,577 processed
  pixels: approximately 0.071--0.073 ms, or 20%, saved beyond run spread.
- Matched frame 600 captures at a fixed 16.6667 ms step and particle seed 7 were pixel-identical
  (normalized RMSE 0) with and without clears. The production lifecycle fixture then passed portal
  transition supersession, resize, handoff, inactive, and black cleanup while the same session
  exercised AO on/off/on and portal/flat/portal/flat mode changes. No console errors or stale-tile
  assertion failures occurred.

## Phase 5: Select the Lowest Deserved SAO Resolution

### Design

Evaluate resolution scales `1`, `0.75`, and `0.5` after clear deletion. Change only resolution in
this phase; retain the current 12-tap kernel and zero AO-specific tile cutoff. Select the lowest
fixed shared default that passes the visual matrix.

Do not retain a runtime/player setting merely to make the sweep convenient. A temporary harness
override may exist during the phase if it materially shortens evidence collection, but cleanup must
remove it unless it proves a durable diagnostic consumer.

### Task Checklist

- [x] Capture matched flat, sealed-interior, hybrid-portal, portal-dense, vegetation, emissive, and
      motion/transition screenshots at each candidate scale.
- [x] Report scratch bytes, processed tile pixels, SAO GPU time, total GPU time, and render scale.
- [x] Inspect contact stability, thin geometry, depth discontinuities, portal edges, blur radius,
      and camera-motion shimmer.
- [x] Verify render scale remains a sampling-density choice and does not silently alter the accepted
      CSS-space fidelity policy.
- [x] Update the shared tuning constant to the accepted value and delete rejected candidate code.

### Acceptance Criteria

- The accepted scale has repeated real-GPU evidence in both flat and portal-dense scenes.
- Normalized screenshot error and visual inspection remain within the original SAO plan's accepted
  quality bar, with no portal seam or motion instability.
- Scratch allocation and reported byte counts exactly match the accepted scale.
- One fixed product default survives; no unexplained fallback or duplicate resolution path remains.

### Decisions and Course Corrections

- Selected `0.5`, the lowest planned candidate, as the one shared product default. No runtime or
  harness override was added: the candidate sweep temporarily changed the single tuning constant,
  then left only the accepted value. Render scale remained 1 throughout, so SAO resolution remains
  an independent internal sampling-density choice.
- In the 1600x948 portal-dense scene, scale 1 used 18.20 MB of scratch and measured
  0.28179--0.28728 ms SAO over 19 tiles/2,616,577 full-resolution candidate pixels. Scale 0.75 used
  10.24 MB and measured 0.22725 ms. Scale 0.5 used 4.55 MB and measured 0.12935, 0.12967, and
  0.13059 ms. Mean total GPU time at 0.5 was 1.133--1.151 ms versus 1.269--1.328 ms in the retained
  scale-1 clearless samples, though the attributed SAO phase is the cleaner comparison.
- The flat one-tile control covered the 1,516,800-pixel viewport. Scale 1 used 3.03 MB and measured
  0.40928--0.41358 ms SAO; scale 0.5 used 0.758 MB and measured 0.17653--0.17968 ms. This rejects a
  portal-packing-only explanation for the saving.
- Exact portal-dense frame-600 comparison against scale 1 produced normalized RMSE 0.00068 at scale
  0.5 (0.00050 at scale 0.75). Differences were confined to expected AO contact edges and thin
  geometry; no tile boundary or portal seam appeared. Sealed `0x7d64010e`, hybrid `0x7d640113`, and
  DA55 mixed vegetation/emissive/particle captures showed no visible loss of grounding at normal
  inspection.
- A discovered harness limitation prevents claiming exact cross-run indoor screenshots: fixed
  simulation time does not freeze asynchronous content publication, and repeated scale-1 indoor
  captures vary by approximately 0.0034 RMSE. Those captures remain qualitative evidence; only the
  identically settled portal-dense pair is used for normalized resolution error. A DA55 two-metre
  move-and-return capture completed without stale tiles, seams, assertions, or console errors; its
  0.00112 return error includes particles and presentation advancing during the deliberate delays.
- The plan originally requested the full scene matrix for every candidate. Once the lowest
  candidate passed the matrix, repeating all scenes at 0.75 could not change the choice and was
  dropped as YAGNI. Scale 0.75 remains only a measured midpoint, not surviving code or policy.

## Phase 6: Select the Smallest Deserved SAO Kernel

### Design

With the accepted resolution fixed, evaluate 12, 8, and—only if 8 has substantial headroom—6
deterministic spiral taps. The kernel remains compile-time shader policy; changing it must rebuild
the kernel and shader rather than branching per fragment.

### Task Checklist

- [x] Compare identical fixed-frame captures with the accepted resolution and no tile cutoff.
- [x] Inspect flat surfaces, contact edges, repeating noise, thin geometry, emissive objects, and
      motion shimmer.
- [x] Attribute evaluation-phase savings separately from unchanged blur/composite work.
- [x] Retain the smallest kernel whose benefit exceeds measurement spread and whose artifacts stay
      below the accepted visual bar.
- [x] Delete rejected kernel variants and temporary selection controls.

### Acceptance Criteria

- The accepted kernel has repeated evaluation and total-GPU evidence on the real adapter.
- No objectionable directional pattern, noise, contact loss, or temporal shimmer is introduced.
- Shader tests assert the accepted kernel cardinality and complete uniform upload.
- One kernel constant and one generated kernel survive cleanup.

### Decisions and Course Corrections

- Selected eight taps. At the accepted 0.5 resolution in the portal-dense scene, 12 taps measured
  0.12935--0.13059 ms mean SAO while eight taps measured 0.09914, 0.10072, and 0.10179 ms. Scratch
  extent, tile count, evaluation inputs, both blur passes, and composite work were unchanged, so the
  approximately 0.029 ms saving belongs to the only changed work: the compile-time evaluation loop.
- The exact frame-600 eight-versus-twelve capture produced normalized RMSE 0.00050. Differences
  remained on AO contact edges and thin geometry with no visible directional pattern, broad contact
  loss, portal seam, or objectionable noise at normal inspection. The retained DA55 motion capture
  and sealed/hybrid matrix exercise emissive, particle, and close-contact presentation at the same
  accepted resolution.
- Six taps measured 0.10111 ms on its first portal-dense run, inside and slightly above the
  eight-tap 0.09914--0.10179 ms range. It therefore offered no measurable benefit to justify a
  larger sampling-quality concession and was rejected without an unnecessary full visual matrix.
- The one `sampleCount` tuning field remains the source for kernel generation, GLSL array/loop
  cardinality, and the complete `uniform2fv` upload. Focused tests derive their expectations from
  that tuning source, rebuild the same bounded kernel, and check the complete upload without
  freezing a routinely adjustable default. The real-GPU runs compile and upload the accepted
  eight-tap array. No candidate selector or alternate kernel survived.

## Phase 7: Cull SAO on Small Secondary Atlas Tiles

### Design

Add a presentation-only minimum AO tile area independent of portal visibility. The camera/root
render domain is always eligible. Each secondary selected render-domain tile compares its exact
packed rectangle area against a cutoff authored in CSS pixels and resolved to drawing-buffer pixels
once per frame, following the existing render-scale invariant.

Eligible SAO metadata is compacted into a pass-local sequence; `gl_InstanceID` addresses that
compact sequence. The atlas plan, tile identities, opaque rendering, portal masks, and compositor
commands remain unchanged. Skipped tiles receive no evaluation, blur, or AO composite draw, so the
underlying scene color remains neutral rather than sampling stale scratch data.

Evaluate `0`, `16`, `64`, and `256` CSS-pixel squared candidates. If a hard boundary visibly pops
during motion, first lower the accepted cutoff. Add a stateless fade band only if evidence proves a
hard cutoff unacceptable; do not add hysteresis or retained per-tile history by default.

### Deliverables

- A focused pure tile-eligibility/compaction helper colocated with SAO tile metadata ownership.
- One accepted shared frontend tuning value with a named consumer.
- Renderer diagnostics for candidate/processed/skipped tile count and area.
- Harness override/reporting sufficient for candidate sweeps, retained only if useful after tuning.

### Task Checklist

- [ ] Identify the camera/root render domain explicitly from the atlas/visibility contract; never
      assume tile ordinal zero.
- [ ] Convert the CSS area cutoff using render scale squared exactly once at frame entry.
- [ ] Compact eligible metadata without allocating or mutating the atlas frame view.
- [ ] Use the compact count for evaluation, both blur passes, and composition.
- [ ] Prove skipped tiles preserve portal color/depth/visibility and receive neutral AO.
- [ ] Exercise multiple scopes collapsed into one visibility-island render domain.
- [ ] Sweep candidate cutoffs in portal-dense indoor/outdoor-root views and during portal approach,
      retreat, resize, and transition motion.
- [ ] Verify the accepted tile cutoff does not move when render scale changes.

### Acceptance Criteria

- Portal traversal, selected scopes/crossings, atlas packing, opaque draw census, and composition
  commands are byte-for-byte unchanged by AO tile eligibility.
- The camera/root domain always receives AO while enabled.
- Processed plus skipped count/area exactly equals the candidate secondary-tile census plus the
  unconditional root tile.
- Small skipped tiles perform no evaluation, blur, or composition fragments.
- The accepted threshold produces a real portal-dense GPU improvement beyond run-to-run spread and
  no visible portal-entry pop or material grounding discontinuity.

### Decisions and Course Corrections

- The complete proposed path was temporarily implemented at one decision owner: the atlas published
  an explicit root-domain ordinal, the renderer converted the CSS cutoff with render scale squared
  once at frame entry, and SAO compacted eligible metadata into its existing fixed staging array.
  Evaluation, both blurs, and composite consumed the same compact count; the pass returned one
  reused count/area record so diagnostics did not re-derive eligibility. A focused test placed the
  root at ordinal two and proved unconditional root retention, exact-threshold inclusion,
  order-preserving compaction, and count/area conservation.
- The planned maximum of 256 CSS pixels squared skipped zero of 19 tiles in the 1600x948
  portal-dense scene. Therefore 0, 16, and 64 are also no-ops for that distribution and did not
  deserve separate timing runs.
- A bounded probe at 4,096 CSS pixels squared—sixteen times the planned maximum—skipped six tiles
  but only 11,538 of 2,616,577 candidate pixels (0.44%). The four instanced draw calls remained, and
  mean SAO GPU time was 0.10404 ms versus the zero-cutoff eight-tap band of
  0.09914--0.10179 ms. The branch produced no improvement beyond spread and slightly regressed the
  sample.
- Phase 7 was rejected before motion/render-scale expansion because it failed its performance gate;
  higher cutoffs would trade increasingly visible portal-boundary discontinuity for a fragment
  saving the measured distribution does not support. All root-contract, tuning, conversion,
  compaction, work-record, and test changes from the branch were deleted. Existing diagnostics
  truthfully report every selected tile as processed. The unchecked motion/render-scale tasks are
  intentionally canceled, not implementation debt.

## Phase 8: Resteer and Prove the Combined System

### Purpose

The accepted SAO changes interact: lower resolution changes scaled tile rounding, clear deletion
relies on complete scaled coverage, and a smaller kernel changes noise exposed by lower resolution.
Tile skipping was deleted after failing its performance gate. Dry-run the final combination rather
than assuming individually accepted changes compose safely.

### Task Checklist

- [x] Re-audit every invariant used to delete clears at the accepted resolution and no tile cutoff.
- [x] Compare retained three-run original and final profiles for the complete SAO optimization set;
      compile-time resolution/kernel policy intentionally has no runtime A/B switch.
- [x] Repeat the B54A particle profile with the complete SAO set so independent wins are not hidden
      by a shifted bottleneck.
- [x] Compare flat, portal, transition, and render-scale screenshots against the original baseline,
      not merely against the immediately preceding phase.
- [x] Reconsider whether any remaining phase has become unnecessary, harmful, or too small to
      justify its permanent complexity.
- [x] Record combined CPU/GPU, particle upload, SAO pixel-area, draw-count, target-byte, and visual
      evidence.

### Acceptance Criteria

- Combined behavior passes all individual phase invariants and the original SAO visual matrix.
- The final improvement exceeds baseline measurement spread in the workloads each mechanism targets.
- No optimization exists only because diagnostics were designed around it.
- Any failed interaction is resolved by simplifying or reverting the least valuable mechanism,
  with the decision recorded here.

### Decisions and Course Corrections

- The accepted SAO combination is clear deletion, 0.5 linear scratch resolution, and eight taps;
  secondary-tile rejection does not survive. At 1600x948, the original cleared scale-1/12-tap
  portal-dense phase measured 0.35429--0.35755 ms SAO and owned 18.20 MB of scratch. The final
  combination measures 0.09914--0.10179 ms and owns 4.55 MB over the unchanged 19 tiles/2,616,577
  candidate pixels: approximately 71--72% less attributed GPU time and 75% fewer scratch bytes.
- Final-versus-original portal-dense frame 600 has normalized RMSE 0.000742. Exact clear-only A/B was
  pixel-identical; subsequent error is the accepted half-resolution/eight-tap AO change, localized
  to contact edges and thin geometry. No portal seam or stale scratch region appears.
- Three final B54A runs retained 409 visible emitter batches and 14,189--14,223 submitted particles.
  `particleRanges` measured 0.068--0.078 ms versus the original 2.69--3.30 ms, particle submission
  measured 0.216--0.228 ms versus the original 0.369--0.481 ms, and whole-frame work measured
  3.036--3.266 ms versus 6.540--8.188 ms. Following-record rewrites remained zero. Uploaded rows
  varied 1, 71, and 31 on actual birth/death/compaction frames; the rejected sparse-row branch and
  stable-following rewrite amplification remain absent.
- The final B54A SAO phase measured 0.0664--0.0688 ms for its one 921,600-pixel portal root tile;
  its 2.7648 MB allocation is exactly two half-resolution R8 textures over the 1280x720 atlas
  extent. Portal-dense target size remained 4.55 MB for the two scratch textures; portal compositor
  targets and draw census were unchanged by SAO tuning.
- The deferred DA55 close-candle comparison now passes visual inspection: candle/particle position,
  silhouette, sprite extent, and grounding align. Its close crop differs by 0.0127 RMSE because the
  accepted SAO sampling changes broad shading; the full image's larger asynchronous publication
  differences are not attributed to particle origin.
- Final lifecycle proof at render scale 1.5 passed AO on/off/on, portal/flat/portal/flat, target
  resize, transition supersession, handoff, inactive, and black cleanup with no assertions or
  console errors. The scaled interval tests and exact-tile shaders still prove complete writes at
  the accepted 0.5 scale, so clear deletion remains valid after the cutoff branch was removed.

## Phase 9: Cleanup, Documentation, and Final Verification

### Task Checklist

- [x] Remove temporary candidate switches, probes, screenshots, CPU profiles, and duplicated metrics.
- [x] Sweep obsolete “following records rewrite per frame,” neutral-clear, rejected resolution,
      rejected kernel, and rejected cutoff vocabulary from code, tests, diagnostics, and docs.
- [x] Keep only harness controls with a durable profiling or regression scenario.
- [x] Update `ARCHITECTURE_AUDIT.md` and the completed near-field SAO plan only where durable current
      architecture would otherwise be false; do not retroactively maintain unrelated stale notes.
- [x] Run `npm run format:check`.
- [x] Run `npm run check`.
- [x] Run `npm run lint` and treat every warning as an error.
- [x] Run focused and full `npm run test:ts` suites.
- [x] Run canonical real-GPU browser-harness particle, flat SAO, portal SAO, lifecycle, and transition
      captures.
- [x] Inspect `git diff --check` and the complete diff for temporary diagnostics or accidental
      cross-domain changes.

### Acceptance Criteria

- Production contracts contain only the accepted particle and SAO mechanisms.
- No alternate legacy particle-origin path, redundant SAO clear, or rejected tuning branch survives.
- Touched code remains pooled/stateless where frame-hot, typed, commented, and colocated with its
  owning decision.
- Documentation describes the final renderer architecture without benchmark numbers masquerading
  as permanent budgets.

### Decisions and Course Corrections

- Removed the now-permanently-zero following-record rewrite diagnostic after it served the Phase 2
  A/B. The visible following-emitter/particle census remains because it identifies the workload
  whose cost moved from particles to ranges.
- Removed candidate/processed/skipped AO metrics after the tile-cutoff branch was rejected. Actual
  SAO `tileCount` and `pixelCount` remain as the non-duplicated workload contract used beside GPU
  timing.
- Kept the compact particle/SAO harness report, fixed simulation/capture controls, AO lifecycle,
  mode cycle, transition lifecycle, explicit camera, render-scale, and real-GPU profiling controls;
  each has a named repeatable regression or performance scenario.
- Generalized the existing object applicator cleanly to `WebGL2DeviceStateApplicator`; no object
  compatibility alias or particle-local cache survives. Knip then identified `ParticleRangeOrigin`
  as unnecessarily exported, so cleanup narrowed it to its actual module ownership.
- The pre-commit quality audit fixed an aliased-state defect in that generalized applicator:
  texture targets have separate bindings, but sampler bindings are shared by texture unit. Array
  texture application now invalidates the same sampler mirror used by 2D textures, with a
  same-unit 2D/array transition regression test. The reusable smell was added to
  `docs/code-quality-audit-patterns.md`.
- The same audit gave scaled SAO bounds one owner shared by allocation and every shader stage,
  resolved the per-apply tuning once, collapsed mutually exclusive harness report booleans into one
  report-mode discriminant, and removed exact tuning choices from durable architecture prose.
- The final real-GPU default-radii B54A smoke retained 406 visible emitter batches and 13,950
  submitted particles, with 0.083 ms mean range collection and no browser errors. The corrected
  portal-dense run retained 19 SAO tiles/2,616,577 pixels, 4.55 MB scratch, and 0.0994 ms mean SAO.
  A combined render-scale-1.5 AO/mode/transition lifecycle run completed every resource assertion
  with no console errors.
- `format:check`, all TypeScript/Svelte checks, ESLint, Knip, Clippy, 116 focused tests, and the full
  245-file/1,844-test TypeScript suite pass. `git diff --check` is clean.

## Risks and Mitigations

| Risk                                                                             | Mitigation                                                                                                                                                                         |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production visibility diverges from draw-range visibility.                       | Route both through the existing previous-frame owner-selection helper, including its explicit sky case; do not add a second frustum, distance, or footprint decision.              |
| Empty first-frame selection delays resident particle advancement unexpectedly.   | Prove the existing one-frame draw-selection contract end to end and ensure suspension wiring adds no frame beyond the draw path's established latency.                             |
| Hidden suspension prevents dead owners from being removed.                       | Keep target-liveness validation before the visibility early exit and cover target loss while hidden with a runtime integration test.                                               |
| Sky particles suspend because they have no dynamic scene node.                   | Preserve `#particleRenderOwner`'s unconditional sky owner and test production advancement with an empty dynamic selection.                                                         |
| A range origin changes leave-behind particle semantics.                          | Use a discriminated record-owned/range-owned origin contract and test both authored `followsParent` states directly.                                                               |
| Moving an origin into ordinary float uniforms loses precision across landblocks. | Preserve the existing exact landblock-origin minus anchor-origin cancellation plus small local origin; never collapse it into one scene-space float vector.                        |
| The new range fields allocate every frame.                                       | Extend existing mutable pooled source/draw range records and copy scalar/vector lanes in place.                                                                                    |
| Portal routing drops or mismatches a range origin.                               | Make origin source part of the draw-range contract copied alongside base/count, and exercise ordinary, sky, and portal programs.                                                   |
| Per-range uniform calls replace one CPU bottleneck with WebGL binding overhead.  | Measure against the B54A 6,838-particle/527-emitter distribution; one tagged origin bind per resolved emitter draw is the intended upper bound.                                    |
| Sparse dirty tracking trades upload bandwidth for too many WebGL calls.          | Measure distinct dirty rows, contiguous runs, bytes, calls, and total submission time; select sparse runs only below an evidenced fragmentation/coverage boundary.                 |
| A shared state applicator silently desynchronizes after another pass writes GL.  | Retain explicit phase invalidation, enforce one writer per cached uniform location, and test transitions among independently owned passes rather than assuming global observation. |
| Particle state filtering duplicates the existing object cache.                   | Generalize and reuse the existing applicator only after Phase 2 evidence; reject the optimization rather than creating a second cache.                                             |
| Reordering to improve state locality changes alpha blending.                     | Preserve current range order. Additive-only regrouping remains out of scope without separate visual and timing evidence.                                                           |
| Removing clears exposes stale scratch pixels after atlas motion or resize.       | Prove full current-tile coverage at every accepted scale, sample only within current tile bounds, composite only current eligible tiles, and retain transition/motion screenshots. |
| Fractional resolution creates one-pixel gaps or overlaps.                        | Centralize CPU-side scaled rectangle math where testable and keep it identical to shader floor/end rules.                                                                          |
| Lower resolution changes apparent blur radius or creates portal-edge shimmer.    | Evaluate fixed and moving screenshots; retune only if the resolution candidate otherwise wins, and reject it if stability requires compensating complexity.                        |
| Smaller kernels reveal deterministic spiral patterns.                            | Test 12 then 8 before considering 6, with fixed-seed stills and motion captures; retain the smallest visually stable kernel, not the smallest runnable one.                        |
| A hard tile cutoff visibly pops as a portal changes size.                        | Size the cutoff from motion evidence; prefer a lower stateless cutoff, with a narrow stateless fade band only if proven necessary.                                                 |
| AO tile eligibility accidentally becomes portal visibility policy.               | Consume immutable atlas tile facts only inside SAO; assert visibility, atlas, and composition censuses are unchanged in cutoff A/Bs.                                               |
| Multiple small optimizations compound into unacceptable quality loss.            | Attribute them independently, then compare the final combination directly with the original baseline in the resteering phase.                                                      |
| Benchmark windows include streaming or warm-up drift.                            | Reset timing only after settled publication, alternate order, use at least three runs, normalize V8 samples per frame, and report spread with workload.                            |

## Definition of Done

- [x] Production particle advancement uses the same previous-frame owner visibility semantics as
      draw-range collection, including unconditional sky handling.
- [x] Hidden persistent emitters avoid spawn, expiry, origin-resolution, and record-mutation work;
      finite emitters retain analytic hidden reconciliation and dead hidden owners are removed.
- [x] No distance cadence, footprint LOD, or second particle visibility policy was introduced.
- [x] Parent-following origin work scales with visible following emitters rather than live particles.
- [x] Following-parent motion, leave-behind motion, portal routing, sky routing, slot compaction,
      suspension, and re-anchoring retain their proven behavior.
- [x] Stable following particles do not dirty record storage merely because their parent moved.
- [x] Residual particle record uploads were measured against logical dirty coverage; sparse upload
      was rejected because fewer bytes did not improve total submission.
- [x] Particle state filtering reuses the renderer's existing applicator vocabulary
      with explicit phase invalidation; no particle-local state cache exists.
- [x] Ordinary SAO frames execute no redundant scratch clears.
- [x] One evidenced SAO resolution scale and one evidenced sample count remain in shared tuning.
- [x] Secondary AO tile rejection was measured, rejected, and deleted; root and secondary domains
      receive the same SAO policy.
- [x] Portal visibility, atlas planning, and composition remain independent of AO fidelity.
- [x] Flat, portal, transition, lifecycle, render-scale, and context teardown verification passes.
- [x] Real-GPU profiles demonstrate improvements beyond baseline spread on their target workloads.
- [x] Fixed-pose and motion screenshots pass the original SAO quality matrix and particle parity bar.
- [x] Format, type checks, lint, tests, browser harnesses, and `git diff --check` pass.
- [x] Temporary diagnostics and rejected mechanisms are removed.

## Resolved Questions

- Half resolution and eight taps survived. No secondary-tile cutoff survived: even a 4,096 CSS-pixel
  squared probe removed only 0.44% of portal-dense pixels and did not improve GPU time.
- Motion testing was unnecessary after the cutoff failed its performance gate; no fade band or
  retained tile state was introduced.
- Birth/death/compaction dirty spans remain real but did not justify sparse uploads in the measured
  B54A distribution. The enclosing upload stays.
- Redundant particle state calls did justify reusing the existing cache after the origin cutover;
  the object owner was generalized rather than duplicated.
