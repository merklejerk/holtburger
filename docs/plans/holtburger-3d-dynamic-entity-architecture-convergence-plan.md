# Holtburger 3D Dynamic Entity Architecture Convergence Plan

Status: Complete (2026-08-01)
Created: 2026-08-01
Updated: 2026-08-01 after post-completion recovery-scope correction
Canonical implementation base: `3d-next` at `c09eb3c2`
Donor implementation: `claude` at `c938a438`
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`

## Context and Boundaries

### Goal

Converge the two independently implemented dynamic-entity slices into one honest roadmap and one
clean final architecture: retain `3d-next`'s staged frontend runtime, selectively reimplement the
Claude branch's proven effects, and reshape the spawned-entity plan around one shared world runtime
and a reconstructable view-event path used by explorer and future client drivers.

### Problem Statement

The branches share a common renderer baseline and each completed a first static-authored dynamic
slice, but they reached materially different intermediate and planned architectures:

- `3d-next` has stronger departed-frame traversal, resource ownership, activation gating,
  conservative bounds, atomic owner replacement, unsupported-visual fallback, and representative
  workload validation.
- `claude` proves useful `TransparentPart` behavior, a closed retail hook vocabulary, per-part
  render-state effects, and a compelling one-feed/two-drivers host topology.
- `claude` also publishes entities before asynchronous resources are ready, skips hooks when one
  update crosses multiple frames, mixes runtime-body events with commit-bundle spawn concepts, and
  introduces future motion/appearance/attachment shapes before they have production consumers.
- The pre-convergence `3d-next` roadmap proposed an app-local `ExplorerRuntime` and frontend
  placement projection without sharply distinguishing host-authoritative placement/residency from
  predicted rendered placement.

A whole-commit merge or compatibility layer would retain two answers for template caching,
animation playback, hook routing, mutation feeds, and motion ownership. This plan instead makes a
clean architectural cutover and records donor evidence without claiming donor code has landed.

### Canonical Provenance Vocabulary

Every affected plan uses these terms consistently:

- **Complete on `3d-next`**: implementation is present and verified on the canonical branch.
- **Complete on `claude` only**: implementation is real on the donor branch but is not part of the
  canonical runtime.
- **Donor-proven**: behavior, reference evidence, or a focused mechanism is suitable for adaptation;
  no implementation credit is claimed on `3d-next`.
- **Planned**: selected future architecture without a landed implementation.
- **Superseded**: retained for historical evidence but rejected as the canonical execution path.

Plan checkboxes may be checked only when their implementation and acceptance evidence exist in the
same worktree as the plan. Donor tests, harness runs, and reference findings may be cited as evidence,
but they never satisfy a canonical implementation deliverable by themselves.

### In Scope

- Establish `3d-next` as the single canonical implementation base.
- Preserve the completed `3d-next` static-authored animation plan as an execution record.
- Update the canonical roadmap, queued effects plan, and spawned-entity plan to reflect the
  convergence decision and honest progress.
- Label Claude's plans branch-locally as donor execution/design records rather than competing canon.
- Converge geometry and atlas residency behind one content-addressed visual-template repository used by
  authored and future spawned dynamic owners.
- Reimplement proven `TransparentPart` DAT decoding and transport on the canonical branch.
- Extend the canonical typed hook model and staged activation path with per-part translucency.
- Preserve semantic traversal of every departed frame and retain `3d-next`'s smooth render-cadence
  rigid-pose interpolation as canonical presentation behavior.
- Dry-run the existing `holtburger-world` / `holtburger-core` runtime-body and view-event contracts
  before designing any new feed.
- Reshape spawned runtime architecture around one authoritative world runtime, two drivers, and one
  complete initial-state plus ordered-delta contract.
- Define focused mutation, complete replacement, attachment, motion, placement,
  correction, and residency ownership before spawned implementation begins.
- Remove donor-shaped adapters, dormant types, duplicate runtime concepts, and obsolete vocabulary
  introduced during convergence.

### Out of Scope

- Merging or cherry-picking Claude's complete implementation commit.
- Maintaining both animation systems, template managers, effect routers, or spawned feeds.
- Implementing spawned entities, networking, complete motion tables, physics, particles, or audio in
  this convergence plan.
- Moving explorer UI or control policy out of `apps/holtburger-3d`.
- Creating a universal base class for explorer and network client runtimes.
- Treating frontend-predicted placement as authoritative world state.
- Adding generic interpolation policies, appearance digests, attachment state, or motion graph types
  before a phase has a production consumer.
- Staging or committing changes; git history remains user-owned unless separately requested.

## Ground Truth and Existing Precedent

### Branch and Plan Evidence

- Canonical landed slice: `c09eb3c2` (`Add static-authored dynamic animation runtime`).
- Donor landed slice: `c938a438` (`feat(holtburger-3d): render and animate static-authored dynamic entities`).
- Canonical roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`.
- Canonical completed slice: `docs/plans/holtburger-3d-static-authored-animation-runtime-plan.md`.
- Canonical queued effects work: `docs/plans/holtburger-3d-static-authored-effects-runtime-plan.md`.
- Canonical spawned work: `docs/plans/holtburger-3d-explorer-weenie-dynamic-runtime-plan.md`,
  complete 2026-08-17. It preempted `holtburger-3d-spawned-entity-explorer-runtime-plan.md`, which
  remains a historical evidence record only.
- Donor baseline execution record:
  `.worktrees/claude/docs/plans/holtburger-3d-static-dynamics-baseline-plan.md`.
- Donor full-fidelity proposal:
  `.worktrees/claude/docs/plans/holtburger-3d-static-dynamics-full-fidelity-plan.md`.
- Donor spawned proposal:
  `.worktrees/claude/docs/plans/holtburger-3d-host-sim-spawned-entities-plan.md`.

### Retail and Format References

- `acclient-eor-source/acclient.c`
  - `CSequence::update_internal`: visits every departed animation frame and executes hooks in
    traversal order.
  - `CSequence::get_curr_animframe`: floors semantic frame position.
  - `CPhysicsObj::animate_static_object`: setup-default animation and static `SetOmega` cadence.
  - `TransparentPartHook::Execute`: routes `{ part, start, end, time }` to part translucency.
  - `CPhysicsPart::set_translucency`: full translucency suppresses drawing.
  - object-maintenance and part-array mutation paths: focused visual change versus complete object
    replacement.
- `acclient-eor-source/acclient.h`
  - `TransparentPartHook`, `SetOmegaHook`, and the closed `CAnimHook` subclass vocabulary.
- `ACE/Source/ACE.DatLoader/Entity/AnimationHooks/TransparentPartHook.cs`
  - proven `u32 + f32 + f32 + f32` payload layout.
- `ACE/Source/ACE.DatLoader/Entity/AnimationHook.cs`
  - parsed hook vocabulary and direction values.
- `ACE/Source/ACE.DatLoader/FileTypes/MotionTable.cs`
  - authored motion styles, links, animation ranges/rates, velocity, and omega.
- `ACViewer/ACViewer/Physics/Animation/Sequence.cs`
  - supporting direction-filter and frame-selection behavior.

### Canonical Runtime Patterns to Preserve

- `apps/holtburger-3d/src/lib/game/systems/dynamic-entity-system.ts`
  - generation-aware staged owner replacement and complete active part records.
- `apps/holtburger-3d/src/lib/game/systems/object-visual-template-repository.ts`
  - shared immutable preparation and complete template-owned geometry/atlas residency with explicit
    staged and committed consumer references.
