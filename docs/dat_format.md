# Asheron's Call DAT File Format

The game uses proprietary binary database files (DATs) to store all assets. These files function as a simplified filesystem with B-Tree indexing and block-based storage.

## DAT Initialization (Master Header)

Every DAT file begins with a master header at offset `0x140`.

| Field | Type | Size | Description |
| :--- | :--- | :--- | :--- |
| Magic | `uint32` | 4 | Fixed value `0x00005442` ("BT") |
| BlockSize | `uint32` | 4 | Sector size. **256** (Cell) or **1024** (Portal/Local). |
| FileSize | `uint32` | 4 | Total size of the DAT file in bytes. |
| DataSet | `uint32` | 4 | **1**: Portal, **2**: Cell, **3**: Local. |
| Subset | `uint32` | 4 | Internal subset identifier. |
| FreeHead | `uint32` | 4 | Byte offset to the first block in the Free List. |
| FreeTail | `uint32` | 4 | Byte offset to the last block in the Free List. |
| FreeCount | `uint32` | 4 | Total number of blocks available in the Free List. |
| RootOffset | `uint32` | 4 | Byte offset to the root of the B-Tree directory node. |
| ... | | | |

### Database Types (DataSet)
- **Portal (1)**: `client_portal.dat`. Main asset database (models, sounds).
- **Cell (2)**: `client_cell_1.dat`. Landscape and cell database.
- **Language (3)**: `client_local_English.dat`. Localized strings and fonts.

## Sector Chaining & Free List

### Data Sectors
The DAT is divided into fixed-size **sectors** (blocks). Every sector begins with a 4-byte **Next Pointer**.

- **Next Pointer (4 bytes)**: 
  - If `> 0`: Absolute byte offset to the next sector in the file.
  - If `== 0`: Indicates this is the final sector for the current file.
- **Payload**: The remaining `BlockSize - 4` bytes.

### Free List
When a file is deleted or updated with a smaller version, the orphaned sectors are added to the **Free List**.
- `FreeHead` points to a sector that uses its **Next Pointer** to form a linked list of all empty blocks.
- New file writes prioritize consuming these blocks before appending to the end of the DAT.

## B-Tree Directory Structure

The directory is a B-Tree where every node is exactly **1716 bytes**.

### Node Layout
1. **Branches (`uint32[62]`)**: Byte offsets to child nodes in the tree.
2. **EntryCount (`uint32`)**: The number of actual file entries stored in *this* node.
3. **Entries (`DatFileEntry[61]`)**: The file metadata records.

### DatFileEntry (24 bytes)
| Field | Type | Description |
| :--- | :--- | :--- |
| BitFlags | `uint32` | Metadata flags (see below). |
| ID | `uint32` | The unique Object ID. |
| Offset | `uint32` | Byte offset to the first sector of data. |
| Size | `uint32` | Total uncompressed size of the file data. |
| Timestamp | `uint32` | Unix timestamp of when the entry was written. |
| Version | `uint32` | Incremental version number for the entry. |

### BitFlags
- **`0x00000001` (Compression)**: Data is compressed (usually LZSS or a Zlib variant).
- **`0x00020000`**: Seen in `LandblockInfo` (LBI) files; usage related to cache/persistence.

## File ID Categorization

File IDs (Object IDs) determine both the type of data and which DAT file it resides in.

### 1. Portal DAT (`client_portal.dat`)
Generally categorized by the **Most Significant Byte (Prefix)**.

| Prefix | Type | Extension | Note |
| :--- | :--- | :--- | :--- |
| `0x01` | GraphicsObject | `.obj` | 3D models and geometry. |
| `0x02` | SetupModel | `.set` | Composition of models/anims. |
| `0x03` | Animation | `.anm` | Bone/vertex animations. |
| `0x04` | Palette | `.pal` | 8-bit color maps. |
| `0x05` | SurfaceTexture | `.texture` | Texture descriptors. |
| `0x06-07` | Texture | `.jpg` / `.dds` | Raw compressed image data. |
| `0x08` | Surface | `.surface` | Material/shader properties. |
| `0x0A` | Audio | `.wav` | PCM or compressed audio. |
| `0x0E` | Meta/Tables | | Weenie templates, game rules. |

#### Texture (0x06) Header (6-DWORDs)
Raw textures have a specialized header *before* the image data:
1. `id`: `uint32`
2. `unknown`: `uint32`
3. `width`: `uint32`
4. `height`: `uint32`
5. `format`: `uint32` (D3DFMT_A8, D3DFMT_DXT1, etc.)
6. `length`: `uint32` (Size of the following image payload)

### 2. Cell DAT (`client_cell_1.dat`)
Categorized by the **Lower 16-bits (Suffix)**. The top 16-bits are the `XXYY` landblock coordinate.

| Suffix | Type | Description |
| :--- | :--- | :--- |
| `0xFFFF` | Landblock | Terrain type and height vertices. |
| `0xFFFE` | LandblockInfo | Static object stabs and building data. |
| `0x0001` - `0xFFFD` | Indoor Cell | Environmental cells for dungeons. |

### 3. Local DATs (`client_local_English.dat`)
- `0x31`: Localized Strings (Windows-1252).
- `0x40`: Font definitions.
