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
A player soul-emote broadcast on the dedicated soul-emote wire lane.

Important notes:

- ACE accepts player soul emotes on client action `0x01E1`, not the plain emote action opcode.
- The payload is authored chat text. Holtburger resolves the input alias through `ChatPoseTable` before sending the broadcast phrase; incoming broadcasts preserve the received text. Animation is conveyed separately by movement commands.
- Plain chat emotes and soul emotes are distinct transports and should not be collapsed back into one semantic lane.

| Type | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `SenderID` | GUID of the emoter. |
| `String16L` | `SenderName` | Name of the emoter (may include prefixes like `+`). |
| `String16L` | `EmoteText` | Soul-emote broadcast text, typically the catalog's `other_emote` phrase such as `waves.`. |

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
| `uint16` | `InstanceSeq` | Object incarnation. |
| `uint16` | `PositionSeq` | Position timestamp shared with attachment updates. |

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
- `uint16` `InstanceSeq`
- `uint16` `PositionSeq`

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

### Barbershop appearance

`StartBarber` is S2C game event `0xF7B0:0x0075`. `FinishBarber` is C2S action `0xF7B1:0x0311`. After their normal event/action headers, both carry the same **64-byte payload**, sixteen little-endian `uint32` words in this order:

| Word | Meaning |
| :--- | :--- |
| 0 | Base palette DID |
| 1 | Head GfxObj DID |
| 2–3 | Hair current and original texture DIDs |
| 4–5 | Eyes current and original texture DIDs |
| 6–7 | Nose current and original texture DIDs |
| 8–9 | Mouth current and original texture DIDs |
| 10–12 | Skin, hair, and eye palette DIDs |
| 13 | Setup DID |
| 14 | Option 1: Empyrean earthbound flag; otherwise unused by ACE |
| 15 | Option 2: reserved; retail sends zero |

The current texture is the replacement; the original identifies the texture to replace. Zero head/texture values are legitimate for some nonhuman bodies. A client must interpret them against its existing heritage and sex rather than reject every zero or substitute human assets.

Undead facial rows contain paired zombie/skeleton texture substitutions for the same eye, nose, or mouth choice. ACE's `PlayerFactory.cs` initializes these properties through `ACE.DatLoader/Entity/SexCG.cs`, whose facial getters always take substitution zero, including for skeleton setups. An opening can therefore contain the authored zombie pair on a skeleton body. Identify the logical face choice from either complete authored pair, then resolve the setup-specific pair for FinishBarber. Unknown or mixed current/original pairs must still fail; do not reset the choice to zero.

There are no incremental editing messages, barber Cancel action, finish acknowledgment, NPC identity, distance limit, or expiry in this payload. ACE admits a finish only while its server-owned `BarberActive` flag is set, validates the complete assets against the existing heritage/sex, then clears the flag. Cancel is local UI retirement; it does not clear the server flag. Transport failure after reliable enqueue is ambiguous and must not trigger automatic resubmission.

ACE broadcasts an ordinary ObjDesc after valid edits. Its full-object refresh is disabled because of movement desynchronization, so observer setup/motion synchronization has known limits. Empyrean local motion follows the private MotionTable property update. Retail crown/flame Apply also clears local particles and optionally plays a racial script; that is separate from the finish payload and temporary editing visuals.

Sources: `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventStartBarber.cs`; `ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionFinishBarber.cs`; `ACE/Source/ACE.Server/WorldObjects/Player_Character.cs`, `HandleActionFinishBarber`; retail `acclient-eor-source/acclient.c:260111–260334`, `gmBarberUI::HandleApply`, and `acclient.c:664607`, `CM_Character::Event_FinishBarber`. The protocol codec lives in `crates/holtburger-protocol/src/messages/character/barber.rs`.

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

### Combat Game Events

These `0xF7B0` events provide the retail combat feedback stream that ACE sends while an attack starts, lands, misses, or ends. holtburger now unpacks them as typed protocol messages and surfaces them to the CLI chat panel.

#### `0xF7B0:0x01B8` CombatCommenceAttack (S2C)
Sent when the server has accepted the attack and combat animation timing begins.

Payload: none.

ACE-backed fixture used by holtburger parity tests:
- Sequence: `5`
- Full bytes: `B0F700000000000005000000B8010000`

#### `0xF7B0:0x01A7` AttackDone (S2C)
Sent when an attack sequence finishes. The payload is a `WeenieError` result code.

| Type | Name | Description |
| :--- | :--- | :--- |
| `uint32` | `WeenieError` | ACE completion code. `0x36` is `ActionCancelled` in the parity fixture. |

