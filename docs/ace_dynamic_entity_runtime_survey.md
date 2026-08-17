# ACE Dynamic Entity Runtime Survey

This document records the Phase R0 evidence and scope decisions for
`holtburger-3d-explorer-weenie-dynamic-runtime-plan.md`. The machine-readable census is produced by
`survey-weenie-catalog` from a generated `.hwc` plus normal mounted HBA content. No SQL connection is
used after export.

## Provenance and Reproduction

- ACE World base: `v0.8.8`
- ACE World patch: `v0.9.294`
- ACE World `version.last_Modified`: `2026-06-20 18:22:29`
- Catalog records: 43,913
- Canonical local artifact: `dats/weenies.hwc` (5,560,993 bytes)
- SHA-256: `a18482447dd77c70c0c7fb6088be72cbd2d85fbc1fad045b3049de2731817f5d`
- Command:
  `cargo run -p holtburger-tools --bin survey-weenie-catalog`

The generated catalog and JSON result are local survey artifacts, not checked-in runtime assets.

## Catalog and Content Census

The encoded record payload is 4,858,241 bytes. Record size is 65 bytes minimum, 109 bytes median,
142 bytes p95, 159 bytes p99, and 476 bytes maximum. This validates the existing fixed sorted index
and one positioned record read. Memory mapping, compression, streaming export, SQLite, and a second
index have no measured consumer.

All 3,909 distinct referenced setups and all referenced GfxObjs decode through the normal content
repository. Setup geometry ranges are:

| Fact | Population or range |
| --- | ---: |
| Setup parts | 1-54 |
| Ordinary spheres | 0-5 per setup; 3,585 total; radius 0.05-15 m |
| Cylspheres | 0-7 per setup; 501 total; radius 0.05-6.714 m; height 0.01-64 m |
| Setups containing physics BSP | 190 |
| Setups with a default animation | 70 |
| Setups with a default physics script | 1,538 |
| Physics-BSP setups with a default animation | 1 |
| Physics-BSP setups with a default script | 23 |

### Physics-BSP Default Behavior

The machine-readable survey now expands every catalog-reachable physics-BSP setup with default
behavior into its exact templates, physics-BSP part indexes, decoded animation, and transitive
`CallPES` script closure. There are 23 distinct setups and 52 templates; one setup appears in both
the animation and script counts above.

Retail caches the `HasPhysicsBSP` branch from setup parts during `InitPartArrayObject`, before
`DoObjDescChanges` applies animation-part substitutions, and does not recache afterward
(`acclient.c` `CPhysicsObj::InitPartArrayObject`, `CPhysicsObj::DoObjDescChanges`). The survey now
applies every catalog animation-part substitution and checks both the base and replacement GfxObj.
No template replaces a BSP-bearing part with another part, removes a BSP, or adds a BSP to a setup
whose cached branch lacks one. The 1,254-template branch count and the crystal moving-part census are
therefore unchanged. Prepared geometry must still apply substitutions before selecting actual parts;
the measured zero means this is an enforced ordering rule, not permission to ignore appearance.

| Setup | Default script | Affected WCIDs |
| --- | --- | --- |
| `0x020003CB` | `0x33000010` | 7472, 7800, 29800 |
| `0x02000840` | `0x3300089B` | 7786 |
| `0x02000A02` | `0x33000A90` | 9197, 35842, 36775, 87356, 87357 |
| `0x02000BC8` | `0x33000BFD` | 246 |
| `0x02000BDE` | `0x33000C06` | 14467, 22615 |
| `0x02000C07` | `0x33000C18` | 14564, 14803, 51401, 51415, 51416 |
| `0x02000C08` | `0x33000C1C` | 14597 |
| `0x02000C09` | `0x33000C1A` | 14595, 51284, 51559, 51582 |
| `0x02000C0A` | `0x33000C1F` | 14600 |
| `0x02000C0B` | `0x33000C1E` | 14599, 36602 |
| `0x02000C0C` | `0x33000C1D` | 14598, 51313, 51560, 51629, 51641 |
| `0x02000C0D` | `0x33000C1B` | 14596 |
| `0x02000F8A` | `0x33000DB9` | 24587 |
| `0x0200102F` | `0x33000E08` | 25993 |
| `0x02001338` | `0x33000EE4` | 29103 |
| `0x02001662` | `0x330010EA` | 34400 |
| `0x020016F2` | `0x3300113E` | 36652 |
| `0x020016F3` | `0x3300113F` | 36650, 36653, 36702, 51410, 51422 |
| `0x020016F9` | `0x33001142` | 87385 |
| `0x020017BA` | `0x33001195` | 37056 |
| `0x02001BE0` | `0x33001359` | 51647, 52009, 52094, 52095, 52096 |
| `0x02001BF2` | `0x3300135F` | 52077, 52078, 72157 |
| `0x02001C2B` | `0x3300138A` | 52699 |

