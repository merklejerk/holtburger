# Holtburger Simulation Scene Residency Plan

Date: 2026-08-27
Status: complete; automated verification and live bidirectional EnvCell teleport matrix passed

## Context And Boundaries

### Goal

Give client and Explorer one body-neutral collision-coverage model in which complete landblock
products publish atomically, unavailable coverage rejects only the motion that needs it, and static
scene changes never replace dynamic-body identity or pose.

### Problem

The desktop client currently packages four different lifetimes into
`ClientCollisionTarget`/`ClientCollisionSnapshot`:

1. the selected player's stable GUID and instance sequence;
2. the player's physical-definition facts;
3. the player's frame-changing authoritative pose and exact cell residency; and
4. the normalized landblock-owner set loaded into an immutable `CollisionScene`.

`ClientCollisionCoordinator::observe` compares the composite target. An ordinary outdoor cell
change therefore starts another asynchronous collision request even when normalized owner demand is
unchanged. `start_loading` immediately clears the installed snapshot. Core then emits a
clearance-less `collision-snapshot` camera hold, the frontend removes the retired boom path, and the
reconstructed `KinematicBoomController` begins with `rendered_reach == 0`. The visible result is a
camera snap to the player followed by another clearance expansion.

Removing exact residency from target equality would suppress the 24-metre cell manifestation but
would preserve the same lifecycle defect at a 192-metre landblock seam. Changing desired static
collision coverage is not a new body, player, or camera target.

The same composite target captures mutable pose before asynchronous body preparation. Completion
validity intentionally ignores pose and kinematics through `ClientPlayerBodyFacts::definition_eq`,
but the accepted completion relocates the runtime body to the captured pose. A player may therefore
be moved backwards when preparation completes.

There is a second, broader correctness problem. The generic physical solver currently classifies a
missing collision owner after committing motion and deliberately treats that owner as open space.
Client and Explorer also track unavailable collision owners differently. Future locally simulated
remote entities would inherit both defects if the player-only coordinator were merely patched.

### In Scope

- Separate static collision coverage from every dynamic body's identity, pose, kinematics,
  physical definition, and solver participation.
- Keep one landblock's terrain, outdoor statics, generated statics, EnvCell collision, and interior
  containment volumes together as one complete `LandblockCollisionAsset`.
- Introduce a shared, body-neutral owner-availability model used by client and Explorer.
- Distinguish resident, pending, authoritatively absent, and failed owners without treating any of
  them as a null global scene.
- Stage a complete multi-owner successor away from simulation turns and publish it atomically.
- Retain the installed immutable snapshot while a successor is pending or fails.
- Make ordinary physical-body motion non-committing when its actual collision query requires an
  owner absent from the sampled snapshot.
- Keep coverage rejection stateless with respect to the body: do not register, suspend, wake, or
  resume bodies because coverage changed.
- Permit explicitly selected exceptional consumers, including camera queries, to operate against
  available topology while reporting that the result crossed unavailable coverage.
- Revalidate cached static support/contact only when its proving owner product changed; leave
  unrelated bodies untouched.
- Separate local-player physical preparation from static collision-scene preparation.
- Prepare or replace physical definitions only when entity identity/generation or definition facts
  change.
- Install an asynchronously prepared body definition against the live authoritative pose, never a
  request-time pose.
- Make `ClientSimulationSystem` consume one shared scene snapshot suitable for a collection of
  local and remote bodies.
- Keep current remote entities server-authoritative while leaving no player-specific collision
  contract for their later local simulation to replace.
- Keep renderer interest and presentation installation independent from simulation coverage.
- Update retained architecture documentation and vocabulary as part of the same cutover.

### Out Of Scope

- Implementing remote-entity local control, prediction, dynamic contact response, or reconciliation.
- Choosing which remote entities participate in local simulation.
- Changing ACE movement packets, server authority, correction policy, or entity hydration.
- Changing renderer layer-bundle installation or presentation interest.
- Splitting collision landblocks into renderer-style terrain/static/interior layers.
- Changing camera boom interpolation or authored clearance geometry.
- Mutating a live `CollisionScene` incrementally during a simulation tick.
- Persisting a per-body coverage-suspended state.
- Creating a universal Explorer/client runtime that owns bodies, locks, scheduling, frontend
  request types, or mode policy.
- Moving content discovery or DAT loading policy into `holtburger-world`.
- Running the interactive TUI for verification.

## Terminology And Ownership

### Complete collision owner product

One normalized CellLandblock owner resolves to one `LandblockCollisionAsset`. The artifact already
contains terrain collision plus every outdoor, generated, and interior static collider and EnvCell
containment volume owned by the landblock. It is never installed in presentation-style layers.

Multiple owner products may be loaded independently, but a requested coverage revision resolves all
owner outcomes before publishing one immutable successor scene.

### Owner availability

Each requested normalized owner has exactly one shared availability fact:

- **Resident** pairs a complete owner product with its installed owner revision.
- **Pending** names the exact request revision currently resolving it.
- **Absent** means the content source definitively has no CellLandblock for that owner.
- **Failed** retains the load or decode cause and is terminal for the current content-source
  generation.

`Absent` and `Failed` both prevent ordinary physical motion from entering the owner. They remain
distinct because a corrupt or unreadable artifact must fail loudly rather than masquerade as
legitimate empty terrain. An explicit content-source replacement may create a new generation and
retry terminal outcomes.

### Desired, pending, and installed

- **Desired coverage** is the latest policy-selected normalized owner set.
- **Pending coverage** is asynchronous work resolving owner outcomes for an exact desired revision.
- **Installed coverage** is one immutable scene plus the per-owner outcomes published with it.

