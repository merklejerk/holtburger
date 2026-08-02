# Holtburger 3D Object Submission Deduplication and Compaction Plan

## Context and Boundaries

### Goal

Reduce exterior object-submission CPU time and static draw count by applying exact object device state once, ordering legal work by its complete compatibility identity, and compacting compatible visible static-instance fragments after culling.

### In Scope

- Deduplicate object-pass program, culling, blending, texture, sampler, active-texture-unit, and vertex-array state.
- Make object-state ownership and invalidation explicit at renderer-controlled pass boundaries.
- Separate exact single-draw compatibility from state-reuse ordering and from caller-owned view/domain batching scopes.
- Retain immutable generated-scenery instance records under their existing lease lifetime and compact compatible visible fragments into the renderer-owned frame-instance arena.
- Move EnvCell static residents to the existing baked preparation strategy; keep dynamic and transparent run policy unchanged.
- Delete the persistent GPU instance-stream path after compaction proves its replacement guarantees.
- Initialize invariant object sampler-unit uniforms once per linked program and establish fallback texture state only at explicit pass boundaries.
- Preserve transparency ordering, portal rendering, terrain rendering, and generated-scenery 2x2 spatial culling.
- Compare the fixed centered gameplay and edge-of-interest stress workloads recorded below before and after each optimization.

### Out of Scope

- Merging geometry, atlas pages, baked draws, or transparent instance submissions.
- Changing generated-scenery clustering or culling granularity.
- Generic uniform-value caching.
- A renderer-wide state mirror shared with terrain, uploads, or the portal substrate.
- Moving WebGL device objects into scene graph, static-object artifact, worker, or shared runtime contracts.
- Persistent composite VAOs; measured pair cardinality rejected that design for this workload.
- Optimizing GPU pixel cost, shader execution, or mesh complexity.
- Permanent per-draw diagnostic collection in shared runtime paths.

## Ground Truth

### Reference Sources

- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
  - Owns object resolution, ordering, program activation, material binding, pass boundaries, and submission; its post-culling preparation seam is where view-local compaction belongs.
- `apps/holtburger-3d/src/lib/game/renderer/object-rendering-policy.ts`
  - Owns pure transparency, blend, ordering, and adjacent-run policy.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-instance-buffer.ts` and `frame-instance-stream-arena.ts`
  - Define the 80-byte instance record, mutable range binding, encoding, upload, and reusable per-view arena.
- `apps/holtburger-3d/src/lib/game/systems/static-resources.ts`
  - Defines the renderer-neutral immutable instance records already emitted by static workers.
- `apps/holtburger-3d/src/lib/game/systems/static-instance-stream-manager.ts`
  - Owns semantic instance-stream leases but currently retains only the uploaded backend resource key.
- `apps/holtburger-3d/src/lib/game/commit/artifacts.ts` and `static-object-geometry-worker.ts`
  - Define and produce immutable static draw units and instance fragments without WebGL concerns.
- `apps/holtburger-3d/src/lib/game/renderer/render-world.ts`
  - Resolves visible scene contributions and is the boundary through which retained immutable fragment data reaches the renderer.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-resource-manager.ts`
  - Owns geometry VAOs and currently owns the persistent instance buffers that this plan removes.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-texture-sampler-catalog.ts`
  - Provides stable immutable `WebGLSampler` identities suitable for exact comparison.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-object-program.ts`
  - Proves all four object variants statically declare base, palette, and detail samplers.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-executor.ts` and `webgl2-portal-substrate.ts`
  - Independently mutate WebGL state and establish the object-cache invalidation boundary.

### Established Code Facts

- Each instanced draw currently performs one array-buffer bind, five attribute enables, five pointer definitions, and five divisors: 16 instance-layout calls after the geometry VAO bind.
- Each object texture request currently performs `activeTexture`, `bindTexture`, and `bindSampler` even when the physical binding is unchanged.
- Each object-program activation currently repeats three fallback texture/sampler bindings and three invariant sampler-unit uniform assignments.
- Geometry VAOs retain geometry attributes and the element buffer but not instance attributes.
- Persistent static streams are immutable and always consumed from instance zero; transparent instances already use CPU-retained frame templates instead.
- The frame-instance arena already owns geometric growth, contiguous encoding, `bufferSubData`, range binding, and per-view upload metrics.
- Static workers already emit the complete immutable CPU instance records. The current manager discards those records after creating one backend buffer.
- Generated scenery and EnvCell static residents currently use the immutable instanced strategy. Buildings and explicit outdoor objects use baked geometry; CellStruct shells are separate non-instanced draws over shared shell geometry.
- EnvCell resident jobs and scene nodes are intentionally partitioned by exact EnvCell scope. Archive evidence below shows that their scope-local instance populations are mostly singletons and do not justify retaining that strategy.
- Texture atlas placement uniforms may change while the physical texture and sampler remain identical; placement uniforms therefore cannot be deduplicated as texture state.
- Terrain and portal execution mutate WebGL state outside object submission.
- Current opaque ordering clusters a string material key before baked-versus-instanced program identity and omits some state consumed by submission.

## Pre-Implementation Evidence and Architecture Decision

### Fixed Workloads

Evidence was collected on 2026-08-02 with real DAT content, flat rendering, a 3x3 scene interest centered on `0xda55ffff`, explicit/generated radii of one, camera height 6, pitch -15 degrees, a 10-second settle, and a 3-second measurement window.

Centered workload:

```sh
npm run harness:browser -- --brief --landblock 0xda55ffff --building-radius 1 \
  --explicit-object-radius 1 --generated-object-radius 1 --camera-height 6 \
  --camera-pitch -15 --settle-ms 10000 --measure-ms 3000
