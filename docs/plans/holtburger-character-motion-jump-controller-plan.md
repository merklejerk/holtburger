# Holtburger Character Motion and Jump Controller Plan

Status: Complete
Created: 2026-08-13
Implementation branch: `3d-next`
Parent foundation: `docs/plans/holtburger-3d-host-physics-recovery-plan.md`

> Superseded policy note (2026-08-15):
> `docs/plans/holtburger-open-collision-scene-edge-plan.md` removes collision-coverage jump
> readiness/rejection and body suspension. Contact and controller state still govern jump
> eligibility; absent collision products now behave as open space. Historical findings below are
> retained as the implementation record.

## Context and Boundaries

### Goal

Add retail-compatible, charge-based jumping to grounded character movement while establishing one
reusable character-motion interpreter for the Explorer camera and the future playable client. The
result must support standing jumps, standing long jumps, walking and running jumps, backward jumps,
strafe and diagonal jumps, gait changes such as Shift-to-walk, retail airborne input behavior, and
retail static-contact plus sledding body response.

The controller interprets player commands. The world physics runtime remains the sole owner of body
velocity, contact, support, collision, and placement.

### Problem Statement

The current grounded camera accepts a frontend-computed world velocity each host tick. That is
adequate for continuous walking, but jumping exposes four missing contracts:

1. Input has history. The frontend must preserve ordered jump edges and the semantic movement state
   sampled at those edges; neither fact can be recovered from one periodic velocity snapshot.
2. Motion is compositional. Retail supports simultaneous forward/backward, sidestep, and turn state,
   while `MotionState` currently stores only one `Locomotion` value.
3. Launch is an impulse into persistent three-dimensional velocity. The grounded runtime currently
   stores vertical fall velocity separately and replaces horizontal velocity from drive intent on
   every tick.
4. Character capabilities and input policy have different owners. A shared controller must not know
   about keyboard keys, camera modes, skills, stamina, burden, protocol sequence fields, or Explorer
   presentation.

A monolithic stateful movement solver would combine these concerns and create a second authority
beside the collision runtime. The intended design is smaller: a deterministic character-motion
interpreter produces semantic intent, an actor-specific resolver turns a jump attempt into concrete
kinematics, and the generic physical-body runtime executes those kinematics.

### Ratified Decisions

1. Retail is the behavioral acceptance oracle, not the architecture blueprint.
2. The shared character controller is stateful because accepted charge state and standing-long-jump
   suppression are stateful. Raw held keys, key precedence, charge timing, and power-bar presentation
   remain frontend input policy.
3. The controller is not a physics solver. It observes contact, consumes semantic drive snapshots
   and ordered jump edges, and emits desired planar movement plus discrete jump attempts.
4. Jump variants are combinations of orthogonal state, not a closed `JumpKind` enum. Forward,
   backward, strafe, diagonal, walk, run, and Shift-modified jumps emerge from the active movement
   axes and gait. Standing long jump is retained as an explicit state because retail gives it
   distinct charging behavior and a wire-visible flag.
5. Physical keys and their arbitration remain frontend policy. In the Explorer, Shift maps to
   walking/precision gait in grounded mode and Space maps to jump press/release. Space and the mouse
   wheel retain their current physical-fly meanings outside grounded mode.
6. A Shift-held jump has less planar launch translation than the corresponding run jump because the
   launch samples the walk gait. This is an acceptance requirement, not a special Shift-jump branch.
7. The controller never reads skills, burden, stamina, character qualities, or server state. After
   it emits a `JumpAttempt`, an actor-specific consumer samples current capabilities and resource
   policy, then returns resolved launch kinematics or a typed rejection. Explorer's synthetic actor
   uses static app tuning; playable actors must resolve mutable facts at each attempt.
8. `SpatialBody.velocity` becomes the one authoritative full three-dimensional linear velocity.
   Grounded response state must not retain a competing vertical-velocity authority.
9. The host remains authoritative for physical camera motion and runs at the existing 30 Hz fixed
   cadence. The frontend queues ordered jump edges and attaches the contemporaneous semantic drive
   snapshot so a quick press/release cannot disappear or race a gait change between ticks.
10. Retail's local gravity-creature path does not apply translational air steering. It preserves the
    global planar launch velocity while airborne, admits turn commands, and adds only gravity. Turn
    input may change facing, while generic Sledding response may subsequently align facing back to
    velocity. Neither path changes planar velocity. This decision reopens only if a focused live
    trace proves another authoritative path changes velocity.
11. Retail static-contact and sledding response are required generic world-physics behavior, not a
    character-controller special case. Sledding is real body state with restitution, supported-
    acceleration, friction, and velocity-facing consumers. It must be modeled once in `holtburger-world`, inherited from
    authored/network physics state, and chosen explicitly for frontend-created bodies.
12. The cutover is clean. The old frontend-generated grounded world-velocity path does not survive
    beside the shared controller.
13. The frontend owns requested jump power and its power-bar clock. The actor adapter supplies a
    validated numeric movement/jump capability: Explorer registers product tuning for its synthetic
    actor, while a playable client must resolve authoritative character capabilities. Rust supplies
    the charge profile, validates the normalized extent, and remains authoritative over eligibility,
    resolved launch, resources, and physics.
14. Charge timing and launch capability are separate contracts with different lifetimes. A charge
    profile is selected when the gesture begins; release-time movement/jump kinematics are supplied
    anew for every `JumpAttempt` and are never cached by the interpreter or physical body.
15. This plan hardens the future playable-client seam but does not implement gameplay capability
    sourcing, resource policy, networking, prediction reconciliation, or local-player runtime
    migration. Those remain a separately approved follow-up.

### North Stars

- Input should feel immediate even though physical bodies solve at 30 Hz.
- Each semantic fact is derived once at its owning layer and crosses boundaries in a typed contract.
- Shared character behavior remains reusable without importing a browser, camera, or gameplay UI.
- Retail parity comes from small differential evidence, not architectural imitation.
- No body or launch is ever governed by two physical authorities.

### In Scope

- A deterministic shared character-motion interpreter in `holtburger-core`.
- Independent longitudinal, lateral, and turning semantic movement state.
- Frontend raw-input arbitration, requested jump-power timing, and an Explorer jump power bar.
- Semantic drive snapshots plus ordered jump begin, release, and cancellation commands.
- Retail-compatible standing-long-jump input suppression and release sampling.
- An actor-neutral jump-attempt contract and injected jump-kinematics resolution.
- Generic physical-body launch and airborne velocity integration in `holtburger-world`.
- Retail-compatible airborne facing with ballistic planar momentum.
- Retail-compatible static-contact restitution, friction, and sledding response for generic bodies.
- Explorer grounded-camera input and host-runtime integration.
- A compile-checked future-client contract proving release-time capabilities produce one resolved
  jump suitable for local physics and later packet construction without implementing that bridge.
- Synthetic differential tests and product-path Explorer acceptance.
- Documentation and deletion of superseded grounded-input and duplicate velocity mechanisms.

### Out of Scope

- A general animation state machine or animation-root-motion system.
- Skills, stamina, burden, encumbrance, or combat policy inside the character controller.
- Dynamic body-versus-body collision.
- Swimming, climbing, crouching, mantling, flight, or knockback control states.
- Server authority or protocol changes. Existing `JumpActionData` is the wire contract.
- Remote/server-spawned bodies running a local input controller. They consume authoritative motion;
  only locally controlled actors need the interpreter.
- A generic rigid-body impulse engine. This phase adds a typed character launch to the existing
  kinematic body runtime; broader impulses wait for another concrete consumer.
- Broader `AlignPath` path-following behavior beyond preserving its precedence over Sledding
  velocity-facing.
- Permanent tests that depend on untracked DAT assets.
- Real-player skill, stamina, burden, buff, equipment, PK, or resource-policy resolution.
- Live player jump commands, `JumpActionData` construction, server correction, or prediction
  reconciliation.
- Migrating the local player from `BasicSpatialPhysics` to the registered physical-body runtime.
- Placeholder gameplay adapters, fake player state, or unused provider/resolver traits.

## Ground Truth

### Behavioral Authorities

| Concern | Authority | Acceptance role |
| --- | --- | --- |
| Input interpretation and standing long jump | Retail `CMotionInterp` | Defines observable command ordering and suppression |
| Charge duration and release | Retail `ClientCombatSystem` | Defines extent timing and release behavior |
| Character movement rates | Retail motion interpretation plus resolved motion tables | Defines walk/run/back/strafe launch components |
| Character eligibility and jump strength | Retail behavior; ACE as a navigation aid | Defines the actor-specific resolver, not controller state |
| Collision, support, placement, and landing | Existing host physics recovery runtime | Remains the single physical authority |
| Static-contact and sledding response | Retail `CPhysicsObj::handle_all_collisions`, `calc_acceleration`, `calc_friction`, object update, and `set_elasticity` | Defines bounce gating, supported acceleration, friction, velocity-facing, coefficient bounds, and velocity response |
| Explorer key mapping and camera presentation | `apps/holtburger-3d` product policy | Maps keys to semantic commands and renders host motion |
| Jump wire encoding | `holtburger-protocol::JumpActionData` | Existing deterministic packet contract |

### Retail Findings Already Established

- `CMotionInterp::adjust_motion` in `acclient.c` near lines 330000-330063 converts backward and
  leftward forms into signed forward/right components, applies the backward factor, applies the
  sidestep factor, and then applies run hold state.
- `CMotionInterp::charge_jump` near lines 330102-330137 records `standing_longjump` only when the
  body is in walkable contact and has no forward, sidestep, or turn command.
- `CMotionInterp::DoInterpretedMotion` and `apply_interpreted_movement` near lines 330245-330419
  continue updating interpreted input while suppressing translational movement during a standing
  long-jump charge.
- `CMotionInterp::get_state_velocity` and `get_leave_ground_velocity`, clarified by
  `ACE/Source/ACE.Server/Physics/Animation/MotionInterp.cs`, compose independent sidestep and
  forward/run velocity, cap the combined vector at resolved maximum run speed, and replace its
  vertical component with resolved jump velocity on release.