- `apps/holtburger-3d/src/lib/game/animation/animation-asset-repository.ts`
  - shared animation acquisition and deterministic release.
- `apps/holtburger-3d/src/lib/game/animation/prepared-dynamic-animation.ts`
  - appearance/clip validation, conservative bounds, and static visual fallback.
- `apps/holtburger-3d/src/lib/game/systems/animation-system.ts`
  - separate semantic traversal and render-cadence sampling.
- `apps/holtburger-3d/src/lib/game/systems/effect-system.ts`
  - persistent hook state and provenance.
- `apps/holtburger-3d/src/lib/game/runtime/static-layer-realizer.ts`
  - prepare-before-publish companion cutover.
- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
  - runtime composition and authored-dynamic companion activation.

### Donor Mechanisms Worth Reimplementing, Not Transplanting Whole

- `crates/holtburger-dat/src/file_type/setup_model.rs`
  - typed `TransparentPart` payload.
- `apps/holtburger-3d/src/lib/game/systems/effect-system.ts`
  - per-entity spin, per-part translucency, timed ramps, and derived deferred vocabulary.
- `apps/holtburger-3d/src/lib/game/systems/components.ts`
  - composite part render state and effect timeline concepts.
- `apps/holtburger-3d/src/lib/game/renderer/render-world.ts`
  - full-translucency suppression and dynamic transparent reclassification.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
  - instance-alpha consumption without widening the instance record.
- `.worktrees/claude/docs/plans/holtburger-3d-host-sim-spawned-entities-plan.md`
  - one world runtime/feed with explorer and future network drivers.

## Post-Completion Recovery-Scope Correction — 2026-08-01

The Phase 6 audit result remains accurate: the current `RequestInitialViewState` cannot reconstruct
spawned entity presentation because it omits complete entities and lossless appearance. The original
Phase 7 remedy overreached from that gap to a mandatory stateful projector, feed epoch, global
sequence, and permanent world generation tombstones.

After review, the selected architecture is smaller:

- retain the existing ordered `ClientViewEvent` broadcast and its focused deltas;
- add one complete `InitialWorldStateSnapshot` event to the existing initial-state request;
- subscribe before requesting that snapshot and ignore entity deltas until it arrives;
- use Tokio broadcast's explicit `Lagged` result to stop entity delivery and request a fresh snapshot;
- retain `DynamicEntitySystem`'s existing owner generations to reject stale asynchronous frontend
  preparation across despawn, same-GUID respawn, and complete replacement; and
- verify the Tauri listener/relay boundary before adding any sequence or acknowledgement metadata.

The unexecuted spawned plan has been rewritten around that cut. Phase 6 and Phase 7 below remain the
historical audit and initial design record; this addendum and the revised final contracts supersede
their stateful-projector, epoch, global-sequence, and world-generation-tombstone decisions. No landed
convergence implementation changed.

## Final Architectural Contracts

1. `3d-next` is the only canonical implementation base. Claude remains a donor record.
2. One frontend dynamic presentation runtime serves authored and spawned entities.
3. One content-addressed visual-template repository owns immutable preparation plus geometry and
   atlas residency lifetime for authored and spawned consumers.
4. One animation system visits every departed semantic frame and publishes presentation samples.
5. Semantic frame/hook traversal is discrete while rigid-part poses remain smoothly interpolated at
   render cadence. Smooth sampling is required canonical presentation behavior; it never triggers
   hooks or changes authoritative motion.
6. Animation frames and physics scripts produce one typed hook vocabulary consumed by named effect,
   audio, particle, structural, or semantic owners.
7. Unsupported behavior is classified by consequence: harmless deferred effects stay observable;
   unsupported visual or structural behavior blocks animated activation or routes to a named loud seam.
8. Dynamic publication is atomic across templates, animation assets, initial hook/effect state,
   bounds, scene nodes, and owner replacement.
9. `holtburger-world` owns authoritative identity, lifecycle operations, appearance, attachment,
   placement, spatial residency, and semantic motion state.
10. Explorer commands and network messages are two drivers of the same world-domain mutation model.
11. The existing `ClientViewEvent` model crosses the host/frontend boundary. App-local Tauri DTOs may
    serialize it but may not create a second authoritative entity model.
12. Entity presentation is reconstructable through one complete initial snapshot, subscribe-before-
    request ordering, explicit Tokio `Lagged` handling, and resnapshot. Epoch or sequence metadata
    requires evidence from the Tauri boundary before it lands.
13. The host selects semantic motion and owns authoritative body movement. The frontend loads visual
    assets and predicts/interpolates rendered placement between authoritative samples.
14. Authoritative placement/residency, predicted presentation placement, and final scene transform
    are distinct composite facts with one named owner each.
15. Focused appearance mutation preserves entity identity, attachments, and compatible mutable
    behavior unless retail evidence says otherwise.
16. Complete replacement atomically retires every prior mutable subsystem; existing frontend owner
    generations invalidate stale asynchronous presentation work.
17. Attachment truth lives in `holtburger-world`; frontend scene parenting is a projection.
18. Renderer batching remains downstream policy and never defines content, entity, owner, or domain
    identity.
19. No later-phase type, field, cache, map, or adapter lands without its first production consumer.
20. Every deleted or rejected mechanism has its guarantees named and replaced before removal.

## Target Runtime Shape

```text
explorer scenario commands ----\
                                -> holtburger-world state/runtime
future network client events --/      |- identity + lifecycle
                                       |- appearance + attachment
                                       |- authoritative placement/residency
                                       `- semantic motion selection
                                                    |
                              holtburger-core ClientViewEvent projection
                               complete snapshot + ordered deltas
                                                    |
                                     narrow app-local Tauri adapter
                                                    |
                                      frontend dynamic entity feed
                                                    |
                         template / animation / script / effect / publication systems
                                                    |
                              predicted presentation placement + scene projection
                                                    |
                                      shared object renderer submission
```

Hook and effect path:

```text
animation departed frames --\
                             -> BehaviorEventRouter (when the second producer lands)
physics-script events ------/      |- persistent per-entity visual state
                                    |- per-part render state and timelines
                                    |- audio / particles / lighting
                                    |- structural replacement
                                    `- semantic observations
```

## Guarantee Replacement Ledger

| Rejected or changed mechanism                            | Guarantee it provided                           | Canonical replacement                                                                                         |
| -------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Whole Claude implementation merge                        | Broad first-slice behavior                      | Focused reimplementation behind canonical contracts                                                           |
| Claude final-frame-only playback                         | Discrete pose selection and simple events       | Canonical departed-frame traversal plus independent presentation sampling                                     |
| Claude fire-and-forget visual preparation                | Immediate entity identity and non-blocking load | Staged resource preparation and atomic publication                                                            |
| Claude `EntityTemplateCache`                             | Shared visual preparation and atlas ownership   | Canonical content-addressed visual-template repository combining staged atomic lifecycle with atlas residency |
| Claude known-hook deferral for every unimplemented kind  | Legitimate content does not crash               | Consequence-aware activation blocking plus named observable deferred effects                                  |
| Claude eager world identity/attachment maps              | Order-independent attachment behavior           | World-owned attachment state introduced with the spawned feed consumer                                        |
| Canonical app-local authoritative `ExplorerRuntime` risk | Deterministic explorer producer                 | Explorer driver over the shared world runtime                                                                 |
| Separate explorer and client event grammars              | Driver-local composition freedom                | One projected event model with narrow app adapters                                                            |
| Frontend semantic motion-table resolution                | Local animation selection                       | Host-selected, time-anchored resolved motion contract                                                         |
| Frontend authoritative root-motion projection            | Smooth movement without host ticks              | Host-authoritative body motion plus frontend presentation prediction/correction                               |
| Static commit bundles as a spawned mutation bus          | Existing preparation and publication path       | Sequenced runtime entity feed independent of scene-interest commits                                           |

