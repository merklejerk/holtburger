# Plan: Generated Scenery Hybrid Baking

## Context & Boundaries

**Goal:** Remove the per-frame CPU and GPU cost of the generated scenery layer by baking its
order-independent geometry into per-landblock static buffers, while keeping the existing instanced
path only for the transparency orderings that genuinely need it.

This plan executes the remediation identified in
[the generated scenery performance investigation](holtburger-3d-generated-scenery-performance-investigation.md).
Read that document first; this plan does not restate its evidence.

**In scope:**

- Routing `opaque` and `alpha-test` generated scenery ranges through the existing baked static
  geometry path (`prepareBakedStaticObjectGeometry`).
- Retaining the instanced path (selection, per-frame upload, far-grouping, near-sorting) for
  `transparent` and `additive` generated ranges only.
- An Explorer follow mode: a toggle that re-anchors scene interest to the camera's landblock as
  the camera crosses boundaries, so free flight streams residency continuously and the bake
  toll is observable by a human, not only by harness relocation sweeps.
- Pre-cutover measurement gates: a bake-toll relocation sweep and an ordering-composition probe.
- Deleting mechanisms the cutover makes vestigial (2x2 sub-clustering, opaque-side per-instance
  selection, their metrics and vocabulary).

**Out of scope:**

- Global/anchor-relative instancing, broad-phase culling hierarchies, and draw state sorting
  (investigation Option B and §2.5). These are parked pending post-cutover re-measurement.
- Any change to the generated interest radius policy (stays at 2; retail used 1).
- Portal footprint culling, presentation footprint culling, and the particle owner-envelope path.
  These are separate consumers of `object-footprint.ts` and are untouched.
- Non-Explorer navigation features (pathing, player motion, autopilot camera movement). Follow
  mode only re-anchors interest; it does not move the camera.

## Ground Truth

- [Investigation doc](holtburger-3d-generated-scenery-performance-investigation.md) — profiler and
  V8 evidence, corrected GPU attribution, option analysis.
- `apps/holtburger-3d/src/lib/game/commit/static-object-geometry-worker.ts` — both existing paths:
  `prepareBakedStaticObjectGeometry` (buildings/objects precedent) and
  `prepareClusteredGeneratedScenery` (the path being replaced).
- `apps/holtburger-3d/src/lib/game/resolution/object-material-planner.ts` — `ObjectMaterialOrdering`
  (`opaque | alpha-test | transparent | additive`), the axis this plan splits on.
