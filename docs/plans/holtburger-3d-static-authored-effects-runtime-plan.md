# Holtburger 3D Static-Authored Effects Runtime Plan

Status: Sequenced after static-authored animation fidelity
Created: 2026-07-31
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`
Prerequisite: `docs/plans/holtburger-3d-static-authored-animation-runtime-plan.md`

## Context and Boundaries

### Goal

Complete static-authored behavior fidelity by executing setup default physics scripts and their
proven visual, particle, audio, lighting, and chained-script effects on the shared authored dynamic
runtime.

### Problem Statement

The representative authored regions contain more setup-default script owners than animation owners.
Leaving those scripts inert omits ambient particles, sound, and visual behavior even after rigid-part
animation works. The animation plan deliberately preserves script identity and static presentation
but does not decode, schedule, or execute physics scripts.

This plan adds the second timed behavior producer and real effect consumers. It reuses the entity,
template, pose, hook, resource-lifetime, and renderer architecture established by the animation plan;
it does not create an effects-specific entity runtime or pull spawned-entity infrastructure forward.

### In Scope

- Typed `PhysicsScript` and `PhysicsScriptTable` DAT decoding and compact content transport.
- Shared prepared script/table repositories and transitive dependency closure.
- Deterministic per-entity physics-script clocks, type/intensity table selection, and `CallPES`.
- Safe preparation and runtime execution of intentional cyclic script graphs.
- Expansion of the prepared hook-command union for every static-authored behavior proven by evidence.
- Concrete visual mutation consumers required by authored scripts.
- Concrete particle playback/rendering for the proven `CreateParticle` workload.
- Concrete sound asset/playback behavior for the proven `SoundTweaked` workload.
- Lighting behavior where the refreshed authored script/hook census demonstrates a consumer.
- Atomic promotion of script-only authored residents after their complete behavior closure is ready.
- Combined animation and script clocks on the same entity without merging their ownership.

### Out of Scope

- Spawned/server entities, `ExplorerRuntime`, entity feeds, motion tables, sparse anchors, or runtime
  reconciliation.
- General-purpose particle authoring tools, audio middleware, environmental mixing, or a universal
  effect graph.
- Implementing unused hook types merely because they exist in the DAT format.
- Silently approximating unknown hook payloads, timing, asset lookup, attenuation, or attachment
  semantics.
- Moving behavior-resource ownership into `HookSystem` or embedding decoded timelines in entity
  source records.
- Network-triggered physics scripts, combat effects, projectiles, or gameplay authority.

## Ground Truth and Existing Precedent

### Authoritative References

- `acclient-eor-source/acclient.c`
  - `CPhysicsObj::InitDefaults`: setup defaults initialize animation, physics script, physics-script
    table, sound table, and related behavior state.
  - `CPhysicsObj::animate_static_object`: static default animation and scripts advance independently.
  - `PhysicsScriptManager` and `PhysicsScriptTableManager`: timed scripts and table-selected scripts
    dispatch animation hooks.
  - `CAnimHook::GetSubDataIDs` and hook-specific implementations: dependency assets are enumerable
    before execution.
- `ACE/Source/ACE.DatLoader/FileTypes/PhysicsScript.cs`
- `ACE/Source/ACE.DatLoader/FileTypes/PhysicsScriptTable.cs`
- `ACE/Source/ACE.DatLoader/Entity/AnimationHooks/*`
- `ACViewer/ACViewer/Physics/PhysicsObj.cs:680-710`

### Existing Code to Extend

- The authored entity/template/pose/hook systems landed by the prerequisite animation plan.
- `crates/holtburger-core/src/content_assets.rs`
- `apps/holtburger-3d/src-tauri/src/lib.rs` compact binary content adapter patterns.
- Existing texture, geometry, transparent ordering, and frame-stream infrastructure for particle
  rendering where their contracts are genuinely reusable.
- Existing application audio or asset-decoding facilities discovered during Phase 1; do not invent a
  parallel audio cache without first inventorying them.

### Measured Workload

The recorded representative scans contain 66 and 52 setup default-script owners in `0xDA55FFFF` and
`0xDC58FFFF`. The 14 default-script roots contain 25 authored events:

| Event            | Count | Required initial consumer |
| ---------------- | ----: | ------------------------- |
| `CreateParticle` |    17 | Particle runtime/renderer |
| `CallPES`        |     5 | Script scheduler          |
| `SoundTweaked`   |     3 | Audio runtime             |

Transitive `CallPES` traversal reaches 17 scripts total. Four shipped scripts
(`0x330003CC`, `0x33000711`, `0x3300072C`, and `0x33000863`) call themselves. Preparation traversal
must terminate without rejecting these graphs, while runtime scheduling must not recurse
synchronously forever.

The representative setup appearances do not use default physics-script tables. Table selection is
therefore an evidence gate for broader shipped content rather than something to infer from the
representative regions.

## North Stars

1. Implement measured authored effects before generic effect infrastructure.
2. Animation and physics scripts are independent clocks that emit the same prepared command shape.
3. `HookSystem` orders and dispatches commands; it does not own producers, resources, particles, or
   audio.
4. Preparation discovers and pins the complete transitive dependency closure before activation.
5. Cyclic dependency graphs are valid authored content; preparation termination and runtime
   repetition are separate concerns.
6. Effect instances follow current authored entity/part transforms produced by the shared pose path.
7. Unknown behavior fails staging or reports unsupported execution with complete provenance; it never
   disappears silently.
8. Script-only residents retain their static presentation until a real behavior consumer is ready.
9. Resource and runtime counts scale with unique assets and active effects, not source entities by
   accident.
10. Spawned-entity concerns do not enter this plan.

## Target Runtime Shape

```text
setup default script/table IDs
  -> typed content load
  -> prepared script/table repositories
  -> transitive hook/effect dependency closure
  -> per-entity PhysicsScriptSystem clock
  -> prepared commands
  -> HookSystem ordered dispatch
       |- visual mutation ports -> shared pose/entity state
       |- CreateParticle -> particle runtime -> renderer
       |- SoundTweaked -> audio runtime
       `- CallPES -> scheduled script activation
```

Animation and script producers may target the same entity, but neither advances or owns the other's
clock. Equal-time ordering, reentrancy, teardown, and generation checks are explicit.

## Phased Implementation

### Phase 1: Complete the Authored Script and Hook Evidence

#### Deliverables

- Refresh the complete production setup default-script/table census, including transitive hook and
  asset dependencies.
- Prove record timing units, table keys/intensity selection, `CallPES` delay/repetition behavior, and
  equal-time command ordering from retail/ACE.
- Inventory current audio, particle, lighting, and asset-decoding code before designing consumers.
- Classify every reachable hook as visual, particle, audio, lighting, chained script, or unsupported
  with a named evidence gap.

#### Acceptance Criteria

- Every implementation phase is backed by exact asset IDs, record shapes, and reference paths.
- The four known self-cycles and any additional cycles are recorded without being treated as corrupt
  content.
- Unknown payload boundaries or selection rules remain explicit blockers rather than guesses.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 2: Decode, Transport, and Prepare Script Resources

#### Deliverables

- Add typed `PhysicsScript` and `PhysicsScriptTable` models in `holtburger-dat` using proven layouts.
- Expose typed content requests through `holtburger-content`/`holtburger-core` and compact Tauri
  transfer payloads.
- Add typed script and table repositories with shared in-flight preparation, ready/failed state,
  acquired handles, and deterministic release.
- Compile script records into immutable timed prepared commands.
- Enumerate transitive dependencies with visited-set termination while preserving cyclic runtime
  edges.

#### Acceptance Criteria

- Many owners referencing one script/table perform one transfer and preparation per unique asset.
- Entity sources retain IDs/selection facts rather than decoded timelines or table maps.
- Prepared script execution requires no DAT decoding, asset discovery, or frame-time I/O.
- Missing dependencies fail staging with full root/script/hook provenance.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 3: Execute Physics Scripts and Chained Scheduling

#### Deliverables

- Add `PhysicsScriptSystem` with independent per-entity clocks, selected intensity/state,
  generation-safe targets, and deterministic command crossing.
- Feed commands into the existing `HookSystem` and define equal-time ordering across animation,
  scripts, and chained activations.
- Schedule `CallPES` activations without synchronous recursive execution.
- Bound dispatch reentrancy independently of intentionally repeating scheduled scripts.
- Tear down clocks, queued commands, and acquired closures atomically with owner removal.

#### Acceptance Criteria

- Known self-calling scripts repeat according to authored scheduling without infinite synchronous
  recursion.
- Large time steps neither drop nor duplicate timed commands.
- Animation and script clocks remain independently testable and cannot mutate one another.
- Removed/replaced owners cannot receive stale queued commands.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 4: Implement Proven Visual Effect Commands

#### Deliverables

- Implement the visual mutation commands reached by the authored census through narrow generation-
  safe ports.
- Keep timed visibility, translucency, luminosity, diffusion, scale, omega, texture velocity, and
  other proven modifiers as named state rather than a generic transform/property bag.
- Compose visual state through the existing pose/template/render contracts.

#### Acceptance Criteria

- Every proven visual command changes its named runtime consumer and is observable in a fixture.
- Commands perform no resource preparation during dispatch.
- `HookSystem` owns neither visual state nor template/resource lifetime.
- Unsupported visual commands report source asset, record time, and target identity.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 5: Add Authored Particle Fidelity

#### Deliverables

- Prove particle-emitter asset interpretation, spawn timing, attachment/root selection, coordinate
  space, lifetime, material, blend/depth policy, and deterministic cleanup from retail/ACE.
- Add a focused particle asset repository if existing shared content primitives cannot represent the
  required immutable data.
- Add an app-local particle runtime whose mutable emitters/particles follow current entity or part
  transforms without entering `DynamicEntitySystem` ownership.
- Integrate particle visibility and rendering into existing renderer ordering/batching where
  compatible.

#### Acceptance Criteria

- All 17 representative `CreateParticle` events produce attributable visible effects at the correct
  authored roots/parts and times.
- Removing the source owner deterministically removes its emitters and particles according to proven
  lifetime semantics.
- Repeated emitters share immutable assets without sharing mutable particle state.
- Particle rendering preserves transparent ordering and does not fork scene-transform truth.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 6: Add Authored Sound Fidelity

#### Deliverables

- Prove `SoundTweaked` asset lookup, gain/pitch parameters, spatial origin, attenuation, repetition,
  and teardown behavior from retail/ACE.
- Add typed sound content decoding/transport and shared immutable audio asset preparation using
  existing facilities where available.
- Add an app-local audio runtime that consumes prepared sound commands and current source transforms.
- Make unsupported device/format/runtime failures explicit without blocking unrelated visual state.

#### Acceptance Criteria

- All three representative `SoundTweaked` events play the correct prepared sound with proven
  parameters and spatial origin.
- Repeated sounds share immutable decoded assets while retaining independent playback state.
- Owner removal and runtime shutdown stop or release sounds according to proven semantics.
- Audio failure is attributable and does not silently masquerade as successful hook execution.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 7: Activate Script-Only and Combined Authored Residents

#### Deliverables

- Stage complete script/table/effect closures before replacing retained static presentation.
- Atomically promote script-only residents into the shared authored dynamic aggregate.
- Activate animation and scripts independently for combined residents.
- Preserve authored placement, source ownership, template sharing, and conservative bounds.

#### Acceptance Criteria

- No supported setup default-script resident remains inert or deferred.
- Script-only promotion never exposes a missing base presentation while dependencies prepare.
- Combined residents run both clocks without duplicate nodes/resources or coupled advancement.
- Owner eviction removes behavior, effects, queued work, nodes, and leases as one safe operation.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 8: Resteer, Measure, and Clean Up

#### Task Checklist

- [ ] Exercise the DA55/DC58 script-owner workloads and every recorded root script.
- [ ] Measure script advancement, hook dispatch, particle simulation/upload/draw, audio asset/runtime,
      scene propagation, and teardown separately.
- [ ] Confirm prepared resource counts track unique IDs rather than owners.
- [ ] Confirm cyclic scheduling remains bounded in work per tick and observable in diagnostics.
- [ ] Delete script-only deferral, placeholder effect ports, hollow unsupported-success tests, and any
      temporary duplicate effect representation.
- [ ] Update architecture documentation and hand the complete authored behavior model to the spawned-
      entity plan.

#### Acceptance Criteria

- Representative authored scripts, particles, and sounds execute with proven timing and ownership.
- No correctness question is hidden by a no-op consumer or performance shortcut.
- The spawned-entity plan can reuse the landed behavior systems without alternate script/effect
  architecture.
- Formatting, lint, tests, Rust checks, Clippy, and visual/audio harnesses pass.

#### Decisions and Course Corrections

- Pending implementation.

## Verification Strategy

- Exact representative default-script root fixtures and complete transitive closures.
- Four self-calling scripts proving finite preparation and scheduled runtime repetition.
- All 17 `CreateParticle`, five `CallPES`, and three `SoundTweaked` representative events.
- Independent animation/script clocks targeting one entity.
- Equal-time hook ordering and large-delta catch-up.
- Owner removal during preparation, dispatch, live particles, and live audio.
- Many owners sharing prepared scripts/effect assets with independent mutable state.
- Script-only and combined authored promotion.

Tests must use checked-in source-first fixtures. Temporary production-archive probes may establish
evidence but must be removed after results are recorded.

## Risks and Mitigations

### Effect Scope Expands Into a Universal Engine

Implement only behavior reached by the authored census. Add typed consumers per effect family and
reject a generic effect graph, property bag, or event bus without multiple proven producers and
consumers.

### Cyclic Scripts Cause Infinite Preparation or Dispatch

Use visited-set dependency traversal for preparation. Runtime `CallPES` is scheduled work, not
synchronous recursive dispatch; bound per-tick work and report runaway scheduling with provenance.

### Particle or Audio State Pollutes Entity Ownership

Entities retain only typed contributions/handles needed for lifecycle. Particle and audio runtimes
own their mutable instances and receive generation-safe source/transform ports.

### Missing Consumers Are Reported as Success

Every prepared command has an exhaustive dispatch outcome. Unsupported behavior includes asset,
record, target, and reason; production acceptance forbids unsupported commands in the measured
workload.

### Effect Preparation Causes Frame-Time I/O

Stage complete transitive closures and pin their handles before activation. Script advancement and
hook dispatch consume prepared commands only.

### Script-Only Promotion Regresses Existing Static Rendering

Retain current static presentation until every required behavior/effect dependency is ready, then
swap atomically. Failure leaves the valid static presentation visible with diagnostics.

## Definition of Done

- [ ] Every supported setup default physics script/table is decoded, prepared, and scheduled.
- [ ] Intentional script cycles prepare finitely and execute through bounded scheduled repetition.
- [ ] All measured visual, particle, audio, and chained-script commands have real consumers.
- [ ] Script and animation clocks remain independent and deterministic.
- [ ] Script-only and combined authored residents execute without duplicate presentation resources.
- [ ] Effects follow current authored entity/part transforms and clean up with their owners.
- [ ] Immutable behavior/effect assets are shared; mutable runtime state remains per activation.
- [ ] No frame-time DAT decoding, dependency discovery, or asset preparation occurs.
- [ ] Diagnostics distinguish prepared resources, active scripts, queued activations, particles,
      sounds, unsupported commands, and failures.
- [ ] No spawned feed, motion-table resolver, or Explorer host is introduced as scaffolding.
- [ ] All touched code passes repository formatting, linting, tests, Rust checks, and Clippy with
      warnings denied.
- [ ] Architecture documentation describes the authored effects ownership and timing model.

## Open Questions

1. Which physics-script-table keys and intensity rules are exercised by the complete shipped setup
   inventory?
2. What exact equal-time ordering does retail use across animation hooks, physics-script records, and
   chained `CallPES` activation?
3. Which particle asset fields and coordinate-space rules are required by every authored
   `CreateParticle` event?
4. What sound table/asset path, gain/pitch transformation, attenuation, and lifetime semantics does
   retail use for `SoundTweaked`?
5. Which additional hook types appear outside the representative regions, and which belong to static
   authored fidelity versus later spawned gameplay behavior?
