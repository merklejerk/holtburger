# Holtburger 3D Client Strafe and Jump Controls Plan

## Context and Boundaries

### Goal

Add retail-correct strafe and charged jump controls to `holtburger-3d` client mode, including
authoritative Jump-skill and burden scaling, release-time planar launch velocity, a retail-style
jump power bar, one committed local launch, one retail-shaped `0xF61B` jump packet, and
retail-correct support-driven jump presentation for local and remote players, remote launch
projection, handling of server-controlled motion received during the resulting airborne state,
and an entity-generic authored-motion path that presents server-directed locomotion, stance
changes, and one-shot actions for players and creatures through the same runtime and solver.

### In Scope

- Add left/right strafe input to client mode using the existing semantic lateral axis.
- Route replaceable manual drive and ordered jump lifecycle edges through the shared character
  motion controller.
- Preserve retail's standing-long-jump charge behavior and airborne planar-input gate.
- Resolve jump capability from current player motion-table kinematics, Run rate, Jump skill,
  burden, stamina state, stance, heading, body support, and requested extent.
- Apply release-time forward, backward, strafe, walk/run, and diagonal motion to jump launch.
- Commit one world-space `GroundedLaunch` and serialize the same resolved local-space velocity.
- Correct `JumpActionData` to retail's position-bearing `JumpPack` layout.
- Add a client-local jump power bar with retail timing, visibility, completion, and rejection
  behavior.
- Project only renderer-consumed jump timing and lifecycle feedback through the client host.
- Verify the packet codec against retail and GDLE source evidence and verify interoperability
  against the local ACE server at `127.0.0.1:9000` using `.dev.env` credentials.
- Align non-autonomous MoveTo/TurnTo receipt with retail while airborne: transfer control and allow
  heading immediately, preserve ballistic velocity, defer translation and progress/completion
  accounting until grounded, then resume the retained command on landing.
- Select `Ready` during a supported standing charge, `Falling` during launch and unsupported
  travel, and the current interpreted grounded movement after landing from the same support facts
  that govern physics.
- Admit an authoritative remote jump vector as a launch for a grounded-response body instead of
  discarding it at remote actuation, while preserving ordinary authored locomotion and generic
  vector projection outside that transition.
- Replace the ambiguous optional remote motion snapshot with retained per-entity motion authority:
  omitted wire fields retain stance but explicitly stop omitted motion channels, movement
  timestamps admit only fresh state, and both remote network state and local control resolve into
  the same support-aware `MotionOrder`, motion runtime, and physical solver.
- Verify local and observer-visible jump clips explicitly; pose continuity is not animation
  evidence.
- Retain enough typed MoveTo/TurnTo state to resolve retail's walk/run/turn commands from the
  current body, target, and movement parameters instead of moving the body while bypassing authored
  motion.
- Expand every retail interpreted command index losslessly and admit transient command-list and
  ACE forward-channel actions without confusing an action edge with retained locomotion state.
- Route player and creature directives, retained movement, and admitted actions through the same
  motion-table selector, sequence runtime, authored-root projection, and physical solver.
- Resolve the effective motion table once, including setup fallback, and project that same table ID
  to playback and rendering consumers.

### Out of Scope

- Air steering. Retail retains committed planar launch velocity while airborne; only facing can
  continue changing.
- A server-family-specific jump packet variant. `holtburger-protocol` models the retail wire
  contract once.
- Trusting renderer-provided skill values, burden, contact, position, or launch velocity.
- Reworking autonomous navigation, TUI navigation policy, server path selection, combat gameplay,
  or the broader power-bar system. This plan presents the authored locomotion/action chosen by an
  already-received server directive; it does not choose AI paths, targets, damage, or attack power.
- Predicting or locally deducting jump stamina before evidence proves a distinct client-owned
  resource transaction is required. The server remains authoritative for vital updates.
- Pixel-identical retail power-bar artwork or placement. The bar uses the existing client visual
  language; only its gesture, timing, fill, accessibility, and lifecycle are compatibility
  requirements.
- Adding Explorer-specific policy to shared client orchestration. Explorer remains a reference
  consumer of shared character-motion and grounded-launch primitives.
- Building a mutable god-object `EntityController` or merging networking, motion-table selection,
  collision, and rendering into one service. The realignment is a typed state reducer plus shared
  resolution pipeline; existing authority layers remain separate.
- Implementing action gameplay, animation hooks, sounds, particles, equipment swaps, targeting,
  attack charging, or UI for combat actions. This extension executes the authored motion sequence
  and its lifecycle only; hook semantics remain separately scoped unless an existing playback
  consumer already owns them.

## Ground Truth

### Retail Client References

- `acclient-eor-source/acclient.c:390471-390525`,
  `ClientCombatSystem::CommenceJump`:
  - asks `CMotionInterp::charge_jump` to validate the charge;
  - begins `PBM_JUMP`, sets level zero, and starts the charge clock only after acceptance.
- `acclient-eor-source/acclient.c:390379-390409`,
  `ClientCombatSystem::GetPowerBarLevel`:
  - standard charge duration is `1.0` second;
  - `DualWieldCombat` charge duration is `0.8` second;
  - displayed level clamps to `[0, 1]`.
- `acclient-eor-source/acclient.c:390526-390545`,
  `ClientCombatSystem::GetJumpPowerLevel`: a valid release clamps to a minimum extent of `0.001`.
- `acclient-eor-source/acclient.c:389995-390105`,
  `ClientCombatSystem::SetPowerBarLevel`, `HidePowerBar`, and `FinishJump`:
  - the active jump bar receives continuously sampled power levels;
  - finishing a jump sends the finish notice, clears the clock and mode, clears
    `standing_longjump`, and retires `jump_pending`.
- `acclient-eor-source/acclient.c:390559-390616`, `ClientCombatSystem::DoJump`:
  - release calls `CMotionInterp::jump` locally first;
  - the client then reads local physics velocity and constructs `JumpPack` from the requested
    extent, local velocity, current position, and four movement timestamps;
  - the same locally established launch therefore supplies the packet velocity.
- `acclient-eor-source/acclient.c:330078-330128`,
  `CMotionInterp::get_leave_ground_velocity`:
  - X/Y come from release-time interpreted motion state;
  - Z comes from the actor-specific jump query;
  - the vector is body-local before physics transforms it.
- `acclient-eor-source/acclient.c:329739-330063`, `apply_run_to_command`,
  `get_state_velocity`, and `adjust_motion`:
  - run-forward, run-held backward, sidestep, diagonal cap, and fixed run-turn rules used by jump
    planar launch.
- `acclient-eor-source/acclient.c:330129-330216`, `charge_jump` and
  `contact_allows_move`:
  - a charge that begins completely stationary marks `standing_longjump`;
  - standing charge suppresses grounded translation;
  - unsupported planar movement is gated while turn motion remains accepted.
- `acclient-eor-source/acclient.c:423429-423468`, `CACQualities::CanJump` and
  `JumpStaminaCost`: burden must be below `2.0` to begin a jump; stamina cost is derived from extent,
  burden, and recent PK activity.
- `acclient-eor-source/acclient.c:424375-424439`, `CACQualities::InqJumpVelocity`:
  current Jump skill, enchantments, augmentations, burden, and exhaustion determine vertical
  launch; exhausted characters use zero Jump skill.
- `acclient-eor-source/acclient.c:678672-678707`, `MovementSystem::GetJumpHeight`:

  ```text
  power = clamp(power, 0, 1)
  height = LoadMod(burden)
         * (jump_skill / (jump_skill + 1300) * 22.2 + 0.05)
         * power
         / scaling
  height = max(height, 0.35)
  vertical_velocity = sqrt(height * 19.6)
  ```

  The player path supplies scaling `1.0`.

- `acclient-eor-source/acclient.c:312043-312124`, `JumpPack::JumpPack` and `JumpPack::Pack`:
  `0xF61B` carries extent, local velocity, full `Position`, four `u16` movement timestamps, then
  four-byte alignment.
- `acclient-eor-source/acclient.c:137324-137338`, `SmartBox::DoVectorUpdate`:
  - accepts only a newer vector timestamp;
  - records that timestamp for every object;
  - does not apply the server velocity or omega to the local player when
    `CommandInterpreter::UsePositionFromServer` is false.
- `acclient-eor-source/acclient.c:138934-139048`, `SmartBox::HandleReceivedPosition`:
  - an ordinary fresh position update for the locally autonomous player does not copy the packet
    velocity and does not move/interpolate the body;
  - a newer force-position sequence blips the player and reapplies current movement;
  - a newer teleport sequence teleports the player and clears velocity;
  - packet velocity is passed to `MoveOrTeleport` only for non-player objects.
- `acclient-eor-source/acclient.c:682017-682019`,
  `CommandInterpreter::UsePositionFromServer`, and `acclient-eor-source/acclient.c:682226-682249`,
  its constructor: the normal client autonomy level is `2`, and server position/vector authority
  is enabled only when the autonomy level is not `2`.

### Retail Server-Controlled Motion During Airborne State

- `acclient-eor-source/acclient.c:299898-299958`, `CPhysics::SetObjectMovement`:
  - a fresh non-autonomous movement update advances movement/server-control timestamps;
  - marks the movement non-autonomous and unpacks it into the local physics object's movement
    manager rather than treating it as a position/vector sample.
- `acclient-eor-source/acclient.c:375642-375704`, retail movement-event dispatch:
  - a successfully admitted non-autonomous player movement transfers command control to the server.
- `acclient-eor-source/acclient.c:325745-325775` and `325998-326116`,
  `MovementManager::PerformMovement` and `unpack_movement`:
  - MoveTo/TurnTo commands use `MoveToManager`, independently from ordinary interpreted input and
    independently from `SmartBox` position/vector reconciliation.
- `acclient-eor-source/acclient.c:331901-331964`, `MoveToManager::MoveToPosition`, and
  `331327-331381`, `MoveToManager::MoveToObject`:
  - receipt stops current interpreted locomotion, captures the command, and installs ordered
    turn/translation nodes immediately.
- `acclient-eor-source/acclient.c:329908-329939`, `CMotionInterp::StopCompletely`, and
  `304242-304249`, `CPhysicsObj::StopCompletely_Internal`:
  - stopping interpreted locomotion resets motion-table commands/animations only;
  - it does not write `m_velocityVector`, so the already committed ballistic vector survives.
- `acclient-eor-source/acclient.c:330141-330280`, `contact_allows_move` and
  `DoInterpretedMotion`:
  - turn commands remain executable without walkable contact;
  - contact-blocked forward commands are retained in interpreted state without being applied to
    the physics object.
- `acclient-eor-source/acclient.c:325850-325887`, `MovementManager::UseTime`:
  - a pending MoveTo does not run progress/completion handling without a contact plane, so an
    airborne trajectory cannot complete or fail the command by crossing or missing its target.
- `acclient-eor-source/acclient.c:325889-325904`, `MovementManager::HitGround`, and
  `330655-330677`, `CMotionInterp::HitGround`:
  - landing reapplies current interpreted movement and restarts the pending MoveTo node.

The retail consequence is one composite rule: server command ownership and heading begin
immediately, while translational execution and distance-based progress wait for grounded support.
Neither receipt nor airborne waiting replaces the jump's retained physical velocity.

### Alternate Server-Family Evidence

