# Holtburger Client Dynamic Delta and Solver Epoch Plan

Status: **Execution in progress; Phase 0 complete, Phase 1 active (2026-08-28).**

Origin: investigation of client-mode stalls after entering dungeon EnvCell `0x00070156`.

## Context and Boundaries

### Goal

Restore proportional client presentation and physics work by preserving dynamic-entity deltas through
the frontend and by solving each scheduled physical body from one immutable, single-solve tick epoch.

### Why this cutover is deserved

Two independent structural defects were exposed by the same client-mode workload.

The frontend receives a lossless dynamic event vocabulary—snapshot, upsert, removal, and advance—but
`ClientPresentationSession` converts every non-advance event into an asynchronous reconciliation of
the complete current mirror. Each queued callback rereads the mirror when it eventually runs. A
spawn/property/body-event burst can therefore enqueue many complete reconciliations of the same final
population. Each reconciliation reapplies unchanged placement, recursively synchronizes spatial
subtrees, transforms bounds, and removes and reinserts culling entries.

The host's dynamic collection prepares an environment-only `PhysicalBodyTickCommit` for every
scheduled mover so all dynamic contacts observe one immutable tick start. The later transaction does
not consume that plan: it clones the body and actuation and calls `solve_physical_body_tick` again.
Collection preparation also clones every dynamic `SpatialBody`, including containers for immutable
prepared target geometry, into a second map and rebuilds a separate shadow index. The interdependent
epoch facts live in three mutable scene fields rather than one type that enforces their joint
lifetime.

These are contract and ownership defects, not requests for speculative micro-optimization. The plan
uses clean cutovers and deletes the superseded whole-mirror and double-solve paths.

### In scope

- Preserve accepted `DynamicEntityEvent` variants through client presentation.
- Reserve full-population replacement for hydration, reset, and explicit residency convergence.
- Add generation-safe incremental installation, replacement, removal, and advance operations to the
  shared browser presentation runtime.
- Reevaluate only deferred entities affected by scene-residency or attachment-parent availability.
- Avoid spatial-index mutation when an accepted entity delta does not change placement.
- Collapse dynamic collection state into one invariant-bearing solver epoch.
- Compute each scheduled mover's environment-only plan once and use it as the basis for dynamic
  contact resolution and commit.
- Separate or share immutable prepared target geometry so tick-start capture does not duplicate its
  vectors.
- Remove redundant body, actuation, motion-path, and host tick-envelope clones where ownership can be
  transferred or borrowed honestly.
- Prove why steady bodies remain scheduled, then correct wake/settle policy if the census identifies
  false activity.
- Update both client and Explorer consumers of the shared dynamic collection API.
- Use the existing non-interactive live client probe for host/core corroboration and the existing
  CDP browser harness for deterministic presentation/WebGL regression coverage.
- Verify the complete Electron-to-renderer path interactively in the original dungeon after the
  two narrower harness layers pass.

### Out of scope

- Changing retail-observable collision, motion, contact-report, or EnvCell behavior.
- Raising or lowering the 30 ms client physics cadence.
- Replacing the collision algorithms, response policy, dynamic-contact directionality, or report
  lifetime model.
- Introducing worker-thread physics, ECS migration, arena allocation, object pools, or a second
  presentation mirror.
- Retaining the investigation's production profiling hooks, counters, environment variables, or
  keyboard shortcut.
- Creating a generalized network/event recorder or replay format before a deterministic failure
  remains that the existing live probe and browser harness cannot isolate.
- Adding a permanent Electron automation bridge, credential-bearing command-line arguments, or a
  second implementation of the client transport solely for this repair.
- Treating a coalescing flag as the primary frontend fix. A bounded replacement request may be used
  for genuine snapshot/residency invalidation, but ordinary deltas stay ordinary deltas.
- Optimizing Explorer-only UI or renderer drawing paths unrelated to dynamic presentation mutation.

## Ground Truth

### Runtime contracts

- `crates/holtburger-core/src/client/dynamic_entity_view.rs` publishes the canonical snapshot,
  upsert, removal, and advance events.
- `crates/holtburger-core/src/client/mod.rs::handle_runtime_world_event` identifies which semantic
  world changes produce dynamic upserts.
