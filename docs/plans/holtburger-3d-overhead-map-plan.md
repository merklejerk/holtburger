# Holtburger 3D Overhead Map Plan

Status: **Complete — Phases 0-5 accepted and verified (2026-08-24).**
Phases were resequenced on 2026-08-23 after confirming terrain needs no new plumbing: the
terrain-only renderer is now Phase 1, serving as both an early spike and the renderer foundation.
Phase 0 landed the host map-geometry derivation (HBEC v4 `mapFloor` sections, buildings-layer
`mapBlockers` sections), the radar-property projection through catalog v8 and
`DynamicEntityView.presentation.radar`, and the censuses below.
This worktree's `dats/weenies.hwc` was re-exported at catalog v7 for the original radar fields. The
late semantic-color pass bumped the format to v8 to retain authored `Attackable`; re-export the
local ignored artifact with an `ACE_WORLD_SQL_URL` before running Explorer. The main checkout keeps
its own older copy and likewise needs a re-export when this branch merges.
Origin: ideation on an overhead/minimap display for the explorer UI that must remain reusable by the
future client UI. Retail's radar (`gmRadarUI`) draws shape-coded blips only — no terrain, no roads,
no interior geometry — so this surface is a deliberate quality improvement, not protocol behavior.

## Context and Boundaries

### Goal

Add a reusable overhead map component that renders an abstract, top-down "walkability" view of the
anchor's surroundings — the possessed entity, or the camera in Explorer mode. Outdoors that is
hillshaded terrain with roads and building footprints; indoors it is a depth-shaded walkable-floor
rendering of the portal-connected interior; retail-semantic entity blips sit on top of both.
Heavy geometry derivation happens once at landblock/interior load inside the existing
materialization pipeline; presentation is a small standalone WebGL2 renderer on its own canvas and
context, ticked on demand at no more than 30 Hz.

### Why this design is deserved

- Drawing the scene twice is too expensive, and the scene renderer has no per-view viewport or
  ortho projection; threading a minimap through `FrameInput.views` would couple a fixed top-down
  projection of _different_ geometry into machinery built for perspective scene views.
- A parallel map renderer with a narrow derived-geometry contract has near-zero overlap with the
  scene renderer by construction. The map mesh is not scene geometry; the projection, lifetime, and
  cadence all differ. Keeping it separate is the cleaner boundary, not a compromise.
- GPU rendering makes slicing, zoom, pan, and rotation uniforms instead of bake/invalidate
  machinery. A CPU tile bake was considered and rejected: continuous dungeon topology (ramps,
  spirals — there are no discrete floors) forces anchor-relative re-rasterization, and continuous
  zoom forces resolution rebakes. Both are free in a fragment shader.
- "Render walkability" is one rule that drives both modes: outdoor slopes past the walkable
  threshold and building footprints read as obstacles; indoor walkable floor reads as shape and
  everything else as void. This matches what a map is for and stays abstract by design.

### In scope

- Host-side derivation of map geometry at projection time: walkable-floor triangles per env cell
  (from CellStruct physics polygons) and blocker silhouettes per building (from GfxObj physics
  polygons), shipped as new sections of the existing HBEC and landblock source records.
- Frontend fold-in through the existing materialization pipeline and workers so map geometry loads
  with the assets it derives from and adds no independent streaming stutter.
- `GameRuntime` ownership of map geometry lifetime, keyed to the same landblock/env-cell interest
  and residency it already manages.
- Portal-graph flood fill from the anchor's current cell to select the connected interior
  component, using the decoded `portalCrossings` adjacency (not visibility lists).
- A standalone `MapRenderer`: second small canvas with its own WebGL2 context, orthographic
  top-down projection, flat-color programs, hillshade for terrain, anchor-relative depth rule and
  above/below fade for interiors. Demand-driven ticks capped at 30 Hz.
- Indoor/outdoor mode switch driven by anchor residency.
- Distinct rendering of outdoor↔indoor transition portals (building doorways, dungeon seam
  portals) from the aperture geometry already decoded in the interior record, in both modes:
  entrances visible on the outdoor map, exits visible on the indoor map.
- Entity blips honoring retail radar semantics (`RadarBlipColor`, `ShowableOnRadar`,
  `ObviousRadarRange`), which requires projecting those already-hydrated properties into
  `DynamicEntityView`. Blips share the 30 Hz map cadence.
- A framework-free map module under `src/lib` plus one reusable Svelte overlay component — a
  draggable, resizable, compass-framed panel — mounted by the explorer now and the client shell
  later. The map core stays chrome-agnostic; the compass frame is the shared default chrome.

### Out of scope

- Any change to the scene renderer, its `FrameInput`/view machinery, or the presentation pass.
- Shipping raw physics polygons or physics BSPs to the frontend. Only derived map geometry crosses
  the boundary.
- Retail radar parity as a constraint. Blip _semantics_ follow the retail properties; everything
  else (geometry layers, zoom, orientation) is a deliberate quality surface.
- WebGL context-loss recovery for the map context. The device policy is already
  restart-required-on-loss (`webgl2-device.ts`); the map context adopts the same stance.
- To-scale creature collision footprints. Entity radii are not transported to the client and would
  be sub-pixel at map scale; blips are shaped markers.
- Fog-of-war, exploration persistence, waypoints, map notes, or a full-screen world map. The
  contract should not preclude them, but none are built here.
- Rendering non-building explicit statics or generated objects (trees, rocks, clutter) on the map.
  The map renders navigational structure, not scenery: these objects are dense, small at map scale,
  and would cost per-object silhouette derivation and record growth for negative legibility value.
  If a specific object class later proves navigationally significant, the escape hatch is a
  semantics-driven marker in the blip layer (by category), not a geometry layer — the derived-
  geometry contract stays closed to buildings and cell floors.

## Ground Truth and Existing Seams

Verified against the codebase, ACE, and the retail decompile on 2026-08-23:

- **Walkability threshold.** Retail `CPhysicsObj::is_valid_walkable` is
  `normal.z >= PhysicsGlobals::floor_z` (acclient.c:304992); the constant matches ACE
  `PhysicsGlobals.FloorZ = 0.66417414618662751` (ACE `Physics/PhysicsGlobals.cs:50`), i.e. surfaces
  within ~48.4° of horizontal. This is the single constant behind the floor filter and the outdoor
  steep-slope tint, and the host applies it once at derivation time.
- **Cell physics geometry parses but is dropped at projection.** `CellStruct` carries
  `physics_polygons` and `physics_bsp` (`crates/holtburger-dat/src/file_type/environment.rs:16-26`),
  but `project_cell_struct` reads only render polygons, portal ids, and the cell BSP
  (`apps/holtburger-3d/src-tauri/src/cell_struct_projection.rs:64-112`). The frontend record has no
  physics section (`decode-env-cell-record.ts:200-236`). Host-side collision assembly already
  resolves these polygons (`crates/holtburger-content/src/object_collision.rs:800-880`).
- **Building physics geometry likewise.** `GfxObj.physics_polygons`/`physics_bsp` parse
  (`crates/holtburger-dat/src/file_type/gfx_obj.rs:18-46`); `build_gfx_obj_geometry` reads only the
  drawing side (`apps/holtburger-3d/src-tauri/src/gfx_obj_geometry.rs:32-66`); collision assembly
  registers buildings as `StaticColliderPlacement::BuildingShell`
  (`object_collision.rs:771-784`).
- **Portal adjacency is fully decoded client-side.** `portalCrossings` carry directed
  source/target `SceneScope` endpoints with reciprocal links and aperture geometry
  (`env_cell_source.rs:323-467`, `decode-env-cell-record.ts:124-147`,
  `landblock-layer.ts:202-230`). The PVS-style `potentiallyVisibleEnvCellIds` is a separate field
  and must not be used for adjacency. `indoor-topology-boundary` crossings are still real edges.