- `CMotionInterp::LeaveGround` near lines 330680-330705 applies the local launch velocity, clears
  standing-long-jump and charge state, and reapplies current movement.
- `CMotionInterp::set_hold_run` near lines 330712-330718 reinterprets current movement when gait
  changes. The frontend's physical Shift key is therefore a mapping to semantic gait, not shared
  controller state.
- `ClientCombatSystem::StartPowerBarBuild`, `GetPowerBarLevel`, `CommenceJump`, and `DoJump` near
  lines 390367-390640 implement charge press/release. Normal charge duration is 1.0 second;
  `DualWieldCombat` (`0x80000046`) uses 0.8 seconds.
- Retail sends one jump action carrying extent and velocity. It does not encode a separate enum for
  walking, running, strafing, or Shift jumps.
- `ACE/Source/ACE.Server/Network/Motion/MoveToState.cs` carries `ContactLongJump` and
  `StandingLongJump`; `MovementData.cs` omits translational motion while the standing-long-jump flag
  is active.
- `CPhysicsObj::handle_all_collisions` near lines 309982-310045 reflects an incoming velocity's
  collision-normal component by `-(dot * (elasticity + 1))`, preserves its tangential component,
  and zeros velocity for the inelastic state.
- The same retail collision path suppresses bounce when the body was and remains on walkable support,
  except when physics-state bit `0x00800000` (`Sledding`) is set. Sledding also changes walkable-
  surface friction and aligns body facing to nonzero velocity when `AlignPath` does not supersede it.
- `CPhysicsObj::calc_acceleration` near lines 306180-306209 zeros acceleration and angular velocity
  for stable bodies with contact plus walkable support. Sledding bypasses that branch and therefore
  retains gravity while supported, which is a fourth generic response consumer.
- No local landing or slope transition found in the retail client toggles Sledding. The bit enters
  through the body's physics description or a later set-state message. Its visible effect begins on
  eligible contact, which can make persistent state look like a landing-triggered mode.
- `CPhysicsObj::set_elasticity` near lines 305519-305530 clamps elasticity to `[0.0, 0.1]`; retail
  constructors near lines 307850 and 318427 initialize it to approximately `0.05`.

### Current-Code Findings

- `crates/holtburger-core/src/client/movement_types.rs::MotionState` stores one optional
  `Locomotion`. It cannot represent forward plus strafe and must be replaced, not wrapped.
- `crates/holtburger-core/src/client/movement/system.rs` already owns queued player drive state,
  movement capability resolution, prediction, and packet emission. A new controller must integrate
  with this system instead of introducing a parallel player movement vocabulary.
- `crates/holtburger-world/src/state/self_movement.rs` already demonstrates the correct capability
  boundary: world state resolves numeric motion-table kinematics and run-rate facts.
- `crates/holtburger-world/src/spatial/physical_body.rs` has canonical `SpatialBody.velocity`, but
  `PhysicalBodyResponseState::Grounded` also stores `fall_velocity`. Jumping would make those two
  velocity authorities disagree.
- `crates/holtburger-world/src/spatial/physics.rs` and the registered physical-body runtime are two
  existing local-motion paths. Player integration cannot land until their responsibilities are
  mapped and either converged or explicitly separated without duplicate simulation.
- The Explorer sends continuous `worldVelocity` through
  `apps/holtburger-3d/src/explorer/physical-camera-session.ts`. A snapshot cannot faithfully carry
  a jump press and release that both occur between host ticks.
- `apps/holtburger-3d/src-tauri/src/host_camera_runtime/` owns the app-local camera adapter.
  Grounded character behavior moves out during the clean cutover; physical-fly acceleration
  remains app-local.
- `holtburger-protocol` already packs and unpacks `JumpActionData { extent, velocity, ... }`.

## Target Architecture

### Ownership

| Layer | Owns | Must not own |
| --- | --- | --- |
| Frontend input adapter | Physical keys, opposed-key arbitration, semantic drive snapshots, charge timing, requested extent, power bar, camera mode, focus/capture | Eligibility, jump strength, body velocity |
| `holtburger-core` character interpreter | Last accepted semantic drive intent, accepted charge state, standing-long-jump state | Raw held keys, charge clock, skills, protocol sequence fields, collision, placement, keyboard codes |
| Actor-specific resolver consumer | Release-time numeric movement/jump kinematics and body readiness; a future gameplay adapter owns their source and resource policy | Input history, collision integration, presentation, cached player stats |
| `holtburger-world` body runtime | Full velocity, contact, support, gravity, collision, surface response including sledding, placement, launch execution | Key bindings, skills, camera identity, wire packets |
| Core client movement bridge | Local prediction orchestration and existing jump packet construction | Re-deriving launch velocity |
| Frontend presentation | Jump power bar, camera projection, and interpolation of host motion paths | Physical placement authority |

The data flow is:

```text
physical key state and frontend clock
    -> semantic drive snapshots + ordered jump edges
    -> CharacterMotionInterpreter
    -> continuous planar intent + optional JumpAttempt
    -> actor-specific resolver
    -> resolved GroundedActuation / ResolvedJump
    -> authoritative SpatialBody solve
    -> placed motion path and resulting velocity
    -> frontend presentation
```

The player client later consumes the same `JumpAttempt` and `ResolvedJump`. Remote actors start at
the resolved-motion/body layers and do not pretend to have local input state.

### Contract Direction

Exact type names are settled in Phase 1, but the shape must preserve these distinctions:

```rust
struct CharacterDriveIntent {
    axes: MotionAxes,
    gait: Gait,
    control_heading: f32,
}

enum CharacterMotionCommand {
    SetDriveIntent(CharacterDriveIntent),
    BeginJump {
        drive: CharacterDriveIntent,
    },
    ReleaseJump {
        drive: CharacterDriveIntent,
        requested_extent: JumpExtent,
    },
    ClearInput,
}

struct JumpAttempt {
    extent: JumpExtent,
    standing_long_jump: bool,
    launch_motion: MotionAxes,
    gait: Gait,
}
```

`JumpExtent` is a finite normalized newtype. The frontend deliberately applies the charge profile's
minimum and maximum; Rust rejects malformed or out-of-range values instead of silently repairing an
invalid command.

`JumpAttempt` is deliberately unresolved. The caller supplies release-time
`CharacterJumpKinematics`; a pure resolver returns either one concrete launch result or a typed
rejection. That result is computed once and is the only velocity consumed by local physics and,
later, a real-player packet builder. `JumpChargeProfile` is not part of the release-time resolver
input: its duration was already consumed by the frontend gesture.

The controller receives a small observation snapshot containing the facts it cannot own: current
contact/support eligibility and current heading. It does not cache body pose or velocity.

### Input and Charge State

- The frontend maintains raw held keys and resolves them into independent longitudinal, lateral,
  and turn axes. Phase 0 determines opposed-key precedence rather than inferring it from ordinary
  browser behavior.
- Rust publishes the applicable `JumpChargeProfile`, including the full-charge duration and minimum
  extent. The frontend measures the gesture with a monotonic browser clock and renders the bar
  directly from that same value.
- `BeginJump` includes the contemporaneous drive snapshot and starts a charge only when the body
  observation permits it. The frontend may show the bar optimistically, but a typed rejection
  cancels it immediately. Future gameplay resource policy remains outside this plan.
- Starting a charge with no translation or turning records standing-long-jump state.
- While standing-long-jump state is active, new drive snapshots continue to update semantic intent
  but the emitted grounded planar intent is zero.
- `ReleaseJump` carries the frontend's requested extent and its contemporaneous drive snapshot.
  Rust validates and samples that extent, axes, heading, and gait exactly once. Therefore a Shift-held
  release naturally uses walk velocity and has less planar translation than a run release under
  otherwise equal conditions.
- A rejected release clears the charge. It must not become a deferred launch after contact or
  collision coverage later changes.
- Focus loss, camera-mode change, teleport, body replacement, and ownership handoff issue
  `ClearInput` and cancel any charge.

### Physical Velocity and Actuation

The body runtime needs two distinct command families:

- direct kinematic velocity for physical fly; and
- grounded character actuation containing desired planar movement, retained ballistic airborne
  momentum, and an optional one-shot resolved launch.

Invalid combinations should be type-impossible. A physical-fly body cannot accidentally receive a
grounded jump, and a grounded launch cannot be replayed on subsequent ticks.

On launch, the runtime atomically:

1. verifies current contact/support and collision coverage;
2. commits the resolved full three-dimensional velocity;
3. changes the response state to airborne;
4. advances collision and placement using that velocity; and
5. returns the resulting velocity and placed motion path.

Grounded direct actuation controls planar velocity while supported. Airborne actuation preserves the
body's existing planar momentum; forward, strafe, and gait input do not accelerate it. Collision
response may change that momentum, gravity changes vertical velocity, and turn input may still
change facing. Landing commits the collision-resolved velocity and support state; no independent
`fall_velocity` survives.

The generic body runtime also owns one composite physical-response policy: restitution, friction,
and stable-versus-sledding surface motion. For an eligible impact with a valid collision normal, it
applies the retail normal-component response to the canonical body velocity while preserving
tangential velocity. Inelastic response zeros velocity. Stable bodies that were and remain on
walkable support suppress restitution, preventing support correction from becoming a new impact on
every tick. Sledding bodies retain restitution and gravity on continuous support, use retail's
speed/slope-dependent friction path, and face along nonzero velocity unless the separate `AlignPath`
state wins.

Setup-backed adapters derive collider geometry, while entity-backed adapters derive response policy
from authored coefficients and the current physics-state bits. Later set-state messages update the same retained body policy;
Sledding is not inferred from a landing, slope, velocity, or camera mode. Explicit frontend-owned
bodies must choose the complete policy. Explorer physical fly and grounded walk remain stable:
retail constructors default to stable, ACE has no ordinary movement transition that enables
Sledding, and the checked local world/shard census contains no authored or persisted Sledding body.

