# Holtburger 3D Landblock Pack Asset Plan

Status: Phase 5.1 implemented. Later phases remain planning.

## Context

The 3D app currently discovers and prepares landblock content through several renderer-shaped asset families:

- `terrain/<landblock>` for outdoor terrain mesh input.
- `outdoor-static-scene/<landblock>` for explicit outdoor objects, buildings, and generated outdoor scenery.
- `indoor-env-cell/<env-cell>` for dungeon and interior cells.
- `environment/<environment>` for structured interior cell geometry.
- `setup-model/*` and `gfx-obj/*` for renderable model geometry.

This shape proved the browser-mode renderer, but it now exposes several architectural problems:

- The frontend is responsible for too much AC DAT relationship discovery.
- Dungeon and outdoor-with-interiors loading starts from an env-cell seed and then asks that env cell to reveal the landblock's full env-cell list.
- Outdoor-linked interiors are discovered through prepared building portal data before using `LandblockInfo.num_cells`, even though `XXYYFFFE` is the official landblock-level env-cell index.
- `terrain/*` and `outdoor-static-scene/*` are renderer-oriented slices, not official DAT-rooted landblock concepts.
- Static renderable and spatial metadata are increasingly derived in TypeScript even though they depend on DAT semantics, transforms, bounds, and reusable geometry facts.

The official cell DAT shape is landblock-rooted:

```text
XXYYFFFF  CellLandblock
XXYYFFFE  LandblockInfo
XXYY0100  EnvCell
XXYY0101  EnvCell
...
```

`LandblockInfo.num_cells` is the authoritative list length for env cells in a landblock. A dungeon is not a separate official asset type; it is a landblock shape inferred from the normal landblock records and their env-cell inventory.

## Goals

- Add a landblock-scoped asset pack that is rooted in official DAT records.
- Use one landblock manifest shape for outdoor and dungeon landblocks.
- Move authoritative DAT discovery and deterministic asset assembly into Rust.
- Eventually expose renderer-ready data for the geometry, static instances, interiors, and spatial metadata the current 3D renderer cares about.
- Preserve enough decoded source facts and loader diagnostics for debugging and reverse-engineering.
- Reduce frontend asset graph work to scene-interest selection, cache policy, UI policy, and Three.js object lifecycle.
- Keep the design reusable for a future non-browser 3D client.

## Non-Goals

- Do not create a special `indoor-landblock/*` asset family. The asset should be named for the official record, not a classification guessed before loading.
- Do not bundle every possible texture, animation, sound, motion table, or runtime entity dependency into the first landblock pack.
- Do not move browser-mode camera policy, inspector policy, UI toggles, or LOD radius controls into Rust.
- Do not remove lower-level debug asset routes immediately. They are useful as parity and diagnostic views during migration.
- Do not treat dungeon and outdoor landblocks as separate frontend discovery systems.

## Asset Naming

Use a neutral, official-record-rooted asset id:

```text
landblock-pack/<XXYYFFFF>
```

The pack payload classifies the loaded landblock after reading `XXYYFFFF` and `XXYYFFFE`.

Classification should be diagnostic and advisory, not a separate loading path:

```ts
type LandblockClassification = "outdoor" | "dungeon";
```

Suggested initial rules:

- `dungeon`: all terrain heights are zero, `numEnvCells > 0`, and no buildings are present.
- `outdoor`: every other successfully decoded landblock, including landblocks with buildings, caves, mansion basements, or other interior env cells.

Missing, corrupt, or contradictory source records should be reported through source diagnostics. They should not create extra landblock classifications.

## Top-Level Payload Shape

The payload should keep official decoded facts separate from renderer-prepared facts.

```ts
interface LandblockPackPayload {
  kind: "landblock-pack";
  landblockId: number;
  landblockInfoId: number;
  classification: LandblockClassification;
  sourceFacts: LandblockSourceFacts;
  prepared: LandblockPreparedFacts;
  dependencies: LandblockPackDependencies;
  diagnostics: LandblockPackSourceDiagnostics;
  provenance: AssetProvenance;
}
```

## Shared Asset Deduplication Rule

`landblock-pack/*` must not duplicate heavy shared renderable source data across landblocks. A landblock pack owns landblock-local facts and prepared landblock-local products. Shared immutable assets must stay keyed by their own stable asset ids and be cached independently.

The pack may include:

- static instance ids,
- owning landblock or env-cell ids,
- source DIDs and source asset ids,
- placement transforms,
- per-instance scale,
- per-instance conservative bounds,
- source/loader diagnostics,
- dependency references.

The pack should not inline by default:

- full `gfx-obj` vertex/polygon/render-buffer data,
- full `setup-model` source records that can be shared by DID,
- texture or surface source payloads,
- animation, motion, sound, or script tables.

Instead, landblock instances should reference shared renderable assets:

```ts
interface LandblockRenderableReference {
  sourceDid: number;
  sourceAssetId: string; // "gfx-obj/01000001" or "setup-model/02000001"
}
```

Normal browser/client streaming should load one shared copy of each referenced renderable asset and reuse it across landblocks. The landblock pack can still contain cheap per-instance placement and bounds data because those are landblock-local.

Inline heavy geometry should only be considered for explicit export/debug profiles, not for the normal streaming asset. Even then, the profile name must make the duplication tradeoff obvious.

Frontend dependency handling must preserve this rule. When `PreparedLandblockPackPayload` reports renderable references, `getPreparedAssetDependencies` should expose those asset ids so the existing graph loader can continue to hydrate shared `gfx-obj/*` and `setup-model/*` assets once per DID. Do not fan a pack into duplicated per-landblock renderable payloads just to satisfy the current dependency graph.

### Source Facts

`sourceFacts` contains decoded and normalized DAT facts. These should be as lossless as practical for the fields we already decode.

```ts
interface LandblockSourceFacts {
  cellLandblock: CellLandblockFact | null;
  landblockInfo: LandblockInfoFact | null;
  outdoor: OutdoorSourceFacts;
  interiors: InteriorSourceFacts;
  renderables: RenderableSourceFacts;
}
```

#### Cell Landblock

```ts
interface CellLandblockFact {
  id: number;
  hasObjects: boolean;
  gridSize: 9;
  tileSize: 24;
  terrainTypes: number[];
  heights: number[];
  minHeight: number;
  maxHeight: number;
  allHeightsZero: boolean;
}
```

This is the official `XXYYFFFF` data. For dungeons it is still useful for classification, coordinate context, road/terrain source inspection, and parity with official loading.

#### Landblock Info

```ts
interface LandblockInfoFact {
  id: number;
  firstEnvCellId: number | null;
  numEnvCells: number;
  objectCount: number;
  buildingCount: number;
  packMask: number;
  restrictions: LandblockRestriction[];
}

interface LandblockRestriction {
  cellId: number;
  restrictionObjectId: number;
}
```

Env cells are contiguous in the landblock namespace. The DTO should not ship a redundant `envCellIds` array. Consumers should derive the full list from `firstEnvCellId` and `numEnvCells`:

```text
firstEnvCellId = numEnvCells > 0 ? ((landblockId & 0xFFFF0000) | 0x0100) : null
envCellId(index) = firstEnvCellId + index
```

Use a shared helper on both sides of the boundary for this derivation so ordering and unsigned handling stay consistent. If future evidence shows non-contiguous env-cell ids, that should be treated as a source-format discovery and the DTO can change then.

#### Outdoor Source Facts

