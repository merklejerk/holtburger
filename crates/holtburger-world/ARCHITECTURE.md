# World State Architecture 🌍

`holtburger-world` is the client's authoritative in-memory world model. It owns the live player
entity, hydrated entities, spatial index, lifecycle/retention rules, and world-domain state, while
keeping protocol routing separate from the state models themselves.

The refactor goal was simple: **handlers orchestrate, models mutate**.

## Core Design Rules

- **No transport ownership**: this crate does not own UDP/session concerns. It receives decoded
  messages from `holtburger-core`.
- **Feature-based routing**: protocol dispatch is grouped by gameplay/domain concern under
  [src/handlers](src/handlers), not by whichever state struct happens to hold most of the fields.
- **Stable facade**: callers still enter through `WorldState::handle_message()`, but that method is
  now just a facade over the handler layer.
- **Narrow mutation surfaces**: handlers call focused mutation helpers on `PlayerState` and
  `WorldState` instead of open-coding state changes.
- **One world authority**: player world/object state lives on the player `Entity` in
  `WorldState.entities`; `PlayerState` is reserved for local-player/session overlays.
- **Retention is part of authority**: whether an entity stays visible to the client is determined by
  `WorldState` retention/lifecycle rules, not by ad hoc handler-local cleanup.

## Ownership Split

### `handlers/` — protocol orchestration

Files: [src/handlers](src/handlers)

This layer is responsible for turning decoded protocol messages into state mutations and
`WorldEvent`s.

- `routing`: central dispatch order plus final event decoration such as spell-name resolution
- `player`: player-local updates, stat hydration, enchantments/spells, and movement sequence tracking
- `movement`: movement and vector synchronization
- `inventory`: ownership, placement, containers, previews, and object lifecycle
- `properties`: property fan-out across player, entities, vendor state, and derived side effects
- `login`: world-facing bootstrap completion for flows such as `PlayerDescription`
- `trade`: trade/vendor protocol flows
- `system`: `SetState` plus oddball protocol/system events such as `UseDone` and `WeenieError*`

Key rule: routing order is explicit and meaningful. Shared flows preserve
**player-first, world-second, event-last** ordering, and `routing.rs` is where that precedence lives.

### `PlayerState` — player-local model

File: [src/player/mod.rs](src/player/mod.rs)

`PlayerState` owns session-local player data:

- attributes, vitals, skills, and their raw bases
- enchantments, spells, hotbars, and derived combat stats
- inventory/equipment membership
- player-local position overlays and protocol sequence tracking
- bootstrap hydration for player-local `PlayerDescription` data

`PlayerState` does **not** own the top-level message router anymore, and it is not a second
authoritative entity snapshot. Its job is to expose mutation helpers that encode player-local
invariants, sequence tracking, and derived-stat recalculation.

### `WorldState` — authoritative world graph

File: [src/state/mod.rs](src/state/mod.rs)

`WorldState` owns the rest of the authoritative world model:

- `EntityManager` and the hydrated entity graph
- `SpatialScene` and movement/placement invariants
- entity lifecycle retention, pruning deadlines, and visibility-based eviction
- vendor state, trade state, open containers, and server time sync
- DAT-backed lookup tables such as XP, skill, and spell data

`WorldState::handle_message()` remains the stable public entry point, but its role is now to
delegate into the handler layer and return emitted `WorldEvent`s.

### Entities & Hydration

Files: [src/entity.rs](src/entity.rs), [src/hydration.rs](src/hydration.rs)

- **`EntityManager`** stores every hydrated object currently known to the client.
- **Hydration** merges partial updates into complete entity state as object descriptions and
  property updates arrive over time.

### Spatial / Physics helpers

Files: [src/spatial.rs](src/spatial.rs), [src/spatial](src/spatial)

These modules own movement-facing invariants:

- nearby-entity queries
- player/entity movement synchronization
- retention/visibility housekeeping for the world graph
- conservative visibility tracking for prune deadlines
- authoritative player-entity helpers such as `set_player_position()` and
  `record_player_server_vectors()`; ordinary server samples remain entity facts without replacing
  locally integrated self kinematics at retail's default autonomy level

`SpatialScene` is the world-owned spatial composite and solve/query context. Shared runtime
sampling behavior lives inside it via `BodySamplingStore`, and that world-owned sampling state is
the canonical runtime body model for the client. Any app-facing cache in `holtburger-core` or a
frontend is derived read state only; it must not independently advance runtime bodies.

