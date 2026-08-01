# Holtburger 3D Spawned Entity and Explorer Runtime Plan

Status: Sequenced after static-authored animation and effects fidelity
Created: 2026-07-31
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`
Prerequisites:

- `docs/plans/holtburger-3d-static-authored-animation-runtime-plan.md`
- `docs/plans/holtburger-3d-static-authored-effects-runtime-plan.md`

## Context and Boundaries

### Goal

Add a durable Rust `ExplorerRuntime` that mutates shared authoritative world state and projects
spawned entity lifecycle, appearance, behavior, motion, and sparse placement through a recoverable
Tauri feed into the existing frontend dynamic presentation runtime.

### Problem Statement

After authored animation and effects land, the frontend will have proven shared visual templates,
rigid-part animation, scripts, hooks, effects, pose composition, resource lifetime, and instanced
rendering. Spawned entities add a different class of problems: authoritative identity and generation,
mutable appearance, attachments, server-style sequencing, semantic motion-table state, clock-domain
mapping, sparse correction, and transport continuity.

Those concerns should not block authored fidelity, but they need a real producer when implemented.
A TypeScript-local synthetic feed would prove only frontend consumption while Rust world state,
motion resolution, serialization, clocks, and snapshot/delta handoff remain disconnected.
`ExplorerRuntime` becomes the first production-shaped producer and a durable explorer growth seam for
later physics demonstrations.

### In Scope

- App-local Rust `ExplorerRuntime` orchestration in `apps/holtburger-3d/src-tauri`.
- One `holtburger-world` state instance with explicit domain mutation APIs for explorer scenarios.
- Lossless world-owned visual selection, entity generations, placement, attachment, and semantic
  motion state.
- Host-side resolved appearance/template identity; no frontend WCID heuristics.
- Snapshot plus sequenced delta projection across the real Tauri boundary.
- Spawn, despawn, focused appearance replacement, complete generation replacement, scale,
  attach/detach, direct playback, script activation, teleport/rebase, and reset.
- A complete shared `MotionCatalog` and pure `MotionResolver` producing time-anchored
  `ResolvedMotionPlan` values.
- Deterministic explorer time with pause, resume, and step.
- Frontend motion-plan execution, animation/root sampling, sparse placement anchors, continuous
  correction, discontinuous snap, and motion-derived outdoor/environment-cell residency.
- Reuse of authored template, animation, script, hook, particle, audio, pose, and renderer systems.
- Diagnostics and host-backed scenarios that prove repeated dynamic entities share immutable assets
  while retaining independent mutable state.
- A clean future mapping from networked `ClientRuntime` world state into the same app-local
  presentation projection adapter.

### Out of Scope

- Login, sockets, session ownership, protocol dispatch, reconnect/resume, or complete server message
  handling.
- Manufacturing protocol messages to drive explorer scenarios.
- A second app-local authoritative entity store or Tauri-only appearance truth.
- A universal base runtime inherited by `ExplorerRuntime` and `ClientRuntime`.
- Authoritative gameplay simulation, AI, combat, rollback, or server emulation.
- Full collision/physics demonstrations. `ExplorerRuntime` is intentionally extensible toward them,
  but they require a later concrete scenario and plan.
- Per-render-frame host transform streaming.
- Frontend motion-table parsing or motion selection.
- Compatibility shims for obsolete spawned commit-pipeline or feed shapes.

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
    preserve entity identity.
  - complete `UpdateObject` handling: object replacement recreates entity presentation.
- `ACE/Source/ACE.DatLoader/FileTypes/MotionTable.cs`: styles, cycles, modifiers, links, animation
  ranges/rates, velocity, and omega.
- `ACE/Source/ACE.Server/WorldObjects/Creature_Equipment.cs`: equipment uses focused `ObjDescEvent`.
- `ACE/Source/ACE.Server/WorldObjects/Hook.cs`: setup/motion/physics/sound/scale changes use complete
  update and reversal.

### Existing Code to Extend

- The completed authored frontend systems from the prerequisite plans.
- `crates/holtburger-world/src/entity.rs`
- `crates/holtburger-world/src/state/motion_resolution.rs`
- `crates/holtburger-world/src/bootstrap.rs`
- `crates/holtburger-world/src/state/types.rs`
- `crates/holtburger-core/src/client/runtime.rs`
- `crates/holtburger-core/src/client/simulation.rs`
- `crates/holtburger-dat/src/file_type/motion_table.rs`
- `apps/holtburger-3d/src-tauri/src/lib.rs`
- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
- `apps/holtburger-3d/src/lib/game/scene/portal-trace.ts`

### Known Gaps

- `holtburger-world::Entity` does not yet retain a lossless canonical equivalent of wire
  `ModelData`, and no handler applies `ObjDescEvent`.
- Current world motion resolution reduces tables to velocity/omega profiles and omits animation
  selection, links, modifiers, and phase schedules.
- The Tauri host owns content commands only and has no world runtime or entity stream.
- The frontend has no runtime snapshot/delta consumer, placement anchor, motion plan, correction
  owner, or dynamic portal traversal.
- Spawned commit bundles are an unused scene-interest-shaped seam and must not become the runtime
  mutation bus.

The network handlers themselves remain out of scope. World-owned visual/motion state and explicit
domain mutations gain a real explorer consumer here; future protocol handlers map into those same
invariants later.

## North Stars

1. `ExplorerRuntime` and `ClientRuntime` are sibling composition roots over shared world/core
   mechanics, not subclasses of a universal runtime.
2. Authoritative entity, generation, appearance, placement, attachment, and motion invariants belong
   to `holtburger-world`, not Tauri or TypeScript.
3. Explorer command/scenario policy and projection transport remain app-local.
4. The host resolves motion-table semantics once; the frontend executes resolved plans and never
   consumes raw tables or keys.
5. The frontend retains one current presentation placement/residency, seeded and rebased by sparse
   host anchors.
6. Host traffic scales with semantic mutations, plans, and anchors—not host ticks, render frames, or
   frontend portal crossings.
7. Snapshot/delta synchronization is recoverable: epoch and global sequence make loss detectable.
8. Entity DTOs reference shared immutable content; they never embed animation, script, effect, or
   motion-catalog payloads.
9. Focused mutation preserves entity identity; complete replacement changes generation and tears
   down all old mutable state atomically.
10. Later explorer physics extends the authoritative world/runtime seam with a concrete consumer; it
    does not distort this plan speculatively.

## Target Runtime Shape

```text
explorer UI/scenario command
  -> ExplorerRuntime (app-local orchestration + deterministic clock)
  -> holtburger-world state/domain mutations
       |- canonical visual selection
       |- generation / placement / attachment
       `- semantic motion state
  -> MotionResolver + host presentation projector
  -> snapshot / sequenced deltas over Tauri
  -> DynamicEntityFeed
  -> existing frontend template/animation/script/effect/pose/render systems
```

