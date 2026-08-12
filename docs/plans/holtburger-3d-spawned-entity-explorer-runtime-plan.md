# Holtburger 3D Spawned Entity and Explorer Runtime Plan

Status: Queued — prerequisites complete; host-physics reconciliation recorded
Created: 2026-07-31
Rewritten: 2026-08-01 from the convergence world/feed audit
Refined: 2026-08-01 after recovery-scope review
Reconciled: 2026-08-12 after the placement-aware host physical-camera cutover
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`
Prerequisites:

- `docs/plans/holtburger-3d-static-authored-animation-runtime-plan.md`
- `docs/plans/holtburger-3d-static-authored-effects-runtime-plan.md`
- `docs/plans/holtburger-3d-dynamic-entity-architecture-convergence-plan.md`
- `docs/plans/holtburger-3d-host-physics-recovery-plan.md`

## Provenance and Execution Status

| Concern                                   | Status                                                            | Treatment                                                        |
| ----------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| Canonical frontend dynamic foundation     | Complete on `3d-next` at `c09eb3c2`, then extended by convergence | Preserve and extend                                              |
| Claude one-feed/two-drivers topology      | Donor-proven at `c938a438`                                        | Preserve one world/event contract, not donor machinery           |
| World/entity/spatial/attachment semantics | Audited on `3d-next` on 2026-08-01                                | Extend existing `WorldState`; do not duplicate                   |
| Current `ClientViewEvent` recovery        | Initial entity snapshot is incomplete                             | Extend `InitialViewState`; retain the existing ordered broadcast |
| Static collision, body response, and placed-motion paths | Implemented in `holtburger-world`                    | Reuse only for concrete spawned physical prediction scenarios   |
| Explorer physical camera host             | Implemented app-locally; maintainer acceptance pending            | Do not generalize camera session or controls into spawned feed   |
| Spawned runtime implementation            | Not started                                                       | Execute the phases below in order                                |

The previous sequence was unexecuted and is superseded by this refinement. The audit finding remains
valid: the current initial-state request cannot reconstruct spawned entity presentation. The selected
remedy is deliberately smaller because this project owns both ends of `ClientViewEvent`, Tokio
broadcast reports receiver lag, and frequent server GUID reuse is not an observed requirement.

## Context and Boundaries

### Goal

Add spawned entity lifecycle, lossless appearance, behavior, motion, attachment, and smooth sparse
placement by driving one authoritative Rust world runtime from explorer scenarios or a future network
client and consuming the existing `ClientViewEvent` path with a complete resnapshot capability.

### Audited Starting Point

`holtburger-world::WorldState` already owns entity identity, accepted position sequencing, continuous
versus forced correction events, typed attachments with late resolution, semantic motion commands,
server-position anchors, runtime spatial bodies, and server-to-local time synchronization.

The missing pieces are narrower than the earlier plan claimed:

- `Entity` discards the lossless `ModelData` appearance payload.
- `RequestInitialViewState` snapshots fellowship, vendor, trade, and runtime bodies but not complete
  entities or appearance.
- `ClientViewEvent` uses a bounded ordered Tokio broadcast. A lagging Rust receiver is notified, but
  it currently has no complete entity snapshot to request in response.
- Reduced `MotionKinematics` resolves velocity/omega profiles but omits animation selections, ranges,
  rates, links, and modifiers.
- The Tauri host exposes content exploration plus an app-local physical-camera driver backed by a
  3x3 collision-residency ring. It still has no spawned world driver or entity relay.
- The frontend has no complete entity mirror, presentation-placement owner, runtime attachment
  consumer, or motion-plan consumer.

Static scene-interest commit bundles remain correct for authored companion publication. They are not
a spawned mutation bus and must not be stretched into one.

### In Scope

- Lossless, semantic world-owned appearance and explicit focused versus complete replacement.
- Explicit explorer domain mutations over the same `WorldState` invariants used by a future client.
- One complete entity/body/attachment/motion snapshot added to the existing initial-view-state path.
- Subscribe-before-request startup and stop-then-resnapshot recovery after Tokio `Lagged`.
- One narrow app-local Tauri serializer/relay and explorer scenario driver.
- Verification of Tauri listener ordering and delivery before adding transport sequencing.
- Spawn, despawn, focused appearance mutation, complete replacement, attachment, semantic motion,
  sparse correction, teleport, reset, pause, resume, and deterministic step scenarios.
- Shared frontend template, animation, script, effect, renderer, and resource-lifetime systems.
- Host-resolved motion selection and frontend smooth presentation between sparse authoritative samples.
- Reuse of the landed typed collision coverage, static-query, bounded body-response, and
  camera-agnostic placed-motion contracts only when a named spawned scenario requires host-local
  physical prediction. A solved entity path preserves accepted response bends and host-owned portal
  placement; it does not inherit the Explorer camera session or transport.
- Animated parent-part attachment following with ancestor-derived authoritative residency.
- `PhysicsScriptTable` decode, transport, and intensity selection — inherited from the effects
  plan by its 2026-08-06 scope ratification. Retail proved the mechanism is exclusively
  gameplay-driven (network `play_script`, collisions, hide/unhide), so its first honest consumer
  is the spawned/network event path. The effects plan's Retail Execution Evidence records the
  table census (six shipped tables, single referencing setups, `0x340000BA` as the smallest
  modifier-selection fixture) and the proven ceiling-match selection rule; ACE/ACViewer
  `GetScript` are stubs and must not be used as references.
- Despawn policy for live particle effects — a deliberate choice this plan makes when wiring the
  spawned lifecycle to the effects runtime's emitter teardown. Retail vanishes an owner's live
  particles instantly on destruction (`CPhysicsObj::Destroy` → per-emitter `Destroy`), and
  servers author around it by delaying removal; the effects runtime's stopped-state machinery
  also supports drain-then-reap (halt emission, let live particles finish, self-reap), so
  letting a despawned projectile's burst complete is a one-line policy option here. Decide
  against concrete scenarios, not in advance.

### Out of Scope

- Login, sockets, protocol sequencing, reconnect/resume, or complete network message handling.
- Manufacturing protocol packets for explorer scenarios.
- A Tauri-local authoritative entity store or TypeScript-authored world truth.
- A universal explorer/client runtime superclass.
- A stateful `WorldViewProjector`, feed epoch, or global entity-delta sequence without measured need.
- A permanent world generation tombstone store without evidence of harmful GUID reuse.
- Wholesale replacement of `ClientViewEvent` entity/runtime-body variants.
- Gameplay simulation, AI, combat, rollback, or a general physics feature set.
- Per-render-frame host transform streaming.
- Frontend motion-table decoding or semantic motion selection.
- A second template cache, animation system, effect dispatcher, placement authority, or entity feed.
- Reusing the Explorer physical-camera session, app-owned camera body dimensions, input mapping, or
  fixed-tick camera transport as a spawned-entity runtime.
- Compatibility shims for the superseded spawned commit-bundle proposal.

## Ground Truth and Existing Precedent

### Authoritative References

- `acclient-eor-source/acclient.c`
  - `CSequence::update_internal` and `apply_physics`: animation position frames and motion-data
    velocity/omega contribute to sequence offsets.
  - `CPhysicsObj::UpdatePositionInternal`: moving objects advance sequences with an offset consumed by
    placement/physics processing.
  - `CPartArray::SetPlacementFrame`: placement pose selection and fallback.
  - `CPartArray::DoObjDescChanges` and `DoObjDescChangesFromDefault`: focused appearance mutation.
  - `CObjectMaint::SetVisualDesc` and `ACCObjectMaint::SetVisualDesc`: sequence-gated visual changes
    preserve object identity.
  - Complete `UpdateObject` handling: replacement recreates entity presentation.
- `ACE/Source/ACE.DatLoader/FileTypes/MotionTable.cs`: styles, cycles, modifiers, links, animation
  ranges/rates, velocity, and omega.
- `ACE/Source/ACE.Server/WorldObjects/Creature_Equipment.cs`: equipment uses focused object-description
  changes.
- `ACE/Source/ACE.Server/WorldObjects/Hook.cs`: setup, motion, physics, sound, and scale changes use
  complete replacement and reversal.

### Existing Code to Extend

- `crates/holtburger-world/src/entity.rs`
- `crates/holtburger-world/src/attachment.rs`
- `crates/holtburger-world/src/state/mutations.rs`
- `crates/holtburger-world/src/state/motion_resolution.rs`
- `crates/holtburger-world/src/spatial/`
- `crates/holtburger-world/src/spatial/collision.rs`
- `crates/holtburger-world/src/spatial/grounded.rs`
- `crates/holtburger-world/src/spatial/physical_fly.rs`
- `crates/holtburger-core/src/client/runtime.rs`
- `crates/holtburger-core/src/client/runtime_body_view_cache.rs`
- `crates/holtburger-core/src/client/types.rs`
- `crates/holtburger-content/src/`
- `apps/holtburger-3d/src-tauri/src/lib.rs`
- `apps/holtburger-3d/src-tauri/src/host_camera_runtime.rs`
- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
- `apps/holtburger-3d/src/lib/game/systems/dynamic-entity-system.ts`
- `apps/holtburger-3d/src/lib/game/systems/animation-system.ts`
- `apps/holtburger-3d/src/lib/game/systems/effect-system.ts`

## Final Ownership Model

| Fact                                               | Authoritative owner                              | First consumer in this plan                                   |
| -------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| Entity identity and lifecycle operation            | `holtburger-world`                               | Existing `ClientViewEvent` projection                         |
| Semantic appearance                                | `holtburger-world`                               | Complete snapshot and visual-template staging                 |
| Attachment and inherited residency                 | `holtburger-world`                               | Complete snapshot/deltas, then frontend attachment projection |
| Accepted body placement and correction kind        | `holtburger-world`                               | Sparse placement projection                                   |
| Collision-accepted geometry and portal placement   | `holtburger-world` placed-motion path            | First concrete host-local physical prediction scenario         |
| Semantic motion state and resolved selection       | `holtburger-world` using a content-built catalog | Spatial projection and frontend motion-plan playback          |
| Complete initial entity snapshot                   | `holtburger-core` view contract                  | Existing client and Tauri consumers                           |
| Broadcast lag detection                            | Each Rust `ClientViewEvent` receiver             | Stop forwarding and request a fresh snapshot                  |
| Explorer scenarios and deterministic controls      | App-local Rust driver                            | Shared world mutation APIs                                    |
| Tauri serialization, listener handshake, and relay | App-local Tauri adapter                          | Frontend entity mirror                                        |
| Async presentation freshness                       | Existing frontend owner/staging generations      | Template, animation, and behavior activation                  |
| Render-time position along a host-placed path       | Frontend `PlacementSystem`                       | Scene projection and renderer submission                      |
| Final scene-node transform                         | Frontend presentation projection                 | Renderer-facing dynamic nodes                                 |
| WebGL batching                                     | Renderer                                         | Dynamic draw submission                                       |

World revisions or transport sequence fields land only with a concrete producer and consumer that can
demonstrate out-of-order or undetectable loss. They are not an eager correctness bundle.

### 2026-08-01 Recovery-Scope Correction

- The original audit correctly found that the current initial-state request cannot reconstruct entity
  presentation after loss. It did not prove that `ClientViewEvent` itself must be replaced.
- The project owns `ClientRuntime`, every consumer, and the Tauri adapter. Expanding one
  `InitialWorldStateSnapshot` event is cheaper and more maintainable than introducing a stateful
  projector protocol.
- Tokio broadcast preserves received order and returns `Lagged` when it overwrites unread events.
  Recovery therefore needs a complete snapshot and a receiver state transition, not mandatory epoch
  and sequence metadata.
- Startup registers the receiver before requesting the snapshot. `ClientRuntime` serializes commands
  and world mutations, so the single snapshot event is a stable replacement boundary: earlier entity
  deltas are superseded and later deltas apply in order.
- Server GUID reuse is infrequent, while `DynamicEntitySystem` already retains per-owner generations
  across removal. That existing frontend lifecycle guard rejects stale asynchronous preparation after
  despawn, respawn, or complete replacement; a world generation tombstone store does not yet earn its
  keep.
- Tauri is the only unproven delivery boundary. Phase 1 measures its listener-registration and relay
  behavior. If it permits undetectable loss while a listener is alive, stop for review and add the
  minimum proven sequencing contract there rather than prepaying for epochs everywhere.

## Target Runtime Shape

```text
explorer scenario commands ----\
                                -> one holtburger-world WorldState
