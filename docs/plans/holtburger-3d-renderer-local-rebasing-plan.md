# Holtburger 3D Renderer-Local Rebasing Plan

Status: Phase 9 complete; renderer-local rebasing spike is complete.

Implementation note: update this plan after each completed phase with progress, decisions, course
corrections, and any needed adjustment to later phases.

## Purpose

Make the existing focus-relative renderer behavior explicit and maintainable before browser
walkabout work grows around it.

The current browser world display already places outdoor terrain relative to a focus landblock.
That is the right broad direction, but the ownership model is implicit and scattered across terrain
scene derivation, static renderable placement, structured-interior placement, camera hints, debug
overlays, and the render spatial index. This plan introduces a landblock-root model so rebasing is a
known renderer operation rather than an accidental side effect of recomputing offsets.

## Goals

- Keep render coordinate anchoring frontend-owned.
- Use AC's natural landblock partitioning as the renderer chunk model.
- Keep chunk-local geometry stable when the active render anchor changes.
- Keep the render spatial index renderer-local only.
- Preserve current browser free-camera behavior while making future walkabout/client mode focus
  ownership straightforward.
- Avoid moving browser-mode policy into `WorldDisplay`.
- Treat static renderable chunk partitioning as a major renderer batching change, not as incidental
  cleanup.

## Non-Goals

- Do not make Rust publish a render origin.
- Do not introduce an authoritative AC-space geometry index in TypeScript.
- Do not implement full walkabout, collision, portal traversal, or residency solving.
- Do not implement per-instance culling as part of this work. Chunk-level culling for instanced
  groups is in scope if static renderable batches are partitioned by render chunk.
- Do not prove floating-origin precision issues from first principles. The current implicit
  focus-relative renderer is enough justification.

## Current Code Shape

- `BrowserWorldDisplay` is the browser composition root. It owns browser mode state, camera state,
  diagnostic selection, asset-derived scene models, and concrete render spatial index construction.
- `WorldDisplay` owns Three.js object lifecycle, camera application, render metrics, viewport ray
  construction, neutral picking, and non-instanced spatial visibility toggles.
- `deriveTerrainSceneModel` already derives terrain offsets by comparing each terrain landblock to
  the focus landblock.
- `deriveStaticRenderableSceneModel` and `deriveStructuredInteriorSceneModel` also receive or derive
  focus-landblock-relative offsets for outdoor-linked content.
- `RenderSpatialIndex` currently stores flattened renderer-space bounds and pick shapes.
- `buildCameraHintFromSceneCameraFrame` currently converts Three vectors directly into AC-shaped
  vectors without accounting for a render anchor.
- Static renderables currently batch instances by render asset. This is efficient for draw-call
  count, but it does not fit root-only rebasing or chunk-level culling because one `InstancedMesh`
  can contain instances from multiple landblocks.

## Codebase Dry-Run Findings

- The current renderer is layer-rooted, not chunk-rooted. `WorldDisplay` owns broad roots for
  terrain, static renderables, structured interiors, and debug overlays. A chunk-root manager should
  be introduced before migrating individual layers so each layer does not invent its own root map.
- Focus-relative offsets are already baked into scene models through fields such as
  `worldOffsetX`/`worldOffsetY` and `landblockWorldOffset`. Rebasing should not add a second offset
  path beside those fields. The first migration should introduce chunk identity and chunk-local
  placement helpers, then retire or narrow the old focus-relative fields as layers move.
- Static renderable matrices currently include `landblockWorldOffset` inside each instance matrix.
  Partitioning by chunk must happen before static renderables can participate honestly in root-only
  rebasing.
- The render spatial index currently stores flattened renderer-space bounds. Converting it directly
  to chunk-local bounds before scene models expose chunk keys would create awkward adapter code.
  Scene models should gain chunk ownership first, then the index should follow.
- Debug overlays are recreated wholesale when their scene changes. When debug objects move under
  chunk roots, disposal must clear only debug objects/layer children, not the chunk roots themselves.
- Scene bounds and camera auto-fit currently expand broad layer roots. After chunk roots land, bounds
  should expand a shared scene-content root or the active chunk roots rather than each old layer root.
- Static chunk-level culling should start at the group/chunk level. Per-instance static culling stays
  out of scope.

## Core Decisions

### 1. Render Anchor Ownership

The active render anchor is owned above `WorldDisplay`.

Initial owner:

- `BrowserWorldDisplay`, because it already derives `outdoorFocusLandblockId`, owns browser camera
  state, and composes the concrete spatial index.

Future owner:

- A mode-level scene coordinator may replace direct `BrowserWorldDisplay` ownership when browser
  free-camera, browser walkabout, and client mode split further.

`WorldDisplay` should not decide when the focus anchor advances. It should receive enough derived
renderer data to apply the resulting mechanics.

### 2. Focus Source By Mode

The renderer anchor should follow the active mode's focus source:

- Browser free-camera mode: explicit browser focus landblock/destination. Camera movement alone
  should not change focus unless browser mode later adds an explicit follow-camera focus feature.
- Browser walkabout mode: offline Rust simulator residency.
- Future client mode: online runtime/simulator residency.

The renderer-side operation is identical once the owner commits a new focus anchor.

### 3. Rebase Trigger Policy

A rebase is triggered by a committed render focus-anchor change, not by raw camera movement.

The mode owner derives a focus candidate:

- browser free-camera: explicit browser focus landblock/destination
- browser walkabout: virtual player residency from the offline Rust simulator
- client mode: authoritative player residency from the online runtime/simulator

The owner may apply an anchor-relative retain radius before committing a new render anchor. The
current render anchor is the landblock used by the last rebase. If the mode-owned focus landblock is
inside the retain radius, no rebase occurs. If it leaves the retain radius, commit the current
mode-owned focus landblock as the new render anchor and rebase.

Illustration:

