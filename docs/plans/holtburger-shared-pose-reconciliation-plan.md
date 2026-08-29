# Holtburger Shared Pose Reconciliation Plan

Status: **Reopened for post-implementation motion regressions; Phases 0-8 complete, Phases 9-10
planned (2026-08-28).**

Origin: investigation of one-second local-player rubber-banding and discontinuous remote-player
motion in `apps/holtburger-3d` client mode.

## Context and Boundaries

### Goal

Make every world-placed actor reconcile authoritative pose samples through one world-owned runtime
mechanism, while preserving the distinct authority policies of an autonomous local player, a
server-controlled local player, and a remote entity.

### Why this cutover is deserved

Holtburger already has the right high-level distinction: `Entity.position` and
`SpatialBody.authoritative_pose` retain server truth, while `SpatialBody.pose` is the runtime pose
consumed by collision, camera, and presentation. The reconciliation path does not honor that model
consistently.

For the local player, `holtburger-core` owns a retail-shaped `ServerCorrection`. Every accepted
same-epoch grounded `UpdatePosition` is classified through the generic remote-object
`CPhysicsObj::MoveOrTeleport` ladder and armed as interpolation. ACE sends exactly such an
`UpdatePosition` back after each one-second client `AutonomousPosition` heartbeat. The returned pose
is naturally behind current prediction. `MovementSystem::has_active_server_correction` then treats
interpolation and constraint damping as the same basis owner, clears the manual motion cursor, and
walks the player backward toward the echoed pose before held input resumes.

Retail does not do that. `SmartBox::HandleReceivedPosition` gives the local player a distinct
branch: same-epoch position updates always call `ConstrainTo`, but call `InterpolateTo` only when
`CommandInterpreter::UsePositionFromServer` is true. That method returns false at autonomy level 2,
the ordinary client-authoritative mode. The generic `MoveOrTeleport` ladder is used for remote
objects.

Remote entities currently have the inverse defect. An accepted ordinary `UpdatePosition` updates
the authoritative entity and replaces the `SpatialBody` runtime pose immediately because
`SpatialScene::reconcile_authoritative_body` preserves a simulated runtime pose only for
`SpatialBodyId::LocalPlayer`. The resulting `EntityMoved`/`RuntimeBodyChanged` events emit a complete
dynamic upsert, so the frontend also replaces placement outside the fixed-tick path. Retail instead
interpolates an ordinary contacted remote update below 96 metres and directly places only a far
correction, teleport epoch, missing-cell recovery, or forced reposition as appropriate.

The current `AuthoritativeBodySync::{Snapshot, Reset}` vocabulary hides these incompatible
meanings. `Snapshot` can mean bootstrap, update authority while preserving local prediction, or
replace a remote runtime pose. The body kind and current sample mode silently choose the result.
This plan replaces that implicit policy with a typed effect, moves actor-neutral correction state
beside the canonical runtime body, and deletes the local-only parallel mechanism.

### In scope

- Reconstruct retail's local-versus-remote received-position dispatch from the decompile before
  changing production routing.
- Replace implicit snapshot semantics with explicit initialize, confirm, interpolate, ordinary
  correction-snap, and authority-reset operations.
- Move interpolation, watchdog, and confirmed-travel constraint mechanics from
  `holtburger-core` into an actor-neutral `holtburger-world` spatial component.
- Retain reconciliation state with the canonical `SpatialBody`, not in a frontend, event mirror, or
  second runtime store.
- Compose every actor's ordinary motion basis, interpolation override, confirmed-travel
  constraint, collision/placement solve, and runtime-pose commit in one fixed-tick path.
- Keep local authority policy in `holtburger-core`: default-autonomy confirmation, any future
  explicit non-default-autonomy position use, heartbeat scheduling, motion packet edges, and
  control transitions. Server-directed movement projection is orthogonal to position authority.
- Keep remote position policy in `holtburger-world`, where authoritative remote entity state and
  runtime bodies already live.
- Correct constraint damping to use physical contact rather than walkable-only ground: both
  `ContactState::Grounded` and `ContactState::Sliding` damp, while `Airborne` and unresolved
  `Unknown` do not; accumulation continues for every admitted translation as retail does.
- Preserve the distinct wire bit `0x04`/received-position `HAS_CONTACT` admission fact. Do not infer
  packet contact from the richer locally solved `ContactState` or vice versa.
- Route ordinary interpolated placement exclusively through fixed-tick dynamic advance batches.
- Add a zero-duration ordinary correction-snap presentation effect distinct from teleport and
  forced-reset semantics.
- Cover local physical bodies, remote physical bodies, and pose-only remote bodies.
- Measure real ACE update cadence, overlap, correction distances, convergence, active-body count,
  body-size impact, host tick work, dynamic event counts, and frontend placement work.
- Update `holtburger-world` and `holtburger-core` architecture documentation after the cutover.

### Out of scope

- Changing the one-second client heartbeat cadence or ACE server behavior.
- Network rollback/replay, command-history replay, input acknowledgement, or deterministic
  resimulation. The AC protocol does not provide the command acknowledgements such a system would
  require, and retail uses interpolation plus a confirmed-travel constraint instead.
- A frontend-owned snapshot buffer, extrapolator, network clock, or correction tween.
- A universal local/remote motion controller containing input, packet, animation, and network
  policy. Actor adapters remain separate; only correction mechanics and spatial composition are
  shared.
- Raising or lowering the 30 ms client physics cadence.
- Changing collision algorithms, dynamic-contact directionality, motion-table selection, or
  animation playback policy except where the current correction path wrongly suppresses it.
- Turning pose-only remotes into physical collision participants solely to obtain interpolation.
- Adding a retail interpolation-node queue for the measured ACE workload. The recorded moving
  remote's largest correction converges before the next observed packet even at retail's 7.5 m/s
  fallback; one replacing target is the scoped, explicitly marked divergence.
- Retaining task-specific packet logs, probes, counters, environment switches, or credentials.
- Modifying ACE, ACViewer, or the retail decompile.

## Ground Truth

### Retail and ACE references

| Question | Source |
| --- | --- |
| Local player versus remote object received-position dispatch | `SmartBox::HandleReceivedPosition`, `acclient-eor-source/acclient.c:138921-139058` |
| Autonomous local player does not use server position as interpolation target | `CommandInterpreter::UsePositionFromServer`, `acclient-eor-source/acclient.c:682017-682020` |
| Generic remote stale/new-epoch/contact/96 m decision ladder | `CPhysicsObj::MoveOrTeleport`, `acclient-eor-source/acclient.c:311475-311523` |
| Interpolation node insertion and retained-node behavior | `InterpolationManager::InterpolateTo`, `acclient-eor-source/acclient.c:371857-371971` |
| Interpolation assignment, speed cap, watchdog, and completion | `InterpolationManager::adjust_offset`, `acclient-eor-source/acclient.c:372004-372097` |
| Adjusted maximum speed source | `CMotionInterp::get_adjusted_max_speed`, `acclient-eor-source/acclient.c:329811-329837` |
| Motion interpreter defaults (`current_speed_factor == 1`, retained `my_run_rate`) | `CMotionInterp::Create`, `acclient-eor-source/acclient.c:330746-330769` |
| Interpolation then sticky then constraint ordering | `PositionManager::adjust_offset`, `acclient-eor-source/acclient.c:371277-371292` |
| Confirmed-travel constraint thresholds | `CPhysicsObj::GetStartConstraintDistance` and `GetMaxConstraintDistance`, `acclient-eor-source/acclient.c:304336-304373` |
| Constraint initialization from current distance | `ConstraintManager::ConstrainTo`, `acclient-eor-source/acclient.c:372301-372315` |
| Contact-gated damping and unconditional admitted-distance accumulation | `ConstraintManager::adjust_offset`, `acclient-eor-source/acclient.c:372268-372297` |
| `Contact` versus `OnWalkable` state derivation | `CPhysicsObj::SetPositionInternal`, `acclient-eor-source/acclient.c:310624-310760` |
| Retail client position-event cadence | `CommandInterpreter::ShouldSendPositionEvent`/`SendPositionEvent`, `acclient-eor-source/acclient.c:682586-682714` |
| Default autonomy level and its independence from server control | `CommandInterpreter::CommandInterpreter`, `UsePositionFromServer`, `LoseControlToServer`, and `TakeControlFromServer`, `acclient-eor-source/acclient.c:681339-681397,682017-682020,682226-682268` |
| Position bit `0x04` is unpacked as `has_contact` | `PositionPack::GetPackSize`/`UnPack`, `acclient-eor-source/acclient.c:311527-311572,311730-311822` |
| ACE authors bit `0x04` only from `OnWalkable` | `ACE/Source/ACE.Server/Network/Structure/PositionPack.cs:62-74` |
| ACE receives the client heartbeat as a requested location | `ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionAutonomousPosition.cs` |
| ACE sends `UpdatePosition` after accepting the requested player location | `ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs:411-522` |
| ACE broadcasts ordinary player positions to observers and echoes the sender | `ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs:513-516` |

### Current Holtburger contracts

- `crates/holtburger-core/src/client/movement/correction.rs` contains the current local-only
  interpolation and confirmed-travel constraint implementation.
- `crates/holtburger-world/src/spatial/pose_reconciliation_retail_differential.rs` is the
  independent arithmetic and dispatch oracle beside the actor-neutral production owner.
- `crates/holtburger-core/src/client/movement/system.rs` owns `ServerCorrection`, conflates
  interpolation/constraint work in `has_active_server_correction`, and suppresses manual motion in
  `advance_local_manual_motion`.
- `crates/holtburger-core/src/client/messages.rs::apply_local_position_correction` adapts accepted
  self position events into that local-only state.
- `crates/holtburger-core/src/client/simulation.rs` already shares physical collection preparation
  and commit between local and remote bodies, but uses separate actuation callbacks and advances
  pose-only remotes through another projection branch.
- `crates/holtburger-world/src/spatial/scene.rs::reconcile_authoritative_body` owns the hidden
  local-body preservation branch and direct remote runtime-pose replacement.
- `crates/holtburger-world/src/state/mutations.rs` applies entity/player position packs and joins
  authoritative entity mutation to runtime-body synchronization.
- `crates/holtburger-world/src/spatial/dead_reckoning.rs` contains the actor-neutral non-colliding
  projection helpers used by pose-only bodies.
- `crates/holtburger-world/src/spatial/types.rs::ContactState` losslessly distinguishes `Unknown`,
  `Airborne`, `Sliding`, and `Grounded`; correction must consume that type instead of flattening it
  to `grounded: bool`.
- `crates/holtburger-core/src/client/dynamic_entity_view.rs` captures fixed-tick before/after
  runtime views and builds the only ordinary integrated placement path.