## North Stars

1. One authoritative fact, one owner, one projection path.
2. Preserve proven lifecycle correctness before adding behavioral breadth.
3. Reimplement donor ideas against canonical contracts; never retain parallel mechanisms.
4. Make partial support visibly conservative rather than silently wrong.
5. Use authored workloads first and spawned producers second; no speculative scaffolding.
6. Keep explorer and future client composition local while sharing world/runtime mechanics.
7. Treat plans as branch-local execution records, not aggregate claims across worktrees.
8. Prefer a decisive cutover and vocabulary sweep over adapters with indefinite lifetimes.

Smooth pose interpolation is a deliberate modern-client presentation choice rather than a claim that
retail interpolated rigid parts. Retail remains authoritative for semantic frame selection and hook
traversal; the renderer is intentionally smoother between those semantic samples.

## Phased Implementation

### Dry-Run Decision: Template Materialization Ownership

Progress: Complete (2026-08-01)

The pre-execution dry-run found that the original plan overstated the canonical manager's ownership.
`ObjectVisualTemplateManager` retains geometry, while dynamic texture requirements are independently
re-derived and retained by the containing static-layer atlas revision. That lifecycle is sufficient
for promoted authored statics but cannot materialize a spawned entity independently of a static layer.

The user approved a clean convergence on one content-addressed repository that owns immutable visual
preparation plus geometry and atlas residency. The repository retains `3d-next`'s indexed geometry and
material ranges, staged owner replacement, and prepare-before-publish activation. It borrows Claude's
template-scoped atlas ownership without borrowing Claude's vertex-expanding material partitions or
fire-and-forget entity publication. Phase 2 was inserted to land this prerequisite before hook effects.

### Phase 1: Canonicalize Plan Provenance and Final Contracts

Progress: Complete (2026-08-01)

#### Deliverables

- Add a dated architecture-convergence decision to the canonical roadmap.
- Append a post-completion review to the static-authored animation plan without changing its original
  completion scope or execution record, explicitly preserving smooth render-cadence pose interpolation.
- Update the effects plan to identify Claude effects as donor-proven and canonical implementation as
  not started.
- Mark the spawned plan as requiring convergence before execution and replace its final topology with
  the contracts in this plan.
- In the Claude worktree, label the baseline plan complete on Claude only and mark the unexecuted
  full-fidelity and host-simulation plans superseded as canonical paths.
- Add a provenance table to each affected active plan using the vocabulary defined above.

#### Task Checklist

- [x] Record `c09eb3c2` as canonical and `c938a438` as donor in the roadmap.
- [x] Separate landed implementation, reused evidence, selected architecture, and rejected mechanisms.
- [x] Ensure no canonical checkbox is satisfied only by donor implementation.
- [x] Preserve completed execution history through dated addenda rather than rewriting old claims.
- [x] Verify exactly one affected plan is marked active for execution; later plans are queued, planned,
      complete historical records, or superseded donor records.

#### Acceptance Criteria

- Every affected plan names its branch-local implementation status unambiguously.
- The roadmap and execution plans agree on world, feed, motion, placement, attachment, effect, and
  renderer ownership.
- Claude's retained documents no longer present themselves as the chosen future architecture.
- No new compatibility or dual-runtime commitment appears in any plan.

#### Decisions and Course Corrections

- **2026-08-01 — execution authorization:** The implementation request constitutes review approval for
  this convergence plan. The dry-run gate remains mandatory and produced the Phase 2 correction below.
- **Canonical plan cutover:** The roadmap now points at this plan as the only active dynamic-entity
  execution plan. The effects plan is queued for convergence Phase 5 resteering, and the spawned plan
  is explicitly non-executable until the Phase 6 audit and Phase 7 rewrite.
- **Historical record preserved:** The completed canonical animation plan received a dated addendum;
  its original checkboxes and acceptance claims were not rewritten. Smooth render-cadence pose
  interpolation is explicitly retained as required canonical behavior.
- **Donor status made branch-local:** Claude's completed baseline is labeled complete on `claude`
  only. Its unexecuted full-fidelity and host-simulation plans are superseded as canonical paths while
  retaining their evidence and design rationale.
- **Acceptance evidence:** `git diff --check` passes in both worktrees. Provenance tables name both
  commits, selected/rejected mechanisms, and remaining implementation state. Canonical roadmap,
  effects, and spawned topology now agree on world authority, one recoverable projection, explorer
  and network drivers, template-resource ownership, frontend presentation, and renderer policy.
- **Concession:** Old phase bodies remain visible in the spawned plan as explicitly non-executable
  design input until Phase 7 rewrites them from the Phase 6 audit; the selected topology and ownership
  override are already unambiguous.

### Phase 2: Unify Visual-Template Materialization and Resource Ownership

Progress: Complete (2026-08-01)

#### Deliverables

- Evolve `ObjectVisualTemplateManager` into the single content-addressed visual-template repository
  used by authored dynamic owners and shaped for future spawned owners.
- Make each prepared template the sole producer of its geometry upload keys, material ranges, and
  texture requirements; consumers must not re-derive those facts.
- Acquire geometry and atlas residency as one staged template lifecycle while preserving independent
  device caches beneath the repository.
- Preserve indexed source geometry and contiguous material ranges; do not expand vertices to combine
  noncontiguous triangles with the same material.
- Keep static-layer texture ownership for true static batches while removing promoted dynamic texture
  requirements from the static-layer dependency collector.
- Publish no dynamic owner until every template's geometry and atlas claims are ready; failure,
  supersession, or release must roll back both resource classes.

#### Task Checklist

- [x] Name the repository by its actual resource contract and sweep the geometry-only manager name.
- [x] Inject the resident atlas boundary rather than reaching through the renderer or static realizer.
- [x] Give staged owner handles complete ready/commit/release semantics for geometry and atlas claims.
- [x] Deduplicate concurrent preparation and residency for the same content-addressed template.
- [x] Prove authored dynamic owners no longer depend on a static-layer atlas revision for textures.
- [x] Add a spawned-shaped independent-owner fixture without adding a spawned runtime or dormant feed.
- [x] Cover failure, supersession, last-owner release, shutdown, and partial-stage rollback.
- [x] Verify static-only atlas dependency behavior and renderer batching remain unchanged.

#### Acceptance Criteria

- One template key has one immutable prepared fact set and one shared geometry/atlas residency lifecycle.
- Two owners sharing a template do not duplicate preparation, geometry uploads, or atlas requirements.
- Retiring either owner preserves resources until the final owner releases them.
- A dynamic owner can fully stage without any containing static-layer atlas claim.
- No entity publishes with ready geometry but missing atlas residency, or vice versa.
- Static-only layers retain their existing prepare-before-publish and eviction guarantees.
- TypeScript tests, type checking, formatting, ESLint, and Knip pass.

#### Decisions and Course Corrections

- **2026-08-01 — approved architecture:** Repository ownership includes immutable preparation,
  geometry residency, and atlas residency. Authored and future spawned consumers use the same staged
  handle contract.
