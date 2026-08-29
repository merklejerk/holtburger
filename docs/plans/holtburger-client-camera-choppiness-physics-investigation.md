# Holtburger Client Camera Choppiness and Physics Population Implementation Plan

Status: **Complete (2026-08-29). Phases 6 through 8 were rejected by Gate A measurement.**

This document records evidence gathered from the local ACE client scenario where the third-person
camera becomes severely choppy after the scene settles. It is a working investigation handoff, not
an implementation decision. Temporary timing probes and passive-census modifications used to gather
the evidence are removed before handoff; the general passive probe mode is retained as diagnostic
infrastructure.

## Context and Boundaries

### Goal

Identify and independently correct the body-admission, solver-liveness, and per-tick proportionality
defects that starve client camera publication in entity-dense housing scenes.

### In scope

- Reproduce the symptom without relocating or driving the user-positioned character.
- Preserve the distinction between camera input, camera solving, camera publication, and rendering.
- Census which bodies are physically prepared, actively scheduled, sleeping, and pose-only.
- Prove why quiescent bodies remain active.
- Determine the correct positive contract for local solver participation from ACE, retail client
  behavior, wire facts, and the shipped catalog.
- Measure whole-population work in dynamic collection preparation separately from mover-only work.
- Evaluate whether the existing dynamic spatial index should be retained and incrementally updated.
- Keep sleeping collision targets available without treating them as movers.
- Use temporary diagnostics and focused harness additions where they answer a named question.

### Out of scope

- Camera smoothing, interpolation, input sensitivity, or renderer-side masking of delayed host data.
- Raising the fixed-tick interval or lowering camera publication frequency to conceal the workload.
- Hard-coding the observed housing WCIDs as a production exclusion list.
- Disabling all remote collision or physical preparation without proving the required interaction
  cohort.
- Worker-thread physics, ECS migration, object pools, or another broad engine rewrite before the
  three demonstrated defects are isolated.
- Teleporting, driving, or otherwise moving the character currently positioned by the user.
- Treating ACE server behavior as retail-client proof where the retail decompile can answer the
  client-side question.

## North Stars

1. Authoritative entity pose and presentation survive independently of local collision or
   integration demand.
2. A producer computes local physical demand once from facts it owns; content preparation, state
   transitions, indexing, and scheduling consume that value without reinterpreting raw flags.
3. Collision-target membership, integration eligibility, and solver-owned activity remain three
   orthogonal decisions.
4. Housing hooks fall out of the ordinary contract because of their facts, never because of WCID,
   name, or `WeenieType` exceptions.
5. Correct population and liveness precede optimization. Later work must be authorized by a fresh
   profile rather than by the aesthetic appeal of an incremental index.
6. Every asynchronous physical-body completion is guarded by entity generation, immutable
   definition facts, and exact producer demand; do not add a second demand-revision truth.
7. Camera responsiveness is accepted only alongside lower host work; publication reordering may
   improve resilience but cannot substitute for correcting simulation.
8. Use clean cutovers. Delete binary-intent and solver-participation vocabulary that becomes false;
   do not preserve it through aliases or compatibility adapters.

## Current Reproduction Guardrails

- The user manually positioned the character in a housing scene that exhibits the problem.
- **Do not teleport or drive the character.** The original, stronger location was lost during an
  earlier diagnostic teleport. Preserve the current scene for controlled comparisons.
- The local test server uses its default address and credentials from
  `apps/holtburger-3d/.dev.env`. Credentials must remain environment-only and must not appear in
  commands recorded in this document, logs, screenshots, or generated artifacts.
- The ordinary live-client probe performs movement in its default `drive` mode. Do not run that
  mode against this character. `HOLTBURGER_PROBE_MODE=passive` starts the client, logs in, requests
  current state, starts the camera, observes, and disconnects without chat or drive replacement.
- Passive mode rejects teleport and teleport-sequence options before starting the host. Every live
  capture in this worksheet reported `teleport: null` and an empty `drivePhases` array.
- Serialize live logins and respect the existing ACE session cooldown.

## Symptom Boundary

### User-visible behavior

- After the 3D scene settles, camera rotation becomes severely choppy and in the stronger original
  location appeared unresponsive.
- The overhead-map cone of view continues to update, proving that at least some camera/input state
  remains live.
- In the current location the camera is not binary-stuck. A test that checks only whether it moved
  produces a false pass.
- CPU usage rises materially in the affected scene.

### Proven camera behavior

A gradual trusted CDP drag was used so the renderer received the same pointer path as ordinary
physical interaction without changing the character's world position.

- WebGL camera position and view-matrix values changed during the gesture.
- Screenshots confirmed that the rendered view rotated.
- Renderer `requestAnimationFrame` cadence was usually approximately `6.9-7.0 ms` on the 144 Hz
  display, but contained long stalls.
- Rendered camera-update latency had a measured p95 of approximately `39.7 ms`.
- Host camera-tick delivery had a measured p95 of approximately `60.3 ms` and a maximum of
  approximately `302.8 ms`.
- The host camera solver itself averaged approximately `0.16 ms` per fixed tick.

Conclusion: camera input, camera solving, IPC, and WebGL application all work. Camera publication is
a downstream victim of host fixed-tick work; this is not evidence for a camera-controller defect.

## Performance Evidence

The steady capture before the later housing census contained approximately 455 projected entities
and 262 scheduled movers.

### Process CPU

| Process              | Approximate CPU |
| -------------------- | --------------: |
| `holtburger-3d-host` |            154% |
| Electron renderer    |             40% |
| Electron main        |             10% |

The host is the dominant source and exceeds one logical core.

### Host fixed-tick phases

| Phase                                            | Approximate time per fixed tick |
| ------------------------------------------------ | ------------------------------: |
| Complete fixed tick                              |                  `27.8-28.1 ms` |
| Simulation                                       |                  `22.3-22.4 ms` |
| Before/after full dynamic-entity view projection |                    `2.8-2.9 ms` |
| Pre-dynamic work                                 |                       `~2.2 ms` |
| Camera solver                                    |                      `~0.16 ms` |

### Simulation phases

| Phase                               | Approximate time per fixed tick |
| ----------------------------------- | ------------------------------: |
| `prepare_dynamic_entity_collection` |                `19.25-19.42 ms` |
| Prepared-body commit                |                  `1.89-1.92 ms` |
| Collection finish                   |                `0.036-0.037 ms` |
| Average prepared movers             |                          `~262` |

The fixed-tick transaction reaches camera work only after simulation and dynamic view publication.
Near-budget simulation therefore delays camera paths even though camera calculation is cheap.

These timings are workload evidence, not permanent budgets. Any comparison must record entity
population, physical participant count, scheduled mover count, build profile, scene, and observation
window.

## Passive Housing Census

A later passive, headless-sidecar run observed the user-positioned worse location without teleport,
chat, or drive input. At the census point it contained 478 live entities and 457 scheduled movers.

| WCID/class          | Name                    | Count | Live physics state |
| ------------------- | ----------------------- | ----: | -----------------: |
| 9686 / Hook         | Wall Hook               |   245 |       `0x00000014` |
| 11697 / Hook        | Floor Hook              |   128 |       `0x00000014` |
| 11698 / Hook        | Ceiling Hook            |    34 |       `0x00000014` |
| 12679 / Hook        | Yard Hook               |    16 |       `0x00000014` |
| 9687 / Storage      | Storage                 |     8 |       `0x00000418` |
| 9697-9704 / housing | Cottage                 |     8 |       `0x00000034` |
| 11711 / SlumLord    | Cottage                 |     8 |       `0x00000414` |
| 12628 / housing     | Mosswart Place Cottages |     1 |       `0x00000418` |
| 412                 | Door                    |     8 |       `0x00010008` |
| 1                   | Local player            |     1 |       `0x00400408` |

Derived counts:

- Literal hooks: 423 of 457 movers, or approximately **92.6%**.
- Hooks plus storage and cottage/housing objects: 448 of 457 movers, or approximately **98.0%**.
- Only 21 of the 478 live entities were not in the captured mover schedule.

The earlier 262-mover scene and later 457-mover scene differ because the user moved to a denser
reproduction position. They support the same population diagnosis and must not be combined as if
they were one simultaneous measurement.

### Durable passive late-steady capture

A 12-second release-sidecar capture with the durable passive mode saw 458 projected entities and
457 physical bodies. The player moved only `0.000681 m`, consistent with sub-millimetre network or
floating-point reconciliation noise. It received 402 camera events and requested no character
motion.

The population did partially settle: 457 initial movers fell to 276. At both tick 150 and tick 300,
the entire remaining cohort was:

|  WCID | Name         | Count | Contact    | Response                   | Retained vectors | Reconciliation |
| ----: | ------------ | ----: | ---------- | -------------------------- | ---------------- | -------------- |
|  9686 | Wall Hook    |   242 | `Airborne` | grounded-response/airborne | all zero         | none           |
| 11698 | Ceiling Hook |    34 | `Airborne` | grounded-response/airborne | all zero         | none           |

The 128 floor hooks, 16 yard hooks, and 17 ordinary non-hook bodies did settle. This is an exact
live discriminator: wall/ceiling fixtures have no walkable support, while floor/yard fixtures can
acquire it. All 276 late movers otherwise satisfy the observable no-work conditions.

### Preparation subphase profile

Temporary clocks split 400 collection preparations. Over the final 200 release ticks:

| Preparation stage       |           Mean |            p50 |            p95 |
| ----------------------- | -------------: | -------------: | -------------: |
| Dynamic population scan |     `0.019 ms` |     `0.018 ms` |     `0.026 ms` |
| Placement refresh       |     `0.183 ms` |     `0.178 ms` |     `0.240 ms` |
| Shadow-index compile    |     `0.031 ms` |     `0.030 ms` |     `0.039 ms` |
| Schedule selection      |     `0.016 ms` |     `0.015 ms` |     `0.021 ms` |
| Participant clone       |     `0.139 ms` |     `0.137 ms` |     `0.173 ms` |
| Environment solve       |     `2.796 ms` |     `2.811 ms` |     `3.124 ms` |
| Peer resolution         |     `0.056 ms` |     `0.055 ms` |     `0.076 ms` |
| Finalization            |     `0.070 ms` |     `0.071 ms` |     `0.085 ms` |
| **Total preparation**   | **`3.313 ms`** | **`3.325 ms`** | **`3.679 ms`** |

