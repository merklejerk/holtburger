# Holtburger Possessed-Entity Controller Surface Plan

Status: **Draft 2026-08-20.** Not started.
Origin: `holtburger-authored-root-motion-physics-integration-plan.md`, which completed authored root
motion and possession and left two things behind — a character-controller subsystem whose sole
consumer is the grounded camera, and the dissolution of the camera runtime that D13 scoped but could
not sequence there.

## Goal

Give a possessed entity the same character-controller command surface retail gives a player,
grounded in motion tables, and then retire the camera-shaped scaffolding that surface makes
redundant. Concretely: one command gap — **jump** — one safety edge possession is missing, and the
dissolution of `HostCameraRuntime` that becomes possible once a real character exists.

The phases are one sequence on purpose. Each step is what earns the next: jump makes `GroundedWalk`
redundant, retiring `GroundedWalk` leaves only a free-flight body behind, and a subsystem holding one
free-flight body is what makes the dissolution obvious rather than merely desirable.

The bar is deliberately *not* "retail parity" in the broad sense. It is the locomotion controller
surface: what a player can tell their own character to do.

## Where the surface stands

Established by reading `ACE/Source/ACE.Entity/Enum/MotionCommand.cs` and the retail decompile.

| retail command | class | possession |
| --- | --- | --- |
| `WalkForward 0x45000005` | SubState | yes |
| `WalkBackwards 0x45000006` | SubState | yes |
| `RunForward 0x44000007` | SubState | yes |
| `TurnRight 0x6500000d` / `TurnLeft 0x6500000e` | Modifier | yes |
| `SideStepRight 0x6500000f` / `SideStepLeft 0x65000010` | Modifier | yes |
| Style commands (`0x8000003c`+) | Style | yes, 7 stances |
| `JumpCharging 0x4000001d` | **SubState** | **no** |
| `Jump 0x2500003b` | **Modifier** | **no** |

Two commands. Both fall in classes `MotionOrder` already carries, which is the first reason this is
smaller than it first appeared.

**An earlier reading of this gap was wrong and is recorded so it is not repeated.** The root-motion
plan asserted that jump was an Action-class command and therefore blocked on `MotionState` having
dropped retail's action queue. It is not: `Jumpup 0x1000004b` is the Action, and nothing in the
charge-and-release sequence uses it. The action queue is still absent and still has no producer;
it is simply not what stands between us and a jump.

## What retail actually does, and why it matters here

**Jump is a separate channel from movement commands, at every layer.**

- `CM_Movement::Event_DoMovementCommand(motion, speed, hold_key)` and
  `Event_StopMovementCommand(motion, hold_key)` carry locomotion. This is what `MotionOrder` models.
- `CM_Movement::Event_Jump(const JumpPack *)` and `Event_Jump_NonAutonomous(float extent)` carry the
  jump. Distinct events, not a motion command with a flag.
- ACE's `CommandInterpreter::BookkeepCommandAndModifyIfNecessary` returns early on
  `MotionCommand.Jump` *before* any command bookkeeping, and `MovePlayer_NonAutonomous` routes it to
  a different vtable slot than every other command.

So keeping the launch out of `MotionOrder` is retail's own structure, not a shortcut.

**`JumpPack` carries both the input and the result**: `{ extent, velocity, position, timestamps }`.
The client resolves the impulse locally from the bar and sends both the scalar it used and the
velocity it produced. Our authority is the host rather than the client, so the host resolves it —
but the contract shape is retail's: an extent in, a velocity out.

**The impulse provider is `MovementSystem::GetJumpHeight(load, jumpskill, power, scaling)`.** That
signature is exactly the split this plan needs: `power` is the bar, and `load`/`jumpskill`/`scaling`
are the actor facts a real client supplies and the Explorer does not have.

## The provider boundary already exists

`CharacterJumpKinematics` holds `full_extent_jump_height`, and its own doc comment already states
the rule: *"an already resolved numeric fact, not a skill or resource input."*
`jump_kinematics_from_movement_capabilities` is the seam a playable client would use.

So the Explorer supplies a fixed full-extent height and varies only the bar; a client later supplies
`GetJumpHeight(load, jumpskill, 1.0, scaling)` for the same field. **Same plumbing, different
provider** — which is the requirement, and it needs no new abstraction.

## What is already correct and merely mis-wired

`CharacterMotionController` (charge/release/reset state machine, sequence ordering, stale rejection)
and `resolve_character_jump` (launch velocity from extent, kinematics, heading, and support
readiness) are retail-grounded and already live in `holtburger-core`. Their **sole consumer** is
`host_camera_runtime/control.rs`.

`resolve_character_drive` is the opposite: it computes *continuous grounded movement* from retail's
`get_leave_ground_velocity` formula, whose `3.12`/`4.0`/`1.25` scalars are what retail carries into a
jump rather than how it walks. That is recorded as debt in the root-motion plan and dies with
`GroundedWalk`; it must not be carried into possession, which already moves by authored root motion.

