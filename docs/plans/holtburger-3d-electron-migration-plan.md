# Holtburger 3D Electron Migration Plan

Status: in progress. Phases 0-8 are complete on the available Linux desktop; Phase 9 is the next
portability, packaging, and cross-platform certification phase.

## Context and Boundaries

### Goal

Run Holtburger 3D in one Chromium-owned Electron window on Linux, macOS, and Windows without moving
authoritative client behavior into JavaScript or accepting the native-popup defect proven in
`holtburger-3d-cef-native-popup-investigation.md`.

### Why this migration is justified

The current runtime was adopted because V8 materially outperformed WebKitGTK for the Explorer's
JavaScript-bound renderer. The CEF investigation then proved that Tauri's Linux child-window
embedding—not the frontend, CEF generally, scaling, or the external message pump—causes physical
native dropdowns and context menus to fail. CEF-owned top-level windows work, but cannot be used
through the current Tauri integration without leaving a second black host window.

Electron preserves the useful part of the CEF decision: a bundled Chromium/V8 runtime whose browser
owns the top-level window. It also provides supported Windows, macOS, and Linux application shells.
The cost is an explicit Rust sidecar protocol and per-platform packaging rather than Tauri's command
and event adapters.

### In scope

- Replace the Tauri/CEF application shell with Electron.
- Keep the existing Svelte, Vite, worker, WebGL2, content, scene, and renderer implementation.
- Extract the app-local Rust host from Tauri lifecycle and state types.
- Run that Rust host as one private child process supervised by Electron.
- Replace Tauri invoke/event calls with one narrow, typed frontend host boundary.
- Preserve efficient binary asset responses and host-published simulation events.
- Build and package native artifacts for Linux x86-64, Windows x86-64, and macOS x86-64/arm64.
- Add automated cross-platform compile, protocol, package, and launch checks using hosted CI runners.
- Define manual certification gates for behavior that hosted CI cannot prove honestly.
- Remove the Tauri/CEF implementation after Electron reaches local parity and the manual refinement
  gate passes; keep portability packaging and platform certification as later release gates.

### Out of scope

- Rewriting Rust runtime behavior in Node.js or TypeScript.
- A native Node addon. It would couple Rust to Electron's Node/V8 ABI without a demonstrated need.
- Changing authoritative game behavior, content formats, scene ownership, or renderer architecture.
- Redesigning Explorer or client UX as part of the shell replacement.
- Automatic updates, crash reporting services, telemetry, or a final public release channel.
- Claiming manual Windows or macOS certification before those systems become available.
- Fixing Tauri's or CEF's upstream Linux child-window implementation.

## Ground Truth

### Repository evidence

- `docs/plans/holtburger-3d-cef-native-popup-investigation.md` proves the child-window failure
  boundary and records the working CEF-owned top-level control.
- `apps/holtburger-3d/package.json` contains the current Vite, test, lint, browser-harness, and Tauri
  entry scripts.
- `apps/holtburger-3d/scripts/tauri-dev-entry.mjs` owns entry selection, development content-path
  setup, and Tauri process launch.
- `apps/holtburger-3d/src-tauri/src/lib.rs` is the current composition root and registers 36 Tauri
  commands spanning content, Explorer entities, simulation interest, physical flight, and camera
  control.
- `apps/holtburger-3d/src-tauri/src/explorer_entity_delivery.rs`,
  `explorer_entity_simulation.rs`, and `host_physical_fly_runtime/mod.rs` publish the current host
  event surface.
- The `tauri-*.ts` asset sources and Explorer transport/session modules isolate much of the
  frontend's host access already, but several adapters import Tauri independently. These should
  collapse onto one app-local transport instead of growing parallel Electron variants.
- Binary content responses already use purpose-built formats such as HBTR, HBTP, HBAR, and the
  landblock batch envelope. The new transport must carry those bytes without JSON integer arrays or
  base64 expansion.
- The shared `holtburger-common`, `content`, `core`, `dat`, `protocol`, `world`, and weenie-catalog
  crates do not depend on the desktop shell. The migration belongs inside `apps/holtburger-3d`.
- `.github/workflows/nightly.yml` already builds Rust on Linux x86-64, Windows x86-64, and macOS
  x86-64/arm64 runners. The Electron portability matrix should reuse those target expectations
  rather than inventing a conflicting platform list.

### External references

- [Electron documentation](https://www.electronjs.org/docs/latest/) for the supported desktop
  platforms and process model.
- [Electron process sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox) and
  [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) for the
  renderer security boundary.
- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc) and
  [contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge) for the main/preload
  adapter.
- [Electron packaging](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging) for
  platform-native packaging and signing constraints.
