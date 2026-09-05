# Holtburger 3D Client-Mode Performance Investigation

Status: **Baseline and representation censuses complete; submission architecture remains under investigation (2026-09-04).**

This worksheet tracks how time is spent in the live `apps/holtburger-3d` client against the local
ACE test server. The account's existing character is parked in the user-selected crushing scene;
the scene, camera, viewport, hardware, and build must stay fixed within each comparison series.

## Context and Boundaries

**Goal:** attribute steady-state client-mode frame cost across browser runtime work, renderer CPU,
GPU submission, and the Rust sidecar well enough to identify the next measured optimization.

In scope:

- the optimized (`dev:client:release`) client composition at the default ACE endpoint;
- steady-state measurements of the already-logged-in character and scene;
- V8 sampling profiles, existing renderer CPU/GPU phase clocks, runtime tick phase clocks, and
  native Rust sampling;
- workload counters needed to explain each timing;
- temporary diagnostic changes needed to make those facts observable.

Out of scope:

- implementing optimizations before attribution is stable;
- TUI performance;
- synthetic Explorer or browser-harness scenes as substitutes for the reported live scene;
- cleaning up temporary probes during investigation (the user intends to reset them later).
- streaming, startup, relocation, and content-publication performance; those are a separate effort.

## Architecture and Ground Truth

The Electron main process owns a release Rust sidecar. `ClientLifecycleSession` mirrors its typed
events, and `ClientPresentationSession` adapts those authority facts into the shared
`GamePresentationRuntime`. The browser drives `tick()` and `render()` once per
`requestAnimationFrame`; the WebGL2 renderer owns draw selection and submission. This gives four
separate clocks that must not be conflated:

1. rAF interval/callback wall time in `src/client/ClientApp.svelte`;
2. shared runtime phases in `src/lib/game/runtime/runtime-tick-profiler.ts`;
3. renderer CPU and delayed GPU phases in `src/lib/game/renderer/webgl2-renderer.ts`;
4. native host samples rooted in `host/src/client_runtime.rs` and its shared Rust dependencies.

Reference sources:

- `apps/holtburger-3d/AGENTS.md` — canonical renderer profiling conventions;
- `apps/holtburger-3d/src/client/ClientApp.svelte` — client rAF owner;
- `apps/holtburger-3d/src/client/client-presentation-session.ts` — client/runtime adapter;
- `apps/holtburger-3d/src/lib/game/runtime/game-presentation-runtime.ts` — update and render phases;
- `apps/holtburger-3d/src/lib/game/renderer/renderer.ts` — timing and workload contracts;
- `apps/holtburger-3d/host/src/client_runtime.rs` — native client authority composition.

## Measurement Rules

- Use release Rust code; a debug-sidecar profile is not representative.
- Let world entry and content realization settle for at least 10 seconds before a steady-state
  window.
- Record viewport/drawing-buffer size, scene residency, visible populations, draw counts, render
  settings, CPU/GPU identity, and build revision beside every result.
- Capture at least three same-configuration windows. Report medians and spread; never optimize from
  one sample.
- V8 sampling and phase clocks may run together for attribution, but use an instrumentation-off
  cadence capture as the FPS control because profiling itself has cost.
- Renderer GPU timings are sums of non-nesting elapsed-query phases, not whole-frame wall time.
- Rust sidecar utilization is not renderer utilization. Profile it independently, then compare its
  process CPU to its fixed/event-driven cadence before declaring it frame-bound.
- Do not infer a bottleneck from draw count or primitive age. Primitive assets can still induce
  expensive state churn, overdraw, visibility work, allocation, or driver synchronization.

## Phase 0: Make the Live Scene Observable

Acceptance criteria:

- [x] Non-interactive client-mode probe enters the parked character without moving it.
- [x] Machine-readable output includes rAF rates, runtime tick phases, renderer CPU/GPU phases,
      workload counters, and the exact viewport/residency.
- [x] A standard Chrome `.cpuprofile` is written for the same measurement window.
- [x] A native sampling method for the release sidecar is proven on this machine.

Decisions and findings:

- The renderer and runtime profilers already exist. Explorer and the browser harness inject/expose
  them, but client mode currently does neither. The first diagnostic change should wire these
  existing contracts into client mode rather than invent parallel timers.
- `perf` is installed at `/usr/bin/perf`; native symbol availability is provided by the workspace
  `profiling` Cargo profile. Ordinary release symbols proved sufficient to name the important
  Rust functions, so the launcher did not need a profiling-build branch.
- Profile mode performs no keyboard, mouse, camera, chat, teleport, or selection input. Evidence
  from all runs retained camera generation 1, a settled 4.5 m reach, and the same outdoor
  `0xc6a9ffff` player/camera residency. The only page mutation during the window was enabling and
  resetting diagnostic clocks.
- The probe now accepts `HOLTBURGER_PROBE_PROFILE_INSTRUMENTATION=0` for a clocks-off control,
  writes the full machine-readable result to `HOLTBURGER_PROBE_REPORT`, and writes V8's standard
  CPU profile to `HOLTBURGER_PROBE_CPU_PROFILE`.

Reproduction, after loading `ACCOUNT` and `PASSWORD` from `.dev.env` without printing them:

```bash
HOLTBURGER_PROBE_ACCOUNT="$ACCOUNT" \
HOLTBURGER_PROBE_PASSWORD="$PASSWORD" \
HOLTBURGER_PROBE_MODE=profile \
HOLTBURGER_PROBE_REPORT=/tmp/holtburger-client-run.json \
HOLTBURGER_PROBE_CPU_PROFILE=/tmp/holtburger-client-ts.cpuprofile \
npm run probe:client:ui
```

The probe waits ten seconds after world readiness, then records ten seconds in place. Native
sampling used the exact child sidecar PID during that post-settle window:

```bash
perf record -F 499 -g --call-graph dwarf -p <sidecar-pid> \
  -o /tmp/holtburger-client-rust.perf.data -- sleep 8
```

## Phase 1: Establish the Baseline

Every row begins after the ten-second settle. Window FPS is `rendered frames / wall time`, while
"end EMA" is the client display sampler's colder final reading; the former is the comparison
figure.

| Run     | Instrumentation |   Window | Frames | Window FPS | End EMA FPS | rAF work ms | Runtime ms | Renderer CPU ms | GPU ms | Native sample                |
| ------- | --------------- | -------: | -----: | ---------: | ----------: | ----------: | ---------: | --------------: | -----: | ---------------------------- |
| Control | off             | 10.096 s |    948 |      93.90 |       87.96 |       10.02 |          — |               — |      — | —                            |
| 1       | phase + V8      | 10.163 s |    882 |      86.79 |       81.94 |       10.83 |      10.53 |            7.47 |   1.39 | early/provisional            |
| 2       | phase + V8      | 10.159 s |    902 |      88.79 |       83.30 |       10.54 |      10.27 |            7.35 |   1.33 | 3,016 samples/8 s; 13 lost   |
| 3       | phase + V8      | 10.200 s |    895 |      87.75 |       83.56 |       10.65 |      10.19 |            7.40 |   1.30 | 2,742 samples/8 s; none lost |

Instrumented medians are 87.75 FPS, 10.65 ms rAF work, 10.27 ms shared-runtime work,
7.40 ms renderer CPU, and 1.33 ms summed GPU work. Run-to-run ranges are respectively 2.00 FPS,
0.28 ms, 0.34 ms, 0.11 ms, and 0.09 ms. The combined phase/V8 instrumentation costs about
0.63 ms per callback against the single off control, so absolute production cost should use the
control and phase proportions should use the instrumented set.

Workload record:

| Fact                                            |                                              Value |
| ----------------------------------------------- | -------------------------------------------------: |
| Git revision                                    |                                     `10e0cb00c473` |
| CPU                                             |           AMD Ryzen 9 5900X, 12 cores / 24 threads |
| GPU                                             | AMD Navi 31, Radeon RX 7900 XT-family PCI identity |
| OS                                              |                                 Linux 7.1.8 x86-64 |
| CSS viewport / drawing buffer                   |            1441 × 903 / 1441 × 903, render scale 1 |
| Player / camera residency                       |              `0xc6a9ffff` / `0xc6a9ffff`, outdoors |
| Views / visible scene entries                   |                                            1 / 415 |
| Static nodes / dynamic entities / dynamic parts |                                   30 / 143 / 2,101 |
| Object / dynamic draws                          |                                      2,574 / 1,944 |
| Dynamic instances                               |            2,131 (1.10 instances per dynamic draw) |
| Particle batches / instances                    |                                  260 / 1,840–1,917 |
| Portal scopes / crossings / atlas pixels        |                                45 / 66 / 1,351,980 |
| PSSM mapped / analytic / rejected roots         |                                         8 / 24 / 1 |
| PSSM compatible depth runs / upload bytes       |                                       124 / 11,520 |

Raw disposable artifacts:

- `/tmp/holtburger-client-control.json`
- `/tmp/holtburger-client-run2.json`, `/tmp/holtburger-client-run3.json`
- `/tmp/holtburger-client-ts-run1.cpuprofile` through `run3.cpuprofile`
- `/tmp/holtburger-client-rust-run1.perf.data` through `run3.perf.data`

## Phase 2: Attribute TypeScript and GPU Cost

- [x] Rank V8 self-time and total-time nodes, normalized per rendered frame.
- [x] Reconcile hot V8 functions with runtime and renderer phase means.
- [x] Separate browser callback work from excess event-loop delay.
- [x] Rank renderer CPU and GPU phases by mean cost and percentage of the measured total.
- [x] Use workload counters to distinguish per-item cost from unexpectedly large populations.
- [x] Run one-factor diagnostic toggles only after the baseline points to a subsystem.

### Frame ledger

The clocks nest; they are not additive rows. The median instrumented callback was 10.65 ms.
`GamePresentationRuntime` accounts for 10.27 ms of it, including 7.40 ms in the renderer. The
remaining approximately 0.38 ms covers client orchestration around the shared runtime. At the
control's 93.90 FPS, the full frame interval was 10.65 ms against 10.02 ms of synchronous callback
work, leaving approximately 0.63 ms for scheduling/composition outside the callback.

The user's 200 FPS target is a 5 ms total budget. The current callback alone is twice that, while
the GPU's measured phase sum is only 1.33 ms. This scene is CPU/driver-submission limited, not
fragment or shader limited.

Median runtime/renderer CPU attribution:

| Phase                                | Mean ms | Share of 10.27 ms runtime |
| ------------------------------------ | ------: | ------------------------: |
| Renderer total                       |    7.40 |                     72.0% |
| Dynamic presentation publication     |    2.64 |                     25.7% |
| Other runtime update phases combined |    0.23 |                      2.3% |
| └ opaque submission                  |    3.03 |                     29.5% |
| └ scene-contribution resolution      |    1.63 |                     15.8% |
| └ instance-run preparation           |    0.61 |                      6.0% |
| └ outdoor shadow map                 |    0.51 |                      4.9% |
| └ portal planning                    |    0.35 |                      3.4% |
| └ scene query                        |    0.29 |                      2.8% |
| └ particle submission                |    0.27 |                      2.6% |

The renderer's CPU total is not GPU wait in disguise: the median summed GPU work is 1.33 ms.
Largest GPU phases are opaque objects (0.58 ms), portal composition (0.34 ms), near/far terrain
combined (0.16 ms), particles (0.10 ms), and ambient occlusion (0.08 ms). Shadows cost about
0.015 ms on GPU despite 0.51 ms of CPU preparation/submission.

### V8 corroboration

The three native V8 profiles agree closely when normalized per rendered frame:

| Function/path                             | Inclusive or self ms/frame | Interpretation                            |
| ----------------------------------------- | -------------------------: | ----------------------------------------- |
| `ClientApp.frame`                         |      10.14–10.32 inclusive | agrees with the callback clock            |
| `executePortalScopeAtlasFrame`            |        6.24–6.32 inclusive | agrees with the renderer-dominated ledger |
| `drawObjectRange`                         |        2.60–2.63 inclusive | agrees with opaque submission             |
| `DynamicEntitySystem.publishPresentation` |        1.91–1.97 inclusive | majority of publication phase             |
| `DynamicEntitySystem.applySample`         |        1.85–1.89 inclusive | animated entity pose/bounds publication   |
| `resolveSceneContributions`               |        1.54–1.58 inclusive | agrees with its renderer bucket           |
| `transformAABB3`                          |        1.07–1.12 inclusive | hottest named leaf family                 |
| `bindWebGL2ObjectInstanceRange`           |        0.95–0.98 inclusive | per-draw instance attribute rebinding     |
| V8 garbage collector                      |             0.34–0.39 self | visible allocation pressure               |

The concrete code paths explain these samples:

- `transformAABB3` constructs eight `Vec3` corners, maps each through a transform, constructs three
  more coordinate arrays for `Math.min`/`Math.max`, and does so while frame-current bounds are
  published. The scene reports 2,101 material-range contributions, not distinct rigid parts (the
  later identity census found 515 rigid-part payloads). Supplying a target box only reuses the final
  box; it does not reuse those transient corners or arrays. This is both a CPU and GC cost, not a
  mathematical complexity mystery.
- Dynamic draw batching is effectively absent in this scene: 2,131 instances become 1,944 draws,
  only 1.10 instances per draw. Every instanced range repeats five `enableVertexAttribArray`, five
  `vertexAttribPointer`, and five `vertexAttribDivisor` calls. V8 independently attributes about
  0.95–0.98 ms/frame inclusively to that binding helper.
- The renderer attempts 26,742 object uniform writes per frame. Its state applicator suppresses
  about 23,570, but the calls and comparisons still happen; 3,164–3,172 reach WebGL. Combined with
  661–755 texture binds and 2,574 draws, primitive triangle counts do not translate into cheap CPU
  submission.
- Particles, AO, terrain, and GPU shadows are not first-order targets in this scene. Their combined
  measured opportunity is much smaller than entity publication and object submission.

## Phase 3: Attribute Rust Host Cost

- [x] Record process/thread CPU while the scene is steady.
- [x] Capture a native sample over the same duration as a browser window.
- [x] Resolve the hottest symbols to authoritative host/session/world paths.
- [x] Distinguish network/event bursts from fixed-tick work and idle blocking.
- [x] State whether Rust can plausibly constrain presentation cadence, with evidence.

Two post-settle 499 Hz, eight-second samples captured 3,016 and 2,742 scheduled samples. That is
approximately 76% and 69% of one logical CPU of task time; run 2 lost 13 samples under profiler I/O
pressure and run 3 lost none. Treat the range as utilization scale, and run 3 as the cleaner symbol
distribution.

The sidecar is not idle or network-bound. Samples land in the 30 Hz `ClientRuntime` physics branch
on both its tokio worker and publication/main thread. Repeated hot symbols fall into three groups:

1. Collision and placement: `CollisionScene::transit_cell_installed`,
   `part_reaches_building_portal`, static-surface ray/sweep functions, Parry GJK/support-map work,
   `BodyProjectionResolver::resolve`, and `LandblockPlacement::to_local_space`.
2. Full dynamic projection/diff: `project_client_dynamic_entity`, entity/body/property lookups,
   `MotionRuntimeRegistry::motion_presentation`, hash-map insertion/rehash, and raw-table drop.
3. Allocation/deallocation: Rust deallocation plus unresolved libc allocator frames occupy a large,
   variable fraction of the publication thread.

The source path supplies the missing causal context. Every 30 Hz physics turn builds
`current_dynamic_entity_views()` before simulation, runs simulation/collision, builds the complete
view collection again afterward, converts the first collection into a new `HashMap`, and diffs the
two owned projections. Each projection revisits every registered entity and clones owned name,
appearance, spatial-membership, radar, and motion-presentation data. This is a code smell even
before optimization: unchanged semantic content is being reconstructed twice to discover which
placement facts changed.

The host cannot directly serialize WebGL calls, because it is a separate process and the browser
continues independently between 30 Hz events. It can still add CPU contention and IPC/publication
work, and its full tick batches feed the browser's 2.64 ms publication phase. Therefore it is a
real independent cost center, but not the direct cause of the renderer's 3.03 ms opaque-submission
cost.

## Phase 4: Reconcile and Recommend

- [x] Produce one frame-budget ledger: measured browser work, measured renderer/GPU work,
      unexplained rAF delay, and independently measured host work.
- [x] Identify the top two or three optimization candidates with expected ceiling and confidence.
- [x] Record counterfactual experiments that would falsify each candidate.
- [x] Call out instrumentation artifacts, unresolved gaps, and code smells separately from proven
      costs.

Recommended order:

1. **Remove frame-hot dynamic bound allocation and redundant spatial synchronization (high
   confidence).** `applySample` costs about 1.85–1.89 ms/frame, `transformAABB3` alone costs
   1.07–1.12 ms, and GC costs another 0.34–0.39 ms. First test an allocation-free AABB transform
   using direct center/extents or scalar corner accumulation, then determine whether unchanged
   root/part bounds can skip tree reindexing. Falsifier: the replacement removes the V8 leaf/GC
   samples but does not reduce the `presentationPublish` bucket or off-instrumentation callback.
2. **Reduce dynamic draw/state-call count, not shader work (high confidence, larger design
   question; investigated below).** The measured ceiling around `drawObjectRange` is
   2.60–2.63 ms/frame, and the instance-binding helper alone is about 0.96 ms. The one-factor
   follow-up proved a small, local VAO-state win and showed that the remaining draw-count problem
   belongs to dynamic geometry representation, not scheduling.
3. **Replace host before/after owned snapshots with change-owned projection (high confidence for
   host CPU; indirect FPS effect).** Compute placement/motion deltas from the authoritative bodies
   and retain immutable semantic fields rather than cloning every view twice. Also time collision
   separately before changing solver policy. Falsifier: phase timing shows collision consumes
   essentially the entire 30 Hz tick and snapshot/diff removal does not reduce host task-clock or
   browser tick-batch application.

Do not begin with AO, particles, terrain shaders, portal composition, or GPU shadow resolution for
this workload. Their measured GPU totals cannot recover the required approximately 5 ms CPU budget.

## Phase 5: Dynamic Draw and State Reduction Follow-up

- [x] Capture one settled frame's production run sizes without moving the player or camera.
- [x] Compute single-axis counterfactual grouping ceilings at the production run-formation boundary.
- [x] Isolate invariant VAO attribute state from required per-range pointer offsets.
- [x] Repeat the state experiment and return to the old behavior for an A/B/A control.

### Why dynamic instances do not batch

The one-shot census ran after the ten-second settle and detached before timing began. It saw 2,135
dynamic frame instances become 1,948 production draws. Of those draws, 1,854 (95.2%) were
singletons; the largest run contained 38 instances. Perfect grouping under every current semantic
constraint also produced exactly 1,948 draws. Therefore neither opaque ordering nor the run
scheduler leaves compatible instances separated in this scene.

A follow-up identity census corrected an important naming assumption. In a comparable frame, 2,129
range-level instances came from only 515 distinct reusable rigid-part transform/color payloads across
142 dynamic entities. The renderer's `visibleDynamicPartCount` was 2,099 because it actually counts
retained material-range contributions, not rigid parts; plural portal-scope routing added the other
30 submissions. Each physical rigid part therefore fans out to about 4.1 submitted ranges. This
metric name is a code smell and the original 2,135 figure must not be interpreted as a part count.

The same frame formed 1,942 draws: 1,848 singleton runs and only 94 multi-instance runs. Instancing
therefore removed 187 of 2,129 potential per-range draws, an 8.8% draw-count reduction, while every
dynamic range still paid the instanced-program, arena preparation/upload, and pointer-binding path.
This does not prove that instancing is a net loss—the uniform alternative has matrix/color uploads
and may introduce program transitions—but it disproves the assumption that universal dynamic
instancing is self-evidently deserved. The next causal comparison should be current all-instanced
submission versus a singleton-uniform/multi-run-instanced hybrid, with program changes, run
preparation, upload, and opaque submission measured together.

Each counterfactual below removes exactly one compatibility axis while retaining phase boundaries,
transparency cohorts, and all other axes. The figures are optimistic draw counts, not proposals,
and their savings are not additive.

| Compatibility model                         | Draws | Reduction from 1,948 |
| ------------------------------------------- | ----: | -------------------: |
| Production ordering and compatibility       | 1,948 |                    — |
| Perfect grouping, all current axes retained | 1,948 |             0 (0.0%) |
| Ignore landblock identity                   | 1,948 |             0 (0.0%) |
| Ignore outdoor-lighting role                | 1,948 |             0 (0.0%) |
| Ignore render-scope identity                | 1,703 |          245 (12.6%) |
| Make material/device state uniform          | 1,693 |          255 (13.1%) |
| Ignore geometry and index-range identity    |   472 |        1,476 (75.8%) |

Geometry/range identity is the dominant partition. The 472-draw figure is deliberately a ceiling:
ordinary instancing cannot submit heterogeneous geometry ranges with heterogeneous rigid-part
transforms in one call merely by sorting or concatenating buffers. Approaching it needs a different
dynamic publication/submission representation—such as whole-appearance geometry where transforms
permit it, vertex-driven draw metadata, or a proven multi-draw path. That is a broader architectural
change and must be designed against the future 3D client, not smuggled in as another batching-map
tweak. Render-scope and material changes have much smaller isolated ceilings, while landblock and
lighting-role changes have none here.

### Invariant vertex-input state experiment

WebGL2 stores attribute enable flags and divisors in the bound VAO. Pointer offsets still vary for
each frame-instance range, but the five enable flags and five divisors do not. The measured prototype
records which geometry VAOs initialized valid pointers and invariant state together, then issues only
the five required `vertexAttribPointer` calls. Draws, instance records, pointer offsets, materials,
ordering, and shaders remain unchanged.

The paired baseline and return control used the same diagnostic code and forced the old calls on.
Candidate rows used the VAO initialization guard. All captures used the same stationary residency,
1441 × 903 drawing buffer, release sidecar, ten-second settle, and approximately 2,578 object draws.

| Configuration               | Samples |       Opaque submission ms |            Renderer CPU ms |                   rAF work ms |                End EMA FPS |
| --------------------------- | ------: | -------------------------: | -------------------------: | ----------------------------: | -------------------------: |
| Old calls, initial baseline |       1 |                      3.081 |                      7.524 |                        10.937 |                      79.54 |
| VAO invariant guard         |       3 | 2.595–2.626 (2.600 median) | 6.965–7.074 (7.036 median) | 10.240–10.486 (10.481 median) | 78.54–83.48 (82.43 median) |
| Old calls, return control   |       1 |                      3.105 |                      7.517 |                        10.785 |                      81.41 |

Against the mean of the two old-call controls, the candidate removes 0.493 ms (15.9%) from opaque
submission and 0.484 ms (6.4%) from total renderer CPU. V8 samples corroborate the mechanism:
`vertexAttribDivisor` fell from 91.7/100.2 ms per ten-second control window to 5.9–6.5 ms, while
`enableVertexAttribArray` fell from 141.2/143.9 ms to 9.4–10.4 ms. Required
`vertexAttribPointer` work remained and therefore becomes the majority of the helper's residual
cost. Whole-frame work moved in the expected direction, but live script/particle variation makes
FPS too noisy to claim more than the renderer-owned reduction.

An attempted cleanup moved enable/divisor setup to object-VAO allocation, before instance pointers
were buffer-backed. Its counters remained identical and no console error was reported, but visual
inspection found buildings, trees, and other geometry missing. The run is invalid and its 2.520 ms
opaque / 6.787 ms renderer timings must not be used. CPU submission counters cannot establish visual
correctness because they increment even when backend validation rejects or suppresses a draw. The
allocation-time change was reverted; incomplete VAO state before first instanced use is the leading
mechanism, but it is not yet proven by a captured GL error.

The restored first-bind guard was then recaptured to PNG. The frame visibly contains the foreground
roofs and walls, central tower and houses, and near and distant trees. It retained 630 static and
1,948 dynamic draws, with 2.606 ms opaque submission. This closes the visual-validation gap for the
measured form without rehabilitating the rejected allocation-time form.

Conclusion: retain the measured first-bind guard, and do not spend another iteration on dynamic
sorting. Any material draw-count reduction must start by designing and censusing an alternative
dynamic geometry contract, with the 472 figure used only as an upper bound rather than an expected
result. Streaming performance remains explicitly out of scope for this phase, though a future
representation must still preserve clear residency ownership.

Raw disposable artifacts:

- `/tmp/holtburger-dynamic-census-baseline.json` and `.cpuprofile`
- `/tmp/holtburger-dynamic-state-1.json` through `-3.json` and matching `.cpuprofile` files
- `/tmp/holtburger-dynamic-state-control.json` and `.cpuprofile`
- `/tmp/holtburger-dynamic-state-final.json` and `.cpuprofile` (invalid visual result; timings rejected)
- `/tmp/holtburger-dynamic-state-visual-check.json`, `.cpuprofile`, and `.png` (restored first-bind guard)
- `/tmp/holtburger-dynamic-part-census.json`, `.cpuprofile`, and `.png` (range-to-rigid-part identity census)

## Phase 6: Test Whether Universal Dynamic Instancing Is Deserved

- [x] Add an explicit diagnostic mode that converts only singleton opaque/alpha-test dynamic runs
      to uniform-transform draws; retain instancing for real multi-runs and transparency.
- [x] Count converted draws, instance-arena work, program changes, and complete submission cost.
- [x] Capture at least three stationary hybrid windows with screenshots and an all-instanced return
      control.
- [x] Keep or reject the hybrid from renderer-owned timings and visual evidence, then record what
      that means for a larger dynamic representation redesign.

The comparison deliberately changes no geometry, material, ordering, scope, culling, animation, or
streaming policy. Opaque and alpha-tested dynamic contributions have unit instance color under the
current producer contract; transparent contributions retain instancing because their instance alpha
is presentation state that the existing uniform-transform shader does not consume. Any non-unit
singleton color encountered in hybrid mode is an invariant failure, not an implicit fallback.

All three hybrid screenshots retain the complete foreground and distant building/tree geometry. The
hybrid converted 1,838–1,843 singleton dynamic draws while leaving total dynamic and object draw
counts unchanged. The table compares the three-run median to the immediately following all-instanced
return control; this is deliberately conservative because earlier all-instanced first-bind runs were
slower than the return control.

| Metric                        | All-instanced control | Hybrid median |      Hybrid change |
| ----------------------------- | --------------------: | ------------: | -----------------: |
| Opaque submission CPU         |              2.504 ms |      2.092 ms | -0.412 ms (-16.5%) |
| Total renderer CPU            |              6.676 ms |      6.229 ms |  -0.446 ms (-6.7%) |
| Whole rAF callback work       |              9.879 ms |      9.419 ms |  -0.460 ms (-4.7%) |
| Instance upload CPU           |              0.110 ms |      0.062 ms | -0.048 ms (-44.0%) |
| Frame-instance upload bytes   |               237,760 |        90,320 |  -147,440 (-62.0%) |
| Summed GPU work               |              1.291 ms |      1.062 ms | -0.229 ms (-17.7%) |
| Opaque GPU work               |              0.563 ms |      0.322 ms | -0.241 ms (-42.9%) |
| Object program changes        |                    54 |            82 |                +28 |
| Issued object uniform uploads |                 3,174 |         3,620 |               +446 |