- `apps/holtburger-3d/src/lib/game/renderer/generated-instance-selection.ts` — the selector
  Phase 3 deletes outright (see the 2026-08-18 three-way-split decision; an earlier draft of
  this plan wrongly expected it to survive for a transparent residue).
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts` — batch key
  (`opaqueObjectInstanceBatchKey`), run preparation, footprint retention.
- `apps/holtburger-3d/src/lib/game/renderer/object-rendering-policy.ts` —
  `orderTransparentObjectRanges` near/far transparency policy, which survives unchanged.
- Harness: `apps/holtburger-3d/scripts/browser-harness.mjs` (`--profile-renderer`, `--cpu-profile`,
  `--relocate-landblock`, and `--relocate-sequence`/`--relocate-hop-ms` for sustained crossings).
  Measurement methodology per `apps/holtburger-3d/AGENTS.md`.
- Scenes: `0xda55ffff` (typical outdoor horizon), `0xf71effff` (transparency-heavy generated
  scenery; publishes no EnvCells, so omit `--env-cell-radius` there).

## North Stars

1. Per-frame cost must scale with what is drawn, not with how many instances were authored.
   Anything walked per object or per instance per frame for static content is a defect.
2. Addition through subtraction: the fix is primarily a deletion diff. Prefer removing a mechanism
   over optimizing it.
3. Split on the ordering axis, not the feature axis. "Baked vs instanced" is a property of a
   material range's ordering, never a per-scene or per-model policy knob.
4. The transparency pipeline's guarantees (near exact sort, far stable grouping) are preserved
   bit-for-bit; baking must never absorb a range whose draw order matters.
5. Measure before believing: every phase that changes renderer behavior ends with the same A/B
   harness capture, and no measured number becomes a standing budget in docs.
6. Follow mode is Explorer UX and stays app-local; the shared crates and worker gain no
   follow-mode concepts.

## Phased Implementation

### Phase 1: Measurement Gates

Establish the two facts the cutover design depends on, before writing cutover code.

**Deliverables:**

- Ordering-composition probe: extend the harness frame metrics (or a temporary worker-side census)
  to report generated scenery range counts **by `ObjectMaterialOrdering`** — today
  `transparentObjectCandidateCount` cannot distinguish `alpha-test` from true
  `transparent`/`additive`. Capture at `0xda55ffff` and `0xf71effff`.
- Bake-toll baseline: a `--relocate-landblock` sweep across several boundary crossings with a
  temporary bake-latency probe in the static object geometry worker, measuring per-landblock bake
  time and main-thread commit hitch for the **existing building baked path**. This is the toll
  Phase 3 will also pay.

**Acceptance criteria:**

- A table (recorded in this plan, with its configuration) of generated range counts per ordering
  for both scenes.
- Bake latency and commit hitch numbers for the building path, recorded here with configuration.
- Temporary probes that do not belong in production metrics are removed or clearly harness-scoped.

**Tasks:**

- [x] ~~Add per-ordering generated range counts~~ — unnecessary: existing metrics already split
      on the exact axis this plan needs (`submittedCompactedGeneratedDrawCount` filters
      `opaque | alpha-test`; transparent/additive draws are counted by ordering separately).
- [x] Capture ordering composition at `0xda55ffff` and `0xf71effff` (see Decisions).
- [x] ~~Instrument worker bake latency~~ — already instrumented: `workerDurationMs` flows into
      per-landblock `geometryWorkerDurationMs` in `staticObjectLayers` diagnostics. Relocation
      sweep run; results in Decisions.
- [x] Record findings and design corrections in Decisions below.

### Phase 2: Re-anchoring Readiness Audit

Follow mode is a small toggle sitting on a large untested surface: continuous interest re-issue
against an already-hydrated world. Most systems have only ever seen load-once interest or a
teleport-with-settle relocation. This phase proves the surface before Phase 2b makes the toggle
trivial to flip.

Already known safe from code survey (2026-08-18):

- The **render anchor already follows the camera every frame** (`game-runtime.ts` `drawFrame`
  input: `anchorLandblockId = camera.placement.landblockId`), so renderer-side re-anchoring is
  exercised by any boundary flight today.
- Particle origins are recomputed per frame from canonical scene space (`particle-system.ts`,
  `sceneOrigin - anchor`), so no particle state survives an anchor jump.

Unproven and audited here, each with a harness-driven repeated-crossing check:

- Residency diffing and eviction when interest shifts by one landblock instead of loading fresh:
  no full teardown/reload of the overlapping neighborhood, no leaked or double-freed resources.
- Worker pipeline behavior under churn: in-flight bake jobs for landblocks that leave interest
  (cancellation or harmless completion), queueing when crossings outpace bakes.
- **Commit spreading — measured, not hypothetical.** Texture readiness gates geometry
  publication (`static-layer-realizer.ts`: `Promise.all([geometry, atlasHandle.completion,
companion])`), and `replaceObjects` (`static-object-system.ts`) then runs fully synchronously
  on the main thread: geometry key reservation, one `createGeometry` (GL buffer allocation and
  upload) per geometry source, instance-stream publication, and a scene-node insert per object.
  Nothing queues, budgets, or chunks it — there is no throttling anywhere in the publication
  path and no tuning knob for one. The slow atlas was accidentally staggering these; with the
  atlas fixed, a crossing's ~54 layer publications can land in one tick. Measured: median worst
  streaming frame 20.0 ms → 25.7 ms, and 42.8 ms on the hop returning to a landblock evicted
  four hops earlier. The increase is entirely in the tick, not render, with mean tick cost
  unchanged. **This interacts directly with Phase 3:** baking replaces instanced draws with
  per-landblock vertex buffers, raising the geometry bytes uploaded per publication — the exact
  quantity this debt is sensitive to. See Open Questions.
- Resource lifetime across incremental add/remove: geometry ownership, texture atlas handles,
  static light binds.
- ~~Texture atlas epoch-rebuild churn~~ — **verdict: safe.** The
  [resident atlas incremental publication plan](holtburger-3d-resident-atlas-incremental-publication-plan.md)
  is complete. Verified over five consecutive crossings: zero page republishes per crossing,
  active page bytes flat at 70 MB (equal to peak), zero patch fallbacks, zero failed
  transactions, zero console errors. The noise floor this plan was waiting on is gone.
- Interest-snapshot consumers: static lights, audio residency/spatialization, EnvCell hydration,
  dynamics hydration — each either re-derives from the new snapshot or provably does not care.
- Retained anchor-relative (`RenderVector3`) state anywhere outside the per-frame paths verified
  above (see the coordinate-frame rules in `apps/holtburger-3d/AGENTS.md`).

**Deliverables:**

- A recorded audit verdict per system above: safe by construction (with the code citation), fixed
  in this phase, or deferred with a named consequence.
- Fixes for whatever the audit finds; each fix gets a harness reproduction first.
- A harness flag that re-issues interest along a scripted multi-boundary camera path — the
  audit's test rig, and Phase 2b's streaming capture tool.

**Acceptance criteria:**

- A scripted harness run crossing several boundaries with continuous interest re-issue completes
  with no browser errors, no resource-lifetime assertions, and stable memory/buffer metrics.
- Every system in the audit list has a recorded verdict in Decisions.

**Tasks:**

- [x] Harness scripted multi-boundary interest re-issue flag — `--relocate-sequence <hex,...>`
      with `--relocate-hop-ms`, resetting timing per hop so each crossing reports its own worst
      frame rather than a running maximum.
- [x] Audit + verdict per listed system; fix findings with reproductions (see Decisions:
      static-light eviction leak fixed, orphaned-companion release fixed).
- [x] Sweep for retained `RenderVector3` state outside per-frame derivation — clean.
- [x] Record verdicts and fixes in Decisions.

### Phase 2b: Explorer Follow Mode Toggle

The now-small toggle on the proven surface: while enabled, the Explorer frontend re-issues scene
interest centered on the camera's landblock whenever the camera crosses a boundary. Existing
free-flight controls do the moving; follow mode only re-anchors. App-local view-state concern.

**Acceptance criteria:**

- With follow mode on, flying across boundaries streams residency continuously without manual
  relocation; frame panel remains functional; no visual discontinuity at the crossing frame.
- A timed follow-mode flight is scriptable in the harness and reports frame timing stats.

**Tasks:**

- [x] Follow-mode toggle in Explorer view state, re-anchoring on camera landblock crossing —
      "Interest follows camera" in the World panel's Scene interest section.
- [x] Harness mirror: `--follow-flight <hex>` / `--follow-flight-ms <ms>` fly the camera in a
      straight line to the target landblock, re-anchoring interest on each crossing via the same
      policy, and report crossings plus flight-window frame timing.
- [x] Baseline follow-mode capture on current code (pre-cutover), recorded in Decisions.

### Phase 3: Hybrid Cutover

The main change. One decisive cutover per ordering class; no compatibility mode where both paths
can render the same range.

**Deliverables:**

- `static-object-geometry-worker.ts`: the worker already splits generated scenery three ways —
  instance-eligible parts to `static-fragment` streams, transform-ineligible parts to a baked
  `-fallback` unit, and `transparentMembers` to their own template flow
  (`prepareInstancedStaticObjectGeometry`). The cutover reroutes the first population (the
  opaque/alpha-test static fragments) into the baked output alongside the existing fallback, and
  deletes `prepareClusteredGeneratedScenery` plus the 2x2 `generatedSceneryClusterGridSize`
  sub-clustering. The transparent template flow is untouched — the "hybrid" is the architecture
  the worker already has, minus its instanced opaque middle.
- `generated-instance-selection.ts`: **deleted entirely.** The selector's only input is
  `static-fragment` streams; transparent templates travel as `frame-template` instances and never
  pass through it. With static fragments baked, the selector, the `static-fragment` instance
  kind, and the per-instance `classifyObjectFootprint` narrow phase all go.
- `webgl2-renderer.ts`: remove `static-fragment` branches from run formation, compatibility, the
  batch key, and submission; sweep `cohortKey` vocabulary from types and metrics.
- Metrics: baked scenery triangles fold into the baked static counters; generated-selection
  counters now describe only the residue. Remove counters that can no longer differ from an
  existing one.
- Tests: worker partition-by-ordering unit tests; selector tests updated for residue framing;
  delete tests that exist only to pin the clustered path.

**Acceptance criteria:**

- A/B harness captures at `0xda55ffff` and `0xf71effff` (`--gpu --profile-renderer --cpu-profile`)
  show, with the layer enabled: generated opaque draws collapse to per-landblock baked units;
  `generatedInstanceCullingMs` and instance upload bytes drop to the transparent residue;
  `formGroupedObjectInstanceRuns`, `classifyObjectFootprint`, and instance-rebinding functions no
  longer dominate the V8 profile diff.
- Transparency renders identically: near ranges still exact-sorted, far ranges still grouped;
  screenshot comparison at `0xf71effff` shows no visual regression.
- Streaming comparison uses the re-measured post-atlas baseline (see Decisions): **~0.5 ms of
  worst-frame cost per layer publication**, at 54 publications per single crossing. Report the
  median of at least five samples together with `staticLayerPublicationCount` for the window;
  single samples are not evidence here (identical 54-publication workloads spanned
  18.7-38.0 ms). Acceptance is that **cost per publication** does not materially regress — not
  that absolute frame time is unchanged, since baking legitimately moves geometry bytes per
  install.
- Typecheck, lint, unit tests, and knip (dead export detection) pass.

**Tasks:**

- [x] Partition generated parts by ordering in the worker; route baked portion
      (`prepareGeneratedSceneryGeometry`; additive bakes too — see Decisions).
- [x] Delete `prepareClusteredGeneratedScenery`, cluster grid tuning knob, and cluster-key
      namespaces.
- [x] Shrink instanced preparation to the transparent template flow — and further: the entire
      static instance stream mechanism died (`static-instance-stream-manager.ts`,
      `generated-instance-selection.ts`, the `static-fragment` instance kind, and the
      `InstancedStaticDrawUnit` variant deleted; `StaticObjectDrawUnit` collapsed to the baked
      shape with no discriminant).
- [x] Sweep cluster/cohort vocabulary from renderer types, batch key, and metrics
      (`cohortKey` survives only as the frame-template far-grouping key, which is load-bearing
      for dynamics and the transparent residue).
- [x] Update/rewrite affected worker and selector tests (selector tests deleted with the
      selector; worker suite rewritten around the hybrid split; 1156 tests pass).
- [x] Run the A/B captures and screenshot comparison; record results in Decisions.

### Phase 4: Re-measure & Resteer

**Deliverables:**

- Fresh captures at both scenes and a follow-mode streaming run on the cutover build.
- A decision, recorded here, on each parked item with the numbers that justify it:
  - Draw state sorting (§2.5): dead if program/texture churn collapsed with the draw count.
  - Broad-phase culling for the residue selector: dead unless residue selection still shows in
    profiles at transparency-heavy scenes.
  - Residue draw fragmentation: check whether the surviving transparent instanced draws warrant
    batch-key surgery, or whether far-grouping already batches them adequately (F71E baseline:
    ~47 instances/draw).
- Investigation doc updated with a closing pointer to this plan and its outcome.
- Dry-run the remaining phases against what was learned; reorder or expand as needed.

**Tasks:**

- [x] Post-cutover captures and follow-mode run; record deltas (Phase 3 A/B plus V8 profile
      captures at both scenes).
- [x] Decide each parked item; see Decisions.
- [x] Close the loop in the investigation doc (§4 Outcome added).

### Phase 5: Cleanup

**Deliverables:**

- Remove anything the cutover left vestigial that Phase 3's sweep missed: dead exports, orphaned
  tuning knobs, metrics with no distinct consumer, stale doc references to the clustered path
  (crate/app architecture docs included).
- Remove Phase 1 temporary probes if any survived.
- Itemized during Phases 1–4; the list below is appended as debt is discovered.

**Cleanup targets (append as found):**

- [x] ~~Phase 1 per-ordering census metrics~~ — moot: no new metrics were added; existing
      metrics already carried the split.
- [x] Phase 4 dry-run verdict: **nothing further.** The Phase 3 diff swept its own vocabulary
      (knip, lint, and the metric/type deletions landed together); no temporary probes were
      ever added; the only remaining textual references to the clustered path live in
      historical plan docs, which this repository retains unmodified by policy. Phase 5 closes
      empty.

## Risks & Mitigations

- **Bake hitch during streaming.** Baking moves cost from per-frame to per-residency-change, and
  scenery raises per-landblock bake volume. _Mitigation:_ Phase 1 measures the existing building
  bake toll first; Phase 3's acceptance explicitly compares against that baseline; Phase 2 gives a
  continuous human-observable surface. If hitches appear, amortize within the existing worker
  pipeline before inventing new mechanisms.
- **Ordering misclassification.** If `alpha-test` content is misclassified as `transparent` (or
  vice versa) the split lands wrong — either sorted content gets baked or bakeable content stays
  instanced. _Mitigation:_ Phase 1's per-ordering census validates classification against known
  scenes before the cutover depends on it.
- **Worker prep cost regression.** Generated-layer worker prep already averages ~51 ms per
  landblock cold — dominated by the clustered path being deleted. Baking replicates vertices,
  which raises pack cost, but removing per-cluster partition dedup should lower it; the net is
  unproven. _Mitigation:_ `geometryWorkerDurationMs` is the watch metric in Phase 3's A/B and
  the follow-mode streaming run.
- **VRAM/bake growth in dense-scenery regions.** Baking replicates vertices per instance.
  _Mitigation:_ radius is capped at 2 (25 landblocks); Phase 1 census sizes the worst observed
  scene; acceptance includes no unbounded buffer growth during follow-mode streaming.
- **Losing the pixel-area cull for baked orderings.** All baked instances vertex-shade when their
  landblock is in frustum. _Accepted:_ bounded by the radius policy; recorded in the
  investigation doc. Revisit only if radius policy changes.
- ~~**Streaming baselines conflate geometry and atlas costs.**~~ _Resolved:_ the atlas no longer
  republishes pages during a crossing, so streaming frame timing now reflects geometry commit
  work almost exclusively. The replacement confounder is commit densification (above): frame
  timing is now sensitive to how many publications coincide, so streaming comparisons must
  report the number of layer publications in the window alongside the timing.
- **Re-anchoring audit scope creep.** Phase 2 may uncover fixes larger than this plan (e.g.,
  residency diffing rework). _Mitigation:_ Phase 3 does not depend on Phases 2/2b — the bake
  toll is measurable via Phase 1 relocation sweeps — so large audit findings spin off into
  their own plan rather than blocking the cutover; record the fork in Decisions.
- **Hidden consumers of the clustered path.** Cluster namespaces or cohort keys may be load-bearing
  somewhere unexpected (resource ownership, eviction). _Mitigation:_ Phase 3 deletes rather than
  bypasses, so any surviving consumer fails loudly at typecheck or runtime instead of silently
  rendering stale state.

## Definition of Done

- [x] `opaque`/`alpha-test` generated scenery renders via per-landblock baked buffers; no
      per-frame selection, grouping, compaction, or upload for those orderings (additive
      bakes too; see Decisions).
- [x] `transparent` generated scenery renders via the frame-template instanced path with
      unchanged near/far ordering behavior (A/B: identical run/draw counts).
- [x] The clustered scenery path and its vocabulary are fully removed.
- [x] A/B captures at both reference scenes and a follow-mode streaming run are recorded in this
      plan with their configurations.
- [x] Explorer follow mode ships and is harness-scriptable.
- [x] Typecheck, lint (clippy-clean where Rust is touched), knip, unit tests, and prettier pass.
- [x] Parked items each have a recorded keep/kill decision with supporting numbers.

## Open Questions

- None currently. (The commit-budget sequencing question was resolved by the re-baseline;
  see Decisions.)

## Decisions and Course Corrections

- (2026-08-18) **Streaming baseline re-measured on the post-atlas build.** Configuration: harness
  `--gpu`, radii terrain/building 8, explicit/generated 2, RX 7900 XT, atlas uploads confirmed at
  **0 MB per crossing** in every run. A `staticLayerPublicationCount` diagnostic was added
  (incremented in the outdoor static publisher) so timing is always reported against the number of
  layer installs in the window.

  Single crossing `0xda55ffff → 0xda57ffff`, n=5 — **54 publications every run**, so the workload
  is exactly repeatable: worst frame work 18.7 / 25.3 / 25.9 / 27.4 / 38.0 ms, **median 25.9 ms**
  (worst gap median 28.6 ms). The 2x spread across identical workloads is why single samples are
  banned here.

  Sustained five hops, n=3, per-hop isolated:

  | hop        | publications | worst frame (median) | range     | active page MB |
  | ---------- | ------------ | -------------------- | --------- | -------------- |
  | 0xda57ffff | 54           | 22.8 ms              | 21.6-32.7 | 70             |
  | 0xda59ffff | 54           | 32.8 ms              | 19.1-39.2 | 70             |
  | 0xdc59ffff | 54           | 22.9 ms              | 19.5-33.4 | 70             |
  | 0xdc57ffff | 54           | 29.8 ms              | 28.4-30.8 | 70             |
  | 0xda55ffff | **96**       | **47.8 ms**          | 41.0-49.9 | 70             |

- (2026-08-18) **The baseline is a rate, not a number: ~0.5 ms of worst-frame cost per layer
  publication.** Across every window measured — 0.42, 0.61, 0.42, 0.55, 0.48 ms/publication at 54
  publications, and 0.50 at 96 — worst frame tracks publications in the window rather than which
  landblocks were crossed. The return hop is expensive because it re-hydrates a fully evicted
  neighborhood (96 publications, not 54), not because returning is special. Consequences:
  - Phase 3 is judged on **cost per publication**, not raw frame time. Baking changes the numerator
    (more geometry bytes per install) while publication count stays a property of the crossing, so
    a regression stays detectable even though absolute frame times move.
  - The hitch is already user-visible before any baking: 54-96 publications at ~0.5 ms each is a
    23-48 ms frame during every crossing.
  - Caveat: this relates total publications in a window to that window's worst frame; it is not a
    per-tick measurement. It predicts well across the range measured, but it is not a claim about
    how publications distribute across ticks.

- (2026-08-18) **Sequencing resolved: Phase 3 first, commit budget after.** A budget tuned now
  would be tuned against pre-bake per-publication costs that Phase 3 is specifically going to
  change, forcing a re-tune; and Phase 3's acceptance can already detect a regression without the
  budget, because it normalizes by publication count. The commit budget becomes its own plan after
  Phase 4's re-measure, designed against the real post-bake cost profile. Accepted consequence:
  streaming stays lumpy in the interim, which is fine in a development explorer and would not be
  in a shipping client.

- (2026-08-18) **Steered after the atlas plan completed.** Changes: the Phase 2 harness rig is
  built (`--relocate-sequence`); the atlas audit item has a verdict (safe, five crossings, VRAM
  flat); the commit-spreading audit item is now a measured cost with a named mechanism rather than
  a suspicion; the atlas-conflation risk is retired and replaced by a commit-densification
  confounder; the Phase 1 streaming-hitch baseline is marked superseded (single sample plus atlas
  contamination) and Phase 3's acceptance now points at a re-measured baseline; and Ground Truth
  was corrected to say Phase 3 deletes `generated-instance-selection.ts` outright, matching the
  earlier three-way-split finding rather than the original residue-selector framing.
- (2026-08-18) **Partial Phase 2 evidence from the atlas plan's sustained run** (five crossings,
  `0xda55 → 0xda57 → 0xda59 → 0xdc59 → 0xdc57 → 0xda55`, radii 8/2): residency diffing and
  eviction held across repeated crossings, resource lifetimes stayed bounded (active page bytes
  equal to peak, zero failed transactions), and no browser errors appeared. That covers the
  residency-diffing and resource-lifetime audit items for the atlas and static-object paths.
  Still unproven, and still Phase 2's job: worker in-flight bake cancellation under churn,
  interest-snapshot consumers (static lights, audio, EnvCell hydration, dynamics hydration), and
  the retained-`RenderVector3` sweep.

- (2026-08-18) **Phase 4 parked-item decisions.** Evidence: post-cutover V8 profiles
  (`--cpu-profile`, 8 s windows) at both scenes, plus the Phase 3 A/B.
  - **Draw state sorting (§2.5): dead.** Draw counts collapsed with the cutover and renderer
    CPU totals are 2.7/2.0 ms; per-draw uniform and atlas-binding work appears in the profile
    but nothing suggests program/texture churn dominates. Revisit only if a
    materially-diverse scene profiles hot on state switches.
  - **Broad-phase culling for residue selection: dead.** The per-instance narrow phase was
    deleted with the selector; `classifyObjectFootprint` fell to 99 ms/8 s at da55, all of it
    the retained owner-envelope path (dynamics, portals, presentations). The remaining
    per-template per-frame cost at f71e (~1.5 ms across `transparentSortFacts`, compatibility
    checks, and instance encoding for 2,290 templates) is the known ceiling of the residue
    pipeline — small in absolute terms; revisit only if template populations grow an order of
    magnitude.
  - **Residue draw fragmentation: dead.** Far-grouping batches the residue at ~55
    instances/draw at f71e (2,290 candidates in 42 draws), better than the pre-cutover ~47,
    because grouping now sees only templates. No batch-key surgery warranted.
  - **F71E GPU rise (1.30 → 3.54 ms): accepted for the explorer.** Radius-bounded by policy
    (2; retail used 1) and cheap on target hardware. Flagged as a candidate for the future
    client's performance pass — per-range distance cutoffs or baked LOD are the obvious
    mitigations if weaker GPUs need them. No code change now.
  - **Worker prep +15% and 3.2 MB/landblock baked geometry: accepted.** The bake emits three
    vertices per triangle with no cross-triangle dedup; indexed vertex dedup would shrink both
    numbers and is noted as a possible follow-up optimization, deliberately not done here —
    measure first if it ever matters.

- (2026-08-18) **Phase 3 cutover landed, A/B captured.** Configuration: `--gpu
--profile-renderer`, radii terrain/building 8, explicit/generated 2 (EnvCell 2 at
  `0xda55ffff`, omitted at `0xf71effff`), RX 7900 XT, single capture per scene plus n=5
  follow-flights.

  The mechanism: `prepareGeneratedSceneryGeometry` bakes every order-independent contribution
  (opaque, alpha-test, **and additive** — see below) into one merged per-landblock buffer via
  the buildings path; only transparent contributions of instance-eligible parts remain
  frame-streamed templates. Transform-ineligible parts bake wholly, their transparent triangles
  as sorted baked ranges — the semantics buildings always had. One render object per landblock
  layer replaces the 2x2 cluster objects. Deleted outright: the clustered path, the selector
  and its per-instance `classifyObjectFootprint` narrow phase (the function survives,
  unexported, inside `retainsProjectedObjectFootprint`), the static instance stream manager and
  its resource type family, the `static-fragment` instance kind, the `InstancedStaticDrawUnit`
  variant (the draw-unit union collapsed to one shape), the `strategy` diagnostics field, the
  `generatedInstanceCulling` profile phase, and seven per-frame selection/compaction metrics.
  `bakedFallbackRangeCount` renamed to `bakedRangeCount` — there is no fallback anymore, only
  the path.

  **Steady-state A/B (per frame):**

  | metric                            | da55 pre | da55 post     | f71e pre   | f71e post     |
  | --------------------------------- | -------- | ------------- | ---------- | ------------- |
  | generated instanced draws         | 315      | 0             | 191        | 0             |
  | generated instances uploaded      | 1,265    | 0             | 4,907      | 0             |
  | CPU generatedInstanceCullingMs    | 0.90     | phase deleted | 0.60       | phase deleted |
  | CPU instanceRunPreparationMs      | 1.05     | 0.12          | 0.58       | 0.24          |
  | CPU renderer total                | 6.22 ms  | **2.72 ms**   | 3.40 ms    | **1.98 ms**   |
  | GPU total                         | 2.79 ms  | **2.38 ms**   | 1.30 ms    | **3.54 ms**   |
  | far transparent candidates / runs | 708 / 18 | 717 / 18      | 2,255 / 42 | 2,290 / 42    |

  Transparency is bit-compatible: identical run and draw counts, near-sort still zero in both
  scenes. Screenshots differ by 0.3-0.4% of pixels — scattered single-pixel speckles from
  previously pixel-area-culled small instances now rendering, no structural change.

  **The honest wrinkle: F71E GPU total rose 1.30 → 3.54 ms.** Losing the per-instance
  pixel-area cull means every baked instance vertex-shades and rasterizes when its landblock is
  in frustum — submitted baked triangles at f71e went 3.3k → 384k (da55: 55k → 456k). The plan
  accepted this risk as radius-bounded; the number now exists and Phase 4 owns the
  keep/mitigate decision. Note the per-phase GPU buckets (terrainMs +1.2 in both scenes,
  f71e blendedMs 0.1 → 2.0) shifted in ways that look like timer-span attribution artifacts;
  treat totals as the comparable figure, per the investigation doc's attribution lesson.

  **Streaming (like-for-like 20 s flights, `0xda55ffff → 0xda59ffff`, n=5, 108 publications
  and 4 crossings every run):** worst frame work median 32.2 → **24.8 ms** (range 20.8-27.3 vs
  27.1-47.7), average in-flight frame work 5.4 → **2.6 ms**, zero console errors. Cost per
  publication in the worst frame ~1.19 → ~0.92 ms.

  **Costs, recorded plainly:** generated worker prep rose ~15% (cold mean 50.9 → 58.4 ms,
  max 133 → 181 ms per landblock) — vertex replication outweighs the deleted per-cluster
  dedup; it runs off-thread and streaming worst-frames still improved. Baked generated
  geometry is **79.9 MB for the 25-landblock neighborhood (~3.2 MB/landblock)** at da55,
  the VRAM-growth risk realized within its radius bound. Template residue is tiny: 1,332
  transparent templates sharing <0.1 MB of partition geometry.

- (2026-08-18) **Additive bakes; the template flow stays transparent-only.** The in-scope
  statement said additive would remain instanced, but additive blending commutes, so baked
  additive ranges draw identically regardless of merge order — and they are the exact mechanism
  buildings already use. Keeping additive instanced would instead have required adding an
  ordering field to `FrameStreamedObjectInstanceTemplate` and touching the transparency
  pipeline this plan promised not to touch. Census found zero additive generated content in
  both reference scenes, so the choice is unobservable today; the worker test suite pins the
  additive-bakes contract.

- (2026-08-18) **Phase 2b complete: follow mode shipped, pre-cutover streaming baseline
  captured.** The Explorer toggle ("Interest follows camera", World panel) applies the whole
  policy in one place: when the synced camera residency resolves to a landblock different from
  the last interest anchor, re-issue the same radii centred there (`ExplorerApp.svelte`
  `followCameraSceneInterest`). It updates scene and simulation interest only — the camera never
  moves and the coordinator focus flow is bypassed, so no automatic placement fires. Inert until
  a manual request establishes radii. Works in free-fly and physical camera modes alike.

  The harness mirror (`runFollowFlight`, driven by `--follow-flight`/`--follow-flight-ms`) flies
  the camera linearly to a target landblock inside the real frame loop, re-anchoring with the
  retained radii on each crossing, and reports the crossing log, publications in the flight
  window, and flight-window timing.

  **Baseline (pre-cutover), the Phase 3/4 comparison target.** Configuration: `--gpu`, radii
  terrain/building 8, EnvCell/explicit/generated 2, flight `0xda55ffff → 0xda59ffff` over 20 s
  (four single-block crossings at 5 s intervals), n=5. Every run: 4 crossings, **108
  publications** (27 per single-block crossing), zero console errors. Worst frame work median
  **32.2 ms** (range 27.1–47.7); worst frame gap median 35.5 ms (range 33.0–63.0); average frame
  work median 5.4 ms. Note the in-flight worst-frame cost per publication (~1.2 ms at 27
  publications per crossing) runs above the stationary-crossing rate (~0.5 ms at 54); flight
  frames pay commit and full rendering in the same frame, so cutover comparisons must use
  like-for-like flights, not the stationary rate.

- (2026-08-18) **Phase 2 audit complete.** Verdict per system, with the churn rig: nine interest
  re-issues at 250 ms intervals (faster than bake throughput, with quick leave-and-re-enter
  hops), plus a five-hop tour at 4 s intervals, both ending at the starting landblock and
  compared against a clean single load there. Configuration: `--gpu`, radii terrain/building 8,
  EnvCell/explicit/generated 2.
  - **Residency diffing/eviction under continuous re-issue: safe.** After churn stops, every
    resource count converges exactly to the clean-load value (geometry 1638, nodes 256, owners
    351, atlas pages 5, resident textures 291) — no leaks, no over-eviction, zero console
    errors in every run.
  - **Worker pipeline under churn: correct but unthrottled.** No cancellation exists anywhere:
    a landblock leaving interest never cancels its in-flight or queued bake; stale results are
    dropped at publication by three revision gates (`static-layer-realizer.ts` `#realize`:
    atlas completion `withdrawn`, `#isCurrent` pre-publish, post-publish re-check with
    `removeExact` repair). Duplicate revisions for the same layer may run concurrently by
    design (`#pending` is per-revision; resource ids are revision-namespaced; evictions are
    revision-guarded `<=`/`===`). The single geometry worker's queue is unbounded and obsolete
    jobs still bake fully before being dropped, so sustained 250 ms crossings put hydration
    seconds behind — measured as publication counts flatlining mid-churn, then converging
    within 15 s of the last hop. **Named debt, deferred:** queue pruning/cancellation belongs
    with the commit-budget plan after Phase 4, when post-bake job sizes are known; the
    consequence accepted meanwhile is lag, not corruption.
  - **Interest-snapshot consumers: one real defect, fixed.** The `OutdoorLightIndex` was
    publish-only — `install` ran on every layer `replace`, but neither interest eviction nor
    stale-publish repair ever removed entries, so evicted landblocks kept lighting resident
    neighbours via the nine-cell fan-out and the index grew without bound. Reproduced with the
    new `outdoorLightScopeCount` diagnostic: clean load at `0xda55ffff` owns 5 scopes; a
    five-hop tour returning there left 8. **Fix:** revision-stamped entries with `evict`
    (`revision <=`) and `removeExact` (`===`) mirroring `StaticObjectSystem` semantics, wired
    into the same outdoor publisher callbacks that install — so the late-eviction-vs-re-entry
    race cannot delete a newer revision's lamps. Post-fix, all three runs converge to exactly
    5 scopes. Audio (frame-rate re-derivation off terrain installation revision), EnvCells
    (revision-guarded evict/replace with rollback), dynamics (owner-replace with
    currentness-gated commit; spawned dynamics are interest-independent), and the host/page
    boundary (revision-monotonic delta reconcile, no first-interest latch) are all safe by
    construction.
  - **Resource lifetime: one leak edge, fixed.** `StaticLayerRealizer.#realize` starts the
    companion preparation before failure is knowable; a geometry rejection racing a
    still-pending companion left the companion's staged resources unowned and unreleased
    forever. Fixed by releasing the companion on settlement from the catch path; regression
    test added.
  - **Retained `RenderVector3` sweep: clean.** Every retained position is landblock-local or
    scene-canonical with anchor math done per frame; the two persistent anchor-relative sites
    (generated-instance selection cache, particle cohort origins) are respectively cleared
    per view with a hard throw on frame mismatch, and rewritten in place every tick before the
    draw that consumes them. Enforcement is convention + branding; no unbranded retained
    position exists today.
  - **Harness additions:** brief reports now include `relocationSequence`/`relocationState`
    (previously silently dropped, making per-hop evidence invisible), and per-hop capture plus
    `staticResourceCounts` carry `outdoorLightScopeCount`.