Pending is never synonymous with unavailable, and one unavailable owner is never synonymous with
an absent global scene. The installed snapshot remains queryable while its successor is prepared.

### Prefetch neighborhood

A frontend may request neighboring collision owners around active bodies so products usually arrive
before motion reaches a seam. The current client selects the player's owner plus its eight
neighbors. This 3x3 prefetch neighborhood is a latency policy only; solver correctness never
depends on its radius. If loading loses the race, the exact motion requiring the missing owner does
not commit.

### Coverage-blocked motion

An ordinary physical transaction derives the owners required by its actual swept collision query.
If any required owner is absent from the sampled snapshot, the transaction returns a named
non-committing outcome. The body retains its canonical pose, velocity, response, and ordinary tick
eligibility. Repeating the same actuation is sufficient to resume naturally after coverage arrives;
there is no stored suspension lifecycle.

An authoritative placement directly into unavailable coverage remains authoritative, but later
locally simulated motion from that placement is subject to the same non-committing coverage guard.

### Exceptional uncovered queries

Coverage behavior is an explicit query policy rather than a boolean body flag:

```text
RequireCollisionCoverage
AllowUncoveredQuery
```

Physical entities use `RequireCollisionCoverage` by default. Camera consumers may explicitly use
`AllowUncoveredQuery`; their result still reports unavailable coverage and must not be represented
as collision-proven. Client and Explorer remain free to present that honest result differently.

### Proposed dependency direction

`holtburger-world` continues to own `SpatialScene`, `CollisionScene`, body transactions, actual
swept-query owner requirements, non-committing coverage outcomes, and static-response semantics.

A new top-level `holtburger_core::simulation_scene` module owns source-neutral owner availability,
desired/pending/installed revision state, stale-completion rejection, and atomic publication over
complete collision assets. Client mode and the 3D host retain their different scheduling, locking,
authority, and request adapters.

The intended shared shape is narrow:

```text
SimulationSceneInterest
  complete normalized owner demand selected by policy

SimulationSceneOwnerAvailability
  Resident | Pending | Absent | Failed

SimulationSceneSnapshot
  scene revision + owner outcomes + Arc<CollisionScene>

SimulationSceneResidency
  desired + pending + installed state and pure publication transitions
```

The asynchronous client task and `HostSimulationRuntime` mutex/request protocol remain outside the
shared state. The shared contract determines what their completions mean.

## Ground Truth

### Current defect path

- `crates/holtburger-core/src/client/collision.rs`
  - `ClientPlayerInstance` includes exact residency despite being named identity.
  - `ClientCollisionTarget` combines player, interest, body facts, and mutable pose.
  - `observe` restarts work when the composite target changes.
  - `start_loading` clears the installed snapshot before replacement exists.
  - completion installs physical state and relocates to `completion.target.facts.position`.
  - one unavailable owner fails the client's complete 3x3 request.
- `crates/holtburger-core/src/client/simulation.rs`
  - local simulation requires snapshot residency to equal the player's exact current cell.
  - remote entities use server-authoritative pose projection rather than the physical collection
    transaction.
- `crates/holtburger-world/src/spatial/scene.rs`
  - `missing_owner_does_not_gate_free_body_motion` proves current generic motion commits into an
    absent owner.
- `crates/holtburger-world/src/spatial/grounded.rs`
  - `grounded_body_crosses_a_missing_owner_as_open_space` proves grounded response has the same
    non-gating behavior.
- `apps/holtburger-3d/host/src/host_simulation_runtime.rs`
  - successful owner products publish even when other desired owners are unavailable;
  - scene changes conservatively wake every settled dynamic body; and
  - availability policy therefore differs from the client coordinator.
- `crates/holtburger-core/src/client/camera.rs`
  - an absent global snapshot demotes the active boom controller and emits a
    `collision-snapshot` hold without clearance.
- `crates/holtburger-core/src/kinematic_boom.rs`
  - a reconstructed controller correctly begins at `rendered_reach == 0` until its first clearance
    proof.

### Existing correct patterns

- `crates/holtburger-content/src/object_collision.rs`
  - `LandblockCollisionAsset` is explicitly one atomically assembled terrain/outdoor/interior
    collision product.
  - `LandblockColliderAssembler::assemble` resolves outdoor and interior participants together.
- `crates/holtburger-core/src/content_assets.rs`
  - `ContentAssetService::load_collision` returns only a complete collision owner product.
- `crates/holtburger-world/src/spatial/collision.rs`
  - `CollisionScene::staged_residency_change` builds a complete successor without mutating the
    installed scene.
- `apps/holtburger-3d/host/src/host_simulation_runtime.rs`
  - loads missing owners away from scene readers and atomically publishes a staged successor;
  - retains dynamic bodies across scene updates.
- `crates/holtburger-core/src/dynamic_entity.rs`
  - `apply_dynamic_entity_physics_transition` separates body placement from physical-definition
    replacement and retains live pose.
- `crates/holtburger-world/src/spatial/scene.rs`
  - `set_dynamic_physical_body` preserves pose and compatible response memory;
  - collection preparation and transactional commits accept an injected immutable scene.
- `crates/holtburger-core/src/client/runtime.rs`
  - samples one collision snapshot before simulation and camera work, providing the correct
    same-epoch consumption point.
- `crates/holtburger-core/src/client/types.rs` and
  `apps/holtburger-3d/src/client/client-presentation-session.ts`
  - portal lifecycle publishes only generation and cause; destination residency and body-instance
    guards remain core-private activation facts;
  - frontend presentation derives its exact scene target from the authoritative local-player
    mirror rather than a collision-preparation projection.

### Evidence from the observed failure

- Live client movement repeatedly logged:
  `The camera withdrew its rendered path while held for collision-snapshot.`
