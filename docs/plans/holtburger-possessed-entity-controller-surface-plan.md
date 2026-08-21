# Holtburger Possessed-Entity Controller Surface Plan

Status: **Execution in progress 2026-08-21.** Evidence prep and Phases 0-1 complete.
Origin: `holtburger-authored-root-motion-physics-integration-plan.md`, which completed authored root
motion, possession, and the boom camera. It left the possessed entity without jump lifecycle
control and left a synthetic grounded-character mode inside `HostCameraRuntime`.

This revision incorporates a code-path dry run against the retail decompile, shipped motion
content, and the current Explorer runtime. It corrects five premises from the first draft:

1. normal player jump charging does not select `JumpCharging` through the motion interpreter;
2. possession already sends an idle drive on window blur, so blur does not currently leave the
   entity walking;
3. the entity collection and replaceable physical-camera task are not isomorphic sessions, so a
   generic body-session abstraction is not a predetermined destination;
4. `setLocalTranslationEnabled(false)` does not transfer all drive-key authority: `A`/`D` still
   rotate the camera while the same edges turn the possessed entity; and
5. missing or physically inert target-table commands should not make arbitrary Explorer possession
   uncontrollable: authored motion remains preferred, but an explicit standard-character
   kinematic fallback supplies unusable grounded axes and jump presentation gaps.

## Goal

Give a possessed entity a generation-safe retail jump lifecycle integrated atomically with its
authored motion and physical body, then delete the synthetic grounded-camera path and reduce the
surviving physical-fly adapter according to what actually remains.

The desired end state is one character-control path shared in behavior with a future playable
client:

- semantic drive and stance are retained input intent;
- keyboard character intent and pointer camera intent have exclusive, explicit owners;
- jump press/release/reset are ordered lifecycle edges;
- authored motion is selected from the retained intent plus controller and contact state;
- each axis uses physically suitable target-authored motion when available and a documented
  physical fallback when it is not;
- launch is a separate body operation, not a `MotionOrder` field; and
- the Explorer and a playable client instantiate the same third-person character control scheme,
  differing only in character-session transport and resolved actor kinematics.

## Scope

### In Scope

- A host-issued possession generation that targets every drive and lifecycle request.
- One semantic possessed-character intent contract, replacing the frontend-authored
  `ExplorerMotionOrder` wire shape.
- Ordered begin-jump, release-jump, and reset delivery with coalescible drive revisions.
- `CharacterMotionController` and `resolve_character_jump` driving the possessed body in its fixed
  tick.
- Retail standing-long-jump suppression, moving-charge behavior, airborne `Falling` selection, and
  restoration of retained intent after landing.
- An explicit Explorer provider for all `CharacterJumpKinematics` inputs.
- A hardcoded, surveyed standard non-combat fallback profile for grounded axes the target motion
  table cannot physically supply.
- An explicit possession control scheme: body-relative `W`/`S` and `Z`/`C`, body turn on `A`/`D`,
  jump on Space, primary-button drag for camera orbit, and wheel for boom zoom.
- Reusable app-local character input, camera look, and third-person boom controllers under
  `apps/holtburger-3d/src/lib/game/controls/`, with entry-point regime selection and host adapters
  left outside the shared package.
- Non-interactive browser-harness coverage of possession, launch, airborne motion, and landing.
- Deletion of `GroundedWalk`, `resolve_character_drive`, and their camera-only wire and frontend
  surfaces.
- A measured reduction of the remaining physical-fly runtime after the grounded variants are gone.

### Out of Scope

- Retail's action queue on `MotionState`; `Jumpup 0x1000004b` is not issued by this sequence.
- Treating `JumpCharging 0x4000001d` as an input command without a proven producer.
- Stamina cost, skills, encumbrance, or vitals. The Explorer has none of these.
- Server-authoritative jump reconciliation or construction of a network `JumpPack`.
- Retargeting standard-character animations onto arbitrary setup models. Fallback is physical
  kinematics only; it does not invent compatible clips, skeletons, or transition graphs.
- Changes to boom collision, follow, or smoothing behavior. Its input ownership and reusable
  frontend location are in scope; the boom still follows rendered entity placement and has no
  physical camera body.
- Building the primary `ClientApp` gameplay surface. This plan leaves the shared controls ready for
  that entry point without making it import Explorer code.
- A generic body-session abstraction. It may be extracted later only if the post-cutover code has
  two genuinely isomorphic consumers.

## Ground Truth and Existing Seams

### Authoritative references

- `acclient-eor-source/acclient.c:330102-330143` — `CMotionInterp::charge_jump` validates the charge
  and records `standing_longjump`; it does not issue `JumpCharging`.
- `acclient-eor-source/acclient.c:329730-330050` — `apply_run_to_command` and `adjust_motion`
  canonicalize backward/left input into signed forward/right command families and apply retail run,
  sidestep, backward, and turn rate factors before interpreted movement is selected.
- `acclient-eor-source/acclient.c:330342-330453` — `apply_interpreted_movement` suppresses forward
  and sidestep motion during a standing long jump, selects `Falling` when contact disallows
  movement, and handles turning independently.
- `acclient-eor-source/acclient.c:330455-330480` — `CMotionInterp::jump` accepts the extent and makes
  the body leave walkable support.
- `acclient-eor-source/acclient.c:306806-306841,325889-325917,330655-330707` — leaving walkable
  support synchronously invokes `LeaveGround`, installs launch velocity, clears jump state and link
  animations, and reapplies movement as `Falling`; `HitGround` reapplies the retained movement.
- `acclient-eor-source/acclient.c:390076-390100` — `FinishJump` clears the pending charge and
  `standing_longjump` state.
- `acclient-eor-source/acclient.c:390472-390525` — `CommenceJump` starts the controller/power-bar
  lifecycle after `charge_jump` succeeds.
- `acclient-eor-source/acclient.c:390559-390640` — `DoJump` resolves the local launch and sends the
  distinct autonomous or non-autonomous jump event.
- `acclient-eor-source/acclient.c:390379-390429` — power-bar level reads the character's current
  interpreted style on every sample; dual wield uses 0.8 seconds and every other style one second.
- `acclient-eor-source/acclient.c:677977-678036` — `CM_Movement::Event_Jump` and
  `Event_Jump_NonAutonomous` are separate from movement-command events.
- `acclient-eor-source/acclient.c:681989-682190` — `Jump 0x2500003b` bypasses ordinary command
  bookkeeping and dispatches through a separate interpreter path.
- `ACE/Source/ACE.Entity/Enum/MotionCommand.cs` — command values and bit classes.
- `ACE/Source/ACE.Server/Physics/Command/CommandInterpreter.cs:158-181,657-681` — readable mirror of
  the special jump routing.
- `ACE/Source/ACE.Server/Physics/Animation/MotionInterp.cs:430-585` — readable mirror of charge,
  interpreted-movement selection, contact gating, and jump support checks.

Command bit class is not controller behavior. `Jump` has modifier bits and `JumpCharging` has
substate bits, but the retail player path above does not install either in ordinary interpreted
motion state. The decompile decides what the controller selects; content decides whether the motion
table can satisfy that selection.

### Existing Holtburger seams

- `crates/holtburger-core/src/client/character_motion.rs` — charge/release/reset state machine,
  ordered stale rejection, standing-long-jump state, and retained `CharacterDrive`.
- `crates/holtburger-core/src/client/character_jump.rs` — actor-neutral launch resolution and the
  continuous-drive function that this plan deletes.
- `crates/holtburger-core/src/client/character_kinematics.rs` — validated provider boundary for
  resolved movement and jump facts.
- `crates/holtburger-world/src/motion/state.rs` — `MotionOrder`, which remains style, substate, and
  layered modifier intent; it gains no jump field.
- `crates/holtburger-world/src/motion/registry.rs` — motion selection and authored offset production.
- `apps/holtburger-3d/src-tauri/src/explorer_entity_runtime.rs` — possession state, motion playback,
  and the generation-stable collection tick that must own controller application.
- `apps/holtburger-3d/src-tauri/src/host_simulation_runtime.rs` — canonical body authority and
  physical collection transaction.
- `crates/holtburger-world/src/spatial/physical_body.rs` — `GroundedBodyActuation::with_launch`
  already carries one validated launch into `solve_grounded_body_tick`, where support is left and
  launch velocity is installed atomically with the solve.
- `apps/holtburger-3d/src/explorer/grounded-character-input.ts` — sequenced frontend drive and jump
  edges; `reset()` emits idle drive before its ownership-reset edge.
- `apps/holtburger-3d/src/explorer/free-fly-camera-controller.ts` — one controller currently owns
  DOM key/pointer/wheel routing, free-fly translation, keyboard yaw, and character-key publication.
  Disabling local translation zeros only translation; its animation loop still applies `A`/`D`
  keyboard yaw.
- `apps/holtburger-3d/src/explorer/boom-camera-controller.ts` and `boom-camera-session.ts` — already
  injected, frontend-only third-person camera policy, but needlessly hidden behind the Explorer
  module boundary.
- `apps/holtburger-3d/src/explorer/ExplorerApp.svelte` — current possession input owner and discarded
  `onEdge` callback; it routes character keys to possession while the camera controller retains the
  same held keys.
- `apps/holtburger-3d/src/client/ClientApp.svelte` — currently only a route shell. It must be able to
  consume the eventual shared controls without importing `src/explorer/`.
- `apps/holtburger-3d/src-tauri/src/host_camera_runtime/` — proven revision/event-queue mechanics and
  the grounded path to retire; copy the invariants, not the camera vocabulary.

## Evidence Corrections

### Charging is controller state, not a `MotionOrder` channel

`CMotionInterp::charge_jump` only determines whether charging may begin and whether it began from a
standing state. During subsequent movement application:

- a moving charge continues using the latest forward, sidestep, and turn intent;
- a standing long jump temporarily suppresses forward and sidestep output;
- turning is evaluated independently; and
- the retained commands are not destroyed, so they can become effective again when the temporary
  condition ends.

`CharacterMotionController::effective_drive` already expresses the first two rules. This plan must
adapt that effective drive to authored motion; it must not add `JumpCharging` or `Jump` fields to
`MotionOrder`.

The completed content census confirms the split: authored rows decide whether the proven retail
selection can be presented, but they do not invent a different controller policy.