- **Terrain CPU data is retained and already enumerable — the map needs no new terrain plumbing.**
  `TerrainSystem` keeps every installed landblock's `TerrainGenerationSource` for the life of the
  installation and exposes exactly the two accessors a second consumer needs
  (`terrain/terrain-system.ts:243-251`):
  - `listInstalledTerrain(): Generator<InstalledTerrain>` yields `{ landblockId, generation }`
    with `gridSize`, `tileSize`, `heights: Float32Array`, and `terrainSamples: Uint16Array` — the
    raw 9×9 CellLandblock pcodes, so terrain codes _and_ road bits arrive together
    (`terrain/types.ts:88-100`).
  - `installationRevision: number` bumps on every install/removal and is documented as existing so
    consumers can cache derivations against the installed set.
    The audio ambience system already consumes both in exactly this shape
    (`runtime/game-runtime.ts:1673-1676, 1724-1741`), reconciling its per-landblock bakes against the
    revision. The map is a second instance of a proven pattern, not new plumbing: it reads the same
    generator for its own GPU uploads and uses the same revision as its geometry dirty flag.
    The per-terrain-type mean-RGB palette is separately published CPU-side as `TerrainColorPalette`
    (`textures/texture-manager.ts`). No host change and no worker tap is needed for terrain.
- **Radar semantics are hydrated but unprojected.** `RadarBlipColor`, `ShowableOnRadar`, and
  `ObviousRadarRange` hydrate in `crates/holtburger-world/src/hydration.rs:143,152`
  (`crates/holtburger-common/src/properties/radar.rs`) and do not appear in
  `dynamicEntityViewSchema` (`runtime/dynamic-entity-feed.ts`).
- **Overlay and coordinate seams exist.** DOM overlays over the GL canvas are the established
  pattern (`ExplorerApp.svelte`, `.explorer-overlay`); AC map-coordinate formatting exists in
  `explorer-camera-location.ts` (`METERS_PER_MAP_DEGREE`, `formatExplorerOutdoorCoordinates`).
- **Context loss policy.** `webgl2-device.ts` listens for `webglcontextlost` and declares
  restart-required; there is no restoration path to mirror.

## Settled Direction Decisions

- **Derived geometry over raw geometry on the wire.** The host owns the walkability decision and
  ships its result: per-cell walkable-floor triangles (with per-vertex z retained) and per-building
  flattened blocker silhouettes. Consumers never re-derive walkability. Raw physics polygons stay
  host-side.
- **Rasterization is the union.** No 2D polygon boolean ops anywhere. Overlap resolution happens in
  the rasterizer via the depth rule.
- **Anchor-relative depth rule for interiors.** Depth is `|height - anchorHeight|`; the passage nearest the
  anchor's level wins overlapping pixels. Signed Δz drives a fade and an above/below tint. No
  slicing planes, no floor bands — dungeons are continuous topology. This is a vertex-shader
  mapping into clip-space depth so ordinary depth testing resolves it; no `gl_FragDepth` write.
- **Backface culling is not the wall story.** Walls are edge-on from above and rasterize to
  nothing. The map renders walkable floor as shape and everything else as void; walls appear as the
  boundary of floor, which is the intended abstraction.
- **Flood fill defines "the dungeon."** Stacked interiors can share a landblock at different z;
  flat-mode enumeration would bleed the other component into the map. The component is the portal
  flood from the anchor's current residency cell over `portalCrossings`.
- **The flood is undirected and runs at runtime, not load.** Only geometry derivation and upload
  are load-time work; the flood is a cheap graph walk over already-decoded adjacency, owned by
  `GameRuntime` as runtime state alongside residency. Traversal ignores edge direction and
  reciprocity (`validated_target: None` edges still name their target, `interior.rs:281-294`):
  one-way drops stay on the map, and an anchor teleported into a sealed region floods from there
  and sees it. No canonical start cell exists or is needed. Undirected components are equivalence
  classes, so the flood result stays valid while `component.has(anchorCell)` holds; recompute only
  when the anchor lands outside the set or the graph changes (component geometry load/unload).
  Truly isolated cells are excluded by construction — no global reachability detection is needed.
- **Cross-landblock seams are exterior-portal pairs, stitched geometrically.**
  `CellPortal.other_cell_id` is a `u16` (`crates/holtburger-dat/src/file_type/env_cell.rs:13`), so
  no cell→cell edge can cross landblocks; a split dungeon ends in an exterior-flagged portal
  (`flags & 0x04`, `interior.rs:265`) on each side of the boundary. Cell placements compose through
  landblock frames, so both halves draw correctly in world space with no geometry stitching; only
  component _selection_ needs a rule. The designed rule: match our component's unclaimed exterior
  apertures (no building-portal claim) against a neighbor component's unclaimed exterior apertures
  by world-plane coincidence; coincident apertures merge the components and the flood continues.
  Interest radii are camera-centered, so a seam near enough to matter implies the neighbor record
  is loaded or loading; the geometry-load retrigger covers late arrival.
- **Separate canvas and context.** WebGL contexts do not share resources; the only duplicated
  upload is small per-landblock terrain data. The `MapRenderer` consumes the derived-geometry
  contract and entity poses only — never scene-renderer internals — so it cannot accrete into a
  second scene renderer.
- **Imperative, demand-driven cadence with a 30 Hz cap.** The panel samples one shell-owned frame
  callback at most every 33 ms; presentation-rate camera and entity facts never flow through
  Svelte reactivity. It redraws only when the sampled anchor pose/residency, terrain revision,
  map-geometry revision, dynamic-placement revision, camera cone, panel size, or zoom differs from
  the last completed draw. Blips and compass chrome consume that same snapshot and cadence.
- **The viewer always faces up; the compass ring turns instead.** Reviewed 2026-08-23 and settled:
  there is no north-up toggle. The map is always oriented to the anchor's own heading, and the ring
  rotates to say where north went — which is how retail's radar-in-compass read, and how anyone
  holding a paper map turns it. The view cone is drawn at the camera's bearing _relative to the
  anchor_, so it points straight up whenever the two agree and only swings out in possession, where
  the camera orbits a character facing its own way.
- **One anchor drives map, compass, mode, and flood origin.** Every map decision that needs a
  point of view reads a single `MapAnchor { position, heading, residency }`: the possessed
  entity's pose in possession mode, the camera otherwise. There is no separate notion of "the
  player" — the Explorer has a free camera and no player at all — so the anchor's `SceneResidency`
  is what selects indoor/outdoor mode, seeds the interior flood, and supplies the `worldY` height of
  the depth rule. Anchor selection is control policy injected by the app shell; the map component only
  consumes the anchor. Orientation is always heading-up with a rotating compass ring — preserving
  retail's radar-in-compass behavior, where the ring shows true north and a wedge shows the camera
  view cone relative to the anchor heading.
- **Rotation is view policy, not geometry.** Anchor heading folds into the GL world-to-clip matrix,
  and the 2D blip projection reads the same matrix. Terrain, surfaces, and blips therefore share one
  heading-up frame without rebaking geometry; the compass ring is plain DOM/SVG rotating oppositely
  to show true north.
- **Zoom is a view diameter in world meters.** The zoom parameter is the world-space span across
  the map's visible circle, so panel resizing changes pixel density, never world extent. Min/max
  bounds are tunable parameters with placeholder values (one landblock is 192 m of diameter for
  intuition), tuned post-implementation in the harness.
- **The mounting shell owns panel state.** The compass panel is a controlled component: position,
  size, and zoom are passed in and changes are emitted out. The explorer component owns that state
  today; the future client component owns its own. The shared component holds no persistence
  policy.
- **Visual judgements resolve in the phase that first renders them.** Each phase's evidence pass
  includes an explicit judgement checklist; nothing visual is deferred to a terminal acceptance
  gate.
- **Blips as markers with retail semantics.** Color/shape/visibility/range follow the projected
  radar properties so the compatibility surface stays enumerable; presentation styling is map-layer
  code the future client UI can restyle.

## Phase 0: Host Map-Geometry Derivation

- Extend `cell_struct_projection` to derive a `mapFloor` section per cell structure: physics
  polygons filtered by `normal.z >= FLOOR_Z`, triangulated, in structure-local coordinates,
  transformed alongside the existing placement data. Introduce the `FLOOR_Z` constant once in a
  shared crate location with the ACE/acclient citations.