ACE-backed fixture used by holtburger parity tests:
- Sequence: `0`
- Full bytes: `B0F700000000000000000000A701000036000000`

#### `0xF7B0:0x01B1` AttackerNotification (S2C)
Sent to the attacker when a hit lands.

| Type | Name | Description |
| :--- | :--- | :--- |
| `String16L` | `DefenderName` | Target display name. |
| `uint32` | `DamageType` | ACE damage-type bitmask. |
| `float64` | `HealthPercent` | Remaining target health fraction after the hit. |
| `uint32` | `Damage` | Damage dealt. |
| `uint32` | `CriticalHit` | `0` or `1`. |
| `uint64` | `AttackConditions` | ACE bitflags such as `Recklessness`, `SneakAttack`, or `Overpower`. |

ACE-backed fixture used by holtburger parity tests:
- Sequence: `1`
- Defender: `Drudge Ravener`
- Damage type: `Slash`
- Health percent: `0.25`
- Damage: `37`
- Critical hit: `true`
- Attack conditions: `Recklessness | SneakAttack`

#### `0xF7B0:0x01B2` DefenderNotification (S2C)
Sent to the defender when an incoming hit lands.

| Type | Name | Description |
| :--- | :--- | :--- |
| `String16L` | `AttackerName` | Attacker display name. |
| `uint32` | `DamageType` | ACE damage-type bitmask. |
| `float64` | `HealthPercent` | Remaining player health fraction after the hit. |
| `uint32` | `Damage` | Damage taken. |
| `uint32` | `DamageLocation` | Hit location enum. ACE values cover `Head` through `Foot`. |
| `uint32` | `CriticalHit` | `0` or `1`. |
| `uint64` | `AttackConditions` | ACE bitflags such as `Overpower`. |

ACE-backed fixture used by holtburger parity tests:
- Sequence: `2`
- Attacker: `Banderling`
- Damage type: `Fire`
- Health percent: `0.125`
- Damage: `18`
- Damage location: `Chest`
- Critical hit: `false`
- Attack conditions: `Overpower`

#### `0xF7B0:0x01B3` EvasionAttackerNotification (S2C)
Sent to the attacker when the defender evades.

| Type | Name | Description |
| :--- | :--- | :--- |
| `String16L` | `DefenderName` | Defender display name. |

#### `0xF7B0:0x01B4` EvasionDefenderNotification (S2C)
Sent to the defender when they evade an attack.

| Type | Name | Description |
| :--- | :--- | :--- |
| `String16L` | `AttackerName` | Attacker display name. |

#### `0xF7B0:0x01AC` VictimNotification (S2C)
Sent to the victim with the death string displayed by the retail client.

| Type | Name | Description |
| :--- | :--- | :--- |
| `String16L` | `DeathMessage` | Death text. |

Parity fixture message: `You have died!`

#### `0xF7B0:0x01AD` KillerNotification (S2C)
Sent to the killer with the kill confirmation string displayed by the retail client.

| Type | Name | Description |
| :--- | :--- | :--- |
| `String16L` | `DeathMessage` | Kill text. |

Parity fixture message: `You killed the drudge!`

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
| `uint32` | `MinValue` | Retail inclusive minimum per-unit sale value; `0xFFFFFFFF` means unbounded. |
| `uint32` | `MaxValue` | Retail inclusive maximum per-unit sale value; `0xFFFFFFFF` means unbounded. |
| `uint32` | `DealMagical` | Whether vendor handles magical items. |
| `float32` | `BuyMultiplier` | Vendor buying multiplier: pyreal proceeds when the player sells. |
| `float32` | `SellMultiplier` | Vendor selling multiplier: cost when the player buys. |
| `uint32` | `AltWCID` | WCID of alternate currency (if used). |
| `uint32` | `AltAmount` | Player alternate-currency count, plus currency spent during a purchase refresh. |
| `String16L` | `AltName` | Name of alternate currency. |
| `uint32` | `ItemCount` | Number of items in vendor's inventory. |
| `VendorItem[]` | `Items` | List of items available for purchase. |

The catalog is one complete flat list, also sent after trades; category sections are
client presentation. Each `VendorItem` is a packed `uint32` followed by a
`PublicWeenieDescription`. The low 24 bits hold supply (`0xFFFFFF` means unlimited),
and the high byte identifies the description format (`0xFF` is the current format).
Supply is distinct from the description's stack quantity. The message is padded to
four-byte alignment and may span multiple transport fragments.

