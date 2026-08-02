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
  - Owns semantic generated-fragment leases and now retains the immutable CPU records used by view-local compaction.
- `apps/holtburger-3d/src/lib/game/commit/artifacts.ts` and `static-object-geometry-worker.ts`
  - Define and produce immutable static draw units and instance fragments without WebGL concerns.
- `apps/holtburger-3d/src/lib/game/renderer/render-world.ts`
  - Resolves visible scene contributions and is the boundary through which retained immutable fragment data reaches the renderer.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-resource-manager.ts`
  - Owns geometry VAOs; its former persistent instance-buffer ownership was deleted during Phase 4.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-texture-sampler-catalog.ts`
  - Provides stable immutable `WebGLSampler` identities suitable for exact comparison.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-object-program.ts`
  - Proves all four object variants statically declare base, palette, and detail samplers.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-executor.ts` and `webgl2-portal-substrate.ts`
  - Independently mutate WebGL state and establish the object-cache invalidation boundary.

### Established Baseline Code Facts

These facts describe the pre-implementation path retained for comparison; later phase decisions record the current implementation.

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

Run the workload commands from `apps/holtburger-3d`. Centered workload:

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

Repeated uninstrumented captures produced the same submitted-work counts. Their initial total-render observations were not used as CPU acceptance evidence because the inward-facing edge workload was dominated by view-dependent GPU/driver work and the centered timing was not reproducible in the later matched capture. Implementation profiling must isolate object-submission CPU from total render time, and software-renderer totals must not be generalized to the hardware-backed application.

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

The scope-local population of 1.16 instances per stream is insufficient to justify persistent instancing. Baking removes 1,550 mostly-singleton streams and reduces prepared resident contributions by 528. The admitted concession is approximately 4.61 MB more retained payload and 1,870 more geometry resources on this unusually large interior archive. This materialization capture intentionally did not guess an interior camera pose; the later `0x7d640113` portal fixture supplies the required rendered-view comparison.

### Decision

Proceed with post-culling static-fragment compaction and reject persistent composite VAOs.

- Pair cardinality equals submitted persistent draw count in both workloads, so composite VAOs would create hundreds to one thousand pair-specific device objects without adjacent reuse.
- Conservative compaction removes 56.6% of persistent draws in the centered workload and 48.0% in the edge workload.
- The evidence probe predicted single-view generated uploads of 239,280 and 276,400 bytes respectively. The later implementation profiles measure encoding and `bufferSubData`, and the portal fixture reports upload traffic per draw-view invocation.
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

- [x] Record browser, GPU/driver, build mode, viewport, filtering, and frame-mode facts beside the profile results.
- [x] Capture at least five settled samples per workload and compare medians rather than one frame.
- [x] Define a typed prepared-draw value containing resolved geometry/index range, effective raster state, texture/sampler requests, atlas placements, and every draw-constant material uniform consumed by current object submission.
- [x] Define static-instance compatibility from only the prepared facts that cannot vary within one current instanced draw: geometry/index range, effective cull face, landblock-offset uniform, texture/sampler bindings, and draw-constant material uniforms.
- [x] Keep ordering class as an outer pass partition, the instanced program implicit in static compaction, and render domain/EnvCell scope as an outer batching scope rather than pretending those are GL equality axes.
- [x] Resolve exact WebGL program, texture, sampler, and VAO identities once for the state applicator; do not put device objects into the pure ordering/grouping policy. Texture, sampler, and geometry/VAO identities are prepared; exact program selection lands with the Phase 2 applicator.
- [x] Account source-specific diagnostics from contributing fragments before compaction; do not split compatible batches merely to preserve old counters.
- [x] Keep per-instance transforms/colors and instance-fragment identity outside the compatibility value.
- [x] Put the focused static compatibility/grouping function in `object-rendering-policy.ts`; do not introduce a generic pass framework or another delimiter-concatenated material string.
- [x] Add focused tests in `object-rendering-policy.test.ts` proving one changed consumed field creates one incompatibility and irrelevant provenance does not.
- [x] Use temporary timing probes only when the browser profiler cannot isolate a call; remove them after capture.

### Acceptance Criteria

