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

### `0xF745` ObjectCreate (S2C) / `0xF7DB` UpdateObject (S2C)
Used to spawn objects or fully refresh their state in the client's view. These two opcodes are structurally identical.

#### 1. `ModelDescription` Structure
The `ModelDescription` always appears first:
1. `uint8`: Model Marker (usually 0x11).
2. `uint8`: Number of SubPalettes.
3. `uint8`: Number of Texture Changes.
4. `uint8`: Number of AnimPart Changes.
5. `SubPalettesVector`: For each, a `PackedDword` ID (SubPaletteID), `uint8` Offset, and `uint8` Length.
6. `TexturesVector`: For each, `uint8` PartIndex and two `PackedDword` IDs (OldTextureID/NewTextureID).
7. `AnimPartsVector`: For each, `uint8` Index and one `PackedDword` ID (ModelID).
8. **Alignment:** Align cursor to 4-byte boundary after this section.

#### 2. `PhysicsDescription` Header
Determines the physical state and position of the object.
1. `uint32`: `PhysicsFlags` (Ordered processing below).
2. `uint32`: `PhysicsState` (Bitmask for collisions, gravity, etc.).

Optional fields follow in this precise order based on `PhysicsFlags`:

| Bitmask | Field | Type | Description |
| :--- | :--- | :--- | :--- |
| `0x010000` | `MovementData` | `Variable` | Size-prefixed move record (Autonomous flag follows if length > 0). |
| `0x020000` | `AnimationFrame` | `uint32` | Placement ID. Exclusive with MovementData. |
| `0x008000` | `Position` | `Variable` | `CellID` (u32), `Vector3` (3xf32), and optional `Quaternion` based on local bitmask. |
| `0x000002` | `MTable` | `uint32` | Motion Table. |
| `0x000800` | `STable` | `uint32` | Sound Table. |
| `0x001000` | `PeTable` | `uint32` | Physical Effects Table. |
| `0x000001` | `CSetup` | `uint32` | Combat Setup. |
| `0x000020` | `Parent` | `uint64` | `ParentGUID` (u32) + `LocationID` (u32). |
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

**Sequence Block:** After all flag-fields, a **20-byte aligned block** follows. This typically contains 9x `uint16` sequence counters (Position, Movement, State, Vector, Teleport, ServerControl, ForcePosition, VisualDesc, Instance).

#### 3. `WeenieHeader`
The core identity and metadata for the object.
1. `uint32`: `WeenieHeaderFlags` (ordered fields below).
2. `String16L`: `Name` (Object name).
3. `PackedDword`: `WeenieClassID` (Template ID).
4. `PackedDword`: `IconID`.
5. `uint32`: `ItemType` (Bitmask e.g. 0x02 Armor, 0x10 Creature).
6. `uint32`: `ObjectDescriptionFlags`.

**Second Header:** If `ObjectDescriptionFlags` includes `0x04000000` (IncludesSecondHeader), a `uint32 WeenieHeaderFlags2` follows immediately.

#### 4. Optional Weenie Fields
Fields appear in order of bits set in `WeenieHeaderFlags`:
| Bit | Name | Type | Description |
| :--- | :--- | :--- | :--- |
| `0x00000001` | `PluralName` | `String16L` | |
| `0x00000002` | `ItemsCapacity`| `uint32` | |
| `0x00000004` | `ContainersCapacity`| `uint32` | |
| `0x00000100` | `AmmoType` | `uint16` | |
| `0x00000008` | `Value` | `uint32` | |
| `0x00000010` | `Usable` | `uint32` | |
| `0x00000020` | `UseRadius` | `uint32` | |
| `0x00080000` | `TargetType` | `uint32` | |
| `0x00000080` | `UiEffects` | `uint32` | |
| `0x00000200` | `CombatUse` | `uint8` | |
| `0x00000400` | `Structure` | `uint16` | |
| `0x00000800` | `MaxStructure`| `uint16` | |
| `0x00001000` | `StackSize` | `uint16` | |
| `0x00002000` | `MaxStackSize`| `uint16` | |
| `0x00004000` | `Container` | `uint32` | Organizational Parent GUID (Inventory). |
| `0x00008000` | `Wielder` | `uint32` | Equipping Entity GUID. |
| `0x00010000` | `ValidLocations`| `uint32` | |
| `0x00020000` | `CurrentlyWielded`| `uint32` | |
| `0x00040000` | `Priority` | `uint32` | |
| `0x00100000` | `RadarBlipColor`| `uint8` | |
| `0x00800000` | `RadarBehavior`| `uint8` | |
| `0x08000000` | `PScript` | `uint32` | |
| `0x01000000` | `Workmanship` | `uint32` | |
| `0x00200000` | `Burden` | `uint16` | |
| `0x00400000` | `Spell` | `uint16` | |
| `0x02000000` | `HouseOwner` | `uint32` | |
| `0x04000000` | `HouseRestrictions`| `RestrictionDB`| Complex Hash Table. |
| `0x20000000` | `HookItemTypes`| `uint32` | |
| `0x00000040` | `Monarch` | `uint32` | |
| `0x10000000` | `HookType` | `uint32` | |
| `0x40000000` | `IconOverlay` | `PackedDword`| |
| `0x80000000` | `MaterialType` | `uint32` | |