- **Preserved canonical behavior:** Keep `3d-next`'s indexed geometry and contiguous material ranges.
  Claude's vertex-expanding material partitions are intentionally rejected.
- **Resolved dry-run debt:** `ObjectVisualTemplate.textureRequirements` is now consumed directly by
  the repository; static-layer code no longer re-derives dynamic texture residency.
- **Resource ownership landed:** One `object-visual-template-resource:*` owner now retains each
  content-addressed template's geometry and exact atlas claim. Entity generations are consumer leases,
  so two owners share preparation, upload, and residency until the last owner releases.
- **Derived facts collapsed:** The template preparer is the sole producer of dynamic geometry,
  material ranges, and texture requirements. Static texture collection now covers static draws only;
  promoted dynamic textures are no longer re-derived or tied to a static-layer atlas revision.
- **Atlas contract cleaned up:** Atlas revisions are exact owner-local numbers rather than falsely
  branded scene-interest revisions. Scene-interest retains its stronger type at its own boundary;
  immutable templates use one internal revision because changed content produces a new owner key.
- **Supersession preserved:** `DynamicEntitySystem` releases the previous pending template stage as
  soon as a replacement stage succeeds, preventing superseded CPU preparation from uploading geometry
  or activating atlas residency.
- **Failure behavior:** Preparation failure, atlas failure, cancellation, activation supersession,
  committed last-owner release, and shutdown all release geometry and atlas claims. Background atlas
  cleanup rejection is retained and fails deterministic repository shutdown instead of becoming an
  unhandled rejection.
- **Acceptance evidence:** 501 tests in 85 frontend files pass; Svelte/TypeScript checking, ESLint,
  Knip, and Prettier over every touched TypeScript file pass. Focused repository tests cover exact
  texture-fact forwarding, indexed range preservation, concurrent sharing, independent spawned-shaped
  ownership, partial rollback, supersession, cleanup failure, and shutdown quiescence.
- **Pre-existing debt:** Repository-wide `prettier --check .` still reports 20 unchanged baseline
  files, including `pnpm-lock.yaml` and renderer/explorer sources. They were not reformatted because
  they are outside this diff; the Phase 8 repository-wide formatting gate remains open.

### Phase 3: Port the Proven `TransparentPart` Source Contract

Progress: Complete (2026-08-01)

#### Deliverables

- Add the proven `TransparentPart` payload to `holtburger-dat` using ACE and retail layouts.
- Project typed part/start/end/duration facts through the canonical HBAN transport.
- Extend the canonical semantic hook union without carrying redundant transport provenance after
  validation.
- Preserve raw payloads only for hooks whose typed format or consumer remains genuinely unknown.
- Validate finite values, part indices, frame indices, authored order, direction, section bounds,
  requested animation identity, and exact payload layout.

#### Task Checklist

- [x] Port the payload type rather than Claude's complete `setup_model.rs` diff.
- [x] Add Rust parsing/projection fixtures for `TransparentPart` and existing `SetOmega` behavior.
- [x] Add TypeScript decoder fixtures for valid, malformed, incomplete, non-finite, and mismatched
      payloads.
- [x] Prove the canonical transport still preserves unsupported payloads losslessly.
- [x] Keep animation acquisition and batching policy unchanged unless this phase measures a concrete
      request problem.

#### Acceptance Criteria

- A real `TransparentPart` animation crosses DAT decode, host projection, and frontend decode with
  exact proven values.
- Malformed source or transport data fails loudly before activation.
- Existing `SetOmega`, replace-object, unsupported-visual, and deferred-effect classifications remain
  behaviorally unchanged.
- Rust tests, TypeScript tests, type checking, formatting, ESLint, Knip, and Clippy pass.

#### Decisions and Course Corrections

- **Decision:** The canonical source contract is ACE/retail's exact little-endian
  `{ part: u32, start: f32, end: f32, time: f32 }` layout. Rust names `time` as
  `duration_seconds` at the semantic boundary and rejects non-finite source values.
- **Decision:** Known typed hooks carry only their semantic values after validation. The redundant
  raw-byte copies previously retained for `SetOmega` were removed; raw bytes remain lossless only
  for `Raw` and `ReplaceObject` payloads whose consumers still need them.
- **Decision:** Invalid part indices fail in both host projection and frontend decoding. Invalid or
  unknown direction still preserves a typed known payload inside the deferred classification, so
  unsupported playback cannot erase source facts or accidentally activate an entity.
- **Course correction:** Added focused frontend fixtures for frame bounds, contiguous authored order,
  and direction/raw-direction agreement. These invariants already existed in code but were not pinned
  by this phase's tests.
- **Archive evidence:** A disposable probe against the ignored repository-local `dats/assets.hba`
  decoded and projected all 12 `TransparentPart` hooks from the six censused setups. The exact pairs
  were `0x020010e3 -> 0x03000a58` (`0 -> 1 -> 0`, 2 s),
  `0x020010e5 -> 0x03000a59` (1.3333334 s), `0x020010e6 -> 0x03000a57`
  (0.43333334/0.33333334 s), `0x020011b8 -> 0x03000a8f` (the same short pair),
  `0x020011b9 -> 0x03000a90` (1.3333334 s), and `0x020011c3 -> 0x03000a91`
  (2 s). Every hook targeted part 0 and retained its real frame, authored order, and `Both`
  direction. The asset-dependent probe was removed after execution, per repository test policy;
  checked-in exact-value fixtures cover the same DAT, host, and frontend contracts without requiring
  local runtime assets.
- **Acceptance evidence:** 1,219 Rust unit tests pass across the workspace (plus doctests; one ignored),
  and Cargo check, rustfmt, and Clippy with warnings denied pass. The frontend passes 509 tests in 85
  files, Svelte/TypeScript checking, ESLint, Knip, and Prettier over every touched TypeScript file.
  `git diff --check` also passes. Animation acquisition and batching code did not change.

### Phase 4: Integrate Effects Through Atomic Activation

Progress: Complete (2026-08-01)

#### Deliverables

- Introduce a focused effect owner consuming typed hook events from animation and, later, scripts.
- Add a composite per-part render-state type containing translucency and a named future widening seam;
  do not add unused luminosity, diffuse, palette, or draw-state fields yet.
- Add timed translucency ramps with exact endpoints and deterministic update behavior.
- Fold persistent hook/effect state crossed before an entity's independent initial phase into staged
  state before publication.
- Reclassify partially translucent authored-opaque ranges into the transparent render phase.
- Suppress fully translucent parts using retail's skip-draw behavior.
- Carry opacity through the existing instance color alpha without widening the instance record.
- Include effect state in owner replacement, release, supersession, and shutdown quiescence.

#### Task Checklist

- [x] Decide the narrow event contract between `AnimationSystem`, hook routing, and effect ownership.
- [x] Keep `SetOmega` persistent state and `TransparentPart` timelines under one coherent router without
      creating a universal effect component bag.
- [x] Stage initial effect state alongside animation samples and bounds.
- [x] Preserve static visual fallback for replace-object and still-unsupported visual hooks.
- [x] Add multi-frame traversal tests proving every departed hook fires exactly once in authored order.
- [x] Preserve smooth rigid-pose interpolation above the authored clip rate and prove it cannot emit
      semantic hooks between frame crossings.
- [x] Add replacement, failure, supersession, eviction, and shutdown tests covering effect resources.
- [x] Add renderer tests for opaque, partial translucency, full suppression, transparent sorting, and
      instance cohort compatibility.