- `apps/holtburger-3d/src/lib/game/systems/dynamic-entity-placement-system.ts` already snaps every
  non-integrated placement advance and render-interpolates only integrated paths.
- `apps/holtburger-3d/scripts/live-client-probe.mjs` already logs in securely from environment
  credentials, drives continuous forward motion, observes dynamic/camera events, and reports
  credential-redacted JSON.
- `docs/plans/holtburger-client-dynamic-delta-and-solver-epoch-plan.md` established the accepted
  dynamic-delta and single-solve epoch architecture this plan must preserve.
- `docs/plans/holtburger-grounded-landing-threshold-and-contact-slide-plan.md` proves the
  `ContactState::Sliding` semantics needed by constraint damping.

## North Stars

1. One canonical runtime pose per body: collision, camera, gameplay queries, audio, and rendering
   never maintain independent correction truth.
2. Share mechanics, not authority policy. Local input and remote server motion remain honest
   adapters into one spatial composition pipeline.
3. A confirmation modifies the ordinary basis; interpolation may replace it. Their state and APIs
   must make that distinction impossible to forget.
4. Compute received-position disposition once at the layer that owns the authority decision and
   carry the result as a typed effect; consumers never re-derive it from body kind or event timing.
5. Packet arrival changes authoritative facts and correction intent, not presented placement.
6. Discontinuities remain typed: ordinary far correction, teleport, forced reposition, and world
   reset do not borrow each other's lifecycle consequences.
7. Preserve the full contact model. `Sliding` is contact without walkability, not airborne and not
   grounded-by-convenience.
8. Correction work is proportional to bodies with active state and piggybacks on existing tick
   iteration; no second population scan, per-tick allocation, or frontend wire state.
9. Implement only the target history demonstrated by real ACE traffic. A queue is not free
   fidelity when every measured target converges before its successor.

## Settled Direction Decisions

### D1. `SpatialBody` owns actor-neutral reconciliation state

Add a focused spatial module, provisionally `spatial/pose_reconciliation.rs`, containing the moved
and renamed interpolation node, confirmed-travel constraint, retail constants, composition result,
and pure/stateful arithmetic. `SpatialBody` retains an optional compact reconciliation composite.
The state is not serialized into `RuntimeSpatialBodyView` or dynamic entity views; consumers see
only its resulting runtime pose and kinematics.

The baseline census measured `SpatialBody` at 480 bytes and the existing `ServerCorrection` at 144
bytes (`InterpolationNode` 44, `ConstraintLeash` 12, prepared step 84). Inlining equivalent state
would add roughly 30% to every body before any target-history storage. The live scene
retained/projected 57-80 entities while only the local player and one observed remote had
correction-producing traffic.

Use `Option<Box<PoseReconciliationState>>` directly on `SpatialBody`: one pointer (8 bytes on the
measured target, approximately 1.7% idle body overhead and 640 bytes at the 80-body peak), no second
identity map or hash lookup, and allocation only when a body first receives reconciliation state.
Drop the box when all interpolation, pending snap, and constraint state is cleared. Measure the
final compiled layout in Phase 1 because the moved state will not exactly equal today's core type.

### D2. Received samples produce one explicit runtime effect

Replace `AuthoritativeBodySync::{Snapshot, Reset}` and `CorrectionDisposition` with a composite
effect vocabulary that cannot confuse initialization, confirmation, interpolation, ordinary snap,
and authority reset. Exact naming is settled during Phase 1, but the admitted states are:

- `Initialize`: seed a body that has no runtime timeline; no correction history survives.
- `Confirm`: update the authoritative pose and re-arm the confirmed-travel constraint while
  preserving the current runtime pose and ordinary motion basis.
- `Interpolate`: update the authoritative target and arm/replace interpolation plus the constraint;
  interpolation may own translation until completion.
- `Snap`: schedule a direct ordinary far correction for the next fixed tick and clear correction
  history without incrementing world generation or pretending a teleport occurred.
- `Reset { cause }`: establish a new authority epoch for teleport, force-position, or world reset,
  directly install the pose, and clear all temporal state.

Vector-only and motion-snapshot updates receive focused operations instead of masquerading as pose
snapshots. Bootstrap/liveness call sites must choose `Initialize` or an explicit retain-runtime
operation; no compatibility alias for `Snapshot` survives cleanup.

### D3. Authority adapters choose effects; the spatial reconciler executes them

`holtburger-core` chooses local-player policy because it owns the client's position-authority mode.
At Holtburger's supported retail-default autonomy level 2, every ordinary same-epoch self update
becomes `Confirm`, including updates received while a separate server-directed `UpdateMotion`
projection is active. Retail's `controlled_by_server` flag does not drive
`UsePositionFromServer`; equating the two would preserve the current bug under a new name.
Teleport/force-position/lifecycle edges become `Reset`. Heartbeat scheduling, server-directed
movement projection, and movement packet metadata stay in core.

Do not add an autonomy field with no producer. If Holtburger later supports retail autonomy level 0
or 1, that feature must add the outbound `AutonomyLevel` action and one explicit local
position-authority mode; only that mode may select contacted self interpolation. The live census
received no inbound autonomy message, consistent with retail sending this opcode client-to-server.

`holtburger-world` chooses remote policy while applying `PositionPack` sequencing. An ordinary
admitted near update becomes `Interpolate`; the generic retail far branch becomes `Snap`; new
teleport epochs become `Reset`; remote force-position timestamps have no independent receive-side
meaning; stale updates mutate nothing. A newer same-epoch position
sequence whose packet contact bit is false advances only the position sequence, matching retail's
`newer_event(POSITION_TS)` before `MoveOrTeleport` rejects the pose. It does not mutate
`Entity.position`, velocity, `SpatialBody.authoritative_pose`, or correction state. The
authoritative entity mutation and selected body effect occur in the same synchronous message turn.

The player handler may continue emitting a packet-scoped `WorldEvent` for core to consume once.
`ClientRuntime::handle_world_events` currently projects every pending event before it consumes
`SelfUpdatePosition`; that ordering must change. Consume internal local authority effects first,
then project the completed batch to `ClientViewEvent`. Entity authority may be recorded before the
core-owned effect inside the same synchronous turn, but no runtime/dynamic projection or physics
tick may intervene. Encode and test that ordering rather than adding a second stored pending update.

### D4. One ordered motion composition serves every body

The spatial preparation boundary consumes an actor adapter's ordinary candidate actuation and
applies reconciliation in retail order:

1. local input, server-directed drive, remote authored motion, velocity, or coast produces one
   candidate rigid motion basis;
2. active interpolation may assign/replace translation and its explicit heading policy;
3. the confirmed-travel constraint scales the surviving translation when the body has physical
   contact;
4. collision/placement solves and commits the accepted runtime path once.

Constraint state never makes `has_active_manual_drive` false and never resets the manual motion
cursor. Only an interpolation owner or explicit authority transition may preempt ordinary
actuation. Remove the generic `has_active_server_correction` predicate; replace each consumer with
the narrower fact it actually needs.

A constraint alone does not wake or schedule an idle body: it has no displacement to produce. It
is applied when an ordinary basis next exists. Interpolation and a pending ordinary snap are genuine
remaining projection work and do wake/schedule their body.

Physical local/remotes use the existing dynamic collection epoch. Pose-only remotes use the same
reconciliation composition before `advance_authored_body_kinematics`/`advance_body_kinematics`,
without acquiring collision geometry. No additional all-body pass is introduced.

### D5. Constraint damping consumes typed runtime contact

The spatial reconciler reads `ContactState` directly. Retail's `transient_state & Contact` gate maps
to `Grounded` and `Sliding`; it excludes `Airborne`. `Unknown` does not invent contact and therefore
does not damp, but admitted translation still increases the retained distance just as the airborne
retail path does.

This typed runtime contact is distinct from the position packet's admission bit. The protocol and
remote received-position classifier continue to interpret the wire fact according to the packet
format and retail receive path. No helper named `grounded` may be reused for both meanings.

### D6. One replacing interpolation target matches the measured ACE distribution

Retail appends interpolation nodes and caps the ordinary near-target queue at 20
(`acclient.c:371885-371959`), but the live ACE census did not earn that storage or lifecycle. The
observed moving remote sent 13 contacted, velocity-less updates across 12 intervals about 190-217
ms apart. Corrections ranged from 0.041-0.618 m. At retail's 7.5 m/s fallback, the largest
correction requires about 82 ms;
the usual adjusted-motion cap is at least as fast for the observed run. No target overlaps its next
packet under those facts.

Retain one latest target and replace it on each admitted update. Mark this as `RETAIL DIVERGENCE`
at the production type with the cited retail queue, the consequence under burst/stall traffic, and
this census. Revisit only if a repeatable workload produces target overlap or inability to converge;
do not add a generic snapshot buffer or fixed presentation delay.

### D7. Runtime pose publication remains solver-owned

Packet-level dynamic upserts may continue carrying complete current entity levels, but an ordinary
received sample must preserve the pre-packet runtime pose. Therefore the upsert's placement identity
is unchanged and the frontend performs no placement mutation. The next fixed tick publishes the
actual reconciled movement through `DynamicEntityEvent::Ticked`.

Interpolated paths use `DynamicEntityPlacementAdvanceKind::Integrated`. An ordinary `Snap` is
retained as pending body work rather than mutating runtime pose in the packet handler. The next fixed
tick installs it and publishes a distinct non-integrated, zero-duration advance; it clears frontend
interpolation without triggering teleport/forced-reset lifecycle. Because one tick may integrate
some bodies and snap another, dynamic tick construction must accept the placement consequence per
body instead of applying one batch-wide `kind` argument. `Teleport` and `Reset` retain their
existing generation/discontinuity semantics. Camera advancement continues to consume the same
host-accepted local dynamic path that presentation receives.

### D8. Retail compatibility is behavior, not architecture mimicry

The interpolation arithmetic, decision branches, contact gate, thresholds, and observable snap or
convergence behavior match the cited retail client. State storage, enum shapes, and scene APIs may
use modern Rust composition. No compatibility marker is needed for matching behavior. Any measured
choice to replace rather than queue targets must be evaluated for observability; if it is a
deliberate observable departure, it requires a `RETAIL DIVERGENCE` comment with citation,
consequence, and traffic census.

### D9. The motion owner supplies retail's adjusted interpolation speed

Do not use packet velocity, target distance, or local-player kinematics as a proxy for interpolation
speed. Retail asks the body's `CMotionInterp` for `get_adjusted_max_speed()` and doubles that result.
The motion interpreter uses the qualities-derived run rate when available, otherwise retained
`my_run_rate`; while `RunForward` is current it uses `forward_speed / current_speed_factor`.
`current_speed_factor` initializes to 1.0 and has no other assignment in the decompile.