### Semantic drive must use retail's adjusted command families

The current frontend `motionOrderFromDrive` chooses distinct `WalkBackwards`, `SideStepLeft`, and
`TurnLeft` table commands at speed 1.0. Retail does not leave interpreted state in that form:
`adjust_motion` converts backward to negative `WalkForward`, left sidestep to negative
`SideStepRight`, left turn to negative `TurnRight`, and applies the run/sidestep/turn scalars. A
running forward becomes `RunForward` at the actor run-rate scalar; running backward remains reversed
`WalkForward` and is rate-scaled.

Most of these proven factors already exist in `crates/holtburger-core/src/client/movement/common.rs`
and `character_jump.rs`. Phase 1 extracts one small pure adjusted-axis resolver from those facts.
Possession converts its result to `MotionOrder`, and jump planar resolution consumes the same
adjusted axes/kinematics instead of maintaining another mapping. The frontend mapping and its
command constants are deleted. Per-stance capability checks use the canonical families
(`WalkForward`, `RunForward`, `SideStepRight`, `TurnRight`) and signed-rate support, not separate
left/back rows the runtime selector will never issue.

### Real-content census sizes the presentation fallback

A temporary debug-harness binary read `dats/assets.hba` and `dats/weenies.hwc`, then was removed
because those runtime assets are not checked into the repository. Results:

- All 436 projected motion tables and all 7,848 table/style pairs across the 18 known retail
  stances have zero `JumpCharging` cycles and zero resolver-visible links into or out of it.
- In each of the 94 tables whose default style models both `Ready` and `Falling`, the style default
  is `Ready`. `Falling` never clears modifiers and never requires the default substate; only one
  `Ready` cycle clears modifiers. The effective order must therefore explicitly suppress sidestep
  during a standing charge and while airborne instead of relying on content flags.
- Of 43,913 catalog templates, 13,992 resolve to a projected table: 6,347 model both `Ready` and
  `Falling`, 6,258 model only `Ready`, none model only `Falling`, and 1,387 model neither. Four
  further templates resolve to absent table `0x09000085`.
- Of 7,831 creature templates, 7,788 resolve to a projected table: 4,999 model both commands, 2,744
  model only `Ready`, none model only `Falling`, and 45 model neither. The complete jump visual
  lifecycle is therefore available to 64.2% of projected creatures, not to arbitrary possession.
- Standard player table `0x09000001` models effective `Ready` and `Falling` for all 18 known retail
  stances and models no `JumpCharging` state.

For the eight Explorer stances after adding dual wield, the creature-template distribution is:

| Stance                        | Models stance | Also models `Ready` + `Falling` |
| ----------------------------- | ------------: | ------------------------------: |
| Hand combat `0x8000003C`      |         7,211 |                           4,997 |
| Non-combat `0x8000003D`       |         7,731 |                           4,999 |
| Sword combat `0x8000003E`     |         4,424 |                           4,301 |
| Bow combat `0x8000003F`       |         3,662 |                           3,662 |
| Sword/shield `0x80000040`     |         3,662 |                           3,662 |
| Two-handed sword `0x80000044` |         3,580 |                           3,580 |
| Dual wield `0x80000046`       |         3,416 |                           3,416 |
| Magic `0x80000049`            |         3,433 |                           3,294 |

There is no compatible visual fallback to invent. The census instead sizes the deliberate
presentation degradation: possession remains physically controllable through explicit kinematic
fallbacks, while target-authored `Ready` and `Falling` are used when available. A ready-only table
may therefore remain in its safe target-authored/default presentation while the body is airborne.
The receipt reports that presentation source; it does not misrepresent it as authored jump support.
An unmodelled stance or absent motion table remains a typed rejection because the host cannot
establish a valid target-authored presentation regime at all.

### The standard-character table closes the numeric fallback policy

A second temporary debug-harness survey read standard player table `0x09000001` from
`dats/assets.hba`, inspected all eight offered stances, and was removed after recording the results.
Every relevant standard non-combat cycle has one clip. At object scale 1, stance
`NonCombat 0x8000003D` provides these base authored facts:

| Canonical family | Reduced content fact                     | Hardcoded fallback |
| ---------------- | ---------------------------------------- | -----------------: |
| `WalkForward`    | `1.400001 m / 0.538117 s = 2.601668 m/s` |          `2.6 m/s` |
| `RunForward`     | `3.199991 m / 0.8 s = 3.999989 m/s`      |          `4.0 m/s` |
| `SideStepRight`  | `1.0 m / 0.833333 s = 1.2 m/s`           |          `1.2 m/s` |
| `TurnRight`      | explicit cycle omega magnitude           |        `1.5 rad/s` |

The Explorer hardcodes those rounded facts in one validated app-local
`PossessionFallbackMotionProfile`. They are base root-motion facts, not already adjusted input
speeds. The shared retail adjusted-axis resolver then produces `1.69 m/s` backward
(`2.6 * 0.65`), `1.4976 m/s` sidestep (`1.2 * (3.12 / 1.25) * 0.5`), `1.5 rad/s` walking turn, and
`2.25 rad/s` run-held turn. Fallback translation receives the possessed entity's object scale just
like authored root offsets; angular rate does not.

Run root speed and turn omega are effectively invariant across the eight surveyed stances, while
walk and sidestep root speeds vary. Choosing the standard non-combat row is therefore an explicit
Explorer control policy, not a claim that it reconstructs every target stance. The runtime does not
open the standard table or start a hidden second animation player; the constants merely fill a
missing physical axis. Target-authored playback remains the only visible playback.

A template-weighted census over all 7,788 creature templates resolving to projected motion tables
measured how often an accepted Explorer stance's canonical family is absent or present but supplies
no physical translation/rotation on the relevant channel after left/backward derivation:

| Stance           | Models stance | Walk fallback | Run fallback | Sidestep fallback | Turn fallback |
| ---------------- | ------------: | ------------: | -----------: | ----------------: | ------------: |
| Hand combat      |         7,211 |           876 |          876 |             1,681 |           171 |
| Non-combat       |         7,731 |         1,477 |        1,477 |             2,650 |         1,191 |
| Sword combat     |         4,424 |             0 |            0 |                72 |             0 |
| Bow combat       |         3,662 |             0 |            0 |                 0 |             0 |
| Sword/shield     |         3,662 |             0 |            0 |                 0 |             0 |
| Two-handed sword |         3,580 |             0 |            0 |                 0 |             0 |
| Dual wield       |         3,416 |             0 |            0 |                 0 |             0 |
| Magic            |         3,433 |           247 |          247 |               362 |            31 |

Each fallback total includes absent commands plus commands whose projected cycle has no relevant
physical kinematics. Present-but-motionless rows account for hand combat
`818/818/787/118` (walk/run/sidestep/turn), non-combat `813/813/649/115`, sword sidestep `7`, and
magic sidestep `72`; the remainder are absent commands. This is material policy, not exception-path
polish: 34.3% of non-combat-capable creatures need sidestep fallback, 19.1% need walk/run fallback,
and 15.4% need turn fallback. The implementation site therefore carries a `RETAIL DIVERGENCE:`
marker citing `acclient.c:329730-330050`, stating that an arbitrary body may physically move at
standard-character rates while showing an in-place target clip or retained target presentation,
and preserving this census as the blast radius.

For the census and implementation, a canonical cycle/modifier physically supplies translation when
its explicit velocity or composed full-cycle root translation exceeds `1e-4` in magnitude, and
supplies turn when its explicit omega or composed root rotation exceeds the same magnitude. A link
may remain valid target presentation during a transition, but it does not qualify as the recurring
physical source for a held axis. Put this reduction in one focused content-facing helper and use its
resolved fact; the tick path and validator do not re-derive suitability. Keep the helper beside host
capability construction unless a second non-Explorer consumer proves the reduction belongs in
`holtburger-content`; reading content does not itself justify promoting Explorer policy.

Ownership follows the existing boundaries. `holtburger-content` exposes target table facts but does
not choose a fallback. Explorer host composition under `apps/holtburger-3d/src-tauri` constructs the
validated profile and injects it into `ExplorerEntityRuntime`, which owns the per-axis source
decision. `holtburger-core` owns only the pure retail adjusted-axis math;
`GroundedBodyActuation`/`holtburger-world` consume the already-resolved physical result without
knowing standard table `0x09000001`. The frontend consumes source labels for diagnostics and
presentation quality, never the numeric fallback policy.

Do not overload `CharacterMovementKinematics` with this profile. Its `3.12` walk speed and `4.0` run
speed are retail jump-planar inputs with a different meaning and consumer. The two typed values may
share the pure adjusted-axis math, but collapsing them would make the constants lie.

The survey also exposed a prep-time hazard: direct cycle reduction gives the `1.2 m/s` standard
sidestep fact, but repeated runtime sampling was inconsistent for some stances because the current
order path may repeatedly stop/reselect a sidestep command carrying both substate and modifier bits.
Phase 1 must prove sustained standard non-combat authored sidestep displacement before trusting the
same selection path for target-authored side motion. This does not change the fallback constant,
which comes directly from the reduced cycle.

### Blur already stops drive; reset will become necessary for charge ownership

`GroundedCharacterInput.reset()` clears held keys and calls `onDrive` with an idle drive before it
emits `reset`. Possession's live `onDrive` callback therefore already replaces its motion order with
idle. The discarded edge is not the cause of continued walking.

Once possession owns a host-side `CharacterMotionController`, the reset edge becomes necessary for a
different reason: it must cancel a pending charge and retire all input through the same possession
generation. Reset must also establish a revision barrier so an older async drive cannot arrive later
and restart movement.

### Possession currently double-routes turn keys

The current frontend does not have one input owner per control regime. `FreeFlyCameraController`
first publishes every character key to `ExplorerApp`, which forwards it to `GroundedCharacterInput`
while possession is active, and then adds the same key to its own `pressedKeys`. Setting
`localTranslationEnabled` false suppresses the camera's local translation vector but does not guard
the keyboard-yaw calculation. Its animation loop therefore continues applying `A`/`D` to camera
yaw while `GroundedCharacterInput` simultaneously emits left/right turn intent for the entity.

