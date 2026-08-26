# Holtburger 3D Client Mode Implementation Plan

Status: active; Phase 0 complete.

## Context and Boundaries

### Goal

Build the first playable network-client mode in `apps/holtburger-3d` by connecting the existing
authoritative Rust client runtime to the proven frontend presentation pipeline, while preserving
separate Explorer and client authorities and separate producer adapters.

### Why this milestone is deserved

The Explorer has now proven the expensive, fidelity-sensitive half of a replacement client:
content discovery, outdoor and interior streaming, scene realization, portal visibility, dynamic
appearance, animation, authored effects, particles, audio, lighting, map geometry, and WebGL2
rendering. The repository also already has a functioning network client in `holtburger-core`, an
authoritative `WorldState`, client-side prediction, semantic commands, and a focused
`DynamicEntityEvent` projection shared with the Explorer.

The missing product is composition rather than another renderer. Client mode must connect those
two implemented halves without treating the Explorer registry as a fake server, moving client
authority into TypeScript, or forking the presentation pipeline. This is also the first concrete
consumer that justifies removing Explorer vocabulary and construction policy from code that is
otherwise shared.

### First-cut product slice

The first cut is complete when a user can:

1. launch the client route with TUI-shaped server, account, and password command-line arguments;
2. connect automatically from that launch configuration;
3. see the existing characters returned by the server;
4. select one character and enter the world through an explicit action;
5. render that character, nearby dynamic entities, and streamed outdoor or EnvCell content;
6. move the local character with basic walk/run/turn controls;
7. view the character through a collision-safe third-person camera; and
8. disconnect or close the application without leaking the client task, host work, audio, workers,
   or GPU resources.

This slice is intentionally render-first. It proves the server-to-world-to-projection-to-renderer
path and the reverse input-to-core-to-server path before the client grows broad game UI.

### In scope

- Select an explicit Explorer or client host mode when launching the sidecar.
- Parse client login configuration in the Electron main process from TUI-shaped `--server`,
  `--host`, `--port`, `--account`, and `--password` arguments, then start the client automatically.
- Keep launch credentials out of the renderer, route URL, retained state, and sidecar process
  arguments; send them once to the client host over the existing private host pipe.
- Give client mode a dedicated Rust composition root around `holtburger_core::ClientRuntime`.
- Preserve separate Explorer and client semantic, spatial, and lifecycle authorities.
- Preserve separate producer adapters that project each authority into the shared focused dynamic
  presentation contract.
- Split shared content, Explorer, and client command/event capabilities at the app-local host
  boundary.
- Add the smallest typed client lifecycle, character-selection, viewer, and control protocol needed
  by the first cut.
- Rename the frontend `GameRuntime` to describe presentation ownership honestly.
- Remove `spawned` and Explorer vocabulary from shared frontend presentation mechanisms where the
  client becomes a second consumer.
- Extract shared frontend presentation construction, frame sequencing, and teardown from
  `ExplorerApp.svelte` only where both modes consume the result.
- Reuse the existing focused `DynamicEntityEvent` contract and frontend mirror for client entities.
- Publish client-owned `Advanced` batches from the authoritative client simulation clock so remote
  dead reckoning, local prediction, corrections, presentation interpolation, and the later camera
  boom share one ordered tick basis.
- Drive render scene interest from the authoritative local-player residency selected by client
  mode.
- Drive regional time presentation from server-synchronized time.
- Route basic frontend character input into the shared semantic character-drive contract.
- Audit and replace the TUI-era local movement approximation where it disagrees with proven retail
  behavior or the richer possession pipeline; preserve only its defensible client command,
  sequencing, and packet-cadence responsibilities.
- Remove the minimal `SpatialPhysics` callback from `SpatialScene`; make client simulation invoke
  the existing world-owned transactional physical-body solver over an injected immutable collision
  snapshot.
- Give both desktop and TUI clients the same core-owned collision coordinator and full
  `SpatialScene` tick path.
- Give the client one canonical spatial/body authority while adding content-backed static
  collision; do not insert the Explorer `HostSimulationRuntime` beside `WorldState`.
- Reuse the full solver already implemented by `SpatialScene::tick_*_physical_body_transaction`;
  extract only collision-product coordination and duplicate basis-to-actuation conversion from
  Explorer-local orchestration where two consumers justify it.
- Adapt the shared kinematic-boom behavior to the client-owned player path without routing it
  through Explorer possession.
- Add focused unit, protocol, lifecycle, presentation-harness, and live-client verification.
- Update the app architecture documentation after the clean cutover lands.

### Out of scope

- Character creation, deletion, or restoration UI.
- Inventory, equipment, vendors, trade, fellowship, allegiance, spell, skill, crafting, or combat
  interfaces.
- Chat UI or social-channel management.
- Target selection and interaction UI beyond what is required to enter and move through the world.
- Shipping jumping in the first playable slice unless movement convergence proves it is
  inseparable from the selected controller and solver contract. The audit includes jump readiness
  and airborne actuation so the new boundary does not preclude the already richer character-jump
  design.
- A finished HUD, options screen, map placement, accessibility pass, or persistent preferences.
- An in-app connection form or account/server editor.
- Automatic reconnect, credential persistence, account management, launcher integration, patching,
  telemetry, or crash reporting.
- Sticky-object correction and other interpolation contributors without a first-cut producer.
  Server interpolation offsets and dead-reckoning constraint damping are in scope.
- Locally applying full physical solves or dynamic-contact response to server-authoritative remote
  entities. The first cut dead-reckons their authoritative motion and physically solves only the
  local player against static collision; remote contact behavior requires separate retail evidence.
- Reusing the entire TUI reducer, `ClientViewEvent` inventory, or frontend state model.
- Serializing Rust `ClientViewEvent` wholesale across the Electron protocol.
- A universal Explorer/client host superclass, a single union authority, or a mode flag inside the
  presentation runtime.
- Rewriting `holtburger-core` networking or world authority in TypeScript.
- Running the interactive TUI for verification.

## Ground Truth

### Repository evidence

- `crates/holtburger-core/src/client/runtime.rs` owns the network receive loop, semantic command
  ingestion, movement cadence, world advancement, timeout handling, and client view publication.
- `crates/holtburger-core/src/client/builder.rs` assembles `WorldBootstrap`, connects the session,
  injects the current minimal `SpatialPhysics`, and constructs the authoritative `WorldState`. Only
  the TUI and tests use this injection today.
- `crates/holtburger-core/src/client/movement/system.rs` currently combines semantic drive state,
  movement packet sequencing/cadence, server-controlled projection, and local prediction input.
  Its manual local solve reduces `CharacterDrive` to velocity and omega before physics, including
  fixed lateral and backward magnitudes. This implementation was built for the TUI's minimal solver
  and is evidence to audit, not the movement model to preserve by default.
- `crates/holtburger-core/src/client/simulation.rs` clones a physics callback stored inside
  `WorldState.scene`, passes that same scene back into the callback, then applies the returned batch
  to the scene. This callback-into-owner cycle is specific to the minimal client adaptation and is
  not how the production solver commits bodies.
- `crates/holtburger-world/src/spatial/physics.rs` currently provides `BasicSpatialPhysics`, which
  advances velocity, authored offsets, or direct local-drive projection without content-backed
  static collision. `NoopSpatialPhysics` has no live consumer, and the only other implementation is
  a builder test marker.
- `crates/holtburger-world/src/spatial/scene.rs` already owns the production solver entrypoints:
  `tick_physical_body_transaction` and `tick_dynamic_physical_body_transaction` solve against an
  immutable `CollisionScene`, allow semantic acceptance, and atomically commit the tentative body.
  Explorer calls these methods through `HostSimulationRuntime`; the algorithm is already shared and
  does not need extraction from the app host.
- `WorldState::reconcile_authoritative_body` currently registers authoritative client entities as
  pose bodies. No client code calls `prepare_dynamic_entity_physics`, so there is no validated
  `PhysicalBodyDefinition` for the full solver to consume; a later `SetState` cannot enable
  participation because the body has no prepared replacement.
- `crates/holtburger-world/src/motion/actuation.rs` already converts exact authored root-motion
  offsets into grounded physical actuation at the solver boundary. This is a stronger shared basis
  than re-deriving approximate manual velocities in `MovementSystem`.
- `crates/holtburger-core/src/client/types.rs` defines the broad `ClientState`, `ClientCommand`, and
  `ClientViewEvent` surfaces used by the TUI. These are an authority-facing application API, not an
  Electron wire format.
- `crates/holtburger-core/src/client/dynamic_entity_view.rs` already projects client `WorldState`
  facts into the source-neutral `DynamicEntityView` and emits the same focused
  `DynamicEntityEvent` grammar consumed by the Explorer frontend. Its tests prove equal client and
  Explorer projection for equal facts.
- The client projector currently emits `Snapshot`, `Upserted`, and `Removed`, but never
  `DynamicEntityEvent::Advanced`. The source-neutral frontend mirror consumes `Advanced` placed
  paths, and Explorer delivery is currently their only producer. A client that only forwards
  upserts therefore cannot reuse the proven interpolation path for continuously moving entities.
- `ClientRuntime::run` already owns the client simulation clock: one 30 ms interval advances
  movement, world dead reckoning, and client simulation in order. The client advance producer must
  publish after that turn from authority-owned tick-start/result facts. The app host must not run a
  second client fixed clock or synthesize authoritative movement from unrelated event arrival times.
- `apps/holtburger-cli/src/bin/tui.rs` is the working composition precedent for content discovery,
  `ClientRuntimeBuilder`, login, listener-before-command setup, character-list bootstrap, command
  channels, and the client task. It is reference code only; client mode does not import its UI
  policy or run the interactive executable.
- `apps/holtburger-3d/host/src/runtime.rs` currently calls itself shell-neutral while eagerly
  constructing the Explorer catalog, registry, simulation, possession, camera boom, physical
  flight, and fixed-tick participants for every route. This composition must split before client
  authority is added.
- `apps/holtburger-3d/host/src/protocol.rs` currently has one closed command union and one dispatcher
  over the Explorer-composed host. Its framing, bounded writer, structured response, handshake, and
  shutdown mechanics remain useful.
- `apps/holtburger-3d/electron/main.ts` already knows the selected `explorer` or `client` entry but
  starts the same host without passing that mode and allowlists the same commands for both.
- `apps/holtburger-3d/src/lib/host/host-transport.ts` currently imports Explorer types into the
  nominally shared transport and exposes one combined command/event inventory.
- `apps/holtburger-3d/src/explorer/explorer-dynamic-entity-session.ts` combines a reusable focused
  snapshot/delta hydration lifecycle with Explorer-only catalog, mutation, fixed-tick, possession,
  and diagnostics commands. The second client consumer now justifies separating those roles.
- `apps/holtburger-3d/src/lib/game/runtime/dynamic-entity-feed.ts` already contains the strict wire
  decoder and source-neutral `DynamicEntityMirror` needed by both modes.
- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts` owns presentation realization and
  rendering rather than network gameplay authority. Its `spawnedDynamic*` vocabulary and several
  Explorer diagnostic comments conceal an otherwise reusable consumer.
- `apps/holtburger-3d/src/explorer/ExplorerApp.svelte` currently composes content bootstrap,
  WebGL/device construction, presentation runtime construction, static streaming, dynamic feed,
  environment, cameras, simulation interest, frame sequencing, diagnostics, panels, and teardown
  in one component. Client mode must not copy this component.
- `apps/holtburger-3d/src/client/ClientApp.svelte` is intentionally a static route shell and owns no
  runtime behavior yet.
- `apps/holtburger-3d/host/src/host_simulation_runtime.rs` owns collision-product loading, immutable
  collision snapshots, an Explorer-local `SpatialScene`, and transactional full-solver invocation.
  Those responsibilities must be separated: its full solve capability is reusable, but the runtime
  must not become a second client body authority beside `ClientRuntime.world.scene`.
- `apps/holtburger-3d/host/src/explorer_possession_control.rs` and
  `apps/holtburger-3d/host/src/explorer_entity_runtime.rs` exercise the richer shared
  `CharacterMotionController`, `CharacterDrive`, authored root motion, grounded actuation, and jump
  resolution. They are evidence for convergence, not assumed-correct replacements for retail
  behavior.
- `ClientRuntime::emit_initial_view_state_snapshot` currently republishes dynamic entities, runtime
  bodies, fellowship, vendor, and trade state, but omits client status, character selection,
  local-player identity, world name, and synchronized time. The TUI coalesces broadcast lag into
  `RequestInitialViewState`, but that command cannot currently reconstruct a lost character-list or
  lifecycle event. World name remains outside the new desktop snapshot unless a first-cut UI
  consumer is added; the other omitted facts already have named consumers.
- Character entry is currently split across reusable core behavior and TUI policy: selecting sends
  `CharacterEnterWorldRequest`; after `CharacterEnterWorldServerReady`, the TUI sends
  `CharacterEnterWorld`. `ClientRuntime` already owns the selected GUID and account, so the second
  protocol step belongs in core rather than either frontend.
- `WorldState::current_server_time` silently substitutes local wall-clock epoch time before the
  server sync arrives. Client environment selection needs an optional synchronized-time projection;
  treating that fallback as server authority would select plausible but false regional time.
- `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md` explicitly requires separate Explorer
  and client producer registries over shared projection contracts, with no universal runtime base
  class.
- `docs/plans/holtburger-authored-root-motion-physics-integration-plan.md` records the client-mode
  tripwire for the two current solver adaptations plus deferred server interpolation offsets and
  dead-reckoning constraint damping. This milestone fires that tripwire.
- `docs/plans/holtburger-3d-active-region-data-pipeline-plan.md` establishes that client mode changes
  the environment-selection producer, not the static regional or rendering contract.
- `docs/plans/holtburger-host-owned-kinematic-boom-camera-plan.md` and
  `docs/plans/holtburger-possession-camera-projection-clearance-plan.md` establish the reusable
  kinematic-boom behavior and frontend controller boundaries. Client mode supplies a different
  authoritative actor adapter; it does not inherit Explorer possession.

### Authoritative external references

Implementation work that changes AC protocol, movement, interpolation, placement, or camera behavior
must prove its decisions from the repository references rather than this plan:

- `ACE/Source/ACE.Server` is the server-side source of truth for login, character entry, object
  creation/update, movement, and authoritative state behavior.
- `acclient-eor-source/acclient.c` is the primary client-behavior reference for input interpretation,
  prediction, interpolation, correction, camera behavior, residency, and presentation timing.
- `ACViewer/ACViewer/Physics` and `ACE/Source/ACE.DatLoader` are supporting references for content,
  animation, setup, and physics interpretation.

No new protocol behavior is guessed from what looks plausible in the Explorer.

## North Stars

1. **Authority and production are separate decisions.** An authority owns canonical state; a
   producer projects that state for a consumer. Sharing the projection contract does not merge the
   authorities that feed it.
2. **One client, one world authority.** Server state is mirrored and reconciled by
   `ClientRuntime`/`WorldState`; the frontend and app host do not advance a competing entity store.
3. **Presentation is downstream and forgetful.** The frontend owns realized scene, resources,
   animation/effect presentation, visibility, and drawing. It never becomes gameplay or collision
   authority.
4. **Modes share capabilities, not a base runtime.** Common content and presentation components are
   composed by two explicit mode roots. Mode conditionals do not leak into shared runtime internals,
   and a newly shared mechanism gets a clean source-neutral cutover rather than a compatibility shim.
5. **The first vertical slice stays narrow.** Every command, event, field, panel, and abstraction
   must have a consumer in connect, select, enter, render, move, camera, or shutdown behavior.
6. **Derived identity is computed once.** The client authority names the local player and publishes
   that identity. The frontend does not search the entity feed or infer the player from properties.
7. **Authoritative residency drives demand.** Client scene and collision interest follow the
   producer-projected local-player placement, never coordinate-only frontend containment guesses.
8. **Frontend input is intent.** Core owns command arbitration and protocol cadence; world owns
   character actuation and physical solving; the frontend owns keys, gestures, and camera UX. No
   layer independently re-derives speed, authored motion, or accepted displacement.
9. **One full solver, multiple authorities.** `SpatialScene` owns the transactional physical-body
   solver. Explorer and client retain different scenes and collision-interest policies, while
   desktop and TUI clients share one core simulation composition over `WorldState.scene`.
10. **One client clock, staged products.** `ClientRuntime` clocks movement, world advancement,
    solving, and focused `Advanced` publication in one ordered turn. Collision discovery/loading and
    immutable snapshot replacement stay outside that deterministic tick; no second host clock or
    silent fallback invents authority.

## Authority, Producer, and Consumer Model

The target architecture has three different roles. They must not be collapsed into one generic
“runtime” concept.

| Domain                                | Explorer authority                                                         | Client authority                                                                | Producer adapter                                                                | Shared consumer                                   |
| ------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------- |
| Entity identity and semantic lifetime | `ExplorerEntityRuntime` registry                                           | Server state mirrored by `ClientRuntime`/`WorldState`                           | Explorer delivery or core client projection                                     | Focused dynamic mirror and presentation runtime   |
| Body pose and spatial membership      | `HostSimulationRuntime` Explorer scene                                     | `WorldState` spatial scene, prediction, and server reconciliation               | Each mode joins its semantic and body authority into `DynamicEntityView`        | Scene-node placement and renderer presentation    |
| Current motion/clip selection         | Explorer possession and motion runtime                                     | Core/world motion state derived from server and local-player intent             | Each mode publishes `playingClip` in the focused view                           | Frontend animation/effect presentation            |
| Static content                        | `ContentRepository`                                                        | `ContentRepository`                                                             | Shared host-content projection/command handlers                                 | Commit pipeline and presentation runtime          |
| Render scene interest                 | Explorer camera/focus policy                                               | Client local-player residency policy                                            | Mode-local scene-target coordinator                                             | Shared layer planning and realization             |
| Collision interest                    | Explorer app simulation-interest policy                                    | Client-host policy following the authoritative player body                      | Mode-local collision snapshot owner                                             | The mode's sole body authority                    |
| Physical solve algorithm              | Explorer-owned `SpatialScene`                                              | `WorldState.scene`                                                              | World-owned transactional `SpatialScene` tick over a mode-owned snapshot        | Committed body plus placed-motion/result events   |
| Environment selection                 | Explorer manual/follow-clock selection                                     | Server-synchronized client time and future weather state                        | Mode-local environment input producer                                           | Shared environment resolver and renderer          |
| Character movement                    | Explorer possession command/controller and Explorer body scene             | Client command/protocol executor plus `WorldState` body scene                   | Shared character controller resolves one drive into authored physical actuation | Authority-owned body result and presentation feed |
| Camera placement                      | Explorer frontend owns desired controls; host boom owns accepted placement | Client frontend owns desired controls; client-host boom owns accepted placement | Mode-local camera controller publishes the accepted primary view                | Presentation runtime and camera-facing UI         |
| Diagnostics                           | Explorer panels and harnesses                                              | Focused client connection/runtime evidence                                      | Mode-local diagnostic readers                                                   | No shared product authority                       |

The critical dynamic-entity flow is:

```text
ExplorerEntityRuntime + HostSimulationRuntime
        │
        └── ExplorerEntityDelivery ──────┐
                                         │
                                         ├── DynamicEntityEvent
                                         │        │
ClientRuntime + WorldState               │        ▼
        │                                │  DynamicEntityMirror
        └── core client projector ───────┘        │
                                                  ▼
                                      GamePresentationRuntime
