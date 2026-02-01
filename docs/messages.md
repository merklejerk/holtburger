# Asheron's Call Protocol: Game Messages (Opcodes)

Game messages are transported within message fragments. Once reassembled, the first 4 bytes are the **Opcode**, followed by the message payload.

## 1. Common Server-to-Client (S2C) Messages

### `0xF7E0` ServerMessage (System Chat)
Used for system notifications, login messages, etc.

| Type | Name | Description |
| :--- | :--- | :--- |
| `String16L` | `Message` | The text content. |
| `int32` | `Type` | Chat message type (e.g. 0=System, 7=Tell). |

### `0x02BB` HearSpeech
Used for public chat (Say).

| Type | Name | Description |
| :--- | :--- | :--- |
| `String16L` | `Message` | The spoken text. |
| `String16L` | `SenderName` | Name of the speaker. |
| `uint32` | `SenderID` | GUID of the speaker. |
| `uint32` | `Type` | Chat message type (usually `1` for Speech). |

### `0x01E2` SoulEmote
A short emote broadcast by a player (e.g., "waves.").

| Type | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `SenderID` | GUID of the emoter. |
| `String16L` | `SenderName` | Name of the emoter (may include prefixes like `+`). |
| `String16L` | `EmoteText` | The emote text, e.g., `waves.`. |

### `0xF7E1` ServerName
Sent during connection to provide server metadata.

| Type | Name | Description |
| :--- | :--- | :--- |
| `int32` | `OnlineCount` | Number of players currently online. |
| `int32` | `MaxSessions` | Maximum allowed sessions (-1 for unlimited). |
| `String16L` | `ServerName` | The name of the world server. |

### `0xF7E5` DDD_Interrogation
Data Download interrogation. See [DDD Documentation](data_download.md).

### `0xF7E6` DDD_InterrogationResponse
Data Download response from client. See [DDD Documentation](data_download.md).

### `0xF658` CharacterList
Sent after login. Details in [handshake.md](handshake.md).

### `0xF745` ObjectCreate (S2C)
Used to spawn objects in the client's view. This is a complex bitmask-driven message consisting of four major sections.

#### 1. `ModelDescription` Structure
The `ModelDescription` always appears first:
1. `uint8`: Model Marker (usually 0x11).
2. `uint8`: Number of SubPalettes.
3. `uint8`: Number of Texture Changes.
4. `uint8`: Number of AnimPart Changes.
5. `SubPalettesVector`: For each, a `PackedDword` ID (PaletteID) and 2 bytes (Offset, Length).
6. `TexturesVector`: For each, 1-byte index and two `PackedDword` IDs (OldID/NewID).
7. `AnimPartsVector`: For each, 1-byte index and one `PackedDword` ID (AnimID).
8. **Alignment:** Align cursor to 4-byte boundary after this section.

#### 2. `PhysicsDescription` Header
Determines the physical state and position of the object.
1. `uint32`: `PhysicsFlags` (Ordered processing below).
2. `uint32`: `PhysicsState` (Bitmask for collisions, gravity, etc.).

Optional fields follow in this precise order based on `PhysicsFlags`:

| Bitmask | Field | Type | Description |
| :--- | :--- | :--- | :--- |
| `0x010000` | `MovementData` | `Variable` | Size-prefixed move record (Autonomous flag follows data). |
| `0x020000` | `AnimationFrame` | `uint32` | Exclusive with MovementData. |
| `0x008000` | `Position` | `32 bytes` | Fixed position: `CellID` (u32), `Vector3` (3xf32), `Quaternion` (4xf32: W, X, Y, Z). |
| `0x000002` | `MTable` | `uint32` | Motion Table. |
| `0x000800` | `STable` | `uint32` | Sound Table. |
| `0x001000` | `PeTable` | `uint32` | Physical Effects Table. |
| `0x000001` | `CSetup` | `uint32` | Combat Setup. |
| `0x000020` | `Parent` | `uint64` | Parent GUID + LocationID. |
| `0x000040` | `Children` | `Vector` | Count + (GUID + LocationID) per child. |
| `0x000080` | `ObjScale` | `float` | Scaling factor. |
| `0x000100` | `Friction` | `float` | Movement friction. |
| `0x000200` | `Elasticity` | `float` | Bounciness. |
| `0x040000` | `Translucency` | `float` | Alpha/Transparency. |
| `0x000004` | `Velocity` | `Vector3` | Current XYZ velocity. |
| `0x000008` | `Acceleration` | `Vector3` | Current XYZ acceleration. |
| `0x000010` | `Omega` | `Vector3` | Angular velocity. |
| `0x002000` | `DefaultScript`| `uint32` | Script ID. |
| `0x004000` | `ScriptInt` | `uint32` | Script intensity. |

