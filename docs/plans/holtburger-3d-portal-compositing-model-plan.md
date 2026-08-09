# Holtburger 3D Portal Compositing Model Plan

Status: Phase 7 CPU contracts, combined propagation metadata, bounded crossing stream, attachment
command core, and WebGL2 target lifecycle proved; propagation/reduction shader wiring remains
Created: 2026-08-08

## Context and Boundaries

### Goal

Derive a provably correct and measurably efficient portal visibility and compositing model before
replacing the current renderer, including nested indoor/outdoor re-entry, opaque depth,
alpha-tested geometry, transparent objects, additive effects, and particles.

### Problem Statement

The current portal planner correctly distinguishes scope-local traversal from visibility-island
content ownership, but its execution schedule still assigns compositing ownership to render
domains. A render domain identifies content that can be prepared and batched together; it does not
identify one path-specific appearance of that content.

Field testing exposed the difference through progressively stronger counterexamples:

- outdoor -> indoor -> outdoor omitted the exterior beyond the return portal;
- outdoor -> indoor -> outdoor -> indoor allowed an unrelated indoor contribution to render through
  another portal aperture when same-layer domains shared one mask union;
- assigning unique domain labels repaired that sibling leak but let a nested indoor portal mint
  ownership outside its actual parent view;
- constraining a transition through the source domain's label failed when outdoor content appeared
  both as the root view and as a re-entered view under an indoor parent; and
- particles and transparent objects rendered while completing a parent contribution were later
  overwritten or clipped when a child portal reset depth and replaced stencil ownership.

The rejected prototype proved that no mapping from render-domain identity to one stencil label can
represent these cases. The same outdoor domain may simultaneously appear as the root, through an
indoor return, and through another nested path. Path provenance is compositing state even when all
appearances reuse one prepared content domain.

The current `renderIndoorNodes`/`renderExterior` callbacks also complete terrain, opaque objects,
transparent objects, and particles for one contribution before descendant contributions execute.
That boundary cannot correctly compose parent transparency across child views.

This plan therefore treats the current implementation as a candidate executor to model and reject,
not as the architecture to incrementally patch.

### In Scope

- Define a small, pure, finite portal scene model independent of WebGL, continuous polygon
  rasterization, production assets, and renderer object types.
- Define an independent per-pixel visibility and fragment-composition oracle.
- Model path-specific portal views separately from reusable render domains and prepared content.
- Model opaque depth, alpha testing, ordered alpha blending, additive blending, and particles.
- Encode the current planner/executor behavior sufficiently to reproduce known failures without a
  browser or GPU.
- Exhaustively enumerate bounded graphs and seeded larger scenarios, retaining minimized
  counterexamples.
- State proof obligations and algebraic invariants for traversal termination, opaque execution,
  transparent composition, label allocation, view merging, and optimization legality.
- Evaluate multiple executor families against the same oracle:
  - recursive offscreen view composition;
  - one-target stencil execution;
  - per-domain opaque layers;
  - cached exterior opaque composition; and
  - evidence-selected hybrids.
- Attach an exact structural cost vector to each modeled executor rather than guessing one scalar
  performance score.
- Use archive-backed complexity censuses and deterministic operation/allocation traces to choose a
  production architecture without noisy wall-clock timing.
- Cleanly replace the current domain-owned contribution schedule only after a candidate passes the
  model and cost gates.
- Split production rendering into the phases required for correct transparent objects and
  particles.
- Preserve batching and instance preparation within a content domain wherever the selected
  visibility schedule does not require another submission.

### Out of Scope

- Treating screenshots or one archive pose as proof of general portal correctness.
- Encoding floating-point triangle rasterization, exact WebGL edge rules, or GPU-driver behavior in
  the abstract model. Focused WebGL substrate fixtures remain responsible for that boundary.
- Reproducing the retail renderer's allocation strategy or 1999 architecture.
- Assuming retail behavior is correct without proving the relevant observable rule from the
  decompile and shipped content.
- Adopting weighted blended order-independent transparency as an exact result. It is an
  approximation and must not become the oracle.
- Adding depth peeling, per-pixel linked lists, or another expensive transparency mechanism before
  the model proves that ordinary ordered composition is insufficient.
- Adding a property-testing, SMT, theorem-prover, or graph library before the existing TypeScript
  test stack demonstrably cannot express the required bounded search.
- Changing EnvCell decoding, effective aperture construction, collision, movement traversal,
  camera residency, or scene-interest policy.
- Keeping the old and replacement production planners alive after the selected architecture has
  passed its cutover gate.
- Committing the rejected 2026-08-08 stencil-ownership prototype. Its useful facts belong in this
  plan and permanent counterexamples, not in production code.

## Ground Truth

### Current Production Contracts

- `apps/holtburger-3d/src/lib/game/renderer/portal-render-graph.ts`
  - owns scope-window traversal, render-domain discovery, SCC/layer assignment, exterior
    classification, contribution scheduling, and stencil-capacity preflight;
  - currently records mask edges between render nodes and groups ordinary execution by render
    layer;
  - is the source of the invalid domain-to-compositing-ownership collapse.
- `apps/holtburger-3d/src/lib/game/renderer/portal-view-window.ts`
  - owns exact NDC projection, intersection, normalized fragments, containment, and monotonic
    coverage admission;
  - already contains deterministic seeded property-style tests and should remain the continuous
    geometry boundary outside the finite compositor model.
- `apps/holtburger-3d/src/lib/game/renderer/portal-render-plan-validation.ts`
  - is the independent structural validation boundary for completed planner output;
  - must validate replacement view/submission facts without recreating scheduling policy.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-executor.ts`
  - mechanically executes the current completed plan;
  - currently writes masks and then calls complete-domain render callbacks, coupling opaque and
    transparent phases.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-substrate.ts`
  - owns fixed-function stencil, masked clear/reset, target, and presentation primitives;
  - remains the right place for backend operations selected by a proved abstract transition.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
  - prepares scene contributions per render node, merges contribution inputs, routes particles by
    owner, and performs terrain/opaque/weather/blended/particle submission;
  - currently completes all material phases inside each portal contribution callback.
- `apps/holtburger-3d/src/lib/game/renderer/object-rendering-policy.ts`
  - owns exact prepared-state compatibility and transparent run ordering;
  - replacement scheduling must reuse its material compatibility rather than inventing a portal-
    local batching policy.
- `apps/holtburger-3d/src/lib/game/renderer/particle-render-routing.ts`
  - owns particle-source routing and compatible batch recoalescing;
  - particle owner identity must remain independent from path-specific visibility submissions.
- `apps/holtburger-3d/src/lib/game/renderer/frame-instance-stream-arena.ts`
  - owns sequential prepared-view instance storage;
  - repeated visibility submissions must not accidentally repeat instance encoding or empty buffer
    resets;
  - provides the existing high-water/growth-diagnostic precedent for renderer-owned reusable
    storage. The portal culler needs a separate CPU scratch arena with the same explicit ownership,
    not shared instance storage or per-frame immutable collections.

### Existing Tests and Runtime Evidence

- `apps/holtburger-3d/src/lib/game/renderer/portal-view-window.test.ts`
  - supplies the existing seeded-test precedent and protects continuous clipping properties.