```text
current render anchor: DA55
retain radius: 3 landblocks

focus DA56 -> no rebase
focus DA58 -> no rebase if still inside radius
focus DA59 -> rebase to DA59 once outside radius
focus DA58 -> no immediate rebase; the retain radius now follows DA59
```

This differs from fixed global breakpoints. The stable zone moves with the last rebase anchor, so
moving back and forth near an arbitrary boundary does not ping-pong the renderer. It must not turn
`WorldDisplay` into a camera-position watcher.

Default policy:

- explicit browser destination changes commit immediately
- residency source changes use an owner-side retain radius; start with `3` landblocks unless
  implementation testing shows that is too wide or too narrow
- do not use fixed global breakpoints such as "every N landblocks"

### 4. First Anchor Model

Do not start by adding a broad public `SceneRenderFrame` abstraction.

Use a small app-local model or helper shape only where it pays for itself:

```ts
interface RenderLandblockAnchor {
  landblockId: number;
}
```

This can grow later if indoor-only scenes need a richer anchor. For the first pass, dungeons group
under their upper-16-bit landblock.

### 5. Chunk Key

Use landblock-first chunk keys:

```ts
type RenderChunkKey = `landblock/${string}`;
```

The key should be derived from normalized 32-bit landblock identity:

- outdoor terrain: `0x????ffff`
- dungeon/interior: upper-16-bit dungeon landblock normalized to a landblock chunk

Do not add env-cell or environment subchunks until a source-backed need appears.

### 6. Coordinate Layers

Use three coordinate layers deliberately:

- **chunk-local**: geometry and item bounds relative to their owning landblock root.
- **renderer-local**: chunk root transform plus chunk-local coordinates; this is what Three.js sees.
- **canonical metadata**: stable ids such as landblock id, env-cell id, portal id, polygon id.

The render spatial index should not store authoritative AC-space geometry. It may carry canonical
metadata ids for labels and UI actions.

## Target Data Flow

```text
BrowserWorldDisplay / future scene coordinator
  derives active focus anchor
  derives visible/requested landblock chunks
  passes chunked scene models to WorldDisplay
  populates chunked render spatial index

WorldDisplay
  creates one Three.js root per render chunk
  attaches terrain/static/cell/debug objects under chunk roots
  builds static InstancedMesh groups per chunk and render asset
  updates chunk root positions when active anchor changes
  emits/accepts camera frames in renderer-local coordinates

RenderSpatialIndex
  stores item bounds and pick shapes in chunk-local coordinates
  stores one transform per chunk
  transforms render-space rays/frustums into each chunk for queries
  returns render-space hit points plus metadata ids
```

Chunk transforms should be index state, not metadata smuggled through individual items. Static
instanced groups may use chunk/group bounds for visibility without creating one pickable spatial
item per static instance.

Spatial-index rebase ownership:

- `BrowserWorldDisplay` or a future mode scene coordinator owns the rebase commit.
- On commit, the owner derives one chunk-transform set from the new render anchor.
- The owner sends that transform set to `WorldDisplay` for chunk roots and to `RenderSpatialIndex`
  for query transforms.
- `RenderSpatialIndex` owns storing those transforms and applying them internally during queries.
- `WorldDisplay` must not mutate spatial-index transform state directly.

## Rebase Flow

```text
active focus anchor changes
  |
  +-- BrowserWorldDisplay computes old-anchor -> new-anchor transform
  +-- camera frame is converted through stable landblock/canonical coordinates
  +-- WorldDisplay receives updated chunk root offsets
  +-- render spatial index receives updated chunk transforms
  +-- chunk-local geometry remains unchanged
```

Immediate side effects after a committed anchor change:

- landblock root transforms update in `WorldDisplay`
- spatial-index chunk transforms update in `RenderSpatialIndex`
- browser camera frame is rewritten into the new renderer-local coordinates
- diagnostic selection, if retained across rebase, should be retained by stable metadata identity
  only

Non-side effects:

- no full scene rebuild just because the anchor changed
- no asset request just because the anchor changed, unless focus/interest policy also changed
- no Rust API call that names a render origin

Static instanced batches should be partitioned by render chunk and render asset. This preserves
instancing inside each landblock chunk, lets static renderables participate in root-only rebasing,
and creates a natural chunk-level visibility hook. This plan does not require per-instance culling.

## Implementation Phases

### Phase 1: Chunk Identity And Placement Helpers

Status: complete.

Add small helper functions under `apps/holtburger-3d/src/lib/world-display/` or
`apps/holtburger-3d/src/lib/landblocks.ts` if they are landblock-specific:

- derive render chunk key from landblock/env-cell ids
- derive chunk root offset from `chunkLandblockId` and `anchorLandblockId`
- convert a point between chunk-local and renderer-local coordinates
- convert camera frame between old and new anchors
- derive the owning render chunk for terrain tiles, structured cells, debug overlays, and static
  renderable parts

Keep the helpers focused. Do not introduce a broad coordinate-service object.

Tests:

- neighboring outdoor landblock offsets are stable and match current `192` meter expectations
- rebasing from one anchor to an adjacent anchor shifts chunk roots while preserving chunk-local
  positions
- camera frame conversion preserves canonical position across anchor change

Implemented progress:

- Added `apps/holtburger-3d/src/lib/world-display/render-chunks.ts` as the narrow helper module.
- Added `RenderChunkKey`, `RenderLandblockAnchor`, `RenderChunkPlacement`, and a minimal
  render-camera-frame shape without introducing a broad coordinate service object.
- Added helpers for normalized landblock/env-cell chunk keys, chunk landblock identity, chunk root
  offsets, chunk-local/renderer-local point conversion, anchor rebase offsets, and camera frame
  conversion across anchors.
- Added owning-chunk helpers for terrain tiles, structured cells, debug overlays, and static
  renderable parts.
- Added `apps/holtburger-3d/src/lib/world-display/render-chunks.test.ts` covering the Phase 1 test
  cases.

Decisions:

- Helper code lives under `world-display` because the values are renderer-local mechanics, even
  though the underlying identity normalization uses shared landblock helpers.
- Chunk keys normalize all landblock-like ids to upper-16-bit `0x????ffff` chunks. That keeps
  dungeon/interior env cells grouped under their landblock chunk for now.
- Chunk root offsets are emitted in Three.js renderer coordinates: landblock X maps to render X,
  landblock Y maps to negative render Z, and render Y remains vertical.
- Camera frame conversion moves both `position` and `target` by the anchor rebase delta and leaves
  `up` unchanged.

Course corrections:

- The first test run exposed JavaScript `-0` in zero Z offsets. The helper now normalizes `-0` to
  `0` for stable strict equality, debug output, and future transform comparisons.

Validation:

- `npm run test:ts -- src/lib/world-display/render-chunks.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`

Refined follow-up for Phase 2:

- Thread `RenderChunkPlacement` through scene model records while keeping existing flattened
  focus-relative fields as temporary compatibility values.
- Replace local duplicated 192m offset derivation in scene model code with the new helpers when
  adding chunk ownership, but do not migrate renderer roots yet.
- For static renderables, add chunk identity to parts before changing `partsByGfxAssetId`; the
  grouping/batching change remains Phase 7.
- For debug overlays, inherit chunk placement directly from the structured cell model rather than
  deriving it a second time.

### Phase 2: Scene Model Chunk Ownership

Status: complete.

Thread render chunk identity through scene models before changing renderer roots:

- terrain tiles expose their owning chunk key and chunk-local placement
- structured-interior cells expose their owning chunk key and chunk-local placement
- debug overlays inherit chunk ownership from their structured cells/portals
- static renderable parts expose chunk key and are groupable by chunk plus render asset

This phase should reduce the authority of focus-relative fields such as `landblockWorldOffset`.
Where possible, keep old flattened offsets only as temporary compatibility values until the owning
layer is migrated.

Tests:

- existing terrain/static/interior scene tests continue to prove the same visible placement
- each scene item has deterministic chunk ownership
- indoor/dungeon items group under the upper-16-bit dungeon landblock chunk

Implemented progress:

- Threaded `RenderChunkPlacement` through terrain tiles, structured-interior cells, debug cell
  overlays, debug portal overlays, and static renderable parts.
- Added chunk-local placement fields while retaining the old flattened compatibility fields:
  - terrain tiles now expose `chunkLocalOffset` and still expose `worldOffsetX`/`worldOffsetY`
  - structured cells now expose `chunkLocalPlacement` and still expose `localPlacement` plus
    `landblockWorldOffset`
  - debug overlays inherit `renderChunk` and `chunkLocalPlacement` from their structured cell
  - static renderable parts now expose `chunkLocalInstancePlacement` and still expose
    `instancePlacement` plus `landblockWorldOffset`
- Added `partsByRenderChunkAndGfxAssetId` to the static renderable scene model so Phase 7 can move
  batching from global render asset groups to chunk-plus-asset groups without first changing
  renderer roots.
- Replaced local duplicated focus-relative 192m offset math in structured interiors and static
  renderables with the Phase 1 helper path.
- Added `deriveFocusRelativeAcPlacementOffset` to `render-chunks.ts` as the narrow adapter for old
  AC-placement-style compatibility offsets.
- Expanded tests to prove deterministic chunk ownership for terrain, structured interiors, debug
  overlays, and static renderables, including indoor/env-cell grouping under `0x????ffff` chunks and
  static grouping by chunk plus render asset.

Decisions:

- Kept old flattened fields in place because `WorldDisplay`, `render-spatial-scene`, and
  `static-renderable-geometry` still consume flattened renderer placement until later root and
  spatial-index phases.
- Used `renderChunk` as the common field name across scene models so Phase 4 and later renderer
  migration code can consume chunk ownership consistently.
- Left `partsByGfxAssetId` intact for the current renderer. `partsByRenderChunkAndGfxAssetId` is an
  additive staging field, not an active batching change yet.
- Chose a string group key for static chunk-plus-asset grouping via
  `formatStaticRenderableChunkAssetGroupKey`. A richer key object can wait until the renderer needs
  it; the current map is deterministic and simple to assert in tests.

Course corrections:

- The compatibility conversion from Three chunk-root offsets back into AC-placement-style offsets
  initially reintroduced `-0` for unchanged landblock axes. Moving that conversion into
  `deriveFocusRelativeAcPlacementOffset` keeps zero normalization shared and visible.

Validation:

- `npm run test:ts -- src/lib/world-display/terrain-scene.test.ts src/lib/world-display/structured-interior-scene.test.ts src/lib/world-display/static-renderables.test.ts src/lib/world-display/debug-overlays.test.ts src/lib/world-display/render-spatial-scene.test.ts src/lib/world-display/render-chunks.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`

Refined follow-up for Phase 3:

- Lift the existing browser/runtime focus landblock choice into an explicit active render-anchor
  path in `BrowserWorldDisplay`.
- Use the scene models' new `renderChunk` fields to derive the active chunk transform set once per
  committed anchor, but keep `WorldDisplay` and `RenderSpatialIndex` consumption additive until
  their later phases.
- Keep browser free-camera movement from implicitly changing the anchor. Explicit browser
  destination and runtime residency remain the only initial focus sources.
- Do not remove flattened scene-model offsets in Phase 3; they are still needed until chunk roots
  and the chunked spatial index land.

### Phase 3: BrowserWorldDisplay Render Anchor Plumbing

Status: complete.

Make `BrowserWorldDisplay` the initial focus-anchor coordinator before chunk roots or spatial chunk
transforms depend on it.

First pass:

- explicit browser destination continues to define the anchor
- runtime residency continues to define the anchor when no browser destination is active
- browser free-camera may derive a new anchor from the camera only after a deliberate follow-camera
  mode is introduced; do not sneak that policy into this infrastructure pass