future network client events --/      |- identity + lifecycle
                                       |- semantic appearance + attachment
                                       |- authoritative body + residency
                                       `- semantic motion state
                                                    |
                         holtburger-core ClientViewEvent projection
                         complete snapshot + existing ordered deltas
                                                    |
                                  narrow app-local Tauri relay
                                                    |
                               frontend current-entity mirror
                                                    |
                    template / animation / script / effect staging
                                                    |
                       smooth PresentationPlacement + scene projection
                                                    |
                                     shared object renderer
```

The future network driver is not another runtime. It mutates the same world invariants and uses the
same view contract. Session transport and reconnection stay in client composition; explorer scenarios
and deterministic controls stay in app composition.

## Feed and Lifecycle Contracts

### Startup and Resnapshot

The complete snapshot is one `ClientViewEvent` value containing one host-timeline sample and every
frontend-relevant projected entity. Each entity joins identity, semantic appearance, attachment,
current authoritative/runtime body facts, and semantic motion. It references shared immutable content
by identity rather than embedding assets.

Startup and recovery use the same state machine:

1. register the Rust receiver and frontend listener;
2. enter `awaiting-snapshot` and request initial view state;
3. ignore entity/body/motion deltas until the complete snapshot arrives;
4. atomically reconcile the snapshot; and
5. apply later `ClientViewEvent` deltas in received order.