- Both workloads reproduce the submitted-work counts above before implementation.
- Every compatibility or device-state field has a named consumer and a test where changing it matters.
- Opaque and alpha-test compatibility is deterministic; transparent work cannot enter static compaction.
- Generated scenery may compact across visible spatial clusters; EnvCell static residents are baked per exact EnvCell job and never enter compaction.
- The baseline reports object-submission CPU separately from total render/GPU time.

### Decisions and Course Corrections

- Composite VAOs were rejected because unique pair count equaled persistent draw count and adjacent reuse was zero in both workloads.
- The original outward-facing edge capture was rejected and replaced with the inward-facing yaw-180 workload.
- Implemented `PreparedObjectFrameInput` and the generic, renderer-neutral `PreparedStaticObjectDrawCompatibility` on 2026-08-02. Preparation resolves and validates the geometry binding, exact texture and sampler objects, atlas rectangles, effective culling, landblock offset, material uniforms, detail state, and blend policy once; submission now consumes those prepared facts.
- Kept blend policy on the prepared draw but outside static compatibility because generated opaque/alpha-test compaction is already partitioned by a blend-disabled pass. Program selection likewise remains a pass-and-transform-source decision rather than a fake material equality axis.
- Exact device identities compare by reference while numeric uniform values compare component-wise. Focused tests cover each consumed compatibility field and prove source-cluster provenance is irrelevant.
- The centered harness after the preparation cutover reproduced 968 static draws, 776 persistent draws, 2,991 persistent instances, 47 program changes, 1,349 requested texture binds, and 38,320 frame-instance upload bytes with no browser errors.
- The recorded harness commands require `apps/holtburger-3d` as their working directory; the repository root has no `package.json`.
- A temporary DevTools CPU-profiler extension captured five 3-second settled samples at a 100-microsecond sampling interval from both an isolated clean-`HEAD` archive and the final worktree. It was removed after capture. Every category was normalized by the harness frame sample count before taking the median.

## Phase 2: Introduce Pass-Scoped Object State Application

### Deliverables

- A focused renderer-backend component under `renderer/` that owns applied object device state.
- A texture-unit binding containing both `WebGLTexture` and resolved `WebGLSampler` identity.
- Explicit invalidation before every independently controlled object phase following terrain or portal work.
- Fake-WebGL tests proving redundant calls are skipped and invalidation reapplies required state.

### Task Checklist

- [x] Define the complete cached object-device-state shape with ownership and invalidation comments.
- [x] Add narrow operations for program, cull face, blend policy, texture/sampler unit, active texture unit, and VAO application.
- [x] Resolve sampler requests through `WebGL2TextureSamplerCatalog.getSampler()` once per desired binding and compare the returned sampler object.
- [x] Replace local `activeProgram` variables and unconditional cull/blend/texture/VAO calls with the applicator.
- [x] Reset to unknown state at object-phase boundaries; terrain and portal code must remain independent.
- [x] Keep atlas rectangles and other draw-constant uniforms outside the state cache.
- [x] Count physical texture binds only when `bindTexture` executes; renamed `objectTexturePageBinds` to `objectTextureBinds` and swept its UI/tests.
- [x] Test texture-only changes, sampler-only changes, program changes, cull/blend changes, repeated VAOs, active-unit transitions, and invalidation.

### Acceptance Criteria

- Repeating identical desired object state performs no redundant WebGL state calls.
- Changing either texture or sampler performs exactly the necessary calls.
- A new independently controlled object phase reapplies required state even when desired values match the prior phase.
- No generic uniform cache or `gl.getParameter` reconstruction exists.
- Existing terrain and portal fixtures pass unchanged in behavior.

### Decisions and Course Corrections

