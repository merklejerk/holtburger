# Asheron's Call BSP Tree format

Binary Space Partitioning (BSP) trees are the core of the Asheron's Call physics and rendering systems. They are found inside `GfxObj` (0x01) records in the `portal.dat` and `EnvCell` records in the `cell.dat`.

## 1. Node Identification (Tags)

Every node in the tree begins with a 4-byte ASCII tag. These tags are stored in **Little Endian** format on disk (e.g., "BPnn" is read as `nnPB`).

| Tag | Name | Type | Child Nodes |
| :--- | :--- | :--- | :--- |
| `PORT` | Portal | Portal Node | Positive & Negative |
| `LEAF` | Leaf | Leaf Node | None (Terminal) |
| `BPnn` | Internal | Splitting Node | Positive Only |
| `BPIn` | Internal | Splitting Node | Positive Only |
| `BpIN` | Internal | Splitting Node | Negative Only |
| `BpnN` | Internal | Splitting Node | Negative Only |
| `BPIN` | Internal | Splitting Node | Positive & Negative |
| `BPnN` | Internal | Splitting Node | Positive & Negative |

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