- The camera visibly reset to the player and expanded back to its desired reach.
- The errors occurred during ordinary outdoor movement rather than a portal discontinuity.
- The browser diagnostic is edge-triggered, so repeated messages represent repeated snapshot-loss
  episodes rather than one message printed every frame.

## North Stars

1. Static collision residency updates never change dynamic-body identity, pose, or eligibility.
2. Derive coverage rejection from the current transaction; do not store a body lifecycle that can
   become stuck.
3. Missing authored topology is never silently interpreted as traversable open space.
4. One complete landblock collision product is the atomic availability and installation unit.
5. Every simulation epoch consumes one coherent immutable collision snapshot for all bodies and
   camera queries.
6. Prefetch improves latency but is not a correctness boundary.
7. Player activation and camera policy consume shared spatial facts; they do not shape the shared
   scene contract.
8. Future remote local simulation requires a participation-policy change, not another collision
   residency architecture.
9. Fail loudly on absent, failed, stale, or uncovered facts while keeping their consequences local.
10. Share the smallest proven state machine; do not create a universal Explorer/client runtime.

## Phased Implementation

### Phase 0: Lock The Regressions And New Contract

#### Deliverables

- Focused tests reproducing:
  - exact outdoor cell movement restarting client collision preparation;
  - a landblock seam creating a null client snapshot interval;
  - request-time pose restoration after asynchronous body preparation;
  - free and grounded bodies committing motion into a missing owner;
  - client and Explorer assigning different consequences to the same unavailable owner; and
  - boom reach collapse after manufactured global snapshot loss.
- Test sources that count owner loads independently from body preparation and can return resident,
  absent, delayed, and failed owner outcomes.

#### Acceptance Criteria

- Each regression fails for its diagnosed reason before production refactoring.
- Tests distinguish same-interest movement, changed prefetch demand, stale completion, absent
  content, failed content, and a pending owner.
- A new contract test specifies that unavailable coverage rejects one physical transaction without
  changing body state or tick eligibility.

#### Task Checklist

- [x] Add same-owner exact-cell and adjacent-owner seam fixtures.
- [x] Hold one body completion while advancing the live authoritative pose.
- [x] Replace the existing missing-owner-as-open tests with non-commit behavior tests.
- [x] Add a retry-after-install test proving no explicit body wake or resume is required.
- [x] Preserve a focused camera test for honest uncovered-query reporting.

### Phase 1: Make Missing Coverage A Transaction Boundary

#### Deliverables

- A source-neutral non-committing physical outcome naming the first required unavailable owner.
- Swept-query owner derivation at the layer that owns collision-query construction.
- Default `RequireCollisionCoverage` behavior for dynamic physical bodies.
- Explicit `AllowUncoveredQuery` behavior for exceptional non-body consumers.
- No persistent coverage-suspended bit, body registry, or wake queue.

#### Acceptance Criteria

- A free, grounded, or dynamically interacting body cannot commit pose, velocity, response, or
  collision-report changes when its actual query requires an unavailable owner.
- Repeating the same actuation succeeds immediately after a successor containing that owner is
  sampled.
- An authoritative placement inside unavailable coverage is retained but cannot locally integrate
  farther under the default policy.
- Coverage checks derive from actual query geometry rather than a fixed neighborhood radius.
- Exceptional queries report uncovered status instead of fabricating resident proof.

#### Task Checklist

- [x] Identify every static query issued by free, grounded, step, separation, and dynamic-contact
      paths before selecting the non-commit boundary.
- [x] Compute each query's required normalized owners once and pass the result through the
      transaction contract.
- [x] Ensure a rejected transaction emits no partial collision reports or semantic state changes.
- [x] Replace tests that preserve missing-owner traversal with positive non-commit/resume tests.
- [x] Keep outside-authored-landscape behavior distinct from a missing authored owner.

### Phase 2: Introduce Shared Owner Availability And Atomic Publication

#### Deliverables

- A top-level `holtburger_core::simulation_scene` module defining:
  - `SimulationSceneInterest`;
  - `SimulationSceneOwnerAvailability`;
  - `SimulationSceneSnapshot`; and
  - the smallest `SimulationSceneResidency` state needed for desired, pending, and installed
    revisions.
- A complete batch completion carrying one outcome for every requested owner.
- Revision-scoped stale-completion rejection and atomic staged-scene publication.
- Shared terminal semantics for `Absent` and `Failed`, including retained failure causes.
- `ClientPlayerIdentity` containing only GUID and instance sequence.
- Removal of player identity and exact EnvCell residency from collision snapshots.

#### Acceptance Criteria

- Client and Explorer interpret identical owner outcomes through the same shared transition code.
- No simulation-scene type contains a player GUID, entity generation, pose, or exact EnvCell.
- Every requested owner has exactly one outcome; partial success is explicit rather than silent.
- A pending or failed successor never clears or corrupts the installed snapshot.
- A stale completion cannot replace a newer desired revision.
- One owner product is published only as its complete terrain/static/interior artifact.

#### Task Checklist

- [x] Move normalized owner-set construction and deterministic ordering onto
      `SimulationSceneInterest`.
- [x] Name content-source generation separately from request and installed scene revisions.
- [x] Stage `CollisionScene::staged_residency_change` from complete owner outcomes.
- [x] Make publication one synchronous state replacement.
- [x] Migrate `ClientCollisionCoordinator` and `HostSimulationRuntime` to the shared transitions.
- [x] Keep their tasks, locks, sessions, and request DTOs composition-local.
- [x] Delete duplicate availability and snapshot vocabulary after cutover.

### Phase 3: Separate Body Preparation From Scene Preparation

#### Deliverables

