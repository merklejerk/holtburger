# Holtburger 3D Granular Scene Asset Strategy Plan

Status: proposed implementation plan.

## Context

The current 3D asset pipeline uses `landblock-summary/<id>` for cheap coverage
and `landblock-pack/<id>` for focused scene loading. That split helped reduce
far-ring load, but `landblock-pack` has grown into a mixed payload:

- landblock-scoped coverage and placement facts;
- terrain render geometry;
- structured interior cell render geometry;
- static instance expansion;
- static mesh expansion;
- an outdoor static BVH;
- dependency hints for setup/gfx renderables.

The material failure exposed a structural problem in that shape. Interior cell
geometry embedded inside `landblock-pack.prepared.interiorCells[].renderGeometry`
uses real `CSurface` material IDs, but those material assets are not owned by the
pack and are not naturally discovered through a first-class `env-cell` asset.
The frontend planner is therefore forced to rediscover dependencies by scanning
nested landblock payloads. That is brittle and makes it hard to prove whether a
missing material is a host/material-graph bug, a planner bug, or a renderer cache
bug.

The fix should not make the renderer more tolerant of missing materials. Missing
prepared material recipes for visible geometry should fail loudly with enough
diagnostics to identify the broken ownership edge.

Material and terrain-material semantics in this plan should be guided by
[`holtburger-3d-materials-texturing-strategy.md`](holtburger-3d-materials-texturing-strategy.md).
That document is the evidence source for the `CSurface` graph,
LandSurf/TexMerge `pcode` handling, ACViewer-style terrain blending, and the
current limits around default setup appearance. If the two plans conflict, treat
the material strategy as the reference data source and update this plan's route
ownership or planner steps to match it.

## Goals

- Reduce overlap between outdoor coverage data and focused landblock scene data.
- Replace monolithic `landblock-pack/*` dependency ownership with granular,
  source-shaped assets.
- Make each renderable asset either declare the next assets it requires or expose
  an explicit source key for a route helper, such as terrain pcodes.
- Keep frontend planning in charge of which assets to request, based on residency,
  cache state, visibility, and rendering needs.
- Keep Rust responsible for decoding DAT source records and resolving material
  graphs from `CSurface` or terrain LandSurf/TexMerge inputs through
  `RenderTexture`, `RenderSurface`, and `Palette`.
- Keep the Tauri adapter narrow: parse asset routes, call app-local content
  loaders, and serialize typed projections.
- Fail hard when visible geometry references an unprepared material or when an
  asset response omits required dependency metadata.
- Use REST-like route names for new asset IDs so ownership is readable from the
  path.

## Non-Goals

- Do not make `landblock-pack` include every transitive asset dependency.
- Do not add compatibility shims for every old route indefinitely.
- Do not move browser-mode streaming policy into Rust.
- Do not redesign terrain rendering, material shader behavior, clothing, or
  object appearance beyond dependency ownership.
- Do not split `env-cell` into multiple routes until a measured consumer needs
  different lifetimes for topology and render geometry.
- Do not turn debug logging into tests. Test contracts and planner behavior
  instead.

## Current Prepared Payload Ownership

The current `landblock-pack.prepared` fields are not all the same kind of thing.

Fields that are source-backed or point at real assets:

- `prepared.interiorCells[]`: derived from real env-cell/cell-structure data.
  Each cell carries `envCellId`, `environmentId`, `cellStructureId`, portals,
  `surfaceIds`, BSP data, and render geometry. This should become an addressable
  `env-cell/{id}` asset.
- `prepared.staticMeshes[]`: instance expansion that points to real
  `gfx-obj/{did}` assets through `gfxObjAssetId`. The mesh itself is placement
  and expansion data, not a DAT asset.
- `prepared.outdoorStaticInstances[]`: placement/source facts that point at
  `gfx-obj/*` or `setup-model/*` through `sourceAssetId`.
- `sourceFacts.buildings[]`: source facts for building/setup placement and
  portal linkage. These are scene membership facts, not render payloads.

Fields that are derived indexes or render products:

- `prepared.terrainMesh`: derived terrain render geometry for the landblock.
- `prepared.spatialItems`: derived scene spatial index items.
- `prepared.staticLandblockBvh`: derived landblock-scoped static BVH.
- `portalApertures`, `cellBsp`, and `renderGeometry` inside interior cells:
  derived projections from env-cell/cell-structure records.

The target design should make these distinctions explicit in route names and
dependencies instead of hiding them under `landblock-pack.prepared`.

## Target Asset Routes

Use granular, REST-like asset IDs:

| Route | Purpose | Dependencies |
|---|---|---|
| `landblock/{id}/terrain` | Outdoor coverage render geometry: terrain, source terrain corner codes, computed terrain pcodes, terrain-only BVH, and building shell render geometry. | Terrain material assets derived by the frontend from `regionNumber` plus quad pcodes, plus building render material dependencies. |
| `landblock/{id}/scene` | Focused scene membership: typed statics/buildings with placements, env-cell membership, portal/link graph, an env-cell residency BVH, and outdoor render BVH when outdoor-space members exist. | Derived from typed member fields: static/building `sourceAssetId` and env-cell `assetId`. |
| `env-cell/{id}` | One structured interior cell with topology, portals, BSP witnesses, render geometry, and material slots. | `material/{did}` for every referenced `CSurface`. |
| `gfx-obj/{did}` | One GfxObj render/physics projection. | `material/{did}` for every referenced `CSurface`. |
| `setup-model/{did}` | Setup parts, placements, lights, and default part composition. | `gfx-obj/{did}` for each part. |
| `terrain-material/{regionNumber}/{pcode}` | One generated LandSurf/TexMerge terrain material recipe. | Terrain base, overlay, alpha, road, and detail texture dependencies as required. |
| `material/{did}` | One `CSurface` material recipe. | `render-texture/{did}`, `render-surface/{did}`, and `palette/{did}` as required. |
| `render-texture/{did}` | One `RenderTexture` mip chain descriptor. | `render-surface/{did}`. |
| `render-surface/{did}` | One image payload. | `palette/{did}` for indexed/default-palette surfaces. |
| `palette/{did}` | One palette payload. | None. |

### Route Notes

- `landblock/{id}/terrain` should answer "what outdoor terrain can this
  landblock contribute, and which building shells should be drawn with that
  outdoor coverage?" It carries terrain render geometry, terrain pcodes, a
  terrain-only BVH, and building shell render geometry. It should not carry
  focused statics, env-cell membership, portals, material dependency tables, or
  interior graph data.
- `landblock/{id}/scene` should answer "what focused scene members exist here,
  where are they placed, and which first-class source assets back each member?"
  It should not carry a parallel top-level `renderableAssetIds` shortcut or every
  transitive material/texture dependency.
- `env-cell/{id}` should be the owner of structured interior render geometry and
  its direct material dependencies.
- `gfx-obj/{did}` should remain the owner of object render geometry and its
  direct material dependencies.
- `material/{did}` remains the frontend-visible boundary for the Rust material
  graph.