The hybrid wins despite its deliberately unoptimized program order: switching between uniform and
instanced programs adds program, lighting, and static-light binds. V8 sampling confirms the expected
exchange: instance-range binding and pointer samples collapse, while matrix-uniform and ordinary
`drawElements` samples rise. On this Navi 31/Mesa system, singleton `drawElementsInstanced` also has
a measurable GPU penalty relative to `drawElements`; that device-specific effect is included but
must not be assumed on other backends.

Clocks-off controls agree on synchronous capacity: hybrid callback work was 9.146 ms versus 9.460 ms
all-instanced. Their endpoint FPS EMA ordered inconsistently, so it is not used to size the win.

Conclusion: universal dynamic instancing is not deserved for this scene. A hybrid policy is cheaper,
but it preserves all ~1,950 draws and therefore cannot approach the 5 ms target alone. The larger
representation effort should optimize the real fan-out—515 rigid parts becoming ~2,100 material
ranges—and treat instancing as an optional terminal strategy for proven compatible repetition, not
as the representation itself. Before a production cutover, the singleton policy needs broader
dynamic-effect/content coverage, particularly non-unit instance color outside ordinary opaque
ranges; the current switch remains diagnostic evidence rather than a universal contract.

Raw disposable artifacts:

- `/tmp/holtburger-dynamic-hybrid-1.json` through `-3.json`, matching `.cpuprofile` files, and PNGs
- `/tmp/holtburger-dynamic-hybrid-control.json`, `.cpuprofile`, and `.png`
- `/tmp/holtburger-dynamic-hybrid-off.json` and `.png`
- `/tmp/holtburger-dynamic-hybrid-control-off.json` and `.png`

## Phase 7: Reframe Dynamic Geometry from First Principles

- [x] Separate range-level submissions from actual rigid-part and dynamic-root counts.
- [x] Census immutable appearance-template and template-part reuse in the settled scene.
- [x] Calculate per-entity and cross-entity pose-palette draw ceilings while retaining current
      material/device-state, render-scope, phase, lighting, landblock, and transparency boundaries.
- [x] Calculate the corresponding state-agnostic ceilings to identify the next structural barrier.
- [x] Capture and inspect the complete scene without moving the player or camera.

The existing `visibleDynamicPartCount` name is misleading: it increments for each material-range
contribution, not each rigid setup part. The census therefore retains canonical template, part,
root, and range provenance through one explicitly requested diagnostic frame rather than inferring
one population from another.

| Settled-scene population                                      | Count |
| ------------------------------------------------------------- | ----: |
| Visible dynamic roots reported by selection                   |   143 |
| Dynamic roots contributing rigid geometry                     |    98 |
| Distinct immutable appearance templates                       |    48 |
| Actual rigid-part instance payloads                            |   515 |
| Distinct immutable template parts                             |   397 |
| Material-range contributions before render-scope duplication  | 2,102 |
| Range-level frame instances after render-scope routing         | 2,132 |
| Distinct immutable template draw units                         | 1,706 |
| Maximum ranges on one visible rigid part                       |    40 |

Only 143 of the 515 rigid-part instances belong to a template part repeated by another visible
entity; 372 (72.2%) have no second visible instance of that template part. At whole-appearance
granularity, 41 of the 98 geometry-contributing roots use a template seen only once, while 57 roots
share a repeated template. The largest appearance-template multiplicity is 19. The difference
between 2,102 range occurrences and 1,706 immutable template draw units also means only 396 range
occurrences are repetitions of another visible immutable range. These are not 2,132 interchangeable
copies of a small dynamic mesh population.

The pose-palette counterfactual models a compiled geometry stream whose vertices identify their
rigid part and select that part's transform from an entity pose palette. It removes geometry/range
identity only inside its named scope. It retains all current render phases, transparent cohorts,
render-scope routing, landblock offsets, lighting roles, and exact device-state equality. The
state-agnostic rows additionally remove exact material/device-state equality and are deliberately
optimistic ceilings, not immediately valid WebGL2 submissions.

| Representation counterfactual                                      | Draws | Reduction from 1,945 |
| ------------------------------------------------------------------ | ----: | -------------------: |
| Current dynamic submission                                         | 1,945 |                    — |
| Per-entity pose palette, current device-state partitions            |   540 |        1,405 (72.2%) |
| Per-template pose palette plus cross-entity instancing, current state |   474 |        1,471 (75.6%) |
| Per-entity pose palette, material/device state made data-driven      |   120 |        1,825 (93.8%) |
| Per-template pose palette plus instancing, state made data-driven    |    83 |        1,862 (95.7%) |

The independent global counterfactual that ignores geometry/range identity produces 473 draws;
the template-scoped pose-palette result is 474. This agreement is a useful invariant under current
exact material/device-state compatibility. It does not prove that full appearance keys are the
optimal geometry-sharing key once material selection becomes data-driven.

### Conclusions

Instancing is not the dynamic representation. After geometry is merged under current state rules,
cross-entity template instancing removes only 66 additional draws (540 to 474). After material
state is hypothetically made data-driven, it removes only 37 (120 to 83). It remains a legitimate
terminal backend strategy for repeated compatible appearances, but making every material range an
instance first creates substantial upload and vertex-input work for very little draw coalescing.

The deserved representation is an immutable compiled geometry layout plus a replaceable appearance
binding and small per-entity state:

1. Compile each geometry layout into merged partitions. Vertices carry a rigid-part selector; each
   partition preserves genuinely unavoidable phase and fixed-function boundaries. The candidate
   layout identity is setup plus effective ordered part-geometry identities, not entity or
   landblock identity.
2. Bind the layout to one resolved material table for the entity's current appearance. Move
   material selection that can vary in shader data into this table and a texture array/atlas
   contract. Exact AC texture, detail, palette, alpha-test, wrap, cull, and luminosity distributions
   must be censused before choosing partitions; the 120/83 rows intentionally assume all current
   state can be unified and therefore overstate what is directly attainable.
3. Publish one pose palette and entity-level modifiers per visible dynamic root. Do not recreate a
   frame submission object for every part/material range.
4. Let the renderer optionally instance repeated entities with compatible active layout and
   material bindings. The shared world/content contract should not require instancing, because 41
   of 98 rendered roots have singleton full-appearance keys and the measured incremental ceiling is
   small.
5. Keep transparent ordering and effect-driven color/alpha explicit. Neither the opaque singleton
   experiment nor these ceilings authorize collapsing order-dependent draws.

This is a clean change in ownership rather than another batching-map optimization: immutable
geometry layout belongs to a shared visual-layout resource; the active material binding belongs to
the entity's replaceable appearance; animation publishes poses; the frame publishes visible entity
references and entity modifiers; the renderer chooses uniform or instanced submission.

### Landblock, Streaming, and Appearance-Change Constraints

The representation is compatible with existing landblock and streaming boundaries only under the
following invariants:

- Compiled vertices remain setup/part-local. Neither landblock-local placement nor the camera's
  anchor-relative offset enters a retained geometry resource. The dynamic entity continues to
  publish its current landblock-local root and part transforms; the renderer derives the current
  landblock offset per frame.
- Landblock identity, selected portal visibility-island scope, and transparent cohort remain draw
  boundaries. A dynamic entity reaching plural selected scopes still produces one submission per
  selected domain. Every pose-palette census row above retained these boundaries.
- Shared layout resources use the existing visual-template repository's reference-counted resource
  ownership rather than landblock ownership. Evicting a landblock or spawned entity drops that
  dynamic owner; geometry and atlas resources remain only while another owner retains them.
- A template-local material selector must not encode a transient atlas rectangle in immutable
  vertices. It selects a small renderer-resolved material-table entry. Atlas publication or
  compaction updates/invalidates that table through the existing `atlas-publication` path rather
  than rewriting merged geometry.
- The GPU cutover replaces the current per-part geometry allocations; it must not retain both
  representations indefinitely. Original CPU geometry remains only for named consumers such as
  selection and pose bounds.
- Template/layout preparation remains staged and cancellable. The current visual preparer is
  main-thread inline, so heavier merged-geometry construction may create streaming hitches unless
  moved behind the existing preparer boundary. Measuring that construction and relocation cost is
  still the separate streaming effort.

Live appearance mutation adds a second identity axis. `ObjDescEvent` can replace palette ranges,
part-local textures, and setup-part GfxObjs without changing the object's instance generation. ACE
serializes the current object-instance sequence and advances the independent visual-description
sequence (`WorldObject_Networking.cs:45-54`), including after equipment changes
(`Creature_Equipment.cs:365,438`). Retail accepts an equal instance sequence and then applies only a
wrap-newer visual-description sequence (`acclient.c:138209-138241,137180-137205`). Holtburger world
already implements those two sequence gates and emits an appearance update.

The browser runtime currently contradicts that authority: its `dynamicVisualKey` includes the full
appearance, but same-generation changes to that key throw as an invariant violation. Appearance is
therefore not immutable for an entity generation, and the representation work must remove that
assumption rather than encode it into a compiled-template API.

The replacement contract should distinguish:

1. **Geometry-layout change:** a part GfxObj substitution changes the effective ordered part
   geometry and may select another compiled merged layout.
2. **Material-binding change:** palette or texture substitutions usually retain the layout and
   replace only the resolved material table and atlas requirements.
3. **Entity identity and pose continuity:** neither change replaces the scene root, landblock
   placement, attachment topology, animation cursor, pose palette, or behavior state merely because
   its visual resources changed.

Prepare replacement layout/material resources transactionally, keep the last complete visual
installed until the replacement is ready, and commit only the latest accepted appearance level.
If the entity or its residency owner disappears while preparation is pending, release the stage and
reject its late completion through the existing desired-record/owner-generation guards. Selection
and collision products affected by a GfxObj substitution retain their existing independent
invalidation rules; rendering must not pretend an old geometry-dependent query is current.

The present census keys by the full resolved appearance, so its 41 singleton appearances may
include entities that share geometry but differ in palette or texture substitutions. That can
understate reusable geometry-layout population and is another reason not to make instancing or the
current full-appearance key foundational. It does not weaken the measured result that current
range-level instancing removes few draws; a layout/material-variant census is required before sizing
the final cache split.

Streaming construction and residency timings remain outside this investigation. These constraints
establish ownership and correctness; they do not claim that replacement preparation or relocation
is already hitch-free.

The final screenshot retained all foreground roofs and walls, the central tower and houses, and
near and distant trees. Player and camera residency remained `0xc6a9ffff`, and the profile path sent
no movement, camera, selection, chat, or teleport input.

Raw disposable artifacts:

- `/tmp/holtburger-dynamic-template-census.json` and `.png`
- `/tmp/holtburger-dynamic-pose-palette-census.json` and `.png`
- `/tmp/holtburger-dynamic-template-palette-census.json` and `.png`
- `/tmp/holtburger-dynamic-representation-census.json` and `.png`

## Additional Structural Evidence Before Implementation Phasing

The user prefers removing dynamic mesh instancing and its branching strategies when the measured
benefit does not justify them. The current candidate is ordinary merged draws; shared geometry
storage with non-instanced multi-draw is a competing candidate. Neither has yet been benchmarked
as the complete replacement. Existing particle and static instancing are outside this cutover.

### Multi-draw capability check

The passive Electron probe ran on 2026-09-04 with the character and camera settled in
`0xc6a9ffff`, at 1441 × 903. After its measurement window and scene screenshot, a separate,
unattached 8 × 4 WebGL2 canvas exercised the capability on the same browser/GPU environment.

- Renderer: `ANGLE (AMD, AMD Radeon RX 7900 XT (radeonsi navi31 ACO), OpenGL ES 3.2)`.
- `WEBGL_multi_draw` was available.
- A shader requiring `GL_ANGLE_multi_draw` compiled and linked successfully.
- One `multiDrawElementsWEBGL` call drew the same indexed triangle twice. `gl_DrawID` selected
  separate offset/color records from an RGBA32F texture in the vertex shader.
- Readback returned the expected red and green pixels exactly, with no GL error.
- Reported limits: 32 vertex texture units, 16,384 maximum texture dimension, 4,096 array layers,
  and 65,536 bytes per uniform block.

This establishes functional support on this environment only. It is not a production-path timing
comparison or a guarantee for other devices. The scene screenshot retained foreground buildings,
the central tower, and near/distant trees; no player or camera input was issued. Time of day changed
since the previous runs, so this capture is not used as another timing control.