#### Acceptance Criteria

- No entity becomes visible before its complete template, pose, bounds, and initial effect state are
  valid.
- One large accepted time step produces the same ordered semantic hooks as equivalent smaller steps.
- Render cadence above the authored clip rate produces smooth intermediate rigid poses without
  changing semantic frame, hook, or persistent-effect outcomes.
- A zero-duration translucency hook sets the exact end state; a timed ramp lands exactly on its end.
- Unsupported visual or structural behavior cannot silently activate an incorrect animated entity.
- Representative dynamic-only and mixed-scene harness runs report no browser errors or resource leaks.
- All repository gates pass, including formatting and Clippy warnings denied.

#### Decisions and Course Corrections

- **Approved architecture cut:** Replace `HookSystem` with a focused `EffectSystem`. It owns
  `SetOmega` state, accumulated root orientation, per-part translucency, active translucency ramps,
  and hook outcome diagnostics. It does not own scene nodes or mutate the scene graph.
- **Decision:** `AnimationSystem` remains the sole owner of playback clocks, frame traversal, and
  authored hook timing. It calls the effect owner synchronously in traversal order and returns one
  composite dynamic-presentation sample containing the articulated pose plus sampled effect facts.
  There is no event queue or universal effect component bag.
- **Addition through subtraction:** Delete the pass-through `PoseSystem`. `DynamicEntitySystem`, which
  already owns entity nodes and staged generations, publishes each complete presentation sample and
  retains publication diagnostics. No standalone presentation coordinator is introduced.
- **Initial-state rule:** Build staged effect state by replaying the same fixed semantic steps from
  frame zero to the deterministic independent initial phase, then sample the remaining fractional
  step without firing hooks. This preserves smooth render-cadence animation while making initial
  omega and translucency history honest before publication.
- **Routing rule:** A dispatch-only `HookSystem` does not earn its keep with one producer and one
  implemented visual consumer. Phase 5 may introduce a `SemanticHookRouter` or
  `BehaviorEventRouter` only if real script/audio/particle consumers prove shared ordering or routing
  policy; no speculative tollbooth survives this phase.
- **Scene-publication boundary:** `EffectSystem` computes a root rotation modifier and part render
  states. `DynamicEntitySystem` applies those facts with the articulated pose to its scene nodes and
  renderable state. Omega is never mislabeled or transported downstream as a pose.
- **Retail translucency semantics:** Durations below `0.0002` seconds set the exact endpoint
  immediately; timed ramps clamp to their exact endpoint. Exact translucency `1` suppresses drawing,
  while any nonzero translucency reclassifies an authored-opaque range into transparent ordering and
  writes opacity through the existing instance alpha.
- **Lifecycle result:** Staged animation records create staged effect state, and release,
  supersession, owner removal, and animation-system destruction remove it deterministically. Direct
  updates after destruction fail loudly. Template, animation, node, initial presentation, and effect
  facts all prepare before the companion publication cutover.
- **Harness course correction:** An initial `0x00B9FFFF` probe was discarded because the requested
  layers contained zero promoted dynamics. The representative proof therefore reused the completed
  animation plan's measured DA56 radius-one generated workload instead of accepting vacuous zero-state
  evidence.
- **Harness evidence:** DA56 dynamic-only and mixed-scene runs each retained 30 residents, 30 active
  playbacks, 30 entities, and exactly 30 resident effect states with zero browser errors. Both selected
  18 visible entities and submitted 76 dynamic draws / 120 instances. The mixed run simultaneously
  submitted 606 static draws and 5,083 persistent static instances. A separate dynamic-only
  clear-and-reload run returned to the same 30/30/30 resident/playback/effect counts without browser
  errors, proving the lifecycle does not accumulate state.
- **Acceptance evidence:** All 515 frontend tests pass. Svelte/TypeScript checking, ESLint, Knip,
  workspace Rust tests, workspace Clippy with warnings denied, rustfmt, touched-file Prettier, and
  `git diff --check` pass. The workspace test required its normal unsandboxed local-listener permission
  for the V8 scripting fixture; the sandboxed failure was `PermissionDenied`, and the complete rerun
  passed.
- **Concession:** Repository-wide Prettier still reports the unchanged baseline files recorded in
  Phase 2. Every file touched by convergence is formatted; Phase 8 retains the deliberate
  repository-wide cleanup gate so unrelated user code is not churned mid-phase.

### Phase 5: Resteer the Remaining Authored Effects Plan

Progress: Complete (2026-08-01)

#### Deliverables

- Dry-run the canonical static-authored effects plan against the landed template and typed hook/effect
  contracts.
- Re-run or validate the physics-script, particle, sound, and complete hook-vocabulary census.
- Remove completed `TransparentPart` work from future phases and preserve only unmet consumers.
- Confirm that animation frames and physics scripts can share a focused behavior-command router
  without sharing clocks or resource lifetimes.
- Itemize any debt introduced by Phases 2-4 and schedule it before spawned work if it compromises the
  shared frontend architecture.

#### Acceptance Criteria

- The effects plan contains no already-completed deliverable, donor-only completion claim, or dormant
  port.
- Every remaining field and hook seam has a measured producer and named consumer.
- Particle, audio, script, material, and structural work are split or reordered according to evidence,
  not the old branch boundaries.
- The next effects phase can be executed without inventing architecture during implementation.

#### Decisions and Course Corrections

- **Router now earns its keep later, not earlier:** `BehaviorEventRouter` is selected for the effects
  plan's script-execution phase, where animation and physics scripts are two proven producers and
  persistent effects, particles, audio, structural replacement, and chained scheduling are real
  consumers. It validates generation-safe targets, synchronously dispatches already ordered commands,
  and records exhaustive outcomes; it owns no clocks, queues, effect state, or resources.
- **Prepared command seam:** Physics scripts and animation compile to one
  `PreparedBehaviorCommand` semantic union. Producer transport wrappers do not cross the router.
  Retail-proven producer update order and each producer's authored order determine time; the router
  does not fabricate a second timeline.
- **Archive census:** A disposable probe decoded the current complete archive through the existing
  hook parser, then was removed. 2,161 setups directly name default scripts; their `CallPES` closure
  reaches 2,190 scripts. Reachable commands are exactly 49 `SoundTable`, 43 `Scale`, 7,753
  `CreateParticle`, 352 `CallPES`, 319 `SoundTweaked`, and 11 `TextureVelocity`. Six setup default
  script tables are present, and the four representative self-cycles remain valid members of a much
  larger shipped cyclic set.
- **Animation census:** The 134 setup-default animations contain exactly four `SoundTable`, 12
  `TransparentPart`, 14 `SoundTweaked`, and eight `SetOmega` hooks. Translucency and omega are removed
  from future implementation scope because Phase 4 owns them. The complete archive's only two
  `ReplaceObjectHook` records are animation `0x0300055B` frame 0, replacing part 1 with
  `0x01000BB4` forward and `0x01000BB5` backward; that is now the named structural fixture.
- **Evidence-shaped scope correction:** No setup-default script closure or setup-default animation
  emits a lighting hook, so lighting is removed from the executable plan. The wider census adds
  measured `SoundTable`, `Scale`, and `TextureVelocity` work that the DA55/DC58 representative-only
  summary did not expose.
- **Debt scheduled:** The current animation-specific `EffectSystem` input becomes the shared prepared
  command seam in effects Phases 2-3; `PartRenderState` widens only when scale/UV consumers land;
  structural fallback remains until replacement assets/bounds are staged; script-only promotion waits
  for complete closures; focused particle/audio runtimes land only with their consumers. None requires
  a second entity runtime or a dormant spawned adapter.