`settle_free_sphere` is the generic bounded placement counterpart to movement-oriented
`solve_free_sphere`. It consumes directionless placement contacts and either returns a separated
body/cell or reports that the finite contact budget could not prove one. It never publishes its
unconverged candidate. Camera clearance growth is one consumer, but the primitive has no camera or
projection policy.

Shared world does not perform automatic local collision or local velocity integration during
`tick()`. Constraint-aware advancement is an explicit solve operation on the world-owned runtime
path rather than an implicit side effect or a parallel core/frontend cache.

Authoritative pose samples and runtime placement are deliberately separate levels. A local-player
adapter in `holtburger-core` classifies ordinary self echoes as confirmations; the remote-object
adapter in `WorldState` applies retail's position/teleport/contact/viewer-distance ladder. Both
produce one `AuthoritativePoseEffect`, while `SpatialBody` owns the optional interpolation,
confirmed-travel constraint, and pending ordinary-snap state that executes the effect. Remote
force-position timestamps have no independent meaning in the retail receive path; only the
quarantined, unobserved server-to-client autonomous-position opcode still retains its explicit
reset behavior pending evidence.

Reconciliation composes at the existing body tick boundary. Physical bodies compose it into their
prepared actuation before collision; pose-only remotes compose the same translation and heading
policy before dead reckoning. A far correction is installed on the next fixed tick and reports
`RuntimeBodyAdvanceKind::CorrectionSnap`; it is not a teleport or authority reset. Packet-time
entity authority may advance without replacing `SpatialBody.pose`, and no correction clock or
target is projected outside `holtburger-world`.

The host-physics recovery adds an explicit static-collision subsystem without changing that
existing implicit `tick()` policy:

- `CollisionScene` owns complete landblock collision artifacts and one derived resident static-shadow
  index. Geometry remains owned once by its source artifact. Outdoor colliders and building shells
  register into global 24m-cell buckets keyed by the cells their placed bounds shadow (retail's
  per-cell stab-list granularity), so cross-owner spans need no seam handling and selection cost
  follows the query's swept extent rather than scene residency; EnvCell buckets contain stable
  source references per reached cell. Terrain contact generation indexes the row-major cell grid
  directly by the query's reach, widened by the surface's cached burial-shift bound so buried-body
  recovery contacts stay identical to an exhaustive scan. Batched
  insertion/replacement/eviction rebuilds the index transactionally, so terrain, placed shapes,
  volumes, and every derived shadow change atomically.
- Coverage, movement obstruction, lower-sphere support, placement confirmation, and prior-cell
  transit are separate typed query families. Queries return geometry facts without choosing
  grounded policy, and missing coverage is a result rather than a collision miss.
- `SpatialMembership` carries the lower-center-committed EnvCell, every EnvCell reached by the
  retained sphere set, and outdoor reach. All query families select terrain, outdoor objects,
  building shells, EnvCell shells, and indoor statics from that one contract; they never infer a
  collision domain independently.
- Cross-owner static shadows retain the exact owner-product proof of the geometry that supplied
  them. Each query derives its required normalized owners from its actual swept extent; unavailable
  coverage rejects ordinary body motion without mutating the body. Applications may prefetch a
  wider simulation neighborhood to hide loading latency, but correctness does not depend on that
  policy radius. Render interest and registered bodies cannot alter simulation coverage semantics.
- BSP planes and polygons transform into landblock-local query space. The body sphere remains
  spherical even for non-uniformly scaled SetupModel parts.
- `solve_free_sphere` is an explicit bounded operation over one requested displacement. It owns no
  gravity, support, walkability, step, slope, or ledge behavior and never runs implicitly from
  `tick()`. Registered physical-fly bodies and unregistered kinematic controllers call it
  explicitly; the solver neither owns their lifecycle nor distinguishes their purpose.
- The production contact step owns gravity, walkability, grounded motion, and final support
  classification over one lower/support sphere and one optional upper/constraint sphere.
  `solve_grounded` remains a standalone diagnostic primitive. The upper sphere constrains
  clearance but cannot supply support or choose the committed cell.
- Polygon footing uses a full lower-sphere-radius horizontal disk against the finite face's XY
  footprint. The plane supplies resting height and slope classification; vertical adjustment cannot
  change footprint admission. Cylinder caps and balls retain their shape-specific resting heights.
  World colliders and prepared hard entities use one placed-shape support query. Yielding mobile
  bodies do not provide standing support.
