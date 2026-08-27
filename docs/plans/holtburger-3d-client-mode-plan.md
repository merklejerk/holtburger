# Holtburger 3D Client Mode Implementation Plan

Status: Phases 0–16 are closed. The Phase 17 core activation, Phase 18 installation barrier, and
Phase 20 client/Explorer transition cutover are implemented; the Phase 19 first-cut compositor and
Phase 21 local verification are also complete. The production path now has one generation-scoped
`PortalSpace`, physical relocation, recursive containment, collision-backed camera seeding, exact
`SceneActivationReceipt` readiness, one-shot reveal/handoff, and a stable outgoing snapshot that
survives a drawing-buffer resize. The required setup/animation/sound closure is prepared once by
the presentation owner, and the renderer now draws it through a transition-only target using the
same compiled object/material path and fractional animation sampler as authored dynamics. The
outgoing image deliberately keeps its native capture extent across resize; the fullscreen
presenter samples normalized coordinates. This cut still keeps the compositor's simple normalized
blend instead of shipping the out-of-scope enhanced tunnel-shaped warp. Electron GUI execution and
the remaining live ACE transition matrix stay explicit external verification debt. A live GUI pass
subsequently exposed two activation blockers: Explorer's radius-eight request issued 289 landblock
batches at once, and the client requested an absent EnvCells layer for outdoor owner
`0x7b63ffff`. The first is fixed with a 32-wide requester queue, stale-before-host cancellation,
and a 512-request protocol circuit breaker. The second is fixed with a closed three-way shallow
scene class, so outdoor-only owners no longer request an absent EnvCells layer. Explorer activation
failures now also log and terminate portal presentation.

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
- Prepare retail's authored portal tunnel as a required app-wide ambient presentation closure and
  use one install/reveal transaction for client and Explorer discontinuities.
- Narrow incremental scene hydration to continuous traversal of an already-active world, deleting
  direct partial replacement-scene reveal paths.
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
- Shipping the enhanced tunnel-shaped outgoing/incoming screen-space warp. This cutover preserves
  the semantic compositor inputs and final-frame seam required to add it without changing lifecycle
  or activation contracts.

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
- `apps/holtburger-3d/host/src/object_resource_closure.rs` is the generic setup/model/material
  closure used successfully by portal setup `0x02000306`.
  `dynamic_entity_visual_source.rs` is the currently misnamed setup-visual transport to generalize,
  not duplicate.
