# Holtburger 3D Dynamic Entity Runtime Roadmap

Status: Roadmap — convergence complete; authored effects queued next
Created: 2026-07-31
Evidence pass: 2026-07-31
Roadmap split: 2026-07-31
Convergence review: 2026-08-01

## Goal

Reach high-fidelity authored world presentation first, then extend the proven frontend runtime to
spawned entities through one authoritative world runtime and a reconstructable view-event path driven
by explorer scenarios or a future network client.

## Convergence Provenance

| Concern                           | Status                    | Evidence or owner                                                             |
| --------------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| Canonical first slice             | Complete on `3d-next`     | `c09eb3c2`                                                                    |
| Donor first slice                 | Complete on `claude` only | `c938a438`                                                                    |
| Selected convergence architecture | Complete                  | `holtburger-3d-dynamic-entity-architecture-convergence-plan.md`               |
| Claude effects and host topology  | Donor-proven              | Reimplemented only behind canonical contracts                                 |
| Effects execution                 | Queued                    | Resteered 2026-08-06 against the landed sky pass; executable on authorization |
| Spawned execution                 | Queued                    | Rewritten and dry-run by convergence Phases 6-7; execute after effects        |

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
materialization and proven effects, then audits and rewrites the spawned plan around one world
runtime, one complete initial snapshot plus ordered deltas, and two drivers. The authored-effects plan
is the next queued
execution plan; it is not active until separately authorized.

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
  effects plan and entity attachments remain in the spawned-entity plan.
- Authored placement and residency remain authoritative, matching retail's static-animation
  null-root-offset behavior.
- Script-only behavior remains explicitly deferred with valid static presentation.

This plan establishes the shared frontend dynamic presentation bones without introducing spawned
entity or motion-table scaffolding.

### 2. Static-Authored Scripts and Effects Fidelity

Plan: [holtburger-3d-static-authored-effects-runtime-plan.md](holtburger-3d-static-authored-effects-runtime-plan.md)

Progress: Queued; resteered against the landed sky pass with an executable Phase 1 (2026-08-06).

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

### 3. Spawned Entities and Explorer Runtime

Plan: [holtburger-3d-spawned-entity-explorer-runtime-plan.md](holtburger-3d-spawned-entity-explorer-runtime-plan.md)

Progress: Queued after the authored-effects plan; convergence audit and rewrite complete (2026-08-01).

Outcome:

- Explorer scenarios and a future network client drive the same `holtburger-world` runtime and
  projected view contract.
- Spawned lifecycle and mutations cross Tauri through the existing view-event path with a complete
  initial snapshot and explicit resnapshot after detected receiver lag.
- World state owns canonical appearance, lifecycle operations, placement, attachment, and motion facts.
- Spawned attach/detach provides the concrete lifecycle consumer for shared animated parent-part
  following.
- `MotionCatalog` and `MotionResolver` produce shared `ResolvedMotionPlan` values in Rust.
- The frontend executes plans and sparse placement anchors without consuming raw motion tables or
  per-frame host transforms.
- Spawned entities reuse the authored visual, behavior, effect, presentation, and renderer systems.
- App-local explorer and client composition remain policy boundaries over shared world/core mechanics,
  with no second authoritative runtime or speculative base-runtime hierarchy.

This plan establishes a durable growth seam for later explorer physics demonstrations, which require
a separate concrete scenario and plan.

## Cross-Plan Architectural Contracts

These contracts survive every roadmap stage:

1. `holtburger-common` contains shared primitives and traits only.
2. `holtburger-protocol` contains deterministic wire types/serialization only.
3. `holtburger-dat` owns parsed static file formats.
4. `holtburger-content` owns runtime content discovery, bootstrap assembly, and static reference-data
   queries.
5. `holtburger-world` owns authoritative entity, appearance, placement, attachment, spatial, and
   semantic motion invariants.
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
13. Explorer and future network drivers mutate the same world-domain model and publish one complete
    initial snapshot plus the existing ordered focused deltas.
14. Feed epochs, global entity sequences, permanent generation tombstones, and a stateful projector
    require measured need; they are not roadmap prerequisites.

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

### Explorer Is a Driver, Not Another World Runtime

Explorer scenarios remain the intended producer for spawned test entities and later simulation.
They enter only after authored presentation systems are proven and drive the same world-domain
mutations and projected events as a future network client. A narrow app-local composition adapter may
own scenario policy and deterministic controls; it may not become a second authoritative entity model.

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
the effects plan, alongside — not ahead of, and not blocking — the spawned-entity plan, which has
no dependency on weather in either direction.

Beyond the seam, the completed sky pass landed shared code the effects plan now reuses instead of
rebuilding: the unit-tested derived-phase scroll arithmetic (`skyTextureOffset`), the corrected
staged blend selection in the shared `objectBlendPolicy`, standalone `TEXTURE_2D` residency, and
the `resolveObjectMaterialRanges` span primitive. The effects plan's 2026-08-06 resteer records
each with its consuming phase.

### No Universal Runtime Base Class

Explorer and network-client composition remain local. Shared motion, spatial, world, and projection
behavior lives in `world`/`core` when concrete consumers prove it; scenario policy, sessions, and
transport remain local. No universal runtime base class is introduced.

## Overall Definition of Done

- [x] The static-authored animation plan has retail visual parity and representative workload
      performance evidence.
- [ ] The static-authored effects plan is complete with real script, particle, and sound consumers.
- [ ] The spawned entity/Explorer runtime plan is complete across the Rust/Tauri/TypeScript boundary.
- [ ] Authored and spawned entities reuse one frontend template, behavior, presentation, effect, and renderer
      architecture.
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