Environment solving is 84% of late preparation in this location. The current dynamic spatial
index is effective enough that peer resolution is only 1.7%; rebuilding it and cloning participants
together cost approximately 5.1%. Those are real non-proportional operations, but they are not the
immediate hotspot at this population. The earlier approximately 19 ms environment-heavy capture
was in a different, geometrically worse position and remains evidence that static-scene complexity
changes per-mover cost materially.

### Controlled causal counterfactual

A temporary investigation-only switch omitted exactly the four observed hook WCIDs from remote
physical preparation, without suppressing their authoritative entities or rendering. The same
12-second passive capture still saw 458 entities and 402 camera events. It installed 34 physical
bodies; all 34 were settled by ticks 150 and 300.

| Late collection measurement | Baseline hooks admitted | Hook physics omitted |
| --------------------------- | ----------------------: | -------------------: |
| Physical participants       |                     457 |                   34 |
| Scheduled movers            |                     276 |                    0 |
| Mean preparation            |              `3.313 ms` |           `0.083 ms` |
| p95 preparation             |              `3.679 ms` |           `0.104 ms` |
| Mean environment solve      |              `2.796 ms` |          `<0.001 ms` |

The approximately 40x preparation reduction proves the hook cohort is causal, not merely
correlated. The WCID switch is not a candidate fix and was removed after measurement.

### Catalog corroboration

`weenie_motion_facts` was run against the shipped catalog and DAT content for WCIDs 9686, 9687,
11697, 11698, 11711, and 12679.

For the four hook templates:

- `weenie_type` is 56 (`WeenieType::Hook`).
- Catalog physics is exactly `0x00000014`.
- `0x14` is `ETHEREAL | IGNORE_COLLISIONS`.
- Gravity is explicitly false.
- The `STATIC` and `FROZEN` bits are absent.
- There is no motion table.
- The setup declares no default animation or default physics script.

The live state therefore matches authored catalog state. No evidence currently supports a wire
decoder or physics-mask replacement bug for these hooks.

A whole-catalog temporary census scanned 43,913 templates. Every record names a setup and all
43,913 pass today's `supports_local_simulation` and scheduling-eligibility tests. That is decisive
evidence that those tests describe implementation support, not positive runtime demand.

- 7,835 eligible templates have no gravity.
- 29,739 have suppressed dynamic-target participation.
- 6,654 are inert-shaped in catalog data: no gravity, suppressed target participation, no missile
  state, no template/setup motion table, no setup default animation, and no default script.
- The inert-shaped cohort includes all 5 Hook templates, 6,274 House templates, 187 Generic
  templates, and 92 Switch templates. It also includes traps and projectile-spell templates whose
  runtime behavior can be activated by messages, proving that a catalog-only negative predicate is
  not a safe final role decision.
- Storage WCID 9687 differs materially: it has physics `0x418`, gravity, reporting, and motion table
  `0x09000004`; it correctly joined the initial cohort and then slept.

## Three Independent Defects

Do not merge these into one fix or allow an improvement in one to hide another.

### A. Physical admission lacks positive body intent

`client_remote_body_requires_preparation` admits every non-player entity that is unattached, has a
WCID and setup, has an authoritative pose body, and whose effective physics state is locally
supported. It does not ask whether the entity can move, needs environment response, needs peer
response, or lies in the local physical-interest cohort.

Relevant code:

- `crates/holtburger-core/src/client/collision.rs::remote_body_targets`
- `crates/holtburger-core/src/client/collision.rs::client_remote_body_requires_preparation`
- `crates/holtburger-world/src/entity_physics.rs::EffectiveEntityPhysicsState::supports_local_simulation`
- `crates/holtburger-world/src/entity_physics.rs::resolve_effective_entity_physics_state`

The state resolver classifies every known state without `STATIC` or `FROZEN` as scheduling-eligible.
That is a capability statement being used as positive evidence of current integration work.

`ACTIVE_SOLVE_RADIUS_M = 96.0` in `crates/holtburger-core/src/client/simulation.rs` applies to
pose-only remote projection selection. It does not constrain remote physical-body preparation.
Consequently the physical demand map covers every received eligible entity.

The clean direction is not a hook exclusion list. The producer needs an honest positive contract
for at least these independently consumed roles:

- authoritative pose/presentation only;
- retained collision target without current integration work; and
- active local mover requiring integration.

The selected design is one composite producer demand plus separate solver activity. The current
`EntityPhysicalIntent::{PoseOnly, Simulated}` distinction does not express a sleeping collision
target as a first-class producer choice.

### B. Quiescence is restricted to grounded support

Every newly prepared dynamic body starts `DynamicBodyActivity::Active`. Dynamic entity preparation
also creates a `PhysicalBodyDefinition::Grounded` body for every supported entity setup, selecting
gravity `-9.8` or `0.0` from the effective state.

`accepted_dynamic_tick_is_stable` permits transition to `Settled` only when all of the following
hold:

- actuation contains no controller, launch, or flight work;
- no residual contacts remain;
- the solve completed;
- `body.contact == ContactState::Grounded`;
- retained velocity, acceleration, and omega are exactly zero;
- response state did not change;
- response is `GroundState::Supported`;
- every accepted path leg ends at the initial point.

Hooks with no authored motion correctly receive coasting actuation, so actuation itself permits
settling. The universal support requirement is the blocker: a zero-gravity wall or ceiling hook
starts airborne and has no reason to acquire walkable support. Failed stability writes `Active`
again after every accepted tick.

This is independently wrong even if body admission remains broad. An accidentally admitted,
quiescent body should finish its initialization work and sleep. Rest must be defined by absence of
pending motion/reconciliation/contact work; ground-support proof is one gravity-dependent retained
fact and wake condition, not the universal definition of rest.

Relevant code:

- `crates/holtburger-world/src/spatial/physical_body.rs::PhysicalBodyState::new_dynamic`
- `crates/holtburger-world/src/spatial/physical_body.rs::initial_response`
- `crates/holtburger-world/src/spatial/physical_body.rs::PhysicalBodyActuation::permits_dynamic_settling`
- `crates/holtburger-world/src/spatial/scene.rs::accepted_dynamic_tick_is_stable`
- `crates/holtburger-world/src/spatial/scene.rs::prepare_physical_body_commit`
- `crates/holtburger-core/src/client/simulation.rs::remote_entity_actuation`

### C. Dynamic collection cost is whole-population, but its measured terms have different priority

`prepare_dynamic_entity_collection` performs the following each fixed tick:

1. Collects and sorts every dynamic body ID.
2. Refreshes placement for every dynamic body.
3. Recompiles `DynamicShadowIndex` from the body population.
4. Clones every dynamic `SpatialBody` into a `BTreeMap` of immutable epoch participants.
5. Computes an environment plan for every scheduled mover.
6. Resolves directional dynamic contacts for every trajectory.
7. Builds and later commits the prepared epoch.

Sleeping currently removes a body from ordinary environment and peer-mover solving, but it does not
remove that body from placement refresh, the population scan, or participant cloning. A correct
sleep fix therefore reduces the largest solve term but does not make the collection proportional by
itself.

The project already has a cell-based broad phase:
`crates/holtburger-world/src/spatial/dynamic_index.rs::DynamicShadowIndex`. It is rebuilt on every
epoch. `ETHEREAL | IGNORE_COLLISIONS` maps hook target participation to `Suppressed`, so hooks are
already skipped as peer targets by index compilation. A second index would not eliminate their
environment solves or epoch cloning.

Candidate structural direction after admission and liveness are corrected:

- retain index membership across ticks and update only bodies whose target bounds or spatial
  membership changed;
- keep sleeping bodies indexed as collision targets where their policy requires it;
- capture compact peer-query facts rather than cloning complete mutable bodies;
- refresh placement only after a pose/topology/residency change or a stale support proof;
- preserve one immutable directional-contact epoch without rebuilding facts whose revision did not
  change.

Do not promote incremental indexing until post-admission/post-sleep profiling proves it remains
material. The current release split shows environment solves dominate; index compilation and
participant cloning are structurally non-proportional but together cost only about `0.170 ms` at 457
participants. Admission and quiescence deserve the first cutover and reprofile.

## Target Implementation Architecture

The runtime facts support three orthogonal roles rather than a Hook rule or one binary
`PhysicalBodyParticipation` flag:

| Role              | Owner input                                                                                                     | Consumer                                | Example                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------- |
| Pose/presentation | received authoritative entity                                                                                   | renderer, radar, selection, attachments | every world entity               |
| Dynamic target    | effective target/report policy plus prepared geometry                                                           | peer broad phase and narrow phase       | stationary door/storage          |
| Integrated mover  | gravity or current runtime work: retained vectors, authored root motion, reconciliation, projectile/launch work | environment and peer solve              | player, moving creature, missile |

Target membership and mover activity must remain independent. A settled solid body stays indexed as
a target. A suppressed, zero-gravity body with no runtime work needs neither target geometry nor an
environment solve. A later state/vector/motion update can change the producer demand and wake or
prepare that body without encoding its WCID or display name.

The existing `EntityPhysicalIntent::{PoseOnly, Simulated}` is used by Explorer spawn/replacement and
physics-state transitions, but the live-client remote-body coordinator does not consume it. The
client instead installs a full dynamic physical body for every result of
`client_remote_body_requires_preparation`. `PhysicalBodyParticipation` then reports only whether
the optional physical state exists; it cannot distinguish a retained target from an integrated
mover.

There is also a circular transition in today's client path. `WorldState::apply_set_state_update`
reconstructs `EntityPhysicalIntent::Simulated` only when the scene body already has dynamic physical
state; a pose-only body therefore cannot promote itself when a later state replacement creates
physical demand. The replacement contract must be retained as producer-owned entity state (or
supplied with each transition), never inferred from the presence of the resource it controls.

### Shared demand and configuration types

Phase 2 will use these exact domain concepts; spelling may change only during that phase's code
review if an existing local convention is demonstrably clearer:

```rust
pub enum LocalTargetDemand {
    Absent,
    Retained,
}

pub enum LocalIntegrationDemand {
    Excluded,
    Eligible,
}

pub struct LocalPhysicalDemand {
    pub target: LocalTargetDemand,
    pub integration: LocalIntegrationDemand,
}

pub struct DynamicPhysicalBodyConfiguration {
    pub definition: DynamicPhysicalBodyDefinition,
    pub demand: LocalPhysicalDemand,
}
```

