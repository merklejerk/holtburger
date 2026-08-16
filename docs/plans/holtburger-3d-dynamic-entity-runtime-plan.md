# Holtburger 3D Dynamic Entity Runtime Roadmap

Status: Roadmap — authored effects complete; Explorer weenie dynamic runtime is the mainline next
step, with the weather/sky-script plan unblocked as a parallel track
Created: 2026-07-31
Evidence pass: 2026-07-31
Roadmap split: 2026-07-31
Convergence review: 2026-08-01
Host-physics reconciliation: 2026-08-12
Open-scene reconciliation: 2026-08-15

## Goal

Reach high-fidelity authored world presentation first, then extend the proven frontend runtime to
spawned entities through source-neutral definitions, committed solver outcomes, and a reconstructable
view-event path.
Explorer scenarios and a future network client retain distinct entity authorities above that seam.

## Convergence Provenance

| Concern                           | Status                    | Evidence or owner                                                                                                                       |
| --------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical first slice             | Complete on `3d-next`     | `c09eb3c2`                                                                                                                              |
| Donor first slice                 | Complete on `claude` only | `c938a438`                                                                                                                              |
| Selected convergence architecture | Complete                  | `holtburger-3d-dynamic-entity-architecture-convergence-plan.md`                                                                         |
| Claude effects and host topology  | Donor-proven              | Reimplemented only behind canonical contracts                                                                                           |
| Effects execution                 | Complete 2026-08-07       | All phases landed; reopened Phase 8 cleanup closed the same day                                                                         |
| Host physical-body topology       | Implemented 2026-08-15    | External simulation interest, generic bodies, total installed-scene collision, non-gating residency, and placed paths landed            |
| Dynamic entity execution          | Queued                    | Preempted by the Explorer WCID/catalog/solver milestone; must share value/event contracts without merging client and Explorer authority |

## Why This Roadmap Is Split

The original plan combined three independently substantial outcomes:

1. Rendering and animating static-authored dynamic residents.
2. Executing authored physics scripts, particles, sound, and related effects.
3. Building spawned-entity world state, host projection, motion-table resolution, clock mapping,
   sparse placement, and the explorer-driver boundary.

That ordering made the eventual client architecture compete with immediately visible authored-world
fidelity. The plans are now sequenced by product value and dependency truth: prove the shared
frontend presentation architecture on real authored content, complete the authored effects
population, and only then add mutable spawned entities and host-authoritative motion.

The split is also architectural addition through subtraction. The first plan no longer needs motion
tables, sparse anchors, reconciliation, runtime portal traversal, or an explorer host merely to
animate authored butterflies. The spawned plan inherits tested visual, animation, script, effect,
presentation, resource, and renderer systems instead of designing them alongside transport and world
state.

## Sequenced Plans

### 0. Dynamic-Entity Architecture Convergence

Plan: [holtburger-3d-dynamic-entity-architecture-convergence-plan.md](holtburger-3d-dynamic-entity-architecture-convergence-plan.md)

Progress: Complete on `3d-next` (2026-08-01).

This completed execution record preserves the canonical animation slice, converges template
materialization and proven effects, then audited the spawned plan around one complete initial
snapshot plus ordered deltas and two drivers. Its earlier one-world-runtime conclusion is superseded
by Stage 3's distinct producer registries and shared downstream contracts. The authored-effects plan was
the next queued execution plan; it is now complete.

### 1. Static-Authored Animation Fidelity

Plan: [holtburger-3d-static-authored-animation-runtime-plan.md](holtburger-3d-static-authored-animation-runtime-plan.md)

Progress: Complete after renewed retail visual/performance validation (2026-08-01).

Outcome:

- Setup-backed authored residents with default animation render and animate.
- Visual templates, animation resources, and GPU resources are shared by content identity.
- Rigid parts use frame-streamed compatible instance cohorts.
- Semantic hooks and fractional visual interpolation remain distinct.
- Required visual hooks such as `SetOmega` execute deterministically.
- Appearance-time part selection is prepared here; timed `ReplaceObjectHook` behavior remains in the
  effects plan and entity attachments remain deferred until a concrete dynamic-runtime consumer.