If the Rust receiver returns `Lagged`, it stops forwarding entity deltas, re-enters
`awaiting-snapshot`, and requests another snapshot. The last complete presentation may remain visible
as stale, but receives no new behavior, motion, attachment, or placement input until reconciliation.
Unrelated chat/status UI events need not be folded into the entity mirror.

The plan does not require duplicate suppression because current producers do not retry view events.
Snapshot reconciliation is idempotent by complete owner identity. If Tauri testing discovers a real
duplicate or undetectable-loss mode, Phase 1 records the evidence and adds only the metadata needed for
that mode.

### Entity Mutation and Async Freshness

Focused appearance mutation and complete replacement remain distinct world operations. Focused
mutation updates semantic appearance, stages newly referenced resources under a frontend-local visual
installation token, and atomically swaps the visual while preserving attachment, placement, and
compatible behavior. Complete replacement invokes full retirement and a fresh entity installation.

`DynamicEntitySystem` already increments and retains owner generations. Despawn, same-GUID respawn,
and complete replacement therefore invalidate old template/animation preparation without a host
generation field. Any later host-side asynchronous operation must introduce its own scoped freshness
token with its first consumer; it may not justify a global generation preemptively.

### Placement and Time

`WorldBodyPlacement` is the sparse host sample: complete world pose, authoritative residency,
attachment relationship when present, correction kind, and sample time. The exact Rust shape lands
with its incremental event and frontend consumer.