- Extend the landblock source batch with a per-building `mapBlocker` section: the flattened
  silhouette triangles of the building's physics polygons (projected; the rasterizer unions them),
  **excluding portal-flagged polygons** so doorways read as gaps rather than sealed wall. Part of
  the fixture work is proving how portal polygons are identified within the physics set for a real
  building before trusting the filter.
- Project `RadarBlipColor`, `ShowableOnRadar`, and `ObviousRadarRange` into the dynamic-entity
  projection and `dynamicEntityViewSchema`.
- Record-version bumps for HBEC and the landblock source record as required by their existing
  versioning conventions.
- Run the seam and one-way-edge censuses (see Open Questions) with a throwaway tools/harness pass
  over the shipped DATs, and record the counts in this plan before Phase 1 begins.

### Phase 0 results (2026-08-23)

Census over the repo `dats/assets.hba`, which carries the full shipped cell content — 2,596
interior landblocks, 537,188 cells. The temporary census binary was removed during Phase 5 after
the evidence below was recorded:

- **Up-axis violations: 0** across every cell placement. The structure-local floor filter and the
  serializer's `MAP_FLOOR_UP_EPSILON` guard are globally sound on shipped data.
- **One-way internal portals: 108 of 1,350,718** (0.008%). Undirected traversal needs no extra
  policy; samples cluster as one pair per affected dungeon landblock.
- **Cross-landblock seam candidates: 0.** Outside portals: 16,394, of which 16,393 are
  building-claimed; the single unclaimed one sits in a landblock with buildings. Shipped data
  contains no unclaimed exterior portals in buildingless landblocks, so seam stitching has nothing
  to stitch — deferred entirely (design retained below should future content need it).
- **Doorway exclusion validated on all 384 building GfxObjs**: every aperture polygon id appears
  in the physics polygon set (overlap always equals the aperture id count), and exclusion removes
  real silhouette triangles. Without it, doorways would be stamped shut.
- **Floor yield**: 104,847 unique cell structures, 263,098 walkable floor triangles (~2.5 per
  structure); 19,709 structures have no walkable floor (shafts/solid fills).
- **Record growth** (Holtburg 0xda55ffff): `mapFloor` 10,176B positions + 4,992B indices of a
  2,019,724B interior record (~0.75%); `mapBlocker` 77,736B positions + 36,912B indices of a
  518,100B buildings record (~22% — acceptable v1; xy-only positions or u16 indices are available
  trims if it ever matters).
- `RETAIL_WALKABLE_NORMAL_Z` already existed in `holtburger-world/src/spatial/grounded.rs` with
  citations; it is imported, not re-introduced.
- **Radar domain audit** over the re-exported catalog (43,913 templates): 3,303 author
  `RadarBlipColor`, 12,237 `ShowableOnRadar`, 7,434 `ObviousRadarRange`. Distinct authored values
  are colors `{0,1,2,3,4,5,7,8}` and behaviors `{0..4}` — zero unusable values on shipped content.
  `RadarColor` has an authored gap at `0x0A-0x0F` that no template reaches.
- **Unusable radar values warn and drop, they do not fail the entity.**
  `DynamicEntityRadarFacts::from_authored` is the single typing seam for both the Explorer driver
  and the live-client projector: unusable behavior/range values degrade to `None`, while an
  unusable color selects the producer's semantic fallback, and each case logs independently. Radar
  facts are cosmetic map presentation, so refusing to create an entity over an unmappable blip
  color would be disproportionate; the log keeps the novel-content signal rather than swallowing
  it. This also replaced the `prepare()` range validation, so `DynamicEntityDefinition` no longer
  carries a radar error variant.
- Evidence: focused synthetic derivation and record-decoder tests assert walkability, doorway
  exclusion, range validation, and that no physics BSP or raw physics polygon crosses the boundary.

## Phase Sequencing

The terrain finding above reorders the remaining work. Terrain needs **nothing** from Phase 0's
record sections and nothing from the flood — its CPU data is already resident and enumerable — so
the renderer can be built and judged against real content before any decode work exists. That puts
the riskiest phase first with the fewest dependencies, and makes every phase produce something
visible instead of Phase 1 being pure invisible plumbing.

Phase 1 (terrain-only map) is therefore both the spike and the renderer foundation: if the
abstract aesthetic does not work, we learn it before writing a decoder, a store, or a flood.

## Phase 1: Terrain-Only Map (Spike and Renderer Foundation)

- Standalone module under `src/lib/game/map/`: owns a small canvas, its own WebGL2 context
  (restart-required on loss, matching device policy), an orthographic top-down camera, and the
  terrain program — positions and terrain codes built from `listInstalledTerrain()`, colored by
  the `TerrainColorPalette`, hillshaded from the height gradient, steep slopes tinted past
  `RETAIL_WALKABLE_NORMAL_Z`, roads tinted from the road pcode bits already in `terrainSamples`
  (no vector centerline tracing).
- Geometry lifetime keyed to `installationRevision`: upload on install, drop on removal, mirroring
  how the ambient bakes reconcile against the same counter.
- View parameters (center, zoom as world-metre view diameter, rotation, anchor height) are uniforms.
  Demand-driven render loop with a 30 Hz cap and dirty-flag inputs.
- Extract only genuinely context-neutral GL helpers (shader compile/link/error reporting) into a
  neutral module shared with the scene renderer rather than importing renderer internals or
  duplicating them; the map owns everything else itself.
- Harness-mounted, with no explorer UI yet: the point is to look at real terrain early.
- Evidence: harness screenshots of a known town landblock and a known hilly/wilderness landblock.
- In-phase visual judgements: does the hillshade read as terrain shape; do roads read as roads; is
  the steep-slope tint informative or noisy; is the abstraction worth continuing. **This is the
  go/no-go gate for the whole aesthetic.**

### Phase 1 results (2026-08-23)

**Gate passed: the abstraction works.** The Holtburg map reads as a map — crisp river with banks,
a legible road network with its town courtyard, differentiated ground types, and visible relief.
Evidence in the harness via `--map`; the go/no-go screenshots were judged at 576 m, 768 m, and
1200 m view diameters.

Decisions taken while looking at it:

- **Classification is flat, shape is smooth.** Interpolating terrain and road codes across 24 m
  tiles smeared every boundary into a soft wash; roads in particular read as blurred stains.
  Classification is now resolved per triangle with the palette applied per fragment, so boundaries
  land where the data puts them. **Corrected 2026-08-23 — see below; the first version of this was
  wrong about roads.**
- **Hillshade needs vertical exaggeration.** True-scale Lambert over Holtburg's ~52 m of relief
  across more than a kilometre rendered as a flat wash. `MAP_RELIEF_EXAGGERATION` (default 4)
  steepens the shading normal only. The walkable-slope test deliberately keeps the unexaggerated
  normal, so "too steep to stand on" stays a fact about the ground rather than about the lighting.
- **Zoom bounds tuned once real.** The placeholder maximum of four landblocks clamped a requested
  1536 m view to 768 m while 49 landblocks were resident; the maximum is now eight landblocks.
  Ambient dropped from 0.45 to 0.35 to give shading more range.

Concessions and debt:

- **The 30 Hz cadence and dirty-flag loop are deferred to Phase 4.** The renderer is demand-driven
  by construction — it draws only when `render()` is called — and geometry residency is already
  keyed to `installationRevision`. A scheduler today would have no continuous consumer to pace, so
  the cadence policy lands with the panel that first animates the map.
- **Landblock-edge normal seams are unresolved.** A landblock cannot see its neighbour's heights,
  so edge vertices fall back to one-sided differences. Faint grid boundaries are visible in
  hillshade at wide zoom. Fixing it means cross-landblock height sampling at build time and a
  rebuild when neighbours arrive; judged not worth that complexity until Phase 3's harness pass
  says it distracts.
- **`linkWebGL2Program` has one consumer.** Nine scene-renderer programs still duplicate the
  compile/link/validate boilerplate the extracted helper now covers. Converting them is a
  mechanical follow-up deliberately not done mid-spike, to keep a working renderer out of the
  blast radius.

Correction after review (2026-08-23): **the first crisp version drew roads in the wrong places.**