```ts
interface OutdoorSourceFacts {
  explicitObjects: StaticInstanceFact[];
  buildings: BuildingInstanceFact[];
  generatedScenery: GeneratedSceneryFact[];
}
```

These facts can reuse the existing `StaticOutdoorSceneAssembler` logic, but they should be delivered as part of the landblock pack instead of requiring `outdoor-static-scene/*` as the discovery root.

#### Interior Source Facts

```ts
interface InteriorSourceFacts {
  envCells: EnvCellFact[];
  environments: EnvironmentFact[];
}
```

Initial policy should load all env cells listed by `LandblockInfo.num_cells` for the requested landblock pack. This is appropriate for:

- focused dungeon browsing,
- outdoor landblock interior inspection,
- portal debugging,
- avoiding seed-cell discovery gaps.

If memory pressure appears later, the pack can support profiles such as `manifest-only` or `debug-full`, but normal streaming must remain reference-based for shared renderable source data. Any profile that inlines heavy geometry should be explicit export/debug work, not the default client path.

```ts
interface EnvCellFact {
  envCellId: number;
  environmentId: number | null;
  cellStructureId: number | null;
  localPlacement: PlacementTransform;
  surfaceIds: number[];
  visibleCellIds: number[];
  portals: EnvCellPortalFact[];
  staticObjects: StaticInstanceFact[];
  seenOutside: boolean | null;
  restrictionObjectId: number | null;
}

interface EnvCellPortalFact {
  portalId: string;
  sourceIndex: number;
  flags: number;
  polygonId: number;
  otherCellId: number;
  otherPortalId: number;
  targetEnvCellId: number | null;
  isOutsideTransition: boolean;
}
```

`isOutsideTransition` should preserve the current note that retail treats portal flag `0x4` as an outside transition instead of blindly trusting the serialized target cell suffix.

#### Renderable Source Facts

```ts
interface RenderableSourceFacts {
  gfxObjs: GfxObjFact[];
  setupModels: SetupModelFact[];
  unsupportedDids: UnsupportedRenderableDid[];
}
```

The assembler should collect renderable DIDs referenced by:

- explicit outdoor objects,
- outdoor buildings,
- generated scenery,
- indoor env-cell static objects,
- setup-model parts.

`0x01xxxxxx` maps to `gfx-obj`, `0x02xxxxxx` maps to `setup-model`, and unsupported DID families should be reported in source diagnostics rather than silently dropped.

### Prepared Facts

`prepared` contains renderer-ready data. This is the part that should shrink TypeScript transformation code over time.

```ts
interface LandblockPreparedFacts {
  terrainMesh: PreparedMesh | null;
  outdoorStaticInstances: PreparedStaticInstance[];
  interiorCells: PreparedInteriorCell[];
  staticMeshes: PreparedStaticMesh[];
  spatialItems: PreparedSpatialItem[];
  staticInstanceBvh: PreparedBvh | null;
}
```

#### Terrain Mesh

The existing asset worker terrain mesh generation can move to Rust once the pack exists. Rust should emit:

- vertices,
- indices or triangles,
- terrain type per triangle,
- landblock-local bounds,
- min/max height,
- stable render id.

The frontend should only upload buffers and apply materials.

#### Interior Cell Meshes

Rust should prepare environment cell structures into renderer-ready geometry using each env cell's:

- `environmentId`,
- `cellStructureId`,
- `surfaceIds`,
- local placement.

The frontend may still choose debug materials and visibility policy, but it should not need to decode environment cell structures or build cell BSP payloads for normal rendering.

#### Static Meshes And Instances

Rust should resolve static instance transforms and source renderables into prepared instance records:

```ts
interface PreparedStaticInstance {
  instanceId: string;
  ownerKind: "outdoor" | "env-cell";
  ownerId: number;
  sourceDid: number;
  sourceAssetId: string;
  localPlacement: PlacementTransform;
  worldOrLandblockPlacement: PlacementTransform;
  bounds: Aabb | null;
}
```

Renderer batching can still happen in TypeScript, but all semantic placement, source DID resolution, and conservative bounds should be produced by Rust.

#### Spatial Metadata And Acceleration

The pack should expose authoritative source-space spatial items and bounds, then Rust should build one primary static landblock BVH over every immutable landblock item with valid bounds. The BVH should be a mixed-item broadphase, not one tree per feature or one tree per item kind. Queries should pass an item-kind mask so the same tree can serve ray picking, diagnostic picking, occluder discovery, frustum broadphase, and env-cell/residency candidate lookup without duplicating spatial data.

The BVH is not the final authority for domain-specific answers. It returns candidates. Terrain grid logic, cell/environment BSP, portal geometry, portal graph/connectivity rules, and renderer/debug policy still run as narrowphase or semantic filtering after BVH candidate selection. In particular, env-cell residency should use the BVH to find plausible cell candidates, then use cell-specific semantics to choose the authoritative cell.

This should still land after stable spatial identity and transform parity so we do not mix discovery migration with broadphase authority migration.

The BVH coordinate semantics should mirror the frontend renderer's current landblock/chunk-relative spatial indexing model. Pack spatial items are authored in landblock-local AC source space for their owning `XXYYFFFF` landblock. The frontend remains responsible for converting those source-space bounds into render chunk-local coordinates, then placing that chunk-local BVH into renderer/world space through the same render chunk transform and rebasing path it already uses for terrain, structured cells, and portals. Rust should not bake browser camera origin, global scene rebasing, current renderer chunk offsets, or Three.js-specific axis conversion into the pack.

This is not browser UI policy. It depends on authoritative decoded geometry, transforms, and bounds, and it is reusable for:

- static picking,
- diagnostic picking,
- broadphase culling,
- portal/cell inspection,
- future physics/collision probes,
- future non-browser clients.

Initial shape:

```ts
interface PreparedBvh {
  coordinateSpace: "landblock-local";
  landblockId: number;
  scope: "static-landblock";
  nodes: PreparedBvhNode[];
}

interface PreparedSpatialItem {
  id: string;
  kind:
    | "terrain"
    | "outdoor-static"
    | "building"
    | "env-cell"
    | "indoor-static"
    | "portal";
  ownerId: number | null;
  sourceAssetId: string | null;
  bounds: Aabb;
}
```

Expected staging:

- Env cells already have cell/environment BSP data. The frontend can continue to use cell-level structures for env-cell-specific narrowphase and portal/debug work even if a full landblock BVH supplies the first broadphase candidate set.
- Terrain has a fixed landblock grid, but terrain bounds can still participate in a full landblock BVH for unified ray picking, occluder tests, and frustum broadphase.
- Static instances require transform parity before their bounds can be trusted, but they should participate in the same full landblock BVH once those bounds are available.
- If an item kind lacks trustworthy bounds in an early slice, omit that item kind from the BVH and report the omission through source/spatial diagnostics. Do not create a separate static-only acceleration design unless implementation proves the full BVH path is blocked.

The spatial target is `PreparedSpatialItem[]` plus a Rust-built full landblock BVH. Domain-specific narrowphase paths still run after the BVH returns candidates.

Intended query model:

- Ray pick terrain: query the primary landblock BVH with a `terrain` mask, then run terrain grid/triangle narrowphase.
- Ray pick debug statics or portals: query the same BVH with `portal`, `outdoor-static`, `indoor-static`, and/or `building` masks, then run item-specific picking.
- Frustum broadphase: query the same BVH with renderable item masks, then apply frontend visibility/debug policy.
- Occluder discovery: query the same BVH with occluder-eligible masks, then run whatever occluder heuristic is appropriate.
- Env-cell/residency candidate lookup: query the same BVH with an `env-cell` mask, then use cell/BSP/portal semantics for final residency.