Retail `VendorProfile::InqAcceptability` (`acclient.c:485596`) divides item value by
nonzero stack count with integer truncation, otherwise uses the object's value.
Zero unit value is refused. Bounds include equality. An over-maximum promissory
note (`ItemType` bit `0x40000`) returns acceptable before the minimum check. ACE's
`Player_Commerce.VerifySellItems` enforces types, sellability, retained state,
positive value, and container/trade restrictions, but not these retail value
bounds. The client deliberately applies the retail bounds during draft evaluation.
The retail predicate does not consult `DealMagical`.

#### `0xF7B1:0x005F` Buy (C2S)
Request to purchase items. Payload: `VendorID` (u32), `ItemCount` (u32), `ItemProfile[]`.

#### `0xF7B1:0x0060` Sell (C2S)
Request to sell items. Payload: `VendorID` (u32), `ItemCount` (u32), `ItemProfile[]`.

Both actions carry each `ItemProfile` as `Amount` (`int32`, positive) followed by
`ObjectGUID` (`uint32`). They are separate operations; the protocol does not offer
an atomic mixed barter transaction.

For default stock, ACE interprets purchase amounts as units and creates physical
stacks up to the template's maximum. For unique resale stock, it transfers the
existing whole object. The catalog does not explicitly identify these two server
collections, so this client quotes finite offers as whole displayed stacks. Each
created/transferred object is priced separately: ACE multiplies value by the
single-precision vendor rate, then uses `ceil(product - 0.1)` for purchases and
`floor(product + 0.1)` for sales. Promissory notes have fixed purchase/sale rates
of `1.15` and `1.0`. Sales pay pyreals even at alternate-currency vendors.

A sale may accept only a subset of requested sources. Successful removals emit
`InventoryPutObjInContainer` with the item GUID and vendor destination, including
items the vendor subsequently destroys. Match that receipt set to requested
sources; a stock refresh is not evidence that every item sold. ACE sends the
refresh before payout completion and terminal `UseDone`. A reasonless
`InventoryServerSaveFailed` keyed by the player GUID still means failure;
`UseDone(None)` alone does not prove success. A combined client operation waits
for the sale's terminal `UseDone` before sending Buy, even when the sale was
partially or fully refused. It preserves the sale issue alongside the purchase
outcome. Timeouts and failed sends stop progression. If Buy fails, the completed
sale remains committed.

Sources: `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventApproachVendor.cs`,
`ACE/Source/ACE.Server/WorldObjects/Vendor.cs` (`ItemProfileToWorldObjects`,
`BuyItems_ValidateTransaction`, `GetSellCost`, `CalculatePayoutCoinAmount`), and
`ACE/Source/ACE.Server/WorldObjects/Player_Commerce.cs` (`HandleActionSellItem`).
`NetworkSession.SendBundle` preserves UIQueue order when a fragment does not fit;
client transport orders datagrams and reassembles complete messages before dispatch.


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

---

### Housing

Housing actions use the normal `0xF7B1` GameAction envelope (sequence, action opcode).
Events use `0xF7B0` (target character, event sequence, event opcode). Bodies below
exclude these envelope fields. Numeric fields are little-endian; GUIDs are u32.
`bool32` is a u32 boolean. `String16L` is the aligned Windows-1252 length-prefixed
string described in [serialization](serialization.md), including its extended-length
form. `List<T>` is a u32 count followed by that many elements; it is distinct from
HAR's packed hash-table header.

| Direction | Opcode | Body in wire order |
| --- | --- | --- |
| C2S BuyHouse | `0x021C` | crystal GUID, List<item GUID> |
| C2S HouseQuery | `0x021E` | empty |
| C2S AbandonHouse | `0x021F` | empty |
| C2S RentHouse | `0x0221` | crystal GUID, List<item GUID> |
| S2C HouseProfile | `0x021D` | crystal GUID, HouseProfile structure below |
| S2C HouseData | `0x0225` | HouseData structure below |
| S2C HouseStatus | `0x0226` | status/error u32 |
| S2C UpdateRentTime | `0x0227` | period-start Unix timestamp u32 |
| S2C UpdateRentPayment | `0x0228` | List<HousePayment> |
| S2C UpdateHar | `0x0257` | versioned access structure below |
| S2C HouseTransaction | `0x0259` | raw notice u32 |
| C2S ListAvailableHouses | `0x0270` | house type u32 |
| S2C AvailableHouses | `0x0271` | house type u32, List<location cell u32>, total available i32 |