```

Edge stress workload, with the camera moved east and turned back toward retained interest:

```sh
npm run harness:browser -- --brief --landblock 0xda55ffff --building-radius 1 \
  --explicit-object-radius 1 --generated-object-radius 1 \
  --camera-landblock 0xda56ffff --camera-height 6 --camera-pitch -15 \
  --camera-yaw 180 --settle-ms 10000 --measure-ms 3000
```

The same edge placement at yaw 0 was rejected as a stress workload because it faced away from retained interest and submitted only 246 persistent draws.

### Observed Work

A temporary one-shot renderer probe grouped persistent fragments only when they shared the same view, render-relevant landblock facts, geometry/index range, ordering, effective cull face, and complete material value. The probe was removed after capture.

| Observation                                |  Centered | Edge stress |
| ------------------------------------------ | --------: | ----------: |
| Visible static nodes                       |        22 |          36 |
| Submitted static-object draws              |       968 |       1,224 |
| Persistent instanced draws                 |       776 |       1,000 |
| Persistent instances                       |     2,991 |       3,455 |
| Instance-layout configurations             |       813 |       1,079 |
| Unique `(geometry, instance stream)` pairs |       776 |       1,000 |
| Adjacent persistent-pair reuse             |         0 |           0 |
| Compatible compacted persistent draws      |       337 |         520 |
| Persistent draws eliminated                |       439 |         480 |
| Mergeable fragments / groups               | 644 / 205 |   754 / 274 |
| Compaction upload bytes per view           |   239,280 |     276,400 |
| Existing frame-instance upload bytes       |    38,320 |      52,960 |
| Object program changes                     |        47 |          80 |
| Requested object texture bindings          |     1,349 |       1,750 |

Repeated uninstrumented captures produced the same submitted-work counts. Their total render times are not used as CPU acceptance evidence: the centered capture averaged about 14.4 ms, while the inward-facing edge capture averaged about 128.7 ms and was dominated by view-dependent GPU/driver work. Implementation profiling must isolate object-submission CPU from total render time.

These flat exterior captures contained no visible EnvCell scopes. Their compaction counts and draw targets therefore justify generated-scenery regrouping only.

### EnvCell Resident Strategy Evidence

An archive-backed A/B used `0x00d1ffff`, which contains 4,213 EnvCells and 3,331 classified static resident parts. The comparison changed only `prepareStaticObjectGeometry()` so EnvCell resident jobs used the existing baked branch, then restored the production branch after capture.

```sh
npm run harness:browser -- --brief --landblock 0x00d1ffff --building-radius 0 \
  --env-cell-radius 0 --explicit-object-radius 0 --generated-object-radius 0 \
  --camera-height 6 --camera-pitch -15 --settle-ms 15000 --measure-ms 3000