Because Sledding and `AlignPath` may change through authoritative set-state messages, their resolved
values live in mutable `PhysicalBodyState`, not only in immutable geometry or response definitions.
Registration seeds one complete value; a typed state update replaces it without resetting pose,
velocity, support, coverage activity, or collider geometry. Collision, friction, and orientation
consume that retained value and never re-derive it from the body's motion.

### Discrete Event Transport

Replaceable drive snapshots and discrete jump actions have different delivery semantics. The
frontend owns one monotonic input sequence, may coalesce ordinary `SetDriveIntent` updates, and must
retain ordered `BeginJump`, `ReleaseJump`, and `ClearInput` events. Begin and release embed their
contemporaneous drive snapshots, so gait or direction cannot race the edge across asynchronous IPC.
The 30 Hz body tick drains accepted events in sequence before solving.

Required properties:

- a jump press and release between adjacent body ticks both arrive and execute in order;
- a drive or gait change immediately preceding release is represented by the release snapshot;
- repeated browser keydown events do not emit another `BeginJump`;
- stale or duplicate sequences are rejected observably;
- mode changes cannot leak a queued grounded jump into physical fly;
- event loss is not silently converted into a held or deferred action; and
- frontend charge tests use an injected browser clock and never sleep.

## Retail Differential Matrix

Phase 0 records compact traces for the following cases. Each case captures input order, initial
contact state, charge duration, local launch velocity, first airborne ticks, and landing outcome.

| Cohort | Minimum cases | Question answered |
| --- | --- | --- |
| Charge | tap, half, full, over-full | Extent clamp and timing |
| Standing | release stationary; press forward after charge starts | Vertical jump versus standing long jump |
| Gait | run-forward versus walk/Shift-forward at equal charge | Planar launch restriction |
| Direction | backward, strafe left/right, forward-strafe diagonals | Signed factors and combined-vector cap |
| Gait timing | Shift before charge, during charge, before release | Which gait launch samples |
| Opposed keys | forward/back and left/right press/release order | Axis precedence and resumption |
| Air input | no input, with/against launch, strafe, turn, gait change | Effective air-steering rule |
| Eligibility | airborne, non-walkable, constrained, missing coverage | Rejection and charge clearing |
| Collision | wall, low ceiling, slope, ledge, portal, landblock seam | Velocity/contact/placement integration |
| Restitution | normal and glancing impacts, default/max elasticity, inelastic response | Retail normal-velocity response |
| Landing | flat, sloped, and seam support over repeated ticks | Contact transition and continuous-support suppression |

Every production behavior copied from retail receives a minimal synthetic differential fixture. Real
content traces may establish the observation, but permanent tests must reduce it to checked-in
geometry and input data.

## Phased Implementation

### Phase 0: Retail Evidence and Minimal Differential Harness

#### Deliverables

- A documented behavior table for the differential matrix above.
- A small deterministic test oracle that can replay equivalent input/contact sequences through a
  reconstructed retail motion-interpreter slice.
- Exact citations for charge timing, axis composition, gait sampling, standing-long-jump
  suppression, and launch velocity.
- A measured description of air steering or an explicit finding that the apparent steering comes
  from another retail mechanism.
- An exact static-contact restitution oracle covering elastic, inelastic, and continuous-support
  branches.

#### Tasks

- [x] Trace retail command press/release and hold-key paths from input dispatch through
  `CMotionInterp` rather than inferring them from ACE alone.
- [x] Identify the motion style that uses the 0.8-second charge duration and census whether the
  Explorer/player standing style can observe it.
- [x] Prove opposed-key precedence and release behavior for all three movement axes.
- [x] Capture equal-charge run-forward and walk/Shift-forward launch velocities.
- [x] Capture backward, lateral, and diagonal launch vectors and confirm the combined speed cap.
- [x] Capture gait changes at each point of the charge lifecycle.
- [x] Trace and measure effective midair steering, including whether gait still influences it.
- [x] Reconstruct `handle_all_collisions` restitution over synthetic normals, incoming velocities,
  elasticity bounds, inelastic bodies, and prior/current walkable-support state.
- [x] Trace the retail sledding exception far enough to document its restitution gate without
  inventing a local landing transition.
- [x] Reduce each relevant observation to an asset-free differential fixture.
- [x] Record any deliberate retail quirk or divergence using the repository marker convention only
  if production code knowingly preserves or departs from a defect.

#### Acceptance

- No numeric air-control, charge, or launch constant remains justified only by feel.
- The Shift/walk restriction is represented as a gait-dependent velocity result.
- The harness distinguishes controller interpretation from collision outcomes.
- Restitution fixtures prove both the bounce response and the no-bounce continuous-support branch.
- All retained fixtures are deterministic and require no runtime DAT archive.

#### Decisions and Course Corrections

- Retail's apparent local air steering is facing change, not forward/strafe acceleration. Phase 5
  preserves global planar launch momentum, admits airborne turn/facing, and does not add an
  unobserved acceleration coefficient.
- The 0.8-second branch compares motion style `0x80000046`, which is `DualWieldCombat`. It is a live
  player stance selected for dual-wield combat, so charge profiles retain both evidence-backed
  durations. Explorer may still choose its own explicit profile.
- Sledding is physics-state bit `0x00800000`. It bypasses continuous-walkable-support bounce
  suppression and supported acceleration suppression, changes friction, and aligns facing to
  velocity. Subsequent review established that it has four named generic-physics consumers, so it is in scope for the body runtime rather than
  deferred as an unused character flag.

#### Phase 0 Evidence Record (2026-08-13)

The retained oracles are
`crates/holtburger-core/src/client/movement/character_motion_retail_differential.rs` and
`crates/holtburger-world/src/spatial/restitution_retail_differential.rs`. They compile only in unit
tests, depend on no DAT assets, and deliberately do not call current production movement or
collision code. Later phases compare production contracts against these independent reconstructions.

| Cohort | Retail result | Primary evidence | Permanent fixture |
| --- | --- | --- | --- |
| Charge | Power is elapsed time divided by 1.0 second, or 0.8 second in `DualWieldCombat`, clamped to `[0, 1]`; a valid tap releases at least `0.001` | `ClientCombatSystem::GetPowerBarLevel`, `GetJumpPowerLevel`, and `DoJump`, `acclient.c:390379-390640` | Normal/dual-wield tap, half, full, and over-full extent cases |
| Standing | A charge begun with no forward, sidestep, or turn marks standing-long-jump; later drive updates are retained but grounded translation stays suppressed until release | `CMotionInterp::charge_jump`, `DoInterpretedMotion`, and `apply_interpreted_movement`, `acclient.c:330102-330419` | Stationary release and forward/diagonal input added during charge |
| Gait | Explorer default-run policy is retail's physical hold-run XOR Toggle Run; the release-time gait determines planar launch | `CommandInterpreter::SetHoldRun`, `acclient.c:681483-681535`; `CMotionInterp::set_hold_run`, `acclient.c:330712-330718` | Equal-run-rate walk/run vectors and gait changes before/during release |
| Direction | Local X is sidestep and Y is forward. Walk is `3.1199999`, run is `4 * run_rate`, backward is scaled by `0.64999998`, sidestep by `0.5` with a maximum animation rate of `3`, and the combined vector is capped at `4 * run_rate` | `adjust_motion`, `apply_run_to_command`, and `get_state_velocity`, `acclient.c:329739-330063` | Backward, left/right strafe, and both-sign diagonal cases |
| Vertical launch | Actor qualities resolve burden/load modifier, jump skill, stamina effects, and scaling outside the interpreter. Height is floored at `0.35`; vertical speed is `sqrt(height * 19.6)` | `CACQualities::InqJumpVelocity`, `acclient.c:424347-424433`; `MovementSystem::GetJumpHeight`, `acclient.c:678672-678707` | Minimum-floor and skill-sensitive vertical velocity cases |
| Opposed keys | Forward, sidestep, and turn use independent newest-first command lists. Releasing the active command resumes the preceding held command; releasing a non-head does not change the active command; focus loss clears all three keyboard lists | `LoseKeyboardFocus`, `WhichList`, `AddCommand`, `NukeCommand`, `RemoveCommand`, and `CommandList::AddCommand`, `acclient.c:681378-683004` | Identical press/release/focus-loss tables over all three axes |
| Air input | Forward/strafe commands are recorded but rejected for motion without gravity-creature contact; turn commands remain allowed. Launch is transformed to global velocity once, airborne acceleration is gravity-only, and later body rotation does not rotate that stored global velocity | `contact_allows_move` and `LeaveGround`, `acclient.c:330141-330705`; `set_local_velocity`, `calc_acceleration`, and `UpdatePhysicsInternal`, `acclient.c:306094-306238,306907-306934` | Drive/strafe/gait changes leave planar velocity unchanged while turning remains admitted |
| Eligibility | Charge requires walkable contact and rejects forbidden substates; release also rejects fully constrained or airborne gravity creatures. Missing host collision coverage is a Holtburger suspension policy, not a retail differential | `charge_jump` and `jump_is_allowed`, `acclient.c:330102-330225` | Phase 1 state-machine and Phase 3 resolver rejection tables |
| Restitution | An incoming normal component is reflected by `-(dot * (elasticity + 1))`; tangent is preserved. Elasticity clamps to `[0, 0.1]` and defaults to `0.05`. Inelastic zeros all velocity; zero elasticity only removes incoming normal velocity | `set_elasticity`, `acclient.c:305519-305530`; `handle_all_collisions`, `acclient.c:309982-310068` | Normal/glancing, separating, missing-normal, default/zero/max, and inelastic cases |
| Support/landing | Prior and resulting walkable support suppress bounce for stable bodies. A stationary-fall count above one zeros velocity through a separate stabilization branch | `CTransition::validate_transition`, `acclient.c:300910-301020`; `handle_all_collisions`, `acclient.c:309982-310068` | Stable continuous support and stationary-stop cases |
| Sledding | Physics-state bit `0x00800000` retains gravity and bounce on continuous support, changes walkable friction, and aligns facing to nonzero velocity unless `AlignPath` wins. Ordinary ACE players are stable; authoritative state may still opt another body into Sledding | `calc_friction`, `acclient.c:304541-304619`; `calc_acceleration`, `acclient.c:306180-306209`; `handle_all_collisions`, `acclient.c:309982-310068`; `UpdateObjectInternal`, `acclient.c:310815-310900` | Stable/sledding acceleration, bounce, friction thresholds, and facing precedence fixtures |
| Collision integration | Portal, seam, wall, slope, ledge, and two-sphere geometry remain responsibilities of the existing host solver; Phase 0 contributes velocity-response oracles rather than a second geometry solver | Existing `grounded_retail_differential.rs` suite and the host-physics recovery plan | Phase 2 compares canonical resulting velocity; Phases 4-5 perform product-path acceptance |

