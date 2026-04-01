# Guide: Implementing Autonomous Client-Side Movement

This guide describes how ACE handles player-authored movement and what that means for a client that wants to drive movement locally. The goal is not just to decode packets, but to explain the server invariants an autonomous client must respect to avoid sliding, rubber-banding, or anti-cheat corrections.

The ACE server is the ground truth for all claims below. The most important source files are:

- [ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionMoveToState.cs](../ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionMoveToState.cs)
- [ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionAutonomousPosition.cs](../ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionAutonomousPosition.cs)
- [ACE/Source/ACE.Server/Network/Motion/MoveToState.cs](../ACE/Source/ACE.Server/Network/Motion/MoveToState.cs)
- [ACE/Source/ACE.Server/Network/Motion/RawMotionState.cs](../ACE/Source/ACE.Server/Network/Motion/RawMotionState.cs)
- [ACE/Source/ACE.Server/Network/Motion/MovementData.cs](../ACE/Source/ACE.Server/Network/Motion/MovementData.cs)
- [ACE/Source/ACE.Server/Network/Motion/InterpretedMotionState.cs](../ACE/Source/ACE.Server/Network/Motion/InterpretedMotionState.cs)
- [ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs](../ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs)
- [ACE/Source/ACE.Server/WorldObjects/Player_Networking.cs](../ACE/Source/ACE.Server/WorldObjects/Player_Networking.cs)
- [ACE/Source/ACE.Server/Network/Structure/PositionPack.cs](../ACE/Source/ACE.Server/Network/Structure/PositionPack.cs)
- [ACE/Source/ACE.Server/Network/GameMessages/Messages/GameMessageUpdatePosition.cs](../ACE/Source/ACE.Server/Network/GameMessages/Messages/GameMessageUpdatePosition.cs)
- [ACE/Source/ACE.Server/Network/GameMessages/Messages/GameMessageAutonomousPosition.cs](../ACE/Source/ACE.Server/Network/GameMessages/Messages/GameMessageAutonomousPosition.cs)

## 1. The Core Model

ACE does not treat movement as a single packet stream.

From the server's point of view, player movement is split into two distinct client-authored signals:

1. `MoveToState` (`GameAction 0xF61C`)
2. `AutonomousPosition` (`GameAction 0xF753`)

They serve different purposes.

### `MoveToState` is movement intent

`MoveToState` carries the player's raw movement inputs and stance state:

- hold key (`walk` vs `run`)
- current style / stance
- forward / sidestep / turn commands
- optional speeds
- optional command list for motion items
- the client's current position and movement-related sequences
- contact and standing-long-jump bits

ACE parses that payload in [GameActionMoveToState.cs](../ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionMoveToState.cs) and [MoveToState.cs](../ACE/Source/ACE.Server/Network/Motion/MoveToState.cs), stores it as the player's current movement input, feeds it into the physics/motion path, and broadcasts a movement event to nearby clients through `BroadcastMovement()`.

### `AutonomousPosition` is a positional breadcrumb

`AutonomousPosition` is much narrower. In [GameActionAutonomousPosition.cs](../ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionAutonomousPosition.cs), ACE:

- reads the latest client position
- reads the same sequence family (`instance`, `server_control`, `teleport`, `force_position`)
- records whether the client says it is grounded
- updates `LastGroundPos` when contact is true
- calls `SetRequestedLocation(position)`

It does **not** call `BroadcastMovement()`. That means it does not produce the observer-facing motion update stream that other clients use to animate your character.

It **does** carry full position, including rotation. Because `UpdatePlayerPosition()` applies the supplied rotation and `UpdatePosition` rebroadcasts a full `PositionPack`, `AutonomousPosition` can also be used as an explicit observer-visible facing snap when the client wants to reorient immediately rather than express a turn-through-motion-state sequence.

## 2. The End-to-End ACE Flow

For an autonomous client, the most important thing to internalize is that ACE has two parallel outputs:

- movement animation/state for other clients
- authoritative position corrections / updates

### `MoveToState` path

The `MoveToState` handler in [GameActionMoveToState.cs](../ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionMoveToState.cs) does all of the following:

1. Parse the payload into `MoveToState`.
2. Save it as `CurrentMoveToState` and `LastMoveToState`.
3. Stop server-side `MoveTo` chains if one is running.
4. Call `OnMoveToState(moveToState)`.
5. If not teleporting, call `SetRequestedLocation(moveToState.Position, false)`.
6. Call `BroadcastMovement(moveToState)`.

That `broadcast = false` detail matters. A `MoveToState` updates the player's requested position, but ACE only broadcasts `UpdatePosition` from that path at a throttled cadence later inside `UpdatePlayerPosition()`.

### `AutonomousPosition` path

The `AutonomousPosition` handler in [GameActionAutonomousPosition.cs](../ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionAutonomousPosition.cs) sets the requested location with the default `broadcast = true`.

That means each accepted breadcrumb can trigger an immediate `UpdatePosition` broadcast path in [Player_Tick.cs](../ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs).

Because the requested `Position` includes rotation, this path can also immediately rebroadcast a snapped heading through `UpdatePosition`. That is useful for an explicit `SnapFacing`-style primitive, but it should be treated as a position-stream orientation sync, not as a substitute for ordinary movement-state start/change/stop packets.

### Requested location is consumed in the physics tick

The actual position update happens later in `UpdateObjectPhysics()` in [Player_Tick.cs](../ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs):

1. If `RequestedLocation` is set, ACE calls `UpdatePlayerPosition(RequestedLocation)`.
2. `UpdatePlayerPosition()` validates the move.
3. The physics object is asked to accept or reject the request.
4. If accepted, `Location` becomes the new authoritative position.
5. ACE either sends or enqueues `GameMessageUpdatePosition`.

So the architecture is:

- `MoveToState` and `AutonomousPosition` both propose positions
- `UpdatePlayerPosition()` is the arbiter
- `BroadcastMovement()` is the observer animation path
- `UpdatePosition` is the authoritative position path

## 3. Why an Autonomous Client Cannot Use `AutonomousPosition` Alone

This is the most common design mistake.

If a client only sends `AutonomousPosition` while driving itself locally, ACE will update the requested location and will broadcast `UpdatePosition`, but it will not derive and broadcast the corresponding `UpdateMotion` event through `BroadcastMovement()`.

The consequence is:

- your own client may look fine locally
- the server may accept the positions
- observers can see sliding, stuttering, or correction breadcrumbs instead of coherent motion animation

ACE's observer-facing motion stream is built in [Player_Networking.cs](../ACE/Source/ACE.Server/WorldObjects/Player_Networking.cs) by converting `MoveToState` into `MovementData`, then into an `InterpretedMotionState`, then emitting `GameMessageUpdateMotion`.

That is why autonomous movement must treat:

- `MoveToState` as the control packet for movement starts, stops, and meaningful intent changes
- `AutonomousPosition` as the periodic heartbeat that refreshes the server with the latest accepted position while motion is already underway

## 4. What ACE Does With `MoveToState`

The server uses the raw client input in two separate ways.

### 4.1 Physics ingestion

`OnMoveToState()` in [Player_Tick.cs](../ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs) picks one of two internal methods:

- `OnMoveToState_ServerMethod()`
- `OnMoveToState_ClientMethod()`

That choice depends on the `client_movement_formula` server setting and the standing-long-jump flag.

This is important for client implementers because the transport contract does **not** change. Even when the server simulates movement differently internally, both paths still depend on the same raw input semantics.

### 4.2 Observer motion rebroadcast

`BroadcastMovement()` in [Player_Networking.cs](../ACE/Source/ACE.Server/WorldObjects/Player_Networking.cs) converts the packet into `MovementData` and updates the player-visible motion state.

The conversion logic in [MovementData.cs](../ACE/Source/ACE.Server/Network/Motion/MovementData.cs) shows several non-obvious rules:

- `CurrentStyle` is copied only when the client includes it.
- Run vs walk is inferred from `CurrentHoldKey`.
- Forward observer speed is derived from `creature.GetRunRate()` for run and `1.0f` for walk.
- Backpedal is derived as negative forward speed scaled by `0.65f`.
- Sidestep speed is derived from the creature run rate and then clamped.
- Turn speed is derived from hold key, unless the client provides a small mouse-look turn speed.
- Standing long jump is carried separately in `MotionFlags`.

