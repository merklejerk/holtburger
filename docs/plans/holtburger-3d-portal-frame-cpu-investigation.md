# Holtburger 3D Portal Frame CPU Investigation

Date: 2026-08-02
Status: complete; a universal `64px²` recursive portal-footprint cutoff is accepted, and empty
frame-instance storage work and comparison sorting are accepted as removed on the target
Apple/WebKit renderer. Residual questions below require new evidence rather than extending this
investigation speculatively.

## Context and Boundaries

### Goal

Identify and structurally remove the dominant CPU costs in portal-mode frame preparation and
execution without weakening portal visibility, object ordering, transparency, scene ownership, or
renderer isolation guarantees.

### In Scope

- Reproduce the interactive `0xda55ffff` portal workload in the browser harness.
- Attribute portal-frame CPU among graph planning, scene queries, object contribution preparation,
  contribution merging, instance-run preparation, and WebGL submission.
- Determine whether immutable topology, aperture, object draw-state, or ordering facts are being
  recomputed at frame frequency.
- Determine whether already-ordered portal-node contributions are sorted again when combined.
- Determine whether a render node or exterior contribution is prepared or submitted more than once
  per frame.
- Evaluate structural lifetime corrections only after a matched baseline identifies their expected
  benefit.
- Track temporary diagnostics, production changes, verification evidence, concessions, and course
  corrections in this document.

### Out of Scope

- Changing portal visibility, stencil ownership, near-plane, or transparency semantics to improve a
  benchmark.
- Caching complete frame plans by approximate camera position or orientation.
- Treating SwiftShader GPU timing as representative of hardware-backed rendering.
- Reopening the completed persistent-instance-stream or object-device-state redesign without new
  evidence that its replacement guarantees are insufficient.
- Building a generic render graph, command encoder, scheduler, or renderer-wide cache.
- Optimizing asset loading or texture materialization stutter; those concerns are documented in
  `holtburger-3d-open-world-streaming-stutter-investigation-worksheet.md`.

## Ground Truth

### Production Code

- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
  - Owns frame phase profiling, portal planning invocation, per-node scene queries, contribution
    preparation, contribution merging, instance-run preparation, and object submission.
- `apps/holtburger-3d/src/lib/game/renderer/portal-render-graph.ts`
  - Owns topology indexing, per-frame traversal state, aperture anchoring, exact window admission,
    render-domain graph construction, and layer assignment.
- `apps/holtburger-3d/src/lib/game/renderer/portal-view-window.ts`
  - Owns projection, homogeneous clipping, normalized polygon construction, exact intersection, and
    window coverage admission.
- `apps/holtburger-3d/src/lib/game/renderer/portal-near-plane.ts`
  - Owns exact aperture intersection against the camera near-clip volume.
- `apps/holtburger-3d/src/lib/game/scene/scene-graph.ts`
  - Copies installed portal geometry, increments topology revision on mutation, and retains one
    renderer-facing topology view until the next revision.
- `apps/holtburger-3d/src/lib/game/renderer/object-rendering-policy.ts`
  - Owns exact prepared-state compatibility, transparency policy, and adjacent/semantic-cohort run
    formation.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-executor.ts`
  - Owns mechanical execution of a completed portal work plan.
- `apps/holtburger-3d/src/lib/game/renderer/frame-instance-stream-arena.ts`
  - Owns the renderer's reusable sequential-view instance stream and delegates each prepared view
    to the WebGL2 instance buffer.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-instance-buffer.ts`
  - Owns frame-instance capacity, CPU encoding storage, complete-storage orphaning, range uploads,
    and instanced attribute bindings.
- `apps/holtburger-3d/src/explorer/explorer-camera-framing.ts`
  - Owns the Explorer's terrain-relative outdoor focus pose shared by the interactive app and
    diagnostic harness.
- `apps/holtburger-3d/src/lib/frontend-tuning.ts`
  - Owns app-level camera, portal/object footprint, animation cadence, rendering, diagnostics, and
    bounded-workload tuning in one discoverable policy module.

### Diagnostic Surfaces

- `apps/holtburger-3d/scripts/browser-harness.mjs`
  - Canonical non-interactive workload runner and machine-readable frame/profile output.
- `apps/holtburger-3d/src/harness/browser/BrowserHarnessApp.svelte`
  - Browser runtime, explicit profiling control, requestAnimationFrame timing, and portal probes.
- `apps/holtburger-3d/src/explorer/ExplorerFramePanel.svelte`
  - Interactive presentation of non-overlapping renderer CPU phases and asynchronous GPU timing.

### Related Historical Work

- `docs/plans/holtburger-3d-object-device-state-deduplication-plan.md`
  - Completed the prepared-draw contract, device-state deduplication, generated-instance
    compaction, bounded frame-instance encoding, and object submission profiling. This
    investigation must extend those guarantees rather than introduce a competing prepared-object
    representation.
- `docs/plans/holtburger-3d-open-world-streaming-stutter-investigation-worksheet.md`
  - Separately attributes loading-time page-thread stalls. Its loading findings must not be mixed
    with settled steady-state frame CPU.

## North Stars

1. Compare matched workloads; scene radius and visible work are part of the benchmark contract.
2. Measure non-overlapping phases before assigning ownership to a call-tree ancestor.
3. Compute immutable and anchor-stable facts at their owning lifetime, not once per frame.
4. Preserve exact portal, draw-state, and transparency invariants through typed contracts.
5. Prefer deleting redundant preparation and ordering over adding speculative memoization.
6. Distinguish CPU preparation, WebGL submission, driver time, and GPU time.
7. Require each retained diagnostic field to distinguish a concrete hypothesis.
8. Remove temporary hot-path instrumentation after its question is answered.

## Benchmark Contract

### Interactive Reference Workload

The user-supplied interactive Safari/WebKit profile used:

- target landblock `0xda55ffff`;
- outdoor camera near `33.8S, 73.0E`;
- terrain radius `8` (`289` landblocks);
- building radius `8` (`289` landblocks);
- explicit-object radius `2` (`25` landblocks);
- generated-scenery radius `2` (`25` landblocks);
- EnvCell radius `2` (`25` landblocks);
- portal EnvCell rendering;
- anisotropic 2x texture filtering; and
- a settled, stationary view reporting approximately `15.5-16.5ms` draw/frame time.

Record the browser version, GPU/driver, viewport, device pixel ratio, camera placement and
orientation, and whether the profiler itself is enabled beside every accepted interactive result.

### Browser Harness Reproduction

Run from `apps/holtburger-3d`:

```sh
npm run harness:browser -- --brief --landblock 0xda55ffff --building-radius 8 \
  --env-cell-radius 2 --explicit-object-radius 2 --generated-object-radius 2 \
  --frame-mode portal --explorer-focus --viewport-width 690 --viewport-height 852 \
  --device-scale-factor 1 --texture-filtering anisotropic-2x --profile-renderer \
  --settle-ms 30000 --measure-ms 5000
```

The harness and interactive application must agree on requested radii, frame mode, filtering,
camera pose, viewport, and settled visible-work metrics before their timing deltas are compared.
If the exact interactive camera pose is not yet expressible by the harness, add a harness-only
control rather than silently substituting the default camera.

Capture at least five settled samples per accepted workload and compare medians. Keep the
SwiftShader harness for deterministic attribution and before/after regression checks; use the
interactive target renderer, with its GPU/driver recorded, to decide whether driver-facing changes
improve the target client.

## Evidence Log

### Probe 0: Single-Landblock Harness Baseline

Status: complete.

Command:

```sh
npm run harness:browser -- --brief --landblock 0xda55ffff --env-cell-radius 0 \
  --frame-mode portal --profile-renderer --measure-ms 5000 --settle-ms 3000
```

Environment and workload:

- Chrome 150 headless through the canonical harness.
- ANGLE/SwiftShader; GPU timer queries were unsupported.
- One landblock containing `236` EnvCells, `528` apertures/crossings, `488` static residents, and
  `55` visibility islands.
- Exterior-root traversal admitted `25` scope/window states and emitted `10` render nodes across
  `3` render layers.

Representative built-in CPU phase results over the rolling 60-frame window:

| Phase                    |        Mean per frame |
| ------------------------ | --------------------: |
| Total renderer CPU       |         `1.59-1.70ms` |
| Portal graph planning    |         `0.49-0.51ms` |
| Contribution preparation |         `0.48-0.51ms` |
| Opaque submission        |         `0.32-0.37ms` |
| Scene query              |         `0.05-0.06ms` |
| Total p95                | approximately `2.1ms` |

Interpretation:

- Portal planning was the largest or second-largest named phase in this deliberately narrow
  workload, but its absolute cost was approximately half a millisecond.
- The narrow workload did not reproduce the interactive scene radius or frame cost and therefore
  could locate planner internals but could not establish optimization priority for the Explorer.

### Probe 1: Temporary Chrome CPU Sampling

Status: complete; temporary harness instrumentation removed.

A temporary Chrome DevTools Protocol sampling profile ran over the same single-landblock steady
state. The profiler used a 100-microsecond requested sampling interval and reported self time rather
than non-overlapping phase time.

The principal planner samples were:

| Function                  | Sampled self time over five seconds |
| ------------------------- | ----------------------------------: |
| `#anchorAperture`         |                          `13.462ms` |
| `validatePlanarAperture`  |                          `12.055ms` |
| `getLandblockCoordinates` |                          `11.284ms` |
| `createPortalViewWindow`  |                          `11.116ms` |
| `polygonIdentity`         |                          `10.222ms` |
| `#expand`                 |                           `8.690ms` |
| `normalizeConvexPolygon`  |                           `8.005ms` |
| `projectAperture`         |                           `7.554ms` |
| `assignRenderLayers`      |                           `6.445ms` |