```

| EnvCell preparation observation         |     Instanced |     Baked |
| --------------------------------------- | ------------: | --------: |
| Static resident parts                   |         3,331 |     3,331 |
| Persistent streams / instances          | 1,550 / 1,798 |     0 / 0 |
| Average instances per persistent stream |          1.16 |       n/a |
| Persistent draw units                   |         2,994 |         0 |
| Transparent instance templates          |         1,533 |         0 |
| Baked material ranges                   |             0 |     3,999 |
| Prepared resident contributions         |         4,527 |     3,999 |
| Geometry bytes                          |     3,332,880 | 8,227,116 |
| Instance/template bytes                 |       284,876 |         0 |
| Total retained payload bytes            |     3,617,756 | 8,227,116 |
| Total backend geometry resource count   |        10,456 |    12,326 |
| Geometry-worker duration                |      387.7 ms |  396.8 ms |

The scope-local population of 1.16 instances per stream is insufficient to justify persistent instancing. Baking removes 1,550 mostly-singleton streams and reduces prepared resident contributions by 528. The admitted concession is approximately 4.61 MB more retained payload and 1,870 more geometry resources on this unusually large interior archive. A real portal-view comparison remains required because this materialization capture intentionally did not guess an interior camera pose.

### Decision

Proceed with post-culling static-fragment compaction and reject persistent composite VAOs.

- Pair cardinality equals submitted persistent draw count in both workloads, so composite VAOs would create hundreds to one thousand pair-specific device objects without adjacent reuse.
- Conservative compaction removes 56.6% of persistent draws in the centered workload and 48.0% in the edge workload.
- The required single-view uploads are 239,280 and 276,400 bytes respectively. Actual encoding and `bufferSubData` cost still require direct implementation measurement, especially for multiple portal views, but the structural draw reduction justifies the compaction path.
- The clean cutover bakes EnvCell static residents, retains only generated-scenery immutable CPU records in the leased static-instance manager, resolves those fragments through `RenderWorld`, uploads selected compatible runs through the existing frame arena, and deletes persistent instance buffers and their resource-manager API.
- If measured compaction CPU cost fails the Phase 4 gate, stop and resteer. Composite VAOs are not the fallback unless a different representative workload disproves the cardinality evidence above.

## North Stars

1. Cache only state the renderer knows exactly; never query WebGL to reconstruct it.
2. Prepare consumed draw facts once, but keep single-draw compatibility, state-reuse ordering, and batching scope as distinct decisions.
3. Invalidate object state at explicit ownership boundaries instead of pretending the cache observes terrain or portal work.
4. Preserve spatial fragments for visibility while allowing the renderer to choose GPU batch boundaries after culling.
5. Keep immutable instance data and lease lifetime renderer-neutral; keep per-view grouping, encoding, upload, and WebGL state in the renderer.
6. Preserve required transparent ordering even when it limits deduplication.
7. Prefer deleting the persistent GPU-stream mechanism over adding a second composite-VAO resource graph.
8. Remove diagnostics whose frame cost would undermine the optimization.

## Phase 1: Lock the Baseline and Draw-Compatibility Contract

### Deliverables

- The two commands above retained as the canonical before/after workloads.
- A renderer-private prepared-draw value containing the facts consumed by object submission.
- One object-pass static-instance compatibility comparison containing only facts that must match for one current `drawElementsInstanced` call.
- A CPU profile isolating `#drawObjectRange`, instance layout binding, object texture binding, draw-call time, instance encoding, and `bufferSubData` for both workloads.

### Task Checklist

