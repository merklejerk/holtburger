# Holtburger 3D Client Entity Selection Plan

Status: **Phase 0 and implementation dry run complete — sphere-only animation closure accepted;
Phase 1 is an ordered runtime cutover prerequisite.**

Created: 2026-09-02
Origin: Client-mode entity selection through the 3D view and minimap, with persistent x-ray and
screen-edge tracking affordances

## Context and Boundaries

### Goal

Add one GUID-owned Client-mode selection mechanism that can select a world entity either by clicking
its current animated presentation in the 3D viewport or by clicking its minimap blip, then keep the
selected entity trackable with a depth-independent silhouette outline, a small-target marker, and an
off-screen directional marker.

The difficult boundary is direct 3D picking. Portal traversal and static-world obstruction belong to
the native core/world spatial scene, while the browser alone has the current animated part poses and
resolved drawing triangles. The app-host adapter only transports between them. The first slice
therefore uses a deliberate broad-phase/narrow-phase split instead of duplicating either subsystem
across the process boundary.

### In Scope

- Store one client-local selected entity GUID. GUID reuse is sufficiently rare that a separate
  selection generation is YAGNI.
- Select from a primary-button click in the Client 3D viewport without turning click-scale pointer
  jitter into camera orbit.
- Have core/world traverse the current portal-aware spatial scene, compute the first static
  obstruction, and return eligible retained entity GUIDs from the spatial domains reached by the
  ray. World ray/envelope intersection is the coarse dynamic-entity filter; the frontend's current
  animated geometry is the exact filter.
- Refine those candidates in the browser against frame-current animated part transforms and exact
  drawing triangles, then select the nearest exact hit.
- Select attached entities such as wielded equipment. They inherit coarse spatial scope from their
  world-placed ancestor; the browser owns their exact current transform through the animated parent
  part hierarchy.
- Select a deterministically resolved blip from the minimap without changing the existing drag-to-pan
  gesture.
- Clear selection on a successful empty click and on authoritative removal of the selected GUID.
- Keep selection through temporary presentation unrealization; hide affordances until that GUID is
  realized again.
- Render a depth-independent WebGL silhouette outline from the selected entity's current animated
  geometry so walls and portal occlusion cannot hide it.
- Render a Sims-like marker for an on-screen target with a small projected footprint.
- Render an edge-clamped directional marker when the target is outside or behind the camera frustum.
- Add focused Rust, TypeScript, WebGL fixture, browser-harness, and live Client-mode evidence.

### Out of Scope

- A server target packet, combat target state, identify/use actions, target panels, or target health
  UI. This plan owns only client presentation selection.
- Selection generations, GUID tombstones, or historical target identity.
- Multi-select, target cycling, lock-on camera behavior, gamepad focus navigation, or keyboard target
  shortcuts.
- Explorer-mode interaction policy. Pure geometry or renderer helpers may remain reusable, but this
  plan wires selection only into Client mode.
- GPU color-ID picking, a full-scene browser raycast, or browser-side portal traversal.
- Host-side skeletal animation, retained render triangles, material evaluation, or WebGL visibility
  emulation.
- Pixel-alpha picking, texture-mask picking, particles, labels, nameplates, or effects as selectable
  geometry.
- Reproducing retail's four-arrow target decoration. Retail evidence informs selection semantics, but
  the silhouette and small/off-screen markers are deliberate Holtburger presentation choices.

## Ground Truth and Existing Seams

### Retail Selection Evidence

- Retail queues mouse selection for a subsequent render rather than running an independent world
  portal walk (`acclient.c:137010-137030`).
- `CPartArray::UpdateParts` installs animation-frame transforms on the parts used for rendering
  (`acclient.c:314107-314135`).
- `Render::GfxObjUnderSelectionRay` transforms the selection ray through the current part frame,
  broad-phases against that `CGfxObj`'s drawing sphere, and tests its drawing polygons before keeping
  the nearest hit (`acclient.c:363547-363620`). Direct retail picking is therefore animated-pose and
  drawing-geometry aware.
- `RenderDeviceD3D::DrawMesh` calls that picker only after the mesh passes the active portal-view
  check (`acclient.c:437720-437776`). Retail gets portal awareness from the render traversal; it does
  not prove that a second frontend portal walker would be correct.
- `CPartArray::GetSelectionSphere` returns the setup-authored selection sphere transformed by the
  part-array scale (`acclient.c:313877-313894`). Retail uses that sphere for target-indicator bounds,
  not as the direct polygon picker (`acclient.c:137935-138028`).
- Retail's `VividTargetIndicator` positions four on-screen corner images around the target rectangle
  and chooses one of eight off-screen direction images (`acclient.c:279679-279867`). Its exact
  decoration is reference evidence, not a requirement for this UI.

### Host and Shared Runtime

- `SetupModel` already decodes both `sorting_sphere` and `selection_sphere` in
  `crates/holtburger-dat/src/file_type/setup_model.rs`.
- `GfxObj` retains the drawing BSP in `crates/holtburger-dat/src/file_type/gfx_obj.rs`. Phase 0 proved
  its root spheres under the stable/default pose are not conservative over reachable animation, so
  they are not promoted into host live state.
- `CollisionScene::transit_surface_ray_path` already owns portal-aware finite-ray traversal, collision
  coverage validation, and exact reached memberships. Browser code must not duplicate it.
- `CollisionScene::cast_surface_ray` is a nearest collision-surface query over frozen physical target
  shapes. Its nearest-hit semantics and Solid/settled target policy are wrong for visual selection and
  must not be generalized into another flag-driven god query.
- `dynamic_index.rs` is not a general entity index: its physical target-demand, activity, missile,
  and Solidity filters intentionally exclude entities visual selection must retain. `SpatialScene`
  already owns the canonical world-body population, a coarse landblock map, and each body's current
  `SpatialMembership`. The first cut adds a pure selection query over those existing facts rather than
  another registration lifecycle.
- Attached entities deliberately have no `SpatialBody` or independent membership. World retains
  `EntityPlacement::Attached(PhysicsAttachment)`, while the browser resolves the child's current world
  transform through the named parent holding location and animated part hierarchy. Selection must
  preserve that division rather than inventing a host pose for the child.
- Whole-object scale is currently split incorrectly across the process boundary. Retail
  `ScaleHook::Execute` calls `CPhysicsObj::SetScale` (`acclient.c:328781`); `SetScale` changes the
  physics object's absolute `m_scale` and its part-array scale (`acclient.c:308862-308903`), and
  collision transitions consume that same `m_scale` (`acclient.c:311360-311373`). ACE models the
  same current scale in `PhysicsObj.SetScale`/`SetScaleStatic`. Holtburger currently advances the
  dynamic scale ramp only in the browser `EffectSystem`, while core rejects some collision-mutating
  default scripts. This is a pre-existing collision/residency correctness gap, not selection-only
  work.
- `ClientCollisionCoordinator::snapshot()` returns an immutable static `CollisionScene`; it is not a
  per-tick snapshot of dynamic bodies. Dynamic bodies, their placed shapes, and ordinary membership
  are prepared from world state during simulation. Scale ordering must therefore be stated relative
  to dynamic-body preparation/solve and view projection, not construction of the static snapshot.
- Current dynamic physical preparation bakes whole-object scale into movement spheres, body
  dimensions, BSP part origins/scales, fallback shapes, and the collision-observation key. Supporting
  a changing runtime scale is consequently a clean unit-geometry cutover, not a scalar field added to
  otherwise unchanged prepared bodies.
- The current core guard also follows the wrong identity: `SetupModel.default_script` is a
  `PlayScript` cue resolved through the effective 0x34 PhysicsScriptTable, not a 0x33 PhysicsScript
  DID. The live `0xF754` PlayScript event is not decoded either. The scale fix must correct those
  paths rather than making the selection envelope compensate for a runtime state the host does not
  own.
- `holtburger-world` already owns the motion-animation cursor and consumes simulation-relevant motion
  hooks. The table-reachable animation census found zero authored `Scale`, `SetOmega`, or
  `AnimationDone` hooks; current authored scale behavior instead arrives through setup defaults and
  PhysicsScripts. PhysicsScript scheduling therefore belongs in reusable core behavior, while the
  resulting current scale belongs in world because collision, residency, and projection consume it.
- `ClientCommand` and `ClientViewEvent` already carry asynchronous precise-jump aim/evaluation work.
  A selection query can follow the same command/event topology without adding a oneshot sender to the
  cloneable command enum.
- The protocol decodes `ObjDescEvent` (`0xF625`) with replacement `ModelData`, instance sequence, and
  visual-description sequence, but `holtburger-world` does not currently consume it. Retail queues
  the event when the object is missing or the instance sequence is wrap-newer, discards an older
  instance, and proceeds only for the equal current instance (`acclient.c:138209-138241`). It then
  applies only a wrap-newer visual-description sequence (`acclient.c:137180-137205`). ACE emits the
  current instance sequence and next visual-description sequence in
  `WorldObject_Networking.cs:45-54`. Phase 2 closes this pre-existing live-appearance gap so
  equipment-driven part substitutions cannot leave a stale selection envelope or frontend
  presentation.
- `apps/holtburger-3d/host/src/client_runtime.rs` and `client_projection.rs` are the narrow typed host
  adapter seams. They should validate and project selection wire data, not make spatial or UX
  decisions.
- The host currently decodes and serializes presentation assets transiently through
  `object_resource_closure.rs` and `setup_visual_source.rs`; it does not retain presentation geometry.
  This plan preserves that property.

### Browser Presentation

- `ClientPresentationSession.samplePreciseJumpRay` already samples an AC-axis ray from the exact
  primary camera and viewport last presented. Generalize that primitive rather than creating a
  second camera-unprojection path.
- Resolved setup geometry retains CPU `positions` and `indices` in
  `src/lib/game/resolution/presentation.ts`.
- `DynamicEntitySystem` composes current animated part transforms and publishes current
  `sourceToLandblock` transforms for dynamic contributions each frame. Exact refinement can therefore
  intersect current visual triangles without asking the host to animate.
- The retained dynamic entity tree outlives a single portal-visible contribution list. Selection
  refinement and the x-ray pass must resolve the selected/candidate GUID from retained realized state,
  not require that it was already submitted by normal portal culling.
- `ClientWorldView.svelte` currently starts orbit on left pointer-down. It needs an explicit
  click-versus-drag arbiter, with precise-jump mode retaining priority.
- `MapBlip` already carries a GUID, but `Minimap.svelte` currently drops it from `BlipHitTarget`.
  The minimap already owns hover targets and a three-pixel pan threshold, so selection needs no second
  hit-testing structure.
- `webgl2-world-marker-pass.ts`, `webgl2-nameplate-pass.ts`, and the flat-scene target/presenter are
  useful lifecycle and diagnostics precedents. The selection silhouette itself must remain WebGL;
  Canvas2D is neither simpler nor appropriate for re-rendering animated meshes.