- `apps/holtburger-3d/src/lib/game/runtime/dynamic-entity-feed.ts::DynamicEntityMirror` already
  enforces hydration, generation, removal, and advance ordering before presentation observes an
  event.
- `apps/holtburger-3d/src/client/client-presentation-session.ts::receiveDynamic` is where accepted
  event identity is currently discarded.
- `apps/holtburger-3d/src/lib/game/runtime/game-presentation-runtime.ts` owns desired dynamic state,
  asynchronous visual realization, attachment dependencies, scene eligibility, placement, and
  removal.
- `apps/holtburger-3d/src/lib/game/scene/scene-graph.ts` owns placement-derived spatial membership and
  culling entries. Entity consumers must not mutate its index for unchanged placement.

### Solver contracts

- `crates/holtburger-world/src/spatial/scene.rs::prepare_dynamic_entity_collection` captures dynamic
  participants, builds the shadow index, computes environment-only plans, and opens the collection
  epoch.
- `crates/holtburger-world/src/spatial/scene.rs::tick_dynamic_physical_body_transaction` validates
  tick-start currentness and commits one mover.
- `crates/holtburger-world/src/spatial/dynamic_contact.rs::resolve_dynamic_contacts` reads peer
  tick-start bodies and planned paths while refining the mover's environment plan.
- `crates/holtburger-world/src/spatial/physical_body.rs::solve_physical_body_tick` is the expensive
  environment solver that must run once per ordinary scheduled mover.
- `crates/holtburger-core/src/client/simulation.rs::tick_physical_entities` and
  `apps/holtburger-3d/host/src/host_simulation_runtime.rs::tick_dynamic_entity_collection` are the
  two production collection consumers.
- `crates/holtburger-world/src/spatial/dynamic_body.rs::PreparedEntityTargetGeometry` is immutable
  decoded geometry currently held by value inside cloneable mutable body state.

### Investigation evidence

The 2026-08-28 interactive capture used client mode in dungeon EnvCell `0x00070156`, a
`1441 x 903` drawing buffer, 163 projected entities, 52 scheduled physical movers, and 21 visible
dynamic entities. The temporary instrumentation was removed when this plan was created.

- The host sustained 34 physics ticks per second with zero steady overruns.
- A steady tick averaged approximately 13.7 ms; simulation accounted for approximately 11.2 ms.
- The steady dynamic feed published zero placement advances while the host still scheduled 52
  physical movers.
- The host published 34 camera paths per second, so the authority cadence was not backing up.
- A requested 10-second renderer CPU capture spanned approximately 47.5 seconds before the profiler
  could stop.
- Renderer samples were dominated by complete dynamic reconciliation and its spatial descendants:
  AABB transformation, subtree synchronization, membership validation, placement application, and
  culling-index removal/insertion. Drawing and particles were not dominant.
- The sampled caller chain led from `reconcileDynamicEntities` to
  `ClientPresentationSession`'s serialized mutation queue.
- Local Svelte UI remained responsive. Client camera paths, diagnostics timers, and host invocation
  completions lagged, distinguishing domain/IPC completion pressure from a total browser UI freeze.
- Client initialization invokes dynamic replacement before it has established scene interest, and
  `selectDynamicReconciliationCandidates` treats empty interest as universal eligibility. The
  focused-test fallback therefore realizes the complete 163-entity population in production.
- `remote_entity_actuation` correctly produces coasting actuation when an authoritative motion
  snapshot contributes no drive, but `accepted_dynamic_tick_is_stable` refuses to settle every body
  with any `motion_state`. A standing semantic motion level can consequently keep a physically
  unchanged remote scheduled indefinitely.

These measurements justify the work and provide a scenario for comparison. They are not permanent
budgets and must not become runtime diagnostics.

## North Stars

1. Preserve the producer's semantic delta until the layer that owns its consequence consumes it.
2. Snapshot replacement is an exceptional synchronization operation, not the universal mutation
   primitive.
3. A solver epoch computes each derived fact once and carries it in the epoch contract.
4. Immutable content is shared; mutable body state is captured only to the fidelity peer solving
   requires.
