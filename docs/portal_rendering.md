# Asheron's Call Portal Rendering Notes

This document records current findings about Asheron's Call environment-cell
portal polygons, especially the case where an interior door-frame cell appears
to render a solid wall over an outdoor transition opening in `holtburger-3d`.

The goal is to distinguish two possible causes:

1. The artifact is expected until the renderer implements retail-style portal
   view clipping, depth pre-passes, or masking.
2. The artifact is caused by treating portal or side-suppressed polygons as
   ordinary renderable mesh geometry.

The evidence below points to both mechanisms existing in retail, but the
specific door-frame artifact is strongly associated with polygons that are
explicitly marked as portal polygons and `NoPos`.

## Source References

Primary references:

- Retail client decompile: `acclient-eor-source/acclient.c`
- Retail client type declarations: `acclient-eor-source/acclient.h`
- ACE DAT loader: `ACViewer/ACE/Source/ACE.DatLoader`
- ACViewer render experiments: `ACViewer/ACViewer/Render`
- Holtburger DAT parser: `crates/holtburger-dat`
- Holtburger 3D asset prep and renderer: `apps/holtburger-3d/src`

Important source locations:

- Retail portal draw mode enum:
  `acclient-eor-source/acclient.h:4673`
- Retail `RenderDeviceD3D::DrawEnvCell`:
  `acclient-eor-source/acclient.c:436422`
- Retail `PView::DrawCells` outside-transition portal handling:
  `acclient-eor-source/acclient.c:441068`
- Retail building portal rendering through drawing BSP portals:
  `acclient-eor-source/acclient.c:436525`,
  `acclient-eor-source/acclient.c:345781`,
  `acclient-eor-source/acclient.c:349182`
- Retail `D3DPolyRender::DrawPortalPolyInternal`:
  `acclient-eor-source/acclient.c:433532`
- Retail polygon drawing and side/surface setup:
  `acclient-eor-source/acclient.c:434863`,
  `acclient-eor-source/acclient.c:434920`
- ACE polygon unpacking and stippling bits:
  `ACViewer/ACE/Source/ACE.DatLoader/Entity/Polygon.cs`
- ACE `StipplingType` enum:
  `ACViewer/ACE/Source/ACE.Entity/Enum/StipplingType.cs`
- ACViewer env-cell render workaround:
  `ACViewer/ACViewer/Render/R_CellStruct.cs:124`
- Holtburger environment geometry preparation:
  `apps/holtburger-3d/src/workers/asset-worker.ts`
- Holtburger host serialization of environment cell structures:
  `apps/holtburger-3d/src-tauri/src/adapter.rs:1577`
- Holtburger `EnvCell` portal parsing:
  `crates/holtburger-dat/src/file_type/env_cell.rs`
- Holtburger `Environment` / `CellStruct` parsing:
  `crates/holtburger-dat/src/file_type/environment.rs`

## Terminology

The word "portal" is overloaded:

- **World magic portal**: the visible purple travel effect. Not discussed here.
- **Building portal**: a portal record in outdoor landblock building metadata,
  representing an aperture such as a door or window.
- **Env-cell portal**: a portal record in an indoor `EnvCell`, connecting one
  env cell to another or to the outside.
- **Drawing BSP portal**: a `PORT` node in a drawing BSP with `PortalPoly`
  records used by the renderer to traverse or draw portal apertures.
- **Portal polygon**: a polygon used as a portal aperture or transition plane.
  It may also live in the general polygon table.

## Exact Door-Frame Fixture

The screenshots that motivated this investigation selected two portal records
around the same doorway:

- Interior-side portal: `env-cell/da550177/portal/00`
- Exterior/outside-transition portal: `env-cell/da550178/portal/01`

The raw records were exported from `dats/assets.hba`:

```text
cargo run -p holtburger-tools --bin dat-tool -- export dats/assets.hba da550177 --namespace eor/cell --output /tmp/da550177.bin
cargo run -p holtburger-tools --bin dat-tool -- export dats/assets.hba da550178 --namespace eor/cell --output /tmp/da550178.bin
cargo run -p holtburger-tools --bin dat-tool -- export dats/assets.hba 0d000364 --namespace eor/portal --output /tmp/0d000364.bin
```

Decoded env-cell metadata:

```text
EnvCell 0xda550177
  environment: 0x0d000364
  cell structure: 0
  portals:
    portal 00: flags=0x0003, polygon=34, other_cell=0x0178, other_portal=0x0000
    portal 01: flags=0x0001, polygon=36, other_cell=0x017e, other_portal=0x0001
    portal 02: flags=0x0001, polygon=37, other_cell=0x017d, other_portal=0x0002
    portal 03: flags=0x0001, polygon=35, other_cell=0x017b, other_portal=0x0001
    portal 04: flags=0x0001, polygon=33, other_cell=0x0179, other_portal=0x0000

EnvCell 0xda550178
  environment: 0x0d000364
  cell structure: 1
  portals:
    portal 00: flags=0x0001, polygon=7, other_cell=0x0177, other_portal=0x0000
    portal 01: flags=0x0007, polygon=6, other_cell=0xffff, other_portal=0xffff
```

