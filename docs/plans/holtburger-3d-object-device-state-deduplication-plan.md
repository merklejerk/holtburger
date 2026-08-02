# Holtburger 3D Object Device-State Deduplication Plan

## Context and Boundaries

### Goal

Reduce exterior object-submission CPU time by eliminating redundant WebGL state changes and configuring immutable persistent instance inputs once, without weakening draw ordering or leaking renderer state into the scene graph.

### In Scope

- Deduplicate object-pass program, culling, blending, texture, sampler, active-texture-unit, and vertex-array state.
- Make object-state ownership and invalidation explicit at renderer-controlled pass boundaries.
- Improve opaque and alpha-test submission order using the complete pipeline identity that the renderer actually consumes.
- Lazily create complete WebGL vertex arrays for persistent `(geometry, instance stream)` pairs when measured pair cardinality supports the tradeoff.
- Preserve the existing frame-dynamic instance path, transparency ordering, portal rendering, terrain rendering, and generated-scenery 2x2 clustering policy.
- Compare centered scene-interest gameplay views and an edge-of-interest stress view before and after the change.

### Out of Scope

- Merging draw calls, geometry, instance streams, or atlas pages.
- Changing generated-scenery clustering or culling granularity.
- Generic uniform-value caching.
- A renderer-wide state mirror shared with terrain, uploads, or the portal substrate.
- Moving WebGL device objects into scene graph, static-object artifact, or worker contracts.
- Optimizing GPU pixel cost, shader execution, or mesh complexity.
- Permanent per-draw diagnostic collection in shared runtime paths.

## Ground Truth

### Reference Sources

- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
  - Owns object ordering, program activation, material binding, pass boundaries, and draw submission.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-resource-manager.ts`
  - Owns geometry VAOs, persistent instance buffers, resource replacement, and device-resource destruction.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-instance-buffer.ts`
  - Defines the shared instance record layout and currently configures locations 3-7 for every instanced draw.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-texture-sampler-catalog.ts`
  - Provides stable immutable `WebGLSampler` identities suitable for exact state comparison.
- `apps/holtburger-3d/src/lib/game/renderer/object-rendering-policy.test.ts`
  - Existing home for pure object ordering and batching policy tests.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-instance-buffer.test.ts`
  - Existing fake-WebGL coverage for instance storage and attribute configuration.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-executor.ts` and `webgl2-portal-substrate.ts`
  - Independent WebGL state consumers that establish why object state must be explicitly invalidated.

### Established Facts

- Geometry VAOs currently retain geometry attributes and the index buffer, but not instance attributes.
- Every instanced draw currently repeats one array-buffer bind, five attribute enables, five pointer definitions, and five divisors.
- Persistent instance streams are immutable and persistent draws consume the complete stream from instance zero.
- Frame-dynamic instance ranges change their base byte offset and cannot use one immutable combined VAO under WebGL2's available draw API.
- Texture atlas placement uniforms may change while the physical texture page and sampler remain identical.
- Terrain and portal execution mutate WebGL state outside the object submission loop.
- Opaque ordering currently clusters material state without first clustering baked versus instanced programs.

### Structural Alternative to Evaluate

The 2x2 generated-scenery clusters are spatial visibility units, but they currently also determine persistent instance-stream and draw-call boundaries. That coupling can multiply submitted work as:

```text
visible cluster x persistent cohort x geometry/material partition
```

Before adopting composite VAOs as the long-term answer, evaluate post-culling cohort compaction. Under that model, scene selection still returns fine spatial fragments, but the renderer regroups compatible visible fragments, copies their instance records into a contiguous view-local stream, and submits each compatible geometry/material partition once for the regrouped cohort.

This alternative could remove draw calls as well as instance-attribute setup, at the cost of encoding and uploading visible static instances. It should reuse or refine the existing frame-instance arena and cohort/run concepts rather than create a generated-scenery-specific renderer path. Static artifact contracts may expose immutable cohort fragments and compatibility identity, but must not contain WebGL resources or view policy.

The decision must compare:

- visible instance count and upload bytes per view;
- CPU encoding and `bufferSubData` time;
- mergeable cohort-fragment count;
- draw calls and instance-layout configurations eliminated;
- multi-view and portal-view duplication;
- retained CPU memory required for compactable immutable instance fragments.

Composite VAOs remain the lower-risk fallback when compaction traffic costs more than the draw and state transitions it removes.

## North Stars

1. Cache only state the renderer can know exactly; never query WebGL to reconstruct it.
2. One object-state applicator owns deduplication decisions; draw code declares desired state rather than growing scattered `last*` checks.
3. Invalidate at explicit ownership boundaries instead of pretending the cache observes unrelated WebGL users.
4. Keep immutable vertex-input construction with the resource owner that can destroy every dependency correctly.
5. Optimize the centered gameplay view first and retain the edge-of-interest view as a stress test.
6. Preserve required transparent ordering even when it limits deduplication.
7. Do not retain diagnostics whose own frame cost undermines the optimization.

## Phase 1: Establish a Reproducible Baseline

### Deliverables

- A recorded baseline for one centered scene-interest view and one edge-of-interest stress view.
- Temporary, development-only observations of:
  - submitted object draws;
  - actual program changes and texture-page binds from existing metrics;
  - instance-layout configuration count;
  - unique persistent `(geometry, instance stream)` pairs;
  - adjacent reuse of those pairs after current ordering.
- An estimate of visible instance bytes and draw-count reduction available from regrouping compatible cluster fragments after culling.
- A documented decision on whether pair cardinality is proportional to actual referenced draw bindings rather than an accidental Cartesian product.

### Task Checklist

- [ ] Fix camera placement, render settings, scene-interest radius, and generated-scenery 2x2 clustering for both captures.
- [ ] Capture frame time and the call-tree cost of `#drawObjectRange`, `bindWebGL2ObjectInstanceRange`, texture binding, and the actual draw calls.
- [ ] Collect pair cardinality and transition counts with temporary instrumentation or a one-shot Explorer probe; do not add continuous shared diagnostics.
- [ ] Measure mergeable visible cohort fragments and estimate the encoding/upload traffic required to compact them into view-local runs.
- [ ] Compare composite-VAO reuse against post-culling cohort compaction before selecting the persistent-instance optimization.
- [ ] Remove or gate the observation path before completing the implementation.

