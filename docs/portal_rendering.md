# Asheron's Call Environment-Cell Portal Rendering

This document separates authored Asheron's Call portal facts, host-proven derived facts, runtime
spatial queries, and `holtburger-3d` renderer policy. Those are related, but they are not
interchangeable.

World-magic portals are unrelated to this document.

## Source Records

An indoor `EnvCell` record contains:

- an Environment and CellStruct selector;
- the cell's landblock-space placement;
- surface IDs selected for that CellStruct instance;
- directed portal records;
- a potentially-visible cell list; and
- optional static residents.

Each EnvCell portal record carries `flags`, `polygon_id`, `other_cell_id`, and
`other_portal_id`. Flag `0x04` marks an outside endpoint. Flag `0x01` is the retail
`ExactMatch` fact used below. Flag `0x02` selects the positive accepted plane side; without it the
directed crossing accepts the negative side.

An `Environment` record contains reusable CellStructs. A CellStruct contains a vertex array,
surface-bearing polygons, a list of portal polygon IDs, a Cell BSP, physics polygons/BSP, and an
optional drawing BSP.

Primary implementation references:

- `crates/holtburger-dat/src/file_type/env_cell.rs`
- `crates/holtburger-dat/src/file_type/environment.rs`
- `crates/holtburger-content/src/interior.rs`
- `apps/holtburger-3d/host/src/cell_struct_projection.rs`
- `apps/holtburger-3d/host/src/env_cell_source.rs`
- retail `CCellPortal::UnPack`, `CCellStruct::point_in_cell`, `PView::DrawCells`, and
  `D3DPolyRender::DrawPortalPolyInternal` in `acclient-eor-source/acclient.c`

## CellStruct Surfaces and Apertures

CellStruct geometry is reusable, but its surface slots are selected by each EnvCell. Holtburger
therefore shares geometry while retaining per-cell material bindings and placement.

Polygon sides are projected independently. A side with no surface is not invented as visible
geometry. This handles the `NoPos`/`NoNeg` family of source semantics without treating a portal
polygon as an ordinary textured wall.

Portal polygons are also projected as separate material-free apertures:

- three or more authored vertices;
- fan-triangulated indices;
- a normalized planar equation;
- finite bounds; and
- a stable authored identity.

A polygon may contribute a visible, surface-bearing side and also name an aperture. The aperture
itself never receives a texture or material range.

Portal polygons are planar but are not assumed to be rectangular or axis-aligned.

## Derived Overhead-Map Geometry

The app host derives the map's navigational geometry while producing source records. Raw physics
polygons and physics BSPs do not cross the host boundary. The frontend receives only indexed
triangle meshes in source-local render coordinates, where an authored AC `(x, y, z)` position is
stored as render `(x, z, -y)`.

This is an ownership boundary, not just a compact encoding:

1. the host reads authoritative physics polygons and decides which geometry contributes;
2. the source-record decoder validates and resolves the derived meshes;
3. normal materialization carries them beside the render artifacts derived from the same source;
4. `MapGeometryStore` installs and evicts them with their EnvCell or buildings layer; and
5. the overhead renderer consumes those meshes without reading physics data or re-deriving
   walkability.

Map geometry is a sibling materialization output, not scene-graph content. Sharing source-layer
lifetime keeps it synchronized with loaded content without making the scene renderer own a second
view of the world.

### HBEC v4 walkable floors

Every present HBEC v4 record contains these additional typed sections:

| Section             | Scalar              | Meaning                                             |
| ------------------- | ------------------- | --------------------------------------------------- |
| `mapFloorPositions` | little-endian `f32` | Packed structure-local render `(x, y, z)` vertices. |
| `mapFloorIndices`   | little-endian `u32` | Packed triangle indices.                            |

Each entry in the manifest's `structures` array contains a `mapFloor` object:

| Field            | Unit           | Meaning                                                   |
| ---------------- | -------------- | --------------------------------------------------------- |
| `positionOffset` | `f32` elements | First position component in `mapFloorPositions`.          |
| `vertexCount`    | vertices       | Number of three-component positions in the range.         |
| `indexOffset`    | `u32` elements | First index in `mapFloorIndices`.                         |
| `indexCount`     | indices        | Number of indices in the range; triangles occupy triples. |