- **Acceptance evidence:** The queued effects plan now distinguishes landed translucency/omega from
  unmet work, names every remaining producer and consumer, records the six real table IDs and one
  exact replacement fixture, removes speculative lighting, and leaves its next phase as a bounded
  source-evidence task. Both disposable archive probes were deleted.

### Phase 6: Audit the Existing World Runtime and Feed Before Designing Spawned Transport

Progress: Complete (2026-08-01)

> Historical record: the audit findings below remain evidence, but the projector/epoch/sequence and
> world-generation remedy selected at the time is superseded by the post-completion correction above.

#### Deliverables

- Trace `holtburger-world` entity, spatial body, attachment, placement, correction, and motion state.
- Trace `holtburger-core` client runtime and `ClientViewEvent` snapshot/reset/upsert/remove contracts.
- Determine which existing contracts are authoritative domain types versus client-specific projections.
- Test or prove snapshot atomicity, ordering, duplicate handling, gap detection, reset semantics, and
  clock mapping.
- Enumerate the smallest shared extensions required for explorer and network drivers.
- Delete or explicitly reject the unused scene-interest-shaped spawned commit seam as the mutation bus.

#### Task Checklist

- [x] Map every proposed spawned DTO field to a world owner and frontend consumer.
- [x] Determine whether feed epoch/global sequence belong in `holtburger-core`, an app projection
      adapter, or an existing shared view contract.
- [x] Confirm whether authoritative residency is already projected or must be added.
- [x] Confirm how ordinary corrections and forced reposition are distinguished.
- [x] Confirm whether existing motion state selects animations losslessly enough for the future client.
- [x] Prove that an explorer driver can use the same domain mutation and view projection path without
      importing explorer policy into shared crates.

#### Acceptance Criteria

- The audit produces one exact target feed with no parallel authority and no ambiguous field ownership.
- Existing reusable contracts are extended rather than wrapped in an invented duplicate grammar.
- Client-specific transport/session concerns remain out of the explorer runtime.
- Every missing guarantee is assigned to one future phase with a concrete producer.

#### Decisions and Course Corrections

- **World authority already exists:** `WorldState` owns entities by `Guid`, accepted server position
  sequences, typed `PhysicsAttachment` relationships, late parent/child resolution, semantic motion
  commands, authoritative server anchors, and simulated runtime bodies. `EntityMoved` is the accepted
  continuous path; `ForcedReposition` and runtime-body reset are the existing discontinuity signals.
- **The current feed is not recoverable:** `ClientViewEvent` is an unsequenced bounded broadcast. Its
  initial-state request emits a runtime-body snapshot but not a complete entity/appearance snapshot,
  and subscription plus snapshot capture is not atomic. A lagged receiver can detect loss, but cannot
  reconstruct entity truth. It remains useful for current client UI events, not the spawned transport
  contract.
- **Projection ownership:** `holtburger-core` will own one reusable `WorldViewProjector` and its feed
  epoch/global sequence/snapshot handshake. This is reusable client orchestration rather than world
  semantics or app transport. The Tauri adapter serializes this contract and owns no entity truth.
- **Atomic handshake:** The projector registers the receiver and captures a complete snapshot through
  sequence `N` within the same actor boundary. Queued deltas begin at `N + 1`. Consumers reject
  duplicates, resnapshot on a gap or epoch change, and never apply a partial unknowable stream.
- **Missing world contracts:** `Entity` currently discards lossless `ModelData` appearance and has no
  explicit generation. `holtburger-world` must add a semantic appearance composite and a generation
  counter that survives removal as a tombstone so reusing a `Guid` cannot admit stale asynchronous
  work. Focused mutations retain generation; complete replacement advances it.
- **Composite projection:** Entity facts and runtime-body facts must be projected as one
  generation-scoped view, not parallel event streams. Each mutable composite pairs its value with the
  revision that invalidates asynchronous frontend work: appearance, placement, and motion. Fields are
  introduced only in the phase that adds their producer and consumer.
- **Placement ownership:** The world projects one sparse `WorldBodyPlacement` anchor from its current
  runtime body, authoritative residency, attachment state, correction kind, and sample time. The
  frontend owns one `PresentationPlacement` derived from that anchor and resolved motion; only the
  presentation owner applies the final scene-node transform. Server pose may remain diagnostics, not
  a second presentation input.
- **Motion gap is real:** Existing `EntityMotionSnapshot` preserves semantic commands, but reduced
  `MotionKinematics` omits animation IDs, ranges, rates, links, and modifiers. It cannot select
  playback losslessly. A content-built `MotionCatalog` and world-owned pure resolver will later emit
  entity-specific `ResolvedMotionPlan` values; the frontend consumes plans and never raw tables.
- **Timeline extension required:** `ServerTimeSync` already maps server time to a local monotonic
  instant, but current view events expose only a floating server-time value. Snapshot, motion, and
  placement contracts need one versioned host-monotonic timeline sample so pause, step, delivery
  latency, and resnapshot do not reinterpret installed plans.
- **Attachment residency:** World attachment truth already exists. The projected composite will derive
  descendant residency from the ancestor once, while frontend scene parenting remains presentation.
- **Rejected seam:** Static scene-interest commit bundles remain valid for authored companion
  publication but are explicitly rejected as a spawned mutation bus. Spawned deltas come only from
  the shared world projection.
- **Explorer proof:** `WorldState` mutations and projection are independent of session transport. An
  app-local explorer driver can invoke the same domain operations a future network driver invokes;
  only scenario policy and deterministic controls stay in `src-tauri`.
- **Acceptance evidence:** The audit traced `entity.rs`, attachment resolution, state mutations,
  motion resolution, spatial runtime views, `ClientRuntime`, its body-view cache, and every
  `ClientViewEvent` snapshot/reset path. No production code changed in this phase; each missing
  guarantee is assigned to a concrete producer/consumer phase in the rewritten spawned plan.

### Phase 7: Rewrite and Dry-Run the Spawned Entity Plan

Progress: Complete (2026-08-01)

> Historical record: this phase documents the first rewrite. Its recovery machinery is superseded by
> the post-completion correction above and the current spawned execution plan.

#### Deliverables

- Rewrite the spawned plan around one `holtburger-world` runtime and one recoverable projected event
  model driven by explorer scenarios or a future network client.
- Define the snapshot, epoch, global sequence, entity generation, revision, and host timeline contract.
- Separate authoritative placement/residency, predicted rendered placement, and final scene transform
  into explicit composite types.
- Keep semantic motion selection host-owned and presentation playback frontend-owned.
- Define focused appearance mutation and complete generation replacement as distinct operations.
- Introduce attachment projection only with the first spawned attach/detach producer.
- Define a narrow app-local explorer driver as composition policy, not another world model.
- Dry-run each phase against existing code through the next resteering gate.

#### Task Checklist

- [x] Replace any plan language that makes frontend prediction authoritative.
- [x] Replace raw/frontend motion-table interpretation with a host-resolved selection contract.
- [x] Reconcile animation root displacement with authoritative body movement; record any accepted
      fidelity gap explicitly.
- [x] Prohibit per-render-frame host transform streaming while preserving smooth presentation.
- [x] Specify stale delta, duplicate, gap, epoch change, resnapshot, and complete replacement behavior.
- [x] Specify teardown of templates, playback, effects, scripts, queued hooks, placement prediction,
      attachments, and pending preparation.