`setup-model/{did}` is a source-backed setup DAT projection. There is no
separate default `setup-appearance/*` asset in the target plan. The renderer can
compose default setup rendering from `setup-model.parts[]` and the corresponding
`gfx-obj/*` material slots. Do not add an object appearance route until measured
reuse, cache pressure, or duplicated ObjDesc override logic proves that the
renderer-side composition is the wrong boundary.

## Material Graph Changes

The material graph remains a Rust/content responsibility. This plan changes the
public ownership boundaries around the graph; it does not move material graph
resolution into the frontend.

Target material graph responsibilities:

- `material/{did}` calls the material graph with a concrete `CSurface` DataID and
  returns one material recipe plus direct `render-texture/*`,
  `render-surface/*`, and `palette/*` route inputs.
- `gfx-obj/{did}` reads the source `GfxObj`, exposes its polygon/material slots,
  and uses material graph slot resolution only to validate and name the immediate
  `material/{did}` dependencies. It should not inline full material recipes into
  the gfx response.
- `env-cell/{id}` reads the source `EnvCell.surfaces[]`, converts each 16-bit
  surface slot entry into a full `0x08...` `CSurface` DataID, and exposes
  `surfaces[].materialAssetId`. It should not inline full material recipes into
  the env-cell response.
- `terrain-material/{regionNumber}/{pcode}` adds a material graph entry
  point for terrain LandSurf/TexMerge resolution. It should resolve the active
  `RegionDesc` terrain tables plus the source pcode into one generated terrain
  material recipe and direct base/overlay/alpha/road/detail texture
  dependencies.
- `setup-model/{did}` is no longer a material graph appearance route for the
  default case. It exposes setup parts and lets the frontend compose those parts
  with `gfx-obj/*` assets and their material slots.

Current `resolve_setup_appearance(setupModelId, MaterialAppearanceInput)` should
not remain on the default setup-model path. Keep or rename it only for future
ObjDesc override work after a measured consumer needs an appearance-level cache
boundary. Until then, default setup rendering follows:

1. request `setup-model/{did}`;
2. request each `setup-model.parts[].gfxObjAssetId`;
3. request each `gfx-obj/{did}` material dependency;
4. request each `material/{did}` dependency chain.

The graph should expose narrow route-facing entry points rather than broad
transitive pack helpers:

- `resolve_material_recipe(surfaceId)` for `material/{did}`;
- `resolve_gfx_obj_material_slots(gfxObjId)` or equivalent slot extraction for
  `gfx-obj/{did}`;
- `resolve_env_cell_material_slots(envCellId)` or equivalent slot extraction for
  `env-cell/{id}`;
- `resolve_terrain_material_recipe(regionNumber, pcode)` for
  `terrain-material/{regionNumber}/{pcode}`;
- optional appearance override resolution only for a future explicit
  appearance route, not for default setup-model loading.

Material graph failures are asset contract failures. The host route should
return a failed asset response and log the requested route plus source error
chain to stderr; the frontend should not paper over graph failures by silently
substituting fallback materials.

## Binary Payload Strategy

Large geometry and image byte arrays should use the existing binary asset
envelope pattern during this migration. The route split should not regress to
JSON-expanded vertex, triangle, UV, normal, aperture-point, spatial-bounds, or
render-surface byte arrays.

The current host already has this precedent:

- `prepared.terrainMesh.vertices` and `prepared.terrainMesh.triangles` are binary
  sections;
- interior `renderGeometry.positions`, `normals`, `uvs`, and `triangles` are
  binary sections;
- portal aperture point arrays are binary sections;
- spatial item bounds are binary sections;
- `renderSurface.sourceBytes` is a binary section.

The new route families should preserve that approach:

- `landblock/{id}/terrain` should use binary sections for terrain vertices,
  terrain triangle/index data, terrain BVH bounds/items when large, and building
  shell `renderGeometry` arrays.
- `landblock/{id}/scene` should keep member/source facts in JSON, but encode BVH
  bounds/items as binary sections if they become large.
- `env-cell/{id}` should use binary sections for `renderGeometry`,
  `portalApertures[].points`, and `localBvh` arrays when large.
- `gfx-obj/{did}` should continue to avoid JSON-expanded render geometry arrays
  where the binary lookup path is available.
- `render-surface/{did}` should continue to carry source image bytes through the
  binary envelope.

Binary sections are a transport/detail choice inside a route response, not a new
asset ownership boundary. Do not split `env-cell/{id}/render` or
`landblock/{id}/terrain-geometry` only because an array is large; use binary
sections first. Create a separate route only when the data has a different
consumer lifetime, invalidation policy, or cache-retention policy.

## Landblock Terrain Shape

`landblock/{id}/terrain` should be the outdoor coverage render asset for one
landblock. It should carry terrain plus building shell render geometry. It
should not carry focused outdoor statics, indoor env-cell membership, portal
graphs, restriction records, or general static-object placements.

Focused landblock loading must still request `landblock/{id}/scene` for outdoor
statics, env cells, portals, interiors, scene BVHs, and exact scene membership.
The scene BVHs are confirmed terrain-free under this split.

Recommended shape:

```ts
interface PreparedLandblockTerrainPayload {
    kind: "landblock-terrain";
    landblockId: LandblockId;
    regionId: DataId; // RegionDesc file ID, currently 0x13000000.
    regionNumber: number;
    terrain: LandblockTerrain;
    buildingShells: LandblockTerrainBuildingShell[];
    diagnostics: PreparedLandblockDiagnostics;
}

interface LandblockTerrain {
    gridSize: number;
    tileSize: number;
    vertices: Vec3Dto[];
    triangles: PreparedTerrainTriangle[];
    quads: PreparedTerrainQuad[];
    terrainBvh: PreparedTerrainBvh;
    minHeight: number;
    maxHeight: number;
    bounds: PreparedBounds | null;
}

interface PreparedTerrainBvh {
    coordinateSpace: "landblock-terrain-local";
    nodes: PreparedBvhNode[];
    items: PreparedTerrainBvhItem[];
}

interface PreparedTerrainBvhItem {
    row: number;
    col: number;
    quadIndex: number;
    triangleIndices: [number, number];
}

interface LandblockTerrainBuildingShell {
    instanceId: string;
    sourceDid: DataId;
    sourceIndex: number;
    localPlacement: PlacementTransformDto;
    renderGeometry: PreparedPolygonSetRenderGeometry;
    materialSurfaceIds: DataId[];
}
```

`landblock/{id}/terrain` is the authoritative terrain payload for the landblock,
including source terrain corner codes, computed terrain pcodes, the terrain-only
BVH, and building shell render geometry. Building shells in this route are
render-only coverage data: no
portals, no env-cell links, no building traversal metadata, and no focused scene
membership semantics.

The source term `Stab` is overloaded in the references. `LandblockInfo.objects`
and `EnvCell.static_objects` contain `Stab` records that are static object
placements: source DID plus frame. `CBldPortal.StabList` contains 16-bit local
cell numbers used by building portals; those are normalized into full
`linkedEnvCellIds`.

## Outdoor BVH Decision