Indices are local to that structure's sliced position range. Empty ranges are valid for structures
with no walkable physics polygons. One range exists per distinct CellStruct, and every EnvCell
instance reuses it through the structure's ordinary landblock-local placement.

The host computes the mesh from the CellStruct's physics polygons. It calculates each polygon's
face normal in authored Z-up coordinates and retains an up-facing side when
`normal.z >= 0.66417414`, retail's `PhysicsGlobals::floor_z` test
(`CPhysicsObj::is_valid_walkable`, `acclient.c:304992-304995`). A double-sided polygon also retains
its reversed underside when that side passes the same test. Kept polygons are fan-triangulated;
zero-area polygons contribute nothing. Because the filter runs in structure-local space, HBEC
production fails if any consuming cell placement does not preserve the up axis.

### HBSO building blockers

Only a buildings-layer HBSO record contains `mapBlockers` and requires these typed sections:

| Section               | Scalar              | Meaning                                          |
| --------------------- | ------------------- | ------------------------------------------------ |
| `mapBlockerPositions` | little-endian `f32` | Packed GfxObj-local render `(x, y, z)` vertices. |
| `mapBlockerIndices`   | little-endian `u32` | Packed triangle indices.                         |

Each `mapBlockers` manifest entry contains `sourceAssetId`, `positionOffset`, `vertexCount`,
`indexOffset`, and `indexCount`, with the same element-offset and local-index rules as HBEC floors.
`sourceAssetId` is the presentation identity used to join the derived mesh to every resident that
instances that GfxObj; one blocker is emitted per distinct building source rather than per
placement.

The blocker contains every non-degenerate physics polygon except polygon IDs claimed by the
GfxObj's authored portal apertures. Excluding those polygons keeps doorways open instead of
stamping them shut in the top-down silhouette. Objects and generated-scenery HBSO records carry no
`mapBlockers` field or blocker sections: the overhead map represents navigational structure, not
scenery.

Primary implementation references:

- `apps/holtburger-3d/host/src/map_geometry.rs`
- `apps/holtburger-3d/host/src/env_cell_source.rs`
- `apps/holtburger-3d/host/src/lib.rs` (`append_building_map_blockers`)
- `apps/holtburger-3d/src/lib/assets/decode-env-cell-record.ts`
- `apps/holtburger-3d/src/lib/assets/decode-static-source-record.ts`
- `apps/holtburger-3d/src/lib/game/map/map-geometry-store.ts`

## Directed Topology

Portal topology is directed. An EnvCell portal names a target cell and portal selector, but a
reciprocal relationship is accepted only when the target record points back to the source.

Outside EnvCell endpoints may be claimed by a landblock building portal. A unique valid claim
creates the outdoor-to-indoor direction using the building GfxObj's authored portal aperture. The
EnvCell record supplies the indoor-to-outdoor direction. An unclaimed outside endpoint remains
explicit; the runtime can prevent an outdoor segment query from silently crossing that unavailable
boundary.

Every directed crossing retains:

- source and target scopes;
- source aperture;
- accepted plane side;
- `ExactMatch`;
- reciprocal identity when proven; and
- its spatial relationship: indoor depth-continuous, indoor topology boundary, or exterior
  transition.

## What `ExactMatch` Means Here

`ExactMatch` is an authored portal flag, not a promise that Holtburger may blindly merge two
cells. A reciprocal indoor seam is classified as ordinary depth-continuous only when all of these
are proven:

1. reciprocal record identity;
2. `ExactMatch` on both directed records;
3. equivalent transformed aperture geometry;
4. opposed accepted half-spaces; and
5. both cell bounds stay on their expected sides of the portal plane.

Failure of any proof preserves an indoor topology boundary and its reason. Depth-continuous seams
form renderer scheduling islands because ordinary depth can resolve their geometry without a
mask.

## Effective Visibility Apertures

Spatial queries must use authored apertures. Rendering sometimes needs a stricter aperture.

For an exact crossing, or one whose reciprocal cannot be proven, the effective visibility aperture
is the authored source aperture. For a non-`ExactMatch` reciprocal pair, the app-local host
intersects the two coplanar authored apertures once and serializes the result as a distinct
material-free effective aperture. Static provenance records the reciprocal aperture and
intersection evidence.