5. Settled bodies remain valid collision targets without becoming unconditional movers.
6. Generation, attachment, residency, and transaction invariants fail loudly rather than becoming
   silent fallback reconciliation.
7. Client and Explorer share authoritative world and presentation mechanisms without importing each
   other's UX or transport policy.
8. Performance acceptance is stated as proportional work and responsive behavior, not a magic
   hardware-specific timing threshold.

## Settled Direction Decisions

### D1. The lifecycle mirror remains the accepted frontend authority

`DynamicEntityMirror` and `DynamicEntitySession` continue to validate and apply host event ordering.
`DynamicEntitySession` already suppresses rejected events, so presentation consumes the existing
accepted `DynamicEntityEvent` directly; no second accepted-event wrapper or generation validator is
introduced. The runtime may retain desired presentation records for asynchronous realization, but
that map is a realization ledger, not a second source that requires whole-population
resynchronization after each event.

### D2. Presentation exposes explicit replacement and delta operations

Replace the ambiguous universal `reconcileDynamicEntities` surface with honest operations for:

- complete snapshot replacement;
- one accepted entity upsert;
- one exact-generation removal;
- one accepted advance batch; and
- explicit deferred-eligibility reevaluation after residency or attachment prerequisites change.

Explorer and harness callers that genuinely own complete arrays use the snapshot operation. Client
lifecycle dispatch switches on the accepted event variant. No adapter converts upserts back into a
whole-mirror call.

### D3. Incremental entity work follows the impacted dependency tree

A world-root upsert realizes or updates that root. An attached entity upsert realizes it when its
parent is installed or remains explicitly deferred. Installing/removing/replacing a parent revisits
only its deferred or installed descendants. Scene-interest publication revisits deferred entities in
the scopes whose readiness changed; it does not replay every installed placement.

The runtime owns static-layer publication and already emits exact scene-availability facts. It
therefore wakes its own scope-keyed deferred entities when terrain or EnvCell topology publishes;
the frontend does not subscribe merely to route those facts back into their owner. Before interest
exists, snapshots populate desired authority but realize nothing. Remove the implicit “empty
interest means every entity is eligible” production fallback; focused tests explicitly install the
scope capability they exercise.

The desired record stores the generation, visual identity, placement/attachment identity, and
presentation state needed by named consumers. Those facts are compared before invoking scene
placement, attachment, visual, or animation mutations, so a state-only update cannot rebuild the
spatial index.

### D4. Dynamic collection state becomes one epoch

Replace `dynamic_pending_movers`, `dynamic_shadows`, and `dynamic_tick_start` with one optional
`PreparedDynamicEntityEpoch`. The epoch owns:

- the immutable target index;
- stable participant records;
- scheduled mover identity/order;
- each scheduled mover's actuation and environment-only plan;
- pending/attempted state; and
- coverage rejections.

Opening a second epoch before finishing the first and finishing with unattempted movers remain loud
invariant failures. Suspending/resetting bodies explicitly closes or invalidates the epoch.

Continue compiling one immutable `DynamicShadowIndex` per epoch initially. Target membership and
placement can change during every accepted tick, so replacing that honest derived snapshot with an
incremental invalidation system would add state and failure modes without evidence it remains
material after the double solve and cloning are removed. Resteer B may promote it only if the
post-cutover workload identifies index construction as the next dominant structural cost.

### D5. Environment plans are computed once

Preparation runs `solve_physical_body_tick` once for each scheduled mover. Dynamic-contact
resolution starts from that plan. It may perform the existing bounded partial solve after a selected
blocking contact, because that solve represents a different accepted duration; it may not repeat the
ordinary full-duration environment solve.

Dynamic-contact selection returns a patch/consequence over the immutable prepared environment plan
rather than mutating a clone of that plan. No-contact movers consume the original plan directly; the
existing blocking-contact branch may replace it with the distinct bounded partial solve it already
computes. After every peer query has read the complete immutable tick start, stable-ID finalization
moves the selected plan into the ordinary commit path. This preserves peer epoch semantics without
cloning a complete motion path merely to appease iteration order.

The collection API gets this focused prepared-plan finalization path. Current production collection
callers pass no-op acceptance closures; the callback-bearing single-body transaction used by
physical fly remains separate and unchanged unless execution discovers a real shared primitive.