- [ ] Record browser, GPU/driver, build mode, viewport, filtering, and frame-mode facts beside the profile results.
- [ ] Capture at least five settled samples per workload and compare medians rather than one frame.
- [ ] Define a typed prepared-draw value containing resolved geometry/index range, effective raster state, texture/sampler requests, atlas placements, and every draw-constant material uniform consumed by current object submission.
- [ ] Define static-instance compatibility from only the prepared facts that cannot vary within one current instanced draw: geometry/index range, effective cull face, landblock-offset uniform, texture/sampler bindings, and draw-constant material uniforms.
- [ ] Keep ordering class as an outer pass partition, the instanced program implicit in static compaction, and render domain/EnvCell scope as an outer batching scope rather than pretending those are GL equality axes.
- [ ] Resolve exact WebGL program, texture, sampler, and VAO identities once for the state applicator; do not put device objects into the pure ordering/grouping policy.
- [ ] Account source-specific diagnostics from contributing fragments before compaction; do not split compatible batches merely to preserve old counters.
- [ ] Keep per-instance transforms/colors and instance-fragment identity outside the compatibility value.
- [ ] Put the focused static compatibility/grouping function in `object-rendering-policy.ts`; do not introduce a generic pass framework or another delimiter-concatenated material string.
- [ ] Add focused tests in `object-rendering-policy.test.ts` proving one changed consumed field creates one incompatibility and irrelevant provenance does not.
- [ ] Use temporary timing probes only when the browser profiler cannot isolate a call; remove them after capture.

### Acceptance Criteria

- Both workloads reproduce the submitted-work counts above before implementation.
- Every compatibility or device-state field has a named consumer and a test where changing it matters.
- Opaque and alpha-test compatibility is deterministic; transparent work cannot enter static compaction.
- Generated scenery may compact across visible spatial clusters; EnvCell static residents are baked per exact EnvCell job and never enter compaction.
- The baseline reports object-submission CPU separately from total render/GPU time.

### Decisions and Course Corrections

- Composite VAOs were rejected because unique pair count equaled persistent draw count and adjacent reuse was zero in both workloads.
- The original outward-facing edge capture was rejected and replaced with the inward-facing yaw-180 workload.
- _Additional decisions to be filled during implementation._

## Phase 2: Introduce Pass-Scoped Object State Application

### Deliverables

- A focused renderer-backend component under `renderer/` that owns applied object device state.
- A texture-unit binding containing both `WebGLTexture` and resolved `WebGLSampler` identity.
- Explicit invalidation before every independently controlled object phase following terrain or portal work.
- Fake-WebGL tests proving redundant calls are skipped and invalidation reapplies required state.

### Task Checklist

- [ ] Define the complete cached object-device-state shape with ownership and invalidation comments.
- [ ] Add narrow operations for program, cull face, blend policy, texture/sampler unit, active texture unit, and VAO application.
- [ ] Resolve sampler requests through `WebGL2TextureSamplerCatalog.getSampler()` once per desired binding and compare the returned sampler object.
- [ ] Replace local `activeProgram` variables and unconditional cull/blend/texture/VAO calls with the applicator.
- [ ] Reset to unknown state at object-phase boundaries; terrain and portal code must remain independent.
- [ ] Keep atlas rectangles and other draw-constant uniforms outside the state cache.
- [ ] Count physical texture binds only when `bindTexture` executes; rename `objectTexturePageBinds` and sweep its UI/tests if its current vocabulary becomes dishonest.
- [ ] Test texture-only changes, sampler-only changes, program changes, cull/blend changes, repeated VAOs, active-unit transitions, and invalidation.

### Acceptance Criteria

- Repeating identical desired object state performs no redundant WebGL state calls.
- Changing either texture or sampler performs exactly the necessary calls.
- A new independently controlled object phase reapplies required state even when desired values match the prior phase.
- No generic uniform cache or `gl.getParameter` reconstruction exists.
- Existing terrain and portal fixtures pass unchanged in behavior.

### Decisions and Course Corrections

- _To be filled during implementation._

## Phase 3: Align Opaque Submission Order with Desired State

### Deliverables

- Opaque/alpha-test ordering that clusters the prepared device state actually consumed by submission without treating sort equality as permission to merge draws.
- Program/transform source clustered before material device state, followed by stable geometry and fragment identity tie-breakers.
- Unchanged near-transparent distance ordering and phase-local far-transparent batching.

### Task Checklist

- [ ] Replace `objectMaterialSortKey` and renderer-private partial comparisons with a focused prepared-state comparator.
- [ ] Keep ordering classes distinct.
- [ ] Preserve frame-template compatibility ordering used to form transparent and dynamic upload runs.
- [ ] Add deterministic tie-breakers without treating provenance, stable identity, or sort adjacency as draw compatibility.
- [ ] Test alternating baked/instanced inputs, shared physical atlas pages with different placements, sampler-only differences, cull overrides, persistent/static fragments, and transparent barriers.

