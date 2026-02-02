# Magic Protocol

This document covers the protocol messages and structures related to spells and enchantments (buffs/debuffs).

## Game Event Header

Magic messages are typically wrapped in a `GameEvent` (`0xF7B0`) message. 

**CRITICAL:** While many Asheron's Call messages use 8-byte GUIDs, the `GameEvent` structure uses a **truncated 4-byte GUID** for its target and sequence fields.

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| 0 | `uint32` | opcode | `0xF7B0`. |
| 4 | `uint32` | target_guid | Truncated 4-byte GUID of the recipient. |
| 8 | `uint32` | sequence | Sequence number for UI/Event sync. |
| 12 | `uint32` | event_type | The sub-opcode (e.g., `0x02C2` for Enchantment). |

## Enchantment Structure

Length: 60 bytes (fixed) + 4 bytes optional `spell_set_id`.
Total size is 64 bytes if `has_spell_set_id` is set, otherwise 60.

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| 0 | `uint16` | spell_id | The ID of the spell. |
| 2 | `uint16` | layer | The layer of the enchantment. |
| 4 | `uint16` | spell_category | The category of the spell (e.g. 1 for attributes). |
| 6 | `uint16` | has_spell_set_id | Boolean flag (non-zero if `spell_set_id` is present). |
| 8 | `uint32` | power_level | The power level of the spell. |
| 12 | `float64` | start_time | Ticks from 0 down to `-duration` over time. |
| 20 | `float64` | duration | The duration of the spell in seconds (-1 for infinite). |
| 28 | `uint32` | caster_guid | The GUID of the caster. |
| 32 | `float32` | degrade_modifier | Modifier for how the spell degrades over time. |
| 36 | `float32` | degrade_limit | Limit for how much the spell can degrade. |
| 40 | `float64` | last_time_degraded| Timestamp of last degradation. |
| 48 | `uint32` | stat_mod_type | Bitmask of `EnchantmentTypeFlags`. |
| 52 | `uint32` | stat_mod_key | Property ID being modified (e.g. PropertyInt or Skill). |
| 56 | `float32` | stat_mod_value | The value of the modification. |
| 60 | `uint32` | spell_set_id | (Optional) The ID of the spell set. |

## Enchantment Layering and Stacking

Asheron's Call uses a layering system to handle multiple spells in the same category (e.g., multiple Strength buffs).

### Layers
- **Definition**: Each enchantment is assigned a `layer` (usually 1 or 2).
- **Function**: Layers act as backup slots. If you cast a weaker spell while a stronger one is active, the weaker one is stored in a secondary layer rather than being discarded.
- **Redundancy**: This allows the server to automatically promote a backup spell if the primary (strongest) one is dispelled or expires.

### Stacking Rules
Only one enchantment per `spell_category` can be active at a time across all layers. The server determines the "winner" based on:
1. **Power Level**: The enchantment with the highest `power_level` is active.
2. **Suppression**: Enchantments with lower power levels are "suppressed" and do not contribute to stats until the higher-power enchantment is removed.

### Layer Sources
While most player-cast spells occupy standard layers, specific items or quest rewards can sometimes occupy unique layers, allowing them to stack with standard magic (e.g., specific auras or unique item procs).

### EnchantmentTypeFlags

Determines how enchantments stack and what type of modification is applied.

| Bitmask | Name | Description |
|---------|------|-------------|
| `0x00000001` | `Attribute` | Modifies an attribute (e.g. Strength). |
| `0x00000002` | `SecondAtt` | Modifies a secondary attribute (Vitality). |
| `0x00000010` | `Skill` | Modifies a skill. |
| `0x00000020` | `BodyDamageValue` | Modifies weapon damage. |
| `0x00000080` | `BodyArmorValue` | Modifies armor level. |
| `0x00004000` | `Multiplicative` | Effect is a multiplier. |
| `0x00008000` | `Additive` | Effect is a flat addition. |
| `0x02000000` | `Beneficial` | The enchantment is a buff (positive effect). |
| `0x000000FF` | `StatTypes` | Mask for the specific stat type being modified. |

## LayeredSpell Structure

Small identifier used for removing specific enchantments.