### Acceptance Criteria

- Both scenarios can be repeated with the same content and settings.
- The plan records enough evidence to compare requested draw state with actual WebGL state changes.
- Persistent combined VAOs proceed only for pairs that are actually referenced by submitted persistent draws.
- The plan records whether post-culling compaction is expected to eliminate enough draw calls to justify its per-view upload cost.

### Decisions and Course Corrections

- _To be filled during implementation._

## Phase 2: Introduce Pass-Scoped Object State Application

### Deliverables

- A focused renderer-backend component, colocated under `renderer/`, that tracks applied object device state.
- A composite texture-unit binding containing both `WebGLTexture` and `WebGLSampler` identity.
- Explicit object-pass invalidation/reset before state is applied after terrain or portal work.
- Unit tests using a fake WebGL context to prove redundant calls are skipped and invalidation reapplies required state.

### Task Checklist

- [ ] Define the complete cached object-device-state shape with comments describing ownership and invalidation.
- [ ] Add narrow operations for program, cull face, blend policy, texture/sampler unit, active texture unit, and VAO application.
- [ ] Resolve sampler requests through `WebGL2TextureSamplerCatalog.getSampler()` once per requested binding and compare the resulting sampler object.
- [ ] Count `objectTexturePageBinds` only when a physical texture binding is performed; keep its name and UI meaning honest or rename and sweep the vocabulary.
- [ ] Replace local `activeProgram` variables and unconditional cull/blend/texture/VAO calls in object submission with the state applicator.
- [ ] Reset object state at the beginning of each independently controlled object phase; do not rely on state left by terrain or portal callbacks.
- [ ] Keep atlas-rect and other material uniforms outside this cache.
- [ ] Test texture changes, sampler-only changes, program changes, cull/blend changes, repeated VAOs, and explicit invalidation.

### Acceptance Criteria

- Repeating an identical object state produces no redundant WebGL state calls.
- Changing either a texture or its sampler applies exactly the required calls.
- Beginning a new object phase reapplies state even when its desired values match the prior phase.
- Terrain and portal rendering remain independent of the cache.
- No generic uniform cache or `gl.getParameter` state reconstruction is introduced.

### Decisions and Course Corrections

- _To be filled during implementation._

## Phase 3: Align Submission Order with Pipeline Identity

### Deliverables

- A pure, tested opaque/alpha-test comparator based on the state that affects batching.
- Ordering that clusters transform source/program before material and then uses stable geometry/instance identity as a tie-breaker where legal.
- Unchanged near-transparent distance ordering and phase-local far-transparent batching guarantees.

### Task Checklist