- Support preparation can recover an overlapping body upward within its authored step-up height
  before selecting the grounded motor. Candidate selection chooses the highest admissible standing
  target before applying confirmation tolerance, so a lower nearby plane cannot hide higher ground.
  Upward recovery requires walkable support and full-body swept clearance; ordinary downward landing
  retains its separate slope threshold. Geometric candidate selection does not reject velocity:
  supported walking transfers to the new plane and projects its velocity after clearance. Airborne
  acquisition/landing and pure confirmation reject separating normal velocity. This prevents a
  slope-normal change at a polygon seam from being treated as a launch. World-Z ascent alone does
  not distinguish departure from uphill approach. Recovery and endpoint settling share geometry.
  Recovery is a geometric adjustment: it creates no timed locomotion, upward momentum, or landing
  impact. Final support confirmation cannot move the body. A subsequent stair's height is measured
  from recovered footing; there is no tick-wide cumulative upward-displacement budget.
  Retail/ACE terrain uses the vertical sphere bottom (`acclient.c:302787-302841`); our nominal full
  sphere can therefore rest slightly higher than the independent authoritative reference.
- Current-pose support confirmation permits only contact-tolerance height error. Walking step-down
  and the lenient landing probe may search farther, but any adjustment requires full-body hard
  clearance. Walking and landing retain their separate normal thresholds; a steep admitted plane
  publishes `GroundState::Sliding` while motion remains ballistic.
- Retained support identifies either immutable world content or a hard entity. World owner proofs
  validate unchanged cached footing; entity support is re-queried against current prepared targets,
  including for sleeping bodies. This uses ordinary support queries, not a platform lifecycle or
  carrying system. Source loss can wake gravity; no platform velocity is inherited.
- Step-up, step-down, and ordinary settling share the same support predicate. One private stair
  alternative is hard-swept before commit; a failed alternative cannot leak pose or contact state.
  Creature edge protection restores prior valid footing and attempts one tangent derived from its
  retained inward footprint normal. It may hold at rounded outer corners. Grounded ordinary and
  corrective navigation share this protection; launches have already released walkable support.
  `advance_hard_motion` owns route acceptance and final ground classification. Settlement returns
  unchanged, unsupported, or settled footing (including an accepted rebound), rather than clearing
  the body's ground state to signal a failed candidate. The same saved-footing snapshot restores
  rejected alternatives. Final observational confirmation cannot move a body back to a floor.
- Grounded cell transit queries both spheres through the previous-cell/portal-neighbor rule, but the
  lower sphere alone selects the committed cell. Back-face polygons produce approach-side contacts;
  no retail transition flag is retained when sphere role already determines the response.
- `PhysicalBodyResponsePolicy` is one composite body fact: elastic versus inelastic restitution,
  authored friction, Stable versus retail Sledding surface motion, and `AlignPath`. Construction and
  authoritative updates own that policy; collision outcomes never infer or toggle Sledding.
- Elastic response clamps its coefficient to retail's `[0.0, 0.1]` domain and reflects only the
  incoming collision-normal component, preserving tangent velocity
  (`CPhysicsObj::set_elasticity`, `acclient.c:305519-305530`;
  `handle_all_collisions`, `acclient.c:309982-310045`). Inelastic response zeros velocity. Stable
  bodies suppress restitution across continuous walkable support so correction cannot become a
  per-tick trampoline.
- Sledding deliberately bypasses Stable's supported-gravity suppression, retains eligible
  continuous-support restitution, and selects the retail speed/slope friction branches. Nonzero
  velocity supplies Sledding facing after ordinary control; `AlignPath` displacement-facing runs
  later and supersedes it. These are generic body semantics, not character-controller modes.
- Hard sweeps share one fixed geometric contact band through their query radius; registered
  radii and support footprints remain nominal. The band is bounded by `CONTACT_EPSILON`, not a
  fresh per-move allowance. Stable initial normals do not enlarge this admission boundary.
  Selected support keeps its computed height correction, and settling checks any represented
  correction against hard geometry before publishing it. Exact represented rest needs no extra
  sweep. Triangle faces and cylinder cap interiors use exact plane impact times; finite edges
  and other curved contacts retain continuous shape casts.
- `SpatialBody::retained` owns physical continuation. Grounded input drives a bounded velocity
  motor; free-flight authored travel remains a separately swept kinematic contribution. An
  admitted launch replaces velocity once. Accepted timed motion is reduced into observation
  fields and never becomes another physical input. Positional contact correction consumes travel
  allowance but creates no velocity.