Making the road code a `flat` varying handed each triangle the road classification of its
_provoking vertex_ — the last vertex of the triangle, a convention ES 3.0 gives no way to change.
A single authored road vertex therefore painted whole 24 m triangles, and _which_ triangles it
painted followed the index winding rather than the road. Rendering roads in magenta over one
landblock made it unmistakable: 19 of Holtburg's 81 authored vertices carry road bits, yet the map
showed sprawling triangular wedges with no coherent network. Two fixes, both now covered by tests:

- **Road coverage interpolates and the fragment stage thresholds it.** Each corner carries its own
  road presence, and the edge falls at the halfway contour, so the boundary is placed by every
  corner instead of one and stays crisp. Holtburg now draws its ring road, central plaza, and four
  radial highways continuing across landblock boundaries. This approximates retail's authored road
  alpha masks, which the map deliberately does not load.
- **Terrain type is resolved per triangle, not per provoking vertex.** The mesh is expanded per
  triangle so all three corners carry one resolved type — the majority of its corners, ties broken
  toward the lowest authored code — which makes classification depend on authored data alone rather
  than on corner order. Cost is 384 vertices per landblock instead of 81, and the index buffer is
  gone.

Bug found and fixed, which is exactly why this phase runs first:

- **Phase 0's record sections broke the frontend decode.** Both record decoders validate their
  binary section table as an exact set, so the new `mapBlocker*` and `mapFloor*` sections were
  rejected and no landblock would load at all. Rust tests and the record fixture could not catch
  it because they never exercised the TypeScript decoder. Both decoders now declare the sections —
  `mapFloor*` unconditionally on v4 interior records, and `mapBlocker*` discriminated by the
  manifest's own layer, since only buildings carry them. The static decoder's test fixture also
  moved from a positional scalar-type rule to explicit name/payload/type triples, which the
  conditional sections would otherwise have silently mistyped.

## Phase 2: Record Fold-In and Component Selection

- Decode the Phase 0 sections in `decode-env-cell-record.ts` / `decode-static-source-record.ts` and
  carry them through resolution and materialization so map geometry shares asset lifetime with the
  layers it derives from. Map geometry is a sibling output of that pipeline, never a scene-graph
  artifact; keep the fork explicit so it does not inherit scene-node lifetime.
- `GameRuntime` owns a map-geometry store keyed by landblock/env-cell, populated by the
  materialization pipeline, evicted with existing interest/retention rules.
- Implement the undirected portal flood over decoded `portalCrossings` from the **anchor's**
  residency cell, producing the current interior component (set of env-cell ids) and its aggregate
  bounds as `GameRuntime` runtime state. Only crossings whose endpoints are both env-cells carry
  connectivity; exterior transitions lead outdoors and are not adjacency. Revalidate by membership
  (`component.has(anchorCell)`); recompute only when the anchor leaves the set or component
  geometry loads/unloads.
- ~~Cross-landblock seam stitching~~ — dropped: the Phase 0 census found zero seam candidates in
  shipped data. The aperture-coincidence design in Settled Decisions stands as the documented
  approach if future content introduces one.
- Evidence: unit tests for the flood over decoded fixtures, including a stacked-interior landblock
  proving the co-resident component is excluded, a one-way (non-reciprocal) edge proving
  undirected traversal keeps it, and an eviction test proving map geometry unloads with its
  landblock.

### Phase 2 results (2026-08-23)

Decoded, stored, and proven against shipped content. With interest radius 2 around Holtburg the
runtime store holds 63 blocker instances across 12 landblocks and 221 floor instances with 670
portal crossings across 6 interior landblocks.

- **Floors ride the shell plan; blockers ride the layer source.** `ResolvedCellStructure.mapFloor`
  carries the derived floor per structure, and `EnvCellShellMaterializationPlan` gains it beside
  the `envCellId` and placement it already pairs — so the store reads instances from the plan the
  runtime already receives. Buildings decode into `ResolvedObjectLayerSource.mapBlockers`, which is
  empty for the object and generated layers rather than padded.
- **`MapGeometryStore` is a sibling of the scene, not part of it.** Installed from
  `#realizeEnvCellLayer` and `#realizeOutdoorStaticLayer`, evicted from `#evictStaticLayer`, and
  exposed as `GameRuntime.mapGeometry`. It carries its own `revision` so the renderer gets the same
  cheap dirty flag terrain gives it, and it never enters the scene graph.
- **The store takes a structural installation shape.** `MapInteriorInstallation` names only what
  the store needs rather than importing the materialization plan's type, so the pipeline knows
  nothing about the map and the map knows nothing about the pipeline.
- **The flood is undirected, and membership revalidates it.** `floodInteriorComponent` walks only
  cell-to-cell crossings; exterior transitions end the interior rather than extending it.
  `interiorComponentContains` is the whole revalidation rule, because undirected components are
  equivalence classes.

Bug found by runtime evidence, not by tests:

- **The blocker join key was semantically wrong and the type could not catch it.** Blockers were
  keyed by DAT id while a resident's `presentation.sourceAssetId` actually holds the closure's
  presentation identity (`gfx-obj/01000801`). Because `DatAssetId` is an unbranded `string`, the
  cast compiled and every test passed while the map silently paired zero of 63 buildings with a
  silhouette. The host now emits that presentation identity as the key, so the join is an exact
  string match with no parsing and no cast. This is the second Phase 0 contract defect the harness
  caught that static checks could not.

## Phase 3: Interior and Blocker Layers

- Add the flat-geometry program: floor and blocker meshes with the anchor-relative depth rule, Δz
  fade and above/below tint for interiors, flat dark fill for blockers. Floor meshes are
  deduplicated per cell structure and blockers per source DID, so both draw as instances with
  per-placement transforms rather than one merged mesh.
- Outdoor mode: terrain layer + building blockers. Indoor mode: the current component's floor
  instances only. Mode selected by anchor residency.
- Transition-portal accents in both modes: flatten each outdoor↔indoor crossing's aperture
  polygon (building-transition and unclaimed exterior apertures) into a short accent-styled stroke
  across the doorway gap, drawn above the blocker/floor layers. Outdoors this marks building
  entrances; indoors it marks the way out. Apertures are per-landblock static geometry, uploaded
  with the map meshes; whether they collapse to a screen-space glyph at low zoom is a presentation
  refinement judged in the harness.
- Evidence: harness scenes rendering the Holtburg town landblock (terrain + roads + building
  silhouettes + entrance accents) and a known multi-level dungeon (spiral/overlapping passages
  resolving to the anchor-nearest surface).
- In-phase visual judgements: floor-abstraction quirks (furniture-top walkables, large collision
  statics reading as open floor), portal accent visibility across zoom levels (glyph-collapse
  decision), doorway gaps reading as entrances, depth fade legibility on a continuous ramp.

### Phase 3 results (2026-08-23)

Both modes render from shipped content. Holtburg draws as a town — dark building footprints, the
street network, and the town wall as a thin outline — and a dungeon draws as its own connected
component with the anchor's level bright and other levels faded.

- **Vertical geometry projects to lines, and that turned out to be a feature.** Holtburg's town
  wall has no footprint area from directly above, so it draws as a thin outline rather than a mass,
  which reads exactly as a wall should on a map. No special handling was needed or added.
- **Doorways needed width invented for them.** A portal aperture is a vertical polygon, so
  projected down it has zero area and drew nothing at all. `buildTransitionAccentSurface` widens the
  aperture's thin axis into a quad at the doorway's own mid-height, so an exit on another level
  fades with its floor rather than floating at the anchor's level.
- **Accents are filtered by component indoors, unfiltered outdoors.** The first indoor render
  showed a neighbouring building's exit floating in the void beside the room. Accents now carry the
  cell they belong to and are filtered by the same membership test the floors use; outdoors every
  entrance is still worth marking.
- **The depth rule works on real continuous topology.** In a dungeon the corridor at the anchor's
  level renders bright with its exit accent while rooms at other heights fade toward the void,
  which is the behaviour discrete floor bands could not have produced.
- **One surface upload per source, drawn once per placement.** Buffers are keyed by the source
  position array, so a building model placed many times or a cell structure reused across rooms
  uploads once. Draw calls are one per placement — a few hundred at most on a small canvas at
  ≤30 Hz — so true GPU instancing is available later but not yet earned.