- Added the object-specific `WebGL2ObjectStateApplicator`; it mirrors only program, cull, blend, texture/sampler-unit, active-unit, and VAO state and never queries WebGL.
- Each opaque and blended object phase starts unknown. This intentionally reapplies boundary state rather than coupling the cache to terrain or portal executors.
- Program-change fallback bindings also pass through the applicator. Direct fallback binds would mutate the device behind the cache and could cause a later material bind to be incorrectly skipped.
- `objectTextureBinds` now counts physical `bindTexture` calls rather than material requests. On the centered workload it fell from 1,349 requested/redundant calls to 132 physical calls while all submitted-work counts and 47 program changes remained unchanged.
- The edge workload likewise preserved 1,224 static draws, 1,000 persistent draws, 3,455 instances, 80 program changes, and 52,960 frame-instance upload bytes while reducing physical texture binds from 1,750 requests to 195 calls.
- Focused applicator, object policy, and portal executor tests pass, as do app type checks and the full lint suite. Final centered, edge, synthetic-instancing, and production-portal harness runs completed without browser errors.

## Phase 3: Align Opaque Submission Order with Desired State

### Deliverables

- Opaque/alpha-test ordering that clusters the prepared device state actually consumed by submission without treating sort equality as permission to merge draws.
- Program/transform source clustered before material device state, followed by stable geometry and fragment identity tie-breakers.
- Unchanged near-transparent distance ordering and phase-local far-transparent batching.

### Task Checklist

- [x] Replace `objectMaterialSortKey` and renderer-private partial comparisons with a focused prepared-state comparator.
- [x] Keep ordering classes distinct.
- [x] Preserve frame-template compatibility ordering used to form transparent and dynamic upload runs.
- [x] Add deterministic tie-breakers without treating provenance, stable identity, or sort adjacency as draw compatibility.
- [x] Test alternating baked/instanced inputs, shared physical atlas pages with different placements, sampler-only differences, cull overrides, generated/static fragments, and transparent barriers.

### Acceptance Criteria

- Equivalent opaque inputs form contiguous program/material/geometry groups deterministically, while only the Phase 1 static compatibility function authorizes compaction.
- Near-transparent objects remain back-to-front and never enter state-oriented reordering.
- Far-transparent and frame-template runs retain their existing compatibility invariants.
- Program changes and physical state transitions do not increase in either fixed workload.

### Decisions and Course Corrections

- Deleted `objectMaterialSortKey`. Generated, baked, and additive work compares transform source, complete prepared state, and provenance-only stable tie breakers. Frame templates instead compare their mandatory semantic cohort/domain identity first; exact prepared compatibility remains the adjacent-run merge guard, so a stale cohort safely fragments without making the normal path repeatedly sort facts that valid cohort construction already holds constant.
- WebGL objects have identity but no comparable value, so the renderer assigns weakly held, renderer-local numeric ordering identities. The pure policy comparator receives that ordering function; no device object or renderer lifetime leaks into the policy module.
- Frame-template run formation now requires both its existing semantic cohort identity and exact prepared draw compatibility. A bad or stale cohort key can no longer merge differing consumed state.
- The centered workload retained all draw/instance/upload counts while program changes fell from 47 to 6 and physical texture binds fell from the Phase 2 result of 132 to 37. Near-transparent distance ordering and the existing five far-transparent runs remained unchanged.
- Focused policy tests cover baked barriers between compatible instance runs, render-domain boundaries, far-compatible versus near-distance transparency, sampler-only and atlas-placement differences, cull state, every other draw-consumed compatibility field, and irrelevant source provenance. Production centered/edge harnesses supply the integration evidence for mixed baked/generated ordering and unchanged transparent run counts.

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