### Acceptance Criteria

- Equivalent opaque inputs form contiguous program/material/geometry groups deterministically, while only the Phase 1 static compatibility function authorizes compaction.
- Near-transparent objects remain back-to-front and never enter state-oriented reordering.
- Far-transparent and frame-template runs retain their existing compatibility invariants.
- Program changes and physical state transitions do not increase in either fixed workload.

### Decisions and Course Corrections

- _To be filled during implementation._

## Phase 4: Bake EnvCell Residents and Compact Generated Scenery

### Deliverables

- EnvCell resident jobs use the existing baked static-object preparation branch and publish no instance streams or transparent instance templates.
- `StaticInstanceStreamManager` retains generated-scenery `StaticInstanceStreamData` under its existing lease ownership instead of uploading a persistent backend buffer.
- `RenderWorld` resolves immutable generated-scenery fragments without exposing WebGL resources or view policy.
- The renderer groups compatible visible opaque/alpha-test generated-scenery fragments within the current view/pass, encodes each group contiguously, uploads once through the frame-instance arena, and submits one draw per group.
- Persistent instance resource keys, buffers, creation/release APIs, renderer variants, metrics vocabulary, and tests are deleted in the same cutover.

### Guarantees Removed with the Old Mechanism and Their Replacements

| Deleted guarantee/mechanism                          | Replacement                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| One immutable GPU buffer per generated cohort        | Immutable CPU fragment retained by the leased static-instance manager                            |
| Scope-local EnvCell resident instance streams        | Existing baked per-EnvCell geometry preparation                                                  |
| Full persistent stream starts at instance zero       | Each compacted run receives an explicit frame-arena range                                        |
| Resource-manager release destroys persistent buffers | Lease removal drops retained CPU data; frame-arena storage remains renderer-owned                |
| Spatial cluster implicitly defines a draw boundary   | Spatial cluster remains a culling boundary; compatibility defines the post-culling draw boundary |
| Persistent draw metrics identify the old path        | Static-fragment and compacted-run metrics describe the surviving mechanism                       |
| Repeated per-draw instance attribute configuration   | One range configuration per compacted run; fewer runs are submitted                              |

### Task Checklist

- [ ] Route `LandblockLayerKind.EnvCells` through `prepareBakedStaticObjectGeometry()` and remove the now-dead EnvCell instanced-strategy tests and diagnostics expectations.
- [ ] Preserve one baked artifact/scene node per exact EnvCell resident job, transparent stable ordering, atomic publication, replacement, and eviction.
- [ ] Change the static-instance manager’s retained value from a backend key to generated-scenery immutable stream data and preserve reserve/publish/drop-owner atomicity.
- [ ] Change `RenderWorld` resolved generated-scenery draw contracts to carry the immutable fragment data needed by renderer-owned compaction.
- [ ] Assemble compacted static groups into the existing frame-arena population without introducing a universal run scheduler; dynamic and transparent policies remain separate callers of the same storage primitive.
- [ ] Group generated scenery only within one prepared view and ordering pass.
- [ ] Never merge across landblock-offset uniforms, transparency constraints, or portal draw-view invocations.
- [ ] Encode each selected instance record once per view and upload the complete population in one arena preparation.
- [ ] Preserve deterministic instance order within each compatibility group.
- [ ] Delete `createStaticInstanceStream`, `getInstanceStream`, `InstanceStreamResourceKey`, persistent buffer usage, and obsolete release/destruction branches after all consumers move.
- [ ] Rename or delete every surviving `persistent` symbol, metric, comment, UI label, and test that referred to the removed GPU mechanism.
- [ ] Add manager tests for lease sharing, replacement, release, and immutable data resolution.
- [ ] Add renderer-policy tests for group boundaries and fake-WebGL/arena tests for offsets, upload population, and one draw per compacted group.
- [ ] Measure encode time, `bufferSubData` time, object-submission CPU, upload bytes, and draw reduction in both fixed workloads.
- [ ] Exercise at least one multi-view portal fixture containing baked EnvCell residents and report generated-scenery upload bytes per draw-view invocation; do not silently reuse compacted ranges after the arena resets.

