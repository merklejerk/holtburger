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

### 3.1 `PackedDword`
A variable-length encoding for 32-bit unsigned integers.

- If `value <= 0x7FFF` (32767):
  - Encoded as `uint16`.
- If `value > 0x7FFF`:
  - `packedValue = (value << 16) | ((value >> 16) | 0x8000)`
  - Encoded as `uint32`.

### 3.2 Strings

#### `String16L`
Used for most strings in game messages.
1. `length`: `uint16` (Number of characters).
2. `data`: `length` bytes of Windows-1252 encoded text.
3. `padding`: 0-3 bytes of `0x00` such that the total size of the string field (length + data + padding) is a **multiple of 4**.

Note: ACE calculates this using `4 * ((2 + length + 3) / 4) - (2 + length)`.

#### `String32L`
Used primarily in the `LoginRequest` for passwords and authentication tokens. This format is idiosyncratic to the login handshake.
1. `data_length`: `uint32`. This is the total number of bytes following this field (including the string length prefix and padding).
2. `string_length`: A variable-length prefix (1 or 3 bytes). 
   - If `string_length < 255`, it's 1 byte (the length).
   - If `string_length >= 255`, it's 3 bytes (`0xFF` followed by `uint16` length).
3. `data`: `string_length` bytes of Windows-1252 text.
4. `padding`: 0-3 bytes of `0x00` such that the total size of the `String32L` (including the `data_length` prefix) is a multiple of 4.

### 3.3 Enums
Enums are typically serialized as their underlying integer type (usually `uint32` for Opcodes).