In other words, a client does not directly control the final observer motion packet. It controls the raw input that ACE translates into the observer motion packet.

## 5. Position Validation Rules That Matter

`UpdatePlayerPosition()` and `ValidateMovement()` in [Player_Tick.cs](../ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs) define the server-side limits for autonomous movement.

### Cross-landblock movement is restricted

`ValidateMovement()` rejects many cross-landblock transitions, especially dungeon-to-dungeon moves. A client cannot assume that a straight-line local simulation may step freely across cell or landblock boundaries.

### Excessive speed is rejected

ACE computes the squared distance from the current authoritative location to the requested position. If the move exceeds `MaxSpeedSq` and spans more than one block according to `PhysicsObj.GetBlockDist(...)`, ACE rejects it and logs a movement-speed warning.

Practical implication: local prediction must stay conservative. A heartbeat that outruns the server's expected run rate will be rejected or corrected.

### Vertical movement is validated against contact history

If the requested position rises too far above `LastGroundPos`, ACE can treat that as suspicious and force a correction. `AutonomousPosition` updates `LastContact` and `LastGroundPos`, so grounded metadata is part of the anti-cheat and jump validation story, not decorative packet padding.

### Teleport state suppresses ordinary movement acceptance

Both inbound handlers avoid normal requested-location updates while `Teleporting` is active. An autonomous client must treat teleport and forced reposition sequence changes as immediate cancellation points for any locally owned movement automation.

## 6. Broadcast Behavior and Why It Produces Rubber-Banding

ACE explicitly documents a throttle in [Player_Tick.cs](../ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs):

- `MoveToState`-driven `UpdatePosition` broadcasts are capped by `MoveToState_UpdatePosition_Threshold`
- the default threshold is `1` second
- `AutonomousPosition` still always broadcasts `UpdatePosition`

This means an overly chatty client creates two kinds of visual problems:

1. If it spams `MoveToState`, it over-drives motion updates and can make observers see frequent motion churn.
2. If it spams `AutonomousPosition`, it creates a trail of server position breadcrumbs that look like repeated corrections.

The retail-like shape is:

- send a `MoveToState` when motion starts
- send another when motion meaningfully changes or stops
- send `AutonomousPosition` periodically while moving

## 7. Packet Content Requirements for Autonomous Clients

An autonomous client-side controller should preserve and populate the following fields carefully.

### Sequences

Both `MoveToState` and `AutonomousPosition` carry:

- `instance_sequence`
- `server_control_sequence`
- `teleport_sequence`
- `force_position_sequence`

These are part of ACE's movement epochs. If the server advances teleport or force-position state, local movement automation should stop and resynchronize before sending more drive pulses.

For client-originated movement, treat these as mirrored server state, not as client-owned counters.

ACE's inbound movement handlers in [GameActionMoveToState.cs](../ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionMoveToState.cs) and [GameActionAutonomousPosition.cs](../ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionAutonomousPosition.cs) read these values but do not maintain a separate client sequence machine from them. By contrast, ACE's outbound movement messages actively maintain server-owned sequence state in [PositionPack.cs](../ACE/Source/ACE.Server/Network/Structure/PositionPack.cs), [GameMessageUpdateMotion.cs](../ACE/Source/ACE.Server/Network/GameMessages/Messages/GameMessageUpdateMotion.cs), and the sequence helpers in [SequenceType.cs](../ACE/Source/ACE.Server/Network/Sequence/SequenceType.cs).

Practical rule:

- cache the latest sequence values the server has told you about
- echo those values back on `MoveToState` and `AutonomousPosition`
- do not invent or increment your own `instance`, `server_control`, `teleport`, or `force_position` counters for client-authored movement unless packet captures prove a retail client does so

In particular, `teleport_sequence` and `force_position_sequence` should be treated as server-owned epoch markers. If either advances, cancel local automation and resync first.

The movement-related sequence state in ACE breaks down like this:

| Sequence | Seen in | Advanced by ACE server | Ground-truth source | Client rule |
| :--- | :--- | :--- | :--- | :--- |
| `instance_sequence` | outbound `UpdateMotion`, `UpdatePosition`, inbound `MoveToState`, inbound `AutonomousPosition` | Not advanced by ordinary movement packets; emitted as current object instance epoch | [GameMessageUpdateMotion.cs](../ACE/Source/ACE.Server/Network/GameMessages/Messages/GameMessageUpdateMotion.cs), [PositionPack.cs](../ACE/Source/ACE.Server/Network/Structure/PositionPack.cs) | Mirror the latest server value; do not increment for movement |
| `server_control_sequence` | outbound `UpdateMotion`, server `AutonomousPosition`, inbound `MoveToState`, inbound `AutonomousPosition` | Advanced only for server-initiated movement events; autonomous movement reuses current value | [MovementData.cs](../ACE/Source/ACE.Server/Network/Motion/MovementData.cs) | Echo the latest server value; if it advances unexpectedly, treat that as a server-owned movement epoch |
| `teleport_sequence` | outbound `PlayerTeleport`, outbound `UpdatePosition`, server `AutonomousPosition`, inbound `MoveToState`, inbound `AutonomousPosition` | Advanced when the server teleports the player | [GameMessagePlayerTeleport.cs](../ACE/Source/ACE.Server/Network/GameMessages/Messages/GameMessagePlayerTeleport.cs), [PositionPack.cs](../ACE/Source/ACE.Server/Network/Structure/PositionPack.cs) | Never increment locally; stop automation when it changes |
| `force_position_sequence` | outbound `UpdatePosition`, server `AutonomousPosition`, inbound `MoveToState`, inbound `AutonomousPosition` | Advanced when the server forces a reposition or correction | [Player_Tick.cs](../ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs), [Player.cs](../ACE/Source/ACE.Server/WorldObjects/Player.cs), [PositionPack.cs](../ACE/Source/ACE.Server/Network/Structure/PositionPack.cs) | Never increment locally; treat advancement as a correction/resync boundary |
| `position_sequence` | outbound `UpdatePosition` only | Advanced whenever ACE builds a `PositionPack` | [PositionPack.cs](../ACE/Source/ACE.Server/Network/Structure/PositionPack.cs) | Observe only; this is not part of client-authored movement packets |
| `movement_sequence` | outbound `UpdateMotion` only | Advanced whenever ACE serializes `MovementData` | [MovementData.cs](../ACE/Source/ACE.Server/Network/Motion/MovementData.cs) | Observe only; this is server-owned observer-motion sequencing |

Two extra subtleties matter:

- For autonomous observer motion, ACE writes the current `server_control_sequence`; for server-controlled movement it writes the next one. That distinction is explicit in [MovementData.cs](../ACE/Source/ACE.Server/Network/Motion/MovementData.cs).
- `force_position_sequence` is not just a teleport helper. ACE advances it for hard corrections too, such as invalid vertical movement handling in [Player_Tick.cs](../ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs).

### Contact bit

`MoveToState.ContactLongJump` bit `0x1` and `AutonomousPosition.last_contact` both affect ACE's understanding of whether the player is grounded. A client that hardcodes this incorrectly can degrade jump/contact validation and invite position corrections.

### Standing long jump bit

Bit `0x2` on `MoveToState.ContactLongJump` is special. ACE strips forward and sidestep commands for standing long jump handling and marks a standing-long-jump motion flag for observers.

### Current style / stance

ACE only forwards `CurrentStyle` when the client provides it. In combat, that style is not just cosmetic. It influences the observer-facing interpreted movement packet. If a client drops stance information, remote clients can render incorrect or degraded motion.

### Forward command, not just speed

The raw packet must describe intent, not just velocity. In ACE, `BroadcastMovement()` derives observer motion from the raw commands. In practice, a drive pulse needs an actual forward command plus the appropriate hold key and related fields; treating movement as a pure position or speed stream is not sufficient.

## 8. A Recommended Client Architecture

The safest autonomous client design mirrors ACE's separation of concerns.