Add a focused adjusted-speed query to `BodyMotionRuntime`. Retain the last valid run-rate multiplier
when a `RunForward` order is applied, because retail's `my_run_rate` survives after that command
stops. The reconciliation effect carries or reads that computed fact once; it does not re-derive
motion state. Bodies without a usable motion runtime use retail's 7.5 m/s interpolation fallback.

### D10. Name position bit `0x04` for its retail receive meaning

Clean-cut `UpdatePositionFlag::IS_GROUNDED` to `HAS_CONTACT` throughout the protocol and consumers.
Retail packs and unpacks the bit as `has_contact`; its remote admission branch is not asking whether
the surface is walkable. ACE currently authors that bit from its `OnWalkable` transient flag, which
is a server-producer choice and explains why ACE traffic only advertises walkable contact. Keep that
wire fact distinct from locally solved `ContactState`, where `Sliding` is still physical contact for
constraint damping. Sweep the old grounded vocabulary in the same change.

## Phase 0 Decision Evidence (2026-08-28)

The live census used the checked-in `apps/holtburger-3d/scripts/live-client-probe.mjs`, the local ACE
server at `127.0.0.1:9000`, the test account from `.dev.env`, continuous forward run, and the normal
30 ms client simulation cadence. Credentials and raw packets were not recorded.

| Evidence | Observation | Decision consequence |
| --- | --- | --- |
| Detailed 10 s self run | Ten self `UpdatePosition` samples arrived 1,016-1,034 ms apart after the first sample. Same-epoch deltas reached 0.384 m; every packet was contacted and current code classified every one as `Interpolate`. Presentation reported 16 backward tick frames up to 0.230 m and zero discontinuity events. | The one-second reversal is the local generic-interpolation path, not camera reset or frontend tweening. Default-autonomy self updates must be `Confirm`. |
| Independent 12 s self run | Twenty-one backward tick frames appeared, up to 0.229 m, under the same continuous-forward input. | The result repeats across sessions and covers more than five heartbeat round trips. |
| Moving remote in detailed run | Entity `0x8000206A` produced 13 contacted, velocity-less position packets across 12 intervals of roughly 190-217 ms. Current runtime pose jumped by exactly each accepted target delta; 11 moving jumps ranged 0.041-0.618 m. | Current remote sliding is packet-time pose replacement. Near packets must preserve runtime pose and arm interpolation. |
| Target-overlap bound | `0.618 m / 7.5 m/s = 82.4 ms`, below the shortest observed remote interval (~190 ms). Retail's ordinary adjusted-motion cap is commonly faster. | One replacing target covers the measured distribution; a 20-node retail queue is not implemented now. |
| Scene population | Three runs observed peak projected snapshots of 57, 61, and 80 entities; the detailed run's largest tick batch carried 52. Only one remote emitted position corrections during that sample. | State must allocate in proportion to active correction producers, not retained bodies. |
| Compiled layout | `SpatialBody` 480 bytes; current `ServerCorrection` 144; `InterpolationNode` 44; `ConstraintLeash` 12; prepared step 84; `WorldPosition` 32. | Use a body-owned optional box, adding one idle pointer rather than inlining the full composite or maintaining a second map. |
| Retail autonomy dispatch | Default `autonomy_level` is 2; `UsePositionFromServer` is `autonomy_level != 2`; `LoseControlToServer`/`TakeControlFromServer` change `controlled_by_server` without changing autonomy. No inbound autonomy message appeared live. | Server-directed projection is not the self-position interpolation switch. Do not add speculative autonomy state. |
| Retail non-contact dispatch | `newer_event(POSITION_TS)` advances the sequence before same-epoch `MoveOrTeleport` rejects `!contact` without installing the pose. | Add sequence-only acceptance; do not store a rejected packet pose as authoritative entity truth. |

The baseline event workload for the detailed 10 s run was 534 dynamic-entity events and 334 camera
events, with a 57-entity peak snapshot and 52-entity peak batch. These are delivery workload counts,
not CPU timings. Phase 6 records the final browser timing and the reason a matched live CPU delta
could not be claimed; no storage or target-history decision depends on speculative timing numbers.

## Phased Implementation

### Phase 0: Evidence capture and independent dispatch oracle — complete

#### Deliverables

- Extend the existing independent retail differential so it models the distinct self-player and
  remote-object branches, not only generic `MoveOrTeleport` arithmetic.
- Add oracle scenarios for:
  - autonomous local same-epoch confirmation without interpolation;
  - server-position use at non-default autonomy level and contacted;
  - remote stale, new-teleport, missing-cell, non-contact, near, and 96 m boundary cases;
  - interpolation-before-constraint ordering;
  - `Grounded` and `Sliding` damping versus `Airborne`/unresolved contact;
  - unconditional surviving-distance accumulation;
  - ordinary snap versus teleport/force reset consequences.
- Temporarily instrument the live client probe or a focused host harness to record credential-free:
  - outbound heartbeat and inbound self-update cadence;
  - local runtime-to-confirmed displacement before each update;
  - correction direction and time until completion;
  - remote update interval, displacement, contact/admission, and whether a previous target would
    still be active;
  - retained, projected, physical, pose-only, and actively correcting body counts.
- Record the baseline `SpatialBody` size, host fixed-tick distribution, dynamic upsert/tick counts,
  and browser placement work for the same scenario.
- Remove raw packet dumps and task-specific logging after the census is recorded in this plan.

#### Acceptance criteria

- The oracle independently distinguishes local autonomous confirmation from remote interpolation
  with direct `acclient.c` citations.
- A continuous-forward probe captures at least five heartbeat round trips and demonstrates the
  current backward correction direction without exposing credentials.
- Remote evidence is sufficient to settle one-target versus bounded-queue storage before Phase 2.
- Baseline measurements include actor counts and scene/location context; no hardware timing is
  recorded without its workload.

#### Decisions and course corrections

- Keep one replacing target for the measured ACE distribution and add the required
  `RETAIL DIVERGENCE` census at the production type.
- Store active state in a body-owned optional box; do not add a scene identity map.
- Rename wire bit `0x04` to `HAS_CONTACT`; ACE's `OnWalkable` producer does not redefine the wire
  consumer meaning.
- Advance sequence only for a newer same-epoch non-contact remote update; do not store its pose.
- Do not equate server-directed movement with non-default autonomy. Holtburger supports retail's
  default level 2, so ordinary self updates confirm rather than interpolate.
- Source adjusted interpolation speed from the body motion runtime, with the retail fallback when
  no runtime fact exists.
- Added nine asset-free oracle tests in
  `pose_reconciliation_retail_differential.rs`. The oracle now represents self-player dispatch,
  generic remote dispatch, sequence-only non-contact acceptance, typed runtime contact,
  interpolation-before-constraint ordering, watchdog outcomes, and distinct reset/snap causes
  without importing production correction helpers.
- Deferred host CPU timing, browser placement profiling, and the physical/pose-only active-body
  breakdown to the matched before/after census in Phase 6. Phase 0 captured the decision-driving
  retained population, correction producers, delivery workload, packet cadence, and compiled
  layouts. Profiling the current packet-snap path alone would not validate the replacement and
  would create an unmatched baseline; this is verification debt, not evidence for a design fork.
- Verification: `cargo test -p holtburger-core client_correction_retail_differential` passes all
  nine oracle tests; `cargo fmt --all -- --check` passes after formatting.

### Phase 1: World-owned reconciliation contract — complete

#### Deliverables

- Add the actor-neutral reconciliation module under `crates/holtburger-world/src/spatial/` by
  moving and renaming the proven interpolation/constraint mechanics from core.
- Define the composite received-pose effect and reset-cause types; comment every state/field and its
  consumer.
- Make interpolation assignment and constraint modification distinct in the return type or
  composition API; no `has_work`-style proxy may decide basis ownership.
- Consume typed `ContactState`, including `Sliding` as contact, in constraint composition.
- Retain reconciliation state in the Phase 0-selected body-owned optional box, with explicit reset,
  suspension, retirement, replacement, and initialization lifecycle.
- Relocate/expand the independent retail differential beside the production owner without importing
  production helpers into the oracle.
- Measure and record the final idle/active state-size impact.

#### Acceptance criteria

- `cargo test -p holtburger-world` passes, including oracle differential coverage for all effect and
  contact branches.
- A confirmation below the free threshold preserves a candidate translation exactly.
- A confirmation above the threshold dampens the candidate without becoming its basis owner.
- Sliding and grounded produce the same constraint gate; airborne and unknown do not damp but do
  accumulate surviving travel.
- Interpolation assigns before constraint damping and retains existing watchdog/speed behavior.
- No tick allocation or second body-population scan is introduced.

#### Decisions and course corrections

- Added `AuthoritativePoseEffect` with explicit `Initialize`, `Confirm`, `Interpolate`, `Snap`, and
  caused `Reset` variants. The selected variant owns its pose so a scene consumer cannot pair an
  authority decision with a different sample. `AuthoritativePoseResetCause` distinguishes
  teleport, forced reposition, world reset, and missing-cell recovery.
- Added one `compose_translation` boundary. Interpolation explicitly replaces the ordinary basis;
  the confirmed-travel constraint then modifies the survivor. The returned
  `PoseTranslationSource` prevents callers from treating retained constraint state as movement
  ownership.
- Added the optional boxed reconciliation composite to `SpatialBody`. At the Phase 1 boundary the
  compiled sizes on the measured target were: `SpatialBody` 488 bytes (up 8 from 480),
  `PoseReconciliationState` 96 bytes, `Option<Box<PoseReconciliationState>>` 8 bytes, and
  `AuthoritativePoseEffect` 36 bytes. Phase 4 records the final active-state sizes after adding
  adjusted-speed retention. Active state is allocated outside the body; no tick-time allocation or
  secondary identity map was introduced.
- Corrected inherited watchdog behavior after re-reading
  `InterpolationManager::NodeCompleted`/`UseTime` (`acclient.c:371736-371832,372070-372097`). A
  failed node is removed immediately. With the measured one-target history there is no successor,
  so the first failed five-contact-frame window schedules the retained target as a snap. The old
  core implementation and initial oracle incorrectly retried one target as four synthetic failed
  nodes. The oracle now also proves that a failed node with a queued successor is abandoned rather
  than snapped.
- The old core `ServerCorrection` mechanics intentionally remain during this phase so the local
  simulation stays compilable before its Phase 3 adapter cutover. This is temporary duplication,
  not a compatibility layer; Phase 3 must delete the entire old implementation and vocabulary.
- Verification: `cargo fmt --all -- --check`, all 459 `holtburger-world` tests, doc tests, and
  `cargo clippy -p holtburger-world --all-targets -- -D warnings` pass after the final watchdog
  correction.

