# Holtburger Client Dynamic Delta and Solver Epoch Plan

Status: **Complete (2026-08-28).**

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
`PreparedDynamicEntityEpoch`. Epoch preparation owns:

- the immutable target index until all directional peer consequences are sealed;
- stable participant records;
- each scheduled mover's actuation and environment-only plan until its peer consequence is sealed;
- stable mover identity/order plus each selected final plan and consequence; and
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

- [x] Define the focused presentation mutation contract.
- [x] Cut over client lifecycle dispatch.
- [x] Preserve mirror hydration and accepted-event ordering.
- [x] Update Explorer/harness snapshot call sites.
- [x] Delete obsolete reconciliation queue vocabulary and tests.

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

- [x] Introduce focused comparison/value helpers at the runtime ownership boundary.
- [x] Separate desired-state update from realization and placement mutation.
- [x] Add attachment and residency dependency tests.
- [x] Remove fallback full replacements used only to repair incremental gaps.

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

- [x] Define the minimal tick-start participant and prepared mover records.
- [x] Collapse the three scene fields into one epoch.
- [x] Migrate world, core client, and Explorer host callers.
- [x] Rewrite ossified tests around the new epoch contract rather than preserving call choreography.

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

- [x] Make dynamic-contact resolution return a patch/consequence over the prepared plan.
- [x] Remove the second `solve_physical_body_tick` call.
- [x] Move immutable geometry behind shared composite ownership.
- [x] Give collection finalization a focused non-callback API and sweep host-envelope clones.
- [x] Review every surviving clone in the epoch hot path.

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

- [x] Census scheduled admission predicates.
- [x] Census failed stability predicates.
- [x] Replace `motion_state.is_none()` with the existing derived-work invariant.
- [x] Correct the owning liveness transition, not its callers.
- [x] Add focused wake/sleep/report regression tests.
- [x] Remove temporary evidence code.

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

- [x] `cargo fmt --all -- --check`
- [x] `cargo clippy -p holtburger-world -p holtburger-core -p holtburger-3d-host --all-targets -- -D warnings`
- [x] Focused Rust tests for spatial collection, client simulation, and host simulation.
- [x] `npm run check`
- [x] Focused Vitest suites for dynamic feed, presentation session, runtime, and scene graph.
- [x] `npm run harness:browser -- ...` with synthetic delta/attachment scenarios.
- [x] `npm run probe:client` against the local ACE endpoint with credentials supplied through the
  environment and the server cooldown satisfied.
- [x] Interactive client-mode dungeon acceptance by the user.

## Risks and Mitigations

### Attachment delivery can be out of order

An incremental API can expose children before parents. Retain explicit deferred ownership keyed by
parent GUID/generation and test both delivery orders. Do not fall back to whole-mirror repair.

### Async visual loads can complete after supersession

Continue checking the exact desired generation and visual identity at publication. Cancellation and
resource release must be generation-owned, not inferred from current population scans.

### Portal activation can conflate static readiness with dynamic realization

Use the explicit local-player/deferred-eligibility convergence operation. Readiness names
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

- [x] Accepted client dynamic deltas remain deltas through presentation.
- [x] Full snapshot replacement occurs only at named hydration/reset/residency boundaries.
- [x] Ordinary entity updates perform no unchanged-population spatial work.
- [x] The solver owns one composite prepared epoch.
- [x] Every ordinary scheduled mover performs one full-duration environment solve.
- [x] Immutable target geometry is shared rather than vector-cloned into tick snapshots.
- [x] Surviving hot-path clones each have a simultaneous owner that requires them.
- [x] Every scheduled mover has a proven semantic wake reason.
- [x] Client camera, remote motion, chat, diagnostics, and Explorer behavior pass acceptance.
- [x] Formatting, clippy, TypeScript/Svelte checks, focused tests, and browser harness pass.
- [x] Temporary profiling and diagnostic code is absent.
- [x] Removed architecture vocabulary is swept from code, tests, comments, and UI.

## Open Questions

None. The plan is complete.

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

### Phases 1–2 — complete (2026-08-28)

- Replaced the universal full-array presentation operation with explicit snapshot replacement,
  accepted upsert, exact-generation removal, advance, and eligibility-boundary operations. Client
  and Explorer ordinary lifecycle dispatch now preserve the accepted event variant; browser setup
  retains explicit snapshot vocabulary.
