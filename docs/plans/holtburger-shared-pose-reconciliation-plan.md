# Holtburger Shared Pose Reconciliation Plan

Status: **Draft; Phase 0 decision evidence recorded (2026-08-28).**

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
- `crates/holtburger-core/src/client/movement/client_correction_retail_differential.rs` is the
  independent arithmetic oracle, but currently tests the generic decision ladder without proving
  correct local-versus-remote dispatch.
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
teleport/force epochs become `Reset`; stale updates mutate nothing. A newer same-epoch position
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
not CPU timings. Phase 6 still owns before/after host and browser profiling because no storage or
target-history decision depends on speculative timing numbers.

## Phased Implementation

### Phase 0: Evidence capture and independent dispatch oracle

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

### Phase 1: World-owned reconciliation contract

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

### Phase 2: Authoritative-body API cutover

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

### Phase 3: Local-player cutover

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

### Phase 4: Remote-body cutover

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
  deltas, non-contact admission, missing-cell recovery, 96 m snap boundary, teleport/force reset,
  despawn, suspension, attachment, and physical versus pose-only parity.
- Prove that packet-driven dynamic upserts retain the pre-packet runtime placement identity and that
  ordinary movement appears only in the next integrated tick batch.

#### Acceptance criteria

- A near remote update does not directly mutate `SpatialBody.pose` or frontend placement.
- Physical and pose-only remotes given equivalent starting facts produce equivalent correction
  targets and convergence before collision-specific response.
- Idle bodies without reconciliation work do not become scheduled movers solely because they
  retain an authoritative pose.
- Far correction snap, teleport, and force reset remain observably distinct.
- World/core focused suites pass.

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

## Definition of Done

- [ ] Independent retail differential covers self/remote dispatch, interpolation, constraint
      ordering, contact/sliding, snap, and reset branches with `acclient.c` citations.
- [ ] `SpatialBody`'s optional boxed composite is the sole retained pose reconciliation owner for
      local and remote actors.
- [ ] `AuthoritativeBodySync`, local-only `ServerCorrection`, generic `has_work` basis ownership,
      and `preserve_local_runtime_pose` are deleted with their vocabulary swept.
- [ ] Default-autonomy local updates confirm/constrain without interpolation, including while a
      server-directed motion projection is active; held input survives confirmation.
- [ ] Constraint damping admits `Grounded` and `Sliding`, excludes `Airborne`/`Unknown`, and
      accumulates surviving travel in every state.
- [ ] Remote near updates interpolate from the current runtime pose; far correction, teleport, and
      forced reset are distinct and tested.
- [ ] Physical and pose-only remotes use the same reconciliation mechanics without changing
      collision participation.
- [ ] Ordinary placement is published only by fixed-tick batches; packet-time upserts do not mutate
      placement; ordinary snaps use a typed zero-duration path.
- [ ] Camera, collision, gameplay/runtime queries, audio/map consumers, and rendering read the same
      canonical runtime pose.
- [ ] One-target versus queue storage is settled from recorded ACE traffic and documented.
- [ ] No correction state crosses the frontend wire, no second population scan is added, and no
      per-tick correction allocations survive.
- [ ] `cargo fmt --check`, workspace clippy with warnings denied, relevant Rust/TypeScript tests,
      browser harness verification, and the live client probe pass.
- [ ] Before/after performance and behavior evidence is recorded with workload context; temporary
      instrumentation and sensitive artifacts are removed.
- [ ] World/core architecture docs and this plan's decisions/course corrections reflect the final
      implementation.
- [ ] Any observable retail departure carries the required cited compatibility marker and census.

## Open Questions

None of the structural forks requires a user decision now. Phase 0 evidence settles target history,
storage ownership, wire-contact meaning, local autonomy dispatch, non-contact storage, and
interpolation speed ownership. Phase 6 still measures before/after runtime cost, and any repeatable
target overlap found during implementation can resteer D6 with a new census rather than speculative
queue state.