`DynamicPhysicalBodyConfiguration` must reject `Absent/Excluded`; an entity with that demand retains
its canonical pose body and has no physical allocation. `Retained/Excluded` is the missing
target-only role. `PhysicalBodyParticipation` survives only as a projection of current allocation,
not as policy.

`DynamicBodyRuntimeState` retains the demand beside prepared collision facts. The scene consumes it
as follows:

- physical preparation/allocation occurs when either demand dimension requires it;
- `DynamicShadowIndex` admits only `LocalTargetDemand::Retained` bodies;
- the mover schedule requires `LocalIntegrationDemand::Eligible` **and** solver-owned
  `DynamicBodyActivity::Active`;
- a target-only installation begins `Settled`, while an integration-eligible installation begins
  `Active`;
- changing target demand updates index/report membership without fabricating mover activity;
- changing integration from excluded to eligible wakes the body, while the reverse transition
  removes it from the schedule without removing retained target geometry.

`DynamicPhysicalBodyDefinition` remains immutable prepared content and response policy. Producer
demand does not belong inside that definition. Its current `scheduling` member will be removed;
state-derived `EntityPhysicsScheduling` will be renamed to `EntityIntegrationEligibility` and used
only while producers calculate or validate final demand. The scheduling loop will never consume
both that state-derived precursor and final demand.

The binary `EntityPhysicalIntent` and the policy-to-action decision stack will be deleted in the
same cutover: `EntityPhysicsTransitionContext`, `EntityPhysicalDisposition`,
`EntityPhysicalTransitionAction`, `EntityPhysicsTransitionDecision`,
`decide_entity_physics_state_transition`, and `apply_dynamic_entity_physics_transition`. Producers
resolve either a complete optional configuration or a typed unavailable/preparation error; the
scene compares old and new configuration and returns the actual `PhysicalBodyReconfigurationOutcome`
after mutation. `PhysicalBodyReconfiguration` receives the remaining installation/removal
vocabulary sweep. No deprecated variants or conversion shims survive.

### Producer ownership

The network client computes `LocalPhysicalDemand` in
`crates/holtburger-core/src/client/collision.rs`, where authoritative body facts, runtime motion,
reconciliation, and content preparation already meet. The Explorer retains its app-local choice
between pose-only and physically realized spawns, then converts that choice once into the same
shared demand. Neither producer stores a frontend concept in `holtburger-world`.

The local player retains unconditional integration demand while active in-world; its target demand
still follows effective target policy. Remote positive-demand admission is not reused as local
player policy.

The client target clause is:

```text
Retained when the supported effective state permits ordinary peer targeting
and the body is not in the distinct missile target branch; otherwise Absent.
```

The client integration clause is positive:

```text
Eligible when state permits integration and at least one of these is true:
- gravity;
- missile/launch behavior;
- retained velocity, acceleration, or omega;
- an orderable/current authored root-motion basis;
- pending pose reconciliation work.
```

`WorldState::body_has_simulatable_projection_basis` already joins retained kinematics, current
authored motion, and the orderable-motion fallback. The implementation will reuse and, if needed,
rename that helper rather than create a second motion predicate. Presentation-only part animation,
collision reporting by itself, a setup being decodable, or absence of `STATIC` is not integration
demand.

The initial cutover deliberately uses the server-maintained received entity population as its outer
interest cohort. It will not introduce an arbitrary second distance cutoff. Retail's 96 m activity
behavior and the existing pose-projection radius remain evidence for a later interest-policy phase
only if the corrected semantic population is still too broad.

### Transition and asynchronous ownership

`WorldState::apply_set_state_update` will return to semantic authority: update the effective state
and emit `EntityStateUpdated`, without inferring physical intent from allocation or mutating
content-backed physical state. The event's unused `transition` payload will be removed.

Before the next simulation transaction, `ClientCollisionCoordinator::observe` reconciles local and
remote physical configuration from the new semantic state and current producer demand. Compatible
state/demand changes reuse the installed prepared geometry synchronously. A change that invalidates
prepared facts removes stale physical participation before starting new preparation; the old state
must never run for another tick merely because content work is pending.

Remote coordinator targets and completions carry both `ClientEntityBodyFacts` and
`LocalPhysicalDemand`. A completion installs only if identity generation, definition facts, and
demand still match. Demand-only changes on an already prepared body update scene configuration
without restarting content decoding. `Absent/Excluded` removes physical allocation but not the pose
body.

During a genuine pose-only-to-physical preparation gap, authoritative dead reckoning must continue.
Today `tick_pose_only_remote_entities` explicitly skips a body merely because broad preparation is
demanded; Phase 4 deletes that admission re-check and excludes only an actually installed physical
body. Completion installs against the current runtime pose and the next fixed tick begins
collision-aware integration. This is an explicit degraded interval, not a silent frozen entity or
a reason to perform synchronous DAT reads.

### Expected role matrix

Representative outcomes follow from facts rather than semantic class names:

| Entity shape                                            | Target demand                                                 | Integration demand/activity                                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Observed `0x14` housing hooks                           | absent because target policy is suppressed                    | excluded because gravity and runtime work are absent                                                                                                      |
| Closed door or settled storage with solid target policy | retained                                                      | eligible only while gravity, authored root motion, vectors, or reconciliation require it; otherwise settled/excluded according to retained behavior facts |
| Creature at rest on proved support                      | retained when solid                                           | eligible but solver-settled; movement, vectors, reconciliation, or stale support wake it                                                                  |
| Missile/projectile in flight                            | excluded from ordinary peer-target indexing by missile policy | eligible and active while launch/path/vector work remains                                                                                                 |
| Animated scenery                                        | according to target policy                                    | root-transform work makes it eligible/active; part-only presentation animation does not                                                                   |
| Network-moved game piece                                | according to target policy                                    | movement/vector/reconciliation facts promote and wake it; rest alone is not a class rule                                                                  |
| Portal entity                                           | according to physical target policy                           | portal interaction semantics alone create no solver demand; actual motion/response facts do                                                               |

`supports_local_simulation()` remains a validation gate after demand exists, never the source of
demand. Unsupported or unknown state remains semantically visible while local physical realization
fails with the existing typed disposition.

### Quiescence behavior matrix

| Body state                                              | Target retained?           | Integrate next tick?              | Wake cause                                                    |
| ------------------------------------------------------- | -------------------------- | --------------------------------- | ------------------------------------------------------------- |
| Zero gravity, zero vectors, no authored/correction work | according to target policy | no                                | vector, motion, pose/correction, state/role change            |
| Gravity body with valid stable support and no work      | yes when target-capable    | no                                | stale support proof or other ordinary wake                    |
| Gravity body airborne                                   | according to target policy | yes                               | remains active until supported or otherwise resolved          |
| Free-flight body with zero vectors and no work          | according to target policy | no                                | vector/launch/correction/state change                         |
| Settled target near a moving peer                       | yes                        | not merely because it was queried | accepted response only when semantics require reciprocal wake |
| Suspended body whose topology becomes resident          | restored from policy       | yes for revalidation              | residency restoration                                         |

Existing scene writes already wake on explicit authoritative pose effects, vector replacements,
motion-state changes, runtime pose/contact/kinematic changes, correction snaps, suspension, and
topology restoration. New/reconfigured physical state starts active. The redesign must consolidate
these under the role/activity contract and add demand transitions for bodies that are currently
pose-only; it should not scatter more implicit `Active` assignments.

## Adjacent Smells and Threads

### Camera publication is serialized behind simulation

The camera is cheap but is evaluated and published after the fixed-tick simulation path. This is the
mechanism turning physics pressure into camera choppiness. It may deserve an architectural cadence
review, but moving camera work earlier would only reduce one symptom while leaving runaway host CPU
and delayed world updates. Treat publication ordering as a resilience thread, not the root fix.

Relevant code:

- `crates/holtburger-core/src/client/runtime.rs` fixed-tick transaction
- `crates/holtburger-core/src/client/simulation.rs::tick_physical_entities`

### Full dynamic view projection remains non-proportional

The host projects rich views for the complete entity population both before and after the fixed
simulation transaction. In the measured 455-entity scene those projections cost approximately
`2.8-2.9 ms` per tick. This is not the dominant defect, but a changed-body-driven publication model
should eventually replace repeated complete projection.

Relevant code:

- `crates/holtburger-core/src/client/dynamic_entity_view.rs::current_dynamic_entity_views`
- `crates/holtburger-core/src/client/runtime.rs` before/after fixed-tick view capture

### Existing solver-epoch plan only partially addressed liveness

`docs/plans/holtburger-client-dynamic-delta-and-solver-epoch-plan.md` is complete and correctly
removed redundant full solves and frontend full-mirror work. Its D7 liveness direction fixed a
different false-activity cause: semantic `motion_state` was not proof of remaining displacement.

The current housing evidence exposes a remaining assumption in that design: stability still requires
supported ground. Do not reopen or retroactively rewrite the completed plan. This worksheet records
the newly demonstrated follow-up defect.

## External Ground Truth

### ACE content and protocol facts

- `ACE/Source/ACE.Server/Factories/Enum/WeenieClassName.cs` maps the observed hook WCIDs.
- `ACE/Source/ACE.Entity/Enum/WeenieClassName.cs` contains the same class identities.
- `ACE/Source/ACE.Server/WorldObjects/Hook.cs` shows hook presentation/content replacement behavior.
- `ACE/Source/ACE.Server/WorldObjects/WorldObject_Networking.cs` calculates transmitted physics
  state.
- `ACE/Source/ACE.Server/WorldObjects/WorldObject_Tick.cs::UpdateObjectPhysics` first requires the
  separate transient active state. Ordinary non-missile objects then run only while animating or
  during their first initialization updates.
- `ACE/Source/ACE.Server/Physics/PhysicsObj.cs::set_active` owns that transient activity separately
  from `PhysicsState`.

ACE corroborates the conceptual split: physics capability bits are not themselves a positive
perpetual-tick request.

### Retail client activity and shadow membership

Retail provides a stronger model boundary, though not a ready-made admission predicate:

- `CPhysicsObj::InitObjectBegin` initializes network-dynamic objects inactive and records update
  time (`acclient.c:305738-305754`).
- `CPhysicsObj::set_active` owns transient bit `0x80` independently of persistent `PhysicsState`;
  static state refuses activation (`acclient.c:305440-305465`).
