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

### `0xF7DC` BootAccount
Sent by the server to terminate the connection.

| Type | Name | Description |
| :--- | :--- | :--- |
| `String16L` | `Reason` | (Optional) The reason for the disconnect. This field may be omitted if the message ends immediately after the opcode. |

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
| `uint32` | `ParentGUID` | The physical parent (typically the creature/wielder). |
| `uint32` | `ChildGUID` | The attached object being linked. |
| `uint32` | `LocationID` | The attachment point/slot. |
| `uint32` | `Placement` | Placement enum used for render/attach behavior. |
| `uint16` | `ParentInstanceSeq` | Parent object-instance sequence. |
| `uint16` | `ChildPositionSeq` | Child object-position sequence. |

### `0xF748` UpdatePosition (S2C)
Sent frequently to sync object locations. Contains `PositionPack`.

### `0xF74C` UpdateMotion (S2C)
Sent for object animations and movement state changes.

### `0xF74E` VectorUpdate (S2C)
Sent to sync object velocity and angular velocity.

### `0x02CD` PrivateUpdatePropertyInt (S2C)
Updates an integer property on the player.
- **CRITICAL:** Private update messages use a **1-byte sequence number** (uint8).
- `uint32` `Opcode`.
- `uint8` `Sequence`.
- `uint32` `PropertyID`.
- `int32` `Value`.

### `0x02CF` PrivateUpdatePropertyInt64 (S2C)
- `uint8` `Sequence`.
- `uint32` `PropertyID`.
- `int64` `Value`.

### `0x02D1` PrivateUpdatePropertyBool (S2C)
- `uint8` `Sequence`.
- `uint32` `PropertyID`.
- `uint32` `Value` (0 for false, 1 for true).

### `0x02D3` PrivateUpdatePropertyFloat (S2C)
- `uint8` `Sequence`.
- `uint32` `PropertyID`.
- `double` `Value` (8 bytes).

### `0x02D5` PrivateUpdatePropertyString (S2C)
- `uint8` `Sequence`.
- `uint32` `PropertyID`.
- `String16L` `Value`.

### `0x02D7` PrivateUpdatePropertyDID (S2C)
- `uint8` `Sequence`.
- `uint32` `PropertyID`.
- `uint32` `Value`.

### `0x02D9` PrivateUpdatePropertyIID (S2C)
- `uint8` `Sequence`.
- `uint32` `PropertyID`.
- `uint32` `Value`.

## 2. Real-time Stat Updates (S2C)

While `0x0013 PlayerDescription` provides the initial state, stats can change during gameplay via specific update messages. These "Private" updates always include a **1-byte sequence number** (uint8) for reliability.

### `0x02DD` PrivateUpdateSkill
Updates a single skill. See [stats.md](stats.md) for SkillID mappings.
- `uint8` `Sequence`
- `uint32` `SkillID`
- `uint16` `Ranks`
- `uint16` `AdjustPP`
- `uint32` `ExperienceSpent`
- `uint32` `AdvancementClass` (Training level)
- `uint32` `InitLevel`
- `uint32` `Resistance`
- `double` `LastUsedTime`

### `0x02E3` PrivateUpdateAttribute
Updates a single attribute.
- `uint8` `Sequence`
- `uint32` `AttributeID`
- `uint32` `Ranks`
- `uint32` `StartingValue`
- `uint32` `ExperienceSpent`

### `0x02E7` PrivateUpdateVital
Updates a single vital's maximum potential. Use `VitalID` mappings: Health=2, Stamina=4, Mana=6.
- `uint8` `Sequence`
- `uint32` `VitalID`
- `uint32` `Ranks`
- `uint32` `StartingValue`
- `uint32` `ExperienceSpent`
- `uint32` `CurrentValue` (New current value after max change)

### `0x02E9` PrivateUpdateVitalCurrent
Updates the current value of a vital (e.g., during health regeneration).
- `uint8` `Sequence`
- `uint32` `VitalID`
- `uint32` `CurrentValue`

---

## 3. Position and Physics (S2C)

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
(Listing truncated for brevity, refer to source for full bitmasks)

**Alignment:** Align cursor to 4-byte boundary after this section.

### `0xF74B` SetState (S2C)
Used to update the `PhysicsState` bitmask of an object (e.g., hiding/revealing an object or making it ethereal).
- `uint32` `GUID`
- `uint32` `PhysicsState`
- `uint32` `InstanceSeq`
- `uint32` `StateSeq`