This preprocessing occurs while producing the HBEC v2 source record. It is not repeated per frame.
It does not modify authored crossing geometry, Cell BSP containment, collision, or movement
queries.

Malformed, non-coplanar, or over-tolerance reciprocal intersections fail source production rather
than falling back to a larger leaky window.

## Coincident Portal Junctions

Some structures are authored as several adjacent buildings whose outdoor transition apertures
coincide: one building's exit polygon and its neighbour's entry polygon occupy the same plane and
overlap in area, chaining their cells through a zero-thickness slab of the outdoor domain. A census
of `0xF418FFFF` found twelve such junctions; the arrangement recurs across the archive but is not
common.

At HBEC source production the host detects these pairs with the same planar machinery that
synthesizes reciprocal visibility apertures: crossings whose source apertures are coplanar within
tolerance and share interior area form one junction group. Groups are connected components over
that pairwise predicate; each receives a record-local ordinal emitted as `junctionGroupId` on every
member crossing. Pure reciprocal pairs — every ordinary doorway's two directed crossings — receive
no id, because reciprocal suppression already covers them.

The exemption this licenses is bounded. A component is declined, with a logged warning and no ids,
when any single render domain contributes more than two member crossings; visibility islands are
derived host-side (union-find over proven depth-continuous seams, emitted as the
`cellIslandIndices` section) precisely so this bound counts per render domain rather than per
authored cell. Within the bound, a same-depth walk can take at most one junction step —
reciprocal suppression removes one of the two same-domain exits — before depth strictly increases
again, so the compositor's convergence measure survives. An archive census never observed a
component whose domain contributed more than two.

The frontend qualifies record-local ids scene-globally (landblock grid packed above the ordinal)
because outdoor is one render domain across landblocks. The propagation shader and every CPU model
then admit an equal-depth advance exactly when the arrival and candidate crossings share one
junction id; all other equal-or-shallower candidates remain rejected as backtracking.

The strict entry test itself is Holtburger's construct, not retail compatibility: retail's
`PView::ClipPortals` terminates indoor traversal at exterior endpoints and re-enters buildings from
the outdoor pass (`acclient.c:441813-441942`, `:442040-442090`), so it never compares entry depths
at all. The test exists here as the path-free propagation's convergence measure, and the junction
fact is the host-proven exemption that keeps it from rejecting authored zero-thickness geometry.

## Potentially-Visible Lists

The EnvCell `visible_cells` list is preserved as potentially-visible source data. It is useful as
preload or candidate provenance, but it is not a hard rejection filter for portal traversal.
Runtime visibility follows proven directed topology and per-view aperture windows.

Retail does apply these authored lists as a hard working-set bound before following portals
(`CEnvCell::grab_visible_cells`, `acclient.c:335978-335986`, and `PView::ClipPortals`,
`acclient.c:441813-441858`). Holtburger evaluated that policy rather than assuming the lists were
complete. An archive census found no missing direct portal neighbors, but it found 294,751
directional PVS asymmetries. The authoritative Facility Hub omission is twelve portal steps from
its inverse-listed cell, so direct-neighbor closure cannot repair it.

Across 576 deterministic camera poses, hard authored filtering preserved the exact atlas selection
for 364 of 456 indoor poses and removed 220 selected-scope occurrences in the remainder. The
selection-preserving Facility and large-dungeon strata removed no traversal or projection work.
Consequently hard PVS rejection is neither a no-regression optimization nor a demonstrated Pareto
improvement. Building-portal `stab_list` remains host-side source data and was censused separately;
it is not synthesized into the frontend topology solely for this experiment.

## Runtime Spatial Queries

Point lookup is deliberately not a first-match operation:

1. world position chooses the outdoor landblock candidate;
2. EnvCell AABBs provide a broad phase, including cells from neighboring resident landblocks;
3. the Cell BSP positive-child plane chain supplies an exact containment verdict; and
4. every candidate is returned so overlapping/non-Euclidean ambiguity is preserved.

Explorer initial placement may choose from these facts because it has no portal-crossing history.
A future game client should instead retain authoritative actor residency and use directed segment
tracing for camera or motion endpoints.

Directed segment tracing:

- starts from caller-supplied authoritative residency;
- examines only outgoing crossings from the current scope;
- rejects reverse-facing travel, plane touches, coplanar travel, and finite-aperture misses;
- selects the earliest crossing;
- preserves ambiguity when equal-time crossings disagree; and
- uses authored apertures, never effective render intersections.