- Removed the production empty-interest eligibility fallback. Hydration now installs desired
  authority only, and realization begins when the matching terrain or EnvCell capability exists.
- Collapsed each desired presentation into one record containing its entity level, immutable visual
  key, placement identity, current deferral, and exact in-flight realization. Reverse indexes name
  the parent GUID or residency fact that can wake the record.
- Split placement and mutable presentation-state application. A state-only upsert does not bump the
  existing placement revision; one changed world placement bumps it exactly once without a
  task-specific counter.
- Made parent installation wake only indexed children and static publication wake only matching
  deferred residency records. Interest replacement scans only at that explicit boundary, retires
  newly ineligible roots, and leaves desired authority available for exact publication wake-up.
- Preserved shared visual leases across compatible generation replacement and retained exact-record
  checks across asynchronous decoding. Focused tests prove removal/replacement cannot publish stale
  geometry and parent-first/child-first delivery converges.
- Type checks, ESLint, dead-code analysis, and 49 focused feed/session/runtime/terrain tests pass.

**Decision:** Outdoor dynamic placement depends on installed terrain source and its synchronous
scene attachment, not on eventual GPU draw-unit residency. The runtime's existing
`outdoor-terrain-source-available` event publishes the former; requiring the latter left deferred
entities with no event capable of waking them. Scene activation and drawing retain their stricter
resident-draw-unit checks.

**Debt carried forward:** Explicit snapshot/portal convergence still uses reconciliation-shaped
result vocabulary. The ordinary reconciliation queue and full-population path are gone; Phase 6
will sweep the remaining synchronization-boundary names without conflating them with delta ingress.

### Resteer A — complete (2026-08-28)

- Audited the runtime after cutover: `DynamicEntityMirror` remains the single accepted lifecycle
  authority, while the runtime map is a generation-current realization ledger with no event
  subscription or frontend mirror repair loop.
- Confirmed ordinary client and Explorer upserts/removals do not call snapshot replacement.
- The Chrome/WebGL browser harness passed its real catalog-host spawn/current/exact-despawn scenario
  with WCID 7, no browser console errors, one live dynamic entity during presentation, and zero
  dynamic resources after removal.
- Interactive client-mode dungeon acceptance remains the Phase 7 user gate. The earlier live probe
  reached portal-space but not in-world within its current single timeout; repeating that partial
  probe before the solver cutover would not add discriminating evidence.

**Resteer conclusion:** Frontend mutation work now follows accepted deltas and exact dependency
edges. No compensating coalescer or population replay remains, so solver work can proceed without
carrying a known frontend backlog mechanism forward.

### Phase 3 — complete (2026-08-28)

- Replaced the scene's independent target-index, tick-start, and pending-mover fields with one
  optional `PreparedDynamicEntityEpoch`. Its participant records, stable-ID mover map, prepared
  environment plans, pending attempts, fixed interval, and coverage rejections now share one
  representable lifetime.
- Preparation computes participant and mover facts locally and publishes the epoch only after
  successful construction. World, core-client, and Explorer-host consumers receive only the small
  ordered mover/rejection projection and retrieve all solver inputs through the active epoch.
- Opening an overlapping epoch, ticking outside one, finishing without one, and finishing before
  every mover was attempted fail loudly. An incomplete finish retains the epoch so its remaining
  movers can still be attempted.
- Runtime suspension and authoritative reset invalidate the complete epoch because their new
  temporal origin makes every captured participant and plan stale. The next collection operation
  must prepare again.
- Removed the production broad-phase inspection method; its focused test-only replacement requires
  an active epoch instead of turning missing preparation into an empty candidate set.
- The expanded world suite passes 442 tests; complete core and 3D-host library suites pass 282 and
  245 tests respectively.

**Decision:** The remaining mover map is the pending state; removing an entry starts its focused
finalization attempt. Preparation/coverage failures never enter that map, and the callback-bearing
single-body transaction remains the separate rollback surface.

**Debt carried into Phase 4:** The epoch owns the prepared environment plan, but the current dynamic
transaction still clones actuation and invokes the ordinary full-duration solver again. The client
also retains a temporary actuation map to work around its broad world borrow. These are explicit
cutover seams, not accepted final ownership.

### Phase 4 — complete (2026-08-28)