Concessions and debt:

- **The interior component is selected by the map, not by `GameRuntime`.** The plan placed the
  flood in runtime state, but the flood's origin is the anchor, and the anchor is app-shell control
  policy that `GameRuntime` deliberately does not know. `MapInteriorSelection` caches it beside the
  renderer instead, revalidating by membership and store revision. The runtime still owns the
  geometry and the adjacency; only the anchor-dependent selection moved.
- **Blocker silhouettes include interior structure.** A building's physics polygons cover its inner
  walls too, so a footprint is a filled mass rather than an outline of its perimeter. It reads
  correctly at town zoom and no perimeter extraction was attempted.

## Phase 4: Blips and Explorer Integration

- Verify `ObviousRadarRange` semantics against ACE and the decompile **before** implementing range
  limiting (see Open Questions); implement whatever that proves rather than the assumption.
- Blip layer drawing entity markers from `DynamicEntityView` poses and the projected radar
  properties: visibility per `ShowableOnRadar`, color per `RadarBlipColor`, extent-limited by the
  map view. Rendered at the map cadence.
- Reusable compass-framed overlay component: circularly clipped map canvas inside a compass ring
  (DOM/SVG) that rotates with the anchor heading to show true north, cardinal labels, center
  anchor marker, and a camera view-cone wedge from camera yaw and FOV. Draggable and resizable
  (resize drives `MapRenderer` extent), wheel zoom, always heading-up, coordinate readout
  reusing `formatExplorerOutdoorCoordinates`. The component lives where both the explorer and the
  client shell can mount it; explorer-specific placement and defaults stay explorer-side.
- Anchor wiring: possession mode feeds the possessed entity's pose as the anchor; other modes feed
  the camera. Selection lives in the app shell, not the map component.
- Evidence: interactive explorer acceptance outdoors in Holtburg and inside its shipped building
  (EnvCells `0xda550177-0xda550179`), plus a dungeon walk confirming component selection and depth
  shading track the anchor.
- In-phase visual judgements: CSS-rotation of the hillshaded map versus the GL-uniform fallback,
  view-cone wedge behavior in camera-anchored modes, zoom bound tuning, blip legibility at the
  shared 30 Hz cadence.

### Phase 4 review changes (2026-08-23)

Three corrections after review of the first screenshots:

- **Possession anchors on the entity, not the camera.** The Explorer fed camera position and yaw in
  every mode, which is right only while nothing is possessed. The possessed entity's own pose now
  wins, converted through `spawnedDynamicPlacementFromPoint` — the same helper the scene uses — so
  the map cannot drift from where the entity is drawn. Its heading comes from
  `mapHeadingFromSceneTransform`, which reads the transform's third column, because an entity's
  forward is AC +Y and `acVectorToRender` maps that to scene -Z.
- **The north-up toggle is gone.** Always heading-up, ring rotates; see the settled decision above.
  The `headingUp` parameter, the panel toggle, and the harness `--map-heading-up` flag were all
  removed rather than left switchable.
- **Interior height is a three-stop diverging ramp: green below, near-white at your own level, blue
  above.** Making "you are standing on this one" an explicit colour rather than merely the
  least-tinted one is what makes a dungeon legible at a glance. Colour blindness is carried by
  lightness as much as hue, deliberately: green and blue separate for the common red-green
  deficiencies, but a deuteranope sees green desaturated toward neutral — close to the near-white
  centre — and a tritanope confuses blue with green outright. The ramp is therefore monotonic in
  lightness too, so direction survives with no hue discrimination at all: brightest is here, mid is
  up, dark is down. Swapping the below tint to amber would strengthen the hue pair for red-green
  deficiency specifically and is a one-constant change that preserves that ordering. Retuning either
  end means preserving the luminance ordering it rests on: saturating the blue is what forced the
  green darker, because a vivid blue is not a light one.
- **"Your level" is a band, not a knife edge.** You stand _on_ a floor rather than at its height, so
  comparing floors to eye height made the floor underfoot read as below — the most common case,
  read wrongly. Floors within `MAP_FLOOR_SAME_LEVEL_BAND` (2.5 m, under one AC storey) are fully
  "here", and the ramp measures from there out to 6 m. Possession would have hidden this, since AC
  entity origins sit at the feet; the Explorer's free camera exposed it.

### Phase 4 results (2026-08-23)

Built, mounted, and interactively accepted in the Explorer on 2026-08-24 after the review and tuning
passes recorded below.

- **Retail's blip radius is a fixed client constant, so we dropped it.** The verification this
  phase gated on found `CPlayerSystem::GetRadarRadius` returning a flat 75 m outdoors and 25 m
  indoors (acclient.c:378719-378725), with `ObviousRadarRange` never consulted. That radius existed
  because retail's radar had one fixed scale; this map zooms, so blips are limited by the visible
  extent instead. Recorded as a `RETAIL DIVERGENCE` in `map-blips.ts` with the citation and the
  reason nothing authored can observe it.
- **Blip visibility keeps retail semantics, including the misleading enum names.** Retail's
  `InqShowableOnRadar` returns true for `ShowMovement`, `ShowAttacking`, and `ShowAlways` without
  testing movement or combat state (acclient.c:417954-417970); undefined and `ShowNever` return
  false. The map now matches that exact predicate, skips hidden entities, and never sees attached
  entities because their position belongs to a parent. The unconditional named cases are marked as
  a `RETAIL QUIRK` with the shipped 43,913-template census in `map-blips.ts`.
- **Entity poses needed a frame conversion the type system could not demand.** `pose.coords` is
  landblock-local in AC's Z-up, +Y-north frame while the map works in the canonical scene frame.
  The conversion lives in one commented helper in `map-blips.ts` rather than at call sites.
- **Blips are drawn in 2D above the GL map.** They want crisp UI styling, change for different
  reasons than geometry, and let a future client restyle markers without touching a shader.
- **The 30 Hz imperative cadence landed here, as deferred from Phase 1.** The panel drives one
  `requestAnimationFrame` loop, but samples the current frame through a callback no more often than
  every 33 ms and compares an explicit draw-state snapshot before rendering. The hot path contains
  no Svelte effect or derived state. `terrainInstallationRevision`, `mapGeometry.revision`, and the
  dynamic-placement system's owner-produced revision cover load/eviction and moving blips without
  pushing presentation-rate state through the component. Compass SVG transforms and coordinate
  text are updated imperatively from the same snapshot as the canvases.
- **The panel is a controlled component.** Position, size, and zoom are passed in and
  changes are emitted out; the Explorer owns that state, so the panel holds no persistence policy
  and a client shell can own its own. Drag, resize, wheel zoom, the rotating compass ring with
  cardinals, the camera view cone, and the AC coordinate readout are all present.

Interactive acceptance confirmed the heading-up compass, camera view cone, zoom bounds, blip
legibility, terrain treatment, interior height treatment, circular chrome, and possessed-subject
anchoring. Everything upstream of the panel is also proven against shipped content in the browser
harness: `npm run harness:browser -- --map` renders the same `MapRenderer` the panel mounts, with
`--map-size`, `--map-view-diameter`, `--map-center`, and `--map-center-height`, and reports what it
drew.

### Phase 4 defect: the map was reading a diagnostics snapshot (2026-08-23)

Reported from use: in possession the map froze — it kept redrawing, so zoom still worked, but the
content never changed and the mode stayed outdoors even after the possessed entity walked inside.

Root cause was mine, and it was a boundary mistake rather than a maths one. The map took entity
positions from the Explorer's `spawnedEntities`, which is the **entity inspector's** snapshot.
`refreshesExplorerEntityPanel` deliberately withholds ordinary integrated advances from it —
publishing the 30 Hz presentation path into Svelte would rebuild the inspector tree every host tick
— so that array only refreshes on identity changes and discontinuous corrections. A walking
character never moves it. The anchor was therefore frozen between teleports, and so were blips for
every moving entity, which was the same defect wearing different clothes.

The fix is to read the scene, which is what presentation rate actually updates:

- `GameRuntime.spawnedEntityPlacement(guid)` returns where one entity is being drawn right now,
  resolved through the spawned-presentation record to its scene root.