These are query primitives, not a player or third-person camera controller.

## Production Portal Compositor

Portal mode uses a path-free arrival-state model. The CPU determines which authored scopes and
directed crossings can contribute; the GPU determines, per pixel, which arrival state is nearest.
No domain-owned contribution schedule, permanent stencil id, or per-path scene submission survives
into production.

### Fixed-capacity scope-window culling

The camera's authoritative scope starts with the full normalized screen window. The culler advances
breadth-first in complete crossing frontiers. For each admitted scope-window delta it:

1. visits that scope's source-keyed outgoing crossings;
2. suppresses only the reciprocal/shared aperture that admitted the delta;
3. rejects wrong-facing apertures unless the finite near-clip volume intersects them;
4. projects the effective visibility aperture and clips it by the inherited window;
5. applies the footprint cutoff to ordinary crossings, authored in CSS pixels and resolved to
   drawing-buffer pixels for the frame's render scale; and
6. admits only window coverage not already present for the target scope.

Coverage is accumulated by authored scope, not render domain or topology path. This is legal because
retail clips portal screen windows but does not install a portal user clip plane on scene geometry:
objects may protrude outside the aperture that made their scope visible. The compatibility rule and
decompile citation live beside the symbolic oracle in
`portal-reference-compositor.ts` (`PView::ClipPortals`,
`acclient.c:441813-441942`).

Production uses typed-array topology indexes, queues, and polygon arenas. At fixed topology and
capacity an accepted camera update creates no portal-owned JavaScript records and grows no arena.
A separate readable immutable traversal is retained only as a differential oracle. It shares
projection inputs and tolerances with production, but not clipping/admission control flow.

EnvCell realization creates one scene aperture object per authored aperture index. Crossings refer
to those objects, and `SceneGraph` retains one defensive geometry copy per producer object rather
than copying source and visibility geometry into every directed crossing. The topology-lifetime
projection preparation cache therefore also runs once per distinct visibility aperture. This is a
browser ownership collapse only: host records, topology identities, selected crossing streams, GPU
uploads, and physical draw batches are unchanged.

Ordinary crossings split camera-dependent aperture projection from route-dependent inherited-window
intersection. A generation-stamped cache indexed by stable crossing id retains the normalized NDC
aperture only when traversal attempts the same crossing for a third route in one camera plan; any
fourth and later routes intersect that retained aperture directly. Waiting until the third attempt
avoids the measured second-use case where a cache write had no later consumer. Near-plane-straddling
forms bypass the cache because the retained corpus found no repeated near-plane projection form.

The cache is performance-only fixed storage: at most 256 crossing forms, 256 fragments, and 1,024
vertices. Its topology-lifetime crossing metadata and payload consumed 19--90 KiB across the
retained landblocks. Exhaustion declines only that promotion and resumes ordinary projection; it
cannot truncate visibility, grow an arena, or allocate a frame record. Cache hits still charge the
original projection cost to the established cutoff budget, so reuse cannot admit a deeper complete
frontier merely by making projection cheaper.

Final crossing materialization is adaptive. Sparse selections enumerate only the already-packed
outgoing ranges of selected scopes, mark accepted crossings in a one-bit-per-crossing buffer, and
scan packed words to recover canonical crossing-id order. A topology-derived bound chooses this
path only when its worst-case iterations beat the direct whole-crossing scan; dense selections keep
the direct scan. Reciprocal arrival ids and crossing-stream order are therefore unchanged.

Capacity is part of the visual contract:

- traversal depth, work items, checked projection primitives, window storage, arrival ids, crossing
  triangle vertices, atlas pixels, target bytes, and device texture extent are explicit limits;
- the first over-budget complete frontier is omitted atomically;
- descendants of that frontier are never discovered;
- no fallback planner or partial GPU mutation runs; and
- stencil capacity is irrelevant because the selected backend does not use stencil.

The production policy currently accepts at most 16 crossing frontiers and 256 arrival-state values.
Those values have one named owner in `portal-render-capacity-policy.ts`.

### Packed render-domain atlas