### Phase 2: Authoritative-body API cutover — complete

#### Deliverables

- Replace `AuthoritativeBodySync` and `SpatialScene::reconcile_authoritative_body` with explicit
  initialization, received-sample, vector/motion-level, snap, and reset operations.
- Sweep every current `AuthoritativeBodySync` caller in bootstrap, liveness, entity mutation,
  player mutation, tests, and diagnostics; each call site names the effect it intends.
- Remove `preserve_local_runtime_pose` and all body-kind/sample-mode inference from authoritative
  synchronization.
- Keep `Entity.position`, `SpatialBody.authoritative_pose`, and the selected reconciliation effect
  coherent in one message turn. Add tests that no intermediate event projects a newly authoritative
  pose as runtime placement.
- Reorder core world-event handling so packet-scoped local reconciliation effects are consumed
  before the same pending batch is projected to runtime/dynamic view events.
- Ensure suspension, body retirement, attachment, teleport, force-position, and rehydration clear
  or retain correction state deliberately.

#### Acceptance criteria

- No `AuthoritativeBodySync`, `Snapshot` compatibility alias, or local-body preservation branch
  survives.
- Bootstrap creates one body at the authoritative pose; ordinary confirmation/interpolation
  preserves runtime pose; snap installs on the next fixed tick and reset installs immediately,
  with distinct consequences.
- Vector and motion updates cannot accidentally replace runtime placement.
- `cargo test -p holtburger-world` and `cargo test -p holtburger-core` pass at the phase boundary.

#### Decisions, concessions, and debt

- Deleted `AuthoritativeBodySync`, `AuthoritativeBodyKinematics`,
  `SpatialScene::reconcile_authoritative_body`, and the hidden
  `preserve_local_runtime_pose` branch. There is no compatibility alias. The scene now exposes
  `apply_authoritative_body_effect` for typed pose consequences and
  `apply_authoritative_body_vectors` for vector-only replacement.
- `Initialize` is the only ordinary effect allowed to create a body. Full entity insertion,
  liveness replacement, bootstrap, attachment delegation, and explicit runtime-body recovery name
  initialization directly. Confirm/interpolate/snap require an existing runtime timeline rather
  than inferring initialization from body kind or sampling mode.
- Ordinary player position paths now select `Confirm`; newer self teleport and force-position
  sequences select caused `Reset` during the same world message turn. Ordinary remote `Moved`
  outcomes temporarily select `Confirm`, preserving runtime placement until Phase 4 replaces that
  transitional adapter with the complete remote contact/distance classifier.
- Reordered `ClientRuntime::handle_world_events` so packet-scoped self authority and control
  effects finish before any event in the same batch projects runtime or dynamic views. A focused
  core test uses a projectable local entity and proves every emitted packet-time dynamic upsert
  retains the pre-packet runtime pose while entity authority advances.
- Clean-cut wire bit `0x04` from `UpdatePositionFlag::IS_GROUNDED` to `HAS_CONTACT`. Split the old
  conflated player cache into packet-only `last_server_contact` and solver-only
  `last_runtime_walkable`. Outbound position fallback reads typed runtime contact first, where
  `Sliding` is contact, then the packet fact; it never treats packet contact as solved walkability.
- Initialization/reset/suspension clear body-owned reconciliation deliberately. Vector-only
  updates preserve both authoritative and runtime placement. Focused scene tests prove
  confirm/interpolate/snap packet-time preservation, missing-body rejection, vector isolation, and
  reset/suspension cleanup.
- Concession: the Phase 2 acceptance sentence says a pending `Snap` installs on the next fixed
  tick. Phase 2 proves scheduling and absence of packet-time mutation, but actual tick consumption
  and its per-body placement consequence are inseparable from the Phase 4/5 simulation and
  publication cutover. That integration proof remains explicit debt; it is not counted as complete
  in the definition of done.
- Verification: `cargo fmt --all -- --check`; 265 `holtburger-protocol` tests; 461
  `holtburger-world` tests; 290 `holtburger-core` tests; and warnings-as-errors clippy for all three
  crates pass.

### Phase 3: Local-player cutover — complete

#### Deliverables

- Route accepted self position updates through core's explicit local authority decision:
  default-autonomy confirmation and reset. Do not retain the generic local near/far classifier;
  retail's self branch has no ordinary 96 m snap, and current Holtburger has no non-default
  autonomy producer.
- Compose local manual/authored actuation with the world-owned reconciler inside the shared spatial
  preparation/commit path.
- Keep heartbeat cadence, movement edge synthesis, held intent, server-control sequencing, and
  teleport activation in `MovementSystem`; remove its correction arithmetic and duplicate target
  state.
- Collapse or delete `server_controlled_projection` fields that duplicate the body-owned target;
  retain only protocol/control lifecycle facts with named consumers.
- Delete `ServerCorrection`, `CorrectionDisposition`, `CorrectionOverride`,
  `ServerInterpolationStep`, `has_active_server_correction`, and manual-playback reset behavior made
  obsolete by the cutover; sweep their vocabulary from comments and tests.
- Add focused tests proving:
  - five sequential autonomous heartbeat echoes do not interrupt continuous input;
  - a constraint above its free threshold dampens rather than resets the manual cursor;
  - server-controlled movement owns translation until completion and hands the still-held input
    back once;
  - sliding contact applies constraint damping;
  - airborne updates follow retail admission/gating;
  - teleport and forced reposition clear every correction/input timeline that must not survive.

#### Acceptance criteria

- Continuous held motion never reverses toward a same-epoch autonomous echo.
- The manual motion cursor remains continuous across confirmation-only updates.
- Server-controlled MoveTo, arrival, cancellation, and post-control input handoff retain existing
  behavior.
- The local dynamic path consumed by camera is the same path published to presentation.
- No local-only correction implementation remains in core.
- Focused core/world tests and the live continuous-forward probe pass.

#### Decisions, concessions, and debt

- Deleted the complete core-local correction path: `ServerCorrection`,
  `CorrectionDisposition`, `CorrectionOverride`, `ServerInterpolationStep`,
  `ServerPositionUpdate`, `has_active_server_correction`, its module, and its prepared-step
  choreography. A vocabulary sweep finds none of those symbols or the old local-correction
  comments in core/world.
- Core now makes the one local authority decision when consuming packet-scoped self events before
  projection: ordinary default-autonomy samples are `Confirm`; a newer teleport/force epoch or
  the first destination packet during portal activation is a caused `Reset`. Removed the unused
  packet-contact field from self events because default-autonomy local confirmation does not
  consume it and Holtburger has no non-default autonomy producer.
- Moved translation composition into `SpatialScene::prepare_dynamic_entity_collection`. The scene
  advances reconciliation on the already-captured tick-start participant before collision solves
  it, so the committed body carries the advanced constraint cursor with no second population scan,
  identity lookup, or tick allocation. The actor callback now supplies only ordinary physical
  actuation; core no longer reads or rewrites correction state.
- Retained `server_controlled_projection` and its heading fact deliberately. They are not duplicate
  reconciliation targets: a server `MoveTo` is core-owned ordinary drive policy with protocol
  lifecycle and completion semantics, while received-position confirmation is body-owned
  authority reconciliation. Server control preempts manual authored playback, preserves held
  intent, and creates one fresh playback cursor when control completes.
- Confirmation no longer participates in `has_active_manual_drive` and never resets manual
  playback. Focused tests apply five sequential self echoes while preserving runtime placement and
  five sequential confirmations while proving the manual cursor remains present and forward
  actuation continues.
- The shared physical preparation test proves a constraint above its free threshold modifies the
  ordinary basis without owning it, with identical damping for `Grounded` and `Sliding`.
  `Airborne` and `Unknown` preserve the first translation but accumulate it, producing the expected
  stronger damping when contact resumes.
- Tightened reset semantics discovered by the teleport-destination integration test: a caused
  authority reset now clears retained velocity, acceleration, and omega as well as motion and
  reconciliation state. Carrying pre-portal kinematics across a new placement epoch contradicted
  the plan's reset contract even though the typed effect was already present.
- Live verification used the release 3D host and local ACE server for a 10 s continuous-forward
  run. The stock probe completed with no drive error or presentation discontinuity. A temporary
  in-memory signed-step census observed 109.54 m of placement travel, zero backward steps above
  0.1 mm, and zero maximum backward displacement; the task-specific counter was removed
  immediately afterward.
- Concession: physical composition currently supplies the retail interpolation fallback speed.
  Default-autonomy self samples never interpolate, so this is not observable in Phase 3. Phase 4
  must add D9's `BodyMotionRuntime` adjusted-speed query and retain that computed fact with each
  remote interpolation target before remote interpolation is enabled.
- Verification: `cargo fmt --all -- --check`; all 463 `holtburger-world` tests; all 283
  `holtburger-core` tests; warnings-as-errors clippy for both crates; release host build; and two
  credential-redacted 10 s live client probes pass.

### Phase 4: Remote-body cutover

#### Retail-policy correction approved before implementation (2026-08-28)

The plan currently says a newer remote force-position epoch becomes `Reset`. The cited retail
receive path does not support that statement:

- `SmartBox::HandleReceivedPosition` handles `force_position_timestamp` only inside the
  `object == player` branch (`acclient.c:138968-138984`).
- After the outer position timestamp is admitted, a non-player object calls
  `CPhysicsObj::MoveOrTeleport` with teleport timestamp, contact, and velocity only
  (`acclient.c:139018-139041`). Force position is not an input.
- `CPhysicsObj::MoveOrTeleport` resets for a newer teleport epoch or missing cell, rejects
  non-contact, snaps at `player_distance >= 96`, and otherwise interpolates
  (`acclient.c:311475-311523`).
- ACE includes the object's current force-position sequence in every `PositionPack`, but increments
  teleport—not force—for `adminMove`; ordinary observer broadcasts therefore do not establish a
  separate remote force-reset branch
  (`ACE/.../PositionPack.cs:27-50`, `WorldObject_Networking.cs:429-437`).

The existing Holtburger `Entity::apply_server_position_update` predates this plan and currently
rejects/regards force sequence for every actor, then reports any newer remote force sequence as
`Reset`. Preserving that behavior would require a `RETAIL DIVERGENCE` with an observable remote
snap/lifecycle consequence and no measured compatibility need. The approved clean cutover is to
make force-position ordering local-player-only: remote admission uses position timestamp first,
teleport timestamp for reset, packet contact for sequence-only rejection, and viewer distance for
snap/interpolate. A remote forced correction broadcast remains an ordinary position sample unless
ACE also advances teleport, which its admin-move path already does.