- Independent local-player body-definition preparation keyed by stable identity and immutable
  definition facts.
- Collision requests that load only complete static owner products.
- Position-free physical-definition preparation, or the narrowest existing definition input that
  proves mutable pose cannot affect prepared geometry.
- Commit logic that installs a prepared definition against the current live body pose.
- Removal of `completion.target.facts.position` relocation.

#### Acceptance Criteria

- Moving through cells or owners never calls body preparation when definition facts are unchanged.
- Movement during asynchronous preparation cannot move a body backwards on completion.
- Setup, appearance, scale, or physics changes still prepare and atomically apply a replacement.
- Initial entry and teleport derive indoor/outdoor membership from the live destination.
- Static owner completion never installs or relocates a dynamic body.

#### Task Checklist

- [x] Remove mutable pose and kinematics from the body-definition preparation contract where
      existing dynamic-entity APIs permit a clean cutover.
- [x] Reuse `set_dynamic_physical_body` preservation semantics.
- [x] Join prepared definition with live state only on the simulation thread.
- [x] Preserve stale-generation rejection for body replacement and disconnect.

### Phase 4: Make Scene Changes Lazy And Body-Neutral

This is the principal implementation resteering point. The intended design performs no collection
walk when a scene publishes, but cached static response may still carry proof from a replaced owner
product. The implementation must preserve that proof only when its exact owner product remains
valid.

#### Deliverables

- Owner-scoped provenance for cached static support/contact facts, or a smaller proven mechanism
  with the same selective behavior.
- Lazy revalidation when a body next consumes response proven by a changed owner.
- Removal of Explorer's unconditional `wake_all_settled_dynamic_bodies()` scene-swap behavior.
- No mutation of bodies whose collision dependencies are unchanged.

#### Acceptance Criteria

- Publishing an unrelated owner does not alter or wake an existing body.
- Removing a required owner causes the body's next attempted transaction to reject without commit.
- Replacing or reintroducing a required owner revalidates affected static support before use.
- A body blocked by missing coverage resumes through its next ordinary tick, with no explicit wake
  or resume command.
- Cross-owner static shadows are attributed to the owner product that supplied them.

#### Task Checklist

- [x] Audit grounded support, contact separation, settled-body eligibility, and static shadow
      ownership before choosing provenance shape.
- [x] Prefer lazy proof validation over an owner-to-body dependency index.
- [x] Add changed-owner, unchanged-owner, eviction, reintroduction, and cross-boundary fixtures.
- [x] Record the final proof shape and rejected alternatives in the decision log.

### Phase 5: Make Client Simulation Collection-Neutral

#### Deliverables

- `ClientSimulationSystem` accepts one body-neutral `SimulationSceneSnapshot` for the complete tick.
- Local-player solving validates stable body readiness and per-transaction coverage rather than
  exact snapshot residency equality.
- Existing remote server-authoritative projection remains a participation mode over the same body
  registry.
- A clear insertion point for future remote physical participation through the existing
  `SpatialScene::prepare_dynamic_entity_collection` transaction.

#### Acceptance Criteria

- The scene snapshot API contains no local-player identity.
- Adding a second physical body to a focused test requires no new collision coordinator or snapshot
  type.
- Local and remote bodies retain identity, pose, and kinematics across scene publication.
- Two bodies may independently succeed or reject in the same snapshot based on the owners their
  actual transactions require.
- This phase does not implement speculative remote input or prediction policy.

#### Task Checklist

- [x] Sample one installed snapshot before simulation work begins.
- [x] Keep the same snapshot available to camera queries later in that authority tick.
- [x] Preserve current remote projection output until physical participation is explicitly enabled.
- [x] Add a two-body mixed-coverage regression.

### Phase 6: Converge Activation And Camera Consumers

#### Deliverables

- Client world activation treats presentation readiness, local-player body readiness, and
  collision availability as distinct facts.
- Core-private destination and body-instance guards protect authority activation without becoming
  renderer-facing placement or collision-readiness state.
- Unavailable destination collision does not strand presentation in portal space; local physical
  motion rejects and a loud diagnostic names the unavailable owner.
- Client and Explorer camera queries use the explicit exceptional uncovered-query policy.
- Camera results preserve whether their path was collision-proven or crossed unavailable coverage.
- App-local frontend policy makes the final presentation decision from the shared facts.

#### Acceptance Criteria

- An ordinary scene publication does not stop or reconstruct an active camera controller.
- Portal discontinuity still retires proof tied to the previous world destination.
- A complete visual destination can present when collision is terminally unavailable, while the
  local body cannot commit unproven motion.
- Client and Explorer never label an uncovered camera query collision-safe.
- Portal lifecycle remains a phase contract: no residency, body-instance, or collision-preparation
  field is added to its Rust or host wire representation.
- No universal authority trait or mode flag is introduced.

#### Task Checklist

- [x] Replace global `collision-snapshot` absence with owner-specific coverage facts.
- [x] Preserve body identity and core-private destination activation guards separately from
      collision interest.
- [x] Decide the smallest renderer-facing uncovered-camera status from actual current consumers.
- [x] Keep frontend reveal and error UX app-local.

### Phase 7: Cleanup And Architecture Sweep

#### Deliverables

- Removal or honest renaming of every surviving player-scoped collision-scene symbol and comment.
- Replacement of `halo` terminology with `prefetch neighborhood` where it means loading policy.
- Updated client-mode plan sections that describe collision and body preparation as one product.
- Focused audit of async dynamic-body preparation call sites for captured mutable pose.
- No compatibility aliases, dead target representations, global body wakes, or missing-owner-as-open
  tests.

#### Acceptance Criteria

- `rg` finds no obsolete `ClientCollisionTarget`, `ClientPlayerInstance`, snapshot-residency
  equality path, or misleading suspension vocabulary.