- `apps/holtburger-3d/src/lib/game/renderer/portal-render-graph.test.ts`
  - contains deterministic topology, cycle, scope-local traversal, near-plane, exterior, and
    capacity cases that should be translated into model fixtures before production replacement.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-executor.test.ts`
  - records the current mechanical execution contract; it becomes candidate-executor evidence,
    not the semantic oracle.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-hybrid-portal-executor-fixture.ts`
  - provides synthetic browser readback for indoor/outdoor composition.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-internal-portal-executor-fixture.ts`
  - provides nested internal mask, opaque, alpha-test, blended, and additive readback.
- `apps/holtburger-3d/scripts/browser-harness.mjs`
  - remains an optional later automation shell for exact browser readback and backend work-count
    verification after symbolic selection; screenshots are not compositor evidence.
- The 2026-08-08 rejected prototype is retained only as a decision record:
  - isolating same-layer domain submissions fixed one outdoor re-entry leak;
  - parent-constrained transitions fixed synthetic nested opaque confinement;
  - domain-derived parent ownership then failed outdoor re-entry because one domain had multiple
    simultaneous view identities;
  - parent particles remained incorrectly early even when opaque ownership was constrained; and
  - a WebGL stencil XOR write-mask experiment showed that arbitrary exact label transitions can be
    expressed in one mask draw, but a useful primitive cannot repair an invalid ownership model.

### Historical Plans and Documentation

- `docs/plans/holtburger-3d-scope-local-portal-traversal-plan.md`
  - correctly states that a render domain answers what may share ordinary depth while traversal
    state answers how a scope was reached;
  - also records the assumption that arrival ancestry need not be reachability state. This plan
    reopens that assumption for compositing ownership.
- `docs/plans/holtburger-3d-direct-portal-compositing-plan.md`
  - established the current one-target direct renderer and parent-constrained exterior suffix;
  - its exactly-once exterior and layer-union decisions are now hypotheses to test rather than
    accepted semantic invariants.
- `docs/plans/holtburger-3d-portal-frame-cpu-investigation.md`
  - proves that target CPU cost is sensitive to prepared-state sorting, repeated preparation,
    buffer resets, and actual WebGL submission;
  - found portal execution and opaque submission material on target hardware;
  - rejected speculative retained prepared-state caches that added validation/copying overhead;
  - requires exact work-count and matched-workload evidence for later optimization.
- `docs/portal_rendering.md`
  - documents the current accepted renderer and must not be updated to describe a candidate until
    the replacement passes the model and production gates.

### Authoritative Retail and Content Evidence

- `acclient-eor-source/acclient.h:13698-13890`
  - retains `portal_view_type` instances per EnvCell rather than one view per reusable content
    domain.
- `acclient-eor-source/acclient.c:441068-441237`
  - `PView::DrawCells` iterates accumulated cell views in multiple passes and flushes an alpha list
    separately from initial landscape work.
- `acclient-eor-source/acclient.c:441813-442040`
  - `PView::ClipPortals` and its callers propagate reached views through portals.
- `acclient-eor-source/acclient.c:441813-441942`, `364969-365337`, and `363285-363330`
  - portal traversal clips and copies a screen-space aperture, constructs eye-to-aperture edge
    planes, and tests target geometry against those edges plus the camera near plane. It does not
    install the entry portal plane as a target-cell clip plane, so target geometry may protrude in
    front of that plane.
- `acclient-eor-source/acclient.c:434698`
  - `D3DPolyRender::FlushAlphaList` is the deferred-alpha evidence to inspect before claiming a
    retail-equivalent transparent order.
- ACE, ACViewer, and shipped DAT content remain ground truth for topology and spatial data. They
  may support diagnostics and censuses, but permanent tests must not depend on unchecked runtime
  archives.

## North Stars

1. Visibility-path identity, reusable content identity, and GPU submission identity are different
   concepts.
2. Define correctness independently from every proposed optimization and backend.
3. A slow obvious reference is more valuable than another fast implementation with hidden
   assumptions.
4. Prepare each content domain once; submit it only as often as proved visibility requires.
5. Never fragment object or particle batches merely to make stencil bookkeeping convenient.
6. Transparent objects and particles are first-class compositing inputs, not a post-opaque patch.
7. Every merge optimization needs an executable equivalence property and a counterexample when its
   preconditions are removed.
8. Count CPU work, draw submissions, mask work, target traffic, and memory separately; do not hide
   them behind one guessed score.
9. Among correct candidates, code-derived complexity and deterministic CPU-owned work traces over
   real scenes decide the production architecture. No wall-clock timing or guessed scalar score.
10. Delete the old execution vocabulary after cutover so future debugging cannot fall back to the
    disproved domain-ownership model.

## Semantic Model

### Finite Screen and Visibility Inputs

The permanent model uses a small finite pixel set. A portal footprint is a bitset over those
pixels. Continuous projection and rasterization are outside this model and are represented by
already-resolved effective footprints.

Each modeled portal crossing contains:

- a source scope and target scope;
- a material-free effective footprint;
- a portal depth rank per covered pixel;
- incoming/reciprocal provenance;
- its indoor-depth-continuous, indoor-boundary, or exterior relationship; and
- a stable identity used only for diagnostics and minimization.

Each modeled content domain contains per-pixel fragments:

- opaque;
- alpha-tested, with an explicit pass/discard result;
- alpha-blended;
- additive; and
- particles classified as alpha-blended or additive.

Fragments use unique symbolic identities and small integer camera-depth ranks. Color arithmetic is
not required to detect composition order. Each fragment also names one submission identity and one
exact prepared-state batch identity. Multiple pixel samples may share a submission; compatible
adjacent submissions may share a batch. This prevents the cost model from quietly substituting
fragment counts for draw/run counts.

The symbolic planner retains conservative potential views independently from the oracle's
observable rays. Potential views count CPU and GPU work before opaque depth rejection; observable
rays determine the final image. A cost result may not use the smaller observable set to undercount
scheduled work.

### Path-Specific Portal Views

A portal view is one admitted appearance of a content domain through a specific parent view and
effective footprint. The same content domain may own multiple simultaneous views. A view retains:

- its parent view or root identity;
- the crossing that produced it;
- its path-constrained pixel coverage;
- the content domain it observes;
- its entry-depth boundary; and
- child views produced from that exact appearance.

Domain preparation may be deduplicated. View identity may not be deduplicated unless a proved
rewrite establishes observational equivalence.

### Reference Per-Pixel Result

For every pixel, the oracle returns:

- the nearest visible opaque or alpha-tested fragment identity;
- the exact far-to-near ordered sequence of alpha-blended fragment identities in front of that
  opaque result;
- the multiset of visible additive fragment identities in front of that opaque result; and
- the visibility paths that admitted each fragment.

Particles use the same symbolic result as equivalent transparent geometry. This makes particle
composition testable without simulation, billboarding, textures, or WebGL.

### Proof Obligations

The model and eventual production design must maintain a proof ledger for these obligations:

1. **Termination:** finite traversal stops after every reachable `(scope, pixel, entry-depth)` state
   has been admitted or subsumed.
2. **Path provenance:** every non-root view names the exact parent appearance that admitted it.
3. **Coverage:** a child view covers only pixels covered by its parent and effective aperture and
   not occluded before the portal boundary.
4. **Opaque composition:** completed opaque execution equals the oracle's nearest visible opaque
   fragment at every pixel.
5. **Transparent composition:** completed ordered alpha sequences equal the oracle exactly;
   additive results match as multisets.
6. **Particle equivalence:** replacing a modeled particle with an equivalent transparent fragment
   changes no output.
7. **Label alpha-renaming:** changing transient ownership labels without changing transitions
   changes no output.
8. **Disjoint sibling commutativity:** changing execution order for proved-disjoint sibling views
   changes no output.
9. **Safe fragmentation:** splitting one view footprint into disjoint fragments changes no output
   or content preparation.
10. **Safe union:** unioning candidate views changes no output only when the candidate executor's
    stated merge predicate holds.
11. **Preparation reuse:** reusing one prepared domain changes no fragment identity, ordering, or
    visibility fact.
12. **Backend refinement:** every WebGL operation sequence refines one modeled executor operation;
    the executor may not reconstruct topology or invent a route.

### Proof Strategy and Confidence Ladder

Correctness evidence is cumulative; a later layer does not erase the assumptions of an earlier
one:

1. **Hand-derived examples:** establish that the semantic vocabulary can express each known field
   failure and that the oracle result is independently understandable.
2. **Bounded exhaustive equivalence:** compare every candidate operation trace with the oracle for
   all accepted scenes inside a published finite bound. This finds small counterexamples but does
   not prove unbounded graphs.
3. **Algebraic executor argument:** define the recursive offscreen executor constructively, then
   prove by induction over its finite path-view tree that composing each completed child inside its
   parent footprint yields the oracle result. If valid topology cannot be normalized to that finite
   tree, the semantic model is incomplete and this proof stops.
4. **Optimization rewrite proofs:** derive shared-stencil, layer-cache, union, and submission-reuse
   candidates as transformations of a proved executor. Each rewrite states preconditions, preserves
   the symbolic frame result, preserves preparation identity, and publishes a counterexample when
   a precondition is removed.
5. **Backend refinement tests:** map each abstract operation to typed WebGL2 commands and verify
   focused pixel readback and operation counts. These tests cover raster and API behavior; they do
   not strengthen graph-level claims.

The proof ledger records, for every accepted executor or rewrite, the theorem/property, assumptions,
evidence kind, finite bounds when applicable, and smallest known violating case. “Correct” without
that ledger entry is not a selectable architecture.

## Structural Cost Model

Correct candidates emit an exact cost vector rather than a single weighted score:

- topology/view work items;
- prepared content domains;
- repeated domain preparations;
- visibility submissions per domain;
- opaque draw submissions and instance runs;
- ordered transparent runs;
- particle uploads and draw submissions;
- mask geometry draws;
- depth/color reset pixels;
- fullscreen or scissored composite draws;
- framebuffer changes;
- offscreen target count and bytes; and
- estimated attachment read/write pixels.

The model compares candidates by Pareto dominance without performance weights. Archive distributions
later reveal which surviving tradeoffs occur on real golden paths and pathological tails. A
candidate is not accepted because a guessed formula says that memory bandwidth is cheaper than
draw submission; non-dominated constant-factor tradeoffs remain explicitly unresolved.

## Candidate Executor Families

### Recursive Offscreen Reference

Render each portal view into a logical child surface, recursively compose descendants, then compose
the completed child into its parent aperture before parent transparency. A target pool may reuse
storage by active nesting depth. This is the preferred initial executable reference because
ownership and unwind are explicit, even if it is not the final production strategy.

### Shared Color/Depth/Stencil Target

Use transient path-view labels, forward opaque execution, and a reverse transparent unwind. Exact
parent-to-child and child-to-parent label transitions must be modeled independently from label
allocation. The one-draw XOR/`INVERT` WebGL primitive remains a candidate substrate refinement,
not a semantic premise.

### Per-Domain Opaque Layers

Render each reached domain's opaque result once for the common camera into a texture layer or
scissored target, then compose path-specific appearances into the final target. This trades target
memory and texture traffic for fewer repeated domain submissions. Transparent fragments remain
deferred against the final composed opaque depth unless another exact representation is proved.

### Cached Exterior Opaque Layer

Treat expensive same-camera exterior opaque content as a special measured cache candidate. Root and
re-entered outdoor views composite its color and depth through path-specific masks, while weather,
transparent objects, and particles remain path-aware deferred work. This candidate must prove that
sampling and writing cached depth preserves the oracle and passes target browser/GPU portability.

### Exterior-Only Cache Selection

The first production cut may cache only the explicitly identified exterior domain, and only when
that domain is one authored scope with multiple potential appearances and opaque work. Other
domains execute directly even if a synthetic cost comparison would cache them. The exterior-cache
fact must be computed once from the completed view plan and materialized in its contract;
executors and validators do not re-derive it.

## Phased Implementation

## Phase 0: Freeze Evidence and Counterexamples

### Deliverables

- A concise rejected-prototype decision record in this plan.
- Named minimal scenario fixtures for every reported failure.
- Symbolic work-shape and exact-cost baselines; real-scene complexity and operation tracing are
  deferred until a production-shaped planner exists.

### Task Checklist

- [x] Record the exact topology, expected visibility path, and observed failure for:
  - outdoor -> indoor -> outdoor;
  - outdoor -> indoor -> indoor;
  - outdoor -> indoor -> outdoor -> indoor;
  - indoor -> outdoor -> indoor;
  - a multi-parent/diamond target;
  - parent opaque geometry occluding a child aperture;
  - parent alpha transparency crossing a child footprint; and
  - parent alpha/additive particles crossing a child footprint.
- [x] Preserve each failure as a serialized symbolic fixture or generated minimized counterexample;
      screenshots and archive assets are not permanent test dependencies.
- [x] Capture symbolic portal view, contribution, draw/run, upload, mask/composite, target, byte,
      attachment-pixel, topology-work, and ownership-label facts without timing weights.
- [x] Confirm the reverted branch contains no rejected renderer implementation.

### Acceptance Criteria

- Every known failure has a renderer-independent expected statement.
- At least one minimal case distinguishes domain identity from view identity.
- At least one case distinguishes opaque correctness from transparent correctness.
- Any later real-scene traces use matched topology, camera, interest, viewport, and tuning facts;
  they do not substitute for symbolic correctness.

### Decisions and Course Corrections

- 2026-08-08: Reverted the uncommitted stencil-ownership prototype rather than committing a known
  incorrect planner. `ACE` and `ACViewer` working-tree state was not modified.
- 2026-08-08: The current portal graph, executor, and view-window baseline remains green at 64 tests.
  A fresh SwiftShader production-content capture for outdoor `0xda55ffff` completed with two portal
  nodes, one mask, one exterior submission, two contribution-set uses, no repeated domain use, and
  five particle emitters producing 45 live particles. This is work-shape evidence, not a final
  performance sample: the shortened three-second settle/two-second measurement run is deliberately
  not compared to the historical five-sample target-hardware campaign.
- 2026-08-08: The historical harness command's `--output` argument no longer exists. Used the live
  harness contract directly and retained the command/output in the execution record rather than
  reintroducing a diagnostics-only compatibility flag.
- 2026-08-08: Retail `PView::DrawCells` retains multiple views per EnvCell and performs landscape,
  cell, object, and alpha work in distinct passes. This supports path-view identity and deferred
  alpha as semantic inputs, without requiring the replacement to copy retail's architecture.
- 2026-08-08 debt: Named renderer-independent minimal fixtures for the field failures move into
  Phases 1-3, where they can be serialized and minimized instead of remaining prose-only Phase 0
  artifacts. Representative indoor/hybrid operation traces remain a Phase 9 candidate comparison
  gate; collecting them before any candidate exists would not discriminate an architecture.
- 2026-08-08 course correction: The one fresh SwiftShader work-shape capture above was premature
  and is not correctness or architecture-selection evidence. All work through Resteering Gate B is
  symbolic and asset-independent. Do not run further harness, SwiftShader, screenshot, browser, or
  GPU gates until a symbolic executor has been selected; none were resumed during model selection.
  Later backend refinement uses exact framebuffer readback on target browsers, not screenshot
  comparison or SwiftShader architecture evidence.

## Phase 1: Define the Finite Portal Semantics

### Deliverables

- `apps/holtburger-3d/src/lib/game/renderer/portal-model.ts`
- `apps/holtburger-3d/src/lib/game/renderer/portal-model.test.ts`
- Small constructors for finite pixels, footprints, crossings, domains, and symbolic fragments.

### Task Checklist

- [x] Define branded model identities for scopes, domains, views, crossings, pixels, and fragments.
- [x] Represent footprints as immutable bounded bitsets with union, intersection, difference,
      containment, overlap, and cardinality.
- [x] Represent camera depth with ordered integer ranks and reject ambiguous equal-depth inputs until
      an explicit tie policy is modeled.
- [x] Define opaque, alpha-test, alpha-blended, additive, and particle fragment variants.
- [x] Define exact symbolic frame results and equality.
- [x] Keep production renderer, WebGL, vector, matrix, asset, and scene-graph types out of the model.
- [x] Add validation failures for malformed portals, out-of-range pixels, impossible depth
      intervals, repeated identities, and unowned fragments.

### Acceptance Criteria

- Model scenes are deterministic, serializable, and produce useful assertion diffs.
- Every field has a named oracle, planner, executor, minimizer, or cost-model consumer.
- The model contains no browser, GPU, archive, clock, or floating-point dependency.

### Decisions and Course Corrections

- Start with the existing Vitest/TypeScript stack and the seeded-random pattern already used by
  `portal-view-window.test.ts`. Add no property-testing dependency unless minimization or generation
  complexity proves the local implementation inadequate.
- 2026-08-08: Completed the finite model with branded scope, domain, crossing, view, fragment,
  submission, and batch identities; immutable JSON-safe bitset footprints; explicit per-pixel
  portal depths; all five fragment classes; reciprocal validation; and local tie rejection.
- 2026-08-08 course correction: Fragments belong to authored scopes while domains own their
  preparation collection. Putting fragments directly in an unqualified domain erased the scope
  ray segment needed to decide whether a portal exit clips them.
- 2026-08-08 course correction: Added submission and batch identities before cost comparison.
  Fragment count is not draw count, and a model without prepared-state compatibility could not
  protect within-domain batching.

## Phase 2: Implement the Independent Ray/Fragment Oracle

### Deliverables

- `apps/holtburger-3d/src/lib/game/renderer/portal-reference-compositor.ts`
- Colocated oracle tests for hand-derived scenes.
- A documented termination measure for finite traversal.

### Task Checklist

- [x] Enumerate path-specific views per pixel from the root scope, portal footprint, portal depth,
      incoming crossing, and current depth interval.
- [x] Preserve repeated domain appearances when their path or entry-depth interval differs.
- [x] Suppress only the immediate reciprocal/shared physical aperture proven by the input.
- [x] Compute the visible opaque fragment and exact transparent/additive results independently for
      each pixel.
- [x] Emit path provenance beside fragment results for counterexample diagnosis.
- [x] Prove termination over the finite state space or fail loudly when an input violates the
      model's monotonic-depth assumptions.

### Acceptance Criteria

- The oracle produces hand-derived results for all Phase 0 scenario fixtures.
- Outdoor re-entry creates a distinct outdoor view even though it reuses the outdoor content
  domain.
- Parent transparency and particles remain visible over descendant results exactly when their
  camera-depth ranks require it.
- The oracle does not consume or imitate the production planner's layers, SCCs, labels, or
  contribution schedule.

### Decisions and Course Corrections

- The oracle is intentionally slow. Any optimization shared with a candidate executor requires an
  independent equivalence argument before it enters the oracle.
- 2026-08-08: Completed the per-pixel ray oracle. The nearest passing opaque fragment or deeper
  portal plane ends each scope segment; portal depth increases strictly along the ray; target
  fragments may protrude in front of their entry plane; and all surviving alpha is globally sorted
  after final opaque resolution.
- 2026-08-08: The oracle preserves root and repeated-domain appearances as distinct paths, rejects
  unresolved ordered-alpha ties, deduplicates the same physical fragment reached by multiple paths,
  and records exact provenance.
- 2026-08-08: Derived a per-scope deferred visibility envelope: at each pixel, union every admitted
  scope appearance by retaining its farthest exit depth. A fragment is visible when it is inside
  that envelope, before its exit, and before final opaque depth. This reduction reproduces alpha,
  additive, and particle results over all 3,980 bounded scenes and permits one upload/submission
  stream rather than one stream per path view.

## Phase 3: Model the Current Executor and Reproduce Its Failures

### Deliverables

- `apps/holtburger-3d/src/lib/game/renderer/portal-abstract-executor.ts`
- A current-domain-layer candidate matching production semantics closely enough to fail the known
  cases.
- Minimized permanent counterexamples.

### Task Checklist

- [x] Model stencil labels, mask writes, color/depth resets, opaque draws, transparent draws, and
      particle draws as pure state transitions over finite pixels.
- [x] Model the current domain-owned layer union and complete-domain callback ordering.
- [x] Compare candidate output to the oracle after every complete frame.
- [x] Preserve the smallest counterexample for each distinct invariant failure.
- [x] Add an operation trace that explains the first divergent pixel and transition.

### Acceptance Criteria

- The abstract current executor reproduces the reported sibling leak, outdoor re-entry ownership
  loss, and parent-particle clipping without WebGL.
- Tests fail if a counterexample is weakened until it no longer distinguishes the algorithms.
- Failure traces identify the first incorrect ownership/depth/fragment-order operation.

### Decisions and Course Corrections

- This phase does not patch production. Its job is to prove that the model can convict an
  implementation we already know is wrong.
- 2026-08-08: The abstract domain-owned executor now reproduces missing outdoor re-entry, sky before
  the final alternating indoor view, and overwritten parent particles/transparency. Its operation
  trace identifies the first repeated-domain rejection or parent-deferred overwrite, while a
  terminal single-domain control remains equivalent.
- 2026-08-08 debt: The rejected executor models the disproved ownership and complete-domain
  semantics, not every fixed-function stencil call in current production. Exact label replay and
  reset costs remain a Phase 5 shared-stencil candidate concern; duplicating production call order
  here would not strengthen the ownership counterexample.

## Phase 4: Bounded Search and Metamorphic Verification

### Deliverables

- `apps/holtburger-3d/src/lib/game/renderer/portal-model-enumerator.ts`
- Deterministic bounded enumeration and seeded larger-scenario generation.
- Counterexample shrinking or a documented minimal enumeration order.
- A proof-ledger section in this plan recording satisfied and rejected obligations.

### Task Checklist

- [x] Exhaustively enumerate small rooted directed graphs, portal footprints, depth ranks, and
      fragment classes within an explicit CI-safe bound.
- [x] Partition invalid/nonphysical inputs from valid scenarios with one failure reason per clause.
- [x] Add metamorphic properties for identity renaming, disjoint sibling reordering, safe footprint
      splitting, unreachable-cycle insertion, subsumed-path insertion, particle/transparent
      equivalence, and label alpha-renaming.
- [x] Seed larger cyclic, diamond, alternating indoor/outdoor, overlapping-projection, and
      transparency-heavy cases.
- [ ] Record rejected-input counts and maximum candidate operation counts. Scenario, topology,
      path-depth, view, and ray-segment counts are already recorded; these remaining counts complete
      the auditable workload.
- [x] Evaluate whether a bounded solver or theorem prover adds evidence beyond the executable
      search. If selected, document the exact unbounded theorem it proves and keep the executable
      model canonical for developers.

### Acceptance Criteria

- Every retained candidate is equivalent to the oracle over the complete bounded corpus.
- Deliberately removing any parent/path constraint produces a minimized counterexample.
- Seeded generation is reproducible and prints a replayable serialized scenario on failure.
- CI runtime is bounded and reported rather than hidden behind an arbitrary case count.

### Decisions and Course Corrections

- Bounded exhaustive verification is not described as a universal formal proof. Universal claims
  require an induction/algebraic argument in the proof ledger or a machine-checked theorem with
  explicit assumptions.
- 2026-08-08: The published CI-safe bound currently exhausts 3,980 one-pixel scenes: every directed
  graph through three scopes and three crossings, all crossing-depth permutations, eight canonical
  domain partitions across scope counts one through three, and opaque, alpha-test, alpha-blended,
  additive, and particle variants. The largest result has path depth three, four observable views,
  and four observable ray segments.
- 2026-08-08: The constructive recursive/deferred executor is oracle-equivalent over the complete
  bounded corpus. The per-scope visibility-envelope reduction is independently equivalent over the
  same corpus.
- 2026-08-08 course correction: Added a fragment-independent potential-view planner. Costing from
  oracle-visible rays undercounted masks and submissions that the CPU must schedule before GPU
  opaque depth rejects them.
- 2026-08-08: Added graph-order/identity renaming, disjoint-sibling reorder, footprint split,
  unreachable-cycle, subsumed-path, particle-equivalence, and label-renaming properties. The
  larger deterministic corpus contains 128 six-scope, ten-crossing cyclic/re-entry scenes at seed
  `0x5eedcafe`.
- 2026-08-08: Path-depth labels were rejected by a minimized symbolic counterexample. A nearer
  sibling owned the pixel, but a grandchild of the rejected farther sibling accepted the nearer
  sibling's identical depth label as its parent. Depth equality preserves nesting level, not path
  ancestry.
- 2026-08-08: Exact transient view labels repair that ancestry leak. Labels are frame-plan
  allocations, not permanent portal, scope, or domain IDs. A conflict-color allocator reuses a
  label only across disjoint view footprints; the end-to-end executor remains oracle-equivalent
  over all 3,980 bounded and 128 seeded scenes.
- 2026-08-08 debt: The generator records accepted scenarios but does not yet tally each rejected
  validation clause or maximum candidate operation trace. No formal-method dependency is justified:
  the core opaque and deferred obligations now have direct induction/algebraic arguments plus
  executable counterexamples for weakened preconditions.

## Resteering Gate A: Validate the Semantic Model

Before optimizing a renderer, review:

- whether the oracle's traversal assumptions hold for AC portal geometry;
- whether reverse view order is sufficient for all modeled transparency or whether cross-view
  camera-depth sorting is required;
- whether overlapping path footprints require separate view fragments;
- whether the finite model distinguishes every field failure reported in production; and
- whether any oracle rule was copied from the candidate it is supposed to judge.

Do not proceed if particles or transparent objects require an unstated portal-separation
assumption. Prove that assumption from content bounds/topology or choose an executor whose ordered
fragment semantics does not need it.

### Gate A Result

- Passed without a sibling-disjointness assumption. Overlapping views require distinct transient
  ownership labels; disjoint views may reuse a label as a proved optimization.
- Ordered alpha is globally camera-depth sorted after opaque ownership resolves. Additive work is a
  deterministic multiset. Particles use the same alpha/additive contract, so no reverse-ancestry or
  portal-separation assumption enters deferred composition.
- The oracle state is the path-specific scope occurrence plus pixel and monotonically increasing
  entry depth. Immediate reciprocal suppression prevents the physical aperture return; increasing
  depth supplies termination for all other cycles.
- The oracle has no label, target, layer, SCC, preparation, or batch concept. Candidate scheduling
  therefore remains independently falsifiable.
- The protruding-target rule is retail evidence, not a candidate-derived convenience:
  `PView::ClipPortals` supplies a screen window (`acclient.c:441813-441942`),
  `Render::copy_view` derives only its eye-to-edge planes (`acclient.c:364969-365337`), and
  `Render::viewconeCheck` adds only the camera near plane (`acclient.c:363285-363330`). Rejecting
  target fragments against their entry depth would diverge from retail and invalidate the proved
  per-scope envelope reduction; the oracle carries the greppable `RETAIL QUIRK` marker.

## Phase 5: Compare Correct Executor Families and Exact Costs

### Deliverables

- Pure candidate executors for recursive targets, shared stencil, per-domain opaque layers, and
  exterior-cache/hybrid strategies.
- One exact structural cost vector per candidate and scenario.
- A Pareto report over bounded and archive-derived scenario shapes.

### Task Checklist

- [x] Implement the recursive offscreen executor first as the clearest constructive reference.
- [x] Implement a path-label shared-target candidate with forward opaque and correct transparent
      scheduling.
- [x] Implement and reject an unconstrained per-domain opaque-layer candidate that prepares and
      draws domain opaque content once, then composes view appearances.
- [x] Implement cached-exterior and data-driven hybrid candidates only after the simpler candidates
      expose their dominant costs.
- [x] Encode each view-merge optimization as a named rewrite with explicit preconditions.
- [x] Prove every rewrite against the oracle and against an intentionally missing-precondition
      counterexample.
- [x] Count preparation, submissions, runs, uploads, masks, composites, FBO changes, pixels, and
      bytes without assigning guessed weights.
- [ ] Run an archive topology census that projects production plan shapes into model scenarios
      without making archives permanent test inputs.

### Acceptance Criteria

- At least one correct candidate handles every bounded scenario and all Phase 0 fixtures.
- Candidate reports show exactly where extra targets reduce CPU preparation or draw submissions.
- No candidate claims fewer domain submissions by silently dropping a path-specific appearance.
- No candidate fragments within-domain batches unless its visibility submission boundary proves
  the split unavoidable.

### Decisions and Course Corrections

- More targets are acceptable when deterministic traces prove fewer CPU-owned preparation or draw
  operations and the added memory/bandwidth work remains explicit. One target is not a north star.
- Per-domain preparation once is a desired invariant. Per-domain submission once is a candidate
  optimization and must be proved for the selected view set.
- 2026-08-08: The end-to-end shared-target candidate derives admitted view coverage from successful
  exact-owner transitions, derives scope envelopes from that coverage, and composes opaque,
  alpha-tested, globally ordered alpha, additive, and particle work without consulting the oracle.
  It matches the oracle over both published corpora and the multi-pixel metamorphic fixtures.
- 2026-08-08: Disjoint views may share a label. Compatible opaque batches are counted once per
  `(batch, label)` rather than once per view, so ordinary non-overlapping siblings do not split a
  within-domain batch. Overlapping views split only when exact ownership requires it.
- 2026-08-08: The first cache model used a generic draw-count rule for repeated single-scope opaque
  domains. On 2026-08-09 Gate B deliberately narrowed that policy to the explicitly identified
  exterior because it is the dominant expensive domain and general caching adds policy and target
  complexity before production evidence justifies it. A multi-scope exterior remains invalid
  because one nearest layer erases scope visibility surfaces required by re-entry.
- 2026-08-08 debt: The old archive census utility was intentionally removed with its completed
  integration phase. A renderer-independent archive/topology projection census must be restored or
  replaced before production architecture selection to calibrate common label counts, exterior
  reuse, and representative workload vectors. This does not gate semantic correctness, but it does
  gate every CPU and production-selection claim.

## Resteering Gate B: Select Semantically Valid Work Candidates

Choose the smallest correct candidate on the measured Pareto frontier. Record:

- the exact model theorem/properties it satisfies;
- its merge rules and counterexamples;
- target count and memory at representative resolutions;
- domain preparation and submission counts on archive workloads;
- expected opaque, transparent, particle, mask, and composite draw counts;
- unsupported graph shapes, if any, and whether the plan can fail before rendering; and
- why each rejected candidate loses on correctness, CPU, draw calls, memory, bandwidth, or
  complexity.

Do not carry multiple production algorithms past this gate unless a hybrid's selection rule is
itself part of the proved plan contract.

### Selected Symbolic Candidate: Bounded View Ownership With an Exterior-Only Cache

Gate B selects one semantic candidate for real-scene complexity and work tracing, not a production
winner:

1. The CPU plans path-specific potential views independently from reusable content domains and
   prepared batches.
2. A deterministic conflict coloring assigns transient uint8 ownership labels. Two views may share
   a label only when their clipped footprints are disjoint. Portal transitions compare the complete
   parent label, apply the parent opaque-depth/portal-plane gate, reset child depth, and write the
   child's label. Same-depth candidates execute nearest portal first at each pixel.
3. Opaque and alpha-tested submissions group by `(content domain, ownership label, prepared batch)`.
   Disjoint sibling views therefore retain one compatible domain batch. An overlap creates another
   submission only when sharing would make ownership ambiguous.
4. The explicitly identified exterior domain may render opaque content once to a color/depth cache
   and composite through every admitted appearance when it is one authored scope with multiple
   potential appearances and opaque work. No other domain is cache-eligible in the first cut.
   Multi-scope domains are never collapsed into one cache without a new safe-union proof.
5. Successful opaque transitions produce observable view coverage. Every authored scope reduces
   its appearances to one 32-bit farthest-exit envelope per covered pixel. After opaque completion,
   alpha is globally depth sorted; additive and particle blend work uses the same envelope and final
   opaque depth. Each physical submission and particle upload occurs once, with adjacent compatible
   ordered runs preserved.
6. The planner admits only complete path-depth frontiers. Three independent budgets bound path
   depth, cumulative potential-view count, and conflict-colored ownership labels. If the next
   frontier exceeds any budget, every view in that frontier and all descendants are omitted. The
   retained scopes finish normally; an omitted child portal does not clip their opaque, transparent,
   additive, or particle work. The plan reports a typed reason and exact first omitted depth before
   target allocation or GPU mutation.
7. Ownership labels are uint8, so the hard label budget is at most 256. There is no recursive or
   partially admitted fallback. Production frontier enumeration must stop incrementally rather than
   first constructing arbitrarily deep rejected work; the current pure selector consumes a complete
   symbolic potential plan so its policy remains independently testable.

### Proof Ledger

- **Opaque induction:** before a child transition, each covered pixel's label uniquely identifies
  the admitted parent view because equal labels imply disjoint footprints. Parent equality prevents
  cross-branch promotion; the portal-plane depth comparison chooses the same next event as the ray
  oracle. Reset plus the target scope's nearest passing opaque establishes the invariant for the
  child. Path length orders parents before children, and portal depth orders competing siblings.
- **Deferred reduction:** for fragment depth `d` in scope `s`, visibility is existential over
  admitted appearances: `exists exit: d < exit`. The union is exactly `d < max(exit)`, with an
  unbounded occurrence represented explicitly. Final opaque depth is a second independent upper
  bound. This applies identically to alpha objects, additive effects, weather, and particles.
- **Disjoint-label rewrite:** descendants inherit a subset of every ancestor footprint. Therefore
  two disjoint views have disjoint descendant pixels, and reusing their label cannot satisfy a
  transition on the wrong branch.
- **Exterior cache rewrite:** within one camera frame, every appearance of the one authored exterior
  scope samples the same opaque fragments and camera depths. Exact aperture ownership supplies
  clipping;
  copying cached color and depth is observationally equal to redrawing that scope. The rewrite is
  invalid for a multi-scope exterior because one nearest layer can discard a farther scope that a
  different portal path must reveal. Limiting the rewrite to exterior is a policy restriction, not
  a claim that no other cache can be correct.
- **Complete-frontier truncation:** every retained path has length at most the accepted frontier and
  every view at that depth is either retained or omitted together. Removing outgoing crossings from
  the frontier scopes yields the depth-capped ray oracle: local opaque selects normally, deferred
  fragments use an unbounded local exit, and no omitted portal aperture becomes a hole. A
  257-overlapping-view fixture proves uint8 rejection at depth one; independent path-depth and
  potential-view fixtures prove the other two typed routes. Reordering graph storage preserves the
  selected frontier and output.

The executable ledger covers 3,980 exhaustive scenes, two independent 128-scene seeded corpora,
the same exhaustive corpus under varied constrained budgets, and multi-pixel
disjoint/reordered/split-footprint fixtures. Deliberately weakened models retain permanent minimized
counterexamples for domain ownership, discarded parent deferred work, missing parent-depth gating,
and depth-only label ancestry.

### Exact Cost Contract

No scalar score is used. Each frame reports content preparations, repeated preparations,
visibility submissions, opaque batch draws, ordered alpha/additive runs, particle uploads/draws,
mask draws, reset pixels, composites, framebuffer changes, target count/bytes, visibility
attachment count/bytes, attachment traffic, topology work, and ownership-label count.

These are structural hypotheses, not CPU timings. They can disprove a candidate that performs
strictly more relevant work. When candidates are non-dominated, the plan preserves each work
dimension and records the unresolved constant-factor trade rather than collapsing it into a guessed
runtime score.

The selected common path has one RGBA8 plus DEPTH24_STENCIL8 main target (8 bytes/pixel), one logical
32-bit scope-envelope plane per reached scope (4 bytes/pixel before atlas/scissor packing), and at
most one additional 8-byte/pixel color/depth target for exterior opaque content. At 1920x1080 this
is 15.82 MiB for the main target, 7.91 MiB per uncompressed full-screen scope plane, and 15.82 MiB
for the exterior cache. Exact portal footprints and pooling may reduce committed pixels later; the
symbolic comparison conservatively does not claim those savings.

For two disjoint sibling views in one indoor domain, conflict coloring uses two total labels (root
plus the shared child label) and one compatible opaque batch, not one batch per sibling. A repeated
one-batch exterior is still the only selected cache candidate: it costs one opaque batch draw plus
appearance composites rather than replaying the exterior batch. This is an explicit first-cut
policy based on exterior cost, not a scalar claim that the cache wins on every GPU metric.

Rejected families:

- Domain-owned labels and domain-complete callbacks are incorrect under re-entry and parent
  deferred composition.
- Depth-only labels are smaller but incorrect when a rejected sibling has descendants.
- Full recursive offscreen composition is correct but pays view replay, composites, framebuffer
  changes, and depth-stack storage. It is retained as a reference/cost candidate, not a production
  fallback; budget exhaustion stops at the deepest complete frontier instead.
- Shared-stencil deferred replay avoids the scope-envelope attachment but fragments ordered
  transparent and particle runs by path visibility and repeats masks/resets. It loses the
  draw-submission and preparation-work priority to the envelope schedule.
- Generic per-domain opaque caching is deferred. Empty, cheap, and multi-scope domains either add
  draws/memory or are incorrect, and production data has not justified policy beyond the exterior.
- Integer ownership textures or scope-layer ping-pong can raise the ownership-identity ceiling, but
  do not improve the selected semantics. Their extra attachments, clears, sampling, and scheduling
  complexity are unjustified when approaching 256 simultaneous conflicting views is already a
  work-budget failure. The symbolic harness remains capable of evaluating that family if evidence
  changes.

### Gate B CPU-Work Evidence Blocking Cutover

- Recreate a non-rendering archive/topology projection census for common/maximum conflict colors,
  potential-view counts, path depth, exterior-cache reuse, and envelope coverage. No SwiftShader,
  browser, or screenshot evidence participates in this semantic gate.
- Trace exact CPU-owned operations over actual archive topology and deterministic camera paths
  before committing to the candidate planner shape. The historical `0xda55ffff` profiles show why
  the trace must cover planning, contribution preparation, run formation, and submission
  preparation rather than treating planner complexity as the entire cost.
- Refine the logical 32-bit scope envelope and cached depth transfer into WebGL2 formats only after
  the production planner contract exists. Those focused backend tests may falsify a substrate
  choice, not the compositor semantics.
- Record rejected-input clause counts and maximum operation traces in the bounded generator.

## Phase 6: Analyze and Trace the Production-Shaped Visibility Planner

Status: complete with a structural Gate C rejection; candidate-specific work stopped at the first
decisive CPU/draw-work counterexample.

### Deliverables

- Replacement planner contracts colocating path provenance, view coverage, content domain, merge
  eligibility, and selected execution strategy.
- A deterministic breadth-first frontier enumerator that bounds its own topology work instead of
  applying budgets after constructing the complete rejected graph.
- A truncation contract that reports the first omitted depth and a sufficient lower bound for the
  exceeded capacity without requiring exact enumeration of rejected work.
- An opt-in non-rendering real-scene workload runner using runtime archive topology, continuous
  portal projection, and deterministic camera poses/traces. It emits traces and disposable
  reports; permanent tests do not depend on unchecked archives.
- A named complexity derivation for current and candidate planning, coloring, envelope reduction,
  preparation, ordering, and submission scheduling.
- Matched current-versus-candidate operation/allocation traces over the same topology, camera,
  tuning, and scene-interest inputs.
- Independent plan validation.
- Production planner tests generated from model counterexamples.

The evaluator is a browser-free CLI process. An archive adapter may use `holtburger-content` to emit
normalized topology/camera inputs, but the exact app-local TypeScript planner and dry scheduler
consume them; no Rust or diagnostic copy of the planning algorithm is allowed. The evaluator may
use the TypeScript test/build toolchain as its execution shell, but it must not start Tauri, the
browser harness, WebGL, or a frame loop. Generated archive inputs and reports remain disposable.

### Complexity Ledger

The ledger uses sums over actual attempted work rather than treating an output cardinality as a
proxy for its construction cost. Topology-revision variables are `S` scopes, `X` directed
crossings, `A` unique authored aperture vertices/indices, `H` duplicate-aperture scalar
comparisons, and `G` canonical outgoing-order comparisons. Per-camera variables are `W` outgoing
crossing records visited, `T` crossings whose visibility is attempted, `L` path-identity
comparisons, `F_i` inherited/projected window fragments, `V_i` polygon vertices, `P` checked
projection primitives, `C` checked conflict primitives, `N` completed path views, and `d` admitted
path depth. Dry-schedule variables are `D` prepared content domains, `Y` selected physical scopes,
`B` selected physical opaque batches, `J` ownership-destination-expanded opaque inputs, `R`
physical transparent/additive submissions, `K` particle sources, `I` packed particle instances,
and `U` projected GPU submissions.

Current planner, derived from the production implementation:

- Retained topology indexing is `O(S + X)` time and space per topology revision. Immutable aperture
  validation and canonical outgoing-crossing order are not yet retained index facts, so some
  topology-stable work still leaks into camera planning.
- The corruption guard counts exactly `Q + T`. It bounds queue entries and crossing attempts, but
  does not bound the work performed by one attempt.
- Continuous projection is the sum of triangle clipping, polygon normalization/merge, every
  inherited/projected fragment pair, and every convex clip vertex-edge test. Coverage admission
  additionally compares candidate fragments with the `C_s` retained fragments. Therefore two
  inputs with identical `Q + T` can have different fragment-pair, vertex-edge, merge, allocation,
  and containment work. `Q + T` is not a sufficient golden-path work bound.
- Graph completion is `O(N + E)` for SCC discovery plus canonical sorts. The mutable ready-list
  implementation can add quadratic list movement/resorting in the number of components. This is
  downstream of the current corruption guard.
- The current plan collapses content domains and path appearances into render nodes, so it cannot
  honestly derive preparation, visibility, or submission multiplicity for the selected semantics.

Candidate bound obligations:

- The accepted view budget bounds retained `N`; the path-depth budget bounds complete frontiers;
  and the ownership-label budget bounds conflict colors, but none independently bounds continuous
  polygon work.
- One atomic projection budget now charges anchor-relative aperture transforms, near-clip
  validation/clipping/allocation, homogeneous projection, fragment intersection, normalization,
  merge, bounds, identity, and fragment ordering before their corresponding data-dependent work.
  Performed `P` is therefore at most `P_max`; exhaustion reports the first blocked operation as a
  sufficient lower bound and discards the entire in-progress frontier.
- Exact conflict coloring broad-phases precomputed window bounds, then charges every view pair,
  fragment pair, and convex vertex-edge test. Performed `C` is at most `C_max`; without that budget
  the implementation has the expected quadratic view-pair bound compounded by exact polygon
  overlap work. No footprint raster or bitset approximation exists in this candidate.
- Canonical traversal visits only retained views as parents. Therefore `W <= N_max * X`, `T <= W`,
  `L <= W * d_max`, immutable ancestry copying is at most `(N_max + 1) * d_max`, retained records
  are at most `N_max`, and a rejected view frontier materializes at most one additional record
  beyond `N_max`. These are deliberately conservative content-plus-budget bounds; the trace keeps
  their actual values distinct.
- Topology-revision work is `O(S + X + A + H + G)` plus the exact aperture seam-merge counters. It
  is retained behind topology object/revision identity and is absent from the per-camera bound.
- Scope-envelope formation is `O(N + Y log Y)`. Deferred deduplication is `O(R)`, deterministic
  global alpha ordering records exact comparisons and is `O(R log R)`, and particle routing/packing
  is `O(K + I)` with uploads bounded by compatible physical particle batches rather than `N`.
- Opaque scheduling is `O(N + J log J)`, where `B <= J <= B * N`. `J - B` is the explicit CPU/draw
  expansion caused when one physical indoor scope must target multiple ownership labels. The dry
  trace now reports `B`, `J`, and final opaque submissions independently; Gate C must reject the
  candidate if real scenes show material within-domain expansion. Exterior re-entry uses one
  exterior preparation/cache and does not contribute repeated exterior batch preparation.
- Projected execution `U` is the sum of retained masks, final opaque submissions, exterior
  composites, physical-scope visibility submissions, transparent/additive runs, and compatible
  particle batches. Every term is either plan-owned or a completed dry-schedule fact.

The matched trace vector remains unweighted. A structural rewrite is accepted only when it lowers
one named dimension without materially increasing another, or when Gate C records the explicit
bounded trade.

### Task Checklist

- [x] Separate reusable domain preparation identities from portal view identities and GPU
      submission identities.
- [x] Preserve scope-local exact continuous windows while projecting them into the selected view
      contract.
- [x] Enumerate potential views breadth-first in canonical crossing/path order, independent from
      graph storage order.
- [x] Check the path-depth budget before generating a new frontier. While generating a candidate
      frontier, stop once its cumulative unique-view count proves the view budget exceeded; discard
      that entire frontier and do not visit descendants.
- [x] Only after a complete candidate frontier fits the view budget, conflict-color the retained
      prefix plus that frontier in canonical order. If coloring proves the label budget exceeded,
      discard the entire candidate frontier and stop without coloring for an exact rejected total.
- [x] Replace exact rejected view/label totals with `budget` plus an `observedMinimum` lower bound so
      diagnostics never force the planner to complete work that the budget exists to avoid.
- [x] Prove from the production loops that unique potential views do not bound continuous-window
      primitive work; require a separate projection/admission work budget and use the real-scene
      census to choose its value, not its existence.
- [x] Census every archive LandblockInfo through the production content runtime, record structural
      order statistics without rendering, and select named risk landblocks deterministically.
- [ ] Trace the selected real workloads by authored aperture/cell density and transition shape, including
      outdoor root, indoor root, exterior re-entry, dense cycles, near-plane crossings, and the
      field-repro `0xda55ffff` poses. Include deterministic motion traces through portals so
      allocation and topology churn cannot hide behind settled fixed poses.
- [x] Run the current `PortalRenderGraphPlanner` and candidate planner over identical real inputs.
      Record attempted/admitted/rejected windows, input/output polygon vertices, canonical-order
      operations, exact conflict pair/fragment/vertex-edge tests, retained frontiers, constructed
      planner records, and peak live collection cardinalities.
- [x] Extend the existing consumed `PortalRenderGraphDiagnostics` and
      `PortalWindowProjectionDiagnostics` only where the complexity ledger identifies a missing
      primitive operation. Every new counter needs a real scene where it differs from an existing
      count and a specific acceptance decision that consumes it.
- [x] Derive worst-case and budget-bounded complexity from the actual algorithms. At minimum cover
      crossing traversal, continuous window clipping/admission, canonical ordering, conflict
      coloring, scope-envelope construction, scene resolution, batch/run formation, global alpha
      ordering, and particle packing. State every size variable and identify which explicit budget
      bounds it.
- [x] Separate topology-revision preprocessing from per-camera work. Canonical adjacency ordering,
      immutable aperture validation, and other topology-stable facts belong in the retained index;
      their costs must not appear in the per-frame bound.
- [x] Prove that every primitive operation is bounded by an accepted content invariant or an
      explicit planner budget. Do not assume potential-view count bounds continuous window fragment
      pairs, generated vertices, or exact conflict vertex-edge tests; add a distinct budget only when
      the derivation and real-scene distribution prove those dimensions differ.
- [x] Run a renderer-free dry schedule over each completed plan to trace scene resolution,
      contribution preparation, batch/run formation, transparent comparisons, particle packing,
      masks, composites, target changes, uploads, and projected submissions. Do not accept a
      planner-local reduction that multiplies those downstream operations.
- [x] Keep every trace dimension unweighted. Accept strict Pareto dominance directly; for a
      non-dominated trade, publish the real-scene distribution and leave the decision explicit
      instead of inferring wall-clock cost.
- [x] Optimize only through named structural rewrites. Each accepted rewrite must preserve the
      completed plan/composition result, reduce at least one traced golden-path dimension without
      increasing another CPU-owned dimension materially, and retain its before/after trace vector.
- [ ] Compute every derived merge/cache/submission fact once in the planner.
- [x] Materialize the accepted frontier, selected ownership coloring, exterior-cache eligibility,
      and truncation result once in the completed plan before target allocation or drawing.
- [x] Port model counterexamples to focused production planner tests without duplicating oracle
      implementation in assertions.
- [ ] Keep the executor mechanical and keep rendering policy out of scene/world crates.

### Acceptance Criteria

- One content domain can appear in multiple simultaneous path views without ambiguity.
- Outdoor root and outdoor re-entry are distinct views sharing one preparation identity.
- The production plan can explain every draw/composite occurrence and every withheld occurrence.
- Reordering source graph storage produces the same accepted frontier, coloring, and truncation.
- Exceeding any budget rejects every view at the first omitted depth, materializes no descendant of
  that depth, and leaves the previous frontier executable.
- Capacity exhaustion is detected before mutating GPU state and does not require discovering the
  exact size of rejected work.
- Archive-wide structural distributions and risk-selected real camera traces are recorded before
  choosing production budgets.
- The candidate has a published worst-case and budget-bounded complexity ledger, and real-scene
  traces demonstrate the actual golden-path and tail distributions of every size variable.
- No planner primitive remains bounded only by the corruption-oriented safety limit or by an
  unrelated output-count budget.
- The candidate is either Pareto-dominant in CPU-owned work or carries an explicit, bounded,
  real-scene trade. Any additional downstream preparation, ordering, or submission work is visible
  before backend implementation.

### Decisions and Course Corrections

- This is a clean contract cutover. Do not add ancestry fields to the old render-layer/SCC schedule
  while retaining its domain-owned execution semantics.
- 2026-08-09: Gate B validates complete-frontier cutoff semantics using a selector over a complete
  symbolic potential plan. That implementation is proof machinery, not the production planner:
  Phase 6 must stream canonical frontiers so the same budget also bounds discovery operations and
  live state.
- Exact rejected counts are intentionally not a production invariant. `budget + 1` is sufficient
  evidence to stop; computing a larger exact total would turn diagnostics into golden-path work.
- The current `workItemCount` and projection diagnostics are the starting evidence, not a proved
  bound. Phase 6 must show whether queue/crossing work also bounds polygon-fragment and vertex work;
  if it does not, the selected budget contract must name the missing independent dimension.
- The historical `0xda55ffff` profile is prioritization context, not acceptance evidence for this
  candidate. New architecture selection uses deterministic complexity and work traces, with
  planning, contribution preparation, run formation, and submission represented separately.
- 2026-08-09: Code-derived complexity rejects `Q + T` and accepted-view count as complete work
  bounds. Fragment-pair, vertex-edge, merge, and containment loops vary independently, so the
  production candidate needs one atomic projection/admission primitive-work budget in addition to
  depth, view, and ownership-label capacity. The trace preserves its component counters; the
  planner consumes their checked sum as one cutoff policy.
- 2026-08-09: The browser-free archive adapter and exact TypeScript pipeline loaded field repro
  `0xda55ffff` without Tauri, a browser, WebGL, screenshots, or a frame loop. The source contains
  237 resident topology scopes, 528 directed crossings, 2,352 visibility-aperture vertices, 3,888
  aperture indices, and maximum authored fan-out 38. The first workload set contains 128
  deterministic settled and portal-motion poses.
- 2026-08-09: Under the then-current, narrower projection-counter schema, the initial candidate
  incorrectly allowed one path to repeat a directed planar
  crossing. That had lost the finite symbolic model's strictly increasing ray-depth invariant and
  caused two of 128 poses to reach the provisional depth-16 cutoff. Rejecting a repeated directed
  crossing is structurally valid because one camera ray intersects one planar aperture at one
  depth. The rerun has zero truncations; maxima changed from 46 to 35 views, 17 to 9 labels, 374 to
  168 topology visits, and 3,596 to 2,097 charged projection primitives. Those projection totals
  are historical before anchor/near-clip/allocation counters were added and must not be compared
  numerically with the final schema.
- 2026-08-09: Precomputing each accepted view's NDC bounds and broad-phasing conflict coloring
  reduced the same 128-pose maximum exact vertex-edge tests from 6,891 to 2,636 without changing a
  retained plan. Restoring the non-repeating-crossing invariant reduced the final maximum to 1,496.
  The final maximum conflict-pair count is 595, of which as many as 478 are rejected by bounds.
  Both rewrites are unweighted Pareto improvements and their before/after reports remain disposable
  under `/tmp` during Phase 6 execution.
- 2026-08-09: The archive-wide renderer-free census decoded all 5,346 LandblockInfo-backed
  landblocks with zero failures. Directed source-portal counts are median 26, p95 1,702, p99 3,296,
  and maximum 9,798; maximum per-cell fan-out is 27; maximum source-aperture size is 24 vertices;
  and maximum outdoor-reachable indoor distance is 313 crossings. The deterministic risk set is
  `0x599bffff` (median outdoor transition), `0xa092ffff` (p95 outdoor transition), `0xec0effff`
  (maximum outdoor fan-out), `0x3f32ffff` (maximum aperture), `0x200fffff` (maximum reachable
  depth), `0x00d1ffff` (maximum indoor-only density), and field repro `0xda55ffff`. These source
  dimensions select workloads; the exact TypeScript topology trace remains authoritative for
  enriched visibility-aperture and camera-dependent work.
- 2026-08-09: Projection budgeting now includes work that previously occurred before projection:
  unique anchor-aperture transforms plus near-clip index/coordinate validation, vertex reads,
  triangle tests, polygon/vertex allocation, and vertex-plane tests. The checked sum also retains
  the existing exact continuous-window counters. Exhaustion can therefore stop inside near-clip or
  projection work without an aperture-sized uncharged loop.
- 2026-08-09: Topology preparation now records canonical outgoing comparisons and exact scalar
  comparisons for duplicate aperture ids. Separate object instances carrying structurally equal
  geometry are accepted and deduplicated; the same id carrying different geometry fails loudly.
  Per-camera ancestry comparisons and immutable path-element copies are also explicit trace
  dimensions. Conflict coloring no longer copies the complete retained prefix for every candidate;
  it iterates the retained and current-frontier collections directly with identical canonical
  order.
- 2026-08-09: The production behavior/script/particle pipeline at one deterministic simulation
  second produced 22 live instances in 21 physical cohorts from 22 dynamic residents in
  `0xda55ffff`. Sampled selected scopes contained 16 sources/instances that recoalesced to one
  compatible particle batch and one upload in both schedules. Portal views did not multiply
  particle population or packing.
- 2026-08-09: The dry schedule now distinguishes unique selected physical opaque batches from
  ownership-destination-expanded opaque inputs and final submissions. This exposed the Gate C risk
  that exact ownership can repeat an indoor batch for distinct labels even though preparation
  remains physical; the maximum-fanout trace below resolves that risk negatively.
- 2026-08-09: Matched final-schema traces separate the ordinary field repro from the selected tail.
  Across 128 `0xda55ffff` poses the candidate has no truncation, maximum 35 views, 19,068 checked
  projection primitives, 803 checked conflict primitives, and 8 ownership labels. Across the full
  set, 8,363 physical opaque batches become 8,553 label-targeted inputs. Median-transition
  `0x599bffff` and p95-transition `0xa092ffff` likewise show no opaque expansion in their first 64
  deterministic poses and stay below 6,610 projection primitives and 192 conflict primitives.
- 2026-08-09: Maximum-outdoor-fanout `0xec0effff` decisively rejects this candidate. Its first 64
  deterministic poses have median 102 path views, 213,389 projection primitives, 18,755 conflict
  primitives, and 131 physical opaque batches expanded to 315 inputs. One settled indoor pose
  reaches 3,696 views, 132 labels, 207,133 topology visits, 1,546,965 path comparisons, 8,747,085
  projection primitives, 9,205,174 conflict primitives, and expands 226 physical opaque batches to
  6,324 submissions. The 64-pose aggregate expands 8,668 physical opaque batches to 24,937 inputs.
  Particle work remains physical (106 sources, 235 instances, five batches/uploads), so the failure
  is specifically path enumeration, conflict coloring, masks, and opaque destination replay.

## Resteering Gate C: Accept or Reject the Work Shape

Do not begin the selected WebGL2 backend until Phase 6 answers all of the following with real-scene
evidence:

- Does canonical frontier streaming reduce or bound planner operations and live allocation
  cardinality on dense archive topologies and motion traces?
- How many path views and visibility submissions does correctness add relative to the current
  domain-owned schedule?
- Does exterior-only caching remove repeated preparation/submission work, and what lookup,
  composite, target-management, and attachment work does it add?
- Do scope envelopes preserve one preparation/upload per physical transparent or particle source
  without multiplying ordering or run-formation work?
- Which explicit depth/view budgets bound pathological work without visibly truncating ordinary
  real scenes?

Gate C either accepts one planner/dry-schedule contract for backend refinement, revises and reruns
Phase 6, or rejects this candidate in favor of another already-correct symbolic family. Semantic
correctness is necessary; complexity dominance or an explicit bounded work trade decides among
correct candidates.

### Gate C Outcome (2026-08-09): Reject Exact Path-View Replay

The exterior-cache/path-view-stencil candidate is rejected before backend implementation. The
archive-selected maximum-fanout workload demonstrates both CPU work near the provisional ten
million-operation cutoffs and material within-domain opaque replay. Lowering a capacity budget
would bound the failure but would not remove the repeated work below that cutoff; on this workload
even the median sampled pose expands physical opaque batches by roughly 2.4 times. That violates
the stated optimization direction and the no-batch-fragmentation invariant.

This rejection is structural, not a timing judgment:

| workload                       | sampled poses | maximum views | maximum projection primitives | maximum conflict primitives | physical -> expanded opaque inputs |
| ------------------------------ | ------------: | ------------: | ----------------------------: | --------------------------: | ---------------------------------: |
| `0xda55ffff` field repro       |           128 |            35 |                        19,068 |                         803 |               8,363 -> 8,553 total |
| `0x599bffff` median transition |            64 |            24 |                         6,463 |                         101 |               2,379 -> 2,379 total |
| `0xa092ffff` p95 transition    |            64 |            12 |                         6,610 |                         192 |               1,508 -> 1,508 total |
| `0xec0effff` maximum fan-out   |            64 |         3,696 |                     8,747,085 |                   9,205,174 |              8,668 -> 24,937 total |

The remaining candidate-specific risk traces and independent executor validation stop here by
design: they cannot reverse a proved Gate C failure and would only harden dead architecture. The
archive census, exact primitive meters, physical particle workload, dry-schedule dimensions, and
counterexamples remain reusable proof infrastructure.

The next symbolic candidate must satisfy all of these stronger constraints before another Gate C
run:

- propagate visibility in scope/domain state rather than enumerate every simple crossing path;
- bound camera planning by admitted scope-window states or `depth * directed crossings`, not by the
  combinatorial number of crossing paths;
- prepare and submit each physical opaque batch once, with any repeated visibility represented by
  a scope/domain mask or a bounded composite whose count does not multiply every batch;
- keep global transparency and particles physical and envelope-driven, preserving the already
  proved one population/pack/upload behavior;
- retain exterior caching, whole-frontier capacity cutoff, exact continuous apertures, and the
  symbolic reference compositor as constraints rather than implementation prescriptions.

Phase 7 remains blocked on a revised symbolic candidate and a new Gate C acceptance. No WebGL2
backend work is authorized by this plan outcome.

## Phase 6B: Quotient Paths Into Arrival-State Masks

Status: complete; Gate C accepted the semantic and structural contract

Replace simple crossing-path identity with the smallest state that can still determine future ray
behavior. A scope alone is insufficient under re-entry: reaching the same scope through different
portal planes supplies different entry depths and can select different later crossings. The exact
state is therefore the root arrival or one directed crossing arrival, with a finite-screen coverage
mask. All paths reaching the same arrival state are semantically interchangeable and union
immediately.

For an arrival state `a`, pixel `p`, and outgoing crossing `e`, the transition is admitted only when
`e` is the nearest crossing beyond `a`'s entry plane at `p` and local opaque geometry does not end
the ray first. Its coverage is:

`coverage(e) |= coverage(a) & aperture(e) & transitionPredicate(a, e)`

The recurrence is monotone. Intersection distributes over union, so induction on crossing depth
proves that each state mask equals the union of the exhaustive reference paths ending in that
state. Reprocessing an already-admitted state pixel cannot reveal a new transition. Cycles are
therefore bounded by root plus directed-crossing state cardinality rather than by the number of
simple paths.

After propagation, reduce arrival states by authored scope. One scope envelope records coverage and
the farthest portal exit admitted at each pixel. Opaque and alpha-tested fragments execute once per
physical batch through that envelope and ordinary depth testing. Alpha, additive, weather, and
particle sources remain physical, globally ordered where required, and consume the same envelope.
No fragment or upload retains arrival-state or path identity.

### Deliverables

- A pure arrival-state mask executor independent from stencil labels, render targets, and the
  production renderer.
- A constructive equivalence test against the independent ray oracle over the exhaustive, seeded,
  constrained-depth, multi-pixel, transparency, and particle corpora.
- Exact state-propagation diagnostics separating arrival-state admission, state/pixel visits,
  transition tests, mask unions, scope-envelope reduction, and physical fragment work.
- A production-shaped structural ledger over the existing archive census and risk workloads. It
  counts topology/camera preparation, selected physical scopes, propagation work, envelope work,
  physical batches, transparent runs, particle packing/uploads, and projected command submissions.
- A revised Gate C outcome accepting or rejecting this work shape before any WebGL2 format or
  framebuffer implementation is selected.

### CPU and Submission Contract

Let `S` be selected authored scopes, `X` selected directed crossings, `A` total vertices in their
physical apertures, `W` admitted conservative scope-window deltas, `P` exact polygon projection and
intersection primitives, `D` the complete-frontier depth limit, `B` physical opaque/alpha-test
batches, `R` physical transparent/additive submissions, `K` particle sources, and `I` packed
instances.

- Cull physical work with monotone authored-scope window unions. Its camera work is
  `O(sum(outgoing(scope(w))) + P)` over `W` admitted deltas. A crossing can be projected again for
  a genuinely novel source-scope delta, but never because of path identity, ancestry, or conflict
  coloring. Exact work-item and polygon-primitive budgets bound the whole deepest incomplete
  frontier.
- Build the conservatively selected directed-crossing batch and scope index in `O(S + X)` CPU
  work. Reserve at most root plus one state per selected directed crossing; exact propagation may
  leave conservative states empty.
- Propagate arrival masks in bounded GPU work no worse than `O(D * X)` logical crossing instances.
  The production substrate must batch those instances into `O(D)` CPU command submissions; if
  WebGL2 cannot implement that batching without per-state framebuffer churn, Gate C rejects the
  proposed substrate even though the semantic model remains valid.
- Allocate at most root plus one retained state per selected directed crossing and one envelope per
  selected scope. No live allocation or operation count may depend on simple path count.
- Prepare and submit each physical opaque/alpha-test batch once: exactly `B` batch inputs before
  ordinary renderer compatibility coalescing, with no mask-driven splitting.
- Preserve physical deferred complexity: `O(R log R)` global alpha ordering and `O(K + I)` particle
  routing/packing, with one upload per compatible physical particle batch.
- Exhausting state, depth, or primitive capacity declines the deepest incomplete frontier as a
  whole. It never falls back to path replay, recursive targets, or partial label reuse.

These are structural operation counts, not wall-clock predictions. Pixel fill, attachment traffic,
and mask storage remain explicit GPU cost dimensions, but cannot excuse avoidable CPU traversal or
draw-command multiplication.

### Task Checklist

- [x] Implement immutable arrival-state coverage and transition propagation over the finite model.
- [x] Derive exact per-scope opaque/deferred envelopes without consulting reference paths.
- [x] Compare the completed candidate frame with the independent oracle over every retained corpus.
- [x] Add metamorphic checks for identity renaming, sibling crossing order, unreachable cycles,
      split footprints, subsumed farther portals, fragment/particle equivalence, and
      complete-frontier depth truncation.
- [x] Publish code-derived worst-case and budget-bounded complexity using named input dimensions.
- [x] Trace the archive-selected ordinary and pathological workloads without browser rendering or
      CPU timing.
- [x] Record physical-to-final opaque submissions and prove particles retain one population,
      pack, and upload stream.
- [x] Record the revised Gate C decision and either unblock Phase 7 or retain the backend block.

### Acceptance Criteria

- Every bounded and seeded semantic case is equivalent to the ray oracle for opaque, alpha-test,
  globally ordered alpha, additive, and particle results.
- The candidate has no path identity, path ancestry copy, conflict coloring, or path-view replay in
  its operational contract.
- Maximum live visibility state is bounded by `1 + X` arrival states plus `S` scope envelopes.
- The `0xec0effff` risk trace uses path-free monotone scope-window culling and retains physical
  opaque batches without the prior `226 -> 6,324` expansion.
- Ordinary `0xda55ffff`, median, and p95 traces do not add repeated physical preparation, particle
  uploads, or within-domain batch submissions.
- The WebGL2 batching hypothesis is kept separate from semantic proof. Phase 7 remains blocked if
  the required `O(D)` propagation submissions cannot be refined without CPU work proportional to
  arrival states or crossings per round.

### Decisions and Course Corrections

- 2026-08-09: Rejected one union mask per authored scope before implementation. Entry plane and
  incoming crossing affect which later portal is nearest, so scope identity alone is not a valid
  future-behavior equivalence class. Directed-crossing arrival identity is the minimal retained
  provenance; it is bounded by physical topology and is erased when scope envelopes are reduced.
- 2026-08-09: Exterior caching remains an optional exterior-only cost rewrite, not part of the
  semantic recurrence. If one masked physical exterior submission dominates the cache on all
  counted CPU/submission dimensions, addition through subtraction removes the cache.
- 2026-08-09: Rejected physical-aperture-only reachability culling after real-scene traces. Although
  its CPU shape was attractive, ignoring projected scope windows selected 16,430 opaque batches on
  `0xda55ffff` where the exact physical workload was 8,363, and 3,544 on `0xa092ffff` where the
  exact workload was 1,508. Saving culler work by doubling or tripling the expensive draw domain is
  a losing trade.
- 2026-08-09: Retained the existing planner's monotone per-scope window union only as the physical
  culler and atlas bound. Its later SCC/domain contribution schedule is not part of the accepted
  compositor and should be deleted when the new substrate cuts over. This keeps useful exact
  aperture clipping while removing path enumeration and conflict coloring.
- 2026-08-09: Exact propagation needs the source scope's local opaque depth; aperture overlap alone
  would admit child geometry through a nearer wall. The accepted backend shape therefore renders
  physical opaque batches once into scope-window-bounded color/depth tiles, propagates arrival
  state against those local depths, reduces arrivals into one envelope per scope, and resolves the
  scope tiles in one batched composite. Exterior caching is subsumed by the exterior scope tile in
  this first cut.
- 2026-08-09: Propagation uses a fixed complete-frontier depth of 16 in the structural traces. Each
  frame contributes 16 frontier clears, 16 batched crossing draws, 16 batched scope-envelope
  reduction draws, and 32 visibility framebuffer changes, independent of the number of paths.
  There is no convergence readback or partial-frontier fallback.

### Revised Gate C Outcome (2026-08-09): Accept Arrival-State Scope Atlases

The arrival-state/scope-atlas candidate passes the semantic and structural gate. This acceptance
authorizes Phase 7 substrate refinement; it does not claim that a WebGL2 attachment format, atlas
packer, or shader implementation has already been proved.

The semantic proof is constructive. The exact finite executor matches the independent ray oracle
over all 3,980 bounded scenes, 128 seeded cyclic/alternating scenes, every bounded
complete-frontier truncation, and the retained multi-pixel, re-entry, opaque occlusion,
transparency, and particle fixtures. Metamorphic checks cover identity renaming, crossing order,
sibling order, split footprints, unreachable cycles, subsumed farther portals, and equivalent
transparent/particle representations. A separate conservative-culling proof checks that every
exact arrival-state pixel is contained by its authored scope union while deliberately retaining an
opaque-occluded example that overselects. The culler is therefore not silently promoted into the
compositor.

The operation ledger is likewise path-free. In the complete bounded corpus its maximum exact
ledger is four arrival states, four admitted state pixels, four state-pixel visits, five crossing
tests, three mask unions, four scope-envelope reductions, and three tests each for physical opaque
and deferred fragments. Larger scenes allocate at most `1 + X` potential arrival states and `S`
scope envelopes. Transparency and particles consume physical scope envelopes after the opaque
resolve; they never acquire path or arrival identity.

The real-scene traces are structural counts produced without a browser, screenshots, wall-clock
timing, or renderer execution:

| workload                       | poses | max scope-window states | max culler work items | max projection primitives | max scopes | max potential arrival states | max `D * X` instances | prepared opaque ranges -> candidate routes | rejected replay range routes |
| ------------------------------ | ----: | ----------------------: | --------------------: | ------------------------: | ---------: | ---------------------------: | --------------------: | -----------------------------------------: | ---------------------------: |
| `0xda55ffff` field repro       |   128 |                      34 |                   131 |                    11,337 |         32 |                           75 |                 1,184 |                             8,363 -> 8,363 |                        8,553 |
| `0x599bffff` median transition |    64 |                      24 |                    49 |                     5,361 |         24 |                           47 |                   736 |                             2,379 -> 2,379 |                        2,379 |
| `0xa092ffff` p95 transition    |    64 |                      11 |                    61 |                     2,924 |         11 |                           23 |                   352 |                             1,508 -> 1,508 |                        1,508 |
| `0xec0effff` maximum fan-out   |    64 |                     208 |                 8,700 |                   240,181 |         25 |                          307 |                 4,896 |                             8,668 -> 8,668 |                       24,937 |

The pathological pose drops from 8,747,085 path-replay projection primitives and 9,205,174
conflict primitives to at most 240,181 culler projection primitives and 8,700 culler work items.
More importantly, its prepared opaque ranges remain physical instead of expanding by arrival.
The 307 potential state ids are frontier data, not simultaneous stencil ownership labels; they do
not consume the 8-bit stencil namespace. Phase 7 must still select a texture representation and
enforce the explicit state/work budget rather than invent an unbounded fallback.

Scope-window bounds also make the off-screen cost concrete. Across the sampled maxima, bounded
RGBA8 plus depth scope tiles range up to 76,813,008 bytes and 32-bit scope envelopes up to
38,406,504 bytes. The two full-screen 32-bit frontier planes add 16,588,800 bytes at the traced
resolution; Phase 7 later corrected this estimate to include one shared nearest-crossing depth
plane. These are conservative allocation inputs before atlas packing gaps, not measured GPU
residency. Phase 7 must still prove practical packing. The entry audit below closes the
single-submit routing question; if implementation cannot preserve that proved boundary or batch
propagation in `O(D)` commands, the substrate is rejected without reopening path replay.

## Phase 7: Implement and Prove the Selected Opaque Backend

### Scope-Routing Entry Audit — Accepted 2026-08-09

The production renderer already enforces the scope-homogeneous submission invariant needed by the
atlas. This is stronger and cheaper than the earlier assumption that one compatibility batch might
contain multiple selected scopes:

| opaque family                   | existing submission boundary                                                                                       | atlas route                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| terrain                         | one existing landblock draw; terrain is authored in the outdoor scope                                              | one outdoor tile uniform per existing draw |
| baked static and EnvCell shells | one existing range with one resolved placement scope                                                               | one tile uniform per existing draw         |
| generated static instances      | grouping identity includes canonical scope, landblock, cohort, geometry, and range before exact compatibility      | one tile uniform per existing run          |
| dynamic rigid-part instances    | `ObjectRenderDomain.scope` comes from the resolved part placement; grouping compares canonical scope and landblock | one tile uniform per existing run          |
| alpha-test                      | follows the same preparation and grouping path as opaque                                                           | same route as its owning opaque family     |

`ObjectFrameInput.renderScopeKey` now carries the canonical authored scope directly. It replaces the
old `renderDomainKey`, which redundantly encoded `landblockId/scope` even though `landblockId` was
already an independent batching key and exact compatibility fact. Therefore the clean first-cut
contract is a per-submission tile transform or integer tile index. It requires no per-instance scope
attribute, no instance-record growth, no scope-induced run split, and no additional opaque draw.
For the existing opaque schedule, `candidate submissions = current submissions`; only the render
target and tile transform differ. Cross-scope instance consolidation is a separate possible draw
reduction and is deliberately YAGNI.

The archive dry trace's opaque count is a unique prepared-range count, not an exact final WebGL draw
count: production may coalesce compatible instanced ranges within a scope. It remains a conservative
formation-work and replay-expansion measure, but it must not be cited as measured final submission
count. Phase 7's typed command ledger will count the already-formed production runs at its injected
submission boundary. The no-inflation proof does not depend on the archive count: every such run has
exactly one `renderScopeKey` by construction.

### CPU Culler Arena Checkpoint — 2026-08-09

`PortalScopeWindowCuller` is now independent from the legacy SCC, render-layer, stencil-label, and
exterior-suffix schedule. At topology/capacity events it assigns stable integer scope and crossing
ids, validates and prepares apertures, retains source-landblock coordinates, builds packed outgoing
adjacency, and allocates all queue, mutation, selection, polygon, and clipping storage. Camera-time
queue and coverage records contain uint handles into `PortalWindowArena`; no immutable
`PortalViewWindow`, `Vec2`, anchored aperture, projector, result, bounds, or diagnostic object is
created.

The arena projects homogeneous aperture loops into reusable scratch, intersects normalized convex
fragments, applies footprint rejection, performs monotone coverage admission, and commits only
integer-addressed fragment/vertex tails. Two reusable builders own normalization, copying, merge,
and clipping scratch. Bounds use one retained scalar buffer. Near-volume classification transforms
authored vertices into retained xyz arrays and clips triangles through the five finite pyramid
planes without point or polygon records. Camera projection validation was also changed from a
temporary matrix-value array to direct scalar checks.

Work-item, near/projection primitive, and polygon-arena capacity cutoffs now throw fresh typed errors
before rolling back the incomplete crossing-depth frontier, including committed window tails. The
error captures the actual failing operation and counts as exactly one exceptional diagnostic heap
record. Accepted frames reset that counter to zero. Rollback still creates no fallback graph and
never grows arena storage.

The reused trace separates backing bytes, queue and polygon high-water counts, projection
primitives, topology rebuilds, arena growth (structurally zero), portal-owned accepted-frame heap
records (zero), and exceptional diagnostic heap records (zero or one). The non-retained frame view
exposes scalar fragment/vertex readers and never reconstructs an immutable window.

Symbolic equivalence covers homogeneous, perspective, near-ray, and multipart projection;
contained, containing, and partial admission; the retained 128 deterministic triangle-intersection
cases; triangle-order/cyclic-index metamorphism; and six near-volume boundary cases including
grazing contact. The complete immutable planner and arena culler additionally match over those 128
retained cases plus 336 seeded topology/camera cases split evenly across one-hop, accumulated fan-in,
multipart, cycle/immediate-return, near-contact, footprint-rejection, and cross-landblock families.
Every expanded input is replayed under crossing/scope storage reversal, triangle storage reversal
with cyclic index rotation, and their combination: 1,472 complete shared inputs and 2,944 independent
planner/culler executions. Family-specific assertions prove the intended branch was reached instead
of accepting mutually boring inputs. Failures include seed, case, family, camera, topology, mutation,
and normalized-window diffs. This evidence uses Vitest only: no browser, renderer, screenshots,
SwiftShader, wall-clock timing, or real-scene harness.

Separate tests prove atomic queue, primitive, and committed-fragment exhaustion plus frame/trace
reuse. The arena remains disconnected from production until a synchronous atlas consumer can replace
the legacy immutable schedule without production shadow execution.

### Dual-Implementation Drift Gate — Passed; Guards Production Wiring

The immutable `PortalViewWindow` path and packed `PortalWindowArena` path are a deliberate DRY
violation with different lifetime and allocation strategies. They must remain algorithmically
independent: sharing tolerances, prepared inputs, deterministic generators, and snapshot adapters is
allowed; sharing projection, clipping, normalization, intersection, merge, admission, or traversal
helpers would make the differential proof circular. Production must never shadow-run both paths.

Completed before capacity derivation or production wiring:

1. Refactor the existing deterministic seeded geometry inputs into test-only reusable generators.
   Feed each already-retained seed and case to both the immutable planner and arena culler.
2. Add a culler-level seeded corpus with hundreds of complete topology/camera inputs covering
   one-hop projection, accumulated fan-in coverage, multipart apertures, cycles, immediate-return
   suppression, near-volume contact, footprint rejection, and cross-landblock anchoring.
3. Compare completion status, completed/declined depth where the budget contract is shared, selected
   scope identity, fragment count/order, quantized fragment identity, and every NDC vertex within
   `PORTAL_WINDOW_NDC_EPSILON`. A mismatch reports the seed, case ordinal, topology, camera facts,
   and both normalized windows so it is directly replayable.
4. Re-run the same inputs under crossing-storage reorder, triangle-storage reorder, cyclic vertex
   rotation, and harmless scope-array reorder. Both implementations must remain mutually equivalent
   and individually invariant.
5. Keep arena-only capacity exhaustion in focused frontier-atomic tests. Do not invent an immutable
   capacity model merely to make failure modes look differential.

Gate exit requires every retained deterministic fixture, existing seed, expanded culler seed, and
metamorphic variant to pass without weakening comparison tolerances. The gate passed on 2026-08-09;
production shadow execution remains prohibited.

### Capacity Policy Ownership — After the Drift Gate

The accepted maximum portal path/propagation depth is `16`. Before this checkpoint it was repeated
as `maximumDepth: 16` in culler test literals. It is policy selected by Gate C, not a geometric or
storage invariant of `PortalScopeWindowCuller`; the culler continues accepting an explicit capacity
contract and does not own that number.

`portal-render-capacity-policy.ts` now owns the complete selected portal capacity object. Its named
`maximumPathDepth` field owns `16` and feeds culler depth plus ordinary fixtures and trace scheduling.
The selected independent cutoffs are 8,700 scope-window work items, 240,181 checked projection
primitives, the archive-censused maximum 24 authored aperture vertices, and a fixed scope-atlas
extent of two drawing-buffer columns by three rows. The same policy admits at most 255 arrival
states: zero remains the uncovered sentinel and the 255 nonzero `R8UI` values identify the root
plus retained directed crossings. It also admits at most 2,048 expanded crossing-triangle vertices
per accepted camera plan. All three GPU selections are justified by the real-scene checkpoints
below; none is an arena-derived number.

Arena dimensions are mechanical rather than individually tuned. A reciprocal polygon intersection
can retain both input boundaries plus one intersection per edge pair, yielding a conservative
visibility-aperture bound `A² + 2A = 624`. Six homogeneous clip planes and sixteen nested
intersections yield `4 + D * (624 + 6) = 10,084` vertices in one convex fragment. The primitive
budget bounds 80,061 committed fragments, 80,060 temporary fragments, 240,185 committed vertices,
and 240,181 temporary vertices; the work budget bounds 17,398 committed window handles. Cutoff is
the intentional response to an unseen input beyond these selected limits. No arena dimension grows
in response to camera motion.

### Deliverables

- A visibility-only production plan containing selected scope windows, directed crossings, and the
  complete-frontier budget; no SCC contribution layers, path views, or ownership labels.
- A renderer-owned CPU scratch arena for culler queues, polygon vertices/fragments, selected
  scope/crossing sets, atlas bounds, and command parameters. Its capacity is derived from the
  configured work budgets rather than grown in response to camera motion.
- One production portal capacity policy owning the accepted path-depth value and every derived
  culler, arena, propagation, and atlas limit.
- A WebGL2 scope-layer atlas with deterministic tile transforms, local opaque depth sampling,
  ping-pong integer frontier state, and one accumulated visibility envelope per selected scope.
- A typed command ledger refining each abstract propagation, reduction, opaque route, and resolve
  operation into the accepted structural bounds.
- An exact allocation ledger separating topology/capacity allocation, accepted-frame heap records,
  exceptional diagnostic records, arena capacity/high-water bytes, and arena growth. It contains no
  clock or GC-pause metric.
- Target/attachment lifecycle, capacity cutoff, resize, and context-loss coverage.

### Scope-Atlas CPU Planning Checkpoint — 2026-08-09

`PortalScopeAtlasPlanner` now owns the first synchronous consumer of the non-retained culler frame.
It derives conservative integer tile bounds directly from arena vertices, computes each tile's clip
scale and offset once, packs the tiles into a fixed renderer-supplied extent, and publishes a reused
scalar frame view. The planner owns fixed typed arrays for bounds, placements, transforms, stable
merge-sort ordinals, and sort scratch. An accepted fixed-capacity frame creates no portal-owned heap
record and grows no arena.

The first-cut packer is stable next-fit decreasing-height shelving. Its accepted-frame CPU bound is
`O(V + S log S + S)`: inspect every retained window vertex once, stable-sort the `S` scope tiles by
height/width, and attempt each placement once. This deliberately avoids the allocation and
free-rectangle proliferation of the resident texture-atlas packer. Shelving can reject a layout
that a more complex packer could fit. That concession is observable through tile pixels, packed
extent pixels, placement/comparison counts, and complete-frontier retreat counts; a later packer
must earn its complexity from deterministic real-scene traces.

The culler retains three scalar checkpoints before each frontier expansion. If atlas capacity is
insufficient, the planner restores the deepest checkpoint in place and retries packing without
re-running aperture projection or admission. A cutoff can cross a completed frontier that changed
no retained window before reaching one that releases pixels, so the exceptional-path bound is at
most `D + 1` packing passes. The golden accepted path remains one pass. The root tile is guaranteed
by requiring atlas width and height to be at least the drawing-buffer extent; violating that
resource contract fails loudly before culling.

The culler also materializes selected directed crossings into topology-sized typed storage with one
linear crossing scan per finalized visibility selection. Exceptional atlas retreat repeats that
bounded scan and reports the exact cumulative count. The atlas command ledger consumes those ids
and the policy-owned maximum depth to record zero or exactly `D` frontier clears, propagation
commands, and scope-envelope reductions, plus one instanced opaque resolve for a non-empty atlas.
When culler or atlas capacity declines a frontier, the ledger uses the retained shallower depth. No
path count, camera-time `Map` or scope-key construction, convergence readback, or per-state command
enters this contract. GPU attachment and shader refinement remain intentionally unwired.

### Opaque Routing Contract Checkpoint — 2026-08-09

The final production submission audit found two existing scope-homogeneous boundaries. Terrain is
already one outdoor-only pass with one draw per `TerrainFrameInput`. Opaque and alpha-test objects
reach `#drawOpaqueObjects` as one `PreparedObjectFrameInput` per final draw after generated and
dynamic frame instances have been recoalesced; `renderScopeKey` is already part of the grouping
identity and is retained on the representative output record. Atlas routing therefore needs no
route array, route-record capacity, regrouping pass, per-instance field, or new submission type.