The [Khronos extension specification](https://registry.khronos.org/webgl/extensions/WEBGL_multi_draw/)
defines multi-draw as multiple indexed/array draws under the bound state, with a draw index exposed
to the vertex shader. It does not make unrelated VAOs, textures, or fixed-function states compatible.
Our candidate consequently requires shared buffer storage with rebased indices and a material/pose
record contract. Allocator lifetime, fragmentation, and buffer growth belong in its complexity and
memory comparison. API-call reduction must be distinguished from the number of logical GPU draws.

Probe: `scripts/dynamic-submission-capability-probe.mjs`, invoked by
`HOLTBURGER_PROBE_SUBMISSION_CAPABILITIES=1 npm run probe:client:ui` with the profile-mode credentials
and options documented above. Artifacts: `/tmp/holtburger-dynamic-structural-evidence.json` and `.png`.

### Part-node consumer audit

Part scene nodes are not merely rendering wrappers:

- `DynamicEntitySystem.attachEntity` attaches a held entity root beneath the selected parent part
  node. Scene ancestry supplies its transform and inherited residency.
- `GamePresentationRuntime.#partFrameOf` resolves the part node into a generation-qualified
  behavior target. Particle emitters retain that frame target for placement and rotation.
- Ordinary rendering and exact selection already compose the entity visual-root placement with
  `part.localToVisualRoot`; those paths do not require each part's scene node to select its mesh.

`createActiveParts` creates part nodes with null local bounds. Such a node has no spatial entry of
its own, but it can have a bounded attached descendant. `applySample` first updates the visual root,
which synchronizes its subtree, and then updates each part, which synchronizes that subtree again.
The redundant traversal is structurally evident; the amount of avoidable spatial-entry work depends
on the actual attachment population and has not been counted separately.

Retaining attachment/frame nodes while publishing a coherent pose and synchronizing affected
descendants once is a narrower candidate than replacing all scene ancestry with a pose-array API.
Allocation-free bound accumulation remains relevant for either submission representation. The
scene graph must never expose mixed old/new part transforms to attachment, particle, or query
consumers. Appearance replacement must also preserve these frame targets where setup parts persist.

### Remaining decision evidence

Before choosing the final submission architecture, compare the two candidates against the same
captured dynamic workload and material semantics: CPU record preparation and submission, GPU time,
resident geometry bytes, and transient upload bytes. Include distinct effective geometry layouts
versus full appearances so palette variants do not exaggerate geometry duplication. The capability
smoke check alone does not justify a multi-draw cutover. Material/fixed-function partitioning and
ordered transparency remain requirements for both candidates.

The same-generation appearance defect and allocation-free pose/bounds publication remain in the
intended cutover scope whichever submission candidate wins. A phased implementation plan should
retain this evidence gate before committing to a merged-layout compiler or shared-buffer allocator.

## Risks and Mitigations

- **The scene changes as creatures move or effects expire.** Record all workload counters per run
  and alternate experimental toggles with baseline captures.
- **The local display refresh caps delivered rAF.** Use measured callback work and the existing
  excess-delay capacity estimate; do not treat displayed refresh as CPU capacity.
- **GPU profiling perturbs the driver.** Compare profiler-on cadence with an off control and use
  multiple windows.
- **V8 names are transformed by Vite/Svelte.** Preserve the raw profile and map hot generated nodes
  back to source before recording conclusions.
- **`perf_event_paranoid` or symbol stripping blocks native attribution.** Reproduce the exact
  failure, then use the existing Cargo profiling profile or an approved alternative sampler.

## Definition of Done

- [x] The requested live scene has repeatable TS and Rust profiles.
- [x] The worksheet contains commands, environment (without secrets), raw artifact paths, workload,
      timings, hot paths, uncertainty, and evidence-backed conclusions.
- [x] At least three comparable steady-state samples support central timing claims.
- [x] The main cost centers and their architectural owners are named without guessing.
- [x] Follow-up optimization candidates are prioritized by measured potential, not intuition.

## Open Questions

- Resolved: the user's approximately 90 FPS observation matches both the control's 93.90 FPS window
  and the HUD's 87/87 final reading. In this workload the sampler reports capped and estimated
  uncapped rates equal because work/event-loop delay, not display refresh, sets cadence.
- Resolved: ordinary release symbols are sufficient for the native attribution performed here;
  Cargo's `profiling` profile is unnecessary for the current questions.

## Phased Implementation: Dynamic Geometry and Presentation Cutover

Status: **Implementation complete. All dynamic mesh consumers use merged ordinary draws and shared poses; obsolete dynamic instancing experiments are removed. Matched instrumented callback work improved from 10.91 to 5.97 ms median; final clocks-off verification measured 5.61 ms, not 200 FPS. The normalized GPU-buffer tradeoff is +4.45 MiB for the final measured population. Appearance replacement, resource ownership, and final-tree validation are complete. Pre-existing portal overlap remains separate debt. Nothing is staged or committed.**

This appended plan records the final scope agreed after the investigation. It supersedes earlier
recommendations to compare multi-draw before implementation, retain optional dynamic mesh
instancing, or keep a permanent instanced transparent dynamic path. The preceding measurements
remain historical evidence. Multi-draw is deferred for a later effort.

### Objective and Scope

Reduce steady-state dynamic presentation and submission cost through one baseline-WebGL2 mesh
strategy: merged geometry layouts, pose palettes, material tables, and ordinary indexed draws.
Support live appearance replacement without resetting the entity. Measure progress toward the
5 ms frame budget required for 200 FPS; do not substitute a draw-count target for that budget.

In scope:

- Separate reusable effective geometry layouts from replaceable appearance/material bindings.
- Remove dynamic mesh instancing, including dynamic transparent range instancing, in the final
  implementation. Preserve necessary opaque, alpha-test, transparent, and additive pass semantics.
- Fix the frontend rejection of same-generation appearance updates.
- Remove transient dynamic bounds allocations and redundant pose-driven spatial synchronization.
- Integrate dynamic color, shadow/depth, selection-mask, and CPU interaction consumers.
- Preserve landblock coordinates, plural portal domains, resource ownership, appearance races,
  attachments, and particle frame targets.

Out of scope:

- Multi-draw, capability-dependent dynamic submission strategies, and a global geometry arena.
- Replacing particle or static rendering strategies or removing shared instancing helpers still
  used by those domains.
- Streaming performance optimization, a general scene-graph rewrite, host snapshot optimization,
  and unrelated renderer tuning.
- Incremental editing of merged mesh allocations or speculative caches of every wardrobe variant.

The user's parked player and camera remain untouched during live measurements. Use the existing
profile probe against the default ACE endpoint and environment-only credentials. Synthetic
fixtures cover crossings, appearance changes, and eviction without relocating the parked character.

### Ground Truth and Ownership

Paths below are relative to `apps/holtburger-3d/src/lib/game/` unless explicitly rooted elsewhere.

| Concern | Existing source and intended owner |
| --- | --- |
| Appearance authority and sequence ordering | `crates/holtburger-world/src/entity_appearance.rs`, `state/liveness.rs`; retain world ownership |
| Appearance update projection | `crates/holtburger-core/src/client/mod.rs`, `client/dynamic_entity_view.rs`; retain accepted authority ordering |
| Resolved geometry/material substitutions | `crates/holtburger-content/src/material_graph.rs`; content resolves ordered substitutions |
| Desired versus installed presentation | `runtime/game-presentation-runtime.ts`, `runtime/dynamic-entity-session.ts`; runtime owns replacement requests and commit eligibility |
| Shared visual resources and staging | `systems/object-visual-template-repository.ts`, `geometry/geometry-manager.ts`, `textures/atlas/resident-texture-atlas.ts` |
| Pose, effects, bounds, and part targets | `systems/dynamic-entity-system.ts`, `systems/components.ts`, `math/matrices.ts` |
| Attachment ancestry and spatial entries | `scene/scene-graph.ts`; retain part nodes needed by held entities and emitters |
| Render contract and device compilation | `renderer/render-world.ts`, `renderer/renderer.ts`, `renderer/compiled-object-draws.ts`, `renderer/webgl2-renderer.ts` |
| Shader and auxiliary consumers | `renderer/webgl2-object-program.ts`, `renderer/webgl2-entity-selection-pass.ts`, renderer shadow passes, `selection/entity-selection-intersection.ts` |

Appearance semantics are anchored in ACE `WorldObject_Networking.cs:45-54` and
`Creature_Equipment.cs:365,438`, and retail `acclient.c:138209-138241,137180-137205`.
Geometry identity must be derived from effective resolved parts, not merely the presence of a raw
appearance override. Baseline reference numbers are 515 rigid-part payloads, approximately 2,100
material-range contributions, and approximately 1,945 dynamic draws. The 540 and 120 draw estimates
are counterfactuals with different assumptions, not implementation acceptance thresholds.

### Guiding Principles

1. Optimize the actual visible population and measure total work, including memory and uploads.
2. Entity identity, appearance identity, and GPU resource lifetime are independent concerns.
3. Publish each derived pose/bounds fact once at its owner and share it with named consumers.
4. Preserve part-level behavior and render semantics even when geometry is stored together.
5. Prefer one final dynamic submission representation with explicit unavoidable pass partitions.
6. Keep layout resources independent of placement and atlas packing so movement and resource
   relocation do not require mesh reconstruction.

### Implementation Phase 1: Establish the Material and Layout Contract

Deliverables: a focused census/prototype in existing diagnostic infrastructure; the selected data
contract recorded here before production integration. Primary touchpoints are the template
repository, material-range resolver, object shaders, and the live/browser probes.

- [x] Count effective geometry layouts separately from full appearances, and size merged layout
  bytes against current shared part geometry bytes. Account for duplicated vertices needed for
  per-triangle material selectors and for retained CPU interaction meshes.
- [x] Census remaining draw partitions by actual texture encoding, atlas resource/page, palette,
  sampler behavior, culling, alpha-test, blend policy, and retail visibility. Preserve absence of
  detail materials where the dynamic producer has none; do not invent a new material family.
- [x] Prototype ordinary indexed rendering of multiple rigid parts with part and material
  selectors, entity pose data, and shader-readable material data. Verify actual pixels and GL
  errors with indexed palettes, direct color, solid color, and non-uniform part transforms.
- [x] Choose one pose/material storage scheme from actual content size and baseline WebGL2 limits.
  Specify matrix/normal-transform handling, precision, buffer lifetime, upload granularity, and
  how oversized valid content is partitioned or reported. Do not depend on optional extensions.
- [x] Prove how multiple atlas pages/encodings are accessed. A material table alone cannot select
  arbitrary unbound textures. Record the bounded texture binding scheme and its residual batches.
- [x] Specify logical material slots independently from physical atlas placement. Determine whether
  an appearance update can change phase/cull partitions without changing vertex topology; keep
  mutable index/range plans separate where needed. Do not blindly assume every texture-only swap
  is a table-only update.
- [x] Preserve part visibility and effect-driven opacity without rebuilding full geometry per
  frame. Define the ordinary-draw ordered residue required for transparent/additive parts.
- [x] Record measured preparation/submission CPU, GPU work, geometry bytes, and upload bytes for
  the prototype, explicitly distinguishing synthetic mechanism evidence from live-scene results.

Acceptance: the prototype renders the required material/pose cases correctly with ordinary draws;
every remaining partition has a named device or ordering reason; layout/material identity and
storage limits are concrete. This phase does not introduce a selectable production renderer mode.

#### Phase 1 Progress, Decisions, and Debt — 2026-09-04

Added cold, explicit censuses to the existing live probe. No production submission behavior changed.
The material-table candidate moves rectangle, color, wrap, alpha threshold, clip-map, and luminosity
uniforms into table data, but retains one physical base/palette binding pair per encoding, culling,
blend factors, entity, landblock, lighting role, portal scope, and phase. Ordered phases only merge
adjacent compatible ranges, including non-dynamic ordering barriers. Dynamic detail material is
explicitly rejected by this diagnostic because the current producer supplies none.

Clean capture `/tmp/holtburger-material-table-census-clean.json` observed 98 geometry-contributing
roots, 515 rigid parts, and 2,138 routed range contributions: 1,951 current draws, 542 per-entity
pose-palette draws with current material uniforms, and **163 candidate material-table draws**.
This is a structural count, not an executed merged draw or a frame-time prediction. A second clean
capture `/tmp/holtburger-layout-material-census.json` gave 166 candidate draws with the same census
population; physical atlas placement remains a real boundary. Do not assume a fixed 163-draw budget.

The latter capture sized **all 562 installed dynamic entities**, not just visible geometry:

| Installed-population fact | Result |
| --- | ---: |
| Full appearance identities | 94 |
| Effective layouts (ordered part index + resolved geometry identity) | 86 |
| Shared part geometry identities | 287 |
| Existing shared position/normal/UV/index payload | 2,506,356 bytes |
| Candidate merged payload with two Uint32 selectors and Uint32 indices | 5,753,352 bytes |
| Source vertices summed across layouts | 130,758 |
| Referenced vertices after splitting by logical material slot + wrap | 130,758 |
| Maximum parts in an installed layout | 34 |
| Maximum logical slot/wrap selectors in an installed layout | 54 |

These are typed-array payload estimates, not total process/GPU memory: exclude allocation capacity,
material tables, pose storage, range metadata, and retained decoded-record backing buffers. Original
CPU interaction meshes still need retention. The current census establishes shared CPU mesh payload
but not the full backing-buffer retention cost. Geometry identity is supported by host
`object_resource_closure.rs::add_geometry`, which keys immutable geometry by effective GfxObj ID.
Scales stay pose data; visibility and polygon culling/stippling remain range-plan facts. None belongs
in the material-dependent vertex-layout key. The measured selector split introduced no extra
vertices; do not assume that holds for all valid content.

Decision: proceed to the ordinary-draw shader prototype with bounded base/palette bindings; the
measured residual count does not justify adding arbitrary page arrays or optional multi-draw.
The 2.30× geometry payload remains small in absolute terms for this population, but preparation,
pose/material storage, and executed CPU/GPU costs still need proof before Phase 2 acceptance.
Preserve current normal-transform semantics during this refactor: the existing object shader uses
the pose's `mat3` for normals, not inverse-transpose; the prototype must compare non-uniform scales
against that actual behavior rather than introduce an unrelated lighting change.

Verification: both clean reports contain only Vite connection messages and no browser error entries;
screenshots were inspected with buildings, trees, and the parked player visible. Player and camera
remain in `0xc6a9ffff`; no movement/camera inputs were sent. The first clean capture was 1441×903;
the layout capture ended at 1446×907, so its timing is not a matched performance comparison. CPU/GPU
profiling was off. Type/lint checks are being rerun after the layout diagnostic addition.

Debt: remove temporary census code in Phase 8 after evidence is retained. An earlier capture was
contaminated by formatting-triggered HMR, which reported a presentation-owner shutdown AggregateError;
it is excluded from clean validation. The failure did not recur in either no-edit run. Its nested
cause is not established; do not misattribute it to merged rendering, which is not installed.
The isolated ordinary-draw prototype now passes eight pixel-equivalence cases on the real GPU
(`/tmp/holtburger-material-table-pixels.json`): solid color, direct color, index8, and index16, each
with clamp/repeat. Each case compares all 2,048 pixels against the production uniform shaders,
rendering two non-uniformly scaled parts as one merged indexed draw rather than two ordinary draws.
Both variants use the existing object sampling/lighting source. RGBA32F records carry two matrices
(128 bytes) and two material records (160 bytes); the index16 case exercises a nonzero high byte.
Every comparison is exact and every GL error check returns `NO_ERROR`. The report has no browser
errors. This proves the basic table-fetch mechanism, not representative GPU cost or all filtering
semantics: fixtures currently use single-texel material rectangles and no mip chain or hidden parts.
The device reports texture size 16,384 and 32 vertex/32 fragment texture units; production must use
queried limits, not those hardware-specific values as constants.

Temporary prototype debt: the harness rewrites known shader declarations, failing if a declaration
is absent/ambiguous, rather than introducing a production strategy switch. Replace that machinery
with the selected production contract and remove the probe and its explicit Knip browser entry in
Phase 8. The live CDP script imports this entry after measurements; it does not alter the scene.
`npm run check`, `npm run lint:ts`, and `git diff --check` pass after these additions. Knip initially
reported the CDP-imported module as unused; it is now explicitly listed as a browser entry, not
ignored as dead code.

Remaining Phase 1 gates include mip/filtering and mixed material/effect cases, storage limits and
oversize handling, preparation/submission CPU/GPU timing, and complete retained-memory accounting.

Further evidence (`/tmp/holtburger-material-table-filtering.json` and
`/tmp/holtburger-material-table-upload-isolation.json`): 16 exact pixel comparisons now cover
128×64 patterned base atlases, distinct 64×64 rectangles, mipmapped/trilinear direct-color sampling,
mixed clamp/repeat within one draw, alpha rejection, and palette clip-map rejection. The complete
geometry source/reference/selector vertex counts all equal 130,758; unused-vertex removal is not
concealing selector duplication. Actual unique backing allocations retained by installed source
geometry total **5,167,392 bytes**, including triangle material facts and duplicated decoding across
appearances. This is retained geometry backing memory, not a whole-JS-heap census.

The upload-isolation prototype measured three samples per strategy, each containing 256 repeated
two-part submissions with the same index16 materials at 64×32 pixels. These are synthetic batches,
not live frames. Uniform locations and typed-array views are prepared outside the timed loop.
GPU elapsed time comes from the existing asynchronous profiler, not CPU wall time:

| Synthetic strategy | Median GPU ms / 256 submissions | GPU range ms | CPU range ms |
| --- | ---: | ---: | ---: |
| Two ordinary uniform draws per submission | 0.25400 | 0.25300–0.25500 | 0.2–0.4 |
| One table draw, rewriting its pose texture before every draw | 1.83672 | 1.83652–1.85272 | 0.1–0.2 |
| One table draw, unchanged pose texture | 0.12212 | 0.12208–0.12216 | below timer resolution |
| One table draw, packed entity rows and one upload per 256 submissions | 0.13572 | 0.13312–0.13972 | 0–0.1 |

**Contract refinement:** pack current-frame poses and upload before draw consumption; do not
alternate entity-sized texture updates with dependent draws. The alternating-update prototype
exposed a large GPU cost that disappears with unchanged or packed data. This supports RGBA32F
table access, not a live performance forecast. The packed case carries 32,768 pose bytes for 256
two-part entities versus 256 separate 128-byte updates; the difference is update granularity, not
less pose data. Material records remain immutable during those samples. CPU timer quantization
precludes precise claims about these sub-millisecond submission differences.

Carry this constraint into Phases 4–6: one coherent frame pose publication, renderer-owned packed
upload capacity, stable per-entity offsets for every consumer of that frame, and no pose writes
between dynamic color/depth/selection passes. Frame pose storage has no residency ownership claim
on geometry or materials; those remain independently leased. Per-part effects/visibility and
oversize handling still need explicit contract validation before Phase 2 is accepted.

### Implementation Phase 2: Review the Contract and Refine Remaining Phases

Phase 1 closeout: `/tmp/holtburger-material-table-contract.json` passes **48 exact pixel cases**
covering the earlier material/filtering matrix with opacity 1, 0.35, and 0 for one part. Fades use
the same alpha-blend state in reference and candidate; hidden reference parts are omitted, whereas
the candidate moves their vertices outside the clip volume. Neither candidate case rewrites mesh
buffers. The two-part pose payload is now 160 bytes (matrix plus color per part); material payload
is 160 bytes. Addressing an entity at rows 16,382–16,383 of a 5×16,384 RGBA32F texture also matches
the reference pixels with no GL error. The isolated fixture's shader/buffer initialization took
2.0 ms in this run; it is synthetic harness initialization, not a measured real-content merge time.
The final screenshot includes buildings, trees, and the parked character, with no browser errors.

Selected implementation contract:

- Source-local merged vertices retain Float32 position/normal/UV and Uint32 dense part/logical
  material selectors. Ordered `(partIndex, effective geometry ID)` defines layout identity;
  logical material selectors are per-part authored `(slot, wrap)` pairs. Polygon culling,
  stippling provenance, retail eligibility, and original ranges remain index/range metadata.
- Each packed pose record is five RGBA32F texels: four matrix columns plus part color/opacity.
  Matrix semantics remain source-to-landblock; camera-relative offsets are draw uniforms, never
  retained pose coordinates. The owning publication composes each matrix once. The existing
  `mat3(matrix)` normal behavior is preserved. No half-float or inverse-transpose change is included.
- Renderer-owned pose pages are five texels wide, with queried `MAX_TEXTURE_SIZE` bounding height.
  Pack whole entities into pages; grow/reuse capacity and upload used rows before any dynamic
  pass draws. All passes consume that frame's same page/row assignments. Multiple pages do not
  create another submission strategy: each ordinary draw binds its entity's page and base row.
- Material records use five RGBA32F texels for color, base rectangle, palette rectangle, material
  kind/wrap/clip-map/luminosity, and alpha-test threshold. Tables and batch bindings are compiled
  from installed appearance plus atlas publication/filtering state, independent of vertex layout.
  Bind one base/palette resource pair per encoding batch; changing page/sampler/encoding, culling,
  blend factors, scope, or lighting role remains a named batch boundary. This deliberately does
  not offer arbitrary texture selection within one draw.
- Do not merge across required transparent ordering. Retain ordinary per-part/range residue for
  ordered alpha/additive work and effect-induced phase changes. Opaque hidden parts can be rejected
  by pose state without full geometry rebuild; effect routing must keep partially faded parts out
  of opaque depth-writing ranges. Auxiliary passes retain their own eligibility predicates.
- Capacity concession: an individual layout exceeding the queried pose-page or material-table
  height is rejected explicitly during preparation, before commit, with identity/count/limit in
  the failure. A replacement retains its previous complete visual on this failure. Never silently
  clamp selectors or draw a partial entity. Observed maxima are 34 parts and 54 selectors; support
  for a single oversized entity is not added speculatively. Total resident/visible population is
  not capped by one page; frame packing creates additional pages as needed.

The storage limit policy and cold preparation errors need production tests in Phases 5–6; the
boundary GPU probe establishes addressing, not those not-yet-implemented lifecycle checks.
Real-content merge preparation cost is still measured in Phase 5, and actual whole-scene benefit
remains Phase 7's acceptance gate. No benchmark here justifies removing those later gates.

- [x] Compare the prototype's residual draws and memory with the earlier ceilings and explain
  differences, including phase, visibility, and page boundaries omitted by optimistic estimates.
- [x] Review whether geometry merging's memory and preparation cost are justified by its measured
  steady-state benefit. If the prototype falsifies the design, record that and refine the design
  before spreading it through production consumers; do not restore multi-draw implicitly.
- [x] Dry-run appearance replacement, transparent ordering, attachment continuity, and auxiliary
  passes against the chosen contract. Refine the phases below with concrete types and ownership.
- [x] Record decisions, any revised scope, and identified cleanup targets in this section.

Acceptance: one baseline-WebGL2 contract is ready for production use, with no unresolved material
access mechanism. Routine implementation decisions proceed within the agreed scope; a material
change to product requirements is surfaced before dependent implementation.

### Implementation Phase 3: Support Appearance Replacement Within an Entity Generation

Phase 2 review and implementation decisions:

- Continue with the selected table/ordinary-draw representation. The residual draw counts and
  synthetic upload isolation justify integration experiments, not a claim that the complete
  steady-state tradeoff is already positive. Real-content preparation and total frame cost remain
  mandatory later acceptance gates. Do not add a second production renderer to hedge that uncertainty.
- Use a fresh `DesiredDynamicEntityRecord` object as the local request identity when visual facts
  change, even within one host generation. Existing record-identity completion guards can then
  reject A→B→A stale requests without an additional equivalent revision counter. Same-visual tick
  updates continue updating that record's latest placement/motion. Every installed-result check
  must compare the requested visual identity as well as incarnation; generation alone is currently
  used by upsert results, reevaluation results, and attached-child eligibility.
- Introduce a staged visual-only operation on `DynamicEntitySystem`, addressed by owner/root and
  resolved source. Stage the owning group's complete template set, replacing only the target
  source, so an operation cannot accidentally release sibling entities' shared resources.
  Commit against the still-current owner/entity and runtime request. This operation must not call
  owner activation, effect initialization, animation installation, or default-script replay.
- `mergePreparedParts` already retains `nodeId`, the part frame matrix, and render state while
  replacing immutable mesh/range references. Build replacement data before publication and retain
  the existing root, visual-root, part nodes, behavior generation, animation cursor, held children,
  particle targets, and placement path for same-setup/same-part-topology updates. Clear obsolete
  contribution maps so old template/range references do not prolong resource lifetime.
- Appearance bounds are not only the current pose box. `prepareMotionPlayback` and
  `prepareDynamicAnimation` cache geometry-dependent swept bounds. Recompute these from the new
  template and existing acquired animation assets without reacquiring/restarting playback, then
  publish current-pose, broadphase, particle-expanded, and selection geometry together. Use the
  latest root scale at commit, since it can change while the template is preparing.
- A genuinely different setup/topology is not a compatible visual-only swap. Use the existing
  staged full-owner activation path, preserving the old visual until preparation succeeds, then
  rebuild behavior targets and dependent attached presentations at commit. Do not invalidate a
  prepared parent's owner generation by retiring it immediately before that commit. Retire/rebuild
  attached descendants separately and revalidate their holding locations against the new setup.
  Verify part-frame emitter retirement through the owning entity: `ParticleSystem.createAuthored`
  retains separate owner and frame targets, and `destroy(owner, 0)` removes all emitters owned by
  that entity regardless of their part frame. No second part-target ownership index is needed.
- Keep Phase 4 as a distinct subsequent change: appearance correctness first, followed by coherent
  pose/spatial publication. `SceneGraph` needs an explicit batch publication boundary, not deferred
  reads or a second scene hierarchy. Validate affected held descendants before reducing sync work.
- In Phases 5–6, cold template/layout compilation owns stable selector/range facts; the renderer
  owns atlas-dependent table/batch compilation and current-frame pose-page assignments. Existing
  material-independent depth eligibility and CPU pick meshes remain separate named consumers.
  Appearance-only changes may rebuild table/range plans without changing the vertex layout.

No major scope change was required by the review. The cleanup list now explicitly includes probe
shader rewrites/Knip entry, cold censuses, old immutable-appearance terminology, and obsolete range
maps. Production verification must cover the lifecycle details above; synthetic shader success
does not verify appearance or attachment continuity.

Deliverables: runtime reconciliation and a focused visual replacement operation in the dynamic
system, backed by staged repository resources. Keep the existing renderer consuming the installed
visual until the new rendering contract is integrated.

Phase 3 progress: `DynamicEntitySystem.stageVisualReplacement` now stages the complete owning
group's template leases, preserving sibling requirements. Compatible replacements retain roots,
part node IDs, current articulated pose, effect state, and existing animation asset handles. Commit
rebuilds geometry-dependent animation envelopes using current scale, refreshes current/pick bounds,
and clears obsolete contribution maps. Different setups/part topology return an explicit
`requires-owner-replacement` outcome; they are not applied to an incompatible skeleton. Duplicate
part indices and identity changes fail explicitly. Owner removal and superseding stages withdraw
resources and prevent stale commits.

Initial installation and replacement now share `prepareEntityVisualState`, removing duplicated
animation-envelope derivation. Focused dynamic-system tests pass **26/26**, including three new
replacement tests for stable part targets/pose/effects/siblings, supersession/eviction, and retained
old geometry after resource preparation failure. `npm run check`, `npm run lint:ts`, and
`npm run lint:dead` pass. These tests do not yet establish held-child/emitter behavior through the
runtime's asynchronous reconciliation; those fixtures and the runtime wiring are the next work.
No same-generation appearance acceptance is claimed until that wiring is implemented and verified.

Phase 3 continuation — 2026-09-04: runtime upserts and tick reconciliation now accept fresh
same-generation appearance requests. Current desired-record identity guards asynchronous completion;
an already installed matching appearance avoids redundant loading, while a failed requested
appearance is not reported as installed merely because its previous visual remains. Compatible
replacement preserves the installed owner and updates its committed visual key. Incompatible
replacement uses staged owner activation, retires attached descendants before activation, and
releases the replaced owner's cue asset leases.

Revalidation passed the existing runtime/system suites (**66/66**). Two additional runtime tests
then passed with the expanded runtime suite (**42/42**): B/C replacement loads completing in reverse
order retain C, and deleting an entity during replacement loading prevents late resurrection.
Existing fixtures cover palette/texture/part changes, A→B→A, current-request failure, tick updates,
compatible held-child continuity, and both root- and part-frame cue emitter continuity.

Inspected the saved independent GPU fixture images
`/tmp/holtburger-runtime-appearance.png.appearance-before.png` and
`/tmp/holtburger-runtime-appearance.png.appearance-after.png`: the narrow red triangle becomes a
wider green triangle at the same screen position. This is basic replacement pixel evidence, not
full-scene or performance evidence. The earlier process handle is no longer available; no fresh
claim about its exit status or browser-error report is inferred from the images alone.

Remaining Phase 3 work: explicitly exercise incompatible setup replacement with held children and
active cue emitters, finish preparation/eviction and animation-continuity coverage, and capture a
fresh complete browser result before closing the phase. The harness appearance probe remains
diagnostic infrastructure; its CLI help now documents the workload and screenshot requirements.

Subsequent Phase 3 verification — 2026-09-04:

- Extended the root/part-frame cue fixtures through an actual setup-ID replacement: the compatible
  appearance retains the emitter; incompatible owner activation retires it. Extended the held-child
  fixture through setup replacement: both entities remain installed and the child is reattached at
  the expected transform. No new lifecycle policy was required.
- Strengthened the system replacement fixture by publishing a translated part pose after staging
  and before commit. Replacement bounds use that current pose, and the part target, pose reference,
  effect state, and sibling renderable remain intact. The first test attempt incorrectly inspected
  a committed preparation handle; the fixture now captures its prepared sample before activation.
- Runtime/system tests pass **68/68**. Full app check, TypeScript lint, and dead-code lint passed;
  the strengthened pose fixture also passes the focused suites.
- Fresh hardware-GPU command: `npm run harness:browser -- --brief --gpu --nameplate-workload
  occlusion-open --probe-dynamic-appearance --screenshot
  /tmp/holtburger-runtime-appearance-verified.png --measure-ms 0 --camera-position
  42087,37.9,-16638.4 --camera-yaw 0 --camera-pitch 0`. Exit status **0**, `consoleMessages: []`,
  RX 7900 XT via ANGLE, 1280×720. The probe's unchanged-placement, width-2 replacement bounds,
  and changed-image assertions passed; the resulting green replacement image was inspected.
  Initial and final camera values match. Chrome printed process-level service/shutdown warnings,
  separate from the empty page-console report. This fixture provides no steady-state timing claim.

Phase 3 remains open for final reconciliation/lifecycle audit, including advancing animation
continuity rather than relying solely on unchanged diagnostic counts. Phase 4 has not begun.

- [x] Remove the assumption that a stable entity generation implies a stable full appearance key
  across upserts, tick handling, and realization completion. Reconcile accepted desired levels
  through one path instead of adding special-case acceptance to only one entrypoint.
- [x] Keep authoritative instance/visual sequence validation in world. Use an explicit local
  request identity or revision to guard asynchronous work; include entity incarnation and current
  desired appearance. An A→B→A sequence must not admit an obsolete completion merely because its
  content key matches again.
- [x] Stage layout/material resources while retaining the last complete eligible visual. Commit
  only a current successful request; release failed, superseded, evicted, or destroyed stages.
  Report failures explicitly without silently declaring the requested visual installed.
- [x] Replace visual geometry/materials while preserving the entity root, applicable part frame
  targets, placement path, animation cursor, held children, and active behavior/effects. Do not
  replay setup defaults or restart particles to implement an appearance swap.
- [x] Refresh geometry-dependent bounds, picking geometry, and selection data coherently with the
  committed layout. Preserve existing independent authority-side selection/collision invalidation.
- [x] Treat actual setup/skeleton replacement separately from ordinary same-setup part overrides;
  validate part-index compatibility and define explicit lifecycle behavior for incompatible setups.
- [x] Add focused fixtures for palette, texture, and GfxObj changes; reversed completion order;
  A→B→A; failure; deletion/eviction during preparation; and animation/attachment continuity.

Acceptance: valid same-generation appearance changes render after preparation; only the latest
accepted request commits; lifecycle tests establish stable animation and attachment targets and
release every abandoned resource. Tests must not require unchecked-in DAT assets.

Phase 3 closeout — 2026-09-04:

- Added a 120-frame translating animation fixture and an unchanged control owner. The replacement
  preserves the current pose and continues advancing by the same amount as the control. Owners
  intentionally start at different identity-derived phases (`independentPhaseSeconds`), so the
  assertion compares advancement, not absolute positions. No runtime animation policy changed.
- The residency audit reproduced a defect: withdrawing scene interest during replacement loading
  still allowed its late completion to report `installed`. Added a shared current-request and
  residency/parent-eligibility guard at asynchronous publication boundaries. The regression now
  stays deferred after eviction and installs the desired replacement when residency returns.
  This is streaming correctness within the agreed scope, not streaming performance work.
- Runtime/system tests pass **70/70**; template-repository ownership/staging tests pass **13/13**.
  Full app check and TypeScript lint pass. Repository fixtures cover abandoned/failed staged
  resources and committed-owner isolation alongside the system/runtime lifecycle cases above.
- Repeated the real-GPU appearance command after the guard fix with screenshot prefix
  `/tmp/holtburger-appearance-residency-guard.png`: exit **0**, `consoleMessages: []`, same RX 7900 XT
  and 1280×720 fixture. Placement/bounds/image-change assertions passed and camera values match.
  The live player/camera were not involved. This completes Phase 3's basic GPU integration gate;
  merged rendering, all-pass coverage, and complete-scene timing remain Phases 5–7.

### Implementation Phase 4: Publish Poses and Bounds Without Redundant Work

Deliverables: focused changes in `dynamic-entity-system.ts`, `math/matrices.ts`, and the scene
graph's transform publication boundary, compatible with the new resource separation.

Initial implementation: `transformAABB3` now accumulates eight transformed corners in scalar locals,
without temporary vectors or coordinate arrays. It retains projective division and zero-W errors
rather than assuming all shared callers use affine matrices. Publication occurs after all corner
reads, preserving aliased input/output and leaving the target untouched on failure. New tests cover
projective aliasing and a later zero-W corner. Entity-owned scratch storage, coherent scene
publication, and measured cost remain pending; this helper change alone does not close the phase.

Initial checks: math/runtime/dynamic-system tests pass **82/82** after the bounds rewrite;
`npm run check`, `npm run lint:ts`, and `git diff --check` pass. The first combined test invocation
included the nonexistent `scene/scene-graph.test.ts` filter; Vitest ran the other three suites.
Scene coverage is in `scene/index.test.ts`; the explicit follow-up run passes **40/40**.

Phase 4 continuation — 2026-09-04:

- Per-sample rigid and particle-expanded bounds now reuse distinct entity-owned outputs. They
  must not alias at radius zero: subsequent positive particle expansion would otherwise overwrite
  the rigid selection bound. `expandBounds` accepts caller storage while preserving existing
  no-target behavior. Getter comments explicitly identify these values as borrowed current state.
- The dynamic system reuses one synchronous bounds scratch pair (matrix and AABB) across parts;
  no scratch reference escapes to the scene or renderer. Authored/effect root composition writes
  into the retained entity matrix. Cold appearance preparation still stages independent outputs
  before commit; it does not overwrite live bounds while resources are loading.
- `SceneGraph.updateLocalTransformWithChildren` validates direct parentage for the whole batch,
  copies the visual-root and part matrices, then synchronizes the subtree once. It is a narrow
  immediate-publication API, not a deferred scene graph. Stable per-entity child/matrix references
  avoid constructing frame-local update arrays; replacement refreshes them with the new parts.
  Null-bound part nodes remain traversal ancestors for spatially indexed held descendants.
- Tests verify stable distinct bounds across envelope growth/shrink, preserved rigid extents,
  coherent held-descendant placement, and rejection of an invalid batch without partial mutation.
  Runtime/system/scene tests pass **111/111**; full app check, TypeScript lint, and dead-code lint pass.
- Stationary live profile capture `/tmp/holtburger-phase4-publication.json`, CPU profile
  `/tmp/holtburger-phase4-publication.cpuprofile`, and screenshot
  `/tmp/holtburger-phase4-publication.png` completed successfully. Settled 10.053 s instrumented
  window, RX 7900 XT, 1441×903, player/camera residency `0xc6a9ffff`: **9.485 ms** mean frame work;
  latest retained runtime timing window reports **1.677 ms** presentation publication. Submitted
  dynamic draws **1,941**, current range-count metric **2,098**, particle instances **1,843**.
  Screenshot inspected: player, buildings, and trees remain visible; only Vite connection messages
  appear in the page console. No player/camera movement commands were issued.

This is one candidate correctness/profile window, not a matched speedup claim. Native sampling
still attributes work to bounds transforms and spatial publication, as expected; it also samples
GC elsewhere, which must not be presented as exclusively dynamic-bound allocation. Remaining
Phase 4 work is the publication/consumer audit and repeated cost validation before closing the
phase. Appearance/scale/attachment cold paths and other frame allocations have not been claimed
allocation-free. Production dynamic draw submission remains unchanged until Phases 5–6.

- [x] Replace transient corner/coordinate arrays in dynamic bound transforms with an allocation-free
  implementation. Confirm affine assumptions for any center/extents helper; preserve the generic
  transform contract or use a specifically named affine helper if other callers need it.
- [x] Reuse entity-owned matrices and bounds storage. Compose each part's published transform once
  and expose that coherent pose to bounds, rendering, selection, and attachment consumers.
- [x] Retain separate rigid-pose and particle-expanded bounds where their consumers differ. Update
  the conservative broadphase bound for relevant geometry, scale, and envelope changes.
- [x] Trace reads during publication, then apply completed visual-root/part transforms before one
  synchronization of affected spatial descendants. Preserve immediate correctness at the public
  boundary; avoid a general deferred scene graph or stale intermediate query results.
- [x] Skip unchanged publication only when owner-produced facts establish it is unchanged. Include
  ancestor placement, landblock/scope membership, attached descendants, and particle envelopes.
- [x] Test transformed bound containment, root scale/effects, held child placement, independent
  particle envelope changes, and appearance-bound refresh. Profile the publication phase separately
  from submission and record whether allocations and repeated spatial work decreased.

Acceptance: geometry/particle visibility and attachment transforms remain correct; redundant
publication traversals are removed on the covered paths; measured publication cost and allocation
pressure are reported without attributing the entire frame's GC to this change.

Phase 4 closeout — 2026-09-04:

- Audited borrowed bounds consumers: `RenderWorld` resolves footprints and shadow facts during
  frame assembly; dynamic nameplate facts are current-frame values; client tracking/indicator
  methods read and project selection bounds synchronously. `SelectedDynamicEntityFrame` already
  states the borrowed lifetime. No consumer requires the previous publication's mutable AABB.
- Retained existing owner-driven publication skips: animation cadence selects sparse samples;
  non-animated owners skip only when effects and particle envelope are unchanged. No extra matrix
  equality cache or general deferred spatial state was introduced. Placement/scope transitions
  keep their immediate scene operations, independent from pose publication.
- Repeated stationary capture `/tmp/holtburger-phase4-repeat.json` and `.png` completed and was
  visually inspected with buildings/trees/player present. Same 1441×903 viewport and residency;
  10.046 s instrumented window: **9.683 ms** frame work, retained publication mean **1.760 ms**,
  **1,946** dynamic draws, **2,103** current range contributions, **1,861** particle instances.
  Across these two candidate runs frame-work range is **9.485–9.683 ms**. These are current-cost
  measurements, not a matched whole-frame speedup claim; live workload and lighting vary.
- Isolated bounds comparison used the exact `HEAD` function body and current implementation in
  Node 24.13.1, 200,000 calls/window into caller-owned output, 10,000 warmups, five alternating-order
  pairs. Baseline median **232.674 ms** (226.377–239.098); current median **16.346 ms**
  (16.298–16.680). This proves a helper-level cost reduction for the tested affine input, not a
  browser frame improvement. Projective/alias/failure semantics remain covered by unit tests.
  Source-level temporary allocation sites fall from sixteen Vec3 instances and eight arrays per
  bound transform to zero with caller storage; JIT escape analysis may alter actual heap traffic.
- Coherent pose publication reduces visual-root/part subtree synchronizations from one plus the
  part count to one. It still visits bounded held descendants and does not eliminate all scene
  index or sample-array allocations. Those remaining allocations are not a reason to widen this
  effort into a general scene rewrite. Proceed to merged layouts; preserve repeated full-cutover
  measurement and cleanup gates in Phases 7–8.

### Implementation Phase 5: Compile and Own Merged Dynamic Layouts

Deliverables: shared layout preparation behind the existing preparer boundary, replaceable material
bindings, resource leases, and typed render-world access using Phase 1's contract.

Initial Phase 5 work — 2026-09-04: added the typed `dynamic-parts` GPU payload containing source-local
position/normal/UV, indices, and Uint32 part/material selectors. `WebGL2ResourceManager` uploads the
selectors through integer attributes and validates stream lengths before allocating/uploading.
The existing `GeometryManager` shares that resource by logical key and releases it after the final
appearance owner; no parallel GPU ownership cache is introduced. Focused resource/lease tests pass
**8/8**. This is resource-contract preparation only: no production template emits the new payload
yet, and no dynamic shader consumes it until integration proceeds. Real-GPU verification of the
new attribute path remains required before Phase 5/6 acceptance.

Accounting correction: `geometrySourceBytes` previously counted only positions for terrain and
portal geometry. It now counts all uploaded buffers for each geometry kind, including both dynamic
selector streams. Subsequent total geometry-byte reports are not directly comparable to the old
undercount; report per-kind/payload changes or normalize the baseline rather than calling the
corrected accounting a memory regression. Compiler preparation/sharing, material bindings, and
the compact render contract remain the next Phase 5 work.

Phase 5 compiler progress — 2026-09-04:

- `geometry/dynamic-layout.ts` compiles sorted effective parts into source-local Float32 attributes,
  Uint32 indices, and dense part/material selectors. Logical materials carry authored part, slot,
  and wrap; scales and resolved material/atlas facts do not enter layout identity. Original part
  triangle order and per-part merged offsets remain available for appearance/pass range compilation.
  Shared vertices split only across distinct slot/wrap selectors. Input shape, part identity,
  wrap modes, and vertex references are checked before publication.
- Every prepared template now stages its merged geometry through the existing geometry leases.
  Ready appearances with the same layout key share the retained CPU layout too: a cold scan of
  ready entries reuses it without a separate retirement/cache policy. Temporary compilation can
  still duplicate work before sharing; measure real-content preparation cost before optimizing it.
- Animation sweep preparation consumes only template parts. Narrowed its parameter to those facts
  and removed unrelated template fields from its fixture, rather than making animation depend on
  merged GPU layout construction. Existing runtime/system/animation fixtures still cover the
  appearance and bounds behavior through template staging.
- Compiler fixtures cover cross-wrap vertex splitting, within-selector reuse, dense authored-part
  mapping, geometry-only keys, source-local positions, malformed streams, and invalid references.
  Template tests distinguish separate appearances from shared layouts and verify exact retained
  geometry keys through owner release. Focused suites pass; full check and TypeScript lint pass.
  Dead-code lint found an unnecessary exported material-address type, which was made module-local.
- Hardware-GPU staging/replacement fixture completed with exit **0**, screenshot prefix
  `/tmp/holtburger-layout-staging.png`. Inspected replacement image shows the expected wider green
  triangle. This exercises production compilation, GPU selector-buffer upload, and replacement
  lifetimes, but still draws through existing part consumers; merged shader pixels are not claimed.

Explicit cutover debt: templates temporarily lease both source-part and merged buffers. Do not
interpret this staging footprint as final memory use. Remove dynamic ownership of legacy GPU part
buffers when all dynamic consumers migrate, while retaining CPU picking meshes and resources owned
by other domains. Renderer-owned physical material tables/batches and compact visible-entity
publication remain incomplete in Phase 5.

Phase 5 appearance and device preparation progress — 2026-09-04:

- `systems/dynamic-appearance.ts` compiles replaceable logical material records and authored-order
  merged ranges. Polygon culling/stippling stays on ranges, independent from shader material records.
  Compilation consumes resolved policy rather than deriving it again. Tests cover identical resolved
  bindings spanning different authored slots (both selectors must remain populated for subsequent
  appearance changes), as well as one selector used by different polygon culling ranges.
- The compiler publishes required pose/material row counts with merged geometry. The WebGL resource
  owner checks those counts against the actual device's `MAX_TEXTURE_SIZE` before allocating any
  geometry. Both creation and replacement use this check; an oversized replacement leaves the
  installed resource untouched. `GeometryManager` adds the logical geometry identity to preparation
  errors while preserving their cause, required count, and device limit. No alternate draw path is
  introduced. Focused tests exercise each overflow and acceptance at the exact row limit.
- The explicit installed-layout census now runs the actual compiler once per unique layout and
  checks its payload size against independent sizing. `/tmp/holtburger-phase5-appearance.json`
  recorded **562 entities, 94 appearances, 85 layouts, 132,474 selected vertices, 5,828,856 merged
  payload bytes**, and **72.6 ms** aggregate compilation. Maximum counts were **34 parts and 54
  material selectors**. This is a single warm-code, already-loaded-content compilation sample;
  it excludes GPU upload, appearance binding preparation, and atlas work. It is neither a complete
  cold-load measurement nor a streaming-performance claim. Transient compiler allocation and
  duplicate work before ready-template sharing remain recorded costs, not yet optimized.
- The same settled live capture, with instrumentation disabled, recorded **7.961 ms** mean callback
  work over **10.059 seconds**, **1,949 dynamic draws**, and **2,106 dynamic range inputs**. Inspected
  screenshot `/tmp/holtburger-phase5-appearance.png` includes the parked player, buildings, and trees;
  browser console contains only Vite connection messages. No movement inputs were issued. These
  are still legacy draw consumers, and the clocks-off timing is not comparable to earlier clocks-on
  captures as evidence of a speedup. The initial attempt failed during TypeScript compilation before
  Electron opened; only the corrected successful attempt supplies these observations.
- Following the capacity changes, full `npm run check`, `lint:ts`, and `lint:dead` pass, as do **37/37**
  focused compiler/template/resource/lease tests. The hardware-GPU synthetic appearance replacement
  fixture exits **0** with an empty browser console and screenshot prefix
  `/tmp/holtburger-phase5-capacity.png`. This verifies staging against a real device and replacement
  through existing draw consumers; it does not establish merged-shader pixel correctness.

Additional cutover debt: logical appearance compilation currently consumes legacy prepared part
draw units as its resolved-policy source. When removing that representation, compile both required
facts directly from the resolved material ranges rather than retaining old draw units solely as an
adapter. Physical atlas binding, table invalidation, and batch index organization remain the next
material work; logical material selectors alone do not merge draw submissions.

Phase 5 shared material preparation and encoder — 2026-09-04:

- Extracted `prepareObjectSurface` from `WebGL2Renderer.#compileObjectDraw`. Existing production
  draws now use this shared preparation for source opacity/color, exact versus filterable atlas
  sampling, indexed palettes, alpha rejection, clip maps, luminosity, and source-local wrapping.
  Geometry ranges, polygon state, regional static detail, blend state, and scope routing remain
  outside the shader-surface record. The existing retail diffuse-scale divergence and citation
  moved with its behavior; no new rendering-policy decision was introduced.
- `dynamic-material-table.ts` packs those prepared surface facts into the agreed five-RGBA32F-texel
  rows. Non-applicable base/palette rectangles and reserved components are zeroed. Physical texture
  and sampler handles remain outside the table for batch binding; atlas relocation changes encoded
  rectangles, not layout vertices or logical selector identity.
- The GPU prototype now consumes this encoder instead of hand-packing its material arrays.
  `/tmp/holtburger-phase5-material-encoder.json` contains **48/48** successful reference comparisons,
  each checking **2,048 pixels**, across solid/direct/index8/index16, mixed wrapping, rejection, and
  part opacity 1/0.35/0. The final legal pose rows also pass on the device's 16,384-row limit.
  This proves the production encoder against the prototype shader contract, not completion of the
  production merged geometry/pass integration.
- In that probe, three 256-submission GPU samples measured packed-before-draw uploads at
  **0.13772–0.13984 ms**, versus alternating upload/draw at **1.83804–1.87504 ms**. These synthetic
  totals corroborate the already-selected packed-page ordering; they are not per-frame savings.
- The same stationary live run completed with only Vite connection messages. Inspected screenshot
  `/tmp/holtburger-phase5-material-encoder.png` retains the player, buildings, and trees. Its
  instrumentation-off window was **10.070 s**, **8.700 ms** mean callback work, **1,955 dynamic
  draws**, and **2,112 dynamic range inputs**, at 1441×903. No scene speedup is claimed from this
  preparation refactor or unmatched capture. No movement inputs were issued.
- Full check, TypeScript lint, dead-code lint, and **35/35** material/policy tests pass. Tests cover
  exact/filterable resolution, missing bindings, source-opacity multiplication, retained diffuse
  semantics, table encoding, and changed atlas coordinates across records.

Remaining integration debt: the table encoder currently serves the GPU prototype, while shared
surface preparation serves production draws. Production material-table allocation/lifetime,
atlas-publication invalidation, physical batch/index organization, and compact visible-entity
publication still need implementation. Do not retain the prototype as the sole final consumer of
the encoder or infer that encoding alone reduces submissions.

Phase 5 compact publication progress — 2026-09-04:

- `DynamicEntityRenderable` now distinguishes preparation-only part targets from a ready visual
  carrying its shared layout and replaceable appearance together. Initial preparation and compatible
  replacement install the composite only after resource staging succeeds. Replacement validates
  the composite before committing leases, so a malformed part/layout correspondence cannot leave
  half-published resource state.
- Ready parts are sorted and checked against dense layout selectors once at installation. Their
  complete active records remain intact for animation, attachments, selection, and effects; frame
  consumers do not need to join layout part indices back to an unrelated pose array.
- `DynamicEntitySystem.getVisiblePresentation` publishes the installed visual, landblock frame,
  plural scopes, and current borrowed per-part transform/color payloads without visiting material
  ranges. It composes placement through the existing scene resolver, including attachment ancestry.
  Fully translucent parts retain their selector addresses with zero opacity. Preparation-only,
  explicitly hidden, and no-draw entities do not expose a visible compact input.
- Existing range expansion now consumes this publication and no longer independently recomputes
  part transforms/opacity. This is transitional wiring: the renderer still expands and submits
  legacy ranges downstream. The compact method creates one small wrapper per query; matrices and
  colors are retained. No allocation-free whole-query or frame-time improvement is claimed.
- Replacement tests now verify that pending preparation retains the previous compact visual,
  commit changes layout/appearance coherently, current part opacity survives, and full translucency
  does not remove selector-addressed parts. Shared-layout fixtures verify per-entity scale/placement
  and landblock/scope publication. **70/70** system/runtime tests, full check, both lint checks, and
  `git diff --check` pass.
- The hardware-GPU appearance fixture completed with exit **0**, screenshot prefix
  `/tmp/holtburger-phase5-publication.png`; the inspected replacement image shows the expected wider
  green triangle. This isolated fixture did not touch the parked live player/camera. It verifies
  the shared publication through current rendering, not the future merged shader/pass integration.

Next Phase 5 work is to consume the compact input directly at the renderer boundary and attach
renderer-owned material tables, physical bindings/batch indices, and atlas invalidation. Remove
the transitional range expansion when Phase 6 migrates its color, depth/shadow, and selection
consumers; do not preserve it as a second production strategy.

Phase 5 physical index organization — 2026-09-04:

- Added `renderer/dynamic-index-batches.ts` to make ordinary-draw contiguity explicit before GPU
  appearance ownership is wired. It groups compatible opaque/alpha-test ranges and writes each
  source range once into an appearance-specific Uint32 index buffer. It retains the original
  logical range order with remapped offsets and references to the owning physical batch, so
  transparent sorting and effect-driven part fades can address individual spans without a second
  copy of the indices. Shared vertex layout storage remains unchanged.
- Batch boundaries are source ordering, encoding, physical base/palette texture and sampler
  identities, cull face, authored visibility, and resolved blend factors. Material color, atlas
  rectangles, wrapping, luminosity, and selector identity do not partition draws because the table
  selects them. Blend factors are derived once per logical material. Polygon stippling provenance
  remains on logical ranges; this does not introduce a new stippling implementation.
- Transparent/additive ranges remain separate and preserve authored range identity; the compiler
  does not infer that arbitrary ordered geometry can be merged. Portal scope and lighting remain
  per-view/per-entity submission partitions outside this appearance-local compiler.
- Unit fixtures verify non-adjacent compatible range merging, remapped original range order,
  identical index payload size, separate ordered surfaces, cull/visibility/phase partitions,
  physical palette/sampler differences, table-varying rectangles/colors, and missing/out-of-buffer
  inputs. The combined batch/material/policy suites pass **41/41**. Full check, TypeScript lint,
  dead-code lint, and `git diff --check` also pass on this increment.
- The hardware-GPU prototype now uploads compiler-produced indices for each material case and
  requires its two compatible ranges to produce one lossless batch. The successful capture
  `/tmp/holtburger-phase5-index-batches.json` contains **48/48** reference comparisons (**98,304
  checked pixels**). GPU coverage here exercises compatible two-range batches; non-adjacent
  regrouping and split-state cases are currently unit-test evidence, not full production-pass proof.
  The inspected `/tmp/holtburger-phase5-index-batches.png` retains player/buildings/trees, with only
  Vite connection messages in the browser console and no movement inputs issued.
- The live portion still uses the old draw submission: **8.263 ms** mean callback work over
  **10.063 s**, **1,957 dynamic draws**, and **2,114 range inputs**, instrumentation off at 1441×903.
  This is a correctness capture, not an achieved batching speedup or matched performance result.

Sequencing clarification: physical index organization was completed before assigning GPU lifetime
so the owner can retain the actual table/index payload, not a placeholder resource. The compiler
currently serves the prototype; production appearance table/index ownership, atlas invalidation,
and direct compact renderer consumption remain outstanding. No new cache-retention policy has
been selected or implemented in this increment. Account for appearance-specific index storage
separately from shared vertices during the final memory comparison.

Phase 5 production appearance resource ownership — 2026-09-04:

- `WebGL2DynamicAppearances` now owns real RGBA32F material tables and appearance-specific index
  buffers in production. The template repository invokes renderer preparation only after geometry
  retention and atlas activation succeed, and stores the returned release with its ready state.
  Sharing and independent eviction follow existing template owner/stage references; no per-frame
  visibility cache, second residency policy, or rendering fallback was introduced.
- Initial allocation failure rolls back the partial device allocation and the repository's atlas
  and geometry resources. Last-template release retires appearance resources before withdrawing
  source textures. Release failures do not prevent the remaining source cleanup and are surfaced
  at shutdown with the repository's existing accumulated-error mechanism. Renderer shutdown also
  releases all remaining device entries; later template callbacks cannot double-delete them.
- Atlas publication and filtering changes rebuild retained tables and batch/index organization
  using the shared surface preparer. All replacements are prepared before any current generation
  is exchanged; failure releases partial replacements and propagates without partially publishing
  the new set. Empty appearances have explicit empty state instead of a zero-height texture.
  Element-buffer upload binds the default VAO, preserving the shared geometry VAO's index binding.
- This intentionally uses whole-retained-set invalidation, consistent with the existing compiled
  draw cache. It can repeat cold work during streaming and briefly retain both old/new device
  generations. Streaming tuning is still separate. Filtering changes are observed at the frame
  settings boundary, so that explicit cold setting transition performs a rebuild there; ordinary
  unchanged frames do not compile or upload appearance resources.
- **91/91** focused resource/repository/system/runtime tests pass, together with full check,
  TypeScript lint, dead-code lint, and `git diff --check`. Fixtures cover shared retains, last-owner
  release ordering, partial allocation rollback, whole-set rebuild failure, new atlas coordinates
  and physical bindings, empty geometry, renderer shutdown followed by late release, and repository
  rollback/continued cleanup. An initial failure was a stale expected error string after cleanup
  expanded from atlas-only to all resources; the assertion now names the actual contract.
- The real-GPU appearance replacement fixture exits **0** with an empty browser console; inspected
  screenshot prefix `/tmp/holtburger-phase5-appearance-ownership.png` shows the expected wider green
  replacement. The subsequent stationary live capture
  `/tmp/holtburger-phase5-appearance-residency.json` / `.png` also exits **0**, with only Vite
  connection messages and player/buildings/trees intact. It exercises production staging and atlas
  publication on real textured appearances. No movement inputs were issued.
- The live window, still using old draw submission, was **10.058 s** with **8.230 ms** mean callback
  work, **1,950 dynamic draws**, and **2,107 range inputs**, instrumentation off at 1441×903. This
  is correctness evidence for the new resource lifetime, not proof of merged rendering or speedup.

Remaining Phase 5/6 integration debt: scene draws do not yet read the retained table/index resources.
Connect compact render-world publication and the packed pose pages to those resources before
claiming the cutover. The temporary footprint now includes old part buffers, the shared merged
layout's original index buffer, and appearance index buffers/tables. Remove superseded GPU index
ownership when all passes use appearance batches, retain required CPU indices for compilation and
picking, and include renderer-owned table/index bytes in the final resource accounting. Existing
geometry-manager byte totals alone do not include these new renderer-owned allocations.

Packed pose-page preparation — 2026-09-04:

- Added `WebGL2DynamicPosePages`, consuming already-published part transform/color records. It packs
  each selected entity wholly into one page, supports additional pages for larger total populations,
  and exposes one texture/row address shared by all of an entity's pass consumers. It writes the
  existing column-major matrix convention and retains zero-opacity parts at their selector rows.
- Pages use the queried device texture height, width five RGBA32F texels, and retained CPU staging
  arrays. Each completed pack uploads only each page's used row prefix, once. GPU storage is
  allocated only when the page high-water mark grows; empty selections allocate/upload nothing.
  At the verified 16,384-row device limit, each full-capacity page is 1,310,720 bytes on each of the
  CPU and GPU sides. Record that retained capacity separately from used upload bytes at cutover.
- Six focused fixtures cover multi-page whole-entity packing, exact capacity fits, matrix/color
  encoding, storage reuse with shorter uploads, stale-address removal, empty input, oversize
  rejection, and allocation failure. Full check, both lint checks, and `git diff --check` pass.
- The material GPU prototype now uses the page owner for all **48/48** pixel comparisons, with one
  padding row forcing a nonzero entity offset. **98,304 pixels** match the reference. The original
  two-row upload-isolation timing experiment remains separate, with its bindings/offset restored
  before timing; those timings do not measure the page owner's CPU packing.
- `/tmp/holtburger-phase5-pose-pages.json` / `.png` completed successfully with only Vite connection
  messages and the parked player, buildings, and trees intact. The unchanged scene submission
  measured **8.320 ms** mean callback work over **10.072 s**, **1,953 dynamic draws**, and **2,110
  range inputs**, instrumentation off at 1441×903. No movement inputs were issued, and no scene
  speedup is claimed. The page owner is currently exercised by the prototype, not scene draws.

Integration refinement from the current call graph: `WebGL2OutdoorPssmPass.render` currently selects
casters and immediately draws maps, before the renderer collects color submissions. Split that
selection from execution. Prepare the selected inputs for color, shadow, and selection consumers,
retain per-view plans without borrowing arrays that later views overwrite, gather their union of
dynamic roots, and upload all pose pages before executing dynamic draws. Do not work around this
ordering by uploading every resident entity, repeating visibility queries, or re-uploading pages
between passes. Compact render-world access and this scheduling cutover remain outstanding.

Shadow preparation/execution separation — 2026-09-04:

- Split `WebGL2OutdoorPssmPass` into CPU-only `prepare` and GPU `render` operations. Preparation
  retains independent cascade matrices, caster records, batches, and analytic-tier selection for
  each view. Execution consumes that selection without querying the scene again. The renderer
  currently calls them consecutively at the existing schedule position; the all-view scheduling
  cutover and production pose-page consumption are still outstanding.
- Frame reset releases borrowed caster instances and batch references while retaining the
  high-water record pools. The caster planner and frame reset share one retirement helper, avoiding
  a new per-frame discard/reallocation of those records.
- **12/12** focused pass/caster tests pass, including two deferred views with different matrices
  and mapped budgets, no GPU work during preparation, no repeated selection during execution,
  and frame-reset reference release with storage reuse. Full check, TypeScript lint, and dead-code
  lint pass.
- The real-GPU `shadow-crowd-112x61` fixture with `--entity-shadow-cycle` exits **0**, reports an
  empty browser console, and retains 112 visible entities / 6,832 legacy range contributions.
  Disable/simple modes release targets; mapped re-enable, resize to 256, and restore to 1024
  produce the expected generations (four allocated, three disposed, one active two-cascade set).
  Inspected `/tmp/holtburger-phase6-shadow-preparation.png` contains the expected synthetic crowd.
  This fixture intentionally has no rendered terrain receiver and does not establish shadow pixel
  equivalence, complete live-scene geometry, or a speedup. No parked-player inputs were issued.
- The next scheduling dependency is confirmed in `WebGL2PortalScopeAtlasPipeline`: its mutable
  frame wrapper, planner, router, and propagation stream expire on the next camera preparation.
  Retain independent per-view CPU planning storage before deferring those views. Keep the GPU
  executor and targets shared for sequential execution; do not duplicate target allocations per
  camera or retain overwritten arena views. Include a two-view preservation fixture at that seam.

Remaining debt: production shadow submission still uses the old range/instance path. This split
is a scheduling prerequisite, not completion of Phase 6. Color/portal and selection preparation
must join it before the selected-root union can drive one pre-draw pose-page upload. The current
shadow GPU profiling scope also still encloses CPU selection; move its start to execution when
the renderer separates those calls, while preserving CPU selection attribution.

Deferred portal planning ownership — 2026-09-04:

- `WebGL2PortalScopeAtlasPipeline.prepare` now retains independent per-view CPU planner, routing,
  propagation-stream, and extent storage. `beginFrame` expires the previous plans and reuses slots
  by view ordinal. Preparing another camera no longer overwrites an earlier camera's plan.
- GPU targets remain shared. `beginOpaqueScene` explicitly activates a prepared view and acquires
  its target extent; target handles no longer belong to the CPU planning contract. The compositor
  passes the activated targets to SAO. The one-shot execution probe now resets frame state before
  planning, matching continuous rendering and avoiding immediate invalidation of its new plan.
- **25/25** focused pipeline/planner/router tests pass, along with full check, TypeScript lint,
  dead-code lint, and `git diff --check`. The new fixture keeps real CPU planning and replaces only
  GPU resource owners. It verifies independent scopes, extents, routing counters, and propagation
  bytes across two deferred views; target acquisition only during execution; invalidation and
  storage reuse at frame reset. Its initial failure was a missing required indoor visibility island
  in the synthetic topology, corrected without weakening production validation.
- Real-GPU hybrid `0x7d640113` verification passes at 1280×720, render scale 1. The one-shot probe
  selects six scopes, submits five terrain inputs, 17 shell draws, seven dynamic draws, and three
  particle batches, with an empty browser console. Inspected screenshot:
  `/tmp/holtburger-phase6-portal-preparation.png`. Interior walls/doorway, exterior ground/building,
  and the torch remain visible. The initial command omitted `--env-cell-radius`; the harness's
  null default requests no EnvCells (`scene-target.ts`), so it correctly rejected the unavailable
  root. The successful run explicitly requested radius 1.
- A separate continuous `--frame-mode portal --mode-cycle` run passes portal/flat/portal/flat
  switching with an empty browser console: both portal snapshots retain six scopes and seven
  dynamic draws. Screenshot: `/tmp/holtburger-phase6-portal-mode-cycle.png` (final flat view).
  A sandbox-denied content-host startup was retried with approved execution permissions. No live
  player/camera inputs were issued. These are correctness checks, not performance comparisons.

Concession and remaining integration: each concurrently prepared view retains another high-water
CPU arena set, but not another GPU target set. Include that CPU capacity in the Phase 7 memory
review. The renderer still prepares and executes views consecutively. Its contribution resolver
also returns borrowed analytic-shadow maps, and particle routing uses mutable batching storage;
give retained view plans safe ownership of those outputs before moving all preparation ahead of
execution. Do not claim all-view scheduling or production merged draws complete at this point.

Per-view contribution output ownership — 2026-09-04:

- Added `ViewSubmissionStoragePool` and attached one acquired slot to each prepared camera.
  Indoor/outdoor analytic receiver maps and their record pools, plus particle routing records,
  now belong to that camera. Temporary caster collection and selection scratch remain shared:
  they are consumed synchronously and do not escape into the retained submission contract.
- Frame reset expires the output maps and particle routes without discarding record capacity.
  Particle reset also replaces borrowed emitter-frame references in used records, preventing
  inactive view slots from retaining unloaded emitter transforms. Residency teardown clears all
  view-owned particle pools. Removed the unused `mergeContribution` method and its sole test
  consumer; routing preserves emitter ranges and performs no batch coalescing.
- **18/18** focused storage/routing/grounding tests pass, along with full check, both lint checks,
  and `git diff --check`. The new fixture uses actual indoor selection to prove a second view does
  not overwrite the first view's records; it also verifies distinct particle routes, frame-reference
  release, map invalidation, record reuse, and particle teardown.
- Real-GPU hybrid portal/flat/portal/flat cycling exits **0**, with an empty browser console.
  Both portal snapshots retain six scopes, seven dynamic draws, and three particle batches; both
  flat snapshots retain 13 dynamic draws and three particle batches. Inspected screenshot
  `/tmp/holtburger-phase6-view-outputs.png` shows the interior doorway, exterior building/ground,
  and torch at 1280×720, render scale 1. This is correctness evidence, not a timing comparison.
  The parked live player and camera remain untouched.

Next scheduling step: move color/portal preparation ahead of execution using these view-owned
outputs. Pass prepared shadow projection and analytic-tier facts explicitly to contribution
resolution; it currently reads the last executed PSSM view. Preserve per-view profiling attribution
and prepare selection inputs before the selected-root union drives pose uploads. Production still
uses old dynamic draws, and final multi-view CPU capacity accounting remains outstanding.

Color/portal/shadow preparation ordering — 2026-09-04:

- Flat and portal frame schedules now prepare every camera's scene contributions and shadow
  decisions before executing the first camera. Portal execution consumes a complete prepared view
  (visibility, color inputs, particle routes, shadow plan); it no longer performs scene queries.
  The explicit portal probe uses the same contribution-preparation and execution functions.
- Analytic projection and selected fallback casters now travel directly from shadow preparation
  into color contribution resolution. Removed the PSSM pass's last-executed-view state/getters and
  the renderer's corresponding active analytic projection field. Only GPU receiver state remains
  execution-scoped, since its target contents are intentionally shared between sequential views.
- CPU shadow preparation and execution accumulate into the existing CPU phase. The GPU query now
  begins at execution, excluding CPU caster selection. The profiler's accumulation semantics were
  inspected to confirm split CPU spans add rather than overwrite each other; metric sinks remain
  conditional on profiling, and are recorded once after the mapped pass executes.
- **9/9** focused shadow-pass, portal-pipeline, and view-storage tests pass. Full app check, both
  lint checks, and `git diff --check` pass after the cutover. Existing two-view ownership fixtures
  cover the independently retained CPU storage; a full simultaneous multi-view GPU comparison is
  still part of final scheduling validation, not established by the single-camera runs below.
- Profiled real-GPU hybrid portal/flat mode cycling exits **0**, with an empty browser console and
  unchanged six-scope/seven-dynamic-draw/three-particle-batch portal snapshots. Inspected screenshot:
  `/tmp/holtburger-phase6-prepared-schedule.png`. That scene's mapped selection was empty, so it
  was supplemented by the nonempty synthetic crowd fixture rather than treated as mapped-draw proof.
- Profiled `shadow-crowd-112x61` plus target cycling also exits **0**, with an empty browser console:
  112 candidates, eight mapped roots, 24 analytic roots, two compatible depth runs, two uploads,
  and 78,080 legacy instance-upload bytes. Target disable/re-enable/256/1024 transitions succeed.
  Inspected `/tmp/holtburger-phase6-prepared-shadow-schedule.png` contains the expected crowd.
  These 1280×720 correctness fixtures do not establish a steady-state improvement or shadow pixel
  equivalence; no live player/camera inputs were issued.

Remaining scheduling gate: selection-mask root/contribution preparation still happens in its draw
callback. Move it ahead of execution and include its eligible root in the upload population before
connecting the compact render-world accessor and production pose pages. Ordinary object run
formation and legacy instance uploads also remain execution-time work pending the merged draw
cutover. No pose uploads have been added to this reordered scene schedule yet.

Selection preparation ordering — 2026-09-04:

- Split selection geometry preparation from mask execution. The prepared union contains either
  eligible rigid ranges with their landblock owner or the runtime-resolved sphere proxy. Hidden
  and empty rigid selections return no prepared geometry; retail-hidden filtering happens once
  during preparation. Execution performs neither world expansion nor eligibility filtering.
- The renderer prepares one frame-global selection after frame reset, before camera planning or
  drawing. All views share that selected pose. Eligible rigid selection roots join the selected
  dynamic set even when ordinary visibility excludes them, preserving the x-ray outline's geometry
  requirement. Sphere proxies retain their independent runtime transform and require no rigid pose
  rows. Reset releases retained selected-instance references, preserving GPU target capacity.
- Two focused pass tests verify hidden no-allocation behavior, retail filtering/debug inclusion,
  record reuse/reference release, and sphere-proxy preservation. Full check and both lint checks
  pass. The first check caught a stale draw-count variable after the split; the count now reads
  the same prepared contribution array used by the draw loop.
- The real-GPU `entity-selection` fixture exits **0** with an empty browser console. Its assertions
  verify current-transform following, depth-independent mask pixels, preserved scene interiors,
  sphere-proxy mask/work, ordinary and portal-warp outlines, target reuse/resize, and final disposal.
  The fixture now explicitly prepares geometry before invoking the production draw pass.
- The full-renderer spawned WCID 7 selection probe also exits **0**, with an empty browser console.
  Both samples report the same exact selected GUID, 17 parts, 550 triangles, 17 mask draws, and one
  outline composition. Inspected `/tmp/holtburger-phase6-frame-selection.png` shows the selected
  actor's outline through an occluding roof. This pose-only run does not prove live animation;
  transform changes are covered by the isolated GPU fixture.
- The first spawned probe failed before selection because the root was not realized. The successful
  radius-1 capture places that spawn in `0xdb56ffff`, outside the first run's sole requested
  `0xda55ffff` terrain. `#isDynamicScopeReady` requires the root's authoritative terrain scope.
  No residency fallback was introduced; the harness error now includes the actual presentation
  state for future failures. All camera/selection actions were isolated harness actions, not inputs
  to the parked live client.

Remaining gate: connect compact selected-root publication and packed pose uploads to the production
schedule, then replace legacy draw consumers. Selection still uses its existing instance upload
and shader at execution; moving CPU preparation does not itself remove those uploads or complete
the merged-draw cutover. Simultaneous multi-view GPU validation remains outstanding.

Compact RenderWorld publication integration — 2026-09-04:

- `RenderWorld` now exposes the installed layout/appearance and dense current part poses. The
  renderer caches this publication alongside each selected root's transitional contributions;
  a later depth expansion reuses the same publication instead of composing the part matrices again.
  The existing frame reset releases both records. No additional resident-population scan or GPU
  upload was introduced.
- The temporary system range expander consumes an explicit published presentation. Its eventual
  removal remains part of the cutover, not an optional optimization. The shadow query port keeps
  its actual two-argument renderer-cache contract rather than inheriting the RenderWorld adapter's
  three-argument publication contract. This fixes the type error left by the unfinished integration.
- Focused system, RenderWorld, and outdoor shadow pass tests pass: **34 tests across three files**.
  The system fixture reuses one compact record for material and depth expansion; the RenderWorld
  fixture verifies that the exact publication reaches its system consumer. Type and lint checks
  pass.
- The real-GPU spawned WCID 7 selection probe exits **0** with an empty browser console, using
  building/explicit/generated radius 1 at the isolated candle camera. Both samples select GUID
  4026531841 with 17 parts, 550 triangles, 17 legacy mask draws, and one outline composition.
  Inspected `/tmp/holtburger-compact-publication-selection.png` shows the occluded actor outline,
  roof/building geometry, trees, terrain, and candle. This pose-only correctness capture neither
  establishes animation coverage nor measures steady-state improvement. The parked live client
  received no input.

Remaining integration debt: the renderer now retains the compact record, but color, shadow, and
selection draws still consume legacy ranges/instance buffers. Connect the production pose-page
owner with the first ordinary merged draw consumer; do not upload unused pose pages merely to
complete a scheduling checkbox. Keep the all-pass/all-view preparation boundary and selected-root
population contract intact. Phase 5 ownership cleanup and Phase 6 draw cutover remain incomplete.

- [x] Compile resolved parts into merged vertex/index resources with stable part/material selectors.
  Preserve source-local geometry, authored scales, geometry visibility, and lossless material facts.
- [x] Share layouts across identical effective geometry and separate palette/material variants where
  the proven layout contract permits it. Compute keys once in the owning preparation layer.
- [x] Stage geometry and texture requirements together before visual activation. Reuse the existing
  owner/reference lifecycle, including last-owner release and late completion rejection.
- [x] Resolve atlas coordinates into renderer-owned material data. On atlas publication, update or
  invalidate affected tables and any physical batch bindings; do not rewrite vertex positions/UVs.
- [x] Expose a compact visible entity presentation containing layout/material handles, pose and
  part modifiers, root placement, and plural scopes. Preserve ordered range metadata without
  expanding every opaque material range into a frame-instance object.
- [x] Keep source/layout compilation behind the preparer boundary and out of dynamic draw execution.
  Steady-state frames reuse staged appearances. Record cold frame-settings rebuilds and first-use
  shader preparation explicitly; worker execution and streaming performance tuning remain separate.
- [x] Account for shared original GPU meshes still owned by static/particle consumers. Dynamic
  ownership should transition to merged resources; do not delete resources retained elsewhere.

Acceptance: equivalent geometry appearances share the intended resources; replacement and eviction
are leak-free in focused lifecycle fixtures; placement/anchor changes do not trigger layout rebuilds;
atlas relocation updates bindings coherently. Temporary comparison wiring is explicitly tracked
for removal and does not become a permanent product setting.

### Implementation Phase 6: Integrate All Dynamic Draw Consumers

Deliverables: ordinary indexed dynamic rendering in the main renderer and required auxiliary
passes, sharing pose/material logic where the semantics match.

First production merged consumer: selection masks — 2026-09-04:

- Rigid selection now reads the compact installed visual directly, without requesting legacy
  depth-range expansion. The renderer owns `WebGL2DynamicPosePages`, gathers the prepared mask's
  complete dense part rows, and uploads them after all view preparation and before view execution.
  Flat, portal, and diagnostic portal execution use that ordering. Every mask view reads the same
  root address; no mask callback allocates or uploads a missing pose.
- Selection uses the appearance-owned physical Uint32 index buffer with the merged layout VAO.
  The cold index compiler exposes its existing remapped range records in physical order, allowing
  preparation to coalesce adjacent eligible spans across materials and parts. This adds one array
  of shared references per appearance, not another index-buffer copy. Face-culling changes and
  hidden geometry still split spans. Partial fades and texture alpha retain the material-free
  mask policy; fully hidden parts are excluded. Exact part/triangle counts are derived during
  preparation and reused across views.
- Removed the selection pass's instance buffer, instance collection/deduplication, instanced
  attribute binding, and instanced draws. The rigid shader fetches its matrix from the pose page.
  Sphere proxies use a separate uniform-transform vertex shader and an ordinary draw, requiring
  no rigid pose rows. These are distinct geometry semantics, not selectable rendering strategies.
  No instanced selection fallback remains.
- **55 focused tests across seven files pass**, along with `npm run check`, `npm run lint:ts`,
  `npm run lint:dead`, and `git diff --check`. Selection tests cover physical-span coalescing,
  cull boundaries, retail visibility/debug inclusion, partial/complete fades, reusable scalar
  storage, exact work counts, hidden roots, and sphere proxies. The index test verifies physical
  ordering retains the same range objects as authored-order traversal.
- The real-GPU `entity-selection` fixture exits **0** with an empty browser console. It now uses
  production appearance resources and pose-page uploads, with a padding root forcing the selected
  matrix to row 1. Existing pixel assertions pass for transform following, depth-independent masks,
  preserved interiors, ordinary/portal-warp outlines, sphere proxies, target reuse/resize, and
  disposal. Artifact: `/tmp/holtburger-merged-selection-fixture.png`.
- A radius-1 spawned WCID 7 **animated** full-renderer probe exits **0**, with an empty console on
  AMD RX 7900 XT / ANGLE Vulkan, 1280×720, render scale 1. Both samples retain 17 selected parts and
  550 triangles while the pose checksum changes. Exact CPU picking continues selecting the same
  GUID. The mask requires **one ordinary draw**, versus 17 legacy mask draws in the preceding
  pose-only capture; this is submission evidence, not a matched frame-time comparison. Inspected
  `/tmp/holtburger-merged-selection-actor.png` shows the outline aligned with the posed actor,
  alongside building geometry, trees, terrain, and the candle.
- The combined animated selection + portal/flat mode cycle also exits **0** after correcting its
  harness baseline. Previously, `assertModeCycle` compared resource ownership against a snapshot
  taken before explicit actor spawning; the initial combined run therefore failed ownership
  equality despite four valid masks and an empty browser console. The cycle now captures its own
  baseline immediately before changing modes, retaining the ownership equality assertion. All four
  snapshots report one mask draw, 17 parts, 550 triangles, and one composition. Inspected artifact:
  `/tmp/holtburger-merged-selection-mode-cycle.png`. This outdoor-root portal cycle does not cover
  simultaneous multi-camera execution or selection across a multi-scope indoor portal scene.

Decisions and remaining debt:

- During this vertical cutover, GPU pose selection includes only the merged rigid-mask consumer.
  Extend the same collection to color and mapped-shadow roots as their consumers migrate; do not
  upload unused legacy roots or every resident entity. The final all-pass selected-root union and
  simultaneous multi-view GPU acceptance remain required.
- Compact publication has its own frame cache so selection need not populate the temporary legacy
  expansion cache. Delete the latter with the remaining legacy consumers. No live player/camera
  inputs were issued in these isolated fixtures.
- Original per-part resources and the original merged GPU index allocation remain transitional
  ownership debt. Color/material sampling, transparent ordering, mapped shadows, whole-scene
  performance measurements, pose-page memory/upload accounting, and final cleanup are unfinished.
  The selection shader's matrix-fetch semantics can be shared with the next actual depth/color
  consumer when it lands; do not introduce a speculative shader framework.

Mapped-shadow cutover and shared depth preparation — 2026-09-04:

- `DynamicDepthPreparations` now owns one frame-cached material-free geometry decision per root.
  It consumes compact publication and staged appearance resources, applies the shared full-part
  opacity/retail-visibility rules, and coalesces compatible physical spans. Selection and mapped
  shadows share those exact prepared records rather than independently deriving their depth ranges.
  Scalar span pools retain capacity; frame reset and renderer destruction release scene/resource
  references. Shadow ranking, whole-root budgets, outdoor scope checks, and cascade memberships
  remain in `outdoor-pssm-casters.ts`.
- Each shadow cascade retains references to whole-root merged geometry. Removed the old depth-draw
  catalog, caster-part instance records, run grouping/scratch, instance-arena dependency, and
  per-cascade matrix uploads. The pass binds the appearance's physical index buffer and root's
  completed pose-page address, then submits ordinary `drawElements` spans. Selection and shadow
  vertex shaders use the same small matrix-decoding GLSL fragment.
- Only mapped roots whose depth geometry survives selection join the GPU pose population, alongside
  rigid mask roots. The renderer's map deduplicates overlap across cascades, views, and selection.
  Analytic-only roots remain geometry-free and do not acquire pose rows for shadow work. All used
  pose pages are uploaded after preparation and before either pass executes.
- Profiler/UI vocabulary now reports `selectedDepthDrawCount` and `selectedPartCascadeCount`.
  The latter counts distinct eligible parts per root/cascade, not legacy depth-range memberships.
  Removed shadow-specific instance-upload counters and their accumulation into the frame instance
  arena metrics. Those remaining instance metrics do **not** account for shared pose-page uploads;
  complete pose-page memory/upload accounting remains a Phase 7 gate. Historical captures above
  retain their original meanings and must not be compared blindly to the renamed fields.
- **558 renderer tests across 82 files pass**. Focused coverage includes unchanged root ranking and
  budgets, visual outdoor membership, empty geometry, overlapping cascade ownership, shared frame
  preparation, separate view storage, no-work cases, target lifecycle, and ordinary depth draws.
  Removed obsolete instanced-run tests and shader-substring tests; the latter's claimed guarantees
  are now exercised by real GPU depth pixels. `npm run check`, TypeScript lint, and dead-code lint
  pass after removing shader-builder exports that only the deleted tests consumed.
- The real-GPU `outdoor-pssm` fixture now submits a known triangle with the production caster shader,
  pose-page upload, and depth-array target. A padding root puts the caster at pose row 1. Shadow
  comparison readback returns **0 / 255 / 0** for the initial covered point, that point after the
  triangle moves, and the new covered point. Shader/receiver linking and target resize/disposal
  assertions also pass, with an empty browser console. Artifact:
  `/tmp/holtburger-merged-shadow-depth-pixels.png`; the numeric assertion, not that scene screenshot,
  proves the depth behavior. The shared-depth `entity-selection` GPU fixture also passes all prior
  mask/outline/pose/proxy/lifecycle assertions with an empty console.
- The 112×61 synthetic crowd passes real-GPU shadow enable/disable/256/1024 transitions. Its profile
  retains **112 candidates, eight mapped roots, 24 analytic roots, 80 rejected roots, and 976
  part/cascade memberships**. It now selects **16 ordinary shadow draws**, versus the earlier two
  instanced runs. This deliberate repeated-geometry fixture exposes a genuine submission tradeoff:
  removing cross-entity instancing increases draws here even though per-cascade pose uploads are
  eliminated. It is not evidence of an overall speedup or regression without matched CPU/GPU
  measurements. Inspected `/tmp/holtburger-merged-shadow-crowd.png` contains the expected crowd;
  it has no receiver surface and therefore is not shadow-pixel evidence.
- A combined animated WCID 7, selection, portal/flat cycle, and shadow-target cycle passes on the
  real GPU at the isolated radius-1 candle camera, 1280×720, render scale 1. The profile reports
  **one mapped root, two shadow draws, and 34 part/cascade memberships**. Both animated selection
  samples retain 17 parts/550 triangles, one mask draw, and the exact picked GUID; all four mode
  snapshots preserve that mask. The browser console is empty. Inspected
  `/tmp/holtburger-shared-depth-actor.png` shows the outlined actor with building geometry, trees,
  terrain, and the candle. These are correctness captures, not matched performance windows.
- The first combined run stopped at a harness precondition: the shadow cycle inspected the initial
  scene snapshot taken before the actor was spawned, when no mapped targets existed. Like the mode
  cycle, the shadow cycle now captures its own baseline immediately before changing modes. Its
  nonempty-target requirement and allocation/disposal assertions remain intact; the retry passes.

Remaining debt and next integration:

- Dynamic color, alpha-test, transparent/additive residue, and their material-table shader consumer
  still need ordinary merged submission. Their selected roots must join the same pre-execution pose
  population. No capability branch or dynamic instancing fallback has been introduced.
- Legacy depth **expansion** is no longer used by production mask/shadow draws, but the old part
  depth ranges still serve CPU picking through `withSelectionGeometry`. Preserve that consumer
  until it is deliberately migrated; do not delete all depth-range data merely because GPU depth
  moved. Remove unused expansion branches/caches with the remaining legacy color cutover.
- Original per-part GPU ownership, original merged index duplication, complete memory/upload
  measurements, multi-scope indoor integration, simultaneous multi-camera GPU validation, matched
  parked-scene windows, and Phase 8 cleanup remain open. The live player and camera received no input.

#### Shared merged-color shader inputs — 2026-09-04

- Replaced the material-table probe's merged-shader text rewriting with explicit inputs in
  `webgl2-object-program.ts`. The vertex variant reads dense part/material selectors and uses the
  same `DYNAMIC_POSE_GLSL` matrix decoder and `uFirstPoseRow` addressing as selection and shadows.
  Pose-row color preserves partial fades and excludes fully hidden parts from rasterization.
- The table fragment variant shares the existing sampling, indexed palette filtering, alpha test,
  luminosity, lighting, fog, and portal bodies. Only material input declarations differ; detail
  bindings remain draw-scoped. No alternate sampling implementation or capability fallback was
  added. The linked renderer program types and live color submission remain unchanged for now.
- The isolated browser harness can now run this probe with
  `HOLTBURGER_PROBE_MATERIAL_TABLES=1`, without connecting to or moving the live client. Both full
  and brief reports include its result. The uniform-reference probe still has a small text
  substitution to supply part color; that is harness-only comparison debt, not production code.
- Verification: `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and all 558 renderer tests
  across 82 files pass. On the RX 7900 XT/Vulkan real-GPU harness, all 48 material/wrap/rejection/
  opacity cases match exactly (98,304 pixels); all eight fog/portal/PSSM combinations link. The
  last legal pose rows also pass (first row 16,382 on a 16,384-row device). Browser console is empty.
  Command: `HOLTBURGER_PROBE_MATERIAL_TABLES=1 npm run harness:browser -- --brief --gpu
  --fixture outdoor-pssm --measure-ms 0`. The existing PSSM fixture assertions pass in the same run.
- Verification corrections: sandbox socket access initially prevented content-host startup;
  rerunning with local-socket permission resolved it. The new harness hook initially omitted the
  required empty evaluation-argument array; that was corrected before the successful runs.
- Remaining work: create the renderer-owned linked table-program contract and bind its samplers;
  prepare physical color batches and ordered transparent residue; include their roots in the
  pre-execution pose upload union; cut over portal/lighting routing and remove legacy expansion.
  Program linking is not proof of fog/portal/shadow pixel behavior in the integrated path, and
  these tiny probe timings are not evidence of a full-scene steady-state improvement. Phase 6
  remains incomplete; no parked-scene performance claim or user-input requirement is introduced.

#### Linked merged-color program contract — 2026-09-04

- `createWebGL2ObjectProgram` now constructs the table-backed variant as well as the existing
  uniform/attribute variants. Shared view, lighting, detail, and physical sampler bindings are
  separated from per-draw material uniforms. Merged programs expose required pose/material table
  locations and `firstPoseRow`, not nullable placeholders for material uniforms removed by GLSL.
- Link-lifetime sampler assignments use pose unit 3 and material unit 4. These do not overlap the
  object base/palette/detail units 0/1/2, deferred portal envelope unit 5, or PSSM depth unit 7.
  Shared program construction now uses the existing `linkWebGL2Program` helper instead of its own
  partially failure-safe compile/link sequence. A required-binding failure deletes the program.
- The material probe now uses this production constructor for its pixel comparisons and every
  fog/portal/PSSM combination. It no longer assigns pose/material sampler uniforms itself. Its
  uniform reference also uses the shared link helper; the reference-only part-color substitution
  remains harness debt. No unused renderer-owned programs have been eagerly allocated.
- Verification: the isolated real-GPU command from the preceding entry passes again: 48 exact
  material cases, eight fully constructed program variants, legal boundary pose rows, and no
  browser console messages. This additionally verifies required uniform and portal metadata-block
  lookup, not merely linking shader text. All 560 renderer tests across 82 files, `npm run check`,
  `npm run lint:ts`, `npm run lint:dead`, and `git diff --check` pass. A new unit test initially
  lacked the portal metadata-block mock; it now implements that protocol using the runtime size
  constant. No production fallback or relaxed assertion was introduced.
- Integration evidence for the next step: existing dynamic transparent centers are the part's
  local-bounds center, transformed to landblock space (`mergePreparedParts` and
  `getVisibleContributions`), not independently computed per-polygon centers. Existing opacity
  routing promotes only opaque ranges to transparent for a partial fade; alpha-test ordering is
  retained, and exactly full translucency skips the part. Preserve those contracts when replacing
  expansion; do not introduce a new sorting policy as a side effect of merging.
- Remaining: actual renderer color batch preparation/execution, transparent sorting and portal
  routing, their contribution to the shared pose population, and legacy ownership/expansion
  removal. The live renderer still uses legacy dynamic color submissions; Phase 6 is not complete.
  No performance conclusion is drawn from the isolated probe. Player and camera remain untouched.

#### Production opaque/alpha-test color cutover — 2026-09-04

- Selected opaque dynamic roots now publish merged color submissions into each prepared view's
  selected portal domains. `DynamicOpaqueRanges` computes eligibility and contiguous physical
  spans once per root/frame, sharing results across views and retaining only scalar pooled storage.
  Different batches and hidden/fading gaps cannot coalesce. Exactly zero opacity is omitted;
  partially faded opaque ranges remain ordered residue, while alpha-test retains its existing
  phase under partial fades. Shader alpha rejection still comes from the appearance table.
- `webgl2-renderer.ts` executes these spans with ordinary `drawElements`, the installed merged VAO,
  appearance index buffer, material table, and shared pose address. Selected color roots join the
  same upload population as masks/shadows before any prepared view executes. Placement remains
  landblock-relative; portal opaque routing retains scope-atlas tiles and clip transforms.
  Lighting retains the existing dynamic role and static-light landblock. Dynamic meshes were not
  PSSM receivers before this change and are not newly made receivers. Rigid material production
  explicitly uses `detailRole:null`; static detail remains unchanged.
- The merged color program is created on first preparation, not during a draw. Texture state
  application now accepts a null sampler for table textures, using their own nearest/clamp
  parameters while keeping the state cache coherent. The program and frame caches are released
  at their normal renderer/frame boundaries.
- This is a staged consumer cutover, not a selectable fallback: all eligible dynamic opaque and
  alpha-test submissions leave the legacy compile/run/instance path. Transparent/additive
  submissions temporarily retain it until the next integration. Legacy range expansion still
  runs for ordered residue and existing diagnostic counts; it has not yet been removed from CPU
  preparation. Current `visibleDynamicPartCount` retains its old range-count meaning. Total
  dynamic draw counts include the new ordinary draws, while dynamic instance/uniform-draw counts
  do not. The old reduction census and singleton diagnostic now cover only remaining legacy
  submissions and must not be used as whole-dynamic comparisons; remove them at final cutover.

Verification:

- All 564 renderer tests across 83 files pass, along with `npm run check`, `npm run lint:ts`,
  `npm run lint:dead`, and `git diff --check`. New range tests cover coalescing, fade gaps,
  alpha-test preservation, hidden parts, frame expiration/reuse, and independent retained roots.
- Real-GPU animated actor command: `npm run harness:browser -- --brief --gpu --building-radius 1
  --explicit-object-radius 1 --generated-object-radius 1 --spawn-wcid 7 --spawn-distance 4
  --spawn-simulated --spawned-selection-probe --mode-cycle --entity-shadow-cycle --profile-renderer
  --camera-position 42087,37.9,-16638.4 --camera-yaw 0 --camera-pitch 0
  --screenshot /tmp/holtburger-merged-opaque-actor.png --measure-ms 1000`. Exit 0, empty console,
  RX 7900 XT/Vulkan, 1280x720 at render scale 1. All four flat/portal snapshots retain 15 dynamic
  ordinary color draws and zero dynamic instances. Animated selection retains 17 parts/550
  triangles, exact GUID picking, and one mask draw; mapped shadows retain two cascade draws.
  Inspected screenshot shows the actor, outline, building, trees, terrain, and candle intact.
- Real indoor command: `npm run harness:browser -- --brief --gpu --landblock 0x7d64ffff
  --building-radius 1 --env-cell-radius 1 --explicit-object-radius 1 --generated-object-radius 1
  --env-cell-camera 0x7d640113 --env-cell-position 24078.5,13.7,-19328.25 --camera-yaw 0
  --camera-pitch 0 --frame-mode portal --mode-cycle
  --screenshot /tmp/holtburger-merged-opaque-indoor.png --measure-ms 0`. Exit 0, empty console.
  Portal snapshots select six scopes and three dynamic roots, with four dynamic draws including
  one legacy ordered instance. Flat snapshots select eight dynamic roots and eleven draws,
  including that ordered instance. The inspected final screenshot (the cycle ends in flat mode)
  retains the doorway, neighboring building, and blue torch; it is not a portal-mode pixel oracle.
- Same-generation replacement command: `npm run harness:browser -- --brief --gpu
  --nameplate-workload occlusion-open --probe-dynamic-appearance
  --screenshot /tmp/holtburger-merged-opaque-appearance.png --measure-ms 0
  --camera-position 42087,37.9,-16638.4 --camera-yaw 0 --camera-pitch 0`. Exit 0, empty console;
  unchanged placement, replacement width, and changed-image assertions pass. Inspected before/
  after images show the narrow red triangle replaced by the wider green triangle. Final color
  submission is one ordinary dynamic draw and zero dynamic instances.

Remaining work: integrate ordinary ordered residue into the shared transparent ordering path,
remove all legacy dynamic expansion and its ownership, and consolidate the temporary opaque-only
submission plumbing into the final color contract. Verify explicit fades/alpha holes and portal
pixels through that complete path, then perform the planned multi-view and matched steady-state
measurements. These correctness runs are not performance comparisons or evidence of reaching
200 FPS. The parked live client received no player or camera input.

#### Ordered color cutover and renderer expansion removal — 2026-09-04

- Dynamic transparent/additive ranges now enter the same `createObjectSubmissionPhases` far/near/
  additive sequence as static objects. A discriminated merged submission is a non-instance draw
  barrier: adjacent static runs cannot cross it. No independent draw-dynamics-last pass, dynamic
  instancing fallback, multi-draw branch, or new transparency sorting policy was introduced.
- Cold appearance ranges retain the prior source-range cohort key and geometry-local part-bounds
  center. Split selector spans share that source-range record; centers are calculated once per
  part during appearance compilation. Compact publication includes the source identity needed
  for the existing entity/part/range stable tie-break key. Frame preparation applies the current
  part matrix to produce landblock-space centers and keeps the original far cohort keys. This
  preserves a sorting contract that remains necessary even after instancing is removed.
- All ordered dynamic roots join the pre-execution pose population. Their unfogged plain/portal
  variants are prepared before execution, and deferred portal visibility remains scope-specific.
  Existing physical blend factors, opacity eligibility, and alpha-test phase rules are retained.
  Opaque and ordered consumers now share entity pose/material binding and ordinary physical-span
  draw helpers; their different phase routing remains explicit.
- Removed `webgl2-renderer.ts`'s legacy contribution expansion method and its upgrade/cache state.
  Neither color nor mask/shadow draws ask `RenderWorld` to expand dynamic per-part draw units.
  The historical `visibleDynamicPartCount` range-count meaning is preserved using reusable
  source-range-group scratch, including grouping selector splits back to their original source
  range. The animated scene still reports 69 such ranges. This metric still needs its planned
  vocabulary correction; it is not a count of distinct rigid parts.

Verification and evidence:

- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and 606 tests across the renderer plus
  dynamic-system/template-repository suites (85 files) pass. The compact-publication test now
  verifies source identity and correspondence of cold sort keys/centers to the previous ordering
  facts. Existing generic adjacent-run tests remain applicable to non-instance barriers.
- The six-scope indoor mode-cycle command from the preceding entry passes with
  `/tmp/holtburger-merged-blended-indoor.png`: portal snapshots retain four dynamic draws, flat
  snapshots eleven, and both now have zero dynamic instances and one transparent object draw.
  No browser console messages were reported.
- Added an opacity cycle to the existing synthetic appearance probe. After same-generation
  appearance replacement, translucency 0 -> 0.5 -> 1 -> 0 must yield dynamic draw counts
  1 -> 1 -> 0 -> 1, transparent draw counts 0 -> 1 -> 0 -> 0, and zero dynamic instances throughout.
  Captured images must change at the partial/hidden steps and restore the original opaque image
  exactly. The production runtime receives the state updates; the fixture does not directly alter
  GPU pose rows. The command from the preceding appearance entry passes with screenshot prefix
  `/tmp/holtburger-merged-color-opacity-final.png`; `.opacity-0.png` through `.opacity-3.png`
  retain the sequence. Inspected images show the dimmed green triangle and its fully hidden state.
- After renderer expansion removal, the full animated actor/selection/mode/shadow-cycle command
  passes again with `/tmp/holtburger-merged-color-actor-final.png` and `--measure-ms 0` (profiling
  omitted). All mode snapshots retain 15 dynamic color draws, zero dynamic instances, and 69
  source ranges. Animated selection retains 17 parts/550 triangles, exact picking, and one mask
  draw. The inspected screenshot retains the actor, outline, building, trees, terrain, and candle.
- Also captured the real indoor scene without a mode cycle, so the screenshot stays in portal
  mode: the preceding indoor command with `--mode-cycle` omitted and screenshot
  `/tmp/holtburger-merged-color-portal-final.png`. Exit 0, empty console, six selected scopes,
  four dynamic color draws, zero dynamic instances, and one transparent draw. Inspected doorway
  and blue-torch geometry are intact. These final two correctness runs were concurrent; their
  timing output is not performance evidence.

Remaining debt and gates:

- The `RenderWorld`/system legacy expansion APIs and their reusable per-part wrappers still exist
  for old tests, along with old per-part GPU ownership, original merged-index duplication,
  counterfactual census code, singleton diagnostic switches, and obsolete instance metrics.
  Production color no longer feeds those dynamic strategies. Remove these mechanisms rather than
  preserving empty diagnostic output or tests as justification for the old architecture.
- Ordered preparation currently creates per-view range records and transformed sort centers;
  consolidate their ownership/reuse where warranted during final contract cleanup. The opaque
  span cache already reuses scalar storage. Preserve actual source ordering while simplifying.
- Explicit additive/inverse-alpha effects, interleaved near/far static and dynamic transparency,
  alpha-test holes through the complete renderer, simultaneous camera views, and remaining
  appearance/attachment/CPU-picking lifetime cases still need the planned focused validation.
  The successful opacity and torch fixtures do not prove all of these cases.
- All remaining Phase 5 ownership cleanup, Phase 7 matched steady-state/memory/upload measurements,
  and Phase 8 removal gates remain active. No 200 FPS claim or parked-scene speedup is made. The
  live player's placement and camera received no input.

#### Dynamic GPU geometry ownership cleanup — 2026-09-04

- `ObjectVisualTemplate` no longer carries a redundant GPU-source array containing both original
  parts and their merged layout. The repository derives its single geometry lease directly from
  `template.layout`. Original CPU meshes remain shared within preparation and retained by part
  records for picking; this does not delete any static/particle owner's independently held mesh.
  CPU layout sharing between ready appearances now replaces only the layout, without rewriting
  a parallel source list.
- Dynamic layout uploads contain exactly five vertex streams: positions, normals, UVs, and the
  two integer selectors. They no longer allocate/upload an original merged element buffer.
  Color, selection, and mapped-shadow consumers already bind appearance-owned index buffers;
  source merged indices remain on the CPU for cold appearance compilation and atlas rebuilds.
  Non-dynamic geometry retains its existing uploaded element buffer.
- Geometry-manager byte accounting now excludes CPU-only dynamic source indices. This is the
  shared geometry lease total, not a complete renderer memory total: Phase 7 must include separate
  appearance indices/material textures and pose pages. Do not present a reduction in this one
  bucket as the complete memory effect. Cold part geometry-key/range fields remain candidates for
  the final consumer/vocabulary audit, not justification for restoring their former GPU leases.
- Tests verify exact dynamic stream upload/release, shared-layout lifetime across distinct
  appearance owners, retained CPU positions, and current-layout-only publication after stale
  preparation. Updated the old synthetic template fixture to stop supplying its removed GPU
  source list. Renderer/geometry/system/repository tests pass: 622 tests across 87 files.
  `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and `git diff --check` also pass.
- Real-GPU actor regression: the command in the compact-publication entry below, with screenshot
  `/tmp/holtburger-layout-ownership-actor.png`, exits 0 with an empty browser console. Four mode
  snapshots retain 15 dynamic color draws and zero dynamic instances. Selection retains 17 parts,
  550 triangles, one mask draw, and exact GUID 4026531841; shadow-resource cycles pass. Inspected
  pixels retain the actor/outline, building, trees, terrain, and candle.
- Real-GPU appearance regression:

  ```sh
  npm run harness:browser -- --brief --gpu --nameplate-workload occlusion-open --probe-dynamic-appearance --screenshot /tmp/holtburger-layout-ownership-opacity.png --measure-ms 0 --camera-position 42087,37.9,-16638.4 --camera-yaw 0 --camera-pitch 0
  ```

  Exit 0 and empty browser console. The production appearance-replacement and opacity-cycle
  assertions pass; the inspected final image contains the restored wider green triangle.
  Both GPU runs are correctness checks, not matched timing comparisons. They use isolated harness
  cameras; the parked live player and camera remain untouched.

Remaining gates: verify preparation never begins during dynamic draw execution, finish the
outstanding visual/lifetime cases, account for every dynamic GPU owner, collect matched steady-state
measurements, and remove obsolete diagnostics/strategy vocabulary. No alternate draw path or
correctness concession was added.

#### Compact publication ownership cleanup — 2026-09-04

- Removed `RenderWorld.expandDynamicContributions` and its system port, then removed
  `DynamicEntitySystem.getVisibleContributions`, its per-entity material/depth maps, borrowed
  output arrays, hidden singleton, and replacement/reset wiring. A source-wide consumer search
  confirmed that only obsolete tests still called these APIs after the production color cutover.
- Removed the visible-contribution types and `ActiveDynamicDrawUnit`/active part `drawUnits`.
  Active entities no longer allocate color-range wrappers or duplicate transparent-sort centers.
  Cold appearance compilation still owns authored material ranges and sort facts. CPU picking
  retains its actual consumers: geometry data, depth ranges, part bounds, and current matrices.
  Part scene nodes and attachment lifetime are unchanged.
- Reworked system tests around compact publication: shared immutable layouts/appearances,
  independent reusable part matrices, effect opacity, dense selectors at zero opacity, hidden
  object suppression, cloak write semantics, and visual identity across object translucency.
  Deleted RenderWorld's old expansion mock and its fixture-only transparency assertions. Render
  ordering remains renderer-owned rather than being reconstructed in system tests.
- Validation: `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and 614 tests in 86 files
  pass (renderer, dynamic system, template repository, and prepared animation). The first type
  check caught an over-broad fixture edit: the animation fixture is a cold `PartVisualTemplate`,
  not an active part, so its required `drawUnits` field was restored before the successful check.
- Real-GPU regression command:

  ```sh
  npm run harness:browser -- --brief --gpu --building-radius 1 --explicit-object-radius 1 --generated-object-radius 1 --spawn-wcid 7 --spawn-distance 4 --spawn-simulated --spawned-selection-probe --mode-cycle --entity-shadow-cycle --camera-position 42087,37.9,-16638.4 --camera-yaw 0 --camera-pitch 0 --screenshot /tmp/holtburger-compact-publication-actor.png --measure-ms 0
  ```

  Exit 0 and `consoleMessages: []`. All four mode snapshots retain 15 dynamic color draws,
  zero dynamic instances, and 69 source ranges. Exact selection retains GUID 4026531841 and
  17 parts/550 triangles; shadow cycles pass. The inspected screenshot retains the animated
  actor/outline, building, trees, terrain, and candle. This isolated correctness run does not
  establish a steady-state speedup; the parked live player and camera received no input.

Remaining work: remove duplicate per-part GPU resources and redundant merged index ownership,
then complete the outstanding Phase 6 visual/lifetime cases, Phase 7 matched measurements, and
Phase 8 diagnostic/vocabulary cleanup. Cold template material ranges are still needed to compile
appearances; do not confuse them with the removed active per-entity expansion mechanism. No new
rendering fallback, compatibility layer, or correctness concession was introduced.

#### Preparation audit and dynamic GPU accounting — 2026-09-04

- Completed the Phase 5 call-path audit. `ObjectVisualTemplateRepository.#prepareEntry` invokes
  the injected preparer and stages geometry/atlas requirements before retaining the renderer
  appearance. `WebGL2DynamicAppearances.get` only reads an installed generation and throws if
  missing; color and depth preparation use that read contract. Dynamic draw executors bind
  prepared geometry/appearance generations and previously uploaded pose addresses. They do not
  compile source layouts or create appearance tables/index buffers on a cache miss.
- Refined the preparation checkbox to state the actual boundary rather than imply that every
  kind of preparation is outside every frame callback. Atlas publication rebuilds appearance
  bindings through runtime invalidation. A texture-filtering change rebuilds them during frame
  setup, where the setting is observed. Dynamic shader variants are linked on first use during
  view preparation, before execution. These are cold events; unchanged steady-state frames reuse
  the result. The inline source preparer remains intentional for this cut. Moving work to workers
  or tuning settings/streaming stalls is not part of the steady-state measurement effort.
- Added cold `dynamicResources` to renderer diagnostics and both harness reporting surfaces:
  appearance index/material payload bytes, pose-page GPU capacity, and the last completed pose
  upload's payload bytes. Shared geometry leases remain separately reported. Appearance counts
  are derived from current retained generations, not multiplied by their reference counts; pose
  upload bytes count populated rectangles, not high-water page capacity. No profiling clocks,
  GPU queries, or frame-rate snapshot allocations were added.
- Existing lifetime/upload tests now verify byte accounting across shared references, final
  release, reduced populations, empty uploads, and destruction. Renderer/runtime suites pass
  609 tests in 84 files. `npm run check`, `npm run lint:ts`, and `npm run lint:dead` pass.
- Real-GPU verification uses the actor/mode/selection/shadow command above with screenshot
  `/tmp/holtburger-dynamic-resource-accounting.png` and `--measure-ms 0`. Exit 0, empty browser
  console, 15 dynamic draws and zero dynamic instances in all four mode snapshots. Selection
  retains 17 parts/550 triangles, one mask draw, and exact GUID 4026531841. The inspected image
  retains the actor/outline, building, trees, terrain, and candle.
- In that isolated fixture, the final snapshot reports 23,448 appearance-index bytes, 3,520
  material-table bytes, 1,310,720 allocated pose-page bytes, and a 3,040-byte last pose upload.
  The separate geometry-manager total is 21,711,861 bytes across 39 resources. These are payload
  accounting checks on this fixture, not parked-scene budgets or measured savings. They exclude
  driver overhead, CPU staging/source data, atlases, and other render targets; include those
  appropriate owners when describing whole-renderer memory. Pose-page CPU staging mirrors its
  allocated GPU capacity and must not be mistaken for an additional GPU allocation.

Phase 5 ownership/preparation is now complete under the stated cold-event boundary. Phase 6's
remaining additive/inverse-alpha, interleaved transparency, alpha holes, simultaneous-view, and
attachment/appearance lifetime cases remain open. Phase 7 matched measurements and Phase 8 cleanup
remain required. The parked live player and camera received no input.

#### Simultaneous-view GPU validation — 2026-09-04

- Added harness-only `--probe-dynamic-views` and `dynamic-multiview-probe.ts`. The probe captures
  one real runtime input, then synchronously renders A, B, A+B, B+A, and A+A without advancing
  simulation. B retains A's authoritative position/cell but looks at yaw 90 degrees. The original
  runtime camera and presentation are restored; no production multi-view API or rendering strategy
  was added. The one-frame interception restores the renderer method on success, error, or timeout.
- Both flat and portal runs require different visible dynamic populations and different images
  for A/B. Combined feedback must equal the selected-root union; draw counts must equal the two
  standalone counts. Combined pose payload must fit the union bounds and remain order-independent.
  A+A must retain A's exact pose upload size while executing twice its draws. Exact PNG equality
  verifies A+B ends with B's standalone image and B+A/A+A end with A's image. This exercises two
  retained camera plans in one production frame, with sequential execution on the shared target;
  it does not claim a split-screen presentation feature.
- Real-GPU commands:

  ```sh
  npm run harness:browser -- --brief --gpu --building-radius 1 --explicit-object-radius 1 --generated-object-radius 1 --probe-dynamic-views --camera-position 42087,37.9,-16638.4 --camera-yaw 0 --camera-pitch 0 --screenshot /tmp/holtburger-dynamic-multiview-final.png --measure-ms 0
  npm run harness:browser -- --brief --gpu --landblock 0x7d64ffff --building-radius 1 --env-cell-radius 1 --explicit-object-radius 1 --generated-object-radius 1 --env-cell-camera 0x7d640113 --env-cell-position 24078.5,13.7,-19328.25 --camera-yaw 0 --camera-pitch 0 --frame-mode portal --probe-dynamic-views --screenshot /tmp/holtburger-dynamic-multiview-indoor-final.png --measure-ms 0
  ```

  Both exit 0 with empty browser consoles. The final indoor run also verifies the subsequently
  added draw-sum assertions; the outdoor report already exhibits those exact sums. Screenshot
  suffixes `.flat-a.png` through `.flat-aa.png` and their portal equivalents retain the comparisons.

| Scene/mode | A roots / draws / pose bytes | B roots / draws / pose bytes | A+B roots / draws / pose bytes |
| --- | --- | --- | --- |
| Outdoor, flat and portal | 7 / 13 / 1,520 | 7 / 11 / 1,200 | 11 / 24 / 2,160 |
| Indoor, flat | 8 / 11 / 640 | 22 / 30 / 1,760 | 22 / 41 / 1,760 |
| Indoor, portal | 3 / 4 / 240 | 14 / 22 / 1,120 | 14 / 26 / 1,120 |

Inspected outdoor B pixels retain building geometry, trees, and terrain; indoor portal B retains
doorways, neighboring rooms, and the blue torch. All comparisons are at a frozen publication,
not performance samples. The scene commands initially ran concurrently; the final indoor run was
separate. No parked live player/camera input was issued. `npm run check`, lint/dead-code checks,
and 565 renderer tests (83 files) pass; no renderer behavior change was needed for this gate.

This closes the simultaneous-view validation thread for distinct orientations sharing a camera
position/anchor, in real outdoor and indoor content. Additive/inverse-alpha, deliberately interleaved
static/dynamic transparency, explicit alpha holes, and remaining attachment/appearance lifetime
cases still require their focused evidence before Phase 6 is complete.

#### Appearance, attachment, and CPU-picking lifetime validation — 2026-09-04

- Audited the existing runtime coverage instead of duplicating it: same-generation palette,
  texture, and part changes; animation advancement against an unchanged control; A→B→A and
  reverse completion order; deletion/residency withdrawal during loading; failed preparation;
  child-first attachment; setup replacement with child reattachment; and owner eviction.
  Repository tests additionally cover shared-layout final-owner release and appearance-staging
  rollback. These exercise the current compact publication and merged-resource ownership.
- Extended the system attachment test to stage parent and child geometry replacements together.
  It advances the parent through normal `publishPresentation`, verifies the old child mesh remains
  pickable while staged, commits child then parent, and verifies both original part-frame targets
  survive. Subsequent parent poses produce identical child translations through scene placement,
  compact renderer payloads, and `withSelectionGeometry`; both picking meshes reference the newly
  installed CPU positions. Removed the old test's direct scene-transform mutation and non-null
  assertions so the test follows the actual publication contract.
- Strengthened the runtime root/part cue-emitter cases (`partIndex` -1 and 0): compatible appearance
  replacement now changes actual geometry and bounds. The selected rigid bounds confirm the new
  mesh is installed, the emitter survives, and an incompatible setup replacement retires it.
  This complements the explicit stable part-target and moving attachment checks above.
- System/runtime/template-repository suites pass 86 tests in three files; `npm run check`,
  `npm run lint:ts`, `npm run lint:dead`, and `git diff --check` also pass. This turn changes tests
  only; no renderer, runtime behavior, or compatibility fallback was added. Earlier real-GPU
  appearance/opacity and animated exact-selection runs remain the GPU integration evidence, not
  a claim that this CPU test rendered an emitter image. The first new test attempt inspected a
  committed preparation handle; capturing its prepared entity before commit corrected the test
  to obey the existing lifecycle contract.

The CPU-picking/part-frame consistency gate and the synthetic appearance/eviction race gate are
now verified. Deliberately interleaved static/dynamic transparency, additive/inverse-alpha pixels,
and explicit alpha-test holes remain the outstanding focused visual work. No streaming timing
claim is made, and the parked live player/camera were not accessed.

#### Production dynamic blend-flag GPU verification — 2026-09-04

Correction: the original `--frame-mode portal` command below applied that mode after this probe.
Its pixel evidence was flat-mode evidence. The later "Mixed transparency and capture-mode audit"
entry records the harness fix and a verified portal rerun of all six equations and texture holes.

- Added harness-only `--probe-dynamic-blend-flags`, using the existing isolated synthetic setup
  source and ordinary runtime appearance updates. Reserved fixture palette selectors choose
  materials; production policy still classifies their real surface flags and resolves blend state.
  The test triangle has source alpha 0.25, so ordinary and inverse alpha cannot pass by producing
  the same result. Emissive color, disabled fog, and disabled color grading isolate blending from
  variable lighting/post-processing. The original entity and settings are restored afterward.
- The probe captures a hidden background and opaque source, selects a covered pixel, and compares
  six rendered variants against independent source/destination blend equations. Each variant must
  produce one dynamic draw in the expected transparent or additive phase. A two-byte tolerance
  allows normalized-buffer rounding; observed errors are zero or one byte per color channel.
  This is production material-table, shader, and draw-state evidence, not merely a policy unit test.
- Commands (both exit 0 with empty browser consoles):

  ```sh
  npm run harness:browser -- --brief --gpu --nameplate-workload occlusion-open --probe-dynamic-blend-flags --screenshot /tmp/holtburger-dynamic-blend-flags.png --measure-ms 0 --camera-position 42087,37.9,-16638.4 --camera-yaw 0 --camera-pitch 0
  npm run harness:browser -- --brief --gpu --frame-mode portal --nameplate-workload occlusion-open --probe-dynamic-blend-flags --screenshot /tmp/holtburger-dynamic-blend-flags-portal.png --measure-ms 0 --camera-position 42087,37.9,-16638.4 --camera-yaw 0 --camera-pitch 0
  ```

  Both modes report opaque RGB [51,102,153], background [38,13,13], and identical blend results
  at pixel (639,339). Per-flag screenshots use `.blend-<decimal flags>.png` suffixes.

| Surface flags | Expected RGB | Actual RGB, flat and portal |
| --- | --- | --- |
| Translucent `0x10` | [41,35,48] | [41,35,48] |
| Alpha `0x100` | [41,35,48] | [41,35,48] |
| Inverse alpha `0x200` | [48,80,118] | [48,80,118] |
| Additive `0x10000` | [89,115,166] | [89,115,166] |
| Additive alpha `0x10100` | [51,39,51] | [51,38,51] |
| Additive inverse alpha `0x10200` | [76,90,128] | [76,89,128] |

The inspected inverse-alpha screenshot contains the expected blue triangle. `npm run check`,
`npm run lint:ts`, `npm run lint:dead`, 565 renderer tests in 83 files, and `git diff --check`
pass. Only harness code changed; no renderer fix was required. The portal run exercises the portal
renderer in the isolated outdoor fixture, not a new claim about every indoor visibility domain.
These readbacks are correctness evidence, not timings. The parked live player/camera were untouched.

Remaining Phase 6 visual work: deliberate interleaving of static/dynamic transparent geometry
through the near/far ordering policy, and explicit texture alpha-test holes. The single-triangle
blend checks do not establish either of those properties.

#### Production dynamic texture cutout verification — 2026-09-04

Correction: the original portal-labeled capture below ran its probe in flat mode; final report
settings were not sufficient evidence. See the later capture-mode audit and verified portal rerun.

- Extended the existing blend probe with a solid reference and a 2×2 direct-color RGBA checker
  clip map, using ordinary runtime appearance replacement. A harness-only `TexturePixelSource`
  adapter supplies this one fixture texture; real asset requests remain delegated unchanged.
  Worker texture preparation, atlas publication, material compilation, merged geometry, and
  production alpha-test shading all remain in the exercised path.
- Nearest filtering, emissive source color, disabled fog, and disabled color grading make the
  expected pixels explicit. Every covered solid-reference interior pixel must equal either the
  opaque source or the captured background. Both populations must contain at least 100 pixels;
  the cutout must submit exactly one dynamic draw and zero transparent/additive draws.
- The first run failed because the adapter compared the raw texture DID with a resource-qualified
  preparation request. `assetPreparationRequest` prefixes object texture IDs with
  `surface-texture/`; correcting the fixture adapter to that contract fixed the missing-resource
  failure. No production renderer or texture preparation change was needed.
- Successful commands, both exit 0 with empty browser consoles:

  ```sh
  npm run harness:browser -- --brief --gpu --nameplate-workload occlusion-open --probe-dynamic-blend-flags --screenshot /tmp/holtburger-dynamic-cutout.png --measure-ms 0 --camera-position 42087,37.9,-16638.4 --camera-yaw 0 --camera-pitch 0
  npm run harness:browser -- --brief --gpu --frame-mode portal --nameplate-workload occlusion-open --probe-dynamic-blend-flags --screenshot /tmp/holtburger-dynamic-cutout-portal.png --measure-ms 0 --camera-position 42087,37.9,-16638.4 --camera-yaw 0 --camera-pitch 0
  ```

  Both modes retain 1,024 opaque pixels and reveal the exact background through 1,023 holes.
  All six existing blend-equation checks also pass. Inspected `.cutout.png` and
  `.cutout-reference.png` screenshots show the intended checker holes and solid reference.
  The portal capture exercises an outdoor root in portal mode, not every indoor visibility domain.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and all 565 renderer tests in 83 files
  pass. The final resource-prefix correction was followed by type and lint checks and both GPU
  runs. These captures establish correctness only; no steady-state speedup is claimed.

The explicit alpha-test-hole gate is now covered. Deliberately interleaved static/dynamic
transparency and the remaining visibility-domain audit still precede Phase 6 closure. Phase 7's
matched full-scene measurements and Phase 8 cleanup remain open. The parked live player and
camera were not accessed. The synthetic texture adapter is harness-only validation infrastructure,
not a new production rendering strategy.

#### Mixed transparency and capture-mode audit — 2026-09-04

- Added `mixed-transparency-probe.ts`, selected by combining `--fixture blended` with the existing
  `--probe-dynamic-blend-flags` option. It captures background, static-only, dynamic-only, and
  combined pixels. The static triangle uses alpha 0.5 and the dynamic triangle alpha 0.25, so the
  two composition orders have distinguishable expected colors. Captured single-layer colors
  account for static lighting; independent alpha equations determine the combined expectations.
- Synthetic actor positions at local Y=118 and 122 straddle the fixture's Y=120 static plane.
  A third position at `120 + transparentObjects.nearDistance` crosses the near/far threshold.
  Each sample must retain six baked static draws, one merged dynamic draw, four transparent
  candidates/draws, and three additive draws, with the expected near/far candidate populations.
  The actor and frame settings are restored afterward; the parked live client is not involved.
- Fixed two stale fixture contracts uncovered by actual failures: buildings now publish explicit
  empty map surfaces for their non-colliding sources, and the blended fixture delegates terrain
  preparation to `StandardCommitPipeline` to satisfy outdoor dynamic residency. Terrain is hidden
  only during pixel captures, not bypassed as a residency requirement. The fixture owns and
  destroys that pipeline. No production residency or renderer rule was weakened.
- **Evidence correction:** `browser-harness.mjs` applied `--frame-mode` after the dynamic probes.
  Consequently the previously labeled portal blend/cutout runs and the first mixed portal run
  actually captured flat mode. Moved explicit mode selection and its completion wait before these
  probes. Both material probes now assert the renderer mode at every capture; the blend report
  also records it. The earlier portal claims are superseded, not silently treated as verified.
- Completed GPU commands (all exit 0, empty browser consoles):

  ```sh
  npm run harness:browser -- --brief --gpu --fixture blended --building-radius 0 --nameplate-workload occlusion-open --probe-dynamic-blend-flags --screenshot /tmp/holtburger-mixed-transparency-boundary.png --measure-ms 0 --camera-position 41945.5,2.5,-16430 --camera-yaw 0 --camera-pitch 0
  npm run harness:browser -- --brief --gpu --frame-mode portal --fixture blended --building-radius 0 --nameplate-workload occlusion-open --probe-dynamic-blend-flags --screenshot /tmp/holtburger-mixed-portal-verified.png --measure-ms 0 --camera-position 41945.5,2.5,-16430 --camera-yaw 0 --camera-pitch 0
  npm run harness:browser -- --brief --gpu --frame-mode portal --fixture blended --building-radius 0 --nameplate-workload occlusion-open --probe-dynamic-blend-flags --screenshot /tmp/holtburger-mixed-far-portal.png --measure-ms 0 --camera-position 41945.5,2.5,-16410 --camera-yaw 0 --camera-pitch 0
  npm run harness:browser -- --brief --gpu --frame-mode portal --nameplate-workload occlusion-open --probe-dynamic-blend-flags --screenshot /tmp/holtburger-cutout-portal-verified.png --measure-ms 0 --camera-position 42087,37.9,-16638.4 --camera-yaw 0 --camera-pitch 0
  ```

  At the near camera, flat and verified portal captures agree: front actor RGB [76,30,91]
  versus expected [76,30,92]; behind actor RGB [86,18,89] versus [86,17,89]. The distant actor
  has the same behind-static result, with one far and three near transparent candidates.
  At the distant portal camera, all four candidates are far; every actor position yields
  [75,30,91] exactly, preserving first-seen static cohorts followed by the dynamic cohort rather
  than introducing exact depth sorting into the existing distant policy.
  The verified portal cutout rerun retains 1,024 pixels and reveals 1,023 background holes;
  all six blend equations pass with the previously recorded zero/one-byte rounding differences.
- Inspected near mixed, distant mixed, and verified portal cutout screenshots. Type checks,
  lint, dead-code checks, all 565 renderer tests in 83 files, and `git diff --check` pass.

This closes focused baked-static/merged-dynamic pixel ordering coverage and repairs the earlier
portal material evidence. It does not independently prove generated-static instance-run barriers,
all indoor/plural visibility domains, or steady-state performance. Those audits and the Phase 7
matched comparisons remain ahead of final cleanup. The reused blend option's fixture-dependent
report shape is harness-only; no alternate production submission strategy was added.

#### Instance-run and visibility-domain source audit — 2026-09-04

- Added a composed `object-rendering-policy.test.ts` case that first applies production near
  transparency ordering, then adjacent instance-run formation. Two compatible generated instances
  coalesce behind a merged dynamic range; the compatible instance in front remains a separate
  run. This covers the combination of sorting and barriers, rather than only an already-ordered
  input. The distance classification derives from the runtime near-distance tuning.
- Audited `webgl2-renderer.ts::scheduleFrameInstanceRuns`: merged draws cannot satisfy the
  frame-instance predicate or compatibility predicate. Transparent far and near phases both use
  adjacent grouping, and `#prepareFrameInstanceRuns` emits singleton merged values in sequence.
  Grouped additive/opaque policy remains distinct; the test does not incorrectly impose a
  transparency barrier requirement on order-independent phases.
- Audited dynamic color preparation: `selectedDynamicRenderScopeKeys` computes one selected
  visibility-island domain list, consumed by both opaque and transparent/additive preparation.
  Its tests cover flat-mode collapse, distinct selected domains, unselected membership exclusion,
  and sibling-cell island deduplication. Pose upload remains keyed by entity root rather than
  duplicated per selected scope.
- Opaque execution forwards each retained key to `routeObjectSubmission`, which selects the
  scope tile and clip transform. Deferred execution forwards the same key to
  `routeDeferredSubmission` for its visibility envelope. Both use the shared object-lighting
  binder. That binder's existing lighting roles are source-based, with landblock static lights;
  this audit does not claim a new per-cell dynamic lighting model.

The focused policy/domain suites pass (34 tests in two files), as do type checks, lint, all 566
renderer tests in 83 files, and `git diff --check`. This is direct
source and CPU-policy evidence, not a generated-static/merged-dynamic GPU capture or a new plural
indoor image. Keep those coverage distinctions explicit when closing Phase 6; the existing
verified multi-view indoor captures remain separate evidence. No production code changed in this
audit, and the parked live player/camera were not accessed.

#### Indoor/outdoor plural dynamic GPU comparison — 2026-09-04

- Used the existing `portal-open` and `portal-plural` synthetic workloads at the previously
  inspected indoor doorway camera. They place the same actor at the same pose; the latter adds
  outdoor membership to the actor's interior membership. Real terrain, buildings, interior
  shells, authored dynamics, and particles remain present.
- The first plural run rendered successfully with an empty browser console but failed the
  harness's nameplate assertion: it expected one draw for two scoped instances. Inspection of
  `WebGL2NameplatePass` confirms that the draw-constant visibility-domain uniform splits those
  instances into two draws. Corrected the assertion to count both instances and draws by the
  expected portal scope count, using the actual captured frame mode. Flat mode still expects
  one submission. No production nameplate or dynamic rendering behavior changed.
- Successful comparison commands (both exit 0 with empty browser consoles):

  ```sh
  npm run harness:browser -- --brief --gpu --landblock 0x7d64ffff --building-radius 1 --env-cell-radius 1 --explicit-object-radius 1 --generated-object-radius 1 --env-cell-camera 0x7d640113 --env-cell-position 24078.5,13.7,-19328.25 --camera-yaw 0 --camera-pitch 0 --frame-mode portal --nameplate-workload portal-open --screenshot /tmp/holtburger-dynamic-single-domain.png --measure-ms 0
  npm run harness:browser -- --brief --gpu --landblock 0x7d64ffff --building-radius 1 --env-cell-radius 1 --explicit-object-radius 1 --generated-object-radius 1 --env-cell-camera 0x7d640113 --env-cell-position 24078.5,13.7,-19328.25 --camera-yaw 0 --camera-pitch 0 --frame-mode portal --nameplate-workload portal-plural --screenshot /tmp/holtburger-dynamic-plural-domain-verified.png --measure-ms 0
  ```

  Both report portal mode, four visible dynamic roots, 177 static draws, and 320 uploaded pose
  bytes. Interior-only membership submits five dynamic draws; plural membership submits six.
  Nameplate draws/instances increase from 1/1 to 2/2. This isolates one extra dynamic domain
  submission without duplicating pose uploads. Inspected screenshots retain the room, doorway,
  red synthetic actor, and torch, with scope-clipped nameplate coverage.
- `npm run lint:ts`, `npm run lint:dead`, and `git diff --check` pass. This turn changes only the
  harness assertion and documentation; the earlier 566-test renderer run remains separate evidence.

This is real-GPU evidence for opaque dynamic geometry in an interior/outdoor plural membership.
It does not establish plural transparent/additive pixels or generated-static instance barriers on
the GPU; those remain explicit validation gaps rather than being inferred from this draw delta.
No performance claim is made. The parked live player and camera were untouched.

#### STOP: plural deferred geometry blends twice in overlapping domains — 2026-09-04

Superseded stop decision: the pre-cutover GPU comparison below proves the same alpha-overlap
defect existed before this refactor. Preserve existing behavior and track this as separate debt;
do not expand the cutover into a portal visibility redesign.

Added harness-only `--probe-dynamic-domains` and `dynamic-domain-probe.ts`. The probe keeps the
synthetic actor's position/orientation fixed while comparing interior-only, outdoor-only, and
plural membership for alpha, inverse-alpha, and additive materials. It requires one draw per
single-domain control, two plural draws, unchanged pose-upload bytes, and plural pixels matching
one of the single-domain controls. The opaque emissive reference identifies covered actor pixels.
The actor and frame settings are restored in `finally`.

Two fixture errors were corrected before reaching the material assertion:

- Ambient occlusion darkened the opaque reference but not the deferred colors, leaving only 28
  exact source-color pixels. Disabling AO for this controlled probe passes the original minimum
  100-pixel coverage requirement; fog and color grading are also disabled.
- Outdoor-only membership initially omitted the still-declared interior resident scope. The
  production scene invariant correctly rejected it. The outdoor control now uses an outdoor
  resident cell in the same landblock, preserving coordinates and orientation. No production
  membership rule was weakened.

Reproduction (exit 1; the probe fails at its first alpha-material comparison):

```sh
npm run harness:browser -- --brief --gpu --landblock 0x7d64ffff --building-radius 1 --env-cell-radius 1 --explicit-object-radius 1 --generated-object-radius 1 --env-cell-camera 0x7d640113 --env-cell-position 24078.5,13.7,-19328.25 --camera-yaw 0 --camera-pitch 0 --frame-mode portal --nameplate-workload portal-plural --probe-dynamic-domains --screenshot /tmp/holtburger-dynamic-domain-blending.png --measure-ms 0
```

The same pixel mismatch reproduced in two consecutive runs. At linear pixel index 437321
(x=841, y=341 at width 1280), flags `0x100` produce:

| Capture | RGB |
| --- | --- |
| Hidden background | [95,80,54] |
| Interior-only | [84,85,79] |
| Outdoor-only | [84,85,79] |
| Plural | [76,89,97] |

Source RGB is [51,102,153] with alpha 0.25. Blending it once over the background yields the
single-domain colors. Blending it again over that result yields the plural colors within one-byte
buffer rounding. The draw/pose assertions pass before this pixel failure. This is overlapping
admission of the same physical fragment, not an extra pose upload or an omitted scope.

`portal-deferred-visibility-glsl.ts::portalDeferredFragmentVisible` checks only the current
domain's envelope; it does not arbitrate admission across an entity's other selected domains.
`WebGL2PortalScopeAtlasPipeline.routeDeferredSubmission` binds a single domain uniform per draw.
The HEAD renderer also loops over selected dynamic render scopes and routes deferred draws this
way, which indicates an inherited contract risk; no matched pre-cutover GPU reproduction has been
run, so regression provenance is not yet proven.

**Decision required before continuing:** expand this effort to resolve shared plural-fragment
ownership/union visibility, or explicitly defer that defect and revise the visual acceptance gate.
The recommended direction is to fix the shared contract so a physical transparent/additive
fragment contributes once across its admitted domain union. Picking one scope globally or hiding
one duplicate draw is not an acceptable fix because it can lose legitimately visible geometry.
This requires a design review before changing the compositor or draw metadata; no such production
change has been made. Inverse-alpha/additive checks remain unexecuted beyond the first alpha
failure, and no successful screenshots from this failing probe are claimed.

Type checks, lint, dead-code checks, and all 566 renderer tests passed during probe development;
the subsequent diagnostic change only expanded the error's pixel details. The failing GPU gate
takes precedence over those checks. Harness help now distinguishes the material, view, appearance,
and domain probes. Implementation is paused per the user's stop condition. Phase 7 performance
comparisons and Phase 8 cleanup have not been started to bypass this gap. The parked live player
and camera were untouched.

#### Pre-cutover regression control and scope correction — 2026-09-04

Following user feedback, the acceptance criterion is preservation of existing renderer behavior,
not perfection of unrelated systems. A newly observed defect does not become a cutover blocker
without checking whether this refactor introduced it.

- Extracted the frontend at HEAD commit `10e0cb00` into
  `/tmp/holtburger-precutover-iYWvYj/apps/holtburger-3d`. Its production renderer, shaders, scene,
  and runtime remain the archived versions. Only diagnostic harness code was adapted: the
  current CLI, synthetic visual source, and domain probe; one browser-global entry point; and
  direct launch of the existing content-host binary. Dependencies are shared through a local
  `node_modules` symlink. No working renderer file or parked-client state was replaced.
- The old runtime rejects same-generation appearance mutation. The control therefore removes
  and reinstalls the synthetic actor for each capture and restoration, preserving its pose.
  Pose-byte comparison is omitted because that diagnostic does not exist in the old renderer;
  this run proves pixel behavior and draw routing, not memory parity. An initial restoration
  error masked the probe failure; correcting that lifecycle handling exposed the actual result.
- Ran the same doorway/material probe against the old production renderer. The isolated host
  initially could not bind under the sandbox; the permitted local-port/GPU retry completed and
  exited 1 at the same pixel assertion as the candidate:

  ```sh
  HOLTBURGER_DATS=/home/cluracan/code/holtburger/.worktrees/claude/dats npm run harness:browser -- --brief --gpu --landblock 0x7d64ffff --building-radius 1 --env-cell-radius 1 --explicit-object-radius 1 --generated-object-radius 1 --env-cell-camera 0x7d640113 --env-cell-position 24078.5,13.7,-19328.25 --camera-yaw 0 --camera-pitch 0 --frame-mode portal --nameplate-workload portal-plural --probe-dynamic-domains --screenshot /tmp/holtburger-precutover-domain-blending.png --measure-ms 0
  ```

  Run directory is the isolated frontend above. At pixel 437321, flags 256, the old renderer
  reports interior=[84,85,79], outdoor=[84,85,79], plural=[76,89,97], background=[95,80,54]:
  **identical to the candidate in every channel**. This confirms the reproduced alpha overlap
  defect predates the cutover. It is not a claim about unexecuted inverse-alpha/additive cases.
- Source corroboration: HEAD submits each dynamic range through each selected domain using
  instanced draws; the candidate does so with merged ordinary draws. The per-domain deferred
  visibility shader is unchanged. The common overlap behavior is therefore consistent with
  both source structure and the matched GPU readback.

Decision: do not fix shared portal overlap in this effort, do not weaken visibility by dropping
one scope, and do not add a rendering fallback. Keep the failing domain probe as an explicit
known-defect diagnostic, outside the required cutover regression suite. Its earlier general
"union must blend once" assertion was an expanded correctness goal, not evidence of a regression.
Retain the isolated control directory for the upcoming comparison work; no temporary files were
deleted. Remaining validation should target changed contracts and actual regression risks rather
than multiplying idealized fixtures. Resume the planned steady-state comparison and cleanup work.

- [x] Separate per-view color/portal, shadow-caster, and selection preparation from dynamic draw
  execution. Retain coherent per-view plans, gather selected dynamic roots once, and upload packed
  pose pages before any dynamic draw. Do not retain mutable scratch from a previous view or broaden
  the upload population to all resident entities to bypass this scheduling requirement.

- [x] Bind the entity pose/material data and submit merged opaque/alpha-test ranges with
  `drawElements`. Keep landblock-relative placement and frame-derived anchor offsets explicit.
- [x] Route one entity to each selected portal visibility domain. Preserve scope-specific lighting,
  clipping, depth, and existing outdoor/interior rules.
- [x] Submit dynamic transparent/additive residue with ordinary indexed draws in its required
  order, including part fades, cloaking, and fully hidden parts. No dynamic mesh instancing remains
  necessary for correctness or performance fallback.
- [x] Integrate the dynamic selection-mask consumer with merged ordinary draws and shared poses.
  Preserve material-free eligibility, face culling, fully hidden parts, and sphere-proxy behavior.
- [x] Integrate dynamic depth/shadow consumers. Preserve their pass-specific geometry eligibility,
  culling, and opacity rules rather than assuming all passes use color or selection-mask data.
- [x] Keep CPU picking/interaction geometry and part-frame targets consistent with the active layout.
  Avoid duplicating animation evaluation or downloading poses from the GPU.
- [x] Verify screenshots and controlled fixtures for ordinary rendering, alpha-test holes, part
  effects, transparent ordering, indoor/outdoor routing, shadows, and selected animated entities.

Acceptance: all applicable dynamic consumers use the same installed layout/pose generation, the
full scene renders without missing geometry or GL errors, and ordinary draws handle dynamic meshes
through every supported pass. Particle/static instancing remains functional.

### Implementation Phase 7: Review Performance and Complete the Cutover

#### Measurement setup correction and transition regression — 2026-09-04

- The initial live candidate/control captures (`/tmp/holtburger-cutover-candidate-1.*`
  and `/tmp/holtburger-cutover-control-1.*`) used the main checkout's `.dev.env`,
  selecting +Holtmage. The user intended this worktree's
  `apps/holtburger-3d/.dev.env`; its account differs. **Exclude those captures from
  parked-scene performance acceptance.** Restart comparisons using the worktree
  configuration and record the selected character in each report. Do not send
  movement or camera input. Credentials must remain unprinted.
- The first live world-entry attempt found an actual cutover regression: removing
  implicit original-part GPU leases left the retained portal-loading tunnel without
  its buffers (`gfx-obj/0100080b`). `installPortalTransitionAssets` now explicitly
  retains original-part geometry under the transition resource owner and drops it
  on installation failure. Dynamic templates still lease only merged geometry;
  the transition's independent ordinary per-part consumer is not dead architecture.
  World entry then succeeded. Runtime/geometry tests passed (47 tests), along with
  type, TypeScript lint, and dead-code checks.
- The broader portal-transition lifecycle harness did not reach its lifecycle
  assertions: its startup compositor fixture failed with "Portal exit destination
  contribution did not increase at sample 4." This is not a passed gate or a proven
  pre-existing failure. It does not justify expanding this effort into another
  portal redesign; actual entry exercised the repaired missing-buffer path.
- Corrected captures identify **+Holtfighter, slot 1, GUID 1342177281**, using
  the worktree account. The first candidate and control screenshots both show the
  rooftop framing, surrounding buildings, and trees; both report 630 static draws,
  241,076 static triangles, 45 selected portal scopes, a 1441×903 drawing buffer
  at render scale 1, and outdoor player/camera residency `0xc6a9ffff`.
  The control frontend is archived `10e0cb00` with matching diagnostic-only client
  hooks and the same release host binary. No movement/camera commands were sent.
  Current hardware was rechecked: Ryzen 9 5900X and AMD Navi 31 (PCI 1002:744c).
  Unchanged client interest radii: buildings/terrain 6, EnvCells/explicit objects 1,
  generated objects 2. These are live-world comparisons, not frozen animation or
  particle replays; record population and particle variation alongside timings.
- The first two corrected candidate windows measured 5.970/5.975 ms callback work;
  controls measured 10.908/11.235 ms. Reports, profiles, and screenshots use
  `/tmp/holtburger-worktree-{candidate,control}-{1,2}.*`. Control 2's first attempt
  exited while still in portal space without producing a destination frame or a
  timing sample; a terminal-process retry with a 90-second readiness allowance
  succeeded without browser errors. Settling and measurement remain 10 seconds
  each. This is not a streaming-performance result. Repeated-set conclusions,
  clocks-off capacity, and complete memory accounting remain pending.

#### Correct-account repeated instrumented comparison — 2026-09-04

Three successful ten-second windows per renderer are now retained as
`/tmp/holtburger-worktree-{candidate,control}-{1,2,3}.{json,cpuprofile,png}`.
All six screenshots were inspected: rooftop framing, buildings, and trees remain
present. All six reports have no browser errors/exceptions and retain camera
generation 1. Candidate 3 also had one pre-entry timeout (including no initial
camera state); a separate terminal-process retry succeeded. The same entry
symptom occurred on both renderers. Its cause is not established, and failed
attempts contribute no performance samples.

| Measurement | Old renderer median (min–max) | Candidate median (min–max) |
| --- | ---: | ---: |
| Callback work, ms | 10.908 (10.496–11.235) | 5.970 (5.840–5.975) |
| Whole-window FPS | 86.55 (84.33–89.82) | 143.23 (142.67–143.34) |
| Renderer CPU, ms | 7.561 (7.298–7.759) | 4.000 (3.842–4.005) |
| Summed measured GPU phases, ms | 1.378 (1.366–1.401) | 0.985 (0.978–1.015) |
| Runtime publication sample mean, ms | 2.723 (2.547–2.888) | 1.493 (1.408–1.528) |
| Opaque submission, ms | 3.090 (2.950–3.112) | 0.784 (0.757–0.786) |
| Instance-run preparation, ms | 0.603 (0.532–0.663) | 0.149 (0.095–0.155) |
| Scene-contribution resolution, ms | 1.723 (1.662–1.758) | 1.313 (1.275–1.317) |
| Dynamic draw count, final frame | 1,951 | 164 (160–164) |

The callback-work median is about 45% lower. Whole-window throughput improves,
but is not 200 FPS; callback work still exceeds 5 ms by approximately 0.97 ms
with instrumentation enabled. GPU phases overlap neither each other nor form
a complete wall-frame measurement; do not add GPU sums or nested CPU buckets
to callback work. Tick publication is the runtime profiler's retained sample
mean, not necessarily the exact whole-window average.

Final-frame workload checks: each capture has 630 static draws and 241,076
static triangles. Candidate reports 142 visible dynamic roots/2,103 source
ranges, versus 143/2,108 for controls. That small but systematic discrepancy
needs an identity/metric-semantics check before claiming complete dynamic
population parity; screenshots alone cannot prove every dynamic part is
present. Particle instances vary from 1,937–1,945 candidate and 1,915–1,929
control, with 260 batches in each. No particle speedup is claimed.

Candidate final-frame instance uploads are 56,880 bytes, plus 78,480 bytes of
packed poses, versus 239,440 instance bytes in the first control. Candidate
pose capacity is 1,310,720 bytes, appearance indices 552,780 bytes, and material
tables 162,080 bytes in each capture. These are partial resource accounts;
shared geometry and retained CPU layout/pose capacity still need comparison.

First-pair V8 self-time corroboration, normalized per rendered frame:
`transformAABB3` decreases from 1.118 to 0.209 ms and `drawObjectRange` from
0.620 to 0.184 ms. Old instance attribute setup is prominent in the control
profile. Remaining candidate owners include scene-contribution resolution,
pose/publication matrix work, and ordinary static/dynamic submission. This
supports the structural improvement, not an invitation to expand the cutover
into optimizing every residual owner. Clocks-off capacity, memory comparison,
the small dynamic workload discrepancy, and Phase 8 cleanup remain open.

#### Clocks-off capacity, population audit, and resident memory — 2026-09-04

The first clocks-off pair is retained at
`/tmp/holtburger-worktree-{candidate,control}-off-1.{json,png}`. Both select
+Holtfighter from this worktree's account, preserve the rooftop framing, and
report no browser errors. Both screenshots were inspected. Callback work is
5.526 ms candidate versus 10.312 ms control; whole-window throughput is
142.91 versus 91.81 FPS. These are one pair, not clocks-off medians. No 200 FPS
claim follows: candidate callback work still exceeds 5 ms by 0.526 ms, and
measured throughput remains below 200 FPS. Renderer and tick profilers and V8
sampling are disabled; the basic callback-duration/FPS sampler remains active.

Population discrepancy resolution: all ten snapshots in **both** windows report
142 dynamic entities and 2,103 source ranges. A temporary post-window capture
then records 143/2,108 in **both** renderers, with 70 named entities each.
Named identities and range counts match after accounting for the player's new
login incarnation. The five-range entity is Unarmed Combat Mastery,
`0x7c6a9061`, present in both captures. Thus the earlier count difference does
not establish a permanently missing cutover entity; both implementations
produce both populations. The exact time-dependent selection cause was not
traced further. This is sufficient regression triage, not a claim that every
unnamed entity or animation frame was individually compared. The temporary
renderer/global audit hooks were removed after capture; reports retain the
evidence. No visibility rule or rendering fallback was changed.

Measured resident GPU payloads and uploads (bytes, first clocks-off pair):

| Resource | Old renderer | Candidate |
| --- | ---: | ---: |
| Shared geometry GPU payload | 70,568,412 | 73,532,469 |
| Geometry resource count | 1,353 | 1,150 |
| Dynamic appearance indices | — | 552,780 |
| Dynamic material tables | — | 162,080 |
| Packed pose page capacity | — | 1,310,720 |
| Frame instance buffer capacity (80 bytes/record) | 327,680 | 81,920 |
| Counted geometry/appearance/pose/instance GPU total | 70,896,092 | 75,639,969 |
| Frame instance uploads | 239,040 | 56,880 |
| Packed pose uploads | — | 78,480 |
| Combined instance/pose upload payload | 239,040 | 135,360 |
| Texture atlas pages | 108,789,760 | 108,789,760 |
| Retained source texture bytes | 48,899,808 | 48,899,808 |

**Superseded GPU comparison:** final audit found that the old control retained the
pre-fix terrain/portal byte counter. The old shared-geometry and counted-total
entries above undercount payloads; do not use their difference as the cutover's
GPU memory cost. The control's diagnostic-only byte summation is now normalized
to the candidate's buffer coverage, without changing its renderer or uploads.
The earlier reported **4,743,877-byte (4.52 MiB) increase is withdrawn** pending
that corrected control. CPU template/pose/instance measurements are unaffected.

The pair reports 103,680 fewer
instance/pose upload bytes per frame (43.4%). This is a concrete memory-for-
submission tradeoff, not a total browser/driver-memory measurement. Geometry
manager totals exclude dynamic appearance indices, which are included exactly
once above. Resource totals are unchanged across all ten sampled snapshots in
each window. Existing targets, particles, textures, and other unrelated buffers
are not folded into a misleading "entire renderer" total.

CPU pose staging mirrors the 1,310,720-byte pose capacity; frame-instance CPU
staging shrinks by 245,760 bytes alongside the GPU buffer. Actual retained CPU
template geometry now has cold, buffer-identity-deduplicated accounting in the
template repository, surfaced through existing runtime resource diagnostics and
the client profile. This counts original picking geometry and merged layout
buffers, including distinct backing allocations for appearances sharing the
same logical layout key. It does not estimate JavaScript object/map overhead.
The earlier layout census's 5,456,352 merged bytes counts one compilation per
layout key, so it is not sufficient proof of actual CPU retention. The follow-up
pair captures the new retained-allocation measurement before Phase 7 closure.

Follow-up candidate `/tmp/holtburger-worktree-candidate-off-2.{json,png}`
measures 5.605 ms callback work with 10,423,968 bytes of retained CPU template
geometry; all sampled resource totals remain flat. This includes actual ready
template allocations, not the logical-layout census estimate. The paired old
renderer exited at initial world-entry timeout and produced no sample.

The user identified rapid reconnects as a likely source of server confusion.
That cause is plausible but not proven; the failure precedes initial player and
camera state and has occurred on both renderers. **Stop back-to-back login
launches.** Collect repeated windows inside one logged-in session where possible,
and allow time between sessions when switching renderer versions. Do not restart
the server, change the account/character, or move the parked scene to bypass
entry failures. The final failed control was allowed to terminate and was not
immediately retried. Its missing CPU-memory comparison remains explicit.

Validation for the cold resource-accounting additions: `npm run check` passed;
template/runtime tests passed (60 tests). The client diagnostics field and HUD
fixture also passed TypeScript/dead-code lint and client-session tests (24 tests)
before the repository byte counter was added. No tests were added for the
temporary population logging, and its production hooks are removed.
After the repository byte counter and runtime snapshot reuse were finalized,
`npm run lint:ts`, `npm run lint:dead`, `npm run check`, and `git diff --check`
all passed. No browser probe remains running.

#### Memory control completed; cleanup entry — 2026-09-04

After spacing the next login, `/tmp/holtburger-worktree-control-off-2.{json,png}`
completed without browser errors. Actual CPU template geometry is 4,798,656 bytes
old versus 10,423,968 candidate: +5,625,312 bytes (5.36 MiB). Combined with the
known pose/instance staging delta of +1,064,960 bytes, these measured CPU backing
stores increase by 6,690,272 bytes (6.38 MiB). This excludes JavaScript record/map
overhead and separately owned appearance compilation arrays; it is not a heap
or process RSS claim. The geometry measurement includes original picking meshes,
merged layouts, and the retained transition visual, deduplicated by backing
buffer identity. No runaway capacity growth appeared in the settled snapshots.

The old control's viewport was 1442×904 rather than 1441×903 and daylight had
advanced. Its screenshot retains the same rooftop scene and geometry counts,
but **do not add its timing to the matched performance series**. Persistent
geometry and texture totals match the prior control exactly, so it supplies the
missing CPU geometry comparison independently from viewport-dependent targets.
The run is terminal; no immediate second login was launched.

Decision: the repeated callback/submission improvement justifies the measured
resident-memory tradeoff. No further rendering strategy or micro-optimization is
added. Phase 8 begins by deleting the obsolete singleton experiment and its
API/metric/caller vocabulary. Final-tree GPU verification remains required after
cleanup; historical measurements are not automatically final-tree validation.

- [x] Capture at least three settled candidate windows and comparable controls on the parked scene;
  report medians/spread, scene workload, resolution, render settings, and hardware. Include an
  instrumentation-off capacity check and inspect complete-scene screenshots.
- [x] Compare total callback work, dynamic publication, renderer submission, GPU phases, geometry
  memory, and upload bytes. Keep overlapping CPU spans and unrelated particle variation separate.
- [x] Check cold appearance replacement and eviction correctness with synthetic races, including
  part-attached emitters and held children. Do not turn those checks into a streaming timing claim.
- [x] Review any remaining stalls, unexpected memory growth, or shader cost before declaring the
  replacement successful. Revisit the responsible contract if the expected benefit is absent.
- [x] Record achieved frame time and the remaining gap to 5 ms. If 200 FPS is not reached, identify
  measured residual owners without claiming this cutover alone guarantees the full target.

Acceptance: visual correctness and resource lifetime hold, repeated measurements establish the
actual steady-state effect, and remaining limitations are explicit. Performance comparisons alone
cannot rehabilitate a run missing buildings, trees, dynamic parts, or auxiliary-pass geometry.

### Implementation Phase 8: Remove Superseded Machinery and Verify the Final Tree

#### Submission-strategy cleanup — 2026-09-04

- Removed the dynamic singleton-mode setting, public renderer/runtime/client methods, probe
  environment switch, uniform-draw counter, and dead singleton conversion branch.
- Removed the dynamic draw-reduction census, its whole-frame waiter/collector, counterfactual
  equivalence helpers, installed-layout census wrapper, and unused draw-unit provenance fields.
  Deleted the temporary `dynamic-layout-census.ts` and `dynamic-submission-capability-probe.mjs`
  files after retaining their evidence in this document and prior reports. The isolated control
  directory remains intact. General CPU/GPU profiling and the baked-static merge census remain.
- Removed the always-zero dynamic-instance counter, UI label, mock fields, and obsolete opacity
  probe assertion. Actual opacity routing/pixel-restoration assertions remain. Narrowed the
  ordinary static/transition input source type so it cannot carry dynamic entity meshes; shared
  lighting explicitly accepts both ordinary and merged sources. Removed unused per-draw template
  provenance fields. Portal transition still owns and uses original per-part geometry.
- Renamed the range counter to `visibleDynamicSourceRangeCount`, and the client presentation field
  to `visibleDynamicSourceRanges`; updated both UI labels and browser report paths. Its source-range
  counting semantics are unchanged. Earlier document tables and saved JSON retain historical names
  for interpretation; they do not describe a remaining runtime API.
- Type/lint/dead-code checks passed after cleanup, as did 676 tests across 87 files covering the
  renderer, dynamic system, template repository, runtime, and client session. The final vocabulary
  sweep finds no removed singleton/census/instance-counter names in app source or scripts.
- Real-GPU synthetic appearance/opacity verification exited 0 using
  `npm run harness:browser -- --brief --gpu --nameplate-workload occlusion-open --probe-dynamic-appearance --screenshot /tmp/holtburger-cleanup-opacity.png --measure-ms 0 --camera-position 42087,37.9,-16638.4 --camera-yaw 0 --camera-pitch 0`.
  Before/after images were inspected: the replacement changes geometry width and material while
  preserving placement. The probe verifies opaque → half-transparent → hidden → opaque routing,
  pixel changes, and exact restoration. This synthetic camera is not the parked client camera.
  Chrome printed unrelated registration/zygote shutdown messages; the harness completed normally.

Remaining cleanup acceptance: review the complete diff/abstraction growth and final architecture
description, then verify the full parked scene after the deletion sweep. No rapid reconnect loop
is authorized by this remaining gate. The goal is not marked complete by the synthetic probe alone.

- [x] Delete old dynamic range-instance expansion, dynamic run grouping, diagnostic singleton mode,
  and dynamic-only shader/input variants once the new path is validated. Remove their callers,
  metrics, labels, mocks, and obsolete tests in the same change.
- [x] Preserve shared instance buffers, shaders, and run helpers that still serve particles,
  statics, sky, or portal-transition visuals; verify consumers before deleting shared code.
- [x] Remove temporary dual-resource/comparison wiring and the multi-draw capability probe when its
  evidence is captured here. Follow the user's retained-diagnostics policy for the general profiling
  tools; do not delete unrelated investigation files or user work.
- [x] Correct `visibleDynamicPartCount` vocabulary to reflect its actual final consumer contract;
  do not silently change a range metric into a part metric. Keep only metrics with named uses.
- [x] Audit line-count and abstraction growth, unused ownership adapters, and duplicate derivation.
  Update current architecture descriptions while preserving historical measurement interpretation.
- [x] Run `npm run check`, `npm run lint:ts`, `npm run lint:dead`, focused tests through
  `npm run test:ts -- ...`, and real-GPU verification appropriate to the final changes. If Rust
  changed, run the affected crate tests and clippy with warnings treated as errors.
- [x] Run `git diff --check` and inspect the final diff. Do not stage or commit without a request.

Acceptance: one dynamic mesh submission strategy remains, all required checks pass, and shared
non-dynamic strategies remain intact. No legacy dynamic architecture is retained solely by tests.

#### Final acceptance audit and corrected memory comparison — 2026-09-04

Final candidate artifacts are `/tmp/holtburger-final-cutover.{json,png}`. The
cleaned-up renderer entered the world, settled, and completed a 10.065-second
clocks-off window: 1,440 frames, 5.611 ms callback work, 164 dynamic draws,
142 visible dynamic roots, and 2,097 source ranges. The screenshot was inspected
in daylight: +Holtfighter remains on the rooftop, with the surrounding buildings,
trees, terrain, and particle effects present. Static work remains 630 draws and
241,076 triangles. The viewport is 1442×904 at scale 1; camera generation is 1,
player/camera residency is `0xc6a9ffff`, and no browser errors occurred. This is
final-tree preservation evidence, not another member of the earlier matched
instrumented series. No player/camera input was sent.

The corrected old-renderer memory control is
`/tmp/holtburger-control-normalized-memory.{json,png}`. Only its diagnostic
geometry byte summation was corrected to include indices and terrain attributes;
its production renderer and resource uploads remain the pre-cutover code. The
run completed after a spaced-out login, with 142 roots/2,097 source ranges,
matching static geometry counts and texture totals, no browser errors, and flat
resident-resource totals across the ten snapshots. The control uses 1441×903;
compare viewport-independent resource payloads here, not target bytes or timing.

| Final resident payload, bytes | Normalized old renderer | Candidate |
| --- | ---: | ---: |
| Geometry GPU buffers | 70,881,273 | 73,751,469 |
| Dynamic appearance indices | — | 574,464 |
| Dynamic material tables | — | 161,600 |
| Pose pages | — | 1,310,720 |
| Frame instance buffer | 327,680 | 81,920 |
| Counted GPU total | 71,208,953 | 75,880,173 |
| Retained CPU template geometry | 5,005,152 | 10,870,932 |
| Texture atlas pages | 108,789,760 | 108,789,760 |
| Retained source textures | 48,120,784 | 48,120,784 |

**The corrected GPU increase is 4,671,220 bytes (4.45 MiB).** This replaces the
earlier invalid 4.52 MiB comparison. CPU geometry increases by 5,865,780 bytes;
adding the known pose/instance staging difference gives 6,930,740 bytes (6.61 MiB)
for those CPU backing stores. These final populations have different appearance
payloads from the earlier captures, so the earlier CPU numbers remain historical,
not exact final-population totals. Neither ledger estimates JavaScript object/map
overhead, driver allocations, or total process memory. Final candidate and
normalized control resource snapshots are stable throughout their windows.

Requirement-to-evidence audit:

| Requirement | Final implementation and verification |
| --- | --- |
| One dynamic submission strategy | `webgl2-renderer.ts` ordinary dynamic color draws, `webgl2-entity-selection-pass.ts`, and `webgl2-outdoor-pssm-pass.ts` all consume merged geometry and shared poses; the non-dynamic input union excludes dynamic meshes. Removed API/metric/multi-draw vocabulary sweep is empty. |
| Geometry/material ownership and atlas changes | `GeometryManager` shares keyed vertices; template ownership stages and releases appearance resources. `webgl2-dynamic-appearances.test.ts` verifies atlas-coordinate rebuilds, atomic rebuild failure, last-owner release, and empty/shutdown handling. |
| Appearance races and continuity | Runtime tests cover A→B→A, reversed completions, deletion/withdrawn residency, tick-delivered changes, and truthful installation receipts. Dynamic-system tests cover stable part targets, held descendants, current pose, opacity, scale, and bounds. Final GPU appearance/opacity probe passes. |
| Pose/bounds publication | Entity-owned bounds outputs and `updateLocalTransformWithChildren` replace redundant synchronization. Tests cover output aliasing, projective bounds, coherent descendants, and invalid-batch atomicity. Repeated callback/publication measurements corroborate the benefit. |
| Every draw consumer and view | Color, alpha-test, ordered blending, auxiliary selection/shadow, CPU picking, and flat/portal multi-view evidence are recorded in Phase 6. Final full-scene and synthetic appearance GPU checks pass; 2,040 tests include those consumer contracts. Portal overlap preserves the independently reproduced old behavior. |
| Streaming/landblock constraints | No global arena or retained camera-relative pose coordinates; cold replacement guards current request, incarnation, parent, and residency. Synthetic lifecycle tests cover eviction/appearance without moving the parked character. No streaming-speed claim is made. |
| Measured result | Three matched instrumented windows per renderer, a clocks-off pair, final scene verification, normalized memory accounting, and explicit remaining gap to 5 ms. No 200 FPS claim. |

Final checks: `npm run test:ts` passes **2,040 tests across 269 files**;
`npm run check`, `npm run lint:ts`, `npm run lint:dead`, and `git diff --check`
pass. No tracked Rust files changed; the unrelated untracked
`crates/holtburger-core/src/physics_script_controller.rs` is untouched. No stage
or commit was created, and all launched browser probes are terminal.

Size/ownership review, including new files and counting text lines rather than
executable SLOC: production +3,560/−1,669 (net +1,891); tests +2,937/−823;
harness/fixtures/scripts +2,426/−96; README/config +16. The plan document is
excluded. The additional production code supplies the merged compiler, physical
appearance/index ownership, shared pose shaders/pages, and retained multi-view
preparation; it does not preserve a second dynamic renderer. Static-material
preparation is shared, depth eligibility is computed once per root, and cold
CPU layout sharing reuses ready templates without a wardrobe-history cache.
The durable renderer/ownership description is updated in the app README.

Remaining debt is explicit and outside this cutover: the reproduced portal
overlap defect; the broader compositor fixture that failed before reaching its
lifecycle assertions; server/probe reconnect behavior; streaming performance;
and the measured CPU work still separating this scene from 200 FPS. None is
silently claimed fixed or replaced by an easier acceptance target. Multi-draw
remains deferred. Phases 1–8 and the agreed first-cut implementation are complete.

### Implementation Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Material table cannot span actual texture resources cheaply | Resolve page/encoding access in Phase 1; count residual batches honestly |
| Merging duplicates shared parts across geometry combinations | Measure unique layouts and resident bytes; share geometry independently of appearance materials |
| Part fades or ordering force more draws than the census | Keep explicit part/range eligibility and ordered residue; validate representative effects |
| Appearance swap restarts behavior or strands an emitter target | Replace visual bindings separately from entity/part target lifetime; test active attachments and effects |
| Stale preparation commits after another update or eviction | Guard by current request identity and incarnation; release stages on every terminal path |
| Spatial consolidation leaves attached descendants stale | Publish a coherent pose before synchronization and verify reads at the publication boundary |
| New compile/upload work causes residency stalls | Preserve staged ownership and preparer boundary; record the risk for separate streaming measurements |
| Fewer draws increase vertex work or uploads | Compare GPU time, pose/material bytes, and whole callback cost alongside draw count |

### Implementation Definition of Done

- [x] Dynamic meshes use merged layouts, pose/material data, and ordinary indexed draws; neither
  multi-draw nor dynamic mesh instancing is required or selected by a capability branch.
- [x] Same-generation appearance updates succeed with current-request commit guards and continuity
  of animation, placement, held entities, and particle frame targets.
- [x] Layout/material resource separation preserves atlas relocation and independent owner eviction.
- [x] Pose/bounds publication removes the investigated redundant work without stale spatial state.
- [x] Main, transparent, shadow/depth, selection, and interaction consumers are correct.
- [x] Repeated full-scene measurements document steady-state improvement, memory/upload tradeoffs,
  and any remaining distance from the 200 FPS objective.
- [x] Superseded dynamic machinery is removed and required validation passes on the final tree.

### Implementation Open Questions

- Phase 1 resolves the pose/material storage format, texture page binding scheme, unavoidable draw
  partitions, and whether layout identity needs additional geometry-affecting facts.
- Phase 3 resolves incompatible setup changes separately from ordinary part appearance mutation.
- Multi-draw is explicitly deferred; no capability portability choice is needed for this cut.
- Streaming performance remains a separate effort. No further user choice is currently required
  to begin this plan when implementation is requested.

## Agreed Implementation Sequence — First Cut Without Multi-Draw

This append summarizes the implementation plan above; it does not reset its progress checklists
or claim additional implementation or validation. The scope of this request is documentation only.

### Target Architecture

Use one dynamic mesh submission strategy: reusable merged geometry layouts, per-part pose data,
replaceable material bindings, and ordinary indexed draws. Remove dynamic mesh instancing at the
completed cutover, including its transparent variant. Retain instancing where other domains still
use it. Multi-draw is deferred entirely: no extension detection, alternate submission branch, or
speculative abstraction for it in this first cut.

Merging storage does not erase part identity or guarantee one draw per entity. Parts remain
addressable for animation, appearance changes, held objects, particle frames, and picking. Actual
texture bindings, render state, visibility domains, and transparent ordering determine residual
draw partitions. Geometry layout identity is independent of placement and replaceable appearance
bindings; material-only changes must not automatically rebuild geometry.

### Phases and Gates

| Phase | Deliverable | Gate before proceeding |
| --- | --- | --- |
| 1. Establish the contract | Census effective layouts, material partitions, memory, and pose/material storage; exercise ordinary draws in a focused GPU prototype | Correct pixels and concrete device/storage limits; no draw-count-only justification |
| 2. Review and refine | Reassess the representation using that evidence and dry-run integration through all consumers | Resolve structural gaps before expanding production integration |
| 3. Fix appearance replacement | Accept same-generation changes through shared reconciliation; stage resources and reject stale completions | Palette, texture, and geometry changes; reversed completions, A→B→A, failure, eviction, and attachment/animation continuity verified |
| 4. Consolidate pose and bounds publication | Reuse transform/bounds storage and synchronize affected spatial descendants after coherent publication | No stale held-object, selection, visibility, or particle bounds; publication cost measured separately |
| 5. Compile and own merged layouts | Separate shared geometry layouts from replaceable materials; publish compact entity render records | Correct sharing, atlas invalidation, staged replacement, and last-owner release |
| 6. Cut over dynamic consumers | Integrate ordinary draws across color, transparency, depth/shadow, and selection; retain coherent CPU picking | Complete geometry and effects in real-GPU fixtures; all consumers use the same committed appearance and pose |
| 7. Review steady-state results | Compare at least three settled, matched windows and instrumentation-off controls | Inspect complete-scene screenshots; report CPU/GPU time, resident bytes, uploads, and remaining gap to 5 ms |
| 8. Clean up and validate | Delete superseded dynamic paths, temporary comparison wiring, obsolete vocabulary, and dead tests | Type, lint, dead-code, focused tests, GPU checks, and final diff review pass; no permanent dual strategy |

The detailed tasks, source paths, risks, and acceptance criteria in the preceding implementation
section remain the execution checklist. Record decisions, concessions, and cleanup debt there as
each phase proceeds; revisit downstream tasks at the review gates rather than preserving a plan
that new evidence has invalidated.

### Constraints That Survive the Cutover

- **Steady state:** leave the parked player and camera untouched. Reject performance comparisons
  with missing buildings, trees, parts, or auxiliary-pass geometry. A lower draw count is evidence
  about submission, not proof of 200 FPS.
- **Landblocks and streaming correctness:** preserve landblock-relative placement, frame anchors,
  plural portal scopes, staged residency, shared leases, and independent eviction. Movement or
  anchor changes must not rebuild geometry. Streaming performance tuning is a separate effort.
- **Appearance lifetime:** retain the last complete eligible visual during preparation. Commit
  only the current request, preserve compatible entity/part behavior, and release abandoned work.
  Incompatible setup/topology changes need explicit staged owner replacement, not an assumed
  material-only swap.
- **Pose/bounds cleanup:** include it in this effort as Phase 4. Merged GPU geometry does not by
  itself remove CPU bound allocation or repeated spatial synchronization; those consumers remain.
- **Maintainability:** use one final dynamic representation with necessary pass partitions, not
  interchangeable rendering strategies. Stop for review if evidence requires a materially different
  architecture or a correctness concession beyond the documented contract.

Completion means a validated, cleaned-up cutover with honest steady-state results—not a promise
that this change alone reaches 200 FPS. Multi-draw can be reconsidered later only against the
measured residual submission cost of this simpler renderer.

## Pre-commit Code Quality Review — 2026-09-04

- Removed retained layout material-description records whose only production consumer needed their
  count. Dense vertex selectors and the geometry-owned material count preserve the actual contract.
- Colocated the shared prepared-surface contract with rendering policy instead of making that policy
  depend on its preparation implementation. Removed the resulting circular type dependency.
- Reused the shared shader linker for selection programs, removing duplicate construction and
  fixing the leaked vertex shader when fragment compilation fails.
- Closed the live profile's final frame-count snapshot before profiler stop/export, alongside the
  elapsed window. Earlier reports could include additional frames in that count after their duration
  stopped; their derived whole-window FPS is approximate. This correction does not constitute a new
  timing run or replace the recorded per-callback and renderer means.
- Updated stale cutover comments and added three domain-independent worksheet entries covering
  deferred scratch aliasing, incidental resource leases, and mismatched measurement windows.
- Validation: 2,040 tests across 269 files, type checks, lint, dead-code checks, formatting, and diff
  whitespace checks passed. Real-GPU selection, appearance/fade, and populated multi-view fixtures
  passed. Before/after appearance images were inspected. Artifacts use
  `/tmp/holtburger-quality-{selection,appearance,multiview}.png` and their fixture-specific suffixes.
- An initial combined appearance/multi-view invocation failed the latter's prerequisite because the
  single-object scene did not supply dynamic geometry in both directions. Separate appearance and
  documented populated multi-view invocations passed; the failed invocation is not acceptance evidence.
- No live login, parked player/camera changes, streaming-performance work, or new rendering strategy
  was introduced during this review. The unrelated untracked Rust file remains outside this commit.

## Post-cutover Steady-state Reprofile — 2026-09-05

### Capture Conditions and Evidence

- Excluded the initial three windows: the character had been moved, and those captures were at
  `0x7c63ffff`. They are not comparable evidence for the parked scene.
- After the user restored the character, captured three 10-second windows in one login, following
  a 10-second settled-world delay. Used this worktree's `apps/holtburger-3d/.dev.env` and
  +Holtfighter, slot 1, at the restored rooftop location `0xc6a9ffff`. No player or camera input
  was issued. Avoided an immediate reconnect between the two sessions.
- All three restored screenshots were inspected; buildings and trees remained visible. The
  viewport was 1441 × 903. All sampled scene snapshots retained 142 dynamic roots and 2,157
  source ranges; final counters reported 176 dynamic draws, 650 static draws, and 46 portal
  scopes without truncation.
- Artifacts: `/tmp/holtburger-reprofile-restored-20260905-{1,2,3}.json`, `.cpuprofile`, and `.png`.
  These are temporary local artifacts, not checked-in fixtures.
- CPU/GPU instrumentation and V8 sampling were enabled. No new instrumentation-off control was
  collected. Treat this as a fresh post-cutover baseline, not an exactly matched historical
  before/after comparison: static geometry counts and framing differ from earlier captures.

### Measured Work

Values below are milliseconds per frame, averaged within each capture. Renderer rows are nested
inside callback CPU time; renderer subphases are nested inside renderer CPU time. GPU time is
separate and must not be added to callback time as an estimate of frame latency.

| Measurement | Window 1 | Window 2 | Window 3 |
| --- | ---: | ---: | ---: |
| Frame callback CPU | 5.772 | 5.724 | 5.617 |
| Renderer CPU | 3.812 | 3.780 | 3.703 |
| Measured GPU work | 1.027 | 1.023 | 1.019 |
| Scene contribution resolution | 1.273 | 1.257 | 1.240 |
| Opaque submission | 0.754 | 0.760 | 0.744 |
| Portal planning | 0.348 | 0.346 | 0.345 |

The three windows agree on the remaining CPU-heavy work. Neither these instrumented callback
times nor their reciprocals establish uninstrumented throughput or attainment of 200 FPS.

### Source-grounded Attribution and Remaining Threads

1. **Reactive settings cross into the imperative renderer.** `ClientApp.svelte` owns
   `frameSettings` with deep `$state` and passes it through `untrack` to the presentation session.
   The session and runtime retain that object; `untrack` does not strip its proxies. Sampled
   Svelte proxy/signal reads account for approximately 0.3 ms/frame of self-time, predominantly
   under scene contribution resolution. This is part of the preparation cost above, not an
   additional bucket. First candidate: test a plain settings snapshot at the cold UI-to-runtime
   boundary, preserving settings updates without reactive reads in frame-hot rendering code.
2. **Animation preparation retains a costly sampling representation.**
   `animation-playback.ts::interpolateRigidTransform` extracts quaternions from both stored
   matrices on every interpolation, then reconstructs a matrix. V8 attributes approximately
   0.54 ms/frame to animation sampling, 0.45 ms to interpolation within it, and 0.35 ms of
   self-time to rotation extraction. Investigate preparing interpolation-ready rotations and
   translations once per animation asset, after auditing existing consumers and interpolation
   semantics. These nested costs are not additive or guaranteed savings.
3. **Pose/bounds/spatial publication remains relevant, but distinguish it from sampling.**
   Sampled dynamic publication costs approximately 0.90–0.92 ms/frame. The runtime profiler's
   `presentationPublish` bucket includes both animation sampling and publication; its reported
   1.38–1.46 ms values are rolling last-60-frame means, not whole-window means. The completed
   bounds-allocation/spatial cleanup did not eliminate the underlying publication work.
4. **Submission is no longer primarily a dynamic-geometry problem in this scene.** Ordinary
   static opaque drawing accounts for approximately 0.63 ms/frame of sampled inclusive time
   within opaque submission. The evidence does not prioritize another dynamic rendering
   strategy or multi-draw over the preparation and animation candidates above. Multi-draw
   remains deferred.
5. **Other threads retain their previous scope.** This browser profile does not newly attribute
   Rust host snapshot construction or collision costs. Streaming performance remains a separate
   effort; no streaming optimization conclusion follows from these stationary captures.

Recommended next evidence: a one-change comparison for the plain-settings boundary, followed
by a focused animation representation investigation. Preserve the complete scene and repeat
settled windows, including instrumentation-off controls before making throughput claims.
No optimization was implemented during this reprofile. The temporary repeated-capture loop was
removed; these findings do not themselves authorize the next implementation.

## Plain Client Frame Settings Experiment — 2026-09-05

Following user approval, changed only the client settings owner from `$state<FrameSettings>`
to `$state.raw<FrameSettings>`, with a comment documenting the plain-object handoff. The client
already replaces the complete settings object in its control handler, and `FrameSettings` fields
are readonly. No cloning adapter, frame-hot conversion, runtime strategy, or new owner was needed.
The existing cold update path and initialization-only `untrack` remain unchanged. Explorer settings
were not changed in this client-focused experiment. Svelte documents replacement-based raw state
in its [state reference](https://svelte.dev/docs/svelte/$state#$state.raw).

### Instrumentation-off Comparison

Captured three 10-second settled windows per version, one login per series, with renderer CPU/GPU
profiling, V8 sampling, and runtime tick profiling disabled. The existing callback work accumulator
and once-per-second diagnostic snapshots remained active. Used the worktree's `.dev.env`,
+Holtfighter slot 1, and the parked rooftop `0xc6a9ffff`; no player or camera input was issued.
Allowed approximately two minutes between sessions to avoid rapid reconnects.

Hardware: Ryzen 9 5900X, AMD Navi 31 GPU. Render scale 1; interest radii: buildings/terrain 6,
EnvCells/explicit objects 1, generated objects 2. All six screenshots were inspected, with buildings
and trees visible. Static counts remained 650 draws / 230,819 triangles, with 46 portal scopes
and no truncation. Dynamic counts varied from 140 to 142 visible roots and 2,155 to 2,165 source
ranges in both series. Final dynamic draws were 169–171 before and 173–175 after; texture bind
counts also differed. Weather changed during these live captures. The launch viewport differed
by one pixel per dimension: 1442 × 904 before, 1441 × 903 after. These are repeated live-scene
measurements, not a deterministic pixel-exact A/B benchmark.

| Callback CPU work (ms/frame) | Window 1 | Window 2 | Window 3 | Median |
| --- | ---: | ---: | ---: | ---: |
| Before: deep reactive settings | 5.650 | 5.559 | 5.613 | 5.613 |
| After: plain replacement settings | 4.937 | 4.950 | 4.944 | 4.944 |

Observed median callback reduction: 0.669 ms, approximately 12%. Actual whole-window frame
rates remained approximately 142.6–143.5 FPS across both series. A callback mean below 5 ms
does not establish 200 FPS: callback work is not the entire frame interval. Do not attribute
every part of the observed reduction to proxy getter self-time or dismiss the live-scene differences.

Reports and screenshots: `/tmp/holtburger-settings-{before-off,after-off}-{1,2,3}.{json,png}`.

### Instrumented Attribution and Verification

A third login collected three instrumented 10-second windows with the changed code, then exercised
the settings toggle outside the measurement windows. Reports, screenshots, and profiles:
`/tmp/holtburger-settings-after-on-{1,2,3}.{json,png,cpuprofile}`. All three screenshots were
inspected. The viewport was 1442 × 904; final counters retained 142 dynamic roots / 2,165 ranges,
650 static draws, 171 dynamic draws, and 46 portal scopes without truncation. No browser errors
or exceptions were recorded in the measured windows.

| Instrumented measurement (ms/frame) | Window 1 | Window 2 | Window 3 |
| --- | ---: | ---: | ---: |
| Frame callback CPU | 5.486 | 5.364 | 5.429 |
| Renderer CPU, within callback | 3.501 | 3.415 | 3.473 |
| Scene contribution resolution, within renderer | 0.830 | 0.799 | 0.823 |
| Static instance run preparation, within renderer | 0.192 | 0.187 | 0.189 |
| Measured GPU work, separate | 1.034 | 1.036 | 1.035 |

- V8 frame-rooted stacks no longer sampled Svelte proxy/signal getters in any of the three
  changed-code windows. The earlier restored-scene profiles sampled approximately 0.3 ms/frame
  there. Contribution resolution fell from the earlier 1.240–1.273 ms to 0.799–0.830 ms.
  This corroborates the intended boundary improvement independently of whole-callback changes.
- Not every renderer phase improved. Static instance run preparation increased from approximately
  0.068 ms in the earlier profiles to 0.187–0.192 ms here; V8 attributed approximately 0.147 ms
  of self-time to `frameTemplateDrawIdentityEquals`. No cause was established for that difference,
  and no static-renderer change was made. Recheck it before treating it as a regression or starting
  another optimization. The earlier instrumented series is not a newly collected interleaved A/B
  control; live content, weather, viewport, and browser execution conditions differ.
- Animation remains a concrete independent candidate: sampled rotation extraction stayed near
  0.354 ms/frame, within approximately 0.54–0.55 ms of animation sampling. Dynamic publication
  remained approximately 0.92 ms/frame. Neither was changed in this experiment.
- Temporary cold-boundary wrappers verified that settings passed to the presentation session and
  runtime were structured-cloneable (deep Svelte proxies would fail this check). Clicking the
  actual UI toggle produced session values `[false, true, false]` and runtime updates
  `[true, false]`; checkbox state and Shown/Hidden labels agreed. The performance bridge identity
  remained unchanged, confirming the client presentation owner was not recreated. Restored the
  toggle to off and closed the debug panel. Evidence: `/tmp/holtburger-settings-toggle-{0,1}.json`.
- Validation: type checks and Svelte diagnostics passed without warnings; 107 client tests across
  14 files passed, including existing settings initialization/update coverage. ESLint and dead-code
  checks passed. Removed the temporary repeat loop and browser wrappers from the probe script.

Conclusion: retain the small plain-settings change. The expected reactive-read overhead is gone,
and the profiling-off windows show lower callback cost, with the comparison limitations above.
This is a CPU boundary cleanup, not a demonstrated 200 FPS result. Investigating prepared
animation data remains the recommended next independent experiment; it is not implemented here.