Code inspection corroborated the sample:

- `PortalRenderGraphPlanner.plan()` creates a new `PortalPlanningContext` each frame.
- The context-local anchor-aperture cache therefore does not survive a frame.
- Anchoring reparses landblock IDs and copies aperture vertices into new typed arrays.
- Near-plane testing validates immutable aperture buffers and expands packed vertices into `Vec3`
  objects for each attempted crossing.
- Projection validates aperture buffers again.
- Window creation and admission repeatedly normalize fragments and construct polygon identity
  strings.

Interpretation:

- Topology-static validation and landblock parsing, plus anchor-static aperture transforms, are
  currently paid at frame frequency.
- This is a structural lifetime defect, but Probe 0 did not prove it was the dominant interactive
  frame cost.

### Probe 2: Interactive Safari/WebKit Call Tree

Status: complete for initial attribution; matched repetitions remain pending.

The user supplied a settled Safari/WebKit CPU profile of the interactive reference workload. The
capture accumulated `110.6ms` of CPU time. Its principal portal branches were:

| Branch                                  | Capture total | Capture share |
| --------------------------------------- | ------------: | ------------: |
| `#drawPortalView`                       |      `97.2ms` |       `87.9%` |
| `PortalPlanningContext.plan`            |      `13.4ms` |       `12.1%` |
| `PortalPlanningContext.#expand`         |      `11.4ms` |       `10.2%` |
| `#collectPortalNodeContributions`       |      `33.3ms` |       `30.1%` |
| `#resolveSceneContributions`            |      `27.2ms` |       `24.4%` |
| `sortObjectFrameInputs` / native `sort` |      `12.6ms` |       `11.3%` |
| `compareObjectFrameBatchOrder`          |       `8.4ms` |        `7.5%` |
| `comparePreparedObjectDrawState`        |       `5.3ms` |        `4.7%` |
| `executePortalGraph`                    |      `49.4ms` |       `44.7%` |
| `renderIndoorNodes`                     |      `20.2ms` |       `18.1%` |
| `mergePortalNodeContributions`          |       `5.4ms` |        `4.8%` |

The planning, collection, and execution branches total `96.1ms`, closely accounting for the
`97.2ms` `#drawPortalView` total. This is a useful internal consistency check even though profiler
sampling and inlining make individual wrapper attribution imperfect.

One filtered view attributed only `1ms` to `#planPortalRenderGraph`, while its nested
`PortalPlanningContext.plan` accumulated `13.4ms`. Treat the wrapper value as a Safari
sampling/inlining artifact; use the explicit renderer phase profiler for non-overlapping planning
time in future matched captures.

Interpretation:

- Planning is material but is the third-ranked portal stage in the interactive workload.
- Contribution collection and execution together own approximately three quarters of captured CPU.
- Object preparation performs comparison-heavy sorting once per resolved portal node.
- Multi-node portal contributions concatenate already-sorted arrays and sort the combined array
  again.
- `mergePortalNodeContributions` is measurable but smaller than the initial per-node preparation and
  sort. Removing only the second sort cannot account for the full observed frame cost.

### Probe 3: Explorer-Framed Full-Radius Harness Baseline

Status: complete for five SwiftShader samples; interactive parity remains unproven.

The Explorer's automatic outdoor framing policy was moved into one app-local helper and exposed by
the browser harness. For `0xda55ffff`, the shared policy produced:

- position `[42000, 68, -16368]`;
- yaw `-45°` and pitch `-35.264389682754654°`;
- vertical FOV `60°`, near plane `0.5`, and far plane `2000`; and
- a `690 x 852` CSS and backing-buffer viewport at device pixel ratio `1`.

The viewport is inferred from the user-supplied screenshot's rendered scene bounds. It is not yet a
browser-reported value from the interactive application and must remain labeled as an assumption.

All five captures reported identical source and visible-work facts:

- `289` terrain/building batches and `25` object/generated/EnvCell batches;
- `323` resident EnvCell shells across `12` populated landblocks;
- `39` admitted portal scope/window states, `11` portal nodes, and `4` layers;
- `98` visible scene entries and `887` static-object draws;
- `779` generated fragments and `3174` generated instances; and
- `291840` frame-instance upload bytes across `2` uploads.

Five-second renderer CPU means, in milliseconds:

| Sample | Total | p95 | Planning | Contribution preparation | Opaque | Blended | Scene query |
| -----: | ----: | --: | -------: | -----------------------: | -----: | ------: | ----------: |
|      1 | 6.720 | 8.2 |    0.911 |                    2.730 |  2.057 |   0.434 |       0.236 |
|      2 | 6.909 | 8.5 |    0.941 |                    2.700 |  2.184 |   0.425 |       0.234 |
|      3 | 6.633 | 8.1 |    0.960 |                    2.591 |  2.040 |   0.411 |       0.231 |
|      4 | 6.780 | 8.6 |    0.932 |                    2.709 |  2.073 |   0.436 |       0.243 |
|      5 | 6.443 | 8.2 |    0.914 |                    2.659 |  1.912 |   0.393 |       0.227 |
| Median | 6.720 | 8.2 |    0.932 |                    2.700 |  2.057 |   0.425 |       0.234 |

At the median, contribution preparation consumed `40.2%` of renderer CPU, opaque and blended
submission consumed `36.9%` together, and portal planning consumed `13.9%`. The harness therefore
corroborates the Safari branch ranking despite different browser and rendering backends.

The number of resident texture sources remained `291`, but the reported atlas page count varied
between `4` and `5`, texture binds varied from `56` to `59`, and cumulative instance-buffer growth
varied from `1` to `3`. Visible selections, draw counts, and upload bytes were stable. This baseline
is sufficient to rank CPU branches, but not yet sufficient for a strict before/after acceptance
test until the resource-state variance is explained or excluded from capture readiness.

### Probe 4: Contribution and Execution Subphase Attribution

Status: complete for the matched SwiftShader workload; target-renderer corroboration remains
pending.

The opt-in renderer profiler replaced the aggregate contribution-preparation span with
non-overlapping resolution, preparation, node ordering, merge, and merge-ordering spans. Profiling
captures also count sort inputs/comparisons and exact portal node/set uses. Disabled profiling does
not allocate counter maps, read clocks, or increment comparator counters.

Five matched captures produced these renderer CPU means, in milliseconds:

| Sample | Total | Scene resolution | Object preparation | Node ordering | Merge | Merge ordering |
| -----: | ----: | ---------------: | -----------------: | ------------: | ----: | -------------: |
|      1 | 7.140 |            0.465 |              0.667 |         1.435 | 0.007 |          0.233 |
|      2 | 6.998 |            0.502 |              0.691 |         1.437 | 0.011 |          0.248 |
|      3 | 6.940 |            0.436 |              0.640 |         1.365 | 0.011 |          0.227 |
|      4 | 6.676 |            0.471 |              0.644 |         1.275 | 0.009 |          0.227 |
|      5 | 7.022 |            0.471 |              0.711 |         1.378 | 0.015 |          0.247 |
| Median | 6.998 |            0.471 |              0.667 |         1.378 | 0.011 |          0.233 |

Every frame prepared and consumed the same contribution shape:

- `11` portal nodes were prepared and used exactly once;
- `4` distinct contribution node sets were requested exactly once each;
- repeated node uses and repeated set uses were both `0`;
- `1703` objects entered `11` node-local sorts;
- node-local sorting performed a median `11350` comparator calls;
- `278` objects entered `2` multi-node merges and `2` merge sorts; and
- merge sorting performed a median `1110` comparator calls.

Comparator counts varied slightly between processes while selected objects and draw counts remained
stable. Animated dynamic inputs and process-local device identity assignment can change TimSort's
input runs without changing final renderer semantics.

A follow-up capture divided the `1703` prepared objects into `1623` non-dynamic inputs and `80`
dynamic inputs. Non-dynamic scene contributions therefore account for `95.3%` of preparation
volume in this workload.

The same follow-up split execution-side object CPU into:

| Execution subphase                   | Mean per frame |
| ------------------------------------ | -------------: |
| Actual opaque WebGL submission       |      `1.644ms` |
| Frame-instance run formation         |      `0.469ms` |
| Frame-instance encoding/upload       |      `0.260ms` |
| Blended distance and phase ordering  |      `0.155ms` |
| Actual blended WebGL submission      |      `0.078ms` |
| Terrain submission                   |      `0.073ms` |
| Unclassified masks and orchestration |      `0.369ms` |

This execution split is one representative capture rather than a five-sample median. It is
sufficient to show that actual opaque WebGL calls remain material and that frame-instance
preparation/upload is a separate secondary cost. Hardware GPU timestamps were unavailable under
SwiftShader, so driver and GPU ownership cannot be divided further in this environment.

### Probe 5: Retained Static Draw A/B

Status: complete; candidate rejected and implementation reverted.

Candidate B and the flattened-key portion of Candidate C were implemented as an experimental
cutover, checked for semantic parity, and measured against Probe 4. Each accepted full capture used
the same `0xda55ffff` command, 30-second settlement period, five-second measurement period, visible
work, draw counts, and portal graph facts as the baseline.

Five-sample medians, in milliseconds:

| Variant                                           | Total | Scene resolution | Object preparation | Node ordering |
| ------------------------------------------------- | ----: | ---------------: | -----------------: | ------------: |
| Probe 4 baseline                                  | 6.998 |            0.471 |              0.667 |         1.378 |
| Per-draw cache, dependency-local validation       | 8.571 |            0.524 |              1.315 |         1.885 |
| Per-draw cache, frame-captured binding revisions  | 8.431 |            0.491 |              0.975 |         2.185 |
| Per-draw cache, revisions and flat frame envelope | 8.342 |            0.440 |              1.560 |         1.600 |