Across each setup-owned script closure, the only decoded hook types are 68 `CreateParticle`, six
`SoundTweaked`, and ten `CallPES` occurrences. Shared chained scripts are counted once per owning
setup. There is no `Scale`, `Ethereal`, `SetOmega`, `CreateBlockingParticle`, or other hook that
changes collision truth. The script-only 49-template population can therefore use stable prepared
physics-BSP geometry; its default scripts remain presentation behavior.

Setup `0x02001BF2` additionally names animation `0x03000E19`. It has 120 frames, no root-position
frames or hooks, and varies the local frame of all nine physics-BSP parts. Its three templates are
WCID 52077 Rynthid Assessment Crystal, 52078 Rynthid Assessment Crystal, and 72157 Sparking Crystal.

Retail and ACE keep this collision truth inside the physics object. `CPartArray::Update` advances its
`CSequence`; `CPartArray::UpdateParts` combines the owner frame, current part-animation frame, and
part scale into each `CPhysicsPart::pos`; then `CPhysicsPart::find_obj_collisions` transforms the
query through that exact part pose before consulting the GfxObj physics BSP (`acclient.c`
`CPartArray::Update`, `CPartArray::UpdateParts`, `CPhysicsPart::find_obj_collisions`; ACE
`PartArray.Update`, `PartArray.UpdateParts`, `PhysicsPart.FindObjCollisions`). Scale hooks use the
same owner and update every part scale through `CPhysicsObj::SetScale`/`SetScaleInternal`.

The host has decoded animation assets but no authoritative part-animation clock. The browser clock
is presentation-owned and cannot feed solver truth back to the host. The first runtime therefore
rejects solver-body realization for setup `0x02001BF2`, naming WCID, setup, and moving-BSP reason;
this applies even when the current collision state suppresses the target because that state is
reversible. A deliberately bodyless visual realization may still use the frontend animation. This
keeps one clock and avoids building a host animation/script subsystem for three catalog templates.

Retail's moving query uses a dummy sphere when the setup has no ordinary spheres and clamps an
ordinary-sphere list to its first two entries (`PhysicsObj.transition`, `SpherePath.InitSphere`;
`acclient.c` `CPhysicsObj::transition`, `SPHEREPATH::init_sphere`). The template population is 6,074
dummy-sphere movers, 30,361 one-sphere movers, and 7,478 two-sphere movers.

Target geometry is a different branch. `PhysicsObj.FindObjCollisions` selects physics BSP first,
then all setup cylspheres, then all ordinary spheres. The population is 1,254 physics-BSP, 4,349
cylsphere, 37,497 sphere, and 813 geometry-absent templates. Movement geometry must therefore not be
reused as target geometry.

The appearance census found no overlapping or out-of-bounds palette intervals. Three authored
subpalette intervals have zero length. Eight templates have a non-positive default scale. These are
explicit no-op appearance intervals and rejected physical definitions respectively; neither creates
an implicit fallback.

## Effective Physics State

ACE starts with the optional template `PhysicsState` or `PhysicsGlobals.DefaultState`, applies the
eleven nullable `PropertyBool` overrides used by `CalculatedPhysicsState`, replaces
`HasPhysicsBSP` from setup parts, and derives the two default-behavior bits only for a static object
with the corresponding setup default (`WorldObject_Networking.cs`, `PhysicsObj.cs`). `Static` is not
a `PropertyBool`; property value 1 is `Stuck`. None of the 43,871 present base masks set `Static`.

The following matrix assigns every defined bit a concrete runtime disposition. “Reject if set” means
the semantic mask remains representable, but Explorer creation and client-side simulation do not
silently pretend to implement the bit.