- Dynamic-contact resolution now reads immutable full-duration environment plans and returns an
  optional replacement plan plus peer/report consequences. No-contact movers retain their original
  plan; blocking and work-budget cases alone create the existing distinct bounded-duration plan.
- Sealed every directional peer consequence before the first canonical body commit. Finalization
  consequently moves each selected plan and captured participant body out of the epoch without
  cloning the motion path or making later movers observe committed peers.
- Replaced the collection's callback transaction with
  `tick_prepared_dynamic_physical_body`. The ordinary callback-bearing single-body transaction
  remains intact for physical-fly acceptance; the dead collection consumer-rejection test was
  removed instead of preserving an API with no production consumer.
- Moved target geometry behind `Arc<PreparedEntityTargetGeometry>`. Body snapshots now share the
  immutable BSP-part and fallback-shape vectors while equality continues to use content/placement
  facts rather than pointer identity.
- Changed the internal physical solver to borrow actuation. Full and bounded solves no longer clone
  it, and the client now derives actuation directly into epoch preparation through a stateless
  `BodyProjectionResolver` over disjoint non-scene authority. The temporary population actuation
  map is gone.
- Reviewed remaining collection-path copies: participant bodies coexist with the canonical store
  but share geometry; host previous/current bodies coexist in the returned temporal envelope and
  canonical store; collision scenes and geometry use shared ownership; broad-phase placement folds
  copy path-owned membership because both results survive.
- World, core, and 3D-host library suites pass with 441, 282, and 245 tests respectively.

**Course correction:** The immutable target index is consumed while all directional consequences
are sealed, then dropped before the active finalization epoch is published. Retaining an index that
finalization cannot consume would violate the codebase's named-consumer rule. The active epoch keeps
only captured participants needed for currentness, remaining mover plans/consequences, and coverage
rejections.

**Debt resolved:** The second full-duration solve, collection no-op callback, actuation map, and
vector-owning target-geometry snapshots are gone. No Phase 4 compatibility seam remains.

### Phase 5 — complete (2026-08-28)

- Ran a temporary 163-body debug-harness census with 120 standing authoritative motion snapshots,
  35 snapshot-free coasters, and 8 explicit grounded-drive bodies. Before the correction, the
  coasters settled after support stabilized while all 120 standing snapshots and all 8 driven
  bodies remained scheduled indefinitely.
- Removed `motion_state.is_none()` from the scene-owned stability predicate. Repeating the same
  census left only the 8 driven bodies scheduled after the second epoch; standing snapshots and
  snapshot-free coasters both settled.
- Added a focused regression proving a standing authoritative snapshot survives canonically while
  its body settles. Existing tests already prove the complementary chain: grounded motion content
  resolves to `AuthoredDrive`, explicit grounded drive prevents settling, settled report-only peers
  remain queryable without integration, and the selected directional response wakes exactly its
  settled target.
- Audited admission and wake ownership. Collection admission is limited to eligible active bodies
  plus bodies whose retained support proof is stale in the current collision snapshot. Activity is
  woken by authoritative kinematic/motion changes, explicit scene wake, residency/reconfiguration,
  or an accepted directional response. The census exposed no second unjustified admission or wake
  transition.
- Deleted the temporary census after recording its result and encoding the standing-snapshot case
  in the world suite. No reason enum, counter, logger, or harness source remains.
- Rebuilt the release host and reran the credential-redacted live probe with a 60-second lifecycle
  bound. It again reached `authenticating → character-selection → portal-space`, then timed out
  before `in-world`; therefore it corroborates startup and lifecycle delivery but cannot yet
  discriminate the dungeon's post-entry responsiveness. Interactive acceptance remains Phase 7.

**Decision:** Snapshot presence is authoritative semantic state, not liveness. The already-derived
actuation work and accepted physical result jointly own settling; adding a parallel diagnostic
reason model would duplicate those facts and risk drifting from the scheduler.

**Superseded concession:** The initial probe could not cross portal space because it omitted the
desktop host's external reveal handshake. Phase 7 corrected the headless ordering and exposed a
separate activation race; neither was ordinary server portal latency.

### Resteer B — complete (2026-08-28)

- Frontend ordinary work remains one accepted upsert/removal/advance plus dependency-local wake-up;
  complete population replacement is confined to named synchronization boundaries.