`DualWieldCombat` is not a dead decompile branch: it is declared as `0x80000046` in both the local
protocol model and ACE, and ACE selects it for a dual-wield-equipped creature in
`ACE/Source/ACE.Server/WorldObjects/Creature_Combat.cs:275-313`.

No `RETAIL QUIRK` or `RETAIL DIVERGENCE` marker was added in Phase 0. These files record proven
behavior only and change no production compatibility policy.

### Phase 0 Follow-up: Sledding State and Surface-Response Evidence

#### Deliverables

- An authoritative provenance and content census for ordinary player Sledding state across creation,
  movement, launch, landing, and set-state paths.
- An exact sledding friction and velocity-facing oracle that resolves disagreement between the
  retail decompile and ACE's reconstructed friction condition.
- An evidence-backed Explorer grounded-body surface profile.

#### Tasks

- [x] Trace ordinary-player creation, movement, jump, fall, slope, and collision paths for writes to
  `0x00800000`; distinguish local collision effects from explicit body-state provenance.
- [x] Trace normal set-state producers to distinguish persistent authored state from a
  server-driven movement transition.
- [x] Trace initial player physics-description construction and census whether ordinary players,
  creatures, missiles, or authored objects carry Sledding by default.
- [x] Reconstruct retail `calc_friction` directly from `acclient.c:304541-304619`, including normal
  projection, speed thresholds, slope threshold, authored friction, and quantum exponentiation;
  do not copy ACE's differing branch without resolving it.
- [x] Reconstruct object-update facing precedence from `acclient.c` and prove that `AlignPath`
  supersedes Sledding velocity-facing.
- [x] Extend the asset-free world oracle with stable/sledding supported acceleration, friction,
  continuous-support bounce, zero-velocity facing, and `AlignPath` precedence cases.
- [x] Record whether Explorer grounded walk should start stable or sledding; keep this profile choice
  outside the generic body implementation.

#### Acceptance

- The plan names whether Sledding is persistent, server-transitioned, or both for ordinary players
  under the authoritative ACE server implementation.
- No slope, speed, friction, or facing constant is selected from the ACE reconstruction when the
  retail decompile disagrees.
- The follow-up specifies one generic body contract shape with four independently tested oracle
  behaviors; no controller or camera field duplicates it.
- Explorer's selected value is evidence-backed rather than inferred from the word “sledding.”

#### Decisions and Course Corrections

- Ordinary ACE players are neither persistently Sledding nor transitioned into it by normal
  movement. Retail constructors default to state `0x00400c08` (stable); `PhysicsDesc` and set-state
  remain the only generic inbound state paths. A server or explicit frontend body may still opt into
  Sledding, so the world contract retains it as mutable authoritative state.
- The retail decompile wins the friction disagreement: at speeds at or above 2.5 units/second,
  reduced `0.2` friction applies only when the surface normal is below `cos(10 degrees)`, meaning a
  slope steeper than ten degrees. ACE's near-flat `normal.z > 0.99999536` reconstruction is not used.
- Explorer grounded walk selects stable. This matches both retail's default body state and the ACE
  content/state census; selecting Sledding based on its name would add gravity, bounce, automatic
  facing, and slope friction that ordinary player bodies do not request.

#### Phase 0 Follow-up Evidence Record (2026-08-14)

- Retail `CPhysicsObj` and `PhysicsDesc` constructors initialize state `0x00400c08`, which includes
  report-collisions, gravity, lighting, and edge-slide but not Sledding. `set_description` replaces
  it from inbound `PhysicsDesc`; no local jump, landing, slope, or collision path enables Sledding.
- ACE `CalculatedPhysicsState` derives Sledding only from existing explicit physics state, and the
  normal movement/jump paths contain no Sledding setter. Generic `GameMessageSetState` can carry an
  externally requested change, preserving the need for a mutable runtime value.
- Read-only census of the local ACE world release found 43,871 weenies with `PropertyInt::PhysicsState`
  and zero with bit `0x00800000`. The shard contained 242 persisted physics-state rows and zero with
  the bit. This is distribution evidence, not a claim that no custom server can ever use Sledding.
- The expanded asset-free oracle passes 12 restitution/surface-response cases. It covers stable and
  sledding supported acceleration, continuous-support bounce, normal projection, slow stop,
  authored mid-speed friction, high-speed greater-than-ten-degree slope friction, quantum scaling,
  zero-velocity facing, and `AlignPath` precedence.
- Concession: no official-retail server capture exists in the workspace. Static client analysis can
  prove the client does not originate the transition, while ACE source plus content/shard census is
  the authoritative server-side lifecycle evidence available to this project.

### Phase 1: Composite Motion State and Shared Interpreter

#### Deliverables

- A focused public character-motion module in `holtburger-core`.
- One composite motion state with independent longitudinal, lateral, and turn axes.
- A deterministic accepted-charge state machine driven by semantic snapshots and jump edges.
- Validated `JumpExtent` and `JumpChargeProfile` contracts.
- A clean migration of existing manual movement and packet construction to the composite state.

#### Tasks

- [x] Replace `Locomotion` with orthogonal axis types; do not retain a compatibility wrapper.
- [x] Audit and migrate every `MotionState`, builder, `PlayerDriveIntent`, raw-motion encoder, and
  test consumer in the same change.
- [x] Define replaceable semantic drive snapshots and ordered begin/release/reset commands; do not
  reproduce raw held-key state in Rust.
- [x] Implement a finite, range-checked `JumpExtent` newtype and explicit charge-profile contract.
- [x] Implement `Idle` and `Charging` state with standing-at-start state but no charge clock.
- [x] Continue accepting drive snapshots while suppressing emitted translation for a
  standing-long-jump charge.
- [x] Emit one `JumpAttempt` from the release snapshot and validated requested extent; clear charge
  on release, reset, rejection, ownership loss, and mode transition.
- [x] Keep controller input and output free of key codes, camera fields, skills, resource costs,
  body shapes, protocol types, and world positions.
- [x] Add table-driven state-machine tests covering semantic snapshot and jump-edge ordering.
- [x] Update `crates/holtburger-core/ARCHITECTURE.md`; remove stale references to controller files
  that do not exist and document the module that actually lands.

#### Acceptance

- Forward plus strafe is representable throughout the core movement path.
- Equal semantic inputs and observations produce equal outputs without a clock.
- Jump press/release cannot be retriggered by key repeat or lost merely because one host tick did not
  occur between them.
- A standing charge followed by forward input emits zero pre-launch translation and a forward launch
  attempt on release.
- The shared module has no dependency on Explorer, Tauri, browser events, skills, or protocol packet
  sequence state.

#### Decisions and Course Corrections

- If the existing `PlayerDriveIntent` lifecycle cannot express discrete commands without ambiguous
  replacement semantics, introduce one explicit local-character command channel rather than
  overloading `ManualHeld`.
- Phase 1 keeps sequenced jump lifecycle edges in the focused `character_motion` module instead of
  overloading `PlayerDriveIntent::ManualHeld`. Existing manual and autonomous drive packet paths
  consume the new composite `MotionState`, while the Explorer adds the concrete edge queue in Phase
  4; the playable-client command bridge is retained only in the deferred follow-up record.
- Sequence ordering applies only to non-coalescible begin, release, and reset edges. Drive snapshots
  remain replaceable, and begin/release edges carry their contemporaneous snapshot so queue draining
  cannot pair an edge with a newer unrelated drive update.
- Charge acceptance checks only the controller-visible walkable-contact prerequisite. Release
  clears accepted charge and emits one actor-neutral attempt; the Phase 3 resolver remains the sole
  owner of actor eligibility and typed launch rejection.

#### Phase 1 Implementation Record (2026-08-14)

- `MotionState` now composes `LongitudinalMotion`, `LateralMotion`, `Turn`, and `Gait`. The old
  `Locomotion` enum and field were deleted, including direct CLI test fixtures; no compatibility
  wrapper survives.
- Raw motion encoding now emits forward and sidestep protocol axes together. Local prediction
  composes both planar components and applies the existing resolved maximum-run-speed cap once.
- `client::character_motion` now owns validated jump extent and charge-profile contracts, a
  clock-free `CharacterMotionController`, monotonically sequenced lifecycle edges, standing-charge
  translation suppression, and one-shot `JumpAttempt` emission.
- A zero-duration custom charge profile is rejected structurally instead of allowing division by
  zero to masquerade as a full charge.
- `cargo test -p holtburger-core --lib` passes 186 tests, `cargo test -p holtburger-cli --lib`
  passes 358 tests, and `cargo clippy --workspace --all-targets -- -D warnings` passes. These gates
  cover the controller, composite-axis encoder/prediction, migrated direct CLI fixtures, and every
  workspace compile target.

### Phase 2: Canonical Body Velocity and Typed Character Actuation

#### Deliverables

- One authoritative full linear velocity on `SpatialBody`.
- Typed physical-fly and grounded-character actuation contracts.
- An atomic one-shot grounded launch transition.
- Collision-resolved airborne and landing velocity behavior.
- Generic retail-compatible physical-body response, including restitution, friction, and
  sledding.

#### Tasks

- [x] List every guarantee currently provided by grounded `fall_velocity` before deleting it,
  including gravity accumulation, coverage holds, landing reset, and diagnostics.
- [x] Move those guarantees to `SpatialBody.velocity`, response state, or explicit solve results.
- [x] Delete grounded `fall_velocity` and sweep its vocabulary from code, tests, metrics, docs, and
  UI labels.