- Every retained field has a named runtime consumer.
- Shared availability code has one client adapter and one Explorer adapter without mode branches.
- Clippy, dead-code analysis, and formatting are clean without suppressions.

#### Task Checklist

- [x] Sweep Rust exports, tests, comments, metrics, retained docs, and UI diagnostics.
- [x] Inspect Explorer spawn/replacement preparation and shared dynamic-body transitions.
- [x] Update `docs/plans/holtburger-3d-client-mode-plan.md` with the landed ownership model.
- [x] Record any intentionally deferred extraction or coverage limitation.

### Phase 8: Verification

#### Deliverables

- Focused and full automated results.
- Non-interactive runtime evidence where available.
- A user-run live ACE verification matrix for movement cases the browser harness cannot reproduce.

#### Acceptance Criteria

- All `holtburger-core` and `holtburger-world` tests pass.
- `cargo clippy --all-targets -- -D warnings` passes for touched crates and the 3D host.
- The full 3D TypeScript suite, checks, lint, and formatting pass.
- Browser/host regressions prove multi-body atomic scene handoff and mixed coverage outcomes.
- Live client movement crosses several outdoor cells and at least two landblock seams without a null
  snapshot, camera reach collapse, player pose rollback, or repeated invariant errors.
- Delayed coverage temporarily rejects only dependent motion and then resumes without a wake.
- Absent and failed coverage reject dependent motion permanently for the current content generation
  while producing distinct loud diagnostics.
- Initial entry, teleport, outdoor/EnvCell transition, disconnect, and shutdown converge cleanly.

#### Task Checklist

- [x] Run package-manager and Cargo manifest scripts rather than direct tool binaries where scripts
      exist.
- [x] Add harness fault injection only when it exercises production ownership. Existing injected
      owner sources cover delayed, absent, failed, stale, and reintroduced products; no duplicate
      browser-only fault path was added.
- [x] Do not run the interactive TUI.
- [x] Capture exact live prerequisites or failures instead of declaring verification unavailable.

## Risks And Mitigations

### Coverage rejection occurs after partial transaction work

**Risk:** A late missing-owner discovery could leave pose, response, collision reports, or semantic
state partially changed.

**Mitigation:** Derive required owners during tentative query construction and make coverage a
transaction precondition or typed non-commit outcome. Tests assert the complete body and report
state is byte-for-byte equivalent before and after rejection where practical.

### Repeated blocked motion causes request or diagnostic spam

**Risk:** A body remains tick-eligible and repeatedly attempts the same unavailable motion.

**Mitigation:** Keep the body stateless. Deduplicate loads and terminal diagnostics in the shared
owner-availability state, and edge-trigger frontend reporting. The per-tick coverage membership
check remains cheap and permits automatic recovery.

### Scene swaps retain stale static response

**Risk:** Cached support/contact may refer to an evicted or replaced owner product even though the
body itself remains unchanged.

**Mitigation:** Attribute static proof to the supplying owner revision and validate it lazily when
next consumed. Do not mutate or wake bodies whose proof remains valid.

### Terminal failure is confused with legitimate absence

**Risk:** Corrupt or unreadable content could silently appear to be authored empty terrain.

**Mitigation:** Preserve `Absent` and `Failed(cause)` as different shared owner outcomes. Both block
ordinary motion, but failures remain loud and retry only after an explicit content-source generation
change.

### Exceptional cameras imply false collision safety

**Risk:** Allowing camera queries through unavailable coverage could be mistaken for a cleared boom
path and clip through geometry that has not loaded.

**Mitigation:** The exceptional policy returns an explicit uncovered result. Consumers may continue
kinematic presentation, but cannot label or cache the result as collision-proven.

### Authoritative placement arrives inside unavailable coverage

**Risk:** Refusing server authority would desynchronize world state, while accepting it may place a
body amid unknown static geometry.

**Mitigation:** Accept the authoritative pose and presentation state, reject later local physical
transactions requiring missing coverage, and report the owner. Coverage arrival naturally permits
the next transaction and revalidates static response.

### Remote simulation requirements leak speculative policy

**Risk:** Designing for future remote bodies could prematurely encode ownership, selection,
prediction, or contact policy.

**Mitigation:** Generalize only collision coverage and body lifetimes. Prove extensibility with two
physical bodies in tests; leave participation policy out of this milestone.

### Shared extraction weakens crate boundaries

**Risk:** Moving `HostSimulationRuntime` wholesale into a shared crate would import app locks,
protocol DTOs, and Explorer authority.

**Mitigation:** Share source-neutral availability and publication transitions in `holtburger-core`;
retain application scheduling and adapters at their composition roots. Keep query algorithms in
`holtburger-world` and DAT access in content-backed sources.

### Scope expands into renderer scene interest

**Risk:** Similar owner vocabulary encourages coupling collision demand to presentation layer
installation.

**Mitigation:** Collision owners remain complete terrain/static/interior artifacts with independent
prefetch and failure semantics. This plan does not change renderer layer bundles or presentation
interest.

## Expected Footprint

- Primary production changes: approximately 6-9 Rust files across `holtburger-world`,
  `holtburger-core`, and the 3D host adapter.
- Expected production churn: approximately 300-500 lines, substantially offset by deleting the
  player-scoped composite target, duplicate availability state, global wake behavior, and
  suspension-like readiness branches.
- Expected tests: approximately 350-550 lines, dominated by transaction rollback, asynchronous
  owner outcomes, lazy static-proof validation, and multi-body coverage cases.
- TypeScript production changes: none unless the current camera/activation contract cannot carry an
  honest uncovered result.