The prior root-motion plan's statement that `setLocalTranslationEnabled(false)` transfers drive
keys to the entity is only true for translation. Pointer behavior already proves most of the desired
camera side: primary-button drag changes yaw/pitch, middle/right pan is suppressed while local
translation is disabled, and wheel input is redirected to boom zoom.

The fix is an ownership cutover, not an `A`/`D` conditional. A tagged frontend control scheme must
route each raw input to exactly one semantic owner and clear the prior owner's held state when the
scheme changes. This replaces the under-specified translation boolean; adding independent keyboard
yaw, translation, pan, and wheel flags would recreate the same invalid combinations in a larger
shape.

### The actual possession safety gap is ownership targeting

`set_explorer_entity_motion` currently carries neither the possessed GUID nor a possession
generation. It applies to whichever entity is possessed when the asynchronous command executes.
Re-possessing, releasing, or re-possessing the same GUID therefore leaves a window in which a late
request from the old input owner can drive the new one.

Every new possession and every release must advance one host-issued generation. Drive and lifecycle
requests target that generation; stale generations are ignored before they can mutate controller,
motion, or body state.

### Airborne authored motion is part of the vertical slice

The current Explorer continues advancing the retained locomotion order while a body is airborne;
the support gate correctly prevents its authored displacement from becoming physical movement, but
the selected clip can still look like walking in air.

Retail selects `Falling 0x40000015` when contact disallows locomotion, suppresses sidestep, and still
handles turning. The possessed controller must retain the operator's drive while projecting an
effective airborne order, then restore the retained order on support. A positive Z velocity without
this motion transition is not a completed jump integration.

### The Explorer provider supplies a complete resolved fact

`CharacterJumpKinematics` contains base walk speed, base run speed, run-rate scalar, and full-extent
jump height. The Explorer must explicitly supply all four; it does not supply only height.

The initial Explorer provider preserves the already-proven grounded-camera values:

- walk launch speed `3.12`;
- run launch speed `4.0`;
- run-rate scalar `1.0`; and
- full-extent jump height `8.425`.

These are app-local resolved numeric facts and remain the physical jump fallback even when the
target stance has no `Ready` or `Falling` presentation. A playable client later constructs the same
core type from `jump_kinematics_from_movement_capabilities` after resolving actor skills, load, and
run rate. No skill/resource abstraction is added to the Explorer.

The charge bar is separate provider policy: normal styles charge in one second and
`DualWieldCombat` in 0.8 seconds, matching `retail_jump_charge_profile`. The frontend presentation
must use the accepted stance's profile, including a stance change during an in-flight charge.
Retail's `GetPowerBarLevel` reads the live interpreted style on each sample rather than capturing a
duration at charge start, so `GroundedCharacterInput` needs a profile provider/current value rather
than its present constructor-fixed `fullChargeDurationMs`.

### Accepted stance is host state, not optimistic UI state

The current frontend records a requested stance before the host's motion selector has proven the
table can enter it. An unmodelled style is a no-op in `select_motion`, leaving the prior style active;
using the requested value for charge timing would therefore disagree with playback.

The new contract exposes capabilities per offered stance and carries the complete contemporaneous
semantic intent on lifecycle edges. The host validates and accepts stance plus drive as one intent,
or rejects it without constructing a hybrid from the new drive and old stance. The frontend gates
its selector from the same capability receipt and computes the bar from the currently accepted
stance. Host validation remains authoritative when a caller bypasses the UI.

### Retail's fully-constrained check has no current Holtburger producer

Retail `CPhysicsObj::IsFullyConstrained` is not a count of collision planes. It reads a positional
tether's current offset and rejects jump after that offset exceeds 90% of its maximum
(`acclient.c:304376-304389`; ACE `ConstraintManager.IsFullyConstrained`). Holtburger has collision
constraint diagnostics but no equivalent position/constraint manager.

The current grounded-camera adapter consequently never constructs
`CharacterJumpReadiness::Constrained`; only tests do. The possessed Explorer must not reinterpret a
solver diagnostic to make that branch reachable. Phase 2 reports the readiness facts it actually
owns (`Airborne`, unsupported contact, and nonphysical response), and Phase 4 deletes the dead
`Constrained` readiness/rejection variants with the grounded-camera consumer. A future positional
tether feature may restore them when it owns the actual retail fact.

## North Stars

1. Retained input, effective authored motion, and physical launch are distinct facts with one owner
   each.
2. No command from a retired possession may affect a later possession, even of the same GUID.
3. Controller edges are applied in the same fixed-tick transaction that samples support and solves
   the body.
4. `MotionOrder` remains a deterministic motion-table order, not a bag of controller events.
5. Body motion and visible motion agree whenever target-authored physical motion exists; every
   fallback and its retained/in-place target presentation are explicit when it does not.
6. The Explorer supplies resolved facts; it does not pretend to have player skills or vitals.
7. Delete the grounded-camera stand-in before designing an abstraction around what survives it.
8. Each raw input has exactly one owner in the active frontend control scheme.
9. Reusable client controls live under `src/lib/game/controls/`; Explorer chooses when the shared
   third-person scheme is active and supplies adapters but does not own its bindings or controller
   implementation.
10. A fallback supplies physical control only. It never borrows another setup's animation or starts
    a second hidden playback authority.

## Contract Direction

### Possession identity

Replace the current optional GUID-only ownership with one composite active-possession value holding:

- the possessed GUID and exact entity generation;
- a host-issued possession generation that changes on possess and release;
- `CharacterMotionController`;
- newest coalescible semantic intent and its revision;
- next contiguous lifecycle sequence plus pending edges;
- the table-derived per-stance control capabilities; and
- the resolved `CharacterJumpKinematics` and `PossessionFallbackMotionProfile` for this Explorer
  possession.

The possession receipt returns the exact entity generation, host-issued possession generation, and
a per-offered-stance capability value: whether the stance itself is modelled; one source value for
each canonical locomotion family (`TargetAuthored`, `StandardFallbackWithTargetPresentation`, or
`StandardFallbackWithoutTargetPresentation`); the jump-presentation source (`ReadyAndFalling`,
partial target presentation, or target default); and its retail charge profile. This single
locomotion source value prevents physical capability and visual availability from becoming
contradictory booleans: a present-but-motionless command keeps its target clip while fallback moves
the body, and an absent command retains the other target-authored/default presentation while
fallback moves the body. Signed backward/left behavior derives from the canonical family through
the shared adjusted-axis resolver; it is not another capability field.

Each receipt field has a consumer: entity-lifetime invalidation, request targeting, stance options,
diagnostics/control affordances, jump presentation, and charge presentation respectively. Every
later request carries the possession generation. Do not expose an `Unavailable` axis for an accepted
stance: failure to construct the validated app fallback is a host configuration error. Do not
scatter these interdependent fields across parallel options or atomics, and do not retain the
current flat default-style `modelledCommands` contract beside the replacement.

### Semantic intent

Cleanly replace `ExplorerMotionOrder` on the Tauri/frontend possession wire with one semantic intent:

- possession generation;
- monotonic revision within that generation;
- stance; and
- `CharacterDrive` axes.

The host resolves visible `MotionOrder` and physical actuation once from stance, effective drive,
controller phase, contact state, and the accepted stance capability. An intent requesting an
unmodelled stance is rejected as a whole. A missing command within an accepted stance selects that
axis's declared physical fallback instead of rejecting the semantic intent; so does a target command
that presents a clip but supplies no relevant physical kinematics. The frontend may display the
capability/source receipt, but it neither gates valid input because a target clip or physical channel
is missing nor derives a second authoritative order and sends it across the wire.

### Ordered lifecycle edges

Begin, release, and reset are non-coalescible. Each request carries:

- possession generation;
- contiguous edge sequence;
- the contemporaneous semantic-intent revision and complete stance/drive snapshot; and
- release extent where applicable.

Duplicate and stale edges are ignored. A future sequence waits behind a missing one; it is never
applied out of order. Reset clears controller phase and effective order at its revision barrier.
Newer intent remains valid; older async intent cannot resurrect cleared movement.

### Frontend control scheme and reuse boundary

Replace the partial `setLocalTranslationEnabled` handoff with one tagged
`FrontendControlScheme` (final name may follow local conventions) selected atomically by the app.
The value describes the complete routing regime, not a matrix of optional booleans. It must cover
free fly, physical fly, and possessed-character control while those regimes coexist; the temporary
grounded-camera consumer uses the character route only until Phase 4 deletes it.

The possessed-character scheme is explicit:

| Input                                                         | Possessed entity                                     | Third-person camera                           |
| ------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------- |
| `W` / `S`                                                     | Move forward/backward relative to the body's heading | No effect                                     |
| `Z` / `C`                                                     | Sidestep left/right relative to the body's heading   | No effect                                     |
| `A` / `D`                                                     | Turn body left/right                                 | No keyboard yaw or orbit                      |
| Shift                                                         | Select walk while held; run is the default           | No sensitivity modifier                       |
| Space press/release                                           | Begin/release jump charge                            | No vertical movement                          |
| Primary-button drag                                           | No effect on drive or facing                         | Orbit yaw/pitch around the followed anchor    |
| Middle/right-button drag                                      | No effect                                            | Disabled; possession has no free-camera pan   |
| Wheel                                                         | No effect                                            | Change desired boom distance                  |
| Page Up / Page Down                                           | No effect                                            | No effect                                     |
| Canvas blur, possession loss, or entity-generation retirement | Reset held drive and jump ownership once             | End active drag and retain no held camera key |

Character movement is deliberately body-relative, not camera-relative. Camera orbit never mutates
entity heading, and turning the entity never mutates orbit yaw. The boom continues deriving camera
position from the rendered entity anchor plus the look controller's yaw/pitch; this plan changes
input ownership, not boom collision or follow math.

A scheme transition clears the outgoing held-key/drag state before installing the next owner and
delivers exactly one ownership reset where the outgoing character session requires it. A key held
across the transition does not silently begin controlling the new owner; it must receive a fresh
press. This prevents stuck motion and cross-regime key leakage without synthesizing browser edges.

Place the neutral frontend mechanisms under `apps/holtburger-3d/src/lib/game/controls/`:

- rename and move `GroundedCharacterInput` to an honestly named `CharacterInputController`, since
  raw-key arbitration, semantic drive, and jump timing are character concerns rather than grounded
  camera concerns;
