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

## Per-View Portal Planning

Portal rendering starts by assigning the full screen-space view window to the camera's supplied
scope only. Traversal coverage and render ownership are separate:

- one exact scope-local window controls which outgoing crossings may be traversed;
- one proof-backed visibility island owns the geometry for its reached member scopes; and
- reaching another scope in an existing island extends that node's selected scope list without
  giving every island member the same window.

For each admitted scope-window delta, the planner:

1. considers source-keyed outgoing crossings;
2. skips the proven reciprocal or shared authored aperture used to admit that delta;
3. rejects apertures not facing the camera, except finite near-plane straddles;
4. projects the effective visibility aperture;
5. clips it through the incoming view window;
6. admits only new, non-subsumed window coverage; and
7. records a target render node and, only across render-domain boundaries, an incoming mask edge.

Incoming-crossing provenance suppresses only immediate backtracking through the same physical
portal. It does not suppress a later return through a different portal. This mirrors retail
`PView::AddToCell`/`AddViewToPortals`, where the incoming portal is marked and excluded while
expanding the newly reached cell.

Depth-continuous seams and same-domain topology boundaries propagate the clipped window to their
target scope without consuming stencil. A same-domain boundary can therefore constrain traversal
even though ordinary depth already unifies its endpoints for drawing.

Windows are renderer-local visibility geometry. Scene meshes are not CPU-clipped. Ordinary scene
selection still uses frustum tests over scope/culling-group/node bounds.

A render node owns one outdoor domain or one proof-backed indoor visibility island. Its geometry
query contains only member scopes reached by exact traversal. Alternate routes add incoming mask
edges; they do not create another geometry owner.

The planner assigns render layers, identifies graph cycles, prepares the outdoor-containing
component, authors an executable contribution schedule, and preflights the available eight-bit
stencil labels. Exact windows remove triangulation-only seams when adjacent pieces have a convex
union and cache immutable aperture convex decomposition by source identity. Concave, holed,
overlapping, and disconnected regions remain explicit. A work limit exists only as a
failed-invariant guard; monotonic scope-local window admission is the termination model.

## Mask and Direct Ownership Execution

The executor consumes the completed graph and derives no second topology or contribution plan.

For each ordinary masked contribution:

- every incoming effective aperture is drawn material-free into the same stencil label;
- the union is completed before ordinary geometry is submitted;
- depth is reset only inside that union when the target contribution requires a fresh scene
  domain; and
- the planner-named render nodes are submitted under that label.

Ordinary contributions use a layer-wide stencil union, not a paired source/target aperture
protocol or increment/decrement mask stack. Before any same-layer contribution changes depth, the
executor completes every unrelated entry union under its planner-owned label.

A cyclic exterior component may have one explicit indoor suffix. Its entry and suffix labels are
adjacent values above the ordinary render layers. Internal suffix apertures increment only pixels
whose stencil still equals the entry label, so the result is exactly the suffix label and cannot
escape the exterior entry region. The suffix classifies each submitted node as either deferred
from ordinary execution or additional masked work for a node already drawn elsewhere. This
guarded increment is a typed planner/executor contract, not an executor-created route or general
stencil stack.

Internal masks use existing depth (`LEQUAL`) so nearer geometry can occlude an opening. A portal
polygon may also carry an opaque CellStruct surface, including horizontal floor portals such as
`0x1A7302B2 -> 0x1A73029D`. Re-rasterizing that aperture at equal depth would let the mask
intermittently replace its own visible floor as projection slope changes. The host therefore marks
crossings whose authored source portal also contributes shell triangles. Only those mask writes
enable `POLYGON_OFFSET_FILL` with `polygonOffset(1, 1)`, conservatively pushing the mask behind its
coincident visible geometry. Material-free apertures retain unbiased `LEQUAL`, which preserves
equality needed by nested portal unions. Scene passes explicitly disable polygon offset, so
CellStruct depth and seams remain unbiased. The accepted browser matrix also covers opaque,
alpha-tested, transparent, and additive contributions.

## Outdoor Transitions