```

`DynamicEntityEvent` is a reconstructible presentation projection. It is not an authority bus,
command bus, replay log, or shared mutable entity store.

## Target Composition

### Rust sidecar

```text
holtburger-3d-host executable
├── parses required --mode=explorer|client
├── discovers SharedHostContent once
├── constructs exactly one mode runtime
│   ├── ExplorerHostRuntime
│   │   ├── Explorer registry and driver
│   │   ├── Explorer scene/interest orchestration over world solver transactions
│   │   ├── Explorer fixed ticks, possession, boom, and physical fly
│   │   └── Explorer producer adapter/events
│   └── ClientHostRuntime
│       ├── launch/connect/selection/world lifecycle
│       ├── holtburger_core::ClientRuntime task and command channel
│       ├── client WorldState as sole entity/body authority
│       ├── authority-clocked advance batch and client delivery adapter
│       ├── core client collision coordinator and WorldState scene transactions
│       └── local-player boom adapter
├── dispatches shared content commands through SharedHostContent
├── dispatches only the selected mode's commands
└── publishes only the selected mode's events
```

`SharedHostContent` is a capability and resource owner, not a base host runtime. The concrete mode
runtimes may both hold it without inheriting each other's entity, simulation, camera, or lifecycle
fields.

### Electron and host protocol

Electron already resolves the entry name. It passes that exact name to the sidecar and selects the
matching frontend command/event allowlist. The host handshake returns its selected mode so a launch
mismatch fails before the renderer can issue commands.

For client mode, Electron main also parses the launch-only login arguments. It passes one typed
startup value to `ClientHostRuntime` over the private sidecar protocol after the mode handshake and
does not expose that command through preload or renderer command unions. This keeps the password
out of the URL and avoids duplicating it in the sidecar's process arguments. It cannot hide the
password from the launching process list: accepting `--password` is an explicit first-cut security
concession inherited from the requested TUI-shaped invocation. Credential-file, environment,
keychain, and prompt mechanisms remain follow-ons rather than dormant abstractions.

The logical protocol inventory is split into:

- shared content commands: active region, landblock batches/profiles, sky, textures, animation,
  dynamic visuals, scripts, emitters, audio, sound tables, particle meshes, and motion closure;
- Explorer commands/events: catalog, entity scenarios, Explorer simulation interest, possession,
  free/physical flight, Explorer fixed ticks, and Explorer diagnostics;
- privileged Electron-main client startup: one launch configuration containing resolved host, port,
  account, and password, unavailable to the renderer;
- renderer client commands/events: select/enter, drive, disconnect, client lifecycle, character
  list, local-player identity/view state, focused dynamic presentation, and client camera state
  required by the first cut.

The MessagePack framing and response envelope remain shared. The Rust and TypeScript command unions
must make an invalid mode command unrepresentable where practical and rejected explicitly at the
host boundary regardless.

Do not put `ClientViewEvent` directly on the wire. Several variants are unrelated to the first cut,
some contain frontend-irrelevant domain values, and treating the enum as a public protocol would
freeze the TUI-facing core surface into the desktop adapter. `ClientHostRuntime` instead projects a
small app-local wire vocabulary whose fields each have a named frontend consumer.

### Client frontend

```text
ClientApp
├── ClientLifecycleSession
│   ├── launch-driven connection and authentication state
│   ├── character list and selection commands
│   ├── local-player identity
│   └── disconnect/fatal state
├── ClientDynamicEntitySession
│   └── shared focused snapshot/delta/advance hydration
├── ClientPresentationOwner
│   ├── shared content source adapters
│   ├── WebGL2Device and StandardCommitPipeline
│   ├── GamePresentationRuntime
│   ├── active region, sky, ambient, and static details
│   └── ordered teardown
├── client scene-interest/environment coordinator
├── client character-input and third-person camera controllers
└── client-local character screens and minimal status overlay
```

The client frontend owns cold reactive UI state and raw input. Presentation-rate player, camera,
entity, and renderer facts remain imperative snapshots as required by the app architecture rules.

## First-Cut Contracts

Phase 0 must settle exact names and fields, but the minimum semantic surface is constrained as
follows.

### Client lifecycle state

One discriminated client lifecycle value must cover exactly the states the frontend renders:

- connecting/authenticating;
- character selection with the server-provided existing character identities;
- entering world;
- in world with the exact local-player GUID;
- exiting after disconnect or fatal startup/runtime failure.

Do not encode interdependent booleans such as `connected`, `hasCharacters`, `enteringWorld`, and
`playerGuid`. A discriminated state makes impossible combinations unrepresentable. The first cut
does not model editable configuration or retry: a connection/login failure, server disconnect, or
fatal client-runtime failure is reported to stderr and terminates the Electron process with a
non-zero exit code.

Core exposes one genuinely reconstructible client application snapshot containing current status,
the current character list when known, local-player identity when known, synchronized server time
when known, dynamic entities, and runtime bodies. Edge-only failures and action results are not
replayed. `RequestInitialViewState` is replaced or renamed so its contract cannot be confused with
today's partial snapshot.

Character selection is one semantic frontend command. `ClientRuntime` owns the existing two-message
protocol choreography: it sends `CharacterEnterWorldRequest` for the selected GUID, observes
`CharacterEnterWorldServerReady`, and sends `CharacterEnterWorld` with its retained account. Neither
frontend sends the protocol follow-up. Client mode exposes an explicit Enter World action;
double-click and Enter may invoke that same action as convenience shortcuts, but selection alone
does not enter the world.

### Focused dynamic presentation

Client mode reuses the existing `DynamicEntityEvent` grammar and source-neutral projector. The code
already represents world and attached placement, stable snapshot order, appearance, motion clips,
and runtime-body pose. Phase 0's live census determines which server entity classes fail the
explicit WCID/name/setup/body projection gate. Missing coverage is fixed at the core producer that
owns the fact, not patched in the frontend mirror.

The client producer also publishes one ordered, nonempty `Advanced` batch after each in-world client
simulation turn with projectable world entities. It uses the runtime tick's host time and duration,
integrated paths for continuous local or dead-reckoned remote movement, and explicit teleport/reset
kinds for discontinuities. Path
facts come from tick-start and accepted authority results inside core; the app host does not
reconstruct them by sampling two unrelated poses. The later boom adapter consumes this same tick
batch after entity advancement rather than introducing a client-mode `HostFixedTickRuntime`.

Listener installation precedes the current-state request. A webview remount, declared lag, or
explicit reset invalidates deltas and requests one coalesced replacement application snapshot rather
than replay history. The current TUI pattern of continuing to accept deltas after an unknown gap is
not copied.

### Local viewer state

The client authority publishes the exact local-player GUID as part of the in-world lifecycle
contract. The app-host projection also publishes one monotonic world generation/discontinuity edge
for `RuntimeBodiesReset` and local-player `ForcedReposition`; presentation interpolation and camera
state consume it and reset before accepting subsequent placement.

The frontend may use the published GUID to select that entity's producer-projected placement and
the presentation runtime's corresponding live draw placement. It may not discover the player by
name, WCID, property pattern, insertion order, or proximity.

Static render demand follows producer-projected authoritative residency. Camera smoothing and
visual interpolation may read the presentation placement, but they do not feed back into content
or collision authority.

### Input and movement

The frontend sends semantic held-drive replacements through the `CharacterDrive` /
`ClientCommand::DriveSelf` path. Client-specific command arbitration translates that intent into
protocol edges, while the shared character-motion path resolves authored actuation for
the world-owned physical-body transaction. Neither the frontend nor `MovementSystem` independently chooses an approximate
per-frame velocity when authored motion supplies the physical fact. The frontend does not choose
`MoveToState` packet cadence, synthesize sequence numbers, or advance a local body.

Only the fields required for basic walk/run/turn controls cross the client host boundary. Jump
charge, attack, interaction, and automation commands stay absent until their first UI consumer.

### Environment

Client mode consumes the existing server-time synchronization produced by `ClientRuntime` and maps
it into the shared regional environment resolver. The client does not run the Explorer's manual
clock or day-group override state. Missing server weather protocol is explicit first-cut state; it
does not silently pretend an Explorer selection is authoritative. Before the first server-time sync,
the environment remains in a named loading/default presentation state rather than using local wall
clock as server time.

### Scene and collision interest

Render interest and collision interest are separate products over the same authoritative viewer
residency:

- the client frontend owns rendering-distance/product policy and submits resolved render demand to
  the shared presentation runtime;
- reusable client orchestration follows `WorldState` residency and owns collision-product policy
  for both desktop and TUI compositions;
- each mode owns its immutable collision snapshot lifetime while the shared full solver consumes
  that snapshot without owning asynchronous content discovery or the mode's bodies;
- neither infers an indoor transition from world coordinates when the authority already knows
  residency; and
- neither may load or evict the other subsystem's resources.

Render radii may reuse existing proven values, but they move out of the Explorer tuning namespace
only when the client becomes a real consumer. Client collision interest is independently bounded to
the 3×3 owner set justified in Phase 5. The first cut adds no adaptive streaming policy.

### Movement and physics convergence strategy

The convergence is compositional rather than a rewrite of every protocol-shaped movement producer
into solver-shaped actuation. Upstream movement facts retain their honest meaning until the physical
boundary:

- authored motion produces an exact body-local rigid offset for this tick;
- autonomous or server-controlled projection produces a desired world displacement, heading,
  and exact target hint;
- server position interpolation produces an authoritative correction offset that replaces authored
  drive for that tick, followed by dead-reckoning constraint damping of translation;
- retained momentum produces velocity and omega; and
- jump resolution produces a launch in addition to any supported planar movement.

A shared, stateless actuation resolver converts each proven basis into
`PhysicalBodyActuation` using the current body definition, pose, contact, object scale, and tick
duration. `authored_grounded_actuation` is the existing precedent for the authored-offset case. The
desired-displacement case needs its own named conversion because target projection is not authored
root motion, and neither case should be interpreted by dividing an unclassified delta by `dt`.

The production `SpatialScene` transaction consumes resolved physical actuation and an immutable
collision scene. It does not understand `MoveToState`, packet sequences, `CharacterDrive`, or
Explorer possession. Conversely, `MovementSystem` may continue to produce protocol-informed
projection facts where those are real client semantics; it does not own collision response.

Retail evidence already settles correction ordering: interpolation assigns the tick offset rather
than adding to authored root motion (`acclient.c:372004-372094`), then the constraint manager scales
or zeros translation after accumulated drift (`acclient.c:372268-372296`). Client mode is the first
real producer, so both are required movement-basis stages in this milestone rather than optional
presentation smoothing.

This boundary enables an incremental clean cutover:

1. adapt the existing client displacement, authored-offset, and velocity bases into actuation with
   behavior-preserving differential tests;
2. remove the minimal callback from `SpatialScene`, install the core collision coordinator, and call
   the existing full scene transaction from client simulation in both desktop and TUI compositions;
3. migrate manual character locomotion axis by axis from the approximate velocity path to the
   shared motion-table/authored path where retail evidence supports it; and
4. delete only adapters or input variants that no longer have an honest producer. A
   displacement-to-actuation adapter remains if autonomous/server projection still supplies a real
   desired displacement.

Avoid a general adapter trait until more than one actuation policy implementation exists. Prefer
small exhaustive functions over a closed input enum or composite request, so every basis has one
reachable conversion and unsupported combinations fail explicitly.

## Phased Implementation

### Execution schedule

The phases execute in dependency order, with relative size used instead of calendar estimates until
the host split and spatial-foundation cutover establish actual change volume:

| Step | Outcome checkpoint                                               | Relative size  | Prerequisites or schedule gates   |
| ---- | ---------------------------------------------------------------- | -------------- | --------------------------------- |
| 0    | Contracts and evidence sufficient to begin implementation        | Small residual | None                              |
| 1    | Two honest host compositions and private client launch arguments | Large          | 0                                 |
| 2    | Source-neutral presentation vocabulary                           | Small          | 0                                 |
| 3    | One shared frontend presentation owner                           | Medium-large   | 2                                 |
| 4    | Client host, lifecycle, and authority-clocked advance delivery   | Large          | 1                                 |
| A    | Composition and remaining-contract audit                         | Small          | 1, 2, 3, 4                        |
| 5    | Collision products and hydrated local-player body                | Large          | A                                 |
| 6    | `SpatialPhysics` removed; current bases use scene transactions   | Medium         | 5                                 |
| 7    | Launch-driven character-selection UI                             | Small          | 4; deliberately scheduled after 6 |
| 8    | Entered world renders through the shared advance path            | Medium         | 3, 4, 6, 7                        |
| 9    | Shared high-fidelity movement makes the slice playable           | Very large     | 5, 6, 8                           |
| 10   | Collision-safe client third-person camera                        | Medium         | 6, 8, 9                           |
| B    | Complete playable-slice audit                                    | Small          | 10                                |
| 11   | Cleanup, documentation, and final acceptance                     | Medium         | B                                 |

Phase 0 does not require a live entity census or encoded payload sample. Live ACE integration still
belongs to Phases 8 and 11, but a targeted census is added only if that verification exposes an
unexplained projection rejection or delivery-capacity problem. Phases 5 and 6 expose the spatial
risk before client UI and world-presentation integration without combining contract deletion,
collision loading, and body hydration into one review cliff.

### Phase 0: Prove the client vertical-slice contracts

#### Deliverables

- A checked lifecycle trace from connect through character list, selection, server-ready, enter
  world, local-player publication, teleport/reset, disconnect, and shutdown.
- A client `ClientViewEvent` census naming the exact events and fields consumed by the first cut.
- A focused dynamic-feed trace proving which entities are projectable, when snapshots/upserts/removes
  occur, how the local player is represented, and how teleports or resets are recovered.
- An authority-clocked advance-delivery contract proving how one client tick becomes ordered
  `Advanced` paths for local and dead-reckoned remote presentation plus later boom consumption.
- A render- and collision-interest ownership trace from authoritative local-player residency.
- A three-way character-motion trace across the TUI-era `MovementSystem`, Explorer possession, and
  retail/ACE behavior, naming which layer owns command arbitration, protocol cadence, authored
  motion, physical actuation, solving, and correction.
- A client simulation contract that resolves a closed per-body movement basis into
  `PhysicalBodyActuation`, reads one immutable collision snapshot, and invokes the existing
  transactional `SpatialScene` solver.
- A core-owned collision coordinator contract shared by desktop and TUI compositions, with async
  product loading, atomic snapshot replacement, authoritative-player interest, and explicit
  not-ready/unavailable state.
- A generation-guarded local-player body-hydration contract that prepares its content-authored
  physical definition off the network/simulation loop and installs it only if the same selected
  entity instance is still authoritative.
- Required server interpolation and dead-reckoning basis stages matching the already traced retail
  assignment-then-damping order.
- A client host command/event inventory with every field mapped to a named frontend consumer.

#### Task checklist

- [x] Trace the working TUI bootstrap code without running the TUI; codify the required command and
      event order in focused tests or a non-interactive harness.
- [x] Select `holtburger-debug-harness` or a dedicated non-interactive client harness for live ACE
      observations when mock/session tests cannot prove ordering or payload population.
- [x] Add focused tests proving the local player and attached entities enter a reconstructible
      dynamic snapshot.
- [x] Prove the event cadence used for remote motion, local prediction, forced reposition, and
      teleport reset; record which events are levels versus edges.
- [x] Specify the exact client tick-start/result facts, path construction, host-time/duration,
      generation guards, and publication order for `Advanced`; prove no second host interval or
      generic post-tick callback is required.
- [x] Identify every reason `project_client_dynamic_entity` rejects an entity and give every
      rejection a reachable asset-free fixture. Do not make missing fields up in TypeScript.
- [x] Specify the complete reconstructible client snapshot fields and lag state machine in focused
      fixtures, including which edge-only failures are deliberately not replayed.
- [x] Trace manual, autonomous, server-controlled, authored, airborne, and correction paths through
      `MovementSystem`; identify where source-neutral intent is prematurely reduced to approximate
      velocity/omega or independently re-derived.
- [x] Trace the same character drives through Explorer possession, including
      `CharacterMotionController`, authored grounded actuation, and jump resolution. Treat this as a
      richer implementation to validate against retail, not as ground truth by reputation.
- [x] Compare both paths against `acclient.c`, ACE handling, motion-table data, and existing focused
      differential fixtures. Record each retained divergence or retail-compatibility decision with
      the repository's marker convention when implementation begins.
- [x] Partition `MovementSystem` responsibilities into client command/protocol execution versus
      shared character actuation/physics. Name the destination and consumer of every moved field;
      do not create parallel controllers with synchronized state.
- [x] Specify the closed per-body movement-basis variants and their exhaustive actuation conversions,
      with a named producer and downstream consumer for every field.
- [x] Specify collision-coordinator state transitions for empty, loading, committed, superseded,
      unavailable, teleport, and shutdown cases; dry-run both TUI and desktop composition.
- [x] Turn the already traced retail interpolation assignment, constraint damping, and animation
      cursor behavior into asset-free differential fixtures before implementation.
- [x] Record the authority-clocked event-rate bound against the existing bounded sidecar queue; do
      not change its bounds without live payload evidence.
- [x] Dry-run all later phases and amend this plan wherever a field, event, abstraction, or phase has
      no reachable consumer.

#### Acceptance criteria

- Every proposed client wire field has a named first-cut consumer.
- Every validation failure has a concrete input that reaches it.
- The selected client lifecycle state machine represents all observed transitions without
  interdependent optional fields.
- No dynamic, placement, residency, motion, or local-player fact is guessed from Explorer behavior.
- The collision design retains exactly one client body authority.
- The target client simulation contract calls the canonical world transaction directly and retains
  no callback stored inside its owning scene.
- The target movement design computes each resolved actuation fact once and names all protocol,
  physics, presentation, and correction consumers.
- The target delivery design produces at most one nonempty advance batch per accepted client turn
  and classifies continuous movement, teleport, and reset without host/frontend pose resampling.

#### Decisions and course corrections

- The evidence pass established that the full solver already lives in `holtburger-world`; no solver
  algorithm is extracted from `HostSimulationRuntime`.
- The current `SpatialPhysics` placement is rejected: it is stored by `SpatialScene`, called with
  that same scene, has no production full-solver implementation, and conflicts with the scene's
  transactional commit API. The replacement injection seam is collision products/coordinator, not
  a swappable AC physics algorithm.
- Core absorbs the server-ready enter-world follow-up and exposes a complete reconstructible client
  application snapshot. Frontends consume semantic lifecycle state rather than protocol handshake
  edges.
- Retail server interpolation and constraint damping are required in this milestone because client
  mode supplies their first real producer; they are not deferred as optional visual smoothing.
- Focused evidence passed on 2026-08-26: the client/Explorer projector and focused snapshot/rejection
  tests (4), retail correction assignment/damping tests (3), retail character-motion differential
  tests (10), rejected scene transaction rollback, stable dynamic scheduling, and missing-EnvCell
  suspension.
- A live projection census and encoded payload sampling are optional diagnostics rather than Phase 0
  gates. The exact rejection inputs, authority-clocked rate bound, queue capacity, and frame-size
  ceiling are proved locally; later live integration follows evidence needs rather than a standing
  census requirement.

#### Phase 0 evidence ledger

This ledger is the binding input to later phases. Names here are target names; current TUI-facing
symbols are named separately when they differ. Later phases may change a target only by recording a
course correction and its consumer.

##### Lifecycle and bootstrap trace

The checked current order is:

1. discover content and assemble `WorldBootstrap`;
2. construct and connect `ClientRuntime`;
3. install the command receiver and subscribe to `ClientViewEvent` **before** spawning `run` or
   sending commands;
4. spawn the one client task, request current application state, then send `Login(password)`;
5. retain the latest status and synchronized time until `CharacterList` arrives;
6. an explicit Enter World action sends one semantic selected GUID; core records it and sends
   `CharacterEnterWorldRequest`;
7. ACE validates world availability and replies `CharacterEnterWorldServerReady`; core sends
   `CharacterEnterWorld { guid, account }` from its retained selection/account rather than
   publishing that protocol edge to either frontend;
8. `PlayerCreate` establishes the exact local-player GUID and sends login complete;
   `PlayerDescription`/`StartGame` makes the transition idempotent once that GUID is known, while
   the projected lifecycle remains entering-world if the GUID is not yet available;
9. `RuntimeBodiesReset`, `TeleportStarted`, and `ForcedReposition` create discontinuity edges while
   current lifecycle, current synchronized time, and current focused entities remain levels; and
10. explicit disconnect, transport loss, task failure, or sidecar shutdown closes command intake,
    stops the client task, closes event publication, and produces the first-cut process outcome.

Current proof points are `bootstrap_once`/`process_bootstrap_event` in
`apps/holtburger-cli/src/bin/tui.rs`, `ClientRuntime::run`, `ClientRuntime::handle_message`, ACE
`CharacterHandler.CharacterEnterWorldRequest`, and the existing server-ready/session tests. The
current TUI-owned `SendCharacterEnterWorld` follow-up is deliberately not preserved; Phase 4 moves
that already-required protocol step into core.

The target discriminated state is `ClientLifecycleState` with exactly these arms:

| Arm | Fields | Named consumer |
| --- | --- | --- |
| `Connecting` | none | client route connection status |
| `Authenticating` | none | client route authentication status |
| `CharacterSelection` | `characters: Vec<ClientCharacterSummary>` | character list and Enter World enablement |
| `EnteringWorld` | `character_guid` | selection screen progress and duplicate-submit prevention |
| `InWorld` | `player_guid` | viewer identity, scene interest, and input |
| `Exiting` | `cause: ClientExitCause` | terminal status plus Electron exit-status projection |

`ClientCharacterSummary` is exactly `guid`, `name`, `slot`, and `delete_time`. The list row consumes
`name` and stable `slot`, the Enter World command consumes `guid`, and pending-deletion presentation
and command disablement consume `delete_time`. No character-creation fields cross the desktop wire.
`ClientExitCause` distinguishes explicit disconnect, server disconnect, startup failure, runtime
failure, and host shutdown; diagnostic text stays redacted and Electron-main-owned.

##### First-cut `ClientViewEvent` census and reconstructible state

Core retains its broad application API, but the desktop adapter consumes only this census:

| Current event/fact | Fields consumed | Level or edge | First-cut consumer |
| --- | --- | --- | --- |
| `StatusUpdate` | `state` | level | lifecycle projection |
| `CharacterList` | `guid`, `name`, list index as slot, `delete_time` | level | character selection |
| `PlayerEntered` plus authoritative player state | `guid` | level | `InWorld.player_guid` |
| `ServerTimeUpdated` | `time` | level after first sync | regional environment clock |
| `DynamicEntity::{Snapshot,Upserted,Removed,Advanced}` | existing focused contract | reconstructible level/deltas | shared dynamic mirror |
| `RuntimeBodiesReset` | `cause` | edge | increment `world_generation`; replace focused state |
| `ForcedReposition` | `guid`, `pos`, `sequence` | edge | local-player reset classification and generation guard |
| `TeleportStarted` | `sequence` | edge | pending teleport classification; no replay |
| `ActionResult`, `BootAccount`, `Disconnected`, task result | typed cause, redacted diagnostic | edge | Electron exit policy |

`ClientApplicationSnapshot` is the core-owned replacement level with exactly: lifecycle status,
current character list when known, local-player GUID when known, synchronized server time when
known, one `DynamicEntitySnapshot`, and the current `RuntimeSpatialBodyView` snapshot for existing
core/TUI consumers. The desktop `ClientCurrentState` projection contains lifecycle, synchronized
server time, dynamic snapshot, and `world_generation`; it does not expose raw runtime bodies because
the focused dynamic view already supplies every first-cut presentation/body fact.

Listener installation always precedes `RequestClientApplicationSnapshot`. A receiver starts
`AwaitingReplacement`, ignores deltas, and coalesces one outstanding request. Installing a valid
snapshot moves it to `Current`. Declared broadcast lag, webview remount, `RuntimeBodiesReset`, or an
explicit reset returns it to `AwaitingReplacement`; it again ignores deltas until the replacement
arrives. Failure/action-result/teleport edges are not replayed. This replaces, rather than aliases,
the overstated `RequestInitialViewState`/`emit_initial_view_state_snapshot` vocabulary.

##### Focused dynamic delivery and advance contract

`project_client_dynamic_entity` joins one registered entity with WCID, nonempty name, setup DID,
finite positive scale, appearance/physics/radar/motion levels, and exactly one placement arm. A
world-placed entity requires its canonical runtime body and publishes pose, spatial membership,
kinematics, contact, sampling mode, and physical participation. An attached entity publishes only
parent GUID, parent location, and placement. The player uses the same entity projection; its special
identity comes only from `ClientLifecycleState::InWorld.player_guid`.

All six rejection inputs are now asset-free fixtures: unregistered GUID, missing WCID, empty/missing
name, missing setup DID, non-finite/non-positive scale, and missing canonical body. The focused tests
also prove stable snapshot order plus local-player and attached placement reconstruction. The live
census must measure how often each rejection occurs by server entity class; it may only add missing
producer facts or deliberately exclude a proven non-rendered class.

Each eligible in-world runtime interval owns one advance turn:

1. capture tick-start `DynamicEntityView` plus `DynamicEntityPathPoint` for each projectable
   world-placed generation;
2. run movement command/protocol cadence, world dead reckoning, then the local scene transaction;
3. collect accepted path legs from those authority operations, never by sampling before/after host
   events;
4. classify ordinary accepted integration as `Integrated`, an explicit newer teleport epoch as
   `Teleport`, and forced reposition/runtime reset as `Reset`;
5. create one `DynamicEntityAdvance` per changed, still-current GUID/generation, sort by GUID through
   `DynamicEntityAdvanceBatch::new`, and omit attached or removed generations; and
6. if the batch is nonempty, publish it once after upserts/removals for the turn. Phase 10 consumes
   this exact batch only after entity advancement for boom placement.

The batch uses the runtime's monotonic `dynamic_entity_time_origin` at accepted turn completion and
the same positive interval duration used by movement/world/simulation. Correction-only reset batches
may use zero duration as the existing contract permits. There is no host interval and no generic
post-tick callback. The 30 ms runtime interval bounds this producer to 33.34 advance frames/second;
the existing blocking writer queue holds 256 frames and the protocol caps each encoded frame at
16 MiB. No bound change is justified before the deferred live payload census measures entity counts
and encoded frame sizes.

##### Residency, collision, and local-player hydration

The `InWorld` GUID selects the matching focused world placement. Its canonical body pose and
`spatial_membership` are the only viewer-residency input. The frontend derives render products from
that published residency; core's client collision coordinator independently derives a normalized
3x3 collision-owner set from the same authoritative residency. Neither path guesses an EnvCell from
coordinates or reads the other's cache.

The core coordinator has the following exhaustive transitions:

| State/edge | Required behavior |
| --- | --- |
| `Empty` | no player residency or terminal teardown; no collision scene is claimably ready |
| `Loading { request, interest }` | async load outside network/simulation turns; prior committed snapshot remains immutable but is not paired with the new interest |
| load committed | atomically replace with `Ready { revision, interest, collision }` only when request and authoritative residency still match |
| superseded completion | discard by request generation; it never mutates the committed snapshot |
| `Unavailable { interest, cause }` | explicit missing/invalid content; local solve remains suspended |
| teleport/reset | invalidate readiness, derive the new authoritative interest, and start a new generation |
| shutdown | cancel/retire loading work, clear readiness, and publish no later completion |

Desktop and TUI inject content access into this same core coordinator. Each composition owns one
coordinator and one `WorldState.scene`; no coordinator owns or mirrors bodies.

Local-player physical preparation captures `(guid, entity_instance_generation, residency)` and
loads the content-authored `DynamicPhysicalBodyDefinition` off the runtime turn. Completion may call
`set_dynamic_physical_body` only if that exact tuple remains selected and the collision coordinator
has a complete revision for the same residency. The resulting `ClientSpatialReadiness` is one closed
value: `Waiting`, `Preparing`, `Ready { player_instance, collision_revision }`, or
`Unavailable { player_instance, cause }`. It references the canonical body definition rather than
copying it. Replacement, deselection, teleport, disconnect, and shutdown invalidate the generation.

##### Movement ownership and target simulation contract

The three-way trace assigns responsibilities as follows:

| Responsibility | Current TUI-era path | Explorer evidence | Target owner |
| --- | --- | --- | --- |
| held intent and edge ordering | `MovementSystem` queue/active drive | possession event queue | core client command arbitration |
| `MoveToState`, sequences, stop pulse, autonomous heartbeat | `MovementSystem` | none | core client protocol executor |
| axis/gait interpretation | fixed capability-to-velocity/omega reduction | `CharacterMotionController` plus motion tables | shared character controller validated against retail |
| authored root offset | world motion runtime, sometimes reduced by minimal solver | possession motion runtime | world motion runtime, consumed once at actuation boundary |
| grounded actuation | `LocalDriveControl` desired delta or `SolveProjectionBasis` | `authored_grounded_actuation` | small exhaustive world conversion functions |
| jump | protocol/transient pieces, no full client composition | shared jump resolver and grounded launch | shared resolver; first-cut UI remains absent |
| physical solve | `SpatialPhysics` callback into owning scene | direct transactional scene call | `SpatialScene::tick_physical_body_transaction` |
| correction/interpolation | sequence handling plus direct pose/projection paths | no server producer | core client correction basis before solver/presentation |
| presentation | upsert-only for continuous client motion | fixed-tick `Advanced` | authority-clocked core advance batch |

The current premature reduction is `MovementSystem::current_local_solve_body_input`: manual
`CharacterDrive` becomes approximate velocity/omega before authored motion or collision. Autonomous
and server-controlled paths separately turn desired displacement into `LocalDriveControl`, and
arrival/snap paths mutate runtime pose directly. Protocol cadence and sequence fields stay in
`MovementSystem`; axis resolution, authored actuation, jump launch, collision solving, and accepted
path construction do not.

The closed movement bases remain honest until the solver boundary:

| Basis | Producer | Exhaustive conversion | Consumer |
| --- | --- | --- | --- |
| authored rigid offset | motion runtime | `authored_grounded_actuation` | grounded scene transaction |
| desired world displacement + desired heading + target hint | autonomous/server projection | named displacement-to-grounded-actuation function using the one tick duration | grounded scene transaction |
| retained velocity + omega | canonical body/server kinematics | response-specific coast/free-flight conversion | scene transaction |
| authoritative interpolation offset | server position interpolation manager | replacement actuation offset, never added to authored drive | constraint damping then scene transaction |
| resolved jump launch | shared character jump resolver | attach one `GroundedLaunch` to the selected grounded actuation | scene transaction |

At most one planar basis is selected per body/tick; launch is a one-shot addition to grounded
actuation, not a competing planar basis. Invalid combinations fail at basis selection. Retail order
is assignment of interpolation offset over authored offset (`acclient.c:372004-372094`), then
constraint translation scaling/zeroing and accumulated-offset update
(`acclient.c:372268-372296`), then physical acceptance and animation cursor advancement from the
accepted path. Existing asset-free differential tests lock the assignment, damping thresholds,
cursor direction/window completion, support gate, authored actuation, and rollback behavior.

The target client simulation performs: select the one body basis; resolve one
`PhysicalBodyActuation`; read one immutable, matching collision revision; call
`WorldState.scene.tick_physical_body_transaction` directly; accept semantic/motion publication in
the transaction callback; commit once; then build the focused advance from the accepted result.
Remote bodies remain pose-only/dead-reckoned and never enter that local physical transaction in the
first cut.

##### Desktop client host inventory

The exact app-local inventory is deliberately smaller than `ClientCommand`/`ClientViewEvent`:

| Direction/name | Fields | Named consumer |
| --- | --- | --- |
| private `start_client` | `host`, `port`, `account`, `password` | Electron main to one `ClientHostRuntime`; password released after login send |
| renderer `request_client_current_state` | none | lifecycle/dynamic lag recovery |
| renderer `select_client_character` | `guid` | explicit Enter World action |
| renderer `replace_client_drive` | `gait`, optional `longitudinal`, optional `turning` | basic held walk/run/turn controller |
| renderer `disconnect_client` | none | explicit disconnect/close |
| event `client_current_state` | `lifecycle`, optional synchronized `server_time`, `world_generation`, dynamic snapshot | atomic mount/lag replacement |
| event `client_lifecycle_changed` | complete `ClientLifecycleState` | selection/in-world/terminal route state |
| event `client_server_time_updated` | synchronized `time` | environment clock |
| event `dynamic_entity` | existing `DynamicEntityEvent` | shared focused mirror/presentation |
| event `client_world_discontinuity` | `world_generation`, `kind` | clear interpolation and camera state before later placement |
| private `client_exit_requested` | typed cause plus redacted diagnostic | Electron non-zero/zero exit policy |

The drive wire deliberately omits lateral drive, turn-rate scalars, jump, attack, interaction,
packet cadence, and sequence numbers. World name is omitted because the first-cut UI has no
consumer. Raw credentials, `WorldState`, `Entity`, runtime bodies, session/UDP data, and the broad
client enums never cross the renderer boundary.

### Phase 1: Split host composition and mode capabilities

#### Deliverables

- A shared content owner extracted from the current `HostRuntime` composition.
- Explicit `ExplorerHostRuntime` and `ClientHostRuntime` composition roots.
- Required `--mode=explorer|client` sidecar selection passed from Electron's selected entry.
- Client-only Electron argument parsing matching the TUI login surface: `--server HOST[:PORT]` or
  `--host HOST --port PORT`, required `--account`, and `--password` defaulting to empty.
- A private, typed client-startup command from Electron main to the selected client host.
- A handshake carrying the selected host mode and an Electron-side mismatch check.
- Separate shared-content, Explorer, and client command/event inventories in Rust and TypeScript.
- Mode-specific Electron allowlists and protocol dispatch.
- Explorer behavior preserved with no client runtime constructed in Explorer mode and no Explorer
  registry/simulation constructed in client mode.

#### Task checklist

- [ ] Rename the current Explorer-composed `HostRuntime` honestly before introducing the client
      composition.
- [ ] Keep `HostContentState` discovery, content runtime, repository, and reusable command handlers
      in one shared capability owner.
- [ ] Move Explorer entity, simulation, possession, camera, physical-flight, and fixed-tick
      construction under `ExplorerHostRuntime` without changing their behavior.
- [ ] Add a `ClientHostRuntime` that owns no network task until Electron main supplies the one
      launch configuration through the private typed startup command.
- [ ] Parse and validate host mode before expensive content or runtime construction.
- [ ] Pass the already-resolved Electron entry to the child process without shell interpolation.
- [ ] Parse client login flags in Electron main, reject missing/duplicate/malformed values before
      startup, and resolve `--server` versus `--host`/`--port` with documented TUI-compatible
      precedence. Reject an invalid embedded port instead of copying the TUI's default-port fallback.
- [ ] Keep client login flags out of `buildEntryPath`, renderer query parameters, preload, renderer
      globals, and sidecar `argv`; send the validated composite value once over the private host
      pipe and release Electron's retained copy after startup settles.
- [ ] Do not add `--character` auto-entry in this slice; character choice remains visible client UI.
- [ ] Split protocol dispatch so a command unavailable in the selected mode returns a structured
      mode error even if a compromised renderer bypasses TypeScript types.
- [ ] Split `HOST_COMMAND_NAMES`, `HOST_EVENT_NAMES`, and payload maps into composable inventories
      without reintroducing one giant application union in consumers.
- [ ] Update sidecar smoke and protocol tests for both modes, startup mismatch, invalid command, and
      orderly shutdown.

#### Acceptance criteria

- Starting Explorer constructs no `ClientRuntime`, session, or client task.
- Starting client mode constructs no Explorer catalog, registry, possession, physical-flight, or
  Explorer fixed-tick participant.
- Shared binary content commands work in both modes through the same implementation.
- Electron and the host agree on mode before the renderer is allowed to issue requests.
- Client login arguments never become renderer-visible state or sidecar process arguments.
- Missing or malformed required client launch arguments fail before a network task or product
  window is retained.
- Existing Explorer browser and Electron verification remain green.

#### Decisions and course corrections

To be filled during execution.

### Phase 2: Cut over shared presentation vocabulary

#### Deliverables

- `GameRuntime` renamed to `GamePresentationRuntime`.
- `spawnedDynamic*` presentation vocabulary renamed to source-neutral `dynamicEntity*` vocabulary.
- Misleading Explorer comments and type names swept only where the surviving mechanism is already
  source-neutral.
- No construction, lifecycle, or behavior change.

#### Task checklist

- [ ] Rename the runtime and every shared consumer in one vocabulary sweep; retain no alias named
      `GameRuntime`.
- [ ] Rename spawned presentation maps, methods, diagnostics, tests, and comments that already
      accept authority-neutral dynamic views.
- [ ] Keep producer identity/generation in the dynamic contract; source-neutral naming does not erase
      lifecycle guards.
- [ ] Do not move Explorer policy modules merely to make the vocabulary grep cleaner.
- [ ] Run type checks, lint, focused tests, and the canonical Explorer browser-harness smoke as a
      standalone mechanical milestone.

#### Acceptance criteria

- The rename is behavior-free and leaves no compatibility alias.
- `GameRuntime` and source-neutral uses of `spawnedDynamic*` have no surviving consumers.
- Explorer presentation behavior and harness evidence are unchanged.

#### Decisions and course corrections

To be filled during execution.

### Phase 3: Make the frontend presentation owner genuinely shared

#### Deliverables

- A source-neutral focused dynamic-feed hydration owner separated from Explorer catalog,
  possession, fixed-tick, and mutation commands.
- A shared imperative presentation owner that constructs and tears down active-region sources,
  content sources, `WebGL2Device`, `StandardCommitPipeline`, presentation runtime, static details,
  sky, ambient facts, audio, and workers.
- `ExplorerApp.svelte` migrated to the shared presentation owner while retaining Explorer-only
  controls, cameras, scenario state, diagnostics, and panels.
- No client mode behavior yet beyond exercising the new shared construction in focused tests or the
  browser harness.

#### Task checklist

- [ ] Extract a source-neutral `DynamicEntitySession` that owns listener-before-snapshot hydration,
      delta invalidation after declared loss, and replacement-snapshot installation behind injected
      subscribe/request-current-state functions.
- [ ] Leave Explorer catalog search, spawn/despawn, possession, fixed-tick receipt, and diagnostics
      in the Explorer facade.
- [ ] Extract presentation construction and ordered teardown from `ExplorerApp.svelte` into small
      owners with explicit dependencies and no Svelte state.
- [ ] Keep frame-hot camera/entity/renderer facts imperative. Do not turn the extracted owner into a
      reactive store.
- [ ] Keep camera policy, environment selection, render settings selection, scene-interest target
      selection, and UI layout outside the shared presentation owner.
- [ ] Update misleading Explorer comments in shared asset sources, environment types, camera types,
      texture diagnostics, and tuning namespaces only where the second consumer makes the rename
      true.
- [ ] Verify Explorer startup, outdoor/EnvCell streaming, dynamic entities, possession, map, audio,
      and teardown through the canonical browser harness and focused Electron smoke.

#### Acceptance criteria

- The shared presentation owner can be constructed without importing `src/explorer`.
- The presentation runtime consumes dynamic views without knowing which authority or producer made
  them.
- `ExplorerApp.svelte` no longer directly owns low-level renderer/content bootstrap and teardown.
- Explorer UI/control policy remains in `src/explorer`; no generic mode controller is introduced.
- Shared presentation construction retains the source-neutral vocabulary established in Phase 2.

#### Decisions and course corrections

To be filled during execution.

### Phase 4: Compose the authoritative client host lifecycle and delivery clock

#### Deliverables

- `ClientHostRuntime` construction over discovered content and `ClientRuntimeBuilder`.
- A private typed launch/start command plus renderer-facing select-character, drive-self,
  request-current-state, and disconnect commands.
- An owned client command channel, client task, view-event receiver, and cancellation/shutdown path
  for the single launch attempt.
- A narrow app-local client lifecycle projection with strict MessagePack/TypeScript validation.
- Explicit local-player GUID publication in the in-world state.
- Focused dynamic snapshot/upsert/remove publication plus at most one nonempty authority-clocked
  `Advanced` batch after each eligible client simulation turn.
- The existing `DynamicEntityAdvanceBatch` used as the closed tick result carrying host time,
  duration, ordered entity paths, and discontinuity kinds for host delivery and the later boom
  adapter; no parallel receipt type or generic plugin hook.
- Current-state hydration/recovery after initial listener installation and receiver lag.
- Core-owned completion of the two-message character-entry handshake.
- Focused host tests over injected/mock client events plus core tests for any newly exposed
  authority-owned snapshot needed by the adapter.

#### Task checklist

- [ ] Reuse the TUI's proven `ClientRuntimeBuilder` and command-channel composition without importing
      CLI state, retry, logs, reducers, or rendering.
- [ ] Load the runtime bootstrap through `ContentRepository` at the content owner; do not pass disk
      paths or DAT policy into `holtburger-core` consumers.
- [ ] Ensure a connect attempt has one owned lifetime and that late events from a retired attempt
      cannot update state during shutdown. The first cut creates no successor attempt.
- [ ] Subscribe to core events before issuing initial-state and login commands.
- [ ] On `CharacterEnterWorldServerReady`, have `ClientRuntime` send the retained selected GUID and
      account through `CharacterEnterWorld`; remove `SendCharacterEnterWorld` from frontend-facing
      command policy and migrate the TUI to observe lifecycle only.
- [ ] Replace the partial initial-view response with one core snapshot carrying current status,
      character list, local-player identity, synchronized server time, dynamic entities, and runtime
      bodies where those facts are present.
- [ ] Project only lifecycle, character-list, local-player, focused dynamic, server-time,
      correction/reset, and error facts required by the first cut. Movement capabilities remain
      inside core because no frontend consumer resolves movement from them.
- [ ] Preserve server-provided character identity and slot facts losslessly enough for the selection
      UI; do not project complete character-creation data.
- [ ] Capture tick-start projection facts before movement/world/simulation advancement, then publish
      one `Advanced` batch after accepted results. Use integrated single- or multi-leg paths for
      continuous motion and explicit teleport/reset kinds for discontinuities.
- [ ] Keep remote entities server-authoritative and dead-reckoned in the first cut. Core may project
      their tick-start/end path, but neither the app host nor frontend physically resolves or
      re-derives their motion.
- [ ] Make `ClientRuntime`'s existing 30 ms interval the only client session clock. Do not install
      the client as an Explorer `HostFixedTickParticipant` or run a parallel app-host interval.
- [ ] Publish the ordered tick result through the existing `DynamicEntityAdvanceBatch`, consumed by
      focused entity delivery and, in Phase 10, boom advancement. Do not add a parallel receipt,
      open-ended post-tick callback, or plugin registry.
- [ ] Keep the password out of query parameters, renderer state, sidecar arguments, logs, errors,
      retained diagnostics, and persistence; clear the startup value after the login command is sent.
- [ ] Define receiver-lag recovery as an explicit current-state replacement path. Do not continue
      applying deltas after known loss.
- [ ] Make task termination, core error, server disconnect, explicit disconnect, and sidecar shutdown
      distinguishable for diagnostics and exit status even though none produces an in-app retry.
- [ ] On connection/login failure, server disconnect, or fatal client-runtime failure, emit one
      redacted diagnostic and request whole-application non-zero exit. Do not restart the network
      task or return the renderer to configuration.
- [ ] Ensure host shutdown stops accepting commands, requests core disconnect when appropriate,
      awaits or aborts the bounded task lifetime, then closes event publication.

#### Acceptance criteria

- A non-interactive integration test or harness reaches character selection through the sidecar
  adapter using a controlled core/session source.
- Client mode exposes no raw `WorldState`, `Entity`, `ClientViewEvent`, UDP/session, or protocol
  packet type to TypeScript.
- The frontend receives one exact local-player GUID from authority; it never infers it.
- A fresh snapshot reconstructs lifecycle and dynamic presentation after initial mount or declared
  receiver loss.
- Equal tick-start/result facts produce one ordered `Advanced` batch with exact host time, duration,
  generation, path, and integrated/teleport/reset classification.
- The tested client tick order is movement/world advancement → local simulation transaction →
  focused advance projection → host publication; no second client fixed clock exists.
- Disconnect and host shutdown leave no client task or pending command receiver alive.
- A failed connection or lost server connection terminates the first-cut application with a
  non-zero exit and cannot trigger a second attempt.

#### Decisions and course corrections

To be filled during execution.

### Resteering A: Audit the two real compositions

Before building client UI, dry-run both complete composition graphs:

- confirm the Explorer host contains no client authority or producer;
- confirm the client host contains no Explorer authority or producer;
- confirm both use the same content implementations and focused dynamic contract;
- inspect the shared presentation owner for Explorer policy or client lifecycle leakage;
- inspect all new protocol fields for named consumers in Phase 7 or Phase 8;
- dry-run Phase 5 collision loading and local-player hydration outside the client tick; confirm no
  remote entity is accidentally promoted from server authority to local physical authority;
- dry-run the Phase 6 clean cutover and verify that deleting `SpatialPhysics` leaves every current
  TUI/client producer with an honest typed route into the full transaction;
- reassess whether any proposed shared interface has only one implementation or only one caller; and
- update or subdivide the remaining phases before continuing.

No later phase begins with known duplicate authority or an unexplained mode conditional inside the
presentation runtime.

### Phase 5: Stage client collision products and local-player body hydration

#### Deliverables

- Collision-product loading, interest, and immutable snapshot publication separated from body
  solving and usable by both desktop and TUI client compositions.
- One core client collision coordinator following authoritative local-player residency, shared by
  desktop and TUI compositions rather than duplicated as frontend policy.
- Generation-guarded physical-body preparation for the selected local player through the existing
  shared dynamic-body definition/profile path, performed outside network and simulation turns.
- A closed `ClientSpatialReadiness` value correlating one authoritative player identity/generation,
  its installed canonical physical definition, and the complete collision revision required by the
  Phase 6 cutover without duplicating body state.
- Explicit pose-only remote entities for the first cut; their server-authoritative placement and
  dead reckoning remain presentation inputs, not locally solved physical authority.

#### Task checklist

- [ ] Build reusable core client collision coordination over `ContentAssetService`. Although its
      loader API is synchronous, stage loading away from the client simulation turn, then atomically
      publish the complete immutable `CollisionScene` revision.
- [ ] Load the normalized authoritative owner and a one-owner-radius square. Keep the 3×3 product
      set independent from Explorer's 5×5 render/simulation policy.
- [ ] Add a selected-player entity-to-`DynamicEntityDefinition` adapter, then prepare its physical
      definition through existing shared setup/profile functions outside network and simulation
      loops. Capture GUID plus instance generation and discard stale completion after replacement,
      deselection, disconnect, or shutdown.
- [ ] Install a successful definition into the canonical local-player body through
      `set_dynamic_physical_body` and publish the resulting runtime-body/dynamic upsert.
- [ ] Publish one composite readiness state so Phase 6 never pairs the canonical body with a
      collision revision for the wrong player residency or instance generation.
- [ ] Keep render-resource interest separate from collision-product interest. Place reusable client
      collision coordination where it follows authoritative `WorldState` residency for both TUI and
      3D hosts without making either frontend a physics observer.
- [ ] Compose both TUI and desktop clients with `ContentAssetService` and the same core collision
      coordinator. No frontend participates in collision interest.
- [ ] Verify landblock and EnvCell crossings, superseded loads, stale body-preparation completion,
      missing content, teleport, disconnect, and shutdown with asset-free coordinator fixtures.

#### Acceptance criteria

- Complete collision products follow authoritative player residency across landblock and EnvCell
  boundaries without coordinate-derived guesses.
- The prepared local-player definition and collision revision become ready atomically for one
  matching authority instance; unavailable content is an explicit state.
- Collision loading and body preparation never block a client simulation or network turn.
- Desktop and TUI construct the same coordinator and spatial-product value without yet widening or
  adding a second implementation of `SpatialPhysics`.
- Remote entities remain explicitly server-authoritative and pose-only/dead-reckoned; no first-cut
  client path physically commits their bodies.

#### Decisions and course corrections

- A synchronous content method is not evidence that decoding/assembly belongs on the 30 ms client
  clock. The coordinator stages products outside the tick and publishes only complete revisions.
- The initial client collision-interest radius is one landblock on each axis (a 3×3 product set),
  not Explorer's 5×5 policy. The 96 m active-solve radius plus the 7.68 m maximum grounded
  transaction remains below one 192 m landblock, and the maximum 32 m boom is smaller still. Edge
  fixtures must exercise the bound. It becomes a named core constant shared by desktop and TUI;
  changing it later requires a measured consumer that can reach farther.

### Phase 6: Delete `SpatialPhysics` and install the transactional client solve

#### Deliverables

- Removal of `SpatialPhysics`, `BasicSpatialPhysics`, `NoopSpatialPhysics`, the physics field on
  `SpatialScene`, and the corresponding `WorldState`/builder constructors.
- Client simulation over `WorldState.scene` using its existing transactional physical-body APIs and
  the Phase 5 spatial-product value, with no second batch/apply commit path.
- A closed per-body movement basis at the physical boundary, including a named
  desired-displacement-to-actuation conversion for honest existing client producers.
- Explorer `HostSimulationRuntime` retained as Explorer scene/interest orchestration over the same
  world solver, with equal solver inputs producing equal transaction results.

#### Task checklist

- [ ] Keep `WorldState.scene` as the only client body store. Do not register client entities in
      `HostSimulationRuntime`.
- [ ] Delete the `SpatialPhysics` trait, minimal/no-op implementations, scene callback field, and
      injection constructors in the same change that installs the Phase 5 product consumer. Replace
      marker-solver tests with transaction fixtures; retain no dual production path.
- [ ] Keep mode-owned `SpatialScene` values. Explorer and client call the same world methods on their
      respective scenes; never copy or synchronize bodies between them.
- [ ] Tick only the ready local player through `SpatialScene::tick_physical_body_transaction` in the
      first cut. Suspend it while the Phase 5 product is loading/unavailable. Continue advancing
      server-authoritative remote entities through their existing dead-reckoning/projection lane.
- [ ] Fold `SpatialSolveRequest::local_drive` into a closed per-body movement basis rather than a
      sibling exception. Resolve each current authored offset, desired displacement, retained
      kinematics, or launch through its named stateless actuation conversion before solving.
- [ ] Preserve the desired-displacement adapter where autonomous or server projection remains an
      honest producer. Do not retain the deleted minimal solver or invent a generic adapter trait.
- [ ] Map `PhysicalBodyTickResult`, the accepted tentative body, collision reports, scene residency,
      and dynamic state changes into existing `WorldEvent` semantics inside the transaction callback;
      do not reapply solved kinematics after the scene commits.
- [ ] Compose desktop and TUI clients with the same Phase 5 coordinator/product consumer and full
      transaction. No frontend participates in collision interest.
- [ ] Add differential unit fixtures that feed equal body, collision, contact, and actuation facts
      through Explorer and client adapters and require equal solve results. Do not require their
      authorities, upstream movement policy, or protocol outputs to be equal.

#### Acceptance criteria

- No frontend or second host scene advances client bodies.
- Explorer, desktop client, and TUI use the same full solve implementation while retaining their
  appropriate authority and producer differences.
- `SpatialScene` no longer stores an injected callback whose method receives the same scene.
- The local player cannot advance until the matching body definition and required collision owner
  are committed; unavailable content is visible rather than replaced with invented physics.
- Existing honest displacement producers reach the full transaction through typed actuation
  conversion, with no minimal-solver fallback and no requirement that all producers become authored
  character motion in this phase.

#### Decisions and course corrections

- The full solver and transactional commit already belong to `SpatialScene`; this phase integrates
  the client with those APIs instead of creating a production implementation of the minimal callback.
- Phase 5 stages the replacement products first so this clean deletion is behaviorally complete, not
  merely compilable with a temporarily immobile TUI/client.

### Phase 7: Implement client lifecycle and character-selection UI

#### Deliverables

- `ClientApp.svelte` replaced with a client-local composition root.
- Launch-driven connecting/authenticating state with no in-app credential form.
- Character-selection view for existing server-provided characters.
- An explicit Enter World action, with Enter and double-click routed to the same action.
- Entering-world and minimal connection/status views; terminal failures hand off to application exit.
- A small client lifecycle reducer/session separated from Svelte components and covered by unit
  tests.
- Renderer/presentation construction deferred until the lifecycle reaches the state selected in
  Phase 0, with explicit cancellation if the user disconnects during startup.

#### Task checklist

- [ ] Represent lifecycle as one discriminated state rather than interdependent booleans and
      nullable fields.
- [ ] Do not project launch credentials into Svelte; the frontend begins in connecting state and
      learns only lifecycle outcomes.
- [ ] Route structured terminal failures to Electron main for redacted diagnostics and non-zero
      application exit; do not render retry or editable-configuration controls.
- [ ] Submit selection by exact server-provided GUID/slot identity; do not select by display name.
- [ ] Require an explicit Enter World action for the current selection. Treat Enter and double-click
      as shortcuts for that action, not as separate lifecycle paths.
- [ ] Follow the proven select/server-ready/enter-world choreography from Phase 0.
- [ ] Keep character creation/deletion/restoration controls absent.
- [ ] Add component/reducer tests for success, explicit entry, failure-driven exit, disconnect
      during each state, and stale events. Do not add repeated-attempt state that production lacks.

#### Acceptance criteria

- The client route can connect, display existing characters, select one, and reach in-world state.
- Invalid lifecycle transitions fail loudly or are structurally unrepresentable.
- No Explorer UI component, entity command, camera mode, or diagnostic panel is imported.
- Credentials do not appear in launch URLs, renderer state, sidecar arguments, console output,
  retained state snapshots, or errors.
- Selection alone does not enter the world; the explicit action and both shortcuts issue the same
  semantic selection command exactly once.
- The first cut presents no server/account/password form, retry button, named vitals, or game HUD.

#### Decisions and course corrections

To be filled during execution.

### Phase 8: Connect client authority to shared world presentation

#### Deliverables

- Client dynamic feed hydration into the shared `DynamicEntityMirror` and
  `GamePresentationRuntime` reconciliation path.
- Authority-clocked `Advanced` batches consumed through the existing placed-path interpolation path
  for local and dead-reckoned remote movement.
- Client presentation bootstrap on entering world.
- Authoritative local-player selection by the host-published GUID.
- Player-residency-driven render scene interest for outdoor, mixed, and dungeon-only targets.
- Server-time-driven regional environment input.
- Accepted-camera audio listener and player-anchored viewer light policy for the first cut.
- A basic in-world canvas shell with a minimal status/error overlay and no named vitals or
  speculative game panels. Terminal connection failures may publish their redacted reason while
  shutdown begins but never expose retry controls.
- Browser-harness fixtures and focused frontend integration tests for client-produced feeds.

#### Task checklist

- [ ] Register the focused dynamic listener before requesting the current snapshot.
- [ ] Reconcile snapshots, upserts, removes, and ordered `Advanced` batches through the same
      source-neutral mirror and presentation methods used by Explorer; add no client entity system.
- [ ] Preserve the core-published host time, duration, generation, path, and advance kind. Do not
      resample poses in the app host or substitute frontend frame time for client authority time.
- [ ] After declared feed loss, reject `Advanced` deltas until the complete replacement snapshot is
      installed, then establish a fresh host/frontend timeline from that snapshot.
- [ ] Select the local player's projected entity only through the authority-published GUID.
- [ ] Separate authoritative placement used for interest/residency from interpolated draw placement
      used for camera smoothness.
- [ ] Route authoritative residency through the existing scene-target/profile coordinator; do not
      use frontend point containment to decide player residency.
- [ ] Define behavior while the player is authoritative but not yet visually realized. Hold or show
      loading state; never fall back to free-fly authority.
- [ ] Resolve regional time from the client server-time projection and make missing weather support
      explicit. Add/read an optional synchronized-time fact; do not use
      `WorldState::current_server_time`'s wall-clock fallback as server authority.
- [ ] Put the audio listener at the accepted primary camera placement and orient panning with the
      camera's right axis, matching the existing presentation/controller contract. Keep render and
      collision interest on authoritative player residency rather than camera placement.
- [ ] Reuse static content, sky, ambient, renderer, map geometry store, and dynamic visual sources
      from the shared presentation owner.
- [ ] Prove outdoor-to-interior and teleport/reset demand transitions with synthetic fixtures before
      live verification.

#### Acceptance criteria

- A synthetic client snapshot renders through the production dynamic presentation path.
- Synthetic authority-clocked batches drive smooth integrated placement, while teleport/reset kinds
  snap and invalidate stale interpolation exactly once.
- A live session renders the selected player and representative nearby entities with their authored
  appearances, attachments, animation, effects, and placement.
- Static content follows authoritative player residency across landblock and EnvCell transitions.
- The frontend never mutates canonical entity pose, motion, physics, or residency.
- Explorer and client use one presentation runtime and one dynamic realization path.

#### Decisions and course corrections

To be filled during execution.

### Phase 9: Converge character movement on the shared spatial foundation

#### Deliverables

- `MovementSystem` narrowed to the client-specific command/protocol responsibilities proved in
  Phase 0, with local character actuation delegated to the shared character-motion path.
- One resolved character actuation per tick, derived from `CharacterDrive`, motion-table/authored
  motion, current pose/contact, and demonstrated retail rules; packet, physics, presentation, and
  correction consumers do not independently reconstruct it.
- Typed frontend basic drive commands mapped to `CharacterDrive` / `ClientCommand::DriveSelf`.
- Character input controller integration for walk, run, turn, stop, focus loss, and teardown.
- Explorer possession adapted to the shared basis-to-actuation conversions while retaining its own
  intent and authority.
- Server correction, forced reposition, teleport, and runtime-body reset behavior preserved through
  the client producer and presentation feed.
- Retail-shaped server interpolation and dead-reckoning constraint damping in their proven ordered
  movement-basis stages.
- The TUI receiving the same higher-fidelity character actuation through its already-shared Phase 5
  collision coordinator and scene transactions, not a desktop-only controller fork.

#### Task checklist

- [ ] Split `MovementSystem` so movement packet construction, control/sequence edges, command
      arbitration, server correction, and honest protocol projection remain client-specific while
      character actuation, contact handling, and solving use the shared Phase 5 collision product
      and Phase 6 transaction path.
- [ ] Remove the manual local velocity approximation once the shared path covers its consumers,
      including the fixed lateral/backward magnitudes. Do not retain it as a silent fallback.
- [ ] Preserve the Phase 6 desired-displacement conversion for autonomous/server projection while
      migrating manual character locomotion to motion-table/authored actuation. Delete a basis only
      when no honest producer remains.
- [ ] Adapt Explorer possession to call the shared basis-to-actuation functions while retaining
      Explorer intent, lifecycle, registry, scene, collision interest, and transaction orchestration.
- [ ] Add differential unit fixtures that feed equal body, collision, contact, and drive facts
      through Explorer and client adapters and require equal actuation/solve results. Do not require
      their authorities or protocol outputs to be equal.
- [ ] Implement retail interpolation as a basis that replaces authored offset for grounded bodies,
      including its target threshold, speed cap, heading policy, and progress watchdog. Apply
      constraint damping after interpolation/authored basis selection and before actuation.
- [ ] Feed held input as semantic replacements and lifecycle edges at input cadence; let core own
      packet emission and physics cadence.
- [ ] Clear held drive on blur, pointer/focus loss, disconnect, character transition, and teardown.
- [ ] Prove diagonal, backward, turn-only, walk/run, stop, and rapid reversal behavior against the
      existing core movement tests and a focused live harness.
- [ ] Prove server correction and teleport reset do not leave stale presentation interpolation,
      camera state, collision interest, or scene interest.

#### Acceptance criteria

- Basic input moves the server-visible local player and returns through the authoritative
  core/world projection before presentation.
- Local prediction and server correction have one owner in `holtburger-core`/`holtburger-world`,
  and the motion-to-actuation fact they consume is computed once.
- Explorer, desktop client, and TUI resolve equal character-drive facts into equal actuation while
  retaining their appropriate authority, input, and protocol differences.
- Server correction preempts authored displacement and constraint damping limits accumulated drift
  in the proven retail order.
- The production client path no longer uses fixed approximate lateral/backward velocity as its
  character-motion model.
- Releasing input, losing focus, disconnecting, or tearing down cannot leave movement latched.

#### Decisions and course corrections

- Phase 6 deliberately preserves typed displacement-to-actuation composition so this phase can
  improve manual character fidelity without forcing autonomous/server producers through a dishonest
  authored-motion model.

### Phase 10: Add the client third-person camera

#### Deliverables

- Client-local pointer/keyboard/wheel camera UX over the shared possession-camera controller.
- A client host adapter that consumes the exact local-player path and timing from Phase 4's
  authority-clocked advance batch, then supplies it to the shared `KinematicBoomController` without depending on
  `ExplorerEntityRuntime` or Explorer possession.
- Projection-clearance handshake, collision-safe boom placement, camera residency, visual pivot,
  orbit, zoom, and recenter behavior.
- Primary-view, audio, scene-interest, and map-heading consumers driven from the correct player or
  camera facts without recomputation.
- Focused controller/host/frontend tests and browser-harness camera scenarios.

#### Task checklist

- [ ] Separate the current Explorer-bound host boom adapter from the reusable core boom behavior.
- [ ] Inject a small authoritative target-path provider backed by the local-player advance in the
      closed `DynamicEntityAdvanceBatch`; do not resample the body or teach the boom about `ClientRuntime`,
      server packets, or Explorer GUID allocation.
- [ ] Preserve one tick order when boom support lands: accepted entity advancement → boom solve →
      one ordered host publication. Do not add a boom timer beside the client runtime interval.
- [ ] Keep DOM pointer capture, gesture scaling, inversion, and recenter UX in `src/client`.
- [ ] Keep collision clearance and acknowledged projection in the host/controller path.
- [ ] Use the local player as the character/map anchor and the camera as the primary render view;
      compute each choice once in the client composition.
- [ ] Define behavior during teleport, loading, missing presentation, and disconnect explicitly.
- [ ] Reuse the proven projection-clearance revision contract and retain no client-specific copy.
- [ ] Verify indoor/outdoor transitions, obstructed zoom, orbit while moving, recenter, viewport
      resize, and projection growth recovery.

#### Acceptance criteria

- The camera follows the authoritative local player without becoming its pose authority.
- Camera collision uses the same installed client collision snapshot as the player composition,
  without registering a second player body.
- Entity advance and boom placement share one client host time/duration and one ordered publication.
- Client camera UX imports no Explorer module or tuning namespace.
- Teleport/reset cannot retain a camera path or projection acknowledgement from the retired player
  placement.

#### Decisions and course corrections

To be filled during execution.

### Resteering B: Judge the complete playable slice

Before adding cleanup-only work, run the complete first-cut workflow and reassess:

- whether all shared extractions now have two concrete consumers;
- whether any client state is duplicated between Rust authority, host adapter, frontend mirror, and
  Svelte UI;
- whether render and collision interest derive from the same authoritative residency without sharing
  resource ownership;
- whether presentation gaps are producer omissions or renderer defects;
- whether server interpolation and constraint damping match the required correction fixtures;
- whether startup, streaming, dynamic realization, or event publication produces unacceptable
  stalls or queue pressure; and
- whether any remaining phase should be subdivided before cleanup.

Capture decisions and course corrections in this document. Do not broaden the slice into HUD or game
systems merely because the world is now visible.

### Phase 11: Cleanup, vocabulary, documentation, and acceptance

#### Deliverables

- Complete removal of obsolete route shell, shared Explorer naming, compatibility aliases, unused
  command/event variants, and superseded composition paths.
- `apps/holtburger-3d/README.md`, `AGENTS.md`, and architecture audit updated to describe the two
  real modes, authorities, producers, and shared presentation consumer.
- Protocol and package verification updated for both modes.
- Final unit, lint, type, Rust, browser-harness, sidecar, Electron, and live ACE verification.
- Remaining product gaps and fidelity debts recorded as named follow-ons, not TODO scaffolding.

#### Task checklist

- [ ] Sweep `GameRuntime`, `spawnedDynamic`, and inappropriate Explorer vocabulary from surviving
      shared symbols, metrics, docs, comments, tests, tuning, and UI labels.
- [ ] Remove the static client `RouteShell` path and any shared app components left without a
      consumer.
- [ ] Remove unused wire variants and fields discovered during implementation; every survivor needs
      a named scenario where it differs from another value.
- [ ] Inspect `ExplorerApp.svelte` and `ClientApp.svelte` for duplicated low-level construction or
      frame sequencing and collapse only proven duplication.
- [ ] Inspect the Rust mode compositions for duplicated authority, content cache, collision scene,
      motion catalog, task, or event buffering.
- [ ] Treat all TypeScript lint, dead-code, Svelte, Rust clippy, and formatting warnings as errors.
- [ ] Run the canonical browser harness for Explorer presentation regression and synthetic
      client-feed scenarios.
- [ ] Run both Electron modes through startup, shutdown, protocol failure, host crash, and package
      inspection.
- [ ] Run the client first-cut workflow against a configured ACE server without invoking the TUI.
- [ ] Record any unavailable external prerequisite exactly and retain synthetic evidence where
      possible.

#### Acceptance criteria

- The final code has two explicit mode compositions and no universal authority abstraction.
- Explorer and client authorities and producer adapters remain distinct.
- Both producers feed one focused dynamic contract and one presentation realization path.
- Shared frontend presentation code imports neither `src/explorer` nor `src/client`.
- The client can connect, select, enter, render, move, use a collision-safe third-person camera, and
  shut down cleanly.
- Explorer retains its current content, entity, possession, camera, diagnostics, and renderer
  behavior.
- All repository verification gates pass, with any environment-only live gate reported separately
  and honestly.

#### Decisions and course corrections

To be filled during execution.

## Verification Strategy

### Rust unit and integration evidence

- Mode parsing, construction, invalid-mode command rejection, and shutdown.
- Client lifecycle projection from controlled `ClientViewEvent` sequences.
- Post-shutdown event rejection and receiver-lag replacement behavior.
- Complete core application snapshot reconstruction after a deliberately dropped character-list,
  local-player, server-time, dynamic, and runtime-body event.
- Core-owned select/server-ready/enter-world choreography with no frontend protocol follow-up.
- Local-player identity publication and reset/teleport transitions.
- Client focused dynamic snapshot/upsert/remove forwarding plus authority-clocked `Advanced` path
  publication without semantic re-projection in the app host.
- Exact client tick ordering and timing: movement/world advancement, local transaction, advance
  projection, host delivery, and later boom consumption all observe one client-owned advance batch.
- Equal full-solver results for equal body, collision, contact, and actuation facts supplied through
  Explorer and client adapters, while their authority and protocol outputs remain distinct.
- Content-backed collision injection with one `WorldState` scene and immutable snapshot replacement
  outside the synchronous tick.
- TUI and desktop client composition over the same collision coordinator and production
  `SpatialScene` transactions.
- Local-player-only physical commit with server-authoritative remote dead reckoning preserved.
- Drive-command mapping, authored actuation, stop-on-lifecycle edges, correction, and disconnect.
- Differential movement fixtures for forward, backward, lateral, diagonal, turn-only, walk/run,
  grounded/airborne, correction, and teleport cases against documented retail/ACE evidence.
- Client local-player boom adapter over the shared controller.

### TypeScript and Svelte evidence

- Strict decoders for every client command response and event payload.
- Lifecycle reducer transition tests.
- Focused mirror hydration, replacement, stale generation, and reset tests shared across both
  producer adapters.
- Ordered `Advanced` integration, teleport/reset snapping, timeline replacement after loss, and
  stale-generation rejection through the shared mirror.
- Presentation owner construction/teardown and partial-startup failure tests.
- Authoritative-versus-presented placement selection tests.
- Scene-interest, environment, input release, and camera coordination tests.
- Client component tests for launch-driven connection, selection, explicit entry, minimal status
  feedback, and terminal-exit notification.

### Browser harness evidence

The canonical browser harness remains the renderer and presentation playground. Add injected client
authority fixtures rather than requiring Electron or a live server for every visual check:

- initial client dynamic snapshot with local player and nearby entities;
- authoritative movement and interpolated presentation;
- attachment trees and appearance changes;
- outdoor, dungeon-only, and outdoor/EnvCell transition demand;
- teleport/reset during streaming;
- player temporarily authoritative but not visually realized;
- movement/camera composition and focus-loss stop;
- presentation construction failure and complete teardown.

Use real GPU mode for performance evidence and record render scale, scene radii, entity count, and
workload beside every timing.

### Live ACE evidence

A non-interactive harness or the client application itself verifies the actual server workflow. Do
not run the TUI. The minimum live matrix is:

- successful and rejected authentication;
- multiple-character selection and enter world;
- outdoor spawn and nearby entity rendering;
- movement observed by the server and corrected back into presentation;
- landblock crossing;
- EnvCell entry/exit or dungeon spawn;
- teleport/reset;
- server disconnect and explicit application shutdown.

Live assets and server state are external prerequisites, so permanent tests must not depend on
unchecked runtime content. Retain reusable harness code and synthetic fixtures; do not retain tests
whose only input is a developer-local DAT installation or server database.

### Required repository gates

From `apps/holtburger-3d`:

```text
npm run format:check
npm run check
npm run lint
npm run test:ts
npm run check:rust
npm run smoke:sidecar
npm run harness:browser -- <recorded Explorer and client scenarios>
```

Run focused workspace Rust tests for every changed shared crate through the repository's package
manager conventions. Package/archive verification is required once Electron startup or bundled host
arguments change.

## Risks and Mitigations

| Risk                                                                          | Mitigation                                                                                                                                                                                            |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A shared host base class merges two authorities                               | Compose concrete `ExplorerHostRuntime` and `ClientHostRuntime` over shared content capabilities; share values and helpers only after both consumers exist                                             |
| `ClientViewEvent` becomes an accidental desktop protocol                      | Project a closed app-local first-cut vocabulary; never serialize the broad enum wholesale                                                                                                             |
| Client entities are advanced in both `WorldState` and `HostSimulationRuntime` | Keep `WorldState.scene` as the only client body store; supply collision products instead of copying bodies                                                                                            |
| The full Explorer runtime is reused as “the solver”                           | Call the already shared `SpatialScene` transactions from each authority; reuse neither Explorer collision policy nor its body store                                                                   |
| The circular minimal solver callback survives beside scene transactions       | Delete the callback/scene field and inject asynchronously replaceable collision products at the core client-composition boundary                                                                      |
| Movement convergence blesses possession behavior without proof                | Differentially trace TUI, possession, retail, ACE, motion data, and live observations; preserve only evidence-backed behavior                                                                         |
| `MovementSystem` remains a second character-motion model                      | Keep client protocol sequencing there, but compute motion-table/authored actuation once in the shared controller/world path                                                                           |
| Async collision loading leaks into deterministic solving                      | Keep loading/interest in a coordinator and atomically publish complete immutable snapshots to the synchronous solver                                                                                  |
| Local-player preparation completes for a retired entity instance              | Guard preparation by GUID plus instance generation and install only into the still-selected canonical local-player body                                                                               |
| The frontend infers local player or residency                                 | Publish exact player identity from client authority and consume producer-projected residency                                                                                                          |
| Presentation interpolation feeds back into authority                          | Separate authoritative placement consumers from visual placement consumers in contracts and tests                                                                                                     |
| Explorer construction is copied into `ClientApp.svelte`                       | Extract one imperative presentation owner first and migrate Explorer before adding the client consumer                                                                                                |
| Premature generic mode interfaces hide different lifecycle needs              | Keep explicit mode roots and facades; extract only the content, feed, presentation, and controller seams with two real callers                                                                        |
| Dynamic feed omits live server entity classes                                 | Census projection failures in Phase 0 and fix missing producer facts at `holtburger-core`/`holtburger-world`, never with frontend fallbacks                                                           |
| Client feed never emits interpolation paths                                   | Publish at most one nonempty core-owned `Advanced` batch per eligible client turn and consume it through the existing source-neutral placed-path mirror                                               |
| A second host clock drifts from client simulation                             | Treat `ClientRuntime`'s interval and authority-clocked advance batch as the only client cadence; host delivery and boom consume it rather than scheduling another fixed tick                          |
| Broadcast receiver lag silently corrupts the mirror                           | Stop accepting deltas after declared loss and request one complete application snapshot; the current partial snapshot is insufficient                                                                 |
| Password exposure expands beyond the requested command line                   | Accept command-line process-list exposure explicitly, then keep the value out of routes, renderer/preload, sidecar argv, logs, errors, snapshots, and persistence; clear launch retention after login |
| A failed connection grows an accidental retry state machine                   | Emit one redacted diagnostic, shut down the owned client task, and terminate the application non-zero; add no second-attempt transition in the first cut                                              |
| Scene streaming follows smoothed camera placement                             | Render demand follows authoritative player residency; visual camera placement is a downstream consumer only                                                                                           |
| Collision loading blocks the client physics loop                              | Stage immutable collision snapshots outside the tick and atomically replace the current collision view, following current host precedent                                                              |
| Server correction fights authored animation or camera smoothing               | Trace level/edge ownership in Phase 0; reset downstream presentation/camera state on discontinuity rather than retaining stale interpolation                                                          |
| Client mode bloats into TUI UI parity                                         | Share the improved client motion/physics composition, but enforce the first-cut desktop command/event and UI inventory                                                                                |
| Explorer regresses during shared extraction                                   | Migrate Explorer first, retain canonical browser-harness evidence, and do not start client UI until Resteering A passes                                                                               |
| Live verification depends on local assets/server                              | Keep synthetic unit/harness coverage, report exact missing prerequisite, and never retain asset-dependent permanent tests                                                                             |

## Definition of Done

- [ ] Electron launches the sidecar in an explicit matching Explorer or client mode.
- [ ] Client mode accepts the TUI-shaped host/account/password launch arguments, validates them in
      Electron main, and transfers one typed startup value privately without routing credentials
      through the renderer, URL, or sidecar arguments.
- [ ] Explorer mode constructs only Explorer authority/producer state plus shared content.
- [ ] Client mode constructs only client authority/producer state plus shared content.
- [ ] `ClientRuntime`/`WorldState` remains the sole client entity and body authority.
- [ ] `SpatialScene` owns the only full solver and contains no injected callback receiving its own
      scene; Explorer and client invoke its transactions over their own authority scenes.
- [ ] Desktop and TUI clients use one core collision coordinator and the same client simulation
      composition.
- [ ] Collision loading/interest is outside the synchronous solve and publishes complete immutable
      snapshots without transferring body ownership.
- [ ] The local-player physical definition is prepared off the network/simulation loops, installed
      with an instance-generation guard, and cannot advance before hydration succeeds.
- [ ] `MovementSystem` owns only proved client command/protocol responsibilities; shared character
      actuation no longer uses its fixed approximate lateral/backward velocity path.
- [ ] Explorer and client project through distinct adapters into the same focused dynamic contract.
- [ ] `ClientRuntime` publishes one ordered `Advanced` batch from its authoritative simulation turn;
      client host delivery and the boom consume that cadence without a second fixed clock.
- [ ] Remote entities remain server-authoritative and dead-reckoned in the first cut; no local
      physical transaction commits their motion without separately proven retail behavior.
- [ ] The frontend uses one source-neutral dynamic mirror and presentation realization path.
- [ ] `GameRuntime` and `spawnedDynamic*` vocabulary has been cleanly replaced.
- [ ] The client host exposes only the typed first-cut lifecycle, selection, viewer, control, and
      focused presentation surface.
- [ ] Core owns the select/server-ready/enter-world protocol choreography, and one complete current
      snapshot reconstructs client application state after declared event loss.
- [ ] The local player is named by authority rather than inferred by the frontend.
- [ ] Render and collision interest follow authoritative player residency and own separate resource
      lifetimes.
- [ ] A user can connect, view existing characters, select one, and enter the world.
- [ ] Character selection requires the explicit Enter World action; Enter and double-click are
      shortcuts for that same idempotent action.
- [ ] Connection/login failure, server disconnect, and fatal client-runtime failure terminate the
      application non-zero after a redacted diagnostic, with no in-app retry path.
- [ ] The selected player, nearby entities, attachments, animation, effects, and surrounding static
      content render through the shared presentation runtime.
- [ ] Basic movement crosses frontend intent, core execution, server observation, world authority,
      focused projection, and frontend presentation.
- [ ] The TUI obtains the same improved character-motion and collision fidelity through its
      `ClientRuntime` composition without a TUI-specific solver fork.
- [ ] Third-person camera placement is collision-safe and follows the authoritative player without
      becoming player authority.
- [ ] Teleport, reset, disconnect, startup failure, host failure, and application shutdown have
      explicit tested behavior.
- [ ] Explorer behavior remains intact.
- [ ] Formatting, type checks, lint, dead-code analysis, unit tests, Rust clippy, browser harness,
      sidecar smoke, and package verification pass.
- [ ] The live ACE workflow is verified when its external prerequisites are available, with exact
      gaps reported otherwise.
- [ ] Surviving fidelity or product gaps are recorded as named follow-ons with consequences and
      acceptance tests; no dormant compatibility scaffolding remains.

## Open Questions

None.

## Implementation Record

### Decisions and course corrections

- **2026-08-26 — Phase 0 contract cutover complete:** the evidence ledger now fixes the lifecycle,
  current-state recovery, focused advance, residency/collision, hydration, movement, simulation, and
  desktop host contracts consumed by later phases. Asset-free coverage now reaches every focused
  client projection rejection, local-player and attached snapshot reconstruction, and retail
  correction assignment/damping. A representative live entity census and encoded payload sampling
  were explicitly judged unnecessary for Phase 0; they remain optional diagnostics if later
  integration evidence calls for them.
- **2026-08-26 — hybridize the implementation schedule:** keep the evidence-backed deletion of
  `SpatialPhysics`, but split review surfaces more aggressively. Phase 2 is a behavior-free
  presentation vocabulary cutover; Phase 5 stages collision products and hydrates the local
  player without widening the existing callback; Phase 6 deletes that callback and routes current
  honest bases through scene transactions; Phase 9 improves character-motion policy. This exposes
  spatial risk early without one
  contract/loading/hydration mega-diff.
- **2026-08-26 — one client advance clock:** core client projection currently omits `Advanced` even
  though the shared mirror's interpolation path consumes it. `ClientRuntime`'s existing simulation
  interval becomes the sole clock for movement, world advancement, local solve, advance projection,
  host delivery, and later boom sampling. Reuse `DynamicEntityAdvanceBatch` as the closed tick
  result; do not add a second host interval, parallel receipt, or open-ended post-tick plugin hook.
- **2026-08-26 — physically solve only the local player:** remote entities remain
  server-authoritative and dead-reckoned in the first cut. Their authority-owned tick paths feed
  `Advanced` presentation, but no client transaction commits local physical response for them until
  retail evidence proves that behavior. This narrows the slice and avoids quietly contesting server
  authority.
- **2026-08-25 — launch credentials and terminal failure policy:** the first cut takes the TUI-shaped
  server, account, and password arguments on the Electron command line and connects automatically.
  Electron main validates them and sends one private typed startup value to the sidecar; the
  renderer has no connection form. Any connection/login failure, server disconnect, or fatal client
  runtime failure produces a redacted diagnostic and terminates the application non-zero without
  retry. This intentionally does not copy the current TUI's narrow retry loop for selected pre-world
  `CharacterError` values or its optional post-world `--auto-quit` distinction.
- **2026-08-25 — narrow character and HUD UX:** character selection uses an explicit Enter World
  action, with Enter and double-click as shortcuts for the same command. The in-world surface has
  only minimal status/error feedback and no named vital or first-cut game HUD. Terminal connection
  failures still exit rather than turning that overlay into a recovery screen.

- **2026-08-25 — remove the misplaced physics seam:** the earlier proposal to retain and widen
  `SpatialPhysics` is superseded by the evidence pass. The full solver already lives in public,
  transactional `SpatialScene` methods, while the trait is stored inside that scene and receives the
  same scene back. It has only minimal/no-op/test implementations. Delete it and inject collision
  products through reusable client orchestration instead.
- **2026-08-25 — solvers were already converged:** `HostSimulationRuntime` owns Explorer collision
  loading and bodies but delegates solving to `holtburger-world`. The work is to route client
  actuation through the same scene transactions and share collision-product coordination between
  desktop and TUI, not extract an algorithm from Explorer.
- **2026-08-25 — make current state reconstructible:** the existing initial-view request omits
  lifecycle, characters, local-player identity, and synchronized time, so it cannot recover all
  broadcast loss. Replace it with a complete core application snapshot and make downstream mirrors
  invalidate deltas until replacement arrives.
- **2026-08-25 — core owns character-entry choreography:** selection remains a semantic frontend
  command; core automatically sends the second enter-world message after server-ready. Remove the
  duplicated TUI/frontend protocol step.
- **2026-08-25 — interpolation is required:** retail interpolation replaces authored offset and
  constraint damping follows it. Client mode supplies the producer that the authored-motion plan
  intentionally awaited, so both stages land before playable movement acceptance.
- **2026-08-25 — re-audit client movement:** the TUI-era `MovementSystem` is not presumed to model
  character motion correctly. Preserve its proven client protocol concerns, compare its actuation
  with possession, retail, ACE, and motion data, and replace duplicate/approximate physical logic
  with one shared character-motion path.
- **2026-08-25 — compose displacement with actuation:** do not require a big-bang conversion of every
  client movement producer to `PhysicalBodyActuation`. Preserve authored offsets and genuine
  protocol target displacements as distinct upstream facts, then convert them through small
  exhaustive world-owned actuation functions. The existing `authored_grounded_actuation` is the
  precedent. Remove an adapter only when its input no longer has an honest producer.

### Cleanup targets discovered during execution

- Sweep `SpatialPhysics`, `BasicSpatialPhysics`, `NoopSpatialPhysics`, `new_with_physics`,
  `new_with_spatial_physics`, and batch/apply vocabulary after the transactional client cutover.
- Rename the partial `emit_initial_view_state_snapshot` mechanism during its complete-snapshot
  replacement; retain no old alias that overstates its recovery guarantee.