Separate indices are still appropriate for data with different lifetimes or semantics, such as runtime entities, portal graph traversal, or future dynamic physics bodies. They should not replace the primary static landblock BVH for immutable landblock content unless profiling proves the mixed tree is a problem.

Coordinate invariant:

- Rust emits canonical AC landblock-local coordinates and bounds unless a prepared field explicitly declares another coordinate space.
- TypeScript converts pack spatial data into the renderer's chunk-local basis before querying or displaying it, then applies render chunk transforms.
- No pack spatial item should depend on current camera position, active render anchor, or browser-mode rebasing state.
- This mirrors the frontend's existing chunk-local spatial model and keeps the pack reusable for a future non-browser 3D client.

### Dependencies

The pack should report loaded and missing dependent resources:

```ts
interface LandblockPackDependencies {
  cellDatIds: number[];
  portalDatIds: number[];
  renderableAssetIds: string[];
  missing: MissingDependency[];
  unsupported: UnsupportedRenderableDid[];
}
```

This replaces frontend graph discovery for landblock-scoped scene content. The frontend or Rust asset layer should still cache renderable subassets by `sourceAssetId`/DID so `gfx-obj` and `setup-model` data shared across landblocks is loaded once and reused.

### Source Diagnostics

Asset DTO diagnostics should be limited to facts the renderer cannot safely infer from the payload. The DTO should report loader/source conditions such as read failures, decode failures, omitted records, unsupported DID families, and source provenance. It should not enshrine renderer-derivable values such as renderable counts, mesh counts, visible counts, or layer totals that the frontend can compute from arrays it already received.

```ts
interface LandblockPackSourceDiagnostics {
  sourceRecords: SourceRecordDiagnostic[];
  omissions: SourceOmissionDiagnostic[];
  errors: SourceLoadError[];
}
```

Examples of valid source diagnostics:

- `XXYYFFFF` missing or failed to decode.
- `XXYYFFFE` missing or failed to decode.
- an env cell listed by `LandblockInfo.num_cells` failed to load.
- an environment referenced by an env cell failed to load.
- a static DID family is unsupported.
- a setup-model part references a missing gfx object.
- generated scenery skipped a source record because a required source DAT record failed to load.

Examples that should stay out of the asset DTO:

- number of meshes rendered,
- number of visible cells,
- number of render calls or triangles,
- number of static instances in a layer when the array is already present,
- bounds or BVH quality metrics that can be recomputed from prepared geometry.

Do not hide decode/read errors behind empty arrays without source diagnostics. Empty content and failed content must be distinguishable.

## Rust Ownership

The landblock pack assembler should live outside `apps/holtburger-3d/src-tauri` if it can remain app-agnostic. A likely home is `holtburger-content` or `holtburger-core`:

- `holtburger-content` already owns runtime content discovery and static reference-data queries.
- `holtburger-core` already has `StaticOutdoorSceneAssembler`, but the crate boundary says `core` should consume parsed bootstrap/content data rather than archive policy.

Recommended direction:

- Put low-level decode helpers and official DAT structs in `holtburger-dat`.
- Put repository-backed landblock pack assembly in `holtburger-content` if it is primarily static content assembly.
- Move or wrap `StaticOutdoorSceneAssembler` so landblock-pack assembly can reuse it without pushing archive concerns into `core`.
- Keep the Tauri adapter as a narrow serializer/command boundary.

This should be revisited during implementation if current crate dependencies make a clean move too wide for the first slice.

## Frontend Ownership

The frontend should continue to own:

- browser/client scene interest policy,
- LOD radius and streaming policy,
- cache retention policy,
- diagnostic toggles,
- inspector state,
- Three.js GPU object lifecycle,
- material/debug presentation choices,
- render pass composition.

The frontend should stop owning:

- deriving full env-cell landblock closure from an env-cell payload,
- inferring official landblock shape from partially prepared frontend scene assets,
- resolving static DID family semantics,
- expanding setup-model part dependencies for landblock-scoped content,
- terrain mesh generation,
- structured interior geometry preparation,
- static bounds and full landblock BVH construction.

## Dry-Run Findings Against Current Code

This plan was dry-run against the current `apps/holtburger-3d` asset pipeline, Tauri adapter, and crate boundaries. The direction still holds, but several implementation details need to change before the first code slice.

### Contract Shape Is Currently Duplicated

Rust asset lookup returns `serde_json::Value`, and TypeScript validates payloads through hand-written Zod schemas in `apps/holtburger-3d/src/lib/host/contracts.ts`. Adding `landblock-pack/*` means adding another large schema by hand unless we introduce generated/shared DTOs.

Course correction:

- Keep the first pack DTO intentionally small and source-fact focused.
- Do not put full prepared geometry into the first DTO.
- Add the Zod schema only for the manifest/source fields needed by the first migration slice.
- Track generated DTO/schema work as a follow-up if the pack shape grows.

Hard blocker for a large first slice:

- A full renderer-ready pack would require duplicating a very large Rust/TS contract surface immediately.

### Crate Boundary Needs Cleanup Before Shared Assembly

`StaticOutdoorSceneAssembler` currently lives in `holtburger-core` and depends on `holtburger-content::ContentRepository`. `holtburger-content` cannot reuse it without creating a dependency cycle, while putting the landblock pack assembler in the Tauri adapter would trap reusable content logic in the app boundary.

Course correction:

- First extract reusable outdoor static assembly code out of `holtburger-core` or wrap it behind a content-level assembler.
- Prefer `holtburger-content` for `LandblockPackAssembler` if it remains static content assembly.
- Keep Tauri responsible only for parsing asset ids and serializing the pack response.

Hard blocker:

- A clean shared `LandblockPackAssembler` cannot reuse the existing outdoor static assembler from `holtburger-content` until the dependency direction is fixed.

### Tauri Adapter Has Private Serialization Logic

The Tauri adapter currently owns many serializer helpers for env cells, environments, gfx objects, setup models, BSP nodes, placement transforms, and outdoor static scene payloads. A pack assembler outside the adapter needs those transformations without importing app-local code.

Course correction:

- Move source-fact serialization or DTO construction into reusable Rust modules before adding the full pack route.
- Keep app-local debug stubs in the adapter.
- Avoid making the first pack route a copy-paste of adapter helper code.

### Existing Prepared Asset Model Is Slice-Oriented

`PreparedAssetPayload` has variants for `terrain-landblock`, `outdoor-static-scene`, `indoor-env-cell`, `environment`, `gfx-obj`, and `setup-model`. Scene builders consume maps of those prepared records. A single `landblock-pack` record will not automatically feed `deriveTerrainSceneModel`, `deriveStructuredInteriorSceneModel`, or `deriveStaticRenderableSceneModel`.

Course correction:

- Add a `PreparedLandblockPackPayload` type, but do not require every scene builder to consume it immediately.
- For the first frontend slice, add a narrow read-through adapter that derives existing scene inputs from prepared landblock packs at the scene-model boundary.
- Avoid fanning one pack response into many fake `PreparedAssetRecord`s unless there is a clear cache/debug reason; that would preserve the fragmented model under a new root.
- Extend `AssetResidencyKind` and prepared payload descriptions deliberately. The current `"outdoor-landblock" | "indoor-env-cell" | "unknown"` residency vocabulary does not describe a landblock pack that may classify as outdoor or dungeon after load.

