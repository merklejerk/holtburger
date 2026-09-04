# Holtburger 3D Client Entity Selection Plan

Status: **Complete. Host and browser evaluate dynamic PhysicsScripts in parallel for disjoint
simulation and presentation consequences. The host performs portal-aware, static-clipped candidate
discovery from ordinary residency; the browser owns exact current-pose refinement plus app-local
hover and selection state.**

Created: 2026-09-02
Origin: Client-mode entity selection through the 3D view and minimap, with persistent x-ray and
screen-edge tracking affordances

## Context and Boundaries

### Goal

Add one GUID-owned Client-mode selection mechanism that can select a world entity either by clicking
its current animated presentation in the 3D viewport or by clicking its minimap blip, then keep the
selected entity trackable with a depth-independent silhouette outline and an off-screen directional
marker. While the pointer is over the 3D viewport, provide live-ish pick
feedback so the cursor says whether the newest completed sample found a selectable entity.

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
- Probe the current viewport pointer at a maximum 15 Hz, apply the same broad/narrow pick as clicks,
  and change the canvas cursor when the newest completed sample has an exact selectable hit.
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
- Clear selection on a successful empty click, authoritative removal, explicit frontend residency
  eviction, or movement beyond the one-landblock acquisition distance.
- Keep selection through temporary realization gaps unrelated to residency; hide affordances until
  that GUID is realized again.
- Render a depth-independent WebGL silhouette outline from the selected entity's current animated
  geometry so walls and portal occlusion cannot hide it.
- Render a glowing edge-clamped directional marker when the target is outside or behind the camera
  frustum; on-screen targets use only the silhouette regardless of footprint.
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
  the silhouette and off-screen marker are deliberate Holtburger presentation choices.

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
- Retail's SmartBox wrapper starts a mouse-over object search from pointer movement and its global
  loop, keeps only one search reason outstanding, and updates cursor state after the render reports
  the found object (`acclient.c:265598-265608`, `265537-265595`, `265803-266015`). Mouse-down starts
  a separate accurate selection search (`acclient.c:265610-265654`). This proves pre-click feedback
  and click acquisition are related but distinct operations.

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
- Two similarly named script identities must remain distinct. `SetupModel.default_script` is a
  direct 0x33 PhysicsScript DID that retail starts during `CPhysicsObj::InitDefaults`
  (`acclient.c:309060-309138`); shipped setup values such as `0x33000010` corroborate that type. The
  object-description `DefaultScript`, by contrast, is a stored `PlayScript` cue plus intensity that
  resolves through the entity's effective 0x34 PhysicsScriptTable only when an actual default-script
  trigger occurs. ACE emits the same cue/intensity operation live at `0xF755`; Holtburger already
  decodes that payload but misnames it `PlayEffect` and its cue
  `script_id`. Retail's separate `0xF754` message directly names a 0x33 script DID, but ACE does not
  emit it. The scale fix must preserve setup-direct roots and explicitly triggered table-resolved
  roots without inventing generation-time object-default playback.
- `holtburger-world` already owns the motion-animation cursor and consumes simulation-relevant motion
  hooks. The table-reachable animation census found zero authored `Scale`, `SetOmega`, or
  `AnimationDone` hooks; current authored scale behavior instead arrives through setup defaults and
  PhysicsScripts. Core must therefore extract direct `Scale` timelines from activated dynamic roots,
  while the browser keeps its independent evaluator for presentation-owned hooks, `CallPES`, and
  asset staging. The resulting current scale belongs in world because collision, residency,
  projection, and later selection-envelope placement consume it.
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
7. **Fix whole-object scale before building selection on it.** Core schedules direct `Scale` records
   from each activated dynamic root on the simulation clock; world owns the resulting absolute current
   whole-object scale and applies it to collision, ordinary residency, authored root offsets,
   selection-envelope placement, and dynamic-view projection. The browser independently evaluates
   the same roots on its presentation clock but consumes dynamic PhysicsScript `Scale` without
   applying it, taking projected world scale as authoritative instead. A scale-hook target is
   absolute: an entity authored at scale 2 that receives target 3 ends at 3, not 6.
8. **The coarse bound is a sphere-only full-animation closure.** At unit whole-object scale it
   conservatively encloses every effective part's drawing-BSP root sphere over reachable frame
   translations, authored selection, setup part scale, and visual-root rotation. It does not visit
   vertices or bake PhysicsScript scale growth; placement multiplies it by world's current effective
   scale.
9. **Cache one unit-scale object-local envelope per effective visual profile.** The key is the setup
   DID, ordered effective part DIDs, and effective motion-table DID. Full drawing geometry and runtime
   part animation remain browser-owned. Palette, texture, PhysicsScript table, GUID, root pose, and
   current whole-object scale are absent because they do not change unit-scale geometry. Content/core
   prepare a typed radius whenever the geometric profile changes. Preparation errors remain explicit
   coordinator failures, while an entity whose envelope is not ready is simply omitted from that
   click's broad phase.
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
   current selection unchanged. Individual world-placed entities without a current prepared envelope
   are omitted; they do not poison the entire click.
    Attached candidates do not require a host envelope. An available response with no exact browser
    hit is a successful empty click and clears selection.
16. **The first target visual is a depth-independent silhouette outline.** A WebGL mask re-renders the
    selected entity's current animated geometry with depth testing disabled. The existing final scene
    presenter samples that mask, derives its outer edge, applies the stable outline color after scene
    grading, and remains the frame's sole default-framebuffer writer. Walls cannot occlude the outline,
    while the entity's interior material remains unchanged.
17. **The screen-space marker exists only for off-screen tracking.** An off-screen or behind-camera
    target gets a glowing edge-clamped directional arrow. Every on-screen target uses only the
    silhouette; projected-footprint classification is deliberately absent.
18. **Selection survives only recoverable realization gaps.** A dynamic-entity removal, explicit
    frontend scene-interest eviction, or current camera-to-target distance beyond 192 m clears the
    matching GUID. Asset preparation and other non-residency realization gaps merely hide indicators.
19. **Eligibility follows retail's ordinary UI selection, not combat attackability.** Retail arms
    picking for a drawable `CPhysicsPart` whose owning physics object has a nonzero ID
    (`acclient.c:303121-303157`), then its ordinary click consumer accepts the object unless the
    `UI_HIDDEN` bit is set (`acclient.c:265803-265849`). `ObjectIsAttackable` is consulted by combat
    and auto-target paths, not ordinary click selection (`acclient.c:389925-389968`). Candidate
    discovery includes non-UI-hidden world-placed and attached setup-backed entities independently of
    physical collision or `ATTACKABLE`. The controlled player receives no additional special
    exclusion.
20. **Hover is a sampled preview, not frame-authoritative state.** The viewport requests at most one
    hover pick at a time and at most 15 times per second, using the exact click broad/narrow pipeline.
    The newest completed hover response may be modestly stale by explicit UX concession. Sequence
    routing prevents an older response from overwriting a newer response or mutating selection; no
    scene-generation, result TTL, explicit scene-invalidation graph, or cached-hover click shortcut is
    added. Clicks always issue their own fresh acquisition.

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

ClientWorldView current pointer (maximum 15 Hz, one request in flight)
    -> same host candidate and browser refinement path
    -> newest completed hovered GUID
    -> ClientWorldView selectable/default cursor policy

Minimap GUID/empty -> ClientEntitySelection directly (and invalidates an older viewport action)

ClientEntitySelection cold GUID
    -> Minimap selected ring
    -> GamePresentationRuntime current node/bounds
       -> WebGL depthless mask + final-presenter outline
       -> imperative off-screen ClientTargetIndicator
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
triangle distances across every candidate anyway.

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
struct SelectionEnvelopeProfile {
    setup_did: u32,
    effective_parts: Vec<u32>,
    motion_table_did: Option<u32>,
}

struct SelectionEnvelope {
    radius: f32,
}