**Sequence Block:** After all flag-fields, a mandatory **18-byte block** (9x `uint16`) of sequence counters follows.
**Alignment:** Align cursor to 4-byte boundary after this sequence block.

#### 3. `WeenieHeader`
The core identity and metadata for the object.
1. `uint32`: `WeenieHeaderFlags` (ordered fields below).
2. `String16L`: `Name` (Object name).
3. `PackedDword`: `WeenieClassID` (Template ID).
4. `PackedDword`: `IconID`.
5. `uint32`: `ItemType` (Bitmask e.g. 0x02 Armor, 0x10 Creature).
6. `uint32`: `ObjectDescriptionFlags`.

**Second Header:** If `ObjectDescriptionFlags` includes `0x04000000`, a `uint32 WeenieHeaderFlags2` follows immediately.
**Alignment:** Any `String16L` in this section requires the reader to align to the next 4-byte boundary.

#### 4. Optional Weenie Fields
Fields appear in order of bits set in `WeenieHeaderFlags`:
| Bit | Name | Type |
| :--- | :--- | :--- |
| `0x00000001` | `PluralName` | `String16L` |
| `0x00000002` | `ItemsCapacity`| `uint32` |
| `0x00000008` | `Value` | `uint32` |
| `0x00000010` | `Usable` | `uint32` |
| `0x00001000` | `StackSize` | `uint16` |
| `0x00004000` | `Container` | `uint32` (Parent GUID) |
| `0x00200000` | `Burden` | `uint16` |
| `0x00400000` | `Spell` | `uint16` |

*Note: This is an abbreviated table. See Pylance/ACE source for the full 32-bit bitmask logic.*

### `0xF748` UpdatePosition (S2C)
Sent frequently to sync object locations. Contains `PositionPack`.

### `0xF74C` UpdateMotion (S2C)
Sent for object animations and movement state changes.

### `0xF74E` VectorUpdate (S2C)
Sent to sync object velocity and angular velocity.

### `0x02CD` PrivateUpdatePropertyInt (S2C)
Updates an integer property on the player.
- `uint32` `Sequence`.
- `uint32` `PropertyID` (use values from `PropertyInt` enum in server source).
- `int32` `Value`.

### `0x02CF` PrivateUpdatePropertyInt64 (S2C)
- `uint32` `Sequence`.
- `uint32` `PropertyID`.
- `int64` `Value`.

### `0x02D1` PrivateUpdatePropertyBool (S2C)
- `uint32` `Sequence`.
- `uint32` `PropertyID`.
- `uint32` `Value` (0 or 1).

### `0x02D5` PrivateUpdatePropertyString (S2C)
- `uint32` `Sequence`.
- `uint32` `PropertyID`.
- `String16L` `Value`.

### `0xF7B0` GameEvent (Multiplexer)
The primary multiplexer for world state updates and social events.

| Offset | Type | Name | Description |
| :--- | :--- | :--- | :--- |
| `0` | `uint32` | `Opcode` | `0xF7B0`. |
| `4` | `uint32` | `GUID` | The entity affected by the event. |
| `8` | `uint32` | `Sequence` | The world event sequence number. |
| `12` | `uint32` | `EventType` | The specific event opcode (see below). |
| `16` | `byte[]` | `Data` | Event-specific content. |