Keep one outdoor-space BVH with `landblock/{id}/scene` when the scene has
outdoor-space members. The BVH is not a source asset, but it belongs with the
scene asset as long as it is built and invalidated with the same outdoor
membership set. Split it later only if we need independent BVH paging, multiple
BVH variants, or a non-render consumer with a different lifetime.

For outdoor landblocks, the scene index should be a single typed BVH over
focused outdoor-space scene members:

- outdoor/static item IDs that reference `setup-model/*` or `gfx-obj/*`;
- focused building semantic/member items when needed for selection or debugging,
  not building shell render geometry;
- building portal/entrance anchor items when they are useful for selecting or
  traversing into interiors.

Do not put full env-cell bounds in the outdoor/static landblock BVH. Outdoor
landblock interiors can be non-Euclidean relative to outdoor landblock space, and
using their cell geometry as ordinary outdoor-space boxes can make culling,
selection, and residency decisions lie. `envCells[]` and `portalLinks[]` are the
source of truth for interior membership and traversal. `env-cell/{id}` may carry
its own local-space render/topology bounds for rendering and debugging after the
frontend has entered or selected that interior context.

The scene outdoor BVH should include only things with meaningful outdoor
landblock-space bounds that are owned by `landblock/{id}/scene`:

- explicit outdoor scenery instances from `LandblockInfo.objects`;
- generated outdoor scenery instances from scene/region data;
- focused building semantic/member bounds from `LandblockInfo.buildings`, when a
  focused scene consumer needs them;
- optional building portal or entrance anchor items, represented as small
  outdoor-space bounds around the building portal/entrance rather than the
  interior cell geometry itself.

It should exclude:

- terrain geometry, terrain source codes, and terrain culling structures, which
  belong to `landblock/{id}/terrain`;
- building shell render geometry, which belongs to `landblock/{id}/terrain`;
- full env-cell render-geometry bounds;
- env-cell BSP bounds;
- indoor static objects placed inside env cells;
- material, texture, surface, palette, setup, and gfx asset bounds unless they
  are attached to a placed outdoor source member.

For dungeon landblocks, do not fabricate an outdoor BVH, scene index, entrance
model, or root-cell model. A dungeon landblock is an isolated set of interior env
cells. The existing `envCells[]` and `portalLinks[]` fields are the scene graph
for dungeon traversal. The active starting cell comes from navigation state, not
from the landblock scene asset.

`outdoorBvh` should be present only when the scene has outdoor-space
members. For a valid outdoor scene with no outdoor spatial items, return an empty
BVH with `nodes: []`. Do not use missing BVH data to hide assembly failures; a
failed required outdoor BVH should fail the scene asset or appear in an explicit
error state.

## Env Cell Residency BVH Decision

`landblock/{id}/scene` should also provide a distinct env-cell residency BVH for
both outdoor and dungeon landblocks.

This is not a render BVH. It answers residency and traversal questions such as:

- which env cells are near a point or coarse focus volume;
- which env cells should be considered for prefetch or retention;
- which env cells are reachable/adjacent when combined with `portalLinks[]`;
- which env-cell payloads should be requested first when a browser focus enters
  an interior context.

The residency BVH should index env-cell membership records, not full env-cell
render geometry. Its bounds should come from coarse membership facts that are
safe in the landblock scene coordinate model:

- for outdoor landblocks, use the placed env-cell anchor/transition/portal
  relationship available from `LandblockInfo.buildings[].portals[]` and
  `linkedEnvCellIds`, not full transformed interior geometry;
- for dungeon landblocks, use env-cell local placements and coarse cell bounds
  only as a residency heuristic for the isolated dungeon coordinate context.

If exact env-cell geometry bounds are needed for rendering, picking, or debug,
use `env-cell/{id}.localBvh` after that env-cell asset is active.

## Landblock Scene Shape

`landblock/{id}/scene` should be a typed scene-member payload, not a manifest of
anonymous renderable IDs. Dependencies are extracted from the member records.

Sketch:

```ts
type AssetId = string;
type LandblockSceneMemberId = string;
type DataId = number;
type LandblockId = number;
type EnvCellId = number;
type EnvironmentId = number;
type CellStructureId = number;
type PolygonId = number;
type PortalId = string;

interface Vec3Dto {
    x: number;
    y: number;
    z: number;
}

interface PlacementTransformDto {
    origin: Vec3Dto;
    orientation: {
        w: number;
        x: number;
        y: number;
        z: number;
    };
}

interface PreparedBounds {
    min: Vec3Dto;
    max: Vec3Dto;
}

interface PreparedBvhNode {
    bounds: PreparedBounds;
    left: number | null;
    right: number | null;
    itemIndices: number[];
    kindMask: number;
}

interface PreparedLandblockScenePayload {
    kind: "landblock-scene";
    landblockId: LandblockId;
    landblockInfoId: DataId;
    classification: "outdoor" | "dungeon";
    statics: LandblockSceneStaticMember[];
    buildings: LandblockSceneBuildingMember[];
    envCells: LandblockSceneEnvCellMember[];
    portalLinks: LandblockScenePortalLink[];
    envCellResidencyBvh: PreparedEnvCellResidencyBvh;
    outdoorBvh: PreparedOutdoorBvh | null;
    // Existing prepared diagnostic shape; not expanded in this plan.
    diagnostics: PreparedLandblockDiagnostics;
}

interface PreparedEnvCellResidencyBvh {
    coordinateSpace: "landblock-scene-residency";
    nodes: PreparedBvhNode[];
    items: PreparedEnvCellResidencyBvhItem[];
}

interface PreparedEnvCellResidencyBvhItem {
    envCellId: EnvCellId;
    memberId: LandblockSceneMemberId;
    assetId: AssetId; // env-cell/{id}
    source: "building-portal-link" | "env-cell-placement" | "derived";
}

interface PreparedOutdoorBvh {
    coordinateSpace: "landblock-render-local";
    nodes: PreparedBvhNode[];
    items: PreparedOutdoorBvhItem[];
}

type PreparedOutdoorBvhItem =
    | {
          kind: "static";
          instanceId: string;
      }
    | {
          kind: "building";
          instanceId: string;
      }
    | {
          kind: "building-portal-anchor";
          portalId: PortalId;
      };

interface LandblockScenePlacedSourceMemberBase {
    instanceId: string;
    memberId: LandblockSceneMemberId;
    sourceDid: DataId;
    sourceAssetId: AssetId; // setup-model/{did} or gfx-obj/{did}
    sourceIndex: number;
    localPlacement: PlacementTransformDto;
    sourceScale: Vec3Dto;
    sourceBounds: PreparedBounds | null;
    instanceBounds: PreparedBounds | null;
}

interface LandblockSceneStaticMember extends LandblockScenePlacedSourceMemberBase {
    kind: "scenery" | "generated-scenery";
}

interface LandblockSceneBuildingMember extends LandblockScenePlacedSourceMemberBase {
    kind: "building";
    // Source BuildInfo.NumLeaves. ACE/ACViewer use it to size BuildingObj.LeafCells;
    // keep the source value without assigning stronger semantics yet.
    numLeaves: number;
    portals: LandblockSceneBuildingPortal[];
}

interface LandblockSceneBuildingPortal {
    portalId: PortalId;
    sourceIndex: number;
    flags: number;
    otherCellId: number;
    otherPortalId: number;
    /** Raw CBldPortal.StabList entries: 16-bit local cell IDs, not full env-cell DataIDs. */
    stabLocalCellIds: number[];
    linkedEnvCellIds: EnvCellId[];
}

interface LandblockSceneEnvCellMember {
    memberId: LandblockSceneMemberId;
    envCellId: EnvCellId;
    assetId: AssetId; // env-cell/{id}
    localPlacement: PlacementTransformDto;
    visibleEnvCellIds: EnvCellId[];
    restrictionObjectId: DataId | null;
    seenOutside: boolean | null;
}

interface LandblockScenePortalLink {
    linkId: string;
    source:
        | {
              kind: "landblock-building";
              instanceId: string;
              portalId: PortalId;
          }
        | {
              kind: "env-cell";
              envCellId: EnvCellId;
              portalId: PortalId;
          };
    target:
        | {
              kind: "outside";
              landblockId: LandblockId;
          }
        | {
              kind: "env-cell";
              envCellId: EnvCellId;
          };
    flags: number;
    otherCellId: number;
    otherPortalId: number;
    polygonId: PolygonId | null;
    sourceIndex: number;
}
```