- Authored placement and residency remain authoritative, matching retail's static-animation
  null-root-offset behavior.
- Script-only behavior remains explicitly deferred with valid static presentation.

This plan establishes the shared frontend dynamic presentation bones without introducing spawned
entity or motion-table scaffolding.

### 2. Static-Authored Scripts and Effects Fidelity

Plan: [holtburger-3d-static-authored-effects-runtime-plan.md](holtburger-3d-static-authored-effects-runtime-plan.md)

Progress: Complete (2026-08-07). All phases landed with retail-verified behavior; the reopened
Phase 8 cleanup closed the same day.

Outcome:

- Setup default physics scripts and tables are decoded, prepared, scheduled, and shared.
- `CallPES`, including intentional cyclic graphs, executes through bounded scheduled activation.
- Proven visual hook commands have real consumers.
- `ReplaceObjectHook` atomically selects pre-staged shared replacement-part resources and updates
  conservative presentation bounds.
- Authored `CreateParticle` and `SoundTweaked` events produce real particle and audio behavior.
- Script-only and combined authored residents activate on the same entity/presentation/resource architecture
  as animated residents.

This plan completes authored behavior fidelity before mutable runtime entities broaden lifecycle and
authority requirements.

### 3. Explorer Weenie Dynamic Runtime

Plan: [holtburger-3d-explorer-weenie-dynamic-runtime-plan.md](holtburger-3d-explorer-weenie-dynamic-runtime-plan.md)

Progress: Proposed — preempts the earlier spawned-entity plan (2026-08-16). The first consumer is
Explorer-initiated WCID spawning from an optional offline ACE World-derived catalog, with distinct
producer registries feeding source-neutral body definitions, committed solver outcomes, and pure
projection mechanics reusable by a future network client.

Outcome:

- An offline tool exports consumer-backed ACE World weenie facts into an optional host-only flat
  catalog; the application has no runtime ACE Server/MySQL dependency. The thin export/catalog
  pipeline lands before runtime contracts so a catalog-plus-DAT survey can select representative
  WCIDs and evidence-backed physics shapes.
- Explorer WCID scenarios and a future network client retain separate entity registries while
  consuming the same source-neutral definition, body-operation, committed-outcome, and projection
  contracts.
- Dynamic lifecycle crosses Tauri through one focused initial snapshot and focused deltas, with
  listener-first reconstruction after startup or page reload and no speculative delivery-recovery
  protocol.
- Each producer registry owns its semantic lifecycle while its composition-local `SpatialScene` owns
  physical state. Ordered installation plus projection joining prevents partial publication without
  a cross-store transaction.
- Complete ACE template physics-state inputs are cataloged losslessly. Every entity retains one pose
  body while effective-state replacement reversibly attaches, detaches, or reconfigures optional
  solver participation; the existing client `SetState` path consumes the same transition logic.
- Explorer prediction reuses `HostSimulationRuntime`'s existing spatial-body store, solver, per-tick
  scene residency, and placed paths. A client uses its separate `WorldState` scene; catalog provenance
  does not fork the downstream mechanics.
- One collection fixed-tick participant visits Explorer entities in stable body order, integrates
  active bodies, and relays at most one focused changed-body/report batch per epoch; static collision
  targets need no scheduler slot and the synthetic camera remains environment-only unless explicitly
  opted in.
- Solver-owned quiescence prunes integration and mover-side queries for proven resting bodies without
  removing their canonical pose, dynamic-shadow membership, target collision, report maintenance, or
  presentation. Explicit drive/state/scene/contact inputs wake them; no sleep-island system is assumed.
- The shared fixed tick includes deterministic, physics-state-filtered dynamic candidate discovery
  reusing global 24 m outdoor cells and reached EnvCells, sized for 50-300 spawned entities per
  populated landblock, plus census-selected target geometry, narrow-phase contact/response, bounded
  incremental convergence, an evidence-selected continuous-contact rule, and retained collision
  start/end reporting.