- [x] Route `LandblockLayerKind.EnvCells` through `prepareBakedStaticObjectGeometry()` and remove the now-dead EnvCell instanced-strategy tests and diagnostics expectations.
- [x] Preserve one baked artifact/scene node per exact EnvCell resident job, transparent stable ordering, atomic publication, replacement, and eviction.
- [x] Change the static-instance manager’s retained value from a backend key to generated-scenery immutable stream data and preserve reserve/publish/drop-owner atomicity.
- [x] Change `RenderWorld` resolved generated-scenery draw contracts to carry the immutable fragment data needed by renderer-owned compaction.
- [x] Assemble compacted static groups into the existing frame-arena population without introducing a universal run scheduler; dynamic and transparent policies remain separate callers of the same storage primitive.
- [x] Group generated scenery only within one prepared view and ordering pass.
- [x] Never merge across landblock-offset uniforms, transparency constraints, or portal draw-view invocations.
- [x] Encode each selected generated instance record once per draw-view invocation and upload its opaque population in one arena preparation.
- [x] Preserve deterministic instance order within each compatibility group.
- [x] Delete `createStaticInstanceStream`, `getInstanceStream`, `InstanceStreamResourceKey`, persistent buffer usage, and obsolete release/destruction branches after all consumers move.
- [x] Rename or delete every surviving `persistent` symbol, metric, comment, UI label, and test that referred to the removed GPU mechanism.
- [x] Add manager tests for lease sharing, replacement, release, and immutable data resolution.
- [x] Add renderer-policy tests for group boundaries and fake-WebGL/arena tests for offsets, upload population, and one draw per compacted group.
- [x] Measure encode time, `bufferSubData` time, object-submission CPU, upload bytes, and draw reduction in both fixed workloads.
- [x] Bound the encoder follow-up to reusable geometric CPU staging, direct scalar record writes, exact-range uploads, and focused reuse/growth/offset tests.
- [x] Exercise at least one multi-view portal fixture containing baked EnvCell residents and report generated-scenery upload bytes per draw-view invocation; do not silently reuse compacted ranges after the arena resets.

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
- EnvCells now take the baked branch unconditionally; only `LandblockLayerKind.Generated` can emit immutable instance fragments. The production `0x00d1ffff` materialization produced 3,999 baked ranges, 8,227,116 baked bytes, zero instance fragments/templates, and 12,326 geometry resources for 4,213 cells and 3,331 resident parts.
- The static-instance manager now retains worker-emitted immutable CPU records under the existing lease registry. Final-owner release deletes the record, duplicate publication cannot mutate a live record, and the key becomes publishable again only after final release.
- `RenderWorld` passes renderer-neutral fragment data to the renderer. The renderer sorts compatible generated fragments after culling, appends their records once to the existing frame arena, and replaces each adjacent group with an explicit frame range. Dynamic and transparent frame templates still use their own cohort/run rules over the same storage primitive.
- Source identity is explicit: generated scenery is distinct from other outdoor static objects, and resolving or scheduling a non-generated static fragment fails loudly. This keeps compaction and its metrics from silently broadening when the renderer gains another instanced static source.
- The persistent WebGL instance-buffer path and resource-manager API were deleted. Surviving runtime and UI diagnostics use `staticFragment*`, `selectedGenerated*`, and `submittedCompactedGenerated*` vocabulary; historical evidence tables retain the old term only to describe the removed baseline.
- The centered workload selected 776 generated fragments containing 2,991 instances and submitted exactly 337 compacted generated draws. Its frame upload was 277,600 bytes: the predicted 239,280 generated bytes plus the unchanged 38,320 bytes from existing frame-streamed work. Program changes were 6 and physical texture binds were 37.
- The edge workload selected 1,000 generated fragments containing 3,455 instances and submitted exactly 520 compacted generated draws. Its frame upload was 329,360 bytes: the predicted 276,400 generated bytes plus the unchanged 52,960 bytes from existing frame-streamed work. Program changes were 6 and physical texture binds were 37.
- The selected portal fixture is landblock `0x7d64ffff`, EnvCell `0x7d640113`, position `[24078.5, 13.7, -19328.25]`, yaw/pitch zero, portal frame mode. With baked residents it produced two resident nodes, 88 resident draws/2,724 triangles, 46 shell draws, two masks, three portal submissions, 243 total static draws, and one 8,960-byte generated/frame-template arena upload for that draw-view population.
- A temporary same-code A/B restored only EnvCell instancing while retaining the new frame compactor; it was not the deleted persistent-GPU design. Compared with that instanced-compacted alternative, baking reduced portal resident draws from 124 to 88, total static draws from 279 to 243, frame upload bytes from 22,720 to 8,960, program changes from 8 to 6, texture binds from 37 to 31, and geometry resources from 602 to 423 on this fixture.
- The portal A/B's SwiftShader total render average moved from 201.81 ms instanced-compacted to 205.82 ms baked, a roughly 2% regression in a noisy, pixel-dominated measurement. It is recorded as a concession, not attributed to object-submission CPU. The large archive also retains about 4.61 MB more payload when baked; isolated CPU profiling remains the go/no-go evidence.
- `formAdjacentObjectInstanceRuns()` initially copied a growing run array on every append. Profiling exposed the quadratic construction; the landed helper appends to an internal mutable array and returns it through the existing readonly contract.
- Profiling also rejected exact-state-first ordering for frame templates. Cohort/domain identity is already a mandatory merge boundary, and run formation rechecks exact state. Ordering frame templates by cohort alone preserves correctness and existing run counts while avoiding failure-path repair work for hypothetical stale cohorts.
- The bounded encoder follow-up keeps one CPU `Float32Array` beside the frame buffer, grows it only when geometric GPU capacity grows, writes matrix/color scalars directly with indexed iteration, and uses the WebGL2 source-offset/length overload to upload only the populated range. After warm-up the encoder creates no per-upload buffer, per-instance subarray, color array, or iterator-entry objects. The retained CPU concession is exactly 80 bytes per arena-capacity slot, matching the already-retained GPU capacity.
- The centered 3×3 residency retains 788 generated fragment cohorts containing 2,470 unique instance records, or 197,600 bytes of immutable CPU payload. Visible submission references 2,991 generated instances because some retained cohorts feed multiple draw units; the manager stores each cohort payload once. This CPU payload replaces the deleted per-cohort GPU instance buffers instead of duplicating them.