| Offset | Type | Name | Description |
|--------|------|------|-------------|
| 0 | `uint16` | spell_id | |
| 2 | `uint16` | layer | |

### Expiration and Removal

Enchantments can expire based on their `duration`.

### Expiration and Removal

1. **Server-Side**: The server runs a heartbeat check approximately every **5 seconds**. 
   In ACE, an enchantment is considered expired when:
   `start_time <= -duration` (given `duration >= 0`).

2. **Client-Side/Tracking**: 
   The `start_time` field in the network message is **NOT** a Unix timestamp. Instead, it is a relative timer maintained by the server. When a spell is first cast, `start_time` is typically `0.0`. Every heartbeat, the server **decrements** this value by the heartbeat interval.
   
   To calculate the time remaining on a client:
   `time_remaining = start_time + duration`
   
   As the server value of `start_time` becomes more negative (approaching `-duration`), the sum approaches zero.

**Note:** A `duration` of `-1.0` indicates an infinite enchantment (e.g. Vitae, Item spells) that does not expire over time.

## Game Event Opcodes

These are used within the `GameEvent` (`0xF7B0`) message.

| Opcode | Name | Description |
|--------|------|-------------|
| `0x02C1` | `MagicUpdateSpell` | Update a spell in the spellbook. |
| `0x02C2` | `MagicUpdateEnchantment` | Apply or update an enchantment. |
| `0x02C3` | `MagicRemoveEnchantment` | Remove a single enchantment. |
| `0x02C4` | `MagicUpdateMultipleEnchantments` | Update multiple enchantments. |
| `0x02C5` | `MagicRemoveMultipleEnchantments` | Remove multiple enchantments. |
| `0x02C6` | `MagicPurgeEnchantments` | Remove all enchantments (e.g. on death). |
| `0x02C7` | `MagicDispelEnchantment` | Dispel a single enchantment (gives message). |
| `0x02C8` | `MagicDispelMultipleEnchantments` | Dispel multiple enchantments. |
| `0x0312` | `MagicPurgeBadEnchantments` | Purge all negative enchantments. |

## Initial Synchronization

When a player first enters the world, the server sends a full list of active enchantments within the **`PlayerDescription` (`0x0013`)** message, specifically in the `Enchantment` vector (flag `0x0200`).

This synchronization structure is called the **Enchantment Registry**.

### Enchantment Registry Structure

The registry is composed of a bitmask followed by one or more lists of enchantments.

| Type | Name | Description |
|------|------|-------------|
| `uint32` | `mask` | A bitmask of `EnchantmentMask` flags (see below). |

For each bit set in the `mask`, a list follows in this order:

| Bit | Name | Structure |
|-----|------|-----------|
| `0x01` | `Multiplicative` | `uint32` count + `Enchantment[]` |
| `0x02` | `Additive` | `uint32` count + `Enchantment[]` |
| `0x08` | `Cooldown` | `uint32` count + `Enchantment[]` |
| `0x04` | `Vitae` | `Enchantment` (single structure, no count) |

**Note:** The `Vitae` list is unique as it only ever contains a single entry (the player's Vitae Pen) and lacks a count prefix.

### EnchantmentMask Enum

| Value | Name |
|-------|------|
| `0x01` | `Multiplicative` |
| `0x02` | `Additive` |
| `0x04` | `Vitae` |
| `0x08` | `Cooldown` |

## Message Payloads

### `MagicUpdateEnchantment` (`0x02C2`)
- `Enchantment` structure

### `MagicUpdateMultipleEnchantments` (`0x02C4`)
- `uint32` count
- `Enchantment[]` array

### `MagicRemoveEnchantment` (`0x02C3`)
- `uint16` spell_id
- `uint16` layer

### `MagicRemoveMultipleEnchantments` (`0x02C5`)
- `uint32` count
- `LayeredSpell[]` array

### `MagicPurgeEnchantments` (`0x02C6`)
- (No payload)

### `MagicDispelEnchantment` (`0x02C7`)
- `uint16` spell_id
- `uint16` layer

### `MagicDispelMultipleEnchantments` (`0x02C8`)
- `uint32` count
- `LayeredSpell[]` array

### `MagicPurgeBadEnchantments` (`0x0312`)
- (No payload)