`GameMessageAutonomousPosition` is a second, lower-impact uncertainty. ACE retains a server message
class but `Player.SendAutonomousPosition` is commented out, and no such inbound packet appeared in
the live census. Holtburger currently treats the absence of a position timestamp on this opcode as
an unconditional remote reset. The decompile exposes the client-to-server `0xF753` send path but no
independently identified inbound handler. The approved scope keeps this unmeasured opcode out of
the ordinary `UpdatePosition` classifier and retains its existing explicit reset behavior
temporarily, documented as unverified debt, rather than letting it distort the proven primary path.

#### Deliverables

- Classify accepted remote `PositionPack` updates through the independently proven generic retail
  decision ladder and apply the resulting body effect.
- Preserve runtime placement on ordinary near updates and arm/replace the body-owned interpolation
  target instead of replacing the body pose.
- Apply reconciliation to both physical remote actuation and pose-only remote projection within
  their existing scheduled tick paths.
- Preserve authored motion/velocity as the ordinary basis when interpolation is not assigning;
  apply constraint damping after the surviving basis.
- Implement the Phase 0 target-history decision without a second motion store.
- Retain an ordinary far snap as pending scheduled body work; consume it on the next fixed tick
  rather than changing runtime placement in the packet handler.
- Add focused tests for near convergence, overlapping updates, direction reversal, landblock-aware
  deltas, non-contact admission, missing-cell recovery, 96 m snap boundary, teleport reset and
  remote-force irrelevance,
  despawn, suspension, attachment, and physical versus pose-only parity.
- Prove that packet-driven dynamic upserts retain the pre-packet runtime placement identity and that
  ordinary movement appears only in the next integrated tick batch.

#### Acceptance criteria

- A near remote update does not directly mutate `SpatialBody.pose` or frontend placement.
- Physical and pose-only remotes given equivalent starting facts produce equivalent correction
  targets and convergence before collision-specific response.
- Idle bodies without reconciliation work do not become scheduled movers solely because they
  retain an authoritative pose.
- Far correction snap and teleport reset remain observably distinct; remote force timestamps have
  no independent placement consequence.
- World/core focused suites pass.

#### Decisions, implementation evidence, and debt

- Deleted the transitional `EntityPositionSyncOutcome::{Moved, Reset}` path. Remote
  `PositionPack` admission now requires a strictly newer position sequence, restores the old
  position timestamp when teleport is stale by mutating nothing, advances only position sequence
  for same-epoch non-contact, resets for a newer teleport or missing runtime cell, snaps at
  current object-to-viewer distance `>= 96 m`, and otherwise interpolates. Entity authority and
  the classified body effect commit in the same world turn.
- Remote force-position sequence is neither an admission input nor stored from `PositionPack`.
  Focused tests prove both increasing and regressing force values leave the retained remote force
  timestamp unchanged while a newer contacted position remains ordinary. The unobserved inbound
  `AutonomousPosition` handler is isolated behind `apply_server_autonomous_position_update` and
  retains its explicit forced reset as approved unverified debt.
- `BodyMotionRuntime` retains the last valid positive `RunForward` multiplier and exposes one
  adjusted-speed query. `Interpolate` captures that result once on its target; spatial code does
  not inspect motion state or packet velocity. Final compiled sizes are `SpatialBody` 488 bytes,
  `PoseReconciliationState` 104 bytes, its optional box 8 bytes, and
  `AuthoritativePoseEffect` 44 bytes. D9 adds 8 active bytes to the boxed state and 8 bytes to the
  transient effect without changing idle-body size.
- Both existing tick paths consume the same body-owned composition. Physical bodies compose on
  their already-captured dynamic participant before collision. Pose-only bodies compose before
  dead reckoning and remain scheduled with no ordinary basis while interpolation is active.
  The Phase 6 implementation initially projected contacted pose-only packets as `Sliding`; physical
  bodies kept locally solved contact. **Superseding correction (Phase 7):** packet contact proves
  received contact only, not a locally solved sliding surface, so it now remains a private
  reconciliation fact while pose-only runtime contact stays `Unknown`. A parity test observes
  equivalent pre-collision deltas with less than 2 mm outdoor `f32` re-anchoring quantization.
- Pending physical snaps are captured in the existing dynamic collection epoch beside movers and
  committed once at the fixed boundary; pose-only snaps are consumed at the same logical
  boundary. Neither path adds an all-body pass. Focused tests cover packet-time preservation,
  strict/stale sequencing, sequence-only contact admission, missing-cell recovery, exact 96 m
  boundary, teleport reset, remote force irrelevance, target replacement/direction reversal,
  landblock-aware deltas, physical/pose-only parity, suspension/reset cleanup, and physical snap
  transaction completion.
- Verification at this boundary: all 472 world tests and 285 core tests pass; warnings-as-errors
  clippy and formatting pass.

### Phase 5: Presentation consequences and resteering checkpoint

#### Deliverables

- Add an ordinary non-integrated correction-snap kind to the dynamic placement contract; use a
  zero-duration batch and do not bump world generation or reset portal/camera lifecycle.
- Replace `dynamic_entity_tick_event`'s batch-wide advance kind with per-body placement consequences
  produced by the world tick, so integrated actors and an ordinary snapped actor can share one
  atomic batch without lying about either path.
- Verify `DynamicEntityPlacementSystem` clears an active interpolated path for ordinary snap,
  teleport, and reset while preserving their distinct semantic kinds.
- Confirm ordinary interpolation publishes exactly one integrated host path per changed body per
  tick and creates no packet-time placement mutation.
- Rerun the Phase 0 traffic census and dry-run remaining cleanup against observed target overlap,
  convergence, event counts, and tick cost.
- Verify the D6 one-target decision against the completed path. If remaining jitter shows repeatable
  overlap, record the new census before resteering to a queue; if it originates in authored motion
  selection/animation, spin it into a separate plan.

#### Acceptance criteria

- Camera, collision, audio/map placement, and rendered placement resolve the same runtime pose
  before, during, and after a correction.
- Ordinary snaps do not emit teleport/forced-reset presentation discontinuities.
- No frontend network reconciliation clock, target, or retained correction state is introduced.
- Resteering decisions and any spun-out debt are recorded in this plan.

#### Decisions and verification

- Added `RuntimeBodyAdvanceKind::{Integrated, CorrectionSnap}` to the world tick consequence and
  `DynamicEntityPlacementAdvanceKind::CorrectionSnap` to the serialized presentation contract.
  The core tick builder consumes per-GUID overrides rather than one batch-wide kind. A
  correction-only batch has zero duration; a mixed batch retains its ordinary duration while each
  snap remains instant by kind.
- The 3D placement system already had the right non-integrated behavior: it clears the active path
  and installs the final host point. The schema and focused tests now prove the same behavior for
  `correction-snap`, without using teleport/reset lifecycle or touching camera generation.
- Packet-time near updates preserve dynamic root pose and membership. Implementation exposed a
  related frontend debt: `dynamicPlacementIdentity` included contact and vectors even though
  `updatePlacement` consumes only pose/membership, so a contact-level upsert could clear an active
  host path. The identity now equals the scene-spatial path identity (pose plus membership for
  world roots); contact/vector changes remain in the desired entity level but cannot rewrite the
  root. A focused runtime test proves contact-only upserts leave placement revision unchanged.
- The one-target decision remains supported by the Phase 0 measured 82.4 ms worst convergence
  versus roughly 190 ms minimum packet interval. The completed path introduces no queue, frontend
  clock, correction target on the wire, or repeatable overlap evidence requiring resteering.
- Verification: all 1,605 TypeScript tests, Svelte/TypeScript checks, ESLint, Knip, and host clippy
  pass. The release live probe completed a 10 s forward run with 258 dynamic events, zero
  discontinuities, and no drive error; its smaller 26-entity scene is behavior evidence, not a
  like-for-like workload comparison with the 57-entity baseline.

### Phase 6: Performance verification and cleanup

#### Deliverables

- Compare the Phase 0 and final workloads using the same scene, actor counts, observation duration,
  render scale, and hardware:
  - host fixed-tick median/spread;
  - active correction count and convergence duration;
  - scheduled physical/pose-only bodies;
  - dynamic upsert and tick-batch counts/bytes;
  - browser placement mutation and allocation profile;
  - visible local reversal count and remote correction discontinuities.
- Verify correction work occurs inside existing body iteration and is proportional to active
  bodies; no extra population scan, per-tick allocation, or correction data crosses the wire.
- Run formatting, clippy with warnings denied, Rust/TypeScript tests, browser harness coverage, and
  the credential-redacted live client probe.
- Remove temporary diagnostics, stale local-correction symbols, compatibility adapters, duplicate
  target fields, misleading `grounded` booleans, and dead tests preserving snapshot-era behavior.
- Update `crates/holtburger-world/ARCHITECTURE.md`, `crates/holtburger-core/ARCHITECTURE.md`, and any
  affected 3D dynamic-delivery documentation.
- Add required `RETAIL QUIRK`/`RETAIL DIVERGENCE` markers only for observable behavior that does not
  match the cited retail path; structural choices receive ordinary comments.

#### Acceptance criteria

- Continuous local motion has zero one-second backward corrections across the recorded run.
- Remote ordinary corrections converge without packet-time snaps; far/reset branches remain
  immediate and correctly typed.
- Host correction cost is proportional to active bodies and does not materially regress the fixed
  tick for the measured workload.
- Dynamic packet-time placement mutations decrease to zero; frontend work does not move from
  upserts into a larger hidden reconciliation loop.
- All task-specific diagnostics are removed and architecture documentation describes the final
  ownership truth.

#### Decisions, verification, and measurement concession

- The final storage and scheduling shape is proportional to correction producers. Every retained
  `SpatialBody` pays one 8-byte optional-box pointer; only an active body allocates the 104-byte
  reconciliation state. Physical reconciliation runs on the participant already captured by the
  scheduled dynamic collection, pose-only reconciliation runs on the already tracked projection
  request, and pending snaps share those paths. There is no second population scan, correction
  registry lookup, correction target on the frontend wire, or frontend reconciliation loop.
- A deterministic browser-host run spawned one physical WCID 7 actor, advanced all 40 requested
  33.333 ms ticks with 40 changed batches, observed zero animation discontinuities, and removed the
  actor plus its runtime resources on despawn. Its 50-frame SwiftShader sample averaged 0.55 ms of
  browser tick work. This is regression coverage and current-workload context, not a claim about
  live host correction cost.
- The final release live probe ran continuous forward motion for 10 s with no drive error or
  presentation discontinuity. It covered 53.92 m, 258 dynamic events, 437 presentation frames, a
  peak 26-entity snapshot, a peak 18-entity batch, and 928,797 serialized bytes. Temporary
  in-memory signed-step instrumentation repeated the run with zero backward steps above 0.1 mm and
  zero maximum backward displacement, then was removed.