`PortalScopeAtlasOpaqueRouter` expresses that boundary as synchronous scalar resolution. A
non-empty terrain pass resolves the outdoor tile once and shares it across all terrain draws. Every
final object draw performs one canonical scope-key lookup and immediately receives its tile
ordinal. The structural CPU increment is exactly
`indicator(terrainDrawCount > 0) + finalOpaqueObjectDrawCount` topology-map lookups, with zero
portal-owned frame records. The API cannot enumerate, split, reorder, retain, or duplicate a draw
because it accepts and returns only one scalar route at a time.

The topology index now retains one canonical renderer-key map at topology lifetime. That same map
replaces the prior temporary identity map and linear camera-root scan, and a typed selected ordinal
table converts its stable scope id directly to the atlas tile. Adding another integer scope field
to every object or instance record was rejected: the canonical key is already required for correct
run formation, and coupling contribution resolution to camera-selected atlas ids would add memory
and invalidation work without removing the unavoidable per-final-draw routing decision. A
last-scope cache is also deferred until deterministic traces demonstrate useful key locality.

The archive dry trace cannot honestly claim exact final WebGL object-run counts: it stops before
WebGL-resolved compatibility and currently omits dynamic opaque parts. Reimplementing that logic in
the trace would create the parallel approximation this gate is meant to prevent. The existing
prepared-range count remains a conservative routing upper bound; exact final counts will come from
the injected counting substrate at the production run boundary during cutover. This does not weaken
the complexity proof or the no-inflation result, both of which are parameterized by the renderer's
existing final draw count.