### D6. Immutable geometry is not part of repeated mutable snapshots

Share `PreparedEntityTargetGeometry` as one immutable composite, or separate it from mutable dynamic
runtime state with equivalent ownership. Copying a tick-start body may copy compact kinematics,
response, collision policy, activity, and placement facts; it must not allocate new vectors for
unchanged BSP-part and fallback-shape collections.

This is internal ownership, not retail behavior and not a compatibility marker. Equality remains
content-identity/placement based rather than pointer-identity based.

### D7. Liveness follows remaining projection work, not snapshot presence

An authoritative `motion_state` is a semantic input level, not proof of remaining displacement. The
actuation already computes whether this tick has controller, launch, acceleration, or flight work.
Stability uses that derived fact together with accepted zero kinematics, support, residual contact,
and path state; it does not separately require `motion_state.is_none()`.

Zero presentation advances alone still do not prove a body should sleep: stale support proofs,
projectiles, collision reports, or dynamic peer response may require a solve without visible motion.
A temporary harness census corroborates how much of the dungeon population the proven snapshot
predicate retains and identifies any other admission reason. Production code retains no diagnostic
reason field.

### D8. Temporary profiling does not survive the implementation

Use existing harness/CDP capabilities or short-lived focused probes while executing the plan. Remove
all task-specific counters, logs, environment switches, output paths, and shortcuts before each
phase closes. Tests assert behavior and bounded work structure, not debug log text.

### D9. Verification composes the existing harness layers

Do not build generalized replay as a prerequisite. `scripts/live-client-probe.mjs` already drives
the real host/core client against ACE through the private sidecar protocol, including login,
character selection, camera startup, motion input, event-frame census, and orderly disconnect. The
browser harness already supplies deterministic CDP control over presentation, rendering, and
synthetic dynamic populations. Together they isolate the two structural defects without creating a
second transport or freezing incidental wire/event timing into a fixture format.

Harden the live probe only enough to make failures actionable: include its last completed phase,
accepted lifecycle history, and credential-redacted terminal diagnostic in failure JSON. Continue
accepting credentials only through the environment. Do not print raw host stderr and do not place
credentials in arguments, URLs, traces, screenshots, or generated artifacts. Serialize live probe
runs and wait at least 10 seconds after the prior successful session ends before logging in again;
ACE rejects a repeated login inside that cooldown. Do not disguise other login failures as cooldown
retries.

The complete Electron integration remains one final interactive acceptance because the current
launch contract accepts credentials as arguments and the product renderer has no automation API.
Building a secure credential handoff plus permanent renderer control surface is not a small adjunct
to this repair. Promote that work only if the split harnesses pass while the interactive Electron
scenario still fails, which would prove an integration-only defect worth isolating. A replay format
has the same promotion rule and must cover static content/residency, dynamic events, camera commands,
host invocation completion, and timing before it can claim fidelity.

## Phased Implementation

### Phase 0: Contract dry run and regression fixtures

#### Deliverables

- Map every production caller of dynamic presentation replacement and dynamic collection solving.
- Make the existing live client probe report credential-redacted failure progress so a timeout can
  distinguish connection, authentication, character selection, and in-world stalls.
- Add focused tests that reproduce repeated client upserts without depending on runtime DAT assets.
- Add solver behavior fixtures covering no-contact, blocking-contact, coverage-rejection, and report
  lifetime outcomes for multiple scheduled movers and dynamic peers.
- Record exact before-cutover expected event ordering, attachment behavior, report lifetime, and
  coverage-rejection behavior in the relevant tests.

#### Acceptance criteria

- A client presentation test demonstrates that a snapshot followed by multiple upserts currently
  requests repeated full replacement.
- A failed live probe reports its last completed phase and accepted lifecycle history without
  exposing account or password values; a successful probe remains one machine-readable JSON result.
- Solver fixtures preserve accepted paths, contacts, placement, independent coverage rejection, and
  report starts/ends across the epoch cutover.
- Fixtures are synthetic, deterministic, and exercise runtime constants rather than copied magic
  values.

#### Checklist