Every selected outdoor or proof-backed indoor visibility-island render domain receives one
conservative rectangular tile in a fixed 2-by-3 atlas. Authored EnvCell scopes remain independent
for portal traversal and scene selection; selected member windows are unioned only when deriving
their shared render-domain tile. The renderer performs the ordinary scene query once for the
complete selected scope set, resolves physical contributions once, and preserves existing
material/instance batch boundaries.

Opaque and alpha-tested work retains its authored scope key, which resolves directly to the owning
render-domain tile:

- outdoor terrain and exterior-global opaque sky work route to the outdoor tile;
- a scope-homogeneous object draw routes to its scope's visibility-island tile;
- local depth remains independent between tiles; and
- the same physical batch is not split merely because a scope has multiple portal appearances.

Packed-tile routing retains only immediately live device state. Consecutive draws targeting the
same render domain reuse the current viewport, and the clip transform is rewritten only when the
tile changes or ordinary program setup has overwritten that program's uniform. Adjacent draws from
the same authored scope also reuse their scalar scope-to-domain lookup. This state suppression does
not reorder submissions or create a material, scope, or domain batch key.

Depth-continuous member-cell crossings constrain CPU traversal but do not enter GPU propagation.
Ordinary shared depth already composes their geometry, so retaining those crossings would
manufacture internal compositor seams and consume arrival-state work with no ownership transition.

The atlas stores `RGBA8` color and `DEPTH_COMPONENT24` local depth. Packing gaps are charged in
target bytes and exposed separately from committed tile pixels.

### Arrival propagation and opaque resolve

Each selected cross-domain directed crossing is expanded once into a reusable instanced triangle
stream. Propagation starts with arrival state zero for the root render domain. Two full-screen `R8UI` textures
ping-pong the current/next arrival id while one shared `DEPTH_COMPONENT24` texture selects the
nearest eligible crossing. One batched propagation draw covers every selected crossing in a
retained propagation round; the CPU does not walk pixels, paths, or per-crossing draw calls. A
complete CPU cull uses the model's fixed path-depth ceiling as the universal propagation bound,
further capped by selected crossing count. A capacity-truncated cull instead uses its last complete
frontier depth.

Alongside propagation, one instanced reduction draw per retained round writes the maximum visible
exit depth for every selected render domain into a packed `DEPTH_COMPONENT32F` envelope. A final
instanced opaque resolve samples the winning domain tile's color/local depth and composes it into the output
framebuffer. Resolve accepts equal output depth so the terminal scope's sky or empty background,
which intentionally retains clear depth, survives composition. The envelope rejects every
nonterminal scope at that depth before fixed-function depth testing. Root-only scenes use the same
schedule.

This is why indoor/outdoor re-entry and cycles no longer require special cases: re-entering a render
domain creates another arrival state, while its physical geometry still occupies one domain tile.

### Deferred objects, particles, and weather

Portal visibility is not an alpha-sort key. Opaque resolve completes first. Transparent objects,
additive effects, and particles retain the renderer's existing physical ordering and batching, then
draw once to the output framebuffer. Their portal shader selects the owning authored scope and
resolves its render domain, then rejects fragments beyond that domain's reduced visibility envelope.

Particle emitters remain owner-local until routing. Each selected source is packed/uploaded once,
then compatible mesh/motion cohorts recoalesce without adding a path or portal id to the GPU batch
key. This lets particles in the camera's EnvCell draw over an outdoor portal exactly as retail does,
while particles belonging to a deeper scope remain clipped by that deeper scope's envelope.

Exterior sky and authored weather are rendered into the outdoor render-domain tile. Retail's existing
inside/outside weather gate remains camera-residency policy and is independent from portal
compositing.

### User-switchable near-field ambient occlusion

Ambient occlusion is a renderer-owned consumer of the already-complete opaque scene;
it is not a second portal compositor or a render-graph stage. When enabled, one screen-space pass
reads local depth after terrain and opaque/alpha-tested objects. Exact instanced quads restrict
rasterization to planner-owned render-domain tile rectangles; evaluation rejects unavailable
off-tile taps and filtering remains tile-local. The pass writes the shaded color back into the same
atlas, invalidates the compositor's immediately-live opaque-tile binding cache, and leaves portal
planning, propagation, resolve, and deferred routing unchanged.