- expose the active render anchor to `WorldDisplay` and to render-spatial-index population/update
  code
- derive the chunk-transform set for the active render anchor so `WorldDisplay` and
  `RenderSpatialIndex` consume the same rebase facts
- model the retain-radius policy where residency-backed focus sources will need it, even if the
  first browser pass still changes only on explicit destination/runtime-focus changes

This phase should mostly lift the existing `outdoorFocusLandblockId` into a named render-anchor
coordination path. It should not change scene membership by itself.

Implemented progress:

- Added `apps/holtburger-3d/src/lib/world-display/render-anchor.ts` as the app-local render-anchor
  coordination helper.
- Added explicit render-anchor candidate derivation:
  - browser destinations produce `browser-destination` candidates and commit immediately
  - runtime residency produces `runtime-residency` candidates when no browser destination is active
  - browser free-camera movement is not a focus source
- Added residency retain-radius modeling with a default radius of `3` landblocks and Chebyshev
  landblock distance. Residency-backed candidates inside the radius preserve the current committed
  anchor.
- Added deterministic render chunk transform derivation from a committed `RenderLandblockAnchor`
  plus the scene models' Phase 2 `renderChunk` fields.
- Wired `BrowserWorldDisplay` to own the committed `activeRenderAnchor`, track its source, derive
  active chunk placements from terrain, structured interiors, debug overlays, and static
  renderables, and derive one shared chunk transform set.
- Exposed the active render anchor and chunk transform set to `WorldDisplay` through additive props.
  `WorldDisplay` accepts them but does not apply root transforms yet; that remains Phase 4.
- Kept render-spatial-index item replacement unchanged. The transform set is derived in
  `BrowserWorldDisplay` beside spatial item population so Phase 5 can add an explicit sink without
  re-deriving anchor facts.
- Added tests for explicit browser anchors, runtime-residency fallback anchors, retain-radius
  commits, deterministic chunk transforms, and outdoor coordinate destination resolution.

Decisions:

- `BrowserWorldDisplay` is the concrete owner of the committed anchor for now. The helper module is
  policy-only and does not own state.
- Browser destinations always bypass the retain radius, including indoor env-cell destinations,
  because they are explicit user focus choices.
- Runtime residency uses the retain-radius policy immediately even though the current browser flow
  usually changes focus through explicit destinations. This keeps the future walkabout/client
  behavior modeled without making camera movement a focus source.
- Chunk transforms are sorted and de-duplicated by `chunkKey`; duplicate layer ownership of the same
  chunk does not produce duplicate transforms.
- `WorldDisplay` receives anchor data now but deliberately treats it as inert staging data until the
  chunk-root manager lands.

Course corrections:

- The commit helper was adjusted to preserve the existing anchor object when the candidate
  landblock is unchanged. That prevents Svelte effects from repeatedly committing fresh object
  identities for stable explicit destinations.
- No render-spatial-index transform API was added in this phase. Adding a no-op or partial sink now
  would create misleading ownership; Phase 5 remains the point where transform storage/query
  behavior becomes real.

Validation:

- `npm run test:ts -- src/lib/world-display/render-anchor.test.ts src/lib/world-display/render-chunks.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`

Refined follow-up for Phase 4:

- `WorldDisplay` should consume the already-passed `activeRenderAnchor` and `renderChunkTransforms`
  props to create/update chunk roots.
- The chunk-root manager should use the transform set as its source of truth and avoid deriving
  offsets independently inside individual layer sync functions.
- Existing terrain/static/interior/debug layer roots should remain compatibility parents while
  individual layers migrate under chunk roots.
- Camera bounds and render metrics must include chunk-rooted content without assuming every chunk
  has pickable spatial items.
- Do not migrate static instanced batching in Phase 4; static chunk-plus-asset batching remains
  Phase 7.

### Phase 4: Chunk Root Manager In WorldDisplay

Status: complete.

Introduce a shared chunk-root manager inside `WorldDisplay` before migrating render layers:

- one root group per active render chunk
- chunk root positions derive from the active render anchor
- layer objects attach under the owning chunk root as they migrate
- chunk roots are disposed only when their chunk leaves the rendered scene
- layer sync functions must not clear or dispose chunk roots accidentally

This should avoid each render layer growing its own root lifecycle and keeps renderer mechanics
inside `WorldDisplay`.

Tests/smoke:

- empty chunks are removed cleanly
- camera auto-fit and render metrics still see all active chunk roots
- changing the active render anchor updates root positions without recreating chunk-local objects

Implemented progress:

- Added `apps/holtburger-3d/src/lib/world-display/chunk-root-manager.ts` with a focused,
  testable root-record sync helper.
- Added `apps/holtburger-3d/src/lib/world-display/chunk-root-manager.test.ts` covering root
  creation, root position updates across rebases, root reuse, and removal of chunks that leave the
  active transform set.
- Added a `render-chunk-roots` container inside `WorldDisplay` and a `chunkRoots` map keyed by
  `RenderChunkKey`.
- Wired `WorldDisplay` to consume the Phase 3 `renderChunkTransforms` prop through a dedicated
  sync effect. Anchor changes now update chunk root positions without recreating the WebGL renderer
  or scene.
- Kept the existing terrain, static renderable, structured interior, and debug overlay broad roots
  as compatibility parents. No render layer was migrated under chunk roots in this phase.
- Included the chunk-root container in scene bounds expansion so metrics/camera framing remains
  aware of the root manager as content migrates under it.

Decisions:

- The root manager is renderer-local and lives under `world-display`; it is not a browser-mode
  policy object.
- Chunk roots are empty staging groups for now. They are created and transformed from the shared
  transform set, but existing layer objects remain under their current broad roots until Phase 6/7.
- Disposing a non-empty chunk root fails hard. Once layers start migrating under chunk roots, layer
  sync code must remove or move its own children before a chunk root leaves the active set.