- Environment solves are one full-duration solve per admitted mover. Only selected blocking or
  work-budget contacts compute a semantically distinct bounded-duration replacement.
- After stable support, the synthetic dungeon population fell from 163 scheduled bodies to the 8
  bodies with explicit authored drive. No population-wide standing-snapshot loop remained.
- The active epoch contains only finalization consumers. Its transient target index and trajectory
  map are consumed while sealing peer consequences; participant snapshots, selected plans, and
  coverage rejections survive only as long as finalization requires them.

**Resteer conclusion:** The remaining work is cleanup and integrated verification. No new duplicate
representation or compensating throughput mechanism warrants replanning.

### Phase 6 — complete (2026-08-28)

- Swept production, tests, and UI for the removed universal reconciliation, independent pending
  mover/tick-start maps, second-solve transaction, and task-specific profiling vocabulary. No old
  entry point or compatibility adapter remains.
- Renamed the surviving explicit boundary result from `DynamicEntityReconciliation` to
  `DynamicEntityRealizationResults`, its item result to `DynamicEntityRealizationDisposition`, and
  the client/Explorer readiness state and test ledger accordingly. Snapshot replacement, delta
  ingress, and readiness realization now remain distinct in both API and UI vocabulary.
- Confirmed no `HB_CLIENT_PROFILE`/profiling environment variable, Electron capture shortcut,
  profile log/CPU-profile artifact, task-specific stderr summary, or runtime counter survives.
- Clippy exposed two new correlated argument trains. Collapsed directional contact inputs into one
  immutable `DynamicContactEpoch` contract and tentative publication inputs into one
  `PhysicalBodyCommitInput`; no lint suppression or defaulted field was introduced.
- Formatting, full frontend type/Svelte checks, and strict Rust clippy for world, core, and the 3D
  host pass.

**Decision:** “Reconciliation” remains only where an independently valid subsystem truly compares
two retained levels (for example terrain bakes or scene interest). Dynamic presentation now uses
replacement, upsert/removal/advance, eligibility reevaluation, and realization vocabulary matching
the operation that actually occurs.

**Debt carried into Phase 7:** None from cleanup. The live probe's portal-space integration and the
original interactive dungeon behavior remained explicit acceptance gaps at this boundary.

### Phase 7 — complete (2026-08-28)

- `cargo fmt --all -- --check` and strict clippy across world, core, and the 3D host pass.
- Complete library suites pass: `holtburger-world` 442 tests, `holtburger-core` 284 tests, and
  `holtburger-3d-host` 245 tests.
- Full frontend verification passes: Svelte/TypeScript checks, ESLint, dead-code analysis, and 1,594
  Vitest tests across 215 files.
- The Chrome/WebGL browser harness passes under SwiftShader with a ready scene, advancing frames,
  no application console error, and successful cleanup. The earlier targeted dynamic
  spawn/current/exact-despawn and attachment/delta scenarios remain green.
- The original live probe never acknowledged the external world-reveal generation required by the
  desktop host composition. After adding that handshake, it acknowledged before the first
  collision-backed camera path and exposed a second ordering defect: activation attempted to seed
  a registered camera while destination collision was still pending, terminating on missing
  EnvCell `0x00070156`.
- Added a testable headless reveal adapter and made the probe mirror the renderer's causal boundary:
  portal snapshot, local-player placement, camera registration, first covered camera path, then
  generation-exact reveal acknowledgement.
- Made destination collision residency an explicit core activation prerequisite. Camera seeding now
  waits for both the prepared local body and the installed authoritative destination instead of
  treating ordinary asynchronous scene loading as a missing-cell runtime failure. The focused
  coordinator regression, formatting, and strict core clippy pass.
- Rebuilt the release host and reran the probe after the ACE cooldown. It reached `in-world` and
  completed its 10-second motion window in 11.9 seconds total with 334 camera ticks, accepted drive,
  zero presentation discontinuities, and only the expected explicit-disconnect terminal event.