### Acceptance Criteria

- Centered persistent/static-equivalent draws fall from 776 to no more than the measured conservative estimate of 337 unless the final typed compatibility contract identifies and documents a missing incompatibility.
- Edge persistent/static-equivalent draws fall from 1,000 to no more than 520 under the same rule.
- The centered median object-submission CPU improves by at least 10% from the Phase 1 baseline.
- The edge median object-submission CPU does not regress by more than 5%; total render time is reported separately because this view is pixel/driver dominated.
- Compaction uploads remain attributable per view and within 10% of the measured instance-population estimates unless visible work changes.
- The `0x00d1ffff` EnvCell materialization reports baked strategy, 3,999 baked ranges, zero persistent streams/instances, and zero transparent instance templates unless source content changes.
- A selected EnvCell portal fixture preserves visible content and ordering after the baked cutover; its draw and frame-time deltas are recorded rather than assumed from whole-landblock preparation counts.
- Static eviction and replacement leave no retained fragment data after the final lease drops.
- No persistent instance WebGL buffer, composite VAO cache, or renderer-device object leaks into artifact, scene, worker, or `RenderWorld` contracts.
- Dynamic and transparent instance offsets and ordering behave exactly as before.

### Decisions and Course Corrections

- If actual compatibility produces materially fewer merges than the evidence probe, document the newly discovered consumed field before changing the draw target.
- If encoding/upload cost fails the CPU gates, stop and profile the arena and retained-data shape before choosing another resource model. Do not default to composite VAOs against the recorded cardinality evidence.
- _Additional decisions to be filled during implementation._

## Phase 5: Initialize Invariant Program and Fallback State Once

### Deliverables

- Base, palette, and detail sampler-unit uniforms initialized once for every linked object program.
- Fallback texture bindings established only at an explicit object-pass boundary when a unit otherwise lacks a valid compatible 2D texture.
- Shader-contract tests documenting why disabled palette/detail paths remain valid.

### Task Checklist

- [ ] Move invariant sampler-unit assignments into explicit object-program initialization while that program is bound.
- [ ] Establish pass-boundary fallback bindings through the object-state applicator without overwriting useful bindings on every program switch.
- [ ] Remove fallback binding and sampler-unit assignments from program activation and per-material submission.
- [ ] Verify solid-color, direct-color, indexed, alpha-test, detail, and no-detail materials.

### Acceptance Criteria

- Program switching performs no fallback texture bindings or sampler-unit uniform assignments.
- Every statically active sampler has a valid compatible binding before drawing.
- Sampler-unit values remain correct for all four object program variants.

### Decisions and Course Corrections

- _To be filled during implementation._

## Phase 6: Cleanup and Verification

### Deliverables

- Temporary timing, pair-count, transition, and grouping probes removed.
- Focused and full automated verification completed.
- Matching before/after profiles recorded for both fixed workloads and the selected portal fixture.
- Plan decisions updated to describe the landed implementation rather than the abandoned persistent path.

### Task Checklist

- [ ] Remove temporary logs, sets, counters, URL flags, and probe-only allocations from the frame path.
- [ ] Sweep obsolete `persistent`, composite-VAO, resource-key, helper, metric, comment, and UI vocabulary.
- [ ] Run focused renderer, resource-manager, static-instance-manager, `RenderWorld`, and runtime tests while developing.
- [ ] Run `npm run format:check` from `apps/holtburger-3d`.
- [ ] Run `npm run check` from `apps/holtburger-3d`.
- [ ] Run `npm run lint` from `apps/holtburger-3d` and treat warnings as failures.
- [ ] Run `npm run test:ts` from `apps/holtburger-3d`.
- [ ] Run `npm run harness:browser` plus the two fixed workload commands.
- [ ] Re-profile physical state calls, layout setup, encoding/upload, draw calls, object-submission CPU, and total render time.

### Acceptance Criteria