- Wire protocol changes: none.
- Renderer scene changes: none.
- Content artifact changes: none; `LandblockCollisionAsset` already has the required atomic shape.

If production code grows materially beyond this range, stop and reassess whether remote simulation
policy, renderer interest, or a universal runtime has leaked into the cutover.

## Definition Of Done

- [x] Simulation-scene snapshots contain no dynamic-body or player identity.
- [x] Client and Explorer use one shared owner-availability state and transition model.
- [x] Each resident landblock is one complete terrain/outdoor/generated/interior collision product.
- [x] Dynamic-body preparation contains no static owner demand or request-time pose dependency.
- [x] Same-owner cell movement performs no collision load or body preparation.
- [x] Ordinary landblock seams have no null installed-snapshot interval.
- [x] Missing required coverage rejects exactly one physical transaction without changing the body.
- [x] Coverage arrival permits the next ordinary tick without an explicit wake or resume operation.
- [x] Scene publication preserves every registered body identity, pose, and tick eligibility.
- [x] Bodies unrelated to changed owner products retain their cached response and settled state.
- [x] Async body completion cannot restore a captured pose.
- [x] A second locally physical body uses the same scene snapshot and independently observes
      coverage.
- [x] Exceptional camera queries remain explicitly uncovered rather than falsely collision-proven.
- [x] Prefetch-neighborhood radius affects latency only, never correctness.
- [x] Terminal absent and failed owners remain distinct, loud, and stable for one content generation.
- [x] Portal activation and frontend reveal do not conflate visual installation with collision
      availability.
- [x] Stale completion, teleport, disconnect, and authority-replacement tests pass.
- [x] Touched code is formatted, lint-clean, and warning-free.
- [x] Full Rust and 3D application checks pass.
- [ ] Live client seam traversal produces no camera reset, pose rollback, or repeated invariant
      errors.
- [x] Retained plan and architecture vocabulary match the landed code.

## Resolved Questions

1. A typed `CollisionQueryError::UnavailableOwner` aborts the existing tentative transaction before
   commit and works for individual and collection ticks without adding committed status variants.
2. Cached support carries opaque scene-lineage, owner, and owner-product revision provenance. No
   owner-to-body index is needed.
3. Camera diagnostics required one tagged TypeScript/Rust proof status. Playback continues for
   `uncovered { owner }` and exposes the proof through the existing camera status.
4. `SimulationSceneResidency::replace_content_source` is the explicit application transition that
   advances source generation and clears terminal outcome retention. No automatic retry exists.

## Decision Log

- 2026-08-27: Rejected an exact-cell equality fix because the same lifecycle defect remains at
  landblock seams.
- 2026-08-27: Chose a body-collection-neutral scene contract because remote local simulation is an
  explicit near-term consumer.
- 2026-08-27: Rejected a universal Explorer/client runtime. Only source-neutral availability and
  publication transitions are shared; authority and scheduling remain composition-owned.
- 2026-08-27: Chose a top-level `holtburger_core::simulation_scene` module because client and
  Explorer must use the same owner-availability semantics immediately.
- 2026-08-27: Confirmed `LandblockCollisionAsset` is already the required atomic unit containing
  terrain, outdoor/generated statics, interior collision, and EnvCell containment.
- 2026-08-27: Kept per-owner loading as an internal content operation while requiring one explicit
  outcome per requested owner and one atomic successor publication.
- 2026-08-27: Rejected persistent per-body coverage suspension. Missing coverage rejects the current
  transaction without mutating the body, so a later ordinary tick resumes automatically.
- 2026-08-27: Rejected missing-owner-as-open behavior for ordinary physical entities.
- 2026-08-27: Chose explicit exceptional uncovered-query policy for camera consumers; uncovered
  results may continue presentation but never claim collision proof.
- 2026-08-27: Chose owner-scoped lazy static-response validation over global body waking or eager
  mutation of unaffected bodies.
- 2026-08-27: Kept prefetch neighborhoods as latency policy only; correctness is enforced against
  each actual collision query.
- 2026-08-27: Chose terminal `Absent` and `Failed(cause)` owner outcomes for one content-source
  generation. Both block ordinary motion, but only failure represents an operational defect.
- 2026-08-27: Kept remote local simulation participation policy out of scope. A two-body invariant
  test proves the extension seam without inventing control behavior.
- 2026-08-27: Kept destination residency and body-instance guards private to core activation.
  Portal lifecycle carries generation and cause only; frontend scene targeting comes from the
  authoritative local-player mirror, not a collision-preparation projection.
- 2026-08-27: Implemented missing physical coverage as
  `CollisionQueryError::UnavailableOwner` at the collision-query boundary. Free, grounded,
  separation, support, restriction, and dynamic-contact transit work is already tentative there,
  so the existing `SpatialScene` transaction aborts before body state or reports commit.
- 2026-08-27: Required owners are selected from the collision domains the query actually uses:
  swept outdoor owners while outdoor collision participates, plus normalized owners of reached
  EnvCells. Rejected unconditional XY-owner gating because an authoritative interior placement may
  retain coordinates outside its outdoor landblock frame while its committed EnvCell remains the
  only relevant domain.
- 2026-08-27: Added `transit_cell_allow_uncovered` as the first explicit exceptional query. It
  returns installed-topology placement together with the first unavailable owner; ordinary
  physical transit continues to fail with the typed coverage error.
- 2026-08-27: Added `CollisionQueryPolicy::{RequireCollisionCoverage, AllowUncoveredQuery}` and
  threaded it through the free-sphere query family. Ordinary physical-body construction selects
  required coverage; the kinematic boom is the first explicit exceptional consumer. Its underlying
  free-sphere outcome retains the first unavailable owner instead of representing installed-only
  motion as collision-proven.