- The renderer setup effect no longer depends on render-anchor values. Chunk-root syncing is a
  separate effect to avoid full renderer recreation during anchor changes.

Course corrections:

- Phase 3 had an inert `renderAnchorDebugKey` read in the renderer setup effect. During Phase 4 this
  was removed because it would have made anchor changes recreate the Three.js renderer instead of
  updating chunk roots in place.
- The root lifecycle logic was extracted into a small helper module so the important behaviors can
  be tested without requiring a browser/WebGL test harness.

Validation:

- `npm run test:ts -- src/lib/world-display/chunk-root-manager.test.ts src/lib/world-display/render-anchor.test.ts src/lib/world-display/render-chunks.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`

Refined follow-up for Phase 5:

- Add explicit chunk-transform sink operations to `RenderSpatialIndex`; do not let `WorldDisplay`
  mutate spatial-index transform state directly.
- Keep query inputs in renderer-local coordinates and transform them internally per chunk.
- Missing chunk transforms should fail visibly in tests for chunk-local items rather than silently
  behaving as identity transforms.
- The current chunk-root transform set from `BrowserWorldDisplay` should become the single source
  for both `WorldDisplay` chunk roots and spatial-index chunk transforms.

### Phase 5: Chunked Render Spatial Index

Status: complete.

Extend the render spatial index with chunk transforms while keeping its query interface narrow.

Candidate interface direction:

```ts
interface RenderSpatialChunkTransform {
  chunkKey: RenderChunkKey;
  offset: RenderVec3;
}

interface ChunkedRenderSpatialItem extends RenderSpatialItem {
  chunkKey: RenderChunkKey;
  broadphaseBounds: RenderBounds; // chunk-local
  pickShape?: RenderPickShape; // chunk-local
}
```

Queries should continue accepting renderer-local rays/frustums from `WorldDisplay`. The index
internally transforms those queries into chunk-local space.

The sink side should grow explicit chunk-transform operations, for example:

```ts
interface RenderSpatialChunkSink {
  replaceChunkTransforms(transforms: RenderSpatialChunkTransform[]): void;
  removeChunkTransform(chunkKey: RenderChunkKey): void;
}
```

Do not require every chunk to have pickable items. A chunk transform may exist because render roots
or static groups need rebasing/culling even if no individual pick target is registered.
`BrowserWorldDisplay` should call these operations when it commits a render-anchor change or when
the active chunk set changes. `WorldDisplay` should continue to use only the query side of the index.

Course correction from the previous index plan: this is still a renderer-local index. Chunking is an
organization and rebasing mechanism, not a move toward AC-space authority.

Tests:

- ray pick returns the same renderer-space hit point before and after a chunk transform update
- frustum query respects chunk transforms
- missing chunk transforms fail visibly in tests rather than silently producing misleading hits

Implemented progress:

- Extended `RenderSpatialItem` with optional `chunkKey` support. Existing unchunked items remain
  flattened renderer-space items.
- Added `RenderSpatialChunkSink` operations to `RenderSpatialIndex`:
  - `replaceChunkTransforms(transforms)`
  - `removeChunkTransform(chunkKey)`
- Updated `createLinearRenderSpatialIndex` to store chunk transforms internally and apply them
  during queries for items that declare a `chunkKey`.
- Kept `WorldDisplay` on the query side only. It still submits renderer-local rays and frustums and
  does not mutate spatial-index transform state.
- Wired `BrowserWorldDisplay` to call `renderSpatialIndex.replaceChunkTransforms` from the same
  `activeRenderChunkTransforms` set already passed to `WorldDisplay` for chunk roots.
- Added tests proving:
  - ray picks return renderer-space hit points after a chunk transform update
  - frustum queries respect chunk transforms
  - chunked items with missing transforms throw visibly

Decisions:

- Chunking is opt-in per item via `chunkKey`. This avoids double-transforming the current terrain,
  structured-interior, and debug spatial items, which are still derived as flattened renderer-space
  bounds until Phase 6.
- `BrowserWorldDisplay` remains the sole writer of spatial chunk transforms. `WorldDisplay` keeps
  using only the query interface.
- Query inputs remain renderer-local. For chunked items, the index transforms rays into chunk-local
  space and translates chunk-local bounds to renderer space for frustum tests.
- Pick results remain renderer-local. The index converts chunk-local precise hit points back through
  the stored chunk transform before returning.

Course corrections:

- The first implementation pass introduced a duplicate vector helper name in
  `render-spatial-index.ts`; the helper was consolidated with the existing math helpers.
- Scene-derived spatial items were intentionally not marked with `chunkKey` in this phase. Their
  geometry is still flattened by `render-spatial-scene.ts`, so marking them chunked before Phase 6
  would apply transforms twice.

Validation:

- `npm run test:ts -- src/lib/world-display/render-spatial-index.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`

Refined follow-up for Phase 6:

- Migrate non-instanced scene spatial item derivation to chunk-local coordinates at the same time
  those visual objects move under chunk roots.
- Add `chunkKey` to terrain, structured-cell, debug-cell, and portal spatial items only after their
  bounds/pick shapes are authored chunk-local.
- Keep static renderable spatial/index behavior out of Phase 6 unless a specific non-instanced
  static hook appears; static batching and chunk-local instance matrices remain Phase 7.
- Verify pick result points remain renderer-local after Phase 6 by adapting the Phase 5 chunked
  index tests to real scene-derived items.

### Phase 6: Non-Instanced Layer Migration

Status: complete.

Move non-instanced render layers under chunk roots:

- terrain meshes attach under their owning landblock root
- structured-interior shells and debug overlays attach under the owning landblock/dungeon root
- terrain, structured-interior, and debug spatial items are chunk-local

Do not claim full root-only rebasing after this phase. Static renderables still need the dedicated
batching change in Phase 7.

Tests/smoke:

- terrain still renders in the same place for the current focus
- linked outdoor interiors remain aligned with their owning terrain landblock
- portal/cell debug overlays remain aligned with structured-interior shells