| Bit | Effective templates | Authoritative consumer | First runtime disposition |
| --- | ---: | --- | --- |
| `Static` | 0 | Blocks active integration; target is reported as environment | Preserve; reject local simulation until a reachable producer exists |
| `Unused1` | 0 | No ACE or retail consumer found | Reject if set |
| `Ethereal` | 33,437 | With `IgnoreCollisions`, suppresses target collision; shortens retained report lifetime | Supported |
| `ReportCollisions` | 15,244 | Enables directional collision callbacks | Supported through balanced report lifetimes |
| `IgnoreCollisions` | 35,578 | Directional collision/report filter | Supported |
| `NoDraw` | 6,285 | Hides rendered parts without removing physical state | Presentation projection |
| `Missile` | 104 | Step-down, filtering, reporting profile, and one-shot state clearing | Supported with explicit launch state and collision-filter policy |
| `Pushable` | 0 | No physics consumer found; ACE's property setter incorrectly toggles `Missile` | Reject if set |
| `AlignPath` | 93 | Aligns orientation with velocity | Supported motion consequence |
| `PathClipped` | 103 | Retained projectile marker cleared with missile contact; collision path clipping itself is derived from `Missile` | Supported with missile collision policy |
| `Gravity` | 36,078 | Applies -9.8 m/s² when not on walkable contact | Supported |
| `LightingOn` | 5,012 | Initializes/destroys part lights | Presentation projection |
| `ParticleEmitter` | 0 | Changes part/cell/frame handling for particle roots | Reject as an entity body in the first population |
| `Unused2` | 0 | No ACE or retail consumer found | Reject if set |
| `Hidden` | 0 | Visibility plus specialized collision-report/filter transition | Supported complete-state consequence |
| `ScriptedCollision` | 173 | Authored/server gameplay marker; no independent ACE/retail physics-path consumer was found | Preserve and expose the unsupported gameplay consequence; physical contact uses the other proven bits |
| `HasPhysicsBSP` | 1,254 | Selects BSP target collision and BSP bounds | Supported target geometry |
| `Inelastic` | 710 | Zeros velocity instead of bouncing | Supported response policy |
| `HasDefaultAnim` | 0 | Keeps a static object's default animation updating | Supported only with decoded behavior; otherwise reject |
| `HasDefaultScript` | 0 | Keeps a static object's default physics script updating | Supported only with decoded behavior; otherwise reject |
| `Cloaked` | 9 | Part rendering treatment | Presentation projection |
| `ReportCollisionsAsEnvironment` | 4,497 | Converts peer reporting to the environment channel | Supported report classification |
| `EdgeSlide` | 3,963 | Enables edge-slide transition response | Supported response policy |
| `Sledding` | 0 | Alters friction and walkable-contact response | Preserve; reject local simulation until a reachable producer exists |
| `Frozen` | 0 | Stops object and animation updates without making the body static | Supported reversible scheduling role |

No effective mask contains unknown bits. There are 99 effective complete masks. State-only
classification yields 43,913 integration-eligible templates, 14,108 blocking targets, 29,739
targets suppressed by `Ethereal|IgnoreCollisions`, and 66 unsuppressed templates with no target
geometry. The runtime must calculate this classification once during preparation/replacement and
must not ask consumers to reinterpret bits independently.

### Live-State Reachability

A focused ACE source audit distinguishes representable masks from state changes the selected server
actually emits:

- `Frozen` is production-reachable. Delayed PK logout sets `IsFrozen`, broadcasts
  `GameMessageSetState`, then clears and broadcasts it before the logout animation.
- Doors, teleport/materialization, hooks, cloaking, inventory drops, and projectile impact broadcast
  changes to `Ethereal`, `IgnoreCollisions`, `ReportCollisions`, `Hidden`, `NoDraw`, `Cloaked`, and
  missile-related state.
- `Static` is selected while constructing a physics object from its initial mask. No post-creation
  production assignment or selected-database occurrence was found.
- `Sledding` has ACE physics consumers but no selected-database occurrence, production assignment,
  or broadcast producer was found.
- `Pushable` has no selected-database occurrence or physics consumer, and ACE's property setter
  mistakenly mutates `Missile` instead.