- Description installation calls `set_velocity`, which wakes dynamic objects even for an unchanged
  zero vector (`acclient.c:310398-310552`, `:306886-306903`). Thus retail does initially activate
  hooks; their `0x14` mask is not a hidden static marker.
- Movement explicitly calls `set_active(true)` (`acclient.c:325724-325752`). Position-manager,
  movement-manager, velocity, detection, and world-entry paths likewise wake transient activity.
- `CPhysicsObj::UpdatePhysicsInternal` clears active for a zero-velocity body without a movement
  manager only when retained `OnWalkable` contact is set (`acclient.c:310823-310943`). This mirrors
  the grounded-only edge seen in our solver closely enough that broadening quiescence may be a
  deliberate retail divergence, not a claim that retail itself sleeps wall hooks.
- `CPhysicsObj::update_object` skips physical work when parented, nonresident, or frozen and clears
  active beyond 96 m when object maintenance is active (`acclient.c:311146-311198`).
- `CPhysics::UseTime` still scans the object table, but active gating occurs inside each object
  (`acclient.c:300036-300128`).
- Retail shadow membership is cell-owned and updated on cell/placement changes:
  `remove_shadows_from_cells`, `add_shadows_to_cells`, and `SetPositionInternal`
  (`acclient.c:306732-306770`, `:310125-310190`, `:310587-310785`).
- Collision broad phase traverses only the current cell's `shadow_object_list`
  (`CObjCell::find_obj_collisions`, `acclient.c:333148-333169`).

Therefore retail corroborates independent transient activity and retained spatial target
membership. It does not prove that all nearby zero-gravity hooks sleep; our proposed work-based
quiescence should be evaluated as a compatibility divergence with a census and an observable-impact
argument. The target/index separation itself is retail-shaped.

## Hypothesis Ledger

| Thread                                          | Status                      | Evidence                                                                                | Missing proof                                               |
| ----------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Camera controller stops changing                | Rejected                    | Host and rendered camera transforms change; minimap cone changes                        | None for current symptom                                    |
| Renderer cannot sustain the camera              | Rejected as root cause      | RAF is usually display-rate; host camera delivery contains larger stalls                | Renderer long-stall attribution remains useful              |
| Camera collision solve is expensive             | Rejected                    | Camera solve is approximately `0.16 ms`                                                 | None for current workload                                   |
| Host simulation starves camera publication      | Confirmed                   | Simulation is `22.3-22.4 ms`; camera delivery p95/max are delayed                       | Post-fix comparison                                         |
| Hooks dominate the mover population             | Confirmed                   | 423 of 457 initial bodies; exactly 276 wall/ceiling hooks remain at ticks 150/300       | Post-fix passive comparison                                 |
| Hook physics state is decoded incorrectly       | Rejected for observed hooks | Live `0x14` equals catalog `0x14`                                                       | Audit later state replacements only if new evidence appears |
| Absence of `STATIC` proves active integration   | Rejected as a model         | Retail has separate transient activity; catalog support admits all 43,913 templates     | Producer role contract                                      |
| Grounded-only sleep retains hooks forever       | Confirmed live              | All 276 late movers are zero-vector airborne wall/ceiling hooks                         | Post-fix passive comparison                                 |
| Adding a dynamic spatial index solves the issue | Rejected as stated          | Index exists; compile is `0.031 ms`, peer work `0.056 ms`; hooks are suppressed targets | Reprofile after cohort correction                           |
| Reusing the index and compact epoch will help   | Deferred by measurement     | Compile + cloning are `~0.170 ms` versus `2.796 ms` environment solves                  | Post-admission/post-sleep profile                           |
| Hook population is causal                       | Confirmed by A/B            | Temporary omission reduced preparation `3.313 -> 0.083 ms` with same 458 entities       | Production role implementation                              |
| Full view projection contributes materially     | Confirmed but secondary     | Approximately `2.8-2.9 ms` per tick at 455 entities                                     | Changed-entity publication design and A/B                   |

## Implementation Phases

Phases 0 and 1 are complete investigation gates. Phases 2 through 5 are the required corrective
cutover. Phases 6 and 8 are explicitly conditional: do not execute them merely because they are
scoped here.

### Phase 0: Durable passive reproduction — Complete

#### Landed artifacts

- `apps/holtburger-3d/scripts/live-client-probe.mjs` has a `passive` mode that performs no chat,
  drive replacement, or relocation.
- Passive mode rejects teleport options before starting the host and reports its selected mode.
- `apps/holtburger-3d/README.md` documents the safe invocation.
- Early/late mover censuses, phase timing, and the causal hook counterfactual are recorded above.

#### Remaining use

- Keep the passive mode as durable diagnostics.
- Do not retain task-specific body census or timing output in the probe; temporary host diagnostics
  may be reintroduced during implementation and must be removed in Phase 9.

### Phase 1: Ground truth and design selection — Complete

#### Landed conclusions

- Retail transient activity and cell shadow membership are separate from persistent physics flags.
- The observed hook flags match catalog authority; decoding is not the defect.
- The current eligibility predicate admits the entire 43,913-template catalog.
- Target membership, integration eligibility, and solver activity require separate owners.
- The existing dynamic index is not the current hotspot.
- Work-based zero-gravity quiescence may be a documented retail divergence.

### Phase 2: Shared physical-demand clean cutover

This phase introduces the missing domain model while preserving current production admission. It
must leave the workspace compiling before any client cohort behavior changes.

#### Primary files and symbols

- `crates/holtburger-world/src/entity_physics.rs`
  - replace `EntityPhysicalIntent` with `LocalPhysicalDemand`, `LocalTargetDemand`, and
    `LocalIntegrationDemand`;
  - replace `EntityPhysicsScheduling` with `EntityIntegrationEligibility`;
  - delete the transition context, disposition, action, decision, and decision function after
    migrating producers to complete optional configurations.
- `crates/holtburger-world/src/spatial/dynamic_body.rs`
  - add invariant-bearing `DynamicPhysicalBodyConfiguration`;
  - remove `DynamicBodyCollisionDefinition::scheduling`.
- `crates/holtburger-world/src/spatial/physical_body.rs` and `spatial/scene.rs`
  - retain demand in `DynamicBodyRuntimeState`;
  - make installation/reconfiguration consume a complete configuration;
  - initialize target-only configurations settled and integration-eligible configurations active;
  - make the scheduler consume final integration demand and the index consume final target demand.
- `crates/holtburger-core/src/dynamic_entity.rs`
  - migrate install, replace, and preparation operations;
  - delete `apply_dynamic_entity_physics_transition`; scene configuration replacement already
    performs the mutation, report-lifetime cleanup, and exact outcome classification;
  - keep prepared content independent from producer demand.
- `crates/holtburger-core/src/client/collision.rs`
  - during Phase 2 only, express the existing broad remote policy as target demand from the current
    collision policy plus integration demand copied from the current state-derived eligibility for
    every currently admitted body;
  - preserve this intentionally broad mapping through the Phase 3 sleep experiment, then delete it
    in the Phase 4 producer-demand cutover.
- `apps/holtburger-3d/host/src/explorer_entity_driver.rs`,
  `explorer_entity_runtime.rs`, `explorer_entity_simulation.rs`, `explorer_host.rs`, and `lib.rs`
  - replace the wire-facing Explorer choice with app-local `ExplorerPhysicalMode`;
  - convert it once to shared demand before scene mutation;
  - store final demand in the Explorer registry instead of inferring it from physical presence;
  - replace `transition_decision` and replacement/action validators with one resolver that produces
    the complete optional configuration or an existing typed Explorer error.
- `apps/holtburger-3d/host/src/host_simulation_runtime.rs`
  - replace the decision-plus-replacement method with one direct optional-configuration mutation;
  - return the scene's committed `DynamicEntityBodyCommitOutcome` without a second action model.
- `apps/holtburger-3d/src/explorer/explorer-entity-commands.ts`, its tests, and
  `src/harness/browser/BrowserHarnessApp.svelte`
  - rename the Explorer request field/value from physical intent to physical mode;
  - preserve the same pose-only versus integrated user choice without exporting shared runtime
    policy to TypeScript.
- `crates/holtburger-world/src/lib.rs`, `spatial.rs`, and affected core/app re-exports and fixtures.

#### Contract invariants

- `Absent/Excluded` cannot be wrapped in `DynamicPhysicalBodyConfiguration`.
- `Retained/Excluded` owns prepared target geometry but cannot appear in the mover schedule.
- `Absent/Eligible` can move and solve against the environment without appearing as a peer target.
- `Retained/Eligible` can be both mover and target.
- `DynamicBodyActivity` remains solver-owned and cannot be set by a producer demand calculation.
- Suspended bodies remain absent from both target indexing and integration regardless of retained
  demand until topology restoration revalidates placement.
- `PhysicalBodyParticipation` remains an allocation observation only.
- A demand-only reconfiguration does not decode content again.
- Losing target demand forces any now-invalid report lifetimes to balanced ends.

#### Tests

- Add pure four-quadrant demand/configuration tests in `entity_physics.rs` and
  `spatial/physical_body.rs`.
- Extend scene scheduling/index tests with target-only, mover-only, both, and neither cases.
- Prove an integration-demand promotion wakes a settled body and a demotion removes it from the
  schedule without removing retained target geometry.
- Prove target-demand changes update peer candidates and report lifetimes independently of mover
  activity.
- Migrate Explorer spawn, replacement, attachment, frozen/state-transition, and possession tests
  without compatibility aliases.

#### Acceptance criteria

- All shared and Explorer call sites use the composite contract.
- `rg` finds no surviving `EntityPhysicalIntent`, `EntityPhysicsScheduling`,
  `EntityPhysicsTransitionContext`, `EntityPhysicalDisposition`,
  `EntityPhysicalTransitionAction`, `EntityPhysicsTransitionDecision`,
  `decide_entity_physics_state_transition`, `apply_dynamic_entity_physics_transition`,
  `EnableSolverParticipation`, or `DisableSolverParticipation` symbols.
- Existing client remote entities still map to compatibility demand that preserves pre-Phase-2
  behavior; the housing mover count is not expected to improve yet.
- `cargo test -p holtburger-world`, focused `holtburger-core` tests, host tests, and clippy with
  warnings denied pass.

#### Checklist