- 2026-08-27: Represented aggregate camera coverage as
  `KinematicBoomCollisionProof::{Covered, Uncovered { owner }}` in per-tick diagnostics. The
  composite enum keeps proof status and its deterministic first unavailable owner inseparable;
  app-local presentation policy can consume it later without re-deriving collision authority.
- 2026-08-27: Implemented static-response provenance as opaque
  `CollisionOwnerProof { lineage, owner, revision }`. The lineage prevents equal per-owner revision
  numbers from independently constructed scenes from validating each other; staged successors keep
  the lineage and unchanged products keep their revisions. Rejected a global body wake and an
  owner-to-body dependency index because both add publication-time body work and duplicate facts
  already carried by cached support.
- 2026-08-27: Split local-player preparation into scene interest and position-free physical facts.
  Body completion validates identity plus immutable definition facts, then applies the prepared
  definition to the current runtime body with its live pose and exact cell.
- 2026-08-27: Made client activation independent from collision terminal availability. Exact
  destination and body-instance guards remain core-private; visual convergence may reveal a
  destination whose local physical transactions still reject unavailable owners.
- 2026-08-27: Added required tagged `covered`/`uncovered { owner }` camera diagnostics to both Rust
  host contracts and TypeScript decoders. Client playback retains uncovered paths and exposes the
  proof through its existing camera status rather than creating a second frontend lifecycle.

## Course Corrections

- 2026-08-27: Replaced the original whole-snapshot safety-envelope phase with transaction-local
  coverage proof. This removes correctness dependence on a guessed prefetch radius.
- 2026-08-27: Removed planned per-body suspension/resumption state. Non-commit plus ordinary retry
  provides the same visible freeze without a lifecycle that can become stuck.
- 2026-08-27: Narrowed scene-swap body work from conservative global waking to lazy validation of
  only cached proof supplied by changed owner products.
- 2026-08-27: Expanded shared core scope from immutable snapshot vocabulary to owner-availability
  transitions because client and Explorer currently assign different meaning to the same content
  outcome.
- 2026-08-27: Existing unit fixtures frequently used `CollisionScene::new()` to mean authored but
  empty terrain. Converted physical fixtures to resident empty owner products instead of weakening
  production coverage checks. Truly empty scenes now remain meaningful missing-coverage fixtures.
- 2026-08-27: The implementation exceeded the estimated 300-500 production-line churn. At the
  Phase 7 checkpoint the complete diff was 2,227 insertions and 1,156 deletions, including tests,
  documentation, and typed-policy propagation through existing query families. Reassessment found
  no remote-simulation policy, renderer-interest coupling, or universal runtime leakage. The main
  source-neutral residency module is 612 production/comment lines plus 169 test lines; retaining
  explicit complete-batch validation and shared terminal/source-generation semantics was judged
  preferable to recreating divergent adapter state. This is an estimate miss, not a deferred
  extraction: there is no second abstraction with a named consumer to extract.
- 2026-08-27: Live ACE validation found that a locally projected runtime pose could change EnvCell
  while a physical body's response cell and dynamic membership retained the previous EnvCell. The
  renderer correctly rejected the contradictory pose/membership contract. Reusing full relocation
  was rejected because it would promote a projected pose to server authority and zero valid
  kinematics. Runtime pose application now rebases only cell-dependent physical response and
  minimum membership, preserving same-cell wider membership, kinematics, and authoritative pose.

## Execution Progress

- 2026-08-27: Phase 0/1 world boundary in progress. Replaced the free, grounded, and registered
  body missing-owner-as-open regressions with typed non-commit assertions. The registered-body test
  proves the complete stored body is unchanged and the same ordinary tick succeeds immediately
  after a resident successor is supplied, without a wake or resume operation.
- 2026-08-27: Audited the static queries reached by free and grounded movement, placement
  separation, support/step-down, restrictions, and dynamic-contact placement. Exact owner demand is
  derived beside each query's swept geometry and placement domains; outside-landscape queries still
  have an empty owner set.
- 2026-08-27: Phase 1 complete. `cargo test -p holtburger-world --lib` previously passed 433 tests
  and `cargo test -p holtburger-core --lib` passed 268 tests; focused static-sphere and kinematic
  boom uncovered-policy regressions pass after the final proof cutover. Formatting and clippy were
  clean before that final focused slice and will be rerun at the next verification checkpoint.
  Every camera static/free-sphere query now selects `AllowUncoveredQuery`, and the aggregate boom
  result reports the first unavailable owner instead of claiming collision proof.
- 2026-08-27: Phases 2/3 complete. Client and Explorer use `SimulationSceneResidency`; staged work
  publishes outside simulation locks and stale completions cannot replace newer demand. Local body
  preparation is independent, position-free, and commits against live pose. Same-owner movement,
  seam retention, delayed preparation, mixed absent/failed outcomes, and source-generation retry
  fixtures pass.
- 2026-08-27: Phases 4/5 complete. Cached ground support carries exact owner-product provenance;
  unrelated publication leaves settled bodies untouched, changed/evicted products trigger lazy
  validation, and reintroduction succeeds through an ordinary tick without a wake API. One scene
  snapshot independently solves a resident body and rejects an uncovered body unchanged.
- 2026-08-27: Phases 6/7 complete. Activation, body readiness, presentation convergence, and scene
  availability are distinct. Camera diagnostics preserve uncovered proof in Rust and TypeScript;
  obsolete player-scene composites, null-snapshot camera holds, global wakes, and halo vocabulary
  were removed from live code. Retained architecture documentation describes the landed ownership
  model.