Two shorter diagnostic runs moved ownership without producing an acceptable result:

| Diagnostic variant                                  | Total | Scene resolution | Object preparation | Node ordering |
| --------------------------------------------------- | ----: | ---------------: | -----------------: | ------------: |
| Renderable-level cache                              | 8.410 |            0.660 |              0.670 |         1.660 |
| Node-owned offset with direct prepared-input output | 9.310 |            1.810 |              0.000 |         1.760 |

The shorter runs are directional evidence only and are not acceptance samples. The node-owned
offset run moved the preparation work into scene resolution, demonstrating why phase-local gains
must not be accepted independently of total renderer CPU.

A temporary hit/miss discriminator showed that unstable object identity was not the cause. The
per-draw design recorded `132009` reuses and `23247` compilations across loading, settlement, and
measurement; the renderable-level design recorded `25415` reuses and `3644` compilations over its
shorter run. Compile counts include dynamic inputs and loading churn, while settled static inputs
were repeatedly reused. The cache still lost because lookup, dependency validation, envelope
copying, and additional indirection cost more than reconstructing the physical material state.

All variants preserved the accepted work counts and reported no browser application errors. The
production cutover, binding revision counters, cache tests, and temporary hit diagnostics were
therefore removed. No retained-cache mechanism remains in the renderer.

A final post-revert scar check reported `7.306ms` total renderer CPU, `0.476ms` scene resolution,
`0.748ms` object preparation, and `1.424ms` node ordering. It preserved `11` portal nodes, `98`
visible entries, `887` static draws, `1703` node-sort inputs, and zero repeated node or contribution
set uses, with no browser console messages. This single sample is not a replacement baseline, but
it confirms that the reverted renderer returned to the baseline cost class rather than retaining
the experimental regression.

### Probe 6: Marginal Value of Object State Sorting

Status: complete; comparison sorting replaced by linear instance grouping.

A temporary harness policy measured three ordering regimes without changing visibility,
transparency distance policy, exact run compatibility, or submission:

| Variant                               | Total CPU | Ordering CPU | Static draws | Generated runs | Dynamic draws | Texture binds |
| ------------------------------------- | --------: | -----------: | -----------: | -------------: | ------------: | ------------: |
| Probe 4 sorted baseline               | `6.998ms` |    `1.611ms` |          887 |            425 |            32 |       `56-59` |
| No clustering, five-sample median     | `5.872ms` |        `0ms` |         1241 |            779 |            80 |           319 |
| Instanced-only comparison-sort pilot  | `6.025ms` |    `0.866ms` |          887 |            425 |            32 |           175 |
| Linear semantic-cohort grouping pilot | `4.767ms` |        `0ms` |          887 |            425 |            32 |           214 |

The no-clustering result proved that the full comparison sorts cost more CPU than the WebGL state
changes and fragmented instance runs they avoided. The instanced-only pilot proved that compaction
remained valuable but comparison sorting was still an expensive way to recover it.

The accepted cutover gives each generated static fragment its worker-owned material/geometry
partition identity. Opaque and additive frame-instance candidates are grouped in linear first-seen
order by semantic cohort, ordering class, source, render domain, landblock, geometry, and index
range. Exact prepared-state compatibility remains authoritative inside each bucket, so a stale or
colliding cohort safely fragments instead of merging incompatible draws. Baked objects retain scene
publication order. Transparent far/near phases retain their existing camera policy and adjacent-only
run formation.

Five clean production captures produced these means, in milliseconds:

| Sample | Total | p95 | Planning | Scene resolution | Object preparation | Instance grouping | Opaque submission |
| -----: | ----: | --: | -------: | ---------------: | -----------------: | ----------------: | ----------------: |
|      1 | 5.088 | 7.5 |    0.994 |            0.522 |              0.635 |             0.784 |             1.076 |
|      2 | 4.937 | 7.6 |    1.012 |            0.496 |              0.631 |             0.747 |             1.075 |
|      3 | 5.204 | 7.2 |    1.037 |            0.545 |              0.669 |             0.814 |             1.041 |
|      4 | 5.033 | 7.2 |    0.992 |            0.525 |              0.675 |             0.794 |             1.014 |
|      5 | 4.785 | 6.2 |    0.971 |            0.487 |              0.648 |             0.702 |             1.019 |
| Median | 5.033 | 7.2 |    0.994 |            0.522 |              0.648 |             0.784 |             1.041 |

Median renderer CPU improved by `1.965ms` (`28.1%`) and median p95 improved by `1.0ms` (`12.2%`)
against Probe 4. Every capture preserved `11` portal nodes, `98` visible entries, `887` static draws,
`425` generated runs, `32` dynamic draws, `3174` generated instances, `80` dynamic instances, and
all triangle/upload counts, with zero repeated portal uses or browser errors. The accepted
screenshot was visually unchanged.

The concession is increased baked-draw state churn: accepted texture binds ranged from `221` to
`279` (median `261`) and program changes ranged from `31` to `32`. Despite that increase, opaque
submission did not regress in the matched SwiftShader captures. Probe 7 subsequently found `257`
binds without a dominant target-native state-application branch.

### Probe 7: Target Apple/WebKit Native Profile

Status: complete for resteering; this native sample is attribution evidence rather than a matched
five-sample timing baseline.

The user supplied a settled Safari/WebKit Timeline capture and a versioned Explorer diagnostic
snapshot for the accepted renderer. The snapshot identified:

- WebKit's WebGL 2 implementation on an Apple GPU;
- the exact Explorer outdoor focus pose for `0xda55ffff`;
- all five requested interest radii, portal EnvCell rendering, and anisotropic 2x filtering;
- `17` submitted portal nodes across `4` layers and `47` admitted scope/window states;
- `145` visible scene entries and `1160` submitted static-object draws;
- `1327` generated fragments compacted into `572` draws containing `6219` instances;
- `64` dynamic draws containing `232` instances;
- `2` reported frame-instance uploads totaling `588960` bytes; and
- `257` object texture binds.

The application was resized to accommodate the Timeline UI. Its captured viewport is therefore a
fact about this sample, not a canonical benchmark size or an explanation to generalize across
captures.

The principal native call-tree branches accumulated:

| Branch                               | Capture total | Capture share |
| ------------------------------------ | ------------: | ------------: |
| `#drawPortalView`                    |      `45.3ms` |       `89.7%` |
| `executePortalGraph`                 |      `29.7ms` |       `58.8%` |
| `#collectPortalNodeContributions`    |      `11.4ms` |       `22.6%` |
| `PortalPlanningContext.plan`         |       `4.2ms` |        `8.3%` |
| `#prepareObjectFrameInput`           |       `8.3ms` |       `16.4%` |
| `#prepareFrameInstanceRuns`          |      `16.2ms` |       `32.1%` |
| `formGroupedObjectInstanceRuns`      |       `3.1ms` |        `6.1%` |
| `formGroupedObjectInstanceRuns` self |       `2.1ms` |        `4.2%` |
| `bufferData` beneath instance reset  |      `11.0ms` |       `21.8%` |

The capture contains no comparison-sort branch. Linear cohort grouping is present but bounded,
while execution and particularly complete instance-buffer orphaning are now the clearest target
renderer costs. The `257` texture binds do not appear as a dominant state-application branch in
this sample, so the increased bind count is no longer the first target-hardware concern.

Code inspection before the Phase 9 cutover supplied the structural discriminator behind the native
samples:

- every `#prepareFrameInstanceRuns()` call invoked `FrameInstanceStreamArena.prepareView()`, even
  when it formed no frame-instance ranges;
- every `prepareView()` invoked `WebGL2InstanceBuffer.resetFrame()`;
- every `resetFrame()` called `bufferData()` for the arena's complete capacity, whether the requested
  population is empty or non-empty; and
- `frameInstanceUploadCount` and `frameInstanceUploadBytes` incremented only for a non-empty ordered
  population, so the permanent diagnostics omitted empty full-capacity orphan operations.

The native profile places the `11ms` `bufferData` branch primarily beneath indoor-node rendering,
where nodes can contain baked contributions but no frame-streamed instances. This supports a
bounded first cutover: delete empty arena preparations before considering persistent mapping,
buffer rotation, or another broader streaming strategy.

## Current Findings

### Finding 1: The Original Bottleneck Hypothesis Was Too Narrow

The initial single-landblock harness correctly identified avoidable planner work, but the matched
interactive workload assigns approximately `12%` of capture CPU to planning versus approximately
`30%` to contribution collection and `45%` to portal execution. Planner cleanup remains justified
technical debt; it is not currently the first optimization target.

The full-radius harness independently assigns a median `13.9%` to planning and `40.2%` to
contribution preparation. The agreement is strong enough to prioritize contribution attribution
before planner preprocessing.

### Finding 2: Full Prepared-State Sorting Was the Structural Bottleneck

Before Probe 6, every planned render node queried its scopes, prepared complete object inputs, and
comparison-sorted them. Multi-node contributions then sorted the concatenated inputs again. The two
ordering spans cost a combined median `1.611ms` and approximately `12460` comparisons.

The sorts did two jobs at once: reduce baked WebGL state churn and make compatible frame instances
adjacent for compaction. Probe 6 separated their marginal value. Removing all clustering improved
total CPU but fragmented generated and dynamic draws; restricting the same comparison algorithm to
instances restored compaction but still cost `0.866ms` in its pilot.

The accepted renderer performs neither node-local nor merged prepared-state sorting. It resolves
inputs in scene publication order and groups only run-capable opaque/additive instances at the layer
that consumes their semantic cohort and exact compatibility.

### Finding 3: Linear Cohort Grouping Preserves Compaction Without Ordering Everything