Implemented progress:

- Migrated terrain meshes, structured-interior meshes, cell debug overlays, and portal debug
  overlays to attach under their owning render chunk roots in `WorldDisplay`.
- Updated non-instanced visual transforms to use chunk-local placement:
  - terrain meshes use `chunkLocalOffset`
  - structured interior meshes use `chunkLocalPlacement`
  - debug cell/portal overlays inherit chunk-local placement from the structured cell model
- Updated `render-spatial-scene.ts` so terrain, structured-cell, debug-cell, and portal spatial
  items now carry `chunkKey` and author their bounds/pick shapes in chunk-local coordinates.
- Added a real scene-derived spatial-index test proving a terrain item derived from
  `render-spatial-scene.ts` returns a renderer-local pick point through the chunked index path.
- Extended the chunk-root manager with an optional `canDisposeRoot` guard so inactive roots that
  still have layer children are retained until layer sync removes those children.
- Updated debug overlay disposal so objects attached under chunk roots are disposed directly instead
  of relying on the old broad debug root traversal.

Decisions:

- Static renderables remain under the broad static root and still use flattened instance matrices.
  Full static chunk partitioning remains Phase 7.
- The old broad terrain, structured-interior, and debug roots remain in the scene as compatibility
  roots for now, but the migrated non-instanced objects no longer attach to them.
- `WorldDisplay` uses the transform set from `BrowserWorldDisplay` as the only source for chunk root
  positions. Layer sync code chooses roots by `renderChunk.chunkKey`; it does not derive offsets.
- Spatial item `chunkKey` is now present for the migrated non-instanced world items, but remains
  optional at the type level until static/render-global compatibility is cleaned up.

Course corrections:

- Chunk root disposal needed a guard once layer objects started living under roots. Without that,
  a reactive pass could try to remove an inactive root before all layer-specific sync functions had
  removed their children.
- Debug overlay disposal had to move from broad-root cleanup to tracked-object cleanup because
  debug objects no longer live under `debugOverlayRoot`.

Validation:

- `npm run test:ts -- src/lib/world-display/render-spatial-scene.test.ts src/lib/world-display/render-spatial-index.test.ts src/lib/world-display/chunk-root-manager.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`

Refined follow-up for Phase 7:

- Partition static renderable instanced meshes by chunk plus gfx asset and attach each group under
  its chunk root.
- Author static instance matrices in chunk-local coordinates using `chunkLocalInstancePlacement`
  and remove the active renderer dependency on `landblockWorldOffset` for static parts.
- Replace `partsByGfxAssetId` usage in `WorldDisplay` with `partsByRenderChunkAndGfxAssetId`, then
  mark `partsByGfxAssetId` as a cleanup target.
- After static renderables migrate, reassess whether normal world spatial items can require
  `chunkKey` and whether any truly flat renderer-space item type needs a separate union branch.

### Phase 7: Static Renderable Chunk Partitioning

Status: complete.

Partition static renderables by owning render chunk and render asset:

- one `InstancedMesh` group per chunk plus render asset
- instance matrices are authored in chunk-local coordinates
- each static instanced group attaches under its landblock/dungeon root
- static group bounds should support chunk/group-level visibility toggles without per-instance
  culling

This is a major change to the current static renderable batching logic. It likely touches scene-model
derivation, instance grouping keys, `WorldDisplay` mesh maps, disposal, and visibility mapping.

This can increase draw calls relative to one global batch per render asset, but it aligns static
renderables with the chunking system and avoids a second special-case rebase path. If this proves too
expensive, revisit with profiling rather than adding a hidden flat-batch exception.

Tests/smoke:

- static renderables remain aligned with their owning terrain before and after focus-anchor changes
- static renderables still batch identical render assets within each chunk
- chunk-level visibility can hide/show static groups without per-instance culling
- disposal removes all chunked groups for assets leaving the scene

Implemented progress:

- Updated `WorldDisplay` to consume `partsByRenderChunkAndGfxAssetId` instead of the old global
  `partsByGfxAssetId` renderer path.
- Changed static renderable mesh ownership from one `InstancedMesh` per gfx asset to one
  `InstancedMesh` per render chunk plus gfx asset group.
- Static instanced groups now attach under their owning render chunk root.
- Static instance matrices are now authored from `chunkLocalInstancePlacement` with a zero world
  offset in `buildStaticRenderablePartMatrix`.
- Static renderer disposal now removes chunked group meshes from their parent chunk roots and keeps
  gfx geometry caching keyed by gfx asset id.
- Browser diagnostics now report chunked instanced group count instead of global shared-gfx group
  count.
- Added a matrix-level test proving static renderable transforms ignore legacy
  `landblockWorldOffset` and use chunk-local placement.

Decisions:

- Gfx geometry remains cached by gfx asset id. Chunk partitioning changes instanced group ownership,
  not geometry upload identity.
- `partsByGfxAssetId`, `instancePlacement`, and `landblockWorldOffset` remain in the scene model for
  now as compatibility fields for tests and pending cleanup, but the active static renderer no
  longer depends on them.
- Static chunk-level visibility is represented by group ownership under chunk roots. Per-instance
  culling remains out of scope.
- The metrics field named `staticRenderableGeometryCount` now reports active chunked instanced
  groups. The field name is a cleanup target because it no longer precisely describes the value.

Course corrections:

- The implementation reused the existing gfx geometry cache rather than introducing chunk-scoped
  geometry caches. Duplicating geometry per chunk would have increased memory with no benefit to
  the batching goal.
- A lint pass caught an unused type import in the new geometry test; the test fixture now explicitly
  uses the `StaticRenderablePart` type to keep coverage tied to the renderer contract.

Validation:

- `npm run test:ts -- src/lib/world-display/static-renderables.test.ts src/lib/world-display/static-renderable-geometry.test.ts src/lib/world-display/chunk-root-manager.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`

