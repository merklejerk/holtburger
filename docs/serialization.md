# Asheron's Call Protocol: Binary Serialization

## 1. Endianness
All numerical values are **Little-Endian**.

## 2. Basic Types

| Type | Size (bytes) | Description |
| :--- | :--- | :--- |
| `int16`, `uint16` | 2 | Standard signed/unsigned 16-bit integer. |
| `int32`, `uint32` | 4 | Standard signed/unsigned 32-bit integer. |
| `int64`, `uint64` | 8 | Standard signed/unsigned 64-bit integer. |
| `float` | 4 | IEEE 754 single-precision floating point. |
| `double` | 8 | IEEE 754 double-precision floating point. |

## 3. Custom Types

### 3.1 `PackedDword` (Compressed Integer)
A variable-length encoding for 32-bit unsigned integers used extensively for GUIDs and quantities.

- **Small Values ($v \le 0x7FFF$):**
  - Encoded as a single `uint16`.
- **Large Values ($v > 0x7FFF$):**
  - Encoded as 4 bytes.
  - The high bit (`0x8000`) of the **first** word is set to signal a 4-byte value.
  - Formally: `packed = (value << 16) | ((value >> 16) | 0x8000)`.
  - To decode: Read `uint16` (word1). If `(word1 & 0x8000) != 0`, clear the bit, shift left 16, and add a second `uint16` (word2).

### 3.2 Strings

#### `String16L` (Common String)
Used for most strings (names, chat, descriptions).
1. `length`: `uint16` (Number of characters).
2. `data`: `length` bytes of Windows-1252 encoded text.
3. `padding`: 0-3 bytes of `0x00`. **Crucial:** The padding must ensure that the *total* number of bytes used by the string (including the 2-byte length prefix) is a **multiple of 4**.
   - *Example:* A 3-character string ("abc") takes 2 (length) + 3 (data) = 5 bytes. It requires 3 bytes of padding to reach 8 bytes.

**Discrepancy Note:** Strings stored within **Property Hash Tables** (like in `PlayerDescription` 0xF7B0:0x0013) are **NOT PADDED**. They consist only of the 2-byte length and the data. Any attempt to align them to 4 bytes will result in a parsing drift.

#### `String32L` (Login String)
Used exclusively in the `LoginRequest`.
1. `data_total_len`: `uint32`. This is the count of all bytes following this field (Length Prefix + Data + Padding).
2. `string_len_prefix`: 1 or 3 bytes.
   - If `len < 255`, it's 1 byte.
   - If `len >= 255`, it's `0xFF` followed by `uint16` length.
3. `data`: `string_len_prefix` bytes of text.
4. `padding`: 0-3 bytes to align the entire message block to 4 bytes.

**Pro-Tip:** If you are implementing a writer, always calculate your offsets based on the actual bytes written, as `PackedDword` and `String32L` will shift all subsequent field locations.

### 3.3 Enums
Enums are typically serialized as their underlying integer type (usually `uint32` for Opcodes).

### 3.4 Geometry & Position

#### `Vector3` (12 bytes)
Three `float32` values: `x`, `y`, `z`.

#### `Quaternion` (16 bytes)
Four `float32` values: `w` (scalar), `x`, `y`, `z` (vector).
**Note:** Asheron's Call serializes the `w` component first.

#### `Position` (Complex)
Asheron's Call uses a hierarchical coordinate system based on **Landblocks**.

| Name | Type | Size | Description |
| :--- | :--- | :--- | :--- |
| `objcell_id` | `uint32` | 4 | The ID of the cell (Landblock + Grid). |
| `frame` | `Vector3` | 12 | Local coordinates within the cell. |
| `orientation`| `Quaternion`| 16 | Rotation relative to the cell's frame (W, X, Y, Z). |

A `Position` can be serialized in two ways:
1. **Raw (32 bytes):** Used in `ObjectCreate` (`0xF745`). Fixed format: `objcell_id`, `frame`, `orientation`.
2. **Variable-Length (`PositionPack`):** Used in `UpdatePosition` (`0xF748`) and other real-time updates. A bitmask determines if velocity, placement, or individual quaternion components are included. See [movement.md](movement.md) for full details.

---
**Pro-Tip:** The high bit of the `objcell_id` indicates if the entity is in an **interior** (dungeon/building) or **dynamic** cell.

## 4. Complex Structs

### 4.1 `Skill` Struct (32 bytes)
The skill record is a fixed-width 32-byte block used in `PlayerDescription` (`0xF7B0:0x0013`) and `UpdateSkill` (`0x02DD`).

| Offset | Type | Name | Description |
| :--- | :--- | :--- | :--- |
| 0 | `uint32` | `skill_id` | Unique ID of the skill. |
| 4 | `uint16` | `ranks` | Number of times the skill has been raised by spending XP. |
| 6 | `uint16` | `status` | Often `0x0001`. In `UpdateSkill`, bit flags (like `adjustPP`). |
| 8 | `uint32` | `sac` | Skill Advancement Class (Inactive=0, Untrained=1, Trained=2, Specialized=3). |
| 12 | `uint32` | `xp` | Total experience spent on this skill. |
| 16 | `uint32` | `init_level` | Base training bonus (+5 for Trained, +10 for Specialized). |
| 20 | `uint32` | `resistance` | Last check resistance or task difficulty (usually 0). |
| 24 | `double` | `last_used` | Timestamp of last skill usage. |

**Pitfall:** Do not read `ranks` and `status` as a single `uint32`. This results in correctly aligned offsets but garbage values for the rank level.

### 4.2 `Attribute` Struct (12-16 bytes)
Attributes and Vitals use similar structures but vary in whether `current` value is included.

- **Primary Attributes (12 bytes):** `ranks` (4), `starting_value` (4), `xp_spent` (4).
- **Vitals (16 bytes):** `ranks` (4), `starting_value` (4), `xp_spent` (4), `current_value` (4).

## 5. Common Pitfalls & Drift Check

1.  **Alignment Smashing:** Always sum up the byte counts of fields in a struct. If you are parsing a vector of structs and drift by even 2 bytes, the next struct will be unparseable.
2.  **Implicit Padding:** The server often calls `Align()` or `Writer.WritePosition` which can insert 1-3 bytes of zero-padding to reach a 4-byte boundary. Most major message groups (UI, GameEvent) start on 4-byte boundaries.
3.  **Hash Table Exceptions:** Property Hash Tables (`Bool`, `Int`, `Float`, `String`, etc.) are high-density and **do not pad lengths or strings**. Pointers/Refs inside them are raw.
4.  **Field Type Mismatches:** C# `Writer.Write(bool)` writes 4 bytes (mapping to `uint32`), whereas `Writer.Write((ushort)1)` writes 2 bytes. Always check the explicit cast in the `Pack` method!

---
**Standard Drift Test:** If your parser successfully reads a list of 10 items but crashes on the 11th, you have a 1-byte or 2-byte error in your item struct definition. Calculate: `(Actual_Offset_After_List - Expected_Offset_After_List) / Item_Count` to find the per-item "leak".