Dependency extraction for this route should walk those typed members:

- every `statics[].sourceAssetId`;
- every `buildings[].sourceAssetId`;
- every `envCells[].assetId`.

`portalLinks` are not renderable dependencies. They are normalized adjacency
facts used for portal traversal, interior residency, culling, and debugging.
Their source can come from two different DAT record families:

- `LandblockInfo.buildings[].portals[]`, which describes portals attached to a
  placed landblock building record and references interior cells through
  `stabList`.
- `EnvCell.portals[]`, which describes portals owned by an interior env cell and
  references another cell through `otherCellId`/`otherPortalId`.

They may reference an `env-cell/{id}` target, but dependency extraction should
still come from `envCells[]` so membership and graph hydration have one source of
truth.

That keeps placements and source facts visible while still letting the generic
asset graph scheduler enqueue follow-up assets.

Composed member types should avoid repeating ownership that is already provided
by containment. `landblock/{id}/scene` owns its static, building, and env-cell
membership records. `env-cell/{id}` owns its local static members and local BVH.
Keep IDs on child records only when they identify a source asset, a stable
member, or a cross-record link.

`statics` and `buildings` should describe placed source members only. They should
not embed setup part expansion or `gfx-obj` mesh buffers. Setup/model and gfx
expansion remains owned by `setup-model/*` and `gfx-obj/*`.

`envCells` should describe membership and placement only. It should not embed
cell render geometry, cell BSP, or material slots. Those belong to `env-cell/*`.

### Terrain Geometry Shape

`landblock/{id}/terrain.terrain` should own outdoor ground render geometry,
terrain quad metadata, and the terrain-only BVH for one outdoor landblock. The
route also carries `buildingShells[]`, but those shells are not included in
`terrain.terrainBvh`. Do not model terrain as a `landblock/{id}/scene` member.
There is no dungeon terrain. The planner should request this route only for
outdoor landblocks; dungeon rendering uses env-cell assets instead.

Shared terrain member shapes:

```ts
interface PreparedTerrainTriangle {
    terrainTriangleId: string;
    quadIndex: number;
    triangleInQuad: 0 | 1;
    vertexIndices: [number, number, number];
    averageHeight: number;
    bounds: PreparedBounds;
}

interface PreparedTerrainQuad {
    terrainQuadId: string;
    row: number;
    col: number;
    quadIndex: number;
    /** Indices into the 9x9 source CellLandblock.terrain grid. */
    sourceTerrainIndices: [number, number, number, number];
    /** Source grid vertices in southwest, southeast, northwest, northeast order. */
    vertexIndices: [number, number, number, number];
    triangleIndices: [number, number];
    diagonal: "southwest-northeast" | "southeast-northwest";
    /** Raw source CellLandblock.terrain values in southwest, southeast, northwest, northeast order. */
    cornerTerrainCodes: [number, number, number, number];
    /** Client/LandSurf pal code for this terrain quad, including terrain and road bits. */
    pcode: number;
    averageHeight: number;
    bounds: PreparedBounds;
}

```

The terrain quad fields should line up with `PreparedTerrainBvhItem`: `row`,
`col`, `quadIndex`, and `triangleIndices`. The BVH leaf points to an item; the
item points to a terrain quad; the terrain payload owns the actual vertices and
triangle records.

The source `CellLandblock` asset does not store material asset IDs. It stores a
9x9 terrain-code grid and a 9x9 height grid. Terrain material selection is not a
single-code lookup. The client computes a LandSurf/TexMerge pcode from the four
corner terrain values for each quad; that pcode encodes the corner terrain types
and road bits used by `TexMerge.GetTerrain`, `GetRoadCode`, terrain alpha
selection, road alpha selection, and rotation selection. Rust should copy the
active `RegionDesc` identity into the terrain payload as `regionId` and
`regionNumber`, preserve the four raw corner terrain codes on each quad, compute
the client pcode, and leave route construction for `terrain-material/*` to the
frontend route helper.

Triangles are render primitives derived from a quad split. They should not own
material references. The renderer can resolve a triangle's material through its
`quadIndex`, then `quads[quadIndex].pcode`, then
`terrain-material/{regionNumber}/{pcode}`.

Terrain material resolution should not reuse the env-cell `surfaces[]` slot-table
pattern. Outdoor terrain is driven by `CellLandblock.terrain` codes and the
terrain/LandSurf/TexMerge path. The terrain payload should therefore keep source
corner codes and computed pcodes on quads. The frontend may derive terrain
material requests from those pcodes because the route is a direct pcode-addressed
material recipe, not an opaque dependency hidden in nested landblock-pack data.

The frontend dependency walk for terrain is:

1. request `landblock/{id}/terrain`;
2. read and deduplicate `terrain.quads[].pcode`;
3. format and request each
   `terrain-material/{regionNumber}/{pcode}` asset;
4. let each terrain material asset expose its terrain base, overlay, alpha,
   road, detail, and downstream texture/surface/palette dependencies.

`landblock/{id}/terrain` is the only landblock route that should participate in
terrain rendering or terrain texture resolution. `landblock/{id}/scene` should
not carry terrain codes, cheap terrain colors, diagnostic terrain facts,
`terrain-material/*`, `render-texture/*`, or `render-surface/*` dependencies.

### Terrain Material Shape

`terrain-material/{regionNumber}/{pcode}` should describe the ACViewer-style GPU
terrain blend inputs for one LandSurf/TexMerge pcode. It is not a normal
`CSurface` asset and should not pretend to be a `material/{did}` route.

Recommended shape:

```ts
interface PreparedTerrainMaterialPayload {
    kind: "terrain-material";
    regionNumber: number;
    pcode: number;
    materialKind: "tex-merge";
    base: TerrainTextureLayer;
    terrainOverlays: TerrainTextureLayer[];
    roadOverlays: TerrainRoadLayer[];
    detail: TerrainDetailLayer | null;
    colorVariation: TerrainColorVariation | null;
    dependencies: TerrainMaterialDependencies;
}

interface TerrainTextureLayer {
    terrainType: number;
    textureAssetId: AssetId; // render-texture/{did}
    textureDid: DataId;
    tiling: number;
    alphaTextureAssetId: AssetId | null; // render-texture/{did}
    alphaTextureDid: DataId | null;
    alphaIndex: number | null;
    rotation: 0 | 1 | 2 | 3;
}

interface TerrainRoadLayer {
    textureAssetId: AssetId; // render-texture/{did}
    textureDid: DataId;
    alphaTextureAssetId: AssetId; // render-texture/{did}
    alphaTextureDid: DataId;
    alphaIndex: number;
    rotation: 0 | 1 | 2 | 3;
}

interface TerrainDetailLayer {
    textureAssetId: AssetId; // render-texture/{did}
    textureDid: DataId;
    tiling: number;
    fadeNear: number; // retail starts fading after zw = 10
    fadeFar: number; // retail reaches zero at zw = 50
}

interface TerrainColorVariation {
    minVertBright: number;
    maxVertBright: number;
    minVertSaturate: number;
    maxVertSaturate: number;
    minVertHue: number;
    maxVertHue: number;
    activeRenderPath: false;
}

interface TerrainMaterialDependencies {
    renderTextureAssetIds: AssetId[];
    renderSurfaceAssetIds: AssetId[];
    paletteAssetIds: AssetId[];
}
```

This route should preserve the serialized `TerrainTex` color-variation fields
but mark them as inactive until a retail call path proves they affect rendering.
The renderer should use the GPU blend path: base terrain texture, up to three
terrain overlays, up to two road overlays, alpha maps, rotations, and a separate
detail texture pass with distance fade. Do not bake the detail texture into the
base/overlay/road blend, and do not add a CPU `TexMerge::FillTempTexBuffer`
clone unless exact retail-pixel parity becomes a requirement.

### Env Cell Versus Cell Structure Ownership

The split should mirror the DAT model:

- `landblock/{id}/scene` lists env-cell membership and placement facts:
  `envCellId`, `assetId`, local placement, visible-cell IDs, restriction object,
  and outside/inside classification.
- `env-cell/{id}` resolves the selected env cell into a render/topology payload:
  env-cell portals, portal apertures, static object placements, selected
  `CellStruct` render geometry, selected `CellStruct` BSP witnesses, and typed
  surface slots.
- `Environment` remains a Rust-side source asset family. It contains reusable
  `CellStruct` records, but the frontend should not need a broad
  `environment/{id}` route until a measured consumer needs to page or reuse full
  environment files independently from individual env cells.

In other words, `landblock/{id}/scene` says which env cells are in the focused
landblock. `env-cell/{id}` says what the selected env cell looks like. Follow-up
asset requests are derived from typed fields, not from a parallel dependency
manifest.

### Env Cell BVH Decision

`env-cell/{id}` should provide local-space spatial indexes for the selected cell
when they are useful for rendering, picking, debugging, or future collision
probes. These indexes belong to the env-cell payload, not to
`landblock/{id}/scene`.

Recommended shape:

```ts
interface PreparedEnvCellPayload {
    kind: "env-cell";
    envCellId: EnvCellId;
    environmentId: EnvironmentId;
    cellStructureId: CellStructureId;
    surfaces: EnvCellSurfaceSlot[];
    portals: EnvCellPortal[];
    visibleEnvCellIds: EnvCellId[];
    portalApertures: PreparedPortalAperture[];
    statics: EnvCellStaticMember[];
    /** Existing prepared render geometry shape, with triangle surface IDs treated as slot IDs. */
    renderGeometry: PreparedPolygonSetRenderGeometry;
    /** Existing prepared BSP witness shape from the selected CellStruct. */
    cellBsp: PreparedPolygonSetBspNode;
    localBvh: PreparedEnvCellBvh;
}

interface PreparedEnvCellBvh {
    coordinateSpace: "env-cell-local";
    nodes: PreparedBvhNode[];
    items: PreparedEnvCellBvhItem[];
}

type PreparedEnvCellBvhItem =
    | {
          kind: "render-geometry";
          polygonId: PolygonId | null;
          triangleRange: [number, number];
      }
    | {
          kind: "static";
          instanceId: string;
      }
    | {
          kind: "portal";
          portalId: PortalId;
      };

interface EnvCellPortal {
    portalId: PortalId;
    sourceIndex: number;
    flags: number;
    polygonId: PolygonId;
    otherCellId: number;
    otherPortalId: number;
    targetEnvCellId: EnvCellId | null;
    isOutsideTransition: boolean;
}

interface PreparedPortalAperture {
    portalId: PortalId;
    sourceIndex: number;
    polygonId: PolygonId;
    points: Vec3Dto[];
    plane: PreparedPortalAperturePlane | null;
}

interface PreparedPortalAperturePlane {
    normal: Vec3Dto;
    constant: number;
    source: "drawing-bsp-portal" | "derived-from-render-points";
}

interface EnvCellSurfaceSlot {
    /** 1-based slot matching polygon surface slot IDs. */
    slotId: number;
    surfaceId: DataId;
    materialAssetId: AssetId; // material/{did}
}

interface EnvCellStaticMember {
    instanceId: string;
    sourceDid: DataId;
    sourceAssetId: AssetId; // setup-model/{did} or gfx-obj/{did}
    sourceIndex: number;
    // Placement relative to the owning env-cell, not outdoor landblock space.
    localPlacement: PlacementTransformDto;
    sourceScale: Vec3Dto;
    sourceBounds: PreparedBounds | null;
    instanceBounds: PreparedBounds | null;
}
```

Dependency extraction for `env-cell/{id}` should walk typed fields:

- every `surfaces[].materialAssetId`;
- every `statics[].sourceAssetId`.

`surfaces[]` is not a duplicate of `renderGeometry.surfaceSlotIds`. For env-cell
geometry, polygon `posSurface` values are material-table slots. The env-cell
source record carries the actual surface/material DataIDs. The prepared contract
should preserve that table explicitly as `surfaces[]`, where `slotId` matches
the render geometry's triangle surface slot and `surfaceId` is the real
`0x08...` material DataID. The existing render-geometry type can keep its current
field names during migration, but the contract should document that env-cell
triangle surface IDs are slot IDs, not material DataIDs.

The top-level env-cell placement belongs to `landblock/{id}/scene.envCells[]`.
`env-cell/{id}` should not duplicate it. `env-cell/{id}.renderGeometry` is local
cell shell geometry from the selected `CellStruct`; the renderer places it using
the scene member transform. Indoor static members still need their own
`localPlacement` because they are placed inside the env cell.

Use local env-cell coordinate space for these BVHs. Do not transform them into
outdoor landblock space unless a specific renderer operation asks for a temporary
world-space projection. Outdoor landblock interiors can be non-Euclidean, so
publishing env-cell BVHs as landblock-space truth would recreate the same bug the
outdoor BVH split is avoiding.

Keep the source BSPs. A BVH does not replace `CellStruct` BSP/drawing/physics
data. The BSPs preserve source semantics and portal topology; the BVHs are
derived acceleration structures for practical renderer operations.

