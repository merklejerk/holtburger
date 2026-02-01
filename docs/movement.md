# Asheron's Call Protocol: Movement & Physics

Movement in Asheron's Call is a mix of client-authoritative positioning and server-authoritative physics validation. For a deep dive into how the engine handles environment collision and terrain, see [physics.md](physics.md).

## 1. Client-to-Server Movement: `MoveToState` (`0xF61C`)

The client sends a `MoveToState` message whenever the player moves, turns, or changes stance. This is wrapped in a `GameAction` (`0xF7B1`).

### `MoveToState` Payload Structure

| Type | Name | Description |
| :--- | :--- | :--- |
| `RawMotionState` | `Motion` | Bitfield and data describing the specific keys/movement. |
| `Position` | `Position` | The client's claimed position (Landblock + Local Coords). |
| `uint16` | `InstanceSeq` | Rolling sequence for object instances. |
| `uint16` | `ServerSeq` | Sequence for server-controlled movement. |
| `uint16` | `TeleportSeq` | Incremented when the player teleports. |
| `uint16` | `PositionSeq` | Incremented when position is forced by server. |
| `uint8` | `ContactLJ` | Bit 0: On Ground (Contact), Bit 1: Long Jump. |

### `RawMotionState` Details
This uses a complex bitmask for efficiency. If a bit is set, the corresponding data follows.

| Bit | Name | Data Type | Description |
| :--- | :--- | :--- | :--- |
| `0x001` | `CurrentHoldKey` | `uint32` | Walk (`0x0`) or Run (`0x1`). |
| `0x002` | `CurrentStyle` | `uint32` | Stance (Combat, Peace, etc). |
| `0x004` | `ForwardCommand` | `uint32` | Forward/Backward movement. |
| `0x008` | `ForwardHoldKey` | `uint32` | Is the key being held. |
| `0x010` | `ForwardSpeed` | `float` | Current linear velocity. |
| `0x100` | `TurnCommand` | `uint32` | Left/Right turning. |
| `0x400` | `TurnSpeed` | `float` | Angular velocity. |

## 2. Server-to-Client Movement: `UpdatePosition` (`0xF748`)

The server periodically sends `UpdatePosition` to correct the client's position or to notify other clients of player movement. This message uses the variable-length `PositionPack` structure.

| Type | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `ObjectGUID` | The character's unique ID. |
| `PositionPack` | `Position` | The authoritative new position with sequences. |

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

| Bitmask | Name | Description |
| :--- | :--- | :--- |
| `0x01` | `HasVelocity` | Velocity Vector3 follows. |
| `0x02` | `HasPlacementID` | Placement ID follows. |
| `0x04` | `IsGrounded` | Object is in contact with the ground. |
| `0x08` | `OrientationHasNoW` | Rotation.W is `0.0` and omitted. |
| `0x10` | `OrientationHasNoX` | Rotation.X is `0.0` and omitted. |
| `0x20` | `OrientationHasNoY` | Rotation.Y is `0.0` and omitted. |
| `0x40` | `OrientationHasNoZ` | Rotation.Z is `0.0` and omitted. |

## 3. Initial Spawning: `CreateObject` (`0xF745`)

When a character enters the world or an object enters the player's 3D relevancy bubble, the server sends `CreateObject`. This message contains a **Fixed-Length Position** (32 bytes) within its physics section.

### Fixed-Length Position (32 bytes)
Used in `ObjectCreate` and some other static contexts.

| Offset | Type | Name | Description |
| :--- | :--- | :--- | :--- |
| 0 | `uint32` | `CellID` | 0xLLLLCCCC (Landblock + Cell). |
| 4 | `float` | `X` | Local X within cell. |
| 8 | `float` | `Y` | Local Y within cell. |
| 12 | `float` | `Z` | Local Z (height). |
| 16 | `float` | `QW` | Quaternion W (Rotation). |
| 20 | `float` | `QX` | Quaternion X. |
| 24 | `float` | `QY` | Quaternion Y. |
| 28 | `float` | `QZ` | Quaternion Z. |