Motion-table path:

```text
MotionCatalog + entity semantic motion + prior plan + host time
  -> ResolvedMotionPlan
       |- ordered finite/repeating animation selections
       `- matching velocity/omega per phase
  -> frontend MotionSystem
       |- prepared playback selection
       `- PlacementSystem absolute-time projection
```

## Host Runtime, Feed, and Clock Contracts

`ExplorerRuntime` owns a `holtburger-world` state instance, injected content/resolver/clock ports, and
an ordered projection journal. It does not own WebGL nodes, frontend asset handles, portal
presentation residency, or render cadence.

One subscription handshake atomically returns a complete snapshot, feed epoch, next global sequence,
and host timeline sample. Later envelopes carry epoch and monotonically increasing sequence. The
frontend ignores duplicates, detects gaps or epoch changes, and requests a fresh snapshot instead of
applying unknowable partial state. Per-entity generation and placement/behavior revisions remain
necessary but do not replace stream continuity.

One explicitly versioned host monotonic timeline defines plan and anchor effective times. Pause and
deterministic step advance scenario time without wall-clock sleeps. Resynchronization is a named
timeline update or fresh snapshot and cannot silently reinterpret an installed plan.

`ResolvedMotionPlan` is a small entity-specific selected schedule, not a DAT record. Each phase pairs
animation ID/range/rate steps with velocity/omega resolved from the same `MotionData` record and is
explicitly finite or repeating. The frontend loads referenced animations through its shared
repository, executes phases, samples authored root data, and composes motion only in
`PlacementSystem`.