### WebGL2 Target Lifecycle Checkpoint — 2026-08-09

`WebGL2PortalScopeAtlasTargets` owns one fixed attachment generation with four framebuffers and six
textures. Scope-local opaque work retains `RGBA8` color and sampleable `DEPTH_COMPONENT24` depth
over the packed atlas. Two drawing-buffer-sized `R8UI` textures hold the ping-pong arrival state.
They share one drawing-buffer-sized `DEPTH_COMPONENT24` texture because a batched crossing draw
needs ordinary depth testing to select the nearest valid outgoing portal and the following
reduction draw must sample that winning depth. A renderbuffer cannot satisfy the latter contract.
The scope envelope is one atlas-sized, depth-only `DEPTH_COMPONENT32F` texture. The selected formats
require no stencil attachment and no float color-renderability or float-blending extension. `R8UI`
is a core color-renderable integer format in WebGL2's underlying GLES 3.0 format table; no optional
extension is part of the capacity contract.

The shared frontier depth is a correction to Gate C's preliminary memory estimate; state alone
cannot implement nearest-crossing selection without integer atomics, per-crossing commands, or a
depth attachment. The accepted fixed storage is therefore exactly
`12 * atlasPixels + 6 * drawingBufferPixels` bytes: color, local depth, and envelope depth over the
atlas; two integer frontier planes and one shared frontier depth plane over the drawing buffer.
Framebuffer objects themselves are counted separately rather than assigned guessed byte sizes.