- [x] Add the demand enums, composite, configuration constructor, and invariant helpers.
- [x] Replace transition decisions with complete optional configurations and sweep their vocabulary.
- [x] Move scheduler and index membership to final demand.
- [x] Migrate shared dynamic-entity operations.
- [x] Migrate Explorer producer policy and tests.
- [x] Run formatting, focused tests, checks, and clippy.

#### Execution record

- Added four-quadrant demand, configuration-invariant, scheduler/index membership, promotion,
  demotion, and target-only change tests.
- The scene now preserves solver-owned settled state across unchanged configurations and
  target-only demand changes, wakes on new integration work, settles on integration demotion, and
  preserves suspension until topology restoration.
- All `holtburger-world`, `holtburger-core`, and `holtburger-3d-host` tests passed; clippy passed for
  all targets with warnings denied.
- Frontend static checks and the focused Explorer command tests passed. The complete TypeScript
  suite passed 1,683 of 1,685 tests; two pre-existing viewer-light falloff assertions fail in
  untouched `point-light-falloff.test.ts` and are unrelated to this phase.
- A 12-second release passive comparison after the Phase 2 cutover observed 458 projected entities,
  457 physical participants, 457 initial movers, and 276 late movers. This exactly preserves the
  broad pre-cutover population needed to test Phase 3 independently. The capture received 402
  camera events, reported `teleport: null` and empty drive phases, and observed only `0.000674 m`
  of local-player drift.
- Temporary opt-in stderr census output and passive-probe parsing were added to make participant and
  mover counts observable during Phases 2 through 4. They are diagnostic debt and must be removed
  in Phase 9.

### Phase 3: Work-based quiescence

This phase fixes the independent sleep defect while the deliberately broad compatibility admission
still exposes it. That ordering prevents Phase 4 from hiding a broken liveness model.

#### Primary files and symbols

- `crates/holtburger-world/src/spatial/scene.rs`
  - replace `accepted_dynamic_tick_is_stable` with an honestly named work-based quiescence helper;
  - keep canonical zero-vector, accepted-path, response-currentness, residual-contact, and
    solve-completion checks;
  - make support a requirement only for gravity-bearing grounded bodies.
- `crates/holtburger-world/src/spatial/physical_body.rs`
  - update `DynamicBodyActivity::Settled` and initialization comments so they do not equate rest
    with walkable support.
- `crates/holtburger-world/ARCHITECTURE.md`
  - document general quiescence, conditional support proof, and independent target retention.

#### Quiescence rule

A completed body tick may settle only when:

1. actuation has no controller, flight, launch, or authored-root work;
2. no residual contact transaction remains;
3. the solve completed rather than clipping or rejecting work;
4. retained velocity, acceleration, and omega are canonical zero;
5. response memory did not change during the accepted tick;
6. every accepted path leg ends at the initial point;
7. a grounded definition with nonzero gravity retains valid supported ground.

Condition 7 does not apply to zero-gravity grounded definitions or free-flight definitions. Exact
zero remains correct because existing response code canonicalizes subthreshold retained work before
the predicate; this phase must not add an arbitrary epsilon.

#### Wake audit

Keep or add focused coverage for:

- new/reconfigured integration-eligible configuration;
- `Excluded -> Eligible` demand promotion;
- authoritative pose/reconciliation effects and correction snaps;
- vector replacement, runtime pose/contact/kinematic replacement, and motion-state change;
- local/Explorer controller, possession, queued authored motion, and clip-publication work;
- stale support proof after collision-scene revision;
- suspension and topology restoration;
- accepted reciprocal peer response where existing semantics require waking the peer.

Do not wake a settled target merely because it was queried or because a report lifetime expires.

#### Retail divergence gate

- Re-run the catalog census for supported, zero-gravity bodies with no retained catalog motion or
  default root work and record counts by weenie type.
- Add a `RETAIL DIVERGENCE:` comment at the quiescence decision if the implementation departs from
  `CPhysicsObj::UpdatePhysicsInternal`'s grounded-biased deactivation.
- The comment must cite `acclient.c:310823-310943`, explain that zero-work bodies produce no authored
  observable displacement, and include the final census/blast-radius reference.
- If the census uncovers content whose idle airborne updates have an observable script/contact
  consequence, stop and revise the predicate rather than weakening the marker.

#### Tests

- Zero-gravity grounded-shaped airborne body settles after one unchanged accepted tick.
- Gravity-bearing airborne body remains active.
- Gravity-bearing supported body settles and wakes only when its support proof becomes stale.
- Free-flight zero-work body settles; vector/launch replacement wakes it.
- Target-only settled body remains discoverable and can block/report for an active peer.
- Standing semantic motion does not prevent settling, while actual authored root work does.
- Reconciliation, residual contacts, clipped paths, report lifetimes, projectile state, and
  reciprocal response preserve their existing behavior.

#### Live acceptance before Phase 4

- Run a 12-second release passive capture without moving the character.
- Expect the broad physical participant population to remain, but the late mover census to contain
  no zero-vector wall/ceiling hook cohort.
- Record participant count, initial/late mover count, per-stage preparation timing, host CPU, and
  camera-event cadence. This is the independent proof that quiescence works before admission changes.

#### Checklist

- [x] Add the focused behavior matrix tests.
- [x] Implement the conditional-support quiescence predicate.
- [x] Complete the wake audit and vocabulary sweep.
- [x] Add the retail divergence marker with its census if required.
- [x] Run world/core/host checks and clippy.
- [x] Capture the movement-free live quiescence comparison.

#### Execution record

- Replaced the grounded-only stability predicate with `completed_dynamic_tick_is_quiescent`.
  Gravity-bearing grounded definitions still require unchanged `GroundState::Supported`; zero-
  gravity grounded-shaped and free-flight definitions may settle after one completed no-work tick.
- Added focused zero-gravity airborne, gravity-airborne, free-flight settle/wake, and target-only
  report-lifetime coverage. Existing stale-support, reconciliation, correction-snap, clipped-path,
  projectile, reciprocal-wake, suspension/restoration, authored-motion, and activity-transition
  tests remained green. The target-only fixture now uses `Retained/Excluded` through the public
  configuration operation instead of mutating solver activity in the test.
- Corrected one Explorer fixture that expected both no-work free-flight bodies to keep ticking.
  After one body is relocated, only that body produces a physical tick; the settled target still
  produces both report directions. Preserving the old two-body expectation would preserve the
  defect under test.
- A fresh shipped-catalog run scanned 43,913 templates. It found 6,926 supported zero-gravity
  templates with no missile, template/setup motion table, default animation, or default script.
  Of those, 6,654 also suppress ordinary target participation: 6,274 House, all 5 Hook, 187
  Generic, 92 Switch, 72 ProjectileSpell, 15 Creature, 5 Book, 3 Missile, and 1 Food. Runtime-
  activatable categories remain the reason quiescence consumes current work and wake facts rather
  than using this catalog shape as admission policy. The temporary census binary was deleted after
  recording the result.
- `holtburger-world` passed 491 tests; `holtburger-core` passed 283 tests;
  `holtburger-3d-host` passed 246 tests. Clippy passed for all three crates/all targets with warnings
  denied.
- The first 12-second release passive comparison retained 458 projected entities and 457 physical
  participants while moving from 457 initial movers to zero late movers. A separate timed capture
  had one late mover that travelled approximately `0.528 m`; no zero-vector wall/ceiling hook cohort
  survived. Both received 402 camera events and issued no teleport or drive request.

| Late preparation stage | Phase 2 broad sleep defect mean | Phase 3 work-based sleep mean |
| ---------------------- | ------------------------------: | ----------------------------: |
| Population scan        |                      `0.019 ms` |                    `0.017 ms` |
| Placement refresh      |                      `0.183 ms` |                    `0.180 ms` |
| Shadow-index compile   |                      `0.031 ms` |                    `0.030 ms` |
| Schedule selection     |                      `0.016 ms` |                    `0.007 ms` |
| Participant clone      |                      `0.139 ms` |                    `0.136 ms` |
| Environment solve      |                      `2.796 ms` |                    `0.016 ms` |
| Peer resolution        |                      `0.056 ms` |                    `0.001 ms` |
| Finalization           |                      `0.070 ms` |                    `0.002 ms` |
| **Total preparation**  |                  **`3.313 ms`** |                **`0.390 ms`** |

The Phase 3 timed capture used the steady half of 400 samples with 457 participants and one late
mover; total preparation p50 was `0.387 ms` and p95 was `0.470 ms`. Child-PID sampling in a separate
passive capture measured host CPU at mean `8.67%`, p50 `8.5%`, and p95 `10%` over the steady half of
56 samples, compared with the earlier approximate `154%` affected-scene observation. Temporary
profile output, probe parsing, and CPU sampling remain diagnostic debt through the Phase 4/Gate A
comparisons and are removed in Phase 9.

### Phase 4: Producer-owned client demand and admission

This phase removes broad admission and the circular client state-transition path. It is the main
population cutover.

#### Primary files and symbols

- `crates/holtburger-core/src/client/collision.rs`
  - replace `client_remote_body_requires_preparation` and `remote_body_targets` with one positive
    client demand calculation;
  - carry demand through `ClientRemoteBodyTarget`, coordinator state, equality, and completion
    currentness;
  - reconcile demand-only changes without restarting preparation;
  - remove stale physical configuration before incompatible asynchronous preparation.
- `crates/holtburger-world/src/state/motion_resolution.rs`
  - reuse or rename `body_has_simulatable_projection_basis` as the single motion-work predicate;
  - keep its existing orderable-motion fallback for a body whose playback cursor has not advanced.
- `crates/holtburger-world/src/state/mutations.rs` and `events.rs`
  - make `apply_set_state_update` update semantic authority only;
  - remove its physical allocation inference and the unused transition payload from
    `WorldEvent::EntityStateUpdated`.
- `crates/holtburger-core/src/client/runtime.rs`
  - keep coordinator observation/polling before simulation;
  - project semantic state immediately and physical-body changes when the coordinator commits them;
  - delete `sync_remote_body_tracking` and its event-driven track/untrack choreography.
- `crates/holtburger-core/src/client/simulation.rs`
  - consume final scene demand rather than calling the deleted admission predicate;
  - delete `tracked_body_ids`, `track_body`, and `untrack_body`;
  - if no state remains, delete the zero-sized `ClientSimulationSystem` owner and expose focused
    stateless module functions instead of retaining an object-shaped namespace;
  - derive nearby pose-only projection candidates directly from current world/scene facts each tick;
  - keep pose-only authoritative projection active during preparation gaps by excluding only bodies
    with installed physical configuration.