Use one typed `localBvh` for the env cell. It should index the cell-local
analogue of the outdoor BVH:

- `render-geometry` items for the cell shell triangles from the selected
  `CellStruct`;
- `static` items for placed indoor static members from `EnvCell.static_objects`;
- optional `portal` items for portal apertures when useful for traversal,
  picking, or debug overlays.

Build static item bounds the same way `landblock/{id}/scene` builds outdoor
placed-static bounds: resolve enough setup/gfx source bounds in Rust to produce
member bounds, without embedding the full setup/gfx geometry into the env-cell
payload.

This keeps the asset graph clean. Static member geometry still belongs to
`setup-model/*` and `gfx-obj/*`; the env-cell payload only carries typed static
placements, source asset IDs, and derived bounds/index entries for the placed
members.

Do not split the env-cell BVH into separate shell/static/portal BVHs until a
concrete operation or profile shows the single typed index is the wrong shape.
For a valid env cell with no local spatial items, return an empty BVH with
`nodes: []` and `items: []`. Do not use `null` to hide assembly failures.

## Env Cell Route Decision

Use one `env-cell/{id}` asset initially.

Do not create both `env-cell/*` and `env-cell-render/*` yet. The same focused
browser/client consumer currently needs cell topology, portals, BSP witnesses,
surface IDs, and render geometry together. Splitting render geometry from
membership/topology is justified only when we have concrete pressure such as:

- portal traversal that needs topology without render buffers;
- collision/runtime simulation that needs BSP without render payloads;
- separate binary transport or paging cadence for heavy render arrays.

When that pressure appears, split by consumer lifetime rather than by naming
fashion.

## Planner Responsibilities

The frontend planner should own request decisions:

- request `landblock/{id}/terrain` only for outdoor terrain and building-shell
  coverage;
- request `landblock/{id}/scene` for focused landblocks;
- request `env-cell/{id}` for visible or traversable interior cells;
- request renderable dependencies from typed asset metadata and explicit route
  helpers;
- skip already prepared or pending assets;
- prioritize by camera/focus/visibility policy.

The planner should not need to scan nested landblock-pack render geometry to find
material IDs, and it should not consume a parallel `renderableAssetIds` shortcut
for scene statics. Scene follow-up requests should come from typed member fields.
Material requests should fall out of `env-cell/*` and `gfx-obj/*` metadata.
Building shell material requests in `landblock/{id}/terrain` come from
`buildingShells[].materialSurfaceIds`.
Terrain material requests are the exception: the frontend derives
`terrain-material/*` route IDs from
`landblock/{id}/terrain.regionNumber` and
`landblock/{id}/terrain.terrain.quads[].pcode` because terrain materials are
pcode-addressed recipes.

## Planner Strategy Changes

The planner should stop treating one landblock request as the unit of scene
readiness. The new unit is a route-family graph whose roots are selected by
rendering need:

- outdoor coverage roots: `landblock/{id}/terrain`;
- focused landblock roots: `landblock/{id}/scene`;
- active interior roots: `env-cell/{id}`;
- render leaf roots discovered from typed route fields: `setup-model/*`,
  `gfx-obj/*`, `material/*`, `terrain-material/*`, `render-texture/*`,
  `render-surface/*`, and `palette/*`.

The planner should use separate selection policies for the root route families:

- Request `landblock/{id}/terrain` for outdoor coverage rings and focused
  outdoor landblocks. This route replaces old terrain/summary coverage and is
  valid only for outdoor landblocks.
- Request `landblock/{id}/scene` for focused landblocks where exact scene
  membership, statics, buildings, portals, or env-cell residency are needed.
- Request `env-cell/{id}` from scene membership only when the env cell is
  visible, traversable, selected, or retained by interior residency policy.
- Do not request `landblock/{id}/terrain` for dungeon landblocks. Dungeon visual
  roots come from `landblock/{id}/scene.envCells[]` and follow-up `env-cell/*`
  assets.

Follow-up dependency extraction should be route-specific and typed:

- `landblock/{id}/terrain` enqueues terrain materials derived from
  `regionNumber` plus unique `terrain.quads[].pcode`, and building shell
  `material/{did}` requests from `buildingShells[].materialSurfaceIds`.
- `landblock/{id}/scene` enqueues `statics[].sourceAssetId`,
  `buildings[].sourceAssetId`, and selected `envCells[].assetId`. It never
  enqueues material, render-texture, render-surface, or palette routes directly.
- `env-cell/{id}` is a direct hydration root selected by scene/residency policy.
  Its prepared response enqueues `surfaces[].materialAssetId` and
  `statics[].sourceAssetId`.
- `setup-model/{did}` enqueues each setup part `gfx-obj/{did}`.
- `gfx-obj/{did}` enqueues its `material/{did}` slots.
- `material/{did}` and `terrain-material/{regionNumber}/{pcode}` enqueue their
  direct texture/surface/palette dependencies.

The broad streaming loop should be:

1. compute outdoor coverage landblocks from camera/focus;
2. enqueue terrain roots for outdoor coverage landblocks;
3. compute focused landblocks from camera/focus/navigation state;
4. enqueue scene roots for focused landblocks;
5. expand prepared terrain and scene responses through typed dependency
   extractors;
6. enqueue env-cell roots selected by scene membership, portal traversal, and
   env-cell residency BVH policy;
7. expand setup/gfx/material/texture/surface/palette leaves through the normal
   asset graph scheduler;
8. keep already prepared or pending routes out of the queue unless invalidated.

Cache and pruning policy should match route lifetime:

- `landblock/{id}/terrain` can be retained for the outdoor coverage cache and
  pruned by outdoor coverage distance.
- `landblock/{id}/scene` should be retained only for focused scene membership
  and nearby transition context.
- `env-cell/{id}` should be retained by active interior visibility, traversal
  reachability, selected cell, and residency prefetch policy.
- shared render leaves (`setup-model/*`, `gfx-obj/*`, `material/*`,
  `terrain-material/*`, `render-texture/*`, `render-surface/*`, `palette/*`)
  should be retained while reachable from prepared or pending route roots.

Planner diagnostics should report route-family ownership, not only missing asset
IDs. Missing or failed follow-up assets should include the requesting owner route,
the typed field that produced the edge, and whether the target was pending,
prepared, failed, or absent. That gives the renderer enough information to make
missing visible materials scream without hiding the planner edge that failed.

## Codebase Dry-Run Adjustments

The current frontend has three separate mechanisms that all assume the old pack
shape:

- root selection in `scene-asset-request-planner.ts`;
- host-response dependency extraction in `dependencies.ts`;
- prepared-record dependency extraction/readiness in `types.ts`.

Do not switch route roots before these seams understand the new payloads. The
clean migration is to introduce route-specific extractors first, keep old pack
extractors during the transition, and then switch root selection.

Recommended frontend order:

1. Add route helpers in `landblocks.ts` for `landblock/{id}/terrain`,
   `landblock/{id}/scene`, `env-cell/{id}`, and
   `terrain-material/{regionNumber}/{pcode}` while leaving old helpers in place.