`HousePayment` fields, in order, are required i32, paid i32, item template/WCID u32,
singular name String16L, plural name String16L. Preserve signed values when decoding;
negative requirement/progress is invalid usable housing knowledge, not an unsigned
quantity. The action transmits physical item identities, not per-stack requested
quantities. ACE decides which quantities to consume, accepts partial maintenance
contributions, and can round trade-note consumption above credited value. A quote
must expose consumed versus credited value and must be revalidated before submission.

`HouseProfile` fields are dwelling ID u32, owner GUID, flags u32, minimum level i32,
maximum level i32, minimum allegiance rank i32, maximum allegiance rank i32,
maintenance-free bool32, house type u32, owner name String16L, List<HousePayment>
purchase requirements, List<HousePayment> maintenance requirements. Restriction -1
means unbounded. Owner zero means available. House types 1/2/3/4 mean cottage/villa/
mansion/apartment. Unknown raw flags/types should remain lossless, without invented
capabilities.

`HouseData` fields are purchase Unix timestamp u32, maintenance period-start Unix
timestamp u32, house type u32, maintenance-free bool32, purchase-payment list,
maintenance-payment list, and Position. Position is 32 bytes: cell/landblock u32,
local x/y/z f32, then quaternion w/x/y/z f32, in that order.
HouseData contains no owner, dwelling ID, or crystal identity; do not link it to a
nearby crystal by matching location. Apartment purchase time is not a reliable
purchase date. ACE periods are 30 days for landscape houses and 90 days for apartments;
period end and next payment due differ when maintenance is already paid or free.

#### Named access records and management

HAR is versioned. Decode its first u32 before reading optional fields:

- Legacy values `0..0xFFFF`: the value itself is public-entry status. Read the guest
  table immediately afterward; allegiance/roommate disclosure is absent.
- `0x10000001`: read flags u32, monarch GUID, then the guest table.
- `0x10000002`: read flags u32, monarch GUID, guest table, then List<roommate GUID>.
- Other headers have no established layout; reject rather than guessing offsets.

The guest table starts with entry count u16 and bucket count u16, followed by that
many records: character GUID key, storage-allowed bool32, character name String16L.
The bucket count is hash metadata, not an additional list. An entry grants named
entry permission; its boolean adds storage. Versioned flags disclose public entry
(bit 0), allegiance entry (bits 1 or 2), and allegiance storage (bit 2). Storage also
implies entry. Roommates exclude the owner and cannot identify the owning character.

| C2S opcode | Action | Body |
| --- | --- | --- |
| `0x0245` | AddPermanentGuest | name String16L |
| `0x0246` | RemovePermanentGuest | name String16L |
| `0x0247` | SetOpenHouseStatus | enabled bool32 |
| `0x0249` | ChangeStoragePermission | name String16L, allowed bool32 |
| `0x024A` | BootSpecificHouseGuest | name String16L |
| `0x024C` | RemoveAllStoragePermission | empty |
| `0x024D` | RequestFullGuestList | empty |
| `0x025C` | AddAllStoragePermission | empty |
| `0x025E` | RemoveAllPermanentGuests | empty |
| `0x025F` | BootEveryone | empty |
| `0x0266` | SetHooksVisibility | enabled bool32 |
| `0x0267` | ModifyAllegianceGuestPermission | enabled bool32 |
| `0x0268` | ModifyAllegianceStoragePermission | enabled bool32 |

Management targets the server's implicit effective home. RequestFullGuestList returns
named HAR; HouseQuery does not. Permission edits generally emit chat and nearby
restriction updates, so request HAR explicitly afterward. Abandonment and allegiance
permission changes require the directly owning character; account relationship alone
does not establish eligibility. Abandonment removes the deed and performs a home query;
that query may select another account home. Hook visibility and booting lack an
explicit retained completion field. Show/hide commands affect empty hooks; occupied
hooks keep world-container interactions.

HouseQuery selects the character/account home according to ACE's `house_per_char`
policy. BadParam HouseStatus is an empty query result; HouseEvicted is also used in
login bookkeeping and is not proof of no home. Maintenance events modify retained
facts but do not answer a complete home query. Crystal rejection must likewise remain
independent of home/access query admission.

HouseProfile, HAR, and HouseData do not echo a client request ID. Ordinary crystal Use
returns a profile; ACE QueryLord (`0x0258`) currently has no refresh implementation.
Recover payment facts through HouseQuery and a reachable ordinary Use without
rearming mutation admission, replaying window-opening intent, or retrying payment.
Payment completion requires matching authoritative ownership/progress and expected
physical consumption; generic UseDone, chat, and send completion are insufficient.