#### Remote demand calculation

The client producer first requires a non-player, unattached, authoritative pose body with complete
WCID/setup facts and a locally supported effective state. It then computes:

- target `Retained` only when ordinary target policy is not suppressed and the missile branch does
  not exclude ordinary peer indexing;
- integration `Eligible` only when state permits it and gravity, missile/launch behavior, retained
  vectors, current/orderable authored root motion, or pending reconciliation supplies positive work.

Reporting, decodable setup content, object class, and state-derived integration eligibility alone
do not create integration demand. Received entity membership is the initial outer interest boundary.

#### Coordinator transition rules

- Same definition + same demand: retain without work.
- Same definition + changed demand: reconfigure synchronously from installed prepared facts.
- Changed definition/state with a compatible installed definition: derive and commit the exact
  replacement synchronously.
- Changed definition requiring content: remove stale physical state, start one generation-guarded
  job, and continue pose-only projection.
- Demand becomes `Absent/Excluded`: remove physical state and any invalid report lifetimes, retain
  authoritative pose/presentation.
- Demand appears for a pose-only entity: start preparation once; new unrelated demand may join a
  later batch without restarting the in-flight worker.
- Completion mismatch in identity, instance sequence, facts, or demand: discard without mutation.
- Preparation failure: retain semantic entity and pose-only projection, publish/log the typed
  unavailable cause once per unchanged demand rather than retrying each tick.

Apply the same currentness discipline to the local player. Compatible local-player state changes
must reconfigure before the next solve; incompatible preparation must never leave a stale local
body integrating while the replacement is pending.

#### Tests

- Suppressed, zero-gravity, zero-work entity remains pose-only and requests no preparation.
- Solid, zero-gravity, zero-work entity becomes target-only and is absent from the mover schedule.
- Gravity entity is target/integration eligible, starts active, and can settle.
- Missile is integration eligible without ordinary target membership.
- Vector, motion, and reconciliation changes promote a pose-only entity and issue exactly one
  preparation request.
- Direct projection discovery sees spawn, vector, motion, reconciliation, despawn, attachment, and
  physical-install changes without maintaining a synchronized body-ID mirror.
- Clearing the last positive work fact demotes/removes only the appropriate role without losing
  authoritative pose.
- A demand-only target/integration change reuses prepared geometry.
- In-flight completion is rejected after demand, state, setup, appearance, scale, generation,
  attachment, or despawn changes.
- State replacement no longer infers policy from physical allocation.
- Existing local-player readiness, portal destination, teleport invalidation, and live-pose
  installation tests remain green.
- Client view projection still reports pose-only/physical allocation correctly and does not expose
  demand merely for diagnostics.

#### Live acceptance

- Run the passive capture at the unchanged user-positioned location.
- Record every role count: projected entities, pose-only, target-only, integration-eligible,
  physical participants, active movers, settled, and suspended.
- All observed hook WCIDs should derive `Absent/Excluded` from facts and request no preparation.
- The comparable counterfactual saw 34 non-hook physical bodies and zero late movers; treat that as
  a workload expectation, not a hard count if live population changes.
- Confirm hooks still render and remain available to selection, radar, housing attachment/content,
  and authoritative updates.
- Exercise representative door/storage, creature, projectile, moving game-piece, authored-motion,
  attachment, and state-replacement paths through focused synthetic or live scenarios.

#### Checklist

- [x] Add the pure client demand resolver and table tests.
- [x] Move client state/physical reconciliation into the coordinator.
- [x] Make remote demand and asynchronous completion currentness complete.
- [x] Remove broad admission, simulation-side re-derivation, and tracked-body mirror state.
- [x] Update local-player reconfiguration and failure handling.
- [x] Run focused, crate-wide, host, and frontend checks.
- [x] Capture the movement-free live admission comparison.

#### Phase 4 execution record — complete

- `client_remote_body_requires_preparation`, `remote_body_targets`, and both broad compatibility
  demand helpers are deleted. One pure target resolver now emits complete facts plus positive
  `LocalPhysicalDemand` or no physical target.
- Remote integration demand requires supported state plus gravity, missile behavior, retained
  vectors, current/orderable authored root motion, or pending reconciliation. Target membership is
  derived independently from ordinary peer-target policy. Focused table tests cover pose-only,
  target-only, gravity, missile, vector promotion, unsupported state, and reconciliation.
- `WorldState::apply_set_state_update` now mutates semantic entity state and emits
  `EntityStateUpdated` only. The client collision coordinator is the sole client owner of physical
  realization before simulation.
- Compatible state and demand replacements rebuild configuration synchronously from installed
  prepared facts. Setup, appearance, scale, identity, or other content-backed changes remove stale
  physical state before asynchronous preparation. Exact facts plus exact demand guard completion;
  no demand revision counter or separate retry registry was introduced.
- The manually synchronized `tracked_body_ids` vector, track/untrack methods,
  `sync_remote_body_tracking`, and its world-event observer are deleted. Pose-only projection
  discovers current candidates directly from the authoritative scene population and excludes only
  an actually installed physical body.
- Removing the mirror left `ClientSimulationSystem` stateless, so the type, runtime field, and
  builder initialization were deleted. Simulation is now a set of focused module functions.
- The old world test that expected `SetState` to infer and mutate client policy was replaced with a
  semantic-authority test. The old remote test that expected every hydrated body to be scheduled
  now proves a solid zero-work body is target-only.
- Focused collision tests pass (17/17), the complete world/core/host suites pass
  (491/491, 289/289, 246/246), and clippy passes for all three crates with warnings denied.
  Svelte/TypeScript checks pass with zero diagnostics. Frontend tests pass 1,683/1,685; the same two
  unrelated pre-existing viewer-light falloff assertions remain red and are not changed by this
  physics work.

The 12-second release-sidecar passive comparison preserved the user-positioned character:
`teleport: null`, empty `teleports` and `drivePhases`, and `0.000674 m` player drift. It received
402 camera events while the projected population remained 458.

| Phase 4 live measurement | Initial | Late/steady |
| ------------------------ | ------: | ----------: |
| Projected entities       |     458 |         458 |
| Physical participants    |      26 |          26 |
| Scheduled movers         |      18 |           0 |
| Host process CPU         |       — | `7.41%` mean, `8.9%` p95 |

Over the final 200 release ticks, collection preparation measured `0.0658 ms` mean,
`0.0626 ms` p50, and `0.0879 ms` p95. Environment solve fell below `0.001 ms`; shadow-index compile
was `0.0294 ms` mean and participant capture `0.0093 ms` mean. This is materially below both the
Phase 3 broad-admission sleep result (`0.390 ms` mean with one genuine late mover) and the original
hook-active baseline (`3.313 ms` mean with 276 false late movers).

### Phase 5: Resteering Gate A — correctness and corrected-population profile

Stop after Phase 4. Do not begin proportionality or camera-publication changes in the same review.

#### Required audit

- Review the complete diff for duplicate policy, compatibility shims, stale scheduling vocabulary,
  and app/shared boundary leakage.
- Dry-run every remaining phase against the now-smaller physical population.
- Compare Phase 3 broad-admission sleep results with Phase 4 positive-admission results so the two
  fixes remain independently attributable.
- Capture a release profile with the same population/configuration facts as the baseline:
  placement refresh, index maintenance/compile, participant capture, environment solve, peer
  resolution, commit, complete simulation, full dynamic projection, camera solve/delivery, and
  process CPU split.
- Use a gradual CDP camera drag or ordinary interactive input that changes camera orientation but
  not character position. Report latency distribution and rendered cadence; a binary “camera
  moved” assertion is insufficient.

#### Gate decisions

- If collection preparation is no longer material, skip Phase 6 and record the measured rejection.
- If whole-population projection is no longer material and camera delivery is smooth, skip Phase 8.
- If camera stalls remain but simulation and projection are cheap, investigate the newly measured
  boundary rather than assuming the old cause survived.
- Any semantic regression in target interaction, projectile response, authored motion, attachment,
  or state replacement returns execution to the owning earlier phase.

#### Acceptance criteria

- No hook/body-class exception exists.
- Zero-work hooks are neither prepared nor scheduled for explained demand reasons.
- All quiescence and demand-transition matrices pass.
- Host CPU and camera delivery materially improve without lowering tick or camera cadence.
- The user-positioned character has not been driven or relocated by diagnostics.

#### Gate A execution record (2026-08-29)

The complete diff audit found no surviving binary intent, tracked-body mirror, duplicate remote
admission helper, demand-revision registry, or solver-participation vocabulary. The only stale
comment described semantic physics flags as controlling solver participation; it now accurately
describes them as inputs to local-demand derivation. App/shared ownership remains intact: world
owns semantic authority and scene mechanics, core owns client physical demand and realization, and
the app owns camera input and presentation.

An explicitly passive release UI probe rejected teleport options before process launch and entered
no chat, drive, or teleport branch. Its trusted CDP gesture dispatched only a gradual left-button
drag over the client canvas. Both captures reported empty command and teleport lists; the
character's displayed world coordinate remained 22.4S, 73.6E.

| Corrected-population release measurement | Capture 1 | Capture 2 | Post-cleanup |
| ---------------------------------------- | --------: | --------: | -----------: |
| Camera interval p95                      |   33.7 ms |   37.8 ms |      36.0 ms |
| Camera interval max                      |   43.4 ms |   47.6 ms |      51.4 ms |
| Input-to-next-camera p95                 |   28.6 ms |   40.4 ms |      29.8 ms |
| Renderer frame interval p95              |    7.0 ms |    7.0 ms |       7.0 ms |
| Renderer frame interval max              |    7.1 ms |    7.1 ms |      20.9 ms |

The second capture also recorded 327 complete fixed-tick samples. Across the complete capture,
fixed-tick p95 was 1.388 ms and maximum was 2.288 ms; camera solving was 0.0134 ms mean,
0.0362 ms p95, and 0.0968 ms maximum. Complete before/after dynamic population projection was
approximately 0.10 ms/0.12 ms mean across the capture, with respective maxima of
0.487 ms/0.438 ms. Publication itself was 0.00028 ms mean.