### CPU Profile Results and Gate Conflict

The profile used Chrome 150 headless, a 1280×720 viewport at DPR 1, Vite development mode, the default anisotropic-2x filtering policy, flat frame mode, and ANGLE Vulkan over SwiftShader (`SwiftShader Device (Subzero)`). The baseline was an isolated clean-`HEAD` archive using the same installed dependencies, DAT archive, browser, content-host source, and machine. Values are median inclusive milliseconds per rendered frame across five 3-second profiles.

`Submission CPU` is the non-overlapping sum requested by the plan: `#drawObjectRange`, `encodeObjectInstances`, and `bufferSubData`. Instance layout, texture binding, and draw calls are reported as children of `#drawObjectRange` and are not added twice. `Whole object phases` is the broader inclusive sum of `#drawOpaqueObjects` and `#drawBlendedObjects`; it includes ordering, distance work, run construction, uploads, and submission.

| Centered median CPU             | Baseline |  Pre-pass | Pre-pass delta |
| ------------------------------- | -------: | --------: | -------------: |
| `#drawObjectRange`              | 3.005 ms |  1.967 ms |         -34.6% |
| Instance-layout binding         | 0.722 ms |  0.699 ms |          -3.2% |
| Object texture binding          | 0.663 ms |  0.077 ms |         -88.4% |
| WebGL draw calls                | 0.088 ms |  0.070 ms |         -20.1% |
| Instance encoding               | 0.093 ms |  0.797 ms |        +753.8% |
| `bufferSubData`                 | 0.024 ms |  0.038 ms |         +62.1% |
| Submission CPU                  | 3.118 ms |  2.806 ms |         -10.0% |
| Frame-run preparation inclusive | 0.427 ms |  1.593 ms |        +273.3% |
| Whole object phases             | 4.875 ms |  5.374 ms |         +10.2% |
| Total render under profiler     | 8.346 ms | 10.498 ms |         +25.8% |

| Edge median CPU                 |  Baseline |  Pre-pass | Pre-pass delta |
| ------------------------------- | --------: | --------: | -------------: |
| `#drawObjectRange`              | 59.388 ms |  2.230 ms |         -96.2% |
| Instance-layout binding         | 54.617 ms |  0.837 ms |         -98.5% |
| Object texture binding          |  1.279 ms |  0.126 ms |         -90.2% |
| WebGL draw calls                |  0.222 ms |  0.121 ms |         -45.6% |
| Instance encoding               |  0.120 ms |  0.912 ms |        +658.3% |
| `bufferSubData`                 |  0.007 ms |  0.038 ms |        +421.0% |
| Submission CPU                  | 59.510 ms |  3.226 ms |         -94.6% |
| Frame-run preparation inclusive |  0.482 ms |  1.869 ms |        +287.9% |
| Whole object phases             | 61.757 ms |  5.127 ms |         -91.7% |
| Total render under profiler     | 69.098 ms | 11.760 ms |         -83.0% |