- A matched live CPU before/after comparison was not available: Phase 0 recorded delivery counts,
  not CPU timings, and its 57-entity scene was not reproduced by the final server population
  (23-26 entities). Raw final event/timing totals therefore are not presented as an improvement
  percentage. The structural result rules out the feared population-wide cost, while the browser
  and live probes establish bounded current-workload behavior. A future performance comparison
  needs a replayable captured scene or controlled population harness; adding permanent profiling
  machinery to manufacture a percentage is not justified by this change.
- Final verification passes: 472 world tests, 285 core tests, world/core doc tests, 1,605
  TypeScript tests, Svelte/TypeScript checks, ESLint, Knip, workspace-wide Rust clippy with warnings
  denied, formatting, release host build, browser harness, diff validation, and the credential-
  redacted live probe. Temporary diagnostics are absent, and the world/core architecture documents
  describe the final ownership and presentation contracts.

### Post-implementation validation feedback (2026-08-28)

Live multi-actor validation confirmed that the original one-second local reversal is gone, but
exposed four coupled defects outside the position-sample classifier:

| Observation | Proven code path | Planning consequence |
| --- | --- | --- |
| The locally controlled player remains visually idle while walking or turning. | Manual actuation advances `MovementSystem::manual_motion_runtime`, while `project_client_dynamic_entity` publishes only `WorldState.motion_runtimes.playing_clip`. `advance_authored_motion_except` deliberately removes the held local actor from that world registry. Before the cutover, heartbeat interpolation accidentally made `has_active_manual_drive` false often enough to mask the split ownership. | Delete the private local playback owner. Core selects local input policy, but it must drive the same world-owned per-body playback cursor that presentation reads. |
| A small remote step can continue well beyond the received target; turning in place can acquire translation. | Pose-only reconciliation writes `composition.translation / dt` into `SolvedBodyKinematics.velocity`; `apply_solved_runtime_body_kinematics` retains that value, and the next projection resolves it as a velocity basis. Physical grounded reconciliation similarly converts an assigned correction into `GroundedBodyActuation::drive`, whose accepted velocity becomes retained coasting state. | Do not add stop-time zeroing. Split one-tick accepted-path motion from retained physical momentum and make reconciliation/authored offsets incapable of becoming the next tick's physical basis. |
| A moving peer can impart velocity to the local player and slide it across the ground. | `dynamic_collision_velocity` computes response in the peer's moving frame and adds `peer_velocity` to the mover. Retail `CPhysicsObj::handle_all_collisions` reflects or zeros only `this->m_velocityVector` against the collision normal (`acclient.c:310018-310051`); peer velocity is not added. | Keep relative peer motion for swept contact detection, but remove it from the committed mover response. A stationary mover remains stationary. |
| Packet contact is projected as `ContactState::Sliding` for pose-only bodies. | `BodyProjectionResolver` defines `Sliding` as locally solved physics-driven motion and therefore bypasses grounded authored root motion. The packet bit proves contact only; it does not prove that the local solver classified a sliding surface. | Stop using a solved-contact variant as a wire-evidence surrogate. Preserve packet contact only in the reconciliation/admission contract that consumes it. |

The velocity defect is a pre-existing structural mismatch made visible by the reconciliation
cutover. Retail keeps `CPhysicsObj::m_velocityVector` (retained physical velocity) separate from
`cached_velocity` (accepted displacement divided by quantum): `UpdatePhysicsInternal` integrates
only `m_velocityVector` (`acclient.c:306094-306172`), while the post-transition path writes
`cached_velocity` (`acclient.c:310862-310927`). `CPhysicsObj::get_velocity` returns the latter
(`acclient.c:306864-306870`), but `set_velocity` mutates the former (`acclient.c:306874-306923`).
Holtburger currently collapses these roles into `SpatialBody.velocity`. This evidence supersedes
earlier plan/comment language suggesting that retail feeds `cached_velocity` back into the next
physics integration tick.

The successful authority decisions remain fixed boundaries: default-autonomy self updates are
`Confirm`; admitted remote near updates arm interpolation; far snap, teleport reset, and remote
force-sequence policy do not change in this remediation.

### Phase 7: Freeze motion and velocity roles with failing differentials

#### Deliverables

- Census every producer and consumer of `SpatialBody.velocity`, `SolvedBodyKinematics.velocity`,
  `PhysicalBodyTickCommit.velocity`, `RuntimeSpatialBodyView.velocity`, and the serialized dynamic
  entity velocity. Classify each as retained physical momentum, accepted-path derivative, wire
  authority, collision input, gameplay query, or presentation-only data. No field survives with two
  semantic roles.
- Extend the independent retail oracle around update ordering: sequence/reconciliation offset,
  physical `m_velocityVector` integration, collision acceptance, and `cached_velocity` derivation.
  Include simultaneous interpolation plus nonzero physical velocity so the implementation cannot
  make them mutually exclusive by accident.
- Add focused red tests for:
  - held local walk and turn projecting a non-idle clip from the exact cursor that supplies root
    motion;
  - pose-only interpolation reaching its target and producing no translation on later ticks;
  - a physical grounded interpolation target producing no retained correction momentum;
  - turn-in-place producing zero linear displacement after reconciliation completes;
  - an authored stop not coasting on the previous root-motion derivative;
  - a stationary mover retaining zero physical velocity when a moving peer contacts it.
- Replace the packet-contact-as-`Sliding` shortcut with a named received-contact fact in the
  reconciliation input/state. Do not add another general body contact enum case unless a consumer
  census proves it is meaningful outside reconciliation.
- Dry-run Phases 8-10 against the consumer census before changing types. Record any unavoidable DTO
  meaning change and stop for review if gameplay or protocol code actually requires the collapsed
  velocity semantics.

#### Acceptance criteria

- Each retained velocity-like field has one documented meaning and at least one named consumer.
- The oracle proves accepted-path velocity is observational output, not next-tick physical input.
- Every reported regression has a deterministic failing test before its fix lands.
- The existing self/remote authoritative-pose classification differential remains unchanged and
  green.

#### Decisions and course corrections

- Completed on 2026-08-28. The velocity census found six contract surfaces carrying three different
  facts:

  | Current field | Current producers and consumers | Frozen Phase 9 meaning |
  | --- | --- | --- |
  | `Entity.velocity` / authoritative body vectors | Wire entity state and position updates replace it; world admission copies it into the runtime body. | Producer-authoritative physical `m_velocityVector` input. It is not an accepted-path derivative. |
  | `SpatialBody.velocity` | Wire replacement, pose-only next-tick projection, grounded/free physical integration, dynamic collision response, settling checks, physical tick publication, runtime samples, and dynamic DTO projection. | Split into retained physical velocity and cached accepted-path velocity. Retained physical velocity alone feeds integration and collision response; cached velocity alone feeds retail-style observation. |
  | `SolvedBodyKinematics.velocity` | Pose-only dead reckoning and authored offsets derive displacement/quantum; scene publication currently stores it back into `SpatialBody.velocity`. | Rename to cached accepted-path velocity. It is a tick result and never a future projection basis. |
  | `PhysicalBodyTickCommit.velocity` | Free and grounded solvers currently mix collision-response velocity with achieved displacement/quantum, then scene publication stores the result in `SpatialBody.velocity`. | Carry both the retained physical response and cached accepted-path velocity as distinct typed facts. |
  | `RuntimeSpatialBodyView.velocity` / `SpatialEntitySample.velocity` | Copy the body field; the CLI debug dashboard is the only production reader found. Core movement reads contact and pose, not this velocity. Autonomous position packets contain no velocity. | Publish cached accepted-path velocity, matching retail `CPhysicsObj::get_velocity`. Keep retained physical vectors private to world simulation. |
  | Serialized `DynamicEntityPlacementView::{velocity, acceleration, omega}` | Rust projection, TypeScript validation, and fixtures only; no 3D production consumer reads them. | Remove the three fields in Phase 9 instead of assigning accidental compatibility meaning. Phase 10 diagnostics use a harness-only telemetry contract. |

  `RuntimeSpatialBodyView.contact` remains a real core consumer for local motion gating and outgoing
  contact bits; this is independent of the velocity split. `acceleration` and `omega` remain retained
  physical inputs internally, but their read-model copies have no named product consumer.
- Added `motion_update_retail_differential.rs`, an independent ordering oracle based directly on
  `acclient.c:306094-306172,308262-308298,310862-310927`. Its four cases prove that interpolation
  replaces the authored offset without suppressing simultaneous physical integration, collision
  clipping changes cached velocity without changing retained physical velocity, accepted authored
  motion is not next-tick momentum, and peer velocity is not an input to a stationary mover's
  response. The focused oracle run passed all four cases.
- Disposable production-path probes were run before any Phase 8/9 repair and then removed so the
  branch does not retain ignored or intentionally failing tests:
  - local held walk followed by turn advanced `MovementSystem::manual_motion_runtime`, but
    `WorldState.motion_runtimes.playing_clip(guid)` remained `None`; the focused core test failed at
    that exact assertion;
  - pose-only interpolation from `0.0` to `0.1` reached the target, then the next 30 ms tick reached
    `0.2000122` with retained `3.3335369 m/s` velocity;
  - a rotation-only authority update at `x = 0.1` produced the same `x = 0.2000122` translation;
  - grounded interpolation reached `x = 90.1`, then coasted to `90.1944` with retained
    `3.0944824 m/s` velocity;
  - a stationary mover given a `4 m/s` moving peer produced `4.2 m/s` in the current elastic
    response instead of remaining zero.
- The authored solver's isolated stop probe was green: without the shared-body writeback, a stopped
  authored basis does not move. The authored-stop product symptom is therefore another observation
  of the collapsed `SpatialBody.velocity`, not a separate stop-state defect. Phase 9 must add one
  permanent end-to-end stop regression while fixing that writeback, but it must not add a stop-time
  zeroing mechanism.
- Replaced pose-only packet contact masquerading as `ContactState::Sliding` with the private,
  reconciliation-owned `received_contact` fact. Pose-only interpolation now consumes that fact while
  the runtime body's solver contact remains `Unknown`; physical bodies continue to use locally solved
  contact. This avoids expanding the general contact enum for a fact with no consumer outside
  reconciliation.
- Dry-run result for Phase 8: the required seam is one world operation over the existing
  `MotionRuntimeRegistry`, keyed by body ID/GUID and returning the exact tick offset. Core retains
  input policy only. The cutover deletes `BodyMotionRuntime` from `MovementSystem`; no mirrored clip,
  phase, or compatibility adapter is required. Stop, stance replacement, teleport/reset, body
  replacement, and logout already have registry lifecycle seams that must be exercised in the same
  change.