`PresentationPlacement` is the frontend-derived current result. It combines the newest accepted host
sample with active resolved motion and correction policy at absolute mapped host time. It is never fed
back as world truth. Only `PlacementSystem` writes it, and only scene projection applies it to the root
node. Animation continues to sample rigid-part transforms smoothly at render cadence.

The snapshot and motion/placement events provide one versioned mapping from host monotonic time to the
frontend clock. Pause and deterministic step change scenario time through explicit timeline updates;
delivery latency and asset readiness never shift a plan's semantic start time.

### Motion

The host consumes a content-built `MotionCatalog` and resolves semantic entity motion into a small,
entity-specific `ResolvedMotionPlan`. A plan selects ordered animation ranges/rates and matching
kinematics from the same authored motion records. The frontend loads referenced animations through the
existing repository and begins at the absolute plan cursor after dependencies are ready.

Animation position-frame contribution is an evidence gate, not permission to apply movement twice.
Before the resolver lands, retail and ACE evidence must establish how position frames compose with
motion-data velocity/omega. The selected composition is computed once in the host plan/spatial path;
the frontend receives only the presentation facts required to predict the same trajectory.

## Phased Implementation

### Phase 1: Land a Recoverable Spawn/Despawn Vertical Slice

#### Deliverables

- Add a lossless world semantic appearance composite retaining setup, ordered palette/subpalette,
  texture, and model substitutions plus existing scale/translucency/default behavior references.