- Both flat and portal schedules finish through `WebGL2FlatScenePresentation`, which performs the
  frame's only default-framebuffer write. The selection mask must be produced before that call and
  sampled by that presenter; drawing an outline after presentation would violate an existing renderer
  invariant and bypass whole-frame color/transition composition.
- Minimap camera/entity inputs are already pulled imperatively. Selected-target tracking should use
  the same frame-hot pattern rather than scheduling Svelte updates as the target or camera moves.

## Settled Direction Decisions

1. **Selection identity is one GUID.** Entity-generation tracking is not added. Existing camera and
   world generations continue to protect their own lifecycle contracts; a request sequence only
   correlates asynchronous clicks and is not part of target identity.
2. **The native core/world path owns portal traversal, static obstruction, and candidate discovery.**
   The app-host adapter only validates/projects the contract, and the browser never walks EnvCell
   portals or attempts to reconstruct collision coverage from rendered content.
3. **The browser owns animated visual refinement.** The host never retains or animates presentation
   parts. The browser tests host candidates against the exact geometry and transforms it is presenting
   now.
4. **The world query returns every world-root coarse hit plus every in-scope attachment.** The accepted
   full-animation envelope supplies the world-root coarse bound. A false-positive sphere may not hide
   a farther candidate; attached candidates deliberately bypass the host sphere test because their
   current transform is browser-owned.
5. **The response carries the static ray limit.** The browser rejects exact animated triangle hits
   beyond the world-computed static obstruction distance. This is collision-scene gating, not
   sampling the scene depth buffer.
6. **Dynamic entities resolve one another in the exact browser phase.** Choosing the smallest exact
   triangle distance naturally makes a nearer drawable entity win. Physical `Solid` state is not a
   visual selection filter.
7. **Fix whole-object scale before building selection on it.** Core owns one dynamic PhysicsScript
   clock; world owns the resulting absolute current whole-object scale and applies it to collision,
   ordinary residency, authored root offsets, selection-envelope placement, and dynamic-view
   projection. The browser consumes that projected scale for dynamic entities and does not advance a
   second scale ramp. A scale-hook target is absolute: an entity authored at scale 2 that receives
   target 3 ends at 3, not 6.
8. **The coarse bound is a sphere-only full-animation closure.** At unit whole-object scale it
   conservatively encloses every effective part's drawing-BSP root sphere over reachable frame
   translations, authored selection, setup part scale, and visual-root rotation. It does not visit
   vertices or bake PhysicsScript scale growth; placement multiplies it by world's current effective
   scale.
9. **Cache one unit-scale object-local envelope per effective visual profile.** The key is the setup
   DID, ordered effective part DIDs, and effective motion-table DID. Full drawing geometry and runtime
   part animation remain browser-owned. Palette, texture, PhysicsScript table, GUID, root pose, and
   current whole-object scale are absent because they do not change unit-scale geometry. Content/core
   prepare a typed drawable radius or no-drawable-envelope result whenever the geometric profile
   changes. Preparation errors remain explicit coordinator failures, while an entity whose envelope
   is not ready is simply omitted from that click's broad phase and counted diagnostically.
10. **The world selection query is pure.** It walks current retained world entities from the canonical
    scene/world population, intersects the ray's reached domains with each body's already-computed
    `SpatialMembership`, places the cached envelope at the current pose and scale, and runs a
    ray/sphere test. It creates no selection index, registrations, buckets, dirty set, or second
    membership lifecycle. This can miss an animated envelope protruding through a portal that the
    regular body did not reach; that bounded false-negative policy is accepted for the first cut and
    measured at portal boundaries.
11. **Attached entities inherit coarse scope and remain browser-exact.** An attached entity has no
    host body or independent membership, so the pure query resolves its attachment chain to a
    world-placed ancestor and uses that ancestor's ordinary membership. If that scope intersects the
    ray path, the attached GUID is returned without a host sphere test; the browser alone can place
    its envelope/triangles through the current animated parent-part transform. This deliberately
    trades extra attached candidates for correct selectable equipment without host animation.
12. **Direct acquisition reaches exactly one landblock.** The shared query derives its 192 m finite
    ray length from `METERS_PER_LANDBLOCK`; it is not a frontend-provided tuning value or the camera
    far plane. Static obstruction can shorten that ray.
13. **Selection is app-local policy.** A focused `ClientEntitySelection` owner, composed by
    `ClientApp.svelte` alongside `ClientPresentationSession`, owns GUID mutation and in-flight query
    invalidation. The presentation session supplies camera/refinement/frame-fact operations but does
    not own the user's selected GUID. World/core own candidate facts, not selected UI state.
14. **Every selection source converges on that owner.** A minimap selection or explicit clear
    invalidates an older in-flight 3D query so a late completion cannot overwrite the newer action.
15. **Unavailable is distinct from empty.** Missing ray-path collision coverage, stale camera
    identity, or a host/query failure does not masquerade as a successful empty click. It leaves the
    current selection unchanged and publishes diagnostics. Individual world-placed entities without
    a current prepared envelope are omitted and counted; they do not poison the entire click.
    Attached candidates do not require a host envelope. An available response with no exact browser
    hit is a successful empty click and clears selection.
16. **The first target visual is a depth-independent silhouette outline.** A WebGL mask re-renders the
    selected entity's current animated geometry with depth testing disabled. The existing final scene
    presenter samples that mask, derives its outer edge, applies the stable outline color after scene
    grading, and remains the frame's sole default-framebuffer writer. Walls cannot occlude the outline,
    while the entity's interior material remains unchanged.
17. **Screen-space markers complement rather than replace the outline.** A small on-screen target gets
    a floating downward arrow; an off-screen or behind-camera target gets an edge-clamped directional
    arrow. A sufficiently large on-screen target gets only the silhouette.
18. **Selection survives temporary unrealization but not authoritative removal.** Indicators hide
    while no current realized node exists. A dynamic-entity removal clears the matching GUID.
19. **Eligibility follows retail's ordinary UI selection, not combat attackability.** Retail arms
    picking for a drawable `CPhysicsPart` whose owning physics object has a nonzero ID
    (`acclient.c:303121-303157`), then its ordinary click consumer accepts the object unless the
    `UI_HIDDEN` bit is set (`acclient.c:265803-265849`). `ObjectIsAttackable` is consulted by combat
    and auto-target paths, not ordinary click selection (`acclient.c:389925-389968`). Candidate
    discovery includes non-UI-hidden world-placed and attached setup-backed entities independently of
    physical collision or `ATTACKABLE`. The controlled player receives no additional special
    exclusion.

## End-to-End Contract

```text
ClientWorldView release point
    -> ClientEntitySelection action/sequence
    -> ClientPresentationSession last-presented camera ray
    -> ClientLifecycleSession transport
    -> app-host ClientHostRuntime validate/relay
    -> core ClientRuntime camera validation
       -> ClientCollisionCoordinator static scene
       -> WorldState selection query
          -> CollisionScene portal/static trace
          -> pure entity + ordinary-membership scan
             world roots: placed envelope test
             attachments: inherited ancestor scope
    <- core ClientViewEvent
    <- app-host run_client_task/client_projection
    <- ClientLifecycleSession typed result
    -> ClientPresentationSession/GamePresentationRuntime exact refinement
       -> DynamicEntitySystem current attached/animated transforms + CPU triangles
    -> ClientEntitySelection commits nearest exact GUID or successful empty

Minimap GUID/empty -> ClientEntitySelection directly (and invalidates an older viewport action)

ClientEntitySelection cold GUID
    -> Minimap selected ring
    -> GamePresentationRuntime current node/bounds
       -> WebGL depthless mask + final-presenter outline
       -> imperative small/off-screen ClientTargetIndicator
```

### Core/World Query Shape

Add a strict request equivalent to the existing camera-ray request with:

- camera identity;
- monotonic nonnegative JavaScript-safe frontend query sequence;
- anchor landblock, start, normalized direction, and previous cell. The shared query owner supplies
  the fixed one-landblock maximum distance.

The wire carries no collision exclusions. The world query constructs its static trace with
`PhysicalCollisionFilter::ALL`, so water barriers and every other installed static blocker participate
consistently rather than inheriting the controlled body's movement-specific exclusions.

Add one core result/event with a discriminated outcome:

- `available`: query sequence, effective static limit distance, and ordered candidates;
- `unavailable`: query sequence plus a typed reason suitable for diagnostics, not UX copy.

Candidates carry only GUID and are sorted by GUID for deterministic transport. Coarse distance is not
a contract fact: attached candidates have no host-resolved pose, and the browser must compare exact
triangle distances across every candidate anyway. Host diagnostics may separately record world-root
sphere entry distances without projecting them.

The app host boundary validates finite vectors. Core validates current camera identity, and
`CollisionScene` validates normalization, portal placement, the fixed one-landblock reach, and
required collision coverage. An available response with zero candidates means a successful empty
click; an unavailable response means no selection mutation.

### Candidate Broad-Phase Shape

The accepted content-derived full-animation closure uses drawing-BSP root spheres. Each part sphere
becomes rotation-invariant about its part origin; authored frame translations sweep that sphere
between frame endpoints, covering interpolated poses without visiting vertices. The resulting profile
envelope remains one unit-whole-object-scale scalar sphere. World places that sphere at the entity's
current root pose and multiplies its radius by the same current absolute scale already used by
collision and ordinary residency. The pure query tests that placed envelope directly; it does not
materialize a selection-specific spatial structure or reuse `DynamicShadowIndex`, whose physical
target-demand and Solidity filters are wrong for visual selection.

The immutable cache contract is intentionally smaller than the complete presentation appearance:

```rust
struct SelectionEnvelopeProfileKey {
    setup_did: u32,
    effective_part_dids: Box<[u32]>,
    effective_motion_table_did: Option<u32>,
}

struct UnscaledSelectionEnvelope {
    radius: f32,
}

enum PreparedSelectionEnvelope {
    Drawable(UnscaledSelectionEnvelope),
    NoDrawableGeometry,
}

struct SelectionEnvelopeCache {
    resolved: HashMap<SelectionEnvelopeProfileKey, Arc<PreparedSelectionEnvelope>>,
    in_flight: HashMap<SelectionEnvelopeProfileKey, InFlightSelectionEnvelope>,
}

struct InFlightSelectionEnvelope {
    request_id: SelectionEnvelopeRequestId,
    waiters: HashMap<Guid, EntityEnvelopeWaiter>,
}

struct EntityEnvelopeWaiter {
    entity_generation: u64,
    profile_revision: EntityEnvelopeProfileRevision,
}

enum EntitySelectionEnvelopeState {
    Pending,
    Ready(UnscaledSelectionEnvelope),
    NoDrawableGeometry,
    PreparationFailed,
}
```

`effective_part_dids` is the ordered `SetupModel.parts` array after applying every ordered
`EntityAppearance.part_changes` entry; keying the resolved array canonicalizes equivalent override
lists. Palette, subpalette, and texture changes are not geometric and do not fragment this cache.
The remaining effective identities are resolved once before lookup:

- the entity's explicit motion-table DID wins, otherwise use `SetupModel.default_motion_table`;
- absence after that fallback remains `None` and does not trigger a guessed resource identity.

The radius is finite, nonnegative, centered on the object-local origin, and already encloses authored
part scales, reachable animation-frame translations, and visual-root rotation at unit whole-object
scale. The setup DID identifies setup-owned default animation; the effective motion-table DID
identifies the remaining reachable clips. PhysicsScript-table identity, GUID, WCID, root pose, and
current whole-object scale do not belong in the cache key. A script hook changes current runtime scale,
not the underlying unit-scale visual geometry.

`ClientSelectionEnvelopeCoordinator` owns the two cache maps, observes selectable world-placed
setup-backed entities that require a host envelope, starts stateless `holtburger-content` preparation
once per profile, and records each interested GUID with a coordinator-local profile revision. It
accepts a completion only while the profile request ID, entity generation, and current profile revision
still match. These are async preparation guards, not selection identity. Attached entities do not
trigger per-entity envelope preparation merely for selection. `WorldState` owns only the per-GUID
`EntitySelectionEnvelopeState`, colocated with entity lifetime and cleared back to `Pending` whenever
geometry-bearing appearance facts change. It stores neither the cache key nor any request handle.
`PreparationFailed` retains no content error string; core owns the detailed failure while world needs
only the query-time omission reason. This state is ordinary entity data, not spatial registration or a
second membership.

The ray traverses portals through the existing static-surface-ray path. Extract its private common
evaluation into a dedicated internal trace containing the effective static limit, merged
outdoor/exact-EnvCell domains reached before that limit, optional static hit, and coverage result.
Keep `cast_static_surface_ray` as its existing nearest-surface wrapper; do not add selection flags to
it. The selection query consumes the internal trace and then performs an immutable O(current retained
population) scan:

1. Join each eligible world-placed entity to its canonical `SpatialBody`.
2. Reject it unless its current ordinary `SpatialMembership` intersects the ray path's reached
   domains: outdoor overlaps outdoor, or at least one exact EnvCell ID matches.
3. Place its cached unit-scale sphere at the current body pose, multiply the radius by world's current
   effective whole-object scale, and run the finite ray/sphere test.
4. Return every hit before the static limit; do not nearest-hit early-out because the browser exact
   phase may reject a nearer coarse sphere.

The scan is deliberately over the canonical population rather than `DynamicShadowIndex`: the latter
is a collision-target index with eligibility filters that would silently remove valid visual targets.
`SpatialScene` may expose a focused read-only iterator/join helper, but the query creates no index,
bucket registration, persistent candidate entry, or mutation. If the linear scan is later measured as
material, an existing coarse landblock map can narrow the immutable input; that optimization must
preserve cross-landblock envelope cases rather than quietly changing semantics.

Attached entities take a separate, honest branch. World resolves each attached entity's parent chain
to its world-placed ancestor and tests the ancestor's ordinary membership against the reached domains.
Every eligible attached GUID in an intersecting scope is returned without a host envelope test. Its
child placement depends on a named holding location in a current animated parent part, so only the
browser can produce its exact world transform. Returning the in-scope attached set may create extra
candidates outdoors, but avoids both a false host pose and an animation subsystem in world. The
browser's exact triangle test and static distance limit still decide whether it was clicked.

Reusing regular residency means a world entity's selection envelope itself is not portal-transited. A
visual envelope protruding across a portal or outdoor boundary that its regular residency does not
reach can therefore be omitted. That is an explicit first-cut accuracy tradeoff, not a conservative
claim. Missing or failed per-entity envelope preparation is surfaced in diagnostics and omits that
world entity only; it does not reject an otherwise valid click. Missing ray-path collision coverage or
failure of the query itself still returns `unavailable`.

Crate ownership follows the existing content boundary: stateless profile construction and closure
calculation live in `holtburger-content`; a dedicated `ClientSelectionEnvelopeCoordinator` in
`holtburger-core` owns the persistent result cache, concurrent-load deduplication, and stale
preparation rejection beside—not inside—the transient `ContentAssetRuntime` request machinery;
`holtburger-world` receives validated unit-scale radii and owns current effective scale, eligibility,
ordinary residency, attachment ancestry, and pure ray/sphere candidate discovery. The cache lives with
its `ContentAssetService`/repository and needs no capacity eviction at the measured profile population.

### Layer and Component Ownership

The codebase has three things named "runtime." The flow uses them deliberately rather than treating
"the host" as one component:

| Component                                               | Owns                                                                                                                                                                                    | Explicitly does not own                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `holtburger-protocol`                                   | Deterministic wire decoding for `ObjDescEvent`, `0xF754` PlayScript, and related server facts                                                                                           | Script execution, selection policy, spatial queries          |
| `holtburger-dat`                                        | Typed immutable SetupModel, animation, GfxObj, PhysicsScript, and PhysicsScriptTable decoding                                                                                           | Runtime caches, entities, clocks                             |
| `holtburger-content` envelope builder                   | Stateless construction of a unit-scale full-animation envelope from already-resolved geometry/motion profile facts                                                                      | Per-entity pose, scale, membership, cache lifetime           |
| New core `ClientSelectionEnvelopeCoordinator`           | Persistent profile result cache, in-flight deduplication, current-profile observation, stale completion rejection, and installation of a validated per-entity envelope state into world | Spatial registration, portal traversal, selected GUID        |
| Core dynamic PhysicsScript controller                   | Dynamic entity script clocks, cue/table/script resolution, `CallPES`, ordered due behavior, and absolute Scale commands                                                                 | Rendering and authoritative placement                        |
| Core `ClientRuntime`                                    | Fixed-tick ordering, camera-identity validation, selection command dispatch, invocation of the world query, and `ClientViewEvent` publication                                           | Portal math, UI intent, exact triangles                      |
| Core `ClientCollisionCoordinator`                       | Readiness and publication of the immutable static `CollisionScene` used by simulation and queries                                                                                       | Dynamic body snapshots, selection candidates, scale clocks   |
| `WorldState`                                            | Entity/attachment lifetime, current effective scale/ramp, per-entity envelope readiness, canonical dynamic bodies, ordinary memberships, and ObjDesc sequence gating                    | DAT access, animated presentation parts, UI selection        |
| `CollisionScene` plus focused world query               | Static finite-ray/portal trace and coverage, then the pure entity/membership/envelope join                                                                                              | Candidate caching, selected GUID, browser pose refinement    |
| App-host `ClientHostRuntime`                            | Strict command allowlist, input validation, and relay to core                                                                                                                           | Query execution and selection policy                         |
| App-host `run_client_task`/`client_projection.rs`       | Core event draining, replacement-snapshot behavior, and narrow browser projection                                                                                                       | Spatial decisions and browser geometry                       |
| Browser `ClientLifecycleSession`                        | Transport submission and typed event delivery, including dynamic removals and query results                                                                                             | Query ordering policy and exact picking                      |
| Browser `ClientPresentationSession`                     | Last-presented camera-ray sampling and a narrow facade over current presentation refinement/frame facts                                                                                 | Selected GUID mutation and portal traversal                  |
| Browser `GamePresentationRuntime`/`DynamicEntitySystem` | GUID-to-current-node resolution, current animated and attached part transforms, borrowed CPU geometry for exact refinement, and current rigid bounds                                    | Host coarse eligibility and Svelte state                     |
| New browser `ClientEntitySelection`                     | Sole selected-GUID mutation, action revision, pending query sequence, exact-result arbitration, and cold selection-change notification                                                  | Camera/render loops and host spatial facts                   |
| `ClientApp.svelte`                                      | Composition and teardown of lifecycle, presentation, and selection owners                                                                                                               | Per-frame picking math                                       |
| `ClientWorldView.svelte`/`Minimap.svelte`               | Pointer gesture classification and emission of a viewport point, GUID, or explicit clear                                                                                                | Async result ordering and selection lifetime                 |
| `WebGL2Renderer` selection pass and final presenter     | Current-pose depthless mask, outer-edge composite, lazy GPU resources, and diagnostics using existing geometry handles                                                                  | Selection identity and candidate policy                      |
| `ClientTargetIndicator.svelte`                          | Imperative DOM/SVG presentation of already-classified small/off-screen target facts                                                                                                     | Bounds projection, world semantics, reactive frame-hot state |

### Browser Refinement Shape

Add stateless math that:

- converts the captured query ray once into the renderer coordinate convention while retaining its anchor
  landblock;
- rebases the ray origin into each candidate's resolved landblock frame before applying that part's
  inverse transform; the direction is translation-invariant and the hit parameter remains meters from
  the original click origin;
- transforms the ray into each current part's local space rather than transforming every vertex;
- preserves the original world-distance parameter by applying the inverse part transform to the
  direction without renormalizing it; if an implementation normalizes instead, it must explicitly
  convert the local hit parameter back to world distance;
- broad-phases against a current part bound before triangle work;
- intersects indexed drawing triangles with deterministic finite-distance handling;
- returns the nearest non-negative hit distance for one candidate;
- compares candidates by exact distance then GUID.

Use the renderer's actual drawing ranges and current presentation suppression. The host already
preserves the source `sides_type` per triangle as `materialSideTypes`: type 0 applies retail's
normal-facing rejection, while types 1–3 perform no selection-side rejection. `retailVisibility`
independently suppresses degrade-hidden geometry in ordinary Client presentation; it does not derive
polygon sidedness. Material alpha textures are not sampled. `NoDraw`, `Hidden`, degrade-hidden, and
exactly fully suppressed parts do not participate; partially translucent drawable geometry does.
Mirrored/nonuniform authored part scales use the local transformed ray and authored local polygon
winding/normal for the retail sidedness test; renderer cull-face state is not a substitute. A
non-invertible or non-finite current part transform is skipped with an explicit diagnostic rather than
asserted through or treated as a miss silently. Geometry and transform arrays are borrowed only for
the synchronous query and are never copied into selection state.

The exact hit must be no farther than the response's static limit, within the same named floating
tolerance used by tests.

Refinement intentionally uses the latest completely published browser pose when the asynchronous
candidate result arrives, matching retail's deferred-render character without retaining a click-time
copy of every entity pose. Resteer A measures click latency and moving-target behavior; a whole-scene
pose snapshot is not introduced speculatively.

### Pointer and Async Ordering Shape

- Primary pointer-down arms a possible click and captures the pointer without immediately orbiting.
- Crossing the existing/named three-pixel movement threshold converts the gesture into orbit and
  forwards the full captured displacement; release then performs no selection.
- Releasing below threshold samples the ray at the release point from the last presented camera and
  submits one query.
- Precise-jump mode remains exclusive and consumes the pointer gesture before ordinary selection.
- Every new viewport query, minimap selection, explicit clear, lifecycle reset, or removal advances
  the selection owner's action revision. A query completion applies only when both its sequence and
  captured action revision remain current.