The second portal in `0xda550178` is an outside transition. Holtburger already
documents this retail behavior in `adapter.rs`: flag `0x4` causes retail
`CCellPortal::UnPack` to treat the target as outside by setting
`other_cell_id` to `-1`.

Decoded `Environment 0x0d000364` cell-structure data for the relevant
polygons:

```text
CellStruct 0
  portal polygon ids: [34, 36, 37, 35, 33]
  polygon 33: stippling=0x04, sides=0, pos_surface=9, neg_surface=-1
  polygon 34: stippling=0x04, sides=0, pos_surface=9, neg_surface=-1
  polygon 35: stippling=0x04, sides=0, pos_surface=9, neg_surface=-1
  polygon 36: stippling=0x04, sides=0, pos_surface=9, neg_surface=-1
  polygon 37: stippling=0x04, sides=0, pos_surface=9, neg_surface=-1

CellStruct 1
  portal polygon ids: [7, 6]
  polygon 6: stippling=0x04, sides=0, pos_surface=10, neg_surface=-1
  polygon 7: stippling=0x04, sides=0, pos_surface=9, neg_surface=-1
```

ACE defines `stippling=0x04` as `StipplingType.NoPos`.

This is a strong data signal: the door-frame face is not an ordinary wall
polygon. It is a portal polygon and its positive side is suppressed.

## Retail Render Flow

Retail does not have a single "draw all triangles" path for this case.

### Env Cells

`RenderDeviceD3D::DrawEnvCell` enqueues every polygon in the selected
`CCellStruct` when the env cell is not using a built mesh:

```text
RenderDeviceD3D::DrawEnvCell
  for each structure->polygon:
    push polygon into Render::PolyList
  finish/render PolyList
```

This initially looks like evidence that portal polygons are rendered as normal
geometry. However, the subsequent polygon draw path is surface/side/stippling
aware. `D3DPolyRender::DrawPolyInternal` selects the positive surface and
positive UV indices for its default draw path, and helper code such as
`D3DPolyRender::SetSurface(CPolygon*, Sidedness, ...)` switches between
positive and negative side data. The engine therefore does not merely consume a
flat triangle soup.

Holtburger's current asset worker is much simpler: it triangulates each polygon
using the positive side (`posSurface`, `posUvIndices`) unless the polygon is
filtered before geometry construction. That simplification is important for
`NoPos` polygons.

### Outside-Transition Env-Cell Portals

Retail `PView::DrawCells` has an explicit pass for env-cell portals whose
`other_cell_id == -1`:

```text
if (portals[i].other_cell_id == -1)
    D3DPolyRender::DrawPortalPolyInternal(portals[i].portal, false);
```

This happens before the normal env-cell draw pass in the same function. It
indicates that outside-transition portal polygons are used explicitly as portal
apertures or masks, not just as ordinary wall polygons.

### Building Portals

Retail building drawing also has special portal handling. When drawing a
building mesh, `RenderDeviceD3D::DrawMeshInternal` calls:

```text
BSPTREE::build_draw_portals_only(i_pObj->drawing_bsp, 1);
BSPTREE::build_draw_portals_only(i_pObj->drawing_bsp, 2);
```

`BSPTREE::build_draw_portals_only` traverses drawing BSP `PORT` nodes and calls
`BSPPORTAL::portal_draw_portals_only`, which eventually invokes
`RenderDeviceD3D::DrawPortal` for `PortalPoly` records.

The named modes in `BSPPortalDrawType` are:

```text
DRAW_BOTH = 0
DRAW_BLANK_PORTALS = 1
DRAW_VIEW_THROUGH_PORTALS = 2
DRAW_PORTALS_TO_OUTSIDE = 3
```

This confirms that portal polygons participate in render ordering, clipping,
and depth/color behavior beyond ordinary mesh drawing.

### Portal Polygon Internal Draw

`D3DPolyRender::DrawPortalPolyInternal`:

- Transforms and clips the portal polygon.
- Disables texture stage usage for the draw.
- Uses `DEPTHTEST_ALWAYS`.
- Uses a mode-dependent flag set (`dword_821E24 = 6`, `dword_821E28 = 7`).
- Can force depth values for a z-clear mode.
- Draws a triangle fan.

This looks like a portal mask/depth operation rather than normal material
rendering.