- `apps/holtburger-3d/src/lib/game/behavior/prepared-asset-repository.ts` owns shared preparation
  and exact handle lifetime. `sky-script-system.ts` is the retained-small-ambient-closure precedent;
  portal setup, animation, and audio have the same app-lifetime policy.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-flat-scene-target.ts`,
  `webgl2-flat-scene-presentation.ts`, and `webgl2-renderer.ts:2430-2471` establish the one finished
  offscreen scene and single fullscreen presentation write that the transition compositor extends.
- `apps/holtburger-3d/src/explorer/ExplorerApp.svelte:544-635` is the existing Explorer replacement
  path: it owns a current request revision and collision receipt but has no installed-scene or
  revealed-frame barrier. It is a migration/deletion target, not a second activation design.

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
   Every 3D replacement scene shares one portal install/reveal transaction; continuous streaming
   never impersonates that transaction.
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
| Replacement activation                | Explicit Explorer initial target or world-jump request revision             | Core `world_generation` for initial entry or accepted `PlayerTeleport`           | Mode adapter supplies one exact activation set and post-reveal handoff           | Shared installation barrier and portal controller |
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

The client authority publishes the exact local-player GUID as an independent session identity,
established by the server's `PlayerCreate` message and retained in the atomic application snapshot.
Lifecycle describes only the current entry/presentation phase. The app-host projection also
publishes one monotonic world generation/discontinuity edge
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

### World activation and ordinary streaming

Initial world entry, authoritative teleport, Explorer initial entry, and Explorer-directed world
jumps are replacement transitions. They enter one source-neutral 3D-app transaction whose
user-facing presentation is retail's portal space: the previous scene is withdrawn, destination
authority continues hydrating off-screen, collision and required render products become ready, the
transition compositor reveals one complete destination, and only then does the initiating mode
resume controls. Client core retains its generation-scoped lifecycle and ACE handoff; Explorer
retains its local authority. Neither grows parallel `teleporting`, `loadingScene`, or
`hasCollision` booleans.

Ordinary outdoor movement is not a replacement transition. Landblock demand continues to reconcile
incrementally through `SceneInterestCommitCoordinator`, retaining overlapping products while new
products prepare and old products evict. Portal activation and streaming share the same content and
realization machinery, but have explicit policies and completion contracts:

- ordinary scene-interest receipts acknowledge accepted demand only and never imply realization;
- a scene activation receipt names one initiating mode's current generation and completes only when
  its evidence-backed destination activation set is installed;
- a portal reveal receipt completes only after that installed destination produces one
  pure-destination frame; it is distinct from client `InWorld` or Explorer local handoff;
- a second transition supersedes the first, and stale installation, reveal, or handoff completion
  cannot activate either generation;
- network ingestion and authoritative destination hydration continue during portal space, while
  movement input, local physical advancement, ordinary camera advancement, and audio-listener
  ownership remain withdrawn; destination pixels may appear during input-free portal exit; and
- failures name the exact required owner/layer or authority prerequisite instead of presenting a
  partial destination as playable.

Phase 16 proved the required destination activation set from retail `CellManager` behavior and the
current render-policy closure. The retained evidence ledger below fixes outdoor and EnvCell layers,
player/camera staging, portal asset identities, renderer composition seam, resource lifetimes, and
retail timing so implementation does not reopen those questions from UI appearance.

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
| 12   | Physical host mode/event boundaries and vocabulary               | Medium         | 11                                |
| 13   | Retail server-correction convergence and differential oracle     | Large          | 12                                |
| C    | Authority/lifecycle re-audit before presentation teardown        | Small          | 12, 13                            |
| 14   | Focused client presentation and complete teardown                | Medium         | C                                 |
| 15   | Reproducible live, IPC, stress, and launcher integration evidence | Medium         | 14                                |
| 16   | Portal-space evidence, activation-set definition, and contracts   | Medium         | 15                                |
| 17   | One core-owned world-transition authority and physical cutover    | Large          | 16                                |
| D    | Transition authority and failure-semantics re-audit               | Small          | 17                                |
| 18   | Source-neutral destination installation barrier                    | Large          | D                                 |
| 19   | Required portal assets, compositor, and reveal handshake           | Large          | 18                                |
| 20   | Explorer/client discontinuity convergence                          | Medium-large   | 19                                |
| E    | Narrowed streaming and resource-lifetime re-audit                  | Small          | 20                                |
| 21   | Clean cutover, integration evidence, and vocabulary sweep          | Medium-large   | E                                 |

Phase 0 does not require a live entity census or encoded payload sample. Live ACE integration still
belongs to Phases 8 and 11, but a targeted census is added only if that verification exposes an
unexplained projection rejection or delivery-capacity problem. Phases 5 and 6 expose the spatial
risk before client UI and world-presentation integration without combining contract deletion,
collision loading, and body hydration into one review cliff.

Phases 16–21 are a post-acceptance architecture correction prompted by live teleport evidence. They
are intentionally not a narrow crash fix. Phase 16 must close the destination activation-set and
failure-semantics questions from retail evidence before any implementation begins. Normal outdoor
movement keeps using overlapping incremental streaming throughout this cutover. Initial world
entry, authoritative teleport, Explorer initial entry, and Explorer-directed world jumps use the
same portal activation transaction; only their post-reveal handoff differs.

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

| Arm                  | Fields                                    | Named consumer                                            |
| -------------------- | ----------------------------------------- | --------------------------------------------------------- |
| `Connecting`         | none                                      | client route connection status                            |
| `Authenticating`     | none                                      | client route authentication status                        |
| `CharacterSelection` | `characters: Vec<ClientCharacterSummary>` | character list and Enter World enablement                 |
| `EnteringWorld`      | `character_guid`                          | selection screen progress and duplicate-submit prevention |
| `InWorld`            | `player_guid`                             | viewer identity, scene interest, and input                |
| `Exiting`            | `cause: ClientExitCause`                  | terminal status plus Electron exit-status projection      |

`ClientCharacterSummary` is exactly `guid`, `name`, `slot`, and `delete_time`. The list row consumes
`name` and stable `slot`, the Enter World command consumes `guid`, and pending-deletion presentation
and command disablement consume `delete_time`. No character-creation fields cross the desktop wire.
`ClientExitCause` distinguishes explicit disconnect, server disconnect, startup failure, runtime
failure, and host shutdown; diagnostic text stays redacted and Electron-main-owned.

##### First-cut `ClientViewEvent` census and reconstructible state

Core retains its broad application API, but the desktop adapter consumes only this census:

| Current event/fact                                         | Fields consumed                                   | Level or edge                | First-cut consumer                                     |
| ---------------------------------------------------------- | ------------------------------------------------- | ---------------------------- | ------------------------------------------------------ |
| `StatusUpdate`                                             | `state`                                           | level                        | lifecycle projection                                   |
| `CharacterList`                                            | `guid`, `name`, list index as slot, `delete_time` | level                        | character selection                                    |
| `PlayerEntered` plus authoritative player state            | `guid`                                            | level                        | `InWorld.player_guid`                                  |
| `ServerTimeUpdated`                                        | `time`                                            | level after first sync       | regional environment clock                             |
| `DynamicEntity::{Snapshot,Upserted,Removed,Advanced}`      | existing focused contract                         | reconstructible level/deltas | shared dynamic mirror                                  |
| `RuntimeBodiesReset`                                       | `cause`                                           | edge                         | increment `world_generation`; replace focused state    |
| `ForcedReposition`                                         | `guid`, `pos`, `sequence`                         | edge                         | local-player reset classification and generation guard |
| `TeleportStarted`                                          | `sequence`                                        | edge                         | pending teleport classification; no replay             |
| `ActionResult`, `BootAccount`, `Disconnected`, task result | typed cause, redacted diagnostic                  | edge                         | Electron exit policy                                   |

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

The core client composition now owns two independent preparation lifetimes:

- `SimulationSceneResidency` tracks normalized desired owners, request/source generations, and one
  immutable installed scene. Every requested owner publishes as resident, pending, authoritatively
  absent, or failed. A successor is staged outside the simulation turn and atomically replaces the
  installed snapshot only after its complete batch resolves; pending, failed, and stale work never
  withdraws the current snapshot.
- Local-player body readiness is keyed only by `ClientPlayerIdentity` and immutable physical
  definition facts. Preparation is position-free. Accepted completion installs the definition with
  `set_dynamic_physical_body` against the live authoritative pose and current exact cell.

Desktop and TUI inject content access into the same core coordinator. Each composition owns one
coordinator and one `WorldState.scene`; the coordinator neither owns nor mirrors bodies. Ordinary
cell and landblock movement changes scene interest without rebuilding the local body. Teleport,
replacement, disconnect, and shutdown retain separate identity/generation guards for body work.
Presentation activation treats visual convergence, body readiness, and owner availability as
distinct facts; terminally unavailable collision does not strand an otherwise complete visual
destination, while dependent local motion remains non-committing.

##### Movement ownership and target simulation contract

The three-way trace assigns responsibilities as follows:

| Responsibility                                             | Current TUI-era path                                        | Explorer evidence                              | Target owner                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| held intent and edge ordering                              | `MovementSystem` queue/active drive                         | possession event queue                         | core client command arbitration                           |
| `MoveToState`, sequences, stop pulse, autonomous heartbeat | `MovementSystem`                                            | none                                           | core client protocol executor                             |
| axis/gait interpretation                                   | fixed capability-to-velocity/omega reduction                | `CharacterMotionController` plus motion tables | shared character controller validated against retail      |
| authored root offset                                       | world motion runtime, sometimes reduced by minimal solver   | possession motion runtime                      | world motion runtime, consumed once at actuation boundary |
| grounded actuation                                         | `LocalDriveControl` desired delta or `SolveProjectionBasis` | `authored_grounded_actuation`                  | small exhaustive world conversion functions               |
| jump                                                       | protocol/transient pieces, no full client composition       | shared jump resolver and grounded launch       | shared resolver; first-cut UI remains absent              |
| physical solve                                             | `SpatialPhysics` callback into owning scene                 | direct transactional scene call                | `SpatialScene::tick_physical_body_transaction`            |
| correction/interpolation                                   | sequence handling plus direct pose/projection paths         | no server producer                             | core client correction basis before solver/presentation   |
| presentation                                               | upsert-only for continuous client motion                    | fixed-tick `Advanced`                          | authority-clocked core advance batch                      |

The current premature reduction is `MovementSystem::current_local_solve_body_input`: manual
`CharacterDrive` becomes approximate velocity/omega before authored motion or collision. Autonomous
and server-controlled paths separately turn desired displacement into `LocalDriveControl`, and
arrival/snap paths mutate runtime pose directly. Protocol cadence and sequence fields stay in
`MovementSystem`; axis resolution, authored actuation, jump launch, collision solving, and accepted
path construction do not.

The closed movement bases remain honest until the solver boundary:

| Basis                                                      | Producer                              | Exhaustive conversion                                                         | Consumer                                  |
| ---------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| authored rigid offset                                      | motion runtime                        | `authored_grounded_actuation`                                                 | grounded scene transaction                |
| desired world displacement + desired heading + target hint | autonomous/server projection          | named displacement-to-grounded-actuation function using the one tick duration | grounded scene transaction                |
| retained velocity + omega                                  | canonical body/server kinematics      | response-specific coast/free-flight conversion                                | scene transaction                         |
| authoritative interpolation offset                         | server position interpolation manager | replacement actuation offset, never added to authored drive                   | constraint damping then scene transaction |
| resolved jump launch                                       | shared character jump resolver        | attach one `GroundedLaunch` to the selected grounded actuation                | scene transaction                         |

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

| Direction/name                          | Fields                                                                                 | Named consumer                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| private `start_client`                  | `host`, `port`, `account`, `password`                                                  | Electron main to one `ClientHostRuntime`; password released after login send |
| renderer `request_client_current_state` | none                                                                                   | lifecycle/dynamic lag recovery                                               |
| renderer `select_client_character`      | `guid`                                                                                 | explicit Enter World action                                                  |
| renderer `replace_client_drive`         | `gait`, optional `longitudinal`, optional `turning`                                    | basic held walk/run/turn controller                                          |
| renderer `disconnect_client`            | none                                                                                   | explicit disconnect/close                                                    |
| event `client_current_state`            | `lifecycle`, optional synchronized `server_time`, `world_generation`, dynamic snapshot | atomic mount/lag replacement                                                 |
| event `client_lifecycle_changed`        | complete `ClientLifecycleState`                                                        | selection/in-world/terminal route state                                      |
| event `client_server_time_updated`      | synchronized `time`                                                                    | environment clock                                                            |
| event `dynamic_entity`                  | existing `DynamicEntityEvent`                                                          | shared focused mirror/presentation                                           |
| event `client_world_discontinuity`      | `world_generation`, `kind`                                                             | clear interpolation and camera state before later placement                  |
| private `client_exit_requested`         | typed cause plus redacted diagnostic                                                   | Electron non-zero/zero exit policy                                           |

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

- [x] Rename the current Explorer-composed `HostRuntime` honestly before introducing the client
      composition.
- [x] Keep `HostContentState` discovery, content runtime, repository, and reusable command handlers
      in one shared capability owner.
- [x] Move Explorer entity, simulation, possession, camera, physical-flight, and fixed-tick
      construction under `ExplorerHostRuntime` without changing their behavior.
- [x] Add a `ClientHostRuntime` that owns no network task until Electron main supplies the one
      launch configuration through the private typed startup command.
- [x] Parse and validate host mode before expensive content or runtime construction.
- [x] Pass the already-resolved Electron entry to the child process without shell interpolation.
- [x] Parse client login flags in Electron main, reject missing/duplicate/malformed values before
      startup, and resolve `--server` versus `--host`/`--port` with documented TUI-compatible
      precedence. Reject an invalid embedded port instead of copying the TUI's default-port fallback.
- [x] Keep client login flags out of `buildEntryPath`, renderer query parameters, preload, renderer
      globals, and sidecar `argv`; send the validated composite value once over the private host
      pipe and release Electron's retained copy after startup settles.
- [x] Do not add `--character` auto-entry in this slice; character choice remains visible client UI.
- [x] Split protocol dispatch so a command unavailable in the selected mode returns a structured
      mode error even if a compromised renderer bypasses TypeScript types.
- [x] Split `HOST_COMMAND_NAMES`, `HOST_EVENT_NAMES`, and payload maps into composable inventories
      without reintroducing one giant application union in consumers.
- [x] Update sidecar smoke and protocol tests for both modes, startup mismatch, invalid command, and
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

- `HostRuntime` is now an enum over concrete `ExplorerHostRuntime` and `ClientHostRuntime` roots;
  shared `HostContentState` is composed once before selecting the root. This keeps the existing
  Explorer fields out of client mode instead of hiding them behind optional fields.
- The client root accepts and retains one private startup configuration but deliberately creates no
  `ClientRuntime` or network task yet. Phase 4 owns that task lifetime and the credential-release
  point after the login command is actually sent.
- The MessagePack handshake carries `host_mode`. Electron passes the resolved entry mode to the
  child with an argv array and rejects a mode mismatch before renderer IPC is enabled. Mode errors
  are also enforced in Rust so a renderer-side allowlist bypass cannot activate Explorer commands
  in client mode.
- The client renderer inventory is intentionally empty in this phase; renderer lifecycle commands
  are introduced with their named consumers in Phase 4 rather than inventing placeholder commands.
- The old status string was made mode-specific (`explorer-host-ready`/`client-host-ready`) and the
  sidecar smoke now runs both roots, sends the private client startup command, checks the cross-mode
  rejection, and verifies orderly shutdown.

### Phase 2: Cut over shared presentation vocabulary

#### Deliverables

- `GameRuntime` renamed to `GamePresentationRuntime`.
- `spawnedDynamic*` presentation vocabulary renamed to source-neutral `dynamicEntity*` vocabulary.
- Misleading Explorer comments and type names swept only where the surviving mechanism is already
  source-neutral.
- No construction, lifecycle, or behavior change.

#### Task checklist

- [x] Rename the runtime and every shared consumer in one vocabulary sweep; retain no alias named
      `GameRuntime`.
- [x] Rename spawned presentation maps, methods, diagnostics, tests, and comments that already
      accept authority-neutral dynamic views.
- [x] Keep producer identity/generation in the dynamic contract; source-neutral naming does not erase
      lifecycle guards.
- [x] Do not move Explorer policy modules merely to make the vocabulary grep cleaner.
- [x] Run type checks, lint, focused tests, and the canonical Explorer browser-harness smoke as a
      standalone mechanical milestone.

#### Acceptance criteria

- The rename is behavior-free and leaves no compatibility alias.
- `GameRuntime` and source-neutral uses of `spawnedDynamic*` have no surviving consumers.
- Explorer presentation behavior and harness evidence are unchanged.

#### Decisions and course corrections

- `GameRuntime` is now `GamePresentationRuntime`, including its file, tests, type references, and
  diagnostics comments. There is no compatibility alias; Explorer remains the current composition
  root but the type no longer claims authority over gameplay.
- The focused presentation adapter/file and owner IDs now use `dynamicEntity*` and
  `dynamic-entity:` vocabulary. Producer GUID and generation remain part of every resource owner and
  presentation identity, so the rename did not erase lifecycle barriers.
- Explorer scenario/control names were left in Explorer modules when they describe policy rather than
  the shared presentation mechanism. No Explorer module was moved merely to satisfy a grep.
- The mechanical cutover passed the full TypeScript suite (1,501 tests), app checks, dead-code lint,
  focused Rust checks, and the canonical browser harness. No behavior or renderer contract changed.

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

- [x] Extract a source-neutral `DynamicEntitySession` that owns listener-before-snapshot hydration,
      delta invalidation after declared loss, and replacement-snapshot installation behind injected
      subscribe/request-current-state functions.
- [x] Leave Explorer catalog search, spawn/despawn, possession, fixed-tick receipt, and diagnostics
      in the Explorer facade.
- [x] Extract presentation construction and ordered teardown from `ExplorerApp.svelte` into small
      owners with explicit dependencies and no Svelte state.
- [x] Keep frame-hot camera/entity/renderer facts imperative. Do not turn the extracted owner into a
      reactive store.
- [x] Keep camera policy, environment selection, render settings selection, scene-interest target
      selection, and UI layout outside the shared presentation owner.
- [x] Update misleading Explorer comments in shared asset sources, environment types, camera types,
      texture diagnostics, and tuning namespaces only where the second consumer makes the rename
      true.
- [x] Verify Explorer startup, outdoor/EnvCell streaming, dynamic entities, possession, map, audio,
      and teardown through the canonical browser harness and focused Electron smoke.

#### Acceptance criteria

- The shared presentation owner can be constructed without importing `src/explorer`.
- The presentation runtime consumes dynamic views without knowing which authority or producer made
  them.
- `ExplorerApp.svelte` no longer directly owns low-level renderer/content bootstrap and teardown.
- Explorer UI/control policy remains in `src/explorer`; no generic mode controller is introduced.
- Shared presentation construction retains the source-neutral vocabulary established in Phase 2.

#### Decisions and course corrections

- `DynamicEntitySession` owns only feed subscription, snapshot request ordering, mirror invalidation,
  and accepted-event observation. It accepts injected callbacks rather than host command/event names;
  Explorer keeps its catalog, mutation, possession, fixed-tick, and command-completion policy in its
  facade. Explorer installs its fixed-tick and possession listeners through the session's
  `beforeRequest` hook so every authority listener is live before the replacement snapshot request.
- `GamePresentationOwner` is an imperative, source-neutral composition owner. It builds the active
  region, profile cache, texture/static-detail path, WebGL2 device, commit pipeline, runtime workers,
  audio, ambience, and sky, and tears them down in the former dependency order. Audio tuning is an
  explicit dependency; camera policy, environment selection, frame settings, scene-interest
  coordination, and all Svelte state remain in `ExplorerApp.svelte`.
- `ExplorerApp.svelte` retains a borrowed `GamePresentationRuntime` reference for frame-hot calls,
  but no longer stores or tears down the low-level content/device/pipeline resources. The shared
  owner has no import edge into `src/explorer` and no reactive store.
- Shared cache comments now name the presentation owner/content host. Explorer-only diagnostics,
  controls, and scenario vocabulary remain local rather than being renamed for a hypothetical
  consumer.
- Full TypeScript checks and 1,504 tests passed; type/dead-code lint passed; the release sidecar
  smoke passed in both modes. Browser harness runs covered startup, outdoor and EnvCell streaming,
  dynamic realization, map drawing, authored audio/particle staging, lifecycle reload, and cleanup
  with no browser console errors. The documented possession scenario still reports its existing
  `Backward-plus-turn did not change both position and heading` assertion under the current harness
  timing; it is recorded as motion-policy debt and was not widened into this presentation-owner
  extraction.

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

- [x] Reuse the TUI's proven `ClientRuntimeBuilder` and command-channel composition without importing
      CLI state, retry, logs, reducers, or rendering.
- [x] Load the runtime bootstrap through `ContentRepository` at the content owner; do not pass disk
      paths or DAT policy into `holtburger-core` consumers.
- [x] Ensure a connect attempt has one owned lifetime and that late events from a retired attempt
      cannot update state during shutdown. The first cut creates no successor attempt.
- [x] Subscribe to core events before issuing initial-state and login commands.
- [x] On `CharacterEnterWorldServerReady`, have `ClientRuntime` send the retained selected GUID and
      account through `CharacterEnterWorld`; remove `SendCharacterEnterWorld` from frontend-facing
      command policy and migrate the TUI to observe lifecycle only.
- [x] Replace the partial initial-view response with one core snapshot carrying current status,
      character list, local-player identity, synchronized server time, dynamic entities, and runtime
      bodies where those facts are present.
- [x] Project only lifecycle, character-list, local-player, focused dynamic, server-time,
      correction/reset, and error facts required by the first cut. Movement capabilities remain
      inside core because no frontend consumer resolves movement from them.
- [x] Preserve server-provided character identity and slot facts losslessly enough for the selection
      UI; do not project complete character-creation data.
- [x] Capture tick-start projection facts before movement/world/simulation advancement, then publish
      one `Advanced` batch after accepted results. Use integrated single- or multi-leg paths for
      continuous motion and explicit teleport/reset kinds for discontinuities.
- [x] Keep remote entities server-authoritative and dead-reckoned in the first cut. Core may project
      their tick-start/end path, but neither the app host nor frontend physically resolves or
      re-derives their motion.
- [x] Make `ClientRuntime`'s existing 30 ms interval the only client session clock. Do not install
      the client as an Explorer `HostFixedTickParticipant` or run a parallel app-host interval.
- [x] Publish the ordered tick result through the existing `DynamicEntityAdvanceBatch`, consumed by
      focused entity delivery and, in Phase 10, boom advancement. Do not add a parallel receipt,
      open-ended post-tick callback, or plugin registry.
- [x] Keep the password out of query parameters, renderer state, sidecar arguments, logs, errors,
      retained diagnostics, and persistence; clear the startup value after the login command is sent.
- [x] Define receiver-lag recovery as an explicit current-state replacement path. Do not continue
      applying deltas after known loss.
- [x] Make task termination, core error, server disconnect, explicit disconnect, and sidecar shutdown
      distinguishable for diagnostics and exit status even though none produces an in-app retry.
- [x] On connection/login failure, server disconnect, or fatal client-runtime failure, emit one
      redacted diagnostic and request whole-application non-zero exit. Do not restart the network
      task or return the renderer to configuration.
- [x] Ensure host shutdown stops accepting commands, requests core disconnect when appropriate,
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

- `ClientHostRuntime` now owns one connect attempt, its command channel, broadcast receiver, and
  bounded shutdown. It uses the content owner's cached `WorldBootstrap`, so the client root never
  receives DAT paths or discovers content independently. The first-cut host currently injects
  `BasicSpatialPhysics` only as a temporary bridge; Phase 5/6 replace that callback with the shared
  collision coordinator and `SpatialScene` transaction path.
- Core now emits `ClientApplicationSnapshot` as the replacement level and owns the
  select/server-ready/enter-world choreography. The desktop adapter projects only the lifecycle,
  synchronized time, focused dynamic feed, discontinuity, and terminal-cause values with strict
  MessagePack/TypeScript validation. Character slots are protocol-order ordinals because ACE's
  `CharacterEntry` carries no separate slot field; preserving the list order is lossless for the
  existing selection protocol.
- Client simulation captures authority-owned views around its existing 30 ms turn and emits at most
  one non-empty `DynamicEntityAdvanceBatch`. Remote forced repositions are per-entity corrections,
  not world discontinuities; only the local player's correction invalidates the local timeline.
- The renderer session installs the dynamic listener and all sibling lifecycle listeners before its
  first replacement request and suppresses deltas while recovering. Client UI remains intentionally
  minimal until Phase 7; Phase 4 only wires the route's lifecycle owner and leaves presentation
  construction deferred.
- Verification passed on 2026-08-26: 248 core tests, 239 host tests, host clippy, workspace format,
  1,508 TypeScript tests, Svelte/type/dead-code/lint checks, Electron main build, host build,
  both-mode sidecar smoke, and the isolated-port browser harness (`--vite-port 1431`). The sidecar
  client smoke does not start a network attempt because its empty DAT fixture cannot build a real
  client bootstrap; focused core/host/session fixtures cover the typed adapter and lifecycle. The
  existing possession timing assertion remains documented Phase 3 motion debt.

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
presentation runtime. Phase 7 now consumes lifecycle values with a client-local reducer and does
not construct presentation resources before the authority reaches `in-world`.

#### Audit result — 2026-08-26

- Explorer and client are concrete `HostRuntime` enum arms. Explorer alone constructs the
  `ExplorerEntityRuntime`, `HostSimulationRuntime`, possession, physical-flight, boom, and fixed
  tick; client alone owns `ClientRuntime`, its command channel, receiver, and task. The shared
  content owner is the only deliberate common capability.
- `GamePresentationOwner`, `GamePresentationRuntime`, and `DynamicEntitySession` have no import
  edge into `src/explorer` or `src/client`; Explorer policy remains in `ExplorerApp.svelte` and its
  facades. Client lifecycle state is held by `ClientLifecycleSession` and is not duplicated in the
  presentation runtime.
- Every Phase 4 wire value has a named consumer in the Phase 7/8 lifecycle, drive, focused-feed,
  time, discontinuity, or terminal-exit path. Raw core/world/session/protocol values stop at the
  Rust host adapter. The client route currently starts only the lifecycle owner; visual construction
  is intentionally deferred until the lifecycle reaches the world in Phase 8.
- Collision is now a core-owned product/transaction seam: client and TUI inject the same
  `ContentClientCollisionSource`/coordinator, while each keeps its own `SpatialScene`. The old
  `SpatialPhysics` callback and constructors are gone; readiness guards local transactions and
  remote entities remain pose-only. Asset-free fixtures prove stale replacement, missing owners,
  invalidation, and the ready local transaction without inventing live DAT state.
- No proposed shared interface is single-implementation scaffolding beyond the explicitly staged
  collision source/coordinator seam. Phase 5 will keep the coordinator small and injected so its
  asset-free state machine can be tested without a DAT installation. No blocker or spicy decision
  was found; proceed to Phase 5.

### Phase 5: Stage client collision products and local-player body hydration

#### Deliverables

- Collision-product loading, interest, and immutable snapshot publication separated from body
  solving and usable by both desktop and TUI client compositions.
- One core client collision coordinator following authoritative local-player residency, shared by
  desktop and TUI compositions rather than duplicated as frontend policy.
- Generation-guarded physical-body preparation for the selected local player through the existing
  shared dynamic-body definition/profile path, performed outside network and simulation turns.
- Independent local-player body readiness and body-neutral `SimulationSceneSnapshot` contracts;
  neither duplicates canonical body state or makes static-scene publication depend on player pose.
- Explicit pose-only remote entities for the first cut; their server-authoritative placement and
  dead reckoning remain presentation inputs, not locally solved physical authority.

#### Task checklist

- [x] Build reusable core client collision coordination over `ContentAssetService`. Although its
      loader API is synchronous, stage loading away from the client simulation turn, then atomically
      publish the complete immutable `CollisionScene` revision.
- [x] Load the normalized authoritative owner and a one-owner-radius square. Keep the 3×3 product
      set independent from Explorer's 5×5 render/simulation policy.
- [x] Add a selected-player entity-to-`DynamicEntityDefinition` adapter, then prepare its physical
      definition through existing shared setup/profile functions outside network and simulation
      loops. Capture GUID plus instance generation and discard stale completion after replacement,
      deselection, disconnect, or shutdown.
- [x] Install a successful definition into the canonical local-player body through
      `set_dynamic_physical_body` and publish the resulting runtime-body/dynamic upsert.
- [x] Publish one composite readiness state so Phase 6 never pairs the canonical body with a
      collision revision for the wrong player residency or instance generation.
- [x] Keep render-resource interest separate from collision-product interest. Place reusable client
      collision coordination where it follows authoritative `WorldState` residency for both TUI and
      3D hosts without making either frontend a physics observer.
- [x] Compose both TUI and desktop clients with `ContentAssetService` and the same core collision
      coordinator. No frontend participates in collision interest.
- [x] Verify landblock and EnvCell crossings, superseded loads, stale body-preparation completion,
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
- The coordinator uses one `spawn_blocking` worker per target and discards completions by generation,
  request, exact player instance, residency, and body-definition facts. This keeps synchronous
  content APIs off the 30 ms turn without adding a second authority or frontend loading policy.
- Successful preparation installs the dynamic physical definition before publishing `Ready` and
  the immutable scene revision. Missing owners and missing player facts remain explicit
  `Unavailable`/`Waiting` states; no invented open-space fallback is allowed.
- Desktop and TUI inject the same `ContentClientCollisionSource`. Asset-free fixtures cover edge
  interest, missing content, stale replacement, invalidation, and missing identity facts; live
  DAT/server availability remains an external gate.

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

- [x] Keep `WorldState.scene` as the only client body store. Do not register client entities in
      `HostSimulationRuntime`.
- [x] Delete the `SpatialPhysics` trait, minimal/no-op implementations, scene callback field, and
      injection constructors in the same change that installs the Phase 5 product consumer. Replace
      marker-solver tests with transaction fixtures; retain no dual production path.
- [x] Keep mode-owned `SpatialScene` values. Explorer and client call the same world methods on their
      respective scenes; never copy or synchronize bodies between them.
- [x] Tick only the ready local player through `SpatialScene::tick_physical_body_transaction` in the
      first cut. Suspend it while the Phase 5 product is loading/unavailable. Continue advancing
      server-authoritative remote entities through their existing dead-reckoning/projection lane.
- [x] Fold `SpatialSolveRequest::local_drive` into a closed per-body movement basis rather than a
      sibling exception. Resolve each current authored offset, desired displacement, retained
      kinematics, or launch through its named stateless actuation conversion before solving.
- [x] Preserve the desired-displacement adapter where autonomous or server projection remains an
      honest producer. Do not retain the deleted minimal solver or invent a generic adapter trait.
- [x] Map `PhysicalBodyTickResult`, the accepted tentative body, collision reports, scene residency,
      and dynamic state changes into existing `WorldEvent` semantics inside the transaction callback;
      do not reapply solved kinematics after the scene commits.
- [x] Compose desktop and TUI clients with the same Phase 5 coordinator/product consumer and full
      transaction. No frontend participates in collision interest.
- [x] Add differential unit fixtures that feed equal body, collision, contact, and actuation facts
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
- The local transaction path uses a typed `PhysicalBodyActuation` adapter: autonomous/server desired
  displacement becomes one-shot velocity, while retained manual kinematics become grounded or
  free-flight actuation. Remote bodies stay pose-only/dead-reckoned and are never committed through
  the local collision scene.
- `apply_physical_body_tick_result` publishes committed runtime-body/contact semantics without
  reapplying pose or kinematics. Collision reports and scene residency remain in the result for
  future named consumers rather than being flattened into speculative wire events.
- The ready fixture uses a free-sphere body to isolate the transaction boundary without DAT setup
  geometry; production player hydration still prepares the existing grounded dynamic definition
  through the shared content path. This is test scope, not a production movement fallback.

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

- [x] Represent lifecycle as one discriminated state rather than interdependent booleans and
      nullable fields.
- [x] Do not project launch credentials into Svelte; the frontend begins in connecting state and
      learns only lifecycle outcomes.
- [x] Route structured terminal failures to Electron main for redacted diagnostics and non-zero
      application exit; do not render retry or editable-configuration controls.
- [x] Submit selection by exact server-provided GUID/slot identity; do not select by display name.
- [x] Require an explicit Enter World action for the current selection. Treat Enter and double-click
      as shortcuts for that action, not as separate lifecycle paths.
- [x] Follow the proven select/server-ready/enter-world choreography from Phase 0.
- [x] Keep character creation/deletion/restoration controls absent.
- [x] Add component/reducer tests for success, explicit entry, failure-driven exit, disconnect
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

- The client route is now a lifecycle-only composition root. Presentation construction remains
  deferred until the authority reports `in-world`, so connection/selection cannot accidentally
  create an Explorer renderer or a second client authority.
- `ClientLifecycleUiState` is a discriminated reducer state. Character selection is local UI state
  until the explicit Enter World edge; that edge carries the exact server GUID once, with session
  deduplication covering button, Enter, and double-click races.
- Credentials are never read by the renderer. Terminal host/client failures remain redacted
  diagnostics and the Electron main process owns non-zero application exit; the shell has no retry,
  editable configuration, or character-management controls.
- The reducer tests cover launch/authentication, list refresh preserving or clearing selection,
  explicit entry/in-world transitions, terminal failure absorption, and stale authority events.
  The lifecycle session tests cover listener-before-snapshot recovery, strict event projection,
  drive validation, and duplicate enter suppression. Component behavior is deliberately kept thin
  enough that these reducer/session contracts are the named test surface.
- Removing the old static `RouteShell` after this root cutover was required by dead-code lint; no
  compatibility wrapper remains without a real consumer.

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

- [x] Register the focused dynamic listener before requesting the current snapshot.
- [x] Reconcile snapshots, upserts, removes, and ordered `Advanced` batches through the same
      source-neutral mirror and presentation methods used by Explorer; add no client entity system.
- [x] Preserve the core-published host time, duration, generation, path, and advance kind. Do not
      resample poses in the app host or substitute frontend frame time for client authority time.
- [x] After declared feed loss, reject `Advanced` deltas until the complete replacement snapshot is
      installed, then establish a fresh host/frontend timeline from that snapshot.
- [x] Select the local player's projected entity only through the authority-published GUID.
- [x] Separate authoritative placement used for interest/residency from interpolated draw placement
      used for camera smoothness.
- [x] Route authoritative residency through the existing scene-target/profile coordinator; do not
      use frontend point containment to decide player residency.
- [x] Define behavior while the player is authoritative but not yet visually realized. Hold or show
      loading state; never fall back to free-fly authority.
- [x] Resolve regional time from the client server-time projection and make missing weather support
      explicit. Add/read an optional synchronized-time fact; do not use
      `WorldState::current_server_time`'s wall-clock fallback as server authority.
- [x] Put the audio listener at the accepted primary camera placement and orient panning with the
      camera's right axis, matching the existing presentation/controller contract. Keep render and
      collision interest on authoritative player residency rather than camera placement.
- [x] Reuse static content, sky, ambient, renderer, map geometry store, and dynamic visual sources
      from the shared presentation owner.
- [x] Prove outdoor-to-interior and teleport/reset demand transitions with synthetic fixtures before
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

- The client presentation root is `ClientPresentationSession`; it subscribes to the already
  listener-first `ClientLifecycleSession` rather than opening a second host feed. Snapshots and
  upserts/removals are serialized through `GamePresentationRuntime.reconcileDynamicEntities`, while
  accepted `Advanced` batches retain the host's time, duration, path, generation, and advance kind
  and enter `applyDynamicEntityAdvances` unchanged.
- Player residency is read from the authority-projected world placement and routed through
  `SceneInterestRequestCoordinator` with an `automatic-landblock` or `env-cell` target. The
  coordinator's resolved `outdoor`/`dungeon` policy remains the only static-demand decision; the
  interpolated scene origin is used only for the accepted camera eye and never feeds interest.
- Before dynamic visual realization or EnvCell topology is available the client reports a loading
  status and does not render a free-fly fallback. The camera uses a small first-cut rear framing;
  collision-safe boom/orbit/recenter policy remains Phase 10.
- Regional environment selection follows the retail `time + zero_time_of_year` calendar projection
  (`acclient.c:442706`) from the synchronized client server-time fact. No wall-clock fallback or
  server weather override is inferred; authored weather remains the explicit renderer default until
  a named protocol fact exists.
- `client-presentation-session.test.ts` covers synchronized calendar selection, listener-first
  snapshot reconciliation, authority-batch forwarding, feed-loss suppression, EnvCell-to-outdoor
  target transition, teleport/discontinuity scene-demand reset, and teardown. The isolated browser
  harness (`--vite-port 1431`) remains green; live ACE rendering is deferred to the final external
  prerequisite gate.

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

- [x] Split `MovementSystem` so movement packet construction, control/sequence edges, command
      arbitration, server correction, and honest protocol projection remain client-specific while
      character actuation, contact handling, and solving use the shared Phase 5 collision product
      and Phase 6 transaction path.
- [x] Remove the manual local velocity approximation once the shared path covers its consumers,
      including the fixed lateral/backward magnitudes. Do not retain it as a silent fallback.
- [x] Preserve the Phase 6 desired-displacement conversion for autonomous/server projection while
      migrating manual character locomotion to motion-table/authored actuation. Delete a basis only
      when no honest producer remains.
- [x] Adapt Explorer possession to call the shared basis-to-actuation functions while retaining
      Explorer intent, lifecycle, registry, scene, collision interest, and transaction orchestration.
- [x] Add differential unit fixtures that feed equal body, collision, contact, and drive facts
      through Explorer and client adapters and require equal actuation/solve results. Do not require
      their authorities or protocol outputs to be equal.
- [x] Implement retail interpolation as a basis that replaces authored offset for grounded bodies,
      including its target threshold, speed cap, heading policy, and progress watchdog. Apply
      constraint damping after interpolation/authored basis selection and before actuation.
- [x] Feed held input as semantic replacements and lifecycle edges at input cadence; let core own
      packet emission and physics cadence.
- [x] Clear held drive on blur, pointer/focus loss, disconnect, character transition, and teardown.
- [x] Prove diagonal, backward, turn-only, walk/run, stop, and rapid reversal behavior against the
      existing core movement tests and a focused live harness.
- [x] Prove server correction and teleport reset do not leave stale presentation interpolation,
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
- Manual prediction now owns a separate `BodyMotionRuntime` cursor. The authoritative snapshot
  cursor advances once for every other entity, while the local cursor is excluded only while a
  held manual drive is actually eligible; server correction therefore preempts authored motion
  without losing the semantic held drive for the handoff after arrival.
- `grounded_character_actuation` is the shared physical boundary. Explorer possession retains its
  target-authored/fallback channel policy and client movement retains its protocol policy, but an
  equal authored offset, pose, contact, scale, and tick now produces equal actuation; the host
  differential fixture exercises that contract.
- Correction uses a stateful retail-shaped cursor: a 5 cm target threshold, 7.5 m/s invalid/max
  speed cap, five-frame progress watchdog, and indoor `(5, 20)` / outdoor `(10, 50)` constraint
  edges. Interpolation replaces the authored translation, then constraint damping runs before
  actuation. The stateless fallback calls the same speed helper rather than maintaining a second
  cap formula.
- The client wire intentionally carries only gait, longitudinal, and turn. Lateral input remains
  in the shared controller for Explorer and future client protocol work; this is the Phase 0
  host-contract boundary, not an invented lateral wire mapping.
- Focused Rust fixtures cover authored diagonal/backward/turn-only/reversal and correction
  preemption; the browser harness remains synthetic and was run on isolated Vite port `1432`.
  A live ACE movement run was not executed in this worktree/session; the user-provided live ACE
  process remains an external final-session gate rather than being represented as synthetic
  evidence.
- Debt: the correction watchdog currently records failed progress and returns a zero basis; the
  caller still owns the eventual snap/failure policy. The client-side camera remains the Phase 10
  consumer of the accepted local path, and direct Svelte component tests for held-key lifecycle
  are still covered indirectly by the controller/session contracts.

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

- [x] Separate the current Explorer-bound host boom adapter from the reusable core boom behavior.
- [x] Inject a small authoritative target-path provider backed by the local-player advance in the
      closed `DynamicEntityAdvanceBatch`; do not resample the body or teach the boom about `ClientRuntime`,
      server packets, or Explorer GUID allocation.
- [x] Preserve one tick order when boom support lands: accepted entity advancement → boom solve →
      one ordered host publication. Do not add a boom timer beside the client runtime interval.
- [x] Keep DOM pointer capture, gesture scaling, inversion, and recenter UX in `src/client`.
- [x] Keep collision clearance and acknowledged projection in the host/controller path.
- [x] Use the local player as the character/map anchor and the camera as the primary render view;
      compute each choice once in the client composition.
- [x] Define behavior during teleport, loading, missing presentation, and disconnect explicitly.
- [x] Reuse the proven projection-clearance revision contract and retain no client-specific copy.
- [x] Verify indoor/outdoor transitions, obstructed zoom, orbit while moving, recenter, viewport
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

- The reusable product is the core `KinematicBoomController` plus a lossless placed-path serializer;
  the client adapter owns only local-player identity, installed simulation-scene access, and accepted
  `DynamicEntityAdvanceBatch` consumption. The Explorer adapter remains a separate host-owned
  composition and keeps its possession/body policy.
- Client camera registration is acknowledged by a `CameraStarted` event before the frontend accepts
  a path. Every output carries the exact fixed-step duration used by the authority; the frontend
  does not guess a cadence or schedule a second timer. The dynamic `Advanced` publication is sent
  before the matching camera event in the same client tick.
- A client camera renders after receiving a path whose diagnostics distinguish covered from
  uncovered topology. Loading, missing player presentation, and missing EnvCell presentation scope
  hold the frame; unavailable collision coverage does not withdraw an otherwise usable path.
  Teleport/reset/disconnect clears camera history, projection acknowledgements, and scene demand.
  The local player's authoritative residency drives scene demand, while camera placement drives the
  primary view and audio listener.
- Pointer capture, pixel-rate orbit, wheel accumulation, movement-triggered rear recenter, and
  touch-action policy remain in `src/client`; the shared controller is a source-neutral semantic
  orbit/recenter seam with no Explorer import or tuning dependency.
- Verification covers generic boom collision/recovery fixtures, client registration/identity,
  cumulative intent, stale-generation rejection, presentation loading/reset, transient unavailable
  coverage, TypeScript (1,526 tests), core (258 tests), host (241 tests), clippy, and
  the browser harness on isolated Vite port `1432`. The first-cut live sidecar evaluation is
  recorded in Phase 11; broader live ACE camera and streaming branches remain external.
- Concession: the current client feed emits one endpoint leg per accepted dynamic tick, so the camera
  consumes that closed path and retains its last target sample during stationary ticks. No map-heading
  consumer exists in this first-cut client surface, so no speculative map API or duplicate heading
  calculation was added.
- Debt: broader live-ACE camera and streaming matrices remain external; core and frontend camera
  fixtures now prove that unavailable coverage remains explicitly uncovered without terminating
  the client or withdrawing playback.

#### Camera coverage recovery

The collision coordinator retains its immutable installed scene while changed interest resolves.
Camera queries explicitly allow uncovered topology and publish a tagged covered/uncovered proof;
the frontend retains playback and exposes the latest proof through camera diagnostics. Ordinary
physical-body transactions continue to require complete coverage and reject without commit. Portal
discontinuity still retires the prior generation's camera path because that path belongs to a
different authoritative destination, not because static residency changed.

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

- [x] Sweep `GameRuntime`, `spawnedDynamic`, and inappropriate Explorer vocabulary from surviving
      shared symbols, metrics, docs, comments, tests, tuning, and UI labels. Historical plan
      entries retain the retired names only when describing the completed migration.
- [x] Remove the static client `RouteShell` path and any shared app components left without a
      consumer.
- [x] Remove unused wire variants and fields discovered during implementation; every survivor needs
      a named scenario where it differs from another value.
- [x] Inspect `ExplorerApp.svelte` and `ClientApp.svelte` for duplicated low-level construction or
      frame sequencing and collapse only proven duplication.
- [x] Inspect the Rust mode compositions for duplicated authority, content cache, collision scene,
      motion catalog, task, or event buffering.
- [x] Treat all TypeScript lint, dead-code, Svelte, Rust clippy, and formatting warnings as errors.
- [x] Run the canonical browser harness for Explorer presentation regression and synthetic
      client-feed scenarios. The harness covers the renderer/possession path; client-feed and
      camera-feed fixtures are covered by the focused TypeScript contracts and presentation tests.
- [ ] Run both Electron modes through startup, shutdown, protocol failure, host crash, and package
      inspection. Sidecar mode smoke, protocol failure tests, release packaging, and archive
      inspection pass; a GUI launch is unavailable in this environment because no `DISPLAY` or
      `xvfb-run` is installed.
- [x] Run the client first-cut workflow against a configured ACE server without invoking the TUI.
      The headless sidecar evaluation authenticated, selected the available character, entered
      world, exercised camera and short-drive commands, and disconnected explicitly. The remaining
      live branches are listed below rather than inferred from this single account/world state.
- [x] Record any unavailable external prerequisite exactly and retain synthetic evidence where
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

- Resteering B found no duplicated client body store or camera clock. `ClientRuntime` remains the
  sole fixed-step authority; the camera consumes that turn's accepted dynamic advance batch, and
  the host publishes the dynamic event before the matching camera event. The frontend mirror and
  scene-interest request use the authoritative local-player identity/residency, while camera
  placement is downstream view/audio state.
- Every shared extraction now has a second concrete consumer: the dynamic feed/realization seam is
  used by Explorer and client, and the core boom/path product is consumed by both host compositions.
  No generic mode root, shared authority, or speculative map-heading API was introduced. The
  latest-wins camera playback buffer is bounded (two pre-registration ticks plus one active and one
  pending path), so queue pressure cannot create a second clock.
- The final vocabulary sweep removed retired runtime names from `apps/` and `crates/`; the last
  private harness variables were renamed to `postSpawnDynamics`/`postDespawnDynamics`. The route
  shell and its orphaned tests are gone, and no unused client wire variant was found.
- Verification is green for the focused and repository gates: world 432 tests, core 267 tests, host
  244 tests,
  TypeScript 1,526 tests, Svelte/TypeScript checks, ESLint/knip, Rust clippy/check/format, the
  browser harness on isolated Vite port `1432`, sidecar smoke for both modes, release package
  inspection, and archive inspection. The browser harness emits no page console errors.
- Electron GUI startup cannot be exercised here because the environment has no display server or
  `xvfb-run`; sidecar startup/shutdown, mode rejection, protocol tests, and packaged executable
  inspection remain the available evidence. A later headless client-sidecar evaluation against the
  user-supplied ACE endpoint authenticated successfully, entered the available character, emitted
  308 focused upserts and 99 authority-clocked advances, produced one camera reseed plus 193
  advanced camera ticks, and disconnected explicitly. The live payload census measured 621 protocol
  frames, 1,153,508 encoded payload bytes total, a 4,398-byte maximum, and a 3,031-byte p95. The
  remaining live-server branches are recorded as gaps below rather than synthetic evidence.
- Follow-ons are named rather than scaffolded: add standalone core camera lifecycle fixtures if
  camera authority changes make the current host/client seam insufficient; add a map-heading
  consumer only when a real client surface needs it; and extend the live ACE matrix when additional
  character/world scenarios are available.
- A post-acceptance camera correction introduced `ChildSpatialBody`: a parent-driven, non-responsive
  sphere whose portal membership is reconciled by the shared spatial solver. Client camera targets,
  host boom targets, and Explorer physical-fly viewer projection now share this primitive. This
  removes camera-offset contamination of authoritative player residency and preserves exact deep
  EnvCell identity instead of re-normalizing an indoor position as an outdoor landblock.

### Convergence invariants

Phases 12–15 adopt the cleaner parts of the independent implementation without treating that
worktree as ground truth. Retail behavior is re-proved from `acclient-eor-source/`; ACE protocol
behavior is re-proved from `ACE/`; and current runtime contracts remain the executable baseline.
Every convergence phase must preserve these already-correct properties:

- local-player physical-definition readiness and body-neutral simulation-scene residency remain
  independent, generation-guarded products;
- the coordinator retains the installed scene while a successor is pending, and each authority tick
  samples one immutable snapshot for physical transactions and camera queries;
- `ClientApplicationSnapshot` remains one atomic replacement level after declared event loss;
- camera generation, accepted authority path, projection-clearance revision, covered/uncovered
  collision proof, and frontend playback acknowledgement remain explicit;
- explicit disconnect and orderly host shutdown remain successful terminal states, while startup,
  server, runtime, and unexpected host failures retain typed non-zero exit causes; and
- desktop and TUI continue to compose the same core collision coordinator, client simulation, and
  `SpatialScene` transaction rather than receiving frontend-specific forks.

### Phase 12: Make host mode boundaries and surviving vocabulary physical

#### Deliverables

- Split the current host composition into colocated shared-content, mode-selection, Explorer,
  client, and client-projection modules; retain one enum composition root rather than introducing a
  universal authority trait.
- Replace the universal host event sink with distinct Explorer and client publication contracts,
  implemented by the one stdio writer only at the protocol boundary.
- Give shared content, Explorer, and client commands explicit module-owned inventories and
  dispatchers while preserving the existing closed wire grammar and structured unknown-command and
  wrong-mode errors.
- Emit honest Explorer event names directly from Rust and remove the TypeScript wire-name
  translation map in the same cutover.
- Rename the world module that now contains only non-colliding projection/dead-reckoning helpers
  from `spatial/physics.rs` to `spatial/dead_reckoning.rs`; sweep the retired vocabulary from code,
  tests, metrics, and permanent docs.

#### Task checklist

- [x] Move `HostMode`, shared content ownership, `ExplorerHostRuntime`, `ClientHostRuntime`, and
      client projection out of the current broad `runtime.rs`/`client_host.rs` review surfaces.
- [x] Define mode-local command enums and dispatch functions. If `serde(untagged)` weakens malformed
      or unknown-command diagnostics, retain a small explicit outer decoder rather than accepting a
      generic decode error for architectural neatness.
- [x] Split `HostEventSink` so neither concrete runtime receives methods for the other authority.
- [x] Rename `physical-fly-*` and remaining `host://` compatibility vocabulary at producer,
      decoder, listener, harness, and documentation sites in one change.
