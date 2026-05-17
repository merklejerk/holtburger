# Holtburger 3D Renderer-Local Rebasing Plan

Status: draft implementation plan for review.

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

### Phase 2: Scene Model Chunk Ownership

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

### Phase 3: BrowserWorldDisplay Render Anchor Plumbing

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

### Phase 4: Chunk Root Manager In WorldDisplay

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

### Phase 5: Chunked Render Spatial Index

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

### Phase 6: Non-Instanced Layer Migration

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

### Phase 7: Static Renderable Chunk Partitioning

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

### Phase 8: Camera Hints And Inspector Semantics

Fix renderer-local camera and pick reporting at the same boundary:

- camera hints sent to the host should be converted through the active anchor
- inspector hit points should either be labeled as renderer-local or converted to a user-facing
  landblock/local coordinate
- diagnostic selections should not persist last hit points or distances as meaningful state. Hit
  points and distances are ephemeral query results for the pick that just happened.

This phase should not make the render spatial index authoritative. It only prevents renderer-local
numbers from masquerading as canonical facts.

### Phase 9: Cleanup And Simplification Pass

After the mechanics are working, make a focused cleanup pass before exiting the spike:

- remove duplicated offset math that should now flow through shared helpers
- remove stale focus-relative fields or names that imply flattened renderer-space ownership
- simplify any compatibility shims introduced during the migration
- verify `WorldDisplay` has not accumulated browser-mode policy
- verify `BrowserWorldDisplay` or the mode coordinator has not accumulated renderer object
  lifecycle details
- update this plan and the local-world simulation exploration plan with final status, decisions,
  course corrections, and adjusted next steps

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