### `0xF74A` PickupEvent (S2C)
Signals that an object has been picked up from the world. Typically triggers a despawn in the client.
- `uint32` `GUID`

### `0xF749` ParentEvent (S2C)
Signals that an object has been physically linked to another object. This primary affects the object's physics and coordinate system (making its position relative to the parent).
- `uint32` `ParentGUID`
- `uint32` `ChildGUID`
- `uint32` `LocationID`
- `uint32` `Placement`
- `uint16` `ParentInstanceSeq`
- `uint16` `ChildPositionSeq`

### `0xF748` UpdatePosition (S2C)
Sent frequently to sync object locations. Contains `PositionPack`.

### `0xF74C` UpdateMotion (S2C)
Sent for object animations and movement state changes. Includes `MovementPack`.

### `0xF74E` VectorUpdate (S2C)
Sent to sync object velocity and angular velocity.

---

## 4. Game Events (`0xF7B0`)

The `GameEvent` message is a multiplexer for a wide variety of UI, magic, and world events.

**Payload Structure:**
1. `uint32`: Truncated Target GUID (4 bytes).
2. `uint32`: Sequence Number.
3. `uint32`: Sub-Opcode (`EventType`).
4. `Byte[]`: Payload.

### Magic & Enchantment Events

| Sub-Opcode | Name | Description |
| :--- | :--- | :--- |
| `0x02C2` | `MagicUpdateEnchantment` | Update or add an enchantment. |
| `0x02C3` | `MagicRemoveEnchantment` | Remove an enchantment (expiration). |
| `0x02C4` | `MagicUpdateMultipleEnchantments` | Batch update of multiple enchantments. |
| `0x02C6` | `MagicPurgeEnchantments` | Clear all enchantments from target. |
| `0x02C7` | `MagicDispelEnchantment` | Silent removal of a specific enchantment. |
| `0x0312` | `MagicPurgeBadEnchantments` | Remove all harmful/negative enchantments. |

### `0x0013` PlayerDescription
Sent as a **GameEvent** when the player first enters the world. It provides a complete snapshot of the player's character, including properties, status, attributes, skills, and enchantments.

#### Structure
1. **Header**
   - `uint32`: `propertyFlags` (determines which property tables follow).
   - `uint32`: `weenieType` (usually `0x0001` for player).
2. **Property Tables**
   Tables for `Int32`, `Int64`, `Bool`, etc., appear in order of flag bits. Each starts with Header: `uint16 count`, `uint16 numBuckets`.
   Note: Strings in property tables are not padded.
3. **Status Data**
   - `uint32`: `vectorFlags` (Attributes, Skills, Spells, Enchantments).
   - `uint32`: `hasHealthStats` (bool).
4. **Status Vectors**
   - **Attributes (0x01)**: `uint32` mask + entries (Ranks, StartingValue, Experience).
   - **Skills (0x02)**: `u16 count`, `u16 buckets` + entries (SkillID, Ranks, Advancement, etc).
   - **Enchantments (0x200)**: Masked sync of all active effects.

---

## 5. Client Actions (`0xF7B1`)

Primary way clients send commands and interactions to the server.

**Structure:**
1. `uint32`: Sequence Number.
2. `uint32`: ActionType (e.g. `0x0015` Talk).
3. `Byte[]`: Payload.

#### Common Actions:
- **`0x00A1` LoginComplete:** Character is ready to spawn.
- **`0x0015` Talk:** Send chat or commands.
- **`0x0036` Use:** Interact with world objects or items.

### Combat Game Actions

The combat stance toggle and targeted attack packets are sent as `0xF7B1` game actions with a 4-byte sequence, a 4-byte action opcode, then the action payload.

#### `0xF7B1:0x0008` TargetedMeleeAttack (C2S)
Starts or continues a melee attack against a specific target.

| Type | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `TargetGUID` | GUID of the creature or attackable world object being attacked. |
| `uint32` | `AttackHeight` | Vertical attack selection. ACE values: `High = 1`, `Medium = 2`, `Low = 3`. |
| `float32` | `PowerLevel` | Melee power slider value, clamped by ACE to `[0.0, 1.0]`. |

ACE-backed fixture used by holtburger parity tests:
- Sequence: `0`
- Target: `0x80000001`
- Height: `Medium`
- Power: `0.5`
- Full bytes: `000000000800000001000080020000000000003F`