Refined follow-up for Phase 8:

- Camera hints and inspector hit points now need explicit anchor-aware semantics because visual
  terrain, interiors, debug overlays, and static renderables are all chunk-rooted.
- Inspector rows should label renderer-local hit points or convert them to a stable landblock/local
  coordinate before presenting them as meaningful world facts.
- Diagnostic selections should retain stable metadata ids only; hit points and distances should be
  treated as ephemeral pick results.

Cleanup targets carried forward:

- Remove or split `partsByGfxAssetId` after all tests and diagnostics use chunk-plus-asset groups.
- Remove `instancePlacement` and `landblockWorldOffset` from static renderer-facing types once no
  compatibility tests or non-render consumers require them.
- Rename `staticRenderableGeometryCount` or split it into geometry count and instanced group count.

### Phase 8: Camera Hints And Inspector Semantics

Status: complete.

Fix renderer-local camera and pick reporting at the same boundary:

- camera hints sent to the host should be converted through the active anchor
- inspector hit points should either be labeled as renderer-local or converted to a user-facing
  landblock/local coordinate
- diagnostic selections should not persist last hit points or distances as meaningful state. Hit
  points and distances are ephemeral query results for the pick that just happened.

This phase should not make the render spatial index authoritative. It only prevents renderer-local
numbers from masquerading as canonical facts.

Implemented progress:

- `buildCameraHintFromSceneCameraFrame` now accepts the active render anchor and converts the
  renderer-local camera position through that anchor before sending the hint to the host.
- `BrowserWorldDisplay` passes `activeRenderAnchor` into rendered camera hint derivation.
- Camera hint direction remains a pure Three-to-AC axis conversion and normalization because anchor
  rebasing is translational and should not affect forward vectors.
- Diagnostic selection state now stores only `RenderSpatialMetadata`, not the full pick result.
- Diagnostic clicks still use renderer-local pick points and distances internally, but those
  ephemeral query results are no longer retained or displayed as stable inspector facts.
- The inspector now labels pick data as renderer-local query data that is not retained.
- Added a camera-helper regression test showing two rebased renderer-local camera positions resolve
  to the same anchor-converted AC-style position.

Decisions:

- Did not change the TypeScript or Rust camera hint DTO shape in this phase. The current host
  contract has no anchor field and currently stores hints rather than interpreting a richer camera
  coordinate model.
- The camera hint position is emitted as an anchor-derived AC-meter position using the outdoor
  landblock base and `OUTDOOR_LANDBLOCK_WORLD_SIZE`; it is not a user-facing latitude/longitude
  label.
- Inspector selection retention is metadata-only so debug highlighting can survive without carrying
  stale hit points or distances.

Course corrections:

- Chose metadata-only diagnostic selection instead of merely relabeling existing point/distance
  rows. Relabeling would still leave stale click geometry in app state and would not meet the
  phase's selection-retention goal.

Validation:

- `npm run test:ts -- src/lib/world-display/camera.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`
- `npm exec prettier -- --check src/pages/BrowserWorldDisplay.svelte src/lib/world-display/camera.ts src/lib/world-display/camera.test.ts`

Refined follow-up for Phase 9:

- Treat cleanup as a compatibility-shim removal pass, not just naming polish.
- Remove or split `partsByGfxAssetId` after tests and diagnostics are fully migrated to
  chunk-plus-asset static groups.
- Remove `instancePlacement` and `landblockWorldOffset` from static renderer-facing types once no
  compatibility tests or non-render consumers require them.
- Revisit `RenderSpatialItem.chunkKey`; either make it required for world items or split any
  remaining genuinely unchunked/debug-only item shape so optionality is not contagious.
- Rename `staticRenderableGeometryCount` or split it into separate geometry-cache and instanced-group
  metrics.
- Audit broad layer roots and old focus-relative offset helpers now that terrain, interiors, debug
  overlays, static renderables, and spatial queries all flow through chunk ownership.
- Revisit camera hint semantics when the host starts consuming hints for behavior rather than merely
  storing/acknowledging them.

### Phase 9: Cleanup And Simplification Pass

Status: complete.

After the mechanics are working, make a focused cleanup pass before exiting the spike:

- remove duplicated offset math that should now flow through shared helpers
- remove stale focus-relative fields or names that imply flattened renderer-space ownership
- simplify compatibility shims introduced during the migration, especially optional fields and
  duplicate grouped/flat model surfaces
- verify `WorldDisplay` has not accumulated browser-mode policy
- verify `BrowserWorldDisplay` or the mode coordinator has not accumulated renderer object
  lifecycle details
- update this plan and the local-world simulation exploration plan with final status, decisions,
  course corrections, and adjusted next steps

Implemented progress:

- Removed the static renderable compatibility grouping `partsByGfxAssetId`; static renderer-facing
  consumers now use only chunk-plus-gfx groups via `partsByRenderChunkAndGfxAssetId`.
- Removed static renderable compatibility placement fields `instancePlacement` and
  `landblockWorldOffset`; static part matrices now depend on `chunkLocalInstancePlacement` plus
  parent/part placements only.
- Removed the old static `deriveFocusRelativeAcPlacementOffset` path and its wrapper
  `deriveLandblockWorldOffset`.
- Removed structured-interior duplicate `localPlacement` and `landblockWorldOffset` fields from the
  scene model and debug overlay DTOs; `chunkLocalPlacement` is now the sole renderer-facing placement
  field for structured cells and portal/cell overlays.
- Removed terrain tile `offsetX`/`offsetY` and `worldOffsetX`/`worldOffsetY`; terrain scene tiles now
  expose chunk identity plus chunk-local placement, and sort order derives landblock-grid deltas
  locally without storing them as renderer-facing fields.
- Renamed the internal static source-instance placement field from `localPlacement` to
  `chunkLocalInstancePlacement` so normalized static instances do not carry both source-style and
  renderer-style placement names.