- [ ] Replace the string-only material sort decision with a named pipeline comparison that includes baked versus instanced program selection.
- [ ] Keep ordering classes distinct.
- [ ] Add geometry and persistent stream identity only as tie-breakers after program and material compatibility.
- [ ] Preserve frame-template compatibility ordering used to form upload runs.
- [ ] Add tests covering alternating baked/instanced inputs, shared atlas pages, persistent streams, and transparent inputs.

### Acceptance Criteria

- Equivalent opaque inputs form contiguous program/material groups deterministically.
- Sorting cannot move near-transparent objects out of required distance order.
- Frame-template runs retain their existing compatibility invariants.
- Program-change and state-transition counts do not regress in either baseline scenario.

### Decisions and Course Corrections

- _To be filled during implementation._

## Phase 4: Build Persistent Composite Vertex Arrays

### Deliverables

- A lazy resource-manager cache keyed by the exact `(GeometryResourceKey, InstanceStreamResourceKey)` pair.
- A complete persistent instanced draw binding whose VAO contains geometry attributes, index binding, and instance attributes 3-7.
- Correct invalidation when geometry is replaced or either dependency is released.
- The existing mutable range-binding path retained exclusively for frame-dynamic instances.

This phase is the admitted fallback when Phase 1 shows that post-culling cohort compaction would introduce excessive upload, encoding, memory, or multi-view cost. If compaction is favored, replace this phase with an implementation phase for renderer-neutral static cohort fragments and renderer-owned view compaction, and record that course correction below before changing contracts.

### Task Checklist

- [ ] Refactor the private geometry resource representation to retain the named buffer/layout facts needed to construct another complete VAO without duplicating buffer data.
- [ ] Extract one shared instance-attribute configuration function so persistent composite construction and frame-dynamic range binding cannot drift in layout.
- [ ] Add a resource-manager operation that lazily creates or returns the complete persistent binding for one referenced pair.
- [ ] Enforce the persistent invariant that the complete immutable stream begins at instance zero.
- [ ] Change persistent object submission to bind the composite VAO and draw without calling `bindWebGL2ObjectInstanceRange`.
- [ ] Leave frame-dynamic submission on its current explicit range path.
- [ ] Delete all composite VAOs dependent on a geometry before replacement or release.
- [ ] Delete all composite VAOs dependent on an instance stream before release.
- [ ] Delete remaining composite VAOs during resource-manager destruction.
- [ ] Add resource-manager tests proving lazy reuse, no buffer-data duplication, replacement invalidation, release invalidation, and one-time destruction.

### Acceptance Criteria

- A persistent pair configures instance attributes once per device-resource lifetime, not once per draw.
- Repeated lookup of one pair returns the same live VAO.
- Resource replacement and release cannot leave a cached VAO referencing destroyed buffers.
- Composite cache size reflects referenced pairs only and remains within the cardinality observed in Phase 1.
- Frame-dynamic offsets and draws behave exactly as before.

### Decisions and Course Corrections

- If measured pair cardinality is unexpectedly high, stop before landing composite VAOs and resteer toward ordering/reuse of the existing mutable geometry VAOs. Record the evidence and revised ownership model here.
- If compatible visible cluster fragments merge well and upload cost is acceptable, replace composite VAOs with post-culling cohort compaction so spatial nodes no longer dictate GPU batch boundaries.
- _Additional decisions to be filled during implementation._

## Phase 5: One-Time Program and Fallback Initialization

### Deliverables

- Object sampler-unit uniforms initialized once per linked program rather than on every activation.
- Fallback texture bindings established only where required for complete, valid object sampling state.
- Tests or shader-contract evidence documenting why disabled palette/detail paths remain valid.

### Task Checklist

- [ ] Inspect the linked object shader variants and identify every statically active sampler.
- [ ] Move invariant sampler-unit uniform assignments to explicit program initialization.
- [ ] Bind fallback textures at an object-pass boundary only for units that otherwise lack a valid 2D texture; do not overwrite useful bindings on every program switch.
- [ ] Remove redundant fallback binding from program activation.
- [ ] Verify that solid-color, direct-color, indexed, alpha-test, detail, and no-detail materials retain correct behavior.

### Acceptance Criteria

- Program switching does not bind three fallback textures per activation.
- Every statically active sampler has a valid compatible binding before drawing.
- Sampler-unit uniform values remain correct for every object program variant.

### Decisions and Course Corrections

- _To be filled during implementation._

## Phase 6: Cleanup and Verification

### Deliverables