- [x] Replace the untyped grounded `desired_velocity` input with a contract that distinguishes
  supported planar drive, ballistic airborne momentum, and optional resolved launch.
- [x] Make launch consumption one-shot and atomic with contact transition.
- [x] Preserve full velocity while awaiting collision coverage; do not simulate or defer a launch
  through missing coverage.
- [x] Ensure wall, ceiling, slope, step, ledge, portal, and landblock collision responses return the
  velocity actually achieved.
- [x] Add one required composite physical-response policy containing bounded restitution, authored
  friction, and stable-versus-sledding motion; do not scatter interdependent contact fields or bury
  them in the character controller.
- [x] Represent elastic `[0.0, 0.1]` and inelastic restitution distinctly; zero elasticity must not
  mean inelastic.
- [x] Have setup-backed adapters derive geometry and entity-backed adapters derive initial response
  policy from authored coefficients and physics-state bit `0x00800000`; require explicit frontend
  body definitions to choose every policy field.
- [x] Retain mutable Sledding/`AlignPath` values inside that policy in `PhysicalBodyState`, seeded by
  registration and distinct from immutable collider geometry.
- [x] Provide the typed retained-policy update used by later authoritative set-state changes without
  rebuilding geometry, resetting velocity, or inventing a local landing-triggered transition. Phase
  6 owns live player-event routing into this update.
- [x] Configure physical fly as zero-elastic and stable. Configure grounded Explorer state from the
  Phase 0 follow-up rather than assuming it matches physical fly or an ordinary player.
- [x] Apply restitution only to an incoming valid collision-normal component and preserve tangential
  velocity according to the Phase 0 oracle.
- [x] Suppress restitution when prior and resulting states are both on walkable support for stable
  bodies; retain the Phase 0 bounce response for sledding bodies.
- [x] Suppress gravity and angular acceleration for stable contact plus walkable support; retain
  gravity for Sledding support so slopes can continue driving motion.
- [x] Implement the proved sledding friction and velocity-facing branches, including `AlignPath`
  precedence, as generic body response rather than grounded-controller behavior.
- [x] Preserve the independent stationary-fall stabilization branch: counts above one zero full
  velocity before ordinary restitution, without conflating that transition state with inelasticity.
- [x] Retain collision normal, prior support, and resulting support as transaction-local solve facts;
  do not add stale response-state fields solely to drive restitution.
- [x] Verify both one-sphere and two-sphere registered bodies; jump policy remains independent of
  collider count.
- [x] Verify response policy survives missing-coverage suspension, portal placement changes, and
  landblock eviction without being re-derived from motion outcomes.
- [x] Add invariant tests that would fail if response state and `SpatialBody.velocity` diverge.

#### Acceptance

- There is exactly one stored linear velocity for a registered body.
- Supported walking still matches the accepted pre-jump Explorer behavior.
- Launch creates airborne motion without bypassing collision, placement traversal, or coverage
  policy.
- A ceiling clips vertical launch, a wall clips planar motion, and landing returns to stable support
  without a trampoline cycle.
- Elastic normal and glancing impacts match the retail differential; inelastic impacts stop.
- Default and maximum elasticity behave exactly at the validated bounds.
- Stable continuous support suppresses gravity and bounce; sledding continuous support follows
  retail gravity, bounce, friction, and facing behavior for both collider counts.
- Authoritative Sledding state changes affect the next solve without resetting pose or velocity.
- Physical fly retains zero-elasticity wall sliding and is unchanged by the grounded actuation and
  restitution refactor.

#### Decisions and Course Corrections

- If converging the older `spatial::physics` local-player path is necessary to remove a second
  velocity authority, stop after documenting both call graphs and move the convergence gate before
  Explorer integration. Do not add adapters that simulate the same body twice.
- `SpatialBody.velocity` is the canonical post-response velocity used by the next tick.
  `achieved_velocity` remains a transaction-local displacement diagnostic; it is not another stored
  physical authority.
- Supported actuation distinguishes explicit controller drive from generic coasting. Stable driven
  bodies use the controller's complete planar target without generic friction retuning; stable
  coasting and Sledding apply authored retail friction to retained velocity.
- The public grounded-drive constructor remains horizontal. The lower-level supported-velocity
  contract accepts a full support-tangent vector because retail friction on a slope legitimately
  produces a vertical component. A synthetic ramp test guards this ownership boundary.
- A newly attached body in `ContactState::Unknown` may seed canonical planar velocity from its first
  drive while collision classifies support. Once collision commits `Airborne`, later drive cannot
  replace ballistic planar momentum. This preserves immediate Explorer startup without adding a
  camera flag or an unbounded airborne-steering exception.
- Collision response retains the strongest transaction-local unit normal opposing active motion,
  matching retail's one-normal response shape. It does not add a persistent contact manifold.
- Setup data owns motion-sphere geometry but does not contain current physics-state bits or mutable
  coefficients. Entity snapshots therefore seed response policy; a future playable-client plan may
  route subsequent authoritative player-state changes through the already-proven typed update.

#### Phase 2 Implementation Record (2026-08-14)

- The removed grounded vertical-velocity field provided four guarantees: gravity accumulated only
  during active ticks, missing coverage and finite-budget holds accumulated no hidden gravity,
  landing/support reset vertical fall state, and diagnostics exposed falling separately. Canonical
  `SpatialBody.velocity`, atomic held commits, committed support/contact, and explicit achieved-
  displacement diagnostics now provide those guarantees without a second velocity authority.
- `PhysicalBodyActuation` now distinguishes validated free-flight velocity from grounded supported
  motion and an optional non-cloneable `GroundedLaunch`. A launch requires current support, consumes
  by value, commits full velocity before collision, and is neither simulated nor deferred through
  absent coverage.
- `PhysicalBodyResponsePolicy` is one required mutable value containing distinct elastic/inelastic
  restitution, validated friction, Stable/Sledding surface motion, and `AlignPath`. Policy replacement
  preserves pose, velocity, support, placement memory, coverage activity, sampling state, and
  immutable collider geometry.
- Entity adapters use retail defaults for absent elasticity/friction and current authoritative
  `Inelastic`, `Sledding`, and `AlignPath` bits. Frontend-created body registrations must serialize
  the complete policy. Explorer physical fly selects zero elasticity plus Stable; grounded walk
  selects retail-default elasticity and friction plus Stable.
- Production response is checked against independent Phase 0 restitution and friction matrices.
  End-to-end registered-body fixtures cover default, maximum, zero-elastic, and inelastic impacts;
  stable and Sledding support; one- and two-sphere bodies; wall and ceiling clipping; slope-tangent
  motion; launch/airborne drive isolation; missing coverage; portal paths; and landblock seams.
- Verification: `cargo test -p holtburger-world --lib` passes 282 tests,
  `cargo test -p holtburger-core --lib` passes 188 tests, and
  `cargo test -p holtburger-3d --lib` passes 104 tests. Workspace Clippy passes with warnings denied;
  the Explorer TypeScript/Svelte checks and lint pass; the focused physical-camera session suite
  passes 14 tests.
- Concession: the host solver exports one response normal rather than a persistent contact manifold.
  This is sufficient for the evidenced retail response and avoids retaining stale geometry, but a
  future dynamic-body collision consumer may prove a different manifold contract.
- Phase 4 integration exposed one structural omission: ordinary grounded step-down was still being
  applied on the launch tick, snapping an upward body back to support. Retail gates that probe on
  retained contact state (`CTransition::transitional_insert`, `acclient.c:301550-301599`), and
  `LeaveGround` clears that state. `GroundedRequest` now carries the caller-owned `may_step_down`
  decision; launch and known-airborne ticks disable the walking probe, while initial contact
  classification may still use it. A pose-level differential proves this distinction.

### Phase 3: Actor-Specific Jump Resolution

#### Deliverables

- An actor-neutral resolver interface from `JumpAttempt` to `ResolvedJump` or typed rejection.
- Explicit, registration-time Explorer character capabilities.
- A world/client resolver path capable of using real player capabilities without exposing their
  source to the controller.

#### Tasks

- [x] Define resolved numeric inputs for base walk/run motion, run-rate scaling, backward and
  sidestep factors, combined speed cap, and vertical jump velocity.
- [x] Resolve the applicable `JumpChargeProfile` from retail motion style independently from the
  Explorer's explicit app-owned kinematics.
- [x] Reuse existing motion-table capability resolution instead of duplicating animation rates.
- [x] Compute planar launch once from independent axes, gait, heading, and caller-supplied
  kinematics.
- [x] Apply the retail backward/sidestep transformations and combined-vector cap proven in Phase 0.
- [x] Resolve vertical velocity from charge extent and actor capabilities outside the controller.
- [x] Return explicit body-readiness rejection reasons for airborne, unsupported, constrained, or
  missing coverage. A future real-player adapter may add missing-capability and resource-policy
  failures without expanding the controller contract.
- [x] Add app-owned Explorer capabilities with named constants and evidence comments.
- [x] Define only the numeric real-player adapter boundary for future `WorldState` resolution.
  Skill, stamina, burden, PK state, and resource effects remain deferred; do not make the Explorer
  or controller carry placeholder gameplay state.
- [x] Ensure the same `ResolvedJump` is suitable for both local physics and existing
  `JumpActionData.velocity` construction.

#### Acceptance

- At equal extent and direction, the Shift/walk launch has lower planar speed than the run launch.
- Standing, forward, backward, strafe, and diagonal attempts resolve without a variant explosion.
- No skill or resource concept appears in controller types or tests.
- Each derived launch fact is computed once and consumed rather than re-derived by physics or packet
  code.

#### Decisions and Course Corrections

- Explorer jump height is an explicit product capability, not a fake player skill. Its initial value is
  chosen from the Phase 0 representative retail trace and remains separately named from player
  capability resolution.
- Phase 3 implements the actor-neutral numeric resolver and Explorer kinematics only. The playable
  client is the first consumer that needs skills, stamina, burden, PK state, or resource effects, so
  authoritative `WorldState` extraction remains in the deferred playable-client follow-up rather
  than preloading those concerns into the controller or Explorer.