### 8.1 Local controller owns desired locomotion intent

The client-side automation layer should decide:

- desired heading
- desired speed
- arrival distance or stop condition
- when to start or stop drive

It should not assume it is authoritative for final world position.

### 8.2 Local prediction is for responsiveness, not authority

Predict locally for rendering and control feel, but treat server `UpdatePosition`, teleport sequence changes, and force-position sequence changes as authoritative. If the server disagrees, correct immediately and tear down or pause the current automation.

### 8.3 Use `MoveToState` for edges, not for every tick

Send a fresh `MoveToState` when:

- movement starts
- movement stops
- heading changes enough to change the turn command
- speed tier changes enough to change the effective intent
- stance changes

Avoid using `MoveToState` as a high-frequency breadcrumb stream.

### 8.4 Use `AutonomousPosition` as the heartbeat while moving

While local motion continues, send periodic `AutonomousPosition` updates carrying the last locally accepted position and current sequence values.

This keeps ACE's requested location fresh without pretending that every prediction sample is a new control intent.

If your client uses an explicit snap-facing primitive, this is also the correct channel for that immediate facing update: send an `AutonomousPosition` carrying the new rotation, then continue with ordinary `MoveToState` locomotion if movement is beginning.

ACE's own handler comment in [GameActionAutonomousPosition.cs](../ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionAutonomousPosition.cs) describes it as being sent every `~1 second` when a player is moving. More importantly, `AutonomousPosition` calls `SetRequestedLocation(position)` with broadcast enabled, and [Player_Tick.cs](../ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs) will then send `UpdatePosition` whenever `RequestedLocationBroadcast` is true, even if the requested position is effectively unchanged.

In practice, holtburger keeps a low-rate self-position sync armed for the whole in-world session once the client has a valid local pose. That is an implementation choice, not a claim that ACE requires a universal idle heartbeat. The reason is operational: sessions that never emit any `AutonomousPosition` breadcrumb are easier to desynchronize, while a `~1s` sync keeps the server's requested-location path warm without changing the higher-level `MoveToState` rules.

That means the client still treats `MoveToState` as the control stream for starts, changes, and stops, but it no longer tears down `AutonomousPosition` heartbeats merely because local velocity reached zero.

### 8.5 Stop automation on server-owned movement epochs

If the server advances any of the following, treat it as a resynchronization event:

- `teleport_sequence`
- `force_position_sequence`
- server-owned move-to or forced movement state

Do not keep driving through those transitions.

## 9. Direct Answers To Common Implementation Questions

This section is the short-answer version of the rules established above. When you need the deeper rationale, refer back to Sections 7 and 8.

### Do client-originated movement commands have sequence numbers the client must increment?

Not in the sense of a client-owned movement counter family.

For `MoveToState` and `AutonomousPosition`, the sequence fields are best understood as echoed server epoch state:

- `instance_sequence`
- `server_control_sequence`
- `teleport_sequence`
- `force_position_sequence`

ACE's inbound handlers read them, but the authoritative increment points are on the server's outbound side. The client should maintain the latest values received from the server and echo them back. It should not independently advance these fields just because it sent another movement packet.

### Do the movement messages imply interpolation or continuous motion between ticks?

Yes.

ACE's own comments in [Player_Tick.cs](../ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs) state that other players on the client use `apply_raw_movement` to simulate movement from the broadcast motion stream. Observer clients are not expected to treat every movement update as a discrete teleport-only sample.

The protocol shape supports two layers:

- `UpdateMotion` communicates movement intent/state for continuous simulation
- `UpdatePosition` provides authoritative position snapshots and corrections

ACE also contains explicit interpolation machinery in [InterpolationManager.cs](../ACE/Source/ACE.Server/Physics/Managers/InterpolationManager.cs), which reinforces that position updates are expected to be blended or progressed over time rather than rendered as isolated static ticks.

You do not need to perfectly reverse engineer retail's exact visual smoothing policy to act correctly at the protocol level. The safe conclusion is that observer clients continue motion between updates, so your client must send explicit start, change, and stop motion intent packets.

More precisely, ACE has two related but different mechanisms:

- explicit interpolation toward queued target states
- continuous simulation from the current motion state

Those should not be conflated.

#### Explicitly interpolated or queued properties

ACE's interpolation queue in [InterpolationNode.cs](../ACE/Source/ACE.Server/Physics/Animation/InterpolationNode.cs) supports three node types:

- `PositionType`
- `JumpType`
- `VelocityType`

In practice, that means:

- `position` is the primary explicitly interpolated property
- `heading` / orientation may be updated along with position unless `keepHeading` is in effect, in which case the existing heading is preserved while position is blended
- `velocity` can be queued as a node payload and later applied as a state change
- `jump` is represented as a queued movement event, not as a continuously blended scalar

The key code paths are:

- [InterpolationManager.cs](../ACE/Source/ACE.Server/Physics/Managers/InterpolationManager.cs) for queued position, velocity, and jump nodes
- [PositionManager.cs](../ACE/Source/ACE.Server/Physics/Managers/PositionManager.cs) for interpolation dispatch
- [PhysicsObj.cs](../ACE/Source/ACE.Server/Physics/PhysicsObj.cs) for `InterpolateTo(position, keepHeading)`

#### Continuously simulated motion-state properties

Separately, the observer motion stream carries an `InterpretedMotionState` in [InterpretedMotionState.cs](../ACE/Source/ACE.Server/Network/Motion/InterpretedMotionState.cs). Its persistent properties are:

- `CurrentStyle`
- `ForwardCommand`
- `SidestepCommand`
- `TurnCommand`
- `ForwardSpeed`
- `SidestepSpeed`
- `TurnSpeed`

These are not one-tick hints. They remain the active motion state until superseded or cleared by a later motion update. The motion interpreter in [MotionInterp.cs](../ACE/Source/ACE.Server/Physics/Animation/MotionInterp.cs) uses them to generate ongoing linear and angular movement over time.

So, between packets, an observer effectively keeps simulating:

- forward/back movement from `ForwardCommand` + `ForwardSpeed`
- strafing from `SidestepCommand` + `SidestepSpeed`
- turning from `TurnCommand` + `TurnSpeed`
- stance/animation context from `CurrentStyle`

#### Lifecycle rules for these properties

The lifecycle is the part client authors usually get wrong:

1. A start/change `MoveToState` introduces or modifies motion intent.
2. ACE converts that into observer-facing interpreted motion state in [MovementData.cs](../ACE/Source/ACE.Server/Network/Motion/MovementData.cs).
3. Observer clients continue simulating from that state between packets.
4. Position updates may interpolate or correct the resulting spatial state.
5. Motion continues until a later packet explicitly changes or clears the relevant command.

That last step is the trap. Commands are sticky state, not edge-triggered button notifications.

Examples:

- If `TurnCommand` is present, turning persists until a later packet clears turn intent.
- If `ForwardCommand` is present, forward motion persists until a later packet clears it.
- `TurnSpeed` refines an active turn, but does not by itself create one without `TurnCommand`.
- A stop `MoveToState` is the normal way to terminate previously broadcast motion.

#### Black-box validation against the stock ACE image

We validated the observer-side packet shape against the unmodified Docker ACE image using paired logs from:

- a moving holtburger TUI client (`Buddy`)
- a moving retail client (`Merklejerk`)
- a second holtburger TUI client acting only as an observer (`NotBuddy`)

That test established an important constraint for future debugging work:

- the stock ACE image can emit the same observer-visible movement shape for both retail and holtburger movers
- nearby observers may receive an autonomous `UpdateMotion` start/change packet followed by sparse `UpdatePosition` anchors roughly once per second
- those observer-facing `UpdatePosition` packets may omit `velocity` entirely for both clients

So a remote actor looking choppy, rubber-bandy, or "2x slower" is **not** by itself evidence that the moving client sent a malformed locomotion stream. It can also mean the observing client failed to continue translating the remote actor from the last `UpdateMotion` state between authoritative position anchors.

Practical rule: when validating remote movement quality, compare a retail mover and a custom-client mover from the same observer. If both receive sparse no-velocity `UpdatePosition` packets, then the remaining bug is likely in observer-side reconstruction rather than the outbound control packets.