GDLE source revision [`542a209d89e13d6fbb5df3f3e77fd72d10a4b647`](https://github.com/esoterick/gdle-linux/commit/542a209d89e13d6fbb5df3f3e77fd72d10a4b647)
independently confirms the retail packet prefix in `Source/ClientEvents.cpp:3930-3940`:

```cpp
float extent = pReader->Read<float>();
Vector jumpVelocity;
jumpVelocity.UnPack(pReader);
Position position;
position.UnPack(pReader);
```

GDLE uses the supplied position for a distance/transition check and applies the supplied local
velocity. It does not consume the trailing retail movement timestamps, so their existence remains
grounded by the retail packer rather than GDLE.

### ACE Divergence and Compatibility Explanation

- `ACE/Source/ACE.Server/Network/Structure/JumpPack.cs` reads extent, velocity, then four `u16`
  timestamps, omitting `Position`.
- `ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionJump.cs` then reads an object GUID and
  spell ID that retail's `CM_Movement::Event_Jump` never writes.
- `git blame` and history show this shape entered in ACE commit
  `509a385f8c20bd8575192af34a44a9691e232374` on 2018-07-28 and has not been corrected.
- `InboundMessageManager.HandleGameAction` invokes the handler without requiring full payload
  consumption.
- When ACE receives a retail packet, it still reads the correct extent and velocity. It mistakes
  the first 16 bytes of `Position` for timestamps/object/spell values, ignores those values, leaves
  the remaining 24 bytes unread, and calls `HandleActionJump` using only extent and velocity.

This explains why retail clients interoperate with ACE despite ACE's incorrect parser. Holtburger
must emit retail, not preserve the parser defect.

### Current Holtburger Packet Evidence

- `crates/holtburger-protocol/src/messages/movement/actions.rs::JumpActionData` currently matches
  ACE's abbreviated 32-byte action body: extent, velocity, four sequences, object GUID, and spell
  ID.
- Its synthetic fixture has no retail or capture provenance.
- `object_guid` and `spell_id` have no Holtburger runtime consumer outside this codec fixture.
- `WorldPosition` already packs as the exact 32-byte retail `Position` payload: cell ID, XYZ origin,
  and WXYZ quaternion. No second position codec is deserved.

Excluding the outer GameAction sequence and `0xF61B` opcode, the evidence-backed layout is:

| Field                                                      |           Bytes | Source                        |
| ---------------------------------------------------------- | --------------: | ----------------------------- |
| extent                                                     |               4 | retail, GDLE                  |
| local velocity                                             |              12 | retail, GDLE, ACE             |
| position                                                   |              32 | retail, GDLE                  |
| instance/server-control/teleport/force-position timestamps |               8 | retail                        |
| alignment                                                  | already aligned | retail                        |
| **Total action body**                                      |          **56** | derived from the fields above |

### Existing Production Patterns

- `apps/holtburger-3d/src/lib/game/controls/character-input-controller.ts` already owns raw-key
  arbitration, Z/C lateral semantics, Space edges, an injectable monotonic clock, current charge
  extent, and retail's minimum extent.
- `crates/holtburger-core/src/client/character_motion.rs` already owns the clock-free shared
  controller, ordered edges, charge phase, standing-long-jump sampling, and release-time
  `JumpAttempt`.
- `crates/holtburger-core/src/client/character_axes.rs` is the single retail-adjustment owner for
  forward, backward, sidestep, turn, diagonal cap, and local planar launch velocity.
- `crates/holtburger-core/src/client/character_jump.rs` already resolves one `ResolvedJump` with
  local and world velocity. Its existing differential tests cover retail planar and vertical math.
- `crates/holtburger-world/src/context.rs` already owns burden, `burden_load_modifier`, current
  player skill lookup, encumbrance capacity, and Run-rate derivation.
- `crates/holtburger-world/src/state/self_movement.rs` already resolves authoritative player
  motion-table base walk/run kinematics and current Run rate.
- `apps/holtburger-3d/host/src/explorer_possession_control.rs` and
  `explorer_entity_runtime.rs` prove shared controller-to-`GroundedLaunch` integration, but their
  fixed Explorer capability profile is not a playable-player adapter. Explorer also proves the
  target-table-aware `Ready`/`Falling` selection policy that client-mode presentation currently
  lacks.
- `crates/holtburger-core/src/client/simulation.rs` already owns the client local-player physical
  transaction and remote physical actuation. Its local launch path does not drive a jump
  presentation order, while its grounded remote path ignores retained authoritative velocity.
- `crates/holtburger-core/src/client/movement/system.rs::ServerControlledProjection` currently
  combines target pose/speed with a separate `server_controlled_keep_heading` flag and projects
  every server-controlled target as `force_grounded: true`. Its distance-only reconciliation can
  also retire a heading-only TurnTo before the heading is applied. This is the existing seam to
  replace, not behavior to duplicate in the world solver.
- `apps/holtburger-3d/src/client/ClientWorldView.svelte` owns client HUD composition; jump-bar
  styling and placement stay app-local.

### Evidence Checks Completed 2026-08-29

- `npm run test:ts -- src/lib/game/controls/character-input-controller.test.ts`: 12 passed.
- `cargo test -p holtburger-core character_jump --lib`: 8 passed.
- `cargo test -p holtburger-core character_motion_retail_differential --lib`: 10 passed.
- GDLE revision `542a209d89e13d6fbb5df3f3e77fd72d10a4b647` was inspected from a temporary shallow clone;
  its `MOVEMENT_JUMP` handler matches retail extent/velocity/position ordering.
- ACE history and dispatch were inspected locally; no complete-payload check invalidates the
  compatibility explanation above.
- The checked-in live-client probe defaults to the local ACE server at `127.0.0.1:9000`, accepts
  credentials only through process environment, and already redacts them from probe reporting.
- `apps/holtburger-3d/.dev.env` contains the local test account keys required to populate the
  probe's credential environment; values were not printed or copied into this plan.
- A passive probe completed authentication, character selection, portal-space entry, in-world
  observation, and explicit disconnect against that local server with process exit `0`. The local
  runtime verification path is therefore available; jump acceptance remains a post-implementation
  gate because the current client cannot emit the corrected jump yet.

### Settled Evidence Decisions

- **Active charge stance:** retail `GetPowerBarLevel` reads the current interpreted motion style on
  every sample. A mid-charge style change therefore keeps the original start time and immediately
  changes the denominator to `0.8` or `1.0` seconds. The existing frontend controller's
  `setFullChargeDurationMs` already implements that ownership shape.
- **Stamina:** retail `InqJumpVelocity` uses current stamina only to replace effective Jump skill
  with zero when exhausted; `CMotionInterp::jump` separately computes a stamina adjustment. The
  client predicts height using the current-stamina exhaustion rule but does not deduct stamina
  locally. Server vital updates remain authoritative.
- **Capability completeness:** Jump skill, burden, motion-table kinematics, stance, and local body
  support are required world facts. An in-world attempt with any missing fact is rejected explicitly
  and never filled with a gameplay default.
- **Simulation transaction:** the fixed tick returns ordinary world events plus at most one
  committed jump product. That product carries the already-resolved launch and release packet facts;
  later layers do not reconstruct them.
- **Server-family verification:** GDLE source is corroborating packet evidence only. Runtime
  interoperability targets the available local ACE server; no GDLE deployment or endpoint is
  required.
- **Local-player reconciliation:** retail does not classify acknowledgements by comparing incoming
  and predicted vectors, and it does not add a jump-only airborne exception. At autonomy level `2`,
  ordinary fresh server position/vector updates advance their independent freshness sequences but
  do not replace the local player's pose or vectors. A newer force-position or teleport sequence is
  the explicit correction signal. This is an authority-mode rule, not a ballistic-epoch heuristic.
- **Airborne server command ownership:** non-autonomous MoveTo/TurnTo is a command-authority
  transfer, not an ordinary server echo. Retail accepts the command immediately and permits heading,
  but its contact gate defers translation and MoveTo progress until landing. Holtburger must not
  reuse `force_grounded` to bypass that gate or clear the command from distance alone while airborne.
- **Jump presentation ownership:** retail `CMotionInterp::apply_interpreted_movement`
  (`acclient.c:330390-330453`) selects `Falling` when contact disallows planar movement.
  `CMotionInterp::LeaveGround` and `HitGround` (`acclient.c:330655-330713`) reapply current movement
  at support transitions. Presentation therefore derives from the same support transition as
  physics; it is not a renderer-owned jump flag or a distinct animation packet.
- **ACE observer jump shape:** `Player.HandleActionJump` clears contact, applies the supplied local
  velocity, broadcasts `GameMessageUpdateMotion` with invalid/current movement, then broadcasts
  `GameMessageVectorUpdate` (`ACE/Source/ACE.Server/WorldObjects/Player.cs:866-955`). The vector is
  the observer's launch evidence; ACE does not broadcast a separate jump-controller event.

### Post-Implementation Feedback Evidence 2026-08-29

- A local playable jump follows the expected ballistic pose but remains in idle presentation
  through takeoff, airborne travel, and landing.
- An observed remote player retains horizontal travel but remains terrain-constrained, producing
  ground sliding instead of a ballistic arc.
- `DynamicEntityView.playing_clip` is sourced solely from `WorldState.motion_runtimes`; the renderer
  applies that level without independently deriving contact or velocity semantics.
- The committed local `GroundedLaunch` changes physical actuation but never replaces the local
  motion order with `Falling`; landing likewise has no support-edge presentation transaction.
- Remote `VectorUpdate` ingestion correctly retains the authoritative vector. For a prepared
  grounded remote body, `remote_entity_actuation` consumes only authored motion offset and ignores
  that retained vector, so no launch reaches the physical solver.
- Bulk remote playback continues to consume the `UpdateMotion` snapshot and does not replace its
  forward command with `Falling` from runtime support. Remote physics and presentation must
  therefore be corrected together.

### Runtime Regression Evidence 2026-08-30

- The first live playable-player attempt after support-driven presentation failed before launch:
  an autonomous self `UpdateMotion` carried top-level interpreted style `0`, which
  `MotionStance::from_interpreted` incorrectly promoted to semantic `MotionStance::Invalid`.
  Manual playback then let that snapshot outrank the cached or motion-table default stance and
  required `Falling` in style `0x80000000`, where the standard table correctly has no row.
- The initial repair represented interpreted style zero as absence so it could not outrank the
  cached or table-default stance. Phase 12's deeper retail pass supersedes that intermediate
  reduction for admitted interpreted state: retail concretely defaults the replacement state to
  NonCombat, while uninitialized authority remains a distinct outer state.
- The same investigation found the shared `MotionCommand::READY` constant was `0x4000003C`, which
  matches neither retail nor ACE. Retail names `Motion_Ready` as decimal `1090519043`
  (`0x41000003`, `acclient.c:40605`), and ACE defines `MotionCommand.Ready = 0x41000003`.
- A real-DAT contract probe confirms standard motion table `0x09000001`, default style
  `0x8000003D`, resolves `Ready` (`0x41000003`) to animation `0x03000001` and `Falling`
  (`0x40000015`) to animation `0x030004A9`.
- The noninteractive live ACE drive probe completed with no movement error or presentation
  discontinuity: charge and release were accepted, contact transitioned `airborne -> grounded`,
  peak vertical displacement was approximately `10.25 m`, planar displacement was approximately
  `49.38 m`, and grounded playback recovered to animation `0x03000001`. An extended probe
  projection then recorded airborne clip transitions `0x03000005 -> 0x030004AC -> 0x030004A9`
  (`Falling`) followed by grounded `0x030004A6 -> 0x03000001` (landing to stand), proving clip
  identity independently from the physical arc.
- The simultaneous renderer warning for table `0x09000213`/clip `0x03000768` is independent of the
  standard player table. Later retail evidence supersedes the initial refusal: retail applies the
  clip's authored prefix and retains higher setup-part transforms. Phase 20 implements that generic
  overlay; it is not a jump-controller failure.

### Remote Motion-Lifetime Feedback Evidence 2026-08-30

- User observation: a remote actor begins the correct running or jumping presentation, but the
  clip never retires. A one-step actor runs in place indefinitely; a landed actor remains in the
  airborne presentation.
- `EntityMotionSnapshot::from_movement_event` currently maps an empty style-zero movement update to
  `None`. That loses the semantic difference between “this entity has supplied no motion state” and
  “stop every omitted channel while retaining the current/default stance.”
- `WorldState::advance_authored_motion_except` skips entities whose snapshot is `None` while
  deliberately retaining their existing `BodyMotionRuntime`. The last cyclic clip therefore
  remains the projected level. `reconcile_authored_motion_support` also returns early without a
  snapshot, so landing cannot replace `Falling` with the retained grounded order.
- The renderer is behaving correctly: `PlayingMotionClip.completion == Loop` means keep looping
  until the host projects a successor. Path-stable dynamic-entity updates already carry changed
  clip levels; synthesizing a frontend timeout would conceal stale host authority rather than fix
  it.
- ACE `BroadcastMovement` converts every client `MoveToState`, including key release, into
  `GameMessageUpdateMotion`. Omitted raw forward/sidestep/turn fields are channel stops. ACE's
  interpreted-state builder carries a supplied current style and otherwise omits it
  (`ACE/Source/ACE.Server/WorldObjects/Player_Networking.cs:311-364`,
  `ACE/Source/ACE.Server/Network/Motion/MovementData.cs:87-159`).
- Deeper retail evidence corrects the earlier stance-retention inference: an omitted interpreted
  style is unpacked as NonCombat, while omitted forward/sidestep/turn fields become Ready/no
  sidestep/no turn. MoveTo/TurnTo are different: they retain interpreted movement and may apply the
  outer style (`InterpretedMotionState::UnPack`, `acclient.c:320348-320453`;
  `MovementManager::unpack_movement`, `acclient.c:326022-326141`).
- Retail admits remote movement by exact object instance, strictly newer wrapping movement
  timestamp, and compatible server-control timestamp before unpacking it into the same physics
  object's movement manager (`CPhysics::SetObjectMovement`, `acclient.c:299898-299995`). Holtburger
  currently retains vector freshness but does not apply the equivalent remote movement-sequence
  admission.

The defect is therefore an authority-state ambiguity, not an animation-duration problem. The
existing shared motion runtime and physical solver are the right convergence point; the remote
network adapter must stop feeding them a lossy optional level.

### Creature Skating and Action Evidence 2026-08-30

- There is no player-kind gate around retained network motion or motion-table lookup. The observed
  creature skating comes from input shape: ACE commonly moves creatures with `MoveToPosition` or
  `MoveToObject`; Holtburger retains those as directives, then blanket-skips authored playback and
  root projection whenever `directive.is_some()`
  (`crates/holtburger-world/src/state/motion_resolution.rs:70-88`, `299-417`). Spatial target
  reconciliation still moves the body, so the renderer receives translation without an authored
  locomotion sequence.
- Retail does not maintain a presentation-only MoveTo controller. `MoveToManager::BeginMoveForward`
  derives the current walk/run command from distance and `MovementParameters`, while
  `MoveToManager::_DoMotion` and `_StopMotion` feed that command into ordinary
  `CMotionInterp::DoInterpretedMotion` and `StopInterpretedMotion`
  (`acclient.c:330955-331009`, `331502-331575`, `332248-332307`). Auxiliary heading correction is
  likewise admitted as an ordinary turn command, then retired or replaced as target geometry
  changes (`acclient.c:331693-331805`).
- ACE's readable equivalent selects run only when running is permitted and either walking is not
  permitted or remaining travel exceeds the walk/run threshold
  (`ACE/Source/ACE.Entity/Movement/MovementParameters.cs:152-185`). The received directive must
  therefore retain its target and interdependent movement parameters; a bare directive enum cannot
  reconstruct the authored command retail plays.
- A read-only census of the local ACE world database found 7,831 creature weenies. Of those, 7,792
  specify a motion table directly, 39 require setup fallback, and zero lack both sources. A separate
  census of the current 43,913-record `weenies.hwc` artifact finds 13,984 direct properties and 12
  setup fallbacks across eight setups; these are different source populations and their blast-radius
  counts must not be conflated. Missing
  creature motion-table data is not the general skating cause. `WorldState` already resolves the
  setup fallback, but `DynamicEntityView` still projects only the direct `mtable_id`; the effective
  table decision must be computed once and carried to every downstream consumer.
- The current interpreted-command adapter recognizes only seven locomotion commands
  (`crates/holtburger-world/src/motion/state.rs:60-79`) and silently drops other modelled commands
  when building `MotionOrder`. Retail's exact expansion table contains 412 interpreted indices in
  18 command classes and 66 contiguous runs (`acclient.c:39406-39817`). An exhaustive typed lookup
  is small enough to own once and test completely; no downstream layer should reinterpret the
  numeric index independently.
- Retail carries command-list items as command, speed, a wrapping 15-bit sequence, and an
  autonomous bit. `CMotionInterp::move_to_interpreted_state` freshness-checks each action and feeds
  accepted actions into ordinary interpreted playback (`acclient.c:319656-319750`,
  `320348-320503`, `330607-330677`). Holtburger's protocol value already preserves all four facts;
  the missing boundary is transient admission into the motion runtime, not another retained
  movement field.
- Retail selects actions from the same motion table and sequence machinery as steady movement,
  queues them FIFO, clears cyclic playback for the action transition, installs the return cycle,
  and removes the action only when `AnimationDone` reports completion
  (`acclient.c:324194-324455`, `327691-327817`, `316998-317150`, `329908-329990`). The retail queue
  bound is six (`acclient.c:330865`). A timer, renderer callback, or parallel action player would
  create a second lifecycle and is not justified.
- ACE creature attacks and spell gestures frequently serialize an action command through the
  interpreted `forward_command`, not the command list
  (`ACE/Source/ACE.Server/Entity/Motion.cs`, `Monster_Melee.cs`, `Monster_Magic.cs`). Such an
  action-class forward command is a one-shot edge associated with admission of that fresh outer
  movement event. Retaining it as a steady forward level would restart or loop the action forever.
- The style selector currently looks up the source style's default and reuses it as the destination
  style's default (`crates/holtburger-world/src/motion/selection.rs:195-273`). Retail queries the
  destination style's own default before selecting its cycle (`acclient.c:324194-324273`). A
  temporary full-DAT census found 284 tables with multiple styles but zero whose styles have
  distinct defaults, explaining why existing fixtures and shipped content mask this semantic bug.
  The probe was removed after recording the result; the fix still needs a synthetic distinct-default
  regression test.
- Existing content evidence also rules out a cycles-only shortcut for actions: the 436 motion
  tables contain 1,222 modifiers and 42,537 links, and only 25 of 1,047 `Attack` hooks are reachable
  from cycles. Action selection must use the existing full motion-table closure and sequence runtime.

The structural correction is therefore entity-generic and additive at the authority boundary:
retained steady state, server directives, transient actions, and local semantic input remain
source-specific facts, but each resolves into the same motion order/sequence runtime. That runtime
alone supplies the playing clip and authored root offset consumed by the body solver and renderer.
No creature controller, player controller fork, or renderer animation heuristic is warranted.

### Live Creature Turn and Locomotion Regression Evidence 2026-08-30

- User observation after the entity-generic cutover: creatures play stance, idle, and attack
  sequences, but commonly translate without walk/run/strafe presentation. A creature ordered to
  turn can continue rotating through its attack and idle presentation instead of settling at the
  target heading.
- Source inspection confirms creatures and remote players do not have separate motion runtimes.
  `WorldState::advance_authored_motion_except` iterates every retained entity, reduces its network
  motion, and drives the same `MotionRuntimeRegistry`; `BodyProjectionResolver` then exposes that
  runtime's one authored offset to the same remote physical adapter
  (`crates/holtburger-world/src/state/motion_resolution.rs:26-94,470-512`). Entity category is not
  consulted by either path.
- Two initial local-ACE captures near the Tusker population admitted only action-class forward
  edges followed by interpreted `Ready`. Those captures proved creature table selection/action
  retirement was active, but their lack of `MoveTo` was a sampling limitation rather than evidence
  of a server omission.
- A raw capture with fresh admin-created nearby spawns supersedes that inference. Crude Monouga
  `0x800010F6` received an explicit non-autonomous `MoveToObject` targeting the local player before
  approximately 11 m of authoritative position samples. ACE's create and navigation paths also
  serialize current movement and broadcast MoveTo explicitly
  (`WorldObject_Networking.cs:306-338`, `Creature_Navigation.cs:292-335`). Locomotion authority is
  present and does not need to be inferred from displacement.
- A later passive correlation observed three Jungle Reavers translating approximately 20-21 m
  while the host continuously projected `0x03000558`. Content inspection identifies that clip as
  the current style's TurnRight cycle with authored omega `z = -3.2`; the same table's Walk and Run
  cycles are `0x030001AC` and `0x030001AB`. Their committed headings changed only approximately
  0.075-0.093 radians through the translating turn phase, proving the directive remained in its
  initial turn while authoritative interpolation moved the body.
- The loss is in grounded reconciliation: `reconcile_physical_body_actuation` captures the
  ordinary authored control heading, then replaces it with `None` for interpolation carrying
  `keep_heading`. Retail instead copies the current object heading into the interpolation target
  and zeros only the interpolation offset's heading, leaving MoveTo's authored turn free to rotate
  the object (`InterpolationManager::InterpolateTo`, `acclient.c:371857-371996`;
  `InterpolationManager::adjust_offset`, `372078-372092`).
- Holtburger's directive reducer currently emits `TurnLeft` with a positive rate for a negative
  heading delta (`crates/holtburger-world/src/motion/directed.rs:538-557`). Retail instead
  canonicalizes creature `TurnLeft` to `TurnRight` with the rate sign inverted
  (`CMotionInterp::adjust_motion`, `acclient.c:330006-330055`) before applying interpreted movement
  (`acclient.c:330485-330516`). Holtburger's local `character_axes` adapter already follows that
  signed canonical representation.
- The shared runtime stops an absent turn channel by naming canonical `TurnRight`, while
  `stop_motion` removes an active modifier by exact command identity
  (`crates/holtburger-world/src/motion/registry.rs:417-424`,
  `crates/holtburger-world/src/motion/selection.rs:181-220`). A directive-installed `TurnLeft`
  therefore cannot be retired by the canonical release. Changing release to broad family matching
  would conceal the malformed order and depart from retail's exact stop behavior; canonicalizing
  the directive order at its producer is the narrower correction.
- The live probe deliberately ran the test character forward for six seconds to provoke fresh
  navigation. Because the account had already been positioned near monster spawns, this moved the
  observer away from the intended fixture; the user created spawns around the resulting location.
  Future passive creature verification must not move the account unless movement is itself an
  explicit scenario input. The temporary probe and packet logging were removed after recording
  these facts.

These observations reopen three independent gates. Directed left-turn canonicalization is a proven
producer defect with a mechanical retail correction. Grounded keep-heading reconciliation drops a
valid authored turn and prevents MoveTo from selecting locomotion. Partial-part animation refusal is
a separate retail conformance defect with a material content population, but it is not causal for
the captured Reaver or Monouga clips. None warrants a creature-specific controller or a
displacement-derived gait command.

## North Stars

1. Compute one resolved jump and let physics and protocol consume different coordinate projections
   of that same value.
2. Treat player skill, burden, stamina, stance, support, position, and movement timestamps as
   authority facts; the renderer supplies only semantic input and elapsed charge extent.
3. Keep raw keys, charge visualization, and HUD placement in the frontend while reusable character
   interpretation remains in core.
4. Preserve authored grounded motion and ballistic airborne momentum as different physical
   regimes; a jump is the explicit conversion boundary.
5. Follow retail wire behavior even when ACE accepts a malformed or abbreviated interpretation.
6. Replace the narrow client control seam cleanly; do not retain parallel manual-drive and jump
   state machines.
7. Make rejection and ownership loss explicit so an optimistic UI cannot strand a power bar.
8. Prefer focused composite results over re-deriving height, velocity, position, or packet fields
   in later layers.
9. Keep command ownership, heading eligibility, translation eligibility, and completion criteria
   explicit; distance alone is not completion for every server-controlled motion kind.
10. Derive physical support disposition once and let physics plus authored presentation consume it;
    pose continuity and clip identity are separate outcomes that require separate evidence.
11. Entity category never determines motion fidelity. Players and creatures may have different
    authority sources, but equivalent resolved commands use the same selector, runtime, solver, and
    projection path.
12. Treat steady movement as retained level state and actions as admitted edges. Neither may be
    encoded as the other merely because ACE used the same wire field.
13. Compute the effective motion-table source once at the world-owned content boundary; playback,
    root motion, and frontend projection consume that decision without fallback re-derivation.

## Phase 0: Correct and Document Retail `JumpPack`

### Deliverables

- Replace `JumpActionData`'s ACE-shaped fields with retail fields:
  - `extent`;
  - local `velocity`;
  - full `WorldPosition`;
  - instance, server-control, teleport, and force-position sequences.
- Replace the synthetic 32-byte fixture with a 56-byte independently assembled retail fixture.
- Add malformed/truncated decoding cases at every composite-field boundary.
- Document `0xF61B` in the durable protocol documentation location, including the ACE parser
  divergence and GDLE corroboration.

### Task Checklist

- [x] Change `crates/holtburger-protocol/src/messages/movement/actions.rs` without retaining old
      aliases or optional compatibility fields.
- [x] Remove `object_guid` and `spell_id` from the codec, tests, vocabulary, and documentation.
- [x] Construct the fixture from explicit known values so field offsets prove the layout rather
      than round-tripping the implementation against itself.
- [x] Assert action-body length `56` and complete decode consumption in Holtburger tests.
- [x] Record the retail, GDLE, and ACE evidence in protocol docs.

### Acceptance Criteria

- Packing the fixture produces extent at byte `0`, velocity at `4`, position at `16`, timestamps at
  `48`, and total length `56`.
- Unpacking rejects any body shorter than the required retail layout.
- No surviving Holtburger symbol implies that jump carries object/spell targeting fields.
- ACE compatibility is treated as tolerant parsing, not as the protocol definition.

### Decisions and Course Corrections

- Completed 2026-08-29. `JumpActionData` now reuses the existing fixed-size `WorldPosition`; no
  parallel position codec or server-family variant was introduced.
- The independently enumerated 56-byte fixture proves field offsets and complete consumption.
  Truncation tests stop before extent, velocity, position, and sequence completion without advancing
  the caller's offset.
- Durable wire documentation lives in `docs/movement.md`, beside the existing client-authored
  movement action documentation. It records retail construction, GDLE prefix corroboration, and why
  ACE's tolerant parser remains interoperable.
- Verification: all 267 `holtburger-protocol` library tests pass; protocol Clippy passes with
  warnings denied; `cargo fmt --check` passes. No Phase 0 debt remains.

## Phase 1: Widen Client Manual Drive to Strafe

### Deliverables

- Add nullable `lateral: "left" | "right"` to the client renderer/host drive contract.
- Bind Z/C in client mode through the existing `CharacterInputController` mapping.
- Preserve independent longitudinal, lateral, and turn axes and newest-held precedence.
- Keep camera translation intent active for longitudinal or lateral movement; turning-only camera
  policy remains unchanged unless runtime evidence requires it.

### Task Checklist

- [x] Update `ClientDriveRequest`, Zod decoding, Electron host arguments, client lifecycle session,
      Rust deserialization, and `LateralMotion` conversion.
- [x] Delete `IDLE_CLIENT_DRIVE` if the widened controller-owned reset path makes it redundant.
- [x] Extend wire and session tests for left, right, diagonal, and idle lateral values.
- [x] Verify Z/C plus W/S/A/D/Shift combinations through the browser input tests.

### Acceptance Criteria

- Z and C produce authored sidestep motion in client mode.
- W+Z and W+C preserve both axes and follow the shared retail diagonal cap.
- Opposed strafe keys resume the previously held direction on release.
- Releasing/focus loss sends an idle lateral replacement; no strafe remains stuck.
- Airborne strafe input does not replace retained planar launch velocity; this remains a Phase 3
  launch acceptance criterion because Phase 1 deliberately introduces no airborne state.

### Decisions and Course Corrections

- Completed 2026-08-29. The client wire contract now carries one nullable lateral axis through Zod,
  Electron forwarding, Rust deserialization, and `CharacterDrive`; no side-channel strafe command or
  duplicate drive state was added.
- `ClientApp` now accepts Z/C and forwards the existing controller's semantic lateral value. Camera
  translation intent includes lateral movement while preserving the existing turning behavior.
- The unused `IDLE_CLIENT_DRIVE` constant was deleted. Controller reset remains the sole idle
  replacement producer, including blur/focusout/visibility cleanup.
- The live redacting probe now contains left-strafe and forward-right-diagonal phases. Against local
  ACE it authenticated, entered world, completed every drive phase without a command error, and
  exited `0`; the measured phases included non-zero left-strafe and diagonal displacement.
- Verification: 34 focused TypeScript tests and five focused host tests pass; full app type/Svelte
  checks, ESLint, Knip, host Clippy with warnings denied, Prettier, and Rust formatting pass. Airborne
  input retention remains intentionally verified with the first real launch in Phase 3. No Phase 1
  debt remains.

## Phase 2: Install Playable Character-Motion Ownership and Jump Capability

### Deliverables

- One client-owned `CharacterMotionController` inside core manual movement orchestration.
- One ordered client command for begin-jump, release-jump, and reset edges.
- A world-owned pure player jump-capability resolver that produces the full-extent height fact
  expected by `CharacterJumpKinematics`.
- Explicit charge-start eligibility for walkable support and burden below `2.0`.
- Exhaustion behavior that supplies zero Jump skill while retaining retail's minimum height.
- Complete retirement on activation, teleport, disconnect, focus reset, and movement-epoch reset.

### Task Checklist

- [x] Replace duplicate manual-drive storage with a composite state in `MovementSystem` whose
      controller owns current semantic drive and charge phase.
- [x] Route `PlayerDriveIntent::ManualHeld` into that controller; autonomous and server-controlled
      intents remain distinct.
- [x] Make both outbound manual motion state and authored local playback consume
      `effective_drive()`, including standing-charge translation suppression.
- [x] Add a sequenced `ClientCommand` carrying only validated semantic jump edges.
- [x] Resolve current Jump skill and burden in `holtburger-world`; use current stamina only for the
      proven exhausted-skill rule.
- [x] Reuse `resolve_self_movement_capabilities` for motion-table walk/run speeds and Run rate.
- [x] Derive charge duration from the current resolved motion stance via
      `retail_jump_charge_profile`.

### Acceptance Criteria

- There is exactly one manual semantic drive fact and one charge phase in core.
- A stationary accepted charge suppresses forward/strafe authored translation but retains turn.
- A moving charge continues ordinary translation.
- Release samples the current drive, gait, Run rate, Jump skill, burden, stamina state, stance, and
  heading rather than charge-start snapshots except for `standing_long_jump`.
- Burden `>= 2.0` and missing walkable support reject charge start with distinct reasons.
- Invalid or stale sequences cannot restart, release, or reset a newer charge.

### Decisions and Course Corrections

- In progress 2026-08-29. `MovementSystem` now owns one `CharacterMotionController`; manual wire
  state and authored playback both read `effective_drive()`. The old duplicated manual drive value
  was collapsed to a unit ownership marker.
- The ordered `ControlCharacter` command and renderer/host `begin-jump`, `release-jump`, and `reset`
  request seam are installed. Strict TypeScript and Rust adapters preserve sequence and the exact
  release-time semantic drive.
- `SelfJumpCapabilities` resolves movement capability, Jump skill, burden, and current Stamina in
  world. Missing facts are typed errors; exhaustion substitutes zero effective Jump skill without
  predicting a local Stamina deduction.
- Focused world tests prove skill scaling, burden reduction, exhaustion, and missing-skill/stamina
  rejection. Core controller tests already prove standing suppression, moving charge, stale-edge
  rejection, and release-time drive sampling.
- The stance-derived charge duration now crosses the complete snapshot and changed-capability
  delta. Controller results retain their originating sequence; release feedback is delayed until
  the physical transaction commits or rejects the attempt.

## Phase 3: Commit One Launch and Emit Its Retail Packet

### Deliverables

- A typed client simulation result containing ordinary world events and at most one committed
  player jump product.
- Atomic composition of the resolved world velocity with the selected grounded planar actuation.
- A packet product retaining the release origin, local velocity, extent, and exact four sequence
  values once.
- Post-commit `GameAction::Jump` emission using the retail `JumpActionData` codec.
- Explicit rejection when the body, collision product, support, or jump capability is unavailable.

### Task Checklist

- [x] Let the fixed tick consume at most one ordered release attempt.
- [x] Capture the exact local-player release pose before ballistic integration; retail constructs
      `JumpPack` from the immediate release position, not a later integrated pose.
- [x] Resolve one `ResolvedJump`; do not separately compute packet and body velocity.
- [x] Add `GroundedLaunch::new(resolved.world_velocity())` to the local grounded actuation while
      preserving the one selected planar basis.
- [x] Return a committed jump product only if the local physical transaction accepted the launch.
- [x] Send `GameAction::Jump` after local acceptance with `resolved.local_velocity()`, captured
      release position, extent, and current movement sequences.
- [x] Preserve existing airborne coast behavior and turn-only input gate on later ticks.
- [x] Ensure server corrections, teleport activation, and collision unavailability retire pending
      attempts rather than replaying them in a later epoch.

### Acceptance Criteria

- Local physics and the packet originate from the same `ResolvedJump` instance.
- Forward, backward, left/right strafe, and both diagonals produce the retail-oracle local velocity.
- Higher current Jump skill produces higher vertical velocity for equal burden and extent.
- Higher burden reduces vertical velocity; exhaustion reaches the retail minimum-height path.
- No packet is emitted when the local launch is rejected or not committed.
- After launch, W/S/Z/C changes do not alter retained planar velocity; A/D may continue turning.
- The packet position is the captured release origin and the packet timestamps match current player
  sequence state.

### Decisions and Course Corrections

- In progress 2026-08-29. The fixed tick now returns ordinary events plus at most one
  `CommittedPlayerJump`. One `ResolvedJump` supplies the `GroundedLaunch` world velocity and the
  later `JumpActionData` local velocity.
- Pending attempts are consumed before collision availability is inspected, so a missing scene
  snapshot cannot replay a release on a later tick. Activation and non-manual ownership changes
  also clear queued edges, controller state, and pending attempts.
- A real flat-terrain fixed-tick test grounds a dynamic local player through the collision solver,
  launches it, asserts positive retained vertical velocity, preserves all four timestamps, and
  proves a later tick cannot commit the same attempt again.
- The test confirmed that collision residency canonicalizes the cell component of `WorldPosition`.
  The committed packet origin is therefore asserted against the canonical local-body pose sampled
  immediately before launch, not the earlier synthetic seed position.
- Preparation and physical commit failures now return stable renderer-facing rejection reasons.
  Missing collision consumes the release, publishes `collision-unavailable` at the same sequence,
  emits no packet, and cannot replay when collision later becomes available.
- Local ACE accepted the position-bearing retail packet: charge sequence `10000` was accepted,
  release sequence `10001` committed at extent `0.5`, and the session remained connected without a
  presentation discontinuity or packet-attributable rejection.
- **Phase 3 completed 2026-08-29.** The retail authority cutover prevents ordinary self vector and
  position echoes from replacing locally integrated velocity while preserving independent packet
  freshness. A fresh-destination live trace then proved an airborne arc, retained planar travel,
  an airborne-to-grounded transition, and no presentation discontinuity.

## Resteering Gate: Packet, Physics, and Authority Audit

Before adding renderer feedback, dry-run every remaining phase against the implemented Phase 3
contracts:

- confirm the retail packet fixture and local ACE live acceptance;
- inspect one committed launch to ensure no velocity or position is re-derived;
- confirm movement-epoch retirement covers every reachable ownership loss;
- check whether accepted/rejected outcomes already have a smaller honest projection than the
  planned feedback event;
- revise UI contracts before exposing any unnecessary core state.

## Phase 4: Project Reconstructible Jump UI Facts

### Deliverables

- A narrow renderer-safe character-motion capability level containing the current full-charge
  duration.
- Complete inclusion of that level in `ClientApplicationSnapshot` and client current state.
- Delta publication when a stance change changes the charge profile.
- Sequenced jump feedback sufficient to reconcile optimistic begin/release/reset UI state and show
  retail-style rejection text.

### Task Checklist

- [x] Add the capability to core application snapshot construction and the client host projection.
- [x] Publish only fields with named renderer consumers; do not expose skill, burden, velocity,
      body contact, or sequence counters.
- [x] Project begin rejection with the originating sequence so `rejectBegin` cannot cancel a newer
      charge.
- [x] Project release rejection/reset retirement for status feedback and cleanup.
- [x] Make lag recovery invalidate deltas until the complete current-state replacement arrives.
- [x] Extend host protocol, Electron event inventory, Zod decoders, and lifecycle-session tests.

### Acceptance Criteria

- Mounting or recovering in world supplies the correct `1000` or `800` ms profile without waiting
  for a later delta.
- A stale rejection cannot hide a newer bar.
- Teleport, lifecycle loss, focus loss, and disconnect clear optimistic charge state.
- No renderer contract contains authoritative gameplay inputs it does not consume.

### Decisions and Course Corrections

- Completed contract implementation 2026-08-29. The only projected capability field is
  `fullChargeDurationMs`; the only delta is a complete optional replacement. Feedback contains the
  originating sequence and a reconstructible lifecycle outcome/rejection reason.
- Capability changes update the existing frontend controller denominator without reconstructing
  the controller, preserving the original charge start time across a mid-charge stance change.
- Full app checks and focused lifecycle/host tests pass. No unused gameplay authority crossed the
  renderer boundary.

## Phase 5: Add the Client Jump Power Bar

### Deliverables

- App-local `ClientJumpPowerBar.svelte` composed by `ClientWorldView.svelte`.
- Active-only charge sampling driven by the same monotonic clock and duration used to create the
  released extent.
- Retail lifecycle behavior: begin at zero, fill to one, remain capped while held, and disappear on
  finish/rejection/reset.
- Accessible progress semantics and client-theme styling.

### Task Checklist

- [x] Bind Space in `ClientApp.clientInputKey` and dispatch ordered controller edges through the
      lifecycle session.
- [x] Store one frontend charge presentation containing begin sequence, monotonic start, and active
      duration; do not duplicate authoritative body or skill state.
- [x] Sample only while visible, using an isolated animation-frame loop or equivalent active-only
      mechanism rather than routing frame-hot facts through broad Svelte reactivity.
- [x] Render a `role="progressbar"` surface with `[0, 1]` range and an accessible Jump label.
- [x] Place the bar near the lower viewport using existing client HUD styling, without coupling it
      to movable character HUD state.
- [x] Surface burden/support/airborne rejection in the existing client message/status language.

### Acceptance Criteria

- The displayed extent and released extent are computed from the same start time and duration.
- Standard and dual-wield profiles visually reach full at `1000` and `800` ms respectively.
- Holding beyond full remains at `1.0`; tapping emits at least `0.001`.
- Rejected begin, key release, reset, blur, teleport, disconnect, and component destruction remove
  the bar.
- The bar performs no animation-frame work while hidden.

### Decisions and Course Corrections

- Implemented `ClientJumpPowerBar.svelte` as a concrete app-local component. It owns no gameplay
  values and schedules animation frames only while active.
- Space is gated until the authoritative capability exists; ordinary W/S/A/D/Z/C input remains
  available during early capability hydration.
- Deterministic headless harness states passed: hidden has no progressbar, charging renders at 45%,
  full renders a capped bar, and rejected hides the bar while presenting status text. Screenshot
  parity was intentionally not required.

## Phase 6: Runtime and Interoperability Verification

### Deliverables

- Focused unit, protocol, host, simulation, and browser-harness coverage.
- A non-interactive scenario against the local ACE server at `127.0.0.1:9000` proving
  retail-shaped `0xF61B` acceptance, using credentials loaded from `.dev.env` without logging them.
- Machine-readable launch evidence covering local/packet velocity, release position, skill scaling,
  charge extent, contact transition, retained airborne velocity, and landing.
- Deterministic browser-harness assertions covering hidden, charging, full, and retired bar states.

### Task Checklist

- [x] Extend the existing independent retail differential matrix rather than duplicating formulas
      inside expected values.
- [x] Add protocol byte-offset and round-trip tests for the 56-byte body.
- [x] Add world capability tests for Jump skill, burden threshold, exhaustion, and missing data.
- [x] Add core fixed-tick tests for supported launch, airborne rejection, standing charge,
      moving charge, diagonal cap, post-launch input, teleport retirement, and packet suppression.
- [x] Extend the browser harness with synthetic authority fixtures for deterministic UI timing.
- [x] Add a focused live client probe that jumps once against ACE and records server response,
      local contact/velocity, correction count, and landing.
- [x] Reuse the checked-in probe's default local address, environment-only credentials, redaction,
      serialized session ownership, and timeout behavior rather than creating a second login path.
- [x] Run formatting, TypeScript checks, ESLint, dead-code analysis, Rust checks, Clippy with
      warnings denied, and relevant Rust/TypeScript test suites.

### Acceptance Criteria

- ACE accepts the position-bearing retail packet without disconnect, movement rejection, or forced
  correction attributable to packet layout.
- Equal extent/burden with different Jump skills yields the predicted different apex/launch Z.
- Forward/strafe/diagonal launches retain their planar vector until collision response changes it.
- The camera and dynamic entity placement follow the locally committed body through launch and
  landing; Phase 11 separately verifies authored clip identity.
- Browser-harness evidence shows exact charge timing and complete cleanup paths; screenshot parity is
  not required.
- All required checks pass with no ignored warnings or asset-dependent permanent test.

### Decisions and Course Corrections

- In progress 2026-08-29. Protocol, world, core, host, TypeScript, and deterministic browser checks
  are green. Local ACE accepts the retail packet and returns the expected sequenced commit.
- Pre-cutover live runs reproduced the ownership defect rather than a stale login state: after an
  accepted half-charge forward/right launch followed immediately by idle input, ordinary server
  vector/position ingestion could replace the locally integrated ballistic state.
- The probe deliberately retains this evidence path. Its raw entity census is verbose but contains
  no credentials; values from `.dev.env` remain process-only and redacted.
- Retail reconciliation was implemented at the existing authority boundary. `Confirm` now honors
  its documented contract by preserving retained runtime vectors; standalone self vector packets
  update only server-authored entity facts and their independent freshness sequence. Stale or
  mismatched-instance vector packets mutate neither fact set.
- The fix is deliberately authority-wide rather than jump-specific: there is no ballistic flag,
  vector tolerance, timeout, or ACE-only branch. Force-position/teleport `Reset` paths still clear
  local kinematics atomically.
- After the cutover, the complete `holtburger-world` suite passes `496` tests and the complete
  `holtburger-core` suite passes `290` tests.
- The final fresh-destination ACE trace accepted charge sequence `10000` and committed release
  sequence `10001` at extent `0.5`. It reached a `10.25 m` airborne apex, retained `45.70 m` of
  planar travel, transitioned from `airborne` to `grounded`, and finished on terrain `3.34 m` below
  takeoff. Every sample remained `simulating-velocity`; the trace reported zero presentation
  placement discontinuities and no drive error. It did not record playing-clip identity. This
  closes the live physical landing gate without relying on terrain height matching the takeoff
  height, while Phase 11 retains animation verification as an independent gate.
- Final feature-owned verification is green: protocol `267`, world `496`, core `290`, host `248`,
  and focused frontend `54` tests pass; the browser harness passes; formatting, Svelte/TypeScript
  checks, ESLint, Knip, Rust checks, and Clippy with warnings denied pass. The repository-wide
  frontend run has two unrelated pre-existing failures in `point-light-falloff.test.ts`: its viewer
  light expectations disagree with the checked-in calibration. Neither the test nor lighting code
  is modified by this slice, so cleanup did not alter unrelated rendering behavior.

## Resolved Evidence Gap: Local Physical vs Server Vector Ownership

Execution stopped on 2026-08-29 under the plan-gap rule. The required retail evidence was gathered
the same day; the implementation may resume without a product decision.

The fixed-tick physical solver is not the defect in isolation. Its existing atomic-launch test and
the new client transaction test prove that a launch becomes airborne, gravity decays Z every tick,
later planar input cannot replace retained launch momentum, and a flat-terrain body lands.

The conflicting path is server-vector ingestion:

1. a local fixed tick commits `GroundedLaunch` and starts gravity-decaying `body.retained.velocity`;
2. ACE accepts `0xF61B` and can echo/update the player's velocity;
3. `WorldState::set_player_vector` or `update_entity_velocity` calls
   `apply_authoritative_vectors` for the local player;
4. `SpatialScene::apply_authoritative_body_vectors` assigns the incoming vector directly to
   `body.retained`, replacing the locally integrated ballistic state.

Retail resolves this at the authority boundary, not with a jump state machine:

1. `CommandInterpreter` defaults to autonomy level `2`.
2. `UsePositionFromServer` returns false exactly at level `2`.
3. `SmartBox::DoVectorUpdate` still advances a fresh vector timestamp but skips applying velocity
   and omega to the local player when `UsePositionFromServer` is false.
4. `SmartBox::HandleReceivedPosition` similarly does not apply an ordinary local-player packet's
   pose or velocity at level `2`; it only retains constraint information.
5. A newer force-position sequence explicitly blips the player and reapplies current movement. A
   newer teleport sequence explicitly teleports the player and zeros velocity.
6. Non-player objects and non-autonomous player modes continue consuming server vectors/positions.

Therefore Holtburger must preserve ordinary server sequence freshness and world facts while routing
local-player physical mutation through an autonomy-aware reconciliation boundary. No vector equality
tolerance, timeout, airborne flag, or jump-specific suppression is justified. Explicit force-position,
teleport, and loss of client autonomy are the authoritative replacement paths. The remaining design
work is mechanical placement: colocate the policy with local-player authoritative-body reconciliation
so every client-controlled physical regime—not only jumping—obeys the same rule.

## Phase 7: Cleanup and Durable Documentation

### Deliverables

- A vocabulary sweep removing obsolete ACE-shaped jump fields and unbound-jump comments.
- Updated core/protocol architecture documentation describing character-control ownership and the
  launch-to-packet transaction.
- Removal of temporary live probes or asset-dependent fixtures that are not useful durable harness
  capabilities.
- A final sLOC and contract audit.

### Task Checklist

- [x] Sweep `object_guid`, `spell_id`, “jump edges remain intentionally unbound,” and any retired
      manual-drive duplication.
- [x] Verify each new field and event has a named consumer and each rejection has a reachable input.
- [x] Verify no shared crate contains client HUD policy and no frontend derives authoritative jump
      facts.
- [x] Re-run the remaining phases mentally against the final code shape and delete unused seams.
- [x] Update this plan with final decisions, evidence, concessions, and cleanup disposition.

### Acceptance Criteria

- The surviving architecture reads as one intentional character-motion path rather than Explorer,
  client drive, and client jump variants.
- Durable protocol docs are sufficient to implement retail `0xF61B` without reading Holtburger
  source.
- No compatibility shim preserves the incorrect Holtburger/ACE packet layout.
- Touched code is formatted, lint-clean, warning-free, and covered at the appropriate ownership
  layers.

### Decisions and Course Corrections

- The clean cutover removed the ACE-shaped Jump fields, the duplicate idle-drive constant, and the
  stale `set_player_vector` architecture vocabulary. Legitimate `object_guid` and `spell_id`
  vocabulary in unrelated protocols remains untouched.
- Every projected fact has a concrete consumer: charge duration drives the input controller and
  bar denominator; sequenced feedback reconciles optimistic charge state and status text; runtime
  body updates drive camera/entity presentation. The frontend never receives skill, burden,
  stamina, packet velocity, or body-authority internals.
- `ClientJumpPowerBar` remains an 84-line concrete app component. The live probe was retained as a
  durable redacting client-control scenario and now supports teleport-before-drive plus explicit
  contact-transition evidence; no asset-dependent test or temporary source patch remains.
- The tracked implementation delta is approximately `2,371` additions and `246` deletions before
  the temporary plan document, plus the 84-line bar component. The size is driven by one complete
  protocol-to-UX slice and its cross-language contracts/tests; the final audit found no generic
  power-bar abstraction, duplicate jump resolver, parallel drive owner, or jump-specific authority
  heuristic to delete.

## Phase 8: Realign Server-Controlled Airborne Motion

### Deliverables

- One classified server-controlled motion command that makes MoveTo translation and TurnTo
  heading/completion distinct instead of coupling `ServerControlledProjection` to the parallel
  `server_controlled_keep_heading` flag.
- Retail support gating for server-controlled MoveTo translation without changing autonomous/TUI
  `force_grounded` policy.
- Contact-aware completion that retains MoveTo while unsupported and completes TurnTo from heading
  rather than zero positional distance.
- Airborne actuation that composes retained ballistic velocity with eligible heading only.

### Task Checklist

- [x] Replace the interdependent projection-plus-heading fields with one composite command-kind
      representation owned by `MovementSystem`.
- [x] Classify `MoveToPosition`, `MoveToObject`, `TurnToHeading`, and `TurnToObject` once when the
      server movement event is admitted; consumers must not re-infer the command kind.
- [x] Transfer server command ownership immediately while retaining the held frontend drive only
      for the existing post-control handoff.
- [x] While contact is not `Grounded`, project zero MoveTo translation, preserve the pending target,
      and continue projecting any eligible desired heading.
- [x] Preserve `body.retained` as the sole airborne linear basis so gravity and launch-time planar
      momentum continue unchanged.
- [x] On the first grounded tick, activate the retained MoveTo translation without replaying or
      reconstructing the server event.
- [x] Gate MoveTo distance completion on grounded support; gate TurnTo completion on normalized
      heading agreement rather than target distance.
- [x] Leave explicit force-position/teleport reset behavior and ordinary position/vector echo
      reconciliation unchanged.

### Acceptance Criteria

- An airborne MoveTo immediately suppresses local authored drive and may rotate the actor, but adds
  no target-directed planar displacement before grounded contact returns.
- The same airborne tick produces the same retained linear velocity/gravity result as a control tick
  without the MoveTo.
- Crossing within the MoveTo distance threshold during the ballistic arc does not retire the
  command or begin post-control handoff.
- Landing activates translation toward the retained target on the next physical transaction.
- A pure airborne TurnTo applies and completes from heading without waiting for landing or being
  discarded because its positional distance is zero.
- No `AutonomousDriveIntent` or TUI navigation behavior changes.

### Decisions and Course Corrections

- Retail evidence gathered 2026-08-29 settles the behavior; no product decision remains. Command
  ownership and heading begin immediately, translation/progress wait for grounded support, and
  physical velocity survives.
- This is a clean replacement of the old server-controlled projection shape, not a new airborne
  queue beside it. The retained command itself is the pending work.
- Dry-run implementation map:
  - `crates/holtburger-core/src/client/movement/system.rs` owns the composite command, contact-aware
    projection, and command-specific completion;
  - `crates/holtburger-core/src/client/simulation.rs` classifies admitted movement events once and
    composes heading-only airborne actuation with the existing retained physical basis;
  - focused tests stay beside those owners, with the encoded admission fixture remaining in the
    existing client-message test seam;
  - no world solver, protocol, host, renderer, or TUI contract change is expected.
- Contact is sampled from the runtime body when producing and reconciling the command. It is not
  retained as another command field, because doing so would create a stale second authority for
  support state.
- Completed 2026-08-29. `ServerControlledMotion` replaces the old target projection plus parallel
  heading flag with `MoveTo` and `TurnTo` variants. `ServerControlledTurnTarget` retains the
  absolute-heading and object-bearing forms required by retail's TurnToObject target/fallback
  branch.
- Admission now returns that command directly instead of manufacturing a fake
  `SolvedBodyKinematics` merely to transport its target pose. This removed a hollow intermediate
  shape and keeps runtime contact as the sole support authority.
- The support-disposition matrix, encoded admission regression, landing activation test, and two
  fixed-tick physical differentials are green. The complete `holtburger-core` library suite passes
  297 tests after the cutover. No Phase 8 debt remains.

## Phase 9: Differential Verification and Cleanup

### Deliverables

- An independent retail disposition matrix for MoveTo/TurnTo across grounded and airborne contact.
- Fixed-tick integration coverage proving ballistic preservation, heading, pending ownership,
  landing activation, and completion.
- A vocabulary/contract sweep removing the retired server-controlled heading flag and any
  `force_grounded` claim that no longer describes this path.
- Updated durable movement documentation with the retail call-chain citations.

### Task Checklist

- [x] Add a small retail oracle covering command ownership, heading eligibility, translation
      eligibility, progress eligibility, and velocity replacement for grounded versus airborne
      MoveTo/TurnTo.
- [x] Add `MovementSystem` tests for airborne command retention, target crossing, grounded
      activation, MoveToObject/MoveToPosition classification, and heading-based TurnTo completion.
- [x] Add a fixed-tick physical test whose airborne control and server-MoveTo cases begin with equal
      retained velocity and remain equal after gravity integration.
- [x] Extend the encoded non-autonomous movement-event test so packet admission reaches the new
      classified command without moving the runtime body inline.
- [x] Retain regression coverage for server-control sequence freshness, heartbeat scheduling,
      explicit correction resets, and post-control held-drive handoff.
- [x] Sweep the old projection/heading vocabulary and verify the generic autonomous
      `force_grounded` consumers are byte-for-byte behaviorally unchanged.
- [x] Update durable movement/core architecture documentation and this plan with the final evidence
      disposition.
- [x] Run formatting, Rust checks, relevant core/world/host tests, and Clippy with warnings denied.

### Acceptance Criteria

- Production outcomes match every row of the independent retail matrix.
- Tests distinguish ownership transfer, heading, translation, completion, and retained velocity;
  no assertion treats one as evidence for another.
- No browser, host-wire, protocol, jump-resolution, or frontend contract changes are introduced.
- Touched code is formatted, warning-free, and contains the retail citations beside the
  non-obvious support/completion policy.

### Decisions and Course Corrections

- A second live ACE scenario is not required: the available server does not deterministically emit
  a MoveTo during the short airborne window, while encoded event admission plus the fixed physical
  transaction exercises the exact client-owned behavior without timing ambiguity.
- The independent matrix names ownership, heading, translation, completion, and velocity
  disposition separately for grounded/airborne MoveTo/TurnTo. Production tests consume those
  columns independently rather than treating command retention as evidence for physical behavior.
- Fixed-tick MoveTo and TurnTo cases start beside no-command controls with equal retained velocity.
  After collision/gravity integration their positions and retained velocities remain equal, while
  the server-command cases apply the requested heading. A later movement tick completes TurnTo from
  that heading; airborne MoveTo remains retained until support returns.
- TurnToObject inspection exposed one narrow pre-existing fidelity issue inside the planned
  classification seam: retail uses visible-object bearing plus the parameter heading, with the
  separately packed heading as an absolute fallback. `ServerControlledTurnTarget` now preserves
  both sources instead of flattening them at admission. No broader target-following/pathfinding
  change was required.
- Completed 2026-08-29. Verification: core 297, world 496, and host 248 library tests pass; Clippy
  passes with warnings denied for all three packages; `cargo fmt --all --check` and
  `git diff --check` pass. The retired projection/parallel-heading vocabulary is absent from active
  code and durable docs. No Phase 9 debt or concession remains.

## Phase 10: Unify Support-Driven Jump Physics and Presentation

### Deliverables

- One shared, actor-neutral support-to-motion-order decision for supported charge, launch/airborne,
  and grounded recovery. The decision consumes authoritative contact plus accepted jump lifecycle
  state and produces semantic `Ready`, `Falling`, or current grounded movement once.
- Local playable motion-runtime integration that commits `Falling` with the accepted physical
  launch and reapplies current interpreted movement when support returns.
- Remote grounded-body launch admission that converts the fresh authoritative airborne vector into
  solver actuation instead of dropping it, without creating a parallel remote jump controller.
- Remote motion-runtime integration that presents `Falling` from the same runtime support state and
  returns to the server-authored current movement on landing.
- Removal or narrowing of duplicated Explorer-only jump-presentation selection where the shared
  decision can replace it without importing Explorer capability/fallback policy into client core.

### Task Checklist

- [x] Model the support/presentation decision as a small typed value rather than independent
      booleans or renderer-facing jump state.
- [x] Resolve motion-table capability once per actor/style and preserve Explorer's documented
      fallback when `Ready` or `Falling` is absent; playable players must fail loudly if their
      required standard presentation cannot be resolved.
- [x] Make local launch acceptance atomically commit physical launch and airborne presentation so
      a rejected launch changes neither.
- [x] Detect the remote support-to-airborne launch transition from accepted authoritative body
      facts and feed the retained vector through grounded-body launch actuation exactly once.
- [x] Ensure repeated `VectorUpdate`, `UpdateMotion(Invalid)`, and position confirmations cannot
      relaunch an already-airborne remote or erase its gravity-integrated velocity.
- [x] Reapply current interpreted motion on local and remote airborne-to-grounded transitions; do
      not invent a hard-coded landing clip outside the motion table.
- [x] Keep airborne turn eligibility and the completed server-controlled MoveTo/TurnTo rules
      unchanged.
- [x] Sweep names and comments that imply physical continuity also proves animation continuity.

### Acceptance Criteria

- An accepted local jump selects `Falling` on the same fixed tick that commits `GroundedLaunch` and
  returns to the correct idle/locomotion order after landing.
- A rejected local jump changes neither physical state nor the playing clip.
- A remote ACE-shaped `UpdateMotion(Invalid)` plus `VectorUpdate` produces one ballistic launch
  with horizontal and vertical velocity, gravity, collision, and a later grounded transition.
- Local and remote airborne bodies present `Falling`; landing restores the current server/local
  interpreted movement without a renderer-derived state or separate jump state machine.
- Repeated or reordered authoritative samples do not double-launch, pin a remote to terrain, or
  restart an unchanged clip.
- Explorer possession retains its target-capability fallback and uses the shared semantic decision
  wherever its policy is isomorphic.

### Decisions and Course Corrections

- Opened from post-implementation feedback on 2026-08-29. The prior implementation verified local
  pose continuity but did not assert selected animation IDs or observer-visible remote trajectory.
- This is an authority and motion-runtime realignment, not a renderer patch. The renderer already
  consumes the world-owned playing clip correctly.
- ACE supplies remote launch evidence as a vector update rather than a distinct observer jump
  event. The implementation must classify the support transition at the existing authoritative
  body boundary and must not introduce an ACE-only wire variant.
- `CharacterMotionPresentation` is the shared actor-neutral support decision. The world motion
  runtime applies it to an existing order, while Explorer retains only its census-backed
  missing-row fallback policy.
- Support reconciliation occurs after the physical commit with a zero-duration motion-runtime
  selection. This changes presentation without advancing the animation cursor or integrating a
  second slice of movement.
- A fresh remote vector is admitted by exact instance sequence and strictly newer wrapping vector
  sequence. `Grounded` plus positive retained authoritative Z is the one-shot conversion edge into
  `GroundedLaunch`; the committed `Airborne` contact prevents ordinary later ticks from relaunching
  it, so no temporal jump flag or parallel remote controller was introduced.
- Standard playable `Ready` and `Falling` rows are required and fail loudly when absent. Generic
  remote content remains unmodelled when its table lacks a requested command, and Explorer keeps
  its documented target-capability fallback; these are existing content policies rather than
  silent player fallbacks.
- Completed 2026-08-29. Current-tree verification: core 300, world 497, and host 248 library tests
  pass. Focused coverage proves same-tick local `Falling`, remote horizontal-plus-vertical launch,
  gravity decay, duplicate-vector rejection, landing recovery, missing playable-row failure, and
  unchanged Explorer fallback. No Phase 10 concession or debt remains; actual animation identity
  and live observer evidence deliberately remain Phase 11 gates.

## Resteering Gate: Jump Presentation and Observer Authority Audit

Before verification, inspect the Phase 10 diff and dry-run stationary charge, moving charge,
rejection, local launch, remote launch, repeated vectors, airborne turn, explicit correction,
landing into idle, and landing into held locomotion. Confirm that physics and presentation consume
one support disposition, that each derived field has one named consumer, and that no Explorer or
renderer policy leaked into shared authority layers. Split Phase 10 before proceeding if remote
vector freshness and one-shot launch admission cannot be expressed without hidden temporal flags.

Completed 2026-08-29. The dry-run covered stationary and moving charge, rejected and accepted local
launches, remote launch plus duplicate vector admission, airborne turn and MoveTo/TurnTo behavior,
and idle/held-locomotion recovery. Physics and presentation consume the same committed contact;
remote sequence freshness and launch admission require no hidden temporal field. No renderer policy
entered shared crates, and no split or user decision was required.

## Phase 11: Clip-Specific Differential Verification and Cleanup

### Deliverables

- Focused world/core tests for support-edge presentation selection and remote vector-to-launch
  admission.
- Motion-table-backed tests that assert semantic commands and resolved animation IDs through local
  and remote takeoff, airborne travel, and landing.
- Live two-client observer evidence against local ACE proving that one client sees the other leave
  terrain and play the airborne/landing transition sequence. Prefer automated telemetry; an
  explicit user-accepted manual observation may substitute when the second actor is a retail GUI.
- Updated durable movement/architecture documentation describing support-owned presentation and
  authoritative remote launch admission.
- Final formatting, lint, warning, sLOC, vocabulary, and dead-seam audit.

### Task Checklist

- [x] Add unit coverage for the support-to-motion-order decision, including missing motion-table
      rows and Explorer fallback disposition.
- [x] Add fixed-tick local tests that assert playing clip identity alongside contact, pose, and
      retained velocity; cover stationary/moving launch, rejection, the airborne jump clip, the
      motion-table-authored landing transition, and idle/locomotion recovery. This is a regression
      gate for the reported defect where the possessed character remains in its idle animation for
      the entire jump.
- [x] Add encoded remote-message tests for ACE's `UpdateMotion(Invalid)` plus `VectorUpdate`,
      repeated samples, stale samples, explicit corrections, ballistic integration, and landing.
- [x] Assert remote playing clip identity independently from trajectory so neither outcome can
      masquerade as evidence for the other. The test must fail if an observed player merely applies
      horizontal displacement while remaining terrain-constrained, matching the reported
      ground-sliding defect.
- [x] Correct the live autonomous-self style-zero sentinel and `Ready` command constant; verify
      local charge, accepted launch, ballistic travel, landing, and grounded clip recovery against
      the local ACE server and real motion-table content.
- [x] Record live two-client observer evidence without creating a second credential or login path.
      The user manually verified remote translation/stop and the complete jump/landing animation
      lifecycle using the already-running distinct-account retail actor; accepting manual evidence
      instead of automated telemetry is the explicit concession recorded below.
- [x] Update `docs/movement.md` and affected architecture docs with retail and ACE citations.
- [x] Delete temporary diagnostics and sweep obsolete vocabulary, duplicate presentation logic,
      unused fields, and hollow compatibility paths.
- [x] Run formatting, TypeScript/Svelte checks, ESLint, dead-code analysis, relevant Rust/TypeScript
      suites, and Clippy with warnings denied.

### Acceptance Criteria

- Deterministic tests independently prove physical arc, `Falling` presentation, and grounded
  presentation recovery for both local and remote actors.
- Live observer evidence shows positive remote height above support, airborne jump playback, and
  restored idle/locomotion playback after landing; deterministic fixed-tick coverage independently
  records contact and nonzero vertical velocity.
- No acceptance claim uses camera/entity pose continuity as a substitute for clip identity.
- No renderer-owned contact inference, hard-coded animation ID, duplicate jump controller, or
  server-family protocol branch survives.
- All touched code is formatted, lint-clean, warning-free, and documented at its authority seam.

### Decisions and Course Corrections

- User-observed regressions added 2026-08-29: remote players visibly slide across terrain instead
  of entering the ballistic controller path, while the possessed player remains in idle and plays
  neither the airborne nor landing transition. These are separate authority/presentation gates:
  remote trajectory must be proven from contact, height, and velocity, while local and remote
  animation must be proven from semantic order and resolved clip identity.
- A landing requirement does not authorize a hard-coded landing animation. The expected transition
  must be selected by the motion table when support returns, then recover the current idle or
  locomotion order.
- Deterministic clip coverage uses an assembled motion table with distinct fixture-only IDs for
  stand/`Ready`, run, takeoff, `Falling`, and landing. Retail motion keys intentionally make Stand
  (`0x45000003`) and Ready (`0x41000003`) share the same style row, so inventing separate fixture
  clips would test a table shape retail cannot express. Physical expectations remain explicit and
  separately asserted; production never sees or selects a test animation ID.
- Local and remote takeoff need not expose the same first clip. A stationary local release may
  resolve directly to the `Falling` cycle, while a running actor can first play the table-authored
  run-to-`Falling` link. Tests follow the authored sequence and require eventual airborne
  `Falling`, rather than inventing a universal hard-coded takeoff clip.
- Completed deterministic presentation matrix 2026-08-29. Focused local and remote fixed-tick
  tests pass with semantic state and animation ID asserted independently from contact, height, and
  retained velocity. No concession or cleanup debt was introduced; encoded message and live ACE
  observer evidence remain open.
- Completed encoded remote matrix 2026-08-29. Test messages cross protocol pack/unpack before world
  routing. Exact-instance/newer-vector admission rejects duplicates, stale samples, and a
  wrong-instance future sequence without mutating gravity-integrated velocity; a second launch is
  then cancelled by an encoded newer teleport correction.
- Explicit correction clears pose-dependent kinematics immediately, while runtime contact remains
  a collision-solver product and is reclassified on the following tick. The regression gate
  therefore requires corrected pose plus cleared upward launch immediately, then grounded support
  without relaunch on the next solve; no correction-only contact override was added.
- Blocked at the live observer gate on 2026-08-30. The checked-in `.dev.env` supplies one
  account/password pair, and ACE refuses two simultaneous sessions for one account under both
  values of `account_login_boots_in_use`: it either rejects the newcomer or terminates the existing
  session and still rejects the newcomer
  (`ACE/Source/ACE.Server/Network/Handlers/AuthenticationHandler.cs:156-193`). The existing probe
  can prove local trajectory and local clip identity, but that actor never traverses Holtburger's
  remote-entity controller; treating it as observer evidence would leave the reported ground-slide
  regression unverified.
- Revalidated after the Phase 12 realignment and gates: the running local ACE instance is available,
  `apps/holtburger-3d/.dev.env` still exposes only `ACCOUNT` and `PASSWORD`, and the existing
  redacting probe still accepts one client identity. No observer credential or authorized
  multi-session diagnostic path has appeared, so the same live-observer blocker remains.
- A subsequent process-level audit found a retail client already connected to local ACE under an
  account distinct from the probe account. This supplies the missing second identity without
  exposing or creating credentials, but it does not supply an automated actor: the repository has
  no authorized path to command that running retail GUI. The remaining choice is therefore whether
  the user will drive one retail jump while Holtburger records the remote actor, or authorize a
  narrowly scoped input automation; absent either, the original second-account/server-diagnostic/
  evidence-concession choices still apply. No input was sent to the retail client.
- User manual verification after the Phase 12 cutover confirms observed players translate with
  their locomotion animation, stop instead of continuing to run in place, leave support during a
  jump, play the airborne animation, land, and recover idle/locomotion presentation. This closes
  both reported remote lifecycle regressions and independently corroborates deterministic
  trajectory, clip-identity, and empty-update retirement coverage.
- The user explicitly accepted direct manual observation of the already-running distinct-account
  retail actor in place of automated observer telemetry. This is a verification concession, not a
  production behavior concession: no second credential, ACE modification, GUI input automation,
  debug-only product field, or parallel observer controller was added. Deterministic tests remain
  the reproducible contact/velocity/semantic evidence; manual observation supplies the final
  end-user-visible remote arc and animation check.
- Phases 10–12 and their resteering audits are complete. Durable documentation and cleanup gates
  are closed; no temporary observer diagnostics were introduced.
- Current-tree gates on 2026-08-30: all 248 host, 302 core, 502 world, and 268 protocol tests pass;
  Clippy passes with warnings denied for all four packages; Svelte/TypeScript checks, ESLint, Knip,
  Prettier, `cargo fmt --check`, and `git diff --check` pass. The full Vitest run passes 1,685 of
  1,687 tests; the two failures are the pre-existing viewer-light falloff expectations explicitly
  excluded by this plan, and neither touches movement, animation, or the jump UI.
- Final footprint audit: the tracked feature diff is +5,658/-858 lines across 65 files, plus the
  84-line `ClientJumpPowerBar.svelte`; the 1,517-line plan is temporary working documentation, not
  product code. The largest apparent growth is proof rather than another runtime: 1,854 additions
  in `client/mod.rs` land predominantly below its test-module boundary, the dedicated movement
  system test file adds 432 lines, and reducer/differential coverage accounts for the other large
  blocks. Production growth is carried by named protocol, controller, capability, retained-motion,
  solver-adapter, host-contract, and UI consumers. The final vocabulary sweep finds no surviving
  optional network-motion stop sentinel or duplicate local/remote solver. No feature follow-up debt
  remains; the unrelated viewer-light expectations and pre-existing CLI `AppEvent` large-enum
  Clippy warning remain explicitly outside this plan.

## Resteering Gate: Retained Actor Motion Authority

Before returning to the live observer gate, dry-run the complete remote lifecycle through start,
same-style replacement, empty-field stop, airborne support override, landing, explicit correction,
duplicate/stale packet, entity replacement, and removal. Confirm that each transition has one
authority owner and one projection path, and that no fix depends on clip duration, renderer contact,
or a temporal jump flag. Inspect the resulting diff for duplicated local/remote solvers: source
adapters may differ, but stance retention, support presentation, motion-table selection, sequence
advancement, root actuation, and projected clip identity must converge on existing shared types.

If an explicit stop cannot be represented without retaining an `Option<EntityMotionSnapshot>`
sentinel convention, stop and redesign the state type before execution. The cutover must make
uninitialized authority and an initialized idle order distinct by construction.

## Phase 12: Unify Retained Entity Motion State and Solver Input

### Architecture Realignment Contract

This phase realigns the complete actor-motion lifecycle, not only remote jump playback. The target
is a pipeline with source-specific authority adapters and shared downstream mechanics:

```text
local semantic input          admitted network movement
         |                              |
local control authority       retained entity motion authority
         +--------------+---------------+
                        |
            grounded-order adapter
                        |
        authoritative support resolution
                        |
       motion-table runtime and root motion
                        |
        physical solver and body commitment
                        |
         pose/playing-clip projection
```

The local and remote authority owners deliberately remain different because they ingest different
facts and obey different freshness rules. Everything after conversion to a grounded order must be
shared. No all-purpose mutable `EntityController` is introduced: retained intent, support-derived
presentation, animation sequence lifetime, physical state, and render projection keep distinct
owners connected by typed values.

The lifecycle contract covers initial state, held locomotion, same-style command replacement,
explicit stop, takeoff, airborne override, landing, correction, duplicate/stale input, entity
replacement, and removal. Each admitted authority transition must deterministically select the
next semantic motion order. The motion runtime—not a renderer timer or packet heuristic—owns clip
start, continuation, authored transition completion, and return to the current supported order.
The solver consumes only committed root motion and launch/correction products; the renderer
consumes only the resulting pose and playing-clip projection. Remote actors omit only the local
input adapter, not a separate controller, solver, or animation-lifecycle path.

### Deliverables

- A retained per-entity network-motion state in `holtburger-world` that distinguishes uninitialized
  authority from an initialized idle order. The entity's existing physics timestamp pack remains
  the single owner of instance, movement, and server-control timestamps; network motion owns the
  stopped-or-ordered locomotion channels and directive.
- One pure movement-event reducer that admits a retail-current packet and produces the complete
  successor state. An omitted interpreted style selects retail's NonCombat default; absent
  forward/sidestep/turn fields clear those channels; directives preserve interpreted movement and
  apply a supplied outer style according to retail movement semantics.
- One shared actor-motion resolution boundary that consumes the source-owned grounded order plus
  authoritative support and yields the existing `MotionOrder`. Local `CharacterMotionController`
  and remote retained network state remain different input adapters, but both feed the same
  support presentation, `MotionRuntimeRegistry`, authored-root actuation, and physical solver.
- A clean cutover from `Option<EntityMotionSnapshot>` as a stop signal. No compatibility shim,
  animation timeout, renderer fallback, or duplicated remote jump/locomotion controller remains.
- End-to-end projection coverage proving clip-only state changes travel through the existing
  path-stable dynamic-entity tick update without visual reconstruction or placement mutation.

### Task Checklist

- [x] Inventory every producer and consumer of `EntityMotionSnapshot`, `motion_snapshot`, remote
      movement timestamps, `MotionOrder::from_snapshot`, support reconciliation, and dynamic clip
      projection. Classify each field as wire evidence, retained authority, derived order, playback
      state, physical result, or presentation projection before changing types.
- [x] Replace the whole-state optional sentinel with a composite state whose type distinguishes
      `Uninitialized` from `Initialized { grounded_order, ... }`; remove any `None` branch that can
      silently preserve a previously running cyclic clip after an admitted stop.
- [x] Add a stateless reducer for `MovementEventData`. Admit only the current object instance and a
      strictly newer wrapping movement sequence, enforce retail server-control ordering, and make
      the admitted successor state the single fact consumed by playback and body projection.
- [x] Encode field semantics explicitly: an omitted interpreted style selects NonCombat; absent
      locomotion channels stop; speed without its command cannot survive; directives retain the
      interpreted state to which retail later returns.
- [x] Keep command-list data in the lossless packet value without adding it to retained movement.
      Retail consumes these sequence-checked actions immediately and does not copy them into the
      interpreted state; action execution remains explicitly outside this phase.
- [x] Refactor bulk remote advancement and support reconciliation to read the initialized retained
      order. Grounded idle must actively select the stance default; airborne/sliding support may
      replace planar presentation with `Falling`; landing must restore the retained idle or held
      locomotion order even when the latest wire packet omitted style and every channel.
- [x] Keep local control policy in `holtburger-core`, but route its already-resolved order through
      the same support-to-runtime and runtime-to-solver seams. Delete isomorphic local/remote
      presentation selection exposed by the cutover rather than wrapping both paths in a new god
      object.
- [x] Trace the complete actor lifecycle across authority admission, support changes, motion-table
      sequence completion, root actuation, body commitment, and clip projection. Assign one owner
      to each transition and remove any remote-only continuation rule that can leave a cyclic clip
      or airborne presentation alive after its retained order or support has changed.
- [x] Add reducer tests for initial style, omitted style, run-to-stop, strafe/turn release,
      same-style replacement, wrapping sequence freshness, wrong instance, stale server control,
      duplicate delivery, and entity generation replacement.
- [x] Add fixed-tick tests proving `run -> stop -> authored transition -> stand`, with root
      translation ending when the stop is admitted and the projected clip update arriving even
      though placement is unchanged.
- [x] Add remote jump tests beginning from a style-zero/empty grounded order: vector launch selects
      takeoff/`Falling`, collision lands the body, landing selects the authored grounded transition,
      and stand resumes without another movement packet.
- [x] Retain moving-jump coverage proving landing restores the latest admitted locomotion order,
      while an airborne stop changes the retained landing destination without rewriting committed
      ballistic velocity.
- [x] Sweep the obsolete snapshot/clear/absence vocabulary, tests that assert `None` as a stop,
      duplicate sequence fields, and comments claiming cursor lifetime may outlive initialized
      authority without an explicit order.
- [x] Update `docs/movement.md` and architecture docs with the final source-adapter -> retained
      authority -> support resolver -> motion runtime -> physical solver/projection flow.
- [x] Cut the CLI view cache over to `EntityNetworkMotion` after the shared event-contract sweep
      exposed it as an omitted downstream consumer. Its spatial sample derives an optional order at
      the projection boundary; no CLI-owned `None`-as-stop convention remains.
- [x] Run the deterministic local/remote matrices, protocol/world/core/host/frontend suites,
      formatting, lint, dead-code analysis, Clippy with warnings denied, and the real-DAT motion
      contract probe before reopening live observer verification.

### Acceptance Criteria

- An admitted empty-field remote movement update cannot mean “leave the previous motion running.”
  It selects retail's NonCombat replacement-state default, clears held channels, stops authored root
  translation, and reaches the table-authored grounded default/transition.
- A remote body that lands with no populated motion channels always leaves `Falling`; it transitions
  through authored landing content when available and reaches the retained/default grounded cycle.
- A remote body that lands after a newer held locomotion update restores that order; an airborne
  stop restores idle without modifying the committed ballistic vector.
- Stale, duplicate, wrong-instance, or stale-server-control movement updates cannot restart a clip,
  resurrect stopped root motion, or replace a newer landing destination.
- Local and remote actors use different authority adapters but the same support resolver, motion
  sequence runtime, authored-root actuation boundary, physical solver, and playing-clip projection.
- Remote actors differ from the possessed actor only at the authority-input boundary. After a
  grounded order is produced, start, replace, stop, takeoff, airborne continuation, landing, and
  clip completion use the same lifecycle contracts and ownership boundaries.
- Clip-only transitions publish through path-stable tick updates and the renderer remains a pure
  consumer with no timeout or inferred landing state.
- No whole-state optional sentinel, second remote jump controller, hard-coded animation ID, or
  frontend motion policy survives the cutover.

### Decisions and Course Corrections

- Opened from live remote-motion feedback on 2026-08-30. The reported running-in-place and
  never-ending jump share one deterministic state-lifetime defect and are one realignment, not two
  animation fixes.
- A monolithic entity controller is not required. `holtburger-world` owns retained authoritative
  entity motion and shared resolution; `holtburger-core` owns the local input/network orchestration
  adapters; `MotionRuntimeRegistry` continues to own playback cursor state; the spatial scene owns
  collision and committed body state; the frontend consumes projected pose and clip levels.
- The existing `MotionOrder`, `CharacterMotionPresentation`, motion-table runtime, physical solver,
  and dynamic-entity projection are convergence points to preserve. The lossy optional remote input
  contract and missing movement-sequence admission are the seams to replace.
- Retail evidence corrected two proposed fields before they became debt. Object-instance and
  server-control timestamps remain in the entity's existing shared physics timestamp pack rather
  than being duplicated in `EntityNetworkMotion`; the missing movement timestamp now uses that same
  pack. Command-list items remain transient packet facts because retail sequence-checks and executes
  them immediately instead of retaining them in interpreted movement state.
- `EntityNetworkMotion::{Uninitialized, Initialized}` is the clean authority cutover. Solver-facing
  `Option<EntityMotionSnapshot>` remains only as a derived projection for bodies that genuinely
  have no admitted order; it is no longer writable authoritative state or an explicit-stop signal.
- Omitted interpreted style resolves to NonCombat, not the prior stance. That follows retail's
  concrete `InterpretedMotionState::UnPack` defaults and supersedes the earlier ACE-only inference;
  MoveTo/TurnTo still retain their prior interpreted state because retail routes them through a
  directive manager rather than `move_to_interpreted_state`.
- The first shared-package test run observed one extra asynchronous collision preparation in
  `vector_demand_promotes_and_demotes_with_no_content_reload`. The exact test then passed in
  isolation and the complete 302-test core suite passed on rerun without a code change. This is
  recorded as a non-reproducing suite-concurrency observation, not hidden as a motion fix or used
  to weaken the gate.
- The shared-event vocabulary sweep found the TUI cache still consuming the deleted optional
  snapshot contract. It now retains `EntityNetworkMotion`, and all 358 library plus 16 binary CLI
  tests pass without running the interactive client. Warnings-denied CLI Clippy additionally
  exposes the pre-existing `AppEvent::ReceivedViewEvent(ClientViewEvent)` large-enum warning in
  untouched `apps/holtburger-cli/src/types.rs`; boxing the application event is a separate queue
  layout refactor and is not required by this 3D-client plan. Required protocol/world/core/host
  all-target Clippy remains clean.
- Phase 12 validation completed 2026-08-30: protocol 268, world 502, core 302, and host 248 tests
  pass; the real-DAT probe projects 436 motion tables/18,451 cycles and resolves standard Ready to
  `0x03000001` and Falling to `0x030004A9`. Svelte/TypeScript checks, ESLint, Knip, Prettier,
  `cargo fmt --check`, `git diff --check`, and warnings-denied protocol/world/core/host Clippy pass.
  Vitest remains at the established 1,685/1,687 baseline, with only the two unrelated viewer-light
  falloff expectations failing.
- Phase 11 live observer verification is deferred until this phase completes; otherwise the harness
  would merely reconfirm a known stale-authority defect.

## Resteering Gate: Entity-Generic Authored Motion

Before implementation, revalidate these boundaries against the current tree:

- Network admission owns freshness and source-specific decoding; it does not choose clips or move
  bodies.
- `holtburger-world` owns retained entity motion, effective motion-table capability, directive
  reduction, motion-table selection, and the stateful sequence runtime.
- `holtburger-core` orchestrates local/network authority adapters and fixed-tick transactions; it
  does not grow a second MoveTo or action-animation solver.
- The spatial solver consumes one authored root offset plus explicit authority corrections. The
  renderer consumes the runtime's playing clip and never infers walk, attack, or completion from
  displacement.
- Creature type is not present in any motion-fidelity decision. Any content-specific inability to
  resolve a command is an explicit diagnostic carrying entity, motion-table, style, and command.

If implementation requires a player-only or creature-only playback branch after authority
normalization, stop and reopen the architecture. Different wire producers are expected; different
motion semantics for the same resolved order are not.

## Phase 13: Correct Command Identity and Motion-Table Selection

### Deliverables

- One exhaustive interpreted-index expansion owned by the protocol/world semantic boundary.
- Destination-style-correct motion-table selection.
- One effective entity motion-table source projected consistently to runtime and frontend.
- Explicit diagnostics for admitted but unmodelled commands instead of silent idle substitution.

### Task Checklist

- [x] Introduce a typed, total expansion for retail interpreted command indices `0..411` using the
      compact representation best supported by the 66-run census. Preserve an unknown raw index
      losslessly, but require an explicit unsupported result before playback.
- [x] Add exhaustive parity coverage for all 412 retail entries and command classes. Keep the
      expected mapping checked in and reviewable; do not derive test expectations with the same
      implementation under test.
- [x] Evolve `MotionOrder` construction so every modelled retained substate command can survive
      admission. Keep locomotion classification as a separate decision consumed by physics; do not
      encode “not locomotion” as “no command.”
- [x] Correct style selection to query the destination style's default substate, route out of the
      source style as authored, and enter the destination default. Add a synthetic table whose
      styles deliberately have different defaults so the test cannot inherit the DAT coincidence.
- [x] Preserve the full-DAT census result in test/documentation context: 284 tables have multiple
      styles and zero currently have distinct style defaults. Do not add a retail divergence marker;
      the code correction is unobservable to current content but matches retail semantics.
- [x] Replace frontend projection of direct `mtable_id` with the world-resolved effective motion
      table ID, including setup fallback. Compute it once in the producer contract; runtime and
      renderer must not perform independent fallback queries.
- [x] Add focused coverage for direct table, setup fallback, absent capability, unknown interpreted
      index, action-class index, ordinary substate, and destination-style transition.

### Acceptance Criteria

- Every retail interpreted index expands deterministically to its exact raw command, and no known
  combat/stance/action command silently becomes idle because it was outside the old seven-command
  locomotion subset.
- A distinct-default synthetic table proves the selector enters the destination style's own
  default, while the real-DAT probe remains green across all 436 tables.
- For every entity, playback resolution and `DynamicEntityView.motion_table_did` name the same
  effective table, including all 39 setup-fallback creature templates in the ACE census.
- This phase changes command identity and selection only; it does not yet invent action queue state
  or alter MoveTo body integration.

### Decisions and Course Corrections

- The retail table is exact finite data, not a heuristic namespace parser. A compact range table is
  acceptable only with exhaustive independent parity coverage.
- Current DAT defaults masking the style-selector defect is evidence about blast radius, not a
  reason to preserve the wrong lookup.
- Completed 2026-08-30. `MotionCommand::from_interpreted` now expands the exact retail table as 66
  reviewed prefix runs; an independent 412-entry expected-prefix fixture proves every result and
  keeps values above index 411 explicitly unsupported without narrowing the lossless wire wrapper.
- `MotionOrder` now retains ordinary and action-class interpreted commands outside the former
  seven-command subset. Unsupported wire indices are reported once at fresh movement admission;
  table-specific selection failures are reported once per changed rejected channel by the runtime,
  with entity, table, style, channel, and command context.
- Style selection now separates source and destination defaults. The distinct-default synthetic
  regression proves the retail lookup even though the measured DAT population cannot observe the
  difference today.
- `WorldState::effective_motion_table_id_for_guid` is the single direct-property/setup-fallback
  decision consumed by client projection. Focused direct and fallback tests pass; the existing
  missing-capability failures remain explicit.
- Verification: all 503 world tests and 303 core tests pass; warnings-denied world/core all-target
  Clippy and `git diff --check` pass. The real-DAT acceptance harness projects all 436 tables,
  18,451 cycles, and 57 setup defaults successfully.

## Phase 14: Retain and Resolve Server-Directed Motion

### Deliverables

- Lossless composite directive variants carrying exactly the target and movement parameters retail
  consumes.
- A pure entity-generic directive reducer that produces ordinary motion orders and explicit
  completion/progress facts.
- Shared local-self and remote-entity use of that reducer without moving frontend policy into
  `holtburger-world`.

### Task Checklist

- [x] Replace the bare MoveTo/TurnTo directive tag with typed variants whose interdependent fields
      cannot form invalid combinations: target position or target entity, target radius/distance,
      heading policy, movement flags, walk/run threshold, run rate, speed, and admission metadata
      actually present on the wire.
- [x] Preserve target identity separately from sampled target pose. Object targets must be
      re-sampled from authoritative world state; position targets remain fixed. Define explicit
      behavior for a missing/despawned object target from ACE/retail evidence already used by the
      existing server-controlled system.
- [x] Implement a small stateless reducer from directive, current pose, sampled target pose,
      support, and motion capability to a resolved `MotionOrder` plus typed pending/completed/failed
      result. Compute distance, desired heading, gait, and progress once in this owner.
- [x] Match retail walk/run choice and auxiliary-turn thresholds. TurnTo completion is heading-owned;
      MoveTo completion is target/progress-owned and cannot be inferred from distance while
      unsupported.
- [x] Preserve Phase 8 airborne semantics: command ownership and heading begin immediately,
      translation and progress pause without support, and landing resumes the retained directive
      without replacing ballistic velocity.
- [x] Adapt local self `MovementSystem::ServerControlledMotion` and remote entity directives to the
      same reducer. Delete duplicate target-velocity, keep-heading, forced-grounded, or completion
      calculations made redundant by the cutover.
- [x] Add unit matrices for position/object targets, walk/run threshold boundaries, moving-away
      recovery, heading correction, TurnTo, missing target, airborne receipt, target crossing while
      airborne, landing resumption, and completion.

### Acceptance Criteria

- A grounded creature MoveTo produces the same semantic walk/run and turn order a player or local
  server-controlled actor would produce from equivalent facts.
- Directive reduction is entity-kind agnostic and deterministic; it does not touch the renderer,
  mutate a body, or select an animation clip directly.
- Every reducer output carries the facts the next layer consumes. No consumer re-derives gait,
  desired heading, completion, or target tolerance with `??` fallbacks.
- Existing autonomous navigation and TUI policy remain unchanged except where they already consume
  the shared server-controlled result.

### Decisions and Course Corrections

- The reusable primitive is a pure directive-to-order reducer, not a mutable `EntityController`.
  Authority retention, motion runtime cursors, and physical bodies already have correct distinct
  owners.
- Target sampling stays outside the reducer through dependency injection, keeping object lookup and
  disappearance deterministic in tests.
- Completed 2026-08-30. `EntityMotionDirective` now retains exact finite target/parameter scalars
  plus the outer object-instance, movement, and server-control sequences and autonomous
  classification. Admission identity deliberately participates in equality so a fresh
  byte-identical command restarts instead of inheriting a terminal marker.
- Object lookup follows the evidenced retail split: a missing object at admission becomes the
  packet position/heading fallback; an object resolved at admission remains tracked and fails
  explicitly if it later disappears. Target pose and use radius are sampled by `WorldState`, not
  hidden inside the reducer.
- Retail headings remain degrees in the retained contract and are converted exactly once by the
  reducer. This replaced the former local velocity/heading approximation and the remote packet-time
  pose snap, both of which had passed degree values into radian APIs.
- The reducer is opaque state-in/state-out and produces only ordinary support-aware `MotionOrder`
  values. Its seven focused tests cover initial/auxiliary turning, strict walk/run thresholding,
  moving away, object disappearance, degree conversion, airborne retention, target crossing, and
  grounded completion. The expanded matrix caught and fixed an initial-node airborne completion
  bug; MoveTo progress now remains pending until support returns.

## Phase 15: Cut Directives Through the Shared Runtime and Solver

### Deliverables

- Removal of every blanket directive skip in authored playback and authored-root projection.
- One resolved-order-to-sequence-to-root path for local, remote player, and creature motion.
- Explicit reconciliation rules that prevent authored root motion and authoritative placement from
  double-integrating the body.

### Task Checklist

- [x] Feed each active directive reducer result into the existing support-aware `MotionOrder`
      pipeline before `MotionRuntimeRegistry` advancement. Do not create a directive-only clip
      player or hard-code walk/run animation IDs.
- [x] Delete `directive.is_some()` early returns from bulk advancement, support reconciliation, and
      `resolve_authored_offset`. Replace them with capability/result-driven handling and loud
      producer diagnostics for genuinely unplayable commands.
- [x] Make the active sequence runtime the only owner of authored root offset. The physical solver
      consumes that offset once; network placement remains an authority correction/sample rather
      than a second continuous translation source.
- [x] Define target reconciliation against the committed body after the authored step so progress
      and stopping decisions observe the same pose the renderer will project. Retain existing
      teleport/force-position authority behavior.
- [x] Verify replacement and retirement: directive change routes through authored transitions,
      completion returns to the retained interpreted stance/substate, and stop ends both root motion
      and cyclic presentation without a later packet.
- [x] Add fixed-tick differential tests comparing equivalent local, remote-player, and creature
      orders; assertions must cover semantic command, clip identity, authored offset, committed pose,
      and completion independently.
- [x] Extend the noninteractive ACE harness with a passive creature observation scenario that
      records directive admission, resolved order, clip changes, displacement, and stop. Do not run
      the interactive TUI.

### Acceptance Criteria

- A creature receiving MoveTo walks or runs with an authored clip and root motion, then stops in its
  retained/default pose when the directive completes; it cannot skate through a directive skip.
- Equivalent resolved motion orders produce the same selector/runtime/solver behavior regardless of
  whether their authority source was local input, a player movement event, or a creature directive.
- The body translates exactly once per fixed tick. Tests distinguish authored integration from
  explicit server correction and fail if both apply the same motion.
- The renderer remains a pure consumer of the projected playing clip and body pose.

### Decisions and Course Corrections

- If ACE position updates prove to be continuous authoritative samples during MoveTo, reconcile
  them at the existing authority boundary; do not disable authored root motion or introduce visual
  interpolation that bypasses the solver.
- Remote directives now have one world-owned lifecycle sidecar keyed by the complete retained
  directive. Each tick reduces against the committed body pose and current target sample, advances
  the entity's existing `MotionRuntimeRegistry` cursor, and exposes that cursor's exact root offset
  to the existing body solver. Position packets continue through pose reconciliation as authority
  corrections; they do not synthesize directive velocity.
- Local server-directed motion uses the same reducer and the same world-owned authored cursor.
  `LocalDriveControl` is once again only the autonomous-navigation adapter; the deleted server
  branch no longer guesses meters-per-second, target deltas, gait, heading, or completion.
- The remote packet handler no longer directly writes TurnTo rotation. Aside from bypassing authored
  animation, that path treated retail degrees as radians. TurnTo now reaches pose, animation, and
  root effects through the same motion-table/runtime/solver path as every actor.
- A generic remote `Drudge` fixture proves Run selection, nonzero authored-root projection, and
  terminal return to the table default. Full world (508 before the admission/integration additions)
  and core (289) suites and warnings-denied world/core Clippy pass.
- The fixed-tick differential feeds equivalent MoveTo directives to a local player, remote player,
  and creature. All three select Run, contribute the same authored offset and committed endpoint,
  complete at the same target condition, and return to the same authored Stand state.
- The redacted passive ACE probe observed direct-table monsters changing clips, moving, and
  returning from actions. It intentionally does not expose a second gameplay controller or mutate
  the server to manufacture a directive; exact semantic order and root ownership remain covered by
  the deterministic differential.

## Resteering Gate: Transient Action Lifecycle

Do not start action execution until Phase 15 proves creature locomotion converges on the shared
runtime. Then inspect the final types and confirm:

- retained steady order and transient action admission are different types;
- fresh outer movement-event identity is available to edge-trigger an ACE forward-channel action;
- command-list sequence and autonomous bits remain available without re-decoding packed integers;
- the sequence runtime can report exact action completion without renderer timing or animation-ID
  special cases; and
- adding action nodes does not duplicate clip selection, authored-root extraction, or transition
  advancement already owned by the runtime.

## Phase 16: Admit and Play One-Shot Actions

### Deliverables

- Transient action admission for retail command lists and ACE action-class forward commands.
- A bounded FIFO action queue integrated into the existing motion-table selector and sequence
  runtime.
- Exact completion and return-to-latest-steady-state behavior.

### Task Checklist

- [x] Add a typed `EntityMotionAction` edge containing expanded command, speed, action sequence,
      autonomous classification, and source admission identity. Do not add it to retained
      `MotionOrder` channels.
- [x] Admit command-list actions with retail's wrapping 15-bit freshness comparison and autonomous
      filtering. Cover wrap, stale, duplicate, and mixed autonomous/non-autonomous lists.
- [x] Classify an action-class `forward_command` from a freshly admitted ACE movement event as one
      edge keyed by that event's outer movement sequence. Ensure retained ticks cannot re-enqueue it.
      Preserve ordinary substate-class forward commands as steady state.
- [x] Port the retail action branch into the existing motion-table selector: route from the current
      substate or through the style default, clear/transition cyclic content as authored, install
      the action sequence, and retain the return cycle.
- [x] Extend sequence nodes/tick results with the minimum completion metadata needed by the queue
      owner. Remove the FIFO head only on exact authored completion; never use a wall-clock timeout
      or renderer notification.
- [x] Enforce retail's six-action bound with one explicit overflow result and diagnostic. Do not
      silently discard an admitted edge.
- [x] While an action plays, allow newly admitted steady stance/locomotion to replace the return
      destination without restarting the current action. After completion, transition to the latest
      steady order.
- [x] Add selector/runtime tests for action from default, action via transition link, queued
      actions, overflow, action replacement rules, steady update during action, exact completion,
      and return to idle/movement.

### Acceptance Criteria

- A creature melee swing or spell gesture received through ACE's forward field plays once, reaches
  authored completion, and returns to the latest retained pose.
- Retail command-list actions obey their own 15-bit sequence admission and FIFO order.
- New movement while an action is active updates the return destination; it neither loops the
  action nor loses the movement state.
- The same runtime owns action clip selection, authored root effects, completion, and playing-clip
  projection. No action-only animation controller exists.

### Decisions and Course Corrections

- This phase presents actions only. Attack hooks, damage, targeting, sound, particles, and equipment
  effects are not smuggled into the queue merely because their animation can now play.
- Unknown command semantics fail at action admission with full context; they do not fall back to an
  idle cycle or poison retained steady state.
- Completed 2026-08-30. Command-list actions now use their independent wrapping 15-bit stamp and
  autonomous bit; ACE action-class forward commands become one edge keyed by the admitted outer
  movement event and are removed from retained steady channels. The same body runtime owns the
  six-entry FIFO, action selection, exact root contribution, playing-clip projection, and tagged
  completion boundary for local players, remote players, and creatures.
- A steady update is applied to the same sequence while an action owns its non-cyclic prefix. This
  reproduces retail's `remove_cyclic_anims` behavior: the latest locomotion or stance replaces the
  authored return suffix without restarting the action.
- Self `UpdateMotion` no longer passes through independent player and entity timestamp vetoes. The
  player authority adapter admits the outer packet once, then feeds both the local-control event and
  the generic body steady/action reducer. Local autonomous echoes remain filtered from the action
  FIFO, while server-authored local action root motion enters the existing local physical adapter.
- Real-DAT acceptance installs all 436 table defaults and selects 3,713 action routes from those
  defaults. Of those, 3,541 cross the exact completion marker and 172 are authored zero-rate holds;
  retail cannot synthesize `AnimationDone` for the latter, so the runtime deliberately does not add
  a timeout. No selected route was clipless. The same pass covers 18,451 cycles, 57 setup defaults,
  376 Ready routes, and 94 Falling routes.
- Verification after the cutover: all 521 world tests and 292 core tests pass, as do warnings-denied
  world/core all-target Clippy. A decoded local action fixture independently proves edge-only
  retention, action clip selection, and a nonzero authored root offset returned through the local
  adapter.

## Phase 17: Differential Verification, Live Evidence, and Cleanup

### Deliverables

- Deterministic local/player/creature differential evidence for locomotion, stance, and action
  lifecycles.
- Noninteractive live ACE evidence for representative creatures and player combat stances/actions.
- Final vocabulary cleanup and durable architecture/protocol documentation.

### Task Checklist

- [x] Run protocol, world, core, host, frontend, and focused harness suites after each cutover; treat
      Clippy warnings as errors and preserve the recorded unrelated frontend baseline honestly.
- [x] Run real-DAT contract coverage across all motion tables for style defaults, directive command
      selection, action routing, transition closure, clip coverage, and exact completion.
- [x] Use the local ACE server and `.dev.env` credentials through the existing redacted
      noninteractive harness to observe direct-table creature motion and creature action/return
      lifecycles, plus a local player SoulEmote action and combat stance/return.
- [x] Prove setup fallback with the focused projection fixture and current real-content census. The
      account's visible population contains direct-table monsters; do not spawn or teleport an
      entity merely to turn deterministic provenance evidence into a nominally live check.
- [x] Start the live creature probe from the test account's current position near a monster spawn.
      Passively record any aggro-driven MoveTo/action traffic, but do not make spontaneous movement
      a required gate: the nearby creature may aggro without choosing a translational action during
      the observation window. Fall back to deterministic fixtures or a focused harness scenario for
      required lifecycle coverage rather than weakening the assertion or running the interactive
      TUI.
- [x] Record semantic order, resolved table/style/command, clip identity, authored offset, body
      support, pose, and action queue transition separately. A visually plausible displacement is
      not sufficient evidence of correct ownership.
- [x] Verify regressions for local strafe/jump, remote player run/stop/jump/land, airborne MoveTo,
      force-position/teleport, object disappearance, and entity replacement.
- [x] Remove temporary logs, probes, fixtures that depend on untracked runtime assets, dead directive
      adapters, obsolete seven-command vocabulary, and comments claiming actions are outside the
      retained motion lifecycle.
- [x] Update `docs/movement.md`, relevant crate architecture docs, and protocol notes with the final
      authority source -> steady/action admission -> directive reducer -> sequence runtime -> root
      solver/projection flow and ACE's forward-channel action behavior.
- [x] Run formatting, lint, dead-code analysis, `git diff --check`, and the repository's relevant
      warnings-denied Clippy commands without staging or committing.

### Acceptance Criteria

- Players and creatures display and retire authored locomotion, stance, and action sequences without
  category-specific playback branches, skating, running in place, or one-shot clips looping.
- Local and remote jump behavior completed by Phases 0-12 remains unchanged.
- All effective motion-table consumers agree, all known interpreted indices are lossless, and every
  unsupported runtime command emits one actionable producer diagnostic.
- The final architecture has source-specific adapters, one directive reducer, one steady/action
  authority model, one sequence runtime, one authored-root solver seam, and one pure presentation
  projection—no patchwork controller layer.

### Decisions and Course Corrections

- The completed all-table acceptance pass covers 436 motion tables and 18,451 cycles. It selects
  3,713 action routes, reaches 3,541 exact completions, and classifies 172 authored zero-frame-rate
  holds instead of inventing a timeout retail cannot receive.
- Three passive ACE runs (15, 30, and 15 seconds) entered the world without movement commands and
  observed 24-31 entities. Representative direct-table Revenant, Tumerok, Tusker, Lugian, zombie,
  Monouga, and Shreth templates agreed with their catalog-authored table IDs.
- Live action evidence includes Tusker and Lugian loop -> hold -> loop returns. A Cunning Monouga
  additionally exercised loop -> reverse hold -> action hold -> forward hold -> loop, proving the
  authored reversed transition chain retires rather than becoming a permanent pose.
- The current `weenies.hwc` fallback population is 12 templates across eight setups, not the 39
  creature rows measured in the separately versioned local ACE database. The plan now names both
  distributions explicitly. Chicken is the only plainly living fallback template in the artifact;
  none was present in the passive live population, so direct/setup provenance is not inferred from
  the effective table projected by the frontend.
- The live probe records actor identity, WCID, setup/effective table, clip history, support, pose,
  displacement, and contacts. Semantic order, action FIFO state, and authored root contribution are
  intentionally proven at the owning world/core seams rather than adding probe-only product APIs.
- Final automated gates pass for protocol, world, core, and host; warnings-denied all-target Clippy,
  Svelte/TypeScript checks, ESLint, Knip, formatting, and `git diff --check` are clean. Vitest passes
  1,685 of 1,687 tests; the only failures are the two unrelated viewer-light falloff expectations
  already recorded under Phase 6 and left untouched.
- The chosen player evidence path is a standalone debug-harness client over the existing core API;
  no probe-only 3D host command or frontend contract was added. Its first live run proved ACE
  accepted Wave while local playback remained on idle. `execute_transient_motion_at` serialized the
  autonomous command-list edge but did not predict it into the shared runtime, while the later echo
  was correctly filtered. Local pulse construction now enqueues that same typed action and 15-bit
  stamp into the world runtime; it does not add a local-only animation mechanism.
- The corrected live run observes NonCombat idle `0x03000001` -> Wave hold `0x030000AC` -> the same
  idle loop with server confirmation. It then enters Magic's steady loop `0x0300076C` and returns to
  confirmed NonCombat. A focused core regression proves the predicted outbound edge selects the
  shared action clip, while existing admission coverage proves its autonomous echo cannot duplicate
  the queue entry.
- The local-prediction cutover exposed two stale tests whose nominal player entities had no effective
  motion table. Their fixtures now install the same explicit motion capability the production path
  requires; the product continues to fail loudly rather than sending an action it cannot present.
- Final regression reruns pass 268 protocol, 521 world, 292 core, and 248 host tests plus the focused
  harness tests. The named local/remote jump, airborne directive, correction, disappearance, and
  replacement cases remain in those suites, and the prior manual remote-player run/stop/jump/land
  observation remains the live corroboration required by the plan.
- The later admin-spawn capture supersedes Phase 17's live-creature completion inference. Phase 17
  proved constructed MoveTo locomotion/stop plus live creature table, stance, and action lifecycles;
  it did not prove that ACE supplied locomotion authority for a creature observed translating.
  Phase 19 now owns that live gate explicitly.

- Manual verification corroborates deterministic ownership evidence; it does not replace it.
- Any newly discovered hook-dependent visual effect is documented and scoped separately unless an
  existing generic hook consumer can support it without broadening this plan.

## Phase 18: Canonicalize Directed Turn Orders and Retire Authored Rotation

### Deliverables

- Retail-canonical signed turn orders from the entity-generic MoveTo/TurnTo reducer: both directions
  use canonical `TurnRight`, with direction represented by the playback-rate sign.
- Complete turn-channel retirement that removes modifier physics, returns to the retained steady
  order, and cannot continue rotating the body after the turn clip leaves presentation.
- Focused reducer, runtime, and fixed-tick regressions for right turn, left turn, auxiliary MoveTo
  correction, terminal TurnTo completion, and action playback after completion.

### Task Checklist

- [x] Change `motion::directed::turn_order` to apply retail's `adjust_motion` canonicalization once
      at the directive-to-order boundary. Do not teach the selector or `stop_motion` to guess that
      noncanonical left/right aliases form one family.
- [x] Preserve the signed rate through `MotionOrder`, modifier selection, sequence physics, and
      playing-clip rate projection. Assert the sign independently from the chosen command identity.
- [x] Add a reducer differential proving equal-magnitude left and right target deltas produce the
      same canonical command with opposite signed rates.
- [x] Add a runtime regression that starts a left directed turn, reaches the completion threshold,
      reapplies the steady order, and proves modifier state plus sequence omega/root contribution
      are zero afterward.
- [x] Add a fixed-tick regression that permits an action immediately after turn completion and
      proves the body no longer rotates while the action and return-idle clips play.
- [x] Retain right-turn, airborne heading, moving auxiliary turn, action return, and local
      strafe/jump regressions to prove the correction stays inside the shared order producer.
- [x] Run world/core suites, real-DAT acceptance, formatting, `git diff --check`, and warnings-denied
      Clippy for touched packages.

### Acceptance Criteria

- A left `TurnToObject` and equivalent right `TurnToObject` converge within the same heading
  tolerance, retire their turn contribution, and project the retained idle/action destination.
- After completion, subsequent fixed ticks contribute no authored yaw unless a new turn order is
  admitted; body rotation cannot accumulate while an unrelated attack animation plays.
- The selector/runtime receives only retail-canonical turn-family identity from the directive
  adapter. No family-wide stop heuristic or creature-only cleanup branch is introduced.
- Existing local input remains unchanged because its `character_axes` adapter already emits the
  same canonical signed representation.

### Decisions and Course Corrections

- Opened from the 2026-08-30 live capture. Stationary actors accumulated more than fifteen full
  rotations after the turn clip returned to idle, while retained physical omega was zero.
- The correction belongs in the directive reducer, where the noncanonical order is created.
  Broadening `stop_motion` would weaken exact command semantics for every caller and make malformed
  orders appear valid downstream.
- The first post-fix live pass exposed a second retail lifecycle fact: a Reaver crossed its target
  every tick and alternated canonical TurnRight at `+30/-30`. Retail retains the chosen direction,
  detects crossing, sets the target heading, and stops (`acclient.c:331826-331885`). The reducer now
  retains only that node-local direction and retires on crossing; it does not add a creature branch.

## Phase 19: Preserve Authored Heading Through MoveTo Reconciliation

### Deliverables

- A retail-correct reconciliation rule in which `keep_heading` removes authoritative interpolation
  yaw without removing the ordinary authored control heading produced by MoveTo's turn cycle.
- One isomorphic physical/pose-only reconciliation contract: translation may come from the
  authoritative interpolation lane while rotation continues to come from the ordinary authored
  motion lane.
- Deterministic and live evidence that a creature's initial MoveTo turn converges, selects the
  table-authored walk/run cycle, and later retires to its steady/action presentation.

### Task Checklist

- [x] Capture a freshly spawned creature from creation through translation and action. Correlate
      creation movement state, `MoveToObject`, position samples, selected clip, heading, and
      displacement without driving or teleporting the account.
- [x] Prove ACE supplies explicit locomotion authority. The captured Crude Monouga received
      `MoveToObject` before approximately 11 m of authoritative translation; no pose-delta gait
      inference or server-family fallback is required.
- [x] Reproduce the fault with multiple Jungle Reavers. Each translated approximately 20-21 m
      while projecting `0x03000558`, its TurnRight cycle, instead of table walk `0x030001AC` or run
      `0x030001AB`; physical heading advanced only approximately 0.075-0.093 radians during the
      translating turn phase.
- [x] Ground the ownership rule in retail. `InterpolationManager::InterpolateTo` preserves the
      object's current heading in queued targets when `keep_heading` is set, and
      `InterpolationManager::adjust_offset` zeroes only the interpolation offset heading
      (`acclient.c:371857-371996`, `372078-372092`). MoveTo's authored turn remains free to rotate
      the physics object.
- [x] Change grounded physical reconciliation so interpolation with `keep_heading` carries
      `original_heading`, interpolation without it carries authoritative heading, and ordinary
      motion continues to carry `original_heading`. Preserve translation correction and launch
      composition unchanged.
- [x] Add a focused reconciliation regression for all three heading cases. The keep-heading case
      must fail if rebuilding `GroundedBodyActuation` silently turns an authored heading into
      `None`.
- [x] Add exact combined MoveTo coverage using a fixture table whose initial turn authors omega.
      The reducer proves crossing and transition to Run, the shared local/remote/creature runtime
      test proves table selection and terminal return, and reconciliation independently proves
      authoritative translation preserves authored heading.
- [ ] Repeat the passive spawned-creature probe and require actual walk/run clip identity during
      translation, bounded heading convergence, and clean turn/locomotion retirement.
- [x] Remove temporary diagnostics and update durable movement documentation with the corrected
      reconciliation ownership rule.

### Acceptance Criteria

- `keep_heading` suppresses only authoritative interpolation rotation. It cannot suppress authored
  turn rotation or replace the ordinary solver's heading with an absent control value.
- A live creature that begins translating selects the retail-authored walk/run clip through the
  shared runtime after a bounded initial turn, and stopping translation retires locomotion through
  an admitted authority transition rather than a timer or renderer inference.
- Position reconciliation continues to own correction translation without double-integrating an
  authored movement slice or taking ownership of MoveTo's heading.
- No player/creature category branch, second motion runtime, animation-duration timeout, or
  pose-delta gait heuristic survives.

### Decisions and Course Corrections

- The admin-spawn capture disproves the earlier missing-authority premise. ACE emitted a complete
  MoveTo directive, Holtburger admitted it, and the shared runtime selected a real turn cycle. Phase
  19 therefore repairs the reconciliation consumer rather than inventing or recovering locomotion
  authority.
- `reconcile_physical_body_actuation` currently records `original_heading`, then maps
  interpolation plus `keep_heading` to `None` while rebuilding grounded actuation. The pose-only
  lane already preserves solved rotation in the equivalent case. The physical lane should retain
  `original_heading`; this is a one-branch ownership correction, not a new controller.
- Other players usually avoid the symptom because ordinary interpreted movement does not set
  MoveTo's keep-heading interpolation policy. Creatures commonly use MoveTo and therefore exercise
  the defective branch continuously during approach.
- Phase 18 remains responsible for retail's canonical signed left/right command identity. Phase 19
  is independently responsible for ensuring whichever authored turn is selected reaches the body
  pose that the directive reducer tests.

## Phase 20: Apply Retail Partial-Part Animation Overlays

### Deliverables

- Retail-compatible partial-part playback: a clip updates the prefix it authors and leaves higher
  setup parts at their current transforms instead of refusing the whole clip.
- A complete downstream `ArticulatedPose` contract produced by the animation owner, so rendering
  and effects do not acquire optional-transform branches.
- Conservative closure bounds covering the setup pose and every authored transform reachable from
  the motion table.

### Task Checklist

- [x] Remove `part-coverage` as a whole-clip refusal from `prepareMotionPlayback` and the equivalent
      default-animation preparation path.
- [x] Seed each animation record with the entity's complete setup pose, overlay only indices below
      `min(setup part count, clip part count)` on every sample, and retain uncovered transforms
      across clip changes.
- [x] Keep `DynamicPresentationSample.articulatedPose` complete; do not weaken
      `DynamicEntitySystem`'s complete-pose invariant to accommodate an incomplete producer.
- [x] Seed closure bounds with static setup bounds, then union every authored part/frame transform
      so an uncovered retained part remains conservatively visible.
- [x] Add focused transition coverage for full -> partial -> full clips and prove uncovered high
      parts retain their prior transform while covered parts advance normally.
- [x] Run frontend preparation/playback suites, type checks, build, lint, and cleanup without
      retaining census-only diagnostics.
- [ ] Run a representative affected-content presentation pass in the built client and confirm the
      former `part-coverage` warning is absent.

### Acceptance Criteria

- A setup with more parts than one reachable clip plays that clip rather than holding its previous
  idle pose, and every uncovered part retains a valid current transform.
- Bounds remain conservative through transitions involving partial clips.
- No renderer-side entity-kind branch, synthesized duplicate part, or silent missing-transform
  fallback is introduced.

### Decisions and Course Corrections

- Retail `CPartArray::UpdateParts` applies only
  `min(setup num_parts, current animation-frame num_parts)` and leaves higher parts untouched
  (`acclient.c:314107-314135`). ACE mirrors this with `Math.Min(NumParts,
curFrame.Frames.Count)` (`ACE/Source/ACE.Server/Physics/PartArray.cs:603-610`).
- Holtburger currently refuses the entire clip when any appearance part index is outside the clip's
  authored prefix. A catalog census found 3,758 of 13,992 templates with a resolved setup/motion
  table and 140 of 1,175 installed setup/table pairs reach at least one such clip.
- This defect is real but did not cause the captured Jungle Reaver or Crude Monouga skating: their
  observed locomotion/turn clips cover their complete setups. It remains separate scope because the
  earlier `part-coverage` warning is a directly observed failure and the affected population is
  material.

### Implementation Verification 2026-08-30

- The animation owner retains one complete setup-indexed pose. Every sample overlays only the
  current clip's authored prefix, and a clip replacement first folds the visually current prior
  sample into that retained pose. Downstream rendering and effects still receive a complete
  `ArticulatedPose` with no entity-category branch.
- Focused frontend preparation, owner-lifetime, bounds, scheduler, and playback coverage passes 57
  tests. The full app typecheck, ESLint, Knip, warnings-denied host Clippy, and production Vite build
  pass. Full Vitest has only the two pre-existing viewer-light falloff failures documented in Phase
  6; this implementation's suites are green.
- A full -> partial -> full regression proves the partial clip changes its covered low part, retains
  the prior high-part transform, and lets the later full clip replace both again. Bounds start with
  a cloned static setup bound and union every authored transform that exists.

## Risks and Mitigations

| Risk                                                      | Consequence                                                                                                                                      | Mitigation                                                                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACE's permissive malformed parser changes                 | A future ACE version may reject unread retail bytes or continue documenting the wrong shape                                                      | Lock Holtburger to retail/GDLE fixture evidence; treat ACE as an interoperability target and upstream/local diagnostic concern, not protocol authority                  |
| Jump attempt is resolved outside the physical transaction | Packet is sent for a rejected launch or local/remote velocity diverges                                                                           | Return one committed jump product from the local fixed-tick transaction and emit only after acceptance                                                                  |
| Manual drive and character controller both retain drive   | Standing charge suppresses one path but not animation, packet, or physics                                                                        | Cleanly cut manual semantic ownership over to one composite controller state                                                                                            |
| Position sampled after integration                        | Packet reports a point ahead of the retail release origin and invites correction                                                                 | Capture release pose before applying launch; carry it in the committed product                                                                                          |
| Skill/burden facts are unavailable during early entry     | Silent fallback creates incorrect jump height                                                                                                    | Reject explicitly until the authoritative player capability is complete; never default skill or burden                                                                  |
| Optimistic UI outruns host rejection                      | A bar remains visible for an invalid or stale charge                                                                                             | Sequence every lifecycle edge and project the originating sequence with rejection/reset feedback                                                                        |
| Charge duration changes with stance during a held charge  | Displayed and released extent disagree                                                                                                           | Apply the authoritative current profile using the existing controller's same-start duration update; cover the transition explicitly                                     |
| Generic server ingestion overwrites local prediction      | Gravity-decayed jump velocity is reset by an ordinary ACE position/vector echo                                                                   | Match retail's autonomy-level boundary: retain freshness, ignore ordinary local-player physical mutation at autonomy `2`, and honor explicit force/teleport corrections |
| Server MoveTo reuses forced-grounded navigation policy    | A server command adds planar velocity during a jump and can retire before landing                                                                | Classify server motion separately; permit heading immediately, require grounded support for translation/progress, and retain the command until landing                  |
| TurnTo shares distance-only projection completion         | A zero-distance turn retires before applying its heading                                                                                         | Give TurnTo a heading-owned completion criterion in the composite server-controlled command shape                                                                       |
| Local physics and playback commit independently           | The actor follows a correct arc while remaining in idle                                                                                          | Commit the support-derived `Falling` order with accepted launch and restore current interpreted movement on landing                                                     |
| Grounded remote actuation drops an authoritative vector   | Observers see horizontal root motion constrained to terrain instead of a ballistic jump                                                          | Admit the fresh vector as a one-shot grounded-body launch at the authoritative support boundary; cover repeats and stale samples                                        |
| Remote playback trusts only the pre-jump motion snapshot  | Corrected remote physics still plays idle or locomotion while airborne                                                                           | Derive `Falling` from the same runtime support disposition as remote physics, then resume snapshot-authored movement after landing                                      |
| Pose continuity substitutes for animation verification    | A feature is declared complete while takeoff/landing presentation is absent                                                                      | Assert semantic motion command and resolved animation ID independently from pose/contact/velocity in deterministic and observer scenarios                               |
| An empty movement update is represented as absent state   | The previous cyclic clip and authored root motion survive an explicit remote stop                                                                | Retain initialized stance separately from active channels and reduce every admitted update into a complete successor order                                              |
| A stale movement packet is admitted after a newer stop    | Retired locomotion or a superseded landing destination is resurrected                                                                            | Apply retail instance, wrapping movement-sequence, and server-control admission before mutating retained entity motion                                                  |
| Realignment grows into one mutable entity controller      | Network authority, local policy, playback, physics, and rendering acquire a new shared god object                                                | Keep source-specific adapters and converge them on the existing `MotionOrder`, support resolver, runtime, solver, and projection boundaries                             |
| Command-list facts are discarded or prematurely executed  | Future protocol consumers lose information, or unrelated action semantics enter this phase                                                       | Preserve admitted facts losslessly at the authority boundary and implement only consumers justified by this motion lifecycle                                            |
| Directive translation and authored root both move a body  | Creatures overshoot targets or move at double speed                                                                                              | Resolve one authored offset through the physical solver; treat network placement only through the existing explicit authority-correction boundary                       |
| A directive tag lacks its movement parameters             | Walk/run/turn selection is guessed or re-derived inconsistently                                                                                  | Retain one composite target/parameter variant and compute the resolved command once in the pure directive reducer                                                       |
| An action is retained as a forward level                  | Attacks and gestures restart or loop forever                                                                                                     | Convert fresh ACE action-class forward commands to edge events keyed by the admitted outer movement sequence                                                            |
| A steady update arrives during an action                  | The action restarts or returns to stale locomotion                                                                                               | Keep a bounded FIFO action queue separate from retained steady order; update the return destination without replacing the active action                                 |
| Interpreted mapping remains locomotion-only               | Combat stances and actions silently collapse to idle                                                                                             | Own all 412 retail expansions in one typed lookup with exhaustive independent parity coverage                                                                           |
| Solver and renderer resolve different motion tables       | A setup-fallback creature moves correctly but renders no matching clip                                                                           | Compute and project one effective motion-table ID at the world content boundary                                                                                         |
| Action presentation expands into combat gameplay          | The motion fix accumulates damage, targeting, hook, effect, and UI responsibilities                                                              | Scope the queue to authored sequence playback/completion; document unsupported hook consumers separately                                                                |
| Directed left turns bypass retail canonicalization        | The turn clip retires while signed authored rotation survives and spins the body indefinitely                                                    | Canonicalize direction into the `TurnRight` rate sign at the directive reducer and prove zero post-completion root contribution                                         |
| Keep-heading interpolation drops ordinary authored yaw    | MoveTo remains in its initial turn while authoritative correction translates the body, so creatures spin and skate instead of selecting walk/run | Preserve the original authored control heading when rebuilding grounded interpolation actuation; suppress only authoritative interpolation yaw, matching retail         |
| Pose displacement is treated as a gait command            | Corrections, knockback, teleports, or packet jitter manufacture false walk/run presentation                                                      | Trace creation/movement authority against retail first; repair the explicit fact or evidenced fallback, never infer gait from displacement alone                        |
| A partial-part clip is refused as an incomplete pose      | The body translates while presentation holds its prior idle pose, and valid retail content appears to skate                                      | Overlay the authored prefix onto the animation owner's complete retained pose and conservatively bound setup plus all authored transforms                               |
| UI loop schedules frame-hot Svelte work while hidden      | Unnecessary frontend overhead                                                                                                                    | Run the bar sampler only during one active charge and tear it down on every retirement edge                                                                             |
| Scope expands into combat power bars                      | The slice accumulates generic UI abstractions without another consumer                                                                           | Keep `ClientJumpPowerBar` and jump presentation state concrete; generalize only when attack charging becomes a real consumer                                            |

## Definition of Done

- [x] Z/C strafe works independently and diagonally in client mode.
- [x] Space begins, charges, releases, rejects, resets, and retires through ordered semantic edges.
- [x] Standard and dual-wield charge timing match retail.
- [x] Jump height uses current Jump skill, burden, stamina exhaustion, extent, and retail minimum.
- [x] Horizontal launch uses release-time forward/back/strafe/gait and retail diagonal limiting.
- [x] Standing charge suppresses translation and moving charge does not.
- [x] Airborne planar input cannot rewrite retained launch velocity; turning remains available.
- [x] One `ResolvedJump` supplies both local packet velocity and world physical velocity.
- [x] `0xF61B` packs extent, velocity, position, and four timestamps in retail order.
- [x] ACE live interoperability and synthetic browser behavior are verified non-interactively.
- [x] Jump-bar UI is accessible, active-only, and cleaned up on all ownership-loss paths.
- [x] Protocol, world, core, host, frontend, and harness feature tests pass.
- [x] Formatting, type checks, lint, dead-code analysis, Rust checks, and Clippy pass without ignores.
- [x] Protocol and architecture documentation record the final retail behavior and ACE divergence.
- [x] Airborne server-controlled MoveTo transfers ownership and permits heading without adding
      planar drive or replacing ballistic velocity.
- [x] MoveTo remains pending until grounded support and then resumes; airborne target crossing
      cannot complete it.
- [x] TurnTo applies while airborne and completes from heading rather than positional distance.
- [x] The server-controlled realignment passes its differential/fixed-tick matrix, relevant suites,
      formatting, and Clippy without changing autonomous/TUI navigation behavior.
- [x] Local supported charge, accepted launch, airborne travel, and landing select the retail
      `Ready`/`Falling`/current-grounded motion orders from authoritative support state.
- [x] Remote ACE-shaped jump updates produce one ballistic launch rather than terrain-constrained
      authored sliding.
- [x] Local and remote clip identities are verified independently from physical pose continuity in
      deterministic coverage and corroborated by live manual remote observation.
- [x] Landing restores the appropriate idle or held locomotion presentation without a hard-coded
      landing animation or renderer-owned contact inference.
- [x] Explorer target-capability fallback remains intact without retaining duplicate isomorphic
      support/presentation logic.
- [x] An admitted empty remote movement update retires prior locomotion and authored root motion,
      then projects the table-authored grounded transition/default without changing placement.
- [x] A remote landing leaves `Falling` and reaches the retained idle or held locomotion order
      without requiring a later movement packet.
- [x] Wrong-instance, stale, duplicate, and stale-server-control movement updates cannot resurrect
      a retired clip, root motion, or landing destination.
- [x] Local and remote authority adapters converge on the same support resolver, motion runtime,
      authored-root actuation, physical solver, and playing-clip projection without an optional
      stop sentinel or monolithic entity controller.
- [x] Phase 12 deterministic suites, real-DAT contract evidence, documentation, formatting, lint,
      dead-code analysis, and Clippy gates pass.
- [x] Phase 11 live remote-observer evidence and final cleanup gates pass after Phase 12.
- [x] Every retail interpreted command index expands losslessly, destination style selection uses
      its own default, and runtime/frontend consumers share one effective motion table.
- [x] Server MoveTo/TurnTo directives retain their target/parameter contract and reduce to ordinary
      entity-generic motion orders with retail walk/run/turn and support semantics.
- [x] No directive-specific authored-playback/root skip remains; players and creatures use the same
      sequence runtime and physical solver after authority normalization.
- [x] Command-list and ACE forward-channel actions admit as transient edges, play once through the
      existing sequence runtime, complete exactly, and return to the latest retained steady order.
- [x] Deterministic and real-DAT evidence covers constructed creature locomotion/stop and setup
      fallback; noninteractive live ACE evidence covers creature table provenance,
      stance/action/return, and the established jump regressions.
- [x] Phases 13-17 documentation, formatting, lint, dead-code analysis, and warnings-denied Clippy
      gates pass without retaining temporary diagnostics or staging changes.
- [x] Directed left and right TurnTo/MoveTo corrections use retail's canonical signed turn order,
      retire all authored yaw at completion, and cannot spin during later action/idle playback.
- [x] A live translating creature receives an explicit MoveTo authority fact; no inferred gait or
      server-family fallback is required.
- [x] Grounded keep-heading reconciliation preserves authored turn yaw, allowing MoveTo to converge
      and select walk/run through the shared runtime without a category-specific controller.
- [x] Partial-part animation clips overlay their authored prefix and preserve uncovered setup parts
      instead of being refused wholesale.
- [ ] Phases 18-20 deterministic, live, documentation, cleanup, formatting, and warnings-denied
      Clippy gates pass without retaining temporary diagnostics.

## Completed Execution Gates

Phases 0-17 are complete. Their deterministic local/remote jump, lifecycle retirement, clip
identity, real-DAT contracts, live local ACE behavior, and user-observed remote player locomotion are
the regression baseline. Phases 18-20 reopen only the newly evidenced creature turn/reconciliation
and partial-part playback gates; they do not invalidate the player/jump baseline. The unrelated pair
of viewer-light falloff expectations recorded under Phase 6 remains outside this plan and was not
altered to make this work appear green.

The structural extension completed in this order:

1. Phase 13 establishes complete command identity, correct style selection, and one effective
   motion-table source.
2. Phase 14 retains and reduces server directives without touching playback or bodies directly.
3. Phase 15 cuts those orders through the shared runtime/solver and proves creature locomotion
   before action scope opens.
4. The transient-action resteering gate rechecks the resulting ownership contracts.
5. Phase 16 admits and completes one-shot actions through that same runtime.
6. Phase 17 performs deterministic, real-DAT, live ACE, cleanup, and documentation gates.

A failed gate is evidence that the implementation or an upstream assumption needs correction; it is
not permission to introduce an ACE-shaped packet variant, renderer-owned gameplay facts, or a second
jump state machine.

The active extension proceeds in this order:

1. Phase 18 fixes the proven signed-turn canonicalization defect and closes body-rotation retirement.
2. Phase 19 preserves authored heading while retail keep-heading interpolation owns correction
   translation, allowing the existing MoveTo reducer to leave its initial turn and select walk/run.
3. Phase 20 replaces whole-clip part-coverage refusal with retail's partial-part overlay semantics.

## Open Questions

No design question remains. Two observational gates remain open: catch a fresh post-fix creature
MoveTo through turn -> walk/run -> stop in the passive probe, and exercise the formerly refused
partial-part content in the built renderer to confirm the warning is absent. The second post-fix
pass proved the prior Reaver `+30/-30` ping-pong was gone, but that Reaver did not move during the
sample. Any unsupported animation hook discovered later is newly evidenced follow-up scope, not an
implicit license to expand this plan into combat gameplay.