#### Phase 3 Implementation Record (2026-08-14)

- `client::character_kinematics` separates planar `CharacterMovementKinematics` from complete
  `CharacterJumpKinematics`, validates every numeric input, and resolves both continuous drive and
  one `ResolvedJump` through the same retail axis composition.
- The resolver applies backward/sidestep factors, run-rate scaling, the combined run-speed cap,
  release-time heading, the minimum-height floor, and vertical velocity exactly once. Its result
  retains both local velocity for `JumpActionData` and world velocity for local body launch.
- The numeric player adapter reuses `SelfMovementCapabilities` and stance-derived charge profiles.
  It deliberately accepts already-resolved jump height; no skill, stamina, burden, PK, or resource
  placeholder entered controller or Explorer state.
- Explorer initially owned an explicit `4.0` walk, `12.0` run, `1.0` run-rate, and `4.2125`
  full-charge-height profile in its app-local host. The Phase 4 calibration below moves those
  numeric facts into the synthetic body's frontend registration without changing the shared
  resolver boundary.
- The host start receipt publishes the selected charge duration once. The frontend uses that same
  value for both its frame-rate power bar and the normalized release extent.

### Phase 4: Explorer Grounded-Camera Cutover

#### Deliverables

- Grounded camera keys mapped to semantic drive snapshots and sequenced jump commands.
- A frontend-owned jump charge gesture and Explorer power bar.
- Host-owned interpreter, resolver, and body actuation at 30 Hz.
- Existing host placed-motion paths used for smooth rendering through jumps and portals.
- Deletion of frontend-computed grounded world velocity.

#### Tasks

- [x] Split input mapping by camera regime: Space begins/releases jump only in grounded walk and
  retains vertical movement in free/physical fly.
- [x] Map Shift to walk gait and unmodified grounded movement to run gait, matching current product
  policy and the new launch semantics.
- [x] Maintain the raw held-key set in TypeScript, reproduce the Phase 0 opposed-key precedence, and
  derive one simultaneous longitudinal/lateral/turn/gait snapshot.
- [x] Measure jump hold duration with `performance.now()` or an injected equivalent, apply the
  published charge profile, and render the Explorer power bar from the same requested extent.
- [x] Add a monotonic frontend sequence, coalescible drive snapshots, and an ordered queue for jump,
  reset, and mode-change edges.
- [x] Embed the contemporaneous drive snapshot in begin/release commands so gait and direction are
  coherent with the jump edge.
- [x] Return typed begin/release outcomes so an optimistic power bar can cancel immediately when
  Rust rejects the charge or launch.
- [x] Drain accepted events before each solve; do not add a host charge clock.
- [x] Instantiate the shared interpreter and explicit Explorer resolver in the app-local host
  adapter.
- [x] Register the grounded camera with the explicit response policy selected by the Phase 0
  sledding follow-up; keep that product choice out of controller commands and frontend key state.
- [x] Delete `resolveGroundedWalkVelocity` and grounded speed-envelope ownership from the frontend
  and camera-specific host controller once the new path is live.
- [x] Preserve physical-fly acceleration, vertical wheel impulses, and frontend free fly.
- [x] Route jump motion through the existing authoritative placed-path presentation buffer; add no
  frontend portal traversal or extrapolated placement authority.
- [x] Reset controller state on focus loss, free-fly recovery, body deregistration, teleport, and
  host ownership epoch change.

#### Acceptance

- Tap, half-charge, and full-charge jumps are responsive at 30 Hz.
- The power bar updates at frontend frame cadence and the released extent matches its displayed
  value independently of host tick cadence.
- Press and release within one tick produces exactly one launch.
- Standing, moving, strafing, diagonal, backward, and Shift/walk jumps match the Phase 0 matrix.
- Shift reduces planar jump travel without changing shared code based on a Shift key.
- Portal and landblock crossings during a jump do not flash, stall, or corrupt placement.
- Switching camera regimes cannot replay or strand a pending jump.
- Pre-jump grounded collision acceptance remains unchanged.
- Grounded-camera landing and slope behavior match the selected stable/sledding profile without a
  second app-local friction or bounce path.

#### Decisions and Course Corrections

- The frontend owns requested charge power and presentation only. Rust does not echo continuous
  charge telemetry; it returns discrete acceptance/rejection and launch outcomes.
- Discrete semantic outcomes ride the next authoritative placed-motion path rather than a separate
  synchronous command response. This bounds presentation correction to one 30 Hz tick and keeps
  readiness evaluation atomic with the solve.
- Registration is now a tagged mode-specific control contract. Grounded bodies cannot carry the
  physical-fly acceleration envelope, and the concrete velocity command is explicitly fly-only.
- Lifecycle events drain contiguously by sequence even when asynchronous IPC arrives out of order.
  If transport loses an edge, Explorer ends that physical-camera ownership epoch; it does not queue
  later events behind an impossible gap or synthesize the missing semantic action.

#### Phase 4 Implementation Record (2026-08-14)

- `grounded-character-input.ts` owns newest-first opposed-key arbitration for all three axes,
  Shift-to-walk mapping, key-repeat suppression, an injected monotonic charge clock, normalized
  displayed/released extent, and ordered begin/release/reset edges.
- The app-local host owns one `CharacterMotionController`, validates the Explorer's registered
  numeric kinematics, and retains one coalescible drive revision per grounded session. It drains contiguous lifecycle edges while
  holding the same simulation lock that samples body readiness and commits collision actuation.
- Press/release delivered in reverse IPC order launches once before the next solve. Additional host
  integration tests prove gap waiting, observable duplicate rejection, standing-charge drive
  suppression with release-time walk sampling, and missing-coverage rejection without deferred
  launch after coverage restoration.
- Grounded direct world velocity and its frontend resolver were deleted. Physical fly retains its
  concrete velocity, wheel displacement, and acceleration in a fly-only retained control variant.
- The existing placed-path buffer carries jump, portal, and placement transitions. The frontend
  performs no physical-mode portal traversal or position extrapolation.
- Automated checks cover the TypeScript adapter/session/controller path and the Rust host path.
  Maintainer live acceptance remains required before current-plan cleanup and closure.

#### Phase 4 Live Calibration (2026-08-14)

- Maintainer testing reports that grounded movement is close to retail feel. Two calibration nits
  remained before final acceptance: Shift keyboard turning was far too slow, and the synthetic
  Explorer body needed a taller product jump than the representative retail skill-300 trace.
- Retail does modify turn speed with run state: `CMotionInterp::apply_run_to_command` multiplies
  normalized turn command `0x6500000d` by `1.5`, while the non-run path leaves it at `1.0`
  (`acclient.c:329739-329778`, `:330006-330063`). Explorer had incorrectly reused its `0.05`
  free-fly precision multiplier for grounded yaw. Grounded Shift yaw now uses the retail `1/1.5`
  ratio; free/physical fly retain their existing precision policy.
- Explorer now registers two explicit sibling contracts: generic `body` geometry/response and a
  tagged `control` regime. The grounded-character control carries source-neutral numeric
  capabilities; no jump capability lives on the physical body. Rust validates and resolves those
  values but retains the retail-standard charge duration and normalized extent contract. This lets
  a frontend-created synthetic actor select its capability without allowing a future playable
  frontend to override authoritative player facts.
- The Explorer full-charge height is now an explicit frontend tuning value of `8.425`, exactly twice
  the prior `4.2125` apex. This is a deliberate Explorer product choice, not a retail-parity claim.
  Changing it does not alter the controller or wire contract.
- Follow-up calibration decomposed Explorer translation into the human motion-table bases (`3.12`
  walk and `4.0` run) plus an Explorer-selected `3.0` effective run-rate scalar. The accepted
  12-unit default run speed is unchanged, while backward, sidestep, diagonal, and jump-launch
  composition now inherit retail's actual scalar relationships.
- Grounded keyboard yaw now uses the human `1.5 rad/s` authored omega while walking and retail's
  fixed `1.5` Run multiplier (`2.25 rad/s`) while running. The shared local-player path applies that
  same animation-rate scalar to authored omega; its former `*_RAD_PER_SEC` scalar vocabulary was
  removed so packet and local-simulation semantics cannot silently diverge again.

### Phase 5: Airborne Facing, Restitution, and Landing Policy

#### Deliverables

- Ballistic planar momentum plus airborne facing behavior that reproduces the Phase 0 retail trace.
- Regression coverage for collision-altered momentum and landing stability.
- Product-path verification of the Phase 2 restitution implementation.

#### Tasks

- [x] Preserve global planar launch velocity while airborne except when collision response changes
  it; forward, strafe, and gait commands must not accelerate or replace it.
- [x] Keep airborne turn/facing input active without rotating already-global planar velocity.
- [x] Resolve commanded turn versus Sledding velocity-facing in the body update order proven by the
  Phase 0 follow-up; do not let the controller special-case the body flag.
- [x] If a live packet-and-velocity trace contradicts the local-client evidence, stop and identify
  the second authoritative path before adding any steering coefficient.
- [x] Test ballistic momentum into and away from walls, corners, steep slopes, ledges, portals, and
  ceilings.
- [x] Test that input and gait changes after launch do not alter planar momentum, independently from
  launch-time Shift behavior.
- [x] Compare flat and sloped landings with retail.
- [x] Verify normal and glancing wall, ceiling, flat-ground, slope, and polygon-seam impacts against
  the Phase 0 restitution oracle.
- [x] Verify default, zero, maximum, and inelastic body policies through the generic body runtime.
- [x] Verify stable and sledding landing with horizontal momentum, steep-slope descent, slope-bottom
  impact, supported-gravity retention, low-speed stop, and high-speed friction cohorts.
- [x] Stress continuous walkable support across repeated ticks and two-sphere contact arbitration so
  stable restitution cannot turn support correction into a trampoline and sledding damping matches
  the retail oracle.

#### Acceptance

- Airborne turn/facing remains responsive while forward, strafe, and gait input do not change
  ballistic planar momentum.
