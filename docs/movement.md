# Asheron's Call Protocol: Movement & Physics

Movement in Asheron's Call is a mix of client-authoritative positioning and server-authoritative physics validation. For a deep dive into how the engine handles environment collision and terrain, see [physics.md](physics.md).

## 1. Client-to-Server Movement: `MoveToState` (`0xF61C`)

The client sends a `MoveToState` message whenever the player moves, turns, or changes stance. This is wrapped in a `GameAction` (`0xF7B1`).

### `MoveToState` Payload Structure

| Type             | Name          | Description                                               |
| :--------------- | :------------ | :-------------------------------------------------------- |
| `RawMotionState` | `Motion`      | Bitfield and data describing the specific keys/movement.  |
| `Position`       | `Position`    | The client's claimed position (Landblock + Local Coords). |
| `uint16`         | `InstanceSeq` | Rolling sequence for object instances.                    |
| `uint16`         | `ServerSeq`   | Sequence for server-controlled movement.                  |
| `uint16`         | `TeleportSeq` | Incremented when the player teleports.                    |
| `uint16`         | `PositionSeq` | Incremented when position is forced by server.            |
| `uint8`          | `ContactLJ`   | Bit 0: On Ground (Contact), Bit 1: Long Jump.             |

### `RawMotionState` Details

This uses a complex bitmask for efficiency. If a bit is set, the corresponding data follows.

| Bit     | Name             | Data Type | Description                  |
| :------ | :--------------- | :-------- | :--------------------------- |
| `0x001` | `CurrentHoldKey` | `uint32`  | Walk (`0x0`) or Run (`0x1`). |
| `0x002` | `CurrentStyle`   | `uint32`  | Stance (Combat, Peace, etc). |
| `0x004` | `ForwardCommand` | `uint32`  | Forward/Backward movement.   |
| `0x008` | `ForwardHoldKey` | `uint32`  | Is the key being held.       |
| `0x010` | `ForwardSpeed`   | `float`   | Current linear velocity.     |
| `0x100` | `TurnCommand`    | `uint32`  | Left/Right turning.          |
| `0x400` | `TurnSpeed`      | `float`   | Angular velocity.            |

## 2. Client-to-Server Jump: `Jump` (`0xF61B`)

The retail client sends `Jump` after it has accepted and applied a local launch. This is wrapped in
a `GameAction` (`0xF7B1`). The action body is fixed at 56 bytes and is already four-byte aligned.

| Offset | Type       | Name                    | Description                                               |
| -----: | ---------- | ----------------------- | --------------------------------------------------------- |
|      0 | `float32`  | `Extent`                | Charged jump power in `[0.001, 1.0]`.                     |
|      4 | `Vector3`  | `LocalVelocity`         | Body-local sidestep, forward, and upward launch velocity. |
|     16 | `Position` | `Position`              | Full 32-byte position captured at local launch commit.    |
|     48 | `uint16`   | `InstanceSequence`      | Current object-instance movement epoch.                   |
|     50 | `uint16`   | `ServerControlSequence` | Current server-control movement epoch.                    |
|     52 | `uint16`   | `TeleportSequence`      | Current teleport movement epoch.                          |
|     54 | `uint16`   | `ForcePositionSequence` | Current forced-position movement epoch.                   |

Ground truth is `JumpPack::JumpPack` and `JumpPack::Pack` in
`acclient-eor-source/acclient.c:312043-312124`. `ClientCombatSystem::DoJump` at
`acclient-eor-source/acclient.c:390559-390616` proves that the velocity is read from the locally
launched physics body and that the position and sequence values are sampled immediately afterward.
GDLE independently parses the extent, velocity, and position prefix in
`Source/ClientEvents.cpp:3930-3940`.

ACE's `JumpPack.cs` omits `Position`, and `GameActionJump.cs` subsequently reads object/spell fields
that retail does not send. ACE nevertheless accepts retail packets because it consumes the correct
extent and velocity, ignores the values misread from the beginning of `Position`, does not require
complete action-body consumption, and launches from only the accepted extent and velocity. Clients
must emit the retail layout; ACE's tolerant abbreviated interpretation is not an alternate wire
format.

## 3. Server-to-Client Movement: `UpdatePosition` (`0xF748`)

The server periodically sends `UpdatePosition` to correct the client's position or to notify other clients of player movement. This message uses the variable-length `PositionPack` structure.

| Type           | Name         | Description                                    |
| :------------- | :----------- | :--------------------------------------------- |
| `uint32`       | `ObjectGUID` | The character's unique ID.                     |
| `PositionPack` | `Position`   | The authoritative new position with sequences. |

### `PositionPack` Structure

The `PositionPack` is used in many S2C messages and is highly optimized using bitmasks.