- [x] Rename the dead-reckoning module and require `rg` to find no surviving `SpatialPhysics`,
      `spatial physics`, or obsolete physical-event aliases outside historical plan text.
- [x] Update `README.md`, `AGENTS.md`, and `ARCHITECTURE_AUDIT.md` with the physical module and
      capability boundaries.

#### Acceptance criteria

- A client-mode process cannot publish or dispatch an Explorer capability through its injected
  Rust types, and the inverse holds for Explorer mode.
- Shared content remains one composition value, not copied into both authorities or hidden behind a
  universal runtime interface.
- Existing atomic client snapshot, collision, camera, and typed-exit contracts are byte-for-byte or
  behaviorally unchanged except for the deliberate event-name cutover.
- Both modes pass command-name inventory, wrong-mode rejection, unknown-command, handshake,
  sidecar-smoke, TypeScript, Rust, and package protocol tests.

#### Decisions and course corrections

- The shared content owner now lives in `shared_host_content.rs`, while the selected runtime enum
  remains the small composition root in `runtime.rs`. Client and Explorer command enums and
  dispatchers are colocated with their authorities; the shared command dispatcher owns only static
  content and status. The wire `HostCommand` uses an explicit command-name decoder rather than
  `serde(untagged)`, preserving the offending unknown command in the decode diagnostic while
  retaining the existing nested MessagePack envelope.
- Rust capability tests cover inventory ownership, MessagePack decoding, unknown-command
  diagnostics, and wrong-mode rejection. TypeScript inventory tests cover route startup commands,
  privileged-startup exclusion, and complete per-mode event/command composition. Focused host and
  Electron protocol tests remain green after the event-name and module cutover.

### Phase 13: Complete retail server-correction convergence

#### Deliverables