**Second Header Fields (WeenieHeaderFlags2):**
| Bit | Name | Type | Description |
| :--- | :--- | :--- | :--- |
| `0x01` | `IconUnderlay`| `PackedDword`| |
| `0x02` | `Cooldown` | `uint32` | |
| `0x04` | `CooldownDuration`| `double` | 8-byte float. |
| `0x08` | `PetOwner` | `uint32` | |

**Alignment:** Align cursor to 4-byte boundary after this section.

### `0xF74B` SetState (S2C)
Used to update the `PhysicsState` bitmask of an object (e.g., hiding/revealing an object or making it ethereal).

| Type | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `GUID` | The object being updated. |
| `uint32` | `PhysicsState` | The new bitmask. |
| `uint32` | `InstanceSeq` | Sequence number. |
| `uint32` | `StateSeq` | Sequence number. |

### `0xF74A` PickupEvent (S2C)
Signals that an object has been picked up from the world. Typically triggers a despawn in the client.

| Type | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `GUID` | The object being picked up. |

### `0xF749` ParentEvent (S2C)
Signals that an object has been physically linked to another object. This primary affects the object's physics and coordinate system (making its position relative to the parent).

| Type | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `ChildGUID` | The object being linked. |
| `uint32` | `ParentGUID` | The physical parent. |
| `uint32` | `LocationID` | The attachment point/slot. |

### `0xF748` UpdatePosition (S2C)
Sent frequently to sync object locations. Contains `PositionPack`.

### `0xF74C` UpdateMotion (S2C)
Sent for object animations and movement state changes.

### `0xF74E` VectorUpdate (S2C)
Sent to sync object velocity and angular velocity.

### `0x02CD` PrivateUpdatePropertyInt (S2C)
Updates an integer property on the player.
- `uint32` `Sequence`.
- `uint32` `PropertyID`.
- `int32` `Value`.

### `0x02CF` PrivateUpdatePropertyInt64 (S2C)
- `uint32` `Sequence`.
- `uint32` `PropertyID`.
- `int64` `Value`.

### `0x02D1` PrivateUpdatePropertyBool (S2C)
- `uint32` `Sequence`.
- `uint32` `PropertyID`.
- `bool` `Value` (1 byte).

### `0x02D3` PrivateUpdatePropertyFloat (S2C)
- `uint32` `Sequence`.
- `uint32` `PropertyID`.
- `double` `Value` (8 bytes).

### `0x02D5` PrivateUpdatePropertyString (S2C)
- `uint32` `Sequence`.
- `uint32` `PropertyID`.
- `String16L` `Value`.

### `0x02D7` PrivateUpdatePropertyDID (S2C)
- `uint32` `Sequence`.
- `uint32` `PropertyID`.
- `uint32` `Value`.

### `0x02D9` PrivateUpdatePropertyIID (S2C)
- `uint32` `Sequence`.
- `uint32` `PropertyID`.
- `uint32` `Value`.

## 2. Real-time Stat Updates (S2C)

While `0x0013 PlayerDescription` provides the initial state, stats can change during gameplay via specific update messages. These "Private" updates always include a sequence number for reliability.

### `0x02DD` PrivateUpdateSkill
Updates a single skill. See [stats.md](stats.md) for SkillID mappings.
- `uint32` `Sequence`.
- `uint32` `SkillID`.
- `uint32` `Ranks`.
- `uint32` `Start`.
- `uint32` `Resistance`.
- `uint32` `XP`.

### `0x02E3` PrivateUpdateAttribute
Updates a single attribute.
- `uint32` `Sequence`.
- `uint32` `AttributeID`.
- `uint32` `Ranks`.
- `uint32` `Start`.
- `uint32` `XP`.

### `0x02E7` PrivateUpdateVital
Updates a single vital.
- `uint32` `Sequence`.
- `uint32` `VitalID`.
- `uint32` `Ranks`.
- `uint32` `Start`.
- `uint32` `XP`.
- `uint32` `Current`.

### `0x02E3` PrivateUpdateAttribute
Updates a primary attribute. See [stats.md](stats.md) for AttributeID mappings.
- `uint32` `AttributeID`.
- `uint32` `Ranks`.
- `uint32` `StartingValue`.
- `uint32` `ExperienceSpent`.

### `0x02E7` PrivateUpdateVital
Updates a secondary attribute (Health, Stamina, Mana). See [stats.md](stats.md) for VitalID mappings.
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