The first runtime therefore implements the proven live transitions, including `Frozen`, while
preserving but explicitly rejecting local simulation for `Static`, `Sledding`, and `Pushable`.
Receiving a complete authoritative mask never silently clears an unsupported bit.

## Adjacent Physical Inputs

| Input | Authority | Runtime rule |
| --- | --- | --- |
| Setup spheres/cylspheres and part physics BSP | DAT/HBA | Decode during preparation; retain mover and target shapes separately |
| Scale | Template default, then live instance replacement | Must be positive and finite; rescales every shape and dirties spatial membership |
| Friction | Optional template/live value | Response fact; absent resolves to ACE `PhysicsGlobals.DefaultFriction` (0.95) during definition preparation |
| Elasticity | Optional template/live value | Response fact; absent resolves to ACE `PhysicsGlobals.DefaultElasticity` (0.05) during definition preparation |
| Maximum velocity | Optional template launch value | Explorer missile launch speed; actual velocity vector remains live instance state |
| Rotation speed | Optional template launch value | Explorer missile spin input; actual omega remains live instance state |
| Pose/cell | Live producer instance | Registry/world authority supplies it; solver owns accepted physical pose |
| Velocity, acceleration, omega | Live producer instance | Solver state; replacement is an explicit wake operation |
| Motion commands and speeds | Live instance or Explorer scenario | Semantic drive input, separate from raw vectors |

The catalog has 20,096 present scales (0-400), 708 friction values (0-1), and 706 elasticity values
(0-5). Absence is retained in `.hwc`; default substitution belongs to validated definition
preparation, not the file codec.

The live ACE World census contains 1,761 `MaximumVelocity` values from 0-50 m/s and 252
`RotationSpeed` values from 0-3.5 revolutions/s. Of 104 `Missile` templates, 103 have maximum
velocity from 0-45 m/s and five have rotation speed from 0-2 revolutions/s. WCID 1499 Flame Bolt has
15 m/s. WCID 33843 Rockfall explicitly has zero, and WCID 34004 Crimson Night Gem Setting has no
maximum velocity. Launch must preserve those distinctions and reject only when the requested launch
operation requires a positive speed; template loading itself does not invent a fallback.

The regenerated `.hwc` version-1 payload retains both fields. Linear and angular velocity vectors
remain live entity state and do not belong in the template catalog.

The derived `MotionKinematics` asset contains 57 setup defaults, 436 motion tables, and 18,451 cyclic
stance/command entries. Of those entries, 1,822 carry velocity with magnitude 0-15.99999 m/s and
1,056 carry omega with magnitude 1-18 rad/s. ACE and retail still cap live velocity at 50 m/s.
Gravity contributes the proven 9.8 m/s² acceleration; protocol/live state may carry another finite
acceleration and has no separately proven authored cap. Contact detection therefore sizes its work
from the actual integrated relative displacement rather than assuming that velocity alone bounds a
tick.

## Non-State Collision Inputs

`ObjectInfo.Init`, `ObjectInfo.MissileIgnore`, `PhysicsObj.get_object_info`, and
`PhysicsObj.FindObjCollisions` prove that collision behavior is not a function of `PhysicsState`
alone.

| Input | Owner or first-population boundary |
| --- | --- |
| Creature/door category | Derive once from the template `WeenieType` |
| Player classification, impenetrability, PK and PKLite | Live producer facts; Explorer-spawned weenies are non-player/non-PK |
| Parent/attachment | Live instance relationship; attached bodies do not integrate independently |
| Projectile target | Optional live collision-filter/gameplay identity; targetless ballistic missiles are valid |
| Ignore-creatures | Producer/operation policy; not a template flag |
| Transition, placement, initial-placement mode | Operation policy at the solve call |
| Viewer policy | Producer policy; Explorer camera remains opted out |
| Perfect clip/free rotation/step-down/contact state | Prepared setup fact or retained solver state |

Retail collision callback profiles additionally contain WCID, item type, creature/player/attackable/
door flags, and missile/contact flags (`ACCWeenieObject::InqCollisionProfile`). WCID and pair identity
are already known. Item type and attackability feed gameplay callbacks, not detection, response, or
the selected first-population report contract. They are explicitly excluded rather than added to
`.hwc` without a runtime consumer.