2. Add Zod schemas in `host/contracts.ts` and prepared payload types in
   `assets/types.ts` for the new routes. Keep old schemas until Phase 5.
3. Centralize route-specific dependency extraction in one frontend module, then
   have both `getAssetResponseDependencies` and `getPreparedAssetDependencies`
   call it. Avoid maintaining two divergent switch statements for the same route
   families.
4. Extend `asset-hydration-policy.ts` before switching planner roots:
   `landblock/{id}/terrain`, `landblock/{id}/scene`, `env-cell/{id}`,
   `gfx-obj/{did}`, and `setup-model/{did}` should remain direct hydration
   roots. Material/texture/surface/palette leaves can continue to use graph
   hydration.
5. Update the worker binary path before enabling new large roots:
   `isLargeWorkerPrepareAsset` must include `landblock/{id}/terrain`,
   `landblock/{id}/scene` if BVH arrays are binary, `env-cell/{id}`, and
   `gfx-obj/{did}` when render geometry uses the binary envelope.
6. Only after the new extractors, schemas, hydration policy, and worker binary
   path exist, switch `createSceneCoverageRequests` from pack/summary roots to
   terrain/scene/env-cell roots.

The streaming controller currently performs one planning pass per scene-interest
key unless external state changes schedule another pass. Direct root hydration
therefore must either:

- explicitly trigger a follow-up planning pass after applying newly prepared
  direct roots whose typed fields expose new requests; or
- move dependency expansion for prepared direct roots into the same sync pass.

The first option is lower risk with the existing controller. After applying
direct `landblock/{id}/terrain`, `landblock/{id}/scene`, or `env-cell/{id}`
responses, the controller should re-run planning for the same scene-interest key
until no new unprepared route IDs are emitted. Keep the existing
prepared/pending de-duplication so this convergence loop cannot request the same
asset repeatedly.

Renderer migration should use adapters instead of forcing every renderer module
to understand both old and new route families. Add narrow selectors such as:

- terrain tiles from prepared assets: old `landblock-pack`/`landblock-summary`
  terrain during migration, new `landblock/{id}/terrain` after switch;
- structured interior cells from prepared assets: old pack interior cells during
  migration, new `env-cell/{id}` plus scene membership after switch;
- static/building source members from prepared assets: old pack/summary facts
  during migration, new `landblock/{id}/scene` members after switch.

Delete those migration adapters in Phase 5 when old routes are removed. Do not
leave compatibility reexports or broad union types in renderer hot paths after
the cutover.

Terrain rendering should migrate in two steps. First, switch terrain scene
selection from old pack/summary `terrainMesh` payloads to
`landblock/{id}/terrain` while preserving the current debug-color renderer as a
temporary visualization path. In that step, the terrain payload must already
carry `cornerTerrainCodes` and `pcode` so planner/material diagnostics can prove
the right `terrain-material/*` requests. Second, add the terrain material shader
path that consumes `terrain-material/{regionNumber}/{pcode}` layer recipes.
During the temporary debug-color step, make diagnostics distinguish "terrain
material rendering not enabled yet" from "visible terrain material route is
missing or failed" so we do not hide planner/host failures once material mode is
enabled.

## Failure Policy

Problems should scream:

- If visible geometry reaches `WorldDisplay` with a `surfaceId` whose
  `material/{did}` is not prepared or pending, emit a high-severity structured
  diagnostic with the owning asset ID, geometry kind, surface ID, and prepared
  asset counts.
- If `env-cell/*` render geometry references a surface slot that is absent from
  `surfaces[]`, or a slot has no resolved `materialAssetId`, treat it as an
  asset contract error.
- If `gfx-obj/*` includes render geometry with material/surface IDs but omits
  the matching typed material references, treat it as an asset contract error.
- If `landblock/{id}/terrain` includes building shell render geometry with
  surface IDs but omits `buildingShells[].materialSurfaceIds`, treat it as an
  asset contract error.
- When terrain material rendering is enabled, if visible terrain reaches
  `WorldDisplay` before its `terrain-material/{regionNumber}/{pcode}` asset is
  prepared or pending, emit a high-severity structured diagnostic with the owning
  terrain asset ID, region number, pcode, and prepared asset counts.
- If Rust fails to resolve `terrain-material/*`, `material/*`,
  `render-texture/*`, `render-surface/*`, or `palette/*`, log to stderr at the
  host boundary with the requested route and source error chain.
- Do not substitute fallback materials silently for app-owned contract failures.
  A visual fallback may be drawn only after the diagnostic is emitted and the
  failure is represented in asset state.

## Migration Plan

### Phase 0: Baseline the Problem Without Freezing It

Do not add tests whose purpose is to preserve current `landblock-pack` or
`landblock-summary` dependency extraction behavior. The current extraction shape
is part of the problem: it scans nested landblock payloads for ownership facts
that should belong to first-class assets. Locking that behavior would make the
migration harder and would create tests that need to be deleted as soon as the
plan succeeds.

Use this phase only to capture evidence and failure fixtures that make the route
split safer:

- Record representative current payloads for:
  - a focused outdoor landblock with statics, buildings, and linked env cells;
  - a dungeon landblock with env cells and no terrain route expectation;
  - an env cell whose render geometry references `CSurface` IDs;
  - terrain quads with mixed corner terrain codes and road bits.
- Add tests only for desired invariants that survive the migration:
  - visible interior cell surface IDs must require prepared `material/*` assets;
  - geometry that names a material source must expose a typed dependency edge;
  - missing material graph outputs are failed asset contracts, not silent
    frontend fallbacks;
  - dependency extraction for new routes is route-specific and typed.
- Identify old tests that encode `landblock-pack`/`landblock-summary` ownership
  assumptions and mark them as migration targets instead of expanding them.

Validation:

- Fixture capture or focused harness output is checked into the plan or test
  data only if it documents a route invariant needed by the new design.
- No new tests should require `landblock-pack` or `landblock-summary` to remain
  dependency owners.

### Phase 1: Introduce Route Helpers and DTO Types

- Add route format/parse helpers for:
  - `landblock/{id}/terrain`;
  - `landblock/{id}/scene`;
  - `env-cell/{id}`;
  - `terrain-material/{regionNumber}/{pcode}`.
- Add TypeScript payload types and Zod schemas for the new routes.
- Add prepared-record dependency extractors for the new route payloads while
  keeping old pack/summary extractors active.
- Update hydration policy classification for the new route families before any
  planner root switch.
- Keep old `landblock-pack/*` and `landblock-summary/*` routes available during
  the transition, but do not add new behavior to them.

Validation:

- Typecheck route helpers against representative asset IDs.
- Ensure invalid route strings fail loudly.

### Phase 2: Add Rust Host Routes

- Add `ContentAssetRequest` variants, asset-ID parsers, Tauri adapter response
  builders, and binary serializers for the new asset IDs.
- Project existing Rust landblock pack assembly products into the new response
  shapes where the data already exists, without changing deeper Rust assembly
  unnecessarily.
- Add a narrow terrain-prep step for data the current pack terrain mesh does not
  carry: per-quad source corner terrain codes and computed pcodes.