Hard blocker for immediate route switching:

- Request planning can ask for `landblock-pack/*`, but the current render scene derivation cannot render it without new adapter code.

### Focused Bootstrap Requests Are A Separate Path

`createFocusedAssetRequest` currently requests a single `terrain/<landblock>` asset for outdoor bootstrap/focus, while `createSceneCoverageRequests` handles broader coverage. Switching only scene coverage to `landblock-pack/*` would leave the app bootstrapping through the old terrain root.

Course correction:

- Add `formatLandblockPackAssetId` beside the existing landblock asset id helpers.
- Convert focused outdoor bootstrap requests to `landblock-pack/<XXYYFFFF>` when pack-backed terrain is available.
- Keep lower-level `terrain/*` focused requests only for explicit debug/source views during migration.

Hard blocker:

- The old terrain route remains on the normal path until both focused requests and coverage requests understand pack assets.

### Env-Cell Enumeration Needs Shared Helpers

The current adapter already derives `landblockEnvCellIds` from `LandblockInfo.num_cells`, but each env-cell payload ships the full derived array and TypeScript consumes it from several closure helpers. The pack DTO intentionally replaces that array with `firstEnvCellId` plus `numEnvCells`.

Course correction:

- Add shared TypeScript helpers for `formatLandblockPackAssetId`, `deriveFirstEnvCellId`, `deriveLandblockEnvCellId`, and `deriveLandblockEnvCellIds`.
- Add matching Rust helpers/tests near landblock id normalization.
- Convert coverage and scene-model adapters to derive env-cell ids from pack landblock info instead of reading `landblockEnvCellIds`.

Hard blocker:

- Removing `landblockEnvCellIds` from normal loading requires replacing every landblock-closure consumer that currently depends on prepared `indoor-env-cell` payloads.

### Geometry Preparation Is Heavily Worker-Tested

The asset worker currently builds terrain meshes, polygon-set render geometry for `Environment` cell structures, and polygon-set render geometry for `GfxObj`. Tests assert exact positions, normals, UVs, triangles, invalid polygon behavior, and drawing-BSP polygon selection.

Course correction:

- Do not port all geometry preparation to Rust in the first pack slice.
- First land the landblock-rooted source manifest and env-cell inventory fix.
- Port terrain mesh generation first because it is smaller and deterministic.
- Port polygon-set render geometry only after translating the existing TypeScript worker tests into Rust parity tests.

Hard blocker:

- Moving environment/gfx render geometry to Rust without parity tests risks visual regressions and broken portal/cell rendering.

### Static Renderable Assembly Has Renderer-Basis Details

Static renderable scene derivation currently selects setup placement set `0x65`, falls back to placement set `0`, composes parent, instance, part, and scale transforms, and converts AC coordinates/quaternions into Three.js render basis.

Course correction:

- Treat static transform composition as a separate Rust migration slice.
- Before moving it, write contract tests for setup placement selection, generated scenery scale, indoor static placement, and AC-to-render basis conversion.
- Keep material/color/debug choices in TypeScript.

Hard blocker:

- Rust cannot include static instances in a full landblock BVH correctly until transform composition is made authoritative and parity-tested.

### Spatial Index Is Renderer-Local Today

The current render spatial index only supports `terrain`, `structured-cell`, and `portal`. It also relies on renderer chunk transforms owned by the frontend. Rust can provide landblock-local bounds and a full landblock BVH that mirror those chunk-relative semantics, but the current renderer still needs chunk rebasing and frontend visibility policy.

Course correction:

- First emit stable source-space bounds and spatial item ids from Rust.
- Let TypeScript adapt pack spatial items into the existing render spatial index, including AC-source-basis to render-chunk-basis conversion.
- Require Rust full landblock BVH consumption after source-space bounds, stable item identity, static transform parity, and chunk-space adaptation are consumed successfully.

Hard blocker:

- A Rust full landblock BVH cannot replace the current renderer spatial index in one step because chunk transforms, pick policy, and debug masks remain frontend-owned.

### Asset Hydration Policy Must Change In Stages

`classifyAssetHydration` treats scene coverage assets as direct and renderables as graph assets. A pack root should be direct, while heavy renderable dependencies should remain referenced and cached by their own asset ids.

Course correction:

- Add `landblock-pack/` as a direct scene coverage asset.
- In the first slice, let the pack report renderable references while legacy renderable loading continues.
- Extend `getPreparedAssetDependencies` for pack payloads so shared renderable references continue through the existing graph hydration path.
- Only remove setup/gfx graph discovery for landblock-scoped content after pack-prepared static data is complete.

### Source Diagnostics Need A Narrow Contract

The previous plan draft included diagnostics that the renderer can compute from payload arrays. Those should stay out of the DTO.

Course correction:

- Keep only source/loader diagnostics in the pack.
- Compute counts, render stats, cache stats, and visibility metrics in TypeScript debug state.

## Revised Implementation Schedule

The original phase list is still directionally useful, but the safer schedule is:

1. **Contract and assembler prep**: move reusable source-fact DTO construction out of the Tauri adapter and resolve the `StaticOutdoorSceneAssembler` crate-boundary issue.
2. **Manifest-only pack**: add `landblock-pack/*` with `XXYYFFFF`, `XXYYFFFE`, classification, env-cell start/count inventory, outdoor source facts, and source diagnostics. Do not embed prepared render geometry yet.
3. **Frontend compatibility adapter**: teach scene request planning/cache policy to request packs, and add scene-model adapters that can use pack source facts while old asset routes remain available.
4. **Env-cell/environment inclusion**: load all env cells and referenced environments from the pack, but initially preserve the existing worker-prepared geometry path for rendering.
5. **Terrain geometry port**: move terrain mesh preparation to Rust with parity tests.
6. **Polygon-set geometry port**: port environment/gfx render geometry after translating worker tests.
7. **Static transform and renderable dependency port**: move setup/gfx dependency flattening, static placement, and source bounds into Rust.
8. **Spatial item and BVH port**: emit source-space spatial items, build a Rust full landblock BVH over all valid-bounds items, and consume it for pack-backed broadphase once TypeScript consumption of bounds and identities is stable.
9. **Legacy route retirement**: remove or reclassify old routes only after pack-backed rendering covers outdoor terrain, dungeons, linked interiors, and static renderables.
10. **Cleanup and naming pass**: remove migration-only shims, legacy smells, obsolete abstractions, misleading names, and duplicated helper paths after pack-backed rendering is the normal path.

### Phase 1: Add Rust Landblock Pack Assembly Behind Existing UI

Status: completed.

- Add `LandblockPackAssembler` with tests against repo-local HBA fixtures.
- Load `XXYYFFFF` and optional `XXYYFFFE`.
- Expose `firstEnvCellId`, `numEnvCells`, terrain summary, explicit objects, buildings, generated scenery source omissions/errors, and outdoor/dungeon classification.
- Add a Tauri lookup route for `landblock-pack/<XXYYFFFF>`.
- Add Rust and TypeScript helper tests for landblock pack id formatting and env-cell id derivation from start/count.
- Keep `terrain/*`, `outdoor-static-scene/*`, `indoor-env-cell/*`, and `environment/*` unchanged.

Exit criteria:

- Requesting a known outdoor landblock returns terrain and outdoor source facts.
- Requesting a known dungeon landblock returns env-cell start/count metadata from `LandblockInfo.num_cells`.
- Missing `XXYYFFFE` is represented as partial source diagnostics, not a silent empty pack.