- Dry-run result for Phase 9: use one body-owned composite for retained physical vectors and a
  separate cached accepted-path result. The physical commit must carry both because collision can
  clip the path while changing retained momentum by a different equation. Grounded controller drive,
  authored offset, and reconciliation offset are one-tick kinematic contributions; launch, gravity,
  acceleration, wire velocity, and mover-only collision response are physical inputs. Relative peer
  motion remains detection-only. This is a clean type cutover, not a parallel legacy path.
- Dry-run result for Phase 10: product telemetry cannot justify retaining unused public DTO fields.
  The browser/debug harness will receive a purpose-built diagnostic sample containing target delta,
  accepted delta, cached velocity, private retained physical velocity, clip transition, and collision
  response. The normal 3D entity placement contract remains presentation-focused.
- No gameplay or protocol consumer requires the collapsed velocity semantics, so the Phase 8/9
  cutovers can proceed without a review stop. The only unavoidable compatibility change is deletion
  of unused dynamic-placement kinematic fields from the Rust/TypeScript DTO.

### Phase 8: Make authored playback one per-body cursor

#### Deliverables

- Add one focused world operation that drives a named body's existing `MotionRuntimeRegistry` entry
  from a caller-supplied `MotionOrder` and quantum, returning the tick's exact authored offset.
  World owns table lookup/cursor state; core continues to own local input mapping, stance, run-rate,
  server-control policy, and which body is excluded from automatic remote advancement.
- Change local manual actuation to drive that registry operation and consume its returned offset.
  Delete `MovementSystem::manual_motion_runtime`; retain no mirror clip, phase, or cursor in core.
- Project the clip from the same registry entry for local and remote actors. Stopping, changing
  stance, server-directed control, teleport/reset, logout, and body replacement must retire or
  replace that one cursor through explicit existing lifecycle operations.
- Preserve the current rule that a confirmation neither resets held input nor restarts playback.
  Remove the duplicate `current_local_drive_control` evaluation currently present in the physical
  tick preparation while touching that seam.

#### Acceptance criteria

- The local rendered clip changes to walk/run/turn while the corresponding root offset drives the
  body and returns to the authored idle clip on stop.
- One local command advances one cursor exactly once per fixed tick; no frontend or core playback
  mirror exists.
- Five sequential self confirmations preserve both clip continuity and forward/turn cursor
  progression.
- Remote playback and server-directed local movement retain their existing command lifecycle.

#### Decisions and course corrections

- Completed on 2026-08-28. `WorldState::drive_authored_motion_for_body` is the single explicit
  adapter seam: the caller supplies a body GUID, semantic `MotionOrder`, and quantum; world resolves
  the body's table, advances its existing `MotionRuntimeRegistry` entry, and returns the exact rigid
  offset. Missing source/table cases are typed failures rather than silent idle fallbacks.
- Deleted `MovementSystem::manual_motion_runtime` and `manual_motion_offset`. Local manual root
  actuation, `BodyProjectionResolver`, and dynamic-entity presentation now observe the same registry
  entry. The bulk snapshot scan excludes a locally driven GUID, then the local adapter advances that
  same cursor exactly once; it no longer creates a second runtime.
- Corrected a lifecycle bug exposed by the cutover: `advance_authored_motion_except` previously
  derived cursor liveness from the bodies it advanced. Excluding the local player therefore deleted
  its cursor before every local tick and would have restarted playback continuously. Registry
  retention now follows all live entities; `remove_entity`, motion-snapshot reset, teleport reset,
  and body replacement own explicit retirement/replacement.
- A one-shot `pending_manual_playback_stop` is retained in core because it is input-policy state, not
  playback state. It ensures the simulation tick advances the world cursor through the authored stop
  transition and consumes that transition's exact root offset. The flag is consumed once, cleared by
  a new manual order or server-control handoff, and carries no clip, phase, table, or cursor mirror.
- Deleted the hollow local lane from `ClientSimulationSystem::build_projection_request`. Local
  physical actuation was already prepared transactionally, while the later pose-only loop rebuilt a
  local input, reevaluated `current_local_drive_control`, and immediately skipped it. The request is
  now honestly remote-only, removing the duplicate policy evaluation and five tests that preserved
  an unused local request shape.
- Focused coverage proves walk/diagonal/turn orders write the offset and semantic substate visible in
  `WorldState.motion_runtimes`, five sequential self confirmations preserve that cursor, a manual
  stop reaches the authored idle substate, an absent server snapshot does not delete the idle cursor,
  and server-controlled projection suppresses then resumes held local playback without losing the
  drive. Existing registry clip-projection tests continue to cover concrete animation IDs/windows.
- Phase verification passed 476 world tests and 281 core tests. World/core clippy passed for all
  targets with warnings denied. No compatibility shim or remaining core playback owner survives.

### Phase 9: Separate accepted-path motion from retained physical momentum

#### Deliverables

- Replace the collapsed spatial kinematics shape with explicit composite facts for retained
  physical vectors and accepted-path motion. Use names aligned with the retail roles, but do not
  expose a new public field until the Phase 7 consumer census identifies its consumer.
- Compose each fixed tick in retail order:
  1. authored/reconciliation produces a one-tick kinematic offset;
  2. retained physical velocity, acceleration, and omega integrate independently;
  3. collision accepts/clips the combined candidate path;
  4. accepted displacement derives cached/path velocity for observation only;
  5. only physical response changes retained physical momentum.
- Make pose-only advancement follow the same ownership rule without pretending to run collision:
  interpolation and authored offsets update pose/path output, while only received physical vectors
  may remain a velocity basis on the next tick.
- Refactor grounded physical actuation so controller/authored/reconciliation displacement is not
  stored as coasting momentum. Preserve explicit launch, gravity, acceleration, received velocity,
  friction, and collision response as true physical inputs.
- Correct dynamic peer response to the retail mover-only equation. Peer planned motion remains an
  input to relative swept collision detection and contact time, but not to the mover's post-contact
  velocity. Preserve blocking, deterministic directional ownership, reports, missiles, inelastic
  response, and environment collision behavior.
- Sweep and correct misleading `cached_velocity`, “following tick,” and peer-response commentary in
  code, architecture docs, the permanent runtime survey, and this plan. Historical plans may retain
  chronology only where the superseding correction is explicit.

#### Acceptance criteria

- A remote target is never overshot by retained interpolation momentum; after convergence, an idle
  actor remains at the target indefinitely in deterministic ticks.
- Walk, stop, turn-in-place, direction reversal, and overlapping target replacement preserve exact
  authored/reconciliation displacement without manufacturing physical velocity or omega.
- Explicit wire velocity and airborne launch still integrate, collide, and decay according to
  physical policy while reconciliation is active.
- A moving actor may be blocked by a stationary actor, but walking into a stationary local player
  cannot transfer the peer's velocity to that player.
- Physical and pose-only actors retain equivalent pre-collision reconciliation paths, with only the
  physical actor adding environment/peer response.

#### Decisions and course corrections

- Completed on 2026-08-28. `SpatialBody` now stores two explicit composite facts:
  `RetainedBodyKinematics` is the world-space physical velocity, acceleration, and omega eligible
  for future integration and collision response; `AcceptedBodyMotion` is the latest accepted
  displacement/rotation divided by the fixed quantum and is observational only. `SolveBodyInput`
  independently carries a one-tick authored offset and retained physical vectors, while
  `SolvedBodyKinematics` returns both accepted and retained results. The mutually exclusive
  `SolveProjectionBasis` and the authored-only wrapper were deleted.
- The retail differential was corrected after re-reading `CPhysicsObj::UpdatePhysicsInternal`,
  `get_velocity`/`set_velocity`, and the post-transition cache write. Authored/interpolation offset,
  physical `m_velocityVector`, and observational `cached_velocity` are simultaneous roles, not
  alternate bases (`acclient.c:306094-306172, 306864-306923, 310862-310927`). The unified pose-only
  advance composes authored local offset plus independently integrated world-space physical vectors,
  derives accepted motion once, and advances retained velocity only from retained acceleration.
  Physical omega rotates orientation in world axes; it does not rotate world-space linear velocity.
- Pose-only reconciliation now removes the ordinary physical displacement before replacing/damping
  the one-tick kinematic contribution, then adds that physical displacement back. Grounded and free
  physical reconciliation likewise alter controller/kinematic drive only. `FreeFlight` explicitly
  carries `retained_velocity` and `kinematic_velocity`; local, remote, and Explorer-fly controller
  adapters use the latter, while coasting and received launch/velocity use the former. This removed
  the remaining path by which a correction or controller derivative could become coasting momentum.
- Physical collision commit now carries `retained_velocity` and `accepted_motion` separately.
  Stable continuous walkable support leaves retained physical velocity unchanged while suppressing
  collision/support response, matching `CPhysicsObj::handle_all_collisions`
  (`acclient.c:309982-310051`). Dynamic swept contact still samples peer planned motion for contact
  time, but response reflects or zeros only the mover's retained physical velocity; it never adds
  peer velocity. A stationary mover may receive the solver's bounded separation correction while
  retaining exactly zero velocity.
- `RuntimeSpatialBodyView::velocity` and `SpatialEntitySample::velocity` retain the retail-style
  accepted-path meaning used by animation/gameplay observation; their acceleration and omega remain
  retained physical vectors. The unused serialized `DynamicEntityPlacementView` velocity,
  acceleration, and omega fields were deleted from the Rust/TypeScript contract and fixtures rather
  than preserving an ambiguous API. Host animation speed now names accepted motion; launch tests and
  physical policy name retained motion.
- Permanent regressions cover authored turn-in-place with zero linear/retained motion, authored stop,
  pose-only target convergence and later idleness, simultaneous interpolation plus received physical
  velocity, grounded correction without retained momentum, pose-only/physical pre-collision parity,
  and a moving peer contacting a stationary mover without transferring velocity. Existing target
  replacement, reversal, airborne launch, collision, and authority-classification suites remain
  green. Outdoor pose re-anchoring retains the previously documented sub-2 mm coordinate
  quantization concession; it does not accumulate after convergence.
- Phase verification passed 482 world tests, 281 core tests, 245 host tests, and clippy for all
  targets in all three packages with warnings denied. The TypeScript contract check and 1,605 tests
  passed after the DTO deletion. World architecture and the historical authored-root-motion plan now
  explicitly record the `m_velocityVector`/`cached_velocity` correction. No compatibility shim,
  collapsed velocity field, or peer-response transfer survives.

### Phase 10: Multi-actor product verification and cleanup

#### Deliverables

- Extend the deterministic browser/debug harness with a production-path multi-actor scenario rather
  than adding debug state to the runtime. Exercise one local actor plus a remote-equivalent actor
  through small forward step, stop, turn-in-place, direction reversal, collision approach, and
  separation.