- Existing `MotionKinematics` data and focused resolution functions are extended only as the named
  motion scenarios require; no catalog/resolver service hierarchy is assumed up front.
- The frontend executes plans and sparse placement anchors without consuming raw motion tables or
  per-frame host transforms.
- Dynamic entities reuse the authored visual, behavior, effect, presentation, and renderer systems.
- App-local Explorer and client composition remain distinct authority and policy boundaries over
  shared world/core mechanics, with no speculative base-runtime hierarchy.
- Dynamic motion consumes the landed `holtburger-world` collision queries and generic physical-body
  tick. Bodies continue through absent collision as open space and report final-owner residency, but
  never load, retain, or evict collision themselves. Entities do not consume Explorer camera policy.

Focused appearance mutation and animated attachments remain deferred until a concrete Explorer or
client scenario consumes each operation.

## Cross-Plan Architectural Contracts

These contracts survive every roadmap stage:

1. `holtburger-common` contains shared primitives and traits only.
2. `holtburger-protocol` contains deterministic wire types/serialization only.
3. `holtburger-dat` owns parsed static file formats.
4. `holtburger-content` owns runtime content discovery, bootstrap assembly, and static reference-data
   queries.
5. `holtburger-world` owns the client's authoritative entity, appearance, placement, attachment,
   spatial, and semantic motion invariants plus source-neutral spatial primitives. It does not own
   the Explorer registry.
6. `holtburger-core` owns reusable client behaviors/orchestration only after concrete consumers prove
   sharing.
7. `apps/holtburger-3d/src-tauri` owns the narrow app-local host composition and projection adapter.
8. The TypeScript frontend owns presentation playback, effects, scene transforms, visibility,
   rendering, and explorer UX.
9. One content-addressed visual-template repository owns immutable preparation plus geometry and
   atlas residency; mutable playback/effect state is retained per activation.
10. Renderer batching remains renderer policy and never determines domain/resource identity.
11. Unsupported behavior is observable with provenance; diagnostics never drive runtime decisions.
12. No plan may introduce dormant infrastructure assigned to a later plan.
13. Explorer and future network drivers retain distinct producer registries, feed the same
    source-neutral definition/solver-outcome/projection contracts, and publish one focused dynamic
    snapshot plus ordered deltas through their own outer feeds.
14. Feed epochs, global entity sequences, permanent generation tombstones, an async backend event
    bus, a stateful realization service, and a stateful projector require measured need; they are not
    roadmap prerequisites.
15. Application policy owns simulation interest. Physical bodies query the resulting immutable
    installed collision snapshot, treat absent products as open space, report final-owner residency
    without gating motion, and cannot load, retain, or evict collision content.
16. Within each runtime composition, server-owned, local-player, or Explorer-owned bodies share one
    validated geometry-plus-response definition and one `SpatialBody` store. Explorer and client
    compositions do not share a store instance; identity allocation and setup lookup remain producer
    concerns.
17. The optional Explorer weenie catalog is a separately generated host reference asset, not HBA
    client content and not a `ContentRepository` mount. Only its source-neutral spawn facts cross
    into shared realization contracts.
18. A dynamic entity's `SpatialBody` remains its pose owner even when it has no physical attachment.
    Complete effective physics-state replacement—not entity respawn or one collidable boolean—drives
    reversible solver and scheduler participation.
19. Body-to-body collision is required dynamic-runtime behavior, not census-gated optional scope.
    Catalog/DAT measurements select the simplest correct pair-discovery strategy and representative
    fixtures before solver contracts are frozen.

## Shared Evidence

### Authoritative References

- `acclient-eor-source/acclient.c` is the primary source for retail playback, pose, placement,
  physics-script, hook, and object-replacement behavior.
- `ACE/Source/ACE.DatLoader` is the primary parsed-format reference for animation, hooks, motion
  tables, physics scripts, and script tables.
