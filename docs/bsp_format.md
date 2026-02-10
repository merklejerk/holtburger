# Asheron's Call BSP Tree format

Binary Space Partitioning (BSP) trees are the core of the Asheron's Call physics and rendering systems. They are found inside `GfxObj` (0x01) records in the `portal.dat` and `EnvCell` records in the `cell.dat`.

## 1. Node Identification (Tags)

Every node in the tree begins with a 4-byte ASCII tag. These tags are stored in **Little Endian** format on disk. When read as a 4-byte string, the order must be reversed to match logical tags.

| Tag (Logical) | Name | Type | Disk Order (Hex) | Child Nodes |
| :--- | :--- | :--- | :--- | :--- |
| `PORT` | Portal | Portal Node | `54 52 4F 50` (`TROP`) | Positive & Negative |
| `LEAF` | Leaf | Leaf Node | `46 41 45 4C` (`FAEL`) | None (Terminal) |
| `BPnn` | Internal | Splitting Node | `6E 6E 50 42` (`nnPB`) | Positive Only |
| `BPIn` | Internal | Splitting Node | `6E 49 50 42` (`nIPB`) | Positive Only |
| `BpIN` | Internal | Splitting Node | `4E 49 70 42` (`NIPb`) | Negative Only |
| `BpnN` | Internal | Splitting Node | `4E 6E 70 42` (`NnPb`) | Negative Only |
| `BPIN` | Internal | Splitting Node | `4E 49 50 42` (`NIPB`) | Positive & Negative |
| `BPnN` | Internal | Splitting Node | `4E 6E 50 42` (`NnPB`) | Positive & Negative |

### Tag Flags (The "BPxx" Logic)
The two characters following "BP" indicate the presence of child nodes:
- `I` / `P`: "In" or "Positive" child exists.
- `N`: "Negative" child exists.
- `n`: Indicates the child is a **Leaf** or null (structure varies by tag version).

> **Note**: In practice, the engine uses these flags to determine recursion. For example, `BPIN` implies the reader must recursively call `ReadNode` twice.

## 2. Shared Structures

### Plane (16 bytes)
| Type | Name | Description |
| :--- | :--- | :--- |
| `float` | `NX` | Normal X |
| `float` | `NY` | Normal Y |
| `float` | `NZ` | Normal Z |
| `float` | `D` | Distance from origin |

### Sphere (16 bytes)
| Type | Name | Description |
| :--- | :--- | :--- |
| `float` | `CX` | Center X |
| `float` | `CY` | Center Y |
| `float` | `CZ` | Center Z |
| `float` | `R` | Radius |

## 3. Tree Types

Parsing logic varies slightly depending on the "Type" of tree being read:
- **Drawing**: Used for rendering sorting and visibility.
- **Physics**: Used for collision detection (found in `GfxObj`).
- **Cell**: Used for environmental navigation (found in `cell.dat`).

## 4. Node Detail Structures

### Internal Nodes (`BPxx`)
1. **Tag** (4 bytes)
2. **Splitting Plane** (16 bytes)
3. **Child Nodes**:
   - If tag has `Pos` flag (BPnn, BPIn, BPIN, BPnN): Recursively read `BspNode`.
   - If tag has `Neg` flag (BpIN, BpnN, BPIN, BPnN): Recursively read `BspNode`.
4. **Metadata** (Type dependent):
   - **Cell**: None.
   - **Physics**: `Sphere` followed by `uint32` poly count and `uint16[]` poly IDs.
   - **Drawing**: `Sphere`.

### Portal Nodes (`PORT`)
1. **Tag** (4 bytes)
2. **Splitting Plane** (16 bytes)
3. **Positive Child**: Recursively read `BspNode`.
4. **Negative Child**: Recursively read `BspNode`.
5. **Metadata** (Drawing ONLY):
   - `Sphere`.
   - `uint32` poly count + `uint16[]` poly IDs.
   - `uint32` portal count + `PortalPoly[]` records.

### Leaf Nodes (`LEAF`)
1. **Tag** (4 bytes)
2. **Leaf Index** (`int32`)
3. **Metadata** (Physics ONLY):
   - `int32` solid flag (1 = Solid, 0 = Non-solid).
   - `Sphere`.
   - `uint32` poly count + `uint16[]` poly IDs.

## 5. Usage in Physics

When a sphere (player) moves through the world:
1. The engine calculates the distance $dist = (P \cdot N) + D$ from the sphere center to the current node's Splitting Plane.
2. If $dist > radius$, only the **Positive** branch is traversed.
3. If $dist < -radius$, only the **Negative** branch is traversed.
4. If $|dist| \leq radius$, **both** branches are traversed (intersection).
5. Upon reaching a **Leaf**, if the `solid` flag is set, a collision is registered, and the player's vector is reflected or stopped by the polygons in that leaf.
