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