The depth-only envelope avoids an integer color plane plus a second atlas-sized reduction-depth
attachment. Its encoding reserves `0` for uncovered, `[0, 0.5]` for finite maximum exits, and `1`
for an unbounded scope appearance. Scaling both finite exit and fragment depths by `0.5` preserves
the strict `fragmentDepth < exitDepth` predicate while keeping a far-plane finite exit distinct
from unbounded. A finite exit at zero intentionally aliases uncovered: normalized raster fragments
cannot satisfy `fragmentDepth < 0`, so the two states are observationally equivalent. The retained
symbolic format test checks 66,563 finite/unbounded/uncovered fragment comparisons, including both
near- and far-plane boundaries. This is a substrate encoding proof, not a second compositor oracle.

Construction and same-extent resize allocate no GPU resource. A changed extent allocates and
validates the complete replacement before publication, then disposes the previous generation.
Failure deletes every partial replacement handle and leaves the previous generation active.
Allocation restores active texture, texture-unit bindings, and draw/read framebuffer bindings.
Atlas and drawing-buffer attachment dimensions must fit `MAX_TEXTURE_SIZE`, and the atlas must
contain the drawing-buffer root tile. Disposal is idempotent. Context loss continues to use the
existing whole-device restart-required policy rather than pretending stale handles can be restored
locally.