Available locations are deduplicated areas from `HouseList.GetAvailableLocations`,
not individual crystal listings. Total available counts houses independently of area
count. Apartment results remain textual; their location cells do not establish a
usable apartment map marker.

Ground truth: `ACE/Source/ACE.Server/Network/Structure/{HouseProfile,HouseData,
HousePayment,HouseAccess,GuestInfo}.cs`, `Player_House.cs`, `SlumLord.cs`, `House.cs`,
`Entity/HouseList.cs`, corresponding housing GameAction/GameEvent writers, and retail
`acclient.c:452545` (HAR unpack), `452232` (GuestInfo unpack), `239488` (payment IDs),
`239914` (profile window), and `383610` (initial housing query). The implemented
codecs and checked-in synthetic fixtures are in `messages/housing/`; live ACE trace
verification is tracked separately in the housing implementation plan.

### Contracts journal

Contract definitions are static client content; these messages carry a character's
tracked IDs and server-computed progress. All numeric fields below are little-endian.

| Direction / opcode | Message | Body |
| --- | --- | --- |
| S2C `0x0314` | SendClientContractTrackerTable | count u16, bucket count u16, then count entries of key u32 and ContractTracker |
| S2C `0x0315` | SendClientContractTracker | ContractTracker, delete bool32, set-as-display bool32 |
| C2S `0x0316` | AbandonContract | contract ID u32 |

S2C bodies use the ordinary game-event envelope (target GUID and event sequence);
C2S uses the game-action envelope. The bucket count is hash metadata, not another
collection. Each keyed ID must equal the tracker's embedded ID. A full table replaces
membership, including an explicitly empty table. An incremental deletion removes by
ID; it does not insert an unknown ID. Set-as-display is retained on the wire, but h3d
currently has no pinning/display-selection UX.

ContractTracker occupies 28 bytes:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | u32 | definition version |
| 4 | u32 | contract ID |
| 8 | u32 | stage |
| 12 | f64 | deadline seconds remaining |
| 20 | f64 | repeat seconds remaining |

Stages are 1 Available, 2 In progress, 3 Done or pending repeat, and 4 or above
an in-progress counter of `stage - 4`. Stage zero is invalid. Counter packing
requires `count <= u32::MAX - 4`. Version is preserved; neither retail's unpacker
nor this layout establishes a version-equality requirement with static definitions.

Despite ACE's `TimeWhenDone` / `TimeWhenRepeats` names, timers are remaining
seconds, not timestamps. Finite negative values represent expired/sentinel
outcomes; nonfinite values are rejected. Record a monotonic receipt anchor and
subtract elapsed seconds. Stage 3 with an originally positive repeat duration
waits while remaining time is positive, then becomes Available. Without an
originally positive duration, it is Completed only if the static repeat flag is
empty; otherwise it is Available. A deadline is shown only when the definition
has a timer flag. Expiry means Finished for that deadline, independently of quest
status. Counter text comes from the authored progress description, not a universal
percentage or inferred target.

Static definitions are in portal record `0x0E00001D`. The record contains its u32
ID, count u16, bucket count u16, then count entries: ID key u32; version u32;
contract ID u32; eleven aligned String16L values (name, description, progress
format, start NPC, end NPC, stamped flag, started flag, finished flag, progress
flag, timer flag, repeat flag); three 32-byte Positions (start NPC, end NPC,
quest area). Position is cell u32, x/y/z f32, quaternion w/x/y/z f32. Each string
ends at a four-byte boundary. Preserve full positions even though retail journal
labels derive coordinates from the terrain cell ID. Duplicate names are valid;
identity is the contract ID.

ACE omits the full tracker table on login when the character registry is empty.
Clients must establish an empty baseline at character entry, retain it across
portals, and clear it on character retirement. Abandonment erases tracking only;
quest flags/progress remain. Queue acceptance is not deletion confirmation. A
client can leave the row until the authoritative incremental deletion arrives,
without an optimistic mutation or acknowledgement timer.

Ground truth: `ACE/Source/ACE.Server/Network/Structure/ContractTracker.cs`, the
corresponding GameEvent/GameAction writers, `WorldObjects/Managers/ContractManager.cs`,
`Player_Networking.cs`, `Managers/QuestManager.cs`,
`ACE/Source/ACE.DatLoader/{FileTypes/ContractTable,Entity/Contract}.cs`, and retail
`acclient.c:201079` (status), `201271` (contacts/deadline), `380182` / `380249`
(receipt anchors), `431336` (tracker unpack), and `432424` (definition unpack).