- The same census reported 18,717 `client-dynamic-entity` frames and 16.4 MiB of dynamic-event
  traffic for 163 entities during that run. That first aggregate did not partition event variants,
  so attributing its complete count to upserts was initially an inference from cadence and source
  flow rather than a direct measurement. A second 10-second live run added a temporary variant
  counter and measured 13,725 dynamic frames for the then-current 117-entity population: 13,651
  upserts, 71 advance batches, and 3 snapshots. The temporary counter was then removed. Source
  tracing confirms every `RuntimeBodyChanged` projects an individual complete dynamic upsert while
  the fixed-tick boundary separately computes an advance batch from before/after views. This is
  proven population-multiplied IPC and presentation ingress.
- After the Phase 7A cutover, the rebuilt release host completed the same 10-second probe with 335
  camera events, accepted drive over 47.3 world units, zero presentation discontinuities, and only
  the expected explicit disconnect. Dynamic publication fell to 695 frames and 1.90 MiB for a
  163-entity peak: 19.7 times fewer frames and approximately 8.6 times fewer bytes than the direct
  13,725-frame/16.4-MiB pre-cutover evidence. The remaining count includes entity-bounded lifecycle
  snapshots/upserts in addition to the steady tick-bounded publications.
- Interactive acceptance in the original dungeon confirms responsive camera motion aligned with
  the minimap, timely remote-player motion, normal chat submission, regularly updating diagnostics,
  and materially lower idle CPU. Explorer behavior also remains correct.

The user selected a tick-owned mixed delta product rather than filtering or receiver coalescing.
Phase 7A preserves placement-stable frontend facts while removing per-commit focused upserts.

#### Phase 7A — complete: Tick-owned dynamic publication

**Implemented contract:** Replace `DynamicEntityEvent::Advanced` with one
`DynamicEntityEvent::Ticked { batch }`. `DynamicEntityTickBatch` owns the shared host time and
duration plus two disjoint stable-GUID collections:

- `advances`: complete final views paired with accepted placement paths;
- `updates`: complete final views whose placement is unchanged but whose other frontend-owned level
  changed.

The constructor rejects an empty batch, duplicate GUIDs, and a GUID present in both collections; it
establishes stable GUID order itself. The external schema owns numeric wire validation. Snapshot,
focused upsert, and exact-generation removal remain unchanged.
This is a clean replacement of the old advance-only tick product, not a second parallel delivery
grammar.

**World/core cutover:**

- Add a precise `WorldEvent::RuntimeBodyAdvanced` emitted only by
  `apply_physical_body_tick_result`. `RuntimeBodyChanged` remains the structural/authoritative body
  replacement edge used by collision preparation, motion/property changes, and other non-tick
  producers.
- Project structural `RuntimeBodyChanged` into the existing focused `RuntimeBodyUpserted`. Collect
  tick-owned `RuntimeBodyAdvanced` views into one new `RuntimeBodiesAdvanced` client event so the
  in-process TUI cache remains current without reproducing per-body broadcast fan-out. The desktop
  host does not forward this cache channel.
- Only structural `RuntimeBodyChanged` may request a focused dynamic upsert. A routine
  `RuntimeBodyAdvanced` is represented by the fixed-tick dynamic product and the one TUI cache
  batch, never by a focused presentation upsert.
- Replace `dynamic_entity_advance_event` with a pure before/after tick builder. For the same current
  generation, world-placement changes become `advances`, placement-stable view changes become
  `updates`, and identical views disappear. Existing lifecycle upserts continue to own generation,
  visual identity, attachment-domain, and spawn/replacement changes.
- Move the client tick baseline to immediately after movement commands, world maintenance,
  collision completion, and activation convergence have published their focused semantic edges,
  but before simulation commits. The tick product then describes simulation alone and cannot
  duplicate a structural upsert from the same turn. Snap/arrival/forced-reposition edges establish
  the new baseline rather than being replayed as an interpolation path.
- Delete the client-only `ClientAdvanceDiscontinuityKind` accumulator and classifier. Teleport/reset
  producers already own lifecycle replacement or presentation-discontinuity edges before the new
  simulation baseline; ordinary client solver paths are integrated. Explorer-authored correction
  kinds remain part of the shared advance item because Explorer has explicit teleport/reset tools.
- Compute the camera tick while borrowing the tick batch, then publish the dynamic batch followed
  by the camera event. This removes the surviving complete advance-batch clone while preserving
  entity-before-camera delivery.

**Frontend/Explorer cutover:**

- Replace the `advanced` schema and mirror branch with `ticked`. Apply all updates and advances
  under one monotonic host-time check and one duplicate-GUID validation transaction.