- Add a complete projected entity composite joining appearance, attachment, current runtime-body
  truth, and semantic motion without embedding asset payloads.
- Add one `InitialWorldStateSnapshot` variant to `ClientViewEvent` and emit it from
  `RequestInitialViewState`; retain focused incremental entity/runtime-body events.
- Teach the existing runtime-body read cache to consume the body portion of the complete snapshot;
  do not turn it into a duplicate entity store.
- Implement subscribe-before-request startup and `Lagged`-to-resnapshot receiver behavior.
- Add an app-local explorer driver with injected world mutation, content, clock, and view-projection
  dependencies; it owns scenario policy but no entity truth.
- Add typed scenario commands for reset, spawn, despawn, and complete replacement.
- Extract stateless world snapshot/event projection helpers into `holtburger-core` only when the
  explorer becomes their second concrete consumer.
- Select and test the narrow Tauri relay primitive, registering the frontend listener before starting
  delivery and requesting the initial snapshot.
- Make the Rust relay handle broadcast `Lagged` by pausing entity delivery and requesting/resending a
  complete snapshot.
- Add the frontend current-entity mirror and feed it into `GameRuntime` through a public dynamic-source
  boundary.
- Extract the facts currently trapped in `AuthoredDynamicSource` into one shared dynamic presentation
  source consumed by `DynamicEntitySystem`; authored and spawned adapters compute it at their own
  boundaries.
- Stage projected visual identity through the existing content-addressed visual-template repository,
  then atomically publish through `DynamicEntitySystem`.

#### Acceptance Criteria

- One snapshot reconstructs every projected entity without replay history.
- A mutation serialized before the snapshot is represented by the snapshot; one serialized after it
  arrives as a later delta.
- Entity deltas received while awaiting a snapshot are ignored rather than partially applied.
- Forced Tokio receiver lag triggers one resnapshot and produces state identical to a fresh snapshot.
- Existing TUI/client consumers retain unrelated `ClientViewEvent` behavior.
- A Rust scenario spawns repeated setup-backed entities across the real Tauri boundary and despawns
  them with no leaked template, geometry, atlas, node, or pending-stage ownership.
- Repeated identities share immutable templates while retaining independent mutable entity state.
- Listener registration, initial snapshot, forced Rust relay lag, and webview reload each converge to
  the current world without a parallel entity store.
- Despawn, same-GUID respawn, or replacement at every asynchronous staging boundary cannot publish
  stale work.
- No motion table, attachment, or per-frame host transform is required for this slice.
- If Tauri can lose a live-listener event without detection, implementation stops for user review
  before adding a minimal transport sequence.
- No feed epoch, global entity sequence, world generation store, or stateful projector is introduced.
- Every snapshot field has a world producer and a same-phase frontend consumer.

#### Decisions and Course Corrections

- Populate during execution.

### Phase 2: Replace Reduced Motion Resolution With One Proven Catalog

#### Deliverables

- Prove retail transition, interruption, reversal, speed scaling, finite-link/cycle, and animation
  position-frame composition from retail/ACE before fixing the final resolver contract.
- Build a process-pinned `MotionCatalog` in `holtburger-content` containing the lossless authored facts
  needed by the proven rules; `holtburger-world` consumes parsed data, never DAT paths.
- Add a pure world-owned motion resolver from catalog, semantic entity motion, prior selection, and
  host time to one `ResolvedMotionPlan`.
- Replace reduced `MotionKinematics` as the authoritative selection source and make spatial-body
  kinematics consume the active phase from the same resolution result.
- Retain a reduced diagnostic view only if it has a distinct named diagnostic consumer.

#### Acceptance Criteria

- Animation selection and body kinematics originate from the same resolved authored records.
- Styles, cycles, modifiers, links, ranges, rates, interruption, and reversal have reference-backed
  tests with reachable failure messages.