#### Two cadences, two jobs

ACE effectively operates with two different movement cadences that should not be collapsed into a single client constant:

- `MoveToState` control cadence: the mover can send control changes more frequently than once per second, and ACE still uses those updates for server-side movement / interpolation.
- `AutonomousPosition` and observer `UpdatePosition` cadence: ACE documents `AutonomousPosition` as an approximately 1-second moving heartbeat, and `MoveToState`-driven observer `UpdatePosition` rebroadcasts are separately throttled to about 1 second.

For holtburger this means:

- navigation planning should use the outbound `MoveToState` pulse cadence, because that is the control resolution that determines how finely we can approach a target
- observer reconstruction and heartbeat timing should model the slower approximately 1-second authoritative / rebroadcast cadence

If these are conflated, navigation becomes too coarse and starts issuing one-second movement pulses, which produces the same visible "snap every second" failure mode we saw during investigation.

#### Quick lifecycle table

| Property | Comes from | Persists between packets? | Needs explicit clear/change? | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `position` | `UpdatePosition` / interpolation queue | Yes, as spatial state | No separate clear; later positions/corrections replace it | Primary explicitly interpolated property |
| `heading` / rotation | `UpdatePosition` target state and turn simulation | Yes | Usually yes for turn-driven motion | May be preserved during interpolation when `keepHeading` is true |
| `ForwardCommand` | `MoveToState` -> `UpdateMotion` | Yes | Yes | Drives ongoing forward/back motion until cleared |
| `SidestepCommand` | `MoveToState` -> `UpdateMotion` | Yes | Yes | Drives ongoing strafe motion until cleared |
| `TurnCommand` | `MoveToState` -> `UpdateMotion` | Yes | Yes | Drives ongoing turning until cleared |
| `ForwardSpeed` | `MoveToState` -> `UpdateMotion` | Yes, while command remains active | Changed by later motion update | Parameter for active forward motion |
| `SidestepSpeed` | `MoveToState` -> `UpdateMotion` | Yes, while command remains active | Changed by later motion update | Parameter for active sidestep motion |
| `TurnSpeed` | `MoveToState` -> `UpdateMotion` | Yes, while turn remains active | Changed by later motion update | Refines an active turn; does not create turning by itself |
| `CurrentStyle` | `MoveToState` -> `UpdateMotion` | Yes | Changed by later style-bearing motion update | Affects stance/animation context |
| `velocity` node | interpolation queue | Applied as queued state | Replaced by later velocity/position state | Queue-level state, not the normal observer-motion control path |
| `jump` node | interpolation queue | Queue event rather than a blended scalar | Ends through queue consumption / later motion | Special queued movement event |

### Can the client just send `AutonomousPosition` every 1 second regardless of motion for simplicity?

No.

Only send it while the player is actually moving or otherwise needs a movement heartbeat.

ACE describes it as a moving-player heartbeat, not a universal idle heartbeat. It also sets requested location with broadcast enabled, and in [Player_Tick.cs](../ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs) that can trigger immediate `UpdatePosition` traffic instead of waiting for the normal `MoveToState` throttle path.

Holtburger currently accepts that extra low-rate position traffic as the safer tradeoff, because never emitting an `AutonomousPosition` during a session has proven more fragile than keeping a steady `~1s` self-position sync once the player is in world.

### Should `MoveToState` be sent when autonomous movement stops?

Yes.

If you started autonomous movement with `MoveToState`, you should also send a stop `MoveToState` when that movement ends.

Why:

- `BroadcastMovement()` in [Player_Networking.cs](../ACE/Source/ACE.Server/WorldObjects/Player_Networking.cs) is the path that produces observer-facing `UpdateMotion`.
- Observer clients simulate nearby players from that motion stream.
- If you stop sending only `AutonomousPosition` and never send a stop pulse, other clients can continue simulating the last known movement state until a later correction snaps them out of it.

So the stop packet is not optional protocol hygiene. It is the clean termination signal for observer motion, including lingering turn or forward commands.

In practice, a clean locally driven stop often wants **both** bookends:

1. a stop `MoveToState` that clears the observer-facing motion state
2. a final `AutonomousPosition` carrying the last locally accepted resting position

Those packets solve different problems:

- the stop `MoveToState` tells observers to stop simulating the previous forward / sidestep / turn intent
- the final `AutonomousPosition` immediately rebroadcasts the final accepted position and rotation through the authoritative position path

The ordering matters.

ACE does not queue multiple pending requested locations. `SetRequestedLocation()` just stores one `RequestedLocation` plus one `RequestedLocationBroadcast` flag in [Player_Networking.cs](../ACE/Source/ACE.Server/WorldObjects/Player_Networking.cs). `AutonomousPosition` writes that slot with broadcast enabled, while `MoveToState` writes it with broadcast disabled before separately calling `BroadcastMovement()`.

So if a client sends final `AutonomousPosition` first and immediate stop `MoveToState` second, the stop can overwrite the pending broadcast-enabled resting position before the next physics tick consumes it. The server still learns the final resting position, but nearby observers may keep rendering the last public motion result until another later action forces a fresh public `UpdatePosition`.

For locally driven stops, prefer this order:

1. send the stop `MoveToState`
2. then send the final `AutonomousPosition`

If you only send the stop pulse, observers can stop animating but still appear to stop slightly short until a later position update corrects them.

## 10. Failure Modes to Watch For

### Sliding on other clients

Typical cause: using `AutonomousPosition` without corresponding `MoveToState` start/change packets, or omitting the raw movement command fields that ACE needs to derive observer motion.

### Rubber-banding during straight pursuit

Typical cause: resending `AutonomousPosition` or `MoveToState` too aggressively while heading and speed are effectively unchanged.

### Remote players look slower or advance in 1-second hops

Typical cause: the observer records `UpdateMotion` intent but only translates remote actors when an authoritative `UpdatePosition` arrives. On the stock ACE image, both retail and custom movers may be observed through sparse no-velocity position anchors, so observers must continue projecting forward motion from the last sticky motion state between those anchors.

### Invisible server-side movement after local stop

Typical cause: the client's local controller believes it stopped, but the last meaningful raw motion state was never cancelled with a stop pulse.

### Bad combat locomotion visuals

Typical cause: dropping `CurrentStyle` or deriving stance from a simplified combat-mode concept rather than preserving the last valid ACE motion style.

### Forced corrections after jumps or slopes

Typical cause: invalid contact metadata, overly optimistic local vertical prediction, or position heartbeats outrunning the server's physics acceptance.

## 11. Implementation Checklist

Use this as the minimum bar for an autonomous movement implementation.

- Decode and preserve the full movement sequence family from inbound server movement messages.
- Mirror server movement epochs back in client-authored movement packets; do not locally invent sequence increments.
- Maintain a local locomotion controller that produces heading/speed intent, not raw packet spam.
- Send `MoveToState` on start, stop, and meaningful intent changes.
- Keep a low-rate `AutonomousPosition` heartbeat running once the client has a valid self pose, and still send explicit syncs for snap-facing updates and movement end bookends.
- Explicitly clear sticky motion commands with a stop or changed `MoveToState`; do not assume they decay on their own.
- Include grounded/contact metadata truthfully.
- Preserve or explicitly choose the correct ACE motion style in outbound `MoveToState` packets.
- Treat teleport and force-position sequence changes as hard resync boundaries.
- Accept that the server owns final position and collision truth.
- Validate behavior by watching both self-corrections and observer-visible motion.

## 12. Recommended Reading

- [movement.md](movement.md) for the base packet layouts.
- [physics.md](physics.md) for collision and environment traversal context.
- [crates/holtburger-core/src/client/movement.rs](../crates/holtburger-core/src/client/movement.rs) for the current local locomotion packet machinery.
- [crates/holtburger-core/src/client/navigation.rs](../crates/holtburger-core/src/client/navigation.rs) for the frontend-owned automation layer used today.

The most important design rule is simple: autonomous movement in AC is not “send positions to the server.” It is “drive intent locally, periodically report position, and continuously stay inside the server's movement and sequence model.”