enum CachedEnvelope {
    Preparing,
    Ready(SelectionEnvelope),
    Unavailable,
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

`ClientSelectionEnvelopeCoordinator` owns one profile cache whose enum distinguishes preparing,
ready, and unavailable results. Its per-GUID demands carry the current authoritative facts and any
in-flight worker, which is enough to deduplicate shared profiles and reject stale completions. These
instance/profile checks guard asynchronous preparation; they are not selection identity. Attached
entities do not trigger per-entity envelope preparation merely for selection. `WorldState` stores
only `Option<SelectionEnvelope>` directly on each entity and clears it whenever geometry-bearing
appearance facts change. It stores neither the cache key, request handle, failure taxonomy, nor a
parallel envelope registry. Detailed preparation failures remain in core logging. This is ordinary
entity data, not spatial registration or a second membership.

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
claim. Missing or failed per-entity envelope preparation omits that world entity only and is logged by
the coordinator; it does not reject an otherwise valid click. Missing ray-path collision coverage or
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

| Component                                               | Owns                                                                                                                                                                                    | Explicitly does not own                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `holtburger-protocol`                                   | Deterministic wire decoding for `ObjDescEvent`, `0xF755` PlayScript cue/intensity, and related server facts                                                                             | Script execution, selection policy, spatial queries            |
| `holtburger-dat`                                        | Typed immutable SetupModel, animation, GfxObj, PhysicsScript, and PhysicsScriptTable decoding                                                                                           | Runtime caches, entities, clocks                               |
| `holtburger-content` envelope builder                   | Stateless construction of a unit-scale full-animation envelope from already-resolved geometry/motion profile facts                                                                      | Per-entity pose, scale, membership, cache lifetime             |
| New core `ClientSelectionEnvelopeCoordinator`           | Persistent profile result cache, in-flight deduplication, current-profile observation, stale completion rejection, and installation of a validated per-entity envelope state into world | Spatial registration, portal traversal, selected GUID          |
| Core dynamic scale-script controller                    | Setup-direct/default/live root resolution, direct `Scale` record timing, generation cancellation, and absolute scale commands                                                           | `CallPES`, particles, sound, materials, rendering              |
| Core `ClientRuntime`                                    | Fixed-tick ordering, camera-identity validation, selection command dispatch, invocation of the world query, and `ClientViewEvent` publication                                           | Portal math, UI intent, exact triangles                        |
| Core `ClientCollisionCoordinator`                       | Readiness and publication of the immutable static `CollisionScene` used by simulation and queries                                                                                       | Dynamic body snapshots, selection candidates, scale clocks     |
| `WorldState`                                            | Entity/attachment lifetime, current effective scale/ramp, per-entity envelope readiness, canonical dynamic bodies, ordinary memberships, and ObjDesc sequence gating                    | DAT access, animated presentation parts, UI selection          |
| `CollisionScene` plus focused world query               | Static finite-ray/portal trace and coverage, then the pure entity/membership/envelope join                                                                                              | Candidate caching, selected GUID, browser pose refinement      |
| App-host `ClientHostRuntime`                            | Strict command allowlist, input validation, and relay to core                                                                                                                           | Query execution and selection policy                           |
| App-host `run_client_task`/`client_projection.rs`       | Core event draining, replacement snapshots, selection/cue relay, and narrow browser projection                                                                                          | Evaluated PhysicsScript hooks, spatial decisions, geometry     |
| Browser `ClientLifecycleSession`                        | Transport submission and typed event delivery, including dynamic removals and query results                                                                                             | Query ordering policy and exact picking                        |
| Browser `ClientPresentationSession`                     | Last-presented camera-ray sampling and a narrow facade over current presentation refinement/frame facts                                                                                 | Selected GUID mutation and portal traversal                    |
| Browser `GamePresentationRuntime`/`DynamicEntitySystem` | Dynamic presentation PhysicsScripts and `CallPES`, asset readiness, current animated/attached transforms, projected world scale, CPU geometry refinement, and rigid bounds              | Dynamic PhysicsScript scale authority, host coarse eligibility |
| New browser `ClientEntitySelection`                     | Sole selected-GUID mutation, independent pending click/hover sequences, exact-result arbitration, and cold selection-change notification                                               | Camera/render loops and host spatial facts                     |
| `ClientApp.svelte`                                      | Composition and teardown of lifecycle, presentation, and selection owners                                                                                                               | Per-frame picking math                                         |
| `ClientWorldView.svelte`/`Minimap.svelte`               | Pointer gesture classification and emission of a viewport point, GUID, or explicit clear                                                                                                | Async result ordering and selection lifetime                   |
| `WebGL2Renderer` selection pass and final presenter     | Current-pose depthless mask, outer-edge composite, lazy GPU resources, and diagnostics using existing geometry handles                                                                  | Selection identity and candidate policy                        |
| `ClientTargetIndicator.svelte`                          | Imperative DOM/SVG presentation of an already-classified off-screen target fact                                                                                                         | Bounds projection, world semantics, reactive frame-hot state   |

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
non-invertible or non-finite current part transform cannot produce an exact hit. Geometry and transform arrays are borrowed only for
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
- Every new viewport query replaces the prior pending click. A minimap selection, explicit clear,
  lifecycle reset, or relevant removal clears it. A completion applies only while its sequence still
  names that pending operation.
- The pending viewport operation retains only its immutable sampled ray and sequence until the
  correlated result arrives; the result need not echo ray data across the process boundary.
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

- if the projected bound intersects the viewport, show no arrow regardless of footprint;
- if it is outside the frustum or behind the camera, intersect the center-to-target direction with a
  safe inset rectangle and rotate an edge arrow toward the unclamped target direction;
- if no current presentation bound exists, show neither arrow nor stale coordinates.

Silhouette color and CSS-pixel width plus off-screen-arrow size, safe-area inset, fill, outline, and
glow live in `client-tuning.ts`. Tests consume production tuning or explicit local test inputs; they
do not copy magic values.

## Phase 0: Prove Envelope Coverage and Selection Semantics

Status: **Complete — sphere-only closure accepted and the unit-scale Phase 2 rebaseline passed.**

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
- Uniform PhysicsScript scale does not change containment for a uniformly scaled envelope and posed
  sphere. The historical Phase 0 census conservatively followed every effective physics-script table
  entry's `CallPES` closure; it did not claim those entries were generation-start object defaults.
  Sixty-six profiles reference a table containing a scale hook, 64 can grow, and the maximum authored
  scale end is 5.0. Two
  referenced tables (`0x3404E613`, `0x3404E9FB`) are absent from the archive; no referenced table
  PhysicsScript is missing. Execution later proved that `SetupModel.default_script` is a separate
  direct 0x33 root, not a cue. Those roots were omitted from the historical scale-only counts and
  must be included in Phase 1's hook inventory. This does not affect the accepted geometry closure,
  and Phase 2 removes every script-derived scale from the envelope census rather than preserving the
  stale historical distribution.
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

Status: **Complete. The split host/browser scale architecture, object-default correction, browser
live-cue path, diagnostics, compatibility marker, and cutover sweep are implemented and verified.**

### Decisions and Course Corrections

- 2026-09-03: Source verification corrected the planned live opcode. ACE
  `GameMessageScript` emits `0xF755` (`PlayEffect` in ACE's opcode enum) as GUID, `PlayScript` cue,
  and intensity. Retail identifies `0xF754` as the distinct direct-PhysicsScript-DID message. The
  implementation renames and routes Holtburger's existing `0xF755` decoder; it does not add unused
  `0xF754` support. This is a terminology/protocol correction, not a behavior concession.
- 2026-09-03: Deeper retail and archive verification separated setup and entity defaults.
  `SetupModel.default_script` is a direct 0x33 DID; `ObjectDescriptionData.default_script_id` is a
  `PlayScript` cue. The implementation names both explicitly; only the setup-direct root starts with
  the entity generation. Phase 0's
  table-wide scale census omitted setup-direct roots, so Phase 1 redoes the complete hook inventory;
  the omission does not alter the sphere-only geometry result or Phase 2's unit-scale rebaseline.
- 2026-09-03: The attempted single-evaluator cutover was rejected during execution. The existing
  browser script closure is also the readiness manifest for `ParticleEmitterInfo` definitions and
  meshes. Moving evaluated hooks across the process boundary would require a second generation-
  scoped command ledger to preserve asynchronous asset acquisition, target realization, authored-
  time catch-up, auto-assigned emitter identities, and create/stop/destroy order. That is a particle-
  runtime project, not transport plumbing.
- 2026-09-03: Archive evidence rules out suppressing presentation hooks until realization as a cheap
  alternative. Of 10,743 `CreateParticle` hooks, 10,377 (96.6%) are authored at time zero; setup-
  direct roots contain 7,579 creates, of which 7,363 (97.2%) occur at time zero. Suppression would
  erase the normal startup path for almost every authored particle effect.
- 2026-09-03: Phase 1 is therefore resteered to two domain-specific evaluators over the same static
  PhysicsScript data. Core evaluates only simulation-owned direct `Scale` timelines and world owns
  their result. The browser retains PhysicsScript traversal, `CallPES`, randomness, asset staging,
  particles, sound, translucency, and other presentation consequences. No evaluated hook,
  presentation checkpoint, or transient particle-recovery ledger crosses the process boundary.
- 2026-09-03: A complete 4,248-script graph census found 122 scripts with a direct `Scale`, zero
  scripts that reach `Scale` only through `CallPES`, and zero setup-direct roots that reach `Scale`
  only through `CallPES`. Core therefore neither executes nor inspects `CallPES`: it extracts direct
  `Scale` records from the activated root and ignores every presentation-owned hook. The offline
  census records the accepted limitation; future content that introduces indirect scale requires an
  explicit ownership revisit rather than presentation-graph knowledge in the host.
- 2026-09-03: The same census found that the 122 direct-`Scale` scripts co-author only `SoundTable`
  (120 scripts) and `CreateParticle` (121 scripts). A scale-bearing root therefore cannot be rejected
  merely because it also contains non-scale records: focused host preparation extracts its direct
  `Scale` records, browser presentation evaluates the rest, and either domain may legitimately have
  no work for a given root.
- 2026-09-03: The parallel evaluators have disjoint outputs, not competing copies of one effect.
  Dynamic-entity PhysicsScript `Scale` is ignored by the browser and projected world scale is its
  only whole-object scalar. Frontend-only static and sky PhysicsScripts keep browser-owned `Scale`.
  Any visible timing difference between world scale and presentation effects from the same script is
  a documented retail divergence caused by browser asset-realization latency, not a second scale
  authority.
- 2026-09-03: Work already completed for honest script/table identities, typed particle hooks, the
  archive census, generation-safe off-turn preparation, world scale state, and unit collision
  geometry remains useful. The partially implemented dynamic-behavior wire, checkpoint, browser
  mirror, and external-script target path are rejected scaffolding and must be removed in 1A before
  new Phase 1 work proceeds.
- 2026-09-03: Phase 1A completed the clean cutover. The general core scheduler/coordinator shrank
  from 1,776 lines to a focused scale timeline plus asynchronous content coordinator;
  `CallPES`, random rolls, translucency checkpoints, hook batches, host protocol events, browser
  mirrors, and the external-script target mode were deleted. Browser-owned closure/emitter staging
  is restored, including typed particle stop/destroy commands. Repository search finds no surviving
  rejected `DynamicBehavior` vocabulary in application code. Core, host, and all 1,905 frontend
  tests pass; focused scale tests cover direct extraction from roots containing presentation hooks.
- 2026-09-03: A follow-up boundary audit removed cold `CallPES` traversal and indirect-scale
  rejection from core. Although `CallPES` can theoretically invoke another script containing
  `Scale`, shipped content has no such path, while traversing it made missing presentation-only
  dependencies capable of rejecting valid host scale work. This is an accepted data-scoped
  concession, not a partial host implementation of presentation control flow.
- 2026-09-03: The Phase 1B consumer audit removed stale `body-height/use-radius` language. Client
  mode has no body-height consumer today, and `UseRadius` is an authored directed-movement threshold,
  not a geometric value derived from whole-object scale. The implementation therefore does not add
  unused world fields. If possession-camera behavior is later shared with client mode, it must retain
  unit setup height and derive current height from the same effective scale; that future consumer is
  explicit debt rather than speculative state in this selection cut.
- 2026-09-03: Async preparation exposed a backdating trap. Starting a root at network/entity receipt
  after world had already advanced would require retained scale-command history and retroactive replay
  across overlapping roots. That is the same class of accounting this split is meant to avoid. Each
  domain instead starts the selected root on its own clock when that domain's required immutable data
  is ready. Once active, timing and ramps are deterministic. The resulting host/browser readiness
  skew is an explicit `RETAIL DIVERGENCE`; neither evaluator pretends to catch up from a time before
  it knew the root. Resteer S measures delayed host and browser preparation separately.
- 2026-09-03: Phase 1B completed the client-mode scale cutover. The production host injects the
  focused content source; entity lifecycle and live `PlayScript` messages feed its generation-safe
  coordinator; fixed ticks apply due absolute commands and advance ramps before movement/collision.
  Prepared movement and target geometry remains unit scale, late collision completion joins the
  then-current world scalar, authored translation reads that same scalar, ordinary BSP portal
  membership refreshes during collection preparation, and dynamic views project it. Focused tests
  prove unit-geometry identity survives scaling, authored scale 2 followed by script target 3 ends at
  3, a ramp updates installed collision, and a scaled BSP part reaches an existing portal domain.
- 2026-09-03: The production dry run found and fixed an instant-scale publication gap. Scale
  advancement occurs before the runtime's normal before/after dynamic-view diff, so an immediate
  hook could change world and collision while appearing unchanged to that later diff. The scale
  route now emits one deduplicated dynamic-entity upsert for each GUID whose effective scalar changed;
  starting a timed ramp at its unchanged initial value emits nothing until the value actually moves.
- 2026-09-03: Collision-report delivery remains pre-existing runtime debt. Scale replacement
  correctly invalidates scene-owned contact lifetimes, but client simulation also discards ordinary
  collection collision-report outcomes today. Phase 1 does not invent a scale-only delivery path;
  the eventual client collision-report consumer must cover both ordinary ticks and scale invalidation
  together.
- 2026-09-03: Phase 1C split browser script composition by scale authority. Spawned-client scripts
  use a presentation evaluator whose `Scale` sink records `owned-by-world`; promoted static and sky
  scripts retain the browser `EffectSystem` sink. Both evaluators share audio, particles, targets,
  decoded closure data, and generation liveness, while each keeps `CallPES` chaining on its own
  scheduler. Focused runtime tests prove the two routes differ only at scale, and an installed
  dynamic root can apply a later projected absolute scale without replacing prepared visual assets.
- 2026-09-03: Source verification rejected the earlier statement that both setup-direct and
  object-description defaults are generation-start roots. Retail starts only the setup's
  direct 0x33 DID in `CPhysicsObj::InitDefaults` (`acclient.c:309060-309138`). Applying a physics
  description merely stores the object `DefaultScript` cue/intensity; the complete retail call-site
  search invokes `play_default_script` only from `DefaultScriptHook::Execute`
  (`acclient.c:328641-328644`) and scripted collision (`ACCWeenieObject::DoCollision`,
  `acclient.c:418050-418059`). ACE models the same distinction. The current host coordinator and the
  remaining 1C wording incorrectly auto-activate that cue during generation preparation.
- 2026-09-03: The retained `object_default_script_census` resolves every ACE World object-default
  cue against shipped setup/table data using retail's first-inclusive-threshold lookup. Of 924 rows,
  768 resolve to 45 distinct root scripts, 136 name a cue absent from their effective table, and 20
  have no effective table. No row fails only because its intensity misses an authored threshold.
  Neither a resolved root nor its transitive `CallPES` closure reaches `Scale`; 170 of the 924 rows
  are effectively `ScriptedCollision`, but that trigger distinction does not change the scale result.
  Host scale evaluation therefore removes object-default generation activation and does not model
  object-default triggers for shipped content. Browser support for presentation-only
  `DefaultScriptHook`/scripted-collision playback is separate presentation fidelity debt, not a
  dependency of selection or shared scale. Custom content that makes an object-default root reach
  `Scale` requires an explicit ownership revisit rather than speculative host trigger machinery now.
- 2026-09-03: Host generation preparation now starts only the setup-direct 0x33 script and retains
  the effective table solely for explicit live cues. Object-default cue/intensity no longer enter
  generation preparation identity or validation. Focused core tests and warning-free clippy pass.
- 2026-09-03: A first implementation review incorrectly treated a live cue as a concurrent script
  manager requiring a second execution identity. Retail proves the opposite: each physics object has
  one `ScriptManager`, and `AddScriptInternal` appends a new script after that manager's current tail
  (`acclient.c:316331-316389`); `CallPES` feeds the same object manager
  (`acclient.c:307306-307345`, `328775-328778`). The browser's per-target manager is therefore the
  right ownership shape. It needs one narrow extension: retain the live cue's separately acquired
  closure/resources for the entity generation, merge its immutable script lookup into the manager,
  and append its root at ready time. The existing ready-time divergence remains; no new script-
  instance identity or concurrent-clock abstraction is introduced.
- 2026-09-03: Phase 1C completed the live presentation path. Core emits the raw `0xF755` cue with
  the receiving entity generation while independently preparing simulation-owned scale. The app
  host forwards that typed event and serves typed 0x34 table assets; the browser resolves the first
  inclusive intensity threshold, stages the full script/emitter/mesh closure, and appends the root
  to the existing per-target manager. Pre-realization cues remain high-level and generation-bound.
  Per-GUID promise tails preserve server order through asynchronous preparation, and roots received
  between frames queue behind the manager's existing and pending tail.
- 2026-09-03: Phase 1D added distinct diagnostics for host generation/cue preparation, queued cues,
  active timelines, emitted scale hooks, active ramps, scale-driven body refreshes, browser
  pending/preparing cues, retained cue assets, script instances, and dynamic-scale suppression.
  The browser ready-time scheduling site now carries the required `RETAIL DIVERGENCE` citation,
  consequence, and 10,743-hook particle census. The rejected dynamic-behavior vocabulary sweep is
  clean outside this historical plan text. All 1,918 frontend tests, TypeScript/Svelte checks,
  frontend dead-code/ESLint/Rust lint, focused core/world tests, and focused host contract tests pass.
- 2026-09-03: The final ordering audit found that both domains initially launched cold cue
  preparation concurrently. Unequal content latency could therefore invert absolute scale and
  presentation roots despite correct per-target scheduling. Both evaluators now serialize cue
  preparation per GUID while retaining parallelism across GUIDs. Replacement aborts the exact host
  worker, stale completions cannot retire a successor worker, and browser closure teardown is
  enforced by the prepared-asset repository. Focused delayed-source tests cover both orderings and
  browser generation replacement.
- 2026-09-03: Live preflight exposed a legal `PlayScript`-before-create ordering that the split
  evaluators had not preserved: presentation silently omitted the cue while scale preparation
  rejected the absent entity and terminated the host. Retail queues the complete blob on a null
  object, refreshes a 25-second destruction deadline, and replays queued blobs after object creation
  (`acclient.c:137238-137253`, `139522-139541`, `299488-299503`, `299661-299671`). Core now owns one
  raw per-GUID FIFO shared by both consumers, expires it on the retail lifetime, and replays only
  after normal entity registration. This deliberately adds no
  pre-creation generation accounting. Focused tests cover ordering, refreshed expiry, and generation
  binding; a rebuilt live sidecar completed authentication, world entry, 10 seconds of movement, and
  explicit disconnect without reproducing the crash.

### Deliverables

Execute this phase in four ordered work units. Each unit must compile and retain existing browser
presentation behavior; do not carry rejected stream vocabulary into later selection phases.

#### 1A. Back out the per-hook stream and narrow core to scale timelines

- Rename `SetupModel.default_script` to honest direct-PhysicsScript-DID vocabulary, rename the
  object-description field to `default_script_cue`, add a typed 0x34 PhysicsScriptTable decoder to
  `holtburger-dat`, and sweep touched loaders/errors so neither identity is loaded as the other.
- Decode and route live `0xF755` PlayScript cue events. Resolve an entity's explicit
  physics-effect-table DID first and `SetupModel.default_script_table` second, then select the script
  for the live cue and intensity in core. Start the setup's direct default script independently
  during generation installation. Retain the object-description cue/intensity as configuration, but
  do not activate it merely because the entity generation was installed.
- Replace the general core dynamic-behavior scheduler with a focused controller whose prepared input
  is only the activated root script's direct `Scale` records. It starts a root when focused host
  preparation completes and owns cancellation, generation replacement, and deterministic due
  ordering from that point. It owns no presentation state and neither schedules nor rolls `CallPES`.
- During cold content preparation, load only the activated root and extract its direct `Scale`
  records. Every non-`Scale` record is outside this focused controller and cannot reject or suppress
  the extracted scale timeline. Separately diagnose known simulation-relevant hooks that still lack
  an authoritative runtime owner; do not claim this scale cutover executed them, and do not let that
  pre-existing gap block browser presentation.
- Delete the rejected `DynamicBehaviorEvent`/batch/checkpoint types, app-host wire projection,
  application-snapshot field, browser decoder/mirror/session plumbing, and external-script target
  registration. Restore dynamic browser PhysicsScript closure and particle-emitter staging. Sweep
  terms such as "dynamic behavior checkpoint" and "single dynamic clock" from surviving code,
  diagnostics, tests, and this plan.

#### 1B. Cut dynamic physics over to unit geometry plus world-owned scale

- Add one explicit world-owned effective whole-object scale state, initialized from the entity's
  authored/server scale. A `Scale` hook target is an absolute finite positive scalar. Immediate hooks
  set it directly; timed hooks ramp from the sampled current value; a mid-ramp hook retargets from the
  value reached at that instant.
- Refactor dynamic physical preparation to retain unit-scale movement spheres, BSP collision shapes,
  BSP part origins/default part scales, fallback shapes, and authored motion offsets. Remove current
  whole-object scale from the immutable prepared-profile/cache identity; retain it only on the live
  entity/body. Apply that current scalar when movement and target shapes, authored translation, and
  placed collision geometry are produced rather than rebuilding or re-decoding geometry on every
  ramp tick.
- Make fixed-tick order explicit: core advances the dynamic script controller; world applies due
  absolute scale commands and advances active scale ramps; simulation prepares/solves dynamic bodies
  and refreshes ordinary membership from that value; then dynamic views publish the same value. A
  selection command observes the last completely applied world value. The immutable static
  `ClientCollisionCoordinator` snapshot is an input to these operations and is not rebuilt for scale.
- Activate the focused core scale controller and world route together. Presentation hooks produce no
  core event and do not enter application replacement snapshots.

#### 1C. Keep presentation scripts browser-owned and make scale ownership disjoint

- Retain the existing browser PhysicsScript closure, emitter, mesh, sound-table, and target lifetime
  under `DynamicEntitySystem`; this evaluator continues to own every presentation hook and `CallPES`.
- Split dynamic-entity PhysicsScript dispatch from static/sky dispatch at composition. The dynamic
  presentation dispatcher consumes `Scale` as explicitly world-owned without mutating
  `EffectSystem`; static/sky scripts and animation hooks retain their existing visual scale behavior.
  Do not scatter target-kind tests through individual effect consumers.
- Project authoritative effective scale in every dynamic entity level and add one focused
  `DynamicEntitySystem` root-scale update that recomposes current part transforms and bounds without
  DAT reads, visual replacement, or script restart. Source scale 2 followed by script target 3 must
  render and collide at absolute scale 3, never multiplicative scale 6.
- Give browser presentation the same selection-relevant root activation inputs without sending
  evaluated hooks. Add a typed 0x34 table asset source/repository at the existing app-host content
  boundary and forward live `0xF755` as a generation-qualified cue event. The browser resolves
  setup-direct and live-cue roots from static data and stages each selected closure before
  presentation activation. Do not turn the stored object-default cue into a generation-start event.
- A live cue received before its exact generation is realized remains a high-level pending cue, not a
  particle/effect ledger. It is canceled on replacement/removal and begins on the browser presentation
  clock only after the target and selected closure are ready. Live cues are transient across receiver
  recovery; replacement state restarts only the generation's setup-direct root.

#### 1D. Validate the split and remove cutover debt

- Prove active host scale timelines, due hooks, ramps, body/membership refreshes, browser script
  instances, ignored dynamic scale hooks, and pending high-level cues through focused observable
  tests and temporary probes. Retain no counter without a recurring production consumer and a named
  scenario where it differs from existing diagnostics.
- Mark the presentation-versus-world activation timing difference as `RETAIL DIVERGENCE` at the
  dynamic browser scheduling site with the retail citation, consequence, and time-zero particle
  census. Do not label the two evaluators as synchronized.
- Delete obsolete coordinator fields, random sources, checkpoint tests, host protocol tags, and
  browser contracts from the rejected design. Run a repository-wide vocabulary sweep before Resteer
  S; no dormant per-hook wire path remains.

### Acceptance Criteria

- Retail/ACE fixtures prove setup-direct activation, the absence of generation-time object-default
  activation, and live `0xF755` cue-to-table-to-script activation in both domains. Browser fixtures
  alone prove transitive `CallPES` and seeded random/pause presentation behavior.
- Core schedules every direct `Scale` record from all 122 shipped scale-bearing scripts and no
  presentation hook, including roots that also contain `SoundTable` or `CreateParticle`. The census
  proves no shipped scale depends on `CallPES`; the host does not load or inspect called scripts.
- Authored scale 2 followed by target 3 ends at exactly 3 in world collision and browser presentation.
- Immediate, timed, and mid-ramp-retarget hooks share one deterministic current-value rule and never
  produce non-finite or non-positive collision state.
- Delayed host preparation starts its root at the completion tick without backdated hooks or retained
  scale-command history; delayed browser preparation independently follows the same ready-time rule.
- During a scale ramp, movement spheres, BSP collision, scale-sensitive authored motion offsets,
  ordinary residency, dynamic-view scale, and later selection-envelope placement all observe the
  same per-tick scalar.
- A scale change near a doorway exercises the existing ordinary residency transition machinery; no
  selection-specific scale or membership hook is needed.
- Unit collision geometry is prepared once and reused throughout a ramp; scale changes do not trigger
  DAT reads, BSP rebuilding, or per-part animation work in world.
- Dynamic setup-direct and live-cue presentation roots stage their complete browser asset closures
  before publication, so time-zero particles retain the existing ready-before-execute path.
- Dynamic PhysicsScript `Scale` changes no browser `EffectSystem` scalar; static/sky PhysicsScript and
  animation scale fixtures remain unchanged.
- Live cue preparation and activation are exact-generation safe. Replacement/removal cancels pending
  cues and asset handles without leaking presentation state.
- No evaluated PhysicsScript hook, persistent behavior checkpoint, particle recovery record, or raw
  presentation batch crosses the client host boundary.
- The static collision-scene generation remains unchanged during a scale-only ramp; only live dynamic
  body placement/membership and projected entity state change.
- Non-scale hooks neither trip focused host scale preparation nor suppress browser presentation.
  Unsupported simulation semantics remain explicitly diagnosed outside the focused scale path.

### Task Checklist

- [x] 1A: separate setup-direct and entity-cue vocabulary and add the reusable PhysicsScriptTable decoder
- [x] 1A evidence: inventory all script hooks, particle start times, and direct/indirect scale reachability
- [x] 1A: replace the general core scheduler with direct-scale timelines that ignore presentation hooks
- [x] 1A: remove the rejected per-hook wire/checkpoint/browser-mirror path and restore browser staging
- [x] 1B: add world-owned absolute scale and deterministic ramping
- [x] 1B: retain unit-scale collision inputs, remove scale from prepared-profile identity, and apply
      current scale during dynamic placement/solve
- [x] 1B: refresh ordinary residency and projection from the same tick scale
- [x] 1B: activate the focused core scale controller in production
- [x] 1C: split dynamic presentation dispatch and ignore only dynamic PhysicsScript `Scale`
- [x] 1C: apply projected scale to an installed browser dynamic without re-realization
- [x] 1C: remove host object-default generation activation
- [x] 1C: extend the browser's per-target script manager with generation-safe live-cue
      resolution/activation
- [x] 1D: prove split ownership, add the retail-divergence marker, and sweep vocabulary/dead code
- [x] Add timing, scale, collision, residency, projection, and presentation-regression tests
- [x] Add focused runtime verification without retaining one-off diagnostics

## Resteer S: Prove the Dynamic Scale Cutover

Status: **Complete — the split is accepted for selection consumption.**

Before selection consumes current scale, run focused synthetic and live/harness scenarios for an
immediate scale, a timed ramp, a mid-ramp retarget, a doorway membership transition, delayed host
scale preparation, delayed browser realization with a time-zero particle root, live cues, and entity
generation replacement. Compare the world body's placed movement/target shapes,
ordinary membership, projected scale, and rendered scale at the same committed ticks. Confirm that
static collision-scene generation and prepared unit-geometry/cache identities do not churn.

Proceed to Phase 2 only if the focused host evaluator is the sole dynamic PhysicsScript scale owner,
the browser evaluator still produces presentation effects with dynamic script scale ignored, every
world/render scale consumer agrees, and measured fixed-tick work is bounded. If the split fails, fix
its dispatch composition or unit-geometry shape here; do not compensate in the selection envelope or
reintroduce a per-hook host-to-browser stream.
Record the measurements and gate decision in this plan before Phase 2.

### Results and Gate Decision

- Synthetic world tests cover immediate absolute scale, timed interpolation, mid-ramp retargeting,
  retained unit geometry, current placed movement geometry, portal membership growth, projection,
  and installed browser transform updates. Static collision generation and immutable unit geometry
  remain stable across the scale changes.
- Controlled asynchronous tests cover delayed host generation preparation, per-GUID live-cue FIFO,
  pre-realization browser cues, delayed drawable-emitter readiness with a time-zero particle hook,
  server-order browser preparation, and generation replacement while a root load is in flight. The
  latter reaches zero retained cue assets and clean repository teardown, so stale preparation does
  not leak or activate against the successor.
- Dynamic browser `Scale` continues to report `owned-by-world`, while the same cue produces its
  presentation particle after the complete drawable closure becomes ready. Static and sky dispatch
  retain their existing browser-owned scale route.
- A temporary optimized debug-harness probe measured the deliberately simple no-active-ramp scan,
  including GUID collection and stable sorting, over 10,000 ticks for 100/1,000/10,000 retained
  entities and 1,000 ticks for 100,000. Mean fixed-tick costs were 1.275/19.170/205.693/6,192.624
  microseconds respectively on this workspace host. The first three populations are bounded well
  below one millisecond; 100,000 is an intentionally adversarial population outside client interest.
  The probe was removed after capture. An active-ramp index and its lifecycle state are therefore
  rejected as YAGNI for this cut.
- Gate decision: proceed to Phase 2. World is the sole dynamic whole-object scale authority; browser
  evaluation cannot mutate it, all current collision/projection/render consumers use the same
  absolute scalar, presentation effects survive ready-time staging, and observed fixed-tick work is
  bounded for the relevant retained-population range.

## Phase 2: Cache Envelopes and Add the Regular-Residency Candidate Query

Status: **Complete; Resteer A supplied the live boundary-frequency and cost evidence.**

Build a click-time broad phase that reuses world's established residency facts and keeps portal
traversal authoritative without maintaining a second visual-membership graph.

### Progress and Decisions

- 2026-09-03: The unit-scale census now keys only setup DID, resolved ordered part DIDs, and
  effective motion-table DID. Across 43,913 catalog templates it found 7,072 distinct profiles
  (4,210 catalog-backed). Catalog-weighted closure radius is 1.559 m at p50, 14.710 m at p95, and
  72.253 m maximum; the broadest profile including unused setup combinations is 107.5 m. With
  decoded animations and GfxObj root spheres cached, catalog-weighted compute is 429 ns at p50,
  955,753 ns at p95, 964,884 ns at p99, and 1,065,237 ns maximum on this workspace host. Current
  whole-object scale and PhysicsScript-table identity were removed from both the key and benchmark.
- 2026-09-03: World stores only the current optional envelope on the authoritative entity. Core
  resolves setup part overrides off-turn before it can know the final cache key, then shares one
  persistent closure preparation across every demand for that resolved profile. A focused test
  caught an installer that guarded only the sidecar generation; publication now also verifies the
  current entity instance sequence.
- 2026-09-03: `ObjDescEvent` now uses named instance slot 8 and visual-description slot 7 with
  wrap-aware gates. Future-instance complete appearances live in the existing per-GUID lifecycle
  state and join a matching create before its spawn/replacement event is published. Palette-only
  updates still reconcile presentation but coordinator fact equality avoids needless envelope work.
- 2026-09-03: The finite one-landblock world query reuses a focused static-ray trace for portal
  traversal, coverage, reached domains, and the first obstruction. It scans canonical retained
  entities without a second index, tests ready unit spheres at current body pose and effective scale,
  returns every hit sorted by GUID, and treats one missing envelope as an omission rather than a
  query failure. Attached children inherit their world-placed ancestor's ordinary scope and skip a
  fabricated host transform.
- 2026-09-03: The stateless resolved-profile construction and sphere-only animation closure live in
  `holtburger-content`. Core's content-backed adapter supplies typed decoded assets from
  `ContentAssetService`, then owns only worker scheduling, persistent result reuse, entity demand,
  and exact-generation publication. This keeps content mathematics out of lifecycle orchestration.
- 2026-09-03: Focused tests currently cover stale generation publication, shared-profile in-flight
  deduplication, wrapping visual sequences, future visual/create joining, static clipping, stable
  ordering, per-entity pending omission, and attached scope inheritance. Portal-boundary blast-radius
  evidence, full eligibility/coverage fixtures, and scan timing remain open.
- 2026-09-03: Production-query release timings over an installed covered outdoor scene were
  5.722/60.910/1,027.199 microseconds per query for 100/1,000/10,000 direct ready entities.
  Scope-only attached fanout cost 1.835/8.713/82.160 microseconds for 10/100/1,000 children. The
  temporary benchmark was removed after capture. This keeps the linear scan for the first cut; a
  second spatial index remains unjustified at measured ordinary populations.
- 2026-09-03: Focused fixtures now cover missing coverage, collision clipping, current-scale
  placement, moving ethereal eligibility, stable all-hit ordering, attached inheritance, authored
  portal traversal, disconnected overlapping EnvCells, and the accepted regular-residency boundary
  miss. The boundary fixture produces one intentional false negative when a source-cell entity's
  ready sphere protrudes through a portal into the ray's target cell. A live frequency census still
  belongs to the Phase 5 Client-mode probe; it is evidence debt, not hidden correctness work.

### Deliverables

- Remove maximum PhysicsScript scale and PhysicsScript-table identity from
  `selection_envelope_census`, rerun it, and record final unit-scale profile counts and radius
  distribution. Keep the already-proven sphere-only animation closure and compute benchmark.
- Add the unit-scale selection-envelope type and stateless sphere-only closure helpers at the layer
  that prepares effective appearance/motion profiles. Cache one radius per setup DID, resolved ordered
  part-DID array, and effective motion-table DID.
- Add a dedicated core `ClientSelectionEnvelopeCoordinator`. It observes selectable setup-backed
  entity profile facts, looks up or starts one persistent-cache preparation, and installs only a
  request-current result into world. Appearance/profile changes first clear the entity envelope, so a
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
  `ATTACKABLE`. A current world-entity missing/failed envelope is omitted, not promoted to
  a whole-query failure. Missing ray-path collision coverage remains `unavailable`.
- Add a portal-boundary fixture and live probe that size the accepted false-negative case: animated
  visual geometry/envelope crosses a portal or outdoor boundary while regular residency does not.
  Record a `RETAIL DIVERGENCE:` marker with the retail render-picker citation and measured blast
  radius if the implementation retains this policy.
- Use temporary benchmark instrumentation to size scan work, then remove it from the production query
  contract once the simple scan passes the gate.

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
- Individual unready or failed envelopes cannot reject the whole click; preparation failures remain
  visible in coordinator logs.
- Candidate ordering is stable by GUID and independent of entity iteration order.
- Pure scan time and attached candidate fanout are measured before any new spatial index is introduced.

### Task Checklist

- [x] Rebaseline the Phase 0 census as a unit-scale, geometry-only cache
- [x] Add the dedicated coordinator, resolved/in-flight cache shape, per-entity envelope state, and
      stale-result rejection
- [x] Add the proven `ObjDescEvent` instance/visual sequence gates and pending-future-instance lifecycle
- [x] Add the dedicated finite world query contract
- [x] Add the immutable world-entity/membership scan and direct placed-envelope tests
- [x] Add inherited-scope attached candidate discovery without a fabricated host transform
- [x] Share static ray/path helpers without widening nearest-surface semantics
- [x] Intersect every reached selection envelope without nearest-dynamic early termination
- [x] Add obstruction, coverage, eligibility, attachment, movement, ordering, and portal-boundary tests
- [x] Measure the scan with temporary instrumentation, remove it, and document the accepted boundary miss

## Phase 3: Carry Queries Through Core and the Host Boundary

Status: **Complete.**

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

- [x] Add the core command/event and runtime dispatch
- [x] Add narrow host request/result projections and command allowlist entry
- [x] Add strict TypeScript decoding and lifecycle delivery
- [x] Test every outcome and stale sequence
- [x] Sweep precise-jump-only vocabulary from newly shared camera-ray primitives

## Phase 4: Refine Current Animated Geometry and Own Selection

Status: **Complete.**

Make one app-local controller the only selection mutator.

### Progress and Decisions

- 2026-09-03: `ClientPresentationSession` now samples one coherent last-presented camera ray with a
  host-facing anchored AC projection and a browser-facing unit world ray. Precise jump delegates to
  that sampler without changing its maximum-distance contract.
- 2026-09-03: Immutable part templates retain a reference to their already-existing CPU object mesh;
  selection introduces no vertex/index copy or second geometry cache. `DynamicEntitySystem` exposes
  a synchronous callback view of currently posed, draw-eligible parts. Scene resolution composes the
  entire attached parent-part ancestry before the callback receives landblock-local transforms.
- 2026-09-03: Exact refinement rebases the world ray into each candidate landblock, inverse-transforms
  it without renormalizing direction, prunes by current part AABB, and tests authored triangle ranges.
  Negative-determinant transforms explicitly reverse culling parity to match WebGL winding. `NoDraw`,
  `Hidden`, fully translucent parts, and degrade-hidden ranges do not participate; partial
  translucency does.
- 2026-09-03: `ClientEntitySelection` is the sole selected-GUID mutator. Its one pending record carries
  query sequence and sampled exact ray. Direct/minimap-style selection
  invalidates older work; available exact misses clear; unavailable or submission failures preserve;
  accepted authoritative removal clears. Cold changes alone enter Svelte and one presentation level
  setter; selected node/bounds and geometry remain imperative reads.
- 2026-09-03: Focused tests cover adjacent-landblock rebasing, current transforms, exact false-positive
  rejection, static limits, distance/GUID ordering, mirrored authored sidedness, inherited attached
  transforms, full suppression, cross-input stale results, unavailable/submission preservation, and
  removal. The pre-gesture harness driver invokes the same `acquireViewportPoint` path Phase 5 will
  wire to the canvas.

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
- Add `ClientEntitySelection` with selected GUID, one composite pending operation containing query
  sequence and sampled ray, typed outcome handling, command-submission failure handling, removal handling, and a selection-change notification only for
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
- Expose one frame-hot composite presentation-state read for selected bounds without copying geometry
  or publishing per-frame Svelte state.
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
- Temporary unrealization unrelated to residency hides frame output but retains GUID. Matching authoritative
  removal, frontend residency eviction, or movement beyond 192 m clears it.
- No selection generation, frontend portal walker, host animation state, duplicate CPU geometry, or
  Svelte frame-hot store is introduced.

### Task Checklist

- [x] Generalize the coherent camera-ray sampler
- [x] Add pure exact-intersection helpers
- [x] Expose current realized geometry lookup by GUID
- [x] Compose the selection owner at `ClientApp.svelte` with injected lifecycle and presentation ports
- [x] Add the narrow pre-gesture harness acquisition driver
- [x] Add animation, obstruction, ordering, stale-result, removal, and unrealization tests

## Resteer A: Measure the Vertical Slice

Status: **Complete.** The simple retained-population scan and browser exact refinement pass the live
outdoor and EnvCell latency gate. No selection-specific spatial index or browser acceleration
structure is justified.

### Progress and Decisions

- 2026-09-03: Live preflight authenticated `+Holtmage`, entered the world with 14 observed entities,
  processed 1,172 event frames during a 10-second drive, and disconnected cleanly. The run validated
  the early-`PlayScript` ordering fix described in Phase 1 but did not yet inject viewport samples or
  collect selection-query/refinement latency. At that point Resteer A remained open for that evidence,
  with the environment blocker removed; the later grid runs below closed it.
- 2026-09-03: The live selection harness now drives the same `acquireViewportPoint` method reserved
  for Phase 5 gestures over an 11-by-7 viewport grid. One correlated measurement contains the typed
  world broad-phase diagnostics, browser refinement counters, IPC latency, and total selection
  latency. That temporary measurement seam and its query/refinement counters were removed after the
  gate closed; the production result retains only availability, static limit, and candidate GUIDs.
- 2026-09-03: In the populated `71.8N, 61.1W` scene, the presentation census observed 99 entities and
  the query snapshot scanned 119. Across 77 sequential rays, host query time was 442 us p50, 694 us
  p95, and 870 us maximum. The query found 53 ordinary-scope matches, tested 48 envelopes, and
  returned 6 candidates at p50/p95 (7 maximum). Five candidates were inherited-scope attachments.
  Browser refinement was 0 ms p50, 0.1 ms p95, and 0.3 ms maximum; it tested at most 2 parts/76
  triangles. Total acquisition was 7.8 ms p50, 13.4 ms p95, and 17.8 ms maximum. A cold pre-settle
  pass omitted 23 pending envelopes on one sample while every later p95 was zero, confirming that
  readiness omission stays per entity and never rejects the query.
- 2026-09-03: In dungeon `0288`, after requiring an authoritative `in-world` lifecycle and a 500 ms
  envelope settle, the query scanned 34 entities while traversing 4 portal scopes p50, 8 p95, and 10
  maximum. It matched 2 entities, tested 1 envelope, and returned 2 candidates at p50/p95/max. Host
  query time was 69 us p50, 157 us p95, and 199 us maximum; browser refinement was 0.1 ms p95 and
  0.3 ms maximum; total acquisition was 0.5 ms p50, 0.9 ms p95, and 4.3 ms maximum. No envelope was
  pending, unavailable, or missing. The character was restored to the populated outdoor location.
- 2026-09-03: Gate decision: keep the pure O(retained population) host scan, ordinary residency, broad
  attached-scope admission, and AABB-pruned browser triangles unchanged. The outdoor candidate-to-
  exact-hit ratio is deliberately poor because five attachments accompany every ray, but maximum
  exact work was 76 triangles/0.3 ms; optimizing the ratio would add machinery without observable
  latency benefit.
- 2026-09-03: Concessions: this local server did not provide an equipment-heavy multi-player crowd,
  and the grid did not independently identify a live ordinary-residency boundary false negative.
  Existing focused attachment and portal-boundary fixtures remain the positive behavioral evidence.
  These are compatibility-coverage limits, not performance blockers; retain them for the final live
  proof rather than delaying Phase 5 or inventing synthetic “live” populations.

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

Status: **Complete. Viewport clicks and minimap blips now route through the same client selection
owner without stealing orbit, pan, or precise-jump gestures.**

### Decisions and Course Corrections

- 2026-09-03: `ClientWorldView` now depends on a two-method `orbit`/`zoom` camera capability rather
  than the concrete possession-camera controller. The component never consumed session lifecycle or
  camera state, and narrowing the dependency makes its gesture boundary directly injectable while
  remaining structurally compatible with the production controller.
- 2026-09-03: The minimap's 2D breadcrumb/blip overlay no longer treats a missing terrain source as
  a reason to suppress presentation entities. Projection, drawing, hover, and hit testing need only
  a coherent map subject/view; WebGL terrain readiness remains isolated to `drawMap`. This removes
  an accidental coupling and lets the existing HUD harness exercise the real marker path without a
  fake terrain runtime.
- 2026-09-03: Pointer classification is shared only as small immutable math. Components retain
  pointer capture, cancellation, and policy ownership. Crossing three pixels emits the complete
  start-to-current orbit delta once, subsequent movement is incremental, and a stationary release
  emits no zero-length camera operation.
- 2026-09-03: The existing Chromium Client HUD harness now drives the actual canvas handlers. It
  proves click-scale jitter selects without orbit, drag emits the expected full then incremental
  deltas without selecting, precise jump is exclusive, blur and camera lifecycle loss cancel an
  armed click, empty minimap clicks clear, marker clicks select through the same owner, the selected
  ring is drawn, and minimap drag pans without changing selection. Focused deterministic tests cover
  gesture transition math and distance-then-GUID marker ties.

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

- [x] Add viewport click/drag arbitration
- [x] Add minimap GUID hit selection and empty clear
- [x] Add selected-blip feedback
- [x] Route both paths through the selection owner
- [x] Extend focused gesture and HUD harness coverage

## Phase 6: Render the X-Ray Silhouette Outline

Status: **Complete.**

Render a current-pose target outline that remains visible through walls without disturbing normal
scene depth or materials.

### Deliverables

- Add a focused `webgl2-entity-selection-pass.ts` with:
  - a lazily allocated, full-drawing-buffer single-channel mask target;
  - a geometry mask program consuming the selected node's existing material-independent depth ranges,
    current instance transforms, and existing GPU geometry handles;
  - a runtime-resolved sphere proxy that replaces a dimensionally planar particle carrier and derives
    its diameter from that carrier's longest current rigid-pose AABB edge;
  - the same current part suppression, `retailVisibility`, and authored cull-face rules as ordinary
    presentation, while depth testing and portal scope/routing are deliberately ignored;
  - an outer-edge/dilation sample supplied to the existing fullscreen presenter.
- Have `ObjectVisualTemplateRepository` classify a resolved appearance with exactly one normally
  visible rigid carrier once as `planar-carrier` or `volumetric`, using that carrier's geometry-local
  bounds, and copy the immutable fact into each prepared dynamic entity. Geometry-local
  classification is invariant under animation and setup pose. The classifier admits only
  dimensionally degenerate bounds (plus a machine-epsilon allowance for decoded-coordinate noise),
  not arbitrary thin objects; multi-part rigid appearances stay volumetric rather than requiring a
  mesh-wide coplanarity algorithm, and whole-object scale never requires a per-frame rescan.
- Expose live emitter ownership from `ParticleSystem` through its existing per-owner aggregate. This is
  one O(1) map lookup and neither enumerates emitters nor re-evaluates particles.
- Make `GamePresentationRuntime` the sole effective-shape policy owner: planar carrier plus a live
  emitter owner becomes `sphere-proxy`; every other entity remains `rigid`. Resolve that same policy
  for both exact click refinement and the selected-target render input, so neither consumer
  reclassifies entities or carries a class allowlist.
- Add an optional current realized `selectionTarget` to renderer `FrameInput`, carrying the node ID
  and an explicit rigid-or-sphere-proxy shape. The renderer expands rigid geometry synchronously or
  consumes the already-resolved local sphere and does not retain selection identity or policy.
- Schedule and clear the selected mask after the flat or portal scene has been assembled but before
  `#presentFlatScene`, using the same primary camera and clip transform. Pass the optional mask to
  `WebGL2FlatScenePresentation`, which grades/transitions the scene, derives only the mask's outer edge,
  applies a stable outline color, and performs the frame's sole default-framebuffer write. Portal
  transition sampling must transform scene and mask with the same presentation coordinates.
- Keep ordinary entity drawing, depth, materials, transparency ordering, shadows, and scene targets
  unchanged.
- Suppress the pass for no selection, an unrealized target without drawable selection geometry, or a
  loading/portal transition with no valid current primary world view.
- Add exact resource lifecycle and work diagnostics: live mask bytes, target generations allocated/
  released, selected part/triangle submissions, mask draws, composite draws, and skipped reason.
- Destroy and resize every selection resource through the renderer's existing lifecycle rules.

### Acceptance Criteria

- The outline follows animated parts frame for frame and does not use any host coarse geometry as
  visible geometry.
- A dimensionally planar entity with a live emitter uses one spherical silhouette derived from the
  current rigid-pose AABB already used by nameplate anchoring; its flat rigid carrier is not outlined.
  A planar entity without a live emitter and every volumetric entity use only normal current-pose
  rigid geometry. Entity class does not participate.
- Exact click refinement uses the identical sphere center, radius, and current visual-root placement
  when the sphere policy applies, so click volume and selected outline cannot disagree.
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

- [x] Add lazy mask target lifecycle
- [x] Add current-pose mask geometry pass
- [x] Feed the optional mask through the existing final presenter and both renderer schedules
- [x] Add resource/work diagnostics
- [x] Prove flat, portal, through-wall, animation, resize, and teardown fixtures

### Progress and Decisions

- 2026-09-03: `GamePresentationRuntime` resolves the cold selected GUID to its current realized root
  immediately before each render. `WebGL2Renderer` synchronously expands that node's current
  material-independent dynamic contributions, so the pass shares the ordinary animation,
  attachment, suppression, geometry-handle, and instance-transform producers without retaining a
  second scene graph or selection identity. The 2026-09-04 sphere-proxy cutover reuses that same
  frame's rigid bounds and placement for planar particle carriers.
- 2026-09-03: Added a material-free R8 mask pass. It allocates its full-drawing-buffer texture,
  framebuffer, shader, and instance buffer only after selected geometry exists; same-size frames reuse
  the target, resize replaces it transactionally, and renderer teardown releases the pass. Targets
  without eligible selection geometry submit no work, while selection can survive temporary
  presentation unrealization.
- 2026-09-03: Both flat and portal schedules generate the mask before the existing
  `WebGL2FlatScenePresentation` call. The presenter applies the same portal-transition sampling
  coordinates to scene and mask, derives a two-output-pixel outer edge, and remains the sole
  default-framebuffer writer. The selected interior, normal scene depth, materials, transparency,
  shadows, and portal routing remain unchanged.
- 2026-09-03: Renderer and Client debug diagnostics now expose mask bytes, allocation/disposal
  generations, submitted parts/triangles, mask/composite draws, and the no-target or hidden/empty skip
  reason as one composite selection-rendering fact.
- 2026-09-03: The production browser fixture passed on deterministic SwiftShader and an AMD Radeon RX
  7900 XT Vulkan adapter. Both reported a depth-independent mask value of 255 under an inherited
  `NEVER` depth function, preserved the selected interior, produced flat and portal-warp outlines,
  followed a changed current instance transform, reused the 64x64 target, replaced it at 32x32, and
  balanced two target allocations with two disposals without WebGL errors or an incomplete
  framebuffer.
- 2026-09-03: A live Client-mode run at 71.7N, 61.1W exercised the production GUID-to-node-to-mask
  path: one retained 1,301,223-byte target, three mask draws over three current parts and 188
  triangles, one final composite, and no console or WebGL errors. Seventy-seven acquisition rays
  scanned 106 retained entities each; p95 work was 49 envelope tests and 12 browser candidates, with
  1.5 ms p95 end-to-end latency and no missing, unavailable, or pending envelopes.
- 2026-09-03: Context restoration remains intentionally unsupported by the existing renderer; a lost
  context reports `restart-required`. Selection resources therefore follow the established full
  renderer destruction/recreation lifecycle instead of introducing a selection-only restoration
  path.
- 2026-09-04: Visual verification rejected the first particle-mask implementation: it reused the
  lifetime culling envelope, whose deliberately worst-case travel, hook displacement, and maximum
  scale made the visible selection volume much larger than the current effect. The implementation
  cleanly cut over rather than retaining an envelope mode.
- 2026-09-04: Visual and frame-rate verification rejected the per-particle mask cutover as well: a
  portal's many live particles unioned into an oversized mask and added one instanced carrier per
  particle. Code tracing established that the reasonable portal quad and nameplate anchor come from
  the entity's current rigid presentation geometry, not a particle-system visibility bound.
  The interim portal-class special case was useful visual evidence but did not generalize to the same
  degenerate carrier pattern on other entity classes.
- 2026-09-04: The clean cutover makes single-carrier shape morphology an immutable
  resolved-appearance template fact, then lets `GamePresentationRuntime` combine it on demand with
  `ParticleSystem`'s already-maintained
  O(1) emitter-owner aggregate. A planar carrier with a live emitter gets one sphere proxy; all other
  entities retain exact posed triangles. Both click refinement and x-ray rendering consume that same
  runtime policy and the same longest-edge-diameter sphere derivation. No per-frame geometry scan,
  emitter enumeration, particle record, particle position, particle shader, particle texture upload,
  lifetime culling envelope, or entity-class allowlist participates. The selected target pays one
  aggregate lookup per rendered frame; hover/click pays it only when refining a realized host
  candidate.

## Phase 7: Add the Off-Screen Marker

Status: **Complete.**

Keep the target locatable after it leaves the view.

### Deliverables

- Add pure primary-view projection/classification helpers for the selected node's current rigid
  presentation bounds resolved through `SceneGraph`, including attached ancestors. Exclude particle,
  nameplate, effect, and unit selection-envelope bounds.
- Add an app-local `ClientTargetIndicator.svelte` SVG/DOM overlay whose element transforms and
  visibility are updated imperatively from the presentation session.
- Render a rotated arrow on the nearest point of a safe inset rectangle for off-screen or
  behind-camera targets.
- Add named tuning for silhouette color/width and arrow safe inset, size, fill, outline, and glow;
  add motion smoothing only if measurement proves it necessary.
- Add accessible semantics without making a rapidly moving decoration keyboard-focusable. Any
  selected-target label should update only on GUID changes.

### Acceptance Criteria

- Every on-screen target uses only the silhouette, independent of projected footprint.
- Targets beyond each edge and corner produce the nearest stable edge position and correct direction.
- A behind-camera target does not mirror unpredictably across the screen center.
- An attached target uses its resolved child bound rather than its parent's bound or host root pose.
- Marker positions use the exact last-presented primary view and current target bound, with no
  one-frame reactive lag.
- Safe insets keep markers clear of viewport clipping at supported sizes and device-pixel ratios.
- Unrealized/removed targets do not leave a stale arrow.

### Task Checklist

- [x] Add pure projection and edge-clamping policy
- [x] Add the imperative target indicator overlay
- [x] Add named visual/geometry tuning
- [x] Add cardinal, corner, behind-camera, on-screen suppression, glow, and lifecycle tests
- [x] Capture a representative off-screen browser fixture

### Progress and Decisions

- 2026-09-03: Added a pure Client-owned projection policy that joins the current rigid presentation
  bound and flattened `ResolvedScenePlacement` with the exact primary camera/extent last presented.
  The projection is expressed in canvas-local CSS pixels; render scale and device-pixel ratio do not
  change marker placement.
- 2026-09-03: Every bound intersecting the frustum now uses only the silhouette. Fully off-screen and
  behind-camera targets use the homogeneous target-center direction and the nearest point on an
  26-pixel safe-inset rectangle; straight behind resolves deterministically downward instead of
  dividing through negative W and mirroring.
- 2026-09-03: `ClientTargetIndicator.svelte` owns only app-local SVG/DOM presentation. It pulls the
  already-classified frame imperatively on `requestAnimationFrame`, is pointer-transparent and not
  keyboard-focusable, and keeps its accessible selected-GUID announcement on the cold Svelte path.
  The arrow has a tunable CSS drop-shadow glow. No smoothing clock was added because no measured
  jitter justified one.
- 2026-09-03: Runtime coverage proves a selected attached child exports its own current rigid bound
  with the flattened animated parent/holding-location placement. Session coverage proves the current
  selected frame is joined to the last-presented primary view and disappears immediately on
  unrealization. Pure tests cover on-screen suppression, cardinal and diagonal edges, behind-camera stability,
  attachment placement, and undersized viewports.
- 2026-09-03: The production Client HUD Chromium harness passed click/minimap behavior together with
  imperative off-screen placement, on-screen suppression, glow application, cleared-target cleanup,
  accessible GUID updates, and representative off-screen screenshot capture.
- 2026-09-03: Post-completion UX cleanup removed the small-footprint classification and marker branch
  rather than leaving a disabled threshold. The WebGL silhouette's formerly hard-coded gold and
  two-pixel dilation became validated frame tuning; its width remains stable in CSS pixels across
  render scales. Arrow size, colors, outline, safe inset, and glow remain app-local Client tuning.
- 2026-09-03: The off-screen marker was restyled as a minimal solid amber-glass wedge with one
  translucent facet, a pale-gold specular edge, and an outer glow. Existing size, safe inset, outline
  width, and glow radius tuning were preserved. Fill, outline, and glow colors carry tunable alpha;
  the component adds no hidden opacity to the primary fill. The browser harness now verifies the
  projected marker center instead of coupling placement evidence to a particular tuned size.
- 2026-09-03: The production WebGL fixture passed with a non-default green three-pixel outline,
  proving the compositor consumes the tuning contract rather than shader constants. The Chromium
  Client HUD harness passed with the off-screen arrow's computed drop-shadow, edge placement,
  selected-GUID announcement, and cleanup all intact.
- 2026-09-03: Post-completion selection lifetime was tightened to the active interaction space. The
  existing 15 Hz Client-world cadence now asks presentation for a typed tracked, frontend-evicted, or
  temporarily-unrealized fact. The app-local selection owner clears on explicit residency eviction or
  when the nearest point of the current transformed rigid axis-aligned bound is more than one
  landblock from the last presented camera. That bound is intentionally conservative for long,
  heavily rotated entities; the 15 Hz policy check does not earn a tighter oriented-bound path
  without evidence of bad behavior in real content. Attached targets inherit the residency state of
  their world root. Clearing invalidates older asynchronous click and hover samples, so neither can
  resurrect the invalid identity. Recoverable asset/realization gaps remain non-terminal.

## Resteer B: Add Live-ish Hover Acquisition

Status: **Complete.**

Close the late-discovered UX gap where a viewport click has no advance indication that its entity is
selectable. Reuse the completed acquisition pipeline at a bounded cadence instead of introducing a
second picking implementation.

### Decisions and Concessions

- 2026-09-03: Retail ground truth confirms that mouse-over repeatedly requests render-backed object
  finding and updates cursor state from the result, while mouse-down performs a distinct accurate
  pick. Pre-click feedback is therefore part of the interaction loop, not optional target decoration.
- 2026-09-03: Hover deliberately means “newest completed sample,” not “the entity under this exact
  rendered frame.” At 15 Hz, modest positional and scene staleness is accepted. Correct response
  ordering is mandatory; frame generation tracking, scene-change notifications, result expiry, and
  pointer-motion invalidation are rejected as machinery that would erase the stated concession.
- 2026-09-03: The existing populated outdoor measurements justify reuse: 0.751 ms host p95 and 0.2 ms
  browser-refinement p95 imply roughly 11.3 ms of host work and 3 ms of browser exact work per second
  at 15 Hz in that scene. One in-flight hover query supplies backpressure if a future scene is slower.
- 2026-09-03: Hover and click share transport, portal/static discovery, current-pose refinement, and
  the monotonically allocated query sequence, but not mutation. A hover response can update only the
  ephemeral hovered GUID. A click always issues a fresh query and remains the only viewport operation
  that can change selection.
- 2026-09-03: `ClientEntitySelection` now has exactly two explicit pending lanes sharing one sequence
  allocator. Hover applies backpressure by refusing another sample while its lane is occupied; result
  routing reaches only the lane whose sequence matches. Hover unavailable/failure clears only hover,
  while click/minimap invalidation and selection-preservation rules remain unchanged.
- 2026-09-03: `ClientWorldView` samples its latest canvas pointer every `1_000 / 15` ms while the
  pointer is over the canvas. The newest exact hover GUID drives a `pointer` cursor; the existing
  active gesture rule still resolves to `grabbing`. Pointer exit merely stops sampling because the
  cursor is no longer over the canvas; it sends no scene invalidation to the picker.
- 2026-09-03: The Chromium Client HUD fixture observed repeated stationary samples, hit-to-pointer
  and miss-to-grab transitions, drag cursor precedence, no selection mutation, and stopped sampling
  after canvas exit. Controller tests cover one-request backpressure, interleaved hover/click response
  routing, stale-response rejection, unavailable isolation, and authoritative hover removal.
- 2026-09-03: Repeated live populated outdoor runs completed seven to eight hover queries in 501.6
  ms. Query starts were 52.7–73 ms apart under Chromium timer coalescing (15.25–15.52 Hz over the
  short measured spans), while one-in-flight backpressure remained intact. Every sample returned the
  same exact GUID as the independently driven direct pick; the canvas reported `pointer`, total
  latency was 0.5–7.5 ms, exact refinement was at most 0.1 ms, and no page, host, or WebGL error
  occurred. This validates the nominal 15 Hz policy rather than promising exact wall-clock timer
  precision browsers do not offer.
- 2026-09-03: Cleanup found that naively appending debug hover measurements would grow at 15 records
  per second for the lifetime of every debug Client session. The debug-only seam now records only
  inside an explicit probe-owned start/take window; normal and idle debug sessions retain no hover
  history. Runtime hover itself remains one pending record and one GUID.

### Deliverables

- Extend the app-local entity-selection controller with one independent pending hover lane, hovered
  GUID publication, and sequence-based result routing. Preserve the existing click/minimap
  invalidation contract unchanged.
- Sample the latest pointer position from `ClientWorldView.svelte` at `1_000 / 15` ms only while the
  pointer is over the game canvas. Do not enqueue while a hover request is in flight.
- Apply the selectable cursor only to the game canvas when the newest completed hover sample has an
  exact GUID. Existing active-drag cursor precedence remains intact.
- Clear an exact hover on an available empty result, failed/unavailable sampling, or authoritative
  entity removal. Do not add explicit invalidation notifications for ordinary camera, pose, spatial,
  portal, or world-scene changes; the next sample observes them.
- Extend controller and Client HUD browser coverage for hover hit/miss, out-of-order hover/click
  isolation, backpressure, stationary resampling, canvas exit, drag cursor precedence, and teardown.
- Re-run the live outdoor probe at hover cadence and record query rate, latency, errors, and cursor
  convergence before returning to Phase 8 closure.

### Acceptance Criteria

- A selectable exact viewport hit changes the canvas cursor without selecting the entity.
- An exact miss restores the ordinary canvas cursor, and click/minimap selection remains unchanged.
- At most one hover request is outstanding, and the browser sampler is configured at `1_000 / 15` ms;
  ordinary browser timer coalescing need not produce an exact measured 15.000 Hz.
- A late hover result cannot overwrite a newer hover observation or mutate selected identity; a late
  click result cannot match a replaced or cleared pending click.
- Holding the pointer stationary still resamples moving entities and camera/world changes.
- Hover adds no host protocol shape, portal traversal path, selection-envelope state, render-geometry
  cache, GPU picking pass, scene revision, or entity-generation tracking.

### Task Checklist

- [x] Add independent ordered hover acquisition to the selection controller
- [x] Add 15 Hz canvas pointer sampling and cursor policy
- [x] Add focused unit and Client HUD browser coverage
- [x] Measure the live hover loop and update Phase 8 evidence

## Phase 8: Integrated Verification and Cleanup

Status: **Complete. The automated synthetic/runtime matrix, populated outdoor direct/hover/minimap
probe, animated and attached exact-pick probes, comparative frame profiling, and manual live
static-obstruction, through-wall silhouette, and EnvCell portal checks pass.**

### Progress, Decisions, Concessions, and Debt

- 2026-09-03: A final eligibility audit found an implementation omission rather than a plan gap.
  The pure world query admitted `UiHidden` roots and setup-less attachments even though both lack a
  selectable presented object. The query now applies `UiHidden` and Setup-DID eligibility before
  either root-envelope or inherited-attachment handling. Focused tests cover hidden roots, hidden
  attachments, and setup-less attachments without adding presentation geometry to world.
- 2026-09-03: The full Rust test and clippy matrix passes. One protocol fixture expectation had
  accidentally replaced its captured 32-bit object-default cue with a synthetic test value; ACE and
  the fixture bytes confirm the decoder must preserve the raw `0x0F000001` cue losslessly. The stale
  expectation was corrected; no runtime behavior changed.
- 2026-09-03: A populated outdoor Client-mode grid at 71.7N, 61.1W completed 77 production viewport
  queries against 106 retained entities and produced 12 exact hits. Host p95 work was 53 membership
  matches, 48 sphere tests, 12 returned candidates, and 750.734 microseconds. Browser exact
  refinement was 0.2 ms p95 and complete click latency was 9.2 ms p95. Every queried profile was
  prepared; no pending, unavailable, or missing envelope was skipped.
- 2026-09-03: The live probe now dispatches actual pointer events over the rendered minimap canvas,
  waits for the browser event turn, and requires one selected GUID to intersect the set independently
  acquired through production viewport queries. It selected `0x800009ED`; the page-owned selection
  text and controller state agreed. A too-early first implementation produced a false green before
  the click event ran, so visible UI state remains an independent assertion rather than trusting only
  the debug seam.
- 2026-09-03: That selected live entity exercised the production GUID-to-current-node mask path:
  17 selected parts, 1,165 triangles, 17 mask draws, one composite draw, 1,301,223 live target bytes,
  one allocation generation, and no skip reason, console exception, WebGL error, or resource churn.
- 2026-09-03: The reusable spawned-entity browser probe now derives a short ray through current
  posed drawing geometry and runs the production exact refiner before inspecting the selection mask.
  WCID 7 passed in two distinct authored-animation poses under both SwiftShader and an AMD Radeon RX
  7900 XT: each pose selected the root GUID exactly, the 17-part/550-triangle transform checksum
  changed over 150 ms, and the matching 17-part mask remained active without reallocation.
- 2026-09-03: ACE world data identified WCID 24578 with wielded child WCID 311 as an authored
  attachment fixture. The root and child each won exact current-geometry refinement under their own
  GUID. The attached crossbow resolved through the animated left-hand hierarchy and produced seven
  normal-visible exact parts/84 triangles. The Explorer-only hidden-geometry debug toggle deliberately
  increased its silhouette to nine parts/86 triangles; Client mode has no such discrepancy.
- 2026-09-03: The spawned motion probe exposed a stale frontend possession-probe decoder that still
  expected `clip` after the host contract had moved to canonical `motion`. The decoder and harness now
  import and consume the shared dynamic-motion schema. This was unrelated latent harness debt, but
  leaving it would have made the animation evidence dishonest.
- 2026-09-03: Same-scene 1280x720 hardware-GPU profiles measured selection absent versus an attached
  target selected on-screen. Mean renderer CPU time moved from 0.389 ms to 0.431 ms (+0.042 ms), GPU
  time from 0.200 ms to 0.209 ms (+0.009 ms), and the R8 mask added exactly 921,600 bytes with one
  allocation generation. With the camera turned away, the target still produced nine mask draws and
  one composite while ordinary dynamic submission culled it; mean renderer CPU/GPU times were
  0.212/0.156 ms because the ordinary scene workload was smaller. These are independent process
  windows, so they establish order of magnitude rather than a paired microbenchmark.
- 2026-09-03: Before the manual checks below, the remaining live debt was an actual EnvCell/open-portal
  query, selection followed by wall occlusion, and a portal-space transition. Synthetic world, WebGL,
  HUD, lifecycle, and spawned-runtime fixtures cover those component contracts, but do not substitute
  for integrated placement evidence where the plan calls for it.
- 2026-09-03: The pre-hover frontend matrix passed 1,945 Vitest tests across 258 files, strict Svelte and
  TypeScript checks, ESLint, dead-export analysis, Prettier, and host clippy. The complete Rust tests
  and workspace formatting check also pass. The Client HUD browser harness reconfirmed click/drag
  arbitration, direct/minimap identity, overlap policy, off-screen indicators, and selection
  lifecycle with no page console error.
- 2026-09-03: After Resteer B, the complete frontend matrix passes 1,949 tests across the same 258
  files, strict Svelte and TypeScript checks, ESLint, dead-export analysis, Prettier, and host clippy.
  The production live hover/direct/minimap run also passes with separate diagnostics streams, so the
  15 Hz feedback loop does not contaminate click profiling or selection mutation.
- 2026-09-03: Manual live Client-mode checks deliberately split the remaining environment matrix
  instead of constructing one fragile all-in-one scene. A moving mob chased the player around static
  geometry, and that collision geometry correctly prevented acquisition through the obstruction. In
  a separate EnvCell doorway check, a player standing outside the open door was selectable while in
  the portal view and was not selectable after leaving that view. This supplies live moving-target,
  static-clipping, open-portal, and portal-visibility evidence. The selected mob's silhouette remained
  visible after static geometry occluded it, closing the live persistent-tracking check independently
  of the blocked-acquisition check.
- 2026-09-03: Concession: the live wall/portal evidence is a user-observed manual smoke check rather
  than one fragile all-in-one automated scene or retained screenshot. The real-browser selection
  fixture independently proves the depth-disabled mask pixel, outline composition, current-transform
  following, portal-warp composition, and resource lifecycle; the manual session proves that those
  pieces converge in ordinary Client play. Building deterministic multiplayer AI choreography solely
  for a screenshot would add harness machinery without increasing confidence in the shipped path.

Prove the complete interaction in synthetic and live Client-mode scenes, then remove scaffolding.

### Deliverables

- Extend browser fixtures for animated limb clicks, attached-equipment clicks, overlapping entities,
  a broad-population miss, a target behind collision, a target visible through an open portal, a
  selected target hidden by a wall after selection, minimap overlap, every off-screen
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

- [x] Complete synthetic browser matrix
- [x] Complete live outdoor/EnvCell/animation/minimap proof
- [x] Confirm an already-selected live target's silhouette through a wall
- [x] Record no-selection and selected CPU/GPU/resource costs
- [x] Run all repository quality gates
- [x] Remove temporary probes and sweep vocabulary/comments/docs

### Post-Implementation Intentionality Audit

Status: **Complete.** This is a subtraction-first review of the complete feature diff after the
implementation's several course corrections. A passing test is not sufficient evidence that an
added field, type, metric, cache, lifecycle, or harness path deserves to survive.

- [x] Trace host/shared ownership end to end; remove state or adapters left by rejected selection-index
  and mirrored-presentation approaches.
- [x] Trace browser acquisition, refinement, and target rendering end to end; collapse duplicate
  derived facts and remove superseded portal/particle special cases.
- [x] Audit every feature-added field, metric, error branch, and exported symbol for a named production
  consumer and a reachable scenario.
- [x] Separate durable regression/harness coverage from one-off census and live-probe scaffolding;
  remove diagnostics that no longer answer a recurring question.
- [x] Sweep final vocabulary, comments, tests, and this plan for rejected architecture.
- [x] Re-run focused and repository-wide quality gates, then record retained tradeoffs and any
  remaining deliberate debt here.

Audit changes, 2026-09-04:

- Removed selection-query/refinement timing and counter fields, debug callbacks, browser globals, and
  the one-off live UI measurement mode after preserving the measured gate decision above.
- Collapsed world envelope readiness from a parallel per-GUID registry/status taxonomy into one
  optional envelope on the authoritative entity. Core alone retains preparation/cache state.
- Removed host scale counters and provenance fields that had no production consumer. The two scale
  evaluators remain because they own different consequences: world applies direct `Scale`, while the
  browser plays presentation hooks and consumes `Scale` as world-owned.
- Removed the two one-off PhysicsScript census binaries. The pre-existing selection-envelope census
  remains because it is a reusable archive-distribution and algorithm-cost check.
- Reused the existing instanced selection-mask shader/program for sphere proxies instead of retaining
  a second sphere-only program, and retained one cached morphology decision shared by picking and
  outlining. Portal/type special cases and per-particle proxy geometry are absent.
- Reduced the selection owner to the actual production failure seam and pending query identities;
  removed a test-only unavailable-event taxonomy and redundant action revision.
- Removed dynamic-cue queue/asset counters that were only test observability. Focused tests now wait
  on the actual source request or visible subsystem consequence.
- Final gates passed: 1,966 frontend tests, the combined Rust package suites, the six retained
  selection-envelope census tests, TypeScript/Svelte checks, ESLint/Knip/clippy, Rust and frontend
  format checks, the default browser harness, an animated spawned-entity selection run, and the
  real-GPU entity-selection fixture including the sphere proxy and resource teardown.

Retained deliberate seams:

- Core and browser both evaluate PhysicsScripts because their consequences differ; sharing one
  evaluator would either move presentation into the host or leave world collision scale stale.
- The host broad phase reuses ordinary residency and accepts the documented portal-boundary miss;
  measured scan cost does not justify a second visual spatial index.
- The browser retains CPU geometry and one template morphology fact because current animated and
  attached transforms are presentation-owned. The same sphere-proxy decision feeds exact picking and
  the selection mask, so it is derived once rather than reconstructed by consumers.

#### Second-Pass PR Review

Status: **Complete.** Review the already-cleaned result as one proposed change, without reopening
settled product design or adding speculative abstractions.

- [x] Audit public contracts and newly retained fields from producer to named consumer.
- [x] Audit lifecycle transitions for duplicated invalidation, cleanup, and generation machinery.
- [x] Audit test and harness additions for oversized fixtures or assertions preserving implementation
  details instead of behavior.
- [x] Audit dynamic-scale changes for work that selection does not require and for accidental coupling
  between the two evaluators.
- [x] Apply deletion/unification opportunities, rerun affected gates, and record the final disposition.

Second-pass changes, 2026-09-04:

- Removed `DynamicBodyScaleOutcome` and the unused physical-configuration scale getter. Scaling now
  returns `Result<()>`; collision-report cleanup remains owned inside the collision scene instead of
  leaking a result that only a test inspected.
- Stopped re-exporting the two asynchronous preparation coordinators and their fact extractors from
  `holtburger-core`. The coordinators and extractors are runtime implementation, while the content
  source traits and prepared inputs remain public because the builder's dependency-injection seam
  consumes them.
- Made selection-residency intersection and unit-body scaling helpers crate-private. Both are world
  implementation details with no external caller.
- Made `FrameInput.selectionTarget` required-and-nullable, removing an implicit fallback on the
  renderer's own contract. Removed scene-node identity from the bounds-only selected frame and
  collapsed separate frame/state reads into one discriminated presentation-state read.
- Made unavailable query results honest sum types. `missingCollisionOwner` now exists only for the
  `missing-collision-owner` reason, and both Rust serialization and browser decoding reject impossible
  reason/detail combinations.
- Narrowed entity invalidation to the removed or evicted GUID. It no longer cancels unrelated pending
  click and hover queries; query sequence correlation and current-pose refinement remain the only
  stale-result machinery.
- Removed a test-only world envelope getter and changed the camera gesture port's ignored `unknown`
  return to `void`. Tests now assert observable shape/state rather than private node identity.
- Retained the browser and runtime fixtures after tracing their scenarios: they separately cover cue
  ordering/readiness, evaluator separation, current animation, attachment placement, GPU mask shape,
  resource teardown, HUD arbitration, and minimap/indicator behavior. No fixture exists solely to
  preserve a deleted implementation seam.
- Reconfirmed the evaluator boundary: core reads only direct `Scale` records into world/collision
  state; the browser owns presentation hooks and suppresses scale application there. No clock,
  checkpoint, or cross-evaluator callback couples them.

Second-pass gates passed: 1,966 frontend tests; all selected Rust package and doc-test suites; the six
selection-envelope census tests; TypeScript/Svelte checks; ESLint, Knip, clippy, and both format
checks; the SwiftShader entity-selection GPU fixture; and a simulated animated WCID 35580 spawned-
selection probe whose exact hit and two-part/368-triangle mask followed the changing posed transform.
The first-pass real-AMD fixture remains the hardware proof because this pass changed contracts and
lifecycle only, not shader or framebuffer behavior.

#### Final Code-Quality Pass

Status: **Complete.** The complete proposed diff was reviewed for correctness and maintainability at
the actual lifecycle and performance boundaries before staging.

- [x] Remove output-shaping cache identity with no consumer and validate supplied content identity.
- [x] Repair envelope and scale demand invalidation so discarded async work cannot block rebuilding.
- [x] Replace dense whole-world scale-ramp scans with coordinator-owned sparse activity.
- [x] Collapse duplicated pending-cue and viewport-query bookkeeping.
- [x] Run the complete Rust, frontend, and renderer verification matrix.
- [x] Inspect the staged diff and commit only repository-owned changes.

Pass findings, 2026-09-04:

- Selection-envelope clip identity no longer carries an unused playback-direction bit, and the
  calculator now rejects a setup or motion table that does not exactly match the cache profile.
- Losing profile prerequisites now retires the corresponding async envelope demand. Restoring the
  same appearance can therefore start fresh work instead of matching a discarded completion.
- Dynamic-scale invalidation now retires generation preparation, cue preparation, controller state,
  and active-ramp membership through one exact path.
- Scale ramps are sampled from the coordinator's sparse active set rather than by scanning every
  retained entity on each tick. The reusable smell was recorded in
  `docs/code-quality-audit-patterns.md`.
- Host scale duration handling now matches retail and the browser: finite durations below the retail
  threshold, including negative values, apply immediately.
- Pending dynamic cue filtering and identical click/hover pending shapes now each have one
  implementation. Duplicate adjacent runtime comments were collapsed.

Final-pass gates passed: 1,966 frontend tests; all selected Rust package and doc-test suites; seven
selection-envelope census/unit tests; TypeScript/Svelte checks; ESLint, Knip, clippy, and both format
checks; and the SwiftShader entity-selection fixture including transform following, depth-independent
masking, sphere-proxy work, portal-warp compositing, target reuse/resize, and resource teardown.

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

Focused fixtures must cover PhysicsScript cue/table resolution, direct-scale extraction from roots
that also contain presentation hooks, absolute scale and ramps, collision/residency/projection scale
consistency, eligibility independent of
collision participation, ordinary membership reuse, pure-query non-mutation, inherited attachment
scope, portal traversal, the accepted boundary miss, static clipping, all-candidate behavior,
per-entity preparation omission, query coverage failure, deterministic ordering, and command/event
projection.

### Frontend

Run from `apps/holtburger-3d` through package scripts:

- `npm run test:ts`
- `npm run check`
- `npm run lint`
- `npm run format:check`

Focused tests must cover independent browser presentation activation for setup-direct/default/live
roots, dynamic PhysicsScript scale suppression, unchanged static/sky/animation scale, exact ray
geometry, current animated transforms, static-limit rejection, stale request invalidation, selection
lifetime, viewport click/drag arbitration, minimap overlap and pan arbitration, target projection,
edge clamping, mask resource lifecycle, and diagnostics.

### Browser and Live Runtime

- Extend `npm run harness:browser` fixtures and run both SwiftShader and a real GPU.
- Exercise both flat and portal renderer schedules with profiler collection disabled and enabled.
- Use `npm run probe:client:ui` or a narrowly extended live-client probe for real ACE world state; do
  not run the interactive TUI client.
- Capture screenshots for off-screen target and through-wall silhouette,
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

World scale must change before collision, residency, and selection can consume it, while browser
presentation scripts must wait for asynchronous visual and particle assets. Treating those as one
cross-process clock created an unbounded transient-recovery problem and was rejected. Phase 1 instead
uses parallel evaluators with disjoint outputs: core schedules only direct `Scale`; browser schedules
presentation hooks and ignores dynamic PhysicsScript scale. The 4,248-script census proves no shipped
scale is reachable only through `CallPES`, so the host does not reproduce presentation control flow.
Composition-level dispatch separation and diagnostics make overlap a failure rather than a silent
double application. The remaining presentation-versus-world activation latency is marked as a retail
divergence. Selection does not consume current scale until Resteer S proves the split.

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

Viewport queries are asynchronous while minimap selection is immediate. A minimap selection or clear
invalidates the pending click directly; independently ordered hover work remains harmless. Entity
removal and maintenance clear only the invalid identity, because current-pose refinement already
rejects candidates that are no longer realized. No scene revision or invalidation graph is retained.

### Pointer Gestures Can Regress Camera or Minimap Control

Selection happens only on release below the named app-local three-pixel threshold. Pointer capture,
lost-capture/cancel tests, and the existing HUD harness prove orbit, pan, precise jump, and selection
as mutually exclusive outcomes.

## Definition of Done

- Phase 0 evidence supports the selected envelope policy and is recorded in this document.
- Dynamic whole-object scale has one host-owned direct-record evaluator and one world-owned current
  value used consistently by collision, ordinary residency, projection, rendering, and selection
  placement. Browser presentation evaluation cannot mutate that scale.
- The native world path performs portal-aware, static-clipped all-candidate discovery from one proven
  conservative unit-scale scalar per eligible world entity. Its query is immutable, consumes ordinary
  residency, includes attached entities through inherited scope, keeps overlapping disconnected
  EnvCells distinct, explicitly documents the accepted portal-boundary miss, and retains no drawing
  geometry or presentation animation state.
- The browser refines every candidate against the current animated drawing geometry and selects the
  nearest exact GUID without traversing portals.
- Viewport and minimap input converge on one GUID-only app-local selection owner with correct async,
  empty, unavailable, unrealized, and removal semantics.
- A nominal 15 Hz, one-in-flight viewport hover loop reuses the complete pick path, changes only the
  canvas cursor, and preserves sequence ordering without scene-invalidation or freshness machinery.
- The same 15 Hz Client-world cadence clears selection after frontend residency eviction or movement
  beyond the one-landblock camera-to-current-bound leash, while preserving recoverable realization
  gaps and stale-response ordering.
- A current-pose depth-independent silhouette outline remains visible through walls. A planar rigid
  carrier with a live emitter uses one rigid-bounds-derived sphere; all other entities ignore
  particles and use rigid geometry.
- Off-screen targets receive a stable, glowing, correctly directed screen-space marker; on-screen
  targets use only the silhouette.
- Flat, portal, SwiftShader, real-GPU, and live ACE evidence passes with bounded latency and no resource
  leaks or diagnostics.
- Rust tests/clippy/format and frontend tests/check/lint/format all pass.
- No temporary instrumentation, guessed padding, stale vocabulary, or undocumented retail divergence
  remains.

## Remaining Measurement Questions

1. How often does regular residency omit a target whose animated drawing geometry crosses a portal or
   outdoor boundary, and is that accepted miss observable enough to justify more membership machinery?
2. What are the median, p95, and worst pure-query scan times, membership matches, sphere tests, and
   candidate populations for outdoor and portal-heavy live Client interest?
3. How many inherited-scope attached candidates occur in equipment-heavy outdoor populations, and do
   they justify an authored maximum attachment-reach bound?
4. What are the corresponding browser current-part and triangle counts, and does current-part sphere
   pruning suffice before any browser-local acceleration structure is deserved?
5. Which visible/collision surface disagreements are observable in representative outdoor and
   EnvCell scenes? The first cut's collision-backed acquisition rule is settled, but this sizes its
   known presentation mismatch.

These are Resteer A optimization and compatibility measurements. None reopens portal traversal in
the browser or presentation animation in the host.