#### `0xF7B1:0x000A` TargetedMissileAttack (C2S)
Starts or continues a missile attack against a specific target.

| Type | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `TargetGUID` | GUID of the creature or attackable world object being attacked. |
| `uint32` | `AttackHeight` | Vertical attack selection. ACE values: `High = 1`, `Medium = 2`, `Low = 3`. |
| `float32` | `AccuracyLevel` | Missile accuracy slider value, clamped by ACE to `[0.0, 1.0]`. |

ACE-backed fixture used by holtburger parity tests:
- Sequence: `0`
- Target: `0x80000002`
- Height: `High`
- Accuracy: `1.0`
- Full bytes: `000000000A00000002000080010000000000803F`

#### `0xF7B1:0x0053` ChangeCombatMode (C2S)
Changes the player combat stance. holtburger uses this before targeted melee or missile attacks when the current stance does not already match.

| Type | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `CombatMode` | ACE bitmask values. Common stances are `NonCombat = 1`, `Melee = 2`, `Missile = 4`, `Magic = 8`. |

#### Holtburger TUI Combat Controls

The current holtburger TUI exposes melee and missile controls in the dynamic pane.

- Melee shows `Pow` for the outgoing `PowerLevel` float.
- Missile shows `Acc` for the outgoing `AccuracyLevel` float.
- Both modes show `Hgt` for the `AttackHeight` enum.
- The fixed preset mapping is `Low = 0.0`, `Medium = 0.5`, `High = 1.0`.
- The default local control state is `Medium` preset and `Medium` height.
- `v` cycles power or accuracy and `h` cycles attack height, but only while the dynamic pane has focus.
- There is no dedicated attack key. Entering melee or missile mode with a valid target sends `ChangeCombatMode` followed by the targeted attack action in the same command batch. Selecting a valid target while already in melee or missile mode sends only the targeted attack action.

---

## 6. Trade and Vendors

Interactions with vendors and other players use a combination of `GameEvent` (S2C) and `GameAction` (C2S) messages.

### Vendors

#### `0xF7B0:0x0062` ApproachVendor (S2C)
Sent when a merchant interaction begins. Includes full inventory and pricing.

| Type | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `VendorID` | GUID of the vendor. |
| `uint32` | `ItemTypes` | Bitmask of item types accepted. |
| `uint32` | `MinValue` | Minimum item value accepted. |
| `uint32` | `MaxValue` | Maximum item value accepted. |
| `uint32` | `DealMagical` | Whether vendor handles magical items. |
| `float32` | `BuyMultiplier` | Price multiplier for buying (e.g. 1.25). |
| `float32` | `SellMultiplier` | Price multiplier for selling (e.g. 0.75). |
| `uint32` | `AltWCID` | WCID of alternate currency (if used). |
| `uint32` | `AltAmount` | Amount of alternate currency required. |
| `String16L` | `AltName` | Name of alternate currency. |
| `uint32` | `ItemCount` | Number of items in vendor's inventory. |
| `VendorItem[]` | `Items` | List of items available for purchase. |

#### `0xF7B1:0x005F` Buy (C2S)
Request to purchase items. Payload: `VendorID` (u32), `ItemCount` (u32), `ItemProfile[]`.

#### `0xF7B1:0x0060` Sell (C2S)
Request to sell items. Payload: `VendorID` (u32), `ItemCount` (u32), `ItemProfile[]`.

---

### Player-to-Player Trade

| Opcode | Name | Type | Description |
| :--- | :--- | :--- | :--- |
| `0xF7B0:0x01FD` | `RegisterTrade` | S2C | Initiates trade handshake. |
| `0xF7B0:0x01FE` | `OpenTrade` | S2C | Confirms trade window is open. |
| `0xF7B0:0x01FF` | `CloseTrade` | S2C | Ends trade session (Success/Cancel). |
| `0xF7B0:0x0200` | `AddToTrade` | S2C | Partner added item to window. |
| `0xF7B0:0x0202` | `AcceptTrade` | S2C | Participant accepted agreement. |
| `0xF7B0:0x0203` | `DeclineTrade` | S2C | Participant declined/canceled. |
| `0xF7B0:0x0205` | `ResetTrade` | S2C | Acceptance cleared due to change. |
| `0xF7B1:0x01FA` | `AcceptTrade` | C2S | Client accepts current offer. |
| `0xF7B1:0x01FB` | `DeclineTrade` | C2S | Client cancels trade. |

