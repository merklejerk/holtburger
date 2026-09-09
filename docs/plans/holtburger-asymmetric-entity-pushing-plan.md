# Compliant entity contacts and bounded character physics

Status: **Complete, including the live-confirmed stationary membership refresh regression fix.** The prior completion statement did not establish end-to-end interface quality. Q3 remains explicitly deferred to richer animation work. Final player separation weight: **0.01** (peer weight 1.0). The user authorized committing the completed cumulative implementation after the final live retest.

## Live publication regression: stationary membership refresh

The user reported `changed entity placement has no simulation outcome`. A single passive debug
login using this worktree's `.dev.env` reproduced it; no movement or teleport commands were sent.
Diagnostic evidence is in `/tmp/placement-outcome-live.json` under `terminalEvents` (the probe's
aggregate `ok: true` is not evidence of gameplay health; it captured a runtime-failure event).

- Entity `0x77D64015` retained exactly the same position and quaternion in `0x7D64001D`.
- Membership changed from outdoors-only to outdoors plus `0x7D640100`.
- `refresh_dynamic_body_placement` can recompute membership before integration eligibility is
  considered. A stationary/non-integrating body need not emit a movement outcome.
- S1's new publication guard incorrectly required a movement outcome for this metadata-only change.
  This is a regression from the seam cutover; its prior closed-world outcome assumption was false.

The error now includes GUID and before/after pose and membership; no recovery behavior has changed.
The initial suggestion to send an ordinary state update is insufficient: frontend
`game-presentation-runtime.ts` rejects `batch.updates` that change `dynamicPathIdentity`, which includes
membership. The fix must carry a stationary placement refresh through both publication and placement
consumption while preserving the requirement for accepted geometry on actual physical movement.
Do not restore the generic endpoint fallback for missing movement results.

- [x] Handle stationary membership refresh through the existing placement contract and verify both
  producer and immediate frontend consumer. Add a regression using a non-integrating body whose
  collision membership expands; retain the bent physical-path composition test.

### Membership refresh fix and verification

Publication now distinguishes pose stability from complete placement stability. With no accepted
physical travel, an unchanged position/quaternion may publish changed room membership through
`batch.updates`; an actual pose change still requires its explicit simulation outcome. No generic
straight-line fallback was restored. The existing bent-path regression remains passing.

Frontend tick validation likewise requires pose stability for updates while complete placement
identity still includes membership for dirty detection. The dynamic-root placement owner applies
membership changes without touching animation. If an earlier accepted path is still playing, only
its terminal placement is refreshed: earlier route proofs and timing remain intact, and the new
membership takes effect at arrival. An idle root updates membership immediately. This modest timing
concession avoids snapping a visually interpolating body to its already-canonical endpoint.
No new wire variant, physics policy, or retained reconciliation mechanism was introduced.

Evidence:

- New core regression runs collision membership refresh on a non-integrating body spanning an
  indoor/outdoor portal. Its pose remains unchanged, it emits no movement outcome, and client
  publication carries the updated membership. Core/host library suites pass **358/276 tests**
  (`/tmp/membership-rust-tests.log`).
- Frontend runtime regression accepts membership-only updates and still rejects pose-changing
  updates without an advance. Placement tests preserve active interpolation and apply refreshed
  endpoint membership, then update idle membership without moving the root. Four affected suites
  pass **89 tests** (`/tmp/membership-frontend-tests.log`).
- Headless Chrome executes production placement code and confirms active-path preservation,
  updated arrival membership, and unchanged idle transform (`/tmp/membership-browser-result.log`).
- Full app type checks, ESLint, affected warning-denied all-target Clippy, formatting/diff checks,
  and debug host build pass (`/tmp/membership-ts-check.log`, `/tmp/membership-eslint.log`,
  `/tmp/membership-clippy.log`, `/tmp/membership-debug-build.log`).
- One passive debug relogin after the earlier reproduction observes the character for 15 seconds.
  The same entity `0x77D64015` (The Eagle's Blade) publishes five samples with zero displacement.
  No runtime-failure event occurs; the only terminal event is the probe's explicit disconnect
  (`/tmp/membership-fixed-live.json`). No release build, drive, or teleport was used.

This closes the regression against both the live case and composed consumer tests. Historical seam
closeout claims below predate this correction and should be read with this explicit counterexample.
Changes remain uncommitted.

## API and immediate-consumer review — 2026-09-09

This follow-up reviews contracts and their actual callers after Q1/Q2 cleanup. It records findings
before implementation; no production behavior changed. The new general-purpose review skill now
requires this explicit seam pass rather than relying on scattered ownership/code-smell prompts.

### Contract inventory and review coverage

| Boundary | Producer and immediate consumers inspected | Disposition |
| --- | --- | --- |
| Physical input / prepared actuation | `spatial/types.rs::PhysicalBodyInput`, `body_movement.rs::step`, client simulation input callback and Explorer input callback, scene collection | Reference/capture construction is controlled; actual and nominal motion remain distinct. Explorer uses authored reference input with capture disabled as well as autonomous input: its restriction is not literally "never supplies a reference." No new independent finding. |
| Prepared target / contact kernel | `PreparedBodyContact`, `PreparedContactSource`, initial/moved hard targets, projectile endpoints and checked recovery | Q1 carries installed physics and target geometry through the reviewed consumers. No new geometry cache or lost-pose sharing. |
| Collection / world and host projection | `DynamicEntityCollectionTick`, `DynamicEntityBodyTick`, `client/simulation.rs`, `state/mutations.rs`, `host_simulation_runtime.rs` | S1 and S2. Q2 improved private ownership but retained a public result that consumers can partially ignore. |
| Client path / renderer and camera | `client/dynamic_entity_view.rs`, `client/runtime.rs`, `ClientCameraSceneInput::capture`, camera target sampling, frontend path decoder/evaluator | S1: a complete-path contract is populated from endpoints only. This adapter predates the diff; the current feature still fails to bridge it to the richer solver result. |
| Explorer path / presentation | `HostSimulationRuntime::tick_dynamic_entity_collection`, `ExplorerMotionState::observe_body`, host placed-path evaluation | Uses `CollectionBodyMotion::into_root_path` with captured previous/current bodies. The client/Explorer difference is material, not merely naming. |
| Observed/command locomotion / playback | World presentation adapter, registry `present_locomotion`, core and Explorer call sites, frontend playing/settled classifier | S3. The separate visual cursor and action priority remain justified; Q3's single-clip concession remains deferred. |
| Authority effect / scene and remote source | `AuthoritativePoseEffect`, `state/mutations.rs::apply_authoritative_pose_effect` routing and `registry/remote.rs::apply_remote_pose_effect` | Pose and classified consequence cross together; world coordinates scene application and remote-source update. No new finding in this route. |
| Camera registration / direct input / worker / reset | Client camera service/controller and host adapter; Explorer camera worker, possession lifetime and delivery boundary | Generation checks, explicit input permission, scoped worker retirement and serialized publication remain coherent. Host discarding a stale-input receipt is consistent with latest-wins input, not evidence of an unhandled mandatory outcome. |

This inventories the principal changed behavioral seams and their immediate production consumers,
including unchanged adapters. It is not an exhaustive audit of every exported utility, geometry
primitive, protocol serializer, or unrelated modified file. Findings below are source-backed;
no fresh live observation or benchmark was performed.

### Trackable findings

| ID | Priority | Concrete issue | Status |
| --- | --- | --- | --- |
| S1 | High for the promised path contract | Client publication discards accepted intermediate geometry and reconstructs a one-leg path. | Implemented; explicit movement provenance, shared projection, composed solver/camera/browser checks. |
| S2 | Medium | Collection outcome handling depends on consumer conventions; omitted outcomes are silent and coverage can coexist with accepted motion. | Implemented; exclusive body dispositions, exhaustive adapters, orthogonal coverage/report policy. |
| S3 | Low | Locomotion's boolean result mixes skipped work with partially modelled work, and production callers discard it despite the documented handling obligation. | Implemented; best-effort world adapter returns unit, lower-level modelling result remains available. |

**S1 — Accepted path information is lost at the client seam.**
`scene.rs::DynamicEntityBodyTick.motion` carries accepted contact segments or fixed placement.
`client/simulation.rs::tick_physical_entities` consumes body consequences and locomotion but drops
that motion field. `ClientSimulationTick` returns events/feedback, not paths. Later,
`client/dynamic_entity_view.rs::dynamic_entity_tick_event` compares before/after entity views and
always constructs a single leg ending at fraction one. The public `DynamicEntityPlacedPath` says
"Complete accepted entity root path" and `Integrated` promises interpolation of that complete path.
Frontend `evaluateHostDynamicEntityPath` linearly evaluates the supplied legs, while
`camera.rs::target_samples_from_dynamic_path` uses those same legs as parent waypoints.

Analytical consequence: a two-leg route A→B→C becomes A→C. For A=(0,0), B=(1,0), C=(1,1), with B at
half-time, the reconstructed midpoint is (0.5,0.5), not (1,0). Intermediate turns and membership
boundaries cannot survive an endpoint-only function signature. This can cut corners in presentation
and supplies a different parent route to camera queries; it does not establish canonical physics
penetration or a measured live camera failure. Straight travel is unaffected. Small per-tick motion
limits the size of the discrepancy but does not make the contract true.

`git show HEAD:crates/holtburger-core/src/client/dynamic_entity_view.rs` confirms the endpoint adapter
is inherited, not introduced by the last cleanup. Explorer's adapter already consumes
`update.motion.into_root_path(&previous, &current)`. The new solver's richer output therefore has an
uncompleted client integration seam. Green hand-constructed path-consumer tests cannot prove this
producer-to-consumer composition.

Recommended scope: preserve the accepted root path through the client simulation result into dynamic
publication; use the existing conversion and path format rather than another path solver or protocol.
Keep explicit snaps distinct and allow an explicitly documented endpoint representation for pose-only
projection where no physical route exists. Preserve zero-time adjustment handling through the existing
conversion, rather than inventing fractions in the client adapter.
Acceptance: a real multi-leg physical result survives client event publication and reaches renderer
and camera with its intermediate boundaries; compare with the existing Explorer conversion. Cover
a bent/stair or cell-crossing route plus discontinuities and stationary updates. A test of a manually
constructed wire path alone does not close this item.

**S2 — Public collection results permit incomplete adaptation.**
`DynamicEntityCollectionTick` independently exposes ordinary bodies, fixed placements, recovered
placements, reports and coverage rejections. Core handles the first three through separate loops,
but does not consume reports or coverage rejections in `tick_physical_entities`. Explorer's host
adapter forwards ordinary bodies, reports and coverage but never handles fixed/recovered placements.
Its callback type accepts general `PhysicalBodyInput`; the current production caller disables
contact-return capture and does not supply server correction state, which explains why recovery is
not currently expected. That restriction is a caller convention, not an enforced adapter contract.
This is not proof of a presently dropped Explorer recovery in ordinary use.

Coverage is an orthogonal observation: a body can publish an accepted prefix and also report missing
coverage. Explorer explicitly gives coverage precedence when retiring locomotion. The public rejection
comment says "without mutation," which is too strong for this use. Replacing all fields with a naive
success/rejected enum would erase a legitimate combination. Core also rereads final contact and
physical classification from the scene immediately after projection; the result carries prior
contact but not the corresponding final presentation facts.

Recommended scope: make per-body disposition explicit and exhaustively handled by both adapters,
while preserving partial coverage as orthogonal information and batch collision reports separately.
Keep source reset and ordinary/discontinuous publication under the appropriate world owner. If an
adapter intentionally cannot support a disposition, enforce that boundary rather than silently
omitting a list. Audit whether reports are intentionally unused before proposing to delete their
production; absent consumption does not authorize weakening the shared reporting feature.
Acceptance: each disposition has a named production handling or exclusion policy; recovery cannot
quietly disappear when a caller adds reference state; accepted-prefix coverage has one documented
meaning; redundant immediate scene lookups are removed only where finalization can provide the fact.
This is a public-seam follow-up to Q2, not evidence that the private extraction failed its narrower goal.

**S3 — Locomotion return semantics do not match the consumers.**
`MotionRuntimeRegistry::present_locomotion` returns whether every channel was modelled, and its comment
says the caller handles an unmodelled order. `WorldState::present_character_locomotion` forwards that
boolean but also returns false for a projectile, missing table, or missing authored state. Core
propagates errors with `?` and discards the boolean; Explorer discards the registry boolean directly.
Thus the seam does not distinguish "nothing installed" from "some requested channels unmodelled,"
and neither production consumer acts on either meaning.

Existing content fallbacks and best-effort visual playback may be exactly the intended behavior.
Do not convert missing optional content into fatal errors or add diagnostic state without a consumer.
Prefer making the world-facing API explicitly best-effort and removing its unused boolean, retaining
lower-level modelling detail only for a real consumer; alternatively supply a typed outcome only
if a caller will use the distinction. Acceptance: documentation and signatures describe the actual
fallback ownership, no mandatory handling obligation is silently ignored, and existing visual/action
behavior remains unchanged.

- [x] S1: carry accepted physical paths across client publication and verify actual composition.
- [x] S2: define and handle collection dispositions/coverage explicitly in immediate adapters.
- [x] S3: make best-effort locomotion outcome/fallback semantics explicit.

### Final seam implementation and acceptance

The finding descriptions and checkpoints below preserve discovery history. Current implementation:

- **S1:** scene finalization owns `DynamicEntityBodyTick.path` while both physical endpoints are
  available. `CollectionBodyMotion` and the late Explorer conversion are deleted. Core carries one
  `ClientBodyMotion` per changed placement: `Physical(path)`, `PoseOnly`, or `CorrectionSnap`.
  The separate path and placement-kind maps are gone. A changed placement without a simulation
  outcome errors; it cannot quietly become a straight line. Pure presentation updates need no route,
  and nontrivial physical travel is retained even if its final pose equals its initial pose.
- **Shared projection:** client and Explorer use `DynamicEntityPlacedPath::from_motion`; its parameters
  are endpoint rotations, not misleading whole poses. Generic placed-motion projection lives in core
  and is reused by camera and host. Endpoint-only geometry is constructed only for its explicit
  cases. Existing shortest-arc normalized rotation interpolation is preserved; this does not claim
  that a physical angular trajectory is reconstructed from translational segments.
- **S2:** `DynamicEntityCollectionTick.outcomes` replaces separate integrated/fixed/recovered lists
  with `DynamicEntityBodyOutcome`. Recovery replaces the same body's ordinary outcome. Integrated
  results carry final contact and installed character classification, removing immediate core
  classification/contact lookups. Contact preparation already checks actuation against the installed
  definition, so publication can reuse that proof. World player-support projection also consumes the
  committed contact fact.
- **Consumer policies:** core handles ordinary motion, fixed snaps, and recovery/source reset
  explicitly. Core intentionally does not deliver collision reports and preserves its existing
  coverage/locomotion policy: accepted prefixes remain published and residency can retry later.
  Explorer forwards coverage and reports and explicitly errors on fixed authority snaps or checked
  recovery. Its current producer supports authored reference travel with contact-return capture
  disabled, not server return sources. Ordinary authored fixed-body movement remains supported.
  The exclusion is checked during adaptation and does **not** promise rollback of the scene commit.
  Supporting server-driven Explorer recovery later requires an explicit source/publication decision;
  it can no longer disappear silently. No new recovery framework or solver policy was added.
- **S3:** the world locomotion adapter is explicitly best-effort and returns unit. The registry still
  exposes channel completeness where used. Optional missing content remains optional.

Acceptance evidence inspected:

- `physical_contact_path_survives_client_publication_and_camera_sampling` runs real free-body floor
  contact through client simulation/publication, checks every accepted position/fraction/membership,
  round-trips the wire batch, captures camera input, and checks camera target/visual pivot samples.
  Its intermediate boundary differs from the endpoint chord; an endpoint-only adapter fails it.
  Existing pose-only, correction-snap, and stationary presentation tests remain. The pose-only test
  also verifies that absent movement provenance is rejected.
- A temporary synthetic browser probe fed the Rust-produced JSON batch to production
  `decodeDynamicEntityEvent` and `evaluateHostDynamicEntityPath` in headless Chrome. Both boundaries
  matched the published placements; endpoint interpolation differed. Evidence:
  `/tmp/seam-browser-result.log`, `/tmp/seam-physical-batch.json`, and `/tmp/seam-browser-check.mjs`.
  This verifies browser decoding/placement math, not rendered pixels, live networking, or performance.
  The temporary Rust export was removed; the persistent composed Rust test includes serialization.
- Existing fixed-body and coverage fixtures now also verify the public collection dispositions:
  authority snap emits one fixed outcome; ordinary accepted travel coexists with unavailable later
  separation coverage. Existing checked-recovery tests verify that recovery replaces the body's
  ordinary outcome. All 86 contact-step tests pass (`/tmp/seam-disposition-tests.log`).
- Combined world/core/host library checks pass: 700/357/276, 1,333 total
  (`/tmp/seam-final-tests.log`). The frontend feed/presentation/placement suites pass 23 tests across
  three files. Final post-review core tests, warning-denied Clippy (including physics-profiling
  benchmark targets), debug build, formatting and diff validation are recorded at closeout below.

Maintainability acceptance is about the implemented contracts, not a blanket quality verdict.
The reviewed replacement contracts preserve physical route provenance and exclusive dispositions;
coverage/reports remain legitimately orthogonal. Camera registration/input permission/query readiness
remain distinct. No additional solver mechanism or persistent cache was needed. Q3 and optional
performance work retain their explicit deferrals. No live client restart, staging or commit.

### Completion audit after seam cutover

All required implementation, cleanup and acceptance items are satisfied. The sole unchecked task is
Q3, explicitly deferred to richer animation/channel composition; the three optional optimizations
remain unselected. Prior manual acceptance covers gameplay/tuning and the required optimization
follow-up. This cutover does not change solver mathematics, time admission, resistance tuning,
recovery admission, or animation policy; new path/publication behavior has composed automated evidence.

Final checks on the resulting code:

- World/core/host library suites: **700/357/276 passed** (`/tmp/seam-final-tests.log`). The final
  core-only rerun after removing unused endpoint construction also passed all 357 tests
  (`/tmp/seam-final-core-tests.log`).
- Frontend feed/presentation/placement suites: **23 tests passed** across three files. Actual Rust
  output also passed the browser composition check described above.
- Warning-denied all-target Clippy across world/core/host/debug-harness, including
  `holtburger-world/physics-profiling`, passed (`/tmp/seam-final-clippy.log`). The existing dependency
  future-compatibility advisory for binrw remains separate from Clippy diagnostics.
- Debug `holtburger-3d-host` binary built (`/tmp/seam-final-debug-build.log`). Formatting and
  `git diff --check` pass. No release build or live ACE session was used for these checks.
- Removed-contract vocabulary was searched in production/test consumers: no `CollectionBodyMotion`,
  separate fixed/recovered placement lists, or separate client path/kind maps remain. Architecture
  docs describe the current path and outcome boundaries. The general-purpose review skill includes
  explicit seam review and replacement-contract scrutiny and passed its validator.

The architecture remains the accepted bounded body model. S1–S3 are closed against their specific
criteria; this is not an exhaustive correctness certification of every unrelated file in the
accumulated worktree. The full diff remains uncommitted pending explicit packaging authorization.

### Historical seam implementation checkpoint

The subsequent "complete the plan" goal authorizes executing S1–S3. S3 removes the unused boolean
from `WorldState::present_character_locomotion`; absence of optional motion content and unmodelled
channels remain best-effort visual behavior. Registry documentation now permits that explicit policy
while retaining lower-level channel completeness for callers/tests that use it. The existing test's
redundant boolean assertions were removed; its actual clip, loop, physical-state and authored-hook
assertions remain. All 700 world tests pass (`/tmp/seam-s3-tests.log`).

S1 producer cutover: `DynamicEntityBodyTick.path` is now the accepted `PlacedMotionPath`, built by
the scene while it owns both previous and final physical states. Deleted `CollectionBodyMotion`
and its late consumer conversion; the Explorer host directly consumes the path. This is the shared
producer foundation, not yet the client publication fix. The client must still carry this path in
its simulation result into dynamic publication; S1 remains open. Affected crates compile
(`/tmp/seam-path-check.log`); combined world/core/host library tests pass (700/356/276; 1,332 total)
in `/tmp/seam-path-producer-tests.log`. Formatting and diff checks also pass. These verify the
producer cutover, not the still-missing client end-to-end path integration.

Next integration: reuse the existing Explorer entity path projection for both consumers, preserving
placement boundaries and its current rotation interpolation. The similarly named camera
`interpolate_pose` is not interchangeable: it selects the endpoint rotation rather than interpolating
it. Do not use it as a convenient substitute. Keep physical route publication distinct from the
explicit endpoint approximation used for pose-only movement, and test real multi-leg physical
output through client publication/camera consumption. S2 outcome adaptation and final verification
remain outstanding. No client restart, staging or commit.

### Continued seam review — replacement contracts

The current worktree now carries `ClientSimulationTick.physical_paths` through runtime publication,
and client and Explorer both call `DynamicEntityPlacedPath::from_motion`. Shared placed-motion
projection also serves the camera. This supersedes the earlier checkpoint's statement that client
path plumbing was still absent. S1 remains open: source-level plumbing is not the required composed
physical-solver/publication regression test, and earlier passing test totals do not verify these
latest edits.

The review followed the replacement path from collection finalization through simulation, runtime,
`dynamic_entity_tick_event`, shared projection and camera waypoint consumption, and compared the
Explorer delivery call. It also rechecked camera service start, direct input, stop and reset.
Findings refine S1/S2 rather than introducing another architectural workstream:

- **S1/S2: missing physical output can masquerade as pose-only movement.** Publication receives
  `placement_kind_overrides` and `physical_paths` independently, looks up each by GUID, and uses an
  endpoint path whenever no physical path is supplied. Endpoint approximation is legitimate for
  pose-only movement; the signature does not distinguish that from an accidentally omitted physical
  result. This is a contract weakness, not evidence of a currently missing map entry. Fold route
  provenance and disposition into the existing per-body publication work so callers cannot silently
  downgrade an integrated physical route. Do not add another parallel validation map.
- **S1: the new projection signature accepts more than it uses.** `from_motion` accepts previous and
  current `WorldPosition`, but uses only their rotations; accepted positions and membership come from
  `PlacedMotionPath`. Narrow these parameters to rotations when finishing the cutover. This makes
  ownership visible and avoids suggesting that two independent endpoint positions are reconciled.
- **S2: adapter restrictions must describe actual inputs.** The host collection method's comment says
  Explorer actors have no reference, while the reviewed producer can supply authored reference input
  with contact-return capture disabled. The relevant restriction is recovery capability, not absence
  of all reference input. Correct that contract description alongside exhaustive outcome handling.

Additional acceptance criteria:

- [x] An integrated physical publication requires its accepted route; endpoint approximation is an
  explicit pose-only case, and discontinuities remain explicit. Review the final caller together with
  its result type rather than closing S1 merely because a path map exists.
- [x] Shared projection parameters name the facts they consume; the physical path owns position and
  membership, while endpoint rotations retain the existing interpolation concession.
- [x] S2's host restriction and handling policy agree with actual authored-reference inputs, including
  what happens if a future caller enables recovery.

Counterexample retained: camera registration, ordinary-input permission and available query input
are different facts. Start deliberately clears old query input, and reset retires controller, input
and permission together. A stop need not mean leaving the active world. No consolidation of those
states is justified by this pass.

This continuation changes review guidance and tracking only. It does not establish a fresh live or
performance result, close S1/S2, or authorize a broader rewrite. Skill validation passed; the current
production edits still need their own final verification.

Review outcome: these are integration-contract issues, not grounds for another solver redesign.
S1 is the strongest outstanding issue; S2 deserves a bounded API cutover; S3 is smaller subtraction.
The earlier claim that cleanup completed architectural review was too broad. Historical acceptance
and Q1/Q2/Q4 implementation evidence remain intact; these new findings require their own disposition.

## Final product and code-quality audit — 2026-09-09

Verdict: retain the architecture. The final contact model has a coherent sequence and accepted
accuracy concessions; it does not need another solver replacement. Maintainability is less complete
at the preparation/publication seams. Recommend a bounded cleanup there before more feature work
accumulates, rather than treating manual success and finite iteration counts as a quality sign-off.
This audit records recommendations; it does not authorize their implementation or reopen optional
performance work. The user's latest "lgtm" closes the optimization manual gate.

### Review boundary and evidence

Reviewed the accumulated working-tree product against HEAD, including the untracked contact,
reconciliation, observed-motion, and camera modules, rather than only the last three optimizations.
Inventoried all changed/new paths; read the principal body and camera flows and their contracts in
depth, sampled focused fixtures, and compared current architecture guidance with plan promises.
This is a structural audit, not an exhaustive line-by-line correctness certification of every
changed file or test. Adjacent texture/UTF-16 chunking changes are mechanical collateral, not evidence
about physics quality. The deleted `dynamic_contact.rs` path is not a retained compatibility solver;
direct mobile queries route through the common contact implementation.

Existing verification was checked in its logs: 700 world, 356 core, and 276 host library tests
(1,332 total), warning-denied affected Clippy, and debug host build passed. Those are the previous
implementation checks, not new audit test runs. No new live session, performance benchmark, or
retail census was needed to establish these maintenance findings. No production behavior changed.

### Final execution and ownership trace

| Stage | Owner and final behavior |
| --- | --- |
| Time and source input | `core/client/simulation.rs::tick_with_precise_jump` admits time before advancing authored playback/hooks. Movement resolves local drive and optional presentation intent; the world motion registry owns remote command progress and its independent source frame. |
| Authority and movement | Scene collection captures body/input/reconciliation copies. `spatial/body_movement.rs::PhysicalBodyInput::step` predicts ordinary reference motion once and composes return or confirmation into physical actuation. Sticky pursuit uses reference-origin travel and explicit facing; accepted displacement does not become the next ordinary source. |
| Contacts and support | `mobile_contact/step.rs::advance_body_contacts` prepares roles, updates nonyielding targets, restricts inward mobile drive, performs ordinary hard navigation, runs four cheap separation iterations over one pair list, and hard-checks the combined correction. The same navigation machinery owns ordinary and corrective stairs/footing/edge protection; no recursive crowd convergence occurs. |
| Publication and recovery | `scene/contact_collection.rs` finalizes accepted continuation, nominal motion, reconciliation and activity, publishes bodies and reports, then checks stalled recovery destinations. Recovery replaces the visible ordinary result and retires source continuation through the relocation path. Fixed placement happens before the mobile snapshot; the entire method is not one rollback transaction. |
| Animation | Core consumes supported motion or explicit local drive intent. `WorldState::present_character_locomotion` selects the order; the motion registry's existing selector preserves action/pose/one-shot priority. The visual cursor emits no authored root offsets or hooks. Accepted horizontal separation is now included in visual gait, while lifts and airborne travel are excluded. |
| Client camera | Registration validates identity; the service explicitly owns ordinary-input permission separately from snapshot availability. Its dedicated worker advances the one controller against published scene input. Generation checks and publication share the lifecycle lock; reset clears permission, input and controller state; shutdown joins and invalidates handles. |
| Explorer camera | Registration validates possession and captures the target. The worker consumes published target travel once and retains its endpoint. Generation/possession lifetime gates guard input and publication; delivery orders epoch allocation with sending. Stop or worker shutdown retires active state. It shares the controller algorithm with the client, not the client-world lifecycle. |

### Findings, priorities, and bounded remedies

| ID | Concrete target | Priority | Status |
| --- | --- | --- | --- |
| Q1 | Preserve physical/geometry facts through private contact preparation instead of recovering them in consumers. | Medium | Completed and verified. |
| Q2 | Localize accepted-body finalization and recovery's replacement of the ordinary result. | Medium | Completed and verified. |
| Q3 | Remove the current renderer's single-clip limitation from shared semantic channel selection when richer animation is introduced. | Low | Deferred; intentional current visual approximation, not completed. |
| Q4 | Correct the supported-motion field comment and align current plan gates with accepted behavior and actual verification. | Low | Completed. |

**Q1 — Medium: preparation still discards useful guarantees.**
`mobile_contact.rs::PreparedBodyContact::from_body` reads installed physics and resolves the contact
role, but `PreparedContactRole::Hard` carries no geometry source and `WorkingBody` retains only a
general `&SpatialBody`. `step.rs` consequently recovers physical/dynamic state repeatedly to prepare
initial, moved-hard, and projectile-endpoint geometry. `WorkingBody::new` also revisits source
physics to decide activity. Source bodies are immutable throughout this kernel; those downstream
reads are not protection against concurrent removal.

The counterargument matters: public query inputs really can lack physics/dynamic state, and direct
movement-only bodies are supported. Earlier collection cleanup explicitly retained general-boundary
checks to avoid a body-store rewrite; that decision was reasonable. The narrower remaining target
is the private prepared contact contract, not every optional field on `SpatialBody`.

Recommendation: carry the already-read physical view and role-specific geometry source through
private preparation, validating unsupported input where the role is established. Preserve legitimate
absence for movement-only queries. Do not replace errors with assertions or add a global prepared-body
hierarchy. This should remove repeated source recovery, not create another registry or shape cache.
Acceptance: all three target-geometry consumers use a prepared source; independently callable input
validation remains, and each retained optional branch names a real input case. Address before adding
another contact role or geometry consumer.

**Q2 — Medium: collection finalization and recovery are too interleaved.**
`scene/contact_collection.rs::advance_contact_entity_collection` coordinates residency, fixed
placement, input capture, contact solving, publication, settlement and recovery in one method.
The costly reading burden is not its length alone: a recovered body is first added to ordinary
results and published, then removed with `bodies.retain` and represented in `recovered_placements`.
`DynamicEntityCollectionTick` also has `fixed_placements`; core consumes these through separate loops.
Adding another discontinuity requires remembering result supersession and source reset across these
stages. The finalization block repeatedly reaches into the general physical state while making
several independent decisions.

The stage order is necessary: hard placement precedes mobile solving, and recovery checks accepted
state. Private copies also serve a real purpose. Do not flatten these into an allegedly atomic
whole-tick transaction or introduce rollback merely to simplify a diagram.

Recommendation: extract cohesive accepted-body finalization and checked-recovery operations with
explicit inputs/results, leaving a readable stage coordinator. Start by localizing replacement of
the visible result with recovery; unify collection outcome variants only if that actually removes
producer/consumer coordination. A new result framework is not the acceptance target.
Acceptance: a reader can find one operation that owns ordinary-result supersession and source-reset
classification; recovery cannot require unrelated edits in several output-building loops. Preserve
fixed-first ordering, report retirement and existing recovery tests. Address before adding more
reconciliation/lifecycle cases, not by moving arbitrary blocks into pass-through helpers.

**Q3 — Low, explicit deferred boundary debt: shared gait selection encodes a renderer limit.**
`motion/observed.rs::observed_locomotion_order` drops the turn channel during translation with the
comment "The current renderer has one clip". `motion/state.rs::MotionOrder` otherwise represents
simultaneous forward/side/turn channels. A richer renderer would need a shared motion-policy change
to recover information suppressed for today's presentation. `motion/tests.rs` explicitly tests
the suppression, so this is an intentional current approximation, not an observed animation bug.

Keep current visuals for this feature. Before richer animation/channel composition, preserve the
semantic channels and put single-clip arbitration at the presentation selection boundary. Do not
blindly enable turn modifiers now: that could replace the walking clip. Acceptance for that later
work: simultaneous motion remains representable while the current frontend still chooses a sensible
single clip. No new animation framework is justified for this audit.

**Q4 — Low: some current comments and gate wording lag accepted behavior/evidence.**
`scene.rs::DynamicEntityBodyTick::supported_motion` still says positional adjustments are excluded,
but its producer takes `update.supported_velocity`, which intentionally includes accepted horizontal
separation (`step.rs` final correction observation). The older checked maintainability criterion
forbidding positional correction as locomotion is superseded by this accepted gait change. Preserve
that historical criterion as history; the current contract is supported visual travel, never a
physical continuation source. Correct the field comment in the cleanup pass.

The hard-index gate originally requested differential coverage of whole scenarios. What landed is
a differential candidate-selection fixture plus the existing scenario suite through the indexed
path. Conservative bounds plus unchanged exact queries support this alternative; it is not a
whole-solver differential run for each portal/stair/projectile scenario. Gate wording below now
records the actual evidence. Manual acceptance was also still marked pending and is corrected here.

### Decisions to keep and final cleanup acceptance

- Keep source/reference/accepted/visual motion distinct. They differ when blocked, separating,
  returning or attacking; collapsing them would restore the feedback problems this work removed.
- Keep sticky active-command and last-sampled-target state distinct: action completion retires the
  former while the final admitted interval still consumes the latter.
- Keep geometry at different snapshots separate. Report targets use tick-start poses; hard movers
  and projectile targets use accepted poses. Sharing is optional only where shape and pose coincide.
- Keep local pair resistance and separation separate: one restricts intended inward travel, the
  other repairs existing overlap. Their independent tuning serves the requested behavior.
- Keep the tick-local library BVH and deterministic candidate ordering. Its added code has a named
  replaced cost and no persistent invalidation lifetime. Do not infer a measured speedup from that.
- Keep camera-specific synchronization and explicit lifecycle permission. Similar client/Explorer
  worker loops do not alone justify a generic scheduler; their failure and ownership policies differ.
- Keep accepted non-exhaustive mobile contacts, residual overlap, discarded catch-up time and
  approximate gait cadence. No recursive solver, momentum propagation, or perfection gate returns.

Cleanup authorized by the subsequent "complete the plan" goal:

- [x] Q1: preserve useful proof at the private contact-preparation seam; remove the resulting repeated
  source recovery without weakening public validation or adding persistent state.
- [x] Q2: make finalization/recovery ownership locally understandable and bound result supersession;
  preserve execution order and source/report retirement without a collection-wide rewrite.
- [x] Q4: align the current supported-motion field documentation with its actual visual-only contract.
- [x] Record user manual acceptance and describe indexed-test evidence accurately.
- [ ] Q3: deferred until richer animation/channel composition; not a blocker for current behavior.

After an authorized cleanup, rerun affected tests and warnings-denied checks and retrace the changed
seams. Do not repeat a broad live campaign unless behavior changes or a concrete uncertainty requires
it. Optional geometry sharing, parallel sweeps and a different mobile index remain unselected.

The general review procedure and smell catalog developed during this audit are installed separately
at `~/.agents/skills/code-quality-review/SKILL.md`; project findings stay in this plan.

### Historical Q1/Q2/Q4 cleanup implementation

Q1: `PreparedContactSource` carries the immutable body and installed physical view; its
`PreparedContactTarget` distinguishes hard geometry, accepted mobile endpoint geometry and no target.
Preparation owns this decision and validates hard targets that require authored geometry. Initial
hard placement, moved-hard replacement, projectile endpoints and checked recovery consume the borrowed
geometry directly. Working-body activity and character admission use the installed physical view;
movement-only bodies still legitimately lack a dynamic lifecycle. No source registry, geometry copy,
persistent field, or cache was added. Public contact-duration/identity/geometry validation remains.
The source contract adds small private types while deleting duplicated geometry recovery and
consumer-owned target classification; this is a focused kernel contract change, not body-store typing.

Q2: `CollectionActuator::finish` now owns accepted nominal continuation, return progress, recovery
eligibility and final sleep state on the private body copy. It returns only a requested destination;
it cannot publish or relocate. `SpatialScene::recover_contact_placements` owns destination checking,
relocation/report consequences, ordinary-result removal and recovered-result classification together.
The coordinator still publishes ordinary bodies and commits touches before running that operation.
No new public result variants, outcome framework, rollback transaction or recovery policy was added.
The extraction adds two focused private methods, not new runtime state. General body-result validation
remains where publication serves a general body contract; it is outside Q1's immutable prepared input.

Q4: the `DynamicEntityBodyTick::supported_motion` comment now explicitly includes accepted horizontal
separation, excludes lifts/airborne travel, and prohibits using it as physical continuation velocity.
Historical criteria remain intact with the superseding contract noted above.

Maintenance retrace: adding a hard-geometry consumer now takes the prepared target source rather than
recovering dynamic state; changing stalled recovery admission/completion stays within finalization and
the recovery operation, with result supersession in the latter. Geometry pose timing, fixed-first
ordering, ordinary publication, contact expiry and downstream source-reset classification are unchanged.
Q3 and optional optimizations remain deferred; neither is required to close the accepted feature.

Final verification: 700 world, 356 core and 276 host library tests pass (1,332 total), including
direct queries, hard/mobile/projectile contacts, fixed root placement, reporting, support/edge
behavior, stalled recovery and source/animation lifecycle fixtures. Affected all-target Clippy with
warnings denied, formatting/diff checks and a fresh debug host build pass. Logs:
`/tmp/plan-cleanup-tests.log`, `/tmp/plan-cleanup-clippy.log`,
`/tmp/plan-cleanup-debug-build.log`. The dependency's binrw future-compatibility advisory is unchanged.

Completion audit: the only remaining unchecked item is the explicitly deferred Q3. All three required
optimizations have their implementation, analytical/fixture evidence and user acceptance above.
Earlier functional/performance acceptance remains applicable: no solver mathematics, tuning, timing,
camera lifecycle, frontend code or IPC contract changed in this cleanup. Historical evidence was
rechecked in `/tmp/contact-classification-census.log` (43,913 templates / 3,909 setups),
`/tmp/navigation-final-crowd-benchmark.log` (passing bounded benchmark) and
`/tmp/contact-feedback-app-tests.log` (273 files / 2,122 tests); these remain historical evidence,
not freshly rerun performance or frontend results. The current shared suites verify the changed
contracts and execution paths. No new speedup or live-equivalence claim is made.

The audit skill remains installed and validated at the requested path. Current architecture guidance
describes the prepared source and finalization/recovery ownership. Procedural history is preserved.
No required implementation or acceptance gate remains open; Q3 and optional optimization ideas are
recorded future work. No client launch/restart, staging or commit occurred during this cleanup.

## Scoped follow-up: structural solver optimizations

Status: **all three required targets implemented and manually accepted.** The user selected the first three opportunities below as actual
targets; the remaining three are optional only after manual assessment. Preserve all prior behavior
acceptance and procedural history. Goal continuation subsequently authorized implementation.

Goal: remove repeated candidate preparation and full-list lookups without changing accepted movement,
contact response, support, reporting, reconciliation, or presentation behavior. No speedup is measured
or promised yet. Favor fewer mechanisms and tick-local prepared facts over new persistent caches.

### Source findings and constraints

- `crates/holtburger-world/src/spatial/mobile_contact/step.rs`: `candidate_pairs` rebuilds and sorts
  bounds inside each of four separation passes. `remaining` bounds cumulative correction travel.
  `sweep_motion_sphere` scans prepared hard targets; nonyielding movers update their target poses
  before yielding movement, and projectiles later consume accepted mobile endpoint targets.
- `crates/holtburger-world/src/spatial/mobile_contact/step/stairs.rs::support_candidates` also
  scans hard targets. Sweeps and support must select conservative candidates for their own actual
  query extent and reached collision domains, including portals and optional stair/edge routes.
- `crates/holtburger-world/src/spatial/mobile_contact/step/collection.rs::collect_hard_report_touches`
  repeatedly searches source bodies by ID. Hard-target updates in `step.rs` also search by ID.
- `crates/holtburger-world/src/spatial/dynamic_index.rs::DynamicShadowIndex` already indexes prepared
  entity shapes by outdoor grid and interior cells. `step/report.rs` uses it for frozen tick-start
  report targets. Reuse applicable machinery; do not assume its membership query is automatically
  conservative for movement crossing into new domains.

Resistance is a separate local pair calculation over intended travel before ordinary movement;
separation operates afterward. Do not reuse one candidate list across those different stages.
Keep the four cheap separation iterations outside hard navigation, the cumulative correction bound,
player separation weight, push-through speed, deterministic pair order, and accepted residual overlap.
Retain ordinary and corrective hard navigation through their shared implementation. No new recursive
solve, catch-up steps, threading, physics tuning, or exhaustive mobile-collision requirement.

### Required implementation targets

1. **Prepare separation candidates once per tick.**
   - [x] Build conservative pair bounds at the ordinary endpoints, expanded by each body's full
     cumulative correction allowance, then reuse the stable pair list across all separation passes.
   - [x] Prove analytically that every subsequent sphere position plus remaining allowance stays
     inside its initial envelope. Preserve current pair ordering and exact per-pass contact checks.
   - [x] Use asset-free differential fixtures against the current rebuilding calculation, including
     contacts created by earlier corrections, exhausted budgets, coincident bodies, and dense crowds.
     Keep any reference implementation test-local and small; no production compatibility mode.
   Tradeoff: later passes may check extra nonoverlapping pairs in exchange for deleting three builds.

2. **Spatially index hard-entity candidates for movement and support.**
   - [x] Before implementation, trace index lifetime through sequential nonyielding movement,
     yielding movement/correction, and projectile target preparation. Establish how changed hard
     target poses become visible without rebuilding an entire index for each body or using stale bounds.
   - [x] Reuse existing spatial machinery where its contracts fit, with a conservative query seam
     shared by sweeps and support. Preserve exact shape, response-policy and collision-domain checks.
     Candidate selection must cover swept extent, stair rise/descent, upper-sphere clearance and
     newly reached cells; selecting only the body's starting cell is insufficient.
   - [x] Compare indexed candidate selection with exhaustive prepared-target selection using an
     asset-free fixture for moved targets, different memberships, support queries and endpoint
     appends. Run existing portal, outdoor, hard-top, stair/ledge and projectile scenarios through
     the indexed implementation. This substitutes conservative-candidate proof plus scenario tests
     for the originally proposed whole-scenario differential runs; see the final audit above.
     False-positive candidates are acceptable; missed hits/support or changed tie behavior are not.
   Tradeoff: index preparation adds work in small scenes and cell buckets can remain coarse indoors.
   If safe reuse requires a broader index/lifecycle rewrite, record that finding and resteer before
   expanding scope; do not silently replace this target with a new framework.

3. **Prepare identity lookup once where repeated searches occur.**
   - [x] Replace per-update/per-hit body searches in hard reporting and per-body hard-target searches
     with a stable prepared lookup or existing sorted-array lookup, whichever requires less machinery.
   - [x] Keep source bodies borrowed where possible, preserve explicit missing-identity failures,
     and maintain lookup validity when projectile targets are appended or target arrays reordered.
     Reuse preparation for duplicate-ID validation where contracts allow; do not add a second registry.
   - [x] Verify unchanged directional reporting, projectile policy and nonyielding target updates
     with existing focused fixtures; add only missing semantic coverage.

### Cleanup, verification, and manual assessment gate

- [x] Review the three changes together: one owner for each prepared fact, no surviving replaced
  search paths or vocabulary, no unnecessary body/shape copies, and no new persistent invalidation
  mechanism. Explain any net increase in code by the full scans or duplicated work it replaces.
- [x] Run affected asset-free tests, formatting/diff checks, warning-denied Clippy, and a debug host
  build. Record results and analytical equivalence findings here. Use existing diagnostics or a
  bounded synthetic comparison if needed to assess cost; no protracted live evidence campaign.
- [x] User manually assesses crowded movement, slow pushing/player resistance, walls, stairs,
  slopes/ledges, and responsiveness. Preserve running-in-place and remote correction presentation.
  User accepted with "lgtm" before asking whether optional work was worthwhile. Client launch
  or restart is not part of this documentation update; staging/commit requires an explicit request.

These three targets plus verification and manual assessment define completion of this follow-up.
Optional items do not become completion blockers merely because they remain possible.

### Optional only after manual assessment

- **Share compatible placed-geometry preparation:** consider if repeated shape preparation remains
  material. Reports intentionally use tick-start poses while solving can use updated poses; preserve
  that distinction and avoid a cache with ambiguous lifetime.
- **Parallelize independent ordinary/corrective body sweeps:** consider if hard navigation still
  dominates tick time. Preserve prepare/solve/publish boundaries and initially keep shared pair
  responses sequential. Scheduling overhead and synchronization must justify the added machinery.
- **Improve mobile spatial filtering:** consider if sweep-and-prune produces excessive unrelated
  candidates, such as bodies aligned along X. A different index cannot eliminate genuinely dense
  contact pairs. Do not add a sophisticated tree simply because one is available.

Manual feedback should select a remaining problem first; perform a bounded analytical/cost check
before promoting an optional item into implementation scope. No open user decision blocks the three
required targets.

Implementation findings and verification:

- Separation now prepares one stable list. By the triangle inequality, displacement from the
  starting center plus remaining correction allowance never exceeds the starting allowance.
  A test-local differential relaxation fixture compares reused versus rebuilt pairs for 45-body
  coincident, dense-grid and loose-grid populations, with exact final position/velocity equality.
  The fixture also asserts that new contacts actually occur and correction budgets are exhausted.
- Hard reporting prepares one borrowed body map for the reporting batch. Nonyielding hard-target
  updates use a tick-local identity-to-slot map, valid even after out-of-order projectile appends.
  No new persistent registry or geometry copy is introduced.
- The first implementation checkpoint passed 699 world library tests. Final validation now covers
  700 world, 356 core and 276 host tests (1,332 total); logs and final build are recorded below.
- Hard-index source audit: `sweep_hard_sphere` learns reached domains while tracing world geometry,
  after the caller supplies candidates. Using the existing domain index with only starting
  membership would miss portal-crossing targets. Candidate selection must be conservative in
  space independently of those not-yet-known domains, with exact domain rejection left in the
  existing sweep. This is an implementation constraint, not a reason to weaken collision behavior.

- `step/targets.rs::HardTargets` owns prepared shapes, identity lookup and Parry's existing `Bvh`
  together. It is local to one solve; no dependency, persistent cache, hand-written tree or scene
  registry was added. Tree leaves bound all shapes of a body; accepted nonyielding movement updates
  its leaf, and projectile endpoint targets append without reordering slots or rebuilding the tree.
- Reusing `DynamicShadowIndex` would require changing its membership contract. The existing Parry
  dependency supplies the needed domain-independent tree instead, avoiding that broader rewrite.
  Sweeps retain their previous enclosing-sphere shape filter and exact reached-domain checks.
  Support selection uses the same XY column as `placed_shape_supports`; vertical height admission
  stays with exact shape queries. Thus slopes, upper constraints and stair routes use conservative
  candidates without introducing a new height policy. Candidate output is identity-sorted, retaining
  hard-hit tie order regardless of tree traversal or append order.
- A differential candidate fixture compares indexed and exhaustive shape selection across 64
  spatially distributed targets, different memberships, moved targets, out-of-order append and
  subsequent replacement. It covers swept bounds and actual support results, checks stable order,
  and proves a localized query excludes unrelated targets. Existing portal, stair, slope, hard-top,
  projectile and reporting fixtures run through the indexed production path. The preservation
  argument is conservative bounds plus unchanged exact queries, not a claim of live equivalence.
- Tradeoffs: support columns intentionally do not reject by Z; a shrunken/empty target may retain a
  conservative leaf until the tick ends. Both can add candidates but cannot produce an exact hit.
  The new module adds approximately 140 production lines to replace repeated full-target scans
  with library spatial selection and a single update owner. Geometry/report preparation remains
  separate because their pose snapshots differ; that optional consolidation is not implemented.
- Duplicate-ID validation remains at the independently callable contact-step boundary; the later
  report lookup cannot replace an earlier precondition. No second persistent identity owner exists.
  Final affected tests: `/tmp/solver-optimization-final-tests.log`; warning-denied all-target Clippy:
  `/tmp/solver-optimization-final-clippy.log`; debug build: `/tmp/solver-optimization-debug-build.log`.
  All tests, Clippy, formatting/diff checks and the debug host build passed.
  No client launch/restart, staging or commit. Subsequent user manual acceptance closes the gate;
  optional optimizations remain unselected.

## Scoped follow-up: local drive-intent locomotion presentation

Status: implemented and automatically verified. The user accepted mobile resistance ("much better"); its
manual gate is closed. This follow-up preserves that physics and changes only local presentation.

Goal: a controlled character with active translation/turn intent keeps its requested locomotion
animation while obstacles, ledges, or mobile resistance limit accepted travel. Releasing intent
returns to observed movement. Remote characters keep observed locomotion. Existing actions,
one-shot transitions, special poses, charge and airborne presentation retain priority.

Source gate: `movement/system.rs::advance_local_authored_motion` prepares manual motion-table
orders; `current_local_drive_control` serves autonomous movement, not manual input. Autonomous
movement does not reliably own the local authored cursor. Therefore simply clearing the observed
cursor would not cover both sources. Reuse the existing independent locomotion presentation cursor
with an explicit command-or-observed input; no new cursor, retained intent flag, physics field,
frontend key interpretation, or authored root-motion change. Core owns resolved local intent;
world selects support-specific presentation and retains its existing action arbitration.

- [x] Factor the existing local command-to-order mapping for reuse by authored manual playback and
  local presentation. Cover active manual and autonomous input; server-controlled commands must not
  accidentally inherit stale manual intent. Resolve the presentation input before physical solving.
- [x] Pass an explicit command-or-observed presentation source through the existing world seam.
  Commands supply direction, gait and rate; final support/charge state still controls grounded,
  falling and ready selection. A command must never masquerade as accepted physical velocity.
- [x] Check command onset, zero accepted travel over multiple cycles, release/expiry, autonomous
  command, back/side/turn channels, and action/support interruption. Verify unchanged authored
  tick/root offsets and retained action priorities with asset-free fixtures.
- [x] Run affected tests, warning-denied Clippy, formatting/diff checks and debug host build.
  Review lifecycle/duplication, update architecture notes, and record results here. No launch,
  restart or commit is authorized by this request.

Accepted tradeoff: intentional foot sliding/running in place when requested travel exceeds accepted
travel, including slow pushing. Other entities continue to animate observed travel. Retail's
movement-order/support split is documented at `acclient.c:330390-330453`; this change approximates
that visual behavior without claiming exact retail cadence or altering its physical solver.

Implementation audit:

- `MovementSystem::local_locomotion_order` resolves active manual or autonomous intent before
  collision solving. It shares `local_drive_order` with manual authored playback, preserves gait,
  backward/side/turn channels, and returns no override on stop/expiry or explicit server control.
- `LocomotionPresentationSource` makes commanded channels distinct from accepted body motion.
  `WorldState::present_character_locomotion` feeds the existing visual cursor. Grounded command
  presentation uses the resolved order; charge/falling/unknown support use the existing support
  selector, including its missing-cycle stance fallback. Action/one-shot priority is unchanged.
- The client supplies command presentation only for its local character. Free-flight bodies skip
  command-order preparation entirely. An existing free-flight simulation fixture caught the
  initial unconditional run-stat lookup; the character eligibility boundary fixes that without
  weakening the test or inventing default stats.
- General cursor APIs now say `present_locomotion`, `retain_locomotion_presentation`, and
  `clear_locomotion_presentation`; the observed-motion geometric reducer retains its accurate name.
  Explorer's existing clear call was renamed; no Explorer policy or renderer contract changed.
- An asset-free world fixture runs commanded locomotion across 40 visual updates with unchanged
  physical pose/velocity and authored tick, checks looping, then checks release, charge/falling
  fallback, and action priority. The same fixture still verifies remote observed-facing behavior.
  Core checks manual channels, expiry, autonomous run and stop; existing manual-root, jump,
  server-directed and physical wall/ledge/resistance suites remain green.
- World 698, core 356, host 276 library tests passed (**1,330 total**) in
  `/tmp/local-intent-tests.log`. All-target warning-denied Clippy passed in
  `/tmp/local-intent-clippy.log`; debug host build passed in `/tmp/local-intent-debug-build.log`.
  Formatting and diff checks passed. No solver, collision, animation cursor count, root motion,
  hooks, retained velocity, or network packet behavior was changed by this follow-up.

Ready for user visual feedback; no live playtest of this new presentation behavior is claimed.
No client launch/restart or staging/commit was performed.

## Scoped follow-up: mobile movement resistance

Status: **implemented, automatically verified, and accepted by the user ("much better").** This section supersedes the
previous assumption that tuning separation mobility alone supplies satisfactory pushing resistance.
Preserve the procedural history and prior acceptance records below.

### Goal, evidence, and boundaries

Make bodies resist attempted inward movement while allowing sustained input to push them aside
slowly. Preserve the current small displacement of the controlled player by approaching bodies.
The user reports that running into mobs and players currently moves them aside almost unimpeded.

Source inspection explains a sufficient mechanism, without claiming a live trace of this report:

- `crates/holtburger-world/src/spatial/mobile_contact/step.rs::advance_body_contacts` integrates
  and hard-sweeps ordinary movement before resolving mobile contacts. Later braking changes
  continuation velocity, not the ordinary travel already accepted.
- `ContactStepActuation::integrate` applies stable character drive directly each tick. Previous
  contact braking therefore does not persist as resistance to the next requested advance.
- `crates/holtburger-world/src/spatial/mobile_contact.rs::resolve_mobile_contact` allocates
  positional separation by normalized weights. `ContactMobility::PLAYER = 0.01` and peer weight
  `1.0` send approximately 99% of unconstrained separation to the peer. This controls overlap
  recovery ownership, not the speed at which the initiator enters the contact.
- The current four tentative contact passes and final checked hard correction remain useful.
  Merely reducing their separation allowance would allow incoming motion to accumulate overlap.

In scope: admission of ordinary supported character movement against yielding mobile characters,
including controlled input, remote authored drive, sticky pursuit, and reconciliation through their
shared physical path. Resting neighbors participate as obstacles. Keep fixed/static/non-yielding
bodies in the existing hard-target path. Airborne, ballistic, projectile, and non-character motion
retain their existing policies; do not silently apply a horizontal walking rule to gravity or launch.

Out of scope: physical mass/inertia, momentum transfer, pathfinding, recursive propagation,
exhaustive mobile collision guarantees, new controller or animation ownership, reconciliation tuning,
and another rewrite of hard navigation. This is a deliberate gameplay refinement; no retail parity
claim is made. Existing ACE/retail references below remain authoritative for unchanged motion and
placement contracts, not evidence for this new pushing policy.

### Proposed tick and ownership

Keep resistance and overlap recovery independent:

1. Prepare hard targets and support, retaining non-yielding authored-body advancement before
   exposing those targets to characters. Sample each active yielding body's actuation once at its
   prepared support and compute its intended movement before advancing any yielding body.
   Sleeping neighbors contribute zero intended movement; preparation must not wake them merely
   to ask for a command. Preserve launch admission and missing-coverage behavior.
2. Build mobile candidates from starting shapes and intended travel envelopes. Reuse existing
   sphere geometry, membership/response permissions, and broad-phase machinery. Endpoint-only
   overlap detection is insufficient here: ordinary entry into a stationary neighbor must be
   limited on its first contacting tick. A local relative sphere-path calculation is sufficient;
   this is not another hard-navigation sweep.
3. Reduce each eligible body's own inward requested movement at mobile contacts, preserving
   tangential and outward movement. Admit travel up to contact, then only a small inward allowance
   based on admitted simulation time. Account for a neighbor's intended outward movement so
   same-direction following does not unnecessarily stop. Never create reverse movement or
   displacement of a stationary body in this admission pass.
4. Run the existing ordinary hard-navigation operation on the admitted movement. Feed the admitted
   motion coherently into physical continuation and accepted-motion publication; do not retain an
   unblocked movement vector that can leak into later travel or gait.
5. Run existing bounded mobile overlap separation and the final checked hard correction. Keep
   player separation weight `0.01`, peer weight `1.0`, and no momentum transfer. Separation remains
   responsible for residual/preexisting overlap; it is not restricted by the new inward allowance.

The proposed tuning control is **push-through speed in meters per simulated second**, independent
of `ContactMobility`. A starting trial of **0.06 m/s** corresponds to 2 mm per 30 Hz tick; this is a
proposed tuning value, not an established acceptance threshold. One body's allowance is shared
across its contacts for the tick: additional neighbors or passes cannot multiply it. There is no
accumulated credit, force, timer, or persistent contact latch. Pair constraints and their aggregation
must establish that guarantee before implementation; do not interpret the trial value as permission
to apply an independent allowance to every pair.

`advance_body_contacts` owns movement preparation and admission. The geometric calculation should
be a small stateless operation alongside the existing mobile-contact geometry; the implementation
may use a focused sibling module if warranted. Prepared tick-local facts need named consumers and
one owner. Avoid a second participant registry or a parallel source of movement intent in core.
`scene/contact_collection.rs`, direct/explorer callers, and core should normally consume the existing
result contract unchanged. Any required adapter change must be justified at the first gate.

### Gate 1 — analytical feasibility before production changes

- [x] Trace support refresh, once-only actuation sampling, non-yielding target advancement, intended
  movement, admission, hard movement, overlap correction, continuation, and observed animation.
  Identify a clean preparation/advancement split without copying the existing navigation loop.
- [x] Specify the contact-time and inward-admission equations, including initial penetration,
  tangency, coincident centers, separating motion, and a neighbor moving away. Existing overlap
  must not itself manufacture backward requested movement.
- [x] Specify deterministic aggregation for several contact normals. Prove on paper that it cannot
  increase requested speed, reverse a stationary body, multiply the per-body allowance, or restore
  inward motion already removed by another constraint. Do not assume independent projections
  automatically satisfy all these properties. Conservative loss of progress is acceptable.
- [x] Walk through two followers, two opposing walkers, a stationary player approached by a mob,
  and a chain whose front body is blocked by a wall. Intended neighbor travel can be optimistic
  when another contact or hard geometry stops it. Record the residual-overlap concession explicitly;
  reject a design that needs iterative whole-crowd convergence to function.
- [x] Check slopes, terrain seams, steps, and grounded/airborne pairs: limit walking advance without
  stripping vertical support response, gravity, or launches. Existing hard geometry must remain final.
- [x] Estimate candidate and allocation work. Reuse/factor envelope preparation rather than adding
  all-pairs work or multiplying hard sweeps. Any additional bounded mobile pass must earn its cost.

Gate passes when the equations and ownership trace satisfy these constraints with a small bounded
local operation. If the requirements conflict, explain the precise tradeoff before substantial code
changes; do not paper over it with contact history, per-edge exceptions, or recursive solving.

### Gate 2 — focused implementation and deterministic fixtures

- [x] Implement the agreed preparation/admission cutover, colocating its geometry tests and reusing
  contact eligibility. Keep mobility exclusively about separation share and preserve inward braking.
- [x] Demonstrate sustained pushing advances slowly instead of near free-running speed; movement
  away and unobstructed tangential motion remain available, including from an existing overlap.
- [x] Demonstrate an approaching mob is resisted before entering a stationary player and does not
  increase player displacement relative to the current separation policy in matched fixtures.
- [x] Cover first contact within a tick, moving followers, opposing movement, multiple neighbors,
  and a wall-blocked crowd. Swapping IDs/order must not materially alter the intended behavior.
- [x] Compare equal simulated durations at 30/60/144 Hz. Assert similar sustained advance using
  runtime constants and geometric tolerances, not exact solver-iteration-dependent trajectories.
- [x] Preserve hard-wall clearance, slope/seam movement, stairs, edge protection, attack/emote
  priority, sticky facing, stopping, and authoritative recovery placement. Test affected seams;
  do not rebuild every existing fixture or require unchecked runtime assets.

### Gate 3 — cleanup, quality, and manual tuning

- [x] Review the diff for duplicated preparation, repeated eligibility decisions, redundant movement
  fields, and obsolete comments suggesting mobility controls resistance. Preserve one hard-motion
  implementation and the existing bounded correction path; delete superseded mechanisms.
- [x] Run affected world/core/host tests and warning-denied Clippy, formatting and diff checks, and
  build the debug host. Summarize added production complexity and why each new pass/type is needed.
- [x] User checks sustained pushing into a mob/player, standing while approached, squeezing through
  a crowd, following a moving body, and stopping/escaping contact. Tune push-through speed without
  changing player mobility. Launch/restart only when authorized; never substitute a release build.
- [x] Record acceptance and remaining concessions here. Commit packaging remains separately
  authorized; the subsequent active implementation goal authorized implementation, not staging or a commit.

### Tradeoffs and maintainability acceptance

Dense crowds may resist more than strictly necessary. Opposing bodies can consume their own small
allowances, and optimistic neighbor movement can still leave overlap when hard geometry or another
neighbor blocks it. The existing approximate separation handles that overlap without promising
complete resolution. Ordinary walking entry receives better protection; exhaustive fast/airborne
mobile crossing remains outside scope. Slow intentional progress must not become a permanent jam
in the simple unobstructed one-neighbor fixture.

Done requires visible resistance plus gradual pushing, no increased stationary-player shove in
matched cases, and preserved hard-scene integrity. Structurally, the change must have one source of
prepared movement, no persistent resistance state, no recursive crowd solve, no extra per-contact
hard sweeps, and no new frontend policy. Automated correctness alone does not establish acceptable
feel; user tuning is the final behavior gate.

### Implementation audit — mobile resistance

The first gate passed with a conservative local half-plane admission operation:

- First relative sphere entry gives contact time `t` and a horizontal inward normal `n`.
  A recipient with requested travel `d` and peer travel `p` receives free inward allowance
  `b = dot(d,n)*t + max(dot(p,n),0)*(1-t)`, only when its own motion is inward and relative
  motion is closing. Initial overlap uses `t=0`; separating motion is unchanged. Coincident
  horizontal centers impose no arbitrary walking direction; existing separation handles them.
- Each plane has nonnegative `b`, so zero movement is feasible. One geometry-ordered projection
  pass preserves ordinary single-contact sliding. A final uniform contraction toward zero makes
  the result satisfy all prepared planes, including any disturbed by later projections. A
  backward-pointing result is reduced to zero. The operation is conservative, not an optimal
  solution for the crowd.
- Restore one vector toward the original request, of length at most
  `MOBILE_PUSH_THROUGH_SPEED * dt`. Extra contacts cannot multiply that vector's allowance.
  Limits are ordered by geometry rather than body ID. A temporary deterministic analytical
  probe checked 100,000 constraint arrangements; permanent fixtures exercise interference,
  ordering, zero input, escape, first entry, followers, and opposing walkers.
- The horizontal change is lifted tangent to prepared support. A further tangent-speed limit
  prevents redirected motion from gaining speed uphill; independent normal velocity survives.
  Airborne/launch/free-flight/passive bodies bypass this supported-character admission.
- Neighbor intent remains optimistic when hard geometry or another mobile stops it. Membership
  filtering uses the existing starting-domain contract, so new-domain and redirected-path mobile
  crossings remain approximate. Neither case adds a feedback solve or weakens hard navigation.

Production ownership and subtraction:

- `mobile_contact/step/admission.rs` contains the tick-local operation and its five focused tests.
  Approximately 220 lines of production code own eligibility/preparation, candidate limits,
  conservative aggregation, and slope-preserving application; approximately 120 lines are tests.
  No new persistent body field, controller state, public input variant, or adapter is needed.
- `advance_body_contacts` samples yielding intent once before moving yielding bodies. The existing
  non-yielding authored-target ordering remains intact. A shared `advance_ordinary_motion` helper
  owns translation/orientation for both paths, rather than copying navigation.
- `Envelope::new` and `envelope_pairs` serve both resistance and overlap relaxation. The additional
  mobile broad-phase pass uses travel envelopes and at most one relative-entry computation per
  sphere pair, with two directional responses. It adds no per-contact hard sweep. Dense candidate
  populations still have the existing broad-phase worst case; no claim of linear crowd scaling.
- The tuning constant is `mobile_contact.rs::MOBILE_PUSH_THROUGH_SPEED = 0.06` m/s.
  `ContactMobility::PLAYER = 0.01` is unchanged. Braking and separation remain independent.
  Architecture documentation now reflects admission before hard movement and separation afterward.

Verification and surprises:

- `sustained_mobile_resistance_is_slow_and_stable_across_tick_rates` runs the common body tick
  for four simulated seconds at 30/60/144 Hz. Player-driven advance remains near the configured
  pushing distance; a stationary player approached by a mob moves less than 5% of that distance.
  The mob also advances under sustained pushing, ruling out a merely slowed permanent jam.
- The occupied-stair fixture originally demanded full traversal in two seconds. That assertion
  encoded the behavior being replaced. Its duration now derives from the configured pushing speed;
  eventual top support, occupant displacement, and hard clearance assertions remain unchanged.
- Existing driven-corner crowd/release, seam/slope, authored motion, sticky/action, stopping and
  authoritative recovery suites pass with the new common path. Geometry fixtures cover following
  and ordering, but this does not claim live crowd-feel acceptance.
- Final affected library suites: host 276, core 355, world 698 (**1,329 tests**), all passed in
  `/tmp/mobile-admission-final-tests.log`. All-target warning-denied Clippy passed in
  `/tmp/mobile-admission-clippy.log`. The debug host build passed in
  `/tmp/mobile-admission-debug-build.log`; `cargo fmt --all --check` and `git diff --check`
  also passed at handoff.

The user subsequently accepted the mobile-resistance behavior ("much better"), closing its manual
gate. No independently witnessed live playtest is claimed. No changes were staged or committed;
local drive-intent presentation is recorded separately above.

## Scoped follow-up: stalled remote reconciliation recovery

Status: implemented; analytical, fixture, quality and debug-build gates passed. User accepted the follow-up ("lgtm"); no independently observed live recurrence retest is claimed. This follow-up does not
invalidate the original manual acceptance or authorize a commit. Historical completion statements
below refer to the original implementation.

### Problem and source evidence

The user reports returning dungeon mobs bouncing at corners while relogging reveals them already
home. The individual recurrence has not been packet-attributed, but source inspection establishes
an applicable failure path:

- ACE `WorldObjects/Monster_Navigation.cs`, `MoveToHome`, sets a five-second cancellation deadline.
  Failed movement progress after that deadline invokes `CancelMoveTo`; returning monsters call
  `ForceHome`, which teleports server physics home and calls `SendUpdatePosition()`.
- `Network/Structure/PositionPack.cs` advances the network teleport sequence only for `adminMove`;
  this home update uses the default false value. An internal physics teleport does not by itself
  identify this update as a network teleport.
- Our `state/mutations.rs` remote position admission resets for a newer teleport sequence, but
  normally interpolates nearby bodies. Physical correction respects obstacles and can remain
  blocked indefinitely.
- Retail `InterpolationManager::adjust_offset` (`acclient.c:372019-372098`) checks progress every
  five updates, fails below 30% of expected speed, and accepts failure-distance below 0.2 m as close
  enough. Active sticky targets bypass that insufficient-progress check.
- Retail `UseTime` (`acclient.c:372101-372201`) attempts direct placement after more than three
  failures or an emptied queue with a failure. `SetPositionSimple` uses teleport/slide flags;
  placement must succeed before interpolation is stopped. This motivates bounded recovery, not
  copying retail's frame-count threshold or queue architecture.

### Proposed behavior and ownership

- Apply only to remote physical character reconciliation; exclude the controlled player.
- Observe actual post-solve reduction in correction error. Sideways travel or bouncing alone is
  not progress. Start with a named, tunable two-second simulation-time observation window; this
  duration is a proposal, not a retail-derived requirement. Define meaningful progress precisely
  during the analytical gate, using existing distance tolerances where appropriate.
- Recover to the latest server-provided pose, never blindly to the collision-free predicted
  reference. Repeated identical authority updates must not restart observation; a materially
  changed destination starts a new observation. Define that comparison alongside progress so small
  packet jitter cannot indefinitely defer recovery.
- Suspend recovery during explicit sticky pursuit or direct player contact. This preserves
  intentional displacement. Decide pause/reset semantics in the first gate so ending contact
  cannot release a stale, immediately expiring recovery timer.
- Validate destination placement against loaded hard geometry without sweeping the intervening
  route. On success publish a discontinuous placement and retire obsolete movement, reference,
  support and contact state through existing lifecycle machinery. Preserve current attacks and
  emotes; source motion continuation must be coherent with the accepted placement.
- Missing content or rejected destination placement leaves the current body intact. Retry only at
  bounded intervals; never introduce per-substep placement retries or a busy loop.

Keep observation state with reconciliation, sample accepted progress at the existing physical
transaction boundary, and reuse authority/placement/publication contracts. No new pathfinder,
interpolation queue, recursive contact mechanism, or generic controller registry.

### Implementation gates and acceptance

- [x] **Analytical placement/lifecycle gate:** trace authority admission, retained authoritative
  versus predicted pose, post-solve observation, destination validation and discontinuous
  publication. Verify whether existing placement/reset APIs preserve action playback and can
  reject invalid destinations without partial mutation. Define progress, destination-change,
  contact suspension and retry rules before coding. Stop and resteer if this requires parallel
  lifecycle machinery or broad controller changes.
- [x] **Focused implementation:** add the minimum reconciliation-owned observation state and
  checked recovery outcome. Each field must have a named consumer; compute eligibility once at
  its owning layer. Reuse existing player-contact/sticky facts if sufficient; do not infer them
  from accidental data availability or add a separate pushing state.
- [x] **Deterministic fixtures:** unchanged-teleport home update blocked by a corner; bouncing
  without convergence; genuine progress; repeated identical updates and destination replacement;
  controlled-player exclusion; direct player contact and sticky pursuit; unavailable content;
  rejected placement and bounded retries; successful recovery with coherent collision, support,
  source motion, action playback and discontinuous publication. Include a predicted reference
  inside geometry to prove it is not used as the recovery destination.
- [x] **Quality and validation:** review for duplicated decisions, obsolete state and redundant
  lifecycle paths; run affected tests, formatting and warning-denied Clippy. Document deliberate
  retail differences using the repository convention where applicable. User visual confirmation
  can validate the reported dungeon symptom; do not require a protracted live run to establish
  the deterministic recovery contract or claim packet attribution without a capture.

### First-gate implementation checkpoint (historical; superseded by final audit)

- The scene already retains `SpatialBody.authoritative_pose` separately from the moving physical
  reference. Recovery should consume that existing authority field rather than duplicate the pose
  in the watchdog. `correct` currently replaces the correction record on every authority update;
  observation must survive equivalent updates deliberately.
- `contact_collection.rs` publishes accepted movement from a private body/reconciliation copy.
  This is the appropriate place to measure progress. Recovery publication must not also expose
  the pre-recovery accepted path as continuous travel or leave its report touches active.
- `relocate_dynamic_body` already resets kinematics, support, spatial membership and report
  lifetimes, but retained the old reconciliation allocation. This prerequisite is corrected with
  an extension of its existing relocation regression fixture. The helper itself does not own
  animation playback, so physical relocation need not cancel an attack or emote.
- Placement membership is not clearance: `resolve_physical_body_placement` only resolves cell
  domains. World `placement_contacts` supplies nondirectional overlap information. A stationary
  hard sweep is not a substitute: hard-response sweeps suppress tangent/separating contacts.
  Destination hard-entity clearance and bounded support accommodation remain to be composed and
  tested before enabling a recovery placement. In particular, known server floor poses can need
  our existing bounded upward support adjustment on slopes.

This checkpoint does not pass the first gate or claim the recovery behavior implemented. Remaining
work is destination validation, recovery/watchdog integration, lifecycle/publication composition,
and the acceptance fixtures listed above.

### Recovery cutover checkpoint — core path connected (historical)

Implemented a reconciliation-owned progress observation that survives equivalent authority updates.
The initial rule is two seconds of admitted simulation time without 5 cm of net improvement;
a destination shift over the existing 20 cm start tolerance restarts observation. Lateral bouncing
and repeated identical updates do not renew it. Suspension discards the observation, and failed
placement attempts wait a full new window. The existing `authoritative_pose` remains the recovery
destination; the watchdog's saved pose is only a window baseline for detecting accumulated target
changes, not a second authority record.

Destination validation reuses ordinary bounded support acquisition and nondirectional world/hard
entity overlap queries. Scene publication performs recovery after accepted body publication, ends
old contact report lifetimes, removes the old continuous path from delivery, and emits a separate
recovered-placement result. Core resets remote source continuation without replacing authored
playback, then publishes `CorrectionSnap`. The ordinary relocation helper now has a private
preparation function and clears obsolete reconciliation state.

Verified so far: progress/replacement/suspension unit cases, plus a collection fixture in which
repeated ordinary home updates recover across a wall, reject a destination in that wall, defer an
unavailable destination cell, exclude the controlled player, and suspend for a prepared sticky
input. World 689/core 355 passed before the later expansion of the collection fixture; affected
all-target warning-denied Clippy passed at that checkpoint. The expanded collection fixture also
passes. Logs: `/tmp/stalled-recovery-shared-tests.log`, `/tmp/stalled-recovery-clippy.log`,
`/tmp/stalled-recovery-wall-test.log`.

Remaining before acceptance: direct player-contact coverage; hard-entity and support-accommodation
placement fixtures; action/source/publication composition coverage; explicit sticky lifetime
suspension when target preparation is unavailable (do not let data availability grant recovery);
review of remote-only scope and final affected checks/build. Existing position-admission tests prove
unchanged teleport epochs select interpolation, but the new wall fixture currently starts at the
classified pose-effect boundary, not packet admission. No live symptom attribution or manual
acceptance is claimed. The first gate is not closed until these composition concerns are resolved.

### Final implementation and acceptance audit

The implementation now carries source-owned recovery suspension independently of prepared target
geometry. Core reads the sampled sticky lifetime from `BodyMotionRuntime`; unresolved pursuit can
fall back to ordinary motion while remaining ineligible for placement recovery. Autonomous input
also suspends recovery. Direct player contact is checked against both tick-start and accepted
player poses, with one player lookup rather than scanning the population per actor.

Checked destination publication shares relocation preparation/commit machinery. It retains the
support-adjusted pose and reached membership together, reseeds the final response cell, resets
reference and kinematics, and ends old reports. All recovery attempts in a tick share one stable
peer snapshot; no population copy occurs per attempt. Hard-target validation reuses prepared
response classification and existing support/overlap queries. No pathfinder, interpolation queue,
recursive contact pass or frontend-specific recovery mechanism was added.

| Requirement | Current evidence |
| --- | --- |
| Ordinary home packet, unchanged teleport sequence | `stalled_remote_return_recovers_across_wall_but_rejects_occupied_destination` now admits actual `PositionPack`s in its clear-destination case; no forced-reposition event is received, but stalled correction recovers across the wall. |
| Net progress, bouncing, repeated updates and bounded retries | `repeated_authority_and_lateral_bouncing_do_not_hide_stall` and `progress_destination_changes_and_suspension_restart_observation`; the collection fixture repeats identical home updates. |
| Server destination, not predicted reference | The collection fixture's `PredictedInsideWall` case drives a reference into the wall but recovers to the separate server pose beyond it. |
| Controlled player and sticky exclusions | Collection cases `ControlledPlayer`, `Sticky` and `UnpreparedSticky`; core supplies suspension from sampled command lifetime. |
| Intentional player displacement and fresh release window | `player_contact_suspends_recovery_without_preserving_an_expired_window` combines actual pair permissions/sphere contact with watchdog suspension and release. |
| Invalid/unloaded placement leaves the actor intact | Collection cases `Occupied` and `MissingCell` never recover; retries remain separated by a full observation window. |
| Hard entities and support accommodation | `recovery_placement_checks_hard_entities_and_accommodates_support` rejects an upper-body hard obstruction and accepts bounded upward support correction. Low hard tops remain legitimate support rather than categorically invalid destinations. |
| Coherent physical reset and reporting | Extended `dynamic_relocation_clears_pose_dependent_state_and_moves_membership_atomically`, existing relocation/report lifetime coverage, and collection assertions that the old continuous result is absent after recovery. |
| Action and publication continuity | `recovered_body_publication_preserves_action_and_playback_phase`; runtime maps `CorrectionSnap` to the existing zero-duration placement delivery, covered by core's placement-view tests. |
| Maintainability | One observation in physical reconciliation, one source suspension fact, existing authority pose, shared placement commit, and no new animation controller. Architecture notes and retail-divergence marker describe the final policy. |

Final verification: world **692**, core **355**, host **276** tests pass
(`/tmp/stalled-recovery-final-tests.log`). Affected all-target Clippy with `-D warnings` passes
(`/tmp/stalled-recovery-final-clippy.log`); formatting and diff checks pass. The production debug
host executable was rebuilt successfully (`/tmp/stalled-recovery-debug-build.log`). No release
build, client launch/restart, staging or commit was performed. All scoped implementation gates
above are complete; the earlier checkpoints describe intermediate findings, not remaining work.

Automated acceptance does not claim the user's particular mob was packet-attributed or that a live
playthrough has occurred. The debug client remains user-owned. The original plan's procedural
history and separate diagnostic/deferred commit notes remain intact.

### Tradeoffs and completion boundary

An occasional visible pop across intervening walls is preferable to permanent server/client
placement disagreement. This does not promise pathfinding, exact retail trajectories or recovery
while the player intentionally holds a mob aside. Sticky/contact suspension can leave some combat
corrections obstructed, invalid/unloaded destinations can defer recovery, and a stale server pose
can yield a visibly backward correction. Simulation-time measurement also stretches the wall-clock
wait under discarded-time stalls. Retain these limits explicitly rather than adding edge-specific
fallbacks. Destination validation and ordinary hard-scene integrity remain mandatory.

Done means the analytical gate holds, the listed automated cases pass, accepted pushing and action
behavior remain intact, and the change is reviewable without another broad solver rewrite.

## Outstanding debt and cleanup

The original implementation, movement-resistance follow-up, and required seam cleanup are closed. Q3 and the unselected optional optimizations remain deferred; these historical diagnostic leads do not reopen accepted gates:

### Empty resting animation investigation — closed (2026-09-08)

The original synthetic attack/pursuit fixture omitted the resting clips. Its action completed at
step 14 and its hook fired at steps 7 and 22 (`/tmp/sticky-attack-collection-trace.log`). This is not
an established production playback defect.

Source inspection corrects the earlier fallback diagnosis: `MotionSequenceRuntime::append` makes
**each appended clip** the start of the cyclic tail. Appending an action followed by an empty return
cycle therefore leaves the last action clip as `first_cyclic`; the `unwrap_or(current)` fallback is
not needed to cause the repeat. ACE `Sequence.append_animation` and retail `CSequence::append_animation`
(`acclient.c:327037-327083`) set the same marker. Retail advances from the final clip to `first_cyclic`
(`acclient.c:326935-327033`), and `add_motion` appends nothing for a zero-animation record
(`acclient.c:323967-324010`). ACE's action selection likewise installs the action then the return cycle.
This establishes the shared sequence mechanism, not full hook/action-lifetime equivalence.

A read-only census of the installed EOR portal content decoded **436 motion tables and 18,451 cycle
records: zero empty cycles, hence zero empty default cycles**. `MotionSequence::project` maps every
animation reference to a clip and errors on missing animations; it does not silently filter clips.
The omitted-return precondition is therefore absent from this content. No server access or live
client was required. This finding does not claim applicability to future/custom archives.

No production change or fixture preserving the artificial empty-return behavior is warranted.
Ordinary action-to-rest hook coverage remains in place. Reopen only if new content or a runtime path
can produce an empty return cycle. Census output is `/tmp/empty-cycle-census.log`; the temporary
census source was retained at `/tmp/empty-cycle-census.rs` and removed from the harness after use.

### Historical motion-rate observation

The reference-formula audit below passed; the older captured overshoot remains unexplained.
Investigate further only with a reproducible mismatch that isolates command, rate, scale and admitted
time. The old scale-removal experiment does not justify changing production scaling.

### Final diff review and commit packaging

The cumulative implementation remains uncommitted. Review its quality and scope, then package commits
when authorized. Approximate crowd separation, residual overlap and action-time correction sliding
are accepted tradeoffs, not outstanding fixes.

## Procedural highlights

The detailed record remains below. These are the major course corrections and what prompted them:

1. **Replace explicit pushing with local contact response.** User review favored behavior emerging
   over bounded steps, tolerated overlap and nonexhaustive mobile collisions. Hard scene integrity
   remained mandatory; recursive crowd solving and exact equilibrium were rejected.
2. **Make feasibility and ownership explicit before expanding implementation.** Analytical gates,
   small fixtures and a structural review exposed duplicated decisions across preparation, solving,
   reconciliation and presentation. Camera servicing gained an independent lifecycle so entity work
   would not dictate camera responsiveness.
3. **Unify footing and navigation.** Ledge, stair and hard-entity-top cases exposed gaps in isolated
   support policies. Source review and fixtures established a shared footing contract. Classification
   was corrected to distinguish animation/root motion from whether a character can yield.
4. **Let failed debug acceptance reopen the design.** The Olthoi swarm remained sluggish despite
   bounded computation. Attribution exposed multiplied hard-world work. The eventual cutover used
   tentative mobile separation followed by a checked correction, sharing navigation between ordinary
   and corrective motion rather than repeating hard navigation inside every contact substep.
5. **Repair movement continuity after performance acceptance.** Playtests exposed frozen locomotion,
   falling/stalling approaches and terrain-seam interruptions. Authored and observed animation
   ownership, bounded support recovery and persistent navigation acceptance were consolidated.
6. **Separate commanded travel from reconciliation.** Repeated remote drift reports led from braking
   refinements to a shared movement owner and retained source frame. Correction stopped feeding back
   into ordinary motion. A return-facing experiment was superseded by translation-only correction
   after the user observed settled heading disagreement.
7. **Implement explicit sticky pursuit rather than infer melee behavior.** Protocol/source inspection
   identified sticky target commands. Their lifetime, initial admission, MoveTo handoff, target-facing
   and action/physics composition received analytical and fixture gates. Quiet return gained hysteresis.
8. **Remove momentum transfer and tune positional response independently.** Crowd launches motivated
   braking only each body's own inward velocity. Return speed became proportional to distance.
   Contact permission was decoupled from separation weight; the final player weight of 0.01 passed
   manual checks. Full suites and warning-denied Clippy passed at closeout.
9. **Bound the remaining rate investigation.** A post-closeout source/formula audit and 36 synthetic
   rate comparisons passed. The historical aggregate overshoot was retained as a diagnostic lead,
   without treating scale removal as a solution or requiring another live campaign.

## Post-closeout motion-rate audit (2026-09-08)

The historical captured overshoot remains an unexplained observation, not a demonstrated defect in
the current ordinary movement-rate calculation. The surviving `/tmp/direct-stop-heading-replay-*`
logs confirm final errors of 8.49572 m with repeated heading admission, 7.8846483 m with one-shot
heading admission, and 0.6691953 m with one-shot admission plus experimental division by scale.
These are aggregate trajectory errors from an older implementation, not isolated rate measurements.
Removing object scale is not justified by them.

Analytical trace: motion selection scales clip frame rate and explicit motion velocity by command
speed (ACE `Physics/Animation/MotionTable.cs`, `add_motion` and `combine_motion`). Sequence advancement
integrates root frames plus explicit velocity over elapsed time (ACE `Sequence.apply_physics`, retail
`acclient.c:326355-326382`). Grounded authored translation is multiplied by object scale once (ACE
`PhysicsObj.UpdatePositionInternal`, retail `acclient.c:308262-308298`). Our core simulation advances
authored playback once using admitted time, applies that scale gate, then projects the resulting
offset through the source heading and divides by the same interval to obtain velocity. The
projection does not apply scale again. Observed animation and return correction do not feed the
authored sequence. The existing time cap can reduce travel per wall-clock second under stalls; it
does not establish an explanation for the historical overshoot.

Added `ordinary_motion_rates_match_reference_across_speed_scale_and_tick_size`: a self-contained
uniform-root fixture checks independent expected distance through motion selection, sequence
advancement and the support/scale gate. It covers walking, running with explicit velocity, same-cycle
rate changes, stopping/restarting, scales 1.0/1.2 and 30/60/144 Hz. All 36 one-second segments agree
within 0.1 mm. The oracle is the reference-derived straight-line formula, not execution of the ACE
or retail binaries. Uniform root frames deliberately eliminate the already documented retail
boundary substitution difference. Existing fractional turning, reverse playback, hook ordering and
transition tests also pass: 60 motion tests total.

Acceptance limit: this establishes the tested arithmetic and partition behavior, not arbitrary
content equivalence or live packet-time alignment. No production change or new live run is warranted
by this result. A future reproducible mismatch should first compare command/rate/scale and admitted
time for the same interval before attributing aggregate reconciliation error to motion rate. The
plan remains closed; exact retail trajectories remain outside its acceptance requirements.

## Final accepted behavior

- Bounded local contact passes and hard navigation, without recursive crowd solving or catch-up debt.
- Persistent support, hard entity tops, stair/slope/edge handling and independent authored/observed animation.
- Mobile contacts brake each body's own inward motion without transferring momentum. Weighted positional separation remains approximate.
- Mobile response permission is independent of separation weight; zero weight still permits braking. Player/peer separation bias is currently 1:100.
- Physical return scales directly with error at 2/s, without the former 1 m/s ceiling. Remote supported correction retains its 20 cm start / 5 cm stop band and preserves commanded heading.
- Explicit sticky target commands supply pursuit and facing while actions retain playback priority; source lifetime, reference prediction and physical acceptance have dedicated coverage.

The user confirmed that manual checks look good after tuning to 0.01 and requested closure. Final full suites pass world **685**, core **355**, host **276** (`/tmp/entity-physics-closeout-tests.log`). Affected all-target warning-denied Clippy is `/tmp/entity-physics-closeout-clippy.log`; formatting and diff checks pass. The accepted production debug executable was built successfully in `/tmp/player-weight-001-build.log`. Closeout changes after that build are tests/documentation only.

Accepted limits remain: residual overlap and repeated positional jostling; nonexhaustive mobile crossings; brisk/sliding distant correction, including during protected actions; hard obstacles may prevent reaching server melee range; approximate remote run-rate and gait behavior. Exact retail trajectories, crowd equilibrium and numerical agreement with every server update are not completion criteria.

A separate empty-resting-animation sequence case was observed in a synthetic fixture and is documented below for future applicability investigation. It is not fixed or silently claimed as accepted retail behavior. It does not block the implemented ordinary action-to-rest movement scope.

## Historical design and execution record

The remainder preserves investigation and superseded designs. Later checkpoints supersede earlier values, mechanisms and requirements; the final accepted behavior above is authoritative. There is no remaining implementation or acceptance task in this plan.

## Goal and course correction

Make crowded character movement responsive through small physical steps, tolerant overlap, and mobility-weighted local contact response. Pushing and crowd resistance emerge over successive steps rather than requiring a completed crowd solution in any one step.

The user explicitly accepts approximate physics, residual overlap, and player displacement. The latest user-approved tuning gives the player and ordinary mobiles equal positional mobility, with braking-only player velocity response: overlap can displace the player, but incoming peers cannot impart player momentum. This supersedes strict player immunity, explicit direct-pressure selection, target-first/player-next ordering, and the requirement that every accepted step completely resolve entity contacts. No new pressure state or special pushing phase is needed.

The whole solver is in scope: integration, contact response, hard-obstacle queries, grounded/free movement coordination, body classification, time admission, and publication. Keep decoded content, topology/residency semantics, meaningful collision filters/reports, and one canonical physical pose. Body-driven locomotion selection and preservation of explicit action playback are in scope. Skeletal blending, new animation assets, torque, realistic stacking, exact momentum conservation, exact retail trajectories, and guaranteed crowd escape are out of scope.

## North stars

1. A step makes bounded local progress; incomplete entity separation is ordinary physical state.
2. Use the same contact rules for player approach, mob approach, and authority return.
3. Prioritize hard-obstacle integrity over accurate mobile-body separation.
4. Keep computation bounded without consensus, recursive propagation, or global rollback.
5. Preserve content navigation and clear state ownership without preserving old solver structure.

## Requirements and accepted concessions

| Requirement | Design consequence |
| --- | --- |
| Pushing should emerge from contact | Integrate movement, then apply a fixed number of local mobility-weighted contact passes. No selected push targets or pressure velocity. |
| Player momentum is not driven by incoming mobs; overlap can still displace the player | Current positional mobility is equal by user request. Braking-only velocity response prevents incoming peer momentum from accelerating the player; overlap correction remains geometric. |
| Small overlap and approximate crowd response are acceptable | A tolerance plus fractional correction permits residual penetration across steps. Do not retry until convergence or reject a group for remaining overlap. |
| Walls and effectively immovable entities have priority | Sweep ordinary movement and every separation displacement against the same hard-obstacle query. |
| Reconciliation must not pop displaced bodies | Authority updates a retained reference; bounded return actuation participates in ordinary motion and contact response. |
| Escaping contact should remain possible | Preserve separating/tangent velocity; cancel only closing normal velocity. Existing overlap is not a blanket movement lock. |
| Physical state must remain coherent | Do not retain gravity growth from discarded integration or convert separation distance into launch velocity. |
| Navigation and reporting remain meaningful | Preserve lower-sphere support, upper clearance, stairs/slopes/edge policy, jump/free motion, topology, collision filters, and report lifetimes. |
| Host must remain responsive in debug | Bound timestep/substeps and contact passes, avoid catch-up debt, and query local candidates. Camera queue ownership is a separate concern. |

Residual compression, order bias, dissipative response, gradual propagation through crowds, and simulation slowdown under overload are deliberate concessions. No promise of perfectly separated endpoints, realistic physical response, or collision-free interpolated mobile trajectories is made. Sustained ordinary crowd motion must nevertheless avoid bodies passing through each other or unbounded compression.

## Ground truth and classification

`crates/holtburger-world/src/entity_physics.rs` already derives solidity/reporting separately from integration eligibility (`Eligible`, `Frozen`, `Static`). `supports_local_simulation()` also accounts for unsupported/unknown semantics. `PhysicalBodyDefinition::FixedPosition` is another existing mobility fact. The removed core `entity_pressure.rs` admitted only living grounded characters; that is pressure-specific policy, not a reusable definition of mobility. The protocol `PUSHABLE` bit currently blocks local simulation and must not be reinterpreted as permission for this feature.

Prepare one typed mobility decision where effective physics, body definition, attachment ownership, and simulation capability are joined. Consumers read that decision instead of independently testing raw flags:

| Contact role | Treatment |
| --- | --- |
| Hard obstacle | Resident world geometry and solid nonyielding entities. Authored/root placement may move an obstacle; contact cannot. Preserve hard obstruction with zero contact mobility. |
| Yielding body | Eligible mob/player character with nonfixed geometry and physical state permitting movement. Sleeping does not remove contact mobility. Player receives a lower mobility weight. |
| Nonblocking participation | Preserve reporting-only and suppressed distinctions; no separation merely because geometry overlaps. |

Collision remains pair-dependent: existing directional response, missile/category exclusions, and report recipients cannot be collapsed into one global solid boolean. Separate geometric contact from which participants may receive response. Derive admitted contact-mobility weights only after that policy is applied; do not transfer a forbidden response to a peer implicitly.

Sleeping or zero velocity never makes a body hard. Frozen/fixed bodies are hard only where existing solidity and pair policy make them blockers. An attachment follows its owning body and must not gain independent yielding. Unsupported bodies are not silently admitted as simulated bodies; preserve explicit preparation failures and existing queryable target behavior. Audit corpse, missile, door, attachment, and live state transitions before assigning roles. Airborne motion alone must not remove a mobile character’s contact mobility.

Hard means unresponsive to local contact, not eternally stationary. Door/script/authority-driven hard-pose changes need existing placement/solidification semantics and current query bounds. A hard body appearing already overlapped requires explicit placement/recovery handling; a sweep starting inside it does not prove a valid placement.

## One bounded physical substep

Core admits bounded physical time; world owns the following evolution. Use stable iteration order initially for repeatability, without claiming order independence.

1. **Sample intent and classify bodies.** Capture ordinary movement, impulses, and authoritative reference inputs once. Prepare hard targets and the mobile spatial index. No player preview or pushing admission pass.
2. **Integrate and predict.** Character drive and return select a desired velocity approached with bounded acceleration; they do not bypass response as an additional mandatory displacement. Apply that actuation and gravity using semi-implicit Euler. Sweep predicted displacement against hard obstacles, applying normal stop/slide response. Authored displacement and impulses retain distinct consumption semantics.
3. **Resolve local contacts.** Run a small fixed number of passes over nearby eligible mobile contacts. Recompute each contact from current working poses, apply the correction rule below, and update bounds immediately. Newly created neighbors are discoverable in later passes or the next substep. No recursive neighbor processing or unbounded queue drain.
4. **Refresh support and publish.** Refresh support after corrections, retain response velocity and residual overlap, and publish canonical poses, paths, ownership proofs, reports, reference progress, and command outcomes together. No convergence vote.

A working body array is ordinary mutable simulation state, not a set of speculative trajectories seeking agreement. Contact effects propagate through the fixed passes and subsequent timesteps. A blocked correction remains unapplied; it does not invalidate already accepted movement elsewhere.

### Gameplay response parameters

Contact mobility and movement acceleration are independent gameplay parameters, not a literal mass/inertia model:

- **Contact mobility** is a dimensionless weight controlling a body's share of positional and closing-velocity correction. Higher means it yields more. For illustration, player weight 1 and mob weight 9 allocate 10% and 90% respectively; these are not selected runtime defaults. Hard obstacles have zero mobility.
- **Movement acceleration** limits how quickly actual velocity approaches desired movement velocity. It controls starting and recovery after contacts. It is not calculated from contact mobility, body kilograms, or a force divided by mass.

Overlap correction uses contact mobility. Ordinary bodies also share velocity by that weight, while the local player uses the approved braking-only velocity response: contacts may reduce inward motion but cannot impart outward momentum. No kilograms, rotational inertia tensors, torque solver, or momentum-conservation requirement is introduced. Existing gravity and explicit launch/impulse semantics remain physical inputs. The familiar inverse-mass form of the contact arithmetic is useful, but its weights are authored gameplay policy.

### Position and velocity response

For one eligible mobile pair, let `n` point from B toward A, `d` be penetration, `s` the allowed overlap, and `wA`, `wB` the admitted contact-mobility weights. Correct a fraction of excess penetration:

```text
c = beta * max(d - s, 0)       where 0 < beta <= 1
A requests +(wA / (wA + wB)) * c * n
B requests -(wB / (wA + wB)) * c * n
```

Each requested displacement is clipped by hard-obstacle queries. Do not redistribute a wall-blocked share, search for another body's capacity, or recursively solve its neighbors. Larger penetration produces larger requested correction; the player's smaller share becomes significant over time. Fixed passes and `beta` jointly determine effective stiffness, so tune them together with substep duration. Zero total response weight produces no correction, not a division or a hidden fallback.

Keep positional separation out of retained velocity. Separately remove closing relative normal velocity with a velocity correction distributed by the same mobility weights, initially without bounce; leave separating and tangent velocity alone. For the convention above, closing means `(vA - vB) dot n < 0`. Reapply hard-contact velocity constraints as needed within the fixed passes so mobile response does not leave a body driving into a wall. This is intentionally dissipative and not a general energy-conserving solver. Do not reconstruct velocity from total corrected displacement.

Current grounded actuation is not this contract: `prepare_grounded_body_tick` adds commanded supported velocity to retained velocity, and correction is a separate displacement. Applying contact velocity correction only to the retained part would leave the inward drive untouched every tick. Replace that split for compliant character motion: contact response acts on the actual integration velocity, and the motor can restore it only through bounded acceleration on the next substep. Root-motion sampling supplies desired travel over admitted time, not guaranteed travel added after response. Explicit launches remain impulses. Free/projectile authored behavior must retain its distinct policy.

Refresh contact geometry between passes rather than retaining stale penetration. Establish deterministic normals for coincident centers and avoid duplicate opposing constraints from directional shape queries. A pair can have multiple actual shape contacts; process them with a fixed local bound and a consistent normal/depth convention. Reuse narrow-phase math, not the current trajectory negotiation or held-plan acceptance machinery.

The current directional geometry cannot be treated as a symmetric pair manifold: movement spheres query a peer's BSP or setup fallback volumes, which need not match that peer's movement spheres. **Accepted choice:** use the existing `PhysicalSphereSet` for symmetric mobile response and hard-obstacle clearance. Query unordered sphere pairs once, at most four primitive pairs for two two-sphere bodies. Keep authored target geometry for hard entities and authored directional reporting where required. Do not run both directional sweeps and add their corrections. Mobile collision silhouettes intentionally change; preserving authored target geometry for reporting does not grant it a second physical response path.

### Hard-obstacle movement

Ordinary motion, stair maneuvers, and separation corrections all use one hard-obstacle query covering world geometry and eligible immovable entity targets. Clip correction to safe travel; do not apply an unchecked position offset then hope a later wall projection fixes it. Preserve owner proofs, EnvCell/portal traversal, filters, and contact provenance.

Use bounded stop/slide continuations for ordinary movement. Start with clipping separation at its first inward hard obstruction rather than adding a second correction-specific slide planner. Existing touching support must not report an unconditional zero-time obstruction to horizontal correction: reject only motion entering the contact, allowing tangent/separating motion within the hard-contact tolerance. Otherwise every grounded correction can be stopped by the floor. Use the same rule for hard entity surfaces and add a floor-tangent correction case. Refresh support afterward. This can reduce yielding near corners and is an accepted simplification.

Missing coverage is explicit. A correction that cannot be safely queried stays unapplied; mobile overlap may persist. Ordinary motion cannot attach full-step advanced velocity to a held pre-step pose after a failed query. Define its coherent incomplete outcome at the body boundary, independently of normal residual mobile overlap. Preserve explicit reset/teleport admission rather than hiding missing geometry as an obstacle-free result. Invalid invariants still fail loudly.

### Small steps and mobile crossing

Mobile/mobile collision detection is deliberately non-exhaustive (user approved). Run endpoint overlap response at small fixed substeps; sufficiently fast bodies may cross between checks or enter deep overlap before response begins. Credible crowd resistance and gradual separation are the target, not an impenetrable mobile barrier. Do not cap ordinary velocity by sphere radius, reject otherwise valid launches for collision sampling, add adaptive catch-up steps, or introduce swept mobile-pair negotiation to repair this accepted approximation.

Keep the maximum substep duration and count to bound admitted simulation time and contact work, discarding excess time without a backlog. Keep a cumulative per-body separation allowance of one quarter of the smallest movement-sphere radius per substep: this limits abrupt correction across many neighbors, independently of ordinary speed. Exhaustion leaves residual overlap for later steps. This allowance is not an anti-crossing guarantee.

World geometry and effectively immovable entities remain hard-swept for ordinary travel and corrections. Stair/support maneuvers retain their authored rise/drop limits and zero-duration adjustments without needing a special ordinary-speed exemption. Projectiles retain swept hit detection and authored impact behavior. Longer ordinary paths can visit more hard geometry, so fixed pass counts do not imply constant query cost.

Validate useful resistance and escape at representative walking/crowd inputs, full-speed unobstructed travel, and hard-obstacle integrity. Occasional mobile crossings and deep compression at high speeds are accepted; repeated failures of ordinary crowd resistance still warrant tuning the local response. Teleport/reset ownership remains explicit lifecycle work.

## Locomotion and authority

Keep a focused character controller over the shared movement/contact primitives. The lower sphere supplies support, the upper supplies clearance, a support probe maintains grounding, gravity acts when unsupported, and jump sets explicit launch velocity. Retain content-backed slope and edge distinctions. A stair attempt is bounded up/forward/down travel with clearance checks. Mobile bodies are not walkable supports initially; hard entity solidity alone also does not establish walkability. Preserve support policy/provenance.

Contact correction does not trigger stair climbing or add jump energy. Refresh grounding after correction so pushing a body off an edge produces a fall. Angular movement of offset spheres needs conservative bounds and bounded geometric subdivision; translation-only endpoint checks cannot establish rotational clearance. Ballistic movement shares collision primitives but does not acquire character stair/steering behavior. The zero-bounce choice is for compliant mobile contacts; audit authored environment/projectile response rather than globally deleting restitution semantics.

Remote ordinary motion predicts a reference without local separation. Predict that target cheaply from sampled ordinary intent; do not execute a second collision solve to advance the reference. `PhysicalBodyInput::step` uses arithmetic `predict_reference_motion` for return; it performs no provisional collision solve. An extrapolated reference may lie behind a wall; the actual body's bounded return is constrained by hard geometry and contacts. That is an accepted prediction inaccuracy. A bounded return term moves the physical body toward that reference through normal integration. Incoming authority updates the reference, never snaps a displaced mobile collision body. Return can compete with contacts and may remain blocked. There is no pressure flag keeping a reference alive; displacement/reference completion is owned by reconciliation itself. Player displacement is committed through normal movement/reporting so frontend and server-facing consumers see the same physical result.

### Approved reference, movement, and presentation ownership

The solver owns the reference; animation never receives a correction target or a correction-animation mode. Ordinary movement intent remains distinct from actual movement after return/contact response. This separation applies to reference heading as well as translation: turning the physical body or selecting a visual sidestep must not rotate the reference's authored travel accidentally.

| Fact | Owner and named consumer |
| --- | --- |
| Latest server pose and vectors | Existing `Entity` authority fields; reconciliation/input assembly reads them. Physical publication does not overwrite these facts. |
| Ordinary movement request | Host command/authored-motion evaluation; reference prediction and physical actuation consume it. It excludes solved locomotion presentation and return/contact response. |
| Reference pose | World reconciliation; physical return reads it. It is arithmetic prediction, with no collision body, contact history, or second collision solve. |
| Actual pose and continuation velocity | World physical step; rendering, movement publication, and next physical integration consume them. They never become nominal velocity by default. |
| Supported movement for presentation | World derives it once from accepted timed root travel, excluding zero-time separation/stair adjustments; host locomotion selection consumes its local direction and speed. It is observational, never next-step physical input. |
| Explicit action lifetime and hooks | Existing host motion runtime; action playback and authored effects consume them once. Locomotion may change the successor without restarting the active action. |

**Existing implementation evidence:** `simulation.rs` advances authored playback and applies its physics hooks before solving. `remote_entity_actuation` converts its offset into a drive; `motion/actuation.rs::authored_grounded_actuation` converts exact sampled travel to a velocity request. `motion/registry.rs::BodyMotionRuntime::drive` owns `active_action`, an action queue, and `steady_order`; it preserves a non-cyclic action prefix while replacing its cyclic successor, then processes completion. `state/motion_resolution.rs::reconcile_authored_motion_support` currently reselects only after support changes. The frontend's `dynamic-entity-motion.ts` consumes host-selected clips/rates, not references. ACE `Physics/Animation/Sequence.cs::Update/apply_physics` and retail `acclient.c:306094–306172,324230–324400` establish existing authored movement and action/sequence coupling; they do not prescribe this new presentation policy.

#### Complete tick contract

1. Apply incoming authority and action events in the existing host order. A remote correction replaces the reference, not the displaced physical pose. A dedicated vector update changes nominal input and explicitly replaces physical velocity without manufacturing a position reset; routine position samples change nominal input only after cutover. Teleport/replacement still uses explicit lifecycle admission and clears stale reference/return state.
2. Admit time once. Evaluate ordinary commands and authored movement independently of body-driven presentation. Existing directed commands may deliberately inspect actual position to steer toward a gameplay target; that is command evaluation, not copying actual velocity into nominal prediction. Convert authored local travel using the intended/reference orientation when predicting the reference. Do not let return-facing alter nominal travel. Sample impulses and action hooks once, never per contact pass.
3. For each bounded substep, advance the reference with that nominal input alone. Feed the same ordinary request plus bounded reference-error steering to the actual character motor. Hard sweeps and local contacts act on actual motion. Preserve nominal versus actual input types even when their values happen to match.
4. Commit actual body results once. Derive supported timed movement for presentation at this boundary. Ground/air state has its existing presentation semantics; vertical falling and zero-time contact correction do not become walking speed. The result is an observation and cannot be used to advance the reference or generate additional root movement.
5. Preserve explicit action playback, completion, queue order, and hooks. Otherwise select locomotion from the solved movement in body-local coordinates; at rest use the stance's idle. Reuse sequence selection and existing action priority, not a general priority registry. Publish the selected clip through the existing host/frontend contract. New selection affects subsequent playback; do not rewind/re-advance this tick to make its animation agree retroactively.

Authored movement still needs its ordinary cursor where exact frame offsets matter. A visible locomotion cursor may differ because the body is blocked or returning. Separate the consumers of those cursors rather than cloning the entire action runtime: one owner executes action completion and physical hooks, and visible locomotion cannot emit root actuation or replay those hooks. Presentation sound/footstep effects follow visible playback. Preserve explicit authored action translation as ordinary input once; never add a second copy from its rendered clip. An action-completion tick can contain multiple sequence portions, so movement/effect provenance must be captured during traversal rather than classified afterward from `active_action` at the endpoint.

**Accepted presentation concessions:** a body may slide during an attack, emote, casting, or other explicit action. No skeletal blending or forced turn toward the correction target. Return can appear as backward/sideways locomotion when supported by the existing table; unavailable directions retain an explicitly selected supported presentation and may slide. Do not fabricate missing clips or silently reinterpret an unsupported command. A short delay between movement observation and playback is acceptable. Walking while airborne is not. No promise of foot locking or exact stride matching.

#### Successive-tick analytical gate — pass for scoped character implementation

For supported planar movement, let nominal velocity be `u`, reference be `r`, body position be `x`, actual velocity be `v`, and step duration be `h`. A concrete initial return law is `b = clamp_length(k * (r - x), return_speed)` and `v_next = approach(v, u + b, acceleration * h)` before hard/mobile response. Start with `k = 2 / second`, the existing 1 m/s return-speed limit, and the existing 20 m/s² character acceleration; these are gameplay defaults to validate, not a physics guarantee. Advance `r_next = r + u*h`. Compute error at the same pre-step time for `r` and `x`; do not compare an advanced target against an unadvanced body. Project character steering into supported movement; gravity/launch remain separate.

For a stationary unobstructed target, `u = 0` regardless of prior return velocity, so the motor target is at most 1 m/s. The approach operation cannot create the former accumulating target speed. In the unsaturated near-target region, when the motor can track its target, `e_next = (1-k*h)*e`; with `h <= 1/120`, this contracts without changing sign. Acceleration limits, external impulses, and contacts can cause overshoot; no global monotonicity claim is made. A constant moving nominal input has the same relative-error recurrence when tracking. Retain the reference while braking toward nominal movement: positional proximity alone must not retire return ownership while significant relative velocity remains. Use the ordinary driven motor for that braking, not a hidden instantaneous velocity reset. Completion must check positional and relative-motion tolerances together; initially use the existing 5 cm positional tolerance and a relative-speed tolerance derived as `k * position_tolerance` (0.1 m/s with the proposed gain). A reference outside either tolerance remains live. Before contact displacement can create a new return obligation, preserve the pre-contact nominal reference; never seed it from the already displaced result. Retirement must not snap the body or make subsequent contact-derived velocity nominal.

| Successive-step case | Audit result |
| --- | --- |
| Stationary mob displaced one metre | Reference remains stationary; target return speed stays bounded, tapers near the target, and actual motion brakes. No accumulated reference drift. |
| Walking mob pushed aside | Nominal travel advances the reference independently; actual motion combines that travel and bounded return. Presentation can change speed/direction without changing nominal travel. |
| Server position arrives mid-return | Replace reference; bounded motor changes actual velocity over subsequent steps. No physical snap or unbounded target velocity. A large positional gap may take a long time to close. |
| Repeated packets or changing commands | Each changes external target/intent; animation cannot amplify the change into new ordinary movement. Arbitrarily oscillating authority can still cause oscillating body movement. |
| Attack begins during return | Action takes presentation ownership; return/contact physics continues. Action root input and hooks execute once. Sliding during the action is accepted. |
| Action completes or another action is queued | Existing action owner processes the transition once; locomotion observes current solved movement when eligible. No replay of already-consumed root travel or hooks. |
| Return blocked by player or wall | Actual motion clips/responds; reference does not inherit that response. Error may persist indefinitely without velocity growth from that error. No retry loop or crowd feasibility search. |
| Body pushed off a ledge | Support state selects airborne presentation and normal gravity/launch policy. Do not reuse the supported planar return equation as an undocumented flying motor. |
| Local player or projectile | Local-player authority remains governed by existing autonomy/reset policy, not unconditional return to a stale server pose. Projectiles retain their distinct swept/ballistic policy and receive no walking presentation. |

This passes the reference-feedback and action-priority design audit. It does not certify every producer mapping or complete the new driver. Before production cutover, map unsupported/free/airborne return and vector-only updates explicitly through their existing policies; do not silently extend the grounded character motor to those profiles. Exact presentation direction availability, authored transition provenance, completion/braking behavior, and nominal vector extrapolation belong to the focused implementation/contract checks below, before any broad evidence run. No extra collision solve, recursive processing, or per-contact animation advancement is introduced.

### Publication and motion history

Replace the current prepare/tick-each-body/finish commit protocol with one world-owned collection advance returning results for all changed bodies, including contacted sleepers. `tick_prepared_dynamic_physical_body` validates a captured body then publishes it individually; later pair correction could invalidate that result or be overwritten by a peer's captured state. Finish the fixed local passes in the working array, then publish results once. This is a publication boundary, not a convergence requirement or a crowd acceptance vote. Direct/prediction queries use immutable context and return only their result; they do not mutate live peers. A singleton predictive query may explicitly treat peer poses as frozen and is not a substitute for the production collection step.

`PlacedMotionPath` requires strictly increasing fractions. Corrections at the end of a substep cannot be appended with the same timestamp or disguised as extra physical time. Keep timed integration motion and zero-duration correction segments distinguishable in the result, with one final pose. Hard-geometry traversal/owner updates consume both; collision reports collect actual query touches and finalize directional lifetimes once per collection, not once per relaxation pass. Path consumers must explicitly choose timed motion, geometric traversal, or the final pose. `accepted_motion` currently represents a path derivative: audit rendering/extrapolation and outbound movement consumers so correction does not become future velocity there even if retained velocity is kept clean. Avoid a second pose timeline; these are displacement provenance records for one canonical body.

If hard coverage fails before prediction, retain that body's preceding coherent state and mark it unavailable for further motion this substep. Other bodies can still interact with its last valid queryable geometry. Later failure of an individual correction leaves that correction unapplied; it does not restore earlier poses after they have influenced neighbors. Unexpected invariant errors still surface. All predictable incompleteness must be represented locally before publication, not discovered by a final all-body validator requiring rollback.

## Work, scheduling, and ownership

World retains sole ownership of canonical physical poses, state, and collision semantics; core admits time and orchestrates input; app owns camera/presentation policy. Every new contract field needs one producer and a named consumer. No independent visual shove or second authoritative physics world.

Retain installed world acceleration and place hard-entity geometry once per contact substep. Refresh the small mobile envelope list once per fixed pass, expanding each envelope by its remaining correction allowance; query current working shapes when processing the resulting pairs. Use actual transformed shape bounds; scalar extents must not expand horizontal neighborhoods by upper-body height unnecessarily. Static/hard queries use geometry-local candidate selection and reuse resident topology/acceleration instead of repeated full-mesh scans. Existing Parry geometry tools are available; a general rigid-body dependency is not required.

Work is bounded substeps times fixed contact passes times local candidate/geometry work. Dense actual contacts can still approach quadratic cost. A pass does not rebuild the world, prepare a full environment trajectory for each pair, or iterate until clear. Resting bodies remain in the index with positive contact mobility; touching one activates its local participation without recursively waking a component. Do not repeatedly restore a corrected sleeping body from stale state. Support validity and report lifetimes remain sleep obligations.

Initially cap admitted physical time by the existing core quantum (`PHYSICS_TICK_MS`, currently 30 ms), subdivide within that cap, and discard excess wall time rather than create catch-up debt. Physical root motion uses admitted time; impulses are consumed once, not per pass/substep. Movement-generated effects follow accepted movement, while incoming authority/network deadlines remain external. Distinguish drive sampling, impulse consumption, and incomplete hard-geometry outcomes explicitly.

Camera requests should consume the latest immutable collision query view without waiting for the next physical tick. Keep camera queue decoupling a separate runtime integration item; it is not a prerequisite for designing the contact response and faster contact solving alone does not guarantee queue latency. Avoid copying a mutable scene or building a general job framework.

## Paper scenarios and tradeoffs

| Scenario | Expected evolution over multiple steps |
| --- | --- |
| Player walks into a mob in open space | Both correct; the mob’s higher contact mobility gives it more correction. Continued drive creates continued yielding. |
| Mob approaches idle player | Same contact rule. Player can move slightly; immunity is intentionally removed. |
| Mob is pinned against a wall or hard entity | Its correction is clipped. Residual penetration increases response, including the player's correction. No capacity query or blocked-share redistribution. |
| Several mobs form a crowd | Local contacts transmit displacement over bounded passes and future steps. Compression and order bias remain. |
| Player backs away from overlap | Separating intent is allowed; response does not cancel it. |
| Server reference lies inside/beyond the player | Bounded return enters ordinary contacts, which may displace both bodies or keep return incomplete. No snap. |
| Body is moved off a ledge | Correction respects hard geometry; refreshed support allows gravity to act next step. |
| Sleeping mob is contacted | It participates with its contact mobility and corrected canonical state; no recursive component wake. |
| Geometry unavailable | Explicit local incomplete movement/correction, not a claim of empty space and not a crowd rollback. |

A corner is not mathematically guaranteed to stop arbitrary drive with finite correction passes. The accepted approximation must reach tolerable bounded compression under supported movement inputs, rather than repeatedly cross body centers. A simple pinned-pair calculation sizes this risk before tuning: if the player receives fraction `q` of pair correction, `K` passes leave approximately `rho = (1 - beta*q)^K` of excess penetration. With fixed inward travel `u*h` each substep and the mob fully pinned, end-of-step excess tends toward `rho*u*h/(1-rho)` in the simplified one-dimensional case. Very low player contact mobility makes `q` small and can therefore permit large compression. This calculation ignores the contact velocity correction, bounded motor, other contacts, and correction-travel limits; it is a parameter sanity check, not a stability proof. If saturated cumulative correction cannot oppose admitted inward travel, compression can keep growing. Select motor response and correction capacity for representative crowd movement consistently rather than relying on penetration strength alone. Tune movement acceleration, drive speed, step size, mobility ratio, correction fraction, and tolerance together. Do not promise stability merely because deeper overlap yields stronger correction.

## Implementation phases

Analytical gates are engineering decisions, not automatic user-approval requests. Record each outcome here as **pass**, **revise**, or **reject**, with assumptions, reasoning, and remaining uncertainties. A pass permits the next authorized phase; revise requires correcting the design and repeating the affected analysis; reject retires the approach. Do not use a protracted evidence run to resolve a contradiction already apparent from the equations, contracts, or work structure. The preceding dry run is input to these gates, not a completed gate verdict.

### 1. Contracts and content mapping

- [x] Replace the ordered pushing design with compliant contacts and positive player contact mobility; record the relaxed requirements.
- [x] Identify existing integration/solidity/body-definition facts and the misleading protocol `PUSHABLE` shortcut.
- [x] Select symmetric response geometry: existing movement spheres for mobile response and hard clearance, with the user accepting the silhouette concession.
- [x] Define prepared mobility and pair-response contracts in world `entity_physics.rs`/`spatial/physical_body.rs`/`scene.rs`; map producer profiles in core. Audit doors, frozen/fixed bodies, attachments, corpses, missiles, sleep, and classification changes.
- [x] Map ordinary, direct/prediction, collection, precise-jump, authored effects, and reconciliation consumers to admitted substep/result ownership. Select initial numeric constants and cumulative correction bounds without adding new modes. Replace bypassed kinematic character drive with bounded motor response; map timed motion versus correction segments and all accepted-motion consumers.

Acceptance: every physical body/query consumer has an explicit role and input/outcome path; mobility is independent of current motion and is not re-derived by consumers. Unsupported states remain explicit.

### 2. Pre-implementation analytical feasibility gate

**Current verdict: pass for focused implementation under the envelope below.** This is structural feasibility, not proof of arbitrary-crowd stability or debug timing. The implementation conformance gate must reject any return to full-mesh scans per pair, unbounded contact work, or correction-derived momentum.

Complete this gate after paper contract/content mapping and before implementing the replacement solver. Phase 1 defines contracts and proposed constants on paper; it does not authorize speculative solver construction.

- [x] **Correction capacity:** use proposed mobility weights, motor acceleration/speed, timestep, correction fraction/pass count, and cumulative travel caps to bound the pinned-pair recurrence. State the supported penetration envelope and check useful resistance under representative sustained motor input; high-speed crossings remain accepted. Include a crowded corner where multiple contacts share the correction allowance; do not generalize the isolated-pair result into a crowd proof.
- [x] **Stability:** examine closing-velocity cancellation, motor recovery, positional correction, hard-contact clipping, and gravity together. Identify which operations dissipate motion or inject it. Rule out obvious velocity growth, oscillatory feedback, and inconsistent held-position/advanced-velocity states. State what this local analysis cannot prove about arbitrary crowds.
- [x] **Work bounds:** count admitted substeps, fixed passes, candidate contacts, shape pairs, and hard sweeps per correction, including support/rotation queries, reporting, and index updates. Instantiate the operation count for the known 40–50-body dungeon distribution and a conservative dense case. Reject full-scene work nested inside pair loops or other obvious multiplication; operation counts establish structural feasibility, not a measured millisecond guarantee.
- [x] **Locality:** walk prediction, clipped corrections, sleeping contacts, missing coverage, and publication through the proposed contracts. No case may require convergence, recursive propagation, or undoing another body's accepted progress. Leaving residual overlap must remain representable without a failure transaction.
- [x] **Geometry and state:** verify symmetric response-shape coverage, floor-tangent correction, hard-entity lifecycle admission, cumulative correction bounds, support refresh, timed motion versus correction traversal, and reporting/authority ownership. Identify exact unsupported shapes or cases and an explicit scope decision; do not defer a missing contract to tuning.
- [x] Record the verdict, supported assumptions/parameter envelope, and only the numerical or content uncertainties that need a focused implementation check. Each proposed check needs a specific question and a decision its outcome can change.

Acceptance: **pass** on structural feasibility with explicit limitations. A contradiction or unresolved essential contract produces **revise** or **reject**, not permission to start a crowd benchmark. Passing does not claim global stability or authorize work outside the user's current task.

#### Current analytical findings and accepted decisions

**Contract mapping progress.** The current sources establish these replacement boundaries; the phase-1 checkboxes remain open until geometry and all consumer contracts are settled:

| Current owner/path | Required replacement contract |
| --- | --- |
| Core `resolve_setup_physical_spheres` / world `PhysicalBodyDefinition` | At most two authored movement spheres (or explicit dummy), with lower-sphere support and upper clearance. Their swept volume defines existing wall-navigation clearance. |
| Content `CollisionShape` / world `PreparedEntityTargetGeometry` | A different target shape selected from part BSPs, setup cylinders, or setup balls. This is not generally the movement-sphere union. |
| World `prepare_grounded_body_tick` | Motor-adjusted actual velocity rather than adding mandatory supported drive after response. |
| World `PhysicalBodyInput::step` | Shared cheap reference prediction and bounded return for collection and direct transactions. |
| World `tick_prepared_dynamic_physical_body` / `publish_physical_body_commit` | Collection-owned working state followed by publication of all changed bodies; no captured peer state overwriting contact correction. |
| `PlacedMotionPath` / `accepted_motion` | Distinguish physical-time motion from correction traversal; neither extrapolation nor retained velocity may turn correction into a launch. |
| Core simulation / runtime | One-shot input ownership across substeps, coherent final results, and camera servicing independent of the next simulation completion. |

**Major geometry gap.** The proposed use of authored target balls/cylinders for symmetric mobile response does not establish hard-obstacle integrity if correction clearance still sweeps only the existing movement spheres. A target cylinder or BSP can extend outside those spheres. In that configuration, a successful movement-sphere sweep proves clearance of the spheres only, not of the body shape being separated. This is a contract mismatch, not a numerical issue a longer benchmark can settle. Using the full target shape for clearance instead changes stair/corridor navigation and can introduce complex BSP sweeps.

The source distinction is explicit in `core/src/physical_body_definition.rs::resolve_setup_physical_spheres`, `content/src/object_collision.rs`, and `world/src/spatial/dynamic_body.rs::PreparedEntityTargetGeometry`. Retail references `SPHEREPATH::init_sphere` (`acclient.c:302241`) and `CPhysicsObj::find_obj_collisions` (`acclient.c:304684` onward) were re-read for this gate. They support preserving the two representations as source facts, not pretending they are equivalent.

**Accepted decision:** the user agreed to using each mobile body's existing movement-sphere set for symmetric mobile separation and hard-obstacle clearance. Authored target geometry remains for hard entities and reporting where required. This avoids a new hull/BSP solver and preserves existing wall/stair clearance shapes. The user accepts the changed mobile–mobile silhouette and the narrower regions between movement spheres. No capsule replacement is planned. The shape coverage is structural: `resolve_setup_physical_spheres` selects at most two ordinary spheres, with an explicit dummy for empty setups; `PhysicalSphereSet` admits one primary and one optional upper constraint, and free-sphere profiles require one sphere. Thus every already-admitted moving body has representable response geometry without classifying a mobile BSP body as hard merely because its authored target branch is complex. Actual silhouette differences by asset remain a compatibility census task for the cutover, not a reason to retain the rejected shape mismatch.

**Illustrative correction-capacity calculation, not selected defaults.** For a one-dimensional pinned pair with player correction fraction 0.1, four passes, correction fraction 0.5, substep 0.01 s, and motor acceleration 20 m/s², sequential closing-velocity response against a wall-restored mob leaves velocity factor `rho_v = 0.9^4 = 0.6561`. Position correction leaves `rho_p = 0.95^4 = 0.814506`. In the unsaturated accelerating regime, pre-contact speed tends to `a*h/(1-rho_v) = 0.581564 m/s` and end-step excess penetration to `rho_p*a*h*h/((1-rho_v)*(1-rho_p)) = 0.025537 m`, plus tolerance. This shows a feasible isolated local balance under these assumptions; it neither selects gameplay values nor proves a crowd bound. A motor speed cap, correction travel saturation, or competing contacts changes the recurrence and must be included in the final envelope.

**Work arithmetic, not a timing result.** With 45 bodies, three substeps, four passes, one effective positional contact per pair/pass, and two motion spheres per body, a degree-six illustration has 135 pairs and up to `3*4*135*2*2 = 6480` correction-sphere casts before ordinary movement, support, reports, or shape narrow phase. Degree six is a hypothetical neighborhood, not a measured census. All 45 overlapping gives 990 pairs and 47,520 casts under the same one-contact assumption; multiple shape contacts multiply this further. These are query counts, not proof of meeting or missing 30 ms. They make owner-local candidate acceleration and an explicit contact-count contract prerequisites; wrapping current full-mesh scans in this loop is not an acceptable implementation. The chosen sphere policy would bound primitive pairs at four, but the manifold/correction application count must still be specified without hiding repeated casts.

No runtime experiment was run for these findings. The implementation envelope below resolves the numerical starting points and bounded contact count. The gate verdict includes local-operation reasoning and explicit integration obligations; it is not based solely on isolated-pair arithmetic.

#### Implementation envelope and analytical verdict

Initial implementation values are gameplay starting points: maximum substep 1/120 s, at most four substeps for the admitted 30 ms interval, four local passes, correction fraction 0.5, player mobility 1 versus ordinary mobile mobility 4, and character acceleration 20 m/s². Pair overlap tolerance is the smaller of 5 mm and 1% of the summed sphere radii. Keep these as named runtime constants, consumed by the solver and behavior tests. Cumulative separation travel has an allowance of one quarter of the smallest movement-sphere radius per substep. Ordinary velocity has no collision-derived cap. Fast mobile crossings and deeper initial penetration are accepted; hard geometry remains swept.

- **Capacity:** the pinned-pair recurrence with these values gives `rho_v = 0.8^4 = 0.4096`, `rho_p = 0.9^4 = 0.6561`, and unsaturated excess about 4.49 mm, plus tolerance. This is substantially less compression than the earlier illustrative 1:9 ratio. In a corner, each pair applies only its local share and consumes a common per-body correction allowance; opposed corrections may cancel and crowd compression is accepted. No arbitrary-density compression bound is claimed. The allowed envelope is ordinary initial placement, modest residual overlap, bounded drive, and no center-crossing/deep compression under the explicit sustained-crowd acceptance cases. Deep/reset-created overlap remains a placement problem, not a promise of the recurrence. If crowded fixtures exceed that envelope, revise numeric response or supported limits before integration; never add convergence retries to pass them.
- **Velocity stability:** for reciprocal contacts with positive mobility `w`, cancelling closing normal relative velocity reduces the quadratic quantity `sum(|v|²/(2*w))` by `closing_speed²/(2*(wA+wB))`. This is a mathematical non-amplification check, not physical mass semantics. Static normal projection also removes velocity magnitude; motors and gravity are explicit bounded sources. Positional correction never enters this velocity calculation. One-way response filters are kinematic boundaries, so do not claim that reciprocal inequality for them; their imposed motion can transfer velocity, so assess those policies independently rather than claiming a global energy bound. Changing contact normals across a crowd can leave residual motion, but no single reciprocal velocity operation amplifies that quantity.
- **Contact/work count:** evaluate at most four sphere distances for an unordered body pair and select its deepest effective contact once per pass (stable sphere-order tie break). Apply one positional correction and one closing-velocity response for that pair. Other sphere contacts may be selected in later passes; incomplete separation is accepted. This makes the earlier one-contact cast count an actual contract rather than an assumption: at four substeps, 45 bodies with hypothetical degree six admit at most 8640 correction-sphere casts; the all-overlap illustration admits 63,360. Skip zero corrections. These counts remain material: hard queries must select local owner geometry, not scan complete polygon collections per cast. A bounded loop over real neighbors is credible; its debug cost remains a conformance/acceptance measurement, not an analytical claim.
- **Locality:** corrections consume per-body allowances in stable pair order, update the working pose/index immediately, and never queue newly found neighbors recursively. Contact-created neighbors are found by bounded later scans. Sleeping bodies receive a working state and publish if changed; they do not get a second integration interval. Hard-query incompleteness suppresses only the movement not yet applied. No final contact validator can roll back the collection for residual overlap.
- **Geometry/state:** approved movement spheres cover all admitted mobile body definitions, including the explicit dummy; hard target BSP/volume geometry remains authored. Floor-tangent movement uses inward-contact tests. Final support is queried after correction; mobile contacts do not supply support. Timed movement and correction traversal have separate provenance and one final pose. `SpatialBody::runtime_view` and `spatial_sample` currently export `accepted_motion.velocity`, so the new publication contract exports the post-response continuation velocity there; observed correction displacement must not be divided by timestep and fed to presentation extrapolation. Sweep/traversal reports aggregate touches across the step and finalize lifetimes once. Core consumes results for all changed bodies, including sleepers, before deriving presentation/support events. Existing lifecycle/unsupported-state policy remains explicit rather than silently assigning simulated mobility.

**Pass scope and remaining questions:** the structure is implementable without a coupled crowd solve. Focused implementation checks now answer: does deepest-contact selection alternate pathologically; do floor/corner corrections stall or overcompress; do representative crowd inputs retain useful resistance and escape within the correction budget; and do zero-duration correction segments preserve topology/reporting without adding velocity? The conformance gate decides whether those answers permit production integration. Body classification and input contract mapping are sufficient to begin the hard-query/contact primitive; the phase-1 checkboxes remain open for the final code-level lifecycle/profile and authored-effect audit before cutover. Passing this gate does not mark those integration obligations complete.

### 3. Hard-obstacle primitive and local contact step

- [x] Add `CollisionScene::sweep_hard_sphere` over resident world geometry and caller-admitted hard-entity shape candidates, retaining world/entity impact provenance. Share the placed-shape narrow phase with ordinary static sweeps.
- [x] Connect prepared body mobility, pair filters, hard-target candidate selection, and report/placement consumers to the common sweep boundary.
- [x] Implement the stateless movement-sphere pair response in `spatial/mobile_contact.rs`: one deepest effective contact, mobility-weighted displacement, independent closing-velocity cancellation, and deterministic coincident-center handling.
- [x] Apply pair response to current working poses through hard-obstacle sweeps and cumulative travel limits in the fixed-pass relaxation loop.
- [x] Integrate once-sampled force and support-plane motor inputs into actual velocity before bounded ordinary translation and mobile response.
- [x] Connect response-owned support/gravity policy, launch admission, and authored/reference prediction to that input boundary. Reuse geometry from grounded/free code; replace incompatible trajectory/acceptance orchestration.
- [x] Separate projectile swept-impact participation from compliant crowd response, preserving speed and authored impact consequences; revise the affected analytical work bounds before conformance approval.
- [x] Discover mobile contacts from occupied movement-sphere bounds expanded by remaining correction travel, refreshed each fixed pass; include resting mobile bodies. The local sweep-and-prune list replaces the originally proposed second incrementally maintained index.
- [x] Add asset-free multi-step cases: free yielding, unequal contact mobility, incoming mob, pinned wall and hard entity, crowd corner, escape, no launch from overlap, full-speed unobstructed motion, many-contact cumulative correction travel, floor-tangent correction, coincident centers, unequal authored shapes, and missing coverage. Assert useful progress and bounded compression/velocity rather than zero residual overlap.

Progress: seven focused contact-primitive tests pass (relative normal cancellation and mobility bias, separating motion without launch, tolerance, an immovable recipient, coincident centers, deepest-contact selection, and reciprocal velocity non-amplification). World library and test-target Clippy pass with warnings denied; formatting and diff checks pass. Cargo separately reports the existing dependency future-incompatibility notice for `binrw 0.15.1`; no dependency change was made. They exercise no collection, hard geometry, support, or frame budget and do not pass the implementation conformance gate. `ContactMobility` stores normalized weights (player 0.25, mobile 1), equivalent to the planned 1:4 ratio. All tuning constants are named runtime definitions. The primitive is exposed alongside existing world solve APIs for the forthcoming collection/harness consumers; narrow exports at cutover if those consumers need less surface.

Hard-query progress: static sweeps now use existing terrain-grid selection and BSP leaf-bound candidate traversal rather than exhaustive selected-owner polygon scans. Shared polygon IDs are deduplicated before casts. The combined query accepts prepared hard-entity candidates in the request frame; classification and dynamic indexing remain caller integration work. Corrected Parry volume-hit normals to use the target's outward normal in world orientation. A cylinder-cap tangency fixture exposed a tilted zero-time cast normal; analytic initial volume contacts now admit tangent/separating movement and block inward movement before requesting a future cast. Cylinder initial contact uses the true closest point outside the solid, preserving rounded sweep rims; inside it, the existing nearest-exit rule is reused.

Validation after the hard-query change: seven sweep tests pass, including nearest hard entity versus world provenance, volume normal direction, and tangent/separating/inward movement on a cylinder cap. All 616 world library tests pass; warning-denied test-target Clippy, formatting, and diff checks pass. No crowd benchmark or live session was run. This validates the query boundary, not the new collection algorithm or debug budget.

Participation progress: `PreparedBodyContact::from_body` now samples a typed hard/mobile role, common-frame movement spheres, gameplay mobility, target demand, directional collision policy, and collision-domain membership from installed physics. Settled bodies remain mobile, integration-excluded/fixed bodies are hard, and suspended/unprepared bodies are absent. Preparation requires the scene to refresh residency first; activity is not treated as a substitute for owner proof. Pair response masks only forbidden recipients and rejects self-pairs and disconnected EnvCells. Hard candidates use the same directional policy but retain their authored shapes. Extracted `EntityDynamicCollisionPolicy::accepts_response_from` so old and new consumers share semantic response admission rather than maintaining independent bit tests.

Validation: all 618 world library tests pass, including installed-state cases for sleeping versus excluded participation, player/mobile bias, suspended exclusion, one-way response, and disconnected EnvCells. Warning-denied test-target Clippy, formatting, and diff checks pass. These validate participation preparation; the contact loop and production cutover remain unfinished.

Bounded-loop progress: `advance_body_contacts` now runs exactly the configured local passes on prepared working bodies. A sweep-and-prune list uses actual movement-sphere extents plus remaining correction travel, then processes pairs in stable identity order against current working poses. Each body has one cumulative correction allowance. Hard shapes are placed once per substep and cheaply culled before shared hard sweeps. Missing coverage stops only that body's further correction; other accepted changes remain. Results contain final displacement, continuation velocity, membership, and ordered zero-duration correction traversals. Mobile working state is a separate type from hard state; no assertions are used to reinterpret a hard participant as mobile.

Resteer: refresh cheap mobile envelopes per pass instead of incrementally maintaining another scene index. This costs bounded `K*N*log(N)` sorting plus candidate comparisons and avoids repeated geometry preparation or a dependency graph. New neighbors caused by correction are conservatively covered by remaining-travel envelopes and later passes. It is an implementation choice for the known small active population, not permission to scan full world geometry in pair loops.

The hard sweep now returns its already-computed attempted traversal with the earliest hit, and accepts hard-candidate domain membership. Domain admission uses all domains reached during the attempt, not only the starting cell; otherwise a hard entity beyond a doorway could be missed. Corrections retain only the admitted prefix of the primary path (with either sphere allowed to supply the blocker). This reuses topology facts rather than tracing the same accepted correction again. The existing `PlacedMotionPath::interval` helper remains useful geometry functionality and must survive driver cleanup with source-neutral documentation.

Validation: two additional focused multi-step tests pass: open versus hard-pinned separation along a floor without launching either body, and preservation of another body's progress when one correction reaches unavailable coverage. The latter initially used a fixture that installed neighboring owners; corrected the fixture to actually omit that coverage before drawing conclusions. All 620 world library tests, warning-denied test-target Clippy, formatting, and diff checks pass. No broad workload or live session was run.

Ordinary-movement progress: `advance_body_contacts` now applies shape-limited integration velocity through at most three hard stop/slide passes before the four mobile-contact passes. Both stages share movement-sphere sweeping and accepted topology-prefix handling, and hard target shapes remain prepared once per substep. Speed limiting applies even without mobile neighbors. Ordinary travel cannot exceed initial admitted speed times duration because each projection only decreases speed and each continuation consumes the remaining duration. The correction allowance remains independent. Every accepted prefix survives exhaustion of the slide-pass budget; unspent time is stationary and is not queued for catch-up. Missing ordinary coverage retains prior accepted travel but sets continuation velocity to zero, an explicit conservative local stop that prevents held-pose gravity accumulation.

`ContactBodyUpdate` carries total accepted translation, continuation velocity, final membership, and one ordered sequence of accepted motion segments. `ContactMotionSegment::Travel` records each ordinary segment’s admitted start/end fractions; geometric path fractions are not used to infer correction duration. No production caller uses this API yet. Focused tests cover floor-tangent sliding along a hard entity and unopposed full velocity versus unavailable ordinary coverage (updated after the non-exhaustive-contact concession); both pass. Hard-hit report aggregation, angular clearance, stair/support handling, response-owned force/motor adapters, and final core consumers remain integration work. The three hard slide passes add at most six ordinary sphere sweeps per two-sphere body/substep to the earlier correction-query count; there is no new pair-nested loop.

Validation after ordinary translation: all 623 world library tests and warning-denied test-target Clippy pass; formatting and diff checks pass. The complete suite still includes the existing production solver, so its result is not evidence of production cutover. No broad benchmark or live session was run.

Additional focused validation: a compressed nine-body grid exhausts correction allowances while checking the sum of accepted correction-path lengths, rather than only net displacement. All bodies remain within their cumulative substep allowance (allowing coordinate-rounding error), and correction does not create velocity. This passes the many-contact travel-bound check; it does not establish corner escape or driven-crowd behavior.

Still open before the implementation conformance gate: supported-speed crossing and dense corner cases, integration velocity behavior when correction travel is exhausted, grounded/rotation behavior, projectile policy, and response-owned input adapters. The new loop samples supplied force/motor inputs once per mobile body and integrates them before bounded hard movement and mobile relaxation; support/gravity policy, authority-reference prediction, and one-shot launch admission still require their production owners. Do not label it a completed physics tick or wire it after the old crowd solver as a permanent second response layer.

Motor progress: `ContactStepActuation` carries response-owned acceleration and an optional validated support-plane velocity target. `advance_body_contacts` samples this input once per mobile body/substep and applies bounded tangent-velocity recovery using the named movement-acceleration constant, then acceleration, before ordinary movement. The motor acts on the same velocity modified by contacts; it supplies no additional geometric displacement. There is no motor on the ballistic input. Support eligibility and gravity suppression remain decisions of the forthcoming locomotion adapter; one-shot launches must be admitted into incoming working velocity exactly once before invoking this step. This is not permission to pre-mutate canonical bodies before coverage admission.

Focused motor checks: a support-plane case verifies bounded recovery without changing normal velocity. A 128-substep driven player/pinned-mob case keeps the mob against a hard entity, retains bounded compression, and leaves the player's actual velocity below its desired speed. Input-call counting verifies two mobile inputs per substep, with no repeated force input during contact passes and no input for the hard participant. These are local numerical checks, not a general crowded-corner result. The unavailable-coverage fixture now supplies downward acceleration so a held result also checks that force-advanced velocity is discarded.

Validation after motor integration: all 625 world library tests and warning-denied test-target Clippy pass; formatting and diff checks pass. No broad benchmark or live session was run.

**Projectile mapping audit and implemented resteer:** the uniform small-body speed cap and mobile endpoint response are not a complete projectile contract. ACE `Source/ACE.Server/WorldObjects/Creature_Missile.cs:208-230` supplies a default projectile speed of 20 m/s, with weapon/fast-missile modifiers. At the nominal 1/120 s step, the proposed cap is `30 * minimum_radius` m/s, so any admitted radius below about 0.667 m cannot retain even that default speed (the threshold is 0.6 m for four equal 7.5 ms substeps). This is a conditional bound from source-backed speed and supported shape sizes, not a census claiming particular arrow radii. World `resolve_effective_entity_physics_state` does not classify `MISSILE` as unsupported; core `dynamic_entity.rs` builds grounded movement from nonempty authored spheres. Thus selecting a grounded definition does not identify a character motor or exempt projectiles automatically. Existing `dynamic_contact.rs::pair_is_filtered` also makes projectile response directional, and `contact_response` clears `MISSILE`, `ALIGN_PATH`, and `PATH_CLIPPED` on impact.

The character-contact feasibility result remains scoped; the projectile portion was revised as described below. Preserve the existing projectile semantic distinction: map projectile ordinary travel and one-way swept impacts separately from compliant crowd response, reuse the hard/query primitives, and retain authored impact-state/report consequences. Do not slow projectiles to make endpoint overlap work, drop impact reports, classify them as hard crowd obstacles, or reinstate the old crowd driver to handle them. Complete this mapping and its work-count review before claiming the implementation conformance gate passes. No long evidence run is needed to establish this contract gap.

Projectile progress: `PreparedContactRole::Projectile` now retains movement spheres and authored restitution without entering compliant pair relaxation or the radius-based ordinary speed cap. Its force input must be ballistic, so a grounded shape definition cannot accidentally grant it a surface motor. After crowd movement, the step places authored mobile-target shapes once at their accepted end poses (only when projectiles exist), combines them with hard targets, and performs one one-way movement-sphere sweep per projectile. The first impact clips travel and applies the shared `physical_body.rs::impact_velocity` restitution primitive. `ContactBodyUpdate::projectile_impact` retains world/entity identity and contact geometry for the pending publication/report adapter; no production state bits are cleared by this standalone step yet. Targets receive no reciprocal projectile displacement or velocity.

**Approximation:** projectile queries freeze targets at the end of the small substep. A fast transverse target can therefore be missed or contacted at an approximate time. This deliberately avoids reintroducing moving-trajectory negotiation. The focused hit check establishes swept contact with a small stationary target, not general two-moving-body CCD. Projectile state retirement and report lifecycle integration remain mandatory before cutover.

**Affected analytical review: pass for focused implementation.** For P projectiles, ordinary projectile travel adds at most two sphere sweeps per projectile/substep, independent of the four crowd contact passes. Mobile authored target shapes are placed once per substep when needed, not per projectile/pair query. Candidate bounds and the existing owner-local narrow phase remain in use. There are no projectile-versus-projectile constraints, recursive wakeups, or crowd retries. Authored speed is preserved; long flight paths may naturally reach additional collision owners. Remaining uncertainties concern moving-target approximation, lifecycle/report publication, and actual debug cost, not whether small-radius speed clipping can preserve projectile speed.

Focused projectile validation: a radius-0.05 m, 50 m/s fixture preserves full unopposed travel and detects an intervening small mobile target that endpoint overlap would miss. It returns the target impact, stops under inelastic response, and leaves the target unmoved. The accepted motion segment ends at impact time; positional correction is absent. This uses an asset-free admitted shape and the existing fast-projectile test envelope, not a claim about every live projectile asset.

Validation after projectile separation: all 626 world library tests and warning-denied test-target Clippy pass; formatting and diff checks pass. No broad benchmark or live session was run.

**Historical grounded integration audit — ordinary cap subsequently removed.** The blanket radius-relative travel bound conflicts with preserving the existing discrete stair maneuver. `core/src/physical_body_definition.rs:146-151` gives the player two radius-0.48 m spheres, so the new quarter-radius allowance is 0.12 m per physical substep. The same profile configures `step_up_height = 0.6` and `step_down_height = 1.5` (`:115-125`). `world/src/spatial/grounded.rs::step_up_candidate` raises the candidate and settles onto higher support in the same accepted maneuver; `multistep_staircase_reaches_and_crosses_its_top_support` uses 0.3 m risers. Such an accepted height change already exceeds the new allowance before counting horizontal travel. Merely passing existing stair helpers through the new cap cannot preserve that behavior. Splitting the lift over future frames would require different support/motor semantics or retained stair progress; that is not a routine adapter change.

Accepted concession (user approved): keep a single bounded stair/support maneuver, with its vertical rise/drop governed by the existing stair limits rather than the ordinary quarter-radius travel allowance. Sweep all maneuver segments against hard world/entity geometry; keep mobile separation capped (the later non-exhaustive-contact concession removes the ordinary motor travel cap); never convert stair lift or settle into retained velocity. Run the fixed mobile-contact passes at the accepted stair pose, without recursive crowd solving or additional convergence work. This preserves stair traversal and simple control flow, but weakens the mobile anti-crossing approximation during the larger vertical maneuver: a mobile body intersected only between endpoints could be missed. A dedicated focused staircase-with-mobile-obstruction case must assess that concession before conformance approval; no claim of general mobile CCD is made.

Alternative: retain the strict travel bound and change stair behavior, accepting smaller traversable steps or designing gradual stepping. The former weakens the stated locomotion-preservation requirement; the latter adds state/control behavior and needs its own analytical review. The user selected the bounded stair/support exception, preserving existing rise/drop limits. This resolves the policy gap and authorizes focused grounded implementation; the staircase-with-mobile-obstruction check and final implementation conformance gate remain pending. No live/benchmark run is needed to select the policy.

Stair-exception implementation preparation: replaced the two independent ordinary/correction result lists with one ordered `ContactMotionSegment` sequence. `Travel` carries a physical start/end interval; `Adjustment` carries a single physical instant and its geometric placement proof. This can represent lift → forward travel → settle → crowd correction without sorting or reconstructing the application order later. All existing movement and correction producers now emit that contract, and the driven pinned-body fixture checks contiguous geometric endpoints, nondecreasing physical time, and agreement with total accepted displacement. That contract now carries the bounded stair-up maneuver described below; general support refresh and step-down follow below.

Validation after the ordered-motion contract: 31 contact-filtered world tests pass, the strengthened driven-body timeline check passes, and warning-denied test-target Clippy, formatting, and diff checks pass. No broad benchmark or live session was run.

Stair-up progress: `mobile_contact/step/stairs.rs` now attempts one bounded lift/forward/settle alternative for a grounded definition's blocked ordinary movement. It proves current footing with the existing authored support query, sweeps both movement spheres upward (respecting ceiling clearance), requires a clear forward segment, and traces a bounded lowering route. The selected authored support must occur before any hard obstruction on that route and stay within the configured rise limit. Accepted prefixes supply geometry and ownership without a second trace. Only the complete candidate is applied; its lift and settle are zero-time adjustments around timed forward travel. The movement velocity is projected against the selected support normal; geometric rise is never divided by time. Crowd relaxation then uses the accepted endpoint and its separate correction allowance.

A failed candidate falls back to the ordinary sweep already proved for this body. Missing coverage on only the optional stair route declines that route; unexpected query errors still propagate. There is no partial lifted pose, persistent stair progress, recursive retry, or peer rollback. The stair attempt adds at most three two-sphere sweeps and one support probe, reusing the initial footing query described below. Ground/launch policy adapters and edge handling remain open. Support remains sourced from resident world products as in the existing grounded contract; hard entities obstruct every segment but do not become a new entity-support system in this change.

Focused stair validation: an asset-free authored cylinder step 0.3 m high is crossed using the approved radius-budget exception, without launching the body. A low ceiling rejects the climb through upper-sphere clearance. Repeating ordinary motion after the successful climb initially revealed a cylinder-rim cast normal that tilted by a small amount and introduced about 0.0076 m/s upward velocity. The static sweep now uses the cylinder cap's separating half-space to admit paths already at cap clearance and moving tangent/away; actual inward approaches and below-cap rim casts still use collision response. The focused stair fixture passes after that geometric correction. A BSP staircase/crowd-obstruction case remains required; the cylinder fixture does not stand in for that broader acceptance.

Validation after stair-up: all 627 world library tests and warning-denied test-target Clippy pass; formatting and diff checks pass. No broad benchmark or live session was run.

Grounded support/step-down progress: prepared mobile admission now retains the grounded configuration as an explicit role field. Each grounded substep validates retained support (querying when absent, stale, or leaving its plane), supplies that fact to the force/motor callback, advances ordinary movement, then performs one bounded hard-swept settle using the existing walking/landing drop and slope policies. Stair-up and ordinary settle share the same support-selection and clearance routine. After contact changes the pose, a final support query classifies it without applying another settle. An unchanged pose retains support proved by its ordinary stair/settle transaction. This ordering preserves a contact push off a ledge: the final pose is airborne and gravity acts on the next substep. Results carry final `GroundState` for publication; free bodies and projectiles remain airborne. Missing optional settle coverage declines only that adjustment; unexpected errors propagate.

The extended cylinder fixture now crosses the whole platform and descends, with no vertical velocity invented by either stair adjustment. It uncovered two geometric admission defects: the cap half-space check must precede initial-contact normal selection as well as future casts, and support broad-phase bounds must independently cover horizontal radius and vertical settle reach. The previous Euclidean sphere/box filter rejected authored cylinder-rim support that the narrow phase explicitly accepts (`volume_query.rs::cylinder_support`, retail citation already attached there). The shared support query now uses conservative axis intervals. A separate two-step fixture verifies that mobile correction pushes a supported player off the rim without snapping downward, then the next callback observes airborne state and applies gravity.

Query accounting: a grounded substep adds at most two support probes (initial and final when invalidated), plus at most one ordinary settle with one two-sphere downward sweep, one support probe, and an optional two-sphere upward recovery sweep. A stair attempt adds the work stated above, outside the pair loop. Ordinary settle now belongs to the ordinary-motion routine: a completed stair returns with its already-proved settle, avoiding the duplicate endpoint sweep without adding state. No claim of a timing bound follows from these fixed query counts. Production actuation adapters, edge policy, launch handling, final publication, and the BSP/crowd stair case remain pending.

Validation after support/step-down: all 628 world library tests pass, including the extended ascent/descent/ceiling fixture and pushed-off-support scenario. Warning-denied test-target Clippy, formatting, and diff checks pass. No broad benchmark or live session was run.

Conformance progress: moved the new step's focused scenarios out of the large mixed legacy test module into `scene/physical_body_tests/contact_step_tests.rs`. Added modest-step head-on travel with equal and unequal sphere radii, followed by reversing motors to prove escape. Added three bodies driven into two perpendicular authored BSP walls for 360 substeps, followed by 120 substeps of player reversal while the remaining motors continue pressing. These scenarios preserve center order, stay within the stated quarter-radius compression allowance, avoid vertical velocity creation, and release the player.

The corner scenario exposed a hard-sweep shortcut that treated squared displacement below `f32::EPSILON` as stationary: corrections shorter than roughly 0.35 mm bypassed world narrow phase and accumulated into walls. Only exactly zero displacement now skips the sweep. Motion-segment inspection proved that the escaping segments were full small corrections; adding an initial triangle-contact query did not resolve the bypass and was discarded. The retained fix changes admission, not solver passes or correction allowances. Hard-wall assertions use the existing response separation tolerance; the eleven focused step scenarios pass.

Accepted bounded approximation: a velocity-only contact response after correction travel is exhausted need not perform another wall query or retain a wall-constraint cache. It does not itself move the pose. The next ordinary hard sweep admits any resulting motion before application; later pair processing may observe that residual inward velocity during the current substep. The sustained corner/reversal case covers local progress and hard geometry for this approximation, not arbitrary crowd stability.

Two-sphere placement conformance correction: source inspection showed that `resolve_physical_body_placement` unions both movement spheres' collision domains, while the new step discarded the upper sphere's already-computed path after choosing the earliest blocker. `ContactBodyPath` now owns the synchronized primary and optional upper paths, their final domain union, and their traversed domain union. Accepted-prefix clipping clips both proofs before deriving those unions. Ordinary movement, stairs, projectiles, and mobile corrections update working membership from that contract; primary geometry still owns root translation and committed-cell choice. The result adds no collision query. The asset-free portal case proves both preservation of an upper-only cell reach and exclusion of an upper reach lying beyond the clipped endpoint. The BSP staircase/mobile obstruction case follows below. The two-sphere contact-alternation check and consumer audit are recorded in the conformance verdict below.

Validation after the first conformance fixes: all 630 world library tests pass, including eleven focused step scenarios. Warning-denied test-target Clippy, formatting, and diff checks pass. No broad benchmark or live session was run.

BSP staircase conformance: added two authored polygon risers/treads, first empty and then with a grounded mobile body occupying the lower step. The player crosses both risers, retains the upper support, moves the occupant forward, and does not cross through it. The empty baseline initially stalled because ordinary accepted support was discarded by an unconditional fresh support query at the same rim pose. `support_on_polygon` intentionally distinguishes its accepted plane adjustment from a subsequent zero-adjustment edge classification (`acclient.c:344680-344734`); these are transaction semantics, not interchangeable geometric predicates.

Support ownership now follows the existing `prepare_grounded_body_tick`/`settle_candidate` contract: retain accepted support while its owner proof is current and incoming velocity is not leaving its normal; invalidate it when ordinary travel cannot settle or contact correction changes the pose. The existing finite-edge bridge also survives: only when the bounded settle query proves a real lower surface but an edge obstructs descent, retain the candidate elevation with that edge's support proof. Edge reach alone does not manufacture footing. `GroundedContactState` carries grounded configuration and accepted support together through prepared admission. The publisher must preserve this response-owned fact rather than recomputing it from a pose. No additional query or convergence pass was introduced. A proposed triangle cap-filter change was discarded after tracing identified support semantics as the actual cause.

The focused cases additionally check that replacing the collision owner invalidates retained support and that outward launch velocity cannot inherit motor/settle support. Contact movement still invalidates support before the final query, preserving the earlier pushed-off-ledge behavior. Full edge-protection/launch input adapters and pose/lifecycle publication remain cutover obligations; this does not claim those adapters complete.

Validation after two-sphere proofs and BSP stair/support conformance: all 633 world library tests pass, including fourteen focused step scenarios. Warning-denied test-target Clippy, formatting, and diff checks pass. No broad benchmark or live session was run.

Current integration debt: the new contact primitive and combined hard query are not yet connected to production collection movement. Production use of the prepared admission contracts, bounded motor/integration, support refresh, canonical correction publication/reporting, and retirement of the old pressure driver are still required. Do not retain two runtime modes or count the standalone primitive as the feature.

Acceptance: fixed passes publish residual contact normally, every correction respects hard geometry, and ordinary contacts need no pressure selection, recursive propagation, or group rollback.

### 4. Implementation conformance gate

Status: **launch-speed blocker resolved by the approved non-exhaustive-contact concession**. The gate requires useful representative crowd behavior and hard-obstacle integrity, not general mobile anti-crossing. No new coordination or query loop is introduced by removing the ordinary speed cap. The bounded translation/contact kernel previously passed the checks recorded here. Production adapters remain mandatory phase-5 work; this verdict does not claim the existing production driver implements the new design or authorize broad/live acceptance before cutover.

- [x] Review state count, geometric query duplication, actual contact-loop bounds, and incomplete-result semantics. Remove any reintroduced crowd acceptance or correction-specific movement planner.
- [x] Walk remaining locomotion and runtime consumers through the actual types. Revise later work if it requires duplicate poses or re-solving whole trajectories.

- [x] Compare implemented loops, query counts, state ownership, and parameter bounds with the analytical gate. Any material deviation reopens the affected analysis.
- [x] Review focused behavior results against their stated questions. Record **pass**, **revise**, or **reject** and the bounded list of remaining questions for integration/acceptance. Do not compensate for a failed structural assumption by extending runtime or adding scenarios.

Acceptance: **pass** with one credible local solver matching the analytical assumptions. Focused checks establish implementation behavior, not general crowd stability; broader acceptance checks follow only after this verdict.

Conformance evidence and limitations:

- The fourteen asset-free step scenarios cover hard-pinned drive, incoming/residual contacts, cumulative correction travel, modest-step head-on speed with unequal radii, sustained three-body corner pressure and reverse escape, missing-coverage locality, projectiles, stairs with a mobile occupant, support invalidation, and two-sphere portal proofs. The expanded primitive scenario additionally exercises competing two-sphere contacts switching their selected normal over bounded repeated passes without generating velocity or retaining more than the named overlap tolerance in excess compression. This is a supported-envelope check, not proof against arbitrary interlocked authored sphere layouts.
- Actual control flow has one sampled actuation per eligible body/substep, at most three ordinary hard continuations, one stair attempt, four local contact passes, per-body correction allowance, and no convergence vote or recursive discovery. Support state is retained only at an accepted unchanged pose with a current proof; pose-changing contacts invalidate it. The stair/settle bridge is the existing bounded lower-surface rule, not a new query loop. Two sphere proofs share clipping and membership derivation. No blocked body rolls back a peer's progress.
- State consists of immutable source metadata, one working sphere/velocity/support state per mobile body, one correction allowance, accepted geometric paths, and local coverage failure. Authored hard shapes are placed once per substep. Projectile end-pose target placement is separate and happens only when projectiles exist. Publication must replace the old captured-commit collection; it must not add another full mutable spatial scene.
- Counts remain the analytical upper bounds, with support queries conditional on proof/pose invalidation and no duplicate settle after successful stairs. These are not debug timing results. The retained corner scenario checks hard geometry within the existing separation tolerance after removal of the small-movement sweep bypass.

Production consumer contracts inspected in `core/client/simulation.rs`, `core/client/runtime.rs`, `scene.rs` input preparation and tentative publication, `physical_body.rs::{prepare_grounded_body_tick,finish_grounded_body_tick}`, and `dynamic_contact.rs::query_contacts`:

1. Admit the physical interval before `advance_authored_motion_except`, local authored advancement, and authored physics effects. The collection divides that same interval into bounded substeps; no caller advances authored time for discarded catch-up duration. Resolved jump input enters working velocity once, with an explicit launch result for existing packet/feedback consumers.
2. Response adapters translate drive/coast, gravity/friction, restitution, heading/omega, and launch into the common step. Stable support, sledding, free flight, and projectile impact remain explicit behavior. Reuse the existing response math, not the old trajectory orchestration. Angular clearance and edge protection still need implementation, and their query bounds must remain explicit.
3. Authority return uses cheap reference prediction and bounded velocity actuation. The shared substep input performs no ordinary reference collision solve. Publication writes final pose, continuation velocity, support, membership, sampling, and reference state coherently for every changed body, including sleepers. Correction displacement never becomes extrapolation velocity.
4. `query_contacts` currently couples reporting to trajectory sampling and response acceptance. Do not carry that orchestration into the new driver. Extract directional report eligibility and authored target geometry; consume retained accepted paths/domain unions and hard-impact facts with a once-prepared target view. Aggregate directional touches and expire lifetimes once per collection. Preserve projectile flag retirement and world/presentation outcomes in the new collection result. Any unbounded or group-dependent report work reopens this gate.
5. Prediction uses the same response/contact path on private working inputs. Camera requests read the last immutable published collision/entity view independently of the physics tick; they do not access a second mutable simulation or wait behind the next collection advance.

The adapter work is deliberately phase 5 rather than a second standalone prototype. Integration that needs trajectory replay, contact-specific planners, new recursive work, incompatible time admission, or a different geometric footprint must reopen the affected gate. Broad profiling remains phase 6 after that cutover.

### 5. Locomotion, reconciliation, and production cutover

Status: in progress. Physical time admission is now connected at the production simulation entry point; collection movement still uses the old driver until the remaining cutover below.

Time-admission progress: `admit_physical_duration` owns the maximum admitted duration from the named substep/count limits. `tick_with_precise_jump` applies it before authored cursor advancement, local authored sampling, one-shot authored physics effects, physical movement, and pose-only projection. Wall-clock lifecycle timers remain wall-clock timers. Excess catch-up is discarded without a backlog; this is the approved time/accuracy concession, not evidence that the old solver meets its debug budget. The replacement collection must subdivide exactly this admitted duration and consume launch once. A core integration test feeds a two-second stall followed by an ordinary tick and verifies bounded first movement with no later replay.

Validation: all 633 world and 356 core library tests pass; warning-denied test-target Clippy for both crates, formatting, and diff checks pass. No broad benchmark or live session was run.

Collection-boundary progress: production core now calls `SpatialScene::advance_dynamic_entity_collection` once and receives stable-ordered body results, pre-collection contact facts, fixed placements, balanced report ends, and coverage rejections after publication. The former public prepare/per-body/fixed/finish methods and prepared-result type are private implementation details. Core no longer captures a separate contact map or interleaves frontend reconciliation between body commits. The shared world test helper, external core report-lifecycle test, and retained diagnostic harness consume the same public call. Removed the harness's preparation-only timer instead of exposing internal stages again; total collection timing remains available.

This boundary migration temporarily wraps the retiring driver; it is not the physical solver cutover and makes no performance claim. Its pressure argument, private epoch/commit machinery, and the legacy diagnostics' modes must be removed when this method is rebuilt around the bounded step. This is the sole production collection entry point, not an alternate runtime mode. Remaining publication work must preserve accepted support and two-sphere membership rather than rebuilding them from final pose queries. Body-local report outcomes and final expiry outcomes are still delivered separately under the current report lifecycle; the new driver must finalize them at the collection boundary without trajectory replay.

Validation after the collection boundary: all 633 world and 356 core library tests pass; warning-denied test-target Clippy for both crates passes. The retained profiling harness compiles with its feature enabled; it was not run. Formatting and diff checks pass.

Grounded input adapter progress: `GroundedBodyActuation::contact_step_input` maps current support plus the existing drive/coast choice into support-plane motor input or response-owned gravity. Supported stable bodies suppress gravity; sledding keeps it; airborne bodies cannot receive surface drive. The collection still owns launch/heading admission separately. Prepared mobile admission carries one authored response policy independently of optional grounded configuration/support, so free and grounded impacts use the same policy fact. Coasting in the new step reuses `physical_body.rs::surface_friction`; grounded server acceleration is not an additional gravity source.

Gameplay concession: stable driven bodies use the bounded motor for acceleration and braking instead of also applying authored coast drag to the same actual velocity. Retail previously damped retained momentum separately from its mandatory supported drive; applying that damping to the new unified driven velocity would introduce an unintended terminal walking speed. Coasting preserves authored drag, while sledding retains its special friction even with a drive. This matches the chosen actual-velocity motor model and adds no query/pass. Required retail-divergence documentation/census remains part of cutover cleanup. A focused driven-body case reaches an 8 m/s target within the configured acceleration bound and then slows under authored coast friction. Stair cases now use the grounded input adapter and continue to cross the authored steps. Launch/owner-replacement cases use that adapter with a deliberately conflicting server acceleration snapshot to check response-owned gravity.

Validation after grounded input/friction integration: all 634 world and 356 core library tests pass, including fifteen focused step scenarios. Warning-denied test-target Clippy for both crates, formatting, and diff checks pass. No broad benchmark or live session was run.

Remaining response work: one-shot launch admission and feedback, angular clearance, and edge protection before switching the public collection method to the bounded step. The input adapter is exercised by the new-step scenarios but the production collection still wraps the old driver.

Hard-response integration: ordinary swept impacts now reuse `impact_velocity` for authored elastic/inelastic response, while supported stable motion retains normal projection without bounce. The short airborne landing probe applies that same response to incoming physical velocity; otherwise it could acquire support before the sweep hit the floor and silently suppress restitution. Mobile overlap correction remains a non-bouncing normal projection. Response policy moved to the common prepared mobile role/working state, with one policy value serving free and grounded bodies; optional grounded state retains only configuration and support. Coasting friction is applied by that working response owner before the generic motor/force integrator.

Bounded settling concession: if a positive rebound would travel no farther than the existing hard-query `CONTACT_EPSILON` in a full substep, remove only its normal velocity component. Tangential motion and resolved bounces survive. This supplies a stateless low-energy landing stop instead of importing the old stationary-fall retry counter. It uses the existing spatial tolerance and adds no pass or query. Stable-impact suppression uses the support already admitted for this substep (or the pre-settle walking state); it does not re-query support at every impact. Cutover compatibility notes/census must record these small-step response approximations.

Focused response evidence: free body impacts distinguish authored bounce from inelastic full stop, and the explicit zero-elasticity fixture preserves tangential sliding. A falling grounded body bounces through the landing-probe route and then retains support without persistent tiny rebounds. Tests use `PhysicalElasticity::MAXIMUM` (the existing retail setter clamps to 0.1), rather than assuming arbitrary restitution values are admitted. All seventeen focused step scenarios pass.

Validation after ordinary hard-impact integration: all 636 world and 356 core library tests pass. Warning-denied test-target Clippy for both crates, formatting, and diff checks pass. No broad benchmark or live session was run.

**Historical launch admission audit — resolved by removing the collision-derived speed cap.** `GroundedLaunch` carries one resolved full velocity. Core retains that same resolution in `CommittedPlayerJump` for packet/feedback; the replacement step previously capped actual velocity to `minimum_radius * 0.25 / substep_seconds`. Silently clipping a newly admitted launch would contradict that shared launch contract and change supported jump behavior. This is a source-level contradiction, not something a live repro or longer benchmark needs to establish.

Source chain: `core/client/character_jump.rs::character_jump_vertical_velocity` computes `sqrt(height * 19.6)`; `world/state/self_movement.rs::retail_full_extent_jump_height` computes the unburdened full-power height `skill / (skill + 1300) * 22.2 + 0.05`; `world/context.rs` (the run-rate helper containing the 800-skill branch) and `ACE/Source/ACE.Server/Physics/Animation/MovementSystem.cs` supply the run-rate rule. `core/client/character_axes.rs::local_planar_velocity` caps planar release speed by the resolved base run speed times run scalar. The following examples use a 4 m/s base run profile, zero burden, and equal run/jump skills. They are admitted source-derived examples, not a census of every setup/scale.

| Example | Planar speed | Vertical launch speed | Combined launch speed |
| --- | ---: | ---: | ---: |
| Skill 400 | 11.333 m/s | 10.167 m/s | 15.225 m/s |
| Skill 800 | 18.000 m/s | 12.913 m/s | 22.153 m/s |
| Formula limit with 18 m/s planar speed | 18.000 m/s | 20.883 m/s | 27.570 m/s |

For the existing scale-one human reference sphere radius 0.48 m, the former ordinary allowance was 0.12 m: 14.4 m/s at the maximum 1/120 s substep, or 16 m/s if a 30 ms interval is split into four equal substeps. The skill-800 case exceeds both. The earlier projectile separation did not resolve this character-launch case. The human reference profile is synthetic and real characters resolve setup spheres/scale; this audit does not assume every installed player has exactly that radius.

**Accepted decision and simplification:** mobile/mobile contacts are non-exhaustive. Remove the ordinary speed-limit field and both velocity clamps; preserve the resolved launch vector without a radius-dependent admission rule. The proposed half-radius ordinary allowance is superseded, not another tuning option. Rename the remaining constant to `MOBILE_CONTACT_CORRECTION_TRAVEL_RADIUS_RATIO` so its sole purpose is explicit. Existing generic vector limiting remains needed for motor acceleration and separation. No launch-specific speed fallback, extra physical steps, or mobile CCD is required.

This also removes the need to describe stairs as an ordinary-speed exception and removes an anti-crossing proof from the analytical gate. The existing stair bounds/hard sweeps, projectile sweeps, time admission, and one-shot launch outcome remain necessary for their own contracts. Launch feedback must still describe actual admission, with collision/support/coverage behavior handled coherently; removing a speed restriction does not implement that adapter. Tests now check full unobstructed running-jump-scale velocity on a small body, while retaining correction-budget, hard-obstacle, corner, and escape checks. No test should require every mobile crossing to be detected or deliberately require a miss.

Validation after removing the ordinary cap: all seventeen focused contact-step scenarios pass, including unobstructed full velocity, hard-wall/corner resistance, escape, stairs, and cumulative corrections. World/core test-target Clippy passes with warnings denied; formatting and diff checks pass. No broad benchmark or live session was run. This resolves the sampling-speed decision; production launch admission and solver cutover remain unfinished.


Launch input progress: `ContactStepActuation` now uses mutually exclusive ballistic, supported-drive, and launch velocity operations. `GroundedBodyActuation::contact_step_input` supplies a launch only when the step has proved current walkable support; otherwise normal airborne input continues. Launch replaces the complete incoming velocity, clears support before friction/motor handling, and receives response-owned gravity exactly once for that substep. The step emits `ContactBodyUpdate::launch_admitted` at that state transition. This is an admission event, not an inference from final velocity, displacement, or generic solve status: a subsequent hard impact can stop an admitted jump. Missing initial coverage prevents input admission. The collection must aggregate the event once for packet/feedback and supply the launch only on its first substep; that production consumer remains pending.

A focused three-substep launch case uses distinct incoming velocity, opposing drive, and an 18 m/s planar plus 13 m/s vertical launch. It checks full replacement plus gravity, absence of ground braking, ballistic continuation, and rejection of a fresh launch request while airborne. Existing upward observer velocities already invalidate support in the step and continue ballistically; the retiring remote adapter's synthetic support-leaving launch edge is unnecessary in the replacement collection and should be removed at cutover.

Validation after launch input: all 637 world and 356 core library tests pass; world/core test-target Clippy passes with warnings denied. Formatting and diff checks pass. No benchmark or live session was run. Production aggregation/feedback and the remaining collection cutover are still pending.

Facing audit for the next adapter: `physical_body.rs::resolve_body_facing` resolves controller heading below Sledding velocity and AlignPath ordinary displacement, and `PreparedPhysicalBodyTick::finish_with_angular_progress` subsequently composes retained omega through `scene.rs::integrate_angular_velocity`. Preserve that order. The accepted ordinary path, rather than overlap correction, should supply displacement-based facing. Offset-sphere angular clearance still requires its own bounded geometric checks and accepted membership/result contract before publication; the translation-only kernel does not establish that behavior.


Edge-protection progress: ordinary movement captures a proved supported pose only for `EdgeProtection::Creature`. The normal settle now preserves a finite edge's inward normal as an explicit unsupported outcome. If ordinary motion loses support, the controller restores that candidate's starting geometry, support, membership, and private path boundary, tries one hard-swept tangent path plus settle, and otherwise holds with zero continuation velocity. This is the existing local precipice policy (`grounded.rs::edge_slide_candidate`; `acclient.c:301354-301440`), not rollback for residual mobile overlap. It runs before mobile contact passes; separation still invalidates support and may push a protected body off a ledge. Launch admission clears support first and therefore bypasses this walking guard.

Bounded approximation: the protected candidate is one physical substep, and a rejected candidate may discard its provisional hard-slide prefixes before the tangent attempt. Previously accepted substeps and other bodies are unaffected. Ordinary missing coverage retains its explicit local stop rather than entering this optional route; missing coverage on the optional tangent/settle leaves the saved proved footing. Shapes that supply no finite edge normal can hold but cannot invent tangent sliding; the existing analytic cylinder support reports surfaces, whereas polygon support supplies finite edges. No new rim-normal inference was added.

Work-bound amendment: at most one edge fallback per protected body/substep, outside the contact loop. It adds at most two sphere casts for tangent travel and the existing settle cost (two downward casts, one support query, and at most two upward casts). No stair attempt or recursive ordinary solver runs inside this fallback. The support outcome boxes only an optional vertical path, keeping the enum compact without allocating for an unchanged supported pose. Production reporting must consume only the surviving accepted path list, including removal of rejected private candidate paths.

Focused evidence: an authored finite polygon ledge verifies protected tangent progress and footing, an opposing hard wall, unprotected falling, and an accepted short drop over sixty substeps each. The existing contact-pushed-off-support fixture remains valid. Factored the test's BSP collision builder so stair and ledge cases share geometry assembly rather than duplicating it. Angular clearance, collection publication, reference actuation, and production launch feedback remain pending.

Validation after edge integration: all 638 world and 356 core library tests pass; world/core test-target Clippy passes with warnings denied. The ledge test also checks that surviving motion paths form a continuous chain ending at the published displacement, excluding rejected candidates. Formatting and diff checks pass. No broad benchmark or live session was run.


Angular implementation audit and next cutover slice: consolidated free/grounded requested-facing resolution into `physical_body.rs::resolve_body_facing`, consumed by both existing response finishers. It preserves AlignPath > Sledding > controller > current orientation precedence and returns a quaternion without mutating a pose. The existing precedence test exercises the shared helper. This removes duplicate mutation paths without publishing unchecked rotation from the new kernel.

The hard-sweep audit found why a whole rotating arc cannot be passed through existing straight-path shortcuts: `static_sphere_sweep.rs::MovingSphereCast::update_collider_hit` may discard a convex target after proving the initial straight displacement tangent/separating. A curved path can re-enter later. Parry provides nonlinear casts, but introducing them would still require curved topology traversal and different initial-contact/one-sided-surface admission; merely swapping the cast function is not a complete solution. Continue with the plan's bounded geometric subdivision over existing hard queries, rather than adding a second shape/coverage orchestration system.

Implementation prescription for angular clearance:

- Resolve control/body-policy facing after ordinary movement, then compose retained physical omega as the existing response does. Admit orientation before fixed mobile-contact passes, so those passes see the rotated movement spheres. Overlap correction never supplies AlignPath displacement or physical angular velocity.
- Represent angular traversal separately from root translation. `ContactBodyUpdate` needs the accepted orientation, and its root displacement must account for the primary sphere's changed rotated offset. Preserve both sphere paths and their union membership. A pure rotation must not translate the root, manufacture retained linear velocity, or appear as root-motion travel to reporting/publication consumers.
- Use a fixed maximum of four angular chord checks per mobile body/substep, shared by facing and physical omega rather than nested budgets. For perpendicular sphere-center reach `R` about the rotation axis, limit each angle so `R * (1 - cos(angle / 2)) <= CONTACT_EPSILON`. Bound angles to at most pi even at tiny reach. This explicitly accepts arc-versus-chord error within the existing 0.2 mm narrow-phase tolerance; it is not exact curved CCD. Sweep each changing sphere center against hard geometry. Retain the last fully checked angular sample on obstruction or budget exhaustion; do not queue catch-up angular displacement or add convergence retries.
- Rotation around an axis on which every movement-sphere center lies needs no clearance cast because occupied sphere geometry is invariant throughout the turn. This covers upright, centered character spheres under yaw. Do not infer this from equal endpoints: a complete physical revolution can have equal endpoints while crossing obstacles. Keep physical omega's axis/angle until admission rather than recovering its motion from the final quaternion.
- Keep oriented sphere endpoints on the actual arc; chord proofs are the admitted geometric approximation. An interrupted chord does not supply a valid partially rotated pose automatically. Stop at its prior checked angular sample initially. Reclassify support if rotation changes movement geometry, while preserving geometry-invariant yaw support.

Analytical work amendment: at most eight additional hard sphere casts per mobile body/substep, outside the pair loop, plus support refresh only when geometry changes. Four chords at 1/120 s with 0.2 mm error permit about 947 degrees/s for a 1.35 m perpendicular reach (about 1588 degrees/s at 0.48 m, 778 degrees/s at 2 m). These are geometry examples, not a content census or timing claim. Large offset-shape turns may take multiple steps; centered yaw does not incur that geometric limit. This is a hard-clearance work bound, independent of the removed mobile-collision linear speed cap.

Required focused angular cases before approving this adapter: geometry-invariant yaw, an offset sphere stopped by hard world/entity geometry, root position preserved under rotation, both-sphere domain publication, missing-coverage locality, and physical rotation beyond a full revolution without endpoint aliasing. The scalar chord bound is analytically established; those integration cases are covered by the mobile angular implementation progress below. Production rotation/publication is still pending, and the current translation-only kernel must not be described as a complete physics tick.

Validation after shared facing extraction: all 638 world library tests pass; world/core test-target Clippy passes with warnings denied. Formatting and diff checks pass. This validates preserved facing policy, not the pending angular clearance implementation. No broad benchmark or live session was run.


Mobile angular implementation progress: `mobile_contact/step/angular.rs` now admits resolved facing followed by explicit physical omega, sharing `MOBILE_CONTACT_ANGULAR_CHORDS = 4`. Geometry-invariant axis rotation bypasses casts; physical omega retains its axis and total angle so complete revolutions cannot alias into stationary offset geometry. Each changed-sphere chord uses the existing hard sweep via `sweep_body_chords`, preserving both sphere proofs and membership. Obstruction or unavailable angular coverage retains the last checked sample; budget exhaustion discards unchecked angular travel. Mobile contacts run after accepted rotation, and changed geometry invalidates support for the existing final refresh. Controller heading now accompanies `ContactStepActuation` through the grounded adapter.

Result/publication change: `ContactBodyUpdate` carries accepted rotation and canonical root displacement. `ContactMotionSegment::Rotation` carries sphere-center traversal and endpoint orientation at the ordinary endpoint, separately from timed root translation and stair/contact adjustment. The working body now owns its canonical root explicitly; translations update it by accepted sphere displacement, and rotation never changes it. This avoids subtracting rotated offsets to reconstruct the root after each angular chord. The test publisher applies orientation with displacement; the production publisher must do the same at cutover. The previous primary-path-equals-root assumption applies only to translation segments and must not survive reporting/prediction migration.

Numerical correction during integration: stair/settle root updates compute the sphere displacement before adding it to the root. Left-associated root-plus-new-center-minus-old-center introduced avoidable cancellation and disturbed the established staircase/crowd fixture. The corrected order preserves existing stair and pushed-off-support cases without loosening their assertions.

Focused angular evidence: centered grounded yaw plus a complete physical revolution requires no rotational sphere traversal and preserves footing; offset full turns make bounded progress, preserve the root and zero linear velocity, and stop before authored BSP and hard-entity obstacles. A two-sphere grounded body carries an upper-only EnvCell reach through rotation. Missing angular coverage keeps a checked angular prefix while a separate body advances. The coverage fixture installs only one landblock; the generic flat-scene helper installs neighbors and cannot prove missing-coverage behavior.

Scope/debt: mobile angular clearance is implemented in the replacement kernel, including the stated arc/chord tolerance concession. Projectile orientation was still pending at this milestone; the following progress entry completes its kernel adapter. Fixed-placement orientation remains collection integration work. Production accepted-motion/reporting consumers must use root translation and explicit orientation rather than treating rotational sphere-center paths as root travel or extra physical time. Broad performance/live acceptance remains gated on the complete collection cutover, reference actuation, reporting, and camera service.

Validation after mobile angular integration: all 642 world and 356 core library tests pass; world/core test-target Clippy passes with warnings denied. Formatting and diff checks pass. No broad benchmark or live session was run.


Projectile orientation and shared publication progress: removed the separate `ProjectileBody` state and duplicated `ContactBodyUpdate` assembly. Mobile and projectile roles now share `WorkingBody::new`/`into_update`, canonical root/orientation, linear actuation, and bounded angular admission. Prepared projectile policy retains the complete authored response policy, so AlignPath and physical omega are available alongside restitution. Projectile translation still has exactly one full-speed sweep and first-impact response; it never enters mobile relaxation or the ordinary slide/stair controller.

Angular admission now returns its first hard obstruction while preserving its prior checked sample. An offset projectile can therefore record a rotation-only impact; the result retains an earlier translational impact in preference to a later angular one. This uses the existing projectile impact consequence contract and adds no collision pass. As with the chosen angular approximation, impact can be reported while the retained orientation is the prior checked chord endpoint; there is no extra refinement query to advance exactly to the arc contact. Actual projectile flag retirement/report publication remains a collection obligation, not something the standalone kernel mutates.

Expanded focused evidence: the existing full-speed/small-target projectile case now checks AlignPath facing for clear flight and impact. The offset/full-revolution hard-obstruction case runs both compliant-mobile and projectile roles, requiring a projectile impact for BSP/entity angular obstruction and none for clear rotation. All twenty-three focused step scenarios pass. Shared-state extraction avoids adding a separate projectile angular driver.

Historical production-seam audit, addressed below: `DynamicEntityBodyTick::result` carried `PhysicalBodyTickResult`, whose single `PhysicalBodyMotion::path` cannot losslessly represent the replacement kernel's separate rotational sphere traversal and root translation. Do not synthesize a legacy trajectory or perform a second collision solve to populate it. Replace the collection result with the required publication/contact/launch/report facts at cutover, migrate core's generic-solve-status jump heuristic to actual launch admission, and update the diagnostic consumer. Existing direct/prediction callers must then use the same collection solver contract; tests must not preserve the old path orchestration solely for compatibility. The existing one-call public collection boundary is the integration point, not an additional permanent solver mode.

Validation after projectile/shared-state integration: all 642 world and 356 core library tests pass; world/core test-target Clippy passes with warnings denied. Formatting and diff checks pass. No broad benchmark or live session was run.


Production result cutover progress: `DynamicEntityBodyTick` now publishes body identity, prior contact, net canonical root displacement, and launch admission. Removed its `PhysicalBodyTickResult` field, so collection consumers no longer require the old solver's single trajectory, solve status, or one blocking-contact result. `DynamicEntityCollectionTick::collision_reports` aggregates body report events and final expiry at the collection boundary instead of exposing report fragments on body results plus a separate ends field. Core consumes the launch-admission fact and projects the already-published body through `WorldState::apply_integrated_body`; removed that projection method's unused solver-result argument. The external core report-lifecycle test and world collection helper consume the aggregate events.

Transitional debt is explicit: the public method still invokes the retiring driver. Its private adapter records requested launches while sampling actuation, then maps that driver's successful validated launch solve to the collection event. At solver cutover, delete this request set/status mapping and aggregate `ContactBodyUpdate::launch_admitted` directly. No new runtime mode was added. Direct/prediction callers retain their old result contract for now and remain mandatory cutover work.

Diagnostic cleanup at the changed boundary: removed the benchmark's old single-contact and solver-budget counters, which have no corresponding meaning in fixed-pass compliant contact. Its stationary-body count and displacement totals now consume actual net published root movement; the former accepted-velocity-times-duration calculation would omit positional correction and misstate blocked motion under the new continuation-velocity contract. Renamed `held_movers` to `stationary_bodies` to describe the measured fact. The benchmark still contains retiring pressure modes and must be retargeted/cleaned before use; it was compiled, not run.

Validation after the production result cutover: all 642 world and 356 core library tests pass. The profiling harness compiles with its required feature. Warning-denied Clippy passes for world/core test targets and the profiling harness. Formatting and diff checks pass; no broad benchmark or live session was run.


Historical reference-prediction progress (superseded by the explicit producer contract below): removed the provisional collision solve and collision-scene parameter from the earlier correction adapter. Its ordinary predictor, `physical_body.rs::predict_reference_motion`, reads sampled intent and incoming kinematics, predicts root travel and facing/omega arithmetically, and never queries geometry or publishes the prediction. Grounded prediction shares `ContactStepActuation::predict_velocity` with actual new-kernel integration, including motor recovery, coast/sled friction, launch replacement, and gravity. Free-flight prediction retains its sampled physical plus authored-kinematic travel semantics. The final actual solve remains responsible for geometry and placement.

**Superseded prediction concession (rejected by the return audit below):** the reference uses the body's sampled incoming velocity; it does not maintain a second persistent velocity simulation. Thus it can inherit velocity changed by previous contacts until a later authority update, and it can use support that becomes outdated or predict behind hard geometry. Current positional separation/correction is excluded from the predicted ordinary displacement. This is a cheap local predictor, not a collision-independent replica of the server. Return still follows the latest reference and can remain blocked. If this approximation produces visible drift after full cutover, assess the observed behavior before introducing a second prediction state.

Removed the now-unreachable collection branch that rejected missing coverage from provisional reference prediction. The associated legacy shared/pressure fixture required this retired prediction failure and was replaced with an asset-free test: reference arithmetic advances beyond the only resident landblock, while the new kernel's actual physical motion reports unavailable coverage and retains zero displacement/velocity. Existing moving-reference, repeated-authority, contact, and collection tests still pass.

This removes duplicated reference collision work in the current production path, not only the standalone kernel. Remaining integration still must replace the retiring driver's non-retained correction velocity with bounded return actuation through the new velocity/contact rules, seed/complete reference lifecycle for displaced mobiles without pressure flags, and replace the collection scheduler. It is not the solver cutover or a debug performance claim.

Validation after arithmetic reference prediction: all 642 world and 356 core library tests pass; world/core test-target Clippy passes with warnings denied. Formatting and diff checks pass. No broad benchmark or live session was run.


**Earlier bounded-return analytical gate — revise; resolved by the approved ownership model below.** The arithmetic reference predictor currently starts from `body.retained.velocity` (or the free actuation's same sampled value). The actual new kernel publishes contact/force response into that velocity. If return becomes a retained motor targeting nominal velocity plus the bounded reference-error bias, the next prediction can treat the prior return velocity as ordinary travel. Limiting the bias does not limit the accumulated actual velocity. The prior concession about reusing incoming velocity is therefore insufficient for this proposed return law; do not implement that composition unchanged.

Concrete isolated recurrence, not a live failure claim: let `h = MOBILE_CONTACT_SUBSTEP_SECONDS`, `a = MOBILE_CONTACT_MOVEMENT_ACCELERATION`, `u = PHYSICAL_CORRECTION_SPEED_MPS`, current root `x`, reference `r`, actual velocity `v`, and ordinary drag factor `d`. A naive shared-input return computes nominal `d*v`, advances `r` by `d*v*h`, and advances actual velocity to `d*v + min(u, a*h)` while the error is appreciable. Therefore `r_next - x_next = r - x - min(u,a*h)*h`, while velocity repeatedly accumulates the return increment. Starting one meter from a stationary target with the current 1/120 s, 20 m/s², 1 m/s bias and 5 cm completion threshold: with no drag, the error reaches completion after 684 steps (5.7 s), but actual velocity is 114 m/s and root/reference have traveled about 325 m. Using the existing default coast drag `(1 - 0.95)^h` still leaves about 6.76 m/s and 36.36 m of root travel at completion. These arithmetic examples have no walls, mobs, latency, or solver convergence to blame. They do not claim every possible return controller has this behavior; they disqualify this direct composition.

Source boundary: `predict_reference_motion` consumes actual incoming motion; `ContactStepActuation::predict_velocity` applies ordinary motor/friction/forces; `PhysicalCorrection::advance` advances the reference from supplied ordinary displacement and returns a bounded positional correction. Current production uses that correction as non-retained travel and has not acquired the proposed feedback. Core's free-flight adapter also builds its ordinary actuation from `body.retained.velocity`, so merely changing the world predictor's name or moving it between modules cannot separate nominal and actual motion.

Approved resteer: separate nominal motion input from simulated continuation velocity. Predict the reference from producer-authoritative vectors and authored drive, never from contact/return response. The single actual body then tracks nominal velocity plus bounded positional-error return through the ordinary motor/contact step. This requires retaining or supplying the last authoritative velocity for coasting/free motion at the input boundary; it does not require a second collision body, collision solve, or contact history. Grounded authored drive already supplies an explicit target; coasting/free inputs need equally explicit ownership. Inspect existing entity-authority storage before adding duplicate persistent fields. Keep reset/replacement/vector-only update lifecycle coherent.

Alternative tradeoff: hold the reference at the latest authoritative pose between packets, eliminating moving-reference velocity prediction but making moving entities trail packet updates. That is simpler state but a material change to moving-entity behavior and is not silently adopted here. Do not patch the feedback with a speed clamp, extra damping, convergence retries, or tracking a hidden subtraction of prior return corrections. That audit paused implementation for review; the user subsequently approved the ownership and animation resteer below. No return motor or additional reference state was added during the audit. Existing green checks remain the evidence for the unchanged implementation, not approval of the rejected recurrence.


Storage audit supporting the approved decision: existing `Entity` already retains producer vectors (`entity.rs`: velocity, acceleration, omega), independently of `SpatialBody::retained`. `state/mutations.rs` updates those entity fields from remote position samples, vector updates, and autonomous-player server-vector recording; physical publication writes the runtime body instead. In particular `record_player_server_vectors` explicitly preserves server facts without replacing local runtime integration. Core's `tick_physical_entities` already borrows the entity store while assembling actuation. Thus the recommended separation can supply nominal producer vectors through the collection input boundary without adding another persistent velocity copy to `PhysicalCorrection` or `SpatialBody` for client-mode entities. Authored drive still needs its explicit nominal target, and diagnostic/other producers must supply their own input rather than silently substituting simulated velocity. This storage audit changed no behavior or input contract.

- [x] Route grounded/free behavior through common hard movement/contact primitives; preserve support, stairs, slopes, edge policy, jump, angular clearance, and meaningful authored response.
Supported return primitive progress: `ContactStepActuation::returning` now requires an explicit ordinary velocity, same-instant reference error, and support normal. It projects return into the support tangent, caps it with the existing return-speed constant, and tapers it with `PHYSICAL_RETURN_GAIN` (2/s). It reuses the existing actual-velocity motor; no extra movement pass, retained correction vector, or collision query was added. The input contract expressly excludes actual continuation and visual playback as nominal sources. Production input ownership is still pending: a constructor contract alone cannot prove callers supply the right source.

The new asset-free contact-kernel scenario follows stationary and 2 m/s moving references for six seconds each, then replaces each target behind the body and follows for another six seconds. It checks the return-speed envelope and acceleration bound on every step and position/relative-speed settling at the end. This exercises accepted physical updates across successive steps, not just the return formula. All 643 world library tests pass; world/core test-target Clippy passes with warnings denied, and formatting/diff checks pass. No production cutover, packet integration, animation change, benchmark, or live-session claim follows from this result.

Reference lifecycle progress: `PoseReconciliationState::advance_return_reference` now returns same-instant reference error and advances the target only by supplied nominal world-aligned travel. The old positional correction and new motor share the underlying reference arithmetic. `finish_physical_tick` now requires relative continuation velocity and retires the target only inside both position and speed tolerances. The speed tolerance derives from the return gain and existing position tolerance, rather than adding another independently tuned constant.

The successive-step kernel scenario now uses the real reconciliation state for target replacement, advance, and completion. It checks stationary and moving target settlement and bounded reversal, with reference retirement required in both cases. A separate boundary case verifies that an exactly coincident body retains its reference while relative velocity is still appreciable. All 644 world library tests pass.

Temporary cutover debt: the retiring production driver's correction contributes no retained momentum, so its completion adapter explicitly supplies zero relative return velocity. The new collection driver must supply actual continuation minus independent nominal velocity; this adapter is not evidence that production has that source split. The new reference-advance API is exercised by the kernel integration fixture and awaits the production collection owner. Remove the retiring additive-correction wrapper/adapter at cutover rather than keep two correction modes.

Production input audit/progress: `BodyProjectionResolver::resolve` is not a nominal-input producer. It intentionally chooses `Entity` vectors only in `AuthoritativeOnly` sampling mode and otherwise substitutes `SpatialBody::retained`, with runtime fallbacks for absent entity data. Reusing its `SolveBodyInput::retained` for reference prediction would preserve the rejected coupling. Core's remote physical adapter previously called that whole projection merely to extract `authored_offset`; it now calls the direct `BodyProjectionResolver::authored_offset` accessor, sourced from the entity's admitted command and host motion cursor. This removes unnecessary pose/velocity projection from ordinary authored input assembly. It does not yet separate the free-flight adapter's physical velocity from nominal input.

The packet side must change in the same production cutover: `SpatialScene::apply_authoritative_body_effect` currently copies incoming vectors into actual retained state for all effects except confirmation, and `apply_authoritative_body_vectors` replaces retained kinematics directly. Those are existing old-driver semantics, not a new return bug. Under the new motor, distinguish ordinary remote movement updates (nominal source) from explicit impulses/reset admission (actual physical state); preserving the position alone is insufficient to preserve bounded return velocity through packets. Existing `Entity` vectors and body authority timestamps are available; no duplicate persistent velocity copy has been added. Carry this distinction through the producer mapping before wiring the motor, including upward launch edges. Do not use the direct authored accessor as evidence that vector ownership or packet behavior is already corrected.

Validation for the direct authored input path: all 356 core library tests pass. No live session or broad benchmark was run.

Packet/impulse mapping audit — pass with existing packet provenance: a repository-wide census of `new GameMessageVectorUpdate` finds player jump (`ACE/Source/ACE.Server/WorldObjects/Player.cs:954`), spell-projectile stop (`WorldObjects/SpellProjectile.cs:238`), and the developer `bumpvelocity` command (`Command/Handlers/DeveloperCommands.cs:3153`). The message contains velocity/omega and instance/vector sequence, not an impulse/ordinary flag. Retail `SmartBox::DoVectorUpdate` calls `set_velocity`/`set_omega` directly (`acclient.c:137314–137338`); `set_velocity` replaces physical velocity and sets `jumped_this_frame` when changed (`306874–306902`). This census supports preserving dedicated vector packets as explicit physical replacements. It does not establish that every conceivable server fork uses them only in those cases.

Use the already separate APIs as the distinction: dedicated `apply_authoritative_body_vectors` changes both the authoritative input (already written to `Entity`) and actual physical vectors, leaving pose/reference intact. Routine mobile Interpolate/Snap position samples update authority/nominal vectors and reference only after cutover; they must stop replacing actual continuation. Initialize/reset and local confirmation retain their existing lifecycle/autonomy rules. A dedicated vector replacement may abruptly stop return velocity; that is an external physical event, like a jump or projectile stop, rather than another return-motor tick. Subsequent ordinary motor steps recover normally. No heuristic based on speed, extra impulse detector, or general event priority framework is needed. Keep the existing grounded upward-vector launch edge consumed once.

This resolves the packet-source mapping needed for the input split without introducing a new user decision. Only the dedicated-vector API documentation changed; routine position-packet behavior must change atomically with independent nominal input and the new collection driver. Changing it now would deprive the old driver of velocity samples before its replacement source exists. No tests or evidence runs were needed for the documentation-only change; source census and diff checks are the validation.

Production nominal-vector split implemented: `advance_dynamic_entity_collection` now requires an independent `AuthoritativeBodyVectors` producer callback alongside physical actuation. Core reads those fields directly from the owning `Entity`; an absent owner fails explicitly instead of substituting simulated velocity. The benchmark supplies zero nominal vectors because its ordinary travel is entirely authored by its drive callback. No new persistent velocity copy was introduced. `predict_reference_motion` now takes that explicit vector input and does not read retained linear velocity, acceleration, or omega. The free-flight actuation's physical continuation is likewise excluded from nominal prediction.

Grounded nominal prediction now uses the supported commanded velocity directly. It must not run the actual bounded motor from the latest server velocity on every prediction: a stationary server sample would repeatedly restart acceleration and make an 8 m/s walking reference crawl. Coasting/free/airborne prediction still uses a cheap current authoritative-vector sample with one admitted interval of authored drag/acceleration; this is not an independently integrated ballistic trajectory. It can be inaccurate between samples, especially during acceleration, as already conceded for cheap reference prediction. Reference orientation/authored-frame ownership and sampling across collection substeps remain cutover work; the vector split alone does not establish those invariants.

Historical transitional state: direct/prediction callers and old shared-driver fixtures still used a simulated-vector adapter while production inputs were being separated. That adapter and the old direct correction path are now deleted; direct callers provide explicit input too.

Validation: all 644 world and 356 core library tests pass after the predictor change, and warning-denied world/core test-target Clippy passes. The reference coverage fixture now also checks that a body physically travelling at 50 m/s predicts no reference movement when its independently supplied authority is stationary. The motor fixture checks full commanded nominal travel while the actual body is still accelerating. The profiling harness is compiled only, not benchmarked.

Reference frame/source ownership implemented at the production input boundary: `PhysicalReferenceInput` combines independent authoritative vectors with optional admitted/scaled local authored travel. Core preserves the raw local travel for reference prediction while actual actuation retains its existing physical frame conversion. Explicit world-space controller/fixture commands remain world-space when no authored offset is supplied. `predict_reference_motion` takes the retained reference pose explicitly, transforms local authored travel in that frame, and integrates producer omega there. Translation advance subtracts the old reference position, not the displaced body position. Thus the body's corrected pose is not the prediction origin or authored basis.

Preserved heading policy: when reconciliation owns heading, its existing override still wins over an explicit world-space controller heading. Local authored rotation is represented separately in the reference input, so prediction need not infer it by subtracting physical headings. The temporary simulated-vector adapter was subsequently removed during direct transaction cutover. No separate reference collision body or geometry query was introduced.

The focused reference fixture now gives the reference and physical body different orientations and verifies that authored travel follows the reference frame, while stationary authoritative vectors still ignore the moving physical body's continuation. Existing turning-walk reconciliation cases continue to require their heading-ownership semantics; those expectations were preserved rather than deleted. All 644 world and 356 core library tests pass, as do warning-denied world/core test-target Clippy, profiling-harness compilation, and diff checks. Production still uses the retiring correction/driver; collection substep sampling, packet cutover, and visible locomotion separation remain outstanding.

Authored substep sampling progress: `PhysicalReferenceInput::interval` now samples normalized portions of one admitted tick's local transform using the existing `glam` dependency. Translation follows the sampled offset's straight path; rotation follows its shortest arc. Each interval's translation is expressed in its own starting authored frame, so composing all intervals reproduces the full sampled transform. Simply multiplying translation and rotation by a time fraction and repeatedly applying them in the changing local frame would bend the travel and fail that endpoint contract. Producer vectors remain rates and are not divided by the number of steps.

Accepted approximation for the collection sampler: the already-collapsed tick offset does not preserve internal curved travel or extra authored revolutions. Interval sampling preserves its endpoint, not those lost details. Physical omega retains its separate explicit-angle angular admission. This introduces no extra simulation time or collision query. The collection driver still must consume these intervals and admit launches only once; the sampler alone does not implement scheduling or action/hook provenance. An asset-free composition test uses the configured maximum substep count and a translating/turning offset to check the endpoint and unchanged vector rates; it passes. World/core test-target Clippy passes with warnings denied, and formatting/diff checks pass.

Bounded collection primitive implemented: `mobile_contact/step/collection.rs::advance_body_contact_collection` copies one private body snapshot, admits at most the configured four substeps, and carries accepted pose, continuation velocity, contact/support, cell membership, and projectile-state retirement into each following substep. It returns one stable-ordered aggregate `ContactBodyUpdate` per participating body. Contact passes remain the existing fixed local kernel; no component discovery, convergence loop, live scene mutation, or second reference collision solve was added.

`ContactSubstep` supplies the exact admitted interval and duration to evaluation of already-sampled input; callers must not advance animation cursors or fire hooks there. The collection owns launch consumption, suppressing repeated replacement after the first admitted launch while retaining ballistic force integration. A projectile's first accepted impact clears its working missile/path-clipped/align-path behavior before the next step, and the first impact fact survives aggregate output. The world publication adapter still must project that state change to authoritative entity consumers/reports. Final velocity/membership/support come from the final substep; net displacement, ordered path segments, launch occurrence, first impact, and coverage-failure occurrence accumulate across the collection.

Rotation segments now carry their physical instant explicitly, just like adjustments, so translation, rotation, and zero-time adjustment segments can all be retimed into one collection timeline. This preserves the existing separation between physical time and geometric correction instead of appending each substep at a repeated 0–1 timestamp.

The return/packet-like-target fixture now runs through the collection primitive, carrying real reconciliation across its substeps. A second asset-free case requests one second, checks the admitted maximum duration/substep count, repeatedly offers the same launch, and verifies exactly one velocity replacement plus admitted gravity, ordered aggregate segment times, and no mutation of the source scene. All 646 world library tests pass. These results establish the private collection step, not live scene/report publication or production cutover. The existing public production collection still invokes the retiring driver and remains the next integration owner to replace.

Hard-impact provenance progress: `ContactMotionSegment::Impact` now retains hard world/entity hits from accepted ordinary movement, positional correction, projectile translation, and angular admission. It is a zero-duration contact observation, not a fabricated path or extra displacement. Placement consumers explicitly select segments with geometry; reporting can consume the already-resolved hit without repeating the hard sweep. The collection retimes these observations with the rest of its movement history.

Keeping impacts in the ordered history also lets existing protected-edge rollback truncate rejected ordinary observations together with the rejected path; optional stair routes that succeed return before recording the rejected ordinary blocker. No parallel contact-rollback list or new query pass was added. Support-derived environment contact and directional authored mobile/report-only overlaps still need report collection; impact history is not the complete reporting implementation.

Focused tests now distinguish physical travel from impact observations: a blocked projectile retains its impact, an unobstructed shot has none, and tangent slide from an initial hard-entity touch retains the correct peer at time zero while completing its tangential travel. Geometry-chain tests select path-bearing segments. All 646 world library tests pass. Production report lifetimes/publication remain unfinished.

Hard/support report collection implemented: the private collection now returns `ContactCollectionUpdate`, containing final body results and deduplicated `CollisionReportTouch` observations. At each substep it converts accepted hard impacts and supported/sliding world contact into directional report facts without geometry queries. Both interested recipients of a hard-entity hit are represented, subject to existing report-interest/source-permission flags. Source policy is sampled before any projectile retirement is applied to working bodies, preventing body-order-dependent report eligibility.

Moved `dynamic_report_touch` to the report-owning module and reused it from both the retiring driver and the new collection, so object/environment classification and ethereal-source expiry semantics have one implementation. `CollisionReportTouch` is now an observable result contract; the scene's existing lifetime owner still exclusively computes and commits Started/Ended transitions. The hard-slide fixture exercises a multi-substep collection and checks both directional observations, first-touch starts, and silent refresh through that owner.

This remains partial report integration: authored mobile/report-only overlap or traversal collection and final live-scene lifetime publication are still required. No broad benchmark or live session has run, and the production entry point still invokes the retiring driver.

Authored report narrow-phase extraction: moved the BSP/setup-volume sphere dispatcher out of `dynamic_contact.rs` into `volume_query.rs::placed_shape_contacts`. The retiring driver and future report traversal now share geometry semantics without retaining the trajectory solver as their owner. Added `collision::sphere_path_touches_shape`, which checks initial overlap (including separating movement) and then uses the existing placed-shape sweep for accepted travel. It performs no topology traversal, scene movement solve, or peer-trajectory negotiation. Initial overlap must be checked explicitly because a hard-response sweep intentionally suppresses separating/tangent initial contacts.

The retiring report path's stationary overlap check uses the same helper, providing a production consumer during cutover. An asset-free case verifies crossing a thin ball with both endpoints outside, escaping initial overlap, and a clear miss. All 647 world library tests pass. This is the shared narrow phase, not yet the new collection's candidate/traversal loop; compile/cache authored targets once per substep, use local candidate bounds and accepted membership, and keep any moving-peer sampling concession explicit when wiring that loop. No broad or live performance claim is made.

Authored traversal reporting is now connected to the private collection. `mobile_contact/step/report.rs` queries initial sphere overlaps plus both movement-sphere paths of accepted travel, angular chords, and zero-time adjustments against authored peer geometry. It uses the existing outdoor/EnvCell candidate index and actual reached memberships, filters source/report policy before narrow phase, and emits both eligible directional observations into the collection's deduplicated touch set. Report-only ethereal targets remain nonblocking and can report a crossing even when neither movement endpoint overlaps them. Impact observations continue to provide hard-contact facts independently.

Moving-peer concession: reporting holds peer geometry at substep-start poses while sweeping the mover's accepted paths. Stationary trigger crossings remain swept; moving-body report detection is approximate and can miss or over-report contacts relative to simultaneous trajectories. This is consistent with accepted non-exhaustive mobile collision behavior and does not restore peer-path coordination or affect physical response. Projectiles still filter ethereal peers from reporting according to the existing pair policy. Lifetime publication remains owned by the scene, not the report query.

Removed duplicate preparation at this boundary: `DynamicShadowIndex::compile_prepared` now consumes already-placed shapes, and both normal index compilation and reporting derive membership bounds and conservative root-relative rotation extents from that same geometry. Deleted the separate `target_bounds` and `target_furthest_extent` preparation paths. Reporting prepares one target set per substep and reuses it for all accepted paths; no full environment solve or target preparation occurs inside the pair loop. Local candidate scanning and actual narrow-phase overlaps can still be dense; this is bounded-step structural work, not a timing claim.

An asset-free collection test crosses a small stationary ethereal trigger completely, verifies unchanged physical travel/velocity, both report directions, environment classification and ethereal lifetime metadata, and absence of reports when both recipients are uninterested. All 648 world library tests pass. Live scene publication, production entry-point replacement, animation separation, and final cleanup/acceptance remain unfinished.

Client response mapping checked against preparation: `core/dynamic_entity.rs::prepare_dynamic_entity_physical_facts` uses fixed-position response when the setup has no movement spheres, otherwise `retail_grounded_body_with_policy`, including gravity and edge policy. Client mobile entities therefore do not require guessing a free-sphere character motor from their collider shape. Projectiles retain their explicit collision flag distinction. Free-flight direct/explorer/diagnostic consumers remain a separate required mapping before complete driver retirement.

Supported return composition is now explicit in `ContactStepActuation::with_supported_return`: reuse response-owned forces and controller heading, steer only with walkable support, and let an admitted launch replace velocity without return interference. While airborne or on non-walkable sliding support, reference steering is deferred and existing ballistic forces remain active; the reference is not completed merely because steering is unavailable. The multistep return fixture now runs through actual grounded actuation before return composition. The collection launch fixture supplies deliberately opposing return input to verify that launch and subsequent airborne gravity remain independent. Both focused cases pass, as do warning-denied world/core test-target Clippy and formatting/diff checks.

Canonical physical-state publication prerequisite: `ContactBodyUpdate::apply_physical_state` now carries pose, continuation velocity, support, checked membership, and projectile retirement consistently into subsequent substeps. It reanchors coordinates before assigning a committed EnvCell and normalizes outdoor ownership when leaving interiors or crossing landblocks. This consumes the kernel's accepted placement without another geometry query. The contact fixture publication helper now uses this same operation and `SpatialScene::update_body`, so scene membership indexes remain consistent and report lifetimes are not ended by replacement registration.

Validation: all 649 world library tests pass, including an asset-free frame-transition matrix covering outdoor/interior sources and outdoor/interior destinations across a landblock boundary. This completes the coordinate/state handoff prerequisite only; production collection scheduling, scene-owned report publication, activity/reference lifecycle, and presentation separation remain pending.

Sleeping-body admission now follows contact mobility rather than removing sleepers from the population. The replacement step skips ordinary input, translation, and orientation for settled mobiles with valid support. They still participate in every local contact pass. Invalid/absent support admits ordinary integration; accepted translation, rotation, velocity, support, or projectile-state changes wake the private body for the next substep through the common physical-state publisher. Contact wake does not depend on which peer was processed first, and no peer-wake queue is needed inside the new collection. Existing command owners must wake bodies before supplying new work; core already does so for a local launch. The launch fixture now observes that production admission contract.

Focused admission evidence: an overlapping sleeping mob yields in the first substep and first samples ordinary input in the second, while a separate sleeper samples none and stays settled. Replacing the collision owner invalidates the separate sleeper's support and causes input sampling immediately. All 650 world library tests pass. Production activity finalization still needs the new settling decision; this step supplies contact wake and sleeping admission, not a second scheduler or the production cutover.

Free-flight kernel input now explicitly separates authored travel from retained physical velocity. `ContactStepActuation::free_flight` supplies acceleration and a per-interval world-space kinematic rate. Ordinary and projectile sweeps include that rate in their requested path; ordinary hard continuations remove its closing normal component without bounce. Physical restitution and mobile contact velocity response still operate only on physical continuation. The kinematic rate lives only in the substep working body and is never published as retained velocity. Grounded character drive continues to use the bounded motor; free-flight input cannot be applied to a grounded working body. Producer mapping still must seed physical velocity once and subdivide admitted authored travel rather than reapplying a sampled initial velocity every interval.

A repeated free-flight fixture combines independent physical and authored horizontal travel with authored downward travel into flat terrain. It proves tangential progress, swept floor contact, and unchanged physical velocity over successive collections. It exposed an existing generic sphere–triangle cast error: impact convergence allowed approximately 1.3 mm of floor penetration. The static query now takes the exact sphere/plane time when the projected contact lies on the finite triangle face (using Parry's point projection and the existing contact tolerance), retaining the generic cast for edge/vertex and initial-penetration cases. This adds no movement retry or query pass. All 651 world library tests pass, including existing stairs, ledges, angular clearance, and projectiles. Production free-flight input assembly, authored orientation, and collection cutover remain pending.

Sampled-input integration progress: `PhysicalBodyActuation::contact_step_input` now maps an admitted interval into the common grounded or free-flight input, using actual current orientation/support. Optional scaled/gated authored travel replaces the already-transformed full-tick command with its local interval, and authored heading uses the same interval. Grounded drive/coast, supported launch, gravity, friction, and facing policy reuse their existing adapter. Fixed bodies and retiring positional-correction input are rejected at this mobile boundary. Free physical velocity is deliberately not reseeded per substep; the collection owner must seed it once so accepted impacts persist. The turning-flight fixture composes the complete authored translation/heading over all configured substeps from a nonidentity actual orientation while retaining zero physical velocity. Grounded fixtures now exercise this shared input adapter.

Production producer contract unified: `PhysicalBodyInput` carries physical actuation and independent reference input in one sample. `advance_dynamic_entity_collection` takes one callback, and the retiring driver's pressure-source cache retains the whole sample. Core resolves entity identity, physical definition, authored source, and scale together rather than via separate actual/reference callbacks with different fallback paths. Explicit local free-flight drive now selects the same travel source for actual motion and reference prediction; an unrelated authored offset cannot override only the reference. Internal legacy fixtures and the profiling harness supply the same typed contract. This is live input-boundary cleanup; the production solve still uses the retiring driver pending reference lifecycle, final publication, and presentation separation.

Validation: all 652 world and 356 core library tests pass after the input cutover. No live or broad performance run was performed; the solver/presentation cutover remains the gate for those runs.

Observed-motion publication implemented in the replacement kernel: each timed travel segment records whether walkable support admitted it. After selecting the ordinary stair/edge path, the step derives all timed root travel and supported timed root travel once; angular facing and final publication consume the same fact. Angular sphere chords, stair/support adjustments, and mobile separation contribute no translation to either observed rate. `ContactBodyUpdate` carries `accepted_motion` plus `supported_velocity`; the physical-state publisher writes the existing cached-motion field independently of retained velocity. The supported rate is ready for the pending host locomotion selector and does not introduce a reference concept into rendering.

Collection aggregation weights observations by admitted substep time, including stationary time after a hard stop. Angular observation reuses the existing accepted-orientation rate calculation per substep. The resulting cached rate describes accepted timed movement, not a velocity to feed back into physics. It is intentionally distinct from net pose displacement, which includes geometric adjustments, and from final continuation velocity, which may be zero after an impact.

Evidence: the cylinder stair fixture excludes lift/descent from observed vertical travel; ordinary supported drive yields a positive supported rate; a contact-displaced sleeper retains zero observed locomotion; authored free flight remains unsupported; and a new inelastic hard-stop fixture travels halfway through the admitted interval, ends with zero continuation, and publishes half the incoming speed. All 653 world library tests pass. Production scene publication and the host action/locomotion selector still need the new result; this completes the observation contract rather than claiming presentation cutover.

Character return composition now has one interval owner: `PhysicalBodyInput::return_step` subdivides the sampled authored input, predicts ordinary reference travel in the reference frame, builds actual actuation in the current body frame, preserves correction-owned heading priority, advances the retained reference, and applies supported return steering. Its `ContactReturnInput` returns the independently predicted nominal velocity alongside actual actuation so completion uses actual continuation minus nominal travel. It does not seed references, replace local confirmation, or implement free-flight return; those remain collection/lifecycle integration obligations.

The support input is explicit: `predict_reference_motion` consumes the support proved for the current substep rather than rereading the body's previous response. This prevents an initially airborne body whose floor has just been proved from advancing its nominal reference downward while the actual motor suppresses gravity. The predictor now returns arithmetic displacement and orientation directly; both the live retiring adapter and the new return composer consume that displacement without subtracting rounded pose coordinates to recover small travel. No additional collision query or persistent nominal velocity state was introduced.

The existing repeated stationary/moving/reversing-reference test now exercises the complete sampled-input return composer and its returned completion velocity, including initial support acquisition. All 653 world library tests pass. Scene-owned reference seeding, final publication/settling, packet cutover, free-flight return policy mapping, and animation selection remain unfinished.

Presentation ownership split implemented in `BodyMotionRuntime`: an optional locomotion cursor has its own selection state and no action queue. `observe_locomotion` changes only that visual cursor. Existing `active_action` ownership chooses the authored sequence for presentation until its exact completion boundary. Ordinary selection also records whether the steady command permits observed locomotion: walk/run/backward movement and the stance default permit it; explicit non-locomotion substates keep authored presentation. This protects steady special poses as well as queued actions. Ordinary `drive`, `tick`, state, root offsets, hooks, action admission, and completion retain their existing owner. Table replacement resets both cursors together. The registry exposes this operation for the pending post-physics selector, with an explicit result for unmodelled channels.

`MotionSequenceRuntime::advance_presentation` shares clip timing, forward/reverse traversal, and transition cleanup with authored advancement while omitting the contribution sink. It does not traverse departed frames to read root tracks, generate discarded hooks, or apply motion-data physics. This prevents both physics feedback and duplicate effect work; no second action owner or generic priority framework was added. The existing sequence still owns mixed action/return-root contributions and terminal-frame hooks.

Asset-free evidence compares identical authored runtimes with and without observed walking across action start, continuation, and completion. Authored tick outputs remain identical, active actions remain visible, and completed actions reveal observed walking. A separate hooked-clip fixture compares cursor position and clip selection through forward, boundary, and reverse advancement. All 59 motion tests pass. The body-motion-to-order selector, post-physics scheduling, missing-direction capability handling, and live integration remain pending; ordinary presentation remains selected until an authority supplies observations.

Priority follow-up: the same paired-runtime fixture now also verifies that a steady special substate remains visible with no active action, and that observed walking cannot change its authored hooks. The pending post-physics selector must preserve local standing-charge/airborne selection and retire observations when physical presentation ownership ends. A stance-default command alone cannot identify local jump charge; that remains an explicit existing controller fact rather than a new inference from animation IDs. All 655 world and 356 core library tests pass after this ownership split.

Body-motion selector implemented in `motion/observed.rs`: `observed_locomotion_order` transforms supported timed velocity into body-local coordinates, chooses an available dominant-direction gait, and uses object scale when calculating playback rate. It selects an authored backward cycle when present, otherwise reverses an available forward cycle. Missing side content uses a forward gait without changing physical facing; missing locomotion or support-specific content chooses the stance default. Standing turn cycles are selected only without a moving gait. The current renderer has one clip, and ordinary modifiers contribute physics rather than installed animation layers, so the selector does not invent blended visual modifiers.

Accepted presentation concessions: shared scale-one reference speeds of 2 m/s for walk/backward/sidestep and 4 m/s for running, a 90-degree/s standing-turn reference, and small linear/angular idle thresholds approximate cadence. These are visual tuning constants, not physical limits or claimed per-creature calibration. Dominant-direction selection and coarse cadence can produce foot sliding; no root-track scan, extra physical solve, or animation blending is introduced. Active actions and explicit non-locomotion substates retain the prior ownership rules. `MotionSequenceTable::is_default_cycle` supplies default-cycle identity through existing table-key rules, so different command dispatch flags selecting the same ordinary idle row do not accidentally suppress observed walking.

Evidence covers body orientation, walking/running rates, object scale, absent backward/side rows, an available sidestep cycle, missing support/movement content, idle thresholds, and standing versus moving turns. Registry-level sidestep observation changes only the visible clip/rate and leaves the authored tick intact. All 75 content, 657 world, and 356 core library tests pass. The broader content Clippy run exposed an existing constant-chunk texture-loop lint; converted it to equivalent `as_chunks::<4>()` traversal. Post-physics selector scheduling and observation lifecycle retirement remain pending with the production contact driver.










This completes the supported-character actuation mapping, not scene publication or a free-flight return policy. No airborne walking motor, extra launch state, or alternate contact loop was added. Production still uses the retiring driver until the remaining publication and producer mappings are connected.

#### Observed locomotion retirement

Observed locomotion now relinquishes presentation ownership when collision simulation is unavailable or the entity is dead, absent, suspended, excluded from integration, non-grounded, or a missile. Settled grounded characters remain eligible. Core performs this retirement before authored advancement; the registry clears only the observed cursor, preserving authored playback, queued actions, and the latest authored tick.

An asset-free regression covers retirement during an action, unchanged authored frames/effects, and the eventual return to authored idle while another body's observed walking remains intact. World and core library suites pass (658 and 356 tests). This closes presentation retirement, not collection cutover: production still uses the retiring physical driver, and publishing collection observations into the selector remains outstanding.

#### World-owned observed presentation handoff

`WorldState::observe_integrated_locomotion` now connects supported timed motion to the existing visual selector and registry. It reads facing from the published canonical body, scale and effective motion-table identity from the owning entity, and stance from ordinary authored playback. The controller supplies resolved support/charge presentation. No reference position reaches animation, and this operation neither advances ordinary playback nor produces physics effects. Missing content or missing ordinary playback explicitly leaves presentation with its existing owner; missing canonical body/entity is an invariant error.

The asset-free world fixture deliberately gives authority and the published body different headings, checks the resulting walking selection, then submits a charge-pose observation during an authored action and verifies that the action and its authored output survive. World/core library suites pass (659/356 tests). This is the publication consumer, not live driver wiring: the retiring driver's aggregate displacement cannot stand in for supported timed travel, so the production call must be installed with collection publication rather than inferring gait from net separation.

#### First-contact reference capture

`PoseReconciliationState::begin_contact_return` now makes pre-contact capture explicit. An empty remote state captures the current pose with authored heading ownership; an existing physical reference, including a newer authority target and its heading policy, survives repeated capture. Local confirmation and pose-only reconciliation are rejected instead of silently replaced. The retiring pressure admission uses this operation in place of its inline overwrite logic.

The contact-collection owner must invoke capture before any separation for every eligible remote mobile, including settled bodies. Waiting until a sleeping body's first actuation callback is too late: that callback starts after contact has already moved and awakened it. Do not seed local-player confirmation, hard bodies, or projectiles through this policy. Empty transient references can be discarded at completion; reference allocation must not itself wake an otherwise untouched sleeper.

An asset-free fixture captures a settled mob, separates it from the player for one step, verifies that separation produces zero observed walking velocity, removes the peer, and runs bounded return through the collection until the mob settles near its original pose. It repeats capture during return to catch accidentally adopting the pushed pose as a new target. Another fixture preserves an authority target and checks that rejected local confirmation capture leaves its state intact.

Validation: 662 world and 356 core library tests pass, together with warnings-denied Clippy, formatting, and diff checks. This implements and exercises capture semantics; the replacement production collection still needs to own the full capture/advance/completion/publication sequence. It does not establish production cutover or performance acceptance.

#### Production collection cutover in progress

The production `SpatialScene::advance_dynamic_entity_collection` now invokes the bounded contact collection through `scene/contact_collection.rs`. It no longer invokes the pressure/shared solver. This supersedes earlier progress notes saying that the replacement kernel has no production caller.

The scene captures each eligible producer input once, including settled mobiles; captures remote references before contact; seeds free-flight continuation once; applies interval reference return or local confirmation; and publishes final mobile bodies with their checked membership, sampling time, reference completion, activity, and report observations. Fresh controller input wakes settled bodies before ordinary sampling; merely creating a transient zero-error reference does not. The sleeper-return fixture now exercises this production owner instead of manually managing reference state around the primitive.

Fixed-body placement is processed before the mobile snapshot so hard targets occupy accepted poses throughout the collection. Its ordinary tick still uses the old direct body solver temporarily. Mobile final states are assembled before their publication, and report observations are previewed/committed once for that collection. Existing placement refresh remains at admission; its cost and allocation reuse still require the planned structural cleanup and performance acceptance.

Core no longer calculates an explicit pressure population: `client/entity_pressure.rs` and its module registration are removed, and the production collection API no longer accepts a pressure policy. The debug harness no longer exposes independent/shared modes or asserts the rejected sub-millimeter overlap requirement. Its old filename and remaining pressure-shaped fixture data still need the final vocabulary/architecture sweep; no benchmark was run.

Routine mobile Interpolate/Snap effects now preserve retained continuation while replacing the physical reference. Initialize/reset and dedicated vector replacement retain their distinct lifecycle semantics. The packet-during-contact test supplies deliberately different incoming vectors and verifies that neither pose nor continuation pops, while allowing finite player displacement under the approved contact rule. Old player-immunity/non-retained-pressure return tests were deleted; grounded return, ballistic suppression, and time-admission expectations were migrated to the new behavior.

Supported collection motion now reaches `WorldState::observe_integrated_locomotion` after physical publication. Local authored and observed playback share one support/standing-charge presentation decision. The live handoff exposed an ownership gap around landing links: ordinary one-shot transitions now retain presentation priority, and the visual locomotion cursor selects only its cyclic tail. Concession: observed gait changes do not independently play transition links; authored actions and transitions preserve their own timing. A low-frame-rate authored run can remain visibly idle until it actually produces physical travel. This avoids both replaying landing links at observed gait cadence and allowing presentation to supply root motion.

Validation at this checkpoint: 660 world and 351 core library tests pass; the profiling harness compiles; formatting and diff checks pass. Warning-denied Clippy is **not clean**: production compilation reports dead old epoch/pressure/shared-driver structures and methods, which must be deleted rather than suppressed. No live/debug performance acceptance has been performed. This is a working production cutover, not completion of phase 5 or permission to claim the performance issue fixed.

Immediate remaining cutover work: delete the abandoned epoch/shared/pressure implementation and its architecture-specific tests; migrate fixed/direct/prediction consumers to the common step; audit projectile consequence publication and reference retirement; finish transient allocation/publication cleanup and support-aware confirmation auditing; then complete immutable camera querying, source-marker cleanup, and the planned debug acceptance gates. Keep the full goal active.

#### Retired-driver deletion and coverage migration

The retained prepare/move/finish epoch, per-body captured-commit checks, deferred epoch wake queue, pressure admission/query, shared interval solver, reciprocal shared-query branch, and their unused swept-index extension are deleted. The pressure policy and strength constants are no longer exported. Direct/snapshot prediction still uses the older directional solver; that remaining migration is separate from the now-deleted production collection driver. Warning suppression was not used.

Tests coupled to the retired driver were removed rather than retaining that driver under test-only compilation. Production-level tests now cover missing EnvCell suspension/recovery, an untouched sleeper surviving unrelated topology changes, stale support being re-proved after owner replacement, coverage eviction/recovery, and fixed authored bodies remaining stationary collision targets while rotating. The existing contact conformance suite retains correction/coverage, stairs/BSP, angular, projectile, return, and timed-observation scenarios. The removed multi-phase tests also covered object-scale/portal membership and precise direct-vs-collection equivalence; revisit those concrete invariants during direct-prediction migration instead of restoring the old preparation API or its body-order/immunity assertions. Temporary deleted-function excerpts are in `/tmp/contact-retired-scene-functions.rs` for that audit, not as retained runtime/test architecture.

The standalone workload is renamed to `contact_collection_benchmark`; its only population identity is a player ID, not a pressure policy. The retained 45-body benchmark now calls the production collection, gives its player the LocalPlayer identity/contact weight, and represents corner neighbors as hard targets through excluded integration demand. Both workloads keep residual-penetration measurements without imposing the discarded exhaustive-contact threshold. No timing run was performed during deletion.

Validation: 618 profiling-enabled world library tests and 351 core library tests pass; the manual benchmark remains ignored. Warnings-denied world/core test-target Clippy and warnings-denied profiling-harness Clippy pass, as do formatting and diff checks. This supersedes the preceding checkpoint's dead-code warnings and counts. Remaining work is still direct/fixed/prediction unification, projectile consequence/reference auditing, publication cleanup, camera servicing, source markers, and debug performance/live acceptance.

#### Production projectile retirement and entity-state publication

The impact audit found that the new collection cleared scene collision flags but did not publish the accepted consequence into the owning entity. It also allowed the sampled flight input to replay as ordinary motion during later substeps after the working missile flag cleared. Both paths are corrected.

`DynamicEntityBodyTick` now carries the existing typed physics-state consequence. `WorldState::apply_integrated_body` consumes that published result, updates the entity's effective physics state, and emits the runtime change alongside movement projection. Missing canonical body/entity at this handoff is an invariant error. The last server state and raw authoritative vectors remain unchanged. Authored ethereal/pending-solidification operations now preserve other locally effective bits, and their transition status compares the ethereal relationship specifically. A complete server state replacement still resets local prediction.

`PhysicalBodyInput::capture_contact_return` is a producer-owned admission fact. Core derives it from the entity's last complete server missile classification, so clearing the local missile flag does not make the next tick invent a contact-return reference for a stopped projectile. Scene capture still protects local-player confirmation independently. Observed locomotion likewise excludes server-classified projectiles after local impact. Explicit authoritative pose/reset effects retain their existing ownership; this admission flag governs contact-created targets, not suppression of server messages.

Within a collection, the first projectile impact consumes the sampled flight command and drops its pending return reference at publication. Subsequent substeps retain collision-response velocity but do not replay sampled authored travel or forces. Concession: ordinary forces resume on the next collection's fresh input, so their post-impact application can be delayed by the remainder of the admitted collection (at most the configured four small substeps). Elastic response remains elastic; the stopping regression explicitly uses inelastic response.

The asset-free production fixture includes a pending correction and authored flight travel, impacts the floor, verifies no post-impact command replay, projects retirement into entity state, and advances further ticks with an unchanged stale authoritative flight vector. No contact-return state is recreated. A separate state fixture checks that authored ethereal changes and deferred solidification preserve collision retirement, while fresh complete server state restores authority.

Source audit: ACE `PhysicsObj.cs:3320–3331` clears Missile for environment reports, while `:3345–3360` clears Missile/AlignPath/PathClipped for eligible object reports. `WorldObjects/SpellProjectile.cs:209–244` sends impact state/script, a zero vector update, and delayed destruction. This change reuses the existing local three-bit retirement consequence for both impact paths; it does not claim exact retail mask parity. Resolve/document that existing compatibility difference in the planned source-marker audit rather than silently changing it during publication wiring.

Validation: 620 profiling-enabled world and 351 core library tests pass; the manual benchmark remains ignored. Profiling-enabled warnings-denied world/core test Clippy and harness Clippy pass, as do formatting and diff checks. Remaining direct/prediction migration must preserve this same consequence contract. Camera, allocation/publication cleanup, compatibility markers, and live/debug performance acceptance remain unfinished.

#### Current-support confirmation audit

Local confirmed-travel composition now consumes the support proved for the current contact substep, just like the movement motor and reference predictor. Previously it reread the last published body contact, delaying contact-gated damping when support changed. An asset-free production-collection regression starts with unknown contact and exhausted confirmed travel, acquires floor support, and verifies immediate motor braking. Confirmation still changes requested command travel; it does not erase retained velocity or displace the player directly.

Direct/prediction migration audit: `apps/holtburger-3d/host/src/host_simulation_runtime.rs::tick_body_transaction` requires a complete tentative body/result and veto-before-publication semantics. `core/client/precise_jump_prediction.rs::predict_candidate` consumes placement paths, residency, entity identity/contact normals, static normals, and wall-constraint evidence. Its entity snapshot remains immutable. The common-step adapter must preserve these meaningful observations rather than fabricate legacy budget counters or silently discard contact facts. Fixed-body rotation/placement remains a separate admission operation, not a mobile force response. This audit does not complete the migration or change the approved frozen-peer prediction concession.

Validation for the confirmation change: 621 profiling-enabled world library tests and 351 core library tests pass; one manual benchmark remains ignored. Warnings-denied world/core test-target Clippy, formatting, and diff checks pass. Direct/fixed/prediction unification, immutable camera servicing, source-marker review, and debug performance/live acceptance remain open.

#### Fixed placement separated from mobile solving

Orientation-only bodies now finish through a dedicated placement operation before mobile solver preparation. The prepared mobile response no longer contains a fixed-body variant or translation branch. Fixed bodies retain the existing checked stationary placement path, zero linear continuation/acceleration, authored orientation plus world-space retained spin, and scene transaction/report ownership. Their observed angular rate is now derived after retained spin, correcting the prior mismatch between final orientation and cached angular motion. The production collection continues to publish these hard targets before mobile movement.

Removed the surviving externally accessible prepared-trial interface, unused angular-prefix finalizer, and clone-based trial test. Only the remaining directional mobile solver consumes this private preparation now. The replacement collection's existing launch-consumed-once regression owns that invariant; an obsolete trial API is not retained for tests. Direct mobile movement and frozen-target prediction still use the retiring solver and remain migration work. No new collision behavior or accuracy concession was introduced for fixed targets.

Validation: 620 profiling-enabled world and 351 core library tests pass; one manual benchmark remains ignored. The fixed-target regression covers unchanged coordinates, final rotation, observed angular rate, zero linear continuation, and hard-target blocking. Warnings-denied world/core test-target Clippy, formatting, and diff checks pass.

#### Prediction cutover and directional-solver deletion

`tick_physical_body_against_entity_snapshot` now advances the common bounded collection over a private mover and frozen authored peer surfaces. Only the mover is published. Peer state, authority, and report lifetimes remain unchanged. Prediction consumes ordinary launch/coast actuation from the actual starting body; it does not advance remote authority-return references. Frozen peers remain hard sweep targets, preserving the approved approximation rather than pretending to simulate crowd response.

Movement-only physical bodies now enter the same contact step without fabricated entity collision/report state. Their existing response cell seeds checked movement traversal; they integrate ordinary motion and publish physical response but own no entity reports or authored target shapes. Dynamic entity demand and activity keep their existing meanings. This supplies the missing kernel admission for explorer probes as well as precise-jump fixtures; direct explorer movement still needs its transaction adapter migrated.

Precise-jump prediction consumes ordered accepted impacts and timed placement segments instead of legacy directional contact/budget fields. Impact observations now retain the primary sphere's position and cell at the accepted instant. Descending landing probes also publish their accepted contact before restitution can make the body airborne again. The 26.5 m capability-envelope regression exposed lost probe landings followed by later bounce/support publication; first-contact geometry fixes it without widening the landing tolerance. Placement changes stop at first impact and normalize against its physical time. The visual arc remains the existing analytical approximation.

The entire old directional entity solver, its slice/refinement limits, proposal/constraint coordination, dead contact result type, and obsolete directional tests are deleted. The solidification overlap query remains in `dynamic_index.rs`, beside the entity geometry it consumes; collision-domain intersections reuse `SpatialMembership::intersects_reached`. Unconsumed broad-phase rotation extents and swept-root bounds are removed. Existing replacement contact/launch/escape tests own the new behavior. The high-skill jump test still checks all half-meter targets through the capability envelope; the obsolete expectation that selected distances must succeed on candidate one is removed.

Validation: 617 profiling-enabled world and 351 core library tests pass; the manual benchmark remains ignored. This includes all 14 precise-jump tests and a new prediction-versus-production hard-contact comparison that also verifies frozen peer immutability. Warnings-denied world/core test-target Clippy passes.

The broader host check exposed an outstanding earlier-cutover caller: `host_simulation_runtime.rs::tick_dynamic_entity_collection` still calls the deleted prepare/tick/finish epoch API. Host compilation currently fails there. The next integration step must replace that host collection adapter and its per-body legacy result consumers, then migrate direct movement transactions. Do not restore the retired API to make the host compile. Prediction also currently computes and discards collection report observations; skip that work during the pending collection publication/allocation cleanup. Camera servicing, compatibility/source-marker review, and debug performance/live acceptance remain incomplete. No new user policy decision is required.

#### Explorer collection adapter cutover

The explorer host now calls `advance_dynamic_entity_collection`; the deleted prepare/tick/finish API is no longer a host dependency. `HostDynamicBodyTick` carries canonical before/after bodies, accepted root paths, effective-state consequences, and the immutable collision scene. Entity delivery and follow-camera consumers use that result directly. Possession commits accepted collection results without the retired substep/contact-budget status branch; its probe schema now exposes only the completed `solved` status. Unchanged sleepers remain filtered from host delivery, while awakened/contact-displaced bodies are retained.

`CollectionBodyMotion` preserves the two real sources of accepted geometry: an existing checked root path for fixed placement, or timed movement-sphere segments for mobiles. Root projection retains their placement proofs, holds gaps, and excludes root translation from angular sphere chords. It runs only for host path consumers, without another collision query. An offset-sphere rotation regression verifies that the published root does not orbit with its collision sphere.

`PhysicalBodyInput::reference` is now optional. Autonomous explorer actors explicitly provide no authority reference and do not capture a contact-return target; client and benchmark producers retain their explicit independent inputs. Requesting contact-return capture or physical return without reference input is an invariant error. Explorer authored playback now consumes the same admitted duration as its physical collection.

The host compiles again. The projectile state-publication fixture now advances separate admitted intervals instead of expecting one oversized interval to simulate all elapsed time. The fallback-run fixture now verifies its resolved terminal speed after the motor's acceleration time, rather than requiring an instantaneous tenfold displacement. Fixed-size byte/triangle iteration was updated mechanically to satisfy the current compiler's warnings-denied Clippy lint.

#### Authored frame steps are not continuous motor demand — resteer approved

The host integration reopened the input-model gate. `MotionSequenceRuntime::advance_within_clip` applies root transforms when an integer animation frame is departed; `depart_frame` composes each complete root transform into `SequenceTick::offset`. Both explorer possession and the client convert that tick offset to requested velocity by dividing by the physical tick duration. The compliant motor then caps velocity change each substep. At animation rates below the physics cadence, that is a burst of high requested speed followed by several zero-speed requests. The motor accelerates briefly and brakes between authored frame departures, losing most intended travel.

Concrete asset-free evidence: the explorer walking fixture has four authored root frames at 4 fps. Across fifteen 1/30-second ticks, the new path moves only 0.036111 m and fails the retained >0.5 m walking assertion. Mixed authored-forward/fallback-sideways movement preserves the continuous fallback axis while losing most authored forward travel. The moving-charge locomotion case also fails. This is not evidence for weakening those assertions or raising the motor's acceleration to approximate instantaneous velocity replacement. The same offset-to-velocity boundary exists in `core/client/simulation.rs`, so the issue is shared rather than explorer-only.

User approved the timing resteer: supply a continuous authored movement sample over fractional animation-frame progress to actual actuation and independent reference advancement, while keeping hooks and action completion on their existing discrete ownership. Preserve frame endpoints, variable root translation/rotation, action ordering, and exactly-once effects. Audit this timing contract before implementing it; do not add a per-body catch-up queue or layer reactive smoothing onto the contact solver. The tradeoff is changed within-frame movement timing relative to retail's departed-frame application. No claim of exact retail timing should survive that change.

Verification when this gap was raised: 618 world and 351 core tests pass; the focused TypeScript session suite passes 10 tests and the complete app type checks pass. Host testing currently has three meaningful authored-motion failures; the other 268 tests pass. Warnings-denied world/core/host Clippy passes. Browser/live acceptance has not run because the analytical input gate is open. Direct movement transaction migration, prediction report-work cleanup, immutable camera servicing, compatibility markers, and debug performance/live acceptance remain unfinished.

The approved implementation samples movement over fractional frame progress in the shared sequence owner. Hooks and action completion retain their existing departure traversal. Each directed frame's root movement and explicit motion-data physics define a local path; relative samples are composed into the tick offset. The reference predictor reuses the same straight-translation/shortest-root-rotation interval primitive. No smoothing state or queued travel was added. Explicit omega is evaluated at sample time, preserving its direction rather than reducing a whole frame's angular velocity to a shortest arc.

Timing concession: motion-data velocity/omega now participate in a frame-local sampled path. Retail applies their frame slices to the accumulated tick transform (`acclient.c:327150–327189`, `CSequence::apply_physics:326355–326382`), whose mixed translation/turning result can depend on tick partitioning. We intentionally prefer a consistent sampled frame path. Pure authored frame endpoints are preserved; this is not a claim to preserve retail's mixed root-plus-physics trajectory. Reverse playback retains the existing epsilon inset at clip entry. Archive compatibility review remains outstanding; no new archive census has been performed during this cutover.

Focused validation so far: 65 motion tests pass, including continuous low-rate movement, explicit velocity between hook departures, and partition-equivalent rotating movement across clip wraps in both directions. The three original host authored-motion regressions pass. One additional host test had assumed a tenfold command produced near-tenfold distance during the same half-second acceleration window; it now checks settled speed and playback scaling at reachable speeds. Full verification now passes: 620 world tests (one manual benchmark ignored), 351 core tests, and 271 host tests. World/core/host warnings-denied Clippy also passes. The core moving-charge presentation assertion now expects locomotion before the first whole run frame departs, reflecting the newly continuous movement. Live acceptance and the remaining solver/camera cutovers have not run.

#### Direct mobile solver and reconciliation cutover

Single-body mobile solving now uses the same bounded contact collection over a private mover snapshot. The scene still invokes its consumer before publishing the body and report lifetime changes; missing collision coverage rejects this direct transaction so a probe can load and retry. Fixed-position movement remains a separate orientation/placement operation. Direct probes currently retain their existing environment-only collision scope; frozen authored entity targets remain the explicit prediction API's responsibility.

Deleted the unused directional constraint type/projection and their empty-list plumbing, the old generic free/grounded preparation and response dispatch, obsolete budget conversion, and unused geometry stepping accessors. The generic physical motion contract now carries its placed path and the common collection's actual substep count. Physical-fly host/frontend contracts no longer expose the retired constraint count, separation-pass count, or budget-failure variants. Independent static geometric queries used by camera/terrain tools are still present; they are not entity movement drivers.

The cutover exposed two shared publication/lifecycle omissions. Supported coasting now applies the existing canonical resting-velocity floor before friction/forces, allowing it to reach rest without preventing the motor or gravity from initiating movement. The contact result now owns final response acceleration; actual publication uses that value, and grounded actuation shares the support-to-acceleration calculation. This is a correction to the common collection too, not an adapter-specific rule.

Retained direct-body tests were migrated to admitted physical duration and bounded motor semantics, while retaining checks for exact hook/placement ownership, world-axis rotation, hard impacts, launch-once behavior, missing-owner rollback, and consumer veto. Removed differential tests for the deleted generic response/settle wrappers; the impact-velocity and geometric oracle tests remain. Verification passes: 618 world tests (one manual benchmark ignored), 351 core tests, 271 host tests, 29 focused frontend motion/session tests, app type checks, and warnings-denied shared/host Clippy. Placement recovery is checked anywhere along the admitted path rather than only at its final endpoint. The child/viewer path contract now accepts an initial zero-time correction followed by strictly increasing timed waypoints, and the shared frontend validator agrees; dedicated Rust/TypeScript regressions verify that correction precedes interpolation. Browser/live acceptance has not yet run.

Direct reconciliation input cutover is now implemented: direct callers provide `PhysicalBodyInput`, and both direct and collection paths use its shared preparation and substep methods. Autonomous explorer probes explicitly have no authority reference. The simulated-vector fallback, additive correction field/adapter, and old reference-rate method are deleted. The common step reports projectile retirement directly to tentative publication. Consumer callbacks now see the complete tentative body, including updated reference state; a regression verifies that veto rolls back both body motion and independently advanced reference, while retry publishes both. Scene fixtures use explicit stationary nominal input, and the moving ethereal/report fixture supplies its known authoritative velocity instead of copying simulated continuation. Prediction and environment-only direct probes now skip authored report-shape preparation, report indexing, and traversal observation through the same collection implementation. Production collections retain reporting and skip its preparation when there are no updated bodies. Existing prediction-versus-collection parity tests cover unchanged physical results. Fixed-position actors remain excluded from mobile reference capture even when the producer enables return for remote entities. Immutable camera publication, performance/live acceptance, and compatibility review remain outstanding.

Shared-input verification after this cutover: 617 world tests pass (one manual benchmark ignored), 351 core tests pass, and the host suite passes 271 tests. The debug contact benchmark builds against the typed direct API. The removed confirmation-adapter tests were tied to the deleted pre-solve transformation; retained common-step confirmation tests and the direct reference/veto regression exercise the actual path.

Initial camera servicing audit (superseded by the cutover below): camera commands and camera solving shared the simulation loop, and the controller read `WorldState` directly. A collision `Arc` alone could not provide independent orbit cadence. The required boundary is exact immutable target identity/definition, accepted target path or pose, and matching collision topology, with independent servicing of the single controller. Preserve precise-jump invalidation and lifecycle ordering without duplicating mutable world state. Explorer's hot collection-product boundary is clarified below.

Camera input extraction progress: `ClientCameraSceneInput` now captures the hydrated player identity, optional canonical body/physical definition, current pose, optional accepted local-player travel, and the matching collision `Arc`. Camera advancement and activation settlement consume this owned query view instead of reading `WorldState`. Registration validation remains with the world owner. The camera retains the consumed travel publication instant, rather than retaining and replaying target samples; subsequent advances against the same publication use the captured current pose. A correction-only update also refreshes the target without requiring an integrated path. Capturing currently copies one local-player path; collision topology is shared, and no second mutable world is introduced.

At the input-extraction checkpoint, commands and advancement still shared the simulation loop. The following client worker cutover completes independent client servicing; Explorer and runtime acceptance remain open.

Validation for camera input extraction: all 352 core library tests pass, including a new asset-free regression for snapshot independence and target refresh without integrated travel. Core-only warnings-denied Clippy (`--no-deps`) passes. Dependency-inclusive Clippy is currently blocked by two diagnostics in unchanged protocol code: `chunks_exact_to_as_chunks` in `messages/chat/turbine.rs:524` and `question_mark` in `messages/movement/types.rs:290`. Browser and debug live acceptance remain outstanding.


Client camera servicing cutover: `ClientCameraService` now owns the single controller behind a camera-only lifecycle mutex. A scoped dedicated worker advances it at a 16 ms cadence using the latest immutable `ClientCameraSceneInput`; entity simulation never holds that mutex while solving bodies. The host receives a `ClientCameraInputHandle` and applies orbit/zoom and projection clearance without the world command queue. Start/stop/reset and activation settlement remain world-owned, preserving precise-jump identity/invalidation. Registration discards the prior input and publishes `CameraStarted` under the lifecycle lock. Active-world input is accepted immediately, while solving waits for a fresh physics collision publication; teleport activation continues to reject ordinary input. Dynamic entity events are sent before publishing their corresponding camera input. Camera ticks are sent under the lifecycle lock, so reset cannot be followed by a stale worker tick. Runtime cancellation joins the worker and retires retained direct input handles; worker failures are surfaced to the runtime.

Concurrency tradeoff: start/reset/settlement, input acceptance, and publication may wait for one camera solve. They cannot wait behind a crowd solve on this lock. This deliberately avoids a second controller or an asynchronous activation/acknowledgement state machine. Target travel is consumed once on the camera cadence; subsequent camera ticks hold the latest published body pose. This does not add a second moving-body prediction. Exact synchronization of the target path's playback duration with frontend body interpolation is not established by the worker unit test and remains a live/browser acceptance item. Removed unused active-camera request copies, an always-zero pending output sequence, and optional profile storage whose only production constructor always supplied the profile.

Validation: all 354 core, 271 host, 268 protocol, and 22 catalog library tests pass; 19 focused frontend camera session/path tests pass. The worker regression receives successive camera publications without running the world loop or publishing further physics, accepts active-world input before the first physics publication, rejects a retired generation after reset/re-registration, and checks handle invalidation after worker shutdown. A separate teleport-registration case verifies suspended input until world publication. Dependency-inclusive core/host warnings-denied Clippy now passes after mechanical fixes for the current toolchain's constant-chunk iteration and optional-unpack diagnostics in protocol/catalog code. Formatting and diff checks pass. These results supersede the earlier Clippy limitations; browser/live acceptance has not run.

Explorer follow-up audit: `HostKinematicBoomRuntime::advance` already consumes the collision/body products from `ExplorerEntityCollectionTick`; it does not lock `HostSimulationRuntime` during the hot camera solve. The simulation/body snapshot lock is used at registration. Therefore do not add a broad cloned body snapshot to fix orbit cadence. Split the existing exact collection target publication from boom advancement and service that camera independently while preserving possession invalidation. Explorer servicing and browser/live acceptance still keep the camera checklist open.


- [x] Audit successive-tick reference/actual/presentation ownership, packet arrival, action priority/completion, and feedback analytically; record the approved character design and presentation concessions above.
- [x] Before collection cutover, implement typed nominal input assembly from existing authority/command sources, explicit reference orientation and lifecycle, and the bounded character return/braking law. Map grounded, airborne, free, projectile, local-player, and vector-only producers explicitly; no fallback to simulated velocity. Add focused stationary/moving reference, packet-during-return, and completion-with-residual-velocity cases.
- [x] Separate authored intent/root-effect consumption from body-driven locomotion presentation in world motion runtime and core scheduling. Reuse action ownership/selection; represent mixed action/completion traversal accurately. Validate action start/completion, action root motion and hooks exactly once, blocked/returning locomotion, and absence of presentation-to-physics feedback with asset-free fixtures.
- [x] Derive supported timed movement once in the collection result for the host presentation selector; exclude separation/stair adjustments. Keep frontend clips/reference-free and audit missing directional animations against table capabilities.
- [x] Integrate bounded authority return and cheap reference prediction without a second collision solve, plus reference lifecycle in `scene.rs`/`pose_reconciliation.rs`; route all motion consumers through the new step.
- [x] Replace per-body captured commits with one collection advance and results for all changed bodies. Aggregate reports once, preserve correction traversal/ownership, and update prediction callers explicitly.
- [x] Align core `simulation.rs`/`runtime.rs` physical-time admission, authored sampling, impulses/effects, and publication. Publish corrections to both collision/rendering and player movement consumers.
- [x] Delete `entity_pressure.rs`, pressure policies/strength machinery, shared proposal/group driver, and incompatible held-state paths at cutover. Keep one production implementation; replace tests that encode retired immunity or full-separation assumptions.
- [x] Address camera servicing against an immutable published query view without introducing a second mutable world.

Acceptance: incoming authority and ordinary motion use the same contact rules; a residual contact never discards a crowd step; player displacement is canonical; stationary poses cannot accumulate discarded-motion gravity.

### Bounded structural review before further integration

Scope: at the user's request, paused implementation before the Explorer camera cutover. Reviewed one ordinary grounded remote-body tick through input, return, solving, publication, and animation, plus client camera registration, advancement, and reset. Included the untracked collection and camera-service implementations, not only tracked diff statistics. This is a maintainability review of those paths, not a claim that every changed file, physical mode, or performance gate has been audited. No Explorer implementation changes were made during this review.

**Ordinary body trace.** `client/simulation.rs::tick_with_precise_jump` admits elapsed time before advancing the authored cursor and consuming physical hooks. `tick_physical_entities` samples the command, scaled/support-gated authored travel, and independent authoritative vectors. `scene/contact_collection.rs` captures private body/reference state; `PhysicalBodyInput::prepare` seeds eligible return and explicit flight continuation. Each admitted substep calls `PhysicalBodyInput::step`: ordinary input predicts the reference arithmetically, and reference error adjusts the body's bounded motor. The contact kernel handles hard sweeps and local mobile separation; its output distinguishes timed motion from positional adjustment. The scene publishes accepted body/reference state and report lifetimes. Core consumes that result, reconciles support changes, and feeds the producer-computed supported motion to observed locomotion. `BodyMotionRuntime::presentation_sequence` preserves authored action, one-shot, and explicit-pose priority. Presentation does not feed a root offset or hooks back into physics.

**Camera trace.** World lifecycle permits registration and validates the player instance. The camera service serializes controller registration and `CameraStarted`; precise-jump invalidation completes before the world command returns. Active-world physics publishes a coherent query input after its dynamic entity event. The worker advances the sole controller against that input, consuming target travel once and subsequently using the latest target pose. Registration and input sequence checks guard distinct stale-message cases; collision/body hydration checks guard actual asynchronous availability. Reset retires registration, placement, input permission, and query data while retaining monotonic generation issuance. Worker event publication shares the lifecycle lock, and cancellation joins the worker before retiring retained input handles.

Findings and disposition:

| Finding | Evidence and consequence | Disposition |
| --- | --- | --- |
| Camera input permission was inferred from snapshot presence | The service tested `input.is_none()` to reject commands. Active-world registration manufactured `ClientCameraSceneInput::capture(world, None, None)` to permit input before collision publication. Query data was doing lifecycle work. | Fixed now, because the Explorer servicing work would otherwise copy the pattern. A private `ordinary_input_allowed` field is explicitly world-owned; optional query input only controls availability for solving. Registration accepts active-world commands without constructing a snapshot. `publish_active_world` explicitly resumes servicing. One `CameraState::reset` retires permission, input, and controller together for reset and worker shutdown. No new worker framework or boxed state hierarchy. |
| Authored motion has two descriptions in physical input | Client actuation creation computes a full-tick grounded target, while `PhysicalReferenceInput` also carries the authored offset. `PhysicalBodyActuation::contact_step_input` replaces the sampled target with substep-authored travel when that offset exists. Support gating/scaling is also requested while building both representations. | Confirmed maintenance duplication, not evidence of double displacement: the substep value replaces the full-tick value. Consolidate this input description in a focused follow-up before completing the remaining motion integration. Preserve the genuinely different actual-body and reference-coordinate transforms; they are not redundant calculations. Do not change numerical policy under the guise of cleanup. |
| Return policy permits an invalid public combination | `PhysicalBodyInput` exposes `capture_contact_return: true` independently of `reference: None`; `prepare` rejects it at runtime. Current production callers inspected here supply the reference. | No observed failure, but a public construction weakness. Couple reference presence and capture policy at construction in the same focused input follow-up. Do not add another per-substep validation. |
| Prepared bodies repeatedly recover guaranteed fields | Collection admission selects physical/dynamic bodies, then capture, actuation sampling, and publication repeatedly unwrap/check those fields from a general `SpatialBody`. The private collection cannot concurrently lose those bodies. | Keep invariant failures until the contract carries the guarantee; deleting checks or replacing them with unchecked access is not a fix. During collection cleanup, narrow the private prepared input/working access where it removes repeated recovery. A global body-store/type rewrite is outside this finding. |
| Some apparently repeated decisions have different owners | Public query entry points validate independently callable inputs; wake-on-contact during substeps differs from deciding final tick settlement. Actual/reference transforms use different poses. Registration permission differs from permission to accept ordinary camera input during activation. | Retain these distinctions. Do not consolidate by name alone or remove boundary checks merely because the normal client caller already validates. |
| Animation ownership is coherent, but Explorer integration remains incomplete | Authored playback owns root motion/hooks. Observed locomotion has a presentation-only cursor; selection-owned permission plus action/one-shot state determines visibility. Explorer does not yet consume the new supported-motion observation in the inspected path. | Preserve the shared action owner and visual-only cursor. Finish the existing Explorer consumer rather than inventing an animation priority framework or feeding observed clips into actuation. |

Justified tradeoffs: keep one camera controller and the camera-only lifecycle lock; lifecycle operations may wait for one camera solve, never a crowd solve on that lock. Keep separate authored and visual cursors because they represent different motion when a body is blocked or returning. Keep private working state for transactional publication. None of these concessions makes unnecessary representation or repeated policy decisions acceptable. Cosmetic renaming, wholesale module moves, and generic prepared-body/actor abstractions are deferred.

Maintainability acceptance criteria for the remaining work:

- [x] Ordinary camera input permission is explicit and independent of query availability. Active-world input before the first scene publication, activation suspension, stale generation rejection, and shutdown invalidation have asset-free regression coverage.
- [x] Reset and worker shutdown use the same camera-state retirement operation; no dummy query snapshot grants permission.
- [x] A body's ordinary authored travel has one prepared source. Support/scale treatment is applied once; actual and reference integration consume that source in their respective frames. No full-tick target survives solely to be overwritten by a second authored representation.
- [x] Public physical-input construction cannot request contact-return capture without independent reference input. Any remaining invalid-combination check has a named reachable external-boundary case.
- [x] Each repeated physical/dynamic recovery in the reviewed private collection path is either removed through a narrower prepared contract or justified by a named boundary where the fact can differ. Limit changes to that path; preserve checks for independently callable public query inputs and genuinely changing support. Do not introduce a general prepared-body hierarchy to satisfy this criterion.
- [x] Explorer observed locomotion consumes the existing accepted supported-motion result. It cannot consume positional correction as locomotion or become a source of authored root motion/hooks; actions and explicit poses retain the shared selector's priority.
- [x] Explorer camera advancement reads only its published target input. Camera event sequencing and sink publication are ordered together without taking the lock held during entity simulation. Do not clone the whole body scene or recreate data-dependent command permission.
- [x] Before declaring integration complete, trace these same two paths again and name one owner for each policy decision. Every added type/field must remove an identified ambiguity or carry a fact with a named consumer; finite iteration counts alone do not satisfy this gate.

The focused input-contract follow-up and private collection cleanup are implementation debt, not a new solver design phase. No broad rewrite or protracted evidence run is authorized by this review. Resume implementation only within these boundaries, and keep the original functional/performance acceptance gates open.

Review validation: all 354 core library tests pass after the permission/reset change, including the existing active-world-before-publication and teleport-suspension camera regressions. Dependency-inclusive core/host warnings-denied Clippy, formatting, and diff checks pass. No live session or performance run was performed for this structural review. Implementation paused at this review checkpoint; the bounded input follow-up below resumes within the recorded constraints. The broader plan is not complete.

### Focused physical-input follow-up

The first two body-input findings from the bounded review are addressed without a new input hierarchy. `PhysicalBodyInput::autonomous` constructs input without a reference; `PhysicalBodyInput::referenced` requires the independent reference and an explicit contact-capture policy. The interdependent reference/capture fields are private, so external construction or mutation cannot request capture without its reference. Migrated production, harness, and fixture callers and deleted the repeated preparation-time check for that invalid combination.

Client grounded and authored-flight producers no longer compute a full-tick target that substep sampling immediately overwrites. The scaled/support-gated authored offset is retained once and sampled by actual-body actuation and independent reference prediction in their respective coordinate frames. Explicit local flight control, one-shot launch, and fixed-position orientation remain separate inputs with their existing precedence. Reference prediction now recognizes authored travel directly instead of relying on a redundant `Driven` target to signal its presence. Autonomous Explorer producers already have one actuation source and do not acquire an authority/reference layer in this change.

`PhysicalBodyInput::permits_dynamic_settling` now considers the complete ordinary input, so removing the duplicate target cannot accidentally put an authored mover to sleep. Concession: an authored sample counts as work even when its current offset is stationary. This preserves the prior grounded authored-command activity rule and conservatively extends it to authored free flight; it may do extra work for an idle authored flight sample. Do not add a separate idle-detection policy without evaluating this in the existing performance gate.

The client adapters also consume the physical definition already captured by their caller instead of unwrapping it again. Grounded actuation stays grounded until the final enum wrapping, removing an impossible variant check. Removed the private local-actuation interval check because its sole caller has already admitted nonzero bounded time. Independently callable public query validation remains. The subsequent private collection cleanup below closes the separately bounded recovery criterion; it does not change the general body-store representation.

Validation: 618 profiling-enabled world library tests pass, with the manual benchmark ignored; 354 core and 271 host tests pass. The new asset-free case starts with a settled body and supplies authored movement without a redundant driven target; it proves wakeup, physical/supported motion, and exactly one authored increment of the independent reference. Existing actual/reference frame, motion partition, launch, and return tests pass. Dependency-inclusive warnings-denied world/core/host Clippy and the profiling debug harness build pass. No browser/live or performance run was performed for this contract change.

### Collection preparation and final review checkpoint

Collection preparation now retains the mobile-admission decision made after residency refresh. Refresh can suspend or reactivate a body, so moving that decision before refresh would be incorrect. The prepared `(body id, integrates mobile)` list replaces the rejection set and the second recovery of physical/dynamic fields during input capture. Fixed placements still finish before mobile snapshots and authored inputs are captured. Shared `PhysicalBodyInput::prepare` owns input-driven wakeup, avoiding another collection-only recovery of the same fields.

Remaining checks have specific boundary owners: residency refresh accepts general bodies; shared input preparation also serves direct ephemeral queries without a dynamic lifecycle; solver-result application/publication uses the general physical-body result contract. These checks remain explicit invariant failures or legitimate optional lifecycle access. Removing them would require widening this change into body-store/result typing. That cost is not justified for this bounded review. The captured admission boolean is private and has one consumer; it is not another persistent activity state. Final settlement still depends on accepted support, velocity, displacement, and remaining return work, facts that preparation cannot guarantee.

Validation of the collection cleanup: 618 profiling-enabled world tests pass (one manual benchmark ignored), plus 354 core and 271 host tests. The focused authored-input regression also passes with both settled and suspended initial activity: residency reactivation precedes input admission, input wakes the body, and authored travel advances the reference once. Dependency-inclusive world/core/host warnings-denied Clippy passed for the production changes. No live or performance result is implied.

**Explorer camera trace and integration constraint.** `HostKinematicBoomRuntime::start` validates the possession epoch and captures resident target geometry before installing its camera generation. Ordinary advancement already consumes the collection's collision/body product rather than querying the mutable simulation again. It runs immediately after the body collection in `ExplorerEntitySimulation::fixed_tick`, however, so it still waits for crowd work. Exact-generation stop retires that camera; a collection with a different possession retires it during advancement. The independent service must preserve explicit possession retirement even when no new body sample is available, and must consume each target path once before holding its endpoint.

`ExplorerEntityDelivery::fixed_tick_envelope` allocates the shared epoch inside the current simulation publication gate, but the participant sends the envelope after leaving that gate. The frontend rejects envelopes at or below its highest received epoch. Therefore, adding an independently sending camera can make a later camera epoch overtake and discard a valid entity event. This is an analytical integration hazard, not a claim of an observed current two-producer failure. Also, `HostFixedTickRuntime` runs participants sequentially: adding a camera slot to that same scheduler does not decouple camera work.

Before the Explorer camera cutover, order epoch allocation and actual sink delivery together in a short publication operation that does not hold the crowd-simulation lock. Preserve snapshot/mutation ordering and explicit camera retirement; do not solve this by retaining a second mutable scene, cloning all bodies, or building a generic scheduler framework. Add a focused ordering regression where the entity producer is delayed while camera publication proceeds. The existing envelope already permits camera-only and entity-only payloads, so a new wire protocol is not justified merely to split cadence.

Review disposition: the completed input/preparation consolidations are sufficient foundations for the remaining work. Explorer observed locomotion must forward the solver's supported-motion fact through the host adapter into the existing presentation selector; it must not recalculate locomotion from total displacement. Explorer camera publication is the other prerequisite identified above. Cosmetic module moves, broad body typing, and general priority/scheduler frameworks remain deferred. The final body/camera retrace and functional/performance gates remain open; bounded computation alone does not establish maintainability or responsiveness.

### Explorer observed locomotion integration

The host collection adapter now forwards `supported_motion` unchanged from the shared solver result. `ExplorerMotionState::observe_body` consumes it after the physical transaction and accepted possession playback commit, before selecting the published presentation. It uses the existing shared gait selector and visual cursor; authored root travel and hooks still come exclusively from commanded playback. Extracted the existing possession support/charge policy into one helper used by both authored orders and observation, preserving the target-table Ready/Falling capability behavior.

Observation retirement preserves authored playback and actions. Same-GUID replacement clears its prior visual observation; semantic exclusion/projectile demand clears observation before ordinary playback advancement. Non-grounded committed bodies relinquish observation. Coverage rejection takes precedence over a simultaneously accepted prefix, preventing that prefix from reinstalling a gait after retirement. Settled bodies retain their last accepted idle presentation. No duplicate physical world, animation action owner, or generic priority mechanism was introduced.

Concession: visual gait uses the shared approximate walk/run reference speeds, independently of the target clip's root speed and commanded run scalar. Physical authored travel retains its existing scalar semantics. An observation is not a new physics input. The new host regression checks published cadence against accepted supported velocity, then keeps a nonzero body path with zero supported motion and verifies idle presentation, unchanged authored state/frame/tick, and restoration of authored presentation when observation retires.

Validation: all 272 host library tests pass, including existing jump/charge, fallback locomotion, and late-publication cases. Dependency-inclusive world/core/host warnings-denied Clippy and diff checks pass. Browser presentation and live debug crowd validation remain required; this is source/unit evidence only. The next implementation boundary is independent Explorer camera servicing with ordered epoch allocation and sink publication, as constrained by the structural review.

### Explorer publication ordering prerequisite

The camera cutover audit confirmed that the existing entity publication gate protected capture but not the subsequent send, both in `ExplorerEntitySimulation` and in snapshot/mutation command handlers. Corrected those callers to retain the entity gate through actual event delivery. This keeps snapshots, corrections, lifecycle outcomes, and body publications ordered with their source mutation. It does not move camera work onto that gate.

Replaced the public envelope-building operation with `ExplorerEntityDelivery::publish_fixed_tick`: project the payload first, then hold a separate epoch mutex from epoch issuance through the synchronous sink callback. A camera-only caller can use this operation without the entity mutation gate. The lock order is entity gate (when needed), fixed-tick send gate, transport writer; a camera-only publication starts at the send gate. No new event queue, history, wire type, or generic scheduler was added. Empty payloads no longer consume epochs; consumers require monotonicity, not contiguous numbering. Sink failures continue to leave accepted physical state committed and consume their issued epoch.

Tradeoff: a camera send can wait for another event's synchronous transport write, but cannot wait for crowd solving on the send gate. A slow transport remains possible and must be measured in the existing live acceptance run. The manually stepped HTTP browser harness captures the envelope as its request result; it has no background camera producer and is driven by sequential awaited tick requests. That harness path is not evidence of concurrent push-delivery ordering. Production push callbacks send before returning; they must not reenter fixed-tick publication.

Validation: all 274 host library tests pass. Two new focused concurrency cases prove that camera-only delivery progresses while another thread holds the entity work gate, and that a delayed sink cannot be overtaken by a later issued epoch. All-target host Clippy (including the migrated development content host) passes with warnings denied; formatting and diff checks pass. These tests cover the publication prerequisite, not an independently scheduled camera.

Remaining cutover: split camera target publication from controller advancement; preserve explicit possession retirement even without body samples; consume target travel once and then hold its endpoint; install an independently owned worker with deterministic shutdown; route its camera-only events through this send boundary. Do not install another participant in the existing sequential physics scheduler and call it independent. Browser/live verification and the final lifecycle retrace remain open.

### Explorer camera target publication split

Replaced the combined collection-and-camera `advance` operation with `publish_target(collection)` and `advance(duration)`. The publication adapter remains the owner of child-sphere topology adaptation; the camera controller now reads only generation-local published input. Registration supplies its already-proved stationary seed, so a registered camera can advance before the first body publication. No entity registry or simulation lock is acquired during advancement.

One private target enum represents either usable collision/path input or a recoverable target-contract failure. A failed publication replaces earlier usable input rather than continuing with stale travel. Successful advancement attempts consume the published path once, retaining only its normalized endpoint for later camera ticks, including when the controller reports a recoverable error. Existing selected-sphere, uncovered-owner, held/fallback, and generation rules are preserved. All production, manual-harness, and test callers use the split operations; no combined compatibility method remains.

Concession: target publications replace pending target travel rather than building a queue. If several body publications arrive before camera servicing, the controller receives the latest proved target path and uses its existing transit/reseed rules from its actual camera state. Intermediate visual target history is not preserved. This keeps camera servicing from accumulating catch-up work and requires browser/live confirmation of acceptable following behavior.

Validation: all 274 host library tests pass. The existing possession/camera integration case now advances from the registration seed before any collection, advances with the entity registry deliberately locked, and advances again without a new target publication. Existing coverage-loss, missing-target, generation-replacement, and finite-work recovery cases pass through the split API. All-target host warnings-denied Clippy passed for the production split; formatting and diff checks pass. This is not yet an independent-worker result.

Next lifecycle requirement: authority release, replacement, reset, and shutdown must retire the cached camera explicitly, even if body ticks stall. Currently the collection publication still provides that retirement signal. Complete explicit retirement and generation-safe event publication before enabling independent advancement. The ordinary composition still calls publication then advancement on its entity cadence at this intermediate checkpoint; the scheduler, browser/live tests, and final ownership audit remain open.

### Independent Explorer camera servicing and explicit retirement

Explorer production now installs an owned `explorer-camera` thread. It advances on its own approximately 16 ms cadence using actual elapsed time, without a catch-up queue. The entity participant publishes target data and entity-only envelopes; the worker publishes camera-only envelopes through the short epoch/send boundary. It does not use the sequential physics scheduler or acquire the entity registry/simulation lock. The manual HTTP harness still drives the split target/advance operations explicitly for deterministic scenarios.

`ActivePossession` now owns one revocable `PossessionLifetime` token. Proposal clones share the same token; registration captures it while validating the exact possession identity. Release, replacement, target retirement, and registry reset revoke it through the existing motion release owner. This avoids maintaining another copy of possession identity or asking the entity registry for permission on every camera tick. Registration rechecks the token after target preparation; input updates and camera advancement honor it. An older mismatched collection is ignored rather than retiring a newer live registration. Actual retirement comes from the token, independently of target-data availability.

The camera owns its lock before entering the lifetime operation. Advancement and production sink delivery finish while the lifetime lock is held, so no old event can follow completed retirement. Authority retirement takes the lifetime lock while holding its registry; camera work never reverses that order by entering the registry. Concession: retirement may wait for one camera solve and transport write. Ordinary entity solving does not hold the lifetime lock. This is one narrow camera permission mechanism, not an actor/lifecycle framework.

The host owns the worker guard. Explicit shutdown and drop signal cancellation, join once, and clear registration/input/target state; ordinary worker exit also retires the camera. The controller retains existing recoverable held/fallback behavior. Terminal worker errors are reported consistently with the existing host participant failure policy; transport errors do not roll back accepted camera state.

Validation: all 275 host library tests pass and all-target warnings-denied host Clippy passes for the cutover. A real-worker regression holds the entity registry locked while receiving successive camera-only events, then releases possession without a body tick and verifies no subsequent event or accepted stale input. It also verifies shutdown leaves no camera advancement. The three focused frontend entity/boom session/path suites pass. The source-level camera maintainability criterion is now met; live/browser cadence and following behavior, debug crowd performance, and the final two-path ownership audit remain open.

### Debug acceptance measurement: performance gate remains failed

The first acceptance pass found and repaired a stale retained-benchmark fixture: its source ID was `LocalPlayer`, but slot zero was registered as `Entity`, making subsequent source lookup invalid and omitting player mobility. Slot zero now registers the declared source; the ordinary runtime is unchanged.

Ran debug, profiling-enabled workloads on the current AMD Ryzen 7 PRO 7840U. The standalone 45-body workload used 180 ticks, one warmup, three measured repetitions, and periodic authority arrivals. It reported mean tick times 59.745–60.876 ms, maximum times 81.696–95.688 ms, 698,370 shape queries per repetition, 7.469655 m accumulated player travel, and 0.030236 m maximum penetration. The retained 45-body swarm/pinned/corner workload also completed after the fixture repair. These initial workloads overlapped, so their timings are preliminary failure signals, not clean comparative performance evidence. Logs: `/tmp/contact-45-debug.log` and `/tmp/contact-scenarios-debug.log`.

A bounded reporting experiment skipped geometry once both directional report contracts were already present in the tick-wide touch union. All 618 world tests passed (one manual benchmark ignored); movement and penetration outputs stayed identical. The sequential swarm run reduced shape queries from 776,284 to 69,778, but still reported mean 215.878–216.864 ms and p95 318.760–319.711 ms. Pinned p95 was 37.721–39.067 ms; hard-corner p95 was 1.777–1.786 ms. This did not establish a speed improvement and does not justify retaining extra per-candidate set membership work. Reverted the reporting experiment; only the benchmark identity repair remains. Experimental log: `/tmp/report-union-benchmark.log`. Do not attribute the complete timing difference to that edit without a controlled comparison.

The acceptance gate is failed, not waived because motion progresses or camera servicing is independent. Defer browser/live performance conclusions until a bounded CPU attribution separates preparation, ordinary/hard movement, pair correction, authored-shape reporting, and publication. The existing `environment_steps` counter reports zero on this replacement path and is not a valid measure of its environment work; do not interpret zero as no environment queries. Prefer identifying/deleting repeated mechanisms over tuning caps or adding caches. This finding reopens the performance/complexity audit; it does not authorize a new broad solver design phase or alter the 30 ms target.

### Bounded CPU attribution: reporting dominates the measured swarm

Added temporary timers around preparation, ordinary movement, mobile pair correction, support/finalization, report collection, and substep result application. Ran only the 45-body swarm for 30 ticks, one warmup plus one measured repetition, with the restored production reporting implementation. Removed all instrumentation and restored the retained benchmark's normal workload afterward. Log: `/tmp/contact-attribution.log`.

Measured per-tick means: physical kernel 15.773 ms; authored-shape reporting 63.651 ms; applying/merging substep results 0.421 ms. Within the kernel: preparation 0.423 ms, ordinary movement 5.826 ms, pair corrections 9.169 ms, support/finalization 0.238 ms. Outer benchmark mean was 80.844 ms and p95 156.326 ms. These are instrumented attribution measurements, not final acceptance timings. They identify reporting as the first layer to change; they do not establish that the physical kernel meets the full 60-tick crowded tail or live workload budget.

The report adapter's `sphere_path_touches_shape` currently calls `MovingSphereCast::update_collider_hit`, including generic time-of-impact casts and impact-normal computation for setup volumes, to answer a boolean touch question. Source inspection of the installed Parry 0.30.2 API confirms a dedicated `intersection_test` query that returns only overlap. A sphere swept along a straight segment occupies a capsule, so capsule-versus-volume overlap is a candidate replacement for reporting, while movement continues to require impact time/normal. Existing authored placement helpers in `volume_query.rs` should own volume placement; do not duplicate them in a new reporting shape layer.

Next bounded analytical check: preserve initial-overlap reporting, stationary triggers crossed between endpoints, directed BSP semantics, authored scale/placement, and the current tolerance/grazing behavior. The current report path combines a shrunk retail initial-overlap test with a future movement cast, so replacing it wholesale with a closed-solid overlap query may change grazing reports. Resolve that explicitly before cutover; prefer a proven equivalent rejection query or a narrowly justified boolean volume query over relaxing all reports or changing crowd response. No new tuning, caching, work caps, or solver architecture is justified by this attribution.

### Reporting traversal consolidation after finer attribution

A conservative capsule-overlap rejection experiment retained the old contact sweep for possible hits and passed existing tests, but did not meet the timing target. Finer temporary timers separated report preparation, geometry calls, and all remaining traversal: in the measured 30-tick swarm, approximately 0.275 ms/tick was preparation, 10.369 ms geometry, and 38.083 ms traversal. Therefore the earlier 63.651 ms reporting attribution did not establish impact geometry as its dominant cost. Removed the capsule experiment and all temporary timers rather than retaining another query layer. Log: `/tmp/report-inner-attribution.log`.

The report adapter now selects peers once per mover/substep using the combined extent and reached domains of its accepted sphere segments. Each segment retains its own extent and membership; `intersects_reached` prevents an aggregate EnvCell union from granting contact to a segment in an unrelated cell. Prepared report targets carry their dynamic policy and authored shapes together, removing repeated body lookup, physical/dynamic recovery, and policy decisions for every sphere/path leg. For a candidate pair, the first qualifying segment establishes both permitted report directions and ends that pair's search. Geometry and grazing/initial-overlap semantics remain with the unchanged `sphere_path_touches_shape` implementation. Stationary crossed triggers still use swept segments; reports do not participate in response.

This replaces the old per-segment `ReportQuery` traversal rather than adding a cache or spatial index. The small segment/target records carry facts with named consumers and live only for one substep. The existing coarse shadow index remains the domain/candidate owner. Movement output and penetration remain identical in all three retained debug scenarios.

Sequential debug benchmark, 45 bodies, 60 ticks, one warmup and three repetitions: swarm mean 62.647–62.795 ms, p95 83.864–84.362 ms, 92,798 shape queries/repetition; pinned p95 11.244–11.303 ms; hard-corner p95 1.370–1.457 ms. Logs: `/tmp/report-batch-benchmark.log`. This is a useful consolidation, but the swarm still fails the 30 ms gate. Initial baseline runs overlapped, so do not promote their ratio to a controlled speedup claim.

Validation: 619 profiling-enabled world tests pass, one manual benchmark ignored. The new focused domain regression proves that a segment geometrically crossing a target cannot borrow another segment's EnvCell membership from the aggregate. Existing initial overlap, crossed ethereal trigger, bidirectional report classification, and contact lifecycle tests pass. Dependency-inclusive world/core/host warnings-denied Clippy and diff checks pass. No temporary instrumentation or capsule rejection code remains. The next performance audit must use the current batched report path; browser/live acceptance remains deferred while the swarm budget is unmet.

### Post-batching attribution and pending numerical decision

Re-attributed the current batched implementation over the complete 45-body, 60-tick swarm, one warmup and one measured repetition. Instrumented mean: kernel 22.811 ms, reporting 36.548 ms, result apply/merge 0.482 ms; outer mean 61.198 ms, p95 81.975 ms. Temporary timers were removed and the ordinary benchmark workload restored. Log: `/tmp/batched-attribution.log`. The physical kernel itself approaches/exceeds the budget in crowded tail ticks; reporting is still substantial. Further changes should address their shared producer of work rather than assuming one query replacement will meet the target.

Source finding: each pass immediately applies each pair's two changes through `apply_change`. Each nonzero body change performs its own hard sweep and appends an accepted adjustment path. A body with several contacts can therefore perform several world transactions within one nominal contact pass, and reporting subsequently traverses those separate paths. The loop count is finite, but hard-query/path work still scales with the number of contacting pairs. This is the next structural boundary, not a reason to add a cache or tune the elapsed-time cap.

**Pending user decision; no numerical change implemented.** Proposed bounded prototype: collect positional requests per body within an existing pass, clamp each combined request to that body's remaining correction allowance, and perform one body correction transaction before the next pass. Keep the existing number of substeps/passes, contact mobility/tolerance, hard-world priority, and independent authority reference. Keep closing-velocity cancellation separate from geometric displacement; do not blindly sum impulses from frozen velocities, which can over-cancel motion. Publish/report only accepted actual paths, not unswept constituent requests. No island solving, recursive pushing, or convergence loop.

This changes within-pass numerical behavior. Opposing requests may cancel; contacts are not geometrically updated after every individual pair; and a combined displacement into a wall may be clipped where separate requests would have allowed a tangential component. Do not claim equivalent motion or quietly introduce a new sliding policy. Require the existing incoming-body, unequal mobility, crowd corner, hard entity, escape, stable support, no-launch, velocity, and bounded-compression cases to pass with useful behavior before retaining the prototype. If wall/escape behavior fails, stop for a focused decision rather than growing another solver layer. Compare sequential debug crowd timings only after that behavioral gate; camera/UI smoothness cannot substitute for the physics target.

Asked the user whether to prototype this per-body correction ownership or retain per-pair correction for now, honoring the request to stop before a consequential solver decision. Current production remains the tested batched-report/per-pair-correction implementation. Browser/live acceptance and the broader goal remain incomplete.

### Independent verification while the numerical decision is pending

Inspected production publication through `protocol.rs::StdioEventSink::send`: the synchronous sink callback enqueues a complete frame into the existing bounded `SyncSender` queue (capacity 256), and the single writer thread drains it FIFO. It does not write directly to the pipe. Earlier references to waiting for a synchronous transport write should be read as waiting for sink enqueue/backpressure. The epoch gate orders successful enqueue operations; possession retirement orders future camera enqueues, while already queued events remain ahead of subsequent receipts in the same writer queue. Retirement can wait for queue space if the reader stops draining output. No new queue or transport rewrite is warranted by this clarification.

The requested numerical choice remains pending. No per-body correction prototype or other contact-response change was made while waiting. All 354 core and 275 host library tests pass against the retained reporting consolidation (`/tmp/report-batch-consumer-tests.log`). This verification is independent of the numerical choice.

### Approved per-body correction prototype

User approved the bounded prototype after the numerical tradeoff explanation. This supersedes the pending decision above. Each contact pass now accumulates positional separation requests against fixed within-pass poses, then applies one hard-swept correction per body. The existing cumulative travel allowance clamps the combined request. Pair velocity cancellation remains sequential against updated velocities; it is not accumulated from stale inputs. The implementation reuses the existing correction transaction and one substep-local vector, with no persistent state, extra pass, sliding policy, or alternate solver mode.

Analytical review: opposing positional requests can cancel, and a combined request into a hard wall can lose its tangential component under existing first-hit clipping. Those concessions remain explicit. Actual accepted paths alone reach publication/reporting. Hard sweeps now scale with participating bodies per pass rather than touching pairs; geometry discovery remains pair-based and deliberately non-exhaustive under the existing policy. The correction allowance still bounds actual travel over all passes. No body can acquire velocity from positional correction.

Conformance: all 619 profiling-enabled world tests pass (one manual benchmark ignored), including sustained corner compression and reversal/escape, hard entities, incoming contacts, mobility, support, and no-launch behavior. These establish the retained scenarios, not arbitrary crowd convergence. The existing corner regression checks hard-wall integrity and bounded compression throughout 480 substeps, then requires reversal away from the corner.

Sequential debug comparison using the unchanged 45-body, 60-tick workload, one warmup and three repetitions: swarm mean 32.084–32.395 ms, p95 41.166–41.905 ms, versus the preceding mean 62.647–62.795 ms and p95 83.864–84.362 ms. Shape queries fall from 92,798 to 59,742 per repetition. Player travel changes from 1.114596 m to 1.127427 m; remote travel from 43.353035 m to 43.299473 m; maximum penetration from 0.035426 m to 0.036068 m. Pinned p95 is 10.389–10.559 ms; hard-corner p95 1.352–1.386 ms with identical movement and penetration. Log: `/tmp/per-body-crowd-benchmark.log`. No other benchmark ran concurrently.

Retain the simplification: useful behavior survives the conformance gate, and both work and measured time improve substantially. **The 30 ms swarm gate still fails.** Do not claim the live issue is fixed or proceed to a prolonged live acceptance run on this evidence. Next performance review should trace the remaining ordinary/hard/report work on this implementation before choosing another mechanism; the earlier attribution does not describe the new cost split.

Final verification: 354 core and 275 host library tests pass; dependency-inclusive world/core/host library and test Clippy passes with warnings denied. Formatting and diff checks pass. Logs: `/tmp/per-body-world-tests.log`, `/tmp/per-body-consumer-tests.log`, `/tmp/per-body-clippy.log`. No live/browser acceptance was attempted.

Maintainability acceptance: one positional correction owner per body/pass; one remaining travel allowance per body/substep; immediate pair-owned velocity cancellation; unchanged hard-sweep/path proof ownership; no persistent correction cache, per-contact path publication, recursive propagation, or new tuning parameter. Cosmetic cleanup remains deferred to the existing final cleanup phase.

### Remaining cost after per-body correction

Temporary attribution on the retained 45-body debug workload places mean swarm kernel work at 13.984 ms/tick and report work at 17.766 ms/tick (three measured repetitions after warmup; `/tmp/per-body-attribution.log`). A second bounded attribution separates report preparation (0.256 ms), segment contact tests including domain/extent admission (13.700 ms), and remaining traversal (3.696 ms), total 17.653 ms/tick (`/tmp/per-body-report-attribution.log`). Timers were removed and original source restored. These timings establish the new dominant work; the older traversal-heavy attribution no longer applies after per-body correction.

Tested stopping a candidate pair's geometry search once every permitted exact `CollisionReportTouch` was already in the collection union. The exact key includes classification and ethereal state, so policy transitions could still add distinct observations. All 619 world tests passed, and shape queries fell from 59,742 to 36,811 per measured swarm repetition. Nevertheless sequential benchmark p95 regressed to 43.937–44.401 ms, with pinned p95 12.758–12.799 ms; movement was identical. Removed the experiment: extra ordered-set lookups do not justify themselves by reducing a diagnostic count. Logs: `/tmp/report-union-tests.log`, `/tmp/report-union-benchmark.log`. No production source change from this experiment remains.

Next bounded review: `collision/static_sphere_sweep.rs::sphere_path_touches_shape` supplies observational yes/no queries through initial contact enumeration and the movement sweep's earliest-hit machinery. Establish whether a simpler exact boolean query can preserve the current initial-overlap, tolerance/grazing, cylinder cap/rim, and BSP semantics before implementation. Do not substitute rounded capsule intersection for the current hybrid contact contract without proving equivalence or obtaining a behavioral decision. Do not add shape caches or another query abstraction merely because geometry is now dominant. The 30 ms gate and live/browser acceptance remain open.

### Cylinder-side report query and debug timing gate

Analytical finding: after existing initial-overlap admission, a sphere-center chord whose endpoints both lie within a cylinder's vertical span stays within that span throughout. Its nearest cylinder surface is radial, so continuous contact reduces to a horizontal circle sweep. Reuse Parry's existing ball cast for that case; retain the original initial-contact tolerance/direction rule before casting. Paths crossing cap heights retain the existing rounded cylinder cast, and BSP queries are unchanged. This is a geometric reduction, not the previously rejected capsule approximation or a change to retail initial-overlap policy.

The first experiment applied the reduction to shared hard sweeps too. Although all 619 existing world tests passed and swarm p95 reached 22.390–22.786 ms, hard-corner travel changed from 0.952375 m to 0.768256 m. Exact mathematical geometry does not imply numerically identical iterative contact normals and sliding. Removed that broader application rather than silently changing physical response. The retained implementation is confined to `sphere_path_touches_shape`, the report-only query, and continues to use `MovingSphereCast::update_shape_hit` for approaching-hit admission. No new shape cache, collision mode, tuning constant, or solver policy.

Final sequential debug benchmark, unchanged 45-body/60-tick workload, one warmup and three measured repetitions: swarm mean 19.171–19.264 ms, p95 22.306–22.420 ms, max 23.594 ms; pinned p95 10.431–10.533 ms; hard-corner p95 1.302–1.319 ms. All three trajectories and penetration metrics match the retained per-body correction baseline exactly at reported precision. Swarm shape queries are 59,758 (previously 59,742): fewer counted queries were not the mechanism. Log: `/tmp/cylinder-report-benchmark.log`. The debug timing gate now passes for this workload. This is not live dungeon, arbitrary authored BSP population, or GPU/camera acceptance.

The asset-free cylinder query regression checks sloped side travel, cap entry, escaping initial overlap, a clear side path, and approaching/separating motion at exact touching distance. Existing crossed-trigger and report-lifetime coverage remains in the full world suite. Total 620 world tests pass, one manual benchmark ignored (`/tmp/cylinder-report-final-tests.log`). No temporary timing instrumentation remains. The retained code adds a bounded shape-specific geometric reduction to an existing query owner; cap/rim handling and physical response retain a single existing implementation.

Final checks: 354 core and 275 host library tests pass (`/tmp/cylinder-report-consumers.log`); dependency-inclusive world/core/host library and test Clippy passes with warnings denied (`/tmp/cylinder-report-clippy.log`). Formatting and diff checks pass.

Next acceptance work: finish the benchmark's velocity/hard-integrity evidence and the plan's final ownership audit, then one debug live/browser session with the documented settle/cooldown rules. Do not broaden or repeat performance tuning after the target has passed unless new workload evidence invalidates it.

### Acceptance metrics and resumed ownership audit

Expanded the retained asset-free benchmark with peak retained speed, peak absolute vertical speed, and player penetration into fixed targets. Each metric has a separate failure case: velocity amplification, contact-generated launch, and hard-obstacle intrusion. Fixed-target poses must remain identical to their initial poses; all speeds must be finite; vertical speed and hard intrusion are bounded by existing runtime tolerances. The hard metric is deliberately fixture-specific: upright cylinders overlap the player's height, so radial distance is their blocking boundary. It does not claim general BSP clearance. Removed this benchmark's `environment_steps` column because the current contact kernel does not increment that older grounded/free-query counter; the shared counter remains valid for its actual callers.

Sequential debug evidence (`/tmp/contact-acceptance-metrics.log`, assertion-complete rerun `/tmp/contact-acceptance-metrics-final.log`): swarm peak speed 1.077627 m/s, pinned 1.602627 m/s, hard-corner 2.058004 m/s. Peak vertical speed is zero in all three. Fixed-target movement is zero; maximum hard intrusion is approximately 0.000001 m. Mobile residual penetration remains 0.036068 m in swarm and 0.034497 m pinned. Swarm p95 remains approximately 22–23 ms. Player swarm travel is 1.127427 m but forward projection is -0.524208 m: this demonstrates crowd motion and compliant displacement, not successful forward traversal through an arbitrarily dense swarm. The separate sustained corner reversal regression establishes escape for its supported scenario. Do not recast path length as desired-direction progress.

Resumed source trace confirms the ordinary client tick's owners: core admits elapsed time and samples producer input; `scene/contact_collection.rs::CollectionActuator` holds private reference continuation; `PhysicalBodyInput::step` supplies each substep's response and nominal continuation; the contact collection owns solving/path accumulation; the scene applies physical state and reference completion; core feeds the published supported-motion value to the shared visual observer. Camera service owns permission and serializes advance/publication with reset; Explorer possession lifetime owns retirement, while the camera worker consumes published target paths and retains the endpoint after each advance. This is a partial final audit, not completion of the all-fields acceptance criterion.

Removed a redundant Explorer camera active-state recovery in `publish_target`: one mutable lookup now supplies both identity admission and target publication, eliminating an assertion over a fact already established under the same lock. Validation: the expanded benchmark passes all assertions; both focused host camera tests pass. World/host profiling-enabled Clippy and the subsequent host cleanup Clippy pass with warnings denied; formatting and diff checks pass. Logs: `/tmp/contact-acceptance-clippy.log`, `/tmp/contact-acceptance-camera-tests.log`, `/tmp/contact-camera-cleanup-clippy.log`. Remaining audit item: `PublishedBoomTarget::Ready` documents nonempty samples but stores a plain vector and `advance_camera` asserts the endpoint exists. Review its preparation contract before deciding whether a smaller existing representation can encode the guarantee; do not introduce a general path wrapper solely to appease an assertion search. No new behavioral decision is needed for the completed cleanup.

### First current live debug capture

Launched the current `dev:client` using `apps/holtburger-3d/.dev.env` without printing credentials. Initial sandboxed startup failed before login: direct launcher reproduction established `listen EPERM` on Vite's loopback listener at 127.0.0.1:1432. The authorized elevated retry succeeded; no rapid relog followed a successful session. The temporary probe uses the current production UI script with debug launch, a ten-second post-world-entry settle, ten-second renderer/V8 capture, screenshot, and explicit `disconnect_client` in cleanup. Probe exited successfully; cleanup reported no disconnect error.

Selected +Holtfighter (the sole listed character). Capture reports 603 rendered frames over 10,040 ms, approximately 59.98 capped FPS, mean frame work 2.144 ms and mean renderer GPU time 6.767 ms. Ten dynamic entities were visible in the final snapshot. The camera's final event was `advanced`, generation 1, sequence 1310, with projection clearance; lifecycle reached `in-world`. Browser console contains only Vite connection notices. Artifacts: `/tmp/contact-live-acceptance.json`, `/tmp/contact-live-acceptance.cpuprofile`, `/tmp/contact-live-acceptance.png`, `/tmp/contact-live-acceptance.log`. These are an instrumented idle capture, not uninstrumented host solver timings.

Viewed the screenshot: the player is at a green dungeon entrance beside a glowing pedestal; no mob swarm is visible around the body. Therefore this capture does not reproduce the original crowded case and does not satisfy swarm, orbit-under-pressure, corner/reversal, or packet-during-push acceptance. Keep the live gate open. No teleport or other world command was sent to manufacture a scenario. Future sessions must respect the relog cooldown.

Camera path review: the three private Ready producers are registration's literal singleton, stationary adapter's literal singleton, and the moving adapter's normalized-last-sample validation. Shared camera input also validates independently supplied slices. The endpoint assertion is currently backed by these producers, not a discovered empty-path recurrence. Its representation remains a maintainability review item; adding an independent cached endpoint would duplicate state and is not justified. The visual selector source confirms actions, explicit poses, and authored one-shot transitions retain priority over the observed gait cursor.

### Camera target path invariant consolidation

Replaced the Ready target's raw sample vector with private `PublishedTargetPath`, which owns the existing nonempty/end-fraction-one validation and consumption operation. Moving adaptation constructs this value at the existing validation boundary. Registration and stationary adaptation use an infallible constructor that supplies fraction one directly, rather than checking a literal guarantee. Camera advancement borrows the samples for the shared controller, then the path retains its endpoint by rotation/truncation. Removed the consumer's `last().expect(...)` and copied-endpoint reconstruction. There is no independently retained endpoint, fallback sample, cache, or added camera lifecycle state.

The wrapper has one field and one production consumer. It is justified by a specific cross-function invariant: producers admit a path that must survive repeated camera advancement after its travel is consumed. The shared controller still validates its independently callable input contract (including intermediate fractions and spatial data); this private app type guarantees only nonempty endpoint normalization, not all controller preconditions. Existing host camera tests exercise registration before a body tick, repeated advancement, target publication, coverage replacement, release, and worker retirement. This closes the identified raw-vector endpoint representation item without extending the shared camera API. All 275 host library tests pass after the final constructor cleanup (`/tmp/target-path-final-host-tests.log`); dependency-inclusive host library/test Clippy passes with warnings denied (`/tmp/target-path-clippy.log`). Formatting and diff checks pass. The preceding live capture exercised the client camera service; it does not cover this Explorer-specific adapter, whose browser/worker acceptance remains open.

### Architecture documentation cutover

Updated `crates/holtburger-world/ARCHITECTURE.md` to remove the retired planned-pair adaptive sweep / whole-step rejection description and the claim that all authored/controller/return movement is kinematic. It now describes bounded motor response, per-body accumulated contact correction, non-exhaustive mobile endpoint contact, swept projectiles, independent reference continuation, actual settling admission, and observational report traversal. Corrected motion ownership from a single playback cursor to separate authored and observed cursors with one action-priority selector. These descriptions reflect `mobile_contact/step.rs`, `scene/contact_collection.rs`, and `motion/registry.rs`; they are not compatibility claims about retail.

Updated `crates/holtburger-core/ARCHITECTURE.md` with elapsed-time admission, one sampled input, published supported-motion observation, and independent camera worker/lifecycle ownership. Corrected the `mobile_contact.rs` module contract to say the caller sweeps combined per-body requests, not each pair's request. The touched architecture docs no longer contain the retired adaptive-slice, planned-peer, or sole-cursor descriptions. Diff checks pass; no runtime behavior changed, so no repeated runtime tests were warranted.

The broader cleanup checkbox remains open: source-backed retail behavior markers/census, frontend/host vocabulary and all remaining plan acceptance items still require their own audit. The earlier idle client capture and synthetic crowd gate do not establish crowded live behavior or Explorer worker/browser integration.

### Frontend checks and Explorer content prerequisite

Current `npm run check` passes through Svelte, application/node/test TypeScript, and Electron/preload checks with zero Svelte warnings (`/tmp/contact-frontend-check.log`). The three focused entity/camera suites pass all 24 tests (`/tmp/contact-frontend-tests.log`).

Ran the canonical GPU browser harness against the existing WCID 1 possession fixture: `npm run harness:browser -- --brief --gpu --spawn-wcid 1 --spawn-simulated --possession-scenario --vite-port 1497 --screenshot /tmp/contact-possession.png`. Debug content host, Vite, and Chrome started, but spawn failed before the scenario or screenshot: `weenies.hwc ... reserved header bytes are nonzero`. Log: `/tmp/contact-possession-browser.log`. The process exited and cleaned up; this is not a successful browser acceptance run.

Read the artifact headers and current codec/history. Worktree `dats/weenies.hwc` is format 5; the main checkout's catalog is format 8; current `CATALOG_FORMAT_VERSION` is 10. Commit `df404e37` removed the old provenance-length header field and requires regeneration; later versions also changed payloads. The current diff in the reader only replaces index chunk iteration and cannot cause this header rejection. `ACE_WORLD_SQL_URL` is absent from the process environment, and the provided app `.dev.env` supplies account/password only. No catalog file or compatibility rule was modified. Do not change version bytes or inject fabricated missing fields to pass production-content acceptance.

Explorer browser acceptance now requires a format-10 catalog or the location of a configured export database connection. Use the existing `HOLTBURGER_WEENIE_CATALOG` override for a supplied artifact, or the existing exporter with `--output` to a temporary path when a connection is available. The browser scenario manually advances host ticks; even after this prerequisite is repaired, it does not by itself prove independent worker scheduling. Other final audits remain open.

### Private preparation and test-path subtraction

Source audit found `PreparedBodyContact`/`PreparedContactRole` exported through world and spatial even though only the contact kernel consumed preparation in production. Their `body_id`, `role`, `is_hard_obstacle_for`, and `resolve_pair` methods had no production callers; two scene tests exercised that alternative API instead of collection behavior. Made both types and their constructor private to the contact implementation, removed the unused methods/exports, and deleted those scene tests. Preparation still owns hard/mobile/projectile classification exactly once for the real step.

Preserved the meaningful directional-response, self-pair, and disconnected-EnvCell assertions in a small colocated test of `resolve_participant_pair`, the actual kernel function. Existing collection cases establish sleeping-body contact mobility/wakeup, hard-target obstruction, unequal yielding, and coverage handling. This removes roughly 160 lines of test/API scaffolding without maintaining a parallel preparation facade for tests. All 619 profiling-enabled world tests pass, one manual benchmark ignored (`/tmp/contact-private-preparation-tests.log`). Dependency-inclusive world/core/host library and test Clippy passes with warnings denied (`/tmp/contact-private-preparation-clippy.log`), as do formatting and diff checks. Production classification and numerical behavior are unchanged; no performance rerun is needed.

The format-10 Explorer catalog prerequisite remains unresolved. This independent cleanup does not satisfy browser acceptance or change the request for a current artifact/export connection location.

### Source-backed contact compatibility audit

Read the current retail decompile at `CPhysicsObj::handle_all_collisions` (`acclient.c:309962-310051`): collision reporting precedes response, and response zeros or reflects the object's own `m_velocityVector`. Added the greppable `RETAIL DIVERGENCE` marker at the compliant contact module to document the user-approved weighted two-body response and residual overlap. The marker states what restoring mover-only behavior would remove, its admitted-mobile-pair scope, and the actual evidence limit: 45-body synthetic cases, not a complete content census. This is an intentional gameplay change, not a claim that retail's behavior was unobservable or defective. Full content/live acceptance remains open.

Verified `CPhysicsObj::check_collision` at 308394–308444 and `CObjCell::check_collisions` at 333172–333189. Corrected the stale first citation in `dynamic_index.rs`'s existing stationary peer-overlap comment; its previous range pointed into scale/ethereal mutation code. The current functions establish that the peer supplies movement spheres and the object is passed as the target. No decompile source was modified. Documentation/comment-only changes pass diff checks; no additional runtime test was needed.

Catalog prerequisite remains unchanged from the prior two turns. Independent source audit made progress, so this is not a claim that every remaining task is blocked. The outstanding current-catalog request and live crowd/Explorer acceptance are still required before completion.

### Frontend lint and projectile checklist reconciliation

`npm run lint:ts` and `npm run lint:dead` both pass on the current tree (`/tmp/contact-frontend-lint.log`, `/tmp/contact-frontend-dead.log`). Combined with the earlier type checks and 24 focused tests, this closes those frontend tooling checks; it does not replace the catalog-blocked browser scenario.

Re-read production classification and sweep consumers: `PreparedBodyContact::from_body` privately selects Hard/Mobile/Projectile; ordinary and correction movement share `sweep_body_motion`; pair response consumes the existing directional policy and reached domains; accepted path membership owns publication and report traversal. Marked the common-boundary wiring item complete. The broader producer-profile/content-classification audit remains separate and unchecked.

Re-read `advance_projectile`, `advance_projectile_translation`, and collection impact retirement. Projectiles bypass compliant pair passes, sweep their full requested translation once, apply first-impact response, and retain the fixed angular-chord bound for offset sphere rotation. Targets are hard shapes plus accepted crowd endpoint shapes; transverse moving-target misses remain the documented concession. Work is bounded per projectile substep by its translation and angular queries over those candidates, not by a negotiated crowd trajectory. Existing `contact_advance_keeps_projectile_speed_and_sweeps_small_mobile_targets` asserts full-speed free travel and small-target impact; `collection_impact_retires_entity_flight_and_does_not_capture_a_new_return` checks that authored/return travel does not replay after impact. These current world tests passed in the latest 619-test run. Marked the projectile separation item complete.

The remaining unchecked items are not implicitly complete because their neighboring tests pass: producer profile census, complete authored-hook/animation-priority audit, final all-fields maintainability trace, vocabulary/compatibility cleanup, and crowded live/Explorer acceptance retain their stated scopes. The catalog/export-location request remains pending.

### Producer mobility audit: source rules versus content census

Traced client demand through `client/collision.rs::client_remote_body_target`: attachments and unsupported physics are excluded; target retention is independent of integration; integration requires eligible semantics plus gravity, missile state, a simulatable authored/vector basis, or pending reconciliation. Zero retained velocity alone does not make an initialized character hard. `WorldState::body_has_simulatable_projection_basis` includes orderable motion before a first authored tick, preventing input availability from requiring a preceding simulation tick. A solid zero-gravity body with no motion/reference work is target-only and therefore hard; the existing `remote_demand_requires_positive_target_or_integration_work` test documents that deliberate admission rule.

Explorer's `explorer_physical_demand` maps its explicit PoseOnly/Simulated mode; eligible simulated bodies retain integration demand even at rest. Frozen semantics exclude integration, and setup definitions without movement spheres become FixedPosition in `prepare_dynamic_entity_physical_facts`. The contact kernel treats either integration exclusion or FixedPosition as hard, while settled eligible bodies remain mobile. STATIC and PUSHABLE remain existing unsupported local-simulation flags rather than being silently repurposed; ordinary resident static world geometry still belongs to collision content. Client and Explorer admission differ for zero-work zero-gravity objects by explicit composition policy.

Doors/corpses are not classified by their names or presentation category. They use effective authored physics and setup geometry. ACE `Door.cs` changes ethereal state on open/close; `Creature_Death.cs:613–618` initializes corpse physics and copies creature velocity for falling. Therefore assuming every corpse is physically immovable would be unjustified. Actual door/corpse setup/flag distribution still needs current catalog/live evidence; the broad producer-profile checklist remains unchecked rather than turning this source audit into a content census.

Attachment source correction: `state/mutations.rs::delegate_attached_entity_position` preserves a parent-derived canonical pose record and removes dynamic physics. Updated world architecture documentation, which incorrectly claimed every attachment had no SpatialBody. The relevant solver invariant is absence of independent physical participation, not absence of a pose record. No runtime behavior changed; diff checks pass.

### Authored/observed motion ownership audit

Traced `client/simulation.rs::tick_with_precise_jump`: admitted elapsed time precedes authored advancement; the bulk/local exclusion prevents two advances of the local authored cursor; the resulting authored ticks feed `WorldState::apply_authored_motion_physics` once before physical collection solving. That hook consumer processes authored Ethereal effects and pending solidification. Substep input samples offsets, not another animation advance. After publication, core sends supported timed motion to observation. `MotionSequenceRuntime::advance_presentation` calls the common clip traversal without a SequenceTick output, so visual advancement cannot emit root offsets, hooks, or motion-data physics.

The existing asset-free `observed_locomotion_cannot_replace_actions_or_change_authored_ticks` compares complete authored ticks and action state through a completion boundary, then checks explicit-pose priority. `visual_cursor_shares_hooked_clip_timing_without_authoring_a_tick` exercises nonempty authored hooks while comparing visual clip timing. World-facing observation tests additionally use published physical facing and preserve authored action output. These passed in the latest 619-test world run. Marked the world/core authored-versus-observed checklist item complete.

`WorkingBody::observe_travel` reduces only Travel segments, with a supported flag; contact/stair Adjustment segments are excluded. The collection combines equal substeps by admitted-time share, the scene publishes `supported_motion`, and the host forwards it unchanged to its selector. `observed_locomotion_order` consults actual visible table cycles: missing backward content reverses an available forward gait, missing side content uses forward gait without changing physical facing, and standing turns require a visible turn cycle. Actions and explicit poses remain selector-owned. Marked this contract/capability-handling item complete; visual quality over the full catalog remains part of production-content acceptance.

Verified a pre-existing Explorer limit against HEAD: unpossessed playback advances but physical actuation coasts; possession uses authored offset but the host does not route SequenceTick hooks through the client's world Ethereal-hook consumer. The new observer does not remove that consumer—it did not exist in the old host. Do not claim complete Explorer authored-physics-hook support or introduce it as incidental solver cleanup. This is recorded existing app capability debt, distinct from preserving shared/client hooks and from the new observed cursor's inability to emit them.

No source changed during this audit; existing test evidence and source inspection justify the checklist updates without repeating unchanged tests. Catalog-dependent browser and crowded live acceptance remain open.

### Final target sweep and dead direct-commit field

The initial all-target warnings-denied Clippy run passed across world, core, host, and debug harness, covering binary/diagnostic consumers beyond library checks (`/tmp/contact-all-targets-clippy.log`). The runtime vocabulary sweep found no `entity_pressure`, shared-proposal/group, ordered-player, or `dynamic_contact` references in current app/core/world/harness source.

It did find an obsolete direct-commit `residual_contacts` field: both `PhysicalBodyTickCommit` producers always supplied false, and only the direct tick's settling helper consumed it. Removed that field, its arguments, and its dead settling predicate. A scene test had directly passed true to that helper despite no production producer being able to do so; removed those helper-level assertions while retaining the test's real scene advance, settled activity, membership, and pose assertions. The grounded placement query's distinct `residual_contacts` result is still computed from geometry and used in focused coverage, so it remains. No renaming of a live geometric concept was warranted.

All 619 profiling-enabled world tests pass, one manual benchmark ignored (`/tmp/contact-residual-field-tests.log`). The first post-edit compile identified the obsolete test arguments; those were removed as described and the successful rerun is the cited evidence. This is dead-state subtraction, not a change to compliant contact settling or the direct solver's actual behavior. No performance rerun is justified by removing a constant-false field. Final all-target world/core/host/debug-harness Clippy passes with warnings denied (`/tmp/contact-final-all-targets-clippy.log`); formatting and diff checks pass. Catalog-dependent and live acceptance remain open.

### Direct/prediction boundary and current-status reconciliation

Re-read `solve_physical_body_tick` and `SpatialScene` prediction: both mobile paths call `advance_body_contact_collection_without_reports`. Direct probes explicitly activate their private mover and require exactly one result; unavailable coverage rejects the atomic direct transaction instead of publishing a collection prefix. Prediction freezes sealed peer integration demand and shares ordinary hard/contact movement for its mover; it does not predict peer future motion. These are documented boundary policies, not another contact implementation. Fixed-position placement remains a separate non-mobile operation.

Core elapsed-time admission, sampled input, one-shot hooks/launches, and canonical body publication have been traced in the preceding audit. `client/runtime.rs` batches `RuntimeBodyAdvanced` views for presentation; movement samples the canonical runtime pose on its own update rather than consuming that event as a movement command. Source-backed ownership and the retained fractional authored, launch-once, reference, support/stair/edge, hard-entity, angular, and coverage regressions establish the current implementation wiring. Marked the direct/collection input mapping, support/launch/reference wiring, and shared grounded/free movement checklist items complete. Full production-content navigation and crowded live acceptance remain separate requirements.

Corrected this plan's stale leading status, which still claimed production return and observed presentation were unimplemented. Relabeled the introductory pressure-driver reference as removed history. Revalidated the worktree catalog header as format 5 and confirmed no export database URL is available in the process environment; no user-supplied replacement location has arrived. Do not retry the same browser spawn without repairing that prerequisite. Final current-tree library verification passes: 619 world, 354 core, and 275 host tests, one manual world benchmark ignored (`/tmp/contact-final-library-tests.log`). This complements the all-target warnings-denied Clippy, frontend checks/lint, and focused frontend tests already recorded.

### Bounded final ownership review result

Completed the requested source-level body/camera retrace after the structural changes. Body policy owners: producers admit and sample input; `PhysicalBodyInput` represents ordinary/reference input without invalid capture combinations; scene preparation resolves residency and classification; the kernel owns working poses, support changes, per-body correction allowance, and accepted path segments; scene publication commits physical/reference state; authored playback alone emits root/hooks; observed playback consumes published supported motion under the existing action selector. Core movement samples `local_player_runtime_pose` and runtime body contact. `RuntimeBodyAdvanced` is batched into view publication, not a second movement-state owner.

Camera policy owners: world lifecycle owns client ordinary-input permission; possession lifetime owns Explorer authority; each camera service owns its sole controller; target publication owns immutable collision/path input; `PublishedTargetPath` owns endpoint retention; the short delivery gate owns epoch/enqueue order; reset/shutdown retire permission and join workers. Snapshot absence delays solving without granting permission. No camera advance takes the entity simulation registry lock. The known queue-backpressure and latest-target-wins concessions remain documented.

Representation review closed the identified structural issues through subtraction/consolidation: removed duplicate authored inputs, repeated private preparation recovery, the test-only public preparation facade, and constant-false residual state; made camera permission explicit and target path normalization privately owned. Remaining immutable-source/current-state pairs have named uses (reference versus actual pose, authored versus observed cursor, root versus offset sphere placement). No general actor hierarchy, priority framework, pressure driver, recursion, or convergent crowd transaction was added. Marked the bounded maintainability review and duplicate-motion cleanup criteria complete. This does not claim that every unrelated historical API has been rewritten or that browser behavior follows from source review alone.

The current conformance suite covers the requested local numerical cases: repeated yielding/unequal mobility, incoming contact and reversal, fixed targets/corners, support loss and no-launch, cumulative travel, competing movement spheres, finite coincident-center separation, unavailable coverage and unaffected-peer progress. The latest 619-test world run plus the retained 45-body assertions and timings establish this scoped gate; they do not guarantee arbitrary crowd escape. Marked the conformance-suite item complete. Current tooling checks are also complete as recorded in the final library/all-target/frontend logs; rerun affected checks after any subsequent source changes.

Outstanding acceptance remains concrete: obtain a format-10 catalog/export connection, run production-content classification and Explorer possession/worker/browser checks, and exercise the client's actual crowded scene with orbit, pressure/reversal, and authority updates. The idle dungeon capture cannot substitute for those. No additional solver tuning is justified before that evidence. The goal is not complete.

### 6. Acceptance and cleanup

Entry condition: both analytical/conformance gates passed and integration has not invalidated their assumptions. Reopen the affected gate before broad testing if integration introduces new query loops, state duplication, or coordination.

- [x] Retarget the retained 45-body debug workloads through the new collection API. Measure sustained progress, residual/max penetration, velocity stability, hard-obstacle integrity, and work/time. Do not retain old sub-millimeter criteria that contradict chosen compliance.
- [x] Target p95 below the existing 30 ms physical interval on the comparison machine. Include fixed-pass/substep counts and actual candidate work when diagnosing misses; a time clamp or smooth renderer alone is not success.
- [x] Use one live debug `dev:client` dungeon session, settle five seconds, and check swarming, camera cadence, prolonged corner pressure, release/escape, and authority updates. Respect relog throttling and disconnect explicitly. **Closure:** Closed by subsequent live/debug evidence and user acceptance; see final acceptance audit below.
- [x] Run relevant world/core/host tests, warning-denied Clippy, formatting, and diff checks. Retained tests require no unchecked-in assets.
- [x] Remove temporary motion adapters and any duplicated root/hook consumption paths; ensure visible locomotion cannot produce physics inputs and no generic priority framework or duplicate action owner remains.
- [x] Sweep retired pressure/ordered-player/group vocabulary from surviving runtime symbols, metrics, tests, active docs, and UI. Update architecture docs and required source-backed retail-divergence markers; retain historical evidence explicitly as history.

Done: one maintainable production path with bounded local contact work, emergent yielding, tolerable stable compression, hard-obstacle integrity, collision-constrained authority return, preserved navigation semantics, and responsive debug crowd/camera behavior.

## Remaining decisions and risks

### Free-flight return mapping

The character return adapter is insufficient for the required free-flight producer mapping. This is an analytical contract gap, not a live-performance question:

- `PhysicalBodyActuation::FreeFlight` and `ContactStepActuation::FreeFlight` deliberately sweep authored kinematic travel separately from retained physical velocity. Hard contact may clip this travel, but it does not become physical continuation.
- `predict_reference_motion` includes both authoritative physical travel and authored kinematic travel in nominal displacement. That is correct for advancing the reference position.
- Character completion compares retained actual velocity with that total nominal travel rate. Reusing it for free flight is incorrect: with 2 m/s of authored travel, zero physical velocity, and coincident actual/reference positions, it sees a false 2 m/s velocity error. The reference would never retire. This follows directly from the contracts; another benchmark cannot settle it.
- Applying the supported character motor to free flight instead would either do nothing without support or require introducing a three-dimensional motor that converts authored travel into physical velocity. That changes flight acceleration and contact response, beyond merely wiring the existing adapter.

Decision: preserve free-flight response semantics. Add its bounded authority correction to the existing swept, non-retained kinematic contribution, and use a completion comparison that excludes kinematic travel on both sides. Keep character return on the supported motor. Share reference position/orientation prediction and lifecycle, while leaving the velocity response and completion interpretation with each response adapter. The tradeoff is an explicit free-flight response distinction; it avoids changing projectile/flight behavior to force a uniform character rule.

Alternative requiring behavioral approval: give free-flight bodies a three-dimensional velocity motor too. This needs an explicit decision about authored flight inertia, acceleration, and projectile applicability; it must not be inferred from the approved grounded-character motor.

Implemented at the sampled-input boundary: `PhysicalBodyInput::return_step` shares interval sampling, reference advancement, and heading ownership across grounded and free bodies. Free flight adds a three-dimensional, speed-capped correction to its swept kinematic contribution. It adopts the existing return gain to taper correction near the target, rather than the retiring driver's constant-speed approach. Independent predicted physical continuation supplies free-flight completion; character completion still uses nominal motor travel. No flight motor or additional collision query was introduced.

The repeated moving-flight fixture advances authored travel while returning sideways, checks that neither authored travel nor correction enters physical velocity, and verifies reference retirement once aligned. All 660 world and 356 core library tests pass. This closes the response mapping; reference seeding for first contact, production publication, and live cutover remain unfinished. No user decision is required to preserve the existing flight response distinction.


The code-path dry run found no requirement for recursive or crowd-wide convergence, but it did require replacing actuation and publication contracts, defining symmetric contact geometry, and separating correction traversal from timed motion. No product clarification blocks scoping. Contact-mobility weights, movement acceleration, tolerance, correction fraction, pass count, substep size, and travel limits need joint numerical tuning. Hard-body lifecycle admission, mobile crossing at supported speeds, and support/stair compatibility are concrete implementation risks with acceptance cases above. Finite passes do not guarantee arbitrary configurations settle; accept occasional fast mobile crossings and prioritize useful ordinary crowd resistance over convergence machinery. This plan changes behavior deliberately and does not claim a perfect physical system.

## Source map

- `crates/holtburger-world/ARCHITECTURE.md`: canonical physical owner, authority versus runtime poses, resident owner proofs.
- `crates/holtburger-world/src/entity_physics.rs`: integration eligibility, unsupported semantics, directional collision/report policy.
- `crates/holtburger-world/src/spatial/{physical_body,scene,grounded,free_sphere,pose_reconciliation}.rs`: current motion, support, publication, and authority consumers.
- `crates/holtburger-world/src/spatial/{mobile_contact,dynamic_index}.rs` and `collision/static_sphere_sweep.rs`: contact geometry, candidate selection, and existing Parry casts.
- `crates/holtburger-core/src/client/{simulation,runtime}.rs`: physical inputs/effects, scheduling and camera servicing.
- `ACE/Source/ACE.Server/Physics/PhysicsObj.cs:4142–4190,1655–1728` and `PhysicsGlobals.cs:38–43`; retail `acclient-eor-source/acclient.c:300072–300120,311146–311227`: integration references. Existing grounded/filter source citations govern compatibility review. These references do not establish the proposed compliant contact behavior.

## Historical evidence and retained workload

The rejected design combined full-step proposal retries, conservative swept dependency groups, and whole-group rejection. That combination can repeatedly reject the same state indefinitely; its design risk did not require an experiment to recognize. Isolated state, group-discovery, and unrelated-work tests did not establish a viable contact solver and have been removed with the prototype.

The 45-body debug benchmark used 60 requested 30 ms steps, one warmup and three measured runs, on an AMD Ryzen 7 PRO 7840U / Rust 1.98.0:

| Rejected prototype workload | Mean step range | Rejected body-steps / 2700 | Player forward progress |
| --- | ---: | ---: | ---: |
| Swarm | 135.324–136.548 ms | 2565 | 0.044365 m |
| Pinned | 39.517–39.665 ms | 0 | 0.062355 m |
| Tight corner | 100.477–103.942 ms | 2250 | 0.279616 m |

All three formed one 45-body dependency component. In the swarm, two reciprocal contacts survived the final response pass despite complete environment and sampling queries; all 45 bodies rejected the step and retried the same state. The corner similarly failed on the player/first-obstacle pair after ten completed steps. These traces establish non-convergence and excessive rejection scope, not a proven floating-point root cause. A separate earlier corner fixture exposed the bounded plane projector returning zero motion; it is not established to be the same failure.

Historical captures: `/tmp/complete-step-connected-crowd.txt`, `/tmp/complete-step-connected-rejections.txt`, and `/tmp/complete-step-locality-tight-corner.txt`. Prior live debug captures in `/tmp/dungeon-comparison-*.{json,log,txt}` established host simulation overruns, retained downward velocity growth without movement, and resulting camera delays. A fixed-duration diagnostic reduced amplification but did not solve the problem.

The workload remains in `crates/holtburger-world/src/spatial/scene/physical_body_tests/connected_crowd_benchmark.rs`. It now exercises the **current runtime collection boundary**, not the removed test-only resolver:

```sh
cargo test -p holtburger-world --features physics-profiling --lib connected_crowd_benchmark -- --ignored --nocapture
```

It deliberately wakes all 45 bodies and omits authoritative samples, so it does not estimate sleeping-scene cost. Corner neighbors have excluded integration demand and act as hard authored targets. Output reports mean/p95/max duration, existing work counters, stationary body steps, player/remote travel, and residual penetration. No new benchmark measurement was collected during the cutover/deletion. Historical measurements above remain observations of the rejected implementation.

The standalone debug workload is also available through `cargo run -p holtburger-debug-harness --features physics-profiling --bin contact_collection_benchmark -- --bodies 44 --ticks 60 --repeats 3`; it has one collection implementation and no independent/shared mode switch.

Reset validation: 607 profiling-enabled world library tests pass; the retained manual benchmark is ignored in the normal run and was not remeasured during this design reset. Feature-enabled all-target warning-denied Clippy (`--no-deps`), formatting, and diff checks pass. Logs: `/tmp/priority-reset-world-tests.txt` and `/tmp/priority-reset-clippy.txt`.

## Catalog prerequisite resolved — 2026-09-07

The user identified the `3d-next` checkout’s `ace-root` configuration. That branch is checked out at `/home/me/code/holtburger`; its ACE World database is available through the Docker-published localhost port. The current debug exporter successfully read 43,913 templates and generated a format-10 catalog. Replaced this worktree’s local `dats/weenies.hwc`, preserving the previous artifact at `/tmp/contact-weenies-before-regeneration.hwc`; the generated copy is also at `/tmp/contact-weenies-v10.hwc`. Credentials were read directly into the child process environment and were not recorded in commands or output. This resolves the catalog prerequisite only; Explorer browser acceptance and crowded live acceptance remain pending.

## Explorer acceptance reopened the navigation gate — 2026-09-07

With the regenerated format-10 catalog, the canonical debug GPU browser command now executes the possession scenario:

```sh
npm run harness:browser -- --brief --gpu --spawn-wcid 1 --spawn-simulated --possession-scenario --vite-port 1497 --screenshot /tmp/contact-possession.png
```

It fails the signed backward displacement assertion. Both measured walking intervals also travel zero distance. Log: `/tmp/contact-possession-browser-current.log`; screenshot captured and inspected. This is a real failed acceptance check, not a catalog or browser limitation. The HTTP scenario does not establish background camera-worker acceptance.

Temporary input and kernel traces isolate the failure before mobile contact response. Authored backward motion supplies approximately -1.69 m/s. The supported motor accelerates from rest to -0.166667 m/s in an admitted substep. Ordinary movement requests approximately -0.001389 m in Y, but edge protection restores root `(96, 99.53554, 22.545)` and zeroes velocity. Even stationary ticks at that resting position report edge rejection, with an inward normal in +X. Logs: `/tmp/contact-possession-kernel-trace.log` and `/tmp/contact-possession-support-trace.log`. All temporary instrumentation was removed after the terminal runs.

The source-level inconsistency is between acceptance of resting support and subsequent movement support. `bsp_query.rs::support_on_polygon` can classify a sphere/edge reach as Surface while a nonzero plane-height adjustment is needed, then classify that reach as Edge once the adjustment is gone. `stairs.rs::settle_candidate` accepts the former and publishes grounded state. The next settle sees only Edge, while `protect_edge` restores the prior grounded state. Cached owner proof validity does not prove that the accepted pose still has standing support. This explains the observed repeated rollback; the exact authored polygon remains to be extracted into a minimal fixture before choosing the repair.

**Stop/resteer:** reopen the navigation conformance gate before further broad acceptance or tuning. The recommended direction is to make standing-support acceptance consistent at the final pose, with unsupported rim positions allowed to fall/slide instead of preserving a grounded rollback loop. Do not globally disable edge protection, change movement tolerances, or relocate the browser fixture merely to pass. Review the existing retail finite-edge bridge concession before changing which rim positions may count as standing support.

Maintainability acceptance: landing, support refresh, and walking settle must agree on standing support at the same pose; owner revision alone must not authorize a stale geometric conclusion; a failed movement must not repeatedly restore footing that the same support rules reject. Add an asset-free regression for the extracted geometry and rerun the current browser scenario after the rule is repaired. No runtime repair was made in this investigation. Content census and crowded live acceptance remain pending.

## Standing-support policy review — 2026-09-07

The user requested a coherent support policy rather than a landing-specific repair. This review supersedes the prior recommendation to simply reject rim positions and let them fall. That recommendation was premature: it did not account for the geometry required by incremental stair climbing.

### Ownership and justified differences

- `bsp_query.rs::support_on_polygon` owns polygon support geometry for both terrain triangles and authored BSP faces. It currently promotes an edge reach to Surface when a nonzero plane adjustment is needed, but returns Edge once that adjustment disappears. That height-dependent classification is the inconsistency to remove.
- `volume_query.rs::cylinder_support` already permits an overhang: the sphere center may be outside the cap disk by almost the moving sphere radius, while the prescribed resting height remains one radius above the cap plane. This is a deliberate retail-shaped support convention, not exact sphere/cylinder tangency at the rim. Ball support instead computes a radial tangent and normal.
- `stairs.rs::settle_candidate` finds and sweeps to reachable support, with different search distances and normal thresholds for walking and landing. Those differences are justified navigation policy. Its blocked-descent edge bridge can nevertheless publish support at a different elevation from the selected surface and must be reconciled with the standing rule.
- `stairs.rs::support_at` classifies the existing pose after relocation, invalidated support, or contact movement. Its current rise allowance can accept a candidate that would require a height adjustment without applying that adjustment. Confirmation should distinguish actual standing support from reachable support.
- Relocation initializes grounded response as Airborne. Contact displacement and offset-sphere rotation also invalidate support. Cached support is therefore reasonable when the producer established a valid standing pose and neither pose nor owner changed. Do not add unconditional per-tick queries merely because owner proof alone cannot establish geometry.
- Edge protection saves prior footing and tries one tangent slide before rollback. Rollback is valid only if the saved pose satisfied the same standing rule used for the new pose.

### Analytical stair constraint and rejected prototype

At first contact with a vertical riser, the lower sphere center is approximately one sphere radius short of the tread. Lifting it and advancing only the small admitted horizontal substep cannot put its tangent point over that tread. Therefore a strict finite-face tangent-point rule is incompatible with the current incremental stair maneuver unless the maneuver also advances farther than the ordinary movement request. That would be a different locomotion tradeoff, not a free correctness repair.

A bounded prototype removed edge-to-Surface promotion, removed the blocked-descent edge bridge, and limited standing refresh to contact tolerance. The world suite reported 616 passing tests, three failures, and one ignored manual benchmark (`/tmp/contact-support-policy-tests.log`). Failures include the production contact stair fixture (even without a mob) and its short-drop/edge fixture; one legacy grounded primitive fixture also fails. The combined prototype demonstrates that the proposed stricter rule is not a valid replacement under existing navigation requirements. It does not isolate every failed assertion to one removed clause. All prototype runtime edits were withdrawn; formatting and diff checks pass.

### Recommended policy direction; user review before implementation

Use one explicit finite support footprint for polygon standing and reachable support, allowing a bounded overhang comparable to the existing cylinder-cap convention. Its answer must be invariant under applying the prescribed vertical adjustment. Height may change reachability, but must not change whether the same horizontal footprint counts as standing support. The concession is visible: a body can stand with its center slightly beyond a polygon edge instead of requiring exact physical tangency. The overhang must be bounded by body geometry, not by a new collection of stair/landing exceptions.

Before implementation, specify the footprint and its boundary behavior analytically, including sloped faces, corners, shared triangle seams, short drops, and genuine ledges. Determine how edge protection obtains an inward direction at that same footprint boundary; do not invent a second, wider standing region solely to supply a slide normal. Preserve swept upper clearance and vertical adjustments. Then replace the inconsistent promotion/bridge rules together and add asset-free tests that re-query accepted support at the resulting pose.

This is a support-geometry tradeoff requiring the user's eyes under the execution instruction. No new support rule is retained yet. The full original goal, production browser regression, content census, and crowded live acceptance remain open.

## Whole-model review using the problem-solving skill — 2026-09-07

The user requested a review of contacts, support, edge protection, and navigation together. This is design work only. The previous overhang recommendation is a candidate concession, not an approved replacement policy. Do not resume implementation from that recommendation alone.

### Requirements before mechanism

| Concern | Required behavior | Boundary / concession |
| --- | --- | --- |
| Physical exclusion | World and effectively immovable entity geometry constrain movement, rotation, and correction; preserve upper clearance. | Existing hard penetration needs recovery semantics; a sweep is not proof that its starting pose is valid. |
| Crowd response | Local weighted separation, tolerable overlap, escape in separating directions, no recursive capacity search. | Mobile contacts are non-exhaustive; bounded work can leave compression. |
| Actuation | Walking and reference return approach desired velocity; gravity and explicit launch continue independently. | Gameplay acceleration/mobility, not a full rigid-body mass model. |
| Standing | Grounded means the accepted pose has valid, nonseparating support under one geometric rule. | A surface reachable after adjustment is not already support at this pose. |
| Slopes | Walkable surfaces permit ground drive; steep contact may slide and cannot grant walking authority. | Material/normal policy may differ from vertical reach policy. |
| Stairs and short drops | Small steps can negotiate authored height changes without horizontal speed bursts or head penetration. | Requires deliberate character navigation assistance; exact sphere tangency alone does not establish this behavior. |
| Ledge protection | Protected ordinary movement should avoid unsupported departures and preserve available tangent movement. | It must not create support, undo external contact displacement, or veto jumps. Continuous avoidance of every tiny gap at arbitrary speed is not established by bounded endpoint probes. |
| Reconciliation | Server updates change a reference, not the displaced body's pose; return obeys movement/contact constraints. | A blocked return can remain incomplete. Reference demand gets no extra permission to cross walls or manufacture ground. |
| Lifecycle | Relocation, changed collision content, changed geometry, or external displacement retire stale support. | Missing collision coverage is unknown, not evidence of empty space or a safe fall. |
| Publication | Pose, support, motion, topology, reports, and animation observation describe one accepted result. | Correction and navigation adjustments do not become momentum or authored animation/root input. |
| Work | Bounded substeps, local contact passes, and navigation alternatives; no convergence or recursive retries. | Camera cadence remains independently serviced. |

### Actual geometry and unresolved content scope

Current character geometry is a lower movement sphere plus optional upper clearance sphere. Terrain is triangulated; BSP objects provide finite polygons; authored volumes include cylinders and balls. Shared triangle seams must not count as ledges. Finite polygon rims, convex caps, slope crests, stair risers, and narrow treads are real distinctions in the inputs, not reasons to duplicate movement ownership.

The current polygon support query changes Surface/Edge classification with pending height adjustment. Cylinder caps permit a finite overhang, while ball support uses a radial tangent. The strict polygon tangent-point prototype broke production stair and short-drop fixtures. These facts constrain the candidate model, but do not prove that one-radius overhang is the best gameplay rule.

Current support queries inspect resident world geometry. The hard-entity list participates in sweeps but is not supplied as support geometry to `settle_candidate`. Therefore “hard blocker” and “standable surface” are currently different capabilities. Whether eligible hard entity tops must support characters needs an explicit scope decision and source/content audit; being solid is not sufficient evidence that corpses, doors, or every frozen object should be a platform. Mobile stacking and moving-platform carrying have not been requested and should not appear as accidental consequences of the crowd solver.

### Candidate overall model: one body, contact response, and navigation assistance

Keep one physical body and one final publication. Separate physical feasibility from permitted navigation assistance rather than expressing every behavior as another positional constraint:

1. Prepare geometry, directional collision policy, support capability, intent, and reference input. Preparation owns classifications; consumers do not reinterpret raw flags.
2. Use valid current support to resolve motor/gravity/launch input. Navigation may propose a bounded assisted path for ordinary supported motion: ordinary travel, or one step alternative within rise/drop limits. Edge protection belongs to this proposal. A jump bypasses ground adhesion and edge protection.
3. Sweep the selected physical movement against hard geometry and retain accepted progress. Navigation adjustments use the same hard clearance and topology rules. A failed optional step does not invalidate accepted ordinary movement.
4. Apply the bounded mobile-contact passes; sweep their requested corrections against hard geometry. Do not re-run stair climbing or edge protection after every contact correction. Otherwise each peer interaction can trigger more navigation work and positional assistance.
5. Classify support at the final accepted geometry. Contact or rotation can leave a formerly supported body airborne. This final classification cannot pull it onto another floor merely because that floor is nearby. Publish once. The next substep uses this result.

This is a directed pipeline, not repeated reconciliation among “landing,” “walking,” and “pushing” solvers. Walking and authority return feed the same motor/navigation path. External contacts remain physical response. That is a distinction by meaning, not branches for which entity or event caused the problem.

### Common support contract required by that model

The geometric layer supplies bounded reachable support candidates with a target resting pose, normal, and source validity. The navigation layer decides whether it is allowed to reach one (rise/drop, ascent, jump, slope, and clearance). The body may publish standing support only at an accepted resting pose. A zero-distance support query at that pose must agree with the candidate that produced it, within the shared contact tolerance.

Candidate validity and support-at-pose must use the same footprint. Applying a vertical adjustment cannot turn a supported footprint into an unsupported footprint. Separate source-geometry validity from permission to retain a support fact at a changed pose. Retained support needs no redundant query when both geometry and pose are unchanged and the original result established the invariant.

Do not implement a generic constraint framework or new persistent collection of contact permissions for this contract. First try to express it through the current support result and small stateless query/selection functions. Persistent support exists only for a named consumer: supported motor, gravity response, sleep validity, or publication.

### Alternatives and analytical consequences

- Exact geometric contact alone: attractive uniformity, but it does not supply step climbing or ledge avoidance. Adding large horizontal stair advances would change requested movement and can create speed bursts. A full rigid-body/friction solver also exceeds the desired approximate character behavior.
- Put support and edge protection into every contact pass: would let safety rollback fight crowd separation, introduce ordering conflicts, and multiply navigation queries. Reject this architecture before another evidence run.
- One final physical body with bounded navigation assistance: preserves the existing local crowd approximation while giving navigation a single owner and support a single meaning. This is the recommended architecture to scope next.

The remaining geometric choice is substantive: a finite support footprint can permit overhang and incremental stairs, while strict tangency requires a different stair mechanism. Before choosing footprint size or declaring this model executable, dry-run stair entry, short-drop departure, and ledge tangent motion together. Do not solve those three with independent tolerances.

### Paper scenarios and acceptance obligations

- Flat ground and shared seams: repeated zero-input ticks preserve support; changing triangle ownership does not imply a ledge.
- Stair entry and low ceiling: one bounded assisted path; final support must survive re-query; an obstructed lift cannot grant a grounded pose.
- Short drop versus cliff: the same footprint defines both; configured reach limits decide whether ordinary walking may descend. Tangent motion should remain available at a real boundary.
- Landing on a rim: either the final pose satisfies that footprint or remains unsupported; landing cannot grant a different standing privilege.
- Crowd displacement off a ledge: hard-swept separation may remove support; final classification allows gravity next step. No restoring the player into the mob through edge protection.
- Upward jump or separating bounce: proximity to a surface does not recapture support while ascending.
- Reference behind a ledge or wall: return makes bounded ordinary attempts and can remain blocked; it does not teleport or gain new support permissions.
- Hard object introduced through an occupied pose: distinguish recovery from normal sweeping. This remains an explicit placement/solidification concern, not a guessed normal-sweep success.
- Missing owner: retain the existing explicit coverage outcome; never infer an unsupported fall from unavailable geometry.

Maintainability acceptance: one owner for hard collision admission; one owner for navigation alternatives; one support predicate at an accepted pose; no contact-pass call back into navigation; no grounded state solely because rollback retained an old label; no duplicated body/reference/animation authority. The design must satisfy these analytically before a protracted browser/live run. No code changed in this whole-model review.

## Retail footing evidence and hard-entity support requirement — 2026-09-07

The user explicitly requires hard entity tops to count as support. This resolves the preceding scope question: eligible blocking hard-entity surfaces must participate alongside resident world surfaces in support selection, with slope/shape and directional collision policy still applied. It does not authorize mobile-body stacking or moving-platform carrying. Support validity must cover the entity's identity and current geometry/pose lifetime; the existing world-owner product proof cannot alone prove an entity top remains in place. Removal, movement, solidness changes, and reclassification must retire that support before reuse. Reuse the prepared hard geometry used by sweeps rather than building a second classifier or independently resolving shape transforms.

### Decompile findings

- `acclient.c:345329–345414`, `CPolygon::check_walkable`, projects the sphere center along the supplied up vector onto the polygon plane: `p = center - up * ((normal dot center + d) / (normal dot up))`. Its tests include radius-dependent edge/vertex acceptance, rather than requiring the actual sphere tangent point inside the polygon. Some decompiled comparison flags are undefined, so do not claim an exact corner predicate solely from this listing.
- `acclient.c:302082–302090`, `SPHEREPATH::check_walkables`, halves the stored check sphere radius before calling that predicate. `CPolygon::check_small_walkable` at `345416–345510` separately uses radius-squared times one quarter. `BSPLEAF::hits_walkable` at `349071–349098` uses that smaller check. These are evidence for an intentional projected footing area, not a universal one-full-radius overhang rule.
- ACE corroborates the projection and distance-to-edge arithmetic in `ACE/Source/ACE.Server/Physics/Polygon.cs:133–173`; `SpherePath.cs:209–215` passes a half-radius copy. ACE's corner early returns differ from the visible retail control flow, and retail mutates its saved radius where ACE copies it. Do not silently treat either implementation as an exact clean geometric specification for all corners or repeated calls.
- `acclient.c:349102–349128`, `BSPLEAF::find_walkable`, first finds a sphere-reaching walkable polygon, then adjusts the candidate using `CPolygon::adjust_sphere_to_plane` (`344680–344734`). Candidate reach/adjustment and projected footing validation are distinct operations.
- `acclient.c:301308–301350`, `CTransition::step_down`, checks contact normal and optionally walkability, then performs a final placement insertion. Crucially, the edge-slide walkability check is skipped when `step_up` is set. `step_up` clears the remembered walkable polygon afterward (`301468–301485`). Retail therefore does not supply a ready-made single invariant that can simply be copied into our small-step solver.
- `acclient.c:301354–301440`, `edge_slide`, treats steep contact, remembered walkable polygons, and absent contact differently, restoring/retrying transaction positions. This supports keeping navigation assistance distinct from contact geometry, but not copying its mutable rollback machinery.
- `acclient.c:346646–346717`, `CCylSphere::step_sphere_down`, uses cylinder overlap admission and an authored horizontal top plane. Volume support is already a deliberate character-support approximation rather than exact rim tangency.

### Consequence for the candidate unified model

The useful retail principle is **projected footing area plus a separately validated reachable resting height**. This gives a source-backed direction for polygon support and inward edge directions while allowing bounded overhang. It also changes the slope definition: projecting along up is different from using the sphere's normal-tangent point. Evaluate slopes explicitly when choosing the common rule.

Do not yet select half-radius as the runtime footprint: retail's separate step-up exemption is precisely why that constant alone does not prove incremental stairs work. A coherent replacement must dry-run the footprint and stair path together, without preserving a broader transient standing privilege that the following tick rejects. Derive edge guidance from the same footprint boundary; validate final body clearance against world and hard entity shapes; classify support at that final pose. Candidate discovery may search farther vertically than confirmation, but cannot change the standing predicate.

No runtime edits or new compatibility claims were made. These source findings narrow the design; they do not establish implementation readiness or close the current browser failure.

## Scoped replacement: footing and navigation integration — 2026-09-07

Scope requested by the user after the retail review. This section specifies the proposed implementation; it does not mark its numerical choices or feasibility as validated. Preserve the implemented contact kernel, motor, reference return, and independent camera ownership.

### Proposed geometric policy

Use the lower sphere radius as the full polygon footing allowance, measured in the placed polygon plane around the center projected along world up. This is deliberately broader than retail's ordinary half-radius walkability check. The full radius is chosen to allow the first small stair advance to obtain valid support without a separate step-up standing exemption or extra forward teleport. Derive the allowance from body geometry and the existing contact tolerance; do not introduce separate landing, walking, stair, and edge radii.

For a polygon with upward unit normal `n`, project `p = c - up * ((n dot c + d) / (n dot up))`. A face supplies a candidate when the in-plane distance from `p` to the finite polygon is within the footing allowance. Its target vertical correction remains `(R - (n dot c + d)) / n.z`, so the actual sphere stays on or above the support plane. Applying that correction leaves `p` unchanged. This establishes footprint idempotence algebraically; all-body hard clearance still has to accept the path and endpoint. Near-vertical faces do not become floor candidates.

Use finite segment/vertex distance, not an infinite edge half-plane expansion that admits arbitrarily distant polygon corners. Preserve boundaries and neighboring triangles as valid surfaces. Derive inward movement guidance from the boundary of this same allowed footprint, projected into horizontal movement coordinates; on slopes this requires accounting for the along-up projection. An inward normal from an unrelated narrower polygon boundary would reintroduce two policies.

Retain cylinder cap and ball resting-height geometry through their existing placed-shape helpers. Cylinder caps already use a radius-expanded support area; balls use their radial normal/resting height. These shape differences are explicit geometry, not movement-source exceptions. All adapters must satisfy re-query agreement at the returned resting pose. Do not claim polygon/cylinder footprint equivalence at arbitrary corners without the analytic tests below.

Full-radius overhang is a proposed gameplay concession: characters may stand near a rim with their centers outside its finite face. It must be disclosed with the retail half-radius citations and the actual coverage evidence. It is not claimed to be retail parity or an invisible change.

### Work packages and dependency order

1. **Stateless support geometry and analytical gate.** In `bsp_query.rs` and `volume_query.rs`, specify candidate footprint, resting height, and inward guidance independently of pending vertical movement. Exercise finite faces, slopes, corners, shared seams, caps, and balls using asset-free inputs. Prove candidate re-query agreement and dry-run first stair entry plus short-drop departure with the actual lower-sphere dimensions. Do not proceed to browser tuning if the full-radius rule fails those cases.
2. **World and hard-entity support fan-in.** Share placed-shape support dispatch between resident collision content and the prepared hard-target list in `mobile_contact/step.rs`. Use the same directional blocking filters, cell/domain membership, and placed geometry as hard sweeps; exclude self, nonblocking pairs, and yielding bodies. Select one support candidate deterministically from the combined local population. Reuse existing spatial candidate machinery where applicable, not a new independent index.
3. **Honest retained support source.** Extend `GroundSupport`'s static-only source contract to distinguish world product support from hard entity support. World support may retain its existing immutable owner proof. Revalidate entity support against the current prepared hard body and support geometry at each substep, including sleeping supported bodies, rather than introducing a second revision system. An entity ID identifies what must be rechecked; it is not a validity proof. Existing `EntityCollisionProof` is used for selectable frozen ray targets and includes geometry/pose/membership; audit its narrower selection policy before reusing any primitive, and do not broaden that selection policy to make character support fit. Removal, pose/shape changes, reclassification, and solidness changes must invalidate old support. No carrying or velocity inheritance from moving platforms is included.
4. **Navigation cutover.** In `mobile_contact/step/stairs.rs`, have current-pose confirmation, settling, and stair acceptance consume the same support geometry. Confirmation has contact tolerance only; reachable support requires an accepted swept adjustment. Remove height-dependent edge promotion and the blocked-descent edge bridge together. Keep one stair alternative and one bounded tangent attempt. Retain rollback only to previously valid footing; external correction and jumps bypass edge avoidance. Preserve valid cached footing only while pose/shape/source remain valid. Final support refresh after displacement cannot snap to a nearby floor. A materially blocked lower candidate is unsupported; distance comparisons must use the shared spatial tolerance rather than an arbitrary floating-point fraction epsilon.
5. **Conformance, runtime regression, and cleanup.** Retain meaningful stair/short-drop tests and repair the model when they fail. Add tests for supported hard entity tops, removing/moving/reclassifying a supporting entity, directional filters, and disconnected EnvCells. Re-run the catalog-enabled Explorer possession scenario that currently fails. Then resume the original crowded live acceptance and content census. Remove obsolete support vocabulary and update world/core architecture docs and compatibility markers. No new plan document, general constraint framework, or retained temporary diagnostics.

### Required analytical cases before integration

| Case | Required result |
| --- | --- |
| First contact at a stair riser | The bounded lift/ordinary-forward/settle path ends at footing accepted on the next tick; no extra horizontal displacement. |
| Step up with low headroom | Hard clearance declines the alternative; ordinary accepted progress survives. |
| Departing a shallow step | Higher support remains valid only within its footprint; descent to lower support must be hard-clear when selected. No edge-height bridge. |
| Ledge tangent motion | Guard removes the unsupported component while allowing the component tangent to the same footprint boundary. |
| Landing or reconciliation at a rim | Same final support result as ordinary movement at that pose; no inherited temporary privilege. |
| Sloped or triangulated surface | Footprint/resting-height agreement survives vertical adjustment; shared seams do not create a guard boundary. |
| Contact pushes a body off support | Final result is unsupported; navigation cannot restore the overlap or repeat stair assistance. |
| Hard entity top | Same shape rule as its resident-world equivalent, subject to pair filtering and current source validity. |
| Supporting entity disappears or moves | Old standing state cannot persist solely because the body was asleep. No automatic platform transport. |
| Coverage unavailable | Preserve explicit unknown/coverage handling; do not classify absent data as empty space. |

### Limits and stop conditions

This is a focused navigation/support replacement inside the existing body pipeline, not another contact-solver rewrite. Main touched areas are world support queries, support source contracts, contact preparation, and the stair/settle consumer. Core/host should require only contract adaptation where retained support types cross boundaries; neither should gain a second support decision.

Stop at the first analytical gate if the full-radius footprint cannot satisfy stairs and edge guidance together without new movement-source exceptions. Hard geometry appearing through an already occupied body remains the separate placement/recovery concern identified above; do not claim this support change resolves arbitrary interpenetrating teleports. A fixed number of substeps does not prove exhaustive ledge detection across arbitrary-speed gaps; quantify that limitation rather than adding an unbounded search.

Acceptance requires both maintainability invariants from the whole-model review and the original contact/camera/runtime gates. Current status: scope written; runtime implementation not started.

## First footing gate result and horizontal-footprint resteer — 2026-09-07

The user authorized execution of the first analytical/fixture gate. No production solver change was made. Temporary asset-free fixtures were compiled inside the world test module so they could reuse the existing stair scene builder and actual `CollisionScene::sweep_static_sphere` queries. Candidate support geometry was isolated from production support selection. The temporary module was removed after the gate to avoid retaining a competing test-only support implementation; migrate its assertions onto the production primitive during implementation.

**Initial proposal failed.** In-plane distance shrinks the horizontal reach of the footprint on slopes. The production sweep reaches the 0.3 m riser at lower-sphere center `(90.05503, 96, 0.48)`. The first motor substep supplies 0.001388889 m forward travel, derived from runtime acceleration and substep constants. At slope 0.5 (approximately 26.6 degrees), the projected point's in-plane distance to the tread is 0.4959373 m, outside the 0.48 m sphere radius. The lift and forward sweeps are clear, but the candidate cannot establish support. Flat and slope-0.25 cases passed. Candidate re-query agreement and shared seams also passed. Log: `/tmp/footing-policy-first-gate.log`; source: `/tmp/footing-policy-plane-prototype.rs`.

**Revised geometric definition:** use a horizontal disk of lower-sphere radius against the polygon's XY footprint. Surface slope controls the resting height and slope classification, not the lateral reach of the feet. For upward faces, the projected point along up has the same XY coordinates as the sphere center, so the implementation needs only finite 2D polygon/segment distance for footprint admission and inward guidance. This is simpler than in-plane distance plus a slope-dependent horizontal gradient. Vertical adjustment leaves footprint validity unchanged by construction. It is a deliberate approximation of the retail projected-footing principle, not a claim of exact retail geometry.

Retain the resting-height formula `(R - (n dot c + d)) / n.z` and full-body hard admission. Surface search bounds, approach velocity, slope threshold, and actual clearance remain required; footprint overlap alone does not imply support. The footprint admits its boundary within the existing spatial contact tolerance, rather than subtracting a new margin that could prevent very small substeps from establishing support.

The revised prototype passed six focused tests (`cargo test -p holtburger-world --lib --features physics-profiling footing_gate -- --nocapture`):

1. A 240-case matrix of heights, inside/outside positions, edges/corners, and slopes 0/0.25/0.5 confirms classification independent of height and idempotent resting-pose queries. Both acceptance and rejection are exercised.
2. Two triangles sharing a diagonal give matching support on that seam, including its endpoints.
3. Flat and sloped stair entry uses production hard sweeps to locate first contact and check lift/forward/descent. All three slopes have the same 0.44358063 m horizontal footprint distance after the first small advance, and the accepted resting pose survives re-query. No extra forward travel is supplied.
4. Once the upper footprint ends, the 0.3 m short-drop descent to the lower floor is hard-clear and support remains valid. A deeper floor is a geometric candidate but outside the configured walking drop limit.
5. Straight-edge guidance preserves tangent movement on flat/sloped faces. A rounded convex-corner tangent that leaves the footprint is explicitly rejected by the final support check.
6. The upper sphere's production sweep blocks a requested lift under a low ceiling; a lower-sphere support candidate cannot authorize that lift.

Log: `/tmp/footing-policy-horizontal-gate.log`; formatted prototype source: `/tmp/footing-policy-horizontal-prototype.rs`. Tests execute without content assets or a live server. Cylinder and ball adapters remain their existing shape-specific resting-height formulas; at fixed XY those heights do not depend on starting Z. Hard-entity adapter/lifecycle tests remain work-package 2/3, not evidence claimed by these polygon fixtures.

**Scoped verdict:** the revised polygon rule passes the first feasibility gate for the tested representative cases. This is sufficient to proceed to production integration, not a proof of arbitrary geometry or complete navigation correctness. The existing full stair/edge conformance suite and failing browser scenario remain mandatory after cutover.

**Explicit tradeoff:** one tangent attempt may hold at a rounded outer corner because a straight tangent leaves a curved admissible footprint. Do not add iterative contour following or assume first-order projection grants support; movement toward the interior can recover. Full-radius horizontal overhang, shape-specific resting heights, finite navigation alternatives, and final support rechecking are the proposed coherent approximation.

The horizontal-footprint definition supersedes the in-plane metric and gradient discussion in the preceding scope. No new radius knobs or stair-only support exemptions were introduced. Production support still has the known bug until the scoped implementation lands. Formatting and diff checks pass after removing temporary test wiring.


## Footing production cutover and hard-top support — 2026-09-07

Implemented the horizontal-footprint definition in the production polygon query. Shared `SupportFeature` now carries either face support or an overhang with an inward horizontal normal. Removed the second shape-level feature enum, height-dependent edge promotion, blocked-descent support bridge, and unused geometric helpers. Current-pose confirmation admits only contact-tolerance height error; settling must prove its vertical adjustment through the existing hard sweep. Stair and ordinary movement consume the same candidates. Edge protection reads the prior valid footprint, with one checked tangent attempt.

Migrated the six temporary gate assertions to production-query fixtures. Added a small finite-face bounds regression: support may exist at a rim beyond Euclidean sphere/bounds overlap, so support pruning uses horizontal bounds and leaves height admission to the shape query. This applies inside BSP traversal as well as the shared placed-shape dispatcher. Ordinary collision bounds remain unchanged. Deleted four retail differential scenarios and three orphaned oracle helpers whose expected edge behavior contradicts the deliberately changed footing rule; retained production stair, short-drop, slope, and head-clearance coverage.

World colliders and prepared hard entity targets now feed the same support selection through one placed-shape dispatcher. Hard support uses the same directional response and reached-domain filters as obstruction. Yielding mobile bodies are excluded. `SupportSource` distinguishes immutable world-owner proof from hard entity ID; IDs are not validity proofs. Prepare all hard targets before support classification and actuation, so body ordering cannot hide a later-prepared platform. Hard-entity landing impacts retain their entity source for reporting.

**Lifecycle concession clarified by the user:** retail may leave a body grounded in midair after its support disappears. Matching that behavior is acceptable if it simplifies the implementation. Immediate support-loss detection is therefore not a mandatory correctness gate. The current implementation reuses the ordinary support query each substep for retained entity support, including sleeping bodies; it adds no removal subscriptions, dependency graph, platform revisions, or carrying. Keep this while inexpensive, but do not add machinery merely to guarantee immediate falling. The removal/movement fixture documents current behavior, not a permanent product requirement. Reclassification and nonblocking-policy tests exercise the same current path.

**Runtime evidence:** the catalog-enabled debug GPU Explorer possession scenario passes (`/tmp/footing-final-possession.log`, exit 0). Its prior backwards-movement stall is gone. The harness now waits within its existing bounded timeout for released movement to finish braking before measuring pure turning; the zero-translation turn assertion remains. This is a measurement correction for the finite-acceleration motor, not relaxed movement tolerance. Screenshot `/tmp/footing-final-possession.png` was inspected: extremely close/clipped avatar framing limits visual judgment, so this is behavioral harness evidence rather than a visual-quality claim. That browser run predates the final hard-entity support source integration.

**Checks so far:** production footing cutover passed 621 world, 354 core, and 275 host library tests plus all-target Clippy with warnings denied. The added bounds regression brought world tests to 622 passed. Hard support then passed those 622 world tests; new lifecycle fixtures and the full final cross-crate checks are being completed. Logs: `/tmp/footing-integrated-libraries.log`, `/tmp/footing-bounds-test.log`, `/tmp/footing-final-clippy.log`, `/tmp/hard-support-world.log`, `/tmp/hard-top-test.log`.

Maintainability acceptance for this cutover:

- [x] One polygon footprint definition for landing, walking, settling, stairs, and edge guidance.
- [x] One source-neutral placed-shape support dispatcher; no duplicate world/entity geometric policy.
- [x] Source identity and validity are explicit; no entity ID masquerading as a world proof.
- [x] All hard geometry is prepared before support affects input; no ordering-dependent preparation.
- [x] No recursive navigation, support dependency tracking, or moving-platform subsystem.
- [x] Finish hard support filtering/lifecycle coverage and final library/Clippy validation.
- [x] Rerun the affected debug crowd budget and final integrated runtime regression.
- [x] Complete the previously open content census and live crowded-client acceptance; quiet Explorer success does not close either. **Closure:** Census and later crowded-client acceptance completed; see final acceptance audit below.

No additional tuning constants or stair-only standing privileges were added. Full-radius horizontal overhang and the single-tangent convex-corner limitation remain explicit gameplay tradeoffs. This section supersedes earlier statements that production support is unchanged.


### Cutover verification checkpoint

The final cross-crate library run passed **624 world, 354 core, and 275 host tests** (`/tmp/hard-support-libraries.log`). The additional falling-on-hard-top test then passed independently and verifies the final entity support source and entity collision report (`/tmp/hard-top-landing.log`). All-target Clippy for world/core/host/debug harness passed with warnings denied (`/tmp/hard-support-clippy.log`); a final world-only lint covers the subsequent landing fixture and comment cleanup. The shared horizontal bounds include the existing contact tolerance so broadphase cannot reject a footprint admitted at its tolerance boundary.

The retained debug crowd workload passed sequentially, without concurrent builds or another benchmark: 45 bodies, 60 ticks, one warmup and three measured repetitions per scenario (`/tmp/footing-crowd-benchmark.log`). Swarm mean 22.400–22.604 ms, p95 26.541–28.723 ms, maximum 30.814 ms; pinned p95 13.883–14.061 ms; corner p95 1.853–1.963 ms. The specified p95 <30 ms gate passes, with limited headroom. Swarm travel, residual penetration, and query counts match the preceding retained baseline at reported precision. This is not evidence for support-heavy authored BSP scenes or a live dungeon; no causal timing comparison against old captures is claimed.

Hard-top stable standing, falling/landing/reporting, movement/removal, mobile reclassification, and nonblocking policy now have passing fixtures. Disconnected-EnvCell support coverage remains open; the production path already uses reached-domain intersection before geometry. Final browser regression after hard-support integration and the original content/live gates also remain open. No additional support-removal machinery is warranted by this checkpoint.


### Support integration gates closed

The prepared-domain fixture passes (`/tmp/footing-domain-test.log`): the same placed hard cap supplies support in the mover's reached outdoor domain and does not supply support when assigned to a disconnected EnvCell. It tests the contact kernel's prepared-membership contract, not topology discovery. Existing topology/residency tests own discovery.

The final integrated debug GPU browser command completed with exit 0 after hard-support integration: `npm run harness:browser -- --brief --gpu --spawn-wcid 1 --spawn-simulated --possession-scenario --vite-port 1497 --screenshot /tmp/footing-hard-final-possession.png`. Log `/tmp/footing-hard-final-possession.log`; screenshot inspected. All possession assertions pass, including movement, braking before pure turn, jump, camera transitions, and lifecycle checks exercised by that scenario. The screenshot still has close/clipped avatar framing; it does not establish presentation quality or live camera performance. This closes the scoped reproduction gate, not the separate worker-concurrency or crowded-client gate.

The requested support-removal concession is also recorded at the runtime entity-support recheck in `mobile_contact/step.rs`. No behavior was changed to enforce the concession.

A temporary catalog census ran the production setup preparation and physics-state resolver over all **43,913 templates / 3,909 distinct setups**. No missing setup or setup-preparation failure was encountered. **6,074** templates have no movement spheres (fixed-position geometry), and **104** have effective missile state. No initial template resolved Frozen, Static, or unsupported semantic state; those remain runtime-transition cases, covered by resolver/producer tests rather than this initial catalog census. The census does not model arbitrary server overrides, appearance-part substitutions, or subsequent animation state. Logs and source remain under `/tmp/contact-classification-census.log` and `/tmp/contact_classification_census.rs` after temporary source removal.

The catalog includes 542 doors: 488 fixed-position solid, 10 fixed-position suppressed, and 44 solid with movement spheres. All doors have gravity disabled. The client keeps solid bodies without integration work hard, whereas explicitly simulated Explorer bodies request integration whenever their state permits it. The 44 sphere-bearing doors therefore require a closer preparation/classification check before the content gate can be marked complete. Do not infer their final admitted role solely from the existence of spheres.


## Classification gate: revise — integration is not contact mobility

The production-content check exposed a major gap; implementation pauses here per the goal's stop condition. All **44** sphere-bearing door templates also pass `prepare_dynamic_entity_physical_definition` as grounded bodies with zero gravity. Their explicit template part-change lists are empty; the focused preparation check used default appearance, so this is movement/preparation evidence rather than a general generated-appearance audit. Examples: WCID 412 (`0x020019ff`), WCID 583 (`0x0200027c`), and sliding door WCID 720 (`0x02000310`). The first two have a single movement sphere of radius 0.1 m, centered only 0.018 m above the root; that is plainly not the door's blocking silhouette. Log: `/tmp/contact-classification-door-check.log` (44 accepted, zero rejected).

The failing composition is deterministic from current code: `explorer_physical_demand(Simulated, ...)` admits eligible integration; `PreparedBodyContact::from_body` treats integration-excluded or fixed-position definitions as hard and otherwise assigns ordinary mobile response. These admitted doors consequently use small movement spheres for peer response instead of the authored door target. The current client may keep an idle zero-gravity door hard when it has no integration work, but authored-motion/reconciliation work can change that admission. Do not claim every live door currently fails without inspecting its runtime motion input; the Explorer path alone establishes the contract gap.

**Root cause:** integration scheduling and contact yielding are different facts. A door can require authored animation/state advancement while remaining a hard obstacle. Movement-sphere presence is also insufficient evidence of yielding eligibility. The content audit that remained open in phase 1 was consequential; synthetic creature/fixed-body fixtures did not close it.

**Recommended direction for review:** resolve contact response eligibility independently from integration demand, once in producer preparation from available authoritative entity semantics. Preserve authored hard target geometry for bodies that may animate but must not yield. Keep mobile creature sleeping/waking independent from that eligibility. This must remain a small classification cutover, not per-door exceptions, a new solver, or support-specific policy. Before implementation, map client and Explorer inputs for creatures, ordinary physical items, doors/scenery, missiles, and attachments and decide the intended yielding set. No new eligibility type or runtime policy has been added in this checkpoint.

The existing support-removal concession does not address this issue: this is about which shape blocks a moving player, not stale support after disappearance. Footing geometry, hard-top support, and their passing runtime/fixture gates remain useful; the overall contact implementation is not ready to mark complete until this independent role decision is corrected. The temporary census binary source was removed from the repository and preserved in `/tmp/contact_classification_census.rs`. No unchecked-in-asset test remains.


## Accepted classification direction — animation, root motion, and hooks

The user agreed that animation activity does not grant collision yielding, with two explicit qualifications: root motion changes the body's placement, and animation hooks may change physical properties. An authored hard obstacle must retain its collision role while ordinary visual animation advances. Accepted root motion places that obstacle's existing geometry; it does not turn the obstacle into a compliant mobile body. A physical-property hook changes only its explicitly owned facts, after which normal preparation/publication refreshes the affected collision state.

Do not interpret this agreement as permission to ignore physical hooks. The present preparation code rejects default scripts with collision-mutating hooks (`collision_mutating_hook`: ReplaceObject, Ethereal, Scale, SetOmega, CreateBlockingParticle, and unknown hook kinds) and rejects default animation that moves collision-bearing BSP parts. Those are existing unsupported-content boundaries, not proof that animation never affects collision. Preserve honest rejection unless the specific hook is supported through the existing property/placement path; do not add a generic hook engine to this classification change.

Implementation scope:

1. Resolve yielding eligibility separately from integration scheduling. Join it to physical body preparation once; the contact kernel consumes it without reading animation activity or reinterpreting entity categories.
2. Use facts available to both producers. Explorer has catalog WeenieType and item type; the live client has object-description flags and item type, and its current `ClientEntityBodyFacts` does not carry a WeenieType. Do not introduce a live catalog dependency or reuse a presentation class as physics authority merely for convenience. Map the intended yielding population explicitly before selecting the contract.
3. Preserve hard authored target geometry for animated obstacles, including the 44 sphere-bearing doors. Trace accepted root placement separately from peer separation; an integration-excluded role must not accidentally suppress an otherwise supported authored-root update. Audit the existing fixed-position translation constraint rather than silently assuming it already admits root translation.
4. Reclassification from supported physical-property changes must use existing body reconfiguration and placement publication. Sleeping and current velocity must not redefine an eligible creature's collision role. Solidity filtering remains separate from yielding.
5. Validate an animated hard obstacle, a hard obstacle with an accepted root-pose change, an explicit solidity change, and a sleeping yielding creature. Retain only tests for implemented behavior; unsupported script hooks remain explicit preparation errors. Re-run the affected door content case and contact conformance before another broad live evidence run.

This agreement resolves the conceptual separation raised at the previous stop. The exact yielding population and producer mapping remain the next bounded design step; no runtime eligibility mechanism has been introduced yet.


## User correction: restore the intended yielding population

The user clarified that pushability was intended to depend on **entity type and physics properties: mobs and players that are not static/fixed**. The preceding proposal to select a broader yielding population was unnecessary drift. Doors, scenery, and ordinary items do not become yielding merely because a producer requests simulation. Do not reuse the protocol `PUSHABLE` bit, which remains an unsupported legacy semantic, or rendering/presentation classes to determine this policy.

Concrete mapping and implementation constraints established from current code:

- The live client has `ObjectDescriptionFlag::PLAYER`, `ItemType::CREATURE`, and object flags for doors/corpses/vendors. Explorer has WeenieType and template item type. Normalize the corresponding gameplay identity at these producer boundaries; do not require the live client to load the offline catalog.
- Preserve type eligibility through physics-state replacements. Frozen/static restrictions must be reversible without reinterpreting animation state. Fixed-position movement geometry remains nonyielding; sleep and zero velocity do not make an otherwise eligible character hard.
- The current kernel's `PreparedContactRole::Hard` skips actuation entirely. Simply routing all noncharacters into that branch would disable their admitted motion. Separate hard collision participation from ordinary advancement: hard authored targets are prepared at accepted poses, while only eligible character bodies participate in compliant pair correction. Use the existing bounded motion and publication paths; do not introduce a second animation owner or derive movement from rendered poses.
- Existing `FixedPosition` actuation is explicitly orientation-only (`solve_fixed_position_tick`), and collection preparation applies pending authoritative snaps before target publication. Do not claim that this already implements arbitrary authored root translation. Trace the supported root contribution at the actuation boundary as part of the cutover; preserve explicit limitations instead of discarding a root offset unnoticed.
- Physical hooks retain their individual state/geometry effects; they do not confer general yielding merely by running. Existing unsupported hook rejection remains outside the scope of a new general hook interpreter.

Next implementation work is the type/state classification cutover and its body-advancement integration, followed by the door/character transition fixtures. No additional gameplay selection decision is requested: the user's stated population governs. The previous classification blocker is resolved at the requirements level; code implementation remains incomplete.


## Character-only yielding cutover — implementation checkpoint

Implemented explicit `EntityContactResponse` in prepared collision facts. `Obstacle` retains hard geometry; `Character(EntityIntegrationEligibility)` retains character identity through reversible Frozen/Eligible changes. The kernel reads this contract; it does not inspect presentation classes, animation activity, or current velocity. Existing fixed-position geometry and explicit integration exclusion (including frozen query targets) remain hard restrictions. Client character admission now stays eligible even at zero gravity and zero authored work; sleeping still suppresses ordinary work. Thus idle characters do not become hard merely because no input exists.

Live preparation derives character identity from the selected player/player flag or creature item type, excluding door/corpse/vendor flags. Explorer physical preparation maps creature-family WeenieTypes (Creature, Cow, AI, Pet, CombatPet), with other types remaining obstacles. No live catalog dependency or protocol PUSHABLE reinterpretation was introduced. Client preparation equality includes the new identity fact so a changed type cannot retain stale policy. State-only reconfiguration updates character physical restrictions while preserving obstacle identity.

Nonyielding bodies with admitted movement still use the existing bounded sphere movement path, then publish their accepted root pose into authored hard target geometry before characters advance. They are excluded from compliant sphere-pair correction. The ordinary input/integration and advancement loops were consolidated so a character's support query sees preceding accepted obstacle poses. Projectile targets reuse those hard shapes without adding a duplicate. This is a single deterministic obstacle-first pass, not moving-hard-body convergence or recursive contact propagation. Existing placement limitations for hard geometry appearing inside a body remain; no new interpenetration recovery policy is claimed.

A briefly introduced separate ordinary-integration state enum was removed: explicit producer exclusion already selects the nonadvancing hard path. Keeping that restriction, while correcting character admission and adding independent type eligibility, avoids a second scheduling state machine. The first test run exposed frozen fixture publication without captured input when exclusion was bypassed; preserving the explicit exclusion contract resolved it. The final implementation does not publish an uncaptured ordinary actor.

Verification:

- Existing full libraries pass: **626 world, 354 core, 275 host** (`/tmp/contact-role-libraries.log`). This run precedes the three additional focused assertions below.
- `animated_obstacle_keeps_authored_target_geometry_and_does_not_yield_to_a_character` passes. A broad cylinder target advances from an authored root offset while a character presses against it; its trajectory equals the same obstacle alone, and the character remains outside the full target radius rather than merely the smaller movement sphere (`/tmp/contact-role-obstacle-test.log`).
- Client producer test passes: player/creature identities retain zero-gravity rest admission, while door/corpse/vendor/item identities are not promoted (`/tmp/contact-role-producer-test.log`).
- Reconfiguration test passes: freezing/thawing disables/restores character yielding without promoting an obstacle (`/tmp/contact-role-state-test.log`).
- All-target warnings-denied Clippy passed for world/core/host/debug harness before the final producer/state fixtures (`/tmp/contact-role-clippy.log`); final fixture-inclusive run is `/tmp/contact-role-final-clippy.log`.

Remaining cutover work: rerun actual catalog door preparation through the new role, final debug crowd/browser checks after this scheduling change, and audit the existing orientation-only `FixedPosition` root-translation boundary. The new obstacle regression covers an ordinary grounded obstacle with authored root input; it does not claim that geometry lacking movement spheres now supports root translation. Live crowded-client acceptance remains pending a route/reposition for the configured character, last observed at an idle dungeon entrance. No user reply to that location question has arrived during this checkpoint.


## Actual-door and fixed-root audit checkpoint

Re-ran the temporary catalog preparation probe against the new contract. All **44** sphere-bearing doors prepared successfully with `EntityContactResponse::Obstacle` (`/tmp/contact-role-door-census.log`). The focused probe supplies the same noncharacter fact selected by the Explorer WeenieType mapping; it is content preparation evidence, not a live door-collision capture. Temporary repository source was removed; exact source is `/tmp/contact-role-door-census.rs`.

The post-classification 45-body debug benchmark completes its behavior assertions but does **not** consistently meet the timing gate (`/tmp/contact-role-crowd.log`): swarm p95 is 33.413, 31.968, and 27.586 ms, against the 30 ms target. Mean is 27.531, 25.733, and 22.150 ms. Trajectories, penetration, and query counts are unchanged at reported precision. The benchmark ran after census completion and without a concurrent build. Timing acceptance is reopened; a passing final repetition does not erase the preceding misses. The decreasing run times and unchanged algorithmic workload warrant checking measurement conditions before attributing the change or optimizing. Final browser regression still needs rerunning after the root-placement work below.

The fixed-position audit confirmed that `PhysicalBodyActuation::FixedPosition` previously retained authored rotation but discarded translation. Added explicit world-axis authored root translation to that actuation; ordinary coasting supplies zero. `solve_fixed_position_tick` now traverses and publishes that placement while retaining zero translational velocity and acceleration. Root motion is authored placement, not gravity or compliant contact response. Shared `place_body_pose` consolidates root/cell-frame normalization with contact-result publication so a changed cell cannot move the world-space point accidentally. Fixed collection publication now reports accepted path displacement instead of a constant zero.

The new three-tick fixture crosses an outdoor landblock boundary, continues authored travel, and verifies the normalized root pose, reported displacement, and zero retained velocity/acceleration (`/tmp/fixed-root-crossing-test.log`). The first full library run found the constant-zero fixed publication assumption; the focused fixture passes after correcting it. Existing library cases passed in that run; final lint is `/tmp/fixed-root-clippy.log`.

Client actuation producers and possessed Explorer fixed-body actuation supply root translation. The producer audit identified a remaining omission: `advance_unpossessed_motion` discards playback's returned offset, while its collection callback supplies only coasting actuation. That path must carry the authored sample before claiming unpossessed Explorer root-motion integration complete. Audit translation scale and root sample ownership at the same boundary; do not duplicate playback or apply an offset twice. This is continuing integration work, not a new yielding policy. No generic physics-hook implementation or hard-body penetration-recovery policy was added.


## Root producer integration and final synthetic checkpoint

Closed the unpossessed Explorer root omission identified above. Playback advances once and returns its authored sample to the collection input. The collection adapter now accepts `PhysicalBodyInput`, preserving both ordinary actuation and its reference contribution rather than wrapping every body as autonomous. Stationary playback without motion does not manufacture a root sample. Possessed Explorer input already composes its root contribution and remains autonomous, avoiding double application.

`PhysicalBodyInput::placement_actuation` owns fixed-body reference composition at the world tick boundary; other movement modes consume that sample through their existing substeps. Client fixed producers supply base placement, and root translation is scaled once before submission. Unpossessed Explorer uses the same scale/gating rules; possessed fixed translation also applies object scale. Fixed authored translation remains explicit placement with zero retained translation velocity/acceleration. This does not make an obstacle pushable, implement arbitrary physical hooks, or provide moving-obstacle penetration recovery.

Revalidated saved verification artifacts:

- Full affected libraries pass: 629 world, 355 core, 275 host (`/tmp/root-producer-libraries.log`). One world timing benchmark is intentionally ignored in the ordinary suite.
- The additional host fixture `unpossessed_fixed_obstacle_consumes_scaled_root_motion_once_per_tick` passes (`/tmp/root-unpossessed-test.log`): 30 ticks at scale two produce the expected two metres with zero retained translation velocity/acceleration. It exercises the unpossessed producer, not merely a direct solver input.
- All-target Clippy for world/core/host/debug harness passes with the new fixture (`/tmp/root-producer-clippy.log`). The dependency future-compatibility notice for binrw is not a new project lint.
- Debug GPU Explorer possession completed successfully (`/tmp/contact-root-final-possession.log`, screenshot `/tmp/contact-root-final-possession.png`). Movement assertions pass; close/clipped avatar framing remains and this does not establish live crowded-camera quality.
- The subsequent standalone 45-body debug benchmark passes all three measured swarm p95 values: 27.982, 24.171, 23.583 ms (`/tmp/root-final-crowd.log`). Means are 21.673, 20.715, 20.360 ms. Pinned p95 is 10.904–11.631 ms; corner p95 is 1.372–1.584 ms. Query counts and trajectories match the preceding classification run at reported precision. These results meet the scoped 30 ms gate, but do not erase earlier timing misses or prove a causal performance improvement.

Remaining acceptance is live swarming, sustained pressure/release and authority return, actual production camera servicing under entity load, and the final retired-mechanism/architecture cleanup audit. The route/reposition question remains unanswered; the last observed idle entrance cannot substitute for that live scenario. No new classification decision is needed: mobs/players permitted by their physical state yield; fixed/static bodies and other entity types remain obstacles independently of animation.


## Final classification and vocabulary audit

Closed the prepared-role audit against the current production boundaries. `PreparedBodyContact::from_body` excludes suspended bodies, retains fixed/excluded bodies as hard targets, and consumes character eligibility without using current velocity or animation. `client_remote_body_target` excludes attachments from independent integration; parent delegation removes their dynamic physics while retaining a parent-derived pose. Missiles retain the dedicated impact path and producer-owned return exclusion. The retained sleeping-contact, freeze/thaw, projectile-impact, and producer identity fixtures cover those distinctions. The catalog census and 44-door recheck close the initial-content classification obligation; they do not establish every possible server override or animated hook.

The runtime/UI/test/architecture vocabulary search found no surviving pressure driver, ordered-player transaction, push-group rollback, or `dynamic_contact` dependency. Remaining uses of recursion describe bounded nonrecursive behavior; renderer `groups.push(group)` is unrelated. World/core architecture notes describe the current body, reference, playback, and camera owners. Existing retail markers cite the collision-response and projected-footprint decompile locations and state the deliberate behavioral changes. Updated the footprint marker's evidence limit: the completed template/setup census is not a geometric census of every authored stair or ledge. No new mechanism or numerical policy was introduced by this cleanup.

Marked the classification and retired-mechanism cleanup checkboxes complete. Live debug dungeon swarming, pressure/reversal, authority updates, and production camera cadence remain the outstanding acceptance gate. The broader support-content generality remains an explicit evidence limitation, not a claim inferred from catalog preparation success.


## Live Olthoi reproduction supersedes the location blocker

The user verified that the configured character is already in the crowded dungeon and reported severe player and mob sluggishness. A fresh debug-host passive capture confirms `+Holtfighter` (the account's only selectable character) with 58 Olthoi among 66 observed actors (`/tmp/olthoi-live-passive.json`). The worktree app `.dev.env` supplies credentials; no route/reposition prerequisite remains. The previous idle-entrance interpretation was wrong and must not be used to defer live acceptance.

The 15-second observation recorded roughly 93 published samples for several moving Olthoi, versus 948 camera events. Some mobs travelled several metres; others barely moved. These counts distinguish publication cadence from visual assumptions but do not isolate solver time, scheduling, or command latency. The probe disconnected explicitly and exited successfully. Initial sandbox connection denial happened before authentication; the successful run used authorized network access and the debug binary.

Reopened runtime responsiveness acceptance despite passing synthetic timing. Temporary opt-in tick timing and probe command-latency capture are being used to separate synchronous simulation time from delayed input servicing. The next drive capture waits five seconds after entry and respects the relog cooldown. Remove temporary production timing instrumentation after diagnosis; no solver tuning is justified by publication counts alone.


### Live gate fails: simulation cost causes extreme time loss

The debug drive capture (`/tmp/olthoi-live-drive.json`) completed successfully, with five seconds of settling before input and an explicit disconnect. It selected the same character and waited more than 60 seconds after the preceding session. Over 98 instrumented ticks, simulation averaged **247.426 ms**, median **255.647 ms**, p95 **394.705 ms**, maximum **429.070 ms**. Wall intervals averaged **246.001 ms**. Movement command acknowledgements took **0.855–1.264 ms**; this measures host acknowledgement, not application of input by the next simulation tick.

The existing four 1/120-second substep admission advances at most 33.333 ms per tick. Summing admitted versus elapsed intervals gives **13.48%** simulated time in this capture. That explains substantial slowdown of body movement and turning without requiring IPC acknowledgement contention. Forward movement covered 1.632 m in five seconds; subsequent strafe phases showed no translation. Collision pressure may also constrain those phases; timing alone does not prove why their displacement is zero. Camera service emitted 1,519 events, but no claim about rendered orbit smoothness follows from event count alone.

This is a major live acceptance failure, not a small missed timing percentile. The synthetic 45-body scene does not represent the cost of this dungeon. Stop implementation/tuning at this finding under the execution instruction. The next investigation must attribute the synchronous simulation cost within the real content workload (preparation, hard-world/support queries, contact correction, reports/publication) and assess the responsible algorithm before changing limits. Increasing admitted time or dropping contact passes would hide/change the failure rather than establish the responsible cost.

Temporary production tick logging and its probe output field were removed after capture. Retained harness improvements are the five-second settling period and per-drive command acknowledgement latency. The current debug binary still contains the temporary instrumentation until the next build; it is opt-in via `HOLTBURGER_PROBE_TICK_TIMING`. No gameplay solver change was made during this reproduction. The live gate remains failed and the goal incomplete.


## Whole-diff simplicity review reopened

The user clarified that the complete working diff is the plan execution and that keeping the simpler design takes precedence over preserving this implementation. Compare against committed HEAD, not an abandoned intermediate proposal. The prior bounded structural-review pass and vocabulary cleanup do not establish that the complete replacement is simpler.

Initial source findings:

- HEAD already has bounded dynamic contact passes, but negotiates prepared trajectories, samples/refines peer contacts, and may re-solve truncated or held movement. The new sphere-pair correction eliminates that trajectory negotiation. This is a concrete simplification; describing the baseline only as recursive push groups was inaccurate.
- The replacement's outer collection clones full `SpatialBody` values. Each substep reconstructs `PreparedBodyContact` and `WorkingBody`, prepares hard shapes, emits `ContactBodyUpdate`, then applies those updates back to the cloned bodies before the next substep reconstructs working state again. Result aggregation remaps path fractions and accumulates motion in another map. The round trip is a maintainability and repeated-work concern independently of its unmeasured share of live tick time.
- Reporting independently prepares authored shapes and compiles a shadow index in each substep. This separates observational policy appropriately, but also creates another geometry-preparation owner. Decide which preparation can be shared without conflating collision response and reporting policy.
- Small integration steps still invoke full world/topology sweeps for ordinary motion, correction, angular motion, and stair/settle attempts. Fixed bounds do not make those operations inexpensive. The live cost of each category remains unmeasured; do not label all sweeps unnecessary or assume pair correction dominates.
- Authority reference and observed locomotion add real state to meet the accepted behavior: displaced bodies return without snapping, and visible locomotion follows accepted movement without replaying action hooks. Camera worker ownership is another separate subsystem change. These must be judged by their required behavior and ownership, not counted as evidence that the collision rule itself simplified the whole diff.
- The diff includes new untracked solver, camera, motion, and test files; ordinary `git diff --stat` omits them. Tracked line totals alone materially understate the replacement. Large test additions and test relocation also prevent raw line totals from proving runtime complexity.

Reopened maintainability acceptance: one working body representation persists across admitted substeps; conversion to public result/state has an explicit boundary; invariant preparation has one owner and a justified refresh lifetime; reports reuse preparation where semantics permit; the actual dungeon workload must fit the tick budget. These are review targets, not authorization to add a new abstraction for each concern. Explain and agree on the bounded structural direction before changing the solver again. Preserve the approved emergent contact behavior and accepted approximations; do not default to restoring HEAD merely because it is older.


## Whole-diff structural audit and corrective scope

### Scope and verdict

This is a bounded structural audit of the entire plan diff against committed HEAD, including untracked implementation/test files. It follows ownership and the ordinary call paths, not a line-by-line correctness certification of every fixture. Reviewed areas: core input/reconciliation/publication, world scene/direct/prediction entry points, contact stepping and queries, authored/observed motion, Explorer integration/delivery, client and Explorer cameras, frontend path consumers, compatibility documentation, and ancillary content/protocol changes. Existing suites establish only their documented behavior; the live performance gate fails.

**Verdict: the pair-response model is simpler, but the execution architecture has not earned a whole-system simplicity claim.** The new design removes sampled trajectory negotiation and re-solving held/truncated plans. It also repeatedly reconstructs state and geometry across internal boundaries where a single tick lifetime would suffice. Those are confirmed source findings, not an attribution of the measured 247 ms. No comparison to an abandoned recursive/group intermediate design counts as evidence against HEAD.

### Ordinary body trace and ownership findings

1. `core/client/simulation.rs::tick_with_precise_jump` admits duration before advancing authored playback and applying hooks. This keeps animation-derived physics and integration on the same time interval. The local-player adapter and remote projection adapter then create `PhysicalBodyInput`. **Retain** that source boundary and single authored advancement.
2. `spatial/scene/contact_collection.rs::advance_contact_entity_collection` refreshes residency, handles fixed placement, clones scene bodies, captures ordinary/reference input, and keeps a `CollectionActuator` map. It passes copied bodies to the contact collection. Fixed placement preceding character queries is required; a second generic placement engine is not.
3. `mobile_contact/step/collection.rs::advance_collection` clones those bodies again, sorts them, and loops over substeps. Each call to `advance_body_contacts` validates identities, reclassifies/prepares participants, rebuilds hard shapes, and creates fresh `WorkingBody` records. Updates then go through `apply_physical_state` into the copied `SpatialBody` array so the next step can reconstruct working state. **Change:** the substep driver should own persistent working state; public body records must not serve as an internal interchange format.
4. Each step applies ordinary actuation, hard sweeps, support/stair/edge policy, local pair correction, and final support. Pair rules are bounded and independent of convergence. However, each correction may invoke full hard-world traversal for both movement spheres; ordinary movement can also invoke slide, stair, settling, and an edge tangent retry. **Retain safety semantics, audit query cost.** These operations are not made cheap by limiting their iteration count.
5. `step/report.rs::collect_traversal_report_touches` separately prepares authored shapes for indexed bodies and rebuilds `DynamicShadowIndex` every substep. It needs substep-start peer poses and segment-specific reached domains; it does not need a separate owner for immutable shape definition and policy. **Consolidate preparation lifetime**, preserving report timing and directional semantics.
6. Collection aggregation remaps segment fractions, sums observations, and merges updates. Scene publication clones the original body again, reapplies the result, finishes reconciliation, derives sleep, and updates the scene index. **Keep one final publication boundary.** Replace the intermediate state/result round trip; retain output segments only for named consumers (reports, camera paths, accepted-motion/locomotion, and public query results).
7. Core forwards accepted state into canonical entities and body-observed locomotion. `motion/registry.rs::presentation_sequence` protects actions/transitions/explicit poses from locomotion selection. **Retain** the distinct authored and observed cursors: only authored playback supplies root movement/hooks. This is necessary behavior, not duplicate physics authority.

Direct and prediction solves already reach the same contact kernel. Preserve their immutable-peer and atomic missing-coverage contracts, but make them adapters around the same tick owner. Do not retain an alternate single-step API that forces production to serialize its internal state merely for direct tests.

### Findings and disposition

| ID | Source finding | Disposition and concrete acceptance |
| --- | --- | --- |
| A1 | Scene snapshots → collection snapshots → per-step working state → updates → snapshot mutation → reconstruction → final update application | One tick-owned working population persists across substeps. Full body conversion occurs at entry/final publication, not as the substep continuation mechanism. One immutable snapshot is acceptable where its original pose/reference has a named consumer. |
| A2 | Classification/shape placement is rebuilt inside each step; reports own another preparation path | Prepare immutable identity, definition, policy and eligibility once after input/hooks/reconfiguration. Keep current pose, membership and activity mutable. Reuse geometry preparation; refresh pose-dependent placements at their actual required instant. No cross-tick cache/revision system by default. |
| A3 | Lower public entry points repeatedly clamp time, validate identity, and recover optional physical state already guaranteed by private preparation | Validate external entry contracts once. Internal steps receive admitted duration and prepared facts. Remove repeated private recovery, while retaining checks for real external/state transitions and finite arithmetic results. Do not add a generic validated-wrapper hierarchy. |
| A4 | Simulation is roughly ten times the budget in the dungeon; aggregate timing does not separate query types | Attribute time and work to preparation, ordinary hard movement/support, correction, reports, and other simulation work before choosing query changes. Measure actual candidate/shape/BSP work for the expensive category. No claim that eliminating clones alone resolves the failure. |
| A5 | Launch/impact sets and update aggregation help reconstruct continuation across steps | When A1 lands, move one-shot consumption and projectile retirement into the working state that owns continuation; remove companion bookkeeping only where the same fact would otherwise be duplicated. Retain the needed impact publication event. |
| A6 | Source pose, root, placed spheres, ground and path history coexist | Each has a real potential consumer, but their update owner must be singular. Root/rotation own placement, checked traversal owns membership, support query owns ground, and accepted segments own observational history. No independent writable copy of the same fact without a named lifetime. |
| A7 | Support has a common footprint predicate, but navigation still contains bounded alternatives | Preserve the unified support definition, hard tops, tolerated overlap and support-removal concession. Do not replace the rule with per-ledge exceptions. Reuse proved query results where the pose/domain has not changed; a changed pose must not inherit unsupported proof. |

### Camera registration, advancement, and reset trace

Client registration (`ClientCameraService::start`) delegates to one controller and explicitly sets ordinary-input permission from world activation. Input arrival is separate from permission. Immutable collision/target publication feeds the camera worker; direct intent handles share the camera lock, not the world simulation lock. The worker advances and publishes under that lifecycle lock. Reset clears controller, input and permission; worker teardown signals, joins, and retires handles. **Retain** this separation: the live capture shows camera events continue while simulation is slow. Event counts do not prove rendered orbit quality or input-to-photon latency.

Explorer registration seeds a possession-owned camera with explicit lifetime and target input. `PublishedBoomTarget` represents usable versus failed input; `PublishedTargetPath` owns its endpoint invariant. Body publication updates the target, the camera worker advances independently, and a consumed path retains its endpoint. Stop/revocation and teardown retire the registration; delivery guards ordering with a short publication boundary. **Retain** separate client/Explorer lifecycle adapters; they have different owners and events. Do not invent a universal camera worker framework merely because their loops look similar.

Remaining camera risks are concrete acceptance checks: slow camera queries hold the camera's own lock; Explorer delivery can encounter sink backpressure; failure and reset must retire stale generations. These are not evidence of entity-solver contention. Verify production workers with stale commands, reset during activity, and actual live orbit once the body workload is fixed. No camera rewrite is part of A1–A5.

### Diff-wide keep/defer decisions

- Keep the deliberate contact concessions, hard/mobile type policy, support geometry, reference return and animation priority. They define the requested behavior.
- Keep the direct/collection kernel cutover and removal of trajectory negotiation. Do not restore the retired solver to avoid maintaining this one.
- Keep typed host/frontend path changes that consume final accepted body motion; remove adapters only if the revised tick output makes them redundant. Tests are consumers, not a reason to preserve an internal stepping API.
- Ancillary texture/protocol/catalog reader edits are small chunk-decoding/lint changes, not solver simplifications. Treat them separately in the eventual commit review; no further adjacent cleanup is warranted by this audit.
- No new tunable, scheduler, contact graph, global rollback, memoization layer, or broad generic solver framework is justified by these findings.

### Corrective phases and gates

**R0 — Attribute and analytically scope the real workload.** Before structural implementation, use one debug capture of the configured Olthoi dungeon with stage timings/work counts. Wait five seconds after entry and respect relog throttling. First identify which operations dominate and why their work repeats; inspect that code path before another run. Record the workload and evidence limits. This is targeted attribution, not another search through tuning constants. Stop if the dominant cost requires changing an accepted behavior or a major new collision mechanism.

**R1 — One tick owner, no internal publication cycle (A1/A3/A5).** Move substep advancement inside the lifetime of prepared working bodies. Keep source/reference facts explicitly separate from mutable actual state. Capture inputs once, consume launch/root/impact semantics correctly, and emit final results once. Delete the obsolete round-trip helpers/fields/callers in the same cutover. Direct/prediction adapters use that owner with their existing publication policy. Before editing, dry-run a sleeping character displaced on step one, launch followed by contact, projectile impact on step one, and unavailable coverage; all must continue without reconstructing a public body to recover state.

**R2 — Shared preparation and the measured query correction (A2/A4/A7).** Share immutable geometry/policy preparation between movement and reporting. Pose-dependent hard targets must still be visible at accepted obstacle poses; report targets retain the agreed substep-start semantics. Do not freeze all peers for a tick merely to share shapes. Address the dominant real query cost found in R0 with the smallest structural change that removes repeated work. If it requires expanding this scope, document the reason and obtain review before implementation.

**R3 — Structural and behavior acceptance before broad runs.** Trace the revised ordinary tick and prove each retained field has a consumer and each refresh a triggering change. Meaningful asset-free tests cover sleepers/wakeup, type/freeze changes, root scaling/one-shot consumption, reference replacement, action priority, hard support/navigation, report domains, and independent missing coverage. Existing browser movement and direct/prediction checks must still pass. Remove tests that only preserve deleted internal interfaces.

**R4 — Live acceptance and final audit.** Re-run the original debug Olthoi workload, verify simulation p95 below 30 ms with no sustained admitted-time collapse, then exercise pressure/reversal, return after server updates, and actual camera orbit. A synthetic pass cannot close this gate. Re-run affected tests/lints and review the complete tracked plus untracked diff. Account for added runtime mechanisms and deleted ones, not only line counts. Retire temporary production probes, update architecture docs, and keep the goal incomplete on any unverified requirement.

Audit-only checkpoint: no solver code was changed for this review. These phases supersede the prior recommendation to proceed directly from synthetic success to final acceptance. Implementation remains paused at the requested audit boundary; this checkpoint delivers findings and a revised execution scope.


## Problem-solving re-audit: contracts before mechanisms

Applied the explicitly requested `/home/me/.agents/skills/problem-solving/SKILL.md`. This pass changes the reasoning order of the preceding audit. Persistent working state is a plausible simplification supported by the repeated conversion trace; it is not by itself a solution to dungeon query cost. “Prepare once” is also underspecified: immutable definition facts, pose-dependent placements, and query results have different lifetimes. Establish those lifetimes before introducing a shared preparation abstraction.

### 1. Required contracts, independent of the current implementation

| Required behavior | What it does not require |
| --- | --- |
| Nearby eligible characters yield gradually, with the player receiving a smaller correction share; deeper overlap causes larger response | Literal mass, an explicit pushing state, completed global separation, or a particular number of passes |
| Separating or tangent input can escape contact; mob approach and player approach use the same rule | Guaranteed escape from an actually enclosed space or a crowd-wide capacity search |
| World and hard entities constrain accepted travel, including positional corrections; hard tops support characters | Hard entities being eternally stationary, exhaustive mobile-mobile sweeps, or a separate hard-entity navigation policy |
| Authority updates change reference without snapping a displaced mob through the player; return uses ordinary constrained motion | A second physical pose owner, a separate return collision solver, or automatic teleport to erase reference error |
| One canonical actual body state; consistent cell ownership, collision filtering and meaningful reports | Full public result construction after each internal numerical step |
| Authored root/hooks occur once; actions retain animation priority; visible locomotion reflects accepted movement | A generic priority framework, merged authored/observed cursors, or rendered animation becoming physical authority |
| Ordinary debug dungeon play responds at useful speed; camera servicing can continue during body work | Catch-up debt, fixed numerical parameters at any cost, or accepting chronic slow motion as normal overload |
| Unsupported physical hooks remain honest errors; attachments retain parent ownership | A generic hook interpreter or independent attachment yielding |

The current four substeps, four correction passes, three slide attempts, chosen support footprint and maximum admitted duration are implementations of those contracts. Some are explicitly agreed approximations and should be preserved during the first bounded cutover; they are not proof that the implementation meets the contract. Do not silently change them to make timing green.

### 2. Actual data and what remains unknown

Re-read `/tmp/olthoi-live-passive.json`: 66 observed actor records comprise one player, 58 mobs and seven other entities. There are **three setup identities total; all 58 Olthoi share setup 33557164**. These are publication records, not proof that all bodies integrate every tick or all are mutual collision candidates. They support reuse of immutable definitions; they do not support sharing transformed geometry or support results across different body poses. Existing content/geometry Arcs already share definitions, so another global geometry cache is not automatically useful.

The live drive capture measures mean simulation 247.426 ms, p95 394.705 ms and admitted/elapsed time 13.48%. It does not break down the cost. The retained 45-body fixture has different world geometry and query distribution. Even counting all possible pairs, increasing 45 bodies to 59 characters changes 990 pairs to 1,711, about 1.73 times; body count alone is not an explanation for a roughly tenfold cost difference. This arithmetic is a sanity check, not a claim that either scene processes all pairs or has identical per-pair cost.

The catalog census established template/setup preparation and the door classification distribution; it did not count the dungeon's selected colliders, polygons visited, report candidates, correction attempts, or support probes. Those are the missing workload facts. Stage timing must distinguish expensive queries from repeated preparation before we decide which layer needs the performance correction.

### 3. Accepted concessions must remove obligations

- Mobile-mobile coverage is nonexhaustive. Residual overlap, finite passes, order bias, fast crossings and delayed propagation are allowed. Do not recreate completeness through retry queues, swept peer trajectories, or pair revalidation until convergence.
- A blocked correction need not be redistributed; the next step can continue from partial progress. No neighbor-capacity search or global rollback.
- Mobile bodies need not stack; hard tops count as support. Do not build a general support graph or platform-carrying system.
- A stationary body may remain grounded after its support disappears. Therefore immediate entity-support requery is not a mandatory correctness property. In the current code it occurs even for sleepers. Consider removing that obligation for otherwise untouched sleepers through the existing activity boundary, rather than adding support invalidation machinery. Recheck when the body actually moves or resumes solving. This is a scoped candidate, not a claim that sleeping support queries dominate this dungeon.
- A bounded tangent attempt may hold at a rounded edge; do not add contour following. The shared support predicate still governs all navigation alternatives.
- Excess elapsed time may be discarded during exceptional overload. This is a stability concession, not acceptance of a routine scene running at 13% speed.

No existing concession grants permission to discard stationary trigger reports, mix disconnected EnvCells, change hard obstruction, ignore supported physics-property changes, or replay action hooks. Preserve those unless separately reviewed.

### 4. Neighborhood and correct ownership lifetime

| Layer/fact | Required lifetime and owner | Structural direction |
| --- | --- | --- |
| Decoded setup and authored shape definitions | Content/preparation owner, already shared by identity | Consume existing immutable definitions; no speculative cross-tick cache |
| Body type, supported physics, response/filter facts | Prepared after accepted input/hooks/reconfiguration; stable until an explicit in-tick consequence changes them | Resolve once per tick, with projectile impact an explicit transition; do not infer from scheduling |
| Actual root, rotation, velocity, ground, membership, activity | One working body persists through the tick | Mutate in place; avoid public-body/update reconstruction as continuation |
| Placed hard target shapes | Valid at a specific accepted obstacle pose | Refresh for actual placement changes, not every consumer; preserve obstacle-before-character ordering |
| Report peer geometry | Frozen at the agreed substep-start peer poses | Share definition/placement computation when poses match; do not reuse later accepted poses for earlier reports |
| Mobile broad phase and overlaps | Current contact-pass poses | Recompute/update as poses change; preparing once per tick would hide newly created contacts |
| World query coverage and selected geometry | Query region plus reached domains in an immutable collision snapshot | Existing world-query layer owns this. Reuse only with a concrete region/domain validity argument; avoid a second cache in the contact solver |
| Support result | Proved pose/domain/geometry, subject to the stationary-support concession | Reuse valid proof or query after motion; an unchanged owner revision alone is not proof at a changed pose |
| Reference and authored input | Captured once; independent reference evolves over admitted time | Keep alongside the working body, not in a second physical solver |
| Public body/path/report result | Final scene boundary; path observations may accumulate during steps | Accumulate only what named consumers need, publish once |
| Camera controller and permission | Camera lifecycle owner over latest immutable publication | Keep independent service and explicit reset; do not move body solving to a worker merely to conceal its cost |

The important simplification is **fewer independent owners and transformations**, not one enormous mutable struct or a shared abstraction covering every kind of query. Reusing a report placement is valid only when its pose and filtering semantics match. Mobile neighbor discovery remains intentionally pass-local.

### 5. Options assessed after constraints and data

1. **Retune caps or increase admitted time:** does not remove work or establish hard-query behavior for larger steps. Reject as the initial response.
2. **Restore HEAD:** may remove new bookkeeping but restores trajectory negotiation and loses requested emergent behavior. No default rollback; use HEAD as a structural comparison, not a target architecture.
3. **Persist tick state and consolidate valid preparation:** directly removes confirmed representation churn. Select as the maintainability direction, subject to the lifetime table above. Performance benefit is unproven and is not the sole acceptance criterion.
4. **Change world-query work at its owning layer:** potentially the primary performance fix if attribution shows dungeon traversal/geometry dominates. Keep this option open rather than forcing every fix into the contact collection. No new query cache, manifold, or geometry representation without evidence and a bounded validity contract.
5. **Exploit existing concessions:** remove immediate stationary support maintenance where it only guarantees behavior the user explicitly does not require. Evaluate as subtraction; do not grow a new sleep policy to save a query.

### 6. Revised next steps and explicit stopping gates

This refines R0–R4 above; it does not authorize a new broad rewrite.

- **R0: one discriminating workload capture.** Measure preparation, ordinary hard motion/support, correction, reports, and remaining simulation separately in the actual dungeon. For the dominant category, capture the work quantity that explains cost (selected shapes/polygons, actual casts, or body preparations). Establish that measured regions cover the aggregate time without double counting. Inspect the dominant code path. Another run is warranted only to resolve a specific missing fact or test a concrete change; avoid an open-ended evidence campaign.
- **Analytical gate before R1:** write the proposed tick trace using the lifetime table. Dry-run a moved hard obstacle, newly adjacent mobile pair, a sleeper corrected on step one, a root sample, projectile impact, authority replacement, and lost coverage. Identify which facts persist, mutate, refresh, and publish. Any solution requiring global agreement, per-step public-body reconstruction, or a new invalidation framework fails this gate.
- **R1/R2: bounded implementation scope chosen after R0.** Consolidate persistent state and shared preparation only at valid lifetimes. If the dominant cost is lower in world querying, include that bounded correction rather than claiming the representation change solves performance. Delete replaced conversions/maps/entry points alongside their callers. Stop for review if the required fix changes hard collision/navigation behavior or introduces a substantially different geometry algorithm.
- **R3: verify the contracts, not the scaffold.** Keep meaningful behavior tests and direct/prediction parity. Do not require tests to preserve immediate falling after support removal. Ensure shared preparation preserves distinct response/report policy and substep pose semantics.
- **R4: live and maintainability acceptance together.** The dungeon must meet the existing 30 ms p95 target with useful movement/turning, authority return, and camera orbit. The source must show one tick continuation owner, explicit preparation lifetimes and fewer state round trips. Neither a faster patch with extra mechanisms nor a cleaner implementation still taking 247 ms passes.

No runtime code changed in this re-audit. The previous claim that preparing everything once is the answer is replaced by explicit validity lifetimes and a measured choice of the layer that owns the expensive work.


### R0 live stage attribution — first discriminating capture

Debug drive capture `/tmp/r0-live-stages.json` completed successfully with explicit disconnect, the existing five-second settle and relog cooldown. Temporary source instrumentation is reproducible from `/tmp/instrument-contact-r0.py`; original files were restored after the capture. No solver policy or retained production logging changed. The on-disk debug binary is instrumented until rebuilt.

Across 105 simulation ticks and 419 substeps, total measured simulation time is 23,482.46 ms (mean 223.643 ms/tick). Nonoverlapping internal stage totals:

| Stage | Total ms | Share of total simulation |
| --- | ---: | ---: |
| Participant/working/hard preparation | 36.96 | 0.16% |
| Ordinary actuation, movement and support/stairs | 19,190.96 | 81.72% |
| Mobile pair response and checked corrections | 3,434.18 | 14.62% |
| Final airborne support refresh | 81.37 | 0.35% |
| Step output construction/projectile phase | 8.52 | 0.04% |
| Report preparation and traversal | 341.10 | 1.45% |
| Remaining simulation/collection work and instrumentation overhead | 389.37 | 1.66% |

Timings include temporary logging overhead and the broader ordinary stage includes input callbacks, initial support validity, angular advancement, and obstacle target refresh. This is attribution at stage granularity, not proof that a particular geometric primitive dominates. The result nevertheless rules out preparation/report construction as the main explanation for this capture's severe slowdown. Do not present the persistent-state refactor as a sufficient performance fix.

Next R0 step is specifically to split ordinary movement/support cost and count actual sweeps/selected polygons or other dominant query work. Source inspection identifies `advance_ordinary_motion` → slide/stair/settle/edge paths → `sweep_body_motion`/`support_candidates`; static sweeps traverse placement and select geometry, while settle first sweeps downward then queries support. Measure those real operations before choosing whether the correction belongs in navigation orchestration or the world query primitive. No broad rerun or tuning search is justified.


### R0 detailed movement capture — hard-world sweep multiplication

The next targeted debug drive capture `/tmp/r0-live-detail.json` completed successfully and disconnected explicitly. Instrumentation source is `/tmp/instrument-contact-r0-detail.py`; source originals were restored afterward. These are **inclusive nested timings**, not additive stages. Guard/bookkeeping overhead is included, especially for frequently called triangle/polygon operations; use the figures for attribution and work distribution, not a clean benchmark comparison.

| Operation | Calls | Inclusive total ms |
| --- | ---: | ---: |
| Contact substep | 406 | 23,226.308 |
| Ordinary movement | 18,902 | 18,550.473 |
| Body translation sweep | 59,002 | 22,254.025 |
| Static sphere trace (also includes angular traces) | 118,078 | 22,005.672 |
| Placed collider narrow phase | 262,520 | 11,278.819 |
| Polygon sweep | 1,648,739 | 9,109.201 |
| Triangle hit query | 1,450,830 | 8,544.542 |
| Settle after movement | 18,980 | 7,666.924 |
| Contact correction calls, including zero requests | 89,320 | 4,247.215 |
| Stair attempts | 7,230 | 701.116 |
| Support candidates, world and entities | 22,418 | 508.840 |
| World support selection | 22,418 | 484.700 |
| Current support refresh | 5,173 | 122.980 |
| Edge protection | 270 | 100.301 |

Concrete interpretation: nearly all contact-step time is inside checked body/sphere travel. The two-sphere body representation roughly doubles sphere traces. A typical substep averages about 46.6 ordinary movers, 145.3 body sweeps, 290.8 static traces, and 3,573.5 triangle queries. Counts are actual invocations, not necessarily expensive GJK casts: the triangle routine can return through directional or analytic face checks. No inference that every correction call casts or that every polygon produces the same triangle work is valid.

Source path: `advance_ordinary_candidate` sweeps travel and calls `settle_after_movement`; `settle_candidate` sweeps downward to establish reachable domains, then selects support and may sweep an upward adjustment. Corrections separately sweep accepted requests. `trace_static_sphere` computes topology traversal for each requested sphere path, selects world geometry, then performs collider/polygon/triangle tests. `update_triangle_hit` already has an analytic face case before generic shape casting. Thus replacing support selection or merely consolidating prepared entities does not address the dominant cost. Both per-query work and repeated query setup need scrutiny at the world-query boundary.

R0 has identified the dominant operation and real work counts. Do not start another broad timing sweep. Next analytical gate: trace which parts of one hard query establish topology, select candidate geometry, and test the actual requested segment; determine whether a bounded per-body query region can reuse candidate preparation for ordinary/settle/correction paths while preserving each segment's reached-domain proof. Any proposed reuse must include upper-sphere motion, optional stairs, bounded correction reach, and cross-cell motion, and must fail the gate if it requires a new general invalidation system. Also inspect the existing triangle primitive before proposing a replacement; aggregate triangle timing does not prove GJK alone dominates. These are candidate structural scopes, not a commitment to caching or a new collision algorithm.

Persistent working-state consolidation remains required for maintainability. The performance work belongs at the repeated hard-query boundary, with the exact corrective design still subject to this analytical gate. No physics policy, numerical limits, or collision behavior was changed in either R0 capture.


### Query-lifetime analytical checkpoint and snapshot-owned traversal bound

Re-read static selection and traversal before introducing query reuse. `StaticShadowIndex::selected_colliders` uses outdoor cells and the **actual reached EnvCells**; `sphere_polygon_candidates` then prunes BSP leaves for the actual query sphere. `transit_motion_path_internal` proves start/end placement and portal transitions for each segment. A shared geometric envelope may supply candidate shapes, but its reached-domain union cannot authorize all enclosed paths. Optional stairs and upper-sphere rotation also require their own checked segments. Therefore a tick-wide query cache is not approved by the current evidence; any later candidate reuse must keep per-segment topology and exact casts.

Found and corrected one unconditional repeated derivation at the proper owner: every movement waypoint counted all portals in all resident cell volumes to establish its cycle-safety transition limit. The count depends only on the immutable resident scene. `CollisionScene` now derives `motion_transition_limit` alongside its shadow index when staging a residency change, copies it for unchanged snapshots, and uses it in traversal. The zero-portal minimum remains one. This preserves the exact existing bound through insertion/removal/replacement and atomic snapshot construction; it introduces no mutable cache, new safety threshold, or speculative recovery rule.

Validation: 629 world library tests pass (`/tmp/contact-transition-owner-tests.log`), world library Clippy passes with warnings denied (`/tmp/contact-transition-owner-clippy.log`), workspace format and diff checks pass. Existing traversal, residency and cell-boundary tests exercise behavior; no test was added solely to assert storage of the derived count. No live speedup is claimed from this isolated correction and no benchmark rerun is warranted before the main structural work.

The measured cost is split between collider tests and the rest of static tracing; removing all candidate preparation alone cannot eliminate exact triangle work. Keep the persistent-working-state cutover and world-query analysis as separate obligations. The next cutover must reduce state transformations without embedding a broad query cache or assuming that small displacements make collision checks optional. Live timing acceptance remains failed until the corrected implementation is measured.


### Persistent-state cutover dry run — input and continuation contract

Traced `PhysicalBodyInput::step`/`return_step`, `predict_reference_motion`, `WorkingBody::into_update`, angular advancement, and final scene publication. The current substep callback accepts `&SpatialBody`, but its requirements differ: confirmation needs only the current pose; ordinary authored drive needs current rotation plus definition/response facts and acceleration; reference prediction needs independent reference/vectors and physical policy. This dependency must be narrowed before the substep source becomes an immutable tick-start snapshot. Passing that snapshot unchanged would steer from stale actual poses.

Started the cutover by changing `ContactStepActuation::with_confirmation` to accept `WorldPosition` directly. It cannot read incidental public-body state. The caller supplies the same current pose, so behavior is unchanged. An initial compile caught an incorrect type import; corrected to the existing common position type. No new representation or compatibility wrapper was added.

Required continuation cases for the complete cutover:

| Case | Persistent fact / transition |
| --- | --- |
| Sleeper displaced in substep one | Current root/membership and resulting activity persist; ordinary integration wakes next step without applying a public update record |
| Launch in substep one | Consume launch once; later actuation is continuation even if support is regained within the same tick |
| Projectile impact | Preserve impact event for publication, retire projectile behavior and sampled flight travel for subsequent steps; no repeated impact input |
| Root motion | Interval sample uses current actual rotation; reference sample uses reference rotation; neither consumes rendered locomotion |
| Authority replacement | Input preparation seeds independent reference before stepping; return error compares reference and current actual pose at the same interval |
| Moved hard obstacle | Accepted pose updates hard target geometry before characters query; does not grant yielding |
| New mobile neighbor | Recompute pass-local neighborhood from actual current poses, not tick-start geometry |
| Missing coverage | Keep the body's accepted prefix and unavailable-owner state through the remaining steps, without stopping unrelated bodies |

`WorkingBody::source` currently supplies both immutable definitions and what used to be the current substep pose/retained state. These roles must be separated in the cutover. In particular, angular observation must compare substep-start versus substep-end rotation, while final displacement compares tick-start versus tick-end root. The existing launch/impact sets and update aggregation are continuation machinery, not optional cosmetics; delete them only when their facts are owned by persistent state and consumed in the same order. Reporting still needs a substep-start pose view, not a rebuilt canonical body.

The R1 analytical gate now has concrete read/transition requirements. The full persistent population change remains unimplemented; narrowing confirmation alone does not close R1 or the live performance gate. The separate hard-query work remains required.


Reference prediction now accepts `&PhysicalBodyState` instead of `&SpatialBody`. Its only body-derived inputs were definition, response policy and missile classification; actual pose and retained actual velocity are no longer accessible through its parameter. The independent reference pose/vectors remain explicit. The scene input adapter validates physical presence, and four retained prediction scenarios consume the narrower contract. This is a preparatory R1 boundary change, not the persistent-population cutover. World library tests pass (629; `/tmp/contact-reference-boundary-tests.log`); formatting was applied. The ordinary actuation adapter still needs current rotation and acceleration, so replacing its source with a tick-start snapshot is still invalid.


The remaining actuation boundary now also separates physical configuration from current state. `PhysicalBodyActuation::contact_step_input` accepts prepared physics, current rotation/acceleration, proved ground, the interval root sample and duration. `PhysicalBodyInput::step`/`return_step` accept prepared physics plus current pose/acceleration/ground; they no longer require a public `SpatialBody`. The ordinary and return paths share those facts without recovering optional physics inside either primitive. Body-facing direct/collection adapters currently extract them; the persistent population will supply them directly. No new view type, retained state, fallback or compatibility wrapper was introduced. Updated actual callers and retained prediction/collection tests together.

Verification after the complete input-boundary change: 629 world tests pass (`/tmp/contact-input-boundary-tests.log`); world library warnings-denied Clippy passes (`/tmp/contact-input-boundary-clippy.log`); formatting and diff checks pass. This closes the identified substep-input dependency on reconstructed public body state. The production collection still reconstructs that state today: persistent working population, report preparation lifetime and hard-query performance are separate unfinished work. No speedup is claimed from this boundary change.


The projectile continuation check found a fixture coverage gap: `collection_impact_retires_entity_flight_and_does_not_capture_a_new_return` inherited a character contact response from its synthetic helper. Changed it to an explicit nonyielding obstacle, matching the item role relevant to this transition. The retained multi-substep impact and subsequent-tick assertions pass (`/tmp/contact-impact-role-gate.log`). This confirms the cutover must preserve more than velocity stopping: a projectile loses missile/path-clipped/align-path behavior and subsequently participates as an ordinary nonyielding obstacle. The persistent kernel must perform that local transition without reclassifying all peers or resurrecting the sampled authored travel. No runtime behavior changed in this fixture correction.


### Hard triangle query review: exact-result early termination

Inspected the installed Parry 0.30.2 source rather than assuming a specialized primitive exists. `query/default_query_dispatcher.rs` routes sphere/triangle casting through support-map casting; `shape_cast_support_map_support_map.rs` uses GJK directional distance and may compute penetration contacts. The apparent capsule-ray alternative in `query/ray/ray_support_map.rs` is also a support-map query, so substituting capsules is not automatically an analytic or cheaper solution. No replacement collision algorithm was introduced.

The existing earliest-hit reduction only replaces a hit when the new time is strictly smaller. Consequently, once time zero is found, later triangle tests cannot affect the result. Added an early return in `MovingSphereCast::update_triangle_hit` for that exact case. This avoids subsequent triangle construction/casts and preserves first-hit tie handling; topology traversal and query coverage still execute. It adds no tolerance, iteration budget, recovery policy or cache. Retained world tests pass (629; `/tmp/contact-zero-hit-tests.log`). This is an exact-result work subtraction, not a demonstrated solution to the live budget or a substitute for the persistent-state cutover. Its live benefit is unmeasured.


### Reporting preparation boundary narrowed

`DynamicShadowIndex::compile_prepared` now indexes already-admitted `(body ID, membership, anchor, placed shapes)` rather than accepting whole bodies and repeating `indexed_dynamic_body` classification. Its canonical-body adapter captures the admitted dynamic facts once. Its report adapter supplies the same previously prepared facts. Removed the unnecessary `Result` from the infallible indexing stage; geometry preparation remains fallible at its owner. Empty geometry still indexes nothing, and stable deduplicated ordering is unchanged.

This removes the full-body reference from `ReportTarget`: the existing map key supplies identity, dynamic facts supply policy/membership, and prepared shapes supply geometry. No new index, view type, participation policy or cache was added. This is necessary boundary work for the persistent population: reporting can now compile its index from current working membership without reconstructing a public body solely for indexing. Report mover-segment construction still consumes substep snapshots and must migrate with the stepping loop.

629 world tests pass after the indexing cutover (`/tmp/contact-index-boundary-tests.log`). The subsequent redundant report-body field removal is covered by all-target warnings-denied world Clippy (`/tmp/contact-index-boundary-clippy.log`). Formatting and diff checks pass. Persistent stepping and live performance acceptance remain incomplete.


Target placement now accepts prepared `DynamicBodyRuntimeState` plus explicit pose/anchor, rather than recovering dynamic physics from a whole `SpatialBody`. Existing dynamic-index, report, membership and solidification producers pass the dynamic facts they already hold. Raw body-facing sweep/ray adapters still validate presence at their boundary; persistent preparation must replace those repeated recoveries during the loop cutover. Scaled BSP-part and fallback-volume placement use the same implementation and retain their existing error behavior. No public-body placement wrapper was retained.

629 world tests pass (`/tmp/contact-target-boundary-tests.log`), including transformed/scaled target bounds and contact/solidification behavior. All-target world warnings-denied Clippy passes (`/tmp/contact-target-boundary-clippy.log`); formatting and diff checks pass. Actuation, reference prediction, target placement and prepared indexing can now operate without a reconstructed public body. Report mover extraction and the actual persistent stepping loop remain the next coupled cutover, not a completed R1 claim.


### Report mover processing no longer depends on public bodies

Introduced the private borrowed `ReportBody` input with only ID, substep-start pose, body-local movement spheres and frozen dynamic reporting facts. The existing collection adapter creates these views before applying substep results. Report target preparation and accepted-segment processing now consume the views instead of querying optional physics on `SpatialBody`. Mover processing matches the kernel's sorted updates; unchanged targets have no mover path, and movement-only bodies without dynamic reporting remain outside this view population.

Canonical indexing and report preparation share `dynamic_target_is_indexed`, preserving the single admission rule for suspended, suppressed, missile and ephemeral targets. No second reporting policy was invented. Per-segment reached domains and frozen substep-start peer geometry are unchanged. The borrowed view is temporary query input, not another retained body owner; its fields all have direct report consumers.

629 world tests pass (`/tmp/contact-report-view-tests.log`), including report lifecycle, directional behavior, initial overlap and disconnected-domain coverage. All-target warnings-denied Clippy passes (`/tmp/contact-report-view-clippy.log`); formatting and diff checks pass. The public-body dependency is now isolated at the collection's temporary view adapter, which the persistent-state cutover must replace rather than retain as another snapshot layer. Report aggregation still consumes the per-step accepted motion; emitting that observation does not require canonical body publication.


### Live recheck after exact work deletions — still fails

The debug drive capture `/tmp/contact-work-deletions-live.json` completed with explicit disconnect after the standard settling period and relog cooldown. It verifies the current code including snapshot-owned portal limits and time-zero triangle early termination. Temporary aggregate timing source and probe output fields were removed afterward; the debug binary remains instrumented until rebuilt.

134 ticks averaged **175.238 ms**, median **195.395 ms**, p95 **267.955 ms**, maximum **285.436 ms**. Admitted/elapsed time was **18.91%**. The character was `+Holtfighter`; 55 Olthoi were observed, versus 58 in the earlier capture. Forward travel was 3.221 m in five seconds; subsequent strafe phases still had zero displacement. Command acknowledgements remained approximately 0.94–1.34 ms. These varying live populations/poses do not support a controlled causal speedup claim, but the current implementation unequivocally remains far outside the 30 ms gate.

Do not declare the hard-query performance problem solved or continue accumulating small optimizations in place of the structural scope. The exact work deletions preserve useful ownership/earliest-hit properties, but R1 persistent continuation and the bounded world-query redesign remain outstanding. No additional aggregate timing run is justified until the next substantive change or a precisely identified missing fact. Final scene publication must still apply projectile consequences once; impact report classification is sampled before local retirement, as the current collection ordering shows.


## Accepted resteer: tentative crowd separation with one checked correction

**Direction accepted by the user; implementation and feasibility gates remain open.** The previous proposal to retain correction sweeps while merely reducing temporal substeps is superseded. Strong hard-scene consistency takes priority over mobile-mobile accuracy. The approved simplification removes hard queries from crowd relaxation passes; it does not remove hard sweeps.

### Contracts, data, and concessions

- Walls, terrain, and hard entity bodies remain checked obstacles. Character-only yielding classification remains unchanged; animated or root-moving hard bodies do not become yielding bodies.
- Ordinary navigation retains stairs, support, and existing protected-edge eligibility. Crowd correction must not defeat protected footing. Deliberate jumps and ordinary airborne movement remain valid; this is not a universal prohibition on falling.
- Mobile overlap, missed crossings, order dependence, and incomplete separation are accepted. If hard geometry prevents a tentative yield, do not rerun the crowd solver to compensate in the same tick. No guarantee of crowd escape or complete nonpenetration is introduced.
- Actual debug dungeon cost remains unacceptable: the latest run averaged roughly 175 ms, with 55 Olthoi. Earlier detailed attribution identified repeated hard-world sweeps as dominant; merely deleting snapshots does not establish sufficient performance.
- Reference and actual pose remain separate. Positional correction adds no retained velocity. Authored motion/hooks retain their owner; observed locomotion uses accepted travel and cannot hide actions. Camera lifetime and servicing remain independent.

### Proposed tick and ownership

1. Admit bounded time, consume input/reference/authored effects, and prepare the population once. Preserve the existing maximum admitted duration and dropped-catch-up policy unless the feasibility gate identifies a specific necessary change.
2. Advance ordinary movement through hard-scene navigation, establishing accepted poses and support. The intended structural target is one ordinary navigation advancement per admitted tick, not four complete navigation solves. Hard movement may still require bounded slide, stair, angular, and footing checks. Check gravity, motor, launch, and projectile discretization explicitly before cutover; crowd relaxation passes are not elapsed-time integration steps.
3. Seed tentative mobile positions from those accepted poses. Run the finite mobility-weighted overlap passes with no world queries, hard sweeps, support probes, or public-body reconstruction. Accumulate bounded net correction separately from ordinary travel. Tentative peer positions may overestimate eventual yielding.
4. For each body, check the combined correction from its accepted ordinary pose against hard geometry. Accept a safe prefix. For a body with protected footing, require valid final footing; initially reject the correction if that requirement fails, rather than adding correction-specific stairs or edge-slide retries. Any vertical footing adjustment must itself be checked. Preserve the ordinary accepted state when rejecting a correction.
5. Publish accepted poses, paths, support, reports, and motion observations once. Never publish tentative paths or use them as report traversal. Do not feed hard-clipped corrections back into another crowd solve this tick.

“One correction check” is one transaction per body, not a promise of one primitive cast: both movement spheres and any necessary footing adjustment still need protection. Final hard-target poses must have an explicit snapshot lifetime; moved hard obstacles cannot be read at an accidental mixture of old and new poses. Reuse existing hard-query and footing primitives rather than inventing a second local collision engine.

### First gate: analytical feasibility before implementation

Read `spatial/mobile_contact/step.rs` (`advance_body_contacts`, `advance_ordinary_motion`, `apply_correction`), `step/stairs.rs`, `step/collection.rs`, and `scene/contact_collection.rs`. Trace current direct/prediction producers and reference/launch/report consumers. Use the existing support geometry and documented retail references; this gate is source analysis, not a prolonged fixture or live campaign.

- [x] Wall/corner: tentative bodies yield through a wall; combined corrections stop at hard geometry, residual overlaps remain, and no corrective feedback round occurs.
- [x] Ledge/slope/hard entity top: accepted ordinary footing survives a rejected correction; accepted correction has coherent final support. Distinguish protected grounded bodies from airborne bodies. A wall sweep alone does not satisfy this case.
- [x] Landing/stairs: ordinary navigation remains valid at the admitted tick interval. No assumed equivalence between four integrations and one integration. Later shared-navigation steering permits the same bounded stair route in ordinary and corrective navigation; both are covered.
- [x] Dense crowd: all passes remain finite, net correction obeys a named budget, and clipping one body's correction does not trigger another body solve. Define the budget per admitted tick explicitly; do not accidentally multiply or divide response strength by deleting substeps.
- [x] Velocity: closing-normal response uses one coherent rule; rejected displacement creates no artificial velocity. Hard clipping leaves no retained velocity into a blocking plane. Do not infer velocity from tentative or corrected displacement.
- [x] Lifecycle: launch/root effects occur once; projectile impact retires flight correctly; sleepers can receive correction; authoritative updates change the reference without snapping actual crowd-displaced poses.
- [x] Coverage/reporting: only accepted traversal establishes ownership and reports. Missing coverage holds the affected movement under existing policy; no unchecked tentative pose crosses a cell boundary.

Gate passes only if these cases fit the existing hard-navigation primitives plus a bounded final correction transaction. Record concrete findings and any required numerical decisions before editing runtime code. Stop and explain if preserving hard-scene consistency requires a new geometry solver, recursive retries, or case-specific correction navigation policies.

### Implementation, acceptance, and cleanup

- [x] After the analytical gate, cut over the common collection/direct/prediction kernel. Delete the per-pass hard-correction sweep path, obsolete internal temporal round trips, intermediate publication, and superseded launch/impact aggregation machinery where the new tick makes them unnecessary. Do not build the previously proposed persistent-substep framework first.
- [x] Keep one accepted body state and a minimal, private tentative correction representation. Preparation owns invariant facts; consumers do not rediscover eligibility or reconstruct public bodies. No selectable legacy solver mode, global cache, or new invalidation framework.
- [x] Run focused asset-free conformance checks for hard walls, protected ledges, slopes, stairs, hard tops, launch, projectile retirement, reference return, and accepted-only reporting. Adapt tests to runtime constants and behavior; do not retain assertions that enshrine old substep counts. Run affected crate tests, formatting, and warnings-denied Clippy.
- [x] Audit the whole diff for a visibly simpler tick trace and remove dead symbols, adapters, metrics, and active documentation terminology. Retain historical evidence as history. Document the residual-overlap concession beside the final correction commit, where a future maintainer might otherwise add a feedback solve.
- [x] Only after the structural cutover and conformance gate, repeat the authorized debug dungeon scenario with settling time and relog cooldown. Require useful player/mob movement and the existing live timing target; source-level boundedness alone does not close acceptance. Recheck camera responsiveness and accepted-pose animation behavior. **Closure:** Historical gate superseded by later scoped performance and live acceptance; no new identical-workload dungeon benchmark is claimed.

The accepted tradeoff is softer, approximate crowd interaction, including discrepancies between tentative yielding and accepted movement. It is not relaxed wall, topology, or protected-footing safety. No speedup factor is promised; hard navigation may remain expensive and must earn live acceptance after this substantive subtraction.

### Accepted-direction source audit: correction transaction and numerical cutover

The previous goal turn made progress by replacing the execution scope. This checkpoint inspected the actual kernel, collection, input/reference adapter, and footing implementation; no runtime change or live acceptance is claimed.

**Structural verdict: the proposed transaction fits existing primitives.** `advance_body_contacts` currently invokes `apply_correction` inside every contact pass. Ordinary stair/edge navigation is outside that loop already. Therefore the subtraction is specifically the repeated correction sweeps plus the outer temporal repetition, not removal of a nonexistent per-contact stair solver.

Concrete implementation findings:

- `ProtectedFooting::capture` identifies exactly the existing protected population (Creature edge policy and walkable support). Its saved cursor/root/ground/path boundary can restore a rejected correction. Reuse that eligibility; do not make every airborne body or every grounded policy edge-protected.
- `support_at` only confirms height within `CONTACT_EPSILON`. Using it alone after lateral correction would reject downhill movement that needs vertical settling. Reuse `settle_candidate` through a narrow correction transaction: one checked settle, no stair or tangent retry. For protected bodies, unsupported or unavailable optional footing rejects the correction and restores the ordinary accepted pose, membership, support, and path boundary. Unsupported unprotected bodies may remain airborne. No speculative report or impact survives rejection.
- The current correction path sets ground to Airborne before its final support query. Do not copy that ordering blindly: correction settling needs the ordinary pose's walking eligibility and configuration. Keep that prior state until the transaction decides its final result.
- Tentative relaxation needs only sphere positions, velocity response, and a bounded correction allowance. It must not mutate accepted root, membership, support, paths, or report state. Reuse the existing pair predicate and sweep-and-prune ordering. Membership filters stay at accepted ordinary placements; missing a newly adjacent pair across domains is within the nonexhaustive mobile concession. Tentative coordinates never prove residency.
- Hard movers already run before yielding characters and refresh their placed targets. All crowd correction commits must use the resulting frozen hard-target population. Fixed authored placements already precede collection snapshots. Do not introduce hard-body advancement inside tentative passes.
- `PhysicalBodyInput::step` and `return_step` consume an explicit sampled interval. A full admitted interval consumes authored translation and reference advancement once; removing the temporal loop removes the need for its launch/impact identity sets and weighted motion aggregation. Projectile reports must still read the original missile policy before final publication retires it. Sleeping bodies receive geometric correction now and wake for ordinary input on the next producer tick.
- Motor integration is bounded by acceleration times duration; gravity is applied once before swept travel. One longer integration changes numerical trajectories, but does not remove hard path checks. Existing launch, slope, landing, stair, angular and prediction behavior tests remain a mandatory conformance gate after cutover. Do not claim mathematical equivalence with the previous four integrations.

Initial numerical choice for the scoped implementation: retain four relaxation passes and the existing 0.25-minimum-radius cumulative correction allowance, now once per admitted tick. Retain the existing maximum admitted duration (1/30 second). This deliberately lowers maximum separation travel per second relative to four old substeps; do not multiply the allowance to manufacture equivalence. Sum the lengths of tentative per-pass adjustments against that allowance, so their final vector is bounded even when directions reverse. This is the accepted softer-crowd concession; response tuning remains explicit if live movement proves inadequate.

Closing-normal velocity cancellation remains independent of displacement acceptance: it is dissipative mobile response, not momentum inferred from a speculative path. The final checked correction additionally removes velocity into a blocking hard plane. A rejected footing correction cannot restore stale pre-contact velocity or publish a speculative landing impulse; compute/commit the footing result transactionally.

Next implementation boundary: replace the common collection's temporal orchestration and the contact loop together, migrate active substep vocabulary/diagnostic consumers, then run focused hard-scene and lifecycle conformance before any live timing run. No new solver mode or persistent-substep framework is justified. The analytical review identifies no need for a different geometry engine; execution must still stop if existing checked settling cannot satisfy the transaction without new edge-specific retries.

### Cutover checkpoint: implemented loop, conformance blocked on support response

Runtime cutover is in progress, not accepted. The collection now advances one admitted interval and no longer applies intermediate public-body updates, carries launch/impact sets, or combines fraction-remapped results. `MOBILE_CONTACT_TICK_SECONDS` owns the unchanged 1/30-second admission ceiling. Four tentative contact passes operate on private sphere/velocity copies and cumulative travel budgets; final corrections are hard-swept once per body. `correction_footing` uses checked settling without mutating the accepted body, and rejects unsupported protected candidates before publishing paths. Remaining overlap is deliberately not fed back into the contact solver.

First full world test run: 621 passed, seven failed. After migrating obsolete exhaustive-compression assertions and correcting a stair fixture's elapsed-time horizon, 623 passed and five failed (`/tmp/crowd-cutover-tests-current.log`). The ledge fixture initially described a drop within the configured step-down allowance and incorrectly demanded zero movement; it has been corrected to place the ledge above that allowance. Its focused result is recorded separately in `/tmp/crowd-cutover-ledge.log`. The ordinary motor observation differs from its boundary expectation by approximately 0.000112 m/s, consistent with world-coordinate subtraction precision; this still needs an appropriate geometry-derived assertion rather than widening an arbitrary tolerance.

**Major policy gate reopened; pause before further numerical fixes.** The released-slope case ends airborne and accelerating instead of at rest, and supported sledding stops horizontally instead of preserving friction-decayed travel. `ordinary_impact_velocity` suppresses rebounds only when `rebound * delta_seconds <= CONTACT_EPSILON`. With gravity 9.8, elasticity 0.05 and a resting normal, one gravity step produces prospective rebound travel `0.05 * 9.8 * dt²`: approximately 0.000034 m at 1/120 second, but 0.000544 m at 1/30 second, above the 0.0002 m query tolerance. The coarser interval therefore changes whether a gravity-created contact remains supported. Sledding deliberately takes the restitution branch even with prior support; the edge-protection path can then reject its unsupported candidate and zero velocity. The slope failure is verified, but its entire repeated-tick trajectory has not yet been attributed with a trace. Do not label both failures fully diagnosed from the threshold calculation alone.

Recommended policy direction for review: distinguish sustained supporting contact from a new impact. Sustained support should cancel acceleration/velocity into its surface while preserving permitted tangential gravity and friction; restitution should apply to actual incoming impacts, not repeatedly bounce the body's own standing gravity. This would make support independent of whether a timestep happens to put the rebound below query resolution. It changes the existing sledding/support response contract and must be reviewed against airborne landing and authored restitution before implementation. Do not patch the failure by increasing the rebound tolerance or restoring the four complete hard-navigation solves.

The stair-with-mob case also remains blocked at the first step under the new approximate crowd response; the no-mob case now passes after preserving the original simulated duration. This is distinct from the gravity/rebound issue. Residual crowd overlap is accepted, but useful crowd navigation still needs conformance and live acceptance; do not dismiss the failure or claim the entire cutover is viable from the passing no-mob case.

Cleanup still due after the policy gate: remove the now-constant substep diagnostic through public/host/UI consumers; remove redundant full-interval fields and authored interval slicing where no remaining consumer needs them; fix misleading continuation comments; remove the collection's extra snapshot copy if sorting can use its prepared stable ordering. These are explicitly unfinished cutover work, not a completed maintainability pass. No new live run, broad Clippy acceptance, staging, or commit has occurred. Source compiles and formatting has run, but the test suite is not green. This is the first turn stopped on this newly discovered support-policy decision.

### Paused policy review: stair occupant is pinned by the next riser

The previous goal turn made implementation and verification progress. The support-policy decision is still pending; this turn performed only an independent stair check and improved its failure context.

Focused reproduction (`/tmp/crowd-stair-review.log`, terminal failure) ends with the occupant at `(91.05535, 96, 0.305)`, zero velocity, and the player at `(90.30823, 96, 0.305)`. The next riser begins at x=91.5 and rises from 0.3 to 0.6. The occupant has no drive input. Its forward positional correction is checked as direct travel; only ordinary navigation may choose a stair maneuver. Thus the test's demand that contact push the stationary occupant up the next step exceeds the agreed correction transaction. The result is consistent with the accepted hard-pinned/mobile-overlap concession, rather than evidence that unoccupied stairs fail. Do not add stairs to correction or manufacture retained velocity from displacement to satisfy it. This source/endpoint review does not prove every intermediate contact or general crowded-stair usability.

Before final test cleanup, replace the conflated expectation with separate ordinary stair navigation and hard-pinned crowd behavior checks; preserve the ordinary staircase geometry and useful safety assertions. The actual live dungeon still must demonstrate useful movement. The proposed sustained-support versus new-impact policy remains unimplemented and awaiting user review. No further numerical changes were made. This is the second consecutive goal turn encountering that same pending decision; independent evidence was available, so the goal has not been marked blocked.

### Shared hard-scene movement and support-confirmation shortcut

User approval: unify the sweep/navigation operation and reduce redundant hard queries. This supersedes the prior stair-pinning concession as a required restriction: corrective navigation may now climb stairs and attempt the existing bounded edge tangent, outside the mobile passes. Hard-scene safety, finite work, and residual mobile overlap remain requirements. The support/restitution proposal was not explicitly resolved by this steering; keep that gate visible instead of silently increasing a bounce tolerance.

Implemented `advance_hard_motion` and a private `HardMovement` enum. Timed movement reads already-integrated velocity; correction reads its combined displacement. Both use the same slide/stair/settle/edge pipeline. Only impact response and motion provenance differ: correction clips inward velocity without restitution and publishes geometric adjustments at the tick endpoint. It never reintegrates forces, resamples animation, or derives retained velocity from displacement. The specialized `correction_footing` implementation was deleted. No correction navigation runs inside relaxation passes and there is no feedback crowd round after hard clipping.

The shared settle now confirms the final footprint at the current height first for previously walking bodies. Successful confirmation reuses that support and skips downward placement sweeps. It still queries the final footprint; no infinite-plane cache or stale membership proof is introduced. If support needs a height change, the existing checked downward/upward settling remains. Optional unavailable coverage retains existing unsupported/edge-rejection behavior. This is a structural query deletion for level supported travel, not a measured speedup claim. Stair eligibility already excludes walkable blocking normals before performing stair geometry queries; a separate eligibility abstraction was not added.

The crowd allowance bounds tentative separation travel, not the height of navigation assistance. A small correction that reaches a riser can invoke a larger lift bounded by the existing stair configuration. Consequently smaller corrections do not guarantee cheap queries or proportionally small vertical movement. Their cost remains bounded by the same slide/stair/edge limits as ordinary navigation.

Verification checkpoint: the first unified run passed 624 world tests and failed four (`/tmp/unified-hard-tests.log`). Protected ledges passed. The staircase occupant now reaches the upper level (z approximately 0.605, x approximately 97.98), demonstrating that correction can invoke stair assistance; the player still fails the full stair progress expectation, so this does not close navigation acceptance. Released slope and sledding failures persist. The motor observation assertion compared rounded world-coordinate speed to an exact lower bound; it now compares displacement error against the runtime collision tolerance. A focused correction-driven stair fixture was added to verify that climbing does not create timed travel or retained velocity; final results are in `/tmp/unified-hard-tests-final.log`.

World all-target Clippy passed with warnings denied after the shared-operation implementation (`/tmp/unified-hard-clippy.log`); rerun after the new fixture/final cleanup. Formatting and diff checks remain required. No live capture is justified until conformance passes. Existing substep diagnostic/interval cleanup remains outstanding, as does the support-versus-impact policy gate. Source-level simplification and successful corrective stair entry do not constitute completion of the overall plan.

Final checkpoint for shared movement: 626 world tests pass, three fail (`/tmp/unified-hard-tests-final.log`). The new correction-driven stair fixture passes, including zero retained velocity and no timed travel. Remaining failures are released slope settling, supported sledding, and complete player progress through the occupied staircase. All-target world Clippy passes with warnings denied after final edits (`/tmp/unified-hard-clippy-final.log`); formatting and `git diff --check` pass. No performance improvement has yet been measured. This resumed work delivered the newly authorized shared-navigation change; the separate support/restitution decision remains pending rather than implicitly approved.

### Independent remaining-stair diagnosis while support policy is pending

The resumed shared-navigation turn made implementation progress. This turn rechecked the remaining occupied-stair failure without changing numerical response or collision policy. The focused test now includes player support/velocity in its failure context; temporary per-tick logging was removed after capture.

`/tmp/unified-stair-state.log` shows the player stopped at `(91.499214, 96, 0.60499585)`, with zero velocity and proved horizontal support on an overhanging footprint at the upper tread. The mob is far ahead at x approximately 97.98. `/tmp/unified-stair-path.log` records repeated zero-displacement ticks containing only a time-zero World impact with normal `(-1, 0, 0)`. The lower sphere center is z=1.0799959, radius 0.48: its bottom is roughly four micrometres below the 0.6 tread, comfortably inside the 0.0002 support confirmation tolerance. This stall is therefore an immediate riser-edge hard contact after support admission, not continued obstruction by the mob.

Source finding: `collision/static_sphere_sweep.rs::MovingSphereCast::update_triangle_hit` uses the authored polygon normal both for its exact finite-face hit and for the generic triangle cast used at edges/vertices/initial overlap. The latter discards the cast's contact normal. Thus an edge contact can be reported as the riser's fully horizontal normal. The generic non-triangle shape path already uses the target's cast normal. This is a concrete inconsistency to review before adding navigation retries or positional nudges. A corrected normal may improve edge response, but that alone has not been tested or proved to resolve shallow initial penetration.

Recommended next analytical check: distinguish exact face hits from edge/vertex hits, and define how support-admitted shallow contact interacts with hard movement without allowing wall traversal. Preserve one-sided polygon policy and real penetration protection. Inspect the existing retail/source-backed geometry contract before changing normal selection; do not silently turn this finding into a new collision algorithm or increase tolerances. This geometric issue and the previously identified sustained-support/restitution issue are separate. Both remain open, with no new live run or overall acceptance claim.

### Support and finite-feature response cutover

User approval: implement sustained supporting contact and finite-feature hard response while preserving real launch/landing behavior and wall protection. The prior policy pause is resolved; this is not approval for unrelated tuning or another solver mode.

Implemented:

- Supported velocity integration projects out inward normal motion after forces. A launch explicitly uses Airborne before this constraint, so it retains its upward impulse. Tangential gravity and friction remain available to sledding/sliding.
- A checked walking settle projects velocity onto its accepted support plane, including the small upward component generated by sliding around a riser edge. Previously that component made valid walking support look airborne and caused the edge guard to reject progress. Incoming airborne impacts retain their authored response.
- Negligible grounded rebounds are classified by ballistic height `v_normal² / (2 * inward_acceleration)` against the existing collision distance tolerance, replacing `v_normal * tick_duration`. No new numeric tolerance was introduced. Free-flight impacts with no inward grounded acceleration do not take this grounded settling rule. A focused test covers suppression below the height boundary and preservation above it, including unchanged tangential velocity.
- Triangle face hits keep the authored face normal. Generic finite-feature hits derive their direction from the sphere center and closest triangle point at the cast time; face containment still selects the exact face normal. Queries use a sphere-relative frame. One-sided polygon admission remains based on the authored normal, and only approaching contact directions block. No wall bypass, sphere shrink, extra stair retry, or penetration-ignore threshold was added.
- Retail references were inspected: `acclient.c:346190-346215` selects the polygon plane normal for BSP response; `309962-310051` uses contact history/stationary-fall frames and authored restitution. Source markers record the deliberate departures and limit the census claim to the synthetic conformance population, not all installed meshes.

Experimental findings retained as evidence, not mechanisms: directly using the cast normal did not fix the riser and introduced small vertical responses. Closest-feature normals alone also did not fix it. The missing walking-settle projection was necessary. The previous corner test used free-flight spheres driven as if they were walking characters; a temporary trace showed they could rise substantially because they had no support constraint. The fixture now uses grounded single-sphere bodies and checks both hard walls and floor height throughout crowd entry/escape. Separate free-flight/impact tests remain. Temporary trace output was removed; no exact-zero assertion was merely loosened to hide that rise.

Verification: all 630 world library tests pass (`/tmp/support-final-world.log`), including occupied stairs, corrected stair travel without velocity generation, slopes, sledding, edge protection, thin/hard obstacles, landing, launches, and the new rebound-height check. All 276 host library tests pass (`/tmp/support-core-host-final.log`). The host jump-presentation test now allows the landing tick to have no supported travel and verifies walking resumes from subsequent supported movement without another input, consistent with observed locomotion ownership and one tick integration.

One core failure remains: 354 pass, and `high_skill_flat_targets_remain_reachable_through_the_capability_envelope` fails at 45 m after all six candidates miss first landing (`/tmp/support-core-host-final.log`). `precise_jump.rs` generates continuous ballistic candidates while `precise_jump_prediction.rs` checks the admitted discrete movement kernel at 30 ms. The larger integration interval is a plausible source of the mismatch; the failure is proven, but its exact candidate miss has not yet been traced. Do not widen target acceptance or reduce the tested capability range to make it green. Bring candidate prediction into agreement with actual admitted movement while preserving capability and launch contracts, then repeat the focused envelope check.

World/core/host all-target Clippy passes with warnings denied (`/tmp/support-cross-clippy.log`); formatting and `git diff --check` pass. No live run has occurred: conformance and obsolete temporal-contract cleanup remain before overall acceptance. The support/edge work no longer needs a user policy decision. Continue investigation of the remaining predictive mismatch within the authorized plan, and stop only if it requires a new consequential contract choice.

### Precise-jump candidates match admitted integration

The previous goal turn delivered support/edge implementation and verification. This turn established the remaining core failure and corrected the inverse candidate model; no launch capability or landing tolerance was increased.

Evidence: `/tmp/jump-discrete-trace.log` records all six candidates for the 45 m flat target. The maximum-planar-speed candidate uses 18 m/s and a continuous flight duration of 2.5 s, but first contact is 0.54137 m short. This matches approximately `18 * 0.03 = 0.54 m`: same-height semi-implicit flight lasts roughly one integration interval less than the continuous candidate. Other misses range about 0.4804–0.5565 m against the unchanged 0.48 m tolerance. Temporary candidate logging was removed after capture.

`generate_precise_jump_candidates` now takes the validating integration interval explicitly. For constant gravity magnitude g and tick h, semi-implicit samples satisfy `z(nh) = (v_z - gh/2)t - gt²/2`. Candidate arrival time and minimum charge use that curve coefficient while retaining the capability-resolved actual launch velocity. The display curve uses the same adjusted coefficient; it matches free-flight sample positions at tick boundaries, not every point of the solver's linear swept chord. Collision validation still selects first actual impact and checks target identity, placement and the original tolerance.

At the capability boundary, exact target-center reach can exceed maximum charge while the existing accepted landing neighborhood remains reachable. Candidate generation now tries the legal maximum charge and clamps planar speed only if its predicted shortfall is within that unchanged neighborhood. Impossible vertical reach or excessive shortfall still yields no candidate. This replaces premature exact-point rejection; it adds no candidate budget, no permissive collision result, and no physics speed increase. Exact-center candidates remain preferred whenever legal. Benchmark and test callers supply the interval explicitly; the public render curve's velocity accessor is documented as a curve coefficient, distinct from actual release velocity.

Verification: all 355 core library tests pass (`/tmp/jump-discrete-final-tests.log`), including the unchanged half-metre sweep through 50.5 m, elevated/lower target candidates, solid-entity landing/obstruction, first-landing rejection, and collision-backed source-state isolation. Intermediate failures at the farthest target and the elevated entity established why existing landing-neighborhood acceptance must also be used during inverse generation; these were resolved without deleting those tests or reducing their range. Prior world 630 and host 276 results remain applicable because this checkpoint changed candidate generation/presentation, not the physics kernel. All-target core/host/debug-harness Clippy passes with warnings denied (`/tmp/jump-discrete-clippy.log`); formatting and `git diff --check` pass.

Remaining work: delete obsolete internal-substep diagnostics and normalized interval machinery, inspect direct/prediction/collection publication after that deletion, then collect live debug dungeon timing and movement evidence. The full plan is not complete and no new live-performance claim is made. There is no pending user decision from this checkpoint.

### One-tick contract cleanup and debug acceptance capture

The prior goal turn fixed and verified inverse jump generation. This checkpoint removes mechanisms made obsolete by the one-tick contact model:

- Deleted `ContactTickInterval`, its constant normalized endpoints, and `PhysicalReferenceInput::interval`. Contact callbacks now receive admitted seconds directly. Actual authored sequence sampling still uses its private transform-interval helper; that independent behavior was retained and its unnecessary re-export removed.
- Deleted the constant contact substep count from collection results, `PhysicalBodyMotion`, physical-fly host publication, TypeScript contracts, status projection, UI text and affected fixtures. The separate raw free-sphere/camera solver still has meaningful substep budgets and diagnostics; those were not renamed or deleted.
- Removed the collection's full-body clone/sort. It borrows the scene-prepared input; the kernel owns stable result ordering. Hard report policy lookups now use the same direct body lookup style as mover reports rather than requiring sorted cloned inputs. This avoids another index/cache and is appropriate to the measured roughly 66-body collection; hard-report lookup cost was not a dominant stage.
- Corrected stale continuation/sampling comments. Scene-owned preparation and final publication remain transactional; no intermediate public-body application was reintroduced.

Verification: world 630, core 355, host 276 library tests pass (`/tmp/contact-contract-cleanup-tests.log`), followed by world 630 again after the borrowed-input change (`/tmp/contact-borrowed-tests.log`). The two affected physical-fly frontend test files pass all 23 tests. Full app type checks pass with zero Svelte errors/warnings (`/tmp/contact-contract-ts-check.log`). All-target world/core/host/debug-harness Clippy passes with warnings denied (`/tmp/contact-contract-clippy.log`); Rust and touched frontend formatting ran. The initial mechanical field deletion also removed two unrelated raw-solver fixture budgets; compilation caught this, and those `maximum_substeps: 8` entries were restored before the successful suites.

A new debug host was built (`/tmp/contact-live-debug-build.log`). The authorized existing dungeon drive probe is running with five-second entry settling and this worktree's credentials, capturing `/tmp/contact-shared-navigation-live.json`. Temporary stderr timing surrounds the same simulation operation as previous aggregate measurements and includes elapsed wall time. The source instrumentation has already been removed with an exact comparison against its fresh pre-capture copy; the running binary remains instrumented for this capture. Await its terminal result before claiming login, workload, motion or performance acceptance, and rebuild the normal debug binary afterwards. No second login is authorized by elapsed time alone; preserve the server relog cooldown if a retry is required.

### Shared-navigation live debug results

Both authorized debug probes logged in, waited five seconds after entry, and exited with process code 0 after cleanup. The character remained the configured dungeon character. No release build or TUI was used.

First capture: `/tmp/contact-shared-navigation-live.json`. It observed 54 named Olthoi among 62 actor records, up to 864 published samples for a mob, and maximum recorded mob travel about 42.09 m. Forward and strafe phases did not move the player; forward-and-turn moved approximately 1.25 m. This does not establish uniformly responsive movement. The probe discarded collected host stderr on its success path, so the temporary simulation timing was not retained. This capture mistake was identified explicitly; no timing result is inferred from camera or publication counts.

A second capture was run only after more than 60 seconds since the first completed output, temporarily retaining numeric `CONTACT_TICK` samples from stderr. `/tmp/contact-shared-navigation-timing-live.json` contains 499 samples: mean 29.314 ms, median 32.645 ms, p95 46.194 ms, maximum 52.183 ms. Admitted simulation time divided by elapsed wall time is approximately 88.74%. The run observed 70 Olthoi among 83 actor records, with up to 607 mob samples and maximum mob travel approximately 47.31 m. These are entities observed over the capture, not a proof that every entity was active or colliding simultaneously.

The previous debug capture averaged about 175.24 ms with 55 observed Olthoi. The new result is a substantial observed improvement, but different live positions/populations prevent a controlled speedup claim. It still misses the p95 <30 ms acceptance target. No new lower-level optimization is justified solely by labeling the new mean “good enough.”

Second-run movement: forward 3.354 m over five seconds; strafe-left 1.588 m over 1.25 seconds; forward-and-strafe-right 1.752 m over 1.25 seconds. Forward-and-turn moved 0.167 m, so crowd/geometry context still matters. Command acknowledgements were about 0.56–0.92 ms, which is not input-to-application latency. The camera published 1118 events; this is not rendered orbit smoothness evidence.

The second capture reports `driveError: jump release was rejected: unsupported`; its jump result is absent. Player contacts observed over the run include grounded, airborne, sliding and unknown. This is not enough to attribute the rejection to solver error or legitimate unsupported placement. Retain it as an open functional acceptance issue; inspect the support/charge state at the rejection before changing jump admission or asking for another location. Do not call a probe fully successful merely because its top-level `ok` and process exit are successful.

Temporary runtime timing and numeric stderr retention were removed by exact comparison to fresh pre-capture copies. The normal debug host rebuild completed successfully (`/tmp/contact-normal-debug-build.log`), so subsequent normal runs do not retain the timing instrumentation. Source changes are confined to the authorized solver/contract cleanup and its maintained plan. No staging or commit occurred. Remaining acceptance is live support/interaction behavior, rendered camera responsiveness, p95 budget, and final whole-diff maintainability review—not another numerical policy awaiting user approval.


### Triangle rejection and jump-footing checkpoint

Added a conservative early rejection inside the existing static triangle cast. Along the authored normal, the swept sphere occupies a monotonically decreasing interval; if that interval cannot reach any of the triangle's vertex projections, the triangle cannot collide with it. This skips triangle construction and the generic narrow-phase query. All three vertex projections participate, so the shortcut does not assume an authored polygon's fan triangles are perfectly coplanar. It introduces no cache, additional navigation pass, or collision-policy exception. The existing contact epsilon enlarges the candidate interval conservatively.

Verification: all 630 existing world library tests pass (`/tmp/triangle-projection-tests.log`), and an additional focused regression passes for a raised triangle vertex that a plane-only rejection could miss, plus separated sweeps on either side (`/tmp/triangle-projection-fixture.log`). World all-target Clippy passes with warnings denied (`/tmp/triangle-projection-clippy.log`). No measured performance benefit is claimed yet; the latest live binary predates this shortcut.

The normal-debug capture `/tmp/contact-jump-support-live.json` completed with explicit disconnect. Its attempted jump failed with `launch-rejected`, distinct from the preceding capture's `unsupported`. The maintained probe now retains three attempted-jump actor observations even when no committed trajectory exists. Before charging the published contact was grounded; before release it was airborne; at release feedback it was grounded again. The observed vertical change across these samples was about 0.0147 m. These asynchronous publications do not identify the exact integration-time support or prove the cause of the transition.

Code tracing establishes that accepting a charge does not require support. Release preparation checks the published body's contact; the contact kernel then confirms current footing before `GroundedBodyActuation::contact_step_input` admits a launch. An unsupported confirmed state produces ordinary ballistic input and leaves `launch_admitted` false. Thus a published grounded sample alone cannot prove that integration should have launched. No admission check was weakened, no support tolerance increased, and no retry mechanism added. Remaining investigation must establish the actual support and velocity at confirmation rather than infer it from asynchronous publication. Invalid launch resolution and unavailable collision coverage also remain distinguishable code paths to exclude before attributing this particular result solely to footing.

Remaining acceptance: measure the triangle shortcut in the debug workload, explain the support transitions and launch rejection, verify rendered camera response, and complete the whole-diff maintainability review. The 30 ms p95 target remains unmet by the latest timing capture. This checkpoint does not close the plan or authorize a commit.


### Supported navigation commit and live footing trace

The triangle-shortcut debug capture `/tmp/contact-footing-stages-live.json` completed with explicit disconnect and no drive error. Its 764 simulation samples have mean 21.102 ms and p95 26.477 ms; admitted/elapsed time is 1.0. It observed 70 named Olthoi among 83 actor records, peak snapshot 84 entities, and maximum recorded Olthoi travel about 55.75 m. This satisfies the numerical target for this capture, not a controlled speedup claim or the entire live gate. Player movement remained poor: forward 0.032 m in five seconds, strafe-left 0.068 m, combined forward/strafe 0.030 m, forward/turn 0.395 m. The jump committed, rose about 2.54 m and ended grounded. It does not retroactively explain the two earlier rejected jumps.

Temporary player-only tracing recorded support confirmation, ordinary navigation, tentative crowd response, and final state for each tick. No confirmed or ordinary supported state had outward normal velocity above contact epsilon. Eighty final supported states did, reaching about 0.2083 m/s outward. The first example retained the same pose on a slope while final correction left outward velocity; the next confirmation rejected support. This directly identifies a consistency failure between crowd navigation and the next tick, without assuming that asynchronous frontend samples identify the exact cause of either earlier jump rejection.

Two accepted navigation exits were inconsistent with ordinary settling: stair acceptance clipped only inward velocity while declaring support, and edge rollback restored geometry/support but retained velocity modified by the rejected route. A shared `WorkingBody::constrain_supported_velocity` now applies at navigation commit, before later contact stages consume the body. Final contact completion also applies it because crowd response can change velocity while its combined displacement is zero and therefore requires no geometric navigation. These are two input-producing boundaries sharing one rule, not additional sweeps. Supported state retains tangential velocity; admitted launches and restitution rebounds already release support and remain unaffected. The stair-specific inward-only clipping was deleted. Walking settling still removes its normal component before classifying the landing result; that ordering decision cannot be replaced by a post-classification clamp.

`ProtectedFooting` now saves velocity with geometry, membership and ground, so rejected route impacts cannot alter physical continuation. The saved correction velocity already includes the current crowd response; rollback does not erase that response. Timed edge holding retains its existing zero-velocity behavior. No jump grace period, launch retry, enlarged support tolerance, additional contact pass, or support cache was added.

Verification: world 632, core 355, host 276 library tests pass (`/tmp/support-commit-tests.log`); all-target world/core/host Clippy passes with warnings denied (`/tmp/support-commit-clippy.log`). Existing stair traversal now checks supported normal velocity, and a crowd-on-sloped-edge fixture checks the same published invariant over successive ticks. Both new invariant checks also pass before the fix; they are broader conformance coverage, not claimed reproductions of the particular live failure. The earlier attempted cylinder-ledged fixture modification exercised different adjustment reporting and was reverted instead of weakening its existing assertions. Existing launch, rebound, hard-wall, edge and correction conformance remains green.

The first capture's temporary instrumentation was restored exactly from fresh backups and the normal debug binary rebuilt. A second diagnostic debug build is now verifying the support commit in `/tmp/contact-support-verified-live.json`, after the relog cooldown. Await terminal output, compare supported normal velocities, remove temporary source instrumentation from its fresh backups, and rebuild the normal debug host. Remaining gate: player drive/escape behavior and authority return in actual crowd context, rendered camera responsiveness, and final complete-diff maintainability acceptance. Timing alone does not close the plan.


### Supported navigation live verification

`/tmp/contact-support-verified-live.json` completed with no drive error, successful jump commit and grounded landing, and explicit disconnect. The corrected debug build recorded 764 simulation samples: mean 17.359 ms, p95 20.979 ms, maximum 22.985 ms, admitted/elapsed ratio 1.0. It observed 67 named Olthoi among 80 actor records, with maximum mob travel about 56.73 m. This is the second successive capture below the 30 ms p95 target, with different live positions/populations; no controlled relative speedup is claimed.

Both support confirmation and final publication recorded 724 supported states and zero normal-velocity inconsistencies above contact epsilon. Maximum absolute normal speed was about 1.07e-7 m/s. This verifies the specific live invariant that previously failed in 80 final states. The jump rose about 1.92 m and ended grounded. Earlier rejected releases remain historical observations; the capture demonstrates the new consistent supported-state behavior, not a proof that every possible rejection has the same cause.

Movement: strafe-left 2.025 m in 1.25 seconds and forward-plus-strafe 3.805 m in 1.25 seconds demonstrate useful driven motion in this crowd. Straight forward moved 0.017 m in five seconds and forward-plus-turn made no translation. Without the corresponding requested vector and hard-obstacle contact, these phases cannot distinguish valid obstruction from deficient input/navigation. Do not reduce this to another timing problem or change motor strength based solely on displacement. The next bounded check should inspect requested ordinary motion against its accepted hard path in the obstructed direction; rendered camera/animation and the complete-diff maintainability gate remain outstanding.

Temporary runtime and kernel logs and probe stderr retention were restored exactly from their fresh pre-capture backups. The normal debug host rebuild completed successfully (`/tmp/support-final-debug-build.log`). Rust formatting, `git diff --check`, and probe syntax checks pass; a targeted source search confirms the temporary instrumentation is absent. No temporary production instrumentation, new cache, additional contact iteration, staging or commit is intended to remain. The plan remains active.


### Hard-contact numerical consistency gate

The focused debug capture `/tmp/contact-drive-path-live.json` completed with no drive error and explicit disconnect. Forward movement travelled 18.736 m in five seconds; strafe-left 2.643 m, combined forward/strafe 0.712 m, and forward/turn zero. Actual solver inputs show supported driven targets around 11 m/s in the expected direction. This excludes a blanket dropped-forward-input explanation. No motor strength, contact mobility, iteration budget, or controller source was changed.

The capture also reveals a hard-query stall. The same floor normal `(-0.51449597, 2.9802317e-7, 0.8574928)` repeatedly blocks nearly tangent requested motion such as `(-0.22095652, -0.022092547, -0.13257396)` at time zero on all three slide passes. Across ordinary sweeps, the trace contains 253 clear casts, 110 positive-time impacts, 250 zero-time impacts whose requested normal component lies within a conservative three-epsilon product-sum scale, and 102 other zero-time impacts. These classify the logged requested vectors, not the reconstructed cast displacement. Parse time of impact numerically: a substring search for `0.0` incorrectly includes positive times such as `0.062`.

Source inspection shows why a local angular threshold is not a complete numerical contract. `support_at` accepts height error within `CONTACT_EPSILON`, while `MovingSphereCast::update_triangle_hit` admits any strictly negative approach. `MovingSphereCast::new` reconstructs displacement from represented endpoints; adding a small tangent displacement to a nonzero float position and subtracting it again can change its normal component. The support proof, velocity projection and swept endpoint must agree on what constitutes tangent travel. Ignoring the first surface hit or increasing slide passes would conceal this inconsistency.

An exploratory synthetic triangle test did not establish a clean before/after reproduction: its initial tangent case already passed; shifting the face into the support tolerance instead exposed a tiny inward cast with no hit. It was removed, and no production angular threshold or other numerical bypass was implemented. Do not present that experiment as a new checked-in regression or as proof of a universal inward-cast failure. The retained triangle interval shortcut, supported navigation commit, and their previously passing suites are unchanged.

Decision needed before further hard-contact changes: may hard geometry explicitly use a bounded contact tolerance for near-tangent traversal, provided penetration cannot accumulate beyond that tolerance and unrelated inward obstacles remain swept? The recommended direction is one shared hard-contact numerical contract covering support, initial contact, tangency and endpoint representation. Avoid per-floor ignore lists, surface-specific bypass flags, and additional iterative correction passes. The analytical gate must explain the nonaccumulation bound and handling of a second wall/corner before implementation; a tolerance multiplier alone is not an acceptable design. This concerns the stronger hard-scene contract, not the already accepted approximate mobile/mobile interactions, and therefore needs user review under the requested stop-on-significant-decision rule.

Temporary input/sweep tracing and probe retention were restored exactly from fresh backups; `/tmp/drive-path-normal-build.log` records the normal debug rebuild. The existing UI probe was inspected but not run: its non-teleport modes currently select `dev:client:release`, so debug selection must be corrected before using it for the authorized camera acceptance. No UI-probe changes or extra login occurred. Remaining independent acceptance is rendered camera behavior, authority-return/animation observation, and complete-diff maintainability review. The plan is not complete.


### Approved numerical-contract execution

The user accepted the recommendation to resolve this structurally at the hard-query/support boundary. This supersedes the pending decision above. Do not request that permission again. The approval covers a shared bounded numerical tolerance, not arbitrary collision omission or unbounded penetration. Continue within the existing ordinary-navigation / tentative-crowd / corrective-navigation architecture.

The endpoint calculation is now reproduced independently using f32 operations matching `Vector3` arithmetic (`/tmp/hard-contact-endpoint-rounding.json`). At the captured center `(126.723068, -170.901123, -4.40638685)`, the requested tangent has a *positive* normal component of about `1.49e-8 m`. Forming the represented endpoint and subtracting the start changes it to about `-9.31e-7 m`. Therefore the earlier description of an initially negative requested dot product was incomplete: endpoint construction itself reverses the classification. An epsilon based solely on the dot product's multiplication/addition error does not cover the actual failure. This calculation uses the captured values; it is not a new live run.

Current competing owners:

- `bsp_query::polygon_sphere_contact` uses radius minus `CONTACT_EPSILON` for overlap admission.
- `volume_query::placed_volume_sweep_contact` deliberately cancels that shrink for balls and expands initial-contact detection for cylinders. Its stable analytic normals remain useful, but proximity detection must not independently decide movement obstruction.
- `MovingSphereCast::update_triangle_hit` uses a strict negative approach and nominal-radius casts. Sphere-origin-relative triangle construction improves conditioning after endpoint reconstruction, but cannot recover an already rounded requested displacement.
- `stairs::support_at` accepts a height band and discards the candidate's height adjustment. The walking fast path can retain a slightly displaced supported pose indefinitely. A coherent tolerance cannot rely on that path to restore nominal clearance.

Analytical constraints for implementation:

1. Express the hard contact band as absolute geometric clearance, not a fresh per-step inward allowance. Repeated small inward moves must encounter the same fixed boundary. Keep the physical body radius unchanged in registration, publication and support footprints.
2. Evaluate the complete swept segment against every candidate. Endpoint clearance alone is insufficient: a segment can enter and leave a finite obstacle while both endpoints are clear. A floor tangent must not exempt a second wall, stair riser, upper-sphere obstacle, hard entity or finite edge.
3. Separate stable contact-normal detection from obstruction admission. Being near a surface is useful for selecting a normal; it does not by itself prove that a tangent/separating path is blocked. Prefer consolidation of the existing query rules over new per-surface bypass state.
4. Account for represented endpoints and nominal versus actual geometry consistently. A dot-product threshold alone, a global sphere shrink alone, or a higher slide budget does not complete this contract. Shrink alone merely moves the tangent-stall boundary to the inner margin if settling never restores nominal clearance.
5. Settling owns restoration of the nominal support height. Any actual adjustment must use the existing checked navigation operation; directly snapping a body out of a floor could put it into a nearby wall or ceiling. Preserve exact-rest fast paths where no represented adjustment exists. Reuse the selected support candidate rather than querying/re-deriving it at another layer.
6. Keep deep initial authoritative penetration distinct from the bounded ordinary-contact guarantee. Existing escape handling must not become permission to cross an unrelated solid. No new recursive recovery or global contact-system solve is warranted.

The first implementation gate must include asset-free repeated small inward/tangent travel at nonzero coordinates, a slope meeting a wall/corner, finite triangle edges, upper clearance, and hard ball/cylinder bodies. Import runtime tolerances in fixture expectations. Verify cumulative penetration bounds across ticks, not only one successful cast. Preserve meaningful existing launch, rebound, stairs, edge protection and topology tests. Only after those pass should the debug dungeon timing/drive and rendered-camera gate run again.

Maintainability acceptance: one documented owner for the contact band's meaning; no support-owner ignore list; no persistent collision permission inferred from optional data; no extra crowd solve or feedback pass; no generic new cache; support selection/height correction remains owned by navigation. Any increased hard-query cost from repairing settling must be measured against the existing 30 ms p95 gate, and justified by the contract rather than concealed by raising the budget. The exact implementation remains to be completed; this checkpoint closes the approval pause and establishes the analytical constraints, not conformance or overall completion.


### Fixed hard-contact band and checked nominal settling

Implemented the approved numerical contract without changing the collection loop or adding a contact pass. `MovingSphereCast` owns its query ball at a radius reduced by the fixed contact band. Nominal radii in body registration, geometry publication and support footprints are unchanged. `hard_contact_radius` owns the margin calculation: `min(CONTACT_EPSILON, radius / 2)` keeps casts nondegenerate for sub-tolerance query spheres; ordinary character/projectile radii use the existing 0.0002 m constant. The bound is attached to obstacle clearance, not consumed and replenished per requested displacement. Initial volume-contact normal queries no longer enlarge that boundary a second time. Cylinder cap tangency also uses the selected query radius directly.

Nearby support selection now returns its existing `SupportContact`, including height delta, rather than discarding height during standing classification. Confirmation reads the same candidate; settling checks the represented vertical adjustment against all hard geometry before accepting it. Exact represented rest needs no extra cast. Nominal support recovery therefore resets small floor error without an unchecked pose snap. The old general down-settle check allowed advancing up to another contact epsilon beyond the sweep hit; that allowance was deleted because the sweep now owns the band. This prevents independent layers granting additive penetration allowances.

The new repeated cylinder test exposed a short-cast failure in generic GJK: a flat-cap approach crossed the band by one small step. Cylinder cap-interior entries now use exact plane times, as triangle face entries already do. The analytic eligibility proof is local geometry: until the sphere reaches that cap plane it is wholly above/below the cylinder; when the projected contact lies inside the cap disk, no side/rim can precede the face. Rim and side candidates still use the existing continuous query. This is a narrow-phase accuracy repair, not a movement exemption or fallback that ignores hits.

Conformance added:

- 1,024 repeated sub-band inward triangle casts stop at one fixed clearance boundary.
- Hard ball and cylinder cases run the same 1,024-step bound check against both their top and radial surfaces and preserve nominal tangent travel (`/tmp/hard-band-radial-check.log` records the final radial extension).
- A near-tangent floor does not hide a crossed finite wall, even when both wall endpoints are clear.
- 240 successive slope ticks at nonzero coordinates retain forward progress and nominal support within the existing tolerance.
- A low ceiling blocks nominal support recovery over repeated ticks; nearby-support proof cannot authorize a snap through another surface.

Existing contact-position/time fixtures were updated to the geometric band rather than broadly loosening unrelated assertions. Curved hard-target tests now check velocity response against the actual impact normal and travel against the recorded impact fraction: allowing the fixed band changes the contact point slightly, so an exact initial radial axis and a time-zero bounce are no longer the expected geometry. Accepted path intervals remain contiguous and cover the tick. Existing support, stair, finite-edge, wall, corner, upper-sphere, launch, restitution and topology tests remain in the suite.

Verification: world 637 tests pass, including after removal of the redundant down-settle allowance (`/tmp/hard-band-settle-bound-tests.log`). Core 355 and host 276 pass after the cap repair (`/tmp/hard-contact-core-host-final.log`); all-target world/core/host Clippy passed (`/tmp/hard-contact-clippy.log`). The final down-settle tightening also passes core 355 / host 276 and all-target Clippy with warnings denied (`/tmp/hard-band-final-core-host.log`, `/tmp/hard-band-final-clippy.log`). World architecture documentation now describes the actual one-tick tentative-contact loop and the shared hard-contact/settle ownership; obsolete substep wording in that active section was removed.

Live debug capture `/tmp/contact-hard-band-live.json` completed without a drive error, with explicit disconnect and jump commit/grounded landing. It recorded 763 ticks: mean 23.637 ms, p95 28.965 ms, maximum 33.534 ms, admitted/elapsed ratio 0.999872. It observed 72 named Olthoi among 85 actor records; maximum recorded mob travel was 45.07 m. Different live placements/populations prevent a controlled comparison against the preceding 21 ms capture. The p95 gate passes in this workload, but with less headroom. The capture's binary predates only the removal of down-settle's extra allowance; that tightening changes acceptance, not query count, and is covered by subsequent conformance tests. Do not claim the capture exercises that last clause.

Live movement: forward 0.009 m; strafe-left and forward/strafe zero; forward/turn 3.696 m; turning after release 1.238 m; stop 0.309 m. Jump height was about 1.943 m and final contact grounded. These show active motion but do not explain every blocked direction. The camera published 1,427 events; rendered orbit and animation acceptance remain unproved. Do not close the full live gate from tick timing alone.

Temporary numeric timing/retention was restored exactly from fresh pre-capture copies. The normal debug host rebuild completed successfully (`/tmp/hard-band-normal-build.log`); targeted source search confirms temporary timing and retention are absent. No new permanent diagnostic, cache, persistent contact permission, recursive recovery, staging or commit was added. Remaining work is live directional obstruction context, rendered camera/animation/authority-return acceptance, final complete-diff review and final validation. No additional numerical-policy approval is pending.


### Rendered debug camera and maintainability review checkpoint

The production Electron UI probe now invokes `dev:client` for every probe mode, replacing its implicit release selection for camera/profile/precise-jump modes. This follows the user's debug-only instruction. Passive-camera entry settling is five seconds. Camera mode reuses the optional screenshot mechanism previously confined to profiling; the script explicitly disconnects through the host bridge before closing its CDP/child lifetime and reports cleanup failures. `inputToCameraMs` was renamed `inputToNextCameraEventMs`: it measures the next publication after an input timestamp, not a causal acknowledgement. No permanent renderer or physics instrumentation was added.

`/tmp/contact-debug-camera-ui.jsonl` completed with exit code 0, selected the configured dungeon character, entered the world, dispatched all 40 orbit inputs, saved `/tmp/contact-debug-camera-ui.png`, and reported `cleanup: disconnected`. The capture observed 210 camera events and 199 animation frames. Camera intervals: mean 16.080 ms, p95 22.4 ms, max 45.8 ms. Animation-frame intervals: mean 16.835 ms, p95 16.7 ms, max 50 ms. Next-camera-publication delay: mean 8.663 ms, p95 15.4 ms; it is explicitly not claimed as causal input-to-render latency. There were no page errors or console exceptions (only Vite connection debug messages). The screenshot was opened and inspected: it confirms the live crowded Olthoi dungeon, with the player and nearby models visible but heavily obscured by large nameplates and meshes. It does not independently prove smooth animation or crowd escape. This supports rendered camera/frame responsiveness for the measured gesture, not universal visual acceptance.

The bounded source review traced producer input through private collection preparation, support-aware actuation/reference advancement, kernel results, scene publication, reporting and observed-motion handoff. Camera review confirms world-owned registration/activation permission, independent direct input, immutable scene publication, worker advancement and reset/drop invalidation. Optional camera query input delays solving; it does not substitute for lifecycle permission. Retain that explicit permission and the separate client/Explorer lifecycle owners; merging them would add an abstraction without a shared ownership need. Incidental protocol/texture/catalog changes in the full diff are equivalent `as_chunks`/`?` rewrites, not new feature behavior; their existing length/admission guards remain intact. Stale substep wording in active core/world architecture and the core actuation comment was corrected.

One reporting hypothesis needs a construction-level fixture before final acceptance. `collect_traversal_report_touches` assigns `ContactBodyPath::reached_membership()` to every individual leg of both sphere traces. That is the whole path's union, whereas the report contract claims segment-local filtering. The existing `aggregate_domains_do_not_grant_a_segment_contact_in_an_unrelated_cell` test manually builds `ReportSegment` values and therefore cannot verify how production assigns memberships. Investigate a real multi-cell path, including endpoint/portal reach semantics, before choosing a fix; do not blindly substitute endpoint ownership or lose legitimate sphere overlap across a portal. This is reporting work, not a reason to reopen the numerical solver or camera timing results.

Remaining execution: establish/report the multi-cell construction behavior, finish host/frontend motion publication and lifecycle review, and obtain sufficient live directional/authority-return/animation context. The full goal remains incomplete. No new policy approval is required; changes remain uncommitted.


UI-probe validation: `node --check` and scoped Prettier pass; full app TypeScript/JavaScript ESLint passes (`/tmp/contact-ui-probe-lint.log`), and `git diff --check` passes. No diagnostic-only tests were added. An initial lint invocation used the repository root, which has no app package manifest; the actual app-script validation was rerun from `apps/holtburger-3d` and completed successfully. The live UI process is terminal with exit code 0; no camera probe remains running.

### Segment-local report membership review

Confirmed the construction mismatch: each accepted report segment previously borrowed the union of both spheres' entire accepted path. The filter itself was local, but its input admitted domains reached only later. Reporting now constructs each sphere leg's membership from the union of its two endpoint memberships. This retains reached portal neighbors rather than narrowing to committed-cell ownership. The aggregate candidate query still unions all accepted segments. A private iterator performs this construction once without an intermediate segment allocation; no movement query, solver pass, or public contract was added.

The new fixture constructs a real outdoor-to-interior-to-outdoor path through `CollisionScene::transit_motion_path`, with an earlier outdoor waypoint. It verifies that the earlier report segment excludes the future interior domain while portal segments retain interior and outdoor reach. The existing shape/filter fixture remains complementary. This establishes the construction defect analytically and through synthetic topology; it is not evidence that a false report occurred in the live dungeon. Endpoint unions remain a conservative domain admission for each leg, not a claim of exact time-resolved sphere/domain intersection.

Maintainability acceptance for this path: membership must be prepared by the production segment constructor; the narrow-phase consumer must not reconstruct topology; aggregate broad-phase domains must not substitute for segment domains; upper and primary sphere traces must use the same construction. All 638 world unit tests pass (`/tmp/report-membership-world-tests.log`). Remaining acceptance still includes host/frontend publication review and live directional obstruction, authority-return and animation context. No additional policy decision or commit is requested.

### Host/frontend publication and animation review checkpoint

Traced the ordinary committed-body handoff through `simulation::tick_physical_bodies`' collection-result loop, `WorldState::apply_integrated_body`, the runtime event collection, and frontend dynamic-feed decoding/mirroring. Physical publication precedes support-dependent authored-motion reconciliation and observed locomotion. The observed cursor consumes accepted supported timed travel; the authored cursor remains responsible for motion effects. `BodyMotionRuntime::presentation_sequence` gives active actions, noncyclic authored transitions and explicit poses priority over observed locomotion. The existing `observed_locomotion_cannot_replace_actions_or_change_authored_ticks` fixture checks action ownership and authored tick equivalence rather than merely inspecting a selected animation name.

Frontend decoding validates the host path before mirror mutation; the mirror rejects stale tick timestamps and wrong entity generations, and invalidation requires a replacement snapshot. Explorer fixed-tick delivery issues its epoch under the short publication lock after projecting entity advances; camera-only publication does not acquire the entity mutation/snapshot gate. These inspected boundaries do not introduce another physical position authority. This source review supports the ownership/lifecycle design, but does not prove live animation cadence or crowded escape behavior.

Repeated placed-path validation during sampling and duplicate-GUID validation in both decoder and mirror are pre-existing mechanisms outside this redesign. Defer their cleanup: removing them would require establishing all direct typed callers' admission contracts and would not complete the remaining live behavior acceptance. No new validation wrapper or lifecycle abstraction was added. Maintainability acceptance remains that animation cannot contribute corrective root motion/hooks, published paths retain paired placement, and stale generations cannot resurrect retired entities.

Full current app validation passed: `npm run check` (Svelte, application/node/test TypeScript, Electron/preload) and `npm run test:ts` (273 files, 2,120 tests). Logs: `/tmp/contact-final-app-check.log` and `/tmp/contact-final-app-tests.log`. The previous reporting change also passed world all-target Clippy with warnings denied (`/tmp/report-membership-clippy.log`). Both app processes are terminal with exit code zero. Remaining work is live directional obstruction and return-to-authority/animation acceptance, then the final requirement-by-requirement completion audit; these green checks do not substitute for those observations.

### Live moving-reference observation

The debug drive probe `/tmp/contact-return-live.json` completed normally (`ok: true`, no drive error, process exit 0) after the configured five-second world settle. Temporary world projection tracing recorded 44,569 committed body samples, including actual pose, optional physical reference, accepted supported motion and contact. This was a behavior capture with verbose tracing, not a timing benchmark. Commands returned in 0.5–0.8 ms. Five-second player displacement was 1.277 m forward, 1.596 m strafe-left, 1.283 m forward/strafe-right, and 0.071 m forward/turn. Stop travel was 0.014 m. Jump peaked at 1.596 m, returned grounded, and its late vertical range was 0.000241 m. These distinguish prompt input admission and some useful travel from the nearly blocked direction; they do not classify that blockage's cause.

Reference parsing compared only samples whose actual and reference poses shared the same cell frame. It found 53 bodies with physical references and seven runs of at least eight samples where the reference stayed fixed within 0.00001 m and error fell by more than 0.1 m. The clearest example is Olthoi Slasher `0x80000397`: 71 successive retained samples, reference error decreasing monotonically from 1.6829 m to 0.0478 m, maximum actual step 0.0333 m. This demonstrates gradual live return toward an unchanged reference rather than a packet resetting the reference nearer the body. Other runs include contact interference; do not generalize monotonic return to all crowded bodies. Parsed evidence is `/tmp/contact-return-parsed.json`.

The public feed records 87 actors and changing motion presentations for the returning Slasher, but its history lacks timestamps correlated to the physical trace. It therefore does not prove visual gait or attack priority during that particular return. Remaining visual acceptance stays open. Large reference offsets elsewhere are not automatically failures: nominal reference motion may continue while actual movement is obstructed. Do not introduce a new offset cap from this observation alone.

Both temporary source edits were restored byte-for-byte from fresh pre-capture backups. The normal debug host rebuild passed (`/tmp/contact-return-normal-build.log`), and `git diff --check` passes. No permanent trace field, diagnostic API, solver policy or commit was added. The plan's top-level status now reflects completed publication review and rendered camera checks instead of the superseded low-cadence capture.

### Animation ownership switching identified during live acceptance

The return capture's Slasher history contained 119 clip-ID changes, not just framerate updates. A temporary source-content reader decoded motion table `0x09000002` through `ContentRepository` and the normal DAT parser: `0x03000044` is run, `0x03000030` ready/default, `0x0300004B` walk, and `0x03000039` sidestep in style `0x3C` (`/tmp/contact-motion-rows.txt`). The frequent run/ready pair therefore cannot be dismissed as attack playback. The temporary reader was removed.

A separate passive debug capture, `/tmp/contact-animation-live.json`, completed with exit 0 and no drive error. Temporary registry tracing recorded the actual presentation selector inputs, authored clip and visible clip for Olthoi-table bodies. Across 67,761 projection samples, the run/ready pair switched 1,144 times alongside a change in `allows_observed_locomotion` while the authored sequence was cyclic, an observed cursor existed, and no action owned playback; another 19 pair switches kept observation allowed. Repeated projections are not independent simulation ticks, so these are selection observations, not a frequency estimate. Representative samples keep the authored run at 91.61392 fps while visible output alternates between it and observed idle.

This localizes the main switching to presentation permission, not ordinary walk/run threshold jitter or action priority. `BodyMotionRuntime::drive` currently derives permission from the requested forward command after applying the order. Before choosing a fix, trace that requested command and the resolved/unmodelled selection: a rejected request can leave the authored clip unchanged, so request-based priority and resolved playback may disagree. Do not add hysteresis, blending, or a new solver policy to hide this ownership mismatch. This is a bounded remaining implementation investigation, not a request for a new user concession.

The temporary registry/probe edits were restored from fresh backups; normal debug rebuilding is recorded in `/tmp/contact-animation-normal-build.log`. No permanent diagnostic API or motion-content-dependent test was added. Visual animation acceptance remains open until the permission switch is explained and handled.

### Resolved-motion presentation permission fix

The command trace (`/tmp/contact-command-live.json`, passive debug, exit 0) identifies every captured disabled-observation request as `MotionCommand::FALLING` (`0x40000015`). Olthoi table `0x09000002` cannot model that forward channel. Selection reports it unmodelled and retains the prior run, default or turn substate. The old permission predicate nevertheless treated the requested falling command as a selected special pose, revealing the stale authored run whenever support presentation requested falling.

`BodyMotionRuntime::drive` now derives observed-locomotion permission from the resolved substate after selection, using ordinary walk/back/run/side/turn identities and the table's default-cycle identity. Selected special poses still retain authored presentation; active actions and noncyclic transitions keep their separate existing priority. Missing falling content no longer acquires presentation ownership. This changes only which existing cursor is visible; it neither changes authored motion/effect advancement nor introduces smoothing state or a physical correction policy.

The source-only `missing_falling_content_keeps_resolved_locomotion_presentation` fixture starts authored running with observed idle, requests an absent falling cycle, verifies running remains the resolved authored substate, and requires observed idle to stay visible. It failed on the former permission predicate (run was exposed) and passes with the fix. An initial test compile used a nonexistent diagnostic getter; the fixture was corrected to prove missing content through the table and public resolved state, without adding an API. Existing action/special-pose priority and authored-tick equivalence tests remain passing.

Validation: 639 world, 355 core and 276 host unit tests pass; world/core/host all-target Clippy with warnings denied passes; rustfmt and diff whitespace checks pass. Logs: `/tmp/contact-animation-world-tests.log`, `/tmp/contact-animation-core-host-tests.log`, `/tmp/contact-animation-clippy.log`. Temporary command tracing was restored from fresh backups before the fix, and the ordinary debug host build is `/tmp/contact-animation-fixed-build.log`. Remaining acceptance is the live post-fix animation check, directional obstruction context and final completion audit. No new user policy decision is pending.


### Post-fix live result and manual acceptance gate

The ordinary debug capture `/tmp/contact-animation-fixed-live.json` completed with `ok: true`, normal process exit 0 and no temporary instrumentation. Both it and the preceding ownership capture used 15-second passive observation and saw 86 actor records. The public Olthoi motion histories contain 78 run/ready clip switches after the fix versus 1,163 before; total clip-ID changes were 1,605 versus 2,602. Camera publications were 936 versus 934. Encounter trajectories differ, and the earlier binary had temporary tracing, so these are observed counts supporting the specific permission repair, not a controlled performance or visual-quality comparison. Remaining idle/side/walk changes may follow accepted motion; do not add smoothing merely to reduce these counts.

Completion audit at this stopping point:

| Requirement | Current evidence | Acceptance |
| --- | --- | --- |
| Local bounded contact response and hard-navigation integrity | Current world conformance (639 tests), retained corner/escape, repeated hard-band and support fixtures; source review of one ordinary and one aggregate corrective hard traversal | Automated contract coverage passes; live directional feel remains open |
| Collision-constrained gradual authority return | Fixed-reference live Slasher run falls from 1.6829 m to 0.0478 m over 71 samples; source-only return/replacement tests | Gradual return established, visual cadence needs review |
| Authored effects and action priority remain independent of observed gait | Existing action/tick-equivalence tests; missing-falling regression fails before the resolved-substate fix and passes afterward | Source/unit coverage passes; visual result needs review |
| Responsive debug host and camera | Latest recorded solver p95 28.965 ms; rendered camera/frame probe; sub-millisecond movement command acknowledgements in the return capture | Measured scopes pass; not a guarantee of crowd escape |
| Publication/lifecycle coherence | Body-to-host-to-mirror review, generation and replacement-snapshot handling; full 2,120 frontend tests/type checks | Reviewed and checked |
| Validation and cleanup | Current 639 world/355 core/276 host tests, warning-denied Clippy, normal debug rebuild; no temporary trace source or temporary content reader remains | Pass for current changes; no staging/commit performed |
| Required live play acceptance | Automated drive made 1.3–1.6 m in several five-second phases and almost no movement in another; no correlated rendered playthrough resolves whether this is acceptable crowd resistance | **Open: user eyes required** |

Pause implementation for the explicitly authorized user-eyes gate. Ask the user to run `dev:client` with the configured dungeon character, wait five seconds, move/turn among the swarm, release movement, and watch gait/attacks and displaced mobs returning. The actionable feedback is whether movement still feels locked/sluggish and whether mobs visibly flicker between running and idle or slide while returning. Do not claim the whole plan complete, call the directional blockage valid without evidence, or launch another broad evidence campaign while waiting for this playability judgment. If the user reports a remaining defect, reopen its specific gate with that concrete behavior; a new physics concession is not implicitly authorized by this pause.


### User playthrough: performance accepted; resistance and skating refinements

The user confirms performance looks good, but mobs are too easy to push and moving mobs/players appear to animate once then skate. This supersedes the previous waiting gate with actionable feedback. No new solver architecture is requested or needed for resistance tuning.

Contact tuning: `ContactMobility::PLAYER` changes from 0.25 to 0.5 while ordinary mobile mobility stays 1.0. A player/mobile pair therefore shares correction and closing-normal velocity response 1:2 instead of 1:4. The player receives one third rather than one fifth of the response, so it loses more forward motion against a mob. Player advantage remains, but is reduced. This is a starting gameplay adjustment, not a claim of realistic mass or final feel. Pair tolerance, fractional separation, hard sweeps and work budgets are unchanged. All 639 world tests still pass, including corner crowd release and hard-obstacle integrity.

The frontend path exposes a concrete skating cause: `classifyDynamicEntityMotionUpdate` treated every changed framerate as a fresh clip, and `AnimationSystem::playClip` reset both frame position and the playback clock. The new observed-motion rates can change every tick, including tiny numeric variations already present in captured histories. Repeated reinstallation prevents continuous playback; the symptom does not require a host loop/hold error.

Speed-only updates of an installed animation with the same window and completion behavior now produce `retime`. The animation system consumes the pending fraction at its old rate (including departed-frame effects), changes the rate, and preserves its phase and time origin. Different clips/windows/completion behavior still install normally, settled-pose confirmation is retained, and unavailable clips cannot claim installed playback. No smoothing timer, cadence quantization, or animation override was added. Clip identity is compared once in the classifier; the previous duplicate comparison helper was removed. Added regression coverage feeds a rate update every render frame through multiple animation loops and checks frame progression, plus the installed/unplayable classification boundary.

Validation so far: full frontend suite 273 files/2,122 tests, full app check, ESLint, 639 world tests, world/core/host all-target warning-denied Clippy, and normal debug host build pass. Logs: `/tmp/contact-feedback-app-tests.log`, `/tmp/contact-feedback-app-check.log`, `/tmp/contact-feedback-app-lint.log`, `/tmp/contact-resistance-tests.log`, `/tmp/contact-feedback-clippy.log`, `/tmp/contact-feedback-build.log`. The classifier consolidation receives a final focused test/type-check pass in `/tmp/contact-retime-final-tests.log` and `/tmp/contact-retime-final-check.log`. No commit or staging was performed. Rendered confirmation of the skating repair and subjective resistance remain for the next playthrough; unit checks establish continuous playback under changing rates, not a claim that every possible skating cause has been ruled out.


### 10:1 mobility and deterministic downhill stall repair

The user explicitly requested 10:1 after the 2:1 trial. `ContactMobility::PLAYER` is now 0.1 versus ordinary mobile 1.0, and its source comment reflects that ratio. This increases the player's pushing advantage, as explained before applying it. The pinned-pair fixture's former 32-tick window left about 10 mm of overlap at this ratio: the pinned mob cannot accept its large proposed share, so the player backs out more slowly. The fixture now observes two seconds using the runtime tick duration and retains its final overlap, hard-target and no-launch assertions. This is a documented recovery-time tradeoff of the requested ratio, not a change in solver convergence policy.

Expanded `repeated_slope_travel_restores_nominal_support_without_stalling` from one slow uphill case to 24 combinations: slopes 0, 0.01, 0.2 and 0.6, signed speeds 0.3, 8 and 12 m/s, each over 120 ticks. It checks continuous signed progress, walkable support and nominal support height every tick. The first expanded fixture accidentally intersected the underlying fixture floor as its ramp descended; raising the authored ramp and recomputing its plane removed that unrelated support. The isolated ramp then stalled at tick 5 on slope 0.2 with requested speed -12 m/s. Temporary tracing recorded three zero-time hits against the same floor normal for tangent movement, reproducing a numerical stall without crowd contacts.

`MovingSphereCast::update_triangle_hit` used the contracted query sphere for casting but added `CONTACT_EPSILON` back to its vertex-projection reach check. That admitted a tangent floor into the generic cast even though the sphere's normal projection could not reach it; the generic query returned a spurious immediate obstruction. The projection rejection now uses the same query radius as the cast. It still includes all triangle vertex projections, including nonplanar authored fan geometry. No new ignore-floor exception or extra penetration allowance was added. All 24 expanded cases pass. This establishes a real downhill-stall repair; it does not by itself prove that every live mob falling transition has the same cause.

Stopping investigation: `surface_friction` applies `(1 - friction)^dt` to supported coasting velocity. Its default coefficient 0.95 retains 5% of speed after one second; at 12 m/s the continuous approximation permits roughly 4 m of total coast. Content may override that coefficient. The contact motor owns braking while driven or returning; ordinary coast uses this authored drag. Airborne bodies skip grounded drag, so repeated support loss can extend sliding. Friction has not been retuned in this pass: first distinguish the repaired support failure from the user's preferred supported stopping distance. Sledding and explicit flight retain their existing response.

All current world/core/host unit tests pass (639/355/276), including repeated hard-band, wall crossing, low-ceiling, support, corner release and action coverage (`/tmp/slope-feedback-all-tests.log`). The original isolated downhill failure is recorded in `/tmp/slope-feedback-trace.log`; the expanded passing case is `/tmp/slope-feedback-fixed.log`. Temporary source traces were restored exactly from fresh pre-trace backups. Warning-denied Clippy and the normal debug rebuild are `/tmp/slope-feedback-clippy.log` and `/tmp/slope-feedback-build.log`; formatting and diff checks pass. No staging/commit was performed. Remaining live acceptance is ground/falling consistency and stopping feel after the numerical repair, plus the previous rendered skating recheck.


### Equal-mobility trial requested by the user

The user clarified that they wanted less pushing advantage and requested `ContactMobility::PLAYER = 1.0`, matching `MOBILE = 1.0`. Updated the constant and source comment. The integration fixture formerly required strictly greater mob displacement; it now accepts equal response within the existing contact tolerance, consistent with the supported tuning range. Weighted pair arithmetic remains covered by the primitive tests. No friction, support, or solver-work changes accompany this trial.


### Player braking-only velocity response

The user approved separating overlap correction from momentum transfer. The local player keeps the current positional mobility (1.0, equal to an ordinary mob), but preparation now assigns `ContactVelocityResponse::BrakingOnly`; other bodies use `Shared`. The primitive receives this prepared policy rather than inferring player identity or repurposing mobility as a permission flag. Ordinary contact weighting and filtering remain unchanged.

For a closing pair, compute the ordinary weighted common normal speed. A braking-only first body bounds that speed above by the greater of its own normal speed and zero; a braking-only second body bounds it below by the lesser of its own normal speed and zero. This lets the player lose inward velocity but cannot accelerate it outward or reverse it. The mobile peer takes the remaining change. The bounds overlap even if both bodies brake only. Separating/tangent motion is preserved. A response-excluded peer never acquires velocity response; if satisfying that exclusion and the player's braking limit leaves relative closing motion, residual contact is accepted rather than imparting forbidden momentum or adding retries.

Position correction still uses the original mobility shares, hard navigation, and correction budget. Thus an incoming mob can cause positional separation but cannot leave the player with inherited integration velocity. Repeated overlap corrections can still carry the player along as a mob advances; this is the concession explicitly discussed with the user, not an immunity claim. No IPC, animation, reconciliation, timer, query or contact-pass mechanism changed.

Tests cover incoming mobs, player movement into a stationary mob, head-on travel, a faster mob catching a player moving away, separating motion, tangent preservation, reversed pair order and an unresponsive incoming peer. A production collection fixture verifies that local-player preparation selects the policy: overlap moves the stationary player but both retained and accepted timed player velocity remain zero. World/core/host tests pass (642/355/276), as does all-target Clippy with warnings denied. Logs: `/tmp/braking-contact-all-tests.log`, `/tmp/braking-contact-clippy.log`; the normal debug build is `/tmp/braking-contact-build.log`. An initial test compile caught an extra argument accidentally supplied to an existing helper during constructor migration; it was removed without changing the helper contract. No staging or commit was performed.


### Live approaching-mob falling/stalling investigation (2026-09-08)

After the user accepted the braking-only contact response, passive debug sessions at the character's current outdoor location reproduced repeated airborne/grounded transitions in approaching creatures. No movement commands were issued. Old Bones spent 256 of 511 published samples airborne in the first capture; the phase trace in the next session locates support loss in ordinary hard navigation, before crowd correction. This is a distinct support-acquisition problem, not evidence that the new pair momentum policy regressed. The capture including upserts and integrated updates contained no position discontinuity larger than one metre; the user's subsequent visual pop remains unisolated and must not be reported fixed.

Offline replay against the same authored terrain explains a concrete rejection. At outdoor owner `0x7e67ffff`, lower sphere center `(1.25389, 0.25984, 26.04169)`, radius `0.41419998`, a neighbouring terrain triangle supplies an overhang support only 0.0000343 m below the sphere. The nearby-support shortcut selects it. Another terrain triangle requires an upward adjustment of 0.0256819 m. The requested downward settle hits that higher triangle at time zero, correctly; the upward adjustment to the higher support is unobstructed. At an earlier captured center `(0.7754, 0.49876, 26.238863)`, the surface under the center requires 0.0278253 m of upward recovery, also unobstructed. Airborne settling permits only 0.004 m of rise (10% of the authored 0.04 m airborne downward reach), so it cannot acquire this support. The precise cause of the initial overlap has not yet been isolated; do not attribute it to server placement, crowd response, or numerical drift without tracing that producer.

The support search and hard sweep are answering different questions: filtering supports to a narrow height band can select a lower neighbouring plane while excluding the surface actually blocking the body. Increasing an epsilon or suppressing falling animation would conceal this inconsistency. Next implementation work should consolidate selection and clearance around one reachable support target, including explicitly bounded recovery from an already overlapping ground pose. Preserve real launch/fall behavior, ceiling/wall obstruction, and the fixed hard-navigation work budget. Do not introduce terrain-seam-specific policy or another retry ladder. Before changing the recovery envelope, check its effect on finite overhangs, steep adjacent faces, and initial authoritative placement.

Acceptance: asset-free regression fixtures for a lower adjacent support plus an overlapping higher surface; shallow initial ground overlap; an overhead blocker; and a real unsupported fall. Prove the selected standing target is reachable and yields consistent grounded state without duplicate competing selection rules. Then repeat the passive live scenario and inspect both body contacts and renderer placement for the separately reported pop.

Evidence: `/tmp/mob-pop-live.json`, `/tmp/mob-pop-phases.json`, `/tmp/mob-pop-settle.json`, `/tmp/mob-pop-replay.log`, `/tmp/mob-pop-initial-replay.log`. All temporary source instrumentation was restored from fresh pre-probe copies. No production behavior was changed during this investigation; no commit or staging was performed.


### Step-height-bounded support recovery — implemented; live recurrence acceptance open

**Goal:** acquire valid ground from a retail-compatible shallow terrain overlap without repeated falling/landing or a new navigation mechanism.

**Ground truth and corrected diagnosis.** Retail `CLandCell::find_env_collisions` selects terrain using the body's low point (`acclient.c:340351`); ordinary `OBJECTINFO::validate_walkable` measures the vertical bottom point against that plane and directly corrects a below-ground point upward (`acclient.c:302787`). Its negative 0.1 interpolation allowance is conditional on step-down probing, not a universal recovery limit. ACE mirrors this in `ACE/Source/ACE.Server/Physics/ObjectInfo.cs:132`. For captured radius 0.41419998 and normal.z 0.93704253, full-sphere rest is `radius * (1 / normal.z - 1) = 0.0278290 m` higher than bottom-point rest, matching the offline 0.0278253 m recovery. This explains the geometric incompatibility; the exact first authority/body transition and the reported visual pop still require tracing if they remain after repair. It supersedes the earlier suggestion that arbitrary numerical drift explains this magnitude.

**Decision and concessions.** Keep full-sphere clearance and the agreed horizontal footprint. The physical body may sit slightly above the unchanged authoritative reference. Reuse `GroundedConfig::step_up_height` as the upward recovery bound; retain the existing walking/airborne downward reaches. A low ledge within that bound may be mounted if the existing support and clearance requirements admit it. No separate ledge-corner policy or new tuning parameter. A blocked candidate may remain unsupported; this is not an exhaustive search for a standing location. Initial overlap beyond the authored cap remains unresolved by this mechanism. Recovery is a geometric placement adjustment, not upward momentum or extra elapsed simulation time.

**Owned changes.** Primary implementation is `mobile_contact/step/stairs.rs`, with the preparation and publication integration in `mobile_contact/step.rs`. Reuse `SupportContact`, `StairCursor`, existing body sweeps, and accepted adjustment paths. The stair maneuver currently requires prior walkable support, so calling it directly cannot recover an airborne body; share its bound/clearance semantics, not its entire lift-forward-down procedure. Do not change terrain collision shape definitions, the renderer, animation priorities, authoritative pose storage, or mobile pair response.

**One ordinary tick.** When support preparation cannot confirm footing, permit one bounded support acquisition/recovery before choosing grounded versus airborne actuation. Select the governing support with the full permitted envelope, rather than committing to a near lower plane that excludes a higher blocking support. Sweep the required vertical correction using both movement spheres and hard targets. Commit pose, membership, support, and adjustment path together. Then integrate ordinary movement through the existing hard-navigation route and settle its accepted endpoint. Mobile passes remain query-free. The aggregate corrective navigation pass uses the same support selection and clearance semantics at its endpoint. Pure final confirmation must not launch another recovery attempt.

**Directional and geometric constraints.** Upward recovery requires walkable support under the existing footprint; downward landing retains its existing landing-normal policy. Preserve launch and separating-motion behavior: a rising body must not attach to a surface it is leaving, and slope-tangent upward motion must not be mistaken for a launch solely because world Z velocity is positive. Support selection must retain the selected height, normal, source, and feature as one result. Height alone does not authorize movement through a ceiling, wall, hard body, or unproved cell boundary. Optional route failure must not partially publish its correction. Upward recovery must not fabricate a downward impact, bounce, fall-damage event, authored root motion, or return-motor velocity.

#### Gate 1 — analytical feasibility and small regression fixtures

- [x] Trace preparation, actuation selection, ordinary settlement, correction settlement, and final confirmation. Assign one owner to candidate selection, clearance, and commit; identify which current helpers disappear or become the shared implementation.
- [x] Establish the explicit query ceiling: at most one recovery candidate/clearance attempt during failed preparation, plus the existing bounded endpoint navigation work; no recovery per mobile pass, retry ladder, or recursive navigation. This permits bounded additional work for unsupported bodies, not a promise of unchanged query count. Confirm stable supported bodies do not incur a new full recovery sweep.
- [x] Check composed vertical adjustments: preparation recovery repairs the initial pose; the subsequent authored step limit is relative to that corrected pose. Each operation is capped and swept. Do not add a tick-wide cumulative height budget; see the directional/composition decision below.
- [x] Add asset-free fixtures for a retail-height body on a slope, including the captured radius/normal; lower adjacent support plus higher blocking terrain; recovery below/above the authored cap; and a ceiling blocking recovery. Demonstrate the existing implementation fails the relevant support cases.
- [x] Verify finite ledge/corner behavior, low versus excessive steps, hard entity tops, steep surfaces, actual falls, and launches. If the existing footprint/clearance contracts cannot distinguish admissible support, stop and report the specific gap before expanding the design or starting more live runs.

#### Gate 2 — consolidated implementation and verification

- [x] Replace the unconditional `maximum_drop * 0.1` recovery limit with the authored upward allowance in the appropriate acquisition contexts. Stair descent keeps its route-specific remaining envelope; do not globally replace every `maximum_rise` argument.
- [x] Remove the competing nearby-support selection shortcut where it can select a lower surface independently of the complete standing target. Preserve a cheap confirmation path only if it cannot contradict recovery selection at the same pose.
- [x] Preserve swept topology discovery for vertical travel; current membership alone is not proof of every cell crossed by recovery or descent.
- [x] Commit upward recovery as a geometric adjustment with consistent body state and report membership. Verify no synthetic landing impact from upward correction and no positional reset on ordinary authority updates.
- [x] Run focused footing/contact/landing tests, then world/core/host tests and warning-denied Clippy; build the normal debug host. Tests use runtime constants for configurable bounds and checked-in synthetic geometry.

#### Gate 3 — bounded live confirmation and cleanup

- [x] One passive debug observation at the user's aggro location, respecting login throttling and entry settling. Confirm approaching bodies no longer repeatedly lose support on the captured shallow terrain mismatch; inspect complete updates, including upserts, for the reported pop.
- [x] If the pop remains, distinguish host accepted position from rendered placement before changing reconciliation or animation. Do not claim the support fix resolves a symptom not reproduced. **Closure:** Host publication discontinuities were captured and distinguished from ordinary movement; user now accepts the behavior. Exact reset causes remain diagnostic debt, not a claimed solved server behavior.
- [x] Compare ordinary tick cost with the accepted performance baseline; investigate only a material regression, without reopening the entire solver audit. Current retained debug benchmark and rendered cadence pass; authored live-density limits are stated in the completion audit below.
- [x] Remove diagnostics, update support-policy comments and architecture documentation (including accurate retail divergence citations/evidence limits), and record results in this section. No staging/commit unless separately requested.

**Maintainability acceptance:** one support-target selection rule shared by recovery and navigation; no terrain-specific exception, new locomotion state, recovery timer, mobile substep query, or duplicated support-height calculation. Reuse the authored cap rather than adding a knob. Keep pure confirmation distinct from a swept pose mutation. Existing support footprint, hard-top support, edge protection, tolerated mobile overlap, braking-only player momentum, and action-animation priority remain acceptance requirements. No open user preference is needed for this scope; gate failures require a concrete explanation rather than speculative policy additions.


#### Gate 1 progress — deterministic motor-selection failure

Added `retail_terrain_height_recovers_support_before_actuation` in `scene/physical_body_tests/footing_tests.rs`. It constructs a checked-in synthetic slope, places an entity at bottom-point terrain rest, and requires support before the actuation callback as well as continuing supported forward travel. The current solver fails at the first motor-selection assertion (`/tmp/support-recovery-gate.log`); this reproduces the contract failure without DAT assets or a live login. The regression is intentionally red pending implementation. Production code is unchanged.

The analytical trace identifies two independent corrections needed: preparation's `refresh_support` only confirms a pose and cannot recover it; endpoint settling's near-height filter can choose a lower surface before considering an overlapping higher one. A cap-only patch cannot meet the fixture or fix the latter selection error. `try_stair_maneuver` requires existing walkable support, so simply routing preparation into it is circular. Use existing cursor/adjustment machinery for acquisition instead.

Keep vertical topology discovery explicit: the existing general descent obtains reached membership from its downward body sweep before querying supports. A consolidation must not delete this and assume current membership includes every lower cell. The cheap near/upward candidate query can retain its current broadphase footprint while widening its height envelope to the authored cap; choose the highest admissible candidate before asking whether it is within confirmation tolerance. Pure confirmation then reads that same governing candidate instead of independently selecting a lower plane. Any actual rise remains swept. No new per-mobile-pass query is needed. Remaining gate work: ceiling/cap/adjacent-surface fixtures, directional admission, and accounting for composed recovery plus stair rise before the production cutover.


#### Recovery implementation progress — preparation and endpoint selection

The adjacent-surface fixture initially failed with zero displacement and lower-plane support despite an overlapping higher floor (`/tmp/support-recovery-adjacent-gate.log`). Added a table covering admissible recovery, ceiling obstruction, and recovery beyond the authored cap. Both it and the retail-height motor-selection regression now pass.

Implemented highest-candidate selection before confirmation tolerance in `standing_support_candidate`; the near lower-plane shortcut no longer independently wins. Preparation uses one swept geometric acquisition before selecting actuation. `SupportRefresh::{Recover, Confirm}` makes the two existing call sites' movement permission explicit: preparation can correct; final confirmation cannot. Upward recovery updates root, spheres, membership, and accepted adjustment path together and does not manufacture motor velocity, restitution, or a landing impact. Both preparation and endpoint acquisition reuse the existing swept cursor adjustment. The general downward fallback still discovers reached topology through its sweep; its upward allowance is now zero because standing acquisition owns upward candidates with the authored step-up bound. No mobile pass performs a query.

The complete world library suite passes: 644 tests (`/tmp/support-recovery-world-endpoint.log`), including existing launches, hard tops, slope movement, edges, crowd walls, and the two new regressions. Formatting and diff whitespace checks pass. This is partial implementation, not completion of the full gate: composed recovery-plus-stair cap accounting, explicit directional/restitution regressions, cross-cell recovery limitations, shared-crate checks, debug live observation, and final maintainability review remain. No live claim or resolution of the visual pop is made. No staging or commit.


#### Directional gate and composition decision

Added `slope_landing_distinguishes_uphill_approach_from_upward_departure`: the body begins just above a slope, with positive world-Z velocity but inward velocity relative to the slope. It failed because `settle_after_movement` rejected all world-Z ascent before considering support (`/tmp/support-direction-gate.log`). Removed that redundant gate. Standing-candidate admission and the existing final surface-normal check now govern separation; the paired true upward-departure case remains airborne. Full world tests pass, 645 total (`/tmp/support-direction-world.log`). This is a deletion of conflicting policy, not another directional threshold.

Analytical resteer: the earlier proposed cumulative recovery-plus-stair cap conflated repairing an invalid initial pose with measuring an obstacle's height. The authored stair height is measured from corrected footing. For example, recovering 0.35 m from initial penetration and then mounting a 0.3 m step does not make that step 0.65 m tall. Each correction/step remains bounded by the authored cap and hard clearance; no operation recursively renews its allowance. A tick-wide aggregate height budget would add state and make navigability depend on initial placement error rather than the obstacle. Do not implement that extra budget. The accepted concession is that total upward displacement in a tick containing initial recovery plus ordinary stepping can exceed one step height. Add composed-route coverage before closing this gate; continue to preserve physical-time versus geometric-adjustment provenance.


#### Composed-route and shared-consumer validation

`recovered_footing_can_mount_a_step_within_its_authored_height` passes (`/tmp/support-recovery-composed.log`): preparation corrects a below-floor starting pose, then ordinary navigation mounts the fixture's admissible step. Total upward displacement exceeds one step cap while the step itself remains valid. The first fixture version started overlapping the riser and held after recovery; moved its start clear of the wall and used a single-tick approach to isolate composed recovery/stepping rather than demand escape from a separate wall overlap. No production change was made to force that invalid starting route through the wall.

Core and host library suites pass: 355 and 276 tests (`/tmp/support-recovery-consumers.log`). The 645-test world run includes the directional change; the subsequently added composed-route fixture passes separately, bringing the defined world tests to 646. Warning-denied all-target shared-crate Clippy is recorded in `/tmp/support-recovery-shared-clippy.log`. Remaining work includes explicit cross-cell recovery coverage, reporting/provenance checks for upward recovery, a normal debug build and passive live replay, current architecture/retail marker cleanup, and final plan acceptance review. The visual pop is still unisolated. No staging/commit.


#### Recovery publication, live confirmation, and cleanup

`upward_recovery_preserves_upper_only_cell_reach_and_motion_provenance` passes (`/tmp/support-recovery-topology.log`). A vertical correction newly reaches a thin EnvCell through the upper sphere, while the lower sphere retains outdoor commitment. The published correction path carries the reached cell, accepted timed velocity and retained velocity remain zero, and no impact segment is emitted. This verifies actual swept recovery publication rather than a manually assembled report. Upward candidate discovery remains limited to current reached support geometry; the accepted correction itself traverses and validates newly reached cells. The downward probe retains its pre-query swept membership discovery. No blanket upward exploration sweep was added to airborne ticks.

The retail-height fixture now uses the captured Old Bones sphere dimensions and terrain normal, rather than only a representative synthetic slope, and passes (`/tmp/support-recovery-captured-fixture.log`). Cleanup removed the redundant provider-guaranteed height-range check, a duplicate grounded-state guard, and the unused positive-height branch/field from the descent-only helper. `DescentProbe`/`settle_down` now describe their actual role. Full post-cleanup library verification passes: 647 world, 355 core, 276 host (`/tmp/support-recovery-cleanup-tests.log`); all-target warning-denied shared Clippy passes (`/tmp/support-recovery-cleanup-clippy.log`). The captured-dimension fixture subsequently passed its focused check; its final world Clippy log is `/tmp/support-recovery-captured-clippy.log`.

Passive debug host replay succeeded without movement commands or drive errors (`/tmp/support-recovery-live.json`). Old Bones had 0 airborne samples across 1,004 updates; the player had 0 across 1,067. Complete tick/upsert position samples showed no discontinuity over one metre. Old Bones approached from about 109 m to a minimum of 10 m before moving farther away; this is evidence of supported live movement, not proof of a completed melee approach or the user's specific visual-pop sequence. The first pre-fix capture had Old Bones airborne in 256/511 samples. These are different live trajectories, not a controlled identical-motion benchmark. Temporary probe instrumentation was restored exactly from its fresh backup.

A separate rendered `dev:client` passive-camera capture passed (`/tmp/support-recovery-ui.jsonl`, `/tmp/support-recovery-ui.png`): 208 camera events, 200 animation frames, 40 camera inputs; camera mean/p95 16.08/17.2 ms and animation-frame p95 16.7 ms; no runtime errors. Nearby mobs and the grounded player are visible. This is consistent with the accepted camera baseline but does not substitute for dense-crowd solver-cost measurement. The host was built in debug, sessions disconnected, and no release build or TUI was used.

Architecture notes and source retail-divergence comments now explain full-sphere versus bottom-point terrain rest, the authored recovery bound, and geometric versus timed motion. The resolved support defect is implemented and covered. Still open for the full plan: the remaining performance acceptance comparison at appropriate scope, audit of older unchecked acceptance items against later evidence/current code, and user-visible confirmation of the intermittent pop if it recurs. Do not mark the entire plan/goal complete from these support tests or the screenshot alone. No staging or commit.


### Terrain seam walking interruptions — reproduced and repaired

User feedback identifies regular movement interruptions near polygon edges, uphill most visibly but also downhill and on nearly flat terrain. Added `walking_crosses_joined_slopes_without_stalling_or_losing_support`; the first two-plane case (slope 0.4 to 0.1) stopped at tick 19 before crossing the seam (`/tmp/joined-slope-gate.log`). This was not an animation-only failure: accepted physical forward displacement became zero.

The support-recovery refactor retained a separating-velocity filter in `standing_support_candidate`, shared by walking and airborne acquisition. Velocity tangent to the old polygon can point away from the new polygon's normal, even while walking continuously across joined terrain. The geometry selector rejected that new standing target before the walking caller could sweep the adjustment and transfer support. The previous single-plane slope tests did not exercise that change of normal.

Removed velocity admission from geometric candidate selection. Pure confirmation and preparation-time airborne acquisition explicitly retain their separating-normal checks. Endpoint settlement already distinguishes walking from airborne landing and projects walking velocity onto the accepted support plane; it now receives the geometry needed to do that. Genuine launches/departures remain covered by the existing launch and upward-departure fixtures. No extra query/pass, grace period, tolerance, cap, or persistent state was added.

Expanded the seam regression to 88 cases: 11 incoming/outgoing slope pairs (including flat/flat, nearly flat, uphill, and downhill), four speeds, and axis-aligned versus diagonal approaches. Each case requires positive forward travel and walkable support every admitted tick, then verifies the body crossed the seam. The matrix passes (`/tmp/joined-slope-matrix.log`); shared library tests pass, 648 world + 355 core + 276 host (`/tmp/joined-slope-shared-tests.log`). Final Clippy and normal debug-build logs are `/tmp/joined-slope-clippy.log` and `/tmp/joined-slope-debug-build.log`. This repairs the reproduced seam stall; it is not a claim that every interruption at the user's exact location or the separately reported visual pop has been reproduced. Architecture and source ownership comments are updated. No staging/commit.


### Navigation acceptance consolidation — implemented

**Goal:** stop using the mutable body's `GroundState::Airborne` as an intermediate failure signal between settling and edge protection. Preserve the current navigation behaviors and query budgets; this is not a new grounding model or another solver rewrite. The preceding seam/recovery fixes remain prerequisites and are not replaced by this work.

**Evidence and present flow.** `advance_hard_motion` captures `ProtectedFooting`, calls `advance_hard_candidate`, then calls `protect_edge`. `settle_after_movement` clears body support before querying and leaves it airborne on several unsuccessful paths. `protect_edge` infers candidate failure by reading that state, restores the snapshot, tries a tangent, and may restore again. `try_edge_slide` repeats the same settle/body-state protocol. Retail explicitly uses saved positions, restoration, and precipice-slide alternatives (`acclient.c:301354-301455`); rollback is legitimate. The ownership of candidate acceptance is the issue being consolidated.

**Scope and intended flow.** Keep the private working body and its existing saved-footing snapshot. Do not clone a whole scene or introduce a second persistent body state. Candidate travel may continue to use reversible mutations of that private working body. Ground classification should be committed only once the navigation owner has selected the accepted route:

1. Capture the incoming physical footing and the existing rollback snapshot, where edge policy permits it.
2. Sweep ordinary/corrective travel, including the existing bounded stair alternative.
3. Obtain an explicit settlement result without clearing physical support to communicate failure. Reuse the existing `SettleOutcome`/`SettledSupport` information where possible; extend only for facts needed by a named consumer. Geometric support success and final airborne state after an elastic rebound are not interchangeable.
4. `advance_hard_motion` selects the accepted result: supported candidate; permitted airborne candidate; one edge-tangent alternative; or retained starting footing. It then commits final ground/velocity/path consistency before observation or publication.
5. A rejected candidate restores pose, spheres, membership, velocity, and path length together through the existing snapshot. Successful geometric recovery still produces no timed travel or fabricated landing impact. A real accepted landing retains its impact even if restitution makes its final state airborne.

**Files and subtractions.** Main changes are local to `mobile_contact/step.rs` and `mobile_contact/step/stairs.rs`. Replace `protect_edge`'s post-hoc body-state inference with explicit candidate acceptance owned by `advance_hard_motion`; reshape or remove the helper rather than retain it as another owner. `try_edge_slide` returns its settlement outcome instead of mutating airborne and asking whether it became grounded again. Remove the initial Airborne assignment used only as a provisional flag in settling. Preserve explicit launch state changes, preparation-time support acquisition, and final observational confirmation. Keep snapshot restoration as one mechanism. No new persistent grounded flag, failure counter, coyote timer, grace period, topology cache, or generic transaction framework.

**Required distinctions.** Audit the reachable outcomes before selecting a result type: no grounded policy (free flight); candidate with support; no admissible support; separating airborne motion; optional settle coverage unavailable; ordinary movement coverage unavailable; and accepted landing with rebound. Keep the existing missing-coverage behavior and accepted-prefix rules. Do not collapse a blocked optional route into an accepted departure, or infer a failed route from the final physical Airborne classification. Do not expose these local control results through IPC or the shared authoritative state API.

**Behavior preservation and documentation correction.** Current code captures protected footing for both `HardMovement::Timed` and `HardMovement::Correction` when a grounded body has creature edge protection. The architecture sentence saying corrections bypass this guard is inaccurate. Preserve the implemented protection for both movement provenances; update the note during execution. Launches have already released walkable support and do not acquire this snapshot. Retain the fixed slide/stair/tangent limits, both-sphere hard clearance, support footprints, authored step limits, cell membership, nonexhaustive mobile separation, and braking-only player velocity response. Unsupported movement that the existing policy allows still becomes airborne; rejected movement retains its old supported pose. No floating across gaps by retaining an obsolete plane at a newly accepted position.

**Execution gates.**

- [x] Analytical gate: trace every current early return and every writer of ground/velocity/accepted paths through ordinary, stair, tangent, correction, launch, rebound, and missing coverage. Map each to its explicit candidate result and acceptance owner. Reject a design that needs another persistent mode or changes the query ceiling. Document any behavior mismatch before editing it.
- [x] Consolidate acceptance locally. Keep results and their geometry together; consumers should not reconstruct candidate success from body fields. Make code smaller where the old signaling and restoration wrappers disappear. If a richer result is necessary, justify each variant/field with its actual caller.
- [x] Consolidate route finalization for ordinary travel and the tangent alternative wherever their accepted support/velocity behavior matches. Preserve landing/rebound and timed/corrective provenance differences explicitly; do not duplicate those decisions in the new acceptance owner.
- [x] Fold or remove wrappers whose only purpose was communicating provisional failure through body state. In particular, remove `protect_edge` as a separate acceptance owner rather than retaining a parallel policy path. Reuse `ProtectedFooting`; do not introduce another rollback/transaction object. Record removed mechanisms and the production line-count delta after the cutover.
- [x] Reuse existing conformance fixtures for protected ledges/corners, correction refusal, tangent success, seams, slope recovery, hard tops, launches, restitution, and missing coverage. Add only missing observable assertions: rejected candidate does not leak pose/contact/velocity/report segments; allowed departures do become airborne; real landing/rebound reports survive. Tests should verify accepted behavior rather than assert transient assignment order.
- [x] Run world/core/host library tests, affected all-target warning-denied Clippy, formatting, and debug host build. Compare query sites and loop ceilings before/after; do not begin a new live performance campaign unless this consolidation changes work or the checks reveal a regression.
- [x] Update architecture/source comments and this section with the final tick trace, removed mechanisms, results, and remaining debt. Leave the separate visual-pop/live-route feedback explicitly open unless actually observed and resolved. No staging/commit under this scope.

**Acceptance:** one owner selects the navigation route and its final ground classification; settlement/edge helpers do not write Airborne as a failure signal; one existing rollback snapshot restores rejected alternatives; no extra sweeps or unbounded retries; ordinary and corrective movement retain their actual current protections. Execution is authorized by the resumed implementation goal. The analytical gate precedes production changes.


#### Navigation acceptance analytical gate — return-path inventory

The resumed goal authorizes execution. Added the previously implicit subtraction targets as explicit checklist items: shared route finalization and removal/folding of signaling wrappers.

Current reachable outcomes are narrower than a general transaction framework:

| Producer/path | Existing consequence to preserve | Required explicit result |
| --- | --- | --- |
| Candidate has no grounded policy | Sweep/impact continuation only; no support mutation | No footing change |
| Ordinary sweep loses owner coverage | Retain checked prefix, mark owner unavailable, zero velocity; bypass edge fallback | No footing change, with existing coverage fact retained |
| Optional stair coverage fails | Decline private stair route and continue original sweep | No new outer result; existing bounded alternative |
| Stair succeeds | Commit stair geometry/support/path, skip generic settle | Settled footing |
| Settle finds no reachable support or optional coverage is absent | Previously provisional Airborne, then either protected fallback or accepted departure | Unsupported candidate |
| Airborne velocity separates from selected support | Do not snap or attach | Unsupported candidate |
| Supported walking settles | Transfer plane, constrain velocity, preserve supported timed travel | Settled footing |
| Airborne landing settles, possibly rebounds | Preserve accepted path and landing impact; final physical state may be Airborne | Settled footing carrying final classification |
| Tangent unavailable/zero/blocked | Reject optional alternative and restore saved footing | Unsupported candidate |
| Tangent settles | Accept its geometry and classified response | Settled footing |

The likely minimal local result therefore distinguishes no footing change, unsupported candidate, and settled footing with final `GroundState`. In particular, a real accepted landing ending airborne is not a failed support search. These are ephemeral return values with existing consumers, not new physical states or persistent flags. Keep checked geometry on the existing private working body and restore rejected alternatives through its single saved-footing snapshot.

`ProtectedFooting` already restores root, spheres, contact membership, retained velocity, ground/config, and path length. Grounded paths do not carry free-flight kinematic velocity, so no additional snapshot field is justified for that value. Tangent attempts perform no orientation mutation. The acceptance owner can continue to reduce timed travel only after route selection, and corrective paths can retain the existing final conversion to geometric adjustments. This avoids a new path collection or duplicated finalization stage.


#### Navigation acceptance cutover and validation

Implemented `NavigationFooting::{Unchanged, Unsupported, Settled(GroundState)}` as a private candidate result. Ordinary/stair/tangent routes return it; `advance_hard_motion` alone selects the accepted route and commits its ground classification. Removed `protect_edge`; its acceptance branch now lives in that owner, and its restoration/tangent preparation shares the existing `ProtectedFooting`. Removed settling's provisional Airborne assignment and the tangent helper's success inference from mutable body state. Accepted landing/rebound remains distinct from an unsupported candidate. Snapshot restoration is unchanged and remains the only rollback mechanism.

Ordinary and tangent candidates share the settlement/impact logic, then the accepted route shares velocity normalization and timed-versus-corrective path finalization in `advance_hard_motion`. No second finalizer, persistent field, generic transaction object, or path collection was introduced. The production diff against fresh pre-cutover copies is -28 lines in `stairs.rs` and +16 in `step.rs`, net -12 lines. Sweep call sites are unchanged (five in stairs, three including the shared helper declaration in step); support-query call sites and slide/stair/tangent limits are unchanged. This structural review, not raw call-site counts alone, establishes no additional route or retry. No new live performance run is warranted for this consolidation.

Extended existing observable regressions: the protected-ledge correction fixture now checks that rejected correction paths cannot leak into reporting; the authored-restitution landing fixture requires an impact event on the first rebound while final state is Airborne. Full world suite passes after these assertions, 648 tests (`/tmp/navigation-acceptance-final-world.log`); shared consumers pass, 355 core and 276 host (`/tmp/navigation-acceptance-consumers.log`). Shared all-target warning-denied Clippy and debug build pass (`/tmp/navigation-acceptance-clippy.log`, `/tmp/navigation-acceptance-debug-build.log`). Final test-only world Clippy is `/tmp/navigation-acceptance-final-clippy.log`. Architecture notes now accurately state that protected grounded corrections share the walking edge guard; launched bodies do not.

The scoped consolidation is complete without an intentional behavior change. Existing seam, recovery, hard-top, launch, rebound, coverage, edge-tangent, and crowd checks remain green. The whole-plan completion audit and user-visible confirmation of the earlier intermittent pop/exact terrain route remain separate open work; do not infer their completion from this refactor. No staging or commit.


### Current completion audit — structural work verified, live recurrence feedback pending

Re-read the current implementation and inspected stored evidence rather than treating unchecked historical boxes or adjacent green tests as authoritative. Previous turn classification: progress (navigation acceptance cutover and its verification). Current turn: completion audit plus current debug benchmark.

| Requirement / historical checklist | Evidence inspected | Current conclusion |
| --- | --- | --- |
| Prepared body roles and content distribution (old support-integration census gate) | `/tmp/contact-classification-census.log` exists and records 43,913 templates / 3,909 setups; later classification steering and current frozen/static/authored-obstacle tests | Census completed; its initial-template scope excludes arbitrary later server overrides. Historical combined census/live checkbox stays open only for its live component. |
| Bounded mobile contact, wall/corner response, fixed per-tick correction allowance | Current `step.rs` uses query-free tentative passes with one remaining allowance per body, then one aggregate hard correction, with residual-overlap concession at commit; wall/corner/escape tests in current 648-world run | Structural gate complete; no feedback solve or recursive body propagation. |
| Support, ledges, hard tops, stairs, launches, restitution | Current seam matrix, recovery, upper-cell transit, protected ledge, supported launch, and landing/rebound fixtures; `/tmp/navigation-acceptance-final-world.log` | Automated contracts pass. Recent exact-route user feedback remains an observational acceptance item. |
| Common collection/direct/prediction kernel | `scene/contact_collection.rs` and direct scene advancement call the contact collection adapter; `mobile_contact/step/collection.rs` delegates to `advance_body_contacts`; prediction reaches the same direct physical advancement | Cutover complete; standalone diagnostic grounded primitives are not a selectable production legacy mode. |
| Reference return, one-shot effects, sleeping bodies, flight retirement | Current collection fixtures for reference return, authored input/reactivation, sleeping-body correction, one-shot launch, and flight retirement; retained `/tmp/contact-return-parsed.json` evidence exists | Automated contracts and earlier live gradual return established; no authority snap was added for mobile corrections. |
| Accepted-only reporting and topology | Current upper-only recovery path fixture, clipped-body membership, report-shape/trigger tests, rejected-ledge empty path assertion, and earlier segment-local reporting review | Accepted path/report contract passes; no provisional path is published. |
| Maintainability and vocabulary | Earlier bounded whole-diff body/camera/animation review, current final navigation trace, absence of removed pressure-driver/push-group/dynamic-contact production vocabulary; navigation consolidation net -12 lines | Current support changes preserve the simpler tick shape. No new persistent physics mode, recovery clock, or rollback framework. |
| Frontend animation/publication | Stored `/tmp/contact-feedback-app-tests.log` contains 273 files / 2,122 passing tests; app check/lint and focused retiming evidence exist. Subsequent changes are Rust support/navigation with unchanged IPC shapes | Prior frontend evidence remains applicable to unchanged frontend code; it does not prove the intermittent visual pop is gone. |
| Current library/lint/build verification | 648 world, 355 core, 276 host; `/tmp/navigation-acceptance-final-world.log`, `/tmp/navigation-acceptance-consumers.log`, shared and final world Clippy logs, normal debug build log | Pass. |
| Performance | Existing manual asset-free debug benchmark re-run sequentially with `physics-profiling`: `/tmp/navigation-final-crowd-benchmark.log`; current rendered `/tmp/support-recovery-ui.jsonl`; earlier authored Olthoi capture retained | Current 45-body swarm p95 3.326–3.356 ms, pinned 1.753–1.770 ms, corner 0.546–0.556 ms; all conformance assertions pass. Prior historical same-workload gate was p95 <30 ms. Workload/implementation differs from older captures; no controlled speedup claim. Rendered camera mean/p95 16.08/17.2 ms and frame p95 16.7 ms. This is not a fresh 85-actor authored dungeon timing measurement. User already accepted performance before the support refinements. |
| Required live outcome | User reported seam interruptions after earlier recovery; the new seam fixture reproduced and fixed a concrete stop. Automated live capture had no large pose jump but did not reproduce the reported visual sequence. | **Passed by subsequent user playtest:** terrain-edge movement and approaching-mob falling/pop scenarios now look good. New overlap, stopping, and remote drift feedback is investigated below. |

Older live dungeon boxes at the previous kernel/support phases are historical precursors of this final live acceptance item, not instructions to repeatedly teleport the character back to a dungeon after the user has supplied a newer outdoor recurrence. Their recorded dungeon/camera observations and the user's performance acceptance remain evidence; recent defects are tracked at their reported scope. Do not mark the whole goal complete until the remaining acceptance is resolved. Do not add another broad profiling campaign merely to close stale checkboxes.

Current user-eyes request is informational, not permission to edit. Further implementation should respond to concrete remaining defects or audit findings; code changes are not justified solely by the unanswered playtest question. No temporary probe source remains, no release build/TUI was run, and no staging/commit was performed.


### Follow-up playtest — support accepted; overlap, stopping, and remote drift investigation

User confirmed the requested terrain-edge and approaching-mob falling/pop scenarios now look good. This closes the previous user-eyes blocker. They separately report slight player displacement by mobs, sliding after movement ends for all characters, and remote bodies becoming far displaced during sustained movement. These are new follow-up findings, not evidence that the support acceptance failed.

Constraints retained: hard geometry/support and query budgets remain unchanged; mobile contacts need not be exhaustive; overlap may geometrically displace the player but peers must not inject player momentum; actual body and independent reference remain distinct. Investigate before changing tuning or adding recovery policy.

**Overlap:** `mobile_contact.rs::resolve_mobile_contact` uses `ContactMobility::PLAYER = 1.0` and `MOBILE = 1.0` for positional shares, independently of `ContactVelocityResponse::BrakingOnly`. A stationary player therefore receives half the pair's requested separation before per-body allowances and hard admission. Repeated arrivals can displace it without imparting velocity. Lowering player mobility would bias separation toward peers, but also changes shared normal-speed calculation when the player approaches; it is not a position-only tuning change. Proposed direction: use the existing relative-weight knob first if that tradeoff is acceptable; retain finite player response for trapped overlaps. No value changed during investigation.

**Stopping:** client manual input supplies authored movement; once that sequence no longer contributes motion, `BodyProjectionResolver::resolve_authored_offset` returns None. `local_player_actuation` without autonomous drive then supplies `GroundedBodyActuation::coast`; the remote adapter also supplies coast absent authored motion. The actual motor's running velocity is retained and decays through authored friction. Existing `grounded_motor_reaches_its_target_and_release_uses_authored_drag` explicitly enshrines this behavior. Friction math matches ACE `PhysicsObj.cs:2120-2141` and retail `acclient.c:304541` (generic physical velocity drag), but this does not establish that retaining locomotion motor speed on controller release matches retail locomotion. Proposed direction: represent a stationary character command explicitly and brake with the existing motor; retain generic coasting for actual ballistic/passive/sledding motion. Do not globally increase friction or add a stop timer. Controller stop ownership versus passive physics must be scoped before implementation, including waking/settling and server vector admission.

**Proven reference recurrence bug:** `PhysicalBodyInput::return_step` calls `predict_reference_motion` with the latest immutable authoritative vectors on every tick. Grounded/no-authored/coasting prediction applies one tick of friction to that original velocity, and `PhysicalCorrection::advance_reference` accumulates the resulting travel. The decayed velocity is not retained as next tick's nominal input. Supported return then drives the actual body toward that perpetually moving reference. Nonzero samples persist until a new vector or a position update with contact clears them (`state/mutations.rs:763-770,1017-1043`). This is not actual separation leaking into velocity; nominal continuation itself fails to decay over elapsed time.

A temporary asset-free production collection fixture, `diagnostic_stop_and_nominal_coast_recurrence`, ran a grounded body at initial 8 m/s, flat terrain, no authored travel, 90 admitted ticks. Without reference: travel/speed at ticks 15,30,90 were 1.972m/1.789m/s, 2.412m/0.400m/s, 2.462m/0. With contact-return capture and unchanged authoritative velocity 8 m/s: 3.623m/7.240m/s, 7.243m/7.240m/s, 21.722m/7.240m/s. Debug test passed and output is in `/tmp/motion-stop-recurrence.log`; diagnostic source was restored from a fresh backup. No production changes. This proves the recurrence under a reachable input contract; no claim that every reported live divergence has been attributed to it.

Proposed repair boundary: the independent reference predictor must own cumulative nominal continuation (or derive it from elapsed time since its authoritative sample), with packet updates reseeding that prediction. Actual contact/motor velocity must never seed it. Merely reducing correction speed, capping distance, or changing friction conceals the error. First check whether the reference can use an existing prediction owner instead of adding parallel clocks/fields. Stationary authored control must remain distinct from passive-vector continuation, so stop behavior and reference prediction should be scoped together. Preserve no-snap mobile reconciliation and ordinary animation/action priority.

Follow-up acceptance: finite player displacement biased toward peers without transferred momentum; predictable character braking after release; a single nominal vector decays cumulatively across ticks without repeated re-seeding; explicit fresh vector updates reseed exactly once; stationary authority and continued authored motion remain independent; launches, passive flight, sliding, sleep/reactivation, hard geometry, and return after contact remain valid. Obtain focused production regressions for these contracts before another broad live run. No staging or commit.


### Scoped follow-up fixes — proposed implementation boundary

This scope covers three reported behaviors, not another solver rewrite. No production changes are made by this scoping step.

1. **Make character stopping an explicit command.** Preparation must distinguish a character requesting zero ordinary travel from a passive body coasting. An idle, installed character motion sequence must not lose that fact merely because `contributes_motion()` is false. Carry this distinction once through local/manual, autonomous, and remote motion preparation into the existing grounded actuation. Preserve authored actions, one-shot launches, passive vectors, sledding, and actual airborne motion. Reuse the existing driven/coasting distinction rather than add a second stop state or timer. Update wake/settle eligibility so an explicit zero target can brake a moving body and then sleep; a permanent zero command must not keep every idle character active forever.

   Add independently tunable supported motor braking rather than increasing global friction or the existing 20 m/s² acceleration. Proposed initial braking is 80 m/s²: at 8 m/s it stops in about 0.1 s, versus 0.4 s at the current motor limit. The discrete fixture must measure actual travel; do not promise a continuous-math distance. Define braking for speed reduction/reversal before implementation, including return bias, so correction cannot accidentally bypass or disable stopping. One motor owner integrates the final requested velocity; no post-solve velocity wipe. Existing passive friction remains unchanged. This is deliberately more responsive character control, not a claim of exact retail locomotion.

2. **Advance nominal velocity cumulatively.** The physical simulation needs independent nominal continuation seeded at authoritative admission and advanced once per admitted tick. The current per-tick `PhysicalReferenceInput.vectors` snapshot must stop serving as an implicit re-seed. Consolidate this into physical runtime ownership; remove the redundant tick producer plumbing wherever the scene already receives authoritative vector updates. Keep ordinary authored offset input independent and preserve free-flight's physical-versus-kinematic distinction.

   Lifecycle acceptance is mandatory before code: initialization/reset seeds nominal state; an explicit fresh vector replaces it exactly once even when numerically identical to the previous packet; a pose-only retarget does not masquerade as a fresh velocity sample; a contact-bearing position sample that clears velocity must clear nominal continuation; routine pose correction preserves actual contact momentum under the existing policy. Nominal state must survive correction completion and subsequent contact-return capture. Storing it only inside `PhysicalCorrection` would replay old packets on recapture and is rejected. Do not seed nominal continuation from actual retained velocity or accepted-motion observations. Shared authoritative entry points already exist in `scene.rs`; make freshness explicit there if their current argument shape conflates carried vectors with replacements.

   The analytical gate must specify whether authored locomotion replaces nominal drive or composes with passive momentum in each existing response mode, and what a stationary command does to each. Do not accidentally convert a launch/vector edge into a persistent command, or erase projectile acceleration. No second collision solve, wall-clock catch-up, correction distance cap, or faster chase motor. State advancement uses the existing admitted physical interval. Nominal heading remains independently owned; test sustained turning as well as straight travel so a velocity fix does not leave a frame mismatch hidden.

3. **Bias overlap separation toward peers.** Proposed first tuning: `ContactMobility::PLAYER = 0.1`, ordinary mobile = 1.0, with player `BrakingOnly` unchanged. This assigns about 9% of an unconstrained pair's requested separation to the player, versus 50% today. The existing shared mobility also strengthens player-initiated pushing; document and test this tradeoff rather than silently describe the knob as position-only. Keep finite player mobility, tolerance, travel allowances, and hard-correction admission. If this makes pushing too easy again, stop for the user's preference before introducing separate positional/velocity weight knobs. Crowds or hard-blocked peers can still cause residual overlap and some player displacement; absolute player immobility is not promised.

**Affected ownership:** shared physical input/state, nominal prediction, authoritative scene admission, and grounded motor integration in `holtburger-world`; character command sampling in `holtburger-core/client/simulation.rs` and world motion resolution, plus the Explorer host's corresponding input adapter where its shared contract changes. The kernel contact/sweep schedule, geometry, support, camera, IPC publication, and animation playback remain consumers of the same accepted body result. No new presentation correction lane.

**Subtractions:** remove per-tick packet-vector replay as prediction input; remove idle-character fallthrough to generic coasting; replace the old test that enshrines release-as-drag with separate character-braking and passive-drag contracts. Preserve generic coasting, actual/nominal separation, and ordinary/action animation priority because those represent different required behaviors. Do not add a second motor, correction timer, or stop flag alongside driven/coasting.

**Gates and completion:**

- [x] Analytical gate: map initialization, pose-only update, velocity replacement/clear, authored start/stop/turn, launch, correction completion/recapture, sleep/wake, and reset to their owners. Verify each retained field has a production consumer and each packet edge acts once. Stop if the design requires reconstructing packet freshness from value equality or contact response.
- [x] Add focused production-path regressions: release from several speeds reaches stable rest with bounded travel; passive drag remains cumulative; a single nonzero nominal vector decays over multiple ticks; an identical fresh vector legitimately reseeds; pose-only updates do not re-seed; correction recapture cannot resurrect old motion; stationary authority, sustained authored turning, flight, launch, and sleep/reactivation retain their contracts. Replace temporary diagnostic prints with behavioral assertions.
- [x] Implement stopping and nominal continuation as one coherent cutover, update affected consumers, and review the body tick and authority event paths for duplicated integration or decisions.
- [x] Apply the separately reviewable mobility tuning; verify incoming peers cannot impart player momentum and unconstrained positional shares follow the runtime weights. Keep wall/corner residual-overlap concessions explicit.
- [x] Run world/core/host library tests, affected warning-denied Clippy, formatting, and debug build. Run frontend checks only if affected contracts reach that boundary. Query counts and loop ceilings must remain unchanged.
- [x] Focused debug live acceptance: character release is responsive without animation freezing; mobs/players remain near their intended motion across repeated start/stop/turn and authority updates; contacts can displace peers without sustained player momentum. Recheck the already accepted terrain route briefly, without restarting a broad geometry/performance campaign. Respect server cooldown and settle time if logging in. **Closure:** Accepted by the user after the post-fix crowded playtest.

Tuning values above are now implemented defaults; the stronger pushing feel still needs user acceptance. Later accepted stop and horizontal-return concessions supersede the original preservation requirements where explicitly recorded below. Remaining attribution debt: the synthetic nominal recurrence is proven, but no capture yet establishes that it explains every reported remote drift. If substantial divergence survives the fix, compare nominal reference, accepted body, server target, and rendered pose before changing another layer.


#### Follow-up analytical gate — authoritative lifecycle mapped; stop policy decision pending

The resumed implementation turn completed source-level tracing, not a production cutover. The previous scoping turn was progress (updated authoritative plan); this turn adds lifecycle evidence and identifies an unresolved observable behavior choice.

`SpatialScene::apply_authoritative_body_effect` receives vectors even for pose-only retargets, but deliberately preserves actual continuation for mobile Interpolate/Snap and local Confirm. `apply_authoritative_body_vectors` is the explicit replacement edge and wakes the body. Position packet handling in `state/mutations.rs` knows whether velocity was actually present or was cleared by HAS_CONTACT, but currently updates the entity snapshot and emits a vector event after applying the pose effect. The nominal cutover must carry that presence/clear fact directly into scene admission rather than infer it from numeric values or per-tick entity snapshots. Initialization and explicit dynamic kinematic replacement/reset also require nominal seeding/reset. Physical-definition refresh must preserve existing nominal continuation rather than reseed from collision-modified retained velocity. Pose-only consumers do not need another nominal integrator.

Correction lifetime is shorter than physical lifetime: `finish_physical_tick` can retire `PhysicalCorrection`; `begin_contact_return` can capture again on a later prepared tick. Nominal continuation therefore cannot be an optional correction-only field. The existing pose/reference distinction remains useful; no extra collision path is needed. Advancing a nominal state must not by itself make every resting body perpetually active.

**Stop-policy gap:** the proposed scope promises both rapid locomotion braking and preserved passive velocity behavior, but the current grounded motor stores both in `body.retained.velocity`. `contact_step_input` drives that same velocity from authored motion; explicit vector admission replaces it. A stationary driven target with 80 m/s² braking would also rapidly brake an external horizontal vector on an idle supported character. This differs from preserving its generic authored-friction decay. Changing an epsilon or using packet recency to guess its origin is rejected.

ACE confirms the underlying semantic distinction: `PhysicsObj.UpdatePositionInternal` composes authored `PartArray` travel before `UpdatePhysicsInternal` integrates independent Velocity, and `calc_friction` damps the latter (`PhysicsObj.cs:1815-1890,2120-2141`). Our existing `motion/actuation.rs` also cites retail's distinction between cached observed travel and physical velocity (`acclient.c:306094-306172,310862-310927`). These references justify distinguishing the requirements; they do not require adopting ACE's architecture.

Two coherent options: (A) accept that idle grounded characters quickly brake all horizontal motion through the current single-velocity motor; keep launch/airborne, generic passive objects, projectiles and sledding outside that character stop policy; or (B) preserve passive continuation separately and brake locomotion relative to it, explicitly defining composition with reference return. Option B can potentially reuse the nominal state already needed for drift, but its actual/contact response semantics still need analytical design; do not assert that a second complete solver or a second actual velocity field is necessarily required. Option A is recommended for the user's stated preference for simpler, responsive approximate character physics. It is a deliberate concession, not yet accepted.

An async behavior question was submitted. Implementation is paused at this safe point under the user's instruction to stop for a consequential decision. No production tuning or code changed, no tests left modified, and no staging/commit. The proven nominal recurrence remains actionable after this choice; no broader live evidence run is needed to establish it again.


#### Stop policy accepted

User accepted option A: idle supported characters brake horizontal motion regardless of its source. Keep one actual velocity. This supersedes preserving generic passive sliding for idle stable characters; airborne motion, launches, projectiles, generic passive objects, and sledding retain their distinct policies. No separate actual locomotion/passive components are required. Implementation resumes with that concession.


#### Stopping and overlap-bias cutover — implemented; nominal lifetime work remains

Implemented the accepted single-velocity concession through existing preparation facts. `GroundedBodyActuation::resolved_supported_motion` uses the already-prepared Character role and Stable surface policy to resolve absent ordinary travel as Driven(zero). Actual actuation and reference prediction consume the same rule. Authored offsets and explicit controller targets still override ordinary motion; launches and airborne admission remain separate. Passive obstacles and sledding retain coasting. The original Coast input continues to permit settling, so no new persistent idle flag, per-tick command field, or wake mechanism was added.

The motor now has `MOBILE_CONTACT_MOVEMENT_BRAKING = 80 m/s²`, independently of acceleration 20 m/s². Along the requested tangent velocity change it brakes until speed stops decreasing, then spends any remaining interval accelerating. Reversal cannot use the braking rate to accelerate away, and neither phase overshoots the target. The same motor integrates authority-return targets. Player mobility is now 0.1 versus mobile 1.0, with BrakingOnly unchanged. The stronger pushing tradeoff is retained explicitly for live acceptance.

Added a local/remote × character/passive × three-speed production collection fixture using explicit authoritative velocity replacement. Characters reach exact rest at the discrete braking distance and enter settled activity; passive bodies continue damping. A focused motor fixture covers stopping, reversal, and ordinary acceleration. Updated existing braking expectations to the new runtime constant, including clamping at zero, and renamed the old release-as-drag test. Existing tests asserting an acceleration-only bound now allow the larger braking bound where reversal is exercised. No test pins a tunable numeric value.

The first world run exposed three expected old-braking assertions and a stair/crowd progress regression with the intermediate equal-mobility configuration. Applying the separately scoped 0.1 player mobility restored the existing stair-progress gate; no stair logic or progress threshold was changed. All 650 world tests now pass (`/tmp/character-braking-world.log`). Core/host library tests pass (`/tmp/character-braking-consumers.log`); affected all-target Clippy with warnings denied passes (`/tmp/character-braking-clippy.log`). Architecture and source retail-concession comments updated. Normal debug host build passes (`/tmp/character-braking-debug-build.log`); formatting and diff checks pass.

The shared idle rule also makes supported stationary characters predict zero nominal travel, removing the demonstrated perpetual coast target in that state. **This does not close nominal prediction:** airborne and passive continuation still replay sampled vectors rather than retaining cumulative nominal state. The next slice must implement the mapped authoritative lifecycle, preserve state beyond correction completion, and remove repeated packet-vector input from production tick preparation. Do not claim the entire drift fix or live movement acceptance from these green stopping tests. No live login, staging, or commit during this slice.


#### Nominal continuation cutover — cumulative state and supported-plane consistency

Added body-owned nominal vectors, independent of actual retained/contact velocity. Initialization, explicit vector replacement, dynamic kinematic replacement, and relocation/reset seed or clear them. They survive physical-definition changes and correction retirement. Collection and direct physical tick paths publish evolved nominal velocity only with accepted body state; a failed transaction cannot partially advance it. Autonomous input keeps its nominal state unchanged. Pose-only bodies retain authoritative nominal input for possible later physical admission without running a second projection integrator.

Removed vector snapshots from `PhysicalReferenceInput` and all production tick producers. Tick input now carries authored travel only; actual and return construction obtain physical definition, pose, actual acceleration, and nominal input from one coherent body rather than separately supplied overlapping arguments. Friction and acceleration operate on the previous nominal value each tick. Nominal coasting uses the same canonical-rest floor as physical coasting so return cannot preserve infinitesimal motion indefinitely.

Position-packet admission now forwards explicit vector presence or contact-driven clearing into a nominal-only scene replacement. It does not erase contact-modified actual momentum. The packet edge is not inferred from value inequality: repeated HAS_CONTACT clears nominal continuation even if the cached entity velocity was already zero. Pose-only retargets leave nominal velocity intact; an explicit identical vector update legitimately reseeds it. Existing non-contact packet rejection/sequence-only semantics remain unchanged.

Added regressions for cumulative free acceleration; passive decay through correction completion and recapture; pose-only retarget without velocity replay; identical fresh-vector reseeding; and repeated contact clearing. `/tmp/nominal-regressions.log` and `/tmp/nominal-contact-clear.log` pass. The shared library run before the additional slope fixture passed world 652/core 355/host 276 (`/tmp/nominal-shared-tests.log`); affected all-target warning-denied Clippy passed (`/tmp/nominal-clippy.log`). Final post-slope checks are recorded separately below.

The analytical trace found a second concrete nominal/actual disagreement: actual supported drive is tangent-projected, while nominal drive remained horizontal. A new unobstructed ±0.6/flat slope fixture failed on its first tick with nominal (8,0,0) versus actual (5.882353,0,-3.529412), without peers or obstacles (`/tmp/nominal-slope-gate.log`). Nominal drive now uses the same already-prepared support plane and drops authored vertical drive under the same grounded convention; launch retains outward velocity. The fixture runs 120 ticks per slope, requires nominal/actual agreement and correction retirement, and passes (`/tmp/nominal-slope-fixed.log`). No new support query, sweep, retry, or geometric tolerance.

Remaining lifecycle review before declaring the follow-up finished: remote launch inference still reads positive retained Z from a grounded body instead of an explicit fresh-vector edge; inspect its interaction with supported slope travel and animation contact publication before changing that boundary. Also audit reference completion across geometric vertical adjustments (stairs/landing) and sustained authored turning. Current passing flat/slope continuation checks do not establish those cases. No claim that every reported live drift is resolved; focused live acceptance remains after these gates. No staging or commit.

Final verification for this nominal/slope slice: world 653, core 355, host 276 library tests pass (`/tmp/nominal-final-shared-tests.log`); affected all-target Clippy with warnings denied passes (`/tmp/nominal-final-clippy.log`); normal debug host build passes (`/tmp/nominal-final-debug-build.log`). Formatting and diff checks pass. No running test/build/probe remains. This goal turn is progress; the remaining lifecycle/vertical/turning gates above and focused live acceptance remain open.


#### Vertical reference gate — reproducible height-only correction; policy decision pending

The prior goal turn was progress (cumulative nominal/slope cutover and verification). This turn exercised the remaining stair/reference contract with a temporary production collection fixture, rather than infer success from unrelated stair geometry tests. A remote character walks over the existing two 0.3 m BSP steps for 45 ticks at requested 5 m/s, then requests zero travel through tick 300. The body correctly reaches the upper floor and the target's horizontal location, but reconciliation never retires: reference (96.999886,96,0.004999995), accepted body (96.99994,96,0.605). Trace: `/tmp/reference-stair-gate.log`. Retained horizontal velocity remains a tiny nonzero correction (~0.0001068 m/s) because the full 3D completion threshold cannot be reached. The first diagnostic assertion caught that residual velocity; the second run tested and printed the surviving reference directly.

Root cause: hard navigation's accepted step-up is geometric travel, not nominal motor velocity. The reference does not perform navigation, so it retains the old height. Grounded return projects reference error into a support tangent while completion requires full 3D proximity. On a flat upper floor the vertical error is uncorrectable; on a slope a height-only error can also project into unwanted horizontal steering. The previous slope fix aligns ordinary nominal/actual velocity but cannot account for discrete geometric height changes.

Recommended coherent policy: grounded-character return controls horizontal position; navigation/support owns height. Apply the same domain to steering error and completion, preserve full 3D return for free-flight bodies, and preserve airborne force/launch behavior. Do not merely loosen a completion epsilon or add a stair-specific reference adjustment. Observable concession: a wrong-floor placement at the same horizontal coordinates is not repaired by this grounded return mechanism. Explicit reset/teleport remains a different boundary. Preserving height as an actual correction goal would require scoped vertical recovery/navigation semantics beyond the existing tangent motor.

An async policy question was submitted; no answer is assumed. Implementation stops at this analytical gate under the user's stop-for-consequential-decisions instruction. The diagnostic fixture is preserved in `/tmp/reference-stair-gate-with-fixture.rs`; its test source was restored exactly from the fresh `/tmp/reference-stair-gate-before.rs` backup so the retained worktree remains at the previously verified cutover. No behavior change, live login, or commit in this gate turn. The prior 653 world / 355 core / 276 host and lint/build evidence remains applicable to unchanged production code. Launch-edge and sustained-turning review still follow this decision; the goal is not complete.


#### Horizontal grounded return accepted and implemented

User accepted horizontal-only grounded return after clarification: the body still descends stairs through ordinary support/navigation; the concession is an overlapping solid floor at the same horizontal location, not suspension in open air. Grounded response now uses `PhysicalReferenceDomain::Horizontal`, while free-flight retains Spatial. The response-derived domain projects steering error and completion distance/relative velocity consistently. It is a stateless policy value, not new retained physics state. Position completion preserves the existing local-coordinate distance behavior. Ordinary nominal slope travel remains tangent-consistent; this change removes stale-height steering, not ordinary supported vertical travel.

The formerly failing stair fixture is now a retained regression and includes a return to the lower floor. The body climbs the two 0.3 m steps, stops and retires its reference, receives a target at the original lower-floor position, and walks back down through the production collection. It finishes supported at the lower floor, within the existing completion threshold, with no pending correction (`/tmp/horizontal-stair-roundtrip.log`). This tests return navigation from the elevated state; existing corrective-navigation fixtures separately exercise upward mobile-contact admission. It is not a claim of a captured live mob-push round trip.

Added a domain-completion test preserving full-height correction for Spatial bodies while Horizontal ignores height. Source carries the accepted retail divergence and coverage limit. Final shared tests/lint/build follow; launch-edge and sustained-turning review and focused live acceptance remain open. The previous height-policy blocker is resolved. No staging or commit.

Horizontal-return verification: world 655 / core 355 / host 276 library tests pass (`/tmp/horizontal-return-shared-tests.log`); affected all-target Clippy with warnings denied passes (`/tmp/horizontal-return-clippy.log`); normal debug host build passes (`/tmp/horizontal-return-debug-build.log`). The first full run identified one old test requiring a height-only correction to remain active; it now verifies the accepted same-XY/different-floor concession while retaining ballistic-momentum and floor-support assertions. Formatting and diff checks pass. All test/build sessions are terminal.

Launch trace reference for the next slice: retail `CPhysicsObj::set_velocity` sets `jumped_this_frame` at vector replacement (`acclient.c:306874-306903`), and ACE `PhysicsObj.cs:3966-3986` mirrors that event-owned latch. Our remote adapter instead infers launch from grounded plus retained Z > 0 each tick; tangent uphill velocity can satisfy that condition without a fresh vector. Fixing this must preserve one-shot publication and animation contact transitions, rather than moving an unobserved ground-state mutation into packet handling. No launch behavior changed in this turn.


#### Observer departure and sustained-turning gates — closed without another state flag

Removed the remote adapter's repeated inference that Grounded plus positive retained world Z means a new launch. Uphill tangent motion also meets that condition. Existing support preparation already releases support for genuine outward observer velocity; packet admission need not mutate published contact or add an event latch. A trial pending-launch bit was unnecessary and was removed before retaining the cutover. Local controller launch admission is unchanged. The retail set-velocity latch cited above helped identify the distinction but does not require reproducing its architecture.

`observer_vector_departure_is_published_and_survives_a_vetoed_tick` exercises explicit upward vector admission, unchanged contact before solving, a rejected transaction with an unchanged canonical body, accepted Grounded-to-Airborne publication, and eventual supported rest. A newer zero vector before the next tick cancels the upward sample normally. The test does not require a remote departure to masquerade as a committed local controller launch.

`sustained_authored_turning_keeps_nominal_and_actual_motion_aligned` runs 180 moving/turning ticks followed by 60 idle ticks. Actual and nominal velocity remain aligned without accumulating correction work; the body finishes at rest and settles. Together with the slope and stair round-trip fixtures, this closes the remaining analytical lifecycle gates for this follow-up. It does not establish all live remote drift is resolved.

Final shared library verification passes: world 657 / core 355 / host 276 (`/tmp/observer-final-shared.log`). Affected all-target warning-denied Clippy and normal debug host build pass (`/tmp/observer-final-clippy.log`, `/tmp/observer-final-debug-build.log`); formatting and diff checks pass. Cargo still reports the dependency `binrw 0.15.1` future-incompatibility advisory; no affected-code lint failed. Electron main compilation passes (`/tmp/movement-final-electron-build.log`). No new support queries, sweeps, retries, or retained launch fields were introduced. Focused live acceptance follows; no staging or commit.


#### Focused debug live check — local stopping/landing passed; remote playtest remains

The headless production-host movement probe completed with the normal debug binary and this worktree's account (`/tmp/movement-final-live.json`). The sandbox first rejected socket startup before login; the authorized rerun entered successfully, waited five seconds before driving, and disconnected normally. No teleport command was sent. Temporary probe sampling was written to a separate file and removed after the run; the existing probe source was untouched.

All six drive phases sampled only grounded player contact. The fully idle one-second phase had zero displacement. Turning after releasing forward travel moved 0.483 m overall, with 0.040 m of sampled travel after the first 250 ms; this is a mixed turning/geometry route, not a controlled braking-distance measurement. The jump observed Airborne then Grounded and finished with zero late vertical range. No drive errors or presentation discontinuities; drive command latency was 0.56–0.81 ms. These are host observations, not proof of rendered animation quality.

Several commanded travel phases accepted little or zero translation; the route was not a free-space locomotion benchmark and this capture alone does not attribute the blocked movement. No moving remote character appeared in the census, so the run cannot close mob drift, remote stopping, or the stronger pushing-feel acceptance. Do not repeat logins or add another broad campaign merely to claim those outcomes. The focused user playtest remains: crowded movement/stop/turn, whether idle mobs or other players still drift, whether peers nudge the player less, and whether player-initiated pushing is now too easy. Existing support route acceptance remains intact; no new terrain defect was demonstrated here.

The implemented stopping/nominal/overlap follow-up has passed automated acceptance and this limited local runtime check. Its remaining live/visual acceptance is explicitly open. No staging or commit, and no running build/test/probe remains.


#### Panumbris Shadow live recurrence — direction mismatch reproduced analytically

User reproduced extended backward-looking travel followed by a pop while the debug client was captured continuously. Actor Panumbris Shadow, GUID 0x80000343: `/tmp/mob-slide-events.jsonl`, extracted `/tmp/panumbris-samples.json`. Landblock-aware distances grew from 3.76 m at +49.01 s to 89.49 m at +74.99 s; a 92.16 m single published position change occurred at +88.852 s, followed by proximity of 1.14 m at +90.23 s. The actor remained grounded during the runaway interval. This closes the previous missing-recurrence/user-eyes gap and contradicts full remote-drift acceptance. Published animation rates often became negative, consistent with observed backward travel; presentation alone does not reveal the input that caused it. Capture contains host publication, not raw authority packets or internal nominal state, so the pop's precise admission edge remains unattributed.

Source trace exposes a concrete heading contract defect. Position admission requests keep_heading for MoveTo. Physical correction nevertheless retains the packet's rotation as its independent reference frame. Pursuit decisions use actual body pose; ordinary actual actuation transforms authored travel by actual heading, while nominal prediction transforms the same travel by reference heading. Supported return then replaces actual requested drive with that nominal velocity plus bounded correction. Thus an explicitly ignored packet heading can still reverse translation without reversing the visible body.

A temporary production collection fixture admits a same-position, opposite-heading Interpolate with keep_heading=true, while the body faces +Y and requests forward 2 m/s. The next tick produced nominal Y=-2 m/s, actual Y=-0.16666675 m/s, and unchanged identity facing. The expected forward-motion assertion failed (`/tmp/panumbris-heading-gate.log`). No contacts, terrain seams, airborne state, or animation feedback were needed. The diagnostic fixture is preserved in `/tmp/panumbris-heading-with-fixture.rs`; the test source was restored from its fresh `/tmp/panumbris-heading-before.rs` backup. No production behavior changed.

Next scope: consolidate heading ownership for ordinary motion and reference return, especially keep-heading packet admission and pursuit/controller-generated turning. Do not add friction, a timeout, a distance cap, or another recovery state. The fixture proves a reachable defect consistent with the observed episode; exact packet attribution in this live episode still requires authority/reference evidence. Capture/client remain running for the user's session. No commit.


#### Scoped Panumbris fix — one grounded movement frame

Scope requested after the failing heading fixture. This section is a proposal, not an implemented behavior change. Use the planning skill's analytical-first gates and the existing plan; no new plan document or broad solver rewrite.

**Contract:** a grounded character's ordinary local travel is interpreted in one sampled body frame for the admitted tick. Actual actuation and nominal prediction use that same orientation. Independent reference position remains necessary; an independently integrated grounded reference orientation does not. Pursuit continues choosing commands from actual body/target state. Observed animation remains a downstream consumer and cannot supply ordinary travel.

**Cutover:** in `physical_body.rs` / `types.rs`, make grounded reference prediction consume the same starting body orientation used by ordinary actuation, rather than `PhysicalCorrection.reference.rotation`. Resolve or share the authored world-space travel once at the existing physical-input preparation boundary where practical; avoid a new retained command object or another motion resolver. Nominal continuation still evolves independently of collision-modified actual velocity. Grounded reference advancement becomes positional; stop running its separate ordinary facing/angular integration. Review the predictor result shape so no consumer needs an unused or fabricated grounded rotation.

In `pose_reconciliation.rs`, distinguish the admitted authority heading target from nominal position advancement. An Interpolate with keep_heading=true supplies no heading override. With keep_heading=false, preserve the existing authority-facing behavior through actual actuation; the target must not become a hidden second movement frame or be overwritten by grounded nominal turning. Consolidate the bool/optional target representation only if it removes an invalid combination without broadening the change. Keep body orientation authoritative for the tick's travel; do not introduce an immediate pre-tick rotation/translation snap. A heading update takes effect through the existing facing commit, so travel before that commit uses the current body frame consistently.

Free-flight reference orientation/steering has different consumers and is outside the grounded simplification; preserve it explicitly instead of changing all responses by assumption. Local control, launches, nominal-vector packet lifecycle, horizontal return/completion, braking, mobility, hard navigation, support and budgets retain their current contracts. No contact kick cancellation, new friction, correction timeout, distance cap, or presentation correction path.

**Why not admission-only repair:** replacing reference rotation with current rotation only when keep_heading packets arrive repairs the immediate fixture but leaves two frames capable of diverging during later turning. The intended subtraction removes that continuing source of disagreement, not just the seed mismatch. Separate position prediction remains an accepted approximation: it uses actual controller intent and local terrain support; it is not a second independently navigated simulation of the server character.

**Execution gates:**

- [x] Trace initialization, contact capture, keep-heading and heading-taking retargets, command turning, explicit omega, correction completion/recapture, and grounded/free-flight reconfiguration. Name the sole ordinary-motion frame and each surviving heading consumer. If removing grounded reference heading requires changing free-flight semantics or another persistent mode, stop and rescope.
- [x] Retain the Panumbris failing case as a behavioral regression: opposite packet heading with keep_heading=true cannot reverse forward requested motion. Add sustained pursuit-style turning with repeated authority retargets and actual/reference positional separation; the existing aligned-heading turning fixture alone is insufficient. Cover keep_heading=false authority-facing updates, heading-only updates, and ordinary turn progression after correction retirement/recapture. Verify that world-space packet velocity remains world-space.
- [x] Cut over grounded prediction and delete its duplicate facing/angular integration and stale vocabulary. Keep authoritative heading targets separate from advancing nominal position. Review both collection and direct physical paths; do not resolve policy twice in consumers.
- [x] Run focused regressions, world/core/host library suites, affected all-target warning-denied Clippy, formatting/diff checks, and normal debug host build. No added hard query or mobile iteration; no new IPC contract is expected.
- [x] Replay the user's approach/turn/crowd scenario after rebuilding. The existing debug capture proves runaway motion and a later 92 m pop but lacks internal reference/raw packet values. Require disappearance of sustained wrong-direction travel; inspect the eventual pop separately if it remains rather than assuming this change fixes every discontinuity. Respect session/relogin lifecycle and user control of the running client. **Closure:** Post-fix debug capture and user report: “yeah looks well behaved now”.

Expected production footprint is a small cross-file change in physical input/prediction and reconciliation, with net subtraction in grounded orientation prediction; fixtures likely add more lines than production. No precise line-count promise before inspecting all predictor consumers. The main tradeoff is intentional: grounded nominal position follows the body's current command frame rather than independently extrapolating packet heading. That matches the existing body-based pursuit controller and avoids two competing interpretations of one command. Remote sliding acceptance remains open until this fix and its live check; no further reproduction is required before implementation.


#### Panumbris heading cutover — implemented; live retest ready

The preceding scoping turn was progress (authoritative plan updated); this execution turn changes production behavior and completes focused verification. Grounded prediction now takes ordinary authored translation from the actual body's starting orientation, exactly as actual actuation does. It no longer resolves or integrates nominal grounded facing. The predictor's optional `flight_rotation` has one consumer: advancing free-flight reference orientation. The advancing method is renamed accordingly; the input contract and world architecture note distinguish grounded body frame from free-flight reference frame.

Authority heading remains an admitted correction target: keep_heading suppresses its actual-facing override; otherwise the existing actual actuation applies it. Grounded turning no longer overwrites that target. The shared reference pose/keep-heading representation remains because free-flight orientation advancement and conversion back to pose-only interpolation consume both fields; splitting the entire reconciliation mode would expand this fix without removing an invalid reachable state. No new retained field, motor, correction path, IPC shape, or hard query. The predictor accepts the body so its physical definition and starting orientation cannot be supplied from different bodies. Existing explicit nominal vectors remain independent from actual collision velocity.

The production collection regression `grounded_reference_uses_body_frame_across_conflicting_heading_updates` covers moving and heading-only inputs, keep_heading true/false, opposite packet headings, repeated retargeting with positional separation, authored yaw, and explicit angular velocity. It checks nominal travel against the starting body's frame and actual facing against the intended owner. Idle continuation retires the displaced reference, then a fresh authored tick recaptures without reintroducing the stale heading. All cases pass (`/tmp/panumbris-heading-regression.log`). This is a controlled pursuit-style command fixture, not a raw packet replay of the captured Panumbris episode. Existing free-flight predictor tests still prove independent authored reference rotation and world-space vector continuation; existing observer departure, supported motion, slope, stair, and nominal lifecycle regressions pass.

Shared library verification: world 658 / core 355 / host 276 pass (`/tmp/panumbris-final-shared.log`). Affected all-target warning-denied Clippy passes (`/tmp/panumbris-final-clippy.log`); normal debug host build passes (`/tmp/panumbris-final-debug-build.log`). The final fixture extension for retirement/recapture also passes its focused run. No production code changed after the full shared run. Formatting/diff and final world lint follow. The dependency-only binrw future-incompatibility advisory remains unchanged.

The old capture handle was missing and its debugging endpoint was absent. Relaunched the user's authorized debug client with fresh recording `/tmp/mob-slide-fixed-events.jsonl` and redacted launch log `/tmp/mob-slide-fixed-client.log`; original evidence is preserved. Capture reports ready on port 9223. The live client/recorder intentionally remains open for user playtesting; all test/build tasks are terminal. No user input or avatar movement is automated in this recording session. Live sliding and eventual-pop acceptance remain open; do not mark the full goal complete from the regression. No staging or commit.

Final world all-target Clippy passes (`/tmp/panumbris-final-world-clippy.log`), as do formatting and diff checks. Only the user-facing debug client/capture remains running.


#### Post-fix recording audit — active crowd captured; reset discontinuities remain distinct

Previous execution turn was progress: heading cutover, regression, verification, and debug client launch. This continuation verified recorder handle 68884 live and inspected the growing post-fix recording. It contains active movement among Olthoi, Banderlings, Tumeroks and other mobs; no Panumbris sample in the inspected window. No visual acceptance from the user has arrived yet.

Found discrete changes for Banderling Thrasher 0x80001d5f (25.16 m at 1788895564823) and Tumerok High Priest 0x80001ef0 (12.36 m at 1788895544423, another 12.04 m later). Each follows a grounded simulating-velocity tick by 2–4 ms and arrives as an upsert with suspended sampling and unknown contact, generation unchanged. Details saved in `/tmp/mob-slide-fixed-jumps.json`. Landblock-aware coordinates rule out local-coordinate wrap as the explanation. This is not proof of remaining sustained wrong-heading travel, and distance growth relative to a moving player alone cannot establish runaway motion.

Source admission paths distinguish normal physical Snap/Interpolate, which preserve the body and retarget reconciliation, from Reset/ForcedReposition and explicit runtime suspension, which can replace placement and publish suspended state. The latter signature matches these observations. The capture lacks raw packet sequence/cause information, so do not assert a specific server teleport, spell, reset, or suspension cause. Changing explicit server discontinuity behavior is not justified by this recording alone. Preserve the scoped heading fix and await the user's visual result; if the pop remains objectionable, capture the admission cause rather than modifying braking or ordinary correction blindly. No production changes or repeat test campaign in this audit. The interactive client/recorder remains live.


### Final acceptance audit — plan implementation complete

User reports “yeah looks well behaved now” after the updated debug-client crowd playtest. This closes the final heading/runaway movement live gate and the preceding stopping/overlap/drift acceptance gate. It is acceptance of the current practical behavior, not a proof that every possible contact or authority discontinuity is exact.

Completion mapping:

- Solver shape, common production kernel, bounded query-free mobile passes, ordinary/corrective hard navigation, support/edge rules, accepted-only reporting, camera lifecycle, animation priority and the prior structural reviews are accounted for in the earlier Current completion audit. Later changes preserve those boundaries and budgets; no second simulation, recursive contact propagation, new correction lane or IPC contract was added.
- Content census rechecked: `/tmp/contact-classification-census.log` reports 43,913 templates / 3,909 setups. Historical performance gate evidence rechecked in `/tmp/navigation-final-crowd-benchmark.log`; benchmark assertions pass. Rendered camera evidence remains `/tmp/support-recovery-ui.jsonl`. The user previously accepted performance and terrain/support behavior. Older dungeon checklist entries are superseded by those scoped gates and subsequent feedback, not a demand for another identical-workload run.
- Frontend evidence rechecked: `/tmp/contact-feedback-app-tests.log` records 273 files / 2,122 tests. Recent changes do not alter frontend code or IPC shapes. The new live client was rendered and exercised by the user.
- Stopping, cumulative nominal continuation, packet lifecycle, slope/stair return, observer departure, authority/pursuit heading ownership, heading-only completion and recapture are covered by the retained shared regressions. Latest shared results: world 658 / core 355 / host 276. Final fixture extension passed separately. Shared and final world warning-denied Clippy, normal debug host build, formatting and diff checks pass; evidence paths are recorded above.
- Latest live evidence is `/tmp/mob-slide-fixed-events.jsonl`, followed by user acceptance. Captured suspended-state position jumps are distinguished from continuous solver travel. Their exact server/admission causes were not captured; no unsupported claim that the client must suppress explicit authority resets is made.

Retained tradeoffs: nonexhaustive mobile contacts and bounded residual penetration; finite player separation biased toward peers, with braking-only incoming velocity response; fast braking of all idle supported character horizontal motion; horizontal-only grounded return, including the different-solid-floor-at-same-XY concession; previously accepted removed-support behavior; grounded nominal travel uses actual command heading rather than a second simulated facing. See the source markers and preceding scope entries for limits. These are deliberate accepted policies, not unfinished implementation. Tuning can be revisited from future playtest feedback.

Remaining diagnostic debt is nonblocking: exact attribution of server reset discontinuities and a full census of multilevel same-XY return situations. The binrw dependency future-incompatibility advisory remains external to the changed code. No further reproduction or speculative fix is required for acceptance of this plan.

The diagnostic endpoint was already closed when detachment was attempted (connection refused); polling recorder handle 68884 confirmed `Client exited: 0`. No client, capture, test, or build from this execution is left running. No temporary fixture remains in source. No staging or commit was requested or performed. All active implementation/acceptance gates are closed; future defects should start from their concrete recurrence rather than reopen superseded experimental branches.


### New remote-player stop recurrence — captured after prior acceptance

User reports remote players sliding after move/stop and reproduced with nearby +Merklejerk (0x50000001), observed by +Holtfighter. Fresh debug recording `/tmp/remote-player-slide-events.jsonl`; extracted actor samples `/tmp/remote-player-slide-samples.json`. This is a new follow-up after the user's accepted mob-heading fix, not evidence that the earlier live acceptance was fabricated.

Two start/stop episodes are visible in host-published positions, with grounded contact throughout the inspected tails. Relative to the first remote sample, speeds at +9.7–10.7 s were 0.9996 m/s; +29.7–30.7 s 1.0007 m/s; +31.2–31.7 s 1.0009 m/s. Later segments taper to 0.4009 and 0.526 m/s. Endpoint tail travel is about 2.21 m and 3.72 m for the sampled windows. Exact input-release times are not captured, so those windows are observational tails, not measured distances since a wire stop command.

The plateau and taper match the supported reference-return law: bounded bias at PHYSICAL_CORRECTION_SPEED_MPS=1 m/s, proportional gain PHYSICAL_RETURN_GAIN=2 near the reference. Idle braking can therefore be working while reconciliation deliberately requests further motion. This is stronger evidence for a reference-return tail than generic passive friction, but published pose/animation alone does not expose nominal velocity, reference error, raw stop admission, or geometric separation; do not claim causal attribution of the accumulated error yet.

Next investigation should capture/trace ordinary authored input, admitted authority pose/vector updates, actual continuation and nominal reference through one start/stop. Distinguish expected authority catch-up from erroneous reference advancement or extra post-stop authored motion before choosing a policy. Increasing braking cannot remove a sustained nonzero return target. No production change or new tuning is justified from the speed signature alone. The diagnostic debug client/recording remains open under the user's reproduction request; no commit.

#### Targeted remote-player trace prepared

User authorized one diagnostic replay. Temporary stderr instrumentation filters GUID 0x50000001 and timestamps incoming position/motion/vector data, admitted pose effects, return-step ordinary authored input/reference error/nominal velocity/final actuation, and accepted collection publication. No physics behavior or tuning is changed. Debug host build passes (`/tmp/player-stop-trace-build.log`). Fresh source backups are under `/tmp/player-stop-trace-before`; installation script `/tmp/install-player-stop-trace.py`. Restore only these temporary changes after the diagnostic process has loaded the binary; do not restore from git or disturb the whole plan diff.

The earlier debug endpoint was already closed when restart was attempted. Next recording uses `/tmp/player-stop-trace-client.log` for internal trace and `/tmp/player-stop-trace-events.jsonl` for published events, preserving the previous capture. This trace is diagnostic-only and adds stderr work, so it is not performance evidence. Cleanup and interpretation remain pending until the user repeats move/stop.

The targeted recorder reports ready (process handle 11591, debugging port 9223). After the instrumented host loaded, source-only trace changes were removed: each file was checked against its fresh backup to ensure the only differences were diagnostic lines/blank lines. Instrumented copies remain under `/tmp/player-stop-trace-instrumented` for reproducibility. The running process and current debug executable still contain the trace; rebuild the normal debug executable after capture. No persistent logging feature was added. Awaiting the user's short move/stop replay.

#### Remote-player trace result — ordinary acceleration creates a return tail

User repeated move/stop. Internal trace is preserved in `/tmp/player-stop-trace-client.log`; host stderr forwarding adds chunk prefixes inside debug-formatted records, so `/tmp/parse-player-stop-trace.py` removes those transport prefixes before parsing. Normalized records: `/tmp/player-stop-trace-normalized.json`; timeline: `/tmp/player-stop-trace-summary.txt`. The raw recording remains unchanged.

Causal evidence: first moving burst requests nominal (12.938235,-11.349724,0), about 17.2 m/s, while actual velocity is (2.4430835,-1.719244,0), about 3 m/s. Across eight successive admitted ticks at +12.114–12.324 s, actual speed rises 2.987→7.180 m/s. Deriving admitted interval from accepted displacement/velocity and comparing input/output velocity gives exactly 20.0 m/s² each tick. Published paths contain ordinary Travel with no Correction/Impact in that interval. This demonstrates actual motor acceleration limiting ordinary travel while nominal prediction immediately follows authored speed; contacts are unnecessary to produce the measured lag.

After the first forward-stop command (+12.408 s), the authored transition still contributes small travel briefly, then nominal velocity is zero by +13.132 s. At that point reference error is (2.6003342,-2.3181229,0), about 3.48 m, and the requested/actual return velocity is (0.74645,-0.66544,0), magnitude 1 m/s. Later fully idle samples have authored=None and nominal zero while return remains active. Further fresh position packets replace the target as expected; they do not explain away the internally accumulated lag before their arrival. Other short bursts repeat the same pattern.

Diagnosis: idle braking is functioning, but the ordinary acceleration-limited motor intentionally falls behind the independently authored-speed reference. The correction motor then converts this start-up deficit into visibly extended movement after stopping. Repeated rapid turns/reversals can create additional deficits through the same mismatch. This does not prove every possible remote discrepancy has this cause; it directly accounts for the captured tail without blaming packet stop loss, residual passive friction, or collision-generated momentum.

Next scope must align ordinary locomotion with nominal progression without removing legitimate authority/contact return. Merely slowing the nominal reference could hide synthetic error while leaving the visible body behind the actual server player. Merely increasing correction speed hides the symptom. Consider the existing single-velocity acceleration policy against authored locomotion semantics before adding separate states/knobs. No solution or new behavior concession has been accepted in this diagnostic turn; no production fix applied.

Temporary source instrumentation was already restored from checked fresh backups before this replay. A normal debug host rebuild is recorded in `/tmp/player-stop-trace-normal-build.log` so future launches do not inherit tracing. The currently running diagnostic process still contains the loaded trace until it exits; do not mistake source cleanup for stopping that process. No staging or commit.

### Scoped remote-player stop fix — direct ordinary character drive

User requests scope after the trace proved acceleration-induced lag. No production change in this scoping turn. Sharper ordinary starts/stops/reversals are desired; hard navigation, finite biased mobile separation, braking-only player contact response, independent authority return, airborne physics and action-priority animation remain requirements.

**Proposed supported-character rule:** resolve the ordinary world-space tangent command once for the admitted tick, compose the existing bounded proportional reference-return bias, and directly establish that requested tangent velocity before contacts. Stable idle characters have ordinary command zero. Preserve independent normal velocity and response-owned forces; launch and airborne admission remain their existing separate paths. Contacts and hard navigation still own accepted motion. Do not reapply the command after each mobile contact pass or after hard clipping.

Reference return remains capped by PHYSICAL_CORRECTION_SPEED_MPS (currently 1 m/s), with PHYSICAL_RETURN_GAIN tapering its speed near the target. Proposal explicitly removes the additional acceleration/braking ramp from supported character return as well as ordinary drive. Its gradual positional behavior comes from the bounded proportional target, not a second stored correction velocity. This is a small observable refinement to the earlier wording “keep the smooth motor response”: correction speed may change immediately when its target changes, while displacement remains bounded and swept. No positional snap. Approval of implementation should include that tradeoff; do not silently add a second actual locomotion/passive/correction velocity to preserve the old ramp.

**Ownership and subtraction:** use existing Character role and Stable surface policy at physical input preparation to select direct supported drive. Local, remote and possessed characters share this policy. Keep generic passive coasting, sledding and free-flight semantics intact; inventory non-character driven/return callers before deleting any shared motor behavior. In `mobile_contact/step.rs`, replace the character's ramped tangent integration with direct tangent command composition. Retain a distinct existing rate-limited path only if a named non-character consumer still needs it; otherwise remove `motor_velocity_change` and the now-unused acceleration/braking knobs. Do not leave two selectable character implementations or introduce an enum solely for old tests. `physical_body.rs` / `types.rs` prepare actual and nominal ordinary travel from the same command/frame/support plane; nominal prediction never receives correction or collision-modified actual velocity. Current independent nominal vector lifetime and explicit packet reseeding remain unchanged.

**Contact resistance gate (before committing to production cutover):** demonstrate the exact order through ordinary hard movement, query-free mobile passes and aggregate corrective navigation. Direct drive can restore speed reduced by the previous tick's contacts, so unchanged weights do not guarantee unchanged pushing feel. Compare existing and proposed behavior with a stationary peer, opposing mover, mobile blocked by a hard wall, and a small crowded corner. Check accepted progress, peer displacement, player momentum, persistent penetration and escape; use the existing mobility weights and hard safety bounds rather than inventing a desired speed threshold. Incoming mobs must not impart retained player momentum. Keep finite player separation and nonexhaustive mobile contact concessions. If maintaining user-accepted sustained resistance requires new retained contact pressure or a second actual velocity, stop and present that structural tradeoff rather than implementing it as a hidden follow-up. Increased pushing strength may need user tuning acceptance even when all hard invariants pass.

**Verification and acceptance:**

- [x] Analytical gate: inventory all Driven/return callers, stable-character classification, confirmation-budget composition, and velocity writers. Establish one command application per admitted tick, before contact response. Identify deletable ramp state/helpers/constants versus genuine passive consumers. Document the correction-ramp concession above and the actual non-character boundaries.
- [x] Reproduce the startup deficit with an asset-free production collection test: short authored bursts at several speeds, stop, reverse, and turn with no contacts. Compare accepted and nominal travel throughout. The body must not manufacture a several-metre reference deficit from the extra motor ramp, or move for seconds after both ordinary input and legitimate reference error are zero. Use captured speed/shape where useful, not a magic tuning assertion. Existing authored transition travel remains real input; do not erase it by guessing release from animation presentation.
- [x] Exercise the contact-resistance matrix before broad implementation. Preserve no incoming player momentum, hard clearance, edge safety and escape. Record any stronger pushing rather than loosening tests until green.
- [x] Cut over shared stable-character drive; retain one actual velocity and one independent nominal continuation. Remove obsolete character-ramp vocabulary and tests; replace them with command-tracking, passive-decay and bounded-return contracts. Preserve real authority/contact error correction after stops; do not reset reference position on release to hide drift.
- [x] Cover heading retarget/recapture, world-space vectors, idle external character velocity, jumps/airborne transitions, slopes/stairs, stopped return against a wall, confirmation budgets, and sleep/reactivation. Shared collection and direct/prediction paths must use the same rule. No new sweep or mobile pass.
- [x] Run world/core/host tests, affected warning-denied Clippy, formatting/diff checks and normal debug host build. No IPC/frontend changes are expected. Update source comments and architecture around removed character acceleration/braking policy.
- [x] Replay one remote-player short move/stop with the user, then briefly check player-initiated pushing. Distinguish remaining legitimate delayed authority correction from artificial startup lag; instant perfection across network updates is not promised. Remove temporary tracing and leave the normal debug executable clean.

Expected footprint: supported actuation/integration and its preparation in three existing world spatial files, plus focused tests and docs. No movement-controller redesign, packet interpolation rewrite, animation workaround, pressure solver or new persistent velocity component. Keep the existing heading fix. This supersedes the accepted 80 m/s² character-braking tuning for stable supported direct drive only; passive and airborne policies require the analytical inventory before any broader removal.

#### Direct character drive — cutover implemented; hard-contact progress gate caught a regression

The preceding scoping turn was progress. Caller inventory confirms passive/non-character return and sledding consume rate-limited drive, so deleting the shared ramp globally would violate the scoped boundary. Stable Character input now selects transient SupportedDriveResponse::Direct; other supported motors retain Accelerated. Return preserves that prepared response while adding the existing bounded proportional bias. Normal velocity and forces are retained; the command is integrated once before hard navigation/mobile passes, never reapplied inside those passes. No second actual velocity, pressure state, or new query was introduced. Existing stable-character classification is consolidated in PhysicalBodyState::has_direct_character_drive. Remaining ramp constants are named PASSIVE_MOTOR_ACCELERATION/BRAKING; old exported character-ramp names are gone.

Replaced the old release/ramp test with local/remote × three-speed short bursts, stop, reverse and lateral changes through production collection. Actual/nominal velocity and travel agree without manufactured return work. Idle external character velocity stops immediately; passive drag remains. Possession run tests now require resolved authored speed on the first tick instead of waiting for the deleted character ramp. Residency/reactivation no longer assumes artificial error must keep a reference alive. A hard-cylinder clearance fixture needed coordinate-rounding allowance (less than a micrometre beyond the fixed contact band); its bound now accounts for f32 placed-coordinate subtraction without changing collision tolerance. Architecture/source comments updated.

World 658 / core 355 / host 276 pass (`/tmp/direct-character-shared.log`); affected all-target warning-denied Clippy passes (`/tmp/direct-character-clippy.log`). Normal debug build passes (`/tmp/direct-character-debug-build.log`). The final geometry-only tread fixture no longer derives its probe length from an unrelated passive motor knob. Temporary trace markers and obsolete motor constant names are absent from source. The prior live trace process exited cleanly; no new live session has been launched for this cutover.

**Do not declare live-ready from green suites.** The manual 45-body conformance/measurement fixture passes safety assertions but its progress measurements expose a regression. A controlled same-code comparison changes only Direct integration back to the old ramp: `/tmp/direct-character-crowd.log` versus `/tmp/direct-character-crowd-ramped-control.log`. Direct/ramped player forward travel: swarm 1.958/2.294 m; pinned 2.135/2.256 m; hard tight-corner 0.040/2.964 m (total travel 0.074/3.134 m). Mobile peak penetration rises modestly (swarm .317/.240 m; pinned .267/.245 m) within the existing nonexhaustive residual-contact model; those figures are not new accepted tuning limits. Hard penetration remains at the existing .0002 m contact band. Do not compare older pre-follow-up benchmark numbers as if they isolate direct drive.

A temporary tight-corner trace (`/tmp/direct-character-corner-trace.log`, installer `/tmp/trace-direct-corner.py`) isolates the stall: after reaching root (80.05399,78.95018,.005), the first inward request contacts an authored cylinder at fraction zero; the response produces a tangent request (.027066786,-.023283865,0), but subsequent passes repeatedly classify the same contact at fraction zero with normal (-.65214276,-.7580962,0). Direct drive repeats that sequence every tick. The ramped continuation happened to escape it. Initial-convex-contact admission uses a strict negative dot product; the trace points to numerical tangent/contact classification, not exhaustion of the mobile pair budget. The temporary trace and ramp-control modifications were restored from exact fresh source copies; no experimental mode remains.

Next necessary work is a focused hard-navigation regression and analytical numerical review of initial-contact admission versus projected slide requests. Preserve the fixed contact band and bounded passes; do not conceal the stall by reintroducing character inertia, increasing slide count, loosening penetration tests, or adding an unreviewed nudge. This is a discovered gap before live acceptance, not evidence that the start/stop fix is complete. The manual benchmark's safety-only assertions did not detect loss of progress; retain an actual behavioral regression for this case. Live start/stop/pushing acceptance and final post-navigation verification remain open. No staging or commit.


#### Hard-contact progress gate — endpoint rounding resolved

The focused cylinder query reproduces the measured stall. Projecting the inward command gives tangent dot normal -1.86e-9 m; storing the endpoint near landblock coordinates (80,79) changes that to -7.08e-7 m. Existing initial depth is only 8.94e-8 m. A strict negative-dot test treats this rounded tangent as another zero-time impact. This is numerical endpoint representation, not a mobile solver budget failure.

Initial convex-volume admission now bounds the entire inward chord against its original supporting plane: existing depth plus inward displacement must fit the coordinate-precision allowance. The allowance is derived from f32 precision, normal-weighted coordinate magnitudes and query radius. It is absolute relative to the hard boundary, not granted again relative to the last accepted pose. A convex volume lies behind its supporting plane, so this conservative plane check suffices without another cast. Existing genuinely separating paths remain available even from deeper overlap. No CONTACT_EPSILON change, position nudge, new state, extra query, or slide-budget increase. The unavoidable concession is representational-scale clearance uncertainty; the original hard contact band remains the geometric policy.

Retained checks cover the exact rounded tangent, repeated one-representable-coordinate inward moves against balls and cylinders, and production character travel past the two hard cylinders with per-tick support/clearance checks. The production regression fails with the old collision rule and passes with the new one (`/tmp/direct-drive-corner-counterfactual.log`). Its recorded 30 ms admitted tick is intentional: a maximum-sized tick escaped the particular rounding failure and did not reproduce it. The contact-band repetition test checks the absolute boundary each step; an initial arbitrary blocked-count assertion was removed because initial travel legitimately consumes the band before blocking.

The 45-body benchmark now travels 3.394 m in the hard corner, forward 3.224 m, versus 0.074/0.040 m before the numerical fix. Maximum hard penetration is 0.000180 m, within CONTACT_EPSILON=0.0002 m. Mobile swarm/pinned trajectories are unchanged by the numerical fix. Evidence: `/tmp/direct-drive-tangent-crowd.log`. This is asset-free debug evidence, not a new dense authored-BSP performance claim.

Maintainability acceptance: one prepared character drive choice, one application before contacts, no persistent acceleration/pressure lane; one convex initial-contact numerical rule for balls/cylinders; no shape-specific tangent retry. Regression coverage must exercise production input preparation and prove progress as well as clearance. Accordingly the existing driven-corner crowd escape test now uses production collection; new stationary/approaching/opposing character cases check preserved ordering, support, escape, and no incoming backward player momentum. Prior bare contact tests still cover their actual ballistic/passive contracts rather than masquerading as character-drive coverage.

Current verification: world 662 pass (`/tmp/direct-drive-final-world.log`); core 355 and host 276 pass (`/tmp/direct-drive-final-shared.log`, whose earlier world result was superseded after the fixture assertion correction). Warning-denied Clippy and normal debug rebuild are in progress. Live remote-player short-burst/stop and pushing-feel acceptance remain open; do not mark the overall follow-up complete from these synthetic checks alone.


Controlled supported-contact comparison isolates Direct versus the retained old ramp with all other current code identical. Temporary logging and the ramp toggle were restored from fresh exact source copies. At one second: approaching mob versus idle player displaces player -0.257 m (direct) versus -0.060 m (ramped), with player physical velocity exactly zero in both; moving player versus stationary mob advances player 1.743/1.733 m; opposing 2 m/s commands advance player 0.888/1.723 m and retain separation 0.756/0.950 m against nominal 0.960 m. Evidence `/tmp/direct-drive-contact-comparison-direct.log` and `...-ramped.log`. Thus no-incoming-momentum is preserved, but positional crowd pressure and sustained opposing overlap change materially when commands are restored every tick. Do not characterize this as unchanged pushing feel or silently tune mobility to conceal it. The user-facing live gate must explicitly accept or reject this consequence; if it is unacceptable, return to the command/contact policy decision rather than layering retained pressure or another velocity without review.

Warning-denied all-target Clippy passes (`/tmp/direct-drive-final-clippy.log`); normal debug rebuild is underway after temporary comparison cleanup. No experimental selection or diagnostic print remains in production sources.


Final normal debug host build passes (`/tmp/direct-drive-final-build.log`). Formatting and diff checks pass. The debug acceptance client is now open and recording `/tmp/direct-drive-acceptance-events.jsonl` (launcher `/tmp/launch-direct-drive-acceptance.mjs`, process handle 97530, debugger 9223). Startup log explicitly reports a debug sidecar; no source instrumentation is installed. User has been asked to replay remote short movement/stop/reverse and assess approaching-mob/pushing pressure. Keep this live acceptance gate open; no acceptance has arrived yet and no commit has been requested.

Acceptance recorder is confirmed live after entering the world; sampled capture contains normal dynamic publication and zero recorded browser exceptions. This proves startup/recording only, not user movement or crowd-feel acceptance. No visual result has arrived yet.


#### Live acceptance rejected — remote players and mobs still slide

User reports “still see the other player sliding; mobs too.” Do not close the stop acceptance gate or describe the direct-drive change as a complete solution. The first debug replay contains 973 remote-player samples. A compact extraction (`/tmp/summarize-direct-drive-capture.py`, `/tmp/direct-drive-remote-samples.json`) shows grounded tails around 1 m/s after several short bursts, including approximately +24.94–27.67 s and +28.60–30.88 s relative to first remote sample. The unchanged rate is consistent with reference return, but host publication alone cannot attribute why error remains. The prior acceleration-lag diagnosis was real; eliminating it did not explain every live source of reference error.

Next diagnostic compares admitted wire position/motion/vector updates, nominal ordinary prediction, prepared Direct actuation, reference error, and accepted physical paths. It filters remote player 0x50000001 and nearby Olthoi 0x8000055a/0x8000055f. Fresh exact source backups are under `/tmp/direct-stop-trace-before`; installer `/tmp/install-direct-stop-trace.py`. Debug trace build passes (`/tmp/direct-stop-trace-build.log`). This is temporary instrumentation only, no additional movement-policy change.

The first acceptance client had already closed when restart was attempted; process handle 97530 confirmed terminal exit 0 at 21:03:22 UTC. Observe at least 60 seconds from that confirmation before the next login. Restore only the fresh diagnostic backups after the traced executable is loaded, then rebuild a clean normal debug executable. Existing old trace backups predate these fixes and must not be restored.


#### Remaining-slide trace — heading replay and pre-separation gait observation

User completed the targeted replay. Evidence `/tmp/direct-stop-trace-client.log`, normalized by `/tmp/parse-direct-stop-trace.py` into `/tmp/direct-stop-trace-normalized.json`. Source tracing was restored from checked fresh backups after the traced host loaded; instrumented copies retained under `/tmp/direct-stop-trace-instrumented`. The diagnostic client subsequently exited cleanly (handle 42620 confirmed exit 0 at 21:11:46 UTC). No trace process remains. Do not restore those source backups again: they now predate the fixes below.

**Remote player:** initial direct ordinary travel has zero reference error. Later Interpolate packets introduce position error and `keep_heading=false`. At +15.226 s authored rotation requests about 3.85 degrees of turn, but prepared `control_heading` remains 5.273529 and publication retains exactly the old packet quaternion. Repetition discards subsequent turns until the position reference retires. The next position packet exposes a larger divergence (reference error around 7 m), followed by multi-second 1 m/s return with nominal velocity zero. This is a separate proved defect from the removed acceleration ramp.

Fix: physical correction stores an optional pending authority heading instead of a heading-ownership boolean tied to position lifetime. Input takes the pending heading once in the transaction's working state. A fresh packet renews it; contact recapture and physical/pose-only role changes preserve its consumed state. Ordinary turning owns later ticks even while position return remains active. The existing conflicting-heading regression incorrectly required the stale target every tick; it now checks first-tick authority priority followed by continued authored turning, along with retained omega, idle handling, completion and recapture. A role-transition regression verifies consumed headings do not reappear. Concession: fresh authority facing still wins its admitted tick; hard-clipped angular travel is discarded under the existing bounded-rotation policy, not queued as another persistent rotation target. Normal reference frames, contact return and one actual velocity remain intact. World 663/core 355/host 276, warning-denied Clippy and debug build pass for this heading change (`/tmp/direct-stop-heading-*.log`).

**Mobs:** the two traced Olthoi have `keep_heading=true`, so the heading replay does not explain their motion. They show reference-return travel and repeated contact adjustments. More specifically, visual locomotion consumed ordinary supported travel before separation. At +29–34 s, Olthoi 0x8000055a moves opposite its published gait input on 61/161 ticks. The sampled 0x8000055f window also contains both walking loops and protected/transition holds; do not claim all visible sliding is a frozen animation. Analysis `/tmp/summarize-direct-stop-mob-paths.py` measures signed-path sources; summed path lengths are not net displacement.

Fix in progress: observe final accepted horizontal contact adjustment in supported locomotion publication, after hard clipping, while leaving ordinary observation/facing and retained physical velocity separate. The existing observation accumulator is renamed and its consumers remain explicit; no extra persistent velocity, solver pass or animation-to-physics input. Airborne travel, vertical stair lifts and angular sphere chords remain excluded from gait. The supported-contact matrix now requires visual displacement to match actual net horizontal progress. Attacks, emotes and other protected actions retain priority.

Tradeoff: bodies displaced by contact can step with the resulting displacement instead of playing an opposing pre-separation gait. This does not remove legitimate physical return toward authority or promise stationary bodies while a crowd separates them. Jostling can change the selected gait; do not introduce hysteresis or filtering unless the live result warrants it. The earlier stronger positional crowd-pressure concession is still unaccepted. Final observation checks and a clean debug visual replay remain open; this entry is progress, not overall completion.


## Character movement consolidation — ownership gate

### Review outcome and scope

The user requested a holistic consolidation of movement and reconciliation, including shared benefits for the controlled player, followed by a bounded analytical review. This entry scopes that consolidation; it does not claim implementation or visual acceptance. Apply the problem-solving skill: constraints, observed inputs, concessions, and ownership precede implementation. No new live capture is required to establish the ownership problem.

Goal: one character movement decision resolves source intent and authority error into actual travel and facing; collision accepts or clips that request; presentation observes the result. This is a shared world movement policy, orchestrated by core. It is not a new frontend controller or an additional coordinator over unchanged correction mechanisms.

Keep the bounded collision solver, support/navigation, source command interpretation, authored hooks/actions, and observed locomotion. Replace the split character steering decisions. Do not generalize remote walking-back policy to projectiles, passive bodies, fixed animated bodies, pose-only projection, or local confirmation.

### Code evidence and important surprises

- `core/client/simulation.rs::tick_with_precise_jump` admits time, advances ordinary authored playback once, applies physics hooks, then runs physical collection and observed presentation. This order matters: correction must not drive the authored cursor or emit its hooks again.
- `world/state/motion_resolution.rs::resolve_remote_motion_order` already reduces server directives against body/target/support. `motion/directed.rs` owns MoveTo/TurnTo progress. Local server-directed travel uses the same reducer through `core/client/movement/system.rs::advance_local_authored_motion`. Preserve that reuse; a second MoveTo state machine is not needed.
- `spatial/types.rs::step` and `return_step` independently prepare ordinary motion; the latter also predicts reference travel and consumes authority facing. `mobile_contact/step.rs::with_supported_return` then replaces the drive with ordinary velocity plus error bias. These are the competing decision sites to consolidate.
- `motion/registry.rs::presentation_sequence` knows whether actions, one-shot transitions, or explicit poses protect presentation. A zero root offset does NOT imply idle or permission to turn. Movement preparation needs a named, runtime-produced semantic fact, not inspection of animation IDs or another inferred priority table.
- Local `PoseReconciliationState::confirm` retains confirmed-travel semantics. `PhysicalBodyInput::prepare` captures contact return for Entity bodies, not LocalPlayer bodies. Sharing movement preparation must preserve this real policy distinction.
- Grounded reference prediction currently uses actual body orientation. Adding autonomous return-facing alone would change the basis of later ordinary movement. Fixing translation ownership without facing ownership is insufficient.

Latest prior implementation verification is world 663/core 355/host 276, warning-denied affected all-target Clippy, and clean debug host build (`/tmp/direct-stop-final-*.log`). Final supported gait observation is implemented and checked, not still in progress. Its live visual acceptance remains open.

The temporary captured-input replay also limits the diagnosis: one-shot authority heading reduced final player error from approximately 8.50 m to 7.88 m; it did not explain all drift. A diagnostic division of authored travel by the advertised 1.2 scale reduced one-shot final error to approximately .67 m. ACE PhysicsObj.UpdatePositionInternal and retail `acclient.c:308262-308298` apply object scale, so this is a rate-mismatch clue, not authorization to remove scaling. Replay scripts/logs remain under `/tmp/direct-stop-heading-replay-*`; temporary source changes were restored. Natural return must not be presented as proof that this prediction mismatch is fixed.

### Constraints, input distribution, and concessions

Inputs include server MoveTo/TurnTo directives, remote player movement without a destination, local manual/server-controlled commands, explicit actions, intermittent authority poses, and contact displacement. Ordinary walking/running and stopping are the common path. Dense crowds repeatedly prevent return; this is normal input, not an exception requiring global recovery.

Preserve one actual body pose/velocity; independent authority prediction; one admitted timestep; existing hard navigation and mobile work budgets; braking-only incoming player velocity response; accepted finite positional player separation; action/hook ordering; transactional reference publication; resets and physics role changes. Grounded return remains horizontal with navigation owning height. Airborne return/launch behavior is outside the character steering cutover.

Accepted existing concessions remain: imperfect mobile separation, blocked return without guaranteed convergence, approximate gait cadence, and single-clip action priority. User explicitly accepts return translation during attacks and emotes, including visible sliding. Protected playback and explicit source facing constrain autonomous return-facing, not return translation. Keep bounded return active without replacing the action animation or its facing. No pathfinder, recovery timer, collision retry, extra velocity reservoir, or independent rendered body.

### Proposed ownership and tick contract

1. Source adapters interpret local input or server commands using existing reducers. Authored playback advances once and produces ordinary travel/turn plus hooks. The motion owner exposes whether the resolved source permits autonomous facing/return; active directives count as intent even during a zero-travel tick. Explicit facing and protected playback are not inferred from displacement.
2. One world-owned character movement resolver runs during transactional body preparation, with the prepared source facts, body/support, and reconciliation working state. It produces ordinary reference advancement separately from one resolved actual travel/facing request. Core supplies local intent but does not implement a second return policy. Spatial collection owns commit/rollback, not priority decisions.
3. Reference bookkeeping advances from ordinary source travel only. The controller resolves bounded return and facing once; the contact kernel receives the final drive and does not add character reference bias. Local confirmation remains a distinct input policy using the existing confirmation constraint, with no autonomous remote turn/walk fallback.
4. Solve through existing ordinary navigation, mobile contacts, and corrective navigation. Publish actual state and reference continuation together. Observed locomotion uses final accepted supported travel; existing action selection retains presentation priority. It never supplies nominal motion or hooks.

Remote facing requires one retained command orientation, distinct from temporary actual return-facing. Its consumer is conversion of subsequent source-local travel into world travel. Seed from admitted authority/body initialization, advance from ordinary source turning, and update from fresh authority facing under existing keep-heading semantics. Both nominal and ordinary actual travel MUST consume the same prepared world-space source motion. Return turning updates only the actual request, never this command frame. Consolidate existing grounded reference heading storage into this ownership; do not introduce two independently evolved command headings. Retain the command frame across positional return completion, otherwise the next movement would inherit the return heading. Discontinuity resets it; pending authority heading is consumed transactionally once.

This intentionally changes grounded command-frame ownership; it is not a cosmetic field move. Earlier independent-frame drift must be tested directly: the failure to avoid is nominal travel using one basis while actual ordinary travel uses another. Source intent may remain unfulfilled when geometry clips the body; that is explicit positional error, not a reason to rewrite the source direction from separation or return animation.

### Priority and scenario checks

| Scenario | Resolved behavior and required invariant |
| --- | --- |
| Idle remote displaced by pushing | Bounded return toward reference with facing toward that journey. Use bounded turn and reduce return translation while facing away, rather than instantaneous turn plus sideways slide. Reference receives zero corrective travel. |
| Remote walking/running | Ordinary source facing remains owner; bounded return adjusts actual travel in the same decision. Source reference and ordinary actual request use identical world-space motion. Side/backward correction can remain visible; no inferred destination for players. |
| Stop after return-facing / resume | Stop changes ordinary drive immediately. Idle return may continue; a later command uses retained command orientation, not the temporary return-facing basis. Returning must not rewrite an ordinary movement packet. |
| Attack, emote, explicit pose, or stationary turn during return | Keep bounded return translation alongside ordinary action/root motion and contacts. Preserve source facing and protected animation; visible sliding is accepted. Reference continues ordinary prediction only. Autonomous return-facing resumes when source ownership permits it, without a new timer. |
| Blocked return | Existing solver clips progress; gait observes no progress. Reference persists. No retries, teleport, pressure accumulation, or guarantee of reaching it. |
| Fresh server position during return | Replace reference under existing authority rules; consume fresh heading once. Recompute next resolved request without snapping the physical position or replaying stale heading. |
| Controlled player moves, stops, or is contacted | Manual/server-controlled local source remains owner. Apply existing confirmation rules, never remote autonomous facing. Existing contact displacement is allowed; no added peer momentum. |
| Airborne, physics reclassification, teleport, removal | Preserve existing specialized physics and lifecycle semantics. No autonomous supported walk in flight; reset/reclassify controller state alongside the existing body/reference lifecycle. |

The bounded-turn/facing-alignment formula should be a small pure movement function using a named physical turn rate, not the presentation-only observed turn-rate constant. This is a new policy knob and must be justified in the contract gate. If implementing it requires a second locomotion cursor, another MoveTo state machine, or per-case recovery states, stop and reduce the design.

### Deletion map and implementation gates

- [x] Trace source interpretation, authored advancement/hooks, reference composition, physical solve, publication, animation, and local confirmation.
- [x] Identify return-facing feedback into ordinary heading and the need to preserve command orientation across return completion.
- [x] Establish a bounded design without more live evidence; record remaining policy tradeoffs honestly.
- [x] Contract gate: a pure resolver fixture demonstrates idle return, resume after return turn, moving correction, action interruption, fresh authority pose, and local confirmation. Prove no correction enters nominal advancement and actual/nominal ordinary world vectors agree. Resolve the motion-runtime priority fact once at its owner. Include transaction rejection and command-frame lifecycle in the integration sketch before the cutover.
- [x] Clean cutover: consolidate `PhysicalBodyInput::step`/`return_step` character preparation; relocate grounded character error steering out of `ContactStepActuation::returning`/`with_supported_return`; eliminate downstream character heading overrides. Preserve any genuinely used passive/free-flight behavior explicitly rather than deleting unrelated mechanics. No old/new feature mode.
- [x] Presentation integration: consume the existing action priority contract and final accepted travel; preserve authored hooks exactly once. Do not route corrective walking through the ordinary root-motion source.
- [x] Cleanup/maintainability audit: enumerate every retained state field and its consumer; remove replaced vocabulary, duplicate heading/policy decisions, and tests encoding the old ownership. Record net changed lines and justify additions; no guessed line-count promise before the cutover.
- [x] Superseded return-facing verification by the accepted translation-only return policy. Final command-heading, remote stop/resume, action/contact and local control/support verification is recorded in closeout.

Maintainability acceptance is binary: one resolver owns character travel/facing priority; one prepared ordinary world motion feeds both actual and nominal paths; one command orientation survives return lifecycle; the solver cannot add another character correction; consumers cannot infer priority from missing data; action selection remains in the motion runtime; local and remote adapters share the resolver without duplicate motors; no correction-driven authored hooks. A wrapper around unchanged competing decisions fails this gate even if bounded and visually plausible.

Design review conclusion: the consolidation is viable in shape, with the command-frame and action-priority contracts identified before coding. Return translation during protected actions is explicitly user-approved, including visible sliding. Bounded idle return-turn behavior remains a proposed design choice, not verified behavior. This review changes the plan only; implementation and acceptance remain outstanding.


User steering during the contract gate: attacks and emotes may slide while reference return continues. Remove the proposed action-based translation suspension; action ownership gates only autonomous facing and presentation replacement. The source interval still needs a facing-ownership fact because a completed action can have contributed root turning earlier in the same admitted tick. This fact belongs to motion sampling, not an after-the-fact check of whether an action remains active.


Contract gate progress: a temporary proposal harness uses production quaternion/vector math, return gain/timestep, existing completion tolerance, and the real authored motion runtime. Four focused checks pass (`/tmp/character-contract-gate.log`; prototype `/tmp/character_movement_contract_gate.rs`): idle return followed by source-direction resume, bounded requests against a modeled blocked translation, continued correction without action-facing takeover, and a real action completing within its sampled interval. The proposal uses a provisional pi rad/s return-turn rate; that is not a selected production tuning value. Its correction cap matches the checked private 1 m/s runtime constant. The harness was temporarily included in world tests and then removed using an exact fresh-byte backup; no prototype production mode or asset-dependent test remains.

The first numerical run incorrectly asked idle return to converge more closely than the existing 5 cm completion tolerance. At submillimetre distance the general heading helper deliberately returns its default direction, so pursuing numerical zero stalled around .5 mm. The revised proposal uses the existing completion tolerance and leaves actual facing alone on completion, rather than turning back without an ordinary command. This is reuse of the existing completion contract, not a new precision/retry policy. On command resume the prototype immediately requests the source heading; ordinary hard angular clipping remains required during production integration, and sharp resume-facing is a visual tradeoff to assess.

These are limited design checks, not completed integration: the modeled blocked body does not exercise collision queries, and immutable proposal inputs do not prove scene transaction rollback. Existing scene lifecycle/confirmation regressions must cover those contracts through the real cutover. The gate remains open for directive reduction against command orientation, source-interval ownership sampling, and local confirmation integration. No claim that four prototype tests prove the entire consolidation.


### First production cutover — common movement preparation

The preceding goal turn made progress through a checked prototype and updated action concession. This continuation starts the production consolidation without installing autonomous return-facing before its command-frame contract is ready.

`spatial/body_movement.rs` now owns one `PhysicalBodyInput::step` for ordinary and correcting bodies. The separate `return_step` path is removed. Both paths prepare ordinary prediction and contact actuation at one site; `PreparedBodyMovement` replaces the misleading return-only result name. Grounded reference speed selection was removed from `ContactStepActuation::returning`/`with_supported_return`. The kernel now accepts the movement owner's complete supported target, preserving its prepared direct/passive response and heading. Free-flight correction is likewise limited in movement preparation and passed to the kernel as non-retained travel. The shared knobs now belong to that owner as `PHYSICAL_RETURN_GAIN` and `PHYSICAL_RETURN_SPEED_MPS`; old source vocabulary is removed. No new motor, persistent state, feature mode, query, or retry was introduced.

The launch regression now exercises production movement preparation with a reference instead of calling the removed return method directly. Existing long-run grounded and free-flight return tests use the unified path after reference completion too. All world 663 and core 355 tests pass (`/tmp/character-movement-preparation-shared.log`); affected world/core/host all-target warning-denied Clippy passes (`/tmp/character-movement-preparation-clippy.log`). This includes existing local confirmation against newly proved support and transaction-veto coverage. These tests establish preservation across the preparation refactor, not the upcoming command-heading behavior. Host tests and final formatting checks follow.

Remaining ownership gate: grounded orientation still follows the actual body. The next cutover must retain command orientation independently of positional return lifetime, feed that orientation to remote directive reduction, and carry motion-runtime-owned facing permission for the sampled interval. Shared source-world projection is implemented in the follow-up below. No autonomous return-facing is enabled yet. The local source adapter and confirmation contract stay distinct from remote autonomy. The proposed final maintainability acceptance is not yet met; do not describe this preparatory subtraction as the complete holistic controller.


Shared projection follow-up: `ResolvedAuthoredMotion` is a transient projection of the admitted source offset. Actual preparation and grounded nominal prediction consume its same world velocity; neither independently rotates the local offset. Its source offset has one separate consumer: free-flight reference prediction, whose independent orientation is an existing deliberate contract. The standalone actuation entry point projects through the same helper; the collection supplies the already projected value. Positive interval admission occurs before division, without validating the same interval again on the collection path. This prepares the exact seam where retained command orientation can replace the actual-body basis for remote character source motion.

Final verification for common preparation plus projection: world 663/core 355/host 276 pass (`/tmp/character-movement-projection-shared.log`); affected all-target warning-denied Clippy passes (`/tmp/character-movement-projection-clippy.log`). Normal debug host build passes (`/tmp/character-movement-projection-debug-build.log`), as do formatting and diff checks. Temporary diagnostic source markers are absent. No new live session, commit, or autonomous facing policy. The ordinary/return split and kernel return-rate policy were deleted rather than wrapped in another coordinator. Full completion still requires the retained command frame, interval facing ownership, directive integration, and visual acceptance; these checks do not establish those unimplemented behaviors.


### Command ownership cutover — directive progress joins playback

The previous goal turn made verified progress through common movement preparation and one shared authored world projection. This continuation identified a cleaner home for the next retained heading: the existing per-body motion runtime, not another command frame attached to the spatial body's nominal vectors. Ordinary authored playback already advances before the physical transaction. Its command frame must follow that same source timeline; actual correction-facing must not feed it. Physical pose/reference publication and one-shot physical authority-heading consumption remain transactional, while source command advancement is not retroactively rolled back by a later physics veto. Keep this distinction explicit in the remaining fixtures.

Implemented: `BodyMotionRuntime` now retains remote directive identity/progress. `motion/registry/remote.rs` reduces it using caller-sampled body and target facts. The separate `WorldState.server_directed_motion` map and its repeated removal/reinsertion/lifecycle cleanup are deleted. The world samples targets and supplies content; it no longer stores another copy of remote command progress. Existing local server-directed control still uses the same pure retail reducer and its local control lifecycle.

Content rebinding now has one `bind_table` helper: reset table-dependent playback while preserving the entity-owned admitted directive. Entity retirement and explicit authored-runtime reset clear both playback and directive progress together. With absent motion content, no directive state is created independently of an executable playback owner. The old test inspected an internal terminal marker; its replacement verifies that a completed command does not restart after body displacement or motion-table rebinding, but a fresh wire admission does restart it. This directly covers why terminal identity must persist.

World 663/core 355/host 276 pass (`/tmp/character-command-owner-shared.log`). Affected all-target warning-denied Clippy passes (`/tmp/character-command-owner-clippy.log`); normal debug host build passes (`/tmp/character-command-owner-debug-build.log`), as do formatting and diff checks. No extra controller registry, physical velocity, body command-heading field, live client, or speculative facing fallback was added. Retained heading and source-interval facing ownership are still outstanding; this owner consolidation does not yet change visible return behavior.

Next implementation seam: extend this per-body source owner with its command orientation and interval motion sample, then make ordinary remote command reduction and the spatial `ResolvedAuthoredMotion` consume that same source frame. Fresh authority facing must update source orientation once at pose-event admission, not by repeatedly reading an unconsumed physical correction target. New source initialization may use the current admitted body/authority heading, but source orientation must then survive positional-return completion and table rebinding. Source sampling must report action/command facing ownership across the whole interval, including an action completing during it. Attacks and emotes continue return translation and keep their own facing/animation. The local entry point retains its input/confirmation ownership; it does not inherit remote autonomous facing. Avoid introducing spatial command state or a second controller map to solve source-event initialization.


### Retained source frame and return-facing cutover

Implemented after the command-owner consolidation. `RemoteMotionState` in the per-body motion runtime now holds directive progress, next command orientation, and the admitted interval sample. `drive_remote` resolves the directive and advances that same authored cursor; the local `drive` entry relinquishes remote state. `RemoteMotionInput` bundles world-sampled body/target/support/angular facts instead of expanding parallel tuple fields. The source frame follows authored rotation and nominal angular input, never body-observed return or separation. Content rebinding preserves it; explicit runtime reset and local ownership handoff retire it. Ordinary source advancement precedes physics and is not rolled back by a later rejected physical proposal; physical body/reference publication still is.

Fresh admitted pose effects update source heading once through the world mutation boundary. When a source is first installed before physical admission, its initial pose may read the pending physical authority heading; existing sources do not repeatedly poll that value. Character commands retain their independent frame; passive/fixed/free-flight/pose-only directive reduction explicitly follows the body as before. Physical preparation checks the current role again after authored hooks, since hooks can change physical properties during the interval. This is not another permission inferred from animation availability.

`PhysicalReferenceInput::body` versus `::remote` makes the ordinary frame explicit. The client carries the remote interval's frame through scaling/support gating and into `ResolvedAuthoredMotion`; actual and nominal grounded motion consume the same projected source velocity. There is no second command orientation on the spatial body and no new IPC payload. The now-unused public raw-offset accessor on `BodyProjectionResolver` is deleted; pose-only projection retains its own existing source adapter.

Idle/moving/authored selection replaces the prior presentation-only boolean in `BodyMotionRuntime`. Facing and visual consumers share this classification. Active directives, angular source motion, modifiers, actions, explicit poses and transition clips retain source-facing ownership. Sampling includes ownership and motion contribution from both sides of sequence advancement, so an action finishing inside a tick neither loses its root contribution nor gives that interval to autonomous facing. The existing observed cursor cannot mutate the source sample or emit its hooks.

`body_movement.rs` now resolves final facing with movement: source-facing requests use the source frame; idle return turns toward the horizontal error at a named pi rad/s rate and scales return velocity by nonnegative forward alignment. Ordinary source velocity is not scaled. Fresh physical authority facing retains its one-shot priority. Inside the existing 5 cm completion tolerance, idle facing stays where it is. Return translation continues during attacks/emotes/explicit facing as requested; their animation/facing remain protected. Local input never receives remote return-facing.

Tradeoffs: the initial return-turn tuning allows a half-circle in one second and can delay backward return travel while turning. This is a hand-tunable physical policy, not an animation rate or retail claim. Resuming ordinary motion can request a sharp heading change; the existing angular hard-navigation bound still applies. Commands may repeatedly request an unfulfilled absolute heading after a collision, without a queue of angular deltas. Hard-clipped turns and protected actions can still show sliding. None of this proves the separate live movement-rate/scale mismatch fixed, or accepts the previously measured stronger positional crowd pressure.

Focused checks pass: source orientation ignores body return, fresh authority changes it once while keep-heading packets preserve subsequent angular motion, local ownership clears remote autonomy, and an action's completion interval retains its actual root travel and facing. A production scene fixture verifies return progress, source-owned sliding, speed bounds, support, transaction veto, and resume along the source direction. An integration fixture runs real world remote sampling, authored hooks, and scene physics across idle return, curved walking, a fresh authority turn, and stopping; it manufactures no correction error from source/body frame disagreement. These fixtures are asset-free. Evidence: `/tmp/character-return-facing-focused-final.log` and `/tmp/character-return-facing-integration.log`.

All world 667/core 355/host 276 tests pass (`/tmp/character-return-facing-final-shared.log`); affected all-target warning-denied Clippy passes (`/tmp/character-return-facing-clippy.log`). The strengthened final action/root assertion and keep-heading case also pass in the focused suite. Normal debug build and live visual acceptance follow. No commit is authorized. Remaining acceptance is visual behavior and crowd pressure, plus the final whole-diff maintainability review; passing these fixtures does not close those gates.


### Return-facing maintainability and acceptance checkpoint — 2026-09-08

The preceding goal turn confirmed the action-sliding concession but did not advance implementation. This continuation inspected the running process, entered the authorized character through the existing debug client, and resumed the code audit. The normal debug build is verified by `/tmp/character-return-facing-debug-build.log`; the live recorder is `/tmp/character-return-facing-acceptance-events.jsonl`, launched by `/tmp/launch-character-return-facing.mjs` (process handle 85688). The capture reached `in-world`, continued beyond five seconds, and contains dynamic entity publications. Startup alone is not visual acceptance. The user has been asked to check remote stop/resume, attack return, and approaching-mob positional pressure. No relog was needed.

#### Current body and camera traces

One body tick: core admits time before source playback; world samples remote intent, target, source-frame policy and nominal angular input; the existing motion runtime reduces commands and advances one authored cursor. Hooks apply before physical preparation. Core forwards the sampled frame and scaled/gated offset. `PhysicalBodyInput::step` projects ordinary motion once for actual and nominal movement, advances only ordinary reference travel, and resolves return/facing priority. The existing kernel performs ordinary hard navigation, bounded local crowd relaxation, and aggregate corrective navigation. Collection commits physical state and reference continuation together. Core then reconciles changed support at zero source time and supplies accepted supported travel to the observed presentation cursor. Protected actions retain playback; observed motion cannot feed the next ordinary source interval or emit its hooks.

Camera registration remains an explicit world-owned operation. `ClientCameraService::start` installs controller identity and clears old query input; active-world permission is independent of data availability. World publication supplies a coherent immutable scene input. A dedicated worker advances the controller under its lifecycle lock and publishes before releasing that lock. Direct orbit/clearance input reaches the same controller without the entity command queue. Reset revokes permission, removes query input, and retires the controller together; worker teardown joins the worker and resets outstanding handles. Retaining permission separately from optional input is intentional: missing scene data delays solving without redefining command permission.

The two support-reconciliation body lookups were consolidated. The function now retains the entity it already validated, reads the optional body once, and derives pose/frame policy from that same body. The impossible second entity-disappearance branch is deleted. No new controller abstraction or fallback was added. Source-frame comments now explicitly distinguish independent character commands from body-following passive/free-flight sources.

#### Retained state and named consumers

| Owner / state | Consumer and lifetime justification |
| --- | --- |
| Remote source `rotation` | Command reduction and next interval projection. Survives positional return completion and content rebind; fresh admitted authority can replace it. |
| Remote source `directive` identity and optional active reducer state | Remote command reduction. Terminal identity prevents an unchanged completed command restarting after displacement. Deleted with playback/entity lifetime. |
| Remote source `sample.offset` and `sample.frame` | Core's physical source adapter. Retains the completed interval while the source orientation has already advanced; includes explicit facing ownership even when no motion contributed. |
| Remote source `omega` | Source interval integration and facing ownership. Supplied with each admitted source sample; not contact-clipped physical angular continuation. |
| Motion runtime table ID, commanded state and sequence | Content selection, ordinary root motion and hooks. Rebinding resets content state while preserving admitted remote intent. |
| Motion runtime `locomotion_policy` and optional observed playback | Shared resolved classification for facing/presentation; independent visual cursor samples accepted travel without supplying physical source or hooks. |
| Motion runtime last tick | Physics-hook delivery and source consumers. Observing locomotion does not overwrite it. |
| Motion runtime retained run multiplier and unmodelled channels | Existing retail speed selection and deduplicated content diagnostics, respectively. Neither stores reconciliation policy. |
| Motion runtime steady order, action queue, active action, rejected actions | Existing selector/action lifecycle and producer-context diagnostics. Return does not add a second action scheduler. |
| Physical pose and retained vectors | Accepted collision/navigation state. Contact displacement remains separate from momentum. |
| Nominal vectors and reconciliation state | Ordinary prediction and bounded return completion. Physical pending authority heading is consumed transactionally once; source authority heading is admitted once on its separate playback timeline. These are different consumers/lifetimes, not competing heading owners. |
| Collection actuator input, copied reconciliation, nominal velocity | Tick-local transaction preparation and publication. No additional cross-tick motor state. |
| Kernel working geometry, response, paths and observations | Tick-local hard navigation, mobile relaxation and final publication. Supported travel includes accepted separation for gait, never retained physical velocity. |
| Camera controller, permission and latest input | Identity/input/placement, explicit world lifecycle, and coherent query snapshot respectively. No scene-availability-based registration or reset. |

The repeated physical-role check at source sampling and after hooks is justified: authored hooks can change the body classification between those phases. The `Body` versus `Remote` source contract is also intentional: missing authored content does not grant autonomous facing. Shared content/action classification supplies the facing decision; no consumer guesses it from nonzero travel. A protected action can still slide, per the user concession.

The contract, clean-cutover and presentation checkboxes above are now backed by production code plus retained integration tests, rather than the temporary prototype alone. Named coverage includes `remote_source_heading_follows_authority_and_commands_not_body_return`, `remote_action_interval_keeps_facing_and_root_motion_after_completion`, `remote_return_faces_its_journey_but_source_facing_can_slide`, `remote_command_sampling_and_physics_share_the_frame_after_return_and_authority_turn`, and the existing `confirmation_uses_newly_proved_support_before_movement`. Source/frame integration and transaction-veto coverage are separate claims; a rejected physical proposal deliberately does not rewind already-admitted source playback.

#### Size and remaining acceptance

The cumulative worktree diff at this checkpoint, including untracked files and before this documentation addition, is +22,931/-8,723 lines across 102 files (net +14,208). A path-based split assigns +7,458/-38 to dedicated test/harness paths and +3,142/-133 to Markdown; other paths account for +12,331/-8,552 and include embedded Rust tests. Therefore the latter is **not** an exact production-code count. This is a larger overall change, not net subtraction. The deleted directional contact module, collapsed ordinary/return preparation and deleted separate remote-command map are real mechanism removals; the support/navigation machinery, observed presentation and regression coverage are real additions. Counts alone do not establish simplicity or justify further additions.

Old source vocabulary (`return_step`, `ContactReturnInput`, `with_supported_return`, old return-rate names, and the removed remote-command map/type) is absent from surviving Rust/TypeScript and architecture docs. Historical plan entries deliberately retain the old terms to explain decisions. The support-reconciliation cleanup passes 23 focused remote tests (`/tmp/character-return-review-tests.log`); prior full suites remain world 667/core 355/host 276. Warning-denied affected Clippy and formatting are rechecked for this cleanup. This pass does not substitute for the remaining cumulative frontend/publication review or user visual acceptance. The separate observed player rate/scale mismatch and stronger positional crowd pressure remain explicitly unaccepted; return-facing is not proof those are fixed.


The final bounded frontend/publication retrace is complete for the cumulative movement change: core publishes accepted body movement, host adapters preserve the existing motion envelope, and the frontend classifies clip installation versus cadence-only retiming. Cadence changes preserve the installed phase; protected clip selection remains upstream in the motion runtime. The retiming branch consumes the prior fractional frame interval before changing its rate, so it cannot replay earlier hooks. Explorer's epoch allocation and actual send remain under one short delivery gate; camera-only publication does not acquire the entity simulation gate. These conclusions come from the current core/host/frontend sources, together with the earlier accepted camera/publication tests and browser checks; no frontend/IPC changes were introduced by the command-frame cutover. The bounded maintainability checkbox is closed, not a claim that unrelated APIs have all been rewritten. Further cleanup needs a concrete ownership defect rather than a line-count target.

Current cleanup verification: 23 focused remote tests, affected all-target warning-denied Clippy, `cargo fmt --all -- --check`, and `git diff --check` pass. Logs are `/tmp/character-return-review-tests.log`, `/tmp/character-return-review-clippy.log`, and `/tmp/character-return-review-format.log`. The dependency-only binrw future-incompatibility advisory persists. A normal debug rebuild is recorded separately in `/tmp/character-return-review-debug-build.log`; the running acceptance client uses the behaviorally identical executable from before the redundant-lookup/comment cleanup. The only open consolidation gate is practical visual acceptance, including the already-recorded crowd-pressure tradeoff. No user acceptance has yet arrived, and the goal remains open.

Normal debug rebuild passed. Final live-process poll confirmed handle 85688 still running; capture contains 1,425 dynamic entity publications and no recorded browser exceptions at this checkpoint. This establishes a functioning acceptance session, not completion of the pending user playtest.


#### Live coverage check — awaiting the requested scenario

The preceding continuation made implementation/review progress. Process handle 85688 is revalidated live in this continuation. A bounded extraction of the existing capture (`/tmp/summarize-return-facing-acceptance.py`, output `/tmp/character-return-facing-acceptance-summary.json`) establishes that the current session does not yet cover the requested visual acceptance. At extraction, local player 0x50000002 has 804 samples at one pose; remote player 0x50000001 is absent. Olthoi Warrior 0x80000b83 has 576 samples, 572 grounded after initial unknown state, with only 0.150 m total Y extent and unchanged X/Z. Its published clips alternate holds and loops. The summed 4.17 m travel is repeated small motion, not net return progress or proof of an attacking reconciliation. No source trace attributes it to correction, so do not infer one from its speed or animation.

No new physics change is justified by this idle coverage. The pending user scenario remains remote move/stop/resume, visible return during action, and crowd-pressure feel. The current client stays open for it; there has been no relog, new instrumentation in production, or acceptance response. This is the first continuation after the completed bounded review to reach an impasse on that external acceptance. Do not substitute more idle captures for the required behavior.


Acceptance blocker confirmed across three consecutive continuations after the implementation/review work: the recording still has no remote player and the controlled player remains at one pose (952 samples in the latest check). Process handle 85688 remains live, with 2,173 dynamic publications and no recorded browser exceptions. The previous turn was a verified wait, not additional implementation progress. No feedback has arrived on return appearance or crowd pressure. The goal is blocked on that external playtest, not complete. The debug client remains open for the user; no repeated login, speculative tuning, or additional idle-capture campaign is needed. Resume from the existing capture and feedback when available.


### Translation-only return — user-approved refinement

The user exercised the prior debug client and observed remote overshoot followed by turning and slowly walking back, leaving the settled body facing the correction direction. This rejects the return-facing acceptance gate. The user prefers preserving command heading with sidestep/backstep presentation rather than adding a final heading-restoration phase.

Implemented subtraction: remove autonomous return turning, its turn-rate knob, forward-alignment slowdown, and interval-facing permission. `RemoteMotionSample` now carries the source rotation directly; the one-field frame wrapper is deleted. Ordinary content classification only selects presentation permission, so idle/moving/authored classification collapses back to the existing observed-locomotion boolean. Command rotation still advances separately from collision-clipped actual orientation and feeds both nominal and ordinary actual motion. Fresh authority keeps its one-shot priority. Root contributions from an action finishing during the tick remain sampled before/after advancement, independently of deleted facing permissions. Attacks/emotes continue translating under protected playback.

No new gait selector is needed: `observed_locomotion_order` already converts accepted travel into body coordinates, selects sidestep/backstep where available, and retains existing content fallbacks. Missing sidestep content can still slide; missing backstep content reverses available forward gait. Diagonal motion uses the dominant direction rather than skeletal blending. Overshoot/rate mismatch is not claimed fixed by this presentation policy.

The production return regression now covers lateral and backward targets, requires unchanged command rotation throughout return and after completion, and retains bounds, support, nominal-zero, transaction-veto and source-direction resume checks. The obsolete facing-permission assertions are removed from action sampling tests; actual final-interval root contribution and presentation/source isolation remain tested. Existing gait and action-priority tests cover the unchanged observer. No second heading correction, solver pass, animation cursor, or persistent correction state is added. Updated live acceptance remains required.


Validation checkpoint: core 355 and host 276 tests pass. The first world run caught one integration assertion expecting the removed return-facing behavior; it now requires the source heading after settling, matching the lateral/backward production regression. World rerun follows in `/tmp/translation-return-world-final.log`. Affected all-target warning-denied Clippy and normal debug host build pass (`/tmp/translation-return-clippy.log`, `/tmp/translation-return-build.log`). Old turn-rate, facing-permission and frame-wrapper vocabulary is absent from surviving code/architecture docs. The previous live client was already closed (handle 85688 terminal exit 0 confirmed at 23:22:18 UTC); wait at least 60 seconds from that observation before login. The updated launcher and capture have distinct `/tmp/translation-return-*` names to preserve the rejected playtest evidence.


Final translation-only checks pass: world 667/core 355/host 276, warning-denied Clippy, normal debug build and diff checks. Updated debug client handle 1351 is running and recording `/tmp/translation-return-acceptance-events.jsonl`. It reached in-world before the attempted character-selection click (that diagnostic found no selection button and made no change); captured lifecycle and subsequent dynamic publications confirm successful entry. User playtest remains open. No commit was made.

### Scoped follow-up — sticky target motion and correction hysteresis

Scope only; implementation is not started. User accepts translation-only correction as visually better, then reports attacking mobs remaining behind while retail shows them beside the attacked player. Source inspection proves a missing command: protocol `MovementInvalid::sticky_object` is decoded but not retained by `EntityMotionSnapshot::from_movement_event` or consumed by movement. This establishes a missing feature consistent with the report; the individual reported mob's packets have not been attributed.

#### Requirements and source contracts

- ACE `WorldObjects/Monster_Melee.cs:370-379` emits `StickToObject` (except AI-immobile) and the melee target GUID. `Player_Melee.cs:420` uses the same mechanism. The command, not the attack animation, grants target-following movement and facing.
- Retail `acclient.c:326049-326086` cancels prior movement/stickiness on replacement movement admission and installs the supplied sticky target after interpreted state. Re-reading a retained snapshot must not renew its lifetime.
- Retail `371536-371561` installs a one-second target lifetime; `371244-371273` expires it; `371564` handles target loss. This is a source-backed command lifetime, not a load/recovery timeout. Audit renewal and local-control cancellation before implementing a clock; use monotonic elapsed time rather than simulation-time debt.
- Retail `371427-371508` replaces horizontal offset and heading to approach target cylinder clearance, nominally radii plus 0.3 m. Rate is five times motion-interpreter maximum speed, with a 15 m/s fallback. These are reference behavior, not permission to double-apply object scale. `371277-371292` applies sticky after interpolation, so simply adding pursuit to attack root travel and an old positional return would reproduce neither the priority nor the range behavior.
- Existing hard geometry, stairs/support/edges, mobile work limits, incoming-player braking-only response, action/hook ordering, and one physical body remain mandatory. Sticky facing is explicit commanded facing; ordinary positional return remains translation-only. No inferred pursuit from attack clips, pathfinder, teleport-to-target, recursive chasing, second motor, or extra sweep.
- Current physical correction retires at 5 cm plus a relative-velocity threshold, but starts on every fresh reference. Introduce genuine positional start/stop hysteresis while preserving independent heading admission and ordinary prediction.

#### Proposed implementation boundary

1. **Preserve explicit sticky intent and admission identity.** Extend the existing entity movement representation to retain the target on interpreted movement and initial object descriptions. Represent mutually exclusive direct MoveTo/TurnTo versus sticky targeting as one source-command choice where practical. Keep sticky alongside ordinary attack playback, not as an animation command or an independent world registry. Fresh replacement renews/replaces/cancels the command; stale packets, snapshot rereads and content rebinds do not. Include successful `MoveToObject` with the Sticky parameter in the same lifecycle audit so it cannot create a second target-follow mechanism.
2. **Resolve target movement in the existing movement pipeline.** Sample target pose/geometry once from the admitted scene snapshot; no querying another body's future solve. Sticky chooses horizontal travel to melee clearance and facing toward the current target, replacing ordinary horizontal root travel while preserving action advancement and hooks. Feed the resulting request through existing navigation and contacts. Local manual control must retain its explicit cancellation/authority rules; do not blindly apply remote autonomy to the controlled player.
3. **Make nominal prediction and sticky pursuit agree.** Derive ordinary target-directed translation using the actor's independent nominal/reference origin when it has one, then share the resulting world-space source motion between nominal and actual movement. Facing is the command's bearing from the actual body toward the sampled target. Bounded positional return closes the actual/reference difference; it must not steer back toward a frozen pre-pursuit location. When sticky ends, ordinary playback resumes using the last commanded heading and current reference, without replaying prior offsets. This composition must pass the first gate below before committing to a field/API shape. Retail's interpolation override is evidence of priority, not authorization to copy its collision-bypassing placement.
4. **Add positional hysteresis at reconciliation ownership.** Proposed hand-tunable defaults: start return beyond 20 cm, stop within the existing 5 cm once relative velocity settles. Preserve returning versus watching across fresh reference updates; a new heading still applies once inside the positional dead zone. Keep the dormant reference so repeated small errors accumulate against the same target rather than being forgotten every tick. Distinguish retained reference from active correction work in scheduling: a close, stopped entity must still settle/sleep. Fresh authority, contact displacement and ordinary movement re-evaluate the threshold. Launch/free-flight and local confirmation retain their current policies in this first refinement; scope the new hysteresis to remote supported characters.

#### First gate — bounded analytical checks and fixtures before cutover

- Trace one fresh/stale/repeated sticky packet, renewal, replacement without the flag, target replacement/loss, timeout, removal/teleport, content rebind and local ownership handoff. Confirm the initial-description path and MoveTo completion Sticky path. If a case needs another controller map or implicit renewal from data availability, revise the representation first.
- Exercise one attack interval with root translation/turning and hooks. Sticky must select one physical translation/facing request while the authored cursor emits hooks once. Attack completion and zero-time support reselection must not double-apply movement or renew intent.
- Analytically integrate a target walking away, an actor displaced from reference, a blocked actor, and a target itself displaced by contacts. Actual ordinary and nominal world motion must agree; the reference must converge to target range rather than drift through it or remain at the old attack location. Target sampling must not recurse. Check scale and cylinder geometry at the owner that already resolves them. Do not proceed if this requires a second independently advanced pursuit pose.
- Walk errors across the proposed 20/5 cm band, including many small pushes, repeated packets within the band, heading-only updates, relative velocity at completion, sleep/wake, target switching and transaction rejection. Retained reference alone must not force permanent active simulation. Use named runtime constants in tests.
- Verify hard wall/corner and step blocking, finite coincident-center behavior, target height/landblock conversion, supported-to-airborne transition and return after sticky expiry. Missing targets stop supplying pursuit; never invent a destination or teleport to recover.

#### Execution and acceptance

- [x] Complete the lifecycle/composition gate above; record any justified divergence with the required retail citation and content scope. Do not silently select guessed timeout/range/scale behavior.
- [x] Preserve sticky admission and feed target intent through the existing owner; remove any replaced command/offset path in the same change.
- [x] Implement remote supported positional hysteresis with explicit active work and sleeping behavior; no new recovery timer.
- [x] Run focused asset-free packet/lifecycle, pursuit/reference, contact and action tests; affected world/core/host suites, warning-denied Clippy, formatting and debug build.
- [x] One bounded debug playtest: attacked player walks away/around a corner, attacker follows and faces while retaining attacks; replacement/expiry stops it; small positional error remains quiet; a larger error returns without changing command heading. Respect relog delay and settle at least five seconds after world entry.
- [x] Review retained fields and deleted paths. No new generic priority framework, persistent velocity channel, repeated target lookup inside contact passes, or frontend/IPC policy. Update architecture docs and this plan with actual outcomes.

Tradeoffs: up to the start threshold of positional disagreement is intentional; gait remains approximate with existing missing-content fallbacks. Retail-like sticky pursuit can be fast and visually slide during attacks. Hard blockers and crowd contacts can prevent reaching melee range even while server attacks continue; no client-side guarantee of authoritative hit positioning is possible under intentional local displacement. A one-second source lifetime requires timely renewal; packet loss must not become endless pursuit. Initial movement-rate/scale overshoot remains a distinct issue, not proven repaired by sticky handling or hysteresis. This is a bounded follow-up in the existing architecture, but the reference/target composition and command lifetime must pass before broad implementation.

#### Sticky first-gate progress — lifetime and nominal-origin counterexample

The preceding turn scoped the follow-up; this continuation begins its analytical gate. Retail adds an action boundary to the previously recorded lifetime: `CMotionInterp::MotionDone`, `acclient.c:329942-329961`, unsticks when an action-class pending motion completes. `MovementManager::HandleExitWorld` does likewise for pending actions (`325934-325954`). Sticky state must therefore be owned alongside command/action progress and retired by actual selector completion, not only by a wall-clock deadline or an unchanged entity snapshot. Preserve the final admitted action interval's movement before retirement. Replacement movements unstick before installing new commands (`326049-326086`); failed target updates clear the target (`371564-371585`). Initial object-description admission and queued-action replacement still need fixture coverage before this lifecycle gate is closed.

The MoveTo completion path is also real: ACE `Physics/Managers/MoveToManager.cs:334-344` transfers a successfully completed Sticky-flagged object move to `PositionManager.StickTo`. Our pure directed reducer currently returns only `Complete` and no successor target effect. Do not implement a second sticky owner just for that handoff. Extend the existing terminal outcome/command lifecycle so completion can establish sticky intent once, while retaining terminal admission identity against replay. Confirm local controller consumption in the same change.

Speed selection must distinguish retail `get_max_speed` (`329792-329808`) from the existing adjusted interpolation-speed helper (`329812-329837`): the latter may use current forward speed, while sticky uses the run-rate-derived maximum. Do not reuse the adjusted helper solely because its units match. The ordinary root offset is scaled before retail position-manager adjustment (`308262-308298`), so sticky distance is already physical distance and must not be object-scaled again downstream.

A scalar executable counterexample (`/tmp/sticky-reference-gate.py`) checks the proposed shared ordinary-translation composition before collision integration. With a target that moves then stops, using the nominal/reference origin converges both free actor and reference to melee clearance. With an actor blocked at x=5 and target clearance x=15, the reference stops at x=15 and error remains bounded at 10. Recomputing pursuit from the blocked actual pose and applying that same travel to nominal instead sends the reference to x=448 after 30 seconds: 433 m beyond target clearance. This is an analytical example with explicit test-owned speed/clearance and a simple clamp, not production or collision evidence. It disproves the tempting actual-origin/shared-offset variant and supports the reference-origin design; it does not close 3D frame, scale, action, collision, or target-lifecycle integration gates.

Hysteresis audit confirms two current scheduling consumers must change with dormant-reference retention: `PhysicalBodyInput::prepare` wakes on `has_pose_reconciliation_work`, and collection quiet detection currently requires `body.reconciliation.is_none()`. Keep `is_empty` as allocation/lifetime state, but make active projection work explicit and use it consistently for wake/settle. A retained watching reference must still advance ordinary prediction and be re-evaluated after accepted separation. This is a named two-consumer contract, not permission to add another scheduler. The first gate remains in progress; no production behavior has changed in this continuation.


#### Hysteresis cutover — implemented; sticky integration remains open

The scheduling gate was traced through actual collection construction and publication. Sleeping mobiles skip ordinary actuation but still emit contact updates. A watching reference can therefore detect accumulated displacement during `finish_physical_tick` and activate return for the following tick without another wake scan. This one-tick activation delay for sleeping contact displacement is deliberate; fresh heading remains an independent wake reason.

Implemented `PhysicalReturnActivity` inside the existing physical reference: Continuous preserves passive/flight behavior; Watching retains reference without positional work; Returning continues to the existing position/relative-velocity completion band. The supported-character movement owner selects this policy after resolving current support. Fresh position updates preserve activity so they cannot reset a returning body to watching merely by falling below the start threshold. Accepted contact publication can activate Watching after accumulated displacement exceeds the named 20 cm start threshold. Return stops at the existing 5 cm completion band. The reference allocation is retained while watching; quiet detection now asks active projection work instead of absence of reconciliation data. No new timer, velocity, controller map, or solver pass.

Initial tests exposed two old expectations requiring sub-20 cm displacement to return to 5 cm. The braking fixture now starts outside the named start threshold and still verifies completed braking. The small-contact sleeper fixture now checks tolerated error, retained original reference, unchanged subsequent pose, and actual Settled scheduling. A new state regression covers accumulated small displacement, fresh packets during active return, one-shot heading inside the dead zone, preserved dormant reference and transition back to continuous flight policy. All 668 world tests passed before strengthening the sleeper integration assertion; affected shared suites and warning-denied Clippy are running for that final version.

Sticky handoff remains the next implementation gate: both remote registry and local MovementSystem consume `ServerDirectedMotionResolution::Complete`. The reducer must emit a single successful sticky successor for object moves with the flag, including final-turn completion, and neither consumer may restart it from retained terminal identity. Attack completion and elapsed lifetime must retire the same source-owned target. No sticky behavior is implemented yet, and no updated live acceptance is claimed for hysteresis.

Final hysteresis checks pass: world 668/core 355/host 276 (`/tmp/hysteresis-shared-tests.log`), affected all-target warning-denied Clippy (`/tmp/hysteresis-clippy.log`), formatting and diff checks. The normal debug build is recorded in `/tmp/hysteresis-debug-build.log`. Live client replacement is deferred until the sticky cutover is ready, avoiding an unnecessary relog between the two scoped changes. No commit or goal-completion claim.

#### Sticky admission and shared-owner gate — implementation seam resolved

The previous continuation implemented and verified hysteresis. This continuation traced packet admission and both source adapters before adding sticky state. `Entity::reduce_remote_movement` rejects stale movement/instance epochs; an older server-control epoch can advance only the movement sequence. Only `EntityMovementAdmission::Applied` installs a new snapshot. Within Applied, `motion_changed` can be false for a fresh byte-identical command. Therefore sticky renewal/cancellation must consume Applied admission even when no presentation change is published. It must never run from Rejected, MovementSequenceAdvanced, repeated snapshot sampling, zero-time support reselection or content rebinding. `handlers/movement.rs` already has the exact Applied boundary before action enqueue and conditional presentation publication.

The existing local `MotionRuntimeRegistry::drive` clears remote source state. Accordingly sticky lifetime cannot live only inside `RemoteMotionState`: it belongs in the shared `BodyMotionRuntime` alongside action lifetime, with a single admission/retirement entry point used by local and remote sources. The remote source frame and directed-command progress stay where they are. Fresh source admission carries the interpreted sticky target, direct-command replacement, or explicit no-target cancellation; action completion expires the shared target after the completed interval is sampled. Initial object-description installation needs a one-time seed at entity/runtime initialization, with a receipt timestamp, not a fresh timer every time missing content is retried. The normal monotonic clock is available at world ownership; thread it explicitly rather than advancing the deadline with capped simulation dt.

Typed MoveTo completion remains a shared reducer result consumed by exactly two owners: remote runtime and local MovementSystem. It should carry an optional successful sticky successor derived by the reducer from the completed object target and Sticky flag. Both final-turn completion and direct arrival must pass through that same completion helper; TurnTo, failed movement and position-only fallback complete without a successor. The recipient installs it once and keeps terminal command identity against replay. This avoids each adapter rediscovering the flag/target independently. Retaining this successor in an unused field or merely logging it is not a completed handoff.

Remaining first-gate obligations before the sticky cutover: explicit initialization time through initial-description/content-delay paths; final-interval sampling before action retirement; scaled target geometry and unadjusted run-speed producer; local manual-input cancellation; real reference-origin/world-frame fixture. The prior scalar counterexample supports the reference-origin math but is not a substitute for those contracts. No new sticky production behavior or live result is claimed by this ownership checkpoint.

#### Content-admission boundary — bounded concession and reduced representation

Current code has no entity receipt clock, while `enqueue_entity_motion_actions` already requires executable motion content at admission and reports unsupported admissions without replaying them when content arrives later (`state/motion_resolution.rs:407-449`). Requiring deferred sticky initialization alone would create a second entity-owned command/timestamp lifetime solely for a body whose ordinary action could not execute. Use the existing explicit unsupported-content policy instead: install/renew stickiness into the shared playback owner at fresh Applied admission when its motion content is available; otherwise report the unsupported command and require a fresh admission. Do not invent a receipt time when playback eventually starts. Initial object-description stickiness follows the same one-time admission rule when the description is applied. This is a bounded missing-content concession, not a new timer or an implicit delayed fallback.

Consequent implementation simplification: the ordinary `EntityMotionSnapshot` need not become a second storage owner for active sticky lifetime. The admitted interpreted payload already contains the exact target. Deliver that target (or replacement cancellation) through the existing world-to-motion-runtime event boundary, before conditional motion-change publication. Keep target/deadline and the completed interval sample in the body playback owner, shared by local and remote source adapters. Sample target intent before advancing an interval and retire active stickiness on its action-completion boundary afterward; the sampled final interval remains available for physical preparation. A zero-duration support reconciliation must preserve the already-consumed interval sample and cannot renew the deadline. Manual input cancellation must use an explicit source-control edge, not every ordinary local `drive`, since server-authored local actions also advance through that entry point.

This resolves the delayed-content gate without another registry or timestamp on every entity. Actual target movement, command handoff, and the production admission/cancellation implementation remain outstanding. The existing code is still at the verified hysteresis cutover; this source audit does not claim sticky behavior has landed.


#### Sticky command lifetime — first production cutover

Implemented `motion/registry/sticky.rs` under the existing body playback owner. One active target/deadline and one completed-interval target distinguish future command lifetime from the final interval already admitted to physics. Fresh Applied movement admission in `handlers/movement.rs` renews or cancels before the motion-changed publication check. Rejected/stale admissions return before this boundary. Missing motion content cancels and reports the unsupported command, following the scoped content concession. No extra world/entity map or receipt timestamp was added.

Positive-duration authored drive samples the target using monotonic elapsed time; zero-time support selection preserves the sampled interval. Actual action completion clears active stickiness after sampling, leaving its final interval available. Content rebind preserves the lease without renewal; entity retirement drops it with playback, and remote initialization/reset clears it. Explicit registry cancellation clears both active and sampled intent. Local drive itself does not cancel, because the same entry advances server-authored local actions; manual input cancellation remains an explicit outstanding adapter edge.

This is deliberately an intermediate cutover: the target getter's physical consumer is the next movement-preparation integration; no pursuit translation/facing is produced yet. Initial object-description admission, MoveTo Sticky successor, target-loss handling, local manual cancellation and physical target geometry/speed resolution remain unfinished. Do not close the feature or live gate from lifetime tests alone.

World 671 tests pass (`/tmp/sticky-owner-world.log`), including lease renewal versus sampling, final-action interval retention, explicit cancellation, and zero-time selection. Affected all-target warning-denied Clippy passes (`/tmp/sticky-admission-clippy.log`); formatting/diff checks pass. The final remote-reset cleanup is checked separately next. Existing broad movement behavior is unchanged until the target sample reaches physical preparation. No live relog or commit was performed.

#### Sticky MoveTo handoff — shared completion contract implemented

`ServerDirectedMotionResolution::Complete` now carries its optional sticky successor. One `complete_move` helper derives it from a successfully resolved object target and the Sticky flag; both arrival and final-turn completion use that helper. Position commands, missing-at-admission object fallbacks and TurnTo complete without sticky targeting. The remote playback owner admits the successor before sampling its next interval and retains terminal directive identity, so snapshot rereads cannot renew it. The local MovementSystem consumes the same result through the world admission method and retires its completed MoveTo state. Neither adapter re-derives the flag or target.

The source citation is retail `MoveToManager::BeginNextNode`, `acclient.c:331674-331688`, corroborated by ACE `MoveToManager.BeginNextNode`: after all nodes complete, the Sticky flag selects the target handoff. A test matrix covers resolved/fallback targets with and without the flag; another checks that arrival with an unfinished final turn remains active before emitting the successor. Its initial fixture used an incorrect absolute heading for this project's bearing convention; the corrected fixture adds the authored relative angle to `WorldPosition::heading_to`, without changing production heading policy.

Explicit queued local replacement input now cancels sticky intent once at command ingestion; ordinary local playback ticks still do not. This covers manual set/pulse, explicit stop and replacement autonomous/transient intent at their existing shared queue boundary, rather than inferring cancellation from per-tick movement magnitude. Direct non-autonomous server movement replacement continues to cancel at accepted network admission.

Core 355 and host 276 tests pass in `/tmp/sticky-handoff-final-tests.log`; world final rerun after the fixture correction is `/tmp/sticky-handoff-world-final.log`. Affected all-target warning-denied Clippy passes (`/tmp/sticky-handoff-clippy.log`), formatting/diff checks pass. Initial-description admission, target-loss handling and physical pursuit/heading composition remain outstanding. No new visible pursuit behavior, live restart or commit is claimed at this intermediate boundary.

#### Initial-description sticky admission — implemented

Description motion decoding now returns its steady snapshot and sticky target together. `Entity::apply_description` installs the snapshot and returns the decoded target to the world handler; it does not retain another active command or timestamp. After the entity creation disposition is accepted, the inventory/ObjectCreate handler admits that target through the same executable-content policy as fresh UpdateMotion. Delete-requested creates return before admission. The player handler's existing style-only consumer reads the snapshot portion of the same decoder result. No extra sticky-only byte parser was added.

An asset-free packed-description fixture checks the actual wire flag/GUID decode, Entity hydration and returned target. The initial targeted check passes (`/tmp/sticky-description-focused.log`); affected shared suites and warning-denied Clippy are running in `/tmp/sticky-description-shared.log` and `/tmp/sticky-description-clippy.log`.

Physical target geometry evidence: ACE `Physics/PhysicsObj.GetRadius` delegates to `PartArray.GetRadius`, whose implementation is `Setup._dat.Radius * Scale.Z` (`Physics/PartArray.cs:204-207`). The DAT model retains this authored radius separately from its collision spheres (`holtburger-dat/src/file_type/setup_model.rs`). Therefore pursuit preparation must carry the declared radius through existing prepared entity geometry and apply current object scale once. It must not approximate melee clearance with the primary movement sphere radius or reuse the MoveTo use-radius property. This is the next physical integration seam, not a new collision-query or solver requirement. Target movement/facing remains unimplemented; no live acceptance or goal completion is claimed.


### Consolidated scope — target following, facing, and quiet reconciliation

This section consolidates the current follow-up scope. Earlier implementation checkpoints remain historical evidence. At this scoping checkpoint, command admission/lifetime, initial descriptions, MoveTo handoff and positional hysteresis exist. Physical sticky preparation is partially written and `cargo check -p holtburger-core` passes (`/tmp/sticky-physics-check.log`), but core does not yet produce `PhysicalReferenceInput::Sticky`. Visible pursuit is therefore unfinished, not validated by compilation. This scope update makes no production changes.

**Outcome:** an explicitly sticky attacker follows and faces its target while its action keeps playing; ordinary positional return preserves commanded heading and ignores small positional disagreement.

1. Finish one source-to-body path. The existing playback owner retains the admitted target and lifetime. Prepare target pose, scaled authored setup radii and source-derived speed once per tick. Sticky replaces ordinary horizontal authored movement and selects target-facing heading; action advancement and hooks still run exactly once. Feed the request to existing hard navigation and mobile contacts. Do not add a pursuit controller, another solver pass, or attack-animation-based targeting.
2. Complete reference and heading composition together. Reference-origin pursuit supplies the same ordinary world-space travel to actual and nominal bodies, preventing blocked-body reference runaway. Reconciliation closes their remaining difference. Record sticky facing in the existing command frame so expiry does not restore pre-attack heading. Positional return itself never turns the entity. Preserve heading for coincident horizontal positions, where target bearing is undefined.
3. Close lifecycle integration. Fresh accepted commands can renew, replace or cancel intent; stale commands and repeated sampling cannot. Target loss, removal/reset, action completion, expiry and local manual replacement retire it through the same owner. Preserve the completed action interval. Missing executable content follows the documented report-and-require-fresh-admission concession. Audit supported, airborne and fixed-body eligibility explicitly before connecting the producer; a sticky command must not silently bypass launch or physical-role rules.
4. Keep the implemented supported-remote return band: start beyond 20 cm, stop within 5 cm once relative motion settles. Retain the reference while dormant, allow new authoritative heading inside the band, and permit sleeping. Attacks/emotes retain presentation priority while movement may slide underneath.

**Pre-live acceptance gate:** use asset-free fixtures through the production preparation boundary for a moving target during an attack, retained facing after expiry, a wall-blocked actor with bounded reference, actor/target scale applied once, coincident horizontal positions, target disappearance and command replacement. Verify hooks are neither repeated nor suppressed, attack playback remains selected, local cancellation works, and no second physical movement is added from authored attack translation. Resolve the exact maximum-speed producer from retail before wiring it; the adjusted interpolation-speed helper is not automatically equivalent. Reject any implementation that needs a second persistent target owner or reads future solved target poses.

**Completion gate:** run affected world/core/host tests, warning-denied Clippy, formatting/diff checks and a normal debug build. Review new fields for actual consumers and consolidate temporary paths. Then one bounded live test: move the attacked player away and sideways, stop, and pass behind hard geometry; check pursuit, facing, action continuity, quiet small corrections and cancellation. The observed stuck attacker has not been individually attributed to a sticky packet, so this fixes a proven missing command without promising that every similar symptom shares its cause.

**Tradeoffs:** small settled position disagreement is intentional. Attack-time travel may slide and retail-derived pursuit can be fast. Walls, ledges and crowds still take precedence over reaching the target; no pathfinding or teleport recovery is added. Existing velocity/scale overshoot is a separate unresolved concern. The implementation should add command semantics and reuse movement policy, not expand the collision architecture.


#### Physical pursuit preparation — executable gate progress

The previously scoped physical input cutover compiles across the affected consumers. Fixed a surviving fixture's access to the old authored-offset field after its conversion to a command enum. Three asset-free tests now exercise the actual sticky projection function: a blocked actual body with 30 seconds of reference advancement stops at target clearance; physical displacement changes facing without changing nominal-source translation; vertically separated bodies at identical horizontal coordinates preserve heading. This replaces the temporary scalar script as evidence for the production projection math, although target resolution and full action integration remain separate gates.

The integration audit found that pending authority heading would overwrite explicit sticky facing in the common preparation path. It now consumes that pending authority once while allowing sticky facing to own the admitted interval. A real dynamic-collection regression verifies grounded movement, nominal velocity and target-facing orientation despite a conflicting pending authority heading. This is source-command precedence, not permission for ordinary positional return to turn a body.

Affected suites pass: world 678/core 355/host 276 (`/tmp/sticky-physical-shared.log`); the eight focused sticky tests pass (`/tmp/sticky-physical-gate.log`). Warning-denied Clippy is recorded in `/tmp/sticky-physical-clippy.log`. No live client replacement or commit. The live producer is still outstanding: sample target geometry/rate once, retain sticky heading in the source timeline, and handle target loss and physical-role/launch eligibility without suppressing unrelated ordinary motion. Do not infer full feature completion from the physical-input fixture.


#### Sticky live producer — connected, pre-live verification remains

`WorldState::prepare_sticky_body_targets` now resolves one transient map before collection mutation. It reads the sampled command from the existing motion runtime, cancels absent targets, samples both authored setup radii at current object scale, and wakes eligible supported character actors. Fixed/passive/airborne actors and suspended/excluded integration do not receive the override; local launches choose their original input in core. Geometry absence leaves ordinary movement intact. This is the existing missing-prepared-content boundary, not a new persistent target cache or pursuit fallback.

Heading is now a prepared source fact in `StickyBodyTarget`, consumed by both physical projection and the existing remote command timeline. The physical projector no longer re-derives bearing; the producer preserves heading for coincident horizontal positions. A producer fixture verifies differently scaled setup radii (distinct from primary collision radii), coincident-horizontal heading, and target disappearance. The old tests that became assertions about prefilled headings were removed. Another runtime fixture verifies ordinary playback retains the sticky command heading after cancellation.

Core now chooses the prepared sticky input instead of authored horizontal travel. The existing action advancement happens before this boundary and remains untouched. The unadjusted pursuit speed uses the source's retained run multiplier, initially one, times retail RunForward speed and sticky's factor five (retail acclient.c:329792-329808,371427-371508; ACE MotionInterp constructor/get_max_speed). Remote skill data is not generally available; this is an explicit approximation, not a claim to implement the server's skill query or adjusted interpolation-speed rule. Physical displacement is not object-scaled again.

Affected suites pass world 678/core 355/host 276 (`/tmp/sticky-producer-shared.log`), including eight focused sticky tests (`/tmp/sticky-live-producer-tests-final.log`). Clippy is recorded in `/tmp/sticky-producer-clippy.log`. Architecture documentation records the ownership and rate concession. Remaining gates: production action/hook composition coverage, launch/support-transition regression, bounded maintainability review, debug rebuild and live movement/facing/quiet-correction acceptance. No client restart, commit or overall completion is claimed at this checkpoint.


#### Sticky cutover review — action and support gates

The action fixture now includes an actual authored hook and nonzero final-interval translation. While sticky lifetime and observed locomotion advance, it verifies one hook firing, preservation of the final action interval, and retirement on the following interval. The producer fixture also checks that airborne actors keep ordinary motion without cancelling a still-live sticky command. Core's local-launch branch was traced: it selects the original authored reference whenever `player_launch` exists, and the existing supported-launch/ballistic and consume-once collection regressions remain green. This is an analytical branch check plus existing launch coverage, not a new end-to-end sticky jump fixture.

The bounded review found one additional ownership edge: a sampled sticky request may lose usable support during physical preparation. Such an inactive pursuit must not suppress pending authoritative heading. Physical preparation now derives the active sticky heading once; only that actual contribution takes heading priority. Pending authority is still consumed once, and ordinary source/flight behavior remains in place when pursuit cannot contribute.

No added contact passes, recursive target solving, animation cursor, retained target-pose cache or frontend/IPC path. The temporary target map lives for one collection tick. Prepared heading has exactly two consumers (source timeline and physical request), while setup radius supplies melee clearance independently of collision sphere geometry. Role checks happen after hooks; support is checked again by navigation because it can change during preparation. Those are distinct lifecycle boundaries, not repeated inference within contact passes.

Affected world/core/host suites pass (`/tmp/sticky-cutover-shared.log`), as does warning-denied Clippy (`/tmp/sticky-cutover-clippy.log`). Normal debug build is `/tmp/sticky-cutover-debug-build.log`. The prior client is confirmed absent by both the unavailable CDP endpoint and a process-name inventory with no Electron/holtburger/node processes. The user will open the debug client themselves; do not launch or replace their session. Live behavior and the previously recorded scale/crowd-pressure acceptance remain unproven; the goal is not complete.


#### Acceptance audit after user-owned launch handoff

The user chose to open the client themselves. No acceptance launcher was executed. Rechecked the actual cutover logs: world 678/core 355/host 276, warning-denied Clippy and normal debug build succeeded; diff whitespace validation passes. This verifies the available build, not a running session or visual acceptance.

| Requirement | Current evidence | Remaining limit |
| --- | --- | --- |
| Command lifetime and final action interval | Sticky owner tests and hooked remote-action regression | Live packet renewal behavior remains unobserved for the reported mob. |
| Prepared radii, heading and disappearance | World producer fixture with different setup radii/scales and coincident horizontal coordinates | No fresh visual acceptance yet. |
| Reference cannot run away when blocked | Production projection integrated for 30 seconds with fixed actual pose | This is not the explicitly scoped wall-collision plus active-action integration fixture. |
| Facing and physical movement share intent | Dynamic collection test with conflicting pending authority heading; source-heading cancellation test | Moving-target attack, hooks and physical acceptance are currently tested at separate boundaries. |
| Launch/support priority | Airborne producer fixture, launch branch trace and existing ballistic/consume-once regressions | No dedicated sticky launch composition fixture. |
| Quiet correction and crowd feel | Prior hysteresis/sleeping regressions; current suites | User playtest remains required, including prior crowd-pressure and rate/scale concerns. |

Do not close the whole plan from these green suites. The remaining explicit composition fixtures should be completed without restarting the user's client; any resulting production fix needs a new build and clear notice before attributing playtest feedback to it. The currently built cutover is unchanged by this documentation audit.


#### Composition fixtures — hard obstacle and launch

Two test-only additions close specific gaps from the acceptance audit. `blocked_sticky_pursuit_keeps_reference_at_moving_target_clearance` runs the real collision collection for 30 simulated seconds against a hard cylinder taller than the permitted step, moves the pursuit target farther away during the run, and checks that the actor remains grounded and blocked while its independent reference stops at the new melee clearance. Final nominal velocity is zero. This passes in `/tmp/sticky-blocked-collection.log`; the earlier fixed-actual projection test is no longer the only evidence for bounded blocked pursuit.

`sticky_reference_cannot_replace_launch_or_airborne_continuation` deliberately supplies a sticky reference during launch and successive airborne collection ticks, even though the core adapter normally filters it out. It verifies launch admission once, exact ballistic velocity and no lateral pursuit. This passes in `/tmp/sticky-launch-composition.log`. These fixtures exercise physical command composition, not network action admission.

Only tests changed; the debug client executable remains the previously verified cutover. World all-target warning-denied Clippy is recorded in `/tmp/sticky-composition-clippy.log`. The joint active-action/hook plus physical-collection fixture remains outstanding, as does user visual acceptance. No client launch/restart or commit.


#### Combined attack and collection gate

`sticky_attack_keeps_its_hook_and_replaces_root_travel_in_collection` now runs a real authored attack with a hook and competing root translation through the dynamic collection while its target moves. It checks the action remains active before completion, accepted travel equals only the pursuit request, the hook fires exactly once, completion occurs, and stickiness retires. The fixture uses a normal resting clip after the action. It passes in `/tmp/sticky-attack-collection.log`; warning-denied world all-target Clippy is `/tmp/sticky-attack-composition-clippy.log`. Only test code changed, so the user-owned debug session still corresponds to the prior production build.

The initial fixture omitted all resting clips and exposed a separate sequence case: the action completed at step 14 but its last clip ran again, firing the hook at steps 7 and 22 (`/tmp/sticky-attack-collection-trace.log`). Source inspection finds the terminal fallback in `MotionSequenceRuntime::advance_to_next_clip`: without a following node it returns to `first_cyclic` or the current node. Adding an actual resting clip makes this scoped attack/pursuit integration pass. This does not establish whether empty resting cycles occur in executable retail actor content or whether their terminal repeat is a compatibility defect. Do not claim the empty-cycle case fixed, or use it to change the running client's sequence semantics without a separate source/content applicability check.

The previously outstanding combined attack/physics fixture is now covered for ordinary authored action-to-rest playback. Existing owner tests cover clock renewal, replacement and final interval lifetime separately. User visual acceptance remains outstanding; no launch, restart or commit was performed.


Final combined world suite passes all 681 tests (`/tmp/sticky-final-world.log`), including the three new physical-composition fixtures. Latest production verification remains core 355/host 276, warning-denied affected Clippy and the successful debug build; subsequent changes were tests and documentation only. Diff whitespace validation passes. The user owns client launch and live acceptance. No new behavioral change is justified while awaiting that feedback, and no live acceptance or goal completion is inferred from the test results. This continuation completed verification work; it was not a live-process wait.


### Scoped refinement — no mobile momentum transfer and proportional return

User feedback: clustered attacking mobs sometimes separate violently across the ground, then recover slowly. The user wants both removal of mobile momentum exchange and distance-scaled reconciliation; do not drop the latter from this scope. This section scopes the change only. The prior debug build remains unchanged.

**Ground truth and diagnosis limits.** Retail `CPhysicsObj::handle_all_collisions` (`acclient.c:309962-310051`) modifies the moving body's own velocity against its collision normal, including its elasticity response; it does not distribute pair momentum in that response. Our `resolve_mobile_contact` instead selects a shared normal speed using relative closing velocity and mobility, with special braking-only permission for the controlled player. The collection applies these pair velocity changes separately from weighted positional separation. Separation is never divided by time into retained velocity, but its radius-relative travel allowance resets each tick and can still cause rapid repeated displacement. Sticky ordinary pursuit is another high-speed source. Removing momentum transfer addresses a proven architectural difference, not an attributed explanation of every reported launch.

**One contact rule.** For an overlapping, closing mobile pair, each yielding body may lose only its own inward normal velocity. Preserve its tangential and outward components; do not accelerate it to match its peer, reverse its normal motion, or modify an immovable participant. Nonclosing pairs keep their velocities. Retain the current weighted positional correction, overlap tolerance, cumulative separation allowance, four local passes and final hard navigation. Contact mobility becomes exclusively a separation weight. The player retains its preferred separation share, so intentional pushing remains possible through overlap, without momentum transfer in either direction. This applies uniformly to participants in the existing mobile-pair solver; hard collision restitution and the separate projectile path are outside the change.

**One return rule.** Replace the capped helper with `error * PHYSICAL_RETURN_GAIN`, retaining gain 2/s. Delete `PHYSICAL_RETURN_SPEED_MPS` and its exports. Keep the 20 cm start / 5 cm stop band, relative-velocity completion, dormant reference, command-facing ownership, independent nominal motion, and supported-plane projection. The existing helper serves supported physical return and free-flight bias; remove the ceiling consistently in both. Local-player confirmation, launch priority and existing authority discontinuity handling remain separate. No new distance-based snap threshold, acceleration state, timer or replacement speed ceiling.

**Implementation and subtraction.**

- `spatial/mobile_contact.rs`: remove `ContactVelocityResponse`, its participant field/constructor argument, Shared/BrakingOnly preparation branch and shared-speed calculation. Keep relative closing detection and implement independent inward braking. Preserve coincident-center normal selection and positional weights.
- `spatial/body_movement.rs`: reduce `reference_velocity` to proportional scaling and correct its comment. Remove obsolete exports in `spatial.rs` and `lib.rs`.
- Replace tests asserting momentum conservation/shared speed or the deleted return ceiling with behavioral assertions. Remove obsolete policy vocabulary from surviving code and architecture docs; historical plan entries remain historical. No new controller or solver abstraction. Expected production line count decreases.

**Analytical gate before code.** With normal pointing from second to first, a closing pair brakes negative first-body normal speed and positive second-body normal speed, independently. A stationary struck body stays at zero; two approaching bodies lose their inward motion; an outward-moving body is not dragged or accelerated by a faster pursuer. Tangential velocity is unchanged. Each pair's velocity update cannot increase either recipient's speed, so repeated pair processing cannot generate kinetic energy through this response. Positional separation remains a distinct possible source of visible travel. For an unobstructed stationary reference, `gain * dt <= 2/30` removes at most about 6.7% of error per admitted tick, giving monotonic convergence without a speed ceiling. Moving references, hard clipping and contact displacement require integration checks; this argument does not guarantee crowd equilibrium.

**Verification.**

1. Pair fixtures: stationary body struck at sticky-like high speed, head-on motion, tangential/away motion, nonclosing overlap, coincident centers, immovable participant, and swapped pair ordering. Assert no recipient gains speed, no resting recipient acquires velocity, and weighted positional pushing still occurs.
2. Collection fixture: clustered approaching bodies, including an idle controlled player. Verify momentum is not handed through the crowd and separation remains within the existing per-tick allowance. Do not promise zero crowd displacement or exhaustive mobile collision detection.
3. Return fixtures: multiple initial distances show proportional initial correction; large error converges monotonically without unobstructed overshoot; small error stays dormant; ordinary motion remains independent. Exercise supported slopes/walls/edges, free-flight return and launch precedence with the faster correction. Update old time-to-return assertions to the proportional model rather than another arbitrary speed constant. Retain sticky target/reference and attack/heading integration regressions.
4. Run affected world/core/host suites, warning-denied Clippy, formatting/diff checks and normal debug build. Review actual production subtraction and ensure no stale exports or ignored warnings. The user owns launching the client; clearly identify when a new production build is ready.
5. User playtest: attacking crowd, walking into/out of it, and a visibly displaced mob returning. Check reduced flinging, preserved player pushing, quicker distant recovery, quiet near-reference behavior and hard geometry protection.

**Tradeoffs and acceptance.** Crowds lose billiard-like momentum exchange; repeated overlap separation can still visibly jostle bodies. Larger return errors request higher speed and can visually slide during protected actions. Faster travel can cross mobile bodies under the existing nonexhaustive-mobile concession, while hard geometry still owns accepted motion. Do not remove the separation allowance or add another stabilization system in this change. If violent displacement persists, distinguish accepted separation from ordinary pursuit using the narrowed system before changing another mechanism. Live acceptance of the earlier sticky work is carried forward into this combined refinement, not silently marked complete.


#### No-transfer/proportional-return implementation

Implemented the scoped subtraction. Mobile contact now independently removes each yielding body's own inward normal velocity only for closing overlaps. Deleted `ContactVelocityResponse`, its participant field and constructor argument, the player-specific velocity-policy selection, shared-speed/mobility momentum calculation and public reexports. Positional weights and all separation limits remain. Removed `PHYSICAL_RETURN_SPEED_MPS` and its exports; the common supported/free-flight return helper is now error times `PHYSICAL_RETURN_GAIN`. Updated architecture and the retail-divergence comment to distinguish intentional peer separation from the removed momentum exchange.

Pair coverage now checks independent per-body speed nonincrease over incoming/outgoing speed combinations and coincident centers; old mass-weighted energy expectations were replaced. A real collection fixture checks high incoming velocity against an overlapping cluster containing an idle player: every resting recipient keeps zero velocity, the incoming mover brakes, and accepted positional separation respects the unchanged cumulative allowance. Its first assertion assumed publication order matched input order; the corrected fixture joins by body identity, without changing collection ordering. Another collection fixture checks proportional initial speeds for errors from twice the start threshold through ten metres, monotonic convergence without overshoot, retained heading/support and zero nominal velocity.

Two existing assertions needed semantic updates. When a hard supporting entity becomes mobile, the rider loses Grounded but mobile overlap can brake its downward velocity to zero; nonblocking support still permits negative falling velocity. A local-control reversal fixture assumed instantaneous net velocity rather than its existing brake-before-reverse actuator. Diagnostic values showed a near-zero desired net drive while actual motion spent a tick stopped. Its anti-accumulation assertion now bounds total drive by the initial reference-error envelope; direct proportional rates are independently checked by the new remote collection fixture. No production braking/support policy was changed to satisfy these tests.

The shared final run is `/tmp/no-transfer-shared-final.log`; affected warning-denied Clippy and normal debug build follow. Earlier failures/diagnostics are `/tmp/no-transfer-world.log` and `/tmp/proportional-return-debug.log`. This production change needs the new debug executable before user acceptance; the user owns launch and restart. Large-error correction is intentionally faster, while residual crowd displacement and nonexhaustive mobile crossings remain explicit concessions. Do not mark the full goal complete before live feedback.


Final verification for the combined refinement passes: world 683/core 355/host 276 (`/tmp/no-transfer-shared-final.log`), affected all-target warning-denied Clippy (`/tmp/no-transfer-clippy.log`), formatting and diff checks. Normal debug build completed (`/tmp/no-transfer-debug-build.log`). The deleted velocity-policy and return-cap symbols are absent from surviving crates/apps Rust and architecture docs. Production removed the pair-policy enum/field/argument and speed-ceiling branch; tests added behavioral coverage. No additional solver pass or persistent controller state was introduced. The user can restart `dev:client` to test this build; no client launch/restart or commit was performed by the agent. Live crowd/recovery acceptance remains open.


### Zero separation weight independent of contact permission

The user accepted the no-transfer/proportional-return behavior visually, then reported excessive residual player displacement and identified the coupling between zero separation weight and disabled braking. Current player tuning remains 0.1; no alternative numeric preference was selected.

The audit found zero also controlled hard-target insertion/update, movement ordering, projectile target inclusion and broad-phase mobile-pair participation. Therefore changing only the pair braking condition would not make zero a usable player separation setting. Replaced the overloaded scalar with one optional response weight: `Some(ContactMobility::ZERO)` permits mobile response but receives no positional correction; `None` explicitly disables mobile response and preserves existing nonyielding hard-target behavior. This replaces the field rather than adding an independent flag with invalid combinations. `IMMOVABLE` was removed in favor of the accurately named ZERO weight. Directional pair filters now remove permission, rather than substituting a numeric weight.

All role/scheduling/pair-discovery checks now consume explicit response permission. Pair separation handles total zero weight with zero shares while still applying independent inward braking. No momentum transfer was restored; two zero-weight bodies may remain overlapped while braking. Existing fixed/nonresponsive bodies still use their prior hard geometry path. The player's actual weight is unchanged.

New regressions cover one/two zero-weight participants, both pair orders, zero displacement with preserved tangential velocity and inward braking, and broad-phase inclusion of zero-weight bodies while excluding a nonresponsive participant. Original world 683 tests passed before additions; final affected suites are `/tmp/separation-permission-shared.log`. Warning-denied Clippy and debug build follow. This implements the semantic decoupling only; user-controlled tuning can now safely use zero without implicitly disabling braking or promoting the player to a hard target.


Zero-weight decoupling verification passes world 685/core 355/host 276, affected all-target warning-denied Clippy (`/tmp/separation-permission-clippy.log`), formatting/diff checks and normal debug build (`/tmp/separation-permission-debug-build.log`). The obsolete IMMOVABLE numeric sentinel and old scalar field references are absent from the contact path. Player weight remains 0.1. No client launch/restart or commit was performed.


User-selected tuning: set `ContactMobility::PLAYER` to 0.025 versus peer 1.0, a 40:1 separation bias toward the peer. Independent braking and response permission are unchanged. Earlier 0.1 entries describe prior checkpoints. Debug rebuild follows; the user owns client restart.


Latest user-selected tuning: set `ContactMobility::PLAYER` to 0.01 versus peer 1.0, a 100:1 separation bias toward the peer. This supersedes the interrupted request for 0.1. Braking and response permission remain unchanged.


### Closeout audit and final tuning regressions

The user explicitly accepted manual checks at player weight 0.01. A full-suite closeout run, broader than the focused pair tests used for the last constant changes, exposed five assertions tied to earlier tuning. They were reconciled with the already accepted final constraints without changing production code:

- The protected-ledge fixture now permits small bounded horizontal correction while requiring supported footing, no vertical displacement and no retained momentum. It no longer requires every correction to roll back completely.
- Pinned-body coverage now explicitly checks both mobile bodies remain clear of the hard obstacle. Its speed check permits hard-collision reflection without amplification, rather than requiring a positive final velocity.
- The finite-time relaxation fixture checks reduced initial compression plus unchanged hard clearance/no-momentum requirements; nearly complete separation within two seconds is not independent of player tuning.
- Stair coverage retains progress, top support, hard clearance and actual occupant yielding. It drops exhaustive mobile ordering, which was already outside the accepted solver contract.
- Escape coverage chooses retreat direction from actual body positions at the transition, since mobile ordering may change. It retains independent-player-velocity, support, publication and final separation checks.

Final verification passes world 685/core 355/host 276. The production executable and tuning accepted by the user were not changed during closeout. User visual acceptance plus the recorded analytical, integration, lifecycle, performance and maintainability gates close the plan. No client restart, staging or commit was performed.