- `ACE/Source/ACE.Server` is the primary server-side reference for focused `ObjDescEvent` versus
  complete `UpdateObject` mutation.
- `ACViewer/ACViewer/Physics` is supporting evidence for setup-default initialization and rigid-part
  playback.

### Representative Authored Workload

The 2026-07-31 archive census used production `dats/assets.hba` and radius-one scans around
`0xDA55FFFF` and `0xDC58FFFF`:

| Workload     | Setup-backed sources | Default animation | Default script | Total behavior owners |
| ------------ | -------------------: | ----------------: | -------------: | --------------------: |
| `0xDA55FFFF` |                1,315 |                44 |             66 |                   110 |
| `0xDC58FFFF` |                1,362 |               162 |             52 |                   214 |

Representative default animations:

| Setup        | Animation    | DA55 | DC58 | Frames / parts | Slots per part | Material | Required hook |
| ------------ | ------------ | ---: | ---: | -------------- | -------------: | -------- | ------------- |
| `0x02000493` | `0x030006CB` |   22 |   77 | 90 / 2         |              1 | cutout   | `SetOmega`    |
| `0x02000494` | `0x030006CA` |   19 |   82 | 90 / 2         |              1 | cutout   | `SetOmega`    |
| `0x020005AC` | `0x03000751` |    3 |    3 | 7 / 2          |              1 | opaque   | `SetOmega`    |

The butterflies share part/material resources but have different setup/template and animation
identities. Their authored setup spheres have radius zero and are not conservative animation bounds.

Representative default scripts contain 25 authored events:

| Event            | Count |
| ---------------- | ----: |
| `CreateParticle` |    17 |
| `CallPES`        |     5 |
| `SoundTweaked`   |     3 |

Transitive traversal reaches 17 scripts. Four shipped scripts call themselves, proving dependency
cycle detection must terminate preparation without rejecting intentional scheduled loops.

## Roadmap Decisions

### Authored Fidelity Precedes Spawned Generality

Authored residents are already present, numerous, and backed by exact content/reference evidence.
They provide the best first consumers for templates, animation, scripts, effects, presentation, and
instancing. Spawned entities reuse those systems after their behavior is proven.

### Static Default Animation Does Not Require Runtime Placement Projection

Retail advances static default animation without requesting root-offset output, and the shipped
setup-default animation scan found no translational root motion. The animation plan therefore keeps
authored placement/residency fixed and applies rigid-part/visual-root motion downstream. Sparse
anchors and motion-derived residency belong to the spawned plan.

### Real Effects, Not Placeholder Ports

The effects plan does not declare authored particles and sound complete merely because typed hook
ports exist. The measured `CreateParticle` and `SoundTweaked` workload requires concrete visible and
audible consumers.

### Explorer Is a Distinct Producer Above the Shared Contracts

Explorer scenarios remain the intended producer for spawned test entities and later simulation.
They enter only after authored presentation systems are proven. An app-local Explorer registry owns
their semantic lifecycle, while the future network client retains `WorldState`; both feed the same
source-neutral definition, committed-outcome, and projected-event contracts. The narrow app-local
composition owns scenario policy and deterministic controls without pretending to be a client
runtime.

### The Sky Pass Is a Parallel Track; Weather Comes After Effects

The sky pass plan ([holtburger-3d-sky-pass-plan.md](holtburger-3d-sky-pass-plan.md)) completed
2026-08-06. It is not part of this roadmap and had no dependency in either direction: its Phase 0
evidence proved the celestial deliverable uses instant material writes and a plain UV accumulator,
never hooks, particles, or physics scripts. It does hand this roadmap a seam: sky objects carry
`default_pes_object_id` and weather `properties` bits losslessly, so once the authored-effects
plan lands PES execution and particles, sky physics scripts become an additional authored-script
consumer with no schema change. A weather feature depends on both the sky pass and the effects
runtime and requires its own concrete plan; neither existing plan may pre-build weather
infrastructure for it.