- The pending viewport operation retains its immutable sampled ray, sequence, and captured action
  revision until the correlated result arrives; the result need not echo ray data across the process
  boundary.
- A successful exact miss clears selection. Query unavailability or inability to sample a current
  camera does not.

### Indicator Shape

`ClientEntitySelection` exposes the cold selected GUID. Each browser frame,
`ClientPresentationSession` passes that GUID to `GamePresentationRuntime`, which resolves two separate
outputs without creating a catch-all snapshot type:

- a current realized dynamic node ID for `FrameInput.selectionTarget`, consumed synchronously by the
  renderer to expand existing depth ranges and instance transforms; and
- one current rigid visual bound plus projected marker classification, consumed imperatively by the
  app-local SVG/DOM overlay.

Neither output is retained as selection identity. The renderer owns silhouette draw preparation. The
overlay owns only arrow art and updates its bound element imperatively from `requestAnimationFrame`;
target/camera motion must not flow through Svelte reactive state.

The marker projection uses the selected entity's current rigid presentation bound, not the static
selection envelope, particles, nameplates, or effects:

- if the projected bound intersects the viewport and exceeds the named small-footprint threshold,
  show no arrow;
- if it intersects but is small, place a downward floating arrow above the clamped projected rect;
- if it is outside the frustum or behind the camera, intersect the center-to-target direction with a
  safe inset rectangle and rotate an edge arrow toward the unclamped target direction;
- if no current presentation bound exists, show neither arrow nor stale coordinates.

All thresholds, safe-area inset, outline width, and colors live in `client-tuning.ts` or the existing
shared frontend tuning composite. Tests consume production tuning or explicit local test inputs; they
do not copy magic values.

## Phase 0: Prove Envelope Coverage and Selection Semantics

Status: **Complete — sphere-only closure accepted; scale-inflated profile metrics require the
targeted Phase 2 rebaseline described below.**

Establish that the proposed host scalar is deserved before changing runtime contracts.

### Deliverables

- Add a temporary or retained diagnostic harness that walks canonical archive setups, base
  appearances, actual catalog part substitutions, and animations reachable through their motion
  tables.
- Resolve each effective physics-script table, inspect every cue-selected script, follow `CallPES`
  closure, and include the greatest reachable positive scale target in that profile's envelope.
- For each sampled pose, transform drawing-BSP root spheres by the authored part pose/scales and
  compare that animated bound with the proposed selection-sphere/default-pose union.
- Report setup/appearance counts, missing drawing roots, degenerate authored spheres, number and
  fraction of escaping poses, maximum escape distance/ratio, and the content identities of worst
  cases.
- Measure actual-content population bounds for the fallback candidate policy across outdoor,
  interior, and crowded scopes. Do not introduce a candidate cap without this distribution.
- Trace retail selectability checks around mouse selection and settle local-player eligibility,
  hidden/no-draw behavior, polygon sidedness, and any game-semantic exclusion that is independent of
  physical Solidity.
- Compare retail/static visual obstruction semantics with Holtburger collision coverage. Record
  whether non-collidable decorative drawing geometry can observably permit selection through a visible
  surface.

### Acceptance Criteria

- The envelope census is reproducible against named archive/catalog inputs and records exact totals.
- The selected full-animation closure conservatively encloses every valid drawing-root sphere in the
  sampled reachable poses without a guessed padding factor or vertex scan.
- Closure compute and the historical scale-inflated radius distribution are measured over effective
  catalog profiles. The algorithm is accepted; Phase 2 owns the unit-scale rebaseline and Resteer A
  owns live candidate counts.
- Static content populations and modeled serialized event sizes show no need for an arbitrary
  candidate cap before the live measurement.
- Target eligibility and triangle-sidedness have explicit, cited rules.
- Any deliberate observable departure from retail is identified for a correctly formatted
  `RETAIL DIVERGENCE:` marker, including the required census.

### Results and Gate Decision

The retained `selection_envelope_census` command was run against `dats/assets.hba` and
`dats/weenies.hwc`:

```text
cargo run --release -p holtburger-debug-harness \
  --bin selection_envelope_census -- \
  --content dats/assets.hba --catalog dats/weenies.hwc --worst 12
```

- It decoded 5,935 SetupModels and all 43,913 catalog templates, producing 9,776 distinct base or
  effective appearance/motion/script-table profiles; 4,515 profiles were catalog-backed. Those
  profile counts include PhysicsScript-table identity and are historical Phase 0 measurements, not
  the final unit-scale cache cardinality.
- It sampled 5,591,820 reachable animation poses and 134,295,290 posed drawing-root spheres. No
  profile lacked an envelope, no drawing polygon set lacked a root drawing sphere, and no decoded
  sphere was invalid. Two referenced GfxObj DIDs lacked decodable drawing data (`0x00000000` and
  `0x01004E29`); one effective motion table (`0x09000085`) was absent.
- 1,321 profiles escaped the rejected default-pose union. Of those, 1,233 were catalog-backed,
  affecting 10,353 templates. Even under a hypothetical attackable-only policy, 6,059 affected
  templates remain out of 39,200 effectively attackable templates. There were 5,250,914 escaping
  poses and 21,477,390 escaping posed part spheres. Every escaping profile escaped through
  animation/root motion rather than only through a scale hook.
- The worst escape was 40.991585 m (6.3807 times the proposed envelope radius) for SetupModel
  `0x020016F1`, animation `0x03000BC0`, frame 59, part GfxObj `0x0100371A`, used by WCIDs 35580 and 73225. WCID 35580 is effectively attackable, so an attackable-only filter does not remove the
  worst case. The maximum radius ratio anywhere in the census was 73.481216.
- Adding the authored SetupModel sorting sphere to the union does not materially improve coverage:
  1,308 profiles and 10,302 catalog templates still escape, with a 39.213898 m worst escape.
- The census does not add authored position-frame translation to part poses; that root motion is
  host/world placement. It applies only the root rotations the frontend deliberately keeps visual.
  At most 25 of 1,321 escaping profiles involve such a rotation; 1,296 escape through articulated
  `part_frames` without an applied visual-root transform. The worst Drudge Balloon sample is a part
  transform from motion-table animation `0x03000BC0`, not a `pos_frames` displacement.
- Object default scale does not change containment for a uniformly scaled envelope and posed sphere.
  The corrected census resolves `SetupModel.default_script` as a `PlayScript` cue through the
  effective physics-script table, then follows every table script's `CallPES` closure. Sixty-six
  profiles carry a scale hook, 64 can grow, and the maximum authored scale end is 5.0. Two referenced
  tables (`0x3404E613`, `0x3404E9FB`) are absent from the archive; no referenced PhysicsScript is
  missing. This exposed the broader host scale-ownership gap. The final selection cache does not load
  those tables or fail because one is absent; runtime PhysicsScript preparation reports its own
  behavior error independently of selection-envelope preparation.
- The catalog covers direct template part substitutions but not every combinatorial runtime clothing
  or equipment appearance. That limitation cannot rescue the proposal: canonical base and catalog
  profiles already fail the gate materially.

The ACE World `landblock_instance` table was queried read-only as an actual-content population bound.
It contains 365,195 placements across 4,521 landblocks and 121,993 exact cells: 44,740 outdoor and
320,455 EnvCell placements. Landblocks range from 1 to 704 placements (mean 80.78); 12 have at least 500. Exact cells range from 1 to 229 placements (mean 2.99); four have at least 100. The densest
outdoor/landblock population is 704 and densest exact cell is `0x2D5B0000` with 229. These are
population bounds, not invented ray-hit counts; runtime Client interest also contains server-created
and mobile entities, so Resteer A still measures its live distribution.

The population totals are reproducible from the canonical ACE World database with:

```sql
SELECT COUNT(*), COUNT(DISTINCT landblock), COUNT(DISTINCT obj_Cell_Id),
       SUM((obj_Cell_Id & 65535) < 256), SUM((obj_Cell_Id & 65535) >= 256)
FROM landblock_instance;
SELECT landblock, COUNT(*) AS population
FROM landblock_instance GROUP BY landblock ORDER BY population DESC;
SELECT obj_Cell_Id, COUNT(*) AS population
FROM landblock_instance GROUP BY obj_Cell_Id ORDER BY population DESC;
```

A modeled named-MessagePack result containing only GUIDs is 1,214 bytes for 229 candidates, 3,589
bytes for 704, 5,069 bytes for 1,000, and 50,069 bytes for 10,000. Returning the eligible retained
population in reached domains therefore has comfortable payload headroom at the measured static
content extremes and needs no candidate cap in the first cut.

Retail evidence settles the remaining semantic questions:

- `CPhysicsPart::Draw` enables mouse picking for an actually drawable part with a current GfxObj and
  a nonzero owning object ID; it does not test Solid, ethereal, or `ATTACKABLE`
  (`acclient.c:303121-303157`). The ordinary click consumer rejects `UI_HIDDEN`, then calls
  `SetSelectedObject` without an attackability test (`acclient.c:265803-265849`). Holtburger will
  preserve that distinction unless this feature is deliberately narrowed to combat targets.
- `CPolygon::polygon_hits_ray` rejects the normal-facing ray direction only when authored
  `sides_type == 0`; otherwise it performs no side rejection (`acclient.c:345624-345651`). Browser
  refinement must preserve authored sidedness instead of imposing blanket backface culling.
- Retail invokes `Render::GfxObjUnderSelectionRay` from the dynamic part draw after portal-view
  acceptance (`acclient.c:363547-363620`, `acclient.c:437720-437776`). It does not compare the hit
  against the static framebuffer depth or a static collision ray. Therefore opaque static geometry,
  collidable or decorative, is not itself a nearest-hit gate in retail.
- Holtburger will deliberately use its collision scene's first static surface as an acquisition
  limit. This prevents ordinary through-wall acquisition but can differ where drawing and collision
  surfaces disagree. The implementation needs a `RETAIL DIVERGENCE:` comment citing the lines above:
  the consequence of removing the gate is through-wall acquisition; the blast radius is one new
  Client-mode selection query, with zero server-authoritative or authored-content consumers.

**Gate decision:** the default-pose scalar has failed a conservative drawing-bound containment
proof. Testing every vertex would only determine whether some of that conservatism is slack; it is not
needed to construct a safe broad phase. Candidate discovery by membership alone is also rejected:
outdoor `SpatialMembership` has no local scope, so it can return the entire retained outdoor interest.
The sphere-only full-animation closure is accepted as a unit-scale per-profile cache; ordinary
residency is used only to filter the pure scan to spatial domains the ray actually reached. Its
compute cost is acceptable for profile preparation. Phase 2 rebaselines the radius distribution, and
Resteer A measures live candidate quality before any per-clip refinement is considered.

### Sphere-Only Closure Benchmark

