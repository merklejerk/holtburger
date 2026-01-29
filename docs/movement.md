# Asheron's Call Protocol: Movement & Physics

Movement in Asheron's Call is a mix of client-authoritative positioning and server-authoritative physics validation.

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

The server periodically sends `UpdatePosition` to correct the client's position or to notify other clients of player movement.

| Type | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `ObjectGUID` | The character's unique ID. |
| `Position` | `Position` | The authoritative new position. |

## 3. Position Structure (8+24 = 32 bytes)

| Offset | Type | Name | Description |
| :--- | :--- | :--- | :--- |
| 0 | `uint32` | `Landblock` | 0xRRRRWWWW (Region/World coords). |
| 4 | `float` | `X` | Local X within landblock. |
| 8 | `float` | `Y` | Local Y within landblock. |
| 12 | `float` | `Z` | Local Z (height). |
| 16 | `float` | `QX` | Quaternion X. |
| 20 | `float` | `QY` | Quaternion Y. |
| 24 | `float` | `QZ` | Quaternion Z. |
| 28 | `float` | `QW` | Quaternion W (Rotation). |