Generated static fragments now carry the semantic partition identity already owned by the static
geometry worker. Dynamic and transparent templates already carried equivalent cohort identities.
One first-seen `Map` groups run-capable opaque/additive inputs by that identity plus their domain and
range facts, then exact compatibility rechecks each candidate before joining a run.

This is a structural replacement rather than a cache: no compiled draw state or completed frame
plan survives the frame. Baked inputs are never inserted into the grouping map, and transparent
far/near candidates retain adjacent-only grouping after camera ordering.

### Finding 4: Portal Execution Needs Finer Attribution

The explicit reuse counters reject accidental contribution replay for the matched workload: all
`11` prepared portal nodes and all `4` node sets are consumed exactly once. Executor scheduling is
therefore not the cause of repeated contribution preparation at this camera.

Actual opaque WebGL submission remains a material `1.644ms` in the representative refined capture.
Frame-instance run formation and upload add another `0.729ms`, while blended ordering and
submission add `0.233ms`. Do not collapse those costs into contribution reconstruction or assume
JavaScript retention can recover driver-facing submission time.

### Finding 5: Retained Scene Inputs Dominate Preparation Volume

`1623` of `1703` prepared objects are non-dynamic, but static volume alone did not make retained
device compilation profitable. The A/B proved that physical material/device reconstruction is
cheaper than the proposed cache lookup, validation, copying, and indirection on this JavaScript hot
path.

Before Probe 6, node-local ordering was the largest contribution subphase at a median `1.378ms` and
approximately `11350` comparisons. Object preparation was smaller at `0.667ms`; attempting to
retain its stable-looking inputs regressed total renderer CPU by at least `1.344ms`. Probe 6 deleted
that ordering work rather than retaining a different representation of every draw.

### Finding 6: Empty Portal Contributions Were Orphaning the Full Instance Arena

The target native profile attributes `11ms` of self time to `bufferData` beneath
`#prepareFrameInstanceRuns`. Before Phase 9, the renderer reset and orphaned the complete instance
arena for every opaque or blended preparation call, including calls that emitted no frame-instance
range. Indoor portal nodes with baked-only contributions therefore paid a driver-facing buffer
operation whose storage could not be consumed by that call.

The selection report's `2` uploads described only non-empty logical populations and did not count
empty full-capacity orphans. Phase 9 restored a one-to-one relationship by making an empty logical
reset clear the populated range without touching GL storage. Buffer rotation or another general
streaming redesign remains premature until the target reprofile establishes the residual cost.

## Hypothesis Register

| Hypothesis                                                                                  | Current state                                                       | Required discriminator                                                  |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Portal graph planning is the primary interactive bottleneck.                                | Weakened. Planning is approximately `12%` of the supplied capture.  | Matched built-in phase profile over the exact reference workload.       |
| Immutable aperture preprocessing is incorrectly paid per frame.                             | Supported by code and Chrome samples.                               | A/B with topology/anchor preparation and unchanged traversal facts.     |
| Per-node prepared object reconstruction and sorting dominate contribution collection.       | Proven; comparison sorting was deleted after a `28.1%` total A/B.   | Recheck the trade on target hardware.                                   |
| Retaining stable draw/device facts removes most per-frame object preparation cost.          | Rejected: all measured retained variants regressed total CPU.       | Reconsider only if physical compilation itself becomes costly.          |
| Multi-node contribution merging redundantly re-sorts ordered inputs.                        | Proven and resolved by deleting both ordering layers.               | Recheck contribution identity on other portal cameras.                  |
| The same render-node set is prepared more than once during portal execution.                | Rejected for the matched workload: `4` sets, `4` uses, no repeats.  | Recheck other cameras before generalizing the result.                   |
| Exterior or indoor scene work is submitted more often than stencil semantics require.       | Rejected for the matched workload: `11` nodes prepared/used once.   | Recheck hybrid and interior-root workloads.                             |
| WebGL submission/driver time, rather than JavaScript preparation, owns most execution cost. | Backend-dependent: rejected under SwiftShader, supported on target. | Delete empty buffer resets, then reattribute residual target execution. |
| Empty portal-node instance populations orphan the complete frame arena unnecessarily.       | Proven and resolved at the buffer owner with unchanged draw facts.  | Reprofile the target native branch after the cutover.                   |
| Non-empty `bufferData` orphaning stalls on an in-flight Apple/WebKit buffer.                | Unproven; empty resets confound the current `11ms` native branch.   | Reprofile after deleting empty resets before testing buffer rotation.   |

## Phase 1: Reproduce the Interactive Workload

Status: complete for workload reproduction and target-native branch attribution; strict cross-
backend timing parity is neither expected nor required.

### Deliverables

- A harness command and camera pose matching the interactive reference workload.
- Five settled SwiftShader harness captures plus target-renderer native attribution and workload
  evidence sufficient to choose the next branch.
- A baseline table containing renderer phase timings, frame timing, portal graph metrics, visible
  object counts, draw counts, upload bytes, viewport, filtering, and device facts.

### Task Checklist

- [x] Express the Explorer's automatic outdoor camera pose in the browser harness.
- [x] Confirm all five interest radii and settled source batches match the requested Explorer
      workload.
- [x] Record portal nodes, layers, masks, admitted window states, visible entries, static draws,
      generated fragments/instances, program changes, texture binds, and frame uploads.
- [x] Capture five five-second SwiftShader renderer profiles.
- [x] Capture an interactive target-renderer native profile and portable workload snapshot.
- [x] Compare SwiftShader medians; raw output was retained in the investigation transcript rather
      than committed.
- [x] Reject captures containing loading, texture placement, lifecycle churn, camera movement, or
      profiler startup.

### Acceptance Criteria

- Accepted before/after captures submit identical visible work; cross-backend samples retain their
  own workload facts and are not treated as timing-equivalent when those facts differ.
- CPU phases account for renderer total without overlapping categories.
- The workload reproduces the interactive frame-cost class closely enough to rank CPU branches;
  absolute SwiftShader and target-renderer timings remain separately labeled.

### Decisions and Course Corrections

- The original harness camera used a `90°` FOV and fixed elevated pose. A shared Explorer framing
  contract now owns the automatic outdoor pose and `60°` projection so the harness cannot silently
  drift from the app policy.
- The first full-radius pilot used the harness's default `1280 x 720` viewport and was rejected from
  the five-sample baseline. Explicit viewport and device-scale controls were added before accepted
  captures.
- The `690 x 852` viewport is a screenshot-derived harness setting used for those five captures.
  Probe 7 established that the interactive viewport is routinely resized around profiling tools,
  so no single size is canonical; comparisons must instead hold their chosen viewport stable.
- The five SwiftShader captures are accepted for branch ranking. Resource-state variance prevents
  using them as strict optimization acceptance evidence without another readiness discriminator.

## Phase 2: Attribute Contribution Preparation and Execution

Status: complete; matched SwiftShader attribution is corroborated by the Probe 7 target-native
profile.

### Deliverables

- Opt-in or harness-only diagnostics answering each hypothesis without permanent disabled-path cost.
- A per-frame contribution report covering preparation, ordering, merging, reuse, and submission.

### Task Checklist

- [x] Count object inputs prepared per render node and per frame.
- [x] Count `sortObjectFrameInputs()` calls, input lengths, comparator calls, and whether inputs were
      already ordered.
- [x] Separate object resolution, prepared-state construction, ordering, and merge CPU spans.
- [x] Identify each unique render-node set requested by executor callbacks and count repeated uses.
- [x] Pair each planned contribution with actual exterior/indoor callback and draw counts.
- [x] Record instance-run preparation, encoding, upload, and object submission separately.
- [x] Use a browser-native saved profile to corroborate the explicit counters and spans.

### Acceptance Criteria

- Every material branch in the `33.3ms` collection and `49.4ms` execution samples has a
  non-overlapping owner.
- Diagnostics can distinguish repeated object preparation from required repeated draw submission.
- Profiling disabled mode performs no added clocks, retained samples, sort checks, or allocation-heavy
  counters.

### Decisions and Course Corrections

- Removed the aggregate `contributionPreparationMs` vocabulary rather than retaining a redundant
  total. Resolution, object preparation, node ordering, concatenation, and merge ordering now have
  distinct non-overlapping owners.
- Rejected a production-wide always-on counter surface. Detailed reuse and comparator counters
  exist only inside active frame-profile captures.
- Rejected executor contribution replay as the primary cause for this workload. Every prepared node
  and exact node set was consumed once.
- Demoted ordered multi-node merge from primary cutover to bounded follow-up: it owns a median
  `0.233ms` versus `1.378ms` for node-local ordering.
- Promoted retained non-dynamic prepared facts plus deterministic sort identity as the Phase 3
  design target. Full sorted frame lists remain camera-dependent and will not be cached.

## Phase 3: Select and Dry-Run the Structural Cutover

Status: complete; the selected implementation slice was subsequently rejected by Phase 4 evidence.

### Candidate A: Revision- and Anchor-Prepared Portal Topology

Compile validated aperture geometry and parsed landblock coordinates when the planner indexes a
topology revision. Retain anchor-relative aperture geometry while topology revision and anchor
landblock remain unchanged. Keep camera projection, clipping, exact window admission, and graph
selection frame-local.

Replacement guarantees required before deleting current work:

- malformed aperture geometry still fails before traversal;
- topology mutation invalidates all prepared aperture facts;
- anchor changes invalidate all anchor-relative geometry;
- near-plane and facing results remain bit-for-bit or tolerance-equivalent; and
- multi-view frames cannot observe another view's camera-dependent state.

### Candidate B: Retained Prepared Static Draw Facts

Split `PreparedObjectFrameInput` into stable renderer/device facts and genuinely frame/view-dependent
facts. Retain the stable portion under renderer-owned resource and quality-policy lifetimes rather
than reconstructing it for every portal-node query.