Implemented:

- Added `holtburger-content::LandblockPackAssembler`.
- Moved `StaticOutdoorSceneAssembler` from `holtburger-core` into `holtburger-content` so pack assembly can reuse outdoor static assembly without a dependency cycle.
- Added `landblock-pack/<XXYYFFFF>` Tauri asset lookup.
- Added first-class TypeScript contract and prepared payload support for `landblock-pack`.
- Added TypeScript helpers for `formatLandblockPackAssetId`, `deriveFirstEnvCellId`, `deriveLandblockEnvCellId`, and `deriveLandblockEnvCellIds`.
- Added `landblock-pack/` as a direct scene coverage asset family.
- Added dependency extraction so pack renderable references flow through the existing shared renderable graph hydration path.

Payload now includes:

- normalized `landblockId` and `landblockInfoId`,
- `"outdoor" | "dungeon"` classification,
- `CellLandblock` source facts,
- `LandblockInfo` source facts with `firstEnvCellId` and `numEnvCells`,
- outdoor explicit object, building, and generated scenery facts,
- source record diagnostics and source load errors,
- renderable dependency asset ids by reference.

Intentionally still empty or unprepared:

- env-cell and environment facts,
- prepared terrain/interior geometry,
- static transform/bounds products,
- spatial items and BVH.

Decisions and course corrections:

- The assembler home is now settled for this slice: `holtburger-content` owns static content assembly, while `apps/holtburger-3d/src-tauri` remains the serializer/asset-route boundary.
- `holtburger-core` no longer owns `StaticOutdoorSceneAssembler`; this better matches the crate-boundary rule that content discovery belongs in `holtburger-content`.
- The first DTO includes the top-level `prepared` object, but all prepared fields remain empty/null until later phases. This keeps the envelope stable without pretending geometry has moved.
- `landblock-pack` dependencies are exposed through `dependencies.renderableAssetIds`; heavy `gfx-obj` and `setup-model` payloads are still loaded once through their existing asset ids.
- Current tests validate source manifest shape and dependency plumbing, not render behavior. Normal scene loading still uses legacy routes.

Validation performed:

- `cargo test -p holtburger-content landblock_pack --lib`
- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml landblock_pack_lookup_returns_manifest_source_facts`
- `npm run test:ts -- src/lib/landblocks.test.ts src/lib/assets/dependencies.test.ts`
- `cargo check --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`
- `npm run check`
- `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D warnings`

### Phase 2: Load Env Cells And Environments From The Pack

Status: completed.

- Extend the assembler to load all env cells listed by `LandblockInfo.num_cells`.
- Load referenced environments and selected cell structures.
- Preserve env-cell portals, visible cells, static objects, surfaces, placements, and restriction objects.
- Add fixtures for a dungeon and an outdoor-with-interior landblock if available.

Exit criteria:

- Dungeon browser focus can request one `landblock-pack/*` and get the full env-cell inventory.
- Outdoor landblock interior inspection no longer needs a building portal seed before it can know env-cell inventory.

Implemented:

- Added content-level `LandblockInteriorFacts`, `EnvCellFact`, `EnvCellPortalFact`, `IndoorStaticObjectFact`, and `EnvironmentFact`.
- `LandblockPackAssembler` now enumerates `XXYY0100..XXYY0100 + num_cells - 1` from `LandblockInfo.num_cells` and attempts to load every listed env cell.
- Env-cell source facts now preserve local placement, surface ids, visible cell ids, portal raw fields, outside-transition classification from portal flag `0x4`, static object references, `seenOutside`, and restriction object id.
- The assembler now loads referenced portal DAT `Environment` records and includes only the selected cell structures referenced by loaded env cells.
- The pack dependency inventory now includes loaded env-cell cell DAT ids and referenced environment portal DAT ids.
- Pack renderable dependencies now include supported indoor static object renderable references, while shared `gfx-obj/*` and `setup-model/*` payloads remain separately keyed and graph-hydrated.
- The Tauri adapter serializes the new interior facts as part of `sourceFacts.interiors`.
- TypeScript contract and prepared payload shapes now preserve pack interior facts. The renderer still uses the old worker-prepared env-cell/environment routes until later phases consume pack geometry.

Decisions and course corrections:

- Environment facts are intentionally narrowed to selected cell structures instead of serializing every cell structure in each referenced environment. This keeps Phase 2 aligned with the current renderer need and avoids turning the pack into a broad portal-DAT export format.
- Full cell-structure schemas were not duplicated into the early landblock-pack TypeScript contract. `cellStructures` remains opaque in the pack contract until Phase 3 decides whether pack-backed geometry is consumed as raw source structures or Rust-prepared meshes.
- The pack uses `targetEnvCellId: null` for portal flag `0x4` outside transitions and preserves the raw `otherCellId`/`otherPortalId` fields for diagnostics.
- Missing env cells or environments are reported through source diagnostics. They produce partial packs rather than silently masquerading as empty interior content.
- The normal scene-loading route still uses legacy `indoor-env-cell/*` and `environment/*` requests. Phase 2 only makes the pack authoritative enough for the later frontend route switch.

Validation performed:

- `cargo test -p holtburger-content landblock_pack --lib`
- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml landblock_pack_lookup_returns_manifest_source_facts`
- `npm run test:ts -- src/lib/assets/dependencies.test.ts src/lib/landblocks.test.ts`
- `cargo check --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`
- `npm run check`
- `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D warnings`

### Phase 3: Move Current Asset Worker Geometry Preparation To Rust

Status: completed.

- Move terrain mesh preparation from the asset worker into Rust for landblock packs.
- Move environment/cell-structure geometry preparation into Rust.
- Keep old worker paths temporarily for parity tests and rollback.
- Compare prepared mesh counts, bounds, and representative vertex/triangle counts in tests/debug validation, not as asset DTO diagnostics.

Exit criteria:

- The frontend can render terrain and structured interiors from pack-prepared geometry.
- TypeScript no longer needs to decode or prepare normal landblock terrain/interior geometry for pack-backed scenes.

Implemented:

- Added content-level prepared geometry DTOs for terrain meshes, selected interior cells, polygon-set render geometry, render triangles, invalid polygon witnesses, render-space bounds, and simple vectors.
- `LandblockPackAssembler` now builds Rust-prepared terrain mesh data from `CellLandblock` facts using the same row/column normalization and split-direction rule previously implemented in the asset worker.
- `LandblockPackAssembler` now builds Rust-prepared structured interior render geometry for loaded env cells whose referenced environment and selected cell structure were available.
- Interior render geometry now follows the existing renderer basis: render-space `x` is AC `x`, render-space `y` is AC `z`, and render-space `z` is negative AC `y`.
- Environment cell-structure rendering uses drawing-BSP polygon membership when present, preserves skipped/invalid polygon witnesses, emits surface ids, and computes render-space bounds.
- The Tauri adapter now serializes `prepared.terrainMesh` and `prepared.interiorCells` inside `landblock-pack/*`.
- The TypeScript contract and prepared payload model now validate and preserve those Rust-prepared geometry products.
- Terrain and structured-interior scene model derivation can read through cached landblock packs without fanning one pack into fake `terrain/*`, `indoor-env-cell/*`, or `environment/*` prepared records.
- Legacy worker geometry paths remain for lower-level debug/source routes and parity fallback.

Decisions and course corrections:

- Pack-prepared interior geometry is emitted per env cell rather than as standalone prepared environment assets. This matches the landblock pack ownership model and avoids recreating the old `environment/*` asset root under a new name.
- The pack still includes selected raw `EnvironmentFact.cellStructures` as source facts from Phase 2, but Phase 3 rendering consumes Rust-prepared `interiorCells`. Future work should avoid expanding the frontend raw cell-structure schema unless a debug/source view specifically needs it.
- Pack-backed portal data has `targetEnvCellId: null` for outside-transition portals, but the current `StructuredInteriorCell` portal contract still expects a numeric target. The scene adapter preserves old renderer compatibility by deriving a numeric fallback target for that legacy field while retaining the authoritative outside-transition flag in the pack payload.
- The worker-side terrain and polygon-set preparation code was not removed yet because legacy routes still depend on it and request planning has not switched to packs by default.
- The Phase 3 renderer read-through is intentionally narrow. It proves pack-prepared terrain and interiors can render when packs are cached, but Phase 6 still owns switching normal scene request planning to pack roots.

Validation performed:

- `cargo test -p holtburger-content landblock_pack --lib`
- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml landblock_pack_lookup_returns_manifest_source_facts`
- `npm run test:ts -- src/lib/assets/dependencies.test.ts src/lib/landblocks.test.ts src/lib/world-display/terrain-scene.test.ts src/lib/world-display/structured-interior-scene.test.ts`
- `cargo check --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`
- `npm run check`
- `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D warnings`

### Phase 4: Move Static Renderable Resolution And Bounds To Rust

Status: completed.

- Resolve static source DIDs from outdoor and indoor static instances.
- Load setup models and gfx objects needed by the landblock pack.
- Flatten setup-model part dependencies.
- Compute conservative bounds for static instances and renderable source geometry.
- Emit unsupported/missing renderable source diagnostics.

Implemented:

- `LandblockPreparedFacts` now includes typed `outdoorStaticInstances` and `staticMeshes` products instead of empty placeholder arrays.
- Rust collects renderable static instances from explicit outdoor objects, outdoor buildings, generated scenery, and landblock env-cell static objects.
- Rust loads setup models and gfx objects needed by those static instances, flattens setup-model parts into per-gfx render mesh records, and emits `gfxObjAssetId` references instead of inlining heavy gfx geometry.
- Rust selects setup-model default placement frames using the same precedence the frontend used: placement key `0x65`, then key `0`, then the lowest available key.
- Rust computes gfx source render bounds from the existing polygon-set render geometry path and emits conservative per-instance bounds for flattened static mesh records.
- The Tauri adapter serializes the new prepared static records through the `landblock-pack` payload.
- The frontend DTO/schema/types now model prepared static instances and static meshes directly instead of accepting `unknown[]`.
- Static renderable scene derivation consumes pack-prepared static meshes when a pack is cached, while still using shared `gfx-obj/*` assets for actual Three.js geometry.
- Pack-backed static rendering bypasses TypeScript setup-model part walking for those landblock-scoped instances; legacy `outdoor-static-scene/*` and `indoor-env-cell/*` paths still use the old path until request planning switches to packs.

Decisions and course corrections:

- The pack still does not duplicate full `gfx-obj` vertex buffers or setup-model source payloads. Static mesh records carry placement, scale, flattened part identity, source asset ids, and bounds only.
- `prepared.outdoorStaticInstances` currently contains all prepared static instances, including indoor static instances. The name came from the earlier placeholder and should be renamed before the contract hardens.
- Bounds live on flattened static mesh records, not on the coarse static instance list, because mesh parts are the first records with a concrete source gfx object and trustworthy source render bounds.
- Per-instance bounds are intentionally conservative and derived from source render bounds plus placement/scale. Phase 5 should decide whether static BVH items use these render bounds directly or a tighter source-space bounds path.
- Missing setup-model/gfx records are reported as source diagnostics and the affected static mesh is omitted. Rendering can still proceed for other static instances.
- The frontend skips legacy static source collection for landblocks/env cells that already have pack-prepared static instances, preventing duplicate static renderables while both paths coexist.

Validation performed:

- `cargo test -p holtburger-content landblock_pack --lib`
- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml landblock_pack_lookup_returns_manifest_source_facts`
- `npm run test:ts -- src/lib/assets/dependencies.test.ts src/lib/world-display/static-renderables.test.ts`
- `cargo check --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`
- `npm run check`
- `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D warnings`

Exit criteria:

- Static renderable scene derivation consumes pack-prepared static instance records.
- Setup-model-to-gfx dependency walking is no longer needed in TypeScript for landblock-scoped content.

### Phase 5: Add Pack Spatial Items And Full Landblock BVH

Status: completed.

- Emit a flat spatial item list first if needed.
- Include terrain, env cells, portals, outdoor statics, buildings, and indoor statics as separate item kinds where bounds are available.
- Build one Rust primary static landblock BVH over all immutable spatial items with valid bounds.
- Support item-kind masks for mixed queries instead of generating separate BVHs per feature.
- Update frontend render spatial index population to consume pack spatial data.
- Replace or bypass frontend-derived broadphase for pack-backed content by consuming the Rust-built full landblock BVH after chunk-space adaptation is proven.
- If an item kind lacks valid bounds in the first implementation, omit that kind from the BVH temporarily while still emitting its spatial item metadata when possible.

Exit criteria:

- Browser picking/debug inspection can use pack-provided spatial metadata for pack-backed scene content.
- Pack-backed ray-pick/frustum broadphase consumes the Rust-built full landblock BVH for every included item kind with valid bounds.
- Env-cell/residency queries use the BVH only for candidate lookup; cell/BSP/portal semantics remain the final authority.
- Terrain grid, cell BSP, and portal geometry remain available for domain-specific narrowphase checks after BVH candidate selection.
- Missing bounds degrade to render-only, not broken rendering.

Implemented:

- `LandblockPreparedFacts` now emits typed `spatialItems` and `staticLandblockBvh` products.
- Rust creates spatial items for terrain, prepared env cells, outdoor statics, buildings, and indoor statics where bounds are available.
- Rust builds one mixed static-landblock BVH over all valid spatial items. BVH nodes carry bounds, child indices, leaf item indices, and a kind mask for future masked broadphase queries.
- Static BVH items are part-level for renderable statics so picking can resolve a concrete gfx part while UI selection can still recover the owning static instance from the item id and owner/source fields.
- The Tauri adapter serializes spatial items and BVH nodes through the `landblock-pack` payload.
- The frontend contract now models spatial items and the static landblock BVH directly instead of carrying `unknown[]`/`null` placeholders.
- `BrowserWorldDisplay` registers a landblock-pack spatial owner so pack spatial items participate in the render spatial index alongside terrain, structured interiors, and debug overlays.
- The render spatial adapter consumes the pack BVH for item ordering and pack item coverage, then adapts items into the current renderer chunk-local spatial index.

Decisions and course corrections:

- The emitted coordinate space is named `landblock-render-local`, not plain AC source space. This reflects the renderer-ready axis basis already used by prepared terrain, interior geometry, and static mesh bounds: x is AC x, y is vertical, and z is negative AC y. This avoids hiding an axis conversion inside the frontend spatial adapter.
- Portal spatial items are not emitted yet. Phase 5 only includes item kinds with available bounds; portal polygon bounds need a dedicated derivation from prepared cell portal polygons before they can join the BVH honestly.
- The current frontend query object is still the existing render spatial index. It now receives pack spatial items and traverses the pack BVH to adapt item coverage, but the low-level ray/frustum query implementation remains the existing renderer index until Phase 6/7 removes duplicate legacy owners and can switch broadphase authority cleanly.
- `staticLandblockBvh` replaces the older `staticInstanceBvh` placeholder name because the tree is intentionally mixed landblock content, not a static-instance-only tree.

Validation performed:

- `cargo test -p holtburger-content landblock_pack --lib`
- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml landblock_pack_lookup_returns_manifest_source_facts`
- `npm run test:ts -- src/lib/assets/dependencies.test.ts src/lib/world-display/render-spatial-scene.test.ts src/lib/world-display/static-renderables.test.ts`
- `cargo check --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`
- `npm run check`
- `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D warnings`

Refinements from Phase 4:

- Use Phase 4 `PreparedStaticMesh.instanceBounds` as the first static item bounds source, but treat it as a conservative render broadphase until tighter source-space transform parity is proven.
- Keep static spatial items reference-based. `PreparedSpatialItem.sourceAssetId` should point at shared `gfx-obj/*` or `setup-model/*` ids, not inline geometry.
- Decide whether the BVH should index static mesh parts individually or group them by static instance. Mixed queries likely need part-level candidates for picking and instance-level grouping for UI selection; the item id should make both recoverable without a second heavy structure.
- Rename `outdoorStaticInstances` before the pack contract hardens further; Phase 5 spatial generation now consumes all static meshes without relying on that misleading field name.

### Phase 5.1: Subdivide Terrain Spatial Items

Status: completed.

Phase 5 currently emits one `terrain` spatial item for the whole landblock terrain mesh. That is enough to include terrain in the mixed landblock BVH, but it is coarse for ray picking, frustum broadphase, occluder discovery, and terrain-candidate lookup.

Refine terrain spatial metadata to emit `8 x 8` terrain-quad spatial items:

- Keep terrain rendering as one mesh per landblock. Spatial subdivision must not imply rendering the terrain as 64 separate meshes.
- Emit one terrain spatial item per rendered terrain quad, using the four corner heights from the `9 x 9` terrain sample grid.
- Give terrain-quad item ids a stable shape that encodes landblock id plus row/col or quad index.
- Store enough metadata to recover the two terrain triangle indices for narrowphase checks.
- Add the terrain-quad items to the same mixed static-landblock BVH with kind `terrain`.
- Keep the landblock-level terrain mesh and GPU upload path unchanged unless profiling proves render subdivision is needed.

Exit criteria:

- BVH terrain candidates are terrain quads, not whole landblocks.
- Terrain ray-pick/frustum broadphase can use quad-level candidates before running terrain triangle/grid narrowphase.
- Terrain render batching remains one mesh per landblock.

Implemented:

- Rust now emits one `terrain` spatial item per terrain quad instead of one whole-landblock terrain item.
- Terrain quad bounds are computed from the four prepared terrain mesh vertices using the same `landblock-render-local` axis basis as the rest of the pack spatial data.
- Terrain quad item ids use `landblock-pack/<XXYYFFFF>/spatial/terrain/quad/<row>/<col>`, where row and col are stable zero-based terrain quad coordinates.
- Each terrain quad spatial item carries typed metadata with row, col, quad index, and the two prepared terrain triangle indices needed by future terrain narrowphase checks.
- Terrain quad items participate in the existing mixed `staticLandblockBvh` under the normal `terrain` kind mask bit.
- The landblock terrain mesh and renderer GPU upload path remain unchanged; this phase only subdivides spatial broadphase products.
- The frontend pack spatial adapter preserves terrain quad metadata in terrain spatial metadata so later pick/frustum code can recover the exact terrain quad and triangle candidates.

Decisions and course corrections:

- Terrain subdivision is a spatial-indexing concern, not a render-batching change. Keeping one terrain mesh per landblock avoids prematurely adding 64 draw surfaces per landblock.
- The metadata is modeled as a typed spatial-item metadata union instead of terrain-only nullable fields on every spatial item. Non-terrain items explicitly carry `metadata.kind = "none"`.
- The existing renderer spatial index still performs the immediate query work. The pack BVH now contains finer terrain candidates, and the frontend adapter carries enough metadata for a later direct Rust-BVH masked-query path.

Validation performed:

- `cargo test -p holtburger-content landblock_pack --lib`
- `cargo test --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml landblock_pack_lookup_returns_manifest_source_facts`
- `npm run test:ts -- src/lib/world-display/render-spatial-scene.test.ts src/lib/world-display/render-spatial-index.test.ts`
- `npm run test:ts -- src/lib/assets/dependencies.test.ts src/lib/world-display/render-spatial-scene.test.ts src/lib/world-display/render-spatial-index.test.ts src/lib/world-display/static-renderables.test.ts`
- `cargo check --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml`
- `npm run check`
- `cargo clippy --manifest-path apps/holtburger-3d/src-tauri/Cargo.toml --all-targets -- -D warnings`

Refinements for later phases:

- Terrain narrowphase should use the quad metadata first, then test only the two prepared terrain triangles for that quad.
- Direct Rust-BVH traversal should support kind-mask pruning before expanding items into the existing frontend spatial index.
- If profiling later shows terrain draw-call or culling pressure, render subdivision can be considered separately from this spatial subdivision.

### Phase 6: Switch Scene Request Planning To Landblock Packs

- Change outdoor and dungeon browser focused requests and scene coverage to request `landblock-pack/*` by landblock interest sets.
- For dungeon focus, request the focused landblock pack and render its env-cell inventory.
- For outdoor focus, request landblock packs in the terrain/building/detail interest sets, then apply frontend policy to decide which prepared facts render.
- Keep lower-level routes available for debug panels and tests.

Exit criteria:

- The old env-cell-seed landblock closure workaround is removed from normal browser scene loading.
- `LandblockInfo.num_cells` is the only normal source of landblock env-cell inventory.
- Existing browser workflows still support outdoor focus, dungeon focus, and linked interiors.

### Phase 7: Retire Or Reclassify Legacy Scene Assets

- Decide which old routes remain as debug/source views:
  - `terrain/*`
  - `outdoor-static-scene/*`
  - `indoor-env-cell/*`
  - `environment/*`
- Remove frontend dependency graph code that only exists for landblock-scoped scene discovery.
- Keep reusable low-level renderable asset loading if needed for non-landblock objects, avatars, dynamic entities, or future equipment rendering.

Exit criteria:

- Landblock-scoped rendering uses packs by default.
- Legacy routes are documented as debug/source endpoints or removed.

### Phase 8: Cleanup Legacy Smells And Migration Scaffolding

This is the running cleanup punch list. Add to it whenever a phase leaves behind a temporary adapter, legacy naming mismatch, duplicated helper, or migration-only abstraction.

Initial cleanup targets:

- Remove normal-path use of `terrain/*`, `outdoor-static-scene/*`, `indoor-env-cell/*`, and `environment/*` where `landblock-pack/*` has replaced them.
- Rename remaining "outdoor" helper names that now mean generic landblock behavior, such as `normalizeOutdoorLandblockId` or `formatOutdoorStaticSceneAssetId`, where they survive beyond debug/source routes.
- Remove env-cell-seed closure helpers once `LandblockInfo.firstEnvCellId` and `numEnvCells` are the normal source of env-cell inventory.
- Remove `landblockEnvCellIds` from normal prepared env-cell payloads after pack-backed closure is consumed everywhere.
- Remove fake or compatibility `PreparedAssetRecord` fan-out if any was introduced during scene-model migration.
- Collapse duplicated Rust/TypeScript landblock id and env-cell enumeration helpers into one canonical helper per side.
- Revisit `AssetResidencyKind` naming once `landblock` is the primary scene residency and `outdoor-landblock`/`indoor-env-cell` are no longer normal scene roots.
- Remove obsolete worker geometry preparation paths after Rust-prepared terrain, environment, and gfx geometry are trusted.
- Remove stale tests that encode legacy request sequencing instead of pack-backed behavior.
- Revisit debug panel labels so old asset-family names are presented as source/debug routes, not primary scene-loading concepts.
- Remove duplicated env-cell serialization paths after pack-backed interiors replace normal `indoor-env-cell/*` loading.
- Replace the legacy indoor static object source-asset formatting path with the content-level helper everywhere it survives.
- Decide whether pack `EnvironmentFact.cellStructures` should become a fully typed frontend contract or disappear behind Rust-prepared interior meshes in Phase 3.
- Revisit source fact naming before route retirement: `interiors` currently means landblock env-cell facts, not a separate official indoor asset family.
- Remove worker terrain preparation once `terrain/*` is retired or reclassified as a debug/source route.
- Remove worker environment polygon-set preparation once `environment/*` is retired or reclassified as a debug/source route.
- Split `StructuredInteriorCell` portal typing so outside-transition portals do not need a legacy numeric `targetEnvCellId` fallback.
- Consider moving prepared geometry serialization out of the Tauri adapter if more prepared pack products are added; the adapter is starting to accumulate DTO serialization weight again.
- Add direct scene-model tests for pack-backed terrain and structured-interior read-through before Phase 6 makes packs the normal request path.
- Tighten contracts and interfaces after each migration slice so fields that are required in practice are not left optional/nullish by DTO inertia. Audit `null`, `undefined`, optional properties, `unknown[]`, and broad unions in pack/prepared/render scene interfaces, and split types when only some variants genuinely allow absence.
- Rename `prepared.outdoorStaticInstances` to a generic static-instance field now that Phase 4 includes indoor statics in the same prepared list.
- Remove `StaticRenderableSourceInstance.preparedByPack` once scene derivation is pack-first by request planning rather than a read-through adapter layered over legacy source collection.
- Move or share prepared static DTO serialization if the Tauri adapter continues accumulating landblock pack serializer functions.
- Add focused tests for pack-backed static renderable consumption in indoor and outdoor-linked-interior scenes beyond the initial outdoor duplicate-suppression coverage.
- Add portal polygon spatial item derivation once prepared portal geometry has trustworthy bounds and target metadata.
- Collapse duplicate terrain/env-cell spatial owners once landblock-pack request planning is the normal path; today pack-backed terrain/env-cell spatial items can coexist with legacy-derived owner items during migration.
- Replace the current render spatial adapter's BVH-to-item expansion with direct Rust-BVH masked query traversal after duplicate legacy owners are retired.
- Audit `landblock-render-local` naming against any future non-render consumers. If physics/collision wants raw AC source-space bounds, split spatial products instead of overloading this coordinate space.
- Revisit `PreparedSpatialItem.metadata.kind = "none"` during contract tightening. It is explicit and honest for the current mixed list, but a discriminated spatial-item union may become cleaner once more item kinds gain item-specific metadata.
- Remove or rename legacy whole-terrain spatial item assumptions in frontend tests and helpers once pack-backed terrain replaces `terrain/*` as the normal scene source.

Exit criteria:

- Normal scene loading has one clear landblock-pack path.
- Legacy source/debug routes are either intentionally documented or deleted.
- No migration-only shims remain in request planning, cache policy, prepared payload conversion, or scene derivation.
- Naming reflects official landblock semantics instead of the old outdoor-vs-env-cell discovery model.

## Testing Strategy

Rust tests:

- Landblock id normalization to `XXYYFFFF`.
- Landblock info id derivation to `XXYYFFFE`.
- Env-cell id enumeration from `num_cells`.
- Classification for outdoor and dungeon cases.
- Source diagnostics for missing, corrupt, or partial source records.
- Preservation of building portal linked env-cell ids and outside-transition flags.
- Missing and unsupported DID source diagnostics.
- Pack dependency inventory.
- Terrain mesh bounds and triangle counts.
- Environment/cell-structure geometry bounds.
- Static instance bounds and transform composition.

TypeScript tests:

- Landblock pack asset id formatting and env-cell id derivation from `firstEnvCellId`/`numEnvCells`.
- Focused bootstrap requests use `landblock-pack/*` once pack-backed terrain is enabled.
- Request planner asks for `landblock-pack/*` roots by interest set.
- Dungeon input selects a landblock pack rather than an env-cell root.
- Outdoor landblock policies render only the selected interest layers while using pack discovery.
- Cache pruning treats pack assets as scene coverage roots.
- Pack payload dependencies expose shared renderable asset ids without duplicating renderable payloads.
- Existing debug views can still inspect env cells and environments during migration.

Integration/manual validation:

- Known outdoor terrain landblock renders.
- Known pure dungeon renders without manually selecting `XXYY0100`.
- Known outdoor building interior landblock exposes env cells from `XXYYFFFE`.
- Static renderables still appear for outdoor explicit objects, buildings, generated scenery, and indoor static objects.
- Source diagnostics distinguish missing content from empty content.

## Risks And Course Corrections To Watch

- Pack payloads may become too large if heavy renderable geometry is embedded eagerly. The normal pack must reference shared renderable assets instead of inlining them.
- Moving `StaticOutdoorSceneAssembler` across crate boundaries may reveal dependency direction problems. Prefer a small, clean content-level assembler over pushing archive policy into `core`.
- Some outdoor landblocks contain env cells that should not all render in normal outdoor mode. The pack should load/discover them; frontend policy should decide visibility.
- The first BVH shape may be overdesigned. A flat spatial item list with stable ids and bounds is an acceptable first step, but the pack-backed target is a full landblock BVH over all item kinds with valid bounds once transform and identity boundaries are stable.
- Setup-model/gfx geometry can be shared across many landblocks. Avoid duplicating large immutable source geometry in landblock packs; emit references plus prepared per-instance transforms and bounds where practical.

## Open Questions

- What is the exact shared renderable cache boundary for Rust-prepared `gfx-obj` and `setup-model` data?
- Should pack loading have explicit profiles such as `manifest`, `geometry`, and `debug-full`, or is one complete profile acceptable for the current browser/debug client?
- Which lower-level routes should remain user-visible diagnostics after the pack migration?
- How much portal visibility preprocessing belongs in the pack versus in renderer/runtime policy?

Answered decisions:

- The pack assembler lives in `holtburger-content` for the current architecture.
- Outdoor static content assembly also lives in `holtburger-content`; `holtburger-core` should not own repository-backed static content discovery.

## Recommended First Slice

Start with a manifest-heavy `landblock-pack/*` that reads `XXYYFFFF`, `XXYYFFFE`, exposes env-cell start/count metadata from `num_cells`, classifies the landblock, and includes outdoor static facts by reusing existing assembly logic.

Do not move all geometry or BVH work in the first slice. The first slice should prove the official landblock-rooted discovery model and remove the need to seed dungeon or outdoor-interior landblock loading from an env cell. Once that contract is stable, move geometry preparation and spatial indexing into Rust in controlled follow-up slices.