This rejects both conditional optimization branches:

- **Phase 6 rejected:** collection preparation is 0.0658 ms mean and its largest retained term,
  index compile, is 0.0294 ms mean. A scene-owned incremental index and compact contact epoch
  would add invalidation lifecycle and ownership complexity to remove less than one tenth of a
  millisecond.
- **Phases 7 and 8 rejected:** complete projection remains well below one millisecond, complete
  fixed ticks remain below 2.3 ms in the captured worst sample, and host/renderer delivery no
  longer stalls. Changed-body publication or a separate camera timeline would solve no measured
  problem.

The temporary census, stage clocks, whole-tick clocks, parsers, and process CPU sampler were removed
after recording these results. The generally useful passive camera probe remains because it
enforces movement-free operation and measures distributions rather than a binary movement check.
The post-cleanup probe repeated the same movement-free result, and the browser/WebGL harness passed.

### Phase 6: Conditional collection proportionality

**Rejected at Gate A; not executed.**

Execute only if Gate A shows scan, placement refresh, index construction/maintenance, or participant
capture remains material after corrected admission and sleep.

#### Phase 6A: Synthetic scaling and attribution

- Reintroduce opt-in temporary clocks for population scan, placement refresh, index work,
  participant capture, environment solve, peer resolution, and finalization.
- Add a focused synthetic benchmark/harness matrix that varies retained target count and active
  mover count independently, including hundreds of sleeping targets with zero, one, and several
  movers.
- Record release medians and spread; do not turn one machine's timing into a permanent budget.
- Verify a sleeping target never causes an environment solve merely because it remains indexed.

Resteer after 6A. Authorize 6B or 6C independently based on the attributed term; neither requires
the other.

#### Phase 6B: Retained dynamic shadow membership

Primary files: `spatial/dynamic_index.rs`, `spatial/scene.rs`, and body registration/update paths.

- Move `DynamicShadowIndex` from a compiled epoch temporary to scene-owned retained state.
- Update membership atomically on body registration/removal, physical configuration changes,
  target-demand changes, accepted pose/membership changes, scale/geometry replacement, suspension,
  and topology restoration.
- Preserve stable candidate ordering and deduplication.
- Keep immutable prepared geometry owned once; index entries retain IDs/cell membership, not copied
  collider payloads.
- Delete per-tick `DynamicShadowIndex::compile` when the retained path is complete.

Tests must prove no stale shadow survives every invalidation path, cross-owner outdoor reach,
EnvCell transitions, suspension, or target-demand loss.

#### Phase 6C: Compact immutable contact epoch

Primary files: `spatial/dynamic_contact.rs` and `spatial/scene.rs`.

- Replace full-population `SpatialBody` clones with the smallest immutable tick-start participant
  facts consumed by environment/currentness and peer queries.
- Capture active movers eagerly; capture retained peer-target facts only for candidates reached by
  mover sweeps, or retain immutable references under an epoch mutation guard if Rust ownership and
  scene mutation rules remain simpler.
- Preserve the one coherent tick-start epoch, deterministic pair ordering, reconciliation
  currentness checks, bounded slicing, directional report ownership, and reject-before-commit
  behavior.
- Refresh placement only when pose, geometry, target demand, topology, residency, or support-proof
  revision requires it.

Do not introduce object pools, unsafe aliasing, a second canonical body store, or an ECS migration.

#### Acceptance criteria

- With a fixed target population, cost follows active movers and changed target membership.
- With a fixed mover population, unchanged sleeping targets do not incur full-body cloning or
  placement refresh.
- Deterministic contact, coverage rejection, correction snap, report lifetime, and stale-commit
  tests remain bit-for-bit/order equivalent where observable.
- All temporary profiling code is removed after the comparison is recorded.

### Phase 7: Resteering Gate B — post-collection profile

**Not applicable because Phase 6 was rejected.**

- Repeat the synthetic scaling matrix and live passive/CDP capture.
- Compare cost per target, per changed target, and per mover with Gate A.
- Inspect whether the remaining fixed-tick cost is now dynamic view projection, camera dependency,
  renderer delivery, or an unrelated boundary.
- Reject Phase 8 if full projection and camera delivery are already ordinary.
- Do not independently pace camera authority unless changed-body publication cannot remove the
  measured serialization cost.

### Phase 8: Conditional changed-body publication and camera resilience

**Rejected at Gate A; not executed.**

Execute only if a fresh Gate A/B profile still attributes material cost or camera delay to complete
dynamic view projection/publication.

#### Primary files and design

- `crates/holtburger-core/src/client/runtime.rs`
  - delete the complete `before_dynamic`/`after_dynamic` population snapshots from every fixed tick;
  - keep snapshot publication for activation/reset only.
- `crates/holtburger-core/src/client/simulation.rs`
  - return one typed fixed-tick product naming bodies whose accepted pose, membership, physical
    level, or correction kind changed;
  - include pose-only advancement and correction snaps in the same product.
- `crates/holtburger-core/src/client/dynamic_entity_view.rs`
  - project only named changed GUIDs;
  - build the existing nonempty, stable, disjoint `DynamicEntityTickBatch` without comparing two
    complete population maps.

Capture the minimal pre-commit placement fact needed for path construction at the layer that owns
the simulation transaction. Do not reconstruct a “before” pose after mutation and do not add a
frontend advancing cache.

Build the compact dynamic batch immediately after simulation, then advance the camera from that
coherent product before sending bulk frontend entity publication. Keep the camera solver on the
same authority timeline. Only consider a separately paced camera loop if measured host delivery
still misses cadence after changed-body projection; that would require its own plan because it
introduces cross-timeline interpolation and collision-snapshot ownership.

#### Tests and acceptance

- No-change ticks perform zero per-entity projection and emit no tick batch.
- One mover projects exactly one entity; a correction-only batch retains zero duration semantics.
- Path-stable level updates and attachment transitions remain disjoint from advances.
- Snapshot/reset/upsert/removal delivery remains listener-before-snapshot safe.
- Camera target/pivot behavior consumes the same accepted entity state as frontend publication.
- Live host projection cost and camera delivery improve without changing renderer interpolation or
  reducing publication cadence.

### Phase 9: Cleanup, documentation, and final acceptance

#### Cleanup sweep

- Delete every temporary timing environment switch, activity census, test-only WCID path, capture,
  and generated output.
- Keep only the general passive probe capability and generally useful synthetic benchmark if it has
  a named ongoing consumer.
- Sweep removed vocabulary from symbols, comments, metrics, docs, UI labels, and tests.
- Update `holtburger-world/ARCHITECTURE.md`, `holtburger-core/ARCHITECTURE.md`, and app architecture
  documentation with the final demand/activity/target ownership.
- Update this worksheet's phase decisions and final measurements; mark it complete rather than
  pretending conditional phases ran when they were rejected.

#### Final validation

- `cargo fmt --all -- --check`.
- Relevant world/core/host unit tests, followed by workspace tests appropriate to touched crates.
- `cargo clippy` for every touched Rust crate/all targets with `-D warnings`.
- `npm run check`, `npm run lint`, and `npm run test:ts --prefix apps/holtburger-3d`.
- Passive live capture, representative interaction scenarios, and CDP/interactive camera
  acceptance without character movement or relocation.
- `git diff --check`, credential scan, temporary-diagnostic scan, and final worktree review.

#### Final comparison record

Record before/after population, phase timing, process CPU, camera delivery p50/p95/max, renderer
cadence, scene/build profile, and observation window together. Report Phase 3 and Phase 4 separately
so sleep and admission improvements remain attributable.

## Risks and Mitigations

| Risk                                                           | Mitigation                                                                                                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Treating `WeenieType::Hook` as the rule                        | Derive positive body role from authoritative capability/work facts and census other classes.                                                                               |
| Sleeping or integration demotion removes collision targets     | Separate target demand from integration/activity and test sleeping-peer contact plus report lifetimes.                                                                     |
| State update runs stale physical policy for another tick       | Reconcile semantic state in the coordinator before simulation; synchronously reuse compatible prepared facts or remove stale physical state before async preparation.      |
| Pose-only-to-physical promotion freezes or teleports an entity | Continue the existing pose-only projection lane during preparation and install against the current runtime pose under complete currentness guards.                         |
| Demand oscillation repeatedly decodes content                  | Apply demand-only changes from installed prepared facts; retain repository caching and measure before adding a separate prepared-definition cache.                         |
| A distance cutoff breaks missiles or fast movers               | Keep received entity membership as the first outer cohort; authorize swept/behavior-aware interest only after post-fix evidence.                                           |
| Incremental index retains stale geometry                       | Make Phase 6 conditional and exhaustively test every geometry, pose, target-demand, topology, attachment, suspension, and residency invalidation.                          |
| Compact epochs weaken deterministic transaction semantics      | Preserve stable ID ordering, one immutable tick start, reconciliation currentness, bounded pair solves, and reject-before-commit behavior as acceptance criteria.          |
| Exact-zero quiescence is brittle under float noise             | Use accepted canonical work and existing typed response tolerances; do not add an arbitrary sleep epsilon.                                                                 |
| Retail divergence affects authored idle behavior               | Census the exact zero-gravity cohort, inspect default/root/script work, and add the required greppable marker only after proving no authored observable work is discarded. |
| Camera reorder masks physics debt                              | Require host CPU and population reductions before camera work; prefer changed-body publication before considering a separate camera timeline.                              |
| Live server state changes between captures                     | Record population and workload beside every measurement and compare repeated steady windows, not isolated samples.                                                         |
| Harness moves the character                                    | Keep passive and active modes mutually exclusive and reject outbound movement/teleport options before host start.                                                          |
| ACE behavior is mistaken for retail behavior                   | Use ACE for content/protocol facts and confirm client activity semantics in the retail decompile.                                                                          |

## Decisions and Course Corrections

- **2026-08-29:** Retracted the initial implication that hook physics flags were decoded
  incorrectly. Live and catalog masks match; the demonstrated defect is their derived admission and
  liveness meaning.
- **2026-08-29:** Rejected a new dynamic spatial index as the immediate answer. A cell-based index
  already exists; it is rebuilt per epoch and does not prevent mover environment solves or complete
  participant cloning.
- **2026-08-29:** Split sleep failure from over-admission. Correct admission must not be allowed to
  leave the universal grounded-only quiescence defect untested.