Focused browser evidence ran through the existing portal-substrate fixture on the real GPU path
(ANGLE/Vulkan on AMD Radeon RX 7900 XT). All initial and replacement framebuffers were complete,
the maximum arrival id `255` survived an `R8UI` clear and `RED_INTEGER`/`UNSIGNED_BYTE` readback, all
handles were valid, same-extent reuse and changed-extent replacement held, disposal returned every
active resource count and byte count to zero, and no browser/WebGL error was reported. The fixture
performs no screenshot comparison and contributes no timing claim. Shader sampling, propagation,
reduction, and compositing remain unwired.

### Real-Scene Atlas and Arrival-State Capacity Checkpoint — 2026-08-09

`portal-work-trace.ts --atlas-capacity` now runs the production `PortalScopeAtlasPlanner`, arena
culler, and stable shelf packer directly over decoded archive topology and deterministic production
camera matrices. It compares each bounded fixed-extent candidate against a logical one-shelf
baseline wide enough for every policy-admitted scope tile. Exact selected scope keys, crossing ids,
tile dimensions, completion depth, declined depth, and status must match before a pose counts as
preserved. This is a browser-free symbolic trace; it performs no rendering, screenshot comparison,
wall-clock measurement, or CPU-time inference.

The capacity search covers the field repro plus the archive-selected median-transition,
p95-transition, and maximum-fan-out landblocks: 320 deterministic poses at each of 1600x1200,
1600x1000, 1920x1080, and 2560x1080. Varying the drawing buffer changes both the production camera
projection and integer tile packing. The offline trace intentionally invokes the planner once for
the guaranteed baseline and once per candidate. Those repeated calls are policy-search work and
are not part of the production one-plan-per-camera contract.

| fixed policy                           | 4:3 preserved | 16:10 preserved | 16:9 preserved | ultrawide preserved | total     |
| -------------------------------------- | ------------- | --------------- | -------------- | ------------------- | --------- |
| 1x4 extent, logically unbounded ids    | 310/320       | 314/320         | 314/320        | 317/320             | 1255/1280 |
| 2x3 extent, logically unbounded ids    | 320/320       | 319/320         | 319/320        | 320/320             | 1278/1280 |
| 2x4 extent, logically unbounded ids    | 320/320       | 320/320         | 320/320        | 320/320             | 1280/1280 |
| selected 2x3 extent plus 255-state ids | 319/320       | 318/320         | 318/320        | 319/320             | 1274/1280 |

The selected first-cut extent is `2x3`. Its two extent-only misses are the same `0x599bffff`
source-far camera under 16:10 and 16:9 projection: the complete baseline reaches depth 4 with 23
scopes and 44 crossings, while fixed capacity atomically retains depth 2 with 3 scopes and 4
crossings after two frontier retreats. `2x4` preserves those occurrences but adds 24 target bytes
per drawing-buffer pixel and admits their downstream scope work. This is a deliberate bounded
cutoff, not a claim that 99.84% trace preservation proves universal fit.

Arrival-state capacity is evaluated independently from atlas extent. The extent candidate grid
uses a logical unbounded id capacity, while the selected production trace reruns the production
planner with exactly 255 arrival states. Across the original 1,280-pose corpus, the `R8UI` cutoff
trips four times: the same `0xec0effff` maximum-fan-out indoor pose under each aspect ratio. Its
baseline reaches depth 7 with 302, 304, 306, or 310 crossings; the complete-frontier cutoff retains
depth 3 with 246, 248, 250, or 254 crossings. Each occurrence loses two scopes and 56 crossings
after four frontier retreats. Combined with the two independent atlas misses, the selected
production policy preserves 1,274 of 1,280 pose/aspect occurrences.

An expanded state-pressure pass evaluates the first 128 deterministic poses in each risk scene at
all four aspect ratios: 2,048 pose/aspect occurrences. It finds 18 arrival-state cutoffs, all in the
same archive-selected `0xec0effff` maximum-fan-out environment family, plus the two existing atlas
cutoffs. Observed maxima are four lost completed depths, 11 lost scopes, 146 lost crossings, and four
state-capacity retreats; those maxima do not all belong to one pose. The production path still
performs one cull and one successful packing attempt; it never creates GPU work for a rejected
frontier.

With `R8UI`, the selected `2x3` target set costs exactly `78 * drawingBufferPixels` bytes. At
1920x1080 it allocates a 3840x3240 atlas and 161,740,800 bytes (154.25 MiB), saving 12,441,600 bytes
(11.87 MiB) from the prior 32-bit frontier planes. At 3840x2160 it costs 646,963,200 bytes (616.99
MiB), saving 49,766,400 bytes (47.46 MiB), before opaque driver metadata. Production cutover must
still select an explicit maximum portal-render pixel/byte budget before allocating these targets;
desktop texture-dimension support alone is not a memory-admission policy. No untraced automatic
resolution fallback is selected at this checkpoint.

`3x2` has the same bytes and aggregate preservation as `2x3`, but requires a materially wider
texture at every traced drawing buffer. The taller `2x3` orientation is therefore the simpler
device-capacity choice. Target creation still fails loudly when the fixed extent exceeds the actual
WebGL2 texture limit; no camera-time target resize, alternate packer, or hidden recursive fallback
is introduced. A later packer or larger policy must pay for itself with a new deterministic trace.

### Crossing Triangle-Stream Capacity Checkpoint — 2026-08-09