## Phased Implementation

### Phase 1: Establish World-Owned Runtime Entity State

#### Deliverables

- Add a lossless world-owned visual-selection composite covering setup, appearance overrides, scale,
  and focused/complete replacement semantics.
- Add or refine explicit world-domain mutations for spawn, despawn, generation replacement,
  placement, attachment, visual selection, direct behavior selection, and semantic motion state.
- Separate reusable invariants currently buried in protocol handlers without changing network
  behavior.
- Delete the unused spawned landblock-commit shape.

#### Acceptance Criteria

- Explorer and client code can mutate the same world invariants without fake protocol messages.
- No Tauri-only or frontend authoritative appearance/entity representation is introduced.
- Focused visual mutation and complete generation replacement are distinct domain operations.
- World APIs have no dependency on Tauri, WebGL, or explorer UI policy.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 2: Build a Narrow `ExplorerRuntime` Lifecycle Slice

#### Deliverables

- Add app-local `ExplorerRuntime` with injected world/content/clock dependencies.
- Add typed spawn, despawn, complete replace, and reset scenario commands.
- Resolve setup/appearance into the same referential frontend entity source used by authored
  presentation.
- Add the host projection adapter, compact snapshot/delta envelope, epoch/sequence handshake,
  resnapshot path, and TypeScript decoder.
- Add `DynamicEntityFeed` consumption through `GameRuntime` without exposing system internals.

#### Acceptance Criteria

- A Rust explorer command spawns several setup-backed entities across Tauri into the existing
  frontend template/behavior/render path and despawns them without leaks.
- Spawned and authored entities share templates, animations, scripts/effects, and renderer cohorts
  where identity is compatible.
- Duplicate envelopes are harmless; a forced gap or epoch reset produces a clean resnapshot.
- No motion tables, projected movement, or per-frame host transforms are needed for this phase.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 3: Build the Shared Motion Catalog and Resolver

#### Deliverables

- Replace reduced `MotionKinematics` with a process-pinned `MotionCatalog` assembled by
  `holtburger-content` and consumed by `holtburger-world`.
- Retain setup defaults, styles, cycles, modifiers, links, animation ranges/rates, and per-record
  velocity/omega.
- Add a pure `MotionResolver` from catalog, semantic entity state, previous plan, and host time to one
  `ResolvedMotionPlan`.
- Migrate existing host grounded projection to active-phase kinematics from the same plan.
- Prove style, cycle, modifier, transition, interruption, reversal, speed scaling, and finite-link to
  repeating-cycle rules from retail/ACE.

#### Acceptance Criteria

- Playback selection and kinematics come from the same resolved motion records.
- Existing host projection does not independently re-derive motion-table facts.
- Non-motion-table animation/scripts do not allocate placeholder plan state.
- Catalog/resolver code has no Tauri or frontend dependency.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 4: Add Deterministic Time and Motion-Plan Feed

#### Deliverables

- Add pause, resume, deterministic step, semantic motion change, direct playback, and reset commands.
- Settle and implement the versioned host/frontend timeline mapping.
- Project resolved plans and revisions through sequenced deltas.
- Add frontend `MotionSystem` to stage referenced prepared animations and install plans generation-
  safely without decoding motion tables.
- Define late readiness: activation begins at the correct absolute plan cursor and follows proven
  hook catch-up rather than shifting semantic time to I/O completion.

#### Acceptance Criteria

- One host plan drives many frontend frames without additional host traffic.
- Pause/step tests use an injected clock and never sleep.
- Motion command changes replace plans atomically and stale revisions cannot affect new generations.
- Missing clip/dependency failure is explicit and does not substitute unrelated playback.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 5: Add Sparse Placement Projection and Residency

#### Deliverables

- Define `PlacementAnchor` with complete pose/residency, sample time, generation, placement revision,
  and continuous/discontinuous correction kind.
- Add frontend `PlacementSystem` as the sole writer of world-root presentation placement/residency.
- Sample anchor, active-phase velocity/omega, and animation root contribution from absolute host time.
- Add named decaying continuous correction; generation changes, teleports, attachment changes, and
  incompatible residency changes snap.