- **2026-08-29:** Preserved camera publication ordering as an open resilience thread rather than a
  root-cause fix.
- **2026-08-29:** Confirmed passive headless observation can expose the root workload even though
  visual choppiness still requires renderer/CDP or interactive confirmation.
- **2026-08-29:** Corrected the retail inference: description/velocity installation initially wakes
  dynamic hooks, and retail's zero-velocity deactivation is also grounded-biased. Work-based
  zero-gravity quiescence may require a documented retail divergence rather than a retail-match
  claim.
- **2026-08-29:** Deferred index/clone redesign until after admission and quiescence. Their measured
  combined cost is approximately `0.170 ms`; environment solving the 276 false movers is
  approximately `2.796 ms` in the current scene.
- **2026-08-29:** Selected an evidence-backed contract direction: one producer-owned composite
  local-physical demand with independent target membership and mover activity. No WCID, display
  name, or `WeenieType::Hook` production predicate is justified.
- **2026-08-29:** Scoped the clean cutover around `LocalPhysicalDemand` with independent target and
  integration enums. Solver-owned `DynamicBodyActivity` and allocation-only
  `PhysicalBodyParticipation` remain separate facts.
- **2026-08-29:** Decided that prepared `DynamicPhysicalBodyDefinition` will not retain producer
  demand. An invariant-bearing configuration joins definition and demand only at scene mutation.
- **2026-08-29:** Decided to delete shared binary `EntityPhysicalIntent`, remove scheduling from
  prepared collision facts, and sweep solver-participation action vocabulary in one phase rather
  than keep aliases.
- **2026-08-29:** Moved client physical realization responsibility out of
  `WorldState::apply_set_state_update` in the plan. World applies semantic authority; the existing
  pre-simulation collision coordinator owns prepared local realization and completion currentness.
- **2026-08-29:** Selected the existing `body_has_simulatable_projection_basis` join as the basis
  for positive runtime motion demand rather than adding another motion-state interpretation.
- **2026-08-29:** Kept the server-maintained received population as the initial physical-interest
  boundary. No second distance cutoff is authorized before corrected-population profiling.
- **2026-08-29:** Made incremental index/compact epoch and changed-body camera publication separate
  conditional phases with explicit resteering gates.
- **2026-08-29:** Dry-running the plan showed the shared transition decision/action hierarchy would
  become a one-producer wrapper after client `SetState` reconciliation moved to the coordinator.
  Deleted it from the target design: producers resolve complete optional configurations and the
  scene reports the mutation it actually committed.
- **2026-08-29:** Selected direct pose-projection candidate derivation over the client's manually
  synchronized `tracked_body_ids` mirror. This deletes event choreography and prevents a missed
  event from becoming hidden scheduler state.
- **2026-08-29:** Corrected the preparation-gap claim. The current pose-only lane skips any body
  considered physically demanded; Phase 4 must delete that check so a pending promotion keeps
  advancing authoritatively until physical installation commits.
- **2026-08-29:** Phase 2 deleted the unused transition payload from
  `WorldEvent::EntityStateUpdated` earlier than originally scheduled. Keeping it until Phase 4
  would have required retaining the deleted transition hierarchy solely as an event artifact.
- **2026-08-29:** Scene configuration equality deliberately excludes solver-owned activity and
  accepted placement. Reapplying the same configuration or changing only target demand preserves
  settlement; integration promotion and changed integration facts wake, integration demotion
  settles, and suspension survives until topology restoration.
- **2026-08-29:** Explorer state-only reconfiguration reuses installed prepared geometry and
  response facts when a body already exists. Content preparation runs only when non-empty demand
  promotes a pose-only body, eliminating the previous decode-on-every-reconfiguration path.
- **2026-08-29:** Phase 2 temporarily retains the broad compatibility-demand calculation in both
  initial client admission and the world-owned client `SetState` path. This duplication is
  deliberate short-lived debt: Phase 3 needs the broad cohort, and Phase 4 deletes both paths when
  the collision coordinator becomes the sole client physical-realization owner.
- **2026-08-29:** Closed the Phase 2 live gate with opt-in host stderr census output rather than a
  new public diagnostic contract. The existing pre-tick projection and scene schedule supply the
  facts without adding canonical state. The probe parser and `HOLTBURGER_CLIENT_PHYSICS_CENSUS`
  path remain temporary through the Phase 4 comparison and are deleted in Phase 9.
- **2026-08-29:** Phase 3 deliberately diverges from retail's grounded-biased deactivation only at
  the solver-activity boundary. A completed zero-work tick can settle zero-gravity grounded-shaped
  and free-flight bodies without support; target membership, reporting, presentation, scripts, and
  all explicit wake facts remain independent. The fresh 6,654-template inert census sizes the
  departure, while runtime-activatable members prohibit using that census as class-based admission.
- **2026-08-29:** Corrected the Explorer report-only fixture instead of preserving a second no-work
  physical tick. Report edges remain independent of projection ticks, and the real target-only
  configuration proves a settled body can still be queried and report without integration.
- **2026-08-29:** Retained temporary opt-in per-stage clocks and child-PID CPU sampling through Gate
  A so Phase 3 and Phase 4 remain directly comparable. These diagnostics are explicitly Phase 9
  cleanup debt, not product contracts.
- **2026-08-29:** Phase 4 used exact `(generation, immutable preparation facts, semantic physics,
  demand)` matching for asynchronous currentness. A separate demand-revision counter and separate
  retry-suppression registry were rejected as duplicate state; the coordinator's keyed target and
  terminal `Unavailable` status already provide both guarantees.
- **2026-08-29:** Deleted `ClientSimulationSystem` after direct projection discovery removed its
  only state. Keeping a zero-sized owner would preserve object-shaped ceremony without ownership.
- **2026-08-29:** Phase 4 live admission retained 26 physical participants and settled 18 initial
  movers to zero across 458 projected entities. Mean collection work fell to `0.0658 ms` and host
  CPU to `7.41%`; Gate A therefore rejects Phase 6 unless another controlled profile contradicts
  this result. The retained index's `0.0294 ms` mean is measurable but not material enough to
  justify a mutation-heavy incremental-index lifecycle.

- **2026-08-29:** Gate A rejected Phases 6 through 8. Corrected-population fixed ticks measured
  1.388 ms p95 and 2.288 ms maximum, complete before/after projection remained sub-millisecond,
  host camera intervals remained near the intended 30 Hz authority cadence, and renderer cadence
  held at approximately 144 Hz without stalls. Incremental indexing, compact epochs, changed-body
  publication, and a separate camera timeline would add more state than the measured work deserves.
- **2026-08-29:** Removed all temporary census, stage/fixed-tick timing, parsing, and process CPU
  sampling code after Gate A. Retained the passive camera-only UI probe as a reusable acceptance
  capability; it requires an explicit mode, rejects teleport input before launch, and reports
  camera/input/render distributions.
- **2026-08-29:** The final quality pass made the Explorer runtime validate the complete derived
  demand/body pair before publication. Missing required preparation and an unexpected prepared body
  are now distinct typed errors, so direct runtime callers cannot bypass driver-side invariants.
- **2026-08-29:** The final quality pass also made wake-up demand-aware and suspension-preserving.
  Ordinary pose/vector/motion updates cannot reintroduce a body whose collision topology is absent,
  and target-only bodies remain settled until positive integration demand arrives.

## Definition of Done

- [x] The user-positioned housing scenario has a durable movement-free reproduction path.
- [x] Body-role and wake/sleep design is justified from retail, ACE, catalog, and live evidence.
- [x] Shared runtime contracts express target demand, integration demand, solver activity, and
      physical allocation without conflation.
- [x] Binary physical intent, prepared scheduling, circular allocation inference, and stale
      solver-participation vocabulary are removed through clean cutovers; no replacement transition
      action hierarchy or tracked-body mirror remains.
- [x] Quiescent zero-gravity bodies sleep even when they cannot acquire ground support.
- [x] Housing hooks derive pose-only demand from their facts and remain correctly rendered,
      selectable, and authoritative.
- [x] Sleeping/target-only collision bodies remain available without entering mover integration.
- [x] Motion, vector, reconciliation, state, topology, and controller transitions promote or wake
      exactly the required bodies.
- [x] Asynchronous completions cannot install stale identity, definition, pose, state, attachment,
      or demand.
- [x] Phase 6 collection work is either proven immaterial and rejected, or made proportional to
      changed targets and active movers.
- [x] Phase 8 publication work is either proven immaterial and rejected, or changed-body-driven.
- [x] Phase 3 and Phase 4 population/timing effects are measured separately, followed by a complete
      before/after CPU, fixed-tick, camera-delivery, and renderer-cadence comparison.
- [x] The camera is smoothly responsive in the demonstrated scene after settlement.
- [x] No camera smoothing or cadence reduction conceals delayed authority data.
- [x] Relevant Rust tests/checks, clippy, frontend checks/lint, and live/browser acceptance pass; the
      two unrelated baseline frontend-test failures remain explicitly recorded below.
- [x] Temporary diagnostics and sensitive data are absent from the final diff.

## Closed execution gates

1. The zero-gravity/no-work rule is retained as the documented retail divergence above. The census
   sized the affected inert-shaped population, while positive motion and reconciliation demand
   preserve runtime-activatable members without a class exception.
2. Index, placement, and participant work are immaterial at the corrected population; neither
   Phase 6B nor Phase 6C is authorized.
3. Complete dynamic projection is immaterial and camera delivery is smooth; Phase 8 is not
   authorized.
4. The server-maintained received population remains the client interest boundary. The corrected
   physical population is small enough that a second swept or distance-based interest policy has
   no measured consumer.

## Final validation record

- Rust formatting passed.
- World, core, and host tests passed: 491, 289, and 246 tests respectively.
- Warnings-denied clippy passed for all touched Rust crates and all targets.
- Svelte and TypeScript checks passed with zero diagnostics; ESLint, dead-code lint, and Rust lint
  passed.
- Frontend tests passed 1,683 of 1,685 assertions. The two failures are the pre-existing
  viewer-light falloff expectations and are unrelated to physics admission, simulation, or camera
  delivery.
- The browser/WebGL harness passed.
- The final passive release capture passed with no chat, movement, or teleport commands.
- Diff whitespace, temporary-diagnostic vocabulary, deleted-policy vocabulary, and credential
  scans passed. The unrelated dirty ACE and ACViewer submodules were preserved.