## Contact Detection and Pair Processing

Authored cycle velocity reaches 16 m/s (0.533 m per 30 Hz tick), and ACE/retail cap live velocity at
50 m/s (1.667 m per tick), while the smallest authored sphere/cylsphere radius is 0.05 m. A live
acceleration replacement can make the integrated displacement larger still. Discrete overlap would
tunnel. The first dynamic narrow phase therefore uses one adaptive time-sliced rule against every
selected peer target branch: spheres, cylspheres, and physics BSP. For each directional pair, the
slice distance is the smaller of its smallest participating collision scale and the 0.05 m runtime
maximum. The required count is its conservative relative path length divided by that distance,
rounded up. The solve has a 128-slice budget and rejects a higher required count. Conservative path
length includes relative translation plus the rotational arc of each body's furthest collision
point. Opposing bodies at the proven 50 m/s live velocity cap move 3.333 m relative to each other per
30 Hz tick and require 67 slices. A larger actual integrated path is possible because acceleration
has no proven cap; that solve must reject before partially committing pose, response, or report state
rather than clamp or skip work.

Each pair samples both bodies' planned transforms from the same immutable tick-start snapshot,
including orientation, checks the initial placement and every slice endpoint, and mutates only the
directional mover. Full-path swept conservative bounds are queried once to produce a stable sorted/
deduplicated candidate set; slices do not repeat spatial-index lookup. Those bounds only find
candidates and do not prove contact. This deliberately reuses the solver's existing time-sliced
collision path instead of adding continuous time-of-impact implementations for all three target
geometry branches. Continuous contact remains deferred unless Phase R2 measurements prove bounded
slicing inadequate.

Dynamic targets reuse the existing spatial domains:

- outdoor bodies stamp conservative bounds into every overlapped global 24 m cell, including
  cross-landblock cells;
- interior bodies use every exact reached EnvCell, including portal-straddling membership; and
- no second tree or subdivision is added for the 50-300 body-per-populated-landblock envelope.

Pair work is directional. Each active mover visits candidate body IDs in stable order and may update
only its own accepted state. A peer that receives a response is woken and converges on its own later
solve, possibly next tick. Each `(recipient, peer)` report record is also directional. Thus two active
bodies may each solve their own side once, but neither applies the other body's response and neither
recipient emits duplicate starts. This preserves deterministic bounded convergence without claiming
an atomic simultaneous world step.

Required pair fixtures are: blocking sphere/sphere separation, sphere/cylsphere contact,
sphere/physics-BSP contact, `Ethereal|IgnoreCollisions` filtering, report-only contact, stable
two-active-body ordering, a settled target woken by an active mover, a 50 m/s missile crossing the
smallest supported target, opposing movers, rotating offset geometry, an exact-slice-boundary hit,
and rejection beyond the 128-slice budget.

## Collision Report Lifetime

Retail retains one collision record per directional recipient. First touch emits start; later touch
updates the timestamp without emitting; records naturally end after more than one second without a
refresh, or after the first positive interval when the recorded peer was ethereal. Teleport, world
exit, hide, detach, despawn, and replacement force an end. Static peers are reported through the
environment channel. `ReportCollisionsAsEnvironment` performs the same conversion for a dynamic
peer (`acclient.c`: `track_object_collision`, `report_collision_end`,
`report_object_collision`, `set_hidden`, `teleport_hook`, `exit_world`).

Retail's environment channel is asymmetric: `report_environment_collision` retains one collapsed
boolean and emits a start callback, while separation only clears that boolean and emits no end.
`ReportCollisionsAsEnvironment` bypasses the object collision table and inherits that behavior.
The runtime deliberately normalizes object and environment-classified contacts to the balanced
directional lifecycle below. Dynamic environment-classified contacts retain peer identity so a
forced body transition can end exactly the affected records. This is a compatibility divergence,
not retail behavior (`acclient.c`: `report_environment_collision`, `report_object_collision_end`).

ACE currently overwrites its dictionary record and invokes its callback on every observed touch.
The shared event contract selects retail's first-touch/silent-refresh lifetime because it is an event
lifecycle rather than a server gameplay callback loop.

Retail raw `set_state` does not reconcile report/filter changes during an existing contact. The
selected deliberate divergence is balanced:

1. loss of directional reporting eligibility immediately emits one forced end and removes the
   retained report record;
2. restored eligibility does not manufacture a start from stale velocity/contact data; and
3. the next confirmed eligible touch emits a new start.

Implementation requires a `RETAIL DIVERGENCE:` marker citing `acclient.c` `CPhysicsObj::set_state`
and the state-transition fixture census. Physical contact and response are unchanged by this event
lifecycle decision.

## Settling and Geometry Maintenance

Retail canonicalizes speed below 0.25 m/s to zero and clears active state when velocity is zero, the
object is on walkable support, and no movement manager remains (`PhysicsGlobals.SmallVelocity`,
`PhysicsObj.UpdatePhysicsInternal`). `Static`, `Frozen`, parentage, and missing cell residency are
separate scheduling gates. The first runtime uses one consecutive accepted stable tick after velocity
and omega have reached canonical zero. No wall-clock inactivity threshold is used.

A body settles only when it has stable walkable support, canonical zero velocity and omega, no
acceleration, no drive/motion work, and no pending response or accepted path. Wake operations are:
motion/actuation; velocity, acceleration, or omega replacement; teleport; complete physics-state
replacement; solver-participation enable/disable; peer response; scale or target-geometry mutation;
and relevant loaded terrain/interior collision changes. A loaded-world change may initially wake all
settled bodies.

Settling skips integration and mover queries only. Spatial target membership and collision-report
expiry remain serviced. Geometry has a separate dirty lane:

- setup spheres and cylspheres move only with root pose/scale and need no idle refresh;
- per-part physics BSP follows animated part frames, so a physical part animation dirties target
  geometry without necessarily integrating the root;
- a future physics script containing `SetScale`, `Ethereal`, `SetOmega`, or another collision hook
  must either produce a host-owned update or reject physical realization; the measured 23-setup
  population contains no such hook; and
- setup `0x02001BF2` rejects solver-body realization because its default animation moves all nine
  physics-BSP parts. Script-only default behavior does not dirty collision geometry.

Default animations and scripts initialize for dynamic objects; `HasDefaultAnim` and
`HasDefaultScript` only keep default behavior updating on the separate static-object path. The
absence of those effective bits in this non-static catalog does not make setup defaults inert.
Synthetic live-state fixtures still cover both bits.

## Representative First Population

| WCID | Name | Reason |
| ---: | --- | --- |
| 1 | Clay | Ordinary creature, two-sphere mover/target, gravity/reporting/edge-slide |
| 21 | Corpse | Sphere geometry intentionally suppressed by `Ethereal|IgnoreCollisions` |
| 147 | Crate | Physics-BSP target with dummy moving sphere |
| 158 | Large Urn | Cylsphere target with dummy moving sphere and scale 2 |
| 239 | Brazier | Pose/presentation body with no target geometry |
| 400 | Carsith the Weaponsmith | Dynamic sphere reported as environment |
| 1499 | Flame Bolt | Missile/path/align/inelastic high-displacement case |
| 34621 | Killagurg | Appearance substitutions and authored zero-length palette range |
| 27437 | Dark Monolith | Reachable rejection for zero scale |
| 52077 | Rynthid Assessment Crystal | Reachable solver-body rejection for animated physics-BSP parts |

Synthetic fixtures supplement the real population for the production-reachable `Frozen` transition;
explicit `Static`, `Sledding`, and unused-bit rejection; default animation/script; parentage; viewer
policy; PK relationships; and collision-report state changes because the selected catalog contains
no reachable authored example for those cases.

## Shared Boundary Dry Run

`WorldState` and the Explorer registry remain separate producer authorities. Each supplies identity,
lifecycle, pose/live state, and a source-neutral template/appearance input to shared pure preparation
and state-reconciliation operations. Each keeps its own ordering, identity allocation, registry
mutation, failure compensation, and publication policy. Both use `SpatialScene` operations and the
same committed solver outcome types; neither registry moves into a shared funnel.

The Explorer continues using `HostSimulationRuntime`'s `SpatialScene`; the client continues using
`WorldState.scene`. A solve returns its committed result synchronously. The existing world event path
and app-local Tauri emitter project only their named frontend-relevant consequences. Explorer
collision-report outcomes have no frontend consumer and are not relayed or retained for diagnostics.
There is no named consumer requiring a new broadcast channel, acknowledgement protocol, or second
state store.

