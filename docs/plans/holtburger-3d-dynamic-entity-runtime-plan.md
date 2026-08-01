# Holtburger 3D Dynamic Entity Runtime Roadmap

Status: Split into sequenced implementation plans
Created: 2026-07-31
Evidence pass: 2026-07-31
Roadmap split: 2026-07-31

## Goal

Reach high-fidelity authored world presentation first, then extend the proven frontend runtime to
spawned entities through a durable Rust `ExplorerRuntime` and shared authoritative world state.

## Why This Roadmap Is Split

The original plan combined three independently substantial outcomes:

1. Rendering and animating static-authored dynamic residents.
2. Executing authored physics scripts, particles, sound, and related effects.
3. Building spawned-entity world state, host projection, motion-table resolution, clock mapping,
   sparse placement, and the `ExplorerRuntime` boundary.

That ordering made the eventual client architecture compete with immediately visible authored-world
fidelity. The plans are now sequenced by product value and dependency truth: prove the shared
frontend presentation architecture on real authored content, complete the authored effects
population, and only then add mutable spawned entities and host-authoritative motion.

The split is also architectural addition through subtraction. The first plan no longer needs motion
tables, sparse anchors, reconciliation, runtime portal traversal, or an explorer host merely to
animate authored butterflies. The spawned plan inherits tested visual, animation, script, effect,
pose, resource, and renderer systems instead of designing them alongside transport and world state.

## Sequenced Plans

### 1. Static-Authored Animation Fidelity

Plan: [holtburger-3d-static-authored-animation-runtime-plan.md](holtburger-3d-static-authored-animation-runtime-plan.md)

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

Outcome:

- Setup default physics scripts and tables are decoded, prepared, scheduled, and shared.
- `CallPES`, including intentional cyclic graphs, executes through bounded scheduled activation.
- Proven visual hook commands have real consumers.
- `ReplaceObjectHook` atomically selects pre-staged shared replacement-part resources and updates
  conservative presentation bounds.
- Authored `CreateParticle` and `SoundTweaked` events produce real particle and audio behavior.
- Script-only and combined authored residents activate on the same entity/pose/resource architecture
  as animated residents.

This plan completes authored behavior fidelity before mutable runtime entities broaden lifecycle and
authority requirements.

### 3. Spawned Entities and Explorer Runtime

Plan: [holtburger-3d-spawned-entity-explorer-runtime-plan.md](holtburger-3d-spawned-entity-explorer-runtime-plan.md)

Outcome:

- `ExplorerRuntime` orchestrates a shared `holtburger-world` state instance and deterministic time.
- Spawned lifecycle and mutations cross Tauri through a recoverable snapshot/sequenced-delta feed.
- World state owns canonical appearance, generation, placement, attachment, and motion facts.
- Spawned attach/detach provides the concrete lifecycle consumer for shared animated parent-part
  following.
- `MotionCatalog` and `MotionResolver` produce shared `ResolvedMotionPlan` values in Rust.
- The frontend executes plans and sparse placement anchors without consuming raw motion tables or
  per-frame host transforms.
- Spawned entities reuse the authored visual, behavior, effect, pose, and renderer systems.
- `ExplorerRuntime` and `ClientRuntime` remain sibling composition roots over shared world/core
  mechanics, with no speculative base-runtime hierarchy.

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
9. Immutable content resources are keyed and shared by content identity; mutable playback/effect
   state is retained per activation.
10. Renderer batching remains renderer policy and never determines domain/resource identity.
11. Unsupported behavior is observable with provenance; diagnostics never drive runtime decisions.
12. No plan may introduce dormant infrastructure assigned to a later plan.

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
They provide the best first consumers for templates, animation, scripts, effects, pose, and
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

### ExplorerRuntime Is Durable but Not a Prerequisite

`ExplorerRuntime` remains the intended host for spawned test entities and later explorer simulation.
It enters only after authored presentation systems are proven. It composes shared world state rather
than creating an app-local authoritative model, and it grows only behind concrete explorer scenarios.

### No Universal Runtime Base Class

`ExplorerRuntime` and `ClientRuntime` are sibling composition roots. Shared motion, spatial, world,
and projection behavior moves into `world`/`core` when both have concrete use; application lifecycle,
scenario policy, sessions, and transport remain local.

## Overall Definition of Done

- [ ] The static-authored animation plan is complete with real representative workload evidence.
- [ ] The static-authored effects plan is complete with real script, particle, and sound consumers.
- [ ] The spawned entity/Explorer runtime plan is complete across the Rust/Tauri/TypeScript boundary.
- [ ] Authored and spawned entities reuse one frontend template, behavior, pose, effect, and renderer
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