The 2026-08-05 sky-object census (recorded in the sky pass plan) confirmed the weather plan will
have real content: 92 authored weather objects across the Rainy day groups (scrolling rain sheets
plus Setup-backed emitters carrying physics scripts), and 96 sky objects with
`default_pes_object_id` overall — including one always-visible celestial script consumer present
in every day group.

That plan now exists:
[holtburger-3d-weather-sky-script-runtime-plan.md](holtburger-3d-weather-sky-script-runtime-plan.md)
(authored 2026-08-06, ahead of the original effects-boundary schedule, so the effects plan's
sky-script deferral has a named owner). Its schedule: Phase 0 evidence is executable at any time
against DAT content and the decompile; every implementation phase is gated behind a mandatory
boundary dry-run (its Phase R) when the effects plan completes. It runs as a parallel track after
the effects plan, alongside — not ahead of, and not blocking — the Explorer weenie dynamic-runtime
plan, which has no dependency on weather in either direction.

**Weather is deliberately not a roadmap Definition-of-Done item (ratified 2026-08-06).** It is a
follow-on feature that consumes this roadmap's output rather than a condition for the roadmap being
finished; gating completion on it would hold the dynamic-entity architecture open indefinitely
behind scope that is genuinely optional. The weather plan keeps its own Definition of Done.

Beyond the seam, the completed sky pass landed shared code the effects plan now reuses instead of
rebuilding: the unit-tested derived-phase scroll arithmetic (hoisted 2026-08-06 to the shared `textureScrollPhase`), the corrected
staged blend selection in the shared `objectBlendPolicy`, standalone `TEXTURE_2D` residency, and
the `resolveObjectMaterialRanges` span primitive. The effects plan's 2026-08-06 resteer records
each with its consuming phase.

### No Universal Runtime Base Class

Explorer and network-client composition remain local. Shared motion, spatial operations, and
projection behavior live in `world`/`core` when concrete consumers prove it; entity authority,
scenario policy, sessions, and transport remain local. No universal runtime base class is introduced.

## Overall Definition of Done

- [x] The static-authored animation plan has retail visual parity and representative workload
      performance evidence.
- [x] The static-authored effects plan is complete with real script, particle, and sound consumers
      (2026-08-07).
- [ ] The Explorer weenie dynamic runtime is complete across the catalog/Rust/Tauri/TypeScript
      boundary.
- [ ] Catalog-created and server-updated entities preserve the complete effective physics-state mask;
      one shared transition rule keeps their pose bodies alive while solver participation remains
      optional and reversible.
- [ ] Dynamic bodies collide through one deterministic flag-filtered solve reusing outdoor-cell and
      reached-EnvCell partitioning, converge within the recorded tick bound, and maintain proven
      collision start/refresh/end lifecycles without tunneling or whole-world rollback.
- [ ] The Explorer workload uses one collection scheduler participant, one focused advance batch per
      epoch, canonical body poses, and scene-owned derived spatial memberships at 50-300 entities.
- [ ] Proven quiescent bodies skip integration while remaining indexed collision targets, and every
      state-changing input has one tested wake path without a second active-body authority.
- [ ] Authored and spawned entities reuse one frontend template, behavior, presentation, effect, and
      renderer architecture.
- [ ] Static authored fidelity does not depend on motion tables, sparse anchors, or a spawned host.
- [ ] Raw motion tables and authoritative world mutation remain outside the frontend.
- [ ] No plan leaves dormant scaffolding, silent unsupported behavior, or obsolete compatibility
      paths for a later plan to clean up implicitly.
- [ ] Each plan records course corrections and passes its own formatting, lint, test, harness, and
      architecture acceptance criteria before the next begins.

## Roadmap Resteering Rule

At each plan boundary, dry-run the next plan against landed contracts and update that plan before
implementation. Do not pull later-plan infrastructure forward merely because a future type or method
is easy to sketch. Pull work forward only when the current plan has a real consumer and cannot finish
honestly without it.