- split raw canvas routing and reusable yaw/pitch look state from `FreeFlyCameraController`, with the
  tagged scheme assigning keyboard, pointer, and wheel input to one sink;
- export the complete third-person character profile that composes the routing table, character
  input, look, and boom mechanisms, so entry points select that profile rather than reimplementing
  its bindings;
- move the third-person boom controller/session and injected `BoomSweepSource` contract behind the
  same neutral boundary; and
- leave Explorer regime selection, possession-session transport, Tauri/HTTP sweep adapters, UI
  errors, and tuning-provider composition in their entry-point modules.

Do not promote browser input or camera UX to a Rust shared crate. Both Explorer and the future
`ClientApp` are frontends inside this app and can import the same `src/lib/game/controls/` modules;
neither shared controller may import `src/explorer/`, Tauri commands, or Explorer UI state.
Conversely, do not pretend the Explorer's arbitrary-GUID possession transport is the future
client's authenticated-player session. The shared profile accepts an injected semantic character
sink; each entry point owns the lifetime and transport behind that sink.

### Fixed-tick decision order

For the active possession, the collection uses a provisional possessed-tick proposal while the
entity registry and simulation tick-start body remain stable:

1. receive the exact canonical `SpatialBody` selected by collection preparation;
2. classify the accepted stance's per-axis authored/fallback sources, jump-presentation source,
   physical response, and jump/contact readiness;
3. clone only the active possession/controller and its playback state, then apply every
   now-contiguous controller edge to that provisional state;
4. resolve at most one accepted release into a `GroundedLaunch`;
5. apply the pure retail adjusted-axis resolver once, then derive the target-visible `MotionOrder`
   for every present target command, including present-but-motionless commands; suppress physical
   planar intent during a standing charge or unsupported contact before either source is actuated;
6. choose jump presentation independently: target `Ready`/`Falling` when present, otherwise the
   available target `Ready` or accepted stance default. Treat an accepted same-tick launch as
   unsupported so target `Falling` is selected immediately when it exists;
7. advance target playback once and convert only physically suitable authored axes to grounded
   actuation. Fill each absent or present-but-motionless effective planar/turn channel from
   `PossessionFallbackMotionProfile`, using tick-start heading, fixed elapsed time, and object scale
   to combine both sources into one complete `GroundedBodyActuation`; never add fallback to a
   channel already supplied by authored playback;
8. attach the optional one-shot launch with `GroundedBodyActuation::with_launch`;
9. solve the physical collection once;
10. on a `Solved` tick whose returned contact changes the effective order, reselect motion at zero
    elapsed time against the returned contact—target `Falling` or the declared target-only
    presentation fallback after an ordinary ledge departure, retained intent after landing—without
    producing a second authored offset or body solve; and
11. commit the provisional controller/playback/outcomes only for that exact solved body, then
    publish body/path, event outcomes, and clip changes.

Jump capability is physical, not visual: any supported dynamic body with valid Explorer jump
kinematics may charge and launch. When `Ready` or `Falling` is absent, the body still follows the
same controller and launch path while playback follows the deterministic target-only hierarchy
above. The implementation marks this with `RETAIL DIVERGENCE:` and cites
`acclient.c:330342-330453`, the visual consequence, and the census blast radius (4,999 of 7,788
projected creatures model both commands; 2,744 are ready-only and 45 model neither). This marker is
required because retail player control assumes compatible player presentation, while Explorer
intentionally controls arbitrary bodies.

A held `SubstepBudgetExceeded`/`ContactBudgetExceeded` result or an omitted
`DynamicContactBudgetExceeded` body commits no possessed proposal and emits no optimistic success;
the original lifecycle edge remains queued for the next woken tick. This matters because collection
preparation evaluates actuation before the later dynamic-contact solve, and mutating live controller
state in that callback would otherwise consume a release and select `Falling` while the body was
held at its starting pose. Unpossessed playback keeps its current collection behavior; only the
possessed state that must agree with controller/body acceptance is provisional.

The zero-time reselection is the local equivalent of retail's synchronous `LeaveGround`/`HitGround`
callbacks calling `apply_current_movement`. It changes which clip is published at the accepted
contact edge but contributes no second tick of root motion.

The actuation callback must be mutable because it builds the provisional controller result and
advances provisional playback.
`prepare_dynamic_entity_collection` already accepts `FnMut`; the app wrapper currently narrows that
to `Fn` and can expose the stronger existing seam without changing world architecture. A pending
intent or lifecycle request explicitly wakes the exact eligible dynamic body before the scan, as
authored drive already does. Nonphysical/static possession consumes and rejects lifecycle edges on
the no-actuation path so one bad target cannot wedge the contiguous sequence.

Do not route the input edge through the public `launch_explorer_entity` diagnostic mutation. The
controller launch is part of the possessed body's collection actuation. Do not call
`apply_dynamic_entity_kinematics` before the solve: that would split body authority and duplicate a
one-shot mechanism the grounded solver already owns.

## Phased Implementation

### Phase 0: Close Content and Retail Evidence — Complete 2026-08-21

#### Deliverables

- Record the decompile trace above as the controller answer; do not ask content to decide runtime
  selection policy.
- Run a temporary debug-harness census over `MotionSequenceCatalog` for the standard player table and
  the archive-wide spawnable population, reporting:
  - `Ready` and `Falling` cycles and links from locomotion states;
  - whether those commands clear modifiers;
  - `JumpCharging` cycles/links, confirming whether current content contains any authored state; and
  - how many possessable motion tables cannot model the effective charge/falling states.
- Survey the eight offered stances in standard table `0x09000001`, reduce the non-combat locomotion
  cycles and turn omega to base physical facts, and record the selected fallback constants.
- Census every projected creature template across the eight offered stances to size absent and
  present-but-motionless canonical grounded families after signed-command derivation.
- Record the results in this plan and remove the temporary asset-dependent census.

#### Acceptance Criteria

- No contract decision is inferred from command bit class or table reachability alone.
- The plan names the physical and presentation behavior for a possessed table that cannot model
  `Ready` or `Falling`.
- Every hardcoded fallback value has a recorded standard-table source and distinct units/semantics.
- There is no open question that jump remains a controller/body operation rather than a
  `MotionOrder` channel.

#### Decisions and Course Corrections

- The census results and retail consequences are recorded in **Real-content census sizes the
  presentation fallback** and **The standard-character table closes the numeric fallback policy**
  above.
- `JumpCharging` is removed from the implementation vocabulary for this lifecycle: neither retail's
  player producer nor current content supplies it.
- Jump is physically supported for an eligible dynamic body even when target `Ready` or `Falling`
  presentation is missing; the capability reports the target-only presentation hierarchy instead
  of rejecting charge.
- `Ready`/`Falling` content flags do not clear the sidestep layer for us, so the effective order must
  do so explicitly.
- The standard non-combat fallback is `2.6 m/s` walk, `4.0 m/s` run, `1.2 m/s` sidestep, and
  `1.5 rad/s` turn before retail input adjustment and object scaling.
- The temporary `possessed_jump_motion_census` and `possessed_fallback_profile_survey` binaries were
  deleted after recording their output because they depend on local DAT/catalog assets. The same
  applies to the follow-up `possessed_fallback_axis_census` binary.

### Phase 1: Cut Over to a Generation-Bound Possessed Controller — Complete 2026-08-21

#### Deliverables

- Collapse possession identity and controller state into one active-possession type inside
  `ExplorerMotionState` or its direct replacement.
- Issue a new possession generation on every possess and release, including same-GUID re-possession.
- Retire possession as part of despawn, same-GUID entity replacement, and registry reset when the
  exact possessed entity generation disappears; do not let GUID equality preserve old capabilities
  or controller state. A physics-state replacement that preserves entity generation keeps
  possession and is handled by live readiness.
- Replace `ExplorerMotionOrderRequest` / `ExplorerMotionOrder` with the semantic intent contract.
- Extract one pure core adjusted-axis resolver from the existing retail `adjust_motion` math. Use it
  for both possessed `MotionOrder` construction and jump planar resolution; delete the TypeScript
  command/rate mapping and do not duplicate the backward/run/sidestep/turn constants in the app.
- Replace tests that assert distinct `WalkBackwards`/`TurnLeft`/`SideStepLeft` orders with tests for
  the canonical signed families. Keep input arbitration tests proving `S`, `A`, and `D` produce the
  semantic axes; do not let transport tests preserve the incorrect table-command mapping.
- Replace the flat default-style `modelledCommands` receipt with per-offered-stance capabilities
  computed once beside the motion table: modelled stance, composite physical/presentation source for
  every canonical family, jump-presentation source, and charge profile. Add `DualWieldCombat` to the
  offered stance set so the proven 0.8-second path has a real consumer.
- Define one validated app-local `PossessionFallbackMotionProfile` with the surveyed constants and
  provenance comments. Do not put standard table IDs or Explorer fallback policy in `world` or
  `core`, and do not alias it to `CharacterMovementKinematics`.
- Classify each accepted stance family as target-authored physical motion, standard fallback with a
  target-presented command, or standard fallback without that command. The source is computed once
  at the host content/composition boundary and consumed by actuation, playback construction, the
  receipt, diagnostics, and tests.
- Add a focused runtime test that holds standard non-combat sidestep long enough to prove the
  authored selector advances continuously at the reduced cycle displacement; fix the order
  transition structurally if the prep-time repeated reselection reproduces.
- Add revisioned intent replacement and a contiguous lifecycle-edge queue using the proven camera
  invariants without retaining camera-named wire types.
- Move the existing Explorer numeric capability values behind one injected/constructed
  `CharacterJumpKinematics` value; do not introduce a skill-provider trait with one consumer.
- Resolve the stance-dependent charge profile for frontend presentation.

#### Acceptance Criteria

- A late drive or edge from a retired possession cannot affect the active possession.
- Re-possessing the same GUID invalidates the old owner.
- Despawn, entity replacement, and registry reset invalidate the active possession in the same
  registry transaction.
- Drive revisions coalesce; lifecycle edges do not.
- Duplicate, stale, and gapped lifecycle sequences have distinct tested outcomes.
- An unmodelled stance or missing motion table rejects the whole semantic revision without partially
  changing accepted intent; an absent or physically unsuitable axis command selects its declared
  physical fallback.
- Jump input remains enabled for an eligible supported body when `Ready` or `Falling` is unmodelled;
  the receipt exposes the degraded presentation source.