- (2026-08-18) Plan created from the investigation's Option A, reshaped to a hybrid split on
  `ObjectMaterialOrdering` after the F71E probe showed 1,140 transparent generated instances with
  zero in near-sort range — transparency stays instanced, order-independent content bakes.
- (2026-08-18) Follow mode pulled forward from the roadmap into Phase 2 so streaming cost is
  observable during, not after, the cutover. Clarified scope: follow mode re-anchors interest
  to the camera's landblock; it does not move the camera.
- (2026-08-18) Per-ordering census metrics are kept past Phase 1 only if Phase 4 consults
  them; listed as a Phase 5 cleanup target.
- (2026-08-18) **Phase 1 census complete.** Configuration: harness `--gpu`, radii
  terrain/building 8, explicit/generated 2, `--explorer-focus`-equivalent poses, RX 7900 XT.
  Generated scenery instances by ordering class, per scene:
  - `0xda55ffff` (horizon): **821 bakeable** (opaque+alpha-test, 220 draws) vs **~231 transparent**
    (all far-grouped, 9 draws), 0 additive, 0 near-sorted.
  - `0xf71effff` (transparency-heavy): **2,985 bakeable** (109 draws) vs **1,140 transparent**
    (all far-grouped, 24 draws), 0 additive, 0 near-sorted.
    Bakeable share 72–77% in both scenes; near-sort demand zero in both. No new metrics were
    needed — the existing `submittedCompactedGenerated*` counters already filter to
    `opaque | alpha-test` and transparent/additive draws are counted by ordering.