`selection_envelope_census --benchmark-rounds 15` benchmarks a test implementation after archive
decoding, with animations and GfxObj root spheres cached and maximum reachable physics-script scale
precomputed. It visits only per-part spheres and authored frame translations; no mesh vertex is read.
Seven focused tests cover nonuniform/negative scale, rotation-invariant containment, continuous
interpolated translation, sphere enclosure, bounded diagnostic retention, and physics-script-table
decoding.

Across 9,776 effective profiles, 15 rounds took 3,341.334 ms total, or 222.756 ms per complete
profile set. Per-profile compute was 320 ns p50, 32.345 us p95, 822.260 us p99, and 981.365 us
maximum. Weighting each profile by the number of catalog templates that use it—the available proxy,
not a live entity-frequency distribution—gave 294 ns p50, 912.354 us p95, 924.962 us p99, and
981.365 us maximum. The tail profiles traverse roughly 633,000 posed parts because broad creature
motion tables expose many clips.

The result rejects per-entity recomputation: cache or bake one closure per effective
setup/parts/motion-table profile, making per-entity content preparation a cache lookup. Query-time
work performs only current scalar placement, ordinary-membership comparison, attachment-ancestry
resolution, and ray/sphere tests.
Compute cost is acceptable at profile-preparation scale.

The reported catalog-weighted radii of 1.569 m p50, 14.710 m p95, and 72.253 m maximum include the
maximum reachable PhysicsScript scale baked by the Phase 0 diagnostic. That was conservative, but it
is no longer the runtime design: world will own the actual current scale. Phase 2 must remove
PhysicsScript-table identity and maximum scale from the diagnostic, rerun it, and record the true
unit-scale cache cardinality and radius distribution before implementing the cache. The sphere-only
algorithm and its compute-cost conclusion remain valid; the old radii must not be copied into tuning
or acceptance thresholds.

### Task Checklist

- [x] Build and run the archive/catalog envelope census
- [x] Slice bound escapes by effective `ATTACKABLE` and test the authored sorting sphere
- [x] Derive and benchmark a continuously conservative full-animation closure from part spheres and
      frame endpoints
- [x] Resolve effective physics-script tables and include scale hooks through `CallPES` closure
- [x] Accept the sphere-only closure algorithm and measured compute cost for the first cut
- [x] Model event sizes
- [x] Prove retail target eligibility and polygon rules
- [x] Prove or document static visual-versus-collision obstruction behavior
- [x] Record the gate decision and revise later phases if evidence rejects the envelope

## Phase 1: Make Dynamic Whole-Object Scale Shared and Collision-Aware

Status: **Not started. Selection depends on this correctness fix.**

Close the pre-existing scale-hook gap once, at the layer that owns dynamic behavior and world
collision. Do not add a host-only approximation for selection or leave two independently advancing
dynamic script clocks.

### Deliverables

Execute this phase in three ordered work units. Each unit lands with its own tests; do not leave both
old and new dynamic scale ownership enabled between units.

#### 1A. Correct resource identities and establish one dynamic behavior clock

- Rename `SetupModel.default_script` to honest `PlayScript` cue vocabulary, add a typed 0x34
  PhysicsScriptTable decoder to `holtburger-dat`, and sweep touched loaders/errors so the cue is never
  formatted or loaded as a 0x33 PhysicsScript DID.
- Decode and route live `0xF754` PlayScript events. Resolve an entity's explicit physics-effect-table
  DID first and `SetupModel.default_script_table` second, then select the script for the cue and
  intensity exactly once in core.
- Move dynamic-entity PhysicsScript scheduling into a reusable core controller: ordered record timing,
  `CallPES` activation, pause/randomness, cancellation, and replacement have one clock and injectable
  time/random sources. The existing browser scheduler remains for frontend-only scenery/sky owners but
  must not schedule the same dynamic entity scripts after the production cutover in 1B. Build and test
  the controller here without activating the new dynamic path yet.
- Add one generation-qualified, ordered dynamic-behavior event/batch to `ClientViewEvent`. Core emits
  already-due presentation hooks through it once 1B activates the controller. App-host projection
  converts that subset to the existing typed prepared-behavior grammar; it does not execute or reorder
  hooks.
- Have the core controller retain one bounded, generation-scoped presentation checkpoint for
  persistent semantic slots, not an event history: latest supported per-part translucency state/ramp
  and latest particle-emitter slot with its authored start time. `Scale` is excluded because world/
  dynamic view already carry its current value; one-shot sound is excluded because it is transient.
  Dynamic replacement snapshots/upserts carry this checkpoint, while live batches carry deltas.
  Inventory every decoded PhysicsScript hook in the Phase 1 fixtures and add a named slot or classify
  it transient, intentionally inert, or unsupported—no command may fall through an implicit default.
- Key browser dynamic behavior state by the existing semantic `(GUID, dynamic entity generation)`
  rather than a transient realized scene-node generation. `GamePresentationRuntime` may receive a due
  hook before a node exists: persistent effects remain on that logical target and apply when it is
  realized; particles retain their authored start time and age normally; one-shot audio without a
  current realizable placement is deliberately suppressed and diagnosed. Removal or generation
  replacement retires that state atomically. A replacement snapshot installs the checkpoint in
  `initial-state` mode before the generation becomes drawable, restoring persistent effects without
  replaying elapsed transient hooks. The browser never runs a second PhysicsScript clock.

#### 1B. Cut dynamic physics over to unit geometry plus world-owned scale

- Add one explicit world-owned effective whole-object scale state, initialized from the entity's
  authored/server scale. A `Scale` hook target is an absolute finite positive scalar. Immediate hooks
  set it directly; timed hooks ramp from the sampled current value; a mid-ramp hook retargets from the
  value reached at that instant.
- Refactor dynamic physical preparation to retain unit-scale movement spheres, BSP collision shapes,
  BSP part origins/default part scales, fallback shapes, body-height/use-radius inputs, and authored
  motion offsets. Remove current whole-object scale from the immutable prepared-profile/cache identity;
  retain it only on the live entity/body. Apply that current scalar when movement and target shapes,
  dimensions, authored translation, and placed collision geometry are produced rather than rebuilding
  or re-decoding geometry on every ramp tick.
- Make fixed-tick order explicit: core advances the dynamic script controller; world applies due
  absolute scale commands and advances active scale ramps; simulation prepares/solves dynamic bodies
  and refreshes ordinary membership from that value; then dynamic views publish the same value. A
  selection command observes the last completely applied world value. The immutable static
  `ClientCollisionCoordinator` snapshot is an input to these operations and is not rebuilt for scale.
- Activate the new core controller, world `Scale` route, generation-qualified browser behavior stream,
  and retirement of browser scheduling for dynamic entities as one production cutover. There is never
  a build in which both clocks are live for the same dynamic generation.

#### 1C. Complete the browser cutover and unsupported-hook guard

- Project the authoritative current effective scale with the dynamic entity view. Remove the dynamic
  browser `EffectSystem` scale multiplier from transform composition so source scale 2 followed by
  script target 3 renders and collides at scale 3, not scale 6. Preserve frontend-only script owners
  without conflating their presentation state with world entities.
- Remove dead dynamic PhysicsScript closure staging/loading and node-generation targeting left behind
  by the 1B cutover; retain those paths only for the frontend-owned static/sky populations that still
  consume them.
- Replace the current `validate_default_script_stability` shortcut. Once Scale is handled, it is no
  longer an unsupported collision-mutating hook; continue failing closed for genuinely unsupported
  collision mutations such as PhysicsScript ethereal changes, `SetOmega`, blocking particles, and
  unknown hooks. `ReplaceObject` remains the already-proven intentionally inert retail behavior, not
  an unsupported mutation. Validation follows table-selected scripts and `CallPES`, not the old bogus
  direct-DID path.
- Add diagnostics for active dynamic script instances, due hooks, active scale ramps, and scale-driven
  body/membership refreshes, plus browser executed/suppressed/stale behavior outcomes. Metrics remain
  observational and each has a named profiling scenario.

### Acceptance Criteria

- Retail/ACE fixtures prove cue-to-table-to-script resolution, default-script activation, live
  `0xF754` activation, transitive `CallPES`, and seeded random/pause behavior.
- Authored scale 2 followed by target 3 ends at exactly 3 in world collision and browser presentation.
- Immediate, timed, and mid-ramp-retarget hooks share one deterministic current-value rule and never
  produce non-finite or non-positive collision state.
- During a scale ramp, movement spheres, BSP collision, body-derived interaction dimensions,
  scale-sensitive authored motion offsets, ordinary residency, dynamic-view scale, and later
  selection-envelope placement all observe the same per-tick scalar.
- A scale change near a doorway exercises the existing ordinary residency transition machinery; no
  selection-specific scale or membership hook is needed.
- Unit collision geometry is prepared once and reused throughout a ramp; scale changes do not trigger
  DAT reads, BSP rebuilding, or per-part animation work in world.
- Dynamic entities have one PhysicsScript scheduler. Static/sky frontend owners continue to work, and
  dynamic presentation effects do not disappear or replay spuriously across realization.
- A due dynamic behavior batch is accepted only by its exact existing entity generation and in authored
  order. Late realization applies persistent state without replaying one-shot audio; replacement and
  removal cannot leak prior-generation effects.
- Replacement-state recovery reconstructs the same persistent presentation checkpoint as uninterrupted
  delta delivery, while elapsed sound remains suppressed and finite particles age from their original
  authored start time.
- The static collision-scene generation remains unchanged during a scale-only ramp; only live dynamic
  body placement/membership and projected entity state change.
- The corrected script guard can actually be reached by a table-selected unsupported hook and emits
  one honest failure mode; Scale no longer trips it after the shared path exists.

### Task Checklist

- [ ] 1A: correct setup cue vocabulary and add the reusable PhysicsScriptTable decoder
- [ ] 1A: decode `0xF754`, add the core-owned scheduler, and project ordered generation-qualified
      dynamic behavior batches
- [ ] 1A: inventory hook persistence and add bounded per-generation checkpoint/replacement semantics
- [ ] 1A: retarget browser dynamic behavior state to logical entity generations and prove
      pre-realization/removal semantics
- [ ] 1B: add world-owned absolute scale and deterministic ramping
- [ ] 1B: retain unit-scale collision inputs, remove scale from prepared-profile identity, and apply
      current scale during dynamic placement/solve
- [ ] 1B: refresh ordinary residency and projection from the same tick scale
- [ ] 1B: atomically activate core scheduling/world Scale and retire browser scheduling for dynamic
      entities
- [ ] 1C: remove dead dynamic script closure paths and dynamic browser scale transform composition
- [ ] 1C: correct unsupported-hook validation through table and `CallPES` traversal
- [ ] Add timing, scale, collision, residency, projection, and presentation-regression tests
- [ ] Add focused runtime diagnostics

## Resteer S: Prove the Dynamic Scale Cutover

Status: **Not started.**