- The host, not the frontend, computes the authoritative `MotionOrder` once.
- Backward/left/run input produces retail's canonical signed command families and rate scalars, with
  differential coverage against the existing retail oracle.
- `S` resolves to negative `WalkForward` at the walk backward factor and, while run is held, the run
  scalar; `A`/`D` resolve to negative/positive `TurnRight` at the correct gait rate.
- Per-stance capability checks accept backward motion when canonical `WalkForward` is modelled and
  both turn directions when canonical `TurnRight` is modelled; they do not require dead separate
  left/back rows.
- A stance whose canonical grounded command is absent or supplies no relevant physical kinematics
  still accepts that semantic drive and reports the precise fallback/presentation source; it does
  not silently no-op or borrow a standard animation.
- The physical fallback implementation carries the required `RETAIL DIVERGENCE:` citation,
  consequence, and creature-template census.
- Standard non-combat authored sidestep sustains the surveyed cycle displacement without repeatedly
  restarting its selector.
- Backward plus turn remains two independent populated axes in one `MotionOrder`; neither selection
  erases the other.
- The project compiles and focused Rust/TypeScript contract tests pass.

#### Decisions and Course Corrections

- `ExplorerMotionState` now owns one `ActivePossession` containing exact entity and possession
  generations, the controller, capabilities, accepted semantic intent, playback order, and pending
  lifecycle edges. Possess and release each reserve a generation; despawn, same-GUID replacement,
  and reset retire the active state under the same registry lock.
- The browser-to-host contract now carries stance plus semantic gait/longitudinal/lateral/turn axes.
  One neutral Rust `CharacterDriveRequest` also replaced the camera-named duplicate DTO; the
  frontend no longer constructs table commands or filters axes against a command list.
- Retail adjustment was extracted to core as `adjust_character_axes`. Possession playback and jump
  resolution consume the same canonical signed `WalkForward`, `RunForward`, `SideStepRight`, and
  `TurnRight` result. The network movement packet path deliberately remains pre-adjustment because
  the server, not the local motion table, owns that interpretation.
- Capabilities preserve the explicit offered-stance order and classify every canonical axis as
  target-authored, standard fallback with target presentation, or standard fallback without target
  presentation. Present-but-motionless and absent rows have separate focused coverage. Dual wield
  is offered and exposes its 800 ms charge profile.
- The validated Explorer profile owns the surveyed fallback constants and jump kinematics. Its
  required `RETAIL DIVERGENCE:` marker records the retail consequence and full creature-template
  census; actual mixed authored/fallback body composition remains Phase 2 work.
- The prep-time sidestep concern reproduced structurally: sidestep and turn IDs can resolve through
  cycles despite carrying both substate and modifier bits, so an absent forward order stopped and
  reselected the same cycle every tick. `MotionRuntimeRegistry` now preserves a dual-class cycle
  only while that exact semantic side/turn channel remains ordered. A ten-second 1.2 m/s fixture
  proves sustained cursor displacement; stale locomotion still stops normally.
- Intent revisions coalesce only after full validation. Lifecycle edges retain gaps in an ordered
  queue and reject duplicates independently. Same-GUID re-possession, release, despawn,
  replacement, reset, stale revisions, invalid stances, missing motion tables, source
  classification, and atomic rejection all have focused tests.
- Phase 1 verification passed: 191 app Rust tests, 214 core tests, 415 world tests, 10 focused
  TypeScript tests, frontend type/Svelte checks, formatting, and Clippy with warnings denied.

### Phase 2: Integrate Jump and Effective Motion in the Collection Tick — Complete 2026-08-21

#### Deliverables

- Apply pending controller events at the start of the exact possessed entity's collection tick.
- Sample heading and `CharacterJumpReadiness` from the canonical body used by that tick.
- Let `tick_dynamic_entity_collection` expose its underlying mutable actuation callback; use that one
  callback to propose controller state, possessed playback, authored grounded actuation, event
  outcomes, and an accepted `GroundedLaunch` before the body solve.
- Commit the proposal only for a returned `Solved` tick of the exact possession generation. Retain
  its queued input and prior playback on either solver-budget status or an omitted dynamic-contact
  budget result.
- Reconcile provisional playback at zero elapsed time when the solved body's contact classification
  differs from the pre-solve effective contact; publish the reconciled clip without applying its
  authored offset until the next tick.
- Wake an eligible possessed dynamic body when a new intent or lifecycle edge arrives. Consume and
  reject edges explicitly when the target has no grounded dynamic response instead of waiting for a
  collection callback that cannot occur.
- Derive authored order from retained semantic intent:
  - moving charge: current longitudinal, sidestep, and turn intent remains effective;
  - standing charge: forward/sidestep output is suppressed while retained intent survives;
  - airborne/sliding: select `Falling`, suppress sidestep, and retain allowed turning;
  - supported after landing: restore retained locomotion without a new frontend command.
- Select physical source independently for each effective grounded axis. Convert target-authored
  offsets once, fill only absent or present-but-motionless planar/turn channels from the fallback
  profile, and construct one complete actuation so mixed authored/fallback drive cannot double-count
  a channel.
- Allow an eligible supported body to charge and launch without target `Ready` or `Falling`.
  Publish the capability's deterministic target-only presentation fallback and add the required
  `RETAIL DIVERGENCE:` marker at the implementation decision.
- Ensure reset clears pending charge and effective motion at its revision barrier.
- Produce typed event outcomes sufficient for the frontend to reject an optimistic charge bar and
  report fallback presentation/source, nonphysical response, unsupported contact, or airborne
  release.
- Treat an invalid canonical body heading or invalid constructed launch as an internal tick failure,
  not a user-action rejection: those values violate host-owned numeric invariants.

#### Acceptance Criteria

- One release produces at most one launch.
- A solver-held launch produces no success outcome or `Falling` playback and retries from the still
  queued edge; controller, playback, and body cannot split across the failure path.
- Launch is carried only by `GroundedBodyActuation::with_launch`; the controller path performs no
  pre-solve `apply_dynamic_entity_kinematics` mutation.
- The launch uses release-time drive and heading plus same-tick support readiness.
- An unsupported or nonphysical possessed entity rejects jump without wedging later edge sequences.
- Missing `Ready`/`Falling` presentation does not reject an otherwise valid jump; target-authored
  presentation follows the declared hierarchy while the physical launch remains unchanged.
- A standing charge does not translate or sidestep, but retained input is not destroyed.
- A moving charge continues its authored/fallback locomotion.
- The accepted launch tick itself selects target `Falling` when available or the declared
  target-only presentation fallback; later airborne ticks retain that choice and landing restores
  the retained order.
- Walking off support publishes target `Falling` or the declared target-only presentation fallback
  in the departure tick, and landing publishes restored retained intent in the landing tick;
  neither contact-edge reconciliation drives the body twice.
- Turn behavior matches the retail trace throughout charge and airborne motion.
- Body position and published path describe the same tick; playing-clip state either agrees through
  target-authored presentation or explicitly reports the fallback source that explains the visual
  mismatch.

#### Decisions and Course Corrections

- `HostSimulationRuntime::tick_dynamic_entity_collection` now exposes the mutable callback its world
  primitive already supported. Explorer clones only the exact possessed controller and
  `BodyMotionRuntime`, builds one provisional actuation inside that callback, and commits both only
  when the returned exact-generation tick has `Solved` status. Unpossessed idle playback remains
  independent; cloning the complete 50-300 body registry would add cost without an acceptance
  invariant.
- A focused dynamic-contact over-budget scenario proves the failure path: the held/omitted solve
  publishes neither jump success nor `Falling`, leaves the canonical body unlaunched, and retains
  the release edge. Removing the peer lets the next tick consume and launch from that edge once.
- Effective presentation order is derived from controller state and contact on every proposal.
  Standing charge selects target `Ready` when available and suppresses translation; moving charge
  retains locomotion; launch/airborne/sliding select target `Falling` when available and suppress
  sidestep; a zero-time post-solve reconciliation restores retained order on landing without a
  second authored offset.
- Per-axis actuation filters the one target-authored rigid offset by its resolved capability source,
  then fills only unsuitable forward, sidestep, or turn channels from the app-local profile. Object
  scale is applied once to both target and fallback translation. A mixed authored-forward/fallback-
  sidestep runtime test proves both channels move and the fallback is not double-counted; absent
  target turn presentation still rotates the body.
- Jump uses release-time drive, canonical body heading/contact, and the injected
  `CharacterJumpKinematics`, then reaches the solver only through
  `GroundedBodyActuation::with_launch`. No diagnostic launch or pre-solve kinematic mutation is in
  the controller path.
- Missing `Ready`/`Falling` never disables physical jump. The implementation-site
  `RETAIL DIVERGENCE:` marker records the decompile consequence and the 4,999/7,788 census. Focused
  tests cover both target-authored `Ready` -> `Falling` and stance-default fallback, retained
  airborne turn, landing restoration, and one-release/one-launch behavior.
- Lifecycle outcomes are generation/sequence-bound tagged values. Solved ticks publish charge,
  release, reset, rejection, and selected jump-presentation facts on a dedicated app-local event.
  Pose-only/non-grounded-response targets drain contiguous edges synchronously through the command
  receipt, rejecting jump work without waiting for a collection callback or wedging later reset.
- Reset clears controller charge and effective drive at its intent revision barrier. Newer
  replaceable intent is applied only after ordered edge snapshots, matching the proven camera
  ordering without retaining camera-named contracts.
- Phase 2 verification passed: 198 app Rust tests after the new transactional/fallback/jump cases,
  focused TypeScript receipt/outcome tests, frontend type/Svelte checks, formatting, and Clippy with
  warnings denied.

### Phase 3: Wire the Frontend and Prove the Vertical Slice — Complete 2026-08-21

#### Deliverables

- Move/rename `GroundedCharacterInput` to the neutral `CharacterInputController`, then route its
  edges through the generation-bound possession session. Update the temporary grounded-camera
  caller to the shared name until Phase 4 deletes that caller; do not leave a compatibility alias.
- Attach the current semantic revision and complete stance/drive snapshot to every edge; make reset
  establish the ownership barrier described above.