## ACE / ACViewer Evidence

ACE's DAT loader exposes the relevant polygon flags:

```csharp
public enum StipplingType
{
    None = 0x0,
    Positive = 0x1,
    Negative = 0x2,
    Both = 0x3,
    NoPos = 0x4,
    NoNeg = 0x8,
    NoUVS = 0x14
}
```

`Polygon.Unpack` only reads positive UV indices when `NoPos` is not set:

```csharp
if (!Stippling.HasFlag(StipplingType.NoPos))
    read PosUVIndices
```

ACViewer's env-cell renderer contains a direct skip:

```csharp
if (polygon._polygon.Stippling == ACE.Entity.Enum.StipplingType.NoPos) continue;
```

The comment calls this a workaround for env cells / possibly buildings, but it
matches the door-frame fixture exactly: the problematic portal polygons are
`NoPos`.

## Holtburger Current Behavior

`holtburger-3d` prepares environment geometry in the web worker:

```text
prepareEnvironment
  for each cellStructure:
    buildPolygonSetRenderGeometry(
      vertexArray,
      drawingPolygons,
      excludedPolygonIds: cellStructure.portalPolygonIds
    )
```

`buildPolygonSetRenderGeometry` currently emits triangles from the positive
side of each polygon that is not explicitly excluded. Before the portal-filter
change, this meant portal polygons were included as normal mesh geometry.

The current confirmed filter excludes `CellStruct.portalPolygonIds` from
prepared environment render geometry. For the exact door-frame fixture,
polygon `6` and polygon `34` are both in `CellStruct.portalPolygonIds`, so a
freshly prepared asset should not include those polygons in `renderGeometry`.

If the face still appears after that change, likely explanations include:

- The running app or asset worker is using stale prepared/cached geometry.
- The visible face is coming from another geometry path, such as a building
  `GfxObj` or a duplicated polygon not in the selected cell structure's portal
  list.
- The filter has not been applied to all relevant prepared assets.
- Another side of a two-sided polygon is being rendered incorrectly.

## Findings

These findings are supported by the decoded data and retail/ACE references:

1. The door-frame polygons under discussion are portal polygons, not ordinary
   wall polygons.
2. The exact problematic polygons are marked `NoPos`.
3. Retail has explicit portal drawing modes and portal polygon draw passes.
4. Retail env-cell drawing is not equivalent to our current positive-side
   triangle-soup conversion.
5. ACViewer skips `NoPos` polygons for env-cell rendering.
6. Holtburger must eventually model polygon side semantics (`NoPos`, `NoNeg`,
   `sidesType`, positive/negative surfaces and UVs), not only polygon IDs.

## Working Interpretation

The artifact is not purely caused by missing stencil/masking. Retail does use
portal-specific view/depth behavior, but the specific door-frame wall is also
geometry that the data marks as portal/no-positive-side.

The most likely root issue in the simplified renderer is that it treats a
portal `NoPos` polygon as an ordinary positive-side render polygon. That is
not faithful to retail side semantics.

The correct long-term renderer should:

- Preserve portal polygons as aperture metadata.
- Use portal polygons for visibility traversal, clipping, and depth/mask
  passes.
- Render ordinary polygon sides according to `stippling` and `sidesType`.
- Avoid converting absent polygon sides into visible mesh triangles.

## Open Questions

The following questions still need proof before a final implementation:

1. Should all `NoPos` env-cell polygons be omitted from the positive render
   mesh, or are there cases where retail draws them through a negative-side
   pass?
2. Should `NoNeg` be handled symmetrically when rendering the negative side of
   two-sided geometry?
3. Are building `GfxObj` drawing BSP `PortalPoly` records always non-renderable
   apertures, or only in the building portal render path?
4. Does retail's built-mesh path pre-strip `NoPos` or portal polygons, or does
   it encode side/mask behavior into the built mesh?
5. Does `holtburger-3d` currently cache prepared assets in a way that can make
   geometry filtering changes appear stale until the worker/app restarts?

## Recommended Next Investigation

Before making another behavioral change, inspect the actual prepared geometry
for `environment/0d000364` in the running browser app:

- Confirm whether `CellStruct 1` `renderGeometry.triangles` contains polygon
  `6` or `7`.
- Confirm whether `CellStruct 0` `renderGeometry.triangles` contains polygon
  `34`.
- Confirm whether the visible wall is part of a structured interior mesh or a
  static building `GfxObj` mesh.
- Confirm the selected mesh object's `spatialItemId` and source asset ID when
  clicking the face.

If the prepared environment geometry still contains polygon `6` or `34`, then
the current portal-polygon exclusion is incomplete or stale. If it does not,
then the artifact is coming from another geometry source or from missing
portal/depth behavior.