- One client-specific server-correction state machine covering retail's ignore, hard-set, snap, and
  interpolation dispositions before its ordered interpolation-assignment and constraint-damping
  stages.
- Wraparound teleport-sequence comparison, missing-cell handling, airborne suppression, MoveTo
  heading ownership, retail snap radius, progress watchdog, and indoor/outdoor leash distances
  proved from cited retail code.
- An independently structured retail differential oracle that compares decisions and tick outputs
  without importing or calling the production implementation.
- Ordinary confirmed local-player position updates routed through the same correction decision as
  server-controlled movement, without treating authoritative placement as an additive local drive.

#### Task checklist

- [x] Re-read and cite the relevant `MoveOrTeleport`, interpolation-manager, constraint-manager,
      viewer-distance, and heading-ownership branches in `acclient.c`; do not port constants or
      decisions merely because the independent implementation used them.
- [x] Replace the partial correction cursor with one composite correction state whose variants make
      ignored, directly placed, and interpolated updates exhaustive.
- [x] Preserve authored motion and correction ordering: interpolation may replace translation,
      constraint may scale the survivor, and uncorrected ticks retain authored rotation/omega.
- [x] Route ordinary confirmed local-player positions, force positions, teleport/reset, and
      server-controlled targets through explicit disposition handling exactly once.
- [x] Add an independent differential fixture covering sequence wraparound, missing cell, grounded
      and airborne updates, near/far targets, heading pinning, stalled progress, threshold edges,
      and indoor/outdoor constraints.
- [x] Re-run the existing manual movement, authored actuation, full-solver, packet cadence, TUI, and
      camera-discontinuity tests to prove correction did not become a second movement authority.

#### Acceptance criteria

- Production correction agrees with the independent retail oracle across the complete decision and
  tick matrix, including boundary values and sequence wraparound.
- A server update is classified once; consumers do not re-derive snap, interpolation, contact, or
  heading policy.
- Local-player solving still requires the current atomic collision/body snapshot, and remote
  entities remain server-authoritative dead reckoning.
- Live movement evidence, when available, records server observation and client convergence rather
  than blessing distance travelled alone.

#### Decisions and course corrections

- `CPhysicsObj::MoveOrTeleport` (`acclient-eor-source/acclient.c:311475-311523`) is the source of
  truth for stale/wrapped teleport sequences, missing-cell recovery, airborne suppression, the
  96m snap threshold, and the `MoveTo` heading handoff. `InterpolationManager::adjust_offset` and
  `UseTime` (`acclient.c:372004-372165`) prove assignment-before-watchdog ordering, the
  `adjusted_max_speed * 2` step cap, the 0.05m completion threshold, five-frame progress windows,
  and the four-failure blip fallback. `ConstraintManager::adjust_offset` and `ConstrainTo`
  (`acclient.c:372268-372340`) prove post-interpolation damping and the indoor/outdoor constraint
  distances exposed by `GetStartConstraintDistance`/`GetMaxConstraintDistance`
  (`acclient.c:304336-304373`). The implementation records those citations beside the shared
  constants and does not treat the independent fixture as authority.
- `ServerCorrection` owns the disposition, interpolation node, constraint leash, and prepared tick
  together. `MovementSystem` classifies ordinary self-position, force-position, teleport/reset,
  and server-controlled updates once, while `ClientRuntime` applies the resulting translation and
  heading at the local physical actuation boundary. Hard sets and snaps update the world pose and
  emit one discontinuity; they do not leave an additive local drive behind. Remote entities remain
  server-authoritative dead reckoning.
- The differential oracle is deliberately structurally independent: it duplicates the cited
  decision ladder and tick arithmetic without importing production correction code. Fixtures cover
  wraparound, missing cells, contact/airborne branches, snap/interpolation boundaries, heading
  ownership, watchdog failure, and indoor/outdoor damping. A production-specific concession is that
  the classifier derives `distance` from the canonical local runtime pose because this repository's
  event contract does not carry a separate retail `player_distance` field; the threshold behavior
  is still exercised at exact boundary values.
- The old fallback-speed expectation of 7.5m/s was corrected to retail's
  `adjusted_max_speed * 2` rule (with 7.5m/s only when no valid adjusted speed exists), preventing
  the test suite from blessing a slower but non-retail cap.

### Resteering C: Re-audit authority and lifecycle after structural convergence

Before changing frontend composition, dry-run the surviving host and client paths and reassess:

- whether the host split removed universal capabilities without creating mirrored boilerplate;
- whether correction state or mode dispatch now duplicates an authority-owned fact;
- whether atomic snapshot, collision/body readiness, camera withdrawal, and typed exit semantics
  still have one producer and one unambiguous consumer path;
- whether the current large frontend files contain separable ownership or merely long but cohesive
  orchestration; and
- whether live entity volume requires bounded presentation work before component extraction can be
  judged safe.

Record any changed ordering or subdivisions here before Phase 14. Do not use file-size reduction as
an excuse to move imperative frame-hot policy into Svelte components.

Outcome: the re-audit retained one authority for lifecycle, world state, collision readiness,
camera withdrawal, and dynamic presentation. It approved focused Svelte consumers and a shared
imperative teardown owner, while rejecting forwarding-only wrappers and any move of frame-hot policy
into components. The observed live entity volume also justified a bounded request gate before the
presentation extraction was considered complete.

### Phase 14: Decompose client presentation without weakening its contracts

#### Deliverables

- A small client lifecycle root plus focused character-selection and in-world presentation
  components; presentation, camera, input, and scene-interest behavior remain in testable owners and
  controllers rather than component-local state machines.
- One shared presentation owner with cooperative construction cancellation and a reverse-order,
  best-effort teardown stack that releases every acquired resource after partial startup failure.
- Current dependency injection retained for audio context/tuning and focused tests; global tuning is
  not pulled into the owner merely to shorten call sites.
- Renderer warning/error forwarding to the terminal, with high-volume informational logging opt-in.

#### Task checklist

- [x] Extract `ClientCharacterSelect.svelte` and `ClientWorldView.svelte` only after naming the
      lifecycle and frame-hot contracts each consumes; keep credentials and host startup outside
      both.
- [x] Keep `ClientLifecycleSession`, `ClientPresentationSession`, `ClientCameraSession`, and
      `DynamicEntitySession` source-neutral and testable; split oversized files along ownership
      boundaries instead of converting them into a larger collection of forwarding wrappers.
- [x] Replace nested/partial presentation cleanup with one registered teardown stack that runs all
      releases in reverse acquisition order and reports aggregate shutdown failures.
- [x] Add cooperative cancellation checks between expensive asynchronous construction steps and
      prove an in-world-to-exiting race leaks no host listener, worker, audio context, GPU device,
      scene-interest request, or animation frame.
- [x] Preserve camera projection-clearance revisions, authority-clocked path interpolation, held
      snapshot withdrawal, authoritative player scene interest, and camera-owned audio placement.
- [x] Forward renderer warnings/errors through Electron main without exposing credentials or
      turning per-frame diagnostics into default console noise.

#### Acceptance criteria

- `ClientApp.svelte` owns lifecycle composition and routing only; child components own presentation
  markup and browser event attachment, while imperative authorities remain outside Svelte.
- Partial construction failure and every unmount/lifecycle race release all acquired resources once
  in dependency order.
- The refactor changes no client wire payload and retains the atomic recovery snapshot, typed exit
  causes, camera clearance acknowledgement, and dynamic mirror invalidation behavior.
- Explorer and client still construct the same source-neutral presentation owner with no import
  from one mode into the other.

#### Decisions and course corrections

- `ClientApp.svelte` is now a lifecycle/routing root. `ClientCharacterSelect.svelte` consumes only
  the discriminated character-selection state and explicit selection/entry callbacks;
  `ClientWorldView.svelte` consumes the camera/status surface and owns canvas pointer, wheel, and
  orbit event attachment. Credentials, host startup, lifecycle reduction, camera policy, scene
  interest, and frame-hot simulation remain in the source-neutral sessions and imperative owners.
- `GamePresentationOwner` registers every acquired resource in one reverse-order teardown stack.
  Cleanup attempts all registered releases and reports an `AggregateError` with resource labels,
  rather than allowing an early destroy failure to strand later resources. `ClientPresentationSession`
  aborts construction before teardown, waits for the in-flight start promise, then releases camera,
  listeners, scene coordination, and presentation ownership exactly once. Tests cover partial
  acquisition, reverse order, aggregate failures, cancellation, and owner-release failure.
- Expensive owner construction checks an `AbortSignal` between active-region/static-detail, GPU,
  commit/runtime, ambient, and sky stages. The renderer console bridge forwards warnings/errors to
  Electron main; informational messages remain opt-in through `HOLTBURGER_RENDERER_VERBOSE=1`, so
  per-frame diagnostics do not become default terminal noise and credentials are never included in
  the bridge payload.

### Phase 15: Retain reproducible live evidence and close integration blind spots

#### Deliverables

- A checked-in non-interactive client sidecar probe that accepts credentials only through the
  environment, exercises connect/select/enter/drive/camera/disconnect, and emits machine-readable
  lifecycle, movement, entity-census, frame-count, and encoded-payload measurements.
- Retain the concrete launcher/tooling seams as first-class diagnostics: a reusable
  `scripts/live-client-probe.mjs`, `scripts/entry-paths.test.ts` coverage for the shared launch
  tokenizer and isolated-port resolver, and a mode-inventory test for the host transport allowlists.
- A bounded synthetic client-feed/browser scenario at the observed 308-entity count and a larger
  600-entity stress point, proving presentation reconciliation cannot exhaust the sidecar's
  emergency pending-request cap.
- End-to-end encoded-field and IPC-startup tests covering Rust-to-TypeScript spelling, early renderer
  requests, invalid launch arguments, normal disconnect, and fatal exit.
- Dev client, Explorer, and browser harnesses using random Vite ports by default and explicit
  `--vite-port` overrides, with one shared tokenizer for spaced/equal launch flags and proof that
  credentials never enter a URL, log, renderer route, or sidecar argv.
- Final GUI/live matrix evidence, with unavailable character/world scenarios recorded exactly.

#### Task checklist

- [x] Retain a reusable sidecar probe under `apps/holtburger-3d/scripts/`; extend the existing live
      census to record travelled distance, lifecycle sequence, camera hold/reseed/advance counts,
      dynamic snapshot/upsert/remove/advance counts, encoded bytes, maximum frame, and p95.
- [x] Add a package script for the probe that does not place account or password values in process
      arguments and never starts the interactive TUI.
- [x] Reproduce the pending-request scenario with deterministic fixtures before selecting a bound;
      put concurrency/back-pressure at the presentation/content-request owner rather than
      serializing the entire frame loop. The later live Explorer radius-eight request proved 289
      landblock batches are legitimate input, so the emergency protocol ceiling moved from 256 to
      512 while the requester remains bounded to 32 active batches.
- [x] Prove encoded Rust lifecycle and local-player identity contracts cross the real decoder
      independently, and prove a renderer request arriving before host startup waits for the
      selected host rather than racing an empty allowlist.
- [x] Project ordinary login rejection, including already-logged-in `CharacterError.Logon`, into one
      redacted typed terminal cause instead of waiting for a generic transport timeout.
- [x] Implement and exercise explicit Disconnect and window-close exit zero after bounded logoff,
      while startup, rejected login, server disconnect, runtime failure, host crash, and protocol
      failure exit non-zero once without duplicate dialogs. Explicit disconnect, sidecar shutdown,
      and all failure causes are exercised here; GUI window-close execution remains a display-server
      prerequisite.
- [x] Run the browser/CDP harness on an isolated random port; verify canvas sizing, initial
      no-camera frames, dynamic realization, renderer console visibility, and process-group cleanup.
      Electron GUI startup/close remains an explicitly recorded environment gap.
- [ ] Complete the extended live matrix when server state permits: rejected authentication,
      multiple-character selection, landblock crossing, observed EnvCell entry/exit, teleport/reset,
      obstructed zoom, orbit while moving, recenter, projection growth, and server-initiated
      disconnect. Outdoor and deep-dungeon residency are proven separately; neither is evidence of
      the transition between them.

#### Acceptance criteria

- The retained probe reproduces the live workflow and payload census without GUI interaction,
  credential persistence, TUI execution, or orphaned client processes.
- A 600-entity focused feed stays below the proven request-concurrency bound, reaches stable visual
  reconciliation, and reports every refused entity with identity and cause rather than an aggregate
  count alone.
- Rust-to-TypeScript spelling and early IPC startup are exercised end to end, not only by Rust value
  comparisons and hand-written TypeScript fixtures.
- Normal and fatal termination have distinct tested exit codes and one diagnostic surface.
- All original Phase 11 gates plus the new probe, stress, IPC, and GUI/live gates pass or name their
  exact unavailable external prerequisite.

#### Decisions and course corrections

- `scripts/live-client-probe.mjs` is a direct sidecar client, not an Electron or TUI wrapper. It
  takes account/password only from `HOLTBURGER_PROBE_ACCOUNT` and `HOLTBURGER_PROBE_PASSWORD`,
  selects the first (or requested) character, waits for an identity-bearing player update before
  starting the camera, drives briefly, observes camera and dynamic events, disconnects explicitly,
  and emits one JSON report. It measures lifecycle order, unique/peak entities, travelled distance,
  camera/discontinuity counts, per-event frame counts and encoded MessagePack bytes, maximum frame,
  and nearest-rank p95. The live ACE run on 2026-08-26 authenticated `+Holtfighter`
  (`0x50000001`), entered world, observed a 27.36m drive, 99 camera ticks, 300 dynamic events,
  roughly 90 unique entity GUIDs, 410 event frames, 814,059 encoded event-frame bytes, a 4,374-byte
  maximum, and a 3,124-byte p95; explicit disconnect and sidecar shutdown exited zero. The first
  run exposed an empty initial current-state snapshot, so the probe now waits for the authoritative
  player upsert/advance before camera start rather than treating that normal stream race as failure.
- `probe:client` builds the Electron protocol and release host, then invokes the environment-only
  probe. No credential is placed in its argv, URL, renderer route, emitted JSON, or retained stderr;
  failures are redacted. The normal `dev:client`, `dev:explorer`, Vite-only, and browser harness
  wrappers all resolve a free loopback Vite port by default and accept explicit `--vite-port`
  overrides. One tokenizer accepts both `--name=value` and `--name value`, while preserving the
  client's ACE `--port` separately from the renderer port.
- The presentation owner caps concurrent dynamic visual requests at 32, below the shared
  `MAX_PENDING_REQUESTS = 512` sidecar circuit breaker. Deterministic 308-entity and 600-entity
  fixtures complete with a peak of 32 requests and preserve generation/identity refusal causes;
  the feed is not serialized. Scene landblock batches now use the same generalized request gate at
  a 32-request bound and reject stale queued revisions before host invocation.
- Rust MessagePack tests encode a real `ClientLifecycleChanged::InWorld` event with its local-player
  GUID and decode it through the TypeScript contract. The Electron IPC gate test sends a request
  before host startup completes and proves it waits for the selected client host. Existing host
  protocol tests cover password clearing, mode allowlists, protocol failure, host crash, and bounded
  shutdown; the core login test maps `CharacterError.Logon` during authentication to the typed
  `server-disconnect` exit cause.
- Browser/CDP evidence ran with the default random Vite port and passed canvas sizing, initial
  no-camera rendering, static realization, and zero page console errors; sidecar smoke covered both
  mode handshakes and clean shutdown. The supplied ACE account exposed only one character. The
  original probe covered an outdoor session; a later probe initialized and advanced the camera
  successfully while the observed world was in the `0x1D90...` dungeon owner that previously
  triggered indoor-landblock normalization. This proves deep EnvCell operation, not an observed
  entry/exit transition. Rejected authentication, multiple-character selection, landblock crossing,
  EnvCell entry/exit, teleport/reset, obstructed zoom, recenter/projection growth, and
  server-initiated disconnect remain explicit external matrix gaps rather than invented passing
  evidence.

### Phase 16: Prove portal-space semantics and freeze the activation contract

This is an evidence and design phase. Do not alter runtime behavior until its acceptance criteria
are met.

#### Deliverables

- A checked trace of initial entry, teleport, ordinary outdoor streaming, same-residency hard
  correction, cross-residency forced reposition, reset, and feed-recovery behavior. Each trigger is
  classified as a replacement activation, an in-place presentation discontinuity, or recovery;
  similarly named events are not assumed equivalent.
- A retail evidence note covering `SmartBox::HandlePlayerTeleport`
  (`acclient.c:137285-137310`), `SmartBox::PlayerPositionUpdated`
  (`acclient.c:138537-138578`), `SmartBox::UseTime` (`acclient.c:140020-140031`), and the portal-space
  viewport in `gmSmartBoxUI::UseTime` (`acclient.c:252638-252789`). The note must trace the
  `position_update_complete`, `blocking_for_cells`, and prefetch decisions far enough to identify
  the minimum destination activation set rather than inferring it from the UI string.
- One composite activation contract, provisionally `ClientWorldActivation`, with exactly one world
  generation, cause, player identity, authoritative destination residency when known, and readiness
  state. Every field must have a named core, host, or frontend consumer.
- A prerequisite table naming which layer owns destination authority, local body relocation,
  collision readiness, static render readiness, local-player visual readiness, initial camera
  placement, installation, reveal acknowledgement, mode handoff, and input ownership.
- Characterization tests that reproduce both live failures without local DAT dependencies: an
  indoor destination paired with stale outdoor spatial membership, and a placed-motion EnvCell
  absent from the currently installed collision scene.
- A measured sLOC and deletion inventory for the post-Phase-16 cutover, including the existing discontinuity,
  the pre-cutover loading state, and false-ready receipt paths expected to disappear.

#### Task checklist

- [x] Trace `CellManager::PreFetchCells` and its callers through the retail decompile; record whether
      destination neighbors and each static layer block portal exit. Corroborate content semantics
      in ACViewer/ACE where the decompile is incomplete.
- [x] Trace current code from position messages through `set_local_player_runtime_pose`,
      `apply_forced_reposition_reset`, collision coordination, `PresentationDiscontinuity`, frontend scene
      demand, realization, camera seeding, and input acquisition. Name every stale level and early
      acknowledgement.
- [x] Decide the exact closed transition variants and replacement triggers. Initial entry and
      teleport are mandatory replacement triggers; forced reposition and reset require evidence
      rather than name-based promotion.