#### Common Event Types:
- **`0x0013` PlayerDescription:** Sent during the login sequence. Contains the full state of the character (Weenie type, property tables, attributes, skills, and spells).
  - Note: This is a complex composite message. It includes multiple property hash tables (Int, Int64, Bool, String, DID, IID) followed by Attribute and Skill vectors.
- **`0x0147` ChannelBroadcast:** Used for public chat channels.
  - `uint32` Chat Channel ID (e.g., General=1, Trade=2).
  - `String16L` Sender Name (Empty if you are the sender).
  - `String16L` Message Text.
- **`0x02BD` Tell:** Private messages.
  - `String16L` Message Text.
  - `String16L` Sender Name.
  - `uint32` Target GUID.
  - `uint32` Sender GUID.
  - `uint32` ChatMessageType.
- **`0x0282` StartGame:** Sent at the end of the login sequence.
- **`0x028A` WeenieError:** Server notifications/errors.
  - `uint32` Error Code (e.g. `0x051D` TurbineChatIsEnabled).

## 2. Real-time Stat Updates (S2C)

While `0x0013 PlayerDescription` provides the initial state, stats can change during gameplay via specific update messages.

### `0x02DD` PrivateUpdateSkill
Updates a single skill. See [stats.md](stats.md) for SkillID mappings.
- `uint32` `Sequence`.
- `uint32` `SkillID`.
- `uint32` `Ranks`.
- `uint16` `AdjustPP`.
- `uint32` `Status` (Training level).
- `uint32` `ExperienceSpent`.
- `uint32` `InitLevel`.
- `uint32` `Resistance`.
- `uint64` `LastUsedTime`.

### `0x02E3` PrivateUpdateAttribute
Updates a primary attribute. See [stats.md](stats.md) for AttributeID mappings.
- `uint32` `Sequence`.
- `uint32` `AttributeID`.
- `uint32` `Ranks`.
- `uint32` `StartingValue`.
- `uint32` `ExperienceSpent`.

### `0x02E7` PrivateUpdateVital
Updates a secondary attribute (Health, Stamina, Mana). See [stats.md](stats.md) for VitalID mappings.
- `uint32` `Sequence`.
- `uint32` `VitalID`.
- `uint32` `Ranks`.
- `uint32` `StartingValue`.
- `uint32` `ExperienceSpent`.
- `uint32` `CurrentValue`.

---

## 4. Other Game Messages

### `0xF74C` UpdateMotion
Synchronizes movement and animation states for objects.
- `uint32` `GUID`: The object moving.
- `uint32` `InstanceSequence`.
- `byte[]` `MovementData`: Header + Animation/Position state.

---

## 5. Common Client-to-Server (C2S) Messages

### `0xF7C8` CharacterEnterWorldRequest
Initial request to select a character slot.
- `uint32` `CharacterID`.

### `0xF657` CharacterEnterWorld
Final handshake for world admission.
- `uint32` `CharacterID`.
- `String16L` `AccountName`.

---

## 3. Game Actions (`0xF7B1`)
Primary way clients send commands and interactions to the server.

| Offset | Type | Name | Description |
| :--- | :--- | :--- | :--- |
| `0` | `uint32` | `Opcode` | `0xF7B1`. |
| `4` | `uint32` | `Sequence` | Action sequence number. |
| `8` | `uint32` | `ActionType` | The specific action (see below). |
| `12` | `byte[]` | `Data` | Action-specific payload. |

#### Common Action Types:
- **`0x00A1` LoginComplete:** Signals character is ready to spawn.
- **`0x0015` Talk:** Sends a message to the public channel or a specific person.
  - `String16L` Message Text.

---

## 4. Game Events (`0xF7B0`)

| Opcode | Name | Description |
| :--- | :--- | :--- |
| `0x0013` | `PlayerDescription` | Skills, attributes, and vitals. |
| `0x0282` | `StartGame` | Signals the client to start the game loop. |
| `0x0147` | `ChannelBroadcast` | Public channel chat messages. |
| `0x02BD` | `Tell` | Private message details. |

---

## 5. Movement and Positioning
Positioning is handled via specialized messages documented in [movement.md](movement.md).