- Run a credential-redacted live client probe for continuous local forward/turn motion and moving
  remotes. If a second controllable account is unavailable, use deterministic automation for the
  acceptance gate and obtain user eyes on the real multi-client behavior; do not weaken the test to
  a single local actor again.
- Record, per actor, packet target displacement, accepted tick displacement, post-target drift,
  retained physical velocity, projected clip transitions, and collision-induced velocity. Keep the
  counters in the harness or remove temporary instrumentation after capture.
- Rerun formatting, workspace clippy with warnings denied, Rust/TypeScript suites, browser harness,
  release host build, and the original continuous-forward rubber-band probe.
- Update world/core architecture docs and this plan with final type ownership, course corrections,
  measurements, concessions, and any remaining protocol uncertainty.

#### Acceptance criteria

- Original local rubber-banding remains absent.
- Local walk/run/turn/stop animation agrees with the exact authored motion cursor driving the body.
- Remote small steps stop at their received targets within the reconciler tolerance; remote
  turn-in-place has zero unintended linear travel; remote clips agree with their motion commands.
- Actor contact never transfers peer locomotion velocity into a stationary actor. Blocking/contact
  behavior otherwise remains retail-grounded and deterministic.
- No private playback mirror, collapsed velocity role, packet-contact-as-solved-contact shortcut,
  diagnostic-only runtime field, or obsolete comment survives cleanup.

#### Decisions and course corrections

- Completed on 2026-08-28. The canonical browser harness now composes its existing production-path
  possession and entity-pair scenarios in one run: WCID 1 Clay is possessed through authored
  backward/turn/combined/stop/jump playback while WCID 1499 Flame Bolt approaches WCID 34621
  Killagurg through the real host dynamic-body collection. The combined run passed with no browser
  errors and returned the entity, body, playback, effect, template, and renderer populations to
  zero. This is the same pair whose historical pre-fix run moved the target 0.39 m and assigned
  `+1.0 m/s`, so it preserves a concrete product workload rather than substituting synthetic
  geometry.
- Combining those scenarios exposed two harness-only ownership assumptions. Pair reporting tried to
  read `placement.pose` from the possessed actor's attached equipment and still read the deleted
  ambiguous placement velocity; it now selects world placements explicitly, reports clips instead
  of a nonexistent kinematic field, and leaves accepted/retained proof to typed runtime tests. Bulk
  pair teardown could retire the originally possessed actor before final cleanup; final cleanup now
  checks the captured live generation before issuing another despawn. No production contract or
  runtime diagnostic field was added.
- The credential-redacted live probe now runs forward, turn-in-place, and stop phases and records
  per-actor path samples, maximum observed steps, and clip transitions. Against the local ACE server
  it completed normally with no drive error or presentation discontinuity in a 102-entity peak
  scene. The local actor travelled 19.5504 m during four seconds of forward run with a moving clip,
  0.00637 m during two seconds of turn-in-place with the turn clip, and exactly 0 m during the
  one-second stopped/idle phase. The local maximum delivered step was 0.3840 m. Multiple remote
  actors produced multi-sample motion during the same observation; credentials and raw sensitive
  process arguments were neither printed nor retained.
- Only one controllable account was available. Therefore the live probe cannot manufacture exact
  packet-target-versus-accepted-path measurements for a scripted second player. Remote target
  convergence, later idleness, turn-only zero linear motion, target replacement/reversal, and
  simultaneous received physical velocity remain acceptance-gated by deterministic production
  world paths; live evidence is observational for server-controlled remotes. This is a verification
  limitation, not protocol uncertainty and not justification for restoring diagnostic fields to the
  presentation DTO.
- Broad verification exposed one pre-existing asynchronous test race:
  `hydrated_remote_entity_joins_the_same_prepared_body_population` waited only for the remote body
  before asserting that both remote and local preparations completed. It now awaits both named
  bodies; no runtime code, timeout, or assertion was weakened.
- The post-completion quality audit removed a per-fixed-tick reconciliation allocation by carrying
  the compact cursor inline through prepared epochs and reusing the canonical optional box at
  publication. It also found that stable support skipped friction whenever controller drive was
  present. Retail damps retained `m_velocityVector` before composing movement-manager output
  (`acclient.c:306114-306153`), so retained momentum now damps independently of one-tick authored or
  controller drive. The browser fixture now waits for stationary grounded evidence instead of
  treating first contact as rest; this exposed and permanently covers heading-only input after a
  landing with retained tangential momentum.
- Final verification passed the combined browser harness, redacted live client probe, release host
  build, all 1,605 TypeScript tests, Svelte/TypeScript checks, ESLint, Knip, Prettier, workspace
  clippy for all targets with warnings denied, Rust formatting, and the complete workspace Rust test
  matrix (including 485 world, 282 core, and 245 host tests). The scripting suite's loopback-listener
  test required the expected sandbox network permission and then passed. No temporary artifact,
  credential, private playback mirror, collapsed velocity role, packet-contact-as-solved-contact
  shortcut, or diagnostic-only runtime field remains.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| A shared component becomes a universal controller with optional local/remote fields | Share only interpolation/constraint mechanics and spatial composition; authority adapters retain input, protocol, and motion policy |
| `Confirm` still suppresses motion through an indirect `has_work` predicate | Remove generic basis-ownership predicates; tests drive a constraint above its threshold while asserting manual cursor continuity |
| Packet contact and solved contact are flattened into one boolean | Keep received-position admission facts and typed runtime `ContactState` separate in APIs and tests |
| `Sliding` is silently treated as airborne | Differential and production tests require the same damping for `Sliding` and `Grounded` |
| Moving correction state onto every body bloats retained populations | Use the measured body-owned optional box: one idle pointer, active-only allocation, and no second identity map |
| A node queue adds allocations and visual latency without helping measured ACE traffic | Keep one replacing target with the required cited `RETAIL DIVERGENCE`; revisit only from repeatable overlap evidence |
| Remote packet upserts remain a second placement writer | Preserve runtime pose when arming correction and assert unchanged placement identity at packet time |
| Ordinary far correction is mislabeled as teleport/reset | Give ordinary snap a distinct effect and zero-duration placement kind with no generation/lifecycle reset |
| Physical and pose-only bodies drift into separate implementations again | Both consume the same body-owned composition API; parity tests compare equivalent pre-collision results |
| Interpolation assignment is accidentally added to authored translation | Preserve the independent retail ordering oracle and make replacement versus modification explicit in the type/API |
| Correction wakes every retained entity | Wake only a body receiving an effect or retaining active interpolation/constraint work; reuse existing tracked-body iteration |
| Existing tests preserve the wrong local generic classifier | Replace them with self/remote dispatch differentials rather than adjusting expectations to production |
| Live verification leaks credentials or creates concurrent ACE sessions | Use `.dev.env` only as process environment, retain probe redaction, serialize sessions, observe ACE cooldown, and never print arguments/raw stderr |
| A narrow zero-on-stop patch hides the collapsed velocity model | Split accepted-path observation from retained physical vectors before changing stop behavior; prove continued idle ticks |
| Moving the local cursor causes double advancement | Keep automatic world advancement exclusion and explicit local drive as mutually exclusive operations; assert one cursor step per tick |
| Separating path velocity breaks a consumer that relied on the ambiguous field | Complete the Phase 7 consumer census first and give each surviving field one named semantic contract |
| Collision correction accidentally makes actors pass through each other | Preserve relative swept detection and path clipping; change only the post-contact mover velocity equation |
| Packet contact grows into a second physical contact state machine | Retain only the last evidence needed by reconciliation; solved `ContactState` remains solver-owned |

## Definition of Done

- [x] Independent retail differential covers self/remote dispatch, interpolation, constraint
      ordering, contact/sliding, snap, and reset branches with `acclient.c` citations.
- [x] `SpatialBody`'s optional boxed composite is the sole retained pose reconciliation owner for
      local and remote actors.
- [x] `AuthoritativeBodySync`, local-only `ServerCorrection`, generic `has_work` basis ownership,
      and `preserve_local_runtime_pose` are deleted with their vocabulary swept.
- [x] Default-autonomy local updates confirm/constrain without interpolation, including while a
      server-directed motion projection is active; held input survives confirmation.
- [x] Constraint damping admits `Grounded` and `Sliding`, excludes `Airborne`/`Unknown`, and
      accumulates surviving travel in every state.
- [x] Remote near updates interpolate from the current runtime pose; far correction and teleport
      reset are distinct and tested, while remote force timestamps remain consequence-free.
- [x] Physical and pose-only remotes use the same reconciliation mechanics without changing
      collision participation.
- [x] Ordinary placement is published only by fixed-tick batches; packet-time upserts do not mutate
      placement; ordinary snaps use a typed zero-duration path.
- [x] Camera, collision, gameplay/runtime queries, audio/map consumers, and rendering read the same
      canonical runtime pose.
- [x] One-target versus queue storage is settled from recorded ACE traffic and documented.
- [x] No correction state crosses the frontend wire, no second population scan is added, and no
      per-tick correction allocations survive.
- [x] `cargo fmt --check`, workspace clippy with warnings denied, relevant Rust/TypeScript tests,
      browser harness verification, and the live client probe pass.
- [x] Before/after performance and behavior evidence is recorded with workload context; temporary
      instrumentation and sensitive artifacts are removed.
- [x] World/core architecture docs and this plan's decisions/course corrections reflect the final
      implementation.
- [x] Any observable retail departure carries the required cited compatibility marker and census.

### Regression-remediation Definition of Done

- [x] Local authored actuation and rendered animation consume one world-owned per-body playback
      cursor; `MovementSystem` retains no private playback runtime.
- [x] Accepted-path/cached velocity and retained physical velocity are separate typed facts, and
      authored or reconciliation displacement cannot become next-tick momentum.
- [x] Packet contact evidence is not represented as a locally solved `Sliding` state.
- [x] Dynamic collision response matches retail's mover-only velocity rule while preserving contact
      detection, blocking, reporting, and projectile behavior.
- [x] Deterministic tests cover local clips, remote convergence and stop, turn-in-place, explicit
      physical velocity, target replacement, and stationary-actor peer contact.
- [x] Multi-actor browser/live evidence covers the reported regressions, and the original local
      rubber-band acceptance remains green.
- [x] Misleading velocity/collision documentation and temporary diagnostics are removed; all
      project verification gates pass.

## Open Questions

No user decision is currently required. The remediation preserves actor blocking while removing
peer-velocity transfer; if retail evidence later proves player/creature pair filtering differs by
category or PK state, that is a separate collision-filter decision and must not be inferred from the
reported pushing symptom. The remote-force correction and quarantined inbound `AutonomousPosition`
debt remain unchanged. The unmatched-scene performance limitation is recorded in Phase 6; any
future repeatable target overlap can resteer D6 with a new census rather than speculative queue
state.