- Replace the character input controller's constructor-fixed charge duration with the accepted
  stance's current profile. Recompute extent against the same charge start when stance changes,
  matching retail's live style sampling, including the 0.8-second dual-wield case.
- Split canvas event routing and neutral look state from `FreeFlyCameraController`. Replace
  `setLocalTranslationEnabled` with the tagged frontend control scheme and one atomic transition
  that clears the outgoing owner's held state.
- Implement the possessed-character routing table above. In particular, never retain `A`/`D` in a
  camera keyboard-yaw set while possession owns them; primary-button drag is the only possession
  orbit input, and Shift affects gait without changing pointer sensitivity.
- Export that routing as the reusable third-person character profile; `ExplorerApp` selects it and
  injects its possession sink rather than spelling the bindings itself.
- Move the boom controller/session and injected sweep-source contract under
  `src/lib/game/controls/`; keep Explorer/Tauri/harness adapters and active-regime composition at the
  entry points. `ClientApp` must be able to import the character/third-person controllers without an
  import through `src/explorer/`.
- Gate only invalid stance/body actions from the receipt capabilities while preserving host-side
  typed validation as the authority. Keep grounded drive and jump available when their physical
  source is fallback, and surface the source as diagnostics/presentation quality rather than a
  disabled control.
- Clear frontend possession/input ownership when entity delivery retires or replaces the exact
  possessed entity generation; stale-generation command rejection remains the backstop.
- Surface typed begin/release rejection to the existing Explorer error/presentation boundary; do not
  add debug-only production history.
- Extend `crates/holtburger-debug-harness` and/or the canonical browser harness with non-interactive
  possession commands and state probes.
- Run a deterministic scenario that spawns a grounded player-like entity and proves ordinary
  possession first:
  - `S` produces displacement opposite the body's starting forward vector and a reversed authored
    clip rate;
  - `A` and `D` produce opposite signed entity-heading changes without planar translation or a
    camera-yaw change when used alone;
  - held backward plus turn changes both position and heading in the same accepted tick sequence;
  - releasing either axis leaves the other effective; and
  - no capability gate silently drops these supported canonical commands.
- Continue the scenario through primary-button drag and wheel input, proving drag changes camera
  yaw/pitch without changing entity heading, wheel changes boom distance, and neither input emits a
  semantic character drive.
- Continue that same scenario through forward locomotion, charge, release, positive ascent,
  `Falling`, landing, and retained-input restoration.
- Add fixtures or selected entities covering an absent canonical grounded command, a present but
  physically motionless command, and missing `Falling`. Prove both grounded channels still
  displace/turn the physical body at the surveyed fallback rate, the motionless command retains its
  target clip, the absent command never borrows a standard-player clip, Space still launches, and
  the receipt/state probe identifies every fallback source.
- Capture browser errors and the relevant machine-readable body/clip state. Add a screenshot only if
  it materially proves visual agreement beyond the state evidence.

#### Acceptance Criteria

- Window blur stops drive and cancels an in-flight charge.
- Switching into or out of possession clears the outgoing held state once; a key held across the
  transition cannot drive both regimes or become active in the new one without a new press.
- No missing async edge silently strands future input; transport failure retires the ownership epoch
  or otherwise fails loudly.
- Normal and dual-wield charge durations are covered.
- A supported stance change during charge changes the live extent denominator without restarting the
  charge; an unsupported stance change is rejected without changing the accepted profile.
- The browser harness proves backward displacement, both turn signs, combined backward-plus-turn,
  and independent axis release from canonical body pose/path plus playing-clip state—not merely from
  emitted key or intent events.
- Frontend unit tests cover every row of the possession control table. The browser harness proves
  the critical ownership split from camera pose plus entity state: keyboard turn leaves camera yaw
  unchanged, pointer orbit leaves entity heading unchanged, and wheel affects only boom distance.
- No reusable control module imports `src/explorer/`, and `setLocalTranslationEnabled` no longer
  exists.
- The browser harness proves charge, one launch, positive ascent, airborne `Falling`, landing, and
  retained-order restoration without running the TUI.
- The browser harness proves mixed authored/fallback actuation without double-counting, plus a jump
  whose target lacks `Falling`; the physical result succeeds and the presentation degradation is
  explicit.
- Rust tests, frontend unit tests, type checking, lint, and the focused browser harness pass.

#### Decisions and Course Corrections

- `GroundedCharacterInput` was cleanly moved and renamed to the shared
  `CharacterInputController`; the old module and compatibility vocabulary were not retained. Its
  live charge duration can now change without replacing the active charge start, with focused
  normal/dual-wield denominator coverage.
- The canvas controller moved under `src/lib/game/controls/` as `FrontendCameraController` and now
  selects one closed `FrontendControlScheme` instead of toggling local translation. Possessed and
  temporary grounded-character schemes do not admit keyboard camera yaw, free-camera pan, local
  wheel translation, or Shift pointer precision. Focus loss and scheme transitions clear held
  state. Focused tests prove `A` reaches only the character sink while camera yaw stays fixed, and
  pointer orbit has identical sensitivity with and without Shift.
- Reusable look, character, boom controller/session, boom-sweep contract, and complete
  third-person binding profile now live under `src/lib/game/controls/`. Explorer/Tauri and browser
  harness HTTP sweep adapters remain at their entry points; no shared control module imports an
  Explorer or Tauri module.
- Possession jump/reset edges now carry their edge-time drive, accepted stance, semantic revision,
  lifecycle sequence, and exact possession generation. The frontend consumes both synchronous
  command-receipt outcomes and the dedicated fixed-tick outcome event, ignores retired generations,
  cancels a rejected optimistic begin, and reports the typed reason through the existing
  presentation-error boundary.
- Entity delivery now retires frontend possession immediately when the exact entity generation is
  absent. The input controller has a distinct local ownership-release operation so this path does
  not send work to an already-retired host generation; stale-generation rejection remains the host
  backstop.
- The development content host and canonical browser-harness adapter now expose non-interactive
  possess, semantic-intent, lifecycle-edge, and possession-tick operations. The possession tick
  preserves typed lifecycle outcomes beside the ordinary body/clip event instead of discarding the
  evidence at the HTTP boundary. A read-only host probe reports the exact stance, substate,
  modifiers, and playing clip without exposing mutable registry ownership.
- A temporary content survey selected and then removed three exact browser fixtures: WCID 1
  (`Clay`, standard table `0x09000001`) for ordinary authored control; WCID 3 (`Olthoi Worker`,
  table `0x09000002`) for an absent sidestep and no `Falling`; and WCID 14 (`Cow`, table
  `0x0900000d`) for a present-but-motionless sidestep. The same scenario waits for authoritative
  grounded contact, then proves backward signed playback/displacement, both turn signs, combined
  motion, independent release, pointer/keyboard/wheel ownership, charge, one launch, ascent,
  target `Falling` only when available, landing, retained forward order, fallback distance at the
  adjusted `1.4976 m/s` profile rate, target-clip retention for the motionless row, and no borrowed
  sidestep state for the absent row. All three fixture runs passed without browser errors.
- The browser run exposed one harness assumption rather than a runtime defect: the default harness
  camera spawns the subject far above terrain. The scenario now requires the Explorer terrain-focus
  pose and advances until the exact body reports grounded contact instead of sleeping a guessed
  duration. The Cow can be terrain-blocked immediately after landing, so retained-input restoration
  is asserted from the host's exact `RunForward` playback state; the ordinary Clay and Olthoi runs
  separately prove restored physical translation.
- A lifecycle-edge transport failure now reports through the existing presentation boundary,
  attempts host release, and retires the same frontend ownership generation. This prevents one
  missing sequence from silently stranding every later edge.
- Phase 3 verification passed: 1,313 TypeScript tests, 198 app Rust tests, frontend type/Svelte
  checks, ESLint, dead-export lint, Rust formatting, and Clippy with warnings denied. The focused
  browser command was `npm run harness:browser -- --spawn-wcid <1|3|14>
  --possession-scenario --explorer-focus --brief --settle-ms 500`.

### Resteer A: Audit the Character Vertical Slice

Before deleting the grounded camera, dry-run the completed possessed path against the remaining
phases:

- confirm the Explorer and future-client provider boundary still differs only at resolved numeric
  inputs;
- verify the shared frontend control modules have no Explorer/Tauri dependency and that each raw
  input has one owner in every surviving control scheme;
- audit for duplicated `CharacterDrive`/`MotionOrder` derivation and delete any second authority;
- verify every possession-generation transition clears controller, queue, and playback state;
- inspect the data distribution from Phase 0 against the capability/rejection policy implemented in
  Phase 2;
- enumerate all surviving consumers of grounded-camera types; and
- decide whether Phase 4 needs subdivision before beginning the cutover.

The plan is updated with findings before Phase 4 starts.

#### Audit Findings — Complete 2026-08-21

- The future-client boundary differs only at injected values and transport: shared browser modules
  own raw-key arbitration, look, and boom behavior; the entry point supplies charge duration,
  tuning, sweep source, and a semantic character sink. Explorer GUID possession and Tauri/HTTP
  adapters remain outside `src/lib/game/controls/`. A dependency grep found no Explorer or Tauri
  import in that shared directory.
- The tagged scheme gives each raw input one owner. Free fly owns keyboard camera translation/yaw,
  physical fly owns host camera translation/yaw, and possessed character owns the complete
  character key set while primary drag and wheel route only to look/boom. The temporary grounded
  scheme is the only remaining extra character consumer and is removed in Phase 4.
- There is one authoritative Rust `CharacterDrive` and one host-side `MotionOrder` derivation for
  possession. TypeScript's isomorphic `CharacterDrive` is the typed wire DTO consumed by both the
  shared controller and possession adapter; it does not derive commands or numeric rates. The
  grounded camera remains the only second physical-drive authority, through
  `resolve_character_drive`, and is exactly Phase 4's deletion target.
- Possess, re-possess, release, exact entity retirement/replacement, registry reset, and failed-edge
  teardown all clear controller ownership. Host tests cover the generation barrier and queue/
  playback retirement; frontend entity delivery additionally clears the exact retired generation.
- Phase 2 policy matches the Phase 0 distribution: fallback-capable axes remain enabled, missing
  target presentation is diagnostic rather than a gate, and missing `Ready`/`Falling` does not
  remove physical jump. The real WCID 3 and 14 browser fixtures exercise both absent and
  present-but-motionless sides of that policy.
