# Holtburger 3D Dynamic Entity Architecture Convergence Plan

Status: Draft — ready for review and dry-run before execution
Created: 2026-08-01
Canonical implementation base: `3d-next` at `c09eb3c2`
Donor implementation: `claude` at `c938a438`
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`

## Context and Boundaries

### Goal

Converge the two independently implemented dynamic-entity slices into one honest roadmap and one
clean final architecture: retain `3d-next`'s staged frontend runtime, selectively reimplement the
Claude branch's proven effects, and reshape the spawned-entity plan around one shared world runtime
and recoverable feed used by explorer and future client drivers.

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
- The active `3d-next` roadmap currently proposes an app-local `ExplorerRuntime` and frontend
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
- Reimplement proven `TransparentPart` DAT decoding and transport on the canonical branch.
- Extend the canonical typed hook model and staged activation path with per-part translucency.
- Preserve semantic traversal of every departed frame and retain `3d-next`'s smooth render-cadence
  rigid-pose interpolation as canonical presentation behavior.
- Dry-run the existing `holtburger-world` / `holtburger-core` runtime-body and view-event contracts
  before designing any new feed.
- Reshape spawned runtime architecture around one authoritative world runtime, two drivers, and one
  recoverable projection contract.
- Define focused mutation, complete generation replacement, attachment, motion, placement,
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
- Canonical queued spawned work: `docs/plans/holtburger-3d-spawned-entity-explorer-runtime-plan.md`.
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
- `apps/holtburger-3d/src/lib/game/systems/object-visual-template-manager.ts`
  - shared immutable templates with explicit staged and committed references.
- `apps/holtburger-3d/src/lib/game/animation/animation-asset-repository.ts`
  - shared animation acquisition and deterministic release.
- `apps/holtburger-3d/src/lib/game/animation/prepared-dynamic-animation.ts`
  - appearance/clip validation, conservative bounds, and static visual fallback.
- `apps/holtburger-3d/src/lib/game/systems/animation-system.ts`
  - separate semantic traversal and render-cadence sampling.
- `apps/holtburger-3d/src/lib/game/systems/hook-system.ts`
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

## Final Architectural Contracts

1. `3d-next` is the only canonical implementation base. Claude remains a donor record.
2. One frontend dynamic presentation runtime serves authored and spawned entities.
3. One template manager owns immutable visual preparation and device-resource lifetime.
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
9. `holtburger-world` owns authoritative identity, generation, appearance, attachment, placement,
   spatial residency, and semantic motion state.
10. Explorer commands and network messages are two drivers of the same world-domain mutation model.
11. One shared projected event model crosses the host/frontend boundary. App-local Tauri DTOs may
    adapt it but may not create a second authoritative entity model.
12. Projection is recoverable through an atomic snapshot, feed epoch, global monotonic sequence,
    duplicate rejection, gap detection, and resnapshot.
13. The host selects semantic motion and owns authoritative body movement. The frontend loads visual
    assets and predicts/interpolates rendered placement between authoritative samples.
14. Authoritative placement/residency, predicted presentation placement, and final scene transform
    are distinct composite facts with one named owner each.
15. Focused appearance mutation preserves entity identity, generation, attachments, and mutable
    behavior unless retail evidence says otherwise.
16. Complete replacement advances generation and atomically retires every prior mutable subsystem.
17. Attachment truth lives in `holtburger-world`; frontend scene parenting is a projection.
18. Renderer batching remains downstream policy and never defines content, entity, owner, or domain
    identity.
19. No later-phase type, field, cache, map, or adapter lands without its first production consumer.
20. Every deleted or rejected mechanism has its guarantees named and replaced before removal.

## Target Runtime Shape

```text
explorer scenario commands ----\
                                -> holtburger-world state/runtime