- Scene collection publication gives each committed body one `DynamicEntityBodyOutcome`: integrated
  motion, a fixed authority placement, or checked recovery. Recovery replaces its provisional
  integrated result. Integrated results carry the accepted root path and final support/presentation
  facts while the scene owns both physical endpoints. Collision reports and missing coverage remain
  orthogonal: an accepted prefix can coexist with a coverage rejection. Client projection handles
  each disposition; Explorer explicitly rejects authority snaps and remote recovery, which its
  authored/autonomous input producer does not support.
- `spatial/mobile_contact` advances a private collection once per admitted tick. Non-yielding
  authored targets advance first. Yielding bodies then prepare intent once; supported stable
  characters limit inward walking against relative mobile sphere paths before ordinary hard
  navigation. Each body shares one `MOBILE_PUSH_THROUGH_SPEED * dt` allowance across contacts,
  independently of separation mobility. Free tangential/outward travel survives; conservative
  crowd clipping and optimistic neighbor escape can leave residual overlap without feedback solves.
  World geometry and effectively immovable entity shapes retain final swept authority. Mobile pairs use
  movement-sphere endpoint overlap with tolerance and fixed local passes. The passes update tentative
  positions within each body's cumulative allowance; one combined corrective navigation operation
  then checks the result against hard geometry. Closing mobile contacts brake only each body's own inward normal velocity; no participant receives another body's momentum. Mobile response permission is explicit and carries a separation weight: zero weight still participates in inward braking; absent permission retains nonyielding hard-target behavior. Player mobility is 0.01 versus an ordinary
  peer's 1.0, biasing unconstrained separation one-hundred-to-one toward the peer. Repeated separation can still move the player without momentum. Opposing corrections may cancel, residual overlap is valid, and fast mobile
  crossings are deliberately not exhaustive. Projectiles retain swept impact against accepted
  crowd endpoints. No recursive pushing or crowd-wide convergence is required.
- Stable characters follow supported ordinary command velocity directly, plus proportional
  reference return. Zero ordinary input stops horizontal motion, including externally supplied
  velocity; no extra acceleration ramp creates startup lag behind nominal travel. Contacts act
  through movement admission and subsequent overlap response. Return tapers near its
  target, without a separate acceleration ramp or retained correction velocity. Passive objects
  and sledding retain their coast drag/rate-limited motors; airborne motion and launches retain
  existing force paths. Prepared actuation carries the character/passive drive policy; no persistent
  stop flag or additional wake permission is introduced.
- Each displaced body can retain an independent authoritative reference. Collision-free nominal
  vectors belong to the body, survive correction completion and physical reconfiguration, and advance
  cumulatively with admitted ticks. Fresh vector messages reseed them; position packets replace them
  only when they explicitly carry or clear velocity. Pose-only retargeting preserves continuation.
  Interpreted remote characters share one source frame between actual ordinary movement and
  nominal travel. `BodyMotionRuntime` retains that command orientation across positional return
  completion and content rebinding. Return translation never changes command heading. Local,
  passive, fixed, free-flight, and pose-only sources keep their existing body/frame contracts.
  Fresh authority events update source orientation once at admission; the physical authority
  heading remains a one-shot transactional request. Commands can keep requesting an unfulfilled
  heading after hard clipping, but physical angular work remains bounded with no queued rotations.
  Tick inputs carry authored travel rather than replaying cached server vectors. Supported nominal
  travel uses the same prepared tangent plane as actual travel, including on slopes. Grounded return
  steers and completes in horizontal coordinates; navigation owns height and can descend stairs.
  A different solid floor at the same XY is an accepted unrecoverable case for this motor. Free-flight
  return retains full 3D steering and completion. Bounded return steers the actual body through
  its existing response adapter. Grounded return uses the supported motor; free-flight return
  contributes swept kinematic travel without becoming retained physical velocity. Scene publication
  commits body and reference continuation together. Remote supported characters begin return beyond
  `PHYSICAL_RETURN_START_THRESHOLD_M` (20 cm) and stop within the existing 5 cm band once relative
  velocity settles. A dormant reference continues to remember accumulated error, but does not keep
  the body awake; accepted contact displacement can activate return for the following tick. Fresh
  heading requests remain independent of positional inactivity. Flight/passive correction retains
  its continuous policy and releases its reference on completion.
  Remote character recovery observes accepted progress toward the latest server pose separately
  from that predicted reference. Two simulated seconds without 5 cm of net improvement permit a
  checked placement attempt; repeated equivalent packets do not renew the window. Sticky intent
  (including unavailable target geometry) and direct player contact clear the observation. Failed
  or uncovered placements wait another full window. Destination validation reuses bounded support
  acquisition and directionless hard-geometry clearance, without sweeping the old route. A
  successful relocation retains checked cell membership, clears obsolete response/reference state
  and report lifetimes, and publishes `CorrectionSnap`; authored actions remain intact. The local
  player, autonomous inputs, and non-character bodies do not use this recovery policy.
  `spatial/body_movement.rs` prepares ordinary prediction and contact actuation once for both
  returning and uncorrected bodies. One transient `ResolvedAuthoredMotion` supplies the world
  velocity shared by actual and grounded nominal preparation; only free-flight reference
  prediction also consumes the source-local offset through its independent orientation. It owns supported and free-flight return-rate policy;
  `PHYSICAL_RETURN_GAIN` scales error directly, without a fixed speed ceiling. The contact kernel
  accepts the resolved supported drive or free-flight travel bias without choosing reference speed.
  Local confirmation still constrains its admitted command through the existing confirmation adapter.
  Commands and fresh authority own remote heading during both motion and rest. Return adds
  bounded translation without turning the body or delaying travel for facing alignment. Observed
  locomotion selects forward/backward/sideways gait relative to the accepted heading; missing side
  content can still slide. Attacks, emotes, transitions and explicit poses retain playback priority,
  while return translation continues underneath. An action's root contribution survives completion
  inside the sample even when the resulting clip is stationary. Observed playback cannot alter
  that source sample or emit authored physics hooks.