- Surviving grounded-camera consumers are confined to `host_camera_runtime` contract/control/
  presentation/tests, four Tauri command/registration seams, `physical-camera-session` and its
  transport/tests, the `grounded-walk` Explorer mode/UI branch, the temporary
  `groundedCharacterInput`, and `resolve_character_drive` plus its core tests. There is no hidden
  client or harness consumer.
- Phase 4 does not need subdivision. These consumers form one closed feature slice and keeping an
  intermediate compatibility mode would preserve dead wire variants and violate the clean-cutover
  requirement. Physical-fly registration/scheduling remains untouched until Resteer B.

### Phase 4: Retire the Synthetic Grounded Camera — Complete 2026-08-21

#### Deliverables

- Delete `resolve_character_drive` and its continuous leave-ground-formula tests.
- Delete `GroundedWalk`, `GroundedCharacter`, `GroundedCameraDriveRequest`, grounded event/outcome
  camera types, and their frontend/Tauri command paths.
- Delete grounded-camera capability and charge-profile transport now owned by possession.
- Delete the unreachable `CharacterJumpReadiness::Constrained` and corresponding rejection/mapping;
  do not preserve a test-only variant for a positional tether subsystem that does not exist.
- Rewrite or delete tests that preserve the removed multi-mode camera architecture.
- Sweep `GroundedWalk`, `grounded-walk`, `GroundedCamera`, and `GroundedCharacterInput` vocabulary
  from `apps` and `crates`.
- Update the root-motion plan's leave-ground debt row as closed, preserving its historical reasoning.

#### Acceptance Criteria

- `grep -rn "GroundedWalk\|grounded-walk\|GroundedCamera\|GroundedCharacterInput" apps crates`
  returns nothing.
- `resolve_character_drive` has no surviving definition, export, or test.
- Physical fly, free fly, boom follow, and possessed-character control still pass their focused
  runtime checks.
- No camera pose, free-fly, or boom module owns character-controller state or lifecycle edges; the
  neutral control router only dispatches raw input to the active scheme's injected owner.

#### Decisions and Course Corrections

- The deletion was one closed feature slice as Resteer A predicted. The host lost the grounded mode,
  capability contract, drive snapshot, ordered edge queue, lifecycle outcomes, jump-charge receipt,
  first-person body offset, and both Tauri commands together; no compatibility variant survives.
- `HostCameraRuntime` now has one physical-fly control state rather than a one-variant character/fly
  router. Its generation checks, scheduler registration, terminal failure event, monotonic intent,
  and bounded cumulative-displacement behavior remain intact for Resteer B to classify.
- The frontend camera controller retains only three honest schemes: frontend free fly, host physical
  fly, and possessed character. Raw character keys are published only for possession; camera and
  boom code own no `CharacterInputController`, charge state, lifecycle edges, or rejection repair.
- The old camera jump power bar CSS and Explorer tuning constants were deleted with their final
  consumer. This avoids a misleading dormant presentation path.
- `CharacterJumpReadiness::Constrained` and its possession rejection mapping were unreachable: no
  positional-tether producer existed. Airborne and unsupported-contact rejection remain complete.
- Verification after the cutover: 213 core Rust tests and 187 app Rust tests pass; all 1,309 tests
  across 173 TypeScript files pass; `npm run check` is clean. The required `apps`/`crates` vocabulary
  sweep and `resolve_character_drive` sweep both return no matches.

### Resteer B: Measure What Remains of `HostCameraRuntime`

Do not carry the first draft's generic-body-session conclusion forward. After Phase 4, measure the
surviving physical-fly runtime and classify each responsibility before moving it:

| Surviving guarantee                                                            | Expected owner after grounded deletion                                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| A stale replaceable tick cannot write after re-registration                    | Focused physical-fly session adapter; preserve the double generation check around the lock                 |
| Exactly one replaceable task is installed                                      | Focused physical-fly scheduler adapter                                                                     |
| Host-side tick failure terminates the generation and reports it                | Physical-fly adapter plus its app event sink                                                               |
| Velocity intent cannot regress or replay                                       | Physical-fly input accumulator                                                                             |
| Cumulative displacement is consumed exactly once and within the per-tick bound | Physical-fly input accumulator                                                                             |
| Body and viewer cells resolve independently                                    | Generic body placement plus a pure viewer-projection function                                              |
| Registration residency is normalized and validated                             | Physical-fly registration adapter                                                                          |
| Entity solves before physical fly                                              | Re-prove a live consumer; delete the ordering guarantee if none remains, because the boom is not this body |
| Grounded control cannot carry physical-fly acceleration state                  | Delete with the second control variant; one variant needs no tag                                           |
| Camera mode matches body response                                              | Delete with the second mode; validate the one physical-fly profile directly                                |

The default expected landing is a much smaller, honestly named physical-fly adapter over
`HostSimulationRuntime`, not a generic session shared with entities. Extract a reusable lifecycle
primitive only if the reduced code shows a second consumer with the same lifetime, ordering, failure,
and input semantics.

#### Findings — 2026-08-21

- The remaining host slice is 1,061 production Rust lines plus 729 focused test lines. Its only live
  consumer is Explorer physical fly; entity simulation shares the fixed clock and body registry,
  but not this generation, input, viewer, failure, or transport lifecycle. A generic session
  extraction would therefore have one consumer and is rejected.
- The double generation check around the runtime lock still protects a live race: an old scheduled
  tick may pass its first check, wait behind registration, and must not commit over the replacement.
  The exact scheduler registration stored on the active session likewise prevents an old stop or
  failure from removing the replacement.
- Monotonic intent sequence, movement epoch, ramp elapsed time, and applied cumulative displacement
  form one physical-fly input accumulator. They remain colocated because each accepted command and
  tick updates this single ownership epoch atomically.
- Body placement and viewer portal placement remain distinct live consumers. The body resolves its
  response sphere/cell in `HostSimulationRuntime`; the viewer independently transits the 0.3 m
  retail viewer sphere and publishes the portal-seeded path used by frontend residency.
- Registration residency parsing/normalization and terminal Tauri failure delivery remain
  physical-fly adapter concerns. Neither has a second lifecycle-identical consumer.
- Entity-before-fly execution has no physical-fly consumer: the collision scene contains static
  products, not inter-body collision, and the fly solve does not read entity results. The shared
  scheduler's reservation order may remain deterministic, but Phase 5 will not preserve or test it
  as a camera guarantee.
- The mode/response matcher, one-variant mode enum, tagged control request, caller-supplied body
  profile, and path/status mode are vestiges. Phase 5 will construct and validate the sole
  physical-fly profile directly inside the adapter.
- **Course correction:** no view-direction interpolation survives Phase 4. Direction affected only
  the deleted grounded first-person offset; physical fly always projected the viewer at zero body
  offset. Carrying `viewDirection` now validates and transports an unconsumed fact. Phase 5 will
  delete it and preserve the actually live guarantee instead: every accepted body-path fraction is
  portal-transited for the independent viewer sphere. The `acclient.c:138800-138918` viewer-sphere
  citation remains on that projection.
- Phase 5 does not need subdivision. Rename the slice to `HostPhysicalFlyRuntime`, collapse the
  registration/control/path contracts around the one response, retain the proven accumulator and
  generation lifecycle, and rename the frontend session/path surface in the same clean cutover.

### Phase 5: Reduce the Physical-Fly Adapter and Clean Up — Complete 2026-08-21

#### Deliverables

- Delete the multi-mode `HostCameraRuntime` shape.
- Reduce viewer projection to a focused function while preserving per-fraction view-direction
  interpolation and the `acclient.c:138800-138918` citation.
- Rehome physical-fly intent accumulation, replaceable task lifecycle, registration parsing, and
  failure delivery according to Resteer B's measured owners.
- Prefer a focused `HostPhysicalFlyRuntime` (or smaller equivalent) over a speculative generic body
  session unless the resteer proves genuine reuse.
- Delete obsolete mode tags, response matching, contracts, scheduler assumptions, tests, comments,
  metrics, and UI labels in the same change.
- Record any surviving physical-fly complexity with its concrete guarantee and consumer.

#### Acceptance Criteria

- No type named `HostCameraRuntime` survives.
- The remaining adapter owns only physical-fly-specific control/session concerns; canonical body
  state and solving remain in `HostSimulationRuntime`.
- Every row in Resteer B has a tested live owner or an explicit deletion rationale.
- The viewer function preserves portal placement and interpolation behavior.
- No generic lifecycle abstraction exists with only one real consumer.

#### Decisions and Course Corrections

- `host_camera_runtime` is now `host_physical_fly_runtime`, and `HostCameraRuntime` is now the
  single-purpose `HostPhysicalFlyRuntime`. Its internal modules state their actual jobs:
  `input` owns the atomic intent accumulator, while `viewer_projection` owns independent portal
  placement. No generic lifecycle primitive was extracted because Resteer B found no second owner.
- The Tauri and frontend surfaces cut over with it: `start_physical_fly`,
  `set_physical_fly_intent`, `stop_physical_fly`, `PhysicalFlySession`, `PhysicalFlyTransport`, and
  `HostPhysicalFlyPath`. Event names are now `host://physical-fly-*`; no compatibility command,
  event, file, or type alias survives.
- The one-variant mode, tagged control request, caller-selected body profile, collision-exclusion
  wire list, path/status mode field, and their host request types/tests were deleted. The adapter
  resolves `physical_fly_viewer_profile()` directly and applies Explorer's proven water-barrier
  exemption when constructing `ResolvedPhysicalBodyRegistration`.
- `viewDirection` was removed from registration, intent identity, and every host/frontend test. It
  had no consumer after grounded-camera deletion; camera orientation remains frontend-owned and
  semantic entity-facing snapshots are captured separately where possession needs them.
- The live lifecycle guarantees stayed intact and tested: double generation check, exact scheduler
  registration removal, terminal failure delivery, monotonic input sequence, movement-epoch ramp
  restart, one-time bounded cumulative displacement, independent body/viewer cell resolution,
  normalized registration residency, portal crossings at intermediate path fractions, and exact
  endpoint commit.
