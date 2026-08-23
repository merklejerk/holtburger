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
- authoritative player-entity helpers such as `set_player_position()` and `set_player_vector()`

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
- Static-shadow bounds can cross at most one source owner in the shipped-content census. Coverage
  therefore requires a one-landblock source halo around every owner touched by a swept sphere. The
  Explorer currently requests a radius-two simulation-interest neighborhood so a sweep touching its
  first neighbor still has that complete source halo. Application policy owns that request; render
  interest and registered bodies cannot alter it.
- BSP planes and polygons transform into landblock-local query space. The body sphere remains
  spherical even for non-uniformly scaled SetupModel parts.
- `solve_free_sphere` is an explicit bounded operation over one requested displacement. It owns no
  gravity, support, walkability, step, slope, or ledge behavior and never runs implicitly from
  `tick()`. Registered physical-fly bodies and unregistered kinematic controllers call it
  explicitly; the solver neither owns their lifecycle nor distinguishes their purpose.
- `solve_grounded` is a separate bounded response over one required lower/support sphere and one
  optional upper/constraint sphere. It alone owns gravity, walkability, the committed ground
  state, one next-substep sliding normal, and achieved velocity. A solve-local set counts distinct
  encountered planes for diagnostics but cannot influence motion. The upper sphere participates in
  obstruction and placement but cannot become support or choose the committed cell.
- The ground state is retail's two-threshold model: a walking body settles through the ordinary
  step-down against the strict walkable threshold, while a body without walkable support runs the
  lenient 0.04m landing probe (cos-85° acceptance) every tick. A landing between the thresholds
  commits `GroundState::Sliding` — the contact plane is retained for classification and reporting
  while motion stays ballistic (gravity retained, no friction), mirroring retail's
  `Contact && !OnWalkable` transients. The walking threshold is re-derived from the committed
  contact plane, so slides settle to walkable support where the surface flattens and release to
  airborne when the plane falls out of the landing probe's reach.
- Grounded step-up and step-down are separate, non-recursive operations over a shared vertical
  settle/placement primitive. A raised candidate is confirmed against both spheres before commit;
  a failed candidate cannot leak pose or contact state.
- Finite support may carry an inward boundary normal. Creature edge protection consumes it to
  preserve elevation and tangent motion, while unprotected response accepts the unsupported pose.
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
- `SpatialBody.velocity` is the only retained linear-velocity authority. Grounded actuation may
  carry one resolved launch and one control heading, but it cannot retain a competing fall velocity
  or replay a launch on later ticks. Airborne drive preserves existing planar velocity while gravity
  and collision response update the canonical vector.

Collision integration uses an anchor landblock's local coordinates across one solve. It does not
accumulate large absolute-world `f32` coordinates; doing so produced measurable centimeter-scale
drift at `0xDA55FFFF`. Owner-local conversion occurs only at collision lookup and pose commit.

#### Dynamic entity bodies

Dynamic entities extend the same scene without a second store or solver:

- Every world-placed dynamic entity keeps exactly one `SpatialBody` that owns its world pose.
  `SpatialBody::physical` is optional collision/physics state, and `set_dynamic_physical_body`
  adds, removes, or reconfigures it reversibly. Disabling solver participation never retires the
  pose body, and compatible movement geometry preserves contact/placement response memory.
- An attached entity instead carries `EntityPlacement::Attached(PhysicsAttachment)` and has no
  `SpatialBody`: its parent GUID, named holding location, and own placement pose delegate transform
  authority to the parent's part hierarchy. `EntityPlacement::World(W)` carries the complete
  layer-specific motion composite, so velocity/contact/sampling facts cannot coexist with an
  attachment.
- `SpatialScene` owns every derived membership. Coarse landblock membership and the dynamic
  shadow index are updated inside registration, pose commit, physical-state replacement,
  relocation, and removal, so no caller choreographs a second index and no `entity_poses` mirror
  exists.
- Scheduling eligibility comes from the effective `PhysicsState`; solver activity is separate. A
  body settles after one accepted tick with walkable support, canonical zero velocity/omega, no
  acceleration or drive, and no pending response or path. Settling skips integration and
  mover-side queries only: pose, index membership, target geometry, report lifetimes, and
  presentation all remain live, and every state-changing input wakes the body explicitly.
- Dynamic peers are discovered through the same spatial domains as static collision — global 24 m
  outdoor cells and exact reached EnvCells — queried once over full swept conservative bounds so a
  fast or cell-crossing mover cannot miss a target. Each directional pair then proves contact with
  bounded adaptive slices of both bodies' planned transforms sampled from one immutable tick-start
  snapshot; an over-budget solve is an error that rejects before any pose, response, or report
  commits.
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
- `MotionRuntimeRegistry` holds per-body playback for one authority, and `actuation.rs` converts a
  tick's authored offset into the solver's drive basis.

Playback is _not_ frontend animation. Only simulation-relevant facts live here; articulated part
frames never enter this crate.

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

Compact entity motion snapshots now follow this rule too: `holtburger-world` owns the authoritative
per-entity motion snapshot and emits state events when that snapshot changes. Consumers may project
or render from those events, but the motion snapshot itself remains world-owned state.

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