1. `uint32`: `PositionFlags` (Determines which optional fields follow).
2. `uint32`: `CellID` (0xLLLLCCCC).
3. `float`: `X` (Local X).
4. `float`: `Y` (Local Y).
5. `float`: `Z` (Local Z).
6. **Optional Optional Fields** (based on `PositionFlags` bits):
   - `float` `Rotation.W` (if `0x08` bit is NOT set).
   - `float` `Rotation.X` (if `0x10` bit is NOT set).
   - `float` `Rotation.Y` (if `0x20` bit is NOT set).
   - `float` `Rotation.Z` (if `0x40` bit is NOT set).
   - `Vector3` `Velocity` (if `0x01` bit is set).
   - `uint32` `PlacementID` (if `0x02` bit is set).
7. **Sequence Block**:
   - `uint16` `InstanceSequence`.
   - `uint16` `PositionSequence`.
   - `uint16` `TeleportSequence`.
   - `uint16` `ForcePositionSequence`.

| Bitmask | Name                | Description                           |
| :------ | :------------------ | :------------------------------------ |
| `0x01`  | `HasVelocity`       | Velocity Vector3 follows.             |
| `0x02`  | `HasPlacementID`    | Placement ID follows.                 |
| `0x04`  | `IsGrounded`        | Object is in contact with the ground. |
| `0x08`  | `OrientationHasNoW` | Rotation.W is `0.0` and omitted.      |
| `0x10`  | `OrientationHasNoX` | Rotation.X is `0.0` and omitted.      |
| `0x20`  | `OrientationHasNoY` | Rotation.Y is `0.0` and omitted.      |
| `0x40`  | `OrientationHasNoZ` | Rotation.Z is `0.0` and omitted.      |

## 4. Server-to-Client Movement State: `UpdateMotion` (`0xF74C`)

Retail admits `UpdateMotion` against the existing physics object before unpacking its movement
payload. The object instance must match exactly, the wrapping movement timestamp must be strictly
newer, and the server-control timestamp must not be older. Retail advances the movement timestamp
before checking server control, so a fresh packet from an old control epoch consumes its movement
timestamp without replacing motion (`CPhysics::SetObjectMovement`,
`acclient.c:299898-299995`; dispatcher instance gate at `acclient.c:375663-375698`).

An interpreted-state payload is a complete replacement, not a sparse patch. Retail's unpacker
supplies these defaults for omitted fields (`InterpretedMotionState::UnPack`,
`acclient.c:320348-320453`):

- omitted style becomes NonCombat;
- omitted forward command becomes Ready, represented by the stance's default substate;
- omitted sidestep and turn commands stop those channels;
- omitted speeds become `1.0` and cannot keep a channel alive without its command.

The command list in the same payload is different: retail consumes each item immediately as a
sequence-checked transient action and does not copy it into the retained interpreted movement
state (`CMotionInterp::move_to_interpreted_state`, `acclient.c:330601-330667`). MoveTo and TurnTo
payloads likewise start directive managers without replacing the retained interpreted state; their
outer nonzero style may change the stance to which ordinary movement later returns.

Client implementations therefore need three distinct values: an object generation with no admitted
movement, initialized idle movement, and initialized active movement. Treating idle as absent leaves
the previous cyclic animation and authored root motion alive indefinitely.

## 5. Server-Controlled MoveTo and TurnTo

A fresh non-autonomous movement event is a command-authority transfer, not an ordinary
`UpdatePosition` or vector sample. Retail admits it through `CPhysics::SetObjectMovement` and the
movement-event dispatcher (`acclient.c:299898-299958`, `375642-375704`), then classifies
MoveToObject, MoveToPosition, TurnToObject, or TurnToHeading through `MoveToManager`
(`acclient.c:325745-325775`, `325998-326141`).

MoveTo and TurnTo have different execution and completion contracts:

| Fact                            | Grounded MoveTo | Airborne MoveTo | Grounded TurnTo | Airborne TurnTo |
| ------------------------------- | --------------- | --------------- | --------------- | --------------- |
| Server owns the command         | yes             | yes             | yes             | yes             |
| Heading is eligible             | yes             | yes             | yes             | yes             |
| Target-directed translation     | yes             | no              | no              | no              |
| Command progress/completion     | distance        | deferred        | heading         | heading         |
| Existing physical velocity kept | yes             | yes             | yes             | yes             |

`MoveToManager` installs ordered turn and translation nodes immediately
(`acclient.c:331901-332108`). Stopping interpreted locomotion does not replace the physics object's
velocity (`acclient.c:329908-329939`, `304242-304249`). Turn commands remain eligible without
walkable contact, while forward translation is retained but gated (`acclient.c:330141-330280`).
`MovementManager::UseTime` does not advance MoveTo progress without a contact plane, and
`MovementManager::HitGround` restarts the pending node (`acclient.c:325850-325904`). Consequently,
crossing a MoveTo target during a ballistic arc neither completes the command nor redirects the
airborne velocity; landing activates the retained translation.