- Root contribution is applied once; a test distinguishes it from velocity/omega-only movement.
- Catalog/resolver code has no Tauri, frontend, or session dependency.
- Non-motion-table direct playback does not allocate placeholder graph state.

#### Decisions and Course Corrections

- Stop this phase for user review if retail evidence leaves root/velocity composition ambiguous.

### Phase 3: Feed and Execute Resolved Motion Plans

#### Deliverables

- Add explorer commands for semantic motion, direct playback, pause, resume, deterministic step, and
  timeline reset.
- Project resolved plans through focused ordered `ClientViewEvent` deltas with absolute effective time.
- Add a frontend motion-plan consumer that stages referenced prepared animations, installs a complete
  plan under an entity-local installation token, and drives the existing `AnimationSystem`.
- Start late-ready plans at the correct absolute semantic cursor and apply the already-proven departed-
  frame hook catch-up policy without moving plan time to I/O completion.
- Preserve smooth rigid-part sampling between semantic frames; plan updates do not create a second
  pose or hook traversal path.

#### Acceptance Criteria

- One host plan drives many frontend frames without further host messages.
- Pause/step tests use an injected clock and never sleep.
- Superseded plan preparation cannot affect the current entity installation.
- Large and small accepted time advances emit equivalent ordered behavior events.
- Missing animation dependencies fail explicitly and never substitute unrelated playback.

#### Decisions and Course Corrections

- Populate during execution.

### Phase 4: Add Sparse Presentation Placement and Corrections

#### Deliverables

- Project `WorldBodyPlacement` only when accepted world-body state changes or a timeline reset requires
  a new anchor; include continuous versus discontinuous correction semantics from existing world
  outcomes.
- Add frontend `PlacementSystem` as the sole owner of `PresentationPlacement` and root-node writes.
- Predict from absolute anchor/plan time, apply named decaying continuous correction, and snap on
  complete replacement, forced reposition, teleport, incompatible residency, or timeline reset.
- For a named host-local physical prediction scenario, serialize the existing world-owned
  `PlacedMotionPath` with its accepted geometry. Evaluate its supplied placement-stable legs at
  render cadence; do not restore frontend actor portal traversal or infer residency from endpoints.
- Keep sparse server-authoritative placement as an explicit anchor until the Phase 4 retail/network
  evidence names the host-side geometry that can safely become a placed path. Missing topology
  holds the last proven placement and never falls back to frontend containment.
- Keep server-authoritative pose available only as diagnostics if a real diagnostic view consumes it.

#### Acceptance Criteria

- Motion remains smooth at render cadence without per-frame host transforms or accumulated delta-time
  drift.
- An ordinary correction converges continuously; a forced correction snaps on the first eligible
  presentation sample.
- One placed path can cross multiple portals, and unavailable topology never guesses residency.
- Animation, effects, and renderer code do not write root placement independently.
- Clear, complete replacement, and resnapshot remove all prediction/correction state.

#### Decisions and Course Corrections

- Populate during execution.

### Phase 5: Add Focused Mutation, Attachments, and Behavior Commands

#### Deliverables

- Add the first real focused appearance command, staging dependencies under a frontend-local visual
  token before atomic activation while preserving compatible playback and effects.
- Add attach/detach world operations and project attachment only now that a scenario and frontend
  consumer exist.
- Derive attached descendant residency from the resolved ancestor in world-owned projection logic.
- Add frontend scene attachment to the parent's current animated part transform before visibility and
  render submission; attachment never creates a second world-placement authority.
- Add direct behavior/script/effect commands through the shared typed behavior seam delivered by the
  authored-effects plan.
- Exercise complete replacement as full retirement across templates, playback, effects, scripts,
  queued behavior events, placement, attachments, and pending work.

#### Acceptance Criteria

- Focused mutation preserves identity, attachment, placement, and compatible behavior while swapping
  the visual only after all dependencies are ready.
- Attach-before-parent, parent replacement, detach, reattach, and ancestor despawn have deterministic
  world and frontend results.
- An attached child follows the selected animated parent part and inherits ancestor residency.
- Complete replacement cannot retain any old mutable subsystem, queued event, or resource lease.
- The app adapter contains no attachment resolution or appearance heuristics.