Collision integration uses an anchor landblock's local coordinates across one solve. It does not
accumulate large absolute-world `f32` coordinates; doing so produced measurable centimeter-scale
drift at `0xDA55FFFF`. Owner-local conversion occurs only at collision lookup and pose commit.

#### Dynamic entity bodies

Dynamic entities extend the same scene without a second store or solver:

- Every world-placed dynamic entity keeps exactly one `SpatialBody` that owns its world pose.
  `SpatialBody::physical` is optional collision/physics state, and `set_dynamic_physical_body`
  adds, removes, or reconfigures it reversibly. Removing physical allocation never retires the
  pose body, and compatible movement geometry preserves contact/placement response memory.
- Attachments delegate independent placement and collision authority to the parent. The client
  keeps a parent-derived canonical pose record for shared world consumers, while
  `delegate_attached_entity_position` removes independent dynamic physics. Presentation retains
  `EntityPlacement::Attached(PhysicsAttachment)` with parent GUID, holding location, and local
  placement for part-hierarchy composition. An attached pose record is not an independent mover
  or collision target.
- `SpatialScene` owns every derived membership. Coarse landblock membership and the dynamic
  shadow index are updated inside registration, pose commit, physical-state replacement,
  relocation, and removal, so no caller choreographs a second index and no `entity_poses` mirror
  exists.
- Producer-owned integration demand and solver-owned activity are separate. Quiet supported
  grounded bodies and eligible force-free flight bodies may settle when their input, reference,
  pose change, and retained vectors permit it. Settled mobile bodies keep contact mobility;
  contact displacement wakes ordinary integration on the next tick. Residency refresh owns
  suspension, and new producer work explicitly wakes a body. Target geometry, report lifetimes,
  and presentation remain independent of ordinary integration scheduling.
- Prepared `EntityContactResponse` keeps gameplay character identity separate from scheduling.
  Eligible characters yield; obstacles retain hard geometry even with ordinary movement input.
  Freezing restricts character response reversibly. Fixed-position geometry and explicitly excluded
  integration remain hard. Client characters retain eligibility at rest, with activity owning sleep.
  Admitted nonyielding movement advances first and places its authored target at the accepted pose;
  characters then advance against it. Only yielding bodies enter compliant pair correction.
- Fixed-body authored root translation is explicit placement, not retained velocity. The world
  input boundary composes reference root motion once, traverses cell membership, and publishes
  accepted displacement with a normalized root pose. Producers scale local root translation before
  submission; this placement does not grant contact mobility.
- Hard targets retain authored geometry. Mobile response uses prepared movement spheres and
  reached-domain filtering. Observational entity reports query the existing global 24 m outdoor
  cell / EnvCell index once per mover's aggregate accepted tick extent, then test individual
  accepted segments against frozen peer shapes. Aggregate domain membership does not grant a
  segment contact in an unrelated cell. Reports include initial overlap and crossed stationary
  triggers, but do not negotiate response or reject a whole crowd for unresolved mobile overlap.