- Generalize portal tracing for entity movement through multiple dense cells; normalize outdoor
  endpoints and retain previous proven residency on missing/ambiguous topology.

#### Acceptance Criteria

- Runtime motion stays smooth without per-frame host transforms and does not accumulate render-delta
  drift.
- New anchors deterministically rebase one current frontend placement rather than creating parallel
  authoritative/presentation residencies.
- One sample can cross multiple environment-cell portals; unresolved topology never guesses.
- Root motion, velocity, and omega change residency only through `PlacementSystem`.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 6: Complete Runtime Mutation and Attachment Semantics

#### Deliverables

- Add focused appearance replacement, scale, attach/detach, direct script/effect activation, and
  complete generation replacement commands/deltas.
- Stage all new immutable dependencies before atomic activation.
- Preserve compatible playback and attachments under focused mutation; tear down all old mutable
  state under complete replacement.
- Make attached entities inherit ancestor residency and current animated part transforms.

#### Acceptance Criteria

- Focused replacement preserves root identity, generation, attachment, and compatible behavior.
- Complete replacement cannot leave nodes, playback, scripts, effects, queued hooks, pending work, or
  leases from the old generation.
- Despawn during any preparation stage is leak-free.
- Attached spawned entities follow current parent-part pose before visibility/rendering.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 7: Resteer for Client Sharing and Future Explorer Physics

#### Task Checklist

- [ ] Exercise repeated monsters, motion changes, appearance replacement, attachments, corrections,
      teleports, feed gaps, epoch reset, late assets, and deterministic stepping end to end.
- [ ] Measure host projection bytes, asset-transfer bytes, resolver work, frontend playback,
      placement, portal traversal, effects, pose, upload, and draw separately.
- [ ] Confirm traffic scales with semantic changes/anchors rather than clocks, frames, or cell
      crossings.
- [ ] Compare `ExplorerRuntime` and `ClientRuntime` call paths and extract only proven shared
      mechanics into `world`/`core`; reject a generic runtime superclass.
- [ ] Identify the first concrete explorer physics demonstration and write a separate plan from the
      landed authority/time/projection seams.
- [ ] Record the future protocol mapping for spawn, `ObjDescEvent`, complete update, movement, and
      server time without implementing dormant handlers here.

#### Acceptance Criteria

- The host/frontend architecture is proven across the real boundary with no synthetic-only link.
- Shared client/explorer mechanics have correct crate ownership and app policy remains local.
- Future physics work can extend the runtime without replacing feed, clock, world state, or frontend
  presentation contracts.
- No speculative physics or network system entered this plan.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 8: Cleanup and Architectural Cutover

#### Deliverables

- Remove old spawned commit branches, TypeScript-local architectural producers, reduced motion-
  kinematics vocabulary, unsequenced feed events, duplicated appearance projection, and placeholder
  runtime state.
- Retain focused test fakes where they provide smaller unit coverage.
- Update world/core/app architecture documentation and explorer diagnostics.

#### Acceptance Criteria

- Every production explorer scenario enters through `ExplorerRuntime`, shared world state, the host
  projector, and `DynamicEntityFeed`.
- No frontend path decodes motion tables or reconstructs visual identity heuristically.
- No app-local authoritative entity store or base-runtime hierarchy exists.
- Formatting, lint, tests, Rust checks, Clippy, and end-to-end host/frontend scenarios pass.

#### Decisions and Course Corrections

- Pending implementation.

## Verification Strategy

- Rust-host spawn/despawn/reset crossing Tauri into the existing frontend runtime.
- Repeated identical spawned entities sharing templates, behavior assets, and compatible draws.
- Focused versus complete replacement and stale generation/revision rejection.
- Snapshot/delta duplicate, forced gap/resnapshot, and epoch reset.
- Paused and deterministically stepped resolved motion without wall-clock sleeps.
- Finite link to repeating cycle with matching playback and kinematic phase boundaries.
- Plan effective before frontend asset readiness with absolute catch-up.
- Sparse anchor driving many frames, continuous rebase, motion change, and discontinuous teleport.
- Multi-cell portal traversal and topology-unavailable fallback.
- Parent-part attachment following animated pose.
- Despawn/replacement during every asynchronous staging boundary.