- (2026-08-18) **Phase 1 bake toll measured.** Same configuration, relocation `0xda55ffff` →
  `0xda57ffff` (2-landblock shift against a hydrated world):
  - Worker prep, cold load: generated layer mean **50.9 ms** / max **133 ms** per landblock —
    already ~250x buildings (mean 0.2 ms / max 9.8 ms). The clustered path's prep is the
    dominant worker cost today.
  - Worker prep, warm streaming: 54 new layer entries, mean **7.6 ms** / max **74 ms**.
  - ~~Main-thread streaming hitch: worst frame work 38.8 ms, worst frame gap 46 ms.~~
    **Superseded — do not use as the Phase 3 baseline.** Two defects: it was a single sample,
    and repeated sampling later put the pre-atlas median at **20.0 ms** (range 18.5–38.8), so
    38.8 was an outlier; and it conflated geometry commit with atlas republish churn that no
    longer exists. The worker-prep numbers above are unaffected — they are worker-side and
    independent of the atlas.
- (2026-08-18) **Worker already implements the three-way split.**
  `prepareInstancedStaticObjectGeometry` routes transform-ineligible parts to a baked fallback
  and transparent members to a separate template flow (per-block census at `0xda55ffff`: 8,361
  static-fragment instances across **2,375 cohorts**, 1,332 transparent template instances across
  22 cohorts, 142 baked-fallback ranges). Consequences: Phase 3 is a reroute of the
  static-fragment population into the existing baked output, not a new partition; the transparent
  path needs no changes; and `generated-instance-selection.ts` returns to **full deletion** —
  transparent templates never pass through it.