- [x] Preserve future client reuse without introducing a base runtime class.

#### Acceptance Criteria

- Explorer and future network drivers mutate the same world-domain model and produce the same view
  contract.
- Nothing downstream of the app adapter needs to know which driver produced an entity event.
- The frontend cannot manufacture authoritative placement, residency, attachment, or semantic motion.
- Focused mutation preserves identity and relationships; complete replacement cannot retain obsolete
  mutable state.
- Every phase has binary acceptance criteria and a production-shaped producer.
- No dormant motion, appearance, attachment, feed, or cache type is scheduled before its consumer.

#### Decisions and Course Corrections

- **Clean rewrite:** The spawned plan was entirely unexecuted, so its superseded phase bodies were
  removed rather than retained behind caveats. Donor provenance and useful acceptance intent remain,
  but there is now exactly one executable sequence.
- **First vertical slice moved earlier:** Phase 1 lands lossless world appearance, generation, a
  complete composite entity view, and atomic recoverable projection together. This prevents dormant
  world DTOs and gives every new field a same-phase projector/client consumer.
- **Existing UI channel preserved narrowly:** `ClientViewEvent` carries much more than world entities.
  Only entity/runtime-body variants migrate to the shared projection; chat, status, vendor, trade,
  and other UI events are not churned into an unrelated feed rewrite.
- **Generation is not retention:** Existing `EntityLifecycleStore` tracks prune/delete/trade-preview
  policy and is cleared during normal lifecycle transitions. A separate generation tombstone store is
  required so same-`Guid` reuse remains safe without coupling identity to retention policy.
- **Frontend reuse requires one extraction:** `DynamicEntitySystem` currently consumes an
  `AuthoredDynamicSource`. The spawned vertical slice extracts its actual presentation facts into one
  shared source contract, then keeps authored-layer and spawned-entity adapters thin. It does not add
  a spawned system or bypass staged owner replacement.
- **Recovery is exact:** Projector subscription registers first, snapshots through `N`, and queues
  deltas beginning `N + 1` within the serialized owner boundary. Duplicate sequences are ignored;
  gaps and epoch changes suspend delta application and resnapshot. The last complete presentation may
  remain visibly stale during recovery but receives no new behavior or placement input.
- **Three placement facts:** `WorldBodyPlacement` is a sparse world-owned anchor,
  `PresentationPlacement` is the frontend's predicted/corrected current result, and scene projection
  alone applies the root-node transform. Animation keeps the landed smooth rigid-part interpolation.
- **Motion stays host-selected:** A content-built catalog and world resolver produce one selected plan
  consumed by both body kinematics and frontend playback. Raw tables never cross Tauri. Animation
  position-frame plus velocity/omega composition is an explicit retail/ACE evidence gate; Phase 3
  stops for review if it cannot be proven, preventing double movement from becoming architecture.
- **Attachments enter with both ends:** World attachment state is projected only in the phase adding
  explorer attach/detach scenarios and the frontend parent-part consumer. Descendant authoritative
  residency is derived in the world projection; animated scene parenting remains presentation.
- **Dry-run evidence:** The rewritten sequence was checked against `ClientState` ownership,
  `holtburger-core` dependencies, `EntityLifecycleStore`, current `ClientViewEvent` consumers,
  `DynamicEntitySystem`'s owner API, template staging, `GameRuntime` composition, and Tauri crate
  dependencies. Each phase now has a production-shaped producer, binary acceptance criteria, and a
  deletion/cutover target.
- **Concession:** The concrete bounded Tauri delivery primitive is intentionally selected in spawned
  Phase 2 after the shared projector exposes backpressure behavior. Transport choice is app-local and
  cannot change the already-fixed snapshot/sequence semantics.

### Phase 8: Cleanup and Canonical Cutover

Progress: Complete (2026-08-01)

#### Deliverables

- Remove temporary donor comparison adapters and obsolete compatibility shapes.
- Sweep superseded vocabulary from code, metrics, diagnostics, plans, and architecture documents.
- Ensure only one template, animation, effect, presentation-publication, placement-projection, and feed
  mechanism remains at each landed roadmap stage.
- Update `apps/holtburger-3d/ARCHITECTURE_AUDIT.md` and affected crate architecture documentation.
- Record final branch-local verification evidence and remaining intentionally deferred work.
- Mark this convergence plan complete only after the effects and spawned plans accurately describe the
  architecture that remains.

#### Task Checklist

- [x] Run Knip without new broad ignores; delete unused exported donor-inspired types.
- [x] Run vocabulary searches for rejected cache, feed, motion graph, attachment, and commit-bundle
      terminology.
- [x] Verify every metric has a scenario where it differs from existing metrics.
- [x] Verify every retained field has a named runtime consumer.
- [x] Verify every validation error has a reachable unique failure mode.
- [x] Re-run representative outdoor, interior, dynamic-only, mixed, and clear/reload browser harnesses;
      re-run deterministic preparation/publication failure-path tests.
- [x] Record concessions and future work in the owning execution plan rather than this plan's cleanup
      becoming a miscellaneous backlog.

#### Acceptance Criteria

- Canonical code contains no parallel mechanism from the donor architecture.
- Canonical and donor plan statuses remain honest and branch-local.
- Architecture documentation matches the landed types and runtime paths.
- Formatting, TypeScript/Svelte checks, ESLint, Knip, frontend tests, Rust tests, Cargo check, Rustfmt,
  and Clippy with warnings denied all pass.
- Representative harness runs show correct dynamic counts, hook/effect behavior, resource release, and
  no browser errors.

#### Decisions and Course Corrections

- **Vocabulary cutover:** Production contains one `ObjectVisualTemplateRepository`, one
  `AnimationSystem`, one `EffectSystem`, and one `DynamicEntitySystem`. Deleted manager, hook-system,
  and pose-system names survive only where the convergence record names the rejected mechanism.
  `hook` and `ArticulatedPose` remain legitimate source/data vocabulary, not hidden systems.
- **Architecture audit corrected:** `ARCHITECTURE_AUDIT.md` now records template-owned geometry/atlas
  residency, direct typed-command effect consumption, composite presentation publication, per-part
  alpha classification, and the absence of a dispatch-only hook or pass-through pose system. No crate
  boundary changed beyond the typed DAT payload, so no crate architecture document required a new
  ownership section.
- **Metric and field audit:** Every new effect diagnostic has a distinct scenario: resident state
  differs from entity count under fallback/removal, executed versus deferred commands differ by
  supported consequence, and bounded observations differ from lifetime totals. Per-part alpha is
  consumed by render classification and instance submission; effect rotation is consumed by visual-
  root composition; template texture facts are consumed only by repository atlas staging.
- **Validation audit:** Rust and TypeScript tests reach finite-value, payload-length, hook ordering,
  part-range, timed-ramp, lifecycle-state, preparation, supersession, and destroyed-system errors with
  distinct messages. Failure-path tests cover partial atlas rollback, cleanup failure, animation
  rejection, stale preparation, and replacement teardown. The browser harness has no synthetic asset-
  failure injection, so deterministic failure coverage remains at the lower boundary rather than
  inventing a debug-only runtime mode.
- **Repository formatting debt paid:** The 19 files reported by full-tree Prettier were mechanically
  formatted in this phase, including `pnpm-lock.yaml`; no behavior change was mixed into that pass.