- [x] Inventory `reconcileDynamicEntities` callers and classify snapshot owners versus delta owners.
- [x] Inventory collection callers and callback/rollback requirements.
- [x] Identify every consumer of `DynamicTickStartBody::planned`.
- [x] Harden and test the existing live probe's redacted failure result and 10-second cooldown
  precondition.
- [x] Add focused frontend regression and identify the existing solver behavior fixtures.
- [x] Dry-run Phases 1-4 against attachment, portal activation, and coverage rejection.

### Phase 1: Cut client presentation over to semantic deltas

#### Deliverables

- Rename the full-array runtime operation to explicit snapshot/replacement vocabulary.
- Add typed runtime operations for accepted upsert and exact-generation removal.
- Dispatch accepted event variants directly in `ClientPresentationSession`.
- Delete the ordinary-event `requestReconciliation` path and its FIFO multiplication.
- Keep one explicit full replacement for initialization/reset and one explicit deferred eligibility
  reevaluation for scene activation.
- Store hydration authority without realizing entities until explicit scene interest/activation is
  installed; delete empty-interest universal eligibility.

#### Acceptance criteria

- One upsert touches only its entity and dependency descendants.
- One removal retires only the matching generation and attached descendants.
- A stale removal or older upsert cannot affect a newer generation.
- A burst of 163 upserts cannot invoke 163 complete-population replacements.
- Portal activation still waits for the exact local-player generation to become presentable.
- Initial hydration cannot realize out-of-interest entities before scene demand exists.
- Explorer and browser-harness snapshot consumers compile against the renamed honest operation.

#### Checklist

- [ ] Define the focused presentation mutation contract.
- [ ] Cut over client lifecycle dispatch.
- [ ] Preserve mirror hydration and accepted-event ordering.
- [ ] Update Explorer/harness snapshot call sites.
- [ ] Delete obsolete reconciliation queue vocabulary and tests.

### Phase 2: Make incremental presentation proportional

#### Deliverables

- Split visual identity, placement/attachment identity, and mutable presentation state application.
- Skip `DynamicEntitySystem.updatePlacement` when placement identity is unchanged.
- Track deferred attachment/residency dependencies by the key that can wake them.
- Reevaluate only affected deferred entities when a parent or runtime-owned scene-availability fact
  becomes ready.
- Retain asynchronous visual-load currentness and generation cancellation without whole-mirror
  repair passes.

#### Acceptance criteria

- State-only upserts do not call scene spatial-subtree synchronization.
- Placement upserts update one entity subtree exactly once.
- Parent-before-child and child-before-parent delivery converge to the same installed hierarchy.
- A visual completing after removal/replacement cannot publish stale geometry.
- Scene-interest changes neither withdraw eligible installed entities nor realize out-of-scope ones.

#### Checklist

- [ ] Introduce focused comparison/value helpers at the runtime ownership boundary.
- [ ] Separate desired-state update from realization and placement mutation.
- [ ] Add attachment and residency dependency tests.
- [ ] Remove fallback full replacements used only to repair incremental gaps.

### Resteer A: Frontend ownership review

Review the resulting runtime maps and APIs before touching the solver. Confirm there is one accepted
frontend authority, one presentation realization ledger, and no hidden whole-population path on
ordinary events. Run the browser harness and the interactive dungeon scenario. If spatial work still
scales with unchanged population, stop and correct Phase 2 rather than carrying compensating queues
forward.

### Phase 3: Introduce the invariant-bearing solver epoch

#### Deliverables

- Add the composite prepared epoch and participant/mover record types in `holtburger-world`.
- Move target index, tick-start participant state, prepared plans, pending state, and coverage
  rejection ownership into the epoch.
- Replace the prepare/mutate/finish API's parallel fields with operations on the active epoch.
- Preserve stable identity order, directional peer response, independent mover rejection, and loud
  incomplete-epoch failures.

#### Acceptance criteria

- Interdependent epoch facts cannot exist independently in `SpatialScene`.
- Every accepted dynamic solve reads the same tick-start population and target index.
- Coverage failure for one mover does not prevent independent movers from committing.
- Report touches begin/end with the same collection-level semantics.
- Existing world and Explorer collection scenarios retain their accepted results.

#### Checklist