future network client events --/      |- identity + generation
                                       |- appearance + attachment
                                       |- authoritative placement/residency
                                       `- semantic motion selection
                                                    |
                                    shared recoverable view projection
                                  snapshot + epoch + global sequence
                                                    |
                                     narrow app-local Tauri adapter
                                                    |
                                      frontend dynamic entity feed
                                                    |
                         template / animation / script / effect / pose systems
                                                    |
                              predicted presentation placement + scene projection
                                                    |
                                      shared object renderer submission
```

Hook and effect path:

```text
animation departed frames --\
                             -> typed hook router
physics-script events ------/      |- persistent per-entity visual state
                                    |- per-part render state and timelines
                                    |- audio / particles / lighting
                                    |- structural replacement
                                    `- semantic observations
```

## Guarantee Replacement Ledger

| Rejected or changed mechanism | Guarantee it provided | Canonical replacement |
| --- | --- | --- |
| Whole Claude implementation merge | Broad first-slice behavior | Focused reimplementation behind canonical contracts |
| Claude final-frame-only playback | Discrete pose selection and simple events | Canonical departed-frame traversal plus independent presentation sampling |
| Claude fire-and-forget visual preparation | Immediate entity identity and non-blocking load | Staged resource preparation and atomic publication |
| Claude `EntityTemplateCache` | Shared visual preparation and atlas ownership | Canonical `ObjectVisualTemplateManager` with staged references |
| Claude known-hook deferral for every unimplemented kind | Legitimate content does not crash | Consequence-aware activation blocking plus named observable deferred effects |
| Claude eager world identity/attachment maps | Order-independent attachment behavior | World-owned attachment state introduced with the spawned feed consumer |
| Canonical app-local authoritative `ExplorerRuntime` risk | Deterministic explorer producer | Explorer driver over the shared world runtime |
| Separate explorer and client event grammars | Driver-local composition freedom | One projected event model with narrow app adapters |
| Frontend semantic motion-table resolution | Local animation selection | Host-selected, time-anchored resolved motion contract |
| Frontend authoritative root-motion projection | Smooth movement without host ticks | Host-authoritative body motion plus frontend presentation prediction/correction |
| Static commit bundles as a spawned mutation bus | Existing preparation and publication path | Sequenced runtime entity feed independent of scene-interest commits |

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

### Phase 1: Canonicalize Plan Provenance and Final Contracts

Progress: Not started

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

- [ ] Record `c09eb3c2` as canonical and `c938a438` as donor in the roadmap.
- [ ] Separate landed implementation, reused evidence, selected architecture, and rejected mechanisms.
- [ ] Ensure no canonical checkbox is satisfied only by donor implementation.
- [ ] Preserve completed execution history through dated addenda rather than rewriting old claims.
- [ ] Verify exactly one plan is marked active for execution; later plans are queued or draft.

#### Acceptance Criteria

- Every affected plan names its branch-local implementation status unambiguously.
- The roadmap and execution plans agree on world, feed, motion, placement, attachment, effect, and
  renderer ownership.
- Claude's retained documents no longer present themselves as the chosen future architecture.
- No new compatibility or dual-runtime commitment appears in any plan.

#### Decisions and Course Corrections

- Populate during execution.

### Phase 2: Port the Proven `TransparentPart` Source Contract

Progress: Not started

#### Deliverables

- Add the proven `TransparentPart` payload to `holtburger-dat` using ACE and retail layouts.
- Project typed part/start/end/duration facts through the canonical HBAN transport.
- Extend the canonical semantic hook union without carrying redundant transport provenance after
  validation.
- Preserve raw payloads only for hooks whose typed format or consumer remains genuinely unknown.
- Validate finite values, part indices, frame indices, authored order, direction, section bounds,
  requested animation identity, and exact payload layout.

#### Task Checklist

- [ ] Port the payload type rather than Claude's complete `setup_model.rs` diff.
- [ ] Add Rust parsing/projection fixtures for `TransparentPart` and existing `SetOmega` behavior.
- [ ] Add TypeScript decoder fixtures for valid, malformed, incomplete, non-finite, and mismatched
      payloads.
- [ ] Prove the canonical transport still preserves unsupported payloads losslessly.
- [ ] Keep animation acquisition and batching policy unchanged unless this phase measures a concrete
      request problem.

#### Acceptance Criteria

- A real `TransparentPart` animation crosses DAT decode, host projection, and frontend decode with
  exact proven values.
- Malformed source or transport data fails loudly before activation.
- Existing `SetOmega`, replace-object, unsupported-visual, and deferred-effect classifications remain
  behaviorally unchanged.
- Rust tests, TypeScript tests, type checking, formatting, ESLint, Knip, and Clippy pass.

#### Decisions and Course Corrections

- Populate during execution.

### Phase 3: Integrate Effects Through Atomic Activation

Progress: Not started

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

- [ ] Decide the narrow event contract between `AnimationSystem`, hook routing, and effect ownership.
- [ ] Keep `SetOmega` persistent state and `TransparentPart` timelines under one coherent router without
      creating a universal effect component bag.
- [ ] Stage initial effect state alongside animation samples and bounds.
- [ ] Preserve static visual fallback for replace-object and still-unsupported visual hooks.
- [ ] Add multi-frame traversal tests proving every departed hook fires exactly once in authored order.
- [ ] Preserve smooth rigid-pose interpolation above the authored clip rate and prove it cannot emit
      semantic hooks between frame crossings.
- [ ] Add replacement, failure, supersession, eviction, and shutdown tests covering effect resources.
- [ ] Add renderer tests for opaque, partial translucency, full suppression, transparent sorting, and
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

- Populate during execution.

### Phase 4: Resteer the Remaining Authored Effects Plan

Progress: Not started

#### Deliverables

- Dry-run the canonical static-authored effects plan against the landed typed hook/effect contracts.
- Re-run or validate the physics-script, particle, sound, and complete hook-vocabulary census.
- Remove completed `TransparentPart` work from future phases and preserve only unmet consumers.
- Confirm that animation frames and physics scripts can share the hook router without sharing clocks or
  resource lifetimes.
- Itemize any debt introduced by Phases 2-3 and schedule it before spawned work if it compromises the
  shared frontend architecture.

#### Acceptance Criteria

- The effects plan contains no already-completed deliverable, donor-only completion claim, or dormant
  port.
- Every remaining field and hook seam has a measured producer and named consumer.
- Particle, audio, script, lighting, and structural work are split or reordered according to evidence,
  not the old branch boundaries.
- The next effects phase can be executed without inventing architecture during implementation.

#### Decisions and Course Corrections

- Populate during execution.

### Phase 5: Audit the Existing World Runtime and Feed Before Designing Spawned Transport

Progress: Not started

#### Deliverables

- Trace `holtburger-world` entity, spatial body, attachment, placement, correction, and motion state.
- Trace `holtburger-core` client runtime and `ClientViewEvent` snapshot/reset/upsert/remove contracts.
- Determine which existing contracts are authoritative domain types versus client-specific projections.
- Test or prove snapshot atomicity, ordering, duplicate handling, gap detection, reset semantics, and
  clock mapping.
- Enumerate the smallest shared extensions required for explorer and network drivers.
- Delete or explicitly reject the unused scene-interest-shaped spawned commit seam as the mutation bus.

#### Task Checklist

- [ ] Map every proposed spawned DTO field to a world owner and frontend consumer.
- [ ] Determine whether feed epoch/global sequence belong in `holtburger-core`, an app projection
      adapter, or an existing shared view contract.
- [ ] Confirm whether authoritative residency is already projected or must be added.
- [ ] Confirm how ordinary corrections and forced reposition are distinguished.
- [ ] Confirm whether existing motion state selects animations losslessly enough for the future client.
- [ ] Prove that an explorer driver can use the same domain mutation and view projection path without
      importing explorer policy into shared crates.

#### Acceptance Criteria

- The audit produces one exact target feed with no parallel authority and no ambiguous field ownership.
- Existing reusable contracts are extended rather than wrapped in an invented duplicate grammar.
- Client-specific transport/session concerns remain out of the explorer runtime.
- Every missing guarantee is assigned to one future phase with a concrete producer.

#### Decisions and Course Corrections

- Populate during execution.

### Phase 6: Rewrite and Dry-Run the Spawned Entity Plan

Progress: Not started

#### Deliverables

- Rewrite the spawned plan around one `holtburger-world` runtime and one recoverable projected event
  model driven by explorer scenarios or a future network client.
- Define the snapshot, epoch, global sequence, entity generation, revision, and host timeline contract.
- Separate authoritative placement/residency, predicted rendered placement, and final scene transform
  into explicit composite types.
- Keep semantic motion selection host-owned and presentation playback frontend-owned.
- Define focused appearance mutation and complete generation replacement as distinct operations.
- Introduce attachment projection only with the first spawned attach/detach producer.
- Define a narrow app-local `ExplorerRuntime` as driver/composition policy, not another world model.
- Dry-run each phase against existing code through the next resteering gate.

#### Task Checklist

- [ ] Replace any plan language that makes frontend prediction authoritative.
- [ ] Replace raw/frontend motion-table interpretation with a host-resolved selection contract.
- [ ] Reconcile animation root displacement with authoritative body movement; record any accepted
      fidelity gap explicitly.
- [ ] Prohibit per-render-frame host transform streaming while preserving smooth presentation.
- [ ] Specify stale delta, duplicate, gap, epoch change, resnapshot, and complete replacement behavior.
- [ ] Specify teardown of templates, playback, effects, scripts, queued hooks, placement prediction,
      attachments, and pending preparation.
- [ ] Preserve future client reuse without introducing a base runtime class.

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

- Populate during execution.

### Phase 7: Cleanup and Canonical Cutover

Progress: Not started

#### Deliverables

- Remove temporary donor comparison adapters and obsolete compatibility shapes.
- Sweep superseded vocabulary from code, metrics, diagnostics, plans, and architecture documents.
- Ensure only one template, animation, effect, pose, placement-projection, and feed mechanism remains.
- Update `apps/holtburger-3d/ARCHITECTURE_AUDIT.md` and affected crate architecture documentation.
- Record final branch-local verification evidence and remaining intentionally deferred work.
- Mark this convergence plan complete only after the effects and spawned plans accurately describe the
  architecture that remains.

#### Task Checklist

- [ ] Run Knip without new broad ignores; delete unused exported donor-inspired types.
- [ ] Run vocabulary searches for rejected cache, feed, motion graph, attachment, and commit-bundle
      terminology.
- [ ] Verify every metric has a scenario where it differs from existing metrics.
- [ ] Verify every retained field has a named runtime consumer.
- [ ] Verify every validation error has a reachable unique failure mode.
- [ ] Re-run representative outdoor, interior, dynamic-only, mixed, clear/reload, and failure harnesses.
- [ ] Record concessions and future work in the owning execution plan rather than this plan's cleanup
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

- Populate during execution.

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
- Feed tests covering snapshot atomicity, epoch, duplicate, gap, reset, generation, and clock mapping.
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

| Risk | Mitigation |
| --- | --- |
| A whole-branch merge leaves duplicate authorities | Prohibit wholesale merge/cherry-pick; port focused behavior against canonical interfaces. |
| Donor completion is mistaken for canonical progress | Use the branch-local provenance vocabulary and same-worktree checkbox rule. |
| Effects become another component framework | Add only translucency fields with real producers; widen the composite when later hooks land. |
| Initial hooks produce a one-frame visual lie | Fold persistent state during staged activation before publication. |
| Large frame steps skip behavior | Preserve departed-frame traversal and add equivalence tests for large versus small accepted steps. |
| Unsupported visual hooks animate incorrectly | Keep consequence-aware blocking/static fallback until the responsible subsystem exists. |
| Explorer runtime duplicates the client/world runtime | Audit existing world/core contracts first; explorer is a driver and composition root only. |
| Shared feed becomes client-session-shaped | Keep session/reconnect/protocol policy local; share domain/view events and recovery semantics only. |
| Frontend prediction becomes authoritative placement | Use distinct types and contracts; host samples always remain authoritative and corrections are explicit. |
| Host-only root motion causes visible foot sliding | Record the gap; improve host motion projection rather than creating a second frontend authority. |
| Feed recovery is bolted on after mutation APIs | Specify epoch, global sequence, snapshot, and gap behavior before spawned implementation. |
| Attachments arrive without lifecycle authority | Defer them until world-owned spawned attach/detach events are present. |
| Historical plans are rewritten into fiction | Preserve completed records and append dated review notes; freely rewrite only unexecuted phases. |
| Temporary donor vocabulary survives cleanup | Maintain the guarantee ledger and run explicit vocabulary/dead-code sweeps. |

## Definition of Done

- [ ] `3d-next` is documented and implemented as the single canonical base.
- [ ] Claude plans are clearly retained as donor records and do not claim canonical status.
- [ ] Canonical completed-plan history remains accurate.
- [ ] The roadmap, effects plan, and spawned plan agree with the final architectural contracts.
- [ ] Typed `TransparentPart` behavior is implemented through the canonical source boundary.
- [ ] Per-part translucency participates in staged activation, playback, rendering, replacement, and
      teardown.
- [ ] Every departed semantic frame executes its hooks exactly once in retail order.
- [ ] Rigid-part animation remains smoothly interpolated at render cadence as canonical behavior.
- [ ] Unsupported visual and structural behavior cannot silently publish an incorrect entity.
- [ ] Explorer and future client drivers share one world runtime/view projection model.
- [ ] Feed snapshot and delta recovery semantics are explicit and testable.
- [ ] Host-authoritative and frontend-predicted placement/residency facts cannot be confused by type.
- [ ] Focused mutation and complete replacement have distinct tested lifecycle contracts.
- [ ] Attachments remain world-owned and enter only with a real spawned lifecycle producer.
- [ ] No duplicate template, animation, effect, pose, motion-selection, placement-authority, or feed
      mechanism survives.
- [ ] Architecture docs, metrics, diagnostics, and UI vocabulary match the surviving mechanisms.
- [ ] All formatting, lint, type, test, Rust, and representative harness gates pass.
- [ ] Remaining deferred behavior is recorded in its owning active plan with provenance and a named
      future consumer.

## Open Questions

These are engineering questions to resolve during the named resteering phases; none justifies a
second runtime or speculative type in advance.

1. Does the existing `ClientViewEvent` runtime-body path already provide enough atomic snapshot and
   reset information to host the shared projected feed, or should recovery metadata wrap a more
   general world-view event contract?
2. Which existing `holtburger-world` type is the canonical source for entity generation and focused
   appearance revision, and what minimal lossless extension is required?
3. Does authoritative environment-cell residency already survive the runtime-body projection, or
   must it be added alongside placement samples?
4. What exact time anchor maps host motion selection and placement samples onto the frontend render
   clock without reinterpreting an installed plan after pause, step, or resnapshot?
5. How should authored animation position frames contribute to host-authoritative motion without
   duplicating clip sampling or introducing frontend spatial authority?
6. Which hook kinds beyond `SetOmega` and `TransparentPart` block animated activation because their
   absence changes visible structure, bounds, or scene membership?
7. Should the donor branch remain maintained after its plans are labeled, or is its git history alone
   the intended long-term execution record?

## Execution Rule

Do not begin Phase 2 until Phase 1 is reviewed and the remaining phases have been dry-run against the
actual post-convergence plan contracts. After each phase, update progress, acceptance evidence,
decisions, course corrections, and cleanup targets in this document before continuing.