The named submission gate passes at reported precision, and the edge workload improves decisively. However, the centered whole-object-phase median regresses because CPU encoding and run preparation consume the saved submission time. This triggered the bounded encoder resteer below rather than a broader scheduler or composite-VAO design.

### Bounded Encoder Resteer Results

The same profiler procedure was repeated after the bounded encoder pass. `Instance encoding` now names the offset-aware `encodeObjectInstancesInto()` writer. Every capture preserved the exact visible-work facts: centered submitted 529 static draws, 776 selected fragments/2,991 generated instances, 337 compacted draws, six program changes, and 24 physical texture binds; edge submitted 744 static draws, 1,000 fragments/3,455 instances, 520 compacted draws, six program changes, and 24 physical texture binds. Upload bytes also remained 277,600 centered and 329,360 edge.

| Centered median CPU         | Baseline |  Pre-pass | Post-pass | Post vs baseline |
| --------------------------- | -------: | --------: | --------: | ---------------: |
| `#drawObjectRange`          | 3.005 ms |  1.967 ms |  2.071 ms |           -31.1% |
| Instance encoding           | 0.093 ms |  0.797 ms |  0.289 ms |          +210.8% |
| `bufferSubData`             | 0.024 ms |  0.038 ms |  0.036 ms |           +50.0% |
| Submission CPU              | 3.118 ms |  2.806 ms |  2.380 ms |           -23.7% |
| Whole object phases         | 4.875 ms |  5.374 ms |  5.348 ms |            +9.7% |
| Total render under profiler | 8.346 ms | 10.498 ms | 10.130 ms |           +21.4% |

| Edge median CPU             |  Baseline |  Pre-pass | Post-pass | Post vs baseline |
| --------------------------- | --------: | --------: | --------: | ---------------: |
| `#drawObjectRange`          | 59.388 ms |  2.230 ms |  2.595 ms |           -95.6% |
| Instance encoding           |  0.120 ms |  0.912 ms |  0.450 ms |          +275.0% |
| `bufferSubData`             |  0.007 ms |  0.038 ms |  0.058 ms |          +728.6% |
| Submission CPU              | 59.510 ms |  3.226 ms |  3.159 ms |           -94.7% |
| Whole object phases         | 61.757 ms |  5.127 ms |  6.459 ms |           -89.5% |
| Total render under profiler | 69.098 ms | 11.760 ms | 12.315 ms |           -82.2% |

The encoder pass cuts sampled encoding cost by 63.7% centered and 50.7% edge relative to the pre-pass implementation while removing its steady-state allocation churn. Centered submission CPU improves from 10.0% to 23.7% below baseline. The broader centered result does not clear: whole-object phases remain 9.7% above baseline, and profiled total render remains 21.4% above baseline. Edge phase and render medians remain noisy because the workload is driver dominated, while its submission result remains decisively below baseline. This created the stop/resteer boundary later resolved by the hardware/software-renderer reconciliation below.

Saved-profile attribution locates the remaining centered preparation cost. `#prepareFrameInstanceRuns` is 1.159 ms/frame inclusive versus the clean baseline's 0.427 ms. Its independently sampled medians include 0.343 ms in arena preparation, 0.348 ms in `formAdjacentObjectInstanceRuns()`, and 0.391 ms of self time in the renderer's second-pass flattening/materialization; exact compatibility checks account for 0.227 ms inclusive. These independently selected medians are diagnostic components and should not be summed as one precise total. `orderTransparentObjectRanges()` is also visible at 1.384 ms inclusive, but it is outside the named frame-preparation category and lacks matching raw-baseline attribution, so it is not evidence for changing transparency policy.

This created a spicy scope decision rather than evidence for another encoder tweak: either authorize a second bounded structural pass that removes the intermediate submission/run representation, or treat the written submission-only gate as authoritative and record the SwiftShader regression as a concession. The reconciliation below chose the latter; no generic scheduler, transparency-policy change, or composite-VAO design is justified by the evidence.

### Hardware and Software Renderer Reconciliation