Replacement guarantees required:

- resource replacement and destruction cannot leave stale WebGL identities;
- texture filtering changes invalidate sampler-dependent state;
- dynamic transforms and dynamic presentation remain frame-current;
- anchor-relative offsets change with the anchor;
- transparent distance/order remains view-current; and
- renderer/device facts do not leak into scene, world, content, or worker contracts.

#### Ownership and Invalidation Audit

The current `ObjectFrameInput` conflates four lifetimes. The dry run assigns each fact to one
explicit contract rather than retaining the complete frame input:

| Lifetime                | Facts                                                                                                                                                   | Named consumer                                                         | Invalidation or refresh event                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Immutable draw unit     | material source, logical geometry, index range, draw kind, ordering, transparent center/stable ID, frame-template cohort                                | renderer compilation and ordering                                      | draw-unit object becomes unreachable when its static or EnvCell revision is removed                   |
| Device-binding variant  | physical geometry, prepared material/detail bindings, sampler, blend policy, alpha test, luminosity, wrap/clip-map/cull state, flattened comparison key | state comparison, run compatibility, state applicator, draw submission | atlas-binding identity, active-detail resource/key/tiling, filtering policy, or cull override differs |
| Retained node placement | landblock ID, local-to-landblock transform, render domain, retained instance stream                                                                     | visibility result, transform submission, run boundary                  | scene node/revision replacement                                                                       |
| Frame/view              | anchor-relative landblock offset, dynamic transform/presentation, frame instance range, transparent distance and phase order                            | current frame ordering, instance upload, shader uniforms               | recomputed for each selected view/frame                                                               |

Static-object and EnvCell systems publish immutable draw-unit objects under exact revision ownership.
They remove scene nodes and draw units before dropping their geometry resource owners. The shared
`GeometryManager` creates a backend geometry key once for that logical lease and does not call the
backend replacement API. A renderer cache keyed by draw-unit object identity can therefore retain
that physical geometry only for the draw unit's lifetime. Dynamic contributions do not have this
guarantee and remain frame-compiled.

Texture lifetime is deliberately different. `AtlasPagePublication` can atomically replace a
logical texture's page resource and placement while the consuming scene draw unit remains alive.
It replaces the corresponding `TextureAtlasBinding` object on publication and releases superseded
pages only after the new binding map is installed. Raw `WebGLTexture`, atlas rectangle, or sampler
state therefore must not be retained solely under scene revision. The renderer must resolve the
current base and palette atlas-binding objects, plus the current active-detail logical binding and
texture resource, before reusing a device-binding variant. Object identity for atlas bindings and
exact detail key/resource/tiling values form the validation contract; a changed dependency compiles
a replacement variant. Texture filtering is an explicit closed variant key because it selects a
different renderer-owned sampler. EnvCell flat/portal cull policy is also an explicit variant key.

This does not require resource lifecycle notifications, a global atlas epoch, or backend handles in
`RenderWorld`. Those alternatives would broaden the contract to invalidate unrelated draws. A
`WeakMap` keyed by the immutable draw-unit or frame-template object also lets revision removal make
entries collectible without mirroring scene ownership in the renderer.

#### Dry-Run Contract

The clean cutover uses one representation at each side of the lifetime boundary:

- a renderer-private retained static draw, keyed by immutable `StaticObjectDrawUnit`,
  `FrameStreamedObjectInstanceTemplate`, or `EnvCellDrawUnit` identity, owns the compiled
  device-binding variant and the stable prefix of its batch-comparison key;
- a frame object envelope owns source, render domain, node placement, anchor-relative offset, and
  the selected static-fragment/frame-template/frame-range instance payload; and
- a dynamic draw is compiled directly into the same frame envelope without entering the retained
  static cache.

The existing `PreparedStaticObjectDrawCompatibility` remains the sole exact run-compatibility
contract. The comparison key is a flattened view of the same prepared facts, not a second source of
truth: it retains primitive values and physical object references in the comparator's current
branch order, while renderer-local identity numbers are still requested lazily during comparison.
The frame comparator appends anchor-relative offset and stable node identity exactly where the
current comparator does. This preserves the existing identity-assignment and stable-sort behavior;
preassigning numeric resource IDs during compilation was rejected because it can change ordering
based on first encounter rather than the current first comparison.

The cutover deletes per-frame recompilation of blend, color/opacity, alpha-test, luminosity,
clip-map, wrap, physical geometry, atlas rectangles, and sampler-dependent state for unchanged
static inputs. It does not delete current visibility queries, dynamic preparation, transparent
distance ordering, node-local sorting, exact run compatibility checks, draw-range validation at
first compilation, or WebGL submission.

### Candidate C: Prepared Sort Identity and Ordered Contribution Merge

Compute the complete deterministic object batch-order identity once on the prepared draw contract.
Retain individually ordered node contributions and combine them with an ordered merge. Do not
weaken final draw compatibility or transparent ordering.

Replacement guarantees required:

- output ordering is identical for every reachable comparison difference;
- stable identity tie-breaking remains deterministic;
- transparent-to-transparent order remains untouched at this stage;
- a changed draw-consumed field reaches a distinct sort identity; and
- multi-node duplicates still fail loudly rather than being hidden by merging.

### Task Checklist

- [x] Use Phase 2 counts to estimate the maximum recoverable CPU for each candidate.
- [x] Trace ownership and invalidation for every proposed retained fact.
- [x] List every guarantee provided by each deleted validation, preparation, and sort operation.
- [x] Dry-run type shapes and call sites without introducing compatibility aliases.
- [x] Select the smallest candidate or coherent candidate set that addresses the measured dominant
      cost.
- [x] Record rejected candidates and why their benefit or ownership model failed.

### Acceptance Criteria

- The selected design removes measured repeated work rather than merely hiding it behind a cache.
- Every retained field has a named consumer and invalidation event.
- No approximate camera cache, generic scheduler, or duplicate prepared-object representation is
  introduced.

### Decisions and Course Corrections

- Experimentally selected Candidate B with Candidate C's flattened comparison-key portion as the
  first Phase 4 slice. At the observed `95.3%` non-dynamic share, the proportional upper bound for deleting
  static recompilation is approximately `0.636ms` of the `0.667ms` preparation median. Flattening
  the retained comparison prefix can reduce work inside the median `11350` node-local comparisons,
  but the full `1.378ms` ordering span is not claimed because comparison sorting remains.
- The combined absolute ceiling of all measured object preparation and node ordering is `2.045ms`,
  or `29.2%` of the `6.998ms` median renderer CPU. The selected first slice deliberately claims
  only a subset; its before/after profile decides whether a larger ordered-contribution cutover is
  justified.
- Rejected retaining raw WebGL bindings under scene revision alone. Atlas publication can move a
  logical texture without replacing its consuming scene node.
- Rejected adding a renderer-wide resource notification or global atlas epoch. Current atlas
  binding identity provides exact, dependency-local invalidation without coupling unrelated draws.
- Rejected preassigning numeric device sort IDs during retained compilation because it changes the
  current lazy identity-assignment order. The retained key preserves physical references and the
  existing comparison sequence instead.
- Deferred retained sorted node arrays and ordered multi-node merge. They can recover at most the
  measured `1.378ms` node ordering and `0.233ms` merge ordering, but require a separate proof for
  scene-query order, transparent stable ordering, and cross-node tie behavior.
- Candidate A remains valid planner debt but is not the first measured target.
- Phase 4 rejected the selected slice. The ownership model was correct, but its cost model was not:
  reuse was common and still slower than direct frame compilation.

## Phase 4: Implement One Proven Cutover

Status: complete for the retained-static-draw experiment; cutover rejected and reverted.

### Deliverables

- The selected typed lifetime correction and its focused tests.
- A clean cutover deleting the replaced validation, reconstruction, sorting, or merge path.
- Updated diagnostics and vocabulary describing the surviving mechanism.

### Task Checklist

- [x] Implement only the candidate justified by the recorded baseline and dry run.
- [x] Add focused tests for invalidation and preserved ordering/visibility guarantees during the
      experiment.
- [x] Remove the rejected implementation, helpers, aliases, fields, diagnostics, and stale comments.
- [x] Keep production hot paths free of unconditional diagnostic clocks and retained samples.

Implementation sequence:

1. Extract the stable prepared-draw and flattened comparison-key types beside the existing object
   rendering policy; keep exact compatibility as the submission/run contract.
2. Add one renderer-private static compiler with `WeakMap` ownership and explicit dependency
   validation for atlas bindings, active detail, filtering policy, and cull override.
3. Change static-object, frame-template, and EnvCell collection to compile/reuse the retained draw
   and construct only the frame envelope. Keep dynamic collection on direct compilation.
4. Cut `PreparedObjectFrameInput` over to the retained-draw-plus-frame-envelope shape and delete
   the old all-in-one preparation path. Do not retain a compatibility alias.
5. Preserve comparator branch order, exact run compatibility, first-compilation draw-range
   validation, transparent ordering, and all submission inputs with focused equivalence and
   invalidation tests.
6. Run the complete app checks, then capture five matched SwiftShader samples. Accept the cutover
   only if object preparation improves without unexplained count, ordering, screenshot, or phase
   changes.
7. Use the residual object-ordering profile to choose between stopping, proving retained per-node
   ordering, or taking the bounded ordered-merge follow-up.

### Acceptance Criteria

- Portal graph facts, visible scene counts, draw counts, ordering, and screenshots remain unchanged
  unless a separately proven correctness bug is found.
- The targeted CPU phase improves in matched median captures without moving equivalent work into an
  unmeasured phase.
- Flat rendering and non-portal object submission do not regress materially.