- **Final browser evidence:** A radius-one `0xDA56FFFF` run with EnvCells and isolated outdoor dynamics
  published 30 residents, 30 playbacks, 30 effect states, 18 visible entities, 76 dynamic draws, and
  120 instances while loading 291 interior cells with no browser console errors. The mixed lifecycle
  clear/reload run returned to the same 30/30/30 dynamic ownership and submitted 786 static plus 76
  dynamic draws with no browser errors. The dynamic-excluded control reported zero entities,
  playbacks, effects, dynamic draws, and dynamic instances while retaining 627 static draws.
- **Final static gates:** All 84 frontend test files and 515 tests pass. Svelte, application/test/node
  TypeScript checks, ESLint, Knip, full-tree Prettier, Cargo check, Rustfmt, workspace Clippy with
  warnings denied, all workspace tests, and doctests pass; one existing scripting doctest remains
  intentionally ignored.
- **Deferred work has owners:** Remaining script/particle/audio/structural effects live in the queued
  authored-effects plan. Lossless world appearance, complete initial-state recovery, resolved motion,
  presentation placement, focused replacement, and attachments live in the rewritten spawned plan.
  Neither plan receives dormant scaffolding from convergence.

## Verification Strategy

### Static and Unit Verification

- Rust parser and projection tests for every typed hook payload.
- TypeScript transport-decoder tests for framing, identity, ordering, payload, and finite-value
  invariants.
- Semantic traversal tests covering forward, backward, wrap, large steps, discontinuity, direction,
  and authored order.
- Effect tests covering initial folding, repeated hooks, timed ramps, exact endpoints, removal, and
  owner replacement.
- Template and animation lifetime tests covering concurrent acquisition, supersession, failure,
  release, and shutdown.
- Template residency tests proving geometry and atlas claims share one staged lifecycle across
  authored and independent spawned-shaped owners.
- Feed tests covering complete snapshot reconstruction, subscribe-before-request ordering, Tokio
  receiver lag/resnapshot, listener restart, replacement freshness, and clock mapping.
- Attachment and mutation tests remain in the spawned plan until a production feed exists.

### Runtime and Harness Verification

- Outdoor static-authored dynamics around `0xDA55FFFF`, `0xDA56FFFF`, and `0xDC58FFFF`.
- Promoted interior dynamics in the previously measured interior regions.
- Dynamic-only versus dynamic-excluded comparisons to isolate rendering and effect behavior.
- Clear/reload and owner-replacement runs proving exact resource reference recovery.
- Controlled pre/post workload comparisons whenever shared renderer submission changes.
- No checked-in test depends on external runtime assets; asset-backed harness evidence is recorded in
  the plan and temporary diagnostics are removed.

### Plan Verification

- `rg` confirms each canonical status and provenance term is used consistently.
- Completed historical phases are changed only through dated addenda.
- Unexecuted phases are rewritten rather than preserved behind compatibility language.
- Donor-only work is cited by commit and never represented as canonical progress.
- The roadmap, effects plan, spawned plan, architecture audit, and landed contracts agree.

## Risks and Mitigations

| Risk                                                 | Mitigation                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A whole-branch merge leaves duplicate authorities    | Prohibit wholesale merge/cherry-pick; port focused behavior against canonical interfaces.                    |
| Donor completion is mistaken for canonical progress  | Use the branch-local provenance vocabulary and same-worktree checkbox rule.                                  |
| Geometry and texture lifetimes diverge               | Make one template repository stage and retain both resource classes before entity publication.               |
| Dynamic textures remain coupled to static layers     | Remove promoted dynamic requirements from the static dependency path and prove an independent owner fixture. |
| Effects become another component framework           | Add only translucency fields with real producers; widen the composite when later hooks land.                 |
| Initial hooks produce a one-frame visual lie         | Fold persistent state during staged activation before publication.                                           |
| Large frame steps skip behavior                      | Preserve departed-frame traversal and add equivalence tests for large versus small accepted steps.           |
| Unsupported visual hooks animate incorrectly         | Keep consequence-aware blocking/static fallback until the responsible subsystem exists.                      |
| Explorer runtime duplicates the client/world runtime | Audit existing world/core contracts first; explorer is a driver and composition root only.                   |
| Shared feed becomes client-session-shaped            | Keep session/reconnect/protocol policy local; share domain/view events and recovery semantics only.          |
| Frontend prediction becomes authoritative placement  | Use distinct types and contracts; host samples always remain authoritative and corrections are explicit.     |
| Host-only root motion causes visible foot sliding    | Record the gap; improve host motion projection rather than creating a second frontend authority.             |
| Feed recovery is bolted on after mutation APIs       | Make initial state complete and prove `Lagged` resnapshot before crossing Tauri.                             |
| Speculative feed machinery grows without evidence    | Keep epochs, global sequences, and world generation tombstones out until a measured boundary needs them.     |
| Attachments arrive without lifecycle authority       | Defer them until world-owned spawned attach/detach events are present.                                       |
| Historical plans are rewritten into fiction          | Preserve completed records and append dated review notes; freely rewrite only unexecuted phases.             |
| Temporary donor vocabulary survives cleanup          | Maintain the guarantee ledger and run explicit vocabulary/dead-code sweeps.                                  |

## Definition of Done

- [x] `3d-next` is documented and implemented as the single canonical base.
- [x] Claude plans are clearly retained as donor records and do not claim canonical status.
- [x] Canonical completed-plan history remains accurate.
- [x] The roadmap, effects plan, and spawned plan agree with the final architectural contracts.
- [x] One content-addressed visual-template repository owns immutable preparation, geometry residency,
      and atlas residency for authored and future spawned consumers.
- [x] Dynamic template texture facts are computed once and are not re-derived by static-layer code.
- [x] Typed `TransparentPart` behavior is implemented through the canonical source boundary.
- [x] Per-part translucency participates in staged activation, playback, rendering, replacement, and
      teardown.
- [x] Every departed semantic frame executes its hooks exactly once in retail order.
- [x] Rigid-part animation remains smoothly interpolated at render cadence as canonical behavior.
- [x] Unsupported visual and structural behavior cannot silently publish an incorrect entity.
- [x] The spawned plan fixes explorer and future client drivers on one world runtime/view-event model.
- [x] Feed snapshot and delta recovery semantics are explicit and testable in the spawned plan.
- [x] Host-authoritative and frontend-predicted placement/residency have distinct named contract types.
- [x] Focused mutation and complete replacement have distinct future acceptance contracts.
- [x] Attachments remain world-owned and enter only with a real spawned lifecycle producer.
- [x] No duplicate donor template, animation, effect, presentation-publication, motion-selection,
      placement-authority, or feed mechanism was introduced.
- [x] Architecture docs, metrics, diagnostics, and UI vocabulary match the surviving mechanisms.
- [x] All formatting, lint, type, test, Rust, and representative harness gates pass.
- [x] Remaining deferred behavior is recorded in its owning queued plan with provenance and a named
      future consumer.

## Deferred Evidence Gates

- Spawned Phase 3 proves animation position-frame composition with motion-data velocity/omega before
  fixing the resolved plan and spatial integration.
- Spawned Phase 6 proves focused object-description sequencing and retained state before fixing that
  mutation contract.
- The authored-effects evidence phase classifies remaining structural hooks and implements their named
  consumers before broadening activation.

## Execution Rule

This document is the completed convergence execution record. Continue with the queued authored-effects
plan, then dry-run the queued spawned plan again against the effects contracts that actually land.