Manual inspection of the hardware-backed interactive application reports an approximately 20–30% centered performance improvement. A later matched unprofiled capture compared five isolated clean-`HEAD` samples with five final-worktree samples under the harness's forced SwiftShader backend. Clean `HEAD` rendered at a median 8.083 ms/frame; the final worktree rendered at 9.695 ms/frame, a 19.9% SwiftShader regression, while preserving the expected 968-to-529 static-draw reduction, 47-to-6 program-change reduction, and 1,349-to-24 physical/requested texture-bind reduction. The earlier roughly 14.4 ms unprofiled baseline was not reproduced and is withdrawn as comparative evidence.

These results measure different renderer regimes rather than disproving one another. The change trades 439 generated draw submissions and repeated driver state calls for 239,280 additional frame-upload bytes plus CPU run formation. Hardware drivers can benefit materially from fewer submissions while SwiftShader makes the added CPU memory work comparatively expensive. This environment exposes no `/dev/dri` hardware device, so it cannot independently reproduce the interactive path.

The written acceptance gate is centered object-submission CPU, which improves 23.7%; total SwiftShader render time was explicitly diagnostic rather than a gate. Following the project rule not to let diagnostics drive the design, the accepted resteer is to retain the bounded encoder improvement and not perform a second run-materialization refactor solely for SwiftShader. The remaining preparation cost is recorded debt to revisit only if hardware-backed profiling contradicts the observed interactive improvement.

## Phase 5: Initialize Invariant Program and Fallback State Once

### Deliverables

- Base, palette, and detail sampler-unit uniforms initialized once for every linked object program.
- Fallback texture bindings established only at an explicit object-pass boundary when a unit otherwise lacks a valid compatible 2D texture.
- Shader-contract tests documenting why disabled palette/detail paths remain valid.

### Task Checklist

- [x] Move invariant sampler-unit assignments into explicit object-program initialization while that program is bound.
- [x] Establish pass-boundary fallback bindings through the object-state applicator without overwriting useful bindings on every program switch.
- [x] Remove fallback binding and sampler-unit assignments from program activation and per-material submission.
- [x] Verify solid-color, direct-color, indexed, alpha-test, detail, and no-detail materials.

### Acceptance Criteria

- Program switching performs no fallback texture bindings or sampler-unit uniform assignments.
- Every statically active sampler has a valid compatible binding before drawing.
- Sampler-unit values remain correct for all four object program variants.

### Decisions and Course Corrections

- Added one shared `OBJECT_TEXTURE_UNITS` contract. Every baked/instanced and fogged/unfogged program assigns base, palette, and detail sampler units exactly once after linking while that program is bound.
- Replaced the texture-only fallback field with one complete texture/sampler binding. Each non-empty object phase invalidates unknown state and establishes valid float-compatible fallbacks on all three statically active sampler units once; program changes no longer bind fallbacks.
- Removed the redundant per-material base, palette, and detail sampler-unit assignments. Focused program tests cover all four linked variants, while shader-contract tests prove solid color returns before base sampling, direct color returns before palette sampling, and detail sampling remains guarded by `uUseDetail`.
- Centered and edge production workloads retain six program changes and their exact draw/instance/upload counts. Final physical texture binds are 24 in each workload versus 1,349 and 1,750 baseline requests respectively; the one-bind difference from the first Phase 5 capture follows the frame-cohort ordering resteer above.

## Phase 6: Cleanup and Verification

### Deliverables

- Temporary timing, pair-count, transition, and grouping probes removed.
- Focused and full automated verification completed.
- Matching before/after profiles recorded for both fixed workloads and the selected portal fixture.
- Plan decisions updated to describe the landed implementation rather than the abandoned persistent path.

### Task Checklist

- [x] Remove temporary logs, sets, counters, URL flags, and probe-only allocations from the frame path.
- [x] Sweep obsolete `persistent`, composite-VAO, resource-key, helper, metric, comment, and UI vocabulary.
- [x] Run focused renderer, resource-manager, static-instance-manager, `RenderWorld`, and runtime tests while developing.
- [x] Run `npm run format:check` from `apps/holtburger-3d`.
- [x] Run `npm run check` from `apps/holtburger-3d`.
- [x] Run `npm run lint` from `apps/holtburger-3d` and treat warnings as failures.
- [x] Run `npm run test:ts` from `apps/holtburger-3d`.
- [x] Run `npm run harness:browser` plus the two fixed workload commands.
- [x] Re-profile physical state calls, layout setup, encoding/upload, draw calls, object-submission CPU, and total render time.