- [x] Define the destination activation set separately for outdoor and EnvCell residency. Derive it
      once in the frontend layer that owns render policy and carry the exact set in the activation
      request; downstream readiness checks must not re-derive it.
- [x] Specify supersession, cancellation, timeout, content-failure, disconnect, and renderer-crash
      semantics. A failure clause is accepted only with a fixture that reaches it and one distinct
      diagnostic.
- [x] Dry-run the contract through the desktop client, TUI composition, snapshot recovery, a second
      teleport before the first completes, and ordinary landblock crossing.

#### Acceptance criteria

- No unresolved question can change which products block activation, which layer owns the state, or
  whether a trigger enters portal space.
- The proposed contract has one transition generation and no interdependent optional fields or
  renderer-derived authority facts.
- Ordinary open-world streaming remains on the current diff-based coordinator and never waits for a
  global scene-complete condition.
- The phase identifies concrete code to delete or collapse; it does not merely wrap the existing
  discontinuity edge in another state machine.

#### Evidence and decisions

Retail's blocking unit is the complete configured scene closure, not one destination cell:

- `SmartBox::HandlePlayerTeleport` clears `position_update_complete` and enters the waiting state
  only for an accepted teleport timestamp (`acclient.c:137285-137310`).
- `SmartBox::PlayerPositionUpdated` clears completion, runs the teleport hook, drops command focus,
  and calls `CellManager::ChangePosition(..., true)` for teleport placement
  (`acclient.c:138537-138578`). Non-teleport blips call the same operation without blocking.
- While `CellManager::blocking_for_cells` is true, `SmartBox::UseTime` performs only the prefetch
  check instead of object maintenance, physics, landscape time, and ambient time. It marks position
  complete only after blocking ends (`acclient.c:140013-140031`). Network dispatch continues so the
  destination can hydrate.
- Outdoor `CellManager::PreFetchCells` walks the configured square landscape radius. Each owner
  prefetches its landblock, landblock info, and every building portal's stab EnvCells
  (`acclient.c:140311-140389`, `296053-296145`, `336406-336432`, `337951-337981`,
  `347593-347609`). An EnvCell destination prefetches the cell itself, its owner landblock and
  landblock info, all building portal stab cells, and the outdoor landscape closure when the cell
  sees outside (`acclient.c:333897-333978`, `334831-334858`).
- Retail hides the normal SmartBox and shows the portal-space viewport until teleport animation
  finishes (`acclient.c:252638-252789`). `SendLoginCompleteNotification` then waits recursively for
  every object named by the player's item/container closure before emitting login complete
  (`acclient.c:383229-383277`, `417770-417806`); the emitted UI action is opcode `0x00A1`
  (`acclient.c:664098-664116`).
- ACE confirms that `GameActionLoginComplete` means the client exited portal space for both initial
  login and teleport (`ACE/Source/ACE.Server/Network/GameAction/Actions/GameActionLoginComplete.cs`).
  ACE keeps the player hidden, collision-ignored, and `Teleporting` until that action, then waits for
  critical destination world objects before materializing the player
  (`ACE/Source/ACE.Server/WorldObjects/Player_Location.cs:654-765`). Its five-minute teleport limit
  logs off a client that never completes rather than granting partial entry
  (`ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs:107-139`).

Retail portal presentation and the checked-in DAT content fix the buildout shape more narrowly than
the activation trace alone:

- `TeleportAnimState` is the closed sequence `Off`, `WorldFadeOut`, `TunnelFadeIn`, `Tunnel`,
  `TunnelContinue`, `TunnelFadeOut`, and `WorldFadeIn` (`acclient.h:3369-3378`). Ordinary accepted
  teleport enters `Tunnel` directly; the outgoing-world fade path is used by logoff, not the normal
  teleport edge (`acclient.c:252638-252671`). Therefore blending or warping the outgoing world into
  the tunnel is a deliberate enhancement, not evidence of retail behavior.
- `gmSmartBoxUI::PostInit` creates a dedicated portal viewport containing one physics object, one
  distant light with intensity `2.0` and direction `(0.3, -1.9, 0.65)`, and a fixed camera at
  `(0.24, -2.7, 0.88)` using the SmartBox FOV (`acclient.c:252537-252561`). This is presentation
  furniture, not a second world or spatial scene.
- On first tunnel display, retail loops the resolved animation at exactly 40 fps. It eases the
  viewport yaw between random headings over 0.6–1.8 seconds and displays
  `In Portal Space - Please Wait...` (`acclient.c:252671-252740`). Once destination readiness arrives,
  it remains in `TunnelContinue` for at least two seconds and exits near an authored animation seam,
  or after five seconds at the latest. Tunnel fade-out and incoming-world reveal each take one
  second (`acclient.c:252741-252799`). The incoming reveal changes view-distance/FOV rather than
  sampling a retained world texture (`SmartBox::SetOverrideFovDistance`,
  `acclient.c:136977-137003`).
- The retail asset mapper record `0x25000000` names mapper `0x25000010` as `UIASSET`.
  `portalspace_background` resolves to setup `0x02000306`; `portalspace_animation` resolves to
  animation `0x030005AC`. The setup has two parts sharing model `0x0100080B`; that model has 352
  vertices, 360 draw polygons, zero physics polygons, and two surfaces. The animation has 120
  frames, two part tracks, no root-position track, and one direct `SoundTweaked` hook at frame 2.
  At retail's explicit 40 fps it is a three-second loop. These values were decoded from
  `dats/assets.hba` through the checked-in `holtburger-dat` readers, not inferred from screenshots.
- Portal audio has two evidenced consumers. `UIASSET` key `0x10000003` resolves UI sound table
  `0x2000004B`; transition entry key `Sound_UI_EnterPortal = 0x6A` resolves its sole candidate
  `0x0A000246`, while exit key `Sound_UI_ExitPortal = 0x6B` resolves `0x0A000245`. Both candidates
  have priority `0.9`, probability `1.0`, and volume `1.0`
  (`acclient.h:3760-3761`, `acclient.c:251982-252003`, `252782-252789`,
  `ClientUISystem::GetUISoundTable` at `384060-384065`). The animation hook separately names sound
  DID `0x0A000316` with probability `1.0` and volume `0.3`. All three waves are present and unpruned
  in `dats/assets.hba`; preparation must retain both the UI-key resolution path and direct hook sound
  rather than assuming the setup owns one default sound table.
- One portal material names an absent first texture source level and a present 32×32 alternative;
  the other resolves a present 128×128 source. `material_graph.rs:276-293` intentionally selects the
  first available source level, and existing repository fixtures prove this missing-first-level
  pattern is not portal-specific. The generic host projection succeeded, so this is not an
  activation blocker; visual comparison may later test whether retail chooses the same level.
- A temporary non-retained probe loaded setup `0x02000306` through
  `object_resource_closure.rs`/`setup_visual_source.rs` into a complete 76,524-byte visual envelope
  and loaded animation `0x030005AC` into a 7,444-byte envelope. No new DAT decoder, baked asset,
  synthetic entity, or offline conversion is required. The probe was removed after recording these
  measurements so implementation should consume this ledger rather than repeat discovery.
- `setup_visual_source.rs` accepts only a setup DID and appearance and returns a generic decoded
  static presentation. The former entity-specific source vocabulary was removed; dynamic entities
  and portal preparation now share the setup-visual transport and decoder rather than a second path.
- `animation-playback.ts` and `animation-asset-repository.ts` already support an explicit clip rate.
  Portal playback requests the evidenced 40 fps as its authored traversal rate; like ordinary
  authored entities, it samples a fractional frame at render cadence. Changing the repository's
  general 30 fps default would alter unrelated authored animation, while quantising the portal to
  40 render updates would visibly diverge at 60/120 Hz.

The current WebGL2 renderer already provides the future-effects seam:

- Both physical schedules render into one `WebGL2FlatSceneTarget`, and
  `WebGL2Renderer.#presentFlatScene` performs the frame's only default-framebuffer write
  (`webgl2-renderer.ts:2430-2471`). `WebGL2FlatScenePresentation` is already a fullscreen triangle
  that samples the finished scene and applies color grade exactly once. The transition compositor
  belongs at this final presentation boundary; nothing may draw afterward and escape it.
- Portal presentation therefore needs one world runtime and one WebGL context. During a transition,
  the compositor may sample an outgoing RGBA8 snapshot, a live authored tunnel target, and the
  existing flat-scene target as the incoming destination. The first implementation may use a hard
  switch or simple blend while preserving those semantic inputs. Later screen-space warping changes
  only this compositor, not activation, residency, or core contracts.
- An outgoing RGBA8 snapshot plus an RGBA8/D24 tunnel target costs 12 transient bytes per rendered
  pixel: approximately 23.7 MiB at 1920×1080 and 94.9 MiB at 3840×2160, scaled by
  `renderScale²`. Allocate them only while a transition owns them, diagnose exact bytes, and do not
  retain outgoing depth unless a proved depth-aware effect consumes it.
- Object draw preparation is currently private inside `WebGL2Renderer`. Phase 19 must extract or
  reuse the smallest renderer-local object submission primitive needed by the portal pass. It must
  not duplicate material/shader policy or insert the tunnel object into `SceneGraph` merely to reach
  existing drawing code.

Resource ownership is closed by the same evidence. Portal setup/model/material, animation, and
required audio are a tiny frontend ambient closure required by every 3D presentation composition.
`PreparedAssetRepository` already provides shared preparation and exact retained handles, while
`SkyScriptSystem` demonstrates why a small closed ambient closure is retained for the presentation
lifetime instead of evicted and re-fetched on each activation. `GamePresentationOwner` owns one
prepared `PortalTransitionAssets` composite and a stable renderer resource owner independent of
world generation. Tunnel targets, outgoing snapshots, and transition clocks remain transient and
generation-scoped. Failure to prepare a required portal asset is presentation-construction failure:
the loading presentation cannot first be fetched by the loading operation it exists to cover.

The current client violates that protocol boundary in two places. `PlayerCreate` and
`PlayerTeleport` each call `send_login_complete` immediately in
`crates/holtburger-core/src/client/messages.rs`; renderer and collision readiness are not consulted.
The same file also treats an inbound `GameAction::LoginComplete` as the state transition even though
ACE defines `0x00A1` as a client action and sends no completion echo; active lifecycle must follow
the successful outbound action instead of waiting for an unreachable mirror message.
One teleport also emits both `RuntimeBodiesReset` and `TeleportStarted`, and
`handle_runtime_world_event` independently increments `world_generation` for both. The frontend
then clears demand on each edge but calls a scene target resolved as soon as
`updateSceneInterest` accepts it. `SceneInterestReceipt` reports dispatch acceptance only; terrain
generation, static/EnvCell atlas realization, player visual realization, and the first camera path
may all still be pending. `ClientApp.svelte` also retains input ownership because teleport does not
leave its broad `in-world` state.

Explorer is the remaining discontinuous-hydration consumer. `ExplorerApp.svelte:544-590` reserves
one monotonic scene-interest request revision, releases camera/possession authority, awaits target
resolution, requests collision interest, and forwards the resolved target to the camera coordinator.
That revision proves the frontend already has a supersession identity for explicit world jumps, but
resolution still does not await installed render products or a reveal transaction. Phase 20 should
adapt that existing request revision as the Explorer transition generation if its currentness domain
remains exact; it must not mint a second counter that can drift. The same file's separate
simulation-interest receipt (`ExplorerApp.svelte:596-635`) remains collision evidence, not render
installation or reveal evidence.

The physical stale level is equally concrete. `SpatialScene::suspend_runtime_bodies` retains
`PhysicalBodyState.response` and dynamic `placement`; `set_local_player_runtime_pose` later changes
only the pose; `set_dynamic_physical_body` deliberately preserves compatible response/placement
memory when geometry is unchanged. A destination EnvCell can therefore coexist with old outdoor
membership. `apply_forced_reposition_reset` claims reset semantics but delegates to the same
pose/kinematics-only `reset_body_from_authority`. Conversely, `relocate_dynamic_body` already
rebuilds response and membership from destination residency, zeros kinematics/contact, and ends
collision reports, so Phase 17 is a call-path cutover and deletion rather than a new solver feature.
The renderer failure has another contributor: world liveness conservatively retains potentially
stale world entities for 25 seconds, while the client presentation currently reconciles the entire
mirror against whichever static scopes happen to be installed. Portal entry must withdraw those
visuals and active reconciliation must require installed scope without deleting authority state.

Replacement-trigger classification is closed as follows:

| Producer or situation | Classification | Reason |
| --- | --- | --- |
| Character selection through first player creation | Replacement activation: `initial-entry` | ACE begins with `Teleporting = true`; retail sends login complete only after cells and containment exist |
| Accepted `PlayerTeleport` message | Replacement activation: `teleport` | This is the protocol edge that selects blocking `ChangePosition` and invalidates the previous scene |
| `RuntimeBodiesReset(TeleportOrWorldReset)` emitted beside either trigger | Consequence of that activation, never a second trigger | It suspends bodies but carries no independent destination or protocol identity |
| Local `ForcedReposition`, including cross-residency correction without `PlayerTeleport` | In-place physical and presentation discontinuity | Retail `BlipPlayer` uses non-blocking `ChangePosition`; it updates streaming interest but does not enter portal space |
| Remote forced reposition | Per-entity correction | It cannot invalidate local scene or control authority |
| TUI `Resync` or desktop replacement snapshot after receiver loss | Recovery | It replaces mirrors/caches without telling ACE that portal travel occurred |
| Explicit disconnect, server disconnect, host failure | Terminal transition | It cancels activation and never emits login complete |

Each 3D mode's frontend adapter computes one exact resolved `SceneInterestMap` from its render
policy; the source-neutral activation coordinator consumes that set unchanged and no downstream
consumer recomputes a smaller set. Client uses the current client radii below; Explorer preserves
its explicit selected radii while gaining the same installation semantics:

- For a dungeon-only target, the set is the destination owner's complete `EnvCells` layer. Its
  completion means shells, portal scopes, static residents, companion authored dynamics, textures,
  map geometry, and the exact destination EnvCell scope were atomically published.
- For an outdoor or mixed target, the set contains every terrain owner inside `terrainRadius`, every
  Buildings/Objects/Generated layer inside its enabled radius, and every profile-approved EnvCells
  layer inside `envCellRadius`. With today's client policy this is terrain radius 3,
  Buildings/Objects/Generated radius 2, and EnvCells radius 1. All requested layers block first
  reveal; radius growth is not deferred because retail prefetch blocks its configured landscape
  closure, and revealing a scene while its own configured visible layers are absent would recreate
  the half-installed state this cutover removes.
- `scene-content-unavailable` is success only for a layer not present in the resolved set. For a
  requested layer it is an exact activation failure. Empty authored object categories must publish
  an empty layer rather than masquerade as unavailable.
- Terrain completes only when generation succeeded and its draw unit's geometry and every texture
  binding are resident. The current `outdoor-terrain-source-available` event is too early. Static
  and EnvCell layers complete from `StaticLayerRealizer`'s failure-atomic `published` result.

The closed application contract uses the existing `world_generation`; it does not add an activation
generation that could drift from it. The shell-facing lifecycle gains one composite portal state:

```text
PortalSpace {
  world_generation,
  cause: InitialEntry | Teleport,
  player_guid,
  destination: AwaitingPlacement
             | Loading { residency, player_entity_generation }
}
```

The destination variant prevents an old player pose from becoming the new target before an
authoritative post-trigger placement arrives. Core internally retains the same identity plus two
independent prerequisite products: spatial readiness (destination body plus matching collision
revision) and composition reveal readiness. The desktop supplies reveal readiness only after an
installed destination has passed through portal exit and produced its first pure-destination frame;
TUI and non-rendering diagnostics use an immediate adapter because they own no asynchronous visual
product. Immediate reveal readiness never bypasses spatial or containment readiness. Core emits the
existing ACE `LoginComplete` action once all of these facts match:

1. authoritative destination and current player entity generation;
2. complete recursive player containment hydration, matching retail
   `AllContainedObjectsExist`;
3. relocated local body plus collision scene containing the destination residency;
4. composition-provided reveal readiness; and
5. for desktop, installed activation set, current player visual, one collision-backed input-free
   initial camera placement, and the first pure-destination frame behind that reveal readiness.

| Prerequisite or handoff | Owning producer | Named consumer and decision |
| --- | --- | --- |
| `world_generation`, cause, player GUID | `ClientRuntime` transition authority | Snapshots, host projection, and frontend currentness reject retired work |
| Awaiting/known destination residency and player entity generation | `WorldState` projected once by `ClientRuntime` | Collision coordinator and desktop scene-target resolver start only from the known variant |
| Recursive contained-object closure | `WorldState` player/inventory authority | Core activation conjunction withholds ACE login complete |
| Relocated body response and spatial membership | `SpatialScene::relocate_dynamic_body` through `WorldState` mutation | Collision coordinator and dynamic projector consume one destination-consistent body |
| Destination collision snapshot/revision | `ClientCollisionCoordinator` | Local solve remains stopped; camera may produce one seed; core activation conjunction records spatial readiness |
| Exact static activation set | Frontend scene-interest policy and presentation runtime | Produces `SceneActivationReceipt` after every requested layer is installed; it does not claim reveal or handoff |
| Current player visual | Dynamic presentation owner | Installation barrier rejects mirror-only or stale entity generations |
| Dynamic installed-scope eligibility | Frontend presentation policy over producer-projected membership | Hidden staging selects the player attachment closure; active reconciliation suppresses old/unresident world roots without deleting mirror authority |
| Initial camera placement | Core boom over matching collision, installed by frontend camera session | Installation barrier guarantees transition exit has a usable destination camera |
| Composition reveal readiness | `PortalTransitionController` after the first pure-destination frame, or immediate TUI/non-rendering adapter | Core activation conjunction accepts only the current world generation |
| ACE `LoginComplete` | `ClientRuntime` after the conjunction | ACE materializes the player; core publishes active `InWorld` only after send success |
| Input and interactive camera/audio ownership | Frontend lifecycle/presentation root | Enabled only by active `InWorld` for the same generation; destination pixels may be visible during portal exit while controls remain withdrawn |

`LoginComplete` changes the lifecycle to active `InWorld`; it is not sent once on receipt and again
on reveal acknowledgement. The current `PresentationDiscontinuity` edge remains only for Phase
16-classified in-place correction/recovery; its narrower name is now used across the surviving host
and frontend contracts.