**The consequence:** the jump half of that subsystem is not dead code awaiting deletion. It is the
correct half, wired to the wrong body. Phase 2 gives it the right one and Phase 3 deletes the wrong
half, which is what leaves Phase 4 with only a free-flight body to re-home.

## Reset is not part of this surface

`reset` is a **window-blur edge**, emitted by `FreeFlyCameraController#handleBlur`. It clears held
keys, drops an in-flight charge, and tells the host to do the same. Retail has no such concept; it
exists because a browser can eat a keyup while the tab loses focus.

It belongs in the input layer, not in a motion contract. It is in this plan only because **possession
is currently missing it**: blurring the window while driving a possessed entity leaves it walking.
That is a live defect introduced when possession was wired with `onEdge: () => {}`.

## Open question, to be answered before design

**Does `JumpCharging` replace the locomotion substate, or layer with it?**

It is SubState class, and retail's `MotionState` holds one substate at a time, which argues for
replacement. But `CharacterMotionController` already distinguishes `standing_long_jump` — "whether
charge began without translation or turn input" — which only matters if charging while moving is
representable.

Do not guess. The motion tables are already projected in memory, so the census is cheap: a
debug-harness bin over `MotionSequenceCatalog` reporting, for a player setup's table, whether
`0x4000001d` is reachable as a substate and what links enter and leave it from the walk and run
substates. That answers whether `MotionOrder` needs a jump slot or whether the charge rides the
existing `forward` slot.

## Phases

### Phase 0: Census the charge substate

Answer the open question above from real content. Report reachability, links, and whether any
authored table models a charge that coexists with locomotion. Record the finding before shaping the
contract.

### Phase 1: Carry the jump on the order's own channel

- Extend the possession command surface with the charge substate and release modifier, in whatever
  shape Phase 0's census justifies.
- Keep the launch **out** of `MotionOrder`, matching retail's separation. The order names motion; a
  launch is a separate host operation carrying an extent and producing a velocity.
- Preserve `MotionOrder`'s existing property that a body can walk and turn at once. A jump must not
  silently cancel a modifier the order still holds.

### Phase 2: Route the charge input possession already receives

`GroundedCharacterInput` already produces `begin-jump`, `release-jump` (with a measured extent), and
`reset`, fully sequenced. Possession constructs one and discards its edges. Wire them:

- `begin-jump` / `release-jump` reach the possessed body through the existing ordered-event
  machinery, with the same stale/duplicate rejection the camera path proved.
- `reset` clears the order and stops the body. Not a motion command; an input-ownership edge.
- The Explorer supplies a fixed full-extent height; the bar supplies the extent. No skill or vital
  inputs exist here and none should be invented.

### Phase 3: Retire the grounded camera's drive path

Once a possessed entity charges, launches, and lands:

- Delete `resolve_character_drive` and the `GroundedWalk` camera mode, which closes the
  leave-ground-formula debt outright rather than carrying it.
- `CharacterMotionController` and `resolve_character_jump` stay, now with a consumer that is a real
  character rather than a bodyless camera.
- What survives is re-homed by Phase 4.

### Phase 4: Dissolve `HostCameraRuntime`

Moved here 2026-08-20 from `holtburger-authored-root-motion-physics-integration-plan.md`, where D13
first scoped it. It lands last because it depends on everything above: Phase 3 retires
`GroundedWalk`, and what survives that retirement is what this phase re-homes.

The module is not deleted in one step. It divides into three parts with different destinations, and
each part moves only once its replacement is real.

D13's revision strengthens this: the follow camera is not a physical body at all, so after Phase 6b
the only body this module still owns is `PhysicalFly` — one free camera attached to nothing. A
subsystem, five contract types, and 1,513 lines of tests for a single free-flight body is the
clearest statement of the problem.

**1. ~~The character controller leaves the camera.~~ Corrected 2026-08-20 — it already left.**
`GroundedCameraControl` wraps `CharacterMotionController`, and `grounded_camera_actuation` delegates
every decision to it and to `resolve_character_jump`. Both already live in `holtburger-core`. What
remains in the camera module is **event sequencing and wire translation**: draining ordered pending
events, tracking `applied_revision`, and mapping `CharacterMotionEventResult` onto
`GroundedCameraEventOutcomeKind`. That is session plumbing, which is part 3 below, not a controller.

So this step collapses into part 3, and the plan's premise that a controller needed rehoming was
wrong. What *is* still true: retiring `GroundedWalk` closes the leave-ground debt, because retail's
`get_leave_ground_velocity` scalars were a stand-in for a character that did not exist and the
possessed entity is that character.