- [ ] Define the minimal tick-start participant and prepared mover records.
- [ ] Collapse the three scene fields into one epoch.
- [ ] Migrate world, core client, and Explorer host callers.
- [ ] Rewrite ossified tests around the new epoch contract rather than preserving call choreography.

### Phase 4: Consume one prepared plan and remove redundant ownership copies

#### Deliverables

- Resolve dynamic contacts from each mover's prepared environment plan.
- Commit the resulting body state without a second full-duration environment solve.
- Share immutable prepared target geometry.
- Remove collection-only callback construction that clones previous/current/result values before
  returning the same products again.
- Remove the separate client actuation map when the epoch record can own actuation directly.

#### Acceptance criteria

- The collection call graph contains one full-duration `solve_physical_body_tick` per prepared mover;
  no diagnostic counter or injectable solver exists solely to assert that implementation detail.
- Dynamic blocking contact still performs only the distinct bounded partial solve it requires.
- Tick-start geometry containers are not reallocated per body snapshot.
- Collection host ticks do not clone complete previous/current/result products through a no-op
  acceptance callback; any surviving canonical-store/output copy names both simultaneous owners.
- No `clone()` remains on these paths without a named simultaneous owner and documented reason.
- Collision, placement, contact, projectile, and report tests pass unchanged in behavior.

#### Checklist

- [ ] Make dynamic-contact resolution return a patch/consequence over the prepared plan.
- [ ] Remove the second `solve_physical_body_tick` call.
- [ ] Move immutable geometry behind shared composite ownership.
- [ ] Give collection finalization a focused non-callback API and sweep host-envelope clones.
- [ ] Review every surviving clone in the epoch hot path.

### Phase 5: Prove and correct dynamic-body liveness

#### Deliverables

- Add a temporary focused census in the debug harness that records the admission and retained-active
  reason for each scheduled mover.
- Reproduce the dungeon-shaped population synthetically where possible and corroborate its external
  behavior against the non-interactive live client probe.
- Remove snapshot-presence from the stability predicate; use the already-derived actuation work and
  accepted physical result to decide whether the body settles.
- Correct any additional unjustified admission/wake reason exposed by the census at its owning
  transition.
- Delete the census after tests encode each discovered reason.

#### Acceptance criteria

- Every scheduled body has a runtime-semantic reason: controller/velocity work, authored drive,
  stale support, projectile state, reporting, or dynamic wake.
- A coasting body on proven stable support settles and leaves the mover list while remaining an
  eligible dynamic-contact target.
- A standing authoritative motion snapshot with no projection contribution can settle.
- A motion snapshot contributing authored drive remains active.
- A sleeping target wakes when a directional collision/report dependency requires it.
- No production diagnostic reason enum, counter, or logger survives.

#### Checklist

- [ ] Census scheduled admission predicates.
- [ ] Census failed stability predicates.
- [ ] Replace `motion_state.is_none()` with the existing derived-work invariant.
- [ ] Correct the owning liveness transition, not its callers.
- [ ] Add focused wake/sleep/report regression tests.
- [ ] Remove temporary evidence code.

### Resteer B: Work and behavior review

Compare the implementation with the original evidence scenario. Confirm that frontend mutation work
tracks accepted deltas, environment solves track scheduled movers one-for-one, and scheduled movers
have justified liveness. Reorder remaining cleanup if new duplicate representations or vocabulary
were introduced. Do not add permanent metrics to make the comparison convenient.

### Phase 6: Cleanup and vocabulary sweep

#### Deliverables

- Delete obsolete reconciliation, pending-mover, tick-start-map, and double-solve mechanisms.
- Sweep comments, tests, types, and diagnostics for the removed vocabulary.
- Remove temporary harness probes and generated profile/log files from documented workflows.
- Leave the plan's decisions/findings updated with any course corrections.

#### Acceptance criteria

- No compatibility adapter retains the old presentation or solver collection architecture.
- No task-specific profiling environment variable, Electron shortcut, stderr summary, or production
  counter remains.
- Touched code is formatted, lint-clean, and comments describe the final architecture.

### Phase 7: Integrated verification

#### Deliverables