- Contact solving owns a tick-local `HardTargets` collection with a Parry bounding-box tree.
  Private contact preparation carries installed physics and a borrowed hard/mobile/absent target
  classification through working motion; geometry consumers do not recover it from general bodies.
  Accepted hard-body movement updates its geometry and leaf together; projectile targets append
  accepted mobile endpoints. Spatial candidate selection is independent of cell membership so
  portal crossings cannot lose targets before the exact sweep discovers reached cells. Support
  uses a conservative vertical column; exact shapes retain height admission. Queries restore
  identity order for deterministic hit ties. Mobile separation separately reuses one pair list
  expanded by each body's cumulative correction allowance across its fixed passes.
- Collection finalization owns accepted continuation, return progress and sleep state on private
  body copies. After ordinary publication, one recovery operation owns destination checking,
  relocation/report consequences and replacement of the ordinary result with a discontinuity.
  Fixed placement still precedes the mobile snapshot; this is not a whole-tick rollback transaction.
- Target geometry follows retail's branch order — physics BSP, otherwise all cylspheres, otherwise
  all ordinary spheres — and is distinct from the movement spheres used for the mover's own query.
- `collision_report.rs` retains only the directional contact state required for correct lifecycle
  semantics: first touch starts, later touches refresh silently, and expiry or an invalidating
  transition ends. It is not a diagnostic history, and expiry is serviced with an injected clock
  even while a body is settled.

### Authored motion ([src/motion/](src/motion/))

Files: [state.rs](src/motion/state.rs), [sequence.rs](src/motion/sequence.rs),
[selection.rs](src/motion/selection.rs), [registry.rs](src/motion/registry.rs),
[actuation.rs](src/motion/actuation.rs)

Retail's motion-table state machine and sequence playback, ported as values a caller owns rather
than as a service. Nothing here caches, records history, or reaches back into content.

- `MotionState` is retail's actual motion state — `style`, `substate`, `substate_mod`, and the
  modifier stack (`acclient.c:327700-327730`). Named after the decompile deliberately, so anyone
  cross-reading lands here. The controller-intent type in `holtburger-core` is `CharacterDrive`; it
  used to share this name, which is why the collision is worth stating.
- `MotionOrder` is what a body has been ordered to perform this tick, independent of who ordered it:
  a style plus forward, sidestep, and turn commands with speed _multipliers_. Distinct from
  `CharacterDrive`, which carries the same four axes as semantic intent with no motion-table
  vocabulary; the mapping between them is what the resolvers exist to perform.
- `MotionSequenceRuntime` is retail's `CSequence` (`acclient.c:326110-327216`): the installed clips
  and the cursor into them. `advance` returns what one tick produced — a single exactly-composed
  rigid offset plus the simulation hooks the departed frames fired — rather than a sample of it,
  matching retail's compose-then-apply-once structure.
- `selection.rs` ports retail's motion selection, including link resolution and `re_modify`, while
  deliberately replaying every active modifier once instead of reproducing retail's head-only
  replay defect. The divergence marker there carries the citation and content census.
- `MotionRuntimeRegistry` owns per-body authored playback, retained remote directive progress,
  and an optional locomotion presentation cursor. The world supplies current body/target facts to
  directive reduction instead of maintaining a second command-state map. Content rebinding resets
  playback while preserving remote command progress and orientation; entity/runtime reset clears
  them together. Separate local and remote entry points select source ownership before advancing
  the same authored cursor. Only authored playback supplies root offsets and simulation hooks.
  Observed locomotion consumes supported movement after final horizontal contact separation,
  excluding airborne travel and stair lifts. The shared selector preserves action, explicit-pose,
  and one-shot priority; observed gait cannot feed physics or hide an active action. Authored cursor
  lifetime follows entity lifetime. `EntityNetworkMotion::Uninitialized` means that generation has
  supplied no order; `Initialized` includes idle and therefore actively retires a previous cycle.
  A locally predicted order may still precede its server echo without making absence mean stop.

Playback supplies shared authored motion semantics and body-observed clip selection. Articulated
part-frame evaluation and rendering remain frontend responsibilities.

### Lifecycle / retention helpers

Files: [src/state/liveness.rs](src/state/liveness.rs), [src/state/mutations.rs](src/state/mutations.rs)

These modules own the rules for when entities stay in the client-visible graph versus when they can
be pruned:

- explicit delete tracking
- preview retention for trade and opened containers
- ownership/parent retention reconciliation
- lifecycle-aware entity upsert and eviction

### Query traits and projection-facing logic

File: [src/context.rs](src/context.rs)

`WorldContext` and `WorldContextExt` provide a pure query boundary for higher-level logic. That lets
lossy projections or UI layers answer gameplay questions without duplicating rules or depending on
engine-thread state directly.

For runtime spatial reads, the long-term contract is the same: higher layers consume projected or
authoritative samples derived from world-owned `SpatialBody` state through explicit read-model
surfaces. They do not get shared mutable access to canonical runtime bodies, and they do not define
their own interpolation or dead-reckoning truth on the side.

This is also the boundary for shared combat-target semantics. Frontends may receive compact motion
updates for rendering or inspection, but gameplay queries such as combat-target viability should be
derived from world-owned state through `WorldContextExt` rather than reinterpreting motion packets
independently in each client.

## Dispatch Flow

```mermaid
sequenceDiagram
        participant Core as holtburger-core
        participant World as WorldState
        participant Handlers as handlers/*
        participant Models as PlayerState / WorldState helpers
        participant Events as WorldEvent[]

        Core->>World: handle_message(GameMessage)
        World->>Handlers: delegate dispatch
        Handlers->>Models: apply narrow mutations
        Handlers->>Events: emit state events
        World-->>Core: Vec<WorldEvent>
```

1. `holtburger-core` decodes a protocol message and calls `WorldState::handle_message()`.
2. `WorldState` delegates dispatch to [src/handlers/routing.rs](src/handlers/routing.rs).
3. `routing.rs` applies an explicit precedence order across handler modules.
4. The relevant feature handler applies mutations through `PlayerState` or `WorldState` helpers.
5. Handlers emit `WorldEvent`s describing the observable outcome.
6. Final event decoration, currently including spell-name resolution, happens in the routing layer
   before control returns to the caller.

## Important Invariants

### Player authority invariant

The current player's world/object state lives on the player entity in `WorldState.entities`.

Anything that changes the player's physical position or velocity must update that entity through
the `WorldState` movement helpers so the authoritative entity state and the runtime-body state stay
in sync. `PlayerState` is for local-player overlays and sequencing, not duplicate world storage.

### Handler boundary

Handlers should orchestrate domain flows; they should not become mini state stores.

If a handler needs to do a multi-step update repeatedly, extract a named helper on the owning state
type instead of open-coding the mutation logic again.

### Bootstrap split invariant

`PlayerDescription` is intentionally a shared flow:

- the `player` handler hydrates the session-local player model first
- the `login` handler then hydrates the authoritative player entity and emits `PlayerInfo`/`LevelInfo`

That ordering avoids world helpers reading partially hydrated player state.

### Entity retention invariant

Entity lifetime is not just spawn/despawn.

- open-container previews
- trade previews
- parent/container/wielder ownership
- visibility-based prune deadlines
- explicit delete requests

All of these feed the retention snapshot in [src/state/liveness.rs](src/state/liveness.rs).
If you change entity ownership or visibility rules, update retention reconciliation in the owning
world helpers rather than layering on handler-specific cleanup.

### Event emission boundary

`WorldEvent` emission should describe meaningful observable changes or packet-scoped processing outcomes after mutation, not serve as a
shadow source of truth.

Entity movement follows this rule too. `holtburger-world` owns `EntityNetworkMotion`, admits updates
by exact object instance plus retail movement/server-control timestamp ordering, and emits state
events only when the resulting initialized order changes. The initialized order is reduced to a
compact solver snapshot; consumers may project or render the resulting body and playing-clip
levels, but neither the event nor the renderer is a second movement authority.

Retained steady motion and transient actions are separate contracts. Command-list actions use their
own wrapping 15-bit sequence and autonomous bit; an ACE action-class forward command becomes one
edge at outer movement-event admission and is removed from the retained forward channel. The
world-owned `MotionRuntimeRegistry` keeps the six-action FIFO, exact sequence completion boundary,
latest steady return destination, playing clip, and authored root contribution for local players,
remote players, and creatures alike. A fresh steady update retargets an active action's cyclic
return suffix without restarting its non-cyclic prefix.

MoveTo and TurnTo remain source authority, not playback implementations. Their retained composite
parameters enter the pure server-directed reducer with current pose, support, and target facts; its
ordinary `MotionOrder` then crosses the same table selector, runtime, and authored-root solver seam
as every other actor. Setup fallback is resolved once by
`WorldState::effective_motion_table_id_for_guid`, so solver and client projection cannot choose
different tables.