### Acceptance Criteria

- Every touched file passes formatting; type checks, lint, tests, and browser harnesses pass. The full-repository format check's 18 pre-existing untouched warnings are recorded rather than swept into this change.
- The Phase 4 CPU and draw-count gates pass without changed visible content.
- Physical program, cull, blend, texture, sampler, active-unit, and VAO calls decrease or remain unchanged in both workloads.
- Portal fixtures retain correct ordering and state isolation, with per-view compaction traffic reported.
- No permanent expensive diagnostic path remains.
- The plan records final compatibility-group counts, upload bytes, concessions, and profiling results.

### Decisions and Course Corrections

- The final bounded-encoder worktree passes app type checks, the complete 527-test TypeScript suite, and the full TypeScript/dead-code/Rust lint suite. Five centered and five edge browser-harness profiles completed without application errors; the temporary CDP profiler option was removed with a zero harness diff afterward.
- The final vocabulary sweep removed the last mechanism-specific `persistent` labels from the synthetic instancing fixture and a renderer invariant error. Remaining uses describe genuinely persistent entity, effect, immutable presentation, or shell state; no deleted backend resource symbol, API, metric, or UI label survives.
- Full `npm run format:check` reports 18 pre-existing warnings in files outside this change. Touched files are formatted separately; unrelated files are not rewritten solely to manufacture a green global result.
- Final centered verification submitted 529 static draws: 776 selected generated fragments/2,991 instances compacted to 337 draws, with two uploads/277,600 bytes, six program changes, and 24 physical texture binds. Edge submitted 744 static draws: 1,000 fragments/3,455 instances compacted to 520 draws, with two uploads/329,360 bytes, six program changes, and 24 texture binds.
- The synthetic instancing fixture proved that two compatible opaque instances compact to one draw while ordered transparent and additive work remains separate. The production portal fixture retained baked EnvCell residents, portal masks, and ordering while its only non-empty frame-streamed draw-view population performed one 8,960-byte upload.

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

- [x] Object state has one explicit renderer-owned applicator and clear invalidation boundaries.
- [x] Redundant program, cull, blend, texture, sampler, active-unit, and VAO calls are skipped.
- [x] Opaque/alpha-test sorting consumes prepared desired state, while static compaction uses a narrower single-draw compatibility comparison.
- [x] Spatial scene nodes remain visibility units but no longer force compatible static GPU draw boundaries.
- [x] Generated scenery compacts across compatible visible clusters; EnvCell static residents use baked per-cell preparation; dynamics retain their existing run policy.
- [x] Persistent GPU instance streams and all of their implementation vocabulary are deleted; historical plan evidence remains labeled as baseline history.
- [x] Retained immutable instance data follows existing lease replacement and eviction guarantees.
- [x] Dynamic and transparent frame-instance ranges retain correct offsets and ordering.
- [x] Program switches no longer repeat invariant sampler initialization or fallback bindings.
- [x] Temporary diagnostics are removed.
- [x] Touched files pass formatting; checks, lint, tests, and browser harnesses pass. The 18 untouched full-repository formatting warnings are recorded above.
- [x] Matching profiles satisfy the Phase 4 CPU/draw gates and report multi-view upload cost.
- [x] No renderer/device concern leaks into scene, worker, artifact, or shared runtime contracts, and no generic render-pass framework is introduced.

## Open Questions

No implementation decision remains open. The final typed compatibility fields, encoding/upload cost, retained CPU bytes, baked-EnvCell portal delta, and per-view generated-scenery upload behavior are recorded above. The portal fixture issued three portal submissions but only one draw-view population contained frame-streamed instance work, producing one 8,960-byte upload; empty populations did not create duplicate traffic.

A quantitative hardware-backed profile would strengthen the manual 20–30% improvement observation, but this environment exposes no hardware rendering device and the written CPU gate does not require it.