**2. The viewer becomes a function.** A fixed offset plus `CollisionScene::transit_motion_path`, with
the per-fraction view-direction interpolation preserved verbatim — it is retail-grounded and is the
one genuinely camera-specific behaviour in the module.

**3. The session machinery merges with the body service it duplicates.** `ExplorerEntityRuntime`
independently grew a parallel of it, and `HostSimulationRuntime` already owns body registration and
ticking. The camera is not an entity — no wcid, no appearance, no motion table — so it must not be
forced into the entity collection. The extraction is the *generic body session*, used by both.

#### Guarantee census

Nothing here is deleted until its replacement is named. Every guarantee the module currently
provides, and where it goes:

| Guarantee | Provided by today | Replacement |
| --- | --- | --- |
| A stale tick task cannot write after re-registration | `generation: AtomicU64` plus `is_current` checked twice per tick, once inside the lock | Generic body session; the double check is deliberate and must survive — a prior task can pass the first check and then wait behind a new registration |
| Exactly one camera generation is installed in the scheduler | `scheduler_slot` plus `tick_registration` replace-and-remove | Generic body session |
| The entity solves before the camera every tick | Slot reservation order in `lib.rs`, iterated as a `BTreeMap` | Named and commented in Phase 6b; must not regress to implicit |
| A host-side tick failure terminates the generation rather than stalling | `CAMERA_FAILURE_EVENT` | Generic body session failure path |
| Input intents cannot be applied out of order or replayed | `last_intent_sequence` monotonicity, `movement_epoch` non-regression, `next_event_sequence` plus `pending_events` dedup | Generic body session; this is ordinary input sequencing with nothing camera-specific in it |
| A frontend displacement request is consumed exactly once | `applied_world_displacement_total` reconciled against `world_displacement_total`, bounded by `maximum_displacement_per_tick` | Generic body session |
| Body and viewer cells are resolved independently for portal placement | `resolve_physical_body_cell` and `resolve_viewer_cell` at registration; `transit_motion_path` per tick | The viewer function; body cell resolution is already a world-crate call |
| A grounded body cannot carry physical-fly acceleration state | The tagged `PhysicalCameraControlRequest` enum | Preserve the tagging when controllers rehome; do not flatten it into optional fields |
| Camera mode matches its resolved body response | `camera_mode_matches_response` | Falls away with the modes; a body's controller is chosen where the body is registered |
| Registration residency is a normalized `0xFFFF` owner with a belonging EnvCell | `parse_registration_residency` | Generic body session registration |

#### Deliverables

- Rehome the character controller so it drives any body, preserving the tagged control contract.
- Reduce the viewer to a function, preserving the per-fraction interpolation and its
  `acclient.c:138800-138918` citation.
- Extract the generic body session from the camera and entity runtimes rather than merging the
  camera into the entity collection.
- Keep `PhysicalFly`. It is a free-flying collision-aware camera attached to nothing, it is the body
  the boom drives, and it is the one camera mode that was never a stand-in.

#### Acceptance Criteria

- Every row of the guarantee census has a live replacement with a test, or an explicit record of why
  it is no longer needed.
- No subsystem named for a camera owns body-session lifecycle.
- `grep -rn "GroundedWalk\|grounded-walk" apps crates` returns nothing, including the wire type
  `GroundedCameraDriveRequest`, whose name only became wrong when the mode retired in Phase 3.

#### Why this is last, not first

An earlier draft blocked this on watching the third-person camera before retiring the grounded one.
That prerequisite is now structural rather than advisory: Phases 2 and 3 are the verification. A
possessed entity that charges, launches, and lands is what makes `GroundedWalk` redundant, and this
phase only re-homes what survives that.

## Acceptance Criteria

- A possessed entity charges, releases, and launches through the same control plumbing a client mode
  would use, differing only in who supplies the full-extent height.
- The launch travels on its own channel, not inside `MotionOrder`.
- Blurring the window while driving a possessed entity stops it.
- A jump does not cancel a turn or sidestep the order still holds.
- `resolve_character_drive` and `GroundedWalk` are gone, and the leave-ground debt row is closed
  rather than re-worded.
- No subsystem named for a camera owns body-session lifecycle, and every guarantee row in Phase 4's
  census has a live replacement or a recorded reason it is no longer needed.
- The charge substate's relationship to locomotion is decided by census, with the evidence recorded.

## Non-Goals

- Retail's action queue on `MotionState`. Still no producer; `Jumpup` is not used by this sequence.
- Stamina cost (`MovementSystem::JumpStaminaCost`), skills, encumbrance, or any vital. The Explorer
  has none of these, and the provider boundary exists so they can arrive later without rework.
- Server-authoritative jump reconciliation. `JumpPack`'s timestamps and position exist for a
  client/server split this plan does not have.
- Third-person camera behaviour. The boom follows the body; it does not need to know about jumps.