- Phase 5 verification passed: 185 app Rust tests; Clippy identified one now-visible `clone` on the
  reduced `Copy` accumulator, which was removed; all 1,309 TypeScript tests, frontend checks, ESLint,
  and knip pass. Final workspace Clippy and browser fixtures remain Phase 6 gates.

### Resteer C: Final Audit Scope — Complete 2026-08-21

- Shared controls under `src/lib/game/controls` have no Explorer, Tauri, transport, or app-shell
  imports. `ClientApp` can import them without pulling Explorer composition; it does not instantiate
  them yet because the client entry point is still only a route shell, and inventing that wiring is
  outside this plan.
- Explorer alone owns the standard fallback constants, possession stance/menu policy, Tauri/HTTP
  adapters, optimistic rejection presentation, boom sweep source, and physical-fly error/status UI.
  Shared code owns only device-neutral input, camera look, boom mechanics, semantic axes, and retail
  jump resolution.
- The two deliberate fallback departures retain complete markers: each cites `acclient.c`, states
  what would break if retail behavior were required, and records the 2026-08-21 creature census.
- No temporary census fixture or asset-dependent test remains. The only `diagnostic` references in
  the touched slice are durable product diagnostics/path-gap provenance, not investigation hooks.
- The final gate needs no expansion: workspace format/Clippy/tests, frontend check/ESLint/knip/tests,
  then the three already-proven WCID 1/3/14 browser possession scenarios. A visual screenshot is not
  needed because the acceptance facts are host pose, playback, controller isolation, and boom state.

### Phase 6: Final Architecture and Vocabulary Audit — Complete 2026-08-21

#### Deliverables

- Inspect every touched shared type against the crate-boundary rules and future 3D client target.
- Confirm Explorer-only timing, error presentation, and input ownership remain app-local.
- Confirm the shared character input, look, and third-person boom controllers can be imported by
  `ClientApp` without importing Explorer composition or transport.
- Remove temporary diagnostics and asset-dependent census tests.
- Sweep deleted vocabulary through code, tests, docs, metrics, and UI.
- Update this plan with implementation findings, concessions, and any deliberately carried debt.
- Run formatting, Clippy with warnings denied, workspace tests, frontend gates, and focused browser
  harness scenarios.

#### Acceptance Criteria

- Touched code has one authoritative semantic drive and one authoritative body state.
- No dead grounded-camera compatibility layer or alias survives.
- No temporary runtime-asset test remains in the repository.
- All relevant automated and runtime verification gates pass, or a proven unrelated failure is
  recorded precisely.

#### Decisions and Course Corrections

- The final ownership audit confirmed one authoritative semantic drive (`CharacterDrive`) and one
  authoritative simulated body state. Shared controls import no Explorer or transport code;
  Explorer retains regime selection, timing, fallback policy, adapters, and error presentation.
  `ClientApp` is import-ready but remains a route shell, so this plan does not invent a premature
  client-mode composition root.
- The deleted-vocabulary census is empty across `apps` and `crates` for `GroundedWalk`, grounded
  camera types and commands, `resolve_character_drive`, `HostCameraRuntime`, its old module name,
  and the removed generic physical-camera mode/control contracts. No compatibility alias survived.
- The root-motion debt ledger now closes its stale claim that the browser harness cannot drive
  possession. The replacement evidence is the WCID 1/3/14 possession scenario, which exercises the
  real host boundary and asserts entity/camera input isolation, body motion, jump lifecycle,
  fallback sidestep, playback evidence, and boom state.
- The deliberately surviving concession is presentation-only: when a target lacks a physically
  suitable authored command, the app-owned standard profile supplies body motion or jump
  kinematics, but the controller never fabricates or retargets an animation. The capability DTO and
  complete retail-divergence markers expose that limitation rather than silently degrading it.
- Final verification passed: `cargo fmt --all -- --check`; workspace Clippy with warnings denied;
  the complete workspace test suite; all 1,309 TypeScript tests; Svelte/TypeScript checks, ESLint,
  knip, and Prettier; and browser possession scenarios for WCID 1, 3, and 14. The workspace test
  scripting listener required its normal local-listener sandbox permission and then passed; no
  product failure was suppressed.
- A post-completion quality pass reran the matrix after the landing-clip and motion-boundary fixes:
  1,311 TypeScript tests and 186 app-host Rust tests pass, as do workspace formatting, Clippy, and
  the relevant `world`, `core`, app-host, and debug-harness suites. WCID 23 additionally exposed a
  false transport invariant: attack hook `partIndex` is attack-result metadata, not a render-part
  index (`acclient.c:308215`). An archive census found 46 of 1,053 attack hooks outside their
  animation's render-part range. Removing only that validation lets Virindi Servant stage all 22
  reachable animations with an empty browser console; visual hook part bounds remain enforced.

## Risks and Mitigations

| Risk                                                                       | Mitigation                                                                                                                               |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Async Tauri delivery lets an old owner drive a new possession              | Host-issued possession generation on every request; test same-GUID re-possession and late delivery                                       |
| Coalescible drive overtakes a lifecycle edge                               | Shared revisions plus a contiguous edge queue; each edge carries the complete contemporaneous stance/drive snapshot                      |
| Launch samples one body state and solves another                           | Resolve from the collection callback's tick-start body and attach one `GroundedLaunch` to that body's actuation                          |
| A budget-held solve consumes release or publishes `Falling` without launch | Build a provisional possessed proposal; commit it only for the exact body's returned `Solved` tick                                       |
| Authored locomotion lags a launch, ledge departure, or landing by one tick | Derive pre-solve order from effective contact, then zero-time reselect against returned solved contact before publishing the clip        |
| Standing-charge suppression destroys held input                            | Separate retained intent from effective motion and restore it when the temporary state ends                                              |
| Capability checks preserve the current broken left/back mapping            | Derive support from canonical `WalkForward`/`TurnRight` families and test supported `S`/`A`/`D` through the body path                    |
| Mixed authored and fallback axes double-apply root motion                  | Classify physical suitability once per channel, combine once into one actuation, and test mixed-channel displacement                     |
| Hardcoded fallback constants drift into unexplained magic numbers          | Keep one typed app-local profile with standard-table provenance, units, validation, and no duplicate constants                           |
| Standard sidestep repeatedly reselects instead of advancing                | Focused sustained-playback test from the surveyed non-combat cycle; repair the selector transition before relying on authored sidestep   |
| A raw key remains owned by both camera and character paths                 | Replace the translation boolean with one tagged control scheme, clear state on transition, and test camera pose alongside entity heading |
| Reuse work turns Explorer policy into a generic frontend god object        | Share focused character/look/boom mechanisms only; keep regime selection, adapters, errors, and UI composition at each entry point       |
| Arbitrary possessable content lacks `Ready` or `Falling`                   | Preserve physical jump, use only deterministic target-authored/default presentation, and report the divergence/source                    |
| Explorer constants masquerade as actor simulation                          | Construct one resolved `CharacterJumpKinematics` value and document the later playable-client provider                                   |
| Requested stance and actual playback diverge                               | Validate stance plus drive atomically, retain one accepted intent, and gate the UI from per-stance capabilities                          |
| Stance and charge-bar timing diverge                                       | Sample the accepted stance profile throughout the charge and test an in-flight transition involving dual wield                           |
| Public diagnostic launch becomes gameplay plumbing                         | Keep controller launch internal to the entity tick; the public mutation remains diagnostics-only                                         |
| Removing grounded camera regresses physical fly or boom                    | Focused tests and browser harness checks before and after the clean cutover                                                              |
| A generic session becomes a new god abstraction                            | Resteer after deletion, classify each guarantee by owner, and require two isomorphic consumers before extraction                         |

## Open Questions

None. The grounded-axis and jump fallback policy, constants and ownership, stance authority, charge
profile, same-tick launch/motion ordering, solver transaction seams, possession control scheme, and
frontend reuse boundary were closed during prep. New contradictory evidence discovered during
implementation triggers the named resteer rather than an implicit design change.

## Definition of Done

- [x] Retail charge, release, standing-long-jump, and airborne selection behavior is recorded from
      the decompile, with content census used only for authored availability.
- [x] Every possession has a host-issued generation, and all drive/edge requests target it.
- [x] The frontend sends semantic character intent; the host computes `MotionOrder` once.
- [x] Possessed authored order and jump planar velocity share the retail-adjusted axis resolver; no
      frontend or app-local command/rate reimplementation survives.
- [x] Every canonical grounded family in an accepted stance has one composite target/fallback
      physical-and-presentation source; mixed actuation fills absent or motionless channels once
      without animation retargeting or double-counting.
- [x] The surveyed fallback constants and physical-suitability threshold have focused tests using
      runtime constants rather than duplicated magic numbers.
- [x] `S`, `A`, and `D` produce proven backward displacement and both signed heading changes on the
      possessed body, including simultaneous backward-plus-turn and independent axis release.
- [x] Possession has one explicit control scheme: keyboard movement/turn/jump affects only the
      entity, primary-button drag affects only camera orbit, and wheel affects only boom distance.
- [x] Reusable character input, look, and third-person boom controllers live under
      `apps/holtburger-3d/src/lib/game/controls/`; neither they nor `ClientApp` depend on
      `src/explorer/`.
- [x] Jump begin/release/reset edges are contiguous, stale-safe, duplicate-safe, and revision-safe.
- [x] An accepted release launches the exact possessed body once inside its collection tick.
- [x] Missing target `Ready`/`Falling` does not disable physical jump; target-only fallback
      presentation and the required retail-divergence marker make the visual limitation explicit.
- [x] Per-stance capabilities reject unmodelled stances while reporting the source of every usable
      locomotion and jump-presentation channel; no missing command becomes a silent partial state.
- [x] Standing charge, moving charge, `Falling`, turning, landing, and retained-order restoration
      match the proven retail behavior.
- [x] Explorer kinematics and stance-dependent charge timing have explicit providers without skills
      or vitals.
- [x] The browser harness proves the complete vertical slice without running the TUI.
- [x] `resolve_character_drive`, `GroundedWalk`, and all grounded-camera wire/frontend vocabulary are
      deleted.
- [x] `HostCameraRuntime` is dissolved into measured, focused owners without a one-consumer generic
      body-session abstraction.
- [x] The root-motion debt record is updated and surviving debt is explicit.
- [x] Formatting, Clippy with warnings denied, workspace tests, frontend checks, and focused runtime
      verification pass.