Current `EntityMotionSnapshot` covers stance, simultaneous forward/sidestep/turn commands and speeds,
plus turn-to-heading/object directives. `MotionKinematics` resolves cycle velocity/omega. It is enough
for spawn-at-rest and basic stand/move/turn/stop. It does not represent move-to-position/object path
progress, animation transition phase, queued sequence state, start frame, or framerate. Those are
shared locomotion gaps, not reasons to widen the dynamic-entity creation contract. The active
Explorer milestone does not execute semantic motion commands; the dedicated
`holtburger-authored-root-motion-physics-integration-plan.md` owns their resolution.

## Authored Root-Motion Census

The default offline survey now enumerates raw motion-table resources from the mounted HBA index,
decodes every animation referenced by cycles, modifiers, and links, applies each selected frame
range, and resolves each catalog template's effective motion table from its explicit override or
setup default. This evidence remains tool output; no runtime registry, trace buffer, or diagnostic
record was added.

The canonical `dats/weenies.hwc` and `dats/assets.hba` population contains 436 motion tables, 62,210
motion-data records, 79,162 animation entries, and 1,938 distinct referenced animations. Of those
animations, 353 carry position frames, 341 have non-identity root translation, and 20 have
non-identity root rotation. The selected ranges expose position frames in 205 motion tables,
translation in 203, and rotation in 48. Across the catalog, 13,996 templates name an effective
motion table and 13,992 resolve one from the canonical HBA. The other four all reference unavailable
table `0x09000085`; the survey reports that population separately rather than classifying it as
identity motion. Of the decoded population, 7,903 can reach position frames, 7,901 can reach
translation, and 1,497 can reach rotation.

There are 21,244 animation entries whose selected ranges carry position frames. The maximum possible
authored frame-boundary crossings during one 30 Hz tick are calculated as
`ceil(abs(stored_framerate) * speed_modifier / 30)`. At stored rate, the distribution has p50 1,
p95/p99 3, and maximum 8; 4,854 entries can cross more than one boundary. At the explicitly labeled
3x stress rate, the distribution has p50 3, p95/p99 9, and maximum 24; 19,703 entries can cross more
than one boundary. The identity classification tolerance is `1e-6`; quaternion sign-equivalent
identity rotations are normalized before classification.

Exactly one catalog record combines effective physics-BSP target geometry with table-reachable root
motion: WCID 46320 Security Station resolves motion table `0x090000A1`, which reaches root
translation but not root rotation. In the representative population, WCIDs 1 Clay, 21 Corpse, and
400 Carsith the Weaponsmith resolve `0x09000001`, reach root translation, and can cross at most four
authored boundaries per stored-rate tick. WCID 34621 Killagurg resolves `0x09000009`, reaches root
translation, and can cross at most one. The remaining six representatives do not reach root
transforms; WCID 147 Crate has no motion table, while WCID 52077 Rynthid Assessment Crystal resolves
`0x09000227` without position frames. None of the ten representative tables reaches root rotation.
Table-reachable means selected by at least one authored cycle, modifier, or link in the effective
table. It is a conservative contract bound, not proof that the first Explorer command surface or
every ACE gameplay path issues every measured record.

These measurements close the evidence task and establish that root-motion/physics unification is a
cross-cutting effort rather than a local Explorer feature. Ordered multi-frame translation is common,
root rotation is catalog-reachable, and a moving physics-BSP target exists. The active dynamic-entity
plan therefore moves entities only through physical vectors or explicit relocation and exposes no
semantic command capable of selecting authored root motion. The two shipped setup-default clips with
position frames (`0x03000BB7` and `0x03000BDE`) have zero translation but non-identity root rotation;
their setups are `0x02001694` and `0x02001752`. Only setup `0x02001752` is referenced by the canonical
catalog, through WCID 36449 Bats. Bats remains spawnable, but its authored root rotation is
deliberately ignored under a
`RETAIL DIVERGENCE` marker with this one-WCID census while solver-owned physical motion remains
authoritative. Exact shared integration is deferred to
`holtburger-authored-root-motion-physics-integration-plan.md`; no endpoint approximation is selected
here.