- 2026-08-27: Phase 8 automated verification complete. Exact results: world 437/437, core 276/276,
  host 245/245, and TypeScript 1,562/1,562 tests passed. All-target clippy with warnings denied
  passed for world, core, and host. Full app check, ESLint/Knip/Rust lint, Prettier check, production
  Vite build, `git diff --check`, and the browser harness passed. The browser harness rendered 234
  frames on SwiftShader with no application error or console invariant; Chrome emitted only its
  external GCM deprecation and shutdown noise. The build retained the existing large-chunk warning.
- 2026-08-27: Post-verification audit found that the production collection pre-pass still propagated
  one body's `UnavailableOwner`, even though the earlier mixed-coverage fixture exercised bodies
  through separate individual transactions. Corrected the collection contract to return accepted
  movers and body-local coverage rejections from one sampled scene. Placement refresh and tentative
  environment solves now reject only the dependent body; every other error remains collection-fatal.
  Explorer retains possession for a rejected possessed body, and the host boom advances from its
  unchanged pose while explicitly merging the unavailable owner into camera diagnostics. Focused
  world, support-eviction, and possessed-camera regressions pass. Full re-verification passed world
  437/437, core 276/276, host 245/245, and TypeScript 1,562/1,562 tests; all-target Clippy with
  warnings denied, application checks and lint, Rust and Prettier format checks, production build,
  `git diff --check`, and the browser harness also passed. The harness again rendered 234 frames on
  SwiftShader with no application error or console invariant; external Chrome GCM, Fontconfig, and
  shutdown diagnostics were unchanged environment noise. The existing Vite large-chunk warning
  remains unrelated performance debt.
- 2026-08-27: Live outdoor-to-outdoor teleport passed, while outdoor/EnvCell and same-dungeon
  teleports exposed `Scene spatial membership omits resident scope` followed by missing local-player
  presentation. Added world and client regressions for EnvCell-to-EnvCell, EnvCell-to-outdoor, and
  outdoor-to-EnvCell runtime-pose changes. Re-verification passed world 438/438, core 277/277, host
  245/245, all-target Clippy with warnings denied, application type checks, Rust formatting,
  `git diff --check`, and the browser harness. Live transition retest remains required. WCID 4113
  startup falling is tracked separately and was deliberately excluded from this correction.
- 2026-08-27: Final live retest passed dungeon-to-outdoor, outdoor-to-dungeon, and same-dungeon
  admin teleports without presentation freeze, missing runtime presentation, or spatial-membership
  rejection. A post-test quality audit also made the pre-destination teleport gap an explicit core
  activation phase, ensuring the first destination position clears pose-dependent response memory
  without creating a second presentation generation.
- 2026-08-27: Final commit gate passed the complete Rust workspace test suite and workspace-wide
  all-target Clippy with warnings denied. Application type/Svelte checks, ESLint, Knip, Prettier,
  1,564 TypeScript tests, production build, and the browser harness also passed with no application
  console errors. The quality gate updated the collision probe to select strict coverage explicitly;
  the existing Vite large-chunk warning and external Chrome diagnostics remain unrelated debt.

## User-Run Live ACE Matrix

External prerequisites are a reachable ACE endpoint, mounted client content, an account with a
world-ready character, and credentials supplied only through `HOLTBURGER_PROBE_ACCOUNT` and
`HOLTBURGER_PROBE_PASSWORD`. The non-interactive baseline is:

```bash
cd apps/holtburger-3d
HOLTBURGER_PROBE_ACCOUNT=test \
HOLTBURGER_PROBE_PASSWORD='your-password' \
HOLTBURGER_PROBE_DURATION_MS=30000 \
npm run probe:client
```

`HOLTBURGER_PROBE_HOST`, `HOLTBURGER_PROBE_PORT`, and
`HOLTBURGER_PROBE_CHARACTER_GUID` select a non-default server or character. The probe builds the
release host, never starts the TUI, disconnects explicitly, and emits one JSON census. Exact seam,
EnvCell, and teleport cases may require the user-operated desktop client because they depend on
character placement and server content.

| Case | Action | Required evidence |
| --- | --- | --- |
| Ordinary cells | Move continuously across at least four 24-metre outdoor cells inside one owner. | Camera reach remains continuous; no player pose rollback, global scene absence, or repeated invariant diagnostic. |
| Landblock seams | Cross two distinct 192-metre owner seams in both directions. | Installed camera path never collapses to the player; body preparation does not restart; motion commits or reports only an owner-specific coverage rejection. |
| Coverage race | Approach a seam faster than prefetch completes, when reproducible with the live source. | Only the dependent motion pauses; canonical pose/velocity do not partially commit; the next ordinary input resumes after coverage arrives without a wake command. |
| Terminal coverage | Exercise a genuinely absent owner and a deliberately corrupt/unreadable product in a disposable content source, if available. | Both block dependent motion; absence and failure remain distinct diagnostics, and failure retries only after explicit source replacement. |
| Outdoor/EnvCell | Enter and leave an authored interior, including a deep EnvCell when available. | Exact cell identity and camera path remain coherent; no outdoor fallback is invented while indoor topology is pending. |
| Teleport | Trigger an ordinary server teleport between different owners. | Old camera/destination proof retires once; prepared body installs at the live destination pose; presentation reveals independently from terminal collision availability. |
| Lifecycle | Disconnect from world, reconnect, then shut down normally. | Pending scene/body completions cannot publish into the retired generation; disconnect and host shutdown converge without an orphaned process. |

The synthetic delayed/absent/failed, seam, live-pose, mixed-body, and reintroduction cases are
covered by automated production-path fixtures. The user-operated live ACE run completed the
bidirectional outdoor/EnvCell and same-dungeon teleport cases; terminal missing/corrupt content
remains an optional disposable-source diagnostic rather than a blocker for this plan.