- Replace `applyDynamicEntityAdvances` with one synchronous tick operation. Updates refresh the
  desired level and installed presentation state without visual realization or scene placement;
  advances additionally install the accepted placement path.
- `ClientPresentationSession` enqueues one mutation for the complete accepted tick rather than one
  mutation per body. Explorer fixed-tick delivery adopts the same shared tick vocabulary; its
  current producer may legitimately populate only `advances`.
- Update the browser harness, Explorer panel bookkeeping, live-probe entity extraction, and focused
  host adapters to consume `ticked` without compatibility shims.

**Production touch points:**

- World/core: `crates/holtburger-world/src/events.rs`,
  `crates/holtburger-world/src/state/mutations.rs`,
  `crates/holtburger-core/src/dynamic_entity_view.rs`,
  `crates/holtburger-core/src/client/dynamic_entity_view.rs`,
  `crates/holtburger-core/src/client/runtime.rs`,
  `crates/holtburger-core/src/client/mod.rs`, and
  `crates/holtburger-core/src/client/camera.rs`, plus the small
  `runtime_body_view_cache.rs` batch-consumer cutover.
- Host/Explorer: `apps/holtburger-3d/host/src/explorer_entity_delivery.rs`, the Explorer fixed-tick
  envelope/runtime producers, and their protocol tests.
- Frontend: `dynamic-entity-feed.ts`, `client-presentation-session.ts`,
  `game-presentation-runtime.ts`, `explorer-fixed-tick.ts`, `ExplorerApp.svelte`, and the browser
  harness adapters that currently switch on `advanced`.
- Tests: colocated world event, core tick-builder/camera, feed/mirror, client presentation, runtime,
  Explorer fixed-tick, and browser-harness fixtures. No new package or permanent diagnostic is
  required.

**Acceptance fixtures:**

- Fifty-two committed but frontend-identical bodies produce no dynamic tick event.
- Three moved bodies plus one placement-stable contact/state change produce one tick containing
  three advances and one update, each GUID exactly once.
- A structural body reconfiguration still produces its focused upsert and is not lost behind the
  tick grammar.
- The TUI runtime-body cache receives every accepted solver body level through one tick batch, while
  structural changes remain focused upserts.
- The client camera consumes the exact matching advance paths and remains published after the
  dynamic tick without cloning the batch.
- The live probe reports dynamic-event traffic proportional to changed tick products rather than
  committed bodies; no temporary variant counter remains.

No dependency, persistent schema, credential flow, or retail behavior change was involved.

**Explicitly out of this cut:** Field-level wire patches, receiver coalescing, worker threads, and
optimizing the existing before/after projection scan without profiling evidence. The current scan
averaged well below the original solver and renderer costs; the proven defect is
population-multiplied publication and presentation ingress.

**User acceptance completed:** Electron client mode in the original dungeon showed prompt 3D camera
response matching the minimap, timely remote-player motion, working chat submission, regular
FPS/rendered-frame diagnostic updates, and materially reduced idle CPU.

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
- **2026-08-28:** Corrected the headless external-reveal sequence and made destination collision
  residency an explicit camera-seed prerequisite after the live probe proved early camera
  registration could race an empty retained scene. The corrected probe reaches `in-world` normally.
- **2026-08-28:** Paused execution when live verification exposed population-multiplied dynamic
  traffic. A temporary follow-up counter measured 13,651 upserts versus 71 advance batches and 3
  snapshots in 10 seconds, then was removed. The per-commit upsert path overlaps the tick-owned
  advance product but may carry non-placement facts; choosing its replacement is an architectural
  scope expansion requiring explicit review rather than an opportunistic Phase 7 optimization.
- **2026-08-28:** Implemented the reviewed mixed tick product. Routine solver commits now use a
  distinct world event, one fixed-tick publication carries disjoint path advances and path-stable
  updates, and structural changes retain focused upserts. A dedicated path identity was required in
  the browser runtime because the existing placement identity deliberately includes contact and
  kinematics; reusing it would have misclassified valid path-stable updates as placement changes.
- **2026-08-28:** Removed local lifecycle authorization from chat dispatch. ACE establishes its
  world-connected session and player before `LoginComplete`, so portal-space chat is a valid server
  decision; frontend and core state guards were narrower than the protocol and could silently drop
  valid commands.