### Decisions and Course Corrections

- Rejected per-draw retention after all three matched variants regressed total renderer CPU from
  `6.998ms` to `8.342-8.571ms`.
- Rejected a renderable-level cache after a short diagnostic restored object preparation to the
  baseline range but left total CPU and node ordering materially worse.
- Rejected moving landblock-offset construction to node resolution as a phase-label optimization;
  it moved cost from object preparation to scene resolution and increased total CPU to `9.310ms`.
- Removed the global atlas-binding revision because the rejected cache was its only consumer.
- Restored the last known-good instrumented renderer rather than leaving dormant production
  machinery for a hypothesis the profile disproved.

## Phase 5: Resteer Against Matched Evidence

Status: complete; Probe 7 subsequently resteered target-renderer work to the frame-instance arena.

### Task Checklist

- [x] Repeat the exact SwiftShader capture matrix after the first cutover.
- [x] Compare phase medians, visible work, draws, and browser errors.
- [x] Reinspect the dominant remaining branch rather than automatically implementing the next
      candidate.
- [x] Decide whether to continue, subdivide, reorder, or stop the experiment.
- [x] Update this document with measured regressions and rejected assumptions.

### Acceptance Criteria

- The next action follows the new dominant cost and retains the original goal.
- A successful local optimization is not accepted if total frame CPU regresses or correctness facts
  change without explanation.

### Decisions and Course Corrections

- Stop the retained-draw line. The remaining structural target is repeated envelope construction
  and comparison sorting across node-local contribution arrays, not physical device compilation.
- Do not proceed directly to retained sorted node arrays. First prove which layer owns a stable,
  already-ordered logical contribution stream without adding per-draw cache lookup or copying.
- Probe 6 resolved the comparison-sorting target with linear grouping. Probe 7 then found that
  baked-only portal-node draws still orphan the full instance arena despite producing no range that
  can consume it; Phase 9 owns that distinct lifetime defect.

## Phase 6: Cleanup and Verification

Status: complete for the accepted SwiftShader cutover; broader investigation diagnostics remain
intentionally available behind explicit profiling activation.

### Deliverables

- Temporary probes removed or retained only behind explicit profiling activation with a named user.
- Full verification results and final before/after evidence recorded here.
- Surviving debt and concessions clearly separated from completed work.

### Task Checklist

- [x] Remove obsolete sort profiler extensions, temporary controls, logs, and allocation-heavy
      assertions.
- [x] Run formatting on touched files, type checks, lint, and the full TypeScript suite.
- [x] Run focused portal graph, executor, scene, object-policy, and renderer tests through the full
      TypeScript suite.
- [x] Run the canonical browser harness and matched reference workload.
- [x] Verify an interactive target-renderer native profile and record its GPU/driver identity.
- [x] Sweep deleted mechanism vocabulary from touched symbols, metrics, UI, docs, and tests.

### Acceptance Criteria

- Touched code passes formatting, type checks, lint with warnings treated as errors, and tests.
- Browser verification reports no application errors and preserves portal evidence.
- This document contains the final measurements, implementation history, concessions, and remaining
  questions.

### Decisions and Course Corrections

- The repository-wide Prettier check still reports `20` unrelated pre-existing files. Every file
  touched by this investigation passes the formatter; unrelated formatting churn was not included.
- Type checking, ESLint, dead-code analysis, and all `539` TypeScript tests pass after the accepted
  cutover.

## Phase 7: Replace Global State Sorting with Linear Instance Grouping

Status: complete; target-native corroboration accepted for resteering.

### Task Checklist

- [x] Measure the marginal CPU and submission value of full state clustering.
- [x] Measure instanced-only comparison sorting separately from baked state sorting.
- [x] Add a producer-owned cohort identity for generated static fragments.
- [x] Group opaque/additive instances linearly and preserve exact compatibility checks.
- [x] Keep transparent far/near ordering and adjacent-only run formation unchanged.
- [x] Delete node-local/merged sorts, prepared-state comparators, device identity ranking, profiler
      metrics, UI vocabulary, and temporary harness controls.
- [x] Capture five matched clean production samples and verify work-count/screenshot parity.
- [x] Confirm on target Safari/WebKit that comparison sorting is absent, linear grouping is bounded,
      and record driver/GPU facts.

### Decisions and Course Corrections

- Rejected unconditional source order as the final design despite its `16.1%` CPU improvement;
  generated runs increased `425→779` and dynamic runs increased `32→80`.
- Rejected instanced-only comparison sorting as the final design. It restored compaction but still
  spent `0.866ms` ordering `859` inputs in its pilot.
- Selected linear first-seen semantic cohorts with exact compatibility fallback. It restores the
  original draw/run counts and improves median renderer CPU by `28.1%`.
- Accepted increased baked state churn because matched opaque submission and total CPU improved,
  and the target Apple/WebKit profile reported `257` binds without a dominant state-application
  branch. Reopen bounded baked grouping only if later target evidence attributes material cost to
  those binds.

## Phase 8: Make Permanent Frame Diagnostics Portable and Bounded

Status: implemented; interactive export verification remains pending.

### Task Checklist

- [x] Collapse selection, profile, and enabled state into one atomic renderer diagnostic snapshot.
- [x] Keep the diagnostic capability separate from the renderer's production draw methods.
- [x] Compose a versioned report at the Explorer boundary with camera, requested interest, viewport,
      DPR, frame settings, browser identity, WebGL identity, selection facts, and the profile.
- [x] Add clipboard and JSON-file export from the Frame Info panel.
- [x] Separate performance, workload, object, portal/EnvCell, and runtime-lifetime presentation.
- [x] Put dense diagnostic groups behind disclosure controls while retaining every fact in JSON.
- [x] Compare one matched profiling-disabled and profiling-enabled harness run.
- [x] Verify clipboard export in the interactive Tauri/WebKit application.
- [ ] Verify JSON-file export in the interactive Tauri/WebKit application.

### Decisions and Course Corrections

- The renderer continues to own renderer facts and the opt-in timing implementation. Explorer owns
  browser, camera, viewport, presentation, and scene-interest context; none of those app-local
  fields enter the renderer contract.
- Replaced three optional renderer methods with one optional diagnostic capability. Its single
  snapshot prevents selection, profile, and enabled state from being sampled at different times.
- Retained always-on selection counters provisionally because they serve workload inspection while
  timing is disabled. Gating them without attribution would add branches throughout the render path
  and conflate two independent policies.
- A single matched SwiftShader pair measured `5.430ms` average frame work with profiling disabled
  and `5.624ms` enabled over `54` frames each, a directional opt-in cost of `0.194ms` (`3.6%`). This
  is not treated as a stable benchmark because only one pair was captured.
- The automated harness pair was captured from stdout because the current CLI has no file-output
  option. Adding one is unrelated to the interactive Explorer export cutover.

## Phase 9: Delete Empty Frame-Instance Storage Resets

Status: complete and accepted under SwiftShader and target Apple/WebKit.

### Goal

Make backend instance-buffer work correspond exactly to a non-empty frame-instance population,
then use the residual Apple/WebKit profile to decide whether non-empty streaming needs a broader
redesign.

### Structural Cause

`#prepareFrameInstanceRuns()` schedules baked and frame-instanced objects together. A baked-only
opaque or blended contribution produces no `frame-instance-run`, but the function still calls
`FrameInstanceStreamArena.prepareView([])`. Before this phase, that call reached
`WebGL2InstanceBuffer.resetFrame(0)`, which retained the existing capacity and nevertheless called
`bufferData(capacityBytes, STREAM_DRAW)`.

The reset's previous guarantees and their replacements are:

| Existing guarantee                                     | Replacement when the population is empty                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Old frame ranges cannot be consumed after reset.       | Reset the populated count to zero without replacing backend storage.          |
| Capacity can grow to fit the prepared population.      | An empty population requires no growth; retain the existing capacity.         |
| Populated count describes the newly uploaded stream.   | `getRange()` observes zero and rejects every stale non-empty range.           |
| Each non-empty sequential view receives fresh storage. | Non-empty populations retain the exact reset, encode, upload, and range path. |

### Task Checklist

- [x] Make `WebGL2InstanceBuffer.resetFrame(0)` clear its logical population without calling
      `bufferData`.
- [x] Keep non-empty capacity growth, full-storage orphaning, encoding, `bufferSubData`, and range
      validation unchanged in the first cutover.
- [x] Preserve empty arena preparation as a valid logical reset so stale ranges still fail loudly.
- [x] Add focused coverage proving an empty population performs no `bufferData` or `bufferSubData`
      operation, while consecutive non-empty populations still orphan once each and reuse CPU
      staging storage.
- [x] Confirm `frameInstanceUploadCount` now has a one-to-one relationship with actual backend
      preparation calls; do not add a permanent empty-reset metric for a mechanism being deleted.
- [x] Run formatting, type checking, lint, dead-code analysis, and the full TypeScript suite.
- [x] Capture the canonical SwiftShader workload and verify all portal, object, run, instance,
      triangle, and logical upload facts remain unchanged.
- [x] Reprofile the target Apple/WebKit workload and determine whether `bufferData` remains a
      material branch after empty resets are gone.

### Acceptance Criteria

- A baked-only opaque or blended contribution performs no frame-instance buffer operation.
- Every emitted `frame-range` still refers to the immediately prepared non-empty population.
- All visibility, ordering, compaction, draw, instance, triangle, and upload-byte facts remain
  unchanged.
- The target native call tree removes the indoor baked-only `bufferData` branch or falsifies the
  current attribution with a named cause.
- No ring buffer, fence, persistent mapping abstraction, or alternate streaming mode is introduced
  by this phase.

### Resteering Gate

After the empty-reset A/B:

- stop if `bufferData` is no longer material;
- if non-empty reset remains material, distinguish orphan allocation from `bufferSubData` transfer
  before selecting a buffer-rotation or synchronization design; and
- if contribution preparation becomes dominant again, attribute its surviving atlas binding and
  frame-envelope work rather than reviving the rejected retained-draw cache.

### Decisions and Course Corrections

- Selected deletion of empty arena storage operations as the smallest coherent cutover supported
  by both code lifetime and the target native profile.
- Moved the cut from a renderer-side conditional into `WebGL2InstanceBuffer.resetFrame()`. Clearing
  the logical population while retaining storage preserves stale-range rejection and keeps the
  empty-view contract structurally correct without teaching the renderer about backend allocation.
- Rejected adding permanent counters before the cutover. The existing logical upload count now
  matches backend storage preparation because an empty logical reset performs no GL operation.
- Deferred buffer rotation. The current native `bufferData` samples combine provably redundant
  empty resets with potentially necessary non-empty orphaning, so a broader device strategy has no
  clean benefit estimate yet.
- Stopped the buffer-streaming line after the target reprofile removed `bufferData` from the sampled
  call tree. Non-empty exterior preparation remained effectively unchanged, so neither buffer
  rotation nor synchronization machinery has a measured target.

### Implementation Evidence

- The focused buffer suite passes `4` tests, including non-empty → empty → non-empty reuse and
  stale-range rejection after the empty reset.
- Svelte and TypeScript checks, ESLint, dead-code analysis, Rust clippy, and all `539` TypeScript
  tests pass.
- The canonical DA55 harness preserved `11` portal nodes, `98` visible entries, `887` static draws,
  `425` generated runs, `3174` generated instances, `32` dynamic draws, `80` dynamic instances, and
  `291840` logical upload bytes with no browser console messages.
- That single scar check measured `4.655ms` mean renderer CPU, `6.7ms` p95, and `0.138ms` instance
  upload. It is directionally below the accepted Phase 7 medians but is not promoted to a matched
  A/B without target-native evidence.
- The matched target-native call trees changed as follows:

  | Branch                           |   Before |       After |    Change |
  | -------------------------------- | -------: | ----------: | --------: |
  | Total sampled page CPU           | `50.5ms` |    `35.9ms` |  `-28.9%` |
  | `#drawPortalView`                | `45.3ms` |    `31.7ms` |  `-30.0%` |
  | `executePortalGraph`             | `29.7ms` |    `17.9ms` |  `-39.7%` |
  | Exterior rendering               | `14.7ms` |    `14.7ms` | unchanged |
  | Indoor rendering                 | `14.1ms` |     `2.0ms` |  `-85.8%` |
  | `#prepareFrameInstanceRuns`      | `16.2ms` |     `5.3ms` |  `-67.3%` |
  | `bufferData` beneath arena reset | `11.0ms` | not sampled |   removed |
  | Contribution collection          | `11.4ms` |     `9.6ms` |  `-15.8%` |
  | Portal planning                  |  `4.2ms` |     `4.2ms` | unchanged |

- The unchanged exterior and planning branches are internal controls for the attribution. The
  necessary exterior instance preparation remains, while the indoor baked-only reset branch and
  its `bufferData` self time disappear.
- The frame overlay read approximately `9.0ms` before and `9.7ms` after. Native sampled CPU improved,
  but this pair does not establish a user-visible wall-frame improvement; GPU work, presentation,
  sampling granularity, and ordinary frame variance remain outside this cutover's claim.

## Phase 10: Cull Negligible Recursive Portal Footprints

Status: implemented and accepted at a universal `64px²` production cutoff under deterministic and
target Apple/WebKit motion validation.

### Goal

Avoid constructing and consuming work behind any portal whose exact inherited screen-space window
is too small to justify the downstream CPU and GPU work.

This deliberately permits a fidelity/performance deviation from the retail client. The cutover is
owned by one recursive portal-footprint policy across indoor traversal, indoor exits, same-domain
boundaries, and exterior transitions. Near-plane crossings retain exact behavior.

### Structural Boundary

The planner applies the policy after homogeneous projection and exact intersection with the
inherited portal window, but before target-scope selection, mask-edge admission, scope-coverage
admission, or descendant traversal. The projected footprint is measured in drawing-buffer pixels,
not world distance or CSS size.

Near-plane-straddling apertures are exempt because their projected area is unstable at the camera
plane and they can represent the camera's current transition. Alternate larger routes remain
independent crossings and can still admit the same target scope.

### Task Checklist

- [x] Add one explicit, typed minimum portal-footprint pixel-area policy with zero meaning
      disabled; do not infer a threshold from camera distance.
- [x] Compute footprint from the already-normalized exact portal window without adding bounds or
      distance approximations.
- [x] Reject every non-near-plane crossing below the threshold after exact projection and before
      any target-domain work.
- [x] Retain one diagnostic count whose concrete scenario is a projected transition below the
      active threshold.
- [x] Add focused planner coverage for disabled policy, threshold equality, same-domain descendant
      rejection, indoor-exit rejection, near-plane exemption, and alternate routes.
- [x] Expose an explicit threshold override through the browser harness and record the effective
      value in the existing frame-settings snapshot.
- [x] Measure DA55 at `0`, `1`, `4`, `16`, and `64` drawing-buffer pixels squared while preserving
      camera, scene interest, filtering, viewport, and resident content within one process.
- [x] Promote the first threshold that rejects a complete subtree without a visible static-frame
      difference; reject larger thresholds without commensurate structural savings.

### Acceptance Criteria

- A zero threshold produces the exact pre-phase graph and metrics.
- A visible crossing below a positive threshold contributes no target scope, mask edge, render
  node, or descendant work and increments the rejection count once.
- Equality is retained; only footprints strictly below the configured threshold are rejected.
- Near-plane-straddling transitions ignore the cutoff regardless of crossing class.
- Invalid thresholds or drawing-buffer extents fail at the planner boundary.
- Type checking, lint, dead-code analysis, Rust clippy, the full TypeScript suite, and the canonical
  browser harness pass. Touched files satisfy Prettier; the repository-wide formatting check still
  names `16` unrelated pre-existing files.

### Decisions and Course Corrections

- Selected projected inherited-window area instead of world distance. This measures the actual
  rendering opportunity after parent-window intersection and naturally adapts to resolution.
- Applied the decision before `#selectScope()`. A rejected transition therefore creates no mask
  edge, target node, scene query, contribution preparation, submission, or descendant traversal.
- Kept near-plane crossings exact and exempt. A portal intersecting the camera near volume can own
  the current transition even when its projected polygon is numerically small.
- Generalized the original entry-only predicate without adding topology branches: the lasting
  predicate consumes only near-plane status, final inherited-window area, and the threshold.
- Selected one universal `16px²` cutoff. On the current DA55 baseline it reduces portal nodes from
  11 to 8, static draws from 887 to 816, and mean profiled renderer CPU from `4.994ms` to `4.416ms`
  (`11.6%`). The indoor-root and hybrid acceptance cameras reject zero crossings.
- `64px²` removed nine crossings and 117 static draws, but its `4.382ms` SwiftShader mean was
  effectively equal to `16px²`. Target-native Explorer motion showed only very-far-distance portal
  pop, which the user accepted as the intended fidelity/performance concession. It is therefore the
  selected universal production default.
- A DA55 sky-to-scene transition reduced the settled graph from 16 to 12 nodes and static draws from
  1,154 to 1,068. Matched final captures were visually indistinguishable under inspection with
  normalized pixel RMSE `0.00393`.
- Anecdotal target-native use at `16px²` improved Explorer performance without portal pop,
  disappearing content, or flicker. The subsequent accepted `64px²` motion check exposed only the
  explicitly accepted very-far-distance pop.
- Removed the temporary in-process sweep after capturing the threshold matrix. The permanent
  harness retains only the explicit single-threshold override.

### Implementation Evidence

The one-process DA55 sweep produced:

| Minimum area | Rejected transitions | Portal nodes | Mask edges | Static draws |
| -----------: | -------------------: | -----------: | ---------: | -----------: |
|       `0px²` |                  `0` |         `11` |       `16` |        `887` |
|       `1px²` |                  `0` |         `11` |       `16` |        `887` |
|       `4px²` |                  `0` |         `11` |       `16` |        `887` |
|      `16px²` |                  `1` |          `9` |       `14` |        `856` |
|      `64px²` |                  `2` |          `9` |       `13` |        `851` |

- The accepted `16px²` run retained all `3174` generated instances and `80` dynamic instances,
  reduced visible EnvCell scopes from `32` to `30`, and emitted no browser console error.
- The accepted run measured `4.498ms` mean renderer CPU and `5.3ms` p95 over `54` profiled frames on
  SwiftShader. This single run is directional evidence, not a performance A/B claim.
- Separate settled `0px²` and `16px²` captures at the same camera, scene interest, filtering, and
  `690×852` drawing buffer were visually indistinguishable and measured `47.6dB` PSNR. Because they
  came from separate live runs, the comparison is a smoke test rather than proof of zero temporal
  difference.
- The full `543`-test TypeScript suite, Svelte/TypeScript checks, ESLint, dead-code analysis, and
  Rust clippy pass. Focused planner coverage proves threshold equality, strict rejection,
  near-plane exemption, indoor-to-outdoor exemption, invalid-input failure, and larger-route
  admission after a smaller route is rejected.
- The final Phase 9 visibility closeout repeated the deterministic zero-versus-production matrix.
  DA55 reduced portal nodes from 11 to 8, static draws from 887 to 485, upload bytes from `291840`
  to `79920`, and average frame work from `6.91ms` to `6.05ms`. The indoor-root control retained
  exactly six scopes, one render node, 72 static draws, and no instance upload under both policies;
  the hybrid control retained its five scopes, two render nodes, two masks, and one exterior render.