#### Decisions and Course Corrections

- Populate during execution.

### Phase 6: Prove Driver Sharing and Runtime Scale

#### Deliverables

- Exercise repeated creatures, motion transitions, focused replacement, complete replacement,
  attachments, corrections, teleports, receiver lag/resnapshot, listener restart, late assets, and
  deterministic stepping through host-backed scenarios.
- Add a test network-driver adapter that applies representative decoded-domain operations to the same
  world APIs without sockets or session policy.
- Measure snapshot/delta bytes, immutable asset bytes, resolver work, frontend staging, motion,
  presentation placement, portal traversal, effects, uploads, and draws as distinct scenarios justify.
- Document the future protocol mapping for spawn, focused object description, complete update,
  movement, and server time.
- Identify the first concrete explorer physics demonstration and write a separate plan only if it is
  now justified by the landed seam.

#### Acceptance Criteria

- Explorer and representative client drivers produce equivalent view results for equivalent domain
  operations.
- Host traffic scales with semantic mutations and sparse anchors, not clocks, render frames, or
  frontend portal crossings.
- No generic runtime superclass, session-shaped shared contract, or unmeasured feed metadata is
  introduced.
- Every retained metric differs from another metric in a named scenario.
- Future physics can extend world mutation/projection without replacing initial-state recovery, time,
  or presentation contracts.

#### Decisions and Course Corrections

- Populate during execution.

### Phase 7: Clean Cutover and Architecture Audit

#### Deliverables

- Delete the runtime-body-only initial snapshot/cache, spawned commit seams, reduced authoritative
  motion vocabulary, duplicate projections, and obsolete names once their replacements are consumed.
- Retain focused incremental `ClientViewEvent` variants and small test fakes where they exercise the
  production contracts.
- Update world, core, Tauri, and frontend architecture documentation plus explorer diagnostics.
- Run repository-wide vocabulary, dead-export, format, lint, test, Rust, and representative browser
  gates.

#### Acceptance Criteria

- Every production scenario traverses app driver, shared world mutation, existing view-event contract,
  narrow Tauri relay, frontend mirror, and the existing dynamic presentation runtime.
- No frontend code parses motion tables, reconstructs appearance heuristically, or claims authoritative
  placement/residency.
- No app-local entity authority, parallel feed, pose system, or generic runtime hierarchy remains.
- No epoch, global entity sequence, world generation tombstone, or stateful projector exists without
  Phase 1 evidence and recorded review.
- Formatting, TypeScript/Svelte checking, ESLint, Knip, frontend tests, Rust tests, Cargo check,
  Rustfmt, and Clippy with warnings denied all pass.
- Host-backed browser scenarios report correct lifecycle counts and no browser errors.

#### Decisions and Course Corrections

- Populate during execution.

## Verification Matrix

| Scenario                  | Required proof                                                          |
| ------------------------- | ----------------------------------------------------------------------- |
| Subscribe before snapshot | Earlier deltas are superseded; mutation after snapshot applies normally |
| Receiver lag              | Entity forwarding pauses; resnapshot equals a fresh projection          |
| Webview/listener restart  | Listener registers first and one snapshot reconstructs current state    |
| Same-identity respawn     | Existing frontend owner generation rejects old preparation              |
| Shared visual identity    | One template resource set, independent mutable entity state             |
| Focused appearance        | Identity/attachment preserved; token-gated atomic visual swap           |
| Complete replacement      | Every old mutable system and lease retires                              |
| Late animation readiness  | Absolute plan cursor and ordered hook catch-up remain intact            |
| Continuous correction     | Smooth convergence from one sparse anchor without drift                 |
| Forced reposition         | Immediate snap and prediction reset                                     |
| Multi-cell motion         | Directed portal chain traversed; ambiguity retains proven residency     |
| Animated attachment       | Child follows current parent-part transform and ancestor residency      |
| Driver parity             | Explorer and client adapter yield equivalent view state                 |

No checked-in test may depend on runtime archives absent from the repository. Archive-backed evidence
belongs in temporary diagnostics or the browser harness and is recorded before those diagnostics are
removed.

## Risks and Mitigations

### Initial State Is Still Partial