The pass derives normals from depth and uses two transactional full-resolution `R8` scratch
targets. The targets are allocated lazily, reused at the same extent, replaced only after a complete
resize allocation, and released when ambient occlusion is disabled or the renderer is destroyed.
Disabled frames allocate no ambient-occlusion targets and submit no ambient-occlusion draws.

Explorer snapshots enablement, strength, world-space radius, bias, and bilateral edge threshold
with the rest of each frame's display settings. These appearance values update shader uniforms
without reallocating scratch targets or selecting another render schedule. Distance eligibility is
a read-only diagnostic owned entirely by renderer tuning. Scratch resolution
and kernel sample count remain immutable quality choices because they change allocation and
performance contracts rather than presentation alone.

Only pixels with opaque depth receive occlusion, and the effect fades to neutral across its fixed
64-to-128-unit near-field range independently of authored fog. Clear-depth sky remains neutral. After-landscape sky/weather,
transparent objects, additive effects, and particles retain their existing order after the pass
and therefore neither cast nor receive ambient occlusion. The feature defaults on after passing its
visual, motion, and performance gates, while the user switch can restore retail presentation.

### Targets and lifecycle

One lazy renderer-owned target generation contains four framebuffers and six textures:

- packed atlas `RGBA8` color plus `DEPTH_COMPONENT24` depth;
- two full-screen `R8UI` arrival-state frontiers;
- one shared full-screen `DEPTH_COMPONENT24` crossing-depth texture; and
- one packed `DEPTH_COMPONENT32F` render-domain envelope texture.

Same-extent frames reuse the generation. Resize is transactional: every replacement framebuffer
must be complete before the old generation is disposed. The configured byte ceiling is 256 MiB,
and device `MAX_TEXTURE_SIZE` is checked before allocation. Capacity failure stops portal
composition loudly; WebGL context loss requires whole-renderer restart.

Flat mode performs no portal planning or GPU commands. An already allocated generation remains
cached across mode switches and is destroyed with the renderer.

## Flat Inspection Mode

Flat mode remains permanently selectable in the explorer. It selects outdoor plus every resident
EnvCell scope, then runs the same culling-group and exact-node frustum tests as portal mode. It
issues no portal planning or stencil masks.

Every flat frame uses one renderer-owned full-drawing-buffer `RGBA8` color/
`DEPTH_COMPONENT24` scene target, regardless of whether ambient occlusion or profiling is enabled.
Terrain and opaque/alpha-tested objects draw into that target, optional ambient occlusion consumes
its completed opaque color/depth, and after-landscape sky/weather draws afterward. One presentation
draw then copies exact scene color and sampled depth to the output framebuffer before transparent
objects and particles run there. This single schedule preserves depth for deferred work without a
direct-to-output compatibility path. The flat target is resized transactionally, retained across
same-extent frames, and destroyed with the renderer; context loss still requires a whole-renderer
restart.

CellStruct shell ranges receive a flat-mode back-face culling override so a bird's-eye view can see
interiors rather than opaque cell shells. Residents and outdoor objects retain their authored
culling behavior.

## Proven Scope and Deferred Work

Proven by synthetic tests and selected archive/browser fixtures:

- arbitrary planar, non-axis-aligned apertures;
- coincident-junction detection, the group-size degradation bound, and zero-thickness transit
  through shared junction ids, on the GPU and in every CPU model;
- authored/effective aperture separation;
- reciprocal intersection preprocessing;
- Cell BSP point containment;
- directed finite-aperture segment tracing;
- fixed-capacity scope-local traversal with whole-frontier cutoff;
- immutable/arena differential equivalence over seeded topology and geometry corpora;
- path-free arrival propagation through indoor/outdoor cycles and re-entry;
- one physical opaque preparation/submission per selected scope;
- transparent, additive, weather, and particle scope-envelope composition;
- packed target format, byte accounting, resize, and disposal invariants;
- near-plane straddles;
- flat/portal lifecycle stability; and
- universal static detail roles for building, environment, and object materials.

Deliberately deferred:

- authoritative player movement and portal-crossing history;
- third-person camera residency policy;
- collision response;
- using potentially-visible lists as preload policy;
- portal-frustum planes in the scene spatial index; and
- context restoration after WebGL context loss.

Context loss deliberately requests whole-renderer restart rather than reconstructing a partial
portal target generation in place.