- Formatting, type checks, lint, tests, and browser harnesses pass.
- The Phase 4 CPU and draw-count gates pass without changed visible content.
- Physical program, cull, blend, texture, sampler, active-unit, and VAO calls decrease or remain unchanged in both workloads.
- Portal fixtures retain correct ordering and state isolation, with per-view compaction traffic reported.
- No permanent expensive diagnostic path remains.
- The plan records final compatibility-group counts, upload bytes, concessions, and profiling results.

### Decisions and Course Corrections

- _To be filled during implementation._

## Risks and Mitigations

| Risk                                                                        | Mitigation                                                                                                                                                             |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The object cache becomes stale after another subsystem mutates WebGL state. | Scope it to renderer-controlled object phases and begin every independent phase from unknown state.                                                                    |
| Compatibility omits a draw-consumed uniform or state field.                 | Prepare consumed facts once, give every compatibility field a named consumer, and test one reachable difference per field.                                             |
| Compaction merges across a semantic or portal isolation boundary.           | Restrict generated-scenery grouping to one prepared view/pass and compare the landblock-offset uniform inside that scope.                                              |
| One batching model becomes a speculative renderer framework.                | Add only the static compatibility function needed now; retain separate dynamic and transparent scheduling policies over the shared arena storage.                      |
| View-local compaction trades draw churn for excessive encoding/upload cost. | Measure encoding, `bufferSubData`, and object-submission CPU against explicit Phase 4 gates in centered, edge, and multi-view workloads.                               |
| Retaining CPU fragments materially increases memory.                        | Reuse worker-emitted immutable records under existing leases, remove duplicate persistent GPU storage, and report retained bytes in diagnostics during implementation. |
| Baking EnvCell residents increases geometry bytes and device-object count.  | Record the admitted `0x00d1ffff` delta, verify selected portal-view draws, and keep the change only if lifecycle and frame-time evidence remain acceptable.            |
| State-oriented sorting or compaction breaks transparency.                   | Exclude transparent work; preserve existing near-distance and far-compatible algorithms.                                                                               |
| Texture dedupe skips an atlas placement update.                             | Cache physical texture/sampler state only; keep placement and material uniforms in the draw-compatibility/submission contract.                                         |
| Fallback removal creates incomplete sampler state.                          | Initialize sampler units once and establish valid compatible fallbacks at explicit pass boundaries.                                                                    |
| Instrumentation recreates the overhead being optimized.                     | Use profiler captures or temporary one-shot probes and remove them during cleanup.                                                                                     |
| A broad abstraction obscures the hot path.                                  | Keep the applicator object-specific and the compatibility/grouping policy pure; do not build a generic command encoder.                                                |

## Definition of Done

- [ ] Object state has one explicit renderer-owned applicator and clear invalidation boundaries.
- [ ] Redundant program, cull, blend, texture, sampler, active-unit, and VAO calls are skipped.
- [ ] Opaque/alpha-test sorting consumes prepared desired state, while static compaction uses a narrower single-draw compatibility comparison.
- [ ] Spatial scene nodes remain visibility units but no longer force compatible static GPU draw boundaries.
- [ ] Generated scenery compacts across compatible visible clusters; EnvCell static residents use baked per-cell preparation; dynamics retain their existing run policy.
- [ ] Persistent GPU instance streams and all of their vocabulary are deleted.
- [ ] Retained immutable instance data follows existing lease replacement and eviction guarantees.
- [ ] Dynamic and transparent frame-instance ranges retain correct offsets and ordering.
- [ ] Program switches no longer repeat invariant sampler initialization or fallback bindings.
- [ ] Temporary diagnostics are removed.
- [ ] Formatting, checks, lint, tests, and browser harnesses pass.
- [ ] Matching profiles satisfy the Phase 4 CPU/draw gates and report multi-view upload cost.
- [ ] No renderer/device concern leaks into scene, worker, artifact, or shared runtime contracts, and no generic render-pass framework is introduced.

## Open Questions

No user decision blocks execution. Implementation must still record:

- the final typed compatibility fields and any difference from the conservative evidence probe;
- measured encoding and `bufferSubData` cost on the fixed workloads;
- retained CPU bytes after deleting duplicate persistent GPU buffers;
- the selected baked-EnvCell portal-view draw/frame-time delta; and
- per-view generated-scenery upload multiplication in the selected portal fixture.