Define one complete entity composite and prove that a fresh mirror equals the mirror reconstructed
after forced lag. Runtime-body-only reset behavior is insufficient.

### Snapshot Request Races With Deltas

Subscribe first, ignore entity deltas while awaiting the single snapshot event, and rely on the
serialized runtime command/mutation boundary. The snapshot supersedes earlier deltas; later deltas
remain ordered behind it.

### Tauri Hides Loss From the Rust Receiver

Test listener registration, sustained delivery, and webview reload across the real boundary in Phase

1. If loss while a live listener is genuinely undetectable, stop and review the smallest sequence or
   acknowledgement contract justified by that evidence.

### Rare GUID Reuse Admits Stale Frontend Work

Use the existing retained owner generation in `DynamicEntitySystem` for despawn, respawn, and complete
replacement. Add host generation only if concrete asynchronous host work cannot use a narrower token.

### Host and Frontend Both Apply Motion

Prove retail root/velocity composition first, then compute the selected rule once in the host
resolution/spatial path. The frontend predicts the same presentation trajectory but never feeds it
back or independently chooses semantics.

### Smooth Animation Is Lost During Authority Cleanup

Keep semantic frame/hook traversal discrete and retain current render-cadence rigid-part interpolation.
Placement adds a smooth root transform; it does not replace animation sampling.

### Focused Mutation Accidentally Behaves Like Replacement

Use separate world operations and frontend installation paths. Focused mutation stages and swaps one
visual composite; complete replacement invokes full retirement.

### Attachments Create Parallel Residency

Derive authoritative descendant residency once in world-owned projection logic. Frontend parenting
consumes that fact and applies the animated relative transform without authoring another residency.

### Explorer Policy Leaks Into Shared Crates

Keep scenario names, control UX, pause buttons, and deterministic demonstrations app-local. Shared
crates expose domain mutations, snapshot/event projection, and reusable clock mechanics only after two
concrete consumers prove the seam.

## Definition of Done

- [ ] World state retains lossless semantic appearance and explicit replacement semantics.
- [ ] `RequestInitialViewState` emits one complete projected entity snapshot.
- [ ] Subscribe-before-request and Tokio `Lagged` resnapshot behavior are tested and reconstructable.
- [ ] Existing focused `ClientViewEvent` deltas remain the sole incremental event grammar.
- [ ] Explorer and representative network-client drivers use the same world mutations and view types.
- [ ] Spawned entities cross Tauri into the existing template, animation, effect, and renderer systems.
- [ ] Tauri delivery is measured before any sequence or acknowledgement metadata is introduced.
- [ ] Existing frontend owner generations reject stale same-GUID and replacement preparation.
- [ ] Motion selection resolves once in Rust from a content-built catalog.
- [ ] Frontend animation and placement remain smooth without raw motion tables or per-frame host input.
- [ ] Root contribution is proven and applied exactly once.
- [ ] Focused mutation preserves identity; complete replacement retires all old mutable state.
- [ ] Attachments remain world-owned and follow animated parent parts in presentation.
- [ ] Receiver lag, listener restart, timeline reset, and late assets have explicit tests.
- [ ] No unproven epoch, global sequence, world generation store, or stateful projector lands.
- [ ] No duplicate entity feed, placement authority, pose system, or motion-selection path survives.
- [ ] Architecture documents and diagnostics match the landed ownership model.
- [ ] All repository verification and representative host/browser gates pass.

## Evidence Gates Requiring Resolution During Execution

1. Prove the exact retail composition of animation position frames with motion-data velocity/omega
   before Phase 2 fixes `ResolvedMotionPlan` and spatial integration.
2. Prove the sequence gate and retained state for focused `ObjDescEvent` changes before Phase 5 fixes
   the final focused-mutation contract.
3. Select and test the concrete Tauri relay in Phase 1. Add sequencing only if a live-listener loss
   mode cannot be detected by the Rust receiver or lifecycle handshake.
4. Prove whether dense-cell residency uses origin or collision extent before Phase 4 finalizes moving
   portal traversal.

These gates may narrow a phase. They do not authorize a second runtime or an implicit fallback. Stop
for user review if authoritative references remain ambiguous.