- `GameRuntime.listPresentedSpawnedEntities()` pairs each realized entity's identity with that live
  placement, taking identity from the runtime's own desired-entity record so nothing the map draws
  touches a diagnostics path at all.
- The panel now takes one imperative `readFrame` function rather than reactive presentation props.
  That snapshot pairs the live entity iterator with the owner-produced placement revision, because
  a list handed over is a list from whenever it was handed over. The Explorer refreshes the
  possessed entity's placement each scene frame, while the panel pulls it on its own capped cadence.
- `selectMapBlips` takes live placements instead of poses, which also deleted its AC-frame
  conversion: scene placements are already in the map's frame and landblock-local.

Worth stating as a rule the next feature should inherit: **`spawnedEntities` is diagnostics.**
Anything that draws or follows an entity reads the scene.

### Phase 4: possession orientation, settled (2026-08-23)

**The rule: the map always puts the anchor's own forward up.** The anchor is the possessed character
when something is possessed, otherwise the free camera. The boom does not orient the map while
possessed — it orbits the very character the map is about, so orienting by the orbit would swing the
map every time the operator looked around a character that had not moved. The boom's bearing reaches
the panel only to draw the view cone, which is deliberately a _different_ thing from the map's up:
in possession the map says where the character faces and the cone says where the operator is
looking, and those genuinely differ.

That distinction is the whole subtlety here. A report that possession "did not stay facing up" was
the cone being read as the character's own view, and I compounded it by briefly reorienting the map
to the camera in both modes before reverting. Worth recording so the next reader does not repeat
either half: the two indicators mean different things on purpose, and orientation belongs to the
subject the map is drawn around rather than to whatever holds the lens.

**A real defect the detour turned up.** `cameraYawRadians` was read from the free-fly controller,
which during possession receives only `applyPresentedPosition` — position, never orientation. The
boom owns orientation while it runs, so anything reading that controller got a bearing from before
possession began. Yaw is now published where it is decided, in both boom branches, with the
free-fly read guarded to when no boom runs. The view cone depends on that; the map's orientation
does not.

**A smell removed.** Heading had been a bare number whose frame each producer asserted for itself —
the camera's, and a hand-rolled matrix extraction of mine. `mapHeadingFromSceneTransform` now
derives the entity's forward vector and hands it to `createCameraLookAtAngles`, the app's one
definition of yaw, so the map cannot drift from the camera's convention. The convention was verified
rather than assumed: `Frame::get_heading` reads the image of local +Y and returns degrees clockwise
from north (acclient.c:342616-342625), and a probe against the real `acFrameTransform` path confirmed
an AC yaw of +90 degrees reads as bearing -90, because AC's axes are right-handed and a positive turn
about up takes north toward west.

### Terrain legibility: slopes and elevation (2026-08-23)

Reported from use: unclimbable slopes were not noticeable, and elevation wanted a better showing
than hillshade alone.

**Hue was already fully spent** — terrain palette, roads, the interior height ramp — so both answers
take the free channel, pattern, which has the side benefit of surviving colour blindness by
construction.

- **Unwalkable ground is hatched**, in screen-space diagonal stripes, so spacing stays readable at
  every zoom instead of collapsing into solid fill as the map pulls back. A dark tint alone had read
  as shadow rather than as impassability. A weak tint was initially kept _underneath_ the stripes as
  well, and was removed after review: it only darkened the slope without saying anything the stripes
  had not already said, and the whole expression collapsed to one mix once it went.
- **Contours carry elevation.** Hillshade shows the shape of the ground but says nothing about how
  high it is, and once relief is exaggerated a gentle rise and a cliff can shade alike. Contour
  spacing reads as steepness and contour count as height climbed. Anchor-relative outdoor tinting —
  the blue/green "above or below you" the interior uses — was considered and rejected: outdoors the
  terrain is visible in 3D, so that question is far less acute than it is indoors where geometry
  occludes.

**A correctness defect fixed alongside, which the feature would otherwise have hidden.** The
walkable test read the _smoothed_ vertex normal: a central difference across two tiles, interpolated
again across the face. That systematically under-reports exactly the features it exists to find — a
30 m step between adjacent vertices smooths to a 0.63 gradient and reads as walkable, while the face
it forms rises 30 m over one 24 m tile and cannot be climbed. Walkability is now decided once, on the
CPU, from each triangle's own geometric normal, which the un-indexed mesh had already made free.
Because the map triangulates on retail's authored diagonals, those faces are the surfaces physics
tests, so the map gives the game's answer rather than an approximation of it. The threshold uniform
is gone from the shader entirely; the decision is made where the constant lives. A test pins the
trap directly: it asserts the smoothed gradient _would_ have said walkable, and that the map does
not.

**Verified how far:** contours confirmed on real terrain around Holtburg, where they ring each
hilltop legibly at a 10 m interval. Hatching was first confirmed by temporarily inverting the
walkability flag because nothing within Holtburg's neighbourhood is genuinely unwalkable. The
completion audit then rendered real mountain landblock `0x2E36FFFF`: its authored 30–84 m height
span produces clear screen-space diagonal hatching on the genuinely unwalkable faces while
walkable faces retain their terrain treatment. The outstanding real-steep-ground check is closed.

### One height ramp, indoors and out (2026-08-23)

Contour lines now take their colour from the same three-stop ramp the interior floors use, so the
map means one thing by "above" and "below" wherever the reader is.

This is the anchor-relative encoding that was considered and rejected for outdoor _fill_ a section
above, and the rejection still stands for fill — it would fight the terrain palette. Putting it on
the _lines_ costs nothing: the fill keeps hue for terrain type, the contours carry height, and one
contour now says both how high the ground is and whether it stands above or below you.

- The ramp colours moved out of `interior` into a shared `map.heightRamp`, since two consumers now
  share them. Only the spans stay per-use: a dungeon storey is a few metres, a hillside tens, so
  contours saturate over 30 m where floors saturate over 6.
- **Coloured lines needed haloing to stay readable.** A "below" line is green and lands on green
  grass, disappearing exactly where the ground is most like it. A wider dark core beneath a narrower
  coloured one fixes it, which is how paper maps have always kept a coloured line legible over
  whatever it crosses. The halo reuses the map's void colour, so it is literally the map's own ink.
- The retuned ramp values were carried across verbatim rather than rewritten. Their lightness
  ordering is the reverse of the original — below now reads brighter than above — which is a taste
  call the invariant permits: what matters is that the three stay _ordered_, because that ordering is
  the whole redundant channel for a reader who resolves no hue. The tuning comment now states the
  invariant rather than the specific arrangement.

**Contours are referenced to the anchor subject's own elevation.** The same `MapAnchor.worldY`
already drives the interior height ramp, and it belongs to the possessed entity in possession mode
or the camera otherwise. Sampling the terrain under that position introduced a second, conflicting
notion of the anchor's elevation and made a hovering camera's contours describe the ground beneath
it rather than the subject itself. The terrain query was removed from `MapTerrainSource`; both map
modes now consume the one height fact selected by the app shell.

### Building outlines (2026-08-23)

Reported from use: a near-black footprint reads as a solid mass on pale ground and disappears
entirely on dark ground.

Buildings are now drawn twice — a stroke pass beneath the fill — so a rim of the first survives
around the second. The stroke width is authored in _pixels_ and converted to metres per frame, like
the slope hatching, so a footprint stays outlined at every zoom rather than the outline thinning
away as the map pulls back.

**The approximation, stated plainly.** A true silhouette outline of a flattened physics shell needs
a polygon union, which the map deliberately owns none of — rasterisation has been standing in for
that union since Phase 0. The stroke pass instead pushes every vertex outward from its own shape's
bounds centre, which is exact for the compact, roughly convex footprints buildings actually have and
degrades gracefully elsewhere: a deeply concave building would get an uneven rim rather than a wrong
one. The centre is the bounds centre rather than the vertex mean, because a wall modelled with many
more vertices than the floor beside it would drag a mean away from the middle of its own shape.

Vertical walls are unaffected in the way that matters: they still project to near-zero area, so they
still read as thin lines, now with a slightly thicker one.

### Panel chrome: circular silhouette (2026-08-24)