Failure and concurrency policy is also closed:

- A newer replacement trigger cancels the prior activation and owns a newly incremented
  `world_generation`. Late collision, content, dynamic, camera, or renderer completions are stale
  no-ops with no diagnostic.
- Required collision/content/player/camera preparation returning an explicit failure is a typed
  runtime failure naming the generation and exact prerequisite. It disconnects without sending
  login complete. A requested unavailable layer is the same failure class.
- There is no client-authored elapsed timeout. Retail remains blocked and ACE already owns the
  five-minute session limit; inventing a shorter value would be ungrounded. Progress diagnostics may
  name the pending prerequisite without mutating state.
- Explicit disconnect bypasses the barrier, cancels owned work, and follows normal disconnect
  policy. Server disconnect, renderer loss, or host failure follows the existing typed terminal
  path. Activation acknowledgement transport failure is a host/runtime failure, not a retry.
- Dynamic and containment deltas continue into the current authority/mirror while visibility is
  gated. No frozen destination snapshot or replay queue is added; the current generation and player
  entity generation make stale completion rejectable. Portal entry withdraws every realized dynamic
  visual without deleting the authority mirror. Hidden staging realizes only the local-player root
  and its transitive attached descendants; nearby destination entities do not block retail login
  complete.
- After activation, the client presentation reconciles only roots whose complete producer-projected
  spatial membership is backed by the currently installed `SceneInterestMap`, plus their attached
  descendants. This is presentation eligibility, not entity authority or a coordinate containment
  guess. It prevents conservatively retained old-scene entities from requiring outdoor scope in a
  dungeon (world liveness intentionally retains potentially stale visible entities for up to 25
  seconds) and naturally admits destination entities as their required layers install.

The dry-run leaves one-way dependency flow: authority publishes portal state and destination
identity; the presentation runtime installs the exact render-policy set and returns
`SceneActivationReceipt`; the app-local portal controller reveals the installed destination and
returns one generation-only `PortalRevealReceipt`; client core joins that receipt with containment
and spatial readiness and emits ACE login complete. Explorer instead completes its local handoff
from the same reveal receipt. A second discontinuity supersedes every pending product. Ordinary
landblock crossing never creates portal state and continues through the existing incremental
coordinator. Snapshot recovery reconstructs the complete portal state and pending destination
without manufacturing either receipt. Old-scene dynamic authority may survive conservative
pruning, but no old visual survives portal entry or bypasses installed-scope eligibility.

The measured pre-cutover cleanup inventory contained 45 broad-discontinuity vocabulary occurrences,
37 client-specific spellings, eight scene-key readiness references, five old loading-state
references, three immediate `send_login_complete` call/definition sites, three
`apply_forced_reposition_reset` references, and two `reset_body_from_authority` references. The
original Phase 16 estimate of 430 additions before 180 deletions covered only core relocation and a
combined activation/UI barrier; authored rendering, retained ambient resources, and Explorer
cutover were not yet evidenced. The implementation record preserves this as historical deletion
evidence rather than a net-line budget; the surviving code has one transition controller, one
snapshot owner, and one active scene-interest path.

Asset-free characterization is complete. A temporary focused world test reproduced an indoor pose
paired with retained outdoor `SpatialMembership` after `apply_forced_reposition_reset`; it was
removed after the diagnostic run so broken behavior is not preserved as a contract. The retained
`missing_retained_env_cell_fails_loudly_without_outdoor_fallback` test reproduces the second failure,
and the retained `dynamic_relocation_clears_pose_dependent_state_and_moves_membership_atomically`
test proves the existing positive primitive Phase 17 must route through. Both focused diagnostic
runs passed; Phase 17 replaces the temporary negative characterization with a positive
world-mutation regression.

### Phase 17: Cut over core world-transition authority and physical relocation

#### Deliverables

- One core-owned activation state shared by desktop and TUI client compositions. Network ingestion
  and world hydration continue during activation, while drive acceptance, local physical ticks, and
  ordinary camera advancement are gated by that state.
- Initial entry and every Phase 16-proven replacement trigger enter the same generation-scoped
  activation path. The complete application snapshot carries this level, so receiver recovery
  cannot reconstruct an impossible `InWorld` state from a pose alone.
- The existing ACE `LoginComplete` action moves from message receipt to the activation conjunction;
  its successful send is the one transition from portal space to active `InWorld`.
- Recursive player containment readiness matching retail `AllContainedObjectsExist`; initial entry
  cannot complete while an item or nested container named by authority is absent.
- One discontinuous body-placement primitive that relocates the canonical local body from
  authoritative destination residency and rebuilds physical response, portal membership,
  kinematics, contacts, and reports together.
- Collision coordination targeted to the activation generation and destination residency. Stale
  collision/body completion is discarded; matching readiness may produce one non-advancing camera
  seed but cannot activate controls by itself.
- A typed external-readiness acknowledgement seam with two real adapters: desktop feeds the
  matching post-reveal acknowledgement, while TUI/non-rendering compositions inject immediate
  reveal readiness because they own no asynchronous visual product. Core owns the
  conjunction and no adapter can bypass containment or collision readiness.

#### Task checklist

- [x] Replace the production `EnteringWorld`/early `InWorld` handoff with the Phase 16
      `PortalSpace` composite and its closed destination variant; do not add a parallel
      `isTeleporting` level. The public `EnteringWorld` sentinel remains only for defensive
      pre-activation snapshots and test adapters.
- [x] Route discontinuous authoritative placement through `SpatialScene::relocate_dynamic_body`.
      The misleading pose-only reset path no longer claims to clear physical response or
      membership.
- [x] Publish activation generation and destination facts atomically with dynamic and runtime-body
      replacement state. Network deltas continue flowing into the hidden destination generation.
- [x] Remove immediate `send_login_complete` calls from player creation and `PlayerTeleport`.
      The existing protocol action is sent once after matching containment, collision/body, camera,
      and composition readiness; no second core acknowledgement was invented.
- [x] Delete the unreachable inbound `GameAction::LoginComplete` lifecycle branch. Active `InWorld`
      is published only after the current activation's outbound action is accepted by the session.
- [x] Collapse the `RuntimeBodiesReset` plus `TeleportStarted` pair into one generation increment
      and one portal transition. The body reset remains an effect of the transition.
- [x] Hold movement protocol intent at idle, stop local solving and camera advancement, and reject
      stale drive/camera commands while activation is pending. The existing movement reset emits
      one stop edge when active play is left.
- [x] Accept reveal readiness only for the current generation and required adapter. An acknowledgement
      before collision/body readiness records its fact but does not make the world active.
- [x] Keep same-residency server correction on the correction path; discontinuous corrections still
      use physical relocation without being promoted to portal travel.

#### Acceptance criteria

- Publishing `0x01D90100` as the local player's authoritative destination cannot coexist with an
  outdoor physical response or outdoor dynamic spatial membership.
- An EnvCell placed-motion update cannot reach the solver until the matching collision scene owns
  that cell.
- Matching collision and composition-provided reveal readiness activate exactly once; stale,
  duplicated, or reordered acknowledgements do not. Missing recursive containment also keeps
  activation pending.
- ACE observes exactly one `LoginComplete` after readiness and none on cancellation or failure.
- Desktop and TUI use the same core transition invariant without importing desktop render policy
  into `holtburger-core` or `holtburger-world`.

### Resteering D: Re-audit the transition authority before renderer cutover

Dry-run the Phase 17 result before changing presentation:

- prove that protocol lifecycle, world activation, and presentation readiness are distinct facts
  but not competing state authorities;
- check that the external-readiness adapter is justified by both desktop and TUI consumers rather
  than being a renderer callback hidden in core;
- verify that initial entry and teleport traverse the same state edges and that ordinary streaming
  traverses none of them;
- inspect every generation comparison and remove any duplicate generation that cannot differ; and
- confirm that the one-shot camera seed has no control input, tick loop, or authority side effect.

If these checks reveal mirrored state or a circular host/renderer dependency, revise Phase 17 before
starting Phase 18. Do not compensate in TypeScript.

### Phase 18: Add a source-neutral destination installation barrier

#### Deliverables

- A source-neutral `SceneActivationRequest` carrying the exact Phase 16 activation set, transition
  generation, and one closed view-subject variant: a camera-only Explorer anchor or an entity anchor
  with exact root identity. Its `SceneActivationReceipt` completes when those
  products are installed and ready to reveal. It does not mean they were displayed or that controls
  may resume. The existing `SceneInterestReceipt` continues to mean accepted demand only.
- A one-shot activation coordinator over the same content preparation, installation, eviction, and
  dynamic realization mechanisms used by normal streaming. It creates no second scene, duplicate
  resource cache, or global blocking mode inside `SceneInterestCommitCoordinator`.
- Installed-scope dynamic eligibility shared by activation and ordinary reconciliation. A world
  root is presented only when every producer-projected outdoor/EnvCell scope it names is resident;
  attached descendants follow their eligible root. Authority mirrors remain lossless.
- Destination staging that withdraws old realized dynamics, stages an entity view subject and its
  transitive attachments when that variant is present, and installs one input-free camera seed.
  Camera-only Explorer activation invents no dynamic root. Presentation remains hidden behind the
  transition owner until Phase 19 chooses to reveal it.
- Exact required-product failure diagnostics. Optional neighboring streaming products retain their
  ordinary non-blocking policy after activation.

#### Task checklist

- [x] Add installation-complete signals for the exact required static layers. Existing EnvCell
      topology and terrain realization ownership provide the signals; readiness never polls private
      renderer maps or elapsed frames.
- [x] Make terrain completion mean a resident draw unit, not merely an installed source. An
      unavailable requested layer is an activation failure, while empty authored categories publish
      an empty layer.
- [x] Define and consume the closed camera-only/entity-anchor view-subject union. Dynamic
      realization carries a generation-specific root readiness fact for the entity variant, and the
      collision-backed input-free camera seed is required for both. Mirror presence alone is not
      visual or camera readiness.
- [x] Withdraw every realized dynamic on activation entry, then stage only an entity view subject
      and its transitive attached descendants when that variant is present. After handoff,
      presentation filters by complete producer-projected membership against installed scope rather
      than coordinates.
- [x] Replace the old scene-key readiness inference with the activation receipt; a returned
      scene-interest revision remains acceptance-only.
- [x] Keep normal `updateSceneInterest` reconciliation active after handoff for outdoor radius
      growth, overlapping landblock installation, and incremental eviction.
- [ ] Cover partial startup, teardown during activation, superseding activation, stale async
      installation, and exact required-content failure without leaking workers, audio, GPU
      resources, or host listeners. A delayed activation regression exists; the full failure matrix
      remains verification debt.

#### Acceptance criteria

- `SceneInterestReceipt`, `SceneActivationReceipt`, and later `PortalRevealReceipt` are different
  types with one reachable completion condition apiece.
- No destination is offered to the transition compositor until its complete activation set,
  required entity-view visual closure when present, and collision-backed camera seed are installed
  for the same generation.
- Walking across an outdoor landblock boundary retains overlapping content and input; it does not
  enter activation or await `SceneActivationReceipt`.
- The implementation reuses one presentation runtime and residency engine and adds no shadow scene
  graph.

### Phase 19: Install required portal assets and the reveal compositor

#### Deliverables

- One required `PortalTransitionAssets` ambient composition built and retained by
  `GamePresentationOwner`: setup `0x02000306`, animation `0x030005AC` at explicit 40 fps, their
  generic visual/material closure, UI sound table `0x2000004B`, and the three required waves. One
  typed app-local catalog contains these evidenced identities; generic content sources resolve them
  and frontend ownership chooses that the closure is mandatory. Do not add a runtime `DidMapper`
  subsystem solely to rediscover this fixed, closed catalog.
- A clean rename/generalization of the entity-named setup visual source. Dynamic entity and portal
  consumers use the same generic host transport, decoder, template preparation, texture atlas, and
  geometry machinery; no compatibility alias or bespoke portal decoder survives.
- A renderer-local authored tunnel pass using the retail camera/light evidence and one stable
  portal resource owner. The tunnel is not a scene node, spatial resident, collision body, dynamic
  entity, or second `GamePresentationRuntime`.
- A final-frame transition compositor extending the existing single default-framebuffer write. Its
  closed input names outgoing snapshot availability, live tunnel presentation, incoming installed
  scene availability, and transition progress. Color grading remains after composition and runs
  exactly once.
- An app-local `PortalTransitionController` with closed, generation-keyed states: `Entering`,
  `Waiting`, `Exiting`, and `RevealedAwaitingHandoff`. Initial entry has no outgoing snapshot;
  supersession while already in portal space never captures the tunnel as an old world.
- A `PortalRevealReceipt` emitted once after the first pure-destination frame for the matching
  generation. Destination pixels may appear during `Exiting`, but input, ordinary camera advance,
  and listener ownership remain withdrawn until the mode-specific handoff completes.

#### Task checklist

- [x] Prepare the portal asset composite during `GamePresentationOwner.build()` before either 3D
      mode may begin world activation. The decoded setup, animation, sound-table records and three
      prepared wave buffers are retained for the owner lifetime. The shared visual-template
      repository stages one geometry/atlas lease atomically with that closure, and construction and
      source cleanup still use the existing failure-atomic owner stack.
- [x] Colocate and comment the one typed portal asset catalog. Setup, animation, sound-table, and
      wave identities are supplied from that catalog rather than re-derived by lifecycle code.
- [x] Add diagnostics for prepared source bytes, persistent geometry/texture GPU bytes, transient
      target bytes, current transition state/generation, and outstanding handles. Decoders and
      prepared WebAudio sources report exact bytes when available; runtime and browser diagnostics
      report shared geometry/atlas totals, template ownership, snapshot generations, and the live
      tunnel target. Per-owner GPU byte attribution and the full context-loss census remain a
      verification follow-on, not an invented estimate.
- [x] Extract the smallest reusable object-submission seam from `WebGL2Renderer` needed to draw the
      portal setup. The transition pass builds renderer-local submissions and reuses compiled
      geometry, atlas bindings, material partitions, culling-compatible transforms, and opaque/
      blended draw paths; it does not mutate `SceneGraph` or create a synthetic entity.
- [x] Add transition-only target ownership. The outgoing RGBA8 snapshot and authored RGBA8/D24
      tunnel target are allocated only for an active transition and released at handoff. The first
      capture keeps its native extent across resize because the fullscreen presenter samples
      normalized UVs; context-loss and failure/recovery matrix coverage remains Phase 21 work.
- [x] Preserve the current fast path and single framebuffer presentation write for ordinary frames.
      The first transition uses a simple normalized blend and records the required
      `RETAIL DIVERGENCE` at the compositor policy, citing the ordinary teleport branch at
      `acclient.c:252638-252799` where retail switches viewports and reveals through view-distance/FOV.
- [x] Play portal animation and audio through prepared app-local assets without registering a fake
      behavior target. The portal uses `playingClip`, `advancePlayingFrame`, and
      `sampleAnimationPose` directly: the authored 40 fps rate controls traversal while the
      fractional cursor is sampled at render cadence. Enter, exit, and authored hook sounds use the
      listener-locked audio path and are edge-triggered by departed frames.
- [x] Keep `Waiting` unbounded while activation is pending. After activation, the controller uses a
      bounded presentation-only exit duration and emits reveal only after one pure-destination frame,
      exactly once; no timer manufactures destination readiness.
- [ ] Cover required-asset startup failure, partial owner teardown, initial entry without outgoing
      capture, indefinite waiting, exit reveal, supersession, resize, authored playback, audio
      preparation, and exact transient-resource release end to end. Focused unit tests now cover
      the asset-closure failure, controller edges, fractional playback/audio, and snapshot release;
      owner/GPU/context-loss and browser transition matrices remain explicit Phase 21/external
      verification debt.

#### Acceptance criteria

- Client and Explorer presentation cannot be constructed without the complete required portal
  closure, and neither mode re-fetches that closure per transition.
- Portal rendering uses the authored setup and explicit 40 fps animation through shared asset and
  renderer primitives, with no synthetic world identity or duplicate material implementation.
- The first transition version preserves outgoing/tunnel/incoming semantic inputs so later
  screen-space warping requires no activation or lifecycle contract change.
- `PortalRevealReceipt` cannot precede `SceneActivationReceipt` or a pure-destination frame, and no
  gameplay/explorer controls resume merely because reveal completed.
- Normal frames allocate no transition targets and retain exactly one default-framebuffer write.

### Phase 20: Converge Explorer and client discontinuities

#### Deliverables

- One shared app-local `PortalTransitionController` consumed by client and Explorer compositions.
  Client initial entry and `PlayerTeleport`, Explorer initial entry, and Explorer-directed world
  jumps traverse the same generation-keyed presentation states. Their activation and authority
  adapters remain distinct and typed.
- A semantic discontinuity command supplied by the initiating authority; no distance threshold or
  coordinate heuristic decides whether continuity exists.
- A mode-specific post-reveal handoff: client forwards `PortalRevealReceipt` to core and waits for
  successful ACE `LoginComplete`/matching `InWorld`; Explorer commits its local activation and
  restores Explorer controls. Everything before that handoff is source-neutral.
- Incremental scene hydration callable only around an already-active continuous world. It retains
  overlap, cancellation, and eviction, but no longer supports arbitrary initial or replacement
  scenes becoming visible piecemeal.

#### Task checklist

- [x] Route Explorer startup and every explicit location/landblock/EnvCell jump through the shared
      transition controller. Initial entry supplies no outgoing scene; later jumps capture only the
      last finished frame. The release-before-scene-change path produces a camera-only view subject.
      The structural pre-activation branch remains test-only.
- [x] Adapt Explorer's existing scene-interest request revision as its transition generation.
      Client uses core `world_generation` unchanged; each composition has one producer currentness
      value and no additional frontend activation counter.
- [x] Route client lifecycle state into the same controller without importing ACE protocol policy
      into the frontend. One matching reveal receipt is forwarded and controls remain withdrawn
      until core publishes the same generation as active `InWorld`.
- [x] Gate pointer, character drive, Explorer navigation, ordinary camera advancement, and audio
      listener ownership on the initiating mode's completed handoff. The client movement reset
      emits exactly one idle edge when active play is left.
- [x] Remove Explorer's direct replacement clear/install/reveal path and partial-startup visibility;
      continuous incremental hydration retains its shared preparation, overlap, cancellation, and
      eviction primitives.