The expanded real-scene pass also records the exact indexed triangle vertices belonging to every
selected visibility aperture after all arrival-state and atlas cutoffs. Across the same 2,048
pose/aspect occurrences, the largest accepted stream is 1,122 vertices: the `0xec0effff`
maximum-fan-out family under the ultrawide source-near pose, with 254 retained crossings. The
largest single effective visibility aperture contributes 45 vertices. The maximum-fan-out
family's p99 stream is 972 vertices. These are decoded production apertures and production culler
selections; the trace does not infer triangle counts from authored polygon vertex counts because
reciprocal intersection apertures may be multipart or concave and are explicitly triangulated.

The selected first-cut capacity is 2,048 vertex records. At 24 bytes per record this is exactly
49,152 bytes (48 KiB) of CPU arena storage and the same fixed GPU buffer allocation. It leaves 926
records, or 82.5% capacity headroom over the corpus maximum. Every traced occurrence is preserved
by this capacity. An unseen overflow restores the deepest completed culler checkpoint until the
whole retained stream fits; it never clips one aperture, grows either buffer, or builds a fallback
draw list.

`PortalPropagationStreamArena` expands the final selected indexed apertures into one
non-indexed interleaved stream. Each record contains anchor-relative xyz `float32`, output arrival
id `uint32`, source-scope tile ordinal `uint32`, and the equal-depth policy bit `uint32`.
Topology-lifetime scalar landblock coordinates and selected-scope ordinals avoid camera-time
coordinate objects and scope-key construction. Arrival ids use zero for uncovered, one for root,
and selected crossing ordinal plus two thereafter. The planner verifies the final index count
before the arena writes; the arena then requires its copied count to equal that plan, so mutable
topology drift fails loudly.

The accepted CPU path has two bounded linear geometry passes: `O(I)` index reads to admit capacity,
then `O(I)` index reads and `3I` position-scalar reads to expand the stream. It creates zero
portal-owned frame records and performs no sort, slice, map construction, or storage growth. The
GPU owner allocates once per capacity event, performs one contiguous `bufferSubData` per changed
camera plan, and reuses one VAO for exactly one ordinary `drawArrays(TRIANGLES)` per propagation
round. Logical work is `D * X` crossing evaluations and physical vertex work is `D * I`, while CPU
submission remains `O(D)` and independent of `X`.

Ordinary instancing was rejected because retained crossings reference heterogeneous aperture
geometry. `WEBGL_multi_draw` was available on the focused target adapter, but requiring an
extension would retain per-aperture ranges and topology VAO complexity merely to save the bounded
expansion. The 48 KiB stream is smaller and simpler for the observed distribution and needs only
core WebGL2. A focused fixture—not a scene screenshot—proved the mixed float/integer attribute
layout through the production upload/draw owner and exact `R8UI` pixel readback on ANGLE/Vulkan
with the Radeon RX 7900 XT. The fixture contributes no topology, CPU-time, or visual-correctness
evidence.

### Oriented Arrival-Metadata Proof Checkpoint — 2026-08-09

The per-arrival question is resolved without another drawing-buffer-sized texture.
Every nonzero frontier value identifies either the root or one retained directed crossing. The
crossing identity already determines the destination scope, the reciprocal crossing to suppress,
and the source aperture plane. A fixed 32-byte std140 record therefore stores one anchor-space
oriented `vec4` plane followed by one `uvec4` route containing destination-scope ordinal,
reciprocal arrival id, and an entry-plane flag. The root record has scope ordinal zero and no entry
plane. The 255-record arrival section is exactly 8,160 bytes on both CPU and GPU.

The plane is oriented so its positive half-space lies beyond the directed entry aperture. For one
frontier pixel, an outgoing crossing is eligible only when its source scope matches the current
arrival route, it is not the explicitly named reciprocal, its aperture sample lies strictly beyond
the current entry plane, and source-scope local opaque depth does not occlude it. The existing shared
frontier depth then selects the nearest eligible crossing. The entry plane constrains later
crossings only; it does not clip target-scope geometry, preserving the cited retail behavior that
target geometry may protrude through its entry plane.

The key induction is strict per-pixel crossing depth. Every accepted transition lies strictly
beyond its entry plane, and one directed planar aperture intersects one camera ray at one fixed
depth. A directed arrival id therefore cannot recur on the same pixel even when the scope topology
contains a cycle. No visited-state bitset or extra frontier attachment is required. Round `r`
propagates the current frontier into the next while reducing the current source envelope at its
selected exit. On the final round, that same reduction command also reads the newly written next
frontier and folds each newly reached depth-`D` destination as unbounded. This preserves exactly
`D` propagation and `D` reduction commands; a `D + 1` command would be an implementation bug, not a
cost concession.

The independent shader-shaped executor uses packed `Float32Array`/`Uint32Array` metadata and one
byte-sized logical state per pixel rather than calling the accepted compositor. It matches the
accepted envelopes and the independent deferred compositor over all 3,980 bounded scenes, 128
seeded ten-crossing cycle scenes, each seed under crossing-storage reversal, an explicit terminal
frontier case, and a transparent/additive/particle case. A separate 2,048-case geometric lemma
proves Float32 plane orientation and landblock translation for both accepted sides across source,
plane, and beyond-plane ray samples. Every case reports zero repeated arrival-state pixels. This is
symbolic evidence only: no browser, screenshot, SwiftShader, or wall-clock timing contributes to
the result.

Production preparation is fused into the existing selected-crossing and triangle-expansion work.
Topology setup resolves reciprocal portal names once into a persistent `Int32Array`. Finalized
selection resets only the previously selected crossing markers and fills selected ordinal tables
during the existing crossing scan. The propagation arena then writes four plane scalars and three
route scalars per retained crossing while it already expands that crossing's triangle indices; it
creates no frame record, sort, slice, map, storage growth, or fallback. Root initialization is one
route record. Arrival data shares the propagation metadata block described below rather than owning
a second UBO or upload.

### Scope-Tile Metadata and Attachment Command Checkpoint — 2026-08-09

One scope record must support both directions of the reduction mapping: a drawing-buffer pixel to
the corresponding local-depth atlas pixel, and an instanced unit quad to the exact atlas tile
rectangle. Atlas scale/offset alone loses the original screen origin and tile extent, so the
minimal readable record selected here is six exact integers: atlas origin, screen origin, width,
and height. Two std140 `uvec4` slots occupy 32 bytes per record; the two spare integers are reserved
and written as zero. A 2,048-case deterministic algebra corpus proves screen-to-atlas mapping,
its inverse, and instanced atlas-NDC placement at tile edges and interior samples.

The fixed scope section is another 255 records, or 8,160 bytes. Arrival and scope sections share
one 16,320-byte propagation UBO and one CPU staging allocation. The camera path writes each selected
scope record once while preparing the existing propagation stream, then writes root/crossing
arrival records into the first section while expanding the already selected crossings. It creates
no per-scope record objects, new traversal, sort, slice, storage growth, or fallback. The combined
upload is one prefix ending after the populated scope records. Because the scope section follows
the full fixed arrival section, sparse frames transfer up to 8,128 bytes of unused arrival capacity;
this deliberate CPU-biased trade saves one `bufferSubData` call and one uniform-block binding while
leaving worst-case transfer bytes unchanged from two full buffers. The owner validates the actual
device `MAX_UNIFORM_BLOCK_SIZE` and binding-point capacity before allocation.

The fixed CPU propagation arena is therefore 65,472 bytes: 49,152 crossing-triangle bytes plus
16,320 combined metadata bytes. GPU buffer storage has the same fixed split. Each camera plan issues
one metadata upload and, when at least one crossing exists, one triangle-stream upload.

The proof-only attachment command compiler captures the shader-independent framebuffer, clear,
draw, ping-pong, and root-initialization contract without allocating a production frame schedule.
Round zero treats the root frontier implicitly. A root-only plan clears the envelope to unbounded
and performs no frontier work. A nonzero retained traversal depth `D` clears the envelope to
uncovered, then repeats one frontier framebuffer bind, separate `R8UI` state and depth clears, one
propagation draw, one envelope bind, and one instanced reduction draw per round. The final reduction
also folds newly reached depth-`D` destinations as unbounded. One output bind and one instanced
resolve finish either path.

For depth `D`, the exact attachment-owned ledger is one metadata upload, one crossing upload iff the
stream is non-empty, `2D + 2` framebuffer binds, one envelope clear, `D` integer-state clears, `D`
depth clears, and `2D + 1` draws. Reduction remains one draw with `S` instances per round; it adds
`O(S)` metadata writes to existing preparation but no per-scope CPU command. The immutable command
records are test proof machinery only. Production must issue the same scalar loop directly.
Program, VAO, texture/sampler, viewport, uniform, and blend/depth-state calls are intentionally not
claimed by this ledger; their exact sequence belongs to the shader/executor owner in the next
checkpoint.

The shared frontier depth attachment was changed from a renderbuffer to a same-format texture after
this command dry-run exposed that reduction must sample the winning crossing depth. This changes
neither the target byte formula nor framebuffer count. The focused real-GPU substrate fixture was
rerun on ANGLE/Vulkan with the AMD Radeon RX 7900 XT after that correction: framebuffer completeness,
resource lifecycle, integer state readback, and zero WebGL errors still held. It provides no
screenshot, semantic-oracle, or timing evidence.

`WebGL2PortalPropagationMetadataBuffer` allocates the combined store once, uploads without slicing
or reallocating, and disposes idempotently. Its deterministic fake-WebGL command ledger covers
allocation, binding restoration, combined-prefix upload, state-count consistency, bind-base range
checks, unsupported capacity, and disposal. Actual-browser UBO layout/readback belongs with the
propagation shader fixture; running a browser before a shader consumes this contract would add
ceremony without proving another fact.

### Task Checklist

- [x] Establish a visibility-only culler bridge with topology-stable integer adjacency, typed
      work-item fields, a reused non-retained frame view, and complete-frontier rollback.
- [x] Charge near-plane classification and polygon projection to one atomic primitive budget;
      expose typed capacity bytes and queue/window high water without timing.
- [x] Replace immutable window references, anchored-aperture allocations, and projector result
      records with the output-to-target polygon arena before production or trace integration.

- [x] Extract the monotone scope-window culler from `PortalRenderGraphPlanner`; keep its exact
      metered projection primitive total while deleting SCC/render-layer scheduling from the new
      execution contract.
- [x] Keep the immutable `PortalViewWindow` implementation as proof machinery. Implement a separate
      output-to-target production clipping kernel and prove it equivalent over the bounded, seeded,
      near-plane, multipart, and metamorphic projection corpora. This establishes kernel equivalence,
      not the full-culler drift gate.
- [x] Reuse the retained seeded geometry inputs in a test-only full-culler differential corpus; do
      not copy either clipping implementation into the generator or snapshot assertion.
- [x] Expand the differential corpus to hundreds of replayable topology/camera cases covering
      accumulated coverage, cycles, multipart apertures, near contact, footprint rejection, and
      cross-landblock anchoring. Report seed and case ordinal on every mismatch.
- [x] Apply storage-order and cyclic-index metamorphisms to the same generated inputs and require
      identical immutable-planner and arena-culler normalized scope windows before capacity work.
- [x] Replace module-lifetime capacity `Error` sentinels with fresh typed errors so a cutoff stack
      identifies the failing operation. Permit and trace exactly one diagnostic heap record for an
      exceptional cutoff; preserve frontier-atomic rollback and zero arena growth.
- [x] Add one production portal capacity-policy module after the differential gate. Give the Gate C
      depth value `16` one named `maximumPathDepth` owner and derive culler `maximumDepth` plus
      ordinary test and trace fixtures from it. Keep policy out of the culler kernel and do not
      create a depth-only constants file.
- [ ] Feed the same `maximumPathDepth` field into the production atlas propagation rounds and their
      diagnostics when that synchronous consumer is implemented.
- [x] Index topology-stable scopes, crossings, apertures, and adjacency with persistent integer ids.
      Do not construct scope-key strings, `Map`, `Set`, `Vec2`, polygon objects, or work-item objects
      during a camera planning pass.
- [x] Store the work queue and variable-length polygon data in structure-of-arrays typed buffers
      with integer offsets/counts, reusable double-buffer clipping scratch, touched-id selected-set
      reset, and explicit high-water bounds. Reset logical lengths without clearing or replacing
      backing storage.
- [x] Derive CPU arena capacities from the accepted state, work-item, polygon-primitive, and vertex
      budgets at topology/capacity setup. A camera pose that exceeds them rejects the deepest
      incomplete frontier atomically; it never grows an arena or creates a fallback object graph.
- [x] Expose a frame plan as a non-retained scalar view over arena storage.
- [x] Consume that view synchronously in production before the next planning pass. Any future
      retained/async consumer must request an explicit owned copy outside the renderer hot path.
- [x] Pack scope-window tiles transactionally and derive each tile transform once in the planner.
      Reject the deepest incomplete frontier when state, tile, or primitive capacity is exhausted.
- [x] Select one fixed `2x3` atlas extent from cross-aspect real-scene symbolic traces. Keep the
      extent in the production capacity contract, allocate no camera-dependent size, and preserve
      complete-frontier cutoff when the shelf packer cannot fit a deeper round.
- [x] Select `R8UI` frontier attachments from an independently traced 255-state capacity. Reserve
      zero for uncovered, decline complete frontiers before packing when retained arrival ids do not
      fit, and keep extent-only and id-capacity evidence separate.
- [x] Select a fixed 2,048-vertex crossing stream from the expanded cross-aspect real-scene trace.
      Count final aperture indices before packing, decline complete frontiers on overflow, expand
      once into a 48 KiB allocation-free arena, upload one contiguous prefix, and reuse one ordinary
      draw per propagation round without requiring `WEBGL_multi_draw`.
- [x] Pack root plus directed-crossing arrival metadata into a fixed 8,160-byte section of the
      combined arena/UBO during existing crossing expansion. Prove oriented-plane translation,
      strict per-pixel arrival progress, reciprocal suppression, final-round destination folding,
      and deferred transparent/particle equivalence symbolically before shader wiring.
- [x] Pack one six-integer scope-tile record per selected scope into the same fixed metadata block.
      Prove screen/atlas inversion and instanced tile placement, keep reduction to one instanced
      draw per round, and accept the sparse-prefix transfer concession to retain one metadata upload
      and one binding.
- [ ] Route each scope-homogeneous opaque submission to its tile with one shader-visible uniform;
      retain the existing run boundaries and prove that routing adds no submission. Do not add a
      per-instance scope attribute unless a later, separately traced cross-scope consolidation wins.
- [ ] Render and retain local scope depth before propagation; prove an opaque wall blocks a farther
      portal without clipping geometry that legitimately protrudes in front of the portal plane.
- [ ] Encode one arrival state per pixel in ping-pong integer frontier attachments, select the
      nearest valid outgoing portal with depth, and accumulate one scope envelope per round. The
      packed metadata algebra and exact command count are proved; WebGL2 shader/FBO refinement is
      not yet wired.
- [x] Record one envelope clear plus exactly `D` frontier-clear bundles, `D` propagation draws, `D`
      envelope-reduction draws, and one scope-atlas resolve for non-empty visibility. The physical
      attachment ledger expands each frontier bundle into separate integer-state and depth clears.
      No convergence readback or per-state command.
- [ ] Keep geometry/instance preparation independent from atlas allocation and pool attachments only
      by a proved non-overlapping lifetime.
- [x] Allocate scope color/local depth, ping-pong integer frontier state with shared selection depth,
      and depth-only scope-envelope targets transactionally. Reuse equal extents; preserve the old
      generation on partial failure; cover resize, disposal, device limits, exact bytes, binding
      restoration, and actual-browser framebuffer completeness without activating a shadow renderer.
- [ ] Reuse scope-reduction, opaque-routing, transparent-order, and particle-pack typed streams. Use
      explicit counts/ranges and caller-provided sort scratch rather than
      `map`/`filter`/spread/sorted-copy pipelines in portal-owned frame code. The crossing triangle
      and combined arrival/scope metadata streams are complete; their propagation shader remains
      unwired.
- [x] Trace arena capacity bytes, per-pool high-water counts, arena growth events, and portal-owned
      accepted-frame heap-record creation as separate unweighted dimensions. Fixed element widths
      make the high-water byte derivation mechanical. Extend the ledger with the allowed exceptional
      diagnostic record during sentinel cleanup; every allocation site names its lifetime owner and
      permitting event.
- [ ] After the structural ledger passes, use focused synthetic pixel readback for attachment format,
      integer/depth sampling, and blend semantics. Do not use scene screenshots, SwiftShader timing,
      or the browser harness as a semantic oracle.

### Acceptance Criteria

- The full arena culler matches the immutable planner across every retained deterministic case,
  existing seeded geometry case, expanded seeded topology/camera case, and required metamorphic
  variant. The comparison covers whole selected scope windows, not only visible/empty intersection.