- (2026-08-18) **Texture atlas repack churn under streaming quantified** (same relocation
  capture, `staticObjects.texture` diagnostics). The resident atlas rebuilds per purpose-epoch:
  the 2-landblock shift added only **7 resident textures (464 KB source)** yet caused **8 full
  atlas-page republishes (117 MB uploaded)**, 57 MB of source copies, 139 MB of pages released,
  and 35 compaction attempts — ~250x write amplification on inserted source bytes. A single
  publication op measured **26.2 ms** (`longestAtlasPublicationDurationMs`), which likely
  dominates the 38.8 ms streaming hitch previously attributed to geometry commit. Initial load
  shows the same pattern: 142 MB uploaded to arrive at 70 MB of active pages. Consequences:
  - Steady-state measurements (the investigation doc) are unaffected — the atlas is quiescent
    (`pendingAtlasRequirements` 0) by measure time.
  - The streaming-hitch baseline is a composite; Phase 3's A/B must watch the atlas counters
    (`uploadedAtlasPageBytes`, `attemptedAtlasCompactions`, `atlasPublicationDurationMs`)
    alongside frame timing to compare like for like.
  - Follow mode (2b) will hit this continuously; atlas churn may dominate streaming cost ahead
    of anything this plan changes.
- (2026-08-18) **Phase 2 first evidence, from the relocation sweep:** a single interest re-issue
  against a hydrated world streamed incrementally — stable layer counts (289/25/25), 54 new
  entries, evictions clean, zero console errors. One crossing is not continuous crossing, but the
  diffing foundation the audit worried about exists and held.
- (2026-08-18) **Harness fixes landed during Phase 1:** the relocation and
  disable-generated-before-capture paths passed 7 arguments to the 8-argument
  `requestSceneInterest` (terrain radius was added to the page API without updating these call
  sites — relocation was broken for anyone); fixed. `resetTiming` now runs before relocation so
  `relocationState.timing` isolates the streaming window.
- (2026-08-18) Phase 2 split into a re-anchoring readiness audit (2) and the follow-mode
  toggle (2b) after recognizing that continuous interest re-issue against a hydrated world is
  an untested surface; the toggle is trivial, the surface is not. Phase 3 explicitly does not
  depend on Phase 2/2b.