## Risks and Mitigations

### `ExplorerRuntime` Becomes a Second Client or God Runtime

Keep it to scenario policy, deterministic time, orchestration of shared world/core mechanics, and
presentation projection. It owns a shared world-state instance, not another entity model. Networking,
gameplay, rendering, and frontend resources stay outside.

### Host and Frontend Re-Derive Visual or Motion Truth

World owns canonical visual/motion state. The host projector resolves visual identity and
`ResolvedMotionPlan`; frontend DTO consumers do not inspect WCID fragments or raw motion keys.

### Feed Loss Produces Undetectable Partial State

Use atomic snapshot/subscription handoff, feed epoch, global sequence, and explicit resnapshot on
gaps. Per-entity revisions remain additional mutation guards.

### Clock Mapping Drifts Animation and Placement Apart

Use one versioned host monotonic timeline for plans and anchors. Test latency, pause/step,
resynchronization, delayed delivery, and late asset readiness against absolute sampling.

### Motion Is Applied Twice or Accumulates Drift

Resolve endpoint state from absolute anchor/plan time. Animation samples root data once;
`PlacementSystem` alone combines root, velocity, and omega into current placement.

### Dense Portal Topology Produces Wrong Residency

Trace each previous-presented-point to absolute endpoint through directed apertures with multiple
crossings. Retain prior proven residency on unavailable/ambiguous topology and await a later anchor.

### Explorer and Client Duplicate Shared Mechanics

Both operate on explicit shared world invariants. Extract additional stateless/core behavior only
after two concrete call paths prove it is isomorphic; keep scenario and session policy separate.

### Durable Runtime Naming Invites Premature Physics

Require a concrete explorer demonstration and separate plan before adding physics capabilities. The
runtime may grow, but this plan does not broaden merely because the name allows it.

## Definition of Done

- [ ] `ExplorerRuntime` owns shared world state, deterministic time, scenario orchestration, and a
      sequenced projection journal.
- [ ] Spawned lifecycle and mutations cross Tauri through a recoverable snapshot/delta feed.
- [ ] World state retains canonical visual, generation, placement, attachment, and motion facts.
- [ ] Spawned and authored entities reuse the same frontend visual, behavior, effect, pose, and
      renderer systems.
- [ ] Motion-table semantics resolve once in Rust into `ResolvedMotionPlan`.
- [ ] Frontend motion and placement execute smoothly from plans and sparse anchors without raw tables
      or per-frame host transforms.
- [ ] Feed gaps, epoch changes, stale revisions, clock resynchronization, and late assets have tested
      explicit behavior.
- [ ] Focused mutation preserves identity; complete replacement/despawn removes all old mutable state
      and leases.
- [ ] Attachments follow animated parts and inherit ancestor residency.
- [ ] `ExplorerRuntime` and `ClientRuntime` remain sibling composition roots without duplicated world
      invariants or a speculative superclass.
- [ ] Networking, gameplay simulation, and general physics remain absent.
- [ ] Diagnostics distinguish feed/asset bytes, gaps/resnapshots, host time, plans, anchors,
      corrections, portal crossings, entities, resources, effects, uploads, and draws.
- [ ] All touched code passes repository formatting, linting, tests, Rust checks, and Clippy with
      warnings denied.
- [ ] Architecture documentation records the host/world/frontend ownership model.

## Open Questions

1. Which canonical world visual-selection fields are required to losslessly map current `ModelData`
   and future focused `ObjDescEvent` updates?
2. Which server sequence gates focused appearance changes, and exactly what survives complete
   replacement?
3. What are the exact retail transition, interruption, reversal, speed-scaling, and animation-root
   composition rules for motion tables?
4. Which versioned host/frontend timeline mapping best supports latency, pause/step, and future server
   time synchronization?
5. Which Tauri transport primitive provides ordered bounded delivery and atomic snapshot subscription
   without turning UI events into a mutation bus?
6. Does retail determine environment-cell residency from position origin or collision extent during
   movement?
7. What is the first concrete explorer physics scenario worth adding after this runtime lands?