Reported from use: the frame and cardinals read flat against the rest of the Explorer, and the
compass did not want to live inside a box.

The panel is now the compass and nothing else. The bounding box is transparent — `pointer-events`
sits on the round frame rather than the section, so the square corners around the circle belong to
the scene behind it, which was verified with `elementFromPoint` rather than assumed. The header bar
is gone, and the wheel still zooms the frame.

Depth comes from the vocabulary the other panels already use rather than a new one. The bezel is the
`.ac-titlebar` gradient bent around a circle, with the same inset gold lip and outer drop shadow
`.ac-panel` carries, plus a specular highlight at the upper left so the ring reads as lit metal
instead of a flat band. The map disc is inset by the bezel and casts an inner shadow over its own
edge, so it sits _in_ the frame. Cardinals moved off the map and onto the bezel band, drawn with
`paint-order: stroke` so a dark outline is laid down before the gold fill — engraved rather than
printed — with north picked out in `--ac-gold-bright`.

The bezel is authored as a **fraction** of the panel's diameter, not a pixel width, from a single
constant that feeds the CSS inset, the disc's canvas size, and the compass's viewBox radii. Frame,
letters, and map therefore scale together, the way one piece of compass art would.

Tuned from use: the band was narrowed and the letters enlarged past the point where the band could
hold them. Cardinals are now centred on the frame's _outer_ edge and spill beyond it, which is why
the compass SVG is the one element with `overflow: visible` — it deliberately draws outside its own
viewBox. The consequence to know about is that the letters now sweep through the fixed resize stud,
so whichever cardinal passes the lower-right diagonal is partly occluded by it. Clearing them would
mean pushing the stud far enough out that it no longer sits on the rim, so the occlusion is accepted;
it reads as a handle in front of a turning compass card.

Resizing moved to a stud on the rim in the lower-right quadrant. Late review added a matching move
stud on the opposite upper-left quadrant and removed dragging from the frame itself, so a pointer
press on the map never repositions it accidentally. The formerly identical knurl marks were also
replaced with operation-specific glyphs: a four-way arrow for moving and a diagonal corner arrow for
resizing. Their size stays in pixels while everything else scales, because a hit target is not
decoration; at the minimum panel size they are proportionally large, which is the accepted cost of
not shrinking them.

### Late blip-colour audit (2026-08-24)

The authored `RadarBlipColor` does reach the map intact: catalog v8 carries the raw property and the
host types it as `RadarColor`. The visual report that most markers looked alike exposed a different
gap. Of 10,883 shipped templates whose authored radar behavior is one retail draws, 8,739 have no
explicit blip colour and only 2,144 have one. WCID 42852, `Portal to Town Network`, is one of them: it
authors `ShowAlways` but no `RadarBlipColor`; retail makes it purple through the portal-description
fallback in `gmRadarUI::GetBlipColor` (acclient.c:252927-253021).

That fallback is now producer-owned, but its palette deliberately follows the CLI's more readable
entity colours instead of retail's fallback: players are yellow, friendly creatures and vendors
bright green, hostile creatures red, portals purple, lifestones blue, mana stones cyan, and
recognized ordinary objects white. Explicit non-default authored colours still win; an absent or
explicitly `Default` property continues into the semantic fallback. This is a client-only
presentation divergence from `gmRadarUI::GetBlipColor` (acclient.c:253001-253079), and restoring
retail would erase the hostile/friendly distinction for the 8,739 of 10,883 radar-visible shipped
templates without an explicit colour. `DynamicEntityView.presentation.radar.blipColor` remains one
non-null effective fact: `selectMapBlips` and the canvas only retain and render it.

The live client already receives `Attackable` in object-description flags. Explorer now retains the
authored nullable `PropertyBool::Attackable` in catalog v8 and applies ACE's proven absent-means-true
default, rather than guessing that every `WeenieType::Creature` is hostile. That is the fact that
makes the red/green distinction available in both producer compositions.

The coordinate readout floats free below the compass, centred, borderless, over a blurred dark
plate, and is `pointer-events: none` so it never intercepts anything.

Two dead imports of the zoom bounds were removed from the panel while it was open; neither ESLint
nor knip flags an unused import inside a `.svelte` file, which is worth knowing.

### Defect: contours flooding flat ground (2026-08-24)

Reported from use as terrain being tinted by elevation the way interior floors are. It was not: the
terrain shader never tinted its base colour by height, and the reporter's own follow-up guess —
contour lines turning into filled regions — was the correct one.

**What happened.** A contour is drawn where the ground is within a pixel of a multiple of the
interval, measured as `|distance to the multiple| / fwidth(height)`. On a _flat_ face the numerator
is zero everywhere, and the guard that keeps the denominator non-zero turns "no variation at all"
into "a tiny variation", so the whole face reads as on the line and floods with line colour. The
flood colour is the shared height ramp, which is why it read as elevation tinting.

This is the common case, not a corner case. AC's terrain heights are quantised, so whole landblocks
and shelves sit on exact multiples of a 10 m interval. Holtburg's ground is flat at 20 m — two
intervals exactly — and its entire landblock was being painted 35% toward the same-level cream. The
map had looked like that since contours were added, and it was mistaken for the terrain palette.

**The fix** gates the contour on `fwidth(vHeight)`: the pixel's own height span, in metres.

**Two wrong diagnoses came first, and both are worth recording.** The first blamed hillshade; an A/B
with the shading flattened left the patch exactly where it was. The second gated on the surface
normal, which is the intuitive test for "is this ground flat" and does not work here: the normal is
a smoothed central difference, so on a flat shelf beside a cliff it reads as tilted (0.034 against a
0.02 gate) and the flood passed straight through. This is the same trap the walkable-slope test fell
into earlier in this plan, arrived at from a different direction. The screen-space height span is
the honest quantity because the failure is screen-space: it asks whether _this pixel_ spans any
height at all.

Settled by instrumenting the shader to emit its own intermediates as colour and sampling them, after
two rounds of inference had been wrong. Flooded faces span exactly 0 m per pixel; ordinary ground
spans about 5 mm. The threshold separates two populations that do not overlap, so it is not a
delicate number.

**A gate was added and then removed.** Contours also merge into a fill from the opposite direction,
where a cliff puts a whole interval of climb inside one pixel. That gate went in on inference, then
measurement showed the tightest spacing anywhere on a mountain landblock was 14.6 px against a 6 px
threshold, so it could never fire. Removed rather than kept as insurance; if merged lines ever turn
up on real content, the measurement to justify the clause will exist.

**Regression check**, since no unit test covers a shader: render `0xDA55FFFF` and confirm the ground
is green rather than pale cream.

```
npm run harness:browser -- --brief --landblock 0xda55ffff --map --map-size 512 \
  --map-view-diameter 320 --screenshot <path>
```

**Still open:** fading terrain opacity by elevation relative to the anchor, the way interior floors
fade, was raised as acceptable but not requested, and is not built. It was raised on the premise
that terrain was already being elevation-tinted, which turned out to be this defect.

### Map tuning surface

Every colour and threshold the map uses is authored in the frontend's common tuning file,
`apps/holtburger-3d/src/lib/frontend-tuning.ts`, under a top-level `map` section — beside
`rendering` rather than inside `explorer`, because the map is shared with the future client shell.
It covers hillshade direction, ambient level and relief exaggeration, every colour, the interior
height ramp and its spans, the doorway accent, blip styling, and the zoom bounds, each with the
reasoning that produced it.

`game/map/map-appearance.ts` remains, holding **no values**: it converts the authored channel-wise
colours into the `Float32Array` payloads WebGL wants, once at module scope rather than per frame.
Change appearance in the tuning file; the adapter follows.

Two things deliberately stay out of it. `RETAIL_WALKABLE_NORMAL_UP` lives in `game/walkability.ts`
because it is a fact about the ground rather than a preference, and parking it beside the tunables
would invite someone to tune it. Vertex attribute slots and shader source live with their programs,
being structure rather than policy.

Values are still compile-time. The only runtime overrides are zoom — the panel's wheel and the
harness's `--map-view-diameter` — and anchor height via `--map-center-height`, which exists so the
above-the-anchor end of the interior ramp can be exercised without finding a dungeon that rises. A
live tuning panel in the Explorer, the shape `ExplorerGradingPanel` already establishes, is the
obvious next step if colour work continues, and is not built.