Before selection consumes current scale, run focused synthetic and live/harness scenarios for an
immediate scale, a timed ramp, a mid-ramp retarget, a doorway membership transition, a delayed visual
realization, forced replacement-state recovery, and entity generation replacement. Compare the world
body's placed movement/target shapes, ordinary membership, projected scale, and rendered scale at the
same committed ticks. Confirm that static collision-scene generation and prepared unit-geometry/cache
identities do not churn.

Proceed to Phase 2 only if one core dynamic scheduler is active, every world/render scale consumer
agrees, logical browser behavior state survives realization correctly, and measured fixed-tick work is
bounded. If the cutover fails, fix its ownership or unit-geometry shape here; do not compensate in the
selection envelope or run a browser scale clock in parallel.
Record the measurements and gate decision in this plan before Phase 2.

## Phase 2: Cache Envelopes and Add the Regular-Residency Candidate Query

Status: **Not started.**

Build a click-time broad phase that reuses world's established residency facts and keeps portal
traversal authoritative without maintaining a second visual-membership graph.

### Deliverables

- Remove maximum PhysicsScript scale and PhysicsScript-table identity from
  `selection_envelope_census`, rerun it, and record final unit-scale profile counts and radius
  distribution. Keep the already-proven sphere-only animation closure and compute benchmark.
- Add the unit-scale selection-envelope type and stateless sphere-only closure helpers at the layer
  that prepares effective appearance/motion profiles. Cache one radius per setup DID, resolved ordered
  part-DID array, and effective motion-table DID.
- Add a dedicated core `ClientSelectionEnvelopeCoordinator`. It observes selectable setup-backed
  entity profile facts, looks up or starts one persistent-cache preparation, and installs only a
  request-current result into world. Appearance/profile changes first mark the entity `Pending`, so a
  stale ready radius cannot remain queryable while replacement work runs. PhysicsScript and current
  scale changes do not invalidate this cache; setup, part overrides, or motion-table changes do.
- Reconcile completed preparations during ordinary core world/view reconciliation and once
  non-blockingly before a selection query. A click may consume only already-resolved cache state; it
  never performs DAT reads, waits on content, or starts per-candidate geometry work.
- Handle `ObjDescEvent` updates in `holtburger-world` with retail's two wrap-aware sequence gates. A
  missing entity or wrap-newer instance sequence queues the update for that future instance; an older
  instance is discarded; only an equal current instance proceeds. For that instance, only a
  wrap-newer visual-description sequence replaces `EntityAppearance`; equal or older visual updates
  are discarded. Publish the existing dynamic-view reconciliation signal and invalidate only the
  prior geometric envelope source.
- Name sequence slot 7 as the object visual-description sequence beside the existing instance slot 8.
  Extend the existing per-GUID `EntityLifecycleState`—which already owns future-instance delete
  authority—with one pending complete visual description guarded by both sequences. For an existing
  entity, retain the wrap-newest future instance and then wrap-newest visual sequence for that
  instance; before creation, reliable arrival order replaces the pending complete value. Creation/
  replacement seeds slot 7 from its object description, applies a matching queued update through the
  same visual-sequence gate, drops older queued work, and leaves a still-future value for the next
  incarnation. Lifecycle compaction/eviction removes leftovers. This protocol state is separate from
  both the content cache and selection identity.
- Add a finite selection-ray request and available/unavailable result to `holtburger-world`. Derive
  its fixed maximum distance as `METERS_PER_LANDBLOCK` (192 m) in the shared query owner.
- Extract a focused internal static-ray trace reused by selection and the existing surface-ray wrapper.
  It owns validation, portal path transit, touched-landblock coverage, merged reached domains, and the
  first static obstruction without widening `cast_static_surface_ray` into a multi-policy query.
- Add a pure immutable world query over the current retained entity/body population. For each eligible
  world-placed entity, intersect its existing regular `SpatialMembership` with the ray path's merged
  reached domains, place its ready unit envelope using current pose and effective scale, and run the
  finite ray/sphere test. Do not create or update a selection-specific index.
- Resolve eligible attached entities through their attachment chain to a world-placed ancestor. When
  that ancestor's ordinary membership intersects the ray path, return the attached GUID without a
  host sphere test; its exact placement belongs to the browser's current animated hierarchy. A
  missing or cyclic ancestry is an invariant error, never guessed outdoor membership.
- Return every qualifying GUID before browser refinement, sorted by GUID. Do not add a candidate cap,
  coarse-distance wire field, or nearest-dynamic early exit.
- Keep eligibility independent of physical target demand, Solidity, activity, missile state, and
  `ATTACKABLE`. A current world-entity missing/failed envelope is omitted and counted, not promoted to
  a whole-query failure. Missing ray-path collision coverage remains `unavailable`.
- Add a portal-boundary fixture and live probe that size the accepted false-negative case: animated
  visual geometry/envelope crosses a portal or outdoor boundary while regular residency does not.
  Record a `RETAIL DIVERGENCE:` marker with the retail render-picker citation and measured blast
  radius if the implementation retains this policy.
- Expose diagnostics for scanned world population, membership matches, sphere tests/hits, attached
  scope candidates, skipped envelope count/reason, reached scopes, and query time without turning
  debug logging into a tested contract.

### Acceptance Criteria

- Outdoor terrain, static object collision, and EnvCell geometry clip candidates at the first static
  hit; missing required ray-path coverage is unavailable, never an available empty list.
- A ray through portals queries every ordinary residency scope reached before the static limit and
  excludes disconnected interiors with overlapping local coordinates.
- The selection path performs no entity-envelope portal transit and maintains no dirty GUID set,
  selection index, registration/bucket structure, second residency set, atomic reconciliation batch,
  or collision-scene invalidation lifecycle.
- A visual envelope that crosses into an unlisted adjacent cell is an explicitly tested possible
  miss. The equivalent entity becomes discoverable when ordinary residency includes that cell.
- Moving, ethereal, non-solid, and active drawable entities participate when they have regular world
  residency; `EntityCollisionProof`, `selectable_target_proof`, and `DynamicShadowIndex` filtering are
  not reused.
- Attached equipment is selectable. It inherits the exact ordinary domains of its world-placed
  ancestor for host scope filtering, while the browser's animated attachment transform supplies the
  only exact placement. The host never fabricates a child pose, and invalid ancestry fails loudly.
- Initial and updated `ModelData.model_changes` choose envelopes by the resolved ordered part-DID
  array. Geometry-equivalent palette/texture/script variants share a cache record; part or motion
  changes reject superseded preparation and select the new record.
- Current effective scale is applied once when the world envelope is tested. Scale-hook changes
  require neither envelope recomputation nor a PhysicsScript-specific cache record.
- Individual unready or failed envelopes cannot reject the whole click. Diagnostics name how many
  selectable entities were omitted and why.
- Candidate ordering is stable by GUID and independent of entity iteration order.
- Pure scan time and attached candidate fanout are measured before any new spatial index is introduced.

### Task Checklist

- [ ] Rebaseline the Phase 0 census as a unit-scale, geometry-only cache
- [ ] Add the dedicated coordinator, resolved/in-flight cache shape, per-entity envelope state, and
      stale-result rejection
- [ ] Add the proven `ObjDescEvent` instance/visual sequence gates and pending-future-instance lifecycle
- [ ] Add the dedicated finite world query contract
- [ ] Add the immutable world-entity/membership scan and direct placed-envelope tests
- [ ] Add inherited-scope attached candidate discovery without a fabricated host transform
- [ ] Share static ray/path helpers without widening nearest-surface semantics
- [ ] Intersect every reached selection envelope without nearest-dynamic early termination
- [ ] Add obstruction, coverage, eligibility, attachment, movement, ordering, and portal-boundary tests
- [ ] Add focused scan/query diagnostics and document the accepted boundary miss

## Phase 3: Carry Queries Through Core and the Host Boundary

Status: **Not started.**

Connect the browser to the world query through the existing asynchronous client topology.

### Deliverables

- Generalize the precise-jump-only camera identity/ray wire naming where the exact structure is now
  shared; preserve precise-jump semantics in its own request type.
- Add `ClientCommand::QueryEntitySelectionCandidates` and a corresponding `ClientViewEvent` result.
- In core `ClientRuntime`, validate the request against the current camera generation, read the
  immutable static scene from `ClientCollisionCoordinator`, call the focused `WorldState` selection
  query with that scene, and emit the correlated view event. The command itself acknowledges enqueue/
  validation only; it does not synchronously return candidates.
- In app-host `ClientHostRuntime`, validate/relay the command and keep its response unit-shaped. Let
  `run_client_task` drain the later core event, and project only query sequence, discriminated
  availability, static limit, and GUIDs through `client_projection.rs` and the outer host protocol.
- Add strict frontend decoding in `client-host-contract.ts` and lifecycle delivery in
  `client-lifecycle-session.ts`.
- Keep the result event-driven. Do not add a sender/oneshot field to `ClientCommand`, expose world
  locks to the host adapter, or make the host command response wait synchronously on simulation work.

### Acceptance Criteria

- Invalid, stale-camera, unavailable-coverage, empty, and populated outcomes remain distinguishable
  end to end.
- The host rejects non-finite ray vectors, and the world rejects unnormalized directions.
- Event payloads contain no internal spatial body ID, collision proof, world lock, render geometry,
  animation pose, material, or server action state.
- Rapid queries retain their original sequence and can be deterministically ignored by the frontend.
- Existing precise-jump ray behavior remains unchanged after shared naming/helper extraction.

### Task Checklist

- [ ] Add the core command/event and runtime dispatch
- [ ] Add narrow host request/result projections and command allowlist entry
- [ ] Add strict TypeScript decoding and lifecycle delivery
- [ ] Test every outcome and stale sequence
- [ ] Sweep precise-jump-only vocabulary from newly shared camera-ray primitives

## Phase 4: Refine Current Animated Geometry and Own Selection

Status: **Not started.**

Make one app-local controller the only selection mutator.

### Deliverables

- Extract/generalize `samplePreciseJumpRay` into one last-presented camera-ray sampler consumed by both
  precise jump and entity selection.
- Add small stateless ray/sphere, ray/AABB if useful, and indexed ray/triangle helpers with explicit
  coordinate, distance-parameter, transform-invertibility, and authored-sidedness contracts. Inverse-
  transformed directions remain unnormalized so triangle `t` stays in world-distance units despite
  nonuniform/negative part scales.
- Add a focused `DynamicEntitySystem`/presentation-runtime query that resolves a GUID to current
  realized part geometry and transforms, including transforms inherited through attached parent-part
  hierarchies, without depending on normal portal-visible submissions. It is synchronous and returns
  borrowed current geometry/transform views only for the duration of refinement.
- Add `ClientEntitySelection` with selected GUID, action revision, one composite pending operation
  containing query sequence/captured action revision/sampled ray, typed outcome handling,
  command-submission failure handling, removal handling, and a selection-change notification only for
  cold consumers. Submission/query failure retires only its pending operation, reports unavailable
  diagnostics, and preserves the selected GUID.