- Temporary pair-count and transition instrumentation removed.
- Focused and full automated verification completed.
- Before/after profiles for both baseline scenarios.
- Plan decisions and course corrections updated to match the landed implementation.

### Task Checklist

- [ ] Remove temporary logs, sets, counters, and probe-only allocations from the frame path.
- [ ] Sweep obsolete helper names and comments after the clean cutover.
- [ ] Run focused renderer tests while developing.
- [ ] Run `npm run format:check` from `apps/holtburger-3d`.
- [ ] Run `npm run check` from `apps/holtburger-3d`.
- [ ] Run `npm run lint` from `apps/holtburger-3d` and treat all warnings as failures.
- [ ] Run `npm run test:ts` from `apps/holtburger-3d`.
- [ ] Run `npm run harness:terrain` to verify the working browser rendering slice.
- [ ] Re-profile the centered gameplay view and edge-of-interest stress view with matching settings.
- [ ] Compare physical state calls, instance-layout setup, object submission time, and total frame time against Phase 1.

### Acceptance Criteria

- Automated checks and the terrain browser harness pass.
- The centered gameplay capture shows materially less object state-setup time without increased draw count or changed visible content.
- The edge stress view does not regress structurally; any remaining cost is attributable to submitted work rather than repeated immutable-state setup.
- No permanent expensive diagnostic path was added.
- The plan records the final pair cardinality, concessions, and profiling result.

### Decisions and Course Corrections

- _To be filled during implementation._

## Risks and Mitigations

| Risk                                                                             | Mitigation                                                                                                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| The cache becomes stale after another subsystem mutates WebGL state.             | Scope it to renderer-controlled object phases and always begin those phases from unknown state.                                                  |
| Composite VAOs proliferate with clustered scenery.                               | Create only referenced pairs lazily, measure cardinality first, and stop at the Phase 4 steering point if growth is unreasonable.                |
| View-local compaction trades state churn for encoding and upload cost.           | Measure visible bytes, CPU upload time, and portal/multi-view duplication before changing persistent artifact contracts.                         |
| A compaction path becomes generated-scenery-specific policy.                     | Model renderer-neutral compatible static cohort fragments and keep provenance, culling policy, and WebGL resources out of the batching contract. |
| Geometry replacement leaves VAOs pointing at deleted buffers.                    | Make dependent-VAO destruction part of the resource manager's replace/release invariants and test it directly.                                   |
| State-oriented sorting breaks transparency.                                      | Restrict the new comparator to opaque/alpha-test work and retain existing transparent algorithms.                                                |
| Texture dedupe skips an atlas placement update.                                  | Cache physical texture/sampler state only; continue applying logical atlas-rect uniforms per material.                                           |
| Fallback removal creates incomplete sampler state.                               | Inspect every shader variant and retain one-time/pass-boundary compatible fallback bindings where required.                                      |
| Instrumentation recreates the diagnostics overhead this work is meant to remove. | Use temporary or one-shot Explorer-only observation and remove it in cleanup.                                                                    |
| A broad abstraction obscures the hot path.                                       | Keep the applicator object-specific and limited to measured WebGL state; do not build a generic command encoder.                                 |

## Definition of Done

- [ ] Object state has one explicit renderer-owned applicator and clear invalidation boundaries.
- [ ] Redundant program, cull, blend, texture, sampler, active-unit, and VAO calls are skipped.
- [ ] Persistent instance attributes are configured once per admitted geometry/stream pair, or Phase 4 is explicitly resteered with measured evidence.
- [ ] Composite VAOs and post-culling cohort compaction are compared using the Phase 1 workload rather than selected by intuition.
- [ ] Frame-dynamic instance ranges retain correct offset behavior.
- [ ] Resource replacement, release, and destruction delete dependent composite VAOs exactly once.
- [ ] Opaque ordering clusters complete pipeline identity without weakening transparency.
- [ ] Temporary diagnostics are removed.
- [ ] Formatting, type checks, lint, tests, and the terrain browser harness pass.
- [ ] Matching before/after profiles demonstrate reduced state-setup cost in the centered gameplay scenario.
- [ ] No renderer/device concern leaks into scene, worker, or artifact contracts.

## Open Questions

- What measured pair cardinality would make composite VAO object count unacceptable on the target devices? Phase 1 should provide the concrete counts before we choose a limit.
- How many compatible cluster fragments can be merged in the centered gameplay view, and how many bytes would view-local compaction upload per frame and per portal view?
- Should the edge-of-interest view have a formal non-regression budget, or remain a qualitative stress case while the centered gameplay view is the optimization target?