## Phase 5: Cleanup, Documentation, and Quality Pass

- Document the map record sections in the format docs alongside the existing HBEC documentation,
  and the derived-walkability contract (who computes, who consumes).
- Sweep for scope creep: no scene-renderer imports in the map module, no raw physics identifiers
  on the wire, no map policy leaked into shared crates beyond the derivation.
- Clippy/lint/knip clean; delete any temporary fixtures that depend on non-checked-in runtime
  assets.

### Phase 5 results (2026-08-24)

- `docs/portal_rendering.md` now specifies the HBEC v4 `mapFloor` and buildings-layer HBSO
  `mapBlockers` sections: scalar types, element-offset ranges, local index semantics, coordinate
  frame, derivation rules, and the complete host-to-renderer ownership path.
- The scope audit found no scene-renderer import in the map module and no raw physics polygon or BSP
  field in either frontend record. Map styling and interaction policy remain app-local. Shared code
  gained only reusable source facts and semantics: the existing retail walkability constant, typed
  radar projection, and the effective semantic blip category consumed by both client compositions.
- Cleanup removed the temporary `map_census` binary and two skip-if-local-archive-exists tests. The
  shipped-content census evidence remains recorded in Phase 0, while synthetic tests retain the
  derivation and decoder invariants without depending on uncommitted runtime assets. With its only
  external diagnostic consumer gone, the host `map_geometry` module is private again.
- Stale pre-cutover vocabulary was swept from the decoder and plan: HBEC map floors are consumed,
  orientation is always heading-up, rotation lives in the shared projection matrix, and the one
  `MapAnchor.worldY` height drives both terrain contour colour and interior depth treatment.
- Quality gates passed: app Prettier and Rustfmt checks; Svelte and TypeScript checks with zero
  diagnostics; 188 frontend test files / 1,432 tests; ESLint; knip; Clippy with warnings denied;
  production Vite build; and 209 Rust tests. Vite still reports its non-failing warning that the
  shared `map-renderer` output chunk is about 724 kB minified. No workload or loading defect was
  demonstrated, so code splitting was not invented during cleanup.
- Production-content browser harnesses passed in both modes with no page-console errors. The
  outdoor run drew one terrain landblock and 42 blocker instances. The indoor run selected mode
  `indoor` and drew from 181 floor instances while retaining 528 crossings across the loaded
  236-cell interior. Interactive Explorer acceptance was confirmed before Phase 5 began.
- The pre-commit quality pass removed frame-path collection allocations, releases map GL surfaces
  when their source geometry is evicted, lets indoor floors render independently of terrain-palette
  readiness, and makes same-plane doorway accents deterministic. Record decoders now reject
  non-contiguous or malformed map surfaces, and map geometry publishes only after its scene layer
  successfully realizes. Both production map harnesses passed again after these changes.

### Completion audit corrections (2026-08-24)

The final requirement-by-requirement audit found two Phase 4 claims that the implementation did not
yet earn; both were corrected before this plan was closed.

- **Map and compass hot inputs are imperative pulls.** The first panel revision used reactive
  effects for anchor/source/camera invalidation. Explorer refreshed some of those values every
  scene frame, so the effect dirtied the map continuously, while geometry revisions and other
  entities moving did not independently dirty it. `MapPanel` now samples a single `readFrame`
  callback at the 30 Hz cap, compares explicit scalar draw facts, and updates both canvases and SVG
  chrome imperatively. Focused tests enumerate every invalidator and prove equal snapshots remain
  clean; the placement-system revision test proves active paths advance it and settled paths do
  not. A temporary canonical-harness mount of the production component rendered the mountain map,
  compass, and coordinate readout with no browser-console errors; the diagnostic mount was removed
  afterward.
- **Radar visibility is the exact retail predicate.** The old predicate hid only `ShowNever`, which
  accidentally showed undefined behavior. Decompile review proved that retail returns true only
  for `ShowMovement`, `ShowAttacking`, and `ShowAlways`, without testing movement or combat state
  (acclient.c:417954-417970). The selector and table tests now pin all five authored cases; the
  unconditional named cases carry the required `RETAIL QUIRK` marker and census.
- **Previously outstanding visual evidence is closed.** The documented `0xDA55FFFF` regression
  render confirmed exact-interval flat ground remains green rather than flooding cream, and real
  mountain landblock `0x2E36FFFF` confirmed unwalkable hatching against shipped steep terrain.

## Risks and Mitigations

- **Derived floor sections bloat records.** Floor triangles are a filtered subset of physics
  polygons and should be small relative to render geometry; measure in Phase 0 fixtures and record
  section sizes before committing the format.
- **Physics-derived floors may include non-obvious walkable surfaces** (tops of furniture-scale
  collision, ledges). Acceptable for v1 — they are genuinely walkable — but note anything visually
  confusing during Phase 2 harness review before inventing filters.
- **A second GL context on constrained hardware.** The map context allocates a few small buffers
  and no large textures; if creation fails, the map component reports unavailable rather than
  degrading the scene renderer.
- **Blip property projection widens the entity feed.** Three small fields; validate against the
  existing feed versioning so stale hosts fail loudly rather than rendering wrong blips.

## Definition of Done

- Outdoor map shows hillshaded terrain, roads, and building silhouettes for the current interest
  area; indoor map shows the anchor's portal-connected component with anchor-relative depth
  shading; the mode follows anchor residency.
- Blip visibility is driven by projected retail radar properties. Explicit non-default authored
  colors win; absent/default colors use the documented CLI-inspired semantic fallback. The visible
  map extent replaces retail's fixed-range clipping as the other documented divergence.
- All heavy derivation happens at load in the host projection and materialization pipeline; steady-
  state per-tick cost is one small ortho draw at ≤30 Hz.
- The map module has no scene-renderer dependencies, and the explorer wrapper contains all
  explorer-specific presentation policy.
- No raw physics polygons, physics BSPs, or radii are serialized to the frontend.

## Open Questions

- ~~**Road data availability.**~~ Resolved 2026-08-23: the terrain worker source carries the raw
  9×9 `terrainSamples: Uint16Array` including road pcode bits (`terrain/types.ts:99-100`), with
  `roadCodeOf` extraction and per-cell road-code packing already in `terrain-generator.ts:134-140`.
  The map terrain layer styles roads from data already resident client-side; no contract change.
- ~~**Seam and one-way edge censuses.**~~ Resolved 2026-08-23 — see Phase 0 results: zero seam
  candidates (stitching dropped from Phase 1), and 108 one-way edges out of 1.35M (undirected
  traversal needs no additional policy).
- ~~**Outdoor blocker semantics for walk-through geometry.**~~ Decided 2026-08-23: blocker
  silhouettes omit portal-flagged polygons so doorways stay open on the map. Identification
  mechanism proven in Phase 0: drawing-BSP `CPortalPoly` polygon ids name polygons that also exist
  in the physics set on all 384 shipped building GfxObjs (see Phase 0 results); synthetic unit
  coverage pins the exclusion rule without depending on a local runtime archive.
- ~~**`ObviousRadarRange` semantics are unverified.**~~ Resolved 2026-08-23, and the assumption was
  wrong: retail's radar range is not a per-object property at all.
  `CPlayerSystem::GetRadarRadius` returns a flat **75 m outdoors and 25 m indoors**
  (acclient.c:378719-378725), and the blip test is a horizontal distance compare against it
  (acclient.c:254410-254415). `ObviousRadarRange` is read nowhere in ACE's server logic beyond its
  enum declaration, so it never governed radar drawing. Blips therefore ignore it entirely; see the
  divergence note in Phase 4 for what replaces it.
- **Map range is bounded by scene interest.** The map draws only hydrated landblocks, so maximum
  useful zoom-out is capped by the existing interest radii. V1 accepts this; a map-specific
  interest policy (or pre-baked far-range tiles) is a follow-up only if harness use shows the
  ceiling matters.
- **Presentation polish** (sketch-style post-processing, crossfades) is deferred until the abstract
  rendering is judged in the harness.