- [Electron's Wayland notes](https://www.electronjs.org/blog/tech-talk-wayland) and
  [BrowserWindow documentation](https://www.electronjs.org/docs/latest/api/browser-window/) for
  Linux window-management limitations that remain even after the CEF defect is removed.

## North Stars

1. Electron owns one normal top-level window; there is no foreign child-browser embedding.
2. Rust remains authoritative for content, world, simulation, and reusable client behavior.
3. The desktop shell is an app-local adapter, not a reason to leak Electron concepts into shared
   crates or frontend domain services.
4. One transport boundary replaces all direct Tauri imports. Consumers do not know which desktop
   shell carries their requests.
5. Binary-heavy content remains binary end to end. Portability must not purchase avoidable copies,
   base64 inflation, or byte arrays serialized as JSON numbers.
6. The child process has an explicit lifecycle, bounded framing, typed errors, and version
   negotiation. A dead or incompatible host fails visibly.
7. Browser-only harnesses remain browser-only and continue using injected sources; Electron is not
   introduced into renderer unit tests or the canonical browser harness without a demonstrated
   need.
8. Automated cross-platform builds establish portability confidence; only real platform runs can
   establish user-facing certification.
9. Tauri and Electron coexist only during a bounded migration window. The final architecture has
   one production shell and no compatibility shim cemetery.
10. Build the simplest complete transport first. Metrics inform diagnosis, but synthetic
    performance thresholds do not block a working vertical slice ahead of manual scenario testing.

## Target Architecture

```text
Electron main process
├── owns BrowserWindow and application lifecycle
├── spawns the matching holtburger-3d-host executable without a shell
├── frames and multiplexes private host IPC over stdin/stdout
└── exposes an allowlisted request/event bridge to the preload
    └── isolated renderer
        ├── Svelte/Explorer/client composition roots
        ├── app-local HostTransport
        └── existing content, scene, worker, and WebGL2 systems

Rust holtburger-3d-host process
├── app-local HostRuntime composition root
├── typed command dispatcher
├── injected HostEventSink
└── existing shared content/core/world dependencies
```

The private sidecar channel will use length-prefixed MessagePack frames. MessagePack carries existing
binary records directly, is supported by Serde, and avoids designing a second attachment protocol.
The dependency versions must be selected by Cargo and npm during implementation rather than copied
from this plan.

Every frame will have a maximum accepted size and one of these explicit shapes:

- handshake: protocol version and host/application build identity;
- request: monotonically increasing request ID plus a tagged command payload;
- response: matching request ID plus a tagged success payload or structured error;
- event: tagged event payload and, where the producer owns one, its existing revision/generation;
- shutdown: orderly host termination request and acknowledgement.

Stdout is reserved exclusively for framed protocol output. Diagnostics go to stderr. Electron owns
request multiplexing, rejects outstanding promises when the child exits, and kills the child during
application shutdown if orderly termination does not complete within a bounded grace period.

The preload exposes only the Holtburger host API. `nodeIntegration` remains disabled,
`contextIsolation` and renderer sandboxing are explicit, arbitrary Electron IPC channels are not
exposed, navigation away from the packaged application is denied, and new-window requests are
denied unless a later product requirement names a consumer.

## Phased Implementation

### Phase 0: Record the migration baseline

#### Deliverables

- A checked command/event inventory derived from the current Tauri registration and emit sites.
- Linux baseline captures for startup, the popup probe, Explorer content loading, one representative
  binary-heavy scene load, host events, and renderer CPU/GPU performance.
- Measured sizes and rates for representative HBTP texture, landblock batch, dynamic-entity, fixed
  tick, and physical-flight messages.

#### Task checklist

- [x] Record all 36 registered command names, their request/response types, and all five current
      event names in a migration checklist or contract test fixture.
- [x] Run the popup probe and retain evidence that dropdown and physical context menu behavior are
      broken in the current shell.
- [x] Run the existing browser harness against representative outdoor and EnvCell scenes with the
      exact workload and render scale recorded beside results.
- [x] Measure payload sizes and event frequency before fixing frame-size and buffering limits.
- [x] Record current runtime disk size so Electron comparisons use like-for-like contents. The
      current Tauri configuration has bundling disabled, so this is a constructed runtime payload,
      not an installer measurement.

#### Acceptance criteria

- No current host capability is absent from the inventory.
- Baselines are reproducible from named scripts and inputs.
- Protocol limits are based on observed application data plus named headroom, not guessed constants.

#### Decisions and course corrections

##### Host command inventory

The inventory below is derived from the `generate_handler!` registration in `src-tauri/src/lib.rs`.
`binary` means the successful Tauri response is `tauri::ipc::Response`; it does not prescribe the
new transport wrapper.

| Family                         | Registered command and request to response contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                         | `host_status`: no request -> `HostStatus`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Content bootstrap              | `load_active_region_data`: no request -> binary; `load_sky_source`: no request -> binary                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Landblocks                     | `load_landblock_source_batch`: `LoadLandblockSourceBatchRequest` -> binary; `load_landblock_profile`: `LoadLandblockProfileRequest` -> `Option<LandblockProfile>`                                                                                                                                                                                                                                                                                                                                                                                                    |
| Visual and authored assets     | `load_texture_pixels`: `LoadTexturePixelsRequest` -> binary; `load_animation`: `LoadAnimationRequest` -> binary; `load_dynamic_entity_visual`: `LoadDynamicEntityVisualRequest` -> binary; `load_physics_script`: `LoadPhysicsScriptRequest` -> binary; `load_particle_emitter`: `LoadParticleEmitterRequest` -> binary; `load_audio`: `LoadAudioRequest` -> binary; `load_sound_table`: `LoadSoundTableRequest` -> binary; `load_particle_meshes`: `LoadParticleMeshesRequest` -> binary; `load_motion_table_closure`: `MotionTableClosureRequest` -> `Vec<String>` |
| Physical flight                | `start_physical_fly`: `PhysicalFlyRegistration` -> `PhysicalFlyStartReceipt`; `set_physical_fly_intent`: `PhysicalFlyIntent` -> unit; `stop_physical_fly`: `session: u64` -> unit                                                                                                                                                                                                                                                                                                                                                                                    |
| Simulation interest            | `start_simulation_interest_session`: no request -> `u64`; `replace_simulation_interest`: `SimulationInterestRequest` -> `SimulationInterestReceipt`                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Explorer catalog and snapshots | `explorer_catalog_capability`: no request -> `ExplorerCatalogCapability`; `search_explorer_weenies`: `ExplorerWeenieSearchRequest` -> `Vec<ExplorerWeenieSearchResult>`; `request_explorer_dynamic_entity_snapshot`: no request -> unit; `explorer_possession_motion_probe`: no request -> `Option<ExplorerPossessionMotionProbe>`                                                                                                                                                                                                                                   |
| Explorer entity mutations      | `spawn_explorer_entity`: `ExplorerEntitySpawnRequest` -> `ExplorerEntityMutationReceipt`; `despawn_explorer_entity`: `guid, generation` -> `ExplorerEntityMutationReceipt`; `replace_explorer_entity_physics_state`: `ReplaceExplorerEntityPhysicsStateRequest` -> `ExplorerEntityMutationReceipt`; `launch_explorer_entity`: `ExplorerEntityLaunchRequest` -> `ExplorerEntityMutationReceipt`; `relocate_explorer_entity`: `ExplorerEntityRelocationRequest` -> `ExplorerEntityMutationReceipt`; `reset_explorer_entities`: no request -> unit                      |
| Explorer possession            | `possess_explorer_entity`: `PossessExplorerEntityRequest` -> `ExplorerPossessionReceipt`; `set_explorer_possession_intent`: `ExplorerPossessionIntentWireRequest` -> `PossessionIntentReplaceResult`; `queue_explorer_possession_event`: `ExplorerPossessionEventWireRequest` -> `PossessionEventQueueReceipt`                                                                                                                                                                                                                                                       |
| Kinematic boom                 | `start_kinematic_boom`: `HostKinematicBoomStartRequest` -> `HostKinematicBoomStartReceipt`; `set_kinematic_boom_intent`: `HostKinematicBoomIntentRequest` -> `HostKinematicBoomUpdateReceipt`; `set_kinematic_boom_clearance`: `HostKinematicBoomClearanceRequest` -> `HostKinematicBoomUpdateReceipt`; `stop_kinematic_boom`: `HostKinematicBoomIdentity` -> `bool`                                                                                                                                                                                                 |

Errors are currently flattened to `String` for fallible commands. Phase 3 must replace that shell
artifact with a structured protocol error without changing which operations fail.

##### Event inventory and ordering contracts

| Event                                | Payload                       | Observed/defined cadence                                                  | Delivery contract to preserve                                                                                           |
| ------------------------------------ | ----------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `explorer-dynamic-entity`            | `DynamicEntityEvent`          | Command/snapshot driven                                                   | Listener is installed before snapshot request. Mutations publish while the command's ordered-publication guard is held. |
| `explorer-fixed-tick`                | `ExplorerFixedTickEnvelope`   | At most 30 Hz; omitted when neither entity advances nor boom state exists | Publication failure is logged; authoritative state remains recoverable by a later snapshot.                             |
| `explorer-possession-event-outcomes` | `Vec<PossessionEventOutcome>` | Sporadic; emitted only when non-empty                                     | Shares the fixed-tick publication path.                                                                                 |
| `host://physical-fly-motion`         | `PhysicalFlyMotionPath`       | 30 Hz while a flight session is active                                    | Listener is installed before the start request. Publication failure removes the scheduler participant.                  |
| `host://physical-fly-failure`        | `PhysicalFlyFailure`          | Failure only                                                              | Best-effort failure notification after participant failure.                                                             |

The host fixed-tick rate is `HOST_FIXED_TICK_HZ = 30.0`. Mutation event publication currently
occurs synchronously before its Tauri command returns. The sidecar must therefore use one ordered
response/event writer and preserve event-before-response enqueue order; independently writing
events and responses would be a behavior regression even if request IDs still matched.

##### Measured payload and rate census

Measurements used the production `dats/assets.hba` (634,262,818 bytes), the existing
`dev_landblock_content_host`, and existing deterministic host scenarios.

| Payload                                                       |            Measured encoded size |
| ------------------------------------------------------------- | -------------------------------: |
| HBAR active-region data                                       |                    300,716 bytes |
| HBTP terrain detail texture `0x050012af`                      |                     16,764 bytes |
| HBTP terrain color texture `0x0500145c`                       |                  1,049,004 bytes |
| Full five-layer landblock batches, 11 outdoor/dungeon samples |          380,672-2,866,300 bytes |
| One-entity dynamic snapshot JSON                              |                      1,105 bytes |
| One-entity fixed-tick envelope JSON, five samples             | 1,683-1,693 bytes at up to 30 Hz |
| Physical-flight motion JSON                                   |  425 bytes at 30 Hz while active |

The 11 landblock samples were `0xd954ffff`, `0xda54ffff`, `0xdb54ffff`, `0xd955ffff`,
`0xda55ffff`, `0xdb55ffff`, `0xd956ffff`, `0xda56ffff`, `0xdb56ffff`, `0xf418ffff`, and
`0x7d64ffff`. `0xda55ffff` was the largest at 2,866,300 bytes. Phase 3 will begin with a
16 MiB maximum encoded frame: 5.85 times the largest observed frame, enough for MessagePack wrapper
overhead and materially denser content without permitting unbounded allocation. The exact boundary
must be a shared named protocol constant and covered on both sides. Queue capacity and backpressure
remain Phase 3 implementation decisions; this census forbids a lossy event policy or an unbounded
writer queue.

##### Linux shell, popup, and runtime baseline

- The retained physical A/B in `holtburger-3d-cef-native-popup-investigation.md` is the popup
  baseline. Child embedding fails both the dropdown and physical context menu. A CEF-owned
  top-level window makes both work but leaves a second black Tauri shell.
- `npm run dev:popup-probe -- --release` launched the release shell. Vite reported ready in 233 ms
  and the intervening release rebuild took 16.61 seconds; neither is an application-ready metric.
  The current shell has no readiness marker, so a defensible cold-start number was not captured.
- After the popup probe reached steady state, its nine CEF/Tauri processes reported 1,331,824 KiB
  aggregate RSS, 604,834 KiB aggregate proportional set size, and 394,376 KiB aggregate private
  memory. Proportional set size is the comparison baseline because RSS double-counts shared CEF
  mappings.
- The release Rust executable is 25,109,584 bytes. The executable, reduced CEF runtime files,
  `CREDITS.html`, one locale, and built frontend total 359,399,924 bytes (342.75 MiB). This excludes
  Cargo build artifacts, the downloaded CEF archive, and game data. `libcef.so` alone is
  260,951,112 bytes. Compare Electron against this same content boundary, not the full build cache.

##### Renderer baseline

The initial runs exposed missing minimap setup-model sources. That defect was already fixed in the
primary `3d-next` worktree by `b52ce9ab`; this worktree was rebased onto `3d-next`, and the same
production workloads then completed with exit code 0 and no browser console messages. Measurements
used Chrome's real GPU path at a 1280x720 CSS viewport, device scale factor 1, render scale 1, and
ANGLE Vulkan on an AMD Radeon RX 7900 XT (RADV NAVI31).

| Workload     | Content and visible workload                                                                                                            |                     CPU frame work | GPU frame work |                     Harness timing |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------: | -------------: | ---------------------------------: |
| Outdoor      | `0xda55ffff`; all five radii 1; nine five-layer batches totaling 8,554,468 bytes; 6,000 ms window                                       | 0.948 ms mean; 1.100 ms recent p95 |  0.736 ms mean | 0.995 ms average; 8.100 ms longest |
| EnvCell flat | `0x7d64010e` in `0x7d64ffff` at `(24089.25, 13.6, -19337.75)`; all radii 0; yaw 180; pitch 0; one 1,938,394-byte batch; 6,000 ms window | 0.871 ms mean; 1.400 ms recent p95 |  0.657 ms mean | 0.899 ms average; 6.600 ms longest |

The reproducible commands are the app's `npm run harness:browser` script with `--brief --gpu
--profile-renderer --measure-ms 6000 --render-scale 1`, plus the workload arguments in the table.
The EnvCell run also requires `--frame-mode flat`; without a frame-mode, map, or possession
scenario, the harness parses the EnvCell camera arguments but does not apply them. This is a harness
interaction contract worth preserving during the migration.

##### Extraction dry-run findings

- Only five Rust files contain `tauri::` references: `main.rs`, `lib.rs`,
  `explorer_entity_simulation.rs`, `host_fixed_tick_runtime.rs`, and
  `host_physical_fly_runtime/mod.rs`. Most app-local host behavior is already shell-neutral.
- Deleting `src-tauri` would also delete four diagnostic binaries:
  `dev_landblock_content_host`, `inspect_coplanar_apertures`, `inspect_interior_projection`, and
  `portal_trace_archive`. All four remain in scope for migration unless a later consumer audit
  proves one dead. The browser harness already depends on `dev_landblock_content_host`; it should
  become a host-crate binary rather than be reinvented.
- Phase 2 is split into a mechanical module/test/binary relocation followed by Tauri dependency
  inversion and focused composition-root cleanup. Combining those with a broad `lib.rs`
  reorganization would make parity failures unnecessarily difficult to locate.
- Automated cross-platform host/protocol/package gates are release-support gates rather than a
  prerequisite for the local shell cutover. The phase order is deliberately manual refinement,
  clean local cutover, then portability/package certification.

### Phase 1: Establish one frontend host boundary

Status: complete on the Tauri-backed implementation; the shell-neutral boundary is now the seam
used by the Explorer composition root. Electron remains the next implementation of the same API.

#### Deliverables

- A shell-neutral `HostTransport` under `apps/holtburger-3d/src/lib/host/` with typed invoke and
  event-listening operations.
- One Tauri implementation used only by the current application composition roots.
- Existing asset sources and Explorer/camera sessions injected with that transport.
- Shell-neutral names for touched `Tauri*` sources and factories.

#### Task checklist

- [x] Inventory each direct `@tauri-apps/api` import and map it to a named consumer.
- [x] Define the narrow command and event type maps required by those consumers.
- [x] Inject one transport from the Explorer/client composition root rather than dynamically
      importing Tauri in every adapter.
- [x] Preserve the existing source/session interfaces used by browser tests and the harness.
- [x] Rename migrated adapters from `Tauri*` to honest capability names in the same change; sweep
      filenames, symbols, tests, comments, and docs for the obsolete vocabulary.
- [x] Add unit tests for request routing, listener disposal, error propagation, and binary response
      normalization at this single boundary.

#### Acceptance criteria

- `rg '@tauri-apps/api' apps/holtburger-3d/src` finds only the one temporary Tauri transport module
  and any test explicitly covering it.
- The current Tauri application retains command/event behavior and renderer output.
- Browser harnesses and frontend unit tests do not require Electron or Tauri globals.

#### Decisions and course corrections

- The temporary Tauri dependency is isolated to `src/lib/host/tauri-host-transport.ts`; all asset
  adapters and Explorer sessions consume the injected `HostTransport` instead of importing Tauri.
- Binary shape normalization is centralized in `src/lib/host/binary-response.ts`; decoders remain
  capability-owned and continue to validate domain payloads.
- Existing browser/test doubles retain their focused capability interfaces. The shell boundary is
  typed at command/event names and payloads, while capability adapters perform final result decoding.

### Phase 2: Extract a shell-neutral Rust host

Status: complete for the shell-neutral host and temporary Tauri parity adapter. The broad command
module split remains intentionally deferred until after frontend parity.

#### Deliverables

- `apps/holtburger-3d/host/`, a workspace crate named `holtburger-3d-host`.
- `HostRuntime`, which owns the current content, simulation, entity, fixed-tick, physical-flight,
  and kinematic-boom services.
- An injected `HostEventSink` replacing direct `tauri::AppHandle` ownership in runtime producers.
- Typed host methods and request structures that contain no Tauri state wrappers or command macros.
- A temporary thin Tauri adapter calling the extracted host while the Electron slice is built.

#### Task checklist

- [x] Phase 2A: mechanically move app-local behavior, tests, and projection modules from
      `src-tauri` into `host` while preserving module layout; do not promote Explorer-specific
      policy into shared crates or reorganize behavior during the move.
- [x] Move all four existing diagnostic binaries with their owning modules:
      `dev_landblock_content_host`, `inspect_coplanar_apertures`,
      `inspect_interior_projection`, and `portal_trace_archive`. Preserve the browser harness's
      existing content-host contract.
- [x] Establish a compiling, testable checkpoint after the mechanical relocation and before
      dependency inversion.
- [x] Phase 2B: replace the five known `tauri::` coupling sites with shell-neutral runtime,
      scheduler, and event-sink dependencies.
- [x] Replace `tauri::State` parameters with explicit references owned by `HostRuntime`.
- [x] Replace `TauriDynamicEntityEventSink` and the physical-flight `AppHandle` dependency with the
      same injected event-sink contract.
- [x] Keep command validation and error construction in Rust host methods so every shell observes
      identical behavior.
- [ ] After parity is established, split the current broad `lib.rs` by command family in focused
      changes; do not reproduce a composition god file or mix the reorganization into relocation.
- [x] Move existing Rust tests with their owning modules and add direct tests for host construction,
      command behavior, event publication, and shutdown.
- [x] Keep the temporary Tauri adapter deliberately mechanical and mark it for deletion in Phase 8.

#### Acceptance criteria

- The `host` crate compiles and its tests run without Tauri or CEF dependencies.
- `rg 'tauri::' apps/holtburger-3d/host` returns no matches.
- The temporary Tauri application still reaches every inventoried command and event through the
  extracted host.
- Shared crate boundaries are unchanged unless a separately justified reusable behavior is found.

#### Decisions and course corrections

- Preserve the four existing binaries during extraction. Their imports reveal app-local host
  consumers that the earlier directory-level plan missed.
- Use two reviewable checkpoints: mechanical relocation first, then dependency inversion and
  composition cleanup.
- Added `apps/holtburger-3d/host` as a workspace crate and left `src-tauri` as a thin adapter. The
  host has no Tauri/AppHandle references, owns the fixed-tick stop hook needed for sidecar shutdown,
  and passes 228 host library tests plus all-target checks and Clippy with warnings denied.
- The broad `lib.rs` command-family split remains unchecked deliberately; doing it before the
  Electron parity slice would combine cleanup with a transport migration and make regressions less
  localizable.

### Phase 3: Implement and prove the sidecar protocol

Status: complete for the Linux protocol vertical slice, including the measured representative-load
exercise. Cross-platform and packaging validation remain later phases.

#### Deliverables

- A `holtburger-3d-host` binary entry point using framed stdin/stdout MessagePack.
- Rust protocol types colocated with the app-local host boundary.
- An Electron-main-side protocol client with incremental frame parsing, request multiplexing,
  event delivery, backpressure, bounded frames, and process-exit handling.
- Protocol tests that exercise fragmented frames, coalesced frames, binary payloads, malformed
  input, oversize frames, unknown commands, concurrent requests, events, and shutdown.

#### Task checklist

- [x] Add MessagePack dependencies through Cargo/npm tooling without hard-coding presumed current
      versions.
- [x] Define a versioned handshake and reject incompatible peers before accepting requests.
- [x] Represent commands as a closed tagged enum in Rust and an equivalent typed map in TypeScript;
      do not accept arbitrary method reflection.
- [x] Preserve `Uint8Array`/Buffer data through Rust, Electron main, preload, and renderer without
      JSON or base64 conversion.
- [x] Reserve stdout for frames and route all logs/panics to stderr.
- [x] Define the initial maximum encoded frame as 16 MiB on both sides, reject larger announced
      lengths before allocation, and test the exact boundary. Revisit only with a larger measured
      production payload.
- [x] Serialize responses and events through one writer. Preserve mutation event-before-response
      enqueue order and the distinct Explorer-versus-physical-flight publication-failure behavior
      recorded in Phase 0.
- [x] Make writer queue capacity and backpressure explicit and bounded. Do not silently drop or
      coalesce events unless the owning runtime first defines that event as replaceable state.
- [x] Exercise a representative 2.87 MB response and the 8.55 MB nine-landblock burst while host
      events are active. The real sidecar returned nine concurrent batches totaling 8,554,468 bytes
      (largest 2,866,300 bytes) in 1,485.5 ms and delivered the reset mutation event; there was no
      corruption, deadlock, or timeout. The timing is diagnostic only.
- [x] Define cancellation only if a measured command needs it; process shutdown must not depend on
      per-request cancellation.
- [x] Run a temporary real-child diagnostic that exercises `host_status`, binary assets, mutation
      events, application errors, shutdown, and the representative bulk burst. The diagnostic was
      removed after the run because this repository does not check in the production DAT archive;
      the retained unit protocol tests use checked-in-independent fixtures.

#### Acceptance criteria

- A temporary real host subprocess diagnostic passed on Linux; it is not retained because the
  production DAT archive is not a checked-in fixture.
- Binary responses arrive byte-identical to direct host calls.
- Concurrent responses are matched by request ID, and a host crash rejects every pending request
  with a visible error.
- Representative bulk responses and concurrent events complete without corruption, deadlock,
  unbounded queue growth, or timeout on the available Linux environment.
- Timing and allocation observations are diagnostic evidence, not a prerequisite for building the
  Electron product slice. Cross-platform hosted runs prove protocol behavior rather than
  user-perceived performance.

#### Decisions and course corrections

- The initial encoded-frame ceiling is 16 MiB, based on a 2,866,300-byte observed maximum and
  5.85 times headroom.
- A single ordered protocol writer is part of behavioral parity, not merely an implementation
  convenience.
- Use framed stdin/stdout as the production sidecar transport unless a working build demonstrates
  a user-visible problem. Do not build a socket comparison or alternate transport preemptively.
- Cargo selected `rmp-serde 1.3.1` and npm selected `@msgpack/msgpack 3.1.3`; binary responses use
  MessagePack `bin` values rather than JSON arrays. A temporary real-child diagnostic covered
  status, `load_active_region_data`, reset-event-before-response ordering, an application error,
  and shutdown against the local production DAT archive before being removed under the repository's
  runtime-asset test policy.
- The first bounded writer used Tokio's `blocking_send`, which would panic when a command handler
  published an event from inside the runtime. It was replaced with a bounded `std::sync::mpsc`
  channel and dedicated stdout writer thread; this retains backpressure without runtime re-entry.
- The real-child nine-landblock burst now covers the measured 2.87 MB maximum and 8.55 MB aggregate
  load while a mutation event was interleaved. A second temporary diagnostic started physical flight
  and observed seven ordered motion events before stopping the session. Those production-DAT
  diagnostics are intentionally not retained as tests because the archive is not checked in. npm
  currently reports 30 audit findings after Forge/Electron installation; dependency review belongs
  in Phase 9/10.

### Phase 4: Build the Electron shell vertical slice

Status: complete for the available Linux/X11 validation path. The host-free Electron popup probe
passed single-window, keyboard, DevTools, context-menu, and stable native-select checks. Wayland
remains an explicit later certification case.

#### Deliverables

- Electron main and preload entry points under `apps/holtburger-3d/electron/`.
- A single hardened `BrowserWindow` matching the current size constraints and entry selection.
- Development scripts that start Vite, build/spawn the Rust host, and open the selected client,
  Explorer, or runtime probe route.
- Production resource-path resolution for the packaged sidecar.

#### Task checklist

- [x] Install Electron and Electron Forge through npm so the package manager chooses current
      compatible versions and records them in `package-lock.json`.
- [x] Keep the renderer on its current Vite configuration and let Forge package its built output.
      Do not adopt Forge's experimental Vite plugin without a separate, evidence-backed need.
- [x] Reuse `scripts/entry-paths.mjs`; replace the Tauri launcher rather than fork its entry parsing.
- [x] Pass the development content location explicitly to the child process. Preserve explicit
      `HOLTBURGER_DATS` overrides and fail with the current actionable discovery error when content
      is unavailable.
- [x] Load only the fixed local Vite origin in development and packaged files in production.
- [x] Expose the typed host bridge through `contextBridge`; do not expose `ipcRenderer`, Node APIs,
      process spawning, filesystem access, or generic channel names.
- [x] Deny unexpected navigation and window creation.
- [x] Supervise exactly one host child and cover normal exit, renderer reload, Electron quit, host
      panic, and orphan prevention.
- [x] Run the framework-free popup probe in Electron before involving the Explorer and manually
      confirm context menu, keyboard input, DevTools, and absence of a second black window.
- [x] Confirm that the native select popup has stable geometry/shadow under the available display
      backend; the explicit X11 A/B is stable while the earlier default Wayland run showed slight
      per-frame jitter.

#### Acceptance criteria

- On the available Linux environment, physical `<select>` dropdowns and context menus appear in the
  same normal application window.
- There is no second black host window.
- The renderer reports no Node globals and cannot invoke unallowlisted Electron IPC.
- Development startup, reload, host crash reporting, and clean shutdown behave deterministically.

#### Decisions and course corrections

- Use Forge for packaging, but retain the existing renderer Vite pipeline instead of coupling the
  migration to Forge's experimental Vite plugin.
- Installed Electron `44.0.0`, Electron Forge `7.11.2`, and the ZIP maker through npm. The shell
  emits one `dist-electron/electron/main.js`, a CommonJS preload, and one copied entry manifest;
  Forge packages the release Rust sidecar as an extra resource.
- The container's Chromium sandbox host is rejected by its seccomp policy. The popup smoke test is
  running with `ELECTRON_DISABLE_SANDBOX=1` only for this container validation; the production
  `BrowserWindow` still sets `sandbox: true`. A normal unsandboxed production claim is deferred to
  the user's manual check or a less restricted Linux runner.
- Electron does not automatically display the browser's default context menu. The main process now
  owns a small explicit menu (reload, editing roles where applicable, and inspect element); the
  user confirmed that right-click now produces a menu. DevTools also opens with Ctrl+Shift+I.
- The native select was stable in the explicit X11 run after showing slight per-frame size/shadow
  jitter in the earlier default Wayland run. No CSS or child-window workaround was added. Wayland
  behavior remains a Phase 9 certification item; forcing X11 globally would be a product/platform
  decision and is intentionally not made in this slice.

### Phase 5: Cut the product frontend over to Electron

Status: complete for the available Linux/X11 cutover. The Explorer composition root now selects the
Electron preload bridge when it is present, with a temporary Tauri fallback retained until Phase 8.
The real Electron Explorer has started successfully, passed the available manual popup/DevTools
smoke check, and completed the representative renderer/sidecar scenarios below. Renderer reload
automation and the pre-existing possession coordinate contract remain explicit follow-ups; they do
not block this Linux vertical slice.

#### Deliverables

- An Electron `HostTransport` backed by the preload API.
- Explorer and client composition roots using the Electron transport.
- Full parity for the Phase 0 command/event inventory.
- A Linux build suitable for manual scenario and responsiveness comparison against the current
  shell.

#### Task checklist

- [x] Route every asset source, simulation session, entity session, physical-flight session, and
      kinematic-boom session through the injected `HostTransport` selected by the Explorer
      composition root; the Electron preload implementation is selected whenever its bridge exists.
- [x] Verify the active-region and representative landblock binary paths through the real sidecar;
      the nine concurrent responses were byte-bearing, bounded, and matched the measured direct
      host sizes. The full per-capability decoder census remains a follow-up.
- [x] Verify event-before-response ordering, generation/revision handling, and listener disposal in
      the protocol/capability tests and real dynamic-entity/follow-flight runs.
- [ ] Verify renderer reload against the live sidecar; the bridge is reload-safe by construction,
      but an automated Electron reload assertion is still debt.
- [x] Exercise representative outdoor and EnvCell renderer workloads with the browser harness at
      render scale 1; both runs completed without console errors on the real AMD/Vulkan renderer.
- [x] Exercise dynamic entities, physical flight, audio, particles, textures, workers, and
      streaming through the browser harness; the follow-flight run crossed into `0xda56ffff` with
      no browser errors and observed live audio plus particle/physics activity.
- [ ] Exercise possession through the browser harness. The existing possession assertion currently
      fails for the documented WCID fixtures because its signed backward-displacement expectation
      is opposite the observed host coordinates; the failure is identical in the browser-only path
      and is not attributed to Electron. Keep this as pre-existing harness debt until its owner
      resolves the coordinate contract.
- [x] Exercise both Electron app entry routes: the Explorer was manually checked and the named
      `dev:electron:client` route started and exited cleanly.
- [x] Use the browser harness for renderer regression evidence and the real sidecar diagnostic for
      shell/host protocol behavior the browser cannot reproduce. A dedicated automated Electron
      reload assertion remains the only lifecycle gap called out above.
- [x] Make the working Electron build available for manual checks across representative outdoor,
      EnvCell, streaming, movement, and popup scenarios. The user checked the running Explorer and
      confirmed popups, dropdowns, and embedded DevTools; no second black window was observed.
- [x] Record installed size and a coarse steady-state memory sample for operational context: the
      packaged Linux x64 tree is 382 MiB; at idle the main process was 174 MiB RSS, the GPU process
      236 MiB, the renderer 95 MiB, and the host 186 MiB. These are one container sample, not a
      release threshold.

#### Acceptance criteria

- The closed Electron command/event maps cover all 36 inventoried commands and five events; the
  representative real-child and renderer checks below exercise the high-risk binary, mutation,
  movement, and streaming paths. A full per-capability runtime census remains follow-up work.
- The Explorer completes representative Linux workflows without a Tauri runtime present in the
  process tree.
- Popup behavior is fixed and embedded DevTools opens without the previous CEF GPU-process failure.
- Renderer correctness matches the browser harness, and manual use reveals no blocking input lag,
  streaming stall, or responsiveness regression in the named scenarios.

#### Decisions and course corrections

- The first real Electron Explorer launch exposed an envelope-shape mismatch: the existing
  capability adapters already pass Tauri-shaped `{ request }`, `{ registration }`, and `{ intent }`
  arguments, while the initial wire mapper wrapped them a second time. `wireCommand` now preserves
  those established shapes and spreads the direct `guid`/`generation` commands. This keeps the
  frontend capability contracts stable and makes Rust remain the single request validator.
- The browser harness's moved diagnostic host command still pointed at the deleted `src-tauri`
  manifest after Phase 2. It now runs the preserved binary from `holtburger-3d-host`; outdoor and
  EnvCell harness runs both pass after the correction.
- The user's Linux/X11 Explorer check is the first product-level Electron evidence: one window,
  working native popup/dropdown/context-menu behavior, and embedded DevTools. It does not certify
  Wayland, Windows, or macOS; those remain explicit later gates.
- Production packaging now completes on Linux x64 with Forge after granting its runtime download
  network access. The packaged binary launched the Explorer and resolved the bundled sidecar from
  `resources/` successfully. The package is intentionally ignored as a generated `out/` artifact;
  its measured size and one coarse RSS sample are recorded above.
- Added a named `dev:electron:client` script so both existing app entry routes are exercised through
  the same launcher. A tracked `entry-paths.d.mts` declaration keeps a clean checkout independent
  of generated TypeScript output.
- The browser possession assertion is recorded as an existing coordinate-contract debt, not
  weakened or papered over for the migration. The Electron cutover therefore claims the passing
  renderer/streaming/dynamic paths and leaves that specific scenario open.

### Phase 6: Resteer before the irreversible cutover

#### Task checklist

- [x] Review protocol complexity, duplicated adapter code, memory copies, child lifecycle behavior,
      security posture, manual responsiveness observations, and remaining Tauri dependencies.
- [x] Dry-run Phases 7 through 9 against the actual files and CI configuration.
- [x] Confirm the migration still removes more shell-specific complexity than it introduces.
- [x] Stop and revise the design if host IPC is unstable, manual scenarios reveal material stalls,
      resource use grows without bound, or Electron does not resolve the proven popup/DevTools
      failures. Do not stop solely on noisy synthetic or hosted-runner timing differences.
- [x] Record the go/no-go decision and any reordered work in this section.

#### Acceptance criteria

- The user has a concrete Linux comparison and an enumerated portability gap, not a framework-level
  promise.
- Proceeding to deletion is an explicit recorded decision.

#### Decisions and course corrections

- **GO to Phase 7 manual refinement; NO-GO to the irreversible shell deletion for now.** The
  Linux/X11 Electron Explorer passed the product scenarios and the sidecar passed the measured
  concurrent binary burst and physical-flight event exercise. The next gate is an interactive pass
  with the user on the available desktop, while the thin Tauri adapter remains the recoverable
  comparison path. Portability/package work moves after the local cutover into Phase 9.
- The protocol has one bounded 16 MiB frame limit, one ordered writer with a 256-frame queue, a
  closed 36-command/5-event inventory, handshake/version rejection, binary MessagePack payloads,
  pending-request rejection on child exit, and a bounded shutdown kill path. The real Linux burst
  completed without corruption, deadlock, timeout, or unbounded growth. The remaining protocol
  work is lifecycle/reload automation, not a transport redesign or a socket detour.
- The temporary duplication is bounded and named: one Electron main/preload bridge, one
  shell-neutral `HostTransport`, and one Tauri parity adapter. The frontend no longer fans out
  direct Tauri imports. The final Phase 8 deletion removes the Tauri command/state wrapper,
  launcher, configuration, and CEF dependency; the added sidecar protocol is justified by the
  cross-platform shell boundary rather than by a shared-crate abstraction.
- Operational evidence is finite but intentionally coarse: the packaged Linux x64 tree is 382 MiB;
  the idle sample was approximately 174 MiB main RSS, 236 MiB GPU, 95 MiB renderer, and 186 MiB
  host RSS. No material input lag, streaming stall, or process accumulation appeared in the named
  scenarios. These observations are comparison context, not release thresholds.
- Electron's security boundary is in place for this slice: `sandbox`, context isolation, disabled
  Node integration, a narrow preload API, an allowlisted command set, typed event forwarding, and
  denied navigation/window creation. The later cleanup audit still needs exact URL-boundary tests,
  dependency advisories, CSP/resource policy, and platform signing review.
- A registry-backed `npm audit` refresh was unavailable in this restricted environment; the earlier
  dependency install reported 30 findings. No automatic audit fix was applied. Treat dependency
  review as a Phase 9/10 release gate rather than silently claiming a clean advisory state.
- The portability dry-run found no Electron workflow in `.github/workflows`; `nightly.yml` only
  builds the existing Rust/TUI artifacts even though its target matrix is reusable. Phase 9 must
  add `npm ci`, Electron-main/renderer checks, native sidecar builds, package-resource inspection,
  and target-specific launch smoke reporting for Linux x86-64, Windows x86-64, macOS x86-64, and
  macOS arm64. Unsigned artifacts remain internal and do not block the local Phase 8 cutover.
- The current production sidecar discovers `HOLTBURGER_DATS`/HBA content during startup, while
  this repository intentionally does not check in the production DAT archive. Phase 9's real
  subprocess protocol test and packaged `host_status` smoke must therefore use a checked-in,
  fixture-backed or explicitly no-content test path; they must not reintroduce an ignored test that
  depends on a developer's external DAT files. Production-DAT burst and renderer scenarios remain
  manual diagnostics.
- The Linux manual result does not certify native Wayland, Windows, or macOS. Phase 9 remains a
  real packaged-run certification gate, including display scaling, GPU, audio, content discovery,
  lifecycle cleanup, signing, and notarization where applicable. This is an enumerated portability
  gap, not evidence against the Electron architecture.

### Phase 7: Manually verify and refine the Electron client

Status: complete. The user accepted the refined Electron Explorer on the available Linux desktop.
This is local product evidence, not cross-platform certification or a release gate. The Tauri
fallback remains only until Phase 8 performs the clean shell cutover.

#### Deliverables

- A repeatable Electron development loop for the Explorer and client routes.
- User-verified behavior notes for popups, dropdowns, context menus, DevTools, focus, keyboard and
  pointer input, movement, streaming, content discovery, audio, workers, and dynamic entities.
- Fixes for issues that are demonstrated during the manual pass, with browser-harness and sidecar
  parity checks retained as regression evidence.
- An explicit disposition for renderer reload, host crash/quit cleanup, the possession coordinate
  contract, and any platform/backend-specific visual quirks observed locally.

#### Task checklist

- [x] Run the Electron Explorer and client through the normal development launcher, with the user
      checking representative workflows and recording anything that feels broken or awkward.
- [x] Verify native dropdowns, context menus, keyboard input, DevTools, focus changes, window close,
      and the absence of a second or black host window. Automated renderer reload/crash coverage
      remains named lifecycle debt rather than an unverified manual claim.
- [x] Exercise outdoor, EnvCell, streaming, movement/physical flight, dynamic spawn/despawn,
      possession, audio, particles, textures, workers, and client-route scenarios against the same
      content used by the existing browser harness where available. The pre-existing possession
      coordinate assertion remains separately dispositioned below.
- [x] Compare default display-backend behavior with explicit X11/Wayland settings when available;
      record jitter, scaling, multi-monitor, GPU, or focus differences without forcing a global
      backend choice prematurely.
- [x] Fix demonstrated Electron-shell or host-boundary defects, and add focused tests or harness
      assertions when the behavior is deterministic and fixture-independent.
- [x] Resolve the possession assertion's coordinate contract or leave a named, reproducible debt;
      do not weaken the assertion to make the migration look green.
- [x] Keep the browser harness independent and use the Tauri path only as a comparison oracle while
      refining the Electron path. Do not repoint the public default scripts during this phase.
- [x] Update this plan with each manual finding, fix, concession, and remaining debt before the
      Phase 8 cutover decision.

#### Acceptance criteria

- The user can complete the named Electron Explorer/client workflows on the available desktop
  without a blocking popup, input, streaming, lifecycle, or responsiveness defect.
- Any remaining issue has a reproducible disposition: fixed, explicitly deferred to portability or
  certification, or recorded as a known application/coordinate-contract debt.
- Browser-harness and sidecar checks remain green after manual refinements.
- The Phase 8 cutover is an explicit local decision; cross-platform packaging is not implied by this
  phase's Linux result.

#### Decisions and course corrections

- Manual verification is intentionally the next phase so the user can shape the Electron client
  before public command names and the production shell are changed. Portability packaging and
  hosted certification are deferred to Phase 9 rather than blocking this feedback loop.
- The first manual feedback batch found four shell-contract defects: Electron interpreted the
  configured `1440x900` as outer-window dimensions while Tauri CEF applies it as inner dimensions;
  Electron installed its standard application menu; the BrowserWindow appeared before its first
  painted frame; and the launcher killed an npm wrapper rather than the Vite process it spawned.
- `useContentSize` alone did not preserve the requested width under Electron/Wayland: a geometry
  trace measured `1100x900`, with the width renegotiated to the configured minimum. Reapplying
  `setContentSize(1440, 900)` while the window remains hidden measured the intended `1440x900`.
  Monitor placement remains owned by GNOME rather than application policy.
- The Electron window removes the application menu, starts hidden against the frontend's `#0b0a08`
  background, and becomes visible on `ready-to-show`. Frontend load and host startup run
  concurrently, so content painting no longer waits behind host discovery.
- The development launcher now spawns Vite directly through the current Node executable, waits for
  that exact child to exit, and escalates from `SIGTERM` to `SIGKILL` after a two-second grace period.
  A real window-close smoke exited with code zero and left no Electron, host, launcher, or Vite
  process.
- Closing the diagnostic window one second after first paint caught content requests still in
  flight. The host did not acknowledge graceful shutdown within its existing two-second bound, was
  force-killed as designed, and left no orphan. Keep the timeout visible and revisit only if normal
  post-load closes are slow or noisy during user verification.
- Manual DevTools verification exposed a startup dynamic-entity event with its semantic payload
  nested under a second `payload` field. The Rust wire enum combined Serde's adjacent
  `content = "payload"` representation with struct variants that also named their field `payload`.
  Newtype variants now produce the intended single payload layer, with a MessagePack wire-shape
  regression test.
- `dev:electron` also reused an existing host binary without checking whether Rust sources had
  changed. Development startup now always asks Cargo to build the selected debug or release
  profile; Cargo's incremental build keeps the no-change path cheap while preventing stale sidecars.
  A traced startup after rebuilding delivered the dynamic snapshot with top-level
  `kind: "snapshot"` as required by the frontend contract.
- Chromium rendered its default focus outline around the scene canvas after pointer interaction.
  The canvas remains focusable because it owns camera keyboard input and blur cleanup, but its
  input-control outline is suppressed without changing focus indicators on actual UI controls.
- **GO to Phase 8 clean shell cutover.** The user accepted the one-window Electron Explorer after
  verifying popup, dropdown, context-menu, DevTools, focus, startup, sizing, and close behavior and
  refining the defects above. The remaining automated reload/crash check, possession-coordinate
  assertion, early-close host timeout, CSP/advisory review, and cross-platform certification remain
  explicitly tracked debt; none requires retaining two production desktop shells.

### Phase 8: Make the clean shell cutover

Status: complete. Electron is the sole production desktop shell, and the public development
commands now launch it by default.

This follows Phase 7's local manual acceptance. It does not wait for Windows/macOS packaging or
certification; those are Phase 9 release-support gates.

#### Deliverables

- Electron as the only production desktop shell.
- Removal of `apps/holtburger-3d/src-tauri`, its workspace member, Tauri configuration, CEF setup,
  Tauri npm/Rust dependencies, and Tauri launch/build scripts.
- Updated README, architecture snapshot, npm scripts, lint configuration, and developer workflow.

#### Task checklist

- [x] Delete the temporary Tauri adapter and all Tauri/CEF dependencies only after the Phase 6 go
      decision and Phase 7 manual acceptance pass.
- [x] Change the Cargo workspace member from `src-tauri` to `host`.
- [x] Replace `dev`, `dev:explorer`, `dev:client`, popup-probe, and release launch scripts with
      Electron equivalents; remove `tauri:*`, `prepare-cef`, and Tauri-only check/build scripts.
- [x] Sweep surviving code, comments, test names, filenames, docs, and UI text for obsolete Tauri,
      CEF, child-window, and `src-tauri` vocabulary.
- [x] Either rename the popup probe to a justified desktop-runtime smoke probe or delete its app
      registration; retain the historical investigation document.
- [x] Keep the browser harness independent and preserve its existing command-line behavior.

#### Acceptance criteria

- `rg -i 'tauri|cef|src-tauri' apps/holtburger-3d Cargo.toml` reports only intentional historical
  documentation references.
- A fresh install can check, lint, test, develop, and build the Electron app using documented npm
  scripts, with `npm run dev` and `npm run dev:explorer` launching Electron by default.
- No production code supports two desktop shells.

#### Decisions and course corrections

- The default script names become Electron-owned at this point so parallel frontend work no longer
  needs to remember a shell-specific suffix. Portability/package certification remains explicitly
  pending and does not get represented as supported-platform status.
- The clean cutover deleted `src-tauri`, the temporary Tauri transport, Tauri/CEF dependencies and
  setup scripts, and the migration popup probe. The historical investigation and migration plans
  remain as evidence; production source and current developer documentation use only the
  shell-neutral host and Electron terminology.
- The Explorer composition root now constructs the Electron transport directly. There is no
  runtime shell detection, fallback, or second production adapter.
- Public `dev`, `dev:explorer`, `dev:client`, release-development, check, lint, package, and make
  scripts now target Electron and `holtburger-3d-host`. Cargo and npm lockfiles were pruned as part
  of the same cutover.
- Packaging exposed stale package-manager/Vite cache directories beside live dependencies. Forge
  now packages only built application output and runtime dependencies; the local stale caches were
  removed rather than retaining deleted-shell names in packaging configuration. Inspection of the
  rebuilt Linux ASAR found no source tree, development cache, Tauri, CEF, `src-tauri`, or popup-probe
  artifacts, and its external resources contain only `holtburger-3d-host`.
- `npm run dev` and `npm run dev:explorer` both launched the real Electron app and exited without
  leaving Electron, Vite, launcher, or host processes. The packaged application also completed a
  content-backed startup smoke when `HOLTBURGER_DATS` named the local archive; without that
  explicit content it failed loudly with the existing actionable discovery error.
- Phase 8 verification passed Svelte/TypeScript checks, Electron checks, ESLint, dead-code lint,
  1,481 frontend tests, Rust formatting, Clippy with warnings denied, 233 host tests, Electron
  packaging, ASAR inspection, and packaged startup. Vite still reports the existing 737.42 kB
  `map-renderer` chunk warning; it is renderer build debt rather than a shell-cutover regression.
- The final quality pass refreshed the registry audit and applied npm's non-breaking fixes. Runtime
  dependencies report no known vulnerabilities. Forge's development-only packaging graph retains
  24 advisories through its current `@electron/packager`, `@electron/rebuild`, and Inquirer
  dependencies; npm offers only a forced Forge downgrade, so Phase 9/10 must resolve these through
  compatible upstream releases rather than an untested override.

### Phase 9: Add portability, packaging, and platform certification gates

Status: next. The local Linux shell is cut over; other operating systems and release packaging are
not yet certified.

This is the last migration phase before release-readiness cleanup. It is intentionally not a
prerequisite for the local Phase 8 shell cutover. Until it is complete, Electron packages for
unavailable systems are build artifacts, not supported releases.

#### Deliverables

- A hosted CI matrix for Linux x86-64, Windows x86-64, macOS x86-64, and macOS arm64.
- Per-target Rust host binaries paired with Electron packages of the same OS and architecture.
- Unsigned internal artifacts and package-resource inspections, with signing/notarization inputs
  isolated as release secrets.
- Real packaged-run certification records for each available platform and display backend.

#### Task checklist

- [ ] Build the Rust sidecar on the corresponding hosted OS runner, natively where the required
      architecture is available and with an explicitly tested same-OS cross-build otherwise; do
      not place an architecture-mismatched binary into an Electron package.
- [ ] Run Rust host tests, TypeScript checks, Electron-main tests, and a real subprocess protocol
      integration test on every target. The subprocess test must use a checked-in fixture-backed or
      explicitly no-content host path; it must not depend on a developer's untracked production DAT
      archive.
- [ ] Package the frontend and verify the expected host executable and static assets are present at
      the path resolved by Electron main.
- [ ] Launch the packaged app and complete a minimal handshake/`host_status`/shutdown smoke test on
      each runner where the runner provides a usable desktop session, using the same checked-in
      fixture-backed or no-content startup path. Record runner limitations rather than converting
      an unrun GUI test into a pass.
- [ ] Upload packages as internal artifacts. Do not publish them as supported releases yet.
- [ ] Configure, but do not fabricate, Windows code-signing and macOS signing/notarization inputs.
- [ ] Keep installer-format choices isolated from application runtime code. Initial support may use
      portable archives while the final Windows installer, macOS disk image, and Linux package
      policy is decided.
- [ ] On Windows x86-64, verify install/uninstall or archive launch, popup and context-menu input,
      keyboard/mouse capture, WebGL/GPU identity, DPI changes, audio, workers, content discovery,
      host crash/quit cleanup, and representative Explorer/client flows.
- [ ] On macOS arm64 and either macOS x86-64 hardware or the chosen universal-build strategy,
      verify the equivalent behaviors plus application focus/menu conventions, Retina coordinates,
      app-bundle sidecar execution, signing, and notarization.
- [ ] Manually exercise representative renderer and streaming scenarios on each OS. Gather
      targeted measurements when behavior appears questionable rather than expecting Linux timings
      or hosted-runner numbers to transfer.
- [ ] Test Linux under native Wayland and X11/XWayland where available, including high-DPI and
      multi-monitor behavior. Accept documented Wayland window-management restrictions only if no
      named Holtburger workflow depends on them.
- [ ] Record OS version, architecture, GPU, display scaling, package type, and exact tested build for
      every certification result.
- [ ] File platform-specific failures against the owning shell, host lifecycle, renderer, audio, or
      packaging layer; do not add broad platform conditionals before locating the boundary.

#### Acceptance criteria

- Every target builds, passes protocol tests, and produces a package containing the correct native
  host executable. Any platform without an automated packaged-launch result is visibly marked
  unverified.
- Windows, macOS, and Linux each have a real packaged-run certification record covering native
  input, WebGL, content, audio, IPC, lifecycle, and packaging before that platform is advertised as
  supported.
- Signed Windows and signed/notarized macOS release candidates launch without security bypasses.
- CI never reports an unsigned or unnotarized artifact as a public release candidate, and known
  platform divergences are documented with a named affected workflow and disposition.

#### Decisions and course corrections

- Portability packaging and cross-platform certification were moved after the local Phase 8 shell
  cutover so they cannot block parallel frontend work. This phase still gates platform support and
  public release claims.

### Phase 10: Cleanup and release-readiness review

#### Task checklist

- [ ] Remove temporary protocol probes, duplicate adapters, migration-only feature flags, and stale
      package scripts.
- [ ] Profile IPC and renderer paths with diagnostics disabled; remove instrumentation that has no
      continuing consumer.
- [ ] Confirm every platform-specific branch has a demonstrated platform requirement.
- [ ] Audit child-process cleanup, protocol bounds, preload exposure, CSP/navigation policy, packaged
      resource paths, license notices, and Electron/Chromium update procedure.
- [ ] Update this plan's decisions and course corrections, then move enduring operational guidance
      into the app README or architecture documentation.
- [ ] Run formatting, TypeScript checks, ESLint/knip, frontend tests, Rustfmt, Clippy with warnings as
      errors, Rust tests, browser harness verification, Electron integration tests, and packaging
      checks.

#### Acceptance criteria

- The final tree looks intentionally Electron-based rather than migrated from Tauri in layers.
- No temporary dual-shell mechanism or unused transport abstraction survives.
- All Definition of Done items below are satisfied.

#### Decisions and course corrections

- None recorded.

## Risks and Mitigations

| Risk                                                                        | Mitigation                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sidecar IPC adds latency or copies to large asset loads.                    | Preserve the existing binary formats inside MessagePack binary values, bound allocations, complete a representative concurrent-load smoke test, and rely on manual product scenarios to decide whether optimization is deserved.                                   |
| Event production outruns Electron or renderer consumption.                  | Honor stream backpressure in Electron main, retain producer-owned revisions, fail visibly on unbounded growth, and coalesce only where the owning runtime already defines replaceable state. Investigate further only if the working build exhibits lag or stalls. |
| Rust behavior remains entangled with Tauri types.                           | Extract `HostRuntime` and `HostEventSink` while Tauri still provides a parity adapter; reject Tauri imports in the final host crate.                                                                                                                               |
| The frontend accumulates Tauri and Electron adapter variants.               | Collapse direct Tauri imports into one transport first, inject it at composition roots, then delete the Tauri implementation in one cutover.                                                                                                                       |
| Host crashes strand Electron promises or processes.                         | Supervise one child, reject all pending requests on exit, expose failure visibly, implement orderly shutdown with a bounded forced termination, and test crash/reload/quit paths.                                                                                  |
| A compromised renderer reaches Node or arbitrary host operations.           | Enable isolation and sandboxing, disable Node integration, expose an allowlisted typed preload API, restrict navigation/window creation, and validate every request in Rust.                                                                                       |
| CI builds create false confidence without real hardware input/GPU behavior. | Separate automated portability gates from manual certification and label untested artifacts unsupported.                                                                                                                                                           |
| macOS architecture or signing is wrong for the bundled sidecar.             | Build/package matching architectures on native runners, inspect bundle contents, and test signed/notarized packages before release.                                                                                                                                |
| Windows antivirus flags or quarantines the sidecar.                         | Sign final artifacts, avoid shell spawning and self-modifying behavior, preserve stderr diagnostics, and test the packaged candidate on a real Windows installation.                                                                                               |
| Wayland limits programmatic window operations.                              | Keep one ordinary user-controlled window, test native Wayland and XWayland, and add no window-position-dependent UX without a proven requirement.                                                                                                                  |
| Electron increases bundle size or memory beyond an acceptable level.        | Compare like-for-like packages and representative working sets against the existing bundled CEF runtime during the Phase 9 release-support gate; do not turn one noisy Linux sample into a premature threshold.                                                    |
| Electron/Chromium security maintenance becomes neglected.                   | Document an explicit dependency-update cadence and make dependency/version reporting part of release readiness.                                                                                                                                                    |

## Definition of Done

- [ ] Electron owns the only visible top-level application window.
- [ ] The Svelte/WebGL frontend and Rust-owned behavior retain functional parity.
- [ ] Physical dropdowns, context menus, and DevTools work in the available Linux environment.
- [ ] All host traffic crosses one typed, isolated frontend boundary.
- [ ] Binary assets remain binary and pass byte-parity tests.
- [ ] Host errors, incompatibility, crashes, and shutdown are explicit and tested.
- [ ] Tauri, CEF, `src-tauri`, and migration-only dual-shell code are removed from production.
- [ ] Browser harnesses remain independent and representative renderer checks pass.
- [ ] Linux x86-64, Windows x86-64, macOS x86-64, and macOS arm64 build/package/protocol gates pass
      in hosted CI.
- [ ] Real packaged applications are manually certified on Linux, Windows, and macOS before those
      platforms are advertised as supported.
- [ ] Windows signing and macOS signing/notarization are complete for public release candidates.
- [ ] Formatting, checks, lint, Clippy with warnings denied, unit/integration tests, runtime
      verification, and package inspection pass.
- [ ] Documentation describes development, content discovery, packaging, platform support status,
      and sidecar diagnostics without stale Tauri terminology.

## Open Questions

These questions do not block the Linux vertical slice. They must be resolved before their named
release phase.

1. Which public distribution formats are required: portable archives only, or also a Windows
   installer, macOS disk image, and Linux deb/rpm/AppImage? Resolve during Phase 9.
2. Is Windows arm64 a supported target? It is not in the current Rust release matrix and is excluded
   from this plan until a named user/device requirement exists.
3. Will macOS ship separate x86-64/arm64 applications or one universal application? Decide from CI
   artifact size, signing complexity, and actual target hardware before certification.
4. Who owns Windows and Apple signing identities and secrets? Unsigned internal artifacts can prove
   packaging, but cannot satisfy the public-release gate.
5. Which real or hosted systems will provide the eventual Windows and macOS manual certification?
   Until identified, support remains explicitly pending even if CI is green.
