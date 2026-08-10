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
- `apps/holtburger-3d/src-tauri/src/cell_struct_projection.rs`
- `apps/holtburger-3d/src-tauri/src/env_cell_source.rs`
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

## Potentially-Visible Lists

The EnvCell `visible_cells` list is preserved as potentially-visible source data. It is useful as
preload or candidate provenance, but it is not a hard rejection filter for portal traversal.
Runtime visibility follows proven directed topology and per-view aperture windows.

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
5. applies the physical-pixel footprint cutoff to ordinary crossings; and
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
issues no portal planning, stencil masks, or offscreen rendering.

CellStruct shell ranges receive a flat-mode back-face culling override so a bird's-eye view can see
interiors rather than opaque cell shells. Residents and outdoor objects retain their authored
culling behavior.

## Proven Scope and Deferred Work

Proven by synthetic tests and selected archive/browser fixtures:

- arbitrary planar, non-axis-aligned apertures;
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