- Made `RenderSpatialItem.chunkKey` required and simplified the spatial index so every item resolves
  through a chunk transform. Missing transforms still fail visibly.
- Removed empty broad `terrain`, `static-renderable`, `structured-interior`, and `debug-overlay`
  roots from `WorldDisplay`. Scene bounds now expand the chunk-root container directly.
- Renamed the render metric from `staticRenderableGeometryCount` to
  `staticRenderableInstancedGroupCount` so the field describes the chunked instancing reality.
- Updated tests to assert chunk-local placement and chunk-plus-gfx grouping instead of preserving
  removed compatibility fields.

Decisions:

- Kept `RenderCameraFrame` in `render-chunks.ts` because it supports the generic
  `convertCameraFrameBetweenAnchors` helper used by camera rebase tests; it is a narrow structural
  constraint rather than a public scene-frame abstraction.
- Did not move rebase policy out of `BrowserWorldDisplay` in this phase. The remaining policy there
  is app/mode coordination, while `WorldDisplay` now owns only chunk-root mechanics and neutral
  renderer queries.

Course corrections:

- The cleanup scan found structured-interior `landblockWorldOffset` was the same shim as the static
  offset path, not an independent requirement. Removing it also let debug overlays become purely
  chunk-local.
- The spatial-index test fixtures had been relying on unchunked items for convenience. The tests now
  install explicit default chunk transforms, matching production expectations instead of keeping the
  optional field alive.
- The old broad roots were confirmed empty after Phase 6/7 migrations, so removing them simplified
  lifecycle and bounds calculation without changing object ownership.
- Follow-up review removed two over-conservative leftovers: terrain no longer exposes stored focus
  delta/world offset fields, and static source normalization no longer keeps a `localPlacement`
  bridge name after converting prepared asset placement into chunk-local renderer placement.

Validation:

- `npm run test:ts -- src/lib/world-display/static-renderables.test.ts src/lib/world-display/static-renderable-geometry.test.ts src/lib/world-display/render-spatial-index.test.ts src/lib/world-display/render-spatial-scene.test.ts src/lib/world-display/structured-interior-scene.test.ts src/lib/world-display/debug-overlays.test.ts`
- `npm run test:ts`
- `npm run check`
- `npm run lint:ts`
- `npm exec prettier -- --check src/lib/world-display/WorldDisplay.svelte src/lib/world-display/debug-overlays.ts src/lib/world-display/debug-overlays.test.ts src/lib/world-display/render-chunks.ts src/lib/world-display/render-spatial-index.ts src/lib/world-display/render-spatial-index.test.ts src/lib/world-display/render-spatial-scene.test.ts src/lib/world-display/renderer-contract.ts src/lib/world-display/static-renderable-geometry.test.ts src/lib/world-display/static-renderables.ts src/lib/world-display/static-renderables.test.ts src/lib/world-display/structured-interior-scene.ts src/lib/world-display/structured-interior-scene.test.ts src/pages/BrowserWorldDisplay.svelte`
- `npm run test:ts -- src/lib/world-display/terrain-scene.test.ts src/lib/world-display/render-spatial-scene.test.ts src/lib/world-display/static-renderables.test.ts src/lib/world-display/static-renderable-geometry.test.ts`
- `npm exec prettier -- --check src/lib/world-display/terrain-scene.ts src/lib/world-display/terrain-scene.test.ts src/lib/world-display/render-spatial-scene.test.ts src/lib/world-display/static-renderables.ts`

Remaining follow-up:

- Consider renaming `partsByRenderChunkAndGfxAssetId` to `partsByInstancedGroupKey` now that the old
  flat `partsByGfxAssetId` contrast no longer exists.
- Add host-side camera-hint semantics when the host starts consuming rendered camera hints for
  behavior rather than storing acknowledgements.
- Use the completed chunk-root model as input to the local-world simulation exploration before
  implementing walkabout residency/collision.

## Risks And Footguns

- Static renderables should be batched by chunk and render asset. This can increase draw calls, but
  keeps them aligned with root-only rebasing and chunk-level culling. If this proves too expensive,
  revisit with profiling rather than adding a hidden flat-batch exception.
- Debug overlays and spatial items must share chunk ownership. If they derive ownership differently,
  picking and visuals will drift.
- Camera frame conversion must be tested because visual continuity bugs are easy to miss in code
  review.
- A missing spatial-index entry must not prevent rendering.
- Anchor changes and asset coverage changes are related but not identical. Avoid making every rebase
  look like a streaming event.

## Initial Answers To The Open Questions

Minimal render-anchor model:

- Start with focused landblock id plus helper functions. A named type is optional and should stay
  small if introduced.

Chunk-local vs renderer-local:

- Terrain, structured interiors, debug overlays, and spatial item geometry should become
  chunk-local.
- Three.js camera frame, viewport rays, and query inputs remain renderer-local.
- Stable metadata ids remain canonical labels, not geometry.

Side effects on focus-anchor change:

- update root transforms
- update spatial chunk transforms
- rewrite camera frame into the new renderer-local basis
- preserve diagnostic selection only by stable metadata identity, if preserving it is useful

Ownership above `WorldDisplay`:

- `BrowserWorldDisplay` owns it first.
- A future mode-level scene coordinator can take over when browser free-camera, browser walkabout,
  and client mode diverge.

Narrow chunk-local spatial-index interface:

- Add chunk keys and chunk transforms to the existing index model.
- Keep `WorldDisplay` querying in renderer-local coordinates.
- Keep browser/client wrappers interpreting metadata and actions.

## Validation

Run the 3D app TypeScript checks and targeted tests after each implemented phase:

```bash
npm run test:ts
npm run check
npm run lint:ts
```

Before considering the spike complete, manually smoke:

- outdoor focus landblock
- adjacent outdoor landblock selection
- linked outdoor interior overlay alignment
- diagnostic portal/cell picking
- browser free-camera continuity before and after an explicit focus-anchor change