Retail canonicalizes both turn directions to `TurnRight`, using a negative playback rate for the
opposite direction (`CMotionInterp::adjust_motion`, `acclient.c:330006-330055`). A TurnTo node
retains that chosen direction: once authored rotation crosses its queued heading, retail sets the
exact heading and stops the turn instead of reversing it on the next tick
(`MoveToManager::HandleTurnToHeading`, `acclient.c:331826-331885`).

Authoritative interpolation does not take that authored heading away. With `keep_heading`, retail
preserves the object's current heading in the interpolation target and zeroes only the interpolation
offset's yaw (`InterpolationManager::InterpolateTo` and `adjust_offset`,
`acclient.c:371857-371996`, `372078-372092`). Correction translation and the ordinary MoveTo turn
therefore compose through separate lanes; suppressing the authored lane makes a translating actor
remain in its initial turn presentation.

TurnToObject has two heading sources. When its target object is available, retail turns to the
current object bearing plus `MovementParameters.desired_heading`. When the object is unavailable,
the separate absolute heading carried before those parameters becomes a TurnToHeading fallback
(`acclient.c:326112-326141`, `332025-332108`).

## 6. Steady Motion, Transient Actions, and Authored Playback

After packet admission, movement has two different lifetimes. Style, forward, sidestep, and turn
channels form the retained steady order. Command-list entries are transient action edges: each
carries its exact speed, an independent wrapping 15-bit action sequence, and an autonomous bit.
Retail admits a fresh action immediately and does not retain it as the forward level
(`CMotionInterp::move_to_interpreted_state`, `acclient.c:319656-319750`,
`330607-330677`).

ACE also emits server actions in the interpreted forward field. Because that field normally holds
a steady locomotion or pose command, a receiver must classify an action-class command at the fresh
outer movement-event boundary, emit one transient edge, and remove it from the retained forward
state. Retaining it would restart the action every tick and leave attacks, gestures, or transitions
playing forever.

Playback uses one body runtime for local players, remote players, and creatures:

1. A source adapter admits local intent or network movement and produces retained steady state plus
   transient action edges.
2. MoveTo/TurnTo reduction converts a retained server directive into the same semantic steady order
   used by ordinary movement.
3. Motion-table selection resolves the effective table once (direct property first, then the setup
   model default), style, command, and authored transition sequence.
4. The sequence runtime owns the current clip, a six-entry action FIFO, exact action completion,
   and the latest steady return destination.
5. The authored root offset enters the physical solver once; the frontend receives only the
   committed body pose and playing clip.

A steady update received during an action replaces only the cyclic return suffix, matching
retail's `CMotionTable::GetObjectSequence` behavior (`acclient.c:324230-324400`). It does not restart
the action. On its exact authored completion boundary, the next queued action starts or playback
returns to the latest steady order. An animation with zero frame rate is an authored held pose, not
a timed action that the client may retire heuristically.

For a client-authored command-list action, local presentation enqueues the exact typed edge when the
outbound pulse is built. The later autonomous echo is filtered rather than admitted a second time.
Waiting for that echo would leave the issuing player idle on servers that do not replay autonomous
actions back as non-autonomous movement.

## 7. Initial Spawning: `CreateObject` (`0xF745`)

When a character enters the world or an object enters the player's 3D relevancy bubble, the server sends `CreateObject`. This message contains a **Fixed-Length Position** (32 bytes) within its physics section.

### Fixed-Length Position (32 bytes)

Used in `ObjectCreate` and some other static contexts.

| Offset | Type     | Name     | Description                    |
| :----- | :------- | :------- | :----------------------------- |
| 0      | `uint32` | `CellID` | 0xLLLLCCCC (Landblock + Cell). |
| 4      | `float`  | `X`      | Local X within cell.           |
| 8      | `float`  | `Y`      | Local Y within cell.           |
| 12     | `float`  | `Z`      | Local Z (height).              |
| 16     | `float`  | `QW`     | Quaternion W (Rotation).       |
| 20     | `float`  | `QX`     | Quaternion X.                  |
| 24     | `float`  | `QY`     | Quaternion Y.                  |
| 28     | `float`  | `QZ`     | Quaternion Z.                  |

## 8. Distance Semantics (Client Libraries)

For UI sorting and nearby-entity displays, `WorldPosition::distance_to` in `holtburger-common` uses a **global-space Euclidean distance**:

- Convert each position to global meters using landblock offsets (`LandblockX/Y * 192 + local X/Y`).
- Compute straight-line 3D distance from that global pair.
- This applies even when one or both positions are indoors (matching ACE's `Position.DistanceTo` behavior).

### Important Caveat

This value is a **geometric approximation**, not a navigation/pathing distance. For indoor spaces (dungeons/buildings), walls, portals, and floor separation are not modeled by this metric.