- Rust unit/integration verification across `holtburger-world`, `holtburger-core`, and the 3D host.
- TypeScript/Svelte unit, type, lint, and browser-harness verification.
- Non-interactive live host/core acceptance against the local ACE endpoint.
- Interactive Electron client-mode acceptance in the original dungeon.

#### Acceptance criteria

- Camera orbit updates promptly in the 3D view and remains aligned with the minimap intent.
- Other players present motion without accumulating visible delay.
- Chat submission settles and clears normally.
- FPS and rendered-frame diagnostics update at their configured sampling cadence.
- Client and host CPU no longer exhibit population-multiplied idle work in the scenario.
- Explorer behavior and collision outcomes remain correct.

#### Checklist

- [ ] `cargo fmt --all -- --check`
- [ ] `cargo clippy -p holtburger-world -p holtburger-core -p holtburger-3d-host --all-targets -- -D warnings`
- [ ] Focused Rust tests for spatial collection, client simulation, and host simulation.
- [ ] `npm run check`
- [ ] Focused Vitest suites for dynamic feed, presentation session, runtime, and scene graph.
- [ ] `npm run harness:browser -- ...` with synthetic delta/attachment scenarios.
- [ ] `npm run probe:client` against the local ACE endpoint with credentials supplied through the
  environment and the server cooldown satisfied.
- [ ] Interactive client-mode dungeon acceptance by the user.

## Risks and Mitigations

### Attachment delivery can be out of order

An incremental API can expose children before parents. Retain explicit deferred ownership keyed by
parent GUID/generation and test both delivery orders. Do not fall back to whole-mirror repair.

### Async visual loads can complete after supersession

Continue checking the exact desired generation and visual identity at publication. Cancellation and
resource release must be generation-owned, not inferred from current population scans.

### Portal activation currently uses reconciliation as a readiness barrier

Replace it with an explicit local-player/deferred-eligibility convergence operation. Readiness names
the exact activation generation and installed player; it does not imply a general snapshot replay.

### Dynamic peers require immutable tick-start trajectories

Moving prepared plans must not make later movers observe already-committed peers. Resolve dynamic
contacts against the complete immutable prepared epoch before committing, or retain a separate
compact peer trajectory product. Never borrow the mutable canonical body store as peer authority.

### Coverage rejection and callbacks currently depend on per-body transactions

The dry run confirmed production collection callers pass no-op acceptance callbacks; the meaningful
callback consumer is the separate single-body physical-fly transaction. Preserve independent
collection coverage failure and commit semantics with a focused finalizer, and leave the single-body
acceptance transaction intact.

### Shared geometry can accidentally introduce pointer-based semantics

Keep equality and compatibility based on content identity and placement facts. `Arc` is ownership,
not identity, and must not leak into protocol or presentation contracts.

### Settling too aggressively can break collision reports

Classify wake reasons before changing scheduling. Settled bodies stay indexed targets, and report
lifetime/stale-support paths retain explicit wake behavior.

## Definition of Done

- [ ] Accepted client dynamic deltas remain deltas through presentation.
- [ ] Full snapshot replacement occurs only at named hydration/reset/residency boundaries.
- [ ] Ordinary entity updates perform no unchanged-population spatial work.
- [ ] The solver owns one composite prepared epoch.
- [ ] Every ordinary scheduled mover performs one full-duration environment solve.
- [ ] Immutable target geometry is shared rather than vector-cloned into tick snapshots.
- [ ] Surviving hot-path clones each have a simultaneous owner that requires them.
- [ ] Every scheduled mover has a proven semantic wake reason.
- [ ] Client camera, remote motion, chat, diagnostics, and Explorer behavior pass acceptance.
- [ ] Formatting, clippy, TypeScript/Svelte checks, focused tests, and browser harness pass.
- [ ] Temporary profiling and diagnostic code is absent.
- [ ] Removed architecture vocabulary is swept from code, tests, comments, and UI.

## Open Questions

None block execution. Phase 5 still measures whether admission reasons beyond the proven
`motion_state` stability defect materially contribute to the dungeon population, but that is an
implementation finding with an explicit decision rule rather than missing plan direction.