- `landblock/{id}/terrain` should project outdoor terrain, source terrain corner
  codes, computed pcodes, `regionId`/`regionNumber`, building shell render
  geometry, and a terrain-only BVH.
- `landblock/{id}/scene` should project typed scene membership, source
  placements, static/building source asset IDs, env-cell asset IDs, portal/link
  graph, and an outdoor static BVH when outdoor-space members exist.
- `env-cell/{id}` should project one interior cell render/topology payload and
  typed surface slots with `materialAssetId` route IDs.
- `terrain-material/{regionNumber}/{pcode}` should project one generated terrain
  material recipe from the active `RegionDesc` terrain tables.
- Add or expose material graph entry points for route-facing material resolution:
  `material/{did}`, `gfx-obj/{did}` slots, `env-cell/{id}` slots, and
  `terrain-material/{regionNumber}/{pcode}`.
- Keep new host routes capable of failed structured responses with provenance;
  do not fall through to app-local stubs for recognized-but-failed route IDs.
- Failed route responses must still match either that route's schema with an
  explicit failed status or a shared failed-asset schema. Do not emit a payload
  with `kind: "material-recipe"` or `kind: "terrain-material"` that omits fields
  required by the successful schema; otherwise dependency extraction treats a
  real failure as an unknown payload.

Validation:

- `npm run check:rust`
- Host contract tests for each new route.

### Phase 3: Move Dependency Ownership to First-Class Assets and Route Helpers

- Make terrain material route helpers derive `terrain-material/*` requests from
  `terrain.regionNumber` and `terrain.quads[].pcode`.
- Make `env-cell/{id}` expose typed surface slots whose `materialAssetId` fields
  are the material route inputs for env-cell render geometry.
- Keep `gfx-obj/{did}` as the material dependency owner for object geometry.
- Keep `setup-model/{did}` as the owner of setup part dependencies. Default setup
  materials are resolved by composing setup parts with their `gfx-obj/*`
  material slots in the renderer.
- Remove default setup rendering from `resolve_setup_appearance`; keep appearance
  graph resolution only for a future explicit ObjDesc override route.
- Ensure material graph route entry points return immediate dependencies only,
  not landblock-level transitive closures.
- Make `landblock/{id}/scene` expose first-class scene members through typed
  placement/source records, not through a parallel renderable dependency list and
  not through material/render-texture/render-surface/palette transitive closure.
- Remove any planner logic that discovers materials by scanning
  `landblock-pack.prepared.interiorCells`.
- Add frontend dependency extraction tests for both raw host responses and
  prepared records so `dependencies.ts` and prepared readiness cannot drift.

Validation:

- Asset graph tests prove:
  - terrain -> terrain material -> render-texture/render-surface/palette;
  - terrain -> building shell material -> render-texture/render-surface/palette;
  - scene -> typed static/building member -> setup-model or gfx-obj;
  - scene -> typed env-cell member -> env-cell;
  - scene -> env-cell -> material -> render-texture/render-surface/palette;
  - scene -> setup-model -> gfx-obj -> material;
  - no material route is requested directly from `landblock/{id}/scene`.
- Planner tests prove:
  - outdoor coverage requests `landblock/{id}/terrain` without also requiring
    `landblock/{id}/scene`;
  - focused outdoor landblocks request both terrain and scene roots;
  - focused dungeon landblocks request scene and env-cell roots, not terrain;
  - env-cell requests are selected from scene membership/residency policy rather
    than embedded landblock render geometry;
  - prepared or pending route IDs are not requeued.

### Phase 4: Switch Frontend Planning to New Routes

- Replace terrain/summary coverage requests with `landblock/{id}/terrain`.
- Replace focused pack requests with `landblock/{id}/scene`.
- Request `env-cell/{id}` as direct hydrated roots when scene membership
  identifies visible/traversable cells.
- Split planner root selection into outdoor coverage roots, focused scene roots,
  and active interior roots.
- Update dependency extraction to use route-specific typed extractors instead of
  pack-shape scans.
- Add a convergence loop or explicit replan trigger after direct root hydration
  so newly prepared terrain, scene, and env-cell roots can schedule their typed
  follow-up assets during the same scene-interest state.
- Update cache pruning and diagnostics to understand the new route families and
  their different lifetimes.
- Update renderer selectors/adapters so terrain, structured interiors, spatial
  scene items, portal work items, debug overlays, and material diagnostics can
  consume the new route families without each subsystem carrying broad old/new
  unions.

Validation:

- `npm run test:ts -- src/lib/assets src/lib/world-display`
- `npm run check`
- Manual browser verification that focused landblocks load scene, terrain,
  env-cell, gfx, setup, material, texture, surface, and palette assets as
  separate prepared records.

### Phase 5: Retire Old Pack Semantics

- Stop using `landblock-pack/*` and `landblock-summary/*` in planner code.
- Remove old route helpers, schemas, and tests once no production code depends on
  them.
- If a temporary old-route adapter is still needed for a diagnostic harness, keep
  it isolated and mark it for deletion with a specific follow-up.

Validation:

- `rg "landblock-pack|landblock-summary" apps/holtburger-3d/src` should find
  only migration notes, deleted-route tests, or explicit diagnostic fixtures.
- `npm run check`
- `npm run check:rust`

### Phase 6: Revisit Further Splits with Measurements

Only after the route migration is stable, evaluate whether to split:

- `env-cell/{id}/topology` from `env-cell/{id}/render`;
- `landblock/{id}/scene-bvh` from `landblock/{id}/scene`;
- dedicated geometry routes such as `env-cell/{id}/render` or
  `landblock/{id}/terrain-geometry`.

Large arrays should already use binary sections inside the owning route response;
do not wait for Phase 6 to stop JSON-expanding geometry. Require profiling or a
concrete consumer before introducing a new route split.

## Open Questions

- Should `env-cell/{id}` IDs use the raw env-cell file ID exactly, or normalize
  to landblock-plus-cell-index in routes while carrying the raw file ID in the
  payload?
- Should scene membership include all env cells in the landblock or only
  portal-reachable cells from focused buildings?
- Should renderer fallback material drawing be disabled entirely in development
  builds after the diagnostic is emitted?

## Acceptance Criteria

- A visible interior cell surface ID has one obvious owning asset:
  `env-cell/{id}`.
- A visible default object surface ID has one obvious owning asset:
  `gfx-obj/{did}`.
- Materials are requested either because first-class renderable assets declare
  direct dependencies or, for terrain only, because the frontend derives
  `terrain-material/*` routes from `regionNumber` and pcodes on the terrain
  asset.
- `landblock/{id}/terrain` owns terrain and building shell render geometry;
  `landblock/{id}/scene` owns focused semantic membership, portals, env cells,
  and scene BVHs.
- The frontend can fetch both terrain and scene for a focused landblock without
  duplicating heavy render geometry.
- `landblock/{id}/scene` carries statics/buildings/env-cell membership and
  placements directly, without a parallel top-level `renderableAssetIds` list.
- Missing material recipes produce host/frontend diagnostics that identify the
  owner, route, source ID, and dependency edge that failed.