Every admitted outdoor/indoor transition is masked unless the finite camera near plane intersects
its aperture. An apparently shallow entrance can lead to a cell below terrain one edge later, so
an optimization that skips the transition mask based on the immediate cell is unsafe. Near-plane
contact is a separate, exact renderer condition rather than such an optimization.

The renderer owns one full-size color plus depth-stencil portal target. It is cleared once per
independent view, and every reached scene domain renders directly into that target.

For an outdoor root, exterior terrain, buildings, and objects render unmasked as layer zero. For
an indoor root, all exterior entry masks are completed against the existing root depth first.
Color and depth inside the exterior label are then initialized to the view clear values, and the
exterior renders once under that label. Root color and depth remain untouched outside the entry
union.

If the outdoor strongly connected component contains re-entered indoor work, its internal masks
promote only entry-owned pixels to the adjacent suffix label. Suffix depth is reset without
changing the exterior color beneath it, then the suffix submission groups render together under
that label to preserve global material ordering. A root island may therefore render ordinarily at
layer zero and again as an additional masked suffix after exterior initialization. Non-root
suffix nodes can instead be deferred from ordinary execution. Return-to-outdoor edges remain graph
provenance and do not redraw the exterior. Unrelated same-layer contributions use distinct labels
whose masks were completed before either contribution mutated depth.

The target is allocated lazily, reused at the same extent, replaced transactionally on resize,
and destroyed with the renderer. Flat mode performs no target or portal work, although an already
allocated target remains cached for cheap mode switching.

## Near-Plane Straddles

The unstable case is not the camera point touching a portal plane. It is the finite aperture
entering the clipped volume between the camera eye and near-plane quad.

The renderer constructs and validates that finite pyramid once per view from the typed eye and
ordered near-plane corners. Its five normalized planes are then reused for every crossing. The
world-space contact band is renderer-owned and independent from scene-query tolerances; plane
degeneracy uses a separate dimensionless angular threshold.

The renderer clips exact convex aperture pieces against that finite pyramid. Testing only its near-plane cap
misses oblique apertures that enter the clipped volume without touching the cap. The half-space
clipper classifies and intersects against the same expanded boundary, avoiding extrapolated
vertices around the contact band. For a real volume intersection, the planner computes the
aperture's exact eye-ray footprint without applying the ordinary near-depth rejection. Positive
homogeneous `w`, the four view sides, and the inherited parent window still clip the result. The
resulting footprint becomes the adjacent domain's traversal window, so every downstream portal
remains inside the same set of aperture-crossing camera rays.

Residency remains the sole layer-zero root. The straddled target occupies the next ordinary render
layer, but its stencil union uses the retained screen-space footprint instead of rasterizing the
world-space aperture. Each edge carries exactly one executable mask source: either that authored
aperture or the retained near-clip window. The NDC straddle mask deliberately uses `ALWAYS`, because
the exact footprint has already selected aperture-crossing rays and resident floor or terrain depth
must not veto the ownership transfer. Depth is then reset only inside the mask and the adjacent
domain renders directly. Near-clip window masks carry no source-surface depth policy and this
`ALWAYS` comparison remains unbiased. Ordinary world-aperture masks retain policy-selected
`LEQUAL`. Root color
and depth therefore remain authoritative outside the footprint; adjacent color and depth become
authoritative inside it. Downstream portals continue through later layers and remain bounded by the
inherited window. The policy is frame-local and does not merge permanent visibility islands or
mutate camera or actor residency.

When a straddled aperture fills the near plane, its ray footprint may legitimately cover the full
screen. Incoming-crossing suppression prevents the reciprocal direction of that same aperture from
immediately claiming the full screen again and redrawing the root over the adjacent domain.

Multi-portal corners use the same closure process. There is no fixed-hop rule, aperture-AABB
shortcut, or camera-point slab.

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
- scope-local traversal with visibility-island render ownership;
- explicit render contributions with unique node identity and repeated masked submissions;
- indoor/outdoor cycles;
- direct color/depth scene-domain ownership;
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