- Releasing input preserves ballistic momentum rather than snapping horizontal velocity to zero.
- Landing on a slope or polygon seam reaches a stable grounded state.
- Eligible impacts reproduce retail bounce; stable continuous support suppresses it, while sledding
  continuous support retains the proved damped response.
- Neither one- nor two-sphere stable bodies reproduce the mound trampoline regression.

#### Phase 5 Implementation Record (2026-08-14)

- `GroundedBodyActuation` now optionally carries one validated absolute control heading. The body
  applies it to pose orientation after collision placement without rotating canonical world
  velocity. Retail's later automatic-facing order remains explicit: Sledding velocity-facing
  overrides ordinary control, and `AlignPath` displacement-facing overrides Sledding.
- The host always supplies its current semantic control heading. An end-to-end launch test changes
  direction, gait, turn, and heading after takeoff: planar velocity remains byte-for-byte unchanged,
  gravity advances vertical velocity, and facing follows the new heading.
- Collision cohorts remain decomposed at their owning layers rather than duplicated in a jump-only
  geometry solver. Grounded fixtures cover walls, retreat, corners, steep slopes, ledges, ceilings,
  portals, polygon seams, and two-sphere arbitration; registered-body fixtures cover atomic launch,
  canonical collision response, placement paths, and missing coverage.
- The independent retail oracle still covers default/zero/maximum elasticity, inelastic stopping,
  glancing tangent preservation, stable continuous-support suppression, Sledding gravity/bounce,
  speed/slope friction thresholds, and facing precedence. Production comparisons remain green.
- A new 100-tick registered-body fixture proves both one- and two-sphere Stable bodies remain at an
  exact support fixed point with zero velocity. This specifically guards the prior mound trampoline
  class without encoding mound assets in a permanent test.
- No packet or velocity evidence contradicted Phase 0's no-planar-air-steering finding. Live
  Explorer acceptance is still required for feel, portal/landblock traversal, and real-content
  collision coverage.

### R1 Architecture Record: Deferred Shared Player Runtime

The investigation below records future-client constraints so they survive this plan, but no
local-player migration or networking work is required for current completion.

#### Review Findings (2026-08-14)

- `ClientSimulationSystem` currently builds one `SpatialSolveRequest` containing the local player
  plus nearby tracked actors. `BasicSpatialPhysics` directly projects their poses from velocity or
  desired deltas. It has no static collision scene, collision coverage, support transaction,
  gravity, portal traversal, restitution, or one-shot launch contract.
- The registered physical-body path advances the same `SpatialBody` representation through
  `SpatialScene::tick_physical_body`, with complete collision, placement, response policy, and
  coverage semantics. Explorer's `HostSimulationRuntime` currently owns a separate app-local
  `SpatialScene` plus `CollisionScene`; it is composition and interest orchestration around the
  shared world solver, not the future player's existing world instance.
- Leaving the local player on `BasicSpatialPhysics` would require a second approximate jump path or
  synchronizing it from the registered solver. Both violate the one-authority goal. The recommended
  decision is therefore to make a registered physical body in the player's existing world scene
  the sole local-player simulation path.
- Under that recommendation, `BasicSpatialPhysics` may remain only for non-local server-authoritative
  projection. A future playable-client plan would remove the local player from its solve batch; no
  body may be integrated by both paths. Collision-interest/content orchestration would need to move
  from the app adapter into a reusable composition that updates the player's existing world scene
  rather than cloning its body into the Explorer host scene.
- The controller and resolver contain no camera field. `ResolvedJump` already carries the one
  validated extent and standing-long-jump fact, local velocity for the existing jump wire payload,
  and world velocity for `GroundedLaunch`; neither consumer needs to reconstruct kinematics.
- No speculative controller command remains: replaceable drive, begin, release, and reset each have
  a current Explorer consumer and a named playable-client consumer. The new optional body control
  heading is generic actuation used independently from camera presentation and has explicit Stable,
  Sledding, and `AlignPath` behavior.

#### Recommended Future Course

If the registered-body recommendation is approved in a future playable-client plan, split that work
into two ordered slices:

1. Promote collision-interest composition and local registered-body ticking so `WorldState` retains
   the sole player body. Remove local-player integration from `BasicSpatialPhysics` before adding
   jump commands.
2. Wire semantic player input, authoritative numeric capability/resource resolution, one resolved
   jump, local `GroundedLaunch`, and `JumpActionData` construction through that selected body.

This is larger than merely adding a packet command, but it deletes the conflicting projection path
instead of cementing a migration shim that would become the real client's physics architecture.

#### Deferred Runtime Decision

- [ ] Decide in the future playable-client plan whether the registered physical-body runtime becomes
  the local player's collision and placement path.
- [ ] If not, document the non-overlapping ownership of `spatial::physics` and registered bodies and
  prove that only one integrates any given body.

#### Confirmed Current Constraints

- [x] Confirm the controller and resolver contracts need no camera-specific field or behavior.
- [x] Confirm the resolved jump result can be consumed unchanged by local simulation and packet
  construction.
- [x] Review state-machine complexity and delete speculative commands or fields without a named
  second consumer.

#### Current-Plan Exit Criteria

- The future constraints and recommended one-authority direction are retained without introducing
  a second local-player path or a migration shim now.
- The Explorer implementation is accepted in live use; a broader client bridge requires a new
  explicit approval.

### Phase 6: Future-Client Contract Hardening

#### Deliverables

- Separate charge-timing and release-time kinematics contracts.
- A resolver signature that accepts fresh `CharacterJumpKinematics` for each `JumpAttempt`.
- Executable proof that successive attempts may use different capabilities without recreating or
  mutating the controller.
- Architecture documentation that preserves the later player integration order without stubbing
  gameplay systems.

#### Tasks

- [x] Remove `JumpChargeProfile` from the release-time resolver input. Pass only validated
  `CharacterJumpKinematics`, `JumpAttempt`, heading, and current body readiness.
- [x] Keep any Explorer convenience composition app-local; shared types must not imply charge
  timing and mutable actor capability share a lifetime.
- [x] Ensure continuous drive resolution likewise accepts current `CharacterMovementKinematics`
  from its caller rather than consulting controller or body state.
- [x] Add a focused cohort that feeds two accepted attempts from one controller through different
  kinematics and proves the second launch changes without cached capability state.
- [x] Prove `ResolvedJump` retains one normalized extent, standing-long-jump fact, body-local
  velocity, and world velocity without re-derivation.
- [x] Document the deferred adapter order: sample authoritative actor state and resource policy,
  resolve once, then consume the same result for local launch and packet construction.
- [x] Do not add skills, resources, `WorldState` providers, packet commands, resolver traits, or
  placeholder rejection variants without a current production consumer.
- [x] Sweep `profile` vocabulary where it incorrectly combines charge timing with release-time
  capability; retain it only for genuinely composite app-local configuration.

#### Acceptance

- Neither `CharacterMotionController` nor `SpatialBody` stores jump capability.
- The resolver cannot access charge duration and receives capability explicitly per call.
- One controller instance produces different correct launch velocities when its caller supplies
  different release-time kinematics.
- Explorer behavior and its registered static capability remain unchanged apart from approved
  tuning.
- No new type names a skill, resource, packet, server, or player-state concept.

#### Decisions and Course Corrections

- Prefer changing the existing pure function signature over adding a resolver trait with no second
  production implementation.
- Do not model a resource transaction result until the playable-client adapter and protocol evidence
  establish its atomicity and failure semantics.

#### Phase 6 Implementation Record (2026-08-14)

- Deleted the shared `CharacterJumpProfile`. `JumpChargeProfile` now describes only gesture timing,
  while `resolve_character_jump` accepts `CharacterJumpKinematics` explicitly on every call.
- Renamed `CharacterJumpProfileError` to `CharacterKinematicsError`; surviving shared vocabulary no
  longer implies charge timing and launch capability share storage or lifetime.
- Explorer's tagged `grounded-character` control retains its static validated kinematics because the
  synthetic camera actor has no gameplay state. Neither `CharacterMotionController` nor
  `SpatialBody` stores those capabilities, and the generic body receives only resolved actuation.
- One focused test drives two complete charge/release cycles through the same controller, supplies
  different full-charge heights to the two resolver calls, and proves the second launch changes
  while normalized extent remains identical.
- Core architecture documentation now fixes the deferred integration order: sample mutable actor
  state and resource policy per accepted attempt, resolve once, then share that result between
  local launch and packet construction.
- No provider trait or placeholder gameplay/resource/wire type was added. This is deliberate debt
  deferral: the future adapter must establish resource atomicity and server-reconciliation semantics
  from live evidence rather than conforming to a speculative stub.
- Focused verification passes 9 character-jump tests, 28 host-camera tests, and Clippy with warnings
  denied for both `holtburger-core` and the 3D app host. The subsequent full-workspace and frontend
  results are recorded under Phase 7.

## Deferred Follow-Up: Playable-Client Movement and Jump Bridge

This is intentionally not an executable phase of the current plan. A future approved plan may use
the hardened contracts to:

- replace the old manual-held player locomotion path with the composite controller;
- sample authoritative skills, stamina, burden, buffs, equipment, and resource policy per attempt;
- construct `JumpActionData` and apply the same `ResolvedJump` to the selected prediction body;
- reconcile server correction without replaying charge or launch events;
- propagate authoritative Sledding/`AlignPath` changes; and
- migrate the local player onto one selected collision/placement runtime.

That plan must first resolve the deferred R1 body-runtime decision and verify the live protocol and
resource transaction boundary. It must not revive cached capability profiles or parallel body
simulation.

### Phase 7: Cleanup, Documentation, and Full Verification

#### Deliverables

- No duplicate grounded input, charge, velocity, or physical-body-response mechanism.
- Updated architecture and behavior documentation.
- Full automated and maintainer acceptance evidence.

#### Tasks

- [x] Delete superseded frontend grounded-velocity helpers, camera-only jump fields, compatibility
  adapters, dead enums, and obsolete tests.