## Adding New Functionality

When introducing a new tracked domain:

1. Decide whether it is primarily player-local, world-global, or shared.
2. Add state storage to the owning model (`PlayerState`, `WorldState`, or a nested world module).
3. Add focused mutation helpers that encode the new invariants.
4. Route protocol messages through a feature handler under [src/handlers](src/handlers).
5. Emit `WorldEvent`s only for meaningful world/core observations.

## Non-Goals

- This crate is not the protocol decoder.
- This crate is not the transport/session owner.
- This crate should not regress into model-owned router code just because a flow touches many
  fields.

## Dependencies

- **`holtburger-common`**: GUIDs, math, positions, properties, shared traits.
- **`holtburger-protocol`**: decoded message/event types.
- **`holtburger-dat`**: DAT-backed lookup tables and resource providers.


Explicit `StickToObject` intent is owned by the existing body motion runtime alongside action lifetime. Fresh accepted network commands and successful Sticky MoveTo completion admit it; snapshot sampling does not renew it. Before physical collection, world samples target pose, scaled authored setup radii, pursuit rate and actor-to-target heading once. Target loss cancels the intent. Supported eligible character bodies use that request through ordinary hard navigation and contacts; fixed/passive/airborne bodies retain their existing motion policy. The same prepared heading updates the command timeline, so ending pursuit does not restore an obsolete heading. Positional reconciliation remains translation-only.

Sticky ordinary translation is derived from the independent reference origin and shared by nominal prediction and actual actuation. Computing it from a blocked actual body would advance the reference indefinitely. Attack playback and hooks continue independently while sticky replaces horizontal authored travel. Remote actor skill data is not generally available, so the source uses the retained run multiplier (initially one) for unadjusted pursuit capacity, rather than the attack playback rate. Small supported-remote return errors use a retained 20 cm start / 5 cm stop band; dormant references do not prevent settling.

Local controlled-character locomotion may use an explicit `LocomotionPresentationSource::Command`
instead of accepted supported travel. Core resolves manual/autonomous drive channels through the
same command-to-motion-order mapping as manual authored playback. It samples the visual order before
collision admission; world applies final support/charge selection and existing action/transition
priority. Commanded gait can therefore continue against a wall, ledge, or resisting mobile body.
Release/expiry returns to observed locomotion. Remote entities retain observed travel; free-flight
bodies do not request character presentation. This changes neither root motion nor hook advancement,
physical velocity, collision admission, or the number of playback cursors.

### Entity contact eligibility

`EntityDynamicCollisionPolicy::contact_with` resolves each directed pair as ignored,
observable, or blocking before geometry queries. Physical response (including hard support,
resistance, separation, and recovery) requires blocking; reports also admit observable contacts,
subject to existing report permissions. Solidification checks the prospective solid policy.

`PlayerCollisionStatus` is normalized from public description flags and retained independently
from physics-state policy. Ordinary players ignore one another; matching PK or PKLite flags, or
an impenetrable player, permit collision. `Entity::set_property` applies retail's complete PK
flag replacement for admitted `PlayerKillerStatus` updates. World mutation updates installed
contact identity without changing geometry, motion, or sampling. Client body installation joins
current identity after asynchronous content preparation, so in-flight status updates are not lost.
Physics-state reconfiguration preserves this identity. Explorer-authored objects carry no public
player identity; possession alone does not turn a creature into a network player.

Authored staticness is distinct from sleeping, frozen, or excluded integration. An ethereal mover
can be obstructed by solid static targets but not non-static targets. Ethereal targets remain
observable and nonblocking; suppressed and missile targets are excluded. No nonzero client
`OBJECTINFO::targetID` producer was found in the available retail decompile: projectile filtering
implements the demonstrated untargeted case, without inferring targets from attacks or pursuit.
Mob/mob overlap relaxation remains the accepted approximate model, independent from eligibility.

Full `UpdateObject` messages follow the existing create/replacement lifecycle, matching retail's
explicit force-recreate operation (`acclient.c:140101,139601`). They may introduce an unknown
object and replace an existing description. They are not semantic-only updates and need not
preserve motion. PK property updates do preserve it. Property ordering and deletion admission
remain owned by the existing transport/world lifecycle; this policy adds no independent sequence
tracking. Once a pair becomes exempt it produces no fresh touches; existing collision reports
end through the established expiry rule.