- CPU culling remains bounded by admitted scope-window work and exact projection primitives; no
  operation or allocation scales with simple path count.
- At fixed topology, configured capacity, and drawing-buffer resources, every accepted camera plan
  performs zero portal-owned JS heap-record creations and zero CPU scratch-arena growth. An
  exceptional capacity cutoff may allocate exactly one fresh typed diagnostic error with an honest
  throw-site stack; it still performs zero arena growth and creates no fallback plan graph.
  Replaying deterministic accepted camera traces produces identical arena high-water values and no
  second-pass growth.
- CPU arena capacity and high-water bytes are explicit, budget-derived, and included beside the GPU
  atlas/frontier bytes. Capacity exhaustion declines a complete frontier with at most the one
  explicitly traced diagnostic allocation.
- Gate C's accepted path-depth value `16` has one production capacity-policy owner. The culler,
  propagation schedule, arena derivation, diagnostics, and ordinary fixtures consume that field and
  do not repeat a literal or independently derive it.
- The same policy owns the selected `2x3` atlas multiple, 255-state `R8UI` frontier capacity, and
  2,048-record crossing stream. At 1920x1080 the complete target set is exactly 161,740,800 bytes
  plus one 65,472-byte CPU propagation arena and 65,472 GPU buffer bytes; any capacity exhaustion
  declines a complete frontier and never resizes or repacks a GPU resource in response to camera
  motion.
- Every selected physical opaque compatibility batch is prepared and submitted once. Atlas routing
  does not create a draw per scope, arrival state, or tile.
- GPU command counts match the accepted `O(D)` ledger. Logical propagation work is bounded by
  `D * X` crossing evaluations, physical propagation work by `D * I` expanded triangle vertices,
  and scope reduction by `D * S` instances.
- Focused synthetic readback matches abstract opaque identities and occlusion for canonical
  re-entry/cycle shapes. The backend performs no topology inference.
- Target resize, disposal, context loss, capacity cutoff, and partial allocation failure are
  deterministic and leak-free.

### Decisions and Course Corrections

- WebGL fixtures prove only substrate refinement and browser behavior; the completed symbolic model
  remains the semantic oracle.
- Arrival ids are integer frontier data, not stencil ownership values. Shared stencil capacity is
  no longer a topology limit; state, atlas, and complete-frontier work budgets stop composition
  early and atomically.
- The immutable polygon implementation remains the readable semantic/projection proof. Production
  uses an arena-backed output-to-target kernel because cloning that immutable object graph at up to
  8,700 culler work items and 240,181 projection primitives would create avoidable young-generation
  pressure. Equivalence, not shared allocation strategy, keeps the two implementations honest. The
  full-culler seeded differential gate is the mandatory drift control for this permanent duplication;
  a few hand fixtures or kernel-only seeded intersections are insufficient.
- “Zero allocation” applies to accepted fixed-capacity camera plans, not exceptional diagnostics. A
  capacity cutoff may allocate one fresh typed error so its stack identifies the actual throw site;
  it may not allocate fallback work, grow backing storage, or partially retain the declined
  frontier. Engine-internal implementation details are neither claimed nor inferred. The structural
  ledger counts owned allocation sites rather than noisy wall-clock GC pauses.

## Phase 8: Deferred Transparency and Particle Composition

### Deliverables

- Explicit opaque and deferred-transparent renderer submission contracts.
- Correct cross-view ordering/unwind selected by the model.
- Frame particle storage prepared once and referenced by visibility submissions.
- Synthetic browser fixtures for transparent objects and particles across nested views.

### Task Checklist

- [ ] Split terrain/opaque/alpha-test work from alpha-blended/additive/particle work without
      duplicating prepared-state construction.
- [ ] Preserve the existing exact transparent compatibility and camera ordering rules within each
      selected visibility order.
- [ ] Classify alpha-test as opaque, alpha blend as ordered, and additive work according to the
      model's commutativity/depth rules.
- [ ] Pack particle instance data once per frame/domain owner and submit ranges without repeating
      uploads for repeated views.
- [ ] Ensure parent transparent fragments can compose over descendant opaque/transparent results
      when their depth requires it.
- [ ] Ensure child content cannot clip parent particles merely because ownership labels were not
      unwound.
- [ ] Cover weather and exterior-transparent work under the same path-specific rules.

### Acceptance Criteria

- Browser readback agrees with the oracle for parent/child alpha, additive, alpha-test, and
  particle cases.
- Particle-versus-equivalent-transparent-quad fixtures produce equivalent composition.
- No particle instance population is uploaded again merely because its domain has another view.
- Draw/run counts differ from the model cost vector only through documented backend batching.

### Decisions and Course Corrections

- A transparent result that merely “looks acceptable” does not pass. Ordered symbolic oracle
  equivalence is the acceptance contract.

## Phase 9: Integrated Real-Scene Operation Trace

### Deliverables

- Matched current/candidate operation traces over the Phase 6 real-scene workload set.
- Work-count and memory comparison against the Phase 0 baseline.
- A resteering decision accepting, revising, or reverting the production candidate.

### Task Checklist

- [ ] Run indoor-root, outdoor-root, hybrid re-entry, dense-cycle, near-plane, and particle-heavy
      archive poses and motion traces selected by the Phase 6 census.
- [ ] Record prepared domains, path views, merged submissions, repeated submissions, opaque and
      transparent runs, particle uploads/draws, masks/composites, targets/bytes, and WebGL errors.
- [ ] Trace planning, scene resolution, object preparation, run formation, transparent comparisons,
      particle packing, uploads, masks, composites, target changes, and WebGL command submissions as
      separate unweighted dimensions.
- [ ] Feed real-scene completed plans into an injected counting substrate so executor command traces
      require no browser, WebGL context, screenshots, frame settling, or wall-clock sampling.
- [ ] Compare current/candidate traces over identical inputs and preserve workload facts beside each
      vector. Use separate builds or commits; do not ship a runtime dual-planner mode merely to
      preserve the evaluator.
- [ ] Replay deterministic camera paths through every reported transition rather than tracing only
      fixed poses.

### Acceptance Criteria

- All known field cases compose correctly through movement.
- Domain preparation remains once per frame unless the selected model explicitly proves another
  preparation lifetime.
- Any additional offscreen bytes or GPU composites accompany a strict reduction in traced CPU-owned
  work, an explicit bounded non-dominated trade, or a correctness requirement.
- No unexplained object, particle, mask, upload, or submission count changes remain.
- Complexity bounds and real-scene traces show that the candidate does not merely move work from
  planning into preparation, ordering, submission, or allocation, and pathological work stops at
  the selected complete-frontier budget.

### Decisions and Course Corrections

- If the selected production candidate is dominated or exposes an unacceptable real-scene tail,
  revert it and select another already-proved model candidate. Do not mutate semantics to rescue
  its trace.

## Phase 10: Cleanup and Documentation

### Deliverables

- Removal of the retired domain-owned render-layer/SCC execution schedule and its vocabulary.
- Updated `docs/portal_rendering.md`.
- Final proof ledger, cost evidence, and rejected-candidate record in this plan.
- Lean permanent unit/model/browser coverage with temporary diagnostics removed.

### Task Checklist

- [ ] List every guarantee provided by the deleted planner/executor before removal and name its
      replacement.
- [ ] Delete dead layer, suffix, exterior-special-case, and ceremonial label contracts superseded
      by the selected view model.
- [ ] Sweep production code, tests, diagnostics, UI, harness labels, and documentation for retired
      vocabulary.
- [ ] Remove temporary archive probes, per-case logs, and hot-path instrumentation.
- [ ] Retain only metrics with a distinct performance/correctness scenario.
- [ ] Document model assumptions, proved rewrites, backend capacity limits, and failure behavior.
- [ ] Run formatting, production/test typechecking, complete tests, ESLint, Knip, Clippy with
      warnings denied, builds, focused browser substrate fixtures, archive gates, complexity checks,
      and deterministic operation traces.

### Acceptance Criteria

- Only historical plans mention the retired execution architecture.
- Production contracts expose domain preparation, path views, and submissions without duplicated
  or independently-derived fields.
- Permanent tests are deterministic, asset-independent, and each protects a live invariant.
- Documentation matches the selected implementation and proof ledger.

### Decisions and Course Corrections

- Cleanup is part of the cutover. Compatibility shims preserving the disproved schedule are not an
  acceptable final state.

## Risks and Mitigations

| Risk                                                                              | Mitigation                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The oracle accidentally copies candidate assumptions.                             | Keep ray/fragment traversal independent from layers, SCCs, labels, targets, and execution operations; require hand-derived fixtures first.                                  |
| Finite pixels omit continuous raster edge behavior.                               | Treat effective footprints as model input and retain focused projection and WebGL raster fixtures at the boundary.                                                          |
| Bounded search is mistaken for a universal proof.                                 | Label bounded evidence honestly and maintain explicit induction/algebraic proof obligations or a machine-checked theorem for universal claims.                              |
| Scenario enumeration explodes.                                                    | Use symmetry reduction, canonical identity ordering, small exhaustive bounds, seeded larger cases, and replayable minimization before adding a library.                     |
| A compositing budget is applied only after the planner constructs rejected paths. | Enumerate canonical breadth-first frontiers, reject the first over-budget frontier atomically, report lower-bound diagnostics, and never generate descendants.              |
| A trace counts the wrong proxy for CPU work.                                      | Derive the complexity ledger from actual code, trace primitive operations/allocations at their owner, and require a scenario where each dimension differs.                  |
| Reverse traversal is not a valid transparent order for all AC content.            | Let arbitrary fragment depths generate counterexamples; prove portal-separation constraints from content or select global cross-view ordering.                              |
| Multiple paths overlap at one pixel and lose parent provenance.                   | Preserve path fragments until a safe-union rewrite proves overlap harmless; include overlapping-projection cases in exhaustive search.                                      |
| More targets trade CPU work for excessive bandwidth.                              | Keep target/pixel/byte work separate from CPU-owned operations and accept only strict dominance or an explicit bounded Pareto trade.                                        |
| Per-domain caching adds lookup/copy work that prior experiments found costly.     | Trace lookup, validation, preparation, composites, and submissions separately; reject a cache that is dominated on real exterior workloads.                                 |
| Correct path views multiply domain submissions.                                   | Prepare once, union only proved-compatible views, reuse instance uploads/ranges, evaluate domain-layer caches, and expose unavoidable repeats explicitly.                   |
| Transparency breaks existing material batching.                                   | Reuse exact compatibility and adjacent camera-order rules; make visibility submission a hard outer boundary rather than a new material key per object.                      |
| Particle routing duplicates CPU work or uploads.                                  | Keep owner-to-domain routing separate from views and pack each owner's frame instances once before visibility submission.                                                   |
| Exterior caching transfers imprecise depth on some browsers.                      | Keep it a candidate until exact synthetic framebuffer readback passes on target browsers/GPUs.                                                                              |
| Model code becomes a second production planner.                                   | Keep model types isolated, pure, and test-only until a selected contract is deliberately ported; production never imports the oracle.                                       |
| Immutable window clipping creates per-frame young-generation churn.               | Keep it as proof code; use a budget-sized typed-array arena and output-to-target kernel in production, prove equivalence, and reject rather than grow on camera motion.     |
| Immutable and arena clipping drift after their deliberate dual implementation.    | Block production wiring on full-culler seeded differential and metamorphic corpora; share inputs and tolerances, never algorithmic clipping/admission helpers.              |
| A “zero-GC” claim hides exceptional diagnostics or arena/GPU-resource growth.     | Guarantee zero owned records only for accepted fixed-capacity plans; trace one allowed cutoff error separately from arena growth, topology/capacity, and resize allocation. |
| Gate C's depth 16 becomes duplicated substrate folklore.                          | Give the complete production capacity policy one `maximumPathDepth` owner; derive culler depth, propagation rounds, diagnostics, and ordinary fixtures from that field.     |
| Historical tests preserve dead architecture.                                      | Port only live semantic cases, then delete tests whose only purpose is old contract shape or call order.                                                                    |

## Definition of Done

- [x] The rejected portal prototype remains absent from production history and working code.
- [x] A pure finite model expresses indoor/outdoor re-entry, opaque, alpha-test, alpha blend,
      additive effects, and particles.
- [x] An independent oracle produces exact symbolic per-pixel composition and path provenance.
- [x] The abstract current executor reproduces all known field defects.
- [x] Bounded exhaustive and seeded property verification retain replayable minimal
      counterexamples.
- [x] Universal claims have explicit assumptions and induction/algebraic or machine-checked proof
      evidence.
- [x] At least one executor family is equivalent to the oracle across all accepted model evidence.
- [x] Candidate cost vectors and archive census identify the correctness/performance frontier.
- [x] Gate C accepts the production planner and schedule using code-derived complexity plus
      deterministic real-archive work traces before backend refinement begins.
- [ ] The selected production planner represents path-free arrival/frontier state and authored
      scope envelopes independently from prepared domains.
- [ ] Production budget enforcement bounds planner discovery as well as renderer execution, rejects
      whole frontiers deterministically, and does not compute exact rejected totals.
- [ ] At fixed topology/capacity/resource dimensions, every accepted portal plan creates no
      portal-owned JS heap records, grows no CPU arena, and retains no frame plan past the next
      planning pass. An exceptional cutoff creates at most one traced diagnostic error and no
      fallback graph.
- [x] The arena-backed projection kernel is equivalent to the immutable proof implementation over
      every retained exact, seeded, near-plane, multipart, and metamorphic projection case.
- [x] The complete arena culler is differentially equivalent to the immutable planner over retained
      fixtures, existing seeds, hundreds of expanded topology/camera cases, and storage-order
      metamorphisms, with replayable seed/case failures.
- [ ] One production capacity-policy contract owns Gate C's `maximumPathDepth: 16`; culler,
      propagation, arena derivation, diagnostics, and ordinary tests contain no duplicate literal.
- [ ] The selected backend refines the modeled executor and passes browser substrate fixtures.
- [ ] Opaque, alpha-tested, alpha-blended, additive, weather, and particle composition match the
      oracle.
- [ ] Domain content and particle instances are prepared/uploaded once per owning frame lifetime.
- [ ] Within-domain batches are split only at proved visibility-submission boundaries.
- [ ] Additional targets/composites have trace-backed justification and bounded lifecycle/memory.
- [ ] All reported transition sequences work through interactive movement.
- [ ] Matched real-scene operation traces contain no unexplained planning, preparation, ordering,
      allocation, upload, mask, composite, or submission changes.
- [ ] Retired planner/executor code and vocabulary are deleted in the same cutover.
- [ ] Documentation, tests, checks, lint, builds, focused browser substrate fixtures, archive gates,
      complexity proofs, and operation traces are complete.

## Resolved Model Questions

- Alpha must be globally camera-depth sorted; reverse ancestry is not assumed. Additive and particle
  work consumes the same admitted scope envelope.
- The finite oracle state is one path-specific scope occurrence, pixel, incoming crossing, and
  monotonically increasing entry depth.
- Sibling overlap is supported. Conflict coloring reuses labels for disjoint footprints without
  assuming the archive always supplies them.
- Safe merges are exact `(batch, ownership label)` merges, disjoint-label reuse, the scope-envelope
  deferred reduction, and the single-scope exterior cache. Domain identity alone proves none of
  them.
- Particle sources upload once and submit through scope envelopes; path views do not own particle
  buffers.
- Uint8 overflow, path-depth exhaustion, or potential-view exhaustion omits the first over-budget
  complete frontier before GPU mutation. The 257-view fixture proves the label-capacity route; the
  selected compositor matches the independently depth-capped oracle after every typed cutoff.
- The revised model validates cutoff semantics and budget selection over complete symbolic plans.
  It does not validate the Phase 6 streaming planner or claim that the current symbolic selector
  bounds its own discovery work.
- No Lean/SMT dependency is currently justified. The independent oracle, minimized weakened-model
  counterexamples, bounded/seeded equivalence, opaque induction, and deferred algebra cover the
  stabilized semantic claims.

## Remaining Production Questions

1. What explicit drawing-buffer pixel/byte budget admits the fixed `2x3` target without allowing a
   high-DPI or 4K viewport to consume an unreasonable share of GPU memory?
2. What exact program, VAO, texture/sampler, viewport, uniform, and fixed-function state sequence
   realizes the proved attachment loop without redundant state changes or hidden per-scope work?
3. Can any atlas/frontier attachment lifetime be pooled with an existing renderer target without
   adding framebuffer reattachment commands or coupling unrelated resize/context-loss ownership?
4. If later traces justify a more complex atlas packer or route-key cache, which explicit CPU-owned
   operation count pays for that added mechanism?