- The user-supplied final Apple/WebKit sample attributed approximately `17.6ms` total sampled page
  CPU, `15.5ms` to portal-frame drawing, `11.4ms` beneath portal execution, `10.3ms` to exterior
  rendering, `5.2ms` to instance-run formation/object-range drawing, `3.1ms` to contribution
  collection, and approximately `1ms` each to indoor rendering and portal planning. This is final
  target attribution on the accepted build, not a native timing A/B; the deterministic matrix owns
  the matched policy comparison.

## Risks and Mitigations

| Risk                                                                       | Mitigation                                                                                                                                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Safari sampling/inlining misattributes wrapper functions.                  | Use the renderer's non-overlapping explicit phases and treat native profiles as internal attribution evidence.                                                                            |
| Harness and Explorer profiles compare different scene workloads.           | Match radii, camera, filtering, visible-work metrics, and settled state; keep the viewport stable within a timing comparison without treating one size as canonical.                      |
| Retained prepared state becomes stale after resource or quality changes.   | Name every invalidation owner in the contract and test each reachable invalidation event.                                                                                                 |
| Linear grouping changes transparency or merges incompatible draws.         | Keep camera-ordered transparent phases adjacent-only and recheck exact prepared compatibility inside every semantic cohort.                                                               |
| Contribution concatenation hides duplicate node ownership.                 | Keep explicit duplicate-node and duplicate-scene-node validation before merging.                                                                                                          |
| Portal execution redraws are mistaken for duplication.                     | Pair executor callbacks with planner-authored contribution identities and stencil semantics before removing work.                                                                         |
| Instrumentation materially changes the hot path.                           | Keep it opt-in, use aggregate counters, compare instrumented and uninstrumented frame timing, and remove temporary probes.                                                                |
| SwiftShader and the interactive target renderer disagree.                  | Report both regimes, record whether the target renderer is hardware-backed, use SwiftShader for deterministic regression evidence, and use the target renderer for client prioritization. |
| The investigation duplicates the completed object-state plan.              | Reuse its prepared-draw and compatibility contracts; extend only the newly measured portal lifetime/ordering seam.                                                                        |
| Skipping empty backend work exposes a stale range from a prior population. | Clear the logical populated count on every empty reset and retain range bounds checks for every submitted instanced draw.                                                                 |
| A larger buffer redesign hides the proven empty-work defect.               | Delete empty resets first and reprofile before considering rotation, synchronization, or allocation-policy changes.                                                                       |
| A projected-area cutoff causes transition pop while approaching a door.    | Exempt near-plane crossings, keep the cutoff at the first measured subtree-removing threshold, and validate motion on the target client before raising it.                                |

## Change Log

### 2026-08-02

- Created this investigation after the single-landblock harness and interactive Safari/WebKit
  profiles ranked different dominant costs.
- Recorded the initial planner attribution, the removed temporary Chrome sampling probe, and the
  user-supplied Safari/WebKit call-tree evidence.
- Reclassified portal planning from presumed primary bottleneck to third-ranked measured stage in
  the interactive reference workload.
- Identified per-node prepared-object reconstruction/sorting and portal execution as the next
  investigation targets.
- Added a shared Explorer outdoor framing contract and used it from both the camera coordinator and
  browser harness.
- Added explicit harness viewport and device-scale controls plus camera, viewport, and summarized
  source-batch evidence.
- Captured five full-radius SwiftShader samples and recorded their raw phase means, median ranking,
  stable work counts, and resource-state variance.
- Replaced the aggregate contribution timer with resolution, object preparation, node ordering,
  merge, and merge-ordering spans; added opt-in sort and portal reuse counters.
- Proved that the matched frame prepares `1623` non-dynamic versus `80` dynamic objects and performs
  approximately `11350` node-local ordering comparisons.
- Split object execution into blended ordering, frame-instance run formation, instance upload, and
  actual opaque/blended WebGL submission.
- Rejected repeated portal node/set consumption as the source of the measured reconstruction cost
  for the matched workload.
- No renderer, portal-planning, scene-selection, or object-ordering behavior changed.

### 2026-08-03

- Completed the Phase 3 ownership and invalidation audit for every prepared object field.
- Proved that static-object and EnvCell draw-unit identity follows revision/resource ownership, but
  atlas texture bindings can change independently while those draw units remain alive.
- Initially selected a renderer-private retained static draw keyed by immutable draw-unit identity,
  with dependency-local atlas/detail validation and explicit filtering/cull variants.
- Kept dynamic presentation, placement, anchor offsets, frame instance ranges, and transparent
  ordering frame-current.
- Selected a flattened retained comparison prefix that preserves the current lazy physical-identity
  ordering; rejected eager numeric identity assignment.
- Deferred retained sorted lists and ordered merge until the first cutover's residual profile proves
  their additional complexity is warranted.
- Implemented and profiled three matched retained-draw variants. All preserved visible work and
  renderer semantics but regressed median total CPU to `8.342-8.571ms` from `6.998ms`.
- Used temporary cache hit diagnostics and renderable-level ownership to reject identity churn as
  the primary failure. Cache validation, copying, and indirection outweighed direct compilation.
- Rejected a node-owned offset variant after it moved work into scene resolution and increased a
  short-run total to `9.310ms`.
- Reverted the retained cache, binding revisions, comparison-key changes, and temporary diagnostics;
  no rejected mechanism remains in production code.
- Proved with five samples that deleting all state clustering improved median CPU by `16.1%` but
  fragmented generated and dynamic instance runs.
- Added producer-owned generated-fragment cohort identity and replaced comparison sorting with
  linear first-seen grouping plus exact compatibility fallback.
- Deleted node-local and merge ordering, prepared-state comparators, renderer device identity
  ranking, obsolete profiler/UI metrics, and temporary harness controls.
- Verified the clean cutover across five matched samples: median total CPU improved `28.1%`, median
  p95 improved `12.2%`, and all visible-work, draw, run, triangle, instance, upload, and portal-use
  facts remained unchanged.
- Consolidated renderer diagnostics behind one capability and one atomic snapshot.
- Added a versioned Explorer-owned diagnostic report with clipboard and JSON-file export.
- Reorganized Frame Info into compact performance/workload summaries with object, portal/EnvCell,
  contribution, phase, and runtime-lifetime detail disclosed on demand.
- Recorded a directional profiling-on/off pair showing approximately `0.194ms` (`3.6%`) opt-in
  overhead on the matched SwiftShader workload.
- Recorded the target Safari/WebKit native profile and versioned Explorer snapshot on an Apple
  GPU. Comparison sorting was absent, linear grouping was bounded, and execution became dominant.
- Reclassified the resized interactive viewport as sample context rather than a canonical benchmark
  contract.
- Traced `11ms` of native `bufferData` samples to the frame-instance reset path and proved that
  baked-only portal contributions orphaned the complete arena without emitting a consuming frame
  range.
- Made empty resets clear their logical population without touching backend storage, preserving
  stale-range rejection and all non-empty behavior.
- Accepted Phase 9 after the target profile removed the `11ms` `bufferData` branch, reduced indoor
  sampled CPU from `14.1ms` to `2.0ms`, and left exterior rendering unchanged at `14.7ms`.
- Stopped the buffer-streaming line rather than adding an unmeasured ring-buffer or synchronization
  design.
- Added entry-only projected-window rejection after exact intersection and before target scope
  selection, with near-plane, reverse-direction, and alternate-route guarantees.
- The original entry-only `0/1/4/16/64px²` sweep selected `16px²`, which removed two portal nodes
  and `31` static draws. Recursive generalization and target-native motion validation later promoted
  `64px²` rather than retaining the original classification-specific conclusion.
- Added the effective cutoff and rejected-transition count to portable frame diagnostics and kept
  an explicit browser-harness override after removing the temporary sweep.
- Bumped the Explorer frame diagnostic schema to version `2` because the portable settings and
  selection-metric contract gained the cutoff and rejection count.
- Bumped the Explorer frame diagnostic schema to version `3` when the generic recursive cutover
  renamed that setting and rejection metric in the exported JSON contract.

## Definition of Done

- [x] The interactive reference camera, interest, frame mode, and filtering are reproducible by the
      browser harness; viewport size remains capture-local.
- [x] A five-sample SwiftShader baseline and target-native attribution/workload evidence exist for
      resteering.
- [x] Planning, contribution collection, merging, instance preparation, submission, driver, and GPU
      costs are independently attributed as far as platform support allows.
- [x] The dominant repeated work has a proven lifetime/ownership cause.
- [x] The selected structural cutover names replacements for every deleted guarantee.
- [x] Portal visibility, stencil ownership, object ordering, transparency, and resource lifecycle
      behavior remain correct.
- [x] Matched profiles demonstrate a material total-frame improvement without unexplained work-count
      changes.
- [x] Temporary diagnostics are removed and verification passes.
- [x] Permanent diagnostics produce a portable, versioned evidence report.
- [x] Final decisions, concessions, rejected approaches, and remaining debt are recorded here.

## Open Questions

1. Do interior-root and hybrid cameras preserve exact draw/run counts under linear opaque instance
   grouping, including additive instance cohorts absent from the DA55 view?
2. Which stable ownership boundary, if any, explains the residual `9.6ms` contribution-collection
   branch without reviving the rejected retained-draw cache?
3. How much of exterior opaque submission is JavaScript work versus WebGL driver/GPU synchronization on the
   target hardware?
4. Why can a settled workload with `291` resident texture sources report either `4` or `5` atlas
   pages, and does that difference explain the small texture-bind variance?
5. Does JSON-file download succeed in the interactive Tauri/WebKit application as clipboard export
   already does?