- Compose it in `ClientApp.svelte` beside lifecycle and presentation. Inject transport/subscription
  operations from `ClientLifecycleSession` and ray/refinement/frame-fact operations from
  `ClientPresentationSession`; neither dependency may mutate selection directly.
- On the controller's cold selection-change notification, update the Svelte-selected GUID used by the
  minimap and call one `ClientPresentationSession.setSelectedEntityGuid` level setter. The session/
  runtime then resolves node and bound facts imperatively each frame; Svelte does not receive target
  motion.
- Refine every returned candidate, reject hits beyond the static limit, choose exact distance then
  GUID, and mutate selection exactly once per current completion.
- Add frame-hot read APIs for the selected node/bounds without copying geometry or publishing
  per-frame Svelte state.
- Expose a narrow harness driver that invokes the same viewport-point acquisition path without waiting
  for Phase 5 gesture wiring, so Resteer A can measure the actual vertical slice rather than isolated
  host and browser halves.

### Acceptance Criteria

- Clicking an animated limb uses its current pose, not its default or host collision pose.
- Clicking attached equipment returns the child's GUID and uses its current inherited parent-part
  transform.
- A candidate in an adjacent reached landblock is tested in the correct rebased coordinate frame and
  reports distance in meters from the original click ray.
- A coarse false positive does not win without a triangle hit and does not hide another exact hit.
- An entity whose current triangles are behind the static limit is rejected.
- `NoDraw`, `Hidden`, degrade-hidden, and fully suppressed parts do not hit; partially translucent
  drawing geometry does. Mirrored parts preserve authored `sides_type` semantics.
- Minimap selection or clear invalidates an older pending ray result.
- Available exact miss clears; unavailable/stale result preserves selection.
- Temporary unrealization hides frame output but retains GUID; matching authoritative removal clears
  it.
- No selection generation, frontend portal walker, host animation state, duplicate CPU geometry, or
  Svelte frame-hot store is introduced.

### Task Checklist

- [ ] Generalize the coherent camera-ray sampler
- [ ] Add pure exact-intersection helpers
- [ ] Expose current realized geometry lookup by GUID
- [ ] Compose the selection owner at `ClientApp.svelte` with injected lifecycle and presentation ports
- [ ] Add the narrow pre-gesture harness acquisition driver
- [ ] Add animation, obstruction, ordering, stale-result, removal, and unrealization tests

## Resteer A: Measure the Vertical Slice

Status: **Not started.**

Before adding presentation polish, prove that the hybrid boundary behaves well under real content.
Drive viewport points through the Phase 4 harness seam, which must exercise camera sampling, the real
asynchronous command/event path, world query, and exact refinement together. Do not substitute a
synthetic candidate list for latency or fanout measurements.

### Measurements

- Pure-query scanned population, membership matches, sphere tests, ray-query time, and candidate count
  at median, p95, and worst observed representative scene.
- Attached candidates per intersecting outdoor/EnvCell scope, exact-refinement rejection ratio, and
  cost in equipment-heavy player populations.
- Per-entity envelope omissions by explicit reason, proving that one omitted entity does not make the
  whole query unavailable.
- Portal/outdoor-boundary false negatives where animated drawing geometry crosses a domain not named
  by ordinary residency, including target type, envelope radius, animation, and camera/cell geometry.
- Event encoded size and click-to-candidate-result latency.
- Browser candidate part/triangle counts, refinement wall time, and total click-to-selection latency.
- Envelope-candidate-to-exact-hit ratio and browser refinement work.
- Phase 0 worst-case animations and runtime part changes as positive exact-picking fixtures.
- Query behavior during motion, portal transitions, missing coverage, and rapid alternating viewport/
  minimap actions.

### Gate

- Continue if click latency is perceptually immediate and candidate distributions remain small enough
  for exact CPU refinement.
- If the O(current retained population) scan dominates click latency, first narrow its immutable input
  through the existing coarse landblock map while retaining exact ordinary-membership filtering and
  cross-owner envelope coverage. Do not add a mutable selection index unless that simpler path fails
  measurement.
- If inherited-scope attached candidates dominate browser work, measure attachment reach from authored
  parent holding locations and child envelopes before adding a conservative host bound. Do not
  approximate the current animated child transform.
- If ordinary-residency false negatives are material, measure the smallest failing class before
  designing a selection-specific membership path. Do not flatten exact EnvCells into a global geometry
  grid or move portal traversal into the browser.
- If refinement cost is high, first add current-part sphere/AABB pruning or a per-geometry triangle
  acceleration structure in the browser. Do not move portal traversal or animation across the
  process boundary.
- Record results and the chosen course correction in this plan before Phase 5.

## Phase 5: Wire Viewport and Minimap Gestures

Status: **Not started.**

Expose both selection paths without regressing camera and minimap gestures.

### Deliverables

- Add click-versus-orbit arbitration to `ClientWorldView.svelte` with pointer capture, the named
  app-local three-pixel movement threshold, `pointercancel`/`lostpointercapture`, window-blur/lifecycle
  cleanup, and precise-jump priority. On the transition to drag, send the full start-to-current delta
  once; thereafter send incremental deltas so crossing the threshold loses no camera motion.
- Submit a selection query only for a completed primary-button click with a coherent current camera
  ray.
- Preserve the current `BlipHitTarget` fields, add its source GUID, and add `onSelectEntity` to
  `Minimap.svelte`'s narrow prop contract.
- On pointer release below the pan threshold, select the closest hit target by pointer distance then
  GUID. An empty successful minimap click clears selection; a drag only pans.
- Draw a selected-blip ring from the minimap frame's selected GUID so direct and minimap selection
  have the same feedback.
- Update the existing Client HUD browser harness rather than introducing a second selection-only app
  shell.

### Acceptance Criteria

- Click-scale jitter neither orbits nor detaches the minimap.
- Crossing the threshold produces orbit/pan only and never selects or clears.
- Overlapping blips resolve deterministically; tooltip behavior remains unchanged.
- A viewport click and a minimap click update the same selected GUID owner.
- Precise-jump targeting retains exclusive left-click behavior.
- Pointer cancel, lost capture, window blur, and lifecycle teardown leave no armed gesture.
- Existing user changes in `Minimap.svelte` and `ClientHudHarness.svelte` are preserved and integrated,
  not overwritten.

### Task Checklist

- [ ] Add viewport click/drag arbitration
- [ ] Add minimap GUID hit selection and empty clear
- [ ] Add selected-blip feedback
- [ ] Route both paths through the selection owner
- [ ] Extend focused gesture and HUD harness coverage

## Phase 6: Render the X-Ray Silhouette Outline

Status: **Not started.**

Render a current-pose target outline that remains visible through walls without disturbing normal
scene depth or materials.

### Deliverables

- Add a focused `webgl2-entity-selection-pass.ts` with:
  - a lazily allocated, full-drawing-buffer single-channel mask target;
  - a geometry mask program consuming the selected node's existing material-independent depth ranges,
    current instance transforms, and existing GPU geometry handles;
  - the same current part suppression, `retailVisibility`, and authored cull-face rules as ordinary
    presentation, while depth testing and portal scope/routing are deliberately ignored;
  - an outer-edge/dilation sample supplied to the existing fullscreen presenter.
- Add an optional current realized `selectionTarget` node ID to renderer `FrameInput`.
  `GamePresentationRuntime` resolves it from the cold selected GUID immediately before drawing; the
  renderer expands that exact node synchronously and does not retain selection identity.
- Schedule and clear the selected mask after the flat or portal scene has been assembled but before
  `#presentFlatScene`, using the same primary camera and clip transform. Pass the optional mask to
  `WebGL2FlatScenePresentation`, which grades/transitions the scene, derives only the mask's outer edge,
  applies a stable outline color, and performs the frame's sole default-framebuffer write. Portal
  transition sampling must transform scene and mask with the same presentation coordinates.
- Keep ordinary entity drawing, depth, materials, transparency ordering, shadows, and scene targets
  unchanged.
- Suppress the pass for no selection, unrealized/fully suppressed target geometry, or a loading/
  portal transition with no valid current primary world view.
- Add exact resource lifecycle and work diagnostics: live mask bytes, target generations allocated/
  released, selected part/triangle submissions, mask draws, composite draws, and skipped reason.
- Destroy and resize every selection resource through the renderer's existing lifecycle rules.

### Acceptance Criteria

- The outline follows animated parts frame for frame and does not use any host coarse geometry as
  visible geometry.
- Opaque walls and portal culling do not occlude the selected silhouette outline.
- The selected entity's interior appearance is unchanged; the pass adds only the intended outline.
- Flat and portal render paths show the same target projection from the primary camera.
- The presenter still performs exactly one default-framebuffer write; no post-presentation draw escapes
  color grading or portal-transition composition.
- Resize, render-scale changes, selection churn, context loss/restore where supported, and destroy leak
  no framebuffer, texture, buffer, VAO, program, or byte accounting.
- The no-selection steady state allocates no mask target and submits no selection draws.
- SwiftShader and real-GPU fixtures report no WebGL errors or incomplete framebuffer.

### Task Checklist

- [ ] Add lazy mask target lifecycle
- [ ] Add current-pose mask geometry pass
- [ ] Feed the optional mask through the existing final presenter and both renderer schedules
- [ ] Add resource/work diagnostics
- [ ] Prove flat, portal, through-wall, animation, resize, and teardown fixtures

## Phase 7: Add Small-Target and Off-Screen Markers

Status: **Not started.**

Keep the target locatable when its silhouette is too small or outside the view.

### Deliverables

- Add pure primary-view projection/classification helpers for the selected node's current rigid
  presentation bounds resolved through `SceneGraph`, including attached ancestors. Exclude particle,
  nameplate, effect, and unit selection-envelope bounds.
- Add an app-local `ClientTargetIndicator.svelte` SVG/DOM overlay whose element transforms and
  visibility are updated imperatively from the presentation session.
- Render a floating downward arrow over small on-screen projected bounds.
- Render a rotated arrow on the nearest point of a safe inset rectangle for off-screen or
  behind-camera targets.
- Add named tuning for footprint threshold, arrow offset, safe inset, sizes, color, outline thickness,
  and motion smoothing only if measurement proves smoothing necessary.
- Add accessible semantics without making a rapidly moving decoration keyboard-focusable. Any
  selected-target label should update only on GUID changes.

### Acceptance Criteria

- Large on-screen targets use only the silhouette; small on-screen targets add the floating arrow.
- Targets beyond each edge and corner produce the nearest stable edge position and correct direction.
- A behind-camera target does not mirror unpredictably across the screen center.
- An attached target uses its resolved child bound rather than its parent's bound or host root pose.
- Marker positions use the exact last-presented primary view and current target bound, with no
  one-frame reactive lag.
- Safe insets keep markers clear of viewport clipping at supported sizes and device-pixel ratios.
- Unrealized/removed targets do not leave a stale arrow.

### Task Checklist