- [x] Sweep renamed/deleted vocabulary through symbols, metrics, UI labels, plans, and docs.
- [x] Document the controller/resolver/physics ownership boundary in the relevant crate architecture
  files.
- [x] Document verified retail behavior and exact `acclient.c` citations.
- [x] Document physical-response policy resolution, zero-elastic versus inelastic semantics,
  sledding state provenance, friction, restitution, and velocity-facing precedence.
- [x] Add `RETAIL QUIRK` or `RETAIL DIVERGENCE` markers only for intentional, observable choices
  that satisfy the repository convention.
- [x] Run formatters, clippy with warnings denied, focused Rust tests, frontend tests, app-host tests,
  browser harness, and content harness.
- [x] Run the complete synthetic differential matrix.
- [x] Have the maintainer verify Explorer behavior in representative outdoor, indoor, portal,
  staircase, slope, ridge, ledge, and landblock-seam locations.
- [x] Record concessions and remaining evidence gaps in this plan.

#### Phase 7 Automated Verification Record (2026-08-14)

- Deleted and searched for the superseded grounded-speed resolver, combined jump-profile contract,
  cached resolver-profile vocabulary, and old grounded intent path. Surviving `worldVelocity` input
  is confined to physical-fly control; grounded launch receives the resolver's one computed world
  velocity.
- Updated core and world architecture documentation with the interpreter/resolver/body ownership
  boundary, release-time capability lifetime, static-contact policy composition, restitution,
  stable-support suppression, sledding, friction, and `AlignPath` precedence.
- The retail-marker census found no new intentional quirk or divergence. The implemented branches
  are compatibility behavior backed by the cited retail differentials, so adding a marker would
  misclassify them.
- `cargo fmt --all -- --check`, Prettier, `git diff --check`, workspace Clippy with warnings denied,
  and the complete Rust workspace test suite pass. The matrix includes 197 core tests, 284 world
  tests, and 109 app-host tests; the sandbox-sensitive scripting suite also passes.
- Svelte/TypeScript checks report no errors or warnings, all 1,070 frontend tests pass, ESLint,
  dead-code analysis, app-host Clippy, and the production build pass.
- The browser harness passes against its local content host. There is no separate content-harness
  command in this repository; the browser harness starts `dev_landblock_content_host` and exercises
  the content-backed render path, so that executable is the concrete browser/content gate intended
  by this plan.
- The production build still reports an existing 626 kB minified chunk and an ineffective Tauri
  dynamic-import warning. They are unrelated frontend bundling debt and do not alter the motion
  controller or its acceptance surface.
- Remaining evidence gap: automated fixtures cannot establish perceived camera feel or rule out
  content-specific regressions across the full representative-location list. Maintainer-calibrated
  Explorer acceptance remained required before this plan could be completed.
- The maintainer completed the calibrated Explorer pass on 2026-08-14 and accepted the resulting
  jump controls, movement feel, landing behavior, and previously established collision behavior.
  No product-path regression or follow-up correction was reported.

#### Acceptance

- Searches find one character input interpreter, one jump resolver per actor policy, and one stored
  body velocity.
- No old API can bypass the new grounded controller by submitting direct world velocity.
- All required checks pass with no ignored clippy warnings.
- Maintainer acceptance confirms controls feel responsive and collision behavior has not regressed.

## Testing Strategy

### Pure Controller Tests

- Range and non-finite validation for `JumpExtent`.
- Table-driven semantic snapshot and jump-edge ordering.
- Standing-long-jump suppression and release sampling.
- Duplicate sequence, stale sequence, reset, and mode-change behavior.
- No physics geometry or runtime assets.

### Frontend Input Tests

- Raw-key arbitration and opposed-key precedence for all axes.
- Shift-to-walk mapping and camera-mode-specific Space behavior.
- Injected-clock tap, half-charge, full-charge, and over-full charge calculation.
- Power-bar display value equals the released requested extent.
- Key-repeat suppression, focus loss, optimistic rejection, and input-epoch reset.

### Resolver Differential Tests

- Exact launch vectors for walk, run, backward, strafe, and diagonal cohorts.
- Equal-charge Shift/walk versus run comparison.
- Capability and eligibility rejection paths.
- One assertion per behavior-bearing retail branch.

### Physical-Body Tests

- Flat launch, gravity arc, ceiling clip, wall slide, slope landing, and stable support.
- Default/max/zero elasticity, inelastic response, normal/glancing impacts, stable continuous-
  support suppression, and sledding continuous-support bounce.
- Sledding friction speed/slope thresholds, low-speed stopping, velocity-facing, `AlignPath`
  precedence, and authoritative state changes.
- One- and two-sphere bodies.
- Portal transit, adjacent EnvCells, outdoor transition, landblock seam, and missing coverage.
- Collision-resolved resulting velocity and no repeated impulse.

### Integration Tests

- Browser drive snapshots and jump queue to the host interpreter.
- Host event ordering at 30 Hz with press/release inside one tick.
- Release snapshot coherence when gait or direction changes immediately before key-up.
- Mode and ownership handoff clearing.
- Authoritative Sledding/`AlignPath` updates retain pose, velocity, support, and collision coverage.
- Placed motion path playback without frontend placement inference.
- Successive attempts using different caller-supplied capability snapshots.

### Live Acceptance

- Verify tap, charged, standing-long, run, Shift/walk, backward, strafe, and diagonal jumps.
- Verify airborne turning with and against initial momentum without translational acceleration.
- Verify default-elastic bounce on eligible impacts, zero-elastic sliding, inelastic stopping, and
  stable no-bounce continuous walkable support.
- Verify retail-player and Explorer body-policy sledding landing, horizontal-momentum, steep-slope, and
  slope-bottom behavior.
- Verify portals, thin EnvCells, landblock seams, stairs, ramps, ridges, ledges, walls, and ceilings.
- Verify no portal flash, seam stall, invisible wall, edge wedge, or grounded trampoline regression.

## Risks and Mitigations

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Treating Shift as shared semantics | Controller becomes keyboard- and app-specific | Map Shift to `Gait::Walk` only in the frontend |
| Modeling named jump variants | Combinatorial enum and contradictory state | Compose axes, gait, charge, and one standing-long-jump flag |
| Losing fast jump edges at 30 Hz | Unresponsive or missing jumps | Frontend-owned ordered edge queue with release snapshots |
| Malformed frontend extent | NaN, excess launch, or hidden correction | Finite range-checked Rust newtype; reject rather than silently clamp |
| Optimistic power bar is rejected | UI briefly shows an unavailable charge | Typed begin/release outcome cancels presentation immediately |
| Two stored velocity authorities | Snaps, stalls, or repeated vertical impulses | Clean cutover to `SpatialBody.velocity` |
| Two local-player physics paths | Divergent collision and prediction | R1 convergence gate before player integration |
| Mistaking facing change for air steering | Tuned-but-wrong trajectory control | Preserve the Phase 0 no-planar-acceleration result; reopen only on a contradictory velocity trace |
| Reusing fake player skills for camera | Hidden presentation-to-gameplay leak | Explicit app-owned Explorer character capabilities |
| Re-deriving launch for packets | Local prediction differs from sent action | One `ResolvedJump` consumed by both |
| Restitution reintroduces support oscillation | Grounded trampoline regression | Exact retail support gate plus repeated-tick one/two-sphere differentials |
| Zero elasticity is conflated with inelastic state | Physical fly stops instead of wall-sliding | Separate policy variants and explicit differential tests |
| Sledding is inferred from collision outcomes | Hidden state machine diverges from authored/server state | Store the explicit body bit; update it only from body construction or authoritative state changes |
| ACE's sledding friction reconstruction is copied as retail truth | Wrong slope threshold and landing feel | Use the resolved retail branch: high-speed reduced friction only below `cos(10 degrees)` normal Z |
| Sledding velocity-facing fights character turn input | Camera or player heading snaps unexpectedly | Preserve retail update ordering and choose the Explorer body policy from evidence, not convenience |
| Mode-switch input leakage | Jump fires in fly mode or on return | Epoch-bound events and mandatory `ClearInput` |
| Broad controller scope | Stateful god object | Interpreter owns only the accepted drive snapshot and charge transitions |
| Caching a composite player profile | Buff/stat changes use stale launch capability | Separate charge timing from per-attempt kinematics and prove successive attempts can differ |
| Speculative Phase 6 stubs | Placeholder interfaces constrain the real client before evidence exists | Harden only consumed signatures and executable invariants; defer gameplay adapters |

## Definition of Done

- Retail-observable jump input behavior is captured in minimal differential fixtures.
- The shared motion state represents simultaneous longitudinal, lateral, and turning input.
- The controller is stateful, deterministic, clock-agnostic, key-agnostic, actor-capability-agnostic,
  and physics-agnostic.
- The frontend owns raw-key arbitration, requested charge timing, and the power bar; displayed and
  released extent agree without a continuous host telemetry loop.
- Shift/walk lowers planar jump translation relative to run without a Shift-specific shared branch.
- Standing, walking, running, backward, strafe, and diagonal jumps work through one compositional
  path.
- The body runtime owns one full velocity and executes launch, gravity, collision, support,
  placement, and landing atomically.
- Generic static-contact restitution matches retail's elastic, inelastic, coefficient-bound, and
  continuous-walkable-support behavior.
- Generic Sledding state matches retail supported gravity, continuous-support bounce, friction,
  velocity-facing, and authoritative state-update behavior without leaking into the controller.
- Airborne facing and ballistic planar momentum match measured retail behavior.
- Explorer grounded walk uses the host controller at 30 Hz without dropped edges, portal flashes,
  seam stalls, or regressions in accepted collision behavior.
- The future playable client has a compile-checked release-time capability seam and a documented
  one-resolution integration order without importing Explorer policy or duplicating simulation.
- Superseded mechanisms and vocabulary are deleted, documentation is current, all automated checks
  pass, and maintainer live acceptance is recorded.

## Open Questions

No open decision blocks the current plan. The local-player runtime selection, gameplay capability
source, resource transaction, packet bridge, and reconciliation policy are explicitly deferred to a
separately approved playable-client plan.