- [x] Keep forced reposition, feed recovery, and remote correction on their Phase 16-classified
      non-portal paths. They are not promoted by convenience.
- [ ] Cover initial Explorer entry, outdoor/EnvCell jumps in both directions, supersession, client
      initial entry/teleport, mode teardown during every transition state, and uninterrupted
      continuous landblock crossing. The delayed activation and controller tests cover the core
      edges; the complete cross-mode matrix remains verification debt.

#### Acceptance criteria

- Every visible 3D-app replacement scene crosses the same install/reveal transaction; there is no
  Explorer consumer left that requires unrelated old and new scopes to hydrate incrementally while
  visible.
- Client and Explorer share portal assets, presentation states, transition controller, and
      compositor while retaining separate authority and post-reveal handoff policy.
- Continuous traversal never shows portal space, drops overlapping residents, or waits for a global
  scene-complete condition.
- A zero-duration harness adapter changes only presentation duration, never state edges, receipts,
  readiness, or resource ownership.

### Resteering E: Audit the narrowed streaming surface

Dry-run both real 3D compositions after Phase 20:

- enumerate every remaining call that can install a scene into an empty or unrelated scope and
  prove it is activation, recovery, or dead code;
- prove incremental streaming begins and ends with one active coherent scene and cannot publish a
  replacement destination;
- compare actual production additions and deletions against the Phase 16 inventory, then set the
  cleanup budget from the surviving mechanisms rather than defending the obsolete pre-compositor
  estimate;
- inspect resource diagnostics before, during, after, and across two superseding transitions for
  retained handles, atlas leases, framebuffers, audio, workers, and host requests; and
- verify that `SceneInterestReceipt`, `SceneActivationReceipt`, `PortalRevealReceipt`, client
  `InWorld`, and Explorer active state have no duplicate completion clauses.

If a second empty-scene hydration path, transition generation, renderer instance, or resource cache
survives, revise Phase 20 before cleanup. Do not preserve it as a fallback.

### Phase 21: Complete the clean cutover and prove transition behavior

#### Deliverables

- Removal or honest narrowing of the pre-cutover discontinuity path, loading state, scene-key
  readiness inference, pose-only physical reset, Explorer replacement hydration, and any duplicate
  generation or portal vocabulary made obsolete by Phases 17–20.
- Asset-free Rust and TypeScript integration fixtures with deliberately delayed and reordered
  collision, static-content, dynamic-visual, camera-seed, installation, reveal, and handoff
  completion.
- Browser scenarios for both modes' initial entry, outdoor-to-EnvCell and EnvCell-to-outdoor
  replacement, consecutive transitions, activation failure, resize/context loss, and ordinary
  incremental landblock streaming.
- A retained non-interactive live probe transition trace. Run it on an isolated random renderer
  port and use environment-only credentials; do not invoke the TUI or retain asset-dependent tests.
- Updated app/core/world architecture docs and diagnostics using one consistent activation,
  streaming, reveal, handoff, and discontinuity vocabulary.

#### Task checklist

- [x] Delete transition edges, UI states, source names, metrics, and comments whose only remaining
      consumer was compatibility with the pre-cutover path. Preserve the narrowed
      `PresentationDiscontinuity` only for the Phase 16-proven non-portal correction/recovery
      producers; the defensive `EnteringWorld` and `loading-activation` labels are documented
      sentinels rather than replacement authorities.
- [x] Add unit coverage for physical relocation clearing stale response/membership and for the
      closed activation, transition-presentation, reveal, handoff, supersession, and failure edges
      exercised by the asset-free fixtures and transition controller.
- [x] Add frontend coverage proving hidden staging, exact installation readiness, stale-generation
      rejection, old-scene dynamic suppression, local-view attachment staging, first pure-destination
      frame, input release/reacquisition, transient resource release, continued streaming, and the
      prepared portal closure's fractional playback/audio edges.
- [x] Run formatting, strict TypeScript, lint, Rust tests, clippy with warnings denied, sidecar
      smoke, and browser harness on a random port. The browser harness passed with zero page console
      messages. A later live GUI pass exercised both compositions and exposed the bounded-request
      and outdoor EnvCell-profile issues recorded here.
- [x] Replace the lossy two-way traversal profile with `LandblockSceneClass`: `DungeonOnly`,
      `OutdoorOnly`, or `OutdoorWithEnvCells`. Live owner `0x7b63ffff` is `OutdoorOnly`, so it no
      longer adds an absent `EnvCells` layer to the exact activation set. Preserve a loud failure
      when the profile declares EnvCells but deep source materialization is missing.
- [ ] Exercise live initial entry and teleport when server state permits. Record exact unavailable
      transition branches rather than treating a dungeon spawn or synthetic fixture as live
      teleport evidence. Initial entry and deep-dungeon operation are retained evidence; an observed
      live teleport/entry-exit transition remains unavailable.

#### Acceptance criteria

- Initial entry and replacement cannot publish a playable half-old/half-new world at any scheduling
  order covered by the integration fixtures.
- The two reported crashes are represented by regression fixtures and no longer reachable through
  the accepted contract.
- Ordinary streaming retains its incremental overlap, cancellation, and eviction behavior and does
  not inherit portal-space latency or empty-scene responsibilities.
- No retired transition mechanism, misleading readiness name, redundant generation, duplicate
  asset loader, or leaked persistent/transient portal resource survives in code, tests, metrics,
  docs, or UI labels.

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
- Activation-state fixtures for initial entry, teleport, supersession, reordered collision/reveal
  readiness, stale acknowledgement, disconnect, and snapshot reconstruction.
- Discontinuous local-body relocation rebuilding destination response, portal membership,
  kinematics, contacts, and reports as one transaction.

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
- Separate scene-demand acceptance, destination installation, portal reveal, and mode-handoff tests,
  including exact required-layer failure, hidden dynamic staging, conditional entity-view visual
  readiness, camera-seed readiness, stale generation, input withdrawal, and the first
  pure-destination frame.
- Required portal-asset owner tests covering generic setup-source reuse, exact retained handle and
  stable GPU lease lifetime, startup failure aggregation, teardown, and no per-transition re-fetch.
- Closed transition-controller tests for initial entry without outgoing capture, indefinite waiting,
  exit, supersession while already in portal space, zero-duration traversal, and handoff delay after
  reveal.
- An ordinary outdoor streaming fixture proving overlapping installation/eviction never enters the
  portal-space activation path.

### Browser harness evidence

The canonical browser harness remains the renderer and presentation playground. Add injected client
authority fixtures rather than requiring Electron or a live server for every visual check:

- initial client dynamic snapshot with local player and nearby entities;
- authoritative movement and interpolated presentation;
- attachment trees and appearance changes;
- outdoor, dungeon-only, and outdoor/EnvCell transition demand;
- teleport/reset during streaming;
- portal-space client and Explorer initial entry plus outdoor/EnvCell replacements with deliberately
  reordered collision, static, dynamic, camera, installation, reveal, and handoff completion;
- consecutive transition supersession and required destination/portal-asset failure;
- authored tunnel playback at explicit 40 fps, retail camera/light placement, outgoing capture,
  incoming reveal, resize/context loss, and transient-target release;
- ordinary frames proving no transition-target allocation and one default-framebuffer write;
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
- portal-space entry/exit timing, authored animation playback, and the exact installation/reveal
  generation acknowledged by the frontend;
- server disconnect and explicit application shutdown.

The first headless sidecar run against the supplied local ACE endpoint completed authentication,
selected the available character, entered world, emitted 308 focused upserts and 99
authority-clocked advances, exercised a short drive, and shut down through explicit disconnect.
Camera delivery produced one reseed and 193 advanced ticks without a fatal camera-coverage
failure. The raw sidecar census measured 621 protocol frames and 1,153,508 encoded payload bytes,
with a 4,398-byte maximum and 3,031-byte p95. This account exposed one character; rejected login,
multiple-character selection, landblock crossing, EnvCell entry/exit, teleport, and server-initiated
disconnect remain untested live branches. A later probe operated successfully in the `0x1D90...`
dungeon owner after the child-spatial-body cutover, exercising deep EnvCell camera initialization
and advancement without claiming an observed transition.

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
| Host decomposition becomes forwarding-file theater                            | Split by owned state, capability, and lifecycle; Resteering C deletes any module whose only purpose is renaming another call                                                                          |
| Structural convergence weakens an accepted client invariant                   | Characterize atomic snapshot, collision/body readiness, camera withdrawal, and typed exit semantics before each cutover and retain those tests throughout                                             |
| The retail oracle copies production and agrees vacuously                      | Structure the oracle independently from cited decompile branches and compare only public decisions and tick results                                                                                   |
| Live entity realization exhausts protocol request capacity                    | Reproduce observed volume synthetically, bound work at the content/presentation owner, and leave the protocol cap as a loud invariant                                                                 |
| Diagnostic tooling leaks credentials or processes                             | Accept credentials only through environment-owned probe input, redact outputs, use isolated random ports, and terminate the complete Electron/sidecar process group                                   |
| Portal space becomes a second world or scene authority                        | Keep one `WorldState`, one `SpatialScene`, and one presentation runtime; activation is a generation-scoped gate over their existing products, not another store                                       |
| A global loading barrier stalls ordinary outdoor streaming                    | Route only semantically discontinuous client/Explorer operations through activation; keep active-world scene interest on the incremental diff, overlap, cancellation, and eviction path               |
| Accepted demand is mistaken for installed destination content                 | Preserve `SceneInterestReceipt` as acceptance-only and add a distinct activation completion backed by exact installed products                                                                        |
| Core becomes coupled to WebGL or desktop policy                               | Core owns activation prerequisites and a typed external-readiness seam; desktop and TUI adapters supply readiness without exporting their render policy into shared crates                            |
| Installation, reveal, and collision readiness collapse into one vague receipt | Give demand acceptance, installed activation, first pure-destination frame, and mode handoff distinct contracts with one completion clause each                                                       |
| Teleport fixes accidentally classify hard correction as portal travel         | Classify each trigger from retail/ACE and current producers in Phase 16; physical discontinuity and portal-space replacement remain separate decisions                                                 |
| Portal exit reveals a scene without a usable camera                           | Permit one collision-backed, input-free camera seed during hidden staging and require its matching frontend installation before acknowledgement                                                       |
| Destination activation set is guessed from current renderer structure         | Trace retail cell prefetch/blocking behavior first, define one exact outdoor/EnvCell contract, and give every required layer a distinct reachable failure fixture                                      |
| Portal assets are loaded by the transition they must display                  | Build and retain the required ambient closure before either 3D mode may activate a world; fail presentation construction loudly if it is incomplete                                                    |
| Tunnel drawing forks object/material policy                                   | Generalize the existing setup visual source and extract the smallest renderer-local object submission primitive; add no synthetic scene entity or portal-only decoder                                 |
| Transition targets become permanent frame overhead                            | Allocate snapshot/tunnel targets only in active transition states, diagnose exact bytes, test release/resize/context loss, and preserve the ordinary-frame fast path                                  |
| Explorer preserves universal replacement hydration complexity                 | Move Explorer startup and explicit jumps onto the same portal activation transaction, then delete direct partial-scene reveal paths while retaining continuous incremental streaming primitives        |

## Definition of Done

- [x] Electron launches the sidecar in an explicit matching Explorer or client mode.
- [x] Client mode accepts the TUI-shaped host/account/password launch arguments, validates them in
      Electron main, and transfers one typed startup value privately without routing credentials
      through the renderer, URL, or sidecar arguments.
- [x] Explorer mode constructs only Explorer authority/producer state plus shared content.
- [x] Client mode constructs only client authority/producer state plus shared content.
- [x] `ClientRuntime`/`WorldState` remains the sole client entity and body authority.
- [x] `SpatialScene` owns the only full solver and contains no injected callback receiving its own
      scene; Explorer and client invoke its transactions over their own authority scenes.
- [x] Desktop and TUI clients use one core collision coordinator and the same client simulation
      composition.
- [x] Collision loading/interest is outside the synchronous solve and publishes complete immutable
      snapshots without transferring body ownership.
- [x] The local-player physical definition is prepared off the network/simulation loops, installed
      with an instance-generation guard, and cannot advance before hydration succeeds.
- [x] `MovementSystem` owns only proved client command/protocol responsibilities; shared character
      actuation no longer uses its fixed approximate lateral/backward velocity path.
- [x] Explorer and client project through distinct adapters into the same focused dynamic contract.
- [x] `ClientRuntime` publishes one ordered `Advanced` batch from its authoritative simulation turn;
      client host delivery and the boom consume that cadence without a second fixed clock.
- [x] Remote entities remain server-authoritative and dead-reckoned in the first cut; no local
      physical transaction commits their motion without separately proven retail behavior.
- [x] The frontend uses one source-neutral dynamic mirror and presentation realization path.
- [x] `GameRuntime` and `spawnedDynamic*` vocabulary has been cleanly replaced.
- [x] The client host exposes only the typed first-cut lifecycle, selection, viewer, control, and
      focused presentation surface.
- [x] Core owns the select/server-ready/enter-world protocol choreography, and one complete current
      snapshot reconstructs client application state after declared event loss.
- [x] The local player is named by authority rather than inferred by the frontend.
- [x] Render and collision interest follow authoritative player residency and own separate resource
      lifetimes.
- [x] A user can connect, view existing characters, select one, and enter the world.
- [x] Character selection requires the explicit Enter World action; Enter and double-click are
      shortcuts for that same idempotent action.
- [x] Connection/login failure, server disconnect, and fatal client-runtime failure terminate the
      application non-zero after a redacted diagnostic, with no in-app retry path. Ordinary rejected
      login now maps the already-logged-in `CharacterError.Logon` edge to the typed server-disconnect
      cause; external GUI failure-dialog coverage remains constrained by the unavailable display
      server.
- [x] The selected player, nearby entities, attachments, animation, effects, and surrounding static
      content render through the shared presentation runtime.
- [x] Basic movement crosses frontend intent, core execution, server observation, world authority,
      focused projection, and frontend presentation.
- [x] The TUI obtains the same improved character-motion and collision fidelity through its
      `ClientRuntime` composition without a TUI-specific solver fork.
- [x] Third-person camera placement is collision-safe and follows the authoritative player without
      becoming player authority.
- [x] Initial entry and teleport use one generation-scoped portal-space activation path; reset and
      forced reposition retain their Phase 16-proven non-portal behavior. No destination becomes
      playable before physical, collision, render, player-visual, camera, and acknowledgement
      prerequisites are ready.
- [x] The existing ACE `LoginComplete` action is sent exactly once after destination spatial,
      recursive containment, collision-backed camera, and composition-provided reveal readiness;
      receipt of `PlayerTeleport` never sends it.
- [x] Explorer behavior remains intact.
- [x] Formatting, type checks, lint, dead-code analysis, unit tests, Rust clippy, browser harness,
      sidecar smoke, and package verification pass.
- [x] The live ACE workflow is verified when its external prerequisites are available, with exact
      gaps reported otherwise. The supplied account exposed one character; outdoor and deep-dungeon
      operation are observed, while multiple-character selection, landblock crossing, EnvCell
      entry/exit, teleport, and server-initiated disconnect remain untested live.
- [x] Surviving fidelity or product gaps are recorded as named follow-ons with consequences and
      acceptance tests; no dormant compatibility scaffolding remains.
- [x] Shared content, Explorer, client, and projection capabilities have physical module and event
      sink boundaries, with honest event/dead-reckoning vocabulary and no translation aliases.
- [x] Server correction covers the complete retail disposition and ordered tick stages and agrees
      with an independently structured differential oracle.
- [x] The client lifecycle and world components are focused review surfaces, while imperative
      presentation owners retain dependency injection, cooperative cancellation, and complete
      reverse-order teardown.
- [x] A retained non-interactive probe reproduces lifecycle, movement, entity census, camera, and
      encoded-payload evidence without exposing credentials or invoking the TUI.
- [x] A 600-entity stress fixture stays within the measured presentation request bound and reaches
      stable realization within the sidecar's emergency pending-request limit.
- [x] Rust-to-TypeScript field spelling, early IPC requests, rejected login, normal disconnect, and
      fatal exit are covered across their real process boundaries; GUI-only dialog/close paths are
      named where the local environment lacks a display server.
- [x] Ordinary outdoor landblock streaming remains incremental and overlapping; it neither enters
      portal space nor waits for a global scene-complete condition.
- [x] Discontinuous authoritative body placement rebuilds physical response and spatial membership
      from destination residency instead of retaining topology from the previous scene.
- [x] Accepted scene demand and completed destination activation are distinct typed contracts; stale
      generation completion cannot reveal or activate a retired destination.
- [x] Required authored portal assets are prepared once for the 3D presentation lifetime through
      shared setup/animation/audio/resource machinery. The decoded closure, wave buffers, and one
      shared geometry/atlas template owner are retained; the portal uses the shared fractional
      animation sampler and owns no synthetic scene entity, collision body, second runtime, or
      per-transition asset fetch.
- [x] Destination installation, first pure-destination reveal, and mode-specific handoff are
      distinct typed facts. Client controls wait for matching `InWorld`; Explorer controls wait for
      matching local handoff.
- [x] Explorer startup and explicit world jumps use the same portal activation transaction as
      client replacement entry, leaving incremental hydration responsible only for an already-active
      continuous world.
- [x] Ordinary frames allocate no portal targets; the outgoing snapshot and authored tunnel target
      have exact byte/generation diagnostics, retain native outgoing extent across resize, and are
      released at handoff. Full context-loss, failure, and teardown matrix evidence remains an
      external/browser follow-on.
- [ ] Portal-space behavior passes asset-free reordered-completion fixtures, authored-asset browser
      scenarios, and the live transition matrix where external server state permits.

## Open Questions

No blocking implementation question remains for the first cut. The explicit follow-ons are the
enhanced tunnel-shaped screen-space warp (out of scope), retail's longer timing/fade fidelity and
random waiting yaw, per-owner GPU-byte attribution, and the full owner/GPU/context-loss/browser/live
transition matrix. The authored setup already uses the shared fractional playback path: 40 fps is
its traversal rate, not a render cap. The native outgoing snapshot extent is an accepted concession
because normalized fullscreen sampling preserves the useful source through resize. Any future warp
or timing refinement must not change activation, residency, reveal, or handoff contracts.