The existing live probe was built and invoked against `127.0.0.1:9000` during the plan dry run. Two
sandbox-permitted attempts, including one after more than the server's approximately 10-second
successful-login cooldown, reached the probe's character-selection wait and timed out without an
actionable failure record. The probe currently discards progress and raw host stderr, so these runs
do not prove whether authentication, account occupancy, or lifecycle delivery failed. Phase 0 closes
that observability gap before using the probe as acceptance evidence.

## Execution Progress

### Phase 0 — complete (2026-08-28)

- Classified `ClientPresentationSession` and Explorer lifecycle dispatch as delta owners. Browser
  scenario setup and explicit hydration/reset call sites are complete-snapshot owners.
- Confirmed the two production dynamic-collection consumers are client simulation and the Explorer
  host runtime. Their collection acceptance callbacks return `Ok(())`; the meaningful rollback
  callback remains confined to the separate single-body transaction API.
- Confirmed `DynamicTickStartBody::planned` is consumed only by dynamic-contact peer bounds, pose,
  and velocity sampling plus the collection transaction path that currently recomputes the plan.
- Added a focused frontend characterization proving that three accepted upserts enqueue three full
  reconciliations and that every callback rereads the same final mirror.
- Reused the existing solver fixtures rather than adding duplicates. The 440-test
  `holtburger-world` library suite already exercises no-block/report-only contact, directional
  blocking, independent coverage rejection, consumer rollback, report starts/ends, stable peer
  selection, and immutable tick-start trajectories; it passes before the cutover.
- Split live-probe failure reporting into a testable harness-only helper. Failures now retain the
  last completed phase, lifecycle history, terminal events, and a bounded credential-redacted host
  diagnostic. Focused Vitest and TypeScript checks pass.
- A live run after the ACE cooldown established `authenticating → character-selection →
  portal-space`, then timed out awaiting `in-world` after character selection. This corrects the
  earlier ambiguous diagnosis; a longer bounded run remains Phase 7 evidence, not a blocker for the
  deterministic frontend cutover.

**Decision:** Existing solver characterization is stronger and broader than new plan-shaped
lookalikes, so Phase 0 records and runs it instead of adding ceremonial tests.

**Debt carried forward:** The live probe still uses one timeout value for distinct lifecycle waits.
Its new phase/predicate diagnostics make failures actionable; separate timeout policy is deferred
unless a longer world-entry run proves the single bound materially wrong.

## Decisions and Course Corrections

- **2026-08-28:** Rejected reconciliation coalescing as the primary fix because it retains snapshot
  semantics for a delta protocol and preserves population-scaled work.
- **2026-08-28:** Selected a composite solver epoch and single prepared environment plan rather than
  optimizing the existing double-solve transaction piecemeal.
- **2026-08-28:** Dry-run confirmed `DynamicEntitySession` already emits only mirror-accepted
  events; rejected a redundant accepted-event wrapper in presentation.
- **2026-08-28:** Dry-run found client hydration reaches the runtime before scene interest and that
  empty interest currently means universal eligibility; added desired-only hydration and removal of
  that implicit production fallback.
- **2026-08-28:** Dry-run replaced the vague two-phase clone strategy with dynamic-contact patches
  over one immutable prepared plan and a focused collection finalizer. The callback-bearing
  single-body transaction remains separate.
- **2026-08-28:** Dry-run proved `motion_state.is_none()` prevents a standing authoritative motion
  level from settling even when its derived actuation and accepted physical result contain no work;
  selected the existing derived-work invariant as the liveness owner.
- **2026-08-28:** Removed the investigation's temporary host tick profiler and Electron F8 CPU
  capture instead of carrying diagnostic machinery into production.
- **2026-08-28:** Reused the existing live sidecar probe and CDP browser harness as complementary
  verification layers. Deferred generalized replay and permanent Electron automation because a
  faithful implementation would require static residency, dynamic events, commands, timing, and a
  secure credential handoff; none is justified unless the split harnesses miss a reproducible
  integration-only failure.
- **2026-08-28:** Two live probe dry runs built successfully and reached the character-selection
  wait, including a retry after the server's successful-login cooldown, then timed out with no
  retained phase/lifecycle diagnostic. Added bounded, credential-redacted failure reporting and an
  explicit cooldown precondition to Phase 0 rather than reviving production profiling.
