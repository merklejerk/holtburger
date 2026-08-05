# Holtburger 3D Static-Authored Effects Runtime Plan

Status: Queued — convergence Phase 5 resteered; ready for evidence-phase execution after convergence
Created: 2026-07-31
Convergence review: 2026-08-01
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`
Prerequisites:

- `docs/plans/holtburger-3d-static-authored-animation-runtime-plan.md`
- `docs/plans/holtburger-3d-dynamic-entity-architecture-convergence-plan.md`

## Convergence Provenance

| Concern                                                                     | Branch-local status                     | Treatment                              |
| --------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------- |
| Canonical animation/hook foundation                                         | Complete on `3d-next` at `c09eb3c2`     | Preserve                               |
| Claude `TransparentPart` source/effect behavior                             | Complete on `claude` only at `c938a438` | Donor-proven, not canonical completion |
| Typed `TransparentPart` transport                                           | Complete on `3d-next`                   | Convergence Phase 3                    |
| Atomic `SetOmega` / `TransparentPart` playback and rendering                | Complete on `3d-next`                   | Convergence Phase 4                    |
| Remaining scripts, particles, audio, material effects, and structural hooks | Planned                                 | Resteered here by convergence Phase 5  |

No checkbox or phase in this document is complete merely because a donor implementation exists.
Convergence has now removed completed translucency scope and replaced the speculative router with a
measured producer/consumer sequence. This plan remains queued only because the convergence plan is
still active; its Phase 1 is otherwise executable without a new architecture decision.

## Context and Boundaries

### Goal

Complete static-authored behavior fidelity by executing setup default physics scripts and their
proven visual, particle, audio, material, and chained-script effects on the shared authored dynamic
runtime.

### Problem Statement

The representative authored regions contain more setup-default script owners than animation owners.
Leaving those scripts inert omits ambient particles, sound, and visual behavior even after rigid-part
animation works. The animation plan deliberately preserves script identity and static presentation
but does not decode, schedule, or execute physics scripts.

This plan adds the second timed behavior producer and real effect consumers. It reuses the entity,
template, animation, effect, resource-lifetime, and renderer architecture established by the
animation and convergence plans; it does not create an effects-specific entity runtime or pull
spawned-entity infrastructure forward.

### In Scope

- Typed `PhysicsScript` and `PhysicsScriptTable` DAT decoding and compact content transport.
- Shared prepared script/table repositories and transitive dependency closure.
- Deterministic per-entity physics-script clocks, type/intensity table selection, and `CallPES`.
- Safe preparation and runtime execution of intentional cyclic script graphs.
- Expansion of one prepared behavior-command union only for static-authored behavior proven by
  archive and reference evidence.
- Concrete visual mutation consumers required by authored scripts.
- Animation-time `ReplaceObjectHook` execution with pre-staged shared replacement-part resources,
  atomic per-entity part selection, and replacement-aware conservative bounds.
- Concrete particle playback/rendering for the proven `CreateParticle` workload.
- Concrete sound asset/playback behavior for the proven `SoundTweaked` workload.
- Atomic promotion of script-only authored residents after their complete behavior closure is ready.
- Combined animation and script clocks on the same entity without merging their ownership.

### Out of Scope

- Spawned/server entities, explorer drivers, entity feeds, motion tables, sparse anchors, or runtime
  reconciliation.
- General-purpose particle authoring tools, audio middleware, environmental mixing, or a universal
  effect graph.
- Implementing unused hook types merely because they exist in the DAT format.
- Silently approximating unknown hook payloads, timing, asset lookup, attenuation, or attachment
  semantics.
- Lighting work until an authored setup-default producer reaches a light command; the complete current
  archive census finds none in setup-default animation or script closure.
- Moving script, audio, or particle resource ownership into `EffectSystem`, or embedding decoded
  timelines in entity source records.
- Network-triggered physics scripts, combat effects, projectiles, or gameplay authority.
- Entity-to-entity attachment mutation and animated parent-part following; those enter with the
  spawned lifecycle consumer in the spawned-entity plan. Particle/effect attachment to an authored
  root or part remains in scope here.

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
  - `ReplaceObjectHook` and `CPartArray` object-description mutation paths: timed part replacement
    selects a new part visual without replacing entity identity.
- `ACE/Source/ACE.DatLoader/FileTypes/PhysicsScript.cs`
- `ACE/Source/ACE.DatLoader/FileTypes/PhysicsScriptTable.cs`
- `ACE/Source/ACE.DatLoader/Entity/AnimationHooks/*`
- `ACViewer/ACViewer/Physics/PhysicsObj.cs:680-710`

### Existing Code to Extend

- The authored entity/template/animation/effect systems landed by the prerequisite animation and
  convergence plans.
- `crates/holtburger-core/src/content_assets.rs`
- `apps/holtburger-3d/src-tauri/src/lib.rs` compact binary content adapter patterns.
- Existing texture, geometry, transparent ordering, and frame-stream infrastructure for particle
  rendering where their contracts are genuinely reusable.
- No app-local particle or audio runtime currently exists. Phase 1 must inventory reusable
  renderer/content primitives, then later phases add focused owners instead of pretending a dormant
  facility is available.

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

The 2026-08-01 convergence dry-run revalidated and widened that evidence against the current ignored
`dats/assets.hba` without retaining an asset-dependent test:

| Producer scope                    | Hook type         | Count | Named consumer                                       |
| --------------------------------- | ----------------- | ----: | ---------------------------------------------------- |
| All setup-default script closures | `SoundTable`      |    49 | Audio runtime + prepared sound-table lookup          |
| All setup-default script closures | `Scale`           |    43 | `EffectSystem` scale state + dynamic publication     |
| All setup-default script closures | `CreateParticle`  | 7,753 | Particle runtime/renderer                            |
| All setup-default script closures | `CallPES`         |   352 | `PhysicsScriptSystem` scheduled activation           |
| All setup-default script closures | `SoundTweaked`    |   319 | Audio runtime                                        |
| All setup-default script closures | `TextureVelocity` |    11 | `EffectSystem` material state + renderer UV sampling |
| All setup-default animations      | `SoundTable`      |     4 | Audio runtime + prepared sound-table lookup          |
| All setup-default animations      | `TransparentPart` |    12 | Complete in convergence Phase 4                      |
| All setup-default animations      | `SoundTweaked`    |    14 | Audio runtime                                        |
| All setup-default animations      | `SetOmega`        |     8 | Complete in convergence Phase 4                      |

The complete archive contains 2,161 setups with direct default scripts. Their `CallPES` closure
reaches 2,190 scripts and includes the four representative self-cycles plus many additional shipped
self-cycles. Six setup default-script tables are present (`0x34000005`, `0x340000A5`, `0x340000BA`,
`0x340000BF`, `0x340000C7`, and `0x340000CE`), so table decoding remains real broader-content work
despite its absence from DA55/DC58.

The complete animation census found only two `ReplaceObjectHook` records, both on animation
`0x0300055B` frame 0: forward replaces part 1 with GfxObj `0x01000BB4`, and backward replaces part 1
with `0x01000BB5`. This is now the selected structural fixture. Replacement remains an explicit
product requirement even though it is not in the setup-default animation subset.

A 2026-08-05 census pinned the `TextureVelocity` mechanism's retail semantics before Phase 4
designs its state: retail keeps one global accumulator per GfxObj DataID
(`CPhysics::texture_velocity_gids`; registration dedupes by DataID with last-writer-wins rates in
`CPhysics::AddGfxVelocity`, acclient.c:300196), advances it per frame
(`CPhysics::UpdateTexVelocity`, acclient.c:299999), and writes the accumulated offset onto the
shared cached `CGfxObj` mesh — so every rendered instance of a DataID scrolls in phase,
regardless of when each object's script activated. `TextureVelocityHook::Execute` and the sky's
direct `GameSky::MakeObject` path are the registry's two writer kinds; the census found the hook
writers are exclusively physics scripts (11 scripts, whole-object, rates such as `(0.03, 0.03)`)
with zero occurrences in all 2,066 portal animations and zero `TextureVelocityPart` hooks
anywhere. The phase-sharing is plausibly deliberate seam synchronization for tiled flowing
surfaces (waterfalls): per-entity scroll clocks started at different script-activation times
would visibly tear at seams between instances of the same GfxObj.

Our model reproduces that seam synchronization without retail's mutable registry: scroll phase is
derived, not accumulated — `phase = fract(rate × sharedClock)`. Any two draws with the same rate
are in lockstep by arithmetic identity, which covers all instances of a GfxObj because they share
one authored rate; the rate itself is a static material fact carried by content identity, so no
GfxObj threading and no per-frame mutable state exist anywhere. Absolute phase origin differs
from retail (accumulators start at first hook activation) but is unobservable for a looping
scroll — only relative phase between same-texture instances is visible, and that is identical.
The model's one precondition: derivation assumes each scrolling texture's rate is constant for
the session (`fract(r × t)` equals `fract(∫r dt)` only for constant `r`; a mid-session rate
change would retroactively rescale all elapsed time and visibly snap the texture). Phase 1
verifies this against the 11 scripts. If a rate change is ever proven, the escape hatch is a
lazily written phase bias at the change event (`phase = fract(newRate × (t − T) + phaseAtT)`) —
still no per-frame mutation — and it is not built until then. Derive `fract` in f64 CPU-side (or
wrap the clock) before values reach f32 uniforms; `rate × t` degrades in f32 over multi-hour
sessions. The sky pass plan derives from the same shared clock and owns no scroll state either.

No setup-default script closure or setup-default animation emits a lighting hook. Lighting is
therefore removed from this executable roadmap instead of receiving a speculative state field,
system, or phase. The archive-wide animation vocabulary contains other gameplay-oriented hooks, but
those remain outside this static-authored scope until a selected producer needs them.

## North Stars

1. Implement measured authored effects before generic effect infrastructure.
2. Animation and physics scripts are independent clocks that dispatch the same prepared behavior
   command shape.
3. `EffectSystem` owns persistent implemented visual/material state only. A focused
   `BehaviorEventRouter` enters with `PhysicsScriptSystem`, when animation and scripts become two real
   producers targeting effect, particle, audio, structural, and chained-script consumers.
4. Preparation discovers and pins the complete transitive dependency closure before activation.
5. Cyclic dependency graphs are valid authored content; preparation termination and runtime
   repetition are separate concerns.
6. Effect instances follow current authored entity/part transforms published by
   `DynamicEntitySystem`; no standalone pose owner returns.
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
  -> prepared behavior commands
  -> BehaviorEventRouter (introduced with the second producer and real consumers)
       |- persistent visual/material commands -> EffectSystem
       |- ReplaceObject -> per-entity part selection + conservative bound
       |- CreateParticle -> particle runtime -> renderer
       |- SoundTable / SoundTweaked -> audio runtime
       `- CallPES -> scheduled script activation
```

Animation and script producers may target the same entity, but neither advances or owns the other's
clock. Animation-time replacement commands enter this same dispatch boundary after their immutable
part dependencies are staged. Equal-time ordering, reentrancy, teardown, and generation checks are
explicit. The router validates a generation-safe target, performs ordered synchronous dispatch, and
records one exhaustive outcome per command; it owns no clocks, queues, effect state, or resources.

### Convergence Debt Ledger

| Landed seam or debt                                                     | Why it is honest now                                           | Scheduled replacement                                                                           |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `EffectSystem.executeDepartedFrames` accepts animation-specific records | Animation is still the only live producer                      | Phase 2 compiles one prepared command union; Phase 3 introduces the router and adapts animation |
| `PartRenderState` contains only translucency                            | It has one real consumer and no speculative fields             | Phase 4 widens it only for proven scale/UV presentation facts                                   |
| `ReplaceObjectHook` blocks animated activation                          | No replacement resources or bounds are prepared                | Phase 4 stages the two selected GfxObj variants and adds atomic structural dispatch             |
| Script-only authored residents retain static presentation               | No script clock or effect closure exists                       | Phase 7 promotes them only after complete staged readiness                                      |
| Particle and audio consumers are absent                                 | The app has no existing focused runtimes to reuse              | Phases 5 and 6 add named owners after Phase 1 evidence                                          |
| Repository-wide Prettier has untouched baseline failures                | Convergence formats every touched file without unrelated churn | Convergence Phase 8, before this plan executes implementation                                   |

None of these debts requires a second entity runtime or blocks the spawned architecture design. The
first four are explicit implementation prerequisites before spawned entities may consume authored
behavior systems.

## Phased Implementation

### Phase 1: Complete the Authored Script and Hook Evidence

Progress: Not started — archive census complete; retail timing/selection evidence remains

#### Deliverables

- Reproduce the recorded DA55/DC58 root IDs and transitive dependencies as checked-in, source-first
  fixtures; the archive-wide counts above are evidence, not runtime-asset test dependencies.
- Prove record timing units, table keys/intensity selection, `CallPES` delay/repetition behavior, and
  equal-time command ordering from retail/ACE.
- Inventory reusable audio, particle, material-animation, and asset-decoding code before designing
  consumers; the convergence search found no existing app-local runtime for those families.
- Prove the exact payload, dependency, coordinate/target, and lifetime semantics for the six unmet
  hook types in the measured table above plus the selected `ReplaceObjectHook` example.
- Verify the derived-phase precondition: map the 11 `TextureVelocity` scripts to their referencing
  setups and confirm no GfxObj DataID is authored two different scroll rates. A single
  counterexample activates the phase-bias escape hatch in Phase 4; none is expected.
- Decide from retail whether commands crossed during deterministic initial-phase replay are folded as
  persistent state, emitted as ephemeral effects, or deliberately skipped per command family.

#### Acceptance Criteria

- Every implementation phase is backed by exact asset IDs, record shapes, and reference paths; the
  selected replacement fixture is `0x0300055B` part 1 / GfxObjs `0x01000BB4` and `0x01000BB5`.
- The four known self-cycles and any additional cycles are recorded without being treated as corrupt
  content.
- Unknown payload boundaries or selection rules remain explicit blockers rather than guesses.

#### Decisions and Course Corrections

- **Convergence evidence:** The disposable full-archive script and animation census recorded above
  decoded through the existing closed hook parser and was removed after execution. It confirms that
  the next work is evidence completion, not another vocabulary or architecture discovery pass.
- **Scope correction:** Lighting is absent from the measured setup-default producer closure and is
  removed. `SoundTable`, `Scale`, and `TextureVelocity` are now explicit because the wider census
  proves they are real; the old representative-only summary hid them.

### Phase 2: Decode, Transport, and Prepare Script Resources

Progress: Not started

#### Deliverables

- Add typed `PhysicsScript` and `PhysicsScriptTable` models in `holtburger-dat` using proven layouts.
- Expose typed content requests through `holtburger-content`/`holtburger-core` and compact Tauri
  transfer payloads.
- Add typed script and table repositories with shared in-flight preparation, ready/failed state,
  acquired handles, and deterministic release.
- Compile script and animation records into one immutable `PreparedBehaviorCommand` semantic union
  carrying target-relative values and source provenance, not producer-specific transport wrappers.
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

Progress: Not started

#### Deliverables

- Add `PhysicsScriptSystem` with independent per-entity clocks, selected intensity/state,
  generation-safe targets, and deterministic command crossing.
- Introduce `BehaviorEventRouter` at the first real multi-producer/multi-consumer cut. Adapt animation
  dispatch and script dispatch to its generation-safe synchronous command port without moving either
  producer's clock into the router.
- Implement the retail-proven equal-time producer order in the runtime tick and preserve authored
  order within each producer; the router records but does not invent temporal order.
- Schedule `CallPES` activations without synchronous recursive execution.
- Bound dispatch reentrancy independently of intentionally repeating scheduled scripts.
- Tear down clocks, queued commands, and acquired closures atomically with owner removal.

#### Acceptance Criteria

- Known self-calling scripts repeat according to authored scheduling without infinite synchronous
  recursion.
- Large time steps neither drop nor duplicate timed commands.
- Animation and script clocks remain independently testable and cannot mutate one another.
- Removed/replaced owners cannot receive stale queued commands.
- Every dispatched command records exactly one executed, folded, deferred, or rejected outcome with
  producer asset, authored position/time, target identity, and generation.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 4: Implement Proven Visual Effect Commands

Progress: Not started

#### Deliverables

- Implement measured `Scale` and `TextureVelocity` commands through narrow generation-safe ports.
  Preserve landed `SetOmega` and `TransparentPart` behavior while adapting their dispatch boundary.
- `TextureVelocity` uses the derived-phase model recorded in Measured Workload: the hook sets a
  static scroll rate on the content-identity material fact, and the renderer derives
  `phase = fract(rate × sharedClock)` at draw time. No scroll registry, no accumulator, and no
  per-entity scroll clock exist; seam synchronization across instances follows from shared rates
  and the shared clock. The phase-bias escape hatch is built only if Phase 1's constant-rate
  verification fails.
- Widen `EffectState`, `EffectPresentationSample`, and `PartRenderState` only with the exact scale or
  UV facts consumed in this phase; do not add luminosity, diffuse, lighting, or generic property bags.
- Implement `ReplaceObjectHook` as a named structural visual command. Prepare and lease every
  referenced replacement part before activation, switch one entity's part selection atomically at
  dispatch, and update its conservative bound without mutating shared base templates.
- Compose visual state through existing animation/template/dynamic-publication/render contracts.

#### Acceptance Criteria

- Every proven visual command changes its named runtime consumer and is observable in a fixture.
- Commands perform no resource preparation during dispatch.
- Repeated replacement parts share immutable geometry/material resources while each entity retains
  independent current part selection.
- Replacement cannot expose missing geometry, stale bounds, or a partially switched material set.
- `BehaviorEventRouter` owns neither visual state nor template/resource lifetime; `EffectSystem` retains
  implemented visual state behind a narrow consumer port.
- Unsupported visual commands report source asset, record time, and target identity.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 5: Add Authored Particle Fidelity

Progress: Not started

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

Progress: Not started

#### Deliverables

- Prove `SoundTable` selection and `SoundTweaked` asset lookup,
  priority/probability/volume, spatial origin, attenuation, repetition, and teardown behavior from
  retail/ACE.
- Add typed sound content decoding/transport and shared immutable audio asset preparation using
  existing facilities where available.
- Add an app-local audio runtime that consumes prepared sound commands and current source transforms.
- Make unsupported device/format/runtime failures explicit without blocking unrelated visual state.

#### Acceptance Criteria

- All representative and selected fixture `SoundTable` / `SoundTweaked` events play the correct
  prepared sound with proven parameters and spatial origin.
- Repeated sounds share immutable decoded assets while retaining independent playback state.
- Owner removal and runtime shutdown stop or release sounds according to proven semantics.
- Audio failure is attributable and does not silently masquerade as successful hook execution.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 7: Activate Script-Only and Combined Authored Residents

Progress: Not started

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

Progress: Not started

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
- All 17 `CreateParticle`, five `CallPES`, and three `SoundTweaked` representative events, plus
  selected `SoundTable`, `Scale`, and `TextureVelocity` fixtures from the wider census.
- Independent animation/script clocks targeting one entity.
- Equal-time hook ordering and large-delta catch-up.
- Owner removal during preparation, dispatch, live particles, and live audio.
- Many owners sharing prepared scripts/effect assets with independent mutable state.
- Script-only and combined authored promotion.

Tests must use checked-in source-first fixtures. Temporary production-archive probes may establish
evidence but must be removed after results are recorded.

## Risks and Mitigations

### Effect Scope Expands Into a Universal Engine

Implement only behavior reached by the representative evidence set plus the explicitly required
`ReplaceObjectHook`. Add typed consumers per effect family and reject a generic effect graph,
property bag, or event bus without multiple proven producers and consumers.

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
- [ ] Animation-time `ReplaceObjectHook` has an atomic, replacement-bound-aware consumer distinct
      from appearance-time `ObjDesc.anim_part_changes`.
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

1. Which of the six censused physics-script tables is the smallest fixture that still proves keys,
   modifier selection, fallback, and dependency closure?
2. What exact equal-time ordering does retail use across animation hooks, physics-script records, and
   chained `CallPES` activation?
3. Which particle asset fields and coordinate-space rules are required by every authored
   `CreateParticle` event?
4. What sound-table/asset path, priority, probability, volume, attenuation, and lifetime semantics
   does retail use for `SoundTable` and `SoundTweaked`?
5. Which persistent commands fold into deterministic initial state, and which ephemeral audio or
   particle commands retail suppresses or emits when a static object starts at an independent phase?