## Implementation Record

### Decisions and course corrections

- **2026-08-26 — Phases 17–18 activation cutover:** core now owns one `PortalSpace` activation
  generation for initial entry and `PlayerTeleport`; `RuntimeBodiesReset` plus `TeleportStarted`
  are batched so they cannot double-increment that generation. Local body relocation uses the
  scene-owned transactional primitive, recursive player containment is checked before activation,
  and desktop receives a generation-keyed reveal acknowledgement command while TUI keeps the
  immediate non-rendering adapter. A collision-backed input-free camera seed is emitted only from
  the matching collision snapshot. The desktop canvas remains mounted during portal staging and a
  source-neutral installation receipt/status distinguishes accepted scene demand from resident
  terrain, EnvCell, and dynamic products. Movement, camera, listener, and stale-generation edges
  stay withdrawn until the mode-specific handoff.

- **2026-08-26 — Phase 19/20 first-cut presentation:** the checked-in `UIASSET` mapper resolves
  portal setup `0x02000306`, its 120-frame animation `0x030005AC`, sound table `0x2000004B`, and
  the three required waves. The generic setup visual source and animation/sound adapters load and
  validate that closure once during `GamePresentationOwner.build()`, while the shared visual-template
  repository atomically retains its geometry/atlas lease. `PortalTransitionController` and
  `WebGL2TransitionSnapshot` provide generation-keyed waiting, stable outgoing capture, pure-
  destination reveal, and exact transient snapshot accounting for both client and Explorer. The
  renderer keeps one final fullscreen presentation write and samples outgoing pixels by normalized
  coordinates, so the native outgoing extent remains useful across a drawing-buffer resize. The
  transition-only tunnel reuses compiled object/material submissions and the shared
  `advancePlayingFrame`/`sampleAnimationPose` path; 40 fps is an authored traversal rate with
  fractional render-cadence sampling, and enter/exit/hook waves are listener-locked edge events.
  The compositor remains a simple blend by deliberate out-of-scope concession; Explorer startup
  and explicit jumps share the controller and activation transaction while continuous streaming
  retains its incremental path.

- **2026-08-26 — live GUI activation findings:** Explorer's default radius-eight terrain request
  resolves to 289 landblock batches, while `SceneInterestCommitCoordinator` previously launched
  every batch immediately against a 256-request protocol ceiling. The protocol circuit breaker is
  now 512, and a generalized frontend request gate admits at most 32 landblock batches while
  rechecking revision ownership after the queue so superseded work never reaches the sidecar. A
  browser-harness run over that complete 17-by-17 footprint completed all 289 terrain jobs, drained
  the worker queue to zero, and exited successfully without a pending-request-limit failure. A
  real archive `collision_scene_probe --landblock 0x7b63ffff` reports 64 terrain cells, one inert
  generated placement, and zero EnvCells; the canonical HBEC record independently reports
  `availability: absent`, `cellCount: 0`. The client failure is therefore a shallow-profile contract
  defect: the former two-way traversal classification did not distinguish outdoor-only from mixed
  content, but the frontend treated it as proof that an EnvCells layer existed. The typed profile
  is now a closed three-way `LandblockSceneClass`, and only `OutdoorWithEnvCells` enters ambient
  EnvCell demand. Explorer activation failure also logs structured diagnostics and resets the portal
  presentation rather than leaving an orphaned tunnel. An archive-backed browser run at
  `0x7b63ffff` with the client radii now completes successfully; the harness wait was also corrected
  to follow the exact resolved EnvCell owner set instead of assuming the anchor always owns cells.
  The subsequent live client reveal exposed one inline MessagePack naming mismatch: Electron sent
  `worldGeneration` while `AcknowledgeClientWorldReveal` expected `world_generation`, terminating
  the sidecar after the destination loaded. The wire field now explicitly accepts camelCase, with
  an encoded-frame regression covering the renderer-to-Rust boundary.

- **2026-08-26 — Phase 21 local verification:** `npm run format:check`, `npm run check`,
  `npm run lint`, full TypeScript tests (210 files/1,554 tests), focused core/world Rust tests,
  Rust formatting, host check/clippy, sidecar smoke, and the random-port browser harness pass. The
  harness reports `ready: true` with no page console messages; its report schema now includes portal
  source-byte, playback-cursor, persistent-resource, and transient-target diagnostics. The
  harness-only `--portal-transition-demo` run loads the real authored closure, holds `Waiting`, and
  captures the tunnel with one native-size outgoing snapshot; the ordinary harness scene correctly
  reports the portal closure as not installed. Electron GUI execution still needs a display server,
  and the live account has not supplied an observed teleport/EnvCell entry-exit transition; those
  branches remain external evidence gaps.

- **2026-08-26 — Phase 16 portal-space contract complete:** retail blocks teleport completion on
  the complete configured landscape/building/EnvCell prefetch closure, hides the normal viewport,
  and sends login complete only after that work and the recursive contained-object closure exist.
  ACE uses that same action to end `Teleporting` for initial entry and later teleports. Holtburger
  instead sent it immediately and could increment one teleport through two world generations. The
  accepted contract reuses `world_generation`, makes the resolved client `SceneInterestMap` the
  exact desktop activation set, treats only initial entry and `PlayerTeleport` as replacement
  triggers, retains forced reposition as non-blocking correction, and joins containment, relocated
  body/collision, and composition-provided reveal readiness before sending one existing ACE
  `LoginComplete`. TUI and non-rendering compositions inject immediate reveal readiness but cannot
  bypass shared spatial or containment prerequisites. There is no invented client timeout; explicit
  failures are terminal and ACE retains its five-minute server limit. Asset-free diagnostics
  reproduced stale outdoor membership and the missing retained EnvCell failure, while the existing
  relocation test proves the positive primitive. Its original production budget covered only the
  then-known relocation and activation barrier; Resteering E replaces that obsolete estimate after
  the now-evidenced compositor, ambient-resource, and Explorer cutovers land.

- **2026-08-26 — portal-space cutover scoped, implementation deferred:** live teleporting to
  EnvCell `0x01D90100` exposed two halves of one activation failure: the focused projection delivered
  an indoor pose with retained outdoor spatial membership, and core allowed placed motion to reach a
  collision scene that did not yet own the destination cell. Retail holds teleport completion while
  `CellManager` blocks/prefetches and presents a dedicated portal-space viewport. Phases 16–21
  therefore replace the ad hoc discontinuity/loading path with a generation-scoped activation
  barrier spanning authoritative relocation, collision readiness, installed render products,
  player visual, and initial camera placement. Ordinary outdoor movement explicitly retains the
  existing incremental scene-interest path. No runtime code was changed while scoping this cutover.

- **2026-08-26 — Phase 0 contract cutover complete:** the evidence ledger now fixes the lifecycle,
  current-state recovery, focused advance, residency/collision, hydration, movement, simulation, and
  desktop host contracts consumed by later phases. Asset-free coverage now reaches every focused
  client projection rejection, local-player and attached snapshot reconstruction, and retail
  correction assignment/damping. A representative live entity census and encoded payload sampling
  were explicitly judged unnecessary for Phase 0; they remain optional diagnostics if later
  integration evidence calls for them.
- **2026-08-26 — Phase 1 host-mode cutover complete:** the Electron sidecar now receives an explicit
  `--mode` argv value, reports that mode in the handshake, and dispatches through concrete
  `ExplorerHostRuntime` or `ClientHostRuntime` roots over one shared `HostContentState`. The client
  root accepts exactly one private startup configuration but does not construct a network task yet;
  lifecycle/task ownership remains the Phase 4 implementation surface. Electron validates the
  TUI-shaped endpoint/account flags, strips them from the entry URL, and clears the password after
  the private request settles. Mode-specific Rust dispatch checks and Electron allowlists duplicate
  the boundary intentionally so a compromised renderer cannot activate the other root. The empty
  client renderer inventory is deliberate until its commands have consumers.
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
- **2026-08-27 — simulation scene residency cutover:** client collision interest remains a bounded
  3×3 normalized prefetch neighborhood, but static residency and local-player body preparation now
  have independent lifetimes. `SimulationSceneResidency` retains one immutable installed snapshot
  while complete successor batches resolve; position-free body preparation is keyed by player
  identity and definition facts and installs against the live pose. Desktop and TUI share the
  content-backed source, while asset-free fixtures keep live DAT/server state out of permanent
  tests.
- **2026-08-26 — Phase 6 transaction cutover complete:** `SpatialPhysics` and its injection
  constructors are deleted. The client advances only a ready local body through the canonical
  `SpatialScene` transaction; remote entities remain pose-only. Typed displacement/manual-kinematic
  actuation reaches the existing full solver, and world mapping publishes committed body/contact
  semantics without reapplying the accepted result.
- **2026-08-26 — Phase 7 lifecycle root complete:** `ClientApp.svelte` now owns only launch-driven
  lifecycle presentation and explicit character entry. A discriminated reducer keeps selection
  state local until one GUID-bearing Enter World request; session-level deduplication covers button,
  Enter, and double-click races. Credentials, retry controls, character management, and Explorer
  presentation imports remain absent. The unused static `RouteShell` was removed after dead-code
  lint identified it as an orphan.
- **2026-08-26 — Phase 8 client presentation cutover complete:** `ClientPresentationSession` now
  composes the shared presentation owner after the authority reaches `InWorld`, serializes mirror
  reconciliation, forwards host-timed advance batches without re-projection, and holds rendering
  during snapshot recovery or missing player/EnvCell presentation. Authoritative player placement
  drives profile-resolved scene demand while the interpolated scene origin drives camera placement;
  synchronized portal-year time drives regional environment and the accepted camera drives audio.
  Synthetic frontend tests cover EnvCell/outdoor demand transitions, teleport reset, feed loss, and
  teardown. Browser regression was run with the isolated Vite port 1431; no live ACE census or
  session was required for this phase.
- **2026-08-26 — Phase 9 character actuation and correction complete:** client input now crosses the
  typed host boundary into the shared character-motion controller, with retail-shaped authored
  actuation, server interpolation/correction, constraint damping, and lifecycle stop/reset edges.
  The first cut keeps lateral input source-neutral in the shared controller without inventing a
  client wire field; focused differential fixtures cover forward, backward, diagonal, turn-only,
  reversal, correction, and teleport behavior.
- **2026-08-26 — Phase 10 client camera complete:** the reusable core boom product now serializes
  landblock-aware placement paths and visual pivots, while `ClientCameraRuntime` consumes the
  accepted local-player advance batch and the installed collision snapshot on the existing client
  clock. The frontend camera session requires a generation-specific start receipt, uses the exact
  authority duration on each path leg, bounds latest-wins playback, and clears paths/acknowledgements
  on teleport, reset, disconnect, or missing presentation. Pointer capture, pixel orbit, cumulative
  wheel zoom, movement recenter, scene demand, and audio remain client-owned consumers.
- **2026-08-26 — camera snapshot withdrawal recovery:** the collision coordinator's asynchronous
  rebuild may temporarily have no immutable snapshot. The client camera now publishes a nonfatal
  held tick with no clearance proof during that interval, demotes the camera to a pending generation
  while preserving its latest request/output sequence, and the frontend drops playback proven
  against the retired scene until a new collision-backed path arrives. This preserves one client
  clock and prevents a normal streaming transition from surfacing as a fatal host exit.
- **2026-08-26 — Resteering B and Phase 11 acceptance sweep:** the complete slice has no second
  client body store, authority clock, collision scene, or camera timer; Explorer and client retain
  explicit roots and share only source-neutral dynamic/presentation products. Retired runtime names
  were removed from code and the final harness variables, the orphaned route shell was deleted, and
  the typed mode/protocol/package gates are green. The canonical browser harness passes on isolated
  Vite port `1432` with no page console errors. Electron GUI execution is unavailable here because
  no display server or `xvfb-run` exists; sidecar, protocol-failure, package, and archive evidence
  are retained. The first-cut live client workflow was subsequently exercised headlessly against
  the user-supplied ACE endpoint: one character authenticated and entered world, the camera emitted
  one reseed plus 193 advanced ticks, a short drive completed, and explicit disconnect was clean.
  The same run measured 621 protocol frames (1,153,508 encoded payload bytes; 4,398-byte maximum;
  3,031-byte p95). A later probe proved deep-dungeon camera initialization and advancement after the
  child-spatial-body correction. Multiple-character selection, landblock crossing, observed EnvCell
  entry/exit, teleport, and server-disconnect branches remain untested live.
- **2026-08-26 — Phase 12 host boundaries complete:** host mode, shared content, Explorer authority,
  client authority, projection, and event sinks now have physical module ownership. Mode-local
  command/event inventories are explicit on both Rust and TypeScript sides; the outer MessagePack
  command decoder retains unknown-command and wrong-mode diagnostics. `SpatialPhysics` was renamed
  to `dead_reckoning` and the retired physical-event vocabulary was swept from surviving code,
  tests, metrics, and app docs.
- **2026-08-26 — Phase 13 correction convergence complete:** the correction path now follows the
  cited retail `MoveOrTeleport`, interpolation, watchdog, heading, and constraint stages through
  one exhaustive `ServerCorrection` owner. Ordinary self-position events carry the sequence/contact
  facts needed by that classifier; hard/snap placement and lifecycle discontinuities are emitted
  once. Independent differential fixtures and the full core/world/host suites are green; clippy
  required one nested-if cleanup before passing with warnings denied.
- **2026-08-26 — Phase 14 presentation teardown complete:** client selection/world markup moved into
  focused Svelte consumers while imperative lifecycle, camera, scene-interest, and frame-hot owners
  stayed source-neutral. Presentation construction is abortable between expensive stages, and one
  reverse-order teardown stack attempts every release and aggregates failures. Renderer warnings
  and errors now reach Electron's terminal; informational console output is opt-in.
- **2026-08-26 — Phase 15 tooling and integration evidence complete:** the retained environment-only
  live probe, deterministic 308/600 entity stress fixture, real Rust-to-TypeScript lifecycle decode,
  early-IPC host-ready gate, typed rejected-login projection, and random-port launch/tokenizer tests
  are in place. TypeScript checks (207 files/1,539 tests), Rust core/world/host suites, TUI and
  workspace checks, clippy, sidecar smoke, and the browser harness on a random Vite port pass. The
  supplied live account exposed one character and initially one outdoor session; exact unavailable
  live branches are recorded in the Phase 15 evidence instead of being represented as passing.
- **2026-08-26 — child-spatial-body camera correction complete:** camera target placement no longer
  derives a synthetic outdoor seed from camera-offset player coordinates. `ChildSpatialBody` owns
  only parent-local sphere geometry and committed portal membership, derives motion from the
  accepted parent pose path, and delegates topology reconciliation to `CollisionScene`. Client and
  Explorer boom adapters plus physical-fly viewer projection use the same primitive. Focused world,
  core, and host suites pass (432, 267, and 244 tests), clippy passes with warnings denied, and a
  headless live probe initialized and advanced the camera in the `0x1D90...` dungeon owner without
  reproducing the indoor-landblock normalization failure. That run proves dungeon-resident behavior;
  live EnvCell entry/exit and teleport remain external matrix gaps.
- **2026-08-26 — independent implementation convergence audit:** a filesystem-level comparison with
  a separately implemented worktree selected four follow-on seams: physical host/module and event
  boundaries, complete retail server correction with an independent oracle, smaller client UI and
  presentation-lifetime review surfaces, and retained live/IPC diagnostics. The audit explicitly
  rejected that implementation's independently staged body/collision readiness, replay-style
  current state, fixed camera clearance, and generic fatal treatment of every disconnect. Phases
  12–15 therefore converge structure and evidence while retaining this implementation's atomic
  collision/body product, atomic application snapshot, projection-revision camera protocol, and
  typed exit causes.
- **2026-08-26 — client reveal presentation lifetime correction:** the client shell now installs one
  presentation session for the complete entering-world/portal-space/in-world phase. The previous
  lifecycle-keyed Svelte effect destroyed the old WebGL device while constructing its replacement
  on the same canvas; the old device's explicit context loss could race the new renderer's shader
  compilation. `PlayerCreate` now publishes local-player identity independently of lifecycle, and
  the atomic snapshot retains it for recovery; presentation installation therefore requires no
  player identity and possession binds when that authority fact arrives. Presentation failures now
  reach both the client error surface and the console. The strict CSP remains unchanged: Zod's
  caught `new Function` capability probe is unrelated and safely selects its non-JIT path when
  `unsafe-eval` is unavailable.
- **2026-08-26 — frontend lifecycle-hook audit complete:** client input ownership now keys off the
  stable in-world capability rather than the replaceable lifecycle object, so same-phase snapshot
  recovery cannot recreate the controller or discard held input. Portal scene activation keys off
  `worldGeneration`; duplicate portal-state publication is idempotent, while a new generation
  explicitly retires the previous activation receipt. Explorer now awaits the same production
  activation transaction in application and tests; the test-only synchronous pre-activation focus
  path was deleted, and stale out-of-order completion is covered. The browser harness completes a
  real outdoor activation. Local-player identity remains session-authority state: there is no
  invented retirement hook until a logout-to-selection producer makes that transition reachable.

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

### Cleanup target dispositions

- [x] Sweep `SpatialPhysics`, `BasicSpatialPhysics`, `NoopSpatialPhysics`, `new_with_physics`,
      `new_with_spatial_physics`, and batch/apply vocabulary after the transactional client cutover.
- [x] Rename the partial `emit_initial_view_state_snapshot` mechanism during its complete-snapshot
      replacement; retain no old alias that overstates its recovery guarantee.
- [x] Split the broad host runtime/protocol/event-sink review surfaces by capability without adding
      a universal host trait or degrading wire diagnostics.
- [x] Split oversized client presentation and camera files only at named ownership boundaries;
      retain no pass-through wrappers created solely to reduce line counts.
- [x] Audit standalone snapshot publication. Retain the broad fellowship, vendor, trade, dynamic,
      and runtime-body replacement events because the TUI still consumes those authority-facing
      surfaces and the narrow desktop snapshot deliberately does not carry them. The desktop host
      suppresses those compatibility events until the atomic `ClientApplicationSnapshot` arrives;
      removing them would require broadening that contract beyond this slice rather than deleting
      genuinely redundant publication.
- [x] Bound dynamic realization at observed live entity volume without serializing frame-hot work;
      the protocol ceiling remains a separate emergency guard rather than its scheduler.