- [ ] Add pure projection and edge-clamping policy
- [ ] Add the imperative target indicator overlay
- [ ] Add named visual/geometry tuning
- [ ] Add cardinal, corner, behind-camera, threshold, and lifecycle tests
- [ ] Capture representative small/on-screen/off-screen browser fixtures

## Phase 8: Integrated Verification and Cleanup

Status: **Not started.**

Prove the complete interaction in synthetic and live Client-mode scenes, then remove scaffolding.

### Deliverables

- Extend browser fixtures for animated limb clicks, attached-equipment clicks, overlapping entities,
  a broad-population miss, a target behind collision, a target visible through an open portal, a
  selected target hidden by a wall after selection, minimap overlap, small footprint, every off-screen
  direction, unrealization, and removal.
- Run a live Client-mode probe against ACE covering outdoor and EnvCell selection, a moving creature,
  minimap selection, wall tracking, and portal-space transition behavior.
- Profile a crowded scene with selection absent, selected on-screen, selected through a wall, and
  selected off-screen; record CPU/GPU deltas and resource bytes.
- Remove temporary census/profiling code that is not a generally useful harness command.
- Sweep names, docs, diagnostics, and UI labels for the final `selection candidate`, `selected
entity`, and `target indicator` vocabulary.
- Add any required `RETAIL DIVERGENCE:` comment with exact `acclient.c` citation, consequence, and
  census; do not mark ordinary Holtburger-only UI art as a compatibility claim.

### Acceptance Criteria

- Direct and minimap paths select the same GUID and drive all three visual consumers.
- Current animation is proven by clicking/outline-tracking a moving limb, not only a rigid prop.
- Attached equipment can be selected by its own GUID and outlined through its inherited current
  transform.
- A wall blocks initial exact selection, but an already selected target remains outlined and tracked
  after moving behind that wall.
- Open portal traversal selects the expected target; closed/static obstruction clips it.
- Empty successful clicks clear; unavailable queries preserve; despawn clears; temporary realization
  loss hides and later restores indicators.
- No persistent WebGL diagnostics, browser console errors, host errors, resource-count drift, or
  unexplained selection latency remains.
- All temporary artifacts are deleted or deliberately documented as reusable harness support.

### Task Checklist

- [ ] Complete synthetic browser matrix
- [ ] Complete live outdoor/EnvCell/animation/minimap proof
- [ ] Record no-selection and selected CPU/GPU/resource costs
- [ ] Run all repository quality gates
- [ ] Remove temporary probes and sweep vocabulary/comments/docs

## Verification Matrix

### Rust

- `cargo test -p holtburger-dat`
- `cargo test -p holtburger-content`
- `cargo test -p holtburger-protocol`
- `cargo test -p holtburger-world`
- `cargo test -p holtburger-core`
- `cargo test -p holtburger-3d-host`
- `cargo test -p holtburger-debug-harness --bin selection_envelope_census`
- `cargo clippy -p holtburger-dat --all-targets -- -D warnings`
- `cargo clippy -p holtburger-content --all-targets -- -D warnings`
- `cargo clippy -p holtburger-protocol --all-targets -- -D warnings`
- `cargo clippy -p holtburger-world --all-targets -- -D warnings`
- `cargo clippy -p holtburger-core --all-targets -- -D warnings`
- `cargo clippy -p holtburger-3d-host --all-targets -- -D warnings`
- `cargo fmt --all -- --check`

Focused fixtures must cover PhysicsScript cue/table resolution, absolute scale and ramps, collision/
residency/projection scale consistency, eligibility independent of collision participation, ordinary
membership reuse, pure-query non-mutation, inherited attachment scope, portal traversal, the accepted
boundary miss, static clipping, all-candidate behavior, per-entity preparation omission, query
coverage failure, deterministic ordering, and command/event projection.

### Frontend

Run from `apps/holtburger-3d` through package scripts:

- `npm run test:ts`
- `npm run check`
- `npm run lint`
- `npm run format:check`

Focused tests must cover exact ray geometry, current animated transforms, static-limit rejection,
stale request invalidation, selection lifetime, viewport click/drag arbitration, minimap overlap and
pan arbitration, target projection, edge clamping, mask resource lifecycle, and diagnostics.

### Browser and Live Runtime

- Extend `npm run harness:browser` fixtures and run both SwiftShader and a real GPU.
- Exercise both flat and portal renderer schedules with profiler collection disabled and enabled.
- Use `npm run probe:client:ui` or a narrowly extended live-client probe for real ACE world state; do
  not run the interactive TUI client.
- Capture screenshots for large target, small target, off-screen target, and through-wall silhouette,
  plus machine-readable selected GUID, draw counts, resource bytes, and console/WebGL diagnostics.

## Risks and Mitigations

### A Scalar Envelope Can Miss Animation or Become Too Broad

The default-pose union failed a drawing-bound proof, while membership-only fallback is too broad
outdoors. Phase 0 therefore selected a unit-scale, full-animation sphere closure without visiting
vertices. Resteer A measures false positives and live candidate counts. Per-clip envelopes, current-
part bounds, and a browser-local triangle acceleration structure are successive refinements only if
that evidence shows exact work is expensive; silently truncating candidates is not acceptable.

### Ordinary Residency Can Miss a Protruding Visual Envelope

The regular collision/world residency was not computed from the larger full-animation selection
envelope. Reusing it can omit a target whose animated visual geometry crosses a portal or outdoor
boundary while its ordinary body does not. This is an accepted first-cut false negative, not a
conservative guarantee. A focused portal-boundary fixture and live probe size it, and the implementation
records the deliberate retail divergence. Selection-specific membership is reconsidered only if that
evidence outweighs its state/lifecycle complexity.

### A Pure Query Performs Linear Work Per Click

The immutable scan removes dirty tracking and every second-index lifecycle, but visits the current
retained population per direct click. Resteer A measures this explicitly. If it is material, the first
optimization narrows input through the scene's existing coarse landblock map while preserving exact
membership filtering and cross-owner bounds. A mutable selection index is not introduced merely to
avoid measuring cheap sphere tests. An individual missing prepared envelope is omitted and diagnosed
rather than blocking unrelated selection.

### Attached Candidates Have No Host-Exact Bound

An attached child's current transform depends on browser-owned parent-part animation. Returning every
eligible attachment whose world ancestor shares a reached domain is conservative with respect to that
ownership split but may increase frontend refinement work, especially outdoors. Resteer A measures the
fanout. If it is material, the next candidate is a content-derived maximum attachment-reach bound—not
a default-pose host transform that would introduce silent misses.

### Shared Scale Ownership Is a Broader Runtime Cutover

Moving dynamic PhysicsScript timing and whole-object scale out of the browser touches collision,
residency, projection, and existing presentation effects. A partial migration would be worse than the
current bug because two clocks could diverge silently. Phase 1 therefore first establishes a single
generation-qualified behavior stream, then atomically activates unit collision geometry plus one live
world scalar while disabling browser scheduling for dynamic entities. Final cleanup removes the dead
dynamic script/scale path. Logical browser behavior targets outlive scene-node realization, which
preserves persistent effects without buffering an unbounded history or replaying transient audio.
Selection does not consume current scale until this cutover is complete.

### Collision Occlusion Can Differ From Visual Occlusion

The host knows collision surfaces, not pixels. Decorative non-collidable geometry may look like a wall
without clipping selection, while collision may extend beyond visible drawing. Retail's picker does
not gate dynamic hits against static depth at all; the first cut deliberately chooses collision-backed
acquisition and records the required divergence at the implementation site. Sampling the browser depth
buffer is not a drop-in replacement because the clicked entity and other entities also write depth,
and portal traversal remains host-owned.

### Renderer Integration Can Duplicate Geometry or State

The silhouette pass must consume existing geometry handles and current instance transforms. A second
selected-entity scene graph, copied mesh buffers, or animation observer would create divergent state.
It must also feed the existing final presenter rather than adding a second default-framebuffer write.
Exact diagnostics and no-selection lazy allocation make duplication visible.

### Async Results Can Overwrite Newer User Intent

Viewport queries are asynchronous while minimap selection is immediate. One selection-owner action
revision invalidates every older pending query, including when the newer action came from another
input path. This is request ordering, not entity-generation tracking.

### Pointer Gestures Can Regress Camera or Minimap Control

Selection happens only on release below the named app-local three-pixel threshold. Pointer capture,
lost-capture/cancel tests, and the existing HUD harness prove orbit, pan, precise jump, and selection
as mutually exclusive outcomes.

## Definition of Done

- Phase 0 evidence supports the selected envelope policy and is recorded in this document.
- Dynamic whole-object scale has one shared clock and one world-owned current value used consistently
  by collision, ordinary residency, projection, and selection placement.
- The native world path performs portal-aware, static-clipped all-candidate discovery from one proven
  conservative unit-scale scalar per eligible world entity. Its query is immutable, consumes ordinary
  residency, includes attached entities through inherited scope, keeps overlapping disconnected
  EnvCells distinct, explicitly documents the accepted portal-boundary miss, and retains no drawing
  geometry or presentation animation state.
- The browser refines every candidate against the current animated drawing geometry and selects the
  nearest exact GUID without traversing portals.
- Viewport and minimap input converge on one GUID-only app-local selection owner with correct async,
  empty, unavailable, unrealized, and removal semantics.
- A current-pose depth-independent silhouette outline remains visible through walls.
- Small on-screen and off-screen targets receive stable, correctly directed screen-space markers.
- Flat, portal, SwiftShader, real-GPU, and live ACE evidence passes with bounded latency and no resource
  leaks or diagnostics.
- Rust tests/clippy/format and frontend tests/check/lint/format all pass.
- No temporary instrumentation, guessed padding, stale vocabulary, or undocumented retail divergence
  remains.

## Remaining Measurement Questions

1. After removing PhysicsScript-table identity and maximum scale, what are the final unit-scale cache
   cardinality and p50/p95/max radii?
2. What is the fixed-tick cost and ordinary-residency churn of real dynamic scale ramps, especially at
   portal boundaries?
3. How often does regular residency omit a target whose animated drawing geometry crosses a portal or
   outdoor boundary, and is that accepted miss observable enough to justify more membership machinery?
4. What are the median, p95, and worst pure-query scan times, membership matches, sphere tests, and
   candidate populations for outdoor and portal-heavy live Client interest?
5. How many inherited-scope attached candidates occur in equipment-heavy outdoor populations, and do
   they justify an authored maximum attachment-reach bound?
6. What are the corresponding browser current-part and triangle counts, and does current-part sphere
   pruning suffice before any browser-local acceleration structure is deserved?
7. Which visible/collision surface disagreements are observable in representative outdoor and
   EnvCell scenes? The first cut's collision-backed acquisition rule is settled, but this sizes its
   known presentation mismatch.

Question 2 belongs to Resteer S; the rest are Resteer A optimization and compatibility measurements.
None reopens portal traversal in the browser or presentation animation in the host.